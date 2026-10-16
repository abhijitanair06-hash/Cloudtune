import hashlib
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.database import get_db
from app.models.auth_session import AuthSession
from app.models.user import User


ALGORITHM = "HS256"
ISSUER = "cloudtune"
ACCESS_TOKEN_EXPIRE_MINUTES = settings.access_token_expire_minutes
REFRESH_TOKEN_EXPIRE_DAYS = settings.refresh_token_expire_days

# Kept as a compatibility alias for any imports in older code. Do not log it.
SECRET_KEY = settings.jwt_secret_key.get_secret_value()

security = HTTPBearer(auto_error=False)


def hash_refresh_token(token: str) -> str:
    """Store only a one-way hash of a refresh token in the database."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _create_token(
    data: dict[str, Any],
    session_id: str,
    token_type: str,
) -> str:
    now = datetime.now(timezone.utc)
    payload = data.copy()
    payload.update(
        {
            "sid": session_id,
            "token_type": token_type,
            "iat": now,
            "iss": ISSUER,
        }
    )

    if token_type == "access":
        payload["exp"] = now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
        secret = settings.jwt_secret_key.get_secret_value()
    elif token_type == "refresh":
        payload["exp"] = now + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
        secret = settings.jwt_refresh_secret_key.get_secret_value()
    else:
        raise ValueError("Unsupported token type")

    return jwt.encode(payload, secret, algorithm=ALGORITHM)


def create_access_token(data: dict[str, Any], session_id: str) -> str:
    return _create_token(data, session_id, "access")


def create_refresh_token(data: dict[str, Any], session_id: str) -> str:
    return _create_token(data, session_id, "refresh")


def decode_refresh_token(token: str) -> dict[str, Any]:
    return jwt.decode(
        token,
        settings.jwt_refresh_secret_key.get_secret_value(),
        algorithms=[ALGORITHM],
        issuer=ISSUER,
    )


def _unauthorized(detail: str = "Invalid or expired authentication token") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Validate access-token claims and ensure the backing server session is active."""
    if credentials is None:
        raise _unauthorized("Authentication required")

    try:
        payload = jwt.decode(
            credentials.credentials,
            settings.jwt_secret_key.get_secret_value(),
            algorithms=[ALGORITHM],
            issuer=ISSUER,
        )

        if payload.get("token_type") != "access":
            raise _unauthorized("An access token is required")

        user_id = int(payload["sub"])
        username = payload["username"]
        session_id = payload["sid"]

        if not username or not session_id:
            raise _unauthorized()
    except HTTPException:
        raise
    except (JWTError, KeyError, TypeError, ValueError):
        raise _unauthorized()

    user_result = await db.execute(select(User).where(User.id == user_id))
    user = user_result.scalar_one_or_none()
    if user is None or user.username != username:
        raise _unauthorized()

    session_result = await db.execute(
        select(AuthSession).where(
            AuthSession.session_id == session_id,
            AuthSession.user_id == user_id,
            AuthSession.revoked_at.is_(None),
        )
    )
    auth_session = session_result.scalar_one_or_none()
    now = datetime.now(timezone.utc)

    if (
        auth_session is None
        or auth_session.expires_at is None
        or (
            auth_session.expires_at.replace(tzinfo=timezone.utc)
            if auth_session.expires_at.tzinfo is None
            else auth_session.expires_at
        ) <= now
    ):
        raise _unauthorized("Session has expired or been revoked")

    return {
        "user_id": user.id,
        "username": user.username,
        "session_id": auth_session.session_id,
    }
