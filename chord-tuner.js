// chord-tuner.js
import { detect } from 'https://cdn.skypack.dev/@tonaljs/chord?min';
import {
    Renderer,
    Stave,
    StaveNote,
    Formatter,
    Accidental
} from 'https://cdn.jsdelivr.net/npm/vexflow@4.2.5/build/esm/entry/vexflow.js?module';

const notesEl = document.getElementById("notes");
const chordEl = document.getElementById("chord");
const notationEl = document.getElementById("notation");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const fileInput = document.getElementById("fileInput");
const replayBtn = document.getElementById("replayBtn");

let audioCtx, analyser, stream, animationId;
let audioBuffer, fileSourceNode;
let lastChord = null;
const chordHistory = [];  // { keys: [...], start: t, end: t }

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BPM = 120;
const beatSec = 60 / BPM;

// UI event bindings
startBtn.addEventListener("click", () => startChordRecognizer('mic'));
stopBtn.addEventListener("click", stopChordRecognizer);
fileInput.addEventListener("change", () => startChordRecognizer('file'));
replayBtn.addEventListener("click", replayFile);

async function startChordRecognizer(sourceType) {
    // reset
    stopChordRecognizer();
    notesEl.textContent = "🎵 Notes: --";
    chordEl.textContent = "🎶 Chord: --";
    lastChord = null;
    chordHistory.length = 0;
    replayBtn.disabled = true;
    notationEl.innerHTML = "";

    // setup audio
    audioCtx = new AudioContext();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 4096;

    if (sourceType === 'mic') {
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            audioCtx.createMediaStreamSource(stream).connect(analyser);
        } catch {
            chordEl.textContent = "❌ Mic access denied.";
            return;
        }
    } else if (fileInput.files.length) {
        const buf = await fileInput.files[0].arrayBuffer();
        try {
            audioBuffer = await audioCtx.decodeAudioData(buf);
        } catch {
            chordEl.textContent = "❌ Failed to decode file.";
            return;
        }
        replayBtn.disabled = false;
        playBufferThroughAnalyser();
    } else {
        return;
    }

    const freqData = new Float32Array(analyser.frequencyBinCount);

    (function detectLoop() {
        analyser.getFloatFrequencyData(freqData);
        const freqs = extractFundamentals(freqData, audioCtx.sampleRate, analyser.fftSize);

        if (freqs.length > 0) {
            const keys = freqs.map(f => frequencyToKey(f));
            const pcs = keys.map(k => k.split('/')[0].toUpperCase());

            notesEl.textContent = `🎵 Notes: ${keys.join(", ")}`;

            let chordName = null;
            if (pcs.length === 1) {
                chordEl.textContent = `🎶 Note: ${pcs[0]}`;
            } else {
                const detected = detect(pcs);
                chordName = detected[0] || "Unknown";
                chordEl.textContent = `🎶 Chord: ${chordName}`;
            }

            // record on change
            const now = audioCtx.currentTime;
            if (chordName && chordName !== lastChord) {
                if (lastChord !== null) {
                    chordHistory[chordHistory.length - 1].end = now;
                }
                chordHistory.push({ keys, start: now, end: null });
                lastChord = chordName;
                renderNotation(chordHistory);
            }
        }

        animationId = requestAnimationFrame(detectLoop);
    })();
}

function stopChordRecognizer() {
    if (animationId) cancelAnimationFrame(animationId);
    if (stream) stream.getTracks().forEach(t => t.stop());
    if (fileSourceNode) fileSourceNode.stop();
    if (audioCtx) audioCtx.close();
    audioCtx = stream = animationId = fileSourceNode = null;
    replayBtn.disabled = true;
}

function playBufferThroughAnalyser() {
    if (!audioBuffer) return;
    if (fileSourceNode) fileSourceNode.stop();

    fileSourceNode = audioCtx.createBufferSource();
    fileSourceNode.buffer = audioBuffer;
    fileSourceNode.connect(analyser);
    analyser.connect(audioCtx.destination);
    fileSourceNode.start();
}

function replayFile() {
    playBufferThroughAnalyser();
}

function extractFundamentals(data, sr, size) {
    const threshold = -40, maxFreq = 1500;
    const peaks = [];
    for (let i = 1; i < data.length - 1; i++) {
        if (data[i] > threshold && data[i] > data[i - 1] && data[i] > data[i + 1]) {
            const f = i * (sr / size);
            if (f < maxFreq) peaks.push({ f, amp: data[i] });
        }
    }
    peaks.sort((a, b) => b.amp - a.amp);
    const fund = [];
    const isHarm = (f, b) => [2, 3, 4].some(n => Math.abs(f / b - n) < 0.03);
    for (const p of peaks) {
        if (fund.length >= 3) break;
        if (!fund.some(b => isHarm(p.f, b))) fund.push(p.f);
    }
    return fund;
}

function frequencyToKey(freq) {
    const midi = Math.round(12 * Math.log2(freq / 440) + 69);
    const pc = NOTE_NAMES[midi % 12].toLowerCase();
    const oct = Math.floor(midi / 12) - 1;
    return `${pc}/${oct}`;
}

function getDurationSymbol(beats) {
    const mapping = [
        { beats: 4, sym: 'w' },
        { beats: 2, sym: 'h' },
        { beats: 1.5, sym: 'qd' },
        { beats: 1, sym: 'q' },
        { beats: 0.666, sym: '8t' },
        { beats: 0.5, sym: '8' },
        { beats: 0.25, sym: '16' }
    ];
    let best = mapping[0], minDiff = Math.abs(beats - best.beats);
    for (const m of mapping) {
        const d = Math.abs(beats - m.beats);
        if (d < minDiff) {
            minDiff = d;
            best = m;
        }
    }
    return best.sym;
}

function chunkArray(arr, size) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
    }
    return chunks;
}

// Draw all chords in history with wrapping staves
function renderNotation(history) {
    // finalize last chord's end time
    const last = history[history.length - 1];
    if (last.end === null) last.end = audioCtx.currentTime;

    notationEl.innerHTML = "";

    // measure how many notes per line
    const containerWidth = notationEl.clientWidth || window.innerWidth;
    const noteSpacing = 80;
    const maxPerStave = Math.floor((containerWidth - 20) / noteSpacing);
    const lines = chunkArray(history, maxPerStave);

    // layout constants
    const staveSpacing = 120; // px between top of each stave
    const topMargin = 20;
    const bottomMargin = 20;
    const svgHeight = lines.length * staveSpacing + bottomMargin;

    // one SVG for all lines
    const renderer = new Renderer(notationEl, Renderer.Backends.SVG);
    renderer.resize(containerWidth, svgHeight);
    const ctx = renderer.getContext();

    lines.forEach((lineHistory, lineIndex) => {
        const y = topMargin + lineIndex * staveSpacing;
        const staveWidth = Math.min(containerWidth - 20, lineHistory.length * noteSpacing);

        // draw stave
        const stave = new Stave(10, y, staveWidth);
        stave.addClef("treble").setContext(ctx).draw();

        // build notes
        const vfNotes = lineHistory.map(entry => {
            const durBeats = (entry.end - entry.start) / beatSec;
            const sym = getDurationSymbol(durBeats);
            const note = new StaveNote({
                clef: "treble",
                keys: entry.keys,
                duration: sym
            });
            entry.keys.forEach((k, i) => {
                if (k.includes("#")) note.addModifier(new Accidental("#"), i);
            });
            return note;
        });

        // format & draw notes on this stave
        Formatter.FormatAndDraw(ctx, stave, vfNotes);
    });
}

