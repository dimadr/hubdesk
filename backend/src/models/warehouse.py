from decimal import Decimal

from sqlalchemy import String, ForeignKey, Enum, DateTime, func, UniqueConstraint, Numeric
from sqlalchemy.orm import Mapped, mapped_column, relationship
from ..database import Base
import enum
from datetime import datetime

from .equipment import warehouse_access


class WarehouseType(str, enum.Enum):
    physical = "physical"
    personal = "personal"


class NomenclatureType(str, enum.Enum):
    material = "material"
    product = "product"
    service = "service"
    work = "work"


class DocType(str, enum.Enum):
    INFLOW = "INFLOW"
    TRANSFER = "TRANSFER"
    WRITE_OFF = "WRITE_OFF"


class DocStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    APPROVAL = "APPROVAL"
    DELIVERY = "DELIVERY"
    ACCOUNTED = "ACCOUNTED"


class Warehouse(Base):
    __tablename__ = "warehouses"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    type: Mapped[WarehouseType] = mapped_column(Enum(WarehouseType))

    authorized_users: Mapped[list["User"]] = relationship(secondary=warehouse_access, back_populates="accessible_warehouses")


class Nomenclature(Base):
    __tablename__ = "nomenclature"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    type: Mapped[NomenclatureType] = mapped_column(Enum(NomenclatureType))
    unit: Mapped[str] = mapped_column(String(50))


class AccountingDocument(Base):
    __tablename__ = "accounting_documents"
    id: Mapped[int] = mapped_column(primary_key=True)
    doc_type: Mapped[DocType] = mapped_column(Enum(DocType))
    status: Mapped[DocStatus] = mapped_column(Enum(DocStatus), default=DocStatus.DRAFT)
    source_warehouse_id: Mapped[int | None] = mapped_column(ForeignKey("warehouses.id"), nullable=True)
    target_warehouse_id: Mapped[int | None] = mapped_column(ForeignKey("warehouses.id"), nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    source_warehouse: Mapped["Warehouse | None"] = relationship(foreign_keys=[source_warehouse_id])
    target_warehouse: Mapped["Warehouse | None"] = relationship(foreign_keys=[target_warehouse_id])
    lines: Mapped[list["DocumentLine"]] = relationship(back_populates="document")
    transitions: Mapped[list["WarehouseTransition"]] = relationship(back_populates="document")


class DocumentLine(Base):
    __tablename__ = "document_lines"
    id: Mapped[int] = mapped_column(primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("accounting_documents.id"), index=True)
    nomenclature_id: Mapped[int] = mapped_column(ForeignKey("nomenclature.id"))
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 3))

    document: Mapped["AccountingDocument"] = relationship(back_populates="lines")
    nomenclature: Mapped["Nomenclature"] = relationship()


class StockBalance(Base):
    __tablename__ = "stock_balances"
    __table_args__ = (
        UniqueConstraint("warehouse_id", "nomenclature_id"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id"))
    nomenclature_id: Mapped[int] = mapped_column(ForeignKey("nomenclature.id"))
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 3), default=Decimal("0"))


class WarehouseTransition(Base):
    __tablename__ = "warehouse_document_transitions"

    id: Mapped[int] = mapped_column(primary_key=True)
    document_id: Mapped[int] = mapped_column(
        ForeignKey("accounting_documents.id", ondelete="CASCADE"), index=True
    )
    from_status: Mapped[DocStatus] = mapped_column(Enum(DocStatus))
    to_status: Mapped[DocStatus] = mapped_column(Enum(DocStatus))
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    timestamp: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    document: Mapped["AccountingDocument"] = relationship(back_populates="transitions")
