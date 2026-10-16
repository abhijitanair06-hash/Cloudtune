from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)

from app.db.database import Base


class ListenerLikedTrack(Base):
    """An identified track saved to a user's cloud-synced Listener likes."""

    __tablename__ = "listener_liked_tracks"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "track_key",
            name="uq_listener_liked_user_track",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    track_key = Column(String(512), nullable=False)
    source = Column(String(32), nullable=False)
    title = Column(String(255), nullable=False)
    artist = Column(String(255), nullable=False)
    album = Column(String(255), nullable=True)
    artwork_url = Column(Text, nullable=True)
    track_url = Column(Text, nullable=True)
    preview_url = Column(Text, nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        index=True,
    )


class ListenerPlaylistTrack(Base):
    """An externally identified Listener track saved inside a CloudTune playlist."""

    __tablename__ = "listener_playlist_tracks"
    __table_args__ = (
        UniqueConstraint(
            "playlist_id",
            "listener_track_id",
            name="uq_listener_playlist_track",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    playlist_id = Column(
        Integer,
        ForeignKey("user_playlists.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    listener_track_id = Column(
        Integer,
        ForeignKey("listener_liked_tracks.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    position = Column(Integer, nullable=False, default=0)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
