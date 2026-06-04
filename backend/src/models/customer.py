from sqlalchemy import String, Enum, ForeignKey, Date
from sqlalchemy.orm import Mapped, mapped_column, relationship
from ..database import Base
import enum


class CustomerType(str, enum.Enum):
    company = "company"
    individual = "individual"


class Customer(Base):
    __tablename__ = "customers"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    type: Mapped[CustomerType] = mapped_column(Enum(CustomerType), default=CustomerType.company)

    contracts: Mapped[list["Contract"]] = relationship(back_populates="customer")
    locations: Mapped[list["AssetLocation"]] = relationship(back_populates="customer")
    tickets: Mapped[list["Ticket"]] = relationship(back_populates="customer")


class Contract(Base):
    __tablename__ = "contracts"
    id: Mapped[int] = mapped_column(primary_key=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"))
    sla_hours: Mapped[int]
    resolution_sla_hours: Mapped[int]
    pricing: Mapped[str] = mapped_column(String(1000))
    valid_from: Mapped[Date] = mapped_column(Date)
    valid_to: Mapped[Date] = mapped_column(Date)

    customer: Mapped["Customer"] = relationship(back_populates="contracts")
