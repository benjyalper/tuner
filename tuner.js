const noteElem = document.getElementById('note');
const freqElem = document.getElementById('freq');
const tuningElem = document.getElementById('tuning');

async function startTuner() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    const buffer = new Float32Array(analyser.fftSize);

    function update() {
        analyser.getFloatTimeDomainData(buffer);
        const freq = autoCorrelate(buffer, audioCtx.sampleRate);
        if (freq > 0) {
            const note = frequencyToNote(freq);
            const standardFreq = noteToFrequency(note);
            const cents = getCentsOff(freq, standardFreq);

            noteElem.innerText = `🎵 Note: ${note}`;
            freqElem.innerText = `📡 Frequency: ${freq.toFixed(2)} Hz`;
            tuningElem.innerText = `📍 Status: ${getTuningStatus(cents)}`;
        } else {
            noteElem.innerText = "🎵 Note: --";
            freqElem.innerText = "📡 Frequency: -- Hz";
            tuningElem.innerText = "📍 Status: --";
        }
        requestAnimationFrame(update);
    }

    update();
}

function autoCorrelate(buf, sampleRate) {
    let SIZE = buf.length;
    let rms = 0;
    for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / SIZE);
    if (rms < 0.01) return -1; // too quiet

    let r1 = 0, r2 = SIZE - 1, threshold = 0.2;
    while (buf[r1] < threshold && r1 < SIZE / 2) r1++;
    while (buf[r2] < threshold && r2 > SIZE / 2) r2--;
    buf = buf.slice(r1, r2);
    SIZE = buf.length;

    let c = new Array(SIZE).fill(0);
    for (let i = 0; i < SIZE; i++)
        for (let j = 0; j < SIZE - i; j++)
            c[i] = c[i] + buf[j] * buf[j + i];

    let d = 0;
    while (c[d] > c[d + 1]) d++;
    let maxval = -1, maxpos = -1;
    for (let i = d; i < SIZE; i++) {
        if (c[i] > maxval) {
            maxval = c[i];
            maxpos = i;
        }
    }

    let T0 = maxpos;
    return sampleRate / T0;
}

function frequencyToNote(freq) {
    const A4 = 440;
    const semitone = 12 * (Math.log2(freq / A4));
    const noteIndex = Math.round(semitone) + 69;
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const name = noteNames[noteIndex % 12];
    const octave = Math.floor(noteIndex / 12) - 1;
    return `${name}${octave}`;
}

function noteToFrequency(note) {
    const A4 = 440;
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const regex = /^([A-G]#?)(-?\d)$/;
    const [, name, octaveStr] = note.match(regex);
    const semitoneIndex = noteNames.indexOf(name);
    const midi = semitoneIndex + (parseInt(octaveStr) + 1) * 12;
    return A4 * Math.pow(2, (midi - 69) / 12);
}

function getCentsOff(freq, refFreq) {
    return 1200 * Math.log2(freq / refFreq);
}

function getTuningStatus(cents) {
    if (Math.abs(cents) < 5) return "In tune ✅";
    if (cents < 0) return "Flat ⬇️";
    return "Sharp ⬆️";
}
