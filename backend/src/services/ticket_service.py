import logging
from datetime import datetime, timedelta, timezone
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from src.models.ticket import Ticket, TicketStatus
from src.models.user import User, UserRole
from src.models.customer import Contract
from src.models.checklist import Checklist
from src.services.ticket_fsm import TicketFSM
from src.services.acl_service import RoleChecker
from src.services.audit_service import log_audit

logger = logging.getLogger(__name__)


class TicketService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.fsm = TicketFSM(session)

    async def create(self, data: dict, user: User | None = None) -> Ticket:
        now_utc = datetime.now(timezone.utc).replace(tzinfo=None)

        ticket = Ticket(
            number=await self._secure_next_number(),
            subject=data["subject"],
            body=data.get("body", ""),
            customer_id=data["customer_id"],
            location_id=data["location_id"],
            equipment_id=data.get("equipment_id"),
            type=data.get("type"),
            priority=data.get("priority", "medium"),
            is_internal=data.get("is_internal", False),
            assignee_id=data.get("assignee_id") if data.get("assignee_id") and await self._is_engineer(data["assignee_id"]) else None,
            group_id=data.get("group_id"),
            site_contact_name=data.get("site_contact_name"),
            site_contact_phone=data.get("site_contact_phone"),
            scheduled_start=self._naive_datetime(data.get("scheduled_start")),
            scheduled_end=self._naive_datetime(data.get("scheduled_end")),
            source_description=data.get("source_description"),
            created_at=now_utc,
        )

        contract = await self._get_active_contract(ticket.customer_id, now_utc.date())
        if contract:
            ticket.response_deadline = now_utc + timedelta(hours=contract.sla_hours)
            ticket.resolution_deadline = now_utc + timedelta(hours=contract.resolution_sla_hours)
        elif data.get("resolution_deadline"):
            ticket.resolution_deadline = self._naive_datetime(data.get("resolution_deadline"))

        self.session.add(ticket)
        await self.session.flush()

        if user:
            await log_audit(
                self.session, user, "ticket_created", "ticket",
                ticket.id, f"Создана заявка №{ticket.number} «{ticket.subject}»"
            )
        return ticket

    async def assign(self, ticket_id: int, engineer_id: int, dispatcher: User) -> Ticket:
        if not RoleChecker.can_assign(dispatcher):
            raise HTTPException(403, "Назначать инженера может только диспетчер или администратор")

        ticket = await self._get(ticket_id)
        ticket.assignee_id = engineer_id

        await self.session.flush()
        await log_audit(
            self.session, dispatcher, "ticket_assigned", "ticket",
            ticket_id, f"Назначен инженер на заявку №{ticket.number}"
        )
        return ticket

    async def change_status(self, ticket_id: int, target: str, user: User) -> Ticket:
        ticket = await self._get(ticket_id)
        from_status = ticket.status.value

        if not await RoleChecker.can_view_ticket_async(user, ticket, self.session):
            raise HTTPException(403, "Доступ к данной заявке запрещен")

        if not RoleChecker.can_change_status(user, ticket, target):
            raise HTTPException(
                400, f"У вашей роли нет прав для перевода заявки в статус {target}"
            )

        bypass = (user.role == UserRole.admin)
        await self.fsm.transition(ticket, target, user.id, bypass_guards=bypass)

        now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
        if target == "ACCEPTED" and ticket.accepted_at is None:
            ticket.accepted_at = now_utc
        elif target == "COMPLETED":
            ticket.completed_at = now_utc
            ticket.archived_at = now_utc

        await self.session.flush()
        await log_audit(
            self.session, user, "ticket_status_changed", "ticket",
            ticket_id, f"Статус заявки №{ticket.number}: {from_status} → {target}"
        )
        return ticket

    @staticmethod
    def _naive_datetime(value):
        if isinstance(value, datetime) and value.tzinfo is not None:
            return value.astimezone(timezone.utc).replace(tzinfo=None)
        return value

    async def _get(self, ticket_id: int) -> Ticket:
        stmt = (
            select(Ticket)
            .where(Ticket.id == ticket_id)
            .options(selectinload(Ticket.checklists).selectinload(Checklist.fields))
        )
        result = await self.session.execute(stmt)
        ticket = result.scalar_one_or_none()
        if not ticket:
            raise HTTPException(404, f"Заявка с ID {ticket_id} не найдена")
        return ticket

    async def _secure_next_number(self) -> int:
        stmt = (
            select(Ticket.number)
            .order_by(Ticket.number.desc())
            .limit(1)
            .with_for_update()
        )
        result = await self.session.execute(stmt)
        last = result.scalar()
        return (last + 1) if last else 1000

    async def _get_active_contract(self, customer_id: int, current_date: datetime.date) -> Contract | None:
        stmt = select(Contract).where(
            Contract.customer_id == customer_id,
            Contract.valid_from <= current_date,
            Contract.valid_to >= current_date,
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def _is_engineer(self, user_id: int) -> bool:
        u = await self.session.get(User, user_id)
        return u is not None and u.role == UserRole.engineer
