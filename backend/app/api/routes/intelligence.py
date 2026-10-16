import math
import random
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.jwt import get_current_user
from app.db.database import get_db
from app.models.intelligence import AudioProfile, SavedMoment, TasteFeedback
from app.models.song import Song


router = APIRouter(
    prefix="/api/intelligence",
    tags=["Moment Search & Taste Lab"],
)


class AudioProfileInput(BaseModel):
    song_id: int
    summary: list[float] = Field(min_length=8, max_length=8)
    segments: list[dict[str, Any]] = Field(min_length=1, max_length=3000)
    duration_seconds: float = Field(gt=0)


class MomentInput(BaseModel):
    song_id: int
    start_seconds: float = Field(ge=0)
    label: str = Field(min_length=1, max_length=160)
    notes: str | None = Field(default=None, max_length=2000)


class MomentSearchInput(BaseModel):
    song_id: int
    second: float = Field(ge=0)
    limit: int = Field(default=12, ge=1, le=30)


class TasteFeedbackInput(BaseModel):
    song_a_id: int
    song_b_id: int
    choice: str


def _user_id(current_user: dict) -> int:
    return int(current_user["user_id"])


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
        raise HTTPException(
            status_code=404,
            detail="Song not found in your library",
        )
    return song


def _vector(value: Any) -> list[float] | None:
    if not isinstance(value, list) or len(value) != 8:
        return None
    try:
        vector = [float(item) for item in value]
    except (TypeError, ValueError):
        return None
    if not all(math.isfinite(item) for item in vector):
        return None
    return vector


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return max(-1.0, min(1.0, dot / (norm_a * norm_b)))


def _profile_summary(profile: AudioProfile) -> dict[str, Any]:
    v = _vector(profile.summary) or [0.0] * 8
    return {
        "energy": round(v[0], 3),
        "brightness": round(v[2], 3),
        "bass": round(v[3], 3),
        "mids": round(v[4], 3),
        "highs": round(v[5] + v[6], 3),
        "dynamics": round(v[7], 3),
    }


@router.get("/songs")
async def get_intelligence_songs(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return the current user's songs and whether each has been indexed."""
    user_id = _user_id(current_user)
    song_result = await db.execute(
        select(Song)
        .where(Song.uploaded_by == user_id, Song.is_deleted.is_(False))
        .order_by(Song.title, Song.id)
    )
    songs = song_result.scalars().all()

    profile_result = await db.execute(
        select(AudioProfile).where(AudioProfile.user_id == user_id)
    )
    profiles = {row.song_id: row for row in profile_result.scalars().all()}

    return [
        {
            "id": song.id,
            "title": song.title,
            "artist": song.artist,
            "album": song.album,
            "genre": song.genre,
            "indexed": song.id in profiles,
            "summary": (
                _profile_summary(profiles[song.id])
                if song.id in profiles
                else None
            ),
        }
        for song in songs
    ]


@router.post("/profiles")
async def save_audio_profile(
    payload: AudioProfileInput,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Save compact, browser-generated audio features for a user's own song."""
    user_id = _user_id(current_user)
    await _owned_song(db, payload.song_id, user_id)

    summary = _vector(payload.summary)
    if summary is None:
        raise HTTPException(status_code=400, detail="Invalid audio summary")

    clean_segments = []
    for item in payload.segments:
        if not isinstance(item, dict):
            continue
        try:
            second = float(item.get("second"))
        except (TypeError, ValueError):
            continue
        vector = _vector(item.get("vector"))
        if (
            vector is None
            or not math.isfinite(second)
            or second < 0
            or second > payload.duration_seconds
        ):
            continue
        clean_segments.append({
            "second": round(second, 3),
            "vector": vector,
        })

    if not clean_segments:
        raise HTTPException(
            status_code=400,
            detail="No valid audio segments were received",
        )

    result = await db.execute(
        select(AudioProfile).where(
            AudioProfile.user_id == user_id,
            AudioProfile.song_id == payload.song_id,
        )
    )
    profile = result.scalar_one_or_none()
    if profile is None:
        profile = AudioProfile(
            user_id=user_id,
            song_id=payload.song_id,
            summary=summary,
            segments=clean_segments,
        )
        db.add(profile)
    else:
        profile.summary = summary
        profile.segments = clean_segments
        profile.feature_version = "cloudtune-v1"

    await db.commit()
    return {
        "status": "success",
        "song_id": payload.song_id,
        "segments_indexed": len(clean_segments),
        "duration_seconds": round(payload.duration_seconds, 2),
    }


@router.post("/moments/search")
async def search_similar_moments(
    payload: MomentSearchInput,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Find comparable audio windows among the user's indexed tracks."""
    user_id = _user_id(current_user)
    await _owned_song(db, payload.song_id, user_id)

    source_result = await db.execute(
        select(AudioProfile).where(
            AudioProfile.user_id == user_id,
            AudioProfile.song_id == payload.song_id,
        )
    )
    source_profile = source_result.scalar_one_or_none()
    if source_profile is None:
        raise HTTPException(
            status_code=400,
            detail="Index this song first in Moment Search.",
        )

    source_segments = source_profile.segments or []
    if not source_segments:
        raise HTTPException(
            status_code=400,
            detail="This song has no searchable audio segments.",
        )
    source_segment = min(
        source_segments,
        key=lambda item: abs(float(item.get("second", 0)) - payload.second),
    )
    target_vector = _vector(source_segment.get("vector"))
    if target_vector is None:
        raise HTTPException(
            status_code=500,
            detail="The source audio index is invalid.",
        )
    target_second = float(source_segment["second"])

    all_result = await db.execute(
        select(AudioProfile, Song)
        .join(Song, Song.id == AudioProfile.song_id)
        .where(
            AudioProfile.user_id == user_id,
            Song.uploaded_by == user_id,
            Song.is_deleted.is_(False),
        )
    )

    matches = []
    for profile, song in all_result.all():
        for segment in profile.segments or []:
            try:
                second = float(segment.get("second", -1))
            except (TypeError, ValueError):
                continue
            vector = _vector(segment.get("vector"))
            if vector is None or second < 0:
                continue
            if song.id == payload.song_id and abs(second - target_second) < 9:
                continue
            similarity = _cosine(target_vector, vector)
            matches.append({
                "song_id": song.id,
                "title": song.title,
                "artist": song.artist,
                "album": song.album,
                "genre": song.genre,
                "second": round(second, 2),
                "similarity": round(similarity, 4),
            })

    matches.sort(key=lambda item: item["similarity"], reverse=True)
    # Avoid showing many adjacent windows from the same song.
    selected = []
    for candidate in matches:
        too_close = any(
            item["song_id"] == candidate["song_id"]
            and abs(item["second"] - candidate["second"]) < 12
            for item in selected
        )
        if not too_close:
            selected.append(candidate)
        if len(selected) >= payload.limit:
            break

    return {
        "source_song_id": payload.song_id,
        "requested_second": payload.second,
        "matched_second": round(target_second, 2),
        "matches": selected,
        "note": (
            "Similarity is based on lightweight audio features, not a guarantee "
            "that two clips contain the same sound."
        ),
    }


@router.post("/moments")
async def save_moment(
    payload: MomentInput,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user_id = _user_id(current_user)
    await _owned_song(db, payload.song_id, user_id)
    moment = SavedMoment(
        user_id=user_id,
        song_id=payload.song_id,
        start_seconds=payload.start_seconds,
        label=payload.label.strip(),
        notes=(payload.notes.strip() if payload.notes else None),
    )
    if not moment.label:
        raise HTTPException(status_code=400, detail="A moment name is required")
    db.add(moment)
    await db.commit()
    await db.refresh(moment)
    return {
        "id": moment.id,
        "song_id": moment.song_id,
        "start_seconds": moment.start_seconds,
        "label": moment.label,
        "notes": moment.notes,
    }


@router.get("/moments")
async def list_saved_moments(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user_id = _user_id(current_user)
    result = await db.execute(
        select(SavedMoment, Song)
        .join(Song, Song.id == SavedMoment.song_id)
        .where(
            SavedMoment.user_id == user_id,
            Song.uploaded_by == user_id,
            Song.is_deleted.is_(False),
        )
        .order_by(desc(SavedMoment.created_at))
    )
    return [
        {
            "id": moment.id,
            "song_id": song.id,
            "title": song.title,
            "artist": song.artist,
            "second": moment.start_seconds,
            "label": moment.label,
            "notes": moment.notes,
        }
        for moment, song in result.all()
    ]


@router.delete("/moments/{moment_id}")
async def delete_saved_moment(
    moment_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user_id = _user_id(current_user)
    result = await db.execute(
        select(SavedMoment).where(
            SavedMoment.id == moment_id,
            SavedMoment.user_id == user_id,
        )
    )
    moment = result.scalar_one_or_none()
    if moment is None:
        raise HTTPException(status_code=404, detail="Saved moment not found")
    await db.delete(moment)
    await db.commit()
    return {"status": "success"}


@router.get("/taste/pair")
async def get_taste_pair(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Choose two indexed songs for an A/B listening comparison."""
    user_id = _user_id(current_user)
    result = await db.execute(
        select(AudioProfile, Song)
        .join(Song, Song.id == AudioProfile.song_id)
        .where(
            AudioProfile.user_id == user_id,
            Song.uploaded_by == user_id,
            Song.is_deleted.is_(False),
        )
    )
    indexed = list(result.all())
    if len(indexed) < 2:
        raise HTTPException(
            status_code=400,
            detail="Index at least two songs before starting Taste Lab.",
        )

    feedback_result = await db.execute(
        select(TasteFeedback)
        .where(TasteFeedback.user_id == user_id)
        .order_by(desc(TasteFeedback.created_at))
        .limit(100)
    )
    recent_pairs = {
        tuple(sorted((row.song_a_id, row.song_b_id)))
        for row in feedback_result.scalars().all()
    }

    # Sample pairs instead of building every possible combination (O(n²)).
    pairs = []
    attempts = min(400, max(80, len(indexed) * 3))
    for _ in range(attempts):
        first, second = random.sample(indexed, 2)
        pair_key = tuple(sorted((first[1].id, second[1].id)))
        if pair_key not in recent_pairs:
            pairs.append((first, second))
            break

    if not pairs:
        # Reusing a pair is better than failing when all pairs have been tried.
        pairs = [tuple(random.sample(indexed, 2))]

    first, second = pairs[0]
    def card(profile: AudioProfile, song: Song) -> dict[str, Any]:
        return {
            "id": song.id,
            "title": song.title,
            "artist": song.artist,
            "album": song.album,
            "summary": _profile_summary(profile),
        }
    return {"a": card(*first), "b": card(*second)}


@router.post("/taste/feedback")
async def save_taste_feedback(
    payload: TasteFeedbackInput,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if payload.song_a_id == payload.song_b_id:
        raise HTTPException(status_code=400, detail="Choose two different songs")
    if payload.choice not in {"a", "b", "both", "neither"}:
        raise HTTPException(
            status_code=400,
            detail="Choice must be a, b, both or neither",
        )
    user_id = _user_id(current_user)
    await _owned_song(db, payload.song_a_id, user_id)
    await _owned_song(db, payload.song_b_id, user_id)
    db.add(TasteFeedback(
        user_id=user_id,
        song_a_id=payload.song_a_id,
        song_b_id=payload.song_b_id,
        choice=payload.choice,
    ))
    await db.commit()
    return {"status": "success", "choice": payload.choice}


@router.get("/taste/recommendations")
async def get_taste_recommendations(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Make explainable, local-library recommendations from A/B feedback."""
    user_id = _user_id(current_user)
    profile_result = await db.execute(
        select(AudioProfile, Song)
        .join(Song, Song.id == AudioProfile.song_id)
        .where(
            AudioProfile.user_id == user_id,
            Song.uploaded_by == user_id,
        )
    )
    indexed = list(profile_result.all())
    if len(indexed) < 2:
        return {
            "recommendations": [],
            "message": "Index at least two songs to begin learning.",
        }

    feedback_result = await db.execute(
        select(TasteFeedback)
        .where(TasteFeedback.user_id == user_id)
        .order_by(desc(TasteFeedback.created_at))
        .limit(500)
    )
    feedback = feedback_result.scalars().all()
    if not feedback:
        return {
            "recommendations": [],
            "message": "Compare a few pairs in Taste Lab so CloudTune can learn your preferences.",
        }

    profile_by_song = {song.id: profile for profile, song in indexed}
    positive_vectors = []
    negative_vectors = []
    for row in feedback:
        a = _vector(profile_by_song[row.song_a_id].summary) if row.song_a_id in profile_by_song else None
        b = _vector(profile_by_song[row.song_b_id].summary) if row.song_b_id in profile_by_song else None
        if row.choice == "a":
            if a: positive_vectors.append(a)
            if b: negative_vectors.append(b)
        elif row.choice == "b":
            if b: positive_vectors.append(b)
            if a: negative_vectors.append(a)
        elif row.choice == "both":
            if a: positive_vectors.append(a)
            if b: positive_vectors.append(b)
        elif row.choice == "neither":
            if a: negative_vectors.append(a)
            if b: negative_vectors.append(b)

    if not positive_vectors:
        return {
            "recommendations": [],
            "message": "Choose a preferred song in at least one comparison to generate recommendations.",
        }

    positive_scores = []
    for vector in positive_vectors:
        positive_scores.append(vector)
    def average(vectors: list[list[float]]) -> list[float]:
        return [
            sum(vector[i] for vector in vectors) / len(vectors)
            for i in range(8)
        ]
    target = average(positive_scores)
    disliked = average(negative_vectors) if negative_vectors else None

    recent_result = await db.execute(
        select(TasteFeedback.song_a_id, TasteFeedback.song_b_id)
        .where(TasteFeedback.user_id == user_id)
        .order_by(desc(TasteFeedback.created_at))
        .limit(30)
    )
    compared_ids = {
        song_id
        for row in recent_result.all()
        for song_id in row
    }

    recommendations = []
    for profile, song in indexed:
        vector = _vector(profile.summary)
        if vector is None or song.id in compared_ids:
            continue
        affinity = _cosine(target, vector)
        penalty = _cosine(disliked, vector) if disliked else 0.0
        score = affinity - (0.35 * penalty if disliked else 0.0)
        recommendations.append({
            "id": song.id,
            "title": song.title,
            "artist": song.artist,
            "album": song.album,
            "score": round(score, 4),
            "reason": (
                "Similar audio characteristics to tracks you preferred in Taste Lab."
            ),
        })
    recommendations.sort(key=lambda item: item["score"], reverse=True)
    return {
        "recommendations": recommendations[:12],
        "message": "Recommendations are based on lightweight audio features and your A/B choices.",
    }
