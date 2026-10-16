/* Local Web Audio equalizer + live spectrum analyser. */
(() => {
    const visualizerButton = document.getElementById("karaoke-visualizer-toggle");
    const canvas = document.getElementById("karaoke-visualizer");
    const status = document.getElementById("karaoke-status");
    const presetSelect = document.getElementById("eq-preset");
    const bassSlider = document.getElementById("eq-bass");
    const trebleSlider = document.getElementById("eq-treble");
    const bassValue = document.getElementById("eq-bass-value");
    const trebleValue = document.getElementById("eq-treble-value");

    const PRESETS = {
        flat: { bass: 0, mid: 0, treble: 0 },
        rock: { bass: 5, mid: 1, treble: 4 },
        pop: { bass: 3, mid: 2, treble: 2 },
        classical: { bass: 2, mid: -1, treble: 4 },
        vocal: { bass: -3, mid: 4, treble: 2 },
        custom: { bass: 0, mid: 0, treble: 0 },
    };

    let context = null;
    let sourceNode = null;
    let bassFilter = null;
    let midFilter = null;
    let trebleFilter = null;
    let analyser = null;
    let animationFrame = 0;
    let visualizerEnabled = false;
    let lastCanvasWidth = 0;
    let lastCanvasHeight = 0;

    function report(text, isError = false) {
        if (!status) return;
        status.textContent = text;
        status.classList.toggle("is-error", isError);
        if (!isError) status.classList.remove("is-success");
    }

    function getAudio() {
        return window.CloudTunePlayer?.getAudioElement?.() || null;
    }

    async function ensureAudioGraph() {
        const media = getAudio();
        if (!media) throw new Error("CloudTune's audio player is not ready.");

        if (!context) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextClass) throw new Error("This browser does not support Web Audio.");

            context = new AudioContextClass();
            sourceNode = context.createMediaElementSource(media);
            bassFilter = context.createBiquadFilter();
            bassFilter.type = "lowshelf";
            bassFilter.frequency.value = 180;

            midFilter = context.createBiquadFilter();
            midFilter.type = "peaking";
            midFilter.frequency.value = 1600;
            midFilter.Q.value = 0.8;

            trebleFilter = context.createBiquadFilter();
            trebleFilter.type = "highshelf";
            trebleFilter.frequency.value = 6000;

            analyser = context.createAnalyser();
            analyser.fftSize = 2048;
            analyser.smoothingTimeConstant = 0.78;

            sourceNode.connect(bassFilter);
            bassFilter.connect(midFilter);
            midFilter.connect(trebleFilter);
            trebleFilter.connect(analyser);
            analyser.connect(context.destination);

            // Once the element is connected to Web Audio, its sound is output
            // through this graph. The destination connection above is required.
            applyCurrentEQ();
        }

        if (context.state === "suspended") await context.resume();
        return context;
    }

    function applyGains() {
        if (!bassFilter || !midFilter || !trebleFilter) return;
        const bass = Number(bassSlider.value) || 0;
        const treble = Number(trebleSlider.value) || 0;
        const selectedPreset = PRESETS[presetSelect.value] || PRESETS.flat;

        bassFilter.gain.setTargetAtTime(bass, context.currentTime, 0.06);
        midFilter.gain.setTargetAtTime(selectedPreset.mid, context.currentTime, 0.06);
        trebleFilter.gain.setTargetAtTime(treble, context.currentTime, 0.06);

        bassValue.textContent = `${bass > 0 ? "+" : ""}${bass} dB`;
        trebleValue.textContent = `${treble > 0 ? "+" : ""}${treble} dB`;
    }

    function applyCurrentEQ() {
        if (presetSelect.value === "custom") {
            applyGains();
            return;
        }
        const preset = PRESETS[presetSelect.value] || PRESETS.flat;
        bassSlider.value = String(preset.bass);
        trebleSlider.value = String(preset.treble);
        applyGains();
    }

    async function applyEQFromControl() {
        try {
            await ensureAudioGraph();
            applyGains();
            report("Sound settings applied in this browser.");
        } catch (error) {
            report(error.message || "Could not enable sound processing.", true);
        }
    }

    function resizeCanvas() {
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;
        const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
        const width = Math.floor(rect.width * ratio);
        const height = Math.floor(rect.height * ratio);
        if (width !== lastCanvasWidth || height !== lastCanvasHeight) {
            canvas.width = width;
            canvas.height = height;
            lastCanvasWidth = width;
            lastCanvasHeight = height;
        }
        const drawContext = canvas.getContext("2d");
        drawContext.setTransform(ratio, 0, 0, ratio, 0, 0);
        return { drawContext, width: rect.width, height: rect.height };
    }

    function drawSpectrum() {
        if (!visualizerEnabled || !analyser || !canvas) return;
        const resized = resizeCanvas();
        if (!resized) {
            animationFrame = requestAnimationFrame(drawSpectrum);
            return;
        }

        const { drawContext: ctx2d, width, height } = resized;
        const spectrum = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(spectrum);

        ctx2d.clearRect(0, 0, width, height);
        const style = getComputedStyle(document.documentElement);
        const orange = style.getPropertyValue("--orange").trim() || "#ef6b37";
        const gold = style.getPropertyValue("--gold").trim() || "#d9ad41";
        const barCount = Math.min(76, Math.max(20, Math.floor(width / 8)));
        const gap = 3;
        const barWidth = Math.max(2, (width - (barCount - 1) * gap) / barCount);
        const gradient = ctx2d.createLinearGradient(0, height, 0, 0);
        gradient.addColorStop(0, orange);
        gradient.addColorStop(1, gold);
        ctx2d.fillStyle = gradient;

        for (let bar = 0; bar < barCount; bar += 1) {
            const sampleIndex = Math.floor((bar / barCount) * spectrum.length * 0.72);
            const intensity = spectrum[sampleIndex] / 255;
            const barHeight = Math.max(2, intensity * height * 0.92);
            const x = bar * (barWidth + gap);
            ctx2d.fillRect(x, height - barHeight, barWidth, barHeight);
        }

        animationFrame = requestAnimationFrame(drawSpectrum);
    }

    async function enableVisualizer() {
        try {
            await ensureAudioGraph();
            visualizerEnabled = true;
            canvas.hidden = false;
            visualizerButton.textContent = "VISUALIZER ON";
            visualizerButton.setAttribute("aria-pressed", "true");
            if (animationFrame) cancelAnimationFrame(animationFrame);
            report("Live audio spectrum enabled. Sound is processed locally.");
            drawSpectrum();
        } catch (error) {
            visualizerEnabled = false;
            canvas.hidden = true;
            visualizerButton.textContent = "VISUALIZER OFF";
            visualizerButton.setAttribute("aria-pressed", "false");
            report(error.message || "Could not enable the spectrum visualizer.", true);
        }
    }

    function disableVisualizer() {
        visualizerEnabled = false;
        if (animationFrame) cancelAnimationFrame(animationFrame);
        animationFrame = 0;
        if (canvas) canvas.hidden = true;
        if (visualizerButton) {
            visualizerButton.textContent = "VISUALIZER OFF";
            visualizerButton.setAttribute("aria-pressed", "false");
        }
        report("Visualizer hidden; current sound settings remain applied.");
    }

    if (visualizerButton) {
        visualizerButton.addEventListener("click", () => {
            if (visualizerEnabled) disableVisualizer();
            else void enableVisualizer();
        });
    }
    if (presetSelect) {
        presetSelect.addEventListener("change", () => {
            if (presetSelect.value === "custom") {
                void applyEQFromControl();
                return;
            }
            void ensureAudioGraph()
                .then(() => {
                    applyCurrentEQ();
                    report("Equalizer preset applied.");
                })
                .catch(error => report(error.message || "Could not apply EQ.", true));
        });
    }
    if (bassSlider) bassSlider.addEventListener("input", () => {
        if (presetSelect) presetSelect.value = "custom";
        void applyEQFromControl();
    });
    if (trebleSlider) trebleSlider.addEventListener("input", () => {
        if (presetSelect) presetSelect.value = "custom";
        void applyEQFromControl();
    });

    const media = getAudio();
    if (media) media.addEventListener("play", () => {
        if (context && context.state === "suspended") void context.resume();
    });
    window.addEventListener("resize", () => {
        if (visualizerEnabled) resizeCanvas();
    });
})();
