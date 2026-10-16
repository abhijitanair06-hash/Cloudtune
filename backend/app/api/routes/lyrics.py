import re

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.jwt import get_current_user
from app.db.database import get_db
from app.models.song import Song


router = APIRouter(prefix="/api/lyrics", tags=["Lyrics"])


def _canonical(value: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (value or "").casefold()).strip()


async def _owned_song(
    db: AsyncSession,
    song_id: int,
    user_id: int,
) -> Song:
    result = await db.execute(
        select(Song).where(
            Song.id == song_id,
            Song.uploaded_by == user_id,
            Song.is_deleted.is_(False),
        )
    )
    song = result.scalar_one_or_none()
    if song is None:
        raise HTTPException(status_code=404, detail="Song not found in your library")
    return song


@router.get("/{song_id}")
async def get_song_lyrics(
    song_id: int,
    duration: int | None = Query(default=None, ge=1, le=3600),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Fetch synced/plain lyrics for an owned song from LRCLIB."""
    song = await _owned_song(db, song_id, int(current_user["user_id"]))

    params: dict[str, str | int] = {
        "track_name": song.title,
        "artist_name": song.artist,
    }
    if song.album:
        params["album_name"] = song.album
    if duration:
        params["duration"] = duration

    try:
        async with httpx.AsyncClient(
            timeout=12.0,
            headers={"User-Agent": "CloudTune/0.1 (personal music player; LRCLIB lyrics lookup)"},
        ) as client:
            response = await client.get("https://lrclib.net/api/get", params=params)
            if response.status_code == 404:
                search_params = {
                    "track_name": song.title,
                    "artist_name": song.artist,
                }
                response = await client.get(
                    "https://lrclib.net/api/search",
                    params=search_params,
                )
                response.raise_for_status()
                search_results = response.json()
                if not isinstance(search_results, list):
                    search_results = []

                # Only accept an exact normalized title/artist match; don't
                # silently show another recording's lyrics.
                payload = next(
                    (
                        item for item in search_results
                        if isinstance(item, dict)
                        and _canonical(item.get("trackName") or item.get("name")) == _canonical(song.title)
                        and _canonical(item.get("artistName")) == _canonical(song.artist)
                        and (item.get("syncedLyrics") or item.get("plainLyrics"))
                    ),
                    None,
                )
                if payload is None:
                    raise HTTPException(
                        status_code=404,
                        detail="No lyrics found for this exact song. You can add an .lrc file later.",
                    )
            else:
                response.raise_for_status()
                payload = response.json()
    except HTTPException:
        raise
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="Lyrics lookup timed out. Try again.") from exc
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=502,
            detail="The lyrics provider is temporarily unavailable.",
        ) from exc
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(
            status_code=502,
            detail="The lyrics provider returned an unexpected response.",
        ) from exc

    synced = payload.get("syncedLyrics")
    plain = payload.get("plainLyrics")
    if not synced and not plain:
        raise HTTPException(status_code=404, detail="No lyrics are available for this track.")

    lrclib_id = payload.get("id")
    return {
        "song_id": song.id,
        "title": song.title,
        "artist": song.artist,
        "album": song.album,
        "synced_lyrics": str(synced)[:100_000] if synced else None,
        "plain_lyrics": str(plain)[:100_000] if plain else None,
        "has_synced_lyrics": bool(synced),
        "instrumental": bool(payload.get("instrumental", False)),
        "source": "LRCLIB",
        "source_url": f"https://lrclib.net/api/get/{lrclib_id}" if lrclib_id else "https://lrclib.net/",
    }
