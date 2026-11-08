// THE SOUNDER: what the Keel's fish finder sees. Arithmetic only, no DOM, so a gate can hold it against
// the server's fish, as fish-shadow-scene.js is held. sonar-panel.js draws it, and the unit in the
// seat (interior-skiff.js) draws `sonarCells`.
//
// It reads the same fish the shadows do, the ones the server rolls the bite for, so a mark you cast at
// is a fish that can take. Where it differs from your eyes is the point of having one:
//   · it works in the dark, in fog and under way, when `shadowFish` is the only way to see anything;
//   · it can't name a fish. It knows how big a return is and how deep, and nothing else;
//   · small fish fall under the gain, and turning the gain up brings the clutter up with them.
//
// Two views of one scan. The sweep is a plan of everything round her, with the bow up. The beam is a
// vertical slice out along the way the rod's pointing, like a forward-looking sounder: distance across,
// depth down, the sea floor in profile, and the lure as it sinks. That's the view that tells you the
// fish are at nine metres and your lure's at four.
//
// Positions come out in metres from the boat: `right` to starboard and `ahead` over the bow.

import { SHADOW_R } from '../../../shared/fish.js';
import { SEA_TILE_M } from '../../../shared/sea-swell.js';
import { shadowFish, lureFish } from './fish-shadow-scene.js';

export const RANGES_M = [30, 50, 70];          // the RANGE button's steps, in metres
export const GAIN_NAMES = ['LOW', 'MID', 'HIGH'];
export const BEAM_DEG = 14;                    // the beam's half-width
export const PROFILE_N = 40;                   // samples of the floor along the beam
const FLOOR_AT = [0.3, 0.2, 0.1];              // the weakest return each gain shows
const MAX_MARKS = 140;

const D2R = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap180 = (d) => ((d + 540) % 360) - 180;

// How strong a fish's return is, 0..1. A swim bladder returns more than the size of the fish says,
// so a small fish isn't invisible, and distance takes some of it.
function strengthOf(kg, r, rangeM) {
  return clamp(0.2 + 0.3 * Math.cbrt(kg), 0.12, 1) * (1 - 0.35 * clamp(r / rangeM, 0, 1));
}

/** The water depth under a point (boat convention), or 0 on land. */
function depthAt(habitat, x, y) {
  const h = habitat(x + 0.5, y + 0.5);
  return h ? h.depth : 0;
}

/**
 * One scan. `q`: { x, y, heading (deg), bearing (deg off the bow), now, env, habitat, thinned,
 * rangeM, gain (index), lureTo }. Returns { underM, marks, profile, wrecks, bottomM }. Fills `out`
 * when given, so a scan a tenth of a second allocates only its marks.
 */
export function sonarScan(q, out = {}) {
  const { x, y, now, env, habitat, thinned, rangeM } = q;
  const gain = clamp(q.gain | 0, 0, 2);
  const hd = (q.heading || 0) * D2R, fx = Math.sin(hd), fy = -Math.cos(hd), rx = Math.cos(hd), ry = Math.sin(hd);
  const marks = [];
  // Asked at SHADOW_R whatever the range, so this and the shadows share one list of schools.
  for (const f of shadowFish(x, y, now, env, habitat, thinned, SHADOW_R)) {
    if (q.lureTo) lureFish(f, f.school.id + ':' + f.i, q.lureTo);
    const dx = (f.x - 0.5 - x) * SEA_TILE_M, dy = (f.y - 0.5 - y) * SEA_TILE_M;
    const right = dx * rx + dy * ry, ahead = dx * fx + dy * fy, r = Math.hypot(right, ahead);
    if (r > rangeM) continue;
    const s = strengthOf(f.kg, r, rangeM) * (gain === 2 ? 1.15 : 1);
    if (s < FLOOR_AT[gain]) continue;
    marks.push({ right, ahead, r, brg: Math.atan2(right, ahead) / D2R, depth: f.depth, kg: f.kg, s: Math.min(1, s),
      key: f.school.id + ':' + f.i, n: f.school.n });
    if (marks.length >= MAX_MARKS) break;
  }
  out.marks = marks;
  out.underM = depthAt(habitat, x, y);
  // The floor along the beam. A habitat answers by the half tile, so the steps are smoothed out.
  const prof = out.profile || (out.profile = new Float32Array(PROFILE_N));
  const b = hd + (q.bearing || 0) * D2R, bx = Math.sin(b), by = -Math.cos(b);
  for (let i = 0; i < PROFILE_N; i++) {
    const m = (i / (PROFILE_N - 1)) * rangeM / SEA_TILE_M;
    prof[i] = depthAt(habitat, x + bx * m, y + by * m);
  }
  let bottom = 0;
  for (let pass = 0; pass < 3; pass++) {
    let prev = prof[0];
    for (let i = 1; i < PROFILE_N - 1; i++) { const c = prof[i]; prof[i] = (prev + c * 2 + prof[i + 1]) / 4; prev = c; }
  }
  for (let i = 0; i < PROFILE_N; i++) bottom = Math.max(bottom, prof[i]);
  out.bottomM = bottom;
  // Wrecks, as a hard return on the floor.
  const wr = [];
  if (habitat.wrecks) {
    for (const w of habitat.wrecks(x + 0.5, y + 0.5, rangeM / SEA_TILE_M)) {
      const dx = (w.x - 0.5 - x) * SEA_TILE_M, dy = (w.y - 0.5 - y) * SEA_TILE_M;
      wr.push({ right: dx * rx + dy * ry, ahead: dx * fx + dy * fy });
    }
  }
  out.wrecks = wr;
  return out;
}

/** Is a mark inside the beam? Its distance along the beam in metres, or -1. */
export function inBeam(m, bearing) {
  if (Math.abs(wrap180(m.brg - bearing)) > BEAM_DEG) return -1;
  return m.r * Math.cos((m.brg - bearing) * D2R);
}

/** A square of depths round her for the sweep's chart: `n` by `n`, 0 on land, row 0 ahead. */
export function chartGrid(q, n, out) {
  const g = out && out.length === n * n ? out : new Float32Array(n * n);
  const hd = (q.heading || 0) * D2R, fx = Math.sin(hd), fy = -Math.cos(hd), rx = Math.cos(hd), ry = Math.sin(hd);
  const cell = (2 * q.rangeM / SEA_TILE_M) / n;
  for (let j = 0; j < n; j++) {
    const a = ((n - 1) / 2 - j) * cell;
    for (let i = 0; i < n; i++) {
      const r = (i - (n - 1) / 2) * cell;
      g[j * n + i] = depthAt(q.habitat, q.x + fx * a + rx * r, q.y + fy * a + ry * r);
    }
  }
  return g;
}

/** How far down the screen goes for a floor this deep: a round figure with a little under the floor. */
export const screenDepth = (bottomM) => Math.max(10, Math.ceil((bottomM * 1.18 + 1) / 5) * 5);

/**
 * The beam as a block of cells for the unit in the seat: `{ w, h, cells, depthM }`, levels 0 to 3 in
 * `cells`, row 0 at the surface. Fills `box` in place.
 */
export function sonarCells(scan, q, box) {
  const w = box.w, h = box.h;
  const c = box.cells || (box.cells = new Uint8Array(w * h));
  c.fill(0);
  const deep = screenDepth(scan.bottomM), rangeM = q.rangeM;
  // The surface clutter.
  for (let i = 0; i < w; i++) c[i] = (i * 7 + ((q.now / 400) | 0)) % 3 === 0 ? 1 : 0;
  // The floor: bright on the line, dimmer under it.
  for (let i = 0; i < w; i++) {
    const d = scan.profile[Math.round((i / (w - 1)) * (PROFILE_N - 1))];
    if (d <= 0) { for (let j = 0; j < h; j++) c[j * w + i] = 2; continue; }
    const j0 = Math.min(h - 1, Math.round((d / deep) * (h - 1)));
    c[j0 * w + i] = 3;
    for (let j = j0 + 1; j < h; j++) c[j * w + i] = j === j0 + 1 ? 2 : 1;
  }
  for (const m of scan.marks) {
    const a = inBeam(m, q.bearing || 0);
    if (a < 0) continue;
    const i = Math.round((a / rangeM) * (w - 1)), j = Math.round((m.depth / deep) * (h - 1));
    if (i >= 0 && i < w && j >= 0 && j < h) c[j * w + i] = m.s > 0.45 ? 3 : 2;
  }
  box.depthM = scan.underM;
  return box;
}
