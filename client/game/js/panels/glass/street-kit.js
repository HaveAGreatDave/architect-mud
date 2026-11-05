// ── THE STREET KIT: COLDWATER'S LANE, WALKWAYS AND WHAT STANDS ON THEM ───────────────────────────
//
// Coldwater Streets (docs/proposals/coldwater-streets.md). One street, built from parts: a 4 m
// lane between two 5.6 m walkways raised 0.18 m, a steel kerb with a light set into
// its face, a metered strip down each walkway with a toll gate at each end of the block, bollards
// every 2.5 m, a crossing in the middle of the block, a public footbridge with a glass lift at
// each end at the end of the block, planters with benches, vents,
// a service channel along the frontage and guard rails at the corners. Every street tile is drawn
// from the same parts; only where they stand changes.
//
// ⚠ THE DRIVER'S VIEW IS THE BUDGET. Everything along the street stands below a cab's eye (about
// 2.2 m) or out at the frontage, and the small parts (panel joints, hatches, tactile studs, sensor
// eyes, comb plates) are drawn near to only. Over the lane there is the crossing's arm and the
// bridges, and nothing else: the brief's overhead cables stay out for this reason. A lit part is a
// thin line or a ring, never a lamp pointed at you. What moves stays down there too: the belts are in
// the floor, and a plume off a vent is gone by the height of a rig.
//
// ⚠ FIVE CONDITIONS, ONE SET OF PARTS. Core down to dirt are material and damage variants of these
// same parts, read from `LEVEL`, so nothing here is a one-off: a walk outward from the core loses
// money block by block. Chrome stops at the middle ring (the Long Watch rule); from Worn down the
// kit is steel plate and concrete. Bridges and the cameras on them don't decay.
//
// ⚠ NO RENDERER IMPORTS, as glass/media-lot.js has none. The renderer finds the tiles and hands this
// a face sink, a light sink, a lettering sink, an ink sink and a steam sink (drawStreetKitPass in
// windshield.js). The geometry
// goes to the depth buffer as a mark's does, unshaded with a normal and a material. Where a block's
// parts stand (`kitPlace`) is worked out here, once, so the people who walk round them
// (glass/street-kit-walk.js) and the paint agree.
//
// Scale: the ruler, a storey of 3.5 m to 0.196 tiles, so 17.857 m a tile and the whole cross-section
// (15.2 m) fits on one tile. `M(m)` is metres to tiles.
// ⚠ BORROWED FROM THE BIRDS, whose number it is, until client/shared/world-scale.js is committed;
// then import TILE_M and m2t from that.
// Frame: x east, y SOUTH, z up, in tiles, camera-relative (the frame cam.proj takes).
import { BIRD_M_PER_TILE as TILE_M } from '../../../../shared/birds.js';
import { floorsFor } from '../../../../shared/skyline-scale.js';
import { KIT_LANDS, KIT_SPANS, SPAN, drawKitSpan, kitCamera } from './street-kit-spans.js';
export const M = (m) => m / TILE_M;

const TAU = Math.PI * 2;
// A repeatable 0..1 from a seed and a position, so a part keeps its shade from frame to frame.
const hash = (seed, k) => { const x = Math.sin((seed || 0) * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
const newPoint = (x, y, z) => [x, y, z], newQuad = (a, b, c, d) => [a, b, c, d];
const SIDES = Object.freeze([-1, 1]);

// ── THE STREET, IN CONSTANTS ──
// Across the street from the centreline (`v`), along it from the tile centre (`u`). The brief's
// numbers in metres, so the gate (scripts/shapes/street-kit.mjs) can read them back.
export const KIT_M = Object.freeze({
  LANE: 4.0, WALK: 5.6, KERB: 0.18, CAP_W: 0.25,
  PANEL_W: 1.4, PANEL_L: 2.0, PANEL_GAP: 0.07, PANEL_H: 0.02,
  STRIP_W: 1.8, STRIP_H: 0.04, STRIP_EDGE: 0.93, CHEVRON: 2.2,
  BOLLARD_EVERY: 2.5, BOLLARD_H: 0.95, BOLLARD_IN: 0.5, CROSS_GAP: 2.6,
  ZEBRA_L: 3.2, ZEBRA_BAR: 0.5, ZEBRA_PITCH: 0.8,
  POLE_H: 3.4, POLE_IN: 0.45,
  PLANT_EVERY: 15, PLANT_IN: 1.05, VENT_EVERY: 17,
  GATE_IN: 1.5, PRICE_Z: 2.5,
  // The footbridge: the hydrogen hauler is 4.2 m and every bridge clears it by 2.8 m.
  HAULER: 4.2, CLEAR: 2.8, DECK_T: 0.45, DECK_W: 2.6, RAIL_H: 1.1, ARCH: 1.5,
  TOWER_IN: 1.05, TOWER_W: 1.5, TOWER_L: 1.8, TOWER_UP: 2.8, BRIDGE_IN: 6.5,
  LID_W: 0.3, RAIL_RUN: 4.0,
  CAB_EYE: 2.2,
});
const K = KIT_M;
const LANE_HW = M(K.LANE / 2);                 // the kerb face, out from the centreline
const OUT = LANE_HW + M(K.WALK);               // the walkway's outer edge, where the frontage starts
const KERB_H = M(K.KERB);
const STRIP_V = LANE_HW + M(K.WALK / 2);       // the metered strip's centre line
// Paint on the lane, and the lane over the old asphalt. ⚠ ABOVE ROAD_EPS (0.002 tiles, 0.036 m). At
// 0.03 m the lane sat under the road it's drawn over, and went whatever colour the road went.
const LINE_Z = M(0.1), LANE_Z = M(0.07);
const DECK_Z0 = M(K.HAULER + K.CLEAR), DECK_Z1 = DECK_Z0 + M(K.DECK_T);
const TOWER_V = OUT - M(K.TOWER_IN);           // a lift tower's centre, out at the frontage edge
const BRIDGE_U = 0.5 - M(K.BRIDGE_IN);         // where a footbridge crosses its tile
const CROSS_U = 0;                             // where the crossing crosses its tile
const WALK_V = 0.38;                           // the line people walk, out on the free edge (VERGE)

// What the gate and the people read, in tiles.
export const KIT = Object.freeze({ LANE_HW, OUT, KERB_H, LANE_Z, STRIP_V, DECK_Z0, DECK_Z1, TOWER_V, BRIDGE_U, CROSS_U, WALK_V });
// Where the footbridge's lift tower stands on side `s` of a tile: out at the frontage, or on the seam
// down the middle of a two-wide street, where the two halves of the bridge share one tower.
export const kitTowerV = (place, s) => (place && place.inner === s ? s * 0.5 : s * TOWER_V);

// Core-level colours. Chrome is a pale metal that the shader gives a hard highlight; the lane is a
// matte near-black, so the street reads as two bright banks either side of a dark gap.
const PAL = {
  chrome: [214, 222, 230], hatch: [150, 160, 172], band: [10, 12, 16], slab: [11, 13, 18],
  cap: [178, 188, 200], lane: [13, 15, 20], drain: [5, 6, 8], guide: [111, 227, 255], edge: [42, 111, 134],
  cyan: [111, 227, 255], cyanDim: [42, 111, 134], amber: [255, 178, 29], amberDim: [74, 50, 4],
  red: [255, 59, 59], magenta: [255, 79, 163],
  strip: [18, 58, 82], skirt: [52, 60, 74], post: [42, 49, 64], head: [27, 32, 48],
  screen: [4, 16, 25], plinth: [30, 34, 42],
  planter: [42, 49, 64], trunk: [59, 48, 38], crown: [47, 138, 128], bench: [120, 128, 138],
  grate: [10, 12, 16], slat: [34, 38, 46], lid: [36, 42, 52], tactile: [214, 160, 40], stud: [240, 196, 90],
  steel: [154, 166, 181], steelDk: [42, 49, 64], glass: [120, 168, 190], cab: [216, 226, 236],
 
};

// ── THE CONDITION LADDER ─────────────────────────────────────────────────────
//
// One street, five states, from the brief's table and the preview's colours. `districts.
// street_condition` picks the row and every part reads it, so switching a tile's level changes every
// part and adds no new model.
//   top, topMat   the walkway's surface from a distance
//   panels        what the panels near to are made of; `patch` of them are `patches` instead, `gone`
//                 are missing, `door` are a door somebody laid in the gap, and `tilt` is how far a
//                 panel has lifted, in metres
//   marks         'ink' is the chrome's two reflection bands, 'scuff' a worn plate's scratches
//   cyan, amber   every small light; a dead one is the same part in the same place, unlit
//   speed         how fast the strip runs, m/s. Stopped from Worn down, and still priced
//   price         the strip's lettering; null at dirt, where nothing carries words
//   gateGone, bollardGone, bollardFlat  the share of posts missing or knocked over
//   lean          how far a pole or post has gone over, in radians
//   steam         how hard the vents go: more of it the less anybody is looking after them
const DEAD_CYAN = [16, 35, 43], DEAD_AMBER = [26, 18, 6];
export const LEVEL = Object.freeze([
  { name: 'core', top: PAL.chrome, topMat: 'metal', slab: PAL.slab, panels: [PAL.chrome], panelMat: 'metal', hatch: PAL.hatch, patch: 0, patches: null, gone: 0, door: 0, tilt: 0, marks: 'ink',
    cap: PAL.cap, capMat: 'metal', lane: PAL.lane, guide: PAL.guide, cyan: PAL.cyan, cyanMat: 'lit', amber: PAL.amber, amberMat: 'lit', edge: true, cracks: 0,
    strip: PAL.strip, stripMat: 'lit', chevron: PAL.cyan, chevronMat: 'lit', speed: 1.4, price: '#ffb21d', priceLit: true,
    gateGone: 0, bollardGone: 0, bollardFlat: 0, zebra: PAL.amber, zebraMat: 'lit', lamp: 'blink', lean: 0,
    crown: PAL.crown, crownK: 1, tree: 'lit', deck: PAL.chrome, junk: 0, weeds: 0, steam: 1 },
  { name: 'middle', top: [185, 201, 214], topMat: 'metal', slab: PAL.slab, panels: [[185, 201, 214]], panelMat: 'metal', hatch: PAL.hatch, patch: 0.2, patches: [[185, 170, 142], [159, 178, 161], [201, 193, 180], [167, 161, 179]], gone: 0, door: 0, tilt: 0, marks: 'ink',
    cap: PAL.cap, capMat: 'metal', lane: PAL.lane, guide: PAL.guide, cyan: PAL.cyan, cyanMat: 'lit', amber: PAL.amber, amberMat: 'lit', edge: true, cracks: 0,
    strip: PAL.strip, stripMat: 'lit', chevron: PAL.cyan, chevronMat: 'lit', speed: 0.45, price: '#ffb21d', priceLit: true,
    gateGone: 0, bollardGone: 0, bollardFlat: 0, zebra: PAL.amber, zebraMat: 'lit', lamp: 'blink', lean: 0,
    crown: [47, 124, 116], crownK: 1, tree: 'lit', deck: [185, 201, 214], junk: 0, weeds: 0, steam: 1.1 },
  { name: 'worn', top: [136, 140, 142], topMat: 'metal', slab: [58, 58, 56], panels: [[142, 147, 151], [128, 133, 138], [153, 152, 145]], panelMat: 'metal', hatch: [104, 108, 112], patch: 0, patches: null, gone: 0.08, door: 0.015, tilt: 0.02, marks: 'scuff',
    cap: [128, 132, 136], capMat: 'metal', lane: PAL.lane, guide: PAL.cyanDim, cyan: PAL.cyanDim, cyanMat: 'lit', amber: PAL.amberDim, amberMat: 'paint', edge: true, cracks: 0,
    strip: [12, 30, 40], stripMat: 'paint', chevron: [32, 72, 86], chevronMat: 'paint', speed: 0, price: '#b07a10', priceLit: true,
    gateGone: 0, bollardGone: 0.12, bollardFlat: 0, zebra: [176, 122, 16], zebraMat: 'lit', lamp: 'steady', lean: 0,
    crown: [107, 90, 52], crownK: 0.7, tree: 'wilted', deck: [142, 147, 151], junk: 0, weeds: 0, steam: 1.3 },
  { name: 'unmaintained', top: [100, 90, 76], topMat: 'paint', slab: [42, 36, 28], panels: [[125, 106, 85], [110, 111, 106], [138, 106, 72], [92, 90, 82]], panelMat: 'paint', hatch: [84, 74, 62], patch: 0, patches: null, gone: 0.3, door: 0, tilt: 0.05, marks: 'scuff',
    cap: [104, 96, 84], capMat: 'paint', lane: [28, 26, 23], guide: null, cyan: DEAD_CYAN, cyanMat: 'paint', amber: DEAD_AMBER, amberMat: 'paint', edge: false, cracks: 7,
    strip: [20, 22, 22], stripMat: 'paint', chevron: [34, 42, 44], chevronMat: 'paint', speed: 0, price: '#6a5420', priceLit: false,
    gateGone: 0.33, bollardGone: 0.3, bollardFlat: 0.25, zebra: [106, 84, 32], zebraMat: 'paint', lamp: 'dead', lean: 0.22,
    crown: null, crownK: 0, tree: 'stump', deck: [110, 111, 106], junk: 3, weeds: 20, steam: 1.6 },
  { name: 'dirt', dirt: true, price: null, deck: [110, 111, 106], junk: 6, weeds: 12, steam: 0 },
]);

// ── WHERE A BLOCK'S PARTS STAND ──────────────────────────────────────────────
//
// A kit tile: a road whose district sets a street condition, straight or a junction. Dust is dirt,
// so it only takes the kit at the dirt level, and there the kit lays no paving.
export function kitCell(c) {
  return !!c && !!LEVEL[c.sc] && !!c.road && !c.bt && !c.mark && !c.lk && c.rdeg == null && (c.ft !== 'dust' || LEVEL[c.sc].dirt === true);
}
// Whether a kit tile is a built street with a lane and walkways, or the dirt that's left. The
// people's walk, the raised kerb and the old road furniture all ask this rather than kitCell: at the
// dirt level there's no lane to keep anybody out of.
export const kitPaved = (c) => kitCell(c) && !LEVEL[c.sc].dirt;
const KIT_RUN_MAX = 24;   // how far along the street a block is looked for, each way
const PLACE = new WeakMap();
// The sides of a tile with a paved kit tile beyond them that no road joins it to: the two halves of a
// two-wide street, whose walkways run on into each other. Auto-tiled neighbours are always joined, so
// this only ever finds roads authored side by side.
function seamOf(at, rx, ry, rd) {
  let out = '';
  for (const [d, ox, oy] of [['n', 0, -1], ['e', 1, 0], ['s', 0, 1], ['w', -1, 0]]) {
    if (!rd.includes(d) && kitPaved(at(rx + ox, ry + oy))) out += d;
  }
  return out;
}
// What a tile is and what stands on it, or null for no kit. `at(rx, ry)` is the cell at a window
// index, `wide(rx, ry, axis)` the road's `{ width, index }` across (blockSpan in windshield.js). A road
// two tiles wide is two kit streets side by side; a wider one takes no kit. Kept per cell object, which
// is replaced when the window is.
//   axis   'ns' or 'ew' on a straight tile, null on a junction, corner or end
//   run    { i, n }: the straight tile's place in its block of straight kit tiles
//   cross  the block's crossing is on this tile, at CROSS_U
//   bridge a footbridge crosses this tile, at BRIDGE_U: the last tile of a block of two or more
//   span   'service', 'sky' or 'exec', an upper bridge crossing this tile (glass/street-kit-spans.js),
//          or null
//   seam   the sides whose walkway runs on to the tile edge, 'e' and so on
//   inner  which side of a straight tile is the middle of a two-wide street: -1, 1, or 0 on any other
export function kitPlace(at, rx, ry, wide) {
  const c = at(rx, ry);
  if (!kitCell(c)) return null;
  const was = PLACE.get(c);
  if (was !== undefined) return was;
  const rd = c.rd || '';
  const axis = rd === 'ns' || rd === 'ew' ? rd : null;
  const seam = seamOf(at, rx, ry, rd);
  const across = (axis && wide && wide(rx, ry, axis)) || { width: 1, index: 0 };
  // A two-wide road's west or north half has its partner on the +v side. A partner that isn't a paved
  // kit tile, a lock lane say, leaves this half with nothing to join, and no kit.
  const inner = across.width === 2 ? (across.index === 0 ? 1 : -1) : 0;
  const joined = !inner || seam.includes(axis === 'ns' ? (inner > 0 ? 'e' : 'w') : (inner > 0 ? 's' : 'n'));
  let out = null;
  if (axis && across.width <= 2 && joined) {
    const sx = axis === 'ns' ? 0 : 1, sy = axis === 'ns' ? 1 : 0;
    // A block is paved or dirt: a run of tiles doesn't take a crossing from the far side of the line.
    const paved = kitPaved(c), same = (cc) => kitCell(cc) && cc.rd === axis && kitPaved(cc) === paved;
    let lo = 0, hi = 0;
    while (lo < KIT_RUN_MAX && same(at(rx - sx * (lo + 1), ry - sy * (lo + 1)))) lo++;
    while (hi < KIT_RUN_MAX && same(at(rx + sx * (hi + 1), ry + sy * (hi + 1)))) hi++;
    const run = { i: lo, n: lo + hi + 1 };
    out = { axis, arms: rd, seam, inner, run, cross: paved && run.i === Math.floor((run.n - 1) / 2), bridge: paved && run.n >= 2 && run.i === run.n - 1,
      span: spanOn(at, rx, ry, axis, run, inner), level: c.sc };
  } else if (!axis && rd.length) out = { axis: null, arms: rd, seam, inner: 0, run: null, cross: false, bridge: false, span: null, level: c.sc };
  PLACE.set(c, out);
  return out;
}
// How many storeys a tile offers an upper bridge to land in: none unless it's a building with floors
// (KIT_LANDS). A mark is a shed or a wall with no facade to run into, so it offers none either.
const landing = (c) => (c && KIT_LANDS.has(c.bt) && !c.mark ? floorsFor(c.bt, c.flr) : 0);
// The upper bridge on one tile of a block, if any. The whole block is worked out from its first tile
// the same way from every tile in it, so the tiles agree: each class wants one place along the
// block, dearest first, and takes the nearest free tile with both flanks tall enough for it. So a
// block has one of each at most, and only where there are towers to hold them up. Over a two-wide
// street a bridge goes from the far side of one half to the far side of the other, and the west or
// north half (`inner` 1) is the one that draws it.
function spanOn(at, rx, ry, axis, run, inner = 0) {
  if (inner < 0) return null;
  const sx = axis === 'ns' ? 0 : 1, sy = axis === 'ns' ? 1 : 0, reach = inner ? 2 : 1;
  const flank = (i) => {
    const x = rx + sx * (i - run.i), y = ry + sy * (i - run.i);
    return Math.min(landing(at(x - sy, y - sx)), landing(at(x + sy * reach, y + sx * reach)));
  };
  const taken = new Map();
  for (const { kind, floors, at: want } of KIT_SPANS) {
    const aim = want * (run.n - 1);
    let best = -1;
    for (let i = 0; i < run.n; i++) {
      if (taken.has(i) || flank(i) < floors) continue;
      if (best < 0 || Math.abs(i - aim) < Math.abs(best - aim)) best = i;
    }
    if (best >= 0) taken.set(best, kind);
  }
  return taken.get(run.i) || null;
}

// Whether a tile's dynamic pass has anything to draw at that distance. The renderer asks this before
// it runs one, so it has to stay true of drawStreetKit's dynamic pass: the gate checks that a tile this
// says no to draws nothing. A junction has no belts or vents, and the dirt has only what's overhead.
export function kitMoves(P, near) {
  if (P.span) return true;
  return !LEVEL[P.level].dirt && !!P.axis && (near || !!P.cross || !!P.bridge);
}

// ── THE BUILD ────────────────────────────────────────────────────────────────
//
// `o` is everything the renderer knows about this tile and this frame:
//   dx, dy        tile centre, camera-relative
//   place         kitPlace's answer for the tile
//   s0            the tile centre's world coordinate along the axis, in tiles: anything that
//                 repeats along the street (bollards, planters, vents, dashes) is spaced from it, so
//                 a run carries on across tiles and doesn't move when the map window recentres
//   part          'static', 'dynamic', or undefined for both. The renderer runs 'static' once a tile and
//                 keeps it (KIT_SETS in windshield.js), so it may not read now, night or the camera
//   near          true within arm's length: the small parts
//   seed, now, night, alpha
//   face(pts, rgb, a, n, mat)     one convex polygon; `n` and `mat` absent for a lit face
//   light(x, y, z, rgb, s, a)     a glow
//   text(quad, label, css, lit)   lettering on a quad wound TL, TR, BR, BL as it is read
//   line(a, b)                    an ink line between two points; absent with the ink off. The city's
//                                 outline comes off the depth buffer and can't see a step this low,
//                                 so the parts that sit on the ground are ruled by hand
//   steam(x, y, seed, gain)       a plume off a grate; near to, and only in the dynamic pass
//   still                         true with moving parts stopped (RENDER_TUNE.motion 0)
//   p3(x, y, z), l4(a, b, c, d)   a point and a quad's list, from the renderer's pool if it has one: a
//                                 pass that's drawn again next frame needn't make new arrays for them
// A face whose `mat` is 'film' is glass: see the film range in gl/solids.js.
export function drawStreetKit(o) {
  const P = o.place;
  const LV = P && LEVEL[P.level];
  if (!LV) return;
  const alpha = o.alpha == null ? 1 : o.alpha;
  const night = Math.min(1, Math.max(0, o.night || 0));
  // Three tiers by distance: `near` (the small parts), the middle, and `far`, where only what
  // still reads from a cab down the street is drawn: the walkways, the kerbs, the lane's paint, the
  // strips, the trees, and the crossings and bridges. Bollards, vents and chevrons are gone by then.
  const dx = o.dx, dy = o.dy, near = !!o.near, far = !near && !!o.far;
  const doStatic = o.part !== 'dynamic', doDynamic = o.part !== 'static';
  const P3 = o.p3 || newPoint, L4 = o.l4 || newQuad;

  // `xf` is set while a damaged part is drawn: every point goes through it, so a pole leans and a
  // bollard falls over without a second copy of its geometry (see `tilted`).
  let xf = null;
  // On the GPU the shader turns the normal to the eye and shades, so the normal goes over as wound.
  const face = (pts, base, mat, a = alpha) => {
    if (pts.length < 3) return;
    if (xf) pts = pts.map(xf);
    if (mat === 'lit') { o.face(pts, base, a); return; }
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const nl = Math.hypot(nx, ny, nz); if (!(nl > 1e-12)) return;
    o.face(pts, base, a, P3(nx / nl, ny / nl, nz / nl), mat || 'paint');
  };
  const pane = (pts, base, a) => face(pts, base, 'film', a * alpha);
  const write = o.text ? (quad, label, css, lit) => o.text(xf ? quad.map(xf) : quad, label, css, lit) : null;
  const line = o.line ? (a, b) => o.line(xf ? xf(a) : a, xf ? xf(b) : b) : null;
  // Draws `draw` turned about the ground at (x, y) in tile-local coordinates, its top going over
  // toward (gx, gy), a unit direction, by `ang` radians. `up` lifts it clear of the ground, for a
  // part lying on its side rather than leaning.
  const tilted = (x, y, gx, gy, ang, draw, up = 0) => {
    const ox = dx + x, oy = dy + y, c = Math.cos(ang), s = Math.sin(ang);
    xf = ([px, py, pz]) => {
      const rx = px - ox, ry = py - oy, rz = pz - KERB_H, along = rx * gx + ry * gy;
      const a2 = along * c + rz * s, z2 = rz * c - along * s;
      return [ox + rx + gx * (a2 - along), oy + ry + gy * (a2 - along), KERB_H + up + z2];
    };
    try { draw(); } finally { xf = null; }
  };
  const T = (x, y, z) => P3(dx + x, dy + y, z);
  // An axis-aligned box in tile-local x, y. Five faces: nothing here is seen from underneath, except
  // what hangs over the lane, which asks for its bottom.
  const boxXY = (x0, x1, y0, y1, z0, z1, base, mat, top = base, topMat = mat, under = false) => {
    const A = T(x0, y0, z0), B = T(x1, y0, z0), C = T(x1, y1, z0), D = T(x0, y1, z0);
    const A1 = T(x0, y0, z1), B1 = T(x1, y0, z1), C1 = T(x1, y1, z1), D1 = T(x0, y1, z1);
    face(L4(A1, B1, C1, D1), top, topMat);
    face(L4(A, B, B1, A1), base, mat); face(L4(B, C, C1, B1), base, mat);
    face(L4(C, D, D1, C1), base, mat); face(L4(D, A, A1, D1), base, mat);
    if (under) face(L4(D, C, B, A), base, mat);
  };
  const flatXY = (x0, x1, y0, y1, z, base, mat) => face([T(x0, y0, z), T(x1, y0, z), T(x1, y1, z), T(x0, y1, z)], base, mat);
  // A tapered upright drum with a lid, in tile-local x, y.
  const drum = (x, y, r0, r1, z0, z1, n, base, mat, lid = base, lidMat = mat) => {
    const ring = (r, z) => { const out = []; for (let i = 0; i < n; i++) { const a = (i + 0.5) / n * TAU; out.push(T(x + Math.cos(a) * r, y + Math.sin(a) * r, z)); } return out; };
    const b = ring(r0, z0), t = ring(r1, z1);
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; face([b[i], b[j], t[j], t[i]], base, mat); }
    if (lid) face(t, lid, lidMat);
  };
  // A square strut between two points.
  const strut = (a, b, r, base, mat) => {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(d[0], d[1], d[2]);
    if (!(L > 1e-6)) return;
    const u = [d[0] / L, d[1] / L, d[2] / L];
    const s1l = Math.hypot(-u[1], u[0]);
    const s1 = s1l > 1e-6 ? [-u[1] / s1l * r, u[0] / s1l * r, 0] : [r, 0, 0];
    const s2 = [u[1] * s1[2] - u[2] * s1[1], u[2] * s1[0] - u[0] * s1[2], u[0] * s1[1] - u[1] * s1[0]];
    const at = (p, i, j) => [p[0] + s1[0] * i + s2[0] * j, p[1] + s1[1] * i + s2[1] * j, p[2] + s1[2] * i + s2[2] * j];
    const q = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let k = 0; k < 4; k++) {
      const [i0, j0] = q[k], [i1, j1] = q[(k + 1) % 4];
      face([at(a, i0, j0), at(a, i1, j1), at(b, i1, j1), at(b, i0, j0)], base, mat);
    }
  };

  // The street frame: `u` along it, `v` across it. A junction has no axis, and nothing placed in this
  // frame stands on one.
  const ns = P.axis !== 'ew';
  const U = ns ? [0, 1] : [1, 0], V = ns ? [1, 0] : [0, 1];
  const F = (u, v, z) => P3(dx + U[0] * u + V[0] * v, dy + U[1] * u + V[1] * v, z);
  const loc = (u, v) => [U[0] * u + V[0] * v, U[1] * u + V[1] * v];
  // A box in the street frame: centre (u, v), half-extents (hu along, hv across).
  const box = (u, v, hu, hv, z0, z1, base, mat, top = base, topMat = mat, under = false) => {
    const [a, b] = loc(u - hu, v - hv), [c, d] = loc(u + hu, v + hv);
    boxXY(Math.min(a, c), Math.max(a, c), Math.min(b, d), Math.max(b, d), z0, z1, base, mat, top, topMat, under);
  };
  const flat = (u, v, hu, hv, z, base, mat) => {
    const [a, b] = loc(u - hu, v - hv), [c, d] = loc(u + hu, v + hv);
    flatXY(Math.min(a, c), Math.max(a, c), Math.min(b, d), Math.max(b, d), z, base, mat);
  };
  const drumAt = (u, v, r0, r1, z0, z1, n, base, mat, lid, lidMat) => { const [x, y] = loc(u, v); drum(x, y, r0, r1, z0, z1, n, base, mat, lid, lidMat); };
  // Tilted about (u, v) with its top going over toward (du, dv), in the street frame.
  const tiltedAt = (u, v, du, dv, ang, draw, up) => { const [x, y] = loc(u, v), [gx, gy] = loc(du, dv); tilted(x, y, gx, gy, ang, draw, up); };
  // The rim of a box in the street frame, in ink. The depth-based outline gets a part that stands up
  // from the street, and misses a part this close to the ground.
  const rimAt = (u, v, hu, hv, z) => {
    if (!line) return;
    const a = F(u - hu, v - hv, z), b = F(u + hu, v - hv, z), c = F(u + hu, v + hv, z), d = F(u - hu, v + hv, z);
    line(a, b); line(b, c); line(c, d); line(d, a);
  };
  // A quad standing across the street at `u`, read by somebody facing -toward along it. `r` is
  // which way +v lies on their right. Wound TL, TR, BR, BL as read.
  const signQuad = (u, v, hw, z0, z1, toward) => {
    const r = toward * (ns ? 1 : -1);
    return [F(u, v - r * hw, z1), F(u, v + r * hw, z1), F(u, v + r * hw, z0), F(u, v - r * hw, z0)];
  };
  // What the upper bridges and the cameras draw with (glass/street-kit-spans.js).
  const tools = () => ({ box, strut, face, pane, F, line, text: write, light: o.light, signQuad, near, far, doStatic, doDynamic, now: o.now, night });
  // A bridge over a two-wide street is centred on the seam, half a tile across from this tile's
  // centre, and reaches that much further each way.
  const spanTools = () => {
    const B = tools();
    if (!P.inner) return B;
    const c = 0.5 * P.inner;
    return { ...B, land: SPAN.LAND + 0.5, F: (u, v, z) => F(u, v + c, z), box: (u, v, ...rest) => box(u, v + c, ...rest) };
  };
  const spanOver = () => drawKitSpan(P.span, spanTools());

  const arms = P.arms || '';
  const has = (d) => arms.includes(d);

  // A weed: a three-sided spike. Rust and dirt grow them, near to only.
  const weed = (x, y, z, h) => {
    const r = M(0.06), a0 = hash(o.seed, x * 977 + y * 613) * TAU;
    const b = [0, 1, 2].map((i) => T(x + Math.cos(a0 + i * TAU / 3) * r, y + Math.sin(a0 + i * TAU / 3) * r, z));
    const top = T(x + r * 0.8, y, z + h);
    for (let i = 0; i < 3; i++) face([b[i], b[(i + 1) % 3], top], [79, 107, 42], 'paint');
  };
  // Junk: a crate, a drum or a panel somebody prised up, by the roll `r`, standing at (x, y).
  const junkAt = (x, y, z, r) => {
    const a = M(0.3 + hash(o.seed, x * 31) * 0.5), b = M(0.3 + hash(o.seed, y * 37) * 0.6);
    if (r < 0.45) boxXY(x - a, x + a, y - b, y + b, z, z + M(0.3 + r), [74, 64, 56], 'paint');
    else if (r < 0.8) drum(x, y, M(0.3), M(0.3), z, z + M(0.9), near ? 8 : 5, r < 0.62 ? [138, 61, 30] : [79, 90, 58], 'paint', [40, 36, 32], 'paint');
    else boxXY(x - M(0.7), x + M(0.7), y - M(1), y + M(1), z, z + M(0.06), [138, 143, 147], 'paint');
  };

  // ── THE DIRT: NOTHING WAS EVER BUILT HERE ──
  // A track with two ruts, puddles standing in it, junk and weeds. No paving, no strips, no bollards,
  // no crossing, and no words: Old Coldwater carries none. The bridges still go over.
  if (LV.dirt) {
    if (doStatic) {
      const brown = [106, 80, 52], rut = [64, 46, 28], water = [34, 58, 74];
      flatXY(-0.5, 0.5, -0.5, 0.5, LANE_Z, brown, 'paint');
      const blob = (px, py, r, z, rgb, mat) => {
        const n = 8, pts = [];
        for (let k = 0; k < n; k++) pts.push(T(px + Math.cos(k / n * TAU) * r, py + Math.sin(k / n * TAU) * r * 0.6, z));
        face(pts, rgb, mat);
      };
      // Worn and churned patches, so it reads as ground and not as a brown floor.
      if (!far) for (let i = 0; i < 7; i++) {
        const px = (hash(o.seed, i * 3 + 21) - 0.5) * 0.8, py = (hash(o.seed, i * 3 + 22) - 0.5) * 0.8, r = M(1.2 + hash(o.seed, i * 3 + 23) * 2.2);
        blob(px, py, r, LANE_Z + M(0.005), i % 2 ? [92, 68, 44] : [120, 94, 64], 'paint');
      }
      for (const e of [-1, 1]) {
        if (!P.axis || P.axis === 'ns') flatXY(e * M(0.9) - M(0.35), e * M(0.9) + M(0.35), -0.5, 0.5, LANE_Z + M(0.01), rut, 'paint');
        if (!P.axis || P.axis === 'ew') flatXY(-0.5, 0.5, e * M(0.9) - M(0.35), e * M(0.9) + M(0.35), LANE_Z + M(0.01), rut, 'paint');
      }
      if (!far) {
        for (let i = 0; i < 3; i++) {
          blob((hash(o.seed, i * 3 + 1) - 0.5) * 0.7, (hash(o.seed, i * 3 + 2) - 0.5) * 0.7, M(0.7 + hash(o.seed, i * 3 + 3) * 1.1), LANE_Z + M(0.02), water, 'metal');
        }
        for (let i = 0; i < LV.junk; i++) {
          const a = hash(o.seed, i * 5 + 40), b = hash(o.seed, i * 5 + 41);
          // Off the ruts, so a hauler still has a way through.
          junkAt((a < 0.5 ? -1 : 1) * (M(2.2) + hash(o.seed, i * 5 + 42) * M(5)), (b - 0.5) * 0.85, LANE_Z, hash(o.seed, i * 5 + 43));
        }
        // A burnt-out pod on one tile in eight, nose down in the verge.
        if (hash(o.seed, 77) < 0.125) {
          const px = (hash(o.seed, 78) < 0.5 ? -1 : 1) * M(4.5), n = near ? 10 : 6, rx = M(0.95), ry = M(1.9), zt = M(1.0);
          const shell = [58, 51, 48];
          for (let i = 0; i < n; i++) {
            const a = i / n * TAU, b = (i + 1) / n * TAU;
            const lo = (t) => T(px + Math.cos(t) * rx, Math.sin(t) * ry, LANE_Z), hi = (t) => T(px + Math.cos(t) * rx * 0.55, Math.sin(t) * ry * 0.6, zt);
            face([lo(a), lo(b), hi(b), hi(a)], shell, 'paint');
          }
          const lid = []; for (let i = 0; i < n; i++) { const t = i / n * TAU; lid.push(T(px + Math.cos(t) * rx * 0.55, Math.sin(t) * ry * 0.6, zt)); }
          face(lid, [24, 22, 20], 'paint');
        }
      }
      if (near) for (let i = 0; i < LV.weeds; i++) {
        const a = hash(o.seed, i * 2 + 60), b = hash(o.seed, i * 2 + 61);
        weed((a < 0.5 ? -1 : 1) * (M(2.4) + (a * 2 % 1) * M(5)), (b - 0.5) * 0.95, LANE_Z, M(0.2 + b * 0.4));
      }
    }
    if (P.span) spanOver();
    return;
  }

  // ── THE GROUND: LANE, WALKWAYS, KERBS ──
  if (doStatic) {
    // A walkway is a dark slab with the panels standing on it. Far off it's the slab with a panel-
    // coloured top; near to, the slab drops by a panel's thickness and the panels sit on it with a
    // gap between each, so the joints read as dark lines and each panel carries two ink bands. One
    // panel in sixteen is an inspection hatch: duller, bolted at the corners, with a status pip.
    // Down the ladder a panel is patched, dented, lifted, missing or a door somebody laid in the gap.
    const walk = (x0, x1, y0, y1, alongX) => {
      if (!near) {
        boxXY(x0, x1, y0, y1, 0, KERB_H, LV.slab, 'paint', LV.top, LV.topMat);
        if (far || !LV.gone) return;
      } else boxXY(x0, x1, y0, y1, 0, KERB_H - M(K.PANEL_H), LV.slab, 'paint');
      const W = alongX ? y1 - y0 : x1 - x0, L = alongX ? x1 - x0 : y1 - y0;
      const cols = Math.max(1, Math.round(W / M(K.PANEL_W))), rows = Math.max(1, Math.round(L / M(K.PANEL_L)));
      const cw = W / cols, rl = L / rows, g = M(K.PANEL_GAP) / 2;
      for (let ci = 0; ci < cols; ci++) for (let ri = 0; ri < rows; ri++) {
        // (a, b) across and along the panel, 0..1, mapped to tile-local x, y.
        const q = (a, b, z) => {
          const w = (ci + a) * cw, l = (ri + b) * rl;
          return alongX ? T(x0 + l, y0 + w, z) : T(x0 + w, y0 + l, z);
        };
        const ga = g / cw, gb = g / rl;
        const k = Math.round((x0 + x1) * 977 + (y0 + y1) * 613) + ci * 31 + ri * 7;
        const roll = hash(o.seed, k + 501);
        if (roll < LV.gone) {
          // From the middle distance a missing panel is a dark hole in the surface. Near to the slab
          // shows through anyway, and half the holes have something growing out of them.
          if (!near) face([q(0, 0, KERB_H + M(0.004)), q(1, 0, KERB_H + M(0.004)), q(1, 1, KERB_H + M(0.004)), q(0, 1, KERB_H + M(0.004))], LV.slab, 'paint');
          else if (LV.weeds && roll < LV.gone / 2) {
            const c = q(0.5, 0.5, KERB_H - M(K.PANEL_H));
            // The grid runs under the belt, and nothing grows up through a belt.
            const off = Math.abs(P.axis === 'ew' ? c[1] - dy : c[0] - dx);
            if (P.axis && Math.abs(off - STRIP_V) < M(K.STRIP_W / 2 + 0.3)) continue;
            for (let i = 0; i < 3; i++) weed(c[0] - dx + M(i * 0.3 - 0.3), c[1] - dy + M(i * 0.2 - 0.2), KERB_H - M(K.PANEL_H), M(0.3 + i * 0.15));
          }
          continue;
        }
        if (!near) continue;
        // A lifted panel is a plane through its centre: the two slopes, and how high it sits.
        const lift = LV.tilt ? M(LV.tilt) : 0, sa = lift * (hash(o.seed, k + 503) - 0.5) * 2, sb = lift * (hash(o.seed, k + 504) - 0.5) * 2;
        const zOf = (a, b, up = 0) => KERB_H + up + sa * (a - 0.5) + sb * (b - 0.5);
        const quad = (a0, a1, b0, b1, up, rgb, mat) => face([q(a0, b0, zOf(a0, b0, up)), q(a1, b0, zOf(a1, b0, up)), q(a1, b1, zOf(a1, b1, up)), q(a0, b1, zOf(a0, b1, up))], rgb, mat);
        if (roll < LV.gone + LV.door) {
          // A door, brown, with its handle still on.
          quad(ga, 1 - ga, gb, 1 - gb, 0, [107, 74, 46], 'paint');
          for (const b of [0.33, 0.66]) quad(0.1, 0.9, b, b + 0.02, M(0.006), [60, 40, 24], 'paint');
          quad(0.78, 0.86, 0.46, 0.54, M(0.012), [150, 140, 110], 'metal');
          continue;
        }
        const isHatch = hash(o.seed, k) < 1 / 16;
        const patched = LV.patch && hash(o.seed, k + 505) < LV.patch;
        const rgb = isHatch ? LV.hatch : patched ? LV.patches[Math.floor(hash(o.seed, k + 506) * LV.patches.length)] : LV.panels[Math.floor(hash(o.seed, k + 507) * LV.panels.length)];
        quad(ga, 1 - ga, gb, 1 - gb, 0, rgb, patched ? 'paint' : LV.panelMat);
        const zb = M(0.008);
        if (isHatch) {
          // Four bolts and a status pip, and no bands: a hatch is a lid, not a mirror.
          for (const [a, b] of [[0.12, 0.1], [0.88, 0.1], [0.88, 0.9], [0.12, 0.9]]) {
            const e = M(0.05) / cw, f = M(0.05) / rl;
            quad(a - e, a + e, b - f, b + f, zb, PAL.band, 'paint');
          }
          const e = M(0.06) / cw, f = M(0.06) / rl;
          quad(0.5 - e, 0.5 + e, 0.5 - f, 0.5 + f, zb, LV.cyan, LV.cyanMat);
          continue;
        }
        if (patched) continue;
        if (LV.marks === 'ink') {
          // Two ink bands across each panel, leaning the same way on every panel in the city: the
          // comic read of a reflection. From the preview's band texture, in panel fractions.
          face([q(0.06, 1, KERB_H + zb), q(0.34, 1, KERB_H + zb), q(0.66, 0, KERB_H + zb), q(0.38, 0, KERB_H + zb)], PAL.band, 'paint');
          face([q(0.55, 1, KERB_H + zb), q(0.64, 1, KERB_H + zb), q(0.95, 0, KERB_H + zb), q(0.86, 0, KERB_H + zb)], PAL.band, 'paint');
        } else {
          // Plate takes no reflection, only what's been done to it: a couple of scratches in ink.
          for (let i = 0; i < 2; i++) {
            const a = 0.15 + hash(o.seed, k + 510 + i) * 0.6, b = 0.1 + hash(o.seed, k + 512 + i) * 0.7, c = a + 0.2 * (hash(o.seed, k + 514 + i) - 0.5), w = 0.02;
            face([q(a, b, zOf(a, b, zb)), q(a + w, b, zOf(a + w, b, zb)), q(c + w, b + 0.2, zOf(c + w, b + 0.2, zb)), q(c, b + 0.2, zOf(c, b + 0.2, zb))], PAL.band, 'paint');
          }
        }
      }
    };
    // The kerb: a steel cap along the lane edge of a walkway, a hair proud of the panels, with a
    // cyan light set into the face the lane sees and a drain slot in the lane at its foot.
    // (x0..x1, y0..y1) is the cap's footprint; `ax` says the face runs along x (an east-west
    // kerb) and `fs` which way it faces, -1 or +1 across.
    const CAP = M(K.CAP_W), DR = M(0.2), DR_IN = M(0.1);
    const kerb = (x0, x1, y0, y1, ax, fs) => {
      boxXY(x0, x1, y0, y1, 0, KERB_H + M(0.015), LV.cap, LV.capMat);
      const zl0 = M(0.09), zl1 = M(0.14), zt = KERB_H + M(0.015);
      if (line) {
        // The edge the lane sees, at the top and the foot, and near to the edge the walkway sees.
        const yl = fs < 0 ? y0 : y1, xl = fs < 0 ? x0 : x1, yb = fs < 0 ? y1 : y0, xb = fs < 0 ? x1 : x0;
        if (ax) { line(T(x0, yl, zt), T(x1, yl, zt)); if (!far) line(T(x0, yl, LANE_Z), T(x1, yl, LANE_Z)); if (near) line(T(x0, yb, zt), T(x1, yb, zt)); }
        else { line(T(xl, y0, zt), T(xl, y1, zt)); if (!far) line(T(xl, y0, LANE_Z), T(xl, y1, LANE_Z)); if (near) line(T(xb, y0, zt), T(xb, y1, zt)); }
      }
      if (ax) {
        const fy = (fs < 0 ? y0 : y1) + fs * M(0.004);
        face([T(x0, fy, zl0), T(x1, fy, zl0), T(x1, fy, zl1), T(x0, fy, zl1)], LV.cyan, LV.cyanMat);
        const d0 = fy + fs * DR_IN, d1 = d0 + fs * DR;
        flatXY(x0, x1, Math.min(d0, d1), Math.max(d0, d1), LANE_Z + M(0.004), PAL.drain, 'paint');
        if (near) for (let x = x0 + M(0.15); x < x1; x += M(0.3)) flatXY(x, x + M(0.05), Math.min(d0, d1), Math.max(d0, d1), LANE_Z + M(0.008), PAL.slat, 'metal');
      } else {
        const fx = (fs < 0 ? x0 : x1) + fs * M(0.004);
        face([T(fx, y0, zl0), T(fx, y1, zl0), T(fx, y1, zl1), T(fx, y0, zl1)], LV.cyan, LV.cyanMat);
        const d0 = fx + fs * DR_IN, d1 = d0 + fs * DR;
        flatXY(Math.min(d0, d1), Math.max(d0, d1), y0, y1, LANE_Z + M(0.004), PAL.drain, 'paint');
        if (near) for (let y = y0 + M(0.15); y < y1; y += M(0.3)) flatXY(Math.min(d0, d1), Math.max(d0, d1), y, y + M(0.05), LANE_Z + M(0.008), PAL.slat, 'metal');
      }
    };
    // A low guard rail along a kerb at a corner, which is where people would otherwise step off:
    // posts every 1.5 m, a top rail with a cyan line along it and a mid rail. 1.0 m, under a cab's eye.
    const rail = (ax, a0, a1, c) => {
      const zt = KERB_H + M(1.0), zm = KERB_H + M(0.5), rr = M(0.03);
      const P3 = (a, z) => ax ? T(a, c, z) : T(c, a, z);
      const n = Math.max(1, Math.round(Math.abs(a1 - a0) / M(1.5)));
      for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; strut(P3(a, KERB_H), P3(a, zt), rr, PAL.steel, 'metal'); }
      strut(P3(a0, zt), P3(a1, zt), rr * 1.2, PAL.steel, 'metal');
      strut(P3(a0, zm), P3(a1, zm), rr * 0.8, PAL.steel, 'metal');
      const h = M(0.012);
      if (ax) face([T(a0, c, zt + rr * 1.3), T(a1, c, zt + rr * 1.3), T(a1, c, zt + rr * 1.3 + h), T(a0, c, zt + rr * 1.3 + h)], LV.cyan, LV.cyanMat);
      else face([T(c, a0, zt + rr * 1.3), T(c, a1, zt + rr * 1.3), T(c, a1, zt + rr * 1.3 + h), T(c, a0, zt + rr * 1.3 + h)], LV.cyan, LV.cyanMat);
    };
    // Cracks in the lane, as a few short dark runs, near to only: nobody has resurfaced it.
    const cracks = (x0, x1, y0, y1) => {
      if (!near) return;
      for (let i = 0; i < LV.cracks; i++) {
        let px = x0 + (x1 - x0) * hash(o.seed, i * 3 + 201), py = y0 + (y1 - y0) * hash(o.seed, i * 3 + 202);
        for (let j = 0; j < 4; j++) {
          const a = hash(o.seed, i * 9 + j + 203) * TAU, L = M(0.5 + hash(o.seed, i * 9 + j + 207) * 0.9);
          const nx = Math.min(x1, Math.max(x0, px + Math.cos(a) * L)), ny = Math.min(y1, Math.max(y0, py + Math.sin(a) * L)), w = M(0.025), z = LANE_Z + M(0.005);
          const l = Math.hypot(nx - px, ny - py) || 1, ox = -(ny - py) / l * w, oy = (nx - px) / l * w;
          face([T(px - ox, py - oy, z), T(px + ox, py + oy, z), T(nx + ox, ny + oy, z), T(nx - ox, ny - oy, z)], PAL.drain, 'paint');
          px = nx; py = ny;
        }
      }
    };

    if (P.axis) {
      // A straight tile: the lane the full length, one walkway each side.
      const ns = P.axis === 'ns';
      if (ns) { flatXY(-LANE_HW, LANE_HW, -0.5, 0.5, LANE_Z, LV.lane, 'paint'); cracks(-LANE_HW, LANE_HW, -0.5, 0.5); }
      else { flatXY(-0.5, 0.5, -LANE_HW, LANE_HW, LANE_Z, LV.lane, 'paint'); cracks(-0.5, 0.5, -LANE_HW, LANE_HW); }
      for (const s of [-1, 1]) {
        const a = s * LANE_HW, b = s * (s === P.inner ? 0.5 : OUT), lo = Math.min(a, b), hi = Math.max(a, b);
        const c0 = s > 0 ? LANE_HW : -LANE_HW - CAP;
        if (ns) { walk(lo, hi, -0.5, 0.5, false); kerb(c0, c0 + CAP, -0.5, 0.5, false, -s); }
        else { walk(-0.5, 0.5, lo, hi, true); kerb(-0.5, 0.5, c0, c0 + CAP, true, -s); }
        // The walkway's outer edge, against the frontage.
        if (line && s !== P.inner) { if (ns) line(T(b, -0.5, KERB_H), T(b, 0.5, KERB_H)); else line(T(-0.5, b, KERB_H), T(0.5, b, KERB_H)); }
      }
    } else {
      // A junction, a corner or an end: the lane down every arm and across the box, a walkway in
      // each quadrant (out to the tile edge along an arm, to the frontage otherwise), a strip of
      // walkway along every side with no arm, and a guard rail at each corner where a kerb turns.
      flatXY(-LANE_HW, LANE_HW, -LANE_HW, LANE_HW, LANE_Z, LV.lane, 'paint');
      if (has('n')) flatXY(-LANE_HW, LANE_HW, -0.5, -LANE_HW, LANE_Z, LV.lane, 'paint');
      if (has('s')) flatXY(-LANE_HW, LANE_HW, LANE_HW, 0.5, LANE_Z, LV.lane, 'paint');
      if (has('w')) flatXY(-0.5, -LANE_HW, -LANE_HW, LANE_HW, LANE_Z, LV.lane, 'paint');
      if (has('e')) flatXY(LANE_HW, 0.5, -LANE_HW, LANE_HW, LANE_Z, LV.lane, 'paint');
      cracks(-LANE_HW, LANE_HW, -LANE_HW, LANE_HW);
      const RUN = M(K.RAIL_RUN), RIN = LANE_HW + M(0.3);
      const edge = (d) => ((P.seam || '').includes(d) ? 0.5 : OUT);   // a seam's walkway runs to the tile edge
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        const armX = has(sx > 0 ? 'e' : 'w'), armY = has(sy > 0 ? 's' : 'n');
        const ex = armX ? 0.5 : edge(sx > 0 ? 'e' : 'w'), ey = armY ? 0.5 : edge(sy > 0 ? 's' : 'n');
        const x0 = Math.min(sx * LANE_HW, sx * ex), x1 = Math.max(sx * LANE_HW, sx * ex);
        const y0 = Math.min(sy * LANE_HW, sy * ey), y1 = Math.max(sy * LANE_HW, sy * ey);
        walk(x0, x1, y0, y1, ex > ey);
        // A kerb along each edge of the quadrant that faces a lane.
        if (armX) { const c0 = sy > 0 ? LANE_HW : -LANE_HW - CAP; kerb(x0, x1, c0, c0 + CAP, true, -sy); }
        if (armY) { const c0 = sx > 0 ? LANE_HW : -LANE_HW - CAP; kerb(c0, c0 + CAP, y0, y1, false, -sx); }
        // Somebody has had one rail of each pair away for scrap, once nobody was looking after them.
        if (near && !(LV.lean && hash(o.seed, sx * 3 + sy + 90) < 0.5)) {
          if (armX) rail(true, sx * LANE_HW, sx * Math.min(0.5, LANE_HW + RUN), sy * RIN);
          if (armY) rail(false, sy * LANE_HW, sy * Math.min(0.5, LANE_HW + RUN), sx * RIN);
        }
      }
      for (const [d, sx, sy] of [['n', 0, -1], ['s', 0, 1], ['w', -1, 0], ['e', 1, 0]]) {
        if (has(d)) continue;
        const out = edge(d);
        if (sx === 0) {
          const y0 = Math.min(sy * LANE_HW, sy * out), y1 = Math.max(sy * LANE_HW, sy * out);
          walk(-LANE_HW, LANE_HW, y0, y1, true);
          const c0 = sy > 0 ? LANE_HW : -LANE_HW - CAP; kerb(-LANE_HW, LANE_HW, c0, c0 + CAP, true, -sy);
        } else {
          const x0 = Math.min(sx * LANE_HW, sx * out), x1 = Math.max(sx * LANE_HW, sx * out);
          walk(x0, x1, -LANE_HW, LANE_HW, false);
          const c0 = sx > 0 ? LANE_HW : -LANE_HW - CAP; kerb(c0, c0 + CAP, -LANE_HW, LANE_HW, false, -sx);
        }
      }
    }
  }

  // Everything below stands on a straight tile. The block's own parts (gates, crossing, bridge)
  // are placed from `run`.
  if (!P.axis) return;
  // Studded tactile paving where people step off or wait: an amber pad, its studs near to.
  const tactile = (u, v, hu, hv) => {
    const z = KERB_H + M(0.006), fresh = LV.lamp === 'blink';
    flat(u, v, hu, hv, z, fresh ? PAL.tactile : LV.zebra, 'paint');
    if (!near) return;
    const st = M(0.06), pitch = M(0.25);
    for (let a = -hu + pitch / 2; a < hu; a += pitch) for (let b = -hv + pitch / 2; b < hv; b += pitch) flat(u + a, v + b, st, st, z + M(0.006), fresh ? PAL.stud : LV.zebra, 'paint');
  };

  const run = P.run || { i: 0, n: 1 };
  const first = run.i === 0, last = run.i === run.n - 1;
  const crossHere = !!P.cross, bridgeHere = !!P.bridge;
  const tm = TILE_M, s0 = o.s0 || 0;
  // World-spaced positions along the street inside this tile: every `every` metres, from `off`.
  const spaced = (every, off) => {
    const out = [];
    const lo = Math.ceil(((s0 - 0.5) * tm - off) / every), hi = Math.floor(((s0 + 0.5) * tm - off) / every - 1e-9);
    for (let k = lo; k <= hi; k++) out.push(((k * every + off) / tm) - s0);
    return out;
  };
  const nearCross = (u, m) => crossHere && Math.abs(u - CROSS_U) < M(m);
  const nearBridge = (u, m) => bridgeHere && Math.abs(u - BRIDGE_U) < M(m);
  // The chevrons on one belt, `travel` metres along the way it runs. A belt with no speed, or one
  // past arm's length, draws them once with the static parts; near to they run.
  const beltMoves = LV.speed > 0 && !o.still;
  const chevrons = (s, travel) => {
    const v = s * STRIP_V, dir = ns ? -s : s, zc = KERB_H + M(K.STRIP_H) + M(0.006), arm = M(0.55), wd = M(0.11);
    const at = spaced(K.CHEVRON, (s > 0 ? 0 : K.CHEVRON / 2) + dir * (travel % K.CHEVRON));
    for (let i = 0; i < at.length; i++) {
      const u = at[i];
      for (let j = 0; j < 2; j++) {
        // One stroke of the V: from the point (u + dir·0.3 m) back out to the side.
        const e = SIDES[j], tipU = u + dir * M(0.3), endU = u - dir * M(0.3), endV = v + e * arm;
        const nu = -(endV - v), nv = endU - tipU, nl = Math.hypot(nu, nv) || 1;
        const pu = nu / nl * wd / 2, pv = nv / nl * wd / 2;
        face(L4(F(tipU - pu, v - pv, zc), F(tipU + pu, v + pv, zc), F(endU + pu, endV + pv, zc), F(endU - pu, endV - pv, zc)), LV.chevron, LV.chevronMat);
      }
    }
  };
  // The vents down one side, as [u, v]. The paint and the steam both read this.
  const vents = (s) => spaced(K.VENT_EVERY, s > 0 ? 10 : 7).filter((u) => !nearCross(u, 3) && !nearBridge(u, 3)).map((u) => [u, s * (LANE_HW + M(K.PLANT_IN))]);
  // A crossing pole, lamp included: it goes over away from the lane once nobody is looking after it.
  const crossPole = (s, draw) => {
    if (LV.lean) tiltedAt(CROSS_U - M(2), s * (LANE_HW + M(K.POLE_IN)), 0, s, s > 0 ? LV.lean : LV.lean * 0.55, draw);
    else draw();
  };

  if (doStatic) {
    // ── THE LANE'S PAINT ──
    // A dashed cyan guide line down the middle (a 2.9 m dash in a 4.7 m pitch) and an edge line inside
    // each drain near to.
    if (LV.guide) for (const u of spaced(TILE_M / 3.8, 0)) {
      if (nearCross(u, K.ZEBRA_L / 2 + 1.45)) continue;   // no dash through the zebra
      box(u, 0, M(1.45), M(0.08), LANE_Z, LINE_Z, LV.guide, 'lit');
    }
    if (near && LV.edge) for (const s of [-1, 1]) box(0, s * (LANE_HW - M(0.5)), 0.5, M(0.025), LANE_Z, LINE_Z, PAL.edge, 'lit');
    // ── THE METERED STRIP ──
    // A belt down the middle of each walkway in a steel housing, chevrons pointing the way it runs,
    // amber lights along the top of the housing. The belt on your right carries you forward: facing
    // -u on a north-south street your right is +v, facing +u on an east-west one it's +v too. Near to
    // on a running belt the chevrons move, so they're drawn with what moves below.
    for (const s of [-1, 1]) {
      const v = s * STRIP_V, zt = KERB_H + M(K.STRIP_H);
      box(0, v, 0.5, M(K.STRIP_W / 2), KERB_H, zt, LV.strip, 'paint', LV.strip, LV.stripMat);
      for (const e of [-1, 1]) {
        const ve = v + e * (M(K.STRIP_W / 2) + M(0.04));
        if (far) { box(0, ve, 0.5, M(0.012), KERB_H, KERB_H + M(0.06), LV.amber, LV.amberMat); continue; }
        box(0, ve, 0.5, M(0.04), KERB_H, KERB_H + M(0.08), PAL.skirt, 'metal');
        box(0, ve, 0.5, M(0.012), KERB_H + M(0.08), KERB_H + M(0.092), LV.amber, LV.amberMat);
        if (line) { const vo = ve + e * M(0.04); line(F(-0.5, vo, KERB_H + M(0.08)), F(0.5, vo, KERB_H + M(0.08))); }
      }
      if (far || (near && beltMoves)) continue;
      chevrons(s, 0);
    }

    // ── TOLL GATES ──
    // Two short posts either side of each strip at each end of the block, an amber cap on each, a
    // comb plate across the belt in hazard stripes, and the price floating over the belt, read from
    // both ways: one strip steps on here and the other steps off, and lettering is one-sided.
    const gate = (u) => {
      for (const s of [-1, 1]) {
        const v = s * STRIP_V;
        for (const e of [-1, 1]) {
          const r = hash(o.seed, Math.round(u * 97) + s * 5 + e);
          if (r < LV.gateGone) continue;
          const post = () => {
            box(u, v + e * M(1.0), M(0.07), M(0.07), KERB_H, KERB_H + M(1.1), PAL.post, 'metal');
            box(u, v + e * M(1.0), M(0.09), M(0.09), KERB_H + M(1.1), KERB_H + M(1.16), LV.amber, LV.amberMat);
          };
          if (LV.lean) tiltedAt(u, v + e * M(1.0), 0, 1, (r < 0.66 ? -1 : 1) * LV.lean * 1.6, post);
          else post();
        }
        if (near) {
          const zc = KERB_H + M(K.STRIP_H) + M(0.012), n = 6, w = M(K.STRIP_W) / n;
          for (let i = 0; i < n; i++) flat(u, v - M(K.STRIP_W / 2) + w * (i + 0.5), M(0.18), w / 2, zc, i % 2 ? PAL.band : LV.zebra, 'paint');
        }
        // Still priced with the belt stopped; only the dirt has no sign to put a price on.
        if (write && LV.price) for (const t of [-1, 1]) write(signQuad(u + t * M(0.01), v, M(0.95), KERB_H + M(K.PRICE_Z - 0.24), KERB_H + M(K.PRICE_Z + 0.24), t), '₵1 A RIDE', LV.price, LV.priceLit);
      }
    };
    if (first) gate(-0.5 + M(K.GATE_IN));
    if (last) gate(0.5 - M(K.GATE_IN));

    // ── BOLLARDS ──
    // An octagonal post on a base plate every 2.5 m inside each kerb cap, a lit ring near the top
    // and a red sensor eye on the lane side, with a 5 m gap at the crossing.
    if (!far) for (const u of spaced(K.BOLLARD_EVERY, 1.5)) {
      if (nearCross(u, K.CROSS_GAP)) continue;
      for (const s of [-1, 1]) {
        const v = s * (LANE_HW + M(K.BOLLARD_IN)), n = near ? 8 : 4, H = M(K.BOLLARD_H);
        // Which bollard this is, from where it stands in the world, so the same one stays down.
        const r = hash(s, Math.round((s0 + u) * tm * 4));
        if (r < LV.bollardGone) { if (near) box(u, v, M(0.2), M(0.2), KERB_H, KERB_H + M(0.03), PAL.post, 'metal'); continue; }
        const post = () => {
          if (near) box(u, v, M(0.2), M(0.2), KERB_H, KERB_H + M(0.03), PAL.post, 'metal');
          drumAt(u, v, M(0.14), M(0.1), KERB_H, KERB_H + H * 0.8, n, PAL.post, 'metal', null);
          drumAt(u, v, M(0.112), M(0.112), KERB_H + H * 0.8, KERB_H + H * 0.86, n, LV.cyan, LV.cyanMat, null);
          drumAt(u, v, M(0.1), M(0.07), KERB_H + H * 0.86, KERB_H + H, n, PAL.post, 'metal');
          if (near && LV.lamp !== 'dead') { const ve = v - s * M(0.106); box(u, ve, M(0.025), M(0.004), KERB_H + M(0.55), KERB_H + M(0.6), PAL.red, 'lit'); }
        };
        // Knocked flat along the walkway or just shoved over; never out into the lane.
        if (r < LV.bollardGone + LV.bollardFlat) tiltedAt(u, v, r < 0.42 ? 1 : -1, 0, 1.48, post, M(0.2));
        else if (LV.lean) tiltedAt(u, v, 0, s, (r - 0.5) * LV.lean * 2, post);
        else post();
      }
    }

    // ── PLANTERS, BENCHES AND VENTS ──
    // Between the kerb and the strip. A planter is a steel box on a dark plinth with a lit rim, a
    // trunk and a low-poly crown, and a bench along its strip side; a vent is a grate in the walkway.
    // Down the middle of a two-wide street's mall there's one more row, on the seam, with no bench,
    // and the west or north half draws it. `bench` is which way a tree's bench lies, 0 for none.
    const tree = (u, v, bench) => {
        const dead = LV.tree === 'stump', rim = LV.tree === 'lit';
        box(u, v, M(1.15), M(0.55), KERB_H, KERB_H + M(0.08), PAL.plinth, 'paint');
        box(u, v, M(1.1), M(0.5), KERB_H + M(0.08), KERB_H + M(0.55), PAL.planter, LV.capMat, rim ? LV.cyan : dead ? [36, 30, 22] : PAL.plinth, rim ? 'lit' : 'paint');
        if (!far) { rimAt(u, v, M(1.1), M(0.5), KERB_H + M(0.55)); rimAt(u, v, M(1.15), M(0.55), KERB_H + M(0.08)); }
        drumAt(u, v, M(0.12), M(0.08), KERB_H + M(0.55), KERB_H + M(dead ? 0.95 : 2.3), 6, PAL.trunk, 'paint');
        if (LV.crown) {
          // The crown: an octahedron turned by the tile's seed, so a row of them isn't one tree.
          const [cx, cy] = loc(u, v), r = M(0.95) * LV.crownK, zc = KERB_H + M(2.6);
          const a0 = hash(o.seed, Math.round(u * 1000)) * TAU;
          const eq = [0, 1, 2, 3].map((i) => T(cx + Math.cos(a0 + i * TAU / 4) * r, cy + Math.sin(a0 + i * TAU / 4) * r, zc));
          const top = T(cx, cy, zc + r * 0.9), bot = T(cx, cy, zc - r * 0.8);
          for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; face([eq[i], eq[j], top], LV.crown, 'paint'); face([eq[j], eq[i], bot], LV.crown, 'paint'); }
        }
        if (bench && near && !(dead && hash(o.seed, Math.round(u * 1000) + 3) < 0.5)) {
          const bv = v + bench * M(0.5 + 0.25);
          box(u, bv, M(0.9), M(0.2), KERB_H + M(0.42), KERB_H + M(0.47), LV.capMat === 'metal' ? PAL.bench : [92, 84, 72], LV.capMat);
          for (const e of [-1, 1]) box(u + e * M(0.75), bv, M(0.04), M(0.16), KERB_H, KERB_H + M(0.42), PAL.post, 'metal');
          rimAt(u, bv, M(0.9), M(0.2), KERB_H + M(0.47));
        }
    };
    if (P.inner > 0) for (const u of spaced(K.PLANT_EVERY, 3)) if (!nearCross(u, 3) && !nearBridge(u, 3)) tree(u, 0.5, 0);
    for (const s of [-1, 1]) {
      const v = s * (LANE_HW + M(K.PLANT_IN + 0.15));
      for (const u of spaced(K.PLANT_EVERY, s > 0 ? 6 : 0)) {
        if (nearCross(u, 3) || nearBridge(u, 3) || (first && u < -0.5 + M(K.GATE_IN + 1.5)) || (last && u > 0.5 - M(K.GATE_IN + 1.5))) continue;
        tree(u, v, s);
      }
      if (!far) for (const [u, vv] of vents(s)) {
        box(u, vv, M(0.4), M(0.4), KERB_H, KERB_H + M(0.012), PAL.grate, 'paint');
        rimAt(u, vv, M(0.4), M(0.4), KERB_H + M(0.012));
        if (near) for (let k = -2; k <= 2; k++) box(u + M(k * 0.14), vv, M(0.025), M(0.34), KERB_H + M(0.012), KERB_H + M(0.018), PAL.slat, 'metal');
      }
    }

    // ── JUNK ──
    // Lying about on a street nobody clears, out of the strip and off the lane.
    if (!far) for (let i = 0; i < LV.junk; i++) {
      const s = P.inner ? -P.inner : hash(o.seed, i * 4 + 120) < 0.5 ? -1 : 1, u = (hash(o.seed, i * 4 + 121) - 0.5) * 0.9;
      const [x, y] = loc(u, s * (OUT - M(0.8 + hash(o.seed, i * 4 + 122) * 0.5)));
      junkAt(x, y, KERB_H, hash(o.seed, i * 4 + 123));
    }

    // ── THE SERVICE CHANNEL ──
    // A run of dark steel lids along the frontage edge of each walkway, the ducts under the street,
    // with a cyan status pip every 5 m near to.
    // A two-wide street's mall has no frontage, so only its outer side has a channel.
    if (!far) for (const s of (P.inner ? [-P.inner] : [-1, 1])) {
      const v = s * (OUT - M(K.LID_W / 2));
      box(0, v, 0.5, M(K.LID_W / 2), KERB_H - M(0.004), KERB_H + M(0.01), PAL.lid, LV.capMat);
      if (line) { const vi = v - s * M(K.LID_W / 2); line(F(-0.5, vi, KERB_H + M(0.01)), F(0.5, vi, KERB_H + M(0.01))); }
      if (near) for (const u of spaced(5, s > 0 ? 2.5 : 0)) box(u, v, M(0.05), M(0.05), KERB_H + M(0.01), KERB_H + M(0.016), LV.cyan, LV.cyanMat);
    }

    // ── THE CROSSING ──
    // An amber zebra across the lane in the middle of the block, studded pads where it meets each
    // kerb, a pole on each kerb with an arm over the lane and a lamp head on the end.
    if (crossHere) {
      const zz = LANE_Z + M(0.02);
      for (let i = 0; i < 5; i++) box(CROSS_U, M(-1.6 + i * K.ZEBRA_PITCH), M(K.ZEBRA_L / 2), M(K.ZEBRA_BAR / 2), LANE_Z, zz, LV.zebra, LV.zebraMat);
      for (const s of [-1, 1]) {
        tactile(CROSS_U, s * (LANE_HW + M(0.6)), M(K.ZEBRA_L / 2), M(0.4));
        crossPole(s, () => {
          const u = CROSS_U - M(2), v = s * (LANE_HW + M(K.POLE_IN)), zt = KERB_H + M(K.POLE_H);
          box(u, v, M(0.08), M(0.08), KERB_H, zt, PAL.post, 'metal');
          box(u, v - s * M(0.6), M(0.07), M(0.7), zt - M(0.14), zt, PAL.post, 'metal', PAL.post, 'metal', true);
          box(u, v - s * M(1.2), M(0.2), M(0.25), zt - M(0.9), zt - M(0.14), PAL.head, 'metal', PAL.head, 'metal', true);
        });
      }
    }

    // ── THE FOOTBRIDGE ──
    // The free way over, at the end of the block: a glass lift tower out at the frontage edge of
    // each walkway, a deck 7.0 m clear of the lane between them, glass rails, an arched truss over
    // each edge of the deck and a cyan line under it.
    if (bridgeHere) {
      const ub = BRIDGE_U, hu = M(K.DECK_W / 2), zr = DECK_Z1 + M(K.RAIL_H);
      const tw = M(K.TOWER_W / 2), tl = M(K.TOWER_L / 2), ztop = DECK_Z1 + M(K.TOWER_UP);
      for (const s of [-1, 1]) {
        // The tower on a two-wide street's seam is shared, and the west or north half draws it.
        if (s === P.inner && s < 0) continue;
        const v = kitTowerV(P, s), onSeam = s === P.inner;
        tactile(ub, v - s * (tw + M(0.45)), tl, M(0.35));
        if (onSeam) tactile(ub, v + s * (tw + M(0.45)), tl, M(0.35));
        box(ub, v, tl + M(0.06), tw + M(0.06), KERB_H, KERB_H + M(0.12), PAL.plinth, 'paint');
        // ⚠ AN OPEN FRAME, GLAZED ONLY AT THE BACK. The faces here are opaque, so a tower glazed
        // all round drew as a grey box that hid its own car and whoever was riding it. Four corner
        // posts with a cyan line down the two on the lane side, a ring beam every 2.5 m, glass on
        // the frontage side only, and a roof with a lit band under its edge.
        for (const a of [-1, 1]) for (const b of [-1, 1]) box(ub + a * tl, v + b * tw, M(0.07), M(0.07), KERB_H, ztop, PAL.steel, 'metal');
        for (const a of [-1, 1]) box(ub + a * tl, v - s * (tw + M(0.075)), M(0.02), M(0.008), KERB_H + M(0.3), ztop - M(0.1), PAL.cyan, 'lit');
        for (let z = KERB_H + M(2.5); z < ztop - M(0.5); z += M(2.5)) {
          box(ub, v - tw, tl, M(0.05), z, z + M(0.1), PAL.steel, 'metal');
          box(ub, v + tw, tl, M(0.05), z, z + M(0.1), PAL.steel, 'metal');
          box(ub - tl, v, M(0.05), tw, z, z + M(0.1), PAL.steel, 'metal');
          box(ub + tl, v, M(0.05), tw, z, z + M(0.1), PAL.steel, 'metal');
        }
        const g0 = KERB_H + M(0.12), vb = v + s * tw;
        if (!onSeam) face([F(ub - tl, vb, g0), F(ub + tl, vb, g0), F(ub + tl, vb, ztop), F(ub - tl, vb, ztop)], PAL.glass, 'glass');
        box(ub, v, tl + M(0.12), tw + M(0.12), ztop, ztop + M(0.3), PAL.steelDk, 'metal', PAL.steelDk, 'metal', true);
        box(ub, v, tl + M(0.12), tw + M(0.12), ztop - M(0.05), ztop, PAL.cyan, 'lit');
      }
      // The deck from tower to tower. `vc` is its middle, off the tile's centre on a two-wide street,
      // where this half's deck ends at the tower on the seam.
      const vL = kitTowerV(P, -1) + tw, vR = kitTowerV(P, 1) - tw, vc = (vL + vR) / 2, dv = (vR - vL) / 2;
      box(ub, vc, hu, dv, DECK_Z0, DECK_Z1, PAL.steelDk, 'metal', LV.deck, 'metal', true);
      box(ub, vc, M(0.1), dv, DECK_Z0 - M(0.03), DECK_Z0, PAL.cyan, 'lit', PAL.cyan, 'lit', true);
      for (const e of [-1, 1]) {
        const ue = ub + e * hu;
        // A glass rail along each edge with a steel top.
        face([F(ue, vL, DECK_Z1), F(ue, vR, DECK_Z1), F(ue, vR, zr), F(ue, vL, zr)], PAL.glass, 'glass');
        box(ue, vc, M(0.04), dv, zr, zr + M(0.06), PAL.steel, 'metal');
        // The arch over this edge, in straight pieces, with a hanger down to the deck at each joint.
        const N = near ? 10 : 6, base = zr + M(0.1);
        let prev = null;
        for (let i = 0; i <= N; i++) {
          const v = vL + 2 * dv * i / N, k = (v - vc) / dv, z = base + M(K.ARCH) * (1 - k * k);
          const p = F(ue, v, z);
          if (prev) strut(prev, p, M(0.09), PAL.steel, 'metal');
          if (i > 0 && i < N) strut(F(ue, v, zr + M(0.06)), p, M(0.035), PAL.steel, 'metal');
          prev = p;
        }
      }
    }

  }

  // ── WHAT MOVES: THE BELTS, THE VENTS, THE CROSSING LAMPS, THE LIFT CARS AND THE LIGHTS ──
  // Every one is a pure function of the clock, and all of it sits on the walkway or under the cab's
  // eye: a plume is gone by the height of a rig, and the belts are in the floor.
  if (doDynamic && near && beltMoves) for (let j = 0; j < 2; j++) chevrons(SIDES[j], (o.now || 0) / 1000 * LV.speed);
  if (doDynamic && near && o.steam) for (const s of [-1, 1]) for (const [u, vv] of vents(s)) {
    // One vent in two is venting at any time, the same ones until somebody fixes them.
    const r = hash(s, Math.round((s0 + u) * tm));
    if (r > 0.5) continue;
    const [x, y] = loc(u, vv);
    o.steam(dx + x, dy + y, Math.round(r * 1e4), LV.steam);
  }
  if (doDynamic && crossHere) {
    const on = LV.lamp === 'blink' ? Math.sin((o.now || 0) / 1000 * 3) > 0 : LV.lamp === 'steady';
    for (const s of [-1, 1]) {
      const u = CROSS_U - M(2), v = s * (LANE_HW + M(K.POLE_IN)) - s * M(1.2), zl = KERB_H + M(K.POLE_H) - M(0.5);
      crossPole(s, () => box(u + M(0.21), v, M(0.02), M(0.14), zl - M(0.14), zl + M(0.14), on ? (LV.lamp === 'blink' ? PAL.amber : [150, 104, 20]) : DEAD_AMBER, on ? 'lit' : 'paint'));
      if (on && LV.lamp === 'blink' && night > 0.2 && o.light) { const [x, y] = loc(u + M(0.24), v); o.light(dx + x, dy + y, zl, '255,178,29', 6, 0.5 * night); }
    }
  }
  if (doDynamic && bridgeHere) {
    // Each car runs a 20 s round: five seconds at the bottom, five up, five at the top, five down,
    // the two towers half a round apart. A pure function of the clock, like everything that moves.
    const tw = M(K.TOWER_W / 2), tl = M(K.TOWER_L / 2);
    for (const s of [-1, 1]) {
      if (s === P.inner && s < 0) continue;   // the shared tower's car is the other half's
      const ph = (((o.now || 0) / 1000 + (s > 0 ? 10 : 0)) % 20 + 20) % 20;
      const k = ph < 5 ? 0 : ph < 10 ? (ph - 5) / 5 : ph < 15 ? 1 : 1 - (ph - 15) / 5;
      const e = k * k * (3 - 2 * k), z0 = KERB_H + M(0.12) + (DECK_Z1 - KERB_H - M(0.12)) * e;
      box(BRIDGE_U, kitTowerV(P, s), tl - M(0.15), tw - M(0.15), z0, z0 + M(2.1), PAL.cab, 'metal');
      box(BRIDGE_U, kitTowerV(P, s), tl - M(0.14), tw - M(0.14), z0 + M(2.0), z0 + M(2.06), PAL.cyan, 'lit');
    }
    if (night > 0.2 && o.light) { const [x, y] = loc(BRIDGE_U, (kitTowerV(P, -1) + kitTowerV(P, 1)) / 2); o.light(dx + x, dy + y, DECK_Z0, '111,227,255', 8, 0.35 * night); }
  }
  if (bridgeHere) for (const e of [-1, 1]) kitCamera(tools(), BRIDGE_U - e * M(0.9), e * M(2.4), DECK_Z0, 1.3 + e);
  if (P.span) spanOver();
}
