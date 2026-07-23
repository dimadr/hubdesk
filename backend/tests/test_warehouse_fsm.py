import pytest
from unittest.mock import AsyncMock
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
