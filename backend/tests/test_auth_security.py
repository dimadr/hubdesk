from datetime import datetime

from jose import jwt

from src.api.schemas import _utc_iso
from src.config import settings
from src.core.deps import create_token


def test_device_access_token_contains_session_id():
    token = create_token(7, ttl=60, session_id=42)
    payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])

    assert payload["sub"] == "7"
    assert payload["sid"] == "42"


def test_naive_backend_datetime_is_serialized_as_utc():
    assert _utc_iso(datetime(2026, 8, 21, 12, 30)) == "2026-08-21T12:30:00Z"
