from pydantic import SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "CloudTune API"
    app_version: str = "0.1.0"
    environment: str = "development"
    debug: bool = False

    # No embedded database credentials: set this in backend/.env.
    database_url: str

    # Generate each key independently with:
    # python -c "import secrets; print(secrets.token_urlsafe(48))"
    jwt_secret_key: SecretStr
    jwt_refresh_secret_key: SecretStr
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 7

    # Comma-separated browser origins. In production, use the exact frontend origin.
    cors_origins: str = (
        "http://127.0.0.1:5500,http://localhost:5500"
    )

    # Supabase Storage
    supabase_url: str
    supabase_key: SecretStr
    supabase_bucket: str = "music"

    @model_validator(mode="after")
    def validate_security_settings(self) -> "Settings":
        access_secret = self.jwt_secret_key.get_secret_value()
        refresh_secret = self.jwt_refresh_secret_key.get_secret_value()

        for name, value in (
            ("JWT_SECRET_KEY", access_secret),
            ("JWT_REFRESH_SECRET_KEY", refresh_secret),
        ):
            if len(value) < 32:
                raise ValueError(f"{name} must contain at least 32 characters")
            if value.lower().startswith(("replace-with-", "change-me", "your-")):
                raise ValueError(f"{name} must be replaced with a randomly generated secret")

        if access_secret == refresh_secret:
            raise ValueError("JWT_SECRET_KEY and JWT_REFRESH_SECRET_KEY must be different")

        if self.access_token_expire_minutes < 1:
            raise ValueError("ACCESS_TOKEN_EXPIRE_MINUTES must be at least 1")
        if self.refresh_token_expire_days < 1:
            raise ValueError("REFRESH_TOKEN_EXPIRE_DAYS must be at least 1")

        return self

    @property
    def cors_origin_list(self) -> list[str]:
        return [
            origin.strip().rstrip("/")
            for origin in self.cors_origins.split(",")
            if origin.strip()
        ]

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
