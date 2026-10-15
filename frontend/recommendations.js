/* CloudTune personal discovery: behavioural tracking + New for You feed. */

let activeListenSession = null;

function cloudTuneNewSessionKey() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
    }
    return 'ct-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
}

function cloudTuneReportListenSession(session, flags = {}) {
    if (!session) return Promise.resolve();
    session.completed = session.completed || Boolean(flags.completed);
    session.skipped = session.skipped || Boolean(flags.skipped);

    // Serial writes so a late heartbeat cannot overwrite the final session state.
    session.reportPromise = (session.reportPromise || Promise.resolve())
        .catch(() => undefined)
        .then(async () => {
            if (session.startPromise) await session.startPromise;
            if (!session.persisted) return;
            return intelligenceRequest('/api/recommendations/listening/' + encodeURIComponent(session.key), {
                method: 'PUT',
                body: JSON.stringify({
                    listened_seconds: Number(session.listenedSeconds.toFixed(2)),
                    last_position_seconds: Number(session.lastPositionSeconds.toFixed(2)),
                    completed: session.completed,
                    skipped: session.skipped
                })
            });
        })
        .catch(error => console.warn('Could not save listening progress:', error));

    return session.reportPromise;
}

async function cloudTuneStartListeningSession(songId) {
    const session = {
        key: cloudTuneNewSessionKey(),
        songId: Number(songId),
        listenedSeconds: 0,
        lastPositionSeconds: Number(audioPlayer.currentTime) || 0,
        lastMediaTime: Number(audioPlayer.currentTime) || 0,
        lastReportAt: Date.now(),
        completed: false,
        skipped: false,
        persisted: false,
        reportPromise: Promise.resolve(),
        startPromise: null
    };
    activeListenSession = session;

    session.startPromise = intelligenceRequest('/api/recommendations/listening/start', {
        method: 'POST',
        body: JSON.stringify({ session_key: session.key, song_id: session.songId })
    }).then(result => {
        session.persisted = true;
        if (activeListenSession === session) void loadPersonalRecommendations();
        return result;
    }).catch(error => {
        session.persisted = false;
        console.warn('Could not start listening history session:', error);
    });

    await session.startPromise;
}

function cloudTuneTrackListenProgress() {
    const session = activeListenSession;
    if (!session || audioPlayer.ended) return;
    if (String(songs[currentSongIndex]?.id) !== String(session.songId)) return;

    const currentTime = Number(audioPlayer.currentTime) || 0;
    const previousTime = Number(session.lastMediaTime) || 0;
    if (!audioPlayer.paused && !audioPlayer.seeking) {
        const elapsed = currentTime - previousTime;
        // A large jump is a seek, not listened time.
        if (elapsed > 0 && elapsed <= 8) session.listenedSeconds += elapsed;
    }
    session.lastMediaTime = currentTime;
    session.lastPositionSeconds = currentTime;

    if (Date.now() - session.lastReportAt >= 12000) {
        session.lastReportAt = Date.now();
        void cloudTuneReportListenSession(session);
    }
}

function cloudTuneCloseCurrentListenSession(flags = {}) {
    const session = activeListenSession;
    if (!session) return;
    session.lastPositionSeconds = Number(audioPlayer.currentTime) || session.lastPositionSeconds;
    const saved = cloudTuneReportListenSession(session, flags);
    activeListenSession = null;
    void saved.then(() => loadPersonalRecommendations());
}

function cloudTuneCloseSessionForTrackSwitch() {
    const session = activeListenSession;
    if (!session) return;
    const duration = Number.isFinite(audioPlayer.duration) ? audioPlayer.duration : 0;
    const progress = duration > 0 ? audioPlayer.currentTime / duration : 0;
    const skipped = !audioPlayer.ended && session.listenedSeconds >= 3 && duration > 0 && progress < 0.5;
    cloudTuneCloseCurrentListenSession({ skipped: skipped });
}

function cloudTuneReportPausedListen() {
    const session = activeListenSession;
    if (!session) return;
    session.lastMediaTime = Number(audioPlayer.currentTime) || 0;
    session.lastPositionSeconds = session.lastMediaTime;
    void cloudTuneReportListenSession(session);
}

function renderPersonalRecommendations(data) {
    recommendationsList.replaceChildren();
    const stats = data.stats || {};
    recommendationStats.replaceChildren();

    [
        [stats.heard_tracks || 0, 'TRACKS HEARD'],
        [stats.repeat_plays || 0, 'REPLAYS'],
        [stats.completed_plays || 0, 'FINISHES'],
        [stats.skipped_plays || 0, 'SKIPS']
    ].forEach(([number, label]) => {
        const chip = document.createElement('span');
        chip.className = 'recommendation-stat';
        const value = document.createElement('strong');
        value.textContent = String(number);
        const text = document.createElement('small');
        text.textContent = label;
        chip.append(value, text);
        recommendationStats.appendChild(chip);
    });

    if (!data.recommendations || !data.recommendations.length) {
        const empty = document.createElement('p');
        empty.className = 'empty-state discovery-empty';
        empty.textContent = data.message || 'No unheard tracks are available right now.';
        recommendationsList.appendChild(empty);
        return;
    }

    data.recommendations.forEach((track, index) => {
        const card = document.createElement('article');
        card.className = 'discovery-card';
        const art = document.createElement('div');
        art.className = 'discovery-art';
        const inPlayerLibrary = songs.find(song => String(song.id) === String(track.id));
        if (inPlayerLibrary && inPlayerLibrary.cover_url) {
            const image = document.createElement('img');
            image.src = inPlayerLibrary.cover_url;
            image.alt = '';
            image.loading = 'lazy';
            art.appendChild(image);
        } else {
            const mark = document.createElement('span');
            mark.className = 'discovery-art-mark';
            mark.textContent = '◉';
            art.appendChild(mark);
        }
        const rank = document.createElement('span');
        rank.className = 'discovery-rank';
        rank.textContent = String(index + 1).padStart(2, '0');
        art.appendChild(rank);
        card.appendChild(art);

        const details = document.createElement('div');
        details.className = 'discovery-details';
        const title = document.createElement('h3');
        title.textContent = track.title || 'Untitled track';
        const artist = document.createElement('p');
        artist.className = 'discovery-artist';
        artist.textContent = track.artist || 'Unknown artist';
        const reason = document.createElement('p');
        reason.className = 'discovery-reason';
        reason.textContent = track.reason || 'An unheard track from the cloud catalogue.';
        const meta = document.createElement('small');
        meta.className = 'discovery-meta';
        const cloudPlays = Number(track.cloud_play_count) || 0;
        meta.textContent = cloudPlays > 0 ? cloudPlays + ' CLOUD PLAY' + (cloudPlays === 1 ? '' : 'S') : 'NEW TO YOUR LISTENING HISTORY';
        details.append(title, artist, reason, meta);
        card.appendChild(details);

        const actions = document.createElement('div');
        actions.className = 'discovery-actions';
        const play = document.createElement('button');
        play.type = 'button';
        play.className = 'discovery-play';
        play.textContent = '▷ PLAY';
        play.addEventListener('click', async () => {
            const songIndex = songs.findIndex(song => String(song.id) === String(track.id));
            if (songIndex < 0) {
                setFeatureMessage(recommendationsMessage, 'This track is not available in the loaded cloud catalogue.', 'error');
                return;
            }
            await playSong(songIndex);
        });

        const favorite = document.createElement('button');
        favorite.type = 'button';
        favorite.className = 'discovery-save';
        favorite.textContent = '♡ SAVE';
        favorite.addEventListener('click', async () => {
            favorite.disabled = true;
            try {
                await intelligenceRequest('/api/library/favorites/' + encodeURIComponent(track.id), { method: 'PUT' });
                cloudTuneFavorites.add(String(track.id));
                setFeatureMessage(recommendationsMessage, 'Saved “' + track.title + '” to Favorites.', 'success');
                displaySongs(cloudTuneVisibleSongs.length ? cloudTuneVisibleSongs : songs);
                cloudTuneRenderPlaylistDetail();
                await loadPersonalRecommendations();
            } catch (error) {
                setFeatureMessage(recommendationsMessage, 'Could not save favorite: ' + error.message, 'error');
            } finally {
                favorite.disabled = false;
            }
        });

        actions.append(play, favorite);
        card.appendChild(actions);
        recommendationsList.appendChild(card);
    });
}

async function loadPersonalRecommendations() {
    if (!localStorage.getItem('cloudtune_token')) return;
    refreshRecommendationsButton.disabled = true;
    setFeatureMessage(recommendationsMessage, 'Learning from your listening history and finding unheard tracks…');
    try {
        const data = await intelligenceRequest('/api/recommendations/for-you?limit=12');
        renderPersonalRecommendations(data);
        setFeatureMessage(recommendationsMessage, data.message || '');
    } catch (error) {
        console.error('Could not load personal recommendations:', error);
        setFeatureMessage(recommendationsMessage, 'Could not load recommendations: ' + error.message, 'error');
    } finally {
        refreshRecommendationsButton.disabled = false;
    }
}

// Wire playback events to the listening history that the home feed learns from.
audioPlayer.addEventListener('play', () => {
    if (activeListenSession) activeListenSession.lastMediaTime = Number(audioPlayer.currentTime) || 0;
});

audioPlayer.addEventListener('pause', () => {
    cloudTuneReportPausedListen();
});

window.addEventListener('pagehide', () => {
    if (activeListenSession) void cloudTuneReportListenSession(activeListenSession);
});
