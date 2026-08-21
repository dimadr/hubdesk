import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.models.device_session import DeviceSession
from src.models.user import User, UserStatus
from src.services.audit_service import log_audit


class DeviceSessionService:
    def __init__(self, session: AsyncSession):
        self.session = session

    @staticmethod
    def hash_token(token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    async def create(self, user: User, device_name: str | None) -> tuple[DeviceSession, str]:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        refresh_token = secrets.token_urlsafe(48)
        device_session = DeviceSession(
            user_id=user.id,
            token_hash=self.hash_token(refresh_token),
            device_name=(device_name or "Мобильное устройство").strip() or "Мобильное устройство",
            created_at=now,
            last_used_at=now,
            expires_at=now + timedelta(days=settings.device_session_ttl_days),
        )
        self.session.add(device_session)
        await self.session.flush()
        await log_audit(
            self.session, user, "device_session_created", "device_session",
            device_session.id,
            f"Зарегистрировано доверенное устройство: {device_session.device_name}",
        )
        return device_session, refresh_token

    async def refresh(self, refresh_token: str) -> tuple[DeviceSession, User]:
        result = await self.session.execute(
            select(DeviceSession)
            .where(DeviceSession.token_hash == self.hash_token(refresh_token))
            .with_for_update()
        )
        device_session = result.scalar_one_or_none()
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        if (
            device_session is None
            or device_session.revoked_at is not None
            or device_session.expires_at <= now
        ):
            raise HTTPException(401, "Сессия устройства недействительна")

        user = await self.session.get(User, device_session.user_id)
        if user is None or user.status != UserStatus.active:
            raise HTTPException(401, "Учётная запись недоступна")

        device_session.last_used_at = now
        device_session.expires_at = now + timedelta(days=settings.device_session_ttl_days)
        await self.session.flush()
        return device_session, user

    async def revoke_by_token(self, refresh_token: str) -> None:
        result = await self.session.execute(
            select(DeviceSession).where(
                DeviceSession.token_hash == self.hash_token(refresh_token)
            )
        )
        device_session = result.scalar_one_or_none()
        if device_session is None or device_session.revoked_at is not None:
            return
        device_session.revoked_at = datetime.now(timezone.utc).replace(tzinfo=None)
        user = await self.session.get(User, device_session.user_id)
        if user is not None:
            await log_audit(
                self.session, user, "device_session_revoked", "device_session",
                device_session.id,
                f"Отозвана сессия устройства: {device_session.device_name}",
            )
        await self.session.flush()

    async def list_active(self, user: User) -> list[DeviceSession]:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        result = await self.session.execute(
            select(DeviceSession)
            .where(
                DeviceSession.user_id == user.id,
                DeviceSession.revoked_at.is_(None),
                DeviceSession.expires_at > now,
            )
            .order_by(DeviceSession.last_used_at.desc())
        )
        return list(result.scalars().all())

    async def revoke(self, session_id: int, user: User) -> None:
        device_session = await self.session.get(DeviceSession, session_id)
        if device_session is None or device_session.user_id != user.id:
            raise HTTPException(404, "Сессия устройства не найдена")
        if device_session.revoked_at is not None:
            return
        device_session.revoked_at = datetime.now(timezone.utc).replace(tzinfo=None)
        await log_audit(
            self.session, user, "device_session_revoked", "device_session",
            device_session.id,
            f"Отозвана сессия устройства: {device_session.device_name}",
        )
        await self.session.flush()
