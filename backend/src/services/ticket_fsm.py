from src.core.fsm import BaseFSM
from src.core.fsm.mixins import AuditMixin
from src.models.ticket import Ticket, TicketTransition, TicketStatus
from src.models.checklist import ChecklistField, FieldType
from sqlalchemy.ext.asyncio import AsyncSession


class TicketFSM(BaseFSM, AuditMixin):
    transitions = {
        "ASSIGNED":    ["ACCEPTED"],
        "ACCEPTED":    ["IN_PROGRESS"],
        "IN_PROGRESS": ["COMPLETED"],
        "COMPLETED":   [],
    }

    def __init__(self, session: AsyncSession):
        self.session = session
        self.guards = {
            "IN_PROGRESS->COMPLETED": [
                ("checklist_complete", self._guard_checklist_complete),
                ("mandatory_photos", self._guard_mandatory_photos),
            ],
        }

    def get_status(self, entity: Ticket) -> str:
        return entity.status.value

    def set_status(self, entity: Ticket, target: str) -> None:
        entity.status = TicketStatus(target)

    async def log_transition(
        self, entity: Ticket, from_status: str, to_status: str, user_id: int, context: dict
    ) -> None:
        await self.log_transition_impl(
            self.session, TicketTransition, entity.id,
            from_status, to_status, user_id, context
        )

    async def _guard_checklist_complete(self, ticket: Ticket, ctx: dict) -> bool:
        for checklist in ticket.checklists:
            for field in checklist.fields:
                if field.is_mandatory:
                    val = (field.value or "").strip()
                    if not val or val.lower() in ("false", "нет", "0", "-"):
                        return False
        return True

    async def _guard_mandatory_photos(self, ticket: Ticket, ctx: dict) -> bool:
        photo_fields_count = 0
        photo_fields_filled = 0
        for checklist in ticket.checklists:
            for field in checklist.fields:
                if field.field_type == FieldType.photo and field.is_mandatory:
                    photo_fields_count += 1
                    val = (field.value or "").strip()
                    if val and val.lower() not in ("false", "нет", "0", "-"):
                        photo_fields_filled += 1
        return photo_fields_filled >= photo_fields_count
