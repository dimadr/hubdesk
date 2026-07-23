from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from src.database import get_db
from src.models.equipment import Equipment, AssetLocation
from src.models.customer import Customer
from src.api.schemas import EquipmentCreate, EquipmentResponse
from src.core.deps import get_current_user
from src.models.user import User, UserRole

equipment_router = APIRouter(prefix="/equipment", tags=["Equipment"])


@equipment_router.get("", response_model=list[EquipmentResponse])
async def list_equipment(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Equipment).options(selectinload(Equipment.location))
    if user.role in (UserRole.admin, UserRole.director, UserRole.dispatcher, UserRole.accountant,
                     UserRole.storekeeper, UserRole.metrologist, UserRole.viewer):
        pass  # all equipment
    elif user.role == UserRole.engineer:
        stmt = stmt.join(AssetLocation, Equipment.location_id == AssetLocation.id).where(
            AssetLocation.assigned_engineer_id == user.id
        )
    elif user.role == UserRole.customer:
        if user.customer_id is None:
            raise HTTPException(403, "Пользователь не привязан к заказчику")
        stmt = stmt.join(AssetLocation, Equipment.location_id == AssetLocation.id).where(
            AssetLocation.customer_id == user.customer_id
        )
    else:
        raise HTTPException(403, "Недостаточно прав")
    result = await db.execute(stmt)
    return [EquipmentResponse.model_validate(e) for e in result.scalars().all()]


@equipment_router.post("", status_code=201, response_model=EquipmentResponse)
async def create_equipment(
    data: EquipmentCreate,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role not in (UserRole.admin, UserRole.director, UserRole.storekeeper):
        raise HTTPException(status_code=403, detail="Недостаточно прав")
    loc = await db.get(AssetLocation, data.location_id)
    if not loc:
        raise HTTPException(status_code=400, detail="Объект не найден")
    eq = Equipment(**data.model_dump())
    db.add(eq)
    await db.flush()
    await db.commit()
    return EquipmentResponse.model_validate(eq)
