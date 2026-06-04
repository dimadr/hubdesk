from sqlalchemy.ext.asyncio import AsyncSession


class AuditMixin:
    async def log_transition_impl(
        self,
        session: AsyncSession,
        transition_class: type,
        entity_id: int,
        from_status: str,
        to_status: str,
        user_id: int,
        meta: dict | None = None,
    ):
        tablename = transition_class.__tablename__
        prefix = tablename.split("_")[0]
        record = transition_class(
            **{f"{prefix}_id": entity_id},
            from_status=from_status,
            to_status=to_status,
            user_id=user_id,
            meta=meta or {},
        )
        session.add(record)
        await session.flush()
