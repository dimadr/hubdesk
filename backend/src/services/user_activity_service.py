from datetime import datetime, timedelta, timezone

from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.user import User


class UserActivityService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def record(self, user_id: int) -> None:
        now = datetime.now(timezone.utc)
        await self.session.execute(
            update(User)
            .where(User.id == user_id, or_(User.last_active_at.is_(None),
                                         User.last_active_at <= now - timedelta(minutes=1)))
            .values(last_active_at=now)
            .execution_options(synchronize_session=False)
        )

    async def list_activity(self):
        return (await self.session.execute(
            select(User.id, User.last_active_at).order_by(User.id)
        )).mappings().all()
