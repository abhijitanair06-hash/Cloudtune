# CloudTune PWA

CloudTune can be installed as a Progressive Web App when served over HTTPS (or locally from `localhost` / `127.0.0.1`).

## What is included

- `frontend/manifest.json` defines the app name, theme, start URL and install icons.
- `frontend/pwa.js` registers the service worker.
- `frontend/service-worker.js` caches the static app shell so the interface can open offline after a successful first load.
- The service worker updates its shell cache when the app version changes.

## Deliberate offline limits

The service worker does **not** cache API responses, private account data, Supabase signed stream URLs, cover URLs, or audio files. Opening the shell offline does not mean the music library can play offline. Offline downloads need a separate user-controlled IndexedDB feature and storage-quota handling.

## Deployment notes

1. Serve the frontend through HTTPS in production.
2. Configure the backend API origin in the HTML `meta[name="cloudtune-api-url"]` value or set `window.CLOUDTUNE_API_URL` before `app.js` loads when the API is hosted on a separate origin. If frontend and API share an origin with `/api` reverse-proxied to FastAPI, leave the meta content empty.
3. Set `CORS_ORIGINS` on the backend to the exact frontend origin(s). Cookie-authenticated requests use credentials and origin checks.
4. Check DevTools → Application → Manifest and Service Workers, and test once online and once offline. The offline test should show the shell but should not imply that streaming is available.

Local frontend command from the repository root:

```powershell
python -m http.server 5500 --directory frontend
```

Open `http://127.0.0.1:5500/index.html`. The local backend still needs to be running separately for login and streaming.
