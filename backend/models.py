"""Database models for Text and ASR Annotation."""
from datetime import datetime, timezone
from typing import Optional
import enum
from sqlalchemy import (
    Column, Integer, String, Text, Boolean, Float, DateTime, 
    ForeignKey, JSON, Enum as SQLEnum
)
from sqlalchemy.orm import relationship, declarative_base
from backend.enums import TaskType, TranscriptionStatus

Base = declarative_base()




class TextDataset(Base):
    """Dataset for text annotation."""
    __tablename__ = "text_datasets"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    task_type = Column(SQLEnum(TaskType), nullable=False, default=TaskType.GENERAL)
    column_mapping = Column(JSON, nullable=True)  # Maps original headers to internal fields
    original_headers = Column(JSON, nullable=True)  # Original CSV/JSON headers
    created_by = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    
    # Relationships
    records = relationship("TextRecord", back_populates="dataset", cascade="all, delete-orphan")
    br_pipeline_runs = relationship("BRPipelineRun", back_populates="dataset", cascade="all, delete-orphan", passive_deletes=True)


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
    
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    
    # Relationships
    dataset = relationship("TextDataset", back_populates="records")
    br_record_stages = relationship("BRRecordStage", back_populates="text_record", cascade="all, delete-orphan", passive_deletes=True)


# === ASR Annotation Models ===

class ASRDataset(Base):
    """Dataset for ASR audio annotation."""
    __tablename__ = "asr_datasets"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    created_by = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    
    # Relationships
    audio_files = relationship("AudioFile", back_populates="dataset", cascade="all, delete-orphan")




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
    
    # Qwen3 transcription
    qwen3_transcript = Column(Text, nullable=True)
    qwen3_language = Column(String(50), nullable=True)
    qwen3_confidence = Column(Float, nullable=True)
    qwen3_transcribed_at = Column(DateTime, nullable=True)
    
    # Annotated transcription
    corrected_transcript = Column(Text, nullable=True)
    
    # Status
    status = Column(SQLEnum(TranscriptionStatus), default=TranscriptionStatus.PENDING)
    annotated_by = Column(String(255), nullable=True)
    annotated_at = Column(DateTime, nullable=True)
    
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    
    # Relationships
    dataset = relationship("ASRDataset", back_populates="audio_files")


# === Pipeline Models (for orchestration) ===

class PipelineStatus(str, enum.Enum):
    """Status of a pipeline run."""
    PENDING = "pending"
    COLLECTING = "collecting"
    PREPROCESSING = "preprocessing"
    PROCESSING = "processing"
    VALIDATING = "validating"
    COMPLETED = "completed"
    FAILED = "failed"
    AWAITING_REVIEW = "awaiting_review"


class ValidationResult(str, enum.Enum):
    """Result of validation."""
    PASSED = "passed"
    FAILED = "failed"
    NEEDS_REVIEW = "needs_review"


class Dataset(Base):
    """Generic dataset for pipeline processing."""
    __tablename__ = "pipeline_datasets"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    source_type = Column(String(100), nullable=True)  # text, asr, etc.
    config = Column(JSON, nullable=True)
    created_by = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    
    # Relationships
    records = relationship("DataRecord", back_populates="dataset", cascade="all, delete-orphan")
    pipeline_runs = relationship("PipelineRun", back_populates="dataset", cascade="all, delete-orphan")


class DataRecord(Base):
    """Generic data record for pipeline processing."""
    __tablename__ = "pipeline_records"
    
    id = Column(Integer, primary_key=True, index=True)
    dataset_id = Column(Integer, ForeignKey("pipeline_datasets.id"), nullable=False)
    
    # Input/Output
    input_text = Column(Text, nullable=False)
    expected_output = Column(Text, nullable=True)
    
    # Processing state
    is_preprocessed = Column(Boolean, default=False)
    preprocessed_text = Column(Text, nullable=True)
    
    # Extra data
    record_metadata = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    
    # Relationships
    dataset = relationship("Dataset", back_populates="records")
    model_responses = relationship("ModelResponse", back_populates="record", cascade="all, delete-orphan")
    validation_records = relationship("ValidationRecord", back_populates="record", cascade="all, delete-orphan")


class PipelineRun(Base):
    """Tracks a single pipeline execution."""
    __tablename__ = "pipeline_runs"
    
    id = Column(Integer, primary_key=True, index=True)
    dataset_id = Column(Integer, ForeignKey("pipeline_datasets.id"), nullable=False)
    
    # Status tracking
    status = Column(SQLEnum(PipelineStatus), default=PipelineStatus.PENDING)
    current_iteration = Column(Integer, default=0)
    max_iterations = Column(Integer, default=3)
    
    # Configuration
    config = Column(JSON, nullable=True)
    
    # Results
    metrics = Column(JSON, nullable=True)
    error_message = Column(Text, nullable=True)
    
    # Timestamps
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    
    # Relationships
    dataset = relationship("Dataset", back_populates="pipeline_runs")
    model_responses = relationship("ModelResponse", back_populates="pipeline_run", cascade="all, delete-orphan")


class ModelResponse(Base):
    """Stores model-generated responses."""
    __tablename__ = "model_responses"
    
    id = Column(Integer, primary_key=True, index=True)
    record_id = Column(Integer, ForeignKey("pipeline_records.id"), nullable=False)
    pipeline_run_id = Column(Integer, ForeignKey("pipeline_runs.id"), nullable=False)
    
    # Response data
    response_text = Column(Text, nullable=False)
    model_name = Column(String(255), nullable=True)
    iteration = Column(Integer, default=1)
    
    # Metadata
    latency_ms = Column(Integer, nullable=True)
    token_count = Column(Integer, nullable=True)
    raw_response = Column(JSON, nullable=True)
    
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    
    # Relationships
    record = relationship("DataRecord", back_populates="model_responses")
    pipeline_run = relationship("PipelineRun", back_populates="model_responses")
    validation_records = relationship("ValidationRecord", back_populates="model_response", cascade="all, delete-orphan")


class ValidationRecord(Base):
    """Stores validation results for responses."""
    __tablename__ = "validation_records"
    
    id = Column(Integer, primary_key=True, index=True)
    record_id = Column(Integer, ForeignKey("pipeline_records.id"), nullable=False)
    model_response_id = Column(Integer, ForeignKey("model_responses.id"), nullable=False)
    
    # Validation outcome
    result = Column(SQLEnum(ValidationResult), nullable=False)
    score = Column(Float, nullable=True)
    
    # Details
    metrics = Column(JSON, nullable=True)
    failure_reasons = Column(JSON, nullable=True)
    
    # Human review
    human_reviewed = Column(Boolean, default=False)
    human_decision = Column(String(50), nullable=True)
    reviewer = Column(String(255), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    
    # Relationships
    record = relationship("DataRecord", back_populates="validation_records")
    model_response = relationship("ModelResponse", back_populates="validation_records")
