// Local development targets FastAPI on port 8000. In production, the frontend
// can use the same-origin reverse proxy or set window.CLOUDTUNE_API_URL first.
const API_URL = (
    window.CLOUDTUNE_API_URL ||
    ((window.location.protocol === "file:" || ["localhost", "127.0.0.1"].includes(window.location.hostname))
        ? "http://127.0.0.1:8000"
        : window.location.origin)
).replace(/\/+$/, "");

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

const seekBar = document.getElementById("seek-bar");
const currentTimeLabel = document.getElementById("current-time");
const durationLabel = document.getElementById("duration-time");
const volumeControl = document.getElementById("volume-control");
const playbackSpeed = document.getElementById("playback-speed");
const crossfadeControl = document.getElementById("crossfade-duration");
const sleepTimerControl = document.getElementById("sleep-timer");
const visualizerCanvas = document.getElementById("audio-visualizer");
const playerStatus = document.getElementById("player-status");


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
let activeAudio = audioPlayer;
let standbyAudio = new Audio();
const audioDecks = new Set([audioPlayer, standbyAudio]);

const savedVolume = Number(localStorage.getItem("cloudtune_volume"));
let masterVolume = Number.isFinite(savedVolume) && savedVolume >= 0 && savedVolume <= 1 ? savedVolume : 0.8;
let lastNonZeroVolume = masterVolume || 0.8;
const savedCrossfade = Number(localStorage.getItem("cloudtune_crossfade_seconds"));
let crossfadeSeconds = Number.isFinite(savedCrossfade) && savedCrossfade >= 0 ? Math.min(savedCrossfade, 8) : 3;

let preparedIndex = -1;
let preparedUrl = "";
let preloadGeneration = 0;
let playRequestGeneration = 0;
let transitionFrame = 0;
let crossfadeInProgress = false;
let sleepTimerId = null;
let audioContext = null;
let analyser = null;
let visualizerFrame = 0;
const visualizerSources = new WeakMap();

for (const deck of audioDecks) {
    deck.preload = "auto";
    deck.crossOrigin = "anonymous";
    deck.volume = deck === activeAudio ? masterVolume : 0;
    deck.playbackRate = 1;
}

if (volumeControl) {
    volumeControl.value = String(masterVolume);
    volumeControl.style.setProperty("--seek-progress", (masterVolume * 100) + "%");
}
if (crossfadeControl) crossfadeControl.value = String(crossfadeSeconds);

function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const whole = Math.floor(seconds);
    return Math.floor(whole / 60) + ":" + String(whole % 60).padStart(2, "0");
}

function setPlayerStatus(message) {
    if (playerStatus) playerStatus.textContent = message || "";
}

function updateTimeline(deck = activeAudio) {
    const duration = Number.isFinite(deck.duration) ? deck.duration : 0;
    const elapsed = Number.isFinite(deck.currentTime) ? deck.currentTime : 0;
    if (currentTimeLabel) currentTimeLabel.textContent = formatTime(elapsed);
    if (durationLabel) durationLabel.textContent = formatTime(duration);
    if (seekBar) {
        const percentage = duration > 0 ? Math.min(100, (elapsed / duration) * 100) : 0;
        seekBar.value = String(percentage * 10);
        seekBar.style.setProperty("--seek-progress", percentage + "%");
        seekBar.setAttribute("aria-valuetext", formatTime(elapsed) + " of " + formatTime(duration));
    }
}

function setTrackDetails(song) {
    if (!song) return;
    nowPlaying.textContent = song.title || "Unknown title";
    nowArtist.textContent = song.artist || "Unknown artist";
    if (song.cover_url) {
        playerCover.src = song.cover_url;
        playerCover.style.display = "block";
        playerCoverPlaceholder.style.display = "none";
    } else {
        playerCover.removeAttribute("src");
        playerCover.style.display = "none";
        playerCoverPlaceholder.style.display = "block";
    }
}

function persistPlaybackPosition() {
    if (currentSongIndex < 0 || !songs[currentSongIndex] || crossfadeInProgress) return;
    currentSongTime = activeAudio.currentTime || 0;
    localStorage.setItem("cloudtune_song_id", String(songs[currentSongIndex].id));
    localStorage.setItem("cloudtune_song_time", String(currentSongTime));
}

async function fetchStreamUrl(index) {
    if (index < 0 || index >= songs.length) throw new Error("Track not found in the library.");
    const response = await fetch(API_URL + "/api/songs/" + songs[index].id + "/stream");
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.stream_url) {
        throw new Error(data.detail || "Could not get the streaming URL.");
    }
    return data.stream_url;
}

function nextTrackIndex(index = currentSongIndex) {
    if (songs.length < 2) return -1;
    return (index + 1) % songs.length;
}

function clearPreparedTrack() {
    preloadGeneration += 1;
    preparedIndex = -1;
    preparedUrl = "";
    standbyAudio.pause();
    standbyAudio.volume = 0;
    standbyAudio.removeAttribute("src");
    standbyAudio.load();
}

function cancelCrossfade() {
    if (transitionFrame) cancelAnimationFrame(transitionFrame);
    transitionFrame = 0;
    crossfadeInProgress = false;
    standbyAudio.pause();
    standbyAudio.volume = 0;
    activeAudio.volume = masterVolume;
}

async function prepareNextTrack(index = currentSongIndex) {
    const nextIndex = nextTrackIndex(index);
    if (crossfadeSeconds <= 0 || nextIndex < 0 || index !== currentSongIndex) return;
    if (preparedIndex === nextIndex && preparedUrl && standbyAudio.src === preparedUrl) return;

    const generation = ++preloadGeneration;
    const deck = standbyAudio;
    deck.pause();
    deck.volume = 0;
    deck.removeAttribute("src");
    deck.load();
    preparedIndex = -1;
    preparedUrl = "";

    try {
        const url = await fetchStreamUrl(nextIndex);
        if (
            generation !== preloadGeneration ||
            deck !== standbyAudio ||
            index !== currentSongIndex ||
            crossfadeSeconds <= 0
        ) return;

        deck.crossOrigin = "anonymous";
        deck.src = url;
        deck.load();
        deck.volume = 0;
        deck.playbackRate = activeAudio.playbackRate || 1;
        preparedIndex = nextIndex;
        preparedUrl = url;
    } catch (error) {
        console.warn("CloudTune could not preload the next track:", error);
    }
}

function setMasterVolume(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    masterVolume = Math.max(0, Math.min(1, numeric));
    if (masterVolume > 0) lastNonZeroVolume = masterVolume;
    if (!crossfadeInProgress) activeAudio.volume = masterVolume;
    if (!crossfadeInProgress) standbyAudio.volume = 0;
    if (volumeControl) {
        volumeControl.value = String(masterVolume);
        volumeControl.style.setProperty("--seek-progress", (masterVolume * 100) + "%");
    }
    localStorage.setItem("cloudtune_volume", String(masterVolume));
}

function setPlaybackSpeed(value) {
    const speed = Number(value);
    if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) return;
    for (const deck of audioDecks) deck.playbackRate = speed;
    setPlayerStatus("Playback speed: " + speed.toFixed(2).replace(/\.?0+$/, "") + "×");
}

function stopSleepTimer() {
    if (sleepTimerId !== null) window.clearTimeout(sleepTimerId);
    sleepTimerId = null;
}

function configureSleepTimer(minutes) {
    stopSleepTimer();
    const duration = Number(minutes);
    if (!Number.isFinite(duration) || duration <= 0) {
        setPlayerStatus("Sleep timer off");
        return;
    }
    setPlayerStatus("Sleep timer set for " + duration + " min");
    sleepTimerId = window.setTimeout(() => {
        cancelCrossfade();
        activeAudio.pause();
        standbyAudio.pause();
        setPlayerStatus("Sleep timer ended playback");
        if (sleepTimerControl) sleepTimerControl.value = "0";
        sleepTimerId = null;
    }, duration * 60 * 1000);
}

function initVisualizer() {
    if (!visualizerCanvas || (!window.AudioContext && !window.webkitAudioContext)) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    try {
        if (!audioContext) audioContext = new AudioContextClass();
        if (!analyser) {
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 128;
            analyser.smoothingTimeConstant = 0.82;
            analyser.connect(audioContext.destination);
        }
        for (const deck of audioDecks) {
            if (visualizerSources.has(deck)) continue;
            const source = audioContext.createMediaElementSource(deck);
            source.connect(analyser);
            visualizerSources.set(deck, source);
        }
        if (audioContext.state === "suspended") audioContext.resume();
        drawVisualizer();
    } catch (error) {
        console.warn("CloudTune visualizer unavailable:", error);
        setPlayerStatus("Visualizer unavailable in this browser");
    }
}

function drawVisualizer() {
    if (!visualizerCanvas || !analyser) return;
    const canvas = visualizerCanvas;
    const context = canvas.getContext("2d");
    if (!context) return;
    const pixelRatio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(canvas.clientWidth * pixelRatio));
    const height = Math.max(1, Math.floor(canvas.clientHeight * pixelRatio));
    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
    }
    const bins = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(bins);
    context.clearRect(0, 0, width, height);
    const gap = Math.max(2, Math.floor(width / 100));
    const barWidth = Math.max(2, Math.floor((width - gap * 23) / 24));
    for (let i = 0; i < 24; i += 1) {
        const value = bins[Math.floor(i * bins.length / 24)] / 255;
        const barHeight = Math.max(2 * pixelRatio, value * height * 0.94);
        context.fillStyle = "rgba(214, 250, 116, " + (0.35 + value * 0.65) + ")";
        context.fillRect(i * (barWidth + gap), (height - barHeight) / 2, barWidth, barHeight);
    }
    if (!activeAudio.paused) visualizerFrame = requestAnimationFrame(drawVisualizer);
    else visualizerFrame = 0;
}

function stopVisualizer() {
    if (visualizerFrame) cancelAnimationFrame(visualizerFrame);
    visualizerFrame = 0;
    if (visualizerCanvas) {
        const context = visualizerCanvas.getContext("2d");
        if (context) context.clearRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);
    }
}

if (seekBar) {
    seekBar.addEventListener("input", () => {
        const duration = activeAudio.duration;
        const percentage = Number(seekBar.value) / 1000;
        seekBar.style.setProperty("--seek-progress", (percentage * 100) + "%");
        if (Number.isFinite(duration) && duration > 0 && currentTimeLabel) {
            currentTimeLabel.textContent = formatTime(duration * percentage);
        }
    });
    seekBar.addEventListener("change", () => {
        const duration = activeAudio.duration;
        if (!Number.isFinite(duration) || duration <= 0) return;
        activeAudio.currentTime = duration * (Number(seekBar.value) / 1000);
        updateTimeline();
        persistPlaybackPosition();
    });
}
if (volumeControl) volumeControl.addEventListener("input", () => setMasterVolume(volumeControl.value));
if (playbackSpeed) playbackSpeed.addEventListener("change", () => setPlaybackSpeed(playbackSpeed.value));
if (crossfadeControl) {
    crossfadeControl.addEventListener("change", () => {
        const value = Number(crossfadeControl.value);
        crossfadeSeconds = Number.isFinite(value) ? Math.max(0, Math.min(8, value)) : 0;
        localStorage.setItem("cloudtune_crossfade_seconds", String(crossfadeSeconds));
        clearPreparedTrack();
        setPlayerStatus(crossfadeSeconds > 0 ? "Crossfade: " + crossfadeSeconds + "s" : "Crossfade off");
        if (crossfadeSeconds > 0) prepareNextTrack();
    });
}
if (sleepTimerControl) sleepTimerControl.addEventListener("change", () => configureSleepTimer(sleepTimerControl.value));

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

    cancelCrossfade();
    stopSleepTimer();
    activeAudio.pause();
    standbyAudio.pause();
    activeAudio.removeAttribute("src");
    standbyAudio.removeAttribute("src");
    activeAudio.load();
    standbyAudio.load();
    currentSongIndex = -1;
    currentSongTime = 0;
    clearPreparedTrack();
    stopVisualizer();
    setPlayerStatus("");

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
    const savedTime = Number.parseFloat(localStorage.getItem("cloudtune_song_time"));
    if (!savedSongId || !Number.isFinite(savedTime)) return;

    const songIndex = songs.findIndex(song => String(song.id) === String(savedSongId));
    if (songIndex < 0) return;

    currentSongIndex = songIndex;
    currentSongTime = Math.max(0, savedTime);
    setTrackDetails(songs[songIndex]);

    try {
        const streamUrl = await fetchStreamUrl(songIndex);
        activeAudio.src = streamUrl;
        activeAudio.load();

        const restorePosition = () => {
            if (currentSongTime > 0 && Number.isFinite(activeAudio.duration)) {
                activeAudio.currentTime = Math.min(currentSongTime, Math.max(0, activeAudio.duration - 0.25));
            }
            updateTimeline();
            setPlayerStatus("Ready to resume");
        };
        if (activeAudio.readyState >= 1) restorePosition();
        else activeAudio.addEventListener("loadedmetadata", restorePosition, { once: true });

        playPauseButton.textContent = "▶";
        updateTimeline();
        prepareNextTrack(songIndex);
    } catch (error) {
        console.error("Could not restore last song:", error);
        setPlayerStatus("Could not restore the last track");
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
        songElement.setAttribute("role", "button");
        songElement.setAttribute("tabindex", "0");
        songElement.setAttribute("aria-label", `Play ${song.title} by ${song.artist}`);


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

async function playSong(index) {
    if (index < 0 || index >= songs.length) return;

    const requestGeneration = ++playRequestGeneration;
    cancelCrossfade();
    clearPreparedTrack();
    activeAudio.pause();
    activeAudio.volume = masterVolume;
    activeAudio.muted = false;

    const song = songs[index];
    currentSongIndex = index;
    currentSongTime = 0;
    setTrackDetails(song);
    updateTimeline();
    playPauseButton.textContent = "…";
    setPlayerStatus("Loading track…");

    try {
        const streamUrl = await fetchStreamUrl(index);
        if (requestGeneration !== playRequestGeneration) return;

        activeAudio.crossOrigin = "anonymous";
        activeAudio.src = streamUrl;
        activeAudio.load();
        activeAudio.currentTime = 0;
        activeAudio.volume = masterVolume;
        activeAudio.playbackRate = playbackSpeed ? Number(playbackSpeed.value) : 1;

        initVisualizer();
        await activeAudio.play();
        if (requestGeneration !== playRequestGeneration) return;

        playPauseButton.textContent = "⏸";
        setPlayerStatus("");
        updateTimeline();
        persistPlaybackPosition();
        prepareNextTrack(index);
    } catch (error) {
        if (requestGeneration !== playRequestGeneration) return;
        console.error("CloudTune playback failed:", error);
        playPauseButton.textContent = "▶";
        setPlayerStatus(error && error.message ? error.message : "Playback failed");
    }
}

async function startCrossfade(nextIndex) {
    if (
        crossfadeInProgress ||
        crossfadeSeconds <= 0 ||
        preparedIndex !== nextIndex ||
        !preparedUrl ||
        standbyAudio.src !== preparedUrl ||
        nextIndex < 0 ||
        nextIndex >= songs.length
    ) return;

    const outgoing = activeAudio;
    const incoming = standbyAudio;
    if (!Number.isFinite(outgoing.duration)) return;

    crossfadeInProgress = true;
    incoming.volume = 0;
    incoming.playbackRate = playbackSpeed ? Number(playbackSpeed.value) : 1;

    try {
        initVisualizer();
        incoming.currentTime = 0;
        await incoming.play();
    } catch (error) {
        console.warn("Crossfade could not start; switching normally:", error);
        crossfadeInProgress = false;
        await playSong(nextIndex);
        return;
    }

    const remaining = Math.max(0.12, outgoing.duration - outgoing.currentTime);
    const fadeDuration = Math.max(0.12, Math.min(crossfadeSeconds, remaining));
    const startTime = performance.now();

    const fadeFrame = timestamp => {
        if (!crossfadeInProgress || activeAudio !== outgoing || standbyAudio !== incoming) return;
        const progress = Math.min(1, Math.max(0, (timestamp - startTime) / (fadeDuration * 1000)));
        outgoing.volume = masterVolume * (1 - progress);
        incoming.volume = masterVolume * progress;

        if (progress < 1) {
            transitionFrame = requestAnimationFrame(fadeFrame);
            return;
        }

        transitionFrame = 0;
        outgoing.pause();
        outgoing.volume = 0;
        try { outgoing.currentTime = 0; } catch (_) {}

        activeAudio = incoming;
        standbyAudio = outgoing;
        activeAudio.volume = masterVolume;
        activeAudio.muted = false;
        standbyAudio.volume = 0;
        standbyAudio.pause();

        currentSongIndex = nextIndex;
        currentSongTime = activeAudio.currentTime || 0;
        crossfadeInProgress = false;
        preparedIndex = -1;
        preparedUrl = "";

        setTrackDetails(songs[nextIndex]);
        playPauseButton.textContent = "⏸";
        setPlayerStatus("");
        updateTimeline();
        persistPlaybackPosition();
        initVisualizer();
        prepareNextTrack(nextIndex);
    };

    transitionFrame = requestAnimationFrame(fadeFrame);
}

/* ============================================================
   PLAY / PAUSE, PREVIOUS / NEXT
   ============================================================ */

playPauseButton.addEventListener("click", async () => {
    if (!activeAudio.src) {
        if (songs.length > 0) await playSong(Math.max(0, currentSongIndex));
        return;
    }
    if (activeAudio.paused) {
        try {
            initVisualizer();
            await activeAudio.play();
            setPlayerStatus("");
        } catch (error) {
            setPlayerStatus("Tap play again to resume audio");
        }
    } else {
        activeAudio.pause();
    }
});

previousButton.addEventListener("click", async () => {
    if (songs.length === 0) return;
    if (activeAudio.currentTime > 3) {
        activeAudio.currentTime = 0;
        updateTimeline();
        persistPlaybackPosition();
        return;
    }
    const index = currentSongIndex <= 0 ? songs.length - 1 : currentSongIndex - 1;
    await playSong(index);
});

nextButton.addEventListener("click", async () => {
    if (songs.length === 0) return;
    const index = currentSongIndex < 0 ? 0 : (currentSongIndex + 1) % songs.length;
    await playSong(index);
});

/* ============================================================
   AUDIO DECK EVENTS
   ============================================================ */

function attachDeckEvents(deck) {
    deck.addEventListener("play", () => {
        if (deck !== activeAudio) return;
        playPauseButton.textContent = "⏸";
        initVisualizer();
    });

    deck.addEventListener("pause", () => {
        if (deck !== activeAudio) return;
        playPauseButton.textContent = "▶";
        if (activeAudio.paused) stopVisualizer();
    });

    deck.addEventListener("loadedmetadata", () => {
        if (deck !== activeAudio) return;
        updateTimeline(deck);
        if (currentSongTime > 0 && deck.currentTime === 0) {
            try {
                deck.currentTime = Math.min(currentSongTime, Math.max(0, deck.duration - 0.25));
            } catch (_) {}
        }
    });

    deck.addEventListener("durationchange", () => {
        if (deck === activeAudio) updateTimeline(deck);
    });

    deck.addEventListener("timeupdate", () => {
        if (deck !== activeAudio || crossfadeInProgress) return;

        currentSongTime = deck.currentTime || 0;
        updateTimeline(deck);
        persistPlaybackPosition();

        const left = deck.duration - deck.currentTime;
        const targetIndex = nextTrackIndex(currentSongIndex);
        if (
            crossfadeSeconds > 0 &&
            targetIndex >= 0 &&
            Number.isFinite(left) &&
            left <= crossfadeSeconds &&
            preparedIndex === targetIndex
        ) startCrossfade(targetIndex);
    });

    deck.addEventListener("canplay", () => {
        if (
            deck === standbyAudio &&
            crossfadeSeconds > 0 &&
            Number.isFinite(activeAudio.duration) &&
            activeAudio.duration - activeAudio.currentTime <= crossfadeSeconds &&
            preparedIndex >= 0
        ) startCrossfade(preparedIndex);
    });

    deck.addEventListener("ended", async () => {
        if (deck !== activeAudio || crossfadeInProgress || songs.length === 0) return;
        const next = nextTrackIndex(currentSongIndex);
        if (next >= 0) {
            await playSong(next);
        } else {
            activeAudio.currentTime = 0;
            updateTimeline();
            setPlayerStatus("Track finished");
        }
    });

    deck.addEventListener("error", () => {
        if (deck !== activeAudio) return;
        setPlayerStatus("Audio could not be loaded. Try the track again.");
    });
}

for (const deck of audioDecks) attachDeckEvents(deck);

/* ============================================================
   KEYBOARD SHORTCUTS
   ============================================================ */

document.addEventListener("keydown", event => {
    const target = event.target;
    const typing = target && (
        target.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
    );
    if (typing || event.altKey) return;

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInput.focus();
        return;
    }
    if (event.ctrlKey || event.metaKey) return;

    switch (event.key) {
        case " ":
            event.preventDefault();
            playPauseButton.click();
            break;
        case "ArrowLeft":
            if (event.shiftKey) previousButton.click();
            else if (Number.isFinite(activeAudio.duration)) {
                activeAudio.currentTime = Math.max(0, activeAudio.currentTime - 5);
                updateTimeline();
            }
            event.preventDefault();
            break;
        case "ArrowRight":
            if (event.shiftKey) nextButton.click();
            else if (Number.isFinite(activeAudio.duration)) {
                activeAudio.currentTime = Math.min(activeAudio.duration, activeAudio.currentTime + 5);
                updateTimeline();
            }
            event.preventDefault();
            break;
        case "ArrowUp":
            event.preventDefault();
            setMasterVolume(Math.min(1, masterVolume + 0.05));
            break;
        case "ArrowDown":
            event.preventDefault();
            setMasterVolume(Math.max(0, masterVolume - 0.05));
            break;
        case "m":
        case "M":
            event.preventDefault();
            setMasterVolume(masterVolume > 0 ? 0 : lastNonZeroVolume);
            break;
    }
});

window.addEventListener("resize", () => {
    if (analyser && !activeAudio.paused) drawVisualizer();
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