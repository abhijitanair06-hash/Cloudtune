from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from pwdlib import PasswordHash

from app.core.jwt import create_access_token, get_current_user
from app.db.database import get_db
from app.models.user import User
from app.schemas.user import UserCreate, UserResponse, UsernameUpdate


router = APIRouter(
    prefix="/api/users",
    tags=["Users"]
)


password_hash = PasswordHash.recommended()


# ============================================================
# CREATE USER
# ============================================================

@router.post("/", response_model=UserResponse)
async def create_user(
    user_data: UserCreate,
    db: AsyncSession = Depends(get_db)
):
    # Check if email already exists
    result = await db.execute(
        select(User).where(User.email == user_data.email)
    )

    existing_user = result.scalar_one_or_none()

    if existing_user:
        return {
            "id": existing_user.id,
            "username": existing_user.username,
            "email": existing_user.email
        }

    # Hash password
    hashed_password = password_hash.hash(user_data.password)

    # Create user
    user = User(
        username=user_data.username,
        email=user_data.email,
        password_hash=hashed_password
    )

    db.add(user)

    await db.commit()
    await db.refresh(user)

    return user


# ============================================================
# GET CURRENT USER PROFILE
# ============================================================

@router.get("/me")
async def get_my_profile(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    user_id = current_user["user_id"]

    result = await db.execute(
        select(User).where(User.id == user_id)
    )

    user = result.scalar_one_or_none()

    if user is None:
        raise HTTPException(
            status_code=404,
            detail="User not found"
        )

    return {
        "id": user.id,
        "username": user.username,
        "email": user.email
    }


# ============================================================
# RENAME CURRENT USER
# ============================================================

@router.patch("/me/username")
async def rename_my_username(
    username_data: UsernameUpdate,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    user_id = current_user["user_id"]
    new_username = username_data.username.strip()

    # Check the account still exists.
    result = await db.execute(
        select(User).where(User.id == user_id)
    )
    user = result.scalar_one_or_none()

    if user is None:
        raise HTTPException(
            status_code=404,
            detail="User not found"
        )

    # Usernames are treated as case-insensitively unique.
    result = await db.execute(
        select(User).where(
            func.lower(User.username) == new_username.lower(),
            User.id != user_id
        )
    )
    existing_user = result.scalar_one_or_none()

    if existing_user is not None:
        raise HTTPException(
            status_code=409,
            detail="That username is already taken"
        )

    user.username = new_username

    try:
        await db.commit()
        await db.refresh(user)
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail="That username is already taken"
        )

    # Return a replacement token so the token's username claim is current.
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
        "note": "Authorize again with the new access_token in Swagger."
    }
