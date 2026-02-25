"""Add BR pipeline tables

Revision ID: 002_br_pipeline
Revises: 001_initial
Create Date: 2026-02-24

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "002_br_pipeline"
down_revision: Union[str, None] = "001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "br_pipeline_runs",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("dataset_id", sa.Integer(), sa.ForeignKey("text_datasets.id"), nullable=False),
        sa.Column("total_records", sa.Integer(), server_default=sa.text("0")),
        sa.Column("processed_records", sa.Integer(), server_default=sa.text("0")),
        sa.Column("pending_validation", sa.Integer(), server_default=sa.text("0")),
        sa.Column("current_stage", sa.String(50), server_default="pending"),
        sa.Column("status", sa.String(50), server_default="pending"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_br_pipeline_runs_id", "br_pipeline_runs", ["id"])

    op.create_table(
        "br_record_stages",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("pipeline_run_id", sa.Integer(), sa.ForeignKey("br_pipeline_runs.id"), nullable=False),
        sa.Column("text_record_id", sa.Integer(), sa.ForeignKey("text_records.id"), nullable=False),
        sa.Column("current_stage", sa.String(50), server_default="pending"),
        sa.Column("is_bahasa_rojak", sa.Boolean(), nullable=True),
        sa.Column("br_confidence", sa.Float(), nullable=True),
        sa.Column("detected_language", sa.String(100), nullable=True),
        sa.Column("br_detected_at", sa.DateTime(), nullable=True),
        sa.Column("restructured_text", sa.Text(), nullable=True),
        sa.Column("skip_restructure", sa.Boolean(), server_default=sa.text("false")),
        sa.Column("restructure_metadata", sa.JSON(), nullable=True),
        sa.Column("restructured_at", sa.DateTime(), nullable=True),
        sa.Column("generated_questions", sa.JSON(), nullable=True),
        sa.Column("questions_generated_at", sa.DateTime(), nullable=True),
        sa.Column("selected_question_index", sa.Integer(), nullable=True),
        sa.Column("selected_question", sa.Text(), nullable=True),
        sa.Column("validated_by", sa.String(255), nullable=True),
        sa.Column("validated_at", sa.DateTime(), nullable=True),
        sa.Column("model_responses", sa.JSON(), nullable=True),
        sa.Column("responses_generated_at", sa.DateTime(), nullable=True),
        sa.Column("completed", sa.Boolean(), server_default=sa.text("false")),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_br_record_stages_id", "br_record_stages", ["id"])

    op.create_table(
        "br_model_configs",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(255), nullable=False, unique=True),
        sa.Column("model_type", sa.String(100), nullable=False),
        sa.Column("model_id", sa.String(255), nullable=False),
        sa.Column("api_endpoint", sa.String(512), nullable=True),
        sa.Column("api_key_env_var", sa.String(100), nullable=True),
        sa.Column("parameters", sa.JSON(), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_br_model_configs_id", "br_model_configs", ["id"])


def downgrade() -> None:
    op.drop_table("br_model_configs")
    op.drop_table("br_record_stages")
    op.drop_table("br_pipeline_runs")
