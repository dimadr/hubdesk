import uuid
import os
from zlib import error as ZlibError
from pathlib import Path
from xml.etree import ElementTree
from zipfile import BadZipFile, ZipFile

from fastapi import UploadFile, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from src.models.attachment import Attachment
from src.models.comment import Comment
from src.models.ticket import Ticket
from src.models.user import User, UserRole
from src.services.acl_service import RoleChecker

UPLOAD_DIR = "uploads"
MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10 MB
DOCUMENT_CONTENT_TYPES = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
DOCUMENT_HEADERS = {
    ".pdf": b"%PDF-",
    ".png": b"\x89PNG\r\n\x1a\n",
    ".jpg": b"\xff\xd8\xff",
    ".jpeg": b"\xff\xd8\xff",
    ".doc": b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1",
}


def _is_word_archive(path: str) -> bool:
    limit = 256 * 1024
    try:
        with ZipFile(path) as archive:
            if archive.getinfo("word/document.xml").file_size == 0:
                return False
            with archive.open("[Content_Types].xml") as member:
                content_types = member.read(limit + 1)
        if len(content_types) > limit:
            return False
        root = ElementTree.fromstring(content_types)
        return any(
            entry.get("PartName") == "/word/document.xml"
            and entry.get("ContentType") == "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
            for entry in root
        )
    except (BadZipFile, KeyError, RuntimeError, NotImplementedError, ElementTree.ParseError,
            ZlibError, EOFError, LookupError):
        return False


def _validate_document(path: str, extension: str) -> None:
    if extension == ".docx":
        valid = _is_word_archive(path)
    else:
        header = DOCUMENT_HEADERS[extension]
        with open(path, "rb") as document:
            valid = document.read(len(header)) == header
            if valid and extension == ".doc":
                valid = "WordDocument\0".encode("utf-16-le") in document.read()
    if not valid:
        raise HTTPException(415, "Содержимое файла не соответствует его формату")


class AttachmentService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def download_path(self, attachment: Attachment, user: User, path: str | None = None) -> str:
        restricted = user.role in (UserRole.customer, UserRole.engineer)
        ticket_id = attachment.ticket_id
        internal = attachment.is_internal
        if attachment.comment_id:
            comment = await self.session.get(Comment, attachment.comment_id)
            if not comment:
                raise HTTPException(404, "Связанный комментарий не найден")
            internal = internal or comment.is_internal
            if ticket_id and comment.ticket_id and ticket_id != comment.ticket_id:
                raise HTTPException(403, "Несогласованная привязка файла")
            ticket_id = ticket_id or comment.ticket_id
        if restricted and internal:
            raise HTTPException(403, "Нет доступа к внутреннему файлу")
        if ticket_id:
            ticket = await self.session.get(Ticket, ticket_id)
            if not ticket:
                raise HTTPException(404, "Связанная заявка не найдена")
            if not await RoleChecker.can_view_ticket_async(user, ticket, self.session):
                raise HTTPException(403, "Нет доступа к заявке")
        elif user.role not in (UserRole.admin, UserRole.director, UserRole.chief_accountant, UserRole.storekeeper):
            raise HTTPException(403, "Нет доступа к файлу")
        real_path = os.path.realpath(path or attachment.path)
        if not real_path.startswith(os.path.realpath(UPLOAD_DIR) + os.sep):
            raise HTTPException(403, "Недопустимый путь")
        if not os.path.isfile(real_path):
            raise HTTPException(404, "Файл не найден на диске")
        return real_path

    @staticmethod
    def remove_stored_file(path: str) -> None:
        real_path = os.path.realpath(path)
        uploads_real = os.path.realpath(UPLOAD_DIR)
        if real_path.startswith(uploads_real + os.sep) and os.path.isfile(real_path):
            os.remove(real_path)

    async def upload(
        self,
        file: UploadFile,
        ticket_id: int | None,
        comment_id: int | None,
        user: User,
        *,
        document: bool = False,
    ) -> Attachment:
        if document and (not ticket_id or comment_id is not None):
            raise HTTPException(422, "Документ должен быть прикреплён к заявке")
        ticket = None
        if ticket_id:
            ticket = await self.session.get(Ticket, ticket_id)
            if not ticket:
                raise HTTPException(404, "Заявка не найдена")
            if not await RoleChecker.can_modify_ticket_async(user, ticket, self.session):
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
                if not await RoleChecker.can_modify_ticket_async(user, ticket, self.session):
                    raise HTTPException(403, "Нет доступа к заявке")
                if ticket_id and ticket_id != comment.ticket_id:
                    raise HTTPException(400, "ticket_id не совпадает с comment_id")

        return await self._store(file, ticket, comment_id, is_internal, document=document)

    async def store_new_ticket_document(self, file: UploadFile, ticket: Ticket) -> Attachment:
        """Attach a file inside the already authorized ticket creation transaction."""
        return await self._store(file, ticket, None, False, document=True)

    async def _store(
        self,
        file: UploadFile,
        ticket: Ticket | None,
        comment_id: int | None,
        is_internal: bool,
        *,
        document: bool,
    ) -> Attachment:
        safe_name = os.path.basename(file.filename or "unknown")
        if not safe_name or safe_name in (".", ".."):
            safe_name = "unknown"
        filename = file.filename or "unknown"
        content_type = file.content_type or "application/octet-stream"
        if document:
            filename = os.path.basename(safe_name.replace("\\", "/"))
            extension = Path(filename).suffix.lower()
            if extension not in DOCUMENT_CONTENT_TYPES:
                raise HTTPException(415, "Допустимые форматы: PDF, PNG, JPG, JPEG, DOC и DOCX")
            if len(filename) > 255:
                raise HTTPException(422, "Имя файла должно содержать не более 255 символов")
            content_type = DOCUMENT_CONTENT_TYPES[extension]
            stored_name = f"{uuid.uuid4()}{extension}"
        else:
            stored_name = f"{uuid.uuid4()}_{safe_name}"

        loc_id = ""
        if ticket and ticket.location_id:
            loc_id = str(ticket.location_id)
        path = os.path.join(UPLOAD_DIR, loc_id, stored_name)
        real_path = os.path.realpath(path)
        uploads_real = os.path.realpath(UPLOAD_DIR)
        if not real_path.startswith(uploads_real + os.sep) and real_path != uploads_real:
            raise HTTPException(400, "Недопустимый путь файла")
        if file.size is not None and file.size > MAX_UPLOAD_SIZE:
            raise HTTPException(413, f"Файл превышает лимит {MAX_UPLOAD_SIZE // (1024*1024)} МБ")

        os.makedirs(os.path.dirname(real_path), exist_ok=True)
        CHUNK_SIZE = 1024 * 1024  # 1 MB
        total_size = 0
        try:
            with open(real_path, "wb") as out:
                while True:
                    chunk = await file.read(CHUNK_SIZE)
                    if not chunk:
                        break
                    total_size += len(chunk)
                    if total_size > MAX_UPLOAD_SIZE:
                        raise HTTPException(413, f"Файл превышает лимит {MAX_UPLOAD_SIZE // (1024*1024)} МБ")
                    out.write(chunk)

            if document:
                await run_in_threadpool(_validate_document, real_path, extension)
            attachment = Attachment(
                ticket_id=ticket.id if ticket else None,
                comment_id=comment_id,
                filename=filename,
                path=os.path.relpath(real_path, os.path.dirname(UPLOAD_DIR)),
                content_type=content_type,
                size=total_size,
                is_internal=is_internal,
            )
            self.session.add(attachment)
            await self.session.flush()
            return attachment
        except BaseException:
            self.remove_stored_file(real_path)
            raise
