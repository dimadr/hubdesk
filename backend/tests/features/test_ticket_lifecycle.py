import asyncio
import os
from types import SimpleNamespace
from uuid import uuid4

from fastapi import HTTPException
import pytest
from pytest_bdd import scenario, given, when, then
from sqlalchemy import func, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import src.models  # noqa: F401
from src.database import Base
from src.models.attachment import Attachment
from src.models.checklist import Checklist, ChecklistField, FieldType
from src.models.customer import Customer
from src.models.equipment import AssetLocation
from src.models.ticket import Ticket, TicketStatus, TicketTransition
from src.models.user import User, UserRole, UserStatus
from src.services.ticket_service import TicketService


@scenario("acceptance-tests.feature", "Complete ticket")
def test_complete_ticket():
    """The actual service and FSM complete a persisted ticket."""


@scenario("acceptance-tests.feature", "Reject completion")
def test_reject_completion():
    """The actual photo guard rejects a persisted ticket."""


@pytest.fixture
def lifecycle_factory():
    raw = os.getenv("HUBDESK_HIGH_TEST_DATABASE_URL")
    if not raw:
        pytest.skip("Requires isolated HUBDESK_HIGH_TEST_DATABASE_URL")
    url = make_url(raw)
    if url.drivername != "postgresql+asyncpg" or url.database != "hubdesk_high_test":
        pytest.fail("Refusing BDD writes outside hubdesk_high_test")
    schema = "bdd_" + uuid4().hex

    async def prepare():
        admin = create_async_engine(url)
        async with admin.begin() as db:
            await db.execute(text(f'CREATE SCHEMA "{schema}"'))
        await admin.dispose()
        engine = create_async_engine(url, connect_args={"server_settings": {"search_path": schema}})
        async with engine.begin() as db:
            await db.run_sync(Base.metadata.create_all)
        return engine

    # BDD steps are synchronous; one Runner owns every async DB operation.
    with asyncio.Runner() as runner:
        engine = runner.run(prepare())
        factory = async_sessionmaker(engine, expire_on_commit=False)

        async def seed(missing_photo):
            async with factory() as db:
                engineer = User(email="bdd@example.test", name="BDD engineer", role=UserRole.engineer,
                                status=UserStatus.active, password_hash="test-only")
                customer = Customer(name="BDD customer")
                db.add_all([engineer, customer])
                await db.flush()
                location = AssetLocation(name="BDD location", address="Test", customer_id=customer.id,
                                         assigned_engineer_id=engineer.id)
                db.add(location)
                await db.flush()
                service = TicketService(db)
                ticket = await service.create({"subject": "BDD ticket", "body": "Test",
                                               "customer_id": customer.id, "location_id": location.id}, engineer)
                await service.change_status(ticket.id, "IN_PROGRESS", engineer)
                checklist = Checklist(ticket_id=ticket.id, name="Completion")
                db.add(checklist)
                await db.flush()
                db.add_all([
                    ChecklistField(checklist_id=checklist.id, label="Checked", field_type=FieldType.checkbox,
                                   is_mandatory=True, value="true"),
                    ChecklistField(checklist_id=checklist.id, label="Photo", field_type=FieldType.photo,
                                   is_mandatory=True, value="proof.jpg"),
                ])
                if not missing_photo:
                    db.add(Attachment(ticket_id=ticket.id, filename="proof.jpg", path="test/proof.jpg",
                                      content_type="image/jpeg", size=4))
                await db.commit()
                return SimpleNamespace(factory=factory, runner=runner, ticket_id=ticket.id, user_id=engineer.id)

        try:
            yield lambda missing_photo: runner.run(seed(missing_photo))
        finally:
            runner.run(engine.dispose())


@given("mandatory checklist is completed", target_fixture="ticket_case")
def checklist_done(lifecycle_factory):
    return lifecycle_factory(False)


@given("mandatory photo is missing", target_fixture="ticket_case")
def photo_missing(lifecycle_factory):
    return lifecycle_factory(True)


@when("engineer closes ticket", target_fixture="completion")
def close_ticket(ticket_case):
    async def complete():
        async with ticket_case.factory() as db:
            user = await db.get(User, ticket_case.user_id)
            try:
                ticket = await TicketService(db).complete(ticket_case.ticket_id, "Done", user)
                await db.commit()
                return ticket.status
            except HTTPException as error:
                await db.rollback()
                return error
    return ticket_case.runner.run(complete())


async def saved_state(case):
    async with case.factory() as db:
        ticket = await db.get(Ticket, case.ticket_id)
        transitions = await db.scalar(select(func.count()).select_from(TicketTransition).where(
            TicketTransition.ticket_id == case.ticket_id, TicketTransition.to_status == TicketStatus.COMPLETED))
        return ticket, transitions


@then("status becomes COMPLETED")
def assert_completed(ticket_case, completion):
    assert completion == TicketStatus.COMPLETED
    ticket, transitions = ticket_case.runner.run(saved_state(ticket_case))
    assert ticket.status == TicketStatus.COMPLETED
    assert ticket.completed_at is not None
    assert ticket.archived_at == ticket.completed_at
    assert transitions == 1


@then("validation error is returned")
def assert_error(ticket_case, completion):
    assert isinstance(completion, HTTPException)
    assert completion.status_code == 409
    ticket, transitions = ticket_case.runner.run(saved_state(ticket_case))
    assert ticket.status == TicketStatus.IN_PROGRESS
    assert ticket.completed_at is None and ticket.archived_at is None
    assert transitions == 0
