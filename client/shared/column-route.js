// THE COLUMN'S ROUTE AND TIMETABLE: where the three Wildblood rigs and Bracken's hounds are, worked
// out from the clock.
//
// The column is a pure function of the wall clock, like a flock (client/shared/birds.js): nothing is
// stored, nothing is queried, and any process that asks at the same instant gets the same answer. A
// restart loses nothing, because there is nothing to lose. It lives in client/shared/ because two
// programs ask: plugins/column puts the rigs in `vehicle.contacts` and on the text rung, and the
// renderer works out the hounds for itself (`houndsAt`), the way it works out a flock.
//
// THE LOOP. Out of the Deadleg yard south over the scrub to the Slake's north shore, where the cart
// fills; back up to the highway on row 957; east to the 1053 road and south to row 967; west along
// 967 to the North Gate apron, where they halt because the gate is shut; then back the way they came
// to the Deadleg. The lead rig's distance along the loop is the timetable; the other two follow at a
// fixed gap, so at a stop they close up behind it.
//
// ⚠ THE 1053 ROAD BETWEEN ROWS 968 AND 984 IS INSIDE THE WALL, and the plateau north of the Slake is
// ringed with cliff, which is why the water leg goes round by the west. The regress walks every leg
// against the zone files: no cliff, no `building_type` (the thorn wall is one), no water.
//
// ⚠ THEY KEEP TO THE RIGHT. Two legs are out and back on one road, so each sample is offset to the
// right of travel; the rigs pass each other on the way to and from the gate instead of through.

// Waypoints in tiles, in driving order, closing back on the first.
export const WAYPOINTS = [
  [1024, 957],   // the Deadleg yard
  [1024, 966],
  [1026, 972],
  [1030, 974],   // the Slake's north shore
  [1028, 972],   // back west of the plateau's cliff at x 1030
  [1028, 958],
  [1028, 957],
  [1053, 957],   // the 1053 road
  [1053, 967],
  [1046, 967],   // the North Gate apron
  [1053, 967],
  [1053, 957],
];

// Where the lead rig stops and for how long, by waypoint index.
export const STOPS = { 0: 6 * 60, 3: 4 * 60, 9: 3 * 60 };   // seconds: the yard, the shore, the gate
export const STOP_NAMES = { 0: 'the Deadleg', 3: 'the Slake', 9: 'the North Gate' };

export const MPH = 28;                 // a rotgas rig with no muffler, flat out on a graded track
export const TILE_MPH = 80;            // plugins/trucking/state.js: the road speed that covers a tile a second
export const TILES_PER_S = MPH / TILE_MPH;
export const MPH_MS = 0.44704;
export const LANE = 0.16;              // tiles to the right of travel
export const GAP = 1.3;                // tiles between rigs

// The rigs in column order. `variant` picks the mesh (mesh_column.json `variants`).
export const RIGS = [
  { id: 'column_howl', variant: 'howl', name: 'the Howl' },
  { id: 'column_cart', variant: 'cart', name: 'the Slake cart' },
  { id: 'column_runner', variant: 'runner', name: 'the hound-runner' },
];

// ── The loop, measured once ───────────────────────────────────────────────────
const SEGS = [];
let LOOP = 0;
for (let i = 0; i < WAYPOINTS.length; i++) {
  const a = WAYPOINTS[i], b = WAYPOINTS[(i + 1) % WAYPOINTS.length];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  SEGS.push({ i, a, b, len, at: LOOP });
  LOOP += len;
}
export const LOOP_TILES = LOOP;

// The lead's timetable: a list of phases, each moving along a stretch or standing at a stop. A moving
// phase also carries where the next stop is along the loop and when the column last pulled away,
// which is all the hounds need (houndsAt).
const PHASES = [];
let PERIOD = 0;
for (const s of SEGS) {
  const dwell = STOPS[s.i];
  if (dwell) { PHASES.push({ t0: PERIOD, dur: dwell, s0: s.at, s1: s.at, stop: s.i }); PERIOD += dwell; }
  const dur = s.len / TILES_PER_S;
  PHASES.push({ t0: PERIOD, dur, s0: s.at, s1: s.at + s.len, stop: null });
  PERIOD += dur;
}
export const PERIOD_S = PERIOD;
// Each moving phase learns where the next stop is along the loop and when the column last pulled away
// from one. The first phase is the yard's stop, so every moving phase has a stop behind it in the list;
// the legs after the gate run on to the yard, which is stop 0 again at the far end of the loop, LOOP.
for (let k = 0; k < PHASES.length; k++) {
  const p = PHASES[k];
  if (p.stop != null) continue;
  let j = k - 1;
  while (PHASES[j].stop == null) j--;
  p.departT = PHASES[j].t0 + PHASES[j].dur;
  j = k + 1;
  while (j < PHASES.length && PHASES[j].stop == null) j++;
  p.nextStopS = j < PHASES.length ? PHASES[j].s0 : LOOP;
}

// The lead's distance along the loop at second `t` of the period, whether it is standing, and the
// phase it is in.
function leadAt(t) {
  for (const p of PHASES) {
    if (t < p.t0 + p.dur) return { s: p.s0 + (p.s1 - p.s0) * ((t - p.t0) / (p.dur || 1)), stop: p.stop, p };
  }
  return { s: 0, stop: 0, p: PHASES[0] };
}
// A point a distance `s` along the loop, `lane` tiles to the right of travel, with the heading of
// travel there. `out` is filled in place when given, so a caller on a frame allocates nothing.
function pointAt(s, lane = LANE, out = {}) {
  s = ((s % LOOP) + LOOP) % LOOP;
  let seg = SEGS[SEGS.length - 1];
  for (const q of SEGS) if (s < q.at + q.len) { seg = q; break; }
  const t = seg.len ? (s - seg.at) / seg.len : 0;
  const dx = seg.b[0] - seg.a[0], dy = seg.b[1] - seg.a[1], L = seg.len || 1;
  // Right of travel in map axes (x east, y south) is (-dy, dx) normalised.
  const rx = -dy / L, ry = dx / L;
  out.x = seg.a[0] + dx * t + rx * lane;
  out.y = seg.a[1] + dy * t + ry * lane;
  out.hdg = ((Math.atan2(dx, -dy) * 180 / Math.PI) + 360) % 360;   // 0 north, clockwise
  out.seg = seg.i;
  return out;
}

// The same, with the lane eased round each corner. `pointAt` keeps the lane square to its own
// segment, so at a corner the offset swings from one side of the turn to the other in one step: about
// a third of a tile at the two turnarounds, where the right of travel reverses. A rig only crosses a
// turnaround a gap behind the lead, but a hound runs through one at full stretch, so over the last
// HOUND_CORNER tiles into a corner and the first out of it its right-hand vector is blended with the
// next segment's. Unnormalised, so the dog cuts inside a bend and swings round the end of a U-turn.
const HOUND_CORNER = 0.3;
function lanePoint(s, lane, out) {
  s = ((s % LOOP) + LOOP) % LOOP;
  let k = SEGS.length - 1;
  for (let j = 0; j < SEGS.length; j++) if (s < SEGS[j].at + SEGS[j].len) { k = j; break; }
  const seg = SEGS[k], d = s - seg.at, L = seg.len || 1;
  const ux = (seg.b[0] - seg.a[0]) / L, uy = (seg.b[1] - seg.a[1]) / L;
  let fx = ux, fy = uy;
  let hdg = Math.atan2(ux, -uy) * 180 / Math.PI;
  const nb = d < HOUND_CORNER ? SEGS[(k + SEGS.length - 1) % SEGS.length] : L - d < HOUND_CORNER ? SEGS[(k + 1) % SEGS.length] : null;
  if (nb) {
    const w = 0.5 - 0.5 * Math.min(d, L - d) / HOUND_CORNER;      // the neighbour's share: a half at the corner, none HOUND_CORNER away
    const nL = nb.len || 1, nx = (nb.b[0] - nb.a[0]) / nL, ny = (nb.b[1] - nb.a[1]) / nL;
    fx = ux * (1 - w) + nx * w; fy = uy * (1 - w) + ny * w;
    // The heading turns through the corner rather than flipping at it. A U-turn from the right-hand
    // lane goes round to the left, which is the way the blended offset crosses the road.
    const exit = d < HOUND_CORNER, nh = Math.atan2(nx, -ny) * 180 / Math.PI;
    let turn = exit ? hdg - nh : nh - hdg;                            // the corner's own turn, into it
    turn = ((turn % 360) + 540) % 360 - 180;
    if (Math.abs(turn) > 179.5) turn = lane > 0 ? -180 : 180;
    hdg += (exit ? -turn : turn) * w;
  }
  out.x = seg.a[0] + ux * d - fy * lane;
  out.y = seg.a[1] + uy * d + fx * lane;
  out.hdg = (hdg + 360) % 360;
  return out;
}

const periodT = (nowMs) => ((nowMs / 1000) % PERIOD + PERIOD) % PERIOD;

// Every rig at `nowMs`: `{ id, variant, name, x, y, hdg, ias, stop }`. `ias` is m/s, as a contact
// carries it; `stop` names the waypoint index the column is standing at, or null.
export function columnAt(nowMs = Date.now()) {
  const lead = leadAt(periodT(nowMs));
  const moving = lead.stop == null;
  return RIGS.map((r, i) => {
    const p = pointAt(lead.s - i * GAP);
    return { id: r.id, variant: r.variant, name: r.name, x: p.x, y: p.y, hdg: p.hdg,
      ias: moving ? +(MPH * MPH_MS).toFixed(1) : 0, stop: lead.stop };
  });
}

// The tiles a loop passes through, sampled every `step` tiles on the driven lane: what the regress
// walks against the zone files.
export function routeTiles(step = 0.1) {
  const out = new Set();
  for (let s = 0; s < LOOP; s += step) { const p = pointAt(s); out.add(Math.round(p.x) + ',' + Math.round(p.y)); }
  return [...out].map((k) => k.split(',').map(Number));
}

// ── BRACKEN'S HOUNDS ──────────────────────────────────────────────────────────
//
// A pack that runs out in front of the Howl. Like a flock, the pack is arithmetic rather than an
// entity: each hound's place is its share of a fixed seed and the column's own timetable, so the
// seat that draws them and anything else that asks get the same dogs with nothing on the wire. They
// are not vehicle contacts, because an animal is not a vehicle (see the ⚠ in fauna-model-schema.js).
//
// ⚠ THEY RUN AHEAD ALONG THE LOOP, NOT AHEAD IN A STRAIGHT LINE. A hound's place is a distance along
// the route past the Howl's, so it turns the corner before the rig does, the way a dog that knows the
// road does, and it never cuts across ground the rigs don't drive.
//
// ⚠ AT A STOP THEY COME BACK AND LIE DOWN, AND THE MOVE INTO IT IS CONTINUOUS. A hound's distance
// ahead is held short of the stop the column is coming up to, so the pack gathers there as the Howl
// closes and stands waiting; once the column stands, they lie down in front of it. When the column
// pulls away the pack runs back out to its spread over HOUND_SPREAD_S, a little faster than the rig,
// so nothing ever jumps. The cage on the hound-runner stays empty: the dogs run, they don't ride.
export const HOUND_SEED = 0x6b7a;
export const HOUND_COUNT_MIN = 4, HOUND_COUNT_MAX = 6;
export const HOUND_AHEAD = [0.8, 1.5];     // tiles along the loop in front of the Howl, while running
export const HOUND_REST = [0.5, 0.85];     // ...and lying at a stop; the Howl's plough is 0.35 tiles out
export const HOUND_SIDE = 0.07;            // the widest a hound's own line strays across the lane, tiles
export const HOUND_WEAVE = 0.035;          // how far it weaves about that line as it runs
export const HOUND_SPREAD_S = 9;           // seconds to run back out to the spread after a stop
export const HOUND_STRIDE_HZ = [2.1, 2.7]; // gallop strides a second, per hound

// A hash of the seed and an index into [0, 1).
function h01(i, k) {
  let x = (HOUND_SEED * 374761393 + i * 668265263 + k * 2147483647) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
const lerp = (r, u) => r[0] + (r[1] - r[0]) * u;

// The pack, fixed by the seed: how many, and each one's spread, line, weave and stride.
export const HOUNDS = (() => {
  const n = HOUND_COUNT_MIN + Math.floor(h01(0, 0) * (HOUND_COUNT_MAX - HOUND_COUNT_MIN + 1));
  const out = [];
  for (let i = 0; i < n; i++) {
    // Stratified rather than free, so no two hounds share a place in the pack.
    out.push({
      id: 'hound_' + i,
      ahead: lerp(HOUND_AHEAD, (i + 0.2 + 0.6 * h01(i, 1)) / n),
      rest: lerp(HOUND_REST, (i + 0.2 + 0.6 * h01(i, 2)) / n),
      side: (h01(i, 3) * 2 - 1) * HOUND_SIDE,
      weaveW: (2 * Math.PI) / (5 + 6 * h01(i, 4)),     // a weave every 5 to 11 seconds
      weaveP: h01(i, 5) * 2 * Math.PI,
      surgeW: (2 * Math.PI) / (7 + 9 * h01(i, 6)),     // and it surges and drops back a little
      surgeP: h01(i, 7) * 2 * Math.PI,
      hz: lerp(HOUND_STRIDE_HZ, h01(i, 8)),
      strideP: h01(i, 9),
      lieTurn: (h01(i, 10) * 2 - 1) * 70,             // degrees off the road it lies facing
    });
  }
  return out;
})();
export const HOUND_SURGE = 0.06;           // tiles of surge either way along the loop

const _pt = {};
/**
 * Every hound at `nowMs`: `{ id, x, y, hdg, state, stride }`, with `hdg` in degrees, 0 north and
 * clockwise like the rigs; `state` is 'run' while the column drives, 'walk' (standing) while a hound
 * waits at the stop it has reached and the Howl hasn't, and 'lie' while the column stands; `stride`
 * is the gallop's phase, 0 to 1. Pure arithmetic: `out`, when given, is filled in place and handed
 * back, so a renderer calling this every frame allocates nothing after the first.
 */
export function houndsAt(nowMs = Date.now(), out = []) {
  const t = periodT(nowMs);
  const lead = leadAt(t);
  const p = lead.p;
  const sec = nowMs / 1000;
  out.length = HOUNDS.length;
  for (let i = 0; i < HOUNDS.length; i++) {
    const H = HOUNDS[i];
    const o = out[i] || (out[i] = {});
    o.id = H.id;
    if (lead.stop != null) {
      // Lying in front of the Howl, which stands at the stop.
      lanePoint(lead.s + H.rest, LANE + H.side, _pt);
      o.x = _pt.x; o.y = _pt.y; o.hdg = ((_pt.hdg + H.lieTurn) % 360 + 360) % 360;
      o.state = 'lie'; o.stride = 0;
      continue;
    }
    // Out to the spread, eased from the rest spot over the first seconds after a stop.
    const since = t - p.departT;
    const k = Math.min(1, Math.max(0, since / HOUND_SPREAD_S));
    const ease = k * k * (3 - 2 * k);
    const want = H.rest + (H.ahead - H.rest) * ease + HOUND_SURGE * Math.sin(sec * H.surgeW + H.surgeP) * ease;
    let s = lead.s + want;
    // ...and never past where it will lie at the stop coming up.
    const hold = p.nextStopS + H.rest;
    const waiting = s >= hold;
    if (waiting) s = hold;
    // The weave comes in with the spread and dies away over the last stretch before the hold, so a
    // hound running up to its place at the stop stops on its own line rather than stepping onto it.
    const wf = ease * Math.min(1, (hold - s) / 0.3);
    const lane = LANE + H.side + HOUND_WEAVE * Math.sin(sec * H.weaveW + H.weaveP) * wf;
    lanePoint(s, lane, _pt);
    o.x = _pt.x; o.y = _pt.y;
    if (waiting) { o.hdg = _pt.hdg; o.state = 'walk'; o.stride = 0; continue; }
    // The weave turns the dog a little off the road's own heading: its sideways speed over its speed.
    const sideV = HOUND_WEAVE * H.weaveW * Math.cos(sec * H.weaveW + H.weaveP) * wf;
    o.hdg = ((_pt.hdg + Math.atan2(sideV, TILES_PER_S) * 180 / Math.PI) % 360 + 360) % 360;
    o.state = 'run';
    o.stride = ((sec * H.hz + H.strideP) % 1 + 1) % 1;
  }
  return out;
}

// How far a point is from the loop's centreline, in tiles: what the regress holds the pack to.
export function offRoute(x, y) {
  let best = Infinity;
  for (const q of SEGS) {
    const dx = q.b[0] - q.a[0], dy = q.b[1] - q.a[1], L2 = q.len * q.len || 1;
    const u = Math.min(1, Math.max(0, ((x - q.a[0]) * dx + (y - q.a[1]) * dy) / L2));
    const d = Math.hypot(x - (q.a[0] + dx * u), y - (q.a[1] + dy * u));
    if (d < best) best = d;
  }
  return best;
}

// A hound's distance along the loop in front of the Howl, for the regress: the along-route distance
// of the nearest sample to (x, y) minus the lead's own. Slow (it walks the loop), and never on a frame.
export function aheadOfLead(nowMs, x, y) {
  const lead = leadAt(periodT(nowMs));
  let bestS = 0, bestD = Infinity;
  for (let s = lead.s - 1; s < lead.s + 3; s += 0.005) {
    lanePoint(s, LANE, _pt);
    const d = Math.hypot(_pt.x - x, _pt.y - y);
    if (d < bestD) { bestD = d; bestS = s; }
  }
  return bestS - lead.s;
}
