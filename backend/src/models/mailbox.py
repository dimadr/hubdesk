from sqlalchemy import String, Integer, Boolean, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column
from ..database import Base
from datetime import datetime


class MailboxConfig(Base):
    __tablename__ = "mailbox_config"

    id: Mapped[int] = mapped_column(primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    email: Mapped[str] = mapped_column(String(255), default="")
    password: Mapped[str] = mapped_column(String(255), default="")
    imap_server: Mapped[str] = mapped_column(String(255), default="imap.gmail.com")
    imap_port: Mapped[int] = mapped_column(Integer, default=993)
    folder: Mapped[str] = mapped_column(String(100), default="INBOX")
    check_interval_min: Mapped[int] = mapped_column(Integer, default=5)
    last_check_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_uid: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
