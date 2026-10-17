"""Create/update CloudTune's database tables using the project initializer.

Run from backend with: python -m app.db.init_db
"""
from app.db.init_db import init_db
import asyncio


if __name__ == "__main__":
    asyncio.run(init_db())
