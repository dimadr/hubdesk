"""Add missing customer link and normalized insert product name index.

Revision ID: 20260727_01
Revises:
Create Date: 2026-07-27
"""

from alembic import op


revision = "20260727_01"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE users "
        "ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_users_customer_id ON users(customer_id)"
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_insert_products_name_normalized "
        "ON insert_products (lower(btrim(name)))"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_insert_products_name_normalized")
    op.execute("DROP INDEX IF EXISTS ix_users_customer_id")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS customer_id")
