// WHAT YOU SEE IN THE WATER FROM A BOAT, and the words for it: the pure half of `look water`
// (water.js holds who's looking). It imports only client/shared, so a gate can run it with no world.
//
// The fish are client/shared/fish.js's, asked exactly as the bite asks them (the server's half-tile
// convention: fishNear(x + 0.5, y + 0.5, …)), and kept or dropped by fish.js's own sight rules
// (`shadowsOn`, `lightOn`, `sightRange`), which the seat's shadows use too. So what you're told is in
// the water is what the seat draws and what can take the lure.

import { SPECIES, fishNear, schoolState, loopPeriod, shadowsOn, sightRange, lightOn, TAU } from '../../client/shared/fish.js';
import { SEA_TILE_M } from '../../client/shared/sea-swell.js';
import { numberWords } from '../../client/shared/boat-anchor.js';

export const MAX_SCHOOLS = 3;
export const SEEN = 0.25;        // light x arrival fade a fish needs before it's named
export const RING_M = 2;         // a school holding shallower than this rings the surface
export const SWIRL_M = 5;        // a runner turning hard this shallow leaves a swirl
export const SWIRL_K = 2;        // how much faster than its loop's own turn counts as turning hard

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const wrap180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180;

/**
 * The schools in sight of a boat, nearest first, and the signs on the surface. `q` is
 * { x, y, heading, now, env, habitat, thinned, daylight, lamp, anchored, speedMph }, the boat in
 * its own convention (a tile's centre on the integer) and heading in degrees, 0 north, clockwise.
 */
export function waterView(q) {
  const view = { schools: [], rings: null, swirl: null, moving: false, dark: false, fog: q.env?.weather === 'fog' };
  if (!shadowsOn(q)) { view.moving = true; return view; }
  const day = Math.max(0, Math.min(1, q.daylight || 0));
  if (day <= 0 && !q.lamp) { view.dark = true; return view; }
  const by = new Map();
  for (const f of fishNear(q.x + 0.5, q.y + 0.5, sightRange(q.env), q.now, q.env, q.habitat, q.thinned || null)) {
    if (lightOn(f.dist, day, q.lamp) * f.school.fade < SEEN) continue;
    let e = by.get(f.school.id);
    if (!e) by.set(f.school.id, e = { id: f.school.id, school: f.school, n: 0, dist: f.dist, x: f.x, y: f.y, kg: 0, depth: Infinity });
    e.n++;
    e.kg = Math.max(e.kg, f.kg);
    e.depth = Math.min(e.depth, f.depth);
  }
  // fishNear is nearest first, so the map is too: each school sits where its nearest fish is.
  const seen = [...by.values()];
  view.schools = seen.slice(0, MAX_SCHOOLS);
  for (const e of seen) {
    const s = e.school, sp = SPECIES[s.sp], st = schoolState(s, q.now, q.env);
    e.at = st;
    if (!view.rings && st.depth < RING_M && feeding(s, q.now)) view.rings = e;
    if (!view.swirl && sp.fight === 'runner' && st.depth < SWIRL_M && turnRate(s, q) > SWIRL_K * (TAU / loopPeriod(s)) * 1000) view.swirl = e;
  }
  return view;
}

/**
 * Whether a shallow school is feeding at the top right now: FEED_SHARE of each FEED_MS, at a phase
 * of its own, so a harbour full of shallow carp rings here and there rather than everywhere at once.
 */
export const FEED_MS = 12000, FEED_SHARE = 0.3;
export function feeding(s, now) {
  const p = now / FEED_MS + (s.seed || 0) / 65535;
  return p - Math.floor(p) < FEED_SHARE;
}

/** How fast a school is turning at q.now, in radians a second. */
export function turnRate(s, q) {
  const a = schoolState(s, q.now - 1000, q.env), b = schoolState(s, q.now, q.env);
  return Math.abs(wrap180((b.heading - a.heading) * 180 / Math.PI)) * Math.PI / 180;
}

/** Which way off her, from degrees off the bow (starboard positive). */
export function sideOf(rb) {
  const m = Math.abs(rb);
  if (m < 15) return 'ahead';
  if (m > 165) return 'astern';
  return `off the ${rb < 0 ? 'port' : 'starboard'} ${m < 60 ? 'bow' : m < 120 ? 'beam' : 'quarter'}`;
}

/** How far and which way, from the boat to a point in fish.js's frame. */
function whereOf(q, fx, fy) {
  const dx = fx - 0.5 - q.x, dy = fy - 0.5 - q.y;
  const m = Math.hypot(dx, dy) * SEA_TILE_M;
  if (m < 2.5) return 'right under her';
  const rb = wrap180(Math.atan2(dx, -dy) * 180 / Math.PI - (q.heading || 0));
  const far = m < 10 ? `${numberWords(Math.round(m))} metres` : `about ${numberWords(Math.round(m / 5) * 5)} metres`;
  return `${far} ${sideOf(rb)}`;
}

function depthWord(d) {
  if (d < RING_M) return 'at the top';
  if (d < 5) return 'just under the surface';
  if (d < 12) return 'a few metres down';
  return 'deep';
}

// What the shadow looks like, and whether that's a plural subject.
function shapeOf(e) {
  const sp = SPECIES[e.school.sp];
  if (e.n === 1) {
    if (sp.shape === 'skate') return ['A wide flat shadow', false];
    if (sp.shape === 'eel') return ['A thin pale line', false];
    if (e.kg >= 10) return ['A long dark shape', false];
    if (e.kg >= 3) return ['A dark shape', false];
    return ['A small shadow', false];
  }
  if (sp.shape === 'eel') return ['Thin pale lines', true];
  if (e.n >= 15) return [e.kg < 0.6 ? 'A school of small fish' : 'A big school', false];
  if (e.n >= 6) return ['A loose school', false];
  return [`${cap(numberWords(e.n))} shadows`, true];
}

function verbOf(e, plural) {
  const v = SPECIES[e.school.sp].speed;
  const w = v >= 0.7 ? 'move' : v <= 0.3 ? 'hold' : 'drift';
  return plural ? w : w + 's';
}

/** One line for one school: "A dark shape holds about twenty metres off the starboard bow, deep." */
export function schoolLine(q, e) {
  const [what, plural] = shapeOf(e);
  return `${what} ${verbOf(e, plural)} ${whereOf(q, e.x, e.y)}, ${depthWord(e.depth)}.`;
}

/** The signs on the surface, as lines: rings, then a swirl. */
export function signLines(q, view) {
  const out = [];
  if (view.rings) out.push(`Rings spread on the water ${whereOf(q, view.rings.at.x, view.rings.at.y)}, where something is feeding at the top.`);
  if (view.swirl && view.swirl !== view.rings) out.push(`Something turns hard ${whereOf(q, view.swirl.at.x, view.swirl.at.y)} and leaves a swirl.`);
  return out;
}

/** `look water`, whole. */
export function describeWater(q, view = waterView(q)) {
  if (view.moving) return "She's moving too fast to see into the water. Stop her first.";
  if (view.dark) return "Black water. You can't see into it after dark without a light.";
  const lines = view.schools.map((e) => schoolLine(q, e)).concat(signLines(q, view));
  if (lines.length) return lines.join('\n');
  if (!(q.daylight > 0)) return 'The lamp lights the water round her for a few metres. Nothing in it.';
  if (view.fog) return "Fog sits on the water. You can see a few metres into it, and nothing's moving.";
  return 'Grey-green water with a skin of oil on it. Nothing moving under it.';
}
