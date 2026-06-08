from sqlalchemy import String, ForeignKey, JSON, DateTime, Column, Integer, Table
from sqlalchemy.orm import Mapped, mapped_column, relationship
from ..database import Base
from datetime import date


warehouse_access = Table(
    "warehouse_access", Base.metadata,
    Column("warehouse_id", Integer, ForeignKey("warehouses.id"), primary_key=True),
    Column("user_id", Integer, ForeignKey("users.id"), primary_key=True),
)


class AssetLocation(Base):
    __tablename__ = "asset_locations"
    id: Mapped[int] = mapped_column(primary_key=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"))
    name: Mapped[str] = mapped_column(String(255))
    address: Mapped[str] = mapped_column(String(500))
    contacts: Mapped[str | None] = mapped_column(String(500), nullable=True)
    contact_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    contact_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    contact_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    assigned_engineer_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    contract_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    contract_valid_from: Mapped[date | None] = mapped_column(nullable=True)
    contract_valid_to: Mapped[date | None] = mapped_column(nullable=True)

    customer: Mapped["Customer"] = relationship(back_populates="locations")
    assigned_engineer: Mapped["User | None"] = relationship(foreign_keys=[assigned_engineer_id])
    equipment: Mapped[list["Equipment"]] = relationship(back_populates="location")
    tickets: Mapped[list["Ticket"]] = relationship(back_populates="location")


class Equipment(Base):
    __tablename__ = "equipment"
    id: Mapped[int] = mapped_column(primary_key=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("asset_locations.id"))
    serial_number: Mapped[str] = mapped_column(String(100), unique=True)
    model: Mapped[str] = mapped_column(String(255))
    qr_code: Mapped[str] = mapped_column(String(255))
    maintenance_history: Mapped[dict] = mapped_column(JSON, default=dict)

    location: Mapped["AssetLocation"] = relationship(back_populates="equipment")
    tickets: Mapped[list["Ticket"]] = relationship(back_populates="equipment")
