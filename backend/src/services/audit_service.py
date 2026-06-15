from sqlalchemy.ext.asyncio import AsyncSession
from src.models.audit_log import AuditLog
from src.models.user import User


async def log_audit(
    db: AsyncSession,
    user: User | None,
    action: str,
    entity_type: str | None = None,
    entity_id: int | None = None,
    detail: str = "",
    meta: str | None = None,
):
    try:
        entry = AuditLog(
            user_id=user.id if user else None,
            user_name=user.name if user else "СИСТЕМА",
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            detail=detail,
            meta=meta,
        )
        db.add(entry)
        await db.flush()
        await db.commit()
    except Exception:
        pass
