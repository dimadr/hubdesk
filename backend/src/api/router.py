import os
import time
import logging
from datetime import datetime, date, timezone
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from sqlalchemy.exc import IntegrityError
from passlib.hash import bcrypt
from pydantic import BaseModel, Field, ConfigDict

logger = logging.getLogger(__name__)

# Simple in-memory rate limiter for login attempts
_login_attempts: dict[str, list[float]] = {}
_LOGIN_RATE_LIMIT = 5  # max attempts
_LOGIN_RATE_WINDOW = 600  # 10 minutes in seconds


def _check_login_rate_limit(ip: str) -> None:
    now = time.time()
    attempts = _login_attempts.get(ip, [])
    attempts = [t for t in attempts if now - t < _LOGIN_RATE_WINDOW]
    _login_attempts[ip] = attempts
    if len(attempts) >= _LOGIN_RATE_LIMIT:
        raise HTTPException(429, "Слишком много попыток входа. Попробуйте через 10 минут.")
    attempts.append(now)

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
    password: str = Field(..., min_length=12)
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


class ContactItem(BaseModel):
    id: int | None = None
    name: str
    phone: str | None = None
    email: str | None = None
    position: str | None = None
    is_primary: bool = False


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
    contacts_list: list[ContactItem] = []
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
    customer_name: str | None = None
    address: str = ""
    contacts: str | None = None
    contact_name: str | None = None
    contact_phone: str | None = None
    contact_email: str | None = None
    contacts_list: list[ContactItem] = []
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
    contacts_list: list[ContactItem] | None = None
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
    customer_id: int | None = None

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
        consent_date=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db.add(user)

    try:
        await db.flush()
        await log_audit(
            db, None, "user_signup_requested", "user", user.id,
            f"Заявка на регистрацию: {user.name} ({user.email}), роль: {data.role}. Ожидает утверждения."
        )
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(400, "Email уже зарегистрирован (ошибка параллельного запроса)")

    return AuthResponse(
        token="",
        user_id=user.id,
        email=user.email,
        name=user.name,
        role=user.role.value,
        status=user.status.value,
    )


@api_router.post("/login", response_model=AuthResponse, tags=["Auth"])
async def login(data: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)):
    client_ip = request.client.host if request.client else "unknown"
    _check_login_rate_limit(client_ip)

    result = await db.execute(select(User).where(User.email == data.email))
    user = result.scalar_one_or_none()

    if not user or not await run_in_threadpool(bcrypt.verify, data.password, user.password_hash):
        logger.warning(f"Failed login attempt for {data.email} from {client_ip}")
        raise HTTPException(401, "Неверный email или пароль")

    # Successful login — clear rate limit for this IP
    _login_attempts.pop(client_ip, None)

    if user.status == UserStatus.pending:
        raise HTTPException(403, "Учётная запись ожидает утверждения администратором")
    if user.status == UserStatus.rejected:
        raise HTTPException(403, "Учётная запись отклонена администратором")

    ttl = 604800 if data.remember_me else 14400
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
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(AssetLocation, Customer.name)
        .join(Customer)
        .options(
            selectinload(AssetLocation.assigned_engineer),
            selectinload(AssetLocation.contacts_list),
        )
    )
    if user.role in (UserRole.admin, UserRole.director, UserRole.dispatcher, UserRole.accountant,
                     UserRole.storekeeper, UserRole.metrologist, UserRole.viewer):
        pass  # all locations
    elif user.role == UserRole.engineer:
        stmt = stmt.where(AssetLocation.assigned_engineer_id == user.id)
    elif user.role == UserRole.customer:
        if user.customer_id is None:
            raise HTTPException(403, "Пользователь не привязан к заказчику")
        stmt = stmt.where(AssetLocation.customer_id == user.customer_id)
    else:
        raise HTTPException(403, "Недостаточно прав")

    result = await db.execute(stmt)
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
            contacts_list=[ContactItem(id=c.id, name=c.name, phone=c.phone, email=c.email, position=c.position, is_primary=c.is_primary) for c in loc.contacts_list],
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
    if user.role not in (UserRole.admin, UserRole.director, UserRole.dispatcher, UserRole.accountant, UserRole.engineer):
        raise HTTPException(403, "Недостаточно прав")
    if data.assigned_engineer_id:
        eng = await db.get(User, data.assigned_engineer_id)
        if not eng or eng.role != UserRole.engineer:
            raise HTTPException(400, "Назначенный сотрудник должен иметь роль engineer")
    if data.customer_id:
        cust = await db.get(Customer, data.customer_id)
        if not cust:
            raise HTTPException(400, "Клиент не найден")
    elif data.customer_name:
        cust = Customer(name=data.customer_name.strip(), type="company")
        db.add(cust)
        await db.flush()
    else:
        raise HTTPException(400, "Укажите клиента (customer_id или customer_name)")

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

    from src.models.equipment import LocationContact
    for c in data.contacts_list:
        db.add(LocationContact(
            location_id=loc.id, name=c.name, phone=c.phone,
            email=c.email, position=c.position, is_primary=c.is_primary,
        ))
    await db.flush()

    await log_audit(db, user, "location_created", "location", loc.id, f"Создан объект «{loc.name}» ({loc.address})")
    await db.commit()

    eng_name = None
    if data.assigned_engineer_id:
        eng = await db.get(User, data.assigned_engineer_id)
        eng_name = eng.name if eng else None

    await db.refresh(loc, ['contacts_list'])

    return LocationResponse(
        id=loc.id, name=loc.name, address=loc.address, customer_id=loc.customer_id,
        customer_name=cust.name,
        contacts=loc.contacts,
        contact_name=loc.contact_name,
        contact_phone=loc.contact_phone,
        contact_email=loc.contact_email,
        contacts_list=[ContactItem(id=c.id, name=c.name, phone=c.phone, email=c.email, position=c.position, is_primary=c.is_primary) for c in loc.contacts_list],
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
    if user.role not in (UserRole.admin, UserRole.director, UserRole.dispatcher, UserRole.accountant):
        raise HTTPException(403, "Недостаточно прав")
    result = await db.execute(
        select(AssetLocation)
        .where(AssetLocation.id == location_id)
        .options(selectinload(AssetLocation.assigned_engineer), selectinload(AssetLocation.contacts_list))
    )
    loc = result.scalar_one_or_none()
    if not loc:
        raise HTTPException(404, "Объект не найден")

    update_data = data.model_dump(exclude_unset=True)
    contacts_data = update_data.pop('contacts_list', None)

    if "assigned_engineer_id" in update_data and update_data["assigned_engineer_id"]:
        eng = await db.get(User, update_data["assigned_engineer_id"])
        if not eng or eng.role != UserRole.engineer:
            raise HTTPException(400, "Назначенный сотрудник должен иметь роль engineer")

    if "customer_id" in update_data:
        if update_data["customer_id"]:
            cust = await db.get(Customer, update_data["customer_id"])
            if not cust:
                raise HTTPException(400, "Клиент не найден")
        else:
            raise HTTPException(400, "customer_id не может быть пустым")

    for field, value in update_data.items():
        setattr(loc, field, value)

    if contacts_data is not None:
        from src.models.equipment import LocationContact
        for c in loc.contacts_list:
            await db.delete(c)
        for c in contacts_data:
            if isinstance(c, dict):
                db.add(LocationContact(
                    location_id=loc.id, name=c.get("name", ""), phone=c.get("phone"),
                    email=c.get("email"), position=c.get("position"), is_primary=c.get("is_primary", False),
                ))
            else:
                db.add(LocationContact(
                    location_id=loc.id, name=c.name, phone=c.phone,
                    email=c.email, position=c.position, is_primary=c.is_primary,
                ))

    await log_audit(db, user, "location_updated", "location", loc.id, f"Изменён объект «{loc.name}»")
    await db.commit()

    if "assigned_engineer_id" in update_data:
        await db.refresh(loc, ["assigned_engineer"])
    await db.refresh(loc, ["contacts_list"])

    cust = await db.get(Customer, loc.customer_id)
    cust_name = cust.name if cust else ""

    return LocationResponse(
        id=loc.id, name=loc.name, address=loc.address, customer_id=loc.customer_id,
        customer_name=cust_name,
        contacts=loc.contacts,
        contact_name=loc.contact_name,
        contact_phone=loc.contact_phone,
        contact_email=loc.contact_email,
        contacts_list=[ContactItem(id=c.id, name=c.name, phone=c.phone, email=c.email, position=c.position, is_primary=c.is_primary) for c in loc.contacts_list],
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
    ticket_count = ticket_count_res.scalar() or 0

    if ticket_count > 0:
        raise HTTPException(400, f"Нельзя удалить объект с заявками ({ticket_count} шт.)")

    await db.delete(loc)
    await log_audit(db, user, "location_deleted", "location", location_id, f"Удалён объект «{loc.name}»")
    await db.commit()
    return {"ok": True}


@api_router.get("/locations/lookup-inn", tags=["Locations"])
async def lookup_inn(inn: str, user=Depends(get_current_user)):
    return await do_lookup(inn.strip())


@api_router.get("/users/list", response_model=list[UserListResponse], tags=["Users"])
async def list_users(
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role not in (UserRole.admin, UserRole.director, UserRole.dispatcher, UserRole.accountant):
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
