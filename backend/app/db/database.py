from sqlalchemy.ext.asyncio import (
    create_async_engine,
    AsyncSession,
    async_sessionmaker,
)
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings


class Base(DeclarativeBase):
    pass


# Require encrypted connections for hosted databases such as Supabase.
# Keep local PostgreSQL connections simple during local development.
parsed_database_url = make_url(settings.database_url)
is_remote_database = parsed_database_url.host not in {
    None,
    "localhost",
    "127.0.0.1",
}

engine_options = {
    "echo": False,
    "pool_pre_ping": True,
}

if is_remote_database:
    engine_options["connect_args"] = {"ssl": "require"}


engine = create_async_engine(
    settings.database_url,
    **engine_options,
)


AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
