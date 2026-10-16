from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "CloudTune API"
    app_version: str = "0.1.0"
    environment: str = "development"
    debug: bool = False

    database_url: str

    # Authentication: the secret must be supplied through the environment.
    # Do not add a fallback secret here; a missing secret should fail fast.
    jwt_secret: str
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 14
    cors_origins: list[str] = [
        "http://127.0.0.1:5500",
        "http://localhost:5500",
    ]

    # Supabase
    supabase_url: str
    supabase_key: str
    supabase_bucket: str = "music"

    @field_validator("jwt_secret")
    @classmethod
    def validate_jwt_secret(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 64 or "replace-with" in value.lower() or "change-this" in value.lower():
            raise ValueError(
                "JWT_SECRET must be a private random secret of at least 64 characters; "
                "generate one with secrets.token_hex(32)"
            )
        return value

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
