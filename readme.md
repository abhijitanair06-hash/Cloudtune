# CloudTune 🎵

CloudTune is a personal, cloud-backed music library for listening to your own music across devices.

## What's implemented

- Vanilla HTML/CSS/JavaScript frontend and FastAPI backend
- PostgreSQL persistence through async SQLAlchemy
- Supabase Storage for MP3s and optional cover art
- JWT bearer-token login with short-lived access tokens (15 minutes by default)
- Initial-account-only registration: public registration closes after the first account exists
- Per-user song library and protected streaming-URL endpoint
- MP3 upload, search, playback-position restore, previous/next and repeat-all-at-end
- Two-deck player with next-track prefetching and an approximately 1.8-second crossfade when the next deck is ready
- Keyboard shortcuts: **Space** play/pause, **J / ←** back 10 seconds, **L / →** forward 10 seconds, **↑ / ↓** volume
- GitHub Actions checks for JWT tests and frontend JavaScript syntax

Playlists, favorites, server-side listening history, lyrics/karaoke, richer recommendations, playback statistics, refresh-token sessions and production backup jobs remain roadmap work. See [docs/roadmap.md](docs/roadmap.md).

## Stack as it exists today

- **Frontend:** HTML, CSS and vanilla JavaScript in the frontend directory
- **API:** FastAPI in the backend/app directory
- **Database:** PostgreSQL with async SQLAlchemy
- **Audio storage:** Supabase Storage with signed stream URLs
- **Deployment direction:** Docker Compose and a VPS/reverse proxy

The earlier README described a planned Next.js stack; that is not the frontend currently in this repository.

## Local development

### 1. Configure the backend

In PowerShell:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
python -c "import secrets; print(secrets.token_hex(32))"
```

Copy the generated random value into JWT_SECRET in backend/.env. **Do not commit .env or reuse a public example secret.** Fill in DATABASE_URL, SUPABASE_URL, SUPABASE_KEY and SUPABASE_BUCKET. Set CORS_ORIGINS to a JSON list containing the exact frontend origins you use, for example:

```dotenv
CORS_ORIGINS=["http://127.0.0.1:5500","http://localhost:5500"]
```

Start the API while your virtual environment is active:

```powershell
uvicorn app.main:app --reload
```

The interactive API documentation is available at http://127.0.0.1:8000/docs.

### 2. Create the initial account

Use POST /api/auth/register once through /docs or an API client. After any account exists, the API rejects further public registrations. The browser app currently presents the login screen rather than a registration form.

### 3. Serve the frontend

Serve the frontend directory with a local static server such as VS Code Live Server on port 5500. The frontend defaults to http://127.0.0.1:8000 for local development.

For a deployed frontend and API on the same origin, CloudTune uses the page origin by default. If the API has a different public origin, set window.CLOUDTUNE_API_URL before loading app.js in frontend/index.html, for example:

```html
<script>window.CLOUDTUNE_API_URL = "https://api.example.com";</script>
<script src="app.js"></script>
```

Configure both CORS_ORIGINS and HTTPS/reverse-proxy settings for your actual deployment domain before exposing the app publicly.

## Tests

From the backend directory:

```powershell
python -m pytest -q
node --check ..\frontend\app.js
```

The database integration test is skipped unless CLOUDTUNE_TEST_DATABASE_URL points to a separate, disposable test database. JWT tests use test-only environment values and do not contact Supabase or PostgreSQL.