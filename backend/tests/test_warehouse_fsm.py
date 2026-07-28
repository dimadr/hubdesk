from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from src.models.warehouse import DocType, NomenclatureType
from src.services.warehouse_fsm import WarehouseDocFSM


@pytest.mark.asyncio
async def test_linear_transition():
    session = AsyncMock()
    fsm = WarehouseDocFSM(session)
    doc = AsyncMock()
    doc.status.value = "DRAFT"
    await fsm.transition(doc, "APPROVAL", user_id=1)
    assert doc.status == "APPROVAL"


@pytest.mark.asyncio
async def test_cannot_skip_approval():
    session = AsyncMock()
    fsm = WarehouseDocFSM(session)
    doc = AsyncMock()
    doc.status.value = "DRAFT"
    with pytest.raises(Exception):
        await fsm.transition(doc, "DELIVERY", user_id=1)


@pytest.mark.asyncio
async def test_service_and_work_lines_do_not_change_stock():
    session = AsyncMock()
    fsm = WarehouseDocFSM(session)
    fsm._apply_stock_change = AsyncMock()
    document = SimpleNamespace(
        doc_type=DocType.INFLOW,
        source_warehouse_id=None,
        target_warehouse_id=1,
        lines=[
            SimpleNamespace(
                nomenclature=SimpleNamespace(type=NomenclatureType.service),
                nomenclature_id=1,
                quantity=Decimal("1.000"),
            ),
            SimpleNamespace(
                nomenclature=SimpleNamespace(type=NomenclatureType.work),
                nomenclature_id=2,
                quantity=Decimal("1.000"),
            ),
            SimpleNamespace(
                nomenclature=SimpleNamespace(type=NomenclatureType.material),
                nomenclature_id=3,
                quantity=Decimal("0.100"),
            ),
        ],
    )

    await fsm.post_account(document)

    fsm._apply_stock_change.assert_awaited_once_with(
        DocType.INFLOW, None, 1, 3, Decimal("0.100")
    )
