from passlib.context import CryptContext


# Prefer Argon2 for new hashes while continuing to verify existing Argon2
# and bcrypt hashes created by earlier CloudTune versions.
password_context = CryptContext(
    schemes=["argon2", "bcrypt"],
    deprecated=["bcrypt"],
)
