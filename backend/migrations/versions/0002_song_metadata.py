"""Add track metadata, content hash, timestamps and soft-delete support.

Revision ID: 0002_song_metadata
Revises: 0001_baseline
"""
from alembic import op
import sqlalchemy as sa


revision = "0002_song_metadata"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def _columns():
    return {item["name"]: item for item in sa.inspect(op.get_bind()).get_columns("songs")}


def upgrade() -> None:
    columns = _columns()

    if "year" not in columns:
        op.add_column("songs", sa.Column("year", sa.Integer(), nullable=True))
    if "track_number" not in columns:
        op.add_column("songs", sa.Column("track_number", sa.Integer(), nullable=True))
    if "duration_seconds" not in columns:
        op.add_column("songs", sa.Column("duration_seconds", sa.Float(), nullable=True))
    if "file_size_bytes" not in columns:
        op.add_column("songs", sa.Column("file_size_bytes", sa.BigInteger(), nullable=True))
    if "audio_format" not in columns:
        op.add_column(
            "songs",
            sa.Column("audio_format", sa.String(length=16), nullable=False, server_default="mp3"),
        )
    if "sha256" not in columns:
        op.add_column("songs", sa.Column("sha256", sa.String(length=64), nullable=True))
    if "created_at" not in columns:
        op.add_column(
            "songs",
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        )
    if "is_deleted" not in columns:
        op.add_column(
            "songs",
            sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
        )
    if "deleted_at" not in columns:
        op.add_column("songs", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))

    inspector = sa.inspect(op.get_bind())
    unique_constraints = {item.get("name") for item in inspector.get_unique_constraints("songs")}
    if "uq_songs_user_sha256" not in unique_constraints:
        op.create_unique_constraint(
            "uq_songs_user_sha256",
            "songs",
            ["uploaded_by", "sha256"],
        )


def downgrade() -> None:
    # Dropping columns deletes user metadata, so keep downgrade conservative.
    # To reverse this schema, take a backup and create an explicit data-loss migration.
    pass
