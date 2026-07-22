import logging
from datetime import datetime
from typing import List, Any
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete as sa_delete, func as sa_func, case, cast, Integer
from sqlalchemy.orm import selectinload
from pydantic import BaseModel, Field, ConfigDict

from src.database import get_db
from src.models.insert_stock import InsertProduct, InsertTransaction
from src.models.equipment import AssetLocation
from src.models.user import User, UserRole
from src.core.deps import get_current_user
from src.services.audit_service import log_audit

logger = logging.getLogger(__name__)
insert_v2_router = APIRouter(prefix="/insert", tags=["Insert Stock v2"])


class ProductCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    diameter_inner: str | None = None
    diameter_outer: str | None = None
    length: str | None = None
    flange_type: str | None = None
    notes: str | None = None
    cell: str | None = None


class ProductUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    diameter_inner: str | None = None
    diameter_outer: str | None = None
    length: str | None = None
    flange_type: str | None = None
    notes: str | None = None
    cell: str | None = None


class ProductResponse(BaseModel):
    id: int
    name: str
    diameter_inner: str | None = None
    diameter_outer: str | None = None
    length: str | None = None
    flange_type: str | None = None
    notes: str | None = None
    cell: str | None = None
    balance: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TransactionCreate(BaseModel):
    type: str
    product_id: int
    quantity: int = Field(..., gt=0)
    taken_by_id: int | None = None
    location_id: int | None = None
    destination: str | None = None
    comment: str | None = None
    document: str | None = None


class TransactionResponse(BaseModel):
    id: int
    type: str
    product_id: int
    product_name: str | None = None
    quantity: int
    taken_by_id: int | None = None
    taken_by_name: str | None = None
    location_id: int | None = None
    location_name: str | None = None
    destination: str | None = None
    comment: str | None = None
    document: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


async def _get_product_balance(db: AsyncSession, product_id: int) -> int:
    stmt = select(
        sa_func.coalesce(
            sa_func.sum(
                case(
                    (InsertTransaction.type == "incoming", InsertTransaction.quantity),
                    (InsertTransaction.type == "return", InsertTransaction.quantity),
                    (InsertTransaction.type == "outgoing", -InsertTransaction.quantity),
                    else_=0
                )
            ), 0
        )
    ).where(InsertTransaction.product_id == product_id)

    res = await db.execute(stmt)
    return int(res.scalar() or 0)


@insert_v2_router.get("/products", response_model=list[ProductResponse])
async def list_products(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role not in (UserRole.admin, UserRole.director, UserRole.storekeeper, UserRole.metrologist):
        raise HTTPException(403, "Недостаточно прав")
    stmt = (
        select(
            InsertProduct,
            sa_func.coalesce(
                sa_func.sum(
                    case(
                        (InsertTransaction.type == "incoming", InsertTransaction.quantity),
                        (InsertTransaction.type == "return", InsertTransaction.quantity),
                        (InsertTransaction.type == "outgoing", -InsertTransaction.quantity),
                        else_=0
                    )
                ), 0
            ).label("calculated_balance")
        )
        .outerjoin(InsertTransaction, InsertTransaction.product_id == InsertProduct.id)
        .group_by(InsertProduct.id)
        .order_by(
            cast(
                sa_func.nullif(
                    sa_func.regexp_replace(InsertProduct.diameter_inner, '[^0-9].*', '', 'g'),
                    ''
                ),
                Integer
            ).asc().nulls_last(),
            InsertProduct.name
        )
    )

    result = await db.execute(stmt)
    out = []

    for row in result.all():
        p, balance = row[0], row[1]
        out.append(ProductResponse(
            id=p.id, name=p.name, diameter_inner=p.diameter_inner, diameter_outer=p.diameter_outer,
            length=p.length,
            flange_type=p.flange_type, notes=p.notes, cell=p.cell, balance=int(balance),
            created_at=p.created_at
        ))
    return out


@insert_v2_router.post("/products", status_code=201, response_model=ProductResponse)
async def create_product(data: ProductCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role not in (UserRole.admin, UserRole.director, UserRole.storekeeper, UserRole.metrologist):
        raise HTTPException(status_code=403, detail="Недостаточно прав")
    existing = await db.execute(
        select(InsertProduct).where(sa_func.lower(InsertProduct.name) == data.name.strip().lower())
    )
    dup = existing.scalar_one_or_none()
    if dup:
        current_bal = await _get_product_balance(db, dup.id)
        raise HTTPException(
            status_code=400,
            detail=f"Продукт с таким названием уже существует (ID: {dup.id}, остаток: {current_bal})"
        )

    p = InsertProduct(
        name=data.name.strip(), diameter_inner=data.diameter_inner, diameter_outer=data.diameter_outer,
        length=data.length, flange_type=data.flange_type, cell=data.cell, notes=data.notes
    )
    db.add(p)
    await db.flush()

    await log_audit(db, user, "product_created", "insert_product", p.id, f"Добавлен продукт «{p.name}»")
    await db.commit()
    return ProductResponse(
        id=p.id, name=p.name, diameter_inner=p.diameter_inner, diameter_outer=p.diameter_outer,
        length=p.length,
        flange_type=p.flange_type, notes=p.notes, cell=p.cell, balance=0,
        created_at=p.created_at
    )


@insert_v2_router.patch("/products/{product_id}", response_model=ProductResponse)
async def update_product(product_id: int, data: ProductUpdate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role not in (UserRole.admin, UserRole.director, UserRole.storekeeper, UserRole.metrologist):
        raise HTTPException(status_code=403, detail="Недостаточно прав")
    p = await db.get(InsertProduct, product_id)
    if not p:
        raise HTTPException(status_code=404, detail="Продукт не найден")

    update_data = data.model_dump(exclude_unset=True)
    if "name" in update_data and update_data["name"]:
        update_data["name"] = update_data["name"].strip()

    for field, value in update_data.items():
        setattr(p, field, value)

    current_bal = await _get_product_balance(db, p.id)
    await log_audit(db, user, "product_updated", "insert_product", p.id, f"Обновлён продукт «{p.name}»")
    await db.commit()

    return ProductResponse(
        id=p.id, name=p.name, diameter_inner=p.diameter_inner, diameter_outer=p.diameter_outer,
        length=p.length,
        flange_type=p.flange_type, notes=p.notes, cell=p.cell, balance=current_bal,
        created_at=p.created_at
    )


@insert_v2_router.delete("/products/{product_id}")
async def delete_product(product_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    raise HTTPException(status_code=403, detail="Удаление отключено в RC-режиме")
    # RC: удаление только с прямого одобрения пользователя
    p = await db.get(InsertProduct, product_id)
    if not p:
        raise HTTPException(status_code=404, detail="Продукт не найден")

    await db.execute(sa_delete(InsertTransaction).where(InsertTransaction.product_id == product_id))
    await db.delete(p)
    await db.commit()

    await log_audit(db, user, "product_deleted", "insert_product", product_id, f"Удалён продукт «{p.name}» со всеми транзакциями")
    return {"ok": True}


@insert_v2_router.get("/transactions", response_model=list[TransactionResponse])
async def list_transactions(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role not in (UserRole.admin, UserRole.director, UserRole.storekeeper, UserRole.metrologist):
        raise HTTPException(403, "Недостаточно прав")
    result = await db.execute(
        select(InsertTransaction).options(
            selectinload(InsertTransaction.product),
            selectinload(InsertTransaction.taken_by),
            selectinload(InsertTransaction.location),
        ).order_by(InsertTransaction.id.desc()).limit(200)
    )

    out = []
    for t in result.scalars().all():
        out.append(TransactionResponse(
            id=t.id, type=t.type, product_id=t.product_id, product_name=t.product.name if t.product else None,
            quantity=int(t.quantity), taken_by_id=t.taken_by_id, taken_by_name=t.taken_by.name if t.taken_by else None,
            location_id=t.location_id, location_name=t.location.name if t.location else None,
            destination=t.destination, comment=t.comment, document=t.document,
            created_at=t.created_at,
        ))
    return out


@insert_v2_router.post("/transactions", status_code=201, response_model=TransactionResponse)
async def create_transaction(data: TransactionCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role not in (UserRole.admin, UserRole.director, UserRole.storekeeper, UserRole.metrologist):
        raise HTTPException(status_code=403, detail="Недостаточно прав")
    if data.type not in ("incoming", "outgoing", "return"):
        raise HTTPException(status_code=400, detail="Неверный тип транзакции")

    product_stmt = select(InsertProduct).where(InsertProduct.id == data.product_id).with_for_update()
    product_res = await db.execute(product_stmt)
    product = product_res.scalar_one_or_none()

    if not product:
        raise HTTPException(status_code=404, detail="Указанный продукт не найден")

    if data.taken_by_id:
        taken_by = await db.get(User, data.taken_by_id)
        if not taken_by:
            raise HTTPException(status_code=400, detail="Пользователь не найден")
    if data.location_id:
        loc = await db.get(AssetLocation, data.location_id)
        if not loc:
            raise HTTPException(status_code=400, detail="Объект не найден")

    if data.type == "outgoing":
        bal = await _get_product_balance(db, data.product_id)
        if bal < data.quantity:
            raise HTTPException(
                status_code=400,
                detail=f"На складе недостаточно материала (Доступно: {bal} шт, запрашивается: {data.quantity} шт)"
            )

    t = InsertTransaction(
        type=data.type, product_id=data.product_id, quantity=data.quantity,
        taken_by_id=data.taken_by_id, location_id=data.location_id,
        destination=data.destination, comment=data.comment, document=data.document,
    )
    db.add(t)
    await db.flush()

    stmt = (
        select(InsertTransaction)
        .options(
            selectinload(InsertTransaction.product),
            selectinload(InsertTransaction.taken_by),
            selectinload(InsertTransaction.location),
        )
        .where(InsertTransaction.id == t.id)
    )
    t_refreshed = (await db.execute(stmt)).scalar_one()

    labels = {"incoming": "Приход", "outgoing": "Выдача", "return": "Возврат"}
    await log_audit(
        db, user, f"insert_{data.type}", "insert_transaction", t.id,
        f"{labels.get(data.type, data.type)}: {data.quantity} шт (продукт «{t_refreshed.product.name if t_refreshed.product else data.product_id}»)"
    )
    await db.commit()

    return TransactionResponse(
        id=t_refreshed.id, type=t_refreshed.type, product_id=t_refreshed.product_id,
        product_name=t_refreshed.product.name if t_refreshed.product else None,
        quantity=int(t_refreshed.quantity), taken_by_id=t_refreshed.taken_by_id,
        taken_by_name=t_refreshed.taken_by.name if t_refreshed.taken_by else None,
        location_id=t_refreshed.location_id, location_name=t_refreshed.location.name if t_refreshed.location else None,
        destination=t_refreshed.destination, comment=t_refreshed.comment, document=t_refreshed.document,
        created_at=t_refreshed.created_at,
    )


@insert_v2_router.delete("/transactions/{tx_id}")
async def delete_transaction(tx_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    raise HTTPException(status_code=403, detail="Удаление отключено в RC-режиме")
    # RC: удаление только с прямого одобрения пользователя
    t = await db.get(InsertTransaction, tx_id)
    if not t:
        raise HTTPException(status_code=404, detail="Транзакция не найдена")

    await db.delete(t)
    await db.commit()
    await log_audit(db, user, "insert_transaction_deleted", "insert_transaction", tx_id, f"Удалена транзакция #{tx_id}")
    return {"ok": True}
