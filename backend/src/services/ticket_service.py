import logging
from datetime import datetime, timedelta, timezone
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text
from sqlalchemy.orm import selectinload

from src.models.ticket import Ticket, TicketStatus
from src.models.user import User, UserRole, UserStatus
from src.models.attachment import Attachment
from src.models.customer import Contract
from src.models.equipment import AssetLocation, Equipment
from src.models.checklist import Checklist
from src.services.ticket_fsm import TicketFSM
from src.services.acl_service import RoleChecker
from src.services.audit_service import log_audit
from src.services.mail_service import MailService
from src.services.comment_service import CommentService
from src.core.fsm.exceptions import GuardFailedError, InvalidTransitionError

logger = logging.getLogger(__name__)


class TicketService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.fsm = TicketFSM(session)

    @staticmethod
    def _normalize_create_data(data: dict, user: User | None) -> dict:
        normalized = dict(data)
        if user and user.role == UserRole.engineer:
            normalized["assignee_id"] = user.id
        if normalized.get("is_internal"):
            body = str(normalized.get("body") or "").strip()
            if not body:
                raise HTTPException(422, "Описание внутренней заявки обязательно")
            if not normalized.get("resolution_deadline"):
                raise HTTPException(422, "Дедлайн внутренней заявки обязателен")
            if not normalized.get("assignee_id"):
                raise HTTPException(422, "Исполнитель внутренней заявки обязателен")
            normalized.update({
                "subject": TicketService.internal_subject(body),
                "body": body,
                "source_description": None,
                "customer_id": None,
                "location_id": None,
                "equipment_id": None,
                "type": None,
                "priority": "medium",
                "group_id": None,
                "site_contact_name": None,
                "site_contact_phone": None,
                "scheduled_start": None,
                "scheduled_end": None,
            })
        return normalized

    @staticmethod
    def internal_subject(body: str) -> str:
        return next(line.strip() for line in body.splitlines() if line.strip())[:500]

    @staticmethod
    def validate_internal_fields(
        body: str | None,
        resolution_deadline,
        assignee_id: int | None,
    ) -> None:
        if not body or not body.strip():
            raise HTTPException(422, "Описание внутренней заявки обязательно")
        if not resolution_deadline:
            raise HTTPException(422, "Дедлайн внутренней заявки обязателен")
        if not assignee_id:
            raise HTTPException(422, "Исполнитель внутренней заявки обязателен")

    async def create(self, data: dict, user: User | None = None) -> Ticket:
        data = self._normalize_create_data(data, user)
        now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
        is_internal = bool(data.get("is_internal"))

        if data.get("assignee_id") and not await self._is_engineer(data["assignee_id"]):
            raise HTTPException(400, "Исполнитель должен быть активным пользователем с ролью engineer")

        if is_internal:
            if user and user.role == UserRole.customer:
                raise HTTPException(403, "Заказчик не может создавать внутренние заявки")
        else:
            subject = str(data.get("subject") or "").strip()
            if not subject:
                raise HTTPException(422, "Тема заявки обязательна")
            if not data.get("customer_id") or not data.get("location_id"):
                raise HTTPException(422, "Выберите клиента и объект")
            data["subject"] = subject
            location = await self.session.get(AssetLocation, data["location_id"])
            if not location:
                raise HTTPException(400, "Объект не найден")
            if location.customer_id != data["customer_id"]:
                raise HTTPException(400, "Объект не принадлежит указанному заказчику")
            if user and user.role == UserRole.engineer and location.assigned_engineer_id != user.id:
                raise HTTPException(403, "Вы можете создавать заявки только на своих объектах")

            if data.get("equipment_id"):
                equip = await self.session.get(Equipment, data["equipment_id"])
                if not equip:
                    raise HTTPException(400, "Оборудование не найдено")
                if equip.location_id != data["location_id"]:
                    raise HTTPException(400, "Оборудование не принадлежит указанному объекту")

        ticket = Ticket(
            number=await self._secure_next_number(),
            subject=data["subject"],
            body=data.get("body", ""),
            customer_id=data.get("customer_id"),
            location_id=data.get("location_id"),
            equipment_id=data.get("equipment_id"),
            type=data.get("type"),
            priority=data.get("priority", "medium"),
            is_internal=data.get("is_internal", False),
            assignee_id=data.get("assignee_id"),
            group_id=data.get("group_id"),
            site_contact_name=data.get("site_contact_name"),
            site_contact_phone=data.get("site_contact_phone"),
            scheduled_start=self._naive_datetime(data.get("scheduled_start")),
            scheduled_end=self._naive_datetime(data.get("scheduled_end")),
            source_description=data.get("source_description"),
            created_at=now_utc,
            created_by=user.id if user else None,
        )

        contract = None
        if not is_internal:
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
        if user and user.role == UserRole.engineer and ticket.assignee_id == user.id:
            await self.fsm.transition(
                ticket,
                "ACCEPTED",
                user.id,
                {"reason": "self_created"},
            )
            ticket.accepted_at = now_utc
            await log_audit(
                self.session, user, "ticket_status_changed", "ticket",
                ticket.id,
                f"Заявка №{ticket.number} автоматически принята создавшим её инженером",
            )
            await self.session.flush()
        return ticket

    async def assign(self, ticket_id: int, engineer_id: int, dispatcher: User) -> Ticket:
        if not RoleChecker.can_assign(dispatcher):
            raise HTTPException(403, "Назначать инженера может только диспетчер или администратор")

        eng = await self.session.get(User, engineer_id)
        if not eng:
            raise HTTPException(404, "Пользователь не найден")
        if eng.role != UserRole.engineer or eng.status != UserStatus.active:
            raise HTTPException(400, "Назначать можно только активного пользователя с ролью engineer")

        ticket = await self._get(ticket_id)
        ticket.assignee_id = engineer_id

        await self.session.flush()
        await log_audit(
            self.session, dispatcher, "ticket_assigned", "ticket",
            ticket_id, f"Назначен инженер на заявку №{ticket.number}"
        )
        return ticket

    async def complete(
        self,
        ticket_id: int,
        comment: str,
        user: User,
        attachment_ids: list[int] | None = None,
    ) -> Ticket:
        ticket = await self._get(ticket_id, for_update=True)
        if not await RoleChecker.can_view_ticket_async(user, ticket, self.session):
            raise HTTPException(403, "Доступ к данной заявке запрещен")
        if ticket.status.value == "COMPLETED":
            return ticket
        attachments: list[Attachment] = []
        unique_attachment_ids = list(dict.fromkeys(attachment_ids or []))
        if unique_attachment_ids:
            result = await self.session.execute(
                select(Attachment)
                .where(Attachment.id.in_(unique_attachment_ids))
                .with_for_update()
            )
            attachments = list(result.scalars().all())
            if len(attachments) != len(unique_attachment_ids):
                raise HTTPException(400, "Одно или несколько вложений не найдены")
            if any(attachment.ticket_id != ticket_id for attachment in attachments):
                raise HTTPException(400, "Вложение не принадлежит завершаемой заявке")
        completion_comment = None
        if comment.strip() or attachments:
            body = comment.strip() or "Фото к отчёту о выполненной работе"
            completion_comment = await CommentService(self.session).add(ticket_id, body, True, user)
        if completion_comment:
            for attachment in attachments:
                attachment.comment_id = completion_comment.id
                attachment.is_internal = True
        return await self.change_status(ticket_id, "COMPLETED", user)

    async def change_status(self, ticket_id: int, target: str, user: User) -> Ticket:
        ticket = await self._get(ticket_id, for_update=True)
        if not await RoleChecker.can_view_ticket_async(user, ticket, self.session):
            raise HTTPException(403, "Доступ к данной заявке запрещен")
        from_status = ticket.status.value
        target = target.value if hasattr(target, 'value') else str(target)

        if from_status == target:
            return ticket

        if not RoleChecker.can_change_status(user, ticket, target):
            raise HTTPException(
                400, f"У вашей роли нет прав для перевода заявки в статус {target}"
            )

        try:
            await self.fsm.transition(ticket, target, user.id)
        except InvalidTransitionError as exc:
            raise HTTPException(
                409,
                f"Переход из статуса {exc.current} в {exc.target} недопустим",
            ) from exc
        except GuardFailedError as exc:
            detail = {
                "checklist_complete": "Заполните обязательные поля чек-листа",
                "mandatory_photos": "Добавьте обязательные фотографии",
            }.get(exc.guard_name, "Условия перехода заявки не выполнены")
            raise HTTPException(409, detail) from exc

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
        # Уведомление создателю заявки о принятии инженером
        if target == "ACCEPTED" and ticket.created_by:
            creator = await self.session.get(User, ticket.created_by)
            if creator:
                await MailService.notify_creator_accepted(ticket, user, creator)
        return ticket

    @staticmethod
    def _naive_datetime(value):
        if isinstance(value, datetime) and value.tzinfo is not None:
            return value.astimezone(timezone.utc).replace(tzinfo=None)
        return value

    async def _get(self, ticket_id: int, for_update: bool = False) -> Ticket:
        stmt = (
            select(Ticket)
            .where(Ticket.id == ticket_id)
            .options(
                selectinload(Ticket.checklists).selectinload(Checklist.fields),
                selectinload(Ticket.customer),
                selectinload(Ticket.location),
                selectinload(Ticket.assignee),
            )
        )
        if for_update:
            stmt = stmt.with_for_update()
        result = await self.session.execute(stmt)
        ticket = result.scalar_one_or_none()
        if not ticket:
            raise HTTPException(404, f"Заявка с ID {ticket_id} не найдена")
        return ticket

    async def _secure_next_number(self) -> int:
        await self.session.execute(text("SELECT pg_advisory_xact_lock(42)"))
        stmt = (
            select(Ticket.number)
            .order_by(Ticket.number.desc())
            .limit(1)
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
        return u is not None and u.role == UserRole.engineer and u.status == UserStatus.active
