from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.jwt import get_current_user
from app.db.database import get_db
from app.models.library import Favorite, PlaylistTrack, UserPlaylist
from app.models.listener import ListenerLikedTrack, ListenerPlaylistTrack
from app.models.song import Song


router = APIRouter(prefix="/api/library", tags=["Cloud Library"])


class PlaylistCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)


def _current_user_id(current_user: dict) -> int:
    return int(current_user["user_id"])


async def _owned_song(db: AsyncSession, song_id: int, user_id: int) -> Song:
    result = await db.execute(
        select(Song).where(Song.id == song_id, Song.uploaded_by == user_id)
    )
    song = result.scalar_one_or_none()
    if song is None:
        raise HTTPException(status_code=404, detail="Song not found in your library")
    return song


async def _catalogue_song(db: AsyncSession, song_id: int, user_id: int) -> Song:
    result = await db.execute(
        select(Song).where(
            Song.id == song_id,
            Song.uploaded_by == user_id,
        )
    )
    song = result.scalar_one_or_none()
    if song is None:
        raise HTTPException(status_code=404, detail="Song not found in your library")
    return song

async def _owned_playlist(
    db: AsyncSession, playlist_id: int, user_id: int
) -> UserPlaylist:
    result = await db.execute(
        select(UserPlaylist).where(
            UserPlaylist.id == playlist_id,
            UserPlaylist.user_id == user_id,
        )
    )
    playlist = result.scalar_one_or_none()
    if playlist is None:
        raise HTTPException(status_code=404, detail="Playlist not found")
    return playlist


async def _playlist_payload(db: AsyncSession, playlist: UserPlaylist) -> dict:
    result = await db.execute(
        select(PlaylistTrack.song_id)
        .where(PlaylistTrack.playlist_id == playlist.id)
        .order_by(PlaylistTrack.position, PlaylistTrack.id)
    )
    listener_result = await db.execute(
        select(ListenerLikedTrack)
        .join(
            ListenerPlaylistTrack,
            ListenerPlaylistTrack.listener_track_id == ListenerLikedTrack.id,
        )
        .where(ListenerPlaylistTrack.playlist_id == playlist.id)
        .order_by(ListenerPlaylistTrack.position, ListenerPlaylistTrack.id)
    )
    listener_tracks = [
        {
            "id": int(track.id),
            "track_key": track.track_key,
            "source": track.source,
            "title": track.title,
            "artist": track.artist,
            "album": track.album,
            "artwork_url": track.artwork_url,
            "track_url": track.track_url,
            "preview_url": track.preview_url,
        }
        for track in listener_result.scalars().all()
    ]
    return {
        "id": playlist.id,
        "name": playlist.name,
        "song_ids": [int(song_id) for song_id in result.scalars().all()],
        "listener_tracks": listener_tracks,
    }


@router.get("/favorites")
async def list_favorites(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user_id = _current_user_id(current_user)
    result = await db.execute(
        select(Favorite.song_id)
        .where(Favorite.user_id == user_id)
        .order_by(Favorite.created_at, Favorite.id)
    )
    return {"song_ids": [int(song_id) for song_id in result.scalars().all()]}


@router.put("/favorites/{song_id}")
async def add_favorite(
    song_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user_id = _current_user_id(current_user)
    await _catalogue_song(db, song_id, user_id)

    result = await db.execute(
        select(Favorite).where(
            Favorite.user_id == user_id,
            Favorite.song_id == song_id,
        )
    )
    if result.scalar_one_or_none() is None:
        db.add(Favorite(user_id=user_id, song_id=song_id))
        await db.commit()

    return {"status": "success", "song_id": song_id, "favorited": True}


@router.delete("/favorites/{song_id}")
async def remove_favorite(
    song_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user_id = _current_user_id(current_user)
    result = await db.execute(
        select(Favorite).where(
            Favorite.user_id == user_id,
            Favorite.song_id == song_id,
        )
    )
    favorite = result.scalar_one_or_none()
    if favorite is not None:
        await db.delete(favorite)
        await db.commit()

    return {"status": "success", "song_id": song_id, "favorited": False}


@router.get("/playlists")
async def list_playlists(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user_id = _current_user_id(current_user)
    result = await db.execute(
        select(UserPlaylist)
        .where(UserPlaylist.user_id == user_id)
        .order_by(UserPlaylist.created_at, UserPlaylist.id)
    )
    playlists = result.scalars().all()
    return [await _playlist_payload(db, playlist) for playlist in playlists]


@router.post("/playlists")
async def create_playlist(
    payload: PlaylistCreate,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user_id = _current_user_id(current_user)
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Playlist name cannot be blank")

    duplicate = await db.execute(
        select(UserPlaylist).where(
            UserPlaylist.user_id == user_id,
            func.lower(UserPlaylist.name) == name.lower(),
        )
    )
    if duplicate.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="You already have a playlist with that name")

    playlist = UserPlaylist(user_id=user_id, name=name)
    db.add(playlist)
    await db.commit()
    await db.refresh(playlist)
    return await _playlist_payload(db, playlist)


@router.delete("/playlists/{playlist_id}")
async def delete_playlist(
    playlist_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user_id = _current_user_id(current_user)
    playlist = await _owned_playlist(db, playlist_id, user_id)

    tracks_result = await db.execute(
        select(PlaylistTrack).where(PlaylistTrack.playlist_id == playlist.id)
    )
    for track in tracks_result.scalars().all():
        await db.delete(track)
    await db.delete(playlist)
    await db.commit()
    return {"status": "success", "deleted_playlist_id": playlist_id}


@router.put("/playlists/{playlist_id}/tracks/{song_id}")
async def add_playlist_track(
    playlist_id: int,
    song_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user_id = _current_user_id(current_user)
    playlist = await _owned_playlist(db, playlist_id, user_id)
    await _catalogue_song(db, song_id, user_id)

    result = await db.execute(
        select(PlaylistTrack).where(
            PlaylistTrack.playlist_id == playlist.id,
            PlaylistTrack.song_id == song_id,
        )
    )
    if result.scalar_one_or_none() is None:
        max_result = await db.execute(
            select(func.max(PlaylistTrack.position)).where(
                PlaylistTrack.playlist_id == playlist.id
            )
        )
        highest = max_result.scalar()
        db.add(PlaylistTrack(
            playlist_id=playlist.id,
            song_id=song_id,
            position=(highest if highest is not None else -1) + 1,
        ))
        await db.commit()

    return {"status": "success", "playlist_id": playlist.id, "song_id": song_id}


@router.delete("/playlists/{playlist_id}/tracks/{song_id}")
async def remove_playlist_track(
    playlist_id: int,
    song_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user_id = _current_user_id(current_user)
    playlist = await _owned_playlist(db, playlist_id, user_id)
    result = await db.execute(
        select(PlaylistTrack).where(
            PlaylistTrack.playlist_id == playlist.id,
            PlaylistTrack.song_id == song_id,
        )
    )
    track = result.scalar_one_or_none()
    if track is not None:
        await db.delete(track)
        await db.commit()

    return {"status": "success", "playlist_id": playlist.id, "song_id": song_id}
