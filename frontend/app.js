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
let playbackRequestId = 0;
const streamUrlCache = new Map();
const STREAM_URL_CACHE_MS = 55 * 60 * 1000;
const nextStreamPreloader = new Audio();
nextStreamPreloader.preload = "auto";
let preloadedSongId = null;

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
    if (songs.length < 2 || currentSongIndex !== index) return;

    const nextIndex = (index + 1) % songs.length;
    const nextSong = songs[nextIndex];
    try {
        const url = await getStreamUrl(nextSong);
        // Don't replace the preloader if playback changed while this request ran.
        if (currentSongIndex !== index) return;
        nextStreamPreloader.pause();
        nextStreamPreloader.src = url;
        nextStreamPreloader.load();
        preloadedSongId = String(nextSong.id);
    } catch (error) {
        // Prefetch is opportunistic; playback can still request the URL on demand.
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
    const song = songs[index];
    playPauseButton.textContent = "⏳ Loading...";

    try {
        const url = await getStreamUrl(song);
        // Ignore slow responses from a track the user has already skipped away from.
        if (requestId !== playbackRequestId) return;

        currentSongIndex = index;
        currentSongTime = 0;
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

        audioPlayer.src = url;
        audioPlayer.load();
        await audioPlayer.play();

        if (requestId !== playbackRequestId) return;
        playPauseButton.textContent = "⏸️ Pause";
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
   PLAYER KEYBOARD SHORTCUTS
   Space: play/pause · J/L: seek 10s · arrows: volume
   ============================================================ */

document.addEventListener("keydown", event => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    if (musicApp.style.display === "none") return;

    const target = event.target;
    const typing = target instanceof HTMLElement &&
        (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
    if (typing) return;

    if (event.code === "Space") {
        event.preventDefault();
        playPauseButton.click();
    } else if (event.key.toLowerCase() === "j" || event.key === "ArrowLeft") {
        event.preventDefault();
        if (Number.isFinite(audioPlayer.duration)) {
            audioPlayer.currentTime = Math.max(0, audioPlayer.currentTime - 10);
        }
    } else if (event.key.toLowerCase() === "l" || event.key === "ArrowRight") {
        event.preventDefault();
        if (Number.isFinite(audioPlayer.duration)) {
            audioPlayer.currentTime = Math.min(audioPlayer.duration, audioPlayer.currentTime + 10);
        }
    } else if (event.key === "ArrowUp") {
        event.preventDefault();
        audioPlayer.volume = Math.min(1, audioPlayer.volume + 0.05);
    } else if (event.key === "ArrowDown") {
        event.preventDefault();
        audioPlayer.volume = Math.max(0, audioPlayer.volume - 0.05);
    }
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