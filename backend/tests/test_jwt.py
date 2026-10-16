"""Fast, database-free tests for CloudTune token authentication."""

import os
from datetime import datetime, timedelta, timezone

os.environ.setdefault("JWT_SECRET", "test-only-" + ("x" * 64))
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-only-key")
os.environ.setdefault("ACCESS_TOKEN_EXPIRE_MINUTES", "15")

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


def test_access_token_contains_identity_and_expiry():
    token = create_access_token({"sub": "42", "username": "cloudtune-test"})
    payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])

    assert payload["sub"] == "42"
    assert payload["username"] == "cloudtune-test"
    assert payload["exp"] > datetime.now(timezone.utc).timestamp()
    assert ACCESS_TOKEN_EXPIRE_MINUTES == 15


def test_current_user_accepts_valid_bearer_token():
    token = create_access_token({"sub": "42", "username": "cloudtune-test"})

    user = get_current_user(credentials=credentials(token))

    assert user == {"user_id": 42, "username": "cloudtune-test"}


def test_missing_credentials_return_401():
    with pytest.raises(HTTPException) as exc:
        get_current_user(credentials=None)

    assert exc.value.status_code == 401
    assert exc.value.headers["WWW-Authenticate"] == "Bearer"


@pytest.mark.parametrize("token", ["not-a-jwt", ""])
def test_invalid_tokens_return_401(token):
    with pytest.raises(HTTPException) as exc:
        get_current_user(credentials=credentials(token))

    assert exc.value.status_code == 401


def test_expired_token_returns_401():
    token = jwt.encode(
        {
            "sub": "42",
            "username": "cloudtune-test",
            "exp": datetime.now(timezone.utc) - timedelta(minutes=1),
        },
        SECRET_KEY,
        algorithm=ALGORITHM,
    )

    with pytest.raises(HTTPException) as exc:
        get_current_user(credentials=credentials(token))

    assert exc.value.status_code == 401
