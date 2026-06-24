(() => {
  'use strict';

  const APP_VERSION = 'v0.3.4';
  const APP_ID = `transcriptor-${APP_VERSION}`;

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
    simplifyMode: $('simplifyMode'),
    holdNoteMs: $('holdNoteMs'),
    micSensitivity: $('micSensitivity'),
    tunerBtn: $('tunerBtn'),
    recordBtn: $('recordBtn'),
    cMajorTestBtn: $('cMajorTestBtn'),
    pauseBtn: $('pauseBtn'),
    stopBtn: $('stopBtn'),
    status: $('status'),
    writtenNote: $('writtenNote'),
    concertNote: $('concertNote'),
    needle: $('needle'),
    centsText: $('centsText'),
    meterLeftLabel: $('meterLeftLabel'),
    meterCenterLabel: $('meterCenterLabel'),
    meterRightLabel: $('meterRightLabel'),
    signalFill: $('signalFill'),
    inputLevelText: $('inputLevelText'),
    beatIndicator: $('beatIndicator'),
    countDisplay: $('countDisplay'),
    exportLinks: $('exportLinks'),
    staff: $('staff'),
    bars: $('bars'),
    plainText: $('plainText'),
    copyText: $('copyText'),
    downloadTxt: $('downloadTxt'),
    downloadAbc: $('downloadAbc'),
    downloadCsv: $('downloadCsv'),
    downloadMusicXml: $('downloadMusicXml'),
    downloadSvg: $('downloadSvg'),
    downloadPng: $('downloadPng'),
    downloadJpg: $('downloadJpg'),
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

  const letterIndex = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

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
    debugLines: [],
    pitchLoopStarted: false,
    lastStableData: null,
    lastStableAt: 0,
    lastDisplayedHeld: false,
    beatTimerStarted: false,
    beatStartAt: performance.now(),
    audioReady: false,
    countingIn: false,
    countInBeat: -1,
    currentMode: 'normal',
    forcedScalePcs: null,
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
      simplifyMode: els.simplifyMode?.value || 'melodic',
      holdNoteMs: Number(els.holdNoteMs.value) || 7000,
      micSensitivity: els.micSensitivity?.value || 'normal',
      countIn: els.countIn.checked,
      metronome: els.metronome.checked,
      testMode: state.currentMode,
      forcedScalePcs: state.forcedScalePcs,
      minConcertFreq: 135,
      maxConcertFreq: 1200,
      minWrittenMidi: 53, // F3 escrito aprox: evita falsos graves tipo F2
      maxWrittenMidi: 88,
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

  function noteName(midi, accidentals = 'flats') {
    if (midi === null || midi === undefined || !Number.isFinite(midi)) return 'REST';
    const rounded = Math.round(midi);
    const octave = Math.floor(rounded / 12) - 1;
    const pc = ((rounded % 12) + 12) % 12;
    return `${noteNames[accidentals][pc]}${octave}`;
  }

  function visualNoteName(label) {
    return String(label || '').replace(/b/g, '♭').replace(/#/g, '♯');
  }

  function sensitivityProfile(value) {
    // La v0.3 era demasiado agresiva: la puerta de ruido anulaba la onda y el afinador parecía sordo.
    // En v0.3.1 la puerta casi desaparece; la sensibilidad se controla con rmsFloor/clarityMin.
    if (value === 'low') return { zeroGate: 0.0008, rmsFloor: 0.0060, clarityMin: 0.50, holdRms: 0.0018, meterGain: 1.00 };
    if (value === 'high') return { zeroGate: 0.00015, rmsFloor: 0.0013, clarityMin: 0.30, holdRms: 0.00035, meterGain: 2.20 };
    if (value === 'max') return { zeroGate: 0.00000, rmsFloor: 0.00055, clarityMin: 0.22, holdRms: 0.00012, meterGain: 3.20 };
    return { zeroGate: 0.00035, rmsFloor: 0.0023, clarityMin: 0.36, holdRms: 0.00075, meterGain: 1.55 };
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
    state.debugLines.push(`[${stamp}] ${line}`);
    if (state.debugLines.length > 220) state.debugLines.shift();
    if (!state.lastAnalysis) els.debugOutput.textContent = state.debugLines.join('\n') || 'Sin datos todavía.';
  }

  function updateDebugFull() {
    const report = buildReport(false);
    els.debugOutput.textContent = JSON.stringify(report, null, 2);
  }

  function buildReport(full = true) {
    const analysis = state.lastAnalysis || null;
    const payload = {
      app: APP_ID,
      sessionId: state.sessionId,
      generatedAt: new Date().toISOString(),
      settings: settings(),
      summary: analysis ? analysis.summary : null,
      transcriptionText: els.plainText.value || '',
      analysis,
    };
    if (!full && payload.analysis?.rawFrames) {
      payload.analysis = { ...payload.analysis, rawFrames: payload.analysis.rawFrames.slice(-100) };
      payload.note = 'rawFrames recortado a los últimos 100 frames en esta vista';
    }
    return payload;
  }

  function autoCorrelate(buffer, sampleRate, opts = {}) {
    const size = buffer.length;
    let mean = 0;
    for (let i = 0; i < size; i++) mean += buffer[i];
    mean /= size;

    let rms = 0;
    let peak = 0;
    const x = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      const v = buffer[i] - mean;
      const av = Math.abs(v);
      if (av > peak) peak = av;
      const zeroGate = opts.zeroGate ?? 0.00035;
      x[i] = av < zeroGate ? 0 : v; // puerta de ruido muy baja, no mata notas largas
      rms += v * v;
    }
    rms = Math.sqrt(rms / size);
    const rmsFloor = opts.rmsFloor ?? 0.003;
    if (rms < rmsFloor) return { freq: null, rms, peak, clarity: 0 };

    const minFreq = opts.minFreq || 135;
    const maxFreq = opts.maxFreq || 1200;
    const minLag = Math.max(2, Math.floor(sampleRate / maxFreq));
    const maxLag = Math.min(size - 2, Math.ceil(sampleRate / minFreq));

    let bestLag = -1;
    let bestCorr = -Infinity;
    const correlations = [];

    for (let lag = minLag; lag <= maxLag; lag++) {
      let sum = 0, e1 = 0, e2 = 0;
      for (let i = 0; i < size - lag; i++) {
        const a = x[i];
        const b = x[i + lag];
        sum += a * b;
        e1 += a * a;
        e2 += b * b;
      }
      const corr = sum / Math.sqrt((e1 || 1e-12) * (e2 || 1e-12));
      correlations[lag] = corr;
      if (corr > bestCorr) {
        bestCorr = corr;
        bestLag = lag;
      }
    }

    const clarityMin = opts.clarityMin ?? 0.39;
    if (bestLag <= 0 || bestCorr < clarityMin) return { freq: null, rms, peak, clarity: Math.max(0, bestCorr || 0) };

    // Corrección anti-subarmónicos: si hay un pico más corto casi igual de bueno, preferirlo.
    for (let lag = minLag + 1; lag < bestLag; lag++) {
      const c = correlations[lag] || 0;
      const isPeak = c > (correlations[lag - 1] || 0) && c >= (correlations[lag + 1] || 0);
      if (isPeak && c > bestCorr * 0.86 && c > 0.50) {
        bestLag = lag;
        bestCorr = c;
        break;
      }
    }

    const x1 = correlations[bestLag - 1] || 0;
    const x2 = correlations[bestLag] || 0;
    const x3 = correlations[bestLag + 1] || 0;
    const a = (x1 + x3 - 2 * x2) / 2;
    const b = (x3 - x1) / 2;
    const refined = a ? bestLag - b / (2 * a) : bestLag;
    const freq = sampleRate / refined;
    const clarity = clamp(bestCorr, 0, 1);

    if (!Number.isFinite(freq) || freq < minFreq || freq > maxFreq) return { freq: null, rms, peak, clarity };
    return { freq, rms, peak, clarity };
  }

  async function ensureAudio() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Este navegador no expone getUserMedia. Usa la web publicada en HTTPS o localhost.');
    }

    if (state.audioContext?.state === 'closed') {
      state.audioContext = null;
      state.analyser = null;
      state.stream = null;
      state.audioReady = false;
    }

    if (state.stream && state.audioContext && state.analyser) {
      if (state.audioContext.state === 'suspended') await state.audioContext.resume();
      state.audioReady = true;
      startBeatLoop();
      if (!state.pitchLoopStarted) {
        state.pitchLoopStarted = true;
        requestAnimationFrame(pitchLoop);
      }
      return;
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
      });
    } catch (err) {
      // Algunos móviles/navegadores se atragantan con restricciones finas. Fallback bruto: que entre señal y luego filtramos nosotros.
      logDebug(`Fallback getUserMedia audio:true · ${err.message}`);
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }

    state.stream = stream;
    state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (state.audioContext.state === 'suspended') await state.audioContext.resume();

    const source = state.audioContext.createMediaStreamSource(state.stream);
    state.analyser = state.audioContext.createAnalyser();
    state.analyser.fftSize = 8192;
    state.analyser.smoothingTimeConstant = 0;
    source.connect(state.analyser);

    state.audioReady = true;
    state.beatStartAt = performance.now();
    els.tunerBtn.textContent = 'Afinador activo';
    els.tunerBtn.disabled = true;
    setStatus('Afinador activo. Entrada de micro conectada.');
    logDebug(`Audio OK · sampleRate ${state.audioContext.sampleRate} · fftSize ${state.analyser.fftSize}`);

    startBeatLoop();
    if (!state.pitchLoopStarted) {
      state.pitchLoopStarted = true;
      requestAnimationFrame(pitchLoop);
    }
  }

  function pitchLoop(now = performance.now()) {
    if (!state.analyser || !state.audioContext) {
      requestAnimationFrame(pitchLoop);
      return;
    }

    const buffer = new Float32Array(state.analyser.fftSize);
    state.analyser.getFloatTimeDomainData(buffer);
    const s = settings();
    const profile = sensitivityProfile(s.micSensitivity);
    const result = autoCorrelate(buffer, state.audioContext.sampleRate, {
      minFreq: s.minConcertFreq,
      maxFreq: s.maxConcertFreq,
      zeroGate: profile.zeroGate,
      rmsFloor: profile.rmsFloor,
      clarityMin: profile.clarityMin,
    });

    let data = null;
    let held = false;

    if (result.freq) {
      const concertFloat = midiFloatFromFreq(result.freq, s.a4);
      const concertMidi = Math.round(concertFloat);
      const writtenFloat = concertFloat + s.transposeSemitones;
      const writtenMidi = Math.round(writtenFloat);
      const cents = (writtenFloat - writtenMidi) * 100;
      const inRange = writtenMidi >= s.minWrittenMidi && writtenMidi <= s.maxWrittenMidi;
      const notWild = Math.abs(cents) <= Math.max(78, s.pitchTolerance + 32);

      if (inRange && notWild) {
        data = { result, concertMidi, writtenMidi, cents, s, held: false };
        state.lastStableData = data;
        state.lastStableAt = now;
      }
    }

    let uiData = data;
    if (!uiData && state.lastStableData) {
      const age = now - state.lastStableAt;
      if (age <= s.holdNoteMs) {
        uiData = {
          ...state.lastStableData,
          result: { ...state.lastStableData.result, rms: result.rms, clarity: result.clarity || state.lastStableData.result.clarity },
          held: true,
        };
        held = true;
      }
    }

    updateTuner(uiData, result, s);
    updateBeatIndicator();

    if (state.isRecording && !state.isPaused && now - state.lastPitchAt > 42) {
      state.lastPitchAt = now;
      const strongEnoughForHold = result.rms >= profile.holdRms;
      if (data) pushPitchFrame(data, false);
      else if (uiData && uiData.held && strongEnoughForHold) pushPitchFrame(uiData, true);
      else pushRestFrame(result);
    }

    requestAnimationFrame(pitchLoop);
  }

  function pushPitchFrame(data, held = false) {
    const { result, concertMidi, writtenMidi, cents, s } = data;
    state.pitchFrames.push({
      t: Number(activeElapsed().toFixed(4)),
      freq: Number(result.freq.toFixed(2)),
      rms: Number(result.rms.toFixed(4)),
      peak: Number((result.peak || 0).toFixed(4)),
      clarity: Number(result.clarity.toFixed(3)),
      concertMidi,
      concertNote: noteName(concertMidi, s.accidentals),
      writtenMidi,
      writtenNote: noteName(writtenMidi, s.accidentals),
      cents: Number(cents.toFixed(1)),
      held,
    });
  }

  function pushRestFrame(result) {
    state.pitchFrames.push({
      t: Number(activeElapsed().toFixed(4)),
      freq: null,
      rms: Number(result.rms.toFixed(4)),
      peak: Number((result.peak || 0).toFixed(4)),
      clarity: Number((result.clarity || 0).toFixed(3)),
      concertMidi: null,
      concertNote: 'REST',
      writtenMidi: null,
      writtenNote: 'REST',
      cents: null,
      held: false,
    });
  }

  function updateTuner(data, liveResult = null, s = settings()) {
    const range = Math.max(15, Number(s.pitchTolerance) || 30);
    els.meterLeftLabel.textContent = `-${range}`;
    els.meterCenterLabel.textContent = '0 cents';
    els.meterRightLabel.textContent = `+${range}`;

    const rms = liveResult?.rms ?? data?.result?.rms ?? 0;
    const peak = liveResult?.peak ?? data?.result?.peak ?? rms;
    const clarity = liveResult?.clarity ?? data?.result?.clarity ?? 0;
    const profile = sensitivityProfile(s.micSensitivity);
    if (els.signalFill) {
      const level = Math.max(rms * 1.6, peak * 0.72);
      const signal = clamp((level / 0.050) * 100 * (profile.meterGain || 1), 0, 100);
      els.signalFill.style.width = `${signal}%`;
      els.signalFill.style.opacity = `${clamp(0.30 + clarity * 0.70, 0.30, 1)}`;
      els.signalFill.classList.toggle('hot', signal > 82);
    }
    if (els.inputLevelText) {
      els.inputLevelText.textContent = `Entrada: rms ${rms.toFixed(4)} · pico ${peak.toFixed(4)} · claridad ${clarity.toFixed(2)}`;
    }

    document.body.classList.toggle('held-note', Boolean(data?.held));
    if (!data) {
      // El afinador no debe "morirse" visualmente. Si hubo una nota fiable, se mantiene
      // hasta que llegue otra. Si la barra de señal cae a cero, no hay forma física de medir pitch:
      // se conserva la última lectura y se muestra la señal real.
      if (state.lastStableData) {
        const last = state.lastStableData;
        const ageSec = Math.max(0, (performance.now() - state.lastStableAt) / 1000);
        els.writtenNote.textContent = visualNoteName(noteName(last.writtenMidi, last.s.accidentals));
        els.concertNote.textContent = `última nota: ${visualNoteName(noteName(last.concertMidi, last.s.accidentals))} · memoria ${ageSec.toFixed(1)}s`;
        const pos = clamp(50 + (last.cents / range) * 50, 0, 100);
        els.needle.style.left = `${pos}%`;
        const signalMsg = rms > 0.001 ? 'buscando pitch estable' : 'sin señal de audio';
        els.centsText.textContent = `última lectura ${last.cents >= 0 ? '+' : ''}${last.cents.toFixed(0)} cents · ${signalMsg}`;
        return;
      }
      els.writtenNote.textContent = '—';
      els.concertNote.textContent = 'sonido real: —';
      els.centsText.textContent = rms > 0.001 ? 'entra audio, buscando pitch' : 'sin señal útil';
      els.needle.style.left = '50%';
      return;
    }
    const { result, concertMidi, writtenMidi, cents, held } = data;
    els.writtenNote.textContent = visualNoteName(noteName(writtenMidi, s.accidentals));
    const mode = held ? ' · retenida' : '';
    els.concertNote.textContent = `sonido real: ${visualNoteName(noteName(concertMidi, s.accidentals))} · ${(result.freq || state.lastStableData?.result?.freq || 0).toFixed(1)} Hz${mode}`;
    const pos = clamp(50 + (cents / range) * 50, 0, 100);
    els.needle.style.left = `${pos}%`;
    let label = `${cents >= 0 ? '+' : ''}${cents.toFixed(0)} cents`;
    const centered = Math.max(5, Math.round(range * 0.18));
    if (Math.abs(cents) <= centered) label += ' · centrado';
    else if (cents < 0) label += ' · grave';
    else label += ' · agudo';
    if (held) label += ' · señal inestable, mantengo nota';
    els.centsText.textContent = label;
  }

  function startBeatLoop() {
    if (state.beatTimerStarted) return;
    state.beatTimerStarted = true;
    state.beatStartAt = performance.now();
    requestAnimationFrame(beatLoop);
  }

  function beatLoop() {
    updateBeatIndicator();
    requestAnimationFrame(beatLoop);
  }

  function updateBeatIndicator(force = false) {
    if (!els.beatIndicator) return;
    const s = settings();
    const beats = s.beatsPerBar;
    els.beatIndicator.style.setProperty('--beats', beats);
    if (force || els.beatIndicator.children.length !== beats) {
      els.beatIndicator.innerHTML = '';
      for (let i = 0; i < beats; i++) {
        const dot = document.createElement('div');
        dot.className = 'beatDot';
        dot.textContent = String(i + 1);
        dot.setAttribute('aria-label', `tiempo ${i + 1}`);
        els.beatIndicator.appendChild(dot);
      }
    }
    const beatSec = 60 / s.bpm;
    let elapsed;
    let active = -1;
    if (state.countingIn) {
      active = clamp(state.countInBeat, 0, beats - 1);
    } else if (state.isRecording && !state.isPaused) {
      elapsed = activeElapsed();
      active = Math.floor(elapsed / beatSec) % beats;
    } else if (!state.isPaused) {
      elapsed = (performance.now() - state.beatStartAt) / 1000;
      active = Math.floor(elapsed / beatSec) % beats;
    }
    [...els.beatIndicator.children].forEach((dot, i) => {
      dot.classList.toggle('active', i === active);
      dot.classList.toggle('past', active >= 0 && i < active);
    });
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

  async function runCountIn(force = false) {
    const s = settings();
    if (!force && !s.countIn) {
      if (els.countDisplay) els.countDisplay.textContent = 'REC';
      return;
    }
    const beat = 60 / s.bpm;
    const beats = s.beatsPerBar || 4;
    state.countingIn = true;
    setStatus(`Cuenta atrás: ${beats} · ${beats - 1} · ${beats - 2} · 1 · REC.`);
    for (let step = beats; step >= 1; step--) {
      const beatIndex = (beats - step) % beats;
      state.countInBeat = beatIndex;
      if (els.countDisplay) {
        els.countDisplay.classList.remove('rec');
        els.countDisplay.textContent = String(step);
      }
      updateBeatIndicator(true);
      beep(0, step === beats ? 1040 : 780, .055, .08);
      await sleep(beat * 1000);
    }
    state.countingIn = false;
    state.countInBeat = -1;
    state.beatStartAt = performance.now();
    if (els.countDisplay) {
      els.countDisplay.textContent = 'REC';
      els.countDisplay.classList.add('rec');
    }
    updateBeatIndicator(true);
    beep(0, 1180, .08, .08);
    await sleep(40);
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

  async function activateTuner() {
    try {
      await ensureAudio();
      if (state.audioContext.state === 'suspended') await state.audioContext.resume();
    } catch (err) {
      console.error(err);
      setStatus(`Error con el micrófono: ${err.message}`);
      throw err;
    }
  }

  async function startRecording(mode = 'normal') {
    try {
      state.currentMode = mode;
      if (mode === 'c_major_scale') {
        state.forcedScalePcs = [0, 2, 4, 5, 7, 9, 11];
        els.quantize.value = '1';
        els.simplifyMode.value = 'sketch';
        els.accidentals.value = 'flats';
        els.countIn.checked = true;
        setStatus('Prueba Do mayor: toca Do-Re-Mi-Fa-Sol-La-Si-Do en negras, varias vueltas.');
      } else {
        state.forcedScalePcs = null;
      }
      await activateTuner();
      await runCountIn(mode === 'c_major_scale');

      state.sessionId = `${mode === 'c_major_scale' ? 'cmajor-' : ''}session-${Date.now()}`;
      state.chunks = [];
      state.audioBlob = null;
      state.pitchFrames = [];
      state.lastAnalysis = null;
      state.debugLines = [];
      els.downloadAudio.disabled = true;
      els.staff.classList.add('empty');
      els.staff.textContent = 'Grabando...';
      els.bars.classList.add('empty');
      els.bars.textContent = 'Grabando...';
      els.plainText.value = '';

      const mimeType = chooseMimeType();
      if (window.MediaRecorder) {
        state.mediaRecorder = new MediaRecorder(state.stream, mimeType ? { mimeType } : undefined);
        state.mediaRecorder.ondataavailable = (ev) => {
          if (ev.data && ev.data.size > 0) state.chunks.push(ev.data);
        };
        state.mediaRecorder.onstop = () => {
          state.audioBlob = new Blob(state.chunks, { type: state.mediaRecorder.mimeType || 'audio/webm' });
          els.downloadAudio.disabled = false;
        };
      } else {
        state.mediaRecorder = null;
        els.downloadAudio.disabled = true;
        logDebug('MediaRecorder no disponible: grabo transcripción, no archivo de audio.');
      }

      state.isRecording = true;
      state.isPaused = false;
      state.recordStart = performance.now();
      state.beatStartAt = state.recordStart;
      state.pauseStart = 0;
      state.pausedTotal = 0;
      state.lastPitchAt = 0;
      if (state.mediaRecorder) state.mediaRecorder.start(250);
      startMetronome();

      els.recordBtn.disabled = true;
      if (els.cMajorTestBtn) els.cMajorTestBtn.disabled = true;
      els.pauseBtn.disabled = false;
      els.stopBtn.disabled = false;
      els.pauseBtn.textContent = 'Pausa';
      setStatus('Grabando. Toca la idea; el afinador sigue activo.');
    } catch (err) {
      console.error(err);
      setStatus(`Error grabando: ${err.message}`);
    }
  }

  function chooseMimeType() {
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    return types.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
  }

  function pauseResume() {
    if (!state.isRecording) return;
    if (!state.isPaused) {
      state.isPaused = true;
      state.pauseStart = performance.now();
      if (state.mediaRecorder && state.mediaRecorder.state === 'recording') state.mediaRecorder.pause();
      els.pauseBtn.textContent = 'Reanudar';
      setStatus('Pausado. La transcripción no cuenta este tiempo.');
    } else {
      state.pausedTotal += performance.now() - state.pauseStart;
      state.pauseStart = 0;
      state.isPaused = false;
      if (state.mediaRecorder && state.mediaRecorder.state === 'paused') state.mediaRecorder.resume();
      els.pauseBtn.textContent = 'Pausa';
      setStatus('Grabando de nuevo.');
    }
  }

  function stopRecording() {
    if (!state.isRecording) return;
    state.isRecording = false;
    state.isPaused = false;
    stopMetronome();
    if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') state.mediaRecorder.stop();

    els.recordBtn.disabled = false;
    if (els.cMajorTestBtn) els.cMajorTestBtn.disabled = false;
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
    if (mode === 'loose') return .18;
    return .12;
  }

  function silenceGapByMode(mode) {
    if (mode === 'strict') return .10;
    if (mode === 'loose') return .34;
    return .22;
  }

  function analyzeFrames(frames, s) {
    const rawFrames = frames.slice();
    const minDur = minDurationByMode(s.rhythmMode);
    const silenceGap = silenceGapByMode(s.rhythmMode);
    const beatSec = 60 / s.bpm;
    const barSec = beatSec * s.beatsPerBar;

    const cleaned = smoothMidiFrames(rawFrames, s).map(f => {
      const isNote = f.writtenMidi !== null && f.writtenMidi !== undefined;
      const inRange = isNote && f.writtenMidi >= s.minWrittenMidi && f.writtenMidi <= s.maxWrittenMidi;
      const inTuneEnough = isNote && Math.abs(f.cents || 0) <= Math.max(82, s.pitchTolerance + 38);
      if (!inRange || !inTuneEnough) return { ...f, label: 'REST', midi: null };
      const snappedMidi = s.testMode === 'c_major_scale' ? snapMidiToScale(f.writtenMidi, s.forcedScalePcs || [0,2,4,5,7,9,11]) : f.writtenMidi;
      return { ...f, writtenMidi: snappedMidi, label: noteName(snappedMidi, s.accidentals), midi: snappedMidi };
    });

    let segments = groupFrames(cleaned, silenceGap);
    segments = mergeTinySegments(segments, minDur);
    segments = mergeSameNeighbors(segments);
    segments = absorbShortRestsBetweenSameNotes(segments, silenceGap * 1.6);
    segments = trimBoundaryRests(segments, s);

    const gridBeats = chooseGridBeats(segments, s);
    const quantized = quantizeSegments(segments, gridBeats, beatSec, barSec, s.beatsPerBar);
    const rawBars = buildBars(quantized);
    const bars = simplifyBars(rawBars, s);
    const human = barsToText(bars);
    const simpleText = barsToSimpleText(bars);
    const abc = buildAbcFromBars(bars, s);
    const scaleTest = s.testMode === 'c_major_scale' ? cMajorScaleReport(bars) : null;

    return {
      summary: {
        durationSec: Number((rawFrames.at(-1)?.t || 0).toFixed(2)),
        frameCount: rawFrames.length,
        segmentCount: segments.length,
        noteCount: quantized.filter(e => e.label !== 'REST').length,
        barCount: bars.length,
        simplifyMode: s.simplifyMode,
        testMode: s.testMode || 'normal',
        scaleLock: s.testMode === 'c_major_scale' ? 'C major written pitch' : 'off',
        gridBeats,
        beatSec: Number(beatSec.toFixed(4)),
        barSec: Number(barSec.toFixed(4)),
        heldFrameCount: rawFrames.filter(f => f.held).length,
      },
      rawFrames,
      segments,
      quantized,
      rawBars,
      bars,
      human,
      simpleText,
      abc,
      plain: simpleText,
      scaleTest,
    };
  }

  function smoothMidiFrames(frames, s) {
    const out = frames.map(f => ({ ...f }));
    const radius = s.rhythmMode === 'strict' ? 1 : 2;
    for (let i = 0; i < out.length; i++) {
      if (out[i].writtenMidi === null || out[i].writtenMidi === undefined) continue;
      const window = [];
      for (let j = Math.max(0, i - radius); j <= Math.min(out.length - 1, i + radius); j++) {
        if (out[j].writtenMidi !== null && out[j].writtenMidi !== undefined) window.push(out[j].writtenMidi);
      }
      if (window.length >= 3) out[i].writtenMidi = Math.round(median(window));
    }
    return out;
  }


  function snapMidiToScale(midi, pcs) {
    const rounded = Math.round(midi);
    let best = rounded;
    let bestDist = Infinity;
    for (let m = rounded - 6; m <= rounded + 6; m++) {
      const pc = ((m % 12) + 12) % 12;
      if (!pcs.includes(pc)) continue;
      const d = Math.abs(m - midi);
      if (d < bestDist) { best = m; bestDist = d; }
    }
    return best;
  }

  function trimBoundaryRests(segments, s) {
    const out = segments.map(seg => ({ ...seg }));
    if (!out.length) return out;
    if ((s.simplifyMode === 'melodic' || s.simplifyMode === 'sketch' || s.testMode === 'c_major_scale') && out[0]?.label === 'REST') {
      // Para bocetos melódicos no interesa llenar la primera línea con esperas accidentales.
      if (out[0].duration <= (s.testMode === 'c_major_scale' ? 4 : 1.25) * (60 / s.bpm)) out.shift();
    }
    while (out.length && out[out.length - 1].label === 'REST' && out[out.length - 1].duration <= 1.25 * (60 / s.bpm)) out.pop();
    const shift = out[0]?.start || 0;
    if (shift > 0) {
      for (const seg of out) {
        seg.start = Math.max(0, seg.start - shift);
        seg.end = Math.max(seg.start, seg.end - shift);
      }
    }
    return out;
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
          segments.push({ label: 'REST', midi: null, start: lastT, end: t, duration: t - lastT, centsAvg: null, clarityAvg: null, frameCount: 0, heldFrameCount: 0 });
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
    if (noteFrames.length) {
      const midiMed = Math.round(median(noteFrames.map(f => f.midi ?? f.writtenMidi)));
      seg.midi = midiMed;
      seg.label = noteName(midiMed, settings().accidentals);
    }
    seg.centsAvg = noteFrames.length ? Number(avg(noteFrames.map(f => f.cents || 0)).toFixed(1)) : null;
    seg.clarityAvg = noteFrames.length ? Number(avg(noteFrames.map(f => f.clarity || 0)).toFixed(3)) : null;
    seg.frameCount = seg.frames.length;
    seg.heldFrameCount = noteFrames.filter(f => f.held).length;
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
    return out.filter(seg => !(seg.label !== 'REST' && seg.duration < minDur * .72));
  }

  function mergeSameNeighbors(segments) {
    const out = [];
    for (const seg of segments) {
      const prev = out[out.length - 1];
      if (prev && prev.label === seg.label) {
        prev.end = seg.end;
        prev.duration = prev.end - prev.start;
        if (prev.centsAvg !== null && seg.centsAvg !== null) prev.centsAvg = Number(((prev.centsAvg + seg.centsAvg) / 2).toFixed(1));
        prev.heldFrameCount = (prev.heldFrameCount || 0) + (seg.heldFrameCount || 0);
        continue;
      }
      out.push({ ...seg });
    }
    return out;
  }

  function absorbShortRestsBetweenSameNotes(segments, maxRestDur) {
    const out = [];
    for (let i = 0; i < segments.length; i++) {
      const a = out[out.length - 1];
      const b = segments[i];
      const c = segments[i + 1];
      if (a && b && c && b.label === 'REST' && b.duration <= maxRestDur && a.label === c.label && a.label !== 'REST') {
        a.end = c.end;
        a.duration = a.end - a.start;
        a.heldFrameCount = (a.heldFrameCount || 0) + (c.heldFrameCount || 0);
        i++;
        continue;
      }
      out.push({ ...b });
    }
    return out;
  }

  function chooseGridBeats(segments, s) {
    let grid;
    if (s.testMode === 'c_major_scale') return 1;
    if (s.quantize !== 'auto') grid = Number(s.quantize);
    else {
      const beatSec = 60 / s.bpm;
      const noteDurBeats = segments
        .filter(seg => seg.label !== 'REST')
        .map(seg => seg.duration / beatSec)
        .filter(v => Number.isFinite(v) && v > .08);
      if (!noteDurBeats.length) grid = 1;
      else {
        const med = median(noteDurBeats);
        if (med < .38) grid = .25;
        else if (med < .82) grid = .5;
        else grid = 1;
      }
    }
    if (grid <= 0) return 0;
    if (s.simplifyMode === 'melodic') grid = Math.max(grid || .5, .5);
    if (s.simplifyMode === 'sketch') grid = Math.max(grid || 1, 1);
    return grid;
  }

  function quantizeSegments(segments, gridBeats, beatSec, barSec, beatsPerBar) {
    if (!gridBeats || gridBeats <= 0) {
      return segments.map(seg => ({
        label: seg.label,
        midi: seg.midi,
        start: seg.start,
        end: seg.end,
        duration: seg.duration,
        startBeat: seg.start / beatSec,
        durationBeats: seg.duration / beatSec,
        barIndex: Math.floor(seg.start / barSec),
        beatInBar: Number(((seg.start / beatSec) % beatsPerBar).toFixed(3)),
        centsAvg: seg.centsAvg,
        clarityAvg: seg.clarityAvg,
        heldFrameCount: seg.heldFrameCount || 0,
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
        midi: seg.midi,
        start: Number(start.toFixed(4)),
        end: Number(end.toFixed(4)),
        duration: Number((end - start).toFixed(4)),
        startBeat: Number((start / beatSec).toFixed(3)),
        durationBeats: Number(((end - start) / beatSec).toFixed(3)),
        barIndex: Math.floor(start / barSec),
        beatInBar: Number(((start / beatSec) % beatsPerBar).toFixed(3)),
        centsAvg: seg.centsAvg,
        clarityAvg: seg.clarityAvg,
        heldFrameCount: seg.heldFrameCount || 0,
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
        prev.heldFrameCount = (prev.heldFrameCount || 0) + (ev.heldFrameCount || 0);
      } else {
        out.push({ ...ev });
      }
    }
    return out.filter(ev => ev.durationBeats > .05);
  }

  function buildBars(events) {
    const s = settings();
    const beatsPerBar = s.beatsPerBar || 4;
    const map = new Map();
    for (const ev of events) {
      let remaining = Math.max(0.05, ev.durationBeats || 0);
      let startBeat = ev.startBeat || 0;
      let first = true;
      while (remaining > 0.05) {
        const idx = Math.floor(startBeat / beatsPerBar);
        const beatInBar = ((startBeat % beatsPerBar) + beatsPerBar) % beatsPerBar;
        const available = Math.max(0.05, beatsPerBar - beatInBar);
        const dur = Math.min(remaining, available);
        if (!map.has(idx)) map.set(idx, []);
        map.get(idx).push({
          ...ev,
          startBeat: Number(startBeat.toFixed(3)),
          beatInBar: Number(beatInBar.toFixed(3)),
          durationBeats: Number(dur.toFixed(3)),
          continuation: !first,
        });
        remaining = Number((remaining - dur).toFixed(3));
        startBeat = Number((startBeat + dur).toFixed(3));
        first = false;
      }
    }
    return [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([index, events]) => ({ index, events: events.sort((a, b) => a.beatInBar - b.beatInBar) }));
  }


  function simplifyBars(bars, s) {
    const mode = s.simplifyMode || 'melodic';
    if (mode === 'detailed') return normalizeBarsForNotation(bars, s.beatsPerBar || 4);

    const beatsPerBar = s.beatsPerBar || 4;
    const step = mode === 'sketch' ? 1 : .5;
    const allowed = mode === 'sketch' ? [1, 2, 3, 4] : [.5, 1, 1.5, 2, 3, 4];
    const restAbsorb = mode === 'sketch' ? .75 : .5;
    const normalized = [];

    for (const bar of normalizeBarsForNotation(bars, beatsPerBar)) {
      const out = [];
      let cursor = 0;
      const events = [...bar.events].sort((a, b) => a.beatInBar - b.beatInBar);

      for (const ev of events) {
        let start = snapToStep(ev.beatInBar || 0, step);
        if (start < cursor) start = cursor;
        if (start >= beatsPerBar - 0.001) break;

        const gap = Number((start - cursor).toFixed(3));
        if (gap >= step - 0.001) out.push(makeRest(cursor, snapAllowed(gap, allowed, step)));

        let dur = snapAllowed(ev.durationBeats || step, allowed, step);
        dur = Math.min(dur, beatsPerBar - start);
        if (dur < step - 0.001) continue;

        if (ev.label === 'REST') {
          if (dur <= restAbsorb && out.length && out[out.length - 1].label !== 'REST') {
            out[out.length - 1].durationBeats = Math.min(
              beatsPerBar - out[out.length - 1].beatInBar,
              Number((out[out.length - 1].durationBeats + dur).toFixed(3))
            );
            cursor = Number((start + dur).toFixed(3));
            continue;
          }
          out.push(makeRest(start, dur));
        } else {
          out.push({ ...ev, beatInBar: Number(start.toFixed(3)), durationBeats: Number(dur.toFixed(3)) });
        }
        cursor = Number((start + dur).toFixed(3));
      }
      if (cursor < beatsPerBar - 0.001) out.push(makeRest(cursor, beatsPerBar - cursor));
      normalized.push({ index: bar.index, events: mergeNotationEvents(out) });
    }
    return normalized;
  }

  function snapToStep(value, step) {
    return Math.max(0, Math.round((value || 0) / step) * step);
  }

  function snapAllowed(value, allowed, minStep) {
    const v = Math.max(minStep, value || minStep);
    let best = allowed[0];
    let bestDist = Infinity;
    for (const a of allowed) {
      const d = Math.abs(a - v);
      if (d < bestDist) { best = a; bestDist = d; }
    }
    return best;
  }


  function cMajorScaleReport(bars) {
    const expected = ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'C'];
    const notes = [];
    for (const bar of bars || []) {
      for (const ev of bar.events || []) {
        if (ev.label !== 'REST') notes.push({ label: ev.label, letter: String(ev.label).replace(/[♭#b]/g, '').charAt(0), bar: bar.index + 1, beat: Number((ev.beatInBar + 1).toFixed(2)), durationBeats: ev.durationBeats });
      }
    }
    const checks = notes.map((n, i) => ({ ...n, expected: expected[i % expected.length], ok: n.letter === expected[i % expected.length] }));
    const errors = checks.filter(x => !x.ok);
    return {
      expectedPattern: expected.join(' '),
      detectedPattern: notes.map(n => n.letter).join(' '),
      noteCount: notes.length,
      errorCount: errors.length,
      errors: errors.slice(0, 24),
    };
  }

  function barsToSimpleText(bars) {
    if (!bars.length) return '';
    return bars.map(bar => {
      const items = bar.events
        .filter(ev => ev.label !== 'REST')
        .map(ev => `${visualNoteName(ev.label)} ${durationLabel(ev.durationBeats)}`)
        .join(' · ');
      return `Compás ${bar.index + 1}: ${items || 'silencio'}`;
    }).join('\n');
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
    clearExportLinks();
    if (!analysis.bars.length) {
      els.staff.classList.add('empty');
      els.staff.textContent = 'No hay notas para pentagrama.';
      els.bars.classList.add('empty');
      els.bars.textContent = 'No se detectaron notas estables.';
      els.plainText.value = '';
      return;
    }
    renderStaff(analysis);
    renderTimeline(analysis);
    els.plainText.value = analysis.simpleText || analysis.plain || '';
    createReadyExportLinks(analysis);
    if (analysis.abc) logDebug('ABC generado para pentagrama.');
  }

  function renderTimeline(analysis) {
    const s = settings();
    els.bars.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'timeline';
    for (const bar of analysis.bars) {
      const row = document.createElement('div');
      row.className = 'timelineBar';
      const header = document.createElement('div');
      header.className = 'timelineHeader';
      header.textContent = `${bar.index + 1}`;
      const lane = document.createElement('div');
      lane.className = 'timelineLane';
      lane.style.setProperty('--beats', s.beatsPerBar);
      for (let i = 0; i < s.beatsPerBar; i++) {
        const beat = document.createElement('span');
        beat.className = 'beatGrid';
        beat.style.left = `${(i / s.beatsPerBar) * 100}%`;
        lane.appendChild(beat);
      }
      for (const ev of bar.events) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = `eventBlock ${ev.label === 'REST' ? 'rest' : ''} ${durationClass(ev.durationBeats)}`;
        const left = clamp((ev.beatInBar || 0) / s.beatsPerBar, 0, 1) * 100;
        const width = clamp((ev.durationBeats || .25) / s.beatsPerBar, .04, 1) * 100;
        item.style.left = `${left}%`;
        item.style.width = `${Math.min(width, 100 - left)}%`;
        const name = ev.label === 'REST' ? 'sil.' : visualNoteName(ev.label);
        const cents = ev.centsAvg !== null && ev.centsAvg !== undefined ? ` · ${ev.centsAvg >= 0 ? '+' : ''}${ev.centsAvg}c` : '';
        item.innerHTML = `<span class="eventName">${escapeHtml(name)}</span><span class="eventDur">${durationGlyph(ev.durationBeats)} ${escapeHtml(durationLabel(ev.durationBeats))}</span>`;
        item.title = `${bar.index + 1}.${Number((ev.beatInBar + 1).toFixed(2))} · ${name} · ${durationLabel(ev.durationBeats)}${cents}`;
        item.addEventListener('click', () => {
          appendEditHint(bar.index + 1, ev);
        });
        lane.appendChild(item);
      }
      row.append(header, lane);
      wrap.appendChild(row);
    }
    els.bars.appendChild(wrap);
  }

  function appendEditHint(barNumber, ev) {
    const label = ev.label === 'REST' ? 'silencio' : ev.label;
    const hint = `
% revisar compás ${barNumber}, pulso ${Number((ev.beatInBar + 1).toFixed(2))}: ${label} ${durationLabel(ev.durationBeats)}`;
    if (!els.plainText.value.includes(hint.trim())) els.plainText.value += hint;
  }

  function durationClass(beats) {
    if (beats >= 3.8) return 'whole';
    if (beats >= 1.8) return 'half';
    if (beats >= .9) return 'quarter';
    if (beats >= .45) return 'eighth';
    return 'sixteenth';
  }

  function durationGlyph(beats) {
    if (beats >= 3.8) return '𝅝';
    if (beats >= 1.8) return '𝅗𝅥';
    if (beats >= .9) return '♩';
    if (beats >= .45) return '♪';
    return '♬';
  }

  function normalizeBarsForNotation(bars, beatsPerBar) {
    if (!bars?.length) return [];
    const maxIndex = Math.max(...bars.map(b => b.index));
    const byIndex = new Map(bars.map(b => [b.index, b.events || []]));
    const normalized = [];
    for (let index = 0; index <= maxIndex; index++) {
      const events = [...(byIndex.get(index) || [])].sort((a, b) => (a.beatInBar || 0) - (b.beatInBar || 0));
      const out = [];
      let cursor = 0;
      for (const ev of events) {
        let start = snapBeat(ev.beatInBar || 0);
        if (start < cursor) start = cursor;
        if (start > beatsPerBar) continue;
        if (start - cursor >= 0.125) {
          out.push(makeRest(cursor, start - cursor));
          cursor = start;
        }
        let dur = snapDuration(ev.durationBeats || 0.25);
        if (dur <= 0) continue;
        if (cursor + dur > beatsPerBar) dur = beatsPerBar - cursor;
        if (dur <= 0.05) continue;
        out.push({ ...ev, beatInBar: Number(cursor.toFixed(3)), durationBeats: Number(dur.toFixed(3)) });
        cursor = Number((cursor + dur).toFixed(3));
        if (cursor >= beatsPerBar - 0.001) break;
      }
      if (cursor < beatsPerBar - 0.001) out.push(makeRest(cursor, beatsPerBar - cursor));
      normalized.push({ index, events: mergeNotationEvents(out) });
    }
    return normalized;
  }

  function makeRest(beatInBar, durationBeats) {
    return { label: 'REST', midi: null, beatInBar: Number(beatInBar.toFixed(3)), durationBeats: Number(durationBeats.toFixed(3)), centsAvg: null, clarityAvg: null };
  }

  function snapBeat(beats) {
    return Math.max(0, Math.round((beats || 0) * 4) / 4);
  }

  function snapDuration(beats) {
    return Math.max(0.25, Math.round((beats || 0.25) * 4) / 4);
  }

  function mergeNotationEvents(events) {
    const out = [];
    for (const ev of events) {
      const prev = out[out.length - 1];
      if (prev && prev.label === ev.label && Math.abs((prev.beatInBar + prev.durationBeats) - ev.beatInBar) < 0.01) {
        prev.durationBeats = Number((prev.durationBeats + ev.durationBeats).toFixed(3));
        continue;
      }
      out.push({ ...ev });
    }
    return out;
  }

  function buildAbcFromBars(bars, s = settings()) {
    const normalized = normalizeBarsForNotation(bars, s.beatsPerBar || 4);
    const meter = `${s.beatsPerBar || 4}/4`;
    const lines = [
      'X:1',
      `T:Transcriptor ${APP_VERSION}`,
      `M:${meter}`,
      'L:1/16',
      `Q:1/4=${s.bpm}`,
      'K:C',
      'V:1 clef=treble name="Trompeta Sib"',
    ];
    if (!normalized.length) return lines.concat(['| z16 |']).join('\n');
    const barTokens = normalized.map(bar => eventsToAbcGrouped(bar.events, s.accidentals, s.beatsPerBar || 4));
    const wrapped = [];
    for (let i = 0; i < barTokens.length; i += 4) {
      wrapped.push('| ' + barTokens.slice(i, i + 4).join(' | ') + ' |');
    }
    return lines.concat(wrapped).join('\n');
  }


  function eventsToAbcGrouped(events, accidentals, beatsPerBar) {
    const groups = [];
    let current = '';
    let currentBeat = null;
    const flush = () => {
      if (current) groups.push(current);
      current = '';
      currentBeat = null;
    };
    for (const ev of events) {
      const token = eventToAbc(ev, accidentals);
      const beatGroup = Math.floor(ev.beatInBar || 0);
      const beamable = ev.label !== 'REST' && (ev.durationBeats || 0) <= .5;
      if (beamable) {
        if (current && currentBeat === beatGroup) current += token;
        else { flush(); current = token; currentBeat = beatGroup; }
      } else {
        flush();
        groups.push(token);
      }
    }
    flush();
    return groups.join(' ');
  }

  function eventToAbc(ev, accidentals) {
    const units = Math.max(1, Math.round((ev.durationBeats || 0.25) * 4));
    const dur = abcDuration(units);
    if (ev.label === 'REST') return `z${dur}`;
    return `${midiToAbc(ev.midi, accidentals)}${dur}`;
  }

  function abcDuration(units) {
    return units === 1 ? '' : String(units);
  }

  function midiToAbc(midi, accidentals = 'flats') {
    const rounded = Math.round(midi || 60);
    const pc = ((rounded % 12) + 12) % 12;
    const octave = Math.floor(rounded / 12) - 1;
    const sharpMap = [ ['C',''], ['C','^'], ['D',''], ['D','^'], ['E',''], ['F',''], ['F','^'], ['G',''], ['G','^'], ['A',''], ['A','^'], ['B',''] ];
    const flatMap  = [ ['C',''], ['D','_'], ['D',''], ['E','_'], ['E',''], ['F',''], ['G','_'], ['G',''], ['A','_'], ['A',''], ['B','_'], ['B',''] ];
    const [letter, accidental] = (accidentals === 'sharps' ? sharpMap : flatMap)[pc];
    return accidental + abcOctave(letter, octave);
  }

  function abcOctave(letter, octave) {
    if (octave >= 5) return letter.toLowerCase() + "'".repeat(octave - 5);
    if (octave === 4) return letter;
    return letter + ','.repeat(4 - octave);
  }

  function renderStaff(analysis) {
    const abc = analysis.abc || buildAbcFromBars(analysis.bars || [], settings());
    els.staff.classList.remove('empty');
    els.staff.innerHTML = '';
    if (window.ABCJS?.renderAbc) {
      try {
        window.ABCJS.renderAbc(els.staff, abc, {
          responsive: 'resize',
          add_classes: true,
          initialClef: true,
          format: {
            staffwidth: 760,
            scale: 1.0,
            lineThickness: 0.35,
          },
        });
        return;
      } catch (err) {
        console.warn('abcjs render error', err);
        logDebug(`ABCJS ERROR · ${err.message || err}`);
      }
    }
    els.staff.textContent = abc;
  }

  function yForMidiOnTreble(midi, staffBottom, lineGap) {
    // En clave de sol, la línea inferior es E4. Cada paso diatónico sube medio espacio.
    const rounded = Math.round(midi || 64);
    const octave = Math.floor(rounded / 12) - 1;
    const pcName = noteNames.sharps[((rounded % 12) + 12) % 12];
    const letter = pcName[0];
    const diatonic = octave * 7 + letterIndex[letter];
    const e4 = 4 * 7 + letterIndex.E;
    const steps = diatonic - e4;
    return staffBottom - steps * (lineGap / 2);
  }

  function ledgerLinesFor(y, x, staffTop, staffBottom, lineGap) {
    let out = '';
    if (y < staffTop) {
      for (let ly = staffTop - lineGap; ly >= y - 1; ly -= lineGap) {
        out += `<line class="ledgerLine" x1="${x - 12}" y1="${ly}" x2="${x + 12}" y2="${ly}" />`;
      }
    } else if (y > staffBottom) {
      for (let ly = staffBottom + lineGap; ly <= y + 1; ly += lineGap) {
        out += `<line class="ledgerLine" x1="${x - 12}" y1="${ly}" x2="${x + 12}" y2="${ly}" />`;
      }
    }
    return out;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
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
    const url = URL.createObjectURL(blob);
    addExportLink(filename, url, true);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 500);
    setStatus(`Exportación preparada: ${filename}. Si no baja sola, usa el enlace que aparece bajo la partitura.`);
  }

  function clearExportLinks() {
    if (!els.exportLinks) return;
    els.exportLinks.innerHTML = '';
    els.exportLinks.classList.add('empty');
  }

  function addExportLink(filename, url, revokeLater = false) {
    if (!els.exportLinks) return;
    els.exportLinks.classList.remove('empty');
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = filename.split('-').slice(-1)[0] || filename;
    a.title = filename;
    els.exportLinks.appendChild(a);
    if (revokeLater) setTimeout(() => URL.revokeObjectURL(url), 120000);
  }

  function createReadyExportLinks(analysis) {
    clearExportLinks();
    if (!analysis) return;
    addStaticTextExport('TXT', `${exportBaseName()}-transcripcion.txt`, analysis.simpleText || analysis.plain || '');
    addStaticTextExport('ABC', `${exportBaseName()}-partitura.abc`, analysis.abc || '');
    addStaticTextExport('MusicXML', `${exportBaseName()}-transcripcion.musicxml`, musicXmlFromAnalysis(analysis));
  }

  function addStaticTextExport(label, filename, text) {
    const blob = new Blob([text || ''], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    if (!els.exportLinks) return;
    els.exportLinks.classList.remove('empty');
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = label;
    a.title = filename;
    els.exportLinks.appendChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  }

  async function copy(text) {
    await navigator.clipboard.writeText(text);
  }

  function exportBaseName() {
    return `${APP_ID}-${state.sessionId || new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`;
  }

  function csvFromAnalysis(analysis) {
    if (!analysis?.bars?.length) return 'bar,beat,note,duration,durationBeats,midi,centsAvg,clarityAvg\n';
    const rows = ['bar,beat,note,duration,durationBeats,midi,centsAvg,clarityAvg'];
    for (const bar of analysis.bars) {
      for (const ev of bar.events) {
        rows.push([
          bar.index + 1,
          Number((ev.beatInBar + 1).toFixed(3)),
          ev.label === 'REST' ? 'silencio' : ev.label,
          durationLabel(ev.durationBeats),
          ev.durationBeats,
          ev.midi ?? '',
          ev.centsAvg ?? '',
          ev.clarityAvg ?? '',
        ].map(csvEscape).join(','));
      }
    }
    return rows.join('\n') + '\n';
  }

  function csvEscape(v) {
    const str = String(v);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  }

  function musicXmlFromAnalysis(analysis) {
    const s = settings();
    const divisions = 4; // negra = 4, corchea = 2, semicorchea = 1
    const measures = normalizeBarsForNotation(analysis?.bars || [], s.beatsPerBar || 4);
    const title = 'Transcriptor';
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n`;
    xml += `<score-partwise version="3.1">\n  <work><work-title>${escapeXml(title)}</work-title></work>\n`;
    xml += `  <part-list><score-part id="P1"><part-name>Trompeta en Sib</part-name></score-part></part-list>\n  <part id="P1">\n`;
    for (let i = 0; i < measures.length; i++) {
      const bar = measures[i];
      xml += `    <measure number="${bar.index + 1}">\n`;
      if (i === 0) {
        xml += `      <attributes><divisions>${divisions}</divisions><key><fifths>0</fifths></key><time><beats>${s.beatsPerBar}</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>\n`;
      }
      for (const ev of bar.events) {
        const dur = Math.max(1, Math.round((ev.durationBeats || .25) * divisions));
        const type = xmlType(ev.durationBeats || .25);
        const dot = xmlDot(ev.durationBeats || .25);
        if (ev.label === 'REST') {
          xml += `      <note><rest/><duration>${dur}</duration><type>${type}</type>${dot}</note>\n`;
        } else {
          const pitch = pitchForXml(ev.midi, s.accidentals);
          xml += `      <note><pitch><step>${pitch.step}</step>${pitch.alter !== 0 ? `<alter>${pitch.alter}</alter>` : ''}<octave>${pitch.octave}</octave></pitch><duration>${dur}</duration><type>${type}</type>${dot}</note>\n`;
        }
      }
      xml += `    </measure>\n`;
    }
    xml += `  </part>\n</score-partwise>\n`;
    return xml;
  }

  function pitchForXml(midi, accidentals) {
    const rounded = Math.round(midi || 60);
    const octave = Math.floor(rounded / 12) - 1;
    const pc = ((rounded % 12) + 12) % 12;
    const sharpMap = [ ['C',0], ['C',1], ['D',0], ['D',1], ['E',0], ['F',0], ['F',1], ['G',0], ['G',1], ['A',0], ['A',1], ['B',0] ];
    const flatMap  = [ ['C',0], ['D',-1], ['D',0], ['E',-1], ['E',0], ['F',0], ['G',-1], ['G',0], ['A',-1], ['A',0], ['B',-1], ['B',0] ];
    const [step, alter] = (accidentals === 'sharps' ? sharpMap : flatMap)[pc];
    return { step, alter, octave };
  }

  function xmlType(beats) {
    if (beats >= 3.75) return 'whole';
    if (beats >= 1.75) return 'half';
    if (beats >= .75) return 'quarter';
    if (beats >= .375) return 'eighth';
    return '16th';
  }

  function xmlDot(beats) {
    const units = Math.round((beats || 0) * 4);
    return [3, 6, 12].includes(units) ? '<dot/>' : '';
  }

  function escapeXml(str) {
    return String(str).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]));
  }


  function currentScoreSvg() {
    return els.staff?.querySelector('svg') || document.querySelector('#staff svg') || null;
  }

  function downloadScoreSvg() {
    const svg = currentScoreSvg();
    if (!svg) { setStatus('No hay pentagrama SVG para exportar.'); return; }
    const clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const xml = new XMLSerializer().serializeToString(clone);
    download(`${exportBaseName()}-partitura.svg`, new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
  }

  async function downloadScoreImage(format = 'png') {
    const svg = currentScoreSvg();
    if (!svg) { setStatus('No hay pentagrama para exportar como imagen.'); return; }
    const clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const box = svg.viewBox?.baseVal;
    const rect = svg.getBoundingClientRect();
    const srcW = Math.max(1, box?.width || rect.width || 900);
    const srcH = Math.max(1, box?.height || rect.height || 260);
    clone.setAttribute('width', String(srcW));
    clone.setAttribute('height', String(srcH));
    const xml = new XMLSerializer().serializeToString(clone);
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
    const img = new Image();
    img.decoding = 'async';
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    // DIN A4 vertical a 150 dpi: suficiente para compartir/imprimir sin reventar el móvil.
    canvas.width = 1240;
    canvas.height = 1754;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const margin = 90;
    const maxW = canvas.width - margin * 2;
    const maxH = canvas.height - margin * 2;
    const scale = Math.min(maxW / srcW, maxH / srcH);
    const drawW = srcW * scale;
    const drawH = srcH * scale;
    ctx.drawImage(img, (canvas.width - drawW) / 2, margin, drawW, drawH);
    const mime = format === 'jpg' ? 'image/jpeg' : 'image/png';
    const ext = format === 'jpg' ? 'jpg' : 'png';
    if (canvas.toBlob) {
      canvas.toBlob(blob => {
        if (!blob) { setStatus('No se pudo crear la imagen.'); return; }
        download(`${exportBaseName()}-partitura-a4.${ext}`, blob);
      }, mime, 0.94);
    } else {
      const dataUrl = canvas.toDataURL(mime, 0.94);
      addExportLink(`${exportBaseName()}-partitura-a4.${ext}`, dataUrl, false);
      setStatus(`Imagen ${ext.toUpperCase()} preparada en enlace.`);
    }
  }

  els.tunerBtn.addEventListener('click', activateTuner);
  els.recordBtn.addEventListener('click', () => startRecording('normal'));
  els.cMajorTestBtn?.addEventListener('click', () => startRecording('c_major_scale'));
  els.pauseBtn.addEventListener('click', pauseResume);
  els.stopBtn.addEventListener('click', stopRecording);
  els.tapTempo.addEventListener('click', tapTempo);

  els.copyText.addEventListener('click', async () => {
    await copy(els.plainText.value || '');
    setStatus('Transcripción copiada.');
  });

  els.downloadTxt.addEventListener('click', () => {
    const analysis = state.lastAnalysis;
    const text = analysis ? `${analysis.human || ''}

--- ABC ---
${analysis.abc || ''}` : (els.plainText.value || '');
    download(`${exportBaseName()}-transcripcion.txt`, new Blob([text], { type: 'text/plain;charset=utf-8' }));
  });

  els.downloadAbc?.addEventListener('click', () => {
    const abc = state.lastAnalysis?.abc || els.plainText.value || '';
    download(`${exportBaseName()}-partitura.abc`, new Blob([abc], { type: 'text/vnd.abc;charset=utf-8' }));
  });

  els.downloadCsv.addEventListener('click', () => {
    const csv = csvFromAnalysis(state.lastAnalysis);
    download(`${exportBaseName()}-transcripcion.csv`, new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  });

  els.downloadMusicXml.addEventListener('click', () => {
    const xml = musicXmlFromAnalysis(state.lastAnalysis || { bars: [] });
    download(`${exportBaseName()}-transcripcion.musicxml`, new Blob([xml], { type: 'application/vnd.recordare.musicxml+xml;charset=utf-8' }));
  });

  els.downloadSvg?.addEventListener('click', downloadScoreSvg);
  els.downloadPng?.addEventListener('click', () => downloadScoreImage('png'));
  els.downloadJpg?.addEventListener('click', () => downloadScoreImage('jpg'));

  els.downloadJson.addEventListener('click', () => {
    const report = buildReport(true);
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    download(`${exportBaseName()}-report.json`, blob);
  });

  els.downloadAudio.addEventListener('click', () => {
    if (!state.audioBlob) return;
    const ext = state.audioBlob.type.includes('mp4') ? 'm4a' : 'webm';
    download(`${state.sessionId || 'transcriptor'}.${ext}`, state.audioBlob);
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

  [els.beatsPerBar, els.bpm].forEach(el => el.addEventListener('input', () => { state.beatStartAt = performance.now(); updateBeatIndicator(true); }));
  [els.pitchTolerance, els.accidentals, els.micSensitivity].forEach(el => el?.addEventListener('change', () => updateTuner(state.lastStableData, null, settings())));
  updateBeatIndicator(true);
  startBeatLoop();

  document.addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'd') {
      ev.preventDefault();
      els.debugToggle.click();
    }
    if (ev.code === 'Space' && document.activeElement.tagName !== 'TEXTAREA' && document.activeElement.tagName !== 'INPUT') {
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
