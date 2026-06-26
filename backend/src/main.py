import os
import asyncio
import logging
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from src.api.router import api_router
from src.database import async_session, engine
from src.core.http_client import set_http_client

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

FRONTEND_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "frontend",
    "dist",
)
STATIC_DIR = os.path.join(FRONTEND_DIR, "assets") if os.path.exists(os.path.join(FRONTEND_DIR, "assets")) else None


async def mail_worker_loop():
    from src.services.mail_service import MailService

    logger.info("Фоновый почтовый воркер успешно запущен.")
    while True:
        try:
            async with async_session() as session:
                await MailService.fetch_and_create_tickets(session)
        except asyncio.CancelledError:
            logger.info("Получен сигнал остановки почтового воркера.")
            break
        except Exception as e:
            logger.error(f"Ошибка в работе почтового воркера: {e}", exc_info=True)

        await asyncio.sleep(120)


@asynccontextmanager
async def lifespan(app: FastAPI):
    http_client = httpx.AsyncClient(timeout=10.0)
    set_http_client(http_client)

    mail_task = asyncio.create_task(mail_worker_loop())

    # RC: миграции на старте отключены — включать только через ENABLE_AUTO_MIGRATIONS=true
    if os.getenv("ENABLE_AUTO_MIGRATIONS", "").lower() == "true":
        try:
            async with engine.begin() as conn:
                await conn.execute(text("ALTER TYPE tickettype ADD VALUE IF NOT EXISTS 'verification'"))
        except Exception:
            pass

        try:
            async with engine.begin() as conn:
                await conn.execute(text("ALTER TABLE replacement_devices ADD COLUMN IF NOT EXISTS serial_number VARCHAR(100) DEFAULT ''"))
        except Exception:
            pass

        try:
            async with engine.begin() as conn:
                await conn.execute(text("ALTER TABLE replacement_devices ADD COLUMN IF NOT EXISTS accuracy_class VARCHAR(50)"))
        except Exception:
            pass

        try:
            async with engine.begin() as conn:
                await conn.execute(text("ALTER TABLE replacement_devices ADD COLUMN IF NOT EXISTS mounting VARCHAR(50)"))
        except Exception:
            pass

        try:
            async with engine.begin() as conn:
                await conn.execute(text("ALTER TABLE mailbox_config DROP COLUMN IF EXISTS password"))
        except Exception:
            pass

    try:
        async with engine.begin() as conn:
            await conn.execute(text("ALTER TABLE insert_products RENAME COLUMN diameter TO diameter_inner"))
    except Exception:
        pass

    try:
        async with engine.begin() as conn:
            await conn.execute(text("ALTER TABLE insert_products ADD COLUMN IF NOT EXISTS diameter_outer VARCHAR(50)"))
    except Exception:
        pass

    try:
        async with engine.begin() as conn:
            await conn.execute(text("ALTER TABLE insert_products ADD COLUMN IF NOT EXISTS notes VARCHAR(1000)"))
    except Exception:
        pass

    try:
        async with engine.begin() as conn:
            await conn.execute(text("ALTER TABLE insert_products ADD COLUMN IF NOT EXISTS cell VARCHAR(100)"))
    except Exception:
        pass

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
    except Exception:
        pass

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
                """))
                await conn.execute(text("ALTER TABLE replacement_devices DROP COLUMN IF EXISTS taken_by_id"))
                await conn.execute(text("ALTER TABLE replacement_devices DROP COLUMN IF EXISTS location_id"))
                await conn.execute(text("ALTER TABLE replacement_devices DROP COLUMN IF EXISTS return_date"))
                await conn.execute(text("ALTER TABLE replacement_devices DROP COLUMN IF EXISTS status"))
    except Exception:
        pass

    yield

    logger.info("Остановка приложения: завершение фонового воркера...")
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

ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "*").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
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
        if path.startswith("api"):
            return {"detail": "Not Found"}

        index_path = os.path.join(FRONTEND_DIR, "index.html")
        if os.path.exists(index_path):
            return FileResponse(index_path)
        return {"detail": "Not Found"}
