"""
Celery tasks for background job processing.

All transcription and segmentation work runs through Celery workers
to avoid blocking the API and support concurrent multiuser usage.
"""
import os
import logging
from datetime import datetime, timedelta, timezone
from celery import shared_task, group, chord
from celery.exceptions import MaxRetriesExceededError

from backend.celery_app import celery_app
from backend.database import SessionLocal
from backend.models import AudioFile, TranscriptionStatus
# Import BR pipeline models so SQLAlchemy can resolve cross-module relationships
# (TextDataset.br_pipeline_runs references BRPipelineRun as a string)
import backend.br_pipeline_models  # noqa: F401

from config import WHISPER_API_URL

logger = logging.getLogger(__name__)

# Use local MLX Whisper (set to False to use remote API)
USE_LOCAL_WHISPER = os.getenv("USE_LOCAL_WHISPER", "true").lower() == "true"


@celery_app.task(bind=True, max_retries=3, default_retry_delay=30)
def transcribe_audio_task(self, audio_file_id: int, engine: str = "whisper") -> dict:
    """
    Celery task to transcribe a single audio file.
    Uses specified engine (whisper or qwen3).
    
    Args:
        audio_file_id: The ID of the audio file to transcribe
        engine: ASR engine to use ('whisper' or 'qwen3')
        
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
        
        # Transcribe using the specified engine
        if engine == "qwen3":
            from backend.qwen3_asr import transcribe_audio_qwen3_simple, offload_model as offload_qwen3
            logger.info(f"Transcribing with Qwen3-ASR: {audio_file.filename}")
            result = transcribe_audio_qwen3_simple(audio_file.file_path)
            
            audio_file.qwen3_transcript = result.get("text", "")
            audio_file.qwen3_language = result.get("language")
            audio_file.qwen3_confidence = result.get("confidence")
            audio_file.qwen3_transcribed_at = datetime.now(timezone.utc)
            
            # Offload model from VRAM to free resources for other models
            offload_qwen3()
        elif USE_LOCAL_WHISPER:
            from backend.whisper import transcribe_audio_simple, offload_model as offload_whisper
            logger.info(f"Transcribing locally with Whisper: {audio_file.filename}")
            result = transcribe_audio_simple(audio_file.file_path)
            
            audio_file.whisper_transcript = result.get("text", "")
            audio_file.whisper_language = result.get("language")
            audio_file.whisper_confidence = result.get("confidence")
            audio_file.transcribed_at = datetime.now(timezone.utc)
            
            # Offload model from VRAM to free resources for other models
            offload_whisper()
        else:
            # Fall back to Whisper API
            import httpx
            
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
                    audio_file.transcribed_at = datetime.now(timezone.utc)
                else:
                    raise self.retry(exc=Exception(f"Whisper API error: {response.status_code}"))
        
        audio_file.status = TranscriptionStatus.TRANSCRIBED
        db.commit()
        
        # Build response based on engine
        transcript = (
            audio_file.qwen3_transcript if engine == "qwen3"
            else audio_file.whisper_transcript
        ) or ""
        
        return {
            "status": "success",
            "file_id": audio_file_id,
            "filename": audio_file.filename,
            "transcript": transcript[:100] + "..." if len(transcript) > 100 else transcript,
            "language": (
                audio_file.qwen3_language if engine == "qwen3"
                else audio_file.whisper_language
            ),
            "confidence": (
                audio_file.qwen3_confidence if engine == "qwen3"
                else audio_file.whisper_confidence
            ),
            "engine": engine,
        }
                
    except MaxRetriesExceededError:
        audio_file.status = TranscriptionStatus.PENDING
        db.commit()
        return {"status": "error", "message": "Max retries exceeded", "file_id": audio_file_id}
    except (ImportError, ModuleNotFoundError) as e:
        # Don't retry on missing packages — they won't install themselves
        logger.error(f"Import error for {engine} engine: {e}")
        audio_file.status = TranscriptionStatus.PENDING
        db.commit()
        return {"status": "error", "message": f"Engine '{engine}' unavailable: {e}", "file_id": audio_file_id}
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
    Queue multiple files for transcription via Celery group.
    Runs BOTH Whisper and Qwen3 on every file to provide dual perspectives.
    
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
        
        # Queue both Whisper AND Qwen3 tasks for every file
        tasks = []
        for f in files:
            tasks.append(transcribe_audio_task.s(f.id, "whisper"))
            tasks.append(transcribe_audio_task.s(f.id, "qwen3"))
        
        job_group = group(tasks)
        result = job_group.apply_async()
        
        return {
            "status": "queued",
            "message": f"Queued {len(files)} files for dual-engine (Whisper + Qwen3) transcription",
            "count": len(files),
            "total_tasks": len(tasks),
            "task_group_id": result.id,
            "file_ids": [f.id for f in files],
            "engines": ["whisper", "qwen3"],
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
        stale_cutoff = datetime.now(timezone.utc) - timedelta(minutes=10)
        
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


@celery_app.task(bind=True, max_retries=2, default_retry_delay=10)
def segment_audio_task(self, audio_file_id: int, chunk_length: int = 30, use_vad: bool = True) -> dict:
    """
    Celery task to segment an audio file.
    
    Args:
        audio_file_id: The ID of the audio file to segment
        chunk_length: Maximum length of each chunk in seconds (default: 30)
        use_vad: If True, use Silero VAD (voice-only). If False, fixed-length cuts.
        
    Returns:
        dict with segmentation result
    """
    from backend.audio_segment import segment_audio, SegmentResult
    
    db = SessionLocal()
    try:
        audio_file = db.query(AudioFile).filter(AudioFile.id == audio_file_id).first()
        if not audio_file:
            return {"status": "error", "message": "File not found", "file_id": audio_file_id}
        
        if not os.path.exists(audio_file.file_path):
            return {"status": "error", "message": "Audio file not found on disk", "file_id": audio_file_id}
        
        # Segment the audio file
        result = segment_audio(
            audio_file.file_path,
            chunk_length=chunk_length,
            output_base=os.path.dirname(audio_file.file_path),
            use_vad=use_vad
        )
        
        # Create new AudioFile records for each chunk
        chunk_ids = []
        for chunk_path in result.chunks:
            chunk_filename = os.path.basename(chunk_path)
            chunk_size = os.path.getsize(chunk_path) if os.path.exists(chunk_path) else 0
            
            chunk_file = AudioFile(
                dataset_id=audio_file.dataset_id,
                filename=chunk_filename,
                file_path=chunk_path,
                file_size=chunk_size,
                status=TranscriptionStatus.PENDING,
            )
            db.add(chunk_file)
            db.flush()
            chunk_ids.append(chunk_file.id)
        
        db.commit()
        
        return {
            "status": "success",
            "file_id": audio_file_id,
            "source_filename": audio_file.filename,
            "output_folder": result.output_folder,
            "chunks_created": result.total_chunks,
            "chunk_ids": chunk_ids
        }
        
    except Exception as e:
        db.rollback()
        try:
            raise self.retry(exc=e)
        except self.MaxRetriesExceededError:
            return {"status": "error", "message": str(e), "file_id": audio_file_id}
    finally:
        db.close()


@celery_app.task(bind=True)
def batch_segment_task(self, dataset_id: int, chunk_length: int = 30, use_vad: bool = True) -> dict:
    """
    Celery task to segment all audio files in a dataset.
    
    Args:
        dataset_id: The dataset ID
        chunk_length: Maximum length of each chunk in seconds
        use_vad: If True, use Silero VAD. If False, fixed-length cuts.
        
    Returns:
        dict with batch segmentation result
    """
    from backend.models import ASRDataset
    
    db = SessionLocal()
    try:
        dataset = db.query(ASRDataset).filter(ASRDataset.id == dataset_id).first()
        if not dataset:
            return {"status": "error", "message": "Dataset not found", "dataset_id": dataset_id}
        
        # Get all audio files that haven't been segmented yet (not chunks themselves)
        audio_files = db.query(AudioFile).filter(
            AudioFile.dataset_id == dataset_id,
            ~AudioFile.filename.like("%_chunk%")  # Exclude existing chunks
        ).all()
        
        if not audio_files:
            return {
                "status": "completed",
                "dataset_id": dataset_id,
                "message": "No files to segment",
                "files_processed": 0
            }
        
        # Queue segmentation tasks for each file
        task_ids = []
        for audio_file in audio_files:
            task = segment_audio_task.delay(audio_file.id, chunk_length, use_vad)
            task_ids.append(task.id)
        
        return {
            "status": "queued",
            "dataset_id": dataset_id,
            "files_queued": len(task_ids),
            "task_ids": task_ids
        }
        
    finally:
        db.close()
