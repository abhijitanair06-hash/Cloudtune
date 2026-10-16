from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "CloudTune API"
    app_version: str = "0.1.0"
    environment: str = "development"
    debug: bool = False

    database_url: str = (
        "postgresql+asyncpg://cloudtune:"
        "cloudtune_dev_password@localhost:5432/cloudtune"
    )

    # Authentication: the secret must be supplied through the environment.
    # Do not add a fallback secret here; a missing secret should fail fast.
    jwt_secret: str
    access_token_expire_minutes: int = 15

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
