from jose import JWTError, jwt
import pytest

from app.core.config import settings
from app.core.jwt import (
    ALGORITHM,
    ISSUER,
    create_access_token,
    create_refresh_token,
    hash_refresh_token,
)


def test_access_token_is_short_lived_and_tagged():
    session_id = "session-test-123"
    token = create_access_token(
        {"sub": "17", "username": "cloudtune-test"},
        session_id,
    )

    claims = jwt.decode(
        token,
        settings.jwt_secret_key.get_secret_value(),
        algorithms=[ALGORITHM],
        issuer=ISSUER,
    )

    assert claims["token_type"] == "access"
    assert claims["sid"] == session_id
    assert claims["sub"] == "17"
    assert 0 < claims["exp"] - claims["iat"] <= settings.access_token_expire_minutes * 60


def test_refresh_token_has_a_separate_signing_key_and_longer_lifetime():
    session_id = "session-test-456"
    data = {"sub": "23", "username": "cloudtune-test"}
    token = create_refresh_token(data, session_id)

    with pytest.raises(JWTError):
        jwt.decode(
            token,
            settings.jwt_secret_key.get_secret_value(),
            algorithms=[ALGORITHM],
            issuer=ISSUER,
        )

    claims = jwt.decode(
        token,
        settings.jwt_refresh_secret_key.get_secret_value(),
        algorithms=[ALGORITHM],
        issuer=ISSUER,
    )
    assert claims["token_type"] == "refresh"
    assert claims["sid"] == session_id
    assert claims["exp"] - claims["iat"] == settings.refresh_token_expire_days * 86400


def test_refresh_token_hash_is_fixed_length_and_not_the_original_token():
    token = create_refresh_token(
        {"sub": "31", "username": "cloudtune-test"},
        "session-test-789",
    )
    digest = hash_refresh_token(token)

    assert len(digest) == 64
    assert digest != token
    assert hash_refresh_token(token) == digest


def test_access_and_refresh_secrets_are_independent():
    access = create_access_token(
        {"sub": "8", "username": "cloudtune-test"},
        "session-test-keys",
    )
    refresh = create_refresh_token(
        {"sub": "8", "username": "cloudtune-test"},
        "session-test-keys",
    )

    with pytest.raises(JWTError):
        jwt.decode(
            access,
            settings.jwt_refresh_secret_key.get_secret_value(),
            algorithms=[ALGORITHM],
            issuer=ISSUER,
        )
    with pytest.raises(JWTError):
        jwt.decode(
            refresh,
            settings.jwt_secret_key.get_secret_value(),
            algorithms=[ALGORITHM],
            issuer=ISSUER,
        )
