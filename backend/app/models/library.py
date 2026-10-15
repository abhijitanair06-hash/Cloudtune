from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, UniqueConstraint, func

from app.db.database import Base


class Favorite(Base):
    """A song saved to one user's cloud-synced favorites."""

    __tablename__ = "user_favorites"
    __table_args__ = (
        UniqueConstraint("user_id", "song_id", name="uq_user_favorites_user_song"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    song_id = Column(
        Integer, ForeignKey("songs.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class UserPlaylist(Base):
    """A named playlist belonging to one CloudTune account."""

    __tablename__ = "user_playlists"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    name = Column(String(80), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), nullable=False,
        server_default=func.now(), onupdate=func.now(),
    )


class PlaylistTrack(Base):
    """A song and its order inside a user's playlist."""

    __tablename__ = "playlist_tracks"
    __table_args__ = (
        UniqueConstraint("playlist_id", "song_id", name="uq_playlist_tracks_playlist_song"),
    )

    id = Column(Integer, primary_key=True, index=True)
    playlist_id = Column(
        Integer, ForeignKey("user_playlists.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    song_id = Column(
        Integer, ForeignKey("songs.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    position = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
