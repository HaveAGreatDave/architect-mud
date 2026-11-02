// SFX LIB: the building blocks a sound effect is made of, as SIREN layers.
//
//   import { cue, click, thump, crack, ring, whoosh, ... } from '../audio/sfx-lib.mjs';
//
// A real sound is a few things at once: a TRANSIENT (the first few milliseconds: a click, a
// crack, a snap), a BODY (what it is: a thump, a ring, a buzz), and a TAIL (what it leaves: a
// rattle, a decay, the room). The one-oscillator presets this replaced were a body alone, which
// is why they read as beeps. Each function here is one well-made layer, or a few that belong
// together, with defaults that already sound right; a cue is a handful of them. The reasons
// and the recipes are in docs/reference/sfx-craft.md.
//
// Every function takes `at` (seconds after the cue fires, the layer's `delay`) and `level` (its
// gain before the cue is levelled). Pure data in, plain layer objects out: nothing here plays.
// scripts/content/build-sfx.mjs levels each cue to its category's loudness target.

const exp = (a, d, s = 0, r) => ({ a, d, s, r: r ?? Math.max(0.01, d * 0.5), curve: 'exp' });
const at0 = (at) => (at ? { delay: +at.toFixed(4) } : {});
// seeded, so a cue that scatters (a rattle, a glitch) is the same cue every build
export function rng(seed = 1) {
  let a = typeof seed === 'string' ? [...seed].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0 : seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
let seedN = 101;
const nextSeed = () => (seedN = (seedN * 1103515245 + 12345) % 2147483647);

// ── transients ──────────────────────────────────────────────────────────────
// A click: a few milliseconds of band-passed noise. The edge of almost everything.
export const click = ({ at = 0, freq = 3000, q = 1.2, decay = 0.006, level = 0.3 } = {}) => ({
  waveform: 'noise', noiseMix: 1, noiseSeed: nextSeed(), gain: level, ...at0(at),
  filter: { type: 'bandpass', freq, q }, adsr: exp(0.0003, decay, 0, decay),
});
// A crack: a longer, brighter noise burst. A slap, a snap, a shot's front, a blade landing.
export const crack = ({ at = 0, freq = 2500, q = 0.8, decay = 0.04, level = 0.4, colour = 'white' } = {}) => ({
  waveform: 'noise', noiseMix: 1, noise: colour, noiseSeed: nextSeed(), gain: level, ...at0(at),
  filter: { type: 'bandpass', freq, q }, adsr: exp(0.0005, decay),
});
// A tick: a tiny pitched click, for a relay, a key, a switch. Tonal enough to read as a part.
export const tick = ({ at = 0, freq = 2400, decay = 0.015, level = 0.2 } = {}) => ({
  waveform: 'triangle', freq, gain: level, ...at0(at),
  fm: { ratio: 2.71, index: 1.5, indexEnd: 0.1, time: decay }, adsr: exp(0.0004, decay),
});

// ── bodies ──────────────────────────────────────────────────────────────────
// A thump: a sine that drops onto its pitch. A body, a kick, a door, a fist. `from` is how far
// above `freq` it starts; the drop is most of what makes it read as an impact. Add a `knock`
// over it so it plays on a laptop, which can't reproduce the thump alone.
export const thump = ({ at = 0, freq = 70, from = 3, drop = 0.04, decay = 0.25, level = 0.6, wave = 'sine' } = {}) => ({
  waveform: wave, freq: +(freq * from).toFixed(2), gain: level, ...at0(at),
  pitchBend: { to: freq, time: drop }, adsr: exp(0.0008, decay),
});
// A knock: the audible half of a thump, 150-600 Hz: wood, a hollow body, a fist on a door.
export const knock = ({ at = 0, freq = 220, decay = 0.07, level = 0.35, q = 1.8 } = {}) => [
  { waveform: 'triangle', freq: +(freq * 1.6).toFixed(2), gain: level * 0.7, ...at0(at), pitchBend: { to: freq, time: 0.012 }, adsr: exp(0.0005, decay) },
  { waveform: 'noise', noiseMix: 1, noiseSeed: nextSeed(), gain: level * 0.5, ...at0(at), filter: { type: 'bandpass', freq: freq * 2.2, q }, adsr: exp(0.0004, decay * 0.6) },
];
// A sub: the low end under a big thing, felt more than heard. Never alone.
export const sub = ({ at = 0, freq = 45, decay = 0.4, level = 0.4, from = 1.6 } = {}) => thump({ at, freq, from, drop: 0.06, decay, level });
// A struck object: decaying partials at the object's ratios (docs: fm-sound-matching.md has
// tables). `base` the fundamental; `decay` the lowest partial's, higher ones shorter.
export const RATIOS = {
  metal: [1, 2.76, 5.4, 8.93, 13.34], bar: [1, 2.76, 5.4, 8.93], glass: [1, 2.32, 4.25, 6.63, 9.38],
  wood: [1, 2.57, 4.64, 6.98], bell: [0.5, 1, 1.19, 1.5, 2, 2.5, 3], plate: [1, 1.59, 2.14, 2.3, 2.65, 2.92, 3.16, 3.5],
};
export const ring = ({ at = 0, base = 800, ratios = RATIOS.metal, decay = 0.6, level = 0.4, hardness = 0.8, strike = 0.15, tilt = 0.7 } = {}) => ({
  ...at0(at), gain: level,
  modes: {
    hardness, strike,
    partials: ratios.slice(0, 8).map((r, i) => ({ freq: +(base * r).toFixed(2), decay: +(decay / Math.pow(1 + r, 0.55)).toFixed(4), gain: +Math.pow(tilt, i).toFixed(4) })),
  },
});
// An FM ring: metal, glass, a bell, a blade's edge; the index falls as it rings, which is what
// reads as struck. Ratio 1.41 is Chowning's bell, 3.5 the glass, 2.37 clangs.
export const fmRing = ({ at = 0, freq = 1200, ratio = 1.41, index = 4, indexEnd = 0.3, decay = 0.5, level = 0.3, wave = 'sine' } = {}) => ({
  waveform: wave, freq, gain: level, ...at0(at),
  fm: { ratio, index, indexEnd, time: decay * 0.6 }, adsr: exp(0.0006, decay),
});
// A buzz: mains hum and its harmonics, through a band so it's a buzz rather than a tone.
export const buzz = ({ at = 0, freq = 120, dur = 0.3, level = 0.25, cutoff = 2200, q = 1.5, rough = 0.5 } = {}) => [
  { waveform: 'sawtooth', freq, gain: level, ...at0(at), filter: { type: 'bandpass', freq: cutoff, q }, drive: 0.3,
    adsr: { a: 0.004, d: dur, s: 0.8, r: 0.05 },
    mods: [{ id: 'rf', type: 'rand', rate: 90, seed: nextSeed(), to: [{ param: 'amp', amount: rough * 0.6 }] }] },
  { waveform: 'square', freq: freq * 2, gain: level * 0.35, ...at0(at), filter: { type: 'lowpass', freq: cutoff * 1.5, q: 0.7 }, adsr: { a: 0.004, d: dur, s: 0.8, r: 0.05 } },
];
// A motor: a saw through a low-pass, wobbling, spinning up or down from `freq` to `to`.
export const servo = ({ at = 0, freq = 120, to = null, dur = 0.4, level = 0.2, cutoff = 900, wobble = 18 } = {}) => ({
  waveform: 'sawtooth', freq, gain: level, ...at0(at), filter: { type: 'lowpass', freq: cutoff, q: 2 },
  ...(to ? { pitchBend: { to, time: dur * 0.8 } } : {}), vibrato: { rate: 23, depth: wobble },
  adsr: { a: Math.min(0.05, dur * 0.2), d: dur * 0.6, s: 0.7, r: Math.min(0.15, dur * 0.4) },
});
// An arc: square FM at a clanging ratio, thrashing: a spark, a short, a taser.
export const zap = ({ at = 0, freq = 700, to = null, dur = 0.12, level = 0.25, ratio = 2.37, index = 6 } = {}) => ({
  waveform: 'square', freq, gain: level, ...at0(at), filter: { type: 'highpass', freq: 300, q: 0.7 },
  ...(to ? { pitchBend: { to, time: dur } } : {}),
  fm: { ratio, index, indexEnd: index * 0.4, time: dur },
  mods: [{ id: 'th', type: 'rand', rate: 140, seed: nextSeed(), to: [{ param: 'pitch', amount: 400 }] }],
  adsr: { a: 0.001, d: dur, s: 0, r: 0.02, curve: 'exp' },
});

// ── movement and tails ──────────────────────────────────────────────────────
// A whoosh: noise through a band that sweeps from `from` to `to` Hz. A swing, a slide, a sweep.
export const whoosh = ({ at = 0, from = 400, to = 3000, dur = 0.25, q = 1.4, level = 0.35, colour = 'pink' } = {}) => ({
  waveform: 'noise', noiseMix: 1, noise: colour, noiseSeed: nextSeed(), gain: level, ...at0(at),
  filter: { type: 'bandpass', freq: from, q },
  adsr: { a: dur * 0.55, d: dur * 0.45, s: 0, r: 0.04, curve: 'exp' },
  mods: [{ id: 'sw', type: 'env', a: dur * 0.7, d: dur * 0.3, s: 1, r: 0.05, to: [{ param: 'filter.cutoff', amount: Math.round(1200 * Math.log2(to / from)) }] }],
});
// A tail: low-passed noise dying away. The room, the dust, what a big thing leaves.
export const tail = ({ at = 0.01, decay = 0.4, freq = 2000, level = 0.15, colour = 'pink' } = {}) => ({
  waveform: 'noise', noiseMix: 1, noise: colour, noiseSeed: nextSeed(), gain: level, ...at0(at), width: 0.6,
  filter: { type: 'lowpass', freq, q: 0.6 }, adsr: exp(0.004, decay),
});
// A rumble: brown noise, low-passed. Under explosions, engines, the ground.
export const rumble = ({ at = 0, freq = 120, decay = 0.6, level = 0.3 } = {}) => ({
  waveform: 'noise', noiseMix: 1, noise: 'brown', noiseSeed: nextSeed(), gain: level, ...at0(at),
  filter: { type: 'lowpass', freq, q: 0.7 }, adsr: exp(0.01, decay),
});
// A rattle: a few clicks scattered after each other. Debris, a mechanism, a chain, a shell case.
export const rattle = ({ at = 0, count = 4, spacing = 0.02, jitter = 0.5, freq = 2600, spread = 0.4, level = 0.2, decay = 0.012, seed = 7 } = {}) => {
  const r = rng(seed), out = [];
  let t = at;
  for (let i = 0; i < count; i++) {
    out.push(click({ at: t, freq: freq * (1 + (r() * 2 - 1) * spread), q: 2, decay: decay * (0.6 + r() * 0.8), level: level * (1 - i / (count + 1)) * (0.7 + r() * 0.5) }));
    t += spacing * (1 + (r() * 2 - 1) * jitter);
  }
  return out;
};

// ── signals ─────────────────────────────────────────────────────────────────
// A blip: a UI tone that isn't a test tone. A triangle with a little glassy FM, a pitch move,
// and a click on the front so it has an edge. `to` bends it; `bell` is how glassy.
export const blip = ({ at = 0, freq = 1200, to = null, dur = 0.06, level = 0.3, bell = 0.35, wave = 'triangle', edge = 0.15 } = {}) => [
  { waveform: wave, freq, gain: level, ...at0(at),
    ...(to ? { pitchBend: { to, time: dur * 0.5 } } : {}),
    ...(bell > 0 ? { fm: { ratio: 3.5, index: bell * 2, indexEnd: bell * 0.2, time: dur } } : {}),
    adsr: { a: 0.002, d: dur, s: 0, r: Math.max(0.02, dur * 0.6), curve: 'exp' } },
  { waveform: 'sine', freq: (to || freq) * 2, gain: level * 0.18, ...at0(at), adsr: exp(0.002, dur * 0.6) },
  ...(edge > 0 ? [click({ at, freq: Math.min(9000, freq * 3), q: 1.5, decay: 0.003, level: level * edge })] : []),
];
// A glitch: a burst of short square blips at scattered pitches. Data, a hack, a fault.
export const glitch = ({ at = 0, count = 6, span = 0.12, lo = 500, hi = 3500, level = 0.15, seed = 3 } = {}) => {
  const r = rng(seed), out = [];
  for (let i = 0; i < count; i++) {
    const f = lo * Math.pow(hi / lo, r()), d = 0.008 + r() * 0.02;
    out.push({ waveform: r() < 0.5 ? 'square' : 'sawtooth', freq: +f.toFixed(1), gain: level * (0.6 + r() * 0.5), ...at0(at + (span * i) / count + r() * span / count * 0.5),
      filter: { type: 'lowpass', freq: Math.min(9000, f * 4), q: 0.8 }, adsr: { a: 0.0008, d: d, s: 0, r: 0.006 } });
  }
  return out;
};
// A chime: a few blips in a row, each ringing longer. A notification, a confirm.
export const chime = ({ at = 0, notes = [1319, 1976], gap = 0.08, dur = 0.25, level = 0.3, bell = 0.6 } = {}) =>
  notes.flatMap((f, i) => blip({ at: at + i * gap, freq: f, dur: dur * (1 + i * 0.4), level: level * (1 - i * 0.12), bell, edge: 0.1 }));

// ── textures for beds (held, so they run as long as the bed does) ───────────────
// Air: filtered noise that moves, by a slow random on the cutoff and the level. Wind, rain's
// hiss, ventilation, a room's tone.
export const air = ({ colour = 'pink', type = 'bandpass', freq = 1200, q = 0.7, level = 0.3, move = 600, sway = 0.2, rate = 0.25, width = 0.8, seed } = {}) => ({
  waveform: 'noise', noiseMix: 1, noise: colour, noiseSeed: nextSeed(), gain: level, width,
  filter: { type, freq, q }, adsr: { a: 1.2, d: 0.2, s: 1, r: 1.2 },
  mods: [{ id: 'mv', type: 'rand', rate, smooth: true, seed: seed ?? nextSeed(), to: [{ param: 'filter.cutoff', amount: move }, { param: 'amp', amount: sway }] }],
});
// Crackle: noise gated into sparse bursts (`density` the share of steps that sound, `rate` the
// steps a second). Fire, static, rain on a roof, a Geiger counter.
export const crackle = ({ colour = 'white', freq = 3000, q = 0.9, level = 0.25, rate = 70, density = 0.12, width = 0.7, seed } = {}) => ({
  waveform: 'noise', noiseMix: 1, noise: colour, noiseSeed: nextSeed(), gain: level, width,
  filter: { type: 'bandpass', freq, q }, adsr: { a: 0.5, d: 0.1, s: 1, r: 0.8 },
  mods: [{ id: 'cr', type: 'rand', rate, density, seed: seed ?? nextSeed(), to: [{ param: 'amp', amount: 1 }] }],
});
// Hum: a held tone with its harmonics, slightly unsteady. Mains, a fridge, a transformer, a fan.
export const hum = ({ freq = 60, level = 0.2, cutoff = 700, harmonics = 0.5, wobble = 3 } = {}) => [
  { waveform: 'sine', freq, gain: level * (1 - harmonics * 0.5), adsr: { a: 1, d: 0.2, s: 1, r: 1 }, vibrato: { rate: 0.3, depth: wobble } },
  { waveform: 'sawtooth', freq: freq * 2, gain: level * harmonics, filter: { type: 'lowpass', freq: cutoff, q: 1.2 }, adsr: { a: 1, d: 0.2, s: 1, r: 1 }, vibrato: { rate: 0.37, depth: wobble } },
];

// ── the cue ─────────────────────────────────────────────────────────────────
// Flattens the layers, names a waveform on every layer (the Rack writes one onto any that
// don't), and sets a default per-play variation by category: a sound that fires again and
// again shouldn't be the same samples. `duration` is the hold before release.
export const VARY = {
  ui: { pitch: 18, gain: 0.8 }, combat: { pitch: 70, time: 0.08, filter: 150, gain: 1.5 },
  environment: { pitch: 40, time: 0.06, filter: 100, gain: 1 }, cyberpunk: { pitch: 25, time: 0.04, gain: 1 },
  tv: { pitch: 12, gain: 0.5 },
};
// Seeds are renumbered from the cue's own id, so a cue's noise and random sources don't
// depend on how many cues were built before it: changing one cue never moves another.
const idHash = (id) => [...String(id)].reduce((h, c) => (Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0), 2166136261) % 1000003;
function reseed(layers, id) {
  const base = idHash(id);
  return layers.map((l, k) => {
    const o = { ...l };
    if (o.noiseSeed != null) o.noiseSeed = base + k * 7919;
    if (Array.isArray(o.mods)) o.mods = o.mods.map((m, j) => (m.seed != null ? { ...m, seed: base + k * 31 + j + 1 } : m));
    return o;
  });
}
export function cue({ id, name, category = 'misc', priority = 5, duration = 0.1, layers, vary, loop, send, retro, sparkle, duck }) {
  const flat = reseed(layers.flat(Infinity).filter(Boolean).map((l) => ({ waveform: l.modes ? 'sine' : l.noiseMix >= 1 ? 'noise' : 'sine', ...l })), id);
  const config = { duration, layers: flat };
  const v = vary === undefined ? (loop ? null : VARY[category] || null) : vary;
  if (v) config.vary = v;
  if (send != null) config.send = send;
  if (retro) config.retro = retro;
  if (sparkle) config.sparkle = sparkle;
  if (duck) config.duck = duck;
  return { id, name: name ?? id?.replace(/^(sfx|amb)_/, ''), category, priority, enabled: 1, ...(loop ? { loop: 1 } : {}), config };
}
