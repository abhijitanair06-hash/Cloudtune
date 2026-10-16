from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    false,
    func,
)

from app.db.database import Base


class Song(Base):
    __tablename__ = "songs"
    __table_args__ = (
        UniqueConstraint("uploaded_by", "sha256", name="uq_songs_user_sha256"),
    )

    id = Column(Integer, primary_key=True, index=True)

    title = Column(String(255), nullable=False)
    artist = Column(String(255), nullable=False)
    album = Column(String(255), nullable=True)
    genre = Column(String(100), nullable=True)
    year = Column(Integer, nullable=True)
    track_number = Column(Integer, nullable=True)

    file_path = Column(Text, nullable=False)
    cover_path = Column(Text, nullable=True)

    duration_seconds = Column(Float, nullable=True)
    file_size_bytes = Column(BigInteger, nullable=True)
    audio_format = Column(
        String(16),
        nullable=False,
        default="mp3",
        server_default="mp3",
    )
    sha256 = Column(String(64), nullable=True, index=False)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    # Soft-deleted songs leave their metadata/audio in place until permanent
    # deletion, allowing the owner to restore them from Trash.
    is_deleted = Column(Boolean, nullable=False, default=False, server_default=false())
    deleted_at = Column(DateTime(timezone=True), nullable=True)

    uploaded_by = Column(
        Integer,
        ForeignKey("users.id"),
        nullable=False,
    )
