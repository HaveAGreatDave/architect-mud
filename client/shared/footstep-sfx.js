// FOOTSTEPS: the walker's own steps on the street on foot in GLASS (freelook-view.js).
//
// One SIREN patch per surface (buildLayer's layer schema, client/shared/audio-engine.js), and two
// for water on top of it: a wet slap in rain and a puddle now and then. A step is a heel and a
// lighter toe after it, each surface with its own body: concrete is a dull tap, the lane's
// asphalt darker with grit, the kit's chrome walkway rings, a bridge deck's grating rings hollow
// and rattles, planking knocks, dirt crunches and grass brushes.
//
// The stepper counts stride, not time: a step plays each time the walker has covered one stride,
// so the rate follows the speed. A run's stride is longer, and its steps are louder and brighter
// (variant()'s intensity); a sneak's are short, quiet and dull. Every take is seeded from the
// step count, so no two neighbouring steps sound the same and a seed is the same take in a test.
//
// The surface is read from the map cell GLASS already holds (surfaceOf): the street kit's lane and
// walkways, the cell's biome and its dirt flag, and whether you're up on a bridge deck. Nothing is
// asked of the server. scripts/audio/footstep-smoke.mjs renders every patch and drives the stepper.

function rngFrom(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function tone(o) {
  const L = { waveform: o.wave || 'sine', freq: o.hz, gain: o.gain ?? 0.1,
    adsr: { a: o.a ?? 0.0008, d: o.d ?? 0.04, s: 0, r: o.r ?? 0.02, curve: 'exp' } };
  if (o.mod) L.fm = { ratio: o.mod, index: o.index ?? 1, time: (o.d ?? 0.04) * 0.5, indexEnd: o.indexEnd ?? 0.1 };
  if (o.to) L.pitchBend = { to: o.to, time: (o.d ?? 0.04) * 0.7 };
  if (o.filter) L.filter = o.filter;
  if (o.delay) L.delay = o.delay;
  return L;
}
function noise(o) {
  const L = { waveform: 'noise', noiseMix: 1, gain: o.gain ?? 0.08,
    filter: { type: o.type || 'bandpass', freq: o.hz ?? 2000, q: o.q ?? 0.8 },
    adsr: { a: o.a ?? 0.0008, d: o.d ?? 0.02, s: 0, r: o.r ?? 0.015, curve: 'exp' } };
  if (o.to) { L.filter.to = o.to; L.filter.time = o.d ?? 0.02; }
  if (o.colour) L.noise = o.colour;
  if (o.delay) L.delay = o.delay;
  return L;
}
// the toe after the heel: the same body, quieter, a little later
const TOE = 0.034;
const toe = (layers, g = 0.45) => layers.map((l) => ({ ...l, gain: +(l.gain * g).toFixed(4), delay: +((l.delay || 0) + TOE).toFixed(4) }));
const step = (heel, extra = []) => [...heel, ...toe(heel), ...extra];

const STEP = { pitch: 0.1, gain: 0.25, env: 0.2 };
function def(id, name, layers) {
  layers.forEach((l, k) => { if (l.noiseMix > 0) l.noiseSeed = 307 + k * 41; });
  const reach = Math.max(...layers.map((l) => (l.delay ?? 0) + l.adsr.a + l.adsr.d));
  return { id, name, group: 'footsteps', category: 'sfx', priority: 1, vary: STEP,
    config: { duration: +(reach * 0.25).toFixed(4), layers } };
}

export const SURFACES = Object.freeze(['pave', 'road', 'chrome', 'grate', 'wood', 'dirt', 'grass']);

export const BUILTINS = [
  def('fs-pave', 'Footstep: concrete', step([
    noise({ type: 'lowpass', hz: 1900, q: 0.6, d: 0.018, r: 0.012, gain: 0.22 }),
    tone({ hz: 150, to: 115, d: 0.028, r: 0.015, gain: 0.11 }),
  ], [noise({ hz: 3400, q: 0.9, d: 0.012, r: 0.008, gain: 0.05, delay: 0.05 })])),
  def('fs-road', 'Footstep: asphalt', step([
    noise({ type: 'lowpass', hz: 1150, q: 0.6, d: 0.022, r: 0.014, gain: 0.24 }),
    tone({ hz: 120, to: 95, d: 0.03, r: 0.016, gain: 0.12 }),
    noise({ hz: 4600, q: 1.6, d: 0.008, r: 0.006, gain: 0.06, delay: 0.004 }),
  ])),
  def('fs-chrome', 'Footstep: chrome walkway', step([
    noise({ hz: 2700, q: 1.1, d: 0.014, r: 0.01, gain: 0.16 }),
    tone({ hz: 640, mod: 2.76, index: 1.3, d: 0.09, r: 0.05, gain: 0.05 }),
    tone({ hz: 1870, d: 0.06, r: 0.03, gain: 0.025 }),
    tone({ hz: 170, to: 130, d: 0.025, r: 0.012, gain: 0.08 }),
  ], [])),
  def('fs-grate', 'Footstep: bridge grating', step([
    noise({ hz: 1900, q: 2, d: 0.03, r: 0.015, gain: 0.15 }),
    tone({ hz: 360, mod: 1.41, index: 2, d: 0.15, r: 0.08, gain: 0.07 }),
    tone({ hz: 95, to: 75, d: 0.06, r: 0.03, gain: 0.1 }),
  ], [noise({ hz: 2600, q: 2.5, d: 0.012, r: 0.01, gain: 0.07, delay: 0.019 }), noise({ hz: 2300, q: 2.5, d: 0.01, r: 0.01, gain: 0.05, delay: 0.061 })])),
  def('fs-wood', 'Footstep: planking', step([
    noise({ type: 'lowpass', hz: 1500, q: 0.7, d: 0.02, r: 0.012, gain: 0.15 }),
    tone({ hz: 210, to: 168, d: 0.05, r: 0.025, gain: 0.15 }),
    tone({ hz: 520, d: 0.022, r: 0.012, gain: 0.05 }),
  ])),
  def('fs-dirt', 'Footstep: dirt', step([
    noise({ hz: 2300, q: 0.9, d: 0.034, r: 0.016, gain: 0.22 }),
    noise({ type: 'lowpass', hz: 600, q: 0.5, d: 0.022, r: 0.012, gain: 0.17 }),
    noise({ hz: 3800, q: 1.4, d: 0.006, r: 0.004, gain: 0.08, delay: 0.012 }),
    noise({ hz: 3300, q: 1.4, d: 0.006, r: 0.004, gain: 0.06, delay: 0.024 }),
  ], [])),
  def('fs-grass', 'Footstep: grass', step([
    noise({ hz: 1400, q: 0.6, d: 0.06, r: 0.03, gain: 0.19, colour: 'pink' }),
    noise({ type: 'lowpass', hz: 420, q: 0.5, d: 0.03, r: 0.015, gain: 0.12 }),
  ], [noise({ type: 'highpass', hz: 4200, q: 0.5, d: 0.04, r: 0.02, gain: 0.02, delay: 0.02 })])),
  // wet ground in rain: a thin slap of water over the step
  def('fs-wet', 'Footstep: wet', [
    noise({ type: 'highpass', hz: 3000, q: 0.6, d: 0.035, r: 0.02, gain: 0.07 }),
    noise({ hz: 1300, to: 2500, q: 1.4, d: 0.045, r: 0.02, gain: 0.06, delay: 0.004 }),
  ]),
  // a foot in a puddle: a splash with a plip in it
  def('fs-puddle', 'Footstep: puddle', [
    noise({ hz: 900, to: 2700, q: 1.2, d: 0.09, r: 0.05, gain: 0.15 }),
    noise({ type: 'highpass', hz: 3500, q: 0.5, d: 0.06, r: 0.04, gain: 0.07, delay: 0.012 }),
    tone({ hz: 700, to: 1400, d: 0.04, r: 0.02, gain: 0.03, delay: 0.02 }),
  ]),
];
const BY_ID = new Map(BUILTINS.map((d) => [d.id, d]));
// A patch as the dev panel has it (an override saved there wins; null when muted there), else the default.
export const patch = (id) => (globalThis.SFXCatalog?.get ? globalThis.SFXCatalog.get(id) : BY_ID.get(id)) ?? null;

// A take: the whole cue moved by one pitch factor, its level and envelope, inside `vary`, with its
// noise from another place. `intensity` 0..1.2: a sneak (0.3) is quiet and dull, a run (1.15)
// loud, bright and tight.
export function variant(d, seed, intensity = 1) {
  if (!d) return null;
  const r = rngFrom(seed), v = d.vary || STEP;
  const jit = (s) => 1 + (r() * 2 - 1) * s;
  const inten = Math.max(0, Math.min(1.2, intensity));
  const pf = jit(v.pitch), gf = jit(v.gain) * (0.1 + 0.9 * inten), ef = jit(v.env) * (1.15 - 0.2 * inten);
  const bright = 0.55 + 0.45 * inten;
  const nb = (seed * 2654435761) >>> 0;
  return { ...d, config: { ...d.config, layers: d.config.layers.map((L, n) => {
    const o = { ...L, gain: (L.gain ?? 0.1) * gf };
    if (o.freq) o.freq = L.freq * pf;
    if (L.pitchBend?.to) o.pitchBend = { ...L.pitchBend, to: L.pitchBend.to * pf };
    if (L.fm?.index != null) o.fm = { ...L.fm, index: L.fm.index * bright };
    if (L.filter?.freq) o.filter = { ...L.filter, freq: Math.min(16000, L.filter.freq * pf * bright), ...(L.filter.to ? { to: Math.min(16000, L.filter.to * pf * bright) } : {}) };
    if (L.adsr) o.adsr = { ...L.adsr, d: L.adsr.d * ef, r: L.adsr.r * ef };
    if (L.noiseMix > 0) o.noiseSeed = (nb + n * 7919) % 100003;
    return o;
  }) } };
}

// ── the ground underfoot ─────────────────────────────────────────────────────
// `c` is the map cell (plugins/flight/state.js's window cell), (lx, ly) where you stand on it in
// tiles from its centre, `laneHalf` the street lane's half width in tiles, `deck` true up on a
// footbridge. Generic: biomes and flags, never a place.
const BIOME = {
  park: 'grass', parkland: 'grass', forest: 'grass', marsh: 'grass', deadwood: 'dirt',
  badlands: 'dirt', scrub: 'dirt', redrock: 'dirt', ash: 'dirt', hardpan: 'dirt', alkali: 'dirt', plateau: 'dirt',
  basalt: 'dirt', sinter: 'dirt', ruins: 'dirt', oldcoldwater: 'dirt',
  asphalt: 'road', airport: 'road', pier: 'wood', docks: 'wood',
};
export function surfaceOf(c, lx = 0, ly = 0, { laneHalf = 0.12, deck = false } = {}) {
  if (deck) return 'grate';
  if (!c) return 'pave';
  if (c.ft === 'dust') return 'dirt';
  if (c.road && !c.bt && !c.mark) {
    const rd = String(c.rd || 'nesw'), ns = /[ns]/.test(rd), ew = /[ew]/.test(rd);
    const inLane = (ns && Math.abs(lx) < laneHalf) || (ew && Math.abs(ly) < laneHalf);
    if (inLane) return 'road';
    return c.sc ? 'chrome' : 'pave';   // the street kit's raised chrome walkways, else a plain pavement
  }
  if (c.bt) return 'pave';             // a building's own forecourt
  return BIOME[c.biome] || 'pave';
}
export const wetWeather = (wx) => /rain|storm|drizzle|shower|acid|sleet/.test(String(wx || '').toLowerCase());

// How much plays at each Sound Detail (client/shared/settings.js sfxDetail): nothing at off, the
// steps and the water at limited (the default) and full.
export const DETAIL = Object.freeze({ step: 'limited', wet: 'limited' });
export const tierAllows = (detail, what) => {
  const rank = { off: 0, limited: 1, full: 2 };
  return (rank[detail] ?? 1) >= (rank[DETAIL[what]] ?? 1);
};

// gait: metres a step, and how hard it lands
export const GAIT = Object.freeze({
  sneak: { stride: 0.55, intensity: 0.3, gain: 0.35 },
  walk: { stride: 0.75, intensity: 0.7, gain: 0.55 },
  run: { stride: 1.15, intensity: 1.15, gain: 0.9 },
});
export const RUN_MS = 2.6;     // over this many metres a second you're running
const PUDDLE = 0.18;           // of wet steps on hard ground, how many find a puddle

// The stepper. `play(def, gain)` sounds a take (AudioEngine.playSfx in the client). Call
// tick(dt, metres, ctx) every frame with the ground distance walked this frame and
// ctx = { surface, wet, crouched, detail }. Standing still (or a jump) resets the stride, so the
// first step after a stop lands at once.
export function createFootsteps({ play, seed = 1 } = {}) {
  let acc = 0, n = 0, still = 0, speed = 0;
  const log = [];
  function tick(dt, metres, ctx = {}) {
    if (!(dt > 0)) return null;
    if (!(metres > 0.0005) || metres > 3) { still += dt; if (still > 0.25) acc = 0; speed *= 0.5; return null; }
    still = 0;
    speed += (metres / dt - speed) * Math.min(1, dt * 8);
    const gait = ctx.crouched ? 'sneak' : speed > RUN_MS ? 'run' : 'walk', G = GAIT[gait];
    // a stopped walker's first step lands as soon as they move
    if (acc === 0) acc = G.stride;
    acc += metres;
    if (acc < G.stride) return null;
    acc -= G.stride;
    if (acc > G.stride) acc = 0;
    return fire(gait, ctx);
  }
  function fire(gait, ctx) {
    if (!tierAllows(ctx.detail, 'step')) return null;
    const G = GAIT[gait], s = (seed * 7919 + (++n) * 104729) >>> 0;
    const surface = SURFACES.includes(ctx.surface) ? ctx.surface : 'pave';
    const out = { gait, surface, water: null };
    const d = patch(`fs-${surface}`);
    if (d) play(variant(d, s, G.intensity), G.gain);
    if (ctx.wet && tierAllows(ctx.detail, 'wet')) {
      const soft = surface === 'grass' || surface === 'dirt';
      const puddle = !soft && surface !== 'grate' && rngFrom(s ^ 0x9e37)() < PUDDLE;
      out.water = puddle ? 'puddle' : 'wet';
      const w = patch(puddle ? 'fs-puddle' : 'fs-wet');
      if (w) play(variant(w, s ^ 0x51ed, G.intensity), G.gain * (soft ? 0.6 : 1));
    }
    log.push(out);
    if (log.length > 64) log.shift();
    return out;
  }
  return { tick, log, get speed() { return speed; } };
}
