import pytest
from unittest.mock import AsyncMock, MagicMock
from src.services.ticket_fsm import TicketFSM
from src.core.fsm.exceptions import GuardFailedError
from src.models.checklist import FieldType


@pytest.fixture
def fsm():
    session = AsyncMock()
    return TicketFSM(session)


@pytest.fixture
def ticket():
    t = MagicMock()
    t.status.value = "ASSIGNED"
    t.id = 1
    t.checklists = []
    return t


@pytest.mark.asyncio
async def test_valid_transition(fsm, ticket):
    ticket.status.value = "ASSIGNED"
    await fsm.transition(ticket, "ACCEPTED", user_id=1)
    assert ticket.status == "ACCEPTED"


@pytest.mark.asyncio
async def test_engineer_can_start_assigned_ticket(fsm, ticket):
    ticket.status.value = "ASSIGNED"
    await fsm.transition(ticket, "IN_PROGRESS", user_id=1)
    assert ticket.status == "IN_PROGRESS"


@pytest.mark.asyncio
async def test_complete_requires_checklist(fsm, ticket):
    ticket.status.value = "IN_PROGRESS"
    f = MagicMock()
    f.is_mandatory = True
    f.value = None
    ticket.checklists = [MagicMock(fields=[f])]
    with pytest.raises(GuardFailedError, match="checklist_complete"):
        await fsm.transition(ticket, "COMPLETED", user_id=1)


def test_acl_engineer_can_accept():
    from src.services.acl_service import RoleChecker
    from src.models.user import User, UserRole
    t = MagicMock()
    t.status.value = "ASSIGNED"
    u = MagicMock()
    u.role = UserRole.engineer
    assert RoleChecker.can_change_status(u, t, "ACCEPTED") is True


def test_acl_customer_cannot_accept():
    from src.services.acl_service import RoleChecker
    from src.models.user import UserRole
    t = MagicMock()
    t.status.value = "ASSIGNED"
    u = MagicMock()
    u.role = UserRole.customer
    assert RoleChecker.can_change_status(u, t, "ACCEPTED") is False


@pytest.mark.asyncio
async def test_checklist_false_blocks_completion(fsm, ticket):
    ticket.status.value = "IN_PROGRESS"
    f = MagicMock()
    f.is_mandatory = True
    f.value = "false"
    ticket.checklists = [MagicMock(fields=[f])]
    with pytest.raises(GuardFailedError, match="checklist_complete"):
        await fsm.transition(ticket, "COMPLETED", user_id=1)


@pytest.mark.asyncio
async def test_checklist_whitespace_blocks_completion(fsm, ticket):
    ticket.status.value = "IN_PROGRESS"
    f = MagicMock()
    f.is_mandatory = True
    f.value = "   "
    ticket.checklists = [MagicMock(fields=[f])]
    with pytest.raises(GuardFailedError, match="checklist_complete"):
        await fsm.transition(ticket, "COMPLETED", user_id=1)


@pytest.mark.asyncio
async def test_checklist_filled_allows_completion(fsm, ticket):
    ticket.status.value = "IN_PROGRESS"
    f = MagicMock()
    f.is_mandatory = True
    f.value = "выполнено"
    f.field_type = MagicMock()
    f.field_type.value = "checkbox"
    ticket.checklists = [MagicMock(fields=[f])]
    await fsm.transition(ticket, "COMPLETED", user_id=1)
    assert ticket.status == "COMPLETED"


@pytest.mark.asyncio
async def test_mandatory_photo_requires_image_attachment(fsm, ticket):
    ticket.status.value = "IN_PROGRESS"
    field = MagicMock()
    field.is_mandatory = True
    field.field_type = FieldType.photo
    field.value = "fake-client-value"
    ticket.checklists = [MagicMock(fields=[field])]
    result = MagicMock()
    result.scalar.return_value = 0
    fsm.session.execute.return_value = result

    with pytest.raises(GuardFailedError, match="mandatory_photos"):
        await fsm.transition(ticket, "COMPLETED", user_id=1)


@pytest.mark.asyncio
async def test_mandatory_photo_allows_completion_with_image_attachment(fsm, ticket):
    ticket.status.value = "IN_PROGRESS"
    field = MagicMock()
    field.is_mandatory = True
    field.field_type = FieldType.photo
    field.value = None
    ticket.checklists = [MagicMock(fields=[field])]
    result = MagicMock()
    result.scalar.return_value = 1
    fsm.session.execute.return_value = result

    await fsm.transition(ticket, "COMPLETED", user_id=1)
    assert ticket.status == "COMPLETED"


def test_acl_admin_can_change_any_status():
    from src.services.acl_service import RoleChecker
    from src.models.user import UserRole
    t = MagicMock()
    t.status.value = "ASSIGNED"
    u = MagicMock()
    u.role = UserRole.admin
    assert RoleChecker.can_change_status(u, t, "COMPLETED") is True


def test_engineer_create_overrides_client_assignee():
    from src.models.user import UserRole
    from src.services.ticket_service import TicketService

    user = MagicMock(id=7, role=UserRole.engineer)
    normalized = TicketService._normalize_create_data(
        {"subject": "Test", "assignee_id": 99},
        user,
    )

    assert normalized["assignee_id"] == 7


@pytest.mark.asyncio
async def test_viewer_cannot_modify_ticket():
    from src.models.user import UserRole
    from src.services.acl_service import RoleChecker

    user = MagicMock(role=UserRole.viewer, id=10)
    ticket = MagicMock(assignee_id=10)

    assert await RoleChecker.can_modify_ticket_async(user, ticket, AsyncMock()) is False


@pytest.mark.asyncio
async def test_assigned_engineer_can_modify_ticket():
    from src.models.user import UserRole
    from src.services.acl_service import RoleChecker

    user = MagicMock(role=UserRole.engineer, id=10)
    ticket = MagicMock(assignee_id=10)

    assert await RoleChecker.can_modify_ticket_async(user, ticket, AsyncMock()) is True


@pytest.mark.asyncio
async def test_reopen_clears_completion_timestamps(monkeypatch):
    from datetime import datetime
    from src.models.user import UserRole
    from src.services import ticket_service
    from src.services.acl_service import RoleChecker
    from src.services.ticket_service import TicketService

    session = AsyncMock()
    service = TicketService(session)
    completed_at = datetime(2026, 7, 28, 10, 0)
    ticket = MagicMock()
    ticket.id = 1
    ticket.number = 1001
    ticket.status.value = "COMPLETED"
    ticket.completed_at = completed_at
    ticket.archived_at = completed_at
    ticket.created_by = None
    user = MagicMock(id=2, role=UserRole.dispatcher)

    service._get = AsyncMock(return_value=ticket)
    service.fsm.transition = AsyncMock()
    monkeypatch.setattr(
        RoleChecker, "can_view_ticket_async", AsyncMock(return_value=True)
    )
    monkeypatch.setattr(RoleChecker, "can_change_status", lambda *_args: True)
    monkeypatch.setattr(ticket_service, "log_audit", AsyncMock())

    await service.change_status(ticket.id, "IN_PROGRESS", user)

    assert ticket.completed_at is None
    assert ticket.archived_at is None
