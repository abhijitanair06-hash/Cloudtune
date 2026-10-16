# Listener

Listener is CloudTune's song-discovery helper. It supports two modes:

- **Identify nearby music:** record a short clip from the microphone and use ShazamIO to identify the song against Shazam's service. It needs no personal API token or paid recognition plan.
- **Speak lyrics:** use the browser's speech-recognition support to transcribe a remembered line, then search the public Unison lyrics index. If speech recognition is unavailable, type the line instead.

After a match is confirmed, Listener saves it to Liked Songs. It then asks which existing CloudTune playlist should contain it. If the result matches a song already in the CloudTune catalogue, it uses the existing Favorites and playlist endpoints; otherwise it saves the external metadata in the Listener tables. External tracks are metadata/bookmarks, not downloaded audio files.

## Setup

From PowerShell, in the repository root:

```powershell
git pull origin feature/moment-search-taste-lab
cd backend
python -m pip install -r requirements.txt
python -m app.db.init_db
```

Then restart the backend:

```powershell
uvicorn app.main:app --reload
```

This adds the `shazamio` dependency and creates the `listener_liked_tracks` and `listener_playlist_tracks` tables. It does not reset or delete the existing music catalogue.

## Cost, quotas and reliability

- Listener uses the open-source [ShazamIO](https://github.com/shazamio/ShazamIO) library for sound recognition, with no user-supplied API key. ShazamIO is an unofficial/reverse-engineered integration with Shazam's service.
- There is no AudD token or paid recognition plan configured in CloudTune.
- This avoids a separate AudD starter quota, but it is **not a promise of unlimited successful requests**. Shazam may throttle requests or change its service; the integration may stop working without notice. Use reasonable request rates.
- Lyrics mode uses the public Unison lyrics search endpoint and does not need a token, but its public service also does not promise unlimited availability or capacity.
- If truly guaranteed, high-volume use is required, the dependable self-hosted option is to run an audio-fingerprint matcher with your own reference catalogue. That is free of per-request API quotas but only identifies music indexed in that catalogue, not every song in the world.

## Privacy and limitations

- Audio mode records about 10 seconds only after the user presses the button, then sends the sample to Shazam's service for recognition. CloudTune deletes its temporary copy after processing and does not store the raw recording.
- Lyrics mode uses browser speech recognition where supported. The recognized text is sent to the public Unison lyrics search endpoint; CloudTune does not save the raw recording or lyric transcript.
- Results depend on third-party service availability, music catalogue coverage, microphone quality and speech transcription.
- External discoveries appear in Listener's section of Favorites and can be assigned to CloudTune playlists. They are not streamable through CloudTune unless the audio is separately available in the CloudTune catalogue. External links open the provider/source page.
- No API token is needed for Listener recognition. Never commit other service credentials or the private `backend/.env` file.
