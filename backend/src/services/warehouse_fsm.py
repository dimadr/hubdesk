from decimal import Decimal

from src.core.fsm import BaseFSM
from src.core.fsm.mixins import AuditMixin
from src.models.warehouse import (
    AccountingDocument, DocStatus, DocType, NomenclatureType, StockBalance,
    WarehouseTransition,
)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text
import logging

logger = logging.getLogger(__name__)


class WarehouseDocFSM(BaseFSM, AuditMixin):
    transitions = {
        "DRAFT":    ["APPROVAL"],
        "APPROVAL": ["DELIVERY"],
        "DELIVERY": ["ACCOUNTED"],
        "ACCOUNTED": [],
    }

    def __init__(self, session: AsyncSession):
        self.session = session

    def get_status(self, entity: AccountingDocument) -> str:
        return entity.status.value

    def set_status(self, entity: AccountingDocument, target: str) -> None:
        entity.status = DocStatus(target)

    async def log_transition(
        self, entity: AccountingDocument, from_status: str, to_status: str, user_id: int, context: dict
    ) -> None:
        self.session.add(WarehouseTransition(
            document_id=entity.id,
            from_status=DocStatus(from_status),
            to_status=DocStatus(to_status),
            user_id=user_id,
        ))
        logger.info(
            "Складской FSM: документ #%d %s → %s (user=%s)",
            entity.id, from_status, to_status, user_id
        )

    async def post_account(self, document: AccountingDocument) -> None:
        for line in document.lines:
            if line.nomenclature.type not in {
                NomenclatureType.material,
                NomenclatureType.product,
            }:
                continue
            await self._apply_stock_change(
                document.doc_type,
                document.source_warehouse_id,
                document.target_warehouse_id,
                line.nomenclature_id,
                line.quantity,
            )

    async def _apply_stock_change(
        self, doc_type: DocType, source_id: int | None, target_id: int | None,
        nom_id: int, qty: Decimal
    ):
        if doc_type == DocType.INFLOW and target_id:
            await self._delta(target_id, nom_id, +qty)
        elif doc_type == DocType.WRITE_OFF and source_id:
            await self._delta(source_id, nom_id, -qty, check_negative=True)
        elif doc_type == DocType.TRANSFER and source_id and target_id:
            await self._delta(source_id, nom_id, -qty, check_negative=True)
            await self._delta(target_id, nom_id, +qty)

    async def _delta(
        self, warehouse_id: int, nom_id: int, delta: Decimal,
        check_negative: bool = False,
    ):
        await self.session.execute(
            text("""
                INSERT INTO stock_balances (warehouse_id, nomenclature_id, quantity)
                VALUES (:wid, :nid, 0)
                ON CONFLICT (warehouse_id, nomenclature_id) DO NOTHING
            """),
            {"wid": warehouse_id, "nid": nom_id}
        )
        stmt = select(StockBalance).where(
            StockBalance.warehouse_id == warehouse_id,
            StockBalance.nomenclature_id == nom_id,
        ).with_for_update()
        result = await self.session.execute(stmt)
        balance = result.scalar_one()
        if check_negative and balance.quantity + delta < Decimal("0"):
            raise ValueError(
                f"Недостаточно остатка на складе {warehouse_id}: "
                f"требуется {abs(delta)}, доступно {balance.quantity}"
            )
        balance.quantity += delta
