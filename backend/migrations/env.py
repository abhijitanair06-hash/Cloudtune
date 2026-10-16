import asyncio

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import settings
from app.db.database import Base

# Import every model so Alembic sees all tables during autogenerate.
from app.models.user import User  # noqa: F401
from app.models.song import Song  # noqa: F401
from app.models.intelligence import AudioProfile, SavedMoment, TasteFeedback  # noqa: F401
from app.models.library import Favorite, UserPlaylist, PlaylistTrack  # noqa: F401
from app.models.recommendation import ListeningSession  # noqa: F401
from app.models.listener import ListenerLikedTrack, ListenerPlaylistTrack  # noqa: F401


config = context.config
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=settings.database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    parsed_url = make_url(settings.database_url)
    connect_args = {}
    if parsed_url.host not in {None, "localhost", "127.0.0.1"}:
        connect_args["ssl"] = "require"

    connectable = create_async_engine(
        settings.database_url,
        poolclass=pool.NullPool,
        connect_args=connect_args,
    )
    try:
        async with connectable.connect() as connection:
            await connection.run_sync(do_run_migrations)
    finally:
        await connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
