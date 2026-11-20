import base64
from io import BytesIO
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock
from zipfile import ZipFile
import zlib

from fastapi import FastAPI
import httpx
import pytest
import pytest_asyncio
from sqlalchemy import func, select

from src.api.attachments import attachment_router
from src.api.tickets import create_ticket_router
from src.core.deps import create_token
from src.database import get_db
from src.models.attachment import Attachment
from src.models.checklist import Checklist, ChecklistField, FieldType
from src.models.customer import Customer
from src.models.equipment import AssetLocation
from src.models.ticket import Ticket, TicketStatus
from src.models.user import User, UserRole, UserStatus
from src.services import attachment_service
from src.services.mail_service import MailService


def sample_pdf():
    document = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for number, content in enumerate((
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] >>",
    ), 1):
        offsets.append(len(document))
        document.extend(f"{number} 0 obj\n".encode() + content + b"\nendobj\n")
    xref = len(document)
    document.extend(b"xref\n0 4\n0000000000 65535 f \n")
    for offset in offsets[1:]:
        document.extend(f"{offset:010d} 00000 n \n".encode())
    document.extend(f"trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return bytes(document)


# Small valid 1-by-1 pixel images and a compressed Word 97 document whose
# only text is "Attachment sample". The tests need no document generators.
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mNgYGAAAAAEAAHI6uv5"
    "AAAAAElFTkSuQmCC"
)
JPEG = base64.b64decode(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a"
    "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA"
    "AAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AP7//2Q=="
)
GIF = base64.b64decode("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7")
DOC = zlib.decompress(base64.b64decode(
    "eJztnE1ME0EUx18/KG0F+sGHFfyoSNBEYzBq4sEYiIiIBlBIvMo3JBQIHyo3LiYeMR68mBhIOJkY"
    "jcSr6MGbyoWDnPBIohG5cbDr/83OlpaKtKRSCe+3eTuzMzvz3s7M7s40+zr/ObA09ar0K23gEjko"
    "anjIFZdmgxy1DvxEx3Ra1DAMTgpDDGFX8W3mne7QleBbs5cD6FQbd3wFpIA6wcbRYVHCJ1DLfVOC"
    "m52mMQzflnGLfrWf1kfTSfnJ8DlFKZxn8QaSB3mvQ4sfkGga9WSa77ilwvb140VIcdasEVLlEyWO"
    "I0H4/6mhUWxt1EG9FKEuGsBRmEaQEqEhPIW7KD/bJgr/Ev2eX8u2HcIOkdfU4KCbkMsNofV53nK2"
    "zRIyBObk+R8qKa/Kfsc56Zpzr3jD+c2+icDLwqVif6i6NOHkWP8LexJbtg0QskuQfOTFMOhDaCeH"
    "2s4RVf807Bzi8dBIgzSM2WCbWpPzwrRIvTr4NdKsXyWReo8zue6LVFO9akwh5KdSLeaS3ahlDPXw"
    "HLMZ8WFIj9oPYf4Zpjro4hlospUM/16h9/qppZTqeE5cnB9odn9CYfOXLC5w1TWZ0rBvRaPwlHgE"
    "hjUivIfwFgzkphhA/nnUY9+yFqIWGkeZdpTkBjybovYaNEufbvRULa6Hlf10F/tRlO1A6TDdQKwH"
    "jcuNGsb1V7kfhmhlHob3qjoXr/dXsnA8UYlNHTvJ4bclpVopYQet+EnYHjOuudxZmqUJClZlvnYe"
    "m+XrtyX6yZ15JYIgCIIgCIIg7B6iWFE7vcmrS05ZevBsda2p1//8kZtOHn/9hdcoIZ3Hwgs/XmQs"
    "/9pJiwVBEARBEARBEARBSJe/rf/tCx8Xnp4u8z9+gvX/qbUXsv4XBEEQBEEQBEEQhN2JWudDHGR+"
    "HM9f0fOX8rlk/q+DB6EXso9M72b2Bi2A+HR+gMwP7AvJ9L5nT/USyH6dfwAhuxyVQQ5CDkEOQ47o"
    "fJbyuHg0S/+DsFdhh4ZB5Y9xRXleDNN4WuOnhHJsVl08hlwe0yVizsyu+1OZCsiEjp+hVmqjduVp"
    "vB0KMHrjryeVMuozeO21cFt5t3RSLcIOGov5QKdKKdltfA+lo5/i9OdQi9IaUd4w43QN2rtjHjfs"
    "xjGonE024wT0c4s7yfKPSVF1TP/GK0/PngvQn277h+L0C4IgCNnhN92GD3o="
))


def sample_docx():
    contents = BytesIO()
    with ZipFile(contents, "w") as document:
        document.writestr("[Content_Types].xml", """
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Override PartName="/word/document.xml"
    ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>""".strip())
        document.writestr("_rels/.rels", """
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
    Target="word/document.xml"/>
</Relationships>""".strip())
        document.writestr("word/document.xml", """
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>Attachment sample</w:t></w:r></w:p></w:body>
</w:document>""".strip())
    return contents.getvalue()


DOCUMENTS = (
    ("Акт.PDF", sample_pdf(), "application/pdf"),
    ("image.png", PNG, "image/png"),
    ("image.jpg", JPEG, "image/jpeg"),
    ("image.jpeg", JPEG, "image/jpeg"),
    ("legacy.doc", DOC, "application/msword"),
    ("report.docx", sample_docx(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
)


@pytest_asyncio.fixture
async def documents_case(postgres_factory, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(MailService, "notify_engineer_assigned", AsyncMock())
    async with postgres_factory() as database:
        customer = Customer(name="Customer")
        database.add(customer)
        await database.flush()
        users = {
            role: User(
                email=f"{role}@example.test", name=role, role=UserRole(role),
                status=UserStatus.active, password_hash="test-only",
                customer_id=customer.id if role == "customer" else None,
            )
            for role in ("customer", "admin", "engineer", "viewer")
        }
        location = AssetLocation(name="Object", address="Address", customer_id=customer.id)
        database.add_all([location, *users.values()])
        await database.flush()
        ticket = Ticket(
            number=1001, subject="Existing", body="", customer_id=customer.id,
            location_id=location.id, assignee_id=users["engineer"].id,
        )
        database.add(ticket)
        await database.commit()

    def client(role):
        app = FastAPI()
        app.include_router(create_ticket_router(), prefix="/api")
        app.include_router(attachment_router, prefix="/api")

        async def database():
            async with postgres_factory() as session:
                yield session

        app.dependency_overrides[get_db] = database
        return httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://abie.test",
            headers={"Authorization": f"Bearer {create_token(users[role].id)}"},
        )

    return SimpleNamespace(
        client=client, ticket_id=ticket.id, postgres=postgres_factory,
        payload={"subject": "With documents", "customer_id": customer.id, "location_id": location.id},
        uploads=tmp_path / "uploads",
    )


def multipart_document(document):
    filename, content, _media_type = document
    return filename, content, "application/octet-stream"


@pytest.mark.asyncio
async def test_documents_added_at_creation_survive_new_application_instance(documents_case):
    case = documents_case
    async with case.client("customer") as client:
        response = await client.post(
            "/api/tickets/with-attachments",
            data={"data": json.dumps(case.payload)},
            files=[("files", multipart_document(document)) for document in DOCUMENTS],
        )
        assert response.status_code == 201, response.text
        ticket_id = response.json()["id"]

    # New ASGI app and request sessions, retaining only PostgreSQL and uploads.
    async with case.client("customer") as restarted:
        response = await restarted.get("/api/attachments", params={"ticket_id": ticket_id})
        assert response.status_code == 200
        attachments = {attachment["filename"]: attachment for attachment in response.json()}
        assert set(attachments) == {filename for filename, _, _ in DOCUMENTS}
        for filename, content, media_type in DOCUMENTS:
            attachment = attachments[filename]
            assert attachment["content_type"] == media_type
            assert attachment["size"] == len(content)
            assert attachment["ticket_id"] == ticket_id
            download = await restarted.get(attachment["download_url"])
            assert download.status_code == 200
            assert download.content == content
            assert download.headers["content-type"] == media_type
            assert download.headers["content-disposition"].startswith("attachment;")


@pytest.mark.asyncio
@pytest.mark.parametrize("document", DOCUMENTS, ids=["pdf", "png", "jpg", "jpeg", "doc", "docx"])
async def test_assigned_engineer_can_add_and_download_each_document_format(documents_case, document):
    case = documents_case
    async with case.client("engineer") as client:
        response = await client.post(
            "/api/attachments", data={"ticket_id": case.ticket_id, "kind": "document"},
            files={"file": multipart_document(document)},
        )
        assert response.status_code == 201, response.text
        received = response.json()
        filename, content, media_type = document
        assert (received["filename"], received["size"], received["content_type"]) == (
            filename, len(content), media_type,
        )
        download = await client.get(received["download_url"])
        assert download.status_code == 200
        assert download.content == content
        assert download.headers["content-type"] == media_type


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["customer", "viewer"])
async def test_add_document_keeps_existing_ticket_acl(documents_case, role):
    case = documents_case
    async with case.client(role) as client:
        response = await client.get(f"/api/tickets/{case.ticket_id}")
        assert response.status_code == 200
        assert response.json()["can_upload_documents"] is False
        denied = await client.post(
            "/api/attachments", data={"ticket_id": case.ticket_id, "kind": "document"},
            files={"file": multipart_document(DOCUMENTS[0])},
        )
        assert denied.status_code == 403


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "filename,content,media_type",
    [
        ("unsupported.txt", sample_pdf(), "application/pdf"),
        ("spoofed.pdf", JPEG, "application/pdf"),
        ("spoofed.doc", bytes.fromhex("d0cf11e0a1b11ae1") + b"not a Word document", "application/msword"),
        ("spoofed.docx", b"PK\x03\x04not a document", DOCUMENTS[-1][2]),
    ],
    ids=["extension", "pdf", "doc", "docx"],
)
async def test_new_document_rejects_invalid_format(documents_case, filename, content, media_type):
    case = documents_case
    async with case.client("admin") as client:
        response = await client.post(
            "/api/attachments", data={"ticket_id": case.ticket_id, "kind": "document"},
            files={"file": (filename, content, media_type)},
        )
        assert response.status_code == 415, response.text
        listing = await client.get("/api/attachments", params={"ticket_id": case.ticket_id})
        assert listing.json() == []
    assert not any(path.is_file() for path in case.uploads.rglob("*"))


@pytest.mark.asyncio
async def test_new_document_rejects_oversize_file(documents_case):
    case = documents_case
    filename, content, media_type = DOCUMENTS[0]
    oversized = content.ljust(attachment_service.MAX_UPLOAD_SIZE + 1, b" ")
    async with case.client("admin") as client:
        response = await client.post(
            "/api/attachments", data={"ticket_id": case.ticket_id, "kind": "document"},
            files={"file": (filename, oversized, media_type)},
        )
        assert response.status_code == 413, response.text
        listing = await client.get("/api/attachments", params={"ticket_id": case.ticket_id})
        assert listing.json() == []
    assert not any(path.is_file() for path in case.uploads.rglob("*"))


@pytest.mark.asyncio
async def test_invalid_document_rolls_back_ticket_and_previously_uploaded_file(documents_case):
    case = documents_case
    async with case.client("admin") as client:
        response = await client.post(
            "/api/tickets/with-attachments", data={"data": json.dumps(case.payload)},
            files=[("files", multipart_document(DOCUMENTS[0])),
                   ("files", ("bad.pdf", b"not a document", "application/pdf"))],
        )
        assert response.status_code == 415, response.text
    async with case.postgres() as database:
        assert await database.scalar(select(func.count()).select_from(Ticket)) == 1
        assert await database.scalar(select(func.count()).select_from(Attachment)) == 0
    assert not any(path.is_file() for path in case.uploads.rglob("*"))


@pytest.mark.asyncio
async def test_document_does_not_replace_required_photo_and_legacy_upload_still_works(documents_case):
    case = documents_case
    ticket_url = f"/api/tickets/{case.ticket_id}"
    async with case.postgres() as database:
        ticket = await database.get(Ticket, case.ticket_id)
        ticket.status = TicketStatus.IN_PROGRESS
        checklist = Checklist(ticket_id=ticket.id, name="Checklist")
        database.add(checklist)
        await database.flush()
        field = ChecklistField(
            checklist_id=checklist.id, label="Photo",
            field_type=FieldType.photo, is_mandatory=True, value="Фото: Акт.PDF",
        )
        database.add(field)
        await database.commit()

    async with case.client("admin") as client:
        document = await client.post(
            "/api/attachments", data={"ticket_id": case.ticket_id, "kind": "document"},
            files={"file": multipart_document(DOCUMENTS[0])},
        )
        assert document.status_code == 201, document.text
        blocked = await client.post(f"{ticket_url}/complete", json={})
        assert blocked.status_code == 409, blocked.text
        assert (await client.get(ticket_url)).json()["status"] == "IN_PROGRESS"

        photo = await client.post(
            "/api/attachments", data={"ticket_id": case.ticket_id},
            files={"file": ("checklist.gif", GIF, "image/gif")},
        )
        assert photo.status_code == 201, photo.text
        update = await client.patch(
            f"{ticket_url}/checklist/{checklist.id}/field/{field.id}", json={"value": "Фото: checklist.gif"},
        )
        assert update.status_code == 200, update.text
        completed = await client.post(f"{ticket_url}/complete", json={})
        assert completed.status_code == 200, completed.text
        assert completed.json()["status"] == "COMPLETED"
