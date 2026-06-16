from sqlalchemy import String, ForeignKey, DateTime, Enum, Boolean, func, Index, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from ..database import Base
import enum
from datetime import datetime


class TicketStatus(str, enum.Enum):
    ASSIGNED = "ASSIGNED"
    ACCEPTED = "ACCEPTED"
    ON_THE_WAY = "ON_THE_WAY"
    ARRIVED = "ARRIVED"
    IN_PROGRESS = "IN_PROGRESS"
    REVIEW = "REVIEW"
    COMPLETED = "COMPLETED"


class TicketPriority(str, enum.Enum):
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


class TicketType(str, enum.Enum):
    repair = "repair"
    installation = "installation"
    maintenance = "maintenance"
    inspection = "inspection"
    emergency = "emergency"
    verification = "verification"


class Ticket(Base):
    __tablename__ = "tickets"
    __table_args__ = (
        Index("ix_tickets_status", "status"),
        Index("ix_tickets_assignee", "assignee_id"),
        Index("ix_tickets_customer", "customer_id"),
        Index("ix_tickets_archived", "archived_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[int] = mapped_column(unique=True)
    subject: Mapped[str] = mapped_column(String(500))
    body: Mapped[str] = mapped_column(String(5000))
    status: Mapped[TicketStatus] = mapped_column(
        Enum(TicketStatus), default=TicketStatus.ASSIGNED
    )
    priority: Mapped[TicketPriority] = mapped_column(
        Enum(TicketPriority), default=TicketPriority.medium
    )
    type: Mapped[TicketType | None] = mapped_column(
        Enum(TicketType), nullable=True
    )
    is_internal: Mapped[bool] = mapped_column(Boolean, default=False)

    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"))
    location_id: Mapped[int | None] = mapped_column(ForeignKey("asset_locations.id"), nullable=True)
    equipment_id: Mapped[int | None] = mapped_column(ForeignKey("equipment.id"), nullable=True)
    assignee_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    group_id: Mapped[int | None] = mapped_column(ForeignKey("groups.id"), nullable=True)

    site_contact_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    site_contact_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    scheduled_start: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    scheduled_end: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    source_description: Mapped[str | None] = mapped_column(String(5000), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    response_deadline: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    resolution_deadline: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    customer: Mapped["Customer"] = relationship(back_populates="tickets")
    location: Mapped["AssetLocation"] = relationship(back_populates="tickets")
    equipment: Mapped["Equipment | None"] = relationship(back_populates="tickets")
    assignee: Mapped["User | None"] = relationship(back_populates="assigned_tickets", foreign_keys=[assignee_id])
    group: Mapped["Group | None"] = relationship(back_populates="tickets")
    comments: Mapped[list["Comment"]] = relationship(back_populates="ticket")
    attachments: Mapped[list["Attachment"]] = relationship(back_populates="ticket")
    checklists: Mapped[list["Checklist"]] = relationship(back_populates="ticket")
    transitions: Mapped[list["TicketTransition"]] = relationship(back_populates="ticket")


class TicketTransition(Base):
    __tablename__ = "ticket_transitions"
    id: Mapped[int] = mapped_column(primary_key=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets.id"))
    from_status: Mapped[TicketStatus] = mapped_column(Enum(TicketStatus))
    to_status: Mapped[TicketStatus] = mapped_column(Enum(TicketStatus))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    timestamp: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    meta: Mapped[dict] = mapped_column("metadata", JSON, default=dict)

    ticket: Mapped["Ticket"] = relationship(back_populates="transitions")
    user: Mapped["User"] = relationship()
