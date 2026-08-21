"""Align legacy databases with the established warehouse schema.

Revision ID: 20260821_00
Revises: 20260806_01
Create Date: 2026-08-21
"""

from alembic import op


revision = "20260821_00"
down_revision = "20260806_01"
branch_labels = None
depends_on = None


INDEXES = (
    ("ix_users_customer_id", "users", "customer_id"),
    ("ix_ticket_transitions_ticket_id", "ticket_transitions", "ticket_id"),
    ("ix_comments_ticket_id", "comments", "ticket_id"),
    ("ix_attachments_ticket_id", "attachments", "ticket_id"),
    ("ix_attachments_comment_id", "attachments", "comment_id"),
    ("ix_checklists_ticket_id", "checklists", "ticket_id"),
    ("ix_checklist_fields_checklist_id", "checklist_fields", "checklist_id"),
    ("ix_document_lines_document_id", "document_lines", "document_id"),
    ("ix_insert_transactions_product_id", "insert_transactions", "product_id"),
    ("ix_replacement_transactions_device_id", "replacement_transactions", "device_id"),
    ("ix_personal_tasks_user_id", "personal_tasks", "user_id"),
    ("ix_tickets_location_id", "tickets", "location_id"),
    ("ix_tickets_equipment_id", "tickets", "equipment_id"),
    ("ix_tickets_group_id", "tickets", "group_id"),
)


def upgrade() -> None:
    op.execute(
        "ALTER TABLE accounting_documents "
        "ADD COLUMN IF NOT EXISTS created_by INTEGER"
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'accounting_documents_created_by_fkey'
            ) THEN
                ALTER TABLE accounting_documents
                ADD CONSTRAINT accounting_documents_created_by_fkey
                FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
            END IF;
        END $$
        """
    )
    op.execute(
        "ALTER TABLE document_lines ALTER COLUMN quantity "
        "TYPE NUMERIC(14, 3) USING quantity::numeric(14, 3)"
    )
    op.execute(
        "ALTER TABLE stock_balances ALTER COLUMN quantity "
        "TYPE NUMERIC(14, 3) USING quantity::numeric(14, 3)"
    )
    for name, table, columns in INDEXES:
        op.execute(f"CREATE INDEX IF NOT EXISTS {name} ON {table} ({columns})")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_audit_logs_entity "
        "ON audit_logs (entity_type, entity_id)"
    )


def downgrade() -> None:
    # This revision records alignment of legacy databases with earlier revisions.
    # Reverting it would remove schema owned by those earlier revisions.
    pass
