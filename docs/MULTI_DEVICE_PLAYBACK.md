# Multi-device playback handoff

CloudTune keeps one lightweight playback position per account so a user can move
from a laptop to a phone without searching for the track or scrubbing manually.

## How it works

- Each browser creates a random device ID and stores it locally. It sends a
  friendly device label such as "Android phone" or "Desktop browser".
- The current player renews its playback lease and position approximately
  every 8 seconds, and immediately after play/pause/track changes.
- A second signed-in device reads the saved song and position. It does not
  start playback automatically; the user chooses **Continue here**.
- Claiming a handoff transfers the account's playback lease using a version
  check. The previous device notices the owner change on its next poll and
  pauses, preventing two devices from continuing the same session.
- If a browser closes unexpectedly, another device can take over after the
  45-second lease expires.
- Only song metadata, device label, play state and timestamp are synchronized.
  Audio bytes and signed storage URLs are never stored in the playback-state
  table.

## API

All endpoints require the normal CloudTune authenticated session:

- `GET /api/playback/state` — read the latest account playback state.
- `PUT /api/playback/state` — renew this device's lease and update position.
- `POST /api/playback/state/claim` — atomically claim a state using its
  `expected_version`.

A `409` response from the heartbeat means a different device currently owns
the lease. A `409` response from claim means the state changed after the
handoff prompt was shown; refresh the state and ask the user again.

## Apply the migration

From `backend/`, with the virtual environment activated and `.env` set:

```powershell
python -m app.db.init_db
```

This applies Alembic revision `0004_playback_state` and leaves existing songs,
users and listening history in place.

## Manual test

1. Sign in on a laptop and start a song.
2. Sign in to the same account on a phone in a second browser.
3. The phone should show the track, artist, source device and saved position.
4. Select **Continue here**. Playback should start near the saved position.
5. The laptop should pause after its next state poll.
6. Close the phone browser without logging out. After 45 seconds, the laptop
   should be able to take over the saved state.

The backend tests validate the state schema, lease expiry, response shape and
route registration. Actual timing and audio resumption still need browser
testing with the project's Supabase stream URLs on both devices.
