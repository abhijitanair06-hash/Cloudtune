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


class ListeningSession(Base):
    """One listening session for one user and one cloud-catalogue song."""

    __tablename__ = "listening_sessions"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "session_key",
            name="uq_listening_sessions_user_key",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    session_key = Column(String(64), nullable=False)
    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    song_id = Column(
        Integer,
        ForeignKey("songs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    listened_seconds = Column(Float, nullable=False, default=0.0)
    last_position_seconds = Column(Float, nullable=False, default=0.0)
    completed = Column(Boolean, nullable=False, default=False)
    skipped = Column(Boolean, nullable=False, default=False)
    started_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        index=True,
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
