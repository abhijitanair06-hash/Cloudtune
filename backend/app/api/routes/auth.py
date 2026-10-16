from datetime import datetime, timedelta, timezone
import hmac
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, status
from jose import JWTError
from passlib.context import CryptContext
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.jwt import (
    create_access_token,
    create_refresh_token,
    decode_refresh_token,
    get_current_user,
    hash_refresh_token,
    REFRESH_TOKEN_EXPIRE_DAYS,
)
from app.db.database import get_db
from app.models.auth_session import AuthSession
from app.models.user import User
from app.schemas.user import (
    PasswordChangeRequest,
    RefreshRequest,
    UserCreate,
    UserLogin,
    UserResponse,
)


router = APIRouter(
    prefix="/api/auth",
    tags=["Authentication"],
)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def _invalid_credentials() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid username or password",
        headers={"WWW-Authenticate": "Bearer"},
    )


def _invalid_refresh() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid, expired, or revoked refresh token",
        headers={"WWW-Authenticate": "Bearer"},
    )


def _utc(value: datetime) -> datetime:
    # SQLite test rows can be naive; production PostgreSQL values are timezone-aware.
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def _session_expiry() -> datetime:
    return datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)


def _token_pair(user: User, session_id: str) -> dict[str, str | int]:
    claims = {"sub": str(user.id), "username": user.username}
    return {
        "access_token": create_access_token(claims, session_id),
        "refresh_token": create_refresh_token(claims, session_id),
        "token_type": "bearer",
        "expires_in": settings.access_token_expire_minutes * 60,
        "user_id": user.id,
        "username": user.username,
    }


@router.post("/register", response_model=UserResponse)
async def register(
    user: UserCreate,
    db: AsyncSession = Depends(get_db),
):
    # Serialize first-account creation so concurrent registration requests cannot
    # both observe an empty users table on PostgreSQL.
    await db.execute(text("SELECT pg_advisory_xact_lock(817364821)"))

    account_result = await db.execute(select(User.id).limit(1))
    if account_result.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Registration is closed because this CloudTune instance already has an account",
        )

    username_result = await db.execute(
        select(User.id).where(User.username == user.username)
    )
    if username_result.scalar_one_or_none() is not None:
        raise HTTPException(status_code=400, detail="Username already exists")

    email_result = await db.execute(
        select(User.id).where(User.email == user.email)
    )
    if email_result.scalar_one_or_none() is not None:
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
    result = await db.execute(
        select(User).where(User.username == user.username)
    )
    existing_user = result.scalar_one_or_none()

    if existing_user is None:
        raise _invalid_credentials()

    try:
        password_correct = pwd_context.verify(
            user.password,
            existing_user.password_hash,
        )
    except (ValueError, TypeError):
        password_correct = False

    if not password_correct:
        raise _invalid_credentials()

    session_id = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    client_host = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent", "")[:512] or None

    token_pair = _token_pair(existing_user, session_id)
    auth_session = AuthSession(
        session_id=session_id,
        user_id=existing_user.id,
        refresh_token_hash=hash_refresh_token(str(token_pair["refresh_token"])),
        created_at=now,
        expires_at=_session_expiry(),
        user_agent=user_agent,
        ip_address=client_host,
    )
    db.add(auth_session)
    await db.commit()

    return {
        "status": "success",
        "message": "Login successful",
        **token_pair,
    }


@router.post("/refresh")
async def refresh_tokens(
    body: RefreshRequest,
    db: AsyncSession = Depends(get_db),
):
    try:
        payload = decode_refresh_token(body.refresh_token)
        if payload.get("token_type") != "refresh":
            raise _invalid_refresh()
        user_id = int(payload["sub"])
        username = payload["username"]
        session_id = payload["sid"]
        if not username or not session_id:
            raise _invalid_refresh()
    except HTTPException:
        raise
    except (JWTError, KeyError, TypeError, ValueError):
        raise _invalid_refresh()

    result = await db.execute(
        select(AuthSession).where(
            AuthSession.session_id == session_id,
            AuthSession.user_id == user_id,
            AuthSession.revoked_at.is_(None),
        )
    )
    auth_session = result.scalar_one_or_none()
    now = datetime.now(timezone.utc)

    if (
        auth_session is None
        or _utc(auth_session.expires_at) <= now
    ):
        raise _invalid_refresh()

    if not hmac.compare_digest(
        auth_session.refresh_token_hash,
        hash_refresh_token(body.refresh_token),
    ):
        # A previously rotated refresh token was replayed. Revoke the session.
        auth_session.revoked_at = now
        await db.commit()
        raise _invalid_refresh()

    user_result = await db.execute(select(User).where(User.id == user_id))
    account = user_result.scalar_one_or_none()
    if account is None or account.username != username:
        auth_session.revoked_at = now
        await db.commit()
        raise _invalid_refresh()

    rotated_refresh_token = create_refresh_token(
        {"sub": str(account.id), "username": account.username},
        session_id,
    )
    auth_session.refresh_token_hash = hash_refresh_token(rotated_refresh_token)
    auth_session.expires_at = _session_expiry()
    await db.commit()

    return {
        "status": "success",
        "access_token": create_access_token(
            {"sub": str(account.id), "username": account.username},
            session_id,
        ),
        "refresh_token": rotated_refresh_token,
        "token_type": "bearer",
        "expires_in": settings.access_token_expire_minutes * 60,
        "user_id": account.id,
        "username": account.username,
    }


@router.post("/logout")
async def logout(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(AuthSession).where(
            AuthSession.session_id == current_user["session_id"],
            AuthSession.user_id == current_user["user_id"],
            AuthSession.revoked_at.is_(None),
        )
    )
    auth_session = result.scalar_one_or_none()
    if auth_session is not None:
        auth_session.revoked_at = datetime.now(timezone.utc)
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
        .limit(50)
    )
    sessions = result.scalars().all()
    return [
        {
            "session_id": item.session_id,
            "created_at": item.created_at,
            "expires_at": item.expires_at,
            "revoked_at": item.revoked_at,
            "revoked": item.revoked_at is not None,
            "current": item.session_id == current_user["session_id"],
            "user_agent": item.user_agent,
            "ip_address": item.ip_address,
        }
        for item in sessions
    ]


@router.delete("/sessions/{session_id}")
async def revoke_session(
    session_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if session_id == current_user["session_id"]:
        raise HTTPException(
            status_code=400,
            detail="Use /api/auth/logout to revoke the current session",
        )

    result = await db.execute(
        select(AuthSession).where(
            AuthSession.session_id == session_id,
            AuthSession.user_id == current_user["user_id"],
        )
    )
    auth_session = result.scalar_one_or_none()
    if auth_session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    if auth_session.revoked_at is None:
        auth_session.revoked_at = datetime.now(timezone.utc)
        await db.commit()

    return {"status": "success", "message": "Session revoked"}


@router.post("/change-password")
async def change_password(
    body: PasswordChangeRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User).where(User.id == current_user["user_id"])
    )
    user = result.scalar_one_or_none()
    if user is None:
        raise _invalid_credentials()

    try:
        current_password_valid = pwd_context.verify(
            body.current_password,
            user.password_hash,
        )
    except (ValueError, TypeError):
        current_password_valid = False

    if not current_password_valid:
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    if body.current_password == body.new_password:
        raise HTTPException(
            status_code=400,
            detail="New password must be different from the current password",
        )

    now = datetime.now(timezone.utc)
    user.password_hash = pwd_context.hash(body.new_password)
    await db.execute(
        update(AuthSession)
        .where(
            AuthSession.user_id == current_user["user_id"],
            AuthSession.session_id != current_user["session_id"],
            AuthSession.revoked_at.is_(None),
        )
        .values(revoked_at=now)
    )
    await db.commit()

    return {
        "status": "success",
        "message": "Password changed; other sessions have been signed out",
    }
