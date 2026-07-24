from src.models.user import User, UserRole
from src.models.ticket import Ticket
from src.models.customer import Customer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import logging

logger = logging.getLogger(__name__)


class RoleChecker:
    TRANSITION_ROLES: dict[str, list[UserRole]] = {
        "ASSIGNED->ACCEPTED":     [UserRole.engineer],
        "ACCEPTED->IN_PROGRESS":  [UserRole.engineer],
        "IN_PROGRESS->COMPLETED": [UserRole.engineer, UserRole.dispatcher],
    }

    @staticmethod
    def can_view_ticket(user: User, ticket: Ticket) -> bool:
        if user.role in (UserRole.admin, UserRole.director, UserRole.dispatcher, UserRole.viewer):
            return True
        if user.role == UserRole.engineer:
            return ticket.assignee_id == user.id
        if user.role == UserRole.customer:
            return ticket.customer_id is not None and user.customer_id is not None and ticket.customer_id == user.customer_id
        return False

    @staticmethod
    async def can_view_ticket_async(user: User, ticket: Ticket, db: AsyncSession) -> bool:
        if user.role in (UserRole.admin, UserRole.director, UserRole.dispatcher, UserRole.viewer):
            return True
        if user.role == UserRole.engineer:
            return ticket.assignee_id == user.id
        if user.role == UserRole.customer:
            if ticket.customer_id is None or user.customer_id is None:
                return False
            return ticket.customer_id == user.customer_id
        return False

    @staticmethod
    def can_change_status(user: User, ticket: Ticket, target: str) -> bool:
        if user.role in (UserRole.admin, UserRole.director):
            return True
        target_val = target.value if hasattr(target, 'value') else str(target)
        from_val = ticket.status.value if hasattr(ticket.status, 'value') else str(ticket.status)
        key = f"{from_val}->{target_val}"
        allowed_roles = RoleChecker.TRANSITION_ROLES.get(key, [])
        return user.role in allowed_roles

    @staticmethod
    def can_see_comment(user: User, comment) -> bool:
        if user.role in (UserRole.admin, UserRole.director, UserRole.dispatcher, UserRole.viewer):
            return True
        if comment.is_internal:
            return False
        return True

    @staticmethod
    def can_assign(user: User) -> bool:
        return user.role in (UserRole.admin, UserRole.director, UserRole.dispatcher)

    @staticmethod
    def can_manage_warehouse(user: User) -> bool:
        return user.role in (UserRole.admin, UserRole.director, UserRole.storekeeper)
