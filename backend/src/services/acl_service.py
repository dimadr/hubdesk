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
            return ticket.customer_id is not None and ticket.customer_id == getattr(user, '_customer_id', None)
        return False

    @staticmethod
    async def can_view_ticket_async(user: User, ticket: Ticket, db: AsyncSession) -> bool:
        if user.role in (UserRole.admin, UserRole.director, UserRole.dispatcher, UserRole.viewer):
            return True
        if user.role == UserRole.engineer:
            return ticket.assignee_id == user.id
        if user.role == UserRole.customer:
            if ticket.customer_id is None:
                return False
            result = await db.execute(
                select(Customer.id).where(Customer.name == user.name)
            )
            cust_id = result.scalar_one_or_none()
            return cust_id is not None and ticket.customer_id == cust_id
        return False

    @staticmethod
    def can_change_status(user: User, ticket: Ticket, target: str) -> bool:
        if user.role in (UserRole.admin, UserRole.director):
            return True
        key = f"{ticket.status.value}->{target}"
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
