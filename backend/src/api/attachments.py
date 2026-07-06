from fastapi import APIRouter, Depends, UploadFile, File, Form, Query
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import os
from src.database import get_db
from src.services.attachment_service import AttachmentService
from src.models.attachment import Attachment
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
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Attachment).where(Attachment.ticket_id == ticket_id).order_by(Attachment.created_at.desc())
    )
    return [AttachmentResponse.model_validate(a) for a in result.scalars().all()]


@attachment_router.get("/attachments/{attachment_id}")
async def download_attachment(
    attachment_id: int,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    att = await db.get(Attachment, attachment_id)
    if not att:
        from fastapi import HTTPException
        raise HTTPException(404, "Файл не найден")
    if not os.path.exists(att.path):
        from fastapi import HTTPException
        raise HTTPException(404, "Файл не найден на диске")
    return FileResponse(att.path, filename=att.filename, media_type=att.content_type)
