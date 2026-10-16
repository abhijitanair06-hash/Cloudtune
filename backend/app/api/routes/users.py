from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.jwt import create_access_token, get_current_user
from app.db.database import get_db
from app.models.user import User
from app.schemas.user import UsernameUpdate


router = APIRouter(
    prefix="/api/users",
    tags=["Users"],
)


@router.get("/me")
async def get_my_profile(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user_id = current_user["user_id"]
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
    }


@router.patch("/me/username")
async def rename_my_username(
    username_data: UsernameUpdate,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user_id = current_user["user_id"]
    new_username = username_data.username.strip()

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    result = await db.execute(
        select(User).where(
            func.lower(User.username) == new_username.lower(),
            User.id != user_id,
        )
    )
    if result.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="That username is already taken")

    user.username = new_username
    try:
        await db.commit()
        await db.refresh(user)
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="That username is already taken")

    access_token = create_access_token(
        data={
            "sub": str(user.id),
            "username": user.username,
        }
    )
    return {
        "status": "success",
        "message": "Username updated successfully",
        "id": user.id,
        "username": user.username,
        "access_token": access_token,
        "note": "Authorize again with the new access_token in Swagger.",
    }
