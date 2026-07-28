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
    if not ticket_id and not comment_id:
        if user.role not in (UserRole.admin, UserRole.director, UserRole.storekeeper):
            raise HTTPException(403, "Только админ/директор/кладовщик могут загружать файлы без привязки к заявке")
    svc = AttachmentService(db)
    att = await svc.upload(file, ticket_id, comment_id, user)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        AttachmentService.remove_stored_file(att.path)
        raise
    resp = AttachmentResponse.model_validate(att)
    resp.download_url = f"/api/attachments/{att.id}"
    return resp


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
    items = []
    for a in result.scalars().all():
        r = AttachmentResponse.model_validate(a)
        r.download_url = f"/api/attachments/{a.id}"
        items.append(r)
    return items


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
        if not ticket:
            raise HTTPException(404, "Связанная заявка не найдена")
        if not await RoleChecker.can_view_ticket_async(user, ticket, db):
            raise HTTPException(403, "Нет доступа к заявке")
        if att.is_internal and user.role in (UserRole.customer, UserRole.engineer):
            raise HTTPException(403, "Нет доступа к внутреннему файлу")
    elif att.comment_id:
        from src.models.comment import Comment
        comment = await db.get(Comment, att.comment_id)
        if not comment:
            raise HTTPException(404, "Связанный комментарий не найден")
        if comment.ticket_id:
            ticket = await db.get(Ticket, comment.ticket_id)
            if not ticket:
                raise HTTPException(404, "Связанная заявка не найдена")
            if not await RoleChecker.can_view_ticket_async(user, ticket, db):
                raise HTTPException(403, "Нет доступа к заявке")
    else:
        if user.role not in (UserRole.admin, UserRole.director, UserRole.storekeeper):
            raise HTTPException(403, "Нет доступа к файлу")

    if not os.path.exists(att.path):
        raise HTTPException(404, "Файл не найден на диске")
    real_path = os.path.realpath(att.path)
    uploads_real = os.path.realpath(UPLOAD_DIR)
    if not real_path.startswith(uploads_real + os.sep):
        raise HTTPException(403, "Недопустимый путь")
    return FileResponse(real_path, filename=att.filename)
