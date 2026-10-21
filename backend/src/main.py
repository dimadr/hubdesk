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
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select, text

from src.api.router import api_router
from src.config import settings
from src.database import async_session, engine, Base
from src.models import *  # noqa: ensure all models are registered for create_all
from src.core.http_client import set_http_client
from src.core.deps import get_current_user
from src.database import get_db
from src.services.attachment_service import AttachmentService

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
    from src.models.mailbox import MailboxConfig

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

        # Read interval from DB, fallback to 120s
        interval = 120
        try:
            async with async_session() as session:
                cfg = (await session.execute(select(MailboxConfig).limit(1))).scalar_one_or_none()
                if cfg and cfg.check_interval_min:
                    interval = max(60, cfg.check_interval_min * 60)
        except Exception:
            logger.warning("Не удалось прочитать интервал почтового воркера", exc_info=True)
        await asyncio.sleep(interval)


@asynccontextmanager
async def lifespan(app: FastAPI):
    from src.core.schema import verify_schema
    await verify_schema(engine)
    if os.getenv("ENABLE_AUTO_MIGRATIONS", "").lower() == "true":
        raise RuntimeError("Use an explicitly approved alembic upgrade; startup migrations are disabled")
    http_client = httpx.AsyncClient(timeout=10.0)
    set_http_client(http_client)
    mail_task = None
    try:
        if os.getenv("ENABLE_MAIL_WORKER", "").lower() == "true":
            mail_task = asyncio.create_task(mail_worker_loop())
        yield
    finally:
        if mail_task:
            mail_task.cancel()
            try:
                await mail_task
            except asyncio.CancelledError:
                pass
        await http_client.aclose()
        await engine.dispose()
        logger.info("Database pool closed")


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
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return {"status": "ok", "db": "ok"}
    except Exception:
        return JSONResponse(status_code=503, content={"status": "degraded", "db": "unavailable"})


if os.path.exists(FRONTEND_DIR):
    if STATIC_DIR and os.path.exists(STATIC_DIR):
        app.mount("/assets", StaticFiles(directory=STATIC_DIR), name="assets")

    uploads_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "uploads")

    @app.get("/files/{file_path:path}")
    async def serve_file(file_path: str, user=Depends(get_current_user), db=Depends(get_db)):
        from sqlalchemy import select as sa_select
        from src.models.attachment import Attachment
        from src.models.user import UserRole

        real_path = os.path.realpath(os.path.join(uploads_dir, file_path))
        uploads_real = os.path.realpath(uploads_dir)
        if not real_path.startswith(uploads_real + os.sep) and real_path != uploads_real:
            return JSONResponse(status_code=403, content={"detail": "Forbidden"})
        if not os.path.isfile(real_path):
            return JSONResponse(status_code=404, content={"detail": "File not found"})

        rel_to_cwd = os.path.relpath(real_path, os.getcwd())
        rel_to_uploads = os.path.relpath(real_path, uploads_dir)
        result = await db.execute(sa_select(Attachment).where(
            Attachment.path.in_([rel_to_cwd, rel_to_uploads, real_path])
        ))
        att = result.scalar_one_or_none()
        if att:
            real_path = await AttachmentService(db).download_path(att, user, real_path)
        elif user.role not in (UserRole.admin, UserRole.director, UserRole.chief_accountant, UserRole.storekeeper):
            raise HTTPException(403, "Нет доступа к файлу")

        return FileResponse(
            real_path,
            filename=att.filename if att else os.path.basename(real_path),
            headers={"X-Content-Type-Options": "nosniff"},
        )

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
