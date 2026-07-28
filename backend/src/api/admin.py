import os
import secrets
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, case
from sqlalchemy.exc import IntegrityError
from pydantic import BaseModel, ConfigDict, Field
from passlib.hash import bcrypt

from src.database import get_db
from src.models.user import User, UserRole, UserStatus
from src.models.customer import Customer, CustomerType
from src.models.ticket import Ticket, TicketStatus, TicketPriority
from src.models.equipment import AssetLocation
from src.models.warehouse import Warehouse
from src.core.deps import get_current_user
from src.services.audit_service import log_audit

logger = logging.getLogger(__name__)
admin_router = APIRouter(prefix="/admin", tags=["Admin"])


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != UserRole.admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Доступ запрещен: требуется роль администратора"
        )
    return user


class RoleBreakdown(BaseModel):
    role: str
    count: int


class SystemStats(BaseModel):
    total_users: int
    total_customers: int
    total_locations: int
    total_warehouses: int
    total_tickets: int
    open_tickets: int
    overdue_tickets: int
    completed_tickets: int
    critical_tickets: int
    user_breakdown: List[RoleBreakdown]


class UserUpdate(BaseModel):
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    patronymic: str | None = None
    position: str | None = None
    role: str | None = None
    password: str | None = None
    status: str | None = None
    customer_id: int | None = None


class AdminUserCreate(BaseModel):
    email: str = Field(..., max_length=255)
    name: str = Field(..., min_length=1, max_length=255)
    phone: str = Field("", max_length=50)
    patronymic: str = Field("", max_length=255)
    password: str = Field(..., min_length=12)
    role: str
    consent_given: bool


class CustomerResponse(BaseModel):
    id: int
    name: str
    type: str
    locations_count: int

    model_config = ConfigDict(from_attributes=True)


class CustomerCreate(BaseModel):
    name: str
    type: CustomerType = CustomerType.company


class CustomerUpdate(BaseModel):
    name: str | None = None
    type: CustomerType | None = None


class PendingUserResponse(BaseModel):
    id: int
    email: str
    name: str
    role: str
    status: str
    consent_given: bool
    consent_date: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class ApiKeyResponse(BaseModel):
    id: int
    key: str
    name: str
    is_active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CreateApiKeyRequest(BaseModel):
    name: str


def _sync_read_history(history_path: str) -> List[str]:
    if not os.path.exists(history_path):
        return []
    lines = []
    with open(history_path, "r", encoding="utf-8") as f:
        for line in f:
            lines.append(line.rstrip("\n"))
            if len(lines) > 2000:
                lines = lines[-200:]
    lines.reverse()
    return lines[:200]


def _sync_write_history_log(history_path: str, admin_name: str, text_msg: str):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with open(history_path, "a", encoding="utf-8") as f:
        f.write(f"[{ts}] {admin_name} — {text_msg}\n")


@admin_router.get("/stats", response_model=SystemStats)
async def system_stats(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    users_count = (await db.execute(select(func.count()).select_from(User))).scalar() or 0
    customers_count = (await db.execute(select(func.count()).select_from(Customer))).scalar() or 0
    locations_count = (await db.execute(select(func.count()).select_from(AssetLocation))).scalar() or 0
    warehouses_count = (await db.execute(select(func.count()).select_from(Warehouse))).scalar() or 0

    overdue_cond = (
        ((Ticket.response_deadline < func.now()) & (Ticket.accepted_at == None)) |
        ((Ticket.resolution_deadline < func.now()) & (Ticket.status != TicketStatus.COMPLETED))
    )

    ticket_stmt = select(
        func.count(Ticket.id).label("total"),
        func.sum(case((Ticket.status != TicketStatus.COMPLETED, 1), else_=0)).label("open"),
        func.sum(case((Ticket.status == TicketStatus.COMPLETED, 1), else_=0)).label("completed"),
        func.sum(case((Ticket.priority.in_([TicketPriority.critical, TicketPriority.high]), 1), else_=0)).label("critical"),
        func.sum(case((overdue_cond, 1), else_=0)).label("overdue"),
    )

    ticket_res = (await db.execute(ticket_stmt)).one_or_none()

    total_t = getattr(ticket_res, 'total', 0) or 0
    open_t = getattr(ticket_res, 'open', 0) or 0
    completed_t = getattr(ticket_res, 'completed', 0) or 0
    critical_t = getattr(ticket_res, 'critical', 0) or 0
    overdue_t = getattr(ticket_res, 'overdue', 0) or 0

    user_result = await db.execute(select(User.role, func.count().label("cnt")).group_by(User.role))
    user_breakdown = [{"role": r.value if hasattr(r, 'value') else str(r), "count": c} for r, c in user_result.all()]

    return SystemStats(
        total_users=users_count,
        total_customers=customers_count,
        total_locations=locations_count,
        total_warehouses=warehouses_count,
        total_tickets=total_t,
        open_tickets=open_t,
        overdue_tickets=overdue_t,
        completed_tickets=completed_t,
        critical_tickets=critical_t,
        user_breakdown=user_breakdown,
    )


@admin_router.get("/history")
async def read_history(admin: User = Depends(require_admin)):
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    history_path = os.path.normpath(os.path.join(base_dir, "history.log"))

    lines = await run_in_threadpool(_sync_read_history, history_path)
    return {"lines": lines}


@admin_router.patch("/users/{user_id}")
async def update_user(
    user_id: int,
    data: UserUpdate,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    if data.name is not None: target.name = data.name
    if data.email is not None:
        existing = await db.execute(select(User).where(User.email == data.email, User.id != user_id))
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Email уже используется")
        target.email = data.email
    if data.phone is not None: target.phone = data.phone
    if data.patronymic is not None: target.patronymic = data.patronymic
    if data.position is not None: target.position = data.position

    if data.role is not None:
        if data.role not in UserRole.__members__:
            raise HTTPException(status_code=400, detail="Неизвестная роль")
        target.role = UserRole(data.role)

    if data.password:
        if len(data.password) < 12:
            raise HTTPException(status_code=400, detail="Пароль должен быть не менее 12 символов")
        target.password_hash = await run_in_threadpool(bcrypt.hash, data.password)

    if data.status is not None:
        if data.status not in UserStatus.__members__:
            raise HTTPException(status_code=400, detail="Неизвестный статус")
        target.status = UserStatus(data.status)

    if data.customer_id is not None:
        if data.customer_id != 0:
            cust = await db.get(Customer, data.customer_id)
            if not cust:
                raise HTTPException(status_code=400, detail="Заказчик не найден")
        target.customer_id = data.customer_id if data.customer_id != 0 else None

    await log_audit(db, admin, "user_updated", "user", target.id, f"Изменён пользователь: {target.name}")
    await db.commit()
    return {"ok": True}


@admin_router.post("/users", status_code=201)
async def create_user(
    data: AdminUserCreate,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    if not data.consent_given:
        raise HTTPException(400, "Требуется согласие на обработку персональных данных")
    if data.role not in UserRole._value2member_map_:
        raise HTTPException(400, "Неизвестная роль")
    existing = await db.execute(select(User).where(User.email == data.email))
    if existing.scalar_one_or_none():
        raise HTTPException(400, "Email уже зарегистрирован")

    user = User(
        email=data.email,
        name=data.name,
        phone=data.phone or None,
        patronymic=data.patronymic or None,
        role=UserRole(data.role),
        password_hash=await run_in_threadpool(bcrypt.hash, data.password),
        status=UserStatus.pending,
        consent_given=True,
        consent_date=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db.add(user)
    try:
        await db.flush()
        await log_audit(
            db,
            admin,
            "user_created",
            "user",
            user.id,
            f"Создан пользователь: {user.name} ({user.email}), роль: {user.role.value}",
        )
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(400, "Email уже зарегистрирован")
    return {"id": user.id, "status": user.status.value}


@admin_router.delete("/users/{user_id}")
async def delete_user(user_id: int, admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    raise HTTPException(status_code=403, detail="Удаление отключено в RC-режиме")
    # RC: удаление только с прямого одобрения пользователя
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="Нельзя удалить самого себя")

    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    await db.delete(target)
    await db.commit()
    await log_audit(db, admin, "user_deleted", "user", user_id, f"Удалён пользователь: {target.name}")
    return {"ok": True}


@admin_router.get("/customers", response_model=List[CustomerResponse])
async def list_customers(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role not in (UserRole.admin, UserRole.director, UserRole.accountant):
        raise HTTPException(status_code=403, detail="Недостаточно прав")
    stmt = (
        select(Customer, func.count(AssetLocation.id).label("loc_count"))
        .outerjoin(AssetLocation, AssetLocation.customer_id == Customer.id)
        .group_by(Customer.id)
        .order_by(Customer.name)
    )
    result = await db.execute(stmt)

    out = []
    for row in result.all():
        c, loc_cnt = row[0], row[1]
        out.append(CustomerResponse(
            id=c.id,
            name=c.name,
            type=c.type.value if hasattr(c.type, 'value') else str(c.type),
            locations_count=loc_cnt
        ))
    return out


@admin_router.post("/customers", response_model=CustomerResponse, status_code=201)
async def create_customer(data: CustomerCreate, admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    c = Customer(name=data.name, type=data.type)
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return CustomerResponse(id=c.id, name=c.name, type=c.type.value if hasattr(c.type, 'value') else str(c.type), locations_count=0)


@admin_router.patch("/customers/{customer_id}", response_model=CustomerResponse)
async def update_customer(customer_id: int, data: CustomerUpdate, admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    c = await db.get(Customer, customer_id)
    if not c:
        raise HTTPException(status_code=404, detail="Контрагент не найден")

    if data.name is not None:
        c.name = data.name
    if data.type is not None:
        c.type = data.type

    await db.commit()

    loc_cnt = (await db.execute(select(func.count()).select_from(AssetLocation).where(AssetLocation.customer_id == c.id))).scalar() or 0
    return CustomerResponse(id=c.id, name=c.name, type=c.type.value if hasattr(c.type, 'value') else str(c.type), locations_count=loc_cnt)


@admin_router.delete("/customers/{customer_id}")
async def delete_customer(customer_id: int, admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    raise HTTPException(status_code=403, detail="Удаление отключено в RC-режиме")
    # RC: удаление только с прямого одобрения пользователя


@admin_router.get("/pending-users", response_model=List[PendingUserResponse])
async def list_pending_users(admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.status == UserStatus.pending))
    users = result.scalars().all()
    return users


@admin_router.post("/pending-users/{user_id}/approve")
async def approve_user(user_id: int, admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    target.status = UserStatus.active
    await db.commit()

    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    history_path = os.path.normpath(os.path.join(base_dir, "history.log"))

    await run_in_threadpool(
        _sync_write_history_log,
        history_path,
        admin.name,
        f"Утвердил пользователя: {target.name} ({target.email}), роль: {target.role.value}"
    )
    return {"ok": True}


@admin_router.post("/pending-users/{user_id}/reject")
async def reject_user(user_id: int, admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    target.status = UserStatus.rejected
    await db.commit()

    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    history_path = os.path.normpath(os.path.join(base_dir, "history.log"))

    await run_in_threadpool(
        _sync_write_history_log,
        history_path,
        admin.name,
        f"Отклонил пользователя: {target.name} ({target.email}), роль: {target.role.value}"
    )
    return {"ok": True}


@admin_router.get("/mailbox")
async def get_mailbox(admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    from src.models.mailbox import MailboxConfig
    result = await db.execute(select(MailboxConfig).limit(1))
    cfg = result.scalar_one_or_none()
    if not cfg:
        return None
    return {
        "id": cfg.id, "enabled": cfg.enabled, "email": cfg.email,
        "imap_server": cfg.imap_server, "imap_port": cfg.imap_port,
        "folder": cfg.folder, "check_interval_min": cfg.check_interval_min,
        "last_check_at": cfg.last_check_at.isoformat() if cfg.last_check_at else None,
        "last_uid": cfg.last_uid,
    }


class MailboxUpdate(BaseModel):
    enabled: bool = False
    email: str = ""
    imap_server: str = "imap.timeweb.ru"
    imap_port: int = 993
    folder: str = "INBOX"
    check_interval_min: int = 5


@admin_router.post("/mailbox")
async def save_mailbox(data: MailboxUpdate, admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    from src.models.mailbox import MailboxConfig
    result = await db.execute(select(MailboxConfig).limit(1))
    cfg = result.scalar_one_or_none()
    if cfg:
        cfg.enabled = data.enabled
        cfg.email = data.email
        cfg.imap_server = data.imap_server
        cfg.imap_port = data.imap_port
        cfg.folder = data.folder
        cfg.check_interval_min = max(1, min(data.check_interval_min, 1440))
    else:
        cfg = MailboxConfig(
            enabled=data.enabled, email=data.email,
            imap_server=data.imap_server, imap_port=data.imap_port,
            folder=data.folder, check_interval_min=data.check_interval_min,
        )
        db.add(cfg)
    await db.commit()
    return {"ok": True}


@admin_router.post("/mailbox/fetch")
async def trigger_mailbox_fetch(admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    from src.services.mail_service import MailService
    try:
        count = await MailService.fetch_and_create_tickets(db)
        return {"ok": True, "created": count}
    except Exception:
        logger.exception("Mailbox fetch failed")
        raise HTTPException(status_code=500, detail="Ошибка обработки почтового ящика")


@admin_router.get("/api-keys", response_model=List[ApiKeyResponse])
async def list_api_keys(admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    from src.models.api_key import ApiKey
    result = await db.execute(select(ApiKey).order_by(ApiKey.id.desc()))
    keys = result.scalars().all()
    return [ApiKeyResponse(id=k.id, key="****", name=k.name, is_active=k.is_active, created_at=k.created_at) for k in keys]


@admin_router.post("/api-keys", response_model=ApiKeyResponse, status_code=201)
async def create_api_key(data: CreateApiKeyRequest, admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    from src.models.api_key import ApiKey
    raw_key = secrets.token_hex(24)
    k = ApiKey(name=data.name, key_hash=ApiKey.hash_key(raw_key))
    db.add(k)
    await db.commit()
    await db.refresh(k)
    return ApiKeyResponse(id=k.id, key=raw_key, name=k.name, is_active=k.is_active, created_at=k.created_at)


@admin_router.patch("/api-keys/{key_id}")
async def toggle_api_key(key_id: int, admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    from src.models.api_key import ApiKey
    k = await db.get(ApiKey, key_id)
    if not k:
        raise HTTPException(status_code=404, detail="Ключ API не найден")
    k.is_active = not k.is_active
    await db.commit()
    return {"ok": True, "is_active": k.is_active}


@admin_router.delete("/api-keys/{key_id}")
async def delete_api_key(key_id: int, admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    from src.models.api_key import ApiKey
    k = await db.get(ApiKey, key_id)
    if not k:
        raise HTTPException(status_code=404, detail="Ключ API не найден")
    await db.delete(k)
    await db.commit()
    return {"ok": True}
