# HubDesk — Project Description

## Overview

HubDesk is a modular monolith service management platform for field engineering companies. It manages the full lifecycle of service tickets (repair, maintenance, installation, inspection, verification, emergency), equipment/asset tracking, warehouse inventory, and customer relationships. The system enforces role-based access control, a finite state machine for ticket workflows, and supports email-driven ticket creation.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.12, FastAPI 0.115+, SQLAlchemy 2.0 (async), asyncpg, Alembic, pydantic-settings |
| Frontend | React 18, TypeScript 5.5, Vite 5.4, Zustand 4.5, Axios, @dnd-kit |
| Mobile | React Native 0.76, Expo SDK 52, Zustand 5, React Navigation 7 |
| Database | PostgreSQL 15 (asyncpg driver) |
| Cache | Redis 7 |
| Auth | JWT (python-jose), passlib + bcrypt |
| Build | Docker multi-stage (Node 22 build + Python 3.12-slim runtime), Docker Compose |
| Real-time | WebSocket (FastAPI WebSocket) |

---

## Backend Modules (60 files, ~4800 LOC)

### `src/models/` — SQLAlchemy ORM Models

| File | Purpose |
|------|---------|
| `user.py` | Users, Groups, Roles (admin, director, dispatcher, engineer, storekeeper, customer, viewer, metrologist, accountant), UserStatus enum |
| `ticket.py` | Tickets, TicketTransitions, TicketStatus/TicketPriority enums, FSM state tracking |
| `equipment.py` | AssetLocation (objects/sites), Equipment |
| `customer.py` | Customers, Contracts |
| `warehouse.py` | Warehouse, Nomenclature, AccountingDocument, DocumentLine, StockBalance, enums (WarehouseType, NomenclatureType, DocType, DocStatus) |
| `insert_stock.py` | InsertProduct, InsertTransaction (metrological inserts inventory) |
| `insert_item.py` | InsertItem (metrological insert catalog items) |
| `replacement_device.py` | ReplacementDevice, ReplacementTransaction (device replacement tracking) |
| `checklist.py` | Checklist, ChecklistField, FieldType (mandatory completion checklists) |
| `comment.py` | Ticket comments |
| `attachment.py` | File attachments (tickets, comments) |
| `views.py` | SavedView (custom ticket filters/views) |
| `mailbox.py` | MailboxConfig (email integration settings) |
| `personal_task.py` | PersonalTask (user private tasks) |
| `api_key.py` | ApiKey (external API authentication) |
| `audit_log.py` | AuditLog (action audit trail) |
| `__init__.py` | Model re-exports for clean imports |

### `src/services/` — Business Logic

| File | Purpose |
|------|---------|
| `ticket_service.py` | Ticket CRUD, filtering, assignment, business rules |
| `ticket_fsm.py` | Ticket state machine transitions (ASSIGNED → ACCEPTED → ON_THE_WAY → ARRIVED → IN_PROGRESS → REVIEW → COMPLETED) |
| `warehouse_service.py` | Warehouse CRUD, document processing, stock balance calculations |
| `warehouse_fsm.py` | Warehouse document state machine (draft → approved → completed) |
| `acl_service.py` | Role-based access control enforcement |
| `mail_service.py` | Email polling (IMAP), auto-ticket creation from emails, SMTP notifications |
| `attachment_service.py` | File upload/download, storage management |
| `comment_service.py` | Ticket comment management |
| `audit_service.py` | Audit log recording |
| `sla_service.py` | SLA (Service Level Agreement) calculations |
| `inn_service.py` | INN (Tax ID) lookup via DaData API |

### `src/api/` — FastAPI Routers

| File | Route prefix | Purpose |
|------|-------------|---------|
| `router.py` | — | Master router, auth (signup/login), locations CRUD, user list, groups, IIN lookup |
| `tickets.py` | `/tickets` | Ticket list, create, read, update, status transitions |
| `attachments.py` | `/attachments` | File upload/download |
| `equipment.py` | `/equipment` | Equipment/asset management |
| `warehouse.py` | `/warehouse` | Warehouse and document management |
| `views.py` | `/views` | Saved filter views CRUD |
| `admin.py` | `/admin` | User management (approve, reject, delete), system admin |
| `reports.py` | `/reports` | Report generation endpoints |
| `personal_tasks.py` | `/personal-tasks` | User personal tasks CRUD |
| `replacement.py` | `/replacement` | Device replacement management |
| `insert_stock.py` | `/inserts` | Metrological insert inventory management |
| `insert_v2.py` | `/inserts/v2` | Insert stock v2 API |
| `audit.py` | `/audit` | Audit log queries |
| `v1_router.py` | `/v1` | Legacy v1 API compatibility routes |
| `schemas.py` | — | Shared Pydantic request/response schemas |

### `src/core/` — Infrastructure

| File | Purpose |
|------|---------|
| `deps.py` | Dependency injection: JWT token creation/validation, `get_current_user`, `get_api_key` |
| `exceptions.py` | Custom exception classes |
| `http_client.py` | Shared httpx.AsyncClient management |
| `fsm/base.py` | Generic FSM engine (state, transitions, guards) |
| `fsm/mixins.py` | FSM mixins for reusable transition logic |
| `fsm/exceptions.py` | FSM-specific exceptions (InvalidTransition, etc.) |

### `src/ws/` — WebSocket

| File | Purpose |
|------|---------|
| `manager.py` | WebSocket connection manager for real-time ticket updates |

### Other

| File | Purpose |
|------|---------|
| `main.py` | FastAPI app factory, lifespan (mail worker, auto-migrations), CORS, SPA static serving |
| `config.py` | Settings via pydantic-settings (DATABASE_URL, REDIS_URL, SECRET_KEY, etc.) |
| `database.py` | Async SQLAlchemy engine + session factory |

---

## Frontend Modules (26 files, ~4600 LOC)

### Pages (`src/pages/`)

| Page | Purpose |
|------|---------|
| `TicketsPage.tsx` | Main ticket grid with table/tree/card views, filters, saved views |
| `TicketDetailPage.tsx` | Single ticket detail: info, history, comments, attachments, FSM actions |
| `LocationsPage.tsx` | Asset location (object/site) management with contacts and contracts |
| `WarehousePage.tsx` | Warehouse management, nomenclature, accounting documents, stock balances |
| `KanbanPage.tsx` | Personal kanban board for task management |
| `CalendarPage.tsx` | Ticket calendar view |
| `ReportsPage.tsx` | Reports and analytics dashboard |
| `AuditLogPage.tsx` | System audit log viewer (admin) |
| `AdminPage.tsx` | User management, system settings (admin-only) |

### Components (`src/components/`)

| Component | Purpose |
|-----------|---------|
| `TicketGrid/TicketGrid.tsx` | Main grid container with view switching |
| `TicketGrid/TableView.tsx` | Tabular ticket list |
| `TicketGrid/TreeView.tsx` | Hierarchical ticket view (by location/customer) |
| `TicketGrid/CardView.tsx` | Kanban-style card view |
| `TicketGrid/ColumnHeader.tsx` | Sortable column headers |
| `TicketGrid/RowStyles.tsx` | Priority/status-based row styling |
| `TicketGrid/Tabs.tsx` | View mode tabs |
| `TicketGrid/SavedViews.tsx` | Saved filter management |
| `SearchBar.tsx` | Global search component |

### State & API (`src/store/`, `src/api/`, `src/hooks/`)

| File | Purpose |
|------|---------|
| `store/tickets.ts` | Zustand store for ticket state management |
| `api/client.ts` | Axios-based API client with auth headers |
| `hooks/useDebounce.ts` | Debounce hook for search inputs |
| `hooks/useWebSocket.ts` | WebSocket hook for real-time updates |
| `locale.ts` | Localization strings |

---

## Mobile App (10 files, ~1100 LOC)

| Screen | Purpose |
|--------|---------|
| `TicketsScreen.tsx` | Mobile ticket list |
| `TicketDetailScreen.tsx` | Mobile ticket detail |
| `CompleteTicketScreen.tsx` | Mobile ticket completion form |
| `WarehouseScreen.tsx` | Mobile warehouse view |
| `KanbanScreen.tsx` | Mobile kanban board |
| `LoginScreen.tsx` | Authentication |
| `ServerSetupScreen.tsx` | Server connection setup |
| `App.tsx` | Root navigation setup |

---

## Roles (9)

| Role | Capabilities |
|------|-------------|
| `admin` | Full access, user management, system settings, delete objects |
| `director` | Full access: tickets, objects, warehouses, reports, calendar, audit. Can view/assign any board |
| `dispatcher` | Create/assign tickets, manage objects, manage users |
| `engineer` | Accept/execute/complete assigned tickets |
| `storekeeper` | Warehouse management, document approval |
| `customer` | View own tickets, add comments |
| `viewer` | Read-only access |
| `metrologist` | Metrological insert management, verification tickets |
| `accountant` | Financial reports, document management |

---

## Key Architecture Patterns

### Finite State Machine (FSM)
Tickets follow a strict FSM workflow:
```
ASSIGNED → ACCEPTED → ON_THE_WAY → ARRIVED → IN_PROGRESS → REVIEW → COMPLETED
```
Status transitions are enforced server-side via `core/fsm/` engine. No status can be changed without passing through valid transitions.

### Role-Based Access Control (ACL)
All endpoints check user role against required permissions via `get_current_user` + inline role checks. Admin-only operations (user approval, deletion) are restricted to `UserRole.admin`.

### Email Integration
Background mail worker polls IMAP mailbox, creates tickets from incoming emails, and sends SMTP notifications on ticket updates. Controlled by `ENABLE_MAIL_WORKER` env flag.

### Auto-Migrations
On startup (controlled by `ENABLE_AUTO_MIGRATIONS`), DDL statements add missing columns/types/tables idempotently. No Alembic dependency for simple schema evolution.

### Real-time Updates
WebSocket connections push ticket state changes to connected clients without polling.

---

## Infrastructure

### Docker Compose Services
- **db**: PostgreSQL 15-alpine, port 5434→5432, persistent volume `pgdata`
- **redis**: Redis 7-alpine, port 6380→6379
- **app**: Multi-stage build (Node 22 for frontend, Python 3.12-slim for backend), port 8002→8000

### Docker Multi-stage Build
1. Stage 1: `node:22-alpine` builds frontend (`npm ci && npm run build`)
2. Stage 2: `python:3.12-slim` installs backend (`pip install -e .`), copies frontend dist, runs uvicorn

### Entry Points
- Backend: `uvicorn src.main:app` (port 8000)
- Frontend dev: `npm run dev` (Vite, port 3000)
- Mobile: `expo start` / `expo run:android`

---

## Directory Structure

```
hubdesk-files/
├── backend/
│   ├── src/
│   │   ├── api/          # FastAPI routers
│   │   ├── core/         # FSM engine, deps, exceptions
│   │   ├── models/       # SQLAlchemy models
│   │   ├── services/     # Business logic
│   │   ├── ws/           # WebSocket manager
│   │   ├── config.py     # Settings
│   │   ├── database.py   # Async engine
│   │   └── main.py       # App factory
│   ├── pyproject.toml
│   └── history.log
├── frontend/
│   ├── src/
│   │   ├── pages/        # React pages
│   │   ├── components/   # Reusable components
│   │   ├── store/        # Zustand stores
│   │   ├── api/          # API client
│   │   └── hooks/        # Custom hooks
│   ├── package.json
│   └── vite.config.ts
├── mobile/
│   ├── src/screens/      # React Native screens
│   ├── App.tsx
│   └── package.json
├── docker/
│   ├── docker-compose.yml
│   ├── Dockerfile
│   └── .env
├── fsm_docs/             # Domain model, FSM, ACL, API docs
├── okdesk_spec/          # OkDesk integration spec
├── AGENTS.md             # Project constraints and rules
├── DESCRIPTION.md        # This file
└── ToDo.md               # Feature roadmap
```
