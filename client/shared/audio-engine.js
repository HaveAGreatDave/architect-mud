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

  function ensureContext() {
    if (ctx) return ctx;
    const AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    masterGain = ctx.createGain();
    // Mono downmix sits between the master bus and the speakers, so it catches
    // every category (music, sfx, ambient, tv) and every panner upstream of it.
    // A GainNode with an explicit single channel IS the downmix — WebAudio sums
    // L+R on the way in, and the destination spreads the one channel back to
    // both outputs, so the mix is centred rather than half-silent.
    _monoNode = ctx.createGain();
    _monoNode.channelCount = 1;
    _monoNode.channelCountMode = 'explicit';
    _monoNode.channelInterpretation = 'speakers';
    _monoNode.connect(ctx.destination);
    masterGain.connect(_mono ? _monoNode : ctx.destination);
    musicGain = ctx.createGain();
    sfxGain = ctx.createGain();
    ambientGain = ctx.createGain();
    tvGain = ctx.createGain();
    uiGain = ctx.createGain();
    musicGain.connect(masterGain);
    sfxGain.connect(masterGain);
    ambientGain.connect(masterGain);
    tvGain.connect(masterGain);
    // Straight to master, and deliberately NOT into the reverb send below.
    uiGain.connect(masterGain);
    buildReverb();
    _applyGains();
    return ctx;
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
  };

  function buildReverb() {
    reverbNode = ctx.createConvolver();
    reverbSend = ctx.createGain();
    reverbSend.gain.value = 0;
    sfxGain.connect(reverbSend);
    ambientGain.connect(reverbSend);
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
    tvSend.gain.value = 0.45;
    tvGain.connect(tvSend).connect(reverbSend);
    reverbSend.connect(reverbNode).connect(masterGain);
    setSpace('outdoor', { instant: true });
  }

  function impulseFor(name) {
    const cached = _irCache.get(name);
    if (cached) return cached;
    const s = SPACES[name] || SPACES.room;
    const sr = ctx.sampleRate;
    const len = Math.max(1, Math.floor(sr * s.seconds));
    const pre = Math.floor(sr * (s.pre / 1000));
    const buf = ctx.createBuffer(2, len + pre, sr);
    // Per channel, and with its own noise: two identical channels is a mono
    // reverb wearing a stereo buffer, and the whole point of a room is that the
    // two ears do not hear the same thing.
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      const damp = 1 - s.damp;   // one-pole coefficient: lower damp = darker tail
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // Exponential, not linear. A linear fade reads as a gate closing.
        const env = Math.pow(1 - t, 2.2);
        lp += damp * ((Math.random() * 2 - 1) - lp);
        d[pre + i] = lp * env;
      }
    }
    _irCache.set(name, buf);
    return buf;
  }

  // Swap the room. `instant` is for boot; everything else crossfades, because a
  // reverb tail that changes character in one frame is a click.
  function setSpace(name, { instant = false, wet = null } = {}) {
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
    // Follows the sfx slider — it is a game sound — but never the sfx routing.
    uiGain.gain.setTargetAtTime(_settings.sfx ? _settings.sfxVolume : 0, t, 0.02);
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
    if (!ctx || !masterGain || !_monoNode) return;
    try { masterGain.disconnect(); } catch { /* nothing connected yet */ }
    masterGain.connect(on ? _monoNode : ctx.destination);
  }

  function busFor(category) {
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
      tone.type = OSC_WAVES.includes(layer.waveform) ? layer.waveform : 'square';
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
          m2.start(time);
          nodes.push(m2);
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
      gain.gain.setValueAtTime(envelopeAt(t), t);
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
  function playSfx(def, gainMultiplier = 1, opts = {}) {
    const c = init();
    if (!c || !def?.config) return null;
    const priority = def.priority ?? 5;
    const idx = allocateVoice(priority);
    if (idx === -1) return null; // dropped — all higher/equal-priority voices busy
    const time = c.currentTime;
    const duration = def.config.duration ?? 0.4;
    let destination = busFor(def.category);
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
    if (gainMultiplier !== 1) {
      const g = c.createGain();
      g.gain.value = gainMultiplier;
      g.connect(destination);
      destination = g;
    }
    const sustain = opts.sustain === true;
    const sound = buildSound(def.config, destination, time, sustain ? null : duration);
    const voiceToken = occupyVoice(idx, priority, () => sound.release(c.currentTime));
    if (sustain) {
      let done = false;
      const end = () => {
        if (done) return;
        done = true;
        clearTimeout(capT);
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
    const sound = buildSound(def.config || {}, busFor(def.category === 'tv' ? 'tv' : def.category === 'sfx' ? 'sfx' : 'ambient'), time, null);
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

  // ── ORACLE — Orthography, Resonance, Accent, Cadence, Lexicon & Emphasis ────
  //
  // The voice. A formant speech synth: a glottal PeriodicWave through a
  // four-formant bank with a nasal antiformant, a separate noise path for
  // fricatives and stop bursts, a 27k-word lexicon over letter-to-sound rules,
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
      ER:{f:[490,1350,1690],t:'V',d:150}, AH:{f:[640,1190,2390],t:'V',d:90},
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
      OWR:{f:[500,1400,2350], to:[300,870,2240], t:'V',d:180},
      EY:{f:[530,1840,2480],to:[270,2290,3010],t:'V',d:170},
      AY:{f:[730,1090,2440],to:[270,2290,3010],t:'V',d:180},
      OY:{f:[570,840,2410], to:[270,2290,3010],t:'V',d:180},
      OW:{f:[570,840,2410], to:[300,870,2240], t:'V',d:170},
      AW:{f:[730,1090,2440],to:[300,870,2240], t:'V',d:180},
      M:{f:[250,1100,2200],t:'N',d:80,az:1000}, N:{f:[250,1700,2600],t:'N',d:80,az:1800}, NG:{f:[250,2000,2900],t:'N',d:80,az:2900},
      // /l/ has two allophones and the gap between them is large. CLEAR /l/ before a
      // vowel (leaf, alive) keeps F2 high; DARK /l/ everywhere else (well, full,
      // people, milk) retracts the tongue body and drops F2 to near a back vowel.
      // One triple for both is wrong roughly half the time. `df` is the dark one.
      L:{f:[360,1300,2600],df:[400,850,2600],t:'L',d:70,tc:0.040}, R:{f:[350,1100,1600],t:'L',d:80,tc:0.055},
      W:{f:[300,610,2200],t:'L',d:70,tc:0.055},  Y:{f:[270,2290,3010],t:'L',d:60,tc:0.050},
      // `ng` — per-phoneme noise level. One flat 0.3 for every fricative made the
      // sibilants shout: /s/ and /ʃ/ carry far more energy than /f/ or /θ/, and this
      // synth has none of the masking a real voice provides, so they need to sit
      // BELOW the weak fricatives here, not above them. nq comes down with it — a Q
      // of 6 at 6.5kHz is a ~1kHz-wide whistle, where real /s/ is broadband hiss
      // above ~4kHz. The narrow band was what gave it that tonal edge.
      S:{t:'F',d:100,nf:6000,nq:2.5,ng:0.15,vd:0,lf:ALV,sib:1},  Z:{t:'F',d:95,nf:6000,nq:2.5,ng:0.13,vd:.5,lf:ALV,sib:1},
      SH:{t:'F',d:115,nf:2600,nq:2,ng:0.17,vd:0,lf:PAL,sib:1},   ZH:{t:'F',d:100,nf:2600,nq:2,ng:0.15,vd:.5,lf:PAL,sib:1},
      F:{t:'F',d:100,nf:4000,nq:1.6,ng:0.24,vd:0,lf:LAB},  V:{t:'F',d:90,nf:4000,nq:1.6,ng:0.21,vd:.5,lf:LAB},
      TH:{t:'F',d:100,nf:5500,nq:1.6,ng:0.24,vd:0,lf:DEN}, DH:{t:'F',d:80,nf:5500,nq:1.6,ng:0.21,vd:.5,lf:DEN},
      HH:{t:'H',d:80,nf:1500,nq:1,vd:0},
      // Affricates run the fricative branch, so they need the same treatment — they
      // are sibilants too, and were the last thing left shouting at the old flat 0.3.
      CH:{t:'F',d:115,nf:2600,nq:2,ng:0.18,vd:0,stopFirst:1,lf:PAL,sib:1}, JH:{t:'F',d:105,nf:2600,nq:2,ng:0.16,vd:.4,stopFirst:1,lf:PAL,sib:1},
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
      P:{t:'S',d:90,nf:1500,vd:0,lf:LAB,asp:55,bq:0.8,bd:14,bg:0.7}, B:{t:'S',d:80,nf:900,vd:.4,lf:LAB,asp:8,bq:0.8,bd:12,bg:0.6},
      T:{t:'S',d:90,nf:4000,vd:0,lf:ALV,asp:60,bq:1.6,bd:15,bg:1.1}, D:{t:'S',d:80,nf:3000,vd:.4,lf:ALV,asp:10,bq:1.6,bd:13,bg:0.9},
      K:{t:'S',d:90,nf:2000,vd:0,lf:VEL,asp:70,bq:4.5,bd:30,bg:1.15}, G:{t:'S',d:80,nf:1800,vd:.4,lf:VEL,asp:12,bq:4.5,bd:26,bg:1.0},
      // TWO pauses, not one. Connected speech does not stop between words — the
      // words run together and only phrase boundaries get real silence. A single
      // 120ms gap after every word is most of what made this read as dictation
      // rather than talking, so a word gap is now barely a gap at all and the
      // punctuation pause is the one that carries weight.
      // A flap is not a stop with a short fuse — it is a ballistic tap, ~25ms total,
      // fully voiced, with no aspiration and barely any closure. Modelled as a stop so
      // it inherits the locus machinery, but with the timing of a tap.
      DX:{t:'S',d:28,nf:2600,vd:.7,lf:ALV,asp:0},
      // PUNCTUATION IS NOT ONE THING. A comma, a colon, a dash and an ellipsis are
      // four different silences, and collapsing them into one 180ms gap threw away
      // most of what punctuation is FOR. Each break carries its own duration, and
      // `term` marks the ones that end a phrase (re-pitch, declination reset).
      _:{t:'P',d:40},              // word gap
      _C:{t:'P',d:150},            // comma — the lightest real break
      _S:{t:'P',d:260},            // semicolon / colon — heavier than a comma, not an end
      _D:{t:'P',d:190},            // dash, parenthesis — an interruption, not a clause edge
      _E:{t:'P',d:430,term:1},     // ellipsis — trailing off, and the longest silence there is
      __:{t:'P',d:250,term:1},     // full stop
      _X:{t:'P',d:200,term:1},     // exclamation — a shout doesn't linger, it lands and moves
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
    function cmuBuild(){
      CMU = new Map();
      const D = global.CMUDICT; if (!D) return;
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
        .replace(/\bSt\.\s+(?=[A-Z])/g, ' Saint ')
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
    const FUNC = new Set(('a an the of to in on at by for from with as and or but nor if than that ' +
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
    };

    // Two stress markers sit in the phoneme run, both immediately before a vowel and
    // neither with a PH entry, so the synthesis loop and estimateDuration skip them
    // for free — only the LOOKAHEADS have to know. '*' is ordinary lexical stress;
    // '!' is emphasis, a level above it.
    const isMark = p => p === '*' || p === '!';

    // Monophthongs that centralise when they lose their stress. Diphthongs are
    // absent on purpose: the glide IS the vowel's identity and survives reduction.
    // IY and UW are absent too, and for the same reason — they keep their colour in
    // an unstressed syllable ("happy", "into"), so flattening them gives "happuh".
    const CENTRALISES = new Set(['IH','EH','AE','AA','AO','UH','AH']);

    // WEAK FORMS. A function word doesn't simply become schwa — English weakens each
    // vowel to a specific target, and the high vowels do NOT go all the way to the
    // centre: /uː/ weakens to /ʊ/ and /iː/ to /ɪ/. Mapping everything to schwa turned
    // "you are" into "yuh er", which is further than even fast speech goes and reads
    // as a mumble rather than as connected speech.
    //
    // /ɪ/ IS ITSELF A WEAK-FORM VOWEL and must NOT map to schwa. This was the
    // single most audible fault in the voice: "is in it his its him this" are all
    // function words whose vowel is already IH, so reducing them centralised the
    // most-spoken words in the language into "uhz uhn uht" and left the whole line
    // sounding mumbled. English weakens /ɪ/ to nothing — the /ɪ/~/ə/ contrast
    // survives reduction (it is the whole difference between "roses" and "Rosa's").
    const WEAK = { IY:'IH', UW:'UH', EH:'AX', AE:'AX', AA:'AX', AO:'AX', AH:'AX', UH:'AX' };

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

    const ABBREV = new Set(['mr','mrs','ms','dr','st','jr','sr','prof','sgt','lt','capt','col','gen','inc','ltd','vs','approx','dept']);   // NOT "no" — "no." ends sentences far more often than it abbreviates number
    function textToPhonemes(text){
      const seq = [];
      // Multi-character marks come FIRST in the alternation or "..." arrives as three
      // full stops — three terminal pauses and three declination resets for one
      // trailing-off. `-{2,}`/em-dash only: a hyphen inside a word (well-known) is
      // not a break and must stay inside the word token.
      const toks = expandNumbers(text).trim().split(/(\s+|\.{2,}|…|—|–|-{2,}|[.,!?;:()])/).filter(Boolean);
      const PUNCT = /^(\.{2,}|…|—|–|-{2,}|[.,!?;:()])$/;
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
        if (/^\?$/.test(tok))         { pushBreak('_Q'); continue; }
        // Phrase edge: nothing but whitespace between here and a mark or the end.
        let j = i + 1; while (j < toks.length && /^\s+$/.test(toks[j])) j++;
        const edge = j >= toks.length || PUNCT.test(toks[j]);
        const w = tok.toLowerCase().replace(/[^a-z']/g, '');
        let ph = stressWord(pronounceWord(tok), w, edge);
        if (!shouty && (shout || isEmphatic(tok))) {
          const at = ph.indexOf('*');
          if (at >= 0) ph[at] = '!';                       // promote the lexical accent
          else {                                           // a deaccented function word can still be emphasised
            const v = ph.findIndex(x => VOWELS.has(x));
            if (v >= 0) ph.splice(v, 0, '!');
          }
        }
        seq.push(...ph);
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
    // NAMED VOICES — the handful of speakers that are a CHARACTER rather than a
    // face in the crowd, and so can't be left to the hash. Merged over the
    // derived voice, so anything not overridden still comes from the name.
    //
    // 'architect' is the login greeting. The hash put it on the HIGH branch at
    // f0 ≈ 174Hz with fshift > 1 — a short vocal tract talking near the top of
    // its range, which is the recipe for nasal and thin. The thing welcoming you
    // to Coldwater should sound like it's standing behind you, so: low and slow,
    // a long tract, almost no lilt (a flat delivery is menacing when the words
    // are pleasant), and a deep phrase-final fall.
    const NAMED_VOICES = {
      architect: {
        f0: 78, fshift: 0.86, speed: 1.06, ring: 0,
        oq: 0.48,            // pressed, not breathy — a closed glottis reads as weight
        jitter: 0.005, breath: 0,
        lilt: 0.035, decl: 0.18,
        // ⚠ A NAMED VOICE IS FULLY AUTHORED, INCLUDING THE TRAITS IT DOESN'T HAVE.
        // Anything absent here falls through to the dice above, so the moment
        // `drive` was added this voice quietly picked up 0.105 of it — a hand-tuned
        // character changing because somebody extended a table. Grit might well
        // suit the Architect, but that is a decision about a character, and a
        // decision nobody made is not one. Add a new trait here and to every other
        // named voice in the same commit.
        drive: 0, growl: 0,
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
      // Pre-boundary lengthening — a PHRASE edge, not a word edge.
      // …and it scales with the WEIGHT of the break. A syllable before a full stop is
      // held longer than one before a comma; that difference is a large part of how a
      // listener hears which mark was written.
      if (!ctx.nxtCode) dur *= 1.30;
      else if (isTerm(ctx.nxtCode)) dur *= 1.30;
      else if (isBreak(ctx.nxtCode)) dur *= 1.18;
      if (p.t === 'V') {
        dur *= ctx.wordScale;
        // AX is already the reduced vowel; shortening it again double-counts.
        dur *= ctx.stress === 2 ? 1 + (ctx.shout ? 1.15 : 0.65) * TUNING.emphasis
             : ctx.stress ? 1.12 : (code === 'AX' ? 1 : 0.8);
        // Pre-voiced lengthening — the real cue behind "bad" vs "bat".
        if (ctx.nxt && (ctx.nxt.t === 'F' || ctx.nxt.t === 'S' || ctx.nxt.t === 'H')) {
          dur *= ctx.nxt.vd ? 1.25 : 0.85;
        }
      }
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
    function estimateDuration(phon, speed, shout) {
      // Thin wrapper over segmentDuration/stopTiming — it walks the run and adds up
      // exactly what the scheduler will schedule. Do not reimplement a rule here.
      let t = 0.08, stress = 0, prevCode = null;
      let wordScale = sylScale(sylFrom(phon, 0));
      for (let i = 0; i < phon.length; i++) {
        const code = phon[i];
        if (isMark(code)) { stress = code === '!' ? 2 : 1; continue; }
        const p = PH[code]; if (!p) continue;
        let j = i + 1; while (isMark(phon[j])) j++;
        const nxtCode = phon[j], nxt = PH[nxtCode];
        if (p.t === 'P') wordScale = sylScale(sylFrom(phon, i + 1));
        const ctx = { nxtCode, nxt, prevCode, stress, shout, wordScale, speed };
        const dur = segmentDuration(p, code, ctx);
        if (p.t === 'V') stress = 0;
        if (p.t === 'F' && p.stopFirst) t += 0.03;
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
    function glottalWave(ctx, oq){
      const key = oq.toFixed(2);
      let w = _waveCache.get(key);
      if (w) return w;
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
      w = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
      _waveCache.set(key, w);
      return w;
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

    let live = [];
    function cancel(){ live.forEach(n => { try { n.stop(); } catch { /* already stopped */ } }); live = []; }

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
      cancel();
      // `opt.voice` overrides individual parameters on top of whatever the seed
      // rolled. Nothing in the game passes it — this exists so a voice can be
      // AUDITIONED. Character comes from hashing a name, so before this the only
      // way to hear what `drive` or `growl` sound like was to type seeds until one
      // happened to roll them, which is not tuning, it is fishing. The dev panel's
      // voice lab drives this; the values it prints go straight into NAMED_VOICES.
      const V = Object.assign(voiceFromName(opt.seed || text), opt.voice || null);
      const F0 = V.f0, ringAmt = V.ring, fshift = V.fshift;
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
      const speed = V.speed * TUNING.rate;
      // 'ui' is a DRY bus (see busFor). Read Aloud is the caller, and a screen
      // reader carrying the room's reverb is harder to understand, not richer.
      const out = busFor(ui ? 'ui' : 'tv');

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
      // A high SHELF lifts everything above its corner and never comes back down, so
      // +5.5dB at 2.6k boosted the 6–8kHz sibilant band by the full amount too — it
      // bought consonant clarity and paid for it in hiss. A wide peak centred on the
      // intelligibility band does the same job and leaves the sibilants alone.
      presence.type = 'peaking'; presence.frequency.value = 3000;
      presence.Q.value = 0.9; presence.gain.value = TUNING.presenceDb;
      // Keeps a loud vowel from swamping the consonant that follows it — the voice
      // sits at one level instead of lunging, which reads as microphone technique.
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -22; comp.knee.value = 12; comp.ratio.value = 3;
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
      master.connect(ringGain).connect(presence).connect(comp);
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
      voiceTail.connect(out);

      const glot = c.createOscillator(); glot.frequency.value = F0;
      glot.setPeriodicWave(glottalWave(c, V.oq));
      // The tilt filter used to be the ONLY thing standing in for glottal roll-off,
      // so it had to sit low (3.4k) and dulled the consonants along with the buzz.
      // The source now rolls off on its own, correctly, so this backs off to a
      // gentle top-end tame rather than a corrective.
      const tilt = c.createBiquadFilter();
      tilt.type = 'lowpass'; tilt.frequency.value = 5200; tilt.Q.value = 0.4;
      // JITTER + SHIMMER. A single LFO on F0 is vibrato, and vibrato is a *musical*
      // gesture — it reads as a synthesiser holding a note. Real jitter is aperiodic.
      // Two LFOs at an irrational-ish ratio beat against each other and never repeat
      // inside a phrase, which is enough to break the tone. Shimmer (the amplitude
      // half of the same roughness) rides the master gain, and matters more than its
      // size suggests: perfectly steady loudness is the other half of "machine".
      const jit = c.createOscillator(); jit.type = 'triangle'; jit.frequency.value = 9;
      const jitG = c.createGain(); jitG.gain.value = F0 * V.jitter; jit.connect(jitG).connect(glot.frequency);
      const jit2 = c.createOscillator(); jit2.type = 'sine'; jit2.frequency.value = 6.3;
      const jit2G = c.createGain(); jit2G.gain.value = F0 * V.jitter * 0.6; jit2.connect(jit2G).connect(glot.frequency);
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
        growlOsc = c.createOscillator();
        growlOsc.type = OSC_WAVES.includes(V.growlWave) ? V.growlWave : 'sine';
        growlOsc.frequency.value = F0 * (V.growlRatio ?? 0.5);
        const growlG = c.createGain(); growlG.gain.value = F0 * growlAmt;
        growlOsc.connect(growlG).connect(glot.frequency);
        if (V.growl2 > 0) {
          growl2Osc = c.createOscillator();
          growl2Osc.type = OSC_WAVES.includes(V.growl2Wave) ? V.growl2Wave : 'sine';
          growl2Osc.frequency.value = F0 * (V.growl2Ratio ?? 1.5);
          const g2 = c.createGain(); g2.gain.value = F0 * V.growl2;
          growl2Osc.connect(g2).connect(glot.frequency);
        }
      }
      const shim = c.createOscillator(); shim.type = 'sine'; shim.frequency.value = 5.1;
      const shimG = c.createGain(); shimG.gain.value = 0.05; shim.connect(shimG).connect(master.gain);
      const voiced = c.createGain(); voiced.gain.value = 0;
      glot.connect(tilt);
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
      const bank = buildResonatorBank(tilt, voiced, [0,1,2,3].map(k => {
        const f = k === 3 ? 3600 : 500;
        return { freq: f, q: qFor(f, k), gain: k === 0 ? 1 : 0.4 };
      }));
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
      const cascadeGains = (F, wide) => {
        const bw = F_BW.map(b => b * (wide ? 1.8 : 1));
        const A = F.map((fn, n) => {
          let a = fn / bw[n];                                  // its own resonant peak
          for (let k = 0; k < 4; k++) {
            if (k === n) continue;                             // every OTHER pole's skirt
            a *= (F[k]*F[k]) / Math.hypot(F[k]*F[k] - fn*fn, bw[k]*fn);
          }
          return a;
        });
        const m = A[0] || 1;
        // Clamped AFTER the rescale, or the floor would flatten exactly the
        // variation this exists to produce — half the vowels pinned to one value.
        return A.map((x, k) => Math.max(0.04, Math.min(1.3, (x / m) * CASCADE_FIT[k])));
      };
      // NASAL ANTIFORMANT. When the velum opens, the nasal cavity hangs off the tract
      // as a side branch and SUBTRACTS a band — a spectral zero. That zero is what
      // tells M from N from NG; their murmurs are otherwise near-identical, which is
      // why the old table (three formant triples and a gain drop) rendered all three
      // as the same hum. A peaking filter with negative gain is a serviceable zero.
      // It sits on the voiced path only — fricative noise never goes through the nose.
      const nzero = c.createBiquadFilter();
      nzero.type = 'peaking'; nzero.frequency.value = 1500; nzero.Q.value = 4; nzero.gain.value = 0;
      voiced.connect(nzero).connect(master);

      const nz = c.createBufferSource(); nz.buffer = speechNoise(c); nz.loop = true;
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
      const nbp = c.createBiquadFilter(); nbp.type = 'bandpass'; nbp.frequency.value = 4000; nbp.Q.value = 3;
      const nbp2 = c.createBiquadFilter(); nbp2.type = 'bandpass'; nbp2.frequency.value = 4000; nbp2.Q.value = 3;
      const nlp = c.createBiquadFilter(); nlp.type = 'lowpass'; nlp.frequency.value = 9000; nlp.Q.value = 0.7;
      // One helper so the two bandpasses can never drift apart — they must always
      // describe the same band or the cascade stops being a sharper version of it.
      const setNoiseBand = (f, q, when, tc) => {
        for (const n of [nbp, nbp2]) {
          if (tc) n.frequency.setTargetAtTime(f, when, tc); else n.frequency.setValueAtTime(f, when);
          n.Q.setValueAtTime(q, when);
        }
      };
      const noiseG = c.createGain(); noiseG.gain.value = 0;
      nz.connect(nbp).connect(nbp2).connect(nlp).connect(noiseG).connect(master);

      const t0 = c.currentTime + 0.05; let t = t0;
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
        const F = [arr[0]*fshift, arr[1]*fshift, arr[2]*fshift, 3600*fshift];
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
      };

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
      const phraseDur = phrases.map(ph => estimateDuration(ph, speed) || 1);
      // Per-phrase declination, read off the mark that ENDS each phrase: a question
      // holds itself open, an ellipsis sags away harder than a full stop does.
      const phraseDecl = phrases.map(ph => {
        const end = ph[ph.length-1];
        return end === '_Q' ? V.decl * 0.45 : end === '_E' ? V.decl * 1.25 : V.decl;
      });
      let phraseIx = 0, phraseT0 = t0;
      const totalDur = estimateDuration(phon, speed) || 1;
      // INTRINSIC F0. High vowels sit a little higher in pitch than low ones — the
      // raised tongue body pulls on the larynx. It correlates inversely with F1, so
      // it comes straight off the formant target rather than needing a table: /iy/
      // (F1 270) lands ~+4%, /aa/ (F1 730) ~-2%. Tiny, and its absence is part of
      // why synthetic vowels sound like they're all at the same pitch — because
      // they literally are.
      const intrinsicF0 = f1 => 1 + Math.max(-0.025, Math.min(0.045, (500 - f1) / 500 * 0.05));

      // MICROPROSODY. Pitch is perturbed by the consonant just released: after a
      // voiceless obstruent it starts high and falls into the vowel, after a voiced
      // one it starts low and rises. Real, small, and free here.
      let micro = 1;

      // BOUNDARY TONE — what the pitch does going INTO the mark. Each punctuation
      // mark has its own, and it is most of what tells the ear which one was written:
      // a comma rises and hands over, a colon holds level and announces, a dash breaks
      // off flat, an ellipsis drifts down and away, a question climbs.
      const BOUNDARY = { _C: 1.07, _S: 1.05, _D: 1.04, _E: 0.955, _Q: 1.13, _X: 1.02 };
      const pitchAt = (when, frac, stressed, f1, nextCode) => {
        const fall = 1 - (phraseDecl[phraseIx] ?? V.decl) * frac;   // declination
        // Emphasis is a level ABOVE stress, not a louder version of it — it moves
        // pitch about twice as far, which is what makes "it is GONE" land.
        const lift = stressed === 2 ? 1 + V.lilt * 3.4 * TUNING.emphasis
                   : stressed       ? 1 + V.lilt
                   :                  1 - V.lilt * 0.45;
        // CONTINUATION RISE. A comma is not a full stop: the clause is unfinished and
        // English says so by rising (or at least not falling) into the pause. Without
        // it a list reads as a series of separate little sentences, because every
        // clause got the same terminal fall.
        const hold = BOUNDARY[nextCode] || 1;
        glot.frequency.setTargetAtTime(F0 * fall * lift * hold * intrinsicF0(f1) * micro, when, 0.05);
        micro = 1;
        // SPECTRAL TILT tracks effort. A voice raised in emphasis doesn't just get
        // louder and higher, it gets BRIGHTER — the folds close harder and the
        // source spectrum tilts up. Moving the tilt filter with stress is what
        // makes an accent read as effort rather than as a volume knob.
        tilt.frequency.setTargetAtTime(stressed === 2 ? TUNING.tiltEmph : stressed ? TUNING.tiltStress : TUNING.tiltPlain, when, 0.04);
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
      let pendingStress = 0, prevNasal = false, prevP = null, prevCode = null;

      for (let i = 0; i < phon.length; i++) {
        const code = phon[i];
        if (isMark(code)) { pendingStress = code === '!' ? 2 : 1; continue; }
        const p = PH[code]; if (!p) continue;
        const nxt = phAt(i+1);
        const nxtCode = (() => { let j = i+1; while (isMark(phon[j])) j++; return phon[j]; })();
        const segCtx = { nxtCode, nxt, prevCode, stress: pendingStress, shout: shoutLine, wordScale, speed };
        let dur = segmentDuration(p, code, segCtx);
        // (pre-boundary, polysyllabic, stress, schwa and pre-voiced rules all live in
        //  segmentDuration now — see the note there.)

        if (p.t==='V' || p.t==='N' || p.t==='L') {
          const stressed = pendingStress; pendingStress = 0;
          let f = p.f;
          // Dark /l/ unless a vowel follows it.
          if (p.df && !(nxt && nxt.t === 'V')) f = p.df;
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
              let blend = Math.exp(-dur / 0.075);
              if (stressed) blend *= stressed === 2 ? 0.25 : 0.5;
              f = f.map((v, k) => v + (loc[k] - v) * blend * TUNING.undershoot);
            }
          }
          setF(t, f, nasalised, p.tc);
          if (nasal) {
            nzero.frequency.setTargetAtTime(p.az, t, 0.008);
            nzero.gain.setTargetAtTime(-22, t, 0.010);
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
          let vg = p.t==='V' ? (stressed === 2 ? (shoutLine ? 1.4 : 1.25) : stressed ? 0.95 : 0.72) : 0.6;
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
          if (p.t === 'V') voiced.gain.setTargetAtTime(vg * 0.86, t + dur*0.55, 0.05);
          // Breath noise has to state its OWN band. It didn't, so it played through
          // whatever the last fricative left behind — after any /s/ that meant 6.5kHz
          // at Q6, a narrow high hiss sustained underneath every following vowel. That
          // was the prominent "sss whisper" running under the whole voice. Real breath
          // is low and broad, nothing like a sibilant.
          setNoiseBand(1400, 0.7, t, 0.012);
          // A devoiced vowel is breath where the voice should be — without this the
          // syllable would just get quieter, which is a dropout, not a whisper.
          noiseG.gain.setTargetAtTime(devoiced ? 0.10 : V.breath * TUNING.breath, t, 0.01);
          if (p.t === 'V') pitchAt(t, (t - phraseT0) / (phraseDur[phraseIx] || totalDur), stressed, f[0], nxtCode);
          if (p.to) setF(t+dur*0.62, p.to, false, 0.018);
          t += dur;
        } else if (p.t==='F' || p.t==='H') {
          if (p.stopFirst) { voiced.gain.setTargetAtTime(0,t,0.005); noiseG.gain.setTargetAtTime(0,t,0.005); t += 0.03; }
          nzero.gain.setTargetAtTime(0, t, 0.02);
          if (p.lf) setF(t, p.lf, false, 0.012);   // place cue; fast — a constriction is released quickly
          // Q is SCHEDULED, not assigned. An imperative `Q.value =` applies
          // immediately rather than at time t, so the whole line ended up scheduled
          // with whichever Q the loop happened to finish on. setNoiseBand keeps that
          // property and drives both bandpasses together.
          // /h/ IS THE FOLLOWING VOWEL, DEVOICED. It has no constriction of its own —
          // the turbulence is at the glottis and the tract is already in position for
          // whatever comes next, which is why the /h/ of "he" and of "who" are
          // acoustically different sounds. A fixed 1500Hz band made every one of them
          // the same neutral puff. Shape it on the coming vowel instead, and start the
          // formants moving there too, so the vowel is already in place when voicing
          // arrives rather than sliding in after it.
          if (p.t === 'H' && nxt && nxt.t === 'V') {
            setNoiseBand(nxt.f[1], 1.2, t, 0.01);
            setF(t, nxt.f, false, 0.030);
          } else {
            setNoiseBand(p.nf, p.nq||3, t, 0.01);
          }
          let fam = p.t==='H' ? 0.11*TUNING.aspiration : (p.ng ?? 0.3) * (p.sib ? TUNING.sibilance : TUNING.friction);
          // A FINAL FRICATIVE IS QUIETER AND STOPS SOONER. Mid-word, the next vowel
          // masks the tail of the noise; at a word or phrase edge there is nothing
          // over it, so the same level hangs in the open as a hiss. English does damp
          // its own finals too — the "s" of "cats" is weaker than the "s" of "sat" —
          // so this is a correction, not just a mix decision.
          const finalF = !nxt || nxt.t === 'P';
          if (finalF) fam *= TUNING.finalTaper;
          noiseG.gain.setTargetAtTime(fam, t, 0.008);
          voiced.gain.setTargetAtTime(p.vd?0.35:0, t, 0.008);
          micro = p.vd ? 0.985 : 1.015;   // voiced obstruent drags F0 down, voiceless lifts it
          t += dur;
          // The release matters as much as the level: setTargetAtTime is exponential,
          // so a 20ms constant is still plainly audible ~80ms after the phoneme is
          // nominally over. That overhang IS the breathy tail. Cut it at an edge.
          // Squared so the knob moves level and overhang together but the tail moves
          // further — at 1.0 both are exactly the old behaviour.
          noiseG.gain.setTargetAtTime(0, t, 0.02 * (finalF ? TUNING.finalTaper ** 2 : 1));
        } else if (p.t==='S') {
          // CLOSURE — silence, but the formants are already travelling to the locus,
          // so the vowel BEFORE the stop bends the right way. A voiced stop keeps a
          // low "voice bar" buzzing through the closure; a voiceless one is dead air.
          if (p.lf) setF(t, p.lf, false, 0.012);
          nzero.gain.setTargetAtTime(0, t, 0.02);
          voiced.gain.setTargetAtTime(p.vd ? 0.12 : 0, t, 0.004);
          noiseG.gain.setTargetAtTime(0, t, 0.004);
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
          // BURST — see bq/bd/bg in the phoneme table. The defaults reproduce the
          // old fixed values exactly, so a stop that does not declare a shape (the
          // flap) releases precisely as it did before.
          setNoiseBand(p.nf, p.bq ?? 2, t, 0.005);
          noiseG.gain.setTargetAtTime(0.22 * (p.bg ?? 1) * TUNING.aspiration, t, 0.003);
          t += (p.bd ?? 20) / 1000;
          // ASPIRATION — the voice-onset gap. Voiceless stops breathe through it at
          // a glottal band; voiced ones barely have one and start phonating at once.
          //
          // Two allophonic corrections, both of which were audibly wrong:
          //
          // AFTER /s/ a voiceless stop is UNASPIRATED — "stop", "sky", "street" have
          // nothing like the puff of "top", "key", "treat". This is one of the most
          // reliable rules in English phonology and we were aspirating every one.
          //
          // BEFORE A LIQUID OR GLIDE the aspiration isn't a neutral puff either: the
          // liquid itself is DEVOICED and the turbulence is shaped by its
          // constriction. /tr/ is a single fricated gesture, not t + breath + r. A
          // full 60ms of 1800Hz noise between them is what turns "intrusive" into
          // "in-t'huh-rusive", so the noise is retuned to the liquid's own F2 and the
          // formant transition starts during it rather than after.
          const asp = timing.asp;
          const preLiquid = nxt && nxt.t === 'L';
          if (p.vd) {
            noiseG.gain.setTargetAtTime(0, t, 0.008);
            voiced.gain.setTargetAtTime(0.3, t, 0.005);
          } else {
            const band = preLiquid ? (nxt.df || nxt.f)[1] : 1800;
            setNoiseBand(band, preLiquid ? 1.6 : 1, t, 0.006);
            noiseG.gain.setTargetAtTime(0.085 * TUNING.aspiration, t, 0.006);
            noiseG.gain.setTargetAtTime(0, t+asp, 0.012);
            // Move the tract toward the liquid NOW, so the release is already
            // shaped like the /r/ or /l/ instead of arriving at it afterwards.
            if (preLiquid) setF(t, nxt.df || nxt.f, false, 0.020);
          }
          micro = p.vd ? 0.985 : 1.015;
          t += asp;
        } else if (p.t==='P') {
          // A terminal pause ends the phrase: the next one starts from the top of the
          // speaker's range again, which is what re-pitching after a full stop is.
          if (isTerm(code)) { phraseIx++; phraseT0 = t + dur/speed; }
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
      voiced.gain.setTargetAtTime(0, end, 0.02);
      // The last thing a line leaves behind. The voice is allowed to fade; the noise
      // is not, because with no voice under it the fade is a whisper of its own.
      noiseG.gain.setTargetAtTime(0, end, 0.02 * TUNING.finalTaper ** 2);
      // The terminal contour. Set as a target from wherever the lilt left the pitch —
      // the old code re-anchored F0 at t0 and ramped, which erased every contour
      // scheduled above it. A question turns the fall into a rise.
      glot.frequency.setTargetAtTime(
        rise ? F0 * (1 + V.lilt * 1.9) : F0 * (1 - V.decl) * (trail ? 0.88 : 0.94),
        Math.max(t0, end - 0.18), 0.06);
      // CREAK. English speakers routinely fall into vocal fry on the last syllable of
      // a statement — the folds run out of breath pressure, the pitch drops off a
      // cliff and the pulses go irregular. It is one of the most recognisable things
      // a real voice does at a full stop, and a synth that ends every sentence on a
      // clean tone sounds like it is reading a list of them. Not on questions, which
      // end lifted, and not so deep it becomes a growl.
      if (!rise && TUNING.creak > 0) {
        const cf = Math.max(0.55, 1 - 0.30 * TUNING.creak);
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
        glot.frequency.setTargetAtTime(F0 * cf * (trail ? 0.94 : 1), Math.max(t0, end - 0.07), 0.035);
        // Irregularity is the other half — a steady low tone is a hum, not creak.
        // BOTH LFOs. Raising only one leaves the other steady, which is a partial
        // return to periodic vibrato — the exact thing two beating LFOs exist to avoid.
        const cj = Math.max(t0, end - 0.07);
        jitG.gain.setTargetAtTime(F0 * V.jitter * (1 + 4 * TUNING.creak), cj, 0.03);
        jit2G.gain.setTargetAtTime(F0 * V.jitter * 0.6 * (1 + 4 * TUNING.creak), cj, 0.03);
      }
      const src = [glot, nz, lfo, jit, jit2, shim];
      if (growlOsc) src.push(growlOsc);
      if (growl2Osc) src.push(growl2Osc);
      src.forEach(n => n.start(t0));
      src.forEach(n => n.stop(end+0.1));
      live = src;
      // The REAL length of what was just scheduled. Callers used to guess from word
      // count and wait that long regardless, so a line that finished early left dead
      // air; handing back the truth lets them follow the voice instead of a timer.
      return { duration: end - t0 };
    }

    // Debug hook for the voice lab: the phoneme run a line will actually produce,
    // accent applied. Read-only and side-effect free.
    const phonemesFor = (text, opt = {}) => {
      _lex = opt.lex || null;
      try {
        let ph = applyAssimilation(applyAccent(textToPhonemes(text), opt.accent));
        if (opt.accent !== 'rp') ph = applyFlap(ph);
        return ph;
      } finally { _lex = null; }
    };
    return { speak, cancel, tuning: TUNING, phonemesFor, estimate: estimateDuration, voiceFor: voiceFromName };
  })();

  global.AudioEngine = {
    init, onUnlock, applyVolumeSettings, setMonoAudio,
    playSfx, playSample, clearSampleCache,
    loopSound, stopLoop, setLoopGain, duckLoop, setEcho,
    playMusic, stopMusic, stopMusicOwnedBy, pauseMusic, resumeMusic, queueMusic, fadeTo, crossFade, setLayerWeight,
    stop,
    noteToFreq,
    // The room the listener is standing in. Named spaces rather than numbers,
    // because the caller (plugins/audio) owns the world's vocabulary and this
    // file must never learn what a storm drain is.
    setSpace,
    spaceNames: () => Object.keys(SPACES),
    // The bus Read Aloud speaks through. Exposed only so a test can prove it is
    // not wired into the reverb send — that is a routing property, and routing is
    // exactly the kind of thing a later change breaks without touching this file.
    _speechBus: () => { ensureContext(); return busFor('ui'); },
    // What the voice pool is doing. A dropped cue is silent and a cue nobody
    // asked for is also silent, so without counters "is 32 enough?" is not a
    // question anyone can answer from the outside.
    _voiceStats: () => ({ ...vstat, size: MAX_VOICES, live: voices.filter(Boolean).length }),
    speak: (text, opt) => Speech.speak(text, opt),
    cancelSpeech: () => Speech.cancel(),
    // Live tunables — see the TUNING block in Speech. Mutate and the next line
    // spoken picks it up. Used by the voice lab (the dev panel's Voice Lab tab)
    // and read by tv.js for the inter-line gap.
    voiceTuning: Speech.tuning,
    _phonemesFor: (text, opt) => Speech.phonemesFor(text, opt),
    // One narrator's parameters, without speaking. Exposed because the draw ORDER
    // in voiceFromName is load-bearing — a field inserted above an existing one
    // shifts every draw after it and silently recasts every voice in the game —
    // and nothing could check that from outside until now.
    _voiceFor: (name) => Speech.voiceFor(name),
    // Scheduled length of a run, without needing an AudioContext — so the voice
    // smoke test can check pacing against broadcast's hold headlessly.
    _estimateDuration: (phon, speed, shout) => Speech.estimate(phon, speed, shout),
    // Hand a custom synth (e.g. the flight-engine) the context + ambient bus + shared noise
    // buffer so it can build its own live, parameter-driven node graph on the ambient chain.
    engineNodes: () => { const c = ensureContext(); if (!c) return null; return { ctx: c, bus: busFor('ambient'), noise: getNoiseBuffer() }; },
  };

})(typeof window !== 'undefined' ? window : globalThis);
