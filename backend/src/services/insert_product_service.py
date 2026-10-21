from fastapi import HTTPException
from sqlalchemy import func, select, text

from src.models.insert_stock import InsertProduct


async def check_product_name(db, name: str, exclude_id: int | None = None) -> str:
    name = name.strip()
    if not name:
        raise HTTPException(422, "Название продукта обязательно")
    # The index may be absent on legacy databases with unresolved duplicates.
    await db.execute(
        text("SELECT pg_advisory_xact_lock(44, hashtext(lower(btrim(:name))))"),
        {"name": name},
    )
    statement = select(InsertProduct.id).where(
        func.lower(func.btrim(InsertProduct.name)) == func.lower(func.btrim(name))
    )
    if exclude_id is not None:
        statement = statement.where(InsertProduct.id != exclude_id)
    ids = (await db.execute(statement.order_by(InsertProduct.id))).scalars().all()
    if ids:
        raise HTTPException(400, f"Продукт с таким названием уже существует (ID: {', '.join(map(str, ids))})")
    return name
