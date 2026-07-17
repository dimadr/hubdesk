from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from src.database import get_db
from src.models.personal_task import PersonalTask
from src.models.user import User, UserRole
from src.core.deps import get_current_user

personal_tasks_router = APIRouter(prefix="/personal-tasks", tags=["Personal Tasks"])


class TaskCreate(BaseModel):
    title: str
    description: str = ""
    column: str = "todo"
    ticket_id: int | None = None
    user_id: int | None = None


class TaskUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    column: str | None = None
    position: int | None = None


class TaskResponse(BaseModel):
    id: int
    title: str
    description: str
    column: str
    position: int
    ticket_id: int | None
    ticket_subject: str | None = None
    ticket_status: str | None = None
    created_at: str

    model_config = {"from_attributes": True}


@personal_tasks_router.get("", response_model=list[TaskResponse])
async def list_tasks(
    user_id: int | None = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    target_id = user.id
    if user_id and user.role in (UserRole.admin, UserRole.director):
        target_id = user_id
    from src.models.ticket import Ticket
    result = await db.execute(
        select(PersonalTask).where(PersonalTask.user_id == target_id).order_by(PersonalTask.position)
    )
    tasks = result.scalars().all()
    out = []
    for t in tasks:
        d = TaskResponse(
            id=t.id, title=t.title, description=t.description,
            column=t.column, position=t.position, ticket_id=t.ticket_id,
            created_at=t.created_at.isoformat() if t.created_at else "",
        )
        if t.ticket_id:
            ticket = await db.get(Ticket, t.ticket_id)
            if ticket:
                d.ticket_subject = ticket.subject
                d.ticket_status = ticket.status.value
        out.append(d)
    return out


@personal_tasks_router.post("", status_code=201, response_model=TaskResponse)
async def create_task(data: TaskCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    target_user_id = user.id
    if data.user_id and user.role in (UserRole.admin, UserRole.director):
        target_user_id = data.user_id
    pos_result = await db.execute(
        select(PersonalTask).where(PersonalTask.user_id == target_user_id, PersonalTask.column == data.column)
    )
    max_pos = len(pos_result.scalars().all())
    task = PersonalTask(
        user_id=target_user_id, title=data.title, description=data.description,
        column=data.column, position=max_pos, ticket_id=data.ticket_id,
    )
    db.add(task)
    await db.flush()
    await db.commit()
    return TaskResponse(
        id=task.id, title=task.title, description=task.description,
        column=task.column, position=task.position, ticket_id=task.ticket_id,
        created_at=task.created_at.isoformat() if task.created_at else "",
    )


@personal_tasks_router.patch("/{task_id}", response_model=TaskResponse)
async def update_task(task_id: int, data: TaskUpdate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    task = await db.get(PersonalTask, task_id)
    if not task or (task.user_id != user.id and user.role not in (UserRole.admin, UserRole.director)):
        raise HTTPException(404)
    if data.title is not None:
        task.title = data.title
    if data.description is not None:
        task.description = data.description
    if data.column is not None:
        task.column = data.column
    if data.position is not None:
        task.position = data.position
    await db.commit()
    return TaskResponse(
        id=task.id, title=task.title, description=task.description,
        column=task.column, position=task.position, ticket_id=task.ticket_id,
        created_at=task.created_at.isoformat() if task.created_at else "",
    )


@personal_tasks_router.delete("/{task_id}")
async def delete_task(task_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    task = await db.get(PersonalTask, task_id)
    if not task or (task.user_id != user.id and user.role not in (UserRole.admin, UserRole.director)):
        raise HTTPException(404)
    await db.delete(task)
    await db.commit()
    return {"ok": True}
