"""Allow internal tickets without a customer.

Revision ID: 20260806_01
Revises: 20260728_01
Create Date: 2026-08-06
"""

from alembic import op
import sqlalchemy as sa


revision = "20260806_01"
down_revision = "20260728_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "tickets",
        "customer_id",
        existing_type=sa.Integer(),
        nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        "tickets",
        "customer_id",
        existing_type=sa.Integer(),
        nullable=False,
    )
