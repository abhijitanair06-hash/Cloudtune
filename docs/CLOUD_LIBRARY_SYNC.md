# Cloud-synced Favorites and Playlists

This feature stores favorites and playlists in CloudTune's PostgreSQL database (Supabase in the current development setup) instead of only in browser localStorage.

## Database setup

The new SQLAlchemy models create three tables:

- `user_favorites` — one row per user/song favorite.
- `user_playlists` — named playlists owned by one user.
- `playlist_tracks` — songs saved in each playlist, including their order.

After pulling the feature branch, run this once from the backend folder. The existing initializer creates missing tables and does not replace existing song or user rows.

```powershell
cd "C:\Users\Abhijit A Nair\CloudTune\backend"
.\.venv\Scripts\Activate.ps1
python -m app.db.init_db
```

Then restart the API as usual:

```powershell
uvicorn app.main:app --reload
```

No Supabase Storage files are moved or modified. Do not share or commit the backend .env file or any database credentials.

## API

All routes below require the current CloudTune bearer token.

- `GET /api/library/favorites` — returns the current user's `song_ids`.
- `PUT /api/library/favorites/{song_id}` — add a favorite; repeated requests are safe.
- `DELETE /api/library/favorites/{song_id}` — remove a favorite.
- `GET /api/library/playlists` — list playlists and their `song_ids`.
- `POST /api/library/playlists` — create a playlist with JSON `{"name":"Late Night Drive"}`.
- `DELETE /api/library/playlists/{playlist_id}` — delete a playlist and its track list, not the music files.
- `PUT /api/library/playlists/{playlist_id}/tracks/{song_id}` — add a song to a playlist.
- `DELETE /api/library/playlists/{playlist_id}/tracks/{song_id}` — remove a song from a playlist.

The API checks that referenced song IDs exist in the CloudTune catalogue; favorites and playlist memberships are private to the signed-in user even when a track was uploaded by another catalogue contributor.

## Browser migration

On the first successful cloud-library load for an account, the frontend tries to migrate older local favorites and playlists to the database. The migration skips favorites, playlists, and tracks that already exist. Afterward, the frontend reads and writes the cloud API; old local-storage values are retained as the one-time migration source.