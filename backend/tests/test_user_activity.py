import asyncio
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI
import httpx
import pytest
import pytest_asyncio
from sqlalchemy import select

from src.api.router import api_router
from src.core.deps import create_token
from src.database import get_db
from src.models.device_session import DeviceSession
from src.models.user import User, UserRole, UserStatus
from src.services.user_activity_service import UserActivityService


@pytest_asyncio.fixture
async def activity_case(postgres_factory):
    async with postgres_factory() as db:
        users = {role: User(email=f"{role.value}@example.test", name=role.value, role=role,
                            status=UserStatus.active, password_hash="test-only") for role in UserRole}
        db.add_all(users.values())
        await db.commit()
    app = FastAPI()
    app.include_router(api_router, prefix="/api")

    async def database():
        async with postgres_factory() as db:
            yield db

    app.dependency_overrides[get_db] = database
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        yield client, users, postgres_factory


def headers(user):
    return {"Authorization": "Bearer " + create_token(user.id)}


@pytest.mark.asyncio
@pytest.mark.parametrize("role", list(UserRole))
async def test_only_admin_can_read_activity(activity_case, role):
    client, users, _ = activity_case
    response = await client.get("/api/admin/user-activity", headers=headers(users[role]))
    assert response.status_code == (200 if role == UserRole.admin else 403)
    if role == UserRole.admin:
        assert len(response.json()) == len(users)
        assert all(set(row) == {"id", "last_active_at"} and row["last_active_at"] is None for row in response.json())


@pytest.mark.asyncio
async def test_activity_is_server_timestamp_and_only_updates_authenticated_user(activity_case):
    client, users, factory = activity_case
    before = datetime.now(timezone.utc)
    response = await client.post("/api/activity", headers=headers(users[UserRole.engineer]),
                                 json={"user_id": users[UserRole.admin].id, "last_active_at": "2099-01-01"})
    assert response.status_code == 204 and not response.content
    async with factory() as db:
        engineer = await db.get(User, users[UserRole.engineer].id)
        assert before <= engineer.last_active_at <= datetime.now(timezone.utc)
        assert (await db.get(User, users[UserRole.admin].id)).last_active_at is None
    rows = (await client.get("/api/admin/user-activity", headers=headers(users[UserRole.admin]))).json()
    stamp = next(row["last_active_at"] for row in rows if row["id"] == engineer.id)
    assert stamp.endswith("Z")
    public_users = (await client.get("/api/users/list", headers=headers(users[UserRole.engineer]))).json()
    assert all("last_active_at" not in row for row in public_users)


@pytest.mark.asyncio
async def test_background_gets_and_admin_reads_do_not_count(activity_case):
    client, users, factory = activity_case
    admin = users[UserRole.admin]
    for path in ("/api/users/list", "/api/tickets", "/api/admin/user-activity"):
        assert (await client.get(path, headers=headers(admin))).status_code == 200
    async with factory() as db:
        assert (await db.get(User, admin.id)).last_active_at is None


@pytest.mark.asyncio
async def test_server_throttles_and_resumes_after_one_minute(activity_case):
    client, users, factory = activity_case
    user = users[UserRole.engineer]
    assert (await client.post("/api/activity", headers=headers(user))).status_code == 204
    async with factory() as db:
        first = (await db.get(User, user.id)).last_active_at
    assert (await client.post("/api/activity", headers=headers(user))).status_code == 204
    async with factory() as db:
        row = await db.get(User, user.id)
        assert row.last_active_at == first
        row.last_active_at = first - timedelta(minutes=2)
        await db.commit()
    assert (await client.post("/api/activity", headers=headers(user))).status_code == 204
    async with factory() as db:
        assert (await db.get(User, user.id)).last_active_at >= first


@pytest.mark.asyncio
async def test_concurrent_reports_do_not_overwrite_recent_timestamp(activity_case):
    _, users, factory = activity_case
    user = users[UserRole.engineer]

    async def record():
        async with factory() as db:
            await UserActivityService(db).record(user.id)
            await db.commit()

    await asyncio.gather(record(), record())
    async with factory() as db:
        first = (await db.get(User, user.id)).last_active_at
    await asyncio.gather(record(), record())
    async with factory() as db:
        assert (await db.get(User, user.id)).last_active_at == first


@pytest.mark.asyncio
async def test_authentication_and_session_revocation_still_apply(activity_case):
    client, users, factory = activity_case
    user = users[UserRole.engineer]
    assert (await client.post("/api/activity")).status_code == 401
    assert (await client.get("/api/admin/user-activity")).status_code == 401
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    async with factory() as db:
        session = DeviceSession(user_id=user.id, token_hash="synthetic-session", device_name="Test",
                                expires_at=now + timedelta(days=1), revoked_at=now)
        db.add(session)
        await db.commit()
    revoked = {"Authorization": "Bearer " + create_token(user.id, session_id=session.id)}
    assert (await client.post("/api/activity", headers=revoked)).status_code == 401
    async with factory() as db:
        (await db.get(User, user.id)).status = UserStatus.rejected
        await db.commit()
    assert (await client.post("/api/activity", headers=headers(user))).status_code == 403
    async with factory() as db:
        assert (await db.get(User, user.id)).last_active_at is None


@pytest.mark.asyncio
async def test_active_device_session_reports_without_extending_expiry(activity_case):
    client, users, factory = activity_case
    user = users[UserRole.engineer]
    expires = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=1)
    async with factory() as db:
        session = DeviceSession(user_id=user.id, token_hash="synthetic-active-session", device_name="Android", expires_at=expires)
        db.add(session)
        await db.commit()
    token_headers = {"Authorization": "Bearer " + create_token(user.id, session_id=session.id)}
    assert (await client.post("/api/activity", headers=token_headers)).status_code == 204
    async with factory() as db:
        assert (await db.get(User, user.id)).last_active_at is not None
        assert (await db.get(DeviceSession, session.id)).expires_at == expires
