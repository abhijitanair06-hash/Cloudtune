/* CloudTune Now Playing + Karaoke.
 * Lyrics are fetched only when the user asks and belong to their provider.
 */
(() => {
    const dialog = document.getElementById("now-playing-dialog");
    const openButton = document.getElementById("player-now-playing-button");
    const closeButton = document.getElementById("now-playing-close");
    const title = document.getElementById("karaoke-track-title");
    const artist = document.getElementById("karaoke-track-artist");
    const cover = document.getElementById("karaoke-cover");
    const coverPlaceholder = document.getElementById("karaoke-cover-placeholder");
    const stage = document.getElementById("karaoke-stage");
    const status = document.getElementById("karaoke-status");
    const sourceLink = document.getElementById("karaoke-source-link");
    const loadButton = document.getElementById("karaoke-load-lyrics");
    const smallerButton = document.getElementById("karaoke-font-smaller");
    const largerButton = document.getElementById("karaoke-font-larger");
    const playButton = document.getElementById("karaoke-play-pause");
    const previousButton = document.getElementById("karaoke-previous");
    const nextButton = document.getElementById("karaoke-next");
    const seek = document.getElementById("karaoke-seek");
    const currentTime = document.getElementById("karaoke-current-time");
    const duration = document.getElementById("karaoke-duration");

    let lyricsLines = [];
    let activeLineIndex = -1;
    let activeSongId = null;
    let requestCounter = 0;
    let lyricFontSize = 25;
    let usingSyncedLyrics = false;

    function player() {
        return window.CloudTunePlayer || null;
    }

    function currentSong() {
        return player()?.getCurrentSong?.() || null;
    }

    function audio() {
        return player()?.getAudioElement?.() || null;
    }

    function message(text, kind = "") {
        if (!status) return;
        status.textContent = text;
        status.classList.remove("is-error", "is-success");
        if (kind === "error") status.classList.add("is-error");
        if (kind === "success") status.classList.add("is-success");
    }

    function formatTime(value) {
        const seconds = Math.max(0, Math.floor(Number(value) || 0));
        return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    }

    function showCurrentSong() {
        const song = currentSong();
        if (!song) {
            title.textContent = "Nothing Playing";
            artist.textContent = "Select a track from your library";
            cover.removeAttribute("src");
            cover.hidden = true;
            coverPlaceholder.hidden = false;
            return;
        }

        title.textContent = song.title || "Untitled Track";
        artist.textContent = song.artist || "Unknown Artist";
        if (song.cover_url && /^https?:\/\//i.test(song.cover_url)) {
            cover.src = song.cover_url;
            cover.hidden = false;
            coverPlaceholder.hidden = true;
        } else {
            cover.removeAttribute("src");
            cover.hidden = true;
            coverPlaceholder.hidden = false;
        }
        activeSongId = String(song.id);
        updateTimeControls();
    }

    function parseLrc(text) {
        const lines = [];
        const timestampPattern = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

        for (const rawLine of String(text || "").split(/\r?\n/)) {
            const matches = [...rawLine.matchAll(timestampPattern)];
            const lyricText = rawLine.replace(timestampPattern, "").trim();
            if (!lyricText) continue;

            for (const match of matches) {
                const fraction = match[3] || "0";
                const milliseconds = Number(fraction.padEnd(3, "0").slice(0, 3));
                const seconds = Number(match[1]) * 60 + Number(match[2]) + milliseconds / 1000;
                lines.push({ time: seconds, text: lyricText });
            }
            // Handle plain lines without timestamp tags (from plainLyrics).
            if (!matches.length && !/^\[[a-z]+:/i.test(rawLine.trim())) {
                lines.push({ time: null, text: lyricText });
            }
        }

        return lines.sort((a, b) => {
            if (a.time === null) return 1;
            if (b.time === null) return -1;
            return a.time - b.time;
        });
    }

    function renderLyrics(lines, synced) {
        lyricsLines = lines;
        usingSyncedLyrics = Boolean(synced);
        activeLineIndex = -1;
        stage.replaceChildren();

        if (!lines.length) {
            const empty = document.createElement("p");
            empty.className = "karaoke-placeholder-line";
            empty.textContent = "No lyrics were available for this recording.";
            stage.appendChild(empty);
            return;
        }

        lines.forEach((line, index) => {
            const element = document.createElement("p");
            element.className = "karaoke-line";
            element.dataset.lyricIndex = String(index);
            element.textContent = line.text;
            stage.appendChild(element);
        });

        if (!synced) {
            const note = document.createElement("p");
            note.className = "karaoke-unsynced-note";
            note.textContent = "These lyrics are not time-synced. Highlighting is available when LRCLIB has timed lyrics.";
            stage.prepend(note);
        } else {
            updateActiveLine();
        }
    }

    function updateActiveLine() {
        if (!usingSyncedLyrics || !lyricsLines.length) return;
        const media = audio();
        if (!media) return;

        let nextIndex = -1;
        const playhead = Math.max(0, media.currentTime || 0);
        for (let index = 0; index < lyricsLines.length; index += 1) {
            if (lyricsLines[index].time !== null && lyricsLines[index].time <= playhead) {
                nextIndex = index;
            } else if (lyricsLines[index].time !== null && lyricsLines[index].time > playhead) {
                break;
            }
        }
        if (nextIndex === activeLineIndex) return;

        const previous = stage.querySelector(".karaoke-line.is-active");
        if (previous) previous.classList.remove("is-active");
        activeLineIndex = nextIndex;

        if (nextIndex >= 0) {
            const next = stage.querySelector(`[data-lyric-index="${nextIndex}"]`);
            if (next) {
                next.classList.add("is-active");
                next.scrollIntoView({ behavior: "smooth", block: "center" });
            }
        }
    }

    async function loadLyricsForCurrentSong({ force = false } = {}) {
        const song = currentSong();
        if (!song) {
            message("Play or select one of your songs first.", "error");
            return;
        }
        if (!force && activeSongId === String(song.id) && lyricsLines.length) {
            updateActiveLine();
            return;
        }

        const api = player();
        if (!api) {
            message("CloudTune's player is not ready yet. Refresh the page.", "error");
            return;
        }

        const requestId = ++requestCounter;
        activeSongId = String(song.id);
        if (loadButton) {
            loadButton.disabled = true;
            loadButton.textContent = "LOOKING UP LYRICS…";
        }
        message("Looking for timed lyrics…");
        stage.replaceChildren();
        const pending = document.createElement("p");
        pending.className = "karaoke-placeholder-line";
        pending.textContent = "Checking LRCLIB for this song.";
        stage.appendChild(pending);

        try {
            const media = audio();
            const params = new URLSearchParams();
            if (media && Number.isFinite(media.duration) && media.duration > 0) {
                params.set("duration", String(Math.round(media.duration)));
            }
            const query = params.toString() ? `?${params}` : "";
            const response = await fetch(
                `${api.getApiUrl()}/api/lyrics/${encodeURIComponent(song.id)}${query}`,
                { headers: api.getAuthHeaders(), credentials: "include" }
            );
            let data = {};
            try { data = await response.json(); } catch { /* handled below */ }
            if (requestId !== requestCounter) return;
            if (!response.ok) throw new Error(data.detail || `Lyrics request failed (${response.status})`);

            let lines = parseLrc(data.synced_lyrics || "");
            const hasSynced = Boolean(data.has_synced_lyrics && lines.some(line => line.time !== null));
            if (!hasSynced) lines = parseLrc(data.plain_lyrics || "");

            if (!lines.length) throw new Error("The provider returned an empty lyrics record.");
            renderLyrics(lines, hasSynced);
            sourceLink.href = /^https:\/\//i.test(data.source_url || "") ? data.source_url : "https://lrclib.net/";
            sourceLink.textContent = "LRCLIB";
            message(
                hasSynced
                    ? "Timed lyrics loaded. The current line follows playback."
                    : "Plain lyrics loaded; this recording has no timing data.",
                "success"
            );
        } catch (error) {
            if (requestId !== requestCounter) return;
            stage.replaceChildren();
            const empty = document.createElement("p");
            empty.className = "karaoke-placeholder-line";
            empty.textContent = "Lyrics could not be loaded.";
            stage.appendChild(empty);
            message(error.message || "Could not load lyrics. Try again later.", "error");
        } finally {
            if (requestId === requestCounter && loadButton) {
                loadButton.disabled = false;
                loadButton.textContent = "↻ RELOAD LYRICS";
            }
        }
    }

    function updateTimeControls() {
        const media = audio();
        if (!media) return;
        const total = Number.isFinite(media.duration) ? media.duration : 0;
        seek.max = String(total);
        seek.disabled = total <= 0;
        seek.value = String(Math.min(media.currentTime || 0, total || 0));
        currentTime.textContent = formatTime(media.currentTime);
        duration.textContent = formatTime(total);
        playButton.textContent = media.paused ? "▶" : "Ⅱ";
        playButton.setAttribute("aria-label", media.paused ? "Play" : "Pause");
    }

    if (openButton && dialog) {
        openButton.addEventListener("click", () => {
            if (!dialog.open && typeof dialog.showModal === "function") dialog.showModal();
            else dialog.setAttribute("open", "");
            showCurrentSong();
            const song = currentSong();
            if (song && String(song.id) !== activeSongId) {
                lyricsLines = [];
                renderLyrics([], false);
            }
            if (song) void loadLyricsForCurrentSong({ force: true });
        });
    }

    if (closeButton && dialog) closeButton.addEventListener("click", () => {
        if (typeof dialog.close === "function" && dialog.open) dialog.close();
        else dialog.removeAttribute("open");
    });

    if (loadButton) loadButton.addEventListener("click", () => void loadLyricsForCurrentSong({ force: true }));

    if (playButton) playButton.addEventListener("click", () => {
        const api = player();
        if (api) void api.togglePlay().catch(error => message(error.message || "Could not start playback.", "error"));
    });
    if (previousButton) previousButton.addEventListener("click", () => player()?.previous?.());
    if (nextButton) nextButton.addEventListener("click", () => player()?.next?.());

    if (seek) seek.addEventListener("input", () => {
        const media = audio();
        if (!media || !Number.isFinite(media.duration)) return;
        media.currentTime = Math.min(media.duration, Math.max(0, Number(seek.value) || 0));
        updateTimeControls();
        updateActiveLine();
    });

    if (smallerButton) smallerButton.addEventListener("click", () => {
        lyricFontSize = Math.max(16, lyricFontSize - 2);
        stage.style.setProperty("--karaoke-font-size", `${lyricFontSize}px`);
    });
    if (largerButton) largerButton.addEventListener("click", () => {
        lyricFontSize = Math.min(48, lyricFontSize + 2);
        stage.style.setProperty("--karaoke-font-size", `${lyricFontSize}px`);
    });

    window.addEventListener("cloudtune:track-change", () => {
        showCurrentSong();
        lyricsLines = [];
        activeLineIndex = -1;
        activeSongId = String(currentSong()?.id || "");
        renderLyrics([], false);
        if (dialog?.open && currentSong()) void loadLyricsForCurrentSong({ force: true });
    });

    const media = audio();
    if (media) {
        media.addEventListener("timeupdate", () => {
            updateTimeControls();
            updateActiveLine();
        });
        media.addEventListener("durationchange", updateTimeControls);
        media.addEventListener("play", updateTimeControls);
        media.addEventListener("pause", updateTimeControls);
        media.addEventListener("loadedmetadata", updateTimeControls);
    }
})();
