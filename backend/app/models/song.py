from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    false,
    func,
)

from app.db.database import Base


class Song(Base):
    __tablename__ = "songs"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    artist = Column(String(255), nullable=False)
    album = Column(String(255), nullable=True)
    genre = Column(String(100), nullable=True)
    file_path = Column(Text, nullable=False)
    cover_path = Column(Text, nullable=True)
    uploaded_by = Column(Integer, ForeignKey("users.id"), nullable=False)

    # Soft deletion lets the discovery tools and library hide deleted tracks
    # without breaking older song rows. init_db adds these columns safely.
    is_deleted = Column(Boolean, nullable=False, default=False, server_default=false())
    deleted_at = Column(DateTime(timezone=True), nullable=True)
