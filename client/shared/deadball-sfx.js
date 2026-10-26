// THE DEADBALL SOUND BANK: KSAB's ballpark, as data in SIREN's layer schema
// (client/shared/audio-engine.js buildLayer). docs/systems-deadball-sound.md names every patch,
// the mix and how to tune them.
//
// Both Gameday views play it. The 2-D view (client/game/js/panels/gameday.js) plays the nine
// cues in DEADBALL_SFX by name; the 3-D view (gameday-grandstand.js) plays all of it through its
// mixer, client/game/js/panels/diamond/sound.js, which hears the park's world and picks from
// EVENTS here.
//
// It holds no synthesizer. A patch is the catalog's own shape ({ id, name, group, category,
// priority, vary, config }), the shape hockey-sfx.js uses, so sfx-catalog.js folds it in (this
// module registers itself with SFXCatalog.addBank when it loads) and the dev panel's Audio tab
// lists, plays and overrides every one. The crowd and the park's air are the two live parts:
// crowdBed() and parkBed() below build them on the TV bus through AudioEngine.engineNodes(). The
// words the voices say and the voices themselves (VOICES, CALLS) are here too: they're the
// game's, not the engine's.
//
// Every patch sits on 'tv_fx', the TV bus's effects side, so the player's TV slider sets all of
// it. Where hockey's patches are a cartridge's, these are cleaner: stereo noise in three colours,
// a short slap-back off the stands baked into the park's own sounds (the room the viewer sits in
// adds its own reverb), and no retro stage.

// ── seeded rng, so a given event sounds the same on every client ─────────────
function rngFrom(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ── voices ───────────────────────────────────────────────────────────────────
// tone(): one voice, FM if `mod` is given (the modulator as a ratio of the carrier; 2 is hollow
// and woody, 1.41, 1.73, 2.41 and 2.76 inharmonic: a collision or metal. Never 1 or 0.5 on
// anything that lasts: SIREN modulates the frequency, so those put a sideband at 0 Hz). `index`
// falls to `indexEnd` over `slide`; `to` is a pitch it bends to over `bend`. The envelope is
// exponential (a, d where it's 26 dB down, s, r) unless `linear`.
function tone(o) {
  const L = {
    waveform: o.wave || 'sine', freq: o.hz, gain: o.gain ?? 0.2,
    adsr: { a: o.a ?? 0.0006, d: o.d ?? 0.04, s: o.s ?? 0, r: o.r ?? 0.02, ...(o.linear ? {} : { curve: 'exp' }) },
  };
  if (o.mod) {
    L.fm = { ratio: o.mod, index: o.index ?? 1, time: o.slide ?? (o.d ?? 0.04) * 0.5 };
    if (o.indexEnd != null) L.fm.indexEnd = o.indexEnd;
  }
  if (o.to) L.pitchBend = { to: o.to, time: o.bend ?? (o.d ?? 0.04) * 0.7 };
  for (const k of ['filter', 'formants', 'drive', 'delay', 'vibrato', 'tremolo', 'pan']) if (o[k] != null) L[k] = o[k];
  return L;
}
// noise(): a band of noise. `hz` and `q` place it (bandpass unless `type`), `to` sweeps it over
// `sweep`; `colour` is white, pink or brown and `width` how far apart its two ears are.
function noise(o) {
  const L = {
    waveform: 'noise', noiseMix: 1, gain: o.gain ?? 0.08,
    filter: { type: o.type || 'bandpass', freq: o.hz ?? 2000, q: o.q ?? 0.8 },
    adsr: { a: o.a ?? 0.0006, d: o.d ?? 0.02, s: o.s ?? 0, r: o.r ?? 0.015, ...(o.linear ? {} : { curve: 'exp' }) },
  };
  if (o.to) { L.filter.to = o.to; L.filter.time = o.sweep ?? (o.d ?? 0.02); }
  if (o.colour) L.noise = o.colour;
  if (o.formants) { L.formants = o.formants; delete L.filter; }
  for (const k of ['width', 'tremolo', 'delay', 'pan', 'drive']) if (o[k] != null) L[k] = o[k];
  return L;
}
// The stands answer a sharp sound about 120 ms later, darker and quieter: the park's slap-back,
// baked into the patch so the viewer's own room still decides the reverb.
function slap(layers, g = 0.26, ms = 0.12) {
  return [...layers, ...layers.map((l) => ({
    ...l, gain: +(l.gain * g).toFixed(4), delay: +((l.delay || 0) + ms).toFixed(4),
    ...(l.formants ? {} : { filter: l.filter && l.filter.type === 'lowpass' ? { ...l.filter, freq: Math.min(l.filter.freq, 2400) } : { type: 'lowpass', freq: 2400, q: 0.5 } }),
  }))];
}

// A patch. `vary` is how far a take may wander ({ pitch, gain, env } as fractions): a crack or
// a footstep moves more than the organ. Every noise layer gets its own place in the noise.
const IMPACT = { pitch: 0.05, gain: 0.12, env: 0.1 };
const STEP = { pitch: 0.12, gain: 0.3, env: 0.2 };
const STEADY = { pitch: 0.004, gain: 0.03, env: 0 };
function def(id, name, priority, layers, o = {}) {
  layers.forEach((l, k) => { if (l.noiseMix > 0 && l.noiseSeed == null) l.noiseSeed = 211 + k * 53; });
  const reach = Math.max(...layers.map((l) => (l.delay ?? 0) + l.adsr.a + l.adsr.d));
  return { id, name, group: 'deadball', category: 'tv_fx', priority, vary: o.vary || IMPACT,
    config: { duration: o.hold ?? +(reach * 0.25).toFixed(4), layers } };
}

// ═══ CONTACT ═══════════════════════════════════════════════════════════════════
// The barrel: a hard crack (shaped noise over 2 kHz, gone in 5 ms), the wood's body (noise
// through three resonances an ash bat rings at) and a short inharmonic ring (FM at 2.41), with a
// low knock under it. The other contacts are the same bat struck in the wrong place.
const crack = (k = 1) => [
  noise({ type: 'highpass', hz: 5200, q: 0.6, d: 0.0025, r: 0.002, gain: 0.06 * k }),
  noise({ type: 'highpass', hz: 2200, q: 0.7, d: 0.006, r: 0.004, gain: 0.34 * k, width: 0.3 }),
  noise({ formants: [{ freq: 380, q: 9, gain: 1 }, { freq: 820, q: 11, gain: 0.8 }, { freq: 1650, q: 12, gain: 0.6 }], d: 0.05, r: 0.02, gain: 0.5 * k }),
  tone({ hz: 1250, mod: 2.41, index: 3, indexEnd: 0.2, slide: 0.012, to: 1150, bend: 0.03, d: 0.03, r: 0.012, gain: 0.16 * k }),
  tone({ hz: 190, to: 130, bend: 0.03, a: 0.001, d: 0.03, r: 0.015, gain: 0.12 * k, filter: { type: 'highpass', freq: 70, q: 0 } }),
  // the ball leaving: a sub thump you feel more than hear
  tone({ hz: 82, to: 58, bend: 0.04, a: 0.001, d: 0.045, r: 0.02, gain: 0.07 * k }),
];
// A second, later answer off the far stands for the loudest sounds: the outfield bleachers are
// three times as far as the seats behind the plate.
const echo = (layers, g = 0.12, ms = 0.38, lp = 1500) => [...layers, ...layers.map((l) => ({
  ...l, gain: +(l.gain * g).toFixed(4), delay: +((l.delay || 0) + ms).toFixed(4),
  ...(l.formants ? {} : { filter: { type: 'lowpass', freq: lp, q: 0.5 } }),
}))];
// Dirt kicked up: a scatter of grains, each a tick of high noise, thinning out.
const grit = (n, at, spread, g) => Array.from({ length: n }, (_, i) => noise({
  hz: 2600 + (i % 4) * 600, q: 1.4, d: 0.006, r: 0.004, gain: +(g * (1 - i / (n * 1.4))).toFixed(4),
  delay: +(at + i * spread + ((i * 7) % 3) * 0.009).toFixed(4), pan: (((i * 5) % 5) - 2) * 0.15,
}));
// One bass drum in the bleachers: the head's thump and the beater's click.
const drum = (at, gain = 0.2) => [
  tone({ hz: 64, to: 44, bend: 0.08, a: 0.002, d: 0.14, r: 0.06, gain, delay: at }),
  noise({ type: 'lowpass', hz: 900, q: 0.5, d: 0.02, r: 0.01, gain: +(gain * 0.45).toFixed(4), delay: at }),
];

// ═══ LEATHER ═══════════════════════════════════════════════════════════════════
// A ball into a glove: a dull pop (low-passed noise in a few ms) and the pocket's thud. The
// catcher's mitt is stiffer and louder, with a hollow knock (FM at 2) the stands throw back.
const leather = (k = 1, bright = 1) => [
  noise({ type: 'lowpass', hz: 1400 * bright, q: 0.7, d: 0.012, r: 0.008, gain: 0.3 * k }),
  tone({ hz: 230 * bright, to: 180 * bright, bend: 0.03, a: 0.001, d: 0.035, r: 0.015, gain: 0.16 * k }),
];
const mitt = () => slap([
  noise({ type: 'lowpass', hz: 2600, q: 0.8, d: 0.01, r: 0.006, gain: 0.36 }),
  tone({ hz: 900, mod: 2, index: 1.4, indexEnd: 0.1, slide: 0.01, a: 0.0006, d: 0.018, r: 0.008, gain: 0.14 }),
  tone({ hz: 190, to: 150, bend: 0.03, a: 0.001, d: 0.045, r: 0.02, gain: 0.2 }),
], 0.22);

// ═══ THE BALL ══════════════════════════════════════════════════════════════════
const hop = (dirt) => (dirt
  ? [noise({ type: 'lowpass', hz: 1700, q: 0.5, d: 0.022, r: 0.012, gain: 0.2 }), noise({ hz: 3200, q: 0.7, d: 0.03, r: 0.015, gain: 0.07, delay: 0.004 }), tone({ hz: 300, to: 220, a: 0.001, d: 0.02, r: 0.01, gain: 0.08 })]
  : [noise({ type: 'lowpass', hz: 800, q: 0.5, d: 0.03, r: 0.015, gain: 0.2, colour: 'pink' }), tone({ hz: 180, to: 140, a: 0.001, d: 0.025, r: 0.012, gain: 0.08 })]);

// ═══ RUNNING ═══════════════════════════════════════════════════════════════════
// A cleat: a crunch of dirt (a narrow band near 2 kHz) and the foot's weight under it. Quiet:
// eighteen men run at once and none of them should be heard over the ball.
const cleat = (dirt) => (dirt
  ? [noise({ hz: 2300, q: 0.9, d: 0.028, r: 0.012, gain: 0.12 }), noise({ type: 'lowpass', hz: 600, q: 0.5, d: 0.018, r: 0.01, gain: 0.08 })]
  : [noise({ hz: 1500, q: 0.7, d: 0.04, r: 0.015, gain: 0.09, colour: 'pink' })]);

// ═══ THE CROWD ═════════════════════════════════════════════════════════════════
// Thousands of voices are noise through the bands voices sit in, pulsed by tremolos at rates
// that never line up. A cheer opens bright; a groan is the same crowd on a falling vowel.
const voices = (o) => [
  noise({ hz: 600, q: 0.6, a: o.a, d: o.d, s: o.s ?? 0.5, r: o.r, gain: 0.16 * o.k, colour: 'pink', width: 0.8, tremolo: { rate: 3.1, depth: 0.3 } }),
  noise({ hz: 1150 * (o.bright ?? 1), q: 0.7, a: o.a * 1.2, d: o.d, s: o.s ?? 0.5, r: o.r, gain: 0.12 * o.k, colour: 'pink', width: 0.9, tremolo: { rate: 7.3, depth: 0.25 } }),
  noise({ hz: 2300 * (o.bright ?? 1), q: 0.9, a: o.a * 1.4, d: o.d, s: o.s ?? 0.45, r: o.r, gain: 0.06 * o.k, width: 1, tremolo: { rate: 11.3, depth: 0.3 } }),
];
const vowel = (f, o) => noise({ formants: f.map((hz, i) => ({ freq: hz, q: 7 + i * 2, gain: 1 - i * 0.25 })), a: o.a, d: o.d, s: o.s ?? 0.5, r: o.r, gain: o.gain, colour: 'pink', width: 0.9, tremolo: o.tremolo, delay: o.delay });

// ═══ BRASS ═════════════════════════════════════════════════════════════════════
// The graphics' stings: a sawtooth whose lowpass opens on the attack and closes as the note
// holds, which is most of what makes brass brass.
const brass = (hz, at, len, gain = 0.13, pan = 0) => tone({
  wave: 'sawtooth', hz, a: 0.012, d: len, s: 0.6, r: 0.07, linear: true, delay: at, gain, pan,
  filter: { type: 'lowpass', freq: hz * 7, q: 1.1, to: hz * 3, time: len }, vibrato: { rate: 5.5, depth: 6 },
});
const N = (m) => 440 * Math.pow(2, (m - 69) / 12);

// ═══ THE ORGAN ═════════════════════════════════════════════════════════════════
// The organist knows one song. It's in a minor key and it's about drowning (data/scripts/
// baseball.bsm says so). A pitch is a triangle (the hollow, odd-harmonic stops), the tune gets
// a sine an octave up for the 4' drawbar, everything gets a Leslie's tremolo, and each beat a key
// click. A note's length is held by its decay at full sustain, so a phrase is one cue.
function organ(notes, bpm, gain = 0.07) {
  const beat = 60 / bpm, layers = [];
  let at = 0;
  for (const [midis, beats] of notes) {
    const len = beats * beat, delay = +at.toFixed(4), held = { a: 0.008, d: Math.max(0.01, len * 0.92 - 0.02), s: 1, r: 0.08, linear: true, delay, tremolo: { rate: 6.4, depth: 0.12 } };
    [].concat(midis).forEach((m, i) => {
      layers.push(tone({ ...held, wave: 'triangle', hz: N(m), gain: +(gain * (i ? 0.7 : 1)).toFixed(4) }));
      if (!i) layers.push(tone({ ...held, hz: N(m) * 2, gain: +(gain * 0.45).toFixed(4) }));
    });
    layers.push(noise({ hz: 2400, q: 0.8, d: 0.004, r: 0.003, gain: gain * 0.5, delay }));
    at += len;
  }
  return layers;
}
// The one song: D minor, its tune and a bass under it. Written for this park; nobody else's.
const DIRGE = [
  [[57, 50], 1], [[62], 1], [[65], 1], [[64, 52], 1], [[62], 1.5], [[60], 0.5], [[57, 53], 2],
  [[58, 46], 1], [[57], 1], [[55, 48], 1], [[57], 1], [[62, 50, 57], 4],
];
// the same four notes, quick and hopeful, which is as close as he gets to a rally
const RALLY = [[[57], 0.5], [[62], 0.5], [[65], 0.5], [[69, 62, 57], 2]];
// and for a final, the league's anthem: the one song again, in D major for once, and slower
const ANTHEM = [
  [[57, 50], 1], [[62], 1], [[66], 1], [[64, 52], 1], [[62], 1.5], [[61], 0.5], [[57, 54], 2],
  [[59, 43], 1], [[57], 1], [[55, 47], 1], [[57], 1], [[62, 50, 57, 66], 4],
];

// ═══ THE PATCHES ═══════════════════════════════════════════════════════════════
export const BUILTINS = [
  // contact
  def('db-crack', 'Bat: barrel', 7, slap(crack(1)), { vary: { pitch: 0.04, gain: 0.08, env: 0.1 } }),
  def('db-crack-end', 'Bat: end of the bat', 6, slap([
    noise({ type: 'highpass', hz: 2600, q: 0.7, d: 0.005, r: 0.004, gain: 0.26, width: 0.3 }),
    tone({ hz: 1600, mod: 1.41, index: 2, indexEnd: 0.3, slide: 0.03, d: 0.07, r: 0.03, gain: 0.14 }),
    noise({ formants: [{ freq: 520, q: 10, gain: 0.7 }, { freq: 1900, q: 12, gain: 1 }], d: 0.04, r: 0.02, gain: 0.32 }),
  ])),
  // a ball hit as hard as anyone hits one: the barrel louder and longer, and the bleachers answer
  def('db-crack-screamer', 'Bat: a screamer off the barrel', 8, echo(slap([
    ...crack(0.97),
    tone({ hz: 1250, mod: 2.41, index: 3.5, indexEnd: 0.3, slide: 0.03, to: 1180, bend: 0.06, d: 0.07, r: 0.03, gain: 0.07 }),
  ], 0.3)), { vary: { pitch: 0.03, gain: 0.06, env: 0.08 } }),
  // under the ball: a hollow tock and no ring, the pop-up everyone sighs at
  def('db-crack-pop', 'Bat: under the ball', 6, slap([
    noise({ type: 'highpass', hz: 2400, q: 0.7, d: 0.004, r: 0.003, gain: 0.2 }),
    tone({ hz: 700, mod: 2, index: 1.8, indexEnd: 0.2, slide: 0.015, to: 640, a: 0.0008, d: 0.04, r: 0.015, gain: 0.17 }),
    noise({ formants: [{ freq: 480, q: 9, gain: 1 }, { freq: 1150, q: 10, gain: 0.7 }], d: 0.035, r: 0.015, gain: 0.34 }),
    tone({ hz: 160, to: 120, a: 0.001, d: 0.025, r: 0.012, gain: 0.1 }),
  ], 0.22)),
  def('db-crack-jam', 'Bat: off the handle', 6, [
    tone({ hz: 150, to: 100, bend: 0.04, a: 0.001, d: 0.05, r: 0.02, gain: 0.2, filter: { type: 'highpass', freq: 60, q: 0 } }),
    noise({ type: 'lowpass', hz: 900, q: 0.6, d: 0.03, r: 0.015, gain: 0.22 }),
    tone({ wave: 'triangle', hz: 230, a: 0.001, d: 0.06, r: 0.02, gain: 0.08, tremolo: { rate: 42, depth: 0.7 } }),
  ]),
  def('db-foul-tip', 'Bat: foul tip into the mitt', 5, [
    tone({ hz: 3200, mod: 1.41, index: 1.2, indexEnd: 0.1, slide: 0.005, d: 0.01, r: 0.005, gain: 0.12 }),
    ...mitt().map((l) => ({ ...l, gain: +(l.gain * 0.8).toFixed(4), delay: +((l.delay || 0) + 0.035).toFixed(4) })),
  ]),
  def('db-bunt', 'Bat: bunt', 5, [
    tone({ hz: 420, mod: 2, index: 1, indexEnd: 0.1, slide: 0.02, to: 380, a: 0.0008, d: 0.03, r: 0.012, gain: 0.18 }),
    noise({ type: 'lowpass', hz: 1200, q: 0.5, d: 0.015, r: 0.01, gain: 0.18 }),
  ]),
  def('db-bat-break', 'Bat: broken bat', 7, [
    ...crack(0.8),
    noise({ hz: 2600, q: 1.2, a: 0.002, d: 0.16, r: 0.05, gain: 0.16, tremolo: { rate: 63, depth: 0.85 }, delay: 0.004 }),
    tone({ hz: 640, mod: 1.73, index: 2, indexEnd: 0.2, slide: 0.03, d: 0.05, r: 0.02, gain: 0.08, delay: 0.01 }),
  ]),
  def('db-whiff', 'Bat: swing and miss', 3, [noise({ hz: 600, to: 1800, sweep: 0.12, q: 0.6, linear: true, a: 0.05, d: 0.11, r: 0.05, gain: 0.16, colour: 'pink' })], { vary: STEP }),

  // leather
  def('db-mitt', 'Leather: the catcher\'s mitt', 5, mitt()),
  def('db-glove', 'Leather: a fielder\'s glove', 4, leather(0.85, 0.85)),
  def('db-stretch', 'Leather: the first baseman\'s stretch', 4, [...leather(1), noise({ hz: 900, q: 0.6, a: 0.01, d: 0.07, r: 0.03, gain: 0.07, delay: 0.02 })]),
  def('db-tag', 'Leather: the tag', 5, [
    tone({ hz: 160, to: 120, a: 0.001, d: 0.04, r: 0.02, gain: 0.18 }),
    noise({ type: 'lowpass', hz: 700, q: 0.5, d: 0.03, r: 0.015, gain: 0.2 }),
    noise({ hz: 2800, q: 0.6, a: 0.004, d: 0.05, r: 0.02, gain: 0.05, delay: 0.01 }),
  ]),
  def('db-pickoff', 'Leather: a pickoff throw into the glove', 5, slap(leather(1.2, 1.15), 0.2)),

  // the ball
  def('db-hop-dirt', 'Ball: a hop on the dirt', 3, hop(true), { vary: STEP }),
  def('db-hop-grass', 'Ball: a bounce on the grass', 3, hop(false), { vary: STEP }),
  def('db-roll-grass', 'Ball: rolling through the grass', 2, [noise({ hz: 2400, q: 0.5, a: 0.03, d: 0.18, r: 0.08, gain: 0.08, colour: 'pink', linear: true })], { vary: STEP }),
  def('db-wall', 'Ball: off the padded wall', 6, slap([
    tone({ hz: 95, to: 70, bend: 0.06, a: 0.002, d: 0.08, r: 0.03, gain: 0.26, filter: { type: 'highpass', freq: 45, q: 0 } }),
    noise({ type: 'lowpass', hz: 500, q: 0.5, d: 0.06, r: 0.03, gain: 0.26 }),
    tone({ hz: 260, mod: 2, index: 1.2, indexEnd: 0.1, slide: 0.03, a: 0.001, d: 0.05, r: 0.02, gain: 0.12 }),
  ], 0.3)),
  def('db-pole', 'Ball: off the foul pole', 7, [
    noise({ type: 'highpass', hz: 3000, q: 0.7, d: 0.004, r: 0.003, gain: 0.2 }),
    tone({ hz: 880, mod: 2.76, index: 2.5, indexEnd: 0.6, slide: 0.15, a: 0.0006, d: 0.7, r: 0.25, gain: 0.16 }),
    tone({ hz: 2390, mod: 1.41, index: 1.2, indexEnd: 0.2, slide: 0.08, a: 0.0006, d: 0.35, r: 0.15, gain: 0.08 }),
  ], { vary: { pitch: 0.01, gain: 0.06, env: 0.05 } }),
  def('db-net', 'Ball: into the backstop net', 4, [
    noise({ hz: 1800, q: 1.2, a: 0.004, d: 0.14, r: 0.05, gain: 0.12, tremolo: { rate: 22, depth: 0.6 } }),
    tone({ hz: 210, to: 160, a: 0.002, d: 0.03, r: 0.015, gain: 0.08 }),
  ]),
  def('db-backstop', 'Ball: rattling the backstop', 5, [
    tone({ hz: 420, mod: 2, index: 1.6, indexEnd: 0.2, slide: 0.02, a: 0.0008, d: 0.04, r: 0.015, gain: 0.16 }),
    noise({ hz: 3000, q: 1.6, a: 0.002, d: 0.24, r: 0.08, gain: 0.1, tremolo: { rate: 35, depth: 0.8 } }),
  ]),
  def('db-seats', 'Ball: clattering in the seats', 4, [
    [700, 0], [1120, 0.07], [880, 0.16], [610, 0.23], [990, 0.31],
  ].map(([hz, at], i) => tone({ hz, mod: 1.73, index: 1.6, indexEnd: 0.1, slide: 0.01, a: 0.0006, d: 0.025, r: 0.01, gain: 0.16 - i * 0.022, delay: at }))),
  def('db-ball-dirt', 'Ball: a pitch in the dirt', 4, [
    tone({ hz: 210, to: 150, a: 0.001, d: 0.04, r: 0.02, gain: 0.16 }),
    noise({ hz: 1400, q: 0.6, a: 0.002, d: 0.06, r: 0.03, gain: 0.14 }),
  ]),
  def('db-hbp', 'Ball: hit batter', 6, [
    tone({ hz: 150, to: 100, bend: 0.05, a: 0.001, d: 0.06, r: 0.025, gain: 0.24, filter: { type: 'highpass', freq: 60, q: 0 } }),
    tone({ hz: 1300, mod: 2.41, index: 2.5, indexEnd: 0.2, slide: 0.01, a: 0.0005, d: 0.02, r: 0.01, gain: 0.12 }),
    noise({ type: 'lowpass', hz: 900, q: 0.5, d: 0.04, r: 0.02, gain: 0.14 }),
  ]),

  // running
  def('db-cleat-dirt', 'Running: cleats on the dirt', 1, cleat(true), { vary: STEP }),
  def('db-cleat-grass', 'Running: cleats on the grass', 1, cleat(false), { vary: STEP }),
  def('db-slide', 'Running: a slide into the bag', 5, [
    tone({ hz: 120, to: 85, a: 0.002, d: 0.05, r: 0.02, gain: 0.18 }),
    noise({ hz: 1100, to: 600, sweep: 0.32, q: 0.6, a: 0.02, d: 0.34, r: 0.08, gain: 0.2, linear: true }),
    noise({ hz: 3400, q: 0.5, a: 0.04, d: 0.3, r: 0.1, gain: 0.05, linear: true, width: 0.6 }),
    ...grit(6, 0.08, 0.04, 0.06),
    noise({ type: 'lowpass', hz: 500, q: 0.5, a: 0.006, d: 0.06, r: 0.03, gain: 0.1, colour: 'brown', delay: 0.26 }),
  ]),
  def('db-dive-back', 'Running: diving back to the bag', 4, [
    tone({ hz: 120, to: 90, a: 0.002, d: 0.05, r: 0.02, gain: 0.18 }),
    noise({ type: 'lowpass', hz: 900, q: 0.5, d: 0.14, r: 0.04, gain: 0.14 }),
    tone({ hz: 300, a: 0.001, d: 0.02, r: 0.01, gain: 0.1, delay: 0.12 }),
    ...grit(4, 0.03, 0.03, 0.06),
  ]),
  def('db-dive', 'Running: a dive on the grass', 4, [
    tone({ hz: 110, to: 80, a: 0.002, d: 0.06, r: 0.025, gain: 0.2, filter: { type: 'highpass', freq: 50, q: 0 } }),
    noise({ hz: 420, q: 0.5, a: 0.004, d: 0.18, r: 0.05, gain: 0.2, colour: 'pink' }),
  ]),
  // a dive on the infield or the track: the body landing, the dirt sprayed ahead of it, and the
  // grains coming down
  def('db-dive-dirt', 'Running: a dive into the dirt', 5, [
    tone({ hz: 100, to: 68, a: 0.002, d: 0.07, r: 0.03, gain: 0.22, filter: { type: 'highpass', freq: 50, q: 0 } }),
    noise({ type: 'lowpass', hz: 700, q: 0.5, a: 0.003, d: 0.12, r: 0.04, gain: 0.2, colour: 'brown' }),
    noise({ hz: 1900, to: 900, sweep: 0.24, q: 0.6, a: 0.01, d: 0.24, r: 0.06, gain: 0.1, linear: true, width: 0.6, delay: 0.01 }),
    ...grit(7, 0.04, 0.035, 0.08),
  ], { vary: STEP }),
  def('db-collision', 'Running: a collision at the plate', 8, slap([
    tone({ hz: 120, to: 80, bend: 0.05, a: 0.001, d: 0.06, r: 0.03, gain: 0.26, filter: { type: 'highpass', freq: 55, q: 0 } }),
    tone({ hz: 330, mod: 2, index: 2, indexEnd: 0.3, slide: 0.03, to: 260, a: 0.001, d: 0.06, r: 0.025, gain: 0.18 }),
    tone({ hz: 1500, mod: 2.41, index: 3, indexEnd: 0.3, slide: 0.014, a: 0.0005, d: 0.035, r: 0.014, gain: 0.12, delay: 0.003 }),
    noise({ hz: 950, q: 0.8, a: 0.002, d: 0.08, r: 0.03, gain: 0.12, delay: 0.004 }),
  ], 0.25)),
  def('db-throw', 'Running: an arm whipping a throw', 2, [noise({ hz: 900, to: 1700, sweep: 0.07, q: 0.7, a: 0.02, d: 0.06, r: 0.03, gain: 0.07, linear: true })], { vary: STEP }),

  // the park
  def('db-horn', 'Park: a car horn in the streets', 2, [
    tone({ wave: 'square', hz: 420, a: 0.015, d: 0.32, s: 0.9, r: 0.06, linear: true, gain: 0.03, filter: { type: 'lowpass', freq: 1100, q: 0.7 } }),
    tone({ wave: 'square', hz: 528, a: 0.015, d: 0.32, s: 0.9, r: 0.06, linear: true, gain: 0.025, filter: { type: 'lowpass', freq: 1100, q: 0.7 } }),
  ], { vary: { pitch: 0.06, gain: 0.2, env: 0.3 } }),
  def('db-foghorn', 'Park: the Beacon\'s foghorn from the harbour', 2, [
    tone({ wave: 'sawtooth', hz: 110, a: 0.3, d: 1.5, s: 0.9, r: 1.1, linear: true, gain: 0.05, filter: { type: 'lowpass', freq: 520, q: 0.8 } }),
    tone({ wave: 'sawtooth', hz: 165, a: 0.35, d: 1.45, s: 0.9, r: 1.1, linear: true, gain: 0.025, filter: { type: 'lowpass', freq: 520, q: 0.8 } }),
  ], { vary: STEADY }),
  def('db-lamp', 'Park: a dead lamp flickering', 2, [
    tone({ wave: 'square', hz: 120, a: 0.004, d: 0.3, s: 0.6, r: 0.05, linear: true, gain: 0.025, tremolo: { rate: 17, depth: 1 }, filter: { type: 'lowpass', freq: 1800, q: 0.6 } }),
    noise({ hz: 4200, q: 1, a: 0.002, d: 0.3, r: 0.04, gain: 0.03, tremolo: { rate: 23, depth: 1 }, linear: true }),
  ]),

  // the crowd
  def('db-crowd-swell', 'Crowd: a swell off the bat', 2, voices({ a: 0.25, d: 0.5, s: 0.2, r: 0.35, k: 0.7 }), { vary: STEP }),
  def('db-crowd-cheer', 'Crowd: a cheer', 2, voices({ a: 0.08, d: 0.9, s: 0.5, r: 0.5, k: 1, bright: 1.1 })),
  def('db-crowd-roar', 'Crowd: the roar', 3, [
    ...voices({ a: 0.12, d: 2.2, s: 0.6, r: 1.1, k: 1.25, bright: 1.2 }),
    noise({ type: 'lowpass', hz: 420, q: 0.5, a: 0.15, d: 2, s: 0.5, r: 1, gain: 0.1, colour: 'brown', width: 0.7 }),
  ], { vary: STEP }),
  def('db-crowd-groan', 'Crowd: a groan', 2, [
    vowel([620, 1050, 2400], { a: 0.06, d: 0.9, s: 0.3, r: 0.4, gain: 0.32 }),
    noise({ hz: 700, to: 420, sweep: 0.9, q: 0.7, a: 0.06, d: 0.9, s: 0.2, r: 0.3, gain: 0.08, colour: 'pink', width: 0.8 }),
  ], { vary: STEP }),
  def('db-crowd-boo', 'Crowd: boos', 2, [
    vowel([300, 870, 2240], { a: 0.15, d: 1.4, s: 0.5, r: 0.5, gain: 0.34, tremolo: { rate: 3.7, depth: 0.45 } }),
  ], { vary: STEP }),
  def('db-crowd-gasp', 'Crowd: a gasp', 2, [noise({ hz: 1400, to: 2300, sweep: 0.15, q: 0.6, a: 0.04, d: 0.25, r: 0.15, gain: 0.14, colour: 'pink', width: 0.9 })], { vary: STEP }),
  def('db-crowd-ooh', 'Crowd: the ooh of a near miss', 2, [
    vowel([360, 760, 2300], { a: 0.12, d: 0.7, s: 0.3, r: 0.35, gain: 0.34, tremolo: { rate: 2.2, depth: 0.25 } }),
  ], { vary: STEP }),
  // one clap is a dozen hands in 40 ms; the mixer plays it on the beat
  def('db-clap', 'Crowd: a clap in time', 2, Array.from({ length: 10 }, (_, i) => noise({
    hz: 1300 + (i % 4) * 260, q: 0.9, d: 0.018, r: 0.01, gain: 0.15, delay: +(i * 0.0041 + (i % 3) * 0.003).toFixed(4), pan: ((i % 5) - 2) * 0.3,
  })), { vary: STEP }),
  // before a pitch that matters: the crowd's talk rising, nobody cheering yet
  def('db-crowd-murmur', 'Crowd: the murmur before a big pitch', 2, voices({ a: 0.7, d: 1.1, s: 0.55, r: 0.6, k: 0.65, bright: 0.9 }), { vary: STEP }),
  // two fingers in somebody's mouth, and somebody answering from the other side
  def('db-crowd-whistle', 'Crowd: a whistle from the stands', 2, [
    tone({ hz: 2300, to: 3100, bend: 0.16, a: 0.03, d: 0.34, s: 0.5, r: 0.08, linear: true, gain: 0.05, vibrato: { rate: 6, depth: 20 }, pan: -0.3 }),
    tone({ hz: 2900, to: 2500, bend: 0.2, a: 0.02, d: 0.22, s: 0.4, r: 0.06, linear: true, gain: 0.035, delay: 0.3, pan: 0.35 }),
  ], { vary: STEP }),
  def('db-towels', 'Crowd: the towels waving in the final', 2, [
    noise({ hz: 900, q: 0.5, a: 0.4, d: 2.2, s: 0.6, r: 0.8, gain: 0.1, colour: 'pink', width: 1, tremolo: { rate: 2.6, depth: 0.6 }, linear: true }),
  ], { vary: STEP }),

  // the hype: what the park's own system and the bleachers do to get a crowd up
  // the stadium air horn, three reeds a little out of tune with each other
  def('db-airhorn', 'Hype: the stadium air horn', 5, [233, 294, 350].map((hz, i) => tone({
    wave: 'sawtooth', hz: hz * (1 + (i - 1) * 0.004), a: 0.02, d: 0.85, s: 0.9, r: 0.12, linear: true, gain: 0.011,
    drive: 0.35, filter: { type: 'lowpass', freq: 2600, q: 0.9 }, vibrato: { rate: 4.5, depth: 3 }, pan: (i - 1) * 0.25,
  })), { vary: STEADY }),
  // the videoboard's hit: a sub drop under a crash of noise
  def('db-hype-boom', 'Hype: the videoboard boom', 5, [
    tone({ hz: 70, to: 32, bend: 0.6, a: 0.004, d: 0.7, r: 0.2, gain: 0.26 }),
    noise({ type: 'lowpass', hz: 3800, q: 0.5, to: 600, sweep: 0.6, a: 0.003, d: 0.6, r: 0.2, gain: 0.1, width: 1 }),
  ], { vary: STEADY }),
  // the bleachers' bass drum: two, then three quick
  def('db-drum-chant', 'Hype: the bass drum in the bleachers', 3, [0, 0.42, 0.84, 1.05, 1.26].flatMap((at) => drum(at)), { vary: STEADY }),
  // the stands stamping on the boards, faster as the pitch comes
  def('db-stomp', 'Hype: the stands stamping', 3, [0, 0.36, 0.66, 0.92, 1.14, 1.32, 1.47, 1.6, 1.71, 1.8].map((at, i) => noise({
    type: 'lowpass', hz: 380, q: 0.6, a: 0.003, d: 0.06, r: 0.03, gain: +(0.16 + i * 0.012).toFixed(4), colour: 'brown', width: 0.9, delay: at,
  })), { vary: STEP }),

  // the graphics
  def('db-sting-homer', 'Graphics: home run fanfare', 6, [
    brass(N(67), 0, 0.11, 0.1), brass(N(72), 0.1, 0.11, 0.11), brass(N(76), 0.2, 0.11, 0.11),
    brass(N(79), 0.3, 0.5, 0.12, -0.2), brass(N(72), 0.3, 0.5, 0.08, 0.2), brass(N(64), 0.3, 0.5, 0.07),
  ], { vary: STEADY }),
  def('db-sting-run', 'Graphics: a run scores', 5, [brass(N(72), 0, 0.09, 0.1), brass(N(76), 0.09, 0.09, 0.1), brass(N(79), 0.18, 0.22, 0.12)], { vary: STEADY }),
  def('db-sting-k', 'Graphics: strikeout', 4, [
    tone({ wave: 'sawtooth', hz: 392, to: 196, bend: 0.2, a: 0.006, d: 0.24, s: 0.2, r: 0.08, linear: true, gain: 0.11, filter: { type: 'lowpass', freq: 1500, q: 1.3 } }),
  ], { vary: STEADY }),
  def('db-sting-out', 'Graphics: an out', 3, [
    tone({ hz: 220, to: 190, a: 0.002, d: 0.09, r: 0.04, gain: 0.14 }),
    noise({ type: 'lowpass', hz: 600, q: 0.8, d: 0.03, r: 0.02, gain: 0.06 }),
  ]),
  def('db-sting-base', 'Graphics: on base', 4, [
    tone({ hz: 620, a: 0.004, d: 0.08, r: 0.04, gain: 0.13 }), tone({ hz: 830, a: 0.004, d: 0.1, r: 0.05, gain: 0.13, delay: 0.085 }),
  ], { vary: STEADY }),
  def('db-sting-splash', 'Graphics: a splash word', 4, [
    noise({ hz: 500, to: 2600, sweep: 0.14, q: 0.7, a: 0.03, d: 0.13, r: 0.05, gain: 0.08, linear: true }),
    brass(N(74), 0.12, 0.18, 0.1), brass(N(69), 0.12, 0.18, 0.07),
  ], { vary: STEADY }),
  def('db-click', 'Graphics: the count lamps', 2, [
    tone({ hz: 2400, mod: 1.41, index: 0.8, indexEnd: 0, slide: 0.004, a: 0.0004, d: 0.006, r: 0.004, gain: 0.07 }),
    tone({ hz: 600, a: 0.0006, d: 0.012, r: 0.006, gain: 0.05 }),
  ], { vary: STEADY }),
  def('db-beep', 'Graphics: the speed readout', 2, [tone({ wave: 'square', hz: 1760, a: 0.002, d: 0.05, s: 0.6, r: 0.02, linear: true, gain: 0.035, filter: { type: 'lowpass', freq: 3200, q: 0.7 } })], { vary: STEADY }),
  def('db-trail', 'Graphics: the comet\'s tail', 3, [
    noise({ hz: 400, to: 3000, sweep: 0.5, q: 0.8, a: 0.08, d: 0.45, r: 0.15, gain: 0.1, linear: true, width: 0.6 }),
    noise({ hz: 5200, q: 0.6, a: 0.12, d: 0.4, r: 0.15, gain: 0.03, colour: 'pink', linear: true }),
  ]),
  def('db-sparks', 'Graphics: sparks off the bat', 3, Array.from({ length: 9 }, (_, i) => noise({
    hz: 3000 + (i % 3) * 700, q: 1.2, d: 0.006, r: 0.004, gain: 0.15 - i * 0.01, delay: +(0.01 + i * 0.037 + (i % 2) * 0.013).toFixed(4), pan: ((i % 3) - 1) * 0.4,
  }))),
  def('db-rewind', 'Graphics: into the replay', 4, [
    tone({ wave: 'sawtooth', hz: 900, to: 200, bend: 0.4, a: 0.01, d: 0.4, s: 0.3, r: 0.06, linear: true, gain: 0.06, tremolo: { rate: 26, depth: 0.5 }, filter: { type: 'lowpass', freq: 2400, q: 0.8 } }),
    noise({ hz: 3000, to: 700, sweep: 0.4, q: 0.7, a: 0.01, d: 0.4, r: 0.06, gain: 0.06, linear: true }),
  ], { vary: STEADY }),
  def('db-sweep', 'Graphics: the inning sweep', 3, [
    noise({ hz: 700, to: 2800, sweep: 0.3, q: 0.7, a: 0.05, d: 0.28, r: 0.1, gain: 0.08, linear: true, width: 0.8 }),
    tone({ hz: N(81), mod: 2, index: 0.6, indexEnd: 0, slide: 0.2, a: 0.004, d: 0.35, r: 0.15, gain: 0.05, delay: 0.24 }),
  ], { vary: STEADY }),
  def('db-table', 'Graphics: the leaders rolling in', 2, Array.from({ length: 6 }, (_, i) => tone({
    hz: 1900 - i * 90, mod: 1.41, index: 0.8, indexEnd: 0, slide: 0.004, a: 0.0004, d: 0.008, r: 0.004, gain: 0.05, delay: +(i * 0.05).toFixed(3),
  })), { vary: STEADY }),

  // fireworks
  def('db-fw-launch', 'Fireworks: the launch whistle', 3, [
    tone({ hz: 1150, to: 2500, bend: 0.85, a: 0.05, d: 0.8, s: 0.6, r: 0.1, linear: true, gain: 0.04, vibrato: { rate: 13, depth: 30 } }),
    noise({ hz: 2600, q: 0.8, a: 0.03, d: 0.7, r: 0.08, gain: 0.03, linear: true }),
  ]),
  def('db-fw-burst', 'Fireworks: a burst, and the city answering', 5, [
    noise({ type: 'lowpass', hz: 320, q: 0.6, a: 0.004, d: 0.55, r: 0.2, gain: 0.32, colour: 'brown', width: 0.6 }),
    tone({ hz: 62, to: 38, bend: 0.25, a: 0.003, d: 0.3, r: 0.1, gain: 0.2 }),
    noise({ hz: 2000, q: 0.7, d: 0.02, r: 0.01, gain: 0.12 }),
    noise({ type: 'lowpass', hz: 650, q: 0.6, a: 0.02, d: 0.45, r: 0.2, gain: 0.1, colour: 'brown', delay: 0.38, width: 0.9 }),
    noise({ type: 'lowpass', hz: 500, q: 0.6, a: 0.03, d: 0.5, r: 0.25, gain: 0.05, colour: 'brown', delay: 0.85, width: 1 }),
  ]),
  def('db-fw-crackle', 'Fireworks: the crackle', 2, Array.from({ length: 12 }, (_, i) => noise({
    hz: 2200 + (i % 4) * 450, q: 1.1, d: 0.008, r: 0.005, gain: 0.11, delay: +(i * 0.09 + ((i * 7) % 5) * 0.017).toFixed(4), pan: (((i * 3) % 5) - 2) * 0.35,
  }))),

  // the organ
  def('db-organ-dirge', 'Organ: the one song', 3, organ(DIRGE, 84), { hold: 0.02, vary: STEADY }),
  def('db-organ-rally', 'Organ: the one song, hopeful', 3, organ(RALLY, 150, 0.08), { hold: 0.02, vary: STEADY }),
  def('db-organ-anthem', 'Organ: the league anthem, before a final', 3, organ(ANTHEM, 72), { hold: 0.02, vary: STEADY }),
];
const BY_ID = new Map(BUILTINS.map((d) => [d.id, d]));

// ── variation ────────────────────────────────────────────────────────────────
// As hockey-sfx.js's: a take moves the whole cue by one pitch factor (so partials keep their
// ratios), its level and its envelope, inside the patch's own `vary`, and takes its noise from
// another place. `intensity` (0-1) is how hard: quieter and duller below 1. Seeded, so a seed is
// the same take on every client and in every test.
export function variant(d, seed, amount, intensity) {
  if (!d) return null;
  const k = amount ?? 1, r = rngFrom(seed ?? 1), v = d.vary || IMPACT;
  const inten = intensity == null ? 1 : Math.max(0, Math.min(1, intensity));
  const jit = (s) => 1 + (r() * 2 - 1) * s * k;
  const pf = jit(v.pitch), gf = jit(v.gain) * (0.45 + 0.55 * inten), ef = jit(v.env);
  const bright = 0.75 + 0.25 * inten;
  const noiseBase = ((seed ?? 1) * 2654435761) >>> 0;
  return { ...d, config: { ...d.config,
    layers: d.config.layers.map((L, n) => {
      const o = { ...L, gain: (L.gain ?? 0.2) * gf };
      if (o.freq) o.freq = L.freq * pf;
      if (L.pitchBend?.to) o.pitchBend = { ...L.pitchBend, to: L.pitchBend.to * pf };
      if (L.fm?.index != null) o.fm = { ...L.fm, index: L.fm.index * bright };
      if (L.filter?.freq) o.filter = { ...L.filter, freq: L.filter.freq * pf * bright, ...(L.filter.to ? { to: L.filter.to * pf * bright } : {}) };
      if (L.adsr && ef !== 1) o.adsr = { ...L.adsr, d: L.adsr.d * ef, r: L.adsr.r * ef };
      if (L.noiseMix > 0) o.noiseSeed = (noiseBase + n * 7919) % 100003;
      return o;
    }) } };
}
// A patch as the dev panel has it (an override saved there wins; null when it's muted there),
// else the default.
export const patch = (id) => (globalThis.SFXCatalog?.get ? globalThis.SFXCatalog.get(id) : BY_ID.get(id)) ?? null;
export const ids = () => [...BY_ID.keys()];

// ── what the park's events sound like ────────────────────────────────────────
// The mixer (diamond/sound.js) names what happened; this says which patch, how hard, and which
// layer of the mix it sits in (MIX). A function takes the event's data. `null` is a deliberate
// silence. Every id must be a patch above: scripts/audio/deadball-smoke.mjs checks.
const contact = (o) => {
  if (o.foulTip) return ['db-foul-tip', 0.9];
  if (o.bunt) return ['db-bunt', 0.9];
  if (o.broken) return ['db-bat-break', 1];
  const ev = +o.ev || 85;
  if (o.t === 'pu') return ['db-crack-pop', 0.85];
  if (ev >= 100 && !o.foul) return ['db-crack-screamer', Math.min(1, 0.85 + (ev - 100) / 40)];
  if (ev < 72) return ['db-crack-jam', 0.85];
  if (ev < 86 && o.foul) return ['db-crack-end', 0.85];
  return ['db-crack', Math.min(1, 0.7 + (ev - 80) / 40)];
};
export const EVENTS = {
  // what the director and the clips say
  crack: contact, contact,
  // a pitch into the mitt just after the bat touched it is a foul tip
  mitt: (o) => (o.tip ? ['db-foul-tip', 0.85] : ['db-mitt', Math.min(1, 0.65 + ((+o.velo || 90) - 70) / 60)]),
  glove: (o) => (o.role === 'catcher' ? ['db-mitt', 0.8] : o.stretch ? ['db-stretch', 1] : o.pickoff ? ['db-pickoff', 1] : ['db-glove', 0.9]),
  whiff: ['db-whiff', 0.9],
  tag: 'db-tag',
  hit: 'db-hbp',
  release: ['db-throw', 0.8],
  step: (o) => [o.dirt ? 'db-cleat-dirt' : 'db-cleat-grass', 0.5 + 0.3 * (o.hard ? 1 : 0)],
  slide: 'db-slide', diveBack: 'db-dive-back', dive: (o) => (o.dirt ? 'db-dive-dirt' : 'db-dive'), collision: 'db-collision',
  // what the ball does
  hop: (o) => [o.dirt ? 'db-hop-dirt' : 'db-hop-grass', Math.min(1, 0.45 + (+o.speed || 30) / 120)],
  roll: ['db-roll-grass', 0.7],
  wall: 'db-wall', pole: 'db-pole', net: 'db-net', backstop: 'db-backstop', seats: 'db-seats', dirt: 'db-ball-dirt',
  // the park
  horn: 'db-horn', foghorn: 'db-foghorn', lamp: 'db-lamp',
  // the crowd
  // off the bat, as loud as the ball's hit and louder for one going up
  swell: (o) => ['db-crowd-swell', Math.min(1, 0.45 + Math.max(0, (+o.ev || 85) - 80) / 40 + (o.t === 'fb' ? 0.15 : 0))],
  murmur: 'db-crowd-murmur', whistle: 'db-crowd-whistle',
  airhorn: 'db-airhorn', boom: 'db-hype-boom', drum: 'db-drum-chant', stomp: 'db-stomp',
  cheer: 'db-crowd-cheer', roar: 'db-crowd-roar', groan: 'db-crowd-groan', boo: 'db-crowd-boo',
  gasp: 'db-crowd-gasp', ooh: 'db-crowd-ooh', clap: ['db-clap', 0.8], towels: 'db-towels',
  // the graphics
  homer: 'db-sting-homer', run: 'db-sting-run', strikeout: 'db-sting-k', out: 'db-sting-out', base: 'db-sting-base',
  splash: 'db-sting-splash', click: 'db-click', beep: 'db-beep', trail: 'db-trail', sparks: 'db-sparks', rewind: 'db-rewind',
  sweep: 'db-sweep', table: 'db-table',
  // fireworks
  launch: 'db-fw-launch', burst: 'db-fw-burst', crackle: 'db-fw-crackle',
  // the organ
  dirge: 'db-organ-dirge', rally: 'db-organ-rally', anthem: 'db-organ-anthem',
};
// { id, intensity } for an event, or null when it has no sound
export function eventFor(key, o = {}) {
  const e = EVENTS[key];
  if (e == null) return null;
  const r = typeof e === 'function' ? e(o) : e;
  if (!r) return null;
  return Array.isArray(r) ? { id: r[0], intensity: r[1] ?? 1 } : { id: r, intensity: 1 };
}

// ── the mix ──────────────────────────────────────────────────────────────────
// Levels in dB against the booth's voice, and how far each layer ducks while the booth speaks
// (docs/proposals/deadball-glass2.md, The mix). The levels are a starting point to set by ear.
export const MIX = Object.freeze({
  call: { db: 0 },                  // the announcer's calls
  scene: { db: -3 },                // the umpire and the public address
  vendor: { db: -9 },               // a vendor somewhere in the stands
  // the bat meeting the ball and the ball into a glove: the game's two signature sounds, which at
  // the effects' level vanished under the booth
  impact: { db: -4, duck: -3 },
  fx: { db: -9, duck: -6 },         // the ball, running, the graphics' stings
  music: { db: -12, duck: -6 },     // the organ
  crowd: { db: -14, duck: -4 },     // the crowd and the park's air
  hype: { db: -11, duck: -6 },      // the air horn, the videoboard, the bleachers' drum and stamping
});
// which layer of the mix a patch sits in
export const layerOf = (id) => (/^db-organ/.test(id) ? 'music' : /^db-(airhorn|hype|drum|stomp)/.test(id) ? 'hype' : /^db-crowd|^db-clap|^db-towels|^db-horn|^db-foghorn|^db-lamp/.test(id) ? 'crowd'
  : /^db-(crack|bunt|bat-break|foul-tip|mitt|glove|stretch|pickoff)/.test(id) ? 'impact' : 'fx');
// How much plays at each Sound Detail (client/shared/settings.js sfxDetail): off keeps the
// calls, limited adds what happens, full adds the beds, the organ, the public address, the
// vendor, the footsteps and the park.
export const DETAIL = Object.freeze({
  call: 'off', event: 'limited', step: 'full', bed: 'full', music: 'full', pa: 'full', vendor: 'full', park: 'full',
});
export const tierAllows = (detail, what) => {
  const rank = { off: 0, limited: 1, full: 2 };
  return (rank[detail] ?? 1) >= (rank[DETAIL[what]] ?? 1);
};

// ── the voices ───────────────────────────────────────────────────────────────
// ORACLE voices (AudioEngine.speak's `voice`), each fully authored so no trait falls through to
// a seed's dice: the arcade announcer's calls, the plate umpire, the public address (through its
// horn, `pa`) and a vendor. Tuned in the dev panel's Voice Lab.
export const VOICES = Object.freeze({
  announcer: { f0: 96, fshift: 0.94, speed: 1.08, ring: 0, oq: 0.5, jitter: 0.006, breath: 0, lilt: 0.1, decl: 0.08, drive: 0.22, growl: 0 },
  umpire: { f0: 86, fshift: 0.92, speed: 1.3, ring: 0, oq: 0.48, jitter: 0.018, breath: 0.012, lilt: 0.06, decl: 0.12, drive: 0.12, growl: 0.06 },
  pa: { f0: 104, fshift: 0.98, speed: 1.12, ring: 0, oq: 0.6, jitter: 0.005, breath: 0, lilt: 0.08, decl: 0.1, drive: 0, growl: 0 },
  vendor: { f0: 142, fshift: 1.08, speed: 1.4, ring: 0.08, oq: 0.58, jitter: 0.012, breath: 0.01, lilt: 0.1, decl: 0.14, drive: 0.15, growl: 0 },
});
// What they say. A call is all caps and 20 letters or fewer, which ORACLE shouts.
export const CALLS = Object.freeze({
  announcer: {
    strikeout: 'STRIKE THREE!', homerun: 'HOME RUN!', grandslam: 'GRAND SLAM!',
    doubleplay: 'DOUBLE PLAY!', tripleplay: 'TRIPLE PLAY!', walkoff: 'WALK-OFF!', champions: 'CHAMPIONS!',
  },
  umpire: { strike: 'STRIKE!', strikethree: 'STRIKE THREE!', foul: 'FOUL BALL!', out: 'OUT!', safe: 'SAFE!', dead: 'DEAD BALL!' },
  pa: { batter: 'Now batting, number {num}, {batter}.', lineup: 'Batting {ord}, number {num}, {name}.' },
  vendor: [
    'Widowmaker! Get your Widowmaker!',
    'Meat adjacent! Hot and meat adjacent!',
    'Cold ones! Cold-ish ones!',
    'Peanuts! Mostly peanuts!',
  ],
});

// ═══ THE CROWD BED ══════════════════════════════════════════════════════════════
// Hockey's crowd bed (hockey-sfx.js crowdBed) on a continuous level rather than named states,
// because a ballpark's crowd follows how loud the fans in the stands are (gl/crowd.js createRoar),
// not a list of moments. A low-mid rumble, an airy band either side, and three narrow bands where
// distant voices sit, each pulsed by LFOs at rates that never line up, all under a 2.4 kHz
// lowpass. `setLevel(x)` eases every band to level x (0 a quiet park, 1 a home run); `duck(db,
// secs)` drops it under the booth and brings it back; `stop()` fades it and lets its nodes go.
// `opts`: { ctx, dest, noise } (AudioEngine.engineNodes('tv_fx') by default).
const QUIET = { rumble: 0.2, air: 0.04, voices: 0.22, pulse: 0.18, bright: 0.85 };
const LOUD = { rumble: 0.75, air: 0.22, voices: 0.85, pulse: 0.38, bright: 1.25 };
function liveNodes(opts, category) {
  const AE = globalThis.AudioEngine;
  return opts.ctx ? opts : (AE?.engineNodes ? AE.engineNodes(category) : null);
}
export function crowdBed(opts = {}) {
  const eng = liveNodes(opts, 'tv_fx');
  if (!eng || !eng.ctx) return null;
  const c = eng.ctx, nbuf = eng.noise || null, t0 = c.currentTime;
  const out = c.createGain(); out.gain.value = 0;
  const duck = c.createGain(); duck.gain.value = 1;
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
  const band = (source, type, hz, q, pan = 0) => {
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = hz; f.Q.value = q;
    const g = c.createGain(); g.gain.value = 0;
    let tail = source.connect(f).connect(g);
    if (pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; tail = tail.connect(p); }
    tail.connect(out);
    return { f, g };
  };
  const lfo = (hz, target) => {
    const o = c.createOscillator(); o.frequency.value = hz;
    const g = c.createGain(); g.gain.value = 0;
    o.connect(g).connect(target); o.start(t0); nodes.push(o);
    return g;
  };
  const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 150; hp.Q.value = 0;
  src(0.17, 0.94).connect(hp);
  const rumble = band(hp, 'lowpass', 700, 0);
  const airs = [band(src(0.63, 1.06), 'bandpass', 1150, 0.6, -0.6), band(src(1.41, 0.97), 'bandpass', 1220, 0.6, 0.6)];
  const n3 = src(1.09, 1.0);
  const voicesB = [[520, 7, -0.3], [930, 8, 0.35], [1650, 9, 0]].map(([hz, q, pan]) => band(n3, 'bandpass', hz, q, pan));
  const pulses = [
    lfo(0.37, rumble.g.gain), lfo(1.13, rumble.g.gain),
    lfo(0.61, airs[0].g.gain), lfo(2.3, airs[1].g.gain),
    ...voicesB.map((v, k) => lfo(0.29 + k * 0.53, v.g.gain)),
  ];
  let level = 0;
  const mix = (k, x) => QUIET[k] + (LOUD[k] - QUIET[k]) * x;
  function apply(at, tc) {
    const set = (p, v) => { p.cancelScheduledValues(at); p.setTargetAtTime(v, at, tc); };
    const pulse = mix('pulse', level);
    set(rumble.g.gain, mix('rumble', level));
    airs.forEach((a) => { set(a.g.gain, mix('air', level)); set(a.f.frequency, 1150 * mix('bright', level)); });
    voicesB.forEach((v) => set(v.g.gain, mix('voices', level)));
    pulses.forEach((p, k) => set(p.gain, (k < 2 ? mix('rumble', level) : k < 4 ? mix('air', level) : mix('voices', level)) * pulse));
  }
  const now = (at) => (at != null ? at : c.currentTime);
  const api = {
    start(at) { const t = now(at); out.gain.cancelScheduledValues(t); out.gain.setValueAtTime(out.gain.value, t); out.gain.setTargetAtTime(1, t, 0.35); apply(t, 0.3); return api; },
    // up fast (a crowd gets up for a play at once) and down slowly
    setLevel(x, at) {
      const v = Math.max(0, Math.min(1, +x || 0));
      if (Math.abs(v - level) < 0.02) return api;
      const up = v > level;
      level = v; apply(now(at), up ? 0.12 : 0.6);
      return api;
    },
    get level() { return level; },
    duck(db = 4, secs = 0.6, at) {
      const t = now(at), g = Math.pow(10, -db / 20);
      duck.gain.cancelScheduledValues(t); duck.gain.setTargetAtTime(g, t, 0.05); duck.gain.setTargetAtTime(1, t + secs, 0.35);
      return api;
    },
    stop(at) {
      const t = now(at);
      out.gain.cancelScheduledValues(t); out.gain.setTargetAtTime(0, t, 0.25);
      for (const n of nodes) { try { n.stop(t + 1.6); } catch { /* already stopped */ } }
      return api;
    },
    _nodes: () => nodes.length,
  };
  return api;
}

// ═══ THE PARK'S AIR ═════════════════════════════════════════════════════════════
// What a ballpark inside the Curtain sounds like when nobody's cheering: the Curtain's hum past
// left field (50 Hz and its partials, a slow beat between them), the light towers' buzz once
// they're on, the city's traffic as a low rumble over the stands, and the weather: wind over
// the Curtain and rain on the roof. Built once and steered with set({ night, wind, rain }), each
// 0 to 1.
export function parkBed(opts = {}) {
  const eng = liveNodes(opts, 'tv_fx');
  if (!eng || !eng.ctx) return null;
  const c = eng.ctx, nbuf = eng.noise || null, t0 = c.currentTime;
  const out = c.createGain(); out.gain.value = 0;
  out.connect(opts.dest || eng.bus || c.destination);
  const nodes = [];
  const gain = (v = 0) => { const g = c.createGain(); g.gain.value = v; g.connect(out); return g; };
  const osc = (type, hz, to) => { const o = c.createOscillator(); o.type = type; o.frequency.value = hz; o.connect(to); o.start(t0); nodes.push(o); return o; };
  const noiseSrc = (offset, rate) => { const s = c.createBufferSource(); if (nbuf) s.buffer = nbuf; s.loop = true; s.playbackRate.value = rate; s.start(t0, offset); nodes.push(s); return s; };
  const filt = (type, hz, q) => { const f = c.createBiquadFilter(); f.type = type; f.frequency.value = hz; f.Q.value = q; return f; };
  // the Curtain: always there, just under hearing
  const hum = gain(0.012);
  osc('sine', 50, hum); osc('sine', 100.3, hum); osc('sine', 150.1, hum);
  // the towers: a mains buzz, bright, only with the lights on
  const buzzG = gain(0);
  osc('sawtooth', 120, filt('bandpass', 2400, 3)).connect(buzzG);
  // the city: a rumble that never stops
  const traffic = gain(0.05);
  noiseSrc(0.31, 0.5).connect(filt('lowpass', 240, 0.7)).connect(traffic);
  // the weather
  const windF = filt('bandpass', 500, 0.9), windG = gain(0);
  noiseSrc(0.83, 0.8).connect(windF).connect(windG);
  const gust = c.createOscillator(); gust.frequency.value = 0.09; const gustG = c.createGain(); gustG.gain.value = 260;
  gust.connect(gustG).connect(windF.frequency); gust.start(t0); nodes.push(gust);
  const rainG = gain(0);
  noiseSrc(1.27, 1.1).connect(filt('highpass', 2200, 0.5)).connect(filt('lowpass', 7500, 0.5)).connect(rainG);
  const set = (p, v, at, tc = 0.8) => { p.cancelScheduledValues(at); p.setTargetAtTime(v, at, tc); };
  const api = {
    start(at) { const t = at ?? c.currentTime; set(out.gain, 1, t, 1); return api; },
    set({ night = 0, wind = 0, rain = 0 } = {}, at) {
      const t = at ?? c.currentTime;
      set(buzzG.gain, 0.006 * night, t); set(windG.gain, 0.09 * wind, t); set(rainG.gain, 0.07 * rain, t);
      return api;
    },
    stop(at) {
      const t = at ?? c.currentTime;
      set(out.gain, 0, t, 0.3);
      for (const n of nodes) { try { n.stop(t + 1.8); } catch { /* already stopped */ } }
      return api;
    },
    _nodes: () => nodes.length,
  };
  return api;
}

// ── the 2-D view's nine, by the names it plays them by ─────────────────────────
export const DEADBALL_SFX = Object.freeze({
  mitt: BY_ID.get('db-mitt'), crack: BY_ID.get('db-crack'), whiff: BY_ID.get('db-whiff'), glove: BY_ID.get('db-glove'),
  base: BY_ID.get('db-sting-base'), run: BY_ID.get('db-sting-run'), homer: BY_ID.get('db-sting-homer'),
  strikeout: BY_ID.get('db-sting-k'), out: BY_ID.get('db-sting-out'),
});

// Into the catalog, so the dev panel lists and edits the bank, and onto the global for a plain
// script (the dev panel's sound board) to find.
globalThis.SFXCatalog?.addBank?.(BUILTINS, 'deadball', 'Deadball (KSAB broadcast)');
globalThis.DeadballSfx = { BUILTINS, variant, patch, ids, EVENTS, eventFor, MIX, layerOf, DETAIL, tierAllows, VOICES, CALLS, crowdBed, parkBed, DEADBALL_SFX };
