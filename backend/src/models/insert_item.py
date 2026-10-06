from sqlalchemy import String, ForeignKey, Integer, Date, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from ..database import Base
from datetime import date, datetime


class InsertItem(Base):
    __tablename__ = "insert_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    device_name: Mapped[str] = mapped_column(String(255))
    diameter: Mapped[str | None] = mapped_column(String(50), nullable=True)
    length: Mapped[str | None] = mapped_column(String(50), nullable=True)
    flange_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    taken_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    location_id: Mapped[int | None] = mapped_column(ForeignKey("asset_locations.id"), nullable=True)
    return_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    taken_by: Mapped["User | None"] = relationship(foreign_keys=[taken_by_id])
    location: Mapped["AssetLocation | None"] = relationship(foreign_keys=[location_id])
