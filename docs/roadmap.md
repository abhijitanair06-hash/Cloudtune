# CloudTune Roadmap

## Current implementation

CloudTune currently uses a vanilla JavaScript frontend, a FastAPI API, PostgreSQL/SQLAlchemy, and Supabase Storage. This roadmap reflects the repository's real implementation, not the earlier proposed Next.js stack.

### Security and backend

- [x] FastAPI routers, error handling, logging, and health endpoint
- [x] Move JWT signing secret into environment settings; fail fast when it is missing
- [x] Short-lived access tokens (15 minutes by default)
- [x] Consistent 401 responses for missing, invalid, and expired bearer tokens
- [x] Single personal account mode: close public registration after the first account exists
- [x] Remove the second public user-creation route and duplicate password hashing implementation
- [x] Require authentication for song listing, song details, streaming URLs, and uploads
- [x] Scope the library and streams to the authenticated user's uploaded songs
- [x] Configurable CORS origins
- [x] JWT unit tests, optional isolated-database integration test, and GitHub Actions CI
- [x] Rotating refresh tokens with server-side hash storage and logout revocation
- [x] Change-password endpoint, session listing, and individual-session revocation
- [ ] Login rate limiting and security-event audit log
- [x] Validate session ownership, expiry, and revocation on every authenticated API request
- [ ] Add schema migrations for future database model changes

### Music player

- [x] Play, pause, previous and next
- [x] Save and restore the last-played song and playback position in the browser
- [x] Custom seek bar, elapsed time, and duration
- [x] Volume slider and playback speed
- [x] Sleep timer
- [x] Web Audio AnalyserNode visualizer
- [x] Keyboard shortcuts for play/pause, seeking, and volume
- [x] Pre-fetch the next signed stream URL and buffer a second audio deck
- [x] Crossfade between two ready tracks with a regular next-track fallback
- [ ] Repeat-one/repeat-all modes, shuffle, and editable queue
- [ ] Optional user-configurable crossfade duration and gapless-playback diagnostics
- [ ] Media Session API integration for phone lock-screen and headset controls
- [x] Optional LRC upload and karaoke-style lyric highlighting/seek (user-provided timestamps; no external lyric provider)

Crossfade reduces the audible transition gap when the next track is already buffered, but exact gapless playback still depends on browser support, network speed, audio encoding, and stream readiness.

### Library and storage

- [x] MP3 upload to Supabase Storage with optional cover art
- [x] Signed URLs for private audio and cover art
- [x] Configurable upload size limits and MP3/image signature checks
- [x] Per-user SHA-256 duplicate detection backed by a unique database index
- [x] Per-user storage usage endpoint and library quota meter
- [x] Dry-run-first orphan sweeper with a 24-hour safety window
- [x] pg_dump backup script, private file permissions, checksums, and configurable retention; restore testing remains pending
- [ ] Streaming range/transcoding checks for reliable seeking on target devices

### Discovery and personal library

- [x] Search by title, artist, album, or genre
- [ ] Playlists and playlist ordering
- [ ] Favorites
- [ ] Server-side playback history and listening statistics
- [ ] Artist/album pages and smart playlists
- [ ] Recommendation experiments based on listening behavior and explicit user signals
- [ ] Yearly listening recap

### Deployment and operations

- [x] Environment-based API configuration and CORS allowlist
- [x] CI checks for backend tests and JavaScript syntax
- [ ] Production Docker Compose setup with health checks and restart policies
- [ ] Reverse proxy, custom domain, and HTTPS
- [ ] VPS firewall and SSH hardening
- [ ] Storage/database monitoring and operational alerts
- [ ] Document deployment, backup restoration, and rollback procedures

## Suggested next milestones

1. Complete deployment hardening: upload limits, migrations, explicit storage/database health checks, and VPS HTTPS configuration.
2. Finish account lifecycle: refresh tokens, password change, session list/revocation, and rate limiting.
3. Finish library workflows: favorites, playlists, server-side history, and queue/repeat/shuffle controls.
4. Expand lyrics/karaoke, recommendation experiments, statistics, and the yearly recap after the core library is reliable.