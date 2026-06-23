(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const els = {
    bpm: $('bpm'),
    beatsPerBar: $('beatsPerBar'),
    tapTempo: $('tapTempo'),
    countIn: $('countIn'),
    metronome: $('metronome'),
    instrument: $('instrument'),
    accidentals: $('accidentals'),
    a4: $('a4'),
    pitchTolerance: $('pitchTolerance'),
    rhythmMode: $('rhythmMode'),
    quantize: $('quantize'),
    recordBtn: $('recordBtn'),
    pauseBtn: $('pauseBtn'),
    stopBtn: $('stopBtn'),
    status: $('status'),
    writtenNote: $('writtenNote'),
    concertNote: $('concertNote'),
    needle: $('needle'),
    centsText: $('centsText'),
    bars: $('bars'),
    plainText: $('plainText'),
    copyText: $('copyText'),
    downloadJson: $('downloadJson'),
    downloadAudio: $('downloadAudio'),
    debugToggle: $('debugToggle'),
    debugPanel: $('debugPanel'),
    debugOutput: $('debugOutput'),
    copyReport: $('copyReport'),
    clearDebug: $('clearDebug'),
  };

  const noteNames = {
    sharps: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'],
    flats: ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'],
  };

  const state = {
    audioContext: null,
    analyser: null,
    stream: null,
    mediaRecorder: null,
    chunks: [],
    audioBlob: null,
    isRecording: false,
    isPaused: false,
    recordStart: 0,
    pauseStart: 0,
    pausedTotal: 0,
    pitchFrames: [],
    lastPitchAt: 0,
    tapTimes: [],
    lastAnalysis: null,
    metronomeTimer: null,
    sessionId: null,
  };

  function settings() {
    return {
      bpm: clamp(Number(els.bpm.value) || 92, 30, 260),
      beatsPerBar: Number(els.beatsPerBar.value) || 4,
      transposeSemitones: Number(els.instrument.value) || 0,
      accidentals: els.accidentals.value,
      a4: clamp(Number(els.a4.value) || 440, 430, 450),
      pitchTolerance: Number(els.pitchTolerance.value) || 30,
      rhythmMode: els.rhythmMode.value,
      quantize: els.quantize.value,
      countIn: els.countIn.checked,
      metronome: els.metronome.checked,
    };
  }

  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

  function activeElapsed() {
    if (!state.isRecording) return 0;
    const now = performance.now();
    const pausedNow = state.isPaused ? (now - state.pauseStart) : 0;
    return Math.max(0, (now - state.recordStart - state.pausedTotal - pausedNow) / 1000);
  }

  function midiFloatFromFreq(freq, a4) {
    return 69 + 12 * Math.log2(freq / a4);
  }

  function freqFromMidi(midi, a4) {
    return a4 * Math.pow(2, (midi - 69) / 12);
  }

  function noteName(midi, accidentals = 'flats') {
    const rounded = Math.round(midi);
    const octave = Math.floor(rounded / 12) - 1;
    const pc = ((rounded % 12) + 12) % 12;
    return `${noteNames[accidentals][pc]}${octave}`;
  }

  function durationLabel(beats) {
    const b = Number(beats.toFixed(3));
    if (Math.abs(b - 4) < .06) return 'redonda';
    if (Math.abs(b - 3) < .06) return 'blanca+negra';
    if (Math.abs(b - 2) < .06) return 'blanca';
    if (Math.abs(b - 1.5) < .06) return 'negra.';
    if (Math.abs(b - 1) < .06) return 'negra';
    if (Math.abs(b - .75) < .06) return 'corchea.';
    if (Math.abs(b - .5) < .06) return 'corchea';
    if (Math.abs(b - .25) < .06) return 'semicorchea';
    return `${b} tiempos`;
  }

  function setStatus(text) {
    els.status.textContent = text;
    logDebug(`STATUS · ${text}`);
  }

  function logDebug(line) {
    const stamp = new Date().toLocaleTimeString();
    if (!state.debugLines) state.debugLines = [];
    state.debugLines.push(`[${stamp}] ${line}`);
    if (state.debugLines.length > 180) state.debugLines.shift();
    if (!state.lastAnalysis) {
      els.debugOutput.textContent = state.debugLines.join('\n');
    }
  }

  function updateDebugFull() {
    const report = buildReport(false);
    els.debugOutput.textContent = JSON.stringify(report, null, 2);
  }

  function buildReport(full = true) {
    const s = settings();
    const analysis = state.lastAnalysis || null;
    const payload = {
      app: 'matching-transcriptor-v0.1',
      sessionId: state.sessionId,
      generatedAt: new Date().toISOString(),
      settings: s,
      summary: analysis ? analysis.summary : null,
      transcriptionText: els.plainText.value || '',
      analysis,
    };
    if (!full && payload.analysis?.rawFrames) {
      payload.analysis = { ...payload.analysis, rawFrames: payload.analysis.rawFrames.slice(-80) };
      payload.note = 'rawFrames recortado a los últimos 80 frames en esta vista';
    }
    return payload;
  }

  function autoCorrelate(buffer, sampleRate) {
    const size = buffer.length;
    let rms = 0;
    for (let i = 0; i < size; i++) rms += buffer[i] * buffer[i];
    rms = Math.sqrt(rms / size);
    if (rms < 0.012) return { freq: null, rms, clarity: 0 };

    let start = 0;
    let end = size - 1;
    const threshold = 0.2;
    for (let i = 0; i < size / 2; i++) {
      if (Math.abs(buffer[i]) < threshold) { start = i; break; }
    }
    for (let i = 1; i < size / 2; i++) {
      if (Math.abs(buffer[size - i]) < threshold) { end = size - i; break; }
    }

    const trimmed = buffer.slice(start, end);
    const len = trimmed.length;
    if (len < 32) return { freq: null, rms, clarity: 0 };

    const correlations = new Array(len).fill(0);
    for (let lag = 0; lag < len; lag++) {
      let sum = 0;
      for (let i = 0; i < len - lag; i++) {
        sum += trimmed[i] * trimmed[i + lag];
      }
      correlations[lag] = sum;
    }

    let d = 0;
    while (d < len - 1 && correlations[d] > correlations[d + 1]) d++;

    let maxVal = -Infinity;
    let maxPos = -1;
    const minLag = Math.floor(sampleRate / 1200);
    const maxLag = Math.floor(sampleRate / 70);
    for (let i = Math.max(d, minLag); i < Math.min(maxLag, len); i++) {
      if (correlations[i] > maxVal) {
        maxVal = correlations[i];
        maxPos = i;
      }
    }

    if (maxPos <= 0) return { freq: null, rms, clarity: 0 };

    const x1 = correlations[maxPos - 1] || 0;
    const x2 = correlations[maxPos] || 0;
    const x3 = correlations[maxPos + 1] || 0;
    const a = (x1 + x3 - 2 * x2) / 2;
    const b = (x3 - x1) / 2;
    const refined = a ? maxPos - b / (2 * a) : maxPos;
    const freq = sampleRate / refined;
    const clarity = clamp(maxVal / (correlations[0] || 1), 0, 1);

    if (!Number.isFinite(freq) || freq < 70 || freq > 1200 || clarity < .36) {
      return { freq: null, rms, clarity };
    }
    return { freq, rms, clarity };
  }

  async function ensureAudio() {
    if (state.stream) return;
    state.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = state.audioContext.createMediaStreamSource(state.stream);
    state.analyser = state.audioContext.createAnalyser();
    state.analyser.fftSize = 4096;
    state.analyser.smoothingTimeConstant = 0;
    source.connect(state.analyser);
    setStatus('Micrófono activo. Listo para grabar.');
    requestAnimationFrame(pitchLoop);
  }

  function pitchLoop(now) {
    if (!state.analyser || !state.audioContext) {
      requestAnimationFrame(pitchLoop);
      return;
    }

    const buffer = new Float32Array(state.analyser.fftSize);
    state.analyser.getFloatTimeDomainData(buffer);
    const result = autoCorrelate(buffer, state.audioContext.sampleRate);
    const s = settings();

    if (result.freq) {
      const concertFloat = midiFloatFromFreq(result.freq, s.a4);
      const concertMidi = Math.round(concertFloat);
      const writtenFloat = concertFloat + s.transposeSemitones;
      const writtenMidi = Math.round(writtenFloat);
      const cents = (writtenFloat - writtenMidi) * 100;
      updateTuner({ result, concertMidi, writtenMidi, cents, s });

      if (state.isRecording && !state.isPaused && now - state.lastPitchAt > 42) {
        state.lastPitchAt = now;
        state.pitchFrames.push({
          t: Number(activeElapsed().toFixed(4)),
          freq: Number(result.freq.toFixed(2)),
          rms: Number(result.rms.toFixed(4)),
          clarity: Number(result.clarity.toFixed(3)),
          concertMidi,
          concertNote: noteName(concertMidi, s.accidentals),
          writtenMidi,
          writtenNote: noteName(writtenMidi, s.accidentals),
          cents: Number(cents.toFixed(1)),
        });
      }
    } else {
      updateTuner(null);
      if (state.isRecording && !state.isPaused && now - state.lastPitchAt > 58) {
        state.lastPitchAt = now;
        state.pitchFrames.push({
          t: Number(activeElapsed().toFixed(4)),
          freq: null,
          rms: Number(result.rms.toFixed(4)),
          clarity: Number(result.clarity.toFixed(3)),
          concertMidi: null,
          concertNote: 'REST',
          writtenMidi: null,
          writtenNote: 'REST',
          cents: null,
        });
      }
    }

    requestAnimationFrame(pitchLoop);
  }

  function updateTuner(data) {
    if (!data) {
      els.writtenNote.textContent = '—';
      els.concertNote.textContent = 'sonido real: —';
      els.centsText.textContent = 'sin señal estable';
      els.needle.style.left = '50%';
      return;
    }
    const { result, concertMidi, writtenMidi, cents, s } = data;
    els.writtenNote.textContent = noteName(writtenMidi, s.accidentals);
    els.concertNote.textContent = `sonido real: ${noteName(concertMidi, s.accidentals)} · ${result.freq.toFixed(1)} Hz`;
    const pos = clamp(50 + cents, 0, 100);
    els.needle.style.left = `${pos}%`;
    let label = `${cents >= 0 ? '+' : ''}${cents.toFixed(0)} cents`;
    if (Math.abs(cents) <= 8) label += ' · centrado';
    else if (cents < 0) label += ' · grave';
    else label += ' · agudo';
    els.centsText.textContent = label;
  }

  async function beep(time = 0, freq = 880, duration = .04, gain = .09) {
    if (!state.audioContext) return;
    const ctx = state.audioContext;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.value = freq;
    g.gain.value = gain;
    osc.connect(g);
    g.connect(ctx.destination);
    const start = ctx.currentTime + time;
    osc.start(start);
    osc.stop(start + duration);
  }

  async function runCountIn() {
    const s = settings();
    if (!s.countIn) return;
    const beat = 60 / s.bpm;
    setStatus(`Entrada: ${s.beatsPerBar} pulsos...`);
    for (let i = 0; i < s.beatsPerBar; i++) {
      beep(0, i === 0 ? 1040 : 780, .045, .07);
      await sleep(beat * 1000);
    }
  }

  function startMetronome() {
    stopMetronome();
    const s = settings();
    if (!s.metronome) return;
    let beatIndex = 0;
    const beatMs = 60000 / s.bpm;
    state.metronomeTimer = setInterval(() => {
      if (state.isRecording && !state.isPaused) {
        beep(0, beatIndex % s.beatsPerBar === 0 ? 1040 : 740, .035, .045);
        beatIndex++;
      }
    }, beatMs);
  }

  function stopMetronome() {
    if (state.metronomeTimer) clearInterval(state.metronomeTimer);
    state.metronomeTimer = null;
  }

  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  async function startRecording() {
    try {
      await ensureAudio();
      if (state.audioContext.state === 'suspended') await state.audioContext.resume();
      await runCountIn();

      state.sessionId = `session-${Date.now()}`;
      state.chunks = [];
      state.audioBlob = null;
      state.pitchFrames = [];
      state.lastAnalysis = null;
      state.debugLines = [];
      els.downloadAudio.disabled = true;
      els.bars.classList.add('empty');
      els.bars.textContent = 'Grabando...';
      els.plainText.value = '';

      const mimeType = chooseMimeType();
      state.mediaRecorder = new MediaRecorder(state.stream, mimeType ? { mimeType } : undefined);
      state.mediaRecorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) state.chunks.push(ev.data);
      };
      state.mediaRecorder.onstop = () => {
        state.audioBlob = new Blob(state.chunks, { type: state.mediaRecorder.mimeType || 'audio/webm' });
        els.downloadAudio.disabled = false;
      };

      state.isRecording = true;
      state.isPaused = false;
      state.recordStart = performance.now();
      state.pauseStart = 0;
      state.pausedTotal = 0;
      state.lastPitchAt = 0;
      state.mediaRecorder.start(250);
      startMetronome();

      els.recordBtn.disabled = true;
      els.pauseBtn.disabled = false;
      els.stopBtn.disabled = false;
      els.pauseBtn.textContent = 'Pausa';
      setStatus('Grabando. Toca la idea; yo voy tomando datos.');
    } catch (err) {
      console.error(err);
      setStatus(`Error con el micrófono: ${err.message}`);
    }
  }

  function chooseMimeType() {
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    return types.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
  }

  function pauseResume() {
    if (!state.mediaRecorder || !state.isRecording) return;
    if (!state.isPaused) {
      state.isPaused = true;
      state.pauseStart = performance.now();
      state.mediaRecorder.pause();
      els.pauseBtn.textContent = 'Reanudar';
      setStatus('Pausado. La transcripción no cuenta este tiempo.');
    } else {
      state.pausedTotal += performance.now() - state.pauseStart;
      state.pauseStart = 0;
      state.isPaused = false;
      state.mediaRecorder.resume();
      els.pauseBtn.textContent = 'Pausa';
      setStatus('Grabando de nuevo.');
    }
  }

  function stopRecording() {
    if (!state.mediaRecorder || !state.isRecording) return;
    state.isRecording = false;
    state.isPaused = false;
    stopMetronome();
    state.mediaRecorder.stop();

    els.recordBtn.disabled = false;
    els.pauseBtn.disabled = true;
    els.stopBtn.disabled = true;
    els.pauseBtn.textContent = 'Pausa';

    setStatus('Analizando y redondeando...');
    const analysis = analyzeFrames(state.pitchFrames, settings());
    state.lastAnalysis = analysis;
    renderAnalysis(analysis);
    updateDebugFull();
    setStatus(`Listo: ${analysis.summary.noteCount} notas en ${analysis.summary.barCount} compases.`);
  }

  function minDurationByMode(mode) {
    if (mode === 'strict') return .07;
    if (mode === 'loose') return .16;
    return .11;
  }

  function silenceGapByMode(mode) {
    if (mode === 'strict') return .08;
    if (mode === 'loose') return .22;
    return .14;
  }

  function analyzeFrames(frames, s) {
    const rawFrames = frames.slice();
    const minDur = minDurationByMode(s.rhythmMode);
    const silenceGap = silenceGapByMode(s.rhythmMode);
    const beatSec = 60 / s.bpm;
    const barSec = beatSec * s.beatsPerBar;

    const cleaned = rawFrames.map(f => {
      if (!f.writtenMidi || Math.abs(f.cents || 0) > Math.max(75, s.pitchTolerance + 25)) {
        return { ...f, label: 'REST', midi: null };
      }
      return { ...f, label: f.writtenNote, midi: f.writtenMidi };
    });

    let segments = groupFrames(cleaned, silenceGap);
    segments = mergeTinySegments(segments, minDur);
    segments = mergeSameNeighbors(segments);

    const gridBeats = chooseGridBeats(segments, s);
    const quantized = quantizeSegments(segments, gridBeats, beatSec, barSec, s.beatsPerBar);
    const bars = buildBars(quantized);
    const plain = barsToText(bars, s.beatsPerBar);

    return {
      summary: {
        durationSec: Number((rawFrames.at(-1)?.t || 0).toFixed(2)),
        frameCount: rawFrames.length,
        segmentCount: segments.length,
        noteCount: quantized.filter(e => e.label !== 'REST').length,
        barCount: bars.length,
        gridBeats,
        beatSec: Number(beatSec.toFixed(4)),
        barSec: Number(barSec.toFixed(4)),
      },
      rawFrames,
      segments,
      quantized,
      bars,
      plain,
    };
  }

  function groupFrames(frames, silenceGap) {
    if (!frames.length) return [];
    const segments = [];
    let cur = null;

    for (const f of frames) {
      const label = f.label || 'REST';
      const t = f.t;
      if (!cur) {
        cur = newSegment(label, f);
        continue;
      }
      const lastT = cur.lastT;
      const gap = t - lastT;
      if (label !== cur.label || gap > silenceGap) {
        cur.end = lastT;
        finalizeSegment(cur);
        segments.push(cur);
        if (gap > silenceGap && cur.label !== 'REST' && label !== 'REST') {
          segments.push({ label: 'REST', midi: null, start: lastT, end: t, duration: t - lastT, centsAvg: null, clarityAvg: null, frameCount: 0 });
        }
        cur = newSegment(label, f);
      } else {
        cur.frames.push(f);
        cur.lastT = t;
      }
    }
    cur.end = cur.lastT;
    finalizeSegment(cur);
    segments.push(cur);
    return segments.filter(seg => seg.duration > 0.025);
  }

  function newSegment(label, frame) {
    return {
      label,
      midi: frame.midi,
      start: frame.t,
      end: frame.t,
      lastT: frame.t,
      frames: [frame],
    };
  }

  function finalizeSegment(seg) {
    const frameDur = seg.frames.length > 1 ? median(diff(seg.frames.map(f => f.t))) : .045;
    seg.end += frameDur;
    seg.duration = Math.max(0, seg.end - seg.start);
    const noteFrames = seg.frames.filter(f => f.label !== 'REST');
    seg.centsAvg = noteFrames.length ? Number(avg(noteFrames.map(f => f.cents || 0)).toFixed(1)) : null;
    seg.clarityAvg = noteFrames.length ? Number(avg(noteFrames.map(f => f.clarity || 0)).toFixed(3)) : null;
    seg.frameCount = seg.frames.length;
    delete seg.frames;
    delete seg.lastT;
  }

  function mergeTinySegments(segments, minDur) {
    const out = [];
    for (const seg of segments) {
      if (seg.duration < minDur && out.length) {
        const prev = out[out.length - 1];
        if (seg.label === 'REST' || prev.label === seg.label) {
          prev.end = seg.end;
          prev.duration = prev.end - prev.start;
          continue;
        }
      }
      out.push({ ...seg });
    }
    return out.filter(seg => !(seg.label !== 'REST' && seg.duration < minDur * .65));
  }

  function mergeSameNeighbors(segments) {
    const out = [];
    for (const seg of segments) {
      const prev = out[out.length - 1];
      if (prev && prev.label === seg.label) {
        prev.end = seg.end;
        prev.duration = prev.end - prev.start;
        if (prev.centsAvg !== null && seg.centsAvg !== null) prev.centsAvg = Number(((prev.centsAvg + seg.centsAvg) / 2).toFixed(1));
        continue;
      }
      out.push({ ...seg });
    }
    return out;
  }

  function chooseGridBeats(segments, s) {
    if (s.quantize !== 'auto') return Number(s.quantize);
    const beatSec = 60 / s.bpm;
    const noteDurBeats = segments
      .filter(seg => seg.label !== 'REST')
      .map(seg => seg.duration / beatSec)
      .filter(v => Number.isFinite(v) && v > .08);
    if (!noteDurBeats.length) return 1;
    const med = median(noteDurBeats);
    if (med < .38) return .25;
    if (med < .82) return .5;
    return 1;
  }

  function quantizeSegments(segments, gridBeats, beatSec, barSec, beatsPerBar) {
    if (!gridBeats || gridBeats <= 0) {
      return segments.map(seg => ({
        label: seg.label,
        start: seg.start,
        end: seg.end,
        duration: seg.duration,
        startBeat: seg.start / beatSec,
        durationBeats: seg.duration / beatSec,
        barIndex: Math.floor(seg.start / barSec),
        centsAvg: seg.centsAvg,
        clarityAvg: seg.clarityAvg,
      }));
    }
    const gridSec = gridBeats * beatSec;
    const events = [];
    for (const seg of segments) {
      let start = Math.round(seg.start / gridSec) * gridSec;
      let end = Math.round(seg.end / gridSec) * gridSec;
      if (end <= start) end = start + gridSec;
      const maxEnd = Math.ceil((segments.at(-1)?.end || end) / gridSec) * gridSec;
      end = clamp(end, start + gridSec, maxEnd + gridSec);
      events.push({
        label: seg.label,
        start: Number(start.toFixed(4)),
        end: Number(end.toFixed(4)),
        duration: Number((end - start).toFixed(4)),
        startBeat: Number((start / beatSec).toFixed(3)),
        durationBeats: Number(((end - start) / beatSec).toFixed(3)),
        barIndex: Math.floor(start / barSec),
        beatInBar: Number(((start / beatSec) % beatsPerBar).toFixed(3)),
        centsAvg: seg.centsAvg,
        clarityAvg: seg.clarityAvg,
      });
    }
    return mergeQuantized(events);
  }

  function mergeQuantized(events) {
    const sorted = events.sort((a, b) => a.start - b.start);
    const out = [];
    for (const ev of sorted) {
      const prev = out[out.length - 1];
      if (prev && prev.label === ev.label && Math.abs(prev.end - ev.start) < .08) {
        prev.end = ev.end;
        prev.duration = Number((prev.end - prev.start).toFixed(4));
        prev.durationBeats = Number((prev.durationBeats + ev.durationBeats).toFixed(3));
      } else {
        out.push({ ...ev });
      }
    }
    return out.filter(ev => ev.durationBeats > .05);
  }

  function buildBars(events) {
    const map = new Map();
    for (const ev of events) {
      const idx = ev.barIndex || 0;
      if (!map.has(idx)) map.set(idx, []);
      map.get(idx).push(ev);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([index, events]) => ({ index, events }));
  }

  function barsToText(bars) {
    if (!bars.length) return '';
    return bars.map(bar => {
      const items = bar.events.map(ev => {
        const name = ev.label === 'REST' ? 'silencio' : ev.label;
        return `${name} ${durationLabel(ev.durationBeats)}`;
      }).join(' · ');
      return `Compás ${bar.index + 1}: ${items}`;
    }).join('\n');
  }

  function renderAnalysis(analysis) {
    els.bars.classList.remove('empty');
    els.bars.innerHTML = '';
    if (!analysis.bars.length) {
      els.bars.classList.add('empty');
      els.bars.textContent = 'No se detectaron notas estables.';
      els.plainText.value = '';
      return;
    }
    for (const bar of analysis.bars) {
      const row = document.createElement('div');
      row.className = 'bar';
      const title = document.createElement('div');
      title.className = 'barTitle';
      title.textContent = `Compás ${bar.index + 1}`;
      const tokens = document.createElement('div');
      tokens.className = 'tokens';
      for (const ev of bar.events) {
        const token = document.createElement('div');
        token.className = `token ${ev.label === 'REST' ? 'rest' : ''}`;
        const n = document.createElement('div');
        n.className = 'n';
        n.textContent = ev.label === 'REST' ? 'silencio' : ev.label;
        const d = document.createElement('div');
        d.className = 'd';
        const cents = ev.centsAvg !== null && ev.centsAvg !== undefined ? ` · ${ev.centsAvg >= 0 ? '+' : ''}${ev.centsAvg}c` : '';
        d.textContent = `${durationLabel(ev.durationBeats)}${cents}`;
        token.append(n, d);
        tokens.appendChild(token);
      }
      row.append(title, tokens);
      els.bars.appendChild(row);
    }
    els.plainText.value = analysis.plain;
  }

  function avg(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
  function diff(arr) { return arr.slice(1).map((v, i) => v - arr[i]); }
  function median(arr) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  function tapTempo() {
    const now = performance.now();
    state.tapTimes = state.tapTimes.filter(t => now - t < 3500);
    state.tapTimes.push(now);
    if (state.tapTimes.length < 2) {
      setStatus('Tap: mete al menos 2 pulsos.');
      return;
    }
    const intervals = diff(state.tapTimes);
    const bpm = Math.round(60000 / median(intervals));
    els.bpm.value = clamp(bpm, 30, 260);
    setStatus(`Tap tempo: ${els.bpm.value} BPM.`);
  }

  function download(filename, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 800);
  }

  async function copy(text) {
    await navigator.clipboard.writeText(text);
  }

  els.recordBtn.addEventListener('click', startRecording);
  els.pauseBtn.addEventListener('click', pauseResume);
  els.stopBtn.addEventListener('click', stopRecording);
  els.tapTempo.addEventListener('click', tapTempo);

  els.copyText.addEventListener('click', async () => {
    await copy(els.plainText.value || '');
    setStatus('Transcripción copiada.');
  });

  els.downloadJson.addEventListener('click', () => {
    const report = buildReport(true);
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    download(`${state.sessionId || 'matching-transcriptor'}-report.json`, blob);
  });

  els.downloadAudio.addEventListener('click', () => {
    if (!state.audioBlob) return;
    const ext = state.audioBlob.type.includes('mp4') ? 'm4a' : 'webm';
    download(`${state.sessionId || 'matching-transcriptor'}.${ext}`, state.audioBlob);
  });

  els.debugToggle.addEventListener('click', () => {
    els.debugPanel.classList.toggle('hidden');
    if (!els.debugPanel.classList.contains('hidden')) updateDebugFull();
  });

  els.copyReport.addEventListener('click', async () => {
    await copy(JSON.stringify(buildReport(true), null, 2));
    setStatus('Informe técnico copiado. Pégamelo y ajustamos fino.');
  });

  els.clearDebug.addEventListener('click', () => {
    state.debugLines = [];
    state.lastAnalysis = null;
    els.debugOutput.textContent = 'Limpio.';
  });

  document.addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'd') {
      ev.preventDefault();
      els.debugToggle.click();
    }
    if (ev.code === 'Space' && document.activeElement.tagName !== 'TEXTAREA') {
      ev.preventDefault();
      if (!state.isRecording) startRecording();
      else pauseResume();
    }
  });

  window.addEventListener('beforeunload', () => {
    stopMetronome();
    if (state.stream) state.stream.getTracks().forEach(t => t.stop());
  });
})();
