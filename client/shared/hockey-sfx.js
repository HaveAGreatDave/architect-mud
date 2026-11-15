/**
 * Hockey soundset: the CPhL's sound, an FM-synthesised homage to a mid-1990s console hockey
 * cartridge (NHL '96 on the 16-bit machines). Hard, dry, immediate transients; short, crunchy,
 * slightly metallic impacts; a woody stick; a check that's a thud and a crack; brief scrapes;
 * a plain piercing whistle; a big blunt goal horn; a coarse crowd. Simple tones, no cinematic
 * layers, readable at low volume on cheap speakers in a busy mix. It recreates none of the
 * original's assets or hardware, only the character.
 *
 * IT DOES NOT CONTAIN A SYNTHESIZER. Every patch is data in the layer schema SIREN's
 * buildLayer already plays (client/shared/audio-engine.js): an FM voice (carrier, modulator
 * ratio, an index that falls as the sound dies, a pitch envelope), noise through a biquad, an
 * exponential envelope (`adsr.curve: 'exp'`), optional drive, and the cue's `retro` stage
 * (sample-and-hold and bit depth, per cue). The crowd bed is the one live part: `crowdBed()`
 * below builds it on the ambient bus through AudioEngine.engineNodes(), the seam the sea and
 * the yacht already use.
 *
 * The patches are the catalog's own shape ({ id, name, group, category, priority, config }),
 * so sfx-catalog.js folds them in and the dev panel's Audio tab lists, plays, edits and
 * overrides every one (an override saved there wins over the default here: ↺ resets it).
 * docs/systems-hockey-sound.md names every patch, its parameters and how to tune it.
 *
 * Dual-mode like audio-engine.js / sfx-catalog.js: attaches to window/globalThis so it loads
 * as a plain <script> AND is visible to ESM modules as a global.
 */
(function (global) {

  // ── seeded rng, so a given event sounds the same on every client ─────────────
  function rngFrom(seed) {
    let s = (seed >>> 0) || 1;
    return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // ── voices ───────────────────────────────────────────────────────────────────
  // tone(): one FM voice. `hz` is the carrier; `mod` the modulator as a ratio of it (2 is
  // bright and harmonic, 0.5 hollow, 1.41 or 2.41 inharmonic: a collision rather than a
  // note); `index` the modulation index at the strike, falling to `indexEnd` over `slide`
  // seconds, which is what turns a tone into a struck object; `to` a pitch it falls (or
  // rises) to over `bend`, carrier and modulator together. The envelope is exponential
  // (a: attack, d: about where it's down 26 dB, s: sustain, r: release) unless `linear`.
  // `noise` blends noise into the same envelope.
  function tone(o) {
    const L = {
      waveform: o.wave || 'sine', freq: o.hz, gain: o.gain ?? 0.2,
      adsr: { a: o.a ?? 0.0006, d: o.d ?? 0.04, s: o.s ?? 0, r: o.r ?? 0.02, ...(o.linear ? {} : { curve: 'exp' }) },
    };
    if (o.mod) {
      L.fm = { ratio: o.mod, index: o.index ?? 1, time: o.slide ?? (o.d ?? 0.04) * 0.5 };
      if (o.indexEnd != null) L.fm.indexEnd = o.indexEnd;
      if (o.modWave) L.fm.wave = o.modWave;
      if (o.op2) L.fm.op2 = o.op2;
    }
    if (o.to) L.pitchBend = { to: o.to, time: o.bend ?? (o.d ?? 0.04) * 0.7 };
    if (o.noise) L.noiseMix = o.noise;
    if (o.filter) L.filter = o.filter;
    if (o.drive) L.drive = o.drive;
    if (o.delay) L.delay = o.delay;
    if (o.vibrato) L.vibrato = o.vibrato;
    if (o.tremolo) L.tremolo = o.tremolo;
    if (o.detune) L.detune = o.detune;
    if (o.mods) L.mods = o.mods;
    return L;
  }
  // noise(): band of noise. `hz` and `q` place it (bandpass unless `type`), `to` sweeps it.
  function noise(o) {
    const L = {
      waveform: 'noise', noiseMix: 1, gain: o.gain ?? 0.08,
      filter: { type: o.type || 'bandpass', freq: o.hz ?? 2000, q: o.q ?? 0.8 },
      adsr: { a: o.a ?? 0.0006, d: o.d ?? 0.02, s: o.s ?? 0, r: o.r ?? 0.015, ...(o.linear ? {} : { curve: 'exp' }) },
    };
    if (o.to) { L.filter.to = o.to; L.filter.time = o.sweep ?? (o.d ?? 0.02); }
    if (o.rate) L.noiseRate = o.rate;
    if (o.tremolo) L.tremolo = o.tremolo;
    if (o.delay) L.delay = o.delay;
    if (o.drive) L.drive = o.drive;
    return L;
  }
  // The cartridge colour. `rate` is the sample-and-hold rate (Hz) and `bits` the depth, both
  // per cue (see retroStage in audio-engine.js). Impacts get a little, the crowd and scrapes
  // more, the whistle none: it should sound like a compact 16-bit game, not a broken one.
  const CART = { rate: 16000, bits: 10 };
  const GRIT = { rate: 11025, bits: 9 };
  const CHIP = { rate: 11025, bits: 8 };

  // A patch. `vary` is how far a take may wander from it ({ pitch, gain, env } as fractions):
  // impacts and scrapes vary, a whistle or a horn barely does. Every noise layer gets its
  // own place in the noise buffer so two layers are never the same grain.
  const IMPACT = { pitch: 0.04, gain: 0.12, env: 0.1 };
  const STEADY = { pitch: 0.004, gain: 0.03, env: 0 };
  function def(id, name, priority, layers, o = {}) {
    layers.forEach((l, k) => { if (l.noiseMix > 0 && l.noiseSeed == null) l.noiseSeed = 101 + k * 37; });
    // the whole cue: the longest layer's delay, attack and decay; each layer's release runs after
    const reach = Math.max(...layers.map((l) => (l.delay ?? 0) + l.adsr.a + l.adsr.d));
    const config = { duration: o.hold ?? +(reach * 0.25).toFixed(4), layers };
    if (o.retro !== false) config.retro = o.retro || CART;
    // `rec`: { key, lufs } a field recording each take plays a cut of (variant(), below)
    return { id, name, group: 'hockey', category: o.category || 'sfx', priority, vary: o.vary || IMPACT, config, ...(o.rec ? { rec: o.rec } : {}) };
  }

  // ═══ A. PUCK ON STICK ════════════════════════════════════════════════════════
  // A small, hard, woody click: a high inharmonic transient whose index collapses at once,
  // a little knock of body under it falling in pitch, and a few milliseconds of noise. Not a
  // bell (the index is gone in 10 ms), not a zap (the pitch moves 10%, not an octave).
  const stick = (k, hard) => [
    tone({ hz: 2900 * k, mod: 1.41, index: 1.6 + hard, indexEnd: 0.15, slide: 0.008, to: 2650 * k, bend: 0.02, d: 0.018 + hard * 0.008, r: 0.008, gain: 0.22 + hard * 0.1 }),
    tone({ hz: 520 * k, mod: 2, index: 0.7, indexEnd: 0, slide: 0.02, to: 440 * k, bend: 0.03, a: 0.001, d: 0.022 + hard * 0.012, r: 0.01, gain: 0.07 + hard * 0.04 }),
    noise({ hz: 4200 * k, q: 0.9, d: 0.006 + hard * 0.003, r: 0.004, gain: 0.06 + hard * 0.04 }),
  ];

  // ═══ B. PUCK ON THE BOARDS ═══════════════════════════════════════════════════
  // Hard and hollow: a short low thump, a hollow knock (a 0.5 modulator gives the odd
  // harmonics a hollow box has) that rings a moment and stops, a brighter wooden crack, and
  // a breath of noise. The resonance is held short: a bounce, not a door slam.
  const boards = (k, hard) => [
    tone({ hz: 160 * k, to: 115 * k, bend: 0.03, a: 0.0008, d: 0.022 + hard * 0.012, r: 0.012, gain: 0.08 + hard * 0.05 }),
    tone({ hz: 560 * k, mod: 2, index: 1.6 + hard * 0.5, indexEnd: 0.3, slide: 0.03, to: 520 * k, bend: 0.05, a: 0.0008, d: 0.045 + hard * 0.03, r: 0.018, gain: 0.16 + hard * 0.07 }),
    tone({ hz: 1850 * k, mod: 1.73, index: 2.2 + hard, indexEnd: 0.2, slide: 0.01, a: 0.0005, d: 0.018 + hard * 0.008, r: 0.008, gain: 0.12 + hard * 0.07 }),
    noise({ hz: 1300 * k, q: 1.1, d: 0.02 + hard * 0.01, r: 0.012, gain: 0.05 + hard * 0.04 }),
  ];

  // ═══ C. PUCK ON A MAN ════════════════════════════════════════════════════════
  // Compact and sharp, with more body than the stick: a 20–45 ms crack over a 50–100 ms
  // low-mid thud, each on its own envelope, and a restrained inharmonic edge on the thud.
  const puckBody = (k) => [
    tone({ hz: 2300 * k, mod: 1.41, index: 1.6, indexEnd: 0.1, slide: 0.01, a: 0.0005, d: 0.028, r: 0.01, gain: 0.2 }),
    tone({ hz: 330 * k, mod: 1.41, index: 0.9, indexEnd: 0.05, slide: 0.025, to: 250 * k, bend: 0.05, a: 0.001, d: 0.06, r: 0.02, gain: 0.17 }),
    noise({ type: 'lowpass', hz: 1900, q: 0.4, d: 0.025, r: 0.012, gain: 0.06 }),
  ];

  // ═══ D. BODY CHECK ═══════════════════════════════════════════════════════════
  // The low impact starts at once; the sharper, slightly noisy crack within a few
  // milliseconds; a short rough mid tail dies quickly. The low part is driven a little for
  // the crunch. The transient leads: it reads as contact before it reads as weight. Under it
  // the crunch itself: slowed noise chopped by a fast tremolo into grains, so the hit
  // has pads and gear grinding in it rather than one clean knock.
  const check = (k, heavy) => [
    noise({ hz: 1250 * k, q: 0.7, a: 0.001, d: 0.06 + heavy * 0.03, r: 0.025, gain: 0.07 + heavy * 0.03, rate: 0.35, tremolo: { rate: 73, depth: 0.7 }, delay: 0.002 }),
    noise({ type: 'lowpass', hz: 700 * k, q: 0.6, a: 0.001, d: 0.045 + heavy * 0.02, r: 0.02, gain: 0.05 + heavy * 0.02, rate: 0.25, tremolo: { rate: 41, depth: 0.5 }, delay: 0.005 }),
    tone({ hz: 130 * k, to: 88 * k, bend: 0.04, a: 0.001, d: 0.035 + heavy * 0.02, r: 0.02, gain: 0.11 + heavy * 0.05, filter: { type: 'highpass', freq: 60, q: 0 } }),
    tone({ hz: 340 * k, mod: 2, index: 2, indexEnd: 0.3, slide: 0.03, to: 270 * k, bend: 0.05, a: 0.001, d: 0.055 + heavy * 0.025, r: 0.022, gain: 0.17 + heavy * 0.05 }),
    tone({ hz: 1650 * k, mod: 2.41, index: 3 + heavy, indexEnd: 0.35, slide: 0.014, a: 0.0005, d: 0.035 + heavy * 0.015, r: 0.014, gain: 0.15 + heavy * 0.05, noise: 0.35, delay: 0.003 }),
    noise({ hz: 950, q: 0.8, a: 0.002, d: 0.075 + heavy * 0.035, r: 0.028, gain: 0.1 + heavy * 0.04, delay: 0.004 }),
  ];

  // ═══ E. SKATING ══════════════════════════════════════════════════════════════
  // A brief granular scrape, not a field recording: a band of noise (1–5 kHz) pulsed by two
  // tremolos at rates that never line up, so the grains come unevenly, with a faint pitched
  // hiss under it. Low-rate sample-and-hold gives it the grit of a sampled hiss.
  const scrape = (o) => [
    noise({ hz: o.hz, q: 1.7, to: o.to, sweep: o.d * 0.8, a: o.a ?? 0.004, d: o.d, s: o.s ?? 0, r: o.r ?? 0.03, gain: o.gain * 1.3, rate: 0.8, tremolo: { rate: o.pulse, depth: 0.55 } }),
    noise({ hz: o.hz * 1.45, q: 2.2, to: o.to ? o.to * 1.45 : undefined, sweep: o.d * 0.8, a: (o.a ?? 0.004) * 2, d: o.d * 0.8, s: o.s ?? 0, r: o.r ?? 0.03, gain: o.gain * 0.6, rate: 0.9, tremolo: { rate: o.pulse * 1.73, depth: 0.6 } }),
    tone({ hz: o.tone, mod: 1.41, index: 2, indexEnd: 1, slide: o.d, a: 0.01, d: o.d * 0.9, r: 0.02, gain: o.gain * 0.12, noise: 0.4 }),
  ];

  // ═══ F. WHISTLE ══════════════════════════════════════════════════════════════
  // A pea whistle, plainly: one strong tone with a quieter second one 45 Hz above it, so the
  // two beat into the little flutter a whistle has; a slight rise into pitch at the start,
  // a hint of vibrato, a breath of noise. No siren, no musical phrasing, nothing under 2 kHz
  // that a phone speaker would lose.
  const whistle = (hold, f = 2950) => [
    tone({ hz: f * 0.97, to: f, bend: 0.025, linear: true, a: 0.006, d: 0.03, s: 0.82, r: 0.05, gain: 0.17, vibrato: { rate: 5.5, depth: 7 } }),
    tone({ hz: (f + 45) * 0.97, to: f + 45, bend: 0.025, linear: true, a: 0.009, d: 0.03, s: 0.75, r: 0.045, gain: 0.06 }),
    noise({ hz: f, q: 2.5, linear: true, a: 0.006, d: 0.03, s: 0.7, r: 0.04, gain: 0.02 }),
  ];

  // ═══ G. GAMEPLAY SIGNAL ══════════════════════════════════════════════════════
  // A short clean digital alert with a small step up in pitch, a little coarse (a gentle
  // 2:1 modulator and a low sample rate). Two parts is two of them a fourth apart. Nowhere
  // near the whistle: lower, steadier, and over in a blink.
  const beep = (hz, up, delay, d = 0.07) => tone({ hz, to: hz * Math.pow(2, up / 12), bend: 0.02, mod: 2, index: 0.7, indexEnd: 0.3, slide: 0.05,
    linear: true, a: 0.003, d, s: 0.55, r: 0.03, gain: 0.13, delay });

  // ═══ H. GOAL HORN ════════════════════════════════════════════════════════════
  // A FOG HORN, the air horn off a ship that an arena bolts under its roof: low, reedy and
  // huge. Two sawtooth reeds at 116 Hz, a hair apart, so the blast wobbles slowly as two horns
  // do, each scooping up into its pitch as the air arrives, through a lowpass so it's a reed
  // and not a buzz, with a faint flutter in the air column. Over them a brassy FM partial and
  // the 3rd, for presence on a small speaker, which won't play the 116 Hz underneath, and a
  // breath of air riding the blast. When the air's cut it doesn't just stop: it groans down
  // most of a fifth as it dies (the grunt), the way a diaphone does. That's GRUNT: each reed is
  // pitched a fifth low and an envelope holds it up to the note, so on the release the
  // envelope falls and takes the pitch down with the level. (A late layer for the grunt held
  // its voice a second past the sound.) No reverb tail, no crowd: the cheer is its own event,
  // so the game decides when and how loud.
  const HORN = 116, FIFTH = 668;    // 1200 log2(1 / 0.68): the grunt's drop, in cents
  const GRUNT = [{ id: 'grunt', type: 'env', a: 0.004, d: 0.05, s: 1, r: 0.42, to: [{ param: 'pitch', amount: FIFTH }] }];
  const low = HORN * 0.68;
  const horn = () => [
    tone({ hz: low * 0.92, to: low, bend: 0.16, wave: 'sawtooth', linear: true, a: 0.022, d: 0.12, s: 0.95, r: 0.42, gain: 0.21, mods: GRUNT,
      filter: { type: 'lowpass', freq: 1900, q: 0.9 }, tremolo: { rate: 6.1, depth: 0.05 } }),
    tone({ hz: (low + 0.9) * 0.92, to: low + 0.9, bend: 0.2, wave: 'sawtooth', linear: true, a: 0.026, d: 0.14, s: 0.9, r: 0.42, gain: 0.13, mods: GRUNT,
      filter: { type: 'lowpass', freq: 1500, q: 0.8 } }),
    tone({ hz: HORN * 2 * 0.95, to: HORN * 2, bend: 0.16, mod: 2, index: 1.4, indexEnd: 0.6, slide: 0.3, linear: true, a: 0.026, d: 0.16, s: 0.85, r: 0.3, gain: 0.15,
      filter: { type: 'lowpass', freq: 2600, q: 0.5 } }),
    tone({ hz: HORN * 3 - 0.7, linear: true, a: 0.035, d: 0.2, s: 0.75, r: 0.26, gain: 0.11 }),
    tone({ hz: HORN * 4 + 1.1, linear: true, a: 0.04, d: 0.2, s: 0.7, r: 0.24, gain: 0.05 }),
    noise({ hz: 560, q: 0.9, linear: true, a: 0.05, d: 0.2, s: 0.7, r: 0.3, gain: 0.05, tremolo: { rate: 6.1, depth: 0.2 } }),
  ];

  // ═══ I. PERIOD END ═══════════════════════════════════════════════════════════
  // A buzzer, not a horn: higher (330 Hz), flatter, with a fifth in it (1.5×) and a square
  // fundamental, and a faint electric flutter. Played straight after the goal horn it's
  // plainly the other one. A whistle before it, if wanted, is the game's sequencing.
  const BUZZ = 330;
  const buzzer = () => [
    tone({ hz: BUZZ, wave: 'square', linear: true, a: 0.012, d: 0.1, s: 0.85, r: 0.18, gain: 0.13,
      filter: { type: 'lowpass', freq: 3000, q: 0.5 }, tremolo: { rate: 7.5, depth: 0.12 } }),
    tone({ hz: BUZZ * 1.5, mod: 2, index: 1.2, indexEnd: 0.8, slide: 0.1, linear: true, a: 0.015, d: 0.1, s: 0.8, r: 0.18, gain: 0.18 }),
    tone({ hz: BUZZ * 2, mod: 2, index: 0.6, linear: true, a: 0.015, d: 0.1, s: 0.75, r: 0.18, gain: 0.14 }),
    tone({ hz: BUZZ * 3, linear: true, a: 0.018, d: 0.1, s: 0.7, r: 0.16, gain: 0.07 }),
  ];

  // ═══ K. CROWD ONE-SHOTS ══════════════════════════════════════════════════════
  // Procedural, fitted to recordings (CC0, from Freesound; the doc's K names them): half-octave
  // bands of pink noise whose levels were solved so the spectrum matches the recording's, and
  // a smoothed random source on each band group's level at the rate and depth the recording's
  // level wanders, so a cheer moves the way a crowd does and never repeats as a tremolo does.
  // The timing is the game's, not the recording's: a reaction answers the play at once, and
  // the bed under it (crowdBed() below) carries the long tail when it lifts.
  //
  // crowd(bands, wander, env): `bands` [[centre Hz, gain]], each through a doubled bandpass
  // (12 dB an octave either side); `wander` [[rate, depth]] for the low (under 450 Hz), middle
  // (to 1.8 kHz) and high groups. A group's bands share a seed, so they swell together.
  const CROWD_CENTRES = [125, 180, 250, 355, 500, 710, 1000, 1400, 2000, 2800, 4000, 5600];
  const crowdGroup = (hz) => (hz < 450 ? 0 : hz < 1800 ? 1 : 2);
  const crowd = (bands, wander, env) => bands.map(([hz, gain]) => {
    const g = crowdGroup(hz), [rate, depth] = wander[g];
    return {
      waveform: 'noise', noiseMix: 1, noise: 'pink', noiseSeed: 307 + CROWD_CENTRES.indexOf(hz) * 41, gain,
      filter: { type: 'bandpass', freq: hz, q: 1.2, slope: 24 },
      adsr: { a: env.a, d: env.d, s: env.s, r: env.r },
      ...(depth > 0 ? { mods: [{ id: 'w', type: 'rand', rate, smooth: true, seed: 17 + g * 101, to: [{ param: 'amp', amount: depth }] }] } : {}),
    };
  });
  // a small crowd's gasp (HowardV)
  const gasp = () => crowd([[710, 0.2462], [1000, 0.1269], [1400, 0.0957], [2800, 0.0605]],
    [[0, 0], [5.21, 0.243], [5.21, 0.458]], { a: 0.045, d: 0.12, s: 0.35, r: 0.22 });
  // a cheer (FlatHill's sports crowd); the goal, a check into the boards at an arena (producerdan)
  const cheer = (big) => (big
    ? crowd([[125, 0.0738], [250, 0.0762], [710, 0.1901], [1000, 0.187], [1400, 0.0387], [2000, 0.1731], [2800, 0.0437], [5600, 0.0756]],
      [[3.14, 0.595], [3.59, 0.318], [4.04, 0.461]], { a: 0.25, d: 0.2, s: 0.85, r: 0.9 })
    : crowd([[710, 0.0629], [1000, 0.2172], [1400, 0.0738], [2000, 0.074], [2800, 0.0642], [5600, 0.0356]],
      [[0, 0], [4.68, 0.296], [4.9, 0.186]], { a: 0.14, d: 0.2, s: 0.85, r: 0.45 }));
  // The arena between plays, fitted to an NHL crowd (SEF7, Rogers Arena): crowdBed() builds it
  // live, and hk-crowd-bed is the same bands as a cue. Gains as fitted, for pink noise; the 4 kHz
  // band is left out, since the bed's 2.4 kHz shade would take it anyway.
  const BED_BANDS = [[125, 0.0731], [180, 0.0726], [250, 0.1529], [355, 0.0391], [500, 0.2046], [710, 0.2144], [1400, 0.1844], [2000, 0.1133], [2800, 0.1226]];
  const BED_WANDER = [[6, 0.155], [6, 0.169], [3.93, 0.585]];
  const BED_CUE = 0.21;   // the cue as loud as the one before the fit

  // ── the bank ─────────────────────────────────────────────────────────────────
  const BUILTINS = [

    // A — puck on stick: light, ordinary, hard
    def('hk-puck-stick-light', 'Puck on stick — light', 3, stick(1.12, 0)),
    def('hk-puck-stick', 'Puck on stick', 4, stick(1, 0.5)),
    def('hk-puck-stick-hard', 'Puck on stick — hard', 5, stick(0.9, 1)),
    // B — puck on the boards: soft, normal, hard
    def('hk-boards-soft', 'Puck on the boards — soft', 4, boards(1.08, 0)),
    def('hk-boards', 'Puck on the boards', 5, boards(1, 0.5)),
    def('hk-boards-hard', 'Puck on the boards — hard', 6, boards(0.92, 1)),
    // C — puck on a man
    def('hk-puck-body', 'Puck on a man', 6, puckBody(1)),
    // D — body check: light, heavy, into the boards (the boards' own knock comes in a
    // beat later and well under the hit, rather than two full impacts at once)
    def('hk-check-light', 'Body check — light', 7, check(1.1, 0)),
    def('hk-check', 'Body check — heavy', 7, check(1, 1)),
    def('hk-check-boards', 'Body check — into the boards', 8, [...check(0.95, 1),
      ...boards(0.85, 0.6).map((l) => ({ ...l, gain: l.gain * 0.55, delay: (l.delay || 0) + 0.012 }))]),
    // E — skating: short, a hard turn, braking
    def('hk-skate-scrape', 'Skate — scrape', 2, scrape({ hz: 2100, d: 0.07, pulse: 16, tone: 900, gain: 0.09 }), { retro: CART }),
    def('hk-skate-turn', 'Skate — hard turn', 3, scrape({ hz: 1800, to: 2500, d: 0.14, pulse: 12, tone: 760, gain: 0.1, r: 0.05 }), { retro: CART }),
    def('hk-skate-stop', 'Skate — braking', 4, scrape({ hz: 2900, to: 1300, a: 0.008, d: 0.17, s: 0.1, pulse: 21, tone: 1250, gain: 0.13, r: 0.045 }), { retro: CART }),
    // F — the referee's whistle: a short blast, and a held one
    def('hk-whistle-short', 'Whistle — short', 9, whistle(), { hold: 0.12, retro: false, vary: STEADY }),
    def('hk-whistle', 'Whistle — held', 9, whistle(), { hold: 0.36, retro: false, vary: STEADY }),
    // G — gameplay signals: one note, and two
    def('hk-signal', 'Signal — alert', 6, [beep(1046.5, 2, 0, 0.09)], { hold: 0.06, retro: CHIP, vary: STEADY }),
    def('hk-signal-two', 'Signal — two-part', 6, [beep(880, 0, 0, 0.06), beep(1174.7, 2, 0.11, 0.08)], { hold: 0.05, retro: CHIP, vary: STEADY }),
    // H — the goal horn: short, and long (one sustained blast, not repeats)
    def('hk-goal-horn-short', 'Goal horn — short', 10, horn(), { hold: 0.55, vary: STEADY }),
    def('hk-goal-horn', 'Goal horn', 10, horn(), { hold: 1.45, vary: STEADY }),
    // the horn for a goal in live play: the full blast an arena gives its own team's goal
    def('hk-goal-horn-long', 'Goal horn — live goal', 10, horn(), { hold: 3.4, vary: STEADY }),
    // I — the end of a period
    def('hk-period-horn', 'Period end', 10, buzzer(), { hold: 1.3, vary: STEADY }),
    // K — the crowd's one-shots (the bed is crowdBed())
    def('hk-crowd-gasp', 'Crowd — gasp', 2, gasp(), { hold: 0.05, retro: CART, category: 'ambient', vary: { pitch: 0.05, gain: 0.1, env: 0.15 } }),
    def('hk-crowd-cheer', 'Crowd — cheer', 2, cheer(false), { hold: 0.5, retro: CART, category: 'ambient', vary: { pitch: 0.05, gain: 0.1, env: 0.15 }, rec: { key: 'crowd_cheer', lufs: -28.4 } }),
    def('hk-crowd-goal', 'Crowd — goal celebration', 3, cheer(true), { hold: 1.9, retro: CART, category: 'ambient', vary: { pitch: 0.04, gain: 0.08, env: 0.1 }, rec: { key: 'crowd_goal', lufs: -25.5 } }),
    def('hk-crowd-roar', 'Crowd — roar', 3, cheer(true), { hold: 1.2, retro: CART, category: 'ambient', vary: { pitch: 0.04, gain: 0.08, env: 0.1 }, rec: { key: 'crowd_goal', lufs: -26.2 } }),
    def('hk-crowd-groan', 'Crowd — groan', 2, [
      noise({ hz: 520, q: 0.9, to: 340, sweep: 0.5, linear: true, a: 0.12, d: 0.3, s: 0.6, r: 0.5, gain: 0.16 }),
      noise({ hz: 300, q: 3.5, to: 220, sweep: 0.6, linear: true, a: 0.15, d: 0.3, s: 0.5, r: 0.5, gain: 0.08 }),
    ], { hold: 0.5, retro: GRIT, category: 'ambient', vary: { pitch: 0.05, gain: 0.1, env: 0.15 } }),
    // an arena booing a missed penalty (TRP)
    def('hk-crowd-boo', 'Crowd — boo', 2, crowd([[355, 0.0173], [500, 0.0747], [710, 0.0447], [1000, 0.0468], [1400, 0.0112], [2000, 0.0177]],
      [[6, 0.093], [5.65, 0.236], [5.35, 0.138]], { a: 0.2, d: 0.3, s: 0.8, r: 0.6 }),
    { hold: 1.1, retro: GRIT, category: 'ambient', vary: { pitch: 0.05, gain: 0.1, env: 0.15 }, rec: { key: 'crowd_boo', lufs: -37.4 } }),
    // a bed for pages that have no crowdBed() (the fighter sandbox loops this): crowdBed()'s bands
    def('hk-crowd-bed', 'Crowd — arena bed', 1, crowd(BED_BANDS.map(([hz, g]) => [hz, +(g * BED_CUE).toFixed(4)]), BED_WANDER,
      { a: 0.6, d: 0.4, s: 0.9, r: 0.8 }), { hold: 3.4, retro: GRIT, category: 'ambient', vary: { pitch: 0.03, gain: 0.08, env: 0.1 } }),

    // ── secondary ────────────────────────────────────────────────────────────
    // a shot: a sharp crack off the blade with a small fall in pitch; a slapper has the
    // wind-up's weight under it
    def('hk-puck-slap', 'Shot — slapshot', 6, [
      tone({ hz: 1350, mod: 1.41, index: 2.4, indexEnd: 0.2, slide: 0.012, to: 1000, bend: 0.04, a: 0.0005, d: 0.034, r: 0.012, gain: 0.2 }),
      tone({ hz: 300, mod: 2, index: 1.6, indexEnd: 0.2, slide: 0.03, to: 200, bend: 0.05, a: 0.0008, d: 0.06, r: 0.025, gain: 0.2 }),
      tone({ hz: 150, to: 105, bend: 0.04, a: 0.0008, d: 0.04, r: 0.02, gain: 0.09, filter: { type: 'highpass', freq: 60, q: 0 } }),
      noise({ hz: 1700, q: 0.9, to: 900, sweep: 0.03, d: 0.024, r: 0.012, gain: 0.08 }),
    ]),
    def('hk-shot-wrist', 'Shot — wrist', 5, [
      tone({ hz: 1550, mod: 1.41, index: 1.8, indexEnd: 0.15, slide: 0.01, to: 1200, bend: 0.035, a: 0.0005, d: 0.026, r: 0.01, gain: 0.16 }),
      tone({ hz: 360, mod: 2, index: 0.9, indexEnd: 0, slide: 0.02, to: 260, bend: 0.04, a: 0.0008, d: 0.045, r: 0.02, gain: 0.15 }),
      noise({ hz: 2000, q: 0.9, to: 1200, sweep: 0.025, d: 0.014, r: 0.01, gain: 0.05 }),
    ]),
    // a pass: lighter and quicker than any shot, and woodier than the stick's click: the
    // blade's knock carries it and the click on top is small
    def('hk-pass', 'Pass', 3, [
      tone({ hz: 1300, mod: 1.41, index: 1.2, indexEnd: 0.1, slide: 0.008, to: 1180, bend: 0.02, d: 0.016, r: 0.008, gain: 0.1 }),
      tone({ hz: 420, mod: 2, index: 0.8, indexEnd: 0, slide: 0.02, to: 330, bend: 0.03, a: 0.001, d: 0.035, r: 0.015, gain: 0.14 }),
      noise({ hz: 1600, q: 0.9, d: 0.006, r: 0.004, gain: 0.04 }),
    ]),
    // the dribble, puck tapped stick to stick: barely there
    def('hk-puck-tick', 'Puck — dribble tick', 2, stick(1.2, 0).map((l) => ({ ...l, gain: l.gain * 0.45 }))),
    // the goalie: pads are a firm hollow thump, the glove a snappy leather pop, a shot off
    // the chest something between
    def('hk-pad-save', 'Save — pad', 7, [
      tone({ hz: 260, mod: 2, index: 1.4, indexEnd: 0.2, slide: 0.03, to: 190, bend: 0.05, a: 0.001, d: 0.055, r: 0.022, gain: 0.2 }),
      tone({ hz: 820, mod: 2, index: 1.2, indexEnd: 0.15, slide: 0.03, to: 760, a: 0.0008, d: 0.04, r: 0.014, gain: 0.13 }),
      noise({ type: 'lowpass', hz: 1800, q: 0.5, d: 0.035, r: 0.015, gain: 0.08 }),
    ]),
    def('hk-glove-save', 'Save — glove', 7, [
      tone({ hz: 1250, mod: 1.41, index: 1.6, indexEnd: 0.1, slide: 0.01, to: 980, bend: 0.03, a: 0.0005, d: 0.026, r: 0.01, gain: 0.2 }),
      tone({ hz: 360, mod: 2, index: 0.8, indexEnd: 0, slide: 0.02, to: 280, bend: 0.04, a: 0.0008, d: 0.035, r: 0.015, gain: 0.12 }),
      noise({ hz: 2000, q: 1.2, d: 0.02, r: 0.01, gain: 0.09 }),
    ]),
    def('hk-chest-save', 'Save — chest', 7, puckBody(0.9).map((l) => ({ ...l, gain: l.gain * 1.1 }))),
    // a stick on a stick: bright, metallic and wooden at once (two inharmonic partials and a knock)
    def('hk-stick-hit', 'Stick clash', 5, [
      tone({ hz: 2350, mod: 2.76, index: 2.4, indexEnd: 0.3, slide: 0.012, a: 0.0004, d: 0.03, r: 0.012, gain: 0.12 }),
      tone({ hz: 3450, mod: 1.41, index: 1.2, indexEnd: 0.1, slide: 0.01, a: 0.0004, d: 0.02, r: 0.01, gain: 0.07, delay: 0.004 }),
      tone({ hz: 720, mod: 2, index: 1.2, indexEnd: 0.1, slide: 0.02, to: 640, a: 0.0008, d: 0.035, r: 0.012, gain: 0.1 }),
    ]),
    def('hk-stick-break', 'Stick snap', 7, [
      tone({ hz: 1900, mod: 2.41, index: 3.5, indexEnd: 0.4, slide: 0.02, to: 1300, bend: 0.05, a: 0.0004, d: 0.04, r: 0.015, gain: 0.15, noise: 0.25 }),
      tone({ hz: 640, mod: 2, index: 2, indexEnd: 0.3, slide: 0.03, to: 420, bend: 0.06, a: 0.0006, d: 0.06, r: 0.02, gain: 0.16 }),
      noise({ hz: 2600, q: 1, delay: 0.03, d: 0.04, r: 0.02, gain: 0.07 }),
    ]),
    // the iron: the one sound allowed to ring
    def('hk-post', 'Off the post', 8, [
      tone({ hz: 1180, mod: 2.76, index: 2.4, indexEnd: 0.25, slide: 0.06, a: 0.0004, d: 0.45, r: 0.12, gain: 0.15 }),
      tone({ hz: 1735, mod: 1.41, index: 1.2, indexEnd: 0.1, slide: 0.05, a: 0.0004, d: 0.3, r: 0.1, gain: 0.08 }),
      tone({ hz: 2600, a: 0.0004, d: 0.2, r: 0.08, gain: 0.04 }),
    ], { vary: { pitch: 0.015, gain: 0.08, env: 0.05 } }),
    def('hk-net', 'Into the net', 6, [
      noise({ hz: 900, q: 0.7, to: 500, sweep: 0.15, a: 0.004, d: 0.16, r: 0.06, gain: 0.1 }),
      tone({ hz: 240, mod: 1.41, index: 1, indexEnd: 0, slide: 0.04, to: 170, bend: 0.08, a: 0.002, d: 0.07, r: 0.03, gain: 0.08 }),
    ]),
    def('hk-glass', 'Into the glass', 8, [...check(1, 0.6),
      tone({ hz: 2150, mod: 2.41, index: 2, indexEnd: 0.3, slide: 0.08, a: 0.0006, d: 0.14, r: 0.06, gain: 0.07, delay: 0.006 }),
      noise({ hz: 4200, q: 0.8, to: 2400, sweep: 0.12, d: 0.12, r: 0.05, gain: 0.05, delay: 0.004 })]),
    def('hk-fall', 'Down on the ice', 6, [
      tone({ hz: 190, mod: 2, index: 1.4, indexEnd: 0, slide: 0.03, to: 140, bend: 0.06, a: 0.001, d: 0.045, r: 0.02, gain: 0.1, filter: { type: 'highpass', freq: 90, q: 0 } }),
      ...scrape({ hz: 2200, to: 1300, d: 0.22, pulse: 14, tone: 700, gain: 0.07 }).map((l) => ({ ...l, delay: (l.delay || 0) + 0.06 })),
    ], { retro: GRIT }),
    def('hk-gloves-drop', 'Gloves hit the ice', 4, [
      tone({ hz: 230, mod: 2, index: 1, indexEnd: 0, slide: 0.02, to: 180, a: 0.001, d: 0.04, r: 0.015, gain: 0.12, noise: 0.35, filter: { type: 'lowpass', freq: 1400, q: 0.5 } }),
      tone({ hz: 205, mod: 2, index: 1, indexEnd: 0, slide: 0.02, to: 160, a: 0.001, d: 0.04, r: 0.015, gain: 0.1, noise: 0.35, delay: 0.07, filter: { type: 'lowpass', freq: 1300, q: 0.5 } }),
    ]),
    // the fight: compact, heavier thuds with a little grit
    def('hk-punch', 'Fight — punch', 7, [
      tone({ hz: 175, mod: 2, index: 1.5, indexEnd: 0.1, slide: 0.025, to: 115, bend: 0.05, a: 0.0008, d: 0.04, r: 0.02, gain: 0.12, filter: { type: 'highpass', freq: 70, q: 0 } }),
      tone({ hz: 460, mod: 2, index: 1.8, indexEnd: 0.2, slide: 0.03, to: 360, bend: 0.04, a: 0.0008, d: 0.04, r: 0.015, gain: 0.15 }),
      tone({ hz: 1200, mod: 2.41, index: 2.4, indexEnd: 0.2, slide: 0.01, a: 0.0005, d: 0.022, r: 0.01, gain: 0.12, noise: 0.4 }),
      noise({ type: 'lowpass', hz: 2200, q: 0.5, d: 0.03, r: 0.015, gain: 0.07 }),
    ], { vary: { pitch: 0.06, gain: 0.12, env: 0.12 } }),
    def('hk-punch-miss', 'Fight — whiff', 3, [noise({ hz: 900, q: 1.4, to: 2200, sweep: 0.08, linear: true, a: 0.03, d: 0.06, r: 0.04, gain: 0.07 })], { retro: GRIT }),
    def('hk-punch-big', 'Fight — big impact', 9, [
      tone({ hz: 140, mod: 2, index: 1.8, indexEnd: 0.1, slide: 0.04, to: 85, bend: 0.08, a: 0.0008, d: 0.07, r: 0.03, gain: 0.2, filter: { type: 'highpass', freq: 60, q: 0 } }),
      tone({ hz: 400, mod: 2, index: 2.5, indexEnd: 0.3, slide: 0.03, to: 280, a: 0.0008, d: 0.06, r: 0.025, gain: 0.18 }),
      tone({ hz: 1500, mod: 2.41, index: 3, indexEnd: 0.3, slide: 0.012, a: 0.0004, d: 0.03, r: 0.012, gain: 0.16, noise: 0.35 }),
    ], { vary: { pitch: 0.05, gain: 0.1, env: 0.1 } }),
    // the man taking it: a short voiced grunt, two vowel bands falling, the big one with a
    // breath after it
    def('hk-fight-grunt', 'Fight — grunt', 3, [
      noise({ hz: 340, q: 5, to: 230, sweep: 0.09, linear: true, a: 0.006, d: 0.07, s: 0.2, r: 0.05, gain: 0.3 }),
      noise({ hz: 1150, q: 6, to: 850, sweep: 0.09, linear: true, a: 0.006, d: 0.06, s: 0.15, r: 0.04, gain: 0.16 }),
    ], { retro: GRIT, vary: { pitch: 0.12, gain: 0.15, env: 0.2 } }),
    def('hk-fight-grunt-big', 'Fight — grunt, hurt', 4, [
      noise({ hz: 300, q: 5, to: 190, sweep: 0.14, linear: true, a: 0.005, d: 0.11, s: 0.3, r: 0.08, gain: 0.38 }),
      noise({ hz: 980, q: 6, to: 700, sweep: 0.14, linear: true, a: 0.005, d: 0.1, s: 0.2, r: 0.06, gain: 0.22 }),
      noise({ hz: 2400, q: 1.2, linear: true, a: 0.03, d: 0.12, r: 0.1, gain: 0.06, delay: 0.16 }),
    ], { retro: GRIT, vary: { pitch: 0.1, gain: 0.12, env: 0.2 } }),
    // the building when the gloves come off: a roar with a beat in it, which is the crowd
    // pumping its fists
    def('hk-crowd-fight', 'Crowd — fight', 3, [
      noise({ hz: 700, q: 0.7, linear: true, a: 0.12, d: 0.2, s: 0.9, r: 1.0, gain: 0.2, tremolo: { rate: 2.1, depth: 0.45 } }),
      noise({ hz: 1300, q: 1.0, linear: true, a: 0.15, d: 0.2, s: 0.8, r: 0.9, gain: 0.12, tremolo: { rate: 2.1, depth: 0.5 } }),
      noise({ hz: 380, q: 0.7, linear: true, a: 0.1, d: 0.25, s: 0.9, r: 1.1, gain: 0.16, tremolo: { rate: 4.3, depth: 0.2 } }),
      noise({ hz: 2300, q: 5, linear: true, a: 0.1, d: 0.3, s: 0.6, r: 0.5, gain: 0.04, tremolo: { rate: 9.7, depth: 0.5 } }),
    ], { hold: 2.2, retro: CART, category: 'ambient', vary: { pitch: 0.04, gain: 0.08, env: 0.1 } }),
    def('hk-grapple', 'Fight — jersey grab', 3, [
      noise({ hz: 700, q: 0.6, to: 1500, sweep: 0.15, linear: true, a: 0.04, d: 0.1, s: 0.3, r: 0.08, gain: 0.06 }),
    ], { retro: GRIT }),
    def('hk-knockout', 'Fight — knockout', 10, [
      tone({ hz: 135, mod: 2, index: 2, indexEnd: 0.1, slide: 0.05, to: 75, bend: 0.1, a: 0.0008, d: 0.09, r: 0.035, gain: 0.22, filter: { type: 'highpass', freq: 60, q: 0 } }),
      tone({ hz: 1400, mod: 2.41, index: 3.2, indexEnd: 0.3, slide: 0.012, a: 0.0004, d: 0.035, r: 0.012, gain: 0.17, noise: 0.35 }),
      tone({ hz: 420, mod: 2, index: 2.2, indexEnd: 0.3, slide: 0.03, to: 300, a: 0.0008, d: 0.06, r: 0.025, gain: 0.13 }),
      tone({ hz: 170, mod: 2, index: 1, indexEnd: 0, slide: 0.03, to: 120, a: 0.001, d: 0.05, r: 0.02, gain: 0.12, delay: 0.32, filter: { type: 'highpass', freq: 70, q: 0 } }),
      ...gasp().map((l) => ({ ...l, gain: l.gain * 0.8, delay: (l.delay || 0) + 0.12 })),
    ], { vary: { pitch: 0.03, gain: 0.08, env: 0.08 } }),
    // the X-ray replay (gl/arena-xray.js): the room going under as it comes in, a low air
    // sweep with a heartbeat in it, and the bone going, a dry crack with a splinter after it
    def('hk-xray-in', 'X-ray replay — in', 8, [
      noise({ type: 'lowpass', hz: 2400, q: 0.7, to: 260, sweep: 0.5, linear: true, a: 0.04, d: 0.5, s: 0.2, r: 0.4, gain: 0.12 }),
      tone({ hz: 62, mod: 1.41, index: 0.6, indexEnd: 0, slide: 0.05, to: 44, bend: 0.08, a: 0.004, d: 0.12, r: 0.06, gain: 0.32, delay: 0.18 }),
      tone({ hz: 58, mod: 1.41, index: 0.5, indexEnd: 0, slide: 0.05, to: 42, bend: 0.08, a: 0.004, d: 0.1, r: 0.05, gain: 0.24, delay: 0.42 }),
      tone({ hz: 62, mod: 1.41, index: 0.6, indexEnd: 0, slide: 0.05, to: 44, bend: 0.08, a: 0.004, d: 0.12, r: 0.06, gain: 0.26, delay: 1.05 }),
      tone({ hz: 58, mod: 1.41, index: 0.5, indexEnd: 0, slide: 0.05, to: 42, bend: 0.08, a: 0.004, d: 0.1, r: 0.05, gain: 0.2, delay: 1.29 }),
    ], { retro: false, vary: { pitch: 0.02, gain: 0.05, env: 0.05 } }),
    def('hk-bone-crack', 'X-ray replay — bone breaks', 10, [
      noise({ type: 'highpass', hz: 2600, q: 0.6, a: 0.0004, d: 0.018, r: 0.01, gain: 0.3 }),
      tone({ hz: 1900, mod: 2.41, index: 4, indexEnd: 0.2, slide: 0.008, a: 0.0003, d: 0.016, r: 0.008, gain: 0.2, noise: 0.5 }),
      tone({ hz: 210, mod: 2, index: 1.6, indexEnd: 0.1, slide: 0.03, to: 120, bend: 0.06, a: 0.0006, d: 0.08, r: 0.04, gain: 0.22, filter: { type: 'highpass', freq: 60, q: 0 } }),
      noise({ hz: 3400, q: 2.2, to: 1800, sweep: 0.12, a: 0.001, d: 0.05, r: 0.03, gain: 0.12, delay: 0.035 }),
      noise({ hz: 4200, q: 3, a: 0.0005, d: 0.012, r: 0.008, gain: 0.14, delay: 0.09 }),
    ], { retro: false, vary: { pitch: 0.05, gain: 0.08, env: 0.08 } }),
    // and at full gore, the wet half of it
    def('hk-bone-wet', 'X-ray replay — the wet half', 7, [
      noise({ type: 'lowpass', hz: 900, q: 1.2, to: 300, sweep: 0.15, linear: true, a: 0.006, d: 0.16, s: 0.1, r: 0.12, gain: 0.2, delay: 0.04 }),
      noise({ hz: 520, q: 6, to: 260, sweep: 0.2, linear: true, a: 0.01, d: 0.2, r: 0.1, gain: 0.12, delay: 0.1 }),
    ], { retro: false }),
    // the penalty box: a stick rapped on the boards, short and hollow
    def('hk-box-knock', 'Penalty box — stick knock', 4, [
      tone({ hz: 820, mod: 2, index: 1.6, indexEnd: 0.2, slide: 0.02, to: 760, a: 0.0006, d: 0.04, r: 0.015, gain: 0.13 }),
      tone({ hz: 2600, mod: 1.41, index: 1.2, indexEnd: 0.1, slide: 0.006, a: 0.0004, d: 0.01, r: 0.006, gain: 0.06 }),
    ]),
    // the puck off the glass: a brighter knock than the boards, with a short glassy ring
    def('hk-puck-glass', 'Puck off the glass', 5, [
      tone({ hz: 1550, mod: 2.76, index: 2, indexEnd: 0.2, slide: 0.03, a: 0.0005, d: 0.07, r: 0.02, gain: 0.12 }),
      tone({ hz: 3150, mod: 1.41, index: 1, indexEnd: 0.1, slide: 0.02, a: 0.0005, d: 0.045, r: 0.015, gain: 0.07 }),
      tone({ hz: 420, mod: 2, index: 1.2, indexEnd: 0.2, slide: 0.02, to: 380, a: 0.0008, d: 0.03, r: 0.012, gain: 0.1 }),
    ]),
    // the faceoff: the puck dropped on the ice, a sharp click with a tiny body
    def('hk-faceoff-drop', 'Faceoff — puck drop', 5, [
      tone({ hz: 2900, mod: 1.41, index: 1.4, indexEnd: 0.1, slide: 0.006, a: 0.0004, d: 0.012, r: 0.006, gain: 0.13 }),
      tone({ hz: 640, mod: 2, index: 0.5, indexEnd: 0, slide: 0.015, to: 560, a: 0.0008, d: 0.026, r: 0.01, gain: 0.08 }),
    ]),
  ];

  // The crowd's one-shots ride the ambient bus with the bed (the crowd's own volume, which
  // sits lower than the effects by default), so they're lifted a little to sit with it.
  for (const d of BUILTINS) if (d.category === 'ambient') for (const l of d.config.layers) l.gain = +(l.gain * 1.2).toFixed(4);
  const BY_ID = new Map(BUILTINS.map((d) => [d.id, d]));

  // ── variation ────────────────────────────────────────────────────────────────
  // The same event, a different take: a little pitch, level and envelope, inside the
  // patch's own `vary` (an impact moves more than a whistle), and the noise taken from a
  // different place. `intensity` (0–1, default 1) is how hard: quieter and duller below 1.
  // Seeded, so a given seed is the same take on every client and in every test.
  function variant(d, seed, amount, intensity) {
    if (!d) return null;
    const k = amount ?? 1, r = rngFrom(seed ?? 1), v = d.vary || IMPACT;
    const inten = intensity == null ? 1 : Math.max(0, Math.min(1, intensity));
    const jit = (s) => 1 + (r() * 2 - 1) * s * k;
    // one pitch factor for the whole cue, so its partials keep their ratios
    const pf = jit(v.pitch), gf = jit(v.gain) * (0.45 + 0.55 * inten), ef = jit(v.env);
    const bright = 0.75 + 0.25 * inten;
    const noiseBase = ((seed ?? 1) * 2654435761) >>> 0;
    const take = { ...d, config: { ...d.config,
      layers: d.config.layers.map((L, n) => {
        const o = { ...L, gain: (L.gain ?? 0.2) * gf };
        if (o.freq) o.freq = L.freq * pf;
        if (L.pitchBend?.to) o.pitchBend = { ...L.pitchBend, to: L.pitchBend.to * pf };
        if (L.fm) {
          o.fm = { ...L.fm };
          if (L.fm.index != null) o.fm.index = L.fm.index * bright;
          if (L.fm.rate) o.fm.rate = L.fm.rate * pf;
        }
        if (L.filter?.freq) o.filter = { ...L.filter, freq: L.filter.freq * pf * bright, ...(L.filter.to ? { to: L.filter.to * pf * bright } : {}) };
        if (L.adsr && ef !== 1) o.adsr = { ...L.adsr, d: L.adsr.d * ef, r: L.adsr.r * ef };
        if (L.noiseMix > 0) o.noiseSeed = (noiseBase + n * 7919) % 100003;
        return o;
      }) } };
    return d.rec ? withRecording(take, d.rec, seed, gf) : take;
  }

  // ── the crowd's recordings ───────────────────────────────────────────────────
  // This file is a classic script, so the page that plays it hands it field-recordings.js
  // (useField; the rink does). A cue with a `rec` then plays one cut of its recording, picked by
  // the take's seed, with its own synthesis under it at REC_UNDER (-9 dB), and the rest of that
  // synthesis as the `alt` stand-in until the recording has loaded: the two copies are the same
  // noise, so they add back to the cue as it was. Without useField (the dev panel, the gates)
  // the synthesis plays alone.
  let field = null;
  const REC_UNDER = 0.35;
  function useField(api) { field = api && api.fieldCall ? api : null; }
  function withRecording(take, rec, seed, gf) {
    const call = field && field.fieldCall(rec.key, seed ?? 0, rec.lufs);
    if (!call) return take;
    const layers = take.config.layers;
    return { ...take, config: { ...take.config, layers: [
      { ...call, gain: +(call.gain * gf).toFixed(4) },
      ...layers.map((l) => ({ ...l, gain: l.gain * REC_UNDER })),
      ...layers.map((l) => ({ ...l, gain: l.gain * (1 - REC_UNDER), alt: true })),
    ] } };
  }

  let _n = 0;
  const nextSeed = () => (_n = (_n * 1664525 + 1013904223) >>> 0);
  function get(id, seed) { const d = BY_ID.get(id); return seed == null ? d : variant(d, seed); }
  // Fire and forget: play(id, { seed, intensity, gain, pan }), or the older play(id, seed,
  // amount). With no seed it still varies: repeated hits must not be identical.
  function play(id, a, b) {
    const d = BY_ID.get(id); if (!d) return null;
    const AE = global.AudioEngine; if (!AE?.playSfx) return null;
    const o = a && typeof a === 'object' ? a : { seed: a, amount: b };
    const take = variant(d, o.seed == null ? nextSeed() : o.seed, o.amount, o.intensity);
    return AE.playSfx(take, o.gain ?? 1, o.pan ? { pan: o.pan } : {});
  }

  // ── the rink's events ────────────────────────────────────────────────────────
  // The rink (client/game/js/panels/gameday-rink.js) names what happened; this says what it
  // sounds like and how hard: a patch id, or a function of the event's data giving
  // [id, intensity]. `null` is a deliberate silence (a wide shot is heard when it hits the
  // boards, not when it's struck wide). Every id must be a patch above: the hockey smoke
  // (scripts/audio/hockey-smoke.mjs) checks.
  const puckBoards = (o) => { const v = +o.speed || 0; return v > 60 ? ['hk-boards-hard', 1] : v > 32 ? ['hk-boards', 0.9] : ['hk-boards-soft', 0.75]; };
  const EVENTS = {
    receive: ['hk-puck-stick', 0.9],
    pass: ['hk-pass', 0.9],
    tick: ['hk-puck-tick', 0.45],
    sweep: ['hk-puck-stick-light', 0.9],
    stick: 'hk-stick-hit', poke: 'hk-stick-hit',
    shot: (o) => (o.soft ? ['hk-pass', 0.85] : o.type === 'slap' || o.type === 'onetimer' ? ['hk-puck-slap', 1]
      : o.type === 'tip' ? ['hk-puck-stick-hard', 0.9] : ['hk-shot-wrist', 0.95]),
    boards: (o) => (o.puck ? puckBoards(o) : ['hk-boards-hard', Math.min(1, 0.55 + (+o.speed || 15) / 50)]),
    glass: (o) => (o.puck ? ['hk-puck-glass', 0.9] : ['hk-glass', 1]),
    shatter: 'hk-glass',
    block: 'hk-puck-body', chest: 'hk-chest-save', pad: 'hk-pad-save', glove: 'hk-glove-save',
    post: 'hk-post', net: 'hk-net', wide: null,
    drop: 'hk-faceoff-drop',
    whistle: (o) => [o.long ? 'hk-whistle' : 'hk-whistle-short', 1],
    horn: (o) => [o.short ? 'hk-goal-horn-short' : o.long ? 'hk-goal-horn-long' : 'hk-goal-horn', 1],
    periodHorn: 'hk-period-horn',
    signal: 'hk-signal', alert: 'hk-signal-two', box: 'hk-box-knock',
    stop: ['hk-skate-stop', 0.65], turn: ['hk-skate-turn', 0.7], scrape: ['hk-skate-scrape', 0.7],
    check: (o) => (o.soft ? ['hk-check-light', 0.8] : o.style === 'glass' ? ['hk-glass', 1] : o.style === 'behind' ? ['hk-check-boards', 1] : ['hk-check', 1]),
    fall: 'hk-fall', sever: 'hk-punch-big',
    punch: (o) => (o.big ? ['hk-punch-big', 1] : ['hk-punch', 0.9]),
    punchMiss: 'hk-punch-miss', gloves: 'hk-gloves-drop', cloth: 'hk-grapple',
    knockout: 'hk-knockout', fightGrunt: (o) => (o.big ? ['hk-fight-grunt-big', 1] : ['hk-fight-grunt', 0.8]), fightRoar: 'hk-crowd-fight',
    xrayIn: 'hk-xray-in', boneCrack: 'hk-bone-crack', boneWet: 'hk-bone-wet',
    // (the crowd's own: gameday-rink.js turns these into a cheer and a boo)
    fightTurtle: null, fightDraw: null,
    roar: 'hk-crowd-roar', gasp: 'hk-crowd-gasp', groan: 'hk-crowd-groan', cheer: 'hk-crowd-cheer', boo: 'hk-crowd-boo',
  };
  // { id, intensity } for an event, or null when it has no sound
  function eventFor(key, o = {}) {
    const e = EVENTS[key];
    if (e == null) return null;
    const r = typeof e === 'function' ? e(o) : e;
    if (!r) return null;
    return Array.isArray(r) ? { id: r[0], intensity: r[1] ?? 1 } : { id: r, intensity: 1 };
  }

  // ═══ J. THE CROWD BED ════════════════════════════════════════════════════════
  // A persistent crowd, built once and steered, never retriggered: BED_BANDS (fitted to an NHL
  // arena between plays, in K above) as three groups, the rumble (under 450 Hz), the voices (to
  // 1.8 kHz) and the air over them. Each group's level wanders on a smoothed random signal at
  // the rate and depth the recording's does (BED_WANDER), so it breathes unevenly and never
  // repeats. All of it under a 2.4 kHz shade, onto the ambient bus (the crowd's own volume,
  // apart from the effects).
  //
  // The wander is the engine's white noise played back so slowly that it steps `rate` times a
  // second, through a lowpass at that rate: a random signal that's only nodes, so it runs for a
  // whole game with nothing to schedule. The bands take the same white noise, tilted to the
  // pink they were fitted on (pink's level against white's at f is about √(3085 / f)).
  //
  // setState() eases every group to that state's levels (a state change is a few hundred ms,
  // fast enough that the crowd answers a chance, slow enough never to click). gasp(), cheer(),
  // celebrate() and duck() move the bed around a moment and let it settle back. Everything is
  // AudioParam automation on the same nodes, so it can't pile up.
  //
  // `opts`: { ctx, dest, noise } (from AudioEngine.engineNodes() by default), `seed`.
  const CROWD_STATES = {
    // rumble, air, voices: each group's level against the run of play (`active`, as fitted is
    // 0.32, 0.07 and 0.35); pulse: how far it wanders, against the same; bright: the air ×
    quiet:   { rumble: 0.22, air: 0.045, voices: 0.25, pulse: 0.18, bright: 0.85 },
    active:  { rumble: 0.32, air: 0.07,  voices: 0.35, pulse: 0.25, bright: 1 },
    chance:  { rumble: 0.4,  air: 0.1,   voices: 0.45, pulse: 0.3,  bright: 1.1 },
    shot:    { rumble: 0.48, air: 0.13,  voices: 0.55, pulse: 0.32, bright: 1.15 },
    goal:    { rumble: 0.7,  air: 0.2,   voices: 0.8,  pulse: 0.38, bright: 1.25 },
    penalty: { rumble: 0.38, air: 0.07,  voices: 0.6,  pulse: 0.45, bright: 0.85 },
    // a fight: up near a goal and pulsing, the whole building on its feet
    fight:   { rumble: 0.62, air: 0.17,  voices: 0.78, pulse: 0.5,  bright: 1.2 },
  };
  const BED_LEVEL = 0.771;   // the whole bed: the run of play as loud as the bed before the fit
  // The arena's own recording (crowd_arena) loops beside the bands once it has loaded, on a
  // useField page: through a lowpass like the shade, at REC_TOP's share of its level for each
  // state, and the bands drop to REC_UNDER under it. Until it loads, if it's ever lost (a stolen
  // voice), and in the gates, the bands carry the bed alone. Its loudness, -14.5 LUFS at the top,
  // puts the run of play where the bed was.
  const REC_ID = 'hk-crowd-rec', REC_LUFS = -14.5;
  const REC_TOP = (CROWD_STATES.goal.voices / CROWD_STATES.active.voices) * 1.5;   // a goal, cheered
  function crowdBed(opts = {}) {
    const AE = global.AudioEngine;
    const eng = opts.ctx ? opts : (AE?.engineNodes ? AE.engineNodes() : null);
    if (!eng || !eng.ctx) return null;
    const c = eng.ctx, nbuf = eng.noise || null, t0 = c.currentTime;
    const out = c.createGain(); out.gain.value = 0;
    const duck = c.createGain(); duck.gain.value = 1;
    // Dark, under everything: the whole bed through a lowpass, so it sits beneath the clicks
    // and the whistle rather than in their band, and no grit (a sampled hiss under every
    // second of a game is noise you hear, not texture). It's background: as loud as the
    // effects, it buried them.
    const shade = c.createBiquadFilter(); shade.type = 'lowpass'; shade.frequency.value = 2400; shade.Q.value = 0;
    out.connect(shade).connect(duck);
    duck.connect(opts.dest || eng.bus || c.destination);
    const nodes = [];
    const src = (offset, rate) => {
      const s = c.createBufferSource();
      if (nbuf) s.buffer = nbuf;
      s.loop = true; s.playbackRate.value = rate;
      s.start(t0, offset); nodes.push(s);
      return s;
    };
    const filter = (type, hz, q) => { const f = c.createBiquadFilter(); f.type = type; f.frequency.value = hz; f.Q.value = q; return f; };
    // one source and one level per group; each band a doubled bandpass into its group
    const groups = [[0.13, 0.93], [0.71, 1.07], [1.29, 1.0]].map(([offset, rate], k) => {
      const g = c.createGain(); g.gain.value = 0; g.connect(out);
      const n = src(offset, rate);
      for (const [hz, gain] of BED_BANDS) {
        if (crowdGroup(hz) !== k) continue;
        const lvl = c.createGain(); lvl.gain.value = gain * Math.sqrt(3085 / hz) * BED_LEVEL;
        n.connect(filter('bandpass', hz, 1.2)).connect(filter('bandpass', hz, 1.2)).connect(lvl).connect(g);
      }
      // the wander: white noise stepping `rate` times a second, smoothed, onto the group's level
      const [steps] = BED_WANDER[k];
      const w = src(0.37 + k * 0.41, steps / (nbuf?.sampleRate || c.sampleRate));
      const depth = c.createGain(); depth.gain.value = 0;
      w.connect(filter('lowpass', steps, 0.5)).connect(depth).connect(g.gain);
      return { g, depth };
    });
    let state = 'quiet', rec = false, stopped = false;
    const lv = () => CROWD_STATES[state] || CROWD_STATES.quiet;
    const A = CROWD_STATES.active;
    const recOn = () => rec && !!AE?.isLooping?.(REC_ID);
    // every group to the state's levels, eased with time constant `tc`
    function apply(at, tc, lift = 1) {
      const s = lv();
      const set = (p, v) => { p.cancelScheduledValues(at); p.setTargetAtTime(v, at, tc); };
      const level = [s.rumble / A.rumble, s.voices / A.voices, (s.air / A.air) * s.bright];
      const under = recOn() ? REC_UNDER : 1;
      groups.forEach(({ g, depth }, k) => {
        set(g.gain, level[k] * lift * under);
        // never past 0.9 of the level, or the wander would swing it through silence
        set(depth.gain, level[k] * lift * under * Math.min(0.9, BED_WANDER[k][1] * (s.pulse / A.pulse)));
      });
      if (recOn()) {
        // the loop's gain moves now, so a later moment waits for its time
        const go = () => { if (!stopped) AE.setLoopGain(REC_ID, Math.min(1, (level[1] * lift) / REC_TOP), tc * 3); };
        const wait = at - c.currentTime;
        if (wait > 0.02) setTimeout(go, wait * 1000); else go();
      }
    }
    // the recording, fetched once and looped from then on (never offline: opts.ctx)
    function startRecording() {
      const layer = !opts.ctx && field && AE?.loopSound && AE.preloadSamples
        ? field.fieldBed('crowd_arena', REC_LUFS, { filter: { type: 'lowpass', freq: 2400, q: 0.5 } }) : null;
      if (!layer) return;
      const calls = ['crowd_goal', 'crowd_cheer', 'crowd_boo'].map((k) => field.fieldCall(k)?.sample).filter(Boolean);
      AE.preloadSamples([layer.sample, ...calls]).then(() => {
        if (stopped || !AE.sampleReady?.(layer.sample)) return;
        AE.loopSound({ id: REC_ID, name: REC_ID, category: 'ambient', priority: 9, config: { layers: [layer] } }, { whole: true, gain: 0 });
        rec = true;
        apply(c.currentTime, 0.8);
      });
    }
    const now = (at) => (at != null ? at : c.currentTime);
    const api = {
      // the bed fades up over a second; nothing before that
      start(at) { const t = now(at); out.gain.cancelScheduledValues(t); out.gain.setValueAtTime(out.gain.value, t); out.gain.setTargetAtTime(1, t, 0.35); apply(t, 0.3); startRecording(); return api; },
      setState(name, at) { if (!CROWD_STATES[name]) return api; state = name; apply(now(at), name === 'quiet' ? 0.6 : 0.18); return api; },
      get state() { return state; },
      // a gasp: the bed held back an instant, then a quick bright rise that settles
      gasp(at) {
        const t = now(at);
        apply(t, 0.03, 0.55); apply(t + 0.12, 0.25, 1);
        if (!opts.ctx && AE?.playSfx) play('hk-crowd-gasp', { seed: (t * 1000) | 0 });
        return api;
      },
      // a cheer: the bed lifts with a denser middle and comes back down to the state
      cheer(at, big) {
        const t = now(at), hold = big ? 2.2 : 0.8;
        apply(t, big ? 0.12 : 0.15, big ? 1.5 : 1.3); apply(t + hold, 0.6, 1);
        if (!opts.ctx && AE?.playSfx) play(big ? 'hk-crowd-goal' : 'hk-crowd-cheer', { seed: (t * 1000) | 0 });
        return api;
      },
      celebrate(at) { return api.cheer(at, true); },
      // under a horn or a whistle: down by `db` for `secs`, and back
      duck(db = 4, secs = 0.6, at) {
        const t = now(at), g = Math.pow(10, -db / 20);
        duck.gain.cancelScheduledValues(t); duck.gain.setTargetAtTime(g, t, 0.03); duck.gain.setTargetAtTime(1, t + secs, 0.2);
        if (recOn()) AE.duckLoop(REC_ID, g, secs);
        return api;
      },
      // fades out and lets the nodes go
      stop(at) {
        const t = now(at);
        out.gain.cancelScheduledValues(t); out.gain.setTargetAtTime(0, t, 0.25);
        for (const n of nodes) { try { n.stop(t + 1.6); } catch { /* already stopped */ } }
        stopped = true;
        if (rec) AE?.stopLoop?.(REC_ID);
        return api;
      },
      // what's playing, for a check that nothing piles up
      _nodes: () => nodes.length,
    };
    return api;
  }

  // Global-only, matching audio-engine.js and sfx-catalog.js. The repo is
  // "type": "module", so a CJS `module.exports` branch here would be dead code.
  global.HockeySfx = { BUILTINS, get, play, variant, useField, tone, noise, crowdBed, CROWD_STATES, EVENTS, eventFor, ids: () => [...BY_ID.keys()] };

})(typeof globalThis !== 'undefined' ? globalThis : window);
