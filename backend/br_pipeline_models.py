"""
Bahasa Rojak Pipeline Models
Tracks the automated BR detection and question generation pipeline
"""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, Boolean, Float, DateTime, ForeignKey, JSON, Enum as SQLEnum
from sqlalchemy.orm import relationship
import enum
from backend.models import Base


class BRPipelineStage(str, enum.Enum):
    """Stages in the BR pipeline."""
    PENDING = "pending"
    BR_DETECTION = "br_detection"  # Automated: Check if text is Bahasa Rojak
    TEXT_RESTRUCTURE = "text_restructure"  # Automated: Consolidate MCQ text
    QUESTION_GENERATION = "question_generation"  # Automated: Generate 3 questions
    HUMAN_VALIDATION = "human_validation"  # Manual: Human picks 1 of 3 questions
    MODEL_RESPONSE = "model_response"  # Automated: 3 models generate responses
    COMPLETED = "completed"
    FAILED = "failed"


class BRPipelineRun(Base):
    """Tracks a full pipeline run for a text dataset."""
    __tablename__ = "br_pipeline_runs"
    
    id = Column(Integer, primary_key=True, index=True)
    dataset_id = Column(Integer, ForeignKey("text_datasets.id"), nullable=False)
    
    # Pipeline progress
    total_records = Column(Integer, default=0)
    processed_records = Column(Integer, default=0)
    pending_validation = Column(Integer, default=0)
    
    # Status
    current_stage = Column(SQLEnum(BRPipelineStage), default=BRPipelineStage.PENDING)
    status = Column(String(50), default="pending")  # pending, running, completed, failed
    error_message = Column(Text, nullable=True)
    
    # Timestamps
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    record_stages = relationship("BRRecordStage", back_populates="pipeline_run", cascade="all, delete-orphan")


class BRRecordStage(Base):
    """Tracks pipeline stage for each individual text record."""
    __tablename__ = "br_record_stages"
    
    id = Column(Integer, primary_key=True, index=True)
    pipeline_run_id = Column(Integer, ForeignKey("br_pipeline_runs.id"), nullable=False)
    text_record_id = Column(Integer, ForeignKey("text_records.id"), nullable=False)
    
    # Current state
    current_stage = Column(SQLEnum(BRPipelineStage), default=BRPipelineStage.PENDING)
    
    # Stage 1: BR Detection
    is_bahasa_rojak = Column(Boolean, nullable=True)
    br_confidence = Column(Float, nullable=True)
    detected_language = Column(String(100), nullable=True)  # Detected language(s) in text
    br_detected_at = Column(DateTime, nullable=True)
    
    # Stage 2: Text Restructuring
    restructured_text = Column(Text, nullable=True)
    skip_restructure = Column(Boolean, default=False)  # User choice to skip restructuring
    restructure_metadata = Column(JSON, nullable=True)  # Store MCQ consolidation info
    restructured_at = Column(DateTime, nullable=True)
    
    # Stage 3: Question Generation
    generated_questions = Column(JSON, nullable=True)  # Array of 3 questions
    questions_generated_at = Column(DateTime, nullable=True)
    
    # Stage 4: Human Validation
    selected_question_index = Column(Integer, nullable=True)  # 0, 1, or 2
    selected_question = Column(Text, nullable=True)
    validated_by = Column(String(255), nullable=True)
    validated_at = Column(DateTime, nullable=True)
    
    # Stage 5: Model Responses
    model_responses = Column(JSON, nullable=True)  # {model_name: {response, problems}}
    responses_generated_at = Column(DateTime, nullable=True)
    
    # Overall status
    completed = Column(Boolean, default=False)
    error_message = Column(Text, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    pipeline_run = relationship("BRPipelineRun", back_populates="record_stages")


class ModelConfig(Base):
    """Configuration for base models used in pipeline."""
    __tablename__ = "br_model_configs"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False, unique=True)
    model_type = Column(String(100), nullable=False)  # openai, anthropic, local, etc.
    model_id = Column(String(255), nullable=False)  # gpt-4, claude-3, etc.
    
    # Configuration
    api_endpoint = Column(String(512), nullable=True)
    api_key_env_var = Column(String(100), nullable=True)  # Name of env var with API key
    parameters = Column(JSON, nullable=True)  # temperature, max_tokens, etc.
    
    # Status
    is_active = Column(Boolean, default=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
