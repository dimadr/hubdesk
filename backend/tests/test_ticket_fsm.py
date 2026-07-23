import pytest
from unittest.mock import AsyncMock, MagicMock
from src.services.ticket_fsm import TicketFSM
from src.core.fsm.exceptions import InvalidTransitionError, GuardFailedError


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
async def test_skip_transition_fails(fsm, ticket):
    ticket.status.value = "ASSIGNED"
    with pytest.raises(InvalidTransitionError):
        await fsm.transition(ticket, "IN_PROGRESS", user_id=1)


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


def test_acl_admin_can_change_any_status():
    from src.services.acl_service import RoleChecker
    from src.models.user import UserRole
    t = MagicMock()
    t.status.value = "ASSIGNED"
    u = MagicMock()
    u.role = UserRole.admin
    assert RoleChecker.can_change_status(u, t, "COMPLETED") is True
