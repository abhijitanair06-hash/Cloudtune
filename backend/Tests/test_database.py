"""Optional connectivity check for a separately provisioned test database.

Never connect to a developer's default database during test collection. Set
CLOUDTUNE_TEST_DATABASE_URL only when a disposable database is available.
"""
import asyncio
import os

import pytest
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text


def test_database():
    database_url = os.getenv("CLOUDTUNE_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("CLOUDTUNE_TEST_DATABASE_URL is not configured")

    parsed_url = make_url(database_url)
    connect_args = {}
    if parsed_url.host not in {None, "localhost", "127.0.0.1"}:
        connect_args["ssl"] = "require"

    engine = create_async_engine(
        database_url,
        pool_pre_ping=True,
        connect_args=connect_args,
    )

    async def check_connection():
        try:
            async with engine.connect() as connection:
                result = await connection.execute(text("SELECT 1"))
                assert result.scalar_one() == 1
        finally:
            await engine.dispose()

    asyncio.run(check_connection())
