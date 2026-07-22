from datetime import date
from typing import Any, Dict, List
from sqlalchemy import String, ForeignKey, JSON, Table, Column, Integer, text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base

warehouse_access = Table(
    "warehouse_access",
    Base.metadata,
    Column("warehouse_id", Integer, ForeignKey("warehouses.id", ondelete="CASCADE"), primary_key=True),
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
)


class LocationContact(Base):
    __tablename__ = "location_contacts"

    id: Mapped[int] = mapped_column(primary_key=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("asset_locations.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    position: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_primary: Mapped[bool] = mapped_column(default=False)

    location: Mapped["AssetLocation"] = relationship(back_populates="contacts_list")


class AssetLocation(Base):
    __tablename__ = "asset_locations"

    id: Mapped[int] = mapped_column(primary_key=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id", ondelete="RESTRICT"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    address: Mapped[str] = mapped_column(String(500))
    contacts: Mapped[str | None] = mapped_column(String(500), nullable=True)
    contact_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    contact_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    contact_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    assigned_engineer_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    contract_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    contract_valid_from: Mapped[date | None] = mapped_column(nullable=True)
    contract_valid_to: Mapped[date | None] = mapped_column(nullable=True)
    inn: Mapped[str | None] = mapped_column(String(12), nullable=True, index=True)

    customer: Mapped["Customer"] = relationship(back_populates="locations")
    assigned_engineer: Mapped["User | None"] = relationship(
        foreign_keys=[assigned_engineer_id],
        back_populates="assigned_locations"
    )
    equipment: Mapped[List["Equipment"]] = relationship(
        back_populates="location",
        cascade="all, delete-orphan"
    )
    tickets: Mapped[List["Ticket"]] = relationship(back_populates="location")
    contacts_list: Mapped[List["LocationContact"]] = relationship(
        back_populates="location",
        cascade="all, delete-orphan",
        order_by="LocationContact.is_primary.desc(), LocationContact.id"
    )


class Equipment(Base):
    __tablename__ = "equipment"

    id: Mapped[int] = mapped_column(primary_key=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("asset_locations.id", ondelete="RESTRICT"), index=True)
    serial_number: Mapped[str] = mapped_column(String(100), index=True)
    model: Mapped[str] = mapped_column(String(255), index=True)
    qr_code: Mapped[str] = mapped_column(String(255), unique=True)
    maintenance_history: Mapped[Dict[str, Any]] = mapped_column(
        JSON,
        default=dict,
        server_default=text("'{}'")
    )

    location: Mapped["AssetLocation"] = relationship(back_populates="equipment")
    tickets: Mapped[List["Ticket"]] = relationship(back_populates="equipment")

    __table_args__ = (
        UniqueConstraint("location_id", "serial_number", name="uq_location_serial"),
    )
