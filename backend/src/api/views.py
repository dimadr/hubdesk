from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from src.database import get_db
from src.models.views import SavedView
from src.api.schemas import SavedViewCreate, SavedViewResponse
from src.core.deps import get_current_user

views_router = APIRouter(prefix="/views", tags=["Views"])


@views_router.get("", response_model=list[SavedViewResponse])
async def list_views(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(SavedView).where(SavedView.user_id == user.id))
    return [SavedViewResponse.model_validate(v) for v in result.scalars().all()]


@views_router.post("", status_code=201, response_model=SavedViewResponse)
async def create_view(
    data: SavedViewCreate,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    view = SavedView(user_id=user.id, **data.model_dump())
    db.add(view)
    await db.flush()
    await db.commit()
    return SavedViewResponse.model_validate(view)


@views_router.delete("/{view_id}", status_code=204)
async def delete_view(view_id: int, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    view = await db.get(SavedView, view_id)
    if view and view.user_id == user.id:
        await db.delete(view)
        await db.commit()
