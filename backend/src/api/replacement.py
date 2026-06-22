import logging
import os
from datetime import datetime, date
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete as sa_delete, func as sa_func, case
from sqlalchemy.orm import selectinload
from pydantic import BaseModel, Field, ConfigDict

from src.database import get_db
from src.models.replacement_device import ReplacementDevice, ReplacementTransaction
from src.models.user import User
from src.core.deps import get_current_user

logger = logging.getLogger(__name__)
replacement_router = APIRouter(prefix="/replacement", tags=["Replacement Fund"])


def _log(action: str, detail: str, user: User):
    try:
        p = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "history.log")
        with open(p, "a", encoding="utf-8") as f:
            f.write(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {user.name} — {action}: {detail}\n")
    except:
        pass


# ── Pydantic schemas ─────────────────────────────────────────

class DeviceCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    serial_number: str = ""
    verification_date: str | None = None
    verification_interval_months: int | None = None
    verification_expiry: str | None = None
    passport_scan: str | None = None
    accuracy_class: str | None = None
    mounting: str | None = None


class DeviceUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    serial_number: str | None = None
    verification_date: str | None = None
    verification_interval_months: int | None = None
    verification_expiry: str | None = None
    passport_scan: str | None = None
    accuracy_class: str | None = None
    mounting: str | None = None


class DeviceResponse(BaseModel):
    id: int
    name: str
    serial_number: str = ""
    verification_date: str | None = None
    verification_interval_months: int | None = None
    verification_expiry: str | None = None
    passport_scan: str | None = None
    accuracy_class: str | None = None
    mounting: str | None = None
    balance: int
    created_at: str

    model_config = ConfigDict(from_attributes=True)


class TransactionCreate(BaseModel):
    type: str
    device_id: int
    quantity: int = Field(..., gt=0)
    taken_by_id: int | None = None
    location_id: int | None = None
    comment: str | None = None
    document: str | None = None


class TransactionResponse(BaseModel):
    id: int
    type: str
    device_id: int
    device_name: str | None = None
    quantity: int
    taken_by_id: int | None = None
    taken_by_name: str | None = None
    location_id: int | None = None
    location_name: str | None = None
    comment: str | None = None
    document: str | None = None
    created_at: str

    model_config = ConfigDict(from_attributes=True)


# ── Helpers ──────────────────────────────────────────────────

async def _get_device_balance(db: AsyncSession, device_id: int) -> int:
    stmt = select(
        sa_func.coalesce(
            sa_func.sum(
                case(
                    (ReplacementTransaction.type == "incoming", ReplacementTransaction.quantity),
                    (ReplacementTransaction.type == "return", ReplacementTransaction.quantity),
                    (ReplacementTransaction.type == "outgoing", -ReplacementTransaction.quantity),
                    else_=0
                )
            ), 0
        )
    ).where(ReplacementTransaction.device_id == device_id)
    res = await db.execute(stmt)
    return int(res.scalar() or 0)


def _serialize_device(d: ReplacementDevice, balance: int) -> DeviceResponse:
    return DeviceResponse(
        id=d.id, name=d.name, serial_number=d.serial_number,
        verification_date=d.verification_date.isoformat() if d.verification_date else None,
        verification_interval_months=d.verification_interval_months,
        verification_expiry=d.verification_expiry.isoformat() if d.verification_expiry else None,
        passport_scan=d.passport_scan,
        accuracy_class=d.accuracy_class,
        mounting=d.mounting,
        balance=balance,
        created_at=d.created_at.isoformat() if d.created_at else "",
    )


# ── Devices (catalog) ────────────────────────────────────────

@replacement_router.get("/devices", response_model=list[DeviceResponse])
async def list_devices(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    stmt = (
        select(
            ReplacementDevice,
            sa_func.coalesce(
                sa_func.sum(
                    case(
                        (ReplacementTransaction.type == "incoming", ReplacementTransaction.quantity),
                        (ReplacementTransaction.type == "return", ReplacementTransaction.quantity),
                        (ReplacementTransaction.type == "outgoing", -ReplacementTransaction.quantity),
                        else_=0
                    )
                ), 0
            ).label("calculated_balance")
        )
        .outerjoin(ReplacementTransaction, ReplacementTransaction.device_id == ReplacementDevice.id)
        .group_by(ReplacementDevice.id)
        .order_by(ReplacementDevice.name)
    )
    result = await db.execute(stmt)
    return [_serialize_device(row[0], int(row[1])) for row in result.all()]


@replacement_router.post("/devices", status_code=201, response_model=DeviceResponse)
async def create_device(data: DeviceCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    d = ReplacementDevice(
        name=data.name.strip(), serial_number=data.serial_number,
        verification_date=date.fromisoformat(data.verification_date) if data.verification_date else None,
        verification_interval_months=data.verification_interval_months,
        verification_expiry=date.fromisoformat(data.verification_expiry) if data.verification_expiry else None,
        passport_scan=data.passport_scan,
        accuracy_class=data.accuracy_class,
        mounting=data.mounting,
    )
    db.add(d)
    await db.flush()
    await db.commit()
    _log("Подменный фонд", f"Добавлен прибор: {d.name}", user)
    return _serialize_device(d, 0)


@replacement_router.patch("/devices/{device_id}", response_model=DeviceResponse)
async def update_device(device_id: int, data: DeviceUpdate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    d = await db.get(ReplacementDevice, device_id)
    if not d:
        raise HTTPException(404, detail="Прибор не найден")
    update_data = data.model_dump(exclude_unset=True)
    if "name" in update_data and update_data["name"]:
        update_data["name"] = update_data["name"].strip()
    for field, value in update_data.items():
        if field in ("verification_date", "verification_expiry") and isinstance(value, str) and value:
            value = date.fromisoformat(value)
        setattr(d, field, value)
    await db.commit()
    balance = await _get_device_balance(db, d.id)
    _log("Подменный фонд", f"Обновлён прибор: {d.name}", user)
    return _serialize_device(d, balance)


@replacement_router.delete("/devices/{device_id}")
async def delete_device(device_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    d = await db.get(ReplacementDevice, device_id)
    if not d:
        raise HTTPException(404, detail="Прибор не найден")
    await db.execute(sa_delete(ReplacementTransaction).where(ReplacementTransaction.device_id == device_id))
    await db.delete(d)
    await db.commit()
    _log("Подменный фонд", f"Удалён прибор «{d.name}» со всеми транзакциями", user)
    return {"ok": True}


# ── Transactions ─────────────────────────────────────────────

@replacement_router.get("/transactions", response_model=list[TransactionResponse])
async def list_transactions(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ReplacementTransaction).options(
            selectinload(ReplacementTransaction.device),
            selectinload(ReplacementTransaction.taken_by),
            selectinload(ReplacementTransaction.location),
        ).order_by(ReplacementTransaction.id.desc()).limit(200)
    )
    return [
        TransactionResponse(
            id=t.id, type=t.type, device_id=t.device_id,
            device_name=t.device.name if t.device else None,
            quantity=int(t.quantity), taken_by_id=t.taken_by_id,
            taken_by_name=t.taken_by.name if t.taken_by else None,
            location_id=t.location_id,
            location_name=t.location.name if t.location else None,
            comment=t.comment, document=t.document,
            created_at=t.created_at.isoformat() if t.created_at else "",
        )
        for t in result.scalars().all()
    ]


@replacement_router.post("/transactions", status_code=201, response_model=TransactionResponse)
async def create_transaction(data: TransactionCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if data.type not in ("incoming", "outgoing", "return"):
        raise HTTPException(400, detail="Неверный тип транзакции")

    dev = await db.get(ReplacementDevice, data.device_id)
    if not dev:
        raise HTTPException(404, detail="Прибор не найден")

    if data.type == "outgoing":
        bal = await _get_device_balance(db, data.device_id)
        if bal < data.quantity:
            raise HTTPException(400, detail=f"Недостаточно приборов (Доступно: {bal}, запрашивается: {data.quantity})")

    t = ReplacementTransaction(
        type=data.type, device_id=data.device_id, quantity=data.quantity,
        taken_by_id=data.taken_by_id, location_id=data.location_id,
        comment=data.comment, document=data.document,
    )
    db.add(t)
    await db.flush()
    await db.commit()

    stmt = (
        select(ReplacementTransaction)
        .options(
            selectinload(ReplacementTransaction.device),
            selectinload(ReplacementTransaction.taken_by),
            selectinload(ReplacementTransaction.location),
        )
        .where(ReplacementTransaction.id == t.id)
    )
    t_refreshed = (await db.execute(stmt)).scalar_one()

    labels = {"incoming": "Приход", "outgoing": "Выдача", "return": "Возврат"}
    _log("Подменный фонд", f"{labels.get(data.type)}: {data.quantity} шт (прибор «{t_refreshed.device.name}»)", user)

    return TransactionResponse(
        id=t_refreshed.id, type=t_refreshed.type, device_id=t_refreshed.device_id,
        device_name=t_refreshed.device.name,
        quantity=int(t_refreshed.quantity), taken_by_id=t_refreshed.taken_by_id,
        taken_by_name=t_refreshed.taken_by.name if t_refreshed.taken_by else None,
        location_id=t_refreshed.location_id,
        location_name=t_refreshed.location.name if t_refreshed.location else None,
        comment=t_refreshed.comment, document=t_refreshed.document,
        created_at=t_refreshed.created_at.isoformat() if t_refreshed.created_at else "",
    )


@replacement_router.delete("/transactions/{tx_id}")
async def delete_transaction(tx_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    t = await db.get(ReplacementTransaction, tx_id)
    if not t:
        raise HTTPException(404, detail="Транзакция не найдена")
    await db.delete(t)
    await db.commit()
    _log("Подменный фонд", f"Удалена транзакция #{tx_id}", user)
    return {"ok": True}
