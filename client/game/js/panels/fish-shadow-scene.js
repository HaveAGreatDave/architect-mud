// FISH SHADOWS: which fish a boat's seat draws, and where. Arithmetic only, no GL, so the smoke gate
// (scripts/fish/smoke.mjs) can hold it against the server; gl/fish-shadows.js draws what this packs.
//
// The fish are client/shared/fish.js's, the same ones the server rolls the bite for. So this file
// decides nothing about a fish. It asks the same question the server asks, in the server's terms,
// and keeps the answers that can be seen (fish.js `shadowsOn`, `lightOn`, `sightRange`).
//
// ⚠ THE SERVER'S TILE CONVENTION. A boat's x, y put a tile's centre on the integer, and fish.js has
// tile i spanning [i, i + 1). The server asks fishNear(x + 0.5, y + 0.5, …) and takes half a tile
// back off the fish it bites (plugins/fishing/boat.js), so this does exactly the same, and every
// position it hands out is in the boat's convention, the frame the lure and the hull are drawn in.
//
// ⚠ THE SCHOOLS ARE KEPT, THE FISH ARE NOT. Which schools are near only changes with the place, the
// moment (`env`) and the take (`thinned`), and finding them costs a habitat lookup and a wreck search
// per cell. So the list is worked out again only when one of those changes, and each frame only
// swims them: schoolState and schoolFish, a few hundred multiplies. Kept with a radius a tile wider
// than asked for and filtered as fishNear filters, so the answer is fishNear's to the fish; the
// smoke checks that it is.
//
// Cost when the boat is under way, or it's dark with no lamp: one call and a return.

import {
  SPECIES, SHADOW_R, BREADTH, SHAPE_IDS, schoolsNear, schoolState, schoolFish,
  shadowsOn, sightRange, lightOn,
  LAMP_R,
} from '../../../shared/fish.js';
import { SEA_K } from '../../../shared/sea-swell.js';

const PAD = 2 / SEA_K;    // fish.js schoolsNear's own reach past a school's anchor, in tiles
const EDGE = 1.5 / SEA_K; // tiles over which a shadow fades in at the edge of sight, so none pops
const MIN_A = 0.01;     // below this a shadow isn't sent
const smooth = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

// Floats per instance in the packed buffer, in gl/fish-shadows.js's attribute order.
export const STRIDE = 9;   // x, y, z, heading, length, breadth, alpha, depth (m), shape
export const SHAPE_OF = Object.fromEntries(SHAPE_IDS.map((s, i) => [s, i]));

const cache = { habitat: null, env: null, thinned: null, xc: NaN, yc: NaN, R: 0, schools: [] };

/** The schools whose loops can reach within R of (sx, sy), in fish.js's frame. Kept between calls. */
function schoolsFor(sx, sy, R, env, habitat, thinned) {
  const xc = Math.round(sx * 2) / 2, yc = Math.round(sy * 2) / 2;
  const c = cache;
  if (c.habitat !== habitat || c.env !== env || c.thinned !== thinned || c.xc !== xc || c.yc !== yc || c.R !== R) {
    c.habitat = habitat; c.env = env; c.thinned = thinned; c.xc = xc; c.yc = yc; c.R = R;
    // A tile wider: (sx, sy) is within half a tile of the centre it was worked out at.
    c.schools = schoolsNear(xc, yc, R + 1, env, habitat, thinned);
  }
  return c.schools;
}

/**
 * A fish that's noticed the lure leaves its school and swims to it. `to` is { x, y, depth, k }, with
 * x and y in fish.js's frame and `k` a Map of 'schoolId:i' to 0..1, how far it's come. The server only
 * says who's following and who took it (`follow`, `bite`); this is what that looks like, for the
 * shadows and the sounder alike.
 */
export function lureFish(f, key, to) {
  const k = to.k.get(key);
  if (!k) return f;
  const dx = to.x - f.x, dy = to.y - f.y;
  f.x += dx * k; f.y += dy * k;
  f.depth += (to.depth - f.depth) * k;
  if (k < 0.98 && (dx || dy)) f.heading = Math.atan2(dy, dx);
  return f;
}

/** Forget the kept schools (a new land mask, or the smoke starting a fresh case). */
export function resetShadowScene() { cache.habitat = null; cache.schools = []; }

/**
 * Every fish within R tiles of a boat at (x, y) at `now`, nearest first: fishNear's answer to the
 * same question, the server's way round (x + 0.5, y + 0.5). Positions are fish.js's.
 */
export function shadowFish(x, y, now, env, habitat, thinned = null, R = SHADOW_R) {
  const sx = x + 0.5, sy = y + 0.5, out = [];
  for (const s of schoolsFor(sx, sy, R, env, habitat, thinned)) {
    if (Math.hypot(s.ax - sx, s.ay - sy) > R + PAD) continue;
    const st = schoolState(s, now, env);
    for (let i = 0; i < s.n; i++) {
      const f = schoolFish(s, i, now, env, st);
      const dist = Math.hypot(f.x - sx, f.y - sy);
      if (dist <= R) out.push({ school: s, i, ...f, dist });
    }
  }
  return out.sort((a, b) => a.dist - b.dist);
}

/**
 * Calls fn(fish, school, alpha, state) for each fish that can be seen from the boat right now.
 * `q` is { x, y, now, env, habitat, thinned, anchored, speedMph, daylight, lamp }: the boat's
 * position in its own convention, the server's clock, and how lit the water is (daylight 0..1, and
 * whether the lamp is on). Nothing at all under way, or at night without a lamp.
 */
export function eachShadow(q, fn) {
  if (!q || !q.env || !q.habitat || !Number.isFinite(q.now)) return 0;
  if (!shadowsOn(q)) return 0;
  const day = Math.max(0, Math.min(1, q.daylight || 0));
  if (day <= 0 && !q.lamp) return 0;
  const R = sightRange(q.env);
  // At night the lamp's circle is all there is, so only its schools are swum.
  const reach = day > 0 ? R : Math.min(R, LAMP_R * 1.33);
  const sx = q.x + 0.5, sy = q.y + 0.5;
  let n = 0;
  for (const s of schoolsFor(sx, sy, SHADOW_R, q.env, q.habitat, q.thinned || null)) {
    if (Math.hypot(s.ax - sx, s.ay - sy) > reach + PAD) continue;
    const st = schoolState(s, q.now, q.env);
    for (let i = 0; i < s.n; i++) {
      const f = schoolFish(s, i, q.now, q.env, st);
      if (q.lureTo) lureFish(f, s.id + ':' + i, q.lureTo);
      const dist = Math.hypot(f.x - sx, f.y - sy);
      if (dist > R) continue;
      const a = lightOn(dist, day, q.lamp) * (1 - smooth(R - EDGE, R, dist)) * s.fade;
      if (a < MIN_A) continue;
      f.dist = dist; f.i = i;
      fn(f, s, a, st);
      n++;
    }
  }
  return n;
}

/**
 * The shadows as plain records, for the smoke and for anything reading rather than drawing:
 * { school, i, x, y, depth, heading, len, breadth, shape, alpha } in the boat's convention.
 */
export function shadowInstances(q) {
  const out = [];
  eachShadow(q, (f, s, a) => {
    const sp = SPECIES[s.sp];
    out.push({ school: s.id, i: f.i, x: f.x - 0.5, y: f.y - 0.5, depth: f.depth, heading: f.heading,
      len: f.len, breadth: f.len * (BREADTH[sp.shape] ?? 0.4), shape: sp.shape, alpha: a });
  });
  return out;
}

/**
 * The shadows packed for gl/fish-shadows.js: STRIDE floats each, in the map window's frame (the boat
 * convention less the window centre `cx, cy`), lengths in tiles. `zAt(x, y)` is the sea's height at
 * an absolute point in the boat's convention, asked once a school. Returns the instance count; the
 * buffer is grown in place and handed back on `box.data`, so a steady frame allocates no floats.
 */
export function packShadows(q, box, cx, cy, zAt, tileM) {
  let n = 0, lastS = null, z = 0;
  eachShadow(q, (f, s, a, st) => {
    if (s !== lastS) { lastS = s; z = zAt ? zAt(st.x - 0.5, st.y - 0.5) : 0; }
    const need = (n + 1) * STRIDE;
    if (!box.data || box.data.length < need) {
      const g = new Float32Array(Math.max(need, (box.data ? box.data.length : 0) * 2, STRIDE * 64));
      if (box.data) g.set(box.data);
      box.data = g;
    }
    const sp = SPECIES[s.sp], d = box.data, o = n * STRIDE;
    d[o] = f.x - 0.5 - cx; d[o + 1] = f.y - 0.5 - cy; d[o + 2] = z;
    d[o + 3] = f.heading;
    d[o + 4] = f.len / tileM; d[o + 5] = (f.len * (BREADTH[sp.shape] ?? 0.4)) / tileM;
    d[o + 6] = a; d[o + 7] = f.depth; d[o + 8] = SHAPE_OF[sp.shape] ?? 0;
    n++;
  });
  return n;
}
