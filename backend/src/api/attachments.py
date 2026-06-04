from fastapi import APIRouter, Depends, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from src.database import get_db
from src.services.attachment_service import AttachmentService
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
