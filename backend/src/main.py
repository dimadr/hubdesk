import os
import asyncio
import logging
from contextlib import asynccontextmanager

# Monkey-patch passlib для bcrypt >= 4.1 (убран __about__)
import bcrypt
if not hasattr(bcrypt, '__about__'):
    class _About:
        __version__ = bcrypt.__version__
    bcrypt.__about__ = _About()

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from src.api.router import api_router
from src.database import async_session, engine
from src.core.http_client import set_http_client

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Docker: /frontend/dist, локально: ../frontend/dist
if os.path.exists("/frontend/dist"):
    FRONTEND_DIR = "/frontend/dist"
else:
    FRONTEND_DIR = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        "frontend", "dist",
    )
STATIC_DIR = os.path.join(FRONTEND_DIR, "assets") if os.path.exists(os.path.join(FRONTEND_DIR, "assets")) else None


async def mail_worker_loop():
    from src.services.mail_service import MailService

    await asyncio.sleep(10)
    logger.info("Фоновый почтовый воркер запущен.")
    while True:
        try:
            async with async_session() as session:
                await MailService.fetch_and_create_tickets(session)
        except asyncio.CancelledError:
            logger.info("Получен сигнал остановки почтового воркера.")
            break
        except Exception as e:
            logger.error(f"Ошибка почтового воркера: {e}", exc_info=True)

        await asyncio.sleep(120)


@asynccontextmanager
async def lifespan(app: FastAPI):
    http_client = httpx.AsyncClient(timeout=10.0)
    set_http_client(http_client)

    mail_task = None
    if os.getenv("ENABLE_MAIL_WORKER", "").lower() == "true":
        mail_task = asyncio.create_task(mail_worker_loop())

    if os.getenv("ENABLE_AUTO_MIGRATIONS", "").lower() == "true":
        migrations = [
            "ALTER TYPE tickettype ADD VALUE IF NOT EXISTS 'verification'",
            "ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'director'",
            "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id)",
            "ALTER TABLE replacement_devices ADD COLUMN IF NOT EXISTS serial_number VARCHAR(100) DEFAULT ''",
            "ALTER TABLE replacement_devices ADD COLUMN IF NOT EXISTS accuracy_class VARCHAR(50)",
            "ALTER TABLE replacement_devices ADD COLUMN IF NOT EXISTS mounting VARCHAR(50)",
            "ALTER TABLE mailbox_config DROP COLUMN IF EXISTS password",
            "ALTER TABLE insert_products ADD COLUMN IF NOT EXISTS diameter_outer VARCHAR(50)",
            "ALTER TABLE insert_products ADD COLUMN IF NOT EXISTS notes VARCHAR(1000)",
            "ALTER TABLE insert_products ADD COLUMN IF NOT EXISTS cell VARCHAR(100)",
            # Миграция статусов заявок: ON_THE_WAY→IN_PROGRESS, ARRIVED→IN_PROGRESS, REVIEW→COMPLETED
            "UPDATE tickets SET status = 'IN_PROGRESS' WHERE status = 'ON_THE_WAY'",
            "UPDATE tickets SET status = 'IN_PROGRESS' WHERE status = 'ARRIVED'",
            "UPDATE tickets SET status = 'COMPLETED' WHERE status = 'REVIEW'",
            "UPDATE ticket_transitions SET from_status = 'IN_PROGRESS' WHERE from_status = 'ON_THE_WAY'",
            "UPDATE ticket_transitions SET from_status = 'IN_PROGRESS' WHERE from_status = 'ARRIVED'",
            "UPDATE ticket_transitions SET from_status = 'COMPLETED' WHERE from_status = 'REVIEW'",
            "UPDATE ticket_transitions SET to_status = 'IN_PROGRESS' WHERE to_status = 'ON_THE_WAY'",
            "UPDATE ticket_transitions SET to_status = 'IN_PROGRESS' WHERE to_status = 'ARRIVED'",
            "UPDATE ticket_transitions SET to_status = 'COMPLETED' WHERE to_status = 'REVIEW'",
            # Пересоздание enum ticketstatus с новыми значениями
            "DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid=e.enumtypid WHERE t.typname='ticketstatus' AND e.enumlabel IN ('ON_THE_WAY','ARRIVED','REVIEW')) THEN ALTER TABLE tickets ALTER COLUMN status TYPE VARCHAR(50); DROP TYPE ticketstatus; CREATE TYPE ticketstatus AS ENUM ('ASSIGNED','ACCEPTED','IN_PROGRESS','COMPLETED'); ALTER TABLE tickets ALTER COLUMN status TYPE ticketstatus USING status::ticketstatus; ALTER TABLE ticket_transitions ALTER COLUMN from_status TYPE ticketstatus USING from_status::ticketstatus; ALTER TABLE ticket_transitions ALTER COLUMN to_status TYPE ticketstatus USING to_status::ticketstatus; END IF; END $$",
        ]
        for sql in migrations:
            try:
                async with engine.begin() as conn:
                    await conn.execute(text(sql))
            except Exception as e:
                logger.warning(f"Миграция не выполнена: {sql[:60]}... — {e}")

        # Переименование diameter → diameter_inner (идемпотентно)
        try:
            async with engine.begin() as conn:
                result = await conn.execute(text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_name = 'insert_products' AND column_name = 'diameter'"
                ))
                if result.fetchone():
                    await conn.execute(text("ALTER TABLE insert_products RENAME COLUMN diameter TO diameter_inner"))
        except Exception as e:
            logger.warning(f"Миграция rename diameter: {e}")

        # replacement_transactions
        try:
            async with engine.begin() as conn:
                await conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS replacement_transactions (
                        id SERIAL PRIMARY KEY,
                        type VARCHAR(20) NOT NULL,
                        device_id INTEGER NOT NULL REFERENCES replacement_devices(id),
                        quantity INTEGER NOT NULL,
                        taken_by_id INTEGER REFERENCES users(id),
                        location_id INTEGER REFERENCES asset_locations(id),
                        comment VARCHAR(1000),
                        document VARCHAR(255),
                        created_at TIMESTAMP DEFAULT NOW()
                    )
                """))
        except Exception as e:
            logger.warning(f"Миграция replacement_transactions: {e}")

        # Перенос данных
        try:
            async with engine.begin() as conn:
                result = await conn.execute(text("""
                    SELECT column_name FROM information_schema.columns
                    WHERE table_name = 'replacement_devices' AND column_name = 'taken_by_id'
                """))
                if result.fetchone():
                    await conn.execute(text("""
                        INSERT INTO replacement_transactions (type, device_id, quantity, taken_by_id, location_id)
                        SELECT 'incoming', id, 1, NULL, NULL
                        FROM replacement_devices
                        WHERE id NOT IN (SELECT device_id FROM replacement_transactions)
                    """))
                    await conn.execute(text("""
                        INSERT INTO replacement_transactions (type, device_id, quantity, taken_by_id, location_id, comment)
                        SELECT 'outgoing', id, 1, taken_by_id, location_id, 'Миграция: прибор выдан (исторические данные)'
                        FROM replacement_devices
                        WHERE taken_by_id IS NOT NULL
                          AND id NOT IN (SELECT device_id FROM replacement_transactions WHERE type = 'outgoing')
                    """))
                    await conn.execute(text("ALTER TABLE replacement_devices DROP COLUMN IF EXISTS taken_by_id"))
                    await conn.execute(text("ALTER TABLE replacement_devices DROP COLUMN IF EXISTS location_id"))
                    await conn.execute(text("ALTER TABLE replacement_devices DROP COLUMN IF EXISTS return_date"))
                    await conn.execute(text("ALTER TABLE replacement_devices DROP COLUMN IF EXISTS status"))
        except Exception as e:
            logger.warning(f"Миграция данных replacement: {e}")

    yield

    logger.info("Остановка приложения: завершение фонового воркера...")
    if mail_task:
        mail_task.cancel()
        try:
            await mail_task
        except asyncio.CancelledError:
            pass

    await http_client.aclose()
    await engine.dispose()
    logger.info("Пул соединений базы данных закрыт. Приложение остановлено.")


app = FastAPI(
    title="HubDesk",
    version="0.2.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()] if os.getenv("ALLOWED_ORIGINS") else []

if ALLOWED_ORIGINS and ALLOWED_ORIGINS != [""]:
    # Явные origins — можно credentials
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    # Нет origins — wildcard, credentials запрещены (CORS spec)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.include_router(api_router, prefix="/api")


@app.get("/api/health", tags=["Infrastructure"])
async def health():
    return {"status": "ok"}


if os.path.exists(FRONTEND_DIR):
    if STATIC_DIR and os.path.exists(STATIC_DIR):
        app.mount("/assets", StaticFiles(directory=STATIC_DIR), name="assets")

    @app.get("/")
    async def root():
        return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))

    @app.get("/{path:path}")
    async def spa_fallback(path: str):
        if path.startswith("api/"):
            return JSONResponse(status_code=404, content={"detail": "Not Found"})

        index_path = os.path.join(FRONTEND_DIR, "index.html")
        if os.path.exists(index_path):
            return FileResponse(index_path)
        return JSONResponse(status_code=404, content={"detail": "Not Found"})
