"""Add Qwen3 transcript columns to audio_files

Revision ID: 003_qwen3_columns
Revises: 002_br_pipeline
Create Date: 2026-02-25

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "003_qwen3_columns"
down_revision: Union[str, None] = "002_br_pipeline"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("audio_files", sa.Column("qwen3_transcript", sa.Text(), nullable=True))
    op.add_column("audio_files", sa.Column("qwen3_language", sa.String(50), nullable=True))
    op.add_column("audio_files", sa.Column("qwen3_confidence", sa.Float(), nullable=True))
    op.add_column("audio_files", sa.Column("qwen3_transcribed_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("audio_files", "qwen3_transcribed_at")
    op.drop_column("audio_files", "qwen3_confidence")
    op.drop_column("audio_files", "qwen3_language")
    op.drop_column("audio_files", "qwen3_transcript")
