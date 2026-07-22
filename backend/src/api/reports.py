from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from sqlalchemy.orm import selectinload
from datetime import datetime, timedelta
from src.database import get_db
from src.models.ticket import Ticket, TicketStatus
from src.models.customer import Customer
from src.models.equipment import AssetLocation
from src.models.user import User, UserRole
from src.core.deps import get_current_user
from src.api.schemas import TicketResponse

reports_router = APIRouter(prefix="/reports", tags=["Reports"])


def check_access(user: User):
    if user.role not in (UserRole.admin, UserRole.director, UserRole.dispatcher, UserRole.accountant):
        raise HTTPException(403, "Доступно администратору, директору, диспетчеру и бухгалтеру")


def _parse_date(s: str) -> datetime:
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is not None:
        dt = dt.replace(tzinfo=None)
    return dt


async def ticket_query(db: AsyncSession, date_from: str | None, date_to: str | None):
    from sqlalchemy import or_, and_
    stmt = select(Ticket).options(
        selectinload(Ticket.customer),
        selectinload(Ticket.location),
        selectinload(Ticket.assignee),
    )
    dt_from = None
    dt_to = None
    if date_from:
        try:
            dt_from = _parse_date(date_from)
        except ValueError:
            raise HTTPException(400, f"Некорректная дата: {date_from}")
    if date_to:
        try:
            dt_to = _parse_date(date_to)
        except ValueError:
            raise HTTPException(400, f"Некорректная дата: {date_to}")
    if dt_from and dt_to:
        stmt = stmt.where(or_(
            and_(Ticket.created_at >= dt_from, Ticket.created_at <= dt_to),
            and_(Ticket.status == TicketStatus.COMPLETED, Ticket.completed_at >= dt_from, Ticket.completed_at <= dt_to),
        ))
    elif dt_from:
        stmt = stmt.where(or_(
            Ticket.created_at >= dt_from,
            and_(Ticket.status == TicketStatus.COMPLETED, Ticket.completed_at >= dt_from),
        ))
    elif dt_to:
        stmt = stmt.where(or_(
            Ticket.created_at <= dt_to,
            and_(Ticket.status == TicketStatus.COMPLETED, Ticket.completed_at <= dt_to),
        ))
    result = await db.execute(stmt)
    return result.scalars().all()


@reports_router.get("/details", response_model=list[TicketResponse])
async def report_details(
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    location_id: int | None = Query(None),
    assignee_id: int | None = Query(None),
    status: str | None = Query(None),
    offset: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=200),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    check_access(user)
    tickets = await ticket_query(db, date_from, date_to)
    if location_id is not None:
        tickets = [t for t in tickets if t.location_id == location_id]
    if assignee_id is not None:
        tickets = [t for t in tickets if t.assignee_id == assignee_id]
    if status:
        tickets = [t for t in tickets if t.status.value == status]
    tickets.sort(key=lambda t: t.created_at, reverse=True)

    result = []
    for ticket in tickets[offset:offset + limit]:
        item = TicketResponse.model_validate(ticket)
        item.customer_name = ticket.customer.name if ticket.customer else None
        item.location_name = ticket.location.name if ticket.location else None
        item.location_address = ticket.location.address if ticket.location else None
        item.assignee_name = ticket.assignee.name if ticket.assignee else None
        item.is_archived = ticket.archived_at is not None
        result.append(item)
    return result


@reports_router.get("/objects")
async def report_objects(
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    check_access(user)
    tickets = await ticket_query(db, date_from, date_to)
    locations_result = await db.execute(select(AssetLocation))
    locations = locations_result.scalars().all()

    customers_result = await db.execute(select(Customer))
    customers = {c.id: c.name for c in customers_result.scalars().all()}

    by_location: dict[int, dict] = {}
    for loc in locations:
        cust_name = customers.get(loc.customer_id, "")
        by_location[loc.id] = {
            "location_id": loc.id,
            "location_name": loc.name or "",
            "customer_name": cust_name,
            "location_address": loc.address or "",
            "customer_id": loc.customer_id,
            "total": 0, "open": 0, "closed": 0, "overdue": 0,
            "total_time": timedelta(), "resolved_count": 0,
            "types": {},
        }

    for t in tickets:
        if t.location_id not in by_location:
            continue
        d = by_location[t.location_id]
        d["total"] += 1
        tt = t.type.value if t.type else "не указан"
        d["types"][tt] = d["types"].get(tt, 0) + 1
        if t.status == TicketStatus.COMPLETED:
            d["closed"] += 1
            if t.completed_at and t.created_at:
                d["total_time"] += t.completed_at - t.created_at
                d["resolved_count"] += 1
        else:
            d["open"] += 1
        if t.response_deadline and t.status != TicketStatus.COMPLETED and t.response_deadline < datetime.utcnow():
            d["overdue"] += 1

    out = []
    for d in by_location.values():
        avg_h = (d["total_time"].total_seconds() / 3600 / d["resolved_count"]) if d["resolved_count"] else 0
        out.append({
            "location_id": d["location_id"],
            "location_name": d["location_name"],
            "customer_name": d["customer_name"],
            "location_address": d["location_address"],
            "total": d["total"],
            "open": d["open"],
            "closed": d["closed"],
            "overdue": d["overdue"],
            "avg_resolution_hours": round(avg_h, 1),
            "types": d["types"],
        })
    return sorted(out, key=lambda x: x["total"], reverse=True)


@reports_router.get("/tickets")
async def report_tickets(
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    check_access(user)
    tickets = await ticket_query(db, date_from, date_to)

    total = len(tickets)
    if total == 0:
        return {"total": 0, "by_status": [], "by_priority": [], "by_type": [], "avg_resolution_hours": 0, "sla_percent": 0}

    by_status: dict[str, int] = {}
    by_priority: dict[str, int] = {}
    by_type: dict[str, int] = {}
    total_time = timedelta()
    resolved = 0
    on_time = 0

    for t in tickets:
        st = t.status.value
        by_status[st] = by_status.get(st, 0) + 1
        by_priority[t.priority.value] = by_priority.get(t.priority.value, 0) + 1
        tt = t.type.value if t.type else "не указан"
        by_type[tt] = by_type.get(tt, 0) + 1

        if t.status == TicketStatus.COMPLETED and t.completed_at and t.created_at:
            total_time += t.completed_at - t.created_at
            resolved += 1
            if t.resolution_deadline and t.completed_at <= t.resolution_deadline:
                on_time += 1

    return {
        "total": total,
        "by_status": [{"label": k, "count": v} for k, v in by_status.items()],
        "by_priority": [{"label": k, "count": v} for k, v in by_priority.items()],
        "by_type": [{"label": k, "count": v} for k, v in by_type.items()],
        "avg_resolution_hours": round(total_time.total_seconds() / 3600 / resolved, 1) if resolved else 0,
        "sla_percent": round(on_time / resolved * 100, 1) if resolved else 0,
    }


@reports_router.get("/engineers")
async def report_engineers(
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    status: str | None = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    check_access(user)
    tickets = await ticket_query(db, date_from, date_to)
    if status:
        tickets = [t for t in tickets if t.status.value == status]
    engineers_result = await db.execute(
        select(User).where(User.role.in_([UserRole.engineer]))
    )
    engineers = engineers_result.scalars().all()

    by_eng: dict[int, dict] = {}
    for e in engineers:
        by_eng[e.id] = {
            "engineer_id": e.id, "engineer_name": e.name,
            "total": 0, "completed": 0, "in_progress": 0, "overdue": 0,
            "total_time": timedelta(), "resolved_count": 0,
        }

    for t in tickets:
        if not t.assignee_id or t.assignee_id not in by_eng:
            continue
        d = by_eng[t.assignee_id]
        d["total"] += 1
        if t.status == TicketStatus.COMPLETED:
            d["completed"] += 1
            if t.completed_at and t.created_at:
                d["total_time"] += t.completed_at - t.created_at
                d["resolved_count"] += 1
        else:
            d["in_progress"] += 1
        if t.response_deadline and t.status != TicketStatus.COMPLETED and t.response_deadline < datetime.utcnow():
            d["overdue"] += 1

    out = []
    for d in by_eng.values():
        if d["total"] == 0:
            continue
        avg_h = (d["total_time"].total_seconds() / 3600 / d["resolved_count"]) if d["resolved_count"] else 0
        out.append({
            "engineer_id": d["engineer_id"],
            "engineer_name": d["engineer_name"],
            "total": d["total"],
            "completed": d["completed"],
            "in_progress": d["in_progress"],
            "overdue": d["overdue"],
            "avg_resolution_hours": round(avg_h, 1),
        })
    return sorted(out, key=lambda x: x["total"], reverse=True)
