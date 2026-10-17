/* Thought Search / Mind Mix: transparent ranking, no external AI key. */
(() => {
    const queryInput = document.getElementById("thought-query");
    const moodSelect = document.getElementById("thought-mood");
    const searchButton = document.getElementById("thought-search-button");
    const status = document.getElementById("thought-search-message");
    const resultsElement = document.getElementById("thought-search-results");

    const STOP_WORDS = new Set([
        "a", "an", "the", "and", "or", "but", "for", "with", "to", "of", "on",
        "in", "at", "by", "from", "my", "your", "me", "i", "im", "it", "is",
        "are", "was", "were", "be", "that", "this", "something", "song", "track",
        "music", "maybe", "kind", "want", "find", "recommend", "play", "give",
        "like", "similar", "thinking", "head", "please", "some", "sort",
    ]);

    const MOOD_TARGETS = {
        calm: { energy: 0.22, brightness: 0.38, bass: 0.3, dynamics: 0.25 },
        sad: { energy: 0.32, brightness: 0.22, bass: 0.35, dynamics: 0.35 },
        happy: { energy: 0.68, brightness: 0.78, bass: 0.5, dynamics: 0.62 },
        energetic: { energy: 0.86, brightness: 0.72, bass: 0.82, dynamics: 0.76 },
        focus: { energy: 0.3, brightness: 0.44, bass: 0.32, dynamics: 0.28 },
        dreamy: { energy: 0.24, brightness: 0.46, bass: 0.38, dynamics: 0.22 },
        romantic: { energy: 0.36, brightness: 0.48, bass: 0.38, dynamics: 0.34 },
        dark: { energy: 0.42, brightness: 0.2, bass: 0.78, dynamics: 0.42 },
    };

    const MOOD_WORDS = [
        { mood: "calm", pattern: /\b(calm|relax|relaxing|chill|peaceful|sleep|soft|quiet|unwind|rainy|rain|gentle)\b/i },
        { mood: "sad", pattern: /\b(sad|melancholy|heartbreak|cry|lonely|blue|grief|reflective|moody)\b/i },
        { mood: "happy", pattern: /\b(happy|joyful|hopeful|bright|uplifting|sunshine|cheerful|positive)\b/i },
        { mood: "energetic", pattern: /\b(energetic|energy|workout|gym|run|running|party|dance|fast|hype|intense|powerful)\b/i },
        { mood: "focus", pattern: /\b(focus|study|studying|concentrate|concentration|work|coding|reading|productive)\b/i },
        { mood: "dreamy", pattern: /\b(dreamy|dream|ambient|floaty|ethereal|spacey|hazy|night|stars|floating)\b/i },
        { mood: "romantic", pattern: /\b(romantic|romance|love|date|intimate|tender)\b/i },
        { mood: "dark", pattern: /\b(dark|deep|bass-heavy|bass heavy|brooding|heavy bass|ominous|shadowy)\b/i },
    ];

    function normalise(value) {
        return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    }

    function tokens(value) {
        return [...new Set(normalise(value).split(/[^a-z0-9]+/).filter(word =>
            word.length > 1 && !STOP_WORDS.has(word)
        ))];
    }

    function inferMood(text) {
        for (const item of MOOD_WORDS) {
            if (item.pattern.test(text)) return item.mood;
        }
        return null;
    }

    function featureSimilarity(summary, target) {
        if (!summary || !target) return null;
        const dimensions = Object.keys(target);
        const present = dimensions.filter(key => Number.isFinite(Number(summary[key])));
        if (present.length < 3) return null;
        const error = present.reduce((sum, key) => {
            // Profiles are normalized by the audio analyzer; clamp defensive
            // values so a single bad vector cannot dominate the ranking.
            const value = Math.max(0, Math.min(1, Number(summary[key])));
            return sum + Math.abs(value - target[key]);
        }, 0) / present.length;
        return Math.max(0, 1 - error);
    }

    function metadataMatch(song, queryTokens) {
        const fields = [
            { name: "title", text: song.title, weight: 4 },
            { name: "artist", text: song.artist, weight: 3 },
            { name: "album", text: song.album, weight: 2 },
            { name: "genre", text: song.genre, weight: 4 },
        ];
        let score = 0;
        const reasons = [];
        for (const word of queryTokens) {
            const matched = fields.filter(field => tokens(field.text).includes(word));
            if (matched.length) {
                const best = matched.reduce((previous, current) =>
                    current.weight > previous.weight ? current : previous
                );
                score += best.weight;
                reasons.push(word);
            }
        }
        return { score, reasons: [...new Set(reasons)] };
    }

    function setMessage(text, kind = "") {
        status.textContent = text;
        status.classList.remove("is-error", "is-success");
        if (kind === "error") status.classList.add("is-error");
        if (kind === "success") status.classList.add("is-success");
    }

    function runThoughtSearch() {
        const discovery = window.CloudTuneDiscovery;
        if (!discovery) {
            setMessage("CloudTune's discovery tools are not ready. Refresh the page.", "error");
            return;
        }

        const text = (queryInput.value || "").trim();
        const queryTokens = tokens(text);
        const requestedMood = moodSelect.value;
        const mood = requestedMood === "auto" ? inferMood(text) : requestedMood;
        const target = mood ? MOOD_TARGETS[mood] : null;
        const useRecent = /\b(recent|recently|last night|last time|played before|heard before|nostalgia)\b/i.test(text);
        const preferUnheard = /\b(unheard|never played|new to me|rediscover|not played)\b/i.test(text);
        const preferLiked = /\b(favorite|favourite|liked|my taste|my kind)\b/i.test(text);

        if (!queryTokens.length && !mood && !useRecent && !preferUnheard && !preferLiked) {
            setMessage("Describe a sound, artist, genre, lyric fragment, mood or listening situation.", "error");
            queryInput.focus();
            return;
        }

        const songs = discovery.getSongs();
        const profileList = discovery.getIntelligenceSongs();
        const profiles = new Map(profileList.map(item => [String(item.id), item]));
        const favoriteIds = new Set(discovery.getFavoriteIds());
        const recentIds = new Set(discovery.getPlayedHistory().slice().reverse());
        const currentId = discovery.getCurrentSongId();
        if (currentId) recentIds.add(currentId);

        // If the description names a song or artist, use its indexed sound as
        // an additional clue for other tracks with similar audio features.
        const seedCandidates = songs
            .map(song => ({ song, match: metadataMatch(song, queryTokens) }))
            .sort((a, b) => b.match.score - a.match.score);
        const seed = seedCandidates[0] && seedCandidates[0].match.score > 0
            ? profiles.get(String(seedCandidates[0].song.id))
            : null;
        const seedSummary = seed && seed.summary;

        const ranked = songs.map(song => {
            const metadata = metadataMatch(song, queryTokens);
            const profile = profiles.get(String(song.id));
            let score = metadata.score;
            const reasons = [];

            if (metadata.reasons.length) reasons.push(`matched ${metadata.reasons.slice(0, 4).join(", ")}`);

            const summary = profile && profile.summary;
            if (target && summary) {
                const similarity = featureSimilarity(summary, target);
                if (similarity !== null) {
                    score += similarity * 5;
                    reasons.push(`${mood} sound profile`);
                }
            } else if (seedSummary && summary && String(song.id) !== String(seedCandidates[0].song.id)) {
                const similarity = featureSimilarity(summary, seedSummary);
                if (similarity !== null) {
                    score += similarity * 3;
                    reasons.push("similar audio profile");
                }
            }

            if (preferLiked && favoriteIds.has(String(song.id))) {
                score += 2;
                reasons.push("from your favorites");
            }
            if (useRecent && recentIds.has(String(song.id))) {
                score += 2;
                reasons.push("recently played");
            }
            if (preferUnheard && recentIds.has(String(song.id))) score -= 3;
            if (!recentIds.has(String(song.id)) && /\b(discover|something new|new music|surprise me)\b/i.test(text)) {
                score += 0.5;
                reasons.push("fresh pick");
            }

            return { ...song, _thoughtScore: score, _thoughtReason: reasons.join(" · ") };
        }).sort((a, b) => b._thoughtScore - a._thoughtScore || String(a.title).localeCompare(String(b.title)));

        const haveProfile = profileList.some(item => item.indexed && item.summary);
        if (!ranked.length) {
            discovery.renderRows(resultsElement, [], { emptyText: "Upload a few tracks to start your Mind Mix." });
            setMessage("Your library is empty. Add music first.", "error");
            return;
        }

        const meaningful = ranked.filter(item => item._thoughtScore > 0);
        const results = (meaningful.length ? meaningful : ranked).slice(0, 8);
        discovery.renderRows(resultsElement, results, {
            emptyText: "No tracks matched that description. Try another phrase.",
        });

        resultsElement.querySelectorAll(".song").forEach((row, index) => {
            const reason = document.createElement("small");
            reason.className = "thought-match-reason";
            reason.textContent = results[index]._thoughtReason ||
                (haveProfile ? "Closest available sound profile" : "No metadata match; index this track for sound-based discovery");
            const details = row.querySelector(".song-details");
            if (details) details.appendChild(reason);
        });

        if (!haveProfile && target) {
            setMessage(
                `Ranked ${results.length} tracks using names and metadata. Index songs in Moment Search for mood/sound matching.`,
                "success",
            );
        } else {
            const description = mood ? `vibe: ${mood}` : "your description";
            setMessage(`Mind Mix ranked ${results.length} tracks from your own library using ${description}, metadata, ${haveProfile ? "audio profiles" : "available details"} and selected listening clues.`, "success");
        }
    }

    if (searchButton) searchButton.addEventListener("click", runThoughtSearch);
    if (queryInput) queryInput.addEventListener("keydown", event => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            runThoughtSearch();
        }
    });
})();
