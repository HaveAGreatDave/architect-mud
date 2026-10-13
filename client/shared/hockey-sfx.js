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
  const ICE = { rate: 12500, bits: 9 };
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
    return { id, name, group: 'hockey', category: o.category || 'sfx', priority, vary: o.vary || IMPACT, config };
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
  // the crunch. The transient leads: it reads as contact before it reads as weight.
  const check = (k, heavy) => [
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
  // The signature: loud, blunt, sustained. One deep pitch with its 2nd, 3rd and 4th partials
  // on their own gains and envelopes; FM on the fundamental for a rough brassy edge, opened
  // at the onset and settling (the blat), a slow beat from two partials a hair apart, a little
  // drive, and a lowpass so it's a horn and not a synth. No reverb tail, no crowd: the cheer
  // is its own event, so the game decides when and how loud.
  const HORN = 208;
  const horn = () => [
    tone({ hz: HORN, mod: 2, index: 1.6, indexEnd: 0.8, slide: 0.12, linear: true, a: 0.02, d: 0.12, s: 0.9, r: 0.22, gain: 0.12, drive: 0.1,
      filter: { type: 'lowpass', freq: 2400, q: 0.5 } }),
    tone({ hz: HORN * 2 + 0.6, mod: 2, index: 0.9, indexEnd: 0.45, slide: 0.15, linear: true, a: 0.026, d: 0.15, s: 0.85, r: 0.2, gain: 0.13 }),
    tone({ hz: HORN * 3 - 0.5, linear: true, a: 0.03, d: 0.18, s: 0.8, r: 0.2, gain: 0.08 }),
    tone({ hz: HORN * 4 + 0.9, linear: true, a: 0.034, d: 0.2, s: 0.7, r: 0.18, gain: 0.05 }),
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
  // Procedural textures, not samples: bands of noise and a vowel-ish resonant band. The bed
  // under them is crowdBed() below, and its gasp() and cheer() dip or lift the bed around
  // these, so the reaction comes out of the crowd rather than over it.
  const gasp = () => [
    noise({ hz: 1100, q: 0.9, to: 1700, sweep: 0.12, linear: true, a: 0.045, d: 0.12, s: 0.35, r: 0.22, gain: 0.16 }),
    noise({ hz: 620, q: 4.5, to: 860, sweep: 0.15, linear: true, a: 0.06, d: 0.14, s: 0.3, r: 0.2, gain: 0.12 }),
    noise({ hz: 2000, q: 1.4, linear: true, a: 0.03, d: 0.08, s: 0.2, r: 0.15, gain: 0.03 }),
  ];
  const cheer = (big) => [
    noise({ hz: 760, q: 0.7, linear: true, a: big ? 0.25 : 0.14, d: 0.2, s: 0.85, r: big ? 0.9 : 0.45, gain: big ? 0.2 : 0.15, tremolo: { rate: 5.3, depth: 0.3 } }),
    noise({ hz: 1350, q: 1.0, linear: true, a: big ? 0.3 : 0.18, d: 0.2, s: 0.75, r: big ? 0.8 : 0.4, gain: big ? 0.12 : 0.09, tremolo: { rate: 7.9, depth: 0.35 } }),
    noise({ hz: 420, q: 0.7, linear: true, a: big ? 0.2 : 0.12, d: 0.25, s: 0.9, r: big ? 1.0 : 0.5, gain: big ? 0.16 : 0.1, tremolo: { rate: 3.1, depth: 0.2 } }),
    noise({ hz: 2100, q: 5, linear: true, a: 0.2, d: 0.3, s: 0.6, r: 0.4, gain: big ? 0.04 : 0.025, tremolo: { rate: 11.3, depth: 0.5 } }),
  ];

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
    def('hk-skate-scrape', 'Skate — scrape', 2, scrape({ hz: 2100, d: 0.07, pulse: 16, tone: 900, gain: 0.09 }), { retro: ICE }),
    def('hk-skate-turn', 'Skate — hard turn', 3, scrape({ hz: 1800, to: 2500, d: 0.14, pulse: 12, tone: 760, gain: 0.1, r: 0.05 }), { retro: ICE }),
    def('hk-skate-stop', 'Skate — braking', 4, scrape({ hz: 2900, to: 1300, a: 0.008, d: 0.17, s: 0.1, pulse: 21, tone: 1250, gain: 0.13, r: 0.045 }), { retro: ICE }),
    // F — the referee's whistle: a short blast, and a held one
    def('hk-whistle-short', 'Whistle — short', 9, whistle(), { hold: 0.12, retro: false, vary: STEADY }),
    def('hk-whistle', 'Whistle — held', 9, whistle(), { hold: 0.36, retro: false, vary: STEADY }),
    // G — gameplay signals: one note, and two
    def('hk-signal', 'Signal — alert', 6, [beep(1046.5, 2, 0, 0.09)], { hold: 0.06, retro: CHIP, vary: STEADY }),
    def('hk-signal-two', 'Signal — two-part', 6, [beep(880, 0, 0, 0.06), beep(1174.7, 2, 0.11, 0.08)], { hold: 0.05, retro: CHIP, vary: STEADY }),
    // H — the goal horn: short, and long (one sustained blast, not repeats)
    def('hk-goal-horn-short', 'Goal horn — short', 10, horn(), { hold: 0.7, vary: STEADY }),
    def('hk-goal-horn', 'Goal horn', 10, horn(), { hold: 1.6, vary: STEADY }),
    // I — the end of a period
    def('hk-period-horn', 'Period end', 10, buzzer(), { hold: 1.3, vary: STEADY }),
    // K — the crowd's one-shots (the bed is crowdBed())
    def('hk-crowd-gasp', 'Crowd — gasp', 2, gasp(), { hold: 0.05, retro: CART, category: 'ambient', vary: { pitch: 0.05, gain: 0.1, env: 0.15 } }),
    def('hk-crowd-cheer', 'Crowd — cheer', 2, cheer(false), { hold: 0.5, retro: CART, category: 'ambient', vary: { pitch: 0.05, gain: 0.1, env: 0.15 } }),
    def('hk-crowd-goal', 'Crowd — goal celebration', 3, cheer(true), { hold: 1.9, retro: CART, category: 'ambient', vary: { pitch: 0.04, gain: 0.08, env: 0.1 } }),
    def('hk-crowd-roar', 'Crowd — roar', 3, cheer(true), { hold: 1.2, retro: CART, category: 'ambient', vary: { pitch: 0.04, gain: 0.08, env: 0.1 } }),
    def('hk-crowd-groan', 'Crowd — groan', 2, [
      noise({ hz: 520, q: 0.9, to: 340, sweep: 0.5, linear: true, a: 0.12, d: 0.3, s: 0.6, r: 0.5, gain: 0.16 }),
      noise({ hz: 300, q: 3.5, to: 220, sweep: 0.6, linear: true, a: 0.15, d: 0.3, s: 0.5, r: 0.5, gain: 0.08 }),
    ], { hold: 0.5, retro: GRIT, category: 'ambient', vary: { pitch: 0.05, gain: 0.1, env: 0.15 } }),
    def('hk-crowd-boo', 'Crowd — boo', 2, [
      noise({ hz: 380, q: 2.2, linear: true, a: 0.2, d: 0.3, s: 0.8, r: 0.6, gain: 0.14, tremolo: { rate: 3.7, depth: 0.25 } }),
      noise({ hz: 760, q: 3, linear: true, a: 0.25, d: 0.3, s: 0.6, r: 0.5, gain: 0.06 }),
      noise({ hz: 220, q: 0.8, linear: true, a: 0.2, d: 0.3, s: 0.8, r: 0.6, gain: 0.1 }),
    ], { hold: 1.1, retro: GRIT, category: 'ambient', vary: { pitch: 0.05, gain: 0.1, env: 0.15 } }),
    // a bed for pages that have no crowdBed() (the fighter sandbox loops this)
    def('hk-crowd-bed', 'Crowd — arena bed', 1, [
      noise({ hz: 400, q: 0.7, linear: true, a: 0.6, d: 0.4, s: 0.9, r: 0.8, gain: 0.1, rate: 0.9, tremolo: { rate: 0.37, depth: 0.25 } }),
      noise({ hz: 1400, q: 0.8, linear: true, a: 0.8, d: 0.4, s: 0.8, r: 0.8, gain: 0.04, rate: 1.07, tremolo: { rate: 0.83, depth: 0.3 } }),
    ], { hold: 3.4, retro: GRIT, category: 'ambient', vary: { pitch: 0.03, gain: 0.08, env: 0.1 } }),

    // ── secondary ────────────────────────────────────────────────────────────
    // a shot: a sharp crack off the blade with a small fall in pitch; a slapper has the
    // wind-up's weight under it
    def('hk-puck-slap', 'Shot — slapshot', 6, [
      tone({ hz: 2100, mod: 1.41, index: 2.8, indexEnd: 0.2, slide: 0.012, to: 1500, bend: 0.04, a: 0.0005, d: 0.034, r: 0.012, gain: 0.26 }),
      tone({ hz: 380, mod: 2, index: 1.6, indexEnd: 0.2, slide: 0.03, to: 260, bend: 0.05, a: 0.0008, d: 0.045, r: 0.02, gain: 0.11 }),
      noise({ hz: 2800, q: 0.9, to: 1600, sweep: 0.03, d: 0.024, r: 0.012, gain: 0.1 }),
    ]),
    def('hk-shot-wrist', 'Shot — wrist', 5, [
      tone({ hz: 2500, mod: 1.41, index: 2, indexEnd: 0.15, slide: 0.01, to: 1950, bend: 0.035, a: 0.0005, d: 0.026, r: 0.01, gain: 0.2 }),
      tone({ hz: 470, mod: 2, index: 0.8, indexEnd: 0, slide: 0.02, to: 360, bend: 0.04, a: 0.0008, d: 0.03, r: 0.015, gain: 0.08 }),
      noise({ hz: 3300, q: 0.9, to: 2000, sweep: 0.025, d: 0.014, r: 0.01, gain: 0.06 }),
    ]),
    // a pass: lighter and quicker than any shot
    def('hk-pass', 'Pass', 3, stick(1.05, 0).map((l) => ({ ...l, gain: l.gain * 0.75 }))),
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
  // sits lower than the effects by default), so they're authored about as loud as the bed.
  for (const d of BUILTINS) if (d.category === 'ambient') for (const l of d.config.layers) l.gain = +(l.gain * 3).toFixed(4);
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
    return { ...d, config: { ...d.config,
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
    tick: ['hk-puck-tick', 0.6],
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
    horn: (o) => [o.short ? 'hk-goal-horn-short' : 'hk-goal-horn', 1],
    periodHorn: 'hk-period-horn',
    signal: 'hk-signal', alert: 'hk-signal-two', box: 'hk-box-knock',
    stop: ['hk-skate-stop', 0.8], turn: ['hk-skate-turn', 0.8], scrape: ['hk-skate-scrape', 0.8],
    check: (o) => (o.soft ? ['hk-check-light', 0.8] : o.style === 'glass' ? ['hk-glass', 1] : o.style === 'behind' ? ['hk-check-boards', 1] : ['hk-check', 1]),
    fall: 'hk-fall', sever: 'hk-punch-big',
    punch: (o) => (o.big ? ['hk-punch-big', 1] : ['hk-punch', 0.9]),
    punchMiss: 'hk-punch-miss', gloves: 'hk-gloves-drop', cloth: 'hk-grapple',
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
  // A coarse, low-detail, persistent crowd, built once and steered, never retriggered: a
  // low-mid rumble (150–700 Hz), a brighter airy band (700–3,000 Hz), and three quiet
  // resonant bands where distant voices sit, each pulsed slowly by LFOs at rates that never
  // line up, so it breathes unevenly. All of it through one coarse sample-and-hold, onto the
  // ambient bus (the crowd's own volume, apart from the effects).
  //
  // setState() eases every band to that state's levels (a state change is a few hundred ms,
  // fast enough that the crowd answers a chance, slow enough never to click). gasp(), cheer(),
  // celebrate() and duck() move the bed around a moment and let it settle back. Everything is
  // AudioParam automation on the same nodes, so it can't pile up.
  //
  // `opts`: { ctx, dest, noise } (from AudioEngine.engineNodes() by default), `seed`.
  const CROWD_STATES = {
    // rumble, air, voices (gain), pulse (LFO depth), bright (air band centre ×)
    quiet:   { rumble: 0.5,  air: 0.12, voices: 0.6,  pulse: 0.18, bright: 0.85 },
    active:  { rumble: 0.8,  air: 0.24, voices: 1.0,  pulse: 0.25, bright: 1 },
    chance:  { rumble: 1.1,  air: 0.45, voices: 1.5,  pulse: 0.3,  bright: 1.15 },
    shot:    { rumble: 1.3,  air: 0.55, voices: 1.8,  pulse: 0.32, bright: 1.2 },
    goal:    { rumble: 1.5,  air: 0.7,  voices: 2.2,  pulse: 0.38, bright: 1.3 },
    penalty: { rumble: 1.0,  air: 0.24, voices: 2.0,  pulse: 0.45, bright: 0.8 },
  };
  function crowdBed(opts = {}) {
    const AE = global.AudioEngine;
    const eng = opts.ctx ? opts : (AE?.engineNodes ? AE.engineNodes() : null);
    if (!eng || !eng.ctx) return null;
    const c = eng.ctx, nbuf = eng.noise || null, t0 = c.currentTime;
    const out = c.createGain(); out.gain.value = 0;
    const duck = c.createGain(); duck.gain.value = 1;
    out.connect(duck);
    const dest = opts.dest || eng.bus || c.destination;
    // (the cartridge grit, when the engine has its retro stage; otherwise straight on)
    const into = AE?.retroInsert ? AE.retroInsert(c, { rate: 13000, bits: 9, ref: 1.5 }, dest) : dest;
    duck.connect(into);
    const nodes = [];
    const src = (offset, rate) => {
      const s = c.createBufferSource();
      if (nbuf) s.buffer = nbuf;
      s.loop = true; s.playbackRate.value = rate;
      s.start(t0, offset); nodes.push(s);
      return s;
    };
    const band = (source, type, hz, q, level) => {
      const f = c.createBiquadFilter(); f.type = type; f.frequency.value = hz; f.Q.value = q;
      const g = c.createGain(); g.gain.value = level;
      source.connect(f).connect(g).connect(out);
      return { f, g };
    };
    const lfo = (hz, depth, target) => {
      const o = c.createOscillator(); o.frequency.value = hz;
      const g = c.createGain(); g.gain.value = depth;
      o.connect(g).connect(target); o.start(t0); nodes.push(o);
      return g;
    };
    const n1 = src(0.13, 0.93), n2 = src(0.71, 1.07), n3 = src(1.29, 1.0);
    // the rumble: a lowpass over a highpass, so there's no sub-bass mud under it
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 150; hp.Q.value = 0;
    n1.connect(hp);
    const rumble = band(hp, 'lowpass', 700, 0, 0);
    const air = band(n2, 'bandpass', 1150, 0.6, 0);
    const voices = [[520, 7], [930, 8], [1650, 9]].map(([hz, q]) => band(n3, 'bandpass', hz, q, 0));
    // the breathing: two or three slow LFOs per band, at rates that never line up
    const pulses = [
      lfo(0.37, 0, rumble.g.gain), lfo(1.13, 0, rumble.g.gain),
      lfo(0.61, 0, air.g.gain), lfo(2.3, 0, air.g.gain),
      ...voices.map((v, k) => lfo(0.29 + k * 0.53, 0, v.g.gain)),
    ];
    let state = 'quiet';
    const lv = () => CROWD_STATES[state] || CROWD_STATES.quiet;
    // every band to the state's levels, eased with time constant `tc`
    function apply(at, tc, lift = 1) {
      const s = lv();
      const set = (p, v) => { p.cancelScheduledValues(at); p.setTargetAtTime(v, at, tc); };
      set(rumble.g.gain, s.rumble * lift);
      set(air.g.gain, s.air * lift);
      voices.forEach((v) => set(v.g.gain, s.voices * lift));
      set(air.f.frequency, 1150 * s.bright);
      pulses.forEach((p, k) => set(p.gain, (k < 2 ? s.rumble : k < 4 ? s.air : s.voices) * s.pulse * lift));
    }
    const now = (at) => (at != null ? at : c.currentTime);
    const api = {
      // the bed fades up over a second; nothing before that
      start(at) { const t = now(at); out.gain.cancelScheduledValues(t); out.gain.setValueAtTime(out.gain.value, t); out.gain.setTargetAtTime(1, t, 0.35); apply(t, 0.3); return api; },
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
        return api;
      },
      // fades out and lets the nodes go
      stop(at) {
        const t = now(at);
        out.gain.cancelScheduledValues(t); out.gain.setTargetAtTime(0, t, 0.25);
        for (const n of nodes) { try { n.stop(t + 1.6); } catch { /* already stopped */ } }
        return api;
      },
      // what's playing, for a check that nothing piles up
      _nodes: () => nodes.length,
    };
    return api;
  }

  // Global-only, matching audio-engine.js and sfx-catalog.js. The repo is
  // "type": "module", so a CJS `module.exports` branch here would be dead code.
  global.HockeySfx = { BUILTINS, get, play, variant, tone, noise, crowdBed, CROWD_STATES, EVENTS, eventFor, ids: () => [...BY_ID.keys()] };

})(typeof globalThis !== 'undefined' ? globalThis : window);
