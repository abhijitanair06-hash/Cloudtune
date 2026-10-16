"""Database-mocked tests for signed access tokens and session validation."""

import asyncio
import os
from datetime import datetime, timedelta, timezone

os.environ.setdefault("JWT_SECRET", "test-only-" + ("x" * 64))
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@127.0.0.1:5432/cloudtune_test")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-only-key")
os.environ.setdefault("ACCESS_TOKEN_EXPIRE_MINUTES", "15")
os.environ.setdefault("REFRESH_TOKEN_EXPIRE_DAYS", "14")

import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from jose import jwt

from app.core.jwt import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    ALGORITHM,
    SECRET_KEY,
    create_access_token,
    get_current_user,
)


def credentials(token: str) -> HTTPAuthorizationCredentials:
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


class FakeResult:
    def __init__(self, value):
        self.value = value

    def scalar_one_or_none(self):
        return self.value


class FakeDatabase:
    def __init__(self, session):
        self.session = session

    async def execute(self, _statement):
        return FakeResult(self.session)


def active_session(session_id=7, user_id=42, revoked_at=None, expires_at=None):
    return type("SessionStub", (), {
        "id": session_id,
        "user_id": user_id,
        "revoked_at": revoked_at,
        "expires_at": expires_at or datetime.now(timezone.utc) + timedelta(days=1),
    })()


def test_access_token_contains_identity_and_expiry():
    token = create_access_token({"sub": "42", "username": "cloudtune-test", "sid": "7"})
    payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])

    assert payload["sub"] == "42"
    assert payload["username"] == "cloudtune-test"
    assert payload["sid"] == "7"
    assert payload["exp"] > datetime.now(timezone.utc).timestamp()
    assert ACCESS_TOKEN_EXPIRE_MINUTES == 15


def test_current_user_accepts_valid_bearer_token():
    token = create_access_token({"sub": "42", "username": "cloudtune-test", "sid": "7"})
    user = asyncio.run(get_current_user(
        credentials=credentials(token),
        db=FakeDatabase(active_session()),
    ))

    assert user == {
        "user_id": 42,
        "username": "cloudtune-test",
        "session_id": 7,
    }


def test_missing_credentials_return_401():
    with pytest.raises(HTTPException) as exc:
        asyncio.run(get_current_user(credentials=None, db=None))

    assert exc.value.status_code == 401
    assert exc.value.headers["WWW-Authenticate"] == "Bearer"


@pytest.mark.parametrize("token", ["not-a-jwt", ""])
def test_invalid_tokens_return_401(token):
    with pytest.raises(HTTPException) as exc:
        asyncio.run(get_current_user(credentials=credentials(token), db=None))

    assert exc.value.status_code == 401


def test_expired_token_returns_401():
    token = jwt.encode(
        {
            "sub": "42",
            "username": "cloudtune-test",
            "sid": "7",
            "exp": datetime.now(timezone.utc) - timedelta(minutes=1),
        },
        SECRET_KEY,
        algorithm=ALGORITHM,
    )

    with pytest.raises(HTTPException) as exc:
        asyncio.run(get_current_user(credentials=credentials(token), db=None))

    assert exc.value.status_code == 401


def test_revoked_server_session_returns_401():
    token = create_access_token({"sub": "42", "username": "cloudtune-test", "sid": "7"})
    session = active_session(revoked_at=datetime.now(timezone.utc))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(get_current_user(
            credentials=credentials(token),
            db=FakeDatabase(session),
        ))

    assert exc.value.status_code == 401


def test_expired_server_session_returns_401():
    token = create_access_token({"sub": "42", "username": "cloudtune-test", "sid": "7"})
    session = active_session(expires_at=datetime.now(timezone.utc) - timedelta(seconds=1))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(get_current_user(
            credentials=credentials(token),
            db=FakeDatabase(session),
        ))

    assert exc.value.status_code == 401
