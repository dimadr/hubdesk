# Абие

[![FastAPI](https://img.shields.io/badge/FastAPI-0.115%2B-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=111111)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)](https://docs.docker.com/compose/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Русский интерфейс · Self-hosted · RC**

Система управления выездным обслуживанием: заявки, объекты, инженеры, календарь, склад, подменный фонд и отчётность в одном веб-приложении.

«Абие» разворачивается на собственном сервере и рассчитана на внутреннюю работу сервисной организации. Frontend и API собираются в единый контейнер приложения; данные хранятся в PostgreSQL.

> Проект находится в режиме RC. Перед обновлением рабочего экземпляра создавайте резервную копию и проверяйте изменения в контролируемой среде.

## Возможности

### Заявки

- жизненный цикл через FSM: `ASSIGNED → ACCEPTED → IN_PROGRESS → COMPLETED`
- возврат заявки на предыдущий этап по разрешённым FSM-переходам
- обязательные поля чек-листа и обязательные фотографии блокируют завершение
- автоматическое архивирование завершённых заявок
- тип, приоритет, объект, оборудование, исполнитель, контакты и срок исполнения
- комментарии, вложения и внутренние материалы
- SLA, сроки реакции и решения, индикация просрочек
- таблица, карточки, поиск, фильтры и сохранённые представления
- аудит изменений и переходов статуса

### Календарь и Kanban

- месячный календарь заявок по сроку исполнения
- создание заявки кликом по дню через существующую форму
- администратор и директор назначают любого доступного инженера
- инженер создаёт календарную заявку только на себя
- просмотр заявки из календаря без редактирования
- личная Kanban-доска инженера
- просмотр досок инженеров администратором и директором

### Объекты

- реестр объектов обслуживания с адресом, заказчиком и договором
- несколько контактных лиц на объекте
- закрепление ответственного инженера
- поиск организации по ИНН через DaData при наличии API-ключа
- список всех доступных работ по объекту
- переход из списка работ в полную карточку заявки
- последовательная загрузка больших списков заявок

### Склад

- номенклатура материалов, продукции, услуг и работ
- документы прихода, перемещения и списания
- FSM документа: `DRAFT → APPROVAL → DELIVERY → ACCOUNTED`
- изменение остатков только при проведении учётного документа
- защита от отрицательного остатка
- блокировка строки баланса при конкурентном изменении
- отдельный учёт вставок и подменного фонда
- история движений и выдачи на объекты

### Отчёты и администрирование

- отчёты по заявкам, объектам и инженерам
- показатели открытых, завершённых и просроченных работ
- среднее время выполнения и показатели SLA
- управление пользователями, заказчиками и регистрациями
- журнал действий
- API-ключи для внешних интеграций
- IMAP-создание заявок и SMTP-уведомления при включённом почтовом worker

## Роли

Backend применяет ACL независимо от интерфейса. Скрытая кнопка не считается проверкой прав.

| Роль | Основная область доступа |
|---|---|
| `admin` | Полное администрирование и операционная работа |
| `director` | Операционная работа, отчёты, журнал и контроль инженеров |
| `dispatcher` | Заявки, назначения, объекты и отчёты |
| `engineer` | Назначенные заявки, собственная доска и закреплённые объекты |
| `storekeeper` | Складские операции |
| `metrologist` | Склад, вставки и метрологический учёт |
| `accountant` | Отчёты, объекты, сотрудники и склад в доступном режиме |
| `customer` | Заявки и объекты своего заказчика |
| `viewer` | Доступный режим чтения |

Саморегистрация создаёт пользователя со статусом `pending` и ролью `viewer`. Доступ появляется после решения администратора. Минимальная длина нового пароля в текущей версии — 12 символов.

## Архитектура

```text
Browser
   |
   v
FastAPI + Uvicorn :8000
   |
   +-- /                 React SPA
   +-- /api/*            REST API
   +-- /api/docs         OpenAPI / Swagger UI
   +-- /api/health       Application and database health
   +-- /files/*          Protected attachments
   |
   +--> PostgreSQL :5432
   |
   +--> Redis :6379 (configured infrastructure)
   |
   +--> IMAP / SMTP / DaData (optional integrations)
```

В Docker Compose порт приложения публикуется как `8002`, PostgreSQL — только на `127.0.0.1:5434`, Redis — только на `127.0.0.1:6380`.

Приложение построено как модульный монолит:

```text
backend/
├── src/
│   ├── api/          FastAPI routers and schemas
│   ├── core/         dependencies, HTTP client, exceptions
│   ├── models/       async SQLAlchemy models
│   ├── services/     business logic, ACL, FSM, SLA
│   └── ws/           WebSocket infrastructure
├── tests/            pytest and acceptance tests
└── migrations/       Alembic revisions

frontend/
├── src/
│   ├── api/          Axios client and API types
│   ├── components/   reusable UI components
│   ├── pages/        application sections
│   └── store/        Zustand state
└── index.html

docker/
├── Dockerfile
└── docker-compose.yml
```

Ключевые ограничения домена:

- статусы заявок меняются только через FSM
- завершение проверяет обязательный чек-лист и фотографии
- складские остатки меняются только через учётные документы
- backend повторно проверяет права и входные данные
- бизнес-правила должны находиться в сервисном слое

## Требования

- Linux-сервер с Docker Engine
- Docker Compose v2
- свободный TCP-порт `8002`
- отдельные секреты PostgreSQL и приложения

Для production-доступа рекомендуется reverse proxy с TLS. Встроенная Compose-конфигурация публикует приложение по HTTP и не настраивает HTTPS.

## Конфигурация

Compose читает настройки из `backend/.env`. Файл не входит в Git и не должен публиковаться.

Минимальная конфигурация:

```dotenv
POSTGRES_USER=replace_me
POSTGRES_PASSWORD=replace_with_a_long_random_password
SECRET_KEY=replace_with_a_long_random_secret

ENABLE_MAIL_WORKER=false
ENABLE_AUTO_MIGRATIONS=false
ALLOWED_ORIGINS=
```

Случайный `SECRET_KEY` можно получить командой:

```bash
openssl rand -hex 32
```

Дополнительные параметры:

| Переменная | Назначение |
|---|---|
| `ACCESS_TOKEN_TTL` | Срок жизни JWT в секундах |
| `ALLOWED_ORIGINS` | Разрешённые CORS origins через запятую |
| `ENABLE_MAIL_WORKER` | Включение фоновой проверки почты |
| `MAILBOX_EMAIL` | Адрес почтового ящика |
| `MAILBOX_PASSWORD` | Пароль почтового ящика |
| `MAILBOX_IMAP_SERVER` | IMAP-сервер |
| `MAILBOX_IMAP_PORT` | IMAP-порт |
| `SMTP_SERVER` | SMTP-сервер |
| `SMTP_PORT` | SMTP-порт |
| `DADATA_API_KEY` | Поиск организации по ИНН |
| `ENABLE_AUTO_MIGRATIONS` | Выполнение встроенных совместимых миграций при старте |

`ENABLE_AUTO_MIGRATIONS` по умолчанию выключен. Не включайте его на рабочей базе без резервной копии и проверки набора миграций текущей версии.

## Запуск

Собрать образы и запустить сервисы:

```bash
docker compose -f docker/docker-compose.yml up -d --build
```

Проверить контейнеры:

```bash
docker compose -f docker/docker-compose.yml ps
```

Проверить приложение и PostgreSQL:

```bash
curl -fsS http://127.0.0.1:8002/api/health
```

Ожидаемый ответ:

```json
{"status":"ok","db":"ok"}
```

Интерфейс:

```text
http://SERVER_IP:8002/
```

Документация API:

```text
http://SERVER_IP:8002/api/docs
http://SERVER_IP:8002/api/redoc
```

Стандартные учётные данные автоматически не создаются. Первую административную учётную запись должен подготовить администратор развёртывания по принятой локальной процедуре.

## Эксплуатация

### Логи

```bash
docker compose -f docker/docker-compose.yml logs -f app
docker compose -f docker/docker-compose.yml logs -f db
```

### Пересборка приложения

После изменения frontend или backend:

```bash
docker compose -f docker/docker-compose.yml build app
docker compose -f docker/docker-compose.yml up -d --no-deps app
```

Эти команды заменяют только контейнер приложения и не перезапускают PostgreSQL и Redis.

### Остановка

```bash
docker compose -f docker/docker-compose.yml stop
```

Не используйте `down -v`, если не собираетесь удалить постоянные Docker volumes с базой данных и вложениями.

## Резервное копирование

Создать архив исходников и дамп PostgreSQL:

```bash
bash ./archive.sh v3.01b1
```

Архив создаётся в корне проекта и содержит `database.dump`. Из него исключаются:

- `.env` и другие файлы секретов
- Git metadata
- зависимости и build-артефакты
- тесты
- существующие архивы и SQL-дампы
- каталог `uploads`

Важно: `archive.sh` не копирует Docker volume с вложениями. Для полного аварийного восстановления храните отдельно:

1. архив проекта с `database.dump`
2. защищённую копию `backend/.env`
3. копию Docker volume `uploads`
4. проверенную инструкцию восстановления

Храните хотя бы одну резервную копию вне рабочего сервера.

## Проверки

Backend:

```bash
cd backend
python -m pytest
```

Frontend:

```bash
cd frontend
npm run build
```

Статическая TypeScript-проверка без записи артефактов:

```bash
cd frontend
./node_modules/.bin/tsc --noEmit --incremental false
```

Запускайте backend-тесты только с изолированной тестовой конфигурацией, не направленной на рабочую базу данных.

## Безопасность

- JWT-аутентификация с обязательным `SECRET_KEY`
- хеширование паролей через bcrypt
- серверный ACL для заявок, объектов, файлов и административных операций
- защищённая выдача вложений с проверкой пользователя и связанной заявки
- ограничение входа: 5 попыток с одного IP за 10 минут
- PostgreSQL и Redis не публикуются во внешнюю сеть
- секреты и почтовые пароли хранятся в `.env`, а не в базе
- регистрация требует согласия на обработку персональных данных и подтверждения администратора

Никогда не публикуйте:

```text
backend/.env
SECRET_KEY
пароли PostgreSQL и почты
API-ключ DaData
дампы базы данных
резервные архивы
вложения пользователей
```

Перед внешней публикацией сервиса настройте TLS, firewall, резервное копирование, мониторинг и регулярное обновление базовых образов.

## Диагностика

### Healthcheck возвращает `503`

Проверьте PostgreSQL и журнал приложения:

```bash
docker compose -f docker/docker-compose.yml ps
docker compose -f docker/docker-compose.yml logs --tail=200 db app
```

### После изменения frontend видна старая версия

Пересоберите только `app`:

```bash
docker compose -f docker/docker-compose.yml build app
docker compose -f docker/docker-compose.yml up -d --no-deps app
```

После запуска обновите страницу без кеша.

### Приложение не запускается без `.env`

Проверьте наличие `POSTGRES_USER`, `POSTGRES_PASSWORD` и `SECRET_KEY`. Пустой `SECRET_KEY` намеренно блокирует старт.

### Почта не создаёт заявки

Проверьте:

- `ENABLE_MAIL_WORKER=true`
- параметры `MAILBOX_*`
- доступность IMAP-сервера из контейнера
- журнал контейнера `app`

## Документация

- [API](API.md)
- [Инструкция пользователя](INSTRUCTION.md)
- [Документы FSM](fsm_docs/)
- [Спецификация домена и API](okdesk_spec/)

## Лицензия

Проект распространяется по лицензии [MIT](LICENSE).

## Ответственность

Проект предоставляется «как есть». Администратор развёртывания отвечает за сервер, доступ пользователей, секреты, резервные копии, обновления, защиту персональных данных и соблюдение применимого законодательства.

Перед использованием в production проверьте конфигурацию, создайте резервную копию и протестируйте восстановление.
