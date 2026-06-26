from sqlalchemy import String, ForeignKey, Enum, Table, Column, Integer, Boolean, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from ..database import Base
import enum
from datetime import datetime

from .equipment import warehouse_access


class UserRole(str, enum.Enum):
    customer = "customer"
    engineer = "engineer"
    dispatcher = "dispatcher"
    admin = "admin"
    storekeeper = "storekeeper"
    viewer = "viewer"
    metrologist = "metrologist"
    accountant = "accountant"


class UserStatus(str, enum.Enum):
    pending = "pending"
    active = "active"
    rejected = "rejected"


user_group = Table(
    "user_group", Base.metadata,
    Column("user_id", Integer, ForeignKey("users.id"), primary_key=True),
    Column("group_id", Integer, ForeignKey("groups.id"), primary_key=True),
)


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True)
    name: Mapped[str] = mapped_column(String(255))
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    patronymic: Mapped[str | None] = mapped_column(String(255), nullable=True)
    position: Mapped[str | None] = mapped_column(String(500), nullable=True)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), default=UserRole.engineer)
    password_hash: Mapped[str] = mapped_column(String(255))
    status: Mapped[UserStatus] = mapped_column(Enum(UserStatus), default=UserStatus.active)
    consent_given: Mapped[bool] = mapped_column(Boolean, default=False)
    consent_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    assigned_tickets: Mapped[list["Ticket"]] = relationship(
        back_populates="assignee", foreign_keys="Ticket.assignee_id"
    )
    groups: Mapped[list["Group"]] = relationship(secondary=user_group, back_populates="members")
    accessible_warehouses: Mapped[list["Warehouse"]] = relationship(secondary=warehouse_access, back_populates="authorized_users")
    assigned_locations: Mapped[list["AssetLocation"]] = relationship(back_populates="assigned_engineer", foreign_keys="AssetLocation.assigned_engineer_id")


class Group(Base):
    __tablename__ = "groups"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    type: Mapped[str] = mapped_column(String(50))

    members: Mapped[list["User"]] = relationship(secondary=user_group, back_populates="groups")
    tickets: Mapped[list["Ticket"]] = relationship(back_populates="group")
