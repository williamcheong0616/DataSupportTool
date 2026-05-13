"""Add EvalDataset and EvalRecord

Revision ID: 005_add_eval_dataset
Revises: 004_add_system_prompt
Create Date: 2026-05-10 23:12:32.156803

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '005_add_eval_dataset'
down_revision: Union[str, None] = '004_add_system_prompt'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'eval_datasets',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_eval_datasets_id'), 'eval_datasets', ['id'], unique=False)
    
    op.create_table(
        'eval_records',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('dataset_id', sa.Integer(), nullable=False),
        sa.Column('prompt', sa.Text(), nullable=True),
        sa.Column('ground_truth', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['dataset_id'], ['eval_datasets.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_eval_records_id'), 'eval_records', ['id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_eval_records_id'), table_name='eval_records')
    op.drop_table('eval_records')
    op.drop_index(op.f('ix_eval_datasets_id'), table_name='eval_datasets')
    op.drop_table('eval_datasets')
