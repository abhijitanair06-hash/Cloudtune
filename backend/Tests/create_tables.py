import asyncio

from app.db.database import engine, Base
from app.models.user import User
from app.models.song import Song
from app.models.auth_session import AuthSession


async def main():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    await engine.dispose()

    print("TABLES CREATED")


asyncio.run(main())