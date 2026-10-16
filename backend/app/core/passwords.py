from passlib.context import CryptContext
from passlib.exc import UnknownHashError


# Prefer Argon2 for new hashes while continuing to verify existing Argon2
# and bcrypt hashes created by earlier CloudTune versions.
password_context = CryptContext(
    schemes=["argon2", "bcrypt"],
    deprecated=["bcrypt"],
)


def hash_password(password: str) -> str:
    return password_context.hash(password)


def verify_password(password: str, stored_hash: str) -> bool:
    """Return False for bad passwords or unknown hash formats; never 500."""
    try:
        return password_context.verify(password, stored_hash)
    except (UnknownHashError, ValueError):
        return False
