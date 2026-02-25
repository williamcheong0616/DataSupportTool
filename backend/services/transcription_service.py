"""
Transcription service - Business logic for audio transcription.

Decouples transcription logic from API routes for better testability
and maintainability. Supports Whisper and Qwen3-ASR engines.
"""

import os
import logging
from typing import Dict, List, Optional, Literal
from datetime import datetime, timezone
from sqlalchemy.orm import Session

from backend.models import AudioFile, TranscriptionStatus
from backend.whisper import transcribe_audio_simple
from backend.utils.logger import RequestLogger, log_function_call

logger = logging.getLogger("datasupporttool")

# Valid ASR engine choices
ASREngine = Literal["whisper", "qwen3"]


class TranscriptionService:
    """
    Service for managing audio transcription operations.
    
    Handles:
    - Single file transcription (Whisper or Qwen3)
    - Batch transcription
    - Re-transcription
    - Status management
    """
    
    def __init__(self, db: Session):
        self.db = db
    
    def _do_transcribe(self, audio_path: str, engine: ASREngine = "whisper") -> Dict:
        """
        Run transcription using the specified engine.
        
        Args:
            audio_path: Path to audio file
            engine: ASR engine to use ('whisper' or 'qwen3')
            
        Returns:
            Dict with 'text', 'language', 'confidence', 'backend' keys
        """
        if engine == "qwen3":
            from backend.qwen3_asr import transcribe_audio_qwen3_simple
            return transcribe_audio_qwen3_simple(audio_path)
        else:
            return transcribe_audio_simple(audio_path)
    
    def _save_result(self, audio_file: AudioFile, result: Dict, engine: ASREngine = "whisper"):
        """
        Save transcription result to the appropriate model columns.
        
        Args:
            audio_file: AudioFile model instance
            result: Transcription result dict
            engine: Which engine produced this result
        """
        if engine == "qwen3":
            audio_file.qwen3_transcript = result.get("text", "")
            audio_file.qwen3_language = result.get("language")
            audio_file.qwen3_confidence = result.get("confidence")
            audio_file.qwen3_transcribed_at = datetime.now(timezone.utc)
        else:
            audio_file.whisper_transcript = result.get("text", "")
            audio_file.whisper_language = result.get("language")
            audio_file.whisper_confidence = result.get("confidence")
            audio_file.transcribed_at = datetime.now(timezone.utc)
    
    @log_function_call
    def transcribe_single(self, file_id: int, engine: ASREngine = "whisper") -> Dict:
        """
        Transcribe a single audio file.
        
        Args:
            file_id: Audio file ID to transcribe
            engine: ASR engine to use ('whisper' or 'qwen3')
            
        Returns:
            Transcription result with metadata
            
        Raises:
            ValueError: If file not found or file doesn't exist on disk
        """
        with RequestLogger("transcribe_single", file_id=file_id, engine=engine) as log:
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
                logger.info(f"Starting {engine} transcription for file {file_id}: {audio_file.filename}")
                result = self._do_transcribe(audio_file.file_path, engine)
                
                # Save results to appropriate columns
                self._save_result(audio_file, result, engine)
                
                # Only update overall status if not already transcribed by other engine
                if audio_file.status == TranscriptionStatus.TRANSCRIBING:
                    audio_file.status = TranscriptionStatus.TRANSCRIBED
                self.db.commit()
                
                # Determine which fields to return based on engine
                transcript = result.get("text", "")
                language = result.get("language")
                confidence = result.get("confidence")
                
                log.success(
                    "Transcription completed",
                    engine=engine,
                    language=language,
                    confidence=confidence,
                    text_length=len(transcript)
                )
                
                return {
                    "status": "success",
                    "file_id": file_id,
                    "filename": audio_file.filename,
                    "transcript": transcript,
                    "language": language,
                    "confidence": confidence,
                    "backend": result.get("backend", engine),
                    "engine": engine,
                }
                
            except Exception as e:
                # Rollback on error
                audio_file.status = TranscriptionStatus.PENDING
                self.db.commit()
                logger.error(f"Transcription failed for file {file_id} (engine={engine}): {str(e)}")
                raise
    
    @log_function_call
    def transcribe_batch(
        self,
        dataset_id: int,
        file_ids: Optional[List[int]] = None,
        engine: ASREngine = "whisper",
    ) -> Dict:
        """
        Transcribe multiple files in a dataset.
        
        Args:
            dataset_id: Dataset ID
            file_ids: Optional list of specific file IDs to transcribe
            engine: ASR engine to use ('whisper' or 'qwen3')
            
        Returns:
            Batch transcription summary with results
        """
        with RequestLogger("transcribe_batch", dataset_id=dataset_id, engine=engine) as log:
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
            
            logger.info(f"Starting batch {engine} transcription for {len(audio_files)} files")
            results = []
            success_count = 0
            error_count = 0
            
            # Process each file
            for audio_file in audio_files:
                try:
                    result = self.transcribe_single(audio_file.id, engine=engine)
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
                engine=engine,
                total=len(audio_files),
                success=success_count,
                errors=error_count
            )
            
            return {
                "status": "completed",
                "files_processed": len(audio_files),
                "success_count": success_count,
                "error_count": error_count,
                "engine": engine,
                "results": results
            }
    
    @log_function_call
    def retranscribe(self, file_id: int, engine: ASREngine = "whisper") -> Dict:
        """
        Clear existing transcription and re-transcribe.
        
        Args:
            file_id: Audio file ID to re-transcribe
            engine: ASR engine to use ('whisper' or 'qwen3')
            
        Returns:
            Re-transcription result
        """
        with RequestLogger("retranscribe", file_id=file_id, engine=engine) as log:
            audio_file = self.db.query(AudioFile).filter(AudioFile.id == file_id).first()
            if not audio_file:
                raise ValueError(f"Audio file {file_id} not found")
            
            # Clear existing transcription for the specified engine
            if engine == "qwen3":
                audio_file.qwen3_transcript = None
                audio_file.qwen3_language = None
                audio_file.qwen3_confidence = None
                audio_file.qwen3_transcribed_at = None
            else:
                audio_file.whisper_transcript = None
                audio_file.corrected_transcript = None
                audio_file.whisper_language = None
                audio_file.whisper_confidence = None
                audio_file.transcribed_at = None
            self.db.commit()
            
            log.success(f"Cleared existing {engine} transcription")
            
            # Re-transcribe
            return self.transcribe_single(file_id, engine=engine)
