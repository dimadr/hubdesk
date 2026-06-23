from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from pydantic import BaseModel, Field
from src.database import get_db
from src.models.warehouse import Warehouse, Nomenclature, AccountingDocument, DocStatus, DocType, StockBalance, NomenclatureType
from src.models.equipment import warehouse_access
from src.models.user import User, UserRole
from src.services.warehouse_service import WarehouseService
from src.api.schemas import WarehouseDocCreate, WarehouseDocResponse, WarehouseResponse, BalanceResponse
from src.core.deps import get_current_user
from src.services.acl_service import RoleChecker
from src.core.fsm.exceptions import InvalidTransitionError, GuardFailedError

warehouse_router = APIRouter(tags=["Warehouse"])


@warehouse_router.get("/warehouses", response_model=list[WarehouseResponse])
async def list_warehouses(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Warehouse))
    return [WarehouseResponse.model_validate(w) for w in result.scalars().all()]


@warehouse_router.post("/warehouse-documents", status_code=201, response_model=WarehouseDocResponse)
async def create_warehouse_doc(
    data: WarehouseDocCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = WarehouseService(db)
    try:
        doc = await svc.create_document(data.model_dump(), user)
    except PermissionError:
        raise HTTPException(403, "Недостаточно прав для создания складского документа")
    except ValueError as e:
        raise HTTPException(400, str(e))
    await db.commit()
    return WarehouseDocResponse.model_validate(doc)


@warehouse_router.get("/warehouse-documents", response_model=list[WarehouseDocResponse])
async def list_documents(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(AccountingDocument).options(selectinload(AccountingDocument.lines)).order_by(AccountingDocument.id.desc()))
    docs = result.scalars().all()
    return [WarehouseDocResponse.model_validate(d) for d in docs]


@warehouse_router.patch("/warehouse-documents/{doc_id}/approve", response_model=WarehouseDocResponse)
async def approve_doc(doc_id: int, user=Depends(get_current_user), db=Depends(get_db)):
    svc = WarehouseService(db)
    try:
        doc = await svc.approve(doc_id, user)
    except PermissionError:
        raise HTTPException(403, "Недостаточно прав для изменения складского документа")
    except LookupError as e:
        raise HTTPException(404, str(e))
    except InvalidTransitionError as e:
        raise HTTPException(400, str(e))
    except GuardFailedError as e:
        raise HTTPException(400, str(e))
    await db.commit()
    return WarehouseDocResponse.model_validate(doc)


@warehouse_router.patch("/warehouse-documents/{doc_id}/deliver", response_model=WarehouseDocResponse)
async def deliver_doc(doc_id: int, user=Depends(get_current_user), db=Depends(get_db)):
    svc = WarehouseService(db)
    try:
        doc = await svc.deliver(doc_id, user)
    except PermissionError:
        raise HTTPException(403, "Недостаточно прав для изменения складского документа")
    except LookupError as e:
        raise HTTPException(404, str(e))
    except InvalidTransitionError as e:
        raise HTTPException(400, str(e))
    except GuardFailedError as e:
        raise HTTPException(400, str(e))
    await db.commit()
    return WarehouseDocResponse.model_validate(doc)


@warehouse_router.post("/warehouse-documents/{doc_id}/account", response_model=WarehouseDocResponse)
@warehouse_router.patch("/warehouse-documents/{doc_id}/account", response_model=WarehouseDocResponse)
async def account_doc(doc_id: int, user=Depends(get_current_user), db=Depends(get_db)):
    svc = WarehouseService(db)
    try:
        doc = await svc.account(doc_id, user)
    except PermissionError:
        raise HTTPException(403, "Недостаточно прав для изменения складского документа")
    except LookupError as e:
        raise HTTPException(404, str(e))
    except InvalidTransitionError as e:
        raise HTTPException(400, str(e))
    except GuardFailedError as e:
        raise HTTPException(400, str(e))
    await db.commit()
    return WarehouseDocResponse.model_validate(doc)


@warehouse_router.get("/warehouses/{warehouse_id}/balance/{nomenclature_id}", response_model=BalanceResponse)
async def get_balance(
    warehouse_id: int, nomenclature_id: int,
    user=Depends(get_current_user), db=Depends(get_db),
):
    svc = WarehouseService(db)
    qty = await svc.get_balance(warehouse_id, nomenclature_id)
    return BalanceResponse(warehouse_id=warehouse_id, nomenclature_id=nomenclature_id, quantity=qty)


class NomenclatureCreate(BaseModel):
    name: str
    type: str = "material"
    unit: str = "шт"


class NomenclatureResponse(BaseModel):
    id: int
    name: str
    type: str
    unit: str
    model_config = {"from_attributes": True}


@warehouse_router.get("/nomenclature", response_model=list[NomenclatureResponse])
async def list_nomenclature(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Nomenclature))
    return [NomenclatureResponse.model_validate(n) for n in result.scalars().all()]


@warehouse_router.post("/nomenclature", status_code=201, response_model=NomenclatureResponse)
async def create_nomenclature(data: NomenclatureCreate, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    n = Nomenclature(name=data.name, type=NomenclatureType[data.type] if data.type in NomenclatureType._member_names_ else NomenclatureType.material, unit=data.unit)
    db.add(n)
    await db.flush()
    await db.commit()
    return NomenclatureResponse.model_validate(n)


@warehouse_router.get("/balances", response_model=list[BalanceResponse])
async def list_balances(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(StockBalance))
    return [BalanceResponse(warehouse_id=b.warehouse_id, nomenclature_id=b.nomenclature_id, quantity=b.quantity) for b in result.scalars().all()]


class AccessRequest(BaseModel):
    user_id: int


@warehouse_router.get("/warehouses/{warehouse_id}/access")
async def get_warehouse_access(warehouse_id: int, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from src.models.user import User
    wh = await db.get(Warehouse, warehouse_id)
    if not wh:
        raise HTTPException(404)
    result = await db.execute(
        select(User).join(warehouse_access).where(warehouse_access.c.warehouse_id == warehouse_id)
    )
    users = result.scalars().all()
    return [{"id": u.id, "name": u.name, "email": u.email, "role": u.role.value} for u in users]


@warehouse_router.post("/warehouses/{warehouse_id}/access")
async def add_warehouse_access(warehouse_id: int, data: AccessRequest, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from fastapi import HTTPException
    if user.role not in (UserRole.admin, UserRole.storekeeper):
        raise HTTPException(403, "Only admin or storekeeper can manage warehouse access")
    stmt = warehouse_access.insert().values(warehouse_id=warehouse_id, user_id=data.user_id)
    await db.execute(stmt)
    await db.commit()
    return {"status": "ok"}


@warehouse_router.delete("/warehouses/{warehouse_id}/access/{user_id}")
async def remove_warehouse_access(warehouse_id: int, user_id: int, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from fastapi import HTTPException
    if user.role not in (UserRole.admin, UserRole.storekeeper):
        raise HTTPException(403)
    stmt = warehouse_access.delete().where(
        warehouse_access.c.warehouse_id == warehouse_id,
        warehouse_access.c.user_id == user_id,
    )
    await db.execute(stmt)
    await db.commit()
    return {"status": "ok"}


class WarehouseCreate(BaseModel):
    name: str
    type: str = "physical"


@warehouse_router.post("/warehouses", status_code=201, response_model=WarehouseResponse)
async def create_warehouse(data: WarehouseCreate, user=Depends(get_current_user), db=Depends(get_db)):
    if user.role not in (UserRole.admin, UserRole.storekeeper):
        raise HTTPException(403, "Только админ или кладовщик может создавать склады")
    w = Warehouse(name=data.name, type=data.type if data.type in ("physical", "personal") else "physical")
    db.add(w)
    await db.flush()
    await db.commit()
    return WarehouseResponse.model_validate(w)


@warehouse_router.patch("/warehouses/{warehouse_id}", response_model=WarehouseResponse)
async def rename_warehouse(warehouse_id: int, data: WarehouseCreate, user=Depends(get_current_user), db=Depends(get_db)):
    if user.role not in (UserRole.admin, UserRole.storekeeper):
        raise HTTPException(403, "Только админ или кладовщик")
    w = await db.get(Warehouse, warehouse_id)
    if not w:
        raise HTTPException(404)
    w.name = data.name
    await db.commit()
    return WarehouseResponse.model_validate(w)


@warehouse_router.delete("/warehouses/{warehouse_id}")
async def delete_warehouse(warehouse_id: int, user=Depends(get_current_user), db=Depends(get_db)):
    if user.role != UserRole.admin:
        raise HTTPException(403, "Только администратор может удалять склады")
    w = await db.get(Warehouse, warehouse_id)
    if not w:
        raise HTTPException(404)
    from sqlalchemy import select as sa_select, func
    bal = (await db.execute(sa_select(func.sum(StockBalance.quantity)).where(StockBalance.warehouse_id == warehouse_id))).scalar()
    if bal and bal > 0:
        raise HTTPException(400, f"Нельзя удалить склад с остатками (сумма: {bal}). Обнулите остатки.")
    await db.delete(w)
    await db.commit()
    return {"ok": True}
