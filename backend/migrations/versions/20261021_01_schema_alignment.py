"""Align established databases without discarding legacy data.

The unresolved insert-name uniqueness constraint is handled by the separately
reviewed H04 procedure; this migration never renames or merges products.
"""
from alembic import op
import sqlalchemy as sa

revision = "20261021_01"
down_revision = "20260916_01"
branch_labels = None
depends_on = None


def columns(table):
    return {item["name"]: item for item in sa.inspect(op.get_bind()).get_columns(table)}


def require_empty(query, message):
    if op.get_bind().execute(sa.text(query)).first():
        raise RuntimeError(message)


def upgrade():
    bind = op.get_bind()
    if isinstance(columns("insert_transactions")["quantity"]["type"], sa.Float):
        require_empty(
            "SELECT id FROM insert_transactions WHERE quantity <> trunc(quantity) "
            "OR quantity NOT BETWEEN -2147483648 AND 2147483647 LIMIT 1",
            "Fractional/out-of-range insert quantities require an explicit data decision",
        )
        op.alter_column("insert_transactions", "quantity", type_=sa.Integer(),
                        postgresql_using="quantity::integer")
    if not isinstance(columns("audit_logs")["meta"]["type"], sa.JSON):
        # PostgreSQL validates every value; invalid JSON aborts the transaction.
        op.alter_column("audit_logs", "meta", type_=sa.JSON(), postgresql_using="meta::json")
    op.alter_column("audit_logs", "user_name", nullable=True)
    if not isinstance(columns("tickets")["type"]["type"], sa.Enum):
        op.execute("ALTER TABLE tickets ALTER COLUMN type TYPE tickettype USING type::tickettype")
    for name, length in (("contact_name", 255), ("contact_email", 255), ("contact_phone", 50)):
        if name not in columns("tickets"):
            op.add_column("tickets", sa.Column(name, sa.String(length), nullable=True))
    for table, column in (("location_contacts", "is_primary"),
                          ("replacement_devices", "serial_number"),
                          ("replacement_transactions", "created_at")):
        require_empty(f"SELECT 1 FROM {table} WHERE {column} IS NULL LIMIT 1",
                      f"NULL {table}.{column} requires an explicit data decision")
        op.alter_column(table, column, nullable=False)
    for name, table, column in (
        ("ix_asset_locations_assigned_engineer_id", "asset_locations", "assigned_engineer_id"),
        ("ix_asset_locations_customer_id", "asset_locations", "customer_id"),
        ("ix_asset_locations_inn", "asset_locations", "inn"),
        ("ix_equipment_location_id", "equipment", "location_id"),
        ("ix_equipment_model", "equipment", "model"),
        ("ix_equipment_serial_number", "equipment", "serial_number"),
        ("ix_tickets_archived", "tickets", "archived_at"),
    ):
        op.execute(f"CREATE INDEX IF NOT EXISTS {name} ON {table} ({column})")
    inspector = sa.inspect(bind)
    uniques = {tuple(c["column_names"]): c["name"] for c in inspector.get_unique_constraints("equipment")}
    for names, constraint in ((("location_id", "serial_number"), "uq_location_serial"),
                              (("qr_code",), "equipment_qr_code_key")):
        if names not in uniques:
            fields = ", ".join(names)
            require_empty(f"SELECT 1 FROM equipment GROUP BY {fields} HAVING count(*) > 1 LIMIT 1",
                          f"Duplicate equipment {fields} requires an explicit data decision")
            op.create_unique_constraint(constraint, "equipment", list(names))
    if ("serial_number",) in uniques:
        op.drop_constraint(uniques[("serial_number",)], "equipment", type_="unique")
    for table, column, referenced, action in (
        ("users", "customer_id", "customers", "SET NULL"),
        ("asset_locations", "customer_id", "customers", "RESTRICT"),
        ("asset_locations", "assigned_engineer_id", "users", "SET NULL"),
        ("equipment", "location_id", "asset_locations", "RESTRICT"),
        ("warehouse_access", "user_id", "users", "CASCADE"),
        ("warehouse_access", "warehouse_id", "warehouses", "CASCADE"),
    ):
        existing = [fk for fk in sa.inspect(bind).get_foreign_keys(table)
                    if fk["constrained_columns"] == [column]]
        if existing and existing[0]["options"].get("ondelete") == action:
            continue
        for fk in existing:
            op.drop_constraint(fk["name"], table, type_="foreignkey")
        op.create_foreign_key(f"{table}_{column}_fkey", table, referenced,
                              [column], ["id"], ondelete=action)


def downgrade():
    raise RuntimeError("Alignment downgrade requires an explicitly reviewed recovery procedure")
