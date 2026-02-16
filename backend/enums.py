"""
Shared enum definitions for the DataSupportTool application.

Centralizes enum types used across models, schemas, and routes to avoid duplication.
"""
import enum


class TaskType(str, enum.Enum):
    """Type of annotation task."""
    GENERAL = "general"  # Default for BR Pipeline
    BAHASA_ROJAK_IDENTIFICATION = "bahasa_rojak_identification"  # Yes/No
    BAHASA_ROJAK_CLASSIFICATION = "bahasa_rojak_classification"  # Categories
    TEXT_MODIFICATION = "text_modification"  # Subject/Context adding
    QUESTION_GENERATION = "question_generation"  # 3 questions


class TranscriptionStatus(str, enum.Enum):
    """Status of audio transcription."""
    PENDING = "pending"  # Not yet transcribed
    TRANSCRIBING = "transcribing"  # Whisper processing
    TRANSCRIBED = "transcribed"  # Whisper done, awaiting annotation
    ANNOTATING = "annotating"  # User is editing
    COMPLETED = "completed"  # Annotation done
