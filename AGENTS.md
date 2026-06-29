# AGENTS

Read all files before making changes.

Never invent business rules.

When information is missing:
- ask questions
- document assumptions

## Architecture
- Modular monolith
- FastAPI + async SQLAlchemy
- PostgreSQL
- React 18 + TypeScript + Vite
- Zustand (state management)
- Redis (configured)
- WebSockets (configured)

## Roles (9)
admin, director, dispatcher, engineer, storekeeper, customer, viewer, metrologist, accountant

## Constraints
- **РЕЖИМ RC (v3.01b1). Никакой самодеятельности: удаление объектов/сотрудников/складов/вставок, добавление/удаление сотрудников — только с прямого одобрения пользователя. Никаких изменений без явной команды.**
- Status changes only through FSM.
- Inventory changes only through accounting documents.
- Business logic must not exist in controllers.
- Tickets archive: COMPLETED -> archived.
- Checklist with mandatory fields blocks completion.
- Passwords in .env, not in database.
- Insert stock balance is calculated from transactions.
- **Сборка на сторонних ресурсах (Expo, GitHub Actions и т.д.) и выгрузка коммита только после явного одобрения пользователя.**
- **History.log: всегда использовать текущее время `date '+%Y-%m-%d %H:%M:%S'`, не копировать из предыдущих записей.**
- **После пуша удалять токен из git remote: `git remote set-url origin https://github.com/dimadr/hubdesk.git`.**
- **Деструктивные действия (сброс пароля, удаление данных, изменение БД в обход API) — только после явного подтверждения пользователя, не выполнять в том же сообщении, что и вопрос.**
- **Работать только в `/root/hubdesk/hubdesk-files/`. Инфраструктура (`/root/project1/`, контейнеры, nginx, docker) — только с явного одобрения.**

## Before generating code
1. Review requirements.
2. Review domain model.
3. Review FSM.
4. Review ACL.
5. Check ToDo.md for existing plans.
6. Review history.log for recent changes.

## Directories
- backend/src/api/ - FastAPI routers
- backend/src/models/ - SQLAlchemy models
- backend/src/services/ - Business logic
- backend/src/core/ - FSM engine, deps, exceptions
- frontend/src/pages/ - React pages
- frontend/src/components/ - Reusable components
- frontend/src/store/ - Zustand stores
- mobile/src/screens/ - React Native screens
