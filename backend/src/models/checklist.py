from sqlalchemy import String, ForeignKey, Boolean, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from ..database import Base
import enum


class FieldType(str, enum.Enum):
    text = "text"
    number = "number"
    checkbox = "checkbox"
    photo = "photo"
    signature = "signature"


class Checklist(Base):
    __tablename__ = "checklists"
    id: Mapped[int] = mapped_column(primary_key=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets.id"))
    name: Mapped[str] = mapped_column(String(255))

    ticket: Mapped["Ticket"] = relationship(back_populates="checklists")
    fields: Mapped[list["ChecklistField"]] = relationship(back_populates="checklist")


class ChecklistField(Base):
    __tablename__ = "checklist_fields"
    id: Mapped[int] = mapped_column(primary_key=True)
    checklist_id: Mapped[int] = mapped_column(ForeignKey("checklists.id"))
    label: Mapped[str] = mapped_column(String(255))
    field_type: Mapped[FieldType] = mapped_column(SAEnum(FieldType))
    is_mandatory: Mapped[bool] = mapped_column(Boolean, default=False)
    value: Mapped[str | None] = mapped_column(String(1000), nullable=True)

    checklist: Mapped["Checklist"] = relationship(back_populates="fields")
