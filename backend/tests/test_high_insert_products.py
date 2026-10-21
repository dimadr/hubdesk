import asyncio

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import func, select, text

from src.api.insert_v2 import insert_v2_router
from src.core.deps import get_current_user
from src.database import get_db
from src.models.insert_stock import InsertProduct, InsertTransaction
from src.models.user import User, UserRole, UserStatus


async def client_for(factory):
    async with factory() as db:
        user = User(email="admin@example.test", name="Test", password_hash="test-only",
                    role=UserRole.admin, status=UserStatus.active)
        db.add(user)
        await db.commit()
    app = FastAPI()
    app.include_router(insert_v2_router, prefix="/api")
    async def test_db():
        async with factory() as db:
            yield db
    app.dependency_overrides[get_db] = test_db
    app.dependency_overrides[get_current_user] = lambda: user
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
                             base_url="http://high.test")


@pytest.mark.asyncio
@pytest.mark.parametrize("index_present", [False, True])
async def test_concurrent_creates_are_unique_even_without_index(postgres_factory, index_present):
    if not index_present:
        async with postgres_factory() as db:
            await db.execute(text("DROP INDEX uq_insert_products_name_normalized"))
            await db.commit()
    async with await client_for(postgres_factory) as client:
        responses = await asyncio.gather(*[
            client.post("/api/insert/products", json={"name": name})
            for name in (" Item ", "item")
        ])
        assert sorted(r.status_code for r in responses) == [201, 400]
    async with postgres_factory() as db:
        assert await db.scalar(select(func.count()).select_from(InsertProduct)) == 1


@pytest.mark.asyncio
async def test_legacy_duplicates_return_400_and_preserve_history(postgres_factory):
    async with postgres_factory() as db:
        await db.execute(text("DROP INDEX uq_insert_products_name_normalized"))
        first, second = InsertProduct(name="Duplicated"), InsertProduct(name=" duplicated ")
        db.add_all([first, second])
        await db.flush()
        db.add_all([InsertTransaction(product_id=first.id, type="incoming", quantity=2),
                    InsertTransaction(product_id=second.id, type="incoming", quantity=3)])
        await db.commit()
    async with await client_for(postgres_factory) as client:
        response = await client.post("/api/insert/products", json={"name": "DUPLICATED"})
        assert response.status_code == 400
        assert str(first.id) in response.json()["detail"]
        assert str(second.id) in response.json()["detail"]
    async with postgres_factory() as db:
        assert await db.scalar(select(func.count()).select_from(InsertProduct)) == 2
        assert await db.scalar(select(func.sum(InsertTransaction.quantity))) == 5


@pytest.mark.asyncio
async def test_concurrent_rename_and_create_share_name_lock(postgres_factory):
    async with postgres_factory() as db:
        await db.execute(text("DROP INDEX uq_insert_products_name_normalized"))
        item = InsertProduct(name="Source")
        db.add(item)
        await db.commit()
    async with await client_for(postgres_factory) as client:
        responses = await asyncio.gather(
            client.patch(f"/api/insert/products/{item.id}", json={"name": "Target"}),
            client.post("/api/insert/products", json={"name": " target "}),
        )
        assert sorted(r.status_code for r in responses) in ([200, 400], [201, 400])
    async with postgres_factory() as db:
        count = await db.scalar(select(func.count()).select_from(InsertProduct).where(
            func.lower(func.btrim(InsertProduct.name)) == "target"))
        assert count == 1
