from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from src.database import get_db
from src.core.deps import get_api_key
from src.services.ticket_service import TicketService
from src.api.schemas import TicketResponse

v1_router = APIRouter(prefix="/v1", tags=["API v1"])


class TicketCreateV1(BaseModel):
    subject: str = Field(..., max_length=500)
    body: str = Field(default="", max_length=5000)
    customer_id: int = Field(..., description="ID заказчика")
    location_id: int | None = None
    priority: str = "medium"
    type: str | None = None
    site_contact_name: str | None = Field(None, max_length=255)
    site_contact_phone: str | None = Field(None, max_length=50)


@v1_router.post("/tickets", status_code=201, response_model=TicketResponse)
async def create_ticket_v1(
    data: TicketCreateV1,
    api_key=Depends(get_api_key),
    db: AsyncSession = Depends(get_db),
):
    svc = TicketService(db)
    ticket = await svc.create(data.model_dump())
    await db.commit()
    return TicketResponse.model_validate(ticket)
