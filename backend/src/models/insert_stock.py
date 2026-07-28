from sqlalchemy import String, ForeignKey, Integer, DateTime, Index, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from ..database import Base
from datetime import datetime


class InsertProduct(Base):
    __tablename__ = "insert_products"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    diameter_inner: Mapped[str | None] = mapped_column(String(50), nullable=True)
    diameter_outer: Mapped[str | None] = mapped_column(String(50), nullable=True)
    length: Mapped[str | None] = mapped_column(String(50), nullable=True)
    flange_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    notes: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    cell: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index(
            "uq_insert_products_name_normalized",
            func.lower(func.trim(name)),
            unique=True,
        ),
    )


class InsertTransaction(Base):
    __tablename__ = "insert_transactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    type: Mapped[str] = mapped_column(String(20))  # incoming, outgoing, return
    product_id: Mapped[int] = mapped_column(ForeignKey("insert_products.id"), index=True)
    quantity: Mapped[int] = mapped_column()
    taken_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    location_id: Mapped[int | None] = mapped_column(ForeignKey("asset_locations.id"), nullable=True)
    destination: Mapped[str | None] = mapped_column(String(500), nullable=True)
    comment: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    document: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    product: Mapped["InsertProduct"] = relationship(backref="transactions")
    taken_by: Mapped["User | None"] = relationship(foreign_keys=[taken_by_id])
    location: Mapped["AssetLocation | None"] = relationship(foreign_keys=[location_id])
