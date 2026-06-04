from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional


class TicketStatusEnum:
    ASSIGNED = "ASSIGNED"
    ACCEPTED = "ACCEPTED"
    ON_THE_WAY = "ON_THE_WAY"
    ARRIVED = "ARRIVED"
    IN_PROGRESS = "IN_PROGRESS"
    REVIEW = "REVIEW"
    COMPLETED = "COMPLETED"


class TicketPriorityEnum:
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


class UserRoleEnum:
    customer = "customer"
    engineer = "engineer"
    dispatcher = "dispatcher"
    admin = "admin"


class DocTypeEnum:
    INFLOW = "INFLOW"
    TRANSFER = "TRANSFER"
    WRITE_OFF = "WRITE_OFF"


class DocStatusEnum:
    DRAFT = "DRAFT"
    APPROVAL = "APPROVAL"
    DELIVERY = "DELIVERY"
    ACCOUNTED = "ACCOUNTED"


class UserResponse(BaseModel):
    id: int
    email: str
    name: str
    role: str

    model_config = {"from_attributes": True}


class TicketCreate(BaseModel):
    subject: str = Field(..., max_length=500)
    body: str = Field(default="", max_length=5000)
    customer_id: int
    location_id: int
    equipment_id: Optional[int] = None
    priority: str = "medium"
    is_internal: bool = False


class TicketUpdate(BaseModel):
    subject: Optional[str] = Field(None, max_length=500)
    body: Optional[str] = Field(None, max_length=5000)
    priority: Optional[str] = None
    assignee_id: Optional[int] = None
    group_id: Optional[int] = None


class StatusChange(BaseModel):
    status: str


class TicketResponse(BaseModel):
    id: int
    number: int
    subject: str
    body: str
    status: str
    priority: str
    is_internal: bool
    customer_id: int
    location_id: int
    equipment_id: Optional[int]
    assignee_id: Optional[int]
    group_id: Optional[int]
    created_at: datetime
    accepted_at: Optional[datetime]
    completed_at: Optional[datetime]
    response_deadline: Optional[datetime]
    resolution_deadline: Optional[datetime]
    response_overdue: bool = False
    resolution_overdue: bool = False

    model_config = {"from_attributes": True}


class CommentCreate(BaseModel):
    body: str = Field(..., max_length=5000)
    is_internal: bool = False


class CommentResponse(BaseModel):
    id: int
    ticket_id: int
    user_id: int
    body: str
    is_internal: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class AttachmentResponse(BaseModel):
    id: int
    ticket_id: Optional[int]
    comment_id: Optional[int]
    filename: str
    content_type: str
    size: int
    is_internal: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class EquipmentCreate(BaseModel):
    location_id: int
    serial_number: str = Field(..., max_length=100)
    model: str = Field(..., max_length=255)
    qr_code: str = Field(..., max_length=255)


class EquipmentResponse(BaseModel):
    id: int
    location_id: int
    serial_number: str
    model: str
    qr_code: str

    model_config = {"from_attributes": True}


class DocumentLineCreate(BaseModel):
    nomenclature_id: int
    quantity: float = Field(..., gt=0)


class DocLineResponse(BaseModel):
    id: int
    nomenclature_id: int
    quantity: float

    model_config = {"from_attributes": True}


class WarehouseDocCreate(BaseModel):
    doc_type: str
    source_warehouse_id: Optional[int] = None
    target_warehouse_id: Optional[int] = None
    lines: list[DocumentLineCreate]


class WarehouseDocResponse(BaseModel):
    id: int
    doc_type: str
    status: str
    source_warehouse_id: Optional[int]
    target_warehouse_id: Optional[int]
    created_at: datetime
    lines: list[DocLineResponse] = []

    model_config = {"from_attributes": True}


class WarehouseResponse(BaseModel):
    id: int
    name: str
    type: str

    model_config = {"from_attributes": True}


class BalanceResponse(BaseModel):
    warehouse_id: int
    nomenclature_id: int
    quantity: float


class SavedViewCreate(BaseModel):
    name: str = Field(..., max_length=255)
    view_type: str = "table"
    filters: dict = Field(default_factory=dict)
    columns: list[str] = Field(default_factory=list)
    sort_by: Optional[str] = None
    sort_dir: Optional[str] = "asc"


class SavedViewResponse(BaseModel):
    id: int
    name: str
    view_type: str
    filters: dict
    columns: list[str]
    sort_by: Optional[str]
    sort_dir: Optional[str]

    model_config = {"from_attributes": True}


class TicketFilter(BaseModel):
    status: Optional[str] = None
    priority: Optional[str] = None
    assignee_id: Optional[int] = None
    customer_id: Optional[int] = None
    q: Optional[str] = None
    overdue: Optional[bool] = None
    limit: int = Field(default=50, le=200)
    offset: int = Field(default=0)
