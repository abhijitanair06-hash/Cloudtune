from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "CloudTune API"
    app_version: str = "0.1.0"
    environment: str = "development"
    debug: bool = True

    database_url: str = (
        "postgresql+asyncpg://cloudtune:"
        "cloudtune_dev_password@localhost:5432/cloudtune"
    )

    # JWT signing key must be generated locally and kept out of Git.
    # Use: python -c "import secrets; print(secrets.token_urlsafe(64))"
    jwt_secret_key: str = Field(min_length=64, repr=False)

    # Comma-separated list; set your real HTTPS app origin before deployment.
    cors_origins: str = "http://127.0.0.1:5500,http://localhost:5500"

    # Supabase Free includes 1 GB Storage at the time of implementation.
    # Keep this configurable because quotas depend on the account's plan.
    storage_quota_bytes: int = Field(default=1_000_000_000, ge=1_000_000)
    storage_upload_block_ratio: float = Field(default=0.95, gt=0.5, le=1.0)

    # Supabase
    supabase_url: str
    supabase_key: str
    supabase_bucket: str = "music"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
