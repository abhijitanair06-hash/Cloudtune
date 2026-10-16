import asyncio
import os
import re
import tempfile
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.jwt import get_current_user
from app.db.database import get_db
from app.models.library import UserPlaylist
from app.models.listener import ListenerLikedTrack, ListenerPlaylistTrack
from app.models.song import Song


router = APIRouter(prefix="/api/listener", tags=["Listener"])


class ListenerTrackInput(BaseModel):
    track_key: str = Field(min_length=3, max_length=512)
    source: Literal["shazamio", "unison", "catalogue"]
    title: str = Field(min_length=1, max_length=255)
    artist: str = Field(min_length=1, max_length=255)
    album: str | None = Field(default=None, max_length=255)
    artwork_url: str | None = Field(default=None, max_length=2000)
    track_url: str | None = Field(default=None, max_length=2000)
    preview_url: str | None = Field(default=None, max_length=2000)


class LyricsSearchInput(BaseModel):
    query: str = Field(min_length=3, max_length=500)


def _user_id(current_user: dict) -> int:
    return int(current_user["user_id"])


def _safe_url(value: str | None) -> str | None:
    candidate = (value or "").strip()
    if candidate.startswith(("https://", "http://")):
        return candidate[:2000]
    return None


def _track_payload(track: ListenerLikedTrack) -> dict:
    return {
        "id": int(track.id),
        "track_key": track.track_key,
        "source": track.source,
        "title": track.title,
        "artist": track.artist,
        "album": track.album,
        "artwork_url": track.artwork_url,
        "track_url": track.track_url,
        "preview_url": track.preview_url,
        "created_at": track.created_at.isoformat() if track.created_at else None,
    }


def _canonical(value: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (value or "").casefold()).strip()


async def _catalogue_song_id(db: AsyncSession, title: str, artist: str) -> int | None:
    result = await db.execute(select(Song))
    target_title = _canonical(title)
    target_artist = _canonical(artist)
    for song in result.scalars().all():
        if _canonical(song.title) == target_title and _canonical(song.artist) == target_artist:
            return int(song.id)
    return None


def _normalise_shazam_result(payload: dict) -> dict | None:
    """Convert ShazamIO's public response into Listener's stable track shape."""
    track = payload.get("track") if isinstance(payload.get("track"), dict) else {}
    title = str(track.get("title") or "").strip()
    artist = str(track.get("subtitle") or track.get("artist") or "").strip()
    if not title or not artist:
        return None

    album = None
    for section in track.get("sections") or []:
        if not isinstance(section, dict):
            continue
        for item in section.get("metadata") or []:
            if isinstance(item, dict) and str(item.get("title") or "").casefold() == "album":
                album = str(item.get("text") or "").strip() or None
                break
        if album:
            break

    images = track.get("images") if isinstance(track.get("images"), dict) else {}
    artwork = (
        images.get("coverarthq")
        or images.get("coverart")
        or images.get("background")
    )
    share = track.get("share") if isinstance(track.get("share"), dict) else {}
    track_url = track.get("url") or share.get("href")
    hub = track.get("hub") if isinstance(track.get("hub"), dict) else {}
    preview_url = None
    for action in hub.get("actions") or []:
        if isinstance(action, dict):
            candidate = action.get("uri") or action.get("url")
            if candidate and "preview" in str(action.get("name") or "").casefold():
                preview_url = candidate
                break

    external_id = track.get("key") or track.get("id") or f"{title}|{artist}"
    return {
        "track_key": f"shazamio:{external_id}"[:512],
        "source": "shazamio",
        "title": title[:255],
        "artist": artist[:255],
        "album": str(album or "")[:255] or None,
        "artwork_url": _safe_url(artwork),
        "track_url": _safe_url(track_url),
        "preview_url": _safe_url(preview_url),
    }


def _normalise_lyrics_result(item: dict) -> dict | None:
    title = str(item.get("song") or item.get("title") or item.get("track") or "").strip()
    artist_value = item.get("artist") or item.get("artists") or item.get("artistName") or ""
    if isinstance(artist_value, dict):
        artist_value = artist_value.get("name") or ""
    if isinstance(artist_value, list):
        artist_value = ", ".join(
            str(value.get("name") if isinstance(value, dict) else value)
            for value in artist_value
        )
    artist = str(artist_value).strip()
    if not title or not artist:
        return None

    external_id = item.get("id") or item.get("videoId") or f"{title}|{artist}"
    track_url = item.get("url") or item.get("track_url")
    video_id = item.get("videoId") or item.get("video_id")
    if not track_url and video_id:
        track_url = f"https://www.youtube.com/watch?v={video_id}"

    album_value = item.get("album")
    if isinstance(album_value, dict):
        album_value = album_value.get("name") or album_value.get("title")
    artwork = item.get("artwork_url") or item.get("thumbnail") or item.get("cover")
    if isinstance(artwork, dict):
        artwork = artwork.get("url")
    return {
        "track_key": f"unison:{external_id}"[:512],
        "source": "unison",
        "title": title[:255],
        "artist": artist[:255],
        "album": str(album_value or "")[:255] or None,
        "artwork_url": _safe_url(artwork),
        "track_url": _safe_url(track_url),
        "preview_url": None,
    }


@router.post("/recognize")
async def recognize_song(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Identify nearby music with ShazamIO; no per-user API token is required."""
    audio = await file.read()
    if not audio:
        raise HTTPException(status_code=400, detail="No audio was recorded.")
    if len(audio) > 12 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Audio sample is too large. Record a shorter sample.")

    # ShazamIO accepts an audio path. The microphone UI sends a WAV sample;
    # delete this temporary copy whether recognition succeeds or fails.
    temp_path = None
    try:
        from shazamio import Shazam

        with tempfile.NamedTemporaryFile(prefix="cloudtune-listener-", suffix=".wav", delete=False) as temp:
            temp.write(audio)
            temp_path = temp.name

        async with Shazam() as shazam:
            payload = await asyncio.wait_for(shazam.recognize(temp_path), timeout=30.0)
    except asyncio.TimeoutError as exc:
        raise HTTPException(
            status_code=504,
            detail="Music recognition timed out. Try another clear 8–12 second sample.",
        ) from exc
    except ImportError as exc:
        raise HTTPException(
            status_code=503,
            detail="Listener's free recognition library isn't installed yet. Run pip install -r requirements.txt in backend.",
        ) from exc
    except Exception as exc:
        # Upstream recognition is an unofficial integration and can be unavailable.
        raise HTTPException(
            status_code=502,
            detail="Shazam recognition is temporarily unavailable. Try again in a little while.",
        ) from exc
    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass

    if not isinstance(payload, dict):
        return {
            "matched": False,
            "message": "No confident match found. Try 8–12 seconds with less background noise.",
        }

    track = _normalise_shazam_result(payload)
    if not track:
        return {
            "matched": False,
            "message": "No confident match found. Try a clearer 8–12 second sample.",
        }

    track["catalogue_song_id"] = await _catalogue_song_id(db, track["title"], track["artist"])
    return {
        "matched": True,
        "track": track,
        "message": "Song identified. Adding it to Liked Songs…",
    }


@router.post("/lyrics/search")
async def search_by_spoken_lyrics(
    payload: LyricsSearchInput,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Search lyric text via Unison; browser speech recognition does transcription."""
    query = " ".join(payload.query.split()).strip()
    if len(query) < 3:
        raise HTTPException(status_code=422, detail="Speak or enter at least a few words of lyrics.")

    try:
        async with httpx.AsyncClient(
            timeout=18.0,
            headers={"User-Agent": "CloudTune Listener/1.0 (personal music discovery)"},
        ) as client:
            response = await client.get(
                "https://unison.boidu.dev/lyrics/search",
                params={"q": query[:500]},
            )
            response.raise_for_status()
            payload_data = response.json()
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="Lyrics search timed out. Try again.") from exc
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(
            status_code=502,
            detail="The free lyrics search service is temporarily unavailable. Try again later.",
        ) from exc

    raw = payload_data.get("data")
    if raw is None:
        raw = payload_data.get("results")
    if raw is None:
        raw = payload_data.get("matches")
    if isinstance(raw, dict):
        raw = raw.get("results") or raw.get("tracks") or raw.get("items") or []
    if not isinstance(raw, list):
        raw = []

    tracks = []
    seen = set()
    for item in raw:
        if not isinstance(item, dict):
            continue
        track = _normalise_lyrics_result(item)
        if not track:
            continue
        key = _canonical(track["title"] + " " + track["artist"])
        if key in seen:
            continue
        seen.add(key)
        track["catalogue_song_id"] = await _catalogue_song_id(db, track["title"], track["artist"])
        tracks.append(track)
        if len(tracks) >= 8:
            break

    return {
        "query": query,
        "matches": tracks,
        "message": "Choose the correct result; Listener will save it to Liked Songs before asking about a playlist."
        if tracks else "No lyric matches found. Try a longer, clearer lyric phrase.",
    }


@router.get("/liked")
async def list_listener_likes(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ListenerLikedTrack)
        .where(ListenerLikedTrack.user_id == _user_id(current_user))
        .order_by(ListenerLikedTrack.created_at.desc(), ListenerLikedTrack.id.desc())
    )
    return {"tracks": [_track_payload(track) for track in result.scalars().all()]}


@router.post("/liked")
async def save_listener_like(
    payload: ListenerTrackInput,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user_id = _user_id(current_user)
    result = await db.execute(
        select(ListenerLikedTrack).where(
            ListenerLikedTrack.user_id == user_id,
            ListenerLikedTrack.track_key == payload.track_key,
        )
    )
    track = result.scalar_one_or_none()
    values = {
        "source": payload.source,
        "title": payload.title.strip(),
        "artist": payload.artist.strip(),
        "album": (payload.album or "").strip()[:255] or None,
        "artwork_url": _safe_url(payload.artwork_url),
        "track_url": _safe_url(payload.track_url),
        "preview_url": _safe_url(payload.preview_url),
    }
    if track is None:
        track = ListenerLikedTrack(
            user_id=user_id,
            track_key=payload.track_key.strip(),
            **values,
        )
        db.add(track)
    else:
        for name, value in values.items():
            setattr(track, name, value)
    await db.commit()
    await db.refresh(track)
    return {"status": "success", "track": _track_payload(track), "already_liked": False}


@router.delete("/liked/{track_id}")
async def remove_listener_like(
    track_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user_id = _user_id(current_user)
    result = await db.execute(
        select(ListenerLikedTrack).where(
            ListenerLikedTrack.id == track_id,
            ListenerLikedTrack.user_id == user_id,
        )
    )
    track = result.scalar_one_or_none()
    if track is None:
        raise HTTPException(status_code=404, detail="Listener track not found.")
    await db.delete(track)
    await db.commit()
    return {"status": "success", "deleted_track_id": track_id}


@router.post("/playlists/{playlist_id}/tracks/{track_id}")
async def add_listener_track_to_playlist(
    playlist_id: int,
    track_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user_id = _user_id(current_user)
    playlist_result = await db.execute(
        select(UserPlaylist).where(
            UserPlaylist.id == playlist_id,
            UserPlaylist.user_id == user_id,
        )
    )
    playlist = playlist_result.scalar_one_or_none()
    if playlist is None:
        raise HTTPException(status_code=404, detail="Playlist not found.")

    track_result = await db.execute(
        select(ListenerLikedTrack).where(
            ListenerLikedTrack.id == track_id,
            ListenerLikedTrack.user_id == user_id,
        )
    )
    track = track_result.scalar_one_or_none()
    if track is None:
        raise HTTPException(status_code=404, detail="Listener track not found in your Liked Songs.")

    existing_result = await db.execute(
        select(ListenerPlaylistTrack).where(
            ListenerPlaylistTrack.playlist_id == playlist.id,
            ListenerPlaylistTrack.listener_track_id == track.id,
        )
    )
    if existing_result.scalar_one_or_none() is None:
        max_result = await db.execute(
            select(func.max(ListenerPlaylistTrack.position)).where(
                ListenerPlaylistTrack.playlist_id == playlist.id
            )
        )
        highest = max_result.scalar()
        db.add(ListenerPlaylistTrack(
            playlist_id=playlist.id,
            listener_track_id=track.id,
            position=(highest if highest is not None else -1) + 1,
        ))
        await db.commit()
    return {"status": "success", "playlist_id": playlist.id, "track": _track_payload(track)}


@router.delete("/playlists/{playlist_id}/tracks/{track_id}")
async def remove_listener_track_from_playlist(
    playlist_id: int,
    track_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user_id = _user_id(current_user)
    playlist_result = await db.execute(
        select(UserPlaylist).where(
            UserPlaylist.id == playlist_id,
            UserPlaylist.user_id == user_id,
        )
    )
    if playlist_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Playlist not found.")
    result = await db.execute(
        select(ListenerPlaylistTrack)
        .join(
            ListenerLikedTrack,
            ListenerLikedTrack.id == ListenerPlaylistTrack.listener_track_id,
        )
        .where(
            ListenerPlaylistTrack.playlist_id == playlist_id,
            ListenerPlaylistTrack.listener_track_id == track_id,
            ListenerLikedTrack.user_id == user_id,
        )
    )
    link = result.scalar_one_or_none()
    if link is not None:
        await db.delete(link)
        await db.commit()
    return {"status": "success", "playlist_id": playlist_id, "track_id": track_id}


@router.get("/playlists/{playlist_id}/tracks")
async def list_listener_playlist_tracks(
    playlist_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user_id = _user_id(current_user)
    playlist_result = await db.execute(
        select(UserPlaylist).where(
            UserPlaylist.id == playlist_id,
            UserPlaylist.user_id == user_id,
        )
    )
    if playlist_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Playlist not found.")
    result = await db.execute(
        select(ListenerLikedTrack)
        .join(
            ListenerPlaylistTrack,
            ListenerPlaylistTrack.listener_track_id == ListenerLikedTrack.id,
        )
        .where(ListenerPlaylistTrack.playlist_id == playlist_id)
        .order_by(ListenerPlaylistTrack.position, ListenerPlaylistTrack.id)
    )
    return {"tracks": [_track_payload(track) for track in result.scalars().all()]}
