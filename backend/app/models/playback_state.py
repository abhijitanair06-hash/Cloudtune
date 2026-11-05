from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
)

from app.db.database import Base


class PlaybackState(Base):
    """The single active playback position/owner for one CloudTune account."""

    __tablename__ = "playback_states"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_playback_states_user"),
    )

    id = Column(Integer, primary_key=True)
    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    song_id = Column(
        Integer,
        ForeignKey("songs.id", ondelete="SET NULL"),
        nullable=True,
    )
    device_id = Column(String(64), nullable=False)
    device_name = Column(
        String(100),
        nullable=False,
        default="CloudTune device",
        server_default="CloudTune device",
    )
    position_seconds = Column(Float, nullable=False, default=0, server_default="0")
    duration_seconds = Column(Float, nullable=True)
    is_playing = Column(Boolean, nullable=False, default=False, server_default="false")
    version = Column(Integer, nullable=False, default=1, server_default="1")
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
