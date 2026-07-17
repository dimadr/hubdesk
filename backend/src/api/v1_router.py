from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from src.database import get_db
from src.core.deps import get_api_key
from src.services.ticket_service import TicketService
from src.api.schemas import TicketResponse
from src.models.customer import Customer
from src.models.equipment import AssetLocation
from src.models.api_key import ApiKey

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
    api_key: ApiKey = Depends(get_api_key),
    db: AsyncSession = Depends(get_db),
):
    customer = await db.get(Customer, data.customer_id)
    if not customer:
        raise HTTPException(400, f"Заказчик с id={data.customer_id} не найден")
    if data.location_id:
        location = await db.get(AssetLocation, data.location_id)
        if not location:
            raise HTTPException(400, f"Объект с id={data.location_id} не найден")

    svc = TicketService(db)
    ticket = await svc.create(data.model_dump())
    await db.commit()
    d = TicketResponse.model_validate(ticket)
    d.customer_name = ticket.customer.name if ticket.customer else None
    d.location_name = ticket.location.name if ticket.location else None
    d.location_address = ticket.location.address if ticket.location else None
    return d
