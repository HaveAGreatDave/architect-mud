// ── THE STREET KIT: COLDWATER'S LANE, WALKWAYS AND WHAT STANDS ON THEM ───────────────────────────
//
// Coldwater Streets (docs/proposals/coldwater-streets.md). One street, built from parts: a 4 m
// licensed lane between two 5.6 m chrome walkways raised 0.18 m, a steel kerb with a light set into
// its face, a metered strip down each walkway with a toll gate at each end of the block, bollards
// every 2.5 m, a paid crossing in the middle of the block, a public footbridge with a glass lift at
// each end at the end of the block, a respawn kiosk on the free edge, planters with benches, vents,
// a service channel along the frontage and guard rails at the corners. Every street tile is drawn
// from the same parts; only where they stand changes.
//
// ⚠ THE DRIVER'S VIEW IS THE BUDGET. Everything along the street stands below a cab's eye (about
// 2.2 m) or out at the frontage, and the small parts (panel joints, hatches, tactile studs, sensor
// eyes, comb plates) are drawn near to only. Over the lane there is the crossing's arm and the
// footbridge, and nothing else. A lit part is a thin line or a ring, never a lamp pointed at you.
//
// This draws the core level only. The other four levels are material and damage variants of these
// same parts (phase 3), so nothing here is a one-off.
//
// ⚠ NO RENDERER IMPORTS, as glass/media-lot.js has none. The renderer finds the tiles and hands this
// a face sink, a light sink and a lettering sink (drawStreetKitPass in windshield.js). The geometry
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
export const M = (m) => m / TILE_M;

const TAU = Math.PI * 2;
// A repeatable 0..1 from a seed and a position, so a part keeps its shade from frame to frame.
const hash = (seed, k) => { const x = Math.sin((seed || 0) * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };

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
  KIOSK_W: 1.3, KIOSK_D: 0.9, KIOSK_H: 2.5, KIOSK_IN: 0.9,
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
const LINE_Z = M(0.06), LANE_Z = M(0.03);      // paint on the lane, and the lane over the old asphalt
const DECK_Z0 = M(K.HAULER + K.CLEAR), DECK_Z1 = DECK_Z0 + M(K.DECK_T);
const TOWER_V = OUT - M(K.TOWER_IN);           // a lift tower's centre, out at the frontage edge
const BRIDGE_U = 0.5 - M(K.BRIDGE_IN);         // where a footbridge crosses its tile
const CROSS_U = 0;                             // where the paid crossing crosses its tile
const WALK_V = 0.38;                           // the line people walk, out on the free edge (VERGE)

// What the gate and the people read, in tiles.
export const KIT = Object.freeze({ LANE_HW, OUT, KERB_H, STRIP_V, DECK_Z0, DECK_Z1, TOWER_V, BRIDGE_U, CROSS_U, WALK_V });

// Core-level colours. Chrome is a pale metal that the shader gives a hard highlight; the lane is a
// matte near-black, so the street reads as two bright banks either side of a dark gap.
const PAL = {
  chrome: [214, 222, 230], hatch: [150, 160, 172], band: [10, 12, 16], slab: [11, 13, 18],
  cap: [178, 188, 200], lane: [13, 15, 20], drain: [5, 6, 8], guide: [111, 227, 255], edge: [42, 111, 134],
  cyan: [111, 227, 255], cyanDim: [42, 111, 134], amber: [255, 178, 29], amberDim: [74, 50, 4],
  red: [255, 59, 59], magenta: [255, 79, 163],
  strip: [18, 58, 82], skirt: [52, 60, 74], post: [42, 49, 64], head: [27, 32, 48],
  kiosk: [27, 33, 49], screen: [4, 16, 25], plinth: [30, 34, 42],
  planter: [42, 49, 64], trunk: [59, 48, 38], crown: [47, 138, 128], bench: [120, 128, 138],
  grate: [10, 12, 16], slat: [34, 38, 46], lid: [36, 42, 52], tactile: [214, 160, 40], stud: [240, 196, 90],
  steel: [154, 166, 181], steelDk: [42, 49, 64], glass: [120, 168, 190], cab: [216, 226, 236],
  stencil: '#9fd8e8',
};

// ── WHERE A BLOCK'S PARTS STAND ──────────────────────────────────────────────
//
// A kit tile: a road whose district sets a street condition, straight or a junction, at the core
// level (the only one drawn yet).
export function kitCell(c) {
  return !!c && c.sc === 0 && !!c.road && !c.bt && !c.mark && !c.lk && c.rdeg == null && c.ft !== 'dust';
}
const KIT_RUN_MAX = 24;   // how far along the street a block is looked for, each way
const PLACE = new WeakMap();
// What a tile is and what stands on it, or null for no kit. `at(rx, ry)` is the cell at a window
// index, `wide(rx, ry, axis)` whether the road is two or more tiles across (blockSpan in windshield.js,
// which a tile of kit isn't drawn on: the cross-section is one tile). Kept per cell object, which is
// replaced when the window is.
//   axis   'ns' or 'ew' on a straight tile, null on a junction, corner or end
//   run    { i, n }: the straight tile's place in its block of straight kit tiles
//   cross  the block's paid crossing is on this tile, at CROSS_U
//   bridge a footbridge crosses this tile, at BRIDGE_U: the last tile of a block of two or more
export function kitPlace(at, rx, ry, wide) {
  const c = at(rx, ry);
  if (!kitCell(c)) return null;
  const was = PLACE.get(c);
  if (was !== undefined) return was;
  const rd = c.rd || '';
  const axis = rd === 'ns' || rd === 'ew' ? rd : null;
  let out = null;
  if (axis && !(wide && wide(rx, ry, axis))) {
    const sx = axis === 'ns' ? 0 : 1, sy = axis === 'ns' ? 1 : 0;
    const same = (cc) => kitCell(cc) && cc.rd === axis;
    let lo = 0, hi = 0;
    while (lo < KIT_RUN_MAX && same(at(rx - sx * (lo + 1), ry - sy * (lo + 1)))) lo++;
    while (hi < KIT_RUN_MAX && same(at(rx + sx * (hi + 1), ry + sy * (hi + 1)))) hi++;
    const run = { i: lo, n: lo + hi + 1 };
    out = { axis, arms: rd, run, cross: run.i === Math.floor((run.n - 1) / 2), bridge: run.n >= 2 && run.i === run.n - 1, level: c.sc };
  } else if (!axis && rd.length) out = { axis: null, arms: rd, run: null, cross: false, bridge: false, level: c.sc };
  PLACE.set(c, out);
  return out;
}

// ── THE BUILD ────────────────────────────────────────────────────────────────
//
// `o` is everything the renderer knows about this tile and this frame:
//   dx, dy        tile centre, camera-relative
//   place         kitPlace's answer for the tile
//   s0            the tile centre's world coordinate along the axis, in tiles: anything that
//                 repeats along the street (bollards, planters, vents, dashes) is spaced from it, so
//                 a run carries on across tiles and doesn't move when the map window recentres
//   part          'static', 'dynamic', or undefined for both (markKept's two passes)
//   near          true within arm's length: the small parts
//   seed, now, night, alpha
//   face(pts, rgb, a, n, mat)     one convex polygon; `n` and `mat` absent for a lit face
//   light(x, y, z, rgb, s, a)     a glow
//   text(quad, label, css, lit)   lettering on a quad wound TL, TR, BR, BL as it is read
export function drawStreetKit(o) {
  const P = o.place;
  if (!P || P.level !== 0) return;
  const alpha = o.alpha == null ? 1 : o.alpha;
  const night = Math.min(1, Math.max(0, o.night || 0));
  // Three tiers by distance: `near` (the small parts), the middle, and `far`, where only what
  // still reads from a cab down the street is drawn: the walkways, the kerbs, the lane's paint, the
  // strips, the trees, and the crossings and bridges. Bollards, vents and chevrons are gone by then.
  const dx = o.dx, dy = o.dy, near = !!o.near, far = !near && !!o.far;
  const doStatic = o.part !== 'dynamic', doDynamic = o.part !== 'static';

  // On the GPU the shader turns the normal to the eye and shades, so the normal goes over as wound.
  const face = (pts, base, mat) => {
    if (pts.length < 3) return;
    if (mat === 'lit') { o.face(pts, base, alpha); return; }
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const nl = Math.hypot(nx, ny, nz); if (!(nl > 1e-12)) return;
    o.face(pts, base, alpha, [nx / nl, ny / nl, nz / nl], mat || 'paint');
  };
  const T = (x, y, z) => [dx + x, dy + y, z];
  // An axis-aligned box in tile-local x, y. Five faces: nothing here is seen from underneath, except
  // what hangs over the lane, which asks for its bottom.
  const boxXY = (x0, x1, y0, y1, z0, z1, base, mat, top = base, topMat = mat, under = false) => {
    const A = T(x0, y0, z0), B = T(x1, y0, z0), C = T(x1, y1, z0), D = T(x0, y1, z0);
    const A1 = T(x0, y0, z1), B1 = T(x1, y0, z1), C1 = T(x1, y1, z1), D1 = T(x0, y1, z1);
    face([A1, B1, C1, D1], top, topMat);
    face([A, B, B1, A1], base, mat); face([B, C, C1, B1], base, mat);
    face([C, D, D1, C1], base, mat); face([D, A, A1, D1], base, mat);
    if (under) face([D, C, B, A], base, mat);
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

  const arms = P.arms || '';
  const has = (d) => arms.includes(d);

  // ── THE GROUND: LANE, WALKWAYS, KERBS ──
  if (doStatic) {
    // A walkway is a dark slab with the chrome panels standing on it. Far off it's the slab with a
    // chrome top; near to, the slab drops by a panel's thickness and the panels sit on it with a
    // gap between each, so the joints read as dark lines and each panel carries two ink bands. One
    // panel in sixteen is an inspection hatch: duller, bolted at the corners, with a status pip.
    const walk = (x0, x1, y0, y1, alongX) => {
      if (!near) { boxXY(x0, x1, y0, y1, 0, KERB_H, PAL.slab, 'paint', PAL.chrome, 'metal'); return; }
      const zs = KERB_H - M(K.PANEL_H);
      boxXY(x0, x1, y0, y1, 0, zs, PAL.slab, 'paint');
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
        const isHatch = hash(o.seed, k) < 1 / 16;
        face([q(ga, gb, KERB_H), q(1 - ga, gb, KERB_H), q(1 - ga, 1 - gb, KERB_H), q(ga, 1 - gb, KERB_H)], isHatch ? PAL.hatch : PAL.chrome, 'metal');
        const zb = KERB_H + M(0.008);
        if (isHatch) {
          // Four bolts and a status pip, and no bands: a hatch is a lid, not a mirror.
          for (const [a, b] of [[0.12, 0.1], [0.88, 0.1], [0.88, 0.9], [0.12, 0.9]]) {
            const e = M(0.05) / cw, f = M(0.05) / rl;
            face([q(a - e, b - f, zb), q(a + e, b - f, zb), q(a + e, b + f, zb), q(a - e, b + f, zb)], PAL.band, 'paint');
          }
          const e = M(0.06) / cw, f = M(0.06) / rl;
          face([q(0.5 - e, 0.5 - f, zb), q(0.5 + e, 0.5 - f, zb), q(0.5 + e, 0.5 + f, zb), q(0.5 - e, 0.5 + f, zb)], PAL.cyan, 'lit');
          continue;
        }
        // Two ink bands across each panel, leaning the same way on every panel in the city: the
        // comic read of a reflection. From the preview's band texture, in panel fractions.
        face([q(0.06, 1, zb), q(0.34, 1, zb), q(0.66, 0, zb), q(0.38, 0, zb)], PAL.band, 'paint');
        face([q(0.55, 1, zb), q(0.64, 1, zb), q(0.95, 0, zb), q(0.86, 0, zb)], PAL.band, 'paint');
      }
    };
    // The kerb: a steel cap along the lane edge of a walkway, a hair proud of the panels, with a
    // cyan light set into the face the lane sees and a drain slot in the lane at its foot.
    // (x0..x1, y0..y1) is the cap's footprint; `ax` says the face runs along x (an east-west
    // kerb) and `fs` which way it faces, -1 or +1 across.
    const CAP = M(K.CAP_W), DR = M(0.2), DR_IN = M(0.1);
    const kerb = (x0, x1, y0, y1, ax, fs) => {
      boxXY(x0, x1, y0, y1, 0, KERB_H + M(0.015), PAL.cap, 'metal');
      const zl0 = M(0.06), zl1 = M(0.11);
      if (ax) {
        const fy = (fs < 0 ? y0 : y1) + fs * M(0.004);
        face([T(x0, fy, zl0), T(x1, fy, zl0), T(x1, fy, zl1), T(x0, fy, zl1)], PAL.cyan, 'lit');
        const d0 = fy + fs * DR_IN, d1 = d0 + fs * DR;
        flatXY(x0, x1, Math.min(d0, d1), Math.max(d0, d1), LANE_Z + M(0.004), PAL.drain, 'paint');
        if (near) for (let x = x0 + M(0.15); x < x1; x += M(0.3)) flatXY(x, x + M(0.05), Math.min(d0, d1), Math.max(d0, d1), LANE_Z + M(0.008), PAL.slat, 'metal');
      } else {
        const fx = (fs < 0 ? x0 : x1) + fs * M(0.004);
        face([T(fx, y0, zl0), T(fx, y1, zl0), T(fx, y1, zl1), T(fx, y0, zl1)], PAL.cyan, 'lit');
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
      if (ax) face([T(a0, c, zt + rr * 1.3), T(a1, c, zt + rr * 1.3), T(a1, c, zt + rr * 1.3 + h), T(a0, c, zt + rr * 1.3 + h)], PAL.cyan, 'lit');
      else face([T(c, a0, zt + rr * 1.3), T(c, a1, zt + rr * 1.3), T(c, a1, zt + rr * 1.3 + h), T(c, a0, zt + rr * 1.3 + h)], PAL.cyan, 'lit');
    };

    if (P.axis) {
      // A straight tile: the lane the full length, one walkway each side.
      const ns = P.axis === 'ns';
      if (ns) flatXY(-LANE_HW, LANE_HW, -0.5, 0.5, LANE_Z, PAL.lane, 'paint');
      else flatXY(-0.5, 0.5, -LANE_HW, LANE_HW, LANE_Z, PAL.lane, 'paint');
      for (const s of [-1, 1]) {
        const a = s * LANE_HW, b = s * OUT, lo = Math.min(a, b), hi = Math.max(a, b);
        const c0 = s > 0 ? LANE_HW : -LANE_HW - CAP;
        if (ns) { walk(lo, hi, -0.5, 0.5, false); kerb(c0, c0 + CAP, -0.5, 0.5, false, -s); }
        else { walk(-0.5, 0.5, lo, hi, true); kerb(-0.5, 0.5, c0, c0 + CAP, true, -s); }
      }
    } else {
      // A junction, a corner or an end: the lane down every arm and across the box, a walkway in
      // each quadrant (out to the tile edge along an arm, to the frontage otherwise), a strip of
      // walkway along every side with no arm, and a guard rail at each corner where a kerb turns.
      flatXY(-LANE_HW, LANE_HW, -LANE_HW, LANE_HW, LANE_Z, PAL.lane, 'paint');
      if (has('n')) flatXY(-LANE_HW, LANE_HW, -0.5, -LANE_HW, LANE_Z, PAL.lane, 'paint');
      if (has('s')) flatXY(-LANE_HW, LANE_HW, LANE_HW, 0.5, LANE_Z, PAL.lane, 'paint');
      if (has('w')) flatXY(-0.5, -LANE_HW, -LANE_HW, LANE_HW, LANE_Z, PAL.lane, 'paint');
      if (has('e')) flatXY(LANE_HW, 0.5, -LANE_HW, LANE_HW, LANE_Z, PAL.lane, 'paint');
      const RUN = M(K.RAIL_RUN), RIN = LANE_HW + M(0.3);
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        const armX = has(sx > 0 ? 'e' : 'w'), armY = has(sy > 0 ? 's' : 'n');
        const ex = armX ? 0.5 : OUT, ey = armY ? 0.5 : OUT;
        const x0 = Math.min(sx * LANE_HW, sx * ex), x1 = Math.max(sx * LANE_HW, sx * ex);
        const y0 = Math.min(sy * LANE_HW, sy * ey), y1 = Math.max(sy * LANE_HW, sy * ey);
        walk(x0, x1, y0, y1, ex > ey);
        // A kerb along each edge of the quadrant that faces a lane.
        if (armX) { const c0 = sy > 0 ? LANE_HW : -LANE_HW - CAP; kerb(x0, x1, c0, c0 + CAP, true, -sy); }
        if (armY) { const c0 = sx > 0 ? LANE_HW : -LANE_HW - CAP; kerb(c0, c0 + CAP, y0, y1, false, -sx); }
        if (near) {
          if (armX) rail(true, sx * LANE_HW, sx * Math.min(0.5, LANE_HW + RUN), sy * RIN);
          if (armY) rail(false, sy * LANE_HW, sy * Math.min(0.5, LANE_HW + RUN), sx * RIN);
        }
      }
      for (const [d, sx, sy] of [['n', 0, -1], ['s', 0, 1], ['w', -1, 0], ['e', 1, 0]]) {
        if (has(d)) continue;
        if (sx === 0) {
          const y0 = Math.min(sy * LANE_HW, sy * OUT), y1 = Math.max(sy * LANE_HW, sy * OUT);
          walk(-LANE_HW, LANE_HW, y0, y1, true);
          const c0 = sy > 0 ? LANE_HW : -LANE_HW - CAP; kerb(-LANE_HW, LANE_HW, c0, c0 + CAP, true, -sy);
        } else {
          const x0 = Math.min(sx * LANE_HW, sx * OUT), x1 = Math.max(sx * LANE_HW, sx * OUT);
          walk(x0, x1, -LANE_HW, LANE_HW, false);
          const c0 = sx > 0 ? LANE_HW : -LANE_HW - CAP; kerb(c0, c0 + CAP, -LANE_HW, LANE_HW, false, -sx);
        }
      }
    }
  }

  // Everything below stands on a straight tile, in a frame along the street: `u` along it, `v`
  // across it. The block's own parts (gates, crossing, bridge, kiosks) are placed from `run`.
  if (!P.axis) return;
  const ns = P.axis === 'ns';
  const U = ns ? [0, 1] : [1, 0], V = ns ? [1, 0] : [0, 1];
  const F = (u, v, z) => [dx + U[0] * u + V[0] * v, dy + U[1] * u + V[1] * v, z];
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
  // A quad standing across the street at `u`, read by somebody facing -toward along it. `r` is
  // which way +v lies on their right. Wound TL, TR, BR, BL as read.
  const signQuad = (u, v, hw, z0, z1, toward) => {
    const r = toward * (ns ? 1 : -1);
    return [F(u, v - r * hw, z1), F(u, v + r * hw, z1), F(u, v + r * hw, z0), F(u, v - r * hw, z0)];
  };
  // Studded tactile paving where people step off or wait: an amber pad, its studs near to.
  const tactile = (u, v, hu, hv) => {
    const z = KERB_H + M(0.006);
    flat(u, v, hu, hv, z, PAL.tactile, 'paint');
    if (!near) return;
    const st = M(0.06), pitch = M(0.25);
    for (let a = -hu + pitch / 2; a < hu; a += pitch) for (let b = -hv + pitch / 2; b < hv; b += pitch) flat(u + a, v + b, st, st, z + M(0.006), PAL.stud, 'paint');
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

  if (doStatic) {
    // ── THE LANE'S PAINT ──
    // A dashed cyan guide line down the middle (a 2.9 m dash in a 4.7 m pitch), an edge line inside
    // each drain near to, and LICENSED stencilled across the lane at each end of the block, read by
    // a driver coming in.
    for (const u of spaced(TILE_M / 3.8, 0)) {
      if (nearCross(u, K.ZEBRA_L / 2 + 1.45)) continue;   // no dash through the zebra
      box(u, 0, M(1.45), M(0.08), LANE_Z, LINE_Z, PAL.guide, 'lit');
    }
    if (near) for (const s of [-1, 1]) box(0, s * (LANE_HW - M(0.5)), 0.5, M(0.025), LANE_Z, LINE_Z, PAL.edge, 'lit');
    if (o.text) {
      const L = ns ? 1 : -1, hw = M(1.5), hl = M(0.55), z = LINE_Z;
      const stencil = (uc, dir) => {
        // dir +1: read by a driver heading +u; the far edge (+u) is the top of the letters.
        const tl = F(uc + dir * hl, dir * L * hw, z), tr = F(uc + dir * hl, -dir * L * hw, z);
        const br = F(uc - dir * hl, -dir * L * hw, z), bl = F(uc - dir * hl, dir * L * hw, z);
        o.text([tl, tr, br, bl], 'LICENSED', PAL.stencil, false);
      };
      if (first) stencil(-0.5 + M(5), 1);
      if (last && run.n > 1) stencil(0.5 - M(5), -1);
    }

    // ── THE METERED STRIP ──
    // A belt down the middle of each walkway in a steel housing, chevrons pointing the way it runs,
    // amber lights along the top of the housing. The belt on your right carries you forward: facing
    // -u on a north-south street your right is +v, facing +u on an east-west one it's +v too.
    for (const s of [-1, 1]) {
      const v = s * STRIP_V, zt = KERB_H + M(K.STRIP_H);
      box(0, v, 0.5, M(K.STRIP_W / 2), KERB_H, zt, PAL.strip, 'paint', PAL.strip, 'lit');
      for (const e of [-1, 1]) {
        const ve = v + e * (M(K.STRIP_W / 2) + M(0.04));
        if (far) { box(0, ve, 0.5, M(0.012), KERB_H, KERB_H + M(0.06), PAL.amber, 'lit'); continue; }
        box(0, ve, 0.5, M(0.04), KERB_H, KERB_H + M(0.08), PAL.skirt, 'metal');
        box(0, ve, 0.5, M(0.012), KERB_H + M(0.08), KERB_H + M(0.092), PAL.amber, 'lit');
      }
      if (far) continue;
      const dir = ns ? -s : s;
      const zc = zt + M(0.006), arm = M(0.55), wd = M(0.11);
      for (const u of spaced(K.CHEVRON, s > 0 ? 0 : K.CHEVRON / 2)) {
        for (const e of [-1, 1]) {
          // One stroke of the V: from the point (u + dir·0.3 m) back out to the side.
          const tipU = u + dir * M(0.3), endU = u - dir * M(0.3), endV = v + e * arm;
          const nu = -(endV - v), nv = endU - tipU, nl = Math.hypot(nu, nv) || 1;
          const pu = nu / nl * wd / 2, pv = nv / nl * wd / 2;
          face([F(tipU - pu, v - pv, zc), F(tipU + pu, v + pv, zc), F(endU + pu, endV + pv, zc), F(endU - pu, endV - pv, zc)], PAL.cyan, 'lit');
        }
      }
    }

    // ── TOLL GATES ──
    // Two short posts either side of each strip at each end of the block, an amber cap on each, a
    // comb plate across the belt in hazard stripes, and the price floating over the belt, read from
    // both ways: one strip steps on here and the other steps off, and lettering is one-sided.
    const gate = (u) => {
      for (const s of [-1, 1]) {
        const v = s * STRIP_V;
        for (const e of [-1, 1]) {
          box(u, v + e * M(1.0), M(0.07), M(0.07), KERB_H, KERB_H + M(1.1), PAL.post, 'metal');
          box(u, v + e * M(1.0), M(0.09), M(0.09), KERB_H + M(1.1), KERB_H + M(1.16), PAL.amber, 'lit');
        }
        if (near) {
          const zc = KERB_H + M(K.STRIP_H) + M(0.012), n = 6, w = M(K.STRIP_W) / n;
          for (let i = 0; i < n; i++) flat(u, v - M(K.STRIP_W / 2) + w * (i + 0.5), M(0.18), w / 2, zc, i % 2 ? PAL.band : PAL.amber, 'paint');
        }
        if (o.text) for (const t of [-1, 1]) o.text(signQuad(u + t * M(0.01), v, M(0.95), KERB_H + M(K.PRICE_Z - 0.24), KERB_H + M(K.PRICE_Z + 0.24), t), '₵1 A RIDE', '#ffb21d', true);
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
        if (near) box(u, v, M(0.2), M(0.2), KERB_H, KERB_H + M(0.03), PAL.post, 'metal');
        drumAt(u, v, M(0.14), M(0.1), KERB_H, KERB_H + H * 0.8, n, PAL.post, 'metal', null);
        drumAt(u, v, M(0.112), M(0.112), KERB_H + H * 0.8, KERB_H + H * 0.86, n, PAL.cyan, 'lit', null);
        drumAt(u, v, M(0.1), M(0.07), KERB_H + H * 0.86, KERB_H + H, n, PAL.post, 'metal');
        if (near) { const ve = v - s * M(0.106); box(u, ve, M(0.025), M(0.004), KERB_H + M(0.55), KERB_H + M(0.6), PAL.red, 'lit'); }
      }
    }

    // ── PLANTERS, BENCHES AND VENTS ──
    // Between the kerb and the strip. A planter is a steel box on a dark plinth with a lit rim, a
    // trunk and a low-poly crown, and a bench along its strip side; a vent is a grate in the walkway.
    for (const s of [-1, 1]) {
      const v = s * (LANE_HW + M(K.PLANT_IN + 0.15));
      for (const u of spaced(K.PLANT_EVERY, s > 0 ? 6 : 0)) {
        if (nearCross(u, 3) || nearBridge(u, 3) || (first && u < -0.5 + M(K.GATE_IN + 1.5)) || (last && u > 0.5 - M(K.GATE_IN + 1.5))) continue;
        box(u, v, M(1.15), M(0.55), KERB_H, KERB_H + M(0.08), PAL.plinth, 'paint');
        box(u, v, M(1.1), M(0.5), KERB_H + M(0.08), KERB_H + M(0.55), PAL.planter, 'metal', PAL.cyan, 'lit');
        drumAt(u, v, M(0.12), M(0.08), KERB_H + M(0.55), KERB_H + M(2.3), 6, PAL.trunk, 'paint');
        // The crown: an octahedron turned by the tile's seed, so a row of them isn't one tree.
        const [cx, cy] = loc(u, v), r = M(0.95), zc = KERB_H + M(2.6);
        const a0 = hash(o.seed, Math.round(u * 1000)) * TAU;
        const eq = [0, 1, 2, 3].map((i) => T(cx + Math.cos(a0 + i * TAU / 4) * r, cy + Math.sin(a0 + i * TAU / 4) * r, zc));
        const top = T(cx, cy, zc + r * 0.9), bot = T(cx, cy, zc - r * 0.8);
        for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; face([eq[i], eq[j], top], PAL.crown, 'paint'); face([eq[j], eq[i], bot], PAL.crown, 'paint'); }
        if (near) {
          const bv = v + s * M(0.5 + 0.25);
          box(u, bv, M(0.9), M(0.2), KERB_H + M(0.42), KERB_H + M(0.47), PAL.bench, 'metal');
          for (const e of [-1, 1]) box(u + e * M(0.75), bv, M(0.04), M(0.16), KERB_H, KERB_H + M(0.42), PAL.post, 'metal');
        }
      }
      if (!far) for (const u of spaced(K.VENT_EVERY, s > 0 ? 10 : 7)) {
        if (nearCross(u, 3) || nearBridge(u, 3)) continue;
        const vv = s * (LANE_HW + M(K.PLANT_IN));
        box(u, vv, M(0.4), M(0.4), KERB_H, KERB_H + M(0.012), PAL.grate, 'paint');
        if (near) for (let k = -2; k <= 2; k++) box(u + M(k * 0.14), vv, M(0.025), M(0.34), KERB_H + M(0.012), KERB_H + M(0.018), PAL.slat, 'metal');
      }
    }

    // ── THE SERVICE CHANNEL ──
    // A run of dark steel lids along the frontage edge of each walkway, the ducts under the street,
    // with a cyan status pip every 5 m near to.
    if (!far) for (const s of [-1, 1]) {
      const v = s * (OUT - M(K.LID_W / 2));
      box(0, v, 0.5, M(K.LID_W / 2), KERB_H - M(0.004), KERB_H + M(0.01), PAL.lid, 'metal');
      if (near) for (const u of spaced(5, s > 0 ? 2.5 : 0)) box(u, v, M(0.05), M(0.05), KERB_H + M(0.01), KERB_H + M(0.016), PAL.cyan, 'lit');
    }

    // ── THE PAID CROSSING ──
    // An amber zebra across the lane in the middle of the block, studded pads where it meets each
    // kerb, a pole on each kerb with an arm over the lane and a lamp head on the end, and the fee on
    // each pole.
    if (crossHere) {
      const zz = LANE_Z + M(0.02);
      for (let i = 0; i < 5; i++) box(CROSS_U, M(-1.6 + i * K.ZEBRA_PITCH), M(K.ZEBRA_L / 2), M(K.ZEBRA_BAR / 2), LANE_Z, zz, PAL.amber, 'lit');
      for (const s of [-1, 1]) {
        tactile(CROSS_U, s * (LANE_HW + M(0.6)), M(K.ZEBRA_L / 2), M(0.4));
        const u = CROSS_U - M(2), v = s * (LANE_HW + M(K.POLE_IN)), zt = KERB_H + M(K.POLE_H);
        box(u, v, M(0.08), M(0.08), KERB_H, zt, PAL.post, 'metal');
        box(u, v - s * M(0.6), M(0.07), M(0.7), zt - M(0.14), zt, PAL.post, 'metal', PAL.post, 'metal', true);
        box(u, v - s * M(1.2), M(0.2), M(0.25), zt - M(0.9), zt - M(0.14), PAL.head, 'metal', PAL.head, 'metal', true);
        // The fee, on both faces of a board on the pole.
        const zb0 = KERB_H + M(2.05), zb1 = KERB_H + M(2.55);
        box(u, v, M(0.04), M(0.6), zb0, zb1, PAL.screen, 'paint');
        if (o.text) {
          o.text(signQuad(u - M(0.045), v, M(0.55), zb0 + M(0.04), zb1 - M(0.04), -1), '₵2 · CROSS', '#ffb21d', true);
          o.text(signQuad(u + M(0.045), v, M(0.55), zb0 + M(0.04), zb1 - M(0.04), 1), '₵2 · CROSS', '#ffb21d', true);
        }
      }
    }

    // ── THE FOOTBRIDGE ──
    // The free way over, at the end of the block: a glass lift tower out at the frontage edge of
    // each walkway, a deck 7.0 m clear of the lane between them, glass rails, an arched truss over
    // each edge of the deck, a cyan line under it, and its clearance on both fascias.
    if (bridgeHere) {
      const ub = BRIDGE_U, hu = M(K.DECK_W / 2), zr = DECK_Z1 + M(K.RAIL_H);
      const tw = M(K.TOWER_W / 2), tl = M(K.TOWER_L / 2), ztop = DECK_Z1 + M(K.TOWER_UP);
      for (const s of [-1, 1]) {
        const v = s * TOWER_V;
        tactile(ub, v - s * (tw + M(0.45)), tl, M(0.35));
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
        face([F(ub - tl, vb, g0), F(ub + tl, vb, g0), F(ub + tl, vb, ztop), F(ub - tl, vb, ztop)], PAL.glass, 'glass');
        box(ub, v, tl + M(0.12), tw + M(0.12), ztop, ztop + M(0.3), PAL.steelDk, 'metal', PAL.steelDk, 'metal', true);
        box(ub, v, tl + M(0.12), tw + M(0.12), ztop - M(0.05), ztop, PAL.cyan, 'lit');
      }
      // The deck from tower to tower.
      const dv = TOWER_V - tw;
      box(ub, 0, hu, dv, DECK_Z0, DECK_Z1, PAL.steelDk, 'metal', PAL.chrome, 'metal', true);
      box(ub, 0, M(0.1), dv, DECK_Z0 - M(0.03), DECK_Z0, PAL.cyan, 'lit', PAL.cyan, 'lit', true);
      for (const e of [-1, 1]) {
        const ue = ub + e * hu;
        // A glass rail along each edge with a steel top.
        face([F(ue, -dv, DECK_Z1), F(ue, dv, DECK_Z1), F(ue, dv, zr), F(ue, -dv, zr)], PAL.glass, 'glass');
        box(ue, 0, M(0.04), dv, zr, zr + M(0.06), PAL.steel, 'metal');
        // The arch over this edge, in straight pieces, with a hanger down to the deck at each joint.
        const N = near ? 10 : 6, base = zr + M(0.1);
        let prev = null;
        for (let i = 0; i <= N; i++) {
          const v = -dv + 2 * dv * i / N, k = v / dv, z = base + M(K.ARCH) * (1 - k * k);
          const p = F(ue, v, z);
          if (prev) strut(prev, p, M(0.09), PAL.steel, 'metal');
          if (i > 0 && i < N) strut(F(ue, v, zr + M(0.06)), p, M(0.035), PAL.steel, 'metal');
          prev = p;
        }
        // The clearance, on the fascia, read by a driver coming toward it from -e.
        if (o.text) {
          const uf = ub + e * (hu + M(0.01)), zm0 = DECK_Z0 + M(0.06), zm1 = DECK_Z1 - M(0.06);
          o.text(signQuad(uf, 0, M(3.2), zm0, zm1, e), 'FREE CROSSING · CLEARANCE 7.0 M', '#6fe3ff', true);
        }
      }
    }

    // ── THE RESPAWN KIOSK ──
    // A booth on a plinth on the free edge, its screen to the walkway under a canopy with a lit
    // edge, a magenta ad strip down one side: one at the start of the block on the west or north
    // side, one at the end on the other side.
    const kiosk = (u, s) => {
      const v = s * (OUT - M(K.KIOSK_IN)), hv = M(K.KIOSK_D / 2), hu = M(K.KIOSK_W / 2);
      box(u, v, hu + M(0.08), hv + M(0.08), KERB_H, KERB_H + M(0.1), PAL.plinth, 'paint');
      box(u, v, hu, hv, KERB_H + M(0.1), KERB_H + M(K.KIOSK_H), PAL.kiosk, 'metal');
      // The canopy reaches out over whoever is at the screen.
      box(u, v - s * M(0.25), M(0.8), hv + M(0.35), KERB_H + M(2.55), KERB_H + M(2.65), PAL.steelDk, 'metal', PAL.steelDk, 'metal', true);
      box(u, v - s * (hv + M(0.6)), M(0.8), M(0.02), KERB_H + M(2.52), KERB_H + M(2.55), PAL.cyan, 'lit');
      const fv = v - s * (hv + M(0.01));   // the face toward the lane
      // The reader stands on the walkway facing out toward the frontage (+s across), so their right
      // runs along the street the way `R` says.
      const R = s * (ns ? 1 : -1);
      const q = (z0, z1, hw) => [F(u - R * hw, fv, z1), F(u + R * hw, fv, z1), F(u + R * hw, fv, z0), F(u - R * hw, fv, z0)];
      face(q(KERB_H + M(0.9), KERB_H + M(2.2), M(0.5)), PAL.screen, 'lit');
      face(q(KERB_H + M(0.71), KERB_H + M(0.79), M(0.25)), PAL.amber, 'lit');
      const su = u + R * (hu + M(0.01));
      face([F(su, v - hv * 0.7, KERB_H + M(0.4)), F(su, v + hv * 0.7, KERB_H + M(0.4)), F(su, v + hv * 0.7, KERB_H + M(2.3)), F(su, v - hv * 0.7, KERB_H + M(2.3))], PAL.magenta, 'lit');
      if (o.text) {
        o.text(q(KERB_H + M(1.78), KERB_H + M(2.1), M(0.46)), 'RESPAWN', '#6fe3ff', true);
        o.text(q(KERB_H + M(1.42), KERB_H + M(1.74), M(0.46)), '₵40', '#6fe3ff', true);
        o.text(q(KERB_H + M(1.06), KERB_H + M(1.38), M(0.46)), 'WAKE HERE', '#6fe3ff', true);
      }
    };
    if (first) kiosk(run.n === 1 ? 0.3 : 0.15, -1);
    if (last && run.n > 1) kiosk(-0.15, 1);
  }

  // ── WHAT MOVES: THE CROSSING LAMPS, THE LIFT CARS, AND THE LIGHTS ──
  if (doDynamic && crossHere) {
    const on = Math.sin((o.now || 0) / 1000 * 3) > 0;
    for (const s of [-1, 1]) {
      const u = CROSS_U - M(2), v = s * (LANE_HW + M(K.POLE_IN)) - s * M(1.2), zl = KERB_H + M(K.POLE_H) - M(0.5);
      box(u + M(0.21), v, M(0.02), M(0.14), zl - M(0.14), zl + M(0.14), on ? PAL.amber : PAL.amberDim, 'lit');
      if (on && night > 0.2 && o.light) { const [x, y] = loc(u + M(0.24), v); o.light(dx + x, dy + y, zl, '255,178,29', 6, 0.5 * night); }
    }
  }
  if (doDynamic && bridgeHere) {
    // Each car runs a 20 s round: five seconds at the bottom, five up, five at the top, five down,
    // the two towers half a round apart. A pure function of the clock, like everything that moves.
    const tw = M(K.TOWER_W / 2), tl = M(K.TOWER_L / 2);
    for (const s of [-1, 1]) {
      const ph = (((o.now || 0) / 1000 + (s > 0 ? 10 : 0)) % 20 + 20) % 20;
      const k = ph < 5 ? 0 : ph < 10 ? (ph - 5) / 5 : ph < 15 ? 1 : 1 - (ph - 15) / 5;
      const e = k * k * (3 - 2 * k), z0 = KERB_H + M(0.12) + (DECK_Z1 - KERB_H - M(0.12)) * e;
      box(BRIDGE_U, s * TOWER_V, tl - M(0.15), tw - M(0.15), z0, z0 + M(2.1), PAL.cab, 'metal');
      box(BRIDGE_U, s * TOWER_V, tl - M(0.14), tw - M(0.14), z0 + M(2.0), z0 + M(2.06), PAL.cyan, 'lit');
    }
    if (night > 0.2 && o.light) { const [x, y] = loc(BRIDGE_U, 0); o.light(dx + x, dy + y, DECK_Z0, '111,227,255', 8, 0.35 * night); }
  }
}
