from fastapi import APIRouter, Depends, UploadFile, File, Form, Query, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import os
from src.database import get_db
from src.services.attachment_service import AttachmentService, UPLOAD_DIR
from src.services.acl_service import RoleChecker
from src.models.attachment import Attachment
from src.models.ticket import Ticket
from src.models.user import User, UserRole
from src.api.schemas import AttachmentResponse
from src.core.deps import get_current_user

attachment_router = APIRouter(tags=["Attachments"])


@attachment_router.post("/attachments", status_code=201, response_model=AttachmentResponse)
async def upload_attachment(
    file: UploadFile = File(...),
    ticket_id: int | None = Form(None),
    comment_id: int | None = Form(None),
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = AttachmentService(db)
    att = await svc.upload(file, ticket_id, comment_id, user)
    await db.commit()
    return AttachmentResponse.model_validate(att)


@attachment_router.get("/attachments", response_model=list[AttachmentResponse])
async def list_attachments(
    ticket_id: int = Query(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ticket = await db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(404, "Заявка не найдена")
    if not await RoleChecker.can_view_ticket_async(user, ticket, db):
        raise HTTPException(403, "Нет доступа к заявке")
    stmt = select(Attachment).where(Attachment.ticket_id == ticket_id)
    if user.role in (UserRole.customer, UserRole.engineer):
        stmt = stmt.where(Attachment.is_internal == False)
    result = await db.execute(stmt.order_by(Attachment.created_at.desc()))
    return [AttachmentResponse.model_validate(a) for a in result.scalars().all()]


@attachment_router.get("/attachments/{attachment_id}")
async def download_attachment(
    attachment_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    att = await db.get(Attachment, attachment_id)
    if not att:
        raise HTTPException(404, "Файл не найден")
    if att.ticket_id:
        ticket = await db.get(Ticket, att.ticket_id)
        if ticket and not await RoleChecker.can_view_ticket_async(user, ticket, db):
            raise HTTPException(403, "Нет доступа к заявке")
        if att.is_internal and user.role in (UserRole.customer, UserRole.engineer):
            raise HTTPException(403, "Нет доступа к внутреннему файлу")
    real_path = os.path.realpath(att.path)
    uploads_path = os.path.realpath(UPLOAD_DIR)
    if not real_path.startswith(uploads_path + os.sep) and real_path != uploads_path:
        raise HTTPException(403, "Недопустимый путь к файлу")
    if not os.path.exists(real_path):
        raise HTTPException(404, "Файл не найден на диске")
    return FileResponse(real_path, filename=att.filename, media_type=att.content_type)
