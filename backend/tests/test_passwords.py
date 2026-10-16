from passlib.context import CryptContext

from app.core.passwords import hash_password, verify_password


def test_new_password_hashes_use_argon2_and_verify():
    stored_hash = hash_password("a-long-test-password")
    assert stored_hash.startswith("$argon2")
    assert verify_password("a-long-test-password", stored_hash)
    assert not verify_password("wrong-password", stored_hash)


def test_legacy_bcrypt_hashes_still_verify():
    legacy_hasher = CryptContext(schemes=["bcrypt"], deprecated="auto")
    stored_hash = legacy_hasher.hash("legacy-test-password")
    assert verify_password("legacy-test-password", stored_hash)
    assert not verify_password("wrong-password", stored_hash)


def test_unknown_hash_is_a_failed_login_not_an_exception():
    assert verify_password("any-password", "unrecognized-hash-format") is False
