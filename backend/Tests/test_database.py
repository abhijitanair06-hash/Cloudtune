"""Optional integration test for a separately provisioned test database.

Set CLOUDTUNE_TEST_DATABASE_URL to an isolated database URL to enable it.
The default CI run skips this test and never connects to a developer database.
"""

import asyncio
import os

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine


TEST_DATABASE_URL = os.getenv("CLOUDTUNE_TEST_DATABASE_URL")


@pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="Set CLOUDTUNE_TEST_DATABASE_URL to run the database integration test",
)
def test_database_connection():
    async def check_connection():
        engine = create_async_engine(TEST_DATABASE_URL)
        try:
            async with engine.connect() as connection:
                result = await connection.execute(text("SELECT 1"))
                assert result.scalar_one() == 1
        finally:
            await engine.dispose()

    asyncio.run(check_connection())
