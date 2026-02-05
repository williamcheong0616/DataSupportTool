"""Pydantic schemas for API validation."""
from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field

from backend.models import PipelineStatus, ValidationResult


# --- Dataset Schemas ---
class DatasetCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    source_type: str = Field(..., pattern="^(upload|api|manual)$")


class DatasetResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    source_type: str
    record_count: int
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


# --- Data Record Schemas ---
class DataRecordCreate(BaseModel):
    input_text: str
    expected_output: Optional[str] = None
    record_metadata: Optional[Dict[str, Any]] = None


class DataRecordBulkCreate(BaseModel):
    records: List[DataRecordCreate]


class DataRecordResponse(BaseModel):
    id: int
    dataset_id: int
    input_text: str
    expected_output: Optional[str]
    is_preprocessed: bool
    created_at: datetime
    
    class Config:
        from_attributes = True


# --- Pipeline Schemas ---
class PipelineConfig(BaseModel):
    model_config = {"protected_namespaces": ()}
    
    model_name: str = "default-model"
    validation_threshold: float = Field(default=0.8, ge=0.0, le=1.0)
    enable_human_review: bool = True
    preprocessing_steps: List[str] = ["clean", "normalize"]
    metrics: List[str] = ["accuracy", "bleu", "rouge"]


class PipelineRunCreate(BaseModel):
    dataset_id: int
    config: Optional[PipelineConfig] = None


class PipelineRunResponse(BaseModel):
    id: int
    dataset_id: int
    status: PipelineStatus
    iteration: int
    config: Optional[Dict[str, Any]]
    started_at: datetime
    completed_at: Optional[datetime]
    error_message: Optional[str]
    
    class Config:
        from_attributes = True


# --- Validation Schemas ---
class ValidationMetrics(BaseModel):
    accuracy_score: Optional[float] = None
    bleu_score: Optional[float] = None
    rouge_score: Optional[float] = None
    custom_metrics: Optional[Dict[str, float]] = None


class HumanReviewSubmit(BaseModel):
    human_score: float = Field(..., ge=0.0, le=1.0)
    human_feedback: Optional[str] = None
    reviewer_id: str


class ValidationResponse(BaseModel):
    model_config = {"protected_namespaces": (), "from_attributes": True}
    
    id: int
    model_response_id: int
    pipeline_run_id: int
    result: ValidationResult
    accuracy_score: Optional[float]
    bleu_score: Optional[float]
    rouge_score: Optional[float]
    human_reviewed: bool
    human_score: Optional[float]
    human_feedback: Optional[str]
    created_at: datetime


# --- Dashboard/Stats Schemas ---
class PipelineStats(BaseModel):
    total_datasets: int
    total_records: int
    total_runs: int
    runs_by_status: Dict[str, int]
    avg_validation_score: Optional[float]
    pass_rate: Optional[float]


class ValidationSummary(BaseModel):
    pipeline_run_id: int
    total_validations: int
    passed: int
    failed: int
    needs_review: int
    avg_accuracy: Optional[float]
    avg_human_score: Optional[float]
