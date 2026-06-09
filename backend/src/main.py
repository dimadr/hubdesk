import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from src.api.router import api_router
from src.database import Base, async_session, engine

from src.models.customer import Customer
from src.models.equipment import AssetLocation
from src.models.ticket import Ticket, TicketPriority, TicketStatus, TicketType
from src.models.user import User, UserRole, UserStatus
from src.models.warehouse import (
    AccountingDocument,
    DocStatus,
    DocType,
    DocumentLine,
    Nomenclature,
    NomenclatureType,
    StockBalance,
    Warehouse,
    WarehouseType,
)

FRONTEND_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "frontend",
    "dist",
)
STATIC_DIR = (
    os.path.join(FRONTEND_DIR, "assets")
    if os.path.exists(os.path.join(FRONTEND_DIR, "assets"))
    else None
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    new_columns = [
        ("type", "VARCHAR(50)"),
        ("site_contact_name", "VARCHAR(255)"),
        ("site_contact_phone", "VARCHAR(50)"),
        ("scheduled_start", "TIMESTAMP"),
        ("scheduled_end", "TIMESTAMP"),
        ("source_description", "VARCHAR(5000)"),
        ("archived_at", "TIMESTAMP"),
        ("contact_name", "VARCHAR(255)"),
        ("contact_phone", "VARCHAR(50)"),
        ("contact_email", "VARCHAR(255)"),
    ]

    for col_name, col_type in new_columns:
        try:
            async with engine.begin() as conn:
                await conn.execute(
                    text(f"ALTER TABLE tickets ADD COLUMN {col_name} {col_type}")
                )
        except Exception:
            pass

    import asyncio as _asyncio

    async def _mail_worker():
        from src.services.mail_service import MailService

        while True:
            try:
                async with async_session() as s:
                    await MailService.fetch_and_create_tickets(s)
            except Exception:
                pass
            await _asyncio.sleep(120)

    _mail_task = _asyncio.create_task(_mail_worker())

    yield

    _mail_task.cancel()
    try:
        await _mail_task
    except _asyncio.CancelledError:
        pass


app = FastAPI(title="HubDesk", version="0.2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok"}


if FRONTEND_DIR and os.path.exists(FRONTEND_DIR):
    if STATIC_DIR and os.path.exists(STATIC_DIR):
        app.mount("/assets", StaticFiles(directory=STATIC_DIR), name="assets")

    @app.get("/")
    async def root():
        return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))

    @app.get("/{path:path}")
    async def spa_fallback(path: str):
        index = os.path.join(FRONTEND_DIR, "index.html")
        if os.path.exists(index):
            return FileResponse(index)
        return {"detail": "Not Found"}
