import asyncio
import os
from pathlib import Path
import sys
from uuid import uuid4

import asyncpg
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from src.core.schema import verify_schema
from src.database import Base


@pytest.mark.asyncio
async def test_empty_database_bootstraps_to_matching_head(postgres_factory):
    url = postgres_factory.kw["bind"].url
    name = "high_migration_" + uuid4().hex
    control = await asyncpg.connect(url.render_as_string(hide_password=False).replace("+asyncpg", ""))
    try:
        await control.execute(f'CREATE DATABASE "{name}"')
    finally:
        await control.close()
    target = url.set(database=name).render_as_string(hide_password=False)
    environment = dict(os.environ, DATABASE_URL=target, ENABLE_MAIL_WORKER="false", ENABLE_AUTO_MIGRATIONS="false")
    process = await asyncio.create_subprocess_exec(
        sys.executable, "-m", "alembic", "upgrade", "head",
        cwd=Path(__file__).resolve().parents[1], env=environment,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
    )
    log, _ = await process.communicate()
    assert process.returncode == 0, log.decode()
    engine = create_async_engine(target)
    try:
        await verify_schema(engine)
        async with engine.connect() as connection:
            diffs = await connection.run_sync(lambda sync: compare_metadata(
                MigrationContext.configure(sync), Base.metadata))
        assert diffs == []
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_startup_guard_does_not_change_unversioned_schema(postgres_factory):
    engine = postgres_factory.kw["bind"]
    async with engine.connect() as connection:
        before = await connection.scalar(text("SELECT count(*) FROM information_schema.tables WHERE table_schema = current_schema()"))
    with pytest.raises(RuntimeError, match="not initialized"):
        await verify_schema(engine)
    async with engine.connect() as connection:
        after = await connection.scalar(text("SELECT count(*) FROM information_schema.tables WHERE table_schema = current_schema()"))
    assert before == after
