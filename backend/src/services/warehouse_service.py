from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from src.models.warehouse import (
    AccountingDocument, DocumentLine, StockBalance, DocType, DocStatus,
)
from src.models.user import User
from src.services.warehouse_fsm import WarehouseDocFSM
from src.services.acl_service import RoleChecker


class WarehouseService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.fsm = WarehouseDocFSM(session)

    async def create_document(self, data: dict, user: User) -> AccountingDocument:
        if not RoleChecker.can_manage_warehouse(user):
            raise PermissionError("Access denied")
        doc = AccountingDocument(
            doc_type=DocType(data["doc_type"]),
            source_warehouse_id=data.get("source_warehouse_id"),
            target_warehouse_id=data.get("target_warehouse_id"),
        )
        self.session.add(doc)
        await self.session.flush()
        for line_data in data.get("lines", []):
            line = DocumentLine(
                document_id=doc.id,
                nomenclature_id=line_data["nomenclature_id"],
                quantity=line_data["quantity"],
            )
            self.session.add(line)
        await self.session.flush()
        await self.session.refresh(doc, ["lines"])
        return doc

    async def approve(self, doc_id: int, user: User) -> AccountingDocument:
        doc = await self._get(doc_id)
        await self.fsm.transition(doc, "APPROVAL", user.id)
        await self.session.flush()
        await self.session.refresh(doc, ["lines"])
        return doc

    async def deliver(self, doc_id: int, user: User) -> AccountingDocument:
        doc = await self._get(doc_id)
        await self.fsm.transition(doc, "DELIVERY", user.id)
        await self.session.flush()
        await self.session.refresh(doc, ["lines"])
        return doc

    async def account(self, doc_id: int, user: User) -> AccountingDocument:
        doc = await self._get(doc_id)
        await self.fsm.transition(doc, "ACCOUNTED", user.id)
        await self.fsm.post_account(doc)
        await self.session.flush()
        await self.session.refresh(doc, ["lines"])
        return doc

    async def get_balance(self, warehouse_id: int, nomenclature_id: int) -> float:
        stmt = select(StockBalance).where(
            StockBalance.warehouse_id == warehouse_id,
            StockBalance.nomenclature_id == nomenclature_id,
        )
        result = await self.session.execute(stmt)
        balance = result.scalar_one_or_none()
        return balance.quantity if balance else 0.0

    async def _get(self, doc_id: int) -> AccountingDocument:
        stmt = select(AccountingDocument).where(AccountingDocument.id == doc_id).options(selectinload(AccountingDocument.lines))
        result = await self.session.execute(stmt)
        return result.scalar_one()
