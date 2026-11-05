/* CloudTune multi-device playback handoff.
 * The API synchronizes metadata and position only; signed media URLs stay local.
 */
(() => {
    "use strict";

    const banner = document.getElementById("device-handoff-banner");
    const titleElement = document.getElementById("device-handoff-title");
    const descriptionElement = document.getElementById("device-handoff-description");
    const resumeButton = document.getElementById("device-handoff-resume");
    const dismissButton = document.getElementById("device-handoff-dismiss");
    if (!banner || !titleElement || !descriptionElement || !resumeButton || !dismissButton) return;

    const DEVICE_STORAGE_KEY = "cloudtune_device_id";
    const HEARTBEAT_MS = 8000;
    const POLL_MS = 8000;

    function createDeviceId() {
        try {
            let id = localStorage.getItem(DEVICE_STORAGE_KEY);
            if (id && /^[A-Za-z0-9_-]{12,64}$/.test(id)) return id;

            id = window.crypto && typeof window.crypto.randomUUID === "function"
                ? window.crypto.randomUUID()
                : "ct-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 14);
            localStorage.setItem(DEVICE_STORAGE_KEY, id);
            return id;
        } catch (_) {
            return "ct-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 14);
        }
    }

    function detectDeviceName() {
        const ua = navigator.userAgent || "";
        if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return "iPad";
        if (/iPhone|iPod/i.test(ua)) return "iPhone";
        if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? "Android phone" : "Android tablet";
        return "Desktop browser";
    }

    const deviceId = createDeviceId();
    const deviceName = detectDeviceName();
    let knownRemoteState = null;
    let dismissedVersion = null;
    let pollInFlight = false;
    let heartbeatInFlight = false;
    let resumeInFlight = false;
    let lastHeartbeatAt = 0;
    let started = false;
    let trackAwaitingSuccessfulStart = false;
    let suppressPauseHeartbeatUntil = 0;

    function player() {
        return window.CloudTunePlayer || null;
    }

    function isAuthenticated() {
        return Boolean(window.CloudTuneAuth && window.CloudTuneAuth.isAuthenticated?.());
    }

    function apiUrl() {
        return player()?.getApiUrl?.() || "";
    }

    function formatTime(value) {
        const seconds = Math.max(0, Math.floor(Number(value) || 0));
        return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
    }

    function showRemoteState(state) {
        if (!state || state.device_id === deviceId) {
            banner.hidden = true;
            knownRemoteState = null;
            return;
        }

        knownRemoteState = state;
        if (dismissedVersion === state.version) {
            banner.hidden = true;
            return;
        }

        const song = state.song || {};
        titleElement.textContent = song.title
            ? "Continue “" + song.title + "” here?"
            : "Your music is active on another device";
        const artist = song.artist ? " — " + song.artist : "";
        const source = state.device_name || "another device";
        const position = formatTime(state.position_seconds);
        descriptionElement.textContent =
            source + " · " + (song.title || "Saved track") + artist + " · " + position;
        const localSongs = player()?.getSongs?.() || [];
        const availableHere = localSongs.some(item => String(item.id) === String(song.id));
        resumeButton.disabled = !availableHere || resumeInFlight;
        resumeButton.textContent = availableHere ? "CONTINUE HERE ↗" : "TRACK NOT IN LIBRARY";
        banner.hidden = false;
    }

    async function request(path, options = {}) {
        const response = await fetch(apiUrl() + path, {
            ...options,
            credentials: "include",
            cache: "no-store",
            headers: {
                ...(options.body ? { "Content-Type": "application/json" } : {}),
                ...(player()?.getAuthHeaders?.() || {}),
                ...(options.headers || {}),
            },
        });
        let data = null;
        try {
            data = await response.json();
        } catch (_) {
            data = null;
        }
        if (response.status === 401) {
            window.dispatchEvent(new Event("cloudtune:auth-expired"));
            throw new Error("Your CloudTune session has expired.");
        }
        if (!response.ok) {
            const detail = data && data.detail;
            const error = new Error(
                typeof detail === "string"
                    ? detail
                    : (detail && detail.message) || "Playback sync failed (" + response.status + ")"
            );
            error.status = response.status;
            error.payload = data;
            throw error;
        }
        return data;
    }

    async function pollState() {
        if (!isAuthenticated() || pollInFlight) return;
        pollInFlight = true;
        try {
            const state = await request("/api/playback/state");
            if (!state || state.device_id === deviceId) {
                showRemoteState(null);
                return;
            }

            const audio = player()?.getAudioElement?.();
            if (audio && !audio.paused) audio.pause();
            showRemoteState(state);
        } catch (error) {
            if (error.status !== 401 && error.status !== 404) {
                console.warn("CloudTune device sync could not read playback state:", error);
            }
        } finally {
            pollInFlight = false;
        }
    }

    async function sendHeartbeat() {
        if (!isAuthenticated() || heartbeatInFlight) return;
        const api = player();
        const song = api?.getCurrentSong?.();
        const audio = api?.getAudioElement?.();
        if (!song || !audio || (trackAwaitingSuccessfulStart && audio.paused)) return;

        heartbeatInFlight = true;
        const now = Date.now();
        lastHeartbeatAt = now;
        try {
            await request("/api/playback/state", {
                method: "PUT",
                body: JSON.stringify({
                    device_id: deviceId,
                    device_name: deviceName,
                    song_id: Number(song.id),
                    position_seconds: Math.max(0, Number(audio.currentTime) || 0),
                    duration_seconds: Number.isFinite(audio.duration) ? audio.duration : null,
                    is_playing: !audio.paused && !audio.ended,
                }),
            });
            if (knownRemoteState) showRemoteState(null);
        } catch (error) {
            if (error.status === 409) {
                if (!audio.paused) audio.pause();
                await pollState();
            } else if (error.status !== 401) {
                console.warn("CloudTune device sync heartbeat failed:", error);
            }
        } finally {
            heartbeatInFlight = false;
        }
    }

    async function continueHere() {
        if (resumeInFlight || !knownRemoteState || !isAuthenticated()) return;
        const state = knownRemoteState;
        const songId = state.song && state.song.id;
        const api = player();
        if (!songId || typeof api?.playSongFrom !== "function") {
            descriptionElement.textContent = "This track is not available in your current library.";
            return;
        }

        resumeInFlight = true;
        resumeButton.disabled = true;
        resumeButton.textContent = "CONNECTING…";
        try {
            await request("/api/playback/state/claim", {
                method: "POST",
                body: JSON.stringify({
                    device_id: deviceId,
                    device_name: deviceName,
                    expected_version: state.version,
                }),
            });

            // playSongFrom asks the API for a fresh signed URL. We never transfer
            // a private storage URL between devices or save one in localStorage.
            await api.playSongFrom(songId, state.position_seconds);
            dismissedVersion = null;
            knownRemoteState = null;
            banner.hidden = true;
            await sendHeartbeat();
        } catch (error) {
            descriptionElement.textContent = error.message || "Could not continue playback here.";
            if (error.status === 409) await pollState();
            else resumeButton.disabled = false;
        } finally {
            resumeInFlight = false;
            if (!banner.hidden) resumeButton.disabled = !knownRemoteState;
        }
    }

    function start() {
        if (started) return;
        started = true;
        void pollState();
        window.setInterval(() => {
            void pollState();
            if (Date.now() - lastHeartbeatAt >= HEARTBEAT_MS) void sendHeartbeat();
        }, POLL_MS);
    }

    resumeButton.addEventListener("click", continueHere);
    dismissButton.addEventListener("click", () => {
        if (knownRemoteState) dismissedVersion = knownRemoteState.version;
        banner.hidden = true;
    });

    window.addEventListener("cloudtune:login-success", () => {
        banner.hidden = true;
        knownRemoteState = null;
        dismissedVersion = null;
        start();
        void pollState();
    });
    window.addEventListener("cloudtune:auth-expired", () => {
        banner.hidden = true;
        knownRemoteState = null;
    });

    const audio = document.getElementById("audio-player");
    if (audio) {
        audio.addEventListener("play", () => {
            trackAwaitingSuccessfulStart = false;
            void sendHeartbeat();
        });
        audio.addEventListener("pause", () => {
            if (isAuthenticated() && Date.now() >= suppressPauseHeartbeatUntil) {
                void sendHeartbeat();
            }
        });
        audio.addEventListener("ended", () => void sendHeartbeat());
        audio.addEventListener("timeupdate", () => {
            if (Date.now() - lastHeartbeatAt >= HEARTBEAT_MS) void sendHeartbeat();
        });
    }
    window.addEventListener("cloudtune:track-change", () => {
        // playSong() emits this before pausing the previous source and loading
        // the new signed URL. Do not save the old track's time under the new ID.
        trackAwaitingSuccessfulStart = true;
        suppressPauseHeartbeatUntil = Date.now() + 3000;
    });
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden && isAuthenticated()) {
            void pollState();
            void sendHeartbeat();
        }
    });
    window.addEventListener("pagehide", () => {
        // Best-effort final heartbeat; browsers may terminate this request.
        if (isAuthenticated()) void sendHeartbeat();
    });

    if (isAuthenticated()) start();
})();
