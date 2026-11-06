"""Store user-reported foreground activity without backfilling login times."""
from alembic import op
import sqlalchemy as sa

revision = "20261106_01"
down_revision = "20261021_01"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("last_active_at", sa.DateTime(timezone=True), nullable=True))


def downgrade():
    op.drop_column("users", "last_active_at")
