# CloudTune 🎵

CloudTune is a personal, cloud-backed music library for listening to your own music across devices.

## What's implemented

- Vanilla HTML/CSS/JavaScript frontend and FastAPI backend
- PostgreSQL persistence through async SQLAlchemy and Supabase Storage for audio/artwork
- JWT login with 15-minute access tokens and rotating 14-day refresh tokens
- Persistent server-side sessions, immediate access-token revocation, logout, session listing/revocation, and password change
- Single-person account setup: registration closes after the first user is created
- Authenticated, per-user song library and signed stream URLs
- Upload-size limits, MP3/image signature checks, SHA-256 deduplication per user, and storage cleanup after failed uploads where possible
- Storage usage endpoint at GET /api/songs/storage/usage and a matching library meter
- Custom seek bar/time display, volume, playback speed, sleep timer, and a Web Audio AnalyserNode visualizer
- Optional user-provided timestamped LRC lyrics with synchronized karaoke highlighting and click-to-seek
- Two-deck next-track prefetching and crossfade, timed against the end of the current song
- Keyboard shortcuts: **Space** play/pause, **J / ←** back 10 seconds, **L / →** forward 10 seconds, **↑ / ↓** volume
- GitHub Actions for JWT/session tests, Python syntax compilation, frontend syntax, and backup script syntax
- Dry-run-first orphan storage sweeper and a private PostgreSQL backup script with checksum and retention

Playlists, favorites, server-side listening history, richer recommendations, playback statistics, and a yearly listening recap remain roadmap work. See [docs/roadmap.md](docs/roadmap.md).

## Stack as it exists today

- **Frontend:** HTML, CSS and vanilla JavaScript in the frontend directory
- **API:** FastAPI in the backend/app directory
- **Database:** PostgreSQL with async SQLAlchemy
- **Audio storage:** Supabase Storage with signed stream URLs
- **Deployment direction:** Docker Compose and a VPS/reverse proxy

The older README described a planned Next.js stack; that is not the frontend currently in this repository.

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

Copy the generated 64-character random value into JWT_SECRET in backend/.env. **Do not commit .env or reuse the public example placeholder.** Fill in DATABASE_URL, SUPABASE_URL, SUPABASE_KEY and SUPABASE_BUCKET. Set CORS_ORIGINS to a JSON list containing the exact frontend origins you use, for example:

```dotenv
CORS_ORIGINS=["http://127.0.0.1:5500","http://localhost:5500"]
```

Set these optional limits in backend/.env to override the defaults:

```dotenv
MAX_SONG_SIZE_MB=100
MAX_COVER_SIZE_MB=10
STORAGE_QUOTA_MB=2048
ACCESS_TOKEN_EXPIRE_MINUTES=15
REFRESH_TOKEN_EXPIRE_DAYS=14
```

After filling in the real database and Supabase values, initialize or update the schema:

```powershell
python -m app.db.init_db
```

This creates missing tables (including auth_sessions) and adds the song hash/size columns needed by deduplication and storage accounting. Run it before starting the updated API against an existing database.

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

Configure CORS_ORIGINS and HTTPS/reverse-proxy settings for your actual deployment domain before exposing the app publicly.

## Storage maintenance

From the backend directory, the storage sweeper reports candidate orphan files without deleting anything:

```powershell
python scripts/sweep_orphaned_storage.py
```

It only considers CloudTune UUID-named audio/artwork files older than 24 hours, and skips objects whose age cannot be verified. Review the list before using the destructive flag:

```powershell
python scripts/sweep_orphaned_storage.py --apply
```

PostgreSQL backups require the PostgreSQL client tools (including pg_dump). The script creates a permission-restricted custom-format dump and SHA-256 checksum, retaining seven days by default:

```bash
bash scripts/backup_postgres.sh
```

To run it nightly on a VPS, install a cron entry using your deployment path and desired server-local time. For example, after deploying under /opt/cloudtune:

```cron
15 2 * * * cd /opt/cloudtune/backend && /usr/bin/bash scripts/backup_postgres.sh >> /opt/cloudtune/backup.log 2>&1
```

Backups stay on the VPS by default; copy them to a separate protected location and periodically test restoring one before relying on them.

## Tests

From the backend directory:

```powershell
python -m pytest -q
node --check ..\frontend\app.js
```

The database integration test is skipped unless CLOUDTUNE_TEST_DATABASE_URL points to a separate, disposable test database. JWT/session unit tests use mocks and do not contact PostgreSQL or Supabase.