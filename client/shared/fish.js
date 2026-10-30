// FISH: what swims in the water, as pure functions of place and time.
//
// The sibling of birds.js one surface down. A school is never stored. Whether a cell of water holds
// one, which species it is, how many fish, how heavy each fish is and where they all are at any
// moment are worked out from the cell's coordinates, the seabed under it and the clock. The server
// and every client call the same functions, so the shadow a player casts at is the fish the server
// rolls the bite for, and nothing is sent but the time.
//
// ⚠ TIME IS HANDED IN, NEVER READ. Nothing here calls the wall clock. The server passes its own, and
// the client passes its clock plus the skew the anchor push gave it. Fish cruise at up to a metre a
// second, so a client clock three seconds off would draw them three metres from where the server
// rolls them. scripts/fish/smoke.mjs fails the file if it ever reads the clock.
//
// ⚠ THE HASH IS hn2h, NEVER frac(sin). How Math.sin rounds its last bits is up to each engine; an
// integer mix is the same in Node, every browser and GLSL, so the server and a Safari player agree
// about which fish is the big one. The seeds are offset from seabed.js's wreck hashes, or every
// school would sit on a wreck.
//
// ⚠ THE MAP IS HANDED IN. As in seabed.js, nothing here knows where the land is. Every entry point
// takes a `habitat(x, y)` function, and `habitatFor(isLand)` builds one from the seabed for a caller
// that has an isLand predicate.
//
// Units: tiles for position, in seabed.js's convention (tile i spans [i, i+1)); metres for depth and
// length; kilograms for weight; milliseconds for time; hours 0..24 for the time of day.

import { hn2h } from './landform.js';
import { SEA_TILE_M } from './sea-swell.js';
import { shoreDistance, seabedDepth, seabedMaterial, wrecksNear } from './seabed.js';

export const SCHOOL_CELL = 4;      // tiles per cell side: 28 m of water
export const SLOTS = 2;            // candidate schools per cell
export const SHADOW_R = 10;        // tiles: how far a shadow is drawn from your own hull
export const TAU = Math.PI * 2;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const frac = (v) => v - Math.floor(v);
const ramp = (v, a, b) => clamp((v - a) / (b - a), 0, 1);
// Hours apart round the clock, 0..12.
const hourGap = (a, b) => { const d = Math.abs(frac((a - b) / 24) * 24); return Math.min(d, 24 - d); };
// 1 inside [lo, hi], falling to 0 over `soft` outside it.
const inBand = (v, lo, hi, soft) => (v < lo ? ramp(v, lo - soft, lo) : v > hi ? 1 - ramp(v, hi, hi + soft) : 1);
// A seeded hash in [0, 1). Every roll in this file goes through here with its own salt.
const h2 = (a, b, salt) => hn2h(a * 31 + salt * 977, b * 17 - salt * 613);

// ── WHEN THEY FEED ─────────────────────────────────────────────────────────────────────────────
// Each is 0..1 over the hour. Kept as named curves, not per-species numbers, so a species row says
// what it does in a word and a curve is tuned in one place.
export const ACTIVE = {
  any: () => 1,
  day: (h) => ramp(h, 5.5, 8) * (1 - ramp(h, 18, 20.5)),
  night: (h) => 1 - ramp(h, 5, 7.5) * (1 - ramp(h, 18.5, 21)),
  twilight: (h) => Math.max(1 - ramp(hourGap(h, 6.5), 0.6, 2.4), 1 - ramp(hourGap(h, 19.2), 0.6, 2.6)),
  dusk: (h) => Math.max(1 - ramp(hourGap(h, 19.5), 0.8, 2.8), 1 - ramp(h, 4, 6.5) * (1 - ramp(h, 21, 23))),
};
// How much of the night it is, 0..1: what lifts a school towards the surface after dark.
export const nightness = (h) => 1 - ACTIVE.day(h);

// The year: 1 in mid-January, 0 in mid-July. `doy` is the day of the year, 1..366.
export const winterness = (doy) => 0.5 + 0.5 * Math.cos(TAU * (doy - 15) / 365);

// ── THE SPECIES ────────────────────────────────────────────────────────────────────────────────
//
// One row per species. `item` is the catch, which must be a `raw_fish` item or the fishmonger pays
// the ordinary rate (docs/proposals/fish-works.md); the smoke gate checks every one.
//
//   depth   [lo, hi] metres of water under the school (the floor, not where it swims)
//   shore   [lo, hi] tiles from the nearest land
//   floor   how much it likes each seabed material; a missing key is 0
//   wreck   how much a wreck within WRECK_R adds (1 doubles it); 'only' means nowhere else
//   active  a key of ACTIVE
//   season  'winter' to favour the cold months; absent means all year
//   light   drawn to a lamp after dark (phase 4)
//   share   how often it wins a cell it can live in, against the others that can
//   rare    the share of its cells that hold a school when it's active (0..1)
//   school  [min, max] fish
//   speed   cruising speed in m/s, which sets how long a school's loop takes
//   swim    'floor', 'mid' or 'upper': how high it holds over the floor by day
//   rise    how far it comes up at night, as a share of the way to the surface
//   kg      [min, mode, max]
//   len     body length against weight, 1 for an ordinary fish (an eel is long, a skate is wide)
//   shape   the shadow's silhouette for gl/fish-shadows.js
//   difficulty, fight: the reel stage (fishing.js generateFight and the fight styles)
//   wary    metres: how close a hull or a splash gets before the school spooks
//   bait    a bait sub-tag the catch needs, as shore fishing's bait-gated catches do
export const SPECIES = {
  sludge_carp: {
    name: 'sludge carp', item: 'item_sludge_carp',
    depth: [0.5, 6], shore: [0, 6], floor: { silt: 1, debris: 1.2, sand: 0.4 }, wreck: 0,
    active: 'any', share: 1.2, rare: 0.7, school: [4, 9], speed: 0.3, swim: 'floor', rise: 0.2,
    kg: [0.5, 0.9, 2], len: 1, shape: 'round', difficulty: 2, fight: 'steady', wary: 4,
  },
  carp: {
    name: 'carp', item: 'item_fresh_catch',
    depth: [2, 10], shore: [0, 9], floor: { sand: 1, silt: 0.8 }, wreck: 0,
    active: 'day', share: 1, rare: 0.6, school: [3, 7], speed: 0.35, swim: 'floor', rise: 0.1,
    kg: [1, 1.8, 4], len: 1, shape: 'round', difficulty: 3, fight: 'steady', wary: 6,
  },
  razorgill: {
    name: 'razorgill', item: 'item_razorgill',
    depth: [8, 20], shore: [2, 16], floor: { rock: 1.4, sand: 0.4, debris: 0.6 }, wreck: 0.5,
    active: 'twilight', share: 1, rare: 0.75, school: [6, 14], speed: 0.8, swim: 'mid', rise: 0.3,
    kg: [0.15, 0.25, 0.5], len: 1, shape: 'slim', difficulty: 4, fight: 'runner', wary: 8,
  },
  irontooth_bass: {
    name: 'irontooth bass', item: 'item_irontooth_bass',
    depth: [5, 18], shore: [1, 14], floor: { rock: 1.4, debris: 1, sand: 0.7 }, wreck: 1.5,
    active: 'day', share: 0.9, rare: 0.65, school: [2, 5], speed: 0.6, swim: 'mid', rise: 0.2,
    kg: [1.5, 2.6, 5], len: 1, shape: 'deep', difficulty: 6, fight: 'jumper', wary: 9,
  },
  ashen_pike: {
    name: 'ashen pike', item: 'item_ashen_pike',
    depth: [10, 30], shore: [3, 22], floor: { rock: 0.6, silt: 0.4, debris: 0.8, sand: 0.2 }, wreck: 3,
    active: 'dusk', share: 0.45, rare: 0.5, school: [1, 1], speed: 0.5, swim: 'floor', rise: 0.35,
    kg: [3, 5, 9], len: 1.25, shape: 'long', difficulty: 8, fight: 'runner', wary: 10,
  },
  glass_eel: {
    name: 'glass eel', item: 'item_glass_eel',
    depth: [3, 40], shore: [0, 26], floor: { silt: 1, sand: 0.8, debris: 0.6, rock: 0.4 }, wreck: 0,
    active: 'night', light: true, share: 0.5, rare: 0.55, school: [8, 20], speed: 0.4, swim: 'mid', rise: 0.8,
    kg: [0.1, 0.16, 0.3], len: 2.2, shape: 'eel', difficulty: 7, fight: 'wriggler', wary: 5, bait: 'bait_bloodworm',
  },
  coldwater_sturgeon: {
    name: 'coldwater sturgeon', item: 'item_coldwater_sturgeon',
    depth: [35, 60], shore: [10, 40], floor: { silt: 1.2, sand: 0.4 }, wreck: 0.3,
    active: 'night', share: 0.5, rare: 0.4, school: [1, 2], speed: 0.3, swim: 'floor', rise: 0,
    kg: [8, 14, 25], len: 1.15, shape: 'long', difficulty: 10, fight: 'sulker', wary: 12,
  },
  // Boat-only. A shore cast never reaches their water.
  lamp_herring: {
    name: 'lamp herring', item: 'item_lamp_herring',
    depth: [5, 25], shore: [3, 24], floor: { sand: 1, silt: 1, rock: 0.6, debris: 0.4 }, wreck: 0,
    active: 'night', light: true, share: 1.1, rare: 0.7, school: [20, 40], speed: 0.7, swim: 'mid', rise: 0.85,
    kg: [0.2, 0.28, 0.4], len: 1, shape: 'slim', difficulty: 2, fight: 'steady', wary: 6,
  },
  chrome_mackerel: {
    name: 'chrome mackerel', item: 'item_chrome_mackerel',
    depth: [10, 30], shore: [6, 30], floor: { sand: 1, silt: 1, rock: 1, debris: 0.5 }, wreck: 0,
    active: 'day', share: 1, rare: 0.65, school: [12, 25], speed: 1, swim: 'upper', rise: 0,
    kg: [0.6, 0.9, 1.5], len: 1, shape: 'slim', difficulty: 5, fight: 'runner', wary: 9,
  },
  sand_skate: {
    name: 'sand skate', item: 'item_sand_skate',
    depth: [8, 20], shore: [3, 18], floor: { sand: 1.6 }, wreck: 0,
    active: 'any', share: 0.45, rare: 0.5, school: [1, 1], speed: 0.25, swim: 'floor', rise: 0,
    kg: [2, 4, 8], len: 0.8, shape: 'skate', difficulty: 6, fight: 'sulker', wary: 7,
  },
  wreck_grouper: {
    name: 'wreck grouper', item: 'item_wreck_grouper',
    depth: [15, 42], shore: [6, 34], floor: { rock: 1, debris: 1, silt: 0.6, sand: 0.4 }, wreck: 'only',
    active: 'day', share: 2, rare: 0.7, school: [1, 1], speed: 0.2, swim: 'floor', rise: 0,
    kg: [6, 10, 20], len: 1, shape: 'deep', difficulty: 9, fight: 'sulker', wary: 8,
  },
  slate_cod: {
    name: 'slate cod', item: 'item_slate_cod',
    depth: [20, 42], shore: [8, 34], floor: { rock: 1, silt: 1 }, wreck: 0.4,
    active: 'night', season: 'winter', share: 0.8, rare: 0.6, school: [3, 8], speed: 0.45, swim: 'floor', rise: 0.25,
    kg: [2, 4.5, 10], len: 1, shape: 'round', difficulty: 7, fight: 'steady', wary: 9,
  },
};
export const SPECIES_IDS = Object.keys(SPECIES);

// ── HABITAT ────────────────────────────────────────────────────────────────────────────────────
//
// What a school needs to know about a point of water: { depth, shore, floor, wreck }, or null on
// land. `wreck` is 1 with a wreck within WRECK_R tiles, else 0.
export const WRECK_R = 2.5;

/**
 * A habitat function over an isLand(ix, iy) predicate, the same one seabed.js takes. Answers are
 * cached by half tile, because a shore search out at sea is 48 rings of land lookups and the
 * schools near a hull ask about the same few dozen cells every tick.
 */
export function habitatFor(isLand, cacheMax = 20000) {
  const cache = new Map();
  const habitat = function habitat(x, y) {
    const kx = Math.round(x * 2), ky = Math.round(y * 2), k = kx + ',' + ky;
    let v = cache.get(k);
    if (v === undefined) {
      const px = kx / 2, py = ky / 2;
      const shore = shoreDistance(px, py, isLand);
      if (shore <= 0) v = null;
      else {
        const depth = seabedDepth(px, py, isLand, shore);
        v = { depth, shore, floor: seabedMaterial(px, py, isLand, shore), wreck: wrecksNear(px, py, WRECK_R, isLand).length ? 1 : 0 };
      }
      if (cache.size >= cacheMax) cache.clear();
      cache.set(k, v);
    }
    return v;
  };
  // The wrecks are where the residents live (wreckResident below). A habitat a caller writes for
  // itself can leave this off, and its water simply has no residents.
  habitat.wrecks = (x, y, r) => wrecksNear(x, y, r, isLand);
  return habitat;
}

/** How well a species fits a point of water, 0 and up. 0 means it can't live there at all. */
export function habitatScore(sp, h) {
  if (!h) return 0;
  const f = sp.floor[h.floor] || 0;
  if (!f) return 0;
  if (sp.wreck === 'only' && !h.wreck) return 0;
  const w = sp.wreck === 'only' ? 1 : 1 + (sp.wreck || 0) * h.wreck;
  return inBand(h.depth, sp.depth[0], sp.depth[1], 3) * inBand(h.shore, sp.shore[0], sp.shore[1], 2) * f * w;
}

// ── THE MOMENT ─────────────────────────────────────────────────────────────────────────────────
//
// `env` is { hour, doy, weather, rough }: the hour 0..24, the day of the year, the weather type
// string and how rough the water is, 0..1. The server builds it from environment.js; the client gets
// it on the anchor push. A missing field means a calm noon in spring.
const ENV0 = { hour: 12, doy: 100, weather: 'clear', rough: 0 };
// What the weather does to how keen fish are. Grey weather is good fishing; a storm puts them down.
export const WEATHER_MOOD = { fog: 1.3, overcast: 1.15, cloudy: 1.1, rain: 1.2, drizzle: 1.15, storm: 0.35, thunderstorm: 0.3, blizzard: 0.25, snow: 0.8, sleet: 0.6 };

/** How keen a species is at this moment, 0..1+. It decides whether a school is there at all. */
export function keenness(sp, env = ENV0) {
  const e = { ...ENV0, ...env };
  const a = (ACTIVE[sp.active] || ACTIVE.any)(e.hour);
  const s = sp.season === 'winter' ? 0.2 + 0.8 * winterness(e.doy) : 1;
  return a * s * (WEATHER_MOOD[e.weather] ?? 1) * (1 - 0.5 * clamp(e.rough, 0, 1));
}

// ── SCHOOLS ────────────────────────────────────────────────────────────────────────────────────
//
// A cell holds SLOTS candidate schools. Each slot's species is picked by HABITAT ALONE, so a slot
// always holds the same species: the rock off a headland is razorgill water whatever the hour. The
// hour then decides whether that school is there. Its arrival hour is the slot's own hash, so at dusk
// the herring come in one school at a time rather than all at once. `fade` is how far past its arrival
// it is (0..1), which the shadow layer uses to fade a school in and out instead of popping it.
export const schoolId = (cx, cy, k) => `${cx}_${cy}_${k}`;
const FADE_W = 0.12;

/**
 * The school in a cell's slot, or null. `thinned` is the server's take for this school (phase 3):
 * that many fish are gone from it.
 */
export function schoolAt(cx, cy, k, env, habitat, thinned = 0) {
  const ax = (cx + 0.2 + 0.6 * h2(cx, cy, 11 + k)) * SCHOOL_CELL;
  const ay = (cy + 0.2 + 0.6 * h2(cx, cy, 23 + k)) * SCHOOL_CELL;
  const h = habitat(ax, ay);
  if (!h || h.depth < 0.5) return null;
  // The species: a weighted draw over everything that can live here.
  let tot = 0;
  const fits = [];
  for (const id of SPECIES_IDS) {
    const sp = SPECIES[id];
    const w = habitatScore(sp, h) * sp.share;
    if (w > 0) { fits.push([id, w]); tot += w; }
  }
  if (!tot) return null;
  let pick = h2(cx, cy, 37 + k) * tot, id = fits[fits.length - 1][0];
  for (const [fid, w] of fits) { if ((pick -= w) < 0) { id = fid; break; } }
  const sp = SPECIES[id];
  // Whether it's here now: the slot's own arrival threshold against the species' keenness.
  const want = keenness(sp, env) * sp.rare;
  const roll = h2(cx, cy, 51 + k);
  if (roll >= want) return null;
  const n = Math.max(0, Math.round(sp.school[0] + (sp.school[1] - sp.school[0]) * h2(cx, cy, 67 + k)) - (thinned | 0));
  if (!n) return null;
  return {
    id: schoolId(cx, cy, k), cx, cy, k, sp: id, ax, ay, n,
    floorM: h.depth, shoreT: h.shore, wreck: h.wreck,
    fade: clamp((want - roll) / FADE_W, 0, 1),
    seed: Math.floor(h2(cx, cy, 79 + k) * 65535),
  };
}

/**
 * Every school whose loop can reach within R tiles of (x, y). `thinned` is an optional
 * { [schoolId]: taken } map from the server. Unordered.
 */
export function schoolsNear(x, y, R, env, habitat, thinned = null) {
  const out = [];
  const pad = 2;   // a loop's reach past its anchor, in tiles
  const c0x = Math.floor((x - R - pad) / SCHOOL_CELL), c1x = Math.floor((x + R + pad) / SCHOOL_CELL);
  const c0y = Math.floor((y - R - pad) / SCHOOL_CELL), c1y = Math.floor((y + R + pad) / SCHOOL_CELL);
  for (let cy = c0y; cy <= c1y; cy++) for (let cx = c0x; cx <= c1x; cx++) {
    for (let k = 0; k < SLOTS; k++) {
      const s = schoolAt(cx, cy, k, env, habitat, thinned ? thinned[schoolId(cx, cy, k)] : 0);
      if (s && Math.hypot(s.ax - x, s.ay - y) <= R + pad) out.push(s);
    }
  }
  if (habitat.wrecks) {
    for (const w of habitat.wrecks(x, y, R + pad)) {
      const s = wreckResident(w, env, habitat, thinned ? thinned[w.id] : 0);
      if (s) out.push(s);
    }
  }
  return out;
}

// ── RESIDENTS ──────────────────────────────────────────────────────────────────────────────────
//
// Every wreck on the shelf is somebody's home. A cell school only finds a wreck when its anchor
// happens to fall within WRECK_R of one, which measured at about one wreck in three on the real
// coast, so the grouper (which lives nowhere else) never turned up at all. A resident is anchored ON
// the wreck and drawn from the species that love wrecks, so a wreck is a place you can go back to.
// Its id is the wreck's, so the server's take and the client's shadows agree about it.
export const WRECK_LOVER = 1;   // a species with wreck >= this, or 'only', can be a resident

export function wreckResident(w, env, habitat, thinned = 0) {
  const h = habitat(w.x, w.y);
  if (!h) return null;
  const hw = { ...h, wreck: 1 };
  const [wx, wy] = [Math.floor(w.x), Math.floor(w.y)];
  let tot = 0;
  const fits = [];
  for (const id of SPECIES_IDS) {
    const sp = SPECIES[id];
    if (!(sp.wreck === 'only' || sp.wreck >= WRECK_LOVER)) continue;
    const v = habitatScore(sp, hw) * sp.share;
    if (v > 0) { fits.push([id, v]); tot += v; }
  }
  if (!tot) return null;
  let pick = h2(wx, wy, 91) * tot, id = fits[fits.length - 1][0];
  for (const [fid, v] of fits) { if ((pick -= v) < 0) { id = fid; break; } }
  const sp = SPECIES[id];
  // A resident is home more often than a passing school: it lives there.
  const want = Math.min(1, keenness(sp, env) * Math.min(1, sp.rare + 0.25));
  const roll = h2(wx, wy, 97);
  if (roll >= want) return null;
  const n = Math.max(0, Math.round(sp.school[0] + (sp.school[1] - sp.school[0]) * h2(wx, wy, 101)) - (thinned | 0));
  if (!n) return null;
  return {
    id: w.id, cx: wx, cy: wy, k: 'wreck', sp: id, ax: w.x, ay: w.y, n,
    floorM: h.depth, shoreT: h.shore, wreck: 1, reach: 0.35, home: w.kind,
    fade: clamp((want - roll) / FADE_W, 0, 1),
    seed: Math.floor(h2(wx, wy, 103) * 65535),
  };
}

// ── WHERE A SCHOOL IS ──────────────────────────────────────────────────────────────────────────
//
// Each school swims a loop round its anchor made of two ellipses whose periods never line up, so it
// never visibly repeats. Its speed is the species' cruising speed, which sets the period; its reach
// is kept under half its distance from shore, so a loop never crosses onto the beach.

/** The loop's reach in tiles. */
export const loopReach = (s) => s.reach ?? clamp(s.shoreT * 0.45, 0.25, 1.4);

/** How long one loop takes, in ms. */
export function loopPeriod(s) {
  const sp = SPECIES[s.sp];
  const metres = TAU * loopReach(s) * SEA_TILE_M * 0.8;
  return (metres / sp.speed) * 1000 * (0.85 + 0.3 * hn2h(s.seed, 3));
}

// How deep a school holds, in metres below the surface, before the bob.
export function holdDepth(sp, floorM, env = ENV0) {
  const e = { ...ENV0, ...env };
  const base = sp.swim === 'floor' ? floorM * 0.9 : sp.swim === 'mid' ? floorM * 0.5 : Math.min(floorM * 0.3, 3);
  const up = base * (1 - (sp.rise || 0) * nightness(e.hour));
  // Rough water sends everything down towards the floor.
  return up + (floorM * 0.9 - up) * clamp(e.rough, 0, 1) * 0.6;
}

/**
 * Where a school is at `now`: { x, y, depth, heading, speed }. Heading in radians, 0 along +x,
 * measured towards +y; speed in m/s.
 */
export function schoolState(s, now, env = ENV0) {
  const sp = SPECIES[s.sp];
  const R = loopReach(s), P = loopPeriod(s);
  const dir = hn2h(s.seed, 5) < 0.5 ? 1 : -1;
  const p2 = hn2h(s.seed, 7) * TAU, p3 = hn2h(s.seed, 11) * TAU;
  // ⚠ The phase is reduced to one turn BEFORE the trig, so a large clock never reaches Math.cos.
  const t = frac(now / P + hn2h(s.seed, 13));
  const t2 = frac(now / (P * 0.618) + hn2h(s.seed, 17));
  const w = TAU * t, w2 = TAU * t2 + p2;
  const A1 = R * 0.7, A2 = R * 0.3, B1 = R * 0.55 * dir, B2 = R * 0.25 * dir;
  const x = s.ax + A1 * Math.cos(w) + A2 * Math.cos(w2 + p3);
  const y = s.ay + B1 * Math.sin(w) + B2 * Math.sin(w2);
  // Velocity by the chain rule, in tiles per ms.
  const kw = TAU / P, kw2 = TAU / (P * 0.618);
  const vx = -A1 * kw * Math.sin(w) - A2 * kw2 * Math.sin(w2 + p3);
  const vy = B1 * kw * Math.cos(w) + B2 * kw2 * Math.cos(w2);
  const bob = 0.4 * Math.sin(TAU * frac(now / 23000 + hn2h(s.seed, 19)));
  const depth = clamp(holdDepth(sp, s.floorM, env) + bob, 0.3, Math.max(0.3, s.floorM - 0.2));
  return { x, y, depth, heading: Math.atan2(vy, vx), speed: Math.hypot(vx, vy) * SEA_TILE_M * 1000 };
}

// ── SINGLE FISH ────────────────────────────────────────────────────────────────────────────────

// A weight from a triangular distribution over [min, mode, max], on the fish's own hash.
function triangular([lo, mode, hi], u) {
  const c = (mode - lo) / (hi - lo);
  return u < c ? lo + Math.sqrt(u * (hi - lo) * (mode - lo)) : hi - Math.sqrt((1 - u) * (hi - lo) * (hi - mode));
}

/** A fish's weight in kg. Fixed for life, so the big shadow is still the big fish tomorrow. */
export const fishKg = (s, i) => +triangular(SPECIES[s.sp].kg, hn2h(s.seed + i * 131, 23)).toFixed(2);

/** A fish's body length in metres, from its weight. A 1 kg fish is about 42 cm. */
export const fishLength = (sp, kg) => 0.42 * Math.cbrt(kg) * (sp.len || 1);

/**
 * Fish `i` of a school at `now`: { x, y, depth, heading, kg, len }. `st` is the school's
 * schoolState at the same moment, when the caller already has it.
 */
export function schoolFish(s, i, now, env = ENV0, st = schoolState(s, now, env)) {
  const sp = SPECIES[s.sp];
  const spread = s.n > 1 ? 0.08 * Math.sqrt(s.n) : 0;    // tiles
  const u = hn2h(s.seed + i * 131, 29) - 0.5, v = hn2h(s.seed + i * 131, 31) - 0.5;
  const ph = hn2h(s.seed + i * 131, 37);
  // A school is longer along its heading than across it.
  const along = u * 2 * spread * 1.5 + 0.03 * Math.sin(TAU * frac(now / 2300 + ph));
  const across = v * 2 * spread * 0.7;
  const c = Math.cos(st.heading), sn = Math.sin(st.heading);
  const kg = fishKg(s, i);
  return {
    x: st.x + along * c - across * sn,
    y: st.y + along * sn + across * c,
    depth: clamp(st.depth + (hn2h(s.seed + i * 131, 41) - 0.5) * 1.2, 0.3, Math.max(0.3, s.floorM - 0.1)),
    heading: st.heading + 0.22 * Math.sin(TAU * frac(now / 3100 + ph)),
    kg, len: fishLength(sp, kg),
  };
}

/**
 * Every fish within R tiles of (x, y) at `now`, nearest first:
 * { school, i, x, y, depth, heading, kg, len, dist } (dist in tiles, on the surface).
 */
export function fishNear(x, y, R, now, env, habitat, thinned = null) {
  const out = [];
  for (const s of schoolsNear(x, y, R, env, habitat, thinned)) {
    const st = schoolState(s, now, env);
    for (let i = 0; i < s.n; i++) {
      const f = schoolFish(s, i, now, env, st);
      const dist = Math.hypot(f.x - x, f.y - y);
      if (dist <= R) out.push({ school: s, i, ...f, dist });
    }
  }
  return out.sort((a, b) => a.dist - b.dist);
}

// ── THE SURVEY AND THE FORECAST ────────────────────────────────────────────────────────────────
//
// What a stretch of water holds at an hour: how many schools of each species, and the heaviest fish
// among them. It's what the marine forecast reads, and what the dev map paints, so both are true by
// construction: the forecast can't promise a fish the sim doesn't have.

/** { [speciesId]: { schools, fish, bestKg } } for the water within R tiles of (x, y). */
export function survey(x, y, R, env, habitat) {
  const out = {};
  for (const s of schoolsNear(x, y, R, env, habitat)) {
    if (Math.hypot(s.ax - x, s.ay - y) > R) continue;
    const e = out[s.sp] || (out[s.sp] = { schools: 0, fish: 0, bestKg: 0 });
    e.schools += 1; e.fish += s.n;
    for (let i = 0; i < s.n; i++) e.bestKg = Math.max(e.bestKg, fishKg(s, i));
  }
  return out;
}

// The words for how many. Counts are schools per area surveyed, so they're relative to its size.
const HOW_MANY = [[0.35, 'thick'], [0.18, 'plenty'], [0.07, 'moderate'], [0.01, 'thin']];
const howMany = (perCell) => (HOW_MANY.find(([t]) => perCell >= t) || [0, null])[1];

// The four watches the forecast reads, as [label, hour].
export const WATCHES = [['at dawn', 6.5], ['by noon', 12], ['at dusk', 19.5], ['after dark', 23]];

/**
 * The forecast for one area: up to `max` lines, each the best species of a watch, as
 * "razorgill on the rock at dawn, plenty". `area` is { name, x, y, R }. `env` gives the day; the
 * watch sets the hour. Plain text, for ORACLE to read and the log rung to print.
 */
export function forecastLines(area, env, habitat, max = 3) {
  const cells = Math.max(1, (Math.PI * area.R * area.R) / (SCHOOL_CELL * SCHOOL_CELL));
  const said = new Set(), lines = [];
  for (const [label, hour] of WATCHES) {
    const sv = survey(area.x, area.y, area.R, { ...env, hour }, habitat);
    // Ranked by what's worth going out for, not by what's commonest: a few pike beat a lot of carp.
    const worth = ([id, e]) => e.schools * (1 + SPECIES[id].difficulty / 3);
    const best = Object.entries(sv).filter(([id]) => !said.has(id)).sort((a, b) => worth(b) - worth(a))[0];
    if (!best) continue;
    const [id, e] = best, word = howMany(e.schools / cells);
    if (!word) continue;
    said.add(id);
    const nm = SPECIES[id].name;
    lines.push(`${nm[0].toUpperCase()}${nm.slice(1)} ${whereWords(SPECIES[id])} ${label}, ${word}`);
    if (lines.length >= max) break;
  }
  return lines;
}

// Where a species is found, in a few words.
function whereWords(sp) {
  if (sp.wreck === 'only') return 'on the wrecks';
  if (sp.swim === 'upper') return 'running high';
  if (sp.floor.rock >= 1.2) return 'on the rock';
  if (sp.floor.sand >= 1.4) return 'on the sand';
  if (sp.depth[0] >= 30) return 'on the shelf floor';
  if (sp.shore[1] <= 9) return 'in the shallows';
  return sp.swim === 'floor' ? 'down on the bottom' : 'mid-water';
}
