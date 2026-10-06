"""Add chief accountant role.

Revision ID: 20260916_01
Revises: 20260911_01
Create Date: 2026-09-16
"""

from alembic import op


revision = "20260916_01"
down_revision = "20260911_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TYPE userrole "
        "ADD VALUE IF NOT EXISTS 'chief_accountant'"
    )


def downgrade() -> None:
    # PostgreSQL enum values cannot be removed safely while users may use them.
    pass
