"""
Health check and statistics endpoints.

Provides system health monitoring with component-level status
for PostgreSQL, Redis, and Celery workers.
"""

import redis as redis_lib
from fastapi import APIRouter, Depends
from sqlalchemy import text
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
    text_datasets = []
    for ds in db.query(TextDataset).all():
        record_count = db.query(TextRecord).filter(TextRecord.dataset_id == ds.id).count()
        latest_run = db.query(BRPipelineRun).filter(
            BRPipelineRun.dataset_id == ds.id
        ).order_by(BRPipelineRun.id.desc()).first()
        
        annotated_count = 0
        has_pipeline = False
        if latest_run:
            has_pipeline = True
            annotated_count = db.query(BRRecordStage).filter(
                BRRecordStage.pipeline_run_id == latest_run.id,
                BRRecordStage.model_responses != None
            ).count()

        text_datasets.append({
            "id": ds.id,
            "name": ds.name,
            "record_count": latest_run.total_records if latest_run else record_count,
            "annotated_count": annotated_count,
            "task_type": ds.task_type,
            "has_pipeline": has_pipeline,
        })

    asr_datasets = []
    for ds in db.query(ASRDataset).all():
        file_count = db.query(AudioFile).filter(AudioFile.dataset_id == ds.id).count()
        pending_count = db.query(AudioFile).filter(
            AudioFile.dataset_id == ds.id,
            AudioFile.status == TranscriptionStatus.PENDING
        ).count()
        completed_count = db.query(AudioFile).filter(
            AudioFile.dataset_id == ds.id,
            AudioFile.status == TranscriptionStatus.COMPLETED
        ).count()
        asr_datasets.append({
            "id": ds.id,
            "name": ds.name,
            "file_count": file_count,
            "pending_count": pending_count,
            "completed_count": completed_count,
        })

    return {
        "text_datasets": text_datasets,
        "asr_datasets": asr_datasets,
    }
