import uuid

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from supabase import create_client, Client

from app.core.config import settings
from app.core.jwt import get_current_user
from app.db.database import get_db
from app.models.song import Song


router = APIRouter(prefix="/api/songs", tags=["Songs"])

MAX_AUDIO_SIZE = 50 * 1024 * 1024
MAX_COVER_SIZE = 5 * 1024 * 1024

supabase: Client = create_client(settings.supabase_url, settings.supabase_key)


def _user_id(current_user: dict) -> int:
    return int(current_user["user_id"])


def _is_mp3(data: bytes) -> bool:
    # MP3 files usually start with an ID3 tag or an MPEG audio frame sync.
    return data.startswith(b"ID3") or (
        len(data) >= 2 and data[0] == 0xFF and (data[1] & 0xE0) == 0xE0
    )


def _cover_format(data: bytes) -> tuple[str, str] | None:
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg", "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png", "image/png"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp", "image/webp"
    return None


def _remove_storage_objects(paths: list[str]) -> None:
    if not paths:
        return
    try:
        supabase.storage.from_(settings.supabase_bucket).remove(paths)
    except Exception:
        # Do not hide the original upload/database error. The orphan sweeper
        # added to the reliability roadmap can catch any cleanup failures.
        pass


@router.post("/upload")
async def upload_song(
    title: str = Form(...),
    artist: str = Form(...),
    album: str | None = Form(None),
    genre: str | None = Form(None),
    file: UploadFile = File(...),
    cover: UploadFile | None = File(None),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    original_filename = (file.filename or "").lower()
    if not original_filename.endswith(".mp3"):
        raise HTTPException(status_code=400, detail="Only .mp3 files are currently allowed")

    if file.content_type not in ("audio/mpeg", "audio/mp3", "application/octet-stream", None):
        raise HTTPException(status_code=400, detail="Only MP3 files are allowed")

    # Read at most limit + 1 bytes so oversized uploads are rejected quickly.
    file_data = await file.read(MAX_AUDIO_SIZE + 1)
    if len(file_data) > MAX_AUDIO_SIZE:
        raise HTTPException(status_code=413, detail="MP3 exceeds the 50 MB upload limit")
    if not _is_mp3(file_data):
        raise HTTPException(status_code=400, detail="The uploaded file does not contain MP3 audio")

    # Validate and read the cover *before* uploading audio. This avoids leaving
    # an audio object behind if the cover is invalid.
    cover_data = None
    cover_format = None
    if cover is not None:
        cover_filename = (cover.filename or "").lower()
        if not cover_filename.endswith((".jpg", ".jpeg", ".png", ".webp")):
            raise HTTPException(status_code=400, detail="Cover must be JPG, JPEG, PNG or WEBP")

        cover_data = await cover.read(MAX_COVER_SIZE + 1)
        if len(cover_data) > MAX_COVER_SIZE:
            raise HTTPException(status_code=413, detail="Cover image exceeds the 5 MB upload limit")
        cover_format = _cover_format(cover_data)
        if cover_format is None:
            raise HTTPException(status_code=400, detail="The cover file is not a valid JPG, PNG or WEBP image")

    audio_path = f"{uuid.uuid4()}.mp3"
    cover_path = f"{uuid.uuid4()}.{cover_format[0]}" if cover_format else None
    uploaded_paths: list[str] = []

    try:
        storage = supabase.storage.from_(settings.supabase_bucket)
        storage.upload(
            audio_path,
            file_data,
            {"content-type": "audio/mpeg", "upsert": False},
        )
        uploaded_paths.append(audio_path)

        if cover_data is not None and cover_format is not None and cover_path:
            storage.upload(
                cover_path,
                cover_data,
                {"content-type": cover_format[1], "upsert": False},
            )
            uploaded_paths.append(cover_path)

        song = Song(
            title=title.strip(),
            artist=artist.strip(),
            album=(album or "").strip() or None,
            genre=(genre or "").strip() or None,
            file_path=audio_path,
            cover_path=cover_path,
            uploaded_by=_user_id(current_user),
        )
        if not song.title or not song.artist:
            raise HTTPException(status_code=422, detail="Song title and artist are required")

        db.add(song)
        await db.commit()
        await db.refresh(song)
    except HTTPException:
        await db.rollback()
        _remove_storage_objects(uploaded_paths)
        raise
    except Exception as exc:
        await db.rollback()
        _remove_storage_objects(uploaded_paths)
        raise HTTPException(
            status_code=500,
            detail="CloudTune could not complete the upload. Please retry.",
        ) from exc

    return {
        "status": "success",
        "message": "Song uploaded to cloud successfully",
        "song_id": song.id,
        "title": song.title,
        "artist": song.artist,
        "file_path": song.file_path,
        "cover_path": song.cover_path,
        "uploaded_by": song.uploaded_by,
    }


@router.get("/")
async def get_songs(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Song)
        .where(Song.uploaded_by == _user_id(current_user))
        .order_by(Song.id)
    )
    song_list = []

    for song in result.scalars().all():
        song_data = {
            "id": song.id,
            "title": song.title,
            "artist": song.artist,
            "album": song.album,
            "genre": song.genre,
            "file_path": song.file_path,
            "cover_path": song.cover_path,
            "uploaded_by": song.uploaded_by,
            "cover_url": None,
        }
        if song.cover_path:
            try:
                signed_cover = supabase.storage.from_(
                    settings.supabase_bucket
                ).create_signed_url(song.cover_path, 3600)
                song_data["cover_url"] = signed_cover["signedURL"]
            except Exception:
                # A missing cover should not prevent the rest of the library loading.
                song_data["cover_url"] = None
        song_list.append(song_data)

    return song_list


@router.get("/{song_id}")
async def get_song(
    song_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Song).where(
            Song.id == song_id,
            Song.uploaded_by == _user_id(current_user),
        )
    )
    song = result.scalar_one_or_none()
    if song is None:
        raise HTTPException(status_code=404, detail="Song not found in your library")
    return song


@router.get("/{song_id}/stream")
async def get_stream_url(
    song_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Song).where(
            Song.id == song_id,
            Song.uploaded_by == _user_id(current_user),
        )
    )
    song = result.scalar_one_or_none()
    if song is None:
        raise HTTPException(status_code=404, detail="Song not found in your library")

    try:
        signed_url = supabase.storage.from_(
            settings.supabase_bucket
        ).create_signed_url(song.file_path, 3600)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Could not create a streaming URL. Please retry.",
        ) from exc

    return {
        "status": "success",
        "song_id": song.id,
        "title": song.title,
        "artist": song.artist,
        "stream_url": signed_url["signedURL"],
    }
