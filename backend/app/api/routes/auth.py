from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from passlib.context import CryptContext

from app.db.database import get_db
from app.models.user import User
from app.schemas.user import (
    UserCreate,
    UserLogin,
    UserResponse,
)
from app.core.jwt import create_access_token


router = APIRouter(
    prefix="/api/auth",
    tags=["Authentication"],
)


pwd_context = CryptContext(
    schemes=["bcrypt"],
    deprecated="auto",
)


@router.post(
    "/register",
    response_model=UserResponse,
)
async def register(
    user: UserCreate,
    db: AsyncSession = Depends(get_db),
):
    # Check username
    result = await db.execute(
        select(User).where(
            User.username == user.username
        )
    )

    existing_user = result.scalar_one_or_none()

    if existing_user:
        raise HTTPException(
            status_code=400,
            detail="Username already exists",
        )

    # Check email
    result = await db.execute(
        select(User).where(
            User.email == user.email
        )
    )

    existing_email = result.scalar_one_or_none()

    if existing_email:
        raise HTTPException(
            status_code=400,
            detail="Email already exists",
        )

    # Hash password
    hashed_password = pwd_context.hash(
        user.password
    )

    new_user = User(
        username=user.username,
        email=user.email,
        password_hash=hashed_password,
    )

    db.add(new_user)

    await db.commit()
    await db.refresh(new_user)

    return new_user


@router.post("/login")
async def login(
    user: UserLogin,
    db: AsyncSession = Depends(get_db),
):
    # Find user
    result = await db.execute(
        select(User).where(
            User.username == user.username
        )
    )

    existing_user = result.scalar_one_or_none()

    if not existing_user:
        raise HTTPException(
            status_code=401,
            detail="Invalid username or password",
        )

    # Verify password
    password_correct = pwd_context.verify(
        user.password,
        existing_user.password_hash,
    )

    if not password_correct:
        raise HTTPException(
            status_code=401,
            detail="Invalid username or password",
        )

    # Create JWT
    access_token = create_access_token(
        data={
            "sub": str(existing_user.id),
            "username": existing_user.username,
        }
    )

    return {
        "status": "success",
        "message": "Login successful",
        "access_token": access_token,
        "user_id": existing_user.id,
        "username": existing_user.username,
    }