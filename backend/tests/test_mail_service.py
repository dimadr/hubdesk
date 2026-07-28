from unittest.mock import AsyncMock, MagicMock

import pytest

from src.services.mail_service import MailService


@pytest.mark.asyncio
async def test_parallel_mail_poll_exits_when_advisory_lock_is_busy():
    session = AsyncMock()
    lock_result = MagicMock()
    lock_result.scalar.return_value = False
    session.execute.return_value = lock_result

    created = await MailService.fetch_and_create_tickets(session)

    assert created == 0
    session.rollback.assert_awaited_once()
