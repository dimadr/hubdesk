from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete as sa_delete, func as sa_func, case
from sqlalchemy.orm import selectinload
from pydantic import BaseModel, Field
from datetime import datetime

from src.database import get_db
from src.models.insert_stock import InsertProduct, InsertTransaction
from src.models.user import User
from src.core.deps import get_current_user
from src.services.audit_service import log_audit

insert_v2_router = APIRouter(prefix="/insert", tags=["Insert Stock v2"])


class ProductCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    diameter: str | None = None
    length: str | None = None
    flange_type: str | None = None


class ProductResponse(BaseModel):
    id: int
    name: str
    diameter: str | None = None
    length: str | None = None
    flange_type: str | None = None
    balance: int
    created_at: str

    class Config:
        from_attributes = True


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
    created_at: str

    class Config:
        from_attributes = True


async def _get_product_balance(db: AsyncSession, product_id: int, lock_row: bool = False) -> int:
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

    if lock_row:
        stmt = stmt.with_for_update()

    res = await db.execute(stmt)
    return int(res.scalar() or 0)


@insert_v2_router.get("/products", response_model=list[ProductResponse])
async def list_products(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
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
        .order_by(InsertProduct.name)
    )

    result = await db.execute(stmt)
    out = []

    for row in result.all():
        p, balance = row[0], row[1]
        out.append(ProductResponse(
            id=p.id, name=p.name, diameter=p.diameter, length=p.length,
            flange_type=p.flange_type, balance=int(balance),
            created_at=p.created_at.isoformat() if p.created_at else ""
        ))
    return out


@insert_v2_router.post("/products", status_code=201, response_model=ProductResponse)
async def create_product(data: ProductCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
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

    p = InsertProduct(name=data.name.strip(), diameter=data.diameter, length=data.length, flange_type=data.flange_type)
    db.add(p)
    await db.flush()
    await db.commit()

    await log_audit(db, user, "product_created", "insert_product", p.id, f"Добавлен продукт «{p.name}»")
    return ProductResponse(
        id=p.id, name=p.name, diameter=p.diameter, length=p.length,
        flange_type=p.flange_type, balance=0,
        created_at=p.created_at.isoformat() if p.created_at else ""
    )


@insert_v2_router.patch("/products/{product_id}", response_model=ProductResponse)
async def update_product(product_id: int, data: ProductCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    p = await db.get(InsertProduct, product_id)
    if not p:
        raise HTTPException(status_code=404, detail="Продукт не найден")

    p.name = data.name.strip()
    p.diameter = data.diameter
    p.length = data.length
    p.flange_type = data.flange_type

    await db.commit()

    current_bal = await _get_product_balance(db, p.id)
    await log_audit(db, user, "product_updated", "insert_product", p.id, f"Обновлён продукт «{p.name}»")

    return ProductResponse(
        id=p.id, name=p.name, diameter=p.diameter, length=p.length,
        flange_type=p.flange_type, balance=current_bal,
        created_at=p.created_at.isoformat() if p.created_at else ""
    )


@insert_v2_router.delete("/products/{product_id}")
async def delete_product(product_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
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
            created_at=t.created_at.isoformat() if t.created_at else "",
        ))
    return out


@insert_v2_router.post("/transactions", status_code=201, response_model=TransactionResponse)
async def create_transaction(data: TransactionCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if data.type not in ("incoming", "outgoing", "return"):
        raise HTTPException(status_code=400, detail="Неверный тип транзакции")

    if data.type == "outgoing":
        bal = await _get_product_balance(db, data.product_id, lock_row=True)
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
    await db.commit()

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
        f"{labels.get(data.type, data.type)}: {data.quantity} шт (продукт #{data.product_id})"
    )

    return TransactionResponse(
        id=t_refreshed.id, type=t_refreshed.type, product_id=t_refreshed.product_id,
        product_name=t_refreshed.product.name if t_refreshed.product else None,
        quantity=int(t_refreshed.quantity), taken_by_id=t_refreshed.taken_by_id,
        taken_by_name=t_refreshed.taken_by.name if t_refreshed.taken_by else None,
        location_id=t_refreshed.location_id, location_name=t_refreshed.location.name if t_refreshed.location else None,
        destination=t_refreshed.destination, comment=t_refreshed.comment, document=t_refreshed.document,
        created_at=t_refreshed.created_at.isoformat() if t_refreshed.created_at else "",
    )


@insert_v2_router.delete("/transactions/{tx_id}")
async def delete_transaction(tx_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    t = await db.get(InsertTransaction, tx_id)
    if not t:
        raise HTTPException(status_code=404, detail="Транзакция не найдена")

    await db.delete(t)
    await db.commit()
    await log_audit(db, user, "insert_transaction_deleted", "insert_transaction", tx_id, f"Удалена транзакция #{tx_id}")
    return {"ok": True}
