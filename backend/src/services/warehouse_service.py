from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from src.models.warehouse import (
    AccountingDocument, DocumentLine, StockBalance, DocType, DocStatus,
    Warehouse, Nomenclature,
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
        doc_type = DocType(data["doc_type"])
        if doc_type != DocType.INFLOW and not data.get("source_warehouse_id"):
            raise ValueError("Для документа требуется склад-источник")
        if doc_type != DocType.WRITE_OFF and not data.get("target_warehouse_id"):
            raise ValueError("Для документа требуется склад-получатель")
        if not data.get("lines"):
            raise ValueError("Документ должен содержать хотя бы одну строку")
        if data.get("source_warehouse_id"):
            if not await self.session.get(Warehouse, data["source_warehouse_id"]):
                raise ValueError(f"Склад-источник {data['source_warehouse_id']} не найден")
        if data.get("target_warehouse_id"):
            if not await self.session.get(Warehouse, data["target_warehouse_id"]):
                raise ValueError(f"Склад-получатель {data['target_warehouse_id']} не найден")
        for line_data in data.get("lines", []):
            if not await self.session.get(Nomenclature, line_data["nomenclature_id"]):
                raise ValueError(f"Номенклатура {line_data['nomenclature_id']} не найдена")
        doc = AccountingDocument(
            doc_type=doc_type,
            source_warehouse_id=data.get("source_warehouse_id"),
            target_warehouse_id=data.get("target_warehouse_id"),
            created_by=user.id,
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
        if not RoleChecker.can_manage_warehouse(user):
            raise PermissionError("Access denied")
        doc = await self._get(doc_id)
        await self.fsm.transition(doc, "APPROVAL", user.id)
        await self.session.flush()
        await self.session.refresh(doc, ["lines"])
        return doc

    async def deliver(self, doc_id: int, user: User) -> AccountingDocument:
        if not RoleChecker.can_manage_warehouse(user):
            raise PermissionError("Access denied")
        doc = await self._get(doc_id)
        await self.fsm.transition(doc, "DELIVERY", user.id)
        await self.session.flush()
        await self.session.refresh(doc, ["lines"])
        return doc

    async def account(self, doc_id: int, user: User) -> AccountingDocument:
        if not RoleChecker.can_manage_warehouse(user):
            raise PermissionError("Access denied")
        doc = await self._get(doc_id, for_update=True)
        if doc.status == DocStatus.ACCOUNTED:
            return doc
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

    async def _get(self, doc_id: int, for_update: bool = False) -> AccountingDocument:
        stmt = (
            select(AccountingDocument)
            .where(AccountingDocument.id == doc_id)
            .options(
                selectinload(AccountingDocument.lines).selectinload(DocumentLine.nomenclature)
            )
        )
        if for_update:
            stmt = stmt.with_for_update()
        result = await self.session.execute(stmt)
        doc = result.scalar_one_or_none()
        if not doc:
            raise LookupError(f"Складской документ {doc_id} не найден")
        return doc
