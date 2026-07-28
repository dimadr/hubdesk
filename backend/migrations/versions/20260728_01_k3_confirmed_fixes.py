"""Add warehouse audit data, decimal quantities, and missing FK indexes.

Revision ID: 20260728_01
Revises: 20260727_01
Create Date: 2026-07-28
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260728_01"
down_revision = "20260727_01"
branch_labels = None
depends_on = None


INDEXES = (
    ("ix_ticket_transitions_ticket_id", "ticket_transitions", ("ticket_id",)),
    ("ix_comments_ticket_id", "comments", ("ticket_id",)),
    ("ix_attachments_ticket_id", "attachments", ("ticket_id",)),
    ("ix_attachments_comment_id", "attachments", ("comment_id",)),
    ("ix_checklists_ticket_id", "checklists", ("ticket_id",)),
    ("ix_checklist_fields_checklist_id", "checklist_fields", ("checklist_id",)),
    ("ix_document_lines_document_id", "document_lines", ("document_id",)),
    ("ix_insert_transactions_product_id", "insert_transactions", ("product_id",)),
    ("ix_replacement_transactions_device_id", "replacement_transactions", ("device_id",)),
    ("ix_personal_tasks_user_id", "personal_tasks", ("user_id",)),
    ("ix_tickets_location_id", "tickets", ("location_id",)),
    ("ix_tickets_equipment_id", "tickets", ("equipment_id",)),
    ("ix_tickets_group_id", "tickets", ("group_id",)),
    ("ix_audit_logs_entity", "audit_logs", ("entity_type", "entity_id")),
)


def upgrade() -> None:
    op.add_column(
        "accounting_documents",
        sa.Column(
            "created_by",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    doc_status = postgresql.ENUM(name="docstatus", create_type=False)
    op.create_table(
        "warehouse_document_transitions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "document_id",
            sa.Integer(),
            sa.ForeignKey("accounting_documents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("from_status", doc_status, nullable=False),
        sa.Column("to_status", doc_status, nullable=False),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("timestamp", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(
        "ix_warehouse_document_transitions_document_id",
        "warehouse_document_transitions",
        ["document_id"],
    )
    op.create_index(
        "ix_warehouse_document_transitions_user_id",
        "warehouse_document_transitions",
        ["user_id"],
    )
    op.alter_column(
        "document_lines",
        "quantity",
        existing_type=sa.Float(),
        type_=sa.Numeric(14, 3),
        postgresql_using="quantity::numeric(14,3)",
        existing_nullable=False,
    )
    op.alter_column(
        "stock_balances",
        "quantity",
        existing_type=sa.Float(),
        type_=sa.Numeric(14, 3),
        postgresql_using="quantity::numeric(14,3)",
        existing_nullable=False,
    )
    for name, table, columns in INDEXES:
        op.create_index(name, table, list(columns))


def downgrade() -> None:
    for name, table, _columns in reversed(INDEXES):
        op.drop_index(name, table_name=table)
    op.alter_column(
        "stock_balances",
        "quantity",
        existing_type=sa.Numeric(14, 3),
        type_=sa.Float(),
        postgresql_using="quantity::double precision",
        existing_nullable=False,
    )
    op.alter_column(
        "document_lines",
        "quantity",
        existing_type=sa.Numeric(14, 3),
        type_=sa.Float(),
        postgresql_using="quantity::double precision",
        existing_nullable=False,
    )
    op.drop_index(
        "ix_warehouse_document_transitions_user_id",
        table_name="warehouse_document_transitions",
    )
    op.drop_index(
        "ix_warehouse_document_transitions_document_id",
        table_name="warehouse_document_transitions",
    )
    op.drop_table("warehouse_document_transitions")
    op.drop_column("accounting_documents", "created_by")
