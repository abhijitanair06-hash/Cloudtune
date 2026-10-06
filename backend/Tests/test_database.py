import asyncio

from sqlalchemy import text

from app.db.database import engine


async def test_database():
    async with engine.connect() as connection:
        result = await connection.execute(text("SELECT 1"))
        print("DATABASE QUERY OK:", result.scalar())


asyncio.run(test_database())