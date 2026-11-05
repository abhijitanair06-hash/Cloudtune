from datetime import datetime, timedelta, timezone
import math

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.jwt import get_current_user
from app.db.database import get_db
from app.models.playback_state import PlaybackState
from app.models.song import Song


router = APIRouter(prefix="/api/playback", tags=["Playback Sync"])

# A crashed or closed browser stops renewing its lease. A new device may then
# take over automatically; an active device requires an explicit handoff.
PLAYBACK_LEASE_SECONDS = 45
MAX_TRACK_SECONDS = 7 * 24 * 60 * 60


class DeviceFields(BaseModel):
    device_id: str = Field(
        min_length=12,
        max_length=64,
        pattern=r"^[A-Za-z0-9_-]+$",
    )
    device_name: str = Field(
        default="CloudTune device",
        min_length=1,
        max_length=100,
    )

    @field_validator("device_name")
    @classmethod
    def clean_device_name(cls, value: str) -> str:
        cleaned = " ".join(value.split())[:100]
        return cleaned or "CloudTune device"


class PlaybackHeartbeat(DeviceFields):
    song_id: int = Field(gt=0)
    position_seconds: float = Field(default=0, ge=0, le=MAX_TRACK_SECONDS)
    duration_seconds: float | None = Field(
        default=None,
        ge=0,
        le=MAX_TRACK_SECONDS,
    )
    is_playing: bool = False

    @field_validator("position_seconds", "duration_seconds")
    @classmethod
    def require_finite_time(cls, value):
        if value is not None and not math.isfinite(value):
            raise ValueError("Playback time must be a finite number")
        return value


class PlaybackClaim(DeviceFields):
    expected_version: int = Field(ge=1)


def _user_id(current_user: dict) -> int:
    return int(current_user["user_id"])


def _utc(value: datetime) -> datetime:
    # Some older PostgreSQL/SQLite test fixtures may return a naive timestamp.
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def _state_is_stale(state: PlaybackState, now: datetime | None = None) -> bool:
    updated_at = getattr(state, "updated_at", None)
    if updated_at is None:
        return True
    current_time = now or datetime.now(timezone.utc)
    return current_time - _utc(updated_at) > timedelta(seconds=PLAYBACK_LEASE_SECONDS)


async def _owned_song(
    db: AsyncSession,
    song_id: int,
    user_id: int,
) -> Song | None:
    result = await db.execute(
        select(Song).where(
            Song.id == song_id,
            Song.uploaded_by == user_id,
            Song.is_deleted.is_(False),
        )
    )
    return result.scalar_one_or_none()


def _state_payload(state: PlaybackState, song: Song) -> dict:
    updated_at = getattr(state, "updated_at", None)
    return {
        "device_id": state.device_id,
        "device_name": state.device_name,
        "version": state.version,
        "song": {
            "id": song.id,
            "title": song.title,
            "artist": song.artist,
        },
        "position_seconds": max(0.0, float(state.position_seconds or 0)),
        "duration_seconds": (
            float(state.duration_seconds)
            if state.duration_seconds is not None
            else None
        ),
        "is_playing": bool(state.is_playing),
        "updated_at": updated_at.isoformat() if updated_at else None,
    }


@router.get("/state")
async def get_playback_state(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return the account's latest position without returning a stream URL."""
    result = await db.execute(
        select(PlaybackState).where(
            PlaybackState.user_id == _user_id(current_user)
        )
    )
    state = result.scalar_one_or_none()
    if state is None or state.song_id is None:
        return None

    song = await _owned_song(db, state.song_id, _user_id(current_user))
    if song is None:
        return None
    return _state_payload(state, song)


@router.put("/state")
async def save_playback_state(
    payload: PlaybackHeartbeat,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Renew this device's playback lease and save its current position."""
    user_id = _user_id(current_user)
    song = await _owned_song(db, payload.song_id, user_id)
    if song is None:
        raise HTTPException(status_code=404, detail="Song not found in your library")

    result = await db.execute(
        select(PlaybackState)
        .where(PlaybackState.user_id == user_id)
        .with_for_update()
    )
    state = result.scalar_one_or_none()
    now = datetime.now(timezone.utc)

    if (
        state is not None
        and state.device_id != payload.device_id
        and not _state_is_stale(state, now)
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "playback_owned_by_another_device",
                "message": "Playback is active on another device. Continue here to hand it off.",
                "device_name": state.device_name,
                "version": state.version,
            },
        )

    if state is None:
        state = PlaybackState(
            user_id=user_id,
            device_id=payload.device_id,
            device_name=payload.device_name,
            song_id=payload.song_id,
            position_seconds=payload.position_seconds,
            duration_seconds=payload.duration_seconds,
            is_playing=payload.is_playing,
            version=1,
            updated_at=now,
        )
        db.add(state)
    else:
        if state.device_id != payload.device_id or state.song_id != payload.song_id:
            state.version = int(state.version or 1) + 1
        state.device_id = payload.device_id
        state.device_name = payload.device_name
        state.song_id = payload.song_id
        state.position_seconds = payload.position_seconds
        state.duration_seconds = payload.duration_seconds
        state.is_playing = payload.is_playing
        state.updated_at = now

    try:
        await db.commit()
        await db.refresh(state)
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Playback state changed on another device. Refresh and try again.",
        )

    return _state_payload(state, song)


@router.post("/state/claim")
async def claim_playback_state(
    payload: PlaybackClaim,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Atomically transfer the playback lease to this device."""
    user_id = _user_id(current_user)
    result = await db.execute(
        select(PlaybackState)
        .where(PlaybackState.user_id == user_id)
        .with_for_update()
    )
    state = result.scalar_one_or_none()

    if state is None or int(state.version or 0) != payload.expected_version:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Playback changed on the other device. Refresh the handoff prompt.",
        )

    song = await _owned_song(db, state.song_id, user_id) if state.song_id else None
    if song is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The saved track is no longer available in your library.",
        )

    state.device_id = payload.device_id
    state.device_name = payload.device_name
    state.is_playing = False
    state.version = int(state.version or 1) + 1
    state.updated_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(state)
    return _state_payload(state, song)
