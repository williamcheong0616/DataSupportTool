"""Pydantic schemas for API validation."""
from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel
from backend.enums import TaskType, TranscriptionStatus


# === Text Dataset Schemas ===

class TextDatasetCreate(BaseModel):
    name: str
    description: Optional[str] = None
    task_type: Optional[TaskType] = TaskType.GENERAL
    created_by: Optional[str] = None


class TextDatasetUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    column_mapping: Optional[Dict[str, str]] = None


class TextDatasetResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    task_type: TaskType
    column_mapping: Optional[Dict[str, str]]
    original_headers: Optional[List[str]]
    record_count: int = 0
    annotated_count: int = 0
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# === Text Record Schemas ===

class TextRecordResponse(BaseModel):
    id: int
    dataset_id: int
    original_text: str
    raw_data: Optional[Dict[str, Any]]
    is_bahasa_rojak: Optional[bool]
    classification_label: Optional[str]
    modified_text: Optional[str]
    subject_added: Optional[str]
    context_added: Optional[str]
    question_1: Optional[str]
    question_2: Optional[str]
    question_3: Optional[str]
    is_annotated: bool
    annotated_by: Optional[str]
    annotated_at: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True


class BahasaRojakAnnotation(BaseModel):
    is_bahasa_rojak: bool


class ClassificationAnnotation(BaseModel):
    classification_label: str


class TextModificationAnnotation(BaseModel):
    modified_text: Optional[str] = None
    subject_added: Optional[str] = None
    context_added: Optional[str] = None


class QuestionGenerationAnnotation(BaseModel):
    question_1: str
    question_2: str
    question_3: str


# === ASR Dataset Schemas ===

class ASRDatasetCreate(BaseModel):
    name: str
    description: Optional[str] = None
    created_by: Optional[str] = None


class ASRDatasetResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    file_count: int = 0
    pending_count: int = 0
    completed_count: int = 0
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# === Audio File Schemas ===

class AudioFileResponse(BaseModel):
    id: int
    dataset_id: int
    filename: str
    file_path: str
    file_size: Optional[int]
    duration: Optional[float]
    whisper_transcript: Optional[str]
    whisper_language: Optional[str]
    whisper_confidence: Optional[float]
    transcribed_at: Optional[datetime]
    corrected_transcript: Optional[str]
    status: TranscriptionStatus
    annotated_by: Optional[str]
    annotated_at: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True


class TranscriptAnnotation(BaseModel):
    corrected_transcript: str


# === Stats ===

class AnnotationStats(BaseModel):
    text_datasets: int
    text_records: int
    text_annotated: int
    asr_datasets: int
    audio_files: int
    asr_completed: int
