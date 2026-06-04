from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from src.database import get_db
from src.models.equipment import Equipment
from src.api.schemas import EquipmentCreate, EquipmentResponse
from src.core.deps import get_current_user

equipment_router = APIRouter(prefix="/equipment", tags=["Equipment"])


@equipment_router.get("", response_model=list[EquipmentResponse])
async def list_equipment(
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Equipment))
    return [EquipmentResponse.model_validate(e) for e in result.scalars().all()]


@equipment_router.post("", status_code=201, response_model=EquipmentResponse)
async def create_equipment(
    data: EquipmentCreate,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    eq = Equipment(**data.model_dump())
    db.add(eq)
    await db.flush()
    await db.commit()
    return EquipmentResponse.model_validate(eq)
