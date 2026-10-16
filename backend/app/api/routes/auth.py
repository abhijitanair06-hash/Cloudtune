import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from passlib.context import CryptContext

from app.core.config import settings
from app.core.jwt import create_access_token, get_current_user
from app.db.database import get_db
from app.models.session import AuthSession
from app.models.user import User
from app.schemas.user import UserCreate, UserLogin, UserResponse


router = APIRouter(
    prefix="/api/auth",
    tags=["Authentication"],
)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=40, max_length=256)


class LogoutRequest(BaseModel):
    refresh_token: str = Field(min_length=40, max_length=256)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=72)
    new_password: str = Field(min_length=10, max_length=72)


def _hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def _new_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def _access_token(user: User, session_id: int) -> str:
    return create_access_token({
        "sub": str(user.id),
        "username": user.username,
        "sid": str(session_id),
    })


@router.post("/register", response_model=UserResponse)
async def register(
    user: UserCreate,
    db: AsyncSession = Depends(get_db),
):
    # CloudTune is a personal library: allow first-time setup only.
    result = await db.execute(select(User.id).limit(1))
    if result.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Registration is closed because an account already exists",
        )

    result = await db.execute(select(User).where(User.username == user.username))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Username already exists")

    result = await db.execute(select(User).where(User.email == user.email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already exists")

    new_user = User(
        username=user.username,
        email=user.email,
        password_hash=pwd_context.hash(user.password),
    )
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)
    return new_user


@router.post("/login")
async def login(
    user: UserLogin,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.username == user.username))
    existing_user = result.scalar_one_or_none()

    if existing_user is None or not pwd_context.verify(
        user.password, existing_user.password_hash
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    refresh_token = _new_refresh_token()
    now = datetime.now(timezone.utc)
    session = AuthSession(
        user_id=existing_user.id,
        refresh_token_hash=_hash_refresh_token(refresh_token),
        expires_at=now + timedelta(days=settings.refresh_token_expire_days),
        user_agent=(request.headers.get("user-agent") or "Unknown device")[:512],
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    return {
        "status": "success",
        "message": "Login successful",
        "access_token": _access_token(existing_user, session.id),
        "refresh_token": refresh_token,
        "expires_in": settings.access_token_expire_minutes * 60,
        "session_id": session.id,
        "user_id": existing_user.id,
        "username": existing_user.username,
    }


@router.post("/refresh")
async def refresh_access_token(
    payload: RefreshRequest,
    db: AsyncSession = Depends(get_db),
):
    token_hash = _hash_refresh_token(payload.refresh_token)
    result = await db.execute(
        select(AuthSession)
        .where(AuthSession.refresh_token_hash == token_hash)
        .with_for_update()
    )
    session = result.scalar_one_or_none()
    now = datetime.now(timezone.utc)

    if (
        session is None
        or session.revoked_at is not None
        or _as_utc(session.expires_at) <= now
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token is invalid, expired, or revoked",
            headers={"WWW-Authenticate": "Bearer"},
        )

    result = await db.execute(select(User).where(User.id == session.user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session account no longer exists",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Rotate the refresh token on every successful use. The old token is no
    # longer valid once this transaction commits.
    new_refresh_token = _new_refresh_token()
    session.refresh_token_hash = _hash_refresh_token(new_refresh_token)
    session.last_used_at = now
    await db.commit()

    return {
        "status": "success",
        "access_token": _access_token(user, session.id),
        "refresh_token": new_refresh_token,
        "expires_in": settings.access_token_expire_minutes * 60,
        "session_id": session.id,
    }


@router.post("/logout")
async def logout(
    payload: LogoutRequest,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(AuthSession).where(
            AuthSession.refresh_token_hash == _hash_refresh_token(payload.refresh_token)
        )
    )
    session = result.scalar_one_or_none()

    # Keep logout idempotent: clients can clear their local state even if the
    # refresh token has already expired, rotated, or been revoked.
    if session is not None and session.revoked_at is None:
        session.revoked_at = datetime.now(timezone.utc)
        await db.commit()

    return {"status": "success", "message": "Logged out"}


@router.get("/sessions")
async def list_sessions(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(AuthSession)
        .where(AuthSession.user_id == current_user["user_id"])
        .order_by(AuthSession.created_at.desc())
    )
    now = datetime.now(timezone.utc)
    sessions = []
    for session in result.scalars().all():
        expires_at = _as_utc(session.expires_at)
        sessions.append({
            "id": session.id,
            "user_agent": session.user_agent or "Unknown device",
            "created_at": _as_utc(session.created_at).isoformat(),
            "last_used_at": (
                _as_utc(session.last_used_at).isoformat()
                if session.last_used_at else None
            ),
            "expires_at": expires_at.isoformat(),
            "active": session.revoked_at is None and expires_at > now,
            "current": session.id == current_user["session_id"],
        })

    return {"sessions": sessions}


@router.delete("/sessions/{session_id}")
async def revoke_session(
    session_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(AuthSession).where(
            AuthSession.id == session_id,
            AuthSession.user_id == current_user["user_id"],
        )
    )
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.revoked_at is None:
        session.revoked_at = datetime.now(timezone.utc)
        await db.commit()

    return {"status": "success", "message": "Session revoked"}


@router.post("/change-password")
async def change_password(
    payload: ChangePasswordRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == current_user["user_id"]))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    if not pwd_context.verify(payload.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    if payload.current_password == payload.new_password:
        raise HTTPException(status_code=400, detail="New password must be different")

    user.password_hash = pwd_context.hash(payload.new_password)

    # Revoke the other devices. Keep the current session so the user can
    # continue and rotate its refresh token after changing their password.
    result = await db.execute(
        select(AuthSession).where(
            AuthSession.user_id == current_user["user_id"],
            AuthSession.id != current_user["session_id"],
            AuthSession.revoked_at.is_(None),
        )
    )
    now = datetime.now(timezone.utc)
    for session in result.scalars().all():
        session.revoked_at = now

    await db.commit()
    return {"status": "success", "message": "Password changed; other sessions were signed out"}
