import os
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import src.models  # noqa: F401
from src.database import Base


@pytest_asyncio.fixture
async def postgres_factory():
    raw = os.getenv("HUBDESK_HIGH_TEST_DATABASE_URL")
    if not raw:
        pytest.skip("Requires isolated HUBDESK_HIGH_TEST_DATABASE_URL")
    url = make_url(raw)
    if url.drivername != "postgresql+asyncpg" or url.database != "hubdesk_high_test":
        pytest.fail("Refusing writes outside hubdesk_high_test")
    schema = "high_" + uuid4().hex
    admin = create_async_engine(url)
    async with admin.begin() as connection:
        await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    await admin.dispose()
    engine = create_async_engine(url, connect_args={"server_settings": {"search_path": schema}})
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        yield async_sessionmaker(engine, expire_on_commit=False)
    finally:
        await engine.dispose()
