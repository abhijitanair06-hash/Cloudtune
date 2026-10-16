/* CloudTune Listener: identify music, search spoken lyrics, and save discoveries. */
let listenerLikedTracks = [];
let listenerSpeechRecognition = null;
let listenerRecording = false;

const listenerRecordButton = document.getElementById("listener-record-button");
const listenerAudioStatus = document.getElementById("listener-audio-status");
const listenerSpeechLanguage = document.getElementById("listener-speech-language");
const listenerSpeakButton = document.getElementById("listener-speak-button");
const listenerStopSpeechButton = document.getElementById("listener-stop-speech-button");
const listenerLyricsInput = document.getElementById("listener-lyrics-input");
const listenerSearchLyricsButton = document.getElementById("listener-search-lyrics-button");
const listenerLyricsStatus = document.getElementById("listener-lyrics-status");
const listenerResults = document.getElementById("listener-results");
const listenerFavoritesList = document.getElementById("listener-favorites-list");

function listenerMessage(element, message, kind = "") {
    if (!element) return;
    element.textContent = message;
    element.classList.remove("is-error", "is-success");
    if (kind === "error") element.classList.add("is-error");
    if (kind === "success") element.classList.add("is-success");
}

function listenerAuthenticated() {
    return Boolean(localStorage.getItem("cloudtune_token"));
}

function listenerSetSynced() {
    if (typeof cloudTuneSetSyncStatus === "function") {
        cloudTuneSetSyncStatus("CLOUD SYNCED ✓", true);
    }
}

function listenerSafeExternalUrl(value) {
    const candidate = String(value || "").trim();
    return /^https?:\/\//i.test(candidate) ? candidate : "";
}

function listenerRenderLikedTracks() {
    if (!listenerFavoritesList) return;
    listenerFavoritesList.replaceChildren();

    if (!listenerLikedTracks.length) {
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = "No external Listener discoveries saved yet. Identified matches will appear here.";
        listenerFavoritesList.appendChild(empty);
    } else {
        listenerLikedTracks.forEach(track => {
            const card = document.createElement("article");
            card.className = "listener-favorite-card";

            if (listenerSafeExternalUrl(track.artwork_url)) {
                const image = document.createElement("img");
                image.src = track.artwork_url;
                image.alt = "";
                image.loading = "lazy";
                card.appendChild(image);
            } else {
                const art = document.createElement("span");
                art.className = "listener-favorite-art";
                art.textContent = "◉";
                card.appendChild(art);
            }

            const copy = document.createElement("div");
            copy.className = "listener-favorite-copy";
            const title = document.createElement("strong");
            title.textContent = track.title || "Unknown track";
            const artist = document.createElement("span");
            artist.textContent = track.artist || "Unknown artist";
            copy.append(title, artist);
            card.appendChild(copy);

            const links = document.createElement("div");
            links.className = "listener-favorite-links";
            const open = document.createElement("a");
            open.textContent = "OPEN TRACK ↗";
            open.href = listenerSafeExternalUrl(track.track_url) || "https://www.google.com/search?q=" + encodeURIComponent((track.title || "") + " " + (track.artist || ""));
            open.target = "_blank";
            open.rel = "noreferrer";
            links.appendChild(open);

            const remove = document.createElement("button");
            remove.type = "button";
            remove.textContent = "REMOVE";
            remove.addEventListener("click", async () => {
                remove.disabled = true;
                try {
                    await intelligenceRequest("/api/listener/liked/" + encodeURIComponent(track.id), { method: "DELETE" });
                    await listenerLoadLikedTracks();
                    if (typeof cloudTuneRefreshPlaylists === "function") await cloudTuneRefreshPlaylists();
                    listenerSetSynced();
                } catch (error) {
                    listenerMessage(listenerLyricsStatus, "Could not remove saved track: " + error.message, "error");
                    remove.disabled = false;
                }
            });
            links.appendChild(remove);
            card.appendChild(links);
            listenerFavoritesList.appendChild(card);
        });
    }

    const favoriteCount = document.getElementById("favorite-track-count");
    if (favoriteCount) {
        const catalogueFavoriteCount = Array.isArray(songs)
            ? songs.filter(song => cloudTuneFavorites && cloudTuneFavorites.has(String(song.id))).length
            : 0;
        const total = catalogueFavoriteCount + listenerLikedTracks.length;
        favoriteCount.textContent = total + " TRACK" + (total === 1 ? "" : "S");
    }
}

async function listenerLoadLikedTracks() {
    if (!listenerAuthenticated()) {
        listenerLikedTracks = [];
        listenerRenderLikedTracks();
        return;
    }
    try {
        const data = await intelligenceRequest("/api/listener/liked");
        listenerLikedTracks = Array.isArray(data.tracks) ? data.tracks : [];
        listenerRenderLikedTracks();
    } catch (error) {
        console.warn("Could not load Listener likes:", error);
    }
}

function listenerCreateResultCard(track, origin = "lyrics") {
    const card = document.createElement("article");
    card.className = "listener-result-card";
    card.dataset.trackKey = String(track.track_key || "");

    const top = document.createElement("div");
    top.className = "listener-result-top";
    const art = document.createElement("div");
    art.className = "listener-result-art";
    const coverUrl = listenerSafeExternalUrl(track.artwork_url);
    if (coverUrl) {
        const image = document.createElement("img");
        image.src = coverUrl;
        image.alt = "";
        image.loading = "lazy";
        art.appendChild(image);
    } else {
        art.textContent = "◉";
    }
    const copy = document.createElement("div");
    const title = document.createElement("h4");
    title.className = "listener-result-title";
    title.textContent = track.title || "Unknown track";
    const artist = document.createElement("p");
    artist.className = "listener-result-artist";
    artist.textContent = track.artist || "Unknown artist";
    copy.append(title, artist);
    if (track.album) {
        const album = document.createElement("p");
        album.className = "listener-result-album";
        album.textContent = track.album;
        copy.appendChild(album);
    }
    top.append(art, copy);
    card.appendChild(top);

    const actions = document.createElement("div");
    actions.className = "listener-result-actions";
    const save = document.createElement("button");
    save.type = "button";
    save.className = "listener-save-button";
    save.textContent = origin === "audio" ? "SAVING TO LIKED SONGS…" : "THIS IS IT — SAVE TO LIKED SONGS";
    save.disabled = origin === "audio";
    if (origin !== "audio") {
        save.addEventListener("click", async () => listenerSaveRecognizedTrack(track, card, save));
    }
    actions.appendChild(save);

    const openUrl = listenerSafeExternalUrl(track.track_url);
    if (openUrl) {
        const open = document.createElement("a");
        open.href = openUrl;
        open.target = "_blank";
        open.rel = "noreferrer";
        open.textContent = "OPEN ↗";
        actions.appendChild(open);
    }
    card.appendChild(actions);
    listenerResults.appendChild(card);
    return card;
}

async function listenerFetchPlaylists() {
    const data = await intelligenceRequest("/api/library/playlists");
    if (typeof cloudTuneNormalizePlaylist === "function") {
        cloudTunePlaylists = data.map(cloudTuneNormalizePlaylist);
    }
    return data.map(item => ({ id: String(item.id), name: String(item.name || "Untitled playlist") }));
}

function listenerShowPlaylistPrompt(card, saved) {
    const oldPrompt = card.querySelector(".listener-playlist-prompt");
    if (oldPrompt) oldPrompt.remove();

    const prompt = document.createElement("div");
    prompt.className = "listener-playlist-prompt";
    const promptText = document.createElement("p");
    promptText.textContent = "✓ Added to Liked Songs. Which playlist should this go in?";
    prompt.appendChild(promptText);

    const select = document.createElement("select");
    select.setAttribute("aria-label", "Choose a playlist for this Listener discovery");
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Choose a playlist…";
    select.appendChild(placeholder);

    const add = document.createElement("button");
    add.type = "button";
    add.textContent = "ADD TO PLAYLIST";
    add.disabled = true;
    select.addEventListener("change", () => { add.disabled = !select.value; });

    prompt.append(select, add);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "listener-no-playlist";
    close.textContent = "KEEP IN LIKED SONGS ONLY";
    close.addEventListener("click", () => prompt.remove());
    prompt.appendChild(close);
    card.appendChild(prompt);

    listenerFetchPlaylists().then(playlists => {
        select.replaceChildren();
        const first = document.createElement("option");
        first.value = "";
        first.textContent = playlists.length ? "Choose a playlist…" : "No playlists yet";
        select.appendChild(first);
        playlists.forEach(playlist => {
            const option = document.createElement("option");
            option.value = playlist.id;
            option.textContent = playlist.name;
            select.appendChild(option);
        });
        if (!playlists.length) {
            add.disabled = true;
            add.textContent = "OPEN PLAYLISTS";
            add.disabled = false;
            add.addEventListener("click", () => {
                if (typeof window.cloudTuneSetView === "function") window.cloudTuneSetView("playlists");
            }, { once: true });
            select.disabled = true;
            close.textContent = "KEEP IN LIKED SONGS ONLY";
        }
    }).catch(error => {
        promptText.textContent = "Saved to Liked Songs, but playlists could not be loaded: " + error.message;
        select.disabled = true;
        add.disabled = true;
    });

    add.addEventListener("click", async () => {
        if (!select.value) return;
        add.disabled = true;
        add.textContent = "ADDING…";
        try {
            const playlistId = encodeURIComponent(select.value);
            if (saved.catalogueSongId) {
                await intelligenceRequest("/api/library/playlists/" + playlistId + "/tracks/" + encodeURIComponent(saved.catalogueSongId), { method: "PUT" });
            } else {
                await intelligenceRequest("/api/listener/playlists/" + playlistId + "/tracks/" + encodeURIComponent(saved.listenerTrackId), { method: "POST" });
            }
            if (typeof cloudTuneRefreshPlaylists === "function") await cloudTuneRefreshPlaylists();
            listenerSetSynced();
            promptText.textContent = "✓ Saved to Liked Songs and added to " + select.options[select.selectedIndex].text + ".";
            select.disabled = true;
            add.remove();
            close.remove();
        } catch (error) {
            promptText.textContent = "Could not add to playlist: " + error.message;
            add.disabled = false;
            add.textContent = "TRY AGAIN";
        }
    });
}

async function listenerSaveRecognizedTrack(track, card, saveButton) {
    saveButton.disabled = true;
    saveButton.textContent = "SAVING…";
    try {
        let saved;
        if (track.catalogue_song_id) {
            const songId = String(track.catalogue_song_id);
            await intelligenceRequest("/api/library/favorites/" + encodeURIComponent(songId), { method: "PUT" });
            if (cloudTuneFavorites) cloudTuneFavorites.add(songId);
            if (typeof displaySongs === "function") displaySongs(songs);
            saved = { catalogueSongId: songId, listenerTrackId: null };
        } else {
            const result = await intelligenceRequest("/api/listener/liked", {
                method: "POST",
                body: JSON.stringify({
                    track_key: track.track_key,
                    source: track.source,
                    title: track.title,
                    artist: track.artist,
                    album: track.album || null,
                    artwork_url: track.artwork_url || null,
                    track_url: track.track_url || null,
                    preview_url: track.preview_url || null
                })
            });
            saved = { catalogueSongId: null, listenerTrackId: String(result.track.id) };
            await listenerLoadLikedTracks();
        }
        listenerSetSynced();
        saveButton.textContent = "✓ ADDED TO LIKED SONGS";
        saveButton.disabled = true;
        if (track.catalogue_song_id) {
            const known = document.createElement("p");
            known.className = "listener-privacy-note";
            known.textContent = "This track is in your CloudTune library and is now a favorite.";
            card.appendChild(known);
        }
        listenerShowPlaylistPrompt(card, saved);
    } catch (error) {
        listenerMessage(listenerAudioStatus, "Could not save this match: " + error.message, "error");
        listenerMessage(listenerLyricsStatus, "Could not save this match: " + error.message, "error");
        saveButton.textContent = "RETRY SAVE";
        saveButton.disabled = false;
    }
}

async function listenerRecordAndIdentify() {
    if (listenerRecording) return;
    if (!listenerAuthenticated()) {
        listenerMessage(listenerAudioStatus, "Log in to CloudTune before using Listener.", "error");
        return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        listenerMessage(listenerAudioStatus, "This browser cannot record audio. Try a recent version of Chrome or use Speak Lyrics instead.", "error");
        return;
    }

    listenerRecording = true;
    listenerRecordButton.disabled = true;
    listenerRecordButton.textContent = "LISTENING… 10 SEC";
    listenerResults.replaceChildren();
    let stream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const preferredType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
            ? "audio/webm;codecs=opus"
            : "";
        const recorder = new MediaRecorder(stream, preferredType ? { mimeType: preferredType } : undefined);
        const chunks = [];
        recorder.addEventListener("dataavailable", event => {
            if (event.data && event.data.size) chunks.push(event.data);
        });
        const stopped = new Promise((resolve, reject) => {
            recorder.addEventListener("stop", resolve, { once: true });
            recorder.addEventListener("error", () => reject(new Error("The browser could not record this sample.")), { once: true });
        });
        recorder.start();
        listenerMessage(listenerAudioStatus, "Recording for 10 seconds… keep the music audible to your microphone.");
        await new Promise(resolve => setTimeout(resolve, 10000));
        if (recorder.state !== "inactive") recorder.stop();
        await stopped;
        const type = recorder.mimeType || "audio/webm";
        const blob = new Blob(chunks, { type });
        if (blob.size < 4000) throw new Error("The sample was too quiet or too short. Try again closer to the speaker.");

        listenerMessage(listenerAudioStatus, "Checking the sample against the music catalogue…");
        const form = new FormData();
        const extension = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
        form.append("file", blob, "listener-sample." + extension);
        const token = localStorage.getItem("cloudtune_token");
        const response = await fetch(API_URL + "/api/listener/recognize", {
            method: "POST",
            headers: { Authorization: "Bearer " + token },
            body: form
        });
        let data = {};
        try { data = await response.json(); } catch { data = {}; }
        if (!response.ok) throw new Error(data.detail || "Song recognition failed (" + response.status + ").");
        if (!data.matched || !data.track) {
            listenerMessage(listenerAudioStatus, data.message || "No match found. Try another sample.", "error");
            return;
        }

        listenerMessage(listenerAudioStatus, data.message || "Song identified.", "success");
        const card = listenerCreateResultCard(data.track, "audio");
        await listenerSaveRecognizedTrack(data.track, card, card.querySelector(".listener-save-button"));
    } catch (error) {
        console.error("Listener audio recognition failed:", error);
        listenerMessage(listenerAudioStatus, error.message || "Could not identify this recording.", "error");
    } finally {
        if (stream) stream.getTracks().forEach(track => track.stop());
        listenerRecording = false;
        listenerRecordButton.disabled = false;
        listenerRecordButton.textContent = "◉ LISTEN & IDENTIFY";
    }
}

function listenerStartSpeechRecognition() {
    if (!listenerAuthenticated()) {
        listenerMessage(listenerLyricsStatus, "Log in to CloudTune before using Listener.", "error");
        return;
    }
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
        listenerMessage(listenerLyricsStatus, "Speech recognition isn't available in this browser. Type the remembered lyric below and press FIND SONG FROM LYRICS.", "error");
        listenerLyricsInput.focus();
        return;
    }
    if (listenerSpeechRecognition) {
        try { listenerSpeechRecognition.abort(); } catch {}
    }

    const recognition = new Recognition();
    listenerSpeechRecognition = recognition;
    recognition.lang = listenerSpeechLanguage.value || "en-IN";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    listenerSpeakButton.disabled = true;
    listenerStopSpeechButton.disabled = false;
    listenerLyricsInput.value = "";
    listenerMessage(listenerLyricsStatus, "Listening now. Speak a line clearly, then pause.");
    recognition.onresult = event => {
        let transcript = "";
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
            transcript += event.results[i][0].transcript + " ";
        }
        if (transcript.trim()) listenerLyricsInput.value = transcript.trim().slice(0, 500);
        if (event.results[event.results.length - 1]?.isFinal) {
            listenerSearchLyricsButton.disabled = listenerLyricsInput.value.trim().length < 3;
        }
    };
    recognition.onerror = event => {
        if (event.error === "not-allowed") {
            listenerMessage(listenerLyricsStatus, "Microphone permission was denied. Allow microphone access or type the lyric instead.", "error");
        } else if (event.error !== "aborted" && event.error !== "no-speech") {
            listenerMessage(listenerLyricsStatus, "Speech recognition error: " + event.error + ". You can type the lyric instead.", "error");
        }
    };
    recognition.onend = () => {
        listenerSpeakButton.disabled = false;
        listenerStopSpeechButton.disabled = true;
        listenerSearchLyricsButton.disabled = listenerLyricsInput.value.trim().length < 3;
        if (listenerLyricsInput.value.trim().length >= 3) {
            listenerMessage(listenerLyricsStatus, "Transcript ready. Check the words, then search.", "success");
        }
        if (listenerSpeechRecognition === recognition) listenerSpeechRecognition = null;
    };
    try {
        recognition.start();
    } catch (error) {
        listenerSpeakButton.disabled = false;
        listenerStopSpeechButton.disabled = true;
        listenerMessage(listenerLyricsStatus, "Could not start speech recognition. Try again or type the lyric.", "error");
    }
}

async function listenerSearchLyrics() {
    if (!listenerAuthenticated()) {
        listenerMessage(listenerLyricsStatus, "Log in to CloudTune before using Listener.", "error");
        return;
    }
    const query = listenerLyricsInput.value.trim();
    if (query.length < 3) {
        listenerMessage(listenerLyricsStatus, "Enter or speak at least a few words of lyrics.", "error");
        return;
    }

    listenerSearchLyricsButton.disabled = true;
    listenerResults.replaceChildren();
    listenerMessage(listenerLyricsStatus, "Searching for those lyrics…");
    try {
        const data = await intelligenceRequest("/api/listener/lyrics/search", {
            method: "POST",
            body: JSON.stringify({ query })
        });
        listenerMessage(listenerLyricsStatus, data.message || "Lyrics search complete.", data.matches?.length ? "success" : "error");
        if (!data.matches || !data.matches.length) {
            const empty = document.createElement("p");
            empty.className = "empty-state";
            empty.textContent = data.message || "No matches found. Try another line.";
            listenerResults.appendChild(empty);
            return;
        }
        data.matches.forEach(track => listenerCreateResultCard(track, "lyrics"));
    } catch (error) {
        console.error("Listener lyrics search failed:", error);
        listenerMessage(listenerLyricsStatus, error.message || "Lyrics search failed.", "error");
    } finally {
        listenerSearchLyricsButton.disabled = listenerLyricsInput.value.trim().length < 3;
    }
}

function listenerRenderPlaylistTracks(tracks) {
    const container = document.getElementById("playlist-listener-track-list");
    if (!container) return;
    container.replaceChildren();
    if (!Array.isArray(tracks) || tracks.length === 0) {
        container.hidden = true;
        return;
    }
    container.hidden = false;
    const heading = document.createElement("div");
    heading.className = "section-heading sub-heading";
    const title = document.createElement("h3");
    title.textContent = "LISTENER DISCOVERIES";
    const count = document.createElement("span");
    count.className = "section-count";
    count.textContent = tracks.length + " TRACK" + (tracks.length === 1 ? "" : "S");
    heading.append(title, count);
    container.appendChild(heading);

    tracks.forEach(track => {
        const row = document.createElement("div");
        row.className = "listener-playlist-track";
        const info = document.createElement("div");
        const name = document.createElement("strong");
        name.textContent = track.title || "Unknown track";
        const artist = document.createElement("small");
        artist.textContent = (track.artist || "Unknown artist") + " · identified by Listener";
        info.append(name, artist);
        row.appendChild(info);

        const url = listenerSafeExternalUrl(track.track_url);
        if (url) {
            const open = document.createElement("a");
            open.href = url;
            open.target = "_blank";
            open.rel = "noreferrer";
            open.textContent = "OPEN ↗";
            row.appendChild(open);
        }
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "REMOVE";
        remove.addEventListener("click", async () => {
            const playlistId = String(cloudTuneActivePlaylistId || "");
            remove.disabled = true;
            try {
                await intelligenceRequest(
                    "/api/listener/playlists/" + encodeURIComponent(playlistId) + "/tracks/" + encodeURIComponent(track.id),
                    { method: "DELETE" }
                );
                if (typeof cloudTuneRefreshPlaylists === "function") await cloudTuneRefreshPlaylists();
            } catch (error) {
                remove.disabled = false;
                window.alert("Could not remove Listener track: " + error.message);
            }
        });
        row.appendChild(remove);
        container.appendChild(row);
    });
}
window.listenerRenderPlaylistTracks = listenerRenderPlaylistTracks;
window.ListenerUI = {
    refresh: listenerLoadLikedTracks,
    getSavedCount: () => listenerLikedTracks.length,
};

if (listenerRecordButton) listenerRecordButton.addEventListener("click", listenerRecordAndIdentify);
if (listenerSpeakButton) listenerSpeakButton.addEventListener("click", listenerStartSpeechRecognition);
if (listenerStopSpeechButton) listenerStopSpeechButton.addEventListener("click", () => {
    if (listenerSpeechRecognition) listenerSpeechRecognition.stop();
});
if (listenerSearchLyricsButton) listenerSearchLyricsButton.addEventListener("click", listenerSearchLyrics);
if (listenerLyricsInput) {
    listenerLyricsInput.addEventListener("input", () => {
        listenerSearchLyricsButton.disabled = listenerLyricsInput.value.trim().length < 3;
    });
}
window.addEventListener("cloudtune:login-success", listenerLoadLikedTracks);
window.addEventListener("cloudtune:library-ready", listenerLoadLikedTracks);
if (listenerAuthenticated()) void listenerLoadLikedTracks();
