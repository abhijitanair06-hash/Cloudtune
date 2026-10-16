from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.jwt import (
    ACCESS_TOKEN_COOKIE,
    ACCESS_TOKEN_EXPIRE_MINUTES,
    create_access_token,
)
from app.core.passwords import hash_password, verify_password
from app.db.database import get_db
from app.models.user import User
from app.schemas.user import UserCreate, UserLogin, UserResponse


router = APIRouter(
    prefix="/api/auth",
    tags=["Authentication"],
)


def _cookie_is_secure() -> bool:
    return settings.environment.strip().lower() not in {"development", "dev", "local", "test"}


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=ACCESS_TOKEN_COOKIE,
        value=token,
        httponly=True,
        secure=_cookie_is_secure(),
        samesite="strict",
        max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        path="/",
    )


@router.post("/register", response_model=UserResponse)
async def register(
    user: UserCreate,
    db: AsyncSession = Depends(get_db),
):
    # Personal-library bootstrap only: registration closes after the first account.
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
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User).where(User.username == user.username)
    )
    existing_user = result.scalar_one_or_none()

    password_correct = (
        existing_user is not None
        and verify_password(user.password, existing_user.password_hash)
    )
    if existing_user is None or not password_correct:
        raise HTTPException(
            status_code=401,
            detail="Invalid username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token = create_access_token(
        data={
            "sub": str(existing_user.id),
            "username": existing_user.username,
        }
    )
    _set_session_cookie(response, access_token)
    # Do not expose the JWT to frontend JavaScript. The browser stores it as
    # an HttpOnly cookie and sends it on credentialed same-origin/site requests.
    return {
        "status": "success",
        "message": "Login successful",
        "user_id": existing_user.id,
        "username": existing_user.username,
    }


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie(
        key=ACCESS_TOKEN_COOKIE,
        httponly=True,
        secure=_cookie_is_secure(),
        samesite="strict",
        path="/",
    )
    return {"status": "success", "message": "Logged out"}
