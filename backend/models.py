"""Database models for Text and ASR Annotation."""
from datetime import datetime
from typing import Optional
from sqlalchemy import (
    Column, Integer, String, Text, Boolean, Float, DateTime, 
    ForeignKey, JSON, Enum as SQLEnum
)
from sqlalchemy.orm import relationship, declarative_base
import enum

Base = declarative_base()


# === Text Annotation Models ===

class TaskType(str, enum.Enum):
    """Type of annotation task."""
    BAHASA_ROJAK_IDENTIFICATION = "bahasa_rojak_identification"  # Yes/No
    BAHASA_ROJAK_CLASSIFICATION = "bahasa_rojak_classification"  # Categories
    TEXT_MODIFICATION = "text_modification"  # Subject/Context adding
    QUESTION_GENERATION = "question_generation"  # 3 questions


class TextDataset(Base):
    """Dataset for text annotation."""
    __tablename__ = "text_datasets"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    task_type = Column(SQLEnum(TaskType), nullable=False)
    column_mapping = Column(JSON, nullable=True)  # Maps original headers to internal fields
    original_headers = Column(JSON, nullable=True)  # Original CSV/JSON headers
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    records = relationship("TextRecord", back_populates="dataset", cascade="all, delete-orphan")


class TextRecord(Base):
    """Individual text record for annotation."""
    __tablename__ = "text_records"
    
    id = Column(Integer, primary_key=True, index=True)
    dataset_id = Column(Integer, ForeignKey("text_datasets.id"), nullable=False)
    
    # Original data
    original_text = Column(Text, nullable=False)
    raw_data = Column(JSON, nullable=True)  # Store all original columns
    
    # Annotation fields - Bahasa Rojak Identification
    is_bahasa_rojak = Column(Boolean, nullable=True)  # Yes/No
    
    # Annotation fields - Classification
    classification_label = Column(String(255), nullable=True)
    
    # Annotation fields - Text Modification
    modified_text = Column(Text, nullable=True)
    subject_added = Column(Text, nullable=True)
    context_added = Column(Text, nullable=True)
    
    # Annotation fields - Question Generation
    question_1 = Column(Text, nullable=True)
    question_2 = Column(Text, nullable=True)
    question_3 = Column(Text, nullable=True)
    
    # Status
    is_annotated = Column(Boolean, default=False)
    annotated_by = Column(String(255), nullable=True)
    annotated_at = Column(DateTime, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    dataset = relationship("TextDataset", back_populates="records")


# === ASR Annotation Models ===

class ASRDataset(Base):
    """Dataset for ASR audio annotation."""
    __tablename__ = "asr_datasets"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    audio_files = relationship("AudioFile", back_populates="dataset", cascade="all, delete-orphan")


class TranscriptionStatus(str, enum.Enum):
    """Status of audio transcription."""
    PENDING = "pending"  # Not yet transcribed
    TRANSCRIBING = "transcribing"  # Whisper processing
    TRANSCRIBED = "transcribed"  # Whisper done, awaiting annotation
    ANNOTATING = "annotating"  # User is editing
    COMPLETED = "completed"  # Annotation done


class AudioFile(Base):
    """Audio file for ASR annotation."""
    __tablename__ = "audio_files"
    
    id = Column(Integer, primary_key=True, index=True)
    dataset_id = Column(Integer, ForeignKey("asr_datasets.id"), nullable=False)
    
    # File info
    filename = Column(String(512), nullable=False)
    file_path = Column(String(1024), nullable=False)
    file_size = Column(Integer, nullable=True)  # bytes
    duration = Column(Float, nullable=True)  # seconds
    
    # Whisper transcription
    whisper_transcript = Column(Text, nullable=True)
    whisper_language = Column(String(50), nullable=True)
    whisper_confidence = Column(Float, nullable=True)
    transcribed_at = Column(DateTime, nullable=True)
    
    # Annotated transcription
    corrected_transcript = Column(Text, nullable=True)
    
    # Status
    status = Column(SQLEnum(TranscriptionStatus), default=TranscriptionStatus.PENDING)
    annotated_by = Column(String(255), nullable=True)
    annotated_at = Column(DateTime, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    dataset = relationship("ASRDataset", back_populates="audio_files")
