"""Baseline schema for existing CloudTune installations.

The migration creates missing tables instead of failing when an existing
personal database already contains tables created by SQLAlchemy create_all().
It also repairs the historically missing songs.uploaded_by column when needed.
"""
from alembic import op
import sqlalchemy as sa


revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(name: str) -> bool:
    return _inspector().has_table(name)


def _columns(table: str) -> dict:
    return {column["name"]: column for column in _inspector().get_columns(table)}


def _ensure_index(table: str, name: str, columns: list[str], unique: bool = False) -> None:
    if not _has_table(table):
        return
    existing = {item["name"] for item in _inspector().get_indexes(table)}
    if name not in existing:
        op.create_index(name, table, columns, unique=unique)


def upgrade() -> None:
    # This revision is deliberately static. Future schema changes belong in
    # new revisions and must not be added to this baseline.
    if not _has_table("users"):
        op.create_table(
            "users",
            sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
            sa.Column("username", sa.String(), nullable=False),
            sa.Column("email", sa.String(), nullable=False),
            sa.Column("password_hash", sa.String(), nullable=False),
        )

    if not _has_table("songs"):
        op.create_table(
            "songs",
            sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("artist", sa.String(length=255), nullable=False),
            sa.Column("album", sa.String(length=255), nullable=True),
            sa.Column("genre", sa.String(length=100), nullable=True),
            sa.Column("file_path", sa.Text(), nullable=False),
            sa.Column("cover_path", sa.Text(), nullable=True),
            sa.Column("uploaded_by", sa.Integer(), nullable=False),
            sa.ForeignKeyConstraint(["uploaded_by"], ["users.id"]),
        )

    if not _has_table("audio_profiles"):
        op.create_table(
            "audio_profiles",
            sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("song_id", sa.Integer(), nullable=False),
            sa.Column("summary", sa.JSON(), nullable=False),
            sa.Column("segments", sa.JSON(), nullable=False),
            sa.Column("feature_version", sa.String(length=40), nullable=False),
            sa.Column("analyzed_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.ForeignKeyConstraint(["song_id"], ["songs.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.UniqueConstraint("user_id", "song_id", name="uq_audio_profiles_user_song"),
        )

    if not _has_table("saved_moments"):
        op.create_table(
            "saved_moments",
            sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("song_id", sa.Integer(), nullable=False),
            sa.Column("start_seconds", sa.Float(), nullable=False),
            sa.Column("label", sa.String(length=160), nullable=False),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.ForeignKeyConstraint(["song_id"], ["songs.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        )

    if not _has_table("taste_feedback"):
        op.create_table(
            "taste_feedback",
            sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("song_a_id", sa.Integer(), nullable=False),
            sa.Column("song_b_id", sa.Integer(), nullable=False),
            sa.Column("choice", sa.String(length=12), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.ForeignKeyConstraint(["song_a_id"], ["songs.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["song_b_id"], ["songs.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        )

    if not _has_table("user_favorites"):
        op.create_table(
            "user_favorites",
            sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("song_id", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.ForeignKeyConstraint(["song_id"], ["songs.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.UniqueConstraint("user_id", "song_id", name="uq_user_favorites_user_song"),
        )

    if not _has_table("user_playlists"):
        op.create_table(
            "user_playlists",
            sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(length=80), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        )

    if not _has_table("playlist_tracks"):
        op.create_table(
            "playlist_tracks",
            sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
            sa.Column("playlist_id", sa.Integer(), nullable=False),
            sa.Column("song_id", sa.Integer(), nullable=False),
            sa.Column("position", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.ForeignKeyConstraint(["playlist_id"], ["user_playlists.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["song_id"], ["songs.id"], ondelete="CASCADE"),
            sa.UniqueConstraint("playlist_id", "song_id", name="uq_playlist_tracks_playlist_song"),
        )

    if not _has_table("listening_sessions"):
        op.create_table(
            "listening_sessions",
            sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
            sa.Column("session_key", sa.String(length=64), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("song_id", sa.Integer(), nullable=False),
            sa.Column("listened_seconds", sa.Float(), nullable=False),
            sa.Column("last_position_seconds", sa.Float(), nullable=False),
            sa.Column("completed", sa.Boolean(), nullable=False),
            sa.Column("skipped", sa.Boolean(), nullable=False),
            sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.ForeignKeyConstraint(["song_id"], ["songs.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.UniqueConstraint("user_id", "session_key", name="uq_listening_sessions_user_key"),
        )

    if not _has_table("listener_liked_tracks"):
        op.create_table(
            "listener_liked_tracks",
            sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("track_key", sa.String(length=512), nullable=False),
            sa.Column("source", sa.String(length=32), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("artist", sa.String(length=255), nullable=False),
            sa.Column("album", sa.String(length=255), nullable=True),
            sa.Column("artwork_url", sa.Text(), nullable=True),
            sa.Column("track_url", sa.Text(), nullable=True),
            sa.Column("preview_url", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.UniqueConstraint("user_id", "track_key", name="uq_listener_liked_user_track"),
        )

    if not _has_table("listener_playlist_tracks"):
        op.create_table(
            "listener_playlist_tracks",
            sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
            sa.Column("playlist_id", sa.Integer(), nullable=False),
            sa.Column("listener_track_id", sa.Integer(), nullable=False),
            sa.Column("position", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.ForeignKeyConstraint(["listener_track_id"], ["listener_liked_tracks.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["playlist_id"], ["user_playlists.id"], ondelete="CASCADE"),
            sa.UniqueConstraint("playlist_id", "listener_track_id", name="uq_listener_playlist_track"),
        )

    # Repair databases created before uploaded_by existed. Existing tracks with
    # no owner are assigned to the earliest account so personal libraries are
    # preserved; if no account exists, stop rather than invent an owner.
    if _has_table("songs"):
        song_columns = _columns("songs")
        if "uploaded_by" not in song_columns:
            op.add_column("songs", sa.Column("uploaded_by", sa.Integer(), nullable=True))
            bind = op.get_bind()
            song_count = bind.execute(sa.text("SELECT count(*) FROM songs")).scalar_one()
            owner_id = bind.execute(sa.text("SELECT id FROM users ORDER BY id LIMIT 1")).scalar_one_or_none()
            if song_count and owner_id is None:
                raise RuntimeError(
                    "Cannot backfill songs.uploaded_by: songs exist but users is empty. "
                    "Create/restore the owning account, then retry the migration."
                )
            if song_count:
                bind.execute(
                    sa.text("UPDATE songs SET uploaded_by = :owner_id WHERE uploaded_by IS NULL"),
                    {"owner_id": owner_id},
                )
            op.create_foreign_key(
                "fk_songs_uploaded_by_users",
                "songs",
                "users",
                ["uploaded_by"],
                ["id"],
            )
            op.alter_column("songs", "uploaded_by", existing_type=sa.Integer(), nullable=False)
        else:
            bind = op.get_bind()
            null_count = bind.execute(
                sa.text("SELECT count(*) FROM songs WHERE uploaded_by IS NULL")
            ).scalar_one()
            if null_count:
                owner_id = bind.execute(sa.text("SELECT id FROM users ORDER BY id LIMIT 1")).scalar_one_or_none()
                if owner_id is None:
                    raise RuntimeError(
                        "Cannot backfill NULL songs.uploaded_by values because users is empty."
                    )
                bind.execute(
                    sa.text("UPDATE songs SET uploaded_by = :owner_id WHERE uploaded_by IS NULL"),
                    {"owner_id": owner_id},
                )
                op.alter_column("songs", "uploaded_by", existing_type=sa.Integer(), nullable=False)

            foreign_keys = _inspector().get_foreign_keys("songs")
            has_owner_fk = any(
                item.get("constrained_columns") == ["uploaded_by"]
                and item.get("referred_table") == "users"
                for item in foreign_keys
            )
            if not has_owner_fk:
                op.create_foreign_key(
                    "fk_songs_uploaded_by_users",
                    "songs",
                    "users",
                    ["uploaded_by"],
                    ["id"],
                )

    # Re-create indexes declared by the ORM, conditionally for old schemas.
    indexes = [
        ("users", "ix_users_id", ["id"], False),
        ("users", "ix_users_username", ["username"], True),
        ("users", "ix_users_email", ["email"], True),
        ("songs", "ix_songs_id", ["id"], False),
        ("audio_profiles", "ix_audio_profiles_id", ["id"], False),
        ("audio_profiles", "ix_audio_profiles_user_id", ["user_id"], False),
        ("audio_profiles", "ix_audio_profiles_song_id", ["song_id"], False),
        ("saved_moments", "ix_saved_moments_id", ["id"], False),
        ("saved_moments", "ix_saved_moments_user_id", ["user_id"], False),
        ("saved_moments", "ix_saved_moments_song_id", ["song_id"], False),
        ("taste_feedback", "ix_taste_feedback_id", ["id"], False),
        ("taste_feedback", "ix_taste_feedback_user_id", ["user_id"], False),
        ("taste_feedback", "ix_taste_feedback_created_at", ["created_at"], False),
        ("user_favorites", "ix_user_favorites_id", ["id"], False),
        ("user_favorites", "ix_user_favorites_user_id", ["user_id"], False),
        ("user_favorites", "ix_user_favorites_song_id", ["song_id"], False),
        ("user_playlists", "ix_user_playlists_id", ["id"], False),
        ("user_playlists", "ix_user_playlists_user_id", ["user_id"], False),
        ("playlist_tracks", "ix_playlist_tracks_id", ["id"], False),
        ("playlist_tracks", "ix_playlist_tracks_playlist_id", ["playlist_id"], False),
        ("playlist_tracks", "ix_playlist_tracks_song_id", ["song_id"], False),
        ("listening_sessions", "ix_listening_sessions_id", ["id"], False),
        ("listening_sessions", "ix_listening_sessions_user_id", ["user_id"], False),
        ("listening_sessions", "ix_listening_sessions_song_id", ["song_id"], False),
        ("listening_sessions", "ix_listening_sessions_started_at", ["started_at"], False),
        ("listener_liked_tracks", "ix_listener_liked_tracks_id", ["id"], False),
        ("listener_liked_tracks", "ix_listener_liked_tracks_user_id", ["user_id"], False),
        ("listener_liked_tracks", "ix_listener_liked_tracks_created_at", ["created_at"], False),
        ("listener_playlist_tracks", "ix_listener_playlist_tracks_id", ["id"], False),
        ("listener_playlist_tracks", "ix_listener_playlist_tracks_playlist_id", ["playlist_id"], False),
        ("listener_playlist_tracks", "ix_listener_playlist_tracks_listener_track_id", ["listener_track_id"], False),
    ]
    for table, name, columns, unique in indexes:
        _ensure_index(table, name, columns, unique)


def downgrade() -> None:
    # Baseline downgrade is intentionally non-destructive: dropping these
    # tables would delete a user's music metadata and listening history.
    pass
