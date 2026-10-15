# Moment Search and Personal Discovery

This change adds two experimental CloudTune features:

- **Moment Search** indexes lightweight audio features in the browser and searches for other time windows with similar broad sound characteristics.
- **New for You** ranks unheard CloudTune catalogue tracks using recorded replays, listening time, completions, skips, favorites, artist/genre affinity, catalogue popularity, and co-listening signals.
- **Saved Moments** lets a user bookmark a timestamp with a label and optional note.

## Database setup

The current features use several SQLAlchemy tables, including `audio_profiles`, `saved_moments`, `listening_sessions`, and the cloud library tables. `taste_feedback` remains in the database for compatibility, but the frontend no longer uses Taste Lab.

From PowerShell, after switching to this branch and syncing the code:

```powershell
cd "C:\Users\Abhijit A Nair\CloudTune\backend"
.\.venv\Scripts\Activate.ps1
python -m app.db.init_db
```

The initializer uses SQLAlchemy `create_all`: it creates missing tables and does not delete or replace existing songs/users. If your project's database connection differs from the default, make sure `.env` points to the database you intend to use before running it.

Then start the backend as usual:

```powershell
uvicorn app.main:app --reload
```

Open the frontend using Live Server at `http://127.0.0.1:5500/frontend/index.html` (or `http://localhost:5500/frontend/index.html`).

## First use

1. Log in.
2. In **Moment Search**, select one of your uploaded songs and click **Analyse / Re-index song**.
3. Repeat for at least two songs.
4. Select an analysed source song, choose a time in seconds, and click **Find similar moments**. Results can be played from the matched timestamp.
5. Save moments with a title and optional notes.
6. Open **New for You** to see tracks not present in your recorded listening history.
7. Play tracks normally. CloudTune records plays, cumulative listening time, track finishes, skips, and replays; refresh the feed to see the updated profile.

## Audio access / CORS

Indexing downloads the selected song via the temporary stream URL and decodes it in the browser. The browser must be permitted to fetch that storage URL through CORS. If playback works but indexing fails, open browser DevTools and inspect the console/network error. Configure the storage provider's CORS policy to allow the frontend origin (`http://127.0.0.1:5500` and/or `http://localhost:5500`) for GET requests. Repeat with the deployed frontend origin later.

Audio is analysed in the user's browser. CloudTune stores the compact 8-number summary and timestamped feature vectors in its database; it does not upload the decoded audio to an AI provider.

## Current limitations

- This is an **experimental, lightweight sound-similarity** system, not a commercial-grade audio fingerprint engine. Similar-looking feature vectors do not prove that two moments contain the same sound.
- The analysis currently downloads and decodes a full song in the browser, so index one track at a time. Long/high-resolution files can use significant browser memory and CPU.
- Search results only come from tracks that have been indexed for the logged-in user's own library.
- New for You is a transparent heuristic rather than a trained deep-learning model. Recommendations improve as play history and shared-catalogue activity accumulate.
- Listening history begins with this update. Earlier play counts were not stored as a complete per-user history, so early recommendations may include tracks the user heard before tracking was added.
- New for You only recommends tracks already present in the CloudTune database/storage catalogue. It does not import an outside music catalogue; if all catalogue tracks are heard or saved, more tracks must be added.
- The features use the current song streaming endpoint. They are independent of the future R2 migration, but storage CORS must remain configured so browser-side analysis can fetch audio bytes.
- This feature uses the existing localStorage login token pattern. Do not expose Supabase or R2 secret credentials to frontend JavaScript.

## API endpoints

All endpoints are under `/api/intelligence` and require a bearer token:

- `GET /songs`
- `POST /profiles`
- `POST /moments/search`
- `POST /moments`
- `GET /moments`
- `DELETE /moments/{moment_id}`
(The older Taste Lab API endpoints remain available for compatibility but are no longer used by the frontend.)

Personal Discovery uses the following authenticated endpoints:

- `POST /api/recommendations/listening/start` — records a new listening session.
- `PUT /api/recommendations/listening/{session_key}` — updates listening time, end position, completion and skip signals.
- `GET /api/recommendations/for-you` — returns ranked tracks the user has not played or saved.

See `docs/PERSONAL_RECOMMENDATIONS.md` for the ranking signals and known limitations.

## Rename your username

After logging in, use Swagger to call `PATCH /api/users/me/username`:

1. Authorize Swagger with your current bearer access token.
2. Click **Try it out** and submit JSON such as `{"username":"Ace"}`.
3. Usernames must be 3-32 characters and may contain letters, numbers, dots, underscores, and hyphens.
4. The endpoint rejects a username already used by another account (case-insensitively).
5. The response includes a replacement `access_token`. Copy it, click **Authorize**, replace the old token, and authorize again.

The endpoint updates the existing user row; it does not create a new account or delete song metadata.

## Restore song records for files already in Supabase Storage

If your MP3s still exist in the private `music` bucket but the PostgreSQL `songs` table is empty, use the safe recovery helper below. It creates database rows that point to the existing object paths; it never uploads, deletes, or renames Storage objects.

First preview the proposed rows (example account ID 1):

```powershell
cd "C:\Users\Abhijit A Nair\CloudTune\backend"
.\.venv\Scripts\Activate.ps1
python -m Tests.restore_storage_library --user-id 1
```

The default is preview-only. Confirm that the proposed owner ID and file/cover associations are correct. Only then apply:

```powershell
python -m Tests.restore_storage_library --user-id 1 --apply
```

The script skips songs whose `file_path` is already registered, so it can be rerun without creating duplicate rows for the same file paths. MP3 files with no embedded title/artist tags receive temporary names such as `Recovered Track 01` and `Unknown Artist`; replace those with the real details after identifying the tracks by listening. Cover matching is inferred from closely adjacent upload timestamps and should be checked visually.
