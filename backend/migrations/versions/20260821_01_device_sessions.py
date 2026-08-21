"""Add revocable long-lived device sessions.

Revision ID: 20260821_01
Revises: 20260821_00
Create Date: 2026-08-21
"""

from alembic import op
import sqlalchemy as sa


revision = "20260821_01"
down_revision = "20260821_00"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "device_sessions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("device_name", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("last_used_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("token_hash", name="uq_device_sessions_token_hash"),
    )
    op.create_index("ix_device_sessions_user_id", "device_sessions", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_device_sessions_user_id", table_name="device_sessions")
    op.drop_table("device_sessions")
