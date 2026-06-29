from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from datetime import date, datetime
import os
from src.database import get_db
from src.models.insert_item import InsertItem
from src.models.user import User, UserRole
from src.core.deps import get_current_user


def log(action: str, detail: str, user: User):
    try:
        p = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "history.log")
        with open(p, "a", encoding="utf-8") as f:
            f.write(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {user.name} — {action}: {detail}\n")
    except:
        pass


insert_router = APIRouter(prefix="/insert-stock", tags=["Insert Stock"])

class InsertCreate(BaseModel):
    device_name: str
    diameter: str | None = None
    length: str | None = None
    flange_type: str | None = None
    taken_by_id: int | None = None
    location_id: int | None = None
    return_date: str | None = None


@insert_router.get("")
async def list_inserts(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(InsertItem).options(
            selectinload(InsertItem.taken_by),
            selectinload(InsertItem.location),
        ).order_by(InsertItem.id.desc())
    )
    out = []
    for i in result.scalars().all():
        out.append({
            "id": i.id, "device_name": i.device_name,
            "diameter": i.diameter, "length": i.length, "flange_type": i.flange_type,
            "taken_by_id": i.taken_by_id, "taken_by_name": i.taken_by.name if i.taken_by else None,
            "location_id": i.location_id, "location_name": i.location.name if i.location else None,
            "return_date": i.return_date.isoformat() if i.return_date else None,
            "created_at": i.created_at.isoformat() if i.created_at else "",
        })
    return out


@insert_router.post("", status_code=201)
async def create_insert(data: InsertCreate, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role not in (UserRole.admin, UserRole.director, UserRole.storekeeper):
        raise HTTPException(403, "Недостаточно прав")
    i = InsertItem(
        device_name=data.device_name, diameter=data.diameter, length=data.length,
        flange_type=data.flange_type, taken_by_id=data.taken_by_id, location_id=data.location_id,
        return_date=date.fromisoformat(data.return_date) if data.return_date else None,
    )
    db.add(i)
    await db.flush()
    await db.commit()
    log("Склад вставок", f"Добавлено: {i.device_name}", user)
    return {"id": i.id, "device_name": i.device_name, "diameter": i.diameter, "length": i.length,
            "flange_type": i.flange_type, "taken_by_id": i.taken_by_id, "location_id": i.location_id,
            "return_date": i.return_date.isoformat() if i.return_date else None}


@insert_router.patch("/{item_id}")
async def update_insert(item_id: int, data: InsertCreate, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role not in (UserRole.admin, UserRole.director, UserRole.storekeeper):
        raise HTTPException(403, "Недостаточно прав")
    i = await db.get(InsertItem, item_id)
    if not i:
        raise HTTPException(404)
    i.device_name = data.device_name
    i.diameter = data.diameter
    i.length = data.length
    i.flange_type = data.flange_type
    i.taken_by_id = data.taken_by_id
    i.location_id = data.location_id
    i.return_date = date.fromisoformat(data.return_date) if data.return_date else None
    await db.commit()
    log("Склад вставок", f"Обновлено: {i.device_name}", user)
    return {"ok": True}


@insert_router.delete("/{item_id}")
async def delete_insert(item_id: int, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    raise HTTPException(403, detail="Удаление отключено в RC-режиме")
    # RC: удаление только с прямого одобрения пользователя
    i = await db.get(InsertItem, item_id)
    if not i:
        raise HTTPException(404)
    await db.delete(i)
    await db.commit()
    log("Склад вставок", f"Удалено: {i.device_name}", user)
    return {"ok": True}
