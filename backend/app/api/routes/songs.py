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
    settings.supabase_key.get_secret_value()
)


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

    # --------------------------------------------------------
    # CHECK SONG FILE
    # --------------------------------------------------------

    original_filename = file.filename or ""

    if not original_filename.lower().endswith(".mp3"):
        raise HTTPException(
            status_code=400,
            detail="Only .mp3 files are allowed"
        )

    if file.content_type not in (
        "audio/mpeg",
        "audio/mp3",
        "application/octet-stream",
    ):
        raise HTTPException(
            status_code=400,
            detail="Only MP3 files are allowed"
        )


    # --------------------------------------------------------
    # SONG FILE NAME
    # --------------------------------------------------------

    filename = f"{uuid.uuid4()}.mp3"

    storage_path = filename


    # --------------------------------------------------------
    # READ SONG
    # --------------------------------------------------------

    file_data = await file.read()


    # --------------------------------------------------------
    # UPLOAD SONG
    # --------------------------------------------------------

    try:

        supabase.storage.from_(
            settings.supabase_bucket
        ).upload(
            storage_path,
            file_data,
            {
                "content-type": "audio/mpeg",
                "upsert": False,
            }
        )

    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=f"Cloud storage upload failed: {str(e)}"
        )


    # --------------------------------------------------------
    # UPLOAD COVER
    # --------------------------------------------------------

    cover_path = None

    if cover is not None:

        cover_filename = cover.filename or ""

        if not cover_filename.lower().endswith(
            (".jpg", ".jpeg", ".png", ".webp")
        ):
            raise HTTPException(
                status_code=400,
                detail="Cover must be JPG, JPEG, PNG or WEBP"
            )

        cover_extension = (
            cover_filename.rsplit(".", 1)[-1].lower()
        )

        cover_path = (
            f"{uuid.uuid4()}.{cover_extension}"
        )

        cover_data = await cover.read()

        try:

            supabase.storage.from_(
                settings.supabase_bucket
            ).upload(
                cover_path,
                cover_data,
                {
                    "content-type":
                        cover.content_type
                        or "image/jpeg",

                    "upsert": False,
                }
            )

        except Exception as e:

            raise HTTPException(
                status_code=500,
                detail=f"Cover upload failed: {str(e)}"
            )


    # --------------------------------------------------------
    # SAVE DATABASE RECORD
    # --------------------------------------------------------

    song = Song(
        title=title,
        artist=artist,
        album=album,
        genre=genre,
        file_path=storage_path,
        cover_path=cover_path,
        uploaded_by=current_user["user_id"],
    )

    db.add(song)

    await db.commit()
    await db.refresh(song)


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


# ============================================================
# CREATE SONG
# ============================================================

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
        select(Song).order_by(Song.id)
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
        select(Song).where(Song.id == song_id)
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