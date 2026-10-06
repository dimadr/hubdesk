from datetime import timedelta, datetime
from src.models.ticket import Ticket


class SLAService:
    @staticmethod
    def response_time(ticket: Ticket) -> timedelta | None:
        if ticket.accepted_at and ticket.created_at:
            return ticket.accepted_at - ticket.created_at
        return None

    @staticmethod
    def resolution_time(ticket: Ticket) -> timedelta | None:
        if ticket.completed_at and ticket.created_at:
            return ticket.completed_at - ticket.created_at
        return None

    @staticmethod
    def is_response_overdue(ticket: Ticket) -> bool:
        if not ticket.response_deadline:
            return False
        if ticket.accepted_at:
            return ticket.accepted_at > ticket.response_deadline
        return datetime.utcnow() > ticket.response_deadline

    @staticmethod
    def is_resolution_overdue(ticket: Ticket) -> bool:
        if not ticket.resolution_deadline:
            return False
        if ticket.completed_at:
            return ticket.completed_at > ticket.resolution_deadline
        return datetime.utcnow() > ticket.resolution_deadline
