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
  let _settings = { enabled: true, music: true, sfx: true, tv: true, masterVolume: 0.40, musicVolume: 0.7, sfxVolume: 0.9, ambientVolume: 0.3, tvVolume: 0.6, muteWhenHidden: true };
  let _hiddenDucked = false;
  let echoNodes = null; // global master-bus echo send (weed) — { wet, delay, fb }

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

  // Browsers refuse to start an AudioContext until a user gesture. Anything the
  // server pushes before the first click/keypress (e.g. the welcome greeting on
  // an auto-login) would be silently dropped, so callers hand it to onUnlock and
  // it fires the moment audio is actually allowed.
  let _unlocked = false;
  const _unlockWaiters = [];

  function _markUnlocked() {
    if (_unlocked) return;
    _unlocked = true;
    while (_unlockWaiters.length) {
      try { _unlockWaiters.shift()(); } catch { /* one bad waiter shouldn't block the rest */ }
    }
  }

  function onUnlock(fn) {
    if (_unlocked || (ctx && ctx.state === 'running')) { fn(); return; }
    _unlockWaiters.push(fn);
  }

  function init() {
    const c = ensureContext();
    if (c && c.state === 'suspended') c.resume().then(_markUnlocked, () => { /* still gesture-blocked */ });
    else if (c) _markUnlocked();
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
      if (ctx && ctx.state === 'suspended') ctx.resume().then(_markUnlocked, () => { /* still gesture-blocked */ });
      else _markUnlocked();
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

  // Slots get recycled, so a slot INDEX is not a stable identity. Every occupant
  // gets a token, and anything that later releases a slot must prove it still owns
  // it. Without this, a cue's own "I'm finished" timer — scheduled when it started,
  // and still pending after the cue was stolen — frees whoever inherited the slot.
  // That untracked sound keeps playing while the manager hands the slot out again,
  // so the next cue layers on top of it and you hear the same sound twice.
  let _voiceToken = 0;

  function occupyVoice(idx, priority, stopFn) {
    const token = ++_voiceToken;
    voices[idx] = { priority, startedAt: ctx.currentTime, stop: stopFn, token };
    return token;
  }

  // Pass the token from occupyVoice. Omitting it keeps the old unconditional
  // behaviour, which is only safe when the caller genuinely cannot have been stolen.
  function freeVoice(idx, token) {
    const v = voices[idx];
    if (!v) return;
    if (token != null && v.token !== token) return;   // slot was recycled — not ours to free
    voices[idx] = null;
  }

  // ── Layer graph builder (shared by instruments, SFX, ambience) ───────────
  // layer: { waveform, freq, detune, noiseMix, filter:{type,freq,q,to,time},
  //          adsr:{a,d,s,r}, vibrato:{rate,depth}, tremolo:{rate,depth},
  //          pitchBend:{to,time}, fm:{rate,depth,depthTo,rateTo,time}, gain }
  // filter.to/.time sweep the cutoff exactly like pitchBend sweeps the pitch,
  // and fm.depthTo/.rateTo sweep the modulation index / modulator pitch the same
  // way — one {to, time} contract for every travelling parameter.

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
      //
      // depthTo/time sweep the modulation index across the note, using the SAME
      // {to, time} exponential-approach contract as pitchBend and filter above,
      // so there is one mental model for "this parameter travels". This is the
      // single most expressive FM control: a high index collapsing to a low one
      // is what turns a tone into a struck/metallic/impact sound rather than a
      // steady buzz. rateTo does the same for the modulator's own pitch, which
      // is what makes a collision read as inharmonic rather than musical.
      // Both are optional — omitted leaves a static index, exactly the previous
      // behaviour, so every cue already shipped is unaffected.
      if (layer.fm?.rate) {
        const mod = ctx.createOscillator();
        mod.frequency.setValueAtTime(layer.fm.rate, time);
        if (layer.fm.rateTo) {
          mod.frequency.setTargetAtTime(layer.fm.rateTo, time, Math.max(0.005, (layer.fm.time || 0.2) / 3));
        }
        const modGain = ctx.createGain();
        modGain.gain.setValueAtTime(layer.fm.depth ?? 100, time);
        if (layer.fm.depthTo != null) {
          modGain.gain.setTargetAtTime(layer.fm.depthTo, time, Math.max(0.005, (layer.fm.time || 0.2) / 3));
        }
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
      filter.Q.value = layer.filter.q ?? 1;
      filter.frequency.setValueAtTime(layer.filter.freq || 4000, time);
      // Filter sweep. Deliberately the SAME {to, time} contract and the same
      // exponential-approach math as pitchBend above, so there is one mental
      // model for "this parameter travels", not two. A cutoff that opens across
      // the note is what reads as a bloom/whoosh/charge-up; without it every
      // shaped sound has to be faked with stacked static-filtered layers.
      // Omitting `to` leaves the filter static — exactly the previous behaviour,
      // which is why this is safe for every cue already shipped.
      if (layer.filter.to) {
        filter.frequency.setTargetAtTime(
          layer.filter.to, time, Math.max(0.01, (layer.filter.time || 0.2) / 3)
        );
      }
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
    // Full-quality bypass (snesBits = 0/off): play the decoded audio untouched — no
    // downsample, no crush. Used for clean SFX (e.g. thunder) that a retro crush ruins.
    if (!snesBits) return rawBuffer;

    const ratio = rawBuffer.sampleRate / snesRate;
    const outLen = Math.max(1, Math.ceil(rawBuffer.length / ratio));
    const off = new OfflineAudioContext(1, outLen, snesRate);
    const src = off.createBufferSource();
    src.buffer = rawBuffer;
    src.connect(off.destination);
    src.start(0);
    const lo = await off.startRendering();
    // Bit-crush to snesBits depth, with TPDF dither. Hard rounding alone produces
    // harsh, signal-correlated quantisation "grain" (the scratchiness); adding ±1 LSB
    // triangular dither decorrelates it into a much lower, benign noise floor, so the
    // retro character stays without the grit.
    const d = lo.getChannelData(0);
    const step = Math.pow(2, snesBits - 1);
    for (let i = 0; i < d.length; i++) {
      const dither = (Math.random() - Math.random()) / step; // TPDF, ±1 LSB
      const v = Math.round((d[i] + dither) * step) / step;
      d[i] = v < -1 ? -1 : v > 1 ? 1 : v;
    }
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
      const processed = await _processSnes(raw, def.snes_rate ?? 16000, def.snes_bits ?? 8);
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
    // Floor the release so a sample always fades out rather than snapping off at its
    // buffer end — samples authored with r:0 (percussive one-shots, every MOD sample)
    // would otherwise hard-cut. 60ms declicks the tail without eating the transient.
    const releaseTime = Math.max(0.06, adsr.r ?? 0.3);
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

    gainNode.gain.setTargetAtTime(0, releaseAt, Math.max(0.01, releaseTime / 3));

    const stopFn = () => {
      gainNode.gain.cancelScheduledValues(c.currentTime);
      gainNode.gain.setTargetAtTime(0, c.currentTime, 0.02);
    };
    const voiceToken = occupyVoice(idx, def.priority ?? 5, stopFn);
    const msUntilFree = Math.max(100, (endAt - c.currentTime + 0.1) * 1000);
    setTimeout(() => freeVoice(idx, voiceToken), msUntilFree);

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
    const voiceToken = occupyVoice(idx, priority, () => sound.release(c.currentTime));
    // Hold the slot for the longest layer's own release, not a flat default — the
    // per-layer adsr is where the release actually lives, so a long crowd swell was
    // freeing its slot roughly a second before it stopped being audible.
    const tail = Math.max(def.config.adsr?.r ?? 0,
      ...(def.config.layers || []).map(l => (l.delay ?? 0) + (l.adsr?.r ?? 0)), 0.15);
    setTimeout(() => freeVoice(idx, voiceToken), (duration + tail + 0.1) * 1000);
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
    const entry = { voiceIdx: idx, release: sound.release, gainNode: sound.gainNode, baseGain, sparkleCancels };
    activeLoops.set(id, entry);
    entry.voiceToken = occupyVoice(idx, priority, () => { sound.release(c.currentTime); if (sparkleCancels) sparkleCancels.forEach(fn => fn()); activeLoops.delete(id); });
  }

  function stopLoop(id) {
    const loop = activeLoops.get(id);
    if (!loop) return;
    if (loop.sparkleCancels) loop.sparkleCancels.forEach(fn => fn());
    // Only touch the slot if this loop still owns it. A stolen loop's index now
    // belongs to someone else, and stopping that would cut an unrelated sound dead.
    const v = voices[loop.voiceIdx];
    if (v && v.token === loop.voiceToken) { v.stop(false); freeVoice(loop.voiceIdx, loop.voiceToken); }
    else loop.release?.(ctx ? ctx.currentTime : 0);
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
        const voiceToken = occupyVoice(idx, priority, () => sound.release(c.currentTime));
        const ms = Math.max(0, (time - c.currentTime) * 1000) + (stepSeconds * 1000) + 200;
        setTimeout(() => freeVoice(idx, voiceToken), ms);
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

  // ── Global echo send (master bus) ───────────────────────────────────────────
  // A parallel delay+feedback tap off masterGain, so EVERY sound — music, SFX,
  // ambience — picks up a shimmering echo at once. Used by the cannabis high:
  // "the music is unbelievable." The dry masterGain→destination path is untouched;
  // this only adds a wet return. Gently ramped in/out so it never clicks.
  //   setEcho(true,  { mix, delay, feedback })  — turn it on (or retune)
  //   setEcho(false)                            — fade out and tear down
  function setEcho(on, opts = {}) {
    const c = ensureContext();
    if (!c) return;
    if (on) {
      const mix = Math.max(0, Math.min(0.8, opts.mix ?? 0.28));
      if (!echoNodes) {
        const delay = c.createDelay(2.0);
        delay.delayTime.value = opts.delay ?? 0.16;
        const fb = c.createGain(); fb.gain.value = Math.min(0.85, opts.feedback ?? 0.32);
        const wet = c.createGain(); wet.gain.value = 0;
        masterGain.connect(wet);
        wet.connect(delay);
        delay.connect(fb).connect(delay);
        delay.connect(masterGain.context.destination);
        echoNodes = { wet, delay, fb };
      } else {
        echoNodes.delay.delayTime.setTargetAtTime(opts.delay ?? 0.16, c.currentTime, 0.05);
        echoNodes.fb.gain.setTargetAtTime(Math.min(0.85, opts.feedback ?? 0.32), c.currentTime, 0.05);
      }
      echoNodes.wet.gain.setTargetAtTime(mix, c.currentTime, 0.4);
    } else if (echoNodes) {
      const n = echoNodes;
      echoNodes = null;
      n.wet.gain.setTargetAtTime(0, c.currentTime, 0.5);
      // Let the tail ring out, then fully disconnect (incl. the masterGain→wet
      // send) so repeated toggles don't leave orphaned nodes on the master bus.
      setTimeout(() => { try { masterGain.disconnect(n.wet); n.wet.disconnect(); n.delay.disconnect(); n.fb.disconnect(); } catch { /* already gone */ } }, 3000);
    }
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

  // ── Formant speech: procedural TV-narrator readout ──────────────────────────
  // Two stages: text→phoneme (dictionary + rules) and phoneme→formant synthesis.
  // Each narrator's name seeds a deterministic voice. Rides the 'tv' bus, so TV
  // volume, the tv-enable toggle, and mute-when-hidden already apply. Sounds like
  // a 1980s talking machine — intentional, for a machine-run broadcast network.
  const Speech = (function () {
    // Phoneme inventory: [F1,F2,F3] Hz, type, nominal duration (ms).
    // Types: V vowel, N nasal, L liquid/glide, F fricative, S stop, H aspirate, P pause.
    const PH = {
      IY:{f:[270,2290,3010],t:'V',d:130}, IH:{f:[390,1990,2550],t:'V',d:100},
      EH:{f:[530,1840,2480],t:'V',d:110}, AE:{f:[660,1720,2410],t:'V',d:140},
      AA:{f:[730,1090,2440],t:'V',d:150}, AO:{f:[570,840,2410],t:'V',d:140},
      UH:{f:[440,1020,2240],t:'V',d:100}, UW:{f:[300,870,2240],t:'V',d:140},
      ER:{f:[490,1350,1690],t:'V',d:150}, AH:{f:[640,1190,2390],t:'V',d:90},
      // NURSE with the r-colour taken out (RP /ɜː/). Same tongue position as ER;
      // the only meaningful change is F3 up from 1690 to 2350, because a LOW third
      // formant is what the ear reads as American rhoticity. Slightly longer,
      // since RP holds this one.
      ERR:{f:[490,1350,2350],t:'V',d:165},
      EY:{f:[530,1840,2480],to:[270,2290,3010],t:'V',d:170},
      AY:{f:[730,1090,2440],to:[270,2290,3010],t:'V',d:180},
      OY:{f:[570,840,2410], to:[270,2290,3010],t:'V',d:180},
      OW:{f:[570,840,2410], to:[300,870,2240], t:'V',d:170},
      AW:{f:[730,1090,2440],to:[300,870,2240], t:'V',d:180},
      M:{f:[250,1100,2200],t:'N',d:80}, N:{f:[250,1700,2600],t:'N',d:80}, NG:{f:[250,2000,2900],t:'N',d:80},
      L:{f:[360,1300,2600],t:'L',d:70}, R:{f:[420,1300,1600],t:'L',d:80},
      W:{f:[300,610,2200],t:'L',d:70},  Y:{f:[270,2290,3010],t:'L',d:60},
      S:{t:'F',d:110,nf:6500,nq:6,vd:0},  Z:{t:'F',d:100,nf:6500,nq:6,vd:.5},
      SH:{t:'F',d:120,nf:2600,nq:4,vd:0}, ZH:{t:'F',d:100,nf:2600,nq:4,vd:.5},
      F:{t:'F',d:100,nf:4000,nq:2,vd:0},  V:{t:'F',d:90,nf:4000,nq:2,vd:.5},
      TH:{t:'F',d:100,nf:5500,nq:2,vd:0}, DH:{t:'F',d:80,nf:5500,nq:2,vd:.5},
      HH:{t:'H',d:80,nf:1500,nq:1,vd:0},
      CH:{t:'F',d:120,nf:2600,nq:4,vd:0,stopFirst:1}, JH:{t:'F',d:110,nf:2600,nq:4,vd:.4,stopFirst:1},
      P:{t:'S',d:90,nf:1500,vd:0}, B:{t:'S',d:80,nf:900,vd:.4},
      T:{t:'S',d:90,nf:4000,vd:0}, D:{t:'S',d:80,nf:3000,vd:.4},
      K:{t:'S',d:90,nf:2000,vd:0}, G:{t:'S',d:80,nf:1800,vd:.4},
      _:{t:'P',d:120},
    };

    // High-frequency irregulars + broadcast vocab the rules/dict get wrong. Wins over CMU.
    const DICT = {
      the:'DH AH', a:'AH', of:'AH V', to:'T UW', evening:'IY V N IH NG',
      soylent:'S OY L EH N T', coldwater:'K OW L D W AO T ER', architect:'AA R K IH T EH K T',
      // Broadcast (.bsm) vocab the letter-rules mispronounce — world coinages/brands, recurring
      // proper names, and spoken initialisms. Verified against the g2p fallback's wrong guesses
      // (e.g. deadball→"deed-ball", hydrate→"hee-drate", cyberware→"see-ber", dmv→consonant mush).
      halcyon:'HH AE L S IY AH N', deadball:'D EH D B AO L',
      craniumtrust:'K R EY N IY AH M T R AH S T', gleamtooth:'G L IY M T UW TH',
      cyberware:'S AY B ER W EH R', cybernetic:'S AY B ER N EH T IH K',
      neonoodles:'N IY OW N UW D AH L Z', hydrate:'HH AY D R EY T',
      grimaldi:'G R IH M AA L D IY', delacroix:'D EH L AH K R W AA',
      delphine:'D EH L F IY N', ferraro:'F ER AA R OW',
      dmv:'D IY EH M V IY', gdp:'JH IY D IY P IY', crt:'S IY AA R T IY',
    };
    function dictLook(w){ return DICT[w] ? DICT[w].split(' ') : null; }

    // Per-utterance pronunciation override, consulted BEFORE the built-in dict and
    // CMUDICT. CMUDICT is 25k words of General American and knows none of
    // Zamyatin's Russian, Voltaire's French, or De Quincey's Latin — those fall
    // through to the letter-guesser and come out mangled. A book can therefore
    // ship its own small lexicon (`books.pronunciation`), which the reader passes
    // as speak(..., { lex }).
    //
    // Module-scoped rather than threaded through every call because the whole
    // text→phoneme pass is synchronous: speak() sets it, converts, and clears it
    // before yielding, so two voices can never see each other's lexicon.
    let _lex = null;
    function lexLook(w){
      if (!_lex) return null;
      const v = _lex[w];
      return v ? String(v).trim().split(/\s+/) : null;
    }

    // CMUdict subset (25k words, single-char encoded) — decoded lazily on first use.
    let CMU = null;
    function cmuBuild(){
      CMU = new Map();
      const D = global.CMUDICT; if (!D) return;
      CMU._A = D.alpha; CMU._P = D.phones;
      for (const line of D.blob.split('\n')) {
        const sp = line.indexOf(' '); if (sp < 0) continue;
        CMU.set(line.slice(0, sp), line.slice(sp + 1));
      }
    }
    function cmuLook(w){
      if (!CMU) cmuBuild();
      const enc = CMU.get(w); if (!enc) return null;
      const out = [];
      for (const ch of enc) out.push(CMU._P[CMU._A.indexOf(ch)]);
      return out;
    }

    const VOICED_END = new Set(['B','D','G','V','DH','Z','ZH','M','N','NG','L','R','W','Y','JH',
      'IY','IH','EH','AE','AA','AO','UH','UW','ER','AH','EY','AY','OY','OW','AW']);
    const SIBILANT = new Set(['S','Z','SH','ZH','CH','JH']);

    // Pronounce a word: hand-dict → CMU → inflectional suffix → letter rules.
    function pronounceWord(w){
      w = w.toLowerCase().replace(/[^a-z']/g,'');
      if (!w) return [];
      const x = lexLook(w); if (x) return x;
      const d = dictLook(w); if (d) return d;
      const c = cmuLook(w);  if (c) return c;
      const stemPh = (s)=>{ const dd = dictLook(s) || cmuLook(s); return dd || g2p(s); };
      let m;
      if ((m=/^(.+?)(s)$/.exec(w)) && w.length>2 && !/(ss|us|is)$/.test(w)) {
        const ph = stemPh(m[1]);
        if (ph.length) { const last = ph[ph.length-1];
          if (SIBILANT.has(last)) return [...ph,'IH','Z'];
          return [...ph, VOICED_END.has(last)?'Z':'S']; }
      }
      if ((m=/^(.+?)ed$/.exec(w)) && w.length>3) {
        let ph = stemPh(m[1]);
        if (!ph.length && m[1].length) ph = g2p(m[1]+'e');
        if (ph.length) { const last = ph[ph.length-1];
          if (last==='T'||last==='D') return [...ph,'IH','D'];
          return [...ph, VOICED_END.has(last)?'D':'T']; }
      }
      if ((m=/^(.+?)ing$/.exec(w)) && w.length>4) {
        let stem = m[1], ph = stemPh(stem);
        if (stem.length && !/[aeiou]{2}|[aeiou][^aeiou][^aeiou]/.test(stem)) { const e = g2p(stem+'e'); if (e.length) ph = e; }
        if (ph.length) return [...ph,'IH','NG'];
      }
      if ((m=/^(.+?)ly$/.exec(w)) && w.length>3) { const ph = stemPh(m[1]); if (ph.length) return [...ph,'L','IY']; }
      if ((m=/^(.+?)er$/.exec(w)) && w.length>3) { const ph = stemPh(m[1]); if (ph.length) return [...ph,'ER']; }
      return g2p(w);
    }

    // Grapheme-to-phoneme fallback: compact rule set, left-to-right longest match.
    function g2p(word){
      word = word.toLowerCase().replace(/[^a-z']/g,'');
      if (!word) return [];
      const out = []; let i = 0;
      const isV = c => 'aeiou'.includes(c);
      const at = k => word[k] || '';
      while (i < word.length) {
        const c = word[i], nx = at(i+1);
        const rest = word.slice(i);
        if (i===0 && c==='k' && nx==='n') { out.push('N'); i+=2; continue; }
        if (i===0 && c==='w' && nx==='r') { out.push('R'); i+=2; continue; }
        if (i===0 && c==='g' && nx==='n') { out.push('N'); i+=2; continue; }
        if (c==='m' && nx==='b' && i+2>=word.length) { out.push('M'); i+=2; continue; }
        if (c==='g' && nx==='n' && i+2>=word.length) { out.push('N'); i+=2; continue; }
        if (rest.startsWith('tion')) { out.push('SH','AH','N'); i+=4; continue; }
        if (rest.startsWith('sion')) { out.push('ZH','AH','N'); i+=4; continue; }
        if (rest.startsWith('ough')) { out.push('AO'); i+=4; continue; }
        if (rest.startsWith('igh'))  { out.push('AY'); i+=3; continue; }
        if (rest.startsWith('tch'))  { out.push('CH'); i+=3; continue; }
        if (c==='t' && nx==='h') { out.push(i===0?'TH':'DH'); i+=2; continue; }
        if (c==='s' && nx==='h') { out.push('SH'); i+=2; continue; }
        if (c==='c' && nx==='h') { out.push('CH'); i+=2; continue; }
        if (c==='p' && nx==='h') { out.push('F'); i+=2; continue; }
        if (c==='w' && nx==='h') { out.push('W'); i+=2; continue; }
        if (c==='g' && nx==='h') { i+=2; continue; }
        if (c==='c' && nx==='k') { out.push('K'); i+=2; continue; }
        if (c==='n' && nx==='g' && (i+2>=word.length)) { out.push('NG'); i+=2; continue; }
        if (c==='q' && nx==='u') { out.push('K','W'); i+=2; continue; }
        if (c==='n' && nx==='k') { out.push('NG','K'); i+=2; continue; }
        const vd = { ee:'IY',ea:'IY',oo:'UW',ou:'AW',ow:'OW',oa:'OW',ai:'EY',ay:'EY',
                     oy:'OY',oi:'OY',au:'AO',aw:'AO',ey:'IY',ie:'AY',ue:'UW',ei:'EY' };
        const two = c+nx;
        if (vd[two]) { out.push(vd[two]); i+=2; continue; }
        if (!isV(c) && c===nx) { i++; continue; }
        if (isV(c)) {
          const silentE = (nx && !isV(nx) && at(i+2)==='e' && i+3>=word.length);
          const longMap  = {a:'EY',e:'IY',i:'AY',o:'OW',u:'UW'};
          const shortMap = {a:'AE',e:'EH',i:'IH',o:'AA',u:'AH'};
          if (c==='e' && i===word.length-1 && i>0) { i++; continue; }
          if (silentE) { out.push(longMap[c]); i++; continue; }
          if (c==='o' && nx==='r') { out.push('AO'); i++; continue; }
          if (c==='a' && nx==='r') { out.push('AA'); i++; continue; }
          if ((c==='e'||c==='i'||c==='u') && nx==='r') { out.push('ER'); i++; continue; }
          out.push(shortMap[c]); i++; continue;
        }
        switch (c) {
          case 'c': out.push((nx==='e'||nx==='i'||nx==='y')?'S':'K'); break;
          case 'g': out.push((nx==='e'||nx==='i'||nx==='y')?'JH':'G'); break;
          case 'j': out.push('JH'); break;
          case 'x': out.push('K','S'); break;
          case 'y': out.push(i===0?'Y':'IY'); break;
          case 'w': out.push('W'); break; case 'r': out.push('R'); break;
          case 'l': out.push('L'); break; case 'h': out.push('HH'); break;
          case "'": break;
          default: { const mm={b:'B',d:'D',f:'F',k:'K',m:'M',n:'N',p:'P',s:'S',t:'T',v:'V',z:'Z'};
                     if (mm[c]) out.push(mm[c]); }
        }
        i++;
      }
      return out;
    }

    // Numbers & number-symbols → words, so the voice can actually SAY them (digits are otherwise
    // stripped by pronounceWord's [^a-z'] filter and vanish). Run BEFORE tokenising so the split on
    // '.'/',' can't shred a decimal or a grouped number. Covers: cardinals ("forty two"), thousands
    // commas ("1,000,000" → "one million"), decimals ("3.14" → "three point one four"), ORDINALS
    // ("1st"/"22nd" → "first"/"twenty second"), YEARS read as pairs ("2026" → "twenty twenty six",
    // "1984" → "nineteen eighty four", "2005" → "twenty oh five"), and the % and ° symbols.
    const _ONES = ['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
    const _TENS = ['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
    function intToWords(n){
      n = Math.floor(n);
      if (n < 20) return _ONES[n];
      if (n < 100) return _TENS[(n/10)|0] + (n%10 ? ' '+_ONES[n%10] : '');
      if (n < 1000) return _ONES[(n/100)|0]+' hundred'+(n%100 ? ' '+intToWords(n%100) : '');
      if (n < 1e6) return intToWords((n/1000)|0)+' thousand'+(n%1000 ? ' '+intToWords(n%1000) : '');
      if (n < 1e9) return intToWords((n/1e6)|0)+' million'+(n%1e6 ? ' '+intToWords(n%1e6) : '');
      return intToWords((n/1e9)|0)+' billion'+(n%1e9 ? ' '+intToWords(n%1e9) : '');
    }
    function numToWords(s){
      if (s.includes('.')) {
        const [ip, fp] = s.split('.');
        const intPart = ip.length ? intToWords(parseInt(ip,10)) : 'zero';
        return intPart+' point '+fp.split('').map(d=>_ONES[+d]).join(' ');
      }
      const n = parseInt(s,10);
      if (!isFinite(n) || n > 999999999999) return s.split('').map(d=>_ONES[+d]||'').join(' ');   // absurdly long → read digit by digit
      return intToWords(n);
    }
    // A 4-digit year spoken as pairs: 2026 → "twenty twenty six", 1984 → "nineteen eighty four",
    // 2005 → "twenty oh five", 1900 → "nineteen hundred", 2000 → "two thousand".
    function yearToWords(n){
      const hi = (n/100)|0, lo = n%100;
      if (n % 1000 === 0) return intToWords(n);
      if (lo === 0) return intToWords(hi)+' hundred';
      if (lo < 10) return intToWords(hi)+' oh '+_ONES[lo];
      return intToWords(hi)+' '+intToWords(lo);
    }
    // Cardinal → ordinal by inflecting only the LAST word: 21 → "twenty first", 100 → "one hundredth".
    const _ORD = { one:'first', two:'second', three:'third', five:'fifth', eight:'eighth', nine:'ninth', twelve:'twelfth' };
    function ordinalToWords(n){
      const w = intToWords(n).split(' '), last = w[w.length-1];
      w[w.length-1] = _ORD[last] || (last.endsWith('y') ? last.slice(0,-1)+'ieth' : last+'th');
      return w.join(' ');
    }
    function expandNumbers(text){
      return String(text)
        .replace(/°\s*([CF])\b/g, (m,u)=>' degrees '+(u==='C'?'celsius':'fahrenheit')+' ')   // 72°F → "degrees fahrenheit"
        .replace(/°/g, ' degrees ')
        .replace(/%/g, ' percent ')
        .replace(/(\d+)(?:st|nd|rd|th)\b/gi, (m,d)=>' '+ordinalToWords(parseInt(d,10))+' ')   // ordinals: 1st → "first"
        // Bare 4-digit numbers in a plausible year range read as pairs (2026 → "twenty twenty six").
        // \b avoids comma-grouped quantities (1,500 has no 4-digit run) and longer runs; the '.' guards
        // skip a value that's really a decimal (3.2026 / 2026.5) so the decimal pass below handles it.
        .replace(/\b\d{4}\b/g, (m,off,s)=>{ const n=+m; return (n>=1000 && n<=2099 && s[off-1]!=='.' && s[off+4]!=='.') ? ' '+yearToWords(n)+' ' : m; })
        .replace(/(\d),(?=\d)/g, '$1')                    // strip thousands separators: 1,000,000 → 1000000
        .replace(/\d+(?:\.\d+)?/g, m => ' '+numToWords(m)+' ');
    }

    // ── Accents ──────────────────────────────────────────────────────────────
    // The dictionary is General American (CMUDICT), so an accent is a transform
    // over the phoneme run rather than a second dictionary. Only 'rp' exists, and
    // it does the three things that actually carry the impression — anything more
    // needs per-word lexical sets the dictionary doesn't carry.
    //
    //  1. NON-RHOTIC. The big one. /R/ is dropped unless a vowel follows it, so
    //     "father" and "harder" lose their r and "red"/"very" keep theirs.
    //  2. NURSE without r-colour. ER is rhotic by way of a very low F3 (1690).
    //     Raising F3 un-colours it into /ɜː/ — hence ERR, a real PH entry rather
    //     than a remap, because no existing vowel has those formants.
    //  3. TRAP–BATH. /AE/ backs to /AA/ before the fricatives and nasal clusters
    //     that trigger the split — bath, path, laugh, dance, chance.
    const RP_BATH_FOLLOW = new Set(['F','TH','S','N','M','NG']);
    const VOWELS = new Set(['IY','IH','EH','AE','AA','AO','UH','UW','ER','ERR','AH','EY','AY','OW','OY','AW']);

    function applyAccent(phon, accent){
      if (accent !== 'rp') return phon;
      const out = [];
      for (let i = 0; i < phon.length; i++){
        const p = phon[i];
        // Look past word gaps: an /r/ at the end of "far" is still non-prevocalic
        // even though the next SOUND is a pause. Linking-r across a word boundary
        // is a refinement this deliberately doesn't attempt.
        const next = phon[i+1];
        if (p === 'R'){
          if (next && VOWELS.has(next)) out.push('R');   // prevocalic /r/ survives
          continue;                                      // …otherwise it's gone
        }
        if (p === 'ER'){ out.push('ERR'); continue; }
        if (p === 'AE'){
          // Scan to the next non-gap phone: the trigger consonant may sit across
          // a syllable break in the run.
          let j = i+1; while (phon[j] === '_') j++;
          if (RP_BATH_FOLLOW.has(phon[j])) { out.push('AA'); continue; }
        }
        out.push(p);
      }
      return out;
    }

    function textToPhonemes(text){
      const seq = [];
      for (const tok of expandNumbers(text).trim().split(/(\s+|[.,!?;:])/)) {
        if (!tok) continue;
        if (/^\s+$/.test(tok)) { seq.push('_'); continue; }
        if (/^[.,!?;:]$/.test(tok)) { seq.push('_','_'); continue; }
        seq.push(...pronounceWord(tok));
      }
      return seq;
    }

    // Per-narrator voice: deterministic from the name. Nothing stored — name IS the voice.
    function hashName(s){
      let h = 2166136261 >>> 0; s = (s||'').toLowerCase().trim();
      for (let i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h,16777619); }
      return h >>> 0;
    }
    function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
    function voiceFromName(name){
      const r = mulberry32(hashName(name)); const pick = arr => arr[Math.floor(r()*arr.length)];
      const high = r() < 0.5;
      return {
        f0:     high ? 120+r()*55 : 82+r()*38,
        fshift: high ? 1.02+r()*0.16 : 0.9+r()*0.12,
        speed:  1.24+r()*0.24,   // brisker again — reads as speech, not dictation
        ring:   r()<0.25 ? 0.10+r()*0.22 : r()*0.06,
        wave:   pick(['sawtooth','sawtooth','square','square']),
        jitter: 0.004+r()*0.016,
        breath: r()*0.05,
        // Per-voice prosody, so two narrators don't rise and fall identically.
        // Intonation is most of what separates "a person talking" from "a machine
        // reading" — a flat F0 is the single most robotic thing a formant synth does.
        lilt:   0.05+r()*0.05,   // how far F0 moves on a stressed vowel
        decl:   0.10+r()*0.05,   // phrase-final declination (pitch falls as breath goes)
      };
    }

    // Rough total duration (s) of a phoneme run at a given speed — used to decide
    // how much to compress a line so it fits before the next broadcast tick.
    function estimateDuration(phon, speed){
      let t = 0.08;
      for (const code of phon) {
        const p = PH[code]; if (!p) continue;
        if (p.t==='F' && p.stopFirst) t += 0.03;
        t += Math.max(0.03, (p.d/1000)/speed);
      }
      return t;
    }

    let live = [];
    function cancel(){ live.forEach(n => { try { n.stop(); } catch { /* already stopped */ } }); live = []; }

    function speak(text, opt = {}){
      if (!_settings.enabled || !_settings.tv) return;
      const c = ensureContext(); if (!c) return;
      if (c.state === 'suspended') c.resume();
      cancel();
      const V = voiceFromName(opt.seed || text);
      const F0 = V.f0, ringAmt = V.ring, fshift = V.fshift;
      // Set → convert → clear, all synchronously (see lexLook).
      _lex = opt.lex || null;
      let phon;
      try { phon = applyAccent(textToPhonemes(text), opt.accent); }
      finally { _lex = null; }
      if (!phon.length) return;
      // Fit-to-window: if the line won't finish before the next is expected (opt.budget
      // seconds), speed up — never down — so it lands in time. Capped so it stays legible.
      let speed = V.speed;
      if (opt.budget > 0.5) {
        const target = opt.budget * 0.9;                 // leave a little headroom
        const natural = estimateDuration(phon, speed);
        if (natural > target) speed *= Math.min(natural / target, 2.0);
      }
      const out = busFor('tv');

      const master = c.createGain(); master.gain.value = 0.9;
      const ringGain = c.createGain(); ringGain.gain.value = 1 - ringAmt;
      const lfo = c.createOscillator(); lfo.frequency.value = 50;
      const lfoDepth = c.createGain(); lfoDepth.gain.value = ringAmt;
      lfo.connect(lfoDepth).connect(ringGain.gain);

      // ── Output shaping ──────────────────────────────────────────────────────
      // Two cheap stages that do most of the "clearer" work, both borrowed from
      // how real speech chains are built:
      //
      // PRESENCE — a high shelf around 2.6kHz. Consonant energy lives up there, and
      // a bandpass-formant voice under-produces it, which is exactly why the old
      // voice was easy to hear and hard to *understand*. Lifting the shelf sharpens
      // articulation without touching the vowels that carry the character.
      //
      // GLOTTAL ROLL-OFF — a real glottal source falls about 12dB/octave; a raw
      // saw/square doesn't, so the top end reads as buzz sitting on top of the
      // voice rather than as part of it. A gentle lowpass tames that.
      const presence = c.createBiquadFilter();
      presence.type = 'highshelf'; presence.frequency.value = 2600; presence.gain.value = 5.5;
      // Keeps a loud vowel from swamping the consonant that follows it — the voice
      // sits at one level instead of lunging, which reads as microphone technique.
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -22; comp.knee.value = 12; comp.ratio.value = 3;
      comp.attack.value = 0.004; comp.release.value = 0.12;
      master.connect(ringGain).connect(presence).connect(comp).connect(out);

      const glot = c.createOscillator(); glot.type = V.wave; glot.frequency.value = F0;
      const tilt = c.createBiquadFilter();
      tilt.type = 'lowpass'; tilt.frequency.value = 3400; tilt.Q.value = 0.5;
      const jit = c.createOscillator(); jit.type = 'triangle'; jit.frequency.value = 9;
      const jitG = c.createGain(); jitG.gain.value = F0 * V.jitter; jit.connect(jitG).connect(glot.frequency);
      const voiced = c.createGain(); voiced.gain.value = 0;
      glot.connect(tilt);
      // FOUR formants, not three. F4 is fixed high energy that the ear reads as
      // "a mouth", and its absence is a large part of why three-formant synths
      // sound like a kazoo. Q comes down across the board too: the old 10/13/16
      // rang like a filter sweep, and lower Q gives broader, more natural vowels.
      const F_Q = [7, 9, 11, 13];
      const F_G = [1, 0.72, 0.42, 0.16];
      const forms = [0,1,2,3].map(k => {
        const bp = c.createBiquadFilter(); bp.type = 'bandpass';
        bp.frequency.value = k === 3 ? 3600 : 500; bp.Q.value = F_Q[k];
        const g = c.createGain(); g.gain.value = F_G[k];
        tilt.connect(bp).connect(g).connect(voiced);
        return bp;
      });
      voiced.connect(master);

      const nz = c.createBufferSource(); nz.buffer = getNoiseBuffer(); nz.loop = true;
      const nbp = c.createBiquadFilter(); nbp.type = 'bandpass'; nbp.frequency.value = 4000; nbp.Q.value = 3;
      const noiseG = c.createGain(); noiseG.gain.value = 0;
      nz.connect(nbp).connect(noiseG).connect(master);

      const t0 = c.currentTime + 0.05; let t = t0;
      // F4 is a fixed resonance of the vocal tract, not a vowel target — the phoneme
      // table only carries three. Set once; the others glide per phoneme.
      forms[3].frequency.setValueAtTime(3600 * fshift, t0);
      // Coarticulation: formants GLIDE between targets rather than snapping. The old
      // 8ms constant was effectively a jump, which is heard as a stutter between
      // sounds. 22ms is about how fast a real tongue moves.
      const setF = (when, arr) => {
        for (let k = 0; k < 3; k++) forms[k].frequency.setTargetAtTime(arr[k]*fshift, when, 0.022);
      };

      // ── Prosody ─────────────────────────────────────────────────────────────
      // Two movements, both cheap and both worth more than any filter change:
      //   • DECLINATION — pitch drifts down across the phrase as breath runs out.
      //   • LILT — each vowel gets a small rise-then-fall. Flat vowels are the
      //     tell-tale of a synth; even a few percent of movement reads as human.
      // Vowel index (not phoneme index) drives the alternation so the contour
      // follows syllables rather than consonant clusters.
      const totalDur = estimateDuration(phon, speed) || 1;
      let vowelN = 0;
      const pitchAt = (when, frac, stressed) => {
        const fall = 1 - V.decl * frac;                       // declination
        const lift = stressed ? 1 + V.lilt : 1 - V.lilt * 0.45;
        glot.frequency.setTargetAtTime(F0 * fall * lift, when, 0.05);
      };

      for (const code of phon) {
        const p = PH[code]; if (!p) continue;
        const dur = Math.max(0.03, (p.d/1000)/speed);
        if (p.t==='V' || p.t==='N' || p.t==='L') {
          setF(t, p.f);
          voiced.gain.setTargetAtTime(p.t==='V'?0.9:0.6, t, 0.012);
          noiseG.gain.setTargetAtTime(V.breath, t, 0.01);
          if (p.t === 'V') {
            // Alternating stress is a crude stand-in for real lexical stress, but
            // any variation beats none — and it never lands on a consonant.
            pitchAt(t, (t - t0) / totalDur, (vowelN++ % 2) === 0);
          }
          if (p.to) setF(t+dur*0.5, p.to);
          t += dur;
        } else if (p.t==='F' || p.t==='H') {
          if (p.stopFirst) { voiced.gain.setTargetAtTime(0,t,0.005); noiseG.gain.setTargetAtTime(0,t,0.005); t += 0.03; }
          nbp.frequency.setTargetAtTime(p.nf, t, 0.01); nbp.Q.value = p.nq||3;
          noiseG.gain.setTargetAtTime(p.t==='H'?0.14:0.3, t, 0.008);
          voiced.gain.setTargetAtTime(p.vd?0.35:0, t, 0.008);
          t += dur; noiseG.gain.setTargetAtTime(0, t, 0.02);
        } else if (p.t==='S') {
          voiced.gain.setTargetAtTime(0, t, 0.004); noiseG.gain.setTargetAtTime(0, t, 0.004);
          t += dur*0.6;
          nbp.frequency.setTargetAtTime(p.nf, t, 0.005); nbp.Q.value = 2;
          noiseG.gain.setTargetAtTime(0.28, t, 0.003); noiseG.gain.setTargetAtTime(0, t+0.02, 0.01);
          if (p.vd) voiced.gain.setTargetAtTime(0.3, t, 0.005);
          t += dur*0.4;
        } else if (p.t==='P') {
          voiced.gain.setTargetAtTime(0, t, 0.02); noiseG.gain.setTargetAtTime(0, t, 0.02);
          t += dur/speed;
        }
      }
      const end = t + 0.08;
      voiced.gain.setTargetAtTime(0, end, 0.02);
      noiseG.gain.setTargetAtTime(0, end, 0.02);
      // The terminal fall. Set as a target from wherever the lilt left the pitch —
      // the old code re-anchored F0 at t0 and ramped, which erased every contour
      // scheduled above it.
      glot.frequency.setTargetAtTime(F0 * (1 - V.decl) * 0.94, Math.max(t0, end - 0.18), 0.06);
      glot.start(t0); nz.start(t0); lfo.start(t0); jit.start(t0);
      glot.stop(end+0.1); nz.stop(end+0.1); lfo.stop(end+0.1); jit.stop(end+0.1);
      live = [glot, nz, lfo, jit];
      // The REAL length of what was just scheduled. Callers used to guess from word
      // count and wait that long regardless, so a line that finished early left dead
      // air; handing back the truth lets them follow the voice instead of a timer.
      return { duration: end - t0 };
    }

    return { speak, cancel };
  })();

  global.AudioEngine = {
    init, onUnlock, applyVolumeSettings,
    playSfx, playSample, clearSampleCache,
    loopSound, stopLoop, setLoopGain, duckLoop, setEcho,
    playMusic, stopMusic, pauseMusic, resumeMusic, queueMusic, fadeTo, crossFade, setLayerWeight,
    stop,
    noteToFreq,
    speak: (text, opt) => Speech.speak(text, opt),
    cancelSpeech: () => Speech.cancel(),
    // Hand a custom synth (e.g. the flight-engine) the context + ambient bus + shared noise
    // buffer so it can build its own live, parameter-driven node graph on the ambient chain.
    engineNodes: () => { const c = ensureContext(); if (!c) return null; return { ctx: c, bus: busFor('ambient'), noise: getNoiseBuffer() }; },
  };

})(typeof window !== 'undefined' ? window : globalThis);
