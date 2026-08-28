import pytest
from unittest.mock import AsyncMock, MagicMock
from src.services.ticket_fsm import TicketFSM
from src.core.fsm.exceptions import GuardFailedError, InvalidTransitionError
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
@pytest.mark.parametrize(
    ("current", "target"),
    [
        ("ACCEPTED", "ASSIGNED"),
        ("IN_PROGRESS", "ACCEPTED"),
        ("IN_PROGRESS", "ASSIGNED"),
        ("COMPLETED", "IN_PROGRESS"),
    ],
)
async def test_reverse_transitions_are_rejected(fsm, ticket, current, target):
    ticket.status.value = current
    with pytest.raises(InvalidTransitionError):
        await fsm.transition(ticket, target, user_id=1)


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
    result.scalars.return_value.all.return_value = []
    fsm.session.execute.return_value = result

    with pytest.raises(GuardFailedError, match="mandatory_photos"):
        await fsm.transition(ticket, "COMPLETED", user_id=1)


@pytest.mark.asyncio
async def test_mandatory_photo_allows_completion_with_image_attachment(fsm, ticket):
    ticket.status.value = "IN_PROGRESS"
    field = MagicMock()
    field.is_mandatory = True
    field.field_type = FieldType.photo
    field.value = "Фото: result.jpg"
    ticket.checklists = [MagicMock(fields=[field])]
    result = MagicMock()
    result.scalars.return_value.all.return_value = ["result.jpg"]
    fsm.session.execute.return_value = result

    await fsm.transition(ticket, "COMPLETED", user_id=1)
    assert ticket.status == "COMPLETED"


@pytest.mark.asyncio
async def test_mandatory_photo_requires_each_field_to_reference_own_attachment(fsm, ticket):
    ticket.status.value = "IN_PROGRESS"
    first = MagicMock(is_mandatory=True, field_type=FieldType.photo, value="Фото: result.jpg")
    second = MagicMock(is_mandatory=True, field_type=FieldType.photo, value="Фото: result.jpg")
    ticket.checklists = [MagicMock(fields=[first, second])]
    result = MagicMock()
    result.scalars.return_value.all.return_value = ["result.jpg"]
    fsm.session.execute.return_value = result

    with pytest.raises(GuardFailedError, match="mandatory_photos"):
        await fsm.transition(ticket, "COMPLETED", user_id=1)


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


def test_internal_ticket_normalization_clears_object_fields():
    from datetime import datetime
    from src.models.user import UserRole
    from src.services.ticket_service import TicketService

    user = MagicMock(id=7, role=UserRole.engineer)
    normalized = TicketService._normalize_create_data(
        {
            "is_internal": True,
            "body": "Проверить внутреннюю сеть\nв серверной",
            "source_description": "Проверить резервный канал",
            "resolution_deadline": datetime(2026, 8, 10, 23, 59, 59),
            "assignee_id": 99,
            "customer_id": 1,
            "location_id": 2,
            "site_contact_name": "Не должен сохраниться",
        },
        user,
    )

    assert normalized["subject"] == "Проверить внутреннюю сеть"
    assert normalized["assignee_id"] == 7
    assert normalized["customer_id"] is None
    assert normalized["location_id"] is None
    assert normalized["site_contact_name"] is None


def test_internal_ticket_does_not_require_addition():
    from datetime import datetime
    from src.services.ticket_service import TicketService

    normalized = TicketService._normalize_create_data(
        {
            "is_internal": True,
            "body": "Описание",
            "source_description": "Старое значение",
            "resolution_deadline": datetime(2026, 8, 10, 23, 59, 59),
            "assignee_id": 7,
        },
        None,
    )

    assert normalized["source_description"] is None


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
async def test_accountant_has_full_ticket_permissions():
    from src.models.user import UserRole
    from src.services.acl_service import RoleChecker

    user = MagicMock(role=UserRole.accountant, id=10)
    ticket = MagicMock(assignee_id=None)
    ticket.status.value = "ASSIGNED"

    assert RoleChecker.can_view_ticket(user, ticket) is True
    assert await RoleChecker.can_view_ticket_async(user, ticket, AsyncMock()) is True
    assert await RoleChecker.can_modify_ticket_async(user, ticket, AsyncMock()) is True
    assert RoleChecker.can_assign(user) is True
    assert RoleChecker.can_change_status(user, ticket, "ACCEPTED") is True


@pytest.mark.asyncio
async def test_inactive_engineer_is_not_assignable():
    from src.models.user import UserRole, UserStatus
    from src.services.ticket_service import TicketService

    session = AsyncMock()
    session.get.return_value = MagicMock(
        role=UserRole.engineer,
        status=UserStatus.pending,
    )

    assert await TicketService(session)._is_engineer(7) is False


@pytest.mark.asyncio
async def test_completion_comment_and_attachments_become_internal(monkeypatch):
    from src.models.user import UserRole
    from src.services import ticket_service
    from src.services.acl_service import RoleChecker
    from src.services.ticket_service import TicketService

    session = AsyncMock()
    service = TicketService(session)
    ticket = MagicMock(id=1)
    ticket.status.value = "IN_PROGRESS"
    user = MagicMock(id=2, role=UserRole.engineer)
    attachment = MagicMock(id=5, ticket_id=1, comment_id=None, is_internal=False)
    result = MagicMock()
    result.scalars.return_value.all.return_value = [attachment]
    session.execute.return_value = result
    service._get = AsyncMock(return_value=ticket)
    service.change_status = AsyncMock(return_value=ticket)
    comment = MagicMock(id=9)
    add_comment = AsyncMock(return_value=comment)
    monkeypatch.setattr(
        RoleChecker, "can_view_ticket_async", AsyncMock(return_value=True)
    )
    monkeypatch.setattr(ticket_service.CommentService, "add", add_comment)

    await service.complete(1, "Выполнено", user, [5])

    add_comment.assert_awaited_once_with(1, "Выполнено", True, user)
    assert attachment.comment_id == 9
    assert attachment.is_internal is True


@pytest.mark.asyncio
async def test_invalid_transition_returns_conflict(monkeypatch):
    from fastapi import HTTPException
    from src.core.fsm.exceptions import InvalidTransitionError
    from src.models.user import UserRole
    from src.services import ticket_service
    from src.services.acl_service import RoleChecker
    from src.services.ticket_service import TicketService

    service = TicketService(AsyncMock())
    ticket = MagicMock(id=1, number=1001, created_by=None)
    ticket.status.value = "ASSIGNED"
    user = MagicMock(id=2, role=UserRole.admin)
    service._get = AsyncMock(return_value=ticket)
    service.fsm.transition = AsyncMock(
        side_effect=InvalidTransitionError("ASSIGNED", "COMPLETED", 1)
    )
    monkeypatch.setattr(
        RoleChecker, "can_view_ticket_async", AsyncMock(return_value=True)
    )
    monkeypatch.setattr(RoleChecker, "can_change_status", lambda *_args: True)
    monkeypatch.setattr(ticket_service, "log_audit", AsyncMock())

    with pytest.raises(HTTPException) as exc_info:
        await service.change_status(ticket.id, "COMPLETED", user)

    assert exc_info.value.status_code == 409
    assert "ASSIGNED" in exc_info.value.detail
    assert "COMPLETED" in exc_info.value.detail
