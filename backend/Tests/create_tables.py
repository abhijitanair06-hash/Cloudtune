import asyncio

from app.db.database import engine, Base
from app.models.user import User


async def main():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    await engine.dispose()

    print("TABLES CREATED")


asyncio.run(main())