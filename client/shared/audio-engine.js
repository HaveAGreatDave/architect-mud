/**
 * SIREN — Sources, Index, Resonance, Envelopes & Noise.
 *
 * The synthesizer. Real Web Audio API playback — music, SFX, ambience —
 * synthesized entirely in-browser, no samples. Wholly separate from the
 * text-based "Sound" system (server/engine/sounds.js); never merge the two.
 *
 * `Index` is the FM modulation index, the parameter the whole synth turns on.
 *
 * ⚠ GREPPING FOR "SIREN" IS USELESS HERE. The word is already a domain noun in
 * this game — the emergency siren, the dive siren, the cockpit warnings — with
 * ~26 case-sensitive hits in plugins/emergency, plugins/flight, esp.js and
 * engine-audio.js, none of which have anything to do with the synth. Like THOMAS,
 * this names a system and never an identifier: the code's own vocabulary is
 * buildLayer, layer.fm, voices and busFor.
 *
 * ⚠ ORACLE, the formant VOICE, lives further down this file and does NOT use
 * SIREN's layer builder. It shares driveCurve, the noise buffer, the resonator
 * bank and the buses, then builds its own node graph — it never calls buildLayer.
 * An FM feature added here does not reach the voice, and the reverse.
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
  let masterGain, musicGain, sfxGain, ambientGain, tvGain, uiGain;
  let _noiseBuffer = null;
  let _settings = { enabled: true, music: true, sfx: true, tv: true, masterVolume: 0.40, musicVolume: 0.7, sfxVolume: 0.9, ambientVolume: 0.3, tvVolume: 0.6, muteWhenHidden: true };
  let _hiddenDucked = false;
  let _monoNode = null, _mono = false;
  let echoNodes = null; // global master-bus echo send (weed) — { wet, delay, fb }

  // ── The limiter ────────────────────────────────────────────────────────────
  // A DynamicsCompressor set as a brickwall: nothing above about -1 dBFS gets
  // through, so a roaring crowd, fireworks and a shout landing together are
  // squeezed rather than clipped.
  //
  // The compressor adds its own makeup gain, which the spec fixes as
  // (1 / fullRangeGain) ^ 0.6, where fullRangeGain is the curve's output for a
  // full-scale input. Left alone that makes every cue in the game about 0.6 dB
  // louder, so a trim after it takes the makeup back off. Below the threshold
  // the chain is then unity and the mix is the one that shipped before.
  const LIMIT = { threshold: -1, knee: 0, ratio: 20, attack: 0.001, release: 0.1 };
  const LIMIT_FULL_RANGE_DB = LIMIT.threshold + (0 - LIMIT.threshold) / LIMIT.ratio;
  const LIMIT_MAKEUP = Math.pow(1 / Math.pow(10, LIMIT_FULL_RANGE_DB / 20), 0.6);
  let _limiter = null, _limitTrim = null;

  // ── Buses ──────────────────────────────────────────────────────────────────
  // Each bus is a slider gain (the player's volume, set by _applyGains) and a
  // duck gain after it (set by duck(), never by _applyGains, so neither can
  // overwrite the other). The reverb send taps the duck's output, so a ducked
  // bus ducks its reverb too.
  //
  // A cue with its own reverb `send` can't use the bus's shared send, so it
  // enters a second copy of the chain with no send on it (`dry`) and a third
  // that feeds only the reverb (`wet`). The copies are made on first use and
  // their slider and duck gains are written alongside the originals, so a
  // volume change or a duck reaches all three.
  const BUS_NAMES = ['music', 'sfx', 'ambient', 'tv', 'ui'];
  // The reverb send each bus carries. Music and ui are dry: a song isn't in the
  // room with you, and Read Aloud on ui has to be understood. See buildReverb.
  const BUS_SEND = { sfx: 1, ambient: 1, tv: 0.45 };
  const buses = {};   // name -> { slider: [GainNode], duck: [GainNode], paths: {} }

  // The tv bus has two sub-gains, voice and effects, so a broadcast can sit its
  // effects a fixed number of dB under its voice inside the one TV slider. Both
  // default to unity; setTvBalance moves them. Category 'tv' still goes straight
  // to the bus, as it always has.
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
    // Mono downmix sits between the limiter and the speakers, so it catches
    // every category (music, sfx, ambient, tv) and every panner upstream of it.
    // A GainNode with an explicit single channel IS the downmix — WebAudio sums
    // L+R on the way in, and the destination spreads the one channel back to
    // both outputs, so the mix is centred rather than half-silent.
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
    // the retro stage's worklet, loaded now so it's ready long before a cue asks for it
    loadRetro(ctx);
    return ctx;
  }

  // Keep a broadcast's effects `fxDb` under its voice (and the voice at
  // `voiceDb`), inside the one TV slider. 0 and 0 is the mix as it shipped.
  function setTvBalance({ voiceDb = 0, fxDb = 0 } = {}) {
    _tvBalance.voice = dbToGain(voiceDb);
    _tvBalance.fx = dbToGain(fxDb);
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const k of ['voice', 'fx']) for (const g of _tvSubs[k]) g.gain.setTargetAtTime(_tvBalance[k], t, 0.02);
  }

  const dbToGain = (db) => Math.pow(10, (db || 0) / 20);

  // ── Ducking ────────────────────────────────────────────────────────────────
  //
  //   const h = duck(['sfx', 'ambient'], -9, { attack: 0.05, hold: 2, release: 0.4 });
  //
  // Pulls the named buses down by `dB` and brings them back. With `hold` the
  // duck ends by itself after attack + hold; without it the duck stays until
  // h.release() (natural Read Aloud uses that, from its utterance's start and
  // end events). `at` starts it later, in context time; speak() uses that for
  // a queued line.
  //
  // Ducks overlap: each bus keeps a list of holds and always sits at the
  // deepest one active. The whole schedule is written as AudioParam events
  // from the holds, so nothing here waits on a timer, and a gate can read it.
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
    // Where the duck sits just before now, worked out from the holds rather than
    // read off the param: a hold released this instant still counts here, and
    // its release time is the one the way back up uses.
    const before = levelAt(b.holds, now - 1e-6);
    b.holds = b.holds.filter(h => h.end > now);
    const pts = [...new Set([now, ...b.holds.map(h => Math.max(now, h.start)), ...b.holds.map(h => h.end).filter(Number.isFinite)])]
      .sort((a, z) => a - z);
    for (const g of b.duck) {
      const p = g.gain;
      // No anchor value: a target already running keeps running from wherever
      // it has got to, and the new targets below carry on from there.
      p.cancelScheduledValues(now);
      let prev = before.lvl, prevWin = before.win;
      for (const t of pts) {
        const { lvl, win } = levelAt(b.holds, t);
        if (Math.abs(lvl - prev) > 1e-6) {
          // Going down takes the new hold's attack; coming back up takes the
          // release of the hold that just let go.
          const tc = lvl < prev ? (win?.attack ?? 0.05) : (prevWin?.release ?? 0.4);
          p.setTargetAtTime(lvl, t, tc / 3);
        }
        prev = lvl; prevWin = win || prevWin;
      }
    }
  }


  // ── The room (reverb) ──────────────────────────────────────────────────────
  //
  // Until this there was no reverb of any kind, so a stone church, a storm
  // drain, a shipping container and the open waste all sounded identical: every
  // sound happened AT the listener rather than somewhere. `echo` is a delay
  // line, which is a repeat, not a space.
  //
  // A SEND, not an insert, and only from sfx + ambient. The dry path is
  // untouched, so a space with wet 0 is byte-for-byte the mix that shipped
  // before this existed — which is what makes it safe to turn on everywhere at
  // once. Music and TV stay dry deliberately: a song is not in the room with
  // you, and a television is a speaker whose own room reverb is already baked
  // into whatever it is playing.
  //
  // The impulse responses are GENERATED, not sampled. Decaying noise with a
  // one-pole damping filter is a crude reverb and an entirely convincing one at
  // this scale, and it keeps the promise the rest of the engine makes: no
  // assets, nothing to download, nothing to keep in a repo.
  let reverbNode = null, reverbSend = null, _space = null;
  const _irCache = new Map();

  // seconds — how long the tail runs · damp — 0..1, how fast the top end dies
  // (a stone room is bright, a carpeted one is dead) · pre — pre-delay in ms,
  // which is what the ear reads as SIZE rather than as wetness · wet — send level.
  const SPACES = {
    // Outdoors. Not silence: even open ground returns something off the dirt, and
    // a hard zero here is what makes a game sound like it is in a vacuum.
    outdoor:  { seconds: 0.30, damp: 0.75, pre: 2,  wet: 0.05 },
    // A street between buildings. Short, hard, and mostly one early reflection.
    street:   { seconds: 0.55, damp: 0.55, pre: 9,  wet: 0.11 },
    // An ordinary interior with soft furnishings in it.
    room:     { seconds: 0.45, damp: 0.80, pre: 5,  wet: 0.14 },
    // Bare hard interior — tile, concrete, a shop floor.
    hall:     { seconds: 1.30, damp: 0.35, pre: 14, wet: 0.22 },
    // Stone. Long, bright, and the reason St Garneau's needed this at all.
    stone:    { seconds: 2.60, damp: 0.22, pre: 20, wet: 0.30 },
    // Under the city. Long AND dark, which is a different thing from long.
    tunnel:   { seconds: 2.10, damp: 0.88, pre: 11, wet: 0.34 },
    // Inside metal. Short, extremely bright, faintly horrible.
    metal:    { seconds: 0.70, damp: 0.10, pre: 4,  wet: 0.26 },
    // An open-air ballpark. Little tail, because there's no roof, but a
    // slap-back off the stands about 120 ms later, a little later in one ear
    // than the other. `slap` is that one reflection: ms after the sound, its
    // level against the tail's peak, and the extra ms the right ear waits.
    ballpark: { seconds: 0.18, damp: 0.60, pre: 3,  wet: 0.16, slap: { ms: 120, level: 1.0, spread: 7 } },
  };

  function buildReverb() {
    reverbNode = ctx.createConvolver();
    reverbSend = ctx.createGain();
    reverbSend.gain.value = 0;
    // From each bus's DUCK output, so a ducked bus ducks its reverb too.
    buses.sfx.duck[0].connect(reverbSend);
    buses.ambient.duck[0].connect(reverbSend);
    // A TELEVISION IS A SPEAKER STANDING IN YOUR ROOM. This was left dry on the
    // reasoning that a broadcast's own room reverb is already baked into what it
    // plays — which is half right and the wrong half to act on: the studio
    // ambience is baked in, and then the speaker is still in a room with you.
    //
    // At a reduced level, because it is one box against a wall rather than a
    // sound happening everywhere in the room, and because the baked-in half is
    // already there and doubling it reads as a cathedral.
    //
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
    // A slap-back is a short burst, not a click: about 20 ms of damped noise,
    // so it reads as a wall of seats rather than as a fault in the impulse.
    const slapLen = Math.floor(sr * 0.02);
    const slapAt = s.slap ? Math.floor(sr * ((s.slap.ms + (s.slap.spread || 0)) / 1000)) + slapLen : 0;
    const buf = ctx.createBuffer(2, Math.max(len + pre, slapAt), sr);
    // Per channel, and with its own noise: two identical channels is a mono
    // reverb wearing a stereo buffer, and the whole point of a room is that the
    // two ears do not hear the same thing.
    //
    // Seeded from the room's name, so a room is the same room on every load and
    // the space gate reads one fixed impulse rather than a fresh draw.
    let seed = 0x9E37;
    for (let i = 0; i < name.length; i++) seed = Math.imul(seed ^ name.charCodeAt(i), 16777619);
    const rand = _rng(seed);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      const damp = 1 - s.damp;   // one-pole coefficient: lower damp = darker tail
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // Exponential, not linear. A linear fade reads as a gate closing.
        const env = Math.pow(1 - t, 2.2);
        lp += damp * ((rand() * 2 - 1) - lp);
        d[pre + i] = lp * env;
      }
      if (s.slap) {
        // Scaled against the tail's own peak, so `level` means the same thing
        // whatever the damping did to the noise.
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

  // Swap the room. `instant` is for boot; everything else crossfades, because a
  // reverb tail that changes character in one frame is a click.
  //
  // Two callers can pick the room. The server picks one from the listener's
  // zone (audio_space → setSpace). A view can pick one by name with setRoom —
  // the 3-D ballpark says 'ballpark' while it's open — and that wins over the
  // zone until setRoom(null) hands the room back to the zone.
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
    // The buffer swap is not ramped — it cannot be — so the send is ducked
    // through it. The old tail is discarded rather than crossfaded, which is
    // audible only if you change rooms mid-explosion.
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

  // SEEDED, so a cue renders the same samples every time: a WAV exported for listening and a
  // check that reads samples (scripts/audio/hockey-smoke.mjs) have to be reproducible, and
  // Math.random was the one thing in a cue that wasn't. It's the same white noise as before.
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

  // ── The retro stage: sample-and-hold and bit depth, per cue ────────────────
  //
  // A cue with `config.retro: { rate, bits }` goes through it on its way to the bus. `rate`
  // holds each sample for 1/rate of a second, the way a cartridge's 8–16 kHz samples
  // stepped (the steps are the grit; nothing smooths them), and `bits` rounds what's held
  // to that many bits. Both are relative to the cue's own full scale (`ref`, by default the
  // sum of its layers' peak levels), so 8 bits means a normalised 8-bit sample played at the
  // cue's volume, and a quiet tail gets grittier as it decays, as one did.
  //
  // The engine's output rate never changes: this colours one cue. The hold needs an
  // AudioWorklet (audio-retro-worklet.js, loaded from beside this file once per context);
  // until it's loaded, or where there are no worklets, bits alone go through a WaveShaper
  // staircase and the hold is skipped, so a cue never goes silent for want of it.
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
    // 8,192 points so each step is many points wide: a WaveShaper interpolates between
    // points, and a curve as coarse as its own steps would be a slope, not a staircase.
    const n = 8192, q = Math.pow(2, b - 1);
    c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = (x >= 0 ? Math.floor(x * q + 0.5) : -Math.floor(-x * q + 0.5)) / q; }
    _stairCurves.set(b, c);
    return c;
  }
  // Builds the stage into `dest` and hands back what the cue's layers connect to. `until` is
  // when the cue ends (context time): the worklet stays up till then, even across a gap
  // between its layers.
  function retroStage(c, retro, config, dest, until) {
    const rate = +retro.rate || 0, bits = +retro.bits || 0;
    if (!(rate > 0 || bits > 0)) return dest;
    const layers = Array.isArray(config.layers) && config.layers.length ? config.layers : [config];
    // (a driven layer comes out of its clipper louder than its gain: tanh's own level, at the
    // drive driveCurve rounds to)
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

  // ── Noise for layers: three colours, stereo, eight seconds ────────────────
  //
  // The buffer above is two seconds of mono white, played from its first
  // sample by every noise layer that used it. So two noise layers in one cue
  // were the SAME noise, and summing them phased (a comb, not a thicker hiss),
  // and a long bed repeated every two seconds. It stays for engineNodes(),
  // whose custom synths were built against it.
  //
  // Layers now get eight seconds per channel, in white, pink (-3 dB/octave)
  // or brown (-6 dB/octave above about 150 Hz), each made once on first use.
  // Every colour is normalised to white's RMS, so picking a colour changes the
  // tone and not the level. The last 50 ms are crossfaded into the first, so
  // the loop has no seam, which brown noise would otherwise click on.
  //
  // Each noise layer starts at its own offset into the buffer, drawn from a
  // seeded generator. That's what ends the phasing. `noiseSeed` pins a layer's
  // offset when a cue has to sound the same every time.
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
      // Equal-power crossfade of the run past the end into the start, so
      // sample n-1 flows into sample 0 exactly as it would have into sample n.
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
    const level = {
      music: _settings.music ? _settings.musicVolume : 0,
      sfx: _settings.sfx ? _settings.sfxVolume : 0,
      ambient: _settings.ambientVolume ?? 0.5,
      tv: _settings.tv ? _settings.tvVolume : 0,
      // Follows the sfx slider — it is a game sound — but never the sfx routing.
      ui: _settings.sfx ? _settings.sfxVolume : 0,
    };
    // Only the slider gains. The duck gains after them belong to duck().
    for (const name of BUS_NAMES) for (const g of buses[name].slider) g.gain.setTargetAtTime(level[name], t, 0.02);
  }

  function applyVolumeSettings(settings) {
    _settings = { ..._settings, ...(settings || {}) };
    if (ctx) _applyGains();
  }

  // Called from applySettings on every settings change, which is usually BEFORE
  // the first user gesture has created the context — so remember the choice and
  // let ensureContext() wire it when the graph is actually built.
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

  // Where a cue goes when it carries its own reverb `send`: into the bus's dry
  // copy, and through a gain of `send` into its wet copy. Without one, it's the
  // bus itself and the bus's own send, exactly as before.
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
    // ⚠ THE ACCESSIBILITY BUS, AND IT MUST STAY DRY. Read Aloud speaks through
    // `channel: 'ui'`, which routed to the sfx bus — and the moment the sfx bus
    // grew a reverb send, a player relying on the log reader heard their reader
    // reverberating in a stone church. Room ambience is a texture for the world;
    // on the one voice whose whole job is to be UNDERSTOOD it is damage.
    //
    // Same volume as sfx (it is a game sound, and the sfx slider should move it),
    // separate node so it can be routed past the send.
    if (category === 'ui') return uiGain;
    return sfxGain;
  }

  // ── Voice manager with priority stealing ──────────────────────────────────
  //
  // ⚠ THE POOL AND THE CHANNEL COUNT WERE THE SAME NUMBER, AND THAT IS A BUG,
  // not a budget. A tracker step allocates a voice PER CHANNEL, so a 16-channel
  // song could hold every slot in a 16-slot pool — and since songs and SFX both
  // default to priority 5, and stealing is allowed at equal priority, a dense
  // song and a fight then spent the whole time evicting each other. Nothing
  // reported it, because a stolen voice is not an error: it is a sound that did
  // not happen.
  //
  // 32 is not an aesthetic choice — 16 was, and it was borrowed from a console
  // whose voices were hardware. This is a pool of Web Audio node graphs, and the
  // constraint that actually exists is CPU, which sits nowhere near either
  // number. Priority stealing is unchanged and still does the real work.
  const MAX_VOICES = 32;
  const MAX_CHANNELS = 16; // tracker songs play at most 16 channels; extras are ignored
  const voices = new Array(MAX_VOICES).fill(null); // {priority, startedAt, stop()} | null

  // What the pool is actually doing. Counters rather than an estimate, because
  // the failure mode here is SILENT — a dropped cue and a cue that was never
  // requested are indistinguishable from the outside, so "is the pool big
  // enough?" was not a question anybody could answer. Read with _voiceStats().
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
  //          pitchBend:{to,time}, gain,
  //          fm:{ rate|ratio, rateTo|ratioTo, depth|index, depthTo|indexEnd,
  //               wave, time, op2:{ …the same keys again } } }
  // filter.to/.time sweep the cutoff exactly like pitchBend sweeps the pitch,
  // and fm.depthTo/.rateTo sweep the modulation index / modulator pitch the same
  // way — one {to, time} contract for every travelling parameter.
  // In every fm pair the RATIO form is relative to the note and the RATE form is
  // absolute Hz; see the long note at the fm block below for which to reach for.

  const OSC_WAVES = ['sine', 'square', 'sawtooth', 'triangle'];

  // ── ONE SOURCE, MANY RESONATORS, SUMMED ───────────────────────────────────
  //
  // The topology formant synthesis needs and a serial filter cannot express. A
  // layer's ordinary `filter` is one biquad in the signal path; this is N
  // bandpasses side by side, each fed the SAME source and mixed back together.
  //
  // The difference is not academic. Four serial filters are a narrower and
  // narrower band until nothing is left; four PARALLEL ones are four resonances
  // in one sound, which is what a vocal tract does and what makes a vowel a vowel.
  // Modelling it as four separate layers would give four independent oscillators —
  // four voices, not one voice through four resonators.
  //
  // ORACLE has always built this by hand for its formants. It is here so the
  // layer synth can have it too (`layer.formants`), and so there is ONE
  // implementation rather than a second one written from the same idea later.
  // Handles come back because ORACLE glides its bands across an utterance; a
  // static caller can ignore them.
  function buildResonatorBank(source, dest, bands) {
    const out = [];
    for (const b of bands) {
      const freq = typeof b === 'number' ? b : b.freq;
      if (!(freq > 0)) continue;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = freq;
      // A bandpass sharp enough to be physically correct starts to whistle on a
      // source with no breath noise to fill in between the harmonics, which is
      // why ORACLE clamps its own Q rather than deriving it freely.
      bp.Q.value = (typeof b === 'object' && b.q) || 6;
      const g = ctx.createGain();
      g.gain.value = (typeof b === 'object' && b.gain != null) ? b.gain : 1;
      source.connect(bp).connect(g).connect(dest);
      out.push({ filter: bp, gain: g });
    }
    return out;
  }

  // Waveshaper curves, cached by drive. A curve is a 2,048-float array and this
  // runs on the cue path — every layer of every sound — so building one per note
  // would allocate about 8 KB a footstep. Quantised to 0.05 because nobody can
  // hear the difference between drive 0.30 and 0.32, and it turns an unbounded
  // cache into twenty entries.
  // The five voices in procedural-sfx.js, as instrument rows a song can name.
  // Looked up lazily and cached: procedural-sfx is a sibling global that may load
  // after this file, so resolving at load time would bind undefined for ever.
  const _codeVoices = new Map();
  function codeVoice(name) {
    if (!name) return null;
    if (_codeVoices.has(name)) return _codeVoices.get(name);
    const cfg = global.ProceduralSFX?.voiceConfig?.(name) || null;
    const row = cfg ? { waveform: cfg.waveform, config: cfg } : null;
    _codeVoices.set(name, row);
    return row;
  }

  const _driveCurves = new Map();
  function driveCurve(amount) {
    const k = Math.round(Math.max(0, Math.min(1, amount)) * 20) / 20;
    let c = _driveCurves.get(k);
    if (c) return c;
    const n = 2048;
    c = new Float32Array(n);
    // tanh, normalised by its own output at full scale. Monotonic and symmetric,
    // so it clips rather than folding — a folding curve is a ring modulator with
    // extra steps and sounds like a fault rather than like overdrive.
    const g = 1 + k * 24;
    const norm = Math.tanh(g);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(x * g) / norm;
    }
    _driveCurves.set(k, c);
    return c;
  }

  // Filter types whose `gain` (dB) means something. Web Audio ignores gain on
  // the rest, and leaving it unset on them keeps their graphs as they were.
  const GAIN_FILTERS = new Set(['peaking', 'lowshelf', 'highshelf']);

  // ── MODS: patchable modulation ─────────────────────────────────────────────
  // `layer.mods` is a list of sources, each patched by its `to` list into any
  // parameter the layer built. Every LFO above this (vibrato, tremolo) is wired
  // to one target for good; a mod goes wherever it is patched, including into
  // another mod's rate or depth. The Rack in the dev panel's Audio tab is the
  // editor for it, and docs/amp-format.md has the format.
  //
  //   { id:'lfo1', type:'lfo', wave:'triangle', rate:3, fade:0.4, to:[{ param:'filter.cutoff', amount:1200 }] }
  //
  // Sources: `lfo` (bipolar, -1..1), `env` (unipolar 0..1 on its own a/d/s/r),
  // `rand` (bipolar sample-and-hold from a seed, `smooth` glides between steps).
  // Each target is in its own unit: cents for pitch, ratio and cutoff, index
  // units for the FM operators, seconds for echo time, 0..1 for the rest.
  //
  // A target whose stage the layer doesn't have is skipped, and a patch that
  // would close a loop between mods is dropped: Web Audio mutes a cycle with no
  // delay in it, so it would silence the mod rather than do anything.
  // A layer without `mods` builds exactly the graph it built before.
  const MOD_TYPES = new Set(['lfo', 'env', 'rand']);
  const MOD_TARGETS = ['pitch', 'fm.index', 'fm.ratio', 'op2.index', 'op2.ratio', 'filter.cutoff', 'filter.q',
    'amp', 'pan', 'echo.time', 'echo.feedback', 'noise.rate'];
  function modTargetSet(mods) {
    const s = new Set();
    for (const m of mods) for (const c of (Array.isArray(m?.to) ? m.to : [])) if (c?.param) s.add(c.param);
    return s;
  }
  // The patches that survive: known source types with ids, and mod->mod edges
  // that don't close a loop, taken in authored order so the first patch wins.
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
  // P maps a target name to [AudioParam, scale]; the cable's gain is amount * scale.
  // `span` is how long the note can last, for the random steps. Returns release hooks.
  function buildMods(mods, P, time, span, nodes) {
    const { byId, patches } = modPatches(mods);
    const out = new Map();      // id -> the source's depth gain, which every cable leaves from
    const releases = [];
    for (const m of byId.values()) {
      let src = null;
      if (m.type === 'lfo') {
        src = ctx.createOscillator();
        src.type = OSC_WAVES.includes(m.wave) ? m.wave : 'sine';
        src.frequency.setValueAtTime(Math.max(0, Number.isFinite(m.rate) ? m.rate : 2), time);
        P[`mod.${m.id}.rate`] = [src.frequency, 1];
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
      P[`mod.${m.id}.amount`] = [depth.gain, 1];
    }
    for (const p of patches) {
      const from = out.get(p.mod.id), target = P[p.param];
      if (!from || !target) continue;           // the layer has no such stage
      const cable = ctx.createGain();
      cable.gain.value = p.amount * target[1];
      from.connect(cable).connect(target[0]);
    }
    return releases;
  }

  function buildLayer(layer, destination, time, holdSeconds) {
    const nodes = [];
    if (layer.delay) time = time + layer.delay;
    const mods = Array.isArray(layer.mods) && layer.mods.length ? layer.mods : null;
    const P = mods ? Object.create(null) : null;   // mod targets, filled as each stage is built
    const wants = mods ? modTargetSet(mods) : null;
    // PAN, per layer: -1 is hard left, 1 hard right. Last in the chain, after
    // the echo, so a panned layer's echo comes from the same side. The cue-wide
    // `pan` option in playSfx still sits after this, for where the listener is.
    // A mod patched into `pan` gets a centred panner to move.
    if (((Number.isFinite(layer.pan) && layer.pan !== 0) || wants?.has('pan')) && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, layer.pan || 0));
      p.connect(destination);
      destination = p;
      if (P) P.pan = [p.pan, 1];
    }
    const adsr = layer.adsr || { a: 0.01, d: 0.05, s: 0.7, r: 0.15 };
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, time);
    let tone = null;
    const noiseMix = layer.noiseMix ?? (layer.waveform === 'noise' ? 1 : 0);

    if (noiseMix < 1) {
      tone = ctx.createOscillator();
      tone.type = OSC_WAVES.includes(layer.waveform) ? layer.waveform : 'square';
      const freq = layer.freq || 440;
      tone.frequency.setValueAtTime(freq, time);
      if (layer.detune) tone.detune.setValueAtTime(layer.detune, time);
      if (P) P.pitch = [tone.detune, 1];
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
      // depth is the frequency deviation in Hz.
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
      //
      // RATIO IS WHAT MAKES A LAYER AN INSTRUMENT, and `rate` alone can't be one.
      // `rate` is absolute Hz, which is right for an impact and wrong for a note:
      // the tracker plays ONE instrument config at every pitch, overriding `freq`
      // and nothing else, so an absolute modulator sits at the same Hz at C2 and
      // at C6 and the voice is a different instrument at each end of the keyboard.
      // `ratio` resolves against the carrier instead — modulator = freq × ratio —
      // so the spectrum scales with pitch and the voice keeps its identity.
      // Integer ratios are harmonic, non-integer go bell/metallic. This is what
      // note() in procedural-sfx.js was computing by hand, and the only reason a
      // piano lived outside the instrument table.
      //
      // `index` is the textbook modulation index — deviation ÷ MODULATOR freq —
      // which is the form that stays constant across pitch once ratio is fixed.
      // ⚠ It is NOT the quantity the old comment here called index (that one
      // divided by the carrier), and the two FM callers already disagreed about
      // which they meant: hockey-sfx.js divides by the modulator, note() divides
      // by the carrier. Neither is touched — `index` is the new spelling and it
      // means the modulator one, which is the standard.
      const fmc = layer.fm;
      if (fmc && (fmc.rate || fmc.ratio)) {
        const carrier = layer.freq || 440;
        const tc = Math.max(0.005, (fmc.time || 0.2) / 3);
        const modRate = fmc.ratio ? carrier * fmc.ratio : fmc.rate;
        const mod = ctx.createOscillator();
        // The modulator's own waveform. Sine is the classic and stays the default;
        // a square or saw modulator is an entirely different sideband family for
        // one line, and is most of how the cheap FM chips got their grit.
        mod.type = OSC_WAVES.includes(fmc.wave) ? fmc.wave : 'sine';
        mod.frequency.setValueAtTime(modRate, time);
        // A ratio-authored voice follows its own carrier through a pitch bend
        // without being told to, because holding the ratio through the bend is
        // what ratio MEANS — a modulator left behind at the old pitch turns a
        // bend into a detune. An explicit ratioTo/rateTo still wins.
        const modRateTo = fmc.ratioTo != null ? carrier * fmc.ratioTo
          : fmc.rateTo != null ? fmc.rateTo
          : (fmc.ratio && layer.pitchBend?.to) ? layer.pitchBend.to * fmc.ratio
          : null;
        if (modRateTo) mod.frequency.setTargetAtTime(modRateTo, time, tc);
        const modGain = ctx.createGain();
        // VELOCITY OPENS THE INDEX, not just the gain. Playing harder changing the
        // TIMBRE is most of what separates a piano from a keyboard, and until this
        // existed it lived only inside note() — so the five voices in the
        // INSTRUMENTS table had it and the 23 authored instruments in the DB could
        // not, whatever they were authored with. The tracker multiplies `vol` into
        // the gain and stopped there.
        //
        // `bright` is how far velocity moves the index; `velocity` is injected per
        // note by whoever is playing, the same way `freq` already is. Centred on
        // 0.5 so a mid-velocity note is the authored timbre and the table reads as
        // written. Only the ATTACK index is scaled — the sweep target is where the
        // note settles, and a hard note settles in the same place as a soft one.
        // Both absent is the whole of the previous behaviour.
        const vel = layer.velocity;
        const bright = (vel != null && fmc.bright) ? Math.max(0, 1 + (vel - 0.5) * fmc.bright) : 1;
        modGain.gain.setValueAtTime((fmc.index != null ? fmc.index * modRate : (fmc.depth ?? 100)) * bright, time);
        const depthTo = fmc.indexEnd != null ? fmc.indexEnd * (modRateTo || modRate) : fmc.depthTo;
        if (depthTo != null) modGain.gain.setTargetAtTime(depthTo, time, tc);
        // Operator 2, in SERIES: it modulates the MODULATOR, not the carrier. Two
        // sines into a carrier are just two partials; a stack is where FM stops
        // sounding like oscillators and starts sounding like a material, so series
        // buys far more per line than parallel would.
        //
        // Its ratio is against the NOTE, not against the operator below it — that
        // is how every FM instrument is specified, and a ratio-of-a-ratio compounds
        // into numbers nobody can author.
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
          if (P) { P['op2.index'] = [g2.gain, r2]; P['op2.ratio'] = [m2.detune, 1]; }
          m2.start(time);
          nodes.push(m2);
        }
        mod.connect(modGain).connect(tone.frequency);
        if (P) { P['fm.index'] = [modGain.gain, modRate]; P['fm.ratio'] = [mod.detune, 1]; }
        mod.start(time);
        nodes.push(mod);
      }
    }

    let noiseSrc = null;
    if (noiseMix > 0) {
      noiseSrc = ctx.createBufferSource();
      noiseSrc.buffer = noiseBuffer(layer.noise);
      noiseSrc.loop = true;
      // `noiseRate` plays it slower or faster: below 1 it's darker, the way hiss sampled at a
      // low rate was, and two beds at different rates don't repeat together
      if (layer.noiseRate > 0) noiseSrc.playbackRate.value = layer.noiseRate;
      if (P) P['noise.rate'] = [noiseSrc.playbackRate, 1];
    }

    let mixPoint = gain;

    // ── Drive ────────────────────────────────────────────────────────────────
    // Soft-clipping distortion, 0..1. Nothing in this game could sound BROKEN
    // before — overdriven, clipped, blown — which is an odd hole in an engine
    // for a world built out of failing hardware.
    //
    // Placed AFTER the envelope and BEFORE the filter, which is the order that
    // makes it behave like an amplifier rather than an effect: the ADSR drives
    // the clipper, so a hard attack is dirtier than the tail all by itself, and
    // the filter then cleans up the harmonics the clipper just created instead
    // of being distorted itself.
    //
    // The curve is normalised through tanh's own output, so raising drive adds
    // harmonics WITHOUT adding level — a distortion control that is also a
    // volume control is one nobody can use.
    if (layer.drive > 0) {
      const shaper = ctx.createWaveShaper();
      shaper.curve = driveCurve(layer.drive);
      shaper.oversample = '4x';   // the clipper makes harmonics above Nyquist; fold them back
      mixPoint.connect(shaper);
      mixPoint = shaper;
    }

    // FORMANTS — a parallel resonator bank instead of the single filter, using
    // the same primitive ORACLE builds its vowels from. This is the one thing the
    // layer synth genuinely could not do: give a synthesised sound the shape of a
    // throat, so a pad can sit somewhere between an instrument and a vowel.
    // `[700, 1220, 2600]` is roughly an /ɑ/; move F1 and F2 and you move the vowel.
    // Takes bare numbers or {freq, q, gain}, and overrides `filter` when present.
    if (Array.isArray(layer.formants) && layer.formants.length) {
      const sum = ctx.createGain();
      buildResonatorBank(mixPoint, sum, layer.formants);
      mixPoint = sum;
    } else if (layer.filter) {
      const filter = ctx.createBiquadFilter();
      filter.type = layer.filter.type || 'lowpass';
      filter.Q.value = layer.filter.q ?? 1;
      filter.frequency.setValueAtTime(layer.filter.freq || 4000, time);
      // Boost or cut in dB, for the peaking and shelf types. This was never
      // read, so a peaking filter was a flat line and a shelf did nothing.
      if (GAIN_FILTERS.has(filter.type) && Number.isFinite(layer.filter.gain)) {
        filter.gain.setValueAtTime(layer.filter.gain, time);
      }
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
      // ⚠ mixPoint, not `gain` — the drive stage above may already sit between
      // them, and a hardcoded `gain.connect(filter)` here would route around it,
      // leaving a driven layer sounding exactly like an undriven one.
      mixPoint.connect(filter);
      mixPoint = filter;
      // cutoff moves on detune, in cents, so a mod's depth is the same interval at any cutoff
      if (P) { P['filter.cutoff'] = [filter.detune, 1]; P['filter.q'] = [filter.Q, 1]; }
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

    // A gain stage for a mod patched into `amp`, built only when one is: depth 1
    // swings the layer between silence and double, as tremolo does.
    if (wants?.has('amp')) {
      const aGain = ctx.createGain();
      aGain.gain.value = 1;
      mixPoint.connect(aGain);
      mixPoint = aGain;
      P.amp = [aGain.gain, 1];
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
      if (P) {
        P['echo.time'] = [delayNode.delayTime, 1];
        // feedback past 1 runs away, so a depth of 1 is all the room left under 0.95
        P['echo.feedback'] = [fb.gain, Math.max(0, 0.95 - fb.gain.value)];
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
    }
    if (noiseSrc) {
      const noiseGain = ctx.createGain();
      noiseGain.gain.value = noiseMix;
      // The buffer is stereo. A layer takes its left channel alone, which is
      // mono noise at the level it always had. `width` (0..1) blends the right
      // ear over to the other, uncorrelated channel with an equal-power law, so
      // width 1 is fully decorrelated stereo at the same loudness.
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

    // Every stage is built and registered, so the mods can be patched into them.
    // A held note's random steps run to the 30 s cap playSfx releases it at.
    const span = holdSeconds != null
      ? (layer.adsr?.a ?? 0.01) + (layer.adsr?.d ?? 0.05) + holdSeconds + (layer.adsr?.r ?? 0.15)
      : 30;
    const modReleases = mods ? buildMods(mods, P, time, span, nodes) : null;

    // ADSR. `curve: 'exp'` decays and releases exponentially (exp(-t/τ), τ = d/3, so after
    // `d` it's 5% of the way from peak to sustain), which is how a struck thing dies: a hard
    // transient and then a short tail, not a straight line to silence. The timing is the
    // linear envelope's: only the shape differs.
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

    // WHERE THE ENVELOPE ACTUALLY IS AT `t` — computed from the schedule above
    // rather than read off the AudioParam.
    //
    // This is what caused the phantom second sound. `release()` used to hold the
    // envelope with `setValueAtTime(gain.gain.value, t)`, but `.value` is the
    // param's value AT THE MOMENT OF THE CALL, and every release here is
    // SCHEDULED AT BUILD TIME — before the note has started, when the param is
    // still its untouched default of 1. So a cue that had already decayed to
    // silence had full gain pinned back onto it at release, then ramped down
    // over `r`. On a piano note that landed a couple of seconds after the strike,
    // with the FM index already collapsed to its sustain timbre: a quieter,
    // duller copy of the note you just played. An echo nobody wrote.
    //
    // Every one-shot with a hold — not just the instruments — was doing this.
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
        // down an exponential to -80 dB of where it was, then to zero: the last step is
        // inaudible, and the envelope ends rather than approaching zero for ever
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

  // `sustain: true` hands the note's ENDING to the caller and returns a handle to
  // end it with. Everything else here is a one-shot whose length is known when it
  // starts; a key held under a finger is not, and there was no way to express that.
  //
  // ⚠ It cannot be done by calling the returned handle on an ordinary playSfx.
  // buildLayer's `release()` latches on first call, and passing `holdSeconds`
  // CALLS it during build (synchronously, with a future time — it schedules the
  // ramp rather than waiting). So a normal cue is already released before playSfx
  // returns, and a later release() from a keyup would be silently ignored. The
  // sustain path exists to withhold that build-time call.
  // When a game cue last started, for the interface listener (client/game/js/ui-sound.js): a click
  // a panel already answered with its own cue gets no second one. Interface cues don't count.
  let _lastSfxAt = 0;
  function lastSfxAt() { return _lastSfxAt; }
  function playSfx(def, gainMultiplier = 1, opts = {}) {
    const c = init();
    if (!c || !def?.config) return null;
    if (def.category !== 'ui') _lastSfxAt = performance.now();
    const priority = def.priority ?? 5;
    const idx = allocateVoice(priority);
    if (idx === -1) return null; // dropped — all higher/equal-priority voices busy
    const time = c.currentTime;
    const duration = def.config.duration ?? 0.4;
    // `send` on the cue overrides its bus's reverb send (0 is fully dry, 1 is
    // what sfx and ambient carry). Absent, the bus decides, as it always has.
    let destination = cueBus(def.category, def.config.send ?? opts.send);
    // ── Where it came from ───────────────────────────────────────────────────
    // A sound reaching you from the next room already travelled a known route:
    // propagateAudio walks the exits, so the server knows which doorway it came
    // through and how many walls are in the way. All of that was thrown away at
    // the wire and every distant sound arrived dead centre at full bandwidth,
    // which is the one thing a wall never does.
    //
    // `pan` is that doorway and `muffle` is the walls. Both are ordinary send
    // options rather than layer keys, because they are a property of the
    // LISTENER'S position, not of the sound — the same cue is muffled for one
    // player and not for another, and a cue definition must never carry that.
    if (opts.muffle > 0) {
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      // Roughly an octave of top end per wall. Floored at 400Hz: past that a
      // sound stops being muffled and becomes a different sound.
      lp.frequency.value = Math.max(400, 12000 / Math.pow(2, Math.min(5, opts.muffle)));
      lp.Q.value = 0.5;
      lp.connect(destination);
      destination = lp;
    }
    if (opts.pan && c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, opts.pan));
      p.connect(destination);
      destination = p;
    }
    // `swell: { to, time }` ramps the cue's gain from gainMultiplier to `to` over `time` seconds,
    // for a held cue that builds the longer it is held (the Drake's quack).
    if (gainMultiplier !== 1 || opts.swell) {
      const g = c.createGain();
      g.gain.setValueAtTime(gainMultiplier, time);
      if (opts.swell) g.gain.linearRampToValueAtTime(opts.swell.to, time + Math.max(0.01, opts.swell.time));
      g.connect(destination);
      destination = g;
    }
    const sustain = opts.sustain === true;
    // (a cue with `retro` goes through the sample-and-hold and bit-depth stage first)
    const into = def.config.retro ? retroStage(c, def.config.retro, def.config, destination, time + duration + cueTail(def.config)) : destination;
    const sound = buildSound(def.config, into, time, sustain ? null : duration);
    const voiceToken = occupyVoice(idx, priority, () => sound.release(c.currentTime));
    // `duck` on the cue ducks other buses while it plays: a shout over a crowd
    // bed is { buses: ['ambient'], dB: -8 }. A one-shot holds it for its
    // duration; a held cue holds it until it's released.
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
        setTimeout(() => freeVoice(idx, voiceToken), (tail + 0.1) * 1000);
      };
      // A held voice whose release never arrives is a stuck note that outlives the
      // room, and a lost keyup is ordinary — an alt-tab, a focus change, a dropped
      // note-off from someone else's client. The cap is not tuning, it is the only
      // thing standing between a bug elsewhere and a drone nobody can silence.
      const capT = setTimeout(end, (opts.maxHold ?? 30) * 1000);
      return { release: end };
    }
    // Hold the slot for the longest layer's own release, not a flat default — the
    // per-layer adsr is where the release actually lives, so a long crowd swell was
    // freeing its slot roughly a second before it stopped being audible.
    const tail = Math.max(def.config.adsr?.r ?? 0,
      ...(def.config.layers || []).map(l => (l.delay ?? 0) + (l.adsr?.r ?? 0)), 0.15);
    setTimeout(() => freeVoice(idx, voiceToken), (duration + tail + 0.1) * 1000);
    return null;
  }

  // ── Offline render ─────────────────────────────────────────────────────────
  // One cue rendered into an AudioBuffer through the very graph playSfx builds (the layers,
  // the retro stage, the cue's gain), by the browser's own audio engine at the live rate:
  // for a WAV to listen to on other speakers, and for a check that reads samples rather
  // than schedules. The live context is swapped out only for the synchronous build, so
  // nothing playing is touched. `opts`: { seconds, sampleRate, gain }.
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
    // Loops default to the AMBIENT bus because nearly every one of them is a bed. Two deliberate
    // overrides: 'tv' (CRT hum/static answer to the TV Audio toggle) and 'sfx' — a held control
    // that happens to be implemented as a loop is still an EFFECT, and a truck's air horn following
    // the ambience slider would be a horn that gets quieter when you turn the wind down.
    const loopCat = def.category === 'tv' || def.category === 'tv_fx' ? def.category : def.category === 'sfx' ? 'sfx' : 'ambient';
    const sound = buildSound(def.config || {}, cueBus(loopCat, def.config?.send), time, null);
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
        //
        // An unknown instrument id falls back to the shared voice table, which is
        // what lets a song name `piano` or `rhodes` directly. Those five lived in
        // procedural-sfx.js and were reachable only by sitting at furniture; they
        // are ordinary configs now, so there is no reason a song cannot use one.
        const instrument = (def._instrumentsById && def._instrumentsById[step.instrument])
          || codeVoice(step.instrument)
          || {};
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
        // …and the same number again as VELOCITY, which reaches the timbre rather
        // than the level (see `fm.bright` in buildLayer). A step's vol was applied
        // to gain and nowhere else, which is why an authored instrument could not
        // do the one thing that makes a struck instrument sound struck.
        config.velocity = step.vol ?? 1;
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
  let activeOwner = null;

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
    // WHO asked for this song. There is one global music player — a zone theme, the
    // AMP player and a TV broadcast all share it — so a panel that wants to stop
    // "its" music on close must be able to tell whether it's still the one playing.
    // Absent for local/UI callers, which is why stopMusicOwnedBy never matches them.
    activeOwner = opts.owner ?? null;
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
    activeOwner = null;
    if (!activePlayer) return;
    activePlayer.stop();
    activePlayer = null;
  }

  // Stop the music ONLY if `owner` is the one who started what's currently playing.
  // Closing the TV must silence the show it was airing without cutting off the zone
  // theme or the player's own AMP tape, which live on this same single player.
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
        // Into the limiter, not past it: the echo adds to the peak, so it has to
        // be inside what the limiter holds down.
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

  // ── ORACLE — Orthography, Resonance, Accent, Cadence, Lexicon & Emphasis ────
  //
  // The voice. A formant speech synth: a glottal PeriodicWave through a
  // four-formant bank with a nasal antiformant, a separate noise path for
  // fricatives and stop bursts and a second one into the formants for aspiration
  // and breath, a 28k-word lexicon over letter-to-sound rules,
  // RP/GA accents, and prosody that falls at a full stop and rises at a question
  // mark. It reads broadcasts, the Architect, the library and Read Aloud. Its
  // tuning surface is the dev panel's Voice Lab tab.
  //
  // ⚠ ORACLE lives inside SIREN's file and does NOT use its layer builder — see the
  // header. It does share the resonator bank below, which is what its vowels are.
  //
  // Two stages: text→phoneme (dictionary + rules) and phoneme→formant synthesis.
  // Each narrator's name seeds a deterministic voice. Rides the 'tv' bus, so TV
  // volume, the tv-enable toggle, and mute-when-hidden already apply. Sounds like
  // a 1980s talking machine — intentional, for a machine-run broadcast network.
  const Speech = (function () {
    // ── Formant LOCI ─────────────────────────────────────────────────────────
    // The place of articulation of a consonant is heard almost entirely in what
    // it does to the formants of the vowel NEXT to it — the ear reads /b/ vs /d/
    // vs /g/ from which way F2 bends going in and coming out, not from the burst.
    // A noise-only obstruent (what this synth used to be) therefore has no place
    // cue at all, which is why "bat/that/cat" all arrived as the same word.
    // Each obstruent carries a locus the formants glide to during its closure;
    // the surrounding vowels do the rest for free through the existing 22ms glide.
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
    // lf: formant locus (see above). az: nasal antiformant (the zero a nasal's side
    // branch puts in the spectrum — the ONLY thing that distinguishes M/N/NG once
    // you strip the transitions, since their murmurs are nearly identical).
    const PH = {
      IY:{f:[270,2290,3010],t:'V',d:130}, IH:{f:[390,1990,2550],t:'V',d:100},
      EH:{f:[530,1840,2480],t:'V',d:110}, AE:{f:[660,1720,2410],t:'V',d:140},
      AA:{f:[730,1090,2440],t:'V',d:150}, AO:{f:[570,840,2410],t:'V',d:140},
      UH:{f:[440,1020,2240],t:'V',d:100}, UW:{f:[300,870,2240],t:'V',d:140},
      ER:{f:[490,1350,1580],t:'V',d:150}, AH:{f:[640,1190,2390],t:'V',d:90},
      // SCHWA — the most common vowel in English and the one the old table had no
      // way to say. Dead centre of the vowel space, short, and never stressed.
      AX:{f:[600,1200,2400],t:'V',d:65},
      // NURSE with the r-colour taken out (RP /ɜː/). Same tongue position as ER;
      // the only meaningful change is F3 up from 1690 to 2350, because a LOW third
      // formant is what the ear reads as American rhoticity. Slightly longer,
      // since RP holds this one.
      ERR:{f:[490,1350,2350],t:'V',d:165},
      // RP GOAT (/əʊ/). Same offglide as GA's OW; the difference is entirely in
      // where it STARTS — central rather than back-rounded, so F2 begins near the
      // schwa's 1400 instead of 840. Slightly longer, as RP holds it.
      OWR:{f:[500,1400,2350], to:[440,950,2350], t:'V',d:180},
      // A diphthong's offglide heads FOR /i/ or /u/ and stops well short: real /aɪ/ ends
      // near F1 450, F2 1850, real /oʊ/ barely moves. Gliding all the way closed the vowel
      // off like a consonant, so "no", "low" and "dough" came back "num", "long", "dumb".
      EY:{f:[530,1840,2480],to:[370,2150,2700],t:'V',d:170},
      AY:{f:[730,1090,2440],to:[430,1850,2550],t:'V',d:180},
      OY:{f:[570,840,2410], to:[430,1800,2500],t:'V',d:180},
      OW:{f:[500,900,2450], to:[420,800,2350], t:'V',d:170},   // starts at /o/: from /ɔ/ "snowed" was heard as "snob"
      AW:{f:[730,1090,2440],to:[480,1000,2350], t:'V',d:180},
      M:{f:[250,1100,2200],t:'N',d:80,az:1000}, N:{f:[250,1700,2600],t:'N',d:80,az:1800}, NG:{f:[250,2000,2900],t:'N',d:80,az:2900},
      // /l/ has two allophones and the gap between them is large. CLEAR /l/ before a
      // vowel (leaf, alive) keeps F2 high; DARK /l/ everywhere else (well, full,
      // people, milk) retracts the tongue body and drops F2 to near a back vowel.
      // One triple for both is wrong roughly half the time. `df` is the dark one.
      L:{f:[360,1300,2600],df:[430,760,2700],t:'L',d:70,tc:0.020}, R:{f:[330,1060,1450],t:'L',d:80,tc:0.020},
      W:{f:[300,610,2200],t:'L',d:70,tc:0.022},  Y:{f:[270,2290,3010],t:'L',d:60,tc:0.022},
      // `ng` — per-phoneme noise level. One flat 0.3 for every fricative made the
      // sibilants shout: /s/ and /ʃ/ carry far more energy than /f/ or /θ/, and this
      // synth has none of the masking a real voice provides, so they need to sit
      // BELOW the weak fricatives here, not above them. nq comes down with it — a Q
      // of 6 at 6.5kHz is a ~1kHz-wide whistle, where real /s/ is broadband hiss
      // above ~4kHz. The narrow band was what gave it that tonal edge.
      S:{t:'F',d:100,nf:5600,nq:1.3,ng:0.18,vd:0,lf:ALV,sib:1},  Z:{t:'F',d:95,nf:5600,nq:1.3,ng:0.12,vd:.5,lf:ALV,sib:1},
      SH:{t:'F',d:115,nf:3000,nq:1.2,ng:0.16,vd:0,lf:PAL,sib:1},   ZH:{t:'F',d:100,nf:3000,nq:1.2,ng:0.13,vd:.5,lf:PAL,sib:1},
      F:{t:'F',d:100,nf:5000,nq:0.6,ng:0.03,vd:0,lf:LAB},  V:{t:'F',d:90,nf:5000,nq:0.6,ng:0.02,vd:.5,lf:LAB},
      TH:{t:'F',d:100,nf:5500,nq:0.6,ng:0.024,vd:0,lf:DEN}, DH:{t:'F',d:80,nf:5000,nq:0.6,ng:0.012,vd:.5,lf:DEN},
      HH:{t:'H',d:80,nf:1500,nq:1,vd:0},
      // Affricates run the fricative branch, so they need the same treatment — they
      // are sibilants too, and were the last thing left shouting at the old flat 0.3.
      CH:{t:'F',d:95,nf:3000,nq:1.2,ng:0.14,vd:0,stopFirst:1,lf:PAL,sib:1}, JH:{t:'F',d:85,nf:3000,nq:1.2,ng:0.09,vd:.4,stopFirst:1,lf:PAL,sib:1},
      // asp: voice-onset time (ms of aspiration after the burst before voicing starts).
      // English voiceless stops are aspirated and voiced ones aren't — that gap IS
      // the contrast a listener uses, far more than the burst frequency.
      //
      // A BURST HAS A SHAPE, NOT JUST A FREQUENCY. Every stop released through one
      // fixed band — Q 2, 20ms, one level — with only `nf` moving, and the shape is
      // most of what the classical place features actually describe:
      //
      //   bq  burst Q. LOW is diffuse (energy spread across the spectrum), HIGH is
      //       compact (one sharp mid peak). Velars are the compact ones and it is
      //       their most identifiable property; labials are the diffuse ones.
      //   bd  burst duration, ms. A velar release is genuinely the longest — the
      //       tongue body peels off the palate slowly — and an alveolar is a sharp
      //       tap. This was 20ms for all six.
      //   bg  burst level, relative. A labial burst is weak: there is no cavity in
      //       front of the lips to resonate, so nothing amplifies it.
      P:{t:'S',d:90,nf:1100,vd:0,lf:LAB,asp:55,bq:0.7,bd:10,bg:0.55}, B:{t:'S',d:80,nf:900,vd:.4,lf:LAB,asp:8,bq:0.7,bd:8,bg:0.35},
      T:{t:'S',d:90,nf:4600,vd:0,lf:ALV,asp:65,bq:1.2,bd:12,bg:1.3}, D:{t:'S',d:80,nf:4000,vd:.4,lf:ALV,asp:10,bq:1.2,bd:10,bg:0.8},
      K:{t:'S',d:90,nf:2000,vd:0,lf:VEL,asp:75,bq:3.5,bd:22,bg:1.8}, G:{t:'S',d:80,nf:1800,vd:.4,lf:VEL,asp:14,bq:3.5,bd:18,bg:1.1},
      // TWO pauses, not one. Connected speech does not stop between words — the
      // words run together and only phrase boundaries get real silence. A single
      // 120ms gap after every word is most of what made this read as dictation
      // rather than talking, so a word gap is now barely a gap at all and the
      // punctuation pause is the one that carries weight.
      // A flap is not a stop with a short fuse — it is a ballistic tap, ~25ms total,
      // fully voiced, with no aspiration and barely any closure. Modelled as a stop so
      // it inherits the locus machinery, but with the timing of a tap.
      DX:{t:'S',d:28,nf:2600,vd:.7,lf:ALV,asp:0,bg:0.15},
      // PUNCTUATION IS NOT ONE THING. A comma, a colon, a dash and an ellipsis are
      // four different silences, and collapsing them into one 180ms gap threw away
      // most of what punctuation is FOR. Each break carries its own duration, and
      // `term` marks the ones that end a phrase (re-pitch, declination reset).
      _:{t:'P',d:40},              // word gap
      _M:{t:'P',d:80,minor:1},     // a minor break nobody wrote (placeAccents); lighter than a comma
      _C:{t:'P',d:150},            // comma: the lightest written break
      _S:{t:'P',d:260},            // semicolon / colon — heavier than a comma, not an end
      _D:{t:'P',d:190},            // dash, parenthesis — an interruption, not a clause edge
      _E:{t:'P',d:430,term:1},     // ellipsis — trailing off, and the longest silence there is
      __:{t:'P',d:250,term:1},     // full stop
      _X:{t:'P',d:200,term:1},     // exclamation — a shout doesn't linger, it lands and moves
      _XX:{t:'P',d:220,term:1},    // "!!" or more: the same, harder (see phraseK in speak)
      _Q:{t:'P',d:290,term:1},     // question — held open a beat for the answer
      _P:{t:'P',d:480,term:1},     // paragraph / line break
    };
    // Break classes, so nothing has to enumerate the codes. `_` is a juncture and
    // is deliberately NOT a break — see the word-boundary note in the synth loop.
    const isBreak = c => !!(PH[c] && PH[c].t === 'P' && c !== '_');
    const isTerm  = c => !!(PH[c] && PH[c].term);
    const isGap   = c => !!(PH[c] && PH[c].t === 'P');

    // High-frequency irregulars + broadcast vocab the rules/dict get wrong. Wins over CMU.
    // Entries may carry their own '*' stress marker (and AX for schwa) exactly as
    // the dictionary does; an entry that has one is taken as authoritative and the
    // spelling guesser never runs on it. Worth doing for anything here — these are
    // the words the network says most, and a compound like "coldwater" or an
    // initialism like "dee-em-VEE" is precisely what the guesser gets wrong.
    const DICT = {
      the:'DH AX', a:'AX', of:'AX V', to:'T AX', evening:'* IY V N IH NG',
      soylent:'S * OY L AX N T', coldwater:'K * OW L D W AO T ER', architect:'* AA R K AX T EH K T',
      // Broadcast (.bsm) vocab the letter-rules mispronounce — world coinages/brands, recurring
      // proper names, and spoken initialisms. Verified against the g2p fallback's wrong guesses
      // (e.g. deadball→"deed-ball", hydrate→"hee-drate", cyberware→"see-ber", dmv→consonant mush).
      halcyon:'HH * AE L S IY AX N', deadball:'D * EH D B AO L',
      craniumtrust:'K R * EY N IY AX M T R AH S T', gleamtooth:'G L * IY M T UW TH',
      cyberware:'S * AY B ER W EH R', cybernetic:'S AY B ER N * EH T IH K',
      neonoodles:'N IY OW N * UW D AX L Z', hydrate:'HH * AY D R EY T',
      grimaldi:'G R IH M * AA L D IY', delacroix:'D EH L AX K R W * AA',
      delphine:'D EH L F * IY N', ferraro:'F ER * AA R OW',
      // Spoken initialisms take their stress on the LAST letter — dee-em-VEE.
      dmv:'D IY EH M V * IY', gdp:'JH IY D IY P * IY', crt:'S IY AA R T * IY',
      // Recurring in-world names. Found by sweeping the cast through the
      // letter-guesser and listening to what came back — these are the ones it got
      // wrong, and being names they are said constantly, so each error repeats
      // forever. CMUdict has none of them and never will.
      // Coinage STEMS rather than coinages. Now that an unknown word is tried as
      // a compound, teaching the dictionary one prefix fixes every word built on
      // it — `holo` alone buys hololock, holobooth and anything else the world
      // grows later, with no entry per word. Worth preferring a stem to a
      // compound whenever the stem is productive.
      holo:'HH * AA L OW', chem:'K * EH M', cryo:'K R * AY OW',
      nano:'N * AE N OW', mag:'M * AE G', synth:'S * IH N TH',
      cyd:'S * IH D',                   // "Sid", not "Seed"
      echelon:'* EH SH AH L AA N',      // French-derived /ʃ/ — the guesser said "etch-a-lon"
      kiyo:'K * IY OW',                 // guesser produced "K IH AX AX", pure noise
      bijou:'B IY ZH * UW',             // "bee-ZHOO" — another French /ʒ/ the rules can't know
      merrin:'M * EH R IH N',           // guesser doubled the r into an "err" vowel
      solenne:'S OW L * EH N',          // guesser dropped a syllable entirely
      // The two most-spoken names in the .bsm corpus that the guesser gets wrong —
      // "auggie" alone appears 236 times, so this one error was repeating all night.
      auggie:'* AO G IY',               // "AW-ghee": soft-g rule said JH, and -ie said AY
      vigo:'V * IY G OW',               // "VEE-go": both vowels came out short
    };
    function dictLook(w){ return DICT[w] ? DICT[w].split(' ') : null; }

    // ── Contractions ─────────────────────────────────────────────────────────
    // CMUdict carries no apostrophe forms whatsoever, so EVERY contraction fell
    // through to the letter rules — which delete the apostrophe and then read
    // what's left as one word. "i'm" became i+m, a closed syllable, and came out
    // "im" rather than "eye-m"; "you're" came out "yoor-eh".
    //
    // Most are stem + clitic and are derived below (see cliticLook), exactly the
    // way the inflectional suffixes extend the dictionary. Only the ones that
    // AREN'T derivable are listed here: won't is not will+n't, don't is not
    // do+n't (the vowel changes), can't loses its /n/ into a long vowel.
    const CONTRACT = {
      "won't":"W * OW N T",   "can't":"K * AE N T",   "don't":"D * OW N T",
      "shan't":"SH * AE N T", "ain't":"* EY N T",     "y'all":"Y * AO L",
      "let's":"L * EH T S",   "o'clock":"AX K L * AA K",
      "gonna":"G * AO N AX",  "wanna":"W * AA N AX",  "gotta":"G * AA T AX",
      "kinda":"K * AY N D AX","sorta":"S * AO R T AX","outta":"* AW T AX",
      "'em":"AX M",           "'til":"T IH L",        "ma'am":"M * AE M",
    };

    // Stem + clitic. The clitic's own phones are fixed; only /s/ inflects, and it
    // inflects by exactly the rule the plural suffix already uses below.
    const CLITIC = { m:['M'], ll:['L'], ve:['V'], re:['ER'], d:['D'] };
    function cliticLook(w, stemPh){
      const q = w.indexOf("'");
      if (q < 1) return null;
      const stem = w.slice(0, q), tail = w.slice(q + 1);
      // n't attaches to the stem WITH its n — "isn't" is "is" + /ənt/, and the
      // stem to look up is "is", not "isn".
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
    // ⚠ The game page doesn't load the 435 KB lexicon at boot any more; requestCmu()
    // fetches it after the page has loaded. Until it lands, lookups miss and words go
    // through the letter-to-sound rules, and nothing is cached, so the first lookup
    // after it arrives builds the real map. Pages and gates that load it themselves
    // (the dev panel, scripts/voice/*) never reach the fetch.
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
    // Vowel tokens in the dictionary carry a stress digit (0 unstressed, 1 primary,
    // 2 secondary). Both are normalised away HERE, into the phoneme run itself, so
    // nothing downstream has to carry provenance:
    //   • primary stress  → a '*' marker inserted before the vowel
    //   • AH0             → AX, because CMUdict's AH0 *is* schwa
    // Other 0-stress vowels keep their quality on purpose — the vowel in "happy"
    // is reduced in stress but not in colour, and flattening it to schwa gives you
    // "happuh". They lose length and loudness in the synthesis loop instead.
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

    // The spoken NAME of each letter, as phonemes rather than as a word to look
    // up. The first version of this asked the dictionary for "vee", "aitch",
    // "ess" and "zee" — and the 25k CMU subset does not carry all of them, so
    // spellOut returned null and the initialism fell silently back to the letter
    // guesser. VTOL still came out "vee-TAHL". A table the size of the alphabet
    // costs nothing and cannot half-work.
    const LETTER_PH = {
      a:'EY', b:'B IY', c:'S IY', d:'D IY', e:'IY', f:'EH F', g:'JH IY',
      h:'EY CH', i:'AY', j:'JH EY', k:'K EY', l:'EH L', m:'EH M', n:'EH N',
      o:'OW', p:'P IY', q:'K Y UW', r:'AA R', s:'EH S', t:'T IY', u:'Y UW',
      v:'V IY', w:'D AH B AX L Y UW', x:'EH K S', y:'W AY', z:'Z IY',
    };

    // Spell a token out, letter by letter, with the accent on the LAST letter —
    // en-pee-SEE. Only the last one is accented, or a five-letter initialism
    // reads as five separate stressed words rather than one.
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

    // Pronounce a word: initialism → hand-dict → CMU → inflectional suffix →
    // compound → letter rules.
    // ⚠ DEGEMINATION BELONGS ON THE OUTPUT, not in the letter rules. The doubled
    // consonants are made where two phoneme sequences are JOINED — `tableland` is
    // the dictionary's `table` (…AX L) plus its `land` (L AE N…), and `funnelled`
    // is `funnel` plus the -ed suffix. The letter rules never see either. A first
    // cut put the filter inside g2p and changed nothing at all, which is worth
    // recording: the same word can arrive by a dictionary hit, a compound, a
    // suffix rule or a guess, and only the exit is common to all of them.
    //
    // English has no geminate inside a word. `tableland` was "table-l-and" and
    // `rubbly` "rub-b-ly" — and those two are terrain words appearing 287 and 157
    // times in room prose, so Read Aloud said them wrong in hundreds of rooms.
    // 126 words in the game's own vocabulary carried the fault; the `merrin` entry
    // in DICT is the same bug, patched once by hand.
    //
    // Consonants only. An adjacent identical VOWEL pair has a different cause (the
    // -ia/-ya spellings: `fascia` → F AE S S AX AX) and collapsing it here would
    // hide that rather than fix it. Across a hyphen too, correctly: "hand-drawn"
    // is said /hændrɔːn/, with one d.
    const DEGEM_VOWEL = /^(AA|AE|AH|AO|AW|AY|EH|ER|EY|IH|IY|OW|OY|UH|UW|AX|ERR|OWR)$/;
    function pronounceWord(w){
      const ph = pronounceWordRaw(w);
      if (!Array.isArray(ph) || ph.length < 2) return ph;
      return ph.filter((p, i) => i === 0 || p !== ph[i - 1] || DEGEM_VOWEL.test(p));
    }
    // The vowel-less words that ARE said as sounds, not spelled: shh, psst, hmm, brr, tsk.
    const INTERJECTION = /^(?:s+h+|p+s+t+|h+m+|m+|b+r+|g+r+|t+s+k+|z+|p+f+t+|c+h+)$/i;
    function pronounceWordRaw(w){
      // ── Initialisms ────────────────────────────────────────────────────────
      // Checked FIRST, and off the raw token, because the case is the evidence
      // and the next line destroys it.
      //
      // Before this, an initialism nobody had hand-listed reached the letter
      // guesser, which reads it as a word: "NPC" came back "M P K" — three
      // consonants and no vowel, which is not speech at all. The hand-list
      // (dmv, gdp, crt) was the previous answer and it only ever covers what
      // somebody already noticed was wrong.
      //
      // The guards are what keep this from eating emphasis. An ALL-CAPS word is
      // also how the corpus writes a shout ("it is GONE now") and a station
      // ident, so spelling out anything capitalised would scream "gee-oh-en-EE"
      // at 11% of the broadcast corpus. Hence: it must be UNKNOWN to every
      // dictionary — which "gone", "fuck" and every other real word are not —
      // and short, and vowel-poor. A real word that is unknown, four letters or
      // fewer, and has at most one vowel is close to nonexistent; an initialism
      // that shape is the common case.
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
      // NO VOWEL, NO WORD. A token without a single vowel letter can't be said as a word,
      // so it is an abbreviation whatever its case: "CPhL" missed the all-caps test above
      // on its small h and came out "K F L", three consonants and no syllable. Anything a
      // dictionary knows ("hmm", "shh", "psst") is left alone.
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
      // A suffix rule EXTENDS the dictionary — "runs" from a known "run". It is not a
      // way to improve a guess. If the stem is unknown too, chopping the word up is
      // strictly worse than guessing it whole, because the truncation destroys the
      // syllable structure the letter rules read: "cypher" became "SIFF-er" because
      // the guesser was handed "cyph", whose 'y' has nothing after the digraph to make
      // its syllable open. So an unknown stem falls through to g2p on the WHOLE word.
      const stemPh = (s) => lexLook(s) || dictLook(s) || cmuLook(s) || null;
      let m, ph;
      if ((ph = cliticLook(w, stemPh))) return ph;
      // G-DROPPING. The corpus is written the way people talk — "somethin'",
      // "nothin'", "gettin'" — and none of those are in any dictionary, so they
      // all reached the letter rules and came back with a spurious vowel ("SAA-
      // meth-in"). The -ing form IS in the dictionary, so ask for it and swallow
      // the velar: NG → N is the whole of what g-dropping does.
      if ((m = /^(.+in)'?$/.exec(w)) && w.length > 3) {
        ph = stemPh(m[1] + 'g');
        if (ph && ph[ph.length-1] === 'NG') return [...ph.slice(0,-1), 'N'];
      }
      // -ES after a sibilant is its own syllable: "undresses", "boxes", "matches". The plain
      // -s rule below can't see it, because the stem it asks for ("undresse") is no word.
      if ((m = /^(.+(?:s|sh|ch|x|z))es$/.exec(w)) && (ph = stemPh(m[1]))) return [...ph, 'IH', 'Z'];
      // -IES is a -y word's plural or third person: "buries", "parries".
      if ((m = /^(.+)ies$/.exec(w)) && w.length > 4 && (ph = stemPh(m[1] + 'y'))) return [...ph, 'Z'];
      if ((m=/^(.+?)(s)$/.exec(w)) && w.length>2 && !/(ss|us|is)$/.test(w)) {
        ph = stemPh(m[1]);
        if (ph) { const last = ph[ph.length-1];
          if (SIBILANT.has(last)) return [...ph,'IH','Z'];
          return [...ph, VOICED_END.has(last)?'Z':'S']; }
      }
      if ((m=/^(.+?)ed$/.exec(w)) && w.length>3) {
        // "hoped" → "hope" + d: the silent e is dropped before the suffix, so try it back.
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

    // ── Compounds ────────────────────────────────────────────────────────────
    //
    // The single biggest source of mispronunciation in THIS game, because this
    // game's vocabulary is compounds: voidwalking, hololock, chembench,
    // grasshopper, deadball, nanofilament, cyberware. CMUdict has none of them
    // and never will — they were coined here — so every one reached the letter
    // guesser, which reads a long unknown word as one long unstressed run and
    // mushes the second element into schwa. Sweeping the world's coinages
    // through it produced "void-WAH-lking", "hollow-luhk", "chem-buhnch" and
    // "GRASH-uh-per": the first half usually survived and the second half was
    // always gone, which is the signature of exactly this failure.
    //
    // Splitting fixes all of them at once, because both halves are ordinary
    // English words the dictionary already knows perfectly. That is the whole
    // idea: don't teach the synth the coinage, notice that it is two words.
    //
    // Two rules keep it honest.
    //
    //   • BOTH HALVES MUST BE KNOWN — dictionary or CMU, never the guesser. A
    //     split where one half is itself a guess is two guesses wearing a
    //     trenchcoat, and strictly worse than guessing the whole word, whose
    //     syllable structure at least survives intact.
    //
    //   • THE MOST BALANCED SPLIT WINS. Scanning left to right and taking the
    //     first hit is how you get "the + rapist". Maximising the shorter half
    //     prefers the split a reader would make, and the >= 3 floor keeps single
    //     letters and stray prefixes out of it entirely.
    //
    // Stress is the other half of the fix and is easy to overlook: an English
    // compound takes its primary accent on the FIRST element. Keeping both
    // halves' accents gives "VOID-WALK-ing", two stressed feet, which sounds
    // like two words read off a list — so the second element's '*' is dropped.
    // Its vowels keep their full quality (it is de-accented, not reduced), which
    // is the difference between "VOID-walking" and "VOID-wuhlking".
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

    // Grapheme-to-phoneme fallback: compact rule set, left-to-right longest match.
    function g2p(word){
      word = word.toLowerCase().replace(/[^a-z']/g,'');
      if (!word) return [];
      const out = []; let i = 0;
      // The emptiness guard is load-bearing: `'aeiou'.includes('')` is TRUE, so past
      // the end of the word every lookahead reads as a vowel. That made "cyd", "gym"
      // and "myth" look like open syllables and come back as "Side", "jyme", "mythe".
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
          // ER already IS the r — emitting the following 'r' as well gave "cypher" a
          // doubled rhotic (ER R). Consume both. Only in a CLOSED syllable though:
          // in "hero" the r belongs to the next syllable as an onset, so the e stays
          // an ordinary vowel and the r is emitted separately.
          if ((c==='e'||c==='i'||c==='u') && nx==='r' && !isV(at(i+2))) { out.push('ER'); i+=2; continue; }
          out.push(shortMap[c]); i++; continue;
        }
        switch (c) {
          case 'c': out.push((nx==='e'||nx==='i'||nx==='y')?'S':'K'); break;
          case 'g': out.push((nx==='e'||nx==='i'||nx==='y')?'JH':'G'); break;
          case 'j': out.push('JH'); break;
          case 'x': out.push('K','S'); break;
          // 'y' has FOUR jobs. Initially it is the consonant /j/ (yes); word-finally
          // it is /i/ (city, happy); and medially it splits the way every other
          // English vowel does, on whether its syllable is open or closed:
          //   OPEN   (one consonant, then a vowel) → /aɪ/  cyborg, tyrant, style, type
          //   CLOSED (cluster, or end of word)     → /ɪ/   cyd, gym, myth, crypt
          // The first version of this rule returned IH for everything medial, which
          // fixed "Cyd" (closed) and broke "cyborg" (open). Note 'y' is deliberately
          // not in `isV`, so it never reaches the vowel branch above and has to make
          // this distinction for itself.
          //
          // The digraph test matters more than it looks: "cypher" is y + p + h + e,
          // so a naive next-next-is-a-vowel check sees 'h' and calls it closed.
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
    // ── Abbreviations that are a different WORD, not a shorter one ───────────
    //
    // ABBREV (below) already stops "Dr." ending a sentence. It does not say what
    // "Dr" IS, so the token went to the dictionary — where CMUdict has an entry
    // for `dr`, meaning DRIVE. "Dr. Vale" was being read "drive Vale", every
    // time, and the same trap is set for jr, sr, sgt and lt.
    //
    // "St" is the one that genuinely depends on context and so gets a rule
    // rather than an entry: a capitalised word after it means Saint (St. Mark),
    // anything else means Street (Dray St.).
    const ABBREV_WORD = {
      dr:'doctor', mr:'mister', mrs:'missus', ms:'miz', jr:'junior', sr:'senior',
      prof:'professor', sgt:'sergeant', lt:'lieutenant', capt:'captain',
      col:'colonel', gen:'general', vs:'versus', approx:'approximately',
      dept:'department', inc:'incorporated', ltd:'limited', etc:'et cetera',
    };
    function expandAbbrev(text){
      return String(text)
        // With or without its full stop: "St Garneau" is how a British-style name is
        // written, and CMUdict's `st` (STREET) read it "Street Garneau".
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
        // ── The game's own currency ──────────────────────────────────────────
        // ₵ is not in any of the symbol passes, so it was SILENTLY DROPPED:
        // "₵900" read as "nine hundred", with no unit at all. Money is quoted in
        // shops, jobs, bounties, rent and every vendor line in the game, so this
        // was the most-repeated omission in the voice. Postfixed, because that is
        // how it is said — "nine hundred credits", never "credits nine hundred".
        .replace(/₵\s*([\d,]+(?:\.\d+)?)/g, ' $1 credits ')
        .replace(/₵/g, ' credits ')
        // Symbols that carry a word. Each of these was either dropped entirely
        // (& produced literally nothing) or read as its letters ("x2" came back
        // "ex two"). `#` and `x` are anchored to a digit so ordinary prose and
        // the letter x are untouched.
        .replace(/&/g, ' and ')
        .replace(/#\s*(?=\d)/g, ' number ')
        .replace(/(?<=\d)\s*[x×]\s*(?=\d)/gi, ' times ')
        .replace(/(?<=^|\s)[x×](?=\d)/gi, ' times ')      // quantity chips are written "x2"
        .replace(/(?<=\s|^)\+\s*(?=\d)/g, ' plus ')
        // Clock times, before the bare-number pass gets to them — and before the
        // ':' becomes a phrase break, which is what was putting a pause in the
        // middle of "four thirty". :00 is the hour said as an hour; a single-digit
        // minute takes its "oh" the way a person says it.
        // A GAME CLOCK is a length, not a time of day: "10:00 left in the third" is ten
        // minutes, not ten o'clock, and "0:45 to go" forty-five seconds. Only before the
        // words that make it one; a bare 10:00 is still a time.
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
    const VOWELS = new Set(['IY','IH','EH','AE','AA','AO','UH','UW','ER','ERR','AH','AX','EY','AY','OW','OY','AW']);

    // The next actual sound, skipping stress markers (which are not sounds).
    // Used by linking-r to see across a word gap without seeing across a pause.
    const nextSound = (phon, k) => { while (isMark(phon[k])) k++; return phon[k]; };

    function applyAccent(phon, accent){
      if (accent !== 'rp') return phon;
      const out = [];
      for (let i = 0; i < phon.length; i++){
        const p = phon[i];
        // A stress marker is not a sound: skip past it when looking ahead, or an
        // /r/ before a STRESSED vowel would read as non-prevocalic and vanish.
        let n = i+1; while (isMark(phon[n])) n++;
        const next = phon[n];
        if (p === 'R'){
          if (next && VOWELS.has(next)) out.push('R');   // prevocalic /r/ survives
          // LINKING-R. A non-rhotic speaker drops the /r/ of "far" — but not in
          // "far away", where the following word begins with a vowel and the /r/
          // comes back to bridge them. Look past a WORD GAP specifically, which is
          // why this cannot use `isGap`: that matches every pause, and "far. Away"
          // has no link across it. A comma is the same — the juncture is what kills
          // the bridge, not the silence.
          //
          // ⚠ This gives linking-r and CANNOT give intrusive-r ("lawr and order"),
          // because it only ever KEEPS an /r/ the dictionary already put there.
          // That is the right side to err on: intrusive-r is variable, stigmatised
          // in exactly the register this voice reads in, and would need orthography
          // we no longer have by this point.
          else if (phon[n] === '_' && VOWELS.has(nextSound(phon, n + 1))) out.push('R');
          continue;                                      // …otherwise it's gone
        }
        if (p === 'ER'){ out.push('ERR'); continue; }
        // GOAT. GA starts this diphthong back and rounded (/oʊ/); RP starts it
        // CENTRAL (/əʊ/), and that onset is one of the loudest single tells between
        // the two accents — "no", "home", "over". Same phoneme-substitution route
        // ER→ERR already uses, so the scheduling loop needs to know nothing.
        if (p === 'OW'){ out.push('OWR'); continue; }
        if (p === 'AE'){
          // Scan to the next non-gap phone: the trigger consonant may sit across
          // a syllable break in the run.
          let j = i+1; while (isGap(phon[j]) || isMark(phon[j])) j++;
          if (RP_BATH_FOLLOW.has(phon[j])) { out.push('AA'); continue; }
        }
        out.push(p);
      }
      return out;
    }

    // ── Lexical stress ───────────────────────────────────────────────────────
    // English is stress-timed: stressed syllables are longer, louder and higher,
    // and everything else collapses toward schwa. A synth that gives every vowel
    // equal weight sounds like a machine reading a list even when every phoneme
    // is right, which is what the old alternating-vowel lilt amounted to.
    //
    // The dictionary supplies it for the ~25k words it carries (see cmuLook). The
    // rules below are the FALLBACK for everything else — proper nouns, world
    // coinages, anything the letter-guesser had to invent — inferred from spelling,
    // which is wrong often enough to notice and right often enough to beat nothing.
    //
    // A '*' marker is inserted immediately before the stressed vowel. It has no
    // PH entry, so every existing consumer that walks the run (estimateDuration,
    // the synthesis loop) already skips it; only the lookaheads need teaching.
    //
    // Function words are deliberately left UNMARKED. An unmarked word has no
    // strong syllable, so every vowel in it reduces — which is exactly what
    // "of the" does in real speech, and most of what makes a phrase sound
    // spoken rather than spelled out.
    // Only words that genuinely LOSE their accent in connected speech. Several
    // entries here originally didn't: negation is stressed ("you're NOT going" —
    // reducing it produced "nuht"), and so are locatives (here/there), wh-words in
    // questions, demonstratives, and particles (up/out/off). Removing them matters
    // more than it looks, because a wrongly-reduced content word is far more
    // audible than a wrongly-unreduced function word. The polysyllabic entries
    // (into/onto/over/under/about) are gone too — the syllable guard in stressWord
    // already made them no-ops.
    const FUNC = new Set(('a an the of to in at by for from with as and or but nor if than that ' +
      'is am are was were be been being do does did have has had will would shall should may might must can could ' +
      'he she it we they you i me him her us them his its their our your my some any').split(' '));
    // Suffixes that pull stress onto a fixed syllable counted from the END.
    // "-ation" stresses the A; "-ity" the syllable two back; "-ic" the one before it.
    const STRESS_SUFFIX = [
      [/(ation|ition|ution)s?$/, 2], [/(tion|sion|cion)s?$/, 2], [/(ity|ety|ify|ise|ize)s?$/, 3],
      [/(ical|ically)$/, 3], [/(ic|ics)$/, 2], [/(ious|eous|uous)$/, 3], [/(ial|ian|iance|ience|ient)s?$/, 3],
      [/(ee|eer|ese|esque|ette)s?$/, 1],
    ];
    // Unstressed prefixes: the strong syllable is the one after them.
    const WEAK_PREFIX = /^(un|re|de|be|a|con|com|ex|in|im|dis|pre|pro|per|sub|ob|ad|en|em|for)(?=[a-z]{3})/;

    // ── Tunables ─────────────────────────────────────────────────────────────
    // Every number in here was arrived at by measurement plus a guess at how the
    // guess would SOUND, which is the one thing measurement can't settle. Gathering
    // them in one live object means they can be turned by ear in the voice lab
    // (the dev panel's Voice Lab tab) instead of by edit-reload-listen, and it
    // makes the set of things that are opinions rather than physics explicit.
    // Read at speak() time, so a change applies to the very next line.
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
      // WORD-FINAL NOISE. Frication and aspiration at the end of a word have nothing
      // voiced left to sit under, so whatever level and decay reads as "correct"
      // mid-word reads as an abrasive breathy tail there — the classic synth sigh
      // after every word. Scales the level AND the release of word/phrase-final
      // noise only; 1.0 restores the untapered behaviour.
      finalTaper:  0.6,
      undershoot:  0.2,    // EXPLICIT coarticulation only — see the note in the loop
      lineGapMs:   180,    // breath between chained lines (tv.js reads this)
      excitement:  1.0,    // scales every line's delivery (opt.excite, see deliveryFor); 0 reads it all flat
      compRatio:   3,      // the voice's compressor (1 is off)
    };

    // ── Consonant levels ─────────────────────────────────────────────────────
    // Noise made at a constriction (frication, a stop's burst) runs through its own band;
    // noise made at the glottis (aspiration, /h/, breath) runs through the tract with the
    // voice. These set how loud each is against a stressed vowel, and were fitted by
    // measurement to the levels of real speech: a burst and /s/ some 10 dB under the vowel,
    // /h/ and aspiration nearer 20. The voice bar of a closed /b d g/ sits near 16, louder
    // than careful speech has it, because that measured clearer (see MURMUR_F1).
    const ASP_H = 0.08;         // /h/, through the tract
    const ASP_STOP = 0.075;     // the voice-onset breath after /p t k/
    const BURST = 0.13;         // a stop's release, scaled per phoneme by `bg`
    const VBAR = 0.035;         // voicing through a closed tract (/b d g/, an affricate's /dʒ/)
    const VFRIC = 0.07;         // voicing under /v ð z ʒ/
    const MURMUR_KEEP = 0.05;   // what's left of F2 and up when the mouth is shut
    const BREATH_K = ASP_H / 0.11;   // voices' `breath` was tuned against an /h/ of 0.11
    const ASP_BREATH_IN = 0.035; // the breath before a big call
    const AFFRICATE_CLOSURE = 0.05;  // s; the stop half of /tʃ dʒ/
    // Drawn-out sounds (see elongation and segmentDuration), in seconds: a vowel holds
    // LONG_V0 plus LONG_V for every letter after the first, a consonant the C pair.
    const LONG_V0 = 0.14, LONG_V = 0.16, LONG_V_MAX = 2.6;
    const LONG_C0 = 0.10, LONG_C = 0.11, LONG_C_MAX = 1.2;
    const VIBRATO = 0.02;            // depth (fraction of F0) a held, sold vowel wavers by

    // DELIVERY: how hard a line is being sold (`opt.excite`). -1 is grave (a death on the
    // ice, the injury list), 0 is the narrator's own voice exactly as it always was, 1 is
    // a goal call. Excited speech is higher, wider, harder, brighter and a little quicker,
    // holds its height across the phrase instead of sagging, leans long on the one word
    // that matters ("he SCOOORES") and has no fry at the end; grave speech is lower,
    // narrower, softer, darker and slower, with longer pauses, and falls into fry. Those are
    // the measured correlates of arousal in sports commentary: F0 level and range,
    // intensity, spectral tilt, rate and pause length. Every factor is exactly 1 (or 0) at
    // 0, so a line nobody is selling is untouched.
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

    // Two stress markers sit in the phoneme run, both immediately before a vowel and
    // neither with a PH entry, so the synthesis loop and estimateDuration skip them
    // for free — only the LOOKAHEADS have to know. '*' is ordinary lexical stress;
    // '!' is emphasis, a level above it. A third, '^', marks the NUCLEUS of a phrase
    // that's being sold (deliveryFor): the vowel a caller leans on and holds. It sits
    // between the stress mark and its vowel, and only speak() puts it there, after
    // every transform has run, so nothing upstream ever sees one.
    // A FOURTH, '~n', marks a DRAWN-OUT sound: the writer held a letter ("SCOOOOORES",
    // "Yesss") and n is how many times they wrote it. textToPhonemes puts it before the
    // sound to hold; see elongation() and segmentDuration.
    // A FIFTH, '+', is the LIGHT nucleus: the accent every phrase has, sold or not
    // (placeAccents). It sits immediately BEFORE the stress mark of the word that
    // carries it, so the '*'/'!' stays next to its vowel and every lookahead above
    // still works. It asks for no hold; '^' is the held one. No pitch rule reads '+'
    // yet; soldNucleus uses it to pick the vowel a sold line holds.
    // The break '_M' is the sixth thing in a run that nobody typed: a minor phrase
    // break before a conjunction or preposition in a long unpunctuated stretch.
    const isLong = p => typeof p === 'string' && p.charCodeAt(0) === 126;   // '~'
    const isMark = p => p === '*' || p === '!' || p === '^' || p === '+' || isLong(p);

    // Monophthongs that centralise when they lose their stress. Diphthongs are
    // absent on purpose: the glide IS the vowel's identity and survives reduction.
    // IY and UW are absent too, and for the same reason — they keep their colour in
    // an unstressed syllable ("happy", "into"), so flattening them gives "happuh".
    const CENTRALISES = new Set(['IH','EH','AE','AA','AO','UH','AH']);

    // WEAK FORMS. A function word doesn't simply become schwa — English weakens each
    // vowel to a specific target, and the high vowels do NOT go all the way to the
    // centre: /uː/ weakens to /ʊ/, and /iː/ stays /i/ (see below). Mapping everything to schwa turned
    // "you are" into "yuh er", which is further than even fast speech goes and reads
    // as a mumble rather than as connected speech.
    //
    // /ɪ/ IS ITSELF A WEAK-FORM VOWEL and must NOT map to schwa. This was the
    // single most audible fault in the voice: "is in it his its him this" are all
    // function words whose vowel is already IH, so reducing them centralised the
    // most-spoken words in the language into "uhz uhn uht" and left the whole line
    // sounding mumbled. English weakens /ɪ/ to nothing — the /ɪ/~/ə/ contrast
    // survives reduction (it is the whole difference between "roses" and "Rosa's").
    // /iː/ keeps its colour: "he" weakens to a short [i], not to [ɪ], which made "he
    // scores" "his scores" and "she" "shih". Length and loudness carry the weakening.
    const WEAK = { UW:'UH', EH:'AX', AE:'AX', AA:'AX', AO:'AX', AH:'AX', UH:'AX' };

    // Function words lose their accent at the PHRASE level, which no dictionary can
    // tell you — CMUdict gives "you" a primary stress because it lists words in
    // citation form, one at a time. Running them full-strength is most of what
    // makes a synth sound like it is reading a list of words rather than a sentence.
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
      // Everything the guess didn't pick centralises, exactly as the dictionary
      // path does — otherwise an unknown word is the only thing in the line
      // pronouncing every syllable at full value, which is very audible.
      const out = ph.map((p, i) => (i !== vi[k] && CENTRALISES.has(p) && vi.length > 1) ? 'AX' : p);
      out.splice(vi[k], 0, '*');
      return out;
    }

    // `edge` — this word is the last one before a pause or the end of the line.
    // Nothing reduces at a phrase edge, function word or not: "who is it for?" ends
    // on a full /fɔː/, and "look at me" on a full /miː/, because the boundary itself
    // is prominent. Without this the line trails off into a mumble exactly where a
    // listener is waiting for the point of the sentence.
    function stressWord(ph, word, edge){
      // MONOSYLLABLES only. Deaccenting flattens every vowel in the word, which is
      // exactly right for "of"/"the"/"was" and destroys anything longer: "into"
      // became "uhn-tuh", "under" "uhn-der", and "about"/"over" went completely
      // flat. A polysyllabic function word still has internal stress — it reduces
      // its WEAK syllable, which the dictionary already encodes lexically — so it
      // keeps whatever cmuLook gave it.
      const syl = ph.filter(p => VOWELS.has(p)).length;
      if (FUNC.has(word) && !edge && syl <= 1) return deaccent(ph);
      if (ph.includes('*')) return ph;                     // the dictionary knew
      return guessStress(ph, word);
    }

    // AUTHORED EMPHASIS. Scripts already write it — 11% of spoken .bsm lines carry
    // an ALL-CAPS word ("it is GONE!", "slides into THIRD!") — and pronounceWord
    // lowercases the token, so every one of them was being thrown away. A caps word
    // now becomes an emphatic accent.
    //
    // Two things it must NOT fire on: a line that is wholly shouted (a title card,
    // a station ident) where every word is caps and none is therefore emphatic, and
    // a spoken initialism like DMV or GDP. The first is handled by measuring the
    // line, the second is inherent — an initialism getting a little extra weight is
    // a much smaller error than losing every real emphasis in the corpus.
    // Shared by textToPhonemes (which words get '!') and speak() (how hard a
    // whole-line shout is driven) — one classifier, so they cannot disagree.
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

    // ── Connected-speech transforms ──────────────────────────────────────────
    // Applied over the finished run, like applyAccent, because each one depends on
    // what a segment's NEIGHBOURS are rather than on the word it came from — and two
    // of them reach across word boundaries, which is only meaningful now that a
    // juncture is transparent rather than a silence.
    const VELAR = new Set(['K','G']), LABIAL = new Set(['P','B','M']);
    const VOICELESS_OBS = new Set(['P','T','K','F','TH','S','SH','CH','HH']);

    // Nasal place assimilation. A nasal takes the place of the consonant after it,
    // across a word boundary as readily as inside a word: "in case" is /ŋ/, "ten past"
    // is /m/. Nobody articulates the /n/ in either — it costs a gesture nothing else
    // needs. Junctures are transparent; a real phrase break is not.
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

    // FLAPPING — General American only. A /t/ or /d/ between a vowel and an
    // UNSTRESSED vowel becomes a quick voiced tap: "better" is "bedder", "city" is
    // "ciddy". It is one of the most characteristic things GA does, and its absence
    // is a large part of why a GA dictionary read straight sounds stilted. Skipped
    // for RP, which does not flap — hence the accent check at the call site rather
    // than a flag here.
    function applyFlap(phon){
      const out = phon.slice();
      for (let i = 1; i < out.length; i++) {
        if (out[i] !== 'T' && out[i] !== 'D') continue;
        // Preceded by a vowel or /r/ …
        let a = i - 1; while (isMark(out[a])) a--;
        if (!VOWELS.has(out[a]) && out[a] !== 'R') continue;
        // … and followed by a vowel that is NOT stressed. A marker before it means
        // stressed, which blocks the flap outright — "atomic" keeps its /t/.
        const b = i + 1;
        if (isMark(out[b])) continue;
        if (!VOWELS.has(out[b])) continue;
        out[i] = 'DX';
      }
      return out;
    }

    // ── Drawn-out words ──────────────────────────────────────────────────────
    // "He SCOOOOORES!", "Noooo", "Yesss", "Ahhh". Three or more of one letter is how a
    // writer holds a sound, and the booth's goal call is written exactly that way. The
    // word is said as the word it is: each run collapses to one letter or two, whichever
    // the dictionary knows ("SCOOOORES" is scores, "SHOOOOTS" shoots), and the sound the
    // run spelled is held, for as long as the letters say (see segmentDuration). Read
    // letter for letter, "scoooores" went to the guesser and came out as mush.
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
      // Doubled first, then single, then the mixes: "SHOOOOTS" is shoots before it is shots,
      // and "GOOOOD" good before god, while "SCOOOORES" has no "scoores" and falls to scores.
      // Except at the END of a word, where a held letter is nearly always the short word:
      // "Sooooo" is so (not the Soo locks), "Nooooo" no, "here we gooooo" go.
      const all = (1 << Math.min(runs.length, 3)) - 1;
      const last = runs[runs.length - 1], final = last.at + last.len === letters.length;
      const order = final ? [0, all] : [all, 0]; for (let j = 1; j < all; j++) order.push(j);
      let k = 0;
      for (const j of order) if (known(build(j).toLowerCase())) { k = j; break; }
      // The longest run is the one held. Where it sits in the collapsed word:
      let hold = 0, at = 0, shift = 0;
      runs.forEach((r, i) => { if (r.len > runs[hold].len) hold = i; });
      runs.forEach((r, i) => { const kept = ((k >> i) & 1) + 1; if (i === hold) at = r.at - shift; shift += r.len - kept; });
      return { word: build(k), ch: runs[hold].ch, at, n: runs[hold].len };
    }
    // Which sound in `ph` the held letter spelled, and a '~n' before it. A vowel letter
    // is matched by vowel GROUP: the run's group in the written word is the same-numbered
    // vowel sound, once a silent final e is set aside ("scores": o, e → AO). An h after a
    // vowel ("ahhh", "ohhh") holds that vowel. A consonant holds its own sound ("yesss").
    // When the spelling and the sounds don't line up, the stressed vowel is the one held,
    // which is where a caller leans anyway.
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

    // ── Where the accents go ─────────────────────────────────────────────────
    // stressWord decides each word on its own. These passes decide the PHRASE, which
    // no word can know alone: which word is the nucleus, which words were already said,
    // where an unpunctuated stretch breathes, and which of two nouns a compound leans on.
    // They run in textToPhonemes over word entries, before the run is flattened.

    // A minor break goes before one of these, once MINOR_MIN syllables have gone by
    // since the last break and at least MINOR_TAIL remain before the next. "of" and
    // "to" are left out: "the end of the road" and "going to win" never break there.
    const BREAK_BEFORE = new Set(('and or but nor so because while when where whereas until unless ' +
      'although though since after before with from for in on at by into onto through across ' +
      'around behind between under over without toward towards against during among along beyond').split(' '));
    const MINOR_MIN = 10, MINOR_TAIL = 4;

    // A repeated word keeps its accent straight after one of these: "not the red car but
    // the blue car" deaccents the second car, "cats chase dogs, but cats" does not.
    const CONTRAST = new Set(['not', 'but', 'or', 'nor', 'than', 'versus', 'vs']);
    // Given/new compares lemmas, and a plural or possessive is the same word said again.
    const lemma = (w) => {
      w = w.replace(/'s?$/, '');
      if (w.length > 4 && /ies$/.test(w)) return w.slice(0, -3) + 'y';
      if (w.length > 4 && /(s|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
      if (w.length > 3 && /[^su]s$/.test(w)) return w.slice(0, -1);
      return w;
    };

    // COMPOUND STRESS. Two nouns that name one thing lean on the first: "FIRE station",
    // "ICE rink", "HOCKEY player". With no part-of-speech tagger the rule is narrow on
    // purpose: the second word has to be one of these heads, and the first must not look
    // like an adjective, a material, a number, a determiner or a verb, because all of
    // those take the accent on the noun instead ("old STATION", "stone HOUSE", "two TEAMS").
    // A wrong compound costs more than a missed one: it takes the accent off a new word.
    const COMPOUND_HEAD = new Set(('station rink room shop store street truck board ball game light line ' +
      'field yard lot bag box case fight team match drink kit gun bomb cell club bar office bill card deck ' +
      'ticket market house hall player fan shift job stop plant tower driver boat window phone lane').split(' '));
    const NOT_MODIFIER = new Set((
      // adjectives, ordinals, colours
      'new old big small little great good bad long short high low hot cold warm cool wet dry dark bright ' +
      'clean dirty empty full free real whole same other own next last first second third final only main ' +
      'public private local open closed late early young dead live red blue green black white grey gray ' +
      'brown yellow orange pink purple ' +
      // materials, which take the accent on the noun ("glass DOOR", "steel BOX")
      'stone glass steel iron wooden brick plastic metal concrete leather gold silver copper tin rubber ' +
      // determiners and numbers that FUNC doesn't hold
      'this these those every each no all both such what which whose many few more most much several another ' +
      'one two three four five six seven eight nine ten eleven twelve twenty hundred thousand ' +
      // verbs that take a bare noun object ("play BALL", "clean HOUSE")
      'play hit take make get give find keep leave see need want buy sell build run own').split(' '));
    const ADJ_END = /(ful|ous|ive|able|ible|less|ish|est|ly|[^e]ed|'s)$/;
    // The exceptions. FIRST: names and set phrases whose first word looks like an
    // adjective but takes the accent anyway. FINAL: a head that is accented after all.
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

      // 4. The nucleus, one per phrase (any break ends one, '_M' included): the last
      // word in caps, else the last new content word that kept its accent, else the
      // last given one, which gets its accent back. Something has to carry the phrase.
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

    // THE SOLD NUCLEUS. A phrase sold hard (deliveryFor) leans on one vowel and holds it:
    // the last emphatic one (a word in caps), else the light nucleus placeAccents chose,
    // else the last stressed one, which is where English puts the nuclear accent ("glove
    // save, Oye-LAAA-ran"). One per terminal phrase; '^' takes the place of the '+'.
    function soldNucleus(phon) {
      const res = []; let seg = [];
      const flush = () => {
        // A phrase with a drawn-out word already says which sound it leans on.
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

    const ABBREV = new Set(['mr','mrs','ms','dr','st','jr','sr','prof','sgt','lt','capt','col','gen','inc','ltd','vs','approx','dept']);   // NOT "no" — "no." ends sentences far more often than it abbreviates number
    function textToPhonemes(text){
      const seq = [];
      // Multi-character marks come FIRST in the alternation or "..." arrives as three
      // full stops — three terminal pauses and three declination resets for one
      // trailing-off. `-{2,}`/em-dash only: a hyphen inside a word (well-known) is
      // not a break and must stay inside the word token.
      const toks = expandNumbers(text).trim().split(/(\s+|\.{2,}|!{2,}|…|—|–|-{2,}|[.,!?;:()])/).filter(Boolean);
      const PUNCT = /^(\.{2,}|!{2,}|…|—|–|-{2,}|[.,!?;:()])$/;
      // Two marks in a row ("?!", ", —") are ONE silence, not two. Take the longer of
      // them and drop any word gap that got in first, so the pause the writer meant
      // is the pause that plays.
      const pushBreak = code => {
        while (seq.length && seq[seq.length-1] === '_') seq.pop();
        const last = seq[seq.length-1];
        if (isBreak(last)) {
          if (PH[code].d > PH[last].d || (PH[code].term && !PH[last].term)) seq[seq.length-1] = code;
          return;
        }
        seq.push(code);
      };
      // THREE cases, not two. The first version of this had only "emphasis" and
      // "ignore", and put a wholly-capitalised line in the ignore bucket to stop
      // title cards being screamed — which meant a line that is nothing BUT a shout,
      // "FUCK!", got no emphasis at all and came out quieter and shorter than
      // ordinary speech. Exactly backwards.
      //
      //   mixed case      → the caps words are emphatic, the rest is not
      //   all caps, SHORT → the whole line is a shout; every word is emphatic
      //   all caps, LONG  → a title card or station ident; nobody is yelling it
      const { shout, shouty } = lineCaps(text);
      for (let i = 0; i < toks.length; i++) {
        const tok = toks[i];
        if (/^\s+$/.test(tok)) { tok.includes('\n') ? pushBreak('_P') : seq.push('_'); continue; }
        // A comma is not a full stop, a colon is not a comma, and a dash is not
        // either of them — see the continuation contour in speak().
        if (/^\.{2,}$|^…$/.test(tok)) { pushBreak('_E'); continue; }
        if (/^,$/.test(tok))          { pushBreak('_C'); continue; }
        if (/^[;:]$/.test(tok))       { pushBreak('_S'); continue; }
        if (/^(—|–|-{2,}|[()])$/.test(tok)) { pushBreak('_D'); continue; }
        if (/^\.$/.test(tok)) {
          // A full stop after "Mr" or after a single letter ("U.S.", "J. Vale") is not
          // the end of a sentence, and stopping dead there is the most obvious way a
          // reader gives itself away.
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
        // A drawn-out word is said as the word it is ("SCOOOORES" is scores), and the
        // held sound is marked once the run is final.
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

    // Per-narrator voice: deterministic from the name. Nothing stored — name IS the voice.
    function hashName(s){
      let h = 2166136261 >>> 0; s = (s||'').toLowerCase().trim();
      for (let i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h,16777619); }
      return h >>> 0;
    }
    function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
    // NAMED VOICES — the handful of speakers that are a CHARACTER rather than a
    // face in the crowd, and so can't be left to the hash. Merged over the
    // derived voice, so anything not overridden still comes from the name.
    //
    // 'architect' is the login greeting, and it's a woman's voice: warm, unhurried
    // and pleased to see you. It used to be a low, flat, pressed male drone (f0 78),
    // on the idea that a flat delivery of pleasant words is menacing. It was mostly
    // unpleasant to hear every login, and the lines carry the menace on their own:
    // "We kept your seat warm" lands harder from a voice that sounds like it means it.
    //
    // f0 and fshift move together. A female pitch over a male-length tract is what
    // read as nasal and thin when the hash rolled this seed at 174Hz; the phoneme
    // table holds adult male formants, and adult female ones sit about 15% higher.
    // A high open quotient and a little breath soften the source, and a wider lilt
    // with a gentle final fall is what makes it sound warm rather than read out.
    const NAMED_VOICES = {
      architect: {
        f0: 190, fshift: 1.14, speed: 1.16, ring: 0,
        oq: 0.70,            // open and soft, where a pressed glottis reads as hard
        jitter: 0.004, breath: 0.006,
        lilt: 0.085, decl: 0.11,
        // ⚠ A NAMED VOICE IS FULLY AUTHORED, INCLUDING THE TRAITS IT DOESN'T HAVE.
        // Anything absent here falls through to the dice above, so the moment
        // `drive` was added this voice quietly picked up 0.105 of it — a hand-tuned
        // character changing because somebody extended a table. Grit might well
        // suit the Architect, but that is a decision about a character, and a
        // decision nobody made is not one. Add a new trait here and to every other
        // named voice in the same commit.
        drive: 0, growl: 0,
        natural: 1, steps: 0, buzz: 0, rmod: 0, rmodHz: 30, crush: 0,
      },
    };

    function voiceFromName(name){
      const r = mulberry32(hashName(name)); const pick = arr => arr[Math.floor(r()*arr.length)];
      const named = NAMED_VOICES[(name||'').toLowerCase().trim()];
      const high = r() < 0.5;
      return Object.assign({
        f0:     high ? 120+r()*55 : 82+r()*38,
        fshift: high ? 1.02+r()*0.16 : 0.9+r()*0.12,
        speed:  1.24+r()*0.24,   // brisker again — reads as speech, not dictation
        ring:   r()<0.25 ? 0.10+r()*0.22 : r()*0.06,
        // Open quotient — see glottalWave(). Occupies the same slot in the PRNG
        // sequence the old wave-shape pick did, so replacing it does not reshuffle
        // every other parameter and rename every existing narrator's voice.
        oq:     pick([0.48, 0.58, 0.68, 0.78]),
        jitter: 0.004+r()*0.016,
        // Breath is the only noise that runs CONTINUOUSLY — every vowel, nasal and
        // liquid — so it contributes far more to a general impression of hiss than
        // its level suggests, and it is the first thing to cut when the voice reads
        // as noisy. It used to be `r()*0.02`, which gave EVERY voice some: a uniform
        // roll means nobody draws zero, so the whole cast whispered a little all the
        // time. Most real voices aren't breathy, so two thirds now get none at all
        // and the rest get a bit more than before — which is both quieter overall
        // and more distinguishing, since breathiness now actually marks a voice out.
        breath: r() < 0.34 ? 0.010 + r()*0.014 : 0,
        // Per-voice prosody, so two narrators don't rise and fall identically.
        // Intonation is most of what separates "a person talking" from "a machine
        // reading" — a flat F0 is the single most robotic thing a formant synth does.
        lilt:   0.05+r()*0.05,   // how far F0 moves on a stressed vowel
        decl:   0.10+r()*0.05,   // phrase-final declination (pitch falls as breath goes)
        // ⚠ EVERYTHING NEW GOES AT THE BOTTOM. These draw from the same sequence,
        // so a field inserted above would shift every draw after it and silently
        // rename every narrator in the game — the `oq` note above is this same
        // rule, learned the hard way once already.
        //
        // DRIVE — transmission grit. Most of what a listener reads as "this came
        // through equipment" is clipping, not filtering, and almost every voice in
        // this game arrives over a transmitter. Two thirds of the cast get none,
        // for the same reason two thirds get no breath: a uniform roll means
        // nobody draws zero, and a trait everyone has marks nobody out.
        drive:  r() < 0.34 ? 0.10 + r()*0.22 : 0,
        // GROWL — a sub-harmonic at F0/2, which is period doubling: the voice
        // starts producing every other cycle at a different amplitude and the ear
        // reads creak, fry, or something not quite human. Deliberately RARE, and
        // deliberately not the same axis as `jitter`: jitter is aperiodic
        // roughness at a few Hz, this is a second pitch an octave down inside the
        // source itself. A voice with both is a wreck, which is occasionally what
        // is wanted.
        growl:  r() < 0.14 ? 0.03 + r()*0.06 : 0,
        // SYNTHINESS, two axes, neither rolled (so they draw nothing from the sequence).
        // `natural` (0-1) scales every human variation toward none: pitch movement, jitter
        // and shimmer, effort in the source, stress and phrase-final timing, breath. At 0
        // the voice is a machine. It never touches a segmental cue (formants and their
        // transitions, bursts, frication, the nasal zero, voicing and aspiration), so a
        // machine voice is as intelligible as a human one. `steps` rounds every pitch
        // target to a semitone. The CHARACTER axis is the other one, and colours the
        // voice without making it less natural: `buzz` mixes an impulse train into the
        // source (an LPC vocoder's excitation), `rmod` is a ring modulator at `rmodHz`
        // after the tract, and `crush` lowers the bit depth and sample rate.
        natural: 1, steps: 0, buzz: 0, rmod: 0, rmodHz: 30, crush: 0,
      }, named || null);
    }

    // ── Segment timing: ONE definition, two callers ──────────────────────────
    // Every duration rule below used to exist twice — once in the scheduling loop
    // and once, hand-mirrored, in estimateDuration. That duplication caused four
    // separate bugs: the estimate under-reported and broadcast lines landed on top
    // of the voice; the unreleased-stop rule changed in one copy and not the other;
    // the schwa exception and polysyllabic shortening were each added to one side
    // first. The estimate is not a nicety — the broadcast hold is FITTED to it — so
    // the two must agree by construction rather than by discipline.
    //
    // ctx: { nxtCode, nxt, prevCode, stress, shout, wordScale, speed }
    function sylFrom(phon, i) {
      let n = 0;
      for (let j = i; j < phon.length; j++) {
        const c = phon[j];
        if (isGap(c)) break;
        if (VOWELS.has(c)) n++;
      }
      return n;
    }
    // Polysyllabic shortening: 1 syllable 1.00, 2 → 0.94, 3 → 0.89, 4 → 0.85, and
    // flattening out, because the compression is not unbounded in real speech.
    const sylScale = n => 1 / (1 + 0.062 * Math.max(0, n - 1));

    function segmentDuration(p, code, ctx) {
      let dur = Math.max(0.03, (p.d/1000)/ctx.speed);
      // `natural` (see voiceFromName) evens the PROSODIC timing toward a uniform syllable
      // rate: phrase-final lengthening, stress, polysyllabic shortening and the held nucleus
      // all go to 1 at natural 0. The rules that are segmental cues (pre-voiced lengthening,
      // a post-vocalic /r/ or /l/ held long enough to hear) and pauses are left alone.
      const nat = ctx.nat ?? 1, ev = nat === 1 ? (k => k) : (k => 1 + (k - 1) * nat);
      // Pre-boundary lengthening — a PHRASE edge, not a word edge.
      // …and it scales with the WEIGHT of the break. A syllable before a full stop is
      // held longer than one before a comma; that difference is a large part of how a
      // listener hears which mark was written.
      if (!ctx.nxtCode) dur *= ev(1.30);
      else if (isTerm(ctx.nxtCode)) dur *= ev(1.30);
      // (a minor break is a breath of a boundary, so it gets a breath of the lengthening)
      else if (PH[ctx.nxtCode] && PH[ctx.nxtCode].minor) dur *= ev(1.08);
      else if (isBreak(ctx.nxtCode)) dur *= ev(1.18);
      // A post-vocalic /r/ is a colouring that takes time to sound: held a little longer
      // than an onset /r/, or the F3 dip that IS the /r/ is over before it is heard.
      if (code === 'R' && VOWELS.has(ctx.prevCode) && !(ctx.nxt && ctx.nxt.t === 'V')) dur *= 1.35;
      // A dark /l/ after a vowel ("goal", "ball", "full") is the same: its low F2 needs time,
      // or "what a goal" is "what a go".
      if (code === 'L' && VOWELS.has(ctx.prevCode) && !(ctx.nxt && ctx.nxt.t === 'V')) dur *= 1.3;
      if (p.t === 'V') {
        dur *= ev(ctx.wordScale);
        // AX is already the reduced vowel; shortening it again double-counts.
        dur *= ev(ctx.stress === 2 ? 1 + (ctx.shout ? 1.15 : 0.65) * TUNING.emphasis
             : ctx.stress ? 1.12 : (code === 'AX' ? 1 : 0.8));
        // Pre-voiced lengthening — the real cue behind "bad" vs "bat".
        if (ctx.nxt && (ctx.nxt.t === 'F' || ctx.nxt.t === 'S' || ctx.nxt.t === 'H')) {
          dur *= ctx.nxt.vd ? 1.25 : 0.85;
        }
        // The nucleus of a line being sold, held (see deliveryFor).
        if (ctx.held && ctx.hold) dur *= ev(ctx.hold);
      }
      // A DRAWN-OUT sound ("SCOOOOORES", "Yesss"): the writer's letters say how long. About
      // a sixth of a second a letter, so "SCOOOOOORES" holds its vowel well over a second,
      // which is how long a caller really leans on it; a selling line holds a little longer.
      if (ctx.long && (p.t === 'V' || p.t === 'N' || p.t === 'L' || p.t === 'F')) {
        const n = ctx.long, v = p.t === 'V';
        const held = (v ? LONG_V0 + LONG_V * (n - 1) : LONG_C0 + LONG_C * (n - 1)) * (ctx.longK || 1);
        dur = Math.max(dur, Math.min(v ? LONG_V_MAX : LONG_C_MAX, held));
      }
      // A phrase pause shortens in a hurry and lengthens in grief; a word juncture doesn't.
      if (p.t === 'P' && code !== '_' && ctx.pause) dur *= ctx.pause;
      return dur;
    }

    // Closure / burst / aspiration for a stop, including every allophonic scaling.
    function stopTiming(p, ctx) {
      const unreleased = !!(ctx.nxt && ctx.nxt.t === 'S');
      let asp = (p.asp || 0)/1000/ctx.speed;
      if (ctx.prevCode === 'S') asp *= 0.15;                      // unaspirated after /s/
      else if (ctx.nxt && ctx.nxt.t === 'L') asp *= 0.5;          // fricated into a liquid
      // Word/phrase-final: soft release. Tapered further, because this puff has no
      // following vowel to run into and is the other half of the breathy word-end.
      else if (!ctx.nxt || ctx.nxt.t === 'P') asp *= 0.4 * TUNING.finalTaper;
      return { unreleased, asp };
    }

    // Rough total duration (s) of a phoneme run at a given speed — used to shape
    // the phrase-length prosody below (declination over the line).
    function estimateDuration(phon, speed, shout, dl) {
      // Thin wrapper over segmentDuration/stopTiming — it walks the run and adds up
      // exactly what the scheduler will schedule. Do not reimplement a rule here.
      // `dl` is the line's delivery (deliveryFor), for the held nucleus and the pauses.
      let t = 0.08, stress = 0, prevCode = null, held = false, long = 0;
      let wordScale = sylScale(sylFrom(phon, 0));
      for (let i = 0; i < phon.length; i++) {
        const code = phon[i];
        if (code === '^') { held = true; continue; }
        if (isLong(code)) { long = +code.slice(1) || 0; continue; }
        if (isMark(code)) { stress = code === '!' ? 2 : 1; continue; }
        const p = PH[code]; if (!p) continue;
        let j = i + 1; while (isMark(phon[j])) j++;
        const nxtCode = phon[j], nxt = PH[nxtCode];
        if (p.t === 'P') wordScale = sylScale(sylFrom(phon, i + 1));
        const ctx = { nxtCode, nxt, prevCode, stress, shout, wordScale, speed, held, hold: dl && dl.hold, pause: dl && dl.pause, long, longK: dl && dl.longK, nat: dl && dl.nat };
        const dur = segmentDuration(p, code, ctx);
        long = 0;
        if (p.t === 'V') { stress = 0; held = false; }
        if (p.t === 'F' && p.stopFirst) t += AFFRICATE_CLOSURE;
        if (p.t === 'S') {
          const { unreleased, asp } = stopTiming(p, ctx);
          t += dur*0.6 + 0.02 + (unreleased ? 0 : asp);
        } else {
          t += dur;
        }
        if (code !== '_') prevCode = code;
      }
      return t;
    }

    // ── Glottal source ───────────────────────────────────────────────────────
    // The vocal folds do not emit a sawtooth. They emit a pulse: a slow opening,
    // a faster closing, and then a hard slam shut — and it is that discontinuity
    // at closure that puts energy in the harmonics a formant filter needs. A raw
    // saw has the wrong envelope and no closure event at all, which is why the
    // old voice read as a buzzer being filtered rather than as a throat.
    //
    // This builds the Rosenberg glottal pulse in the time domain, differentiates
    // it (the lips radiate the DERIVATIVE of glottal flow — that's where the free
    // +6dB/octave of speech comes from), and DFTs the result into a PeriodicWave.
    // Cost is one 512-point DFT over 48 harmonics per voice, once, at build time.
    // At runtime it is the same single OscillatorNode as before.
    //
    // OPEN QUOTIENT is the expressive knob: the fraction of the cycle the folds
    // are apart. High OQ (~0.8) is a breathy, soft, sinusoidal source; low OQ
    // (~0.45) is pressed and bright. It is most of what separates two human
    // voices that share a pitch, so it stands in for the old saw/square pick.
    const _waveCache = new Map();
    // BUZZ (0-1, a voice's `buzz`) mixes in an impulse train, every harmonic at one level:
    // the excitation an LPC vocoder uses, so the tract is the same and the throat isn't.
    // Matched to the pulse's RMS, and rescaled after the mix to the level the pulse alone
    // would have had once Web Audio peak-normalised it. 0 takes the old path exactly.
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
        // the pulse's own peak, which is what normalisation divides it by
        let pk = 0, em = 0;
        for (let i = 0; i < N; i++) {
          let v = 0; const a = 2 * Math.PI * i / N;
          for (let h = 1; h <= H; h++) v += g.real[h] * Math.cos(h * a) + g.imag[h] * Math.sin(h * a);
          pk = Math.max(pk, Math.abs(v));
        }
        for (let h = 1; h <= H; h++) em += real[h] ** 2 + imag[h] ** 2;
        // BUZZ_TRIM: a flat source puts more into F2 and up than the pulse does, so at one
        // source RMS the voice came out about 3 dB louder through the bank (measured after
        // the compressor in the Voice Lab); trimmed in proportion to the mix
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
      // Derivative, circular so the closure discontinuity is preserved.
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

    // ── Speech noise: pink, not white ────────────────────────────────────────
    // White noise carries equal energy per Hz, which means ever-increasing energy
    // per OCTAVE — it is far brighter than any sound a throat makes, and it is
    // what was left making the fricatives hiss after their levels came down. Real
    // aspiration and frication sit much closer to a -3dB/octave slope. The
    // bandpass shapes the peak, but its skirts pass a lot, and with white noise
    // those skirts are all top end.
    //
    // Its OWN buffer, deliberately: getNoiseBuffer() is shared with the SFX engine
    // and engineNodes(), and pinking that would quietly re-voice every other sound
    // in the game. Paul Kellett's filter — the standard cheap pinker.
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
      // NORMALISE, don't guess a scale factor. The pinking filter's output level
      // depends on its coefficients, and an eyeballed multiplier had it landing at
      // RMS 0.72 against white noise's 0.577 — i.e. every fricative would have come
      // back ~2dB LOUDER and quietly undone the level cuts this was meant to
      // complement. Target 0.5 (a shade under white), then guard the peak so a rare
      // excursion can't clip the bus.
      // NORMALISE by RMS to just under white's 0.577, so the per-phoneme `ng` levels
      // — which were tuned against the white buffer — carry over unchanged and this
      // is purely a change of COLOUR, not of loudness. An eyeballed scale factor had
      // it at 0.72, i.e. ~2dB louder, quietly undoing the level cuts it was meant to
      // complement.
      //
      // Deliberately NOT peak-limited. Pink from this filter is heavy-tailed, so
      // clamping to ±1 hit 4.5% of samples (audible distortion) and rescaling by the
      // single loudest sample cost ~5dB. Neither is needed: the buffer is float32 and
      // noiseG scales it to 0.11–0.24 long before the bus, so a peak of 1.5 leaves
      // headroom to spare.
      let sum = 0; for (let i = 0; i < n; i++) sum += d[i]*d[i];
      const g = 0.5 / Math.sqrt(sum/n);
      for (let i = 0; i < n; i++) d[i] *= g;
      _speechNoise = buf;
      return buf;
    }

    // ── Speech channels ──────────────────────────────────────────────────────
    // There used to be one voice for everything, so each speak() cut off the
    // last: the PA, the welcome, the TV and Read Aloud all talked over each
    // other by cancelling each other, and a typed command (which cancels Read
    // Aloud) silenced the television too.
    //
    // Three channels now, each with its own lines:
    //   tv     the TV, the announcer, the PA, the welcome. Rides the tv bus's
    //          voice sub-gain.
    //   scene  voices inside a broadcast's picture (`channel: 'scene'`): an
    //          umpire, a stadium's public address. Routed as tv, but a line
    //          here never cuts off the booth on 'tv', nor the booth it.
    //   ui     Read Aloud (`channel: 'ui'`). Rides the dry ui bus.
    // A new line cancels only its own channel, or with `queue: true` waits
    // behind it. cancel('ui') is what a typed command or Escape does;
    // cancel() with no channel still stops everything, for the TV panel and
    // the Voice Lab.
    //
    // The channels don't cancel each other. Instead a Read Aloud line ducks
    // the tv bus by READER_DUCK_DB for as long as it speaks, so the reader is
    // heard over the TV rather than instead of it.
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
    // The duck a Read Aloud line puts on the TV, for a reader that isn't this
    // synth: logreader.js calls it from a natural utterance's start event and
    // releases it from the end event.
    const readerDuck = (opts) => duck(['tv'], READER_DUCK_DB, opts || {});
    // Seconds until a channel falls silent (0 when it is), queued lines included: for a
    // caller that wants to keep its own sounds out from under a voice.
    function left(channel = 'tv') {
      const ch = CHANNELS[channel];
      if (!ctx || !ch) return 0;
      return ch.lines.reduce((m, l) => Math.max(m, l.end - ctx.currentTime), 0);
    }

    // ── The worklet back end (a prototype) ───────────────────────────────────
    // `backend: 'worklet'` on a speak() swaps the phoneme→audio stage and nothing else.
    // The loop in speak() schedules exactly what it schedules for the graph, but into
    // RECORDERS that stand in for the source-side nodes (glottis, formant bank, nasal zero,
    // noise paths, voicing gains). After the loop the recorders are sampled into one
    // parameter track per control, a frame every WK.frame seconds, with Web Audio's own
    // setTargetAtTime/setValueAtTime semantics, and the tracks go to oracle-worklet.js,
    // which runs an LF glottal pulse per cycle into a Klatt-style cascade. The output
    // stage (ring, presence, compressor, drive, PA) is the same real nodes for both.
    //
    // Only the dev panel's Voice Lab asks for it. Until the module has loaded in the live
    // context a worklet line falls back to the graph, and speak() says which one it used.
    const WK_TRACK = ['f0', 'jitA', 'jitB', 'av', 'ah', 'af', 'f1', 'f2', 'f3', 'f4', 'q1', 'q2', 'q3', 'q4',
      'nf', 'nq', 'nzf', 'nzdb', 'tilt', 'closure'];   // ⚠ the same list, in the same order, as TRACK in oracle-worklet.js
    const WK = {
      frame: 0.005,     // track resolution, s
      cascK: 0.10,      // the cascade's level against the frication branch (a cascade peaks
                        // at F1/B1 over its DC gain; the graph's bank is unity at each peak).
                        // Set so both back ends read within ~1 dB on the Voice Lab's level line
      srcK: 1, aspK: 1, fricK: 1, closureK: 1,
      bwK: 1,           // every formant bandwidth, scaled
      tiltK: 1,         // the graph's tilt corner, scaled, becomes the LF return phase
      emph: 0.88,       // one-zero pre-emphasis into the cascade, unity at 500 Hz. Without it
                        // the cascade is Klatt's theory exactly and 6-11 dB darker at F3 than
                        // Peterson & Barney's vowels (this voice's oq of 0.78 is a soft source);
                        // at 0.88 /a i u/ land within 2-3 dB of their F2 and F3 levels
      rk: 0.72,         // tp / te: where the flow peaks within the open phase
      oqEffort: 0.12,   // open quotient falls this much per unit of voicing over 0.8
      oqBreath: 1.0,    // and rises this much per unit of aspiration
      cycJitter: 0.5,   // per-cycle random jitter, as a share of the LFO jitter depth
      shimmer: 0.02,    // per-cycle amplitude spread
    };
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
      // Web Audio's timeline: events in time order (ties in the order they were made), a
      // target approached from wherever the param was when the event began.
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

    // ── A matchup, said the way a booth says it ──────────────────────────────
    // "Wharf Rats–Warlords" is two clubs, and a booth reads it "Wharf Rats versus
    // Warlords". An en dash between two names reads that way only for a voice that
    // asks (`vs` among its parameters: the CPhL booth's @voice). In a book the same
    // dash is a route or a span ("the London–Paris express") and says nothing, and a
    // hyphen never does: "Smith-Jones" is one name.
    const readMatchups = (text) => String(text).replace(/(\p{L})\s*–\s*(?=\p{Lu})/gu, '$1 versus ');

    // speak(text, { seed, voice, lex, accent, pa, channel, excite, budget, gain }). `excite` is how
    // hard the line is being sold, -1 (grave) to 1 (a goal call); see deliveryFor. The
    // hockey booth sends one with every line; nothing else does, and 0 changes nothing.
    // `gain` (0-1, default 1) sets a voice under the others on its bus, as an umpire
    // sits under the booth; Read Aloud ignores it.
    function speak(text, opt = {}){
      // `channel: 'ui'` is the log reader (client/game/js/logreader.js) — the
      // voice as an ACCESSIBILITY surface rather than as a broadcast. It bypasses
      // the TV toggle, because a player who muted the television has not asked to
      // be unable to read the game, and it rides the sfx bus so the TV volume
      // slider doesn't set how loud the game is read to them. The master Sound
      // switch still silences it: that one means silence.
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
      // `opt.voice` overrides individual parameters on top of whatever the seed
      // rolled. Nothing in the game passes it — this exists so a voice can be
      // AUDITIONED. Character comes from hashing a name, so before this the only
      // way to hear what `drive` or `growl` sound like was to type seeds until one
      // happened to roll them, which is not tuning, it is fishing. The dev panel's
      // voice lab drives this; the values it prints go straight into NAMED_VOICES.
      const V = Object.assign(voiceFromName(opt.seed || text), opt.voice || null);
      if (V.vs) text = readMatchups(text);
      // How hard the line is sold (deliveryFor). Never on the accessibility channel: a
      // screen reader that gets excited about a goal is harder to follow, not livelier.
      const D = deliveryFor(ui ? 0 : Math.max(-1, Math.min(1, (+opt.excite || 0) * TUNING.excitement)));
      const F0 = V.f0 * D.pitch, ringAmt = V.ring, fshift = V.fshift;
      // ⚠ NO CHARACTER ON THE ACCESSIBILITY CHANNEL. Drive and growl are texture:
      // clipping and period doubling both make a voice more interesting and less
      // intelligible, which is a fine trade for a narrator and the wrong one for
      // the log reader. `reader` genuinely rolled growl 0.084 the moment these
      // existed — the seed does not know what it is for, so the caller has to say.
      //
      // This is the same rule as the dry `ui` bus a few lines up, applied to the
      // source instead of the routing: everything that makes the world sound rich
      // makes a screen reader worse.
      const driveAmt = ui ? 0 : (V.drive || 0);
      const growlAmt = ui ? 0 : (V.growl || 0);
      // SYNTHINESS (see voiceFromName). `nat` scales human variation and nothing else;
      // `mix(k)` moves a factor k toward 1, no variation, as nat falls. It is
      // allowed on the accessibility channel, because it costs no intelligibility. The
      // character effects are texture, like drive, so the reader gets none of them.
      const nat = Math.max(0, Math.min(1, V.natural ?? 1));
      const mix = nat === 1 ? (k => k) : (k => 1 + (k - 1) * nat);
      D.nat = nat;
      const clamp01 = x => Math.max(0, Math.min(1, +x || 0));
      const buzzAmt = ui ? 0 : clamp01(V.buzz), rmodAmt = ui ? 0 : clamp01(V.rmod), crushAmt = ui ? 0 : clamp01(V.crush);
      // `steps`: every pitch target rounded to a semitone from the voice's F0.
      const pq = V.steps ? (f => F0 * 2 ** (Math.round(12 * Math.log2(f / F0)) / 12)) : (f => f);
      // Set → convert → clear, all synchronously (see lexLook).
      _lex = opt.lex || null;
      let phon;
      try {
        phon = applyAccent(textToPhonemes(text), opt.accent);
        phon = applyAssimilation(phon);
        // RP does not flap; the Library reads in RP, the network reads in GA.
        if (opt.accent !== 'rp') phon = applyFlap(phon);
      }
      finally { _lex = null; }
      if (!phon.length) return;
      // THE NUCLEUS of a line being sold, held (see soldNucleus).
      if (D.e >= 0.35) phon = soldNucleus(phon);
      // Every line reads at the narrator's own pace, however long it is. There used
      // to be a fit-to-window compression here (speed up so a long line landed before
      // the next one), but a voice that gabbles the long lines and strolls the short
      // ones reads as broken rather than busy — and the airtime hold is already scaled
      // to the text (broadcast's nodeHoldMs), so the window is the thing that should
      // stretch, not the speech. opt.budget is still accepted and deliberately unused.
      // RHYTHM COMPENSATION — the overall pace knob. Reduction shortens unstressed
      // syllables, and a human who reduces doesn't talk faster (the stressed
      // syllables take the time back), so a constant restores the average rate and
      // leaves the CONTRAST intact. This was 0.75, which was too slow — it was set
      // against an estimateDuration that under-reported the real length, and it
      // dragged `speed` down to ~1.0 where a second bug (pauses divided by speed
      // twice) inflated every inter-word gap. Both are fixed; 0.85 puts the slowest
      // voice at ~74ms/char and an average one near 68, which is inside the range
      // of ordinary human speech. LOWER IS SLOWER. Raise toward 0.9 if it still
      // drags. Broadcast's nodeHoldMs is fitted to this number — re-measure both
      // together if the phoneme durations are ever retuned.
      const speed = V.speed * TUNING.rate * D.rate;
      // 'ui' is a DRY bus (see busFor). Read Aloud is the caller, and a screen
      // reader carrying the room's reverb is harder to understand, not richer.
      const out = busFor(ui ? 'ui' : 'tv_voice');
      // Which back end makes the sound (see WK above). `S` builds the source side: real
      // nodes for the graph, recorders for the worklet.
      const wk = opt.backend === 'worklet' && _wkState.get(c) === true && typeof global.AudioWorkletNode === 'function';
      if (opt.backend === 'worklet' && !wk) loadOracleWorklet(c);
      const S = wk ? REC : c;
      // (the worklet's closed-tract crossfade; the graph does the same with the bank's gains)
      const closure = wk ? new RecParam(0) : null;

      const master = c.createGain(); master.gain.value = 0.9 * (ui ? 1 : Math.max(0, Math.min(1, opt.gain ?? 1)));
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
      // A high SHELF lifts everything above its corner and never comes back down, so
      // +5.5dB at 2.6k boosted the 6–8kHz sibilant band by the full amount too — it
      // bought consonant clarity and paid for it in hiss. A wide peak centred on the
      // intelligibility band does the same job and leaves the sibilants alone.
      presence.type = 'peaking'; presence.frequency.value = 3000;
      presence.Q.value = 0.9; presence.gain.value = TUNING.presenceDb + 2 * D.e;
      // Keeps a loud vowel from swamping the consonant that follows it — the voice
      // sits at one level instead of lunging, which reads as microphone technique.
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -22; comp.knee.value = 12; comp.ratio.value = TUNING.compRatio;
      comp.attack.value = 0.004; comp.release.value = 0.12;
      // ⚠ THE HEAD OF THE CHAIN, AND ITS FAILURE MODE IS A PERFECT SILENCE.
      // `master` is where every voiced and unvoiced branch is summed, and until it
      // reaches `out` the voice is BUILT AND MUTE: every oscillator starts, every
      // envelope schedules, speak() returns a real duration, and not a sample is
      // audible. This line was lost when the drive stage below replaced the old
      // one-liner that carried the whole chain in one go —
      // `master.connect(ringGain).connect(presence).connect(comp).connect(out)` —
      // and nothing caught it, because the voice smoke is pure text→phoneme and
      // never builds a node. A missing edge in an audio graph throws nothing.
      // RING MODULATION (`rmod`, `rmodHz`): the voice times a sine, mixed with the dry
      // voice. Unlike `ring` above, which is a 50 Hz tremolo, this one moves every partial
      // by the carrier and back, which is the Dalek sound at 30 Hz and a metallic one
      // higher up. After the tract, so it colours a finished voice and the formants are
      // the same voice's. The carrier joins the line's sources below.
      let rmodOsc = null;
      if (rmodAmt > 0) {
        const into = c.createGain(), dry = c.createGain(), wet = c.createGain();
        dry.gain.value = 1 - rmodAmt; wet.gain.value = 0;
        rmodOsc = c.createOscillator(); rmodOsc.frequency.value = Math.max(1, +V.rmodHz || 30);
        // a product of two sines carries half the power of either, so the wet side is
        // lifted by root two to keep the level
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
      // DRIVE — after the compressor, which is the order a transmitter actually
      // has: level is controlled first and THEN the stage that cannot pass more
      // than it can pass clips what is left. Driving before the compressor would
      // let the compressor pull the distortion back down and mostly undo it.
      //
      // Reuses the same normalised tanh curve buildLayer uses (cached, shared),
      // so a driven voice and a driven cue distort identically rather than being
      // two people's idea of overdrive.
      let voiceTail = comp;
      if (driveAmt > 0) {
        const vs = c.createWaveShaper();
        vs.curve = driveCurve(driveAmt);
        vs.oversample = '4x';
        // Clipping raises perceived loudness even with a normalised curve, because
        // it fills in everything under the peaks. Trimmed back so a gritty narrator
        // is not also a louder one — the two must be separable or neither is usable.
        const trim = c.createGain(); trim.gain.value = 1 - driveAmt * 0.35;
        comp.connect(vs).connect(trim);
        voiceTail = trim;
      }
      // CRUSH (`crush`, 0-1): SIREN's retro stage, sample-and-hold and bit depth, on the
      // finished voice. 0.5 is 10 bits held at 10 kHz, 1 is 4 bits at 4.2 kHz. Last in
      // the chain but the horn, as the converter on a cheap box is. The stage's worklet
      // has to outlive a queued line's wait, so it is kept up past the line's estimated end.
      if (crushAmt > 0) {
        // Quantising noise fills in under the peaks, so a crushed voice reads louder: about
        // 6 dB at 4 bits and nothing to speak of at 10. Trimmed back, as drive's is.
        const crushOut = c.createGain(); crushOut.gain.value = 1 - 0.5 * crushAmt ** 4;
        const from = Math.max(c.currentTime, queued ? chan.lines[chan.lines.length - 1].end : 0);
        const until = from + 1 + 1.5 * estimateDuration(phon, speed, undefined, D);
        const into = retroStage(c, { rate: 24000 * 2 ** (-2.5 * crushAmt), bits: Math.round(16 - 12 * crushAmt), ref: 0.6 }, {}, crushOut, until);
        voiceTail.connect(into);
        voiceTail = crushOut;
      }
      // PUBLIC ADDRESS (`opt.pa`): the voice as heard through a street horn. A
      // horn passes roughly the phone band, clips when it's pushed, and every
      // wall down the street answers it. Never on the 'ui' channel.
      if (opt.pa && !ui) {
        const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 420; hp.Q.value = 0.9;
        const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200; lp.Q.value = 1.4;
        const horn = c.createBiquadFilter(); horn.type = 'peaking'; horn.frequency.value = 1600; horn.Q.value = 1.2; horn.gain.value = 6;
        const clip = c.createWaveShaper(); clip.curve = driveCurve(0.45); clip.oversample = '2x';
        const dry = c.createGain(); dry.gain.value = 0.8;
        voiceTail.connect(hp).connect(lp).connect(horn).connect(clip).connect(dry).connect(out);
        // Two slaps off the buildings opposite, no feedback loop so nothing rings on.
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
      // The tilt filter used to be the ONLY thing standing in for glottal roll-off,
      // so it had to sit low (3.4k) and dulled the consonants along with the buzz.
      // The source now rolls off on its own, correctly, so this backs off to a
      // gentle top-end tame rather than a corrective.
      const tilt = S.createBiquadFilter();
      tilt.type = 'lowpass'; tilt.frequency.value = 5200; tilt.Q.value = 0.4;
      // JITTER + SHIMMER. A single LFO on F0 is vibrato, and vibrato is a *musical*
      // gesture — it reads as a synthesiser holding a note. Real jitter is aperiodic.
      // Two LFOs at an irrational-ish ratio beat against each other and never repeat
      // inside a phrase, which is enough to break the tone. Shimmer (the amplitude
      // half of the same roughness) rides the master gain, and matters more than its
      // size suggests: perfectly steady loudness is the other half of "machine".
      const jit = S.createOscillator(); jit.type = 'triangle'; jit.frequency.value = 9;
      const jitG = S.createGain(); jitG.gain.value = F0 * V.jitter * D.jitter * nat; jit.connect(jitG).connect(glot.frequency);
      const jit2 = S.createOscillator(); jit2.type = 'sine'; jit2.frequency.value = 6.3;
      const jit2G = S.createGain(); jit2G.gain.value = F0 * V.jitter * 0.6 * D.jitter * nat; jit2.connect(jit2G).connect(glot.frequency);
      // GROWL. Audio-rate FM on the glottal source at HALF F0 — period doubling,
      // which is the actual mechanism behind creak and vocal fry: alternate cycles
      // come out at a different amplitude and the ear stops reading one clean
      // pitch. Costs one oscillator and one gain, because the modulation path into
      // glot.frequency already exists for jitter; this is the same wire at a
      // thousand times the rate.
      //
      // Not a substitute for jitter and not on the same axis: jitter is aperiodic
      // roughness a few Hz wide, this is a second pitch an octave down inside the
      // source. Scaled by F0 so a low voice and a high one growl by the same
      // musical interval rather than the same number of Hz.
      // ⚠ Built here (it needs `glot`) but STARTED further down with everything
      // else: every source in this voice goes into `src`, which is what starts
      // them on one clock and what `cancel()` stops. An oscillator started by hand
      // here would run on past a cancelled line with nothing holding a reference
      // to stop it — a permanent tone under the game with no way to reach it.
      // GLOTTAL FM. `growl` began as one hardcoded sub-harmonic — a modulator at
      // F0/2, which is period doubling and reads as creak. Ratio, index and
      // waveform turn that one effect into a family, and the member worth having
      // is a NON-INTEGER ratio: the partials stop being harmonics of anything and
      // the voice goes inharmonic.
      //
      // WHY THAT IS NOT THE RING MODULATOR ALREADY HERE. `ring` is amplitude
      // modulation on the OUTPUT, after the formant bank — it modulates a finished
      // voice, and reads as a voice with a box on it. This is FM on the SOURCE,
      // before the tract: the formants still shape it correctly, so it reads as a
      // throat producing something a throat should not. Different mechanism,
      // different place in the chain, different thing to hear.
      //
      //   growlRatio  modulator frequency as a multiple of F0.
      //               0.5 sub-harmonic — creak, fry (the original, and the default)
      //               1   harmonic — brightens rather than roughens
      //               1.414, 2.41 inharmonic — machine, wrong, not-a-person
      //   growl       modulation index, scaled by F0 so a low and a high voice
      //               are modulated by the same musical interval
      //   growlWave   modulator waveform; square/saw are far harsher sidebands
      //   growl2      a SECOND modulator, in PARALLEL, at its own ratio
      //
      // ⚠ Parallel, where buildLayer's op2 is in series, and the difference is the
      // goal rather than an inconsistency: series compounds into one richer
      // spectrum, parallel puts two competing periodicities into the source, which
      // is what diplophonia — two pitches from one throat — actually is.
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
      const shim = S.createOscillator(); shim.type = 'sine'; shim.frequency.value = 5.1;
      const shimG = S.createGain(); shimG.gain.value = 0.05 * nat; shim.connect(shimG).connect(master.gain);
      // VOICING sits at the SOURCE, ahead of the tract. It used to gate the bank's OUTPUT,
      // which cut every resonance dead at a voiceless consonant (a real tract rings out) and
      // left nothing for noise to excite: aspiration and /h/ had to be faked as a fixed band
      // beside the formants instead of breath through them. See `aspG` below.
      const voiced = S.createGain(); voiced.gain.value = 0;
      glot.connect(voiced).connect(tilt);
      const tract = S.createGain(); tract.gain.value = 1;   // the bank's sum
      // FOUR formants, not three. F4 is fixed high energy that the ear reads as
      // "a mouth", and its absence is a large part of why three-formant synths
      // sound like a kazoo. Q comes down across the board too: the old 10/13/16
      // rang like a filter sweep, and lower Q gives broader, more natural vowels.
      // BANDWIDTH, not Q. A constant Q means bandwidth scales with centre
      // frequency, so a 270Hz F1 got a 38Hz band and a 730Hz F1 got 104Hz — high
      // vowels rang like a filter sweep and low ones smeared. Real formant
      // bandwidths are roughly CONSTANT in Hz and widen with frequency only
      // slightly, so Q is now derived per phoneme as f/BW.
      //
      // The clamp is doing real work: the physically-correct Q for a 2290Hz F2 is
      // over 20, and a bandpass that sharp starts to whistle on a synthetic
      // source that has no breath noise to fill in between the harmonics. 16 is
      // where it stops sounding like a resonance and starts sounding like a bell.
      const F_BW = [90, 130, 200, 280];
      const qFor = (f, k) => Math.max(3, Math.min(16, f / F_BW[k]));
      // Built through the SHARED bank (see buildResonatorBank up in the synth), so
      // the voice's vowels and a layer's `formants` are one implementation rather
      // than two written from the same idea. The handles come back because this
      // caller does something a static layer never does: it glides every band
      // across the utterance, phoneme to phoneme.
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

      // ── Cascade-derived formant amplitudes ───────────────────────────────────
      // A real vocal tract is a CASCADE — one tube, whose poles all shape the same
      // signal — so the relative height of each formant falls out of where the
      // others are. This is a PARALLEL bank (four filters side by side), which is
      // the only shape Web Audio can automate, and a parallel bank has to be TOLD
      // those amplitudes. It used to be told a fixed [1, 0.72, 0.42, 0.16] for
      // every vowel, which is right for none of them: when F1 and F2 sit close
      // together (back vowels like /uw/, /ao/) their skirts reinforce and F2 should
      // be strong, and when they're far apart (/iy/) it should not.
      //
      // So rather than convert the architecture, derive the gains the way Klatt's
      // parallel branch does: evaluate the cascade's all-pole transfer function at
      // each formant and use the result as that formant's gain. Normalised to F1 so
      // overall loudness stays put — only the BALANCE moves. ~16 flops per phoneme.
      // Taking the raw cascade amplitudes LITERALLY would darken the voice hard —
      // it puts F3 about 26dB under F1 where the hand-tuned bank had it at 7.5dB,
      // and F4 40dB down. That's not wrong physics, it's double-counting: the
      // glottal source already carries its own -12dB/octave, `tilt` takes more off
      // the top, and `presence` puts some back, so the bank's absolute calibration
      // was tuned by ear against all three. What it was MISSING was the
      // vowel-to-vowel variation, not the overall balance.
      //
      // So the derived gains are rescaled per index to preserve the tuned average
      // (measured across the full vowel inventory) while keeping the variation
      // around it. Brightness stays where it was; the balance now moves with the
      // vowel, which is the whole point.
      const CASCADE_FIT = [1, 1.49, 3.97, 20.17];
      const cascadeA = (F, wide) => {
        const bw = F_BW.map(b => b * (wide ? 1.8 : 1));
        return F.map((fn, n) => {
          let a = fn / bw[n];                                  // its own resonant peak
          for (let k = 0; k < 4; k++) {
            if (k === n) continue;                             // every OTHER pole's skirt
            a *= (F[k]*F[k]) / Math.hypot(F[k]*F[k] - fn*fn, bw[k]*fn);
          }
          return a;
        });
      };
      // LEVEL, NOT JUST BALANCE. These used to be normalised to F1 = 1 for every sound,
      // which kept each vowel's balance and threw away how loud it is. In a tube the F1
      // peak grows with F1 over its bandwidth, so an open /a/ is loud and a nasal murmur,
      // with its low, damped F1, is quiet. Pinned to 1, the order inverted: the source is
      // strongest low down, so /m/ came out louder than the /a/ after it, the voice bar of a
      // /b/ nearly as loud as a vowel, and every consonant with a low F1 shouted. Measured
      // against a fixed reference (the neutral vowel, through this voice's tract) the
      // vowels and sonorants land in their natural order again.
      const A_REF = cascadeA([600*fshift, 1200*fshift, 2400*fshift, 3600*fshift], false)[0];
      // A closed tract's F1. By the level model alone a 220 Hz F1 would be about a third of
      // the neutral vowel's, which puts the voice bar near -25 dB, where careful speech has
      // it. Left at full strength it sits near -16 dB, as in clear speech, where a speaker
      // voices through any closure they want heard, and that measured more intelligible:
      // the /b d g/ against /p t k/ contrast survives a small speaker and a busy room.
      const MURMUR_F1 = 1;
      const cascadeGains = (F, wide) => {
        const A = cascadeA(F, wide);
        // Clamped AFTER the rescale, or the floor would flatten exactly the
        // variation this exists to produce — half the vowels pinned to one value.
        return A.map((x, k) => Math.max(0.02, Math.min(2.5, (x / A_REF) * CASCADE_FIT[k])));
      };
      // NASAL ANTIFORMANT. When the velum opens, the nasal cavity hangs off the tract
      // as a side branch and SUBTRACTS a band — a spectral zero. That zero is what
      // tells M from N from NG; their murmurs are otherwise near-identical, which is
      // why the old table (three formant triples and a gain drop) rendered all three
      // as the same hum. A peaking filter with negative gain is a serviceable zero.
      // It sits on the voiced path only — fricative noise never goes through the nose.
      const nzero = S.createBiquadFilter();
      nzero.type = 'peaking'; nzero.frequency.value = 1500; nzero.Q.value = 4; nzero.gain.value = 0;
      tract.connect(nzero).connect(master);

      const nz = S.createBufferSource(); nz.buffer = speechNoise(c); nz.loop = true;
      // ── Noise shaping: keep the peak, lose the spill ─────────────────────────
      // A single bandpass is 2-pole, so its skirts fall at only 6dB/octave and a
      // fricative sprays energy right across the spectrum either side of the band
      // that actually identifies it. That spill is what reads as hiss — it carries
      // no phonetic information at all, because place of articulation lives in the
      // PEAK. Running a second identical bandpass in series doubles the skirt slope
      // to 12dB/octave and halves the out-of-band energy, while leaving the peak
      // exactly where it was: Web Audio normalises a bandpass to unity gain at its
      // centre frequency, so two in series are still unity there. Intelligibility is
      // untouched by construction; only the surrounding wash goes.
      //
      // The lowpass then removes the "air" above ~9kHz. English fricatives carry
      // essentially no contrastive information up there — /s/ peaks around 4–8k —
      // so it is pure hiss with nothing to lose by cutting it.
      const nbp = S.createBiquadFilter(); nbp.type = 'bandpass'; nbp.frequency.value = 4000; nbp.Q.value = 3;
      const nbp2 = S.createBiquadFilter(); nbp2.type = 'bandpass'; nbp2.frequency.value = 4000; nbp2.Q.value = 3;
      const nlp = S.createBiquadFilter(); nlp.type = 'lowpass'; nlp.frequency.value = 9000; nlp.Q.value = 0.7;
      // One helper so the two bandpasses can never drift apart — they must always
      // describe the same band or the cascade stops being a sharper version of it.
      const setNoiseBand = (f, q, when, tc) => {
        for (const n of [nbp, nbp2]) {
          if (tc) n.frequency.setTargetAtTime(f, when, tc); else n.frequency.setValueAtTime(f, when);
          n.Q.setValueAtTime(q, when);
        }
      };
      const noiseG = S.createGain(); noiseG.gain.value = 0;
      nz.connect(nbp).connect(nbp2).connect(nlp).connect(noiseG).connect(master);
      // ASPIRATION: the same noise into the TRACT, so it comes out shaped by the formants
      // exactly as the voice does. That is what /h/ is (the /h/ of "he" and of "who" differ
      // because their vowels do), what the puff after /p t k/ is (it already carries the
      // vowel coming, which is half of how a listener hears which stop it was), and what
      // breath is. The frication path above is for noise made at a CONSTRICTION: fricatives
      // and the bursts of stops, which have their own spectra and bypass the tract.
      const aspG = S.createGain(); aspG.gain.value = 0;
      nz.connect(aspG).connect(tilt);

      // A queued line starts after the last one on its channel, one line gap on.
      const after = queued ? chan.lines[chan.lines.length - 1].end + (TUNING.lineGapMs || 0) / 1000 : 0;
      const t0 = Math.max(c.currentTime + 0.05, after); let t = t0;
      // F4 is a fixed resonance of the vocal tract, not a vowel target — the phoneme
      // table only carries three. Set once; the others glide per phoneme.
      forms[3].frequency.setValueAtTime(3600 * fshift, t0);
      // Coarticulation: formants GLIDE between targets rather than snapping. The old
      // 8ms constant was effectively a jump, which is heard as a stutter between
      // sounds. 22ms is about how fast a real tongue moves.
      // `wide` damps the resonances: nasals and nasalised vowels lose energy into
      // the nose and their formants are measurably broader, which is as much of
      // the nasal quality as the antiformant is.
      // Transition RATE is a property of the articulator, not a global constant.
      // The tongue leaves a stop or a fricative constriction fast (~12ms) and moves
      // through a glide slowly (~55ms) — in fact a slow formant transition is the
      // entire acoustic definition of /w/ /y/ /r/: give them the same 22ms as a
      // stop and they stop being glides and turn into short vowels. Per-phoneme
      // `tc` supplies it; 22ms stays the default for vowels.
      const setF = (when, arr, wide, tc) => {
        const k0 = tc || 0.022;
        const F = [arr[0]*fshift*D.f1, arr[1]*fshift, arr[2]*fshift, 3600*fshift];
        const A = cascadeGains(F, wide);
        for (let k = 0; k < 4; k++) {
          // F4's FREQUENCY is fixed (it is a property of the tract, not of the vowel)
          // but its BANDWIDTH is not — nasal damping applies to every resonance, and
          // F4 was the one formant still ringing at full Q through a nasalised vowel.
          if (k < 3) forms[k].frequency.setTargetAtTime(F[k], when, k0);
          forms[k].Q.setTargetAtTime(qFor(F[k], k) / (wide ? 1.8 : 1), when, k0);
          // Amplitudes glide with the formants — stepping them would click on every
          // phoneme boundary, and the balance shift is part of the transition cue.
          fgain[k].gain.setTargetAtTime(A[k], when, k0);
        }
        if (closure) closure.setTargetAtTime(0, when, k0);
      };
      // A CLOSED TRACT: the voice bar under /b d g/ and the voicing under /v z/. With the
      // mouth shut only the lowest resonance radiates (through the cheeks and throat), so F1
      // drops to ~220 Hz and the bands above it all but vanish. Played through the full bank
      // instead, the same buzz was a nasal or a /w/: "bee" came back "me" and "bid" "with".
      // F2 and F3 still travel to the consonant's locus, silently, so the vowel after the
      // release glides out of the right place.
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
      // A breath in before a big call: you hear the caller fill his lungs, then it comes.
      // Through an open, neutral tract, like any breath.
      if (D.e >= 0.6) {
        setF(t0, [600, 1200, 2400], false, 0.01);
        aspG.gain.setTargetAtTime(ASP_BREATH_IN * (0.5 + 0.5 * D.e) * nat, t0, 0.05);
        aspG.gain.setTargetAtTime(0, t0 + 0.17, 0.03);
        t += 0.22;
      }

      // ── Prosody ─────────────────────────────────────────────────────────────
      // Two movements, both cheap and both worth more than any filter change:
      //   • DECLINATION — pitch drifts down across the phrase as breath runs out.
      //   • LILT — each vowel gets a small rise-then-fall. Flat vowels are the
      //     tell-tale of a synth; even a few percent of movement reads as human.
      // Vowel index (not phoneme index) drives the alternation so the contour
      // follows syllables rather than consonant clusters.
      // A question doesn't just end differently, it LEANS differently the whole way:
      // declination is shallower because the speaker is holding the phrase open.
      // …and that is a property of the PHRASE, not of the line: "Is it done? It is."
      // has one phrase leaning open and one closing down. Worked out per phrase below.
      const tail = String(text).trim();
      const rise  = /\?["'’”)]*\s*$/.test(tail);
      const trail = /(\.{2,}|…)["'’”)]*\s*$/.test(tail);   // a line that trails off doesn't land
      // "FUCK!" is not "lean on this word" — it is the whole line at full effort, and
      // the vowel has to be HELD. Word-level emphasis alone reads as a nudge.
      const shoutLine = lineCaps(text).shout;
      // DECLINATION RESETS PER PHRASE. Pitch drifting down as breath runs out is
      // real, but it happens over a PHRASE, not over however much text arrived in
      // one message — and a speaker re-pitches at every full stop. Taking the
      // fraction from the start of the whole line meant a long broadcast line sagged
      // monotonically from first word to last and had nowhere left to go by the end,
      // which is exactly where the long ones needed it. Split at terminal pauses and
      // give each phrase its own declination.
      const phrases = [[]];
      for (const code of phon) {
        phrases[phrases.length-1].push(code);
        if (isTerm(code)) phrases.push([]);
      }
      if (!phrases[phrases.length-1].length) phrases.pop();
      const phraseDur = phrases.map(ph => estimateDuration(ph, speed, undefined, D) || 1);
      // Per-phrase declination, read off the mark that ENDS each phrase: a question
      // holds itself open, an ellipsis sags away harder than a full stop does.
      const phraseDecl = phrases.map(ph => {
        const end = ph[ph.length-1];
        return (end === '_Q' ? V.decl * 0.45 : end === '_E' ? V.decl * 1.25 : V.decl) * D.decl * nat;
      });
      // A line being sold peaks on its exclamation: "He shoots. He SCORES!" builds through
      // the first phrase and goes all the way up on the second, two semitones higher. "!!"
      // or more goes higher again: the writer is shouting, and so, some, is a calm voice.
      const phraseK = phrases.map(ph => {
        const end = ph[ph.length-1];
        if (end === '_XX') return 2 ** (1.5 * Math.max(D.e, 0.4) * nat / 12);
        return D.e > 0 && end !== '_X' ? 2 ** (-2 * D.e * nat / 12) : 1;
      });
      const phraseBang = phrases.map(ph => (ph[ph.length-1] === '_XX' ? 2 : ph[ph.length-1] === '_X' ? 1 : 0));
      const lilt = V.lilt * D.range * nat;
      let phraseIx = 0, phraseT0 = t;
      const totalDur = estimateDuration(phon, speed, undefined, D) || 1;
      // INTRINSIC F0. High vowels sit a little higher in pitch than low ones — the
      // raised tongue body pulls on the larynx. It correlates inversely with F1, so
      // it comes straight off the formant target rather than needing a table: /iy/
      // (F1 270) lands ~+4%, /aa/ (F1 730) ~-2%. Tiny, and its absence is part of
      // why synthetic vowels sound like they're all at the same pitch — because
      // they literally are.
      const intrinsicF0 = f1 => 1 + Math.max(-0.025, Math.min(0.045, (500 - f1) / 500 * 0.05)) * nat;

      // MICROPROSODY. Pitch is perturbed by the consonant just released: after a
      // voiceless obstruent it starts high and falls into the vowel, after a voiced
      // one it starts low and rises. Real, small, and free here.
      let micro = 1;

      // BOUNDARY TONE — what the pitch does going INTO the mark. Each punctuation
      // mark has its own, and it is most of what tells the ear which one was written:
      // a comma rises and hands over, a colon holds level and announces, a dash breaks
      // off flat, an ellipsis drifts down and away, a question climbs.
      // A minor break (_M, one nobody wrote) gets the lightest of these: the clause goes on.
      const BOUNDARY = { _C: 1.07, _S: 1.05, _D: 1.04, _E: 0.955, _Q: 1.13, _X: 1.02, _XX: 1.03, _M: 1.035 };
      // ACCENTS. placeAccents marks one vowel a phrase '+' (the nucleus) and leaves '*' on
      // the other accented words; these are the shapes they get, in units of the voice's
      // lilt, so natural 0 (lilt 0) still reads flat.
      //   - The NUCLEUS of a statement is a fall (H* L): up on the vowel, then down
      //     through it, and whatever follows in the phrase stays down there. That fall is
      //     most of what an English listener hears as "this is the word that mattered".
      //     Before a comma, colon, dash or minor break it only half falls and the boundary
      //     tone lifts it again, the clause handing over; in a question it is low (L*)
      //     and the question's rise does the rest.
      //   - A PRENUCLEAR accent is a peak, and each one in a phrase is a step below the
      //     last (DOWNSTEP), which is how a long line comes down to its nucleus instead
      //     of bobbing level the whole way.
      //   - Emphasis ('!') stays above all of them; a held '^' keeps its own climb.
      const ACC = { nuc: 1.6, pre: 1.15, down: 0.6, fall: 1.0, half: 0.3, low: 0.6, postFall: 0.9, postStress: 0.75 };
      const nucKind = end => (end === '_Q' ? 'low' : !end || isTerm(end) ? 'fall' : 'cont');
      // state through the run: the nucleus kind once it has been said this phrase, the
      // prenuclear accents so far (downstep), and how much of the declination a minor
      // break has given back
      let afterNuc = null, downN = 0, declOff = 0;
      const pitchAt = (when, frac, stressed, f1, nextCode, nuc, dur) => {
        const fall = 1 - (phraseDecl[phraseIx] ?? V.decl) * Math.max(0, frac - declOff);   // declination
        // Emphasis is a level ABOVE stress, not a louder version of it — it moves
        // pitch about twice as far, which is what makes "it is GONE" land.
        let lift, fallTo = 0;
        if (stressed === 2) lift = 1 + lilt * 3.4 * TUNING.emphasis;
        else if (nuc === 'low') lift = 1 - lilt * ACC.low;
        else if (nuc && !dur) lift = 1 + lilt;   // a held or drawn nucleus: its own climb or sag starts from a plain accent
        else if (nuc) lift = 1 + lilt * ACC.nuc * (downN ? ACC.down : 1);   // downstepped once if anything came before it
        else if (afterNuc === 'fall') lift = 1 - lilt * (stressed ? ACC.postStress : ACC.postFall);
        else if (afterNuc === 'cont') lift = 1 - lilt * ACC.half;
        else if (stressed && !afterNuc) { lift = 1 + lilt * ACC.pre * ACC.down ** downN; downN++; }
        else lift = 1 - lilt * 0.45;
        if (nuc === 'fall') fallTo = 1 - lilt * ACC.fall;
        else if (nuc === 'cont') fallTo = 1 - lilt * ACC.half;
        if (nuc) afterNuc = nuc;
        // CONTINUATION RISE. A comma is not a full stop: the clause is unfinished and
        // English says so by rising (or at least not falling) into the pause. Without
        // it a list reads as a series of separate little sentences, because every
        // clause got the same terminal fall.
        const hold = mix(BOUNDARY[nextCode] || 1);
        const f = pq(F0 * (phraseK[phraseIx] ?? 1) * fall * lift * hold * intrinsicF0(f1) * mix(micro));
        // (a stepped voice steps: a glide between semitones is a voice sliding again)
        glot.frequency.setTargetAtTime(f, when, V.steps ? 0.012 : 0.05);
        // the nucleus falls from its peak through the back of the vowel
        if (fallTo && dur) glot.frequency.setTargetAtTime(pq(F0 * (phraseK[phraseIx] ?? 1) * fall * fallTo * hold * intrinsicF0(f1)), when + dur * 0.35, Math.max(0.03, dur * 0.3));
        micro = 1;
        // SPECTRAL TILT tracks effort. A voice raised in emphasis doesn't just get
        // louder and higher, it gets BRIGHTER — the folds close harder and the
        // source spectrum tilts up. Moving the tilt filter with stress is what
        // makes an accent read as effort rather than as a volume knob.
        // (natural 0 holds the source at one effort: the plain tilt, at no delivery)
        const tf = stressed === 2 ? TUNING.tiltEmph : stressed ? TUNING.tiltStress : TUNING.tiltPlain;
        tilt.frequency.setTargetAtTime((nat === 1 ? tf : TUNING.tiltPlain + (tf - TUNING.tiltPlain) * nat) * mix(D.bright), when, 0.04);
        return f;
      };

      // Vowel REDUCTION is no longer done here. It used to be a blend toward schwa
      // applied to any unstressed vowel, which over-reduced the ones that keep
      // their colour ("happy" came out "happuh"). It is now lexical: the dictionary
      // says which vowels are schwa and cmuLook emits AX for them, so by the time
      // the run reaches this loop the reduction has already happened, correctly.
      // What's left here is the part that really is phonetic — length and loudness.

      // Lookahead helpers that step over stress markers (not sounds).
      const phAt = (i) => { while (isMark(phon[i])) i++; return PH[phon[i]]; };

      // POLYSYLLABIC SHORTENING — see sylFrom/sylScale above. A syllable gets shorter
      let wordScale = sylScale(sylFrom(phon, 0));
      let pendingStress = 0, pendingHeld = false, pendingLong = 0, prevNasal = false, prevP = null, prevCode = null;
      let pendingNuc = null;   // the kind of nucleus ('+') the next vowel carries, read off the break that ends its phrase
      const holdK = shoutLine ? Math.min(D.hold, 1.4) : D.hold;   // a shout is already held

      // `opt.trace`: an array the caller passes to get each phoneme's scheduled start (s,
      // from the line's start). For the voice lab and the measurement scripts; costs a push.
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
        const segCtx = { nxtCode, nxt, prevCode, stress: pendingStress, shout: shoutLine, wordScale, speed, held: pendingHeld, hold: holdK, pause: D.pause, long, longK: D.longK, nat };
        let dur = segmentDuration(p, code, segCtx);
        // (pre-boundary, polysyllabic, stress, schwa and pre-voiced rules all live in
        //  segmentDuration now — see the note there.)

        if (p.t==='V' || p.t==='N' || p.t==='L') {
          const stressed = pendingStress; pendingStress = 0;
          const held = pendingHeld && p.t === 'V'; if (p.t === 'V') pendingHeld = false;
          let f = p.f;
          // Dark /l/ unless a vowel follows it.
          if (p.df && !(nxt && nxt.t === 'V')) f = p.df;
          // POSTVOCALIC /r/ is not the consonant of "red". After a vowel and before anything
          // else ("four", "board", "score") it is an r-colouring of that vowel: F3 falls hard
          // and the voice carries on at nearly full strength. As a consonant (low F1, quiet,
          // slow to arrive) it was heard as a dark /l/: "four" came back "full", "boards"
          // "balls", "scoreboard" "skullboard".
          const rhotic = code === 'R' && prevP && prevP.t === 'V' && !(nxt && nxt.t === 'V');
          if (rhotic) f = RHOTIC;
          // Nasal coupling: the velum is slow, so a vowel touching a nasal is itself
          // partly nasalised. Cheap here, and it's the difference between a nasal
          // that's glued to its word and one that sounds spliced in.
          const nasalNext = nxt && nxt.t === 'N';
          const nasal = p.t === 'N', nasalised = nasal || prevNasal || nasalNext;
          // Nasal coupling RAISES F1 as well as damping it — a nasalised vowel isn't
          // simply a duller vowel, it's a slightly higher-F1 one. Applied to the
          // vowel, not to the murmur, which already has its own low F1.
          if (nasalised && p.t === 'V') f = [f[0]*1.07, f[1], f[2]];
          // ── UNDERSHOOT ────────────────────────────────────────────────────────
          // Everything above renders each phoneme at its CANONICAL target. Real
          // speech doesn't get there: a short unstressed vowel wedged between two
          // consonants runs out of time and lands somewhere between its own target
          // and the constrictions on either side. That is Lindblom's undershoot,
          // and it is the systematic difference between a correct sequence of
          // phonemes and connected speech — a 60ms schwa was previously hitting
          // exactly the same formants as a 160ms stressed vowel.
          //
          // The blend is exponential in duration (tau ≈ 75ms, so a 160ms vowel
          // barely moves and a 50ms one goes half way) and STRESSED vowels resist,
          // because speakers hyperarticulate exactly where the information is.
          //
          // BUT IT IS MOSTLY REDUNDANT, and this was set far too high at first. The
          // setTargetAtTime glide ALREADY undershoots: at a 22ms time constant a
          // 45ms vowel physically cannot arrive, which is exactly the phenomenon
          // this models. Applying an explicit blend on top undershot everything
          // twice — the schwa in "some" then spent its whole life near the /s/
          // locus at F2≈1500 and the word came out "sim". The glide is the primary
          // model; this is a small correction on top of it, not a substitute.
          if (p.t === 'V' && !p.to) {
            const ctx = [];
            if (prevP && (prevP.lf || prevP.f)) ctx.push(prevP.lf || prevP.f);
            if (nxt && (nxt.lf || nxt.f)) ctx.push(nxt.lf || nxt.f);
            if (ctx.length) {
              const loc = [0,1,2].map(k => ctx.reduce((s,c) => s + c[k], 0) / ctx.length);
              // (from the length the vowel has at natural 1: evening the timing out must
              // not move a single formant target)
              const durN = nat === 1 ? dur : segmentDuration(p, code, { ...segCtx, nat: 1 });
              let blend = Math.exp(-durN / 0.075);
              if (stressed) blend *= stressed === 2 ? 0.25 : 0.5;
              f = f.map((v, k) => v + (loc[k] - v) * blend * TUNING.undershoot);
            }
          }
          // A glide is defined by how SLOWLY it lets go: the tongue or lips reach the /w r j/
          // target quickly and then ease into the vowel over 50 ms or more, where /l/ snaps
          // open. The approach is the glide's own `tc`; the release is the VOWEL's, so it is
          // read off what came before. With every vowel gliding in at 22 ms the glides lost
          // the one thing that makes them glides ("reared" heard as "weirded", "rose" as
          // "was"), and /l/ blurred into the vowel ("slid" heard as "sit").
          const release = p.t === 'V' ? GLIDE_RELEASE[prevCode] : 0;
          const dark = p.df && f === p.df;
          setF(t, f, nasalised, rhotic ? 0.018 : release || (dark ? 0.016 : p.tc));
          if (nasal) {
            nzero.frequency.setTargetAtTime(p.az, t, 0.008);
            nzero.gain.setTargetAtTime(-22, t, 0.010);
          } else if (code === 'L') {
            // A LATERAL has a zero too: the air goes round the tongue on both sides, and the
            // short side channel cancels a band near 2.3 kHz. A mild one keeps /l/ from
            // reading as a vowel or, with its low F1, as a nasal ("lemons" heard as "mammals").
            nzero.frequency.setTargetAtTime(2300 * fshift, t, 0.008);
            nzero.gain.setTargetAtTime(-9, t, 0.010);
          } else {
            // The zero has to state its frequency too. Setting only the GAIN left
            // the notch wherever the last nasal put it — or at the 1500Hz default —
            // so a nasalised vowel got a 7dB hole at an arbitrary place in its
            // spectrum. Same class of bug as the breath band playing through the
            // /s/ filter. Aim it at whichever nasal this vowel is touching.
            const az = (nasalNext && nxt.az) || (prevNasal && prevP && prevP.az) || 1000;
            if (nasalised) nzero.frequency.setTargetAtTime(az, t, 0.020);
            nzero.gain.setTargetAtTime(nasalised ? -7 : 0, t, 0.020);
          }
          let vg = p.t==='V' ? (stressed === 2 ? (shoutLine ? 1.4 : 1.25) : stressed ? 0.95 : 0.72) : rhotic ? 0.85 : code === 'L' ? 0.5 : 0.6;
          vg *= p.t === 'V' && stressed ? D.loud : 1 + (D.loud - 1) * 0.5;
          // DEVOICING. An unstressed vowel trapped between two voiceless obstruents
          // is partly or wholly whispered in ordinary speech — the folds simply never
          // get going between "p" and "t". It's the first vowel of "potato",
          // "support", "suppose", and voicing it fully is a small but constant
          // over-articulation, the sound of a machine pronouncing every letter it was
          // given. The breath fills in what the voicing gives up, so the syllable is
          // still there; it just isn't sung.
          const voicelessBefore = prevP && (prevP.t==='F'||prevP.t==='S'||prevP.t==='H') && !prevP.vd;
          const voicelessAfter  = nxt   && (nxt.t==='F'  ||nxt.t==='S'  ||nxt.t==='H')   && !nxt.vd;
          const devoiced = p.t==='V' && !stressed && voicelessBefore && voicelessAfter;
          if (devoiced) vg *= 0.35;
          voiced.gain.setTargetAtTime(vg, t, 0.012);
          // SYLLABLE ENVELOPE. A real syllable rises to a peak and falls away; a flat
          // target for the whole vowel is a plateau, and a run of plateaus is the
          // organ-like quality that survives even when every formant is right. Decay
          // through the back half so each vowel has a shape instead of a level.
          // (a held nucleus doesn't sag: the caller is still selling it)
          const drawn = long && p.t === 'V';
          if (p.t === 'V' && !drawn) voiced.gain.setTargetAtTime(vg * (held ? 0.95 : 0.86), t + dur * (held ? 0.8 : 0.55), held ? 0.08 : 0.05);
          // Breath is noise through the tract (the aspiration path), under the voice and
          // shaped by the same formants, so it reads as a breathy voice rather than a hiss
          // beside one. The frication path is shut during a sonorant: whatever band the last
          // fricative left it on (6 kHz after an /s/) would otherwise sit under the vowel.
          noiseG.gain.setTargetAtTime(0, t, 0.010);
          // A devoiced vowel is breath where the voice should be: without it the syllable
          // would just get quieter, which is a dropout, not a whisper.
          aspG.gain.setTargetAtTime(devoiced ? ASP_H * 0.8 : (V.breath * TUNING.breath + D.breath) * BREATH_K * nat, t, 0.01);
          if (p.t === 'V') {
            const nuc = pendingNuc; pendingNuc = null;
            // (a held or drawn nucleus has its own shape below, so it skips the fall)
            const fv = pitchAt(t, (t - phraseT0) / (phraseDur[phraseIx] || totalDur), stressed, f[0], nxtCode, nuc, held || drawn ? 0 : dur);
            // The held nucleus climbs through the vowel to its peak and only eases at the end:
            // the shape of "SCOOORES", where a plain accent is a step.
            if (held && D.e > 0.3 && !drawn) {
              glot.frequency.setTargetAtTime(pq(fv * mix(1 + 0.1 * D.e)), t + dur * 0.3, 0.06);
              glot.frequency.setTargetAtTime(pq(fv * mix(1 + 0.03 * D.e)), t + dur * 0.85, 0.08);
            }
            // A DRAWN-OUT VOWEL is sung as much as said. Sold ("He SCOOOOORES!!!"), it
            // climbs over its first fifth to a peak two to four semitones over the accent
            // it already has (a goal call tops out near 280 Hz on this booth), leans on it
            // with the vocal-fold tremor any held shout has (a 6 Hz waver, the second jitter
            // oscillator turned up), swells and brightens, then eases into the rest of the
            // word. Not sold ("Noooo..."), it sags instead. A flat, steady second of formant
            // is an organ note; this is what keeps it a voice.
            if (drawn) {
              const sold = D.e > 0 || phraseBang[phraseIx] > 0;
              const peak = sold ? 2 ** ((1.5 + 1.0 * Math.max(0, D.e) + 0.5 * phraseBang[phraseIx]) * nat / 12) : 2 ** (-2 * nat / 12);
              glot.frequency.setTargetAtTime(pq(fv * peak), t + 0.03, dur * 0.12);
              if (sold) glot.frequency.setTargetAtTime(pq(fv * peak * mix(1 + 0.025 * Math.max(0.4, D.e))), t + dur * 0.45, dur * 0.25);
              glot.frequency.setTargetAtTime(pq(fv * peak * mix(sold ? 0.96 : 0.92)), t + dur * 0.86, 0.05);
              const wob = F0 * VIBRATO * (sold ? 0.6 + 0.4 * Math.max(0, D.e) : 0.4) * nat;
              jit2G.gain.setTargetAtTime(wob, t + dur * 0.18, dur * 0.12);
              jit2G.gain.setTargetAtTime(F0 * V.jitter * 0.6 * D.jitter * nat, t + dur * 0.9, 0.04);
              const swell = sold ? 1.18 + 0.06 * phraseBang[phraseIx] : 1.0;
              voiced.gain.setTargetAtTime(vg * swell, t + dur * 0.1, dur * 0.18);
              voiced.gain.setTargetAtTime(vg * (sold ? 1.05 : 0.8), t + dur * 0.85, 0.06);
              if (sold && nat > 0) tilt.frequency.setTargetAtTime(nat === 1 ? TUNING.tiltEmph * D.bright * 1.1 : (TUNING.tiltPlain + (TUNING.tiltEmph * 1.1 - TUNING.tiltPlain) * nat) * mix(D.bright), t + dur * 0.1, dur * 0.2);
            }
          }
          // A diphthong's glide comes at the END of a held vowel ("GOOOOAL" is a long /o/
          // that turns to /ʊ/ at the last moment), not through the middle of it.
          if (p.to) setF(t + (drawn ? Math.max(dur * 0.62, dur - 0.16) : dur * 0.62), p.to, false, 0.018);
          // A vowel before an /r/ that ends its syllable ("score", "four", "board") is
          // r-coloured through its back half: F3 starts down before the /r/ itself, as it
          // does in a mouth, and the /r/ is heard as part of the vowel rather than a blip.
          else if (p.t === 'V' && nxtCode === 'R' && !VOWELS.has(nextSound(phon, nj + 1))) {
            setF(t + dur * (drawn ? 0.85 : 0.55), [f[0], (f[1] + RHOTIC[1]) / 2, (f[2] + RHOTIC[2]) / 2], false, 0.03);
          }
          t += dur;
        } else if (p.t==='H') {
          // /h/ IS THE FOLLOWING VOWEL, BREATHED. It has no constriction of its own: the
          // turbulence is at the glottis and the tract is already in position for whatever
          // comes next, which is why the /h/ of "he" and of "who" are different sounds. So it
          // is noise through the formants (the aspiration path), with the bands widened
          // because an open glottis damps them. A fixed band beside the formants made every
          // /h/ the same neutral puff, and one close enough to /ʃ/'s that "sheet" was heard as
          // "heat".
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
          // AN AFFRICATE IS A STOP FIRST. /tʃ/ is a closure and then a release straight into
          // the friction, and that release is what tells it from /ʃ/: the noise snaps on where
          // a fricative's swells in. 30 ms of near-silence and the same slow onset as /ʃ/ made
          // "chicken" and "chat" arrive as "shicken" and "shat", and "juice" as "use".
          if (p.stopFirst) {
            if (p.vd) { murmur(t, p.lf); voiced.gain.setTargetAtTime(VBAR, t, 0.006); }
            else { if (p.lf) setF(t, p.lf, false, 0.012); voiced.gain.setTargetAtTime(0, t, 0.005); }
            noiseG.gain.setTargetAtTime(0, t, 0.005);
            t += AFFRICATE_CLOSURE;
          }
          // Q is SCHEDULED, not assigned. An imperative `Q.value =` applies
          // immediately rather than at time t, so the whole line ended up scheduled
          // with whichever Q the loop happened to finish on. setNoiseBand keeps that
          // property and drives both bandpasses together.
          setNoiseBand(p.nf, p.nq||3, t, 0.004);
          let fam = (p.ng ?? 0.3) * (p.sib ? TUNING.sibilance : TUNING.friction);
          // A FINAL FRICATIVE IS QUIETER AND STOPS SOONER. Mid-word, the next vowel
          // masks the tail of the noise; at a word or phrase edge there is nothing
          // over it, so the same level hangs in the open as a hiss. English does damp
          // its own finals too — the "s" of "cats" is weaker than the "s" of "sat" —
          // so this is a correction, not just a mix decision.
          const finalF = !nxt || nxt.t === 'P';
          if (finalF) fam *= TUNING.finalTaper;
          // A fricative's noise swells in over ~15 ms; an affricate's snaps on at its release.
          noiseG.gain.setTargetAtTime(fam, t, p.stopFirst ? 0.002 : 0.014);
          // A voiced fricative buzzes through a near-closed tract: the voicing is low and weak,
          // like a voice bar, under the friction. Through the open bank it was a vowel with
          // hiss on it, and /ð/ (the most common consonant in English, in "the") lost to it.
          if (p.vd) { murmur(t, p.lf, 0.10); voiced.gain.setTargetAtTime(VFRIC, t, 0.010); }
          else {
            if (p.lf) setF(t, p.lf, false, 0.012);   // place cue; fast, a constriction is released quickly
            voiced.gain.setTargetAtTime(0, t, 0.008);
          }
          micro = p.vd ? 0.985 : 1.015;   // voiced obstruent drags F0 down, voiceless lifts it
          t += dur;
          // The release matters as much as the level: setTargetAtTime is exponential,
          // so a 20ms constant is still plainly audible ~80ms after the phoneme is
          // nominally over. That overhang IS the breathy tail. Cut it at an edge.
          // Squared so the knob moves level and overhang together but the tail moves
          // further — at 1.0 both are exactly the old behaviour.
          noiseG.gain.setTargetAtTime(0, t, 0.02 * (finalF ? TUNING.finalTaper ** 2 : 1));
        } else if (p.t==='S') {
          // CLOSURE. A voiceless stop is dead air. A voiced one keeps a low voice bar buzzing
          // through a closed tract (see murmur), which is the cue that it IS voiced: through
          // the open bank that buzz was a nasal ("box" heard as "bombs"). Either way F2 and F3
          // travel to the locus, so the vowel BEFORE the stop bends the right way.
          nzero.gain.setTargetAtTime(0, t, 0.02);
          aspG.gain.setTargetAtTime(0, t, 0.004);
          noiseG.gain.setTargetAtTime(0, t, 0.004);
          if (p.vd) { murmur(t, p.lf); voiced.gain.setTargetAtTime(VBAR * Math.min(1, p.vd * 2.5), t, 0.006); }
          else { if (p.lf) setF(t, p.lf, false, 0.012); voiced.gain.setTargetAtTime(0, t, 0.004); }
          t += dur*0.6;
          // UNRELEASED. A stop before a pause or another stop is usually not
          // released at all in English — "hot dog", "stop that", a sentence-final
          // "act". Bursting every one of them is a distinctly synthetic tic, and
          // the closure plus the formant transition into it already carry the stop.
          // UNRELEASED — but only when the release is genuinely MASKED, i.e. another
          // stop's closure follows. This used to include a following pause too, and
          // that was badly wrong in a final cluster: in "architect" (… EH K T) the K
          // is unreleased because T follows, and then T was unreleased because the
          // pause follows — so the whole "ct" became silence with no burst anywhere,
          // and the word simply ended after "archite". A stop with no transition cue
          // in front of it (because the thing in front is another stop's silence) has
          // NOTHING left to identify it if you also take its burst away.
          //
          // Note the prev-* update: this path skips the tail of the loop, and without
          // it an unreleased stop leaves the NEXT phoneme reading the context of the
          // phoneme before it — which would silently break the after-/s/ rule below.
          const timing = stopTiming(p, segCtx);
          if (timing.unreleased) {
            t += 0.02; prevNasal = false; prevP = p; prevCode = code; continue;
          }
          // RELEASE. The tract opens at the locus with its full resonances back, so the
          // transition into the vowel (or through the aspiration) starts where the ear
          // expects it to: from the consonant's place, not from a murmur.
          setF(t, p.lf || [400, 1500, 2500], !p.vd, 0.004);
          // BURST — see bq/bd/bg in the phoneme table. A velar's is COMPACT and sits just
          // above the next vowel's F2, which is why /k/ before "key" and before "coo" are
          // different noises: it follows the vowel rather than holding one frequency.
          const nv = nxt && nxt.t === 'V' ? nxt : null;
          const bandF = p.lf === VEL && nv ? Math.max(1400, Math.min(3300, nv.f[1] * 1.12)) * fshift : p.nf;
          setNoiseBand(bandF, p.bq ?? 2, t, 0.002);
          noiseG.gain.setTargetAtTime(BURST * (p.bg ?? 1) * TUNING.aspiration, t, 0.0015);
          t += (p.bd ?? 20) / 1000;
          noiseG.gain.setTargetAtTime(0, t, 0.006);
          // ASPIRATION — the voice-onset gap, and the contrast a listener actually uses
          // between /p t k/ and /b d g/ (far more than the burst). Voiceless stops breathe
          // through it; voiced ones barely have one and start phonating at once. The breath
          // goes through the tract, already moving to whatever follows, so the formant
          // transition plays out inside the aspiration as it does in a real mouth.
          //
          // Two allophonic corrections, both of which were audibly wrong:
          //
          // AFTER /s/ a voiceless stop is UNASPIRATED — "stop", "sky", "street" have
          // nothing like the puff of "top", "key", "treat". This is one of the most
          // reliable rules in English phonology and we were aspirating every one.
          //
          // BEFORE A LIQUID OR GLIDE the aspiration isn't a neutral puff either: the
          // liquid itself is DEVOICED, so the breath goes out through the /r/ or /l/
          // already in place. /tr/ is a single fricated gesture, not t + breath + r; a
          // neutral puff between them turned "intrusive" into "in-t'huh-rusive".
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
          // A terminal pause ends the phrase: the next one starts from the top of the
          // speaker's range again, which is what re-pitching after a full stop is.
          if (isTerm(code)) { phraseIx++; phraseT0 = t + dur/speed; declOff = 0; }
          // A MINOR BREAK RE-PITCHES PART WAY. The speaker takes a little breath, not a
          // new sentence: half of the declination so far is given back, where a full
          // stop gives all of it back.
          else if (p.minor) declOff += Math.max(0, (t - phraseT0) / (phraseDur[phraseIx] || totalDur) - declOff) * 0.5;
          // every break ends an intermediate phrase: the next one has its own nucleus and
          // starts its downstep from the top
          if (code !== '_') { afterNuc = null; downN = 0; }
          pendingStress = 0;
          // A WORD BOUNDARY IS NOT A PAUSE. This zeroed the voice at every `_`, so
          // a 40ms hole opened between every single word in the line — which is the
          // classic word-by-word robot artifact, and is not what connected speech
          // does: "the cat sat" is continuously voiced throughout, and only a phrase
          // boundary gets actual silence. The word gap is a juncture, so it now only
          // relaxes the voice rather than cutting it, and the formants keep gliding
          // through toward the next word. `_C` and `__` still go properly quiet.
          wordScale = sylScale(sylFrom(phon, i + 1));
          const junctureOnly = code === '_';
          // CARRY CONTEXT ACROSS A JUNCTURE. Falling through to the tail of the loop
          // would make the pause itself the 'previous phoneme', so the first vowel of
          // every word lost its left-hand coarticulation context and was shaped only
          // by what follows. English coarticulates straight through a word boundary —
          // "this year", "did you" — so a juncture leaves prevP/prevCode alone. A real
          // phrase break does reset them, because there the articulators genuinely rest.
          voiced.gain.setTargetAtTime(junctureOnly ? 0.45 : 0, t, junctureOnly ? 0.012 : 0.02);
          // Breath keeps running through a juncture (see the continuous-noise note),
          // and at 20ms it bleeds across the word boundary as a sigh. Same taper as a
          // final fricative gets — this is the same artifact from the other source.
          noiseG.gain.setTargetAtTime(0, t, 0.02 * TUNING.finalTaper ** 2);
          aspG.gain.setTargetAtTime(0, t, 0.02 * TUNING.finalTaper ** 2);
          nzero.gain.setTargetAtTime(0, t, 0.02);
          // `dur` is ALREADY speed-adjusted above. This divided by speed a second
          // time, so pause length scaled as 1/speed² — harmless when speed sat near
          // 1.36, but the rhythm compensation moved it to ~1.0 and every inter-word
          // gap silently grew by ~75%. It also made estimateDuration (which divides
          // once) under-report the real length, which is what let lines arrive
          // before the voice had finished.
          t += dur;
        }
        prevNasal = p.t === 'N';
        // A word juncture is transparent to coarticulation (see the P branch); a real
        // phrase break resets the context, because there the articulators do rest.
        if (code !== '_') { prevP = p; prevCode = code; }
      }
      const end = t + 0.08;
      if (trace) trace.push({ p: 'END', at: t - t0 });
      voiced.gain.setTargetAtTime(0, end, 0.02);
      // The last thing a line leaves behind. The voice is allowed to fade; the noise
      // is not, because with no voice under it the fade is a whisper of its own.
      noiseG.gain.setTargetAtTime(0, end, 0.02 * TUNING.finalTaper ** 2);
      aspG.gain.setTargetAtTime(0, end, 0.02 * TUNING.finalTaper ** 2);
      // The terminal contour. Set as a target from wherever the lilt left the pitch —
      // the old code re-anchored F0 at t0 and ramped, which erased every contour
      // scheduled above it. A question turns the fall into a rise.
      const lastK = phraseK[phraseK.length - 1] ?? 1;
      glot.frequency.setTargetAtTime(
        pq(rise ? F0 * lastK * (1 + lilt * 1.9) : F0 * lastK * (1 - V.decl * D.decl * nat) * mix(trail ? 0.88 : 0.94)),
        Math.max(t0, end - 0.18), 0.06);
      // CREAK. English speakers routinely fall into vocal fry on the last syllable of
      // a statement — the folds run out of breath pressure, the pitch drops off a
      // cliff and the pulses go irregular. It is one of the most recognisable things
      // a real voice does at a full stop, and a synth that ends every sentence on a
      // clean tone sounds like it is reading a list of them. Not on questions, which
      // end lifted, and not so deep it becomes a growl.
      const creak = TUNING.creak * D.creak * nat;   // none at full cry; more in grief; none in a machine
      if (!rise && creak > 0) {
        const cf = Math.max(0.55, 1 - 0.30 * creak);
        // ⚠ CREAK USED TO ERASE THE TERMINAL CONTOUR. The line above sets a target
        // at end-0.18 that differs for a line trailing off (`...`) versus one
        // landing on a full stop — and this then overwrote glot.frequency 110ms
        // later at a flat F0*cf, which is lower than either branch. So the trail
        // distinction existed, was computed, and was audible for a tenth of a
        // second before being wiped on every single statement.
        //
        // Carrying the factor through rather than rebasing creak on the terminal
        // target: rebasing is more physically honest (fry falls from wherever the
        // pitch IS, not from F0) but would drop the common case from F0*0.70 to
        // about F0*0.57, well past the floor that stops it becoming a growl, and
        // retuning that needs an ear. This leaves a full stop EXACTLY where it was
        // and only changes the case that was being erased.
        glot.frequency.setTargetAtTime(pq(F0 * lastK * cf * (trail ? 0.94 : 1)), Math.max(t0, end - 0.07), 0.035);
        // Irregularity is the other half — a steady low tone is a hum, not creak.
        // BOTH LFOs. Raising only one leaves the other steady, which is a partial
        // return to periodic vibrato — the exact thing two beating LFOs exist to avoid.
        const cj = Math.max(t0, end - 0.07);
        jitG.gain.setTargetAtTime(F0 * V.jitter * D.jitter * (1 + 4 * creak), cj, 0.03);
        jit2G.gain.setTargetAtTime(F0 * V.jitter * 0.6 * D.jitter * (1 + 4 * creak), cj, 0.03);
      }
      const src = [glot, nz, lfo, jit, jit2, shim];
      if (growlOsc) src.push(growlOsc);
      if (growl2Osc) src.push(growl2Osc);
      if (rmodOsc) src.push(rmodOsc);
      src.forEach(n => n.start(t0));
      src.forEach(n => n.stop(end+0.1));
      // THE WORKLET'S HANDOFF. Everything the loop above scheduled is in the recorders;
      // sample them into tracks from t0 and send them, with the line's constants.
      if (wk) {
        const frames = Math.ceil((end + 0.1 - t0) / WK.frame) + 1, NP = WK_TRACK.length;
        const tracks = new Float32Array(frames * NP);
        const P = {
          f0: glot.frequency, jitA: jitG.gain, jitB: jit2G.gain, av: voiced.gain, ah: aspG.gain, af: noiseG.gain,
          f1: forms[0].frequency, f2: forms[1].frequency, f3: forms[2].frequency, f4: forms[3].frequency,
          q1: forms[0].Q, q2: forms[1].Q, q3: forms[2].Q, q4: forms[3].Q,
          nf: nbp.frequency, nq: nbp.Q, nzf: nzero.frequency, nzdb: nzero.gain, tilt: tilt.frequency, closure,
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
          ...WK, f0: F0, fshift, oq: Math.max(0.4, Math.min(0.85, V.oq + D.oq * nat)), natural: nat, buzz: buzzAmt,
          growl: growlAmt, growlRatio: V.growlRatio ?? 0.5, growl2: growlAmt > 0 ? (V.growl2 || 0) : 0, growl2Ratio: V.growl2Ratio ?? 1.5,
          lpA: 1 - Math.exp(-2 * Math.PI * 9000 / c.sampleRate),
        } }, [tracks.buffer]);
        node.connect(master);
        // cancel() stops a line by calling stop() with no time; the line ends itself.
        src.length = 0;
        src.push(lfo, ...(rmodOsc ? [rmodOsc] : []), { stop: (when) => { if (when !== undefined) return; node.port.postMessage({ type: 'stop' }); try { node.disconnect(); } catch { /* gone */ } } });
      }
      if (opt.tap && typeof opt.tap.connect === 'function') master.connect(opt.tap);
      // Ducks for this line's length: the TV under Read Aloud, and whatever
      // buses the caller named in `duck` ({ buses, dB }, or a list of buses at
      // -9 dB).
      const hold = Math.max(0, end - t0);
      const ducks = [];
      if (ui) ducks.push(readerDuck({ at: t0, hold }));
      if (opt.duck) {
        const d = Array.isArray(opt.duck) || typeof opt.duck === 'string' ? { buses: opt.duck } : opt.duck;
        ducks.push(duck(d.buses || [], d.dB ?? -9, { at: t0, hold, attack: d.attack ?? 0.05, release: d.release ?? 0.4 }));
      }
      chan.lines.push({ src, end: end + 0.1, duck: ducks.length ? { release: () => ducks.forEach(h => h.release()) } : null });
      // The REAL length of what was just scheduled. Callers used to guess from word
      // count and wait that long regardless, so a line that finished early left dead
      // air; handing back the truth lets them follow the voice instead of a timer.
      // `delay` is how long a queued line waits before it starts.
      return { duration: end - t0, delay: t0 - c.currentTime, channel: chName, backend: wk ? 'worklet' : 'graph' };
    }

    // Debug hook for the voice lab: the phoneme run a line will actually produce,
    // accent applied. Read-only and side-effect free.
    const phonemesFor = (text, opt = {}) => {
      _lex = opt.lex || null;
      if (opt.voice && opt.voice.vs) text = readMatchups(text);
      try {
        let ph = applyAssimilation(applyAccent(textToPhonemes(text), opt.accent));
        if (opt.accent !== 'rp') ph = applyFlap(ph);
        // opt.excite, as speak() takes it, places the held nucleus too.
        if (Math.max(-1, Math.min(1, (+opt.excite || 0) * TUNING.excitement)) >= 0.35) ph = soldNucleus(ph);
        // The light nucleus '+' is on every phrase, so a check that is about a sound
        // and not about accent placement would have to spell it; opt.marks keeps it.
        return opt.marks ? ph : ph.filter(p => p !== '+');
      } finally { _lex = null; }
    };
    return { speak, cancel, left, readerDuck, tuning: TUNING, phonemesFor, estimate: estimateDuration, voiceFor: voiceFromName, phones: () => Object.keys(PH),
      wk: WK, loadWorklet: loadOracleWorklet, setWorkletUrl: (u) => { _wkUrl = u || ''; } };
  })();

  global.AudioEngine = {
    init, onUnlock, applyVolumeSettings, setMonoAudio,
    playSfx, lastSfxAt, playSample, clearSampleCache,
    // a cue rendered offline through the same graph (a Promise of an AudioBuffer), and a
    // rendered buffer as WAV bytes
    renderSfx, wavBytes,
    // what a layer's `mods` can be patched into, for the Rack's jacks
    MOD_TARGETS,
    // whether the retro stage's worklet is loaded in the live context (true once it is), and
    // where to load it from when this file wasn't loaded by a <script> tag
    retroReady: () => (ctx ? _retroState.get(ctx) === true : false),
    _setRetroUrl: (url) => { _retroUrl = url || ''; },
    // the retro stage for a live synth of its own (the crowd bed): what to connect into, on
    // its way to `dest`. `retro.ref` is the synth's full scale.
    retroInsert: (c, retro, dest) => retroStage(c, retro || {}, {}, dest),
    // the retro stage's worklet for another context (an offline one): a Promise of true once loaded
    loadRetro,
    loopSound, stopLoop, setLoopGain, duckLoop, setEcho,
    playMusic, stopMusic, stopMusicOwnedBy, pauseMusic, resumeMusic, queueMusic, fadeTo, crossFade, setLayerWeight,
    stop,
    noteToFreq,
    // The room the listener is standing in. Named spaces rather than numbers,
    // because the caller (plugins/audio) owns the world's vocabulary and this
    // file must never learn what a storm drain is.
    setSpace,
    // A room by name, over whatever the zone picked, until setRoom(null).
    setRoom,
    spaceNames: () => Object.keys(SPACES),
    // Pull buses down under something that has to be heard; see duck() above.
    duck,
    // The broadcast's effects against its voice, in dB, inside the TV slider.
    setTvBalance,
    // The bus Read Aloud speaks through. Exposed only so a test can prove it is
    // not wired into the reverb send — that is a routing property, and routing is
    // exactly the kind of thing a later change breaks without touching this file.
    _speechBus: () => { ensureContext(); return busFor('ui'); },
    // What the voice pool is doing. A dropped cue is silent and a cue nobody
    // asked for is also silent, so without counters "is 32 enough?" is not a
    // question anyone can answer from the outside.
    _voiceStats: () => ({ ...vstat, size: MAX_VOICES, live: voices.filter(Boolean).length, priorities: voices.filter(Boolean).map((v) => v.priority) }),
    speak: (text, opt) => Speech.speak(text, opt),
    // No channel stops every channel. 'ui' stops only Read Aloud, which is what
    // a typed command and Escape do; 'tv' stops only the TV and announcer.
    cancelSpeech: (channel) => Speech.cancel(channel),
    // How long a channel ('tv' by default) has left to say, in seconds.
    speechLeft: (channel) => Speech.left(channel),
    // The TV duck Read Aloud applies while it speaks, for the natural reader.
    readerDuck: (opts) => Speech.readerDuck(opts),
    // Live tunables — see the TUNING block in Speech. Mutate and the next line
    // spoken picks it up. Used by the voice lab (the dev panel's Voice Lab tab)
    // and read by tv.js for the inter-line gap.
    voiceTuning: Speech.tuning,
    // ORACLE's worklet back end, a prototype the Voice Lab A/Bs against the node graph:
    // a Promise of true once its module is loaded in the live context (speak() with
    // `backend: 'worklet'` falls back to the graph until then), its constants (mutate and
    // the next line picks them up), and where to load it from when this file wasn't
    // loaded by a <script> tag.
    loadVoiceWorklet: () => Speech.loadWorklet(),
    voiceWorkletTuning: Speech.wk,
    _setVoiceWorkletUrl: (url) => Speech.setWorkletUrl(url),
    _phonemesFor: (text, opt) => Speech.phonemesFor(text, opt),
    // One narrator's parameters, without speaking. Exposed because the draw ORDER
    // in voiceFromName is load-bearing — a field inserted above an existing one
    // shifts every draw after it and silently recasts every voice in the game —
    // and nothing could check that from outside until now.
    _voiceFor: (name) => Speech.voiceFor(name),
    // Scheduled length of a run, without needing an AudioContext — so the voice
    // smoke test can check pacing against broadcast's hold headlessly.
    _estimateDuration: (phon, speed, shout) => Speech.estimate(phon, speed, shout),
    // The phoneme inventory, so a check can hold a content lexicon (a script's ::say
    // block) to sounds the synth has: an unknown one is skipped silently on air.
    _phones: () => Speech.phones(),
    // Hand a custom synth (e.g. the flight-engine) the context + ambient bus + shared noise
    // buffer so it can build its own live, parameter-driven node graph on the ambient chain.
    // `category` picks the bus as playSfx would (a broadcast's crowd rides 'tv_fx'); ambient by default.
    engineNodes: (category) => { const c = ensureContext(); if (!c) return null; return { ctx: c, bus: busFor(category || 'ambient'), noise: getNoiseBuffer() }; },
    // For the audio gates: the graph and buffers a stub context can't show any
    // other way. Read-only views; nothing here changes what plays.
    _graph: () => {
      ensureContext();
      return {
        master: masterGain, limiter: _limiter, limitTrim: _limitTrim, limit: { ...LIMIT, makeup: LIMIT_MAKEUP },
        buses, tvVoice: tvVoiceGain, tvFx: tvFxGain, reverbSend, reverbNode,
        space: _space, zoneSpace: _zoneSpace, roomOverride: _roomOverride,
      };
    },
    _noiseBuffer: (colour) => { ensureContext(); return noiseBuffer(colour); },
    _impulse: (name) => { ensureContext(); return impulseFor(name); },
  };

})(typeof window !== 'undefined' ? window : globalThis);
