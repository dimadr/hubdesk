from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from src.models.comment import Comment
from src.models.ticket import Ticket
from src.models.user import User, UserRole
from src.services.acl_service import RoleChecker


class CommentService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def add(self, ticket_id: int, body: str, is_internal: bool, user: User) -> Comment:
        if user.role == UserRole.customer and is_internal:
            raise PermissionError("Customer cannot create internal comments")
        ticket = await self.session.get(Ticket, ticket_id)
        if not ticket:
            raise ValueError("Заявка не найдена")
        if not await RoleChecker.can_view_ticket_async(user, ticket, self.session):
            raise PermissionError("Нет доступа к заявке")
        comment = Comment(
            ticket_id=ticket_id,
            user_id=user.id,
            body=body,
            is_internal=is_internal,
        )
        self.session.add(comment)
        await self.session.flush()
        return comment

    async def get_for_ticket(self, ticket_id: int, user: User) -> list[Comment]:
        ticket = await self.session.get(Ticket, ticket_id)
        if not ticket:
            return []
        if not await RoleChecker.can_view_ticket_async(user, ticket, self.session):
            return []
        stmt = select(Comment).where(Comment.ticket_id == ticket_id).options(selectinload(Comment.user))
        result = await self.session.execute(stmt)
        comments = result.scalars().all()
        if user.role in (UserRole.customer, UserRole.engineer):
            comments = [c for c in comments if not c.is_internal]
        return comments
