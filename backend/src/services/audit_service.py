import logging
from typing import Any
from sqlalchemy.ext.asyncio import AsyncSession
from src.models.audit_log import AuditLog
from src.models.user import User

logger = logging.getLogger(__name__)


async def log_audit(
    db: AsyncSession,
    user: User | None,
    action: str,
    entity_type: str | None = None,
    entity_id: int | None = None,
    detail: str = "",
    meta: Any | None = None,
) -> AuditLog | None:
    savepoint = await db.begin_nested()
    try:
        entry = AuditLog(
            user_id=user.id if user else None,
            user_name=getattr(user, "name", "СИСТЕМА") if user else "СИСТЕМА",
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            detail=detail,
            meta=meta,
        )
        db.add(entry)
        await db.flush()
        await savepoint.commit()
        return entry
    except Exception as e:
        await savepoint.rollback()
        logger.error(f"Не удалось записать audit log: {e}", exc_info=True)
        return None
