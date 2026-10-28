from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

from fastapi import FastAPI
import httpx
import pytest
import pytest_asyncio
from sqlalchemy import func, select

from src.api.router import api_router
from src.config import settings
from src.core.deps import create_token
from src.database import get_db
from src.models.audit_log import AuditLog
from src.models.customer import Customer
from src.models.equipment import AssetLocation
from src.models.ticket import Ticket, TicketStatus, TicketTransition
from src.models.user import User, UserRole, UserStatus
from src.services.mail_service import MailService


@pytest_asyncio.fixture
async def dispatcher_case(postgres_factory, monkeypatch):
    monkeypatch.setattr(MailService, "notify_engineer_assigned", AsyncMock())
    roles = ["dispatcher", "dispatcher", "engineer", "engineer", "engineer", "engineer", "admin", "viewer"]
    async with postgres_factory() as db:
        users = [User(email=f"user-{index}@example.test", name=f"User {index}", role=UserRole(role),
                      status=UserStatus.active, password_hash="test-only")
                 for index, role in enumerate(roles)]
        users[5].status = UserStatus.rejected
        customers = [Customer(name=f"Customer {i}") for i in range(3)]
        db.add_all([*users, *customers])
        await db.flush()
        locations = [AssetLocation(name=f"Location {i}", address=f"Address {i}", customer_id=customer.id,
                                   assigned_engineer_id=users[2 + i].id if i < 2 else None)
                     for i, customer in enumerate(customers)]
        db.add_all(locations)
        await db.commit()
    monkeypatch.setattr(settings, "dispatcher_self_assignment_user_ids", [users[0].id], raising=False)
    app = FastAPI()
    app.include_router(api_router, prefix="/api")

    async def database():
        async with postgres_factory() as db:
            yield db

    app.dependency_overrides[get_db] = database
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        case = SimpleNamespace(client=client, users=users, locations=locations, customers=customers,
                               factory=postgres_factory)
        case.headers = lambda index=0: {"Authorization": "Bearer " + create_token(users[index].id)}
        case.payload = lambda target=0, internal=False: (
            {"is_internal": True, "body": "Internal task", "assignee_id": users[target].id,
             "resolution_deadline": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()}
            if internal else {"subject": "Dispatcher task", "body": "Test", "customer_id": customers[2].id,
                              "location_id": locations[2].id, "assignee_id": users[target].id}
        )
        yield case


@pytest.mark.asyncio
async def test_dispatcher_all_objects_and_engineer_scope(dispatcher_case):
    c = dispatcher_case
    for actor in (0, 1):
        response = await c.client.get("/api/locations", headers=c.headers(actor))
        assert response.status_code == 200
        assert {row["id"] for row in response.json()} == {loc.id for loc in c.locations}
    response = await c.client.get("/api/locations", headers=c.headers(2))
    assert {row["id"] for row in response.json()} == {c.locations[0].id}


@pytest.mark.asyncio
async def test_assignment_capabilities_are_request_specific(dispatcher_case):
    c = dispatcher_case
    for actor, expected in ((0, {0, 2, 3, 4}), (1, {2, 3, 4})):
        response = await c.client.get("/api/users/list", headers=c.headers(actor))
        assert response.status_code == 200
        assert {u["id"] for u in response.json() if u["can_be_assignee"]} == {c.users[i].id for i in expected}


@pytest.mark.asyncio
@pytest.mark.parametrize("internal", [False, True])
@pytest.mark.parametrize("target", [0, 2, 3, 4])
async def test_dispatcher_create_for_self_and_every_engineer(dispatcher_case, internal, target):
    c = dispatcher_case
    response = await c.client.post("/api/tickets", json=c.payload(target, internal), headers=c.headers())
    assert response.status_code == 201, response.text
    ticket = response.json()
    assert ticket["assignee_id"] == c.users[target].id
    assert ticket["status"] == TicketStatus.ASSIGNED.value
    async with c.factory() as db:
        saved = await db.get(Ticket, ticket["id"])
        assert saved.created_by == c.users[0].id
        assert saved.assignee_id == c.users[target].id
        assert await db.scalar(select(func.count()).select_from(AuditLog)) == 1
        assert await db.scalar(select(func.count()).select_from(TicketTransition)) == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("suffix", ["", "/assign"])
@pytest.mark.parametrize("internal", [False, True])
async def test_dispatcher_edit_and_assign_self(dispatcher_case, suffix, internal):
    c = dispatcher_case
    created = await c.client.post("/api/tickets", json=c.payload(2, internal), headers=c.headers())
    assert created.status_code == 201
    url = f'/api/tickets/{created.json()["id"]}'
    response = await c.client.patch(url + suffix, json={"assignee_id": c.users[0].id}, headers=c.headers())
    assert response.status_code == 200, response.text
    assert response.json()["assignee_id"] == c.users[0].id
    assert (await c.client.get(url, headers=c.headers())).json()["assignee_id"] == c.users[0].id


@pytest.mark.asyncio
@pytest.mark.parametrize("actor,target", [(0, 1), (0, 5), (0, 6), (0, 7), (1, 1), (1, 0)])
async def test_no_grant_to_other_dispatchers_or_roles(dispatcher_case, actor, target):
    c = dispatcher_case
    response = await c.client.post("/api/tickets", json=c.payload(target), headers=c.headers(actor))
    assert response.status_code == 400, response.text
    created = await c.client.post("/api/tickets", json=c.payload(2), headers=c.headers(actor))
    assert created.status_code == 201
    for suffix in ("", "/assign"):
        response = await c.client.patch(f'/api/tickets/{created.json()["id"]}{suffix}',
                                        json={"assignee_id": c.users[target].id}, headers=c.headers(actor))
        assert response.status_code == 400, response.text
    async with c.factory() as db:
        assert await db.scalar(select(func.count()).select_from(Ticket)) == 1
        assert (await db.get(Ticket, created.json()["id"])).assignee_id == c.users[2].id
        assert await db.scalar(select(func.count()).select_from(AuditLog)) == 1


@pytest.mark.asyncio
async def test_self_grant_can_be_revoked_without_token_reissue(dispatcher_case, monkeypatch):
    c = dispatcher_case
    monkeypatch.setattr(settings, "dispatcher_self_assignment_user_ids", [])
    response = await c.client.post("/api/tickets", json=c.payload(), headers=c.headers())
    assert response.status_code == 400
    rows = (await c.client.get("/api/users/list", headers=c.headers())).json()
    assert not next(row for row in rows if row["id"] == c.users[0].id)["can_be_assignee"]


@pytest.mark.asyncio
async def test_inactive_dispatcher_cannot_use_grant(dispatcher_case):
    c = dispatcher_case
    async with c.factory() as db:
        (await db.get(User, c.users[0].id)).status = UserStatus.rejected
        await db.commit()
    for path in ("/api/locations", "/api/users/list"):
        assert (await c.client.get(path, headers=c.headers())).status_code == 403
    assert (await c.client.post("/api/tickets", json=c.payload(), headers=c.headers())).status_code == 403


@pytest.mark.asyncio
async def test_missing_auth_cannot_read_or_create(dispatcher_case):
    c = dispatcher_case
    assert (await c.client.get("/api/locations")).status_code == 401
    assert (await c.client.get("/api/users/list")).status_code == 401
    assert (await c.client.post("/api/tickets", json=c.payload())).status_code == 401
