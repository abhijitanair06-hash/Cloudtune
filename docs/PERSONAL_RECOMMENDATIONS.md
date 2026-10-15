# Personal Recommendations — New for You

CloudTune replaces Taste Lab in the frontend with a behavioral recommendation feed. No paid AI API or external recommendation service is used.

## Signals used

- Replays: repeatedly starting a song increases its preference weight.
- Listening time: periodic playback progress is accumulated; seeking itself is not counted as listening.
- Completions: naturally reaching the end is a positive signal.
- Skips: switching away before halfway, after some listening, is a negative signal.
- Favorites: favorites strengthen artist and genre preference signals.
- Artist and genre affinity: unheard songs sharing details with positively engaged tracks rank higher.
- Catalogue popularity: plays by all users contribute to the global popularity signal.
- Collaborative overlap: if other CloudTune listeners replay tracks the current user replays, songs they listen to can rank higher too.

## Data model

Each play creates a row in `listening_sessions`. Repeated plays are separate sessions; listening progress updates cumulative listened seconds and records completion or skip flags. Every update is tied to the logged-in user's account.

The recommendation endpoint is `GET /api/recommendations/for-you?limit=12`. The listening endpoints are `POST /api/recommendations/listening/start` and `PUT /api/recommendations/listening/{session_key}`. All require the CloudTune bearer token.

## Setup

After pulling the feature branch, from PowerShell:

```powershell
cd "C:\Users\Abhijit A Nair\CloudTune\backend"
.\.venv\Scripts\Activate.ps1
python -m app.db.init_db
uvicorn app.main:app --reload
```

Refresh the frontend with Ctrl+F5. The home page's **New for You** section loads automatically after login.

## What to expect

- Playback history begins accumulating after this version is installed. CloudTune did not previously store a complete per-user play history, so old listening behavior cannot be reconstructed reliably; early recommendations may include tracks the user heard before this update.
- Recommendations are only as broad as the songs already present in CloudTune's database/storage catalogue. This code does not import or fetch an outside music catalogue. If every current catalogue track has been played or saved, the feed asks for more tracks to be added.
- The score is a transparent heuristic, not a trained deep-learning model. It improves as more listening history and multiple-user catalogue activity become available.
- Tracks are excluded from New for You once the current user has a recorded play session for them or has saved them to Favorites.

## Safety and cost

Listening history is associated with the authenticated CloudTune user. The algorithm runs in the existing FastAPI/PostgreSQL setup and uses no paid AI services. Never put database passwords or Supabase secret keys in frontend code or commit them to GitHub.