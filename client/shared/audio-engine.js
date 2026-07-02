/**
 * Procedural SNES-style Audio engine. Real Web Audio API playback — music,
 * SFX, ambience — synthesized entirely in-browser, no samples. Wholly
 * separate from the text-based "Sound" system (server/engine/sounds.js);
 * never merge the two.
 *
 * Dual-mode like client/shared/tagHelpers.js: attaches to window/globalThis
 * so it works as a plain <script> include in both the devpanel (classic
 * scripts only) and the game client (ESM, but globals are still visible
 * inside modules).
 *
 * Server is authoritative for *when* things play (see plugins/audio/) and
 * sends fully-resolved asset rows over the WS connection; this engine only
 * renders what it's told, plus exposes local preview playback for devpanel
 * editor tooling.
 */
(function (global) {

  // ── Note / frequency helpers ──────────────────────────────────────────────

  const NOTE_INDEX = {
    C: 0, 'C#': 1, 'Db': 1, D: 2, 'D#': 3, 'Eb': 3,
    E: 4, F: 5, 'F#': 6, 'Gb': 6, G: 7, 'G#': 8, 'Ab': 8,
    A: 9, 'A#': 10, 'Bb': 10, B: 11, 'Cb': 11,
  };

  function noteToFreq(note) {
    if (note == null || note === 'R' || note === '') return null;
    if (typeof note === 'number') return note;
    const m = /^([A-G][#b]?)(-?\d+)$/.exec(String(note).trim());
    if (!m) return null;
    const semitone = NOTE_INDEX[m[1]];
    if (semitone === undefined) return null;
    const octave = parseInt(m[2], 10);
    const midi = (octave + 1) * 12 + semitone;
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  // ── Context + buses ────────────────────────────────────────────────────────

  let ctx = null;
  let masterGain, musicGain, sfxGain, ambientGain, tvGain;
  let _noiseBuffer = null;
  let _settings = { enabled: true, music: true, sfx: true, tv: true, masterVolume: 0.8, musicVolume: 0.7, sfxVolume: 0.9, ambientVolume: 0.3, tvVolume: 0.6, muteWhenHidden: true };
  let _hiddenDucked = false;

  function ensureContext() {
    if (ctx) return ctx;
    const AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    masterGain = ctx.createGain();
    masterGain.connect(ctx.destination);
    musicGain = ctx.createGain();
    sfxGain = ctx.createGain();
    ambientGain = ctx.createGain();
    tvGain = ctx.createGain();
    musicGain.connect(masterGain);
    sfxGain.connect(masterGain);
    ambientGain.connect(masterGain);
    tvGain.connect(masterGain);
    _applyGains();
    return ctx;
  }

  function getNoiseBuffer() {
    if (_noiseBuffer) return _noiseBuffer;
    const c = ensureContext();
    const length = c.sampleRate * 2;
    const buf = c.createBuffer(1, length, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    _noiseBuffer = buf;
    return buf;
  }

  function init() {
    const c = ensureContext();
    if (c && c.state === 'suspended') c.resume();
    return c;
  }

  function _masterTarget() {
    if (_hiddenDucked) return 0;
    return _settings.enabled ? (_settings.masterVolume ?? 1) : 0;
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (!ctx) return;
      const shouldDuck = document.hidden && _settings.muteWhenHidden;
      if (shouldDuck === _hiddenDucked) return;
      _hiddenDucked = shouldDuck;
      masterGain.gain.setTargetAtTime(_masterTarget(), ctx.currentTime, 0.05);
    });

    // Mobile browsers require a user gesture before AudioContext can run.
    // Install a one-shot unlock listener so the context is created and resumed
    // on first tap/click — well before any server-pushed audio message arrives.
    function _unlockAudio() {
      ensureContext();
      if (ctx && ctx.state === 'suspended') ctx.resume();
      document.removeEventListener('touchstart', _unlockAudio, true);
      document.removeEventListener('click',      _unlockAudio, true);
    }
    document.addEventListener('touchstart', _unlockAudio, true);
    document.addEventListener('click',      _unlockAudio, true);
  }

  function _applyGains() {
    if (!ctx) return;
    const t = ctx.currentTime;
    masterGain.gain.setTargetAtTime(_masterTarget(), t, 0.02);
    musicGain.gain.setTargetAtTime(_settings.music ? _settings.musicVolume : 0, t, 0.02);
    sfxGain.gain.setTargetAtTime(_settings.sfx ? _settings.sfxVolume : 0, t, 0.02);
    ambientGain.gain.setTargetAtTime(_settings.ambientVolume ?? 0.5, t, 0.02);
    tvGain.gain.setTargetAtTime(_settings.tv ? _settings.tvVolume : 0, t, 0.02);
  }

  function applyVolumeSettings(settings) {
    _settings = { ..._settings, ...(settings || {}) };
    if (ctx) _applyGains();
  }

  function busFor(category) {
    if (category === 'tv') return tvGain;
    if (category === 'ambient') return ambientGain;
    if (category === 'music') return musicGain;
    return sfxGain;
  }

  // ── 16-voice manager with priority stealing ───────────────────────────────

  const MAX_VOICES = 16;
  const MAX_CHANNELS = 16; // tracker songs play at most 16 channels; extras are ignored
  const voices = new Array(MAX_VOICES).fill(null); // {priority, startedAt, stop()} | null

  function allocateVoice(priority) {
    for (let i = 0; i < MAX_VOICES; i++) {
      if (!voices[i]) return i;
    }
    // Steal the lowest-priority, oldest active voice — but only if it's no
    // more important than the incoming sound. Otherwise the sound is dropped.
    let stealIdx = -1;
    for (let i = 0; i < MAX_VOICES; i++) {
      const v = voices[i];
      if (v.priority > priority) continue;
      if (stealIdx === -1 || v.priority < voices[stealIdx].priority ||
          (v.priority === voices[stealIdx].priority && v.startedAt < voices[stealIdx].startedAt)) {
        stealIdx = i;
      }
    }
    if (stealIdx === -1) return -1;
    voices[stealIdx].stop(true);
    voices[stealIdx] = null;
    return stealIdx;
  }

  function occupyVoice(idx, priority, stopFn) {
    voices[idx] = { priority, startedAt: ctx.currentTime, stop: stopFn };
  }

  function freeVoice(idx) {
    if (voices[idx]) voices[idx] = null;
  }

  // ── Layer graph builder (shared by instruments, SFX, ambience) ───────────
  // layer: { waveform, freq, detune, noiseMix, filter:{type,freq,q}, adsr:{a,d,s,r},
  //          vibrato:{rate,depth}, tremolo:{rate,depth}, pitchBend:{to,time}, gain }

  function buildLayer(layer, destination, time, holdSeconds) {
    const nodes = [];
    if (layer.delay) time = time + layer.delay;
    const adsr = layer.adsr || { a: 0.01, d: 0.05, s: 0.7, r: 0.15 };
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, time);
    let tone = null;
    const noiseMix = layer.noiseMix ?? (layer.waveform === 'noise' ? 1 : 0);

    if (noiseMix < 1) {
      tone = ctx.createOscillator();
      tone.type = ['sine', 'square', 'sawtooth', 'triangle'].includes(layer.waveform) ? layer.waveform : 'square';
      const freq = layer.freq || 440;
      tone.frequency.setValueAtTime(freq, time);
      if (layer.detune) tone.detune.setValueAtTime(layer.detune, time);
      if (layer.pitchBend?.to) {
        tone.frequency.setTargetAtTime(layer.pitchBend.to, time, Math.max(0.01, (layer.pitchBend.time || 0.2) / 3));
      }
      if (layer.vibrato?.rate) {
        const lfo = ctx.createOscillator();
        lfo.frequency.value = layer.vibrato.rate;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = layer.vibrato.depth || 10;
        lfo.connect(lfoGain).connect(tone.detune);
        lfo.start(time);
        nodes.push(lfo);
      }
      // Audio-rate FM: modulator oscillator feeds tone.frequency (in Hz).
      // depth is the frequency deviation in Hz; index = depth / carrier_freq.
      if (layer.fm?.rate) {
        const mod = ctx.createOscillator();
        mod.frequency.value = layer.fm.rate;
        const modGain = ctx.createGain();
        modGain.gain.value = layer.fm.depth ?? 100;
        mod.connect(modGain).connect(tone.frequency);
        mod.start(time);
        nodes.push(mod);
      }
    }

    let noiseSrc = null;
    if (noiseMix > 0) {
      noiseSrc = ctx.createBufferSource();
      noiseSrc.buffer = getNoiseBuffer();
      noiseSrc.loop = true;
    }

    let mixPoint = gain;
    if (layer.filter) {
      const filter = ctx.createBiquadFilter();
      filter.type = layer.filter.type || 'lowpass';
      filter.frequency.value = layer.filter.freq || 4000;
      filter.Q.value = layer.filter.q ?? 1;
      gain.connect(filter);
      mixPoint = filter;
    }

    if (layer.tremolo?.rate) {
      const tGain = ctx.createGain();
      mixPoint.connect(tGain);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = layer.tremolo.rate;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = layer.tremolo.depth ?? 0.3;
      lfo.connect(lfoGain);
      tGain.gain.value = 1;
      lfoGain.connect(tGain.gain);
      lfo.start(time);
      nodes.push(lfo);
      mixPoint = tGain;
    }

    // Echo: delay + feedback loop. mix 0–1; delay in seconds; feedback 0–1.
    if (layer.echo?.mix > 0) {
      const mix = layer.echo.mix;
      const delayNode = ctx.createDelay(2.0);
      delayNode.delayTime.value = layer.echo.delay ?? 0.18;
      const fb = ctx.createGain(); fb.gain.value = layer.echo.feedback ?? 0.35;
      const dry = ctx.createGain(); dry.gain.value = 1 - mix;
      const wet = ctx.createGain(); wet.gain.value = mix;
      mixPoint.connect(dry).connect(destination);
      mixPoint.connect(wet).connect(delayNode);
      delayNode.connect(fb).connect(delayNode);
      delayNode.connect(destination);
    } else {
      mixPoint.connect(destination);
    }

    if (tone) {
      const toneGain = noiseMix > 0 ? ctx.createGain() : null;
      if (toneGain) { toneGain.gain.value = 1 - noiseMix; tone.connect(toneGain).connect(gain); }
      else tone.connect(gain);
      tone.start(time);
      nodes.push(tone);
    }
    if (noiseSrc) {
      const noiseGain = ctx.createGain();
      noiseGain.gain.value = noiseMix;
      noiseSrc.connect(noiseGain).connect(gain);
      noiseSrc.start(time);
      nodes.push(noiseSrc);
    }

    // ADSR
    const peak = layer.gain ?? 1;
    const sustainLevel = peak * (adsr.s ?? 0.7);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(peak, time + (adsr.a ?? 0.01));
    gain.gain.linearRampToValueAtTime(sustainLevel, time + (adsr.a ?? 0.01) + (adsr.d ?? 0.05));

    const releaseTime = adsr.r ?? 0.15;
    let released = false;
    function release(atTime) {
      if (released) return;
      released = true;
      const t = Math.max(atTime, ctx.currentTime);
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(0, t + releaseTime);
      for (const n of nodes) {
        try { n.stop(t + releaseTime + 0.02); } catch { /* lfo already stopped */ }
      }
    }

    if (holdSeconds != null) {
      release(time + (adsr.a ?? 0.01) + (adsr.d ?? 0.05) + holdSeconds);
    }

    return { release, gainNode: gain };
  }

  function buildSound(config, destination, time, holdSeconds) {
    const layers = Array.isArray(config.layers) && config.layers.length ? config.layers : [config];
    const releases = layers.map(l => buildLayer(l, destination, time, holdSeconds));
    // gainNode is exposed so loops can be ridden up/down live (see setLoopGain).
    // For multi-layer sounds this only exposes the first layer's gain — fine for
    // the single-layer loops (ambience, TV static/hum) that actually use it.
    return { release: (t) => releases.forEach(r => r.release(t)), gainNode: releases[0]?.gainNode };
  }

  // ── SNES-style sample playback ─────────────────────────────────────────────
  // Samples are fetched once from /audio/samples/:id/data, then processed:
  // 1. decode audio, 2. downsample to snes_rate via OfflineAudioContext,
  // 3. bit-crush in place. Result cached by id for the session lifetime.

  const _sampleCache = new Map(); // id -> processed AudioBuffer

  async function _processSnes(rawBuffer, snesRate, snesBits) {
    const ratio = rawBuffer.sampleRate / snesRate;
    const outLen = Math.max(1, Math.ceil(rawBuffer.length / ratio));
    const off = new OfflineAudioContext(1, outLen, snesRate);
    const src = off.createBufferSource();
    src.buffer = rawBuffer;
    src.connect(off.destination);
    src.start(0);
    const lo = await off.startRendering();
    // Bit-crush: quantise to snesBits depth
    const d = lo.getChannelData(0);
    const step = Math.pow(2, snesBits - 1);
    for (let i = 0; i < d.length; i++) d[i] = Math.round(d[i] * step) / step;
    return lo;
  }

  async function loadSample(def) {
    if (_sampleCache.has(def.id)) return _sampleCache.get(def.id);
    const c = ensureContext();
    if (!c) return null;
    try {
      // Locally-imported samples (AMP jukebox) carry their base64 WAV inline, so
      // there's no server row to fetch — decode the inline data directly.
      let data = def.data;
      if (!data) {
        const res = await fetch(`/api/audio/samples/${def.id}/data`);
        const json = await res.json();
        data = json.data;
      }
      if (!data) { console.warn('[audio] loadSample: no data for', def.id); return null; }
      // Strip data URL prefix if present (e.g. "data:audio/mpeg;base64,...")
      const comma = data.indexOf(',');
      if (comma !== -1) data = data.slice(comma + 1);
      const bytes = Uint8Array.from(atob(data), ch => ch.charCodeAt(0));
      console.log(`[audio] loadSample decoding ${def.id} (${bytes.length} bytes, mime: ${def.mime_type})`);
      const raw = await c.decodeAudioData(bytes.buffer);
      const processed = await _processSnes(raw, def.snes_rate ?? 16000, def.snes_bits ?? 4);
      _sampleCache.set(def.id, processed);
      return processed;
    } catch (e) {
      console.warn('[audio] loadSample failed:', def.id, e.message);
      return null;
    }
  }

  function _noteToMidi(note) {
    if (typeof note === 'number') return note;
    const m = /^([A-G][#b]?)(-?\d+)$/.exec(String(note).trim());
    if (!m) return 60;
    const semitone = NOTE_INDEX[m[1]];
    if (semitone === undefined) return 60;
    return (parseInt(m[2], 10) + 1) * 12 + semitone;
  }

  // Core playback from a pre-decoded buffer. schedTime is an AudioContext timestamp.
  function _playSampleFromBuffer(buf, def, opts, schedTime) {
    const c = ctx;
    if (!c || !buf) return;
    const adsr = def.config?.adsr ?? { a: 0.01, d: 0, s: 1, r: 0.3 };
    const peak = (def.config?.gain ?? 1) * (opts.gain ?? 1);
    const idx = allocateVoice(def.priority ?? 5);
    if (idx === -1) return;

    // Pitch shift: MIDI note → playback rate; Gaussian warmth = lowpass tightens with pitch deviation
    const baseFreq = 440 * Math.pow(2, ((def.base_note ?? 60) - 69) / 12);
    const midiNote = opts.note ?? (def.base_note ?? 60);
    const targetFreq = 440 * Math.pow(2, (midiNote - 69) / 12);
    const rate = targetFreq / baseFreq;

    const gainNode = c.createGain();
    gainNode.gain.setValueAtTime(0, schedTime);
    gainNode.gain.linearRampToValueAtTime(peak, schedTime + (adsr.a ?? 0.01));
    gainNode.gain.linearRampToValueAtTime(peak * (adsr.s ?? 1), schedTime + (adsr.a ?? 0.01) + (adsr.d ?? 0));

    const warmth = c.createBiquadFilter();
    warmth.type = 'lowpass';
    warmth.frequency.value = Math.max(3000, 18000 / rate);

    const srcNode = c.createBufferSource();
    srcNode.buffer = buf;
    srcNode.playbackRate.value = rate;
    // Static detune (cents) — used for MOD sample finetune. Song fx (vibrato) add on
    // top of this via LFOs connected to the same detune param.
    if (def.config?.detune) srcNode.detune.value = def.config.detune;
    if ((def.loop_end ?? 0) > 0) {
      srcNode.loop = true;
      srcNode.loopStart = def.loop_start ?? 0;
      srcNode.loopEnd = def.loop_end;
    }

    const naturalDuration = buf.duration / rate;
    const isLooping = (def.loop_end ?? 0) > 0;
    const releaseTime = adsr.r ?? 0.3;
    const holdSec = isLooping
      ? (def.config?.duration ?? 4)
      : Math.max(0, naturalDuration - (adsr.a ?? 0.01) - (adsr.d ?? 0) - releaseTime);
    const releaseAt = schedTime + (adsr.a ?? 0.01) + (adsr.d ?? 0) + holdSec;
    const endAt = releaseAt + releaseTime + 0.1;

    srcNode.connect(warmth);

    if ((def.echo_mix ?? 0) > 0) {
      const mix = def.echo_mix;
      const delay = c.createDelay(0.5);
      delay.delayTime.value = 0.18;
      const fb = c.createGain(); fb.gain.value = 0.35;
      const dryGain = c.createGain(); dryGain.gain.value = 1 - mix;
      const wetGain = c.createGain(); wetGain.gain.value = mix;
      warmth.connect(dryGain).connect(gainNode);
      warmth.connect(wetGain).connect(delay);
      delay.connect(fb).connect(delay);
      delay.connect(gainNode);
    } else {
      warmth.connect(gainNode);
    }
    gainNode.connect(opts.destination || busFor(def.category));

    srcNode.start(schedTime);
    srcNode.stop(endAt);

    gainNode.gain.setTargetAtTime(0, releaseAt, Math.max(0.01, (adsr.r ?? 0.3) / 3));

    const stopFn = () => {
      gainNode.gain.cancelScheduledValues(c.currentTime);
      gainNode.gain.setTargetAtTime(0, c.currentTime, 0.02);
    };
    occupyVoice(idx, def.priority ?? 5, stopFn);
    const msUntilFree = Math.max(100, (endAt - c.currentTime + 0.1) * 1000);
    setTimeout(() => freeVoice(idx), msUntilFree);

    // Voice handle: per-channel monophony (a new note cuts the one still ringing with
    // a short fade, avoiding the click of a hard stop) plus the params and running
    // state that song fx (arpeggio, portamento, vibrato, volume slide) modulate live.
    const auxNodes = [];
    return {
      srcNode, gainNode,
      baseRate: rate, basePeak: peak, baseNote: def.base_note ?? 60,
      _rate: rate, _vol: peak, _toneTarget: null,
      attachAux(n) { auxNodes.push(n); },
      cut(atTime) {
        const t = Math.max(atTime, c.currentTime);
        gainNode.gain.cancelScheduledValues(t);
        gainNode.gain.setTargetAtTime(0, t, 0.006);
        try { srcNode.stop(t + 0.05); } catch { /* already stopped */ }
        for (const n of auxNodes) { try { n.stop(t + 0.05); } catch { /* already stopped */ } }
      },
    };
  }

  async function playSample(def, opts = {}) {
    if (!def) return;
    ensureContext();
    const buf = await loadSample(def);
    if (!buf) return;
    _playSampleFromBuffer(buf, def, opts, ctx.currentTime);
  }

  // ── SFX (one-shots) ────────────────────────────────────────────────────────

  function playSfx(def, gainMultiplier = 1) {
    const c = init();
    if (!c || !def?.config) return;
    const priority = def.priority ?? 5;
    const idx = allocateVoice(priority);
    if (idx === -1) return; // dropped — all higher/equal-priority voices busy
    const time = c.currentTime;
    const duration = def.config.duration ?? 0.4;
    let destination = busFor(def.category);
    if (gainMultiplier !== 1) {
      const g = c.createGain();
      g.gain.value = gainMultiplier;
      g.connect(destination);
      destination = g;
    }
    const sound = buildSound(def.config, destination, time, duration);
    occupyVoice(idx, priority, () => sound.release(c.currentTime));
    setTimeout(() => freeVoice(idx), (duration + (def.config.adsr?.r ?? 0.15) + 0.1) * 1000);
  }

  // ── Ambience / arbitrary loops ─────────────────────────────────────────────

  const activeLoops = new Map(); // id -> { voiceIdx, release }

  // Pitch-jitter a clone of a layer array so repeated sparkle firings never sound
  // mechanically identical. `jitter` is a fraction (0.1 = ±10%) applied to freq
  // and pitchBend targets. Deep-ish clone keeps the source def untouched.
  function _jitterLayers(layers, jitter) {
    const j = jitter || 0;
    return layers.map(l => {
      const c = { ...l };
      const f = 1 + (Math.random() * 2 - 1) * j;
      if (typeof c.freq === 'number') c.freq = c.freq * f;
      if (c.pitchBend?.to) c.pitchBend = { ...c.pitchBend, to: c.pitchBend.to * f };
      if (c.filter) c.filter = { ...c.filter };
      return c;
    });
  }

  // One-shot fired into the ambient (or tv) bus without touching the voice
  // manager — sparkles are tiny, cheap, and must never steal or be stolen by
  // the bed loop they decorate.
  function _playAmbientOneShot(layers, duration, gainMult, category) {
    const c = ctx;
    if (!c) return;
    let destination = busFor(category === 'tv' ? 'tv' : 'ambient');
    if (gainMult != null && gainMult !== 1) {
      const g = c.createGain();
      g.gain.value = gainMult;
      g.connect(destination);
      destination = g;
    }
    buildSound({ layers }, destination, c.currentTime, duration ?? 0.2);
  }

  // Randomized decorative one-shots layered over a bed loop — the "little beeps,
  // relay clunks and gauge chirps" that turn a static drone into a machine that
  // sounds alive. Each spec schedules itself on a randomized interval:
  //   { everyMin, everyMax, prob, gain, duration, jitter, layers }
  // Returns an array of cancel functions the loop record holds for cleanup.
  function _startSparkles(sparkles, category) {
    const cancels = [];
    for (const spec of sparkles) {
      let timer = null;
      let alive = true;
      const min = spec.everyMin ?? 3;
      const max = spec.everyMax ?? Math.max(min, min * 2.5);
      const schedule = () => {
        if (!alive) return;
        const wait = (min + Math.random() * Math.max(0, max - min)) * 1000;
        timer = setTimeout(() => {
          if (!alive) return;
          if (Math.random() < (spec.prob ?? 1)) {
            const g = (spec.gain ?? 1) * (0.7 + Math.random() * 0.6); // ±volume life
            _playAmbientOneShot(_jitterLayers(spec.layers || [], spec.jitter ?? 0.12), spec.duration, g, category);
          }
          schedule();
        }, wait);
      };
      schedule();
      cancels.push(() => { alive = false; if (timer) clearTimeout(timer); });
    }
    return cancels;
  }

  function loopSound(def) {
    const c = init();
    if (!c || !def) return;
    const id = def.id || def.name;
    if (activeLoops.has(id)) return;
    const priority = def.priority ?? 1;
    const idx = allocateVoice(priority);
    if (idx === -1) return;
    const time = c.currentTime;
    // Loops are inherently ambient-type sound (one-shots use playSfx instead),
    // so they default to the Ambient bus/volume regardless of their content
    // category (e.g. an audio_ambient row tagged "environment") — 'tv' is the
    // one deliberate override, so CRT hum/static answer to the TV Audio toggle
    // instead of the generic Ambient slider.
    const sound = buildSound(def.config || {}, busFor(def.category === 'tv' ? 'tv' : 'ambient'), time, null);
    const baseGain = def.config?.gain ?? 1;
    // Optional randomized decoration (beeps/clunks/chirps) riding over the bed.
    const sparkleCancels = Array.isArray(def.config?.sparkle) && def.config.sparkle.length
      ? _startSparkles(def.config.sparkle, def.category)
      : null;
    activeLoops.set(id, { voiceIdx: idx, release: sound.release, gainNode: sound.gainNode, baseGain, sparkleCancels });
    occupyVoice(idx, priority, () => { sound.release(c.currentTime); if (sparkleCancels) sparkleCancels.forEach(fn => fn()); activeLoops.delete(id); });
  }

  function stopLoop(id) {
    const loop = activeLoops.get(id);
    if (!loop) return;
    if (loop.sparkleCancels) loop.sparkleCancels.forEach(fn => fn());
    voices[loop.voiceIdx]?.stop(false);
    freeVoice(loop.voiceIdx);
    activeLoops.delete(id);
  }

  // Rides an already-playing loop's volume up/down without restarting it —
  // e.g. TV static tracking how far off-channel a dial currently is.
  // fraction is 0-1, scaled against the loop's own configured gain.
  // Explicitly cancels+rewrites scheduled automation rather than layering a
  // setTargetAtTime on top of it — the loop's own attack/decay ramp from
  // buildLayer() is still scheduled for the first ~100ms after creation, and
  // without cancellation it fires regardless and snaps gain back to the
  // sustain level a moment after this call sets it toward 0.
  function setLoopGain(id, fraction, rampSeconds = 0.05) {
    const loop = activeLoops.get(id);
    if (!loop?.gainNode) return;
    const target = loop.baseGain * Math.max(0, Math.min(1, fraction));
    const now = ctx.currentTime;
    const g = loop.gainNode.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(target, now + Math.max(rampSeconds, 0.01));
  }

  // ── Song player (tracker-style step sequencer) ─────────────────────────────

  const STEPS_PER_BEAT = 4; // one tracker row == a 16th note

  // ── Tracker note effects (MOD import) ──────────────────────────────────────
  // These are perceptual approximations of ProTracker effects, not a sample-accurate
  // replay: pitch is modulated in playback-rate/cents space rather than Amiga periods,
  // and the tunables below are hand-picked for feel. Only sample-backed voices carry
  // these (a voice handle with a srcNode); synth voices ignore them.
  const MOD_TICKS = 6;       // assumed ticks/row (MOD default speed) — arpeggio subdivides the row by this
  const PORTA_SEMI = 0.28;   // semitones/row per porta unit
  const VIB_HZ = 0.55;       // vibrato LFO Hz per rate unit
  const VIB_CENTS = 7;       // vibrato depth (cents) per depth unit

  function applySampleFx(voice, fx, time, rowSeconds) {
    if (!fx || !voice || !voice.srcNode) return;
    const c = ctx;
    const rate = voice.srcNode.playbackRate;
    switch (fx.t) {
      case 'arp': {
        // Cycle base / +x / +y semitones once per tick across the row (chiptune warble).
        const offs = [0, fx.x, fx.y];
        const tickDur = rowSeconds / MOD_TICKS;
        for (let k = 0; k < MOD_TICKS; k++) {
          rate.setValueAtTime(voice.baseRate * Math.pow(2, offs[k % 3] / 12), time + k * tickDur);
        }
        rate.setValueAtTime(voice.baseRate, time + rowSeconds);
        break;
      }
      case 'porta': {
        if (!fx.speed) break;
        const cur = voice._rate;
        const target = cur * Math.pow(2, (fx.dir * fx.speed * PORTA_SEMI) / 12);
        rate.cancelScheduledValues(time);
        rate.setValueAtTime(cur, time);
        rate.linearRampToValueAtTime(target, time + rowSeconds);
        voice._rate = target;
        break;
      }
      case 'vib': {
        if (!fx.depth) break;
        const lfo = c.createOscillator();
        lfo.frequency.value = Math.max(0.1, fx.rate * VIB_HZ);
        const depth = c.createGain();
        depth.gain.value = fx.depth * VIB_CENTS;
        lfo.connect(depth).connect(voice.srcNode.detune);
        lfo.start(time);
        voice.attachAux(lfo);
        break;
      }
      case 'volslide': {
        if (!fx.up && !fx.down) break;
        const g = voice.gainNode.gain;
        const target = Math.max(0, Math.min(1.5, voice._vol + ((fx.up - fx.down) * MOD_TICKS) / 64));
        g.cancelScheduledValues(time);
        g.setValueAtTime(voice._vol, time);
        g.linearRampToValueAtTime(target, time + rowSeconds);
        voice._vol = target;
        break;
      }
    }
  }

  function makeSongPlayer(def, outputGain) {
    const c = ctx;
    const channels = (Array.isArray(def.channels) ? def.channels : []).slice(0, MAX_CHANNELS);
    const length = channels.reduce((m, ch) => Math.max(m, ch.length), 0);
    const loopStart = def.loop_start || 0;
    const loopEnd = def.loop_end > loopStart ? def.loop_end : (length - 1);
    const stepSeconds = 60 / (def.tempo || 120) / STEPS_PER_BEAT;
    const priority = def.priority ?? 5;

    // Optional per-channel stereo pan (MOD import sets Amiga L-R-R-L). Songs without
    // channel_pan stay mono — hand-authored content is unaffected.
    const pans = Array.isArray(def.channel_pan) && def.channel_pan.length ? def.channel_pan : null;
    // Per-channel headroom only for sample-backed songs (MOD imports), whose many
    // full-scale 8-bit samples would otherwise clip when summed. Pure-synth songs are
    // left at unity so their hand-tuned loudness is unchanged.
    const sampleBacked = Object.values(def._instrumentsById || {}).some(i => i && i._sampleDef);
    const chComp = sampleBacked ? 1 / Math.sqrt(Math.max(1, channels.length)) : 1;
    const channelGains = channels.map((_, i) => {
      const g = c.createGain();
      g.gain.value = chComp;
      if (pans && pans[i] != null && c.createStereoPanner) {
        const p = c.createStereoPanner();
        p.pan.value = Math.max(-1, Math.min(1, pans[i]));
        g.connect(p); p.connect(outputGain);
      } else {
        g.connect(outputGain);
      }
      return g;
    });
    // One live voice per channel — trackers are monophonic per channel, so a new note
    // cuts whatever is still ringing. Without this, looped/long samples bleed under the
    // following notes.
    const channelVoice = channels.map(() => null);

    let currentStep = loopStart;
    let nextStepTime = c.currentTime;
    let timer = null;
    let stopped = false;
    let onLoopWrap = null;

    function scheduleStep(stepIdx, time) {
      channels.forEach((ch, chIdx) => {
        const step = ch[stepIdx % ch.length];
        if (!step) return;
        const hasNote = step.note != null;
        const fx = step.fx;
        if (!hasNote && !fx) return;
        const live = channelVoice[chIdx];

        // Tone portamento: slide the ringing voice toward the target note without
        // retriggering. A note on the row (re)sets the target; note-less rows keep
        // sliding toward the last target.
        if (fx && fx.t === 'toneporta' && live && live.srcNode) {
          let target = live._toneTarget;
          if (hasNote) { target = Math.pow(2, (_noteToMidi(step.note) - (live.baseNote ?? 60)) / 12); live._toneTarget = target; }
          if (target != null) {
            const rp = live.srcNode.playbackRate;
            rp.cancelScheduledValues(time);
            rp.setValueAtTime(live._rate, time);
            rp.linearRampToValueAtTime(target, time + stepSeconds);
            live._rate = target;
          }
          return;
        }

        // Continuation effect on a note-less row: modulate the still-ringing voice.
        if (!hasNote) {
          if (fx && live) applySampleFx(live, fx, time, stepSeconds);
          return;
        }

        // A new note plays: cut whatever this channel was still playing (monophony).
        const instrument = (def._instrumentsById && def._instrumentsById[step.instrument]) || {};
        if (live) { live.cut(time); channelVoice[chIdx] = null; }

        // Sample-backed instrument: pitch-shift the sample buffer instead of synthesis.
        // Route through this channel's gain node (not the SFX bus) so the song's
        // per-channel mix, fades, and Music volume all apply.
        if (instrument._sampleDef) {
          const midi = _noteToMidi(step.note);
          const sampleOpts = { note: midi, gain: step.vol ?? 1, destination: channelGains[chIdx] };
          const onVoice = (v) => { if (v) { channelVoice[chIdx] = v; if (fx) applySampleFx(v, fx, time, stepSeconds); } };
          const cached = _sampleCache.get(instrument._sampleDef.id);
          if (cached) {
            onVoice(_playSampleFromBuffer(cached, instrument._sampleDef, sampleOpts, time));
          } else {
            // First encounter: load async then play immediately (note will be slightly late)
            loadSample(instrument._sampleDef).then(buf => {
              if (buf) onVoice(_playSampleFromBuffer(buf, instrument._sampleDef, sampleOpts, c.currentTime));
            });
          }
          return;
        }

        const freq = noteToFreq(step.note);
        if (freq == null) return;
        const config = { ...(instrument.config || {}), waveform: instrument.waveform || 'square', freq };
        config.gain = (config.gain ?? 1) * (step.vol ?? 1);
        const idx = allocateVoice(priority);
        if (idx === -1) return;
        const sound = buildSound(config, channelGains[chIdx], time, stepSeconds * 0.9);
        channelVoice[chIdx] = { cut: (t) => sound.release(t), srcNode: null };
        occupyVoice(idx, priority, () => sound.release(c.currentTime));
        const ms = Math.max(0, (time - c.currentTime) * 1000) + (stepSeconds * 1000) + 200;
        setTimeout(() => freeVoice(idx), ms);
      });
      if (def.onStep) {
        const delay = Math.max(0, (time - c.currentTime) * 1000);
        const active = channels.map(ch => !!(ch[stepIdx % ch.length]?.note));
        setTimeout(() => def.onStep(stepIdx, active), delay);
      }
    }

    function scheduler() {
      if (stopped) return;
      while (nextStepTime < c.currentTime + 0.1) {
        scheduleStep(currentStep, nextStepTime);
        nextStepTime += stepSeconds;
        currentStep++;
        if (currentStep > loopEnd) {
          currentStep = loopStart;
          if (onLoopWrap) onLoopWrap();
        }
      }
    }

    function start() {
      stopped = false;
      nextStepTime = c.currentTime;
      timer = setInterval(scheduler, 25);
    }

    function pause() {
      stopped = true;
      clearInterval(timer);
    }

    function resume() {
      if (!stopped) return;
      start();
    }

    function stop() {
      stopped = true;
      clearInterval(timer);
      // Actively cut any still-ringing per-channel voices with a short fade, then
      // drop the song bus. Looped/long samples are scheduled to keep sounding for
      // their full hold (up to several seconds); disconnecting alone leaves that
      // scheduled tail ringing, so Stop must explicitly release each live voice.
      const now = c.currentTime;
      channelVoice.forEach(v => { if (v && v.cut) { try { v.cut(now); } catch { /* already gone */ } } });
      channelGains.forEach(g => {
        try { g.gain.cancelScheduledValues(now); g.gain.setTargetAtTime(0, now, 0.03); } catch { /* noop */ }
      });
      setTimeout(() => channelGains.forEach(g => { try { g.disconnect(); } catch { /* already disconnected */ } }), 150);
    }

    function setChannelWeight(chIdx, weight) {
      if (!channelGains[chIdx]) return;
      channelGains[chIdx].gain.setTargetAtTime(weight, c.currentTime, 0.2);
    }

    return { start, pause, resume, stop, setChannelWeight, set onLoopWrap_(fn) { onLoopWrap = fn; }, gainNode: outputGain };
  }

  let activePlayer = null;
  let pendingNext = null;
  let activeSongId = null;

  // def.channels' step.instrument references an instrument id. The caller
  // (server plugin for live playback, devpanel panel for preview) is expected
  // to attach def._instrumentsById = {id: instrumentRow, ...} before calling
  // playMusic/fadeTo — keeps this engine free of any server/devpanel fetch logic.

  function playMusic(def, opts = {}) {
    const c = init();
    if (!c || !def) return;
    // Zone/ambient routes re-push the same theme on every zone.entered — skip the
    // restart when the identical song is already playing so it doesn't audibly
    // retrigger from the top each time an actor enters. Local UI/preview callers
    // omit restartIfSame and always (re)start.
    const songId = def.id ?? def.name ?? null;
    if (opts.restartIfSame === false && activePlayer && activeSongId === songId) return;
    if (activePlayer) activePlayer.stop();
    activeSongId = songId;
    // Pre-warm sample cache for any sample-backed instruments so first notes don't stutter
    for (const inst of Object.values(def._instrumentsById || {})) {
      if (inst._sampleDef) loadSample(inst._sampleDef);
    }
    const gain = c.createGain();
    gain.connect(musicGain);
    activePlayer = makeSongPlayer(def, gain);
    activePlayer.onLoopWrap_ = () => {
      if (pendingNext) {
        const next = pendingNext;
        pendingNext = null;
        fadeTo(next);
      }
    };
    activePlayer.start();
  }

  function stopMusic() {
    activeSongId = null;
    if (!activePlayer) return;
    activePlayer.stop();
    activePlayer = null;
  }

  function pauseMusic() { activePlayer?.pause(); }
  function resumeMusic() { activePlayer?.resume(); }

  function queueMusic(def) { pendingNext = def; }

  function fadeTo(def, durationSec = 2) {
    const c = init();
    if (!c || !def) return;
    const prev = activePlayer;
    const newGain = c.createGain();
    newGain.gain.setValueAtTime(0, c.currentTime);
    newGain.connect(musicGain);
    const next = makeSongPlayer(def, newGain);
    next.onLoopWrap_ = () => {
      if (pendingNext) { const n = pendingNext; pendingNext = null; fadeTo(n); }
    };
    next.start();
    newGain.gain.linearRampToValueAtTime(1, c.currentTime + durationSec);
    if (prev) {
      prev.gainNode.gain.setValueAtTime(prev.gainNode.gain.value, c.currentTime);
      prev.gainNode.gain.linearRampToValueAtTime(0, c.currentTime + durationSec);
      setTimeout(() => prev.stop(), durationSec * 1000 + 50);
    }
    activePlayer = next;
  }

  function crossFade(def, durationSec) { fadeTo(def, durationSec); }

  function setLayerWeight(channelIndex, weight) {
    activePlayer?.setChannelWeight(channelIndex, weight);
  }

  // Sidechain duck: dip a loop's gain briefly (e.g. rain under a thunderclap),
  // then swell it back. No-op if the loop isn't currently playing.
  function duckLoop(id, fraction = 0.35, holdSeconds = 0.9, rampSeconds = 0.08) {
    if (!activeLoops.has(id)) return;
    setLoopGain(id, fraction, rampSeconds);
    setTimeout(() => { if (activeLoops.has(id)) setLoopGain(id, 1, 0.4); }, holdSeconds * 1000);
  }

  // ── Generic stop (WS audio_stop messages) ──────────────────────────────────

  function stop(scope, id) {
    if (scope === 'music') stopMusic();
    else if (scope === 'ambience') { if (id) stopLoop(id); else for (const k of [...activeLoops.keys()]) stopLoop(k); }
    // 'sfx' is one-shot and self-cleans; nothing to stop on demand.
  }

  function clearSampleCache(id) {
    if (id) _sampleCache.delete(id);
    else _sampleCache.clear();
  }

  global.AudioEngine = {
    init, applyVolumeSettings,
    playSfx, playSample, clearSampleCache,
    loopSound, stopLoop, setLoopGain, duckLoop,
    playMusic, stopMusic, pauseMusic, resumeMusic, queueMusic, fadeTo, crossFade, setLayerWeight,
    stop,
    noteToFreq,
  };

})(typeof window !== 'undefined' ? window : globalThis);
