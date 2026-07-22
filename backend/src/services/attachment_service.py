import uuid
import os
from sqlalchemy.ext.asyncio import AsyncSession
from src.models.attachment import Attachment
from src.models.comment import Comment
from src.models.ticket import Ticket
from src.models.user import User
from src.services.acl_service import RoleChecker
from fastapi import UploadFile, HTTPException

UPLOAD_DIR = "uploads"
MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10 MB


class AttachmentService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def upload(
        self,
        file: UploadFile,
        ticket_id: int | None,
        comment_id: int | None,
        user: User,
    ) -> Attachment:
        ticket = None
        if ticket_id:
            ticket = await self.session.get(Ticket, ticket_id)
            if not ticket:
                raise HTTPException(404, "Заявка не найдена")
            if not await RoleChecker.can_view_ticket_async(user, ticket, self.session):
                raise HTTPException(403, "Нет доступа к заявке")

        is_internal = False
        if comment_id:
            comment = await self.session.get(Comment, comment_id)
            if not comment:
                raise HTTPException(404, "Комментарий не найден")
            if comment.is_internal:
                is_internal = True
            if comment.ticket_id:
                ticket = await self.session.get(Ticket, comment.ticket_id)
                if not ticket:
                    raise HTTPException(404, "Заявка не найдена")
                if not await RoleChecker.can_view_ticket_async(user, ticket, self.session):
                    raise HTTPException(403, "Нет доступа к заявке")
                if ticket_id and ticket_id != comment.ticket_id:
                    raise HTTPException(400, "ticket_id не совпадает с comment_id")
                ticket_id = comment.ticket_id

        safe_name = os.path.basename(file.filename or "unknown")
        if not safe_name or safe_name in (".", ".."):
            safe_name = "unknown"
        filename = f"{uuid.uuid4()}_{safe_name}"

        loc_id = ""
        if ticket and ticket.location_id:
            loc_id = str(ticket.location_id)
        path = os.path.join(UPLOAD_DIR, loc_id, filename)
        real_path = os.path.realpath(path)
        uploads_real = os.path.realpath(UPLOAD_DIR)
        if not real_path.startswith(uploads_real + os.sep) and real_path != uploads_real:
            raise HTTPException(400, "Недопустимый путь файла")
        os.makedirs(os.path.dirname(real_path), exist_ok=True)

        if file.size is not None and file.size > MAX_UPLOAD_SIZE:
            raise HTTPException(413, f"Файл превышает лимит {MAX_UPLOAD_SIZE // (1024*1024)} МБ")

        content = await file.read()
        if len(content) > MAX_UPLOAD_SIZE:
            raise HTTPException(413, f"Файл превышает лимит {MAX_UPLOAD_SIZE // (1024*1024)} МБ")

        with open(real_path, "wb") as f:
            f.write(content)

        try:
            attachment = Attachment(
                ticket_id=ticket_id,
                comment_id=comment_id,
                filename=file.filename or "unknown",
                path=os.path.relpath(real_path, os.path.dirname(UPLOAD_DIR)),
                content_type=file.content_type or "application/octet-stream",
                size=len(content),
                is_internal=is_internal,
            )
            self.session.add(attachment)
            await self.session.flush()
            return attachment
        except Exception:
            if os.path.exists(real_path):
                os.remove(real_path)
            raise
