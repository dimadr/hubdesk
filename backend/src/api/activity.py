from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.deps import get_current_user
from src.database import get_db
from src.models.user import User
from src.services.user_activity_service import UserActivityService

activity_router = APIRouter(tags=["Activity"])


@activity_router.post("/activity", status_code=204)
async def record_activity(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await UserActivityService(db).record(user.id)
    await db.commit()
    return Response(status_code=204)
