from sqlalchemy import Column, Integer, String, Text, ForeignKey
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

    uploaded_by = Column(
        Integer,
        ForeignKey("users.id"),
        nullable=False
    )