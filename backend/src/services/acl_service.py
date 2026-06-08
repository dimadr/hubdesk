from src.models.user import User, UserRole
from src.models.ticket import Ticket


class RoleChecker:
    TRANSITION_ROLES: dict[str, list[UserRole]] = {
        "ASSIGNED->ACCEPTED":     [UserRole.engineer],
        "ACCEPTED->ON_THE_WAY":   [UserRole.engineer],
        "ON_THE_WAY->ARRIVED":    [UserRole.engineer],
        "ARRIVED->IN_PROGRESS":   [UserRole.engineer],
        "IN_PROGRESS->REVIEW":    [UserRole.engineer],
        "REVIEW->COMPLETED":      [UserRole.engineer],
    }

    @staticmethod
    def can_view_ticket(user: User, ticket: Ticket) -> bool:
        if user.role in (UserRole.admin, UserRole.dispatcher, UserRole.viewer):
            return True
        if user.role == UserRole.engineer:
            return ticket.assignee_id == user.id
        if user.role == UserRole.customer:
            return ticket.customer_id == user.id
        return False

    @staticmethod
    def can_change_status(user: User, ticket: Ticket, target: str) -> bool:
        if user.role == UserRole.admin:
            return True
        key = f"{ticket.status.value}->{target}"
        allowed_roles = RoleChecker.TRANSITION_ROLES.get(key, [])
        return user.role in allowed_roles

    @staticmethod
    def can_see_comment(user: User, comment) -> bool:
        if user.role in (UserRole.admin, UserRole.dispatcher, UserRole.viewer):
            return True
        if comment.is_internal:
            return False
        return True

    @staticmethod
    def can_assign(user: User) -> bool:
        return user.role in (UserRole.admin, UserRole.dispatcher)

    @staticmethod
    def can_manage_warehouse(user: User) -> bool:
        return user.role in (UserRole.admin, UserRole.storekeeper)
