from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from passlib.hash import bcrypt
from pydantic import BaseModel, Field
from src.database import get_db
from src.models.user import User, UserRole
from src.models.equipment import AssetLocation
from src.core.deps import create_token, get_current_user

api_router = APIRouter()

from .tickets import create_ticket_router
from .attachments import attachment_router
from .equipment import equipment_router
from .warehouse import warehouse_router
from .views import views_router
from .admin import admin_router

api_router.include_router(create_ticket_router())
api_router.include_router(attachment_router)
api_router.include_router(equipment_router)
api_router.include_router(warehouse_router)
api_router.include_router(views_router)
api_router.include_router(admin_router)


class SignupRequest(BaseModel):
    email: str = Field(max_length=255)
    name: str = Field(max_length=255)
    password: str = Field(min_length=4)
    role: str = "dispatcher"
    consent_given: bool = False


class LoginRequest(BaseModel):
    email: str
    password: str


class AuthResponse(BaseModel):
    token: str
    user_id: int
    email: str
    name: str
    role: str
    status: str


@api_router.post("/signup", response_model=AuthResponse, tags=["Auth"])
async def signup(data: SignupRequest, db: AsyncSession = Depends(get_db)):
    from fastapi import HTTPException
    from src.models.user import UserStatus
    from datetime import datetime

    if not data.consent_given:
        raise HTTPException(400, "Требуется согласие на обработку персональных данных")
    if data.role == "admin":
        raise HTTPException(400, "Роль администратора назначается только другим администратором")

    existing = await db.execute(select(User).where(User.email == data.email))
    if existing.scalar_one_or_none():
        raise HTTPException(400, "Email уже зарегистрирован")

    if data.role not in UserRole._value2member_map_:
        raise HTTPException(400, "Неизвестная роль")

    role_enum = UserRole(data.role)
    user = User(
        email=data.email,
        name=data.name,
        role=role_enum,
        password_hash=bcrypt.hash(data.password),
        status=UserStatus.pending,
        consent_given=True,
        consent_date=datetime.utcnow(),
    )
    db.add(user)
    await db.flush()
    await db.commit()

    import os
    try:
        log_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "history.log")
        with open(log_path, "a") as f:
            f.write(f"[{datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')}] СИСТЕМА — Заявка на регистрацию: {user.name} ({user.email}), роль: {data.role}, ожидает утверждения админом\n")
    except:
        pass

    return AuthResponse(
        token="",
        user_id=user.id,
        email=user.email,
        name=user.name,
        role=user.role.value,
        status=user.status.value,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)
    token = create_token(user.id)
    await db.commit()
    return AuthResponse(
        token=token,
        user_id=user.id,
        email=user.email,
        name=user.name,
        role=user.role.value,
    )


@api_router.post("/login", response_model=AuthResponse, tags=["Auth"])
async def login(data: LoginRequest, db: AsyncSession = Depends(get_db)):
    from fastapi import HTTPException
    from src.models.user import UserStatus
    result = await db.execute(select(User).where(User.email == data.email))
    user = result.scalar_one_or_none()
    if not user or not bcrypt.verify(data.password, user.password_hash):
        raise HTTPException(401, "Неверный email или пароль")
    if user.status == UserStatus.pending:
        raise HTTPException(403, "Учётная запись ожидает утверждения администратором")
    if user.status == UserStatus.rejected:
        raise HTTPException(403, "Учётная запись отклонена администратором")
    return AuthResponse(
        token=create_token(user.id),
        user_id=user.id,
        email=user.email,
        name=user.name,
        role=user.role.value,
        status=user.status.value,
    )


class LocationResponse(BaseModel):
    id: int
    name: str
    address: str
    customer_id: int
    customer_name: str = ""
    contacts: str | None = None
    assigned_engineer_id: int | None = None
    assigned_engineer_name: str | None = None
    contract_number: str | None = None
    contract_valid_from: str | None = None
    contract_valid_to: str | None = None

    model_config = {"from_attributes": True}


@api_router.get("/locations", response_model=list[LocationResponse], tags=["Locations"])
async def list_locations(
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from src.models.customer import Customer
    from sqlalchemy.orm import selectinload
    result = await db.execute(
        select(AssetLocation, Customer.name)
        .join(Customer)
        .options(
            selectinload(AssetLocation.assigned_engineer),
            selectinload(AssetLocation.tickets),
        )
    )
    rows = result.all()
    out = []
    for loc, cust_name in rows:
        out.append(LocationResponse(
            id=loc.id, name=loc.name, address=loc.address, customer_id=loc.customer_id,
            customer_name=cust_name,
            contacts=loc.contacts,
            assigned_engineer_id=loc.assigned_engineer_id,
            assigned_engineer_name=loc.assigned_engineer.name if loc.assigned_engineer else None,
            contract_number=loc.contract_number,
            contract_valid_from=loc.contract_valid_from.isoformat() if loc.contract_valid_from else None,
            contract_valid_to=loc.contract_valid_to.isoformat() if loc.contract_valid_to else None,
        ))
    return out


class LocationCreate(BaseModel):
    name: str
    address: str = ""
    contacts: str | None = None
    assigned_engineer_id: int | None = None
    contract_number: str | None = None
    contract_valid_from: str | None = None
    contract_valid_to: str | None = None


class LocationUpdate(BaseModel):
    name: str | None = None
    address: str | None = None
    contacts: str | None = None
    assigned_engineer_id: int | None = None
    contract_number: str | None = None
    contract_valid_from: str | None = None
    contract_valid_to: str | None = None


@api_router.post("/locations", response_model=LocationResponse, tags=["Locations"])
async def create_location(
    data: LocationCreate,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from src.models.customer import Customer
    from datetime import date
    cust = (await db.execute(select(Customer).limit(1))).scalar_one()
    loc = AssetLocation(
        name=data.name, address=data.address, customer_id=cust.id,
        contacts=data.contacts,
        assigned_engineer_id=data.assigned_engineer_id,
        contract_number=data.contract_number,
        contract_valid_from=date.fromisoformat(data.contract_valid_from) if data.contract_valid_from else None,
        contract_valid_to=date.fromisoformat(data.contract_valid_to) if data.contract_valid_to else None,
    )
    db.add(loc)
    await db.flush()
    await db.commit()
    d = LocationResponse.model_validate(loc)
    d.customer_name = cust.name
    if loc.assigned_engineer:
        d.assigned_engineer_name = loc.assigned_engineer.name
    return d


@api_router.patch("/locations/{location_id}", response_model=LocationResponse, tags=["Locations"])
async def update_location(
    location_id: int,
    data: LocationUpdate,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from datetime import date
    loc = await db.get(AssetLocation, location_id)
    if not loc:
        from fastapi import HTTPException
        raise HTTPException(404)
    for field, value in data.model_dump(exclude_unset=True).items():
        if value is not None:
            if field in ("contract_valid_from", "contract_valid_to"):
                setattr(loc, field, date.fromisoformat(value) if value else None)
            else:
                setattr(loc, field, value)
    await db.commit()
    return LocationResponse(
        id=loc.id, name=loc.name, address=loc.address, customer_id=loc.customer_id,
        contacts=loc.contacts, assigned_engineer_id=loc.assigned_engineer_id,
        contract_number=loc.contract_number,
        contract_valid_from=loc.contract_valid_from.isoformat() if loc.contract_valid_from else None,
        contract_valid_to=loc.contract_valid_to.isoformat() if loc.contract_valid_to else None,
    )


class UserListResponse(BaseModel):
    id: int
    email: str
    name: str
    role: str
    status: str

    model_config = {"from_attributes": True}


@api_router.get("/users/list", response_model=list[UserListResponse], tags=["Users"])
async def list_engineers(
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User))
    users = result.scalars().all()
    return [UserListResponse(id=u.id, email=u.email, name=u.name, role=u.role.value, status=u.status.value) for u in users]
