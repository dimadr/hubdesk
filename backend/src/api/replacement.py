from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from datetime import date, datetime
import os
from src.database import get_db
from src.models.replacement_device import ReplacementDevice
from src.models.user import User
from src.models.equipment import AssetLocation
from src.core.deps import get_current_user


def log(action: str, detail: str, user: User):
    try:
        p = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "history.log")
        with open(p, "a", encoding="utf-8") as f:
            f.write(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {user.name} — {action}: {detail}\n")
    except:
        pass


replacement_router = APIRouter(prefix="/replacement-devices", tags=["Replacement Devices"])

class DeviceCreate(BaseModel):
    name: str
    serial_number: str = ""
    verification_date: str | None = None
    verification_interval_months: int | None = None
    verification_expiry: str | None = None
    passport_scan: str | None = None
    taken_by_id: int | None = None
    location_id: int | None = None
    return_date: str | None = None


class DeviceResponse(BaseModel):
    id: int
    name: str
    serial_number: str = ""
    verification_date: str | None = None
    verification_interval_months: int | None = None
    verification_expiry: str | None = None
    passport_scan: str | None = None
    taken_by_id: int | None = None
    taken_by_name: str | None = None
    location_id: int | None = None
    location_name: str | None = None
    return_date: str | None = None
    status: str
    created_at: str

    model_config = {"from_attributes": True}


@replacement_router.get("", response_model=list[DeviceResponse])
async def list_devices(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ReplacementDevice).options(
            selectinload(ReplacementDevice.taken_by),
            selectinload(ReplacementDevice.location),
        ).order_by(ReplacementDevice.id.desc())
    )
    devices = result.scalars().all()
    out = []
    for d in devices:
        out.append(DeviceResponse(
            id=d.id, name=d.name, serial_number=d.serial_number,
            verification_date=d.verification_date.isoformat() if d.verification_date else None,
            verification_interval_months=d.verification_interval_months,
            verification_expiry=d.verification_expiry.isoformat() if d.verification_expiry else None,
            passport_scan=d.passport_scan,
            taken_by_id=d.taken_by_id,
            taken_by_name=d.taken_by.name if d.taken_by else None,
            location_id=d.location_id,
            location_name=d.location.name if d.location else None,
            return_date=d.return_date.isoformat() if d.return_date else None,
            status=d.status,
            created_at=d.created_at.isoformat() if d.created_at else "",
        ))
    return out


@replacement_router.post("", status_code=201, response_model=DeviceResponse)
async def create_device(data: DeviceCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    d = ReplacementDevice(
        name=data.name, serial_number=data.serial_number,
        verification_date=date.fromisoformat(data.verification_date) if data.verification_date else None,
        verification_interval_months=data.verification_interval_months,
        verification_expiry=date.fromisoformat(data.verification_expiry) if data.verification_expiry else None,
        passport_scan=data.passport_scan,
        taken_by_id=data.taken_by_id,
        location_id=data.location_id,
        return_date=date.fromisoformat(data.return_date) if data.return_date else None,
        status="taken" if data.taken_by_id else "available",
    )
    db.add(d)
    await db.flush()
    await db.commit()
    log("Подменный фонд", f"Добавлен прибор: {d.name}", user)
    return DeviceResponse(
        id=d.id, name=d.name, serial_number=d.serial_number,
        verification_date=d.verification_date.isoformat() if d.verification_date else None,
        verification_interval_months=d.verification_interval_months,
        verification_expiry=d.verification_expiry.isoformat() if d.verification_expiry else None,
        passport_scan=d.passport_scan,
        taken_by_id=d.taken_by_id, location_id=d.location_id,
        return_date=d.return_date.isoformat() if d.return_date else None,
        status=d.status,
        created_at=d.created_at.isoformat() if d.created_at else "",
    )


@replacement_router.patch("/{device_id}", response_model=DeviceResponse)
async def update_device(device_id: int, data: DeviceCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    d = await db.get(ReplacementDevice, device_id)
    if not d:
        raise HTTPException(404)
    d.name = data.name
    d.serial_number = data.serial_number
    d.verification_date = date.fromisoformat(data.verification_date) if data.verification_date else None
    d.verification_interval_months = data.verification_interval_months
    d.verification_expiry = date.fromisoformat(data.verification_expiry) if data.verification_expiry else None
    d.passport_scan = data.passport_scan
    d.taken_by_id = data.taken_by_id
    d.location_id = data.location_id
    d.return_date = date.fromisoformat(data.return_date) if data.return_date else None
    d.status = "taken" if data.taken_by_id else "available"
    await db.commit()
    log("Подменный фонд", f"Обновлён прибор: {d.name}", user)
    return DeviceResponse(
        id=d.id, name=d.name, serial_number=d.serial_number,
        verification_date=d.verification_date.isoformat() if d.verification_date else None,
        verification_interval_months=d.verification_interval_months,
        verification_expiry=d.verification_expiry.isoformat() if d.verification_expiry else None,
        passport_scan=d.passport_scan,
        taken_by_id=d.taken_by_id, location_id=d.location_id,
        return_date=d.return_date.isoformat() if d.return_date else None,
        status=d.status,
        created_at=d.created_at.isoformat() if d.created_at else "",
    )


@replacement_router.delete("/{device_id}")
async def delete_device(device_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    d = await db.get(ReplacementDevice, device_id)
    if not d:
        raise HTTPException(404)
    await db.delete(d)
    await db.commit()
    log("Подменный фонд", f"Удалён прибор: {d.name}", user)
    return {"ok": True}
