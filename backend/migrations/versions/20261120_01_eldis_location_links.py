"""Store an optional Eldis object link and make imports recoverable."""

from alembic import op
import sqlalchemy as sa


revision = "20261120_01"
down_revision = "20261106_01"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("asset_locations", sa.Column("eldis_url", sa.String(128), nullable=True))
    op.add_column(
        "asset_locations",
        sa.Column("eldis_url_revision", sa.BigInteger(), nullable=False, server_default=sa.text("0")),
    )
    op.create_table(
        "eldis_link_import_changes",
        sa.Column("batch_id", sa.Uuid(), primary_key=True),
        sa.Column("location_id", sa.Integer(), primary_key=True),
        sa.Column("previous_url", sa.String(128), nullable=True),
        sa.Column("imported_url", sa.String(128), nullable=False),
        sa.Column("imported_revision", sa.BigInteger(), nullable=False),
    )
    op.execute("""
        CREATE FUNCTION abie_advance_eldis_url_revision() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            NEW.eldis_url_revision := OLD.eldis_url_revision;
            IF NEW.eldis_url IS DISTINCT FROM OLD.eldis_url THEN
                NEW.eldis_url_revision := OLD.eldis_url_revision + 1;
            END IF;
            RETURN NEW;
        END;
        $$
    """)
    op.execute("""
        CREATE TRIGGER asset_locations_eldis_url_revision
        BEFORE UPDATE OF eldis_url, eldis_url_revision ON asset_locations
        FOR EACH ROW EXECUTE FUNCTION abie_advance_eldis_url_revision()
    """)


def downgrade():
    op.execute("LOCK TABLE asset_locations IN ACCESS EXCLUSIVE MODE")
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM asset_locations WHERE eldis_url IS NOT NULL) THEN
                RAISE EXCEPTION 'Schema downgrade would discard existing Eldis links';
            END IF;
        END;
        $$
    """)
    op.execute("DROP TRIGGER asset_locations_eldis_url_revision ON asset_locations")
    op.execute("DROP FUNCTION abie_advance_eldis_url_revision()")
    op.drop_table("eldis_link_import_changes")
    op.drop_column("asset_locations", "eldis_url_revision")
    op.drop_column("asset_locations", "eldis_url")
