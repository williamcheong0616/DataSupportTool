"""
Transcription service - Business logic for audio transcription.

Decouples transcription logic from API routes for better testability
and maintainability.
"""

import os
import logging
from typing import Dict, List, Optional
from datetime import datetime
from sqlalchemy.orm import Session

from backend.models import AudioFile, TranscriptionStatus
from backend.whisper import transcribe_audio_simple
from backend.utils.logger import RequestLogger, log_function_call

logger = logging.getLogger("datasupporttool")


class TranscriptionService:
    """
    Service for managing audio transcription operations.
    
    Handles:
    - Single file transcription
    - Batch transcription
    - Re-transcription
    - Status management
    """
    
    def __init__(self, db: Session):
        self.db = db
    
    @log_function_call
    def transcribe_single(self, file_id: int) -> Dict:
        """
        Transcribe a single audio file.
        
        Args:
            file_id: Audio file ID to transcribe
            
        Returns:
            Transcription result with metadata
            
        Raises:
            ValueError: If file not found or file doesn't exist on disk
        """
        with RequestLogger("transcribe_single", file_id=file_id) as log:
            # Fetch audio file
            audio_file = self.db.query(AudioFile).filter(AudioFile.id == file_id).first()
            if not audio_file:
                raise ValueError(f"Audio file {file_id} not found")
            
            if not os.path.exists(audio_file.file_path):
                raise ValueError(f"Audio file {file_id} not found on disk")
            
            # Update status
            audio_file.status = TranscriptionStatus.TRANSCRIBING
            self.db.commit()
            log.success("Status updated to TRANSCRIBING")
            
            try:
                # Perform transcription
                logger.info(f"Starting Whisper transcription for file {file_id}: {audio_file.filename}")
                result = transcribe_audio_simple(audio_file.file_path)
                
                # Save results
                audio_file.whisper_transcript = result.get("text", "")
                audio_file.whisper_language = result.get("language")
                audio_file.whisper_confidence = result.get("confidence")
                audio_file.status = TranscriptionStatus.TRANSCRIBED
                audio_file.transcribed_at = datetime.utcnow()
                self.db.commit()
                
                log.success(
                    "Transcription completed",
                    language=audio_file.whisper_language,
                    confidence=audio_file.whisper_confidence,
                    text_length=len(audio_file.whisper_transcript or "")
                )
                
                return {
                    "status": "success",
                    "file_id": file_id,
                    "filename": audio_file.filename,
                    "transcript": audio_file.whisper_transcript,
                    "language": audio_file.whisper_language,
                    "confidence": audio_file.whisper_confidence,
                    "backend": result.get("backend")
                }
                
            except Exception as e:
                # Rollback on error
                audio_file.status = TranscriptionStatus.PENDING
                self.db.commit()
                logger.error(f"Transcription failed for file {file_id}: {str(e)}")
                raise
    
    @log_function_call
    def transcribe_batch(
        self,
        dataset_id: int,
        file_ids: Optional[List[int]] = None
    ) -> Dict:
        """
        Transcribe multiple files in a dataset.
        
        Args:
            dataset_id: Dataset ID
            file_ids: Optional list of specific file IDs to transcribe
            
        Returns:
            Batch transcription summary with results
        """
        with RequestLogger("transcribe_batch", dataset_id=dataset_id) as log:
            # Get files to transcribe
            query = self.db.query(AudioFile).filter(
                AudioFile.dataset_id == dataset_id,
                AudioFile.status == TranscriptionStatus.PENDING
            )
            if file_ids:
                query = query.filter(AudioFile.id.in_(file_ids))
            
            audio_files = query.all()
            
            if not audio_files:
                log.warning("No pending files found")
                return {
                    "status": "completed",
                    "message": "No pending files to transcribe",
                    "files_processed": 0
                }
            
            logger.info(f"Starting batch transcription for {len(audio_files)} files")
            results = []
            success_count = 0
            error_count = 0
            
            # Process each file
            for audio_file in audio_files:
                try:
                    result = self.transcribe_single(audio_file.id)
                    results.append({
                        "file_id": audio_file.id,
                        "status": "success",
                        "language": result["language"]
                    })
                    success_count += 1
                    
                except Exception as e:
                    results.append({
                        "file_id": audio_file.id,
                        "status": "error",
                        "message": str(e)
                    })
                    error_count += 1
            
            log.success(
                "Batch transcription completed",
                total=len(audio_files),
                success=success_count,
                errors=error_count
            )
            
            return {
                "status": "completed",
                "files_processed": len(audio_files),
                "success_count": success_count,
                "error_count": error_count,
                "results": results
            }
    
    @log_function_call
    def retranscribe(self, file_id: int) -> Dict:
        """
        Clear existing transcription and re-transcribe.
        
        Args:
            file_id: Audio file ID to re-transcribe
            
        Returns:
            Re-transcription result
        """
        with RequestLogger("retranscribe", file_id=file_id) as log:
            audio_file = self.db.query(AudioFile).filter(AudioFile.id == file_id).first()
            if not audio_file:
                raise ValueError(f"Audio file {file_id} not found")
            
            # Clear existing transcription
            audio_file.whisper_transcript = None
            audio_file.corrected_transcript = None
            audio_file.whisper_language = None
            audio_file.whisper_confidence = None
            self.db.commit()
            
            log.success("Cleared existing transcription")
            
            # Re-transcribe
            return self.transcribe_single(file_id)
