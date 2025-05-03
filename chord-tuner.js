// chord-tuner.js
import { detect } from 'https://cdn.skypack.dev/@tonaljs/chord?min';
window.detect = detect;

const notesElem = document.getElementById("notes");
const chordElem = document.getElementById("chord");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const fileInput = document.getElementById("fileInput");

let audioCtx, analyser, stream, animationId;



// semitone to note names
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

startBtn.addEventListener("click", () => startChordRecognizer('mic'));
stopBtn.addEventListener("click", stopChordRecognizer);
fileInput.addEventListener("change", () => startChordRecognizer('file'));

async function startChordRecognizer(sourceType) {
    stopChordRecognizer();                  // clear any prior run
    notesElem.textContent = "🎵 Notes: --";
    chordElem.textContent = "🎶 Chord: --";

    audioCtx = new AudioContext();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 4096;

    if (sourceType === 'mic') {
        // Microphone input
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch {
            chordElem.textContent = "❌ Mic access denied.";
            return;
        }
        const micSource = audioCtx.createMediaStreamSource(stream);
        micSource.connect(analyser);

    } else if (sourceType === 'file' && fileInput.files.length > 0) {
        // File input
        const file = fileInput.files[0];
        const arrayBuffer = await file.arrayBuffer();
        let buffer;
        try {
            buffer = await audioCtx.decodeAudioData(arrayBuffer);
        } catch {
            chordElem.textContent = "❌ Failed to decode file.";
            return;
        }
        const bufferSource = audioCtx.createBufferSource();
        bufferSource.buffer = buffer;
        bufferSource.connect(analyser);
        analyser.connect(audioCtx.destination); // silent playback
        bufferSource.start();
    } else {
        return;
    }

    const freqData = new Float32Array(analyser.frequencyBinCount);

    // analysis loop
    (function detectLoop() {
        analyser.getFloatFrequencyData(freqData);
        const freqs = extractFundamentals(freqData, audioCtx.sampleRate, analyser.fftSize);

        if (freqs.length === 0) {
            notesElem.textContent = "🎵 Notes: --";
            chordElem.textContent = "🎶 Chord: --";
        } else {
            const notes = freqs.map(frequencyToNote);
            notesElem.textContent = `🎵 Notes: ${notes.join(", ")}`;

            if (notes.length === 1) {
                chordElem.textContent = `🎶 Note: ${notes[0]}`;
            } else {
                const chordNames = detect(notes);
                chordElem.textContent = `🎶 Chord: ${chordNames[0] || "Unknown"}`;
            }
        }
        animationId = requestAnimationFrame(detectLoop);
    })();
}

function stopChordRecognizer() {
    if (animationId) cancelAnimationFrame(animationId);
    if (stream) stream.getTracks().forEach(t => t.stop());
    if (audioCtx) audioCtx.close();
    audioCtx = stream = animationId = null;
}

// pick strongest fundamentals, skip harmonics
function extractFundamentals(data, sampleRate, fftSize) {
    const threshold = -50; // only peaks louder than -50 dB
    const maxFreq = 1500;
    const peaks = [];

    for (let i = 1; i < data.length - 1; i++) {
        if (
            data[i] > threshold &&
            data[i] > data[i - 1] &&
            data[i] > data[i + 1]
        ) {
            const freq = i * (sampleRate / fftSize);
            if (freq < maxFreq) peaks.push({ freq, amp: data[i] });
        }
    }

    peaks.sort((a, b) => b.amp - a.amp);

    const fundamentals = [];
    const isHarmonic = (f, base) => {
        const r = f / base;
        return [2, 3, 4].some(n => Math.abs(r - n) < 0.03);
    };

    for (let { freq } of peaks) {
        if (fundamentals.length >= 3) break;
        if (!fundamentals.some(f0 => isHarmonic(freq, f0))) {
            fundamentals.push(freq);
        }
    }
    return fundamentals;
}

function frequencyToNote(freq) {
    const A4 = 440;
    const midi = Math.round(12 * Math.log2(freq / A4) + 69);
    return NOTE_NAMES[midi % 12];
}
