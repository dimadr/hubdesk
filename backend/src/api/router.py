import os
import logging
from datetime import datetime, date, timezone
from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from sqlalchemy.exc import IntegrityError
from passlib.hash import bcrypt
from pydantic import BaseModel, Field, ConfigDict

from src.database import get_db
from src.models.user import User, UserRole, UserStatus, Group
from src.models.equipment import AssetLocation
from src.models.customer import Customer
from src.models.ticket import Ticket
from src.core.deps import create_token, get_current_user
from src.services.audit_service import log_audit
from src.services.inn_service import lookup_inn as do_lookup

from .tickets import create_ticket_router
from .attachments import attachment_router
from .equipment import equipment_router
from .warehouse import warehouse_router
from .views import views_router
from .admin import admin_router
from .reports import reports_router
from .personal_tasks import personal_tasks_router
from .v1_router import v1_router
from .replacement import replacement_router
from .insert_stock import insert_router
from .insert_v2 import insert_v2_router
from .audit import audit_router

logger = logging.getLogger(__name__)
api_router = APIRouter()

api_router.include_router(create_ticket_router())
api_router.include_router(attachment_router)
api_router.include_router(equipment_router)
api_router.include_router(warehouse_router)
api_router.include_router(views_router)
api_router.include_router(admin_router)
api_router.include_router(reports_router)
api_router.include_router(personal_tasks_router)
api_router.include_router(v1_router)
api_router.include_router(replacement_router)
api_router.include_router(insert_router)
api_router.include_router(insert_v2_router)
api_router.include_router(audit_router)


class SignupRequest(BaseModel):
    email: str = Field(..., max_length=255)
    name: str = Field(..., max_length=255)
    phone: str = ""
    patronymic: str = ""
    position: str = ""
    password: str = Field(..., min_length=4)
    role: str = "dispatcher"
    consent_given: bool = False


class LoginRequest(BaseModel):
    email: str
    password: str
    remember_me: bool = False


class AuthResponse(BaseModel):
    token: str
    user_id: int
    email: str
    name: str
    role: str
    status: str


class LocationResponse(BaseModel):
    id: int
    name: str
    address: str
    customer_id: int
    customer_name: str = ""
    contacts: str | None = None
    contact_name: str | None = None
    contact_phone: str | None = None
    contact_email: str | None = None
    assigned_engineer_id: int | None = None
    assigned_engineer_name: str | None = None
    contract_number: str | None = None
    contract_valid_from: date | None = None
    contract_valid_to: date | None = None
    inn: str | None = None

    model_config = ConfigDict(from_attributes=True)


class LocationCreate(BaseModel):
    name: str
    customer_id: int | None = None
    address: str = ""
    contacts: str | None = None
    contact_name: str | None = None
    contact_phone: str | None = None
    contact_email: str | None = None
    assigned_engineer_id: int | None = None
    contract_number: str | None = None
    contract_valid_from: date | None = None
    contract_valid_to: date | None = None
    inn: str | None = None


class LocationUpdate(BaseModel):
    name: str | None = None
    customer_id: int | None = None
    address: str | None = None
    contacts: str | None = None
    contact_name: str | None = None
    contact_phone: str | None = None
    contact_email: str | None = None
    assigned_engineer_id: int | None = None
    contract_number: str | None = None
    contract_valid_from: date | None = None
    contract_valid_to: date | None = None
    inn: str | None = None


class UserListResponse(BaseModel):
    id: int
    email: str
    name: str
    phone: str | None = None
    patronymic: str | None = None
    position: str | None = None
    role: str
    status: str

    model_config = ConfigDict(from_attributes=True)


class GroupResponse(BaseModel):
    id: int
    name: str

    model_config = ConfigDict(from_attributes=True)


@api_router.post("/signup", response_model=AuthResponse, tags=["Auth"])
async def signup(data: SignupRequest, db: AsyncSession = Depends(get_db)):
    if not data.consent_given:
        raise HTTPException(400, "Требуется согласие на обработку персональных данных")
    if data.role == "admin":
        raise HTTPException(400, "Роль администратора назначается только другим администратором")

    existing = await db.execute(select(User).where(User.email == data.email))
    if existing.scalar_one_or_none():
        raise HTTPException(400, "Email уже зарегистрирован")

    if data.role not in UserRole._value2member_map_:
        raise HTTPException(400, "Неизвестная роль")

    role_enum = UserRole(data.role)
    hashed_password = await run_in_threadpool(bcrypt.hash, data.password)

    user = User(
        email=data.email,
        name=data.name,
        phone=data.phone or None,
        patronymic=data.patronymic or None,
        position=data.position or None,
        role=role_enum,
        password_hash=hashed_password,
        status=UserStatus.pending,
        consent_given=True,
        consent_date=datetime.now(timezone.utc),
    )
    db.add(user)

    try:
        await db.flush()
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(400, "Email уже зарегистрирован (ошибка параллельного запроса)")

    await log_audit(
        db, None, "user_signup_requested", "user", user.id,
        f"Заявка на регистрацию: {user.name} ({user.email}), роль: {data.role}. Ожидает утверждения."
    )

    return AuthResponse(
        token="",
        user_id=user.id,
        email=user.email,
        name=user.name,
        role=user.role.value,
        status=user.status.value,
    )


@api_router.post("/login", response_model=AuthResponse, tags=["Auth"])
async def login(data: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == data.email))
    user = result.scalar_one_or_none()

    if not user or not await run_in_threadpool(bcrypt.verify, data.password, user.password_hash):
        raise HTTPException(401, "Неверный email или пароль")

    if user.status == UserStatus.pending:
        raise HTTPException(403, "Учётная запись ожидает утверждения администратором")
    if user.status == UserStatus.rejected:
        raise HTTPException(403, "Учётная запись отклонена администратором")

    ttl = 2592000 if data.remember_me else 14400
    return AuthResponse(
        token=create_token(user.id, ttl),
        user_id=user.id,
        email=user.email,
        name=user.name,
        role=user.role.value,
        status=user.status.value,
    )


@api_router.get("/locations", response_model=list[LocationResponse], tags=["Locations"])
async def list_locations(
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(AssetLocation, Customer.name)
        .join(Customer)
        .options(
            selectinload(AssetLocation.assigned_engineer),
        )
    )
    rows = result.all()
    out = []
    for loc, cust_name in rows:
        out.append(LocationResponse(
            id=loc.id, name=loc.name, address=loc.address, customer_id=loc.customer_id,
            customer_name=cust_name,
            contacts=loc.contacts,
            contact_name=loc.contact_name,
            contact_phone=loc.contact_phone,
            contact_email=loc.contact_email,
            assigned_engineer_id=loc.assigned_engineer_id,
            assigned_engineer_name=loc.assigned_engineer.name if loc.assigned_engineer else None,
            contract_number=loc.contract_number,
            contract_valid_from=loc.contract_valid_from,
            contract_valid_to=loc.contract_valid_to,
            inn=loc.inn,
        ))
    return out


@api_router.post("/locations", response_model=LocationResponse, tags=["Locations"])
async def create_location(
    data: LocationCreate,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    cust = await db.get(Customer, data.customer_id) if data.customer_id else None
    if not cust:
        cust = Customer(name=data.name, type="company")
        db.add(cust)
        await db.flush()

    loc = AssetLocation(
        name=data.name, address=data.address, customer_id=cust.id,
        contacts=data.contacts,
        contact_name=data.contact_name,
        contact_phone=data.contact_phone,
        contact_email=data.contact_email,
        assigned_engineer_id=data.assigned_engineer_id,
        contract_number=data.contract_number,
        contract_valid_from=data.contract_valid_from,
        contract_valid_to=data.contract_valid_to,
        inn=data.inn,
    )
    db.add(loc)
    await db.flush()
    await db.commit()

    await log_audit(db, user, "location_created", "location", loc.id, f"Создан объект «{loc.name}» ({loc.address})")

    eng_name = None
    if data.assigned_engineer_id:
        eng = await db.get(User, data.assigned_engineer_id)
        eng_name = eng.name if eng else None

    return LocationResponse(
        id=loc.id, name=loc.name, address=loc.address, customer_id=loc.customer_id,
        customer_name=cust.name,
        contacts=loc.contacts,
        contact_name=loc.contact_name,
        contact_phone=loc.contact_phone,
        contact_email=loc.contact_email,
        assigned_engineer_id=loc.assigned_engineer_id,
        assigned_engineer_name=eng_name,
        contract_number=loc.contract_number,
        contract_valid_from=loc.contract_valid_from,
        contract_valid_to=loc.contract_valid_to,
        inn=loc.inn,
    )


@api_router.patch("/locations/{location_id}", response_model=LocationResponse, tags=["Locations"])
async def update_location(
    location_id: int,
    data: LocationUpdate,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(AssetLocation)
        .where(AssetLocation.id == location_id)
        .options(selectinload(AssetLocation.assigned_engineer))
    )
    loc = result.scalar_one_or_none()
    if not loc:
        raise HTTPException(404, "Объект не найден")

    update_data = data.model_dump(exclude_unset=True)

    if "customer_id" in update_data:
        cust = await db.get(Customer, update_data["customer_id"]) if update_data["customer_id"] else None
        if not cust:
            cust = Customer(name=loc.name, type="company")
            db.add(cust)
            await db.flush()
            update_data["customer_id"] = cust.id

    for field, value in update_data.items():
        setattr(loc, field, value)

    await db.commit()

    if "assigned_engineer_id" in update_data:
        await db.refresh(loc, ["assigned_engineer"])

    cust = await db.get(Customer, loc.customer_id)
    cust_name = cust.name if cust else ""

    await log_audit(db, user, "location_updated", "location", loc.id, f"Изменён объект «{loc.name}»")

    return LocationResponse(
        id=loc.id, name=loc.name, address=loc.address, customer_id=loc.customer_id,
        customer_name=cust_name,
        contacts=loc.contacts,
        contact_name=loc.contact_name,
        contact_phone=loc.contact_phone,
        contact_email=loc.contact_email,
        assigned_engineer_id=loc.assigned_engineer_id,
        assigned_engineer_name=loc.assigned_engineer.name if loc.assigned_engineer else None,
        contract_number=loc.contract_number,
        contract_valid_from=loc.contract_valid_from,
        contract_valid_to=loc.contract_valid_to,
        inn=loc.inn,
    )


@api_router.delete("/locations/{location_id}", tags=["Locations"])
async def delete_location(location_id: int, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role != UserRole.admin:
        raise HTTPException(403, "Только администратор может удалять объекты")

    loc = await db.get(AssetLocation, location_id)
    if not loc:
        raise HTTPException(404, "Объект не найден")

    ticket_count_res = await db.execute(
        select(func.count()).select_from(Ticket).where(Ticket.location_id == location_id)
    )
    ticket_count = ticket_count_res.scalar()

    if ticket_count > 0:
        raise HTTPException(400, f"Нельзя удалить объект с заявками ({ticket_count} шт.)")

    await db.delete(loc)
    await db.commit()
    await log_audit(db, user, "location_deleted", "location", location_id, f"Удалён объект «{loc.name}»")
    return {"ok": True}


@api_router.get("/locations/lookup-inn", tags=["Locations"])
async def lookup_inn(inn: str, user=Depends(get_current_user)):
    return await do_lookup(inn.strip())


@api_router.get("/users/list", response_model=list[UserListResponse], tags=["Users"])
async def list_users(
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role not in (UserRole.admin, UserRole.dispatcher, UserRole.manager):
        raise HTTPException(403, "Недостаточно прав для просмотра списка пользователей")

    result = await db.execute(select(User))
    users = result.scalars().all()
    return users


@api_router.get("/groups", response_model=list[GroupResponse], tags=["Groups"])
async def list_groups(
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Group))
    return result.scalars().all()
