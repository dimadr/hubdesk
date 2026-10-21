from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

from fastapi import FastAPI
import httpx
import pytest
import pytest_asyncio
from sqlalchemy import func, select, text

from src.api.admin import admin_router
from src.api.insert_v2 import insert_v2_router
from src.api.replacement import replacement_router
from src.api.reports import reports_router
from src.api.tickets import create_ticket_router
from src.api.warehouse import warehouse_router
from src.core.deps import get_current_user
from src.database import get_db
from src.models.audit_log import AuditLog
from src.models.checklist import Checklist, ChecklistField, FieldType
from src.models.comment import Comment
from src.models.customer import Customer
from src.models.equipment import AssetLocation, warehouse_access
from src.models.insert_stock import InsertProduct
from src.models.replacement_device import ReplacementDevice, ReplacementTransaction
from src.models.ticket import Ticket, TicketStatus, TicketTransition
from src.models.user import User, UserRole, UserStatus
from src.models.warehouse import Warehouse
from src.services.mail_service import MailService


@pytest_asyncio.fixture
async def medium_case(postgres_factory, monkeypatch):
    monkeypatch.setattr(MailService, "notify_engineer_assigned", AsyncMock())
    monkeypatch.setattr(MailService, "notify_creator_accepted", AsyncMock())
    async with postgres_factory() as db:
        users = [User(email=f"{role}-{i}@example.test", name=f"Test {role} {i}",
                      role=UserRole(role), status=UserStatus.active, password_hash="test-only")
                 for i, role in enumerate(("admin", "engineer", "engineer", "storekeeper", "viewer"))]
        customers = [Customer(name=f"Customer {i}") for i in range(2)]
        warehouse = Warehouse(name="Original warehouse", type="physical")
        db.add_all([*users, *customers, warehouse])
        await db.flush()
        locations = [AssetLocation(name=f"Location {i}", address=f"Address {i}", customer_id=customer.id)
                     for i, customer in enumerate(customers)]
        db.add_all(locations)
        await db.flush()
        normal = Ticket(number=1000, subject="Normal", body="Test", customer_id=customers[0].id,
                        location_id=locations[0].id, assignee_id=users[1].id,
                        response_deadline=datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=1),
                        resolution_deadline=datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=1))
        internal = Ticket(number=1001, subject="Internal", body="Required description", is_internal=True,
                          assignee_id=users[1].id, resolution_deadline=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=1))
        db.add_all([normal, internal])
        await db.commit()
    case = SimpleNamespace(factory=postgres_factory, users=users, customers=customers,
                           locations=locations, warehouse_id=warehouse.id, normal_id=normal.id,
                           internal_id=internal.id, actor=users[0])
    app = FastAPI()
    for router in (create_ticket_router(), warehouse_router, insert_v2_router, replacement_router,
                   admin_router, reports_router):
        app.include_router(router, prefix="/api")

    async def database():
        async with postgres_factory() as db:
            yield db

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_current_user] = lambda: case.actor
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
                                base_url="http://test") as client:
        case.client = client
        yield case


@pytest.mark.asyncio
async def test_m01_warehouse_object_acl(medium_case):
    c = medium_case
    c.actor = c.users[3]
    url = f"/api/warehouses/{c.warehouse_id}"
    assert (await c.client.patch(url, json={"name": "Forbidden"})).status_code == 403
    async with c.factory() as db:
        assert (await db.get(Warehouse, c.warehouse_id)).name == "Original warehouse"
        await db.execute(warehouse_access.insert().values(user_id=c.actor.id, warehouse_id=c.warehouse_id))
        await db.commit()
    assert (await c.client.patch(url, json={"name": "Allowed"})).status_code == 200
    c.actor = c.users[0]
    assert (await c.client.patch(url, json={"name": "Admin"})).status_code == 200
    c.actor = c.users[1]
    assert (await c.client.patch(url, json={"name": "Engineer"})).status_code == 403


@pytest.mark.asyncio
async def test_m02_internal_assignee_required_in_all_mutations(medium_case):
    c = medium_case
    deadline = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    assert (await c.client.post("/api/tickets", json={"is_internal": True, "body": "Description",
                                                   "resolution_deadline": deadline})).status_code == 422
    for suffix in ("", "/assign"):
        response = await c.client.patch(f"/api/tickets/{c.internal_id}{suffix}", json={"assignee_id": None})
        assert response.status_code == 422, response.text
    async with c.factory() as db:
        assert (await db.get(Ticket, c.internal_id)).assignee_id == c.users[1].id
        assert await db.scalar(select(func.count()).select_from(AuditLog)) == 0
    response = await c.client.patch(f"/api/tickets/{c.internal_id}/assign", json={"assignee_id": c.users[2].id})
    assert response.status_code == 200, response.text
    assert response.json()["assignee_name"] == c.users[2].name


@pytest.mark.asyncio
async def test_m02_normal_unassignment_and_assign_acl(medium_case):
    c = medium_case
    url = f"/api/tickets/{c.normal_id}/assign"
    response = await c.client.patch(url, json={"assignee_id": None})
    assert response.status_code == 200, response.text
    assert response.json()["assignee_id"] is None
    assert response.json()["assignee_name"] is None
    c.actor = c.users[1]
    assert (await c.client.patch(url, json={"assignee_id": c.users[2].id})).status_code == 403


@pytest.mark.asyncio
@pytest.mark.parametrize("params", [{"status": "NOT_A_STATUS"}, {"priority": "invalid"},
                                   {"type": "invalid"}, {"limit": 0}, {"limit": -1},
                                   {"limit": 201}, {"offset": -1}])
async def test_m03_invalid_ticket_filters_are_422(medium_case, params):
    response = await medium_case.client.get("/api/tickets", params=params)
    assert response.status_code == 422, response.text


@pytest.mark.asyncio
@pytest.mark.parametrize("field", ["subject", "body", "priority", "is_internal"])
async def test_m03_non_nullable_ticket_fields(medium_case, field):
    c = medium_case
    response = await c.client.patch(f"/api/tickets/{c.normal_id}", json={field: None})
    assert response.status_code == 422, response.text


@pytest.mark.asyncio
async def test_m03_product_limits_and_valid_enum_filters(medium_case):
    c = medium_case
    url = "/api/insert/products"
    assert (await c.client.post(url, json={"name": "Too long", "flange_type": "x" * 60})).status_code == 422
    valid = await c.client.post(url, json={"name": "Boundary", "flange_type": "x" * 50})
    assert valid.status_code == 201, valid.text
    product_id = valid.json()["id"]
    for data in ({"flange_type": "x" * 51}, {"name": None}):
        assert (await c.client.patch(f"{url}/{product_id}", json=data)).status_code == 422
    response = await c.client.post("/api/insert/transactions", json={"type": "incoming", "product_id": product_id,
                                                                  "quantity": 2147483648})
    assert response.status_code == 422
    async with c.factory() as db:
        assert (await db.get(InsertProduct, product_id)).flange_type == "x" * 50
    for status in TicketStatus:
        response = await c.client.get("/api/tickets", params={"status": status.value, "limit": 1, "offset": 0})
        assert response.status_code == 200, response.text


RESPONSE_FIELDS = ("customer_id", "customer_name", "location_id", "location_name", "location_address",
                   "assignee_id", "assignee_name", "response_overdue", "resolution_overdue", "is_archived")


@pytest.mark.asyncio
async def test_m04_patch_relationships_and_sla_match_get(medium_case):
    c = medium_case
    url = f"/api/tickets/{c.normal_id}"
    response = await c.client.patch(url, json={"customer_id": c.customers[1].id,
                                              "location_id": c.locations[1].id,
                                              "resolution_deadline": "2020-01-01T00:00:00Z"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["location_name"] == c.locations[1].name
    assert body["location_address"] == c.locations[1].address
    assert body["customer_name"] == c.customers[1].name
    assert body["assignee_name"] == c.users[1].name
    assert body["response_overdue"] is True
    assert body["resolution_overdue"] is True
    response = await c.client.patch(url, json={"assignee_id": c.users[2].id})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["assignee_name"] == c.users[2].name
    fetched = (await c.client.get(url)).json()
    assert {key: body[key] for key in RESPONSE_FIELDS} == {key: fetched[key] for key in RESPONSE_FIELDS}


@pytest.mark.asyncio
async def test_m04_post_status_complete_and_repeat_responses(medium_case):
    c = medium_case
    response = await c.client.post("/api/tickets", json={"subject": "Created", "customer_id": c.customers[0].id,
                                                       "location_id": c.locations[0].id,
                                                       "resolution_deadline": "2020-01-01T00:00:00Z"})
    assert response.status_code == 201, response.text
    assert response.json()["resolution_overdue"] is True
    ticket_id = response.json()["id"]
    url = f"/api/tickets/{ticket_id}"
    response = await c.client.patch(url + "/status", json={"status": "IN_PROGRESS"})
    assert response.status_code == 200, response.text
    assert response.json()["resolution_overdue"] is True
    for _ in range(2):
        response = await c.client.post(url + "/complete", json={"comment": ""})
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["status"] == "COMPLETED" and body["is_archived"] is True
        fetched = (await c.client.get(url)).json()
        assert {key: body[key] for key in RESPONSE_FIELDS} == {key: fetched[key] for key in RESPONSE_FIELDS}
    async with c.factory() as db:
        assert await db.scalar(select(func.count()).select_from(TicketTransition).where(
            TicketTransition.ticket_id == ticket_id, TicketTransition.to_status == TicketStatus.COMPLETED)) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("column,prefix", [("created_at", "date"), ("resolution_deadline", "deadline"),
                                         ("scheduled_end", "scheduled")])
async def test_m05_utc_month_boundaries_include_all_microseconds(medium_case, column, prefix):
    c = medium_case
    timestamps = [datetime(2026, 9, 30, 20, 59, 59, 999999), datetime(2026, 9, 30, 21),
                  datetime(2026, 10, 31, 20, 59, 59, 999999), datetime(2026, 10, 31, 21)]
    async with c.factory() as db:
        tickets = [Ticket(number=2000 + i, subject=f"Boundary {i}", body="", **{column: value})
                   for i, value in enumerate(timestamps)]
        db.add_all(tickets)
        await db.commit()
        ids = [ticket.id for ticket in tickets]
    response = await c.client.get("/api/tickets", params={f"{prefix}_from": "2026-09-30T21:00:00Z",
                                                         f"{prefix}_to": "2026-10-31T20:59:59.999999Z"})
    assert response.status_code == 200, response.text
    found = {ticket["id"] for ticket in response.json()} & set(ids)
    assert found == set(ids[1:3])


@pytest.mark.asyncio
async def test_m08_replacement_audit_persists_and_history_reads_db(medium_case):
    c = medium_case
    response = await c.client.post("/api/replacement/devices", json={"name": "Audit device", "serial_number": "TEST"})
    assert response.status_code == 201, response.text
    device_id = response.json()["id"]
    assert (await c.client.patch(f"/api/replacement/devices/{device_id}", json={"name": "Audit renamed"})).status_code == 200
    for kind, quantity in (("incoming", 2), ("outgoing", 1), ("return", 1)):
        response = await c.client.post("/api/replacement/transactions", json={"type": kind, "device_id": device_id,
                                                                           "quantity": quantity})
        assert response.status_code == 201, response.text
    async with c.factory() as fresh:
        events = (await fresh.execute(select(AuditLog).order_by(AuditLog.id))).scalars().all()
        assert [event.action for event in events] == ["replacement_device_created", "replacement_device_updated",
                                                     *["replacement_transaction_created"] * 3]
        assert [event.meta["type"] for event in events[2:]] == ["incoming", "outgoing", "return"]
    history = await c.client.get("/api/admin/history")
    assert history.status_code == 200 and len(history.json()["lines"]) == 5
    assert "Audit renamed" in history.json()["lines"][0]
    c.actor = c.users[3]
    assert (await c.client.get("/api/admin/history")).status_code == 403


async def deny_audit(factory):
    async with factory() as db:
        await db.execute(text("""CREATE FUNCTION deny_audit() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'synthetic audit storage failure'; END $$"""))
        await db.execute(text("CREATE TRIGGER deny_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION deny_audit()"))
        await db.commit()


@pytest.mark.asyncio
async def test_m08_audit_failure_rolls_back_business_action(medium_case):
    c = medium_case
    await deny_audit(c.factory)
    response = await c.client.post("/api/replacement/devices", json={"name": "Must roll back"})
    assert response.status_code == 500
    async with c.factory() as db:
        assert await db.scalar(select(func.count()).select_from(ReplacementDevice)) == 0
        assert await db.scalar(select(func.count()).select_from(AuditLog)) == 0


@pytest.mark.asyncio
async def test_m08_shared_business_audit_is_required_by_default(medium_case):
    c = medium_case
    await deny_audit(c.factory)
    response = await c.client.post("/api/tickets", json={"subject": "Must roll back",
                                                       "customer_id": c.customers[0].id,
                                                       "location_id": c.locations[0].id})
    assert response.status_code == 500
    async with c.factory() as db:
        assert await db.scalar(select(func.count()).select_from(Ticket)) == 2
        assert await db.scalar(select(func.count()).select_from(AuditLog)) == 0


@pytest.mark.asyncio
async def test_m08_audit_failure_rolls_back_update_and_transaction(medium_case):
    c = medium_case
    async with c.factory() as db:
        device = ReplacementDevice(name="Original", serial_number="TEST")
        db.add(device)
        await db.commit()
        device_id = device.id
    await deny_audit(c.factory)
    response = await c.client.patch(f"/api/replacement/devices/{device_id}", json={"name": "Changed"})
    assert response.status_code == 500
    response = await c.client.post("/api/replacement/transactions", json={"type": "incoming", "device_id": device_id,
                                                                       "quantity": 1})
    assert response.status_code == 500
    async with c.factory() as db:
        assert (await db.get(ReplacementDevice, device_id)).name == "Original"
        assert await db.scalar(select(func.count()).select_from(ReplacementTransaction)) == 0
        assert await db.scalar(select(func.count()).select_from(AuditLog)) == 0


@pytest.mark.asyncio
async def test_m07_missing_mandatory_checkbox_rolls_back_completion_comment(medium_case):
    c = medium_case
    url = f"/api/tickets/{c.normal_id}"
    assert (await c.client.patch(url + "/status", json={"status": "IN_PROGRESS"})).status_code == 200
    async with c.factory() as db:
        checklist = Checklist(ticket_id=c.normal_id, name="Required")
        db.add(checklist)
        await db.flush()
        db.add(ChecklistField(checklist_id=checklist.id, label="Check", field_type=FieldType.checkbox,
                              is_mandatory=True, value="false"))
        await db.commit()
    response = await c.client.post(url + "/complete", json={"comment": "Must roll back"})
    assert response.status_code == 409, response.text
    async with c.factory() as db:
        ticket = await db.get(Ticket, c.normal_id)
        assert ticket.status == TicketStatus.IN_PROGRESS and ticket.archived_at is None
        assert await db.scalar(select(func.count()).select_from(Comment).where(Comment.ticket_id == c.normal_id)) == 0
        assert await db.scalar(select(func.count()).select_from(TicketTransition).where(
            TicketTransition.ticket_id == c.normal_id, TicketTransition.to_status == TicketStatus.COMPLETED)) == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("operation,status", [("approve", UserStatus.active), ("reject", UserStatus.rejected)])
@pytest.mark.parametrize("audit_fails", [False, True])
async def test_m08_user_moderation_atomic_audit(medium_case, operation, status, audit_fails):
    c = medium_case
    async with c.factory() as db:
        pending = User(email="pending@example.test", name="Pending", role=UserRole.engineer,
                       status=UserStatus.pending, password_hash="test-only")
        db.add(pending)
        await db.commit()
        user_id = pending.id
    if audit_fails:
        await deny_audit(c.factory)
    response = await c.client.post(f"/api/admin/pending-users/{user_id}/{operation}")
    assert response.status_code == (500 if audit_fails else 200), response.text
    async with c.factory() as db:
        assert (await db.get(User, user_id)).status == (UserStatus.pending if audit_fails else status)
        assert await db.scalar(select(func.count()).select_from(AuditLog)) == (0 if audit_fails else 1)


@pytest.mark.asyncio
async def test_m08_rejected_operation_creates_no_audit(medium_case):
    c = medium_case
    async with c.factory() as db:
        device = ReplacementDevice(name="Empty", serial_number="TEST")
        db.add(device)
        await db.commit()
        device_id = device.id
    response = await c.client.post("/api/replacement/transactions", json={"type": "outgoing", "device_id": device_id,
                                                                       "quantity": 1})
    assert response.status_code == 400
    async with c.factory() as db:
        assert await db.scalar(select(func.count()).select_from(ReplacementTransaction)) == 0
        assert await db.scalar(select(func.count()).select_from(AuditLog)) == 0


@pytest.mark.asyncio
async def test_m09_report_server_acl_unchanged(medium_case):
    c = medium_case
    for actor, expected in ((c.users[0], 200), (c.users[1], 403), (c.users[3], 403), (c.users[4], 403)):
        c.actor = actor
        response = await c.client.get("/api/reports/tickets")
        assert response.status_code == expected, response.text


def test_medium_report_and_staging_remain_private(tmp_path):
    from tests.test_high_backup_publication import module

    assert module("check_publication").forbidden_path("MEDIUM_FIX_REPORT.md")
    assert module("check_publication").forbidden_path(".medium-test/evidence.txt")
    (tmp_path / "MEDIUM_FIX_REPORT.md").write_text("Synthetic private report")
    staging = tmp_path / ".medium-test"
    staging.mkdir()
    (staging / "evidence.txt").write_text("Synthetic private evidence")
    assert list(module("backup").project_files(tmp_path)) == []
