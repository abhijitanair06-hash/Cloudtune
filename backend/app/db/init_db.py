import asyncio

from app.db.database import engine, Base
from app.models.user import User
from app.models.song import Song
from app.models.intelligence import AudioProfile, SavedMoment, TasteFeedback


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    print("DATABASE TABLES READY")


if __name__ == "__main__":
    asyncio.run(init_db())