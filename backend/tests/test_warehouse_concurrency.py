import asyncio
import os
from collections import Counter
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import func, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import src.models  # noqa: F401; register all foreign-key targets
from src.api.warehouse import warehouse_router
from src.core.deps import get_current_user
from src.core.fsm.exceptions import InvalidTransitionError
from src.database import Base, get_db
from src.models.user import User, UserRole, UserStatus
from src.models.warehouse import (
    AccountingDocument,
    DocStatus,
    DocType,
    DocumentLine,
    Nomenclature,
    NomenclatureType,
    StockBalance,
    Warehouse,
    WarehouseTransition,
    WarehouseType,
)
from src.services.warehouse_service import WarehouseService


@pytest_asyncio.fixture
async def warehouse_db():
    raw_url = os.getenv("HUBDESK_TEST_DATABASE_URL")
    if not raw_url:
        pytest.skip("Set HUBDESK_TEST_DATABASE_URL to an isolated PostgreSQL")
    url = make_url(raw_url)
    if url.drivername != "postgresql+asyncpg" or url.database != "hubdesk_h01_test":
        pytest.fail("Refusing writes outside the dedicated hubdesk_h01_test database")
    engine = create_async_engine(url, pool_size=8, max_overflow=0)
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        yield async_sessionmaker(engine, expire_on_commit=False)
    finally:
        await engine.dispose()


async def seed(factory, doc_type=DocType.INFLOW, status=DocStatus.DELIVERY,
               documents=1, shared_stock=False):
    async with factory() as session:
        user = User(
            email=f"h01-{uuid4().hex}@example.test", name="H01 test actor",
            role=UserRole.admin, status=UserStatus.active, password_hash="test-only",
        )
        item = Nomenclature(
            name="H01 material", type=NomenclatureType.material, unit="pcs",
        )
        session.add_all([user, item])
        await session.flush()
        doc_ids, initial, expected = [], {}, {}
        source_id = target_id = None
        for index in range(documents):
            if not shared_stock or index == 0:
                source_id = target_id = None
                if doc_type != DocType.INFLOW:
                    source = Warehouse(name="H01 source", type=WarehouseType.physical)
                    session.add(source)
                    await session.flush()
                    source_id = source.id
                    initial[source_id] = Decimal("5.000")
                if doc_type != DocType.WRITE_OFF:
                    target = Warehouse(name="H01 target", type=WarehouseType.physical)
                    session.add(target)
                    await session.flush()
                    target_id = target.id
                    initial[target_id] = Decimal("0.000")
                for warehouse_id in (source_id, target_id):
                    if warehouse_id is not None:
                        session.add(StockBalance(
                            warehouse_id=warehouse_id, nomenclature_id=item.id,
                            quantity=initial[warehouse_id],
                        ))
                        expected[warehouse_id] = initial[warehouse_id]
            doc = AccountingDocument(
                doc_type=doc_type, status=status, source_warehouse_id=source_id,
                target_warehouse_id=target_id, created_by=user.id,
            )
            session.add(doc)
            await session.flush()
            session.add(DocumentLine(
                document_id=doc.id, nomenclature_id=item.id, quantity=Decimal("2.000"),
            ))
            doc_ids.append(doc.id)
            if source_id is not None:
                expected[source_id] -= Decimal("2.000")
            if target_id is not None:
                expected[target_id] += Decimal("2.000")
        await session.commit()
        return SimpleNamespace(
            user=user, item_id=item.id, doc_ids=doc_ids,
            initial=initial, expected=expected, initial_status=status,
        )


async def snapshot(factory, case):
    async with factory() as session:
        statuses = dict((await session.execute(
            select(AccountingDocument.id, AccountingDocument.status)
            .where(AccountingDocument.id.in_(case.doc_ids))
        )).all())
        balances = dict((await session.execute(
            select(StockBalance.warehouse_id, StockBalance.quantity)
            .where(StockBalance.nomenclature_id == case.item_id)
        )).all())
        transitions = (await session.execute(
            select(WarehouseTransition.document_id, WarehouseTransition.from_status,
                   WarehouseTransition.to_status)
            .where(WarehouseTransition.document_id.in_(case.doc_ids))
            .order_by(WarehouseTransition.id)
        )).all()
        lines = await session.scalar(
            select(func.count()).select_from(DocumentLine)
            .where(DocumentLine.document_id.in_(case.doc_ids))
        )
        return {"statuses": statuses, "balances": balances,
                "transitions": [tuple(row) for row in transitions], "lines": lines}


async def assert_posted_once(factory, case):
    state = await snapshot(factory, case)
    expected_transitions = Counter(
        (doc_id, DocStatus.DELIVERY, DocStatus.ACCOUNTED) for doc_id in case.doc_ids
    )
    assert (state["balances"], Counter(state["transitions"])) == (
        case.expected, expected_transitions,
    )
    assert state["statuses"] == dict.fromkeys(case.doc_ids, DocStatus.ACCOUNTED)
    assert state["lines"] == len(case.doc_ids)


async def transition_and_commit(session, method, doc_id, user):
    try:
        doc = await getattr(WarehouseService(session), method)(doc_id, user)
        await session.commit()
        return doc.status
    except BaseException:
        await session.rollback()
        raise


async def wait_until_blocked(factory, blocked_pid, blocker_pid):
    async def observe():
        async with factory() as observer:
            while not await observer.scalar(
                text("SELECT :blocker = ANY(pg_blocking_pids(:blocked))"),
                {"blocked": blocked_pid, "blocker": blocker_pid},
            ):
                await asyncio.sleep(0.01)
    await asyncio.wait_for(observe(), timeout=5)


async def cancel_pending(task):
    if not task.done():
        task.cancel()
    await asyncio.gather(task, return_exceptions=True)


@pytest.mark.asyncio
@pytest.mark.parametrize("doc_type", list(DocType))
@pytest.mark.parametrize("timing", ["already_committed", "wait_for_commit"])
async def test_account_once_with_preloaded_sessions(warehouse_db, doc_type, timing):
    case = await seed(warehouse_db, doc_type)
    doc_id = case.doc_ids[0]
    async with warehouse_db() as first, warehouse_db() as second:
        # Keep strong references: both identity maps must retain DELIVERY.
        first_doc = await first.get(AccountingDocument, doc_id)
        stale_doc = await second.get(AccountingDocument, doc_id)
        assert first_doc.status == stale_doc.status == DocStatus.DELIVERY
        first_pid = await first.scalar(text("SELECT pg_backend_pid()"))
        second_pid = await second.scalar(text("SELECT pg_backend_pid()"))
        assert first_pid != second_pid
        await WarehouseService(first).account(doc_id, case.user)
        if timing == "already_committed":
            await first.commit()
            assert stale_doc.status == DocStatus.DELIVERY
            await transition_and_commit(second, "account", doc_id, case.user)
        else:
            task = asyncio.create_task(
                transition_and_commit(second, "account", doc_id, case.user)
            )
            try:
                await wait_until_blocked(warehouse_db, second_pid, first_pid)
                assert not task.done()
                await first.commit()
                assert await asyncio.wait_for(task, timeout=5) == DocStatus.ACCOUNTED
            finally:
                await cancel_pending(task)
    await assert_posted_once(warehouse_db, case)
    async with warehouse_db() as retry:
        await transition_and_commit(retry, "account", doc_id, case.user)
    await assert_posted_once(warehouse_db, case)


@pytest.mark.asyncio
@pytest.mark.parametrize("method,initial,target", [
    ("approve", DocStatus.DRAFT, DocStatus.APPROVAL),
    ("deliver", DocStatus.APPROVAL, DocStatus.DELIVERY),
])
async def test_duplicate_transition_waits_and_rejects(warehouse_db, method, initial, target):
    case = await seed(warehouse_db, status=initial)
    doc_id = case.doc_ids[0]
    async with warehouse_db() as first, warehouse_db() as second:
        first_doc = await first.get(AccountingDocument, doc_id)
        stale_doc = await second.get(AccountingDocument, doc_id)
        assert first_doc.status == stale_doc.status == initial
        first_pid = await first.scalar(text("SELECT pg_backend_pid()"))
        second_pid = await second.scalar(text("SELECT pg_backend_pid()"))
        await getattr(WarehouseService(first), method)(doc_id, case.user)
        task = asyncio.create_task(
            transition_and_commit(second, method, doc_id, case.user)
        )
        try:
            await wait_until_blocked(warehouse_db, second_pid, first_pid)
            await first.commit()
            with pytest.raises(InvalidTransitionError):
                await asyncio.wait_for(task, timeout=5)
        finally:
            await cancel_pending(task)
    state = await snapshot(warehouse_db, case)
    assert state["statuses"] == {doc_id: target}
    assert state["transitions"] == [(doc_id, initial, target)]
    assert state["balances"] == case.initial


@pytest.mark.asyncio
@pytest.mark.parametrize("method,initial", [
    ("approve", DocStatus.DRAFT), ("deliver", DocStatus.APPROVAL),
])
async def test_stale_transition_cannot_regress_accounted_document(warehouse_db, method, initial):
    case = await seed(warehouse_db, status=initial)
    doc_id = case.doc_ids[0]
    async with warehouse_db() as first, warehouse_db() as second:
        first_doc = await first.get(AccountingDocument, doc_id)
        stale_doc = await second.get(AccountingDocument, doc_id)
        assert first_doc.status == stale_doc.status == initial
        service = WarehouseService(first)
        if initial == DocStatus.DRAFT:
            await service.approve(doc_id, case.user)
        await service.deliver(doc_id, case.user)
        await service.account(doc_id, case.user)
        await first.commit()
        assert stale_doc.status == initial
        with pytest.raises(InvalidTransitionError):
            await transition_and_commit(second, method, doc_id, case.user)
    state = await snapshot(warehouse_db, case)
    assert state["statuses"] == {doc_id: DocStatus.ACCOUNTED}
    assert state["balances"] == case.expected
    expected_count = 3 if initial == DocStatus.DRAFT else 2
    assert len(state["transitions"]) == expected_count


@pytest.mark.asyncio
@pytest.mark.parametrize("doc_type", list(DocType))
async def test_valid_document_lifecycle(warehouse_db, doc_type):
    case = await seed(warehouse_db, doc_type, status=DocStatus.DRAFT)
    doc_id = case.doc_ids[0]
    async with warehouse_db() as session:
        service = WarehouseService(session)
        await service.approve(doc_id, case.user)
        await service.deliver(doc_id, case.user)
        await service.account(doc_id, case.user)
        await session.commit()
    state = await snapshot(warehouse_db, case)
    assert state["balances"] == case.expected
    assert state["statuses"] == {doc_id: DocStatus.ACCOUNTED}
    assert state["transitions"] == [
        (doc_id, DocStatus.DRAFT, DocStatus.APPROVAL),
        (doc_id, DocStatus.APPROVAL, DocStatus.DELIVERY),
        (doc_id, DocStatus.DELIVERY, DocStatus.ACCOUNTED),
    ]


@pytest.mark.asyncio
async def test_different_documents_do_not_share_document_lock(warehouse_db):
    case = await seed(warehouse_db, documents=2)
    async with warehouse_db() as first, warehouse_db() as second:
        await WarehouseService(first).account(case.doc_ids[0], case.user)
        task = asyncio.create_task(
            transition_and_commit(second, "account", case.doc_ids[1], case.user)
        )
        try:
            # Independent stock rows must complete while the first transaction is open.
            assert await asyncio.wait_for(task, timeout=5) == DocStatus.ACCOUNTED
            await first.commit()
        finally:
            await cancel_pending(task)
    await assert_posted_once(warehouse_db, case)


@pytest.mark.asyncio
async def test_different_documents_sharing_balance_keep_both_postings(warehouse_db):
    case = await seed(warehouse_db, documents=2, shared_stock=True)
    async with warehouse_db() as first, warehouse_db() as second:
        first_pid = await first.scalar(text("SELECT pg_backend_pid()"))
        second_pid = await second.scalar(text("SELECT pg_backend_pid()"))
        await WarehouseService(first).account(case.doc_ids[0], case.user)
        task = asyncio.create_task(
            transition_and_commit(second, "account", case.doc_ids[1], case.user)
        )
        try:
            await wait_until_blocked(warehouse_db, second_pid, first_pid)
            await first.commit()
            await asyncio.wait_for(task, timeout=5)
        finally:
            await cancel_pending(task)
    await assert_posted_once(warehouse_db, case)


@pytest.mark.asyncio
async def test_accounting_failure_rolls_back_everything(warehouse_db):
    case = await seed(warehouse_db, DocType.TRANSFER)
    doc_id = case.doc_ids[0]
    async with warehouse_db() as session:
        session.add(DocumentLine(
            document_id=doc_id, nomenclature_id=case.item_id, quantity=Decimal("99.000"),
        ))
        await session.commit()
    async with warehouse_db() as session:
        with pytest.raises(ValueError):
            await WarehouseService(session).account(doc_id, case.user)
        await session.rollback()
    state = await snapshot(warehouse_db, case)
    assert state["statuses"] == {doc_id: DocStatus.DELIVERY}
    assert state["transitions"] == []
    assert state["balances"] == case.initial
    assert state["lines"] == 2


@pytest.mark.asyncio
async def test_account_http_aliases_are_idempotent(warehouse_db):
    case = await seed(warehouse_db)
    app = FastAPI()
    app.include_router(warehouse_router, prefix="/api")

    async def test_session():
        async with warehouse_db() as session:
            yield session

    app.dependency_overrides[get_db] = test_session
    app.dependency_overrides[get_current_user] = lambda: case.user
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://h01.test",
    ) as client:
        for method in ("POST", "PATCH", "POST"):
            response = await client.request(
                method, f"/api/warehouse-documents/{case.doc_ids[0]}/account",
            )
            assert response.status_code == 200, response.text
            assert response.json()["status"] == "ACCOUNTED"
    await assert_posted_once(warehouse_db, case)


@pytest.mark.asyncio
@pytest.mark.parametrize("method,initial", [
    ("approve", DocStatus.DELIVERY),
    ("deliver", DocStatus.DRAFT),
    ("account", DocStatus.DRAFT),
])
async def test_invalid_fsm_transitions_stay_rejected(warehouse_db, method, initial):
    case = await seed(warehouse_db, status=initial)
    async with warehouse_db() as session:
        with pytest.raises(InvalidTransitionError):
            await transition_and_commit(session, method, case.doc_ids[0], case.user)
    state = await snapshot(warehouse_db, case)
    assert state["statuses"] == {case.doc_ids[0]: initial}
    assert state["transitions"] == []
    assert state["balances"] == case.initial


@pytest.mark.asyncio
@pytest.mark.parametrize("method", ["approve", "deliver", "account"])
async def test_transition_role_checks_are_preserved(warehouse_db, method):
    case = await seed(warehouse_db)
    case.user.role = UserRole.engineer
    async with warehouse_db() as session:
        with pytest.raises(PermissionError):
            await getattr(WarehouseService(session), method)(case.doc_ids[0], case.user)
    state = await snapshot(warehouse_db, case)
    assert state["statuses"] == {case.doc_ids[0]: DocStatus.DELIVERY}
    assert state["transitions"] == []
    assert state["balances"] == case.initial
