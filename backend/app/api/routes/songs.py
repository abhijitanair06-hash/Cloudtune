import asyncio
import hashlib
import re
import uuid
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
)
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from mutagen import File as MutagenFile, MutagenError
from mutagen.id3 import ID3, ID3NoHeaderError
from supabase import create_client, Client

from app.core.config import settings
from app.core.jwt import get_current_user
from app.core.limiter import limiter
from app.db.database import get_db
from app.models.song import Song


router = APIRouter(prefix="/api/songs", tags=["Songs"])

MAX_AUDIO_SIZE = 50 * 1024 * 1024
MAX_COVER_SIZE = 5 * 1024 * 1024

supabase: Client = create_client(settings.supabase_url, settings.supabase_key)


class SongUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    artist: str | None = Field(default=None, max_length=255)
    album: str | None = Field(default=None, max_length=255)
    genre: str | None = Field(default=None, max_length=100)
    year: int | None = Field(default=None, ge=1000, le=2200)
    track_number: int | None = Field(default=None, ge=1, le=999)


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


def _first_tag(tags: Any, name: str) -> str | None:
    if not tags:
        return None
    value = tags.get(name)
    if isinstance(value, (list, tuple)):
        value = value[0] if value else None
    if value is None:
        return None
    value = str(value).strip()
    return value or None


def _extract_mp3_metadata(data: bytes) -> dict[str, Any]:
    """Validate an MP3 with Mutagen and extract ID3 details and embedded art."""
    if not _is_mp3(data):
        raise ValueError("The uploaded file does not contain MP3 audio.")

    try:
        audio = MutagenFile(BytesIO(data), easy=True)
    except (MutagenError, OSError, ValueError) as exc:
        raise ValueError("The file header looks like MP3, but the audio could not be decoded.") from exc
    if audio is None or getattr(audio, "info", None) is None:
        raise ValueError("The file header looks like MP3, but the audio could not be decoded.")

    tags = audio.tags
    year_text = _first_tag(tags, "date") or _first_tag(tags, "originaldate")
    year_match = re.search(r"\b(\d{4})\b", year_text or "")
    track_text = _first_tag(tags, "tracknumber") or ""
    track_match = re.match(r"\s*(\d+)", track_text)

    embedded_cover = None
    embedded_cover_format = None
    try:
        id3_tags = ID3(BytesIO(data))
        for picture in id3_tags.getall("APIC"):
            picture_data = getattr(picture, "data", b"")
            detected = _cover_format(picture_data)
            if picture_data and detected:
                embedded_cover = picture_data
                embedded_cover_format = detected
                break
    except (ID3NoHeaderError, MutagenError, OSError, ValueError):
        # Some valid MPEG files have no ID3 header; malformed optional ID3
        # artwork must not turn a bad tag into a server-side 500.
        pass

    return {
        "title": _first_tag(tags, "title"),
        "artist": _first_tag(tags, "artist"),
        "album": _first_tag(tags, "album"),
        "genre": _first_tag(tags, "genre"),
        "year": int(year_match.group(1)) if year_match else None,
        "track_number": int(track_match.group(1)) if track_match else None,
        "duration_seconds": round(float(audio.info.length), 3)
        if getattr(audio.info, "length", None) is not None else None,
        "file_size_bytes": len(data),
        "audio_format": "mp3",
        "sha256": hashlib.sha256(data).hexdigest(),
        "embedded_cover": embedded_cover,
        "embedded_cover_format": embedded_cover_format,
    }


def _song_payload(song: Song, cover_url: str | None = None) -> dict[str, Any]:
    # Do not return private storage object paths; only return a short-lived
    # signed cover URL when it is needed by the current owner's UI.
    return {
        "id": int(song.id),
        "title": song.title,
        "artist": song.artist,
        "album": song.album,
        "genre": song.genre,
        "year": song.year,
        "track_number": song.track_number,
        "duration_seconds": song.duration_seconds,
        "file_size_bytes": song.file_size_bytes,
        "audio_format": song.audio_format,
        "sha256": song.sha256,
        "created_at": song.created_at.isoformat() if song.created_at else None,
        "cover_url": cover_url,
    }


async def _signed_cover_url(cover_path: str | None) -> str | None:
    if not cover_path:
        return None
    try:
        signed = await asyncio.to_thread(
            supabase.storage.from_(settings.supabase_bucket).create_signed_url,
            cover_path,
            3600,
        )
        return signed.get("signedURL") or signed.get("signedUrl")
    except Exception:
        return None


async def _cleanup_storage(paths: list[str]) -> bool:
    clean_paths = [path for path in paths if path]
    if not clean_paths:
        return True
    try:
        await asyncio.to_thread(
            supabase.storage.from_(settings.supabase_bucket).remove,
            clean_paths,
        )
        return True
    except Exception:
        # An orphan-sweeper can clean up failed removals later.
        return False


async def _owned_song(
    db: AsyncSession,
    song_id: int,
    user_id: int,
    *,
    include_deleted: bool = False,
) -> Song:
    statement = select(Song).where(
        Song.id == song_id,
        Song.uploaded_by == user_id,
    )
    if not include_deleted:
        statement = statement.where(Song.is_deleted.is_(False))
    result = await db.execute(statement)
    song = result.scalar_one_or_none()
    if song is None:
        raise HTTPException(status_code=404, detail="Song not found in your library")
    return song


@router.post("/metadata")
@limiter.limit("20/hour")
async def preview_upload_metadata(
    request: Request,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Preview ID3 metadata before the user confirms the upload."""
    filename = (file.filename or "").lower()
    if not filename.endswith(".mp3"):
        raise HTTPException(status_code=400, detail="Only MP3 files are currently supported")
    data = await file.read(MAX_AUDIO_SIZE + 1)
    if len(data) > MAX_AUDIO_SIZE:
        raise HTTPException(status_code=413, detail="MP3 exceeds the 50 MB upload limit")
    try:
        metadata = _extract_mp3_metadata(data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Never send embedded art/audio bytes back through this metadata endpoint.
    metadata.pop("embedded_cover", None)
    metadata.pop("embedded_cover_format", None)
    duplicate_result = await _find_duplicate(
        db=db,
        user_id=_user_id(current_user),
        sha256=metadata["sha256"],
    )
    metadata["duplicate_status"] = duplicate_result
    return metadata


async def _find_duplicate(db: AsyncSession, user_id: int, sha256: str) -> str | None:
    # Upload repeats this check immediately before touching storage.
    result = await db.execute(
        select(Song).where(
            Song.uploaded_by == user_id,
            Song.sha256 == sha256,
        )
    )
    existing = result.scalar_one_or_none()
    if existing is None:
        return None
    return "trash" if existing.is_deleted else "active"


@router.post("/upload")
@limiter.limit("10/hour")
async def upload_song(
    request: Request,
    title: str | None = Form(None),
    artist: str | None = Form(None),
    album: str | None = Form(None),
    genre: str | None = Form(None),
    year: int | None = Form(None),
    track_number: int | None = Form(None),
    file: UploadFile = File(...),
    cover: UploadFile | None = File(None),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    original_filename = (file.filename or "").lower()
    if not original_filename.endswith(".mp3"):
        raise HTTPException(status_code=400, detail="Only .mp3 files are currently supported")

    if file.content_type not in ("audio/mpeg", "audio/mp3", "application/octet-stream", None):
        raise HTTPException(status_code=400, detail="Only MP3 files are currently supported")

    file_data = await file.read(MAX_AUDIO_SIZE + 1)
    if len(file_data) > MAX_AUDIO_SIZE:
        raise HTTPException(status_code=413, detail="MP3 exceeds the 50 MB upload limit")
    try:
        metadata = _extract_mp3_metadata(file_data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    user_id = _user_id(current_user)
    duplicate = await _find_duplicate(db, user_id, metadata["sha256"])
    if duplicate == "active":
        raise HTTPException(
            status_code=409,
            detail="This exact audio file is already in your library.",
        )
    if duplicate == "trash":
        raise HTTPException(
            status_code=409,
            detail="This audio file is already in Trash. Restore it instead of uploading it again.",
        )

    final_title = (title or "").strip() or metadata["title"] or Path(file.filename or "Untitled Track").stem
    final_artist = (artist or "").strip() or metadata["artist"] or "Unknown Artist"
    final_album = (album or "").strip() or metadata["album"]
    final_genre = (genre or "").strip() or metadata["genre"]
    final_year = year if year is not None else metadata["year"]
    final_track_number = track_number if track_number is not None else metadata["track_number"]
    if not final_title.strip() or not final_artist.strip():
        raise HTTPException(status_code=422, detail="Song title and artist are required")

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
    elif metadata.get("embedded_cover") and metadata.get("embedded_cover_format"):
        embedded = metadata["embedded_cover"]
        if len(embedded) <= MAX_COVER_SIZE:
            cover_data = embedded
            cover_format = metadata["embedded_cover_format"]

    audio_path = f"{uuid.uuid4()}.mp3"
    cover_path = f"{uuid.uuid4()}.{cover_format[0]}" if cover_format else None
    uploaded_paths: list[str] = []
    try:
        storage = supabase.storage.from_(settings.supabase_bucket)
        await asyncio.to_thread(
            storage.upload,
            audio_path,
            file_data,
            {"content-type": "audio/mpeg", "upsert": False},
        )
        uploaded_paths.append(audio_path)

        if cover_data is not None and cover_format is not None and cover_path:
            await asyncio.to_thread(
                storage.upload,
                cover_path,
                cover_data,
                {"content-type": cover_format[1], "upsert": False},
            )
            uploaded_paths.append(cover_path)

        song = Song(
            title=final_title[:255],
            artist=final_artist[:255],
            album=(final_album or "")[:255] or None,
            genre=(final_genre or "")[:100] or None,
            year=final_year,
            track_number=final_track_number,
            file_path=audio_path,
            cover_path=cover_path,
            duration_seconds=metadata["duration_seconds"],
            file_size_bytes=len(file_data),
            audio_format="mp3",
            sha256=metadata["sha256"],
            uploaded_by=user_id,
        )
        db.add(song)
        await db.commit()
        await db.refresh(song)
    except Exception as exc:
        await db.rollback()
        cleanup_ok = await _cleanup_storage(uploaded_paths)
        if isinstance(exc, HTTPException):
            raise
        if isinstance(exc, IntegrityError):
            raise HTTPException(
                status_code=409,
                detail="This exact audio file was uploaded concurrently and is already in your library.",
            ) from exc
        detail = "CloudTune could not complete the upload. Please retry."
        if not cleanup_ok:
            detail += " Storage cleanup was incomplete and will need maintenance."
        raise HTTPException(status_code=500, detail=detail) from exc

    return {
        "status": "success",
        "message": "Song uploaded to cloud successfully",
        "song": _song_payload(song, await _signed_cover_url(song.cover_path)),
        "has_embedded_cover": bool(metadata.get("embedded_cover")),
    }


@router.get("/")
async def get_songs(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Song)
        .where(
            Song.uploaded_by == _user_id(current_user),
            Song.is_deleted.is_(False),
        )
        .order_by(Song.id)
    )
    song_list = []
    for song in result.scalars().all():
        song_list.append(_song_payload(song, await _signed_cover_url(song.cover_path)))
    return song_list


@router.get("/trash")
async def get_deleted_songs(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Song)
        .where(
            Song.uploaded_by == _user_id(current_user),
            Song.is_deleted.is_(True),
        )
        .order_by(Song.deleted_at.desc(), Song.id.desc())
    )
    return [_song_payload(song, await _signed_cover_url(song.cover_path)) for song in result.scalars().all()]


@router.post("/{song_id}/restore")
async def restore_song(
    song_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    song = await _owned_song(db, song_id, _user_id(current_user), include_deleted=True)
    if not song.is_deleted:
        return {"status": "success", "message": "Song is already in your library", "song_id": song.id}
    song.is_deleted = False
    song.deleted_at = None
    await db.commit()
    return {"status": "success", "message": "Song restored", "song_id": song.id}


@router.patch("/{song_id}")
async def update_song(
    song_id: int,
    payload: SongUpdate,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    song = await _owned_song(db, song_id, _user_id(current_user))
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status_code=422, detail="Provide at least one field to update")

    for key in ("title", "artist"):
        if key in changes and (changes[key] is None or not str(changes[key]).strip()):
            raise HTTPException(status_code=422, detail=f"{key.title()} cannot be blank")

    for key, value in changes.items():
        if key in {"title", "artist"}:
            setattr(song, key, str(value).strip())
        elif key in {"album", "genre"}:
            setattr(song, key, str(value).strip() or None if value is not None else None)
        else:
            setattr(song, key, value)

    await db.commit()
    await db.refresh(song)
    return {"status": "success", "song": _song_payload(song, await _signed_cover_url(song.cover_path))}


@router.delete("/{song_id}")
async def soft_delete_song(
    song_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    song = await _owned_song(db, song_id, _user_id(current_user))
    song.is_deleted = True
    song.deleted_at = datetime.now(timezone.utc)
    await db.commit()
    return {
        "status": "success",
        "message": "Song moved to Trash. You can restore it later.",
        "song_id": song.id,
    }


@router.delete("/{song_id}/permanent")
async def permanently_delete_song(
    song_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    song = await _owned_song(db, song_id, _user_id(current_user), include_deleted=True)
    if not song.is_deleted:
        raise HTTPException(
            status_code=409,
            detail="Move the song to Trash before permanent deletion.",
        )
    song_id_value = int(song.id)
    paths = [song.file_path, song.cover_path] if song.cover_path else [song.file_path]
    await db.delete(song)
    await db.commit()
    removed = await _cleanup_storage(paths)
    return {
        "status": "success",
        "deleted_song_id": song_id_value,
        "storage_cleanup_complete": removed,
    }


@router.get("/{song_id}")
async def get_song(
    song_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    song = await _owned_song(db, song_id, _user_id(current_user))
    return _song_payload(song, await _signed_cover_url(song.cover_path))


@router.get("/{song_id}/stream")
async def get_stream_url(
    song_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    song = await _owned_song(db, song_id, _user_id(current_user))
    try:
        signed_url = await asyncio.to_thread(
            supabase.storage.from_(settings.supabase_bucket).create_signed_url,
            song.file_path,
            3600,
        )
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
        "stream_url": signed_url.get("signedURL") or signed_url.get("signedUrl"),
    }
