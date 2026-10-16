import asyncio

from app.db.database import engine, Base
from app.models.user import User
from app.models.session import AuthSession
from app.models.song import Song


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

        # create_all creates new tables but deliberately does not mutate an
        # existing table. These idempotent PostgreSQL statements upgrade old
        # CloudTune databases before the new player/storage code is deployed.
        await conn.exec_driver_sql(
            "ALTER TABLE songs ADD COLUMN IF NOT EXISTS file_sha256 VARCHAR(64)"
        )
        await conn.exec_driver_sql(
            "ALTER TABLE songs ADD COLUMN IF NOT EXISTS file_size_bytes INTEGER NOT NULL DEFAULT 0"
        )
        await conn.exec_driver_sql(
            "ALTER TABLE songs ADD COLUMN IF NOT EXISTS cover_size_bytes INTEGER NOT NULL DEFAULT 0"
        )
        await conn.exec_driver_sql(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_songs_user_file_sha256 "
            "ON songs (uploaded_by, file_sha256)"
        )

    await engine.dispose()
    print("DATABASE TABLES AND STORAGE METADATA READY")


if __name__ == "__main__":
    asyncio.run(init_db())
