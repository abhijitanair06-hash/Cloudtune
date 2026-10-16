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

const playerSeek =
    document.getElementById("player-seek");
const playerCurrentTime =
    document.getElementById("player-current-time");
const playerDuration =
    document.getElementById("player-duration");

const playerShuffleButton = document.getElementById("player-shuffle-button");
const playerRepeatButton = document.getElementById("player-repeat-button");
const playerQueueToggle = document.getElementById("player-queue-toggle");
const playerQueueCount = document.getElementById("player-queue-count");
const playerQueuePanel = document.getElementById("player-queue-panel");
const playerQueueList = document.getElementById("player-queue-list");
const playerQueueStatus = document.getElementById("player-queue-status");
const playerQueueClear = document.getElementById("player-queue-clear");
const playerQueueSave = document.getElementById("player-queue-save");
const playerQueueClose = document.getElementById("player-queue-close");
const playerVolume = document.getElementById("player-volume");
const playerMuteButton = document.getElementById("player-mute-button");
const playerSpeed = document.getElementById("player-speed");
const playerSleepTimerButton = document.getElementById("player-sleep-timer-button");


function cloudTuneFormatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const total = Math.floor(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const remainder = total % 60;
    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
    }
    return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function updatePlayerTimeline(previewSeconds) {
    if (!playerSeek || !playerCurrentTime || !playerDuration) return;

    const duration = Number.isFinite(audioPlayer.duration) ? audioPlayer.duration : 0;
    const rawTime = Number.isFinite(previewSeconds)
        ? previewSeconds
        : ((isSeekingPlayer || isPlayerSeekPending)
            ? requestedPlayerSeekTime
            : audioPlayer.currentTime);
    const current = Number.isFinite(rawTime) && rawTime >= 0 ? rawTime : 0;
    const safeCurrent = duration > 0 ? Math.min(current, duration) : 0;
    const percent = duration > 0 ? (safeCurrent / duration) * 100 : 0;

    playerSeek.max = String(duration);
    if (!isSeekingPlayer || Number.isFinite(previewSeconds)) {
        playerSeek.value = String(safeCurrent);
    }
    playerSeek.disabled = duration <= 0;
    playerSeek.style.setProperty("--seek-progress", `${percent}%`);
    playerCurrentTime.textContent = cloudTuneFormatTime(safeCurrent);
    playerDuration.textContent = cloudTuneFormatTime(duration);
}

function waitForTrackMetadata(requestId, startAtSeconds, signal) {
    return new Promise((resolve, reject) => {
        let settled = false;
        let cancelWait = null;

        const cleanup = () => {
            audioPlayer.removeEventListener("loadedmetadata", onLoaded);
            audioPlayer.removeEventListener("error", onError);
            signal.removeEventListener("abort", onAbort);
            if (metadataWaitCancel === cancelWait) metadataWaitCancel = null;
        };

        const finish = error => {
            if (settled) return;
            settled = true;
            cleanup();
            if (error) reject(error);
            else resolve();
        };

        const onLoaded = () => {
            if (requestId !== playSongRequestId) {
                finish(new DOMException("Track request was superseded", "AbortError"));
                return;
            }

            try {
                const duration = Number.isFinite(audioPlayer.duration) ? audioPlayer.duration : 0;
                if (startAtSeconds > 0 && duration > 0) {
                    audioPlayer.currentTime = Math.min(
                        Math.max(0, startAtSeconds),
                        Math.max(0, duration - 0.1)
                    );
                }
                updatePlayerTimeline();
                finish();
            } catch (error) {
                finish(error);
            }
        };

        const onError = () => finish(new Error("The selected song could not load."));
        const onAbort = () => finish(new DOMException("Track request was cancelled", "AbortError"));
        cancelWait = () => onAbort();
        metadataWaitCancel = cancelWait;

        audioPlayer.addEventListener("loadedmetadata", onLoaded);
        audioPlayer.addEventListener("error", onError);
        signal.addEventListener("abort", onAbort, { once: true });

        // Covers fast cached files whose metadata arrived before our listener.
        if (audioPlayer.readyState >= 1) onLoaded();
    });
}

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
let playbackQueue = [];
let shuffleEnabled = false;
let repeatMode = "off"; // off | all | one
let playedHistory = [];
let sleepTimerHandle = null;
let sleepTimerExpiresAt = null;
let lastNonZeroVolume = 0.8;
let playerIsMuted = false;
let preloadedTrackId = null;
let preloadedStreamUrl = null;
let preloadRequestNumber = 0;
let refreshingCurrentStream = false;
let refreshedStreamForSongId = null;

const streamPreloader = new Audio();
streamPreloader.preload = "auto";
streamPreloader.volume = 0;

// A newer track request cancels stale fetch/metadata work from an older click.
let playSongRequestId = 0;
let playSongAbortController = null;
let metadataWaitCancel = null;
let isSeekingPlayer = false;
let isPlayerSeekPending = false;
let requestedPlayerSeekTime = 0;


function cloudTuneQueueItemId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
        return window.crypto.randomUUID();
    }
    return `q-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function cloudTunePersistPlayerState() {
    try {
        localStorage.setItem("cloudtune_player_state_v1", JSON.stringify({
            queue: playbackQueue.map(item => String(item.songId)),
            shuffleEnabled,
            repeatMode,
            volume: lastNonZeroVolume,
            muted: playerIsMuted,
            speed: Number(audioPlayer.playbackRate) || 1,
            history: playedHistory.slice(-40),
        }));
    } catch (error) {
        console.warn("Could not persist playback state:", error);
    }
}

function cloudTuneRestorePlayerState() {
    try {
        const raw = localStorage.getItem("cloudtune_player_state_v1");
        const saved = raw ? JSON.parse(raw) : {};
        playbackQueue = Array.isArray(saved.queue)
            ? saved.queue
                .map(songId => ({ id: cloudTuneQueueItemId(), songId: String(songId) }))
                .filter(item => songs.some(song => String(song.id) === item.songId))
            : [];
        shuffleEnabled = Boolean(saved.shuffleEnabled);
        repeatMode = ["off", "all", "one"].includes(saved.repeatMode) ? saved.repeatMode : "off";
        playedHistory = Array.isArray(saved.history) ? saved.history.map(String).slice(-40) : [];

        const volume = Number(saved.volume);
        if (Number.isFinite(volume)) lastNonZeroVolume = Math.max(0, Math.min(1, volume));
        playerIsMuted = Boolean(saved.muted);
        audioPlayer.volume = lastNonZeroVolume;
        audioPlayer.muted = playerIsMuted;

        const speed = Number(saved.speed);
        if ([0.75, 1, 1.25, 1.5, 2].includes(speed)) audioPlayer.playbackRate = speed;
    } catch (error) {
        console.warn("Ignoring invalid saved player state:", error);
        playbackQueue = [];
        shuffleEnabled = false;
        repeatMode = "off";
        playedHistory = [];
    }

    cloudTuneUpdatePlayerControls();
    cloudTuneRenderQueue();
    cloudTuneRenderUpNext();
}

function cloudTuneUpdatePlayerControls() {
    if (playerShuffleButton) {
        playerShuffleButton.textContent = shuffleEnabled ? "SHUFFLE ON" : "SHUFFLE";
        playerShuffleButton.setAttribute("aria-pressed", String(shuffleEnabled));
        playerShuffleButton.title = shuffleEnabled ? "Turn shuffle off" : "Turn shuffle on";
    }
    if (playerRepeatButton) {
        const labels = { off: "REPEAT OFF", all: "REPEAT ALL", one: "REPEAT ONE" };
        playerRepeatButton.textContent = labels[repeatMode] || labels.off;
        playerRepeatButton.setAttribute("aria-pressed", String(repeatMode !== "off"));
        playerRepeatButton.title = `Repeat mode: ${repeatMode}`;
    }
    if (playerQueueCount) playerQueueCount.textContent = String(playbackQueue.length);
    if (playerMuteButton) {
        playerMuteButton.textContent = playerIsMuted ? "UNMUTE" : "MUTE";
        playerMuteButton.setAttribute("aria-pressed", String(playerIsMuted));
        playerMuteButton.title = playerIsMuted ? "Restore volume" : "Mute volume";
    }
    if (playerVolume) playerVolume.value = String(lastNonZeroVolume);
    if (playerSpeed) playerSpeed.value = String(Number(audioPlayer.playbackRate) || 1);
    if (playerSleepTimerButton) {
        playerSleepTimerButton.textContent = sleepTimerHandle
            ? `SLEEP ${Math.max(1, Math.ceil((sleepTimerExpiresAt - Date.now()) / 60000))}m`
            : "SLEEP";
    }
}

function cloudTuneSetQueueMessage(message, kind = "") {
    if (!playerQueueStatus) return;
    playerQueueStatus.textContent = message;
    playerQueueStatus.classList.remove("is-error", "is-success");
    if (kind === "error") playerQueueStatus.classList.add("is-error");
    if (kind === "success") playerQueueStatus.classList.add("is-success");
}

function cloudTuneAddToQueue(songId, playNext = false) {
    const song = songs.find(item => String(item.id) === String(songId));
    if (!song) return;
    const item = { id: cloudTuneQueueItemId(), songId: String(song.id) };
    if (playNext) playbackQueue.unshift(item);
    else playbackQueue.push(item);
    cloudTunePersistPlayerState();
    cloudTuneRenderQueue();
    cloudTuneRenderUpNext();
    cloudTuneSetQueueMessage(`${song.title || "Track"} ${playNext ? "will play next" : "added to queue"}.`, "success");
}

function cloudTuneRemoveQueueItem(queueItemId) {
    playbackQueue = playbackQueue.filter(item => item.id !== queueItemId);
    cloudTunePersistPlayerState();
    cloudTuneRenderQueue();
    cloudTuneRenderUpNext();
    cloudTuneSetQueueMessage("Queue updated.");
}

function cloudTuneMoveQueueItem(sourceId, targetId) {
    const sourceIndex = playbackQueue.findIndex(item => item.id === sourceId);
    const targetIndex = playbackQueue.findIndex(item => item.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;
    const [item] = playbackQueue.splice(sourceIndex, 1);
    playbackQueue.splice(targetIndex, 0, item);
    cloudTunePersistPlayerState();
    cloudTuneRenderQueue();
    cloudTuneRenderUpNext();
}

function cloudTuneClearQueue() {
    playbackQueue = [];
    cloudTunePersistPlayerState();
    cloudTuneRenderQueue();
    cloudTuneRenderUpNext();
    cloudTuneSetQueueMessage("Queue cleared.");
}

function cloudTuneRenderQueue() {
    if (!playerQueueList) return;
    playerQueueList.replaceChildren();
    if (!playbackQueue.length) {
        const empty = document.createElement("li");
        empty.className = "empty-state";
        empty.textContent = "Your queue is empty. Use NEXT or QUEUE + on any track.";
        playerQueueList.appendChild(empty);
    }

    playbackQueue.forEach(item => {
        const song = songs.find(track => String(track.id) === item.songId);
        if (!song) return;

        const row = document.createElement("li");
        row.className = "player-queue-item";
        row.draggable = true;
        row.dataset.queueId = item.id;

        const drag = document.createElement("span");
        drag.className = "player-queue-drag";
        drag.textContent = "⋮⋮";
        drag.setAttribute("aria-hidden", "true");

        const details = document.createElement("div");
        details.className = "player-queue-song";
        const title = document.createElement("strong");
        title.textContent = song.title || "Untitled Track";
        const artist = document.createElement("small");
        artist.textContent = song.artist || "Unknown Artist";
        details.append(title, artist);

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "player-queue-remove";
        remove.textContent = "REMOVE";
        remove.setAttribute("aria-label", `Remove ${song.title || "track"} from queue`);
        remove.addEventListener("click", () => cloudTuneRemoveQueueItem(item.id));

        row.addEventListener("dragstart", event => {
            row.classList.add("is-dragging");
            event.dataTransfer?.setData("text/plain", item.id);
            if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
        });
        row.addEventListener("dragend", () => row.classList.remove("is-dragging"));
        row.addEventListener("dragover", event => {
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        });
        row.addEventListener("drop", event => {
            event.preventDefault();
            const sourceId = event.dataTransfer?.getData("text/plain");
            if (sourceId) cloudTuneMoveQueueItem(sourceId, item.id);
        });

        row.append(drag, details, remove);
        playerQueueList.appendChild(row);
    });

    cloudTuneUpdatePlayerControls();
}

async function cloudTuneSaveQueueAsPlaylist() {
    const songIds = [...new Set(playbackQueue.map(item => String(item.songId)))];
    if (!songIds.length) {
        cloudTuneSetQueueMessage("Add tracks to the queue before saving a playlist.", "error");
        return;
    }
    const name = window.prompt("Name this playlist:", "Queue mix");
    if (!name || !name.trim()) return;

    if (playerQueueSave) playerQueueSave.disabled = true;
    cloudTuneSetQueueMessage("Creating playlist and adding queued tracks…");
    try {
        const playlist = await intelligenceRequest("/api/library/playlists", {
            method: "POST",
            body: JSON.stringify({ name: name.trim() }),
        });
        for (const songId of songIds) {
            await intelligenceRequest(`/api/library/playlists/${playlist.id}/tracks/${encodeURIComponent(songId)}`, {
                method: "PUT",
            });
        }
        cloudTuneSetQueueMessage(`Saved queue as “${playlist.name}”.`, "success");
        cloudTuneRenderPlaylists();
    } catch (error) {
        cloudTuneSetQueueMessage(`Could not save playlist: ${error.message}`, "error");
    } finally {
        if (playerQueueSave) playerQueueSave.disabled = false;
    }
}

function cloudTuneGetNextSongIndex({ automatic = false, consumeQueue = false } = {}) {
    if (!songs.length) return -1;
    if (automatic && repeatMode === "one" && currentSongIndex >= 0) return currentSongIndex;

    const queuedIndex = playbackQueue.findIndex(item =>
        songs.some(song => String(song.id) === item.songId)
    );
    if (queuedIndex >= 0) {
        const queuedItem = playbackQueue[queuedIndex];
        const songIndex = songs.findIndex(song => String(song.id) === queuedItem.songId);
        if (consumeQueue) {
            playbackQueue.splice(queuedIndex, 1);
            cloudTunePersistPlayerState();
            cloudTuneRenderQueue();
            cloudTuneRenderUpNext();
        }
        return songIndex;
    }

    if (shuffleEnabled) {
        const choices = songs.map((song, index) => index).filter(index => index !== currentSongIndex);
        if (!choices.length) return repeatMode === "all" ? currentSongIndex : -1;
        return choices[Math.floor(Math.random() * choices.length)];
    }
    if (currentSongIndex < songs.length - 1) return currentSongIndex + 1;
    return repeatMode === "all" ? 0 : -1;
}

function cloudTuneUpdateMediaSession(song) {
    if (!("mediaSession" in navigator) || typeof MediaMetadata === "undefined") return;
    try {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: song.title || "Untitled Track",
            artist: song.artist || "Unknown Artist",
            album: song.album || "CloudTune",
            artwork: song.cover_url ? [{ src: song.cover_url, sizes: "512x512", type: "image/jpeg" }] : [],
        });
        const actions = {
            play: () => audioPlayer.play().catch(() => undefined),
            pause: () => audioPlayer.pause(),
            previoustrack: () => cloudTuneHandlePrevious(),
            nexttrack: () => cloudTuneHandleNext(false),
            seekbackward: details => { audioPlayer.currentTime = Math.max(0, audioPlayer.currentTime - (details.seekOffset || 10)); },
            seekforward: details => { audioPlayer.currentTime = Math.min(audioPlayer.duration || Infinity, audioPlayer.currentTime + (details.seekOffset || 10)); },
        };
        for (const [action, handler] of Object.entries(actions)) {
            try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* Unsupported action. */ }
        }
    } catch (error) {
        console.warn("Could not update lock-screen metadata:", error);
    }
}

async function cloudTuneGetSignedStreamUrl(song) {
    if (preloadedTrackId === String(song.id) && preloadedStreamUrl) {
        const cachedUrl = preloadedStreamUrl;
        preloadedTrackId = null;
        preloadedStreamUrl = null;
        return cachedUrl;
    }
    const response = await fetch(`${API_URL}/api/songs/${song.id}/stream`, {
        headers: authHeaders(),
    });
    let data = {};
    try { data = await response.json(); } catch { /* handled below */ }
    if (!response.ok) throw new Error(data.detail || `Could not get streaming URL (${response.status})`);
    if (!data.stream_url) throw new Error("The streaming URL was empty.");
    return data.stream_url;
}

async function cloudTunePreloadNextTrack() {
    const requestNumber = ++preloadRequestNumber;
    const nextIndex = repeatMode === "one"
        ? currentSongIndex
        : cloudTuneGetNextSongIndex({ automatic: false, consumeQueue: false });
    if (nextIndex < 0 || !songs[nextIndex]) return;
    const song = songs[nextIndex];
    if (String(song.id) === String(currentSongIndex >= 0 ? songs[currentSongIndex]?.id : "")) {
        if (repeatMode !== "one") return;
    }
    if (preloadedTrackId === String(song.id) && preloadedStreamUrl) return;
    try {
        const response = await fetch(`${API_URL}/api/songs/${song.id}/stream`, {
            headers: authHeaders(),
        });
        let data = {};
        try { data = await response.json(); } catch { /* handled below */ }
        if (!response.ok || !data.stream_url || requestNumber !== preloadRequestNumber) return;
        preloadedTrackId = String(song.id);
        preloadedStreamUrl = data.stream_url;
        streamPreloader.src = data.stream_url;
        streamPreloader.load();
    } catch (error) {
        console.warn("Next track could not be preloaded:", error);
    }
}

async function cloudTuneHandleNext(automatic = false) {
    const nextIndex = cloudTuneGetNextSongIndex({ automatic, consumeQueue: true });
    if (nextIndex < 0) {
        if (automatic) {
            audioPlayer.pause();
            currentSongTime = 0;
            cloudTunePersistPlayerState();
        }
        return;
    }
    await playSong(nextIndex, 0);
}

async function cloudTuneHandlePrevious() {
    if (currentSongIndex < 0 || !songs.length) return;
    if (audioPlayer.currentTime > 3) {
        await playSong(currentSongIndex, 0);
        return;
    }
    const previousId = playedHistory.pop();
    let index = previousId
        ? songs.findIndex(song => String(song.id) === String(previousId))
        : -1;
    if (index < 0 && currentSongIndex > 0) index = currentSongIndex - 1;
    if (index < 0 && repeatMode === "all") index = songs.length - 1;
    if (index < 0) index = currentSongIndex;
    await playSong(index, 0);
}

if (playerShuffleButton) {
    playerShuffleButton.addEventListener("click", () => {
        shuffleEnabled = !shuffleEnabled;
        cloudTuneUpdatePlayerControls();
        cloudTunePersistPlayerState();
        void cloudTunePreloadNextTrack();
    });
}
if (playerRepeatButton) {
    playerRepeatButton.addEventListener("click", () => {
        repeatMode = ({ off: "all", all: "one", one: "off" })[repeatMode] || "off";
        cloudTuneUpdatePlayerControls();
        cloudTunePersistPlayerState();
        void cloudTunePreloadNextTrack();
    });
}
if (playerQueueToggle && playerQueuePanel) {
    playerQueueToggle.addEventListener("click", () => {
        playerQueuePanel.hidden = !playerQueuePanel.hidden;
        playerQueueToggle.setAttribute("aria-expanded", String(!playerQueuePanel.hidden));
        if (!playerQueuePanel.hidden) cloudTuneRenderQueue();
    });
}
if (playerQueueClose && playerQueuePanel) {
    playerQueueClose.addEventListener("click", () => {
        playerQueuePanel.hidden = true;
        playerQueueToggle?.setAttribute("aria-expanded", "false");
    });
}
if (playerQueueClear) playerQueueClear.addEventListener("click", cloudTuneClearQueue);
if (playerQueueSave) playerQueueSave.addEventListener("click", () => void cloudTuneSaveQueueAsPlaylist());

if (playerVolume) {
    playerVolume.addEventListener("input", () => {
        lastNonZeroVolume = Math.max(0, Math.min(1, Number(playerVolume.value) || 0));
        playerIsMuted = false;
        audioPlayer.muted = false;
        audioPlayer.volume = lastNonZeroVolume;
        cloudTuneUpdatePlayerControls();
        cloudTunePersistPlayerState();
    });
}
if (playerMuteButton) {
    playerMuteButton.addEventListener("click", () => {
        if (playerIsMuted) {
            playerIsMuted = false;
            audioPlayer.muted = false;
            audioPlayer.volume = lastNonZeroVolume;
        } else {
            if (audioPlayer.volume > 0) lastNonZeroVolume = audioPlayer.volume;
            playerIsMuted = true;
            audioPlayer.muted = true;
        }
        cloudTuneUpdatePlayerControls();
        cloudTunePersistPlayerState();
    });
}
if (playerSpeed) {
    playerSpeed.addEventListener("change", () => {
        const speed = Number(playerSpeed.value);
        if ([0.75, 1, 1.25, 1.5, 2].includes(speed)) {
            audioPlayer.playbackRate = speed;
            cloudTunePersistPlayerState();
        }
    });
}
if (playerSleepTimerButton) {
    playerSleepTimerButton.addEventListener("click", () => {
        if (sleepTimerHandle) {
            clearTimeout(sleepTimerHandle);
            sleepTimerHandle = null;
            sleepTimerExpiresAt = null;
            cloudTuneUpdatePlayerControls();
            cloudTuneSetQueueMessage("Sleep timer cancelled.");
            return;
        }
        const raw = window.prompt("Stop playback after how many minutes? Enter 0 to cancel.");
        if (raw === null) return;
        const minutes = Number(raw);
        if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 24 * 60) {
            cloudTuneSetQueueMessage("Enter a number from 1 to 1440 minutes.", "error");
            return;
        }
        sleepTimerExpiresAt = Date.now() + minutes * 60 * 1000;
        sleepTimerHandle = setTimeout(() => {
            audioPlayer.pause();
            sleepTimerHandle = null;
            sleepTimerExpiresAt = null;
            cloudTuneUpdatePlayerControls();
            cloudTunePersistPlayerState();
            cloudTuneSetQueueMessage("Sleep timer stopped playback.");
        }, minutes * 60 * 1000);
        cloudTuneUpdatePlayerControls();
        cloudTuneSetQueueMessage(`Sleep timer set for ${minutes} minute(s).`, "success");
    });
}

window.addEventListener("keydown", event => {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable='true']")) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;

    const key = event.key.toLowerCase();
    if (event.code === "Space") {
        event.preventDefault();
        if (audioPlayer.paused) audioPlayer.play().catch(() => undefined);
        else audioPlayer.pause();
    } else if (key === "arrowright") {
        event.preventDefault();
        if (Number.isFinite(audioPlayer.duration)) {
            audioPlayer.currentTime = Math.min(audioPlayer.duration, audioPlayer.currentTime + 5);
        }
    } else if (key === "arrowleft") {
        event.preventDefault();
        audioPlayer.currentTime = Math.max(0, audioPlayer.currentTime - 5);
    } else if (key === "n") {
        event.preventDefault();
        void cloudTuneHandleNext(false);
    } else if (key === "p") {
        event.preventDefault();
        void cloudTuneHandlePrevious();
    } else if (key === "m") {
        event.preventDefault();
        playerMuteButton?.click();
    } else if (key === "s") {
        event.preventDefault();
        playerShuffleButton?.click();
    } else if (key === "r") {
        event.preventDefault();
        playerRepeatButton?.click();
    }
});

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
        window.dispatchEvent(new Event("cloudtune:login-success"));

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
    loadSongs({ restorePlayback: true });
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

async function loadSongs({ restorePlayback = false } = {}) {
    const previousSongId = currentSongIndex >= 0 ? songs[currentSongIndex]?.id : null;
    try {
        const response = await fetch(`${API_URL}/api/songs/`, {
            headers: {
                Authorization: `Bearer ${localStorage.getItem("cloudtune_token") || ""}`,
            },
        });
        let data = {};
        try { data = await response.json(); } catch { /* handled below */ }
        if (!response.ok) throw new Error(data.detail || `Could not load songs (${response.status})`);
        songs = Array.isArray(data) ? data : [];

        if (previousSongId !== null) {
            currentSongIndex = songs.findIndex(song => String(song.id) === String(previousSongId));
            if (currentSongIndex < 0) currentSongIndex = -1;
        }

        cloudTuneRestorePlayerState();
        await cloudTuneLoadPersonalLibrary();
        displaySongs(songs);

        // Restoring playback is only needed after login/page load. Upload
        // refreshes must not reset the currently playing audio element.
        if (restorePlayback) await restoreLastSong();

        await refreshIntelligenceSongs();
        await loadPersonalRecommendations();
        window.dispatchEvent(new Event("cloudtune:library-ready"));
    } catch (error) {
        console.error("Could not load the song library:", error);
        songList.replaceChildren();
        const message = document.createElement("p");
        message.className = "empty-state";
        message.textContent = `Could not load songs: ${error.message || "Please try again."}`;
        songList.appendChild(message);
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

        updatePlayerTimeline(0);

        const response = await fetch(
            `${API_URL}/api/songs/${song.id}/stream`,
            {
                headers: {
                    Authorization: `Bearer ${localStorage.getItem("cloudtune_token") || ""}`,
                },
            }
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
            "▶ PLAY";


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
    if (index < 0 || index >= songs.length) return;

    const requestId = ++playSongRequestId;
    if (playSongAbortController) playSongAbortController.abort();
    if (metadataWaitCancel) metadataWaitCancel();

    const controller = new AbortController();
    playSongAbortController = controller;
    const song = songs[index];
    const previousSongId = currentSongIndex >= 0 ? songs[currentSongIndex]?.id : null;
    if (previousSongId !== null && String(previousSongId) !== String(song.id)) {
        playedHistory.push(String(previousSongId));
        if (playedHistory.length > 40) playedHistory.shift();
    }
    refreshedStreamForSongId = null;
    cloudTuneCloseSessionForTrackSwitch();
    currentSongIndex = index;
    currentSongTime = 0;
    isSeekingPlayer = false;
    isPlayerSeekPending = false;
    requestedPlayerSeekTime = 0;

    // Stop the previous audio before preparing another track.
    audioPlayer.pause();
    playPauseButton.disabled = true;
    playPauseButton.textContent = "LOADING…";
    playPauseButton.setAttribute("aria-label", "Loading track");
    nowPlaying.textContent = song.title || "Untitled Track";
    nowArtist.textContent = song.artist || "Unknown Artist";

    if (song.cover_url) {
        playerCover.src = song.cover_url;
        playerCover.style.display = "block";
        playerCoverPlaceholder.style.display = "none";
    } else {
        playerCover.src = "";
        playerCover.style.display = "none";
        playerCoverPlaceholder.style.display = "block";
    }

    updatePlayerTimeline(0);

    try {
        const streamUrl = await cloudTuneGetSignedStreamUrl(song);
        if (requestId !== playSongRequestId) return;
        audioPlayer.src = streamUrl;
        audioPlayer.load();

        // Wait for this exact source's metadata before seeking or playing.
        await waitForTrackMetadata(requestId, startAtSeconds, controller.signal);
        if (requestId !== playSongRequestId) return;

        await audioPlayer.play();
        if (requestId !== playSongRequestId) return;
        await cloudTuneStartListeningSession(song.id);
        cloudTuneUpdateMediaSession(song);
        cloudTunePersistPlayerState();
        void cloudTunePreloadNextTrack();
    } catch (error) {
        // Older requests are expected to be cancelled when the user skips quickly.
        if (requestId !== playSongRequestId || error.name === "AbortError") return;

        console.error("Playback failed:", error);
        nowPlaying.textContent = "Playback failed";
        nowArtist.textContent = error.message || "Please try the track again.";
        playPauseButton.textContent = "▶ PLAY";
        playPauseButton.setAttribute("aria-label", "Play");
    } finally {
        if (requestId === playSongRequestId) {
            playPauseButton.disabled = false;
            playPauseButton.textContent = audioPlayer.paused ? "▶ PLAY" : "Ⅱ PAUSE";
            playPauseButton.setAttribute("aria-label", audioPlayer.paused ? "Play" : "Pause");
            playPauseButton.title = audioPlayer.paused ? "Resume playback" : "Pause playback";
            updatePlayerTimeline();
            if (playSongAbortController === controller) playSongAbortController = null;
        }
    }
}


/* ============================================================
   PLAY / PAUSE
   ============================================================ */

playPauseButton.addEventListener("click", async () => {
    if (playPauseButton.disabled) return;

    if (!audioPlayer.src) {
        if (songs.length > 0) await playSong(Math.max(0, currentSongIndex));
        return;
    }

    try {
        if (audioPlayer.paused) await audioPlayer.play();
        else audioPlayer.pause();
    } catch (error) {
        console.error("Play/pause failed:", error);
        playPauseButton.textContent = "▶ PLAY";
        playPauseButton.setAttribute("aria-label", "Play");
    }
});


/* ============================================================
   PREVIOUS SONG
   ============================================================ */

previousButton.addEventListener("click", () => {
    void cloudTuneHandlePrevious();
});


/* ============================================================
   NEXT SONG
   ============================================================ */

nextButton.addEventListener("click", () => {
    void cloudTuneHandleNext(false);
});


/* ============================================================
   AUDIO EVENTS
   ============================================================ */

audioPlayer.addEventListener("play", () => {
    if (!playPauseButton.disabled) {
        playPauseButton.textContent = "Ⅱ PAUSE";
        playPauseButton.setAttribute("aria-label", "Pause");
        playPauseButton.title = "Pause playback";
    }
    updatePlayerTimeline();
});

audioPlayer.addEventListener("pause", () => {
    if (!playPauseButton.disabled) {
        playPauseButton.textContent = "▶ PLAY";
        playPauseButton.setAttribute("aria-label", "Play");
        playPauseButton.title = "Resume playback";
    }
    updatePlayerTimeline();
});

// Keep the custom mini-player timeline synchronized with media playback.
audioPlayer.addEventListener("loadedmetadata", () => updatePlayerTimeline());
audioPlayer.addEventListener("durationchange", () => updatePlayerTimeline());
audioPlayer.addEventListener("timeupdate", () => updatePlayerTimeline());
audioPlayer.addEventListener("seeking", () => updatePlayerTimeline());
audioPlayer.addEventListener("seeked", () => {
    isPlayerSeekPending = false;
    isSeekingPlayer = false;
    updatePlayerTimeline();
});

function seekPlayerToSliderValue() {
    if (!Number.isFinite(audioPlayer.duration) || audioPlayer.duration <= 0) {
        updatePlayerTimeline();
        return;
    }

    const requestedTime = Math.min(
        Math.max(0, Number(playerSeek.value) || 0),
        audioPlayer.duration
    );
    requestedPlayerSeekTime = requestedTime;

    try {
        // Send the seek to the media element on each input event.
        // timeupdate events keep displaying this target until seeked fires.
        if (Math.abs((audioPlayer.currentTime || 0) - requestedTime) > 0.01) {
            isPlayerSeekPending = true;
            audioPlayer.currentTime = requestedTime;
        }
        updatePlayerTimeline(requestedTime);
    } catch (error) {
        console.warn("Could not seek to that position yet:", error);
        isPlayerSeekPending = false;
        updatePlayerTimeline();
    }
}

function finishPlayerScrub() {
    isSeekingPlayer = false;
    // Keep the chosen target displayed while the browser completes its seek.
    if (isPlayerSeekPending) updatePlayerTimeline(requestedPlayerSeekTime);
    else updatePlayerTimeline();
}

playerSeek.addEventListener("pointerdown", () => {
    isSeekingPlayer = true;
    requestedPlayerSeekTime = Number(playerSeek.value) || 0;
});
playerSeek.addEventListener("keydown", () => {
    isSeekingPlayer = true;
    requestedPlayerSeekTime = Number(playerSeek.value) || 0;
});
playerSeek.addEventListener("input", seekPlayerToSliderValue);
playerSeek.addEventListener("change", finishPlayerScrub);
window.addEventListener("pointerup", () => {
    if (isSeekingPlayer) finishPlayerScrub();
});
playerSeek.addEventListener("keyup", finishPlayerScrub);


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
        cloudTuneTrackListenProgress();
    }
);


/* ============================================================
   AUTO NEXT SONG
   ============================================================ */

audioPlayer.addEventListener("ended", async () => {
    cloudTuneCloseCurrentListenSession({ completed: true });
    await cloudTuneHandleNext(true);
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

/* ============================================================
   MOMENT SEARCH + PERSONAL DISCOVERY
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
const refreshRecommendationsButton = document.getElementById("refresh-recommendations-button");
const recommendationsMessage = document.getElementById("recommendations-message");
const recommendationsList = document.getElementById("recommendations-list");
const recommendationStats = document.getElementById("recommendation-stats");

let intelligenceSongs = [];

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

indexSongButton.addEventListener("click", indexSelectedSong);
findMomentsButton.addEventListener("click", findSimilarMoments);
useCurrentMomentButton.addEventListener("click", useCurrentPlaybackMoment);
saveMomentButton.addEventListener("click", saveSelectedMoment);
refreshRecommendationsButton.addEventListener("click", () => {
    if (typeof loadPersonalRecommendations === "function") {
        loadPersonalRecommendations();
    }
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
        songIds: Array.isArray(data.song_ids) ? data.song_ids.map(String) : [],
        listenerTracks: Array.isArray(data.listener_tracks) ? data.listener_tracks : []
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

    if (!options.addPlaylistId && !options.removePlaylistId) {
        const queueActions = document.createElement("div");
        queueActions.className = "song-queue-actions";

        const playNext = document.createElement("button");
        playNext.type = "button";
        playNext.textContent = "NEXT";
        playNext.title = "Play this track next";
        playNext.addEventListener("click", event => {
            event.stopPropagation();
            cloudTuneAddToQueue(song.id, true);
        });

        const addToQueue = document.createElement("button");
        addToQueue.type = "button";
        addToQueue.textContent = "+ QUEUE";
        addToQueue.title = "Add this track to the end of the queue";
        addToQueue.addEventListener("click", event => {
            event.stopPropagation();
            cloudTuneAddToQueue(song.id, false);
        });

        queueActions.append(playNext, addToQueue);
        copy.appendChild(queueActions);
    }

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
    const listenerFavoriteCount = Number(window.ListenerUI?.getSavedCount?.()) || 0;
    if (favoriteCount) {
        const totalFavorites = favoriteSongs.length + listenerFavoriteCount;
        favoriteCount.textContent = `${totalFavorites} TRACK${totalFavorites === 1 ? "" : "S"}`;
    }
    cloudTuneRenderUpNext();
    cloudTuneRenderPlaylists();
}

function cloudTuneRenderUpNext() {
    const container = document.getElementById("up-next-list");
    if (!container) return;
    container.replaceChildren();

    const previewItems = [];
    for (const item of playbackQueue) {
        const song = songs.find(track => String(track.id) === item.songId);
        if (song) previewItems.push({ song, queueItemId: item.id, queued: true });
        if (previewItems.length >= 3) break;
    }

    if (!previewItems.length && songs.length) {
        if (shuffleEnabled) {
            const candidates = songs
                .map((song, index) => ({ song, index }))
                .filter(item => item.index !== currentSongIndex);
            while (candidates.length && previewItems.length < 3) {
                const selected = Math.floor(Math.random() * candidates.length);
                const item = candidates.splice(selected, 1)[0];
                previewItems.push({ song: item.song, index: item.index, queued: false });
            }
        } else {
            let index = currentSongIndex >= 0 ? currentSongIndex + 1 : 0;
            while (index < songs.length && previewItems.length < 3) {
                previewItems.push({ song: songs[index], index, queued: false });
                index += 1;
            }
            if (repeatMode === "all") {
                index = 0;
                while (index < songs.length && previewItems.length < 3) {
                    if (!previewItems.some(item => String(item.song.id) === String(songs[index].id))) {
                        previewItems.push({ song: songs[index], index, queued: false });
                    }
                    index += 1;
                }
            }
        }
    }

    if (!previewItems.length) {
        const empty = document.createElement("span");
        empty.className = "muted-note";
        empty.textContent = songs.length
            ? "No tracks up next. Turn on Repeat All or add songs to the queue."
            : "Upload a track to start your queue.";
        container.appendChild(empty);
        return;
    }

    previewItems.forEach(item => {
        const song = item.song;
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
        title.textContent = `${item.queued ? "QUEUED · " : ""}${song.title || "Untitled Track"}`;
        chip.appendChild(title);
        chip.addEventListener("click", () => {
            if (item.queued) cloudTuneRemoveQueueItem(item.queueItemId);
            const index = songs.findIndex(track => String(track.id) === String(song.id));
            if (index >= 0) void playSong(index);
        });
        container.appendChild(chip);
    });
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
        const count = playlist.songIds.filter(id => validIds.has(String(id))).length + (Array.isArray(playlist.listenerTracks) ? playlist.listenerTracks.length : 0);
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
    if (typeof window.listenerRenderPlaylistTracks === "function") {
        window.listenerRenderPlaylistTracks(playlist.listenerTracks || []);
    }
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
