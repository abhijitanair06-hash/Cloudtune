from sqlalchemy import Column, ForeignKey, Index, Integer, String, Text
from app.db.database import Base


class Song(Base):
    __tablename__ = "songs"
    __table_args__ = (
        Index("uq_songs_user_file_sha256", "uploaded_by", "file_sha256", unique=True),
    )

    id = Column(Integer, primary_key=True, index=True)

    title = Column(String(255), nullable=False)
    artist = Column(String(255), nullable=False)
    album = Column(String(255), nullable=True)

    genre = Column(String(100), nullable=True)

    file_path = Column(Text, nullable=False)

    cover_path = Column(Text, nullable=True)

    uploaded_by = Column(
        Integer,
        ForeignKey("users.id"),
        nullable=False
    )

    # Hash and sizes support per-user deduplication and storage accounting.
    # Nullable hashes preserve compatibility with songs uploaded before hashing.
    file_sha256 = Column(String(64), nullable=True)
    file_size_bytes = Column(Integer, nullable=False, default=0, server_default="0")
    cover_size_bytes = Column(Integer, nullable=False, default=0, server_default="0")
    lyrics_text = Column(Text, nullable=True)