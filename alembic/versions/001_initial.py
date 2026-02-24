"""Initial schema - all tables from models.py

Revision ID: 001_initial
Revises: None
Create Date: 2026-02-24

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # === Text Annotation ===
    op.create_table(
        "text_datasets",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("task_type", sa.String(50), nullable=False, server_default="general"),
        sa.Column("column_mapping", sa.JSON(), nullable=True),
        sa.Column("original_headers", sa.JSON(), nullable=True),
        sa.Column("created_by", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_text_datasets_id", "text_datasets", ["id"])

    op.create_table(
        "text_records",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("dataset_id", sa.Integer(), sa.ForeignKey("text_datasets.id"), nullable=False),
        sa.Column("original_text", sa.Text(), nullable=False),
        sa.Column("raw_data", sa.JSON(), nullable=True),
        sa.Column("is_bahasa_rojak", sa.Boolean(), nullable=True),
        sa.Column("classification_label", sa.String(255), nullable=True),
        sa.Column("modified_text", sa.Text(), nullable=True),
        sa.Column("subject_added", sa.Text(), nullable=True),
        sa.Column("context_added", sa.Text(), nullable=True),
        sa.Column("question_1", sa.Text(), nullable=True),
        sa.Column("question_2", sa.Text(), nullable=True),
        sa.Column("question_3", sa.Text(), nullable=True),
        sa.Column("is_annotated", sa.Boolean(), server_default=sa.text("false")),
        sa.Column("annotated_by", sa.String(255), nullable=True),
        sa.Column("annotated_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_text_records_id", "text_records", ["id"])

    # === ASR Annotation ===
    op.create_table(
        "asr_datasets",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_by", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_asr_datasets_id", "asr_datasets", ["id"])

    op.create_table(
        "audio_files",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("dataset_id", sa.Integer(), sa.ForeignKey("asr_datasets.id"), nullable=False),
        sa.Column("filename", sa.String(512), nullable=False),
        sa.Column("file_path", sa.String(1024), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=True),
        sa.Column("duration", sa.Float(), nullable=True),
        sa.Column("whisper_transcript", sa.Text(), nullable=True),
        sa.Column("whisper_language", sa.String(50), nullable=True),
        sa.Column("whisper_confidence", sa.Float(), nullable=True),
        sa.Column("transcribed_at", sa.DateTime(), nullable=True),
        sa.Column("corrected_transcript", sa.Text(), nullable=True),
        sa.Column("status", sa.String(50), server_default="pending"),
        sa.Column("annotated_by", sa.String(255), nullable=True),
        sa.Column("annotated_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_audio_files_id", "audio_files", ["id"])

    # === Pipeline ===
    op.create_table(
        "pipeline_datasets",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("source_type", sa.String(100), nullable=True),
        sa.Column("config", sa.JSON(), nullable=True),
        sa.Column("created_by", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_pipeline_datasets_id", "pipeline_datasets", ["id"])

    op.create_table(
        "pipeline_records",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("dataset_id", sa.Integer(), sa.ForeignKey("pipeline_datasets.id"), nullable=False),
        sa.Column("input_text", sa.Text(), nullable=False),
        sa.Column("expected_output", sa.Text(), nullable=True),
        sa.Column("is_preprocessed", sa.Boolean(), server_default=sa.text("false")),
        sa.Column("preprocessed_text", sa.Text(), nullable=True),
        sa.Column("record_metadata", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_pipeline_records_id", "pipeline_records", ["id"])

    op.create_table(
        "pipeline_runs",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("dataset_id", sa.Integer(), sa.ForeignKey("pipeline_datasets.id"), nullable=False),
        sa.Column("status", sa.String(50), server_default="pending"),
        sa.Column("current_iteration", sa.Integer(), server_default=sa.text("0")),
        sa.Column("max_iterations", sa.Integer(), server_default=sa.text("3")),
        sa.Column("config", sa.JSON(), nullable=True),
        sa.Column("metrics", sa.JSON(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_pipeline_runs_id", "pipeline_runs", ["id"])

    op.create_table(
        "model_responses",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("record_id", sa.Integer(), sa.ForeignKey("pipeline_records.id"), nullable=False),
        sa.Column("pipeline_run_id", sa.Integer(), sa.ForeignKey("pipeline_runs.id"), nullable=False),
        sa.Column("response_text", sa.Text(), nullable=False),
        sa.Column("model_name", sa.String(255), nullable=True),
        sa.Column("iteration", sa.Integer(), server_default=sa.text("1")),
        sa.Column("latency_ms", sa.Integer(), nullable=True),
        sa.Column("token_count", sa.Integer(), nullable=True),
        sa.Column("raw_response", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_model_responses_id", "model_responses", ["id"])

    op.create_table(
        "validation_records",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("record_id", sa.Integer(), sa.ForeignKey("pipeline_records.id"), nullable=False),
        sa.Column("model_response_id", sa.Integer(), sa.ForeignKey("model_responses.id"), nullable=False),
        sa.Column("result", sa.String(50), nullable=False),
        sa.Column("score", sa.Float(), nullable=True),
        sa.Column("metrics", sa.JSON(), nullable=True),
        sa.Column("failure_reasons", sa.JSON(), nullable=True),
        sa.Column("human_reviewed", sa.Boolean(), server_default=sa.text("false")),
        sa.Column("human_decision", sa.String(50), nullable=True),
        sa.Column("reviewer", sa.String(255), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_validation_records_id", "validation_records", ["id"])


def downgrade() -> None:
    op.drop_table("validation_records")
    op.drop_table("model_responses")
    op.drop_table("pipeline_runs")
    op.drop_table("pipeline_records")
    op.drop_table("pipeline_datasets")
    op.drop_table("audio_files")
    op.drop_table("asr_datasets")
    op.drop_table("text_records")
    op.drop_table("text_datasets")
