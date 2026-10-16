// Set window.CLOUDTUNE_API_URL before app.js when the API is on another host.
const configuredApiUrl = window.CLOUDTUNE_API_URL ||
    document.querySelector('meta[name="cloudtune-api-url"]')?.content;
const isLocalDev = location.protocol === "file:" ||
    ["localhost", "127.0.0.1"].includes(location.hostname);
const API_URL = (configuredApiUrl ||
    (isLocalDev ? "http://127.0.0.1:8000" : location.origin)).replace(/\/+$/, "");

function authHeaders(extraHeaders = {}) {
    const headers = { ...extraHeaders };
    const token = localStorage.getItem("cloudtune_token");
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
}

async function apiFetch(path, options = {}) {
    const token = localStorage.getItem("cloudtune_token");
    const response = await fetch(`${API_URL}${path}`, {
        ...options,
        headers: authHeaders(options.headers || {}),
    });

    if (response.status === 401 && token && path !== "/api/auth/login") {
        logout();
        loginMessage.textContent = "Your session expired. Please sign in again.";
    }
    return response;
}

const loginScreen = document.getElementById("login-screen");
const musicApp = document.getElementById("music-app");

const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");

const loginButton = document.getElementById("login-button");
const logoutButton = document.getElementById("logout-button");

const loginMessage = document.getElementById("login-message");

const searchInput = document.getElementById("search-input");

const songList = document.getElementById("song-list");
let audioPlayer = document.getElementById("audio-player");
audioPlayer.controls = false;
audioPlayer.crossOrigin = "anonymous";

const seekControl = document.getElementById("player-seek");
const currentTimeLabel = document.getElementById("player-current-time");
const durationLabel = document.getElementById("player-duration");
const volumeControl = document.getElementById("player-volume");
const speedControl = document.getElementById("player-speed");
const sleepControl = document.getElementById("sleep-timer");
const visualizerCanvas = document.getElementById("audio-visualizer");
const visualizerContext = visualizerCanvas?.getContext("2d");

let audioContext = null;
const audioGraphs = new WeakMap();
let visualizerFrame = 0;
let sleepTimerId = null;

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
let playbackRequestId = 0;
const streamUrlCache = new Map();
const STREAM_URL_CACHE_MS = 55 * 60 * 1000;
let nextStreamPreloader = new Audio();
nextStreamPreloader.preload = "auto";
nextStreamPreloader.controls = false;
nextStreamPreloader.crossOrigin = "anonymous";
nextStreamPreloader.style.display = "none";
const audioWrap = audioPlayer.parentElement;
audioWrap.appendChild(nextStreamPreloader);

let preloadedSongId = null;
let preferredVolume = 1;
let crossfadeInProgress = false;
let crossfadeAnimationFrame = 0;
const CROSSFADE_SECONDS = 2.2;
const CROSSFADE_DURATION_MS = 1800;

function activateDeck(deck) {
    if (deck === audioPlayer) return null;
    const outgoing = audioPlayer;
    outgoing.removeAttribute("id");
    outgoing.controls = false;
    outgoing.style.display = "none";

    audioWrap.removeChild(deck);
    audioWrap.replaceChild(deck, outgoing);
    audioWrap.appendChild(outgoing);

    deck.id = "audio-player";
    deck.controls = false;
    deck.style.display = "none";
    audioPlayer = deck;
    nextStreamPreloader = outgoing;
    return outgoing;
}

function resetDeck(deck) {
    if (!deck) return;
    deck.pause();
    try { deck.currentTime = 0; } catch (_) {}
    deck.removeAttribute("src");
    deck.load();
    deck.crossOrigin = "anonymous";
    deck.volume = preferredVolume;
    deck.playbackRate = Number.parseFloat(speedControl.value || "1");
    deck.controls = false;
    deck.style.display = "none";
}

function showTrackInfo(song) {
    nowPlaying.textContent = song.title || "Untitled";
    nowArtist.textContent = song.artist || "Unknown artist";

    if (song.cover_url && /^https?:\/\//i.test(song.cover_url)) {
        playerCover.src = song.cover_url;
        playerCover.style.display = "block";
        playerCoverPlaceholder.style.display = "none";
    } else {
        playerCover.removeAttribute("src");
        playerCover.style.display = "none";
        playerCoverPlaceholder.style.display = "block";
    }
}

async function ensureAudioGraph(deck) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;

    try {
        if (!audioContext) audioContext = new AudioContextClass();

        let graph = audioGraphs.get(deck);
        if (!graph) {
            const source = audioContext.createMediaElementSource(deck);
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 128;
            analyser.smoothingTimeConstant = 0.82;
            source.connect(analyser);
            analyser.connect(audioContext.destination);
            graph = {
                source,
                analyser,
                values: new Uint8Array(analyser.frequencyBinCount),
            };
            audioGraphs.set(deck, graph);
        }

        if (audioContext.state === "suspended") await audioContext.resume();
        return graph;
    } catch (error) {
        // Keep normal playback available if a browser cannot create a Web Audio graph.
        console.debug("Web Audio visualizer unavailable:", error);
        return null;
    }
}

function drawVisualizer() {
    if (!visualizerContext || !visualizerCanvas) return;

    const width = visualizerCanvas.width;
    const height = visualizerCanvas.height;
    visualizerContext.clearRect(0, 0, width, height);

    const graph = audioGraphs.get(audioPlayer);
    if (!graph || audioPlayer.paused) {
        visualizerContext.fillStyle = "#b8c2d0";
        visualizerContext.fillRect(0, height / 2, width, 1);
        visualizerFrame = 0;
        return;
    }

    graph.analyser.getByteFrequencyData(graph.values);
    const bars = 36;
    const gap = 2;
    const barWidth = Math.max(1, (width - (bars - 1) * gap) / bars);
    for (let i = 0; i < bars; i += 1) {
        const value = graph.values[Math.floor(i * graph.values.length / bars)] / 255;
        const barHeight = Math.max(2, value * (height - 2));
        const x = i * (barWidth + gap);
        const y = (height - barHeight) / 2;
        visualizerContext.fillStyle = i % 5 === 0 ? "#d7fa82" : "#b5a0fa";
        visualizerContext.fillRect(x, y, barWidth, barHeight);
    }
    visualizerFrame = requestAnimationFrame(drawVisualizer);
}

function startVisualizerAnimation() {
    if (!visualizerContext || visualizerFrame) return;
    visualizerFrame = requestAnimationFrame(drawVisualizer);
}

function formatPlaybackTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const wholeSeconds = Math.floor(seconds);
    const minutes = Math.floor(wholeSeconds / 60);
    const remainder = String(wholeSeconds % 60).padStart(2, "0");
    return minutes + ":" + remainder;
}

function updatePlaybackTimeline(deck) {
    if (deck !== audioPlayer) return;
    const duration = deck.duration;
    const currentTime = deck.currentTime || 0;
    currentTimeLabel.textContent = formatPlaybackTime(currentTime);
    durationLabel.textContent = formatPlaybackTime(duration);
    seekControl.value = Number.isFinite(duration) && duration > 0
        ? String(Math.round((currentTime / duration) * 1000))
        : "0";
    seekControl.setAttribute("aria-valuetext",
        formatPlaybackTime(currentTime) + " of " + formatPlaybackTime(duration));
}

function armSleepTimer(minutes) {
    if (sleepTimerId !== null) {
        clearTimeout(sleepTimerId);
        sleepTimerId = null;
    }
    if (!minutes) return;

    sleepTimerId = setTimeout(() => {
        audioPlayer.pause();
        nextStreamPreloader.pause();
        sleepControl.value = "0";
        sleepTimerId = null;
        playPauseButton.textContent = "▶";
    }, minutes * 60 * 1000);
}

async function startCrossfade(nextIndex, outgoingDeck) {
    if (crossfadeInProgress || !songs[nextIndex] || outgoingDeck !== audioPlayer) return;
    const incomingDeck = nextStreamPreloader;
    if (preloadedSongId !== String(songs[nextIndex].id) || incomingDeck.readyState < 2) return;

    crossfadeInProgress = true;
    const requestId = playbackRequestId;
    incomingDeck.currentTime = 0;
    incomingDeck.volume = 0;

    try {
        await ensureAudioGraph(incomingDeck);
        await incomingDeck.play();
    } catch (error) {
        crossfadeInProgress = false;
        incomingDeck.volume = preferredVolume;
        console.debug("Crossfade fell back to regular next-track playback:", error);
        return;
    }

    if (requestId !== playbackRequestId || audioPlayer !== outgoingDeck) {
        incomingDeck.pause();
        incomingDeck.volume = preferredVolume;
        crossfadeInProgress = false;
        return;
    }

    const outgoing = activateDeck(incomingDeck);
    currentSongIndex = nextIndex;
    currentSongTime = 0;
    preloadedSongId = null;
    showTrackInfo(songs[nextIndex]);
    playPauseButton.textContent = "⏸️ Pause";
    updatePlaybackTimeline(incomingDeck);
    startVisualizerAnimation();

    const startAt = performance.now();
    function fadeFrame(now) {
        if (requestId !== playbackRequestId || audioPlayer !== incomingDeck) {
            outgoing.pause();
            outgoing.volume = preferredVolume;
            crossfadeInProgress = false;
            return;
        }

        const progress = Math.min(1, (now - startAt) / CROSSFADE_DURATION_MS);
        incomingDeck.volume = preferredVolume * progress;
        outgoing.volume = preferredVolume * (1 - progress);

        if (progress < 1) {
            crossfadeAnimationFrame = requestAnimationFrame(fadeFrame);
        } else {
            resetDeck(outgoing);
            crossfadeInProgress = false;
            void prefetchNextStream(currentSongIndex);
        }
    }

    crossfadeAnimationFrame = requestAnimationFrame(fadeFrame);
}

async function getStreamUrl(song) {
    const cacheKey = String(song.id);
    const cached = streamUrlCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() + 30_000) return cached.url;

    const response = await apiFetch(`/api/songs/${encodeURIComponent(song.id)}/stream`);
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || "Could not get streaming URL");
    }

    const data = await response.json();
    if (!data.stream_url) throw new Error("The server did not return a streaming URL.");

    streamUrlCache.set(cacheKey, {
        url: data.stream_url,
        expiresAt: Date.now() + STREAM_URL_CACHE_MS,
    });
    return data.stream_url;
}

async function prefetchNextStream(index) {
    if (songs.length < 2 || currentSongIndex !== index || crossfadeInProgress) return;

    const nextIndex = (index + 1) % songs.length;
    const nextSong = songs[nextIndex];
    try {
        const url = await getStreamUrl(nextSong);
        // Playback may have changed while the signed URL request was in flight.
        if (currentSongIndex !== index || crossfadeInProgress) return;

        resetDeck(nextStreamPreloader);
        nextStreamPreloader.preload = "auto";
        nextStreamPreloader.crossOrigin = "anonymous";
        await ensureAudioGraph(nextStreamPreloader);
        nextStreamPreloader.src = url;
        nextStreamPreloader.load();
        preloadedSongId = String(nextSong.id);
    } catch (error) {
        console.debug("Next-track prefetch skipped:", error);
    }
}


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
    playbackRequestId += 1;
    streamUrlCache.clear();
    nextStreamPreloader.pause();
    nextStreamPreloader.removeAttribute("src");
    nextStreamPreloader.load();
    preloadedSongId = null;

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

        const response = await apiFetch("/api/songs/");

        if (!response.ok) {

            throw new Error(
                "Could not load songs"
            );
        }

        songs = await response.json();

        displaySongs(songs);

        await restoreLastSong();

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
    const savedSongId = localStorage.getItem("cloudtune_song_id");
    const savedTime = Number.parseFloat(localStorage.getItem("cloudtune_song_time") || "0");
    if (!savedSongId || !Number.isFinite(savedTime)) return;

    const songIndex = songs.findIndex(song => String(song.id) === String(savedSongId));
    if (songIndex < 0) return;

    const song = songs[songIndex];
    currentSongIndex = songIndex;
    currentSongTime = savedTime;
    nowPlaying.textContent = song.title || "Untitled";
    nowArtist.textContent = song.artist || "Unknown artist";

    if (song.cover_url && /^https?:\/\//i.test(song.cover_url)) {
        playerCover.src = song.cover_url;
        playerCover.style.display = "block";
        playerCoverPlaceholder.style.display = "none";
    } else {
        playerCover.removeAttribute("src");
        playerCover.style.display = "none";
        playerCoverPlaceholder.style.display = "block";
    }

    try {
        const url = await getStreamUrl(song);
        audioPlayer.src = url;
        audioPlayer.load();
        audioPlayer.addEventListener("loadedmetadata", function restoreTime() {
            if (currentSongTime > 0 && Number.isFinite(audioPlayer.duration) &&
                currentSongTime < audioPlayer.duration) {
                audioPlayer.currentTime = currentSongTime;
            }
            audioPlayer.removeEventListener("loadedmetadata", restoreTime);
        }, { once: true });
        playPauseButton.textContent = "▶️ Play";
        void prefetchNextStream(songIndex);
    } catch (error) {
        console.error("Could not restore last song:", error);
    }
}


/* ============================================================
   DISPLAY SONGS
   ============================================================ */

function displaySongs(songArray) {
    songList.replaceChildren();

    if (songArray.length === 0) {
        const empty = document.createElement("p");
        empty.textContent = "🔍 No songs found.";
        songList.appendChild(empty);
        return;
    }

    songArray.forEach(song => {
        const songElement = document.createElement("div");
        songElement.className = "song";
        songElement.setAttribute("role", "button");
        songElement.setAttribute("tabindex", "0");
        songElement.setAttribute("aria-label", `Play ${song.title || "untitled"} by ${song.artist || "unknown artist"}`);

        if (song.cover_url && /^https?:\/\//i.test(song.cover_url)) {
            const image = document.createElement("img");
            image.className = "song-cover";
            image.src = song.cover_url;
            image.alt = `${song.title || "Song"} cover`;
            image.loading = "lazy";
            songElement.appendChild(image);
        } else {
            const cover = document.createElement("div");
            cover.className = "song-cover-placeholder";
            cover.textContent = "🎵";
            songElement.appendChild(cover);
        }

        const details = document.createElement("div");
        details.className = "song-details";

        const title = document.createElement("div");
        title.className = "song-title";
        title.textContent = song.title || "Untitled";

        const artist = document.createElement("div");
        artist.className = "song-artist";
        artist.textContent = song.artist || "Unknown artist";

        details.append(title, artist);
        songElement.appendChild(details);

        const originalIndex = songs.findIndex(item => String(item.id) === String(song.id));
        songElement.addEventListener("click", () => playSong(originalIndex));
        songElement.addEventListener("keydown", event => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                playSong(originalIndex);
            }
        });
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


        const response = await apiFetch("/api/songs/upload", {
            method: "POST",
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            body: formData,
        });


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

async function playSong(index) {
    if (index < 0 || index >= songs.length) return;

    const requestId = ++playbackRequestId;
    if (crossfadeAnimationFrame) cancelAnimationFrame(crossfadeAnimationFrame);
    crossfadeAnimationFrame = 0;
    crossfadeInProgress = false;
    const song = songs[index];
    playPauseButton.textContent = "⏳ Loading...";

    // Pause a fading/preloaded deck while allowing its buffered source to be reused.
    nextStreamPreloader.pause();

    try {
        const url = await getStreamUrl(song);
        if (requestId !== playbackRequestId) return;

        const canUsePreloadedDeck =
            preloadedSongId === String(song.id) &&
            nextStreamPreloader.src === url;

        if (canUsePreloadedDeck) {
            const outgoing = activateDeck(nextStreamPreloader);
            resetDeck(outgoing);
            preloadedSongId = null;
        } else {
            resetDeck(nextStreamPreloader);
            preloadedSongId = null;
            audioPlayer.pause();
            audioPlayer.crossOrigin = "anonymous";
            await ensureAudioGraph(audioPlayer);
            audioPlayer.src = url;
            audioPlayer.load();
        }

        currentSongIndex = index;
        currentSongTime = 0;
        showTrackInfo(song);
        audioPlayer.volume = preferredVolume;
        audioPlayer.playbackRate = Number.parseFloat(speedControl.value || "1");
        audioPlayer.currentTime = 0;
        await ensureAudioGraph(audioPlayer);
        await audioPlayer.play();

        if (requestId !== playbackRequestId) return;
        playPauseButton.textContent = "⏸️ Pause";
        updatePlaybackTimeline(audioPlayer);
        startVisualizerAnimation();
        void prefetchNextStream(index);
    } catch (error) {
        if (requestId !== playbackRequestId) return;
        console.error("Playback failed:", error);
        nowPlaying.textContent = "❌ Playback failed";
        nowArtist.textContent = "";
        playPauseButton.textContent = "▶️ Play";
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

            await ensureAudioGraph(audioPlayer);
            audioPlayer.playbackRate = Number.parseFloat(speedControl.value || "1");
            await audioPlayer.play();
            updatePlaybackTimeline(audioPlayer);

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
   AUDIO EVENTS — both decks share the same handlers
   ============================================================ */

function bindAudioEvents(deck) {
    deck.addEventListener("play", () => {
        if (deck === audioPlayer) {
            playPauseButton.textContent = "⏸️ Pause";
            startVisualizerAnimation();
        }
    });

    deck.addEventListener("pause", () => {
        if (deck === audioPlayer && !crossfadeInProgress) {
            playPauseButton.textContent = "▶️ Play";
            if (visualizerFrame) cancelAnimationFrame(visualizerFrame);
            visualizerFrame = 0;
            drawVisualizer();
        }
    });

    deck.addEventListener("loadedmetadata", () => updatePlaybackTimeline(deck));
    deck.addEventListener("durationchange", () => updatePlaybackTimeline(deck));

    deck.addEventListener("timeupdate", () => {
        if (deck !== audioPlayer) return;
        updatePlaybackTimeline(deck);

        if (currentSongIndex >= 0 && songs[currentSongIndex]) {
            currentSongTime = deck.currentTime;
            localStorage.setItem("cloudtune_song_id", songs[currentSongIndex].id);
            localStorage.setItem("cloudtune_song_time", currentSongTime);
        }

        if (!crossfadeInProgress && songs.length > 1 && Number.isFinite(deck.duration)) {
            const nextIndex = (currentSongIndex + 1) % songs.length;
            const remaining = deck.duration - deck.currentTime;
            if (remaining <= CROSSFADE_SECONDS &&
                preloadedSongId === String(songs[nextIndex]?.id) &&
                nextStreamPreloader.readyState >= 2) {
                void startCrossfade(nextIndex, deck);
            }
        }
    });

    deck.addEventListener("ended", () => {
        if (deck !== audioPlayer || songs.length === 0) return;
        const nextIndex = (currentSongIndex + 1) % songs.length;
        void playSong(nextIndex);
    });

    deck.addEventListener("volumechange", () => {
        if (deck === audioPlayer && !crossfadeInProgress) {
            preferredVolume = deck.volume;
            nextStreamPreloader.volume = preferredVolume;
        }
    });
}

bindAudioEvents(audioPlayer);
bindAudioEvents(nextStreamPreloader);

seekControl.addEventListener("input", () => {
    const duration = audioPlayer.duration;
    if (Number.isFinite(duration) && duration > 0) {
        audioPlayer.currentTime = (Number.parseFloat(seekControl.value) / 1000) * duration;
        updatePlaybackTimeline(audioPlayer);
    }
});

volumeControl.addEventListener("input", () => {
    preferredVolume = Math.max(0, Math.min(1, Number.parseFloat(volumeControl.value)));
    audioPlayer.volume = preferredVolume;
    if (!crossfadeInProgress) nextStreamPreloader.volume = preferredVolume;
});

speedControl.addEventListener("change", () => {
    const rate = Number.parseFloat(speedControl.value);
    audioPlayer.playbackRate = rate;
    nextStreamPreloader.playbackRate = rate;
});

sleepControl.addEventListener("change", () => {
    armSleepTimer(Number.parseInt(sleepControl.value, 10) || 0);
});


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