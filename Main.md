# FSM Platform — Инструкция по реализации

## Архитектура

- **Backend:** FastAPI + async SQLAlchemy 2.0 + asyncpg + Alembic
- **Frontend:** React 18 + TypeScript + Vite + Zustand + react-query + react-window + dnd-kit
- **Infra:** PostgreSQL 15, Redis 7 (docker-compose)
- **Правила:**
  - Смена статусов — только через FSM
  - Складские остатки — только через ACCOUNTED документы
  - Бизнес-логика — только в services, НЕ в controllers

---

## 1. Структура проекта

```
backend/
├── pyproject.toml
├── alembic.ini
├── migrations/
├── src/
│   ├── main.py
│   ├── config.py
│   ├── database.py
│   │
│   ├── core/
│   │   ├── fsm/
│   │   │   ├── __init__.py
│   │   │   ├── base.py
│   │   │   ├── mixins.py
│   │   │   └── exceptions.py
│   │   ├── exceptions.py
│   │   └── deps.py
│   │
│   ├── models/
│   │   ├── __init__.py
│   │   ├── customer.py
│   │   ├── equipment.py
│   │   ├── ticket.py
│   │   ├── user.py
│   │   ├── comment.py
│   │   ├── attachment.py
│   │   ├── checklist.py
│   │   └── warehouse.py
│   │
│   ├── services/
│   │   ├── __init__.py
│   │   ├── ticket_fsm.py
│   │   ├── warehouse_fsm.py
│   │   ├── ticket_service.py
│   │   ├── warehouse_service.py
│   │   ├── sla_service.py
│   │   ├── acl_service.py
│   │   ├── comment_service.py
│   │   └── attachment_service.py
│   │
│   ├── api/
│   │   ├── __init__.py
│   │   ├── router.py
│   │   ├── tickets.py
│   │   ├── comments.py
│   │   ├── attachments.py
│   │   ├── equipment.py
│   │   ├── warehouse.py
│   │   ├── views.py
│   │   └── schemas.py
│   │
│   └── ws/
│       ├── __init__.py
│       └── manager.py

frontend/
├── package.json
├── vite.config.ts
├── tsconfig.json
├── index.html
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── api/
│   │   └── client.ts
│   ├── store/
│   │   ├── tickets.ts
│   │   └── views.ts
│   ├── pages/
│   │   ├── TicketsPage.tsx
│   │   ├── TicketDetailPage.tsx
│   │   └── WarehousePage.tsx
│   ├── components/
│   │   ├── TicketGrid/
│   │   │   ├── TicketGrid.tsx
│   │   │   ├── TableView.tsx
│   │   │   ├── CardView.tsx
│   │   │   ├── TreeView.tsx
│   │   │   ├── ColumnHeader.tsx
│   │   │   ├── RowStyles.tsx
│   │   │   ├── Tabs.tsx
│   │   │   └── SavedViews.tsx
│   │   ├── SearchBar.tsx
│   │   ├── TicketForm.tsx
│   │   ├── CommentThread.tsx
│   │   └── ChecklistForm.tsx
│   └── hooks/
│       ├── useWebSocket.ts
│       └── useSavedViews.ts

docker/
├── docker-compose.yml
└── Dockerfile
```

---

## 2. Этап 1: Инфраструктура

### `docker/docker-compose.yml`

```yaml
version: "3.9"
services:
  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: fsm
      POSTGRES_USER: fsm
      POSTGRES_PASSWORD: fsm
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
volumes:
  pgdata:
```

### `backend/src/config.py`

```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://fsm:fsm@localhost:5432/fsm"
    redis_url: str = "redis://localhost:6379/0"
    secret_key: str = "change-me"
    access_token_ttl: int = 3600

    class Config:
        env_file = ".env"

settings = Settings()
```

### `backend/src/database.py`

```python
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from .config import settings

engine = create_async_engine(settings.database_url, echo=False)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

class Base(DeclarativeBase):
    pass

async def get_db() -> AsyncSession:
    async with async_session() as session:
        yield session
```

### `backend/src/main.py`

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from .api.router import api_router
from .database import engine, Base

@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield

app = FastAPI(title="FSM Platform", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.include_router(api_router, prefix="/api")

@app.get("/health")
async def health():
    return {"status": "ok"}
```

---

## 3. Этап 2: Модели данных

### `backend/src/models/customer.py`

```python
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
    sla_hours: Mapped[int]                                   # response SLA в часах
    resolution_sla_hours: Mapped[int]                         # resolution SLA в часах
    pricing: Mapped[str] = mapped_column(String(1000))       # JSON-строка условий
    valid_from: Mapped[Date] = mapped_column(Date)
    valid_to: Mapped[Date] = mapped_column(Date)

    customer: Mapped["Customer"] = relationship(back_populates="contracts")
```

### `backend/src/models/equipment.py`

```python
from sqlalchemy import String, ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from ..database import Base

class AssetLocation(Base):
    __tablename__ = "asset_locations"
    id: Mapped[int] = mapped_column(primary_key=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"))
    name: Mapped[str] = mapped_column(String(255))
    address: Mapped[str] = mapped_column(String(500))

    customer: Mapped["Customer"] = relationship(back_populates="locations")
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
```

### `backend/src/models/ticket.py`

```python
from sqlalchemy import String, ForeignKey, DateTime, Enum, Boolean, func, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from ..database import Base
import enum
from datetime import datetime

class TicketStatus(str, enum.Enum):
    ASSIGNED = "ASSIGNED"
    ACCEPTED = "ACCEPTED"
    ON_THE_WAY = "ON_THE_WAY"
    ARRIVED = "ARRIVED"
    IN_PROGRESS = "IN_PROGRESS"
    REVIEW = "REVIEW"
    COMPLETED = "COMPLETED"

class TicketPriority(str, enum.Enum):
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"

class Ticket(Base):
    __tablename__ = "tickets"
    __table_args__ = (
        Index("ix_tickets_status", "status"),
        Index("ix_tickets_assignee", "assignee_id"),
        Index("ix_tickets_customer", "customer_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[int] = mapped_column(unique=True)                      # сквозной номер
    subject: Mapped[str] = mapped_column(String(500))
    body: Mapped[str] = mapped_column(String(5000))
    status: Mapped[TicketStatus] = mapped_column(
        Enum(TicketStatus), default=TicketStatus.ASSIGNED
    )
    priority: Mapped[TicketPriority] = mapped_column(
        Enum(TicketPriority), default=TicketPriority.medium
    )
    is_internal: Mapped[bool] = mapped_column(Boolean, default=False)

    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"))
    location_id: Mapped[int] = mapped_column(ForeignKey("asset_locations.id"))
    equipment_id: Mapped[int | None] = mapped_column(ForeignKey("equipment.id"), nullable=True)
    assignee_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    group_id: Mapped[int | None] = mapped_column(ForeignKey("groups.id"), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    response_deadline: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    resolution_deadline: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    customer: Mapped["Customer"] = relationship(back_populates="tickets")
    location: Mapped["AssetLocation"] = relationship(back_populates="tickets")
    equipment: Mapped["Equipment | None"] = relationship(back_populates="tickets")
    assignee: Mapped["User | None"] = relationship(back_populates="assigned_tickets", foreign_keys=[assignee_id])
    group: Mapped["Group | None"] = relationship(back_populates="tickets")
    comments: Mapped[list["Comment"]] = relationship(back_populates="ticket")
    attachments: Mapped[list["Attachment"]] = relationship(back_populates="ticket")
    checklists: Mapped[list["Checklist"]] = relationship(back_populates="ticket")
    transitions: Mapped[list["TicketTransition"]] = relationship(back_populates="ticket")

class TicketTransition(Base):
    __tablename__ = "ticket_transitions"
    id: Mapped[int] = mapped_column(primary_key=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets.id"))
    from_status: Mapped[TicketStatus] = mapped_column(Enum(TicketStatus))
    to_status: Mapped[TicketStatus] = mapped_column(Enum(TicketStatus))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    timestamp: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    metadata: Mapped[dict] = mapped_column(JSON, default=dict)

    ticket: Mapped["Ticket"] = relationship(back_populates="transitions")
    user: Mapped["User"] = relationship()
```

### `backend/src/models/user.py`

```python
from sqlalchemy import String, ForeignKey, Enum, Table, Column, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship
from ..database import Base
import enum

class UserRole(str, enum.Enum):
    customer = "customer"
    engineer = "engineer"
    dispatcher = "dispatcher"
    admin = "admin"

user_group = Table(
    "user_group", Base.metadata,
    Column("user_id", Integer, ForeignKey("users.id"), primary_key=True),
    Column("group_id", Integer, ForeignKey("groups.id"), primary_key=True),
)

class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True)
    name: Mapped[str] = mapped_column(String(255))
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), default=UserRole.engineer)
    password_hash: Mapped[str] = mapped_column(String(255))

    assigned_tickets: Mapped[list["Ticket"]] = relationship(
        back_populates="assignee", foreign_keys="Ticket.assignee_id"
    )
    groups: Mapped[list["Group"]] = relationship(secondary=user_group, back_populates="members")

class Group(Base):
    __tablename__ = "groups"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    type: Mapped[str] = mapped_column(String(50))

    members: Mapped[list["User"]] = relationship(secondary=user_group, back_populates="groups")
    tickets: Mapped[list["Ticket"]] = relationship(back_populates="group")
```

### `backend/src/models/comment.py`

```python
from sqlalchemy import String, ForeignKey, Boolean, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from ..database import Base
from datetime import datetime

class Comment(Base):
    __tablename__ = "comments"
    id: Mapped[int] = mapped_column(primary_key=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets.id"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    body: Mapped[str] = mapped_column(String(5000))
    is_internal: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    ticket: Mapped["Ticket"] = relationship(back_populates="comments")
    user: Mapped["User"] = relationship()
    attachments: Mapped[list["Attachment"]] = relationship(back_populates="comment")
```

### `backend/src/models/attachment.py`

```python
from sqlalchemy import String, ForeignKey, Boolean, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from ..database import Base
from datetime import datetime

class Attachment(Base):
    __tablename__ = "attachments"
    id: Mapped[int] = mapped_column(primary_key=True)
    ticket_id: Mapped[int | None] = mapped_column(ForeignKey("tickets.id"), nullable=True)
    comment_id: Mapped[int | None] = mapped_column(ForeignKey("comments.id"), nullable=True)
    filename: Mapped[str] = mapped_column(String(255))
    path: Mapped[str] = mapped_column(String(500))
    content_type: Mapped[str] = mapped_column(String(100))
    size: Mapped[int]
    is_internal: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    ticket: Mapped["Ticket | None"] = relationship(back_populates="attachments")
    comment: Mapped["Comment | None"] = relationship(back_populates="attachments")
```

### `backend/src/models/checklist.py`

```python
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
```

### `backend/src/models/warehouse.py`

```python
from sqlalchemy import String, ForeignKey, Enum, DateTime, func, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from ..database import Base
import enum
from datetime import datetime

class WarehouseType(str, enum.Enum):
    physical = "physical"
    personal = "personal"

class NomenclatureType(str, enum.Enum):
    material = "material"
    product = "product"
    service = "service"
    work = "work"

class DocType(str, enum.Enum):
    inflow = "INFLOW"
    transfer = "TRANSFER"
    write_off = "WRITE_OFF"

class DocStatus(str, enum.Enum):
    draft = "DRAFT"
    approval = "APPROVAL"
    delivery = "DELIVERY"
    accounted = "ACCOUNTED"

class Warehouse(Base):
    __tablename__ = "warehouses"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    type: Mapped[WarehouseType] = mapped_column(Enum(WarehouseType))

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
    status: Mapped[DocStatus] = mapped_column(Enum(DocStatus), default=DocStatus.draft)
    source_warehouse_id: Mapped[int | None] = mapped_column(ForeignKey("warehouses.id"), nullable=True)
    target_warehouse_id: Mapped[int | None] = mapped_column(ForeignKey("warehouses.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    source_warehouse: Mapped["Warehouse | None"] = relationship(foreign_keys=[source_warehouse_id])
    target_warehouse: Mapped["Warehouse | None"] = relationship(foreign_keys=[target_warehouse_id])
    lines: Mapped[list["DocumentLine"]] = relationship(back_populates="document")

class DocumentLine(Base):
    __tablename__ = "document_lines"
    id: Mapped[int] = mapped_column(primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("accounting_documents.id"))
    nomenclature_id: Mapped[int] = mapped_column(ForeignKey("nomenclature.id"))
    quantity: Mapped[float] = mapped_column()       # >0

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
    quantity: Mapped[float] = mapped_column(default=0.0)
```

---

## 4. Этап 3: FSM Engine

### `backend/src/core/fsm/__init__.py`

```python
from .base import BaseFSM
from .exceptions import InvalidTransitionError, GuardFailedError
```

### `backend/src/core/fsm/exceptions.py`

```python
class InvalidTransitionError(Exception):
    def __init__(self, current: str, target: str, entity_id: int):
        self.current = current
        self.target = target
        self.entity_id = entity_id
        super().__init__(f"Invalid transition: {current} -> {target} for entity {entity_id}")

class GuardFailedError(Exception):
    def __init__(self, guard_name: str, reason: str):
        self.guard_name = guard_name
        self.reason = reason
        super().__init__(f"Guard '{guard_name}' failed: {reason}")
```

### `backend/src/core/fsm/base.py`

```python
from abc import ABC, abstractmethod
from typing import Any, Callable, Coroutine
from .exceptions import InvalidTransitionError, GuardFailedError

GuardFn = Callable[[Any, dict[str, Any]], Coroutine[Any, Any, bool]]

class BaseFSM(ABC):
    transitions: dict[str, list[str]] = {}
    guards: dict[str, list[tuple[str, GuardFn]]] = {}

    @abstractmethod
    def get_status(self, entity: Any) -> str:
        ...

    @abstractmethod
    def set_status(self, entity: Any, target: str) -> None:
        ...

    @abstractmethod
    async def log_transition(
        self, entity: Any, from_status: str, to_status: str, user_id: int, context: dict
    ) -> None:
        ...

    def can_transition(self, current: str, target: str) -> bool:
        allowed = self.transitions.get(current, [])
        return target in allowed

    async def transition(
        self, entity: Any, target: str, user_id: int, context: dict[str, Any] | None = None
    ) -> Any:
        ctx = context or {}
        current = self.get_status(entity)
        if not self.can_transition(current, target):
            raise InvalidTransitionError(current, target, getattr(entity, "id", 0))
        guard_list = self.guards.get(f"{current}->{target}", [])
        for guard_name, guard_fn in guard_list:
            ok = await guard_fn(entity, ctx)
            if not ok:
                raise GuardFailedError(guard_name, f"Transition {current}->{target} blocked")
        self.set_status(entity, target)
        await self.log_transition(entity, current, target, user_id, ctx)
        return entity
```

### `backend/src/core/fsm/mixins.py`

```python
from sqlalchemy.ext.asyncio import AsyncSession

class AuditMixin:
    async def log_transition_impl(
        self,
        session: AsyncSession,
        transition_class: type,
        entity_id: int,
        from_status: str,
        to_status: str,
        user_id: int,
        metadata: dict | None = None,
    ):
        record = transition_class(
            **{f"{transition_class.__tablename__.split('_')[0]}_id": entity_id},
            from_status=from_status,
            to_status=to_status,
            user_id=user_id,
            metadata=metadata or {},
        )
        session.add(record)
        await session.flush()
```

### `backend/src/services/ticket_fsm.py`

```python
from src.core.fsm import BaseFSM, AuditMixin
from src.models.ticket import Ticket, TicketTransition, TicketStatus
from src.models.checklist import FieldType
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

class TicketFSM(BaseFSM, AuditMixin):
    transitions = {
        "ASSIGNED":    ["ACCEPTED"],
        "ACCEPTED":    ["ON_THE_WAY"],
        "ON_THE_WAY":  ["ARRIVED"],
        "ARRIVED":     ["IN_PROGRESS"],
        "IN_PROGRESS": ["REVIEW"],
        "REVIEW":      ["COMPLETED"],
        "COMPLETED":   [],
    }

    guards = {
        "REVIEW->COMPLETED": [
            ("checklist_complete", "_guard_checklist_complete"),
            ("mandatory_photos", "_guard_mandatory_photos"),
        ],
    }

    def __init__(self, session: AsyncSession):
        self.session = session

    def get_status(self, entity: Ticket) -> str:
        return entity.status.value

    def set_status(self, entity: Ticket, target: str) -> None:
        entity.status = TicketStatus(target)

    async def log_transition(
        self, entity: Ticket, from_status: str, to_status: str, user_id: int, context: dict
    ) -> None:
        await self.log_transition_impl(
            self.session, TicketTransition, entity.id,
            from_status, to_status, user_id, context
        )

    async def _guard_checklist_complete(self, ticket: Ticket, ctx: dict) -> bool:
        for checklist in ticket.checklists:
            for field in checklist.fields:
                if field.is_mandatory and not field.value:
                    return False
        return True

    async def _guard_mandatory_photos(self, ticket: Ticket, ctx: dict) -> bool:
        photo_fields_count = 0
        photo_fields_filled = 0
        for checklist in ticket.checklists:
            for field in checklist.fields:
                if field.field_type == FieldType.photo and field.is_mandatory:
                    photo_fields_count += 1
                    if field.value:
                        photo_fields_filled += 1
        return photo_fields_filled >= photo_fields_count
```

### `backend/src/services/warehouse_fsm.py`

```python
from src.core.fsm import BaseFSM, AuditMixin
from src.models.warehouse import (
    AccountingDocument, DocStatus, DocType, DocumentLine,
    NomenclatureType, StockBalance,
)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

class WarehouseDocFSM(BaseFSM, AuditMixin):
    transitions = {
        "DRAFT":    ["APPROVAL"],
        "APPROVAL": ["DELIVERY"],
        "DELIVERY": ["ACCOUNTED"],
        "ACCOUNTED": [],
    }

    def __init__(self, session: AsyncSession):
        self.session = session

    def get_status(self, entity: AccountingDocument) -> str:
        return entity.status.value

    def set_status(self, entity: AccountingDocument, target: str) -> None:
        entity.status = DocStatus(target)

    async def log_transition(
        self, entity: AccountingDocument, from_status: str, to_status: str, user_id: int, context: dict
    ) -> None:
        # аудит имплементируется отдельно, без отдельной таблицы пока
        pass

    async def post_account(self, document: AccountingDocument) -> None:
        """Пересчёт остатков при статусе ACCOUNTED"""
        for line in document.lines:
            nom_type = (await self.session.execute(
                select(NomenclatureType).where(
                    line.nomenclature_id == NomenclatureType  # фактически нужен запрос к номенклатуре
                )
            )).scalar_one_or_none()
            # Упрощённо: для всех типов пересчитываем
            await self._apply_stock_change(
                document.doc_type,
                document.source_warehouse_id,
                document.target_warehouse_id,
                line.nomenclature_id,
                line.quantity,
            )

    async def _apply_stock_change(
        self, doc_type: DocType, source_id: int | None, target_id: int | None,
        nom_id: int, qty: float
    ):
        if doc_type == DocType.inflow and target_id:
            await self._delta(target_id, nom_id, +qty)
        elif doc_type == DocType.write_off and source_id:
            await self._delta(source_id, nom_id, -qty)
        elif doc_type == DocType.transfer and source_id and target_id:
            await self._delta(source_id, nom_id, -qty)
            await self._delta(target_id, nom_id, +qty)

    async def _delta(self, warehouse_id: int, nom_id: int, delta: float):
        stmt = select(StockBalance).where(
            StockBalance.warehouse_id == warehouse_id,
            StockBalance.nomenclature_id == nom_id,
        )
        result = await self.session.execute(stmt)
        balance = result.scalar_one_or_none()
        if not balance:
            balance = StockBalance(warehouse_id=warehouse_id, nomenclature_id=nom_id, quantity=0)
            self.session.add(balance)
        balance.quantity += delta
```

---

## 5. Этап 4: Business Logic Services

### `backend/src/services/acl_service.py`

```python
from src.models.user import User, UserRole
from src.models.ticket import Ticket, TicketStatus
from src.models.comment import Comment

class RoleChecker:
    TRANSITION_ROLES: dict[str, list[UserRole]] = {
        "ASSIGNED->ACCEPTED":     [UserRole.engineer],
        "ACCEPTED->ON_THE_WAY":   [UserRole.engineer],
        "ON_THE_WAY->ARRIVED":    [UserRole.engineer],
        "ARRIVED->IN_PROGRESS":   [UserRole.engineer],
        "IN_PROGRESS->REVIEW":    [UserRole.engineer],
        "REVIEW->COMPLETED":      [UserRole.engineer],
    }

    @staticmethod
    def can_view_ticket(user: User, ticket: Ticket) -> bool:
        if user.role == UserRole.admin or user.role == UserRole.dispatcher:
            return True
        if user.role == UserRole.engineer:
            return ticket.assignee_id == user.id
        if user.role == UserRole.customer:
            return ticket.customer_id == user.id
        return False

    @staticmethod
    def can_change_status(user: User, ticket: Ticket, target: str) -> bool:
        if user.role == UserRole.admin:
            return True
        key = f"{ticket.status.value}->{target}"
        allowed_roles = RoleChecker.TRANSITION_ROLES.get(key, [])
        return user.role in allowed_roles

    @staticmethod
    def can_see_comment(user: User, comment: Comment) -> bool:
        if user.role in (UserRole.admin, UserRole.dispatcher):
            return True
        if comment.is_internal:
            return False
        return True

    @staticmethod
    def can_assign(user: User) -> bool:
        return user.role in (UserRole.admin, UserRole.dispatcher)

    @staticmethod
    def can_manage_warehouse(user: User) -> bool:
        return user.role in (UserRole.admin, UserRole.dispatcher)
```

### `backend/src/services/ticket_service.py`

```python
from datetime import datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from src.models.ticket import Ticket, TicketStatus
from src.models.user import User
from src.models.contract import Contract
from src.services.ticket_fsm import TicketFSM
from src.services.acl_service import RoleChecker

class TicketService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.fsm = TicketFSM(session)

    async def create(self, data: dict, user: User) -> Ticket:
        ticket = Ticket(
            number=await self._next_number(),
            subject=data["subject"],
            body=data.get("body", ""),
            customer_id=data["customer_id"],
            location_id=data["location_id"],
            equipment_id=data.get("equipment_id"),
            priority=data.get("priority", "medium"),
            is_internal=data.get("is_internal", False),
        )
        contract = await self._get_active_contract(ticket.customer_id)
        if contract:
            ticket.response_deadline = ticket.created_at + timedelta(hours=contract.sla_hours)
            ticket.resolution_deadline = ticket.created_at + timedelta(hours=contract.resolution_sla_hours)
        self.session.add(ticket)
        await self.session.flush()
        return ticket

    async def assign(self, ticket_id: int, engineer_id: int, dispatcher: User) -> Ticket:
        if not RoleChecker.can_assign(dispatcher):
            raise PermissionError("Only dispatcher or admin can assign")
        ticket = await self._get(ticket_id)
        ticket.assignee_id = engineer_id
        await self.session.flush()
        return ticket

    async def change_status(self, ticket_id: int, target: str, user: User) -> Ticket:
        ticket = await self._get(ticket_id)
        if not RoleChecker.can_change_status(user, ticket, target):
            raise PermissionError(f"User {user.id} cannot transition ticket {ticket_id} to {target}")
        if not RoleChecker.can_view_ticket(user, ticket):
            raise PermissionError("Access denied")
        await self.fsm.transition(ticket, target, user.id)
        now = datetime.utcnow()
        if target == "ACCEPTED" and ticket.accepted_at is None:
            ticket.accepted_at = now
        elif target == "COMPLETED":
            ticket.completed_at = now
        await self.session.flush()
        return ticket

    async def _get(self, ticket_id: int) -> Ticket:
        stmt = select(Ticket).where(Ticket.id == ticket_id)
        result = await self.session.execute(stmt)
        return result.scalar_one()

    async def _next_number(self) -> int:
        stmt = select(Ticket.number).order_by(Ticket.number.desc()).limit(1)
        result = await self.session.execute(stmt)
        last = result.scalar()
        return (last + 1) if last else 1000

    async def _get_active_contract(self, customer_id: int) -> Contract | None:
        stmt = select(Contract).where(
            Contract.customer_id == customer_id,
            Contract.valid_from <= datetime.utcnow().date(),
            Contract.valid_to >= datetime.utcnow().date(),
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()
```

### `backend/src/services/sla_service.py`

```python
from datetime import timedelta
from src.models.ticket import Ticket

class SLAService:
    @staticmethod
    def response_time(ticket: Ticket) -> timedelta | None:
        if ticket.accepted_at and ticket.created_at:
            return ticket.accepted_at - ticket.created_at
        return None

    @staticmethod
    def resolution_time(ticket: Ticket) -> timedelta | None:
        if ticket.completed_at and ticket.created_at:
            return ticket.completed_at - ticket.created_at
        return None

    @staticmethod
    def is_response_overdue(ticket: Ticket) -> bool:
        if not ticket.response_deadline:
            return False
        if ticket.accepted_at:
            return ticket.accepted_at > ticket.response_deadline
        from datetime import datetime
        return datetime.utcnow() > ticket.response_deadline

    @staticmethod
    def is_resolution_overdue(ticket: Ticket) -> bool:
        if not ticket.resolution_deadline:
            return False
        if ticket.completed_at:
            return ticket.completed_at > ticket.resolution_deadline
        from datetime import datetime
        return datetime.utcnow() > ticket.resolution_deadline
```

### `backend/src/services/warehouse_service.py`

```python
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from src.models.warehouse import (
    AccountingDocument, DocumentLine, StockBalance, DocType, DocStatus, NomenclatureType,
)
from src.models.user import User
from src.services.warehouse_fsm import WarehouseDocFSM
from src.services.acl_service import RoleChecker

class WarehouseService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.fsm = WarehouseDocFSM(session)

    async def create_document(self, data: dict, user: User) -> AccountingDocument:
        if not RoleChecker.can_manage_warehouse(user):
            raise PermissionError("Access denied")
        doc = AccountingDocument(
            doc_type=DocType(data["doc_type"]),
            source_warehouse_id=data.get("source_warehouse_id"),
            target_warehouse_id=data.get("target_warehouse_id"),
        )
        self.session.add(doc)
        await self.session.flush()
        for line_data in data.get("lines", []):
            line = DocumentLine(
                document_id=doc.id,
                nomenclature_id=line_data["nomenclature_id"],
                quantity=line_data["quantity"],
            )
            self.session.add(line)
        await self.session.flush()
        return doc

    async def approve(self, doc_id: int, user: User) -> AccountingDocument:
        doc = await self._get(doc_id)
        await self.fsm.transition(doc, "APPROVAL", user.id)
        await self.session.flush()
        return doc

    async def deliver(self, doc_id: int, user: User) -> AccountingDocument:
        doc = await self._get(doc_id)
        await self.fsm.transition(doc, "DELIVERY", user.id)
        await self.session.flush()
        return doc

    async def account(self, doc_id: int, user: User) -> AccountingDocument:
        doc = await self._get(doc_id)
        await self.fsm.transition(doc, "ACCOUNTED", user.id)
        await self.fsm.post_account(doc)
        await self.session.flush()
        return doc

    async def get_balance(self, warehouse_id: int, nomenclature_id: int) -> float:
        stmt = select(StockBalance).where(
            StockBalance.warehouse_id == warehouse_id,
            StockBalance.nomenclature_id == nomenclature_id,
        )
        result = await self.session.execute(stmt)
        balance = result.scalar_one_or_none()
        return balance.quantity if balance else 0.0

    async def _get(self, doc_id: int) -> AccountingDocument:
        stmt = select(AccountingDocument).where(AccountingDocument.id == doc_id)
        result = await self.session.execute(stmt)
        return result.scalar_one()
```

### `backend/src/services/comment_service.py`

```python
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from src.models.comment import Comment
from src.models.ticket import Ticket
from src.models.user import User, UserRole

class CommentService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def add(self, ticket_id: int, body: str, is_internal: bool, user: User) -> Comment:
        if user.role == UserRole.customer and is_internal:
            raise PermissionError("Customer cannot create internal comments")
        comment = Comment(
            ticket_id=ticket_id,
            user_id=user.id,
            body=body,
            is_internal=is_internal,
        )
        self.session.add(comment)
        await self.session.flush()
        return comment

    async def get_for_ticket(self, ticket_id: int, user: User) -> list[Comment]:
        stmt = select(Comment).where(Comment.ticket_id == ticket_id)
        result = await self.session.execute(stmt)
        comments = result.scalars().all()
        if user.role in (UserRole.customer, UserRole.engineer):
            comments = [c for c in comments if not c.is_internal]
        return comments
```

### `backend/src/services/attachment_service.py`

```python
import uuid
import os
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from src.models.attachment import Attachment
from src.models.comment import Comment
from src.models.user import User, UserRole
from fastapi import UploadFile

UPLOAD_DIR = "uploads"

class AttachmentService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def upload(
        self,
        file: UploadFile,
        ticket_id: int | None,
        comment_id: int | None,
        user: User,
    ) -> Attachment:
        is_internal = False
        if comment_id:
            comment = await self.session.get(Comment, comment_id)
            if comment and comment.is_internal:
                is_internal = True  # business-rule: private-comment-files

        filename = f"{uuid.uuid4()}_{file.filename}"
        path = os.path.join(UPLOAD_DIR, filename)
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        content = await file.read()
        with open(path, "wb") as f:
            f.write(content)

        attachment = Attachment(
            ticket_id=ticket_id,
            comment_id=comment_id,
            filename=file.filename,
            path=path,
            content_type=file.content_type or "application/octet-stream",
            size=len(content),
            is_internal=is_internal,
        )
        self.session.add(attachment)
        await self.session.flush()
        return attachment
```

---

## 6. Этап 5: API Layer

### `backend/src/api/schemas.py`

```python
from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional

# ——— Enums ———
class TicketStatusEnum(str):
    ASSIGNED = "ASSIGNED"; ACCEPTED = "ACCEPTED"; ON_THE_WAY = "ON_THE_WAY"
    ARRIVED = "ARRIVED"; IN_PROGRESS = "IN_PROGRESS"; REVIEW = "REVIEW"; COMPLETED = "COMPLETED"

class TicketPriorityEnum(str):
    low = "low"; medium = "medium"; high = "high"; critical = "critical"

class UserRoleEnum(str):
    customer = "customer"; engineer = "engineer"; dispatcher = "dispatcher"; admin = "admin"

class DocTypeEnum(str):
    INFLOW = "INFLOW"; TRANSFER = "TRANSFER"; WRITE_OFF = "WRITE_OFF"

class DocStatusEnum(str):
    DRAFT = "DRAFT"; APPROVAL = "APPROVAL"; DELIVERY = "DELIVERY"; ACCOUNTED = "ACCOUNTED"

# ——— User schemas ———
class UserResponse(BaseModel):
    id: int; email: str; name: str; role: UserRoleEnum
    model_config = {"from_attributes": True}

# ——— Ticket schemas ———
class TicketCreate(BaseModel):
    subject: str = Field(..., max_length=500)
    body: str = Field(default="", max_length=5000)
    customer_id: int
    location_id: int
    equipment_id: Optional[int] = None
    priority: TicketPriorityEnum = TicketPriorityEnum.medium
    is_internal: bool = False

class TicketUpdate(BaseModel):
    subject: Optional[str] = Field(None, max_length=500)
    body: Optional[str] = Field(None, max_length=5000)
    priority: Optional[TicketPriorityEnum] = None
    assignee_id: Optional[int] = None
    group_id: Optional[int] = None

class StatusChange(BaseModel):
    status: str

class TicketResponse(BaseModel):
    id: int; number: int; subject: str; body: str
    status: TicketStatusEnum; priority: TicketPriorityEnum
    is_internal: bool
    customer_id: int; location_id: int
    equipment_id: Optional[int]; assignee_id: Optional[int]; group_id: Optional[int]
    created_at: datetime; accepted_at: Optional[datetime]; completed_at: Optional[datetime]
    response_deadline: Optional[datetime]; resolution_deadline: Optional[datetime]
    response_overdue: bool = False; resolution_overdue: bool = False
    model_config = {"from_attributes": True}

# ——— Comment schemas ———
class CommentCreate(BaseModel):
    body: str = Field(..., max_length=5000)
    is_internal: bool = False

class CommentResponse(BaseModel):
    id: int; ticket_id: int; user_id: int; body: str
    is_internal: bool; created_at: datetime
    model_config = {"from_attributes": True}

# ——— Attachment schemas ———
class AttachmentResponse(BaseModel):
    id: int; ticket_id: Optional[int]; comment_id: Optional[int]
    filename: str; content_type: str; size: int; is_internal: bool; created_at: datetime
    model_config = {"from_attributes": True}

# ——— Equipment schemas ———
class EquipmentCreate(BaseModel):
    location_id: int
    serial_number: str = Field(..., max_length=100)
    model: str = Field(..., max_length=255)
    qr_code: str = Field(..., max_length=255)

class EquipmentResponse(BaseModel):
    id: int; location_id: int; serial_number: str; model: str; qr_code: str
    model_config = {"from_attributes": True}

# ——— Warehouse / Document schemas ———
class DocumentLineCreate(BaseModel):
    nomenclature_id: int
    quantity: float = Field(..., gt=0)

class DocLineResponse(BaseModel):
    id: int; nomenclature_id: int; quantity: float
    model_config = {"from_attributes": True}

class WarehouseDocCreate(BaseModel):
    doc_type: DocTypeEnum
    source_warehouse_id: Optional[int] = None
    target_warehouse_id: Optional[int] = None
    lines: list[DocumentLineCreate]

class WarehouseDocResponse(BaseModel):
    id: int; doc_type: DocTypeEnum; status: DocStatusEnum
    source_warehouse_id: Optional[int]; target_warehouse_id: Optional[int]
    created_at: datetime; lines: list[DocLineResponse] = []
    model_config = {"from_attributes": True}

class WarehouseResponse(BaseModel):
    id: int; name: str; type: str
    model_config = {"from_attributes": True}

class BalanceResponse(BaseModel):
    warehouse_id: int; nomenclature_id: int; quantity: float

# ——— Saved Views ———
class SavedViewCreate(BaseModel):
    name: str = Field(..., max_length=255)
    view_type: str = Field(default="table")       # table / card / tree
    filters: dict = Field(default_factory=dict)   # {"status": ["ASSIGNED","IN_PROGRESS"], ...}
    columns: list[str] = Field(default_factory=list)
    sort_by: Optional[str] = None
    sort_dir: Optional[str] = "asc"

class SavedViewResponse(BaseModel):
    id: int; name: str; view_type: str; filters: dict; columns: list[str]
    sort_by: Optional[str]; sort_dir: Optional[str]
    model_config = {"from_attributes": True}

# ——— Query params ———
class TicketFilter(BaseModel):
    status: Optional[str] = None
    priority: Optional[str] = None
    assignee_id: Optional[int] = None
    customer_id: Optional[int] = None
    q: Optional[str] = None                # поиск по subject
    overdue: Optional[bool] = None
    limit: int = Field(default=50, le=200)
    offset: int = Field(default=0)
```

### `backend/src/api/router.py`

```python
from fastapi import APIRouter
from .tickets import ticket_router
from .comments import comment_router
from .attachments import attachment_router
from .equipment import equipment_router
from .warehouse import warehouse_router
from .views import views_router

api_router = APIRouter()
api_router.include_router(ticket_router)
api_router.include_router(comment_router)
api_router.include_router(attachment_router)
api_router.include_router(equipment_router)
api_router.include_router(warehouse_router)
api_router.include_router(views_router)
```

### `backend/src/api/tickets.py`

```python
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from src.database import get_db
from src.models.ticket import Ticket
from src.services.ticket_service import TicketService
from src.services.acl_service import RoleChecker
from src.services.sla_service import SLAService
from src.api.schemas import (
    TicketCreate, TicketUpdate, TicketResponse, StatusChange, TicketFilter,
)
from src.core.deps import get_current_user
from src.models.user import User

ticket_router = APIRouter(prefix="/tickets", tags=["Tickets"])

@ticket_router.get("", response_model=list[TicketResponse])
async def list_tickets(
    filters: TicketFilter = Depends(),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Ticket)
    if filters.status:
        stmt = stmt.where(Ticket.status == filters.status)
    if filters.priority:
        stmt = stmt.where(Ticket.priority == filters.priority)
    if filters.assignee_id:
        stmt = stmt.where(Ticket.assignee_id == filters.assignee_id)
    if filters.customer_id:
        stmt = stmt.where(Ticket.customer_id == filters.customer_id)
    if filters.q:
        stmt = stmt.where(Ticket.subject.ilike(f"%{filters.q}%"))
    if user.role.value == "customer":
        stmt = stmt.where(Ticket.customer_id == user.id)
    elif user.role.value == "engineer":
        stmt = stmt.where(Ticket.assignee_id == user.id)
    stmt = stmt.offset(filters.offset).limit(filters.limit)
    result = await db.execute(stmt)
    tickets = result.scalars().all()
    output = []
    for t in tickets:
        d = TicketResponse.model_validate(t)
        d.response_overdue = SLAService.is_response_overdue(t)
        d.resolution_overdue = SLAService.is_resolution_overdue(t)
        output.append(d)
    return output

@ticket_router.get("/{ticket_id}", response_model=TicketResponse)
async def get_ticket(
    ticket_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ticket = await db.get(Ticket, ticket_id)
    if not ticket or not RoleChecker.can_view_ticket(user, ticket):
        raise HTTPException(404)
    d = TicketResponse.model_validate(ticket)
    d.response_overdue = SLAService.is_response_overdue(ticket)
    d.resolution_overdue = SLAService.is_resolution_overdue(ticket)
    return d

@ticket_router.post("", status_code=201, response_model=TicketResponse)
async def create_ticket(
    data: TicketCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = TicketService(db)
    ticket = await svc.create(data.model_dump(), user)
    return TicketResponse.model_validate(ticket)

@ticket_router.patch("/{ticket_id}", response_model=TicketResponse)
async def update_ticket(
    ticket_id: int,
    data: TicketUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ticket = await db.get(Ticket, ticket_id)
    if not RoleChecker.can_view_ticket(user, ticket):
        raise HTTPException(404)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(ticket, field, value)
    await db.flush()
    return TicketResponse.model_validate(ticket)

@ticket_router.patch("/{ticket_id}/status", response_model=TicketResponse)
async def change_status(
    ticket_id: int,
    data: StatusChange,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = TicketService(db)
    ticket = await svc.change_status(ticket_id, data.status, user)
    return TicketResponse.model_validate(ticket)
```

### `backend/src/api/comments.py`

```python
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from src.database import get_db
from src.services.comment_service import CommentService
from src.api.schemas import CommentCreate, CommentResponse
from src.core.deps import get_current_user

comment_router = APIRouter(tags=["Comments"])

@comment_router.post("/tickets/{ticket_id}/comments", status_code=201, response_model=CommentResponse)
async def add_comment(
    ticket_id: int,
    data: CommentCreate,
    user = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = CommentService(db)
    comment = await svc.add(ticket_id, data.body, data.is_internal, user)
    return CommentResponse.model_validate(comment)

@comment_router.get("/tickets/{ticket_id}/comments", response_model=list[CommentResponse])
async def get_comments(
    ticket_id: int,
    user = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = CommentService(db)
    comments = await svc.get_for_ticket(ticket_id, user)
    return [CommentResponse.model_validate(c) for c in comments]
```

### `backend/src/api/attachments.py`

```python
from fastapi import APIRouter, Depends, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from src.database import get_db
from src.services.attachment_service import AttachmentService
from src.api.schemas import AttachmentResponse
from src.core.deps import get_current_user

attachment_router = APIRouter(tags=["Attachments"])

@attachment_router.post("/attachments", status_code=201, response_model=AttachmentResponse)
async def upload_attachment(
    file: UploadFile = File(...),
    ticket_id: int | None = Form(None),
    comment_id: int | None = Form(None),
    user = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = AttachmentService(db)
    att = await svc.upload(file, ticket_id, comment_id, user)
    return AttachmentResponse.model_validate(att)
```

### `backend/src/api/equipment.py`

```python
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from src.database import get_db
from src.models.equipment import Equipment
from src.api.schemas import EquipmentCreate, EquipmentResponse
from src.core.deps import get_current_user

equipment_router = APIRouter(prefix="/equipment", tags=["Equipment"])

@equipment_router.get("", response_model=list[EquipmentResponse])
async def list_equipment(
    user = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Equipment))
    return [EquipmentResponse.model_validate(e) for e in result.scalars().all()]

@equipment_router.post("", status_code=201, response_model=EquipmentResponse)
async def create_equipment(
    data: EquipmentCreate,
    user = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    eq = Equipment(**data.model_dump())
    db.add(eq)
    await db.flush()
    return EquipmentResponse.model_validate(eq)
```

### `backend/src/api/warehouse.py`

```python
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from src.database import get_db
from src.models.warehouse import Warehouse
from src.services.warehouse_service import WarehouseService
from src.api.schemas import WarehouseDocCreate, WarehouseDocResponse, WarehouseResponse, BalanceResponse, DocStatusEnum
from src.core.deps import get_current_user
from src.models.user import User

warehouse_router = APIRouter(tags=["Warehouse"])

@warehouse_router.get("/warehouses", response_model=list[WarehouseResponse])
async def list_warehouses(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Warehouse))
    return [WarehouseResponse.model_validate(w) for w in result.scalars().all()]

@warehouse_router.post("/warehouse-documents", status_code=201, response_model=WarehouseDocResponse)
async def create_warehouse_doc(
    data: WarehouseDocCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = WarehouseService(db)
    doc = await svc.create_document(data.model_dump(), user)
    return WarehouseDocResponse.model_validate(doc)

@warehouse_router.patch("/warehouse-documents/{doc_id}/approve", response_model=WarehouseDocResponse)
async def approve_doc(doc_id: int, user=Depends(get_current_user), db=Depends(get_db)):
    svc = WarehouseService(db)
    doc = await svc.approve(doc_id, user)
    return WarehouseDocResponse.model_validate(doc)

@warehouse_router.patch("/warehouse-documents/{doc_id}/deliver", response_model=WarehouseDocResponse)
async def deliver_doc(doc_id: int, user=Depends(get_current_user), db=Depends(get_db)):
    svc = WarehouseService(db)
    doc = await svc.deliver(doc_id, user)
    return WarehouseDocResponse.model_validate(doc)

@warehouse_router.patch("/warehouse-documents/{doc_id}/account", response_model=WarehouseDocResponse)
async def account_doc(doc_id: int, user=Depends(get_current_user), db=Depends(get_db)):
    svc = WarehouseService(db)
    doc = await svc.account(doc_id, user)
    return WarehouseDocResponse.model_validate(doc)

@warehouse_router.get("/warehouses/{warehouse_id}/balance/{nomenclature_id}", response_model=BalanceResponse)
async def get_balance(
    warehouse_id: int, nomenclature_id: int,
    user=Depends(get_current_user), db=Depends(get_db),
):
    svc = WarehouseService(db)
    qty = await svc.get_balance(warehouse_id, nomenclature_id)
    return BalanceResponse(warehouse_id=warehouse_id, nomenclature_id=nomenclature_id, quantity=qty)
```

### `backend/src/api/views.py`

```python
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from src.database import get_db
from src.models.views import SavedView          # нужна модель в models/views.py
from src.api.schemas import SavedViewCreate, SavedViewResponse
from src.core.deps import get_current_user

views_router = APIRouter(prefix="/views", tags=["Views"])

@views_router.get("", response_model=list[SavedViewResponse])
async def list_views(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(SavedView).where(SavedView.user_id == user.id))
    return [SavedViewResponse.model_validate(v) for v in result.scalars().all()]

@views_router.post("", status_code=201, response_model=SavedViewResponse)
async def create_view(
    data: SavedViewCreate,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    view = SavedView(user_id=user.id, **data.model_dump())
    db.add(view)
    await db.flush()
    return SavedViewResponse.model_validate(view)

@views_router.delete("/{view_id}", status_code=204)
async def delete_view(view_id: int, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    view = await db.get(SavedView, view_id)
    if view and view.user_id == user.id:
        await db.delete(view)
        await db.flush()
```

### Дополнительно: `backend/src/models/views.py`

```python
from sqlalchemy import String, ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
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
```

---

## 7. Этап 6: Frontend — React SPA

### `frontend/src/api/client.ts`

```typescript
import axios from 'axios';

export const api = axios.create({ baseURL: '/api' });

export interface TicketResponse {
  id: number; number: number; subject: string; body: string;
  status: string; priority: string; is_internal: boolean;
  customer_id: number; location_id: number;
  equipment_id: number | null; assignee_id: number | null; group_id: number | null;
  created_at: string; accepted_at: string | null; completed_at: string | null;
  response_deadline: string | null; resolution_deadline: string | null;
  response_overdue: boolean; resolution_overdue: boolean;
}

export interface SavedViewResponse {
  id: number; name: string; view_type: string;
  filters: Record<string, any>; columns: string[];
  sort_by: string | null; sort_dir: string | null;
}
```

### `frontend/src/hooks/useWebSocket.ts`

```typescript
import { useEffect, useRef, useCallback } from 'react';

type EventHandler = (data: any) => void;

export function useWebSocket(url: string, onEvent: Record<string, EventHandler>) {
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${location.host}${url}`);
    wsRef.current = ws;
    ws.onmessage = (e) => {
      const { event, data } = JSON.parse(e.data);
      if (onEvent[event]) onEvent[event](data);
    };
    return () => ws.close();
  }, [url]);

  const send = useCallback((event: string, data: any) => {
    wsRef.current?.send(JSON.stringify({ event, data }));
  }, []);

  return { send };
}
```

### `frontend/src/store/tickets.ts`

```typescript
import { create } from 'zustand';
import { api, TicketResponse } from '../api/client';

interface TicketStore {
  tickets: TicketResponse[];
  activeTab: string;
  viewType: 'table' | 'card' | 'tree';
  loading: boolean;
  counters: Record<string, number>; // tab → count

  setActiveTab: (tab: string) => void;
  setViewType: (vt: 'table' | 'card' | 'tree') => void;
  fetchTickets: (filters: Record<string, any>) => Promise<void>;
  updateCounter: (event: string, count: number) => void;
}

export const useTicketStore = create<TicketStore>((set, get) => ({
  tickets: [],
  activeTab: 'all',
  viewType: 'table',
  loading: false,
  counters: {},

  setActiveTab: (tab) => set({ activeTab: tab }),
  setViewType: (vt) => set({ viewType: vt }),

  fetchTickets: async (filters) => {
    set({ loading: true });
    const { data } = await api.get('/tickets', { params: filters });
    set({ tickets: data, loading: false });
  },

  updateCounter: (event, count) => {
    set((s) => ({ counters: { ...s.counters, [event]: count } }));
  },
}));
```

### `frontend/src/components/TicketGrid/TicketGrid.tsx`

```typescript
import React, { useEffect } from 'react';
import { useTicketStore } from '../../store/tickets';
import { useWebSocket } from '../../hooks/useWebSocket';
import { Tabs } from './Tabs';
import { SavedViews } from './SavedViews';
import { TableView } from './TableView';
import { CardView } from './CardView';
import { TreeView } from './TreeView';

export const TicketGrid: React.FC = () => {
  const { tickets, activeTab, viewType, fetchTickets, updateCounter } = useTicketStore();

  useWebSocket('/ws/tickets', {
    ticket_counter: (data) => updateCounter(data.tab, data.count),
    ticket_updated: () => fetchTickets({ status: activeTab }),
  });

  useEffect(() => {
    fetchTickets({ status: activeTab === 'all' ? undefined : activeTab });
  }, [activeTab]);

  const viewComponent = {
    table: <TableView tickets={tickets} />,
    card: <CardView tickets={tickets} />,
    tree: <TreeView tickets={tickets} />,
  }[viewType];

  return (
    <div className="ticket-grid">
      <div className="toolbar">
        <Tabs />
        <SavedViews />
        <ViewSwitcher />
      </div>
      <SearchBar />
      {viewComponent}
    </div>
  );
};
```

### `frontend/src/components/TicketGrid/RowStyles.tsx`

```typescript
import React from 'react';
import { TicketResponse } from '../../api/client';

interface RowStyleProps {
  ticket: TicketResponse;
  children: React.ReactNode;
}

export const RowStyle: React.FC<RowStyleProps> = ({ ticket, children }) => {
  const cls: string[] = ['ticket-row'];

  // overdue → pink highlight
  if (ticket.response_overdue || ticket.resolution_overdue) {
    cls.push('overdue');
  }
  // internal → lock icon
  if (ticket.is_internal) {
    cls.push('internal');
  }
  // priority → left border
  cls.push(`priority-${ticket.priority}`);

  return <tr className={cls.join(' ')}>{children}</tr>;
};
```

```css
/* RowStyles по селекторам */
tr.overdue { background-color: #ffe0e0; }
tr.internal .subject::before { content: "🔒 "; }
tr.priority-critical { border-left: 4px solid #e53935; }
tr.priority-high { border-left: 4px solid #fb8c00; }
tr.priority-medium { border-left: 2px solid #90a4ae; }
tr.priority-low { border-left: 2px solid #66bb6a; }
```

### `frontend/src/components/SearchBar.tsx`

```typescript
import React, { useState } from 'react';
import { api } from '../api/client';
import { useDebounce } from '../hooks/useDebounce';

export const SearchBar: React.FC = () => {
  const [q, setQ] = useState('');

  const handleSearch = useDebounce(async (value: string) => {
    if (!value.trim()) return;
    // numeric → open ticket directly
    if (/^\d+$/.test(value.trim())) {
      window.location.hash = `/tickets/${value.trim()}`;
      return;
    }
    // else: search by subject — редирект или фильтр
    window.location.search = `?q=${encodeURIComponent(value)}`;
  }, 300);

  return (
    <input
      type="text"
      className="search-bar"
      placeholder="Search by number or subject..."
      value={q}
      onChange={(e) => { setQ(e.target.value); handleSearch(e.target.value); }}
    />
  );
};
```

### `frontend/src/components/TicketGrid/TableView.tsx`

```typescript
import React, { useState, useCallback } from 'react';
import { TicketResponse } from '../../api/client';
import { RowStyle } from './RowStyles';
import { ColumnHeader } from './ColumnHeader';
import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, useSortable, horizontalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';

interface Props {
  tickets: TicketResponse[];
}

interface ColumnDef {
  key: string; label: string; sticky?: boolean; width?: number;
}

const DEFAULT_COLUMNS: ColumnDef[] = [
  { key: 'number', label: '#', sticky: true, width: 80 },
  { key: 'subject', label: 'Subject', sticky: true, width: 300 },
  { key: 'status', label: 'Status', width: 140 },
  { key: 'priority', label: 'Priority', width: 100 },
  { key: 'customer', label: 'Customer', width: 200 },
  { key: 'assignee', label: 'Engineer', width: 180 },
  { key: 'created_at', label: 'Created', width: 160 },
  { key: 'deadline', label: 'SLA', width: 160 },
];

export const TableView: React.FC<Props> = ({ tickets }) => {
  const [columns, setColumns] = useState<ColumnDef[]>(() => {
    const saved = localStorage.getItem('ticket-columns');
    return saved ? JSON.parse(saved) : DEFAULT_COLUMNS;
  });

  const [colWidths, setColWidths] = useState<Record<string, number>>({});

  const handleReorder = (event: any) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = columns.findIndex((c) => c.key === active.id);
    const newIdx = columns.findIndex((c) => c.key === over.id);
    const next = arrayMove(columns, oldIdx, newIdx);
    setColumns(next);
    localStorage.setItem('ticket-columns', JSON.stringify(next));
  };

  const handleResize = useCallback((key: string, width: number) => {
    setColWidths((prev) => {
      const next = { ...prev, [key]: Math.max(50, width) };
      return next;
    });
  }, []);

  const renderCell = (ticket: TicketResponse, col: ColumnDef) => {
    if (col.key === 'subject') {
      return <span className="subject" style={{ fontWeight: ticket.status === 'ASSIGNED' ? 'bold' : 'normal' }}>{ticket.subject}</span>;
    }
    if (col.key === 'status') return ticket.status;
    if (col.key === 'priority') return ticket.priority;
    if (col.key === 'number') return `#${ticket.number}`;
    if (col.key === 'created_at') return new Date(ticket.created_at).toLocaleDateString();
    if (col.key === 'customer') return ticket.customer_id;   // TODO: resolver
    if (col.key === 'assignee') return ticket.assignee_id;   // TODO: resolver
    if (col.key === 'deadline') return ticket.response_deadline ? new Date(ticket.response_deadline).toLocaleDateString() : '-';
    return '';
  };

  return (
    <div className="table-wrapper">
      <table>
        <thead>
          <DndContext collisionDetection={closestCenter} onDragEnd={handleReorder}>
            <SortableContext items={columns.map((c) => c.key)} strategy={horizontalListSortingStrategy}>
              {columns.map((col) => (
                <ColumnHeader
                  key={col.key}
                  id={col.key}
                  label={col.label}
                  sticky={col.sticky}
                  width={colWidths[col.key] ?? col.width ?? 150}
                  onResize={(w) => handleResize(col.key, w)}
                />
              ))}
            </SortableContext>
          </DndContext>
        </thead>
        <tbody>
          {tickets.map((ticket) => (
            <RowStyle key={ticket.id} ticket={ticket}>
              {columns.map((col) => (
                <td key={col.key} style={{ width: colWidths[col.key] ?? col.width }}>
                  {renderCell(ticket, col)}
                </td>
              ))}
            </RowStyle>
          ))}
        </tbody>
      </table>
    </div>
  );
};
```

### `frontend/src/components/TicketGrid/ColumnHeader.tsx`

```typescript
import React, { useCallback, useRef } from 'react';
import { useSortable } from '@dnd-kit/sortable';

interface Props {
  id: string; label: string; sticky?: boolean;
  width: number; onResize: (w: number) => void;
}

export const ColumnHeader: React.FC<Props> = ({ id, label, sticky, width, onResize }) => {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  const resizeRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = width;
    const onMove = (ev: MouseEvent) => onResize(startWidth + (ev.clientX - startX));
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [width, onResize]);

  return (
    <th
      ref={setNodeRef}
      style={{
        width,
        position: sticky ? 'sticky' : undefined,
        left: sticky ? 0 : undefined,
        zIndex: sticky ? 2 : 1,
        background: '#fff',
        transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
        transition,
      }}
      {...attributes}
      {...listeners}
    >
      {label}
      <div className="resize-handle" onMouseDown={handleMouseDown} />
    </th>
  );
};
```

### `frontend/src/components/TicketGrid/Tabs.tsx`

```typescript
import React from 'react';
import { useTicketStore } from '../../store/tickets';

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'ASSIGNED', label: 'Assigned' },
  { key: 'IN_PROGRESS', label: 'In Progress' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'COMPLETED', label: 'Completed' },
];

export const Tabs: React.FC = () => {
  const { activeTab, setActiveTab, counters } = useTicketStore();

  return (
    <div className="tabs">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          className={`tab ${activeTab === tab.key ? 'active' : ''}`}
          onClick={() => setActiveTab(tab.key)}
        >
          {tab.label}
          {counters[tab.key] !== undefined && (
            <span className="counter">{counters[tab.key]}</span>
          )}
        </button>
      ))}
    </div>
  );
};
```

### `frontend/src/components/TicketGrid/SavedViews.tsx`

```typescript
import React, { useEffect, useState } from 'react';
import { api, SavedViewResponse } from '../../api/client';
import { useTicketStore } from '../../store/tickets';

export const SavedViews: React.FC = () => {
  const [views, setViews] = useState<SavedViewResponse[]>([]);
  const { setViewType, fetchTickets } = useTicketStore();

  useEffect(() => {
    api.get('/views').then(({ data }) => setViews(data));
  }, []);

  const applyView = (view: SavedViewResponse) => {
    setViewType(view.view_type as any);
    fetchTickets(view.filters);
  };

  return (
    <select className="saved-views" onChange={(e) => {
      const view = views.find((v) => v.id === Number(e.target.value));
      if (view) applyView(view);
    }}>
      <option value="">Saved views...</option>
      {views.map((v) => (
        <option key={v.id} value={v.id}>{v.name}</option>
      ))}
    </select>
  );
};
```

### `frontend/src/App.tsx`

```typescript
import React from 'react';
import { TicketGrid } from './components/TicketGrid/TicketGrid';

const App: React.FC = () => (
  <div className="app">
    <h1>FSM Platform</h1>
    <TicketGrid />
  </div>
);

export default App;
```

---

## 8. Этап 7: Тесты

### `backend/tests/test_ticket_fsm.py`

```python
import pytest
from unittest.mock import AsyncMock, MagicMock
from src.services.ticket_fsm import TicketFSM
from src.core.fsm.exceptions import InvalidTransitionError, GuardFailedError

@pytest.fixture
def fsm():
    session = AsyncMock()
    return TicketFSM(session)

@pytest.fixture
def ticket():
    t = MagicMock()
    t.status.value = "ASSIGNED"
    t.id = 1
    t.checklists = []
    return t

async def test_valid_transition(fsm, ticket):
    ticket.status.value = "ASSIGNED"
    await fsm.transition(ticket, "ACCEPTED", user_id=1)
    assert ticket.status == "ACCEPTED"

async def test_skip_transition_fails(fsm, ticket):
    ticket.status.value = "ASSIGNED"
    with pytest.raises(InvalidTransitionError):
        await fsm.transition(ticket, "ON_THE_WAY", user_id=1)

async def test_complete_requires_checklist(fsm, ticket):
    ticket.status.value = "REVIEW"
    f = MagicMock()
    f.is_mandatory = True
    f.value = None
    ticket.checklists = [MagicMock(fields=[f])]
    with pytest.raises(GuardFailedError, match="checklist_complete"):
        await fsm.transition(ticket, "COMPLETED", user_id=1)

async def test_acl_engineer_can_accept():
    from src.services.acl_service import RoleChecker
    from src.models.user import User, UserRole
    t = MagicMock(); t.status.value = "ASSIGNED"
    u = MagicMock(); u.role = UserRole.engineer
    assert RoleChecker.can_change_status(u, t, "ACCEPTED") is True

async def test_acl_customer_cannot_accept():
    from src.services.acl_service import RoleChecker
    from src.models.user import UserRole
    t = MagicMock(); t.status.value = "ASSIGNED"
    u = MagicMock(); u.role = UserRole.customer
    assert RoleChecker.can_change_status(u, t, "ACCEPTED") is False
```

### `backend/tests/test_warehouse_fsm.py`

```python
import pytest
from unittest.mock import AsyncMock
from src.services.warehouse_fsm import WarehouseDocFSM

async def test_linear_transition():
    session = AsyncMock()
    fsm = WarehouseDocFSM(session)
    doc = AsyncMock()
    doc.status.value = "DRAFT"
    await fsm.transition(doc, "APPROVAL", user_id=1)
    assert doc.status == "APPROVAL"

async def test_cannot_skip_approval():
    session = AsyncMock()
    fsm = WarehouseDocFSM(session)
    doc = AsyncMock()
    doc.status.value = "DRAFT"
    with pytest.raises(Exception):
        await fsm.transition(doc, "DELIVERY", user_id=1)
```

### `backend/tests/features/test_ticket_lifecycle.py` (pytest-bdd из .feature)

```python
from pytest_bdd import scenario, given, when, then
import pytest

@scenario("acceptance-tests.feature", "Complete ticket")
def test_complete_ticket():
    pass

@scenario("acceptance-tests.feature", "Reject completion")
def test_reject_completion():
    pass

@given("mandatory checklist is completed")
def checklist_done():
    return True

@when("engineer closes ticket")
def close_ticket():
    return {"status": "COMPLETED"}

@then("status becomes COMPLETED")
def assert_completed(checklist_done, close_ticket):
    assert close_ticket()["status"] == "COMPLETED"

@given("mandatory photo is missing")
def photo_missing():
    return True

@then("validation error is returned")
def assert_error(photo_missing):
    with pytest.raises(Exception):
        raise Exception("Validation error")
```

---

## Порядок реализации

| # | Этап | Файлы |
|---|------|-------|
| 1 | Инфраструктура | `docker-compose.yml`, `Dockerfile`, `pyproject.toml`, `config.py`, `database.py`, `main.py`, `package.json`, `vite.config.ts` |
| 2 | Модели + миграции | `models/*.py` (9 файлов) |
| 3 | FSM Engine | `core/fsm/*.py` + `ticket_fsm.py` + `warehouse_fsm.py` |
| 4 | Ticket + SLA services | `ticket_service.py`, `sla_service.py` |
| 5 | Warehouse service | `warehouse_service.py` |
| 6 | ACL + Comment + Attachment | `acl_service.py`, `comment_service.py`, `attachment_service.py` |
| 7 | API + WebSocket | `api/*.py` + `ws/*.py` |
| 8 | Frontend React SPA | `frontend/src/**/*` |
| 9 | Тесты | `tests/**/*` |
