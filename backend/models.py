"""Database models for the data pipeline."""
from datetime import datetime
from enum import Enum as PyEnum
from sqlalchemy import Column, Integer, String, Text, Float, DateTime, ForeignKey, Enum, JSON, Boolean
from sqlalchemy.orm import relationship

from backend.database import Base


class PipelineStatus(PyEnum):
    """Status of a pipeline run."""
    PENDING = "pending"
    COLLECTING = "collecting"
    PREPROCESSING = "preprocessing"
    VALIDATING = "validating"
    HUMAN_REVIEW = "human_review"
    COMPLETED = "completed"
    FAILED = "failed"
    ITERATING = "iterating"


class ValidationResult(PyEnum):
    """Result of validation."""
    PENDING = "pending"
    PASSED = "passed"
    FAILED = "failed"
    NEEDS_REVIEW = "needs_review"


class Dataset(Base):
    """Represents a dataset in the pipeline."""
    __tablename__ = "datasets"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    source_type = Column(String(50), nullable=False)  # upload, api, manual
    file_path = Column(String(500), nullable=True)
    record_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    pipeline_runs = relationship("PipelineRun", back_populates="dataset")
    data_records = relationship("DataRecord", back_populates="dataset")


class DataRecord(Base):
    """Individual data record within a dataset."""
    __tablename__ = "data_records"
    
    id = Column(Integer, primary_key=True, index=True)
    dataset_id = Column(Integer, ForeignKey("datasets.id"), nullable=False)
    input_text = Column(Text, nullable=False)
    expected_output = Column(Text, nullable=True)
    record_metadata = Column(JSON, nullable=True)
    is_preprocessed = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    dataset = relationship("Dataset", back_populates="data_records")
    model_responses = relationship("ModelResponse", back_populates="data_record")


class PipelineRun(Base):
    """Represents a single run through the pipeline."""
    __tablename__ = "pipeline_runs"
    
    id = Column(Integer, primary_key=True, index=True)
    dataset_id = Column(Integer, ForeignKey("datasets.id"), nullable=False)
    status = Column(Enum(PipelineStatus), default=PipelineStatus.PENDING)
    iteration = Column(Integer, default=1)
    config = Column(JSON, nullable=True)  # Pipeline configuration
    started_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)
    error_message = Column(Text, nullable=True)
    
    # Relationships
    dataset = relationship("Dataset", back_populates="pipeline_runs")
    validations = relationship("ValidationRecord", back_populates="pipeline_run")


class ModelResponse(Base):
    """Response from a fine-tuned model."""
    __tablename__ = "model_responses"
    
    id = Column(Integer, primary_key=True, index=True)
    data_record_id = Column(Integer, ForeignKey("data_records.id"), nullable=False)
    pipeline_run_id = Column(Integer, ForeignKey("pipeline_runs.id"), nullable=False)
    model_name = Column(String(255), nullable=False)
    response_text = Column(Text, nullable=False)
    latency_ms = Column(Float, nullable=True)
    tokens_used = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    data_record = relationship("DataRecord", back_populates="model_responses")
    validations = relationship("ValidationRecord", back_populates="model_response")


class ValidationRecord(Base):
    """Validation result for a model response."""
    __tablename__ = "validation_records"
    
    id = Column(Integer, primary_key=True, index=True)
    model_response_id = Column(Integer, ForeignKey("model_responses.id"), nullable=False)
    pipeline_run_id = Column(Integer, ForeignKey("pipeline_runs.id"), nullable=False)
    
    # Automated metrics
    result = Column(Enum(ValidationResult), default=ValidationResult.PENDING)
    accuracy_score = Column(Float, nullable=True)
    bleu_score = Column(Float, nullable=True)
    rouge_score = Column(Float, nullable=True)
    custom_metrics = Column(JSON, nullable=True)
    
    # Human review
    human_reviewed = Column(Boolean, default=False)
    human_score = Column(Float, nullable=True)  # 0-1 scale
    human_feedback = Column(Text, nullable=True)
    reviewer_id = Column(String(100), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    model_response = relationship("ModelResponse", back_populates="validations")
    pipeline_run = relationship("PipelineRun", back_populates="validations")
