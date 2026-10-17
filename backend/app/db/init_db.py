import asyncio

from sqlalchemy import text

from app.db.database import engine, Base
# Import every model before create_all so SQLAlchemy registers each table.
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

        # create_all creates new feature tables, but doesn't add columns to an
        # existing songs table. Upgrade it in place without removing user data.
        statements = [
            "ALTER TABLE songs ADD COLUMN IF NOT EXISTS year INTEGER",
            "ALTER TABLE songs ADD COLUMN IF NOT EXISTS track_number INTEGER",
            "ALTER TABLE songs ADD COLUMN IF NOT EXISTS duration_seconds DOUBLE PRECISION",
            "ALTER TABLE songs ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT",
            "ALTER TABLE songs ADD COLUMN IF NOT EXISTS cover_size_bytes BIGINT",
            "ALTER TABLE songs ADD COLUMN IF NOT EXISTS audio_format VARCHAR(16) NOT NULL DEFAULT 'mp3'",
            "ALTER TABLE songs ADD COLUMN IF NOT EXISTS sha256 VARCHAR(64)",
            "ALTER TABLE songs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()",
            "ALTER TABLE songs ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE",
            "ALTER TABLE songs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ",
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_songs_user_sha256 "
            "ON songs (uploaded_by, sha256) WHERE sha256 IS NOT NULL",
        ]
        for statement in statements:
            await conn.execute(text(statement))

    print("DATABASE TABLES READY")


if __name__ == "__main__":
    asyncio.run(init_db())
