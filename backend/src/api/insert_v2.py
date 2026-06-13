from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete as sa_delete, func as sa_func
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from datetime import datetime
import os
from src.database import get_db
from src.models.insert_stock import InsertProduct, InsertTransaction
from src.models.user import User
from src.core.deps import get_current_user

insert_v2_router = APIRouter(prefix="/insert", tags=["Insert Stock v2"])


def log(action: str, detail: str, user: User):
    try:
        p = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "history.log")
        with open(p, "a", encoding="utf-8") as f:
            f.write(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {user.name} — {action}: {detail}\n")
    except:
        pass


# ─── Products ───

class ProductCreate(BaseModel):
    name: str
    diameter: str | None = None
    length: str | None = None
    flange_type: str | None = None


class ProductResponse(BaseModel):
    id: int
    name: str
    diameter: str | None = None
    length: str | None = None
    flange_type: str | None = None
    balance: int = 0
    created_at: str = ""

    model_config = {"from_attributes": True}


@insert_v2_router.get("/products", response_model=list[ProductResponse])
async def list_products(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(InsertProduct).order_by(InsertProduct.name))
    products = result.scalars().all()
    out = []
    for p in products:
        bal = await _balance(db, p.id)
        out.append(ProductResponse(id=p.id, name=p.name, diameter=p.diameter, length=p.length,
                                   flange_type=p.flange_type, balance=bal,
                                   created_at=p.created_at.isoformat() if p.created_at else ""))
    return out


@insert_v2_router.post("/products", status_code=201, response_model=ProductResponse)
async def create_product(data: ProductCreate, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    existing = await db.execute(
        select(InsertProduct).where(sa_func.lower(InsertProduct.name) == data.name.strip().lower())
    )
    dup = existing.scalar_one_or_none()
    if dup:
        raise HTTPException(400, f"Продукт с таким названием уже существует (ID: {dup.id}, остаток: {await _balance(db, dup.id)})")
    p = InsertProduct(name=data.name.strip(), diameter=data.diameter, length=data.length, flange_type=data.flange_type)
    db.add(p)
    await db.flush()
    await db.commit()
    log("Склад вставок", f"Добавлен продукт: {p.name}", user)
    return ProductResponse(id=p.id, name=p.name, diameter=p.diameter, length=p.length,
                           flange_type=p.flange_type, balance=0,
                           created_at=p.created_at.isoformat() if p.created_at else "")


@insert_v2_router.patch("/products/{product_id}", response_model=ProductResponse)
async def update_product(product_id: int, data: ProductCreate, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    p = await db.get(InsertProduct, product_id)
    if not p:
        raise HTTPException(404)
    p.name = data.name
    p.diameter = data.diameter
    p.length = data.length
    p.flange_type = data.flange_type
    await db.commit()
    bal = await _balance(db, p.id)
    log("Склад вставок", f"Обновлён продукт: {p.name}", user)
    return ProductResponse(id=p.id, name=p.name, diameter=p.diameter, length=p.length,
                           flange_type=p.flange_type, balance=bal,
                           created_at=p.created_at.isoformat() if p.created_at else "")


@insert_v2_router.delete("/products/{product_id}")
async def delete_product(product_id: int, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    p = await db.get(InsertProduct, product_id)
    if not p:
        raise HTTPException(404)
    await db.execute(
        sa_delete(InsertTransaction).where(InsertTransaction.product_id == product_id)
    )
    await db.delete(p)
    await db.commit()
    log("Склад вставок", f"Удалён продукт: {p.name} (с транзакциями)", user)
    return {"ok": True}


# ─── Transactions ───

class TransactionCreate(BaseModel):
    type: str  # incoming, outgoing, return
    product_id: int
    quantity: int
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
    quantity: float
    taken_by_id: int | None = None
    taken_by_name: str | None = None
    location_id: int | None = None
    location_name: str | None = None
    destination: str | None = None
    comment: str | None = None
    document: str | None = None
    created_at: str = ""

    model_config = {"from_attributes": True}


async def _balance(db: AsyncSession, product_id: int) -> int:
    inc = await db.execute(
        select(sa_func.coalesce(sa_func.sum(InsertTransaction.quantity), 0))
        .where(InsertTransaction.product_id == product_id, InsertTransaction.type == "incoming")
    )
    out = await db.execute(
        select(sa_func.coalesce(sa_func.sum(InsertTransaction.quantity), 0))
        .where(InsertTransaction.product_id == product_id, InsertTransaction.type == "outgoing")
    )
    ret = await db.execute(
        select(sa_func.coalesce(sa_func.sum(InsertTransaction.quantity), 0))
        .where(InsertTransaction.product_id == product_id, InsertTransaction.type == "return")
    )
    return int(inc.scalar() or 0) - int(out.scalar() or 0) + int(ret.scalar() or 0)


@insert_v2_router.get("/transactions", response_model=list[TransactionResponse])
async def list_transactions(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
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
            quantity=t.quantity, taken_by_id=t.taken_by_id, taken_by_name=t.taken_by.name if t.taken_by else None,
            location_id=t.location_id, location_name=t.location.name if t.location else None,
            destination=t.destination, comment=t.comment, document=t.document,
            created_at=t.created_at.isoformat() if t.created_at else "",
        ))
    return out


@insert_v2_router.post("/transactions", status_code=201, response_model=TransactionResponse)
async def create_transaction(data: TransactionCreate, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if data.type in ("outgoing", "return"):
        bal = await _balance(db, data.product_id)
        if data.type == "outgoing" and bal < data.quantity:
            raise HTTPException(400, f"На складе недостаточно (остаток: {int(bal)})")
    t = InsertTransaction(
        type=data.type, product_id=data.product_id, quantity=data.quantity,
        taken_by_id=data.taken_by_id, location_id=data.location_id,
        destination=data.destination, comment=data.comment, document=data.document,
    )
    db.add(t)
    await db.flush()
    await db.commit()
    await db.refresh(t, ['product', 'taken_by', 'location'])
    log("Склад вставок", f"{_label(data.type)}: {data.quantity} × {t.product.name if t.product else '?'}", user)
    return TransactionResponse(
        id=t.id, type=t.type, product_id=t.product_id, product_name=t.product.name if t.product else None,
        quantity=t.quantity, taken_by_id=t.taken_by_id, taken_by_name=t.taken_by.name if t.taken_by else None,
        location_id=t.location_id, location_name=t.location.name if t.location else None,
        destination=t.destination, comment=t.comment, document=t.document,
        created_at=t.created_at.isoformat() if t.created_at else "",
    )


@insert_v2_router.delete("/transactions/{tx_id}")
async def delete_transaction(tx_id: int, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    t = await db.get(InsertTransaction, tx_id)
    if not t:
        raise HTTPException(404)
    await db.delete(t)
    await db.commit()
    log("Склад вставок", f"Удалена транзакция #{t.id}", user)
    return {"ok": True}


def _label(t: str) -> str:
    return {"incoming": "Приход", "outgoing": "Выдача", "return": "Возврат"}.get(t, t)
