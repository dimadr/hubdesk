from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from datetime import datetime
from pydantic import BaseModel
from src.database import get_db
from src.models.ticket import Ticket
from src.models.customer import Customer
from src.services.ticket_service import TicketService
from src.services.acl_service import RoleChecker
from src.services.sla_service import SLAService
from src.services.comment_service import CommentService
from src.api.schemas import (
    TicketCreate, TicketUpdate, TicketResponse, StatusChange, TicketFilter,
    CommentCreate, CommentResponse,
)
from src.core.deps import get_current_user
from src.models.user import User, UserRole
from src.models.checklist import Checklist, ChecklistField, FieldType


def log_history(action: str, details: str, user: str):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with open("history.log", "a", encoding="utf-8") as f:
        f.write(f"[{ts}] {user} — {action}: {details}\n")


def create_ticket_router() -> APIRouter:
    router = APIRouter(prefix="/tickets", tags=["Tickets"])

    @router.get("", response_model=list[TicketResponse])
    async def list_tickets(
        filters: TicketFilter = Depends(),
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ):
        stmt = select(Ticket).options(selectinload(Ticket.customer))
        if filters.status:
            stmt = stmt.where(Ticket.status == filters.status)
        if filters.priority:
            stmt = stmt.where(Ticket.priority == filters.priority)
        if filters.type:
            stmt = stmt.where(Ticket.type == filters.type)
        if filters.assignee_id:
            stmt = stmt.where(Ticket.assignee_id == filters.assignee_id)
        if filters.customer_id:
            stmt = stmt.where(Ticket.customer_id == filters.customer_id)
        if filters.location_id:
            stmt = stmt.where(Ticket.location_id == filters.location_id)
        if filters.q:
            stmt = stmt.where(Ticket.subject.ilike(f"%{filters.q}%"))
        if user.role.value == "customer":
            customer_subq = select(Customer.id).where(Customer.name == user.name).correlate(Ticket).scalar_subquery()
            stmt = stmt.where(Ticket.customer_id == customer_subq)
        elif user.role.value == "engineer":
            stmt = stmt.where(Ticket.assignee_id == user.id)
        if filters.archived is True:
            stmt = stmt.where(Ticket.archived_at != None)
        elif filters.archived is False:
            stmt = stmt.where(Ticket.archived_at == None)
        stmt = stmt.offset(filters.offset).limit(filters.limit)
        result = await db.execute(stmt)
        tickets = result.scalars().all()
        output = []
        for t in tickets:
            d = TicketResponse.model_validate(t)
            d.customer_name = t.customer.name if t.customer else None
            d.response_overdue = SLAService.is_response_overdue(t)
            d.resolution_overdue = SLAService.is_resolution_overdue(t)
            d.is_archived = t.archived_at is not None
            output.append(d)
        return output

    @router.get("/{ticket_id}", response_model=TicketResponse)
    async def get_ticket(
        ticket_id: int,
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ):
        ticket = await db.get(Ticket, ticket_id)
        if not ticket or not await RoleChecker.can_view_ticket_async(user, ticket, db):
            raise HTTPException(404)
        d = TicketResponse.model_validate(ticket)
        d.customer_name = ticket.customer.name if ticket.customer else None
        d.response_overdue = SLAService.is_response_overdue(ticket)
        d.resolution_overdue = SLAService.is_resolution_overdue(ticket)
        d.is_archived = ticket.archived_at is not None
        return d

    @router.post("", status_code=201, response_model=TicketResponse)
    async def create_ticket(
        data: TicketCreate,
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ):
        if user.role not in (UserRole.admin, UserRole.dispatcher):
            raise HTTPException(403, "Только диспетчер или администратор может создавать заявки")
        svc = TicketService(db)
        ticket = await svc.create(data.model_dump(), user)
        await db.commit()
        log_history("Создана заявка", f"#{ticket.number} {ticket.subject}", user.name)
        return TicketResponse.model_validate(ticket)

    @router.patch("/{ticket_id}", response_model=TicketResponse)
    async def update_ticket(
        ticket_id: int,
        data: TicketUpdate,
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ):
        if user.role not in (UserRole.admin, UserRole.dispatcher, UserRole.engineer):
            raise HTTPException(403, "Недостаточно прав для редактирования заявки")
        ticket = await db.get(Ticket, ticket_id)
        if not ticket:
            raise HTTPException(404)
        if not await RoleChecker.can_view_ticket_async(user, ticket, db):
            raise HTTPException(404)
        for field, value in data.model_dump(exclude_unset=True).items():
            if field in ('status', 'assigned_at', 'completed_at'):
                continue
            if field == 'assignee_id' and value is not None:
                if user.role not in (UserRole.admin, UserRole.dispatcher):
                    raise HTTPException(403, "Только диспетчер или администратор может назначать исполнителя")
                eng = await db.get(User, value)
                if not eng or eng.role != UserRole.engineer:
                    raise HTTPException(400, "Исполнитель должен иметь роль engineer")
            if isinstance(value, datetime):
                value = value.replace(tzinfo=None)
            setattr(ticket, field, value)
        await db.commit()
        log_history("Обновлена заявка", f"#{ticket.number} {ticket.subject}", user.name)
        return TicketResponse.model_validate(ticket)

    @router.patch("/{ticket_id}/status", response_model=TicketResponse)
    async def change_status(
        ticket_id: int,
        data: StatusChange,
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ):
        svc = TicketService(db)
        try:
            ticket = await svc.change_status(ticket_id, data.status, user)
        except Exception as e:
            raise HTTPException(400, str(e))
        await db.commit()
        log_history("Изменён статус", f"#{ticket.number} → {data.status}", user.name)
        return TicketResponse.model_validate(ticket)

    @router.post("/{ticket_id}/comments", status_code=201, response_model=CommentResponse)
    async def add_comment(
        ticket_id: int,
        data: CommentCreate,
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ):
        if user.role not in (UserRole.admin, UserRole.dispatcher, UserRole.engineer, UserRole.customer):
            raise HTTPException(403, "Недостаточно прав для добавления комментариев")
        svc = CommentService(db)
        try:
            comment = await svc.add(ticket_id, data.body, data.is_internal, user)
        except PermissionError as e:
            raise HTTPException(403, str(e))
        await db.commit()
        log_history("Добавлен комментарий", f"к заявке #{ticket_id}", user.name)
        return CommentResponse.model_validate(comment)

    @router.get("/{ticket_id}/comments", response_model=list[CommentResponse])
    async def get_comments(
        ticket_id: int,
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ):
        svc = CommentService(db)
        comments = await svc.get_for_ticket(ticket_id, user)
        return [CommentResponse.model_validate(c) for c in comments]

    @router.post("/{ticket_id}/checklist", status_code=201)
    async def add_checklist(
        ticket_id: int,
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ):
        if user.role in (UserRole.viewer, UserRole.customer, UserRole.storekeeper):
            raise HTTPException(403, "Недостаточно прав")
        ticket = await db.get(Ticket, ticket_id)
        if not ticket:
            raise HTTPException(404)
        if not await RoleChecker.can_view_ticket_async(user, ticket, db):
            raise HTTPException(403, "Нет доступа к заявке")
        cl = Checklist(ticket_id=ticket_id, name="Чек-лист")
        db.add(cl)
        await db.flush()
        await db.commit()
        return {"id": cl.id, "name": cl.name}

    @router.get("/{ticket_id}/checklists")
    async def get_checklists(
        ticket_id: int,
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ):
        result = await db.execute(select(Checklist).where(Checklist.ticket_id == ticket_id))
        checklists = result.scalars().all()
        out = []
        for cl in checklists:
            fields_result = await db.execute(select(ChecklistField).where(ChecklistField.checklist_id == cl.id))
            fields = [{"id": f.id, "label": f.label, "field_type": f.field_type.value, "is_mandatory": f.is_mandatory, "value": f.value} for f in fields_result.scalars().all()]
            out.append({"id": cl.id, "name": cl.name, "fields": fields})
        return out

    class AddFieldRequest(BaseModel):
        label: str
        field_type: str = "checkbox"
        is_mandatory: bool = False

    @router.post("/{ticket_id}/checklist/{checklist_id}/fields")
    async def add_field(
        ticket_id: int, checklist_id: int,
        data: AddFieldRequest,
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ):
        if user.role in (UserRole.viewer, UserRole.customer, UserRole.storekeeper):
            raise HTTPException(403, "Недостаточно прав")
        ticket = await db.get(Ticket, ticket_id)
        if not ticket:
            raise HTTPException(404)
        if not await RoleChecker.can_view_ticket_async(user, ticket, db):
            raise HTTPException(403, "Нет доступа к заявке")
        ftype = FieldType[data.field_type] if data.field_type in FieldType._member_names_ else FieldType.checkbox
        field = ChecklistField(checklist_id=checklist_id, label=data.label, field_type=ftype, is_mandatory=data.is_mandatory)
        db.add(field)
        await db.flush()
        await db.commit()
        return {"id": field.id, "label": field.label, "field_type": field.field_type.value, "is_mandatory": field.is_mandatory, "value": field.value or ""}

    class FillFieldRequest(BaseModel):
        value: str

    @router.patch("/{ticket_id}/checklist/{checklist_id}/field/{field_id}")
    async def fill_field(
        ticket_id: int, checklist_id: int, field_id: int,
        data: FillFieldRequest,
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ):
        if user.role in (UserRole.viewer, UserRole.customer, UserRole.storekeeper):
            raise HTTPException(403, "Недостаточно прав")
        ticket = await db.get(Ticket, ticket_id)
        if not ticket:
            raise HTTPException(404)
        if not await RoleChecker.can_view_ticket_async(user, ticket, db):
            raise HTTPException(403, "Нет доступа к заявке")
        field = await db.get(ChecklistField, field_id)
        if not field:
            raise HTTPException(404)
        field.value = data.value
        await db.commit()
        return {"id": field.id, "value": field.value}

    class AssignRequest(BaseModel):
        assignee_id: int | None = None

    @router.patch("/{ticket_id}/assign", response_model=TicketResponse)
    async def assign_ticket(
        ticket_id: int,
        data: AssignRequest,
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ):
        if not RoleChecker.can_assign(user):
            raise HTTPException(403, "Only dispatcher or admin can assign")
        ticket = await db.get(Ticket, ticket_id)
        if not ticket:
            raise HTTPException(404)
        old_assignee = ticket.assignee_id
        if data.assignee_id:
            eng = await db.get(User, data.assignee_id)
            if not eng:
                raise HTTPException(404, "Исполнитель не найден")
            if eng.role != UserRole.engineer:
                raise HTTPException(400, "Назначать можно только пользователя с ролью engineer")
            eng_name = eng.name if eng else str(data.assignee_id)
            log_history("Назначен инженер", f"#{ticket.number} → {eng_name}", user.name)
        else:
            log_history("Снят исполнитель", f"#{ticket.number}", user.name)
        ticket.assignee_id = data.assignee_id
        await db.commit()
        return TicketResponse.model_validate(ticket)

    return router
