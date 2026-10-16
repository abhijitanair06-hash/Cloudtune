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