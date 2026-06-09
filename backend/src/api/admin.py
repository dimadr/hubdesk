from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from pydantic import BaseModel, Field
from src.database import get_db
from src.models.user import User, UserRole, UserStatus
from src.models.customer import Customer
from src.models.ticket import Ticket, TicketStatus
from src.models.equipment import AssetLocation
from src.models.warehouse import Warehouse
from src.core.deps import get_current_user
from src.services.sla_service import SLAService
import os

admin_router = APIRouter(prefix="/admin", tags=["Admin"])


def is_admin(user: User):
    if user.role != UserRole.admin:
        raise HTTPException(403, "Только администратор")
    return user


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
    user_breakdown: list[dict]


@admin_router.get("/stats", response_model=SystemStats)
async def system_stats(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    is_admin(user)

    users_count = (await db.execute(select(func.count()).select_from(User))).scalar()
    customers_count = (await db.execute(select(func.count()).select_from(Customer))).scalar()
    locations_count = (await db.execute(select(func.count()).select_from(AssetLocation))).scalar()
    warehouses_count = (await db.execute(select(func.count()).select_from(Warehouse))).scalar()

    all_tickets = (await db.execute(select(Ticket))).scalars().all()
    total_tickets = len(all_tickets)
    open_tickets = sum(1 for t in all_tickets if t.status != TicketStatus.COMPLETED)
    overdue_tickets = sum(1 for t in all_tickets if SLAService.is_response_overdue(t) or SLAService.is_resolution_overdue(t))
    completed_tickets = sum(1 for t in all_tickets if t.status == TicketStatus.COMPLETED)
    critical_tickets = sum(1 for t in all_tickets if t.priority.value in ("critical", "high"))

    user_result = await db.execute(select(User.role, func.count().label("cnt")).group_by(User.role))
    user_breakdown = [{"role": r, "count": c} for r, c in user_result.all()]

    return SystemStats(
        total_users=users_count,
        total_customers=customers_count,
        total_locations=locations_count,
        total_warehouses=warehouses_count,
        total_tickets=total_tickets,
        open_tickets=open_tickets,
        overdue_tickets=overdue_tickets,
        completed_tickets=completed_tickets,
        critical_tickets=critical_tickets,
        user_breakdown=user_breakdown,
    )


@admin_router.get("/history")
async def read_history(user=Depends(get_current_user)):
    is_admin(user)
    history_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "history.log")
    if not os.path.exists(history_path):
        return {"lines": []}

    lines = []
    with open(history_path, "r") as f:
        for line in f:
            lines.append(line.rstrip("\n"))
    lines.reverse()
    return {"lines": lines[-200:]}


class UserUpdate(BaseModel):
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    position: str | None = None
    role: str | None = None
    password: str | None = None
    status: str | None = None


@admin_router.patch("/users/{user_id}")
async def update_user(
    user_id: int,
    data: UserUpdate,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    is_admin(user)
    from passlib.hash import bcrypt
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(404, "Пользователь не найден")
    if data.name is not None:
        target.name = data.name
    if data.email is not None:
        target.email = data.email
    if data.phone is not None:
        target.phone = data.phone
    if data.position is not None:
        target.position = data.position
    if data.role is not None:
        if data.role not in UserRole.__members__:
            raise HTTPException(400, "Неизвестная роль")
        target.role = UserRole(data.role)
    if data.password:
        target.password_hash = bcrypt.hash(data.password)
    if data.status is not None and data.status in UserStatus.__members__:
        target.status = UserStatus(data.status)
    await db.commit()
    return {"ok": True}


@admin_router.delete("/users/{user_id}")
async def delete_user(user_id: int, current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    is_admin(current_user)
    if user_id == current_user.id:
        raise HTTPException(400, "Нельзя удалить самого себя")
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(404, "Пользователь не найден")
    await db.delete(target)
    await db.commit()
    return {"ok": True}


# ── Customers CRUD ──

class CustomerResponse(BaseModel):
    id: int
    name: str
    type: str
    locations_count: int = 0

    model_config = {"from_attributes": True}


class CustomerCreate(BaseModel):
    name: str
    type: str = "company"


@admin_router.get("/customers", response_model=list[CustomerResponse])
async def list_customers(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    is_admin(user)
    result = await db.execute(select(Customer))
    customers = result.scalars().all()
    out = []
    for c in customers:
        loc_cnt = (await db.execute(select(func.count()).select_from(AssetLocation).where(AssetLocation.customer_id == c.id))).scalar()
        out.append(CustomerResponse(id=c.id, name=c.name, type=c.type.value, locations_count=loc_cnt))
    return out


@admin_router.post("/customers", response_model=CustomerResponse)
async def create_customer(data: CustomerCreate, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    is_admin(user)
    c = Customer(name=data.name, type=data.type)
    db.add(c)
    await db.flush()
    await db.commit()
    return CustomerResponse(id=c.id, name=c.name, type=c.type.value, locations_count=0)


@admin_router.patch("/customers/{customer_id}", response_model=CustomerResponse)
async def update_customer(customer_id: int, data: CustomerCreate, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    is_admin(user)
    c = await db.get(Customer, customer_id)
    if not c:
        raise HTTPException(404)
    c.name = data.name
    c.type = data.type
    await db.commit()
    loc_cnt = (await db.execute(select(func.count()).select_from(AssetLocation).where(AssetLocation.customer_id == c.id))).scalar()
    return CustomerResponse(id=c.id, name=c.name, type=c.type.value, locations_count=loc_cnt)


@admin_router.delete("/customers/{customer_id}")
async def delete_customer(customer_id: int, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    is_admin(user)
    c = await db.get(Customer, customer_id)
    if not c:
        raise HTTPException(404)
    if c.locations:
        raise HTTPException(400, "Нельзя удалить клиента с объектами. Сначала удалите объекты.")
    await db.delete(c)
    await db.commit()
    return {"ok": True}


class PendingUserResponse(BaseModel):
    id: int
    email: str
    name: str
    role: str
    status: str
    consent_given: bool
    consent_date: str | None = None

    model_config = {"from_attributes": True}


@admin_router.get("/pending-users", response_model=list[PendingUserResponse])
async def list_pending_users(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    is_admin(user)
    result = await db.execute(select(User).where(User.status == UserStatus.pending))
    users = result.scalars().all()
    return [PendingUserResponse(
        id=u.id, email=u.email, name=u.name, role=u.role.value,
        status=u.status.value, consent_given=u.consent_given,
        consent_date=u.consent_date.isoformat() if u.consent_date else None,
    ) for u in users]


@admin_router.post("/pending-users/{user_id}/approve")
async def approve_user(user_id: int, admin=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    is_admin(admin)
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(404, "Пользователь не найден")
    target.status = UserStatus.active
    await db.commit()

    log_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "history.log")
    ts = __import__("datetime").datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    with open(log_path, "a", encoding="utf-8") as f:
        f.write(f"[{ts}] {admin.name} — Утвердил пользователя: {target.name} ({target.email}), роль: {target.role.value}\n")

    return {"ok": True}


@admin_router.post("/pending-users/{user_id}/reject")
async def reject_user(user_id: int, admin=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    is_admin(admin)
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(404, "Пользователь не найден")
    target.status = UserStatus.rejected
    await db.commit()

    log_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "history.log")
    ts = __import__("datetime").datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    with open(log_path, "a", encoding="utf-8") as f:
        f.write(f"[{ts}] {admin.name} — Отклонил пользователя: {target.name} ({target.email}), роль: {target.role.value}\n")

    return {"ok": True}


class MailboxConfigRequest(BaseModel):
    enabled: bool = False
    imap_server: str = "imap.timeweb.ru"
    imap_port: int = 993
    folder: str = "INBOX"
    check_interval_min: int = 5


class MailboxConfigResponse(BaseModel):
    id: int
    enabled: bool
    email: str
    imap_server: str
    imap_port: int
    folder: str
    check_interval_min: int
    last_check_at: str | None = None
    last_uid: str | None = None

    model_config = {"from_attributes": True}


@admin_router.get("/mailbox", response_model=None)
async def get_mailbox(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    is_admin(user)
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
    return {
        "id": cfg.id, "enabled": cfg.enabled, "email": cfg.email,
        "imap_server": cfg.imap_server, "imap_port": cfg.imap_port,
        "folder": cfg.folder, "check_interval_min": cfg.check_interval_min,
        "last_check_at": cfg.last_check_at.isoformat() if cfg.last_check_at else None,
        "last_uid": cfg.last_uid,
    }
@admin_router.post("/mailbox/fetch")
async def trigger_mailbox_fetch(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    is_admin(user)
    from src.services.mail_service import MailService
    try:
        count = await MailService.fetch_and_create_tickets(db)
        return {"ok": True, "created": count}
    except Exception as e:
        raise HTTPException(500, str(e))
