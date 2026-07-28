# AUDIT K3 — HubDesk (v3.01b1)

Дата: 2026-07-28
Режим: READ-ONLY. Изменений в код не вносилось (кроме данного файла отчёта).
Объём: весь проект `/root/hubdesk/hubdesk-files/`, кроме директории `mobile/`.

---

## 1. Архитектура (кратко)

Модульный монолит:
- **Backend**: FastAPI + async SQLAlchemy 2.0 + PostgreSQL 15 + Redis 7 (настроен, в коде не используется для критических путей). Роутеры в `backend/src/api/`, бизнес-логика в `backend/src/services/`, FSM-движок в `backend/src/core/fsm/`, модели в `backend/src/models/`. Фоновый почтовый воркер в `main.py` lifespan.
- **Frontend**: React 18 + TypeScript + Vite, Zustand-стор, без роутера (переключение страниц через state), JWT в localStorage, axios с базовым URL `/api`.
- **Деплой**: Docker Compose (app + db + redis), фронт собирается в multi-stage Dockerfile и раздаётся FastAPI из `/frontend/dist`. Бэкапы — ручной `archive.sh`.
- **Бизнес-инварианты**: статусы заявок только через FSM (`TicketFSM`), складские остатки только через учётные документы (`WarehouseDocFSM.account`), балансы вставок/подменного фонда вычисляются из транзакций под `SELECT ... FOR UPDATE`.

## 2. Фактически проверенные области

- Backend API: все 17 файлов `src/api/` (router, tickets, attachments, comments, warehouse, insert_stock, insert_v2, replacement, admin, reports, audit, equipment, personal_tasks, views, v1_router, schemas, deps).
- Backend services/models: все файлы `src/services/`, все 17 моделей, FSM-движок, `config.py`, `database.py`, `ws/manager.py`, миграции.
- Frontend: все файлы `src/` включая App.tsx (1169 строк), все 7 страниц, все компоненты TicketGrid, стор, клиент, vite.config.
- Деплой/конфиг: Dockerfile, docker-compose.yml, .env (ключи, не значения), archive.sh, .gitignore/.dockerignore, alembic, зависимости, тесты, права файлов.
- Документация: README, API.md, CAPABILITIES, DESCRIPTION, INSTRUCTION, AGENTS, ToDo — сверка ключевых утверждений с кодом.
- Проверено и подтверждено ОК: SQL-инъекции отсутствуют (все raw SQL с bind-параметрами); path traversal в загрузке/скачивании закрыт (basename+UUID+realpath); mass-assignment закрыт строгими Pydantic-схемами; FSM-переходы не обходятся; номер заявки под advisory lock; bcrypt+min12; API-ключи по SHA-256; `account()` атомарен и идемпотентен; CORS-wildcard без credentials.

## 3. Проверки, НЕ выполненные из-за риска изменения среды

- Запуск тестов (pytest может создавать артефакты/кэш).
- pip-audit / npm audit (установка/кэш); оценка уязвимостей зависимостей — по версиям из lock-файлов.
- Живые запросы к API/БД работающего контура (могут менять данные: логин пишет rate-limit, аудит-логи и т.п.).
- Сверка примера API-ключа из API.md с хэшами в таблице `api_keys` (требует чтения БД — не выполнялось; см. K3-045).
- Проверка содержимого БД (объёмы, фактические роли пользователей) — влияет только на калибровку severity.

## 4. Сводка

| Уровень | Кол-во |
|---|---|
| CRITICAL | 2 |
| HIGH | 7 |
| MEDIUM | 20 |
| LOW | 24 |
| **Итого** | **53** |

---

# 5. Замечания

## CRITICAL

### K3-001 [CRITICAL] Крах React (white screen) на вкладках «Подменный фонд» и «Вставки» склада
- **Файл**: `frontend/src/pages/WarehousePage.tsx:497-506` (ReplacementTab), `:884-893` (InsertTab)
- **Проблема**: условные ранние `return` (`if (loading)`, `if (loadError)`) стоят ДО вызова `useMemo` (строки 502 и 889). `useState(true)` для `loading` (строки 408, 794) гарантирует, что первый рендер завершается до `useMemo`, а после загрузки данных рендер проходит через `useMemo` — количество хуков между рендерами одного компонента меняется.
- **Обоснование**: React выбрасывает «Rendered more hooks than during the previous render». Error boundary в дереве нет (проверено по App.tsx) — размонтируется всё приложение.
- **Сценарий**: любой пользователь открывает Склад → «Подменный фонд» или «Вставки» → белый экран всего приложения до перезагрузки страницы.
- **Последствия**: два складских модуля полностью неработоспособны; потеря несохранённого состояния у пользователя.
- **Исправление**: перенести `useMemo` выше условных return (хуки всегда в одном порядке), либо заменить на вычисление без хука.
- **Проверка**: открыть обе вкладки — рендер без ошибок в консоли; `npm run build` + ручной прогон.

### K3-002 [CRITICAL] Компрометация SECRET_KEY и секретов: слабый предсказуемый ключ, мировые права, секреты в архивах
- **Файлы**: `backend/.env` (весь файл; mode 644); `backup/16.07.2026_14.22_v1bX.tar.gz`, `backup/17.07.2026_12.00_v1bX.tar.gz`, `backup/17.07.2026_13.20_v1bX.tar.gz` (содержат `./backend/.env` и `db_*.sql`, mode 644); `backup/db_23.07.2026_09.36.sql` (mode 644); `23.07.2026_09.36_pre-audit.tar.gz` (корень)
- **Проблема**: (а) `SECRET_KEY` в .env — человекочитаемая предсказуемая строка формата `hubdesk-...-2026` (27 символов, словарный паттерн); валидатор `config.py:18-22` проверяет только непустоту. (б) .env доступен для чтения любому локальному пользователю (644). (в) устаревшие tar-архивы и SQL-дампы с тем же .env и полной БД лежат в рабочем дереве с теми же правами.
- **Обоснование**: JWT подписывается HS256 этим ключом (`core/deps.py`, `main.py:270`). Знание ключа = подделка токена любого пользователя. Дамп БД содержит хэши паролей и персональные данные.
- **Сценарий**: любой, получивший доступ к хосту или копии архива (в т.ч. старый бэкап, ушедший с хоста), читает SECRET_KEY → формирует JWT администратора → полный контроль над API; читает дамп → вся база клиентов/заявок.
- **Последствия**: полная компрометация системы и данных, включая ретроактивную (старые архивы).
- **Исправление**: сгенерировать криптостойкий SECRET_KEY (`secrets.token_urlsafe(48)`), ротировать POSTGRES_PASSWORD/MAILBOX_PASSWORD/DADATA_API_KEY; `chmod 600 backend/.env`; удалить/зашифровать перечисленные архивы и дампы; удалить не относящийся к бэкенду `HF_TOKEN` из .env (и ротировать его — он уже засвечен); добавить в archive.sh проверку, что .env/дампы не попадают в tar (уже сделано в текущей версии archive.sh:20-24 — риск именно в legacy-артефактах).
- **Проверка**: `stat -c %a backend/.env` = 600; `tar tzf <архив> | grep -c -E '\.env|\.sql'` = 0 для новых архивов; вход старым SECRET_KEY отклоняется (401).

## HIGH

### K3-003 [HIGH] Список заявок отдаётся ролям storekeeper/metrologist/accountant без фильтрации (IDOR / обход ACL)
- **Файл**: `backend/src/api/tickets.py:61-66`; противоречие: `backend/src/services/acl_service.py:34-43`
- **Проблема**: `list_tickets` ограничивает выборку только для `customer` и `engineer`. Остальные роли получают полный список всех заявок (с body, контактами, клиентами). При этом `can_view_ticket_async` для storekeeper/metrologist/accountant возвращает False — единичная заявка им возвращает 404, а список отдаёт всё.
- **Обоснование**: прямое противоречие ACL-политике, зафиксированной в acl_service и применённой во всех соседних эндпоинтах (GET /tickets/{id}, комментарии, вложения).
- **Сценарий**: пользователь с ролью metrologist: `GET /api/tickets?limit=200&offset=N` постранично → дамп всех заявок с ПДн.
- **Последствия**: массовая утечка бизнес-данных и ПДн; несоответствие заявленной модели доступа.
- **Исправление**: в `list_tickets` для ролей, у которых `can_view_ticket_async` всегда False, возвращать пустой список/403 (или явно зафиксировать в ACL-документации, что список им доступен, и привести acl_service в соответствие).
- **Проверка**: под metrologist `GET /api/tickets` → 403 или пусто; существующие тесты ACL зелёные.

### K3-004 [HIGH] Загруженные HTML/SVG отдаются inline с origin приложения — хранимый XSS
- **Файл**: `backend/src/main.py:325` (эндпоинт `/files/{file_path}`); загрузка без заявки разрешена admin/director/storekeeper: `backend/src/api/attachments.py:26-28`
- **Проблема**: `FileResponse(real_path)` без параметра `filename` не выставляет `Content-Disposition: attachment`; media type угадывается по расширению → .html/.svg исполняются в контексте origin приложения. JWT лежит в localStorage и доступен любому JS на origin.
- **Обоснование**: отдельный эндпоинт скачивания (`attachments.py:104`) передаёт `filename=` и безопасен; `/files/` — нет.
- **Сценарий**: storekeeper загружает вредоносный .svg/.html, присылает ссылку `/files/<uuid>.html?` администратору; скрипт читает localStorage → угон сессии администратора.
- **Последствия**: хранимый XSS с кражей JWT любой роли.
- **Исправление**: в `/files/` возвращать `FileResponse(real_path, filename=os.path.basename(real_path))` (attachment) либо жёстко проставлять `Content-Disposition: attachment` и `X-Content-Type-Options: nosniff`; опционально — запретить загрузку html/svg.
- **Проверка**: загрузить .html, открыть через `/files/` → браузер скачивает файл, не исполняет.

### K3-005 [HIGH] При переоткрытии заявки (COMPLETED→IN_PROGRESS) не очищаются `archived_at`/`completed_at`
- **Файл**: `backend/src/services/ticket_service.py:130-135` (только установка; очистки нет нигде в `change_status`); FSM-переход разрешён: `ticket_fsm.py:15`; фильтр списка: `tickets.py:67-70`
- **Проблема**: при завершении ставятся `completed_at` и `archived_at`. Переход COMPLETED→IN_PROGRESS (разрешён engineer и dispatcher) не сбрасывает ни одно из полей.
- **Сценарий**: завершить заявку → вернуть в работу → заявка активна, но исчезает из доски по умолчанию (`archived=false` фильтрует по `archived_at IS NULL`); отчёты по времени решения и просрочке используют протухший `completed_at`.
- **Последствия**: «потерянные» активные заявки; искажение SLA-метрик и архива.
- **Исправление**: при переходе из COMPLETED очищать `archived_at` и `completed_at` (в `change_status`).
- **Проверка**: тест — complete → reopen → заявка видна при `archived=false`, `completed_at IS NULL`.

### K3-006 [HIGH] Гонка приёма почты → дубли заявок; флуд заявок при первом запуске
- **Файлы**: `backend/src/services/mail_service.py:70-166` (нет блокировки, `last_uid` NULL → поиск `'ALL'`, строка 85); вызовы: фоновый воркер `main.py:40-65` и ручной триггер `admin.py:404-411`
- **Проблема**: (а) чтение/обновление `last_uid` не защищено блокировкой — одновременный запуск воркера и ручного триггера (или двух триггеров) обрабатывает одни и те же письма дважды; (б) при NULL `last_uid` вся история ящика превращается в заявки без ограничения объёма; письма не помечаются прочитанными/не удаляются → сброс конфигурации повторяет флуд.
- **Сценарий**: (а) админ жмёт «проверить почту» во время прохода воркера → каждое письмо создаёт две заявки с разными номерами. (б) включение интеграции на ящике с 2000 писем → 2000 заявок.
- **Последствия**: засорение системы дублями, блокировка создания заявок через веб на время импорта (advisory lock 42 на всю транзакцию батча).
- **Исправление**: advisory lock на процесс приёма (напр. `pg_try_advisory_xact_lock(43)` — занят → пропуск); опция «начинать с текущего момента» (UIDNEXT) при NULL; кап на размер батча.
- **Проверка**: интеграционный тест с двумя параллельными вызовами fetch → заявки не дублируются; первый запуск на тестовом ящике создаёт ≤ капа заявок.

### K3-007 [HIGH] `docker-compose.yml` доступен на запись всем (mode 666)
- **Файл**: `docker/docker-compose.yml` (mode 666; также README.md 666)
- **Проблема**: любой локальный пользователь может изменить compose-файл (добавить mount `/:/host`, изменить команду) — при следующем `docker compose up` получает root в контейнере (USER не задан, см. K3-015), что равнозначно компрометации хоста.
- **Исправление**: `chmod 644 docker/docker-compose.yml README.md`.
- **Проверка**: `stat -c %a` = 644.

### K3-008 [HIGH] Публичная регистрация принимает произвольную роль; фронт отдаёт роль в `/signup` из dropdown с `admin`
- **Файлы**: `backend/src/api/router.py:79` (дефолт `dispatcher`), `:186-196` (блокируется только `admin`); фронт: `frontend/src/App.tsx:771,790-797` (AddEmployeeModal шлёт выбранную роль на публичный `/signup`)
- **Проблема**: signup отвергает только роль `admin`; любая другая (director, dispatcher, storekeeper…) принимается. Аккаунт создаётся в `pending` и активируется админом без обязательной переустановки роли (`admin.py:314-332`). Дефолт роли — dispatcher, а не минимально привилегированная.
- **Обоснование**: единственный барьер — внимательность администратора в списке заявок; фронт-модалка добавления сотрудника использует тот же публичный эндпоинт.
- **Сценарий**: craft-POST `/api/signup` с `role=director`; админ, не глядя, подтверждает заявку → привилегированная учётка.
- **Исправление**: сервером игнорировать переданную роль при публичной регистрации (ставить viewer/customer); выдачу ролей — только через админский эндпоинт смены роли; дефолт схемы сменить на минимальную роль.
- **Проверка**: POST /signup с role=admin/director → в БД viewer; админ выдаёт роль отдельным вызовом.

### K3-009 [HIGH] Пример API-ключа в API.md может быть живым реквизитом
- **Файл**: `API.md:47` (пример `X-Api-Key` из 48 hex-символов)
- **Проблема**: если строка — реальный ключ, это опубликованный живой реквизит (API.md не в git, но включается в tar-архивы). Из read-only режима сверка с `api_keys` (sha256) не выполнялась.
- **Исправление**: вычислить sha256 строки и сравнить с `key_hash` в таблице; при совпадении — отозвать ключ и заменить пример на вымышленный.
- **Проверка**: совпадений хэша в `api_keys` нет.

## MEDIUM

### K3-010 [MEDIUM] Инженер может двигать себе SLA-дедлайн
- **Файл**: `backend/src/api/tickets.py:253-255`
- **Проблема**: в whitelist редактируемых инженером полей входит `resolution_deadline`. Дедлайны SLA рассчитываются из договора (`ticket_service.py:66-71`), а просрочка/отчёты — из этого поля (`sla_service.py:27-32`).
- **Сценарий**: инженер `PATCH /tickets/{id}` с дедлайном в 2099 г. → заявка никогда не просрочена; отчётность по инженерам обнуляет просрочки.
- **Исправление**: убрать `resolution_deadline` из engineer-whitelist (осталось у dispatcher+).
- **Проверка**: PATCH инженером с resolution_deadline → поле игнорируется (200 без изменения).

### K3-011 [MEDIUM] Viewer (read-only) может загружать вложения к любой заявке; storekeeper — не может
- **Файлы**: `backend/src/api/attachments.py:26-28`, `backend/src/services/attachment_service.py:38`, `backend/src/services/acl_service.py:35`
- **Проблема**: загрузка привязана к `can_view_ticket_async`, где viewer — blanket True. Комментарии/чек-листы viewer'у запрещены явно (`tickets.py:341,376,421,448`) — несогласованность. Storekeeper той же функцией получает False → 403 на вложения.
- **Сценарий**: viewer пишет файлы и строки в attachments к чужим заявкам (роль «только чтение» получает запись).
- **Исправление**: для загрузки требовать не view, а edit-право (admin/director/dispatcher/engineer-assignee); при необходимости явно решить судьбу storekeeper.
- **Проверка**: POST /attachments под viewer → 403.

### K3-012 [MEDIUM] Заказчик не может создать заявку через API (отклонение от спецификации ACL)
- **Файл**: `backend/src/api/tickets.py:196-199`; спека: `fsm_docs/04-acl.md` (Customer: «Can create tickets»)
- **Проблема**: создание разрешено только admin/director/dispatcher/engineer. Клиентский канал — только почта.
- **Исправление**: добавить `UserRole.customer` в допуск с принудительным `customer_id = user.customer_id` и валидацией принадлежности location этому customer (логика уже есть в `ticket_service.py:30-34`).
- **Проверка**: customer создаёт заявку только на свой объект; чужой location_id → 400/403.

### K3-013 [MEDIUM] Удаление объекта каскадно стирает оборудование без проверки и аудита
- **Файлы**: `backend/src/api/router.py:467-506`; каскад: `backend/src/models/equipment.py:54-57`
- **Проблема**: проверяются заявки, insert- и replacement-транзакции, но не Equipment. `delete-orphan` каскад удаляет всё оборудование объекта; аудит — одна строка `location_deleted`.
- **Сценарий**: админ удаляет объект без заявок/движений, но с оборудованием → записи оборудования уничтожены молча.
- **Исправление**: добавить счётчик оборудования в guard (400 «нельзя удалить объект с оборудованием») или явное каскадное подтверждение + построчный аудит.
- **Проверка**: DELETE на объект с оборудованием → 400.

### K3-014 [MEDIUM] Инженер может создавать клиентов и перепривязывать объект к любому клиенту
- **Файл**: `backend/src/api/router.py:318` (create), `:328-331` (автосоздание Customer), `:392-422` (update: проверки только «существует»/«это engineer»)
- **Проблема**: инженер (и бухгалтер) создают объекты и попутно новых клиентов; при обновлении своего объекта могут сменить `customer_id` на любого существующего клиента и `assigned_engineer_id` на любого инженера.
- **Сценарий**: инженер переносит свой объект под чужого клиента → пользователи этого клиента видят объект и связанные заявки; спам записями клиентов.
- **Исправление**: смену `customer_id` ограничить admin/director/dispatcher; создание клиента — теми же ролями.
- **Проверка**: PATCH инженером с чужим customer_id → 403.

### K3-015 [MEDIUM] Контейнер приложения работает от root; нет HEALTHCHECK; базовые образы не запинены
- **Файл**: `docker/Dockerfile` (весь, 20 строк); `docker/docker-compose.yml:21-39`
- **Проблема**: нет `USER` (uvicorn от root); нет `HEALTHCHECK` ни в Dockerfile, ни в compose для app (хотя `/api/health` есть, `main.py:235`); теги `node:22-alpine`, `python:3.12-slim`, `postgres:15-alpine`, `redis:7-alpine` без digest-пинов.
- **Последствия**: RCE = root в контейнере (усугубляется K3-007); зависшее приложение не рестартуется; пересборка может молча сменить базовый образ.
- **Исправление**: `USER` непривилегированный; `HEALTHCHECK CMD wget -qO- http://localhost:8000/api/health`; пин по digest.
- **Проверка**: `docker exec docker-app-1 id -u` ≠ 0; `docker inspect` содержит Healthcheck.

### K3-016 [MEDIUM] Деструктивный авто-DDL в lifespan + три конкурирующих механизма схемы; alembic неработоспособен
- **Файлы**: `backend/src/main.py:73-75` (create_all при каждом старте), `:81-186` (DROP/ALTER/UPDATE при `ENABLE_AUTO_MIGRATIONS=true`, ошибки — только warning); `backend/alembic.ini:3` (захардкожены `postgres:changeme@localhost:5432/fsm`); `backend/migrations/env.py:19,32-35` (URL не берётся из настроек приложения); единственная ревизия `20260727_01_schema_safety.py` без базовой истории
- **Проблема**: включение флага на проде выполняет DROP COLUMN живых данных; падение statement посередине списка = полумигрированная схема с warning в логах; `alembic upgrade head` подключается не к той БД или падает; create_all создаёт таблицы вне истории миграций. Отдельно: блок `main.py:117` (пересоздание enum ticketstatus) гарантированно падает, т.к. `ticket_transitions` зависят от типа — чистка enum не происходит никогда.
- **Исправление**: единый механизм — Alembic; `env.py` читает `settings.database_url`; убрать DDL-блок и create_all из lifespan (оставить create_all только для dev/test).
- **Проверка**: `alembic upgrade head` против тестовой БД проходит; старт приложения без DDL в логах.

### K3-017 [MEDIUM] `archive.sh`: дамп в /tmp с предсказуемым именем, подавление ошибок, ложный успех
- **Файл**: `archive.sh:9` (`pg_dump > /tmp/hubdesk_db_*.sql 2>/dev/null`), `:30` (безусловный «✓ DB dump»), hardcoded `docker-db-1`
- **Проблема**: дамп в общем /tmp (umask 644) — читаем любым пользователем хоста; ошибки pg_dump скрыты, скрипт рапортует успех и собирает tar даже без дампа; дамп не входит в tar и копится в /tmp; слом при переименовании контейнера.
- **Исправление**: дамп в приватный каталог (700), `set -euo pipefail`, проверка кода возврата pg_dump, параметризация имени контейнера, включение дампа в архив или его удаление после.
- **Проверка**: остановить db-контейнер на стенде → скрипт падает с ошибкой, tar не создаётся.

### K3-018 [MEDIUM] Все секреты приложения пробрасываются в контейнер БД
- **Файл**: `docker/docker-compose.yml:4` (`env_file: ../backend/.env` на db), `:25`
- **Проблема**: postgres-контейнер получает SECRET_KEY, MAILBOX_PASSWORD, DADATA_API_KEY и пр. в окружение (`docker inspect` их показывает), хотя нужны только POSTGRES_*.
- **Исправление**: db — только POSTGRES_USER/PASSWORD (explicit `environment:`); app — env_file.
- **Проверка**: `docker inspect docker-db-1` — в Env нет SECRET_KEY/MAILBOX_*.

### K3-019 [MEDIUM] CORS-wildcard по умолчанию + публичный Swagger + JWT в localStorage
- **Файлы**: `backend/src/main.py:211-230` (`ALLOWED_ORIGINS` не задан в .env → `allow_origins=["*"]`), `:206-208` (`/api/docs`, `/api/openapi.json` без авторизации); `frontend/src/App.tsx:128`
- **Проблема**: любой сайт может слать cross-origin запросы к API (включая /login — площадка для credential stuffing); OpenAPI раскрывает всю схему анониму; XSS на любом origin с доступом к localStorage-токену (см. K3-004).
- **Исправление**: задать `ALLOWED_ORIGINS` явно; закрыть docs/openapi в проде (`docs_url=None` по флагу окружения).
- **Проверка**: preflight с чужого origin → без ACAO; /api/docs → 404 в проде.

### K3-020 [MEDIUM] Порт приложения опубликован на всех интерфейсах; TLS не подтверждён
- **Файл**: `docker/docker-compose.yml:26` (`8002:8000` → 0.0.0.0)
- **Проблема**: без TLS-терминации перед портом (nginx на хосте упомянут в AGENTS, из дерева не верифицируется) JWT и пароли идут открытым текстом; документация ссылается на http:// URL.
- **Исправление**: подтвердить/настроить TLS-прокси; иначе публиковать порт на 127.0.0.1.
- **Проверка**: внешний https:// запрос успешен, http:// редиректит/закрыт.

### K3-021 [MEDIUM] Утечка внутренних ошибок наружу (400 с str(e), 500 с текстом IMAP, JWT-детали)
- **Файлы**: `backend/src/api/tickets.py:301-302,329-331` (`HTTPException(400, str(e))` на любой Exception); `backend/src/api/admin.py:404-411` (500 с текстом ошибки IMAP); `backend/src/core/deps.py:31` (`JWT error: {e}`), `:35` (раскрытие существующего user_id)
- **Проблема**: тексты ошибок БД/драйвера/библиотек возвращаются клиенту (схема, имена таблиц), серверные сбои маскируются под 400; детали JWT-ошибок помогают подбору подписи.
- **Исправление**: ловить ожидаемые исключения (FSM/валидация) с их сообщениями; прочее — общий 500 с логированием; deps — единообразный «Invalid token».
- **Проверка**: форсированная DB-ошибка → клиент получает generic detail; тело не содержит asyncpg/SQL.

### K3-022 [MEDIUM] Нет аудита изменения и удаления заявок
- **Файл**: `backend/src/api/tickets.py:221-287` (update без log_audit), `:493-521` (delete; захваченный `num` на :504 не используется — след утраченного вызова аудита)
- **Проблема**: правки приоритета/клиента/дедлайнов/исполнителя и жёсткое удаление заявки со всеми дочерними сущностями не оставляют следов в audit_logs (auditing есть только на unassign, :486).
- **Исправление**: log_audit на update (diff полей) и delete (номер, тема, инициатор).
- **Проверка**: PATCH и DELETE заявки → записи в /audit-log.

### K3-023 [MEDIUM] Складской учёт: тип номенклатуры игнорируется, переходы документов не аудируются, количество — Float
- **Файлы**: `backend/src/services/warehouse_fsm.py:48-58` (дельты для всех строк; спека `fsm_docs/03-warehouse.md`: только Material/Product влияют на остатки), `:30-36` (log_transition только в logger, в БД нет; у документа нет created_by); `backend/src/models/warehouse.py:71,85` (`quantity: Float`)
- **Проблема**: услуги/работы попадают в stock_balances; кто провёл документ DRAFT→…→ACCOUNTED в БД не фиксируется (у заявок TicketTransition есть); float-арифметика накапливает ошибку и может дать ложное срабатывание/пропуск контроля отрицательных остатков на границе.
- **Исправление**: фильтровать строки по `Nomenclature.type in (material, product)`; персистить переходы документов (таблица по образцу ticket_transitions) + created_by; перевести quantity на Numeric(14,3) с миграцией.
- **Проверка**: документ со строкой service не меняет остатки; в БД виден автор каждого перехода; 0.1×10 = 1.000 в балансе.

### K3-024 [MEDIUM] Потерянный NameError в mail_worker: интервал из БД никогда не применяется
- **Файл**: `backend/src/main.py:56-64`
- **Проблема**: `select(MailboxConfig)` используется без импорта `select` (импортирован только `text`, :18; `src.models` его не экспортирует — проверено по `models/__init__.py`). Каждый цикл падает с NameError, проглатываемым `except: pass` → всегда интервал 120 с; заодно проглатывается любая другая ошибка блока (включая CancelledError).
- **Исправление**: `from sqlalchemy import select`; заменить bare except на `except Exception: logger.warning(...)`.
- **Проверка**: смена `check_interval_min` в админке меняет период опроса (по логам).

### K3-025 [MEDIUM] Несогласованная сериализация дедлайнов на фронте (naive local vs UTC ISO)
- **Файлы**: `frontend/src/App.tsx:570` (detail-модал: `deadlineValue + 'T23:59:59'` — naive local), `:226,:390` (create/edit: `toISOString()` — UTC); смежно `:354,:495` (UTC-дата в local input → сдвиг дня для UTC+X)
- **Проблема**: один и тот же дедлайн, выставленный из разных UI, сохраняется со сдвигом на часовой пояс браузера; бэкенд хранит naive-UTC и трактует обе формы как UTC.
- **Сценарий**: диспетчер (UTC+3) ставит срок «до 30.07» через детальную карточку → в БД 30.07 23:59:59 как UTC = фактически 31.07 02:59 local; через модалку редактирования — 29.07 20:59:59 UTC. Разница ~27 часов.
- **Исправление**: единый формат — всегда `new Date(date + 'T23:59:59').toISOString()` (или date-fns/dayjs с явной TZ); отображение через единый хелпер локализации.
- **Проверка**: оба UI дают идентичное сохранённое значение для одной даты.

### K3-026 [MEDIUM] Отсутствуют FK-индексы на часто фильтруемых колонках; N+1 в чек-листах
- **Файлы**: `backend/src/models/` — нет index на `ticket_transitions.ticket_id`, `comments.ticket_id`, `attachments.ticket_id/comment_id`, `checklists.ticket_id`, `checklist_fields.checklist_id`, `document_lines.document_id`, `insert_transactions.product_id`, `replacement_transactions.device_id`, `personal_tasks.user_id`, `tickets.location_id/equipment_id/group_id`, `audit_logs(entity_type,entity_id)`; N+1: `backend/src/api/tickets.py:400-406` (запрос полей в цикле по чек-листам)
- **Проблема**: PostgreSQL не индексирует FK автоматически; джойны/фильтры по этим колонкам — seq scan с ростом данных; чек-листы грузятся N+1 запросами.
- **Исправление**: миграция с `CREATE INDEX` по перечню; `selectinload(Checklist.fields)`.
- **Проверка**: `EXPLAIN` на типовых запросах — index scan; 1 запрос вместо N в логе SQL.

### K3-027 [MEDIUM] Смешение источников времени: Python naive-UTC vs `func.now()` (зависимость от TZ БД)
- **Файлы**: `backend/src/services/ticket_service.py:28` (utcnow-naive) против `server_default=func.now()` (TicketTransition.timestamp, AuditLog.created_at, InsertTransaction.created_at и др.) и сравнения `func.now() > deadline` (`tickets.py:76-93`, `admin.py:140-141`)
- **Проблема**: корректно только пока `TimeZone` PostgreSQL = UTC (в compose это так); смена TZ БД молча сдвигает просрочки и аудит-время.
- **Исправление**: зафиксировать `options={"-c": "timezone=UTC"}` для подключения или перейти на `DateTime(timezone=True)` повсеместно.
- **Проверка**: `SHOW TimeZone` = UTC через строку подключения приложения; тест просрочки не зависит от TZ сервера БД.

### K3-028 [MEDIUM] JWT без клиентской проверки срока + возможная утечка Bearer на чужой origin через download_url
- **Файлы**: `frontend/src/api/client.ts:11-17` (Authorization по умолчанию на все запросы), `frontend/src/App.tsx:12-13,648` (`downloadFile(a.download_url)` общим axios-инстансом; абсолютный URL игнорирует baseURL → токен уходит на внешний хост), `:889-895` (восстановление сессии без проверки exp)
- **Проблема**: поле `download_url` определяется серверными данными (и свободным URL для passport_scan на складе, `WarehousePage.tsx:727-730`); stale-токен используется до первого 401.
- **Исправление**: скачивание относительных путей только с того же origin (валидация `new URL(url, location.origin).origin === location.origin`), внешние — без Authorization; при старте проверять `exp` из JWT и чистить протухший.
- **Проверка**: attachment с внешним download_url → запрос без заголовка Authorization.

### K3-029 [MEDIUM] Данные прошлой сессии видны после logout (zustand-стор не сбрасывается)
- **Файлы**: `frontend/src/store/tickets.ts`, `frontend/src/App.tsx:929-935` (handleLogout чистит только localStorage/заголовок)
- **Проблема**: после logout стор хранит заявки прежнего пользователя; при следующем входе TicketGrid рендерит их до завершения refetch (~300мс+сеть).
- **Сценарий**: общий браузер: engineer вышел → customer вошёл → мельком видны чужие заявки.
- **Исправление**: в handleLogout сбрасывать стор (`useTicketStore.setState({tickets: [], ...})`).
- **Проверка**: logout→login другим пользователем — до загрузки пустая доска.

## LOW

### K3-030 [LOW] User enumeration по таймингу входа
- **Файл**: `backend/src/api/router.py:242` — `not user or not bcrypt.verify(...)`: несуществующий email отвечает мгновенно, существующий ~300мс. Сообщение общее, rate limit частично сдерживает.
- **Исправление**: verify против фиксированного dummy-хэша при отсутствии пользователя.

### K3-031 [LOW] Rate limiter входа в памяти, per-process, без вытеснения; IP — адрес прокси
- **Файл**: `backend/src/api/router.py:17-29`
- **Проблема**: за nginx `request.client.host` одинаков для всех (глобальный локаут после 5 попыток суммарно) либо лимит обходится сменой IP; dict растёт безгранично; лимит сбрасывается рестартом/не работает при >1 worker.
- **Исправление**: X-Forwarded-For (доверенный proxy) + Redis/БД-счётчик; периодическая очистка словаря.

### K3-032 [LOW] Отсутствие лимитов длины в Pydantic-схемах → 500 на пользовательском вводе
- **Файлы**: `tickets.py:438-439` (value vs String(1000)), `:409-412` (label vs 255), `:306-307` (comment vs 5000), `router.py:128-158` (Location inn>12 → DataError и др.), `admin.py:53-62,75`, `warehouse.py:185-188,305-307`; `equipment.py:40-55` (дубль qr_code → 500, нет обработки IntegrityError)
- **Исправление**: `Field(max_length=...)` по размерам колонок; обработчик IntegrityError → 400/409.

### K3-033 [LOW] Гонка позиций персональных задач (MAX(position)+1 без блокировки)
- **Файл**: `backend/src/api/personal_tasks.py:97-108` — конкурентные создания в одной колонке получают одинаковый position. Только порядок сортировки.

### K3-034 [LOW] Склад: approve/deliver без блокировки строки; TRANSFER source==target; возможный deadlock многострочного постинга; POST+PATCH дубль на account
- **Файлы**: `warehouse_service.py:56-72` (нет FOR UPDATE; lost update статуса при гонке — ограничено тем, что остатки меняются только в locked account); `warehouse_fsm.py:38-46,56-58`; `warehouse.py:145-146`
- **Исправление**: `_get(..., for_update=True)` на всех переходах; отклонять source==target; сортировать строки по (warehouse_id, nomenclature_id) перед блокировкой; оставить один метод.

### K3-035 [LOW] Создатель склада сам его не видит; storekeeper может выдавать доступ другим
- **Файлы**: `backend/src/api/warehouse.py:310-318` (нет warehouse_access для создателя), `:269-270` (заблокирован только self-grant)
- **Исправление**: вставлять access-строку создателю; выдачу доступа ограничить admin/director.

### K3-036 [LOW] Почта: пропущенные письма теряются навсегда; спуфинг From; /tmp/email_history.log; утечка IMAP-сокета при ошибке логина
- **Файл**: `backend/src/services/mail_service.py:124-146` (last_uid продвигается при skip — нет dead-letter), `:222-250` (доверие From без SPF/DMARC), `:169-174` (неограниченный append в /tmp, bare except), `:81-90,188-193` (соединение не закрывается при исключении после connect), `:165,183` (`datetime.utcnow()` deprecated на 3.12)
- **Исправление**: dead-letter таблица/пометка; try/finally logout; history в каталог приложения с ротацией; `datetime.now(timezone.utc).replace(tzinfo=None)` (или aware везде).

### K3-037 [LOW] Мёртвый код backend: RC-заглушки с деструктивными телами, comments.py, ws/manager.py, неиспользуемые функции/импорты
- **Файлы**: `insert_v2.py:229-242,356-367` (тело delete_product удаляет ВСЕ транзакции продукта), `replacement.py:195-206,320-330`, `insert_stock.py:68-78`, `admin.py:234-248,301-304`, `audit.py:85-92` — недостижимы за `raise`, но активируются удалением одной строки; `api/comments.py` (целиком, роутер не подключён); `ws/manager.py` (WS-эндпоинтов нет; при будущем подключении — нет авторизации и broadcast всем подряд); `reports.py:70-93` (ticket_query), `acl_service.py:24-31,56-61` (can_view_ticket sync, can_see_comment), `warehouse_fsm.py:13` (AuditMixin не используется); дубль `logger` в `router.py:14,54`; неиспользуемые импорты в audit.py, reports.py, warehouse.py, tickets.py, personal_tasks.py, insert_stock.py, models/api_key.py
- **Исправление**: удалить тела/модули или вынести деструктивные операции за явный feature-flag.

### K3-038 [LOW] Легаси GET /insert-stock активен; удаление заявки оставляет файлы-сироты; ручной каскад delete_ticket
- **Файлы**: `insert_stock.py:35-55` (legacy read в attack surface), `tickets.py:505-521` (файлы удаляются после commit, `except OSError: pass`; ручной SQL-каскад хрупок к новым дочерним таблицам)
- **Исправление**: 410 на legacy; файлы до commit или фоновая чистка; каскад на ORM-уровне.

### K3-039 [LOW] `delete_location` не проверяет legacy insert_items → 500
- **Файлы**: `router.py:484-506`; `models/insert_item.py:16` (FK без каскада)
- **Исправление**: добавить счётчик InsertItem в guard или ON DELETE.

### K3-040 [LOW] Аудит-лог фильтры дат без нормализации TZ; двойной канал аудита в history.log
- **Файлы**: `audit.py:61-67` (fromisoformat без приведения к UTC-naive, в отличие от tickets.py:99-100); `insert_stock.py:14-20`, `replacement.py:20-26` (`_log` в текстовый history.log, bare except)
- **Исправление**: нормализация как в tickets.py; единый канал audit_logs.

### K3-041 [LOW] Фронт: role из localStorage управляет UI-гейтами (подделывается); Kanban drag-drop без UI-проверки прав
- **Файлы**: `LocationsPage.tsx:36`, `WarehousePage.tsx:24`, `App.tsx:828-852,993`, `TableView.tsx:150-173,206-213`, `KanbanPage.tsx:129-152`
- **Обоснование**: серверные ACL проверены и закрывают реальный доступ (см. раздел 2) — риск ограничен UX/обманом интерфейса; Kanban PATCH идёт на серверный FSM, который отвергнет недопустимое.
- **Исправление**: роль из JWT-payload (подписан) вместо localStorage-JSON; сервер остаётся источником истины.

### K3-042 [LOW] Фронт: гонка комментариев при быстром переключении заявок; setState после unmount; утечка document-listener'ов при drag
- **Файлы**: `App.tsx:505-516` (нет abort/request-id), `LocationsPage.tsx:80` (setTimeout 3с), `App.tsx:274` (blur-timeout), `ReportsPage.tsx:54-106`, `CalendarPage.tsx:55-86`, `ColumnHeader.tsx:20-22` (listeners до mouseup)
- **Исправление**: AbortController/reqId в load комментариев; cleanup в useEffect; removeEventListener на unmount.

### K3-043 [LOW] Фронт: молчаливые catch скрывают ошибки (комментарии, вложения, списки)
- **Файлы**: `App.tsx:513` (комментарии → «Нет комментариев» при ошибке), `:648` (downloadFile без catch), `:194,:363` (/locations → пустой выбор объекта; edit-модал молча откатывает customer_id), `:815,:907`, `ReportsPage.tsx:90-96`
- **Исправление**: отображать ошибку; downloadFile с .catch и уведомлением.

### K3-044 [LOW] Фронт: валидация форм
- **Файлы**: `App.tsx:113-133` (consent-чекбокс не блокирует submit публичной регистрации — ср. AddEmployeeModal:769 где проверка есть), `WarehousePage.tsx:465-469` (NaN→RangeError с криптичным текстом), `AdminPage.tsx:529,531` (пустое → 0), отсутствие client-side max_length
- **Исправление**: проверка consent; isFinite-валидация чисел; maxLength по серверным лимитам.

### K3-045 [LOW] Фронт: логика фильтров/дат; SavedViews; статус-кнопки
- **Файлы**: `TicketGrid.tsx:117-124` (UTC-дата против local-input в фильтре колонки), `CalendarPage.tsx:130` (`new Date('YYYY-MM-DD')` как UTC → прежний день в UTC−), `TicketGrid.tsx:85-90` (1-символьный поиск молча игнорируется), `TableView.tsx:181-197` vs `App.tsx:502` (разные правила quick-advance), `SavedViews.tsx:47-56` (uncontrolled select — повторный выбор не срабатывает), `LocationsPage.tsx:283-289` (is_primary=i===0 затирает серверные флаги), `AdminPage.tsx:601` (`k.key.length` — потенциальный TypeError по контракту), `WarehousePage.tsx:245` (несуществующие CSS-классы status-*), `App.tsx:202-203,371-372` (regex телефона захватывает мусор)
- **Исправление**: единый date-helper; hint для <2 символов; единая canAdvance-функция; controlled select; сохранять server is_primary; optional chaining; добавить классы/убрать; ужесточить regex.

### K3-046 [LOW] Фронт: мёртвый код
- **Файлы**: `hooks/useDebounce.ts` (не импортируется), `App.tsx:106` (patronymic без инпута, но уходит в signup), `locale.ts:21` + `styles.css:329-338` (tree view без компонента), `styles.css:301-302,304,455-458` (неиспользуемые .st-*/.cell-clickable), `store/tickets.ts:50,68` (total — размер страницы, не читается), `AuditLogPage.tsx:12-13` (meta/ip не рендерятся)
- **Исправление**: удалить или реализовать.

### K3-047 [LOW] Зависимости: passlib 1.7.4 (заброшен, требует monkey-patch), python-jose 3.5.0 (проверить по актуальным advisory), lock без хэшей, pyproject `>=` диапазоны, `-e /app` артефакт в lock
- **Файлы**: `backend/requirements.lock:15,24,31`, `backend/pyproject.toml:5-20`, `backend/src/main.py:6-11`, `docker/Dockerfile:14-18`
- **Исправление**: миграция passlib→bcrypt напрямую (или pwdlib); jose→PyJWT; `--require-hashes`; свести pyproject к lock; вычищать `-e /app` при генерации lock.

### K3-048 [LOW] Тесты: только моки, есть тавтологические; нет API/ACL/учётных тестов
- **Файлы**: `backend/tests/test_ticket_fsm.py`, `test_warehouse_fsm.py`, `features/test_ticket_lifecycle.py:26-27,36-38` (утверждения над собственными фикстурами/исключениями — не могут упасть)
- **Исправление**: pytest-asyncio + testcontainers/временная БД; тесты ACL-матрицы, учёта документов, гонок номера заявки; удалить тавтологии.

### K3-049 [LOW] Несоответствия документации коду
- **Файлы/факты**: `README.md:136` (`.env.example` не существует); `CAPABILITIES.md:17-26` («6 ролей» — фактически 9; инженеру создание заявок запрещено — API разрешает); `CAPABILITIES.md:86`, `INSTRUCTION.md:52`, `API.md:276` (в отчёты не включён director — код `reports.py:21` включает); `CAPABILITIES.md:100`, `ToDo.md:15` (SMTP «зарезервирован» — реализован, `mail_service.py:43,58`); `CAPABILITIES.md:174-183` (seed-данные — кода нет); `API.md:335` (`/health` → фактически `/api/health`); `API.md:306,319` (поля replacement/insert описаны до v3.01b6); `ToDo.md:51` («30-дневный токен» — код 7 дней, `router.py:254`); `DESCRIPTION.md:20` (WebSocket в стеке — эндпоинтов нет); `vite.config.ts:8` (dev-сервер на 0.0.0.0 — informational)
- **Исправление**: синхронизировать документы с кодом.

### K3-050 [LOW] Dockerfile: тихий пропуск зависимостей при отсутствии lock
- **Файл**: `docker/Dockerfile:12-16` — без `requirements.lock` образ соберётся и упадёт при старте контейнера.
- **Исправление**: `test -f requirements.lock` с ошибкой сборки.

### K3-051 [LOW] Compose: без лимитов ресурсов и ротации логов; redis без healthcheck/персистентности; нет backup-job
- **Файл**: `docker/docker-compose.yml` — json-file логи растут бесконечно; redis только localhost (смягчает); бэкапы на сломанном archive.sh (K3-017).

### K3-052 [LOW] Лог-инъекция через email при неудачном входе
- **Файл**: `backend/src/api/router.py:243` — пользовательский email пишется в лог verbatim (переводы строк → подделка записей).
- **Исправление**: sanitize (`repr`/удаление \r\n) перед логированием.

### K3-053 [LOW] Мёртвая ветка is_internal в attachments + orphan-риск
- **Файл**: `backend/src/api/attachments.py:83-93` — ветка `att.comment_id` без проверки `is_internal` недостижима (upload всегда ставит ticket_id, `attachment_service.py:56`; Comment.ticket_id NOT NULL) — defense-in-depth пробел на будущее.
- **Исправление**: добавить проверку is_internal в ветку для симметрии.

---

## 6. Вердикт

**AUDIT COMPLETE — ISSUES FOUND**
