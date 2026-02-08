"""
Celery tasks for background job processing.
"""
import os
import httpx
from datetime import datetime, timedelta
from celery import shared_task, group, chord
from celery.exceptions import MaxRetriesExceededError

from backend.celery_app import celery_app
from backend.database import SessionLocal
from backend.models import AudioFile, TranscriptionStatus

# Whisper API URL
WHISPER_API_URL = os.getenv("WHISPER_API_URL", "http://localhost:9000")


@celery_app.task(bind=True, max_retries=3, default_retry_delay=30)
def transcribe_audio_task(self, audio_file_id: int) -> dict:
    """
    Celery task to transcribe a single audio file using Whisper API.
    
    Args:
        audio_file_id: The ID of the audio file to transcribe
        
    Returns:
        dict with transcription result or error
    """
    db = SessionLocal()
    try:
        audio_file = db.query(AudioFile).filter(AudioFile.id == audio_file_id).first()
        if not audio_file:
            return {"status": "error", "message": "File not found", "file_id": audio_file_id}
        
        # Update status to transcribing
        audio_file.status = TranscriptionStatus.TRANSCRIBING
        db.commit()
        
        # Check if file exists
        if not os.path.exists(audio_file.file_path):
            audio_file.status = TranscriptionStatus.PENDING
            db.commit()
            return {"status": "error", "message": "Audio file not found on disk", "file_id": audio_file_id}
        
        # Call Whisper API (synchronous for Celery)
        with httpx.Client(timeout=300.0) as client:
            with open(audio_file.file_path, "rb") as f:
                response = client.post(
                    f"{WHISPER_API_URL}/asr",
                    files={"audio_file": (audio_file.filename, f)},
                    params={"output": "json"}
                )
            
            if response.status_code == 200:
                result = response.json()
                audio_file.whisper_transcript = result.get("text", "")
                audio_file.whisper_language = result.get("language")
                audio_file.status = TranscriptionStatus.TRANSCRIBED
                audio_file.transcribed_at = datetime.utcnow()
                db.commit()
                
                return {
                    "status": "success",
                    "file_id": audio_file_id,
                    "filename": audio_file.filename,
                    "transcript": audio_file.whisper_transcript[:100] + "..." if len(audio_file.whisper_transcript) > 100 else audio_file.whisper_transcript,
                    "language": audio_file.whisper_language
                }
            else:
                # Retry on API error
                raise self.retry(exc=Exception(f"Whisper API error: {response.status_code}"))
                
    except MaxRetriesExceededError:
        audio_file.status = TranscriptionStatus.PENDING
        db.commit()
        return {"status": "error", "message": "Max retries exceeded", "file_id": audio_file_id}
    except Exception as e:
        # Retry on any error
        try:
            raise self.retry(exc=e)
        except MaxRetriesExceededError:
            audio_file.status = TranscriptionStatus.PENDING
            db.commit()
            return {"status": "error", "message": str(e), "file_id": audio_file_id}
    finally:
        db.close()


@celery_app.task(bind=True)
def batch_transcribe_task(self, dataset_id: int, file_ids: list = None) -> dict:
    """
    Queue multiple files for transcription.
    
    Args:
        dataset_id: The dataset ID
        file_ids: Optional list of specific file IDs. If None, transcribe all pending files.
        
    Returns:
        dict with batch job status
    """
    db = SessionLocal()
    try:
        # Get files to transcribe
        query = db.query(AudioFile).filter(AudioFile.dataset_id == dataset_id)
        
        if file_ids:
            query = query.filter(AudioFile.id.in_(file_ids))
        else:
            # Only transcribe pending files
            query = query.filter(AudioFile.status == TranscriptionStatus.PENDING)
        
        files = query.all()
        
        if not files:
            return {"status": "no_files", "message": "No files to transcribe", "count": 0}
        
        # Queue individual transcription tasks
        job_group = group(transcribe_audio_task.s(f.id) for f in files)
        result = job_group.apply_async()
        
        return {
            "status": "queued",
            "message": f"Queued {len(files)} files for transcription",
            "count": len(files),
            "task_group_id": result.id,
            "file_ids": [f.id for f in files]
        }
    finally:
        db.close()


@celery_app.task
def check_stale_transcriptions() -> dict:
    """
    Periodic task to check for stale transcriptions (stuck in TRANSCRIBING state).
    Requeues them for processing.
    """
    db = SessionLocal()
    try:
        # Find files stuck in TRANSCRIBING for more than 10 minutes
        stale_cutoff = datetime.utcnow() - timedelta(minutes=10)
        
        stale_files = db.query(AudioFile).filter(
            AudioFile.status == TranscriptionStatus.TRANSCRIBING,
            AudioFile.updated_at < stale_cutoff
        ).all()
        
        requeued = []
        for f in stale_files:
            f.status = TranscriptionStatus.PENDING
            transcribe_audio_task.delay(f.id)
            requeued.append(f.id)
        
        db.commit()
        
        return {
            "status": "completed",
            "requeued_count": len(requeued),
            "requeued_ids": requeued
        }
    finally:
        db.close()


@celery_app.task(bind=True)
def batch_transcribe_callback(self, results: list, dataset_id: int) -> dict:
    """
    Callback task that runs after batch transcription completes.
    
    Args:
        results: List of results from individual transcription tasks
        dataset_id: The dataset ID
    """
    success_count = sum(1 for r in results if r.get("status") == "success")
    error_count = sum(1 for r in results if r.get("status") == "error")
    
    return {
        "status": "batch_completed",
        "dataset_id": dataset_id,
        "total": len(results),
        "success": success_count,
        "errors": error_count
    }
