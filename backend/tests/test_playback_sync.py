from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.api.routes.playback import (
    PlaybackClaim,
    PlaybackHeartbeat,
    _state_is_stale,
    _state_payload,
    router,
)


def test_heartbeat_normalizes_device_name_and_accepts_finite_position():
    payload = PlaybackHeartbeat(
        device_id="c8a3e8f7-6f98-4f6b-9a65-3c3b5d0d1a11",
        device_name="  Abhijit's   Android  ",
        song_id=4,
        position_seconds=42.5,
        duration_seconds=180,
        is_playing=True,
    )

    assert payload.device_name == "Abhijit's Android"
    assert payload.position_seconds == 42.5
    assert payload.is_playing is True


@pytest.mark.parametrize(
    "overrides",
    [
        {"device_id": "short"},
        {"song_id": 0},
        {"position_seconds": -1},
        {"position_seconds": float("inf")},
        {"duration_seconds": float("nan")},
    ],
)
def test_heartbeat_rejects_invalid_identity_or_playback_values(overrides):
    values = {
        "device_id": "c8a3e8f7-6f98-4f6b-9a65-3c3b5d0d1a11",
        "song_id": 4,
        "position_seconds": 10,
    }
    values.update(overrides)

    with pytest.raises(ValidationError):
        PlaybackHeartbeat(**values)


def test_claim_requires_a_positive_state_version():
    with pytest.raises(ValidationError):
        PlaybackClaim(
            device_id="c8a3e8f7-6f98-4f6b-9a65-3c3b5d0d1a11",
            expected_version=0,
        )


def test_playback_lease_expires_only_after_the_timeout():
    now = datetime.now(timezone.utc)
    state = SimpleNamespace(updated_at=now - timedelta(seconds=10))

    assert _state_is_stale(state, now) is False
    state.updated_at = now - timedelta(seconds=46)
    assert _state_is_stale(state, now) is True


def test_state_payload_contains_only_song_metadata_and_position():
    updated_at = datetime.now(timezone.utc)
    state = SimpleNamespace(
        device_id="c8a3e8f7-6f98-4f6b-9a65-3c3b5d0d1a11",
        device_name="Laptop",
        version=3,
        position_seconds=27.25,
        duration_seconds=210,
        is_playing=True,
        updated_at=updated_at,
    )
    song = SimpleNamespace(id=12, title="Midnight City", artist="M83")

    payload = _state_payload(state, song)

    assert payload["song"] == {"id": 12, "title": "Midnight City", "artist": "M83"}
    assert payload["position_seconds"] == 27.25
    assert payload["version"] == 3
    assert "stream_url" not in payload


def test_playback_router_exposes_private_state_and_handoff_routes():
    routes = {
        (route.path, method)
        for route in router.routes
        for method in (route.methods or set())
    }

    assert ("/api/playback/state", "GET") in routes
    assert ("/api/playback/state", "PUT") in routes
    assert ("/api/playback/state/claim", "POST") in routes
