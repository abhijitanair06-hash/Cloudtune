import math
import re
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.jwt import get_current_user
from app.db.database import get_db
from app.models.library import Favorite
from app.models.recommendation import ListeningSession
from app.models.song import Song


router = APIRouter(prefix="/api/recommendations", tags=["Personal Recommendations"])


class ListeningStart(BaseModel):
    session_key: str = Field(min_length=16, max_length=64)
    song_id: int = Field(gt=0)


class ListeningProgress(BaseModel):
    listened_seconds: float = Field(ge=0, le=86400)
    last_position_seconds: float = Field(ge=0, le=86400)
    completed: bool = False
    skipped: bool = False


def _user_id(current_user: dict) -> int:
    return int(current_user["user_id"])


def _normalise(value: str | None) -> str:
    value = re.sub(r"\s+", " ", (value or "").strip().lower())
    if not value or value in {
        "unknown", "unknown artist", "various artists", "n/a", "none", "null"
    }:
        return ""
    if value.startswith("recovered track"):
        return ""
    return value


def _safe_weight(stats: dict) -> float:
    plays = max(1, stats["plays"])
    repeats = max(0, plays - 1)
    completion_rate = stats["completed"] / plays
    skip_rate = stats["skipped"] / plays
    average_listen = stats["listened_seconds"] / plays

    # Replays and completed listens count as stronger preference signals.
    score = (
        0.7
        + math.log1p(repeats) * 1.55
        + completion_rate * 1.15
        + min(average_listen / 120.0, 1.0) * 0.45
        - skip_rate * 0.75
    )
    return max(0.15, score)


@router.post("/listening/start")
async def start_listening_session(
    payload: ListeningStart,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Record a play of any song currently available in CloudTune's catalogue."""
    user_id = _user_id(current_user)

    song_result = await db.execute(
        select(Song).where(
            Song.id == payload.song_id,
            Song.uploaded_by == user_id,
        )
    )
    song = song_result.scalar_one_or_none()
    if song is None:
        raise HTTPException(status_code=404, detail="Song not found in the cloud catalogue")

    existing_result = await db.execute(
        select(ListeningSession).where(
            ListeningSession.user_id == user_id,
            ListeningSession.session_key == payload.session_key,
        )
    )
    existing = existing_result.scalar_one_or_none()
    if existing is not None:
        if existing.song_id != payload.song_id:
            raise HTTPException(status_code=409, detail="That listening session is already assigned to another song")
        return {"status": "success", "session_key": payload.session_key, "created": False}

    db.add(ListeningSession(
        session_key=payload.session_key,
        user_id=user_id,
        song_id=payload.song_id,
    ))
    await db.commit()
    return {"status": "success", "session_key": payload.session_key, "created": True}


@router.put("/listening/{session_key}")
async def update_listening_session(
    session_key: str,
    payload: ListeningProgress,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user_id = _user_id(current_user)
    result = await db.execute(
        select(ListeningSession).where(
            ListeningSession.user_id == user_id,
            ListeningSession.session_key == session_key,
        )
    )
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="Listening session not found")

    # The client sends cumulative values. Max/OR updates make retries safe.
    session.listened_seconds = max(
        float(session.listened_seconds or 0),
        float(payload.listened_seconds),
    )
    session.last_position_seconds = float(payload.last_position_seconds)
    session.completed = bool(session.completed or payload.completed)
    session.skipped = bool(session.skipped or payload.skipped)
    await db.commit()
    return {
        "status": "success",
        "listened_seconds": session.listened_seconds,
        "completed": session.completed,
        "skipped": session.skipped,
    }


@router.get("/for-you")
async def get_personal_recommendations(
    limit: int = Query(default=12, ge=1, le=30),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Rank unheard catalogue tracks using replay habits, finish/skip rates,
    genre and artist affinity, favorites, and co-listening across users.
    """
    user_id = _user_id(current_user)

    songs_result = await db.execute(
        select(Song)
        .where(Song.uploaded_by == user_id)
        .order_by(Song.id.desc())
    )
    catalogue = songs_result.scalars().all()

    session_result = await db.execute(
        select(ListeningSession).where(ListeningSession.user_id == user_id)
    )
    sessions = session_result.scalars().all()

    # Aggregate one row per user's track from recorded listening sessions.
    stats_by_user: dict[int, dict[int, dict]] = defaultdict(dict)
    global_plays: dict[int, int] = defaultdict(int)
    global_users: dict[int, dict[int, int]] = defaultdict(lambda: defaultdict(int))

    for item in sessions:
        uid = int(item.user_id)
        sid = int(item.song_id)
        global_plays[sid] += 1
        global_users[uid][sid] += 1

        stats = stats_by_user[uid].setdefault(
            sid,
            {"plays": 0, "completed": 0, "skipped": 0, "listened_seconds": 0.0},
        )
        stats["plays"] += 1
        stats["completed"] += int(bool(item.completed))
        stats["skipped"] += int(bool(item.skipped))
        stats["listened_seconds"] += float(item.listened_seconds or 0)

    user_stats = stats_by_user.get(user_id, {})
    heard_ids = set(user_stats)

    favorites_result = await db.execute(
        select(Favorite.song_id).where(Favorite.user_id == user_id)
    )
    favorite_ids = {int(song_id) for song_id in favorites_result.scalars().all()}

    # Build preference signals from tracks the user actually listens to.
    artist_affinity: dict[str, float] = defaultdict(float)
    genre_affinity: dict[str, float] = defaultdict(float)
    seed_weights: dict[int, float] = {}

    song_by_id = {int(song.id): song for song in catalogue}
    completed_plays = 0
    skipped_plays = 0
    repeat_plays = 0

    for song_id, stats in user_stats.items():
        seed_weights[song_id] = _safe_weight(stats)
        repeat_plays += max(0, stats["plays"] - 1)
        completed_plays += stats["completed"]
        skipped_plays += stats["skipped"]

        song = song_by_id.get(song_id)
        if song is None:
            continue
        weight = seed_weights[song_id]
        artist = _normalise(song.artist)
        genre = _normalise(song.genre)
        if artist:
            artist_affinity[artist] += weight
        if genre:
            genre_affinity[genre] += weight

    # Favorites are a positive signal, even when their replay history is small.
    for song_id in favorite_ids:
        song = song_by_id.get(song_id)
        if song is None:
            continue
        artist = _normalise(song.artist)
        genre = _normalise(song.genre)
        if artist:
            artist_affinity[artist] += 1.5
        if genre:
            genre_affinity[genre] += 1.5

    max_artist = max(artist_affinity.values(), default=0.0)
    max_genre = max(genre_affinity.values(), default=0.0)
    max_global = max((math.log1p(value) for value in global_plays.values()), default=0.0)

    # A user who repeatedly plays track X gets a stronger collaborative signal
    # from other CloudTune listeners who also play X and then play candidate Y.
    collaborative_raw: dict[int, float] = defaultdict(float)
    for other_user_id, other_tracks in global_users.items():
        if other_user_id == user_id:
            continue
        shared_affinity = sum(
            seed_weight * math.log1p(other_tracks.get(seed_song_id, 0))
            for seed_song_id, seed_weight in seed_weights.items()
        )
        if shared_affinity <= 0:
            continue
        for candidate_id, candidate_plays in other_tracks.items():
            if candidate_id not in heard_ids and candidate_id not in favorite_ids:
                collaborative_raw[candidate_id] += shared_affinity * math.log1p(candidate_plays)

    max_collaborative = max(collaborative_raw.values(), default=0.0)

    heard_or_saved = heard_ids | favorite_ids
    unheard = [
        song for song in catalogue
        if int(song.id) not in heard_or_saved
    ]

    ranked = []
    for song in unheard:
        song_id = int(song.id)
        artist = _normalise(song.artist)
        genre = _normalise(song.genre)
        artist_score = (artist_affinity.get(artist, 0.0) / max_artist) if artist and max_artist else 0.0
        genre_score = (genre_affinity.get(genre, 0.0) / max_genre) if genre and max_genre else 0.0
        collaborative_score = (
            collaborative_raw.get(song_id, 0.0) / max_collaborative
            if max_collaborative else 0.0
        )
        global_score = (
            math.log1p(global_plays.get(song_id, 0)) / max_global
            if max_global else 0.0
        )

        score = (
            artist_score * 0.28
            + genre_score * 0.24
            + collaborative_score * 0.32
            + global_score * 0.16
        )
        contributors = [
            (artist_score * 0.28, "artist"),
            (genre_score * 0.24, "genre"),
            (collaborative_score * 0.32, "collaborative"),
            (global_score * 0.16, "popular"),
        ]
        strongest = max(contributors)[1]
        if strongest == "collaborative" and collaborative_score > 0:
            reason = "Listeners with overlap in the tracks you replay also listen to this."
        elif strongest == "artist" and artist_score > 0:
            reason = "Same artist as a track you come back to."
        elif strongest == "genre" and genre_score > 0:
            reason = "Matches a genre you tend to listen to."
        elif strongest == "popular" and global_plays.get(song_id, 0) > 0:
            reason = "Popular with listeners across the CloudTune catalogue."
        else:
            reason = "An unheard track from your cloud catalogue."

        ranked.append({
            "id": song_id,
            "title": song.title,
            "artist": song.artist,
            "album": song.album,
            "genre": song.genre,
            "score": round(score, 4),
            "reason": reason,
            "cloud_play_count": global_plays.get(song_id, 0),
            "artist_match": round(artist_score, 3),
            "genre_match": round(genre_score, 3),
            "collaborative_match": round(collaborative_score, 3),
        })

    ranked.sort(key=lambda item: (item["score"], item["cloud_play_count"], item["id"]), reverse=True)
    recommendations = ranked[:limit]

    total_plays = sum(stats["plays"] for stats in user_stats.values())
    stats_summary = {
        "catalogue_tracks": len(catalogue),
        "heard_tracks": len(heard_ids),
        "unheard_available": len(unheard),
        "plays_recorded": total_plays,
        "repeat_plays": repeat_plays,
        "completed_plays": completed_plays,
        "skipped_plays": skipped_plays,
        "tracks_replayed": sum(1 for stats in user_stats.values() if stats["plays"] > 1),
    }

    if not catalogue:
        message = "The cloud catalogue is empty. Add tracks to CloudTune to start discovering music."
    elif not recommendations:
        message = "You've heard every track currently available in the cloud catalogue. Add more tracks to discover new music."
    elif not user_stats:
        message = "Your discovery feed is ready. Play songs in CloudTune and your future recommendations will learn from replays, finishes, skips and favorites."
    else:
        message = "Ranked from your replay habits, listening time, completions, skips, favorites and signals from other CloudTune listeners."

    return {
        "recommendations": recommendations,
        "stats": stats_summary,
        "message": message,
    }
