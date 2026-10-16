# Listener

Listener is CloudTune's song-discovery helper. It supports two modes:

- **Identify nearby music:** record a short clip from the microphone and ask AudD to identify it.
- **Speak lyrics:** use the browser's speech-recognition support to transcribe a remembered line, then search the public Unison lyrics index. If speech recognition is unavailable, type the line instead.

After a result is confirmed, Listener saves it to Liked Songs. It then asks which existing CloudTune playlist should contain it. If the result matches a song already in the CloudTune catalogue, it uses the existing Favorites and playlist endpoints; otherwise it saves the external metadata in the Listener tables. External tracks are metadata/bookmarks, not downloaded audio files.

## Database setup

From PowerShell, in the repository root:

```powershell
cd backend
python -m app.db.init_db
```

This creates the new `listener_liked_tracks` and `listener_playlist_tracks` tables. It does not reset or delete the existing music catalogue.

## Free audio-recognition setup

Audio recognition needs an AudD API token. AudD advertises a starter allowance of 300 free requests. To keep this project at ₹0/$0, use only the free allowance and do not upgrade or add billing details.

1. Create a token at https://dashboard.audd.io/.
2. Add this line to the private `backend/.env` file:

   ```dotenv
   AUDD_API_TOKEN=your_token_here
   ```

3. Do not commit or share `backend/.env`. The backend reads the token and sends it to AudD; the frontend never receives it.
4. Restart the backend after editing `.env`.

If the token is not configured, audio recognition returns a clear setup message. Spoken-lyrics search does not need the AudD token.

## Privacy and limitations

- Audio mode records about 10 seconds only after the user presses the button, then sends the clip to AudD for recognition. The sample is not saved by CloudTune.
- Lyrics mode uses browser speech recognition where supported. The recognized text is sent to the public Unison lyrics search endpoint; CloudTune does not save the raw recording or lyric transcript.
- Results depend on third-party service availability, music catalog coverage, microphone quality and speech transcription.
- External discoveries appear in Listener's section of Favorites and can be assigned to CloudTune playlists. They are not streamable through CloudTune unless the audio is separately available in the CloudTune catalogue. External links open the provider/source page.
- Do not include secret API tokens in commits, screenshots or chat messages.
