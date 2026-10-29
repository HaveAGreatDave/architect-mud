/**
 * SIREN — Sources, Index, Resonance, Envelopes & Noise.
 *
 * The synthesizer: music, SFX and ambience synthesized in-browser, no samples.
 * Separate from the text "Sound" system (server/engine/sounds.js); never merge them.
 * `Index` is the FM modulation index.
 *
 * ⚠ Grepping "SIREN" misleads: the word also means the emergency/dive siren
 * elsewhere. Search buildLayer, layer.fm, voices, busFor.
 * ⚠ ORACLE (the voice, further down) never calls buildLayer. It shares
 * driveCurve, the noise buffer, the resonators and the buses only, so an FM
 * feature added here doesn't reach the voice, and the reverse.
 *
 * Attaches to globalThis so it works as a classic <script> (devpanel) and in
 * the ESM game client. The server decides when things play (plugins/audio/).
 */
(function (global) {

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

  let ctx = null;
  let masterGain, musicGain, sfxGain, ambientGain, tvGain, uiGain;
  let _noiseBuffer = null;
  let _settings = { enabled: true, music: true, sfx: true, tv: true, masterVolume: 0.40, musicVolume: 0.7, sfxVolume: 0.9, ambientVolume: 0.3, tvVolume: 0.6, muteWhenHidden: true };
  let _hiddenDucked = false;
  let _monoNode = null, _mono = false;
  let echoNodes = null; // global master-bus echo send (weed): { wet, delay, fb }

  // Brickwall limiter at about -1 dBFS. The compressor adds makeup gain of
  // (1 / fullRangeGain) ^ 0.6 (per spec); _limitTrim takes it back off so the
  // chain is unity below the threshold.
  const LIMIT = { threshold: -1, knee: 0, ratio: 20, attack: 0.001, release: 0.1 };
  const LIMIT_FULL_RANGE_DB = LIMIT.threshold + (0 - LIMIT.threshold) / LIMIT.ratio;
  const LIMIT_MAKEUP = Math.pow(1 / Math.pow(10, LIMIT_FULL_RANGE_DB / 20), 0.6);
  let _limiter = null, _limitTrim = null;

  // Each bus: slider gain (_applyGains only) then duck gain (duck() only), so
  // neither overwrites the other. A cue with its own `send` uses lazy dry/wet
  // copies of the chain whose gains follow the originals.
  // see docs/systems-procedural-audio.md#the-mix-limiter-ducks-noise-filters-sends-and-rooms
  const BUS_NAMES = ['music', 'sfx', 'ambient', 'tv', 'ui'];
  // Music and ui are dry: Read Aloud on ui has to be understood.
  const BUS_SEND = { sfx: 1, ambient: 1, tv: 0.45 };
  const buses = {};   // name -> { slider: [GainNode], duck: [GainNode], paths: {} }

  // tv sub-gains (voice, fx) for setTvBalance. Category 'tv' goes straight to the bus.
  let tvVoiceGain = null, tvFxGain = null;
  const _tvBalance = { voice: 1, fx: 1 };
  const _tvSubs = { voice: [], fx: [] };

  function _busPath(name, kind) {
    const b = buses[name];
    if (b.paths[kind]) return b.paths[kind];
    const slider = ctx.createGain();
    const dk = ctx.createGain();
    slider.gain.value = b.slider[0].gain.value;
    dk.gain.value = b.duck[0].gain.value;
    slider.connect(dk).connect(kind === 'wet' ? reverbSend : masterGain);
    b.slider.push(slider);
    b.duck.push(dk);
    b.paths[kind] = slider;
    _applyGains();
    _duckSchedule(name);
    return slider;
  }

  function ensureContext() {
    if (ctx) return ctx;
    const AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    masterGain = ctx.createGain();
    _limiter = ctx.createDynamicsCompressor();
    for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) _limiter[k].value = LIMIT[k];
    _limitTrim = ctx.createGain();
    _limitTrim.gain.value = 1 / LIMIT_MAKEUP;
    masterGain.connect(_limiter).connect(_limitTrim);
    // Mono downmix after the limiter: an explicit 1-channel gain sums L+R, and
    // the destination spreads it back to both outputs.
    _monoNode = ctx.createGain();
    _monoNode.channelCount = 1;
    _monoNode.channelCountMode = 'explicit';
    _monoNode.channelInterpretation = 'speakers';
    _monoNode.connect(ctx.destination);
    _limitTrim.connect(_mono ? _monoNode : ctx.destination);
    for (const name of BUS_NAMES) {
      const slider = ctx.createGain();
      const dk = ctx.createGain();
      slider.connect(dk).connect(masterGain);
      buses[name] = { slider: [slider], duck: [dk], paths: {}, holds: [] };
    }
    musicGain = buses.music.slider[0];
    sfxGain = buses.sfx.slider[0];
    ambientGain = buses.ambient.slider[0];
    tvGain = buses.tv.slider[0];
    uiGain = buses.ui.slider[0];
    tvVoiceGain = ctx.createGain();
    tvFxGain = ctx.createGain();
    tvVoiceGain.connect(tvGain);
    tvFxGain.connect(tvGain);
    _tvSubs.voice.push(tvVoiceGain);
    _tvSubs.fx.push(tvFxGain);
    buildReverb();
    _applyGains();
    loadRetro(ctx);
    return ctx;
  }

  // Broadcast voice and effects levels (dB) inside the one TV slider.
  function setTvBalance({ voiceDb = 0, fxDb = 0 } = {}) {
    _tvBalance.voice = dbToGain(voiceDb);
    _tvBalance.fx = dbToGain(fxDb);
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const k of ['voice', 'fx']) for (const g of _tvSubs[k]) g.gain.setTargetAtTime(_tvBalance[k], t, 0.02);
  }

  const dbToGain = (db) => Math.pow(10, (db || 0) / 20);

  //   const h = duck(['sfx', 'ambient'], -9, { attack: 0.05, hold: 2, release: 0.4 });
  // Without `hold` the duck stays until h.release(). `at` is context time.
  // Overlapping ducks: a bus sits at the deepest active hold, scheduled as
  // AudioParam events (no timers).
  function duck(names, dB = -9, { attack = 0.05, hold = null, release = 0.4, at = null } = {}) {
    const c = ensureContext();
    if (!c) return { release() {} };
    const list = (names === 'all' ? BUS_NAMES : Array.isArray(names) ? names : [names]).filter(n => buses[n]);
    const start = Math.max(c.currentTime, at ?? c.currentTime);
    const h = {
      gain: dbToGain(Math.min(0, dB)), start,
      end: hold != null ? start + attack + Math.max(0, hold) : Infinity,
      attack: Math.max(0.005, attack), release: Math.max(0.005, release),
    };
    for (const n of list) { buses[n].holds.push(h); _duckSchedule(n); }
    return {
      release(when) {
        const t = Math.max(c.currentTime, when ?? c.currentTime);
        if (h.end <= t) return;
        h.end = Math.max(h.start, t);
        for (const n of list) _duckSchedule(n);
      },
    };
  }

  function _duckSchedule(name) {
    const b = buses[name];
    if (!b) return;
    const now = ctx.currentTime;
    const levelAt = (holds, t) => {
      let lvl = 1, win = null;
      for (const h of holds) if (h.start <= t && t < h.end && h.gain < lvl) { lvl = h.gain; win = h; }
      return { lvl, win };
    };
    // From the holds, not the param: a hold released this instant still counts.
    const before = levelAt(b.holds, now - 1e-6);
    b.holds = b.holds.filter(h => h.end > now);
    const pts = [...new Set([now, ...b.holds.map(h => Math.max(now, h.start)), ...b.holds.map(h => h.end).filter(Number.isFinite)])]
      .sort((a, z) => a - z);
    for (const g of b.duck) {
      const p = g.gain;
      // No anchor value: a running target continues from where it has got to.
      p.cancelScheduledValues(now);
      let prev = before.lvl, prevWin = before.win;
      for (const t of pts) {
        const { lvl, win } = levelAt(b.holds, t);
        if (Math.abs(lvl - prev) > 1e-6) {
          // Down: new hold's attack. Up: released hold's release.
          const tc = lvl < prev ? (win?.attack ?? 0.05) : (prevWin?.release ?? 0.4);
          p.setTargetAtTime(lvl, t, tc / 3);
        }
        prev = lvl; prevWin = win || prevWin;
      }
    }
  }

  // Reverb: a send (dry path untouched) with generated impulse responses.
  // see docs/systems-procedural-audio.md#the-room-the-wall-and-the-drive
  let reverbNode = null, reverbSend = null, _space = null;
  const _irCache = new Map();

  // seconds: tail length · damp 0..1: how fast the top dies · pre: pre-delay ms
  // (reads as size) · wet: send level. Outdoor isn't zero: a hard zero sounds
  // like a vacuum.
  const SPACES = {
    outdoor:  { seconds: 0.30, damp: 0.75, pre: 2,  wet: 0.05 },
    street:   { seconds: 0.55, damp: 0.55, pre: 9,  wet: 0.11 },
    room:     { seconds: 0.45, damp: 0.80, pre: 5,  wet: 0.14 },
    hall:     { seconds: 1.30, damp: 0.35, pre: 14, wet: 0.22 },
    stone:    { seconds: 2.60, damp: 0.22, pre: 20, wet: 0.30 },
    tunnel:   { seconds: 2.10, damp: 0.88, pre: 11, wet: 0.34 },
    metal:    { seconds: 0.70, damp: 0.10, pre: 4,  wet: 0.26 },
    // `slap`: one reflection off the stands: ms after the sound, level against
    // the tail's peak, and the extra ms the right ear waits.
    ballpark: { seconds: 0.18, damp: 0.60, pre: 3,  wet: 0.16, slap: { ms: 120, level: 1.0, spread: 7 } },
  };

  function buildReverb() {
    reverbNode = ctx.createConvolver();
    reverbSend = ctx.createGain();
    reverbSend.gain.value = 0;
    // From each bus's DUCK output, so a ducked bus ducks its reverb too.
    buses.sfx.duck[0].connect(reverbSend);
    buses.ambient.duck[0].connect(reverbSend);
    // The TV is a speaker in your room, at a reduced send.
    // ⚠ `uiGain` is deliberately NOT here. See busFor.
    const tvSend = ctx.createGain();
    tvSend.gain.value = BUS_SEND.tv;
    buses.tv.duck[0].connect(tvSend).connect(reverbSend);
    reverbSend.connect(reverbNode).connect(masterGain);
    _applySpace(_roomOverride || _zoneSpace || 'outdoor', { instant: true });
  }

  function impulseFor(name) {
    const cached = _irCache.get(name);
    if (cached) return cached;
    const s = SPACES[name] || SPACES.room;
    const sr = ctx.sampleRate;
    const len = Math.max(1, Math.floor(sr * s.seconds));
    const pre = Math.floor(sr * (s.pre / 1000));
    // A slap-back is ~20 ms of damped noise; a click reads as a fault.
    const slapLen = Math.floor(sr * 0.02);
    const slapAt = s.slap ? Math.floor(sr * ((s.slap.ms + (s.slap.spread || 0)) / 1000)) + slapLen : 0;
    const buf = ctx.createBuffer(2, Math.max(len + pre, slapAt), sr);
    // Separate noise per channel (else it's mono). Seeded from the name so the
    // space gate reads one fixed impulse.
    let seed = 0x9E37;
    for (let i = 0; i < name.length; i++) seed = Math.imul(seed ^ name.charCodeAt(i), 16777619);
    const rand = _rng(seed);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      const damp = 1 - s.damp;   // one-pole coefficient: lower damp = darker tail
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // Exponential: a linear fade reads as a gate closing.
        const env = Math.pow(1 - t, 2.2);
        lp += damp * ((rand() * 2 - 1) - lp);
        d[pre + i] = lp * env;
      }
      if (s.slap) {
        // Scaled against the tail's own peak, so `level` is damping-independent.
        let peak = 0;
        for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
        const at = Math.floor(sr * ((s.slap.ms + (ch ? s.slap.spread || 0 : 0)) / 1000));
        const burst = new Float32Array(slapLen);
        let sp = 0, top = 0;
        for (let i = 0; i < slapLen; i++) {
          sp += damp * ((rand() * 2 - 1) - sp);
          burst[i] = sp * Math.pow(1 - i / slapLen, 2);
          top = Math.max(top, Math.abs(burst[i]));
        }
        const k = (peak || 1) * s.slap.level / (top || 1);
        for (let i = 0; i < slapLen; i++) d[at + i] += burst[i] * k;
      }
    }
    _irCache.set(name, buf);
    return buf;
  }

  // The source room's reverb: one convolver per (bus, room), shared by every
  // cue from it (pan and wall filters sit before the send, so sharing is
  // safe). LRU, capped at three. The listener's own room never gets one.
  const SOURCE_ROOM_CAP = 3;
  const _sourceRooms = new Map();   // 'sfx:stone' -> { input, conv }
  function sourceRoomInput(bus, space) {
    const key = bus + ':' + space;
    const hit = _sourceRooms.get(key);
    if (hit) { _sourceRooms.delete(key); _sourceRooms.set(key, hit); return hit.input; }
    if (_sourceRooms.size >= SOURCE_ROOM_CAP) {
      const [oldKey, old] = _sourceRooms.entries().next().value;
      old.input.disconnect(); old.conv.disconnect();
      _sourceRooms.delete(oldKey);
    }
    const input = ctx.createGain();
    const conv = ctx.createConvolver();
    conv.buffer = impulseFor(space);
    // Into the bus, not the master: the slider and ducks still apply.
    input.connect(conv).connect(busFor(bus));
    _sourceRooms.set(key, { input, conv });
    return input;
  }

  // `instant` is for boot; otherwise crossfade (a one-frame swap clicks).
  // setSpace is the zone's room (server); setRoom(name) from a view wins until
  // setRoom(null).
  let _zoneSpace = 'outdoor', _roomOverride = null;
  function setSpace(name, opts = {}) {
    _zoneSpace = name;
    if (_roomOverride) return;
    _applySpace(name, opts);
  }
  function setRoom(name, opts = {}) {
    _roomOverride = name && SPACES[name] ? name : null;
    _applySpace(_roomOverride || _zoneSpace, opts);
  }
  function _applySpace(name, { instant = false, wet = null } = {}) {
    const c = ensureContext();
    if (!c || !reverbNode) return;
    const key = SPACES[name] ? name : 'room';
    const s = SPACES[key];
    const target = wet != null ? wet : s.wet;
    if (_space === key && wet == null) return;
    _space = key;
    // A buffer swap can't be ramped, so the send is ducked through it.
    const t = c.currentTime;
    if (instant) {
      reverbNode.buffer = impulseFor(key);
      reverbSend.gain.setValueAtTime(target, t);
      return;
    }
    reverbSend.gain.cancelScheduledValues(t);
    reverbSend.gain.setValueAtTime(reverbSend.gain.value, t);
    reverbSend.gain.linearRampToValueAtTime(0, t + 0.08);
    setTimeout(() => {
      if (_space !== key || !reverbNode) return;   // a later room already won
      reverbNode.buffer = impulseFor(key);
      const t2 = ctx.currentTime;
      reverbSend.gain.cancelScheduledValues(t2);
      reverbSend.gain.setValueAtTime(0, t2);
      reverbSend.gain.linearRampToValueAtTime(target, t2 + 0.25);
    }, 90);
  }

  // Seeded: WAV exports and sample-reading checks (hockey-smoke) must be reproducible.
  function getNoiseBuffer() {
    if (_noiseBuffer) return _noiseBuffer;
    const c = ensureContext();
    const length = c.sampleRate * 2;
    const buf = c.createBuffer(1, length, c.sampleRate);
    const data = buf.getChannelData(0);
    let s = 0x2545f491;
    for (let i = 0; i < length; i++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; data[i] = (s >>> 0) / 2147483648 - 1; }
    _noiseBuffer = buf;
    return buf;
  }

  // Retro stage (`config.retro: { rate, bits }`), relative to the cue's full scale `ref`.
  // see docs/amp-format.md#retro-stage-sfx
  // The hold needs the worklet (audio-retro-worklet.js); without it bits alone go
  // through a WaveShaper staircase, so a cue never goes silent.
  const _SELF_SRC = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || '';
  let _retroUrl = _SELF_SRC ? new URL('audio-retro-worklet.js', _SELF_SRC).href : '';
  const _retroState = new WeakMap();   // context -> true (ready) | false (unavailable) | Promise
  function loadRetro(c) {
    if (!c || !c.audioWorklet || !_retroUrl) return Promise.resolve(false);
    if (_retroState.has(c)) return Promise.resolve(_retroState.get(c));
    const p = c.audioWorklet.addModule(_retroUrl).then(() => { _retroState.set(c, true); return true; },
      (e) => { _retroState.set(c, false); console.warn('[audio] retro stage unavailable:', e && e.message); return false; });
    _retroState.set(c, p);
    return p;
  }
  const _stairCurves = new Map();
  function stairCurve(bits) {
    const b = Math.max(2, Math.min(16, bits | 0));
    let c = _stairCurves.get(b);
    if (c) return c;
    // Many points per step: a WaveShaper interpolates, so a coarse curve is a slope.
    const n = 8192, q = Math.pow(2, b - 1);
    c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = (x >= 0 ? Math.floor(x * q + 0.5) : -Math.floor(-x * q + 0.5)) / q; }
    _stairCurves.set(b, c);
    return c;
  }
  // Returns the node the layers connect to. `until` (context time) keeps the
  // worklet up across gaps between layers.
  function retroStage(c, retro, config, dest, until) {
    const rate = +retro.rate || 0, bits = +retro.bits || 0;
    if (!(rate > 0 || bits > 0)) return dest;
    const layers = Array.isArray(config.layers) && config.layers.length ? config.layers : [config];
    // A driven layer comes out at tanh's level, at the drive driveCurve rounds to.
    const amp = (l) => {
      const g = Math.abs(l.gain ?? 1);
      if (!(l.drive > 0)) return g;
      const k = 1 + (Math.round(Math.min(1, l.drive) * 20) / 20) * 24;
      return Math.tanh(k * g) / Math.tanh(k);
    };
    const ref = Math.max(1e-3, +retro.ref || layers.reduce((s, l) => s + amp(l), 0));
    let mid = null;
    if (_retroState.get(c) === true && typeof global.AudioWorkletNode === 'function') {
      mid = new global.AudioWorkletNode(c, 'siren-retro', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
        channelCount: 1, channelCountMode: 'explicit', processorOptions: { rate, bits, until: until || 0 } });
    } else if (bits > 0) {
      mid = c.createWaveShaper();
      mid.curve = stairCurve(bits);
    } else return dest;
    const pre = c.createGain(), post = c.createGain();
    pre.gain.value = 1 / ref; post.gain.value = ref;
    pre.connect(mid).connect(post).connect(dest);
    return pre;
  }

  // Layer noise: 8 s stereo white/pink/brown, normalised to white's RMS, with a
  // seamless loop. getNoiseBuffer stays for engineNodes(). Each layer starts at
  // its own seeded offset, or two layers in a cue phase; `noiseSeed` pins it.
  const NOISE_SECONDS = 8;
  const NOISE_COLOURS = ['white', 'pink', 'brown'];
  const NOISE_RMS = 1 / Math.sqrt(3);   // uniform white on ±1
  const _noiseColours = new Map();

  function _rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  let _noiseOffsetRng = _rng(0x51BE);

  function noiseBuffer(colour) {
    const key = NOISE_COLOURS.includes(colour) ? colour : 'white';
    if (_noiseColours.has(key)) return _noiseColours.get(key);
    const c = ensureContext();
    const sr = c.sampleRate;
    const n = sr * NOISE_SECONDS;
    const fade = Math.floor(sr * 0.05);
    const buf = c.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const r = _rng(0xA11CE + NOISE_COLOURS.indexOf(key) * 101 + ch * 7);
      const raw = new Float32Array(n + fade);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
      for (let i = 0; i < raw.length; i++) {
        const w = r() * 2 - 1;
        if (key === 'pink') {
          // Paul Kellett's filter, as ORACLE's speechNoise uses.
          b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
          b2 = 0.96900 * b2 + w * 0.1538520; b3 = 0.86650 * b3 + w * 0.3104856;
          b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
          raw[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
          b6 = w * 0.115926;
        } else if (key === 'brown') {
          // A leaky integrator, so it can't wander off into DC.
          br = (br + 0.02 * w) / 1.02;
          raw[i] = br;
        } else raw[i] = w;
      }
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = raw[i];
      // Equal-power crossfade of the run past the end into the start.
      for (let i = 0; i < fade; i++) {
        const th = (Math.PI / 2) * (i / fade);
        d[i] = raw[i] * Math.sin(th) + raw[n + i] * Math.cos(th);
      }
      let sum = 0;
      for (let i = 0; i < n; i++) sum += d[i] * d[i];
      const g = NOISE_RMS / Math.sqrt(sum / n || 1);
      for (let i = 0; i < n; i++) d[i] *= g;
    }
    _noiseColours.set(key, buf);
    return buf;
  }

  function noiseOffset(layer) {
    if (Number.isFinite(layer.noiseSeed)) return _rng(layer.noiseSeed)() * NOISE_SECONDS;
    return _noiseOffsetRng() * NOISE_SECONDS;
  }

  // Audio pushed before the first user gesture would be dropped; onUnlock defers it.
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

    // One-shot gesture unlock (mobile).
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
    const level = {
      music: _settings.music ? _settings.musicVolume : 0,
      sfx: _settings.sfx ? _settings.sfxVolume : 0,
      ambient: _settings.ambientVolume ?? 0.5,
      tv: _settings.tv ? _settings.tvVolume : 0,
      // Follows the sfx slider but never the sfx routing.
      ui: _settings.sfx ? _settings.sfxVolume : 0,
    };
    // Only the slider gains. The duck gains after them belong to duck().
    for (const name of BUS_NAMES) for (const g of buses[name].slider) g.gain.setTargetAtTime(level[name], t, 0.02);
  }

  function applyVolumeSettings(settings) {
    _settings = { ..._settings, ...(settings || {}) };
    if (ctx) _applyGains();
  }

  // Usually called before the context exists; ensureContext() wires the choice.
  function setMonoAudio(on) {
    on = !!on;
    if (on === _mono) return;
    _mono = on;
    if (!ctx || !_limitTrim || !_monoNode) return;
    try { _limitTrim.disconnect(); } catch { /* nothing connected yet */ }
    _limitTrim.connect(on ? _monoNode : ctx.destination);
  }

  // The bus a category plays on, by name: tv_voice and tv_fx are the tv bus.
  function busName(category) {
    if (category === 'tv' || category === 'tv_voice' || category === 'tv_fx') return 'tv';
    if (category === 'ambient' || category === 'music' || category === 'ui') return category;
    return 'sfx';
  }

  // A cue with its own reverb `send`: the bus's dry copy plus `send` into its wet copy.
  function cueBus(category, send) {
    const dest = busFor(category);
    if (!(Number.isFinite(send) && send >= 0) || !ctx) return dest;
    const name = busName(category);
    const sub = category === 'tv_voice' ? 'voice' : category === 'tv_fx' ? 'fx' : null;
    const entry = (kind) => {
      if (!sub) return _busPath(name, kind);
      const key = sub + '_' + kind;
      const b = buses.tv;
      if (b.paths[key]) return b.paths[key];
      const g = ctx.createGain();
      g.gain.value = _tvBalance[sub];
      g.connect(_busPath('tv', kind));
      _tvSubs[sub].push(g);
      b.paths[key] = g;
      return g;
    };
    const cue = ctx.createGain();
    cue.connect(entry('dry'));
    if (send > 0) {
      const s = ctx.createGain();
      s.gain.value = send;
      cue.connect(s).connect(entry('wet'));
    }
    return cue;
  }

  function busFor(category) {
    if (category === 'tv_voice') return tvVoiceGain;
    if (category === 'tv_fx') return tvFxGain;
    if (category === 'tv') return tvGain;
    if (category === 'ambient') return ambientGain;
    if (category === 'music') return musicGain;
    // ⚠ The accessibility bus (Read Aloud) MUST stay dry. sfx volume, own node
    // so it bypasses the reverb send.
    if (category === 'ui') return uiGain;
    return sfxGain;
  }

  // Voice pool with priority stealing.
  // ⚠ MAX_VOICES must stay above MAX_CHANNELS: a tracker step takes a voice per
  // channel, and equal-priority stealing would let a song and a fight evict
  // each other. see docs/systems-procedural-audio.md#the-voice-pool
  const MAX_VOICES = 32;
  const MAX_CHANNELS = 16; // tracker songs play at most 16 channels; extras are ignored
  const voices = new Array(MAX_VOICES).fill(null); // {priority, startedAt, stop()} | null

  // Counters, because a dropped cue is silent. Read with _voiceStats().
  const vstat = { played: 0, stolen: 0, dropped: 0, peak: 0 };

  function allocateVoice(priority) {
    let live = 0;
    let free = -1;
    for (let i = 0; i < MAX_VOICES; i++) {
      if (voices[i]) live++;
      else if (free === -1) free = i;
    }
    if (free !== -1) {
      vstat.played++;
      if (live + 1 > vstat.peak) vstat.peak = live + 1;
      return free;
    }
    vstat.peak = MAX_VOICES;
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
    if (stealIdx === -1) { vstat.dropped++; return -1; }
    vstat.stolen++;
    vstat.played++;
    voices[stealIdx].stop(true);
    voices[stealIdx] = null;
    return stealIdx;
  }

  // ⚠ Slots are recycled: a releaser must prove ownership with its token, or a
  // stolen cue's pending end timer frees whoever inherited the slot.
  let _voiceToken = 0;

  function occupyVoice(idx, priority, stopFn) {
    const token = ++_voiceToken;
    voices[idx] = { priority, startedAt: ctx.currentTime, stop: stopFn, token };
    return token;
  }

  // Omit the token only when the caller can't have been stolen.
  function freeVoice(idx, token) {
    const v = voices[idx];
    if (!v) return;
    if (token != null && v.token !== token) return;   // recycled: not ours to free
    voices[idx] = null;
  }

  // layer: { waveform, freq, detune, noiseMix, filter:{type,freq,q,to,time},
  //          adsr:{a,d,s,r}, vibrato:{rate,depth}, tremolo:{rate,depth},
  //          pitchBend:{to,time}, gain,
  //          fm:{ rate|ratio, rateTo|ratioTo, depth|index, depthTo|indexEnd,
  //               wave, time, op2:{ …the same keys again } } }
  // Every travelling parameter uses one {to, time} contract. In fm, the RATIO
  // form is relative to the note and the RATE form is absolute Hz.

  const OSC_WAVES = ['sine', 'square', 'sawtooth', 'triangle'];

  // N bandpasses in PARALLEL on one source, summed (formants; serial filters
  // would narrow to nothing). Shared by ORACLE and `layer.formants`; the handles
  // returned let ORACLE glide its bands.
  function buildResonatorBank(source, dest, bands) {
    const out = [];
    for (const b of bands) {
      const freq = typeof b === 'number' ? b : b.freq;
      if (!(freq > 0)) continue;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = freq;
      // A physically correct Q whistles without breath noise; ORACLE clamps its own.
      bp.Q.value = (typeof b === 'object' && b.q) || 6;
      const g = ctx.createGain();
      g.gain.value = (typeof b === 'object' && b.gain != null) ? b.gain : 1;
      source.connect(bp).connect(g).connect(dest);
      out.push({ filter: bp, gain: g });
    }
    return out;
  }

  // procedural-sfx.js voices as instrument rows. Resolved lazily: that global
  // may load after this file.
  const _codeVoices = new Map();
  function codeVoice(name) {
    if (!name) return null;
    if (_codeVoices.has(name)) return _codeVoices.get(name);
    const cfg = global.ProceduralSFX?.voiceConfig?.(name) || null;
    const row = cfg ? { waveform: cfg.waveform, config: cfg } : null;
    _codeVoices.set(name, row);
    return row;
  }

  // Cached by drive quantised to 0.05 (cue path: no per-note allocation).
  const _driveCurves = new Map();
  function driveCurve(amount) {
    const k = Math.round(Math.max(0, Math.min(1, amount)) * 20) / 20;
    let c = _driveCurves.get(k);
    if (c) return c;
    const n = 2048;
    c = new Float32Array(n);
    // Normalised tanh: monotonic, so it clips rather than folds.
    const g = 1 + k * 24;
    const norm = Math.tanh(g);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(x * g) / norm;
    }
    _driveCurves.set(k, c);
    return c;
  }

  // `driveType` clippers, normalised so full scale in is full scale out. `soft`
  // is driveCurve. hard: flat rails · tube: asymmetric tanh (DC blocked in
  // buildLayer) · fuzz: near-square by half drive.
  const DRIVE_TYPES = new Set(['hard', 'tube', 'fuzz']);
  function driveCurveOf(amount, type) {
    if (!DRIVE_TYPES.has(type)) return driveCurve(amount);
    const k = Math.round(Math.max(0, Math.min(1, amount)) * 20) / 20;
    const key = `${type}:${k}`;
    let c = _driveCurves.get(key);
    if (c) return c;
    const n = 2048, g = 1 + k * 24, bias = 0.4 * k;
    const f = type === 'hard' ? (x) => Math.max(-1, Math.min(1, x * g))
      : type === 'tube' ? (x) => Math.tanh(x * g + bias) - Math.tanh(bias)
      : (x) => Math.sign(x) * (1 - Math.exp(-Math.abs(x) * g * 2));
    c = new Float32Array(n);
    let peak = 0;
    for (let i = 0; i < n; i++) { c[i] = f((i / (n - 1)) * 2 - 1); peak = Math.max(peak, Math.abs(c[i])); }
    for (let i = 0; i < n; i++) c[i] /= peak || 1;
    _driveCurves.set(key, c);
    return c;
  }

  // The signal arrives at a quarter level (see `fold` in buildLayer), so the curve
  // folds four times harder: 1 to 6 quarter-turns of a sine.
  function foldCurve(amount) {
    const k = Math.round(Math.max(0, Math.min(1, amount)) * 20) / 20;
    const key = `fold:${k}`;
    let c = _driveCurves.get(key);
    if (c) return c;
    const n = 4096, folds = 1 + k * 5;
    c = new Float32Array(n);
    for (let i = 0; i < n; i++) c[i] = Math.sin(((i / (n - 1)) * 2 - 1) * 4 * folds * Math.PI / 2);
    _driveCurves.set(key, c);
    return c;
  }

  // Filter types whose `gain` (dB) means something.
  const GAIN_FILTERS = new Set(['peaking', 'lowshelf', 'highshelf']);
  // The types a `slope: 24` doubles.
  const SLOPE_FILTERS = new Set(['lowpass', 'highpass', 'bandpass', 'notch']);

  // `layer.mods`: patchable modulation sources. see docs/amp-format.md#mods
  //   { id:'lfo1', type:'lfo', wave:'triangle', rate:3, fade:0.4, to:[{ param:'filter.cutoff', amount:1200 }] }
  // Units: cents for pitch, ratio, cutoff and swept stages; index units for FM;
  // seconds for echo time; 0..1 for the rest.
  // ⚠ A mod->mod patch that closes a loop is dropped: Web Audio mutes a
  // delay-free cycle.
  const MOD_TYPES = new Set(['lfo', 'env', 'rand', 'seq']);
  const MOD_TARGETS = ['pitch', 'fm.index', 'fm.ratio', 'op2.index', 'op2.ratio', 'filter.cutoff', 'filter.q',
    'amp', 'pan', 'echo.time', 'echo.feedback', 'noise.rate',
    'sub.level', 'fold.amount', 'ring.freq', 'eq.freq', 'phaser.rate', 'phaser.freq', 'chorus.rate', 'chorus.depth'];
  // A doubled stage registers each of its params under one name; a cable reaches all.
  function modTarget(P, name, param, scale = 1) {
    if (P) (P[name] ||= []).push([param, scale]);
  }
  function modTargetSet(mods) {
    const s = new Set();
    for (const m of mods) for (const c of (Array.isArray(m?.to) ? m.to : [])) if (c?.param) s.add(c.param);
    return s;
  }
  // Authored order, so the first patch wins a would-be loop.
  function modPatches(mods) {
    const byId = new Map();
    for (const m of mods) if (m && MOD_TYPES.has(m.type) && m.id && !byId.has(m.id)) byId.set(m.id, m);
    const edges = new Map([...byId.keys()].map(k => [k, new Set()]));
    const reaches = (from, to) => {
      const seen = new Set(), q = [from];
      while (q.length) { const k = q.pop(); if (k === to) return true; if (seen.has(k)) continue; seen.add(k); q.push(...(edges.get(k) || [])); }
      return false;
    };
    const patches = [];
    for (const m of byId.values()) {
      for (const c of (Array.isArray(m.to) ? m.to : [])) {
        if (!c || typeof c.param !== 'string' || !Number.isFinite(c.amount) || c.amount === 0) continue;
        const mm = /^mod\.(.+)\.(rate|amount)$/.exec(c.param);
        if (mm) {
          if (!byId.has(mm[1]) || reaches(mm[1], m.id)) continue;   // unknown, self or a loop
          edges.get(m.id).add(mm[1]);
        }
        patches.push({ mod: m, param: c.param, amount: c.amount });
      }
    }
    return { byId, patches };
  }
  // Seeded, so a rendered cue is the same cue every time.
  function modRandom(seed) {
    let a = (Number.isFinite(seed) ? seed : 1) >>> 0 || 1;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  // P maps a target name to a list of [AudioParam, scale]; each cable's gain is amount * scale.
  // `span` is how long the note can last, for the random and sequenced steps. Returns release hooks.
  function buildMods(mods, P, time, span, nodes, layer) {
    const { byId, patches } = modPatches(mods);
    const out = new Map();      // id -> the source's depth gain, which every cable leaves from
    const releases = [];
    for (const m of byId.values()) {
      let src = null;
      if (m.type === 'lfo') {
        src = ctx.createOscillator();
        src.type = OSC_WAVES.includes(m.wave) ? m.wave : 'sine';
        src.frequency.setValueAtTime(Math.max(0, Number.isFinite(m.rate) ? m.rate : 2), time);
        modTarget(P, `mod.${m.id}.rate`, src.frequency, 1);
      } else if (ctx.createConstantSource) {
        src = ctx.createConstantSource();
        const o = src.offset;
        if (m.type === 'env') {
          const a = Math.max(0.001, m.a ?? 0.01), d = Math.max(0.001, m.d ?? 0.2), s = Math.max(0, Math.min(1, m.s ?? 0));
          o.setValueAtTime(0, time);
          o.linearRampToValueAtTime(1, time + a);
          if (m.curve === 'exp') o.setTargetAtTime(s, time + a, d / 3);
          else o.linearRampToValueAtTime(s, time + a + d);
          const r = Math.max(0.005, m.r ?? 0.2);
          releases.push((t) => { o.cancelScheduledValues(t); o.setTargetAtTime(0, t, r / 3); });
        } else if (m.type === 'seq') {
          const steps = (Array.isArray(m.steps) && m.steps.length ? m.steps.slice(0, 64) : [0])
            .map(v => Math.max(-1, Math.min(1, Number(v) || 0)));
          const rate = Math.max(0.05, Math.min(200, Number.isFinite(m.rate) ? m.rate : 8));
          const n = Math.min(4000, Math.ceil(span * rate) + 1);
          o.setValueAtTime(steps[0], time);
          for (let i = 1; i < n; i++) {
            const v = steps[i % steps.length], t = time + i / rate;
            if (m.glide) o.linearRampToValueAtTime(v, t); else o.setValueAtTime(v, t);
          }
        } else {
          const rate = Math.max(0.05, Math.min(200, Number.isFinite(m.rate) ? m.rate : 4));
          const rnd = modRandom(m.seed);
          const steps = Math.min(4000, Math.ceil(span * rate) + 1);
          o.setValueAtTime(rnd() * 2 - 1, time);
          for (let i = 1; i < steps; i++) {
            const v = rnd() * 2 - 1, t = time + i / rate;
            if (m.smooth) o.linearRampToValueAtTime(v, t); else o.setValueAtTime(v, t);
          }
        }
      }
      if (!src) continue;   // no ConstantSource on this browser: the env and rand mods sit out
      const depth = ctx.createGain();
      if (m.fade > 0) { depth.gain.setValueAtTime(0, time); depth.gain.linearRampToValueAtTime(1, time + m.fade); }
      else depth.gain.value = 1;
      src.connect(depth);
      src.start(time);
      nodes.push(src);
      out.set(m.id, depth);
      modTarget(P, `mod.${m.id}.amount`, depth.gain, 1);
      if (_probe) _probe('mod', m.id, depth, layer);
    }
    for (const p of patches) {
      const from = out.get(p.mod.id), targets = P[p.param];
      if (!from || !targets) continue;          // the layer has no such stage
      for (const [param, scale] of targets) {
        const cable = ctx.createGain();
        cable.gain.value = p.amount * scale;
        from.connect(cable).connect(param);
      }
    }
    return releases;
  }

  // `layer.modes`: modal synthesis of a struck object.
  //   modes: { hardness: 0..1, strike: 0..1, partials: [{ freq, decay, gain }] }
  // `decay` is seconds to -60 dB. Only gain, delay and pan apply; adsr.r is the
  // steal release. Each mode is a sine, not a high-Q bandpass (browsers disagree
  // on biquads that sharp). see docs/systems-procedural-audio.md#struck-surfaces-modes
  const MAX_MODES = 8;
  function buildModes(layer, destination, time) {
    const m = layer.modes;
    const nodes = [];
    const hard = Math.max(0, Math.min(1, m.hardness ?? 0.7));
    // contact time (s): 2.6 ms soft mallet down to 0.1 ms steel on glass
    const contact = 0.0025 * (1 - hard) * (1 - hard) + 0.0001;
    const nyq = ctx.sampleRate * 0.45;
    const out = ctx.createGain();
    out.gain.value = layer.gain ?? 1;
    out.connect(destination);
    let ring = 0;
    const partials = (Array.isArray(m.partials) ? m.partials : [])
      .filter(p => p && p.freq > 20 && p.freq < nyq && p.decay > 0 && p.gain > 0)
      .slice(0, MAX_MODES);
    for (const p of partials) {
      // Half-sine contact pulse spectrum at this frequency (first null at 1.5 / contact).
      const x = 2 * p.freq * contact;
      const pass = Math.abs(x - 1) < 1e-3 ? Math.PI / 4 : Math.abs(Math.cos(Math.PI * x / 2) / (1 - x * x));
      const level = p.gain * Math.max(0.02, pass);
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(p.freq, time);
      if (_dopSink) _dopSink.push(osc.detune);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, time);
      g.gain.linearRampToValueAtTime(level, time + contact);
      g.gain.setTargetAtTime(0, time + contact, p.decay / 6.91);
      osc.connect(g).connect(out);
      const end = time + contact + p.decay;
      osc.start(time);
      osc.stop(end + 0.02);
      nodes.push([osc, end + 0.02]);
      if (end > ring) ring = end;
    }
    if (m.strike > 0) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer();
      src.loop = true;   // a random offset can land near the buffer's end
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = Math.min(nyq, 1200 + 9000 * hard);
      lp.Q.value = 0.7;
      const g = ctx.createGain();
      const len = contact * 3 + 0.002;
      g.gain.setValueAtTime(m.strike, time);
      g.gain.setTargetAtTime(0, time, len / 3);
      src.connect(lp).connect(g).connect(out);
      src.start(time, noiseOffset(layer));
      src.stop(time + len * 3 + 0.01);
      nodes.push([src, time + len * 3 + 0.01]);
      if (time + len * 3 > ring) ring = time + len * 3;
    }
    const r = Math.max(0.01, layer.adsr?.r ?? 0.05);
    let released = false;
    function release(atTime) {
      if (released) return;
      released = true;
      const t = Math.max(atTime, ctx.currentTime);
      if (t >= ring) return;   // already rung out
      out.gain.cancelScheduledValues(t);
      out.gain.setValueAtTime(layer.gain ?? 1, t);
      out.gain.linearRampToValueAtTime(0, t + r);
      // only sooner: a later stop() would undo the one each node already has
      for (const [n, end] of nodes) if (end > t + r + 0.02) n.stop(t + r + 0.02);
    }
    return { release, gainNode: out };
  }

  function buildLayer(layer, destination, time, holdSeconds) {
    const nodes = [];
    if (layer.delay) time = time + layer.delay;
    // `mute` builds nothing; the gain node is for setLoopGain.
    if (layer.mute) return { release() {}, gainNode: ctx.createGain() };
    if (layer.modes && !layer.waveform) {
      // a struck object rings for its own decays; holdSeconds doesn't hold it
      if (Number.isFinite(layer.pan) && layer.pan !== 0 && ctx.createStereoPanner) {
        const p = ctx.createStereoPanner();
        p.pan.value = Math.max(-1, Math.min(1, layer.pan));
        p.connect(destination);
        destination = p;
      }
      return buildModes(layer, destination, time);
    }
    const mods = Array.isArray(layer.mods) && layer.mods.length ? layer.mods : null;
    const P = mods ? Object.create(null) : null;   // mod targets, filled as each stage is built
    const wants = mods ? modTargetSet(mods) : null;
    // Per-layer pan, last in the chain so the echo comes from the same side.
    if (((Number.isFinite(layer.pan) && layer.pan !== 0) || wants?.has('pan')) && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, layer.pan || 0));
      p.connect(destination);
      destination = p;
      modTarget(P, 'pan', p.pan, 1);
    }
    const adsr = layer.adsr || { a: 0.01, d: 0.05, s: 0.7, r: 0.15 };
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, time);
    let tone = null, sub = null;
    const noiseMix = layer.noiseMix ?? (layer.waveform === 'noise' ? 1 : 0);

    if (noiseMix < 1) {
      tone = ctx.createOscillator();
      tone.type = OSC_WAVES.includes(layer.waveform) ? layer.waveform : 'square';
      const freq = layer.freq || 440;
      tone.frequency.setValueAtTime(freq, time);
      if (layer.detune) tone.detune.setValueAtTime(layer.detune, time);
      modTarget(P, 'pitch', tone.detune, 1);
      if (_dopSink) _dopSink.push(tone.detune);
      if (layer.pitchBend?.to) {
        tone.frequency.setTargetAtTime(layer.pitchBend.to, time, Math.max(0.01, (layer.pitchBend.time || 0.2) / 3));
      }
      // Sub one or two octaves down: follows every pitch mover except FM.
      if (layer.sub?.level > 0) {
        const div = Math.pow(2, layer.sub.octave === 2 ? 2 : 1);
        sub = ctx.createOscillator();
        sub.type = OSC_WAVES.includes(layer.sub.wave) ? layer.sub.wave : 'sine';
        sub.frequency.setValueAtTime(freq / div, time);
        if (layer.detune) sub.detune.setValueAtTime(layer.detune, time);
        if (layer.pitchBend?.to) {
          sub.frequency.setTargetAtTime(layer.pitchBend.to / div, time, Math.max(0.01, (layer.pitchBend.time || 0.2) / 3));
        }
        modTarget(P, 'pitch', sub.detune, 1);
        if (_dopSink) _dopSink.push(sub.detune);
      }
      if (layer.vibrato?.rate) {
        const lfo = ctx.createOscillator();
        lfo.frequency.value = layer.vibrato.rate;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = layer.vibrato.depth || 10;
        lfo.connect(lfoGain).connect(tone.detune);
        if (sub) lfoGain.connect(sub.detune);
        lfo.start(time);
        nodes.push(lfo);
      }
      // Audio-rate FM into tone.frequency; `depth` is deviation in Hz.
      // `rate` is absolute Hz (impacts); `ratio` scales with the note (instruments).
      // ⚠ `index` = deviation / MODULATOR freq. note() in procedural-sfx.js
      // divides by the carrier instead. see docs/amp-format.md#fm-modulation
      const fmc = layer.fm;
      if (fmc && (fmc.rate || fmc.ratio)) {
        const carrier = layer.freq || 440;
        const tc = Math.max(0.005, (fmc.time || 0.2) / 3);
        const modRate = fmc.ratio ? carrier * fmc.ratio : fmc.rate;
        const mod = ctx.createOscillator();
        mod.type = OSC_WAVES.includes(fmc.wave) ? fmc.wave : 'sine';
        mod.frequency.setValueAtTime(modRate, time);
        // A ratio voice follows its carrier through a pitch bend unless ratioTo/rateTo is set.
        const modRateTo = fmc.ratioTo != null ? carrier * fmc.ratioTo
          : fmc.rateTo != null ? fmc.rateTo
          : (fmc.ratio && layer.pitchBend?.to) ? layer.pitchBend.to * fmc.ratio
          : null;
        if (modRateTo) mod.frequency.setTargetAtTime(modRateTo, time, tc);
        const modGain = ctx.createGain();
        // Velocity scales the ATTACK index by `bright`, centred on 0.5; the sweep
        // target isn't scaled. see docs/amp-format.md#velocity-and-timbre
        const vel = layer.velocity;
        const bright = (vel != null && fmc.bright) ? Math.max(0, 1 + (vel - 0.5) * fmc.bright) : 1;
        modGain.gain.setValueAtTime((fmc.index != null ? fmc.index * modRate : (fmc.depth ?? 100)) * bright, time);
        const depthTo = fmc.indexEnd != null ? fmc.indexEnd * (modRateTo || modRate) : fmc.depthTo;
        if (depthTo != null) modGain.gain.setTargetAtTime(depthTo, time, tc);
        // Operator 2 in SERIES (modulates the modulator). Its ratio is against the
        // NOTE, not the operator below. see docs/amp-format.md#a-second-operator
        const op2 = fmc.op2;
        if (op2 && (op2.rate || op2.ratio)) {
          const r2 = op2.ratio ? carrier * op2.ratio : op2.rate;
          const tc2 = Math.max(0.005, (op2.time ?? fmc.time ?? 0.2) / 3);
          const m2 = ctx.createOscillator();
          m2.type = OSC_WAVES.includes(op2.wave) ? op2.wave : 'sine';
          m2.frequency.setValueAtTime(r2, time);
          const r2To = op2.ratioTo != null ? carrier * op2.ratioTo : op2.rateTo;
          if (r2To) m2.frequency.setTargetAtTime(r2To, time, tc2);
          const g2 = ctx.createGain();
          g2.gain.setValueAtTime(op2.index != null ? op2.index * r2 : (op2.depth ?? 100), time);
          const d2To = op2.indexEnd != null ? op2.indexEnd * (r2To || r2) : op2.depthTo;
          if (d2To != null) g2.gain.setTargetAtTime(d2To, time, tc2);
          m2.connect(g2).connect(mod.frequency);
          modTarget(P, 'op2.index', g2.gain, r2);
          modTarget(P, 'op2.ratio', m2.detune, 1);
          if (_dopSink) _dopSink.push(m2.detune);
          m2.start(time);
          nodes.push(m2);
        }
        mod.connect(modGain).connect(tone.frequency);
        modTarget(P, 'fm.index', modGain.gain, modRate);
        modTarget(P, 'fm.ratio', mod.detune, 1);
        // Doppler moves the modulators with the carrier, so a ratio stays a ratio.
        if (_dopSink) _dopSink.push(mod.detune);
        mod.start(time);
        nodes.push(mod);
      }
    }

    let noiseSrc = null;
    if (noiseMix > 0) {
      noiseSrc = ctx.createBufferSource();
      noiseSrc.buffer = noiseBuffer(layer.noise);
      noiseSrc.loop = true;
      // `noiseRate` < 1 is darker
      if (layer.noiseRate > 0) noiseSrc.playbackRate.value = layer.noiseRate;
      modTarget(P, 'noise.rate', noiseSrc.playbackRate, 1);
      if (_dopSink && noiseSrc.detune) _dopSink.push(noiseSrc.detune);
    }

    let mixPoint = gain;

    // Drive 0..1, after the envelope and before the filter (an amplifier, not an
    // effect). Normalised, so drive adds harmonics without level.
    if (layer.drive > 0) {
      const shaper = ctx.createWaveShaper();
      shaper.curve = driveCurveOf(layer.drive, layer.driveType);
      shaper.oversample = '4x';   // the clipper makes harmonics above Nyquist; fold them back
      mixPoint.connect(shaper);
      mixPoint = shaper;
      // block the tube curve's DC offset
      if (layer.driveType === 'tube') {
        const dcBlock = ctx.createBiquadFilter();
        dcBlock.type = 'highpass';
        dcBlock.frequency.value = 12;
        dcBlock.Q.value = -3.01;   // dB for a highpass: Butterworth, no bump
        mixPoint.connect(dcBlock);
        mixPoint = dcBlock;
      }
    }

    // Wavefolder. The quarter-level input leaves headroom for a `fold.amount`
    // cable (depth 1 doubles the folds).
    if (layer.fold) {
      const pre = ctx.createGain();
      pre.gain.value = 0.25;
      const shaper = ctx.createWaveShaper();
      shaper.curve = foldCurve(layer.fold.amount ?? 0.5);
      shaper.oversample = '4x';
      mixPoint.connect(pre).connect(shaper);
      mixPoint = shaper;
      modTarget(P, 'fold.amount', pre.gain, 0.25);
    }

    // Ring mod: `ratio` follows the note, `freq` is fixed Hz. A gain of 0 with
    // the oscillator wired into its gain multiplies the two.
    const rc = layer.ring;
    if (rc && (rc.ratio > 0 || rc.freq > 0)) {
      const carrier = layer.freq || 440;
      const ro = ctx.createOscillator();
      ro.type = OSC_WAVES.includes(rc.wave) ? rc.wave : 'sine';
      ro.frequency.setValueAtTime(rc.ratio > 0 ? carrier * rc.ratio : rc.freq, time);
      if (rc.ratio > 0 && layer.pitchBend?.to) {
        ro.frequency.setTargetAtTime(layer.pitchBend.to * rc.ratio, time, Math.max(0.01, (layer.pitchBend.time || 0.2) / 3));
      }
      const product = ctx.createGain();
      product.gain.value = 0;
      ro.connect(product.gain);
      const mix = Math.max(0, Math.min(1, rc.mix ?? 1));
      const sum = ctx.createGain();
      const wet = ctx.createGain();
      wet.gain.value = mix;
      mixPoint.connect(product).connect(wet).connect(sum);
      if (mix < 1) {
        const dry = ctx.createGain();
        dry.gain.value = 1 - mix;
        mixPoint.connect(dry).connect(sum);
      }
      mixPoint = sum;
      modTarget(P, 'ring.freq', ro.detune, 1);
      if (_dopSink) _dopSink.push(ro.detune);
      ro.start(time);
      nodes.push(ro);
    }

    // Formants: a resonator bank that overrides `filter`. Bare Hz or {freq, q, gain};
    // `[700, 1220, 2600]` is roughly /ɑ/.
    if (Array.isArray(layer.formants) && layer.formants.length) {
      const sum = ctx.createGain();
      buildResonatorBank(mixPoint, sum, layer.formants);
      mixPoint = sum;
    } else if (layer.filter) {
      const filter = ctx.createBiquadFilter();
      filter.type = layer.filter.type || 'lowpass';
      filter.Q.value = layer.filter.q ?? 1;
      filter.frequency.setValueAtTime(layer.filter.freq || 4000, time);
      if (GAIN_FILTERS.has(filter.type) && Number.isFinite(layer.filter.gain)) {
        filter.gain.setValueAtTime(layer.filter.gain, time);
      }
      // Sweep: the same {to, time} contract as pitchBend.
      if (layer.filter.to) {
        filter.frequency.setTargetAtTime(
          layer.filter.to, time, Math.max(0.01, (layer.filter.time || 0.2) / 3)
        );
      }
      // ⚠ mixPoint, not `gain`, or the filter routes around the drive stage.
      mixPoint.connect(filter);
      mixPoint = filter;
      // cutoff moves on detune (cents): the same interval at any cutoff
      modTarget(P, 'filter.cutoff', filter.detune, 1);
      modTarget(P, 'filter.q', filter.Q, 1);
      if (_dopSink) _dopSink.push(filter.detune);
      // `slope: 24`: a second flat stage; the resonance stays the first stage's.
      if (layer.filter.slope === 24 && SLOPE_FILTERS.has(filter.type)) {
        const f2 = ctx.createBiquadFilter();
        f2.type = filter.type;
        // Q is dB for the passes (-3.01 is Butterworth)
        f2.Q.value = filter.type === 'lowpass' || filter.type === 'highpass' ? -3.01 : filter.Q.value;
        f2.frequency.setValueAtTime(layer.filter.freq || 4000, time);
        if (layer.filter.to) {
          f2.frequency.setTargetAtTime(layer.filter.to, time, Math.max(0.01, (layer.filter.time || 0.2) / 3));
        }
        mixPoint.connect(f2);
        mixPoint = f2;
        modTarget(P, 'filter.cutoff', f2.detune, 1);
        if (_dopSink) _dopSink.push(f2.detune);
      }
    }

    // EQ: low shelf, peak, high shelf (dB). `eq.freq` sweeps the peak, in cents.
    if (layer.eq) {
      const e = layer.eq;
      const band = (type, freq, dB, q) => {
        const b = ctx.createBiquadFilter();
        b.type = type;
        b.frequency.value = freq;
        b.gain.value = Math.max(-24, Math.min(24, Number(dB) || 0));
        if (q != null) b.Q.value = q;
        mixPoint.connect(b);
        mixPoint = b;
        return b;
      };
      band('lowshelf', e.lowFreq || 200, e.low);
      const mid = band('peaking', e.midFreq || 1000, e.mid, Math.max(0.1, e.q ?? 0.9));
      band('highshelf', e.highFreq || 4000, e.high);
      modTarget(P, 'eq.freq', mid.detune, 1);
    }

    // Per-layer compressor plus make-up gain; the probe lets the Rack show reduction.
    if (layer.comp) {
      const c = layer.comp;
      const dc = ctx.createDynamicsCompressor();
      const clamp = (v, lo, hi, d) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : d));
      dc.threshold.value = clamp(c.threshold, -100, 0, -24);
      dc.ratio.value = clamp(c.ratio, 1, 20, 4);
      dc.knee.value = clamp(c.knee, 0, 40, 6);
      dc.attack.value = clamp(c.attack, 0, 1, 0.005);
      dc.release.value = clamp(c.release, 0, 1, 0.15);
      const makeup = ctx.createGain();
      makeup.gain.value = Math.pow(10, clamp(c.makeup, -24, 24, 0) / 20);
      mixPoint.connect(dc).connect(makeup);
      mixPoint = makeup;
      if (_probe) _probe('comp', 'comp', dc, layer);
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

    // Built only for an `amp` patch: depth 1 swings between silence and double.
    if (wants?.has('amp')) {
      const aGain = ctx.createGain();
      aGain.gain.value = 1;
      mixPoint.connect(aGain);
      mixPoint = aGain;
      modTarget(P, 'amp', aGain.gain, 1);
    }

    // Phaser: swept allpasses mixed with dry. `depth` 1 sweeps two octaves either
    // side of `freq`; `mix` 0.5 is the deepest notch.
    if (layer.phaser) {
      const ph = layer.phaser;
      const n = [2, 4, 6, 8, 12].includes(ph.stages) ? ph.stages : 4;
      const mix = Math.max(0, Math.min(1, ph.mix ?? 0.5));
      const lfo = ctx.createOscillator();
      lfo.frequency.setValueAtTime(Math.max(0, Number.isFinite(ph.rate) ? ph.rate : 0.5), time);
      const sweep = ctx.createGain();
      sweep.gain.value = Math.max(0, Math.min(1, ph.depth ?? 0.7)) * 2400;
      lfo.connect(sweep);
      let x = mixPoint;
      for (let i = 0; i < n; i++) {
        const ap = ctx.createBiquadFilter();
        ap.type = 'allpass';
        ap.frequency.value = Math.max(20, ph.freq || 800);
        ap.Q.value = 0.6;
        sweep.connect(ap.detune);
        x.connect(ap);
        x = ap;
        modTarget(P, 'phaser.freq', ap.detune, 1);
      }
      const sum = ctx.createGain();
      const wet = ctx.createGain(); wet.gain.value = mix;
      const dry = ctx.createGain(); dry.gain.value = 1 - mix;
      x.connect(wet).connect(sum);
      mixPoint.connect(dry).connect(sum);
      mixPoint = sum;
      modTarget(P, 'phaser.rate', lfo.frequency, 1);
      lfo.start(time);
      nodes.push(lfo);
    }

    // Chorus: two wandering delays in antiphase, one per ear (the layer is stereo
    // from here). Under 5 ms with `feedback` is a flanger. `depth` is a fraction
    // of the delay, so it never reaches zero.
    if (layer.chorus) {
      const cc = layer.chorus;
      const base = Math.max(0.0005, Math.min(0.05, cc.delay ?? 0.015));
      const mix = Math.max(0, Math.min(1, cc.mix ?? 0.5));
      const fbv = Math.max(0, Math.min(0.9, cc.feedback ?? 0));
      const lfo = ctx.createOscillator();
      lfo.frequency.setValueAtTime(Math.max(0, Number.isFinite(cc.rate) ? cc.rate : 0.8), time);
      const swing = ctx.createGain();
      swing.gain.value = Math.max(0, Math.min(1, cc.depth ?? 0.3)) * base;
      lfo.connect(swing);
      const flip = ctx.createGain();
      flip.gain.value = -1;
      swing.connect(flip);
      const merge = ctx.createChannelMerger(2);
      const dry = ctx.createGain();
      dry.gain.value = 1 - mix;
      mixPoint.connect(dry);
      dry.connect(merge, 0, 0);
      dry.connect(merge, 0, 1);
      for (const [side, mod] of [[0, swing], [1, flip]]) {
        const d = ctx.createDelay(0.1);
        d.delayTime.value = base;
        mod.connect(d.delayTime);
        const wet = ctx.createGain();
        wet.gain.value = mix;
        mixPoint.connect(d);
        if (fbv > 0) { const fb = ctx.createGain(); fb.gain.value = fbv; d.connect(fb).connect(d); }
        d.connect(wet).connect(merge, 0, side);
      }
      mixPoint = merge;
      modTarget(P, 'chorus.rate', lfo.frequency, 1);
      modTarget(P, 'chorus.depth', swing.gain, base);
      lfo.start(time);
      nodes.push(lfo);
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
      modTarget(P, 'echo.time', delayNode.delayTime, 1);
      // depth 1 is all the room left under 0.95 (past 1 runs away)
      modTarget(P, 'echo.feedback', fb.gain, Math.max(0, 0.95 - fb.gain.value));
      // `heads: 2`: a second head at half the delay (tape gallop)
      if (layer.echo.heads === 2) {
        const head2 = ctx.createDelay(1.0);
        head2.delayTime.value = (layer.echo.delay ?? 0.18) / 2;
        const h2 = ctx.createGain();
        h2.gain.value = 0.7;
        delayNode.connect(head2).connect(h2).connect(destination);
        modTarget(P, 'echo.time', head2.delayTime, 0.5);
      }
    } else {
      mixPoint.connect(destination);
    }

    if (tone) {
      const toneGain = noiseMix > 0 ? ctx.createGain() : null;
      if (toneGain) { toneGain.gain.value = 1 - noiseMix; tone.connect(toneGain).connect(gain); }
      else tone.connect(gain);
      tone.start(time);
      nodes.push(tone);
      if (sub) {
        const subGain = ctx.createGain();
        subGain.gain.value = Math.min(1, layer.sub.level);
        sub.connect(subGain).connect(toneGain || gain);
        modTarget(P, 'sub.level', subGain.gain, 1);
        sub.start(time);
        nodes.push(sub);
      }
    }
    if (noiseSrc) {
      const noiseGain = ctx.createGain();
      noiseGain.gain.value = noiseMix;
      // Left channel alone is mono; `width` blends the right ear to the other
      // channel, equal-power.
      const split = ctx.createChannelSplitter(2);
      noiseSrc.connect(split);
      const width = Math.max(0, Math.min(1, layer.width || 0));
      if (width > 0) {
        const merge = ctx.createChannelMerger(2);
        const same = ctx.createGain(), other = ctx.createGain();
        same.gain.value = Math.cos(width * Math.PI / 2);
        other.gain.value = Math.sin(width * Math.PI / 2);
        split.connect(merge, 0, 0);
        split.connect(same, 0).connect(merge, 0, 1);
        split.connect(other, 1).connect(merge, 0, 1);
        merge.connect(noiseGain);
      } else {
        split.connect(noiseGain, 0);
      }
      noiseGain.connect(gain);
      noiseSrc.start(time, noiseOffset(layer));
      nodes.push(noiseSrc);
    }

    // Mods go last, after every stage registered. 30 s is playSfx's hold cap.
    const span = holdSeconds != null
      ? (layer.adsr?.a ?? 0.01) + (layer.adsr?.d ?? 0.05) + holdSeconds + (layer.adsr?.r ?? 0.15)
      : 30;
    const modReleases = mods ? buildMods(mods, P, time, span, nodes, layer) : null;

    // `curve: 'exp'`: exponential decay/release with τ = d/3; same timing as linear.
    const peak = layer.gain ?? 1;
    const sustainLevel = peak * (adsr.s ?? 0.7);
    const expo = adsr.curve === 'exp';
    const tau = Math.max(0.001, (adsr.d ?? 0.05) / 3);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(peak, time + (adsr.a ?? 0.01));
    if (expo) gain.gain.setTargetAtTime(sustainLevel, time + (adsr.a ?? 0.01), tau);
    else gain.gain.linearRampToValueAtTime(sustainLevel, time + (adsr.a ?? 0.01) + (adsr.d ?? 0.05));

    const releaseTime = adsr.r ?? 0.15;
    const attackEnd = time + (adsr.a ?? 0.01);
    const decayEnd = attackEnd + (adsr.d ?? 0.05);

    // ⚠ The envelope at `t`, computed from the schedule. Never read `.value`:
    // releases are scheduled at build time, when it's still the default 1, which
    // pins full gain back on a decayed note (a phantom second note).
    function envelopeAt(t) {
      if (t <= time) return 0;
      if (t < attackEnd) return peak * ((t - time) / Math.max(1e-6, attackEnd - time));
      if (expo) return sustainLevel + (peak - sustainLevel) * Math.exp(-(t - attackEnd) / tau);
      if (t < decayEnd) {
        const k = (t - attackEnd) / Math.max(1e-6, decayEnd - attackEnd);
        return peak + (sustainLevel - peak) * k;
      }
      return sustainLevel;
    }

    let released = false;
    function release(atTime) {
      if (released) return;
      released = true;
      const t = Math.max(atTime, ctx.currentTime);
      gain.gain.cancelScheduledValues(t);
      if (expo) {
        // exponential to -80 dB, then zero, so it ends
        const v0 = Math.max(1e-5, envelopeAt(t));
        gain.gain.setValueAtTime(v0, t);
        gain.gain.exponentialRampToValueAtTime(Math.min(v0, v0 * 1e-4 + 1e-6), t + releaseTime);
        gain.gain.setValueAtTime(0, t + releaseTime);
      } else {
        gain.gain.setValueAtTime(envelopeAt(t), t);
        gain.gain.linearRampToValueAtTime(0, t + releaseTime);
      }
      if (modReleases) for (const r of modReleases) r(t);
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
    // gainNode (for setLoopGain) is the first layer's only.
    return { release: (t) => releases.forEach(r => r.release(t)), gainNode: releases[0]?.gainNode };
  }

  // Samples: fetched once, decoded, downsampled to snes_rate, bit-crushed, cached by id.
  const _sampleCache = new Map(); // id -> processed AudioBuffer

  async function _processSnes(rawBuffer, snesRate, snesBits) {
    // snesBits 0 plays the decoded audio untouched.
    if (!snesBits) return rawBuffer;

    const ratio = rawBuffer.sampleRate / snesRate;
    const outLen = Math.max(1, Math.ceil(rawBuffer.length / ratio));
    const off = new OfflineAudioContext(1, outLen, snesRate);
    const src = off.createBufferSource();
    src.buffer = rawBuffer;
    src.connect(off.destination);
    src.start(0);
    const lo = await off.startRendering();
    // Bit-crush with TPDF dither (plain rounding gives correlated grain).
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
      // Locally imported samples carry their base64 inline.
      let data = def.data;
      if (!data) {
        const res = await fetch(`/api/audio/samples/${def.id}/data`);
        const json = await res.json();
        data = json.data;
      }
      if (!data) { console.warn('[audio] loadSample: no data for', def.id); return null; }
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

    // MIDI note to playback rate; the warmth lowpass tightens as the pitch rises
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
    // Static detune (cents): MOD finetune. Song vibrato adds on the same param.
    if (def.config?.detune) srcNode.detune.value = def.config.detune;
    if ((def.loop_end ?? 0) > 0) {
      srcNode.loop = true;
      srcNode.loopStart = def.loop_start ?? 0;
      srcNode.loopEnd = def.loop_end;
    }

    const naturalDuration = buf.duration / rate;
    const isLooping = (def.loop_end ?? 0) > 0;
    // 60 ms release floor declicks r:0 samples (every MOD sample).
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
    const sp = spatialOpen(opts.destination || busFor(def.category), opts, def.config);
    gainNode.connect(sp ? sp.input : (opts.destination || busFor(def.category)));
    spatialBind(sp, [srcNode.detune]);

    srcNode.start(schedTime);
    srcNode.stop(endAt);

    gainNode.gain.setTargetAtTime(0, releaseAt, Math.max(0.01, releaseTime / 3));

    const stopFn = () => {
      gainNode.gain.cancelScheduledValues(c.currentTime);
      gainNode.gain.setTargetAtTime(0, c.currentTime, 0.02);
    };
    const voiceToken = occupyVoice(idx, def.priority ?? 5, stopFn);
    const msUntilFree = Math.max(100, (endAt - c.currentTime + 0.1) * 1000);
    setTimeout(() => { freeVoice(idx, voiceToken); spatialClose(sp); }, msUntilFree);

    // Handle for per-channel monophony (cut) and live song fx state.
    const auxNodes = [];
    return {
      srcNode, gainNode,
      baseRate: rate, basePeak: peak, baseNote: def.base_note ?? 60,
      _rate: rate, _vol: peak, _toneTarget: null,
      attachAux(n) { auxNodes.push(n); },
      move: (pos, vel) => spatialMove(sp, pos, vel),
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
    return _playSampleFromBuffer(buf, def, opts, ctx.currentTime);
  }

  // `sustain: true` (playSfx) hands the note's ending to the caller.
  // ⚠ A normal cue can't be released later: buildLayer's release() latches, and
  // holdSeconds already calls it at build time.

  // When a game cue last started, for ui-sound.js (so a click doesn't get two cues).
  let _lastSfxAt = 0;
  function lastSfxAt() { return _lastSfxAt; }

  // Per room crossed: direct path 1/(1 + dry·rooms), high-shelf cut airDb, and
  // octaves of top end lost through an open way / a shut door.
  const DIST = { dry: 0.45, airDb: 3, openOct: 0.4, shutOct: 1.6 };

  // The source room's convolver, or the listener's reverb via the bus's wet copy
  // when it's the same room. Null for a bus with no reverb.
  function distanceSend(category, room, level) {
    if (!reverbNode || !(level > 0)) return null;
    const bus = busName(category);
    if (bus !== 'sfx' && bus !== 'ambient') return null;
    const g = ctx.createGain();
    if (room && SPACES[room] && room !== _space) {
      g.gain.value = level * SPACES[room].wet;
      g.connect(sourceRoomInput(bus, room));
    } else {
      g.gain.value = level;
      g.connect(_busPath(bus, 'wet'));
    }
    return g;
  }

  // 3D for the GLASS seats. `position` is a send option, never in a cue
  // definition; only the seat sets the listener pose. The rotation is done here,
  // not via AudioListener (Safari's has no AudioParams). Doppler goes as cents
  // into every detune the cue built. HRTF only up to `hrtfCap` voices.
  // see docs/systems-procedural-audio.md#position-and-doppler-in-a-seat
  const SPATIAL = {
    hrtfCap: 6, hrtfCapCompact: 2,
    speed: 343,          // metres per second
    minRatio: 0.5, maxRatio: 2,
    tau: 0.06,           // doppler smoothing, seconds
    moveTau: 0.03,       // position smoothing, seconds: long enough to stop zipper noise
    velTau: 0.12,        // smoothing for a velocity derived from successive positions
  };
  // _settings.spatialAudio. 'hrtf' is 'auto' without the phone cap; 'stereo' has no doppler.
  const SPATIAL_MODES = ['auto', 'hrtf', 'equalpower', 'stereo'];
  const _listener = { p: [0, 0, 0], f: [0, 1, 0], u: [0, 0, 1], r: [1, 0, 0], v: [0, 0, 0], mpu: 1, t: null, set: false };
  const _spatial = new Set();
  let _hrtfLive = 0;
  // While a positioned cue builds, buildLayer pushes every detune it makes here.
  let _dopSink = null;
  // `opts.probe(kind, id, node, layer)` during build: 'mod' outputs and 'comp' nodes, for the Rack.
  let _probe = null;

  const _dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const _sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const _cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const _norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : null; };
  const _vec = (v, fb) => {
    if (Array.isArray(v)) return [+v[0] || 0, +v[1] || 0, +v[2] || 0];
    if (v && typeof v === 'object') return [+v.x || 0, +v.y || 0, +v.z || 0];
    return fb;
  };
  const _nowS = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

  function spatialMode() {
    const m = _settings.spatialAudio;
    return SPATIAL_MODES.includes(m) ? m : 'auto';
  }
  function hrtfCap() {
    const m = spatialMode();
    if (m === 'equalpower' || m === 'stereo' || _mono) return 0;
    if (m === 'hrtf') return SPATIAL.hrtfCap;
    const compact = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    return compact ? SPATIAL.hrtfCapCompact : SPATIAL.hrtfCap;
  }

  // A gap over 0.5 s or a speed past 4x sound is a teleport: reset, don't swoop.
  function _trackVelocity(o, p, vel, t) {
    if (vel) { o.v = vel; o.t = t; o.p = p; return; }
    if (o.t != null && o.p) {
      const dt = t - o.t;
      if (dt > 1e-3 && dt < 0.5) {
        const raw = _sub(p, o.p).map(x => x / dt);
        const c = SPATIAL.speed / o.mpu;
        if (Math.hypot(raw[0], raw[1], raw[2]) > c * 4) o.v = [0, 0, 0];
        else {
          const k = 1 - Math.exp(-dt / SPATIAL.velTau);
          o.v = o.v.map((x, i) => x + (raw[i] - x) * k);
        }
      } else if (dt >= 0.5) o.v = [0, 0, 0];
    }
    o.t = t; o.p = p;
  }

  // The seat's camera each frame, in world units. ⚠ `right` defaults to fwd × up
  // (right-handed); a map frame (y south) is left-handed and must pass `right`.
  // `vel` is derived when omitted. Null resets.
  function setListenerPose(pose) {
    if (!pose) {
      Object.assign(_listener, { p: [0, 0, 0], f: [0, 1, 0], u: [0, 0, 1], r: [1, 0, 0], v: [0, 0, 0], t: null, set: false });
      return;
    }
    if (pose.metresPerUnit > 0) _listener.mpu = pose.metresPerUnit;
    const f = _norm(_vec(pose.fwd, _listener.f)) || _listener.f;
    let u = _norm(_vec(pose.up, _listener.u)) || _listener.u;
    const r = _norm(pose.right ? _vec(pose.right, null) : _cross(f, u)) || _listener.r;
    u = _norm(_cross(r, f)) || u;   // square it up against fwd and right
    // a left-handed frame comes out down: keep the caller's sense of up
    if (_dot(u, _vec(pose.up, u)) < 0) u = [-u[0], -u[1], -u[2]];
    _listener.f = f; _listener.u = u; _listener.r = r;
    _trackVelocity(_listener, _vec(pose.pos, _listener.p), pose.vel ? _vec(pose.vel, null) : null, pose.t ?? _nowS());
    _listener.set = true;
    for (const s of _spatial) _place(s, false);
  }

  // Where a source is for the listener: x right, y up, z forward.
  function _relative(p) {
    const d = _sub(p, _listener.p);
    return [_dot(d, _listener.r), _dot(d, _listener.u), _dot(d, _listener.f)];
  }

  function _dopplerRatio(s) {
    const d = _sub(s.p, _listener.p);
    const u = _norm(d);
    if (!u) return s.ratio;
    const c = SPATIAL.speed / _listener.mpu;
    const vl = _dot(_listener.v, u);   // listener closing on the source: up
    const vs = _dot(s.v, u);           // source moving away: down
    const ratio = (c + vl) / Math.max(c * 0.05, c + vs);
    return Math.max(SPATIAL.minRatio, Math.min(SPATIAL.maxRatio, ratio));
  }

  function _place(s, first) {
    if (!ctx || s.closed) return;
    const t = ctx.currentTime;
    const rel = _relative(s.p);
    s.rel = rel;
    if (s.panner) {
      // Web Audio's frame: x right, y up, -z ahead.
      const xyz = [rel[0], rel[1], -rel[2]];
      if (s.panner.positionX) {
        ['positionX', 'positionY', 'positionZ'].forEach((k, i) => {
          if (first) s.panner[k].setValueAtTime(xyz[i], t);
          else s.panner[k].setTargetAtTime(xyz[i], t, SPATIAL.moveTau);
        });
      } else s.panner.setPosition(xyz[0], xyz[1], xyz[2]);
    } else if (s.stereo) {
      const dist = Math.hypot(rel[0], rel[1], rel[2]);
      const pan = Math.max(-1, Math.min(1, rel[0] / Math.max(dist, s.ref)));
      const att = s.ref / (s.ref + s.rolloff * Math.max(0, dist - s.ref));
      if (first) { s.stereo.pan.setValueAtTime(pan, t); s.att.gain.setValueAtTime(att, t); }
      else { s.stereo.pan.setTargetAtTime(pan, t, SPATIAL.moveTau); s.att.gain.setTargetAtTime(att, t, SPATIAL.moveTau); }
    }
    s.ratio = _dopplerRatio(s);
    if (s.dop) {
      const cents = 1200 * Math.log2(s.ratio) * s.dopAmt;
      if (first) s.dop.offset.setValueAtTime(cents, t);
      else s.dop.offset.setTargetAtTime(cents, t, SPATIAL.tau);
    }
  }

  // Null when `opts.position` is absent.
  //   opts.position  where it is, world units
  //   opts.velocity  units per second; left out, derived from move() calls
  //   opts.ref       distance at full level (default 1 unit)
  //   opts.rolloff   inverse-distance rolloff (default 1; 0 leaves level to the caller)
  //   opts.doppler   0..1 scale on the shift, or false; default the cue's own
  //                  config.doppler, else 1
  function spatialOpen(dest, opts, config) {
    if (!opts || opts.position == null || !ctx) return null;
    const mode = spatialMode();
    const s = {
      p: _vec(opts.position, [0, 0, 0]), v: _vec(opts.velocity, [0, 0, 0]), t: _nowS(), mpu: 1,
      ref: opts.ref > 0 ? opts.ref : 1, rolloff: opts.rolloff >= 0 ? opts.rolloff : 1,
      autoVel: opts.velocity == null, ratio: 1, rel: [0, 0, 0],
      panner: null, stereo: null, att: null, dop: null, hrtf: false, closed: false, input: null,
    };
    if (mode !== 'stereo' && ctx.createPanner) {
      const p = ctx.createPanner();
      s.hrtf = _hrtfLive < hrtfCap();
      if (s.hrtf) _hrtfLive++;
      p.panningModel = s.hrtf ? 'HRTF' : 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = s.ref;
      p.rolloffFactor = s.rolloff;
      p.maxDistance = opts.maxDistance > 0 ? opts.maxDistance : 10000;
      p.connect(dest);
      s.panner = p;
      s.input = p;
    } else if (ctx.createStereoPanner) {
      s.att = ctx.createGain();
      s.stereo = ctx.createStereoPanner();
      s.stereo.connect(s.att).connect(dest);
      s.input = s.stereo;
    } else return null;
    const amt = opts.doppler === false ? 0 : Number.isFinite(opts.doppler) ? opts.doppler
      : config && config.doppler === false ? 0 : Number.isFinite(config?.doppler) ? config.doppler : 1;
    s.dopAmt = Math.max(0, Math.min(1, amt));
    if (s.dopAmt > 0 && mode !== 'stereo' && ctx.createConstantSource) {
      s.dop = ctx.createConstantSource();
      s.dop.offset.value = 0;
      s.dop.start(ctx.currentTime);
    }
    s.mpu = _listener.mpu;
    _spatial.add(s);
    _place(s, true);
    return s;
  }
  // Wire the detunes a build collected to the voice's doppler source.
  function spatialBind(s, params) {
    if (!s || !s.dop || !params) return;
    for (const p of params) { try { s.dop.connect(p); } catch { /* a param this browser lacks */ } }
  }
  function spatialMove(s, pos, vel) {
    if (!s || s.closed || pos == null) return;
    s.mpu = _listener.mpu;
    _trackVelocity(s, _vec(pos, s.p), vel != null ? _vec(vel, null) : null, _nowS());
    _place(s, false);
  }
  function spatialClose(s) {
    if (!s || s.closed) return;
    s.closed = true;
    _spatial.delete(s);
    if (s.hrtf) _hrtfLive = Math.max(0, _hrtfLive - 1);
    if (s.dop) { try { s.dop.stop(); } catch { /* already stopped */ } }
  }
  // What a positioned voice is doing, for a gate or a debug overlay.
  const spatialState = (s) => (s ? { rel: s.rel.slice(), ratio: s.ratio, cents: s.dop ? 1200 * Math.log2(s.ratio) * s.dopAmt : 0,
    model: s.panner ? (s.hrtf ? 'HRTF' : 'equalpower') : 'stereo', closed: s.closed } : null);
  // Build a cue's layers with the doppler sink open, then wire it.
  function _buildPositioned(s, fn) {
    if (!s || !s.dop) return fn();
    const prev = _dopSink;
    _dopSink = [];
    try { return fn(); } finally { spatialBind(s, _dopSink); _dopSink = prev; }
  }

  function playSfx(def, gainMultiplier = 1, opts = {}) {
    const c = init();
    if (!c || !def?.config) return null;
    if (def.category !== 'ui') _lastSfxAt = performance.now();
    const priority = def.priority ?? 5;
    const idx = allocateVoice(priority);
    if (idx === -1) return null; // dropped — all higher/equal-priority voices busy
    const time = c.currentTime;
    const duration = def.config.duration ?? 0.4;
    // `send` overrides the bus's reverb send (0 dry, 1 as sfx/ambient carry).
    let destination = cueBus(def.category, def.config.send ?? opts.send);
    // From another room (server's propagateAudio): `pan` is the doorway, `muffle`
    // the walls, `distance` rooms crossed, `shut` closed doors, `room` the source
    // reverb. ⚠ Send options, never cue keys: they belong to the listener.
    const dist = Math.max(0, Math.min(8, Number(opts.distance) || 0));
    if (dist > 0) {
      // Air: a high shelf, separate from the walls.
      const air = c.createBiquadFilter();
      air.type = 'highshelf';
      air.frequency.value = 2500;
      air.gain.value = -Math.min(15, DIST.airDb * dist);
      // The direct path falls and the reverb doesn't: that reads as distance.
      const dryLevel = 1 / (1 + DIST.dry * dist);
      const dry = c.createGain();
      dry.gain.value = dryLevel;
      air.connect(dry).connect(destination);
      const wet = distanceSend(def.category, opts.room, 1 - dryLevel);
      if (wet) air.connect(wet);
      destination = air;
    }
    const muffle = opts.muffle != null ? opts.muffle
      : dist > 0 ? Math.max(0, dist - (opts.shut || 0)) * DIST.openOct + (opts.shut || 0) * DIST.shutOct : 0;
    if (muffle > 0) {
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      // `muffle` is octaves off the top, floored at 400 Hz.
      lp.frequency.value = Math.max(400, 12000 / Math.pow(2, Math.min(5, muffle)));
      lp.Q.value = 0.5;
      lp.connect(destination);
      destination = lp;
    }
    // A `position` (a GLASS seat's) takes the place of `pan`; see spatialOpen.
    const sp = spatialOpen(destination, opts, def.config);
    if (sp) destination = sp.input;
    else if (opts.pan && c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, opts.pan));
      p.connect(destination);
      destination = p;
    }
    // `swell: { to, time }` ramps gain from gainMultiplier to `to` over `time` s.
    if (gainMultiplier !== 1 || opts.swell) {
      const g = c.createGain();
      g.gain.setValueAtTime(gainMultiplier, time);
      if (opts.swell) g.gain.linearRampToValueAtTime(opts.swell.to, time + Math.max(0.01, opts.swell.time));
      g.connect(destination);
      destination = g;
    }
    const sustain = opts.sustain === true;
    const into = def.config.retro ? retroStage(c, def.config.retro, def.config, destination, time + duration + cueTail(def.config)) : destination;
    _probe = typeof opts.probe === 'function' ? opts.probe : null;
    let sound;
    try { sound = _buildPositioned(sp, () => buildSound(def.config, into, time, sustain ? null : duration)); } finally { _probe = null; }
    const voiceToken = occupyVoice(idx, priority, () => sound.release(c.currentTime));
    // `duck` ducks other buses for the cue's duration, or until a held cue releases.
    const dk = def.config.duck;
    const cueDuck = dk ? duck(dk.buses || [], dk.dB ?? -9, {
      attack: dk.attack ?? 0.03, release: dk.release ?? 0.5, hold: sustain ? null : duration,
    }) : null;
    if (sustain) {
      let done = false;
      const end = () => {
        if (done) return;
        done = true;
        clearTimeout(capT);
        cueDuck?.release();
        sound.release(c.currentTime);
        const tail = Math.max(...(def.config.layers || [def.config]).map(l => l.adsr?.r ?? 0.15), 0.15);
        setTimeout(() => { freeVoice(idx, voiceToken); spatialClose(sp); }, (tail + 0.1) * 1000);
      };
      // ⚠ Keyups get lost; this cap is the only guard against a stuck drone.
      const capT = setTimeout(end, (opts.maxHold ?? 30) * 1000);
      if (sp) return { release: end, move: (pos, vel) => spatialMove(sp, pos, vel), state: () => spatialState(sp) };
      return { release: end };
    }
    // Hold the slot for the longest per-layer release.
    const tail = Math.max(def.config.adsr?.r ?? 0,
      ...(def.config.layers || []).map(l => (l.delay ?? 0) + (l.adsr?.r ?? 0)), 0.15);
    setTimeout(() => { freeVoice(idx, voiceToken); spatialClose(sp); }, (duration + tail + 0.1) * 1000);
    return sp ? { move: (pos, vel) => spatialMove(sp, pos, vel), state: () => spatialState(sp) } : null;
  }

  // Offline render through playSfx's graph. `ctx` is swapped only for the
  // synchronous build. renderSfx opts: { seconds, sampleRate, gain }.
  function cueTail(config) {
    const layers = Array.isArray(config.layers) && config.layers.length ? config.layers : [config];
    return Math.max(0.15, ...layers.map((l) => (l.delay ?? 0) + (l.adsr?.a ?? 0.01) + (l.adsr?.d ?? 0.05) + (l.adsr?.r ?? 0.15)));
  }
  async function renderSfx(def, opts = {}) {
    const OAC = global.OfflineAudioContext || global.webkitOfflineAudioContext;
    const config = def && def.config;
    if (!OAC || !config) return null;
    const sr = opts.sampleRate || (ctx && ctx.sampleRate) || 48000;
    const duration = config.duration ?? 0.4;
    const seconds = opts.seconds || duration + cueTail(config) + 0.05;
    const off = new OAC(1, Math.max(1, Math.ceil(sr * seconds)), sr);
    if (config.retro) await loadRetro(off);
    const live = ctx;
    ctx = off;
    try {
      let dest = off.destination;
      if (opts.gain != null && opts.gain !== 1) { const g = off.createGain(); g.gain.value = opts.gain; g.connect(dest); dest = g; }
      const into = config.retro ? retroStage(off, config.retro, config, dest, seconds) : dest;
      buildSound(config, into, 0, duration);
    } finally { ctx = live; }
    return off.startRendering();
  }
  // 16-bit mono WAV bytes from a rendered buffer, for a download link.
  function wavBytes(buffer) {
    const d = buffer.getChannelData(0), n = d.length, sr = buffer.sampleRate;
    const out = new DataView(new ArrayBuffer(44 + n * 2));
    const str = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); out.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
    out.setUint32(24, sr, true); out.setUint32(28, sr * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true);
    str(36, 'data'); out.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) { const v = Math.max(-1, Math.min(1, d[i])); out.setInt16(44 + i * 2, v < 0 ? v * 32768 : v * 32767, true); }
    return out.buffer;
  }

  const activeLoops = new Map(); // id -> { voiceIdx, release }

  // `jitter` is a fraction (0.1 = ±10%) on freq and pitchBend; clones, never mutates.
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

  // Bypasses the voice pool: a sparkle must never steal from its own bed.
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

  // Random one-shots over a bed. spec: { everyMin, everyMax, prob, gain, duration, jitter, layers }.
  // Returns cancel functions.
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
            const g = (spec.gain ?? 1) * (0.7 + Math.random() * 0.6);
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

  // `opts.position` (and the rest of spatialOpen's options) places the loop for a
  // GLASS seat; moveLoop moves it each frame.
  function loopSound(def, opts = {}) {
    const c = init();
    if (!c || !def) return;
    const id = def.id || def.name;
    if (activeLoops.has(id)) return;
    const priority = def.priority ?? 1;
    const idx = allocateVoice(priority);
    if (idx === -1) return;
    const time = c.currentTime;
    // Loops default to the ambient bus. Overrides: 'tv' (TV toggle) and 'sfx'
    // (a held control like a horn is an effect, not a bed).
    const loopCat = def.category === 'tv' || def.category === 'tv_fx' ? def.category : def.category === 'sfx' ? 'sfx' : 'ambient';
    const bus = cueBus(loopCat, def.config?.send);
    const sp = spatialOpen(bus, opts, def.config);
    const sound = _buildPositioned(sp, () => buildSound(def.config || {}, sp ? sp.input : bus, time, null));
    const baseGain = def.config?.gain ?? 1;
    const sparkleCancels = Array.isArray(def.config?.sparkle) && def.config.sparkle.length
      ? _startSparkles(def.config.sparkle, def.category)
      : null;
    const entry = { voiceIdx: idx, release: sound.release, gainNode: sound.gainNode, baseGain, sparkleCancels, sp };
    activeLoops.set(id, entry);
    entry.voiceToken = occupyVoice(idx, priority, () => { sound.release(c.currentTime); if (sparkleCancels) sparkleCancels.forEach(fn => fn()); activeLoops.delete(id); _closeLater(sp); });
  }

  // A positioned voice's panner outlives its release by the release itself.
  function _closeLater(sp) { if (sp) setTimeout(() => spatialClose(sp), 2000); }

  // Move a positioned loop: `pos` in the seat's world units, `vel` optional.
  function moveLoop(id, pos, vel) {
    const loop = activeLoops.get(id);
    if (loop?.sp) spatialMove(loop.sp, pos, vel);
  }
  const loopState = (id) => spatialState(activeLoops.get(id)?.sp);

  function stopLoop(id) {
    const loop = activeLoops.get(id);
    if (!loop) return;
    if (loop.sparkleCancels) loop.sparkleCancels.forEach(fn => fn());
    // Only touch the slot if this loop still owns it.
    const v = voices[loop.voiceIdx];
    if (v && v.token === loop.voiceToken) { v.stop(false); freeVoice(loop.voiceIdx, loop.voiceToken); }
    else loop.release?.(ctx ? ctx.currentTime : 0);
    activeLoops.delete(id);
    _closeLater(loop.sp);
  }

  // fraction 0-1 of the loop's own gain. ⚠ Must cancel scheduled values first,
  // or the loop's attack/decay ramp snaps gain back to sustain.
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

  const STEPS_PER_BEAT = 4; // one tracker row == a 16th note

  // MOD effects: approximations of ProTracker, tuned by ear. Sample voices only.
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

  // A song's rows: which it plays, from where to where, and how long each one is.
  function songShape(def) {
    const channels = (Array.isArray(def.channels) ? def.channels : []).slice(0, MAX_CHANNELS);
    const length = channels.reduce((m, ch) => Math.max(m, ch.length), 0);
    const loopStart = def.loop_start || 0;
    const loopEnd = def.loop_end > loopStart ? def.loop_end : (length - 1);
    const stepSeconds = 60 / (def.tempo || 120) / STEPS_PER_BEAT;
    return { channels, length, loopStart, loopEnd, stepSeconds };
  }

  // Seconds a song played once keeps its player after the last row.
  const SONG_TAIL = 3;

  // One tracker note. Pitch, level and velocity go into EVERY layer (a layered
  // config never reads a top-level `freq`), each moved by its `tune` semitones.
  // `len` holds the note that many rows (release a tenth of a row early);
  // without it a note holds 0.9 of a row past attack and decay.
  function songNote(instrument, step, freq, dest, time, stepSeconds) {
    const base = instrument.config || {};
    const vol = step.vol ?? 1;
    const wave = instrument.waveform || 'square';
    const at = (l) => freq * Math.pow(2, (l.tune || 0) / 12);
    const layers = Array.isArray(base.layers) && base.layers.length
      ? base.layers.map(l => ({ ...l, waveform: l.waveform || wave, freq: at(l) }))
      : [{ ...base, waveform: wave, freq: at(base) }];
    const len = step.len > 0 ? step.len : 0;
    const releases = layers.map(l => {
      l.gain = (l.gain ?? 1) * vol;
      // and as velocity, which reaches the timbre (`fm.bright`)
      l.velocity = vol;
      const ad = (l.adsr?.a ?? 0.01) + (l.adsr?.d ?? 0.05);
      return buildLayer(l, dest, time, len ? Math.max(0, (len - 0.1) * stepSeconds - ad) : stepSeconds * 0.9);
    });
    return { release: (t) => releases.forEach(r => r.release(t)) };
  }

  // opts.once plays through once, rings out, then calls opts.onEnd. opts.offline
  // builds into `ctx` for renderSong: no voice pool, timers or samples.
  function makeSongPlayer(def, outputGain, opts = {}) {
    const c = ctx;
    const { channels, loopStart, loopEnd, stepSeconds } = songShape(def);
    const priority = def.priority ?? 5;
    const once = !!opts.once, offline = !!opts.offline;
    let ringsUntil = 0;   // when the last scheduled note can still be sounding

    // Optional channel_pan (MOD import sets Amiga L-R-R-L).
    const pans = Array.isArray(def.channel_pan) && def.channel_pan.length ? def.channel_pan : null;
    // Headroom only for sample-backed songs, whose full-scale samples clip when summed.
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
    // Monophonic per channel: a new note cuts the ringing one.
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

        // Tone portamento: slide without retriggering; a note on the row sets the target.
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

        if (!hasNote) {
          if (fx && live) applySampleFx(live, fx, time, stepSeconds);
          return;
        }

        // An unknown instrument id falls back to the code voices (`piano`, `rhodes`...).
        const instrument = (def._instrumentsById && def._instrumentsById[step.instrument])
          || codeVoice(step.instrument)
          || {};
        if (live) { live.cut(time); channelVoice[chIdx] = null; }

        // Samples go through the channel gain (not the sfx bus). Skipped offline:
        // the buffer is decoded on the live context.
        if (instrument._sampleDef) {
          if (offline) return;
          const midi = _noteToMidi(step.note);
          const sampleOpts = { note: midi, gain: step.vol ?? 1, destination: channelGains[chIdx] };
          const onVoice = (v) => { if (v) { channelVoice[chIdx] = v; if (fx) applySampleFx(v, fx, time, stepSeconds); } };
          const cached = _sampleCache.get(instrument._sampleDef.id);
          if (cached) {
            onVoice(_playSampleFromBuffer(cached, instrument._sampleDef, sampleOpts, time));
          } else {
            // first use: this note plays late
            loadSample(instrument._sampleDef).then(buf => {
              if (buf) onVoice(_playSampleFromBuffer(buf, instrument._sampleDef, sampleOpts, c.currentTime));
            });
          }
          return;
        }

        const freq = noteToFreq(step.note);
        if (freq == null) return;
        const rows = step.len > 1 ? step.len : 1;
        ringsUntil = Math.max(ringsUntil, time + rows * stepSeconds + SONG_TAIL);
        const idx = offline ? -2 : allocateVoice(priority);
        if (idx === -1) return;
        const sound = songNote(instrument, step, freq, channelGains[chIdx], time, stepSeconds);
        channelVoice[chIdx] = { cut: (t) => sound.release(t), srcNode: null };
        if (offline) return;
        const voiceToken = occupyVoice(idx, priority, () => sound.release(c.currentTime));
        const ms = Math.max(0, (time - c.currentTime) * 1000) + (rows * stepSeconds * 1000) + 200;
        setTimeout(() => freeVoice(idx, voiceToken), ms);
      });
      if (def.onStep && !offline) {
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
          if (once) {
            stopped = true;
            clearInterval(timer);
            setTimeout(() => { stop(); opts.onEnd?.(); }, Math.max(0, ringsUntil - c.currentTime) * 1000);
            return;
          }
          currentStep = loopStart;
          if (onLoopWrap) onLoopWrap();
        }
      }
    }

    // Offline: loop start to loop end once, timed from zero.
    function renderAll() {
      for (let i = loopStart; i <= loopEnd; i++) scheduleStep(i, (i - loopStart) * stepSeconds);
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
      // Must cut each live voice: disconnecting alone leaves scheduled tails ringing.
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

    return { start, pause, resume, stop, setChannelWeight, renderAll, set onLoopWrap_(fn) { onLoopWrap = fn; }, gainNode: outputGain };
  }

  let activePlayer = null;
  let pendingNext = null;
  let activeSongId = null;
  let activeOwner = null;

  // The caller attaches def._instrumentsById = {id: instrumentRow} before
  // playMusic/fadeTo; this engine fetches nothing.
  function playMusic(def, opts = {}) {
    const c = init();
    if (!c || !def) return;
    // restartIfSame: false skips a re-pushed zone theme that's already playing.
    const songId = def.id ?? def.name ?? null;
    if (opts.restartIfSame === false && activePlayer && activeSongId === songId) return;
    if (activePlayer) activePlayer.stop();
    activeSongId = songId;
    // One global player is shared, so stopMusicOwnedBy needs to know who started it.
    activeOwner = opts.owner ?? null;
    // pre-warm samples so first notes don't stutter
    for (const inst of Object.values(def._instrumentsById || {})) {
      if (inst._sampleDef) loadSample(inst._sampleDef);
    }
    const gain = c.createGain();
    gain.connect(musicGain);
    // once: the player is let go, so asking again restarts rather than skips
    const player = makeSongPlayer(def, gain, {
      once: !!opts.once,
      onEnd: () => { if (activePlayer === player) { activePlayer = null; activeSongId = null; activeOwner = null; } },
    });
    activePlayer = player;
    activePlayer.onLoopWrap_ = () => {
      if (pendingNext) {
        const next = pendingNext;
        pendingNext = null;
        fadeTo(next);
      }
    };
    activePlayer.start();
  }

  // renderSfx's song twin, once through. Synth instruments only. `tail` defaults
  // to SONG_TAIL; `stereo` renders channel_pan (the Node test double is mono).
  async function renderSong(def, opts = {}) {
    const OAC = global.OfflineAudioContext || global.webkitOfflineAudioContext;
    if (!OAC || !def) return null;
    const sr = opts.sampleRate || (ctx && ctx.sampleRate) || 48000;
    const { loopStart, loopEnd, stepSeconds } = songShape(def);
    const seconds = Math.max(0, loopEnd - loopStart + 1) * stepSeconds + (opts.tail ?? SONG_TAIL);
    const off = new OAC(opts.stereo ? 2 : 1, Math.max(1, Math.ceil(sr * seconds)), sr);
    const live = ctx;
    ctx = off;
    try {
      let dest = off.destination;
      if (opts.gain != null && opts.gain !== 1) { const g = off.createGain(); g.gain.value = opts.gain; g.connect(dest); dest = g; }
      makeSongPlayer(def, dest, { offline: true }).renderAll();
    } finally { ctx = live; }
    return off.startRendering();
  }

  function stopMusic() {
    activeSongId = null;
    activeOwner = null;
    if (!activePlayer) return;
    activePlayer.stop();
    activePlayer = null;
  }

  // Stops only if `owner` started what's playing (closing the TV mustn't cut the zone theme).
  function stopMusicOwnedBy(owner) {
    if (!owner || activeOwner !== owner) return false;
    stopMusic();
    return true;
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

  // Dip a loop's gain briefly, then swell back.
  function duckLoop(id, fraction = 0.35, holdSeconds = 0.9, rampSeconds = 0.08) {
    if (!activeLoops.has(id)) return;
    setLoopGain(id, fraction, rampSeconds);
    setTimeout(() => { if (activeLoops.has(id)) setLoopGain(id, 1, 0.4); }, holdSeconds * 1000);
  }

  // Master-bus echo send (the cannabis high). Wet only; the dry path is untouched.
  //   setEcho(true, { mix, delay, feedback }) turns it on or retunes
  //   setEcho(false) fades out and tears down
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
        // Into the limiter, not past it: the echo adds to the peak.
        delay.connect(_limiter);
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
      // Disconnect fully after the tail, or toggles orphan nodes on the master bus.
      setTimeout(() => { try { masterGain.disconnect(n.wet); n.wet.disconnect(); n.delay.disconnect(); n.fb.disconnect(); } catch { /* already gone */ } }, 3000);
    }
  }

  // WS audio_stop
  function stop(scope, id) {
    if (scope === 'music') stopMusic();
    else if (scope === 'ambience') { if (id) stopLoop(id); else for (const k of [...activeLoops.keys()]) stopLoop(k); }
  }

  function clearSampleCache(id) {
    if (id) _sampleCache.delete(id);
    else _sampleCache.clear();
  }

  // ── ORACLE — Orthography, Resonance, Accent, Cadence, Lexicon & Emphasis ────
  //
  // The formant speech synth: text to phoneme (lexicon + rules), then phoneme to
  // formants. Tuned in the dev panel's Voice Lab tab.
  // ⚠ Doesn't use buildLayer (see the file header); shares the resonator bank.
  // A narrator's name seeds a deterministic voice. Rides the 'tv' bus.
  const Speech = (function () {
    // Formant loci: place of articulation is heard in how the neighbouring
    // vowel's F2 bends, so each obstruent has a locus the formants glide to.
    const RHOTIC = [470, 1180, 1480];   // an r-coloured vowel's end: /r/ after a vowel (see the loop)
    const GLIDE_RELEASE = { W: 0.045, Y: 0.040, R: 0.040, L: 0.012 };   // s; a vowel's glide out of each
    const LAB = [350, 1000, 2250];   // lips:            P B M F V W — F2 pulled low
    const DEN = [350, 1650, 2600];   // teeth:           TH DH
    const ALV = [350, 1750, 2650];   // alveolar ridge:  T D S Z N L
    const PAL = [350, 1850, 2500];   // post-alveolar:   SH ZH CH JH
    const VEL = [320, 2000, 2350];   // soft palate:     K G NG — the "velar pinch",
                                     //                  F2 and F3 converging

    // Phoneme inventory: [F1,F2,F3] Hz, type, nominal duration (ms).
    // Types: V vowel, N nasal, L liquid/glide, F fricative, S stop, H aspirate, P pause.
    // lf: formant locus. az: nasal antiformant (what tells M/N/NG murmurs apart).
    const PH = {
      IY:{f:[270,2290,3010],t:'V',d:130}, IH:{f:[390,1990,2550],t:'V',d:100},
      EH:{f:[530,1840,2480],t:'V',d:110}, AE:{f:[660,1720,2410],t:'V',d:140},
      AA:{f:[730,1090,2440],t:'V',d:150}, AO:{f:[570,840,2410],t:'V',d:140},
      UH:{f:[440,1020,2240],t:'V',d:100}, UW:{f:[300,870,2240],t:'V',d:140},
      ER:{f:[490,1350,1580],t:'V',d:150}, AH:{f:[640,1190,2390],t:'V',d:90},
      // schwa: never stressed
      AX:{f:[600,1200,2400],t:'V',d:65},
      // RP NURSE /ɜː/: ER with F3 raised (a low F3 is what reads as rhotic)
      ERR:{f:[490,1350,2350],t:'V',d:165},
      // RP GOAT /əʊ/: GA's OW offglide from a central start
      OWR:{f:[500,1400,2350], to:[440,950,2350], t:'V',d:180},
      // ⚠ Offglides stop well short of /i/ or /u/; gliding all the way closes the
      // vowel off like a consonant ("no" heard as "num").
      EY:{f:[530,1840,2480],to:[370,2150,2700],t:'V',d:170},
      AY:{f:[730,1090,2440],to:[430,1850,2550],t:'V',d:180},
      OY:{f:[570,840,2410], to:[430,1800,2500],t:'V',d:180},
      OW:{f:[500,900,2450], to:[420,800,2350], t:'V',d:170},   // starts at /o/, not /ɔ/
      AW:{f:[730,1090,2440],to:[480,1000,2350], t:'V',d:180},
      M:{f:[250,1100,2200],t:'N',d:80,az:1000}, N:{f:[250,1700,2600],t:'N',d:80,az:1800}, NG:{f:[250,2000,2900],t:'N',d:80,az:2900},
      // `df` is dark /l/ (not before a vowel): F2 near a back vowel
      L:{f:[360,1300,2600],df:[430,760,2700],t:'L',d:70,tc:0.020}, R:{f:[330,1060,1450],t:'L',d:80,tc:0.020},
      W:{f:[300,610,2200],t:'L',d:70,tc:0.022},  Y:{f:[270,2290,3010],t:'L',d:60,tc:0.022},
      // `ng`: per-phoneme noise level; sibilants sit low or they shout. Low `nq`
      // keeps /s/ broadband (a narrow band whistles).
      S:{t:'F',d:100,nf:5600,nq:1.3,ng:0.18,vd:0,lf:ALV,sib:1},  Z:{t:'F',d:95,nf:5600,nq:1.3,ng:0.12,vd:.5,lf:ALV,sib:1},
      SH:{t:'F',d:115,nf:3000,nq:1.2,ng:0.16,vd:0,lf:PAL,sib:1},   ZH:{t:'F',d:100,nf:3000,nq:1.2,ng:0.13,vd:.5,lf:PAL,sib:1},
      F:{t:'F',d:100,nf:5000,nq:0.6,ng:0.03,vd:0,lf:LAB},  V:{t:'F',d:90,nf:5000,nq:0.6,ng:0.02,vd:.5,lf:LAB},
      TH:{t:'F',d:100,nf:5500,nq:0.6,ng:0.024,vd:0,lf:DEN}, DH:{t:'F',d:80,nf:5000,nq:0.6,ng:0.012,vd:.5,lf:DEN},
      HH:{t:'H',d:80,nf:1500,nq:1,vd:0},
      CH:{t:'F',d:95,nf:3000,nq:1.2,ng:0.14,vd:0,stopFirst:1,lf:PAL,sib:1}, JH:{t:'F',d:85,nf:3000,nq:1.2,ng:0.09,vd:.4,stopFirst:1,lf:PAL,sib:1},
      // asp: voice-onset time, ms (the voiced/voiceless cue). bq: burst Q (low
      // diffuse, high compact; velars compact). bd: burst ms. bg: burst level.
      // see docs/systems-procedural-audio.md#the-burst-had-a-frequency-but-no-shape
      P:{t:'S',d:90,nf:1100,vd:0,lf:LAB,asp:55,bq:0.7,bd:10,bg:0.55}, B:{t:'S',d:80,nf:900,vd:.4,lf:LAB,asp:8,bq:0.7,bd:8,bg:0.35},
      T:{t:'S',d:90,nf:4600,vd:0,lf:ALV,asp:65,bq:1.2,bd:12,bg:1.3}, D:{t:'S',d:80,nf:4000,vd:.4,lf:ALV,asp:10,bq:1.2,bd:10,bg:0.8},
      K:{t:'S',d:90,nf:2000,vd:0,lf:VEL,asp:75,bq:3.5,bd:22,bg:1.8}, G:{t:'S',d:80,nf:1800,vd:.4,lf:VEL,asp:14,bq:3.5,bd:18,bg:1.1},
      // Flap: a stop (for the loci) with a voiced tap's timing.
      DX:{t:'S',d:28,nf:2600,vd:.7,lf:ALV,asp:0,bg:0.15},
      // Pauses. A word gap is barely a gap; each punctuation break has its own
      // length. `term` ends a phrase (re-pitch, declination reset).
      _:{t:'P',d:40},              // word gap
      _M:{t:'P',d:80,minor:1},     // a minor break nobody wrote (placeAccents); lighter than a comma
      _C:{t:'P',d:150},            // comma: the lightest written break
      _S:{t:'P',d:260},            // semicolon / colon
      _D:{t:'P',d:190},            // dash, parenthesis
      _E:{t:'P',d:430,term:1},     // ellipsis
      __:{t:'P',d:250,term:1},     // full stop
      _X:{t:'P',d:200,term:1},     // exclamation
      _XX:{t:'P',d:220,term:1},    // "!!" or more (see phraseK in speak)
      _Q:{t:'P',d:290,term:1},     // question
      _P:{t:'P',d:480,term:1},     // paragraph / line break
    };
    // `_` is a juncture, deliberately NOT a break.
    const isBreak = c => !!(PH[c] && PH[c].t === 'P' && c !== '_');
    const isTerm  = c => !!(PH[c] && PH[c].term);
    const isGap   = c => !!(PH[c] && PH[c].t === 'P');

    // Hand dictionary; wins over CMU. '*' marks primary stress, AX schwa.
    const DICT = {
      the:'DH AX', a:'AX', of:'AX V', to:'T AX', evening:'* IY V N IH NG',
      soylent:'S * OY L AX N T', coldwater:'K * OW L D W AO T ER', architect:'* AA R K AX T EH K T',
      halcyon:'HH * AE L S IY AX N', deadball:'D * EH D B AO L',
      craniumtrust:'K R * EY N IY AX M T R AH S T', gleamtooth:'G L * IY M T UW TH',
      cyberware:'S * AY B ER W EH R', cybernetic:'S AY B ER N * EH T IH K',
      neonoodles:'N IY OW N * UW D AX L Z', hydrate:'HH * AY D R EY T',
      grimaldi:'G R IH M * AA L D IY', delacroix:'D EH L AX K R W * AA',
      delphine:'D EH L F * IY N', ferraro:'F ER * AA R OW',
      // initialisms stress the LAST letter
      dmv:'D IY EH M V * IY', gdp:'JH IY D IY P * IY', crt:'S IY AA R T * IY',
      // Prefer a productive stem to a compound: compoundLook builds the rest.
      holo:'HH * AA L OW', chem:'K * EH M', cryo:'K R * AY OW',
      nano:'N * AE N OW', mag:'M * AE G', synth:'S * IH N TH',
      cyd:'S * IH D',                   // "Sid", not "Seed"
      echelon:'* EH SH AH L AA N',
      kiyo:'K * IY OW',
      bijou:'B IY ZH * UW',
      merrin:'M * EH R IH N',
      solenne:'S OW L * EH N',
      auggie:'* AO G IY',               // "AW-ghee"
      vigo:'V * IY G OW',               // "VEE-go"
    };
    function dictLook(w){ return DICT[w] ? DICT[w].split(' ') : null; }

    // Contractions CMUdict lacks that cliticLook can't derive (won't, don't, can't...).
    const CONTRACT = {
      "won't":"W * OW N T",   "can't":"K * AE N T",   "don't":"D * OW N T",
      "shan't":"SH * AE N T", "ain't":"* EY N T",     "y'all":"Y * AO L",
      "let's":"L * EH T S",   "o'clock":"AX K L * AA K",
      "gonna":"G * AO N AX",  "wanna":"W * AA N AX",  "gotta":"G * AA T AX",
      "kinda":"K * AY N D AX","sorta":"S * AO R T AX","outta":"* AW T AX",
      "'em":"AX M",           "'til":"T IH L",        "ma'am":"M * AE M",
    };

    // Stem + clitic; only /s/ inflects, by the plural rule.
    const CLITIC = { m:['M'], ll:['L'], ve:['V'], re:['ER'], d:['D'] };
    function cliticLook(w, stemPh){
      const q = w.indexOf("'");
      if (q < 1) return null;
      const stem = w.slice(0, q), tail = w.slice(q + 1);
      // "isn't" is "is" + /ənt/
      if (tail === 't' && stem.endsWith('n')) {
        const ph = stemPh(stem.slice(0, -1));
        return ph ? [...ph, 'AX', 'N', 'T'] : null;
      }
      const ph = stemPh(stem); if (!ph) return null;
      if (tail === 's') {                       // possessive AND "it's"/"he's" — same rule
        const last = ph[ph.length - 1];
        if (SIBILANT.has(last)) return [...ph, 'IH', 'Z'];
        return [...ph, VOICED_END.has(last) ? 'Z' : 'S'];
      }
      return CLITIC[tail] ? [...ph, ...CLITIC[tail]] : null;
    }

    // Per-utterance lexicon (speak(..., { lex }), e.g. books.pronunciation), checked
    // first. Module-scoped is safe only because text-to-phoneme is synchronous.
    let _lex = null;
    function lexLook(w){
      if (!_lex) return null;
      const v = _lex[w];
      return v ? String(v).trim().split(/\s+/) : null;
    }

    // CMUdict subset, decoded lazily.
    let CMU = null;
    // ⚠ The game page fetches the lexicon after load (requestCmu). Until then
    // lookups fall to letter rules and nothing is cached.
    let cmuRequested = false;
    function requestCmu(){
      if (cmuRequested || global.CMUDICT || typeof document === 'undefined' || !document.head) return;
      cmuRequested = true;
      const s = document.createElement('script');
      s.src = '/shared/formant-cmudict.js';
      s.async = true;
      s.onerror = () => { cmuRequested = false; };   // let a later lookup try again
      document.head.appendChild(s);
    }
    if (typeof document !== 'undefined' && typeof addEventListener === 'function') {
      const soon = () => (global.requestIdleCallback || ((f) => setTimeout(f, 1500)))(requestCmu);
      if (document.readyState === 'complete') soon(); else addEventListener('load', soon, { once: true });
    }
    function cmuBuild(){
      const D = global.CMUDICT;
      if (!D) { requestCmu(); return; }
      CMU = new Map();
      CMU._A = D.alpha; CMU._P = D.phones;
      for (const line of D.blob.split('\n')) {
        const sp = line.indexOf(' '); if (sp < 0) continue;
        CMU.set(line.slice(0, sp), line.slice(sp + 1));
      }
    }
    // Stress digits become '*' before a primary vowel; AH0 becomes AX. Other
    // unstressed vowels keep their quality on purpose ("happy", not "happuh").
    function cmuLook(w){
      if (!CMU) cmuBuild();
      if (!CMU) return null;   // lexicon still loading: letter-to-sound takes it
      const enc = CMU.get(w); if (!enc) return null;
      const out = [];
      for (const ch of enc) {
        const tok = CMU._P[CMU._A.indexOf(ch)];
        const m = /^([A-Z]+)([012])$/.exec(tok);
        if (!m) { out.push(tok); continue; }
        if (m[2] === '1') out.push('*');
        out.push(m[1] === 'AH' && m[2] === '0' ? 'AX' : m[1]);
      }
      return out;
    }

    const VOICED_END = new Set(['B','D','G','V','DH','Z','ZH','M','N','NG','L','R','W','Y','JH',
      'IY','IH','EH','AE','AA','AO','UH','UW','ER','AH','EY','AY','OY','OW','AW']);
    const SIBILANT = new Set(['S','Z','SH','ZH','CH','JH']);

    // Letter names as phonemes (the CMU subset lacks some, e.g. "aitch").
    const LETTER_PH = {
      a:'EY', b:'B IY', c:'S IY', d:'D IY', e:'IY', f:'EH F', g:'JH IY',
      h:'EY CH', i:'AY', j:'JH EY', k:'K EY', l:'EH L', m:'EH M', n:'EH N',
      o:'OW', p:'P IY', q:'K Y UW', r:'AA R', s:'EH S', t:'T IY', u:'Y UW',
      v:'V IY', w:'D AH B AX L Y UW', x:'EH K S', y:'W AY', z:'Z IY',
    };

    // Accent on the LAST letter only (en-pee-SEE).
    function spellOut(letters){
      const out = [];
      for (let i = 0; i < letters.length; i++) {
        const ph = LETTER_PH[letters[i]];
        if (!ph) return null;
        const parts = ph.split(' ');
        if (i === letters.length - 1) {
          const v = parts.findIndex(p => VOWELS.has(p));
          if (v >= 0) parts.splice(v, 0, '*');
        }
        out.push(...parts);
      }
      return out;
    }

    // initialism → lexicon → hand dict → CMU → suffix → compound → letter rules.
    // ⚠ Degemination belongs on the OUTPUT: doubles are made where sequences
    // join (table+land), which g2p never sees. Consonants only.
    const DEGEM_VOWEL = /^(AA|AE|AH|AO|AW|AY|EH|ER|EY|IH|IY|OW|OY|UH|UW|AX|ERR|OWR)$/;
    function pronounceWord(w){
      const ph = pronounceWordRaw(w);
      if (!Array.isArray(ph) || ph.length < 2) return ph;
      return ph.filter((p, i) => i === 0 || p !== ph[i - 1] || DEGEM_VOWEL.test(p));
    }
    // Vowel-less words said as sounds, not spelled.
    const INTERJECTION = /^(?:s+h+|p+s+t+|h+m+|m+|b+r+|g+r+|t+s+k+|z+|p+f+t+|c+h+)$/i;
    function pronounceWordRaw(w){
      // Initialisms, first and off the raw token (case is the evidence). ⚠ ALL-CAPS
      // is also a shout, so only an UNKNOWN, short, vowel-poor word is spelled.
      const rawLetters = String(w).replace(/[^A-Za-z]/g, '');
      if (rawLetters.length >= 2 && rawLetters.length <= 5 && rawLetters === rawLetters.toUpperCase()) {
        const low = rawLetters.toLowerCase();
        const vowels = (low.match(/[aeiouy]/g) || []).length;
        const known = lexLook(low) || dictLook(low) || cmuLook(low);
        if (!known && (vowels <= 1 || rawLetters.length <= 3)) {
          const spelled = spellOut(low);
          if (spelled) return spelled;
        }
      }
      // No vowel letter: an abbreviation whatever its case ("CPhL").
      if (rawLetters.length >= 2 && rawLetters.length <= 6 && !/[aeiouy]/i.test(rawLetters) && !INTERJECTION.test(rawLetters)) {
        const low = rawLetters.toLowerCase();
        if (!(lexLook(low) || dictLook(low) || cmuLook(low))) { const sp = spellOut(low); if (sp) return sp; }
      }
      w = w.toLowerCase().replace(/[^a-z']/g,'');
      if (!w) return [];
      const x = lexLook(w); if (x) return x;
      const d = dictLook(w); if (d) return d;
      const c = cmuLook(w);  if (c) return c;
      if (CONTRACT[w]) return CONTRACT[w].split(' ');
      // ⚠ Suffix rules only extend KNOWN stems; an unknown stem goes to g2p whole
      // (a truncated guess breaks syllables: "cyph" made "SIFF-er").
      const stemPh = (s) => lexLook(s) || dictLook(s) || cmuLook(s) || null;
      let m, ph;
      if ((ph = cliticLook(w, stemPh))) return ph;
      // G-dropping ("somethin'"): look up the -ing form, NG becomes N.
      if ((m = /^(.+in)'?$/.exec(w)) && w.length > 3) {
        ph = stemPh(m[1] + 'g');
        if (ph && ph[ph.length-1] === 'NG') return [...ph.slice(0,-1), 'N'];
      }
      // -es after a sibilant is its own syllable
      if ((m = /^(.+(?:s|sh|ch|x|z))es$/.exec(w)) && (ph = stemPh(m[1]))) return [...ph, 'IH', 'Z'];
      if ((m = /^(.+)ies$/.exec(w)) && w.length > 4 && (ph = stemPh(m[1] + 'y'))) return [...ph, 'Z'];
      if ((m=/^(.+?)(s)$/.exec(w)) && w.length>2 && !/(ss|us|is)$/.test(w)) {
        ph = stemPh(m[1]);
        if (ph) { const last = ph[ph.length-1];
          if (SIBILANT.has(last)) return [...ph,'IH','Z'];
          return [...ph, VOICED_END.has(last)?'Z':'S']; }
      }
      if ((m=/^(.+?)ed$/.exec(w)) && w.length>3) {
        // try the silent e back ("hoped")
        ph = stemPh(m[1]) || stemPh(m[1]+'e');
        if (ph) { const last = ph[ph.length-1];
          if (last==='T'||last==='D') return [...ph,'IH','D'];
          return [...ph, VOICED_END.has(last)?'D':'T']; }
      }
      if ((m=/^(.+?)ing$/.exec(w)) && w.length>4) {
        ph = stemPh(m[1]) || stemPh(m[1]+'e');
        if (ph) return [...ph,'IH','NG'];
      }
      if ((m=/^(.+?)ly$/.exec(w)) && w.length>3) { ph = stemPh(m[1]); if (ph) return [...ph,'L','IY']; }
      if ((m=/^(.+?)er$/.exec(w)) && w.length>3) { ph = stemPh(m[1]); if (ph) return [...ph,'ER']; }
      if ((ph = compoundLook(w, stemPh))) return ph;
      return g2p(w);
    }

    // Compounds (the game's coinages): split into two KNOWN words, never a guess.
    // The most balanced split wins (first-hit gives "the + rapist"). The second
    // element loses its '*' (accent on the first) but keeps full vowel quality.
    function compoundLook(w, stemPh){
      if (w.length < 6 || w.includes("'")) return null;
      let best = null, bestBalance = 0;
      for (let i = 3; i <= w.length - 3; i++) {
        const balance = Math.min(i, w.length - i);
        if (balance <= bestBalance) continue;        // can't beat what we have
        const a = stemPh(w.slice(0, i)); if (!a) continue;
        const b = stemPh(w.slice(i));    if (!b) continue;
        best = [...a, ...b.filter(p => p !== '*')];
        bestBalance = balance;
      }
      return best;
    }

    // Letter-to-sound fallback, left-to-right longest match.
    function g2p(word){
      word = word.toLowerCase().replace(/[^a-z']/g,'');
      if (!word) return [];
      const out = []; let i = 0;
      // ⚠ The !!c guard matters: 'aeiou'.includes('') is true past the word's end.
      const isV = c => !!c && 'aeiou'.includes(c);
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
          // ER already is the r: consume both, in a closed syllable only ("hero" keeps its r onset).
          if ((c==='e'||c==='i'||c==='u') && nx==='r' && !isV(at(i+2))) { out.push('ER'); i+=2; continue; }
          out.push(shortMap[c]); i++; continue;
        }
        switch (c) {
          case 'c': out.push((nx==='e'||nx==='i'||nx==='y')?'S':'K'); break;
          case 'g': out.push((nx==='e'||nx==='i'||nx==='y')?'JH':'G'); break;
          case 'j': out.push('JH'); break;
          case 'x': out.push('K','S'); break;
          // 'y': initial /j/, final /i/, medial open /aɪ/ (cyborg) or closed /ɪ/ (gym).
          // Not in isV on purpose. A digraph counts as one consonant ("cypher").
          case 'y': {
            if (i === 0) { out.push('Y'); break; }
            if (i === word.length-1) { out.push('IY'); break; }
            const c1 = at(i+1), c2 = at(i+2);
            const digraph = ['ph','th','ch','sh'].includes(c1 + c2);
            const open = !isV(c1) && (isV(c2) || (digraph && isV(at(i+3))));
            out.push(open ? 'AY' : 'IH');
            break;
          }
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

    // Numbers and symbols to words (pronounceWord drops digits). ⚠ Runs BEFORE
    // tokenising, so splitting on '.'/',' can't shred a decimal or grouped number.
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
      if (!isFinite(n) || n > 999999999999) return s.split('').map(d=>_ONES[+d]||'').join(' ');   // too long: digit by digit
      return intToWords(n);
    }
    // 2026 "twenty twenty six", 2005 "twenty oh five", 1900 "nineteen hundred", 2000 "two thousand"
    function yearToWords(n){
      const hi = (n/100)|0, lo = n%100;
      if (n % 1000 === 0) return intToWords(n);
      if (lo === 0) return intToWords(hi)+' hundred';
      if (lo < 10) return intToWords(hi)+' oh '+_ONES[lo];
      return intToWords(hi)+' '+intToWords(lo);
    }
    // Inflects only the last word: 21 "twenty first".
    const _ORD = { one:'first', two:'second', three:'third', five:'fifth', eight:'eighth', nine:'ninth', twelve:'twelfth' };
    function ordinalToWords(n){
      const w = intToWords(n).split(' '), last = w[w.length-1];
      w[w.length-1] = _ORD[last] || (last.endsWith('y') ? last.slice(0,-1)+'ieth' : last+'th');
      return w.join(' ');
    }
    // ⚠ Abbreviations read as words: CMUdict's `dr` is DRIVE. "St" before a
    // capitalised word is Saint, otherwise Street.
    const ABBREV_WORD = {
      dr:'doctor', mr:'mister', mrs:'missus', ms:'miz', jr:'junior', sr:'senior',
      prof:'professor', sgt:'sergeant', lt:'lieutenant', capt:'captain',
      col:'colonel', gen:'general', vs:'versus', approx:'approximately',
      dept:'department', inc:'incorporated', ltd:'limited', etc:'et cetera',
    };
    function expandAbbrev(text){
      return String(text)
        // with or without its full stop ("St Garneau")
        .replace(/\bSt\.?\s+(?=[A-Z][a-z])/g, ' Saint ')
        .replace(/\bSt\./g, ' Street ')
        .replace(/\b([A-Za-z]+)\./g, (m, w) => {
          const full = ABBREV_WORD[w.toLowerCase()];
          return full ? ' ' + full + ' ' : m;
        });
    }

    function expandNumbers(text){
      return expandAbbrev(text)
        .replace(/°\s*([CF])\b/g, (m,u)=>' degrees '+(u==='C'?'celsius':'fahrenheit')+' ')   // 72°F → "degrees fahrenheit"
        .replace(/°/g, ' degrees ')
        .replace(/%/g, ' percent ')
        // ₵ is postfixed: "nine hundred credits"
        .replace(/₵\s*([\d,]+(?:\.\d+)?)/g, ' $1 credits ')
        .replace(/₵/g, ' credits ')
        // `#` and `x` only next to a digit, so prose and the letter x are untouched.
        .replace(/&/g, ' and ')
        .replace(/#\s*(?=\d)/g, ' number ')
        .replace(/(?<=\d)\s*[x×]\s*(?=\d)/gi, ' times ')
        .replace(/(?<=^|\s)[x×](?=\d)/gi, ' times ')      // quantity chips are written "x2"
        .replace(/(?<=\s|^)\+\s*(?=\d)/g, ' plus ')
        // Clock times, before the number pass and before ':' becomes a break. Before
        // "left"/"to go" it's a game clock (a length, not a time of day).
        .replace(/\b(\d{1,2}):([0-5]\d)(?=\s+(?:left|to go|remaining|to play)\b)/g, (m, mm, ss) => {
          if (+mm === 0) return ' ' + intToWords(+ss) + (+ss === 1 ? ' second ' : ' seconds ');
          if (ss === '00') return ' ' + intToWords(+mm) + (+mm === 1 ? ' minute ' : ' minutes ');
          return ' ' + intToWords(+mm) + ' ' + intToWords(+ss) + ' ';
        })
        .replace(/\b(\d{1,2}):([0-5]\d)\b/g, (m, h, mm) => {
          const hr = intToWords(+h);
          if (mm === '00') return ' ' + hr + " o'clock ";
          return ' ' + hr + ' ' + (+mm < 10 ? 'oh ' + intToWords(+mm) : intToWords(+mm)) + ' ';
        })
        .replace(/(\d+)(?:st|nd|rd|th)\b/gi, (m,d)=>' '+ordinalToWords(parseInt(d,10))+' ')
        // Years 1000-2099 as pairs; the '.' guards leave decimals to the decimal pass.
        .replace(/\b\d{4}\b/g, (m,off,s)=>{ const n=+m; return (n>=1000 && n<=2099 && s[off-1]!=='.' && s[off+4]!=='.') ? ' '+yearToWords(n)+' ' : m; })
        // A bare three-place decimal is a batting average, said the way a booth says it:
        // .245 "two forty five", .305 "three oh five", .300 "three hundred".
        .replace(/(?<![\d.])\.(\d)(\d\d)\b/g, (m, a, bc) => {
          if (+a === 0) return ' ' + (+bc === 0 ? 'zero' : intToWords(+bc)) + ' ';
          if (bc === '00') return ' ' + intToWords(+a) + ' hundred ';
          return ' ' + intToWords(+a) + ' ' + (bc[0] === '0' ? 'oh ' + intToWords(+bc[1]) : intToWords(+bc)) + ' ';
        })
        .replace(/(\d),(?=\d)/g, '$1')                    // strip thousands separators
        .replace(/\d+(?:\.\d+)?/g, m => ' '+numToWords(m)+' ');
    }

    // Accents transform the GA phoneme run. 'rp': non-rhotic (with linking-r),
    // ER to ERR, OW to OWR, and TRAP-BATH backing.
    // see docs/systems-procedural-audio.md#rp-grew-a-linking-r-and-a-goat
    const RP_BATH_FOLLOW = new Set(['F','TH','S','N','M','NG']);
    const VOWELS = new Set(['IY','IH','EH','AE','AA','AO','UH','UW','ER','ERR','AH','AX','EY','AY','OW','OY','AW']);

    // The next sound, skipping stress markers.
    const nextSound = (phon, k) => { while (isMark(phon[k])) k++; return phon[k]; };

    function applyAccent(phon, accent){
      if (accent !== 'rp') return phon;
      const out = [];
      for (let i = 0; i < phon.length; i++){
        const p = phon[i];
        // ⚠ Skip markers, or /r/ before a stressed vowel vanishes.
        let n = i+1; while (isMark(phon[n])) n++;
        const next = phon[n];
        if (p === 'R'){
          if (next && VOWELS.has(next)) out.push('R');   // prevocalic /r/ survives
          // Linking-r across a WORD GAP only (not isGap: a pause breaks the link).
          // Never intrusive-r: it only keeps an /r/ already there.
          else if (phon[n] === '_' && VOWELS.has(nextSound(phon, n + 1))) out.push('R');
          continue;
        }
        if (p === 'ER'){ out.push('ERR'); continue; }
        if (p === 'OW'){ out.push('OWR'); continue; }
        if (p === 'AE'){
          let j = i+1; while (isGap(phon[j]) || isMark(phon[j])) j++;
          if (RP_BATH_FOLLOW.has(phon[j])) { out.push('AA'); continue; }
        }
        out.push(p);
      }
      return out;
    }

    // Lexical stress: the dictionary's, or guessed from spelling below. '*' goes
    // before the stressed vowel (no PH entry, so only lookaheads must skip it).
    // FUNC words are left unmarked and reduce. ⚠ Only words that really lose
    // their accent: not negation, locatives, wh-words, demonstratives or particles.
    const FUNC = new Set(('a an the of to in at by for from with as and or but nor if than that ' +
      'is am are was were be been being do does did have has had will would shall should may might must can could ' +
      'he she it we they you i me him her us them his its their our your my some any').split(' '));
    // Suffixes fixing stress, counted in syllables from the END.
    const STRESS_SUFFIX = [
      [/(ation|ition|ution)s?$/, 2], [/(tion|sion|cion)s?$/, 2], [/(ity|ety|ify|ise|ize)s?$/, 3],
      [/(ical|ically)$/, 3], [/(ic|ics)$/, 2], [/(ious|eous|uous)$/, 3], [/(ial|ian|iance|ience|ient)s?$/, 3],
      [/(ee|eer|ese|esque|ette)s?$/, 1],
    ];
    // Unstressed prefixes: the strong syllable is the one after them.
    const WEAK_PREFIX = /^(un|re|de|be|a|con|com|ex|in|im|dis|pre|pro|per|sub|ob|ad|en|em|for)(?=[a-z]{3})/;

    // Live tunables for the Voice Lab tab, read at speak() time.
    const TUNING = {
      rate:        0.85,   // rhythm compensation — LOWER IS SLOWER. Broadcast's nodeHoldMs is fitted to this.
      breath:      1.0,    // scales per-voice breath noise (the only noise that runs continuously)
      sibilance:   1.0,    // scales S Z SH ZH CH JH
      friction:    1.0,    // scales F V TH DH
      aspiration:  1.0,    // scales stop bursts, aspiration and /h/
      presenceDb:  4,      // the 3kHz intelligibility peak
      tiltPlain:   4600,   // source brightness, unstressed …
      tiltStress:  6400,   // … stressed …
      tiltEmph:    8200,   // … and emphatic (shouting is BRIGHT — the folds slam)
      emphasis:    1.0,    // scales how far emphasis moves pitch/length/gain over plain stress
      creak:       1.0,    // phrase-final vocal fry; 0 disables
      finalTaper:  0.6,    // level and release of word-final noise (else a sigh after every word); 1 is off
      undershoot:  0.2,    // EXPLICIT coarticulation only — see the note in the loop
      lineGapMs:   180,    // breath between chained lines (tv.js reads this)
      excitement:  1.0,    // scales every line's delivery (opt.excite, see deliveryFor); 0 reads it all flat
      compRatio:   3,      // the voice's compressor (1 is off)
    };

    // Consonant levels against a stressed vowel, fitted to real speech (burst
    // and /s/ ~10 dB under, /h/ and aspiration ~20). Glottal noise runs through
    // the tract; constriction noise through its own band.
    const ASP_H = 0.08;         // /h/, through the tract
    const ASP_STOP = 0.075;     // the voice-onset breath after /p t k/
    const BURST = 0.13;         // a stop's release, scaled per phoneme by `bg`
    const VBAR = 0.035;         // voicing through a closed tract (/b d g/, an affricate's /dʒ/)
    const VFRIC = 0.07;         // voicing under /v ð z ʒ/
    const MURMUR_KEEP = 0.05;   // what's left of F2 and up when the mouth is shut
    const BREATH_K = ASP_H / 0.11;   // voices' `breath` was tuned against an /h/ of 0.11
    const ASP_BREATH_IN = 0.035; // the breath before a big call
    const AFFRICATE_CLOSURE = 0.05;  // s; the stop half of /tʃ dʒ/
    // Drawn-out sounds (s): V0 plus V per extra letter; the C pair for consonants.
    const LONG_V0 = 0.14, LONG_V = 0.16, LONG_V_MAX = 2.6;
    const LONG_C0 = 0.10, LONG_C = 0.11, LONG_C_MAX = 1.2;
    const VIBRATO = 0.02;            // depth (fraction of F0) a held, sold vowel wavers by

    // `opt.excite`: -1 grave, 0 plain, 1 a goal call. Every factor is exactly 1
    // (or 0) at 0. see docs/systems-procedural-audio.md#selling-a-line-excite
    function deliveryFor(x) {
      const e = Math.max(0, x), g = Math.max(0, -x);
      return {
        e, g,
        pitch:  2 ** ((9 * e - 3 * g) / 12),   // register: up to 9 semitones up, 3 down
        range:  1 + 1.0 * e - 0.4 * g,          // how far the accents move (scales lilt)
        decl:   1 - 0.55 * e + 0.25 * g,        // excited speech holds its height
        rate:   1 + 0.1 * e - 0.12 * g,
        pause:  1 - 0.35 * e + 0.3 * g,         // phrase pauses, not word junctures
        hold:   1 + 1.2 * e,                    // the nucleus vowel, stretched
        bright: 1 + 0.45 * e - 0.15 * g,        // the tilt filter's cutoffs
        loud:   1 + 0.25 * e - 0.12 * g,        // stressed vowels; unstressed get half of it
        oq:     -0.16 * e + 0.06 * g,           // pressed folds when excited, breathy when grave
        breath: 0.006 * e + 0.008 * g,
        creak:  Math.max(0, 1 - 1.4 * e) * (1 + 0.6 * g),
        f1:     1 + 0.06 * e,                   // a louder voice opens the jaw
        jitter: 1 + 0.5 * e,                    // and strains it
        longK:  1 + 0.25 * e,                   // a drawn-out sound, held a little longer when sold
      };
    }

    // Marks in the phoneme run (no PH entry; only lookaheads must skip them):
    //   '*' stress, '!' emphasis, both right before the vowel
    //   '^' the held nucleus of a sold line, between mark and vowel (speak() only)
    //   '~n' a drawn-out sound, written n times
    //   '+' the light nucleus, right BEFORE the word's stress mark
    // '_M' is a minor break nobody typed.
    const isLong = p => typeof p === 'string' && p.charCodeAt(0) === 126;   // '~'
    const isMark = p => p === '*' || p === '!' || p === '^' || p === '+' || isLong(p);

    // Diphthongs, IY and UW keep their colour unstressed, so they're absent.
    const CENTRALISES = new Set(['IH','EH','AE','AA','AO','UH','AH']);

    // Weak forms. ⚠ IH and IY must NOT map to schwa ("is", "he" mumble); UW goes to UH.
    const WEAK = { UW:'UH', EH:'AX', AE:'AX', AA:'AX', AO:'AX', AH:'AX', UH:'AX' };

    // CMUdict stresses function words (citation form); in a phrase they lose it.
    function deaccent(ph){
      return ph.filter(p => !isMark(p)).map(p => WEAK[p] || p);
    }

    function guessStress(ph, word){
      const vi = []; for (let i = 0; i < ph.length; i++) if (VOWELS.has(ph[i])) vi.push(i);
      if (!vi.length) return ph;
      let k = 0;                                           // which vowel takes the stress
      if (vi.length > 1) {
        let hit = -1;
        for (const [re, back] of STRESS_SUFFIX) if (re.test(word)) { hit = vi.length - back; break; }
        if (hit >= 0) k = Math.max(0, hit);
        else if (WEAK_PREFIX.test(word)) k = 1;
      }
      // The unpicked vowels centralise, as the dictionary path does.
      const out = ph.map((p, i) => (i !== vi[k] && CENTRALISES.has(p) && vi.length > 1) ? 'AX' : p);
      out.splice(vi[k], 0, '*');
      return out;
    }

    // `edge`: last word before a pause. Nothing reduces at a phrase edge.
    function stressWord(ph, word, edge){
      // ⚠ Monosyllables only: deaccenting flattens every vowel ("into" to "uhn-tuh").
      const syl = ph.filter(p => VOWELS.has(p)).length;
      if (FUNC.has(word) && !edge && syl <= 1) return deaccent(ph);
      if (ph.includes('*')) return ph;                     // the dictionary knew
      return guessStress(ph, word);
    }

    // An ALL-CAPS word is emphasis, unless the whole line is caps (a shout or an
    // ident). One classifier for textToPhonemes and speak(), so they agree.
    const lineCaps = (text) => {
      const letters = String(text).replace(/[^A-Za-z]/g, '');
      const allCaps = letters.length > 0 &&
        (letters.replace(/[^A-Z]/g, '').length / letters.length) > 0.6;
      const shout = allCaps && letters.length <= 20;   // an exclamation, not a banner
      return { shout, shouty: allCaps && !shout };
    };

    const isEmphatic = (tok) => {
      const letters = tok.replace(/[^A-Za-z]/g, '');
      return letters.length >= 2 && letters === letters.toUpperCase();
    };

    // Connected-speech transforms over the finished run; junctures are transparent.
    const VELAR = new Set(['K','G']), LABIAL = new Set(['P','B','M']);
    const VOICELESS_OBS = new Set(['P','T','K','F','TH','S','SH','CH','HH']);

    // Nasal place assimilation, across junctures but not breaks ("in case" /ŋ/).
    function applyAssimilation(phon){
      const out = phon.slice();
      for (let i = 0; i < out.length; i++) {
        if (out[i] !== 'N') continue;
        let j = i + 1; while (out[j] === '_' || isMark(out[j])) j++;
        if (VELAR.has(out[j])) out[i] = 'NG';
        else if (LABIAL.has(out[j])) out[i] = 'M';
      }
      return out;
    }

    // GA flapping (the caller skips RP): /t d/ between a vowel and an UNSTRESSED vowel.
    function applyFlap(phon){
      const out = phon.slice();
      for (let i = 1; i < out.length; i++) {
        if (out[i] !== 'T' && out[i] !== 'D') continue;
        let a = i - 1; while (isMark(out[a])) a--;
        if (!VOWELS.has(out[a]) && out[a] !== 'R') continue;
        // a marker before the vowel means stressed: no flap ("atomic")
        const b = i + 1;
        if (isMark(out[b])) continue;
        if (!VOWELS.has(out[b])) continue;
        out[i] = 'DX';
      }
      return out;
    }

    // Drawn-out words: 3+ of one letter collapse to whichever of one or two the
    // dictionary knows, and that sound is held. see docs/systems-procedural-audio.md#drawn-out-words
    const known = (w) => !!(lexLook(w) || dictLook(w) || cmuLook(w) || CONTRACT[w]);
    function elongation(tok) {
      const letters = String(tok).replace(/[^A-Za-z']/g, '');
      const runs = []; const re = /([A-Za-z])\1{2,}/g; let m;
      while ((m = re.exec(letters))) runs.push({ at: m.index, len: m[0].length, ch: m[1].toLowerCase() });
      if (!runs.length) return null;
      const build = (k) => {
        let out = '', last = 0;
        runs.forEach((r, i) => { out += letters.slice(last, r.at) + letters[r.at].repeat(((k >> i) & 1) + 1); last = r.at + r.len; });
        return out + letters.slice(last);
      };
      // Doubled first, then single, then mixes; at a word's END single first ("Sooooo" is so).
      const all = (1 << Math.min(runs.length, 3)) - 1;
      const last = runs[runs.length - 1], final = last.at + last.len === letters.length;
      const order = final ? [0, all] : [all, 0]; for (let j = 1; j < all; j++) order.push(j);
      let k = 0;
      for (const j of order) if (known(build(j).toLowerCase())) { k = j; break; }
      // The longest run is held.
      let hold = 0, at = 0, shift = 0;
      runs.forEach((r, i) => { if (r.len > runs[hold].len) hold = i; });
      runs.forEach((r, i) => { const kept = ((k >> i) & 1) + 1; if (i === hold) at = r.at - shift; shift += r.len - kept; });
      return { word: build(k), ch: runs[hold].ch, at, n: runs[hold].len };
    }
    // Puts '~n' before the sound the held letter spelled: vowels by vowel group
    // (silent e aside), an h after a vowel holds the vowel; on a mismatch, the
    // stressed vowel.
    const LONG_SOUND = { s: ['S', 'Z', 'SH'], z: ['Z', 'S', 'ZH'], m: ['M'], n: ['N', 'NG'], l: ['L'], r: ['R', 'ER'], f: ['F'], v: ['V'], w: ['W'], y: ['Y', 'IY'] };
    function markLong(ph, el) {
      const word = el.word.toLowerCase();
      const isVL = (i) => 'aeiou'.includes(word[i]) || (word[i] === 'y' && i > 0);
      let idx = -1;
      const vowelish = 'aeiou'.includes(el.ch) || (el.ch === 'y' && el.at > 0) || (el.ch === 'h' && el.at > 0 && isVL(el.at - 1));
      if (vowelish) {
        const pos = el.ch === 'h' ? el.at - 1 : el.at;
        const groups = [];
        for (let i = 0; i < word.length; i++) if (isVL(i) && !(i > 0 && isVL(i - 1))) groups.push(i);
        let g = 0; for (let j = 0; j < groups.length; j++) if (groups[j] <= pos) g = j;
        const vi = []; for (let i = 0; i < ph.length; i++) if (VOWELS.has(ph[i])) vi.push(i);
        let n = groups.length;
        if (n === vi.length + 1 && /[^aeiou]e[sd]?$/.test(word) && g < n - 1) n--;   // a silent e
        if (n === vi.length && vi.length) idx = vi[g];
        else if (groups.length > 1 && vi.length) idx = vi[Math.round(g / (groups.length - 1) * (vi.length - 1))];
        else {
          const s = ph.findIndex((p, i) => (p === '*' || p === '!') && VOWELS.has(ph[i + 1]));
          idx = s >= 0 ? s + 1 : vi[0] ?? -1;
        }
      } else if (LONG_SOUND[el.ch]) {
        let best = Infinity;
        const want = el.at / Math.max(1, word.length - 1);
        for (let i = 0; i < ph.length; i++) {
          if (!LONG_SOUND[el.ch].includes(ph[i])) continue;
          const d = Math.abs(i / Math.max(1, ph.length - 1) - want);
          if (d < best) { best = d; idx = i; }
        }
      }
      if (idx >= 0) ph.splice(idx, 0, '~' + el.n);
    }

    // Phrase-level accent passes (placeAccents): nucleus, given/new, minor breaks,
    // compound stress.

    // Minor break before one of these after MINOR_MIN syllables, with MINOR_TAIL
    // left. "of" and "to" never break.
    const BREAK_BEFORE = new Set(('and or but nor so because while when where whereas until unless ' +
      'although though since after before with from for in on at by into onto through across ' +
      'around behind between under over without toward towards against during among along beyond').split(' '));
    const MINOR_MIN = 10, MINOR_TAIL = 4;

    // A repeated word right after one of these keeps its accent.
    const CONTRAST = new Set(['not', 'but', 'or', 'nor', 'than', 'versus', 'vs']);
    const lemma = (w) => {
      w = w.replace(/'s?$/, '');
      if (w.length > 4 && /ies$/.test(w)) return w.slice(0, -3) + 'y';
      if (w.length > 4 && /(s|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
      if (w.length > 3 && /[^su]s$/.test(w)) return w.slice(0, -1);
      return w;
    };

    // Compound stress ("FIRE station"), deliberately narrow: a wrong compound costs
    // more than a missed one.
    const COMPOUND_HEAD = new Set(('station rink room shop store street truck board ball game light line ' +
      'field yard lot bag box case fight team match drink kit gun bomb cell club bar office bill card deck ' +
      'ticket market house hall player fan shift job stop plant tower driver boat window phone lane').split(' '));
    const NOT_MODIFIER = new Set((
      // adjectives, ordinals, colours
      'new old big small little great good bad long short high low hot cold warm cool wet dry dark bright ' +
      'clean dirty empty full free real whole same other own next last first second third final only main ' +
      'public private local open closed late early young dead live red blue green black white grey gray ' +
      'brown yellow orange pink purple ' +
      // materials
      'stone glass steel iron wooden brick plastic metal concrete leather gold silver copper tin rubber ' +
      // determiners and numbers that FUNC doesn't hold
      'this these those every each no all both such what which whose many few more most much several another ' +
      'one two three four five six seven eight nine ten eleven twelve twenty hundred thousand ' +
      // verbs with a bare noun object
      'play hit take make get give find keep leave see need want buy sell build run own').split(' '));
    const ADJ_END = /(ful|ous|ive|able|ible|less|ish|est|ly|[^e]ed|'s)$/;
    // Exceptions either way.
    const COMPOUND_FIRST = new Set(['white house', 'high school', 'hot dog', 'green room']);
    const COMPOUND_FINAL = new Set(['town hall', 'city hall', 'black market']);
    function isCompound(a, b) {
      const pair = a + ' ' + b;
      if (COMPOUND_FIRST.has(pair)) return true;
      if (COMPOUND_FINAL.has(pair)) return false;
      if (!COMPOUND_HEAD.has(lemma(b))) return false;
      return !NOT_MODIFIER.has(a) && !ADJ_END.test(a) && a.length > 1;
    }

    // `seq` is textToPhonemes' working run: break and juncture codes, and one entry per
    // word ({ ph, w, func, emph, syl }). Returns the flat phoneme run.
    function placeAccents(seq) {
      const isWord = e => e !== null && typeof e === 'object';
      const content = e => isWord(e) && !e.func;
      const nextWord = (i) => { let j = i + 1; while (seq[j] === '_') j++; return isWord(seq[j]) ? j : -1; };

      // 1. Compounds: the second noun gives its accent to the first.
      for (let i = 0; i < seq.length; i++) {
        const a = seq[i]; if (!content(a) || a.emph) continue;
        const j = nextWord(i); if (j < 0) continue;
        const b = seq[j];
        if (content(b) && !b.emph && isCompound(a.w, b.w)) b.tail = true;
      }

      // 2. Given/new: a content word already said in this line loses its accent,
      // unless it is in caps or follows a contrast word.
      const said = new Set(); let p1 = null, p2 = null;
      for (const e of seq) {
        if (!isWord(e)) continue;
        if (!e.func) {
          const l = lemma(e.w);
          const contrast = (p1 && CONTRAST.has(p1.w)) || (p2 && CONTRAST.has(p2.w));
          if (l.length >= 3 && said.has(l) && !e.emph && !contrast) e.given = true;
          said.add(l);
        }
        p2 = p1; p1 = e;
      }

      // 3. Minor breaks in a long unpunctuated stretch, replacing the juncture before a
      // conjunction or preposition that follows a content word.
      let syl = 0;
      for (let i = 0; i < seq.length; i++) {
        const e = seq[i];
        if (isBreak(e)) { syl = 0; continue; }
        if (!isWord(e)) continue;
        if (BREAK_BEFORE.has(e.w) && syl >= MINOR_MIN && seq[i - 1] === '_') {
          let k = i - 2; while (seq[k] === '_') k--;
          if (content(seq[k]) && !BREAK_BEFORE.has(seq[k].w)) {
            let tail = 0;
            for (let m = i + 1; m < seq.length && !isBreak(seq[m]); m++) if (isWord(seq[m])) tail += seq[m].syl;
            if (tail >= MINOR_TAIL) { seq[i - 1] = '_M'; syl = 0; }
          }
        }
        syl += e.syl;
      }

      // 4. One nucleus per phrase: last caps word, else last new content word,
      // else last given one (which gets its accent back).
      const nucleus = (from, to) => {
        let emph = -1, fresh = -1, given = -1;
        for (let i = from; i < to; i++) {
          const e = seq[i];
          if (!isWord(e) || !e.ph.some(p => p === '*' || p === '!')) continue;
          if (e.emph) emph = i;
          else if (e.func) continue;
          else if (!e.given && !e.tail) fresh = i;
          else if (e.given) given = i;
        }
        const at = emph >= 0 ? emph : fresh >= 0 ? fresh : given;
        if (at >= 0) { seq[at].nucleus = true; seq[at].given = false; }
      };
      let from = 0;
      for (let i = 0; i < seq.length; i++) if (isBreak(seq[i])) { nucleus(from, i); from = i + 1; }
      nucleus(from, seq.length);

      const out = [];
      for (const e of seq) {
        if (!isWord(e)) { out.push(e); continue; }
        let ph = e.ph;
        if (e.given || e.tail) ph = ph.filter(p => p !== '*');
        if (e.nucleus) {
          const s = ph.includes('!') ? ph.indexOf('!') : ph.indexOf('*');
          if (s >= 0) ph = [...ph.slice(0, s), '+', ...ph.slice(s)];
        }
        out.push(...ph);
      }
      return out;
    }

    // One held vowel per terminal phrase of a sold line: last emphatic, else the
    // '+' nucleus, else the last stressed. '^' replaces the '+'.
    function soldNucleus(phon) {
      const res = []; let seg = [];
      const flush = () => {
        if (seg.some(isLong)) { res.push(...seg); seg = []; return; }
        let best = -1, bestP = 0;
        for (let k = 0; k + 1 < seg.length; k++) {
          if ((seg[k] === '!' || seg[k] === '*') && VOWELS.has(seg[k + 1])) {
            const pr = seg[k] === '!' ? 3 : seg[k - 1] === '+' ? 2 : 1;
            if (pr >= bestP) { best = k + 1; bestP = pr; }
          }
        }
        if (best >= 0) {
          seg.splice(best, 0, '^');
          if (seg[best - 2] === '+') seg.splice(best - 2, 1);
        }
        res.push(...seg); seg = [];
      };
      for (const code of phon) { seg.push(code); if (isTerm(code)) flush(); }
      flush();
      return res;
    }

    const ABBREV = new Set(['mr','mrs','ms','dr','st','jr','sr','prof','sgt','lt','capt','col','gen','inc','ltd','vs','approx','dept']);   // not "no": "no." usually ends a sentence
    function textToPhonemes(text){
      const seq = [];
      // ⚠ Multi-character marks first in the alternation, or "..." is three stops.
      // A single hyphen stays inside the word.
      const toks = expandNumbers(text).trim().split(/(\s+|\.{2,}|!{2,}|…|—|–|-{2,}|[.,!?;:()])/).filter(Boolean);
      const PUNCT = /^(\.{2,}|!{2,}|…|—|–|-{2,}|[.,!?;:()])$/;
      // Adjacent marks are one silence: the longer wins.
      const pushBreak = code => {
        while (seq.length && seq[seq.length-1] === '_') seq.pop();
        const last = seq[seq.length-1];
        if (isBreak(last)) {
          if (PH[code].d > PH[last].d || (PH[code].term && !PH[last].term)) seq[seq.length-1] = code;
          return;
        }
        seq.push(code);
      };
      //   mixed case      → the caps words are emphatic
      //   all caps, SHORT → a shout; every word is emphatic
      //   all caps, LONG  → a title card; no emphasis
      const { shout, shouty } = lineCaps(text);
      for (let i = 0; i < toks.length; i++) {
        const tok = toks[i];
        if (/^\s+$/.test(tok)) { tok.includes('\n') ? pushBreak('_P') : seq.push('_'); continue; }
        if (/^\.{2,}$|^…$/.test(tok)) { pushBreak('_E'); continue; }
        if (/^,$/.test(tok))          { pushBreak('_C'); continue; }
        if (/^[;:]$/.test(tok))       { pushBreak('_S'); continue; }
        if (/^(—|–|-{2,}|[()])$/.test(tok)) { pushBreak('_D'); continue; }
        if (/^\.$/.test(tok)) {
          // Not a sentence end after an abbreviation or a single letter ("J. Vale").
          const prev = (i ? toks[i-1] : '').replace(/[^A-Za-z]/g, '');
          if (/^[A-Za-z]$/.test(prev) || ABBREV.has(prev.toLowerCase())) { seq.push('_'); continue; }
          pushBreak('__'); continue;
        }
        if (/^!$/.test(tok))          { pushBreak('_X'); continue; }
        if (/^!{2,}$/.test(tok))      { pushBreak('_XX'); continue; }
        if (/^\?$/.test(tok))         { pushBreak('_Q'); continue; }
        // Phrase edge: nothing but whitespace between here and a mark or the end.
        let j = i + 1; while (j < toks.length && /^\s+$/.test(toks[j])) j++;
        const edge = j >= toks.length || PUNCT.test(toks[j]);
        const el = elongation(tok);
        const said = el ? el.word : tok;
        const w = said.toLowerCase().replace(/[^a-z']/g, '');
        let ph = stressWord(pronounceWord(said), w, edge);
        if (!shouty && (shout || isEmphatic(said))) {
          const at = ph.indexOf('*');
          if (at >= 0) ph[at] = '!';                       // promote the lexical accent
          else {                                           // a deaccented function word can still be emphasised
            const v = ph.findIndex(x => VOWELS.has(x));
            if (v >= 0) ph.splice(v, 0, '!');
          }
        }
        if (el) markLong(ph, el);
        const func = FUNC.has(w);
        seq.push({ ph, w, func, emph: ph.includes('!'), syl: ph.filter(p => VOWELS.has(p)).length });
      }
      return placeAccents(seq);
    }

    // The name IS the voice: nothing stored.
    function hashName(s){
      let h = 2166136261 >>> 0; s = (s||'').toLowerCase().trim();
      for (let i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h,16777619); }
      return h >>> 0;
    }
    function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
    // Named voices are characters, merged over the derived voice. 'architect'
    // (the login greeting) is a warm female voice. f0 and fshift move together:
    // the PH table is adult male formants, and a female pitch needs ~15% higher.
    const NAMED_VOICES = {
      architect: {
        f0: 190, fshift: 1.14, speed: 1.16, ring: 0,
        oq: 0.70,            // open and soft
        jitter: 0.004, breath: 0.006,
        lilt: 0.085, decl: 0.11,
        // ⚠ A named voice is fully authored, including traits it lacks: anything
        // absent falls to the dice. Add a new trait to every named voice.
        drive: 0, growl: 0, growl2: 0,
        natural: 1, steps: 0, buzz: 0, rmod: 0, rmodHz: 30, crush: 0,
        vs: false,
      },
      // Deadball's play-by-play man: a baritone in a booth, talking all night to
      // people who can't see the game. Low and warm (a male pitch on male
      // formants, a touch long in the tract), brisk but never gabbling, pressed
      // a little to carry over the crowd. A real voice wobbles and breathes, so
      // human variation stays full and there's a little jitter and air in it;
      // the wide lilt and gentle fall are a broadcaster's sing-song. Only a
      // shade of booth mic: a faint ring and the least grit, no growl and none
      // of the synthetic characters. He reads "Rats – Kings" as "versus".
      'chip vega': {
        f0: 108, fshift: 0.96, speed: 1.30, ring: 0.04,
        oq: 0.60,
        jitter: 0.007, breath: 0.009,
        lilt: 0.095, decl: 0.125,
        drive: 0.05, growl: 0, growl2: 0,
        natural: 1, steps: 0, buzz: 0, rmod: 0, rmodHz: 30, crush: 0,
        vs: true,
      },
      // Chip's colour man, an old pitcher: lower and slower than Chip, a soft,
      // open, breathy voice with a smoker's wobble, a narrow lilt (he drawls,
      // he doesn't sing) and a long fall at the end of a thought.
      'dusty merriman': {
        f0: 96, fshift: 0.93, speed: 1.16, ring: 0.03,
        oq: 0.72,
        jitter: 0.012, breath: 0.016,
        lilt: 0.06, decl: 0.15,
        drive: 0.04, growl: 0.025, growl2: 0,
        natural: 1, steps: 0, buzz: 0, rmod: 0, rmodHz: 30, crush: 0,
        vs: true,
      },
      // Cluster Puck's play-by-play man: a tenor that rides up on a rush, quick
      // and pressed, the most lilt in the booth because hockey never stops; a
      // tight voice with a little edge and no breath to spare.
      'tug brennan': {
        f0: 128, fshift: 1.0, speed: 1.42, ring: 0,
        oq: 0.54,
        jitter: 0.006, breath: 0.004,
        lilt: 0.11, decl: 0.11,
        drive: 0, growl: 0, growl2: 0,
        natural: 1, steps: 0, buzz: 0, rmod: 0, rmodHz: 30, crush: 0,
        vs: true,
      },
      // Tug's colour man, a big ex-defenceman who's been through the vat four
      // times: the deepest voice in either booth, a broad chest (long tract),
      // unhurried, flat in pitch, with a little gravel from the sub-harmonic.
      'rennie gault': {
        f0: 88, fshift: 0.9, speed: 1.2, ring: 0,
        oq: 0.62,
        jitter: 0.009, breath: 0.01,
        lilt: 0.05, decl: 0.12,
        drive: 0, growl: 0.05, growl2: 0,
        natural: 1, steps: 0, buzz: 0, rmod: 0, rmodHz: 30, crush: 0,
        vs: true,
      },
    };

    function voiceFromName(name){
      const r = mulberry32(hashName(name)); const pick = arr => arr[Math.floor(r()*arr.length)];
      const named = NAMED_VOICES[(name||'').toLowerCase().trim()];
      const high = r() < 0.5;
      return Object.assign({
        f0:     high ? 120+r()*55 : 82+r()*38,
        fshift: high ? 1.02+r()*0.16 : 0.9+r()*0.12,
        speed:  1.24+r()*0.24,
        ring:   r()<0.25 ? 0.10+r()*0.22 : r()*0.06,
        // open quotient, see glottalWave()
        oq:     pick([0.48, 0.58, 0.68, 0.78]),
        jitter: 0.004+r()*0.016,
        // Breath runs continuously, so two thirds of voices get none.
        breath: r() < 0.34 ? 0.010 + r()*0.014 : 0,
        lilt:   0.05+r()*0.05,   // how far F0 moves on a stressed vowel
        decl:   0.10+r()*0.05,   // phrase-final declination (pitch falls as breath goes)
        // ⚠ EVERYTHING NEW GOES AT THE BOTTOM: a field inserted above shifts every
        // later draw and silently renames every narrator.
        //
        // drive: transmission grit (clipping); two thirds get none.
        drive:  r() < 0.34 ? 0.10 + r()*0.22 : 0,
        // growl: a rare sub-harmonic at F0/2 (period doubling), not jitter.
        growl:  r() < 0.14 ? 0.03 + r()*0.06 : 0,
        // Not rolled (no draws). `natural` 0-1 scales human variation toward none
        // and never touches a segmental cue. `steps` rounds pitch to semitones.
        // Character: `buzz` impulse-train source, `rmod` ring mod at `rmodHz`,
        // `crush` bit depth and rate.
        natural: 1, steps: 0, buzz: 0, rmod: 0, rmodHz: 30, crush: 0,
      }, named || null);
    }

    // ⚠ Segment timing has ONE definition for two callers (the speak loop and
    // estimateDuration). The broadcast hold is fitted to the estimate, so never
    // mirror a rule by hand.
    // ctx: { nxtCode, nxt, prevCode, stress, shout, wordScale, speed, fin }
    //
    // Per index: the break ending its phrase's final rhyme ('' end of run), else null.
    function rhymeBreaks(phon) {
      const out = new Array(phon.length);
      let cur = '';
      for (let j = phon.length - 1; j >= 0; j--) {
        out[j] = cur;
        const c = phon[j];
        if (VOWELS.has(c)) cur = null;
        else if (isBreak(c)) cur = c;
      }
      return out;
    }
    function sylFrom(phon, i) {
      let n = 0;
      for (let j = i; j < phon.length; j++) {
        const c = phon[j];
        if (isGap(c)) break;
        if (VOWELS.has(c)) n++;
      }
      return n;
    }
    // Polysyllabic shortening, flattening out.
    const sylScale = n => 1 / (1 + 0.062 * Math.max(0, n - 1));

    function segmentDuration(p, code, ctx) {
      let dur = Math.max(0.03, (p.d/1000)/ctx.speed);
      // `natural` evens prosodic timing only (ev); segmental cues and pauses stay.
      const nat = ctx.nat ?? 1, ev = nat === 1 ? (k => k) : (k => 1 + (k - 1) * nat);
      // Phrase-final lengthening of the whole last rhyme, scaled by the break's weight.
      const fin = ctx.fin;
      if (fin != null && p.t !== 'P') {
        if (!fin || isTerm(fin)) dur *= ev(1.30);
        else if (PH[fin].minor) dur *= ev(1.08);
        else if (isBreak(fin)) dur *= ev(1.18);
      }
      // Post-vocalic /r/ and dark /l/ need time, or they aren't heard ("goal" as "go").
      if (code === 'R' && VOWELS.has(ctx.prevCode) && !(ctx.nxt && ctx.nxt.t === 'V')) dur *= 1.35;
      if (code === 'L' && VOWELS.has(ctx.prevCode) && !(ctx.nxt && ctx.nxt.t === 'V')) dur *= 1.3;
      if (p.t === 'V') {
        dur *= ev(ctx.wordScale);
        // AX is already reduced: don't shorten it again.
        dur *= ev(ctx.stress === 2 ? 1 + (ctx.shout ? 1.15 : 0.65) * TUNING.emphasis
             : ctx.stress ? 1.12 : (code === 'AX' ? 1 : 0.8));
        // Postvocalic context (Klatt rule 9, "bad" vs "bat"): full effect when stressed
        // or phrase-final, half elsewhere. AX only ever lengthens.
        const n = ctx.nxt;
        if (n && (n.t === 'F' || n.t === 'S' || n.t === 'H' || n.t === 'N')) {
          let k = n.t === 'N' ? 0.92 : n.t === 'H' ? 0.85
            : (n.t === 'S' || n.stopFirst) ? (n.vd ? 1.20 : 0.80) : (n.vd ? 1.30 : 0.90);
          if (code === 'AX') k = Math.max(1, k);
          const w = 0.75 + ((ctx.stress || ctx.fin != null ? 1 : 0.5) - 0.75) * nat;
          dur *= 1 + (k - 1) * w;
        }
        if (ctx.held && ctx.hold) dur *= ev(ctx.hold);
      }
      // A drawn-out sound: the letter count sets the length.
      if (ctx.long && (p.t === 'V' || p.t === 'N' || p.t === 'L' || p.t === 'F')) {
        const n = ctx.long, v = p.t === 'V';
        const held = (v ? LONG_V0 + LONG_V * (n - 1) : LONG_C0 + LONG_C * (n - 1)) * (ctx.longK || 1);
        dur = Math.max(dur, Math.min(v ? LONG_V_MAX : LONG_C_MAX, held));
      }
      if (p.t === 'P' && code !== '_' && ctx.pause) dur *= ctx.pause;
      return dur;
    }

    function stopTiming(p, ctx) {
      const unreleased = !!(ctx.nxt && ctx.nxt.t === 'S');
      let asp = (p.asp || 0)/1000/ctx.speed;
      if (ctx.prevCode === 'S') asp *= 0.15;                      // unaspirated after /s/
      else if (ctx.nxt && ctx.nxt.t === 'L') asp *= 0.5;          // fricated into a liquid
      // word-final: soft, tapered release
      else if (!ctx.nxt || ctx.nxt.t === 'P') asp *= 0.4 * TUNING.finalTaper;
      return { unreleased, asp };
    }

    // Total duration (s) of a run. ⚠ Only sums segmentDuration/stopTiming; never
    // reimplement a rule here. `dl` is deliveryFor's result.
    function estimateDuration(phon, speed, shout, dl) {
      let t = 0.08, stress = 0, prevCode = null, held = false, long = 0;
      let wordScale = sylScale(sylFrom(phon, 0));
      const fins = rhymeBreaks(phon);
      for (let i = 0; i < phon.length; i++) {
        const code = phon[i];
        if (code === '^') { held = true; continue; }
        if (isLong(code)) { long = +code.slice(1) || 0; continue; }
        if (isMark(code)) { stress = code === '!' ? 2 : 1; continue; }
        const p = PH[code]; if (!p) continue;
        let j = i + 1; while (isMark(phon[j])) j++;
        const nxtCode = phon[j], nxt = PH[nxtCode];
        if (p.t === 'P') wordScale = sylScale(sylFrom(phon, i + 1));
        const ctx = { nxtCode, nxt, prevCode, stress, shout, wordScale, speed, held, hold: dl && dl.hold, pause: dl && dl.pause, long, longK: dl && dl.longK, nat: dl && dl.nat, fin: fins[i] };
        const dur = segmentDuration(p, code, ctx);
        long = 0;
        if (p.t === 'V') { stress = 0; held = false; }
        if (p.t === 'F' && p.stopFirst) t += AFFRICATE_CLOSURE;
        if (p.t === 'S') {
          const { unreleased, asp } = stopTiming(p, ctx);
          t += dur*0.6 + (unreleased ? 0.02 : (p.bd ?? 20) / 1000 + asp);
        } else {
          t += dur;
        }
        if (code !== '_') prevCode = code;
      }
      return t;
    }

    // Glottal source: a differentiated Rosenberg pulse (lip radiation), DFT'd into
    // a PeriodicWave once per voice. Open quotient: ~0.8 breathy, ~0.45 pressed.
    const _waveCache = new Map();
    // `buzz` mixes in a flat impulse train, RMS-matched and rescaled to the level
    // the normalised pulse alone would have.
    const BUZZ_TRIM_DB = 3;
    function glottalWave(ctx, oq, buzz = 0){
      buzz = Math.max(0, Math.min(1, +buzz || 0));
      if (buzz > 0) {
        const bkey = oq.toFixed(2) + '/' + buzz.toFixed(2);
        if (_waveCache.has(bkey)) return _waveCache.get(bkey);
        const H = 48, N = 1024;
        const real = new Float32Array(H + 1), imag = new Float32Array(H + 1);
        const g = glottalCoeffs(oq);
        let eg = 0; for (let h = 1; h <= H; h++) eg += g.real[h] ** 2 + g.imag[h] ** 2;
        const flat = Math.sqrt(eg / H);
        for (let h = 1; h <= H; h++) { real[h] = (1 - buzz) * g.real[h] + buzz * flat; imag[h] = (1 - buzz) * g.imag[h]; }
        let pk = 0, em = 0;
        for (let i = 0; i < N; i++) {
          let v = 0; const a = 2 * Math.PI * i / N;
          for (let h = 1; h <= H; h++) v += g.real[h] * Math.cos(h * a) + g.imag[h] * Math.sin(h * a);
          pk = Math.max(pk, Math.abs(v));
        }
        for (let h = 1; h <= H; h++) em += real[h] ** 2 + imag[h] ** 2;
        // a flat source is ~3 dB louder through the bank; trim in proportion
        const k = Math.sqrt(eg / Math.max(1e-12, em)) / Math.max(1e-9, pk) * 10 ** (-BUZZ_TRIM_DB * buzz / 20);
        for (let h = 1; h <= H; h++) { real[h] *= k; imag[h] *= k; }
        const bw = ctx.createPeriodicWave(real, imag, { disableNormalization: true });
        _waveCache.set(bkey, bw);
        return bw;
      }
      const key = oq.toFixed(2);
      let w = _waveCache.get(key);
      if (w) return w;
      const { real, imag } = glottalCoeffs(oq);
      w = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
      _waveCache.set(key, w);
      return w;
    }
    // The pulse's 48 harmonics, as PeriodicWave coefficients.
    function glottalCoeffs(oq){
      const N = 512, H = 48;
      const T1 = oq * 0.62, T2 = oq * 0.38;      // opening and closing phases
      const g = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const x = i / N;
        if (x < T1)            g[i] = 0.5 * (1 - Math.cos(Math.PI * x / T1));
        else if (x < T1 + T2)  g[i] = Math.cos(Math.PI * (x - T1) / (2 * T2));
        else                   g[i] = 0;
      }
      // circular derivative keeps the closure discontinuity
      const d = new Float32Array(N);
      for (let i = 0; i < N; i++) d[i] = g[i] - g[(i + N - 1) % N];
      const real = new Float32Array(H + 1), imag = new Float32Array(H + 1);
      for (let h = 1; h <= H; h++) {
        let re = 0, im = 0;
        for (let i = 0; i < N; i++) {
          const a = 2 * Math.PI * h * i / N;
          re += d[i] * Math.cos(a); im -= d[i] * Math.sin(a);
        }
        real[h] = (2 / N) * re; imag[h] = (2 / N) * im;
      }
      return { real, imag };
    }

    // Pink speech noise (Kellett's filter), in its OWN buffer: pinking the shared
    // getNoiseBuffer() would re-voice every other sound.
    let _speechNoise = null;
    function speechNoise(ctx){
      if (_speechNoise) return _speechNoise;
      const n = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
      for (let i = 0; i < n; i++) {
        const w = Math.random()*2 - 1;
        b0 = 0.99886*b0 + w*0.0555179;  b1 = 0.99332*b1 + w*0.0750759;
        b2 = 0.96900*b2 + w*0.1538520;  b3 = 0.86650*b3 + w*0.3104856;
        b4 = 0.55000*b4 + w*0.5329522;  b5 = -0.7616*b5 - w*0.0168980;
        d[i] = b0+b1+b2+b3+b4+b5+b6 + w*0.5362;
        b6 = w*0.115926;
      }
      // RMS-normalised to 0.5 so the `ng` levels carry over. Deliberately not
      // peak-limited: clamping a heavy-tailed pink distorts, and noiseG leaves headroom.
      let sum = 0; for (let i = 0; i < n; i++) sum += d[i]*d[i];
      const g = 0.5 / Math.sqrt(sum/n);
      for (let i = 0; i < n; i++) d[i] *= g;
      _speechNoise = buf;
      return buf;
    }
    // Flutter: F0 and loudness wander at random, never as a sine (a sine is vibrato
    // and reads as a machine). Two octaves of cosine-interpolated value noise, ~9 Hz
    // and ~3 Hz, peak about 1. ⚠ Duplicated in oracle-worklet.js (flutterAt).
    function flutterAt(t, salt) {
      const knot = (i) => {
        let h = Math.imul((i | 0) ^ salt, 0x2c1b3c6d); h ^= h >>> 15; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
        return (h >>> 0) / 2147483648 - 1;
      };
      const oct = (x) => { const i = Math.floor(x), u = (1 - Math.cos(Math.PI * (x - i))) / 2; return knot(i) * (1 - u) + knot(i + 1) * u; };
      return 0.65 * oct(t * 9) + 0.45 * oct(t * 3.1 + 517);
    }
    // 20 s of it at 8 kHz, looped; a line starts it at a random offset.
    let _flutter = null;
    function flutterBuffer(ctx) {
      if (_flutter) return _flutter;
      const rate = 8000, n = rate * 20;
      const buf = ctx.createBuffer(1, n, rate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = flutterAt(i / rate, 0x5eed);
      return (_flutter = buf);
    }

    // Speech channels: tv (TV, PA, welcome), scene (voices inside a broadcast,
    // routed as tv), ui (Read Aloud, dry bus). A line cancels only its own
    // channel (or queues); cancel() with none stops all. Read Aloud ducks tv.
    // see docs/systems-accessibility.md#speech-channels-what-a-typed-command-stops
    const CHANNELS = { tv: { lines: [] }, scene: { lines: [] }, ui: { lines: [] } };
    const QUEUE_MAX = 3;          // lines that may wait behind the one speaking
    const READER_DUCK_DB = -12;
    const stopAll = (nodes) => nodes.forEach(n => { try { n.stop(); } catch { /* already stopped */ } });
    function cancel(channel){
      const names = channel ? [channel === 'reader' ? 'ui' : channel] : Object.keys(CHANNELS);
      for (const name of names) {
        const ch = CHANNELS[name];
        if (!ch) continue;
        for (const line of ch.lines) { stopAll(line.src); line.duck?.release(); }
        ch.lines = [];
      }
    }
    // For the natural (non-ORACLE) reader: logreader.js holds it per utterance.
    const readerDuck = (opts) => duck(['tv'], READER_DUCK_DB, opts || {});
    // Seconds until a channel falls silent, queued lines included.
    function left(channel = 'tv') {
      const ch = CHANNELS[channel];
      if (!ctx || !ch) return 0;
      return ch.lines.reduce((m, l) => Math.max(m, l.end - ctx.currentTime), 0);
    }

    // Worklet back end (prototype, Voice Lab only): `backend: 'worklet'` schedules
    // into recorders, samples them into tracks every WK.frame s, and hands those to
    // oracle-worklet.js (LF pulse into a Klatt cascade). The output stage is shared.
    // Falls back to the graph until the module loads.
    const WK_TRACK = ['f0', 'jitA', 'jitB', 'av', 'ah', 'af', 'f1', 'f2', 'f3', 'f4', 'q1', 'q2', 'q3', 'q4',
      'nf', 'nq', 'nzf', 'nzdb', 'tilt', 'closure', 'rd', 'creak'];   // ⚠ the same list, in the same order, as TRACK in oracle-worklet.js
    const WK = {
      frame: 0.005,     // track resolution, s
      cascK: 0.10,      // cascade level vs frication; both back ends within ~1 dB
      srcK: 1, aspK: 1, fricK: 1, closureK: 1,
      bwK: 1,           // every formant bandwidth, scaled
      tiltK: 1,         // the graph's tilt corner, scaled, becomes the LF return phase
      emph: 0.88,       // pre-emphasis into the cascade, unity at 500 Hz (else 6-11 dB dark at F3)
      cycJitter: 0.5,   // per-cycle random jitter, as a share of the LFO jitter depth
      shimmer: 0.02,    // per-cycle amplitude spread
      // scaled by the voice's `natural`:
      rdBreath: 6,      // Rd rises by this share per unit of aspiration (breath holds the folds apart)
      aspPulse: 0.8,    // how far aspiration drops in the closed phase (0 steady, 1 silent)
      f1Open: 0.5,      // F1 bandwidth widening while open (0.8 smeared /iy/)
      creakJit: 0.2,    // creak: random spread of period length
      creakDip: 0.6,    // creak: every other period this much weaker (diplophonia)
      creakAlt: 0.08,   // creak: and alternately this much longer and shorter
      creakPress: 0.4,  // creak presses the folds: Rd falls by this share
    };
    // Fant (1995) LF timing from Rd. ⚠ Duplicated in oracle-worklet.js (lfFromRd).
    function lfFromRd(rd) {
      const ra = (-1 + 4.8 * rd) / 100, rk = (22.4 + 11.8 * rd) / 100;
      const rg = rk / (4 * (0.11 * rd / (0.5 + 1.2 * rk) - ra));
      const tp = 1 / (2 * rg);
      return { te: tp * (1 + rk), tp, ra };
    }
    // Bisection: te rises with Rd across 0.3-2.7.
    function rdFromTe(oq) {
      let lo = 0.3, hi = 2.7;
      for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (lfFromRd(m).te < oq) lo = m; else hi = m; }
      return (lo + hi) / 2;
    }
    let _wkUrl = _SELF_SRC ? new URL('oracle-worklet.js', _SELF_SRC).href : '';
    const _wkState = new WeakMap();   // context -> true | false | Promise
    function loadOracleWorklet(c) {
      c = c || ensureContext();
      if (!c || !c.audioWorklet || !_wkUrl) return Promise.resolve(false);
      if (_wkState.has(c)) return Promise.resolve(_wkState.get(c));
      const p = c.audioWorklet.addModule(_wkUrl).then(() => { _wkState.set(c, true); return true; },
        (e) => { _wkState.set(c, false); console.warn('[voice] worklet back end unavailable:', e && e.message); return false; });
      _wkState.set(c, p);
      return p;
    }
    // An AudioParam that remembers what it was told.
    class RecParam {
      constructor(v) { this.v0 = v; this.ev = []; }
      get value() { return this.v0; }
      set value(v) { this.v0 = v; }
      setValueAtTime(v, t) { this.ev.push({ k: 0, v, t }); return this; }
      setTargetAtTime(v, t, tc) { this.ev.push({ k: tc > 0 ? 1 : 0, v, t, tc }); return this; }
      // Web Audio's semantics: time order (ties by creation), targets from the current value.
      sample(t0, frames, step, out, col, stride) {
        const ev = this.ev.slice().sort((a, b) => a.t - b.t);
        let v = this.v0, act = null, j = 0;
        const valAt = (t) => act ? act.v + (act.from - act.v) * Math.exp(-(t - act.t) / act.tc) : v;
        for (let n = 0; n < frames; n++) {
          const ft = t0 + n * step;
          while (j < ev.length && ev[j].t <= ft) {
            const e = ev[j++];
            v = valAt(e.t);
            if (e.k === 0) { v = e.v; act = null; } else act = { v: e.v, tc: e.tc, t: e.t, from: v };
          }
          out[n * stride + col] = valAt(ft);
        }
      }
    }
    const recNode = () => ({
      frequency: new RecParam(0), Q: new RecParam(1), gain: new RecParam(1), detune: new RecParam(0),
      connect: (x) => x, disconnect() {}, start() {}, stop() {}, setPeriodicWave() {},
    });
    const REC = { createOscillator: recNode, createGain: recNode, createBiquadFilter: recNode, createBufferSource: recNode };

    // An en dash between names reads "versus" only for a voice with `vs` (a booth);
    // in a book it's a span.
    const readMatchups = (text) => String(text).replace(/(\p{L})\s*–\s*(?=\p{Lu})/gu, '$1 versus ');

    // speak(text, { seed, voice, lex, accent, pa, channel, excite, budget, gain }).
    // `excite` -1..1 (see deliveryFor). `gain` 0-1 sits a voice under others on its
    // bus; Read Aloud ignores it.
    function speak(text, opt = {}){
      // 'ui' is the log reader: it bypasses the TV toggle and slider, but the
      // master Sound switch still silences it.
      const ui = opt.channel === 'ui';
      if (!_settings.enabled || (!ui && !_settings.tv)) return;
      const c = ensureContext(); if (!c) return;
      if (c.state === 'suspended') c.resume();
      const chName = ui ? 'ui' : opt.channel === 'scene' ? 'scene' : 'tv';
      const chan = CHANNELS[chName];
      chan.lines = chan.lines.filter(l => l.end > c.currentTime);
      const queued = !!opt.queue && chan.lines.length > 0;
      if (queued && chan.lines.length > QUEUE_MAX) return null;
      if (!queued) cancel(chName);
      // `opt.voice` overrides the rolled parameters (the Voice Lab auditions with it).
      const V = Object.assign(voiceFromName(opt.seed || text), opt.voice || null);
      if (V.vs) text = readMatchups(text);
      // Never sold on the accessibility channel.
      const D = deliveryFor(ui ? 0 : Math.max(-1, Math.min(1, (+opt.excite || 0) * TUNING.excitement)));
      const F0 = V.f0 * D.pitch, ringAmt = V.ring, fshift = V.fshift;
      // ⚠ No character (drive, growl, buzz, rmod, crush) on the accessibility
      // channel: texture costs intelligibility. `natural` is allowed.
      const driveAmt = ui ? 0 : (V.drive || 0);
      const growlAmt = ui ? 0 : (V.growl || 0);
      // mix(k) moves a factor toward 1 as nat falls.
      const nat = Math.max(0, Math.min(1, V.natural ?? 1));
      const mix = nat === 1 ? (k => k) : (k => 1 + (k - 1) * nat);
      D.nat = nat;
      const clamp01 = x => Math.max(0, Math.min(1, +x || 0));
      const buzzAmt = ui ? 0 : clamp01(V.buzz), rmodAmt = ui ? 0 : clamp01(V.rmod), crushAmt = ui ? 0 : clamp01(V.crush);
      const pq = V.steps ? (f => F0 * 2 ** (Math.round(12 * Math.log2(f / F0)) / 12)) : (f => f);
      // Set → convert → clear, all synchronously (see lexLook).
      _lex = opt.lex || null;
      let phon;
      try {
        phon = applyAccent(textToPhonemes(text), opt.accent);
        phon = applyAssimilation(phon);
        if (opt.accent !== 'rp') phon = applyFlap(phon);
      }
      finally { _lex = null; }
      if (!phon.length) return;
      if (D.e >= 0.35) phon = soldNucleus(phon);
      // Every line reads at the narrator's own pace; opt.budget is deliberately
      // unused. ⚠ Broadcast's nodeHoldMs is fitted to TUNING.rate: re-measure both
      // if durations are retuned.
      const speed = V.speed * TUNING.rate * D.rate;
      // 'ui' is a dry bus (see busFor).
      const out = busFor(ui ? 'ui' : 'tv_voice');
      // `S` builds the source side: real nodes, or recorders for the worklet.
      const wk = opt.backend === 'worklet' && _wkState.get(c) === true && typeof global.AudioWorkletNode === 'function';
      if (opt.backend === 'worklet' && !wk) loadOracleWorklet(c);
      const S = wk ? REC : c;
      const closure = wk ? new RecParam(0) : null;
      // Worklet only: `tense` is Rd per syllable (0.3 pressed, 1 modal, 2.7 breathy);
      // `creakP` asks for statement-final creak.
      const rd0 = rdFromTe(Math.max(0.4, Math.min(0.85, V.oq + D.oq * nat)));
      const tense = wk ? new RecParam(rd0) : null;
      const creakP = wk ? new RecParam(0) : null;

      const master = c.createGain(); master.gain.value = 0.9 * (ui ? 1 : Math.max(0, Math.min(1, opt.gain ?? 1)));
      const ringGain = c.createGain(); ringGain.gain.value = 1 - ringAmt;
      const lfo = c.createOscillator(); lfo.frequency.value = 50;
      const lfoDepth = c.createGain(); lfoDepth.gain.value = ringAmt;
      lfo.connect(lfoDepth).connect(ringGain.gain);

      // Presence: a wide PEAK at 3 kHz for consonants (a shelf also lifts sibilant hiss).
      const presence = c.createBiquadFilter();
      presence.type = 'peaking'; presence.frequency.value = 3000;
      presence.Q.value = 0.9; presence.gain.value = TUNING.presenceDb + 2 * D.e;
      // Keeps a loud vowel from swamping the next consonant.
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -22; comp.knee.value = 12; comp.ratio.value = TUNING.compRatio;
      comp.attack.value = 0.004; comp.release.value = 0.12;
      // ⚠ `master` must reach `out` through this chain: a missing edge is a silent
      // voice that throws nothing, and the voice smoke never builds nodes.
      // `rmod`: ring mod after the tract (`ring` is a 50 Hz tremolo); its carrier
      // joins the line's sources.
      let rmodOsc = null;
      if (rmodAmt > 0) {
        const into = c.createGain(), dry = c.createGain(), wet = c.createGain();
        dry.gain.value = 1 - rmodAmt; wet.gain.value = 0;
        rmodOsc = c.createOscillator(); rmodOsc.frequency.value = Math.max(1, +V.rmodHz || 30);
        // a product of sines has half the power: lift by root two
        const depth = c.createGain(); depth.gain.value = rmodAmt * Math.SQRT2;
        rmodOsc.connect(depth).connect(wet.gain);
        ringGain.connect(into);
        into.connect(dry).connect(presence);
        into.connect(wet).connect(presence);
        master.connect(ringGain);
      } else {
        master.connect(ringGain).connect(presence);
      }
      presence.connect(comp);
      // Drive after the compressor (as a transmitter), with buildLayer's curve.
      let voiceTail = comp;
      if (driveAmt > 0) {
        const vs = c.createWaveShaper();
        vs.curve = driveCurve(driveAmt);
        vs.oversample = '4x';
        // clipping sounds louder: trim so grit and level stay separate
        const trim = c.createGain(); trim.gain.value = 1 - driveAmt * 0.35;
        comp.connect(vs).connect(trim);
        voiceTail = trim;
      }
      // `crush`: the retro stage on the finished voice (1 is 4 bits at 4.2 kHz). Its
      // worklet must outlive a queued line's wait. Trimmed like drive.
      if (crushAmt > 0) {
        const crushOut = c.createGain(); crushOut.gain.value = 1 - 0.5 * crushAmt ** 4;
        const from = Math.max(c.currentTime, queued ? chan.lines[chan.lines.length - 1].end : 0);
        const until = from + 1 + 1.5 * estimateDuration(phon, speed, undefined, D);
        const into = retroStage(c, { rate: 24000 * 2 ** (-2.5 * crushAmt), bits: Math.round(16 - 12 * crushAmt), ref: 0.6 }, {}, crushOut, until);
        voiceTail.connect(into);
        voiceTail = crushOut;
      }
      // `opt.pa`: through a street horn. Never on 'ui'.
      if (opt.pa && !ui) {
        const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 420; hp.Q.value = 0.9;
        const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200; lp.Q.value = 1.4;
        const horn = c.createBiquadFilter(); horn.type = 'peaking'; horn.frequency.value = 1600; horn.Q.value = 1.2; horn.gain.value = 6;
        const clip = c.createWaveShaper(); clip.curve = driveCurve(0.45); clip.oversample = '2x';
        const dry = c.createGain(); dry.gain.value = 0.8;
        voiceTail.connect(hp).connect(lp).connect(horn).connect(clip).connect(dry).connect(out);
        // two slaps, no feedback
        for (const [t, g] of [[0.13, 0.32], [0.29, 0.16]]) {
          const d = c.createDelay(0.5); d.delayTime.value = t;
          const dg = c.createGain(); dg.gain.value = g;
          clip.connect(d).connect(dg).connect(out);
        }
      } else {
        voiceTail.connect(out);
      }

      const glot = S.createOscillator(); glot.frequency.value = F0;
      glot.setPeriodicWave(glottalWave(c, Math.max(0.4, Math.min(0.85, V.oq + D.oq * nat)), buzzAmt));
      // A gentle top-end tame; the source rolls off on its own.
      const tilt = S.createBiquadFilter();
      tilt.type = 'lowpass'; tilt.frequency.value = 5200; tilt.Q.value = 0.4;
      // Jitter: random flutter (flutterAt) on the graph; the worklet draws its own
      // from jitA. jit2 is the drawn vowel's 6.3 Hz waver, silent otherwise: left
      // running under every line it was a steady vibrato. Shimmer rides the master gain.
      // `_off` is a start offset, so no two lines wander alike.
      const flutterSrc = (rate) => {
        const b = c.createBufferSource(); b.buffer = flutterBuffer(c); b.loop = true;
        b.playbackRate.value = rate; b._off = Math.random() * 19;
        return b;
      };
      const JIT_K = 1.17;   // the old pair's combined depth, sqrt(1 + 0.6²)
      const jit = wk ? S.createOscillator() : flutterSrc(0.9 + Math.random() * 0.2);
      if (wk) { jit.type = 'triangle'; jit.frequency.value = 9; }
      const jitG = S.createGain(); jitG.gain.value = F0 * V.jitter * JIT_K * D.jitter * nat; jit.connect(jitG).connect(glot.frequency);
      const jit2 = S.createOscillator(); jit2.type = 'sine'; jit2.frequency.value = 6.3;
      const jit2G = S.createGain(); jit2G.gain.value = 0; jit2.connect(jit2G).connect(glot.frequency);
      // Glottal FM on the SOURCE (before the tract, unlike `ring`/`rmod`), scaled by F0.
      //   growlRatio  0.5 sub-harmonic creak (default), 1 brighter, non-integer inharmonic
      //   growl       index · growlWave modulator wave · growl2 a second modulator
      // growl2 is PARALLEL on purpose (diplophonia), unlike buildLayer's series op2.
      // ⚠ Started later with everything in `src`, never by hand here, or cancel()
      // can't stop it and it drones forever.
      let growlOsc = null, growl2Osc = null;
      if (growlAmt > 0) {
        growlOsc = S.createOscillator();
        growlOsc.type = OSC_WAVES.includes(V.growlWave) ? V.growlWave : 'sine';
        growlOsc.frequency.value = F0 * (V.growlRatio ?? 0.5);
        const growlG = S.createGain(); growlG.gain.value = F0 * growlAmt;
        growlOsc.connect(growlG).connect(glot.frequency);
        if (V.growl2 > 0) {
          growl2Osc = S.createOscillator();
          growl2Osc.type = OSC_WAVES.includes(V.growl2Wave) ? V.growl2Wave : 'sine';
          growl2Osc.frequency.value = F0 * (V.growl2Ratio ?? 1.5);
          const g2 = S.createGain(); g2.gain.value = F0 * V.growl2;
          growl2Osc.connect(g2).connect(glot.frequency);
        }
      }
      const shim = wk ? S.createOscillator() : flutterSrc(0.55 + Math.random() * 0.1);
      const shimG = S.createGain(); shimG.gain.value = 0.05 * nat; shim.connect(shimG).connect(master.gain);
      // Voicing gates the SOURCE, ahead of the tract, so the tract rings out and
      // aspiration can run through it (`aspG`).
      const voiced = S.createGain(); voiced.gain.value = 0;
      glot.connect(voiced).connect(tilt);
      const tract = S.createGain(); tract.gain.value = 1;   // the bank's sum
      // Four formants with near-constant bandwidths in Hz: Q = f/BW per phoneme,
      // clamped at 16 (sharper whistles).
      const F_BW = [90, 130, 200, 280];
      const qFor = (f, k) => Math.max(3, Math.min(16, f / F_BW[k]));
      // The shared buildResonatorBank; its handles let the bands glide.
      const bands = [0,1,2,3].map(k => {
        const f = k === 3 ? 3600 : 500;
        return { freq: f, q: qFor(f, k), gain: k === 0 ? 1 : 0.4 };
      });
      const bank = wk ? bands.map(b => {
        const filter = REC.createBiquadFilter(), gain = REC.createGain();
        filter.frequency.value = b.freq; filter.Q.value = b.q; gain.gain.value = b.gain;
        return { filter, gain };
      }) : buildResonatorBank(tilt, tract, bands);
      const forms = bank.map(b => b.filter), fgain = bank.map(b => b.gain);

      // Parallel-bank gains from the cascade's all-pole response at each formant
      // (Klatt's parallel branch). CASCADE_FIT rescales per index to the tuned
      // average, since the source, `tilt` and `presence` already set the brightness.
      const CASCADE_FIT = [1, 1.49, 3.97, 20.17];
      const cascadeA = (F, wide) => {
        const bw = F_BW.map(b => b * (wide ? 1.8 : 1));
        return F.map((fn, n) => {
          let a = fn / bw[n];
          for (let k = 0; k < 4; k++) {
            if (k === n) continue;
            a *= (F[k]*F[k]) / Math.hypot(F[k]*F[k] - fn*fn, bw[k]*fn);
          }
          return a;
        });
      };
      // ⚠ Normalised to a fixed reference (the neutral vowel), not to F1 = 1, so
      // a nasal murmur stays quieter than the vowel after it.
      const A_REF = cascadeA([600*fshift, 1200*fshift, 2400*fshift, 3600*fshift], false)[0];
      // Closed-tract F1 at full strength (voice bar ~-16 dB, clear speech): measured
      // more intelligible.
      const MURMUR_F1 = 1;
      const cascadeGains = (F, wide) => {
        const A = cascadeA(F, wide);
        // clamp AFTER the rescale, or the floor flattens the variation
        return A.map((x, k) => Math.max(0.02, Math.min(2.5, (x / A_REF) * CASCADE_FIT[k])));
      };
      // Nasal antiformant (a negative peaking filter), voiced path only: what tells
      // M, N and NG apart.
      const nzero = S.createBiquadFilter();
      nzero.type = 'peaking'; nzero.frequency.value = 1500; nzero.Q.value = 4; nzero.gain.value = 0;
      tract.connect(nzero).connect(master);

      const nz = S.createBufferSource(); nz.buffer = speechNoise(c); nz.loop = true;
      // Frication noise: two identical bandpasses in series steepen the skirts
      // (still unity at the peak), then a 9 kHz lowpass cuts air with no cue in it.
      const nbp = S.createBiquadFilter(); nbp.type = 'bandpass'; nbp.frequency.value = 4000; nbp.Q.value = 3;
      const nbp2 = S.createBiquadFilter(); nbp2.type = 'bandpass'; nbp2.frequency.value = 4000; nbp2.Q.value = 3;
      const nlp = S.createBiquadFilter(); nlp.type = 'lowpass'; nlp.frequency.value = 9000; nlp.Q.value = 0.7;
      // ⚠ Always set both bandpasses together.
      const setNoiseBand = (f, q, when, tc) => {
        for (const n of [nbp, nbp2]) {
          if (tc) n.frequency.setTargetAtTime(f, when, tc); else n.frequency.setValueAtTime(f, when);
          n.Q.setValueAtTime(q, when);
        }
      };
      const noiseG = S.createGain(); noiseG.gain.value = 0;
      nz.connect(nbp).connect(nbp2).connect(nlp).connect(noiseG).connect(master);
      // Aspiration: the same noise through the TRACT (/h/, the puff after /p t k/,
      // breath), so the formants shape it.
      const aspG = S.createGain(); aspG.gain.value = 0;
      nz.connect(aspG).connect(tilt);

      // A queued line starts after the last one on its channel, one line gap on.
      const after = queued ? chan.lines[chan.lines.length - 1].end + (TUNING.lineGapMs || 0) / 1000 : 0;
      const t0 = Math.max(c.currentTime + 0.05, after); let t = t0;
      // F4's frequency is fixed; set once.
      forms[3].frequency.setValueAtTime(3600 * fshift, t0);
      // Formants glide (22 ms default, per-phoneme `tc`: slow transitions ARE
      // /w y r/). `wide` broadens the bands for nasality.
      const setF = (when, arr, wide, tc) => {
        const k0 = tc || 0.022;
        const F = [arr[0]*fshift*D.f1, arr[1]*fshift, arr[2]*fshift, 3600*fshift];
        const A = cascadeGains(F, wide);
        for (let k = 0; k < 4; k++) {
          // F4's bandwidth still takes nasal damping
          if (k < 3) forms[k].frequency.setTargetAtTime(F[k], when, k0);
          forms[k].Q.setTargetAtTime(qFor(F[k], k) / (wide ? 1.8 : 1), when, k0);
          // amplitudes glide too (stepping clicks)
          fgain[k].gain.setTargetAtTime(A[k], when, k0);
        }
        if (closure) closure.setTargetAtTime(0, when, k0);
      };
      // Closed tract (voice bar under /b d g/, voicing under /v z/): F1 ~220 Hz, the
      // rest nearly silent (else it's a nasal). F2/F3 still travel to the locus.
      const murmur = (when, lf, keep = MURMUR_KEEP) => {
        const L = lf || [350, 1500, 2500];
        forms[0].frequency.setTargetAtTime(220 * fshift, when, 0.008);
        forms[0].Q.setTargetAtTime(3, when, 0.008);
        forms[1].frequency.setTargetAtTime(L[1] * fshift, when, 0.012);
        forms[2].frequency.setTargetAtTime(L[2] * fshift, when, 0.012);
        fgain[0].gain.setTargetAtTime(MURMUR_F1, when, 0.006);
        for (let k = 1; k < 4; k++) fgain[k].gain.setTargetAtTime(keep, when, 0.006);
        if (closure) closure.setTargetAtTime(1, when, 0.006);
      };
      // A breath in before a big call.
      if (D.e >= 0.6) {
        setF(t0, [600, 1200, 2400], false, 0.01);
        aspG.gain.setTargetAtTime(ASP_BREATH_IN * (0.5 + 0.5 * D.e) * nat, t0, 0.05);
        aspG.gain.setTargetAtTime(0, t0 + 0.17, 0.03);
        t += 0.22;
      }

      // Prosody: declination and accents, worked out per PHRASE.
      const tail = String(text).trim();
      const rise  = /\?["'’”)]*\s*$/.test(tail);
      const trail = /(\.{2,}|…)["'’”)]*\s*$/.test(tail);
      // A shouted line is held at full effort throughout.
      const shoutLine = lineCaps(text).shout;
      // Declination resets at every terminal pause.
      const phrases = [[]];
      for (const code of phon) {
        phrases[phrases.length-1].push(code);
        if (isTerm(code)) phrases.push([]);
      }
      if (!phrases[phrases.length-1].length) phrases.pop();
      const phraseDur = phrases.map(ph => estimateDuration(ph, speed, undefined, D) || 1);
      // read off the mark that ends each phrase
      const phraseDecl = phrases.map(ph => {
        const end = ph[ph.length-1];
        return (end === '_Q' ? V.decl * 0.45 : end === '_E' ? V.decl * 1.25 : V.decl) * D.decl * nat;
      });
      // A sold line peaks on its exclamation; "!!" goes higher, even for a calm voice.
      const phraseK = phrases.map(ph => {
        const end = ph[ph.length-1];
        if (end === '_XX') return 2 ** (1.5 * Math.max(D.e, 0.4) * nat / 12);
        return D.e > 0 && end !== '_X' ? 2 ** (-2 * D.e * nat / 12) : 1;
      });
      const phraseBang = phrases.map(ph => (ph[ph.length-1] === '_XX' ? 2 : ph[ph.length-1] === '_X' ? 1 : 0));
      const lilt = V.lilt * D.range * nat;
      let phraseIx = 0, phraseT0 = t;
      const totalDur = estimateDuration(phon, speed, undefined, D) || 1;
      // Intrinsic F0: high vowels (low F1) sit slightly higher.
      const intrinsicF0 = f1 => 1 + Math.max(-0.025, Math.min(0.045, (500 - f1) / 500 * 0.05)) * nat;

      // Microprosody from the consonant just released.
      let micro = 1;

      // Boundary tone into each mark: most of how the ear tells which was written.
      const BOUNDARY = { _C: 1.07, _S: 1.05, _D: 1.04, _E: 0.955, _Q: 1.13, _X: 1.02, _XX: 1.03, _M: 1.035 };
      // Accent shapes in units of lilt: the nucleus falls (H* L), half-falls before
      // a non-terminal break, is low (L*) in a question. Prenuclear peaks downstep.
      // '!' sits above all; '^' keeps its own climb.
      const ACC = { nuc: 1.6, pre: 1.15, down: 0.6, fall: 1.0, half: 0.3, low: 0.6, postFall: 0.9, postStress: 0.75 };
      const nucKind = end => (end === '_Q' ? 'low' : !end || isTerm(end) ? 'fall' : 'cont');
      let afterNuc = null, downN = 0, declOff = 0;
      const pitchAt = (when, frac, stressed, f1, nextCode, nuc, dur) => {
        const fall = 1 - (phraseDecl[phraseIx] ?? V.decl) * Math.max(0, frac - declOff);   // declination
        let lift, fallTo = 0;
        if (stressed === 2) lift = 1 + lilt * 3.4 * TUNING.emphasis;
        else if (nuc === 'low') lift = 1 - lilt * ACC.low;
        else if (nuc && !dur) lift = 1 + lilt;   // held or drawn: starts from a plain accent
        else if (nuc) lift = 1 + lilt * ACC.nuc * (downN ? ACC.down : 1);
        else if (afterNuc === 'fall') lift = 1 - lilt * (stressed ? ACC.postStress : ACC.postFall);
        else if (afterNuc === 'cont') lift = 1 - lilt * ACC.half;
        else if (stressed && !afterNuc) { lift = 1 + lilt * ACC.pre * ACC.down ** downN; downN++; }
        else lift = 1 - lilt * 0.45;
        if (nuc === 'fall') fallTo = 1 - lilt * ACC.fall;
        else if (nuc === 'cont') fallTo = 1 - lilt * ACC.half;
        if (nuc) afterNuc = nuc;
        const hold = mix(BOUNDARY[nextCode] || 1);
        const f = pq(F0 * (phraseK[phraseIx] ?? 1) * fall * lift * hold * intrinsicF0(f1) * mix(micro));
        glot.frequency.setTargetAtTime(f, when, V.steps ? 0.012 : 0.05);
        if (fallTo && dur) glot.frequency.setTargetAtTime(pq(F0 * (phraseK[phraseIx] ?? 1) * fall * fallTo * hold * intrinsicF0(f1)), when + dur * 0.35, Math.max(0.03, dur * 0.3));
        micro = 1;
        // Tilt tracks effort. On the worklet `tense` does it, so the tilt stays plain.
        const tf = wk ? TUNING.tiltPlain : stressed === 2 ? TUNING.tiltEmph : stressed ? TUNING.tiltStress : TUNING.tiltPlain;
        tilt.frequency.setTargetAtTime((nat === 1 ? tf : TUNING.tiltPlain + (tf - TUNING.tiltPlain) * nat) * mix(D.bright), when, 0.04);
        return f;
      };

      // Reduction is lexical (cmuLook); this loop only does length and loudness.
      const phAt = (i) => { while (isMark(phon[i])) i++; return PH[phon[i]]; };

      let wordScale = sylScale(sylFrom(phon, 0));
      const fins = rhymeBreaks(phon);
      let pendingStress = 0, pendingHeld = false, pendingLong = 0, prevNasal = false, prevP = null, prevCode = null;
      let pendingNuc = null;
      const holdK = shoutLine ? Math.min(D.hold, 1.4) : D.hold;

      // `opt.trace`: an array to receive each phoneme's start (s from line start).
      const trace = Array.isArray(opt.trace) ? opt.trace : null;
      for (let i = 0; i < phon.length; i++) {
        const code = phon[i];
        if (code === '^') { pendingHeld = true; continue; }
        if (isLong(code)) { pendingLong = +code.slice(1) || 0; continue; }
        if (code === '+') { let j = i + 1; while (j < phon.length && !isBreak(phon[j])) j++; pendingNuc = nucKind(phon[j]); continue; }
        if (isMark(code)) { pendingStress = code === '!' ? 2 : 1; continue; }
        const p = PH[code]; if (!p) continue;
        if (trace) trace.push({ p: code, at: t - t0, ...(p.t === 'V' && pendingNuc ? { nuc: pendingNuc } : null), ...(p.t === 'V' && pendingStress ? { acc: pendingStress } : null) });
        const long = pendingLong; pendingLong = 0;
        const nxt = phAt(i+1);
        let nj = i + 1; while (isMark(phon[nj])) nj++;
        const nxtCode = phon[nj];
        const segCtx = { nxtCode, nxt, prevCode, stress: pendingStress, shout: shoutLine, wordScale, speed, held: pendingHeld, hold: holdK, pause: D.pause, long, longK: D.longK, nat, fin: fins[i] };
        let dur = segmentDuration(p, code, segCtx);

        if (p.t==='V' || p.t==='N' || p.t==='L') {
          const stressed = pendingStress; pendingStress = 0;
          const held = pendingHeld && p.t === 'V'; if (p.t === 'V') pendingHeld = false;
          let f = p.f;
          if (p.df && !(nxt && nxt.t === 'V')) f = p.df;
          // Postvocalic /r/ is an r-colouring at near full voice, not a consonant
          // (else "four" is heard as "full").
          const rhotic = code === 'R' && prevP && prevP.t === 'V' && !(nxt && nxt.t === 'V');
          if (rhotic) f = RHOTIC;
          // A vowel touching a nasal is partly nasalised (and its F1 rises).
          const nasalNext = nxt && nxt.t === 'N';
          const nasal = p.t === 'N', nasalised = nasal || prevNasal || nasalNext;
          if (nasalised && p.t === 'V') f = [f[0]*1.07, f[1], f[2]];
          // Undershoot (Lindblom), tau ~75 ms; stressed vowels resist. ⚠ Keep
          // TUNING.undershoot small: the glide already undershoots, and doubling it
          // turned "some" into "sim".
          if (p.t === 'V' && !p.to) {
            const ctx = [];
            if (prevP && (prevP.lf || prevP.f)) ctx.push(prevP.lf || prevP.f);
            if (nxt && (nxt.lf || nxt.f)) ctx.push(nxt.lf || nxt.f);
            if (ctx.length) {
              const loc = [0,1,2].map(k => ctx.reduce((s,c) => s + c[k], 0) / ctx.length);
              // at natural 1: evening timing must not move formant targets
              const durN = nat === 1 ? dur : segmentDuration(p, code, { ...segCtx, nat: 1 });
              let blend = Math.exp(-durN / 0.075);
              if (stressed) blend *= stressed === 2 ? 0.25 : 0.5;
              f = f.map((v, k) => v + (loc[k] - v) * blend * TUNING.undershoot);
            }
          }
          // A glide is defined by its slow RELEASE, set on the following vowel; /l/ snaps.
          const release = p.t === 'V' ? GLIDE_RELEASE[prevCode] : 0;
          const dark = p.df && f === p.df;
          setF(t, f, nasalised, rhotic ? 0.018 : release || (dark ? 0.016 : p.tc));
          if (nasal) {
            nzero.frequency.setTargetAtTime(p.az, t, 0.008);
            nzero.gain.setTargetAtTime(-22, t, 0.010);
          } else if (code === 'L') {
            // a lateral's mild zero near 2.3 kHz keeps /l/ from reading as a nasal
            nzero.frequency.setTargetAtTime(2300 * fshift, t, 0.008);
            nzero.gain.setTargetAtTime(-9, t, 0.010);
          } else {
            // ⚠ Set the zero's frequency too, aimed at the touching nasal, or the
            // notch sits wherever the last nasal left it.
            const az = (nasalNext && nxt.az) || (prevNasal && prevP && prevP.az) || 1000;
            if (nasalised) nzero.frequency.setTargetAtTime(az, t, 0.020);
            nzero.gain.setTargetAtTime(nasalised ? -7 : 0, t, 0.020);
          }
          let vg = p.t==='V' ? (stressed === 2 ? (shoutLine ? 1.4 : 1.25) : stressed ? 0.95 : 0.72) : rhotic ? 0.85 : code === 'L' ? 0.5 : 0.6;
          vg *= p.t === 'V' && stressed ? D.loud : 1 + (D.loud - 1) * 0.5;
          // Devoicing: an unstressed vowel between voiceless obstruents ("potato")
          // is mostly whispered; breath fills in.
          const voicelessBefore = prevP && (prevP.t==='F'||prevP.t==='S'||prevP.t==='H') && !prevP.vd;
          const voicelessAfter  = nxt   && (nxt.t==='F'  ||nxt.t==='S'  ||nxt.t==='H')   && !nxt.vd;
          const devoiced = p.t==='V' && !stressed && voicelessBefore && voicelessAfter;
          if (devoiced) vg *= 0.35;
          voiced.gain.setTargetAtTime(vg, t, 0.012);
          // Syllable envelope: decay through the back half (a held nucleus barely sags).
          const drawn = long && p.t === 'V';
          if (p.t === 'V' && !drawn) voiced.gain.setTargetAtTime(vg * (held ? 0.95 : 0.86), t + dur * (held ? 0.8 : 0.55), held ? 0.08 : 0.05);
          // Frication shut during a sonorant; breath runs through the tract instead.
          noiseG.gain.setTargetAtTime(0, t, 0.010);
          aspG.gain.setTargetAtTime(devoiced ? ASP_H * 0.8 : (V.breath * TUNING.breath + D.breath) * BREATH_K * nat, t, 0.01);
          if (p.t === 'V') {
            const nuc = pendingNuc; pendingNuc = null;
            const frac = (t - phraseT0) / (phraseDur[phraseIx] || totalDur);
            const fv = pitchAt(t, frac, stressed, f[0], nxtCode, nuc, held || drawn ? 0 : dur);
            // Worklet tension: accents press, the phrase end relaxes, a shout stays pressed.
            if (tense) {
              let m = stressed === 2 ? 0.7 : nuc || held ? 0.78 : stressed ? 0.86 : 1.08;
              const pos = Math.max(0, Math.min(1, frac - declOff));
              m *= 1 + 0.55 * pos * pos;
              m *= (fv / F0) ** 0.35;
              if (shoutLine) m = Math.min(m, 0.6);
              tense.setTargetAtTime(rd0 * m ** nat, t, 0.03);
              // statement-final creak over the back of the last vowel
              let j = i + 1, lastV = true;
              for (; j < phon.length && !isTerm(phon[j]); j++) if (VOWELS.has(phon[j])) { lastV = false; break; }
              const ender = lastV ? phon[j] : null;
              if (lastV && (ender ? ender !== '_Q' : !rise)) {
                const cr = TUNING.creak * D.creak * nat;
                if (cr > 0) creakP.setTargetAtTime(Math.min(1, cr), t + dur * 0.4, 0.04);
              }
            }
            // the held nucleus climbs, then eases at the end
            if (held && D.e > 0.3 && !drawn) {
              glot.frequency.setTargetAtTime(pq(fv * mix(1 + 0.1 * D.e)), t + dur * 0.3, 0.06);
              glot.frequency.setTargetAtTime(pq(fv * mix(1 + 0.03 * D.e)), t + dur * 0.85, 0.08);
            }
            // A drawn-out vowel: sold, it climbs 2-4 semitones, wavers (jit2), swells
            // and brightens; unsold, it sags. A steady one is an organ note.
            if (drawn) {
              const sold = D.e > 0 || phraseBang[phraseIx] > 0;
              const peak = sold ? 2 ** ((1.5 + 1.0 * Math.max(0, D.e) + 0.5 * phraseBang[phraseIx]) * nat / 12) : 2 ** (-2 * nat / 12);
              glot.frequency.setTargetAtTime(pq(fv * peak), t + 0.03, dur * 0.12);
              if (sold) glot.frequency.setTargetAtTime(pq(fv * peak * mix(1 + 0.025 * Math.max(0.4, D.e))), t + dur * 0.45, dur * 0.25);
              glot.frequency.setTargetAtTime(pq(fv * peak * mix(sold ? 0.96 : 0.92)), t + dur * 0.86, 0.05);
              const wob = F0 * VIBRATO * (sold ? 0.6 + 0.4 * Math.max(0, D.e) : 0.4) * nat;
              jit2G.gain.setTargetAtTime(wob, t + dur * 0.18, dur * 0.12);
              jit2G.gain.setTargetAtTime(0, t + dur * 0.9, 0.04);
              const swell = sold ? 1.18 + 0.06 * phraseBang[phraseIx] : 1.0;
              voiced.gain.setTargetAtTime(vg * swell, t + dur * 0.1, dur * 0.18);
              voiced.gain.setTargetAtTime(vg * (sold ? 1.05 : 0.8), t + dur * 0.85, 0.06);
              if (sold && nat > 0) tilt.frequency.setTargetAtTime(nat === 1 ? TUNING.tiltEmph * D.bright * 1.1 : (TUNING.tiltPlain + (TUNING.tiltEmph * 1.1 - TUNING.tiltPlain) * nat) * mix(D.bright), t + dur * 0.1, dur * 0.2);
            }
          }
          // a held diphthong glides at the END
          if (p.to) setF(t + (drawn ? Math.max(dur * 0.62, dur - 0.16) : dur * 0.62), p.to, false, 0.018);
          // r-colour the back half of a vowel before a syllable-final /r/
          else if (p.t === 'V' && nxtCode === 'R' && !VOWELS.has(nextSound(phon, nj + 1))) {
            setF(t + dur * (drawn ? 0.85 : 0.55), [f[0], (f[1] + RHOTIC[1]) / 2, (f[2] + RHOTIC[2]) / 2], false, 0.03);
          }
          t += dur;
        } else if (p.t==='H') {
          // /h/ is the following vowel, breathed through widened formants.
          const finalH = !nxt || nxt.t === 'P';
          nzero.gain.setTargetAtTime(0, t, 0.02);
          noiseG.gain.setTargetAtTime(0, t, 0.006);
          voiced.gain.setTargetAtTime(0, t, 0.010);
          setF(t, (nxt && nxt.f) || [600, 1200, 2400], true, 0.012);
          aspG.gain.setTargetAtTime(ASP_H * TUNING.aspiration * (finalH ? TUNING.finalTaper : 1), t, 0.010);
          micro = 1.015;
          t += dur;
          aspG.gain.setTargetAtTime(0, t, 0.012);
        } else if (p.t==='F') {
          nzero.gain.setTargetAtTime(0, t, 0.02);
          aspG.gain.setTargetAtTime(0, t, 0.006);
          // An affricate is a closure, then noise that snaps on (else /tʃ/ reads as /ʃ/).
          if (p.stopFirst) {
            if (p.vd) { murmur(t, p.lf); voiced.gain.setTargetAtTime(VBAR, t, 0.006); }
            else { if (p.lf) setF(t, p.lf, false, 0.012); voiced.gain.setTargetAtTime(0, t, 0.005); }
            noiseG.gain.setTargetAtTime(0, t, 0.005);
            t += AFFRICATE_CLOSURE;
          }
          // ⚠ Schedule Q, never assign `Q.value` (that applies now, to the whole line).
          setNoiseBand(p.nf, p.nq||3, t, 0.004);
          let fam = (p.ng ?? 0.3) * (p.sib ? TUNING.sibilance : TUNING.friction);
          // A final fricative is quieter and stops sooner (nothing masks its tail).
          const finalF = !nxt || nxt.t === 'P';
          if (finalF) fam *= TUNING.finalTaper;
          noiseG.gain.setTargetAtTime(fam, t, p.stopFirst ? 0.002 : 0.014);
          // voiced fricative: weak voicing through a near-closed tract
          if (p.vd) { murmur(t, p.lf, 0.10); voiced.gain.setTargetAtTime(VFRIC, t, 0.010); }
          else {
            if (p.lf) setF(t, p.lf, false, 0.012);   // place cue
            voiced.gain.setTargetAtTime(0, t, 0.008);
          }
          micro = p.vd ? 0.985 : 1.015;   // voiced obstruent drags F0 down, voiceless lifts it
          t += dur;
          // The exponential overhang is the breathy tail: cut it at an edge.
          noiseG.gain.setTargetAtTime(0, t, 0.02 * (finalF ? TUNING.finalTaper ** 2 : 1));
        } else if (p.t==='S') {
          // Closure: silence, or a voice bar through a closed tract (murmur). F2/F3
          // travel to the locus either way.
          nzero.gain.setTargetAtTime(0, t, 0.02);
          aspG.gain.setTargetAtTime(0, t, 0.004);
          noiseG.gain.setTargetAtTime(0, t, 0.004);
          if (p.vd) { murmur(t, p.lf); voiced.gain.setTargetAtTime(VBAR * Math.min(1, p.vd * 2.5), t, 0.006); }
          else { if (p.lf) setF(t, p.lf, false, 0.012); voiced.gain.setTargetAtTime(0, t, 0.004); }
          t += dur*0.6;
          // ⚠ Unreleased only before another stop, never before a pause (a final
          // "ct" would vanish). This path skips the loop tail, so it must update prev*.
          const timing = stopTiming(p, segCtx);
          if (timing.unreleased) {
            t += 0.02; prevNasal = false; prevP = p; prevCode = code; continue;
          }
          // release from the locus with full resonances
          setF(t, p.lf || [400, 1500, 2500], !p.vd, 0.004);
          // Burst (bq/bd/bg); a velar's follows the next vowel's F2.
          const nv = nxt && nxt.t === 'V' ? nxt : null;
          const bandF = p.lf === VEL && nv ? Math.max(1400, Math.min(3300, nv.f[1] * 1.12)) * fshift : p.nf;
          setNoiseBand(bandF, p.bq ?? 2, t, 0.002);
          noiseG.gain.setTargetAtTime(BURST * (p.bg ?? 1) * TUNING.aspiration, t, 0.0015);
          t += (p.bd ?? 20) / 1000;
          noiseG.gain.setTargetAtTime(0, t, 0.006);
          // Aspiration through the tract, moving to what follows. Unaspirated after
          // /s/ (stopTiming); before a liquid the breath goes through the liquid.
          const asp = timing.asp;
          const preLiquid = nxt && nxt.t === 'L';
          if (p.vd) {
            voiced.gain.setTargetAtTime(0.3, t, 0.005);
          } else {
            setF(t, preLiquid ? (nxt.df || nxt.f) : (nv ? nv.f : (p.lf || [500, 1500, 2500])), true, preLiquid ? 0.020 : 0.015);
            aspG.gain.setTargetAtTime(ASP_STOP * TUNING.aspiration, t, 0.004);
            aspG.gain.setTargetAtTime(0, t + asp, 0.010);
          }
          micro = p.vd ? 0.985 : 1.015;
          t += asp;
        } else if (p.t==='P') {
          if (creakP) creakP.setTargetAtTime(0, t, 0.02);
          if (isTerm(code)) { phraseIx++; phraseT0 = t + dur/speed; declOff = 0; }
          // a minor break gives back half the declination
          else if (p.minor) declOff += Math.max(0, (t - phraseT0) / (phraseDur[phraseIx] || totalDur) - declOff) * 0.5;
          if (code !== '_') { afterNuc = null; downN = 0; }
          pendingStress = 0;
          // ⚠ A word juncture relaxes the voice, never cuts it (else robot gaps), and
          // keeps prevP/prevCode so coarticulation crosses it.
          wordScale = sylScale(sylFrom(phon, i + 1));
          const junctureOnly = code === '_';
          voiced.gain.setTargetAtTime(junctureOnly ? 0.45 : 0, t, junctureOnly ? 0.012 : 0.02);
          // tapered like a final fricative, or it sighs across the boundary
          noiseG.gain.setTargetAtTime(0, t, 0.02 * TUNING.finalTaper ** 2);
          aspG.gain.setTargetAtTime(0, t, 0.02 * TUNING.finalTaper ** 2);
          nzero.gain.setTargetAtTime(0, t, 0.02);
          // ⚠ `dur` is already speed-adjusted: don't divide again.
          t += dur;
        }
        prevNasal = p.t === 'N';
        if (code !== '_') { prevP = p; prevCode = code; }
      }
      const end = t + 0.08;
      // `est` lets a gate hold the two timing callers to each other
      if (trace) trace.push({ p: 'END', at: t - t0, est: estimateDuration(phon, speed, undefined, D) - 0.08 });
      voiced.gain.setTargetAtTime(0, end, 0.02);
      if (creakP) creakP.setTargetAtTime(0, end + 0.05, 0.02);
      // Noise cuts fast at the end; a fade would be a whisper.
      noiseG.gain.setTargetAtTime(0, end, 0.02 * TUNING.finalTaper ** 2);
      aspG.gain.setTargetAtTime(0, end, 0.02 * TUNING.finalTaper ** 2);
      // Terminal contour as a target (re-anchoring erases the contour); a question rises.
      const lastK = phraseK[phraseK.length - 1] ?? 1;
      glot.frequency.setTargetAtTime(
        pq(rise ? F0 * lastK * (1 + lilt * 1.9) : F0 * lastK * (1 - V.decl * D.decl * nat) * mix(trail ? 0.88 : 0.94)),
        Math.max(t0, end - 0.18), 0.06);
      // Statement-final creak; not on questions, floored above a growl.
      const creak = TUNING.creak * D.creak * nat;
      if (!rise && creak > 0) {
        const cf = Math.max(0.55, 1 - 0.30 * creak);
        // ⚠ Carry the trail factor through, or creak erases the terminal contour.
        // see docs/systems-procedural-audio.md#creak-was-erasing-the-terminal-contour
        glot.frequency.setTargetAtTime(pq(F0 * lastK * cf * (trail ? 0.94 : 1)), Math.max(t0, end - 0.07), 0.035);
        // roughen the flutter (the waver stays off: alone it's vibrato)
        const cj = Math.max(t0, end - 0.07);
        jitG.gain.setTargetAtTime(F0 * V.jitter * JIT_K * D.jitter * (1 + 4 * creak), cj, 0.03);
      }
      const src = [glot, nz, lfo, jit, jit2, shim];
      if (growlOsc) src.push(growlOsc);
      if (growl2Osc) src.push(growl2Osc);
      if (rmodOsc) src.push(rmodOsc);
      src.forEach(n => n.start(t0, n._off || 0));
      src.forEach(n => n.stop(end+0.1));
      // Worklet handoff: sample the recorders into tracks.
      if (wk) {
        const frames = Math.ceil((end + 0.1 - t0) / WK.frame) + 1, NP = WK_TRACK.length;
        const tracks = new Float32Array(frames * NP);
        const P = {
          f0: glot.frequency, jitA: jitG.gain, jitB: jit2G.gain, av: voiced.gain, ah: aspG.gain, af: noiseG.gain,
          f1: forms[0].frequency, f2: forms[1].frequency, f3: forms[2].frequency, f4: forms[3].frequency,
          q1: forms[0].Q, q2: forms[1].Q, q3: forms[2].Q, q4: forms[3].Q,
          nf: nbp.frequency, nq: nbp.Q, nzf: nzero.frequency, nzdb: nzero.gain, tilt: tilt.frequency, closure,
          rd: tense, creak: creakP,
        };
        WK_TRACK.forEach((key, col) => P[key].sample(t0, frames, WK.frame, tracks, col, NP));
        const node = new global.AudioWorkletNode(c, 'oracle-voice', { numberOfInputs: 0, numberOfOutputs: 1,
          outputChannelCount: [1], processorOptions: { seed: (hashName(String(opt.seed || text)) >>> 0) || 1 } });
        const lineStats = opt.stats && typeof opt.stats === 'object' ? opt.stats : null;
        node.port.onmessage = (e) => {
          if (e.data?.type === 'error') console.error('[voice] worklet:', e.data.error);
          else if (e.data?.type === 'done' && lineStats) Object.assign(lineStats, e.data);
        };
        node.port.postMessage({ type: 'line', names: WK_TRACK, frames, frame: WK.frame, t0, tracks, k: {
          ...WK, f0: F0, fshift, oq: Math.max(0.4, Math.min(0.85, V.oq + D.oq * nat)), natural: nat, buzz: buzzAmt, rd0,
          growl: growlAmt, growlRatio: V.growlRatio ?? 0.5, growl2: growlAmt > 0 ? (V.growl2 || 0) : 0, growl2Ratio: V.growl2Ratio ?? 1.5,
          lpA: 1 - Math.exp(-2 * Math.PI * 9000 / c.sampleRate),
        } }, [tracks.buffer]);
        node.connect(master);
        // cancel() stops a line by calling stop() with no time; the line ends itself.
        src.length = 0;
        src.push(lfo, ...(rmodOsc ? [rmodOsc] : []), { stop: (when) => { if (when !== undefined) return; node.port.postMessage({ type: 'stop' }); try { node.disconnect(); } catch { /* gone */ } } });
      }
      if (opt.tap && typeof opt.tap.connect === 'function') master.connect(opt.tap);
      // Ducks for the line: TV under Read Aloud, plus `duck` ({ buses, dB } or a list at -9 dB).
      const hold = Math.max(0, end - t0);
      const ducks = [];
      if (ui) ducks.push(readerDuck({ at: t0, hold }));
      if (opt.duck) {
        const d = Array.isArray(opt.duck) || typeof opt.duck === 'string' ? { buses: opt.duck } : opt.duck;
        ducks.push(duck(d.buses || [], d.dB ?? -9, { at: t0, hold, attack: d.attack ?? 0.05, release: d.release ?? 0.4 }));
      }
      chan.lines.push({ src, end: end + 0.1, duck: ducks.length ? { release: () => ducks.forEach(h => h.release()) } : null });
      // The real scheduled length; `delay` is a queued line's wait.
      return { duration: end - t0, delay: t0 - c.currentTime, channel: chName, backend: wk ? 'worklet' : 'graph' };
    }

    // Voice Lab debug: the phoneme run a line produces. Side-effect free.
    const phonemesFor = (text, opt = {}) => {
      _lex = opt.lex || null;
      if (opt.voice && opt.voice.vs) text = readMatchups(text);
      try {
        let ph = applyAssimilation(applyAccent(textToPhonemes(text), opt.accent));
        if (opt.accent !== 'rp') ph = applyFlap(ph);
        if (Math.max(-1, Math.min(1, (+opt.excite || 0) * TUNING.excitement)) >= 0.35) ph = soldNucleus(ph);
        // opt.marks keeps the '+' nucleus marks
        return opt.marks ? ph : ph.filter(p => p !== '+');
      } finally { _lex = null; }
    };
    return { speak, cancel, left, readerDuck, tuning: TUNING, phonemesFor, estimate: estimateDuration, voiceFor: voiceFromName, phones: () => Object.keys(PH),
      wk: WK, loadWorklet: loadOracleWorklet, setWorkletUrl: (u) => { _wkUrl = u || ''; } };
  })();

  global.AudioEngine = {
    init, onUnlock, applyVolumeSettings, setMonoAudio,
    playSfx, lastSfxAt, playSample, clearSampleCache,
    renderSfx, renderSong, wavBytes,
    MOD_TARGETS,
    // the drive/fold curves, for the Rack's displays
    shaperCurve: (kind, amount, type) => (kind === 'fold' ? foldCurve(amount) : driveCurveOf(amount, type)),
    retroReady: () => (ctx ? _retroState.get(ctx) === true : false),
    _setRetroUrl: (url) => { _retroUrl = url || ''; },
    // retro stage for a live synth; `retro.ref` is its full scale
    retroInsert: (c, retro, dest) => retroStage(c, retro || {}, {}, dest),
    loadRetro,
    loopSound, stopLoop, setLoopGain, duckLoop, setEcho,
    playMusic, stopMusic, stopMusicOwnedBy, pauseMusic, resumeMusic, queueMusic, fadeTo, crossFade, setLayerWeight,
    stop,
    noteToFreq,
    // Named spaces: plugins/audio owns the world's vocabulary, never this file.
    setSpace,
    setRoom,
    spaceNames: () => Object.keys(SPACES),
    duck,
    setTvBalance,
    // For the test proving Read Aloud's bus has no reverb send.
    _speechBus: () => { ensureContext(); return busFor('ui'); },
    _voiceStats: () => ({ ...vstat, size: MAX_VOICES, live: voices.filter(Boolean).length, priorities: voices.filter(Boolean).map((v) => v.priority) }),
    speak: (text, opt) => Speech.speak(text, opt),
    // no channel stops all; 'ui' only Read Aloud
    cancelSpeech: (channel) => Speech.cancel(channel),
    speechLeft: (channel) => Speech.left(channel),
    readerDuck: (opts) => Speech.readerDuck(opts),
    // live TUNING (Voice Lab; tv.js reads lineGapMs)
    voiceTuning: Speech.tuning,
    // the voice worklet back end (prototype)
    loadVoiceWorklet: () => Speech.loadWorklet(),
    voiceWorkletTuning: Speech.wk,
    _setVoiceWorkletUrl: (url) => Speech.setWorkletUrl(url),
    _phonemesFor: (text, opt) => Speech.phonemesFor(text, opt),
    // for the gate on voiceFromName's draw ORDER
    _voiceFor: (name) => Speech.voiceFor(name),
    // headless pacing check against broadcast's hold
    _estimateDuration: (phon, speed, shout) => Speech.estimate(phon, speed, shout),
    // an unknown phone is skipped silently on air, so content is checked against this
    _phones: () => Speech.phones(),
    // context, bus (by category, ambient default) and shared noise for a custom synth
    engineNodes: (category) => { const c = ensureContext(); if (!c) return null; return { ctx: c, bus: busFor(category || 'ambient'), noise: getNoiseBuffer() }; },
    // 3D for GLASS seats; playSfx, playSample and loopSound take `position`.
    setListenerPose, moveLoop, loopState,
    setSpatialAudio: (mode) => { _settings.spatialAudio = SPATIAL_MODES.includes(mode) ? mode : 'auto'; },
    spatialModes: () => SPATIAL_MODES.slice(),
    _spatialStats: () => ({ live: _spatial.size, hrtf: _hrtfLive, cap: hrtfCap(), mode: spatialMode(), listener: { ..._listener } }),
    // read-only views for the audio gates
    _graph: () => {
      ensureContext();
      return {
        master: masterGain, limiter: _limiter, limitTrim: _limitTrim, limit: { ...LIMIT, makeup: LIMIT_MAKEUP },
        buses, tvVoice: tvVoiceGain, tvFx: tvFxGain, reverbSend, reverbNode,
        space: _space, zoneSpace: _zoneSpace, roomOverride: _roomOverride,
        sourceRooms: _sourceRooms, sourceRoomCap: SOURCE_ROOM_CAP,
      };
    },
    _noiseBuffer: (colour) => { ensureContext(); return noiseBuffer(colour); },
    _impulse: (name) => { ensureContext(); return impulseFor(name); },
  };

})(typeof window !== 'undefined' ? window : globalThis);
