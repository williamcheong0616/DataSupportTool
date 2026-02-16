"""
Pydantic schemas for BR Pipeline API endpoints.

Extracted from br_pipeline_routes.py for better code organization and reusability.
"""
from typing import List, Optional
from pydantic import BaseModel


# ===== Pipeline Schemas =====

class PipelineStartRequest(BaseModel):
    dataset_id: int


class PipelineRunResponse(BaseModel):
    id: int
    dataset_id: int
    total_records: int
    processed_records: int
    pending_validation: int
    current_stage: str
    status: str
    error_message: Optional[str]
    started_at: Optional[str]
    completed_at: Optional[str]


class RecordStageResponse(BaseModel):
    id: int
    text_record_id: int
    current_stage: str
    is_bahasa_rojak: Optional[bool]
    br_confidence: Optional[float]
    detected_language: Optional[str]
    restructured_text: Optional[str]
    generated_questions: Optional[List[str]]
    selected_question_index: Optional[int]
    selected_question: Optional[str]
    model_responses: Optional[dict]
    completed: bool


class QuestionSelectionRequest(BaseModel):
    question_index: int  # 0, 1, or 2
    validated_by: str


class ModelConfigCreate(BaseModel):
    name: str
    model_type: str
    model_id: str
    api_endpoint: Optional[str] = None
    api_key_env_var: Optional[str] = None
    parameters: Optional[dict] = None
    is_active: bool = True


# ===== Stage 1: Classification Schemas =====

class ClassificationUpdateRequest(BaseModel):
    is_bahasa_rojak: Optional[bool] = None
    detected_language: Optional[str] = None


class ClassificationRecordResponse(BaseModel):
    id: int
    text_record_id: int
    original_text: str
    is_bahasa_rojak: Optional[bool]
    detected_language: Optional[str]
    br_confidence: Optional[float]
    current_stage: str


class ClassificationListResponse(BaseModel):
    records: List[ClassificationRecordResponse]
    total: int
    page: int
    per_page: int
    total_pages: int
    classified_count: int


# ===== Stage 2: Restructure Schemas =====

class RestructureRecordResponse(BaseModel):
    id: int
    text_record_id: int
    original_text: str
    restructured_text: Optional[str]
    was_restructured: bool
    is_bahasa_rojak: Optional[bool] = None
    detected_language: Optional[str] = None


class RestructureListResponse(BaseModel):
    records: List[RestructureRecordResponse]
    total: int
    page: int
    per_page: int
    total_pages: int
    restructured_count: int


class RestructureUpdateRequest(BaseModel):
    restructured_text: str


# ===== Stage 3: Question Schemas =====

class QuestionRecordResponse(BaseModel):
    id: int
    text_record_id: int
    original_text: Optional[str] = None
    restructured_text: Optional[str]
    detected_language: Optional[str] = None
    is_bahasa_rojak: Optional[bool] = None
    generated_questions: Optional[List[str]]
    selected_question_index: Optional[int]
    selected_question: Optional[str]


class QuestionListResponse(BaseModel):
    records: List[QuestionRecordResponse]
    total: int
    page: int
    per_page: int
    total_pages: int
    validated_count: int


class QuestionSelectRequest(BaseModel):
    question_index: int
    validated_by: str


# ===== Stage 4: Response Schemas =====

class ResponseRecordResponse(BaseModel):
    id: int
    text_record_id: int
    selected_question: Optional[str]
    model_responses: Optional[dict]
    completed: bool


class ModelResponseEditRequest(BaseModel):
    """Request to edit a model response."""
    model_name: str
    corrected_response: str
    edited_by: str


class ModelProblemsEditRequest(BaseModel):
    """Request to edit problems for a model response."""
    model_name: str
    problems: List[str]
    edited_by: str


class ResponseListResponse(BaseModel):
    records: List[ResponseRecordResponse]
    total: int
    page: int
    per_page: int
    total_pages: int
    completed_count: int
    pipeline_id: int
    dataset_id: int
    dataset_name: str


# ===== Individual Stage Execution Schemas =====

class StageExecutionRequest(BaseModel):
    pipeline_run_id: int
    record_ids: Optional[List[int]] = None  # If None, run for all eligible records
    force_rerun: bool = False  # If True, rerun even if already processed


class Stage2ExecutionRequest(BaseModel):
    pipeline_run_id: int
    skip_restructure: bool = False  # User choice: False=restructure, True=keep original
    record_ids: Optional[List[int]] = None
    force_rerun: bool = False  # If True, rerun even if already processed


class StageExecutionResponse(BaseModel):
    pipeline_run_id: int
    stage: str
    records_processed: int
    message: str


class MergeRecordsRequest(BaseModel):
    record_ids: List[int]  # IDs of records to merge (order matters)
    separator: str = " "  # How to join the texts
