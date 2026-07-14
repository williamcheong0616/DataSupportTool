"""
Provider API for external system integration.

Exposes a small, read-only, API-key-authenticated surface that lets an
external system (e.g. a training/inference pipeline) discover and pull
verified data produced by DataSupportTool. This is the dataset-provider
side of the integration; the external system is expected to act as the
inferencing/training machine and consume what these routes return.

Verification, not full dataset completion, is the export bar: a dataset can
be exported at any stage of progress, but each endpoint only ever includes
records that have individually passed their verification checkpoint —
unverified/in-progress records are silently excluded rather than blocking
the whole export.

- Text export: records that passed BR pipeline Stage 3 (human question
  validation). Stage 5 (model responses) is DataSupportTool's own
  output-checking step, not required for training data — the `output` field
  is left blank so the receiving training pipeline generates it itself.
- ASR export: audio files with `status = COMPLETED`.
- BR pipeline export: records that finished Stage 5 (`completed = True`),
  for pulling DataSupportTool's own model responses (e.g. for output
  checking), computed live from BRRecordStage rows rather than trusted from
  the pipeline run's own `status` bookkeeping, which can go stale relative
  to record-level state.
"""
import logging
import os
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.enums import TranscriptionStatus
from backend.models import ASRDataset, AudioFile, TextDataset, TextRecord
from backend.br_pipeline_models import BRPipelineRun, BRRecordStage
from backend.routes.settings import load_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/provider", tags=["Provider API (External Integration)"])


def verify_api_key(x_api_key: Optional[str] = Header(None, alias="X-API-Key")) -> None:
    """
    Require a valid provider API key on every provider route.

    Args:
        x_api_key: Value of the `X-API-Key` request header.

    Raises:
        HTTPException: 503 if no provider key has been generated yet (feature
            disabled by default), 401 if the header is missing or wrong.
    """
    configured_key = load_settings().get("provider_api_key")
    if not configured_key:
        raise HTTPException(
            status_code=503,
            detail="Provider API is disabled. Generate a key from Settings to enable external access.",
        )
    if not x_api_key or x_api_key != configured_key:
        raise HTTPException(status_code=401, detail="Invalid or missing X-API-Key header")


# ==================== TRAINING-DATA TEMPLATES ====================

def _format_alpaca(question: str, context: str) -> dict:
    """Alpaca-style {instruction, input, output} row."""
    return {"instruction": question, "input": context or "", "output": ""}


def _format_gemma(question: str, context: str) -> dict:
    """Gemma chat-template row: a single 'text' field with turns baked in."""
    prompt = f"{context}\n\n{question}" if context else question
    text = f"<start_of_turn>user\n{prompt}<end_of_turn>\n<start_of_turn>model\n<end_of_turn>"
    return {"text": text}


def _format_sharegpt(question: str, context: str) -> dict:
    """ShareGPT-style conversations row (human turn / blank gpt turn)."""
    prompt = f"{context}\n\n{question}" if context else question
    return {"conversations": [{"from": "human", "value": prompt}, {"from": "gpt", "value": ""}]}


TEMPLATE_FORMATTERS = {
    "alpaca": _format_alpaca,
    "gemma": _format_gemma,
    "sharegpt": _format_sharegpt,
}


def _stage3_validated_rows(db: Session, dataset_id: int):
    """
    Fetch every BR-pipeline record for a dataset that passed Stage 3 (human
    question validation), across all pipeline runs tied to that dataset.

    Args:
        db: Active database session.
        dataset_id: TextDataset ID to pull validated records for.

    Returns:
        List of (BRRecordStage, TextRecord) tuples.
    """
    return (
        db.query(BRRecordStage, TextRecord)
        .join(TextRecord, BRRecordStage.text_record_id == TextRecord.id)
        .join(BRPipelineRun, BRRecordStage.pipeline_run_id == BRPipelineRun.id)
        .filter(
            BRPipelineRun.dataset_id == dataset_id,
            BRRecordStage.selected_question_index.isnot(None),
            BRRecordStage.is_discarded == False,
        )
        .all()
    )


# ==================== DISCOVERY ====================

@router.get("/datasets", dependencies=[Depends(verify_api_key)])
def list_providable_datasets(db: Session = Depends(get_db)):
    """
    List every dataset/pipeline run this instance can provide, with counts of
    how many records are currently verified and exportable. `ready: true`
    means at least one verified record exists — datasets do not need to be
    100% finished to appear here or to export.
    """
    results = []

    text_datasets = db.query(TextDataset).all()
    for ds in text_datasets:
        total = db.query(TextRecord).filter(TextRecord.dataset_id == ds.id).count()
        validated = len(_stage3_validated_rows(db, ds.id))
        results.append({
            "source": "text",
            "id": ds.id,
            "name": ds.name,
            "total_records": total,
            "verified_records": validated,
            "ready": validated > 0,
            "export_url": f"/api/provider/text/{ds.id}/export",
        })

    asr_rows = (
        db.query(
            ASRDataset,
            func.count(AudioFile.id).label("total"),
            func.sum(case((AudioFile.status == TranscriptionStatus.COMPLETED, 1), else_=0)).label("done"),
        )
        .outerjoin(AudioFile, AudioFile.dataset_id == ASRDataset.id)
        .group_by(ASRDataset.id)
        .all()
    )
    for ds, total, done in asr_rows:
        total, done = int(total or 0), int(done or 0)
        results.append({
            "source": "asr",
            "id": ds.id,
            "name": ds.name,
            "total_records": total,
            "verified_records": done,
            "ready": done > 0,
            "export_url": f"/api/provider/asr/{ds.id}/export",
        })

    br_pipeline_runs = db.query(BRPipelineRun).all()
    for run in br_pipeline_runs:
        total = (
            db.query(BRRecordStage)
            .filter(BRRecordStage.pipeline_run_id == run.id, BRRecordStage.is_discarded == False)
            .count()
        )
        done = (
            db.query(BRRecordStage)
            .filter(
                BRRecordStage.pipeline_run_id == run.id,
                BRRecordStage.completed == True,
                BRRecordStage.is_discarded == False,
            )
            .count()
        )
        results.append({
            "source": "br_pipeline",
            "id": run.id,
            "name": f"BR Pipeline Run #{run.id} (dataset {run.dataset_id})",
            "dataset_id": run.dataset_id,
            "total_records": total,
            "verified_records": done,
            "ready": done > 0,
            "export_url": f"/api/provider/br-pipeline/{run.id}/export",
        })

    return {"datasets": results, "total": len(results)}


# ==================== TEXT DATASET EXPORT ====================

@router.get("/text/{dataset_id}/export", dependencies=[Depends(verify_api_key)])
def export_text_dataset(
    dataset_id: int,
    format: str = Query("sharegpt", enum=list(TEMPLATE_FORMATTERS)),
    db: Session = Depends(get_db),
):
    """
    Export a text dataset's Stage-3-validated (human-approved question)
    records as training-ready rows in the requested template.

    The verification bar is Stage 3 only — Stage 5 model responses are not
    required and are not used here. Records that haven't reached Stage 3 yet
    are excluded, but the dataset itself can be exported at any progress
    level.

    Args:
        dataset_id: TextDataset ID to export.
        format: Output template — 'alpaca', 'gemma', or 'sharegpt' (default).
    """
    dataset = db.query(TextDataset).filter(TextDataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    rows = _stage3_validated_rows(db, dataset_id)
    formatter = TEMPLATE_FORMATTERS[format]
    records = [formatter(stage.selected_question, stage.restructured_text or text_record.original_text) for stage, text_record in rows]

    logger.info(f"Provider API: exported text dataset {dataset_id} ({len(records)} verified records, format={format})")
    return {
        "dataset_id": dataset.id,
        "dataset_name": dataset.name,
        "format": format,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "record_count": len(records),
        "records": records,
    }


# ==================== ASR DATASET EXPORT ====================

@router.get("/asr/{dataset_id}/export", dependencies=[Depends(verify_api_key)])
def export_asr_dataset(dataset_id: int, db: Session = Depends(get_db)):
    """
    Export an ASR dataset's finished transcripts.

    Only audio files with status COMPLETED are included; the dataset can be
    exported at any progress level. Audio bytes are fetched separately via
    `/api/provider/asr/files/{file_id}/audio`.
    """
    dataset = db.query(ASRDataset).filter(ASRDataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    files = (
        db.query(AudioFile)
        .filter(AudioFile.dataset_id == dataset_id, AudioFile.status == TranscriptionStatus.COMPLETED)
        .all()
    )

    logger.info(f"Provider API: exported ASR dataset {dataset_id} ({len(files)} verified files)")
    return {
        "dataset_id": dataset.id,
        "dataset_name": dataset.name,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "record_count": len(files),
        "records": [
            {
                "id": f.id,
                "filename": f.filename,
                "duration": f.duration,
                "transcript": f.corrected_transcript,
                "audio_url": f"/api/provider/asr/files/{f.id}/audio",
            }
            for f in files
        ],
    }


@router.get("/asr/files/{file_id}/audio", dependencies=[Depends(verify_api_key)])
def download_provider_audio(file_id: int, db: Session = Depends(get_db)):
    """Download the audio file for a completed ASR record."""
    audio_file = db.query(AudioFile).filter(AudioFile.id == file_id).first()
    if not audio_file:
        raise HTTPException(status_code=404, detail="File not found")
    if audio_file.status != TranscriptionStatus.COMPLETED:
        raise HTTPException(status_code=409, detail="File is not verified yet — export blocked")
    if not os.path.exists(str(audio_file.file_path)):
        raise HTTPException(status_code=404, detail="Audio file not found on disk")

    return FileResponse(audio_file.file_path, media_type="audio/mpeg", filename=audio_file.filename)


# ==================== BR PIPELINE EXPORT (own-use / output checking) ====================

@router.get("/br-pipeline/{pipeline_run_id}/export", dependencies=[Depends(verify_api_key)])
def export_br_pipeline_run(pipeline_run_id: int, db: Session = Depends(get_db)):
    """
    Export a BR pipeline run's Stage-5 output (question + model responses).

    Intended for output-checking/eval use, not training input — training data
    comes from `/api/provider/text/{dataset_id}/export` instead. Only records
    that finished Stage 5 (`completed = True`) are included; the run can be
    exported at any progress level. Completion is computed live from
    BRRecordStage rows rather than trusted from the pipeline run's own
    `status` bookkeeping, which can go stale relative to record-level state.
    """
    run = db.query(BRPipelineRun).filter(BRPipelineRun.id == pipeline_run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Pipeline run not found")

    stages = (
        db.query(BRRecordStage)
        .filter(
            BRRecordStage.pipeline_run_id == pipeline_run_id,
            BRRecordStage.completed == True,
            BRRecordStage.is_discarded == False,
        )
        .all()
    )

    records = [
        {
            "record_id": rs.text_record_id,
            "text": rs.restructured_text,
            "question": rs.selected_question,
            "model_responses": rs.model_responses,
        }
        for rs in stages
        if rs.selected_question and rs.model_responses
    ]

    logger.info(f"Provider API: exported BR pipeline run {pipeline_run_id} ({len(records)} verified records)")
    return {
        "pipeline_run_id": run.id,
        "dataset_id": run.dataset_id,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "record_count": len(records),
        "records": records,
    }
