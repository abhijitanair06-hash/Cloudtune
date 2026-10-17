from sqlalchemy import (
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
    func,
)

from app.db.database import Base


class AudioProfile(Base):
    """Audio fingerprints indexed for one user's copy of a song."""

    __tablename__ = "audio_profiles"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "song_id",
            name="uq_audio_profiles_user_song",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
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
    # JSON vectors are small and portable. No external AI service is needed.
    summary = Column(JSON, nullable=False)
    segments = Column(JSON, nullable=False)
    feature_version = Column(String(40), nullable=False, default="cloudtune-v1")
    analyzed_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class SavedMoment(Base):
    """A user's named timestamp inside a song."""

    __tablename__ = "saved_moments"

    id = Column(Integer, primary_key=True, index=True)
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
    start_seconds = Column(Float, nullable=False)
    label = Column(String(160), nullable=False)
    notes = Column(Text, nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )


class TasteFeedback(Base):
    """A single A/B listening experiment response."""

    __tablename__ = "taste_feedback"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    song_a_id = Column(
        Integer,
        ForeignKey("songs.id", ondelete="CASCADE"),
        nullable=False,
    )
    song_b_id = Column(
        Integer,
        ForeignKey("songs.id", ondelete="CASCADE"),
        nullable=False,
    )
    # a, b, both, or neither
    choice = Column(String(12), nullable=False)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        index=True,
    )
