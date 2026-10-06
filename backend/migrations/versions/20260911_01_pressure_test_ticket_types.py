"""Add pressure-test ticket types.

Revision ID: 20260911_01
Revises: 20260821_01
Create Date: 2026-09-11
"""

from alembic import op


revision = "20260911_01"
down_revision = "20260821_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TYPE tickettype "
        "ADD VALUE IF NOT EXISTS 'pressure_test_preparation'"
    )
    op.execute(
        "ALTER TYPE tickettype "
        "ADD VALUE IF NOT EXISTS 'pressure_test_with_inspector'"
    )


def downgrade() -> None:
    # PostgreSQL enum values cannot be removed safely while rows may use them.
    pass
