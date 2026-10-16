# CloudTune development setup

## Backend environment

From the repository root, create the local environment file and edit every placeholder:

```powershell
Copy-Item backend/.env.example backend/.env
python -c "import secrets; print(secrets.token_urlsafe(48))"
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Paste the two different generated values into `JWT_SECRET_KEY` and
`JWT_REFRESH_SECRET_KEY`. Never commit `backend/.env` or reuse these keys across
environments. CloudTune intentionally refuses to start with missing, short, placeholder,
or identical JWT secrets.

Set `DATABASE_URL`, `SUPABASE_URL`, and `SUPABASE_KEY` in the same file.
`DATABASE_URL` must use the password configured for the local PostgreSQL service.
The Supabase API key is treated as a secret by the settings model.

## Local PostgreSQL

From the `infrastructure` directory, use the backend environment file for Compose
variable interpolation:

```powershell
docker compose --env-file ../backend/.env up -d postgres
```

The database port is bound to loopback only. Start the backend from its directory so
Pydantic loads `.env`:

```powershell
cd ../backend
python -m app.db.init_db
uvicorn app.main:app --reload
```

The first account can be created with `POST /api/auth/register`. Once that account
exists, public registration is closed; sign in using `POST /api/auth/login`.

## Authentication behavior

- Access tokens expire after 15 minutes by default.
- Refresh tokens are signed with a separate key, stored only as SHA-256 hashes, and
  rotated on every successful refresh.
- Server-side session records enable logout and revocation. A password change revokes
  all other sessions.
- Song listing, song metadata, uploads, and stream URL requests require a valid active
  session.
- Change `CORS_ORIGINS` to the exact comma-separated frontend origins before deploying.

## Tests

Install development dependencies and run the test suite:

```powershell
cd backend
python -m pip install -r requirements-dev.txt
python -m pytest -q Tests
```

JWT tests run without a live database. The database connectivity integration check is
skipped by default; set `RUN_DATABASE_INTEGRATION_TESTS=1` when a test PostgreSQL
database is available.
