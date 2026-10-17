import asyncio

from sqlalchemy import text

from app.db.database import engine, Base
from app.models.user import User  # noqa: F401
from app.models.song import Song  # noqa: F401
from app.models.auth_session import AuthSession  # noqa: F401
from app.models.library import Favorite, PlaylistTrack, UserPlaylist  # noqa: F401
from app.models.intelligence import AudioProfile, SavedMoment, TasteFeedback  # noqa: F401
from app.models.listener import ListenerLikedTrack, ListenerPlaylistTrack  # noqa: F401
from app.models.recommendation import ListeningSession  # noqa: F401


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

        # create_all creates new feature tables, but does not add columns to an
        # existing songs table. These PostgreSQL-safe statements upgrade it in place.
        await conn.execute(text(
            "ALTER TABLE songs ADD COLUMN IF NOT EXISTS "
            "is_deleted BOOLEAN NOT NULL DEFAULT FALSE"
        ))
        await conn.execute(text(
            "ALTER TABLE songs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ"
        ))

    print("DATABASE TABLES READY")


if __name__ == "__main__":
    asyncio.run(init_db())
