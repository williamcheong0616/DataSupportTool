"""
ASR (Automatic Speech Recognition) annotation API routes.

Handles all endpoints related to:
- ASR dataset management
- Audio file upload and management
- YouTube audio import with segmentation
- Whisper transcription (sync and async)
- Audio fusing/concatenation
- Audio segmentation (Silero VAD or fixed-length)
- Transcript annotation and correction
- Dataset export (CSV/JSONL)
"""

from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from fastapi.responses import StreamingResponse, FileResponse
from sqlalchemy.orm import Session
import os
import io
import csv
import json

from backend.database import get_db
from backend.models import ASRDataset, AudioFile, TranscriptionStatus
from backend.schemas import (
    ASRDatasetCreate, ASRDatasetResponse,
    AudioFileResponse, TranscriptAnnotation
)
from backend.tasks import transcribe_audio_task, batch_transcribe_task
from backend.services.transcription_service import TranscriptionService
from backend.utils.logger import RequestLogger

import logging
logger = logging.getLogger(__name__)

# Create router with /api/asr prefix
router = APIRouter(prefix="/api/asr", tags=["asr"])

# Audio files directory
AUDIO_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data", "audio")
os.makedirs(AUDIO_DIR, exist_ok=True)


# ==================== DATASET MANAGEMENT ====================

@router.get("/datasets", response_model=List[ASRDatasetResponse])
def list_asr_datasets(db: Session = Depends(get_db)):
    """
    List all ASR datasets with file counts and status breakdown.
    
    Returns:
        List of datasets with file_count, pending_count, completed_count
    """
    datasets = db.query(ASRDataset).order_by(ASRDataset.created_at.desc()).all()
    result = []
    for ds in datasets:
        file_count = db.query(AudioFile).filter(AudioFile.dataset_id == ds.id).count()
        pending_count = db.query(AudioFile).filter(
            AudioFile.dataset_id == ds.id,
            AudioFile.status.in_([TranscriptionStatus.PENDING, TranscriptionStatus.TRANSCRIBING])
        ).count()
        completed_count = db.query(AudioFile).filter(
            AudioFile.dataset_id == ds.id,
            AudioFile.status == TranscriptionStatus.COMPLETED
        ).count()
        result.append({
            **ds.__dict__,
            "file_count": file_count,
            "pending_count": pending_count,
            "completed_count": completed_count,
        })
    return result


@router.post("/datasets", response_model=ASRDatasetResponse)
def create_asr_dataset(data: ASRDatasetCreate, db: Session = Depends(get_db)):
    """
    Create a new ASR dataset.
    
    Args:
        data: Dataset creation data (name, description)
        
    Returns:
        Created dataset with initial counts (all 0)
    """
    with RequestLogger(f"Create ASR dataset: {data.name}", name=data.name):
        dataset = ASRDataset(name=data.name, description=data.description)
        db.add(dataset)
        db.commit()
        db.refresh(dataset)
        logger.info(f"Created ASR dataset '{data.name}' with ID {dataset.id}")
        return {**dataset.__dict__, "file_count": 0, "pending_count": 0, "completed_count": 0}


@router.delete("/datasets/{dataset_id}")
def delete_asr_dataset(dataset_id: int, db: Session = Depends(get_db)):
    """
    Delete an ASR dataset and all its audio files (both DB records and physical files).
    
    Args:
        dataset_id: Dataset ID to delete
        
    Returns:
        Success message
    """
    with RequestLogger(f"Delete ASR dataset {dataset_id}", dataset_id=dataset_id):
        dataset = db.query(ASRDataset).filter(ASRDataset.id == dataset_id).first()
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")
        
        # Delete physical audio files from disk
        audio_files = db.query(AudioFile).filter(AudioFile.dataset_id == dataset_id).all()
        deleted_files = 0
        for af in audio_files:
            if os.path.exists(str(af.file_path)):
                os.remove(str(af.file_path))
                deleted_files += 1
        
        dataset_name = dataset.name
        # Delete dataset (CASCADE will delete AudioFile records)
        db.delete(dataset)
        db.commit()
        
        logger.info(f"Deleted dataset '{dataset_name}' (ID: {dataset_id})", extra={
            "deleted_files": deleted_files,
            "total_records": len(audio_files)
        })
        return {"message": f"Dataset '{dataset_name}' deleted"}


# ==================== AUDIO UPLOAD ====================

@router.post("/datasets/{dataset_id}/upload")
async def upload_audio_files(
    dataset_id: int,
    files: List[UploadFile] = File(...),
    auto_transcribe: bool = Query(True, description="Automatically queue transcription"),
    db: Session = Depends(get_db)
):
    """
    Upload multiple audio files to an ASR dataset.
    
    Supports: MP3, WAV, M4A, FLAC, OGG
    Auto-queues transcription via Celery if auto_transcribe=True.
    
    Args:
        dataset_id: Target dataset ID
        files: List of audio files to upload
        auto_transcribe: Whether to automatically queue transcription
        
    Returns:
        Upload summary with file IDs and optional task IDs
    """
    with RequestLogger(f"Upload {len(files)} files to dataset {dataset_id}",
                       dataset_id=dataset_id,
                       file_count=len(files),
                       auto_transcribe=auto_transcribe):
        dataset = db.query(ASRDataset).filter(ASRDataset.id == dataset_id).first()
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")
        
        dataset_dir = os.path.join(AUDIO_DIR, str(dataset_id))
        os.makedirs(dataset_dir, exist_ok=True)
        
        uploaded = []
        task_ids = []
        total_size = 0
        
        for file in files:
            # Save file to disk
            file_path = os.path.join(dataset_dir, file.filename or "upload.wav")
            content = await file.read()
            with open(file_path, "wb") as f:
                f.write(content)
            
            file_size = len(content)
            total_size += file_size
            
            # Create database record
            audio_file = AudioFile(
                dataset_id=dataset_id,
                filename=file.filename,
                file_path=file_path,
                file_size=file_size,
                status=TranscriptionStatus.PENDING,
            )
            db.add(audio_file)
            db.commit()
            db.refresh(audio_file)
            uploaded.append(audio_file.id)
            
            # Queue transcription via Celery
            if auto_transcribe:
                task = transcribe_audio_task.delay(audio_file.id)
                task_ids.append(task.id)
        
        logger.info(f"Uploaded {len(uploaded)} files to dataset {dataset_id}", extra={
            "file_ids": uploaded,
            "total_size_bytes": total_size,
            "transcription_queued": auto_transcribe
        })
        
        return {
            "message": f"Uploaded {len(uploaded)} files",
            "file_ids": uploaded,
            "transcription_queued": auto_transcribe,
            "task_ids": task_ids if auto_transcribe else []
        }


# ==================== YOUTUBE IMPORT ====================

@router.post("/datasets/{dataset_id}/youtube")
def import_youtube_audio(
    dataset_id: int,
    youtube_url: str = Query(..., description="YouTube video URL"),
    auto_segment: bool = Query(True, description="Automatically segment into chunks"),
    chunk_length: int = Query(30, ge=5, le=120, description="Max chunk length in seconds"),
    use_vad: bool = Query(True, description="Use VAD (voice-only) or fixed-length cutting"),
    auto_transcribe: bool = Query(False, description="Automatically transcribe after segmentation"),
    min_speech_duration_ms: int = Query(500, ge=100, le=5000, description="Minimum speech duration in ms for VAD"),
    db: Session = Depends(get_db)
):
    """
    Import audio from a YouTube video.
    
    Downloads audio, optionally segments it, and creates AudioFile records.
    
    Segmentation modes:
    - VAD (use_vad=True): Uses Silero VAD to detect speech segments, max chunk_length per segment
    - Fixed-length (use_vad=False): Cuts audio into equal intervals of chunk_length
    
    Args:
        dataset_id: Target dataset ID
        youtube_url: Valid YouTube video URL
        auto_segment: Whether to segment audio
        chunk_length: Maximum chunk length in seconds (5-120)
        use_vad: True for voice activity detection, False for fixed-length cuts
        auto_transcribe: Whether to auto-queue transcription for segments
        min_speech_duration_ms: Minimum speech segment duration for VAD (100-5000ms)
        
    Returns:
        Import summary with YouTube metadata and created file IDs
    """
    with RequestLogger(f"Import YouTube audio for dataset {dataset_id}",
                       dataset_id=dataset_id,
                       youtube_url=youtube_url,
                       auto_segment=auto_segment,
                       use_vad=use_vad):
        from backend.youtube_service import download_youtube_audio, extract_video_id
        from backend.audio_segment import segment_audio
        
        dataset = db.query(ASRDataset).filter(ASRDataset.id == dataset_id).first()
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")
        
        # Validate YouTube URL
        video_id = extract_video_id(youtube_url)
        if not video_id:
            raise HTTPException(status_code=400, detail="Invalid YouTube URL")
        
        dataset_dir = os.path.join(AUDIO_DIR, str(dataset_id))
        os.makedirs(dataset_dir, exist_ok=True)
        
        logger.info(f"Downloading audio from YouTube: {youtube_url}")
        # Download YouTube audio
        download_result = download_youtube_audio(youtube_url, dataset_dir, format="wav")
        
        if not download_result.success:
            raise HTTPException(status_code=500, detail=f"Download failed: {download_result.error}")
        
        logger.info(f"Downloaded '{download_result.title}' ({download_result.duration}s)")
        created_files = []
        task_ids = []
        
        if auto_segment and download_result.duration > chunk_length:
            # Segment the downloaded audio
            try:
                logger.info(f"Segmenting audio with VAD={use_vad}, chunk_length={chunk_length}s")
                segment_result = segment_audio(
                    download_result.file_path,
                    chunk_length=chunk_length,
                    output_base=dataset_dir,
                    use_vad=use_vad,
                    min_speech_duration_ms=min_speech_duration_ms
                )
                
                # Create AudioFile records for each chunk
                for chunk_path in segment_result.chunks:
                    chunk_filename = os.path.basename(chunk_path)
                    chunk_size = os.path.getsize(chunk_path) if os.path.exists(chunk_path) else 0
                    
                    audio_file = AudioFile(
                        dataset_id=dataset_id,
                        filename=chunk_filename,
                        file_path=chunk_path,
                        file_size=chunk_size,
                        status=TranscriptionStatus.PENDING,
                    )
                    db.add(audio_file)
                    db.flush()
                    created_files.append(audio_file.id)
                    
                    if auto_transcribe:
                        task = transcribe_audio_task.delay(audio_file.id)
                        task_ids.append(task.id)
                
                db.commit()
                
                logger.info(f"Created {segment_result.total_chunks} chunks from YouTube audio", extra={
                    "chunks_created": segment_result.total_chunks,
                    "file_ids": created_files,
                    "transcription_queued": auto_transcribe
                })
                
                return {
                    "message": f"Downloaded and segmented into {segment_result.total_chunks} chunks",
                    "youtube_title": download_result.title,
                    "youtube_duration": download_result.duration,
                    "source_file": download_result.file_path,
                    "chunks_created": segment_result.total_chunks,
                    "file_ids": created_files,
                    "transcription_queued": auto_transcribe,
                    "task_ids": task_ids
                }
                
            except Exception as e:
                db.rollback()
                logger.error(f"Segmentation failed for YouTube audio: {str(e)}")
                raise HTTPException(status_code=500, detail=f"Segmentation failed: {str(e)}")
        
        else:
            # Add the downloaded file without segmentation
            file_size = os.path.getsize(download_result.file_path) if os.path.exists(download_result.file_path) else 0
            
            audio_file = AudioFile(
                dataset_id=dataset_id,
                filename=os.path.basename(download_result.file_path),
                file_path=download_result.file_path,
                file_size=file_size,
                duration=download_result.duration,
                status=TranscriptionStatus.PENDING,
            )
            db.add(audio_file)
            db.commit()
            db.refresh(audio_file)
            created_files.append(audio_file.id)
            
            if auto_transcribe:
                task = transcribe_audio_task.delay(audio_file.id)
                task_ids.append(task.id)
            
            logger.info(f"Added YouTube audio without segmentation", extra={
                "file_id": audio_file.id,
                "duration": download_result.duration,
                "transcription_queued": auto_transcribe
            })
            
            return {
                "message": "Downloaded YouTube audio",
                "youtube_title": download_result.title,
                "youtube_duration": download_result.duration,
                "file_id": audio_file.id,
                "file_ids": created_files,
                "transcription_queued": auto_transcribe,
                "task_ids": task_ids
            }


# ==================== TRANSCRIPTION ====================

@router.post("/files/{file_id}/transcribe")
def manual_transcribe(
    file_id: int,
    use_celery: bool = Query(False, description="Use Celery for async transcription (requires Redis)"),
    db: Session = Depends(get_db)
):
    """
    Trigger transcription for a single audio file.
    
    Modes:
    - Synchronous (use_celery=False): Blocks until transcription completes
    - Asynchronous (use_celery=True): Queues via Celery, returns task_id immediately
    
    Args:
        file_id: Audio file ID to transcribe
        use_celery: Whether to use async Celery task queue
        
    Returns:
        Transcription result (sync) or task_id (async)
    """
    with RequestLogger(f"Manual transcribe file {file_id}", file_id=file_id, use_celery=use_celery):
        audio_file = db.query(AudioFile).filter(AudioFile.id == file_id).first()
        if not audio_file:
            raise HTTPException(status_code=404, detail="File not found")
        
        if use_celery:
            # Async via Celery (requires Redis)
            logger.info(f"Queueing transcription for file {file_id} via Celery")
            task = transcribe_audio_task.delay(file_id)
            return {"message": "Transcription queued", "task_id": task.id}
        else:
            # Synchronous transcription using service layer
            logger.info(f"Starting synchronous transcription for file {file_id}")
            service = TranscriptionService(db)
            result = service.transcribe_single(file_id)
            
            logger.info(f"Transcription completed for file {file_id}", extra={
                "language": result.get("language"),
                "confidence": result.get("confidence")
            })
            return result


@router.post("/datasets/{dataset_id}/transcribe-all")
def batch_transcribe(
    dataset_id: int,
    file_ids: Optional[List[int]] = Query(None, description="Specific file IDs to transcribe"),
    use_celery: bool = Query(False, description="Use Celery for async transcription (requires Redis)"),
    db: Session = Depends(get_db)
):
    """
    Transcribe all pending files in a dataset.
    
    Args:
        dataset_id: Dataset ID
        file_ids: Optional list of specific file IDs to transcribe
        use_celery: Whether to use async Celery task queue
        
    Returns:
        Batch transcription results
    """
    with RequestLogger(f"Batch transcribe dataset {dataset_id}",
                       dataset_id=dataset_id,
                       file_ids=file_ids,
                       use_celery=use_celery):
        dataset = db.query(ASRDataset).filter(ASRDataset.id == dataset_id).first()
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")
        
        if use_celery:
            # Async via Celery (requires Redis)
            logger.info(f"Queueing batch transcription for dataset {dataset_id} via Celery")
            task = batch_transcribe_task.delay(dataset_id, file_ids)
            return {"message": "Batch transcription queued", "task_id": task.id}
        else:
            # Synchronous batch transcription using service layer
            logger.info(f"Starting synchronous batch transcription for dataset {dataset_id}")
            service = TranscriptionService(db)
            result = service.transcribe_batch(dataset_id, file_ids)
            
            logger.info(f"Batch transcription completed for dataset {dataset_id}", extra={
                "files_processed": result.get("files_processed"),
                "success_count": result.get("success_count"),
                "error_count": result.get("error_count")
            })
            return result


@router.post("/files/{file_id}/retranscribe")
def retranscribe_audio(
    file_id: int,
    use_celery: bool = Query(False, description="Use Celery for async transcription (requires Redis)"),
    db: Session = Depends(get_db)
):
    """
    Clear existing transcription and re-transcribe an audio file.
    
    Useful for re-running transcription with updated models or settings.
    """
    with RequestLogger(f"Retranscribe file {file_id}", file_id=file_id, use_celery=use_celery):
        audio_file = db.query(AudioFile).filter(AudioFile.id == file_id).first()
        if not audio_file:
            raise HTTPException(status_code=404, detail="File not found")
        
        if use_celery:
            # Async via Celery
            logger.info(f"Queueing re-transcription for file {file_id} via Celery")
            # Clear existing transcription before queueing
            audio_file.whisper_transcript = None
            audio_file.corrected_transcript = None
            audio_file.whisper_language = None
            audio_file.whisper_confidence = None
            audio_file.status = TranscriptionStatus.TRANSCRIBING
            db.commit()
            
            task = transcribe_audio_task.delay(file_id)
            return {"message": "Re-transcription queued", "task_id": task.id}
        else:
            # Synchronous re-transcription using service layer
            logger.info(f"Starting synchronous re-transcription for file {file_id}")
            service = TranscriptionService(db)
            result = service.retranscribe(file_id)
            
            logger.info(f"Re-transcription completed for file {file_id}")
            return result
            audio_file.status = TranscriptionStatus.PENDING
            db.commit()
            raise HTTPException(status_code=500, detail=f"Re-transcription failed: {str(e)}")


# ==================== CELERY TASK STATUS ====================

@router.get("/../../tasks/{task_id}/status")
def get_task_status(task_id: str):
    """
    Get the status of a Celery task.
    
    Args:
        task_id: Celery task ID to check
        
    Returns:
        Task status with result (if completed) or error (if failed)
    """
    from backend.celery_app import celery_app
    
    result = celery_app.AsyncResult(task_id)
    
    response = {
        "task_id": task_id,
        "status": result.status,
        "ready": result.ready(),
    }
    
    if result.ready():
        if result.successful():
            response["result"] = result.result
        else:
            response["error"] = str(result.result)
    
    return response


# ==================== AUDIO FILE MANAGEMENT ====================

@router.get("/datasets/{dataset_id}/files")
def list_audio_files(
    dataset_id: int,
    status: Optional[TranscriptionStatus] = None,
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db)
):
    """
    List audio files in a dataset with pagination.
    
    Args:
        dataset_id: Dataset ID
        status: Optional status filter (PENDING, TRANSCRIBING, TRANSCRIBED, ANNOTATING, COMPLETED)
        limit: Maximum files per page (default: 50)
        offset: Number of files to skip (default: 0)
        
    Returns:
        Paginated files with totals and status counts
    """
    base_query = db.query(AudioFile).filter(AudioFile.dataset_id == dataset_id)
    
    # Get totals
    total = base_query.count()
    pending_count = base_query.filter(AudioFile.status == TranscriptionStatus.PENDING).count()
    completed_count = base_query.filter(AudioFile.status == TranscriptionStatus.COMPLETED).count()
    
    # Apply filter
    query = base_query
    if status:
        query = query.filter(AudioFile.status == status)
    
    files = query.order_by(AudioFile.created_at).offset(offset).limit(limit).all()
    
    # Convert to dicts for JSON serialization
    files_data = []
    for f in files:
        files_data.append({
            "id": f.id,
            "dataset_id": f.dataset_id,
            "filename": f.filename,
            "file_path": f.file_path,
            "file_size": f.file_size,
            "duration": f.duration,
            "whisper_transcript": f.whisper_transcript,
            "whisper_language": f.whisper_language,
            "whisper_confidence": f.whisper_confidence,
            "transcribed_at": f.transcribed_at.isoformat() if f.transcribed_at else None,
            "corrected_transcript": f.corrected_transcript,
            "status": f.status.value,
            "annotated_by": f.annotated_by,
            "annotated_at": f.annotated_at.isoformat() if f.annotated_at else None,
            "created_at": f.created_at.isoformat() if f.created_at else None,
        })
    
    return {
        "files": files_data,
        "total": total,
        "pending": pending_count,
        "completed": completed_count,
        "limit": limit,
        "offset": offset,
    }


@router.get("/files/{file_id}", response_model=AudioFileResponse)
def get_audio_file(file_id: int, db: Session = Depends(get_db)):
    """Get a specific audio file by ID."""
    audio_file = db.query(AudioFile).filter(AudioFile.id == file_id).first()
    if not audio_file:
        raise HTTPException(status_code=404, detail="File not found")
    return audio_file


@router.get("/files/{file_id}/audio")
def stream_audio(file_id: int, db: Session = Depends(get_db)):
    """
    Stream audio file for playback.
    
    Returns the physical audio file for browser playback.
    """
    audio_file = db.query(AudioFile).filter(AudioFile.id == file_id).first()
    if not audio_file:
        raise HTTPException(status_code=404, detail="File not found")
    
    if not os.path.exists(str(audio_file.file_path)):
        raise HTTPException(status_code=404, detail="Audio file not found on disk")
    
    return FileResponse(
        audio_file.file_path,
        media_type="audio/mpeg",
        filename=audio_file.filename
    )


@router.delete("/files/{file_id}")
def delete_audio_file(file_id: int, db: Session = Depends(get_db)):
    """
    Delete an audio file (both DB record and physical file).
    
    Args:
        file_id: Audio file ID to delete
        
    Returns:
        Success message
    """
    audio_file = db.query(AudioFile).filter(AudioFile.id == file_id).first()
    if not audio_file:
        raise HTTPException(status_code=404, detail="File not found")
    
    # Delete physical file if it exists
    if audio_file.file_path and os.path.exists(str(audio_file.file_path)):
        try:
            os.remove(audio_file.file_path)
        except OSError as e:
            # Log but don't fail if file deletion fails
            print(f"Warning: Could not delete file {audio_file.file_path}: {e}")
    
    # Delete from database
    db.delete(audio_file)
    db.commit()
    return {"message": "Audio file deleted"}


# ==================== AUDIO FUSING ====================

@router.post("/files/fuse")
def fuse_audio_files(
    file_ids: List[int] = Query(..., description="IDs of audio files to concatenate in order"),
    output_filename: Optional[str] = Query(None, description="Custom filename for the fused audio"),
    db: Session = Depends(get_db)
):
    """
    Fuse/concatenate multiple audio files into a single file.
    
    Useful for merging adjacent segments back together or creating
    longer audio clips from multiple sources.
    
    Requirements:
    - Minimum 2 files
    - All files must be from the same dataset
    - All files must exist on disk
    
    Args:
        file_ids: List of audio file IDs to concatenate (in order)
        output_filename: Optional custom filename (default: auto-generated)
        
    Returns:
        Fused file metadata with new file ID
    """
    with RequestLogger(f"Fuse {len(file_ids)} audio files",
                       file_ids=file_ids,
                       output_filename=output_filename):
        if len(file_ids) < 2:
            raise HTTPException(status_code=400, detail="Need at least 2 files to fuse")
        
        # Fetch all audio files in order
        audio_files = []
        for file_id in file_ids:
            audio_file = db.query(AudioFile).filter(AudioFile.id == file_id).first()
            if not audio_file:
                raise HTTPException(status_code=404, detail=f"File {file_id} not found")
            if not os.path.exists(str(audio_file.file_path)):
                raise HTTPException(status_code=404, detail=f"Audio file {file_id} not found on disk")
            audio_files.append(audio_file)
        
        # All files must be from the same dataset
        dataset_id = audio_files[0].dataset_id
        if not all(f.dataset_id == dataset_id for f in audio_files):
            raise HTTPException(status_code=400, detail="All files must be from the same dataset")
        
        try:
            from pydub import AudioSegment as PyDubAudioSegment
            
            logger.info(f"Fusing {len(audio_files)} audio files from dataset {dataset_id}")
            # Load and concatenate audio files
            combined = None
            for audio_file in audio_files:
                audio_segment = PyDubAudioSegment.from_file(str(audio_file.file_path))
                if combined is None:
                    combined = audio_segment
                else:
                    combined = combined + audio_segment
            
            # Generate output filename
            if not output_filename:
                output_filename = f"fused_{'_'.join([f.filename.split('.')[0] for f in audio_files[:3]])}{'_etc' if len(audio_files) > 3 else ''}.wav"
            
            # Ensure .wav extension
            if not output_filename.endswith('.wav'):
                output_filename += '.wav'
            
            # Save fused audio
            dataset_folder = os.path.join(AUDIO_DIR, str(dataset_id))
            output_path = os.path.join(dataset_folder, output_filename)
            combined.export(output_path, format="wav")
            
            # Create new AudioFile record
            new_audio_file = AudioFile(
                dataset_id=dataset_id,
                filename=output_filename,
                file_path=output_path,
                file_size=os.path.getsize(output_path),
                duration=len(combined) / 1000.0,  # Convert ms to seconds
                status=TranscriptionStatus.PENDING
            )
            db.add(new_audio_file)
            db.commit()
            db.refresh(new_audio_file)
            
            logger.info(f"Successfully fused {len(audio_files)} files into file ID {new_audio_file.id}", extra={
                "fused_file_id": new_audio_file.id,
                "duration": new_audio_file.duration,
                "file_size": new_audio_file.file_size
            })
            
            return {
                "message": f"Successfully fused {len(audio_files)} audio files",
                "fused_file_id": new_audio_file.id,
                "filename": output_filename,
                "duration": new_audio_file.duration,
                "file_size": new_audio_file.file_size
            }
            
        except Exception as e:
            logger.error(f"Failed to fuse audio files: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Failed to fuse audio files: {str(e)}")


# ==================== ANNOTATION ====================

@router.post("/files/{file_id}/annotate")
def annotate_transcript(
    file_id: int,
    data: TranscriptAnnotation,
    annotator: str = Query("anonymous"),
    db: Session = Depends(get_db)
):
    """
    Save corrected transcript for an audio file.
    
    Args:
        file_id: Audio file ID
        data: Annotation data (corrected_transcript)
        annotator: Name of annotator (default: anonymous)
        
    Returns:
        Success message
    """
    audio_file = db.query(AudioFile).filter(AudioFile.id == file_id).first()
    if not audio_file:
        raise HTTPException(status_code=404, detail="File not found")
    
    audio_file.corrected_transcript = data.corrected_transcript
    audio_file.status = TranscriptionStatus.COMPLETED
    audio_file.annotated_by = annotator
    audio_file.annotated_at = datetime.utcnow()
    db.commit()
    return {"message": "Annotation saved"}


@router.post("/files/{file_id}/status")
def update_file_status(
    file_id: int,
    status: TranscriptionStatus,
    db: Session = Depends(get_db)
):
    """
    Update audio file status.
    
    Args:
        file_id: Audio file ID
        status: New status to set
        
    Returns:
        Success message
    """
    audio_file = db.query(AudioFile).filter(AudioFile.id == file_id).first()
    if not audio_file:
        raise HTTPException(status_code=404, detail="File not found")
    
    audio_file.status = status
    db.commit()
    return {"message": f"Status updated to {status}"}


# ==================== DATA EXPORT ====================

@router.get("/datasets/{dataset_id}/export")
def export_asr_dataset(
    dataset_id: int,
    format: str = Query("csv", enum=["csv", "jsonl"]),
    db: Session = Depends(get_db)
):
    """
    Export ASR dataset as CSV or JSONL.
    
    Exports: id, filename, whisper_transcript, corrected_transcript, status, annotated_by
    
    Args:
        dataset_id: Dataset to export
        format: Export format ('csv' or 'jsonl')
        
    Returns:
        Streaming response with file download
    """
    dataset = db.query(ASRDataset).filter(ASRDataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    
    files = db.query(AudioFile).filter(AudioFile.dataset_id == dataset_id).all()
    
    if format == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["id", "filename", "whisper_transcript", "corrected_transcript", "status", "annotated_by"])
        for f in files:
            writer.writerow([f.id, f.filename, f.whisper_transcript, f.corrected_transcript, f.status.value, f.annotated_by])
        
        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename={dataset.name}_transcripts.csv"}
        )
    else:
        lines = []
        for f in files:
            lines.append(json.dumps({
                "id": f.id,
                "filename": f.filename,
                "whisper_transcript": f.whisper_transcript,
                "corrected_transcript": f.corrected_transcript,
                "status": f.status.value,
                "annotated_by": f.annotated_by,
            }, ensure_ascii=False))
        
        return StreamingResponse(
            iter(["\n".join(lines)]),
            media_type="application/jsonl",
            headers={"Content-Disposition": f"attachment; filename={dataset.name}_transcripts.jsonl"}
        )


# ==================== AUDIO SEGMENTATION ====================

@router.post("/files/{file_id}/segment")
def segment_single_file(
    file_id: int,
    chunk_length: int = Query(30, ge=5, le=120, description="Max chunk length in seconds"),
    use_vad: bool = Query(True, description="Use VAD (voice-only) or fixed-length cutting"),
    use_celery: bool = Query(False, description="Run segmentation in background via Celery"),
    db: Session = Depends(get_db)
):
    """
    Segment a single audio file into chunks.
    
    Modes:
    - VAD (use_vad=True): Silero VAD detects speech, max chunk_length per segment
    - Fixed-length (use_vad=False): Equal intervals of chunk_length seconds
    
    Args:
        file_id: Audio file ID to segment
        chunk_length: Maximum chunk length in seconds (5-120)
        use_vad: True for voice activity detection, False for fixed-length cuts
        use_celery: Whether to run in background via Celery
        
    Returns:
        Segmentation summary with created chunk IDs
    """
    from backend.audio_segment import segment_audio
    from backend.tasks import segment_audio_task
    
    audio_file = db.query(AudioFile).filter(AudioFile.id == file_id).first()
    if not audio_file:
        raise HTTPException(status_code=404, detail="File not found")
    
    if not os.path.exists(str(audio_file.file_path)):
        raise HTTPException(status_code=404, detail="Audio file not found on disk")
    
    if use_celery:
        # Queue task for background processing
        task = segment_audio_task.delay(file_id, chunk_length, use_vad)
        return {
            "message": "Segmentation queued",
            "task_id": task.id,
            "file_id": file_id,
            "chunk_length": chunk_length,
            "use_vad": use_vad
        }
    
    # Run segmentation synchronously
    try:
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
            "message": f"Segmented into {result.total_chunks} chunks",
            "file_id": file_id,
            "source_filename": audio_file.filename,
            "output_folder": result.output_folder,
            "chunks_created": result.total_chunks,
            "chunk_ids": chunk_ids
        }
        
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Segmentation failed: {str(e)}")


@router.post("/datasets/{dataset_id}/segment-all")
def segment_all_files(
    dataset_id: int,
    chunk_length: int = Query(30, ge=5, le=120, description="Max chunk length in seconds"),
    use_vad: bool = Query(True, description="Use VAD (voice-only) or fixed-length cutting"),
    use_celery: bool = Query(True, description="Run segmentation in background via Celery"),
    db: Session = Depends(get_db)
):
    """
    Segment all audio files in a dataset.
    
    Files already containing '_chunk' in filename will be skipped.
    
    Args:
        dataset_id: Dataset ID
        chunk_length: Maximum chunk length in seconds (5-120)
        use_vad: True for voice activity detection, False for fixed-length cuts
        use_celery: Whether to run in background via Celery
        
    Returns:
        Batch segmentation summary
    """
    from backend.audio_segment import segment_audio
    from backend.tasks import segment_audio_task, batch_segment_task
    
    dataset = db.query(ASRDataset).filter(ASRDataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    
    # Get files that are not already chunks
    audio_files = db.query(AudioFile).filter(
        AudioFile.dataset_id == dataset_id,
        ~AudioFile.filename.like("%_chunk%")
    ).all()
    
    if not audio_files:
        return {
            "message": "No files to segment (all may already be chunks)",
            "dataset_id": dataset_id,
            "files_found": 0
        }
    
    if use_celery:
        # Queue batch task
        task = batch_segment_task.delay(dataset_id, chunk_length, use_vad)
        return {
            "message": f"Batch segmentation queued for {len(audio_files)} files",
            "task_id": task.id,
            "dataset_id": dataset_id,
            "files_queued": len(audio_files),
            "chunk_length": chunk_length,
            "use_vad": use_vad
        }
    
    # Run synchronously for each file
    results = []
    total_chunks = 0
    
    for audio_file in audio_files:
        if not os.path.exists(str(audio_file.file_path)):
            results.append({
                "file_id": audio_file.id,
                "filename": audio_file.filename,
                "status": "error",
                "message": "File not found on disk"
            })
            continue
        
        try:
            result = segment_audio(
                audio_file.file_path,
                chunk_length=chunk_length,
                output_base=os.path.dirname(audio_file.file_path),
                use_vad=use_vad
            )
            
            # Create chunk records
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
            
            total_chunks += result.total_chunks
            results.append({
                "file_id": audio_file.id,
                "filename": audio_file.filename,
                "status": "success",
                "chunks_created": result.total_chunks,
                "chunk_ids": chunk_ids
            })
            
        except Exception as e:
            results.append({
                "file_id": audio_file.id,
                "filename": audio_file.filename,
                "status": "error",
                "message": str(e)
            })
    
    db.commit()
    
    success_count = sum(1 for r in results if r["status"] == "success")
    
    return {
        "message": f"Segmented {success_count}/{len(audio_files)} files into {total_chunks} total chunks",
        "dataset_id": dataset_id,
        "files_processed": len(audio_files),
        "success_count": success_count,
        "total_chunks_created": total_chunks,
        "results": results
    }
