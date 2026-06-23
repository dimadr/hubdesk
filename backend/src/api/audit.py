from typing import Any
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, desc, and_
from pydantic import BaseModel, ConfigDict
from datetime import datetime
from passlib.hash import bcrypt
from src.database import get_db
from src.models.audit_log import AuditLog
from src.models.user import User, UserRole
from src.core.deps import get_current_user

audit_router = APIRouter(prefix="/audit-log", tags=["Audit Log"])


class AuditLogResponse(BaseModel):
    id: int
    user_id: int | None = None
    user_name: str | None = None
    action: str
    entity_type: str | None = None
    entity_id: int | None = None
    detail: str
    meta: Any | None = None
    ip_address: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ClearRequest(BaseModel):
    password: str


@audit_router.get("", response_model=list[AuditLogResponse])
async def list_logs(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    user_id: int | None = None,
    action: str | None = None,
    entity_type: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    q: str | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role not in (UserRole.admin, UserRole.manager):
        raise HTTPException(403, "Недостаточно прав для просмотра логов")

    conditions = []

    if user_id:
        conditions.append(AuditLog.user_id == user_id)
    if action:
        conditions.append(AuditLog.action == action)
    if entity_type:
        conditions.append(AuditLog.entity_type == entity_type)

    try:
        if date_from:
            conditions.append(AuditLog.created_at >= datetime.fromisoformat(date_from))
        if date_to:
            conditions.append(AuditLog.created_at <= datetime.fromisoformat(date_to))
    except ValueError:
        raise HTTPException(400, "Неверный формат даты (ожидается ISO 8601)")

    if q:
        conditions.append(
            AuditLog.detail.ilike(f"%{q}%") | AuditLog.user_name.ilike(f"%{q}%")
        )

    stmt = select(AuditLog).order_by(desc(AuditLog.id))
    if conditions:
        stmt = stmt.where(and_(*conditions))
    stmt = stmt.offset((page - 1) * limit).limit(limit)

    result = await db.execute(stmt)
    logs = result.scalars().all()

    return logs


@audit_router.delete("")
async def clear_logs(
    data: ClearRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role != UserRole.admin:
        raise HTTPException(403, "Только администратор может очистить журнал")

    if not await run_in_threadpool(bcrypt.verify, data.password, user.password_hash):
        raise HTTPException(403, "Неверный пароль")

    await db.execute(delete(AuditLog))
    await db.commit()

    return {"ok": True, "detail": "Журнал очищен"}
