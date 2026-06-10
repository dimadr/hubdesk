from sqlalchemy import String, ForeignKey, Integer, Date, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from ..database import Base
from datetime import date, datetime


class ReplacementDevice(Base):
    __tablename__ = "replacement_devices"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    verification_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    verification_interval_months: Mapped[int | None] = mapped_column(Integer, nullable=True)
    verification_expiry: Mapped[date | None] = mapped_column(Date, nullable=True)
    passport_scan: Mapped[str | None] = mapped_column(String(500), nullable=True)
    taken_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    location_id: Mapped[int | None] = mapped_column(ForeignKey("asset_locations.id"), nullable=True)
    return_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="available")  # available, taken, overdue
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    taken_by: Mapped["User | None"] = relationship(foreign_keys=[taken_by_id])
    location: Mapped["AssetLocation | None"] = relationship(foreign_keys=[location_id])
