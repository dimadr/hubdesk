import asyncio
import json
import os
from pathlib import Path
import sys
from uuid import uuid4

import asyncpg
import pytest


@pytest.mark.asyncio
async def test_activity_migration_preserves_existing_user(postgres_factory):
    url = postgres_factory.kw["bind"].url
    name = "high_activity_" + uuid4().hex
    control = await asyncpg.connect(url.render_as_string(hide_password=False).replace("+asyncpg", ""))
    try:
        await control.execute(f'CREATE DATABASE "{name}"')
    finally:
        await control.close()
    target = url.set(database=name).render_as_string(hide_password=False)
    environment = dict(os.environ, DATABASE_URL=target, ENABLE_MAIL_WORKER="false", ENABLE_AUTO_MIGRATIONS="false")

    async def migrate(revision):
        process = await asyncio.create_subprocess_exec(
            sys.executable, "-m", "alembic", "upgrade", revision,
            cwd=Path(__file__).resolve().parents[1], env=environment,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
        )
        log, _ = await process.communicate()
        assert process.returncode == 0, log.decode()

    await migrate("20261021_01")
    connection = await asyncpg.connect(target.replace("+asyncpg", ""))
    try:
        await connection.execute("INSERT INTO users (email, name, role, password_hash, status, consent_given) "
                                 "VALUES ('migration@example.test', 'Existing user', 'engineer', 'test-only', 'active', false)")
        before = json.loads(await connection.fetchval("SELECT to_jsonb(u) FROM users u"))
        await migrate("head")
        after = json.loads(await connection.fetchval("SELECT to_jsonb(u) FROM users u"))
        assert after.pop("last_active_at") is None
        assert after == before
        column = await connection.fetchrow("SELECT data_type, is_nullable FROM information_schema.columns "
                                           "WHERE table_name='users' AND column_name='last_active_at'")
        assert column["data_type"] == "timestamp with time zone"
        assert column["is_nullable"] == "YES"
    finally:
        await connection.close()
