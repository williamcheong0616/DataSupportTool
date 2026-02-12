"""
Health check and statistics endpoints.

Provides system health monitoring and annotation statistics across
text and ASR datasets.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import (
    TextDataset, TextRecord, ASRDataset, AudioFile, TranscriptionStatus
)
from backend.schemas import AnnotationStats

# Create router with /api prefix
router = APIRouter(prefix="/api", tags=["health", "stats"])


@router.get("/health")
def health_check():
    """
    Health check endpoint.
    
    Returns:
        dict: Status indicator
        
    Example:
        GET /api/health -> {"status": "healthy"}
    """
    return {"status": "healthy"}


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
        
    Example:
        GET /api/stats -> {
            "text_datasets": 5,
            "text_records": 100,
            "text_annotated": 75,
            "asr_datasets": 3,
            "audio_files": 50,
            "asr_completed": 40
        }
    """
    text_records = db.query(TextRecord).count()
    text_annotated = db.query(TextRecord).filter(
        TextRecord.is_annotated == True
    ).count()
    audio_files = db.query(AudioFile).count()
    asr_completed = db.query(AudioFile).filter(
        AudioFile.status == TranscriptionStatus.COMPLETED
    ).count()
    
    return {
        "text_datasets": db.query(TextDataset).count(),
        "text_records": text_records,
        "text_annotated": text_annotated,
        "asr_datasets": db.query(ASRDataset).count(),
        "audio_files": audio_files,
        "asr_completed": asr_completed,
    }
