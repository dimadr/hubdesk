from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError


async def verify_schema(engine):
    backend = Path(__file__).resolve().parents[2]
    config = Config(str(backend / "alembic.ini"))
    config.set_main_option("script_location", str(backend / "migrations"))
    expected = ScriptDirectory.from_config(config).get_current_head()
    try:
        async with engine.connect() as connection:
            revisions = (await connection.execute(text("SELECT version_num FROM alembic_version"))).scalars().all()
    except SQLAlchemyError as exc:
        raise RuntimeError("Database schema is not initialized; run reviewed alembic migrations separately") from exc
    if revisions != [expected]:
        raise RuntimeError(f"Database schema revision mismatch; expected {expected}; apply reviewed migrations separately")
