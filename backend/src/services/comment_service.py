from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from src.models.comment import Comment
from src.models.user import User, UserRole


class CommentService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def add(self, ticket_id: int, body: str, is_internal: bool, user: User) -> Comment:
        if user.role == UserRole.customer and is_internal:
            raise PermissionError("Customer cannot create internal comments")
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
        stmt = select(Comment).where(Comment.ticket_id == ticket_id)
        result = await self.session.execute(stmt)
        comments = result.scalars().all()
        if user.role in (UserRole.customer, UserRole.engineer):
            comments = [c for c in comments if not c.is_internal]
        return comments
