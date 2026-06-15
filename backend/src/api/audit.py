from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, desc, func, and_
from pydantic import BaseModel
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
    user_name: str
    action: str
    entity_type: str | None = None
    entity_id: int | None = None
    detail: str
    meta: str | None = None
    ip_address: str | None = None
    created_at: str = ""

    model_config = {"from_attributes": True}


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
    conditions = []
    if user_id:
        conditions.append(AuditLog.user_id == user_id)
    if action:
        conditions.append(AuditLog.action == action)
    if entity_type:
        conditions.append(AuditLog.entity_type == entity_type)
    if date_from:
        try:
            conditions.append(AuditLog.created_at >= datetime.fromisoformat(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            conditions.append(AuditLog.created_at <= datetime.fromisoformat(date_to))
        except ValueError:
            pass
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

    return [
        AuditLogResponse(
            id=r.id, user_id=r.user_id, user_name=r.user_name, action=r.action,
            entity_type=r.entity_type, entity_id=r.entity_id, detail=r.detail,
            meta=r.meta, ip_address=r.ip_address,
            created_at=r.created_at.isoformat() if r.created_at else "",
        )
        for r in logs
    ]


class ClearRequest(BaseModel):
    password: str


@audit_router.delete("")
async def clear_logs(data: ClearRequest, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role != UserRole.admin:
        raise HTTPException(403, "Только администратор")
    if not bcrypt.verify(data.password, user.password_hash):
        raise HTTPException(403, "Неверный пароль")
    await db.execute(delete(AuditLog))
    await db.commit()
    return {"ok": True, "detail": "Журнал очищен"}
