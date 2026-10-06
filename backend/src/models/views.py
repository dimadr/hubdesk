from sqlalchemy import String, ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column
from ..database import Base


class SavedView(Base):
    __tablename__ = "saved_views"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String(255))
    view_type: Mapped[str] = mapped_column(String(50), default="table")
    filters: Mapped[dict] = mapped_column(JSON, default=dict)
    columns: Mapped[list] = mapped_column(JSON, default=list)
    sort_by: Mapped[str | None] = mapped_column(String(100), nullable=True)
    sort_dir: Mapped[str | None] = mapped_column(String(10), nullable=True, default="asc")
