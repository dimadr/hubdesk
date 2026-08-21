from datetime import datetime, timedelta
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from src.config import settings
from src.database import get_db, async_session
from src.models.device_session import DeviceSession
from src.models.user import User, UserStatus

security = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing token")
    try:
        payload = jwt.decode(
            credentials.credentials,
            settings.secret_key,
            algorithms=["HS256"],
        )
        user_id_str = payload.get("sub")
        if user_id_str is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
        user_id = int(user_id_str)
        session_id = payload.get("sid")
    except (JWTError, TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    if session_id is not None:
        try:
            session_id = int(session_id)
        except (TypeError, ValueError):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
        device_session = await db.get(DeviceSession, session_id)
        now = datetime.utcnow()
        if (
            device_session is None
            or device_session.user_id != user.id
            or device_session.revoked_at is not None
            or device_session.expires_at <= now
        ):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Device session is not active")
    if user.status != UserStatus.active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Учётная запись не активна")
    return user


def create_token(user_id: int, ttl: int | None = None, session_id: int | None = None) -> str:
    expire = datetime.utcnow() + timedelta(seconds=ttl or settings.access_token_ttl)
    payload = {"sub": str(user_id), "exp": expire}
    if session_id is not None:
        payload["sid"] = str(session_id)
    return jwt.encode(
        payload,
        settings.secret_key,
        algorithm="HS256",
    )


async def get_api_key(request: Request):
    from src.models.api_key import ApiKey
    key = request.headers.get("X-Api-Key") or request.headers.get("Authorization", "").removeprefix("Bearer ")
    if not key:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="API key required")
    key_hash = ApiKey.hash_key(key)
    async with async_session() as db:
        result = await db.execute(select(ApiKey).where(ApiKey.key_hash == key_hash, ApiKey.is_active == True))
        api_key = result.scalar_one_or_none()
        if not api_key:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key")
        return api_key
