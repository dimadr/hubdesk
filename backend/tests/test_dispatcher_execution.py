import pytest
from sqlalchemy import func, select

from src.config import settings
from src.models.audit_log import AuditLog
from src.models.checklist import Checklist, ChecklistField, FieldType
from src.models.ticket import Ticket, TicketStatus, TicketTransition
from src.models.user import User, UserRole, UserStatus
from src.services.acl_service import RoleChecker
from tests.test_dispatcher_assignment import dispatcher_case


@pytest.mark.parametrize("current,target", [
    ("ASSIGNED", "ACCEPTED"), ("ASSIGNED", "IN_PROGRESS"),
    ("ACCEPTED", "IN_PROGRESS"), ("IN_PROGRESS", "COMPLETED"),
])
def test_personal_dispatcher_execution_acl(monkeypatch, current, target):
    user = User(id=101, role=UserRole.dispatcher, status=UserStatus.active)
    ticket = Ticket(status=TicketStatus(current), assignee_id=user.id)
    monkeypatch.setattr(settings, "dispatcher_self_assignment_user_ids", [user.id])
    assert RoleChecker.can_change_status(user, ticket, target)
    if target != "COMPLETED":
        ticket.assignee_id = 202
        assert not RoleChecker.can_change_status(user, ticket, target)
        ticket.assignee_id = user.id
        monkeypatch.setattr(settings, "dispatcher_self_assignment_user_ids", [])
        assert not RoleChecker.can_change_status(user, ticket, target)


@pytest.mark.asyncio
async def test_dispatcher_can_accept_own_ticket(dispatcher_case):
    c = dispatcher_case
    created = await c.client.post("/api/tickets", json=c.payload(), headers=c.headers())
    assert created.status_code == 201
    response = await c.client.patch(f'/api/tickets/{created.json()["id"]}/status',
                                    json={"status": "ACCEPTED"}, headers=c.headers())
    assert response.status_code == 200, response.text


@pytest.mark.asyncio
@pytest.mark.parametrize("internal", [False, True])
@pytest.mark.parametrize("direct_start", [False, True])
async def test_dispatcher_own_ticket_lifecycle(dispatcher_case, internal, direct_start):
    c = dispatcher_case
    created = await c.client.post("/api/tickets", json=c.payload(0, internal), headers=c.headers())
    assert created.status_code == 201, created.text
    ticket_id = created.json()["id"]
    url = f"/api/tickets/{ticket_id}"
    assert created.json()["allowed_statuses"] == ["ACCEPTED", "IN_PROGRESS"]
    listed = (await c.client.get("/api/tickets", headers=c.headers())).json()
    assert next(t for t in listed if t["id"] == ticket_id)["allowed_statuses"] == ["ACCEPTED", "IN_PROGRESS"]
    targets = ["IN_PROGRESS"] if direct_start else ["ACCEPTED", "IN_PROGRESS"]
    for target in targets:
        response = await c.client.patch(url + "/status", json={"status": target}, headers=c.headers())
        assert response.status_code == 200, response.text
        assert response.json()["status"] == target
        assert response.json()["allowed_statuses"] == (["IN_PROGRESS"] if target == "ACCEPTED" else ["COMPLETED"])
    response = await c.client.post(url + "/complete", json={"comment": "Done"}, headers=c.headers())
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "COMPLETED"
    assert response.json()["is_archived"]
    assert response.json()["allowed_statuses"] == []
    repeated = await c.client.patch(url + "/status", json={"status": "COMPLETED"}, headers=c.headers())
    assert repeated.status_code == 200
    async with c.factory() as db:
        transitions = list((await db.scalars(select(TicketTransition).order_by(TicketTransition.id))).all())
        assert [t.to_status for t in transitions] == [*targets, "COMPLETED"]
        assert all(t.user_id == c.users[0].id for t in transitions)
        assert await db.scalar(select(func.count()).select_from(AuditLog)) == len(targets) + 2
        saved = await db.get(Ticket, ticket_id)
        assert saved.archived_at is not None
        assert (saved.accepted_at is None) == direct_start
    reversed_request = await c.client.patch(url + "/status", json={"status": "IN_PROGRESS"}, headers=c.headers())
    assert reversed_request.status_code in (400, 409)


@pytest.mark.asyncio
@pytest.mark.parametrize("actor,target", [(0, 2), (1, 1), (1, 0)])
@pytest.mark.parametrize("status", ["ACCEPTED", "IN_PROGRESS"])
async def test_execution_does_not_expand_other_ticket_or_dispatcher_rights(dispatcher_case, actor, target, status):
    c = dispatcher_case
    created = await c.client.post("/api/tickets", json=c.payload(target), headers=c.headers(6))
    assert created.status_code == 201
    url = f'/api/tickets/{created.json()["id"]}'
    detail = await c.client.get(url, headers=c.headers(actor))
    assert detail.json()["allowed_statuses"] == []
    response = await c.client.patch(url + "/status", json={"status": status}, headers=c.headers(actor))
    assert response.status_code == 400, response.text
    async with c.factory() as db:
        assert (await db.get(Ticket, created.json()["id"])).status == TicketStatus.ASSIGNED
        assert await db.scalar(select(func.count()).select_from(TicketTransition)) == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("revocation", ["grant", "assignee", "inactive"])
async def test_execution_grant_is_rechecked_on_each_request(dispatcher_case, monkeypatch, revocation):
    c = dispatcher_case
    created = await c.client.post("/api/tickets", json=c.payload(), headers=c.headers())
    assert created.status_code == 201
    url = f'/api/tickets/{created.json()["id"]}'
    if revocation == "grant":
        monkeypatch.setattr(settings, "dispatcher_self_assignment_user_ids", [])
    elif revocation == "assignee":
        response = await c.client.patch(url + "/assign", json={"assignee_id": c.users[2].id}, headers=c.headers())
        assert response.status_code == 200
        assert response.json()["allowed_statuses"] == []
    else:
        async with c.factory() as db:
            (await db.get(User, c.users[0].id)).status = UserStatus.rejected
            await db.commit()
    response = await c.client.patch(url + "/status", json={"status": "ACCEPTED"}, headers=c.headers())
    assert response.status_code == (403 if revocation == "inactive" else 400), response.text


@pytest.mark.asyncio
async def test_dispatcher_completion_still_requires_mandatory_checklist(dispatcher_case):
    c = dispatcher_case
    created = await c.client.post("/api/tickets", json=c.payload(), headers=c.headers())
    ticket_id = created.json()["id"]
    url = f"/api/tickets/{ticket_id}"
    assert (await c.client.patch(url + "/status", json={"status": "IN_PROGRESS"}, headers=c.headers())).status_code == 200
    async with c.factory() as db:
        checklist = Checklist(ticket_id=ticket_id, name="Required")
        db.add(checklist)
        await db.flush()
        db.add(ChecklistField(checklist_id=checklist.id, label="Result", field_type=FieldType.checkbox,
                              is_mandatory=True, value="false"))
        await db.commit()
    response = await c.client.post(url + "/complete", json={"comment": "Not yet"}, headers=c.headers())
    assert response.status_code == 409, response.text
    async with c.factory() as db:
        assert (await db.get(Ticket, ticket_id)).status == TicketStatus.IN_PROGRESS
        assert await db.scalar(select(func.count()).select_from(TicketTransition)) == 1


@pytest.mark.asyncio
async def test_engineer_permissions_and_ordinary_dispatcher_completion_unchanged(dispatcher_case):
    c = dispatcher_case
    created = await c.client.post("/api/tickets", json=c.payload(2), headers=c.headers())
    url = f'/api/tickets/{created.json()["id"]}'
    detail = (await c.client.get(url, headers=c.headers(2))).json()
    assert detail["allowed_statuses"] == ["ACCEPTED", "IN_PROGRESS"]
    assert (await c.client.patch(url + "/status", json={"status": "IN_PROGRESS"}, headers=c.headers(2))).status_code == 200
    assert (await c.client.get(url, headers=c.headers(1))).json()["allowed_statuses"] == ["COMPLETED"]
    assert (await c.client.post(url + "/complete", json={}, headers=c.headers(1))).status_code == 200
