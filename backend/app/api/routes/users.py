from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pwdlib import PasswordHash

from app.db.database import get_db
from app.models.user import User
from app.schemas.user import UserCreate, UserResponse
from app.core.jwt import get_current_user


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