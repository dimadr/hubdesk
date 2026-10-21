from datetime import datetime, timedelta

import httpx
import pytest
import pytest_asyncio

import src.main as main
import src.services.attachment_service as storage
from src.core.deps import create_token
from src.database import get_db
from src.models.attachment import Attachment
from src.models.comment import Comment
from src.models.customer import Customer
from src.models.device_session import DeviceSession
from src.models.equipment import AssetLocation
from src.models.ticket import Ticket
from src.models.user import User, UserRole, UserStatus


@pytest_asyncio.fixture
async def file_case(postgres_factory, tmp_path, monkeypatch):
    monkeypatch.setattr("src.database.async_session", postgres_factory)
    monkeypatch.chdir(tmp_path.parent)
    monkeypatch.setattr(main, "uploads_dir", str(tmp_path))
    monkeypatch.setattr(storage, "UPLOAD_DIR", str(tmp_path))
    monkeypatch.setattr("src.api.attachments.UPLOAD_DIR", str(tmp_path))
    (tmp_path / "document.txt").write_text("test document")
    async with postgres_factory() as db:
        engineer = User(email="engineer@example.test", name="Test", role=UserRole.engineer,
                        status=UserStatus.active, password_hash="test-only")
        other = User(email="other@example.test", name="Other", role=UserRole.engineer,
                     status=UserStatus.active, password_hash="test-only")
        customer = Customer(name="Test customer")
        db.add_all([engineer, other, customer])
        await db.flush()
        location = AssetLocation(name="Test location", address="Test", customer_id=customer.id)
        db.add(location)
        await db.flush()
        ticket = Ticket(number=1, subject="Test", body="", customer_id=customer.id,
                        location_id=location.id, assignee_id=engineer.id)
        db.add(ticket)
        await db.flush()
        attachment = Attachment(ticket_id=ticket.id, filename="document.txt",
                                path=f"{tmp_path.name}/document.txt", size=13,
                                content_type="text/plain", is_internal=False)
        device = DeviceSession(user_id=engineer.id, token_hash="a" * 64, device_name="Test",
                               expires_at=datetime.utcnow() + timedelta(days=1))
        db.add_all([attachment, device])
        await db.commit()

    async def test_db():
        async with postgres_factory() as db:
            yield db
    main.app.dependency_overrides[get_db] = test_db
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app),
                                     base_url="http://high.test") as client:
            yield client, engineer, other, attachment, device, ticket
    finally:
        main.app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
@pytest.mark.parametrize("state,expected", [
    ("active", 200), ("stateless", 200), ("revoked", 401), ("expired", 401),
    ("wrong_owner", 401), ("inactive", 403), ("missing", 401),
])
async def test_both_download_routes_validate_session(file_case, postgres_factory, state, expected):
    client, user, other, attachment, device, ticket = file_case
    async with postgres_factory() as db:
        session = await db.get(DeviceSession, device.id)
        if state == "revoked":
            session.revoked_at = datetime.utcnow()
        elif state == "expired":
            session.expires_at = datetime.utcnow() - timedelta(seconds=1)
        elif state == "wrong_owner":
            session.user_id = other.id
        elif state == "inactive":
            (await db.get(User, user.id)).status = UserStatus.rejected
        await db.commit()
    headers = {} if state == "missing" else {"Authorization": "Bearer " + create_token(
        user.id, 3600, None if state == "stateless" else device.id)}
    for url in (f"/api/attachments/{attachment.id}", "/files/document.txt"):
        response = await client.get(url, headers=headers)
        assert response.status_code == expected, (url, response.text)
        if expected == 200:
            assert response.text == "test document"


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["other_ticket", "internal", "internal_comment"])
async def test_both_download_routes_share_acl(file_case, postgres_factory, kind):
    client, user, other, attachment, device, ticket = file_case
    async with postgres_factory() as db:
        att = await db.get(Attachment, attachment.id)
        if kind == "other_ticket":
            (await db.get(Ticket, ticket.id)).assignee_id = other.id
        elif kind == "internal":
            att.is_internal = True
        else:
            comment = Comment(ticket_id=ticket.id, user_id=user.id, body="Internal", is_internal=True)
            db.add(comment)
            await db.flush()
            att.comment_id = comment.id
        await db.commit()
    headers = {"Authorization": "Bearer " + create_token(user.id, 3600, device.id)}
    for url in (f"/api/attachments/{attachment.id}", "/files/document.txt"):
        assert (await client.get(url, headers=headers)).status_code == 403
