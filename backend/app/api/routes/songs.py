import hashlib
import logging
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
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from supabase import create_client, Client
from starlette.concurrency import run_in_threadpool

from app.db.database import get_db
from app.models.song import Song
from app.core.jwt import get_current_user
from app.core.config import settings


router = APIRouter(
    prefix="/api/songs",
    tags=["Songs"]
)


# ============================================================
# SUPABASE
# ============================================================

supabase: Client = create_client(
    settings.supabase_url,
    settings.supabase_key
)


logger = logging.getLogger(__name__)


async def _measure_user_storage(
    user_id: int,
    db: AsyncSession,
    *,
    strict: bool = False,
) -> dict:
    result = await db.execute(
        select(Song).where(Song.uploaded_by == user_id)
    )
    songs = result.scalars().all()
    used_bytes = 0
    legacy_paths = set()

    for song in songs:
        audio_size = int(song.file_size_bytes or 0)
        cover_size = int(song.cover_size_bytes or 0)
        used_bytes += audio_size + cover_size
        if audio_size == 0 and song.file_path:
            legacy_paths.add(song.file_path)
        if cover_size == 0 and song.cover_path:
            legacy_paths.add(song.cover_path)

    discovered_sizes = {}
    listing_error = None
    if legacy_paths:
        bucket = supabase.storage.from_(settings.supabase_bucket)
        offset = 0
        try:
            # Current uploads live in the bucket root. Page through objects only
            # when older records lack size metadata, avoiding network work on the
            # common path once all records were uploaded by the new code.
            while offset < 100_000 and len(discovered_sizes) < len(legacy_paths):
                page = await run_in_threadpool(
                    bucket.list,
                    "",
                    {"limit": 1000, "offset": offset},
                )
                if not page:
                    break
                for item in page:
                    name = item.get("name")
                    if name not in legacy_paths:
                        continue
                    metadata = item.get("metadata") or {}
                    size = metadata.get("size", item.get("size"))
                    if size is not None:
                        try:
                            discovered_sizes[name] = max(0, int(size))
                        except (TypeError, ValueError):
                            continue
                offset += len(page)
                if len(page) < 1000:
                    break
        except Exception as exc:
            listing_error = exc
            logger.warning("Could not inspect legacy storage sizes: %s", exc)

    if listing_error is not None and strict:
        raise HTTPException(
            status_code=503,
            detail="Could not verify legacy storage usage safely; try the upload again",
        ) from listing_error

    used_bytes += sum(discovered_sizes.values())
    unresolved_legacy_files = len(legacy_paths - discovered_sizes.keys())
    if strict and unresolved_legacy_files:
        raise HTTPException(
            status_code=503,
            detail="Could not verify the size of every existing storage object; "
                   "resolve legacy storage entries before uploading more files",
        )
    return {
        "used_bytes": used_bytes,
        "song_count": len(songs),
        "unresolved_legacy_files": unresolved_legacy_files,
        "usage_is_estimate": bool(unresolved_legacy_files or listing_error),
    }




# ============================================================
# UPLOAD SONG
# ============================================================

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
    user_id = current_user["user_id"]
    song_limit = settings.max_song_size_mb * 1024 * 1024
    cover_limit = settings.max_cover_size_mb * 1024 * 1024
    cover_mime_by_extension = {
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "png": "image/png",
        "webp": "image/webp",
    }

    original_filename = file.filename or ""
    if not original_filename.lower().endswith(".mp3"):
        raise HTTPException(status_code=400, detail="Only .mp3 files are allowed")
    if file.content_type not in (
        "audio/mpeg",
        "audio/mp3",
        "application/octet-stream",
        None,
    ):
        raise HTTPException(status_code=400, detail="Only MP3 files are allowed")

    # Read one byte beyond the limit so oversized uploads are detected without
    # loading an unbounded file into process memory.
    file_data = await file.read(song_limit + 1)
    if not file_data:
        raise HTTPException(status_code=400, detail="The uploaded MP3 is empty")
    if len(file_data) > song_limit:
        raise HTTPException(
            status_code=413,
            detail=f"Song exceeds the configured {settings.max_song_size_mb} MB limit",
        )

    # Validate typical MP3 signatures before using external storage.
    probe = file_data[:8192]
    has_mp3_header = probe.startswith(b"ID3") or any(
        probe[i] == 0xFF and (probe[i + 1] & 0xE0) == 0xE0
        for i in range(max(0, len(probe) - 1))
    )
    if not has_mp3_header:
        raise HTTPException(status_code=400, detail="File does not look like valid MP3 audio")

    file_sha256 = hashlib.sha256(file_data).hexdigest()
    duplicate_result = await db.execute(
        select(Song).where(
            Song.uploaded_by == user_id,
            Song.file_sha256 == file_sha256,
        )
    )
    duplicate = duplicate_result.scalar_one_or_none()
    if duplicate is not None:
        return {
            "status": "duplicate",
            "message": "This audio file is already in your library",
            "song_id": duplicate.id,
            "title": duplicate.title,
            "artist": duplicate.artist,
            "file_path": duplicate.file_path,
            "cover_path": duplicate.cover_path,
        }

    cover_data = None
    cover_extension = None
    cover_content_type = None
    if cover is not None:
        cover_filename = cover.filename or ""
        cover_extension = cover_filename.rsplit(".", 1)[-1].lower() if "." in cover_filename else ""
        if cover_extension not in cover_mime_by_extension:
            raise HTTPException(
                status_code=400,
                detail="Cover must be JPG, JPEG, PNG or WEBP",
            )

        cover_data = await cover.read(cover_limit + 1)
        if not cover_data:
            raise HTTPException(status_code=400, detail="Cover image is empty")
        if len(cover_data) > cover_limit:
            raise HTTPException(
                status_code=413,
                detail=f"Cover exceeds the configured {settings.max_cover_size_mb} MB limit",
            )

        # Check magic bytes instead of trusting just the file extension.
        valid_cover = (
            cover_extension in ("jpg", "jpeg") and cover_data.startswith(b"\xff\xd8\xff")
        ) or (
            cover_extension == "png" and cover_data.startswith(b"\x89PNG\r\n\x1a\n")
        ) or (
            cover_extension == "webp"
            and cover_data.startswith(b"RIFF")
            and cover_data[8:12] == b"WEBP"
        )
        if not valid_cover:
            raise HTTPException(
                status_code=400,
                detail="Cover bytes do not match a supported image format",
            )
        cover_content_type = cover_mime_by_extension[cover_extension]

    usage = await _measure_user_storage(user_id, db, strict=True)
    used_bytes = usage["used_bytes"]
    quota_bytes = settings.storage_quota_mb * 1024 * 1024
    incoming_bytes = len(file_data) + (len(cover_data) if cover_data else 0)
    if used_bytes + incoming_bytes > quota_bytes:
        raise HTTPException(
            status_code=507,
            detail={
                "message": "Your CloudTune storage quota would be exceeded",
                "used_bytes": used_bytes,
                "quota_bytes": quota_bytes,
                "incoming_bytes": incoming_bytes,
            },
        )

    storage_path = f"{uuid.uuid4()}.mp3"
    cover_path = f"{uuid.uuid4()}.{cover_extension}" if cover_data else None
    uploaded_paths = []
    bucket = supabase.storage.from_(settings.supabase_bucket)

    try:
        # Track intended paths before each call so cleanup also covers a request
        # that reaches storage but fails before returning a success response.
        uploaded_paths.append(storage_path)
        await run_in_threadpool(
            bucket.upload,
            storage_path,
            file_data,
            {"content-type": "audio/mpeg", "upsert": False},
        )

        if cover_path and cover_data and cover_content_type:
            uploaded_paths.append(cover_path)
            await run_in_threadpool(
                bucket.upload,
                cover_path,
                cover_data,
                {"content-type": cover_content_type, "upsert": False},
            )
    except Exception as exc:
        if uploaded_paths:
            try:
                await run_in_threadpool(bucket.remove, uploaded_paths)
            except Exception:
                logging.getLogger(__name__).exception("Failed to clean up partial storage upload")
        raise HTTPException(
            status_code=502,
            detail="Cloud storage upload failed; any partial upload was cleaned up where possible",
        ) from exc

    song = Song(
        title=title.strip(),
        artist=artist.strip(),
        album=album.strip() if album and album.strip() else None,
        genre=genre.strip() if genre and genre.strip() else None,
        file_path=storage_path,
        cover_path=cover_path,
        uploaded_by=user_id,
        file_sha256=file_sha256,
        file_size_bytes=len(file_data),
        cover_size_bytes=len(cover_data) if cover_data else 0,
    )
    db.add(song)

    try:
        await db.commit()
        await db.refresh(song)
    except IntegrityError:
        await db.rollback()
        if uploaded_paths:
            try:
                await run_in_threadpool(bucket.remove, uploaded_paths)
            except Exception:
                logging.getLogger(__name__).exception("Failed to clean up duplicate storage upload")

        # A simultaneous upload may have won the unique hash index race.
        duplicate_result = await db.execute(
            select(Song).where(
                Song.uploaded_by == user_id,
                Song.file_sha256 == file_sha256,
            )
        )
        duplicate = duplicate_result.scalar_one_or_none()
        if duplicate is not None:
            return {
                "status": "duplicate",
                "message": "This audio file is already in your library",
                "song_id": duplicate.id,
                "title": duplicate.title,
                "artist": duplicate.artist,
                "file_path": duplicate.file_path,
                "cover_path": duplicate.cover_path,
            }
        raise HTTPException(status_code=500, detail="Could not save the song record")
    except Exception as exc:
        await db.rollback()
        if uploaded_paths:
            try:
                await run_in_threadpool(bucket.remove, uploaded_paths)
            except Exception:
                logging.getLogger(__name__).exception("Failed to clean up storage after database error")
        raise HTTPException(
            status_code=500,
            detail="Could not save the song record; uploaded storage was cleaned up where possible",
        ) from exc

    return {
        "status": "success",
        "message": "Song uploaded to cloud successfully",
        "song_id": song.id,
        "title": song.title,
        "artist": song.artist,
        "file_path": song.file_path,
        "cover_path": song.cover_path,
        "file_size_bytes": song.file_size_bytes,
        "cover_size_bytes": song.cover_size_bytes,
        "uploaded_by": song.uploaded_by,
    }


@router.post("/")
async def create_song(
    title: str,
    artist: str,
    album: str | None = None,
    genre: str | None = None,
    file_path: str = "",
    cover_path: str | None = None,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):

    if not file_path:
        raise HTTPException(
            status_code=400,
            detail="File path is required"
        )

    song = Song(
        title=title,
        artist=artist,
        album=album,
        genre=genre,
        file_path=file_path,
        cover_path=cover_path,
        uploaded_by=current_user["user_id"],
    )

    db.add(song)

    await db.commit()
    await db.refresh(song)

    return {
        "status": "success",
        "message": "Song created successfully",
        "song_id": song.id,
        "title": song.title,
        "artist": song.artist,
        "uploaded_by": song.uploaded_by,
    }


# ============================================================
# GET ALL SONGS
# ============================================================

@router.get("/")
async def get_songs(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):

    result = await db.execute(
        select(Song).where(
            Song.uploaded_by == current_user["user_id"]
        ).order_by(Song.id)
    )

    songs = result.scalars().all()

    song_list = []

    for song in songs:

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


        # ----------------------------------------------------
        # CREATE COVER SIGNED URL
        # ----------------------------------------------------

        if song.cover_path:

            try:

                signed_cover = supabase.storage.from_(
                    settings.supabase_bucket
                ).create_signed_url(
                    song.cover_path,
                    3600
                )

                song_data["cover_url"] = (
                    signed_cover["signedURL"]
                )

            except Exception as e:

                print(
                    f"Could not create cover URL: {e}"
                )


        song_list.append(song_data)


    return song_list


@router.get("/storage/usage")
async def get_storage_usage(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    usage = await _measure_user_storage(current_user["user_id"], db)
    quota_bytes = settings.storage_quota_mb * 1024 * 1024
    return {
        **usage,
        "quota_bytes": quota_bytes,
        "quota_mb": settings.storage_quota_mb,
        "used_mb": round(usage["used_bytes"] / (1024 * 1024), 2),
        "usage_percent": round(min(100, usage["used_bytes"] / quota_bytes * 100), 2)
        if quota_bytes > 0 else 0,
    }


# ============================================================
# GET SONG BY ID
# ============================================================

@router.get("/{song_id}")
async def get_song(
    song_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):

    result = await db.execute(
        select(Song).where(
            Song.id == song_id,
            Song.uploaded_by == current_user["user_id"],
        )
    )

    song = result.scalar_one_or_none()

    if song is None:
        raise HTTPException(
            status_code=404,
            detail="Song not found"
        )

    return song


# ============================================================
# GET STREAMING URL
# ============================================================

@router.get("/{song_id}/stream")
async def get_stream_url(
    song_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):

    result = await db.execute(
        select(Song).where(Song.id == song_id)
    )

    song = result.scalar_one_or_none()

    if song is None:
        raise HTTPException(
            status_code=404,
            detail="Song not found"
        )

    try:

        signed_url = supabase.storage.from_(
            settings.supabase_bucket
        ).create_signed_url(
            song.file_path,
            3600
        )

    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=f"Could not create streaming URL: {str(e)}"
        )


    return {
        "status": "success",
        "song_id": song.id,
        "title": song.title,
        "artist": song.artist,
        "stream_url": signed_url["signedURL"]
    }