from fastapi import APIRouter


def create_comment_router() -> APIRouter:
    return APIRouter(tags=["Comments"])
