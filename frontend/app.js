const API_URL = "http://127.0.0.1:8000";

const loginScreen = document.getElementById("login-screen");
const musicApp = document.getElementById("music-app");

const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");

const loginButton = document.getElementById("login-button");
const logoutButton = document.getElementById("logout-button");

const loginMessage = document.getElementById("login-message");

const searchInput = document.getElementById("search-input");

const songList = document.getElementById("song-list");
const audioPlayer = document.getElementById("audio-player");

const nowPlaying = document.getElementById("now-playing");
const nowArtist = document.getElementById("now-artist");

const playerCover =
    document.getElementById("player-cover");

const playerCoverPlaceholder =
    document.getElementById("player-cover-placeholder");

const playPauseButton =
    document.getElementById("play-pause-button");

const previousButton =
    document.getElementById("previous-button");

const nextButton =
    document.getElementById("next-button");


/* ============================================================
   UPLOAD ELEMENTS
   ============================================================ */

const uploadTitle =
    document.getElementById("upload-title");

const uploadArtist =
    document.getElementById("upload-artist");

const uploadAlbum =
    document.getElementById("upload-album");

const uploadGenre =
    document.getElementById("upload-genre");

const uploadFile =
    document.getElementById("upload-file");

const uploadCover =
    document.getElementById("upload-cover");

const uploadButton =
    document.getElementById("upload-button");

const uploadMessage =
    document.getElementById("upload-message");


/* ============================================================
   PLAYER STATE
   ============================================================ */

let songs = [];
let currentSongIndex = -1;
let currentSongTime = 0;


/* ============================================================
   LOGIN
   ============================================================ */

loginButton.addEventListener("click", login);


async function login() {

    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (!username || !password) {

        loginMessage.textContent =
            "Please enter username and password.";

        return;
    }

    loginMessage.textContent =
        "Logging in...";

    try {

        const response = await fetch(
            `${API_URL}/api/auth/login`,
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    username: username,
                    password: password
                })
            }
        );

        const data = await response.json();

        if (!response.ok) {

            throw new Error(
                data.detail || "Login failed"
            );
        }

        localStorage.setItem(
            "cloudtune_token",
            data.access_token
        );

        loginMessage.textContent = "";

        showMusicApp();

    } catch (error) {

        console.error(error);

        loginMessage.textContent =
            "❌ Invalid username or password.";
    }
}


/* ============================================================
   SHOW MUSIC APP
   ============================================================ */

function showMusicApp() {

    loginScreen.style.display = "none";

    musicApp.style.display = "block";

    loadSongs();
}


/* ============================================================
   LOGOUT
   ============================================================ */

logoutButton.addEventListener("click", logout);


function logout() {

    localStorage.removeItem(
        "cloudtune_token"
    );

    audioPlayer.pause();

    audioPlayer.src = "";

    currentSongIndex = -1;

    currentSongTime = 0;

    musicApp.style.display = "none";

    loginScreen.style.display = "flex";

    usernameInput.value = "";
    passwordInput.value = "";

    loginMessage.textContent = "";
}


/* ============================================================
   LOAD SONGS
   ============================================================ */

async function loadSongs() {

    try {

        const response = await fetch(
            `${API_URL}/api/songs/`
        );

        if (!response.ok) {

            throw new Error(
                "Could not load songs"
            );
        }

        songs = await response.json();

        await cloudTuneLoadPersonalLibrary();
        displaySongs(songs);

        await restoreLastSong();

        await refreshIntelligenceSongs();

    } catch (error) {

        console.error(error);

        songList.innerHTML =
            "<p>❌ Could not load songs.</p>";
    }
}


/* ============================================================
   RESTORE LAST PLAYED SONG
   ============================================================ */

async function restoreLastSong() {

    const savedSongId =
        localStorage.getItem(
            "cloudtune_song_id"
        );

    const savedTime =
        parseFloat(
            localStorage.getItem(
                "cloudtune_song_time"
            )
        );


    if (!savedSongId || isNaN(savedTime)) {
        return;
    }


    const songIndex =
        songs.findIndex(
            song =>
                String(song.id) ===
                String(savedSongId)
        );


    if (songIndex === -1) {
        return;
    }


    const song =
        songs[songIndex];

    currentSongIndex =
        songIndex;

    currentSongTime =
        savedTime;


    nowPlaying.textContent =
        song.title;

    nowArtist.textContent =
        song.artist;


    /* --------------------------------------------------------
       RESTORE COVER
       -------------------------------------------------------- */

    if (song.cover_url) {

        playerCover.src =
            song.cover_url;

        playerCover.style.display =
            "block";

        playerCoverPlaceholder.style.display =
            "none";

    } else {

        playerCover.src = "";

        playerCover.style.display =
            "none";

        playerCoverPlaceholder.style.display =
            "block";
    }


    try {

        const response = await fetch(
            `${API_URL}/api/songs/${song.id}/stream`
        );


        if (!response.ok) {
            return;
        }


        const data =
            await response.json();


        audioPlayer.src =
            data.stream_url;


        audioPlayer.addEventListener(
            "loadedmetadata",
            function restoreTime() {

                if (
                    currentSongTime > 0 &&
                    currentSongTime <
                    audioPlayer.duration
                ) {

                    audioPlayer.currentTime =
                        currentSongTime;
                }

                audioPlayer.removeEventListener(
                    "loadedmetadata",
                    restoreTime
                );
            }
        );


        playPauseButton.textContent =
            "▶️ Play";


    } catch (error) {

        console.error(
            "Could not restore last song:",
            error
        );
    }
}


/* ============================================================
   DISPLAY SONGS
   ============================================================ */

function displaySongs(songArray) {

    songList.innerHTML = "";

    if (songArray.length === 0) {

        songList.innerHTML =
            "<p>🔍 No songs found.</p>";

        return;
    }

    songArray.forEach(song => {

        const songElement =
            document.createElement("div");

        songElement.className = "song";


        /* ----------------------------------------------------
           ALBUM ART
           ---------------------------------------------------- */

        let coverHTML = `
            <div class="song-cover-placeholder">
                🎵
            </div>
        `;

        if (song.cover_url) {

            coverHTML = `
                <img
                    class="song-cover"
                    src="${song.cover_url}"
                    alt="${song.title} cover"
                >
            `;
        }


        /* ----------------------------------------------------
           SONG CARD
           ---------------------------------------------------- */

        songElement.innerHTML = `

            ${coverHTML}

            <div class="song-details">

                <div class="song-title">
                    ${song.title}
                </div>

                <div class="song-artist">
                    ${song.artist}
                </div>

            </div>
        `;


        const originalIndex =
            songs.findIndex(
                item => item.id === song.id
            );


        songElement.addEventListener(
            "click",
            () => playSong(originalIndex)
        );


        songList.appendChild(songElement);
    });
}


/* ============================================================
   SEARCH
   ============================================================ */

searchInput.addEventListener(
    "input",
    () => {

        const searchText =
            searchInput.value
                .trim()
                .toLowerCase();

        if (!searchText) {

            displaySongs(songs);

            return;
        }

        const filteredSongs =
            songs.filter(song => {

                const title =
                    (song.title || "")
                        .toLowerCase();

                const artist =
                    (song.artist || "")
                        .toLowerCase();

                const album =
                    (song.album || "")
                        .toLowerCase();

                const genre =
                    (song.genre || "")
                        .toLowerCase();

                return (
                    title.includes(searchText) ||
                    artist.includes(searchText) ||
                    album.includes(searchText) ||
                    genre.includes(searchText)
                );
            });

        displaySongs(filteredSongs);
    }
);


/* ============================================================
   UPLOAD SONG
   ============================================================ */

uploadButton.addEventListener(
    "click",
    uploadSong
);


async function uploadSong() {

    const title =
        uploadTitle.value.trim();

    const artist =
        uploadArtist.value.trim();

    const album =
        uploadAlbum.value.trim();

    const genre =
        uploadGenre.value.trim();

    const file =
        uploadFile.files[0];

    const cover =
        uploadCover.files[0];


    /* --------------------------------------------------------
       VALIDATION
       -------------------------------------------------------- */

    if (!title || !artist || !file) {

        uploadMessage.textContent =
            "❌ Title, artist and MP3 file are required.";

        return;
    }


    if (!file.name.toLowerCase().endsWith(".mp3")) {

        uploadMessage.textContent =
            "❌ Only MP3 files are allowed.";

        return;
    }


    if (cover) {

        const validCover =
            /\.(jpg|jpeg|png|webp)$/i.test(
                cover.name
            );

        if (!validCover) {

            uploadMessage.textContent =
                "❌ Cover must be JPG, PNG or WEBP.";

            return;
        }
    }


    /* --------------------------------------------------------
       FORM DATA
       -------------------------------------------------------- */

    const formData =
        new FormData();

    formData.append(
        "title",
        title
    );

    formData.append(
        "artist",
        artist
    );

    formData.append(
        "album",
        album
    );

    formData.append(
        "genre",
        genre
    );

    formData.append(
        "file",
        file
    );

    if (cover) {

        formData.append(
            "cover",
            cover
        );
    }


    uploadMessage.textContent =
        "☁️ Uploading...";

    uploadButton.disabled = true;


    try {

        const token =
            localStorage.getItem(
                "cloudtune_token"
            );


        const response =
            await fetch(
                `${API_URL}/api/songs/upload`,
                {
                    method: "POST",

                    headers: {
                        "Authorization":
                            `Bearer ${token}`
                    },

                    body: formData
                }
            );


        const data =
            await response.json();


        if (!response.ok) {

            throw new Error(
                data.detail ||
                "Upload failed"
            );
        }


        uploadMessage.textContent =
            "✅ Song uploaded successfully!";


        uploadTitle.value = "";
        uploadArtist.value = "";
        uploadAlbum.value = "";
        uploadGenre.value = "";
        uploadFile.value = "";
        uploadCover.value = "";


        await loadSongs();


    } catch (error) {

        console.error(error);

        uploadMessage.textContent =
            `❌ ${error.message}`;

    } finally {

        uploadButton.disabled = false;
    }
}


/* ============================================================
   PLAY SONG
   ============================================================ */

async function playSong(index, startAtSeconds = 0) {

    stopTastePreview();

    if (index < 0 || index >= songs.length) {
        return;
    }

    const song = songs[index];

    currentSongIndex = index;

    currentSongTime = 0;


    try {

        nowPlaying.textContent =
            song.title;

        nowArtist.textContent =
            song.artist;


        /* ----------------------------------------------------
           PLAYER COVER
           ---------------------------------------------------- */

        if (song.cover_url) {

            playerCover.src =
                song.cover_url;

            playerCover.style.display =
                "block";

            playerCoverPlaceholder.style.display =
                "none";

        } else {

            playerCover.src = "";

            playerCover.style.display =
                "none";

            playerCoverPlaceholder.style.display =
                "block";
        }


        playPauseButton.textContent =
            "⏳ Loading...";


        const response = await fetch(
            `${API_URL}/api/songs/${song.id}/stream`
        );


        if (!response.ok) {

            throw new Error(
                "Could not get streaming URL"
            );
        }


        const data =
            await response.json();


        audioPlayer.src = data.stream_url;

        if (Number.isFinite(startAtSeconds) && startAtSeconds > 0) {
            await new Promise((resolve, reject) => {
                let settled = false;
                const cleanup = () => {
                    audioPlayer.removeEventListener("loadedmetadata", onLoaded);
                    audioPlayer.removeEventListener("error", onError);
                };
                const finish = (error) => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    error ? reject(error) : resolve();
                };
                const onLoaded = () => {
                    audioPlayer.currentTime = Math.min(
                        Math.max(0, startAtSeconds),
                        Math.max(0, audioPlayer.duration - 1)
                    );
                    finish();
                };
                const onError = () => finish(new Error("Could not load audio metadata"));
                audioPlayer.addEventListener("loadedmetadata", onLoaded);
                audioPlayer.addEventListener("error", onError);
                if (audioPlayer.readyState >= 1) onLoaded();
            });
        }

        await audioPlayer.play();


        playPauseButton.textContent =
            "⏸️ Pause";


    } catch (error) {

        console.error(error);

        nowPlaying.textContent =
            "❌ Playback failed";

        nowArtist.textContent = "";

        playPauseButton.textContent =
            "▶️ Play";
    }
}


/* ============================================================
   PLAY / PAUSE
   ============================================================ */

playPauseButton.addEventListener(
    "click",
    async () => {

        if (!audioPlayer.src) {

            if (songs.length > 0) {

                await playSong(0);
            }

            return;
        }

        if (audioPlayer.paused) {

            await audioPlayer.play();

        } else {

            audioPlayer.pause();
        }
    }
);


/* ============================================================
   PREVIOUS SONG
   ============================================================ */

previousButton.addEventListener(
    "click",
    async () => {

        if (songs.length === 0) {
            return;
        }

        if (currentSongIndex <= 0) {

            await playSong(
                songs.length - 1
            );

        } else {

            await playSong(
                currentSongIndex - 1
            );
        }
    }
);


/* ============================================================
   NEXT SONG
   ============================================================ */

nextButton.addEventListener(
    "click",
    async () => {

        if (songs.length === 0) {
            return;
        }

        if (currentSongIndex >= songs.length - 1) {

            await playSong(0);

        } else {

            await playSong(
                currentSongIndex + 1
            );
        }
    }
);


/* ============================================================
   AUDIO EVENTS
   ============================================================ */

audioPlayer.addEventListener(
    "play",
    () => {

        playPauseButton.textContent =
            "⏸️ Pause";
    }
);


audioPlayer.addEventListener(
    "pause",
    () => {

        playPauseButton.textContent =
            "▶️ Play";
    }
);


/* ============================================================
   SAVE PLAYBACK POSITION
   ============================================================ */

audioPlayer.addEventListener(
    "timeupdate",
    () => {

        if (currentSongIndex >= 0) {

            currentSongTime =
                audioPlayer.currentTime;

            localStorage.setItem(
                "cloudtune_song_id",
                songs[currentSongIndex].id
            );

            localStorage.setItem(
                "cloudtune_song_time",
                currentSongTime
            );
        }
    }
);


/* ============================================================
   AUTO NEXT SONG
   ============================================================ */

audioPlayer.addEventListener(
    "ended",
    async () => {

        if (songs.length === 0) {
            return;
        }

        if (currentSongIndex >= songs.length - 1) {

            await playSong(0);

        } else {

            await playSong(
                currentSongIndex + 1
            );
        }
    }
);


/* ============================================================
   CHECK EXISTING LOGIN
   ============================================================ */

const savedToken =
    localStorage.getItem(
        "cloudtune_token"
    );

if (savedToken) {

    showMusicApp();
}

/* ============================================================
   MOMENT SEARCH + TASTE LAB
   ============================================================ */

const intelligenceSongSelect = document.getElementById("intelligence-song-select");
const indexSongButton = document.getElementById("index-song-button");
const indexSongMessage = document.getElementById("index-song-message");
const indexProgressBar = document.getElementById("index-progress-bar");
const momentSecondInput = document.getElementById("moment-second-input");
const useCurrentMomentButton = document.getElementById("use-current-moment-button");
const findMomentsButton = document.getElementById("find-moments-button");
const momentSearchMessage = document.getElementById("moment-search-message");
const momentResults = document.getElementById("moment-results");
const momentLabelInput = document.getElementById("moment-label-input");
const momentNotesInput = document.getElementById("moment-notes-input");
const saveMomentButton = document.getElementById("save-moment-button");
const saveMomentMessage = document.getElementById("save-moment-message");
const savedMomentsList = document.getElementById("saved-moments-list");
const startTasteLabButton = document.getElementById("start-taste-lab-button");
const tasteMessage = document.getElementById("taste-message");
const tastePairContainer = document.getElementById("taste-pair");
const tasteChoiceControls = document.getElementById("taste-choice-controls");
const refreshRecommendationsButton = document.getElementById("refresh-recommendations-button");
const recommendationsMessage = document.getElementById("recommendations-message");
const tasteRecommendations = document.getElementById("taste-recommendations");

let intelligenceSongs = [];
let currentTastePair = null;
let previewTimeout = null;

function stopTastePreview() {
    if (previewTimeout !== null) {
        window.clearTimeout(previewTimeout);
        previewTimeout = null;
    }
}

function authHeaders(extra = {}) {
    const token = localStorage.getItem("cloudtune_token");
    return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra };
}

async function intelligenceRequest(path, options = {}) {
    const headers = authHeaders(options.headers || {});
    if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
    const response = await fetch(`${API_URL}${path}`, { ...options, headers });
    let data = {};
    try { data = await response.json(); } catch { data = {}; }
    if (!response.ok) throw new Error(data.detail || `Request failed (${response.status})`);
    return data;
}

function setFeatureMessage(element, message, kind = "") {
    if (!element) return;
    element.textContent = message;
    element.classList.remove("is-error", "is-success");
    if (kind === "error") element.classList.add("is-error");
    if (kind === "success") element.classList.add("is-success");
}

function makeElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = String(text);
    return element;
}

function formatMomentTime(seconds) {
    const value = Math.max(0, Math.floor(Number(seconds) || 0));
    return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

function selectedIntelligenceSong() {
    const id = Number(intelligenceSongSelect.value);
    return intelligenceSongs.find(song => song.id === id) || null;
}

async function refreshIntelligenceSongs() {
    if (!localStorage.getItem("cloudtune_token")) return;
    try {
        intelligenceSongs = await intelligenceRequest("/api/intelligence/songs");
        const oldValue = intelligenceSongSelect.value;
        intelligenceSongSelect.replaceChildren();
        if (!intelligenceSongs.length) {
            intelligenceSongSelect.add(new Option("Upload a song first", ""));
            indexSongButton.disabled = true;
        } else {
            for (const song of intelligenceSongs) {
                intelligenceSongSelect.add(new Option(
                    `${song.indexed ? "✓" : "○"} ${song.title} — ${song.artist}`,
                    String(song.id)
                ));
            }
            if (intelligenceSongs.some(song => String(song.id) === oldValue)) {
                intelligenceSongSelect.value = oldValue;
            }
            indexSongButton.disabled = false;
        }
        await renderSavedMoments();
    } catch (error) {
        console.error("Could not load intelligence library:", error);
        setFeatureMessage(indexSongMessage, "Could not load your analysis library. Check login and the API.", "error");
    }
}

/* Browser-side sound features: energy, zero-crossings, spectral brightness,
   bass, low-mid, mid, high-band energy and local dynamics. */
function goertzelPower(samples, sampleRate, frequency) {
    const coefficient = 2 * Math.cos(2 * Math.PI * frequency / sampleRate);
    let previous = 0, previousPrevious = 0;
    for (let i = 0; i < samples.length; i += 1) {
        const current = samples[i] + coefficient * previous - previousPrevious;
        previousPrevious = previous;
        previous = current;
    }
    return Math.max(0, previousPrevious ** 2 + previous ** 2
        - coefficient * previous * previousPrevious);
}

function extractFrameFeatures(audioBuffer, startSeconds) {
    const rate = audioBuffer.sampleRate;
    const left = audioBuffer.getChannelData(0);
    const right = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : null;
    const size = 2048;
    const start = Math.min(Math.max(0, Math.floor(startSeconds * rate)), Math.max(0, left.length - size));
    const samples = new Float32Array(size);
    let squares = 0, crossings = 0, previous = 0;
    for (let i = 0; i < size; i += 1) {
        const index = Math.min(left.length - 1, start + i);
        const value = ((left[index] || 0) + (right ? (right[index] || 0) : (left[index] || 0))) / 2;
        samples[i] = value;
        squares += value * value;
        if (i > 0 && ((value >= 0 && previous < 0) || (value < 0 && previous >= 0))) crossings += 1;
        previous = value;
    }
    const energy = Math.sqrt(squares / size);
    const zcr = crossings / (size - 1);
    const freqs = [80, 160, 315, 630, 1250, 2500, 5000, 8000];
    const powers = freqs.map(f => f < rate / 2 ? goertzelPower(samples, rate, f) : 0);
    const total = powers.reduce((sum, value) => sum + value, 0) || 1;
    const brightness = powers.reduce((sum, value, i) => sum + value * (i + 1), 0) / total / freqs.length;
    const band = (a, b) => powers.slice(a, b).reduce((sum, value) => sum + value, 0) / total;
    return [energy, zcr, brightness, band(0, 2), band(2, 4), band(4, 6), band(6, 8), 0];
}

async function analyseAudioBuffer(audioBuffer, progressCallback) {
    const duration = audioBuffer.duration;
    const stride = Math.max(3, duration / 2500);
    const segments = [], totals = new Array(8).fill(0);
    let previousEnergy = null, count = 0;

    for (let second = 0; second < duration; second += stride) {
        const frameTimes = [
            Math.min(second + 0.25, Math.max(0, duration - 0.05)),
            Math.min(second + 1.0, Math.max(0, duration - 0.05)),
            Math.min(second + 1.75, Math.max(0, duration - 0.05))
        ];
        const frames = frameTimes.map(time => extractFrameFeatures(audioBuffer, time));
        const vector = new Array(8).fill(0);
        for (const frame of frames) {
            for (let j = 0; j < 7; j += 1) vector[j] += frame[j] / frames.length;
        }
        vector[7] = previousEnergy === null ? 0 : Math.min(1, Math.abs(vector[0] - previousEnergy) * 4);
        previousEnergy = vector[0];

        const clean = vector.map(value => Number.isFinite(value) ? Number(value.toFixed(5)) : 0);
        segments.push({ second: Number(second.toFixed(2)), vector: clean });
        clean.forEach((value, index) => totals[index] += value);
        count += 1;
        if (count % 25 === 0) {
            progressCallback(Math.min(85, Math.round(second / duration * 85)));
            // Yield to the browser so progress updates and controls remain responsive.
            await new Promise(resolve => window.setTimeout(resolve, 0));
        }
    }

    return {
        duration_seconds: duration,
        summary: totals.map(value => Number((value / Math.max(1, count)).toFixed(5))),
        segments
    };
}

async function indexSelectedSong() {
    const song = selectedIntelligenceSong();
    if (!song) return setFeatureMessage(indexSongMessage, "Choose a song first.", "error");
    indexSongButton.disabled = true;
    indexProgressBar.style.width = "3%";
    let audioContext = null;

    try {
        setFeatureMessage(indexSongMessage, `Getting audio for “${song.title}”…`);
        const stream = await intelligenceRequest(`/api/songs/${song.id}/stream`);
        setFeatureMessage(indexSongMessage, "Downloading audio for local analysis…");
        const response = await fetch(stream.stream_url);
        if (!response.ok) throw new Error("The audio file could not be fetched for analysis.");
        const bytes = await response.arrayBuffer();
        indexProgressBar.style.width = "20%";

        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) throw new Error("This browser does not support Web Audio analysis.");
        audioContext = new AudioContextClass();
        const buffer = await audioContext.decodeAudioData(bytes.slice(0));
        setFeatureMessage(indexSongMessage, "Extracting audio fingerprints in your browser…");
        const profile = await analyseAudioBuffer(buffer, progress => {
            indexProgressBar.style.width = `${Math.min(90, 10 + progress)}%`;
        });
        await intelligenceRequest("/api/intelligence/profiles", {
            method: "POST",
            body: JSON.stringify({
                song_id: song.id,
                summary: profile.summary,
                segments: profile.segments,
                duration_seconds: profile.duration_seconds
            })
        });
        indexProgressBar.style.width = "100%";
        setFeatureMessage(indexSongMessage,
            `Indexed ${profile.segments.length} moments from “${song.title}”.`, "success");
        await refreshIntelligenceSongs();
    } catch (error) {
        console.error("Audio indexing failed:", error);
        const message = /fetch|network|cors|download/i.test(error.message)
            ? "Could not fetch audio for analysis. Check browser console and storage CORS settings, then retry."
            : error.message;
        setFeatureMessage(indexSongMessage, message, "error");
    } finally {
        if (audioContext && audioContext.state !== "closed") {
            try { await audioContext.close(); } catch { /* no-op */ }
        }
        indexSongButton.disabled = false;
        window.setTimeout(() => { indexProgressBar.style.width = "0"; }, 1200);
    }
}

function renderMomentResults(matches) {
    momentResults.replaceChildren();
    if (!matches || !matches.length) {
        momentResults.appendChild(makeElement("p", "empty-state",
            "No similar moments found yet. Index more songs to give CloudTune more audio to compare."));
        return;
    }
    for (const match of matches) {
        const row = makeElement("div", "moment-result");
        row.appendChild(makeElement("div", "result-icon", "≈"));
        const copy = makeElement("div", "result-copy");
        copy.appendChild(makeElement("strong", "", match.title));
        copy.appendChild(makeElement("span", "", `${match.artist} · ${formatMomentTime(match.second)}`));
        copy.appendChild(makeElement("small", "",
            `Approximate sound similarity: ${Math.round(match.similarity * 100)}%`));
        row.appendChild(copy);
        const play = makeElement("button", "result-action", "Play moment");
        play.type = "button";
        play.addEventListener("click", async () => {
            const index = songs.findIndex(item => item.id === match.song_id);
            if (index === -1) return setFeatureMessage(momentSearchMessage, "Track not loaded in the player.", "error");
            await playSong(index, match.second);
        });
        row.appendChild(play);
        momentResults.appendChild(row);
    }
}

async function findSimilarMoments() {
    const song = selectedIntelligenceSong();
    const second = Number(momentSecondInput.value);
    if (!song) return setFeatureMessage(momentSearchMessage, "Choose a source song first.", "error");
    if (!Number.isFinite(second) || second < 0) return setFeatureMessage(momentSearchMessage, "Enter a valid time in seconds.", "error");

    findMomentsButton.disabled = true;
    setFeatureMessage(momentSearchMessage, "Searching indexed moments…");
    try {
        const data = await intelligenceRequest("/api/intelligence/moments/search", {
            method: "POST",
            body: JSON.stringify({ song_id: song.id, second, limit: 12 })
        });
        renderMomentResults(data.matches);
        setFeatureMessage(momentSearchMessage,
            data.matches.length ? `Found ${data.matches.length} possible matches near ${formatMomentTime(data.matched_second)}.`
                : "No matching windows found. Index more songs.", data.matches.length ? "success" : "");
    } catch (error) {
        setFeatureMessage(momentSearchMessage, error.message, "error");
    } finally { findMomentsButton.disabled = false; }
}

function useCurrentPlaybackMoment() {
    if (currentSongIndex < 0 || !songs[currentSongIndex]) {
        return setFeatureMessage(momentSearchMessage, "Start playing a song first.", "error");
    }
    const current = songs[currentSongIndex];
    if (![...intelligenceSongSelect.options].some(option => option.value === String(current.id))) {
        return setFeatureMessage(momentSearchMessage, "Select one of your uploaded songs.", "error");
    }
    intelligenceSongSelect.value = String(current.id);
    momentSecondInput.value = String(Number(audioPlayer.currentTime.toFixed(2)));
    setFeatureMessage(momentSearchMessage, "Selected the current playback position.");
}

async function saveSelectedMoment() {
    const song = selectedIntelligenceSong();
    const second = Number(momentSecondInput.value);
    const label = momentLabelInput.value.trim();
    if (!song) return setFeatureMessage(saveMomentMessage, "Choose a song first.", "error");
    if (!Number.isFinite(second) || second < 0) return setFeatureMessage(saveMomentMessage, "Enter a valid timestamp.", "error");
    if (!label) {
        setFeatureMessage(saveMomentMessage, "Give this moment a name.", "error");
        momentLabelInput.focus();
        return;
    }
    saveMomentButton.disabled = true;
    try {
        await intelligenceRequest("/api/intelligence/moments", {
            method: "POST",
            body: JSON.stringify({
                song_id: song.id, start_seconds: second, label,
                notes: momentNotesInput.value.trim() || null
            })
        });
        momentLabelInput.value = "";
        momentNotesInput.value = "";
        setFeatureMessage(saveMomentMessage, "Moment saved.", "success");
        await renderSavedMoments();
    } catch (error) {
        setFeatureMessage(saveMomentMessage, error.message, "error");
    } finally { saveMomentButton.disabled = false; }
}

async function renderSavedMoments() {
    if (!localStorage.getItem("cloudtune_token")) return;
    try {
        const moments = await intelligenceRequest("/api/intelligence/moments");
        savedMomentsList.replaceChildren();
        if (!moments.length) {
            savedMomentsList.appendChild(makeElement("p", "empty-state",
                "No saved moments yet. Save a riff, beat, transition or timestamp to revisit it later."));
            return;
        }
        for (const moment of moments) {
            const row = makeElement("div", "saved-moment-item");
            row.appendChild(makeElement("div", "result-icon", "📍"));
            const copy = makeElement("div", "result-copy");
            copy.appendChild(makeElement("strong", "", moment.label));
            copy.appendChild(makeElement("span", "",
                `${moment.title} — ${moment.artist} · ${formatMomentTime(moment.second)}`));
            if (moment.notes) copy.appendChild(makeElement("small", "", moment.notes));
            row.appendChild(copy);

            const open = makeElement("button", "result-action", "Open");
            open.type = "button";
            open.addEventListener("click", async () => {
                const index = songs.findIndex(item => item.id === moment.song_id);
                if (index !== -1) await playSong(index, moment.second);
            });
            row.appendChild(open);

            const remove = makeElement("button", "result-action", "Delete");
            remove.type = "button";
            remove.addEventListener("click", async () => {
                remove.disabled = true;
                try {
                    await intelligenceRequest(`/api/intelligence/moments/${moment.id}`, { method: "DELETE" });
                    await renderSavedMoments();
                } catch (error) {
                    setFeatureMessage(saveMomentMessage, error.message, "error");
                }
            });
            row.appendChild(remove);
            savedMomentsList.appendChild(row);
        }
    } catch (error) {
        console.error("Could not load saved moments:", error);
    }
}

/* Taste Lab: pairwise A/B choices build a simple, explainable profile. */
function describeFeature(value, low, high) {
    return value < low ? "Low" : value > high ? "High" : "Balanced";
}

function makeTasteTrackCard(track, label) {
    const card = makeElement("article", "feature-panel taste-track");
    card.appendChild(makeElement("div", "eyebrow", `TRACK ${label}`));
    card.appendChild(makeElement("div", "taste-track-art", "♫"));
    card.appendChild(makeElement("h3", "", track.title));
    card.appendChild(makeElement("p", "", track.artist || "Unknown artist"));
    const summary = track.summary || {};
    const chips = makeElement("div", "taste-summary");
    chips.appendChild(makeElement("span", "taste-chip", `Energy: ${describeFeature(summary.energy || 0, 0.08, 0.2)}`));
    chips.appendChild(makeElement("span", "taste-chip", `Brightness: ${describeFeature(summary.brightness || 0, 0.25, 0.55)}`));
    chips.appendChild(makeElement("span", "taste-chip", `Bass: ${describeFeature(summary.bass || 0, 0.18, 0.5)}`));
    card.appendChild(chips);
    const preview = makeElement("button", "secondary-feature-button taste-preview-button", "▶ Preview 12 seconds");
    preview.type = "button";
    preview.addEventListener("click", () => previewTasteTrack(track.id));
    card.appendChild(preview);
    return card;
}

async function startTasteComparison() {
    startTasteLabButton.disabled = true;
    setFeatureMessage(tasteMessage, "Finding two indexed tracks…");
    try {
        const pair = await intelligenceRequest("/api/intelligence/taste/pair");
        currentTastePair = pair;
        tastePairContainer.replaceChildren(makeTasteTrackCard(pair.a, "A"), makeTasteTrackCard(pair.b, "B"));
        tasteChoiceControls.hidden = false;
        setFeatureMessage(tasteMessage, "Preview both tracks, then record your preference.");
    } catch (error) {
        currentTastePair = null;
        tasteChoiceControls.hidden = true;
        setFeatureMessage(tasteMessage, error.message, "error");
    } finally { startTasteLabButton.disabled = false; }
}

async function previewTasteTrack(songId) {
    stopTastePreview();
    const index = songs.findIndex(song => song.id === songId);
    if (index === -1) return setFeatureMessage(tasteMessage, "Track unavailable in player.", "error");
    await playSong(index, 20);
    if (audioPlayer.paused) return;
    previewTimeout = window.setTimeout(() => {
        audioPlayer.pause();
        previewTimeout = null;
    }, 12000);
}

async function submitTasteChoice(choice) {
    if (!currentTastePair) return setFeatureMessage(tasteMessage, "Start a comparison first.", "error");
    const buttons = [...tasteChoiceControls.querySelectorAll("button")];
    buttons.forEach(button => button.disabled = true);
    try {
        await intelligenceRequest("/api/intelligence/taste/feedback", {
            method: "POST",
            body: JSON.stringify({
                song_a_id: currentTastePair.a.id,
                song_b_id: currentTastePair.b.id,
                choice
            })
        });
        currentTastePair = null;
        setFeatureMessage(tasteMessage, "Choice saved. Taste Lab is learning from your comparisons.", "success");
        await loadTasteRecommendations();
        await startTasteComparison();
    } catch (error) {
        setFeatureMessage(tasteMessage, error.message, "error");
    } finally { buttons.forEach(button => button.disabled = false); }
}

async function loadTasteRecommendations() {
    try {
        const data = await intelligenceRequest("/api/intelligence/taste/recommendations");
        tasteRecommendations.replaceChildren();
        setFeatureMessage(recommendationsMessage, data.message || "");
        if (!data.recommendations || !data.recommendations.length) {
            tasteRecommendations.appendChild(makeElement("p", "empty-state",
                "Suggestions appear after you compare tracks and index enough of your library."));
            return;
        }
        for (const track of data.recommendations) {
            const row = makeElement("div", "recommendation-item");
            row.appendChild(makeElement("div", "result-icon", "✦"));
            const copy = makeElement("div", "result-copy");
            copy.appendChild(makeElement("strong", "", track.title));
            copy.appendChild(makeElement("span", "", track.artist || "Unknown artist"));
            copy.appendChild(makeElement("small", "", track.reason));
            row.appendChild(copy);
            const play = makeElement("button", "result-action", "Play");
            play.type = "button";
            play.addEventListener("click", async () => {
                const index = songs.findIndex(song => song.id === track.id);
                if (index !== -1) await playSong(index);
            });
            row.appendChild(play);
            tasteRecommendations.appendChild(row);
        }
    } catch (error) {
        setFeatureMessage(recommendationsMessage, error.message, "error");
    }
}

indexSongButton.addEventListener("click", indexSelectedSong);
findMomentsButton.addEventListener("click", findSimilarMoments);
useCurrentMomentButton.addEventListener("click", useCurrentPlaybackMoment);
saveMomentButton.addEventListener("click", saveSelectedMoment);
startTasteLabButton.addEventListener("click", startTasteComparison);
refreshRecommendationsButton.addEventListener("click", loadTasteRecommendations);
tasteChoiceControls.addEventListener("click", event => {
    const button = event.target.closest("[data-taste-choice]");
    if (button) submitTasteChoice(button.dataset.tasteChoice);
});



/* ============================================================
   CLOUDTUNE CRATE UI — navigation, favorites and local playlists
   ============================================================ */

const CLOUDTUNE_FAVORITES_KEY = "cloudtune_favorites";
const CLOUDTUNE_PLAYLISTS_KEY = "cloudtune_playlists";
let cloudTuneFavorites = new Set();
let cloudTunePlaylists = [];
let cloudTuneVisibleSongs = [];
let cloudTuneActivePlaylistId = null;

function cloudTuneReadFavorites() {
    return cloudTuneFavorites;
}

function cloudTuneReadPlaylists() {
    return cloudTunePlaylists;
}

function cloudTuneSetSyncStatus(message, good = false) {
    const status = document.getElementById("cloud-sync-status");
    if (!status) return;
    status.textContent = message;
    status.classList.toggle("is-synced", Boolean(good));
    status.classList.toggle("is-sync-error", /fail|error/i.test(message));
}

function cloudTuneParseLocalArray(key) {
    try {
        const value = JSON.parse(localStorage.getItem(key) || "null");
        return Array.isArray(value) ? value : [];
    } catch {
        return [];
    }
}

function cloudTuneNormalizePlaylist(data) {
    return {
        id: String(data.id),
        name: String(data.name || "Untitled Mix"),
        songIds: Array.isArray(data.song_ids) ? data.song_ids.map(String) : []
    };
}

async function cloudTuneRefreshPlaylists() {
    const data = await intelligenceRequest("/api/library/playlists");
    cloudTunePlaylists = data.map(cloudTuneNormalizePlaylist);
    cloudTuneRenderPlaylists();
    cloudTuneRenderPlaylistDetail();
}

async function cloudTuneLoadPersonalLibrary() {
    if (!localStorage.getItem("cloudtune_token")) return;

    cloudTuneSetSyncStatus("SYNCING CLOUD…");
    try {
        const profile = await intelligenceRequest("/api/users/me");
        const migrationKey = `cloudtune_cloud_library_migrated_${profile.id}`;

        let favoritesData = await intelligenceRequest("/api/library/favorites");
        let playlistsData = await intelligenceRequest("/api/library/playlists");

        // One-time migration keeps favorites and playlists created by the earlier local-only UI.
        if (localStorage.getItem(migrationKey) !== "1") {
            const localFavorites = cloudTuneParseLocalArray(CLOUDTUNE_FAVORITES_KEY).map(String);
            const remoteFavorites = new Set((favoritesData.song_ids || []).map(String));

            for (const songId of new Set(localFavorites)) {
                if (remoteFavorites.has(songId) || !songs.some(song => String(song.id) === songId)) continue;
                try {
                    await intelligenceRequest(`/api/library/favorites/${encodeURIComponent(songId)}`, { method: "PUT" });
                } catch (error) {
                    console.warn("Could not migrate one local favorite:", songId, error);
                }
            }

            let localPlaylists = cloudTuneParseLocalArray(CLOUDTUNE_PLAYLISTS_KEY);
            if (!localPlaylists.length && !playlistsData.length) {
                localPlaylists = [
                    { name: "Late Night Drive", songIds: [] },
                    { name: "Focus Flow", songIds: [] },
                    { name: "Morning Run", songIds: [] },
                    { name: "Rainy Sunday", songIds: [] }
                ];
            }

            for (const oldPlaylist of localPlaylists) {
                const name = String(oldPlaylist.name || "Untitled Mix").trim().slice(0, 80);
                if (!name) continue;
                let current = playlistsData.find(item => item.name.toLowerCase() === name.toLowerCase());
                if (!current) {
                    try {
                        current = await intelligenceRequest("/api/library/playlists", {
                            method: "POST",
                            body: JSON.stringify({ name })
                        });
                        playlistsData.push(current);
                    } catch (error) {
                        console.warn("Could not migrate one local playlist:", name, error);
                        continue;
                    }
                }

                const presentSongIds = new Set((current.song_ids || []).map(String));
                for (const songId of (Array.isArray(oldPlaylist.songIds) ? oldPlaylist.songIds : []).map(String)) {
                    if (presentSongIds.has(songId) || !songs.some(song => String(song.id) === songId)) continue;
                    try {
                        await intelligenceRequest(
                            `/api/library/playlists/${encodeURIComponent(current.id)}/tracks/${encodeURIComponent(songId)}`,
                            { method: "PUT" }
                        );
                        presentSongIds.add(songId);
                    } catch (error) {
                        console.warn("Could not migrate one playlist track:", songId, error);
                    }
                }
            }

            localStorage.setItem(migrationKey, "1");
            favoritesData = await intelligenceRequest("/api/library/favorites");
            playlistsData = await intelligenceRequest("/api/library/playlists");
        }

        cloudTuneFavorites = new Set((favoritesData.song_ids || []).map(String));
        cloudTunePlaylists = playlistsData.map(cloudTuneNormalizePlaylist);
        cloudTuneSetSyncStatus("CLOUD SYNCED ✓", true);
    } catch (error) {
        console.error("Could not sync favorites and playlists:", error);
        cloudTuneSetSyncStatus("CLOUD SYNC FAILED");
    }
}

function cloudTuneDuration(song) {
    const value = Number(song.duration_seconds || song.duration || song.duration_seconds_cached);
    if (!Number.isFinite(value) || value <= 0) return "";
    return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
}

function cloudTuneSongRow(song, index, options = {}) {
    const row = document.createElement("div");
    row.className = "song";
    row.dataset.songId = String(song.id);

    const number = document.createElement("span");
    number.className = "song-number";
    number.textContent = String(index + 1).padStart(2, "0");
    row.appendChild(number);

    if (song.cover_url) {
        const cover = document.createElement("img");
        cover.className = "song-cover";
        cover.src = song.cover_url;
        cover.alt = "";
        cover.loading = "lazy";
        row.appendChild(cover);
    } else {
        const cover = document.createElement("span");
        cover.className = "song-cover-placeholder";
        cover.textContent = "◉";
        cover.setAttribute("aria-hidden", "true");
        row.appendChild(cover);
    }

    const copy = document.createElement("div");
    copy.className = "song-details";
    const title = document.createElement("span");
    title.className = "song-title";
    title.textContent = song.title || "Untitled Track";
    const artist = document.createElement("span");
    artist.className = "song-artist";
    artist.textContent = song.artist || "Unknown Artist";
    copy.append(title, artist);
    row.appendChild(copy);

    if (options.addPlaylistId || options.removePlaylistId) {
        const action = document.createElement("button");
        action.type = "button";
        action.className = "song-extra-action";
        action.textContent = options.addPlaylistId ? "ADD +" : "REMOVE −";
        action.addEventListener("click", event => {
            event.stopPropagation();
            cloudTuneChangePlaylist(options.addPlaylistId || options.removePlaylistId, String(song.id), Boolean(options.addPlaylistId));
        });
        row.appendChild(action);
    } else {
        const favorite = document.createElement("button");
        favorite.type = "button";
        favorite.className = "song-favorite";
        favorite.setAttribute("aria-label", "Toggle favorite");
        const favorites = cloudTuneReadFavorites();
        const isFavorite = favorites.has(String(song.id));
        favorite.classList.toggle("is-favorite", isFavorite);
        favorite.textContent = isFavorite ? "♥" : "♡";
        favorite.title = isFavorite ? "Remove from favorites" : "Add to favorites";
        favorite.addEventListener("click", async event => {
            event.stopPropagation();
            const songId = String(song.id);
            const wasFavorite = cloudTuneReadFavorites().has(songId);
            favorite.disabled = true;
            try {
                await intelligenceRequest(`/api/library/favorites/${encodeURIComponent(songId)}`, {
                    method: wasFavorite ? "DELETE" : "PUT"
                });
                if (wasFavorite) cloudTuneFavorites.delete(songId);
                else cloudTuneFavorites.add(songId);
                cloudTuneSetSyncStatus("CLOUD SYNCED ✓", true);
                displaySongs(cloudTuneVisibleSongs.length ? cloudTuneVisibleSongs : songs);
                cloudTuneRenderPlaylistDetail();
            } catch (error) {
                console.error("Could not update favorite:", error);
                cloudTuneSetSyncStatus("CLOUD SYNC FAILED");
                window.alert(`Could not save favorite: ${error.message}`);
            } finally {
                favorite.disabled = false;
            }
        });
        row.appendChild(favorite);

        const duration = document.createElement("span");
        duration.className = "section-count song-duration";
        duration.textContent = cloudTuneDuration(song);
        row.appendChild(duration);
    }

    const play = document.createElement("button");
    play.type = "button";
    play.className = "song-play-button";
    play.textContent = "▷";
    play.setAttribute("aria-label", "Play " + (song.title || "track"));
    play.addEventListener("click", event => {
        event.stopPropagation();
        const actualIndex = songs.findIndex(item => String(item.id) === String(song.id));
        if (actualIndex >= 0) playSong(actualIndex);
    });
    row.appendChild(play);

    const actualIndex = songs.findIndex(item => String(item.id) === String(song.id));
    if (actualIndex === currentSongIndex) row.classList.add("is-playing");
    row.addEventListener("click", () => {
        if (actualIndex >= 0) playSong(actualIndex);
    });
    return row;
}

function cloudTuneRenderRows(container, songArray, options = {}) {
    if (!container) return;
    container.replaceChildren();
    if (!songArray.length) {
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = options.emptyText || "No tracks here yet.";
        container.appendChild(empty);
        return;
    }
    songArray.forEach((song, index) => container.appendChild(cloudTuneSongRow(song, index, options)));
}

function displaySongs(songArray) {
    cloudTuneVisibleSongs = Array.isArray(songArray) ? songArray : [];
    cloudTuneRenderRows(document.getElementById("song-list"), cloudTuneVisibleSongs, {
        emptyText: "No tracks match that search."
    });

    const favorites = cloudTuneReadFavorites();
    const favoriteSongs = cloudTuneVisibleSongs.filter(song => favorites.has(String(song.id)));
    cloudTuneRenderRows(document.getElementById("favorites-song-list"), favoriteSongs, {
        emptyText: "No favorites yet. Tap the heart on any track to save it here."
    });

    const total = songs.length;
    const homeCount = document.getElementById("home-track-count");
    const libraryCount = document.getElementById("library-track-count");
    const favoriteCount = document.getElementById("favorite-track-count");
    if (homeCount) homeCount.textContent = `${total} TRACK${total === 1 ? "" : "S"}`;
    if (libraryCount) libraryCount.textContent = `${total} TRACK${total === 1 ? "" : "S"}`;
    if (favoriteCount) favoriteCount.textContent = `${favoriteSongs.length} TRACK${favoriteSongs.length === 1 ? "" : "S"}`;
    cloudTuneRenderUpNext();
    cloudTuneRenderPlaylists();
}

function cloudTuneRenderUpNext() {
    const container = document.getElementById("up-next-list");
    if (!container) return;
    container.replaceChildren();
    if (!songs.length) {
        const empty = document.createElement("span");
        empty.className = "muted-note";
        empty.textContent = "Upload a track to start your queue.";
        container.appendChild(empty);
        return;
    }
    const length = Math.min(3, songs.length);
    const start = currentSongIndex >= 0 ? (currentSongIndex + 1) % songs.length : Math.min(2, songs.length - 1);
    for (let step = 0; step < length; step += 1) {
        const index = (start + step) % songs.length;
        const song = songs[index];
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "queue-chip";
        if (song.cover_url) {
            const image = document.createElement("img");
            image.src = song.cover_url;
            image.alt = "";
            chip.appendChild(image);
        } else {
            const art = document.createElement("span");
            art.className = "queue-placeholder";
            art.textContent = "◉";
            chip.appendChild(art);
        }
        const title = document.createElement("span");
        title.textContent = song.title || "Untitled Track";
        chip.appendChild(title);
        chip.addEventListener("click", () => playSong(index));
        container.appendChild(chip);
    }
}

function cloudTuneRenderPlaylists() {
    const container = document.getElementById("playlist-cards");
    if (!container) return;
    container.replaceChildren();

    cloudTunePlaylists.forEach(playlist => {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "playlist-card" + (String(playlist.id) === String(cloudTuneActivePlaylistId) ? " is-selected" : "");
        const art = document.createElement("span");
        art.className = "playlist-art";
        art.textContent = "◎";
        art.setAttribute("aria-hidden", "true");
        const name = document.createElement("strong");
        name.textContent = playlist.name;
        const validIds = new Set(songs.map(song => String(song.id)));
        const count = playlist.songIds.filter(id => validIds.has(String(id))).length;
        const meta = document.createElement("small");
        meta.textContent = `${count} TRACK${count === 1 ? "" : "S"} · CLOUD`;
        card.append(art, name, meta);
        card.addEventListener("click", () => {
            cloudTuneActivePlaylistId = String(playlist.id);
            const detail = document.getElementById("playlist-detail");
            if (detail) detail.hidden = false;
            cloudTuneRenderPlaylists();
            cloudTuneRenderPlaylistDetail();
        });
        container.appendChild(card);
    });

    const addCard = document.createElement("button");
    addCard.type = "button";
    addCard.className = "playlist-card new-playlist";
    const plus = document.createElement("span");
    plus.className = "plus-mark";
    plus.textContent = "+";
    const label = document.createElement("strong");
    label.textContent = "NEW PLAYLIST";
    addCard.append(plus, label);
    addCard.addEventListener("click", async () => {
        const name = window.prompt("Name your new playlist:");
        if (!name || !name.trim()) return;
        try {
            const created = await intelligenceRequest("/api/library/playlists", {
                method: "POST",
                body: JSON.stringify({ name: name.trim().slice(0, 80) })
            });
            cloudTunePlaylists.push(cloudTuneNormalizePlaylist(created));
            cloudTuneActivePlaylistId = String(created.id);
            const detail = document.getElementById("playlist-detail");
            if (detail) detail.hidden = false;
            cloudTuneSetSyncStatus("CLOUD SYNCED ✓", true);
            cloudTuneRenderPlaylists();
            cloudTuneRenderPlaylistDetail();
        } catch (error) {
            console.error("Could not create playlist:", error);
            window.alert(`Could not create playlist: ${error.message}`);
        }
    });
    container.appendChild(addCard);
}

function cloudTuneRenderPlaylistDetail() {
    const detail = document.getElementById("playlist-detail");
    if (!detail || detail.hidden || !cloudTuneActivePlaylistId) return;
    const playlist = cloudTuneReadPlaylists().find(item => String(item.id) === String(cloudTuneActivePlaylistId));
    if (!playlist) return;
    document.getElementById("playlist-detail-title").textContent = playlist.name;
    const trackIds = new Set(playlist.songIds.map(String));
    const trackSongs = songs.filter(song => trackIds.has(String(song.id)));
    cloudTuneRenderRows(document.getElementById("playlist-song-list"), trackSongs, {
        removePlaylistId: playlist.id,
        emptyText: "This mix is empty. Add tracks below."
    });
    const available = songs.filter(song => !trackIds.has(String(song.id)));
    cloudTuneRenderRows(document.getElementById("playlist-add-list"), available, {
        addPlaylistId: playlist.id,
        emptyText: "Every track in your library is already in this mix."
    });
}

async function cloudTuneChangePlaylist(playlistId, songId, add) {
    const playlist = cloudTuneReadPlaylists().find(item => String(item.id) === String(playlistId));
    if (!playlist) return;
    try {
        await intelligenceRequest(
            `/api/library/playlists/${encodeURIComponent(playlistId)}/tracks/${encodeURIComponent(songId)}`,
            { method: add ? "PUT" : "DELETE" }
        );
        await cloudTuneRefreshPlaylists();
        cloudTuneSetSyncStatus("CLOUD SYNCED ✓", true);
    } catch (error) {
        console.error("Could not update playlist tracks:", error);
        cloudTuneSetSyncStatus("CLOUD SYNC FAILED");
        window.alert(`Could not update playlist: ${error.message}`);
    }
}

function cloudTuneSetView(view) {
    const target = document.getElementById(view + "-view");
    if (!target) return;
    document.querySelectorAll(".app-view").forEach(panel => panel.hidden = panel !== target);
    document.querySelectorAll(".nav-tab").forEach(tab => {
        const active = tab.dataset.view === view;
        tab.classList.toggle("is-active", active);
        if (active) tab.setAttribute("aria-current", "page");
        else tab.removeAttribute("aria-current");
    });
    const section = document.getElementById("song-section");
    if (section && (view === "home" || view === "library")) {
        const mount = document.getElementById(view === "home" ? "home-list-mount" : "library-list-mount");
        if (mount) mount.appendChild(section);
        const heading = document.getElementById("song-section-heading");
        if (heading) heading.textContent = view === "home" ? "Fresh Drops" : "Library";
    }
    if (view === "favorites") displaySongs(cloudTuneVisibleSongs.length ? cloudTuneVisibleSongs : songs);
    if (view === "playlists") {
        cloudTuneRenderPlaylists();
        cloudTuneRenderPlaylistDetail();
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll("[data-view]").forEach(button => {
    button.addEventListener("click", event => {
        event.preventDefault();
        cloudTuneSetView(button.dataset.view);
    });
});
document.querySelectorAll("[data-scroll-target]").forEach(button => {
    button.addEventListener("click", () => {
        const section = document.getElementById(button.dataset.scrollTarget);
        if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });
    });
});
const heroPlayButton = document.getElementById("hero-play-button");
if (heroPlayButton) heroPlayButton.addEventListener("click", () => {
    if (songs.length) playSong(0);
    else cloudTuneSetView("library");
});
const deletePlaylistButton = document.getElementById("delete-playlist-button");
if (deletePlaylistButton) deletePlaylistButton.addEventListener("click", async () => {
    const playlist = cloudTuneReadPlaylists().find(item => String(item.id) === String(cloudTuneActivePlaylistId));
    if (!playlist) return;
    if (!window.confirm(`Delete "${playlist.name}"? This removes the playlist and its track list, not the songs.`)) return;
    try {
        await intelligenceRequest(`/api/library/playlists/${encodeURIComponent(playlist.id)}`, { method: "DELETE" });
        cloudTunePlaylists = cloudTunePlaylists.filter(item => String(item.id) !== String(playlist.id));
        cloudTuneActivePlaylistId = null;
        document.getElementById("playlist-detail").hidden = true;
        cloudTuneRenderPlaylists();
        cloudTuneSetSyncStatus("CLOUD SYNCED ✓", true);
    } catch (error) {
        console.error("Could not delete playlist:", error);
        window.alert(`Could not delete playlist: ${error.message}`);
    }
});
const closePlaylistButton = document.getElementById("close-playlist-button");
if (closePlaylistButton) closePlaylistButton.addEventListener("click", () => {
    cloudTuneActivePlaylistId = null;
    document.getElementById("playlist-detail").hidden = true;
});
if (uploadButton) {
    // Upload remains handled by the existing, authenticated uploadSong() logic.
}
if (loginButton) loginButton.removeEventListener("click", login);
const existingLoginForm = document.getElementById("login-form");
if (existingLoginForm) existingLoginForm.addEventListener("submit", event => {
    event.preventDefault();
    login();
});

// Keep the visible queue and favorite view in sync with playback.
audioPlayer.addEventListener("play", () => {
    cloudTuneRenderUpNext();
    document.querySelectorAll(".song").forEach(row => row.classList.toggle("is-playing", String(row.dataset.songId) === String(songs[currentSongIndex]?.id)));
});
window.cloudTuneSetView = cloudTuneSetView;
