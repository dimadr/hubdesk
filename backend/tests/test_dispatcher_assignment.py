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
from src.services.acl_service import RoleChecker


@pytest_asyncio.fixture
async def dispatcher_case(postgres_factory, monkeypatch):
    monkeypatch.setattr(MailService, "notify_engineer_assigned", AsyncMock())
    monkeypatch.setattr(MailService, "notify_creator_accepted", AsyncMock())
    roles = [
        "dispatcher", "dispatcher", "engineer", "engineer", "engineer", "engineer",
        "admin", "viewer", "admin", "director", "director",
    ]
    async with postgres_factory() as db:
        users = [User(email=f"user-{index}@example.test", name=f"User {index}", role=UserRole(role),
                      status=UserStatus.active, password_hash="test-only")
                 for index, role in enumerate(roles)]
        users[5].status = UserStatus.rejected
        users[10].status = UserStatus.rejected
        customers = [Customer(name=f"Customer {i}") for i in range(3)]
        db.add_all([*users, *customers])
        await db.flush()
        locations = [AssetLocation(name=f"Location {i}", address=f"Address {i}", customer_id=customer.id,
                                   assigned_engineer_id=users[2 + i].id if i < 2 else None)
                     for i, customer in enumerate(customers)]
        db.add_all(locations)
        await db.commit()
    monkeypatch.setattr(settings, "dispatcher_self_assignment_user_ids", [users[0].id], raising=False)
    monkeypatch.setattr(settings, "admin_unrestricted_assignment_user_ids", [users[6].id], raising=False)
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
@pytest.mark.parametrize("name,phone,expected", [
    ("  Объектный контакт  ", "  12345  ", ("Объектный контакт", "12345")),
    (None, "12345", (None, None)),
    ("   ", "12345", (None, None)),
])
async def test_ticket_contact_comes_from_object_on_create_and_edit(dispatcher_case, name, phone, expected):
    c = dispatcher_case
    payload = c.payload(2)
    async with c.factory() as db:
        location = await db.get(AssetLocation, payload["location_id"])
        location.contact_name, location.contact_phone = name, phone
        location.assigned_engineer_id = c.users[2].id
        await db.commit()

    created = await c.client.post("/api/tickets", headers=c.headers(), json={
        **payload, "site_contact_name": c.users[2].name, "site_contact_phone": "99999",
    })
    assert created.status_code == 201, created.text
    row = created.json()
    assert (row["site_contact_name"], row["site_contact_phone"]) == expected
    assert row["assignee_id"] == c.users[2].id
    async with c.factory() as db:
        stored = await db.get(Ticket, row["id"])
        assert (stored.site_contact_name, stored.site_contact_phone) == expected

    changed = await c.client.patch(f'/api/tickets/{row["id"]}', headers=c.headers(), json={
        "location_id": c.locations[0].id, "customer_id": c.customers[0].id,
        "site_contact_name": c.users[2].name, "site_contact_phone": "99999",
    })
    assert changed.status_code == 200, changed.text
    assert changed.json()["site_contact_name"] is None
    assert changed.json()["site_contact_phone"] is None
    assert changed.json()["assignee_id"] == c.users[2].id
    async with c.factory() as db:
        stored = await db.get(Ticket, row["id"])
        assert stored.site_contact_name is None
        assert stored.site_contact_phone is None


@pytest.mark.asyncio
@pytest.mark.parametrize("number,status", [(1103, TicketStatus.COMPLETED), (1114, TicketStatus.ACCEPTED)])
async def test_legacy_object_engineer_is_not_returned_as_contact(dispatcher_case, number, status):
    c = dispatcher_case
    archived = status == TicketStatus.COMPLETED
    assignee = c.users[3] if archived else c.users[2]
    async with c.factory() as db:
        ticket = Ticket(number=number, subject=f"Ticket {number}", body="", status=status,
                        customer_id=c.customers[0].id, location_id=c.locations[0].id,
                        assignee_id=assignee.id, site_contact_name=c.users[2].name,
                        site_contact_phone="99999",
                        archived_at=datetime.now(timezone.utc).replace(tzinfo=None) if archived else None)
        db.add(ticket)
        await db.commit()
        ticket_id = ticket.id
    detail = await c.client.get(f"/api/tickets/{ticket_id}", headers=c.headers())
    assert detail.status_code == 200, detail.text
    row = detail.json()
    assert row["site_contact_name"] is None
    assert row["site_contact_phone"] is None
    assert row["assignee_name"] == assignee.name
    listed = await c.client.get("/api/tickets", headers=c.headers(), params={"archived": str(archived).lower()})
    assert listed.status_code == 200, listed.text
    row = next(item for item in listed.json() if item["id"] == ticket_id)
    assert (row["site_contact_name"], row["site_contact_phone"], row["assignee_id"]) == (None, None, assignee.id)
    async with c.factory() as db:
        stored = await db.get(Ticket, ticket_id)
        assert (stored.site_contact_name, stored.site_contact_phone) == (c.users[2].name, "99999")


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
        rows = response.json()
        assert {u["id"] for u in rows if u["can_be_assignee_on_update"]} == {c.users[i].id for i in expected}
        create_targets = expected | ({9} if actor == 0 else set())
        assert {u["id"] for u in rows if u["can_be_assignee"]} == {c.users[i].id for i in create_targets}


@pytest.mark.asyncio
@pytest.mark.parametrize("internal", [False, True])
async def test_configured_dispatcher_can_create_for_active_director(dispatcher_case, internal):
    c = dispatcher_case
    created = await c.client.post("/api/tickets", json=c.payload(9, internal), headers=c.headers())
    assert created.status_code == 201, created.text
    ticket = created.json()
    assert ticket["assignee_id"] == c.users[9].id
    assert ticket["status"] == TicketStatus.ASSIGNED.value

    # A full edit form can send the unchanged assignee without reassigning the ticket.
    updated = await c.client.patch(
        f'/api/tickets/{ticket["id"]}',
        json={"body": "Updated description", "assignee_id": c.users[9].id},
        headers=c.headers(),
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["assignee_id"] == c.users[9].id

    other = await c.client.post("/api/tickets", json=c.payload(2, internal), headers=c.headers())
    assert other.status_code == 201, other.text
    for suffix in ("", "/assign"):
        response = await c.client.patch(
            f'/api/tickets/{other.json()["id"]}{suffix}',
            json={"assignee_id": c.users[9].id},
            headers=c.headers(),
        )
        assert response.status_code == 400, response.text


@pytest.mark.asyncio
@pytest.mark.parametrize("actor,target", [(0, 10), (1, 9)])
async def test_director_creation_grant_does_not_cover_other_users(dispatcher_case, actor, target):
    c = dispatcher_case
    response = await c.client.post("/api/tickets", json=c.payload(target), headers=c.headers(actor))
    assert response.status_code == 400, response.text
    async with c.factory() as db:
        assert await db.scalar(select(func.count()).select_from(Ticket)) == 0


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


@pytest.mark.asyncio
@pytest.mark.parametrize("target", [0, 1, 2, 3, 4, 6, 7, 8])
@pytest.mark.parametrize("internal", [False, True])
async def test_configured_admin_creates_for_any_active_user(dispatcher_case, target, internal):
    c = dispatcher_case
    response = await c.client.post("/api/tickets", json=c.payload(target, internal), headers=c.headers(6))
    assert response.status_code == 201, response.text
    assert response.json()["assignee_id"] == c.users[target].id
    assert response.json()["status"] == TicketStatus.ASSIGNED.value


@pytest.mark.asyncio
@pytest.mark.parametrize("suffix", ["", "/assign"])
@pytest.mark.parametrize("target", [0, 6, 7, 8])
async def test_configured_admin_updates_and_assigns_any_role(dispatcher_case, suffix, target):
    c = dispatcher_case
    created = await c.client.post("/api/tickets", json=c.payload(2), headers=c.headers(6))
    assert created.status_code == 201
    response = await c.client.patch(f'/api/tickets/{created.json()["id"]}{suffix}',
                                    json={"assignee_id": c.users[target].id}, headers=c.headers(6))
    assert response.status_code == 200, response.text
    assert response.json()["assignee_id"] == c.users[target].id


@pytest.mark.asyncio
async def test_unrestricted_grant_is_personal_and_revocable(dispatcher_case, monkeypatch):
    c = dispatcher_case
    expected = {u.id for u in c.users if u.status == UserStatus.active}
    rows = (await c.client.get("/api/users/list", headers=c.headers(6))).json()
    assert {u["id"] for u in rows if u["can_be_assignee"]} == expected
    for target in (0, 6, 7, 8):
        response = await c.client.post("/api/tickets", json=c.payload(target), headers=c.headers(8))
        assert response.status_code == 400, response.text
    assert (await c.client.post("/api/tickets", json=c.payload(2), headers=c.headers(8))).status_code == 201
    monkeypatch.setattr(settings, "admin_unrestricted_assignment_user_ids", [])
    assert (await c.client.post("/api/tickets", json=c.payload(6), headers=c.headers(6))).status_code == 400
    rows = (await c.client.get("/api/users/list", headers=c.headers(6))).json()
    assert {u["id"] for u in rows if u["can_be_assignee"]} == {c.users[i].id for i in (2, 3, 4)}


@pytest.mark.asyncio
async def test_admin_cannot_assign_inactive_or_missing_users(dispatcher_case):
    c = dispatcher_case
    for target in (c.users[5].id, 999999):
        payload = c.payload(2)
        payload["assignee_id"] = target
        assert (await c.client.post("/api/tickets", json=payload, headers=c.headers(6))).status_code == 400
    async with c.factory() as db:
        assert await db.scalar(select(func.count()).select_from(Ticket)) == 0


@pytest.mark.parametrize("role", list(UserRole))
def test_personal_admin_grant_covers_every_active_role(role, monkeypatch):
    actor = User(id=101, role=UserRole.admin, status=UserStatus.active)
    target = User(id=202, role=role, status=UserStatus.active)
    monkeypatch.setattr(settings, "admin_unrestricted_assignment_user_ids", [actor.id])
    assert RoleChecker.can_assign_user(actor, target)
    target.status = UserStatus.pending
    assert not RoleChecker.can_assign_user(actor, target)
    actor.role = UserRole.dispatcher
    target.status = UserStatus.active
    assert RoleChecker.can_assign_user(actor, target) == (role == UserRole.engineer)
