"""
Health check and statistics endpoints.

Provides system health monitoring with component-level status
for PostgreSQL, Redis, and Celery workers.
"""

import redis as redis_lib
from fastapi import APIRouter, Depends
from sqlalchemy import func, case, text
from sqlalchemy.orm import Session

from backend.database import get_db, engine
from backend.models import (
    TextDataset, TextRecord, ASRDataset, AudioFile, TranscriptionStatus
)
from backend.br_pipeline_models import BRPipelineRun, BRRecordStage
from backend.schemas import AnnotationStats
from config import REDIS_URL

# Create router with /api prefix
router = APIRouter(prefix="/api", tags=["health", "stats"])


@router.get("/health")
def health_check(db: Session = Depends(get_db)):
    """
    Comprehensive health check with component-level status.
    
    Checks connectivity to:
    - PostgreSQL database
    - Redis cache / broker
    - Celery workers (via inspect)
    
    Returns:
        dict: Component-level health status
    """
    components = {}
    overall = "healthy"
    
    # --- PostgreSQL ---
    try:
        db.execute(text("SELECT 1"))
        components["postgres"] = {"status": "healthy"}
    except Exception as e:
        components["postgres"] = {"status": "unhealthy", "error": str(e)}
        overall = "degraded"
    
    # --- Redis ---
    try:
        r = redis_lib.from_url(REDIS_URL, socket_timeout=3)
        r.ping()
        components["redis"] = {"status": "healthy"}
    except Exception as e:
        components["redis"] = {"status": "unhealthy", "error": str(e)}
        overall = "degraded"
    
    # --- Celery workers ---
    try:
        from backend.celery_app import celery_app
        inspector = celery_app.control.inspect(timeout=3)
        active = inspector.active()
        if active is not None:
            worker_names = list(active.keys())
            components["celery"] = {
                "status": "healthy",
                "workers": len(worker_names),
                "worker_names": worker_names,
            }
        else:
            components["celery"] = {"status": "no_workers", "workers": 0}
            # Workers being absent doesn't mean the system is broken,
            # just that no background tasks will be processed
    except Exception as e:
        components["celery"] = {"status": "unavailable", "error": str(e)}
    
    return {
        "status": overall,
        "components": components,
    }


@router.get("/stats", response_model=AnnotationStats)
def get_stats(db: Session = Depends(get_db)):
    """
    Get overall annotation statistics across all datasets.
    
    Provides counts for:
    - Text datasets and records (total and annotated)
    - ASR datasets and audio files (total and completed)
    
    Args:
        db: Database session dependency
        
    Returns:
        AnnotationStats: Comprehensive statistics object
    """
    text_records = db.query(TextRecord).count()
    
    # Calculate pipeline completed across all datasets
    pipeline_completed = db.query(BRRecordStage).filter(
        BRRecordStage.model_responses != None
    ).count()

    audio_files = db.query(AudioFile).count()
    asr_completed = db.query(AudioFile).filter(
        AudioFile.status == TranscriptionStatus.COMPLETED
    ).count()
    
    return {
        "text_datasets": db.query(TextDataset).count(),
        "text_records": text_records,
        "text_annotated": pipeline_completed,
        "asr_datasets": db.query(ASRDataset).count(),
        "audio_files": audio_files,
        "asr_completed": asr_completed,
    }


@router.get("/stats/datasets")
def get_dataset_stats(db: Session = Depends(get_db)):
    """
    Get per-dataset breakdowns for text and ASR datasets.
    """
    # Aggregate ASR counts in a single query
    asr_rows = (
        db.query(
            ASRDataset,
            func.count(AudioFile.id).label("file_count"),
            func.sum(case((AudioFile.status == TranscriptionStatus.PENDING, 1), else_=0)).label("pending_count"),
            func.sum(case((AudioFile.status == TranscriptionStatus.COMPLETED, 1), else_=0)).label("completed_count"),
        )
        .outerjoin(AudioFile, AudioFile.dataset_id == ASRDataset.id)
        .group_by(ASRDataset.id)
        .all()
    )
    asr_datasets = [
        {
            "id": ds.id,
            "name": ds.name,
            "file_count": int(fc or 0),
            "pending_count": int(pc or 0),
            "completed_count": int(cc or 0),
        }
        for ds, fc, pc, cc in asr_rows
    ]

    # Aggregate text record counts in a single query
    text_record_counts = {
        ds_id: cnt
        for ds_id, cnt in db.query(TextRecord.dataset_id, func.count(TextRecord.id))
        .group_by(TextRecord.dataset_id)
        .all()
    }

    # Fetch latest pipeline run per dataset in one query using a subquery
    from sqlalchemy import and_
    latest_run_subq = (
        db.query(
            BRPipelineRun.dataset_id,
            func.max(BRPipelineRun.id).label("latest_id"),
        )
        .group_by(BRPipelineRun.dataset_id)
        .subquery()
    )
    latest_runs = {
        pr.dataset_id: pr
        for pr in db.query(BRPipelineRun)
        .join(latest_run_subq, and_(
            BRPipelineRun.dataset_id == latest_run_subq.c.dataset_id,
            BRPipelineRun.id == latest_run_subq.c.latest_id,
        ))
        .all()
    }

    # Aggregate completed stage counts per pipeline run in one query
    stage_counts = {
        pr_id: cnt
        for pr_id, cnt in db.query(
            BRRecordStage.pipeline_run_id,
            func.count(BRRecordStage.id),
        )
        .filter(BRRecordStage.model_responses.isnot(None))
        .group_by(BRRecordStage.pipeline_run_id)
        .all()
    }

    text_datasets = []
    for ds in db.query(TextDataset).all():
        latest_run = latest_runs.get(ds.id)
        has_pipeline = latest_run is not None
        annotated_count = stage_counts.get(latest_run.id, 0) if latest_run else 0
        record_count = latest_run.total_records if latest_run else text_record_counts.get(ds.id, 0)
        text_datasets.append({
            "id": ds.id,
            "name": ds.name,
            "record_count": record_count,
            "annotated_count": annotated_count,
            "task_type": ds.task_type,
            "has_pipeline": has_pipeline,
        })

    return {
        "text_datasets": text_datasets,
        "asr_datasets": asr_datasets,
    }
