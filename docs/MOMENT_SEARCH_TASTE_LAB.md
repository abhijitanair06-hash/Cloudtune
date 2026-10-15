# Moment Search and Taste Lab

This change adds two experimental CloudTune features:

- **Moment Search** indexes lightweight audio features in the browser and searches for other time windows with similar broad sound characteristics.
- **Taste Lab** lets the user compare two indexed tracks, stores the A/B choice, and creates simple explainable recommendations from those comparisons.
- **Saved Moments** lets a user bookmark a timestamp with a label and optional note.

## Database setup

The feature adds three SQLAlchemy tables: `audio_profiles`, `saved_moments`, and `taste_feedback`.

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
6. In **Taste Lab**, start a comparison, preview A and B, then choose **I prefer A**, **I prefer B**, **I like both**, or **Neither**.
7. After several choices, refresh the recommendations.

## Audio access / CORS

Indexing downloads the selected song via the temporary stream URL and decodes it in the browser. The browser must be permitted to fetch that storage URL through CORS. If playback works but indexing fails, open browser DevTools and inspect the console/network error. Configure the storage provider's CORS policy to allow the frontend origin (`http://127.0.0.1:5500` and/or `http://localhost:5500`) for GET requests. Repeat with the deployed frontend origin later.

Audio is analysed in the user's browser. CloudTune stores the compact 8-number summary and timestamped feature vectors in its database; it does not upload the decoded audio to an AI provider.

## Current limitations

- This is an **experimental, lightweight sound-similarity** system, not a commercial-grade audio fingerprint engine. Similar-looking feature vectors do not prove that two moments contain the same sound.
- The analysis currently downloads and decodes a full song in the browser, so index one track at a time. Long/high-resolution files can use significant browser memory and CPU.
- Search results only come from tracks that have been indexed for the logged-in user's own library.
- Taste Lab uses simple track-level audio statistics and pairwise feedback. It is not a trained machine-learning model and its early recommendations may be weak.
- Recommendations require enough indexed songs and A/B choices; several tracks must be indexed first.
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
- `GET /taste/pair`
- `POST /taste/feedback`
- `GET /taste/recommendations`

## Rename your username

After logging in, use Swagger to call `PATCH /api/users/me/username`:

1. Authorize Swagger with your current bearer access token.
2. Click **Try it out** and submit JSON such as `{"username":"Ace"}`.
3. Usernames must be 3-32 characters and may contain letters, numbers, dots, underscores, and hyphens.
4. The endpoint rejects a username already used by another account (case-insensitively).
5. The response includes a replacement `access_token`. Copy it, click **Authorize**, replace the old token, and authorize again.

The endpoint updates the existing user row; it does not create a new account or delete song metadata.
