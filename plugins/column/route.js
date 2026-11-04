// THE COLUMN'S ROUTE AND TIMETABLE: where the three Wildblood rigs are, worked out from the clock.
//
// The column is a pure function of the wall clock, like a flock (client/shared/birds.js): nothing is
// stored, nothing is queried, and any process that asks at the same instant gets the same answer. A
// restart loses nothing, because there is nothing to lose.
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

// The lead's timetable: a list of phases, each moving along a stretch or standing at a stop.
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

// The lead's distance along the loop at second `t` of the period, and whether it is standing.
function leadAt(t) {
  for (const p of PHASES) {
    if (t < p.t0 + p.dur) return { s: p.s0 + (p.s1 - p.s0) * ((t - p.t0) / (p.dur || 1)), stop: p.stop };
  }
  return { s: 0, stop: 0 };
}
// A point a distance `s` along the loop, with the heading of travel there.
function pointAt(s) {
  s = ((s % LOOP) + LOOP) % LOOP;
  let seg = SEGS[SEGS.length - 1];
  for (const q of SEGS) if (s < q.at + q.len) { seg = q; break; }
  const t = seg.len ? (s - seg.at) / seg.len : 0;
  const dx = seg.b[0] - seg.a[0], dy = seg.b[1] - seg.a[1], L = seg.len || 1;
  // Right of travel in map axes (x east, y south) is (-dy, dx) normalised.
  const rx = -dy / L, ry = dx / L;
  return {
    x: seg.a[0] + dx * t + rx * LANE,
    y: seg.a[1] + dy * t + ry * LANE,
    hdg: ((Math.atan2(dx, -dy) * 180 / Math.PI) + 360) % 360,   // 0 north, clockwise
    seg: seg.i,
  };
}

// Every rig at `nowMs`: `{ id, variant, name, x, y, hdg, ias, stop }`. `ias` is m/s, as a contact
// carries it; `stop` names the waypoint index the column is standing at, or null.
export function columnAt(nowMs = Date.now()) {
  const t = ((nowMs / 1000) % PERIOD + PERIOD) % PERIOD;
  const lead = leadAt(t);
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
