from datetime import datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from src.models.ticket import Ticket, TicketStatus
from src.models.user import User, UserRole
from src.models.customer import Contract
from src.models.checklist import Checklist, ChecklistField
from src.services.ticket_fsm import TicketFSM
from src.services.acl_service import RoleChecker


class TicketService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.fsm = TicketFSM(session)

    async def create(self, data: dict, user: User | None = None) -> Ticket:
        ticket = Ticket(
            number=await self._next_number(),
            subject=data["subject"],
            body=data.get("body", ""),
            customer_id=data["customer_id"],
            location_id=data["location_id"],
            equipment_id=data.get("equipment_id"),
            type=data.get("type"),
            priority=data.get("priority", "medium"),
            is_internal=data.get("is_internal", False),
            assignee_id=data.get("assignee_id"),
            group_id=data.get("group_id"),
            site_contact_name=data.get("site_contact_name"),
            site_contact_phone=data.get("site_contact_phone"),
            scheduled_start=data.get("scheduled_start"),
            scheduled_end=data.get("scheduled_end"),
            source_description=data.get("source_description"),
            resolution_deadline=data.get("resolution_deadline"),
        )
        contract = await self._get_active_contract(ticket.customer_id)
        if contract:
            ticket.response_deadline = ticket.created_at + timedelta(hours=contract.sla_hours)
            ticket.resolution_deadline = ticket.created_at + timedelta(hours=contract.resolution_sla_hours)
        self.session.add(ticket)
        await self.session.flush()
        return ticket

    async def assign(self, ticket_id: int, engineer_id: int, dispatcher: User) -> Ticket:
        if not RoleChecker.can_assign(dispatcher):
            raise PermissionError("Only dispatcher or admin can assign")
        ticket = await self._get(ticket_id)
        ticket.assignee_id = engineer_id
        await self.session.flush()
        return ticket

    async def change_status(self, ticket_id: int, target: str, user: User) -> Ticket:
        ticket = await self._get(ticket_id)
        if not RoleChecker.can_change_status(user, ticket, target):
            raise PermissionError(f"User {user.id} cannot transition ticket {ticket_id} to {target}")
        if not RoleChecker.can_view_ticket(user, ticket):
            raise PermissionError("Access denied")
        bypass = user.role == UserRole.admin
        await self.fsm.transition(ticket, target, user.id, bypass_guards=bypass)
        now = datetime.utcnow()
        if target == "ACCEPTED" and ticket.accepted_at is None:
            ticket.accepted_at = now
        elif target == "COMPLETED":
            ticket.completed_at = now
            ticket.archived_at = now
        await self.session.flush()
        return ticket

    async def _get(self, ticket_id: int) -> Ticket:
        from sqlalchemy.orm import selectinload
        stmt = select(Ticket).where(Ticket.id == ticket_id).options(
            selectinload(Ticket.checklists).selectinload(Checklist.fields)
        )
        result = await self.session.execute(stmt)
        return result.scalar_one()

    async def _next_number(self) -> int:
        stmt = select(Ticket.number).order_by(Ticket.number.desc()).limit(1)
        result = await self.session.execute(stmt)
        last = result.scalar()
        return (last + 1) if last else 1000

    async def _get_active_contract(self, customer_id: int) -> Contract | None:
        stmt = select(Contract).where(
            Contract.customer_id == customer_id,
            Contract.valid_from <= datetime.utcnow().date(),
            Contract.valid_to >= datetime.utcnow().date(),
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()
