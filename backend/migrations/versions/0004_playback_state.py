"""Persist the current playback position and active device.

Revision ID: 0004_playback_state
Revises: 0003_cover_size
"""
from alembic import op
import sqlalchemy as sa


revision = "0004_playback_state"
down_revision = "0003_cover_size"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if sa.inspect(op.get_bind()).has_table("playback_states"):
        return

    op.create_table(
        "playback_states",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("song_id", sa.Integer(), nullable=True),
        sa.Column("device_id", sa.String(length=64), nullable=False),
        sa.Column(
            "device_name",
            sa.String(length=100),
            nullable=False,
            server_default="CloudTune device",
        ),
        sa.Column("position_seconds", sa.Float(), nullable=False, server_default="0"),
        sa.Column("duration_seconds", sa.Float(), nullable=True),
        sa.Column("is_playing", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["song_id"], ["songs.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("user_id", name="uq_playback_states_user"),
    )
    op.create_index(
        "ix_playback_states_updated_at",
        "playback_states",
        ["updated_at"],
        unique=False,
    )


def downgrade() -> None:
    # Playback state is small, but keep downgrade non-destructive like the
    # existing CloudTune migrations. Remove it manually only after a backup.
    pass
