from unittest.mock import patch

import pytest
from sqlalchemy import select, text

from src.config import settings
from src.models.customer import Customer
from src.models.equipment import AssetLocation
from src.models.mailbox import MailboxConfig
from src.models.ticket import Ticket
from src.services.mail_service import MailService
from src.services.ticket_service import TicketService


class Mailbox:
    def login(self, *args): pass
    def select(self, *args): return "OK", []
    def logout(self): pass
    def uid(self, action, *args):
        if action == "search":
            return "OK", [b"103 101 102"]
        uid = args[0].decode()
        return "OK", [(b"RFC822", f"From: sender@example.test\r\nSubject: UID {uid}\r\n\r\nBody".encode())]


async def prepare(factory, monkeypatch):
    monkeypatch.setattr(settings, "mailbox_email", "inbox@example.test")
    monkeypatch.setattr(settings, "mailbox_password", "test-only")
    monkeypatch.setattr("src.services.mail_service.imaplib.IMAP4_SSL", lambda *a: Mailbox())
    async with factory() as db:
        customer = Customer(name="Test")
        db.add(customer)
        await db.flush()
        db.add(AssetLocation(name="Test", address="Test", customer_id=customer.id,
                             contact_email="sender@example.test"))
        db.add(MailboxConfig(enabled=True, email="inbox@example.test", last_uid="100"))
        await db.commit()


async def state(factory):
    async with factory() as db:
        uid = (await db.execute(select(MailboxConfig.last_uid))).scalar_one()
        subjects = (await db.execute(select(Ticket.subject).order_by(Ticket.subject))).scalars().all()
        return uid, subjects


@pytest.mark.asyncio
async def test_failed_uid_is_retried_without_repeating_prefix(postgres_factory, monkeypatch):
    await prepare(postgres_factory, monkeypatch)
    original = TicketService.create
    fail = True
    async def create(service, data, *args, **kwargs):
        nonlocal fail
        ticket = await original(service, data, *args, **kwargs)
        if data["subject"] == "UID 102" and fail:
            fail = False
            await service.session.execute(text("SELECT 1 / 0"))
        return ticket
    with patch.object(TicketService, "create", create):
        async with postgres_factory() as db:
            assert await MailService.fetch_and_create_tickets(db) == 1
        assert await state(postgres_factory) == ("101", ["UID 101"])
        async with postgres_factory() as db:
            assert await MailService.fetch_and_create_tickets(db) == 2
        assert await state(postgres_factory) == ("103", ["UID 101", "UID 102", "UID 103"])
        async with postgres_factory() as db:
            assert await MailService.fetch_and_create_tickets(db) == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("commit_reached_database", [False, True])
async def test_commit_failure_never_separates_tickets_and_cursor(
    postgres_factory, monkeypatch, commit_reached_database,
):
    await prepare(postgres_factory, monkeypatch)
    async with postgres_factory() as db:
        original = db.commit
        failed = False
        async def commit():
            nonlocal failed
            if commit_reached_database:
                await original()
            if not failed:
                failed = True
                raise RuntimeError("Synthetic commit transport failure")
            if not commit_reached_database:
                await original()
        monkeypatch.setattr(db, "commit", commit)
        with pytest.raises(RuntimeError):
            await MailService.fetch_and_create_tickets(db)
    async with postgres_factory() as db:
        await MailService.fetch_and_create_tickets(db)
    assert await state(postgres_factory) == ("103", ["UID 101", "UID 102", "UID 103"])
