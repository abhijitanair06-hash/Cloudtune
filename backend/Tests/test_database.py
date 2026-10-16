import os

import pytest
from sqlalchemy import text

from app.db.database import engine


@pytest.mark.asyncio
async def test_database_connection():
    """Optional integration check; set RUN_DATABASE_INTEGRATION_TESTS=1 to enable."""
    if os.getenv("RUN_DATABASE_INTEGRATION_TESTS") != "1":
        pytest.skip("Set RUN_DATABASE_INTEGRATION_TESTS=1 to test a live PostgreSQL instance")

    async with engine.connect() as connection:
        result = await connection.execute(text("SELECT 1"))
        assert result.scalar_one() == 1
