"""Track cover file size for storage quota accounting.

Revision ID: 0003_cover_size
Revises: 0002_song_metadata
"""
from alembic import op
import sqlalchemy as sa


revision = "0003_cover_size"
down_revision = "0002_song_metadata"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {item["name"] for item in sa.inspect(op.get_bind()).get_columns("songs")}
    if "cover_size_bytes" not in columns:
        op.add_column("songs", sa.Column("cover_size_bytes", sa.BigInteger(), nullable=True))


def downgrade() -> None:
    # Preserve usage/accounting metadata to avoid accidental data loss.
    pass
