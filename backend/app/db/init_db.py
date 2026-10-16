"""Run versioned Alembic migrations.

Kept as a compatibility entry point for the command previously used by
CloudTune developers: python -m app.db.init_db
"""
import sys
from pathlib import Path

from alembic import command
from alembic.config import Config


BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def init_db() -> None:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    command.upgrade(config, "head")
    print("DATABASE MIGRATIONS READY")


if __name__ == "__main__":
    init_db()
