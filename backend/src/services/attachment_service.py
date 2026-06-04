import uuid
import os
from sqlalchemy.ext.asyncio import AsyncSession
from src.models.attachment import Attachment
from src.models.comment import Comment
from src.models.user import User
from fastapi import UploadFile

UPLOAD_DIR = "uploads"


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
        is_internal = False
        if comment_id:
            comment = await self.session.get(Comment, comment_id)
            if comment and comment.is_internal:
                is_internal = True

        filename = f"{uuid.uuid4()}_{file.filename}"
        path = os.path.join(UPLOAD_DIR, filename)
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        content = await file.read()
        with open(path, "wb") as f:
            f.write(content)

        attachment = Attachment(
            ticket_id=ticket_id,
            comment_id=comment_id,
            filename=file.filename or "unknown",
            path=path,
            content_type=file.content_type or "application/octet-stream",
            size=len(content),
            is_internal=is_internal,
        )
        self.session.add(attachment)
        await self.session.flush()
        return attachment
