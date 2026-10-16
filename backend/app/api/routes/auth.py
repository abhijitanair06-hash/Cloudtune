from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.passwords import hash_password, verify_password
from app.core.jwt import create_access_token
from app.db.database import get_db
from app.models.user import User
from app.schemas.user import UserCreate, UserLogin, UserResponse


router = APIRouter(
    prefix="/api/auth",
    tags=["Authentication"],
)


@router.post("/register", response_model=UserResponse)
async def register(
    user: UserCreate,
    db: AsyncSession = Depends(get_db),
):
    # This is a personal library: allow registration only for first-time
    # bootstrap. After the first account exists, sign-up is closed.
    count_result = await db.execute(select(func.count(User.id)))
    if count_result.scalar_one() > 0:
        raise HTTPException(
            status_code=403,
            detail="Registration is closed because a CloudTune account already exists.",
        )

    existing_username = await db.execute(
        select(User).where(User.username == user.username)
    )
    if existing_username.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Username already exists")

    existing_email = await db.execute(
        select(User).where(User.email == user.email)
    )
    if existing_email.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already exists")

    new_user = User(
        username=user.username,
        email=user.email,
        password_hash=hash_password(user.password),
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
    result = await db.execute(
        select(User).where(User.username == user.username)
    )
    existing_user = result.scalar_one_or_none()

    # Use the same verifier for Argon2 and legacy bcrypt hashes.
    password_correct = (
        existing_user is not None
        and verify_password(user.password, existing_user.password_hash)
    )

    if existing_user is None or not password_correct:
        raise HTTPException(
            status_code=401,
            detail="Invalid username or password",
        )

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
