from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_, and_, case, cast, Float, Integer
from datetime import datetime, timedelta, timezone
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
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def _date_filter(dt_from, dt_to):
    """Build OR condition for created_at/completed_at date range."""
    cond_created = []
    cond_completed = []
    if dt_from:
        cond_created.append(Ticket.created_at >= dt_from)
        cond_completed.append(Ticket.completed_at >= dt_from)
    if dt_to:
        cond_created.append(Ticket.created_at <= dt_to)
        cond_completed.append(Ticket.completed_at <= dt_to)
    if not cond_created and not cond_completed:
        return None
    parts = []
    if cond_created:
        parts.append(and_(*cond_created))
    if cond_completed:
        parts.append(and_(Ticket.status == TicketStatus.COMPLETED, *cond_completed))
    return or_(*parts)


async def ticket_query(db: AsyncSession, date_from: str | None, date_to: str | None):
    from sqlalchemy.orm import selectinload
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
    date_cond = _date_filter(dt_from, dt_to)
    if date_cond is not None:
        stmt = stmt.where(date_cond)
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
    dt_from = _parse_date(date_from) if date_from else None
    dt_to = _parse_date(date_to) if date_to else None
    date_cond = _date_filter(dt_from, dt_to)

    # SQL aggregation by location
    stmt = select(
        Ticket.location_id,
        func.count(Ticket.id).label("total"),
        func.sum(case((Ticket.status != TicketStatus.COMPLETED, 1), else_=0)).label("open"),
        func.sum(case((Ticket.status == TicketStatus.COMPLETED, 1), else_=0)).label("closed"),
        func.sum(case((
            and_(Ticket.status != TicketStatus.COMPLETED, Ticket.response_deadline < func.now()),
            1
        ), else_=0)).label("overdue"),
        func.sum(case((
            Ticket.status == TicketStatus.COMPLETED,
            func.extract('epoch', Ticket.completed_at - Ticket.created_at) / 3600
        ), else_=0)).label("total_hours"),
        func.sum(case((Ticket.status == TicketStatus.COMPLETED, 1), else_=0)).label("resolved_count"),
    )
    if date_cond is not None:
        stmt = stmt.where(date_cond)
    stmt = stmt.group_by(Ticket.location_id)
    result = await db.execute(stmt)
    agg_rows = {row.location_id: row for row in result.all()}

    # Load locations and customers
    locs = (await db.execute(select(AssetLocation))).scalars().all()
    custs_q = await db.execute(select(Customer))
    custs = {c.id: c.name for c in custs_q.scalars().all()}

    # Type breakdown per location
    type_stmt = select(
        Ticket.location_id,
        func.count(Ticket.id).label("cnt"),
    ).group_by(Ticket.location_id)
    if date_cond is not None:
        type_stmt = type_stmt.where(date_cond)

    out = []
    for loc in locs:
        agg = agg_rows.get(loc.id)
        total = int(agg.total) if agg else 0
        if total == 0:
            continue
        open_c = int(agg.open) if agg else 0
        closed = int(agg.closed) if agg else 0
        overdue = int(agg.overdue) if agg else 0
        resolved = int(agg.resolved_count) if agg else 0
        total_h = float(agg.total_hours) if agg else 0
        avg_h = round(total_h / resolved, 1) if resolved else 0

        # Get types for this location
        type_filter = [Ticket.location_id == loc.id]
        if date_cond is not None:
            type_filter.append(date_cond)
        type_q = select(
            func.coalesce(Ticket.type, 'не указан').label("t"),
            func.count(Ticket.id).label("cnt"),
        ).where(and_(*type_filter)).group_by(func.coalesce(Ticket.type, 'не указан'))
        type_res = await db.execute(type_q)
        types = {row.t: row.cnt for row in type_res.all()}

        out.append({
            "location_id": loc.id,
            "location_name": loc.name or "",
            "customer_name": custs.get(loc.customer_id, ""),
            "location_address": loc.address or "",
            "total": total,
            "open": open_c,
            "closed": closed,
            "overdue": overdue,
            "avg_resolution_hours": avg_h,
            "types": types,
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
    dt_from = _parse_date(date_from) if date_from else None
    dt_to = _parse_date(date_to) if date_to else None
    date_cond = _date_filter(dt_from, dt_to)

    # Total count + avg resolution + SLA
    base = [date_cond] if date_cond is not None else []
    total_q = select(func.count(Ticket.id)).select_from(Ticket)
    if base:
        total_q = total_q.where(*base)
    total = (await db.execute(total_q)).scalar() or 0
    if total == 0:
        return {"total": 0, "by_status": [], "by_priority": [], "by_type": [], "avg_resolution_hours": 0, "sla_percent": 0}

    # By status
    status_q = select(
        Ticket.status, func.count(Ticket.id).label("cnt")
    ).group_by(Ticket.status)
    if base:
        status_q = status_q.where(*base)
    by_status = [{"label": r.status.value, "count": r.cnt} for r in (await db.execute(status_q)).all()]

    # By priority
    prio_q = select(
        Ticket.priority, func.count(Ticket.id).label("cnt")
    ).group_by(Ticket.priority)
    if base:
        prio_q = prio_q.where(*base)
    by_priority = [{"label": r.priority.value, "count": r.cnt} for r in (await db.execute(prio_q)).all()]

    # By type
    type_q = select(
        func.coalesce(Ticket.type, 'не указан').label("t"), func.count(Ticket.id).label("cnt")
    ).group_by(func.coalesce(Ticket.type, 'не указан'))
    if base:
        type_q = type_q.where(*base)
    by_type = [{"label": r.t, "count": r.cnt} for r in (await db.execute(type_q)).all()]

    # Avg resolution hours
    avg_q = select(
        func.avg(func.extract('epoch', Ticket.completed_at - Ticket.created_at) / 3600)
    ).where(Ticket.status == TicketStatus.COMPLETED, Ticket.completed_at.isnot(None), Ticket.created_at.isnot(None))
    if base:
        avg_q = avg_q.where(*base)
    avg_h = (await db.execute(avg_q)).scalar()
    avg_hours = round(float(avg_h), 1) if avg_h else 0

    # SLA %
    sla_q = select(func.count(Ticket.id)).where(
        Ticket.status == TicketStatus.COMPLETED,
        Ticket.completed_at.isnot(None),
        Ticket.resolution_deadline.isnot(None),
        Ticket.completed_at <= Ticket.resolution_deadline,
    )
    if base:
        sla_q = sla_q.where(*base)
    on_time = (await db.execute(sla_q)).scalar() or 0
    sla_pct = round(on_time / total * 100, 1) if total else 0

    return {
        "total": total,
        "by_status": by_status,
        "by_priority": by_priority,
        "by_type": by_type,
        "avg_resolution_hours": avg_hours,
        "sla_percent": sla_pct,
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
    dt_from = _parse_date(date_from) if date_from else None
    dt_to = _parse_date(date_to) if date_to else None
    date_cond = _date_filter(dt_from, dt_to)

    base = [Ticket.assignee_id.isnot(None)]
    if date_cond is not None:
        base.append(date_cond)
    if status:
        base.append(Ticket.status == status)

    stmt = select(
        Ticket.assignee_id,
        func.count(Ticket.id).label("total"),
        func.sum(case((Ticket.status == TicketStatus.COMPLETED, 1), else_=0)).label("completed"),
        func.sum(case((Ticket.status != TicketStatus.COMPLETED, 1), else_=0)).label("in_progress"),
        func.sum(case((
            and_(Ticket.status != TicketStatus.COMPLETED, Ticket.response_deadline < func.now()),
            1
        ), else_=0)).label("overdue"),
        func.avg(case((
            Ticket.status == TicketStatus.COMPLETED,
            func.extract('epoch', Ticket.completed_at - Ticket.created_at) / 3600
        ))).label("avg_hours"),
    ).where(*base).group_by(Ticket.assignee_id)

    result = await db.execute(stmt)
    rows = result.all()

    # Load engineer names
    eng_ids = [r.assignee_id for r in rows]
    engs = {}
    if eng_ids:
        eng_q = await db.execute(select(User).where(User.id.in_(eng_ids)))
        engs = {e.id: e.name for e in eng_q.scalars().all()}

    out = []
    for r in rows:
        avg_h = round(float(r.avg_hours), 1) if r.avg_hours else 0
        out.append({
            "engineer_id": r.assignee_id,
            "engineer_name": engs.get(r.assignee_id, ""),
            "total": int(r.total),
            "completed": int(r.completed),
            "in_progress": int(r.in_progress),
            "overdue": int(r.overdue),
            "avg_resolution_hours": avg_h,
        })
    return sorted(out, key=lambda x: x["total"], reverse=True)
