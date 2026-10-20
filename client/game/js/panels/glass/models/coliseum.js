// The Charles B. Hughson Coliseum: Deadball's ballpark, nine tiles, one model.
//
// Every arm takes drawTypeModelArm's arguments and its prologue locals, in this order:
//   (ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis)
// How a tile becomes a building is in docs/reference/world-rendering.md, and the park's content in
// scripts/content/hughson-coliseum.mjs and docs/proposals/hughson-coliseum.md.
//
// An art deco ballpark from the Meridian's decade, kept up, under a retractable roof added long after
// it opened. Pale limestone on a granite plinth, ranked with fins between tall concourse windows, a
// frieze and a glazed clerestory under a copper-flashed cornice, and a stepped light tower at each
// corner. The park's name is cut into a stone band along the wall on Sorrel Way and again on Halcyon
// Boulevard, one line each. The main gate on Sorrel Way is a stepped frontispiece between two
// Guardians in the manner of Cleveland's bridge, GRANDSTAND in raised gilt on its bronze plate; the
// bleacher gate on the boulevard is its smaller twin. The roof is three
// steel-and-glass shells on rails along the east and west decks. Shut, they're one long vault with a
// fan window at each end. Open, the two that travel are nested under the fixed one over the
// bleachers, and the infield and the grandstand have the sky.
//
// ⚠ ONE ARM, NINE SLICES. The park stands on x 895-897, y 911-913 in Halcyon Fields, and every tile
// is its own building type (`ballpark`, `ballpark_s`, ... `ballpark_bleachers`) whose registry row
// says which column (`bc`) and row (`br`) of the block it is and which way it was authored facing
// (`facing`). The whole park is drawn in BLOCK coordinates: u east and v south of the block's centre,
// in tiles, so tile (bc, br) has its centre at (bc - 1, br - 1). Each tile draws only what falls in
// its own square: flats and faces are clipped to it, boxes are cut at its edges, and an arc is split
// where it crosses a tile line, so the nine slices meet without a seam.
//
// ⚠ THE FRAME COMES FROM THE ROW, NOT FROM `E`. Two of the tiles are doors and face opposite ways
// (the main gate south onto Sorrel Way, the bleacher gate north onto Halcyon Boulevard), and the
// shape bake captures each type at a facing of its own choosing. Block coordinates are turned into
// the model's local frame with the facing the row declares; F then turns that frame to `E`. So a
// capture at another facing turns the whole slice with it, and the live draw (where E is the row's
// facing) puts it back on the block. Only north and south are supported, which is all the park uses.
//
// ⚠ THE WHOLE PARK IS IN CONSTANTS, NOT fh AND h, which are rolled per tile and would step at every
// joint (the Slush Fund's ⚠ in ashway.js). The rows' `floors` (skyline-scale.js) are what collision
// and the skyline read.
//
// ⚠ THE ROOF IS STATE, AND A MOVING ROOF IS NEVER MESH. The broadcast plugin shuts it for the weather
// (`venue.roof`), the cell says how it stood when the window was sent (`vr`), and a `venue_roof` push
// starts it moving (world-feed.js). GLASS 2 caches this model's mesh per state (`venueKey` in
// gl/world.js), so a roof at rest is drawn into the mesh where it rests, and while the shells travel
// the mesh has none and the arm lays them down as depth-writing decals at the position they've
// reached: the crane's route (glass-notes.md, Moving parts). GLASS 1 draws them every frame as flats.
// The shape is the shut roof in every state (see `shapeBox`), so collision is the dome. The fixed
// shell over the bleachers never moves, so it's mesh in every state.
//
// ⚠ THE LIGHTS. A working light every night, and the full blaze while Deadball is on air (`vl`). Open,
// the towers and the deck lamps light the field. Shut, the light comes out through the clerestory,
// the fan windows and the glazing along each shell's crown. The mesh holds colour by day and by night,
// so every lit face is emitted at every hour and only its colour follows the hour.
import {
  DETAIL_LIFT, FLAT_OFF, MESH_SINK, SHAPE_SINK, _place, bakeSignText, blinkLight, clamp,
  draw3DBoxAt, drawFacetDrum, dutyPhase, emitDecoFill, emitFlat, emitSurfaceText, emitWire,
  facePals, faceYaw, glowPool, materialIdOf, nearOrMesh, rgb, windFlag,
} from '../../windshield.js';
import { flatOut } from './downtown.js';
import { venueLive, venueRoof } from '../../world-feed.js';

// ── THE FIELD, IN BLOCK COORDINATES ──────────────────────────────────────────────────────────
// Home plate near the south-east corner, the foul lines running west and north along the tile
// grid, centre field to the north-west (the venue's bearing of 315 degrees). Tiles are 58.6 ft, so
// at this size the park is the map's compressed landmark, as GLASS draws every one; the broadcast
// draws the full-size park.
const HP = [0.95, 0.95];           // home plate
const WALL_R = 2.1;                // the outfield wall, from home
const TRACK = 0.085;               // the warning track inside it
const DIRT_R = 0.78;               // the infield skirt
const BASE = 0.5;                  // home to first
const MOUND = [0.70, 0.70];
const STAND = 1.10;                // where the grandstand starts, along both lines
const BACK = 1.40;                 // where the stands end: the inner face of the bowl wall
const LOW = -0.6;                  // past this the stands step down toward the corners
const SCOREBOARD = { u: -1.22, v: -1.22, w: 0.32, z0: 0.36, z1: 0.50 };   // over the top row in centre
// The outfield stands: rows round home from the back of the wall out to the bowl, rising to the
// wall's top course, so the front row leans over the padding.
const OSTAND = { r0: WALL_R + 0.03, row: 0.09, z0: 0.03, rise: 0.025 };

// ── THE BOWL ─────────────────────────────────────────────────────────────────────────────────
// One wall round all four sides, its outer face at OUT and its inner at BACK, in five courses up.
const OUT = 1.47;
// ⚠ EVERY HEIGHT IN THIS FILE IS DRAWN ZK TIMES TALLER. The arm's primitives scale z once, so the
// numbers keep the proportions they were drawn and measured at (the shells' nesting gaps).
const ZK = 1.4;
const Z = { plinth: 0.04, wall: 0.34, frieze: 0.37, cler: 0.43, corn: 0.46 };
const DECK = 1.13;                 // the east and west decks reach in from the wall to here, under the rails
const RAIL_OUT = [1.19, 1.25, 0.49], RAIL_IN = [1.16, 1.19, 0.475];   // the girder's two steps: from, to, top
const FIN_AT = Array.from({ length: 11 }, (_, k) => -1.225 + k * 0.245);   // the fins along every face
const TOWER = { at: 1.37, r0: 0.105, z0: 0.62, r1: 0.08, z1: 0.76, r2: 0.062, z2: 0.86, r3: 0.045, z3: 0.905 };
// The two gates. `face` is the frontispiece's front plane, a hair proud of the bowl.
const GATE = { u: 0.94, hw: 0.30, face: 1.48, top: 0.53 };
const BGATE = { u: -0.96, hw: 0.24, face: -1.48, top: 0.44 };
// The Guardians either side of the main gate: a pylon `hw` half wide, standing to `top`.
const GUARD = { hw: 0.055, top: 0.60 };
// The name band on the two gate faces: plain stone in the wall under the frieze, `d` proud, over
// windows cut short for it. It runs from the face's gate to the corner tower on the longer side.
const BAND = { z0: 0.268, z1: Z.wall, d: 0.026 };
const TW = TOWER.at - TOWER.r0;    // a corner tower's inner side, along a face
const bandRun = (g) => {
  const a = [-TW, g.u - g.hw - 0.03], b = [g.u + g.hw + 0.03, TW];
  return a[1] - a[0] >= b[1] - b[0] ? a : b;
};

// ── THE ROOF ─────────────────────────────────────────────────────────────────────────────────
// Three shells, biggest first, each a segmental vault across the bowl from rail to rail (`c` its
// half-span, `zs` where it springs, `rise` to its crown) and `len` long north to south. The first is
// fixed over the bleachers; the other two ride the rails' lower steps and nest under it, so each is a
// little narrower and lower than the one before. `open` and `shut` are where each one's north end is.
// ⚠ A SPLIT ROOF, A STACK AT EACH END. Six half-tile shells, listed north to south: three nest at the
// boulevard end and three at Sorrel Way, and the two smallest meet over the middle of the bowl. Open,
// each stack reaches half a tile in, over the back rows only. One stack of three full-tile shells
// reached a whole tile in and roofed most of the outfield seats.
// ⚠ THE GAPS ARE MEASURED. At the crown and at mid-span each shell clears the one above it by 0.025
// to 0.03 (0.85, 0.825, 0.80 at the crown), which is what lets them nest. Change a rise and check.
const SHELLS = [
  { c: 1.22, zs: 0.49, rise: 0.36, len: 0.50, open: -1.47, shut: -1.47 },
  { c: 1.175, zs: 0.475, rise: 0.35, len: 0.50, open: -1.45, shut: -0.98 },
  { c: 1.145, zs: 0.46, rise: 0.34, len: 0.50, open: -1.43, shut: -0.495 },
  { c: 1.145, zs: 0.46, rise: 0.34, len: 0.50, open: 0.93, shut: 0.005 },
  { c: 1.175, zs: 0.475, rise: 0.35, len: 0.50, open: 0.95, shut: 0.49 },
  { c: 1.22, zs: 0.49, rise: 0.36, len: 0.50, open: 0.97, shut: 0.97 },
];
const NF = 12;                     // facets across a vault
for (const S of SHELLS) {
  const R = (S.c * S.c + S.rise * S.rise) / (2 * S.rise), zc = S.zs + S.rise - R, th = Math.asin(S.c / R);
  // [u, z, nu, nz]: the arc from spring to spring, and its outward normal at each point
  S.arch = Array.from({ length: NF + 1 }, (_, i) => { const t = -th + 2 * th * i / NF; return [R * Math.sin(t), zc + R * Math.cos(t), Math.sin(t), Math.cos(t)]; });
}

// ── PALETTES AND COLOURS ─────────────────────────────────────────────────────────────────────
// The Palais's limestone (a deco hall somebody kept up, as this is), the archive's paler trim, the
// Meridian's bronze and copper, and marble-pale fins so the verticals carry in daylight.
const STONE = 'ty_palais_stone', TRIM = 'ty_archive_col', FINC = 'ty_marble_col', BRONZE = 'ty_meridian_bronze';
const COPPER = 'ty_verdigris', GRANITE = 'ty_precast_dk', CONC = 'ty_precast', STEEL = 'ty_fab_steel';
const GRASS_DAY = [62, 112, 58], GRASS_LIT = [112, 186, 92], GRASS_DARK = [24, 40, 26];
const DIRT_DAY = [150, 104, 70], DIRT_LIT = [206, 150, 104], DIRT_DARK = [52, 38, 30];
const TRACK_DAY = [122, 92, 68], SEAT = [44, 92, 62];
const LAMP_OFF = [70, 74, 78], LAMP_ON = [255, 246, 224];
const SHELL = [184, 188, 186], RIB = [96, 74, 50], GILT = [222, 178, 96], BRONZE_RGB = [92, 66, 40];
const GLASS_DAY = [58, 76, 88], GLASS_DARK = [22, 28, 34], GLOW = [255, 232, 194], WARM = [255, 212, 156];
const mixRgb = (a, b, k) => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * k);
const arcPts = (c, r, a0, a1, n) => Array.from({ length: n + 1 }, (_, i) => { const t = a0 + (a1 - a0) * i / n; return [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]; });
const FAIR = [Math.PI, 1.5 * Math.PI];   // west round to north, through the outfield
const SIDES = [[0, 1], [0, -1], [1, 0], [-1, 0]];   // the bowl's four faces: Sorrel Way, the boulevard, east, west

// Sutherland-Hodgman against an axis-aligned square, in the plane.
function clipPoly(pts, x0, x1, y0, y1) {
  const edges = [[(p) => p[0] >= x0, (a, b) => [x0, a[1] + (b[1] - a[1]) * (x0 - a[0]) / (b[0] - a[0])]],
    [(p) => p[0] <= x1, (a, b) => [x1, a[1] + (b[1] - a[1]) * (x1 - a[0]) / (b[0] - a[0])]],
    [(p) => p[1] >= y0, (a, b) => [a[0] + (b[0] - a[0]) * (y0 - a[1]) / (b[1] - a[1]), y0]],
    [(p) => p[1] <= y1, (a, b) => [a[0] + (b[0] - a[0]) * (y1 - a[1]) / (b[1] - a[1]), y1]]];
  let out = pts;
  for (const [inside, cut] of edges) {
    const src = out; out = [];
    for (let i = 0; i < src.length; i++) {
      const a = src[i], b = src[(i + 1) % src.length], ia = inside(a), ib = inside(b);
      if (ia) out.push(a);
      if (ia !== ib) out.push(cut(a, b));
    }
    if (!out.length) break;
  }
  return out;
}
// The same in three dimensions: a polygon of [u, v, z] cut by u and v bounds, z carried along. A
// plane polygon stays planar, so a vault facet or a fan window comes out of it whole.
function clip3(pts, x0, x1, y0, y1) {
  let out = pts;
  for (const [ax, val, s] of [[0, x0, 1], [0, x1, -1], [1, y0, 1], [1, y1, -1]]) {
    const src = out; out = [];
    for (let i = 0; i < src.length; i++) {
      const a = src[i], b = src[(i + 1) % src.length], da = s * (a[ax] - val), db = s * (b[ax] - val);
      if (da >= 0) out.push(a);
      if ((da >= 0) !== (db >= 0)) { const t = da / (da - db); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]); }
    }
    if (!out.length) break;
  }
  return out;
}
// A quad turned so its Newell normal agrees with `want`: emitFlat lights a face off its winding.
function wind(q, want) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < q.length; i++) {
    const a = q[i], b = q[(i + 1) % q.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return nx * want[0] + ny * want[1] + nz * want[2] < 0 ? q.slice().reverse() : q;
}
const cl255 = (c) => c.map((v) => clamp(v, 0, 255));

// ── THE PARK'S STATE ─────────────────────────────────────────────────────────────────────────
// The working light, on a night with no game, against the game night's 1.
const WORK = 0.42;
// What this frame draws: the hour, the game, how shut the roof is (`p`, 0 open, 1 shut) and whether
// it is moving. ⚠ A MESH CAPTURE DRAWS THE STATE ITS KEY NAMES, from the place gl/world.js hands it
// (`vl`, `vr`, `vrm`), never a live push: the cache entry is filed under that key. A moving roof's
// capture (`meshRoof` null) has no travelling shells at all. A live frame reads the push first and
// the cell after it. A static picture with no cell (a bake, the Modelshop) shows the dome shut.
function parkState(now, night) {
  const pl = _place || null, dn = night ? clamp(+night, 0, 1) : 0;
  let game, p, moving = false, meshRoof = null;
  if (MESH_SINK) {
    game = pl && pl.vl ? 1 : 0;
    meshRoof = pl && pl.vrm ? null : (pl && pl.vr != null ? +pl.vr : 1);
    p = meshRoof == null ? 0.5 : meshRoof;
  } else {
    const lit = pl ? venueLive(pl.wx, pl.wy) : undefined;
    game = lit !== undefined ? (lit ? 1 : 0) : (pl && pl.vl ? 1 : 0);
    // ⚠ The wall clock, never the arm's `now`: that is performance.now(), and the push is stamped
    // with Date.now(), so on the frame clock the move never started and the shells never left.
    const r = pl ? venueRoof(pl.wx, pl.wy) : undefined;
    if (r) { p = r.p; moving = r.moving; } else p = pl && pl.vr != null ? +pl.vr : 1;
  }
  const lightK = game ? 1 : WORK * clamp((dn - 0.05) / 0.3, 0, 1);
  return { dn, game, p, moving, meshRoof, lightK, towerK: lightK * (1 - p), domeK: lightK * p };
}

// Raised lettering: the text baked twice, a dark copy dropped down and right under the gilt face, so
// the letters cast a shadow onto their own plate (the Meridian's `embossText`). `quad(ox, oz)` returns
// the four projected corners with that offset.
export function embossText(ctx, cam, quad, text, face, shadow, night, alpha, opts) {
  const sh = bakeSignText(text, shadow, 0, false, true, undefined, opts);
  const fc = bakeSignText(text, face, night ? 1 : 0, false, true, undefined, opts);
  const S = quad(1, -1), Fq = quad(0, 0);
  if (sh && S.every((p) => p.f > 0.065)) emitSurfaceText(ctx, cam, S, sh, false, alpha * 0.85);
  if (fc && Fq.every((p) => p.f > 0.065)) emitSurfaceText(ctx, cam, Fq, fc, false, alpha);
}

export const COLISEUM_ARMS = {
  ballpark(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE HUGHSON COLISEUM, every tile
    const D = m.facing === 'north' ? [0, -1] : [0, 1];
    const cu = (m.bc ?? 1) - 1, cv = (m.br ?? 1) - 1;
    const X0 = cu - 0.5, X1 = cu + 0.5, Y0 = cv - 0.5, Y1 = cv + 0.5;
    const inTile = (u, v) => u >= X0 && u < X1 && v >= Y0 && v < Y1;
    const inRow = (v) => v >= Y0 && v < Y1, inCol = (u) => u >= X0 && u < X1;
    // block → the model's local frame (see the ⚠ on the frame above)
    const L = (u, v) => { const du = u - cu, dv = v - cv; return [du * D[1] - dv * D[0], du * D[0] + dv * D[1]]; };
    const Ld = (du, dv) => [du * D[1] - dv * D[0], du * D[0] + dv * D[1]];
    const P = (u, v) => F(...L(u, v));
    const B3 = (u, v, z) => { const [wx, wy] = P(u, v); return [wx, wy, z * ZK]; };   // a block point, in the world
    const W3L = (a, b, z) => { const [wx, wy] = F(a, b); return [wx, wy, z]; };   // a local point, in the world
    const yaw0 = faceYaw(E), NEAR = nearOrMesh();
    // the imported draws that take a height, scaled as the primitives below are (see ZK)
    const drum = (c, k, x, y, z0, z1, ...r) => drawFacetDrum(c, k, x, y, z0 * ZK, z1 * ZK, ...r);
    const pool = (c, k, x, y, z, ...r) => glowPool(c, k, x, y, z * ZK, ...r);
    const blink = (c, k, x, y, z, ...r) => blinkLight(c, k, x, y, z * ZK, ...r);
    const st = parkState(now, night), dn = st.dn, dusk = 1 - 0.6 * dn;
    const ledge = facePals(E, { side: TRIM, roof: COPPER });   // a course flashed in copper on top
    // The block direction (u, v, z) as a world direction, for the painter's key and the GPU's normal.
    const worldDir = (o) => { const lo = Ld(o[0], o[1]), [ax, ay] = F(0, 0), [bx, by] = F(lo[0], lo[1]); return [bx - ax, by - ay, o[2]]; };

    // ── PRIMITIVES, ALL IN BLOCK COORDINATES ─────────────────────────────────────────────────
    // A box over block u0..u1, v0..v1, cut to this tile and into pieces the 0.44 cap allows.
    const box = (u0, u1, v0, v1, z0, z1, p, roof, s = 0) => {
      u0 = Math.max(u0, X0); u1 = Math.min(u1, X1); v0 = Math.max(v0, Y0); v1 = Math.min(v1, Y1);
      if (u1 - u0 < 1e-4 || v1 - v0 < 1e-4) return;
      const nu = Math.max(1, Math.ceil((u1 - u0) / 0.88 - 1e-9)), nv = Math.max(1, Math.ceil((v1 - v0) / 0.88 - 1e-9));
      const su = (u1 - u0) / nu, sv = (v1 - v0) / nv;
      for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
        const [cx, cy] = P(u0 + su * (i + 0.5), v0 + sv * (j + 0.5));
        draw3DBoxAt(ctx, cam, cx, cy, su / 2, z0 * ZK, z1 * ZK, p, seed + s + i * 7 + j * 13, night, alpha, roof, yaw0, sv / 2);
      }
    };
    // A box along a segment, drawn by the tile its middle is on.
    const seg = (a, b, thick, z0, z1, p, roof, s = 0) => {
      const mu = (a[0] + b[0]) / 2, mv = (a[1] + b[1]) / 2;
      if (!inTile(mu, mv)) return;
      const [lx, ly] = Ld(b[0] - a[0], b[1] - a[1]), len = Math.hypot(lx, ly);
      if (len < 1e-4) return;
      const [cx, cy] = P(mu, mv);
      draw3DBoxAt(ctx, cam, cx, cy, len / 2, z0 * ZK, z1 * ZK, p, seed + s, night, alpha, roof, yaw0 + Math.atan2(ly, lx), thick / 2);
    };
    // A segment cut wherever it crosses a tile line, so each piece is drawn whole by one tile.
    const segCut = (a, b, ...rest) => {
      const ts = [0, 1];
      for (const k of [-1.5, -0.5, 0.5, 1.5]) for (const i of [0, 1]) {
        const d = b[i] - a[i];
        if (Math.abs(d) > 1e-9) { const t = (k - a[i]) / d; if (t > 1e-6 && t < 1 - 1e-6) ts.push(t); }
      }
      ts.sort((p, q) => p - q);
      const at = (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      for (let i = 0; i < ts.length - 1; i++) seg(at(ts[i]), at(ts[i + 1]), ...rest);
    };
    // An arc of boxes round home, in chords about 0.08 of a tile long.
    const arc = (r, a0, a1, thick, z0, z1, p, roof, s = 0) => {
      const n = Math.max(1, Math.ceil((a1 - a0) * r / 0.08));
      for (let k = 0; k < n; k++) {
        const p0 = a0 + (a1 - a0) * k / n, p1 = a0 + (a1 - a0) * (k + 1) / n;
        segCut([HP[0] + r * Math.cos(p0), HP[1] + r * Math.sin(p0)], [HP[0] + r * Math.cos(p1), HP[1] + r * Math.sin(p1)], thick, z0, z1, p, roof, s + k);
      }
    };
    // A flat on the ground (or any level), clipped to this tile.
    const flat = (poly, z, col, opts) => {
      const c = clipPoly(poly, X0, X1, Y0, Y1);
      if (c.length < 3) return;
      flatOut(ctx, cam, W3L, c.map(([u, v]) => [...L(u, v), z * ZK]), [0, 0, 1], rgb(cl255(col)), alpha, opts);
    };
    // A flat laid on the top of a box: a hair above it, and a lift so the painter puts it after the
    // box's own roof, whose centre is its centre.
    const ON_TOP = { lift: 0.03 };
    // A face of any shape, its points in block coordinates, turned to face `out`. Unlit: it holds its
    // colour, so after dark a lit one glows. The caller has already clipped it to the tile.
    const face = (pts, out, col, opts) => {
      if (pts.length < 3) return;
      flatOut(ctx, cam, W3L, pts.map(([u, v, z]) => [...L(u, v), z * ZK]), [...Ld(out[0], out[1]), out[2]], rgb(cl255(col)), alpha, opts);
    };
    // A face the GPU lights as the material family `fam` from the albedo `alb`, and the canvas paints
    // with the painter's fixed key. ⚠ A PALE FACE CARRIES ITS OWN DUSK: the mass shader dims at night
    // only what is darker than about 0.55 luminance (the clone facility's dome, tcFlat in twin-pass.js).
    const litFace = (pts, out, alb, fam, opts = {}) => {
      if (pts.length < 3 || SHAPE_SINK) return;
      const [ox, oy, oz] = worldDir(out), ol = Math.hypot(ox, oy, oz) || 1;
      const lum = (0.299 * alb[0] + 0.587 * alb[1] + 0.114 * alb[2]) / 255;
      const d = lum > 0.42 ? 1 - 0.55 * dn : 1, a = alb.map((c) => c * d);
      const k = clamp(0.64 + 0.28 * oz / ol - 0.14 * (ox + oy) / ol, 0.32, 1.12) * (1 - 0.55 * dn);
      emitFlat(ctx, cam, wind(pts.map(([u, v, z]) => B3(u, v, z)), [ox, oy, oz]), rgb(cl255(a.map((c) => c * k))), alpha,
        { lit: fam, albedo: cl255(a), lift: DETAIL_LIFT, cullN: Math.abs(oz / ol) < 0.8 ? [ox, oy] : undefined, ...opts });
    };
    // A moving face: a depth-writing decal, shaded by the same key and quantised, because a decal's
    // key is its colour and a shade sliding with the roof would mint a texture a frame.
    const decFace = (pts, out, col) => {
      if (pts.length < 3) return;
      const [ox, oy, oz] = worldDir(out), ol = Math.hypot(ox, oy, oz) || 1;
      const k = clamp(0.64 + 0.28 * oz / ol - 0.14 * (ox + oy) / ol, 0.32, 1.12) * (1 - 0.5 * dn);
      const q = (c) => Math.min(252, Math.round(clamp(c * k, 0, 255) / 6) * 6);
      emitDecoFill(ctx, cam, pts.map(([u, v, z]) => B3(u, v, z)), `rgb(${q(col[0])},${q(col[1])},${q(col[2])})`, alpha, 0, 'moving', true);
    };
    // A vertical face, drawn by the tile its plane runs through and cut along its run.
    const vface = (pts, out, col, lit, opts) => {
      const c = out[1] ? (inRow(pts[0][1]) ? clip3(pts, X0, X1, -9, 9) : null) : (inCol(pts[0][0]) ? clip3(pts, -9, 9, Y0, Y1) : null);
      if (!c || c.length < 3) return;
      if (lit) litFace(c, out, col, lit, opts); else face(c, out, col, opts);
    };
    // The bowl's faces, by the face's outward normal `n`: `t` runs along the face, `d` outward from
    // its plane at OUT (negative is into the wall).
    const SPT = (n, t, d, z) => (n[1] ? [t, n[1] * (OUT + d), z] : [n[0] * (OUT + d), t, z]);
    const sideBox = (n, t0, t1, d0, d1, z0, z1, p, roof, s) => {
      const a = n[1] || n[0], w0 = a * (OUT + d0), w1 = a * (OUT + d1), lo = Math.min(w0, w1), hi = Math.max(w0, w1);
      if (n[1]) box(t0, t1, lo, hi, z0, z1, p, roof, s); else box(lo, hi, t0, t1, z0, z1, p, roof, s);
    };
    const sideFace = (n, t0, t1, d, z0, z1, col, lit, opts) =>
      vface([SPT(n, t0, d, z1), SPT(n, t1, d, z1), SPT(n, t1, d, z0), SPT(n, t0, d, z0)], [n[0], n[1], 0], col, lit, opts);
    const facing = (nu, nv, pu, pv) => {
      const [ax, ay] = P(pu, pv), [bx, by] = P(pu + nu, pv + nv);
      return (bx - ax) * ((cam.ex || 0) - ax) + (by - ay) * ((cam.ey || 0) - ay) > 0;
    };

    // 1) THE GROUND: the infield's dirt, the grass, the warning track to the wall, and the foul ground
    //    out to the stands. Lit and open to the sky, the field is the brightest ground in the estate.
    // ⚠ ONE LAYER, AND NOTHING IN IT OVERLAPS. The 2-D painter orders flats by their mean depth, so a
    // flat laid over another one is drawn under it whenever its centre is the further of the two: a
    // concrete apron under the whole park came out as a dark tile across the outfield. So the field
    // is cut into pieces that meet edge to edge, each at the same height, and what sits on it (the
    // bags, home plate, the mound and the foul lines) is low mass, which both renderers sort by depth.
    // ⚠ AND EVERY FLAT IS CONVEX. The painter fans a polygon out from its first point, and a clipped
    // L or fan isn't star-shaped from wherever the clip leaves that point, so the field is laid as
    // wedges and rings from home plate, and rectangles, each clipped to the tile.
    const glow = st.towerK * dn;
    const grass = mixRgb(mixRgb(GRASS_DAY, GRASS_DARK, dn), GRASS_LIT, glow);
    const dirt = mixRgb(mixRgb(DIRT_DAY, DIRT_DARK, dn), DIRT_LIT, glow);
    const track = mixRgb(mixRgb(TRACK_DAY, DIRT_DARK, dn), DIRT_LIT, glow * 0.8);
    const GZ = 0.002, RG = WALL_R - TRACK, EDGE = STAND - 0.06;
    const rect = (u0, u1, v0, v1, z, col, opts) => flat([[u0, v0], [u1, v0], [u1, v1], [u0, v1]], z, col, opts);
    const fan = (c, r, a0, a1, z, col, n, opts) => {
      const pts = arcPts(c, r, a0, a1, n);
      for (let i = 0; i < n; i++) flat([c, pts[i], pts[i + 1]], z, col, opts);
    };
    const ring = (r0, r1, n, col) => {
      const a = arcPts(HP, r0, FAIR[0], FAIR[1], n), b = arcPts(HP, r1, FAIR[0], FAIR[1], n);
      for (let i = 0; i < n; i++) flat([a[i], b[i], b[i + 1], a[i + 1]], GZ, col);
    };
    fan(HP, DIRT_R, FAIR[0], FAIR[1], GZ, dirt, 12);
    ring(DIRT_R, RG, 24, grass);
    ring(RG, WALL_R, 24, track);
    // foul ground up the first-base line (east of it) and down the third (south of it)
    rect(HP[0], EDGE, HP[1] - RG, HP[1], GZ, grass);
    rect(HP[0], EDGE, HP[1] - WALL_R, HP[1] - RG, GZ, track);
    rect(EDGE, STAND, HP[1] - WALL_R, HP[1], GZ, track);
    rect(HP[0] - RG, HP[0], HP[1], EDGE, GZ, grass);
    rect(HP[0] - WALL_R, HP[0] - RG, HP[1], EDGE, GZ, track);
    rect(HP[0] - WALL_R, HP[0], EDGE, STAND, GZ, track);
    rect(HP[0], STAND, HP[1], STAND, GZ, dirt);
    // The bags and the plate are real, if low: the field tile's only mass is second base, and a tile
    // that captures no mass at all is a building with no building to shapes:smoke.
    for (const b of [[HP[0], HP[1] - BASE], [HP[0] - BASE, HP[1] - BASE], [HP[0] - BASE, HP[1]], HP]) box(b[0] - 0.016, b[0] + 0.016, b[1] - 0.016, b[1] + 0.016, 0, 0.012, CONC, true, 5);
    if (inTile(...MOUND)) {
      const [mx, my] = P(...MOUND), mud = rgb(cl255(dirt));
      drum(ctx, cam, mx, my, 0, 0.012, 0.055, 0.035, 10, alpha, () => mud, mud, GRANITE);
    }
    box(HP[0] - WALL_R, HP[0], HP[1] - 0.004, HP[1] + 0.004, 0, 0.006, CONC, true, 6);
    box(HP[0] - 0.004, HP[0] + 0.004, HP[1] - WALL_R, HP[1], 0, 0.006, CONC, true, 7);

    // 2) THE OUTFIELD WALL and the two foul poles.
    arc(WALL_R + 0.012, FAIR[0], FAIR[1], 0.024, 0, 0.055, GRANITE, true, 100);
    for (const p of [[HP[0] - WALL_R - 0.01, HP[1]], [HP[0], HP[1] - WALL_R - 0.01]]) {
      if (!inTile(...p)) continue;
      const [px, py] = P(...p);
      drum(ctx, cam, px, py, 0, 0.28, 0.006, 0.006, 6, alpha, () => rgb([214 * dusk, 186 * dusk, 40 * dusk]), 'rgb(120,104,24)', STEEL);
    }

    // 3) THE GRANDSTAND: an L along Sorrel Way and the east side, raked in three tiers to the bowl
    //    wall, stepping down toward both corners. Inside the wall now, so it has no back of its own.
    const tiers = [[STAND, 1.20, 0.055], [1.20, 1.31, 0.11], [1.31, BACK, 0.17]];
    box(STAND, BACK, STAND, BACK, 0, 0.17, CONC, true, 34);   // the corner behind home, under the gate
    for (const [sd, a0, a1] of [['s', -BACK, STAND], ['e', -BACK, STAND]]) {
      for (const [lo, hi, low] of [[a0, LOW, true], [LOW, a1, false]]) {
        const k = low ? 0.62 : 1;
        tiers.forEach(([t0, t1, z], i) => {
          if (sd === 's') box(lo, hi, t0, t1, 0, z * k, CONC, true, 10 + i);
          else box(t0, t1, lo, hi, 0, z * k, CONC, true, 20 + i);
          const zt = z * k + 0.004, seat = SEAT.map((c) => c * dusk);
          if (sd === 's') flat([[lo, t0 + 0.01], [hi, t0 + 0.01], [hi, t1 - 0.012], [lo, t1 - 0.012]], zt, seat, ON_TOP);
          else flat([[t0 + 0.01, lo], [t1 - 0.012, lo], [t1 - 0.012, hi], [t0 + 0.01, hi]], zt, seat, ON_TOP);
        });
      }
    }
    // Section nine: a crater in the third-base seats, rope round it.
    fan([0.05, 1.27], 0.06, 0, 2 * Math.PI, 0.114, [26, 24, 22], 10, ON_TOP);

    // 4) THE OUTFIELD STANDS: rows round home from the back of the wall out to the bowl, each a step
    //    higher, each run cut where its row meets the bowl wall, in chords about 0.16 long with a seat
    //    flat on each.
    {
      const seat = SEAT.map((c) => c * dusk), lim = BACK - 0.005;
      const at = (r, t) => [HP[0] + r * Math.cos(t), HP[1] + r * Math.sin(t)];
      for (let k = 0; ; k++) {
        const r0 = OSTAND.r0 + k * OSTAND.row, r1 = r0 + OSTAND.row, rm = (r0 + r1) / 2;
        if (rm > Math.hypot(HP[0] + lim, HP[1] + lim)) break;
        const z = OSTAND.z0 + k * OSTAND.rise;
        // the row's run inside the bowl: u and v both >= -lim at its middle radius
        const off = Math.acos(Math.min(1, (HP[0] + lim) / rm)), a0 = Math.PI + off, a1 = 1.5 * Math.PI - off;
        if (a1 <= a0) continue;
        const n = Math.max(1, Math.ceil((a1 - a0) * rm / 0.16));
        for (let q = 0; q < n; q++) {
          const p0 = a0 + (a1 - a0) * q / n, p1 = a0 + (a1 - a0) * (q + 1) / n;
          segCut(at(rm, p0), at(rm, p1), OSTAND.row, 0, z, CONC, true, 50 + k);
          flat([at(r0 + 0.008, p0), at(r1 - 0.01, p0), at(r1 - 0.01, p1), at(r0 + 0.008, p1)], z + 0.004, seat, ON_TOP);
        }
      }
    }

    // 5) THE SCOREBOARD past centre field, on two legs, square to home plate.
    {
      const s = SCOREBOARD, a = Math.atan2(HP[1] - s.v, HP[0] - s.u) + Math.PI / 2;
      const ea = [s.u - Math.cos(a) * s.w / 2, s.v - Math.sin(a) * s.w / 2], eb = [s.u + Math.cos(a) * s.w / 2, s.v + Math.sin(a) * s.w / 2];
      seg(ea, eb, 0.03, s.z0, s.z1, GRANITE, true, 60);
      if (inTile(s.u, s.v)) {
        for (const t of [-0.32, 0.32]) {
          const [lx, ly] = P(s.u + Math.cos(a) * s.w * t, s.v + Math.sin(a) * s.w * t);
          drum(ctx, cam, lx, ly, 0, s.z0, 0.01, 0.01, 6, alpha, () => rgb([70 * dusk, 74 * dusk, 78 * dusk]), 'rgb(40,42,44)', STEEL);
        }
        // its face toward the field: the line score's lamps, lit on a game night
        const nu = Math.cos(a - Math.PI / 2), nv = Math.sin(a - Math.PI / 2), off = 0.017;
        const pts = [[ea[0] + nu * off, ea[1] + nv * off, s.z1 - 0.012], [eb[0] + nu * off, eb[1] + nv * off, s.z1 - 0.012], [eb[0] + nu * off, eb[1] + nv * off, s.z0 + 0.012], [ea[0] + nu * off, ea[1] + nv * off, s.z0 + 0.012]];
        face(pts, [nu, nv, 0], st.game ? mixRgb([30, 34, 30], [250, 214, 120], 0.35 + 0.4 * dn) : [24, 26, 26]);
        if (st.game && dn > 0.05) pool(ctx, cam, ...P(s.u + nu * 0.06, s.v + nv * 0.06), (s.z0 + s.z1) / 2, '250,214,120', 14, alpha * 0.35 * dn);
      }
    }

    // 6) THE BOWL WALL, all four sides: a granite plinth, the limestone wall, a frieze course, the
    //    clerestory glass set back behind the fins, and the cornice flashed in copper. The north and
    //    south faces run to the corners and the east and west ones stop inside them, so no two faces
    //    lie in one plane.
    const winK = dn * (0.5 + 0.3 * st.game);   // the concourse is lit every night
    const winCol = mixRgb(mixRgb([46, 56, 64], [24, 28, 34], dn), WARM, winK);
    const clerCol = mixRgb(mixRgb([52, 64, 74], GLASS_DARK, dn), GLOW, dn * (0.3 + 0.7 * st.domeK));
    const frameCol = BRONZE_RGB.map((c) => c * dusk), giltCol = GILT.map((c) => c * (1 - 0.35 * dn));
    const nameText = ((name || '').trim() || 'Charles B. Hughson Coliseum').toUpperCase();
    // Cut letters, the reverse of `embossText`: the V in shadow, its upper wall darker still and its
    // lower lip catching the light, drawn as three copies, the dark one up and left of the letter,
    // the pale one down and right, and the cut over both. Each word is baked cropped to its ink and
    // the line laid out from the bakes' widths, so every word is drawn whole by the tile its middle
    // is on and the line still reads as one.
    // ⚠ THE BAKE DECIDES THE LAYOUT. A word's width is its canvas's aspect at the line's height, so
    // the line moves once when Limelight loads and the cache is cleared, and never after.
    const cutK = Math.round((1 - 0.6 * dn) * 8) / 8;
    const cutCol = rgb([92, 80, 63].map((c) => c * cutK)), lipCol = rgb([232, 222, 200].map((c) => c * cutK));
    const deepCol = rgb([40, 34, 27].map((c) => c * cutK));
    const inscribe = (n, t0, t1) => {
      const words = nameText.split(/\s+/), bake = (w, col) => bakeSignText(w, col, 0, false, true, true, { font: 'deco' });
      const cuts = words.map((w) => bake(w, cutCol));
      if (cuts.some((c) => !c || !(c.width > 0) || !(c.height > 0))) return;
      const asp = cuts.map((c) => c.width / c.height), A = asp.reduce((a, b) => a + b, 0);
      const hz = Math.min((BAND.z1 - BAND.z0) * 1.15, (t1 - t0) / A / ZK);   // the line's height, in z
      const za = (BAND.z0 + BAND.z1 - hz) / 2, zb = za + hz, r = n[1];      // r: east is the reader's right on Sorrel Way, left from the boulevard
      const tc = (t0 + t1) / 2;
      let at = -hz * ZK * A / 2;
      words.forEach((w, i) => {
        const wl = hz * ZK * asp[i], ta = tc + r * at, tb = tc + r * (at + wl);
        at += wl;
        if (!inTile((ta + tb) / 2, n[1] * (OUT - 0.01))) return;
        const quad = (ox, oz, dd, g = 0) => [[ta - r * g, zb + g], [tb + r * g, zb + g], [tb + r * g, za - g], [ta - r * g, za - g]]
          .map(([t, z]) => B3(...SPT(n, t + r * ox, BAND.d + dd, z + oz))).map((p) => cam.proj(p[0], p[1], p[2]));
        const lay = (tex, q, a) => { if (tex && q.every((p) => p.f > 0.065)) emitSurfaceText(ctx, cam, q, tex, false, a); };
        // Backlit after dark: a warm wash on the stone round each letter, as if lamps behind the
        // band were coming out through the cut. Soft, drawn under the cut, never over it.
        if (dn > 0.05) {
          lay(bake(w, 'rgb(255,206,140)'), quad(0, 0, 0.0004, hz * 0.06), alpha * 0.22 * dn);
          lay(bake(w, 'rgb(255,190,110)'), quad(0, 0, 0.0002, hz * 0.14), alpha * 0.1 * dn);
          const [pu, pv] = SPT(n, (ta + tb) / 2, BAND.d + 0.006, 0);
          pool(ctx, cam, ...P(pu, pv), (za + zb) / 2, '255,200,130', 10, alpha * 0.14 * dn, { add: true });
        }
        lay(bake(w, deepCol), quad(-0.0011, 0.0010, 0.0008), alpha * 0.9);
        lay(bake(w, lipCol), quad(0.0014, -0.0013, 0.0014), alpha * 0.85 * (1 - 0.6 * dn));
        lay(cuts[i], quad(0, 0, 0.0022), alpha);
      });
    };
    SIDES.forEach((n, k) => {
      const ns = !!n[1], run = ns ? OUT + 0.01 : BACK;   // north and south take the corners
      const s = 200 + k * 10;
      sideBox(n, -run, run, -0.07, 0.008, 0, Z.plinth, GRANITE, true, s);
      sideBox(n, -run, run, -0.07, 0, Z.plinth, Z.wall, STONE, false, s + 1);
      sideBox(n, -run, run, -0.07, 0.006, Z.wall, Z.frieze, TRIM, true, s + 2);   // ⚠ LIDDED: it stands proud of the clerestory set in over it (lidless)
      sideBox(n, -run, run, -0.07, -0.018, Z.frieze, Z.cler, STONE, false, s + 3);
      sideBox(n, -run, run, -0.07, 0.01, Z.cler, Z.corn, ledge, true, s + 4);
      // ⚠ NOT ACROSS A GATE. Each gate's frontispiece stands in front of this face, and a fin, a
      // window or the clerestory behind it would show through it in the 2-D painter.
      const gate = (t) => (n[1] === 1 && t > GATE.u - GATE.hw - 0.04 && t < GATE.u + GATE.hw + 0.04)
        || (n[1] === -1 && t > BGATE.u - BGATE.hw - 0.04 && t < BGATE.u + BGATE.hw + 0.04);
      const gs = n[1] === 1 ? GATE : n[1] === -1 ? BGATE : null;
      const clerRuns = gs ? [[-run + 0.01, gs.u - gs.hw], [gs.u + gs.hw, run - 0.01]] : [[-run + 0.01, run - 0.01]];
      for (const [t0, t1] of clerRuns) sideFace(n, t0, t1, -0.016, Z.frieze + 0.004, Z.cler - 0.004, clerCol);
      // The name band on Sorrel Way and the boulevard: the longest clear run of the face, between its
      // gate and the far corner tower (bandRun). The fins stop under it and carry on over it.
      const bnd = gs ? bandRun(gs) : null;
      const inBand = (t) => !!bnd && t > bnd[0] && t < bnd[1];
      if (bnd) sideBox(n, bnd[0], bnd[1], -0.01, BAND.d, BAND.z0, BAND.z1, TRIM, true, s + 5);
      // The fins: marble-pale, standing through the frieze and the clerestory to break the cornice,
      // each with a stepped cap. The deco vertical, and the frame the windows sit in.
      FIN_AT.forEach((t, j) => {
        if (gate(t)) return;
        if (inBand(t)) {
          sideBox(n, t - 0.011, t + 0.011, -0.01, 0.022, Z.plinth, BAND.z0, FINC, true, s + 20 + j);
          sideBox(n, t - 0.011, t + 0.011, -0.01, 0.022, BAND.z1, 0.49, FINC, true, s + 60 + j);
        } else sideBox(n, t - 0.011, t + 0.011, -0.01, 0.022, Z.plinth, 0.49, FINC, true, s + 20 + j);
        sideBox(n, t - 0.007, t + 0.007, -0.01, 0.017, 0.49, 0.512, TRIM, true, s + 40 + j);
      });
      // Between each pair of fins a tall window onto the concourse in a bronze frame, a bronze
      // spandrel over it, and a gilt chevron in the spandrel. Under the band the window stops short
      // of it, with no spandrel.
      for (let j = 0; j + 1 < FIN_AT.length; j++) {
        const tc = (FIN_AT[j] + FIN_AT[j + 1]) / 2;
        if (gate(tc)) continue;
        // ⚠ A FEW THOUSANDTHS PROUD, NOT A HAIR. These are mesh on GLASS 2, depth-tested against the
        // wall they're on, and a frame a thousandth off its wall shimmers through it at range.
        if (inBand(tc)) {
          sideFace(n, tc - 0.082, tc + 0.082, 0.003, 0.094, BAND.z0 - 0.010, frameCol);
          sideFace(n, tc - 0.074, tc + 0.074, 0.0042, 0.100, BAND.z0 - 0.016, winCol);
          continue;
        }
        sideFace(n, tc - 0.082, tc + 0.082, 0.003, 0.094, 0.291, frameCol);
        sideFace(n, tc - 0.074, tc + 0.074, 0.0042, 0.100, 0.285, winCol);
        sideFace(n, tc - 0.074, tc + 0.074, 0.0042, 0.296, 0.328, frameCol);
        for (const sg of [-1, 1]) {
          const a = SPT(n, tc + sg * 0.034, 0.0054, 0.300), b = SPT(n, tc, 0.0054, 0.319);
          const a2 = SPT(n, tc + sg * 0.034, 0.0054, 0.306), b2 = SPT(n, tc, 0.0054, 0.325);
          vface([b2, a2, a, b], [n[0], n[1], 0], giltCol);
        }
      }
      // THE NAME, CUT INTO THE BAND in one line, read from the street the face is on.
      if (bnd && facing(0, n[1], (bnd[0] + bnd[1]) / 2, n[1] * OUT)) inscribe(n, bnd[0] + 0.05, bnd[1] - 0.05);
    });
    // The decks over the east and west concourse, roofed in copper, with columns under their inner
    // edge and the rails along them: the girder's two steps, one for each shell that rides it.
    for (const su of [1, -1]) {
      const lo = (a, b) => (su > 0 ? [a, b] : [-b, -a]);
      box(...lo(DECK, BACK), -BACK, BACK, Z.cler, Z.corn, ledge, true, 260 + su);
      box(...lo(RAIL_OUT[0], RAIL_OUT[1]), -OUT, OUT, Z.corn, RAIL_OUT[2], BRONZE, true, 264 + su);
      box(...lo(RAIL_IN[0], RAIL_IN[1]), -OUT, OUT, Z.corn, RAIL_IN[2], BRONZE, true, 268 + su);
      for (let j = 0; j < 7; j++) {
        // ⚠ AT 1.18, NOT AT THE DECK'S EDGE. On the west side a column at the edge stood on the
        // warning track by the left-field pole; here every one is behind the outfield wall or in the
        // first-base stands.
        const v = -1.26 + j * 0.42, u = su * 1.18;
        box(u - 0.009, u + 0.009, v - 0.009, v + 0.009, 0.0, Z.cler, CONC, false, 270 + j);
        // a floodlamp under the deck's edge, turned to the field
        vface([[su * (DECK - 0.002), v - 0.03, 0.425], [su * (DECK - 0.002), v + 0.03, 0.425], [su * (DECK - 0.002), v + 0.03, 0.405], [su * (DECK - 0.002), v - 0.03, 0.405]],
          [-su, 0, 0], mixRgb(LAMP_OFF, LAMP_ON, st.towerK > 0.01 ? 0.35 + 0.65 * st.towerK : 0));
      }
    }
    // The sills the two fixed shells stand on, along the top of the boulevard wall and of Sorrel Way's.
    box(-SHELLS[0].c, SHELLS[0].c, -OUT, -BACK, Z.corn, SHELLS[0].zs, TRIM, true, 280);
    const SL = SHELLS[SHELLS.length - 1];
    box(-SL.c, SL.c, BACK, OUT, Z.corn, SL.zs, TRIM, true, 281);   // and the one the Sorrel Way stack stands on

    // 7) THE FOUR LIGHT TOWERS, one at each corner: a fluted limestone shaft, two setbacks, a bronze
    //    lamp house with its floods turned to the field, a stepped crown and a finial. They were the
    //    park's light towers before it had a roof, and the roof's rails run between them.
    for (const [su, sv] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const tu = su * TOWER.at, tv = sv * TOWER.at, T = TOWER;
      if (!inTile(tu, tv)) continue;
      const sq = (r, z0, z1, p, roof, s) => box(tu - r, tu + r, tv - r, tv + r, z0, z1, p, roof, 300 + s);
      sq(T.r0 + 0.006, 0, Z.plinth, GRANITE, true, 0);
      sq(T.r0, Z.plinth, T.z0, STONE, false, 1);
      sq(T.r0 + 0.006, T.z0, T.z0 + 0.016, ledge, true, 2);
      sq(T.r1, T.z0 + 0.016, T.z1, STONE, false, 3);
      sq(T.r1 + 0.005, T.z1, T.z1 + 0.012, ledge, true, 4);
      sq(T.r2, T.z1 + 0.012, T.z2, BRONZE, false, 5);
      sq(T.r2 + 0.004, T.z2, T.z2 + 0.014, ledge, true, 6);
      sq(T.r3, T.z2 + 0.014, T.z3, TRIM, true, 7);
      // Three fins on each outer face, the middle one carried up the first setback, and between them
      // a lit slit and a gilt chevron near the top of the shaft.
      for (const [nu, nv] of [[su, 0], [0, sv]]) {
        const fu = (o) => (nu ? tu + nu * T.r0 : tu + o), fv = (o) => (nv ? tv + nv * T.r0 : tv + o);
        [-0.055, 0, 0.055].forEach((o, j) => {
          const hu = nu ? 0.012 : 0.008, hv = nv ? 0.012 : 0.008, top = o ? T.z0 : T.z1 - 0.02;
          box(fu(o) - hu, fu(o) + hu, fv(o) - hv, fv(o) + hv, Z.plinth + 0.02, top, FINC, true, 320 + j + (nu ? 0 : 3));
        });
        for (const o of [-0.0275, 0.0275]) {
          const u = fu(o) + nu * 0.004, v = fv(o) + nv * 0.004, w = 0.0065;
          const at = (a, z) => (nu ? [u, v + a, z] : [u + a, v, z]);
          vface([at(-w, 0.52), at(w, 0.52), at(w, 0.20), at(-w, 0.20)], [nu, nv, 0], winCol);
          for (const sg of [-1, 1]) vface([at(0, 0.585), at(sg * 0.018, 0.565), at(sg * 0.018, 0.557), at(0, 0.577)], [nu, nv, 0], giltCol);   // a gilt chevron over it
        }
      }
      // The floods: a lamp grid on each of the lamp house's two faces turned to the field.
      const lampCol = mixRgb(LAMP_OFF, LAMP_ON, st.towerK > 0.01 ? 0.35 + 0.65 * st.towerK : 0);
      for (const [nu, nv] of [[-su, 0], [0, -sv]]) {
        const u = nu ? tu + nu * (T.r2 + 0.0015) : tu, v = nv ? tv + nv * (T.r2 + 0.0015) : tv, w = 0.048;
        const pts = nu ? [[u, v - w, 0.848], [u, v + w, 0.848], [u, v + w, 0.784], [u, v - w, 0.784]] : [[u - w, v, 0.848], [u + w, v, 0.848], [u + w, v, 0.784], [u - w, v, 0.784]];
        vface(pts, [nu, nv, 0], lampCol);
      }
      const [tx, ty] = P(tu, tv);
      drum(ctx, cam, tx, ty, T.z3, T.z3 + 0.07, 0.014, 0.004, 8, alpha, () => rgb(BRONZE_RGB.map((c) => c * dusk)), rgb(BRONZE_RGB.map((c) => c * dusk)), BRONZE);
      if (dn > 0.3) blink(ctx, cam, tx, ty, T.z3 + 0.08, '255,60,40', now, seed + su * 3 + sv, alpha, 1.6);
      if (st.towerK > 0.01) {
        // the floods burning, and the pool each tower throws on the field
        const ex = tu - su * 0.07, ey = tv - sv * 0.07;
        pool(ctx, cam, ...P(ex, ey), 0.815, '255,246,224', 26, alpha * (0.25 + 0.55 * st.towerK) * (0.4 + 0.6 * dn), { max: 90 });
        if (dn > 0.05) {
          const toward = Math.atan2(MOUND[1] - tv, MOUND[0] - tu);
          pool(ctx, cam, ...P(tu + Math.cos(toward) * 0.95, tv + Math.sin(toward) * 0.95), 0.02, '236,248,224', 70, alpha * 0.22 * dn * st.towerK, { max: 140 });
        }
      }
    }

    // 8) THE MAIN GATE on Sorrel Way: a stepped frontispiece between two Guardian pylons, a portal in
    //    three receding orders round bronze doors and a sunburst fanlight, a narrow grille gate
    //    either side, and over it GRANDSTAND in raised gilt on a bronze plate with a double gilt
    //    fillet, backlit after dark. A gilt sun rises from the setback over it, a baseball for its
    //    disc, and the flag flies from the top. The park's name is cut into the wall beside it (6).
    if (inTile(GATE.u, OUT - 0.01)) {
      const G = GATE, gu = G.u, gf = G.face, u0 = gu - G.hw, u1 = gu + G.hw;
      box(u0, u1, BACK, gf, Z.plinth, G.top, STONE, false, 400);
      box(u0 - 0.005, u1 + 0.005, BACK, gf + 0.006, 0, Z.plinth, GRANITE, true, 401);
      box(u0, u1, BACK, gf + 0.004, G.top, G.top + 0.012, ledge, true, 402);
      // the setback, between the pylons' inner faces
      const sb = G.hw - 2 * GUARD.hw;
      box(gu - sb, gu + sb, BACK, gf - 0.004, G.top + 0.012, 0.60, STONE, false, 403);
      box(gu - sb, gu + sb, BACK, gf - 0.001, 0.60, 0.61, ledge, true, 404);
      box(gu - 0.10, gu + 0.10, BACK, gf - 0.008, 0.61, 0.655, facePals(E, { side: STONE, roof: COPPER }), true, 405);
      // THE GUARDIANS, after the Hope Memorial Bridge's in Cleveland: a pylon either side of the gate,
      // fluted below, and standing on a corbel halfway up it a helmeted figure in relief, robed to
      // the feet, square-shouldered, holding the game before him. The west one cradles a ball, the
      // east one rests on a bat held point-down like a sword. Stone, the ball and the bat gilt.
      // ⚠ THE RELIEF IS 0.013 DEEP AT MOST. The pylon's face is 0.006 off the frontispiece and the
      // tile ends 0.02 off it, at the edge of Sorrel Way, where `box` cuts everything off.
      const fluteCol = [96 * dusk, 84 * dusk, 66 * dusk], FIGC = [200, 184, 154];
      for (const [sg, pu] of [[-1, u0 + GUARD.hw], [1, u1 - GUARD.hw]]) {
        const ph = GUARD.hw, yF = gf + 0.006;
        box(pu - ph - 0.006, pu + ph + 0.006, BACK, gf + 0.010, 0, Z.plinth, GRANITE, true, 410);
        box(pu - ph, pu + ph, BACK, yF, Z.plinth, GUARD.top, STONE, false, 411);
        box(pu - ph + 0.006, pu + ph - 0.006, BACK, yF - 0.002, GUARD.top, GUARD.top + 0.012, ledge, true, 412);
        box(pu - ph + 0.017, pu + ph - 0.017, BACK, yF - 0.006, GUARD.top + 0.012, GUARD.top + 0.026, ledge, true, 413);
        box(pu - ph + 0.029, pu + ph - 0.029, BACK, yF - 0.010, GUARD.top + 0.026, GUARD.top + 0.038, ledge, true, 414);
        for (const o of [-0.03, 0, 0.03]) face([[pu + o - 0.002, yF + 0.0006, 0.25], [pu + o + 0.002, yF + 0.0006, 0.25], [pu + o + 0.002, yF + 0.0006, 0.06], [pu + o - 0.002, yF + 0.0006, 0.06]], [0, 1, 0], fluteCol);
        // the corbel, stepped
        box(pu - 0.032, pu + 0.032, yF, yF + 0.008, 0.256, 0.272, TRIM, true, 415);
        box(pu - 0.044, pu + 0.044, yF, yF + 0.012, 0.272, 0.286, TRIM, true, 416);
        // The figure, carved: each piece a convex outline [u, z] on the pylon's face, its front `d`
        // proud and its sides back to the face. ⚠ DRESSED STONE, NOT BOXES. A box wears its
        // palette's block joints, and the first figure, built of boxes, read as stacked masonry.
        const carve = (sil, d, alb = FIGC) => {
          const cu = sil.reduce((t, p) => t + p[0], 0) / sil.length, cz = sil.reduce((t, p) => t + p[1], 0) / sil.length;
          litFace(sil.map(([a, z]) => [pu + a, yF + d, z]), [0, 1, 0], alb, 'stone');
          sil.forEach((p, i) => {
            const q = sil[(i + 1) % sil.length], mu = (p[0] + q[0]) / 2 - cu, mz = ((p[1] + q[1]) / 2 - cz) * ZK;
            let nu = (q[1] - p[1]) * ZK, nz = -(q[0] - p[0]);
            if (nu * mu + nz * mz < 0) { nu = -nu; nz = -nz; }
            litFace([[pu + p[0], yF, p[1]], [pu + q[0], yF, q[1]], [pu + q[0], yF + d, q[1]], [pu + p[0], yF + d, p[1]]], [nu, 0, nz], alb, 'stone');
          });
        };
        carve([[-0.030, 0.286], [0.030, 0.286], [0.025, 0.432], [-0.025, 0.432]], 0.009);   // the robe, to the feet
        carve([[-0.025, 0.432], [0.025, 0.432], [0.036, 0.490], [-0.036, 0.490]], 0.011);   // the chest
        carve([[-0.038, 0.488], [0.038, 0.488], [0.038, 0.498], [0.031, 0.505], [-0.031, 0.505], [-0.038, 0.498]], 0.010);   // the shoulders, squared
        for (const sa of [-1, 1]) carve([[sa * 0.038, 0.492], [sa * 0.030, 0.492], [sa * 0.026, 0.446], [sa * 0.034, 0.446]], 0.012);   // the upper arms
        carve([[-0.007, 0.503], [0.007, 0.503], [0.007, 0.513], [-0.007, 0.513]], 0.008);   // the neck
        carve([[-0.0125, 0.519], [-0.008, 0.513], [0.008, 0.513], [0.0125, 0.519], [0.0125, 0.535], [0.008, 0.541], [-0.008, 0.541], [-0.0125, 0.535]], 0.012);   // the head
        carve([[-0.0155, 0.531], [0.0155, 0.531], [0.0145, 0.546], [0.008, 0.555], [-0.008, 0.555], [-0.0145, 0.546]], 0.013);   // the helmet
        carve([[-0.004, 0.553], [0.004, 0.553], [0.003, 0.565], [-0.003, 0.565]], 0.012);   // its crest
        const fold = [150 * dusk, 136 * dusk, 112 * dusk];
        for (const o of [-0.014, 0, 0.014]) face([[pu + o - 0.0012, yF + 0.0093, 0.425], [pu + o + 0.0012, yF + 0.0093, 0.425], [pu + o + 0.0012, yF + 0.0093, 0.292], [pu + o - 0.0012, yF + 0.0093, 0.292]], [0, 1, 0], fold);   // the robe's folds
        face([[pu - 0.0125, yF + 0.0122, 0.531], [pu + 0.0125, yF + 0.0122, 0.531], [pu + 0.0125, yF + 0.0122, 0.526], [pu - 0.0125, yF + 0.0122, 0.526]], [0, 1, 0], fold);   // the brim's shadow over the eyes
        // the forearms across the body, and what the hands hold
        if (sg < 0) {
          carve([[-0.033, 0.437], [0.033, 0.437], [0.033, 0.452], [-0.033, 0.452]], 0.0125);
          const yb = yF + 0.0133, zc = 0.452 + 0.017 / ZK, rr = 0.017, disc = [];
          for (let k = 0; k < 16; k++) { const a = 2 * Math.PI * k / 16; disc.push([pu + Math.cos(a) * rr, yb, zc + Math.sin(a) * rr / ZK]); }
          face(disc, [0, 1, 0], giltCol);
          for (const ss of [-1, 1]) {   // its stitches, two arcs bowed in toward the middle
            const pts = [];
            for (let k = 0; k <= 4; k++) { const a = -1.2 + 2.4 * k / 4; pts.push([pu + ss * rr * (0.8 - 0.35 * Math.cos(a)), zc + Math.sin(a) * rr * 0.8 / ZK]); }
            for (let k = 0; k < 4; k++) face([[pts[k][0] - 0.001, yb + 0.0004, pts[k][1]], [pts[k + 1][0] - 0.001, yb + 0.0004, pts[k + 1][1]], [pts[k + 1][0] + 0.001, yb + 0.0004, pts[k + 1][1]], [pts[k][0] + 0.001, yb + 0.0004, pts[k][1]]], [0, 1, 0], [170 * dusk, 40 * dusk, 34 * dusk]);
          }
        } else {
          const yb = yF + 0.0115;   // the bat stands on the robe, under the hands
          face([[pu - 0.0028, yb, 0.47], [pu + 0.0028, yb, 0.47], [pu + 0.0085, yb, 0.30], [pu - 0.0085, yb, 0.30]], [0, 1, 0], giltCol);
          face([[pu - 0.006, yb, 0.476], [pu + 0.006, yb, 0.476], [pu + 0.006, yb, 0.469], [pu - 0.006, yb, 0.469]], [0, 1, 0], giltCol);   // the knob
          carve([[-0.033, 0.446], [0.033, 0.446], [0.033, 0.46], [-0.033, 0.46]], 0.0125);
          carve([[-0.009, 0.443], [0.009, 0.443], [0.009, 0.468], [-0.009, 0.468]], 0.0132);   // the hands, one over the other on the handle
        }
        // floodlit from the pavement after dark
        if (dn > 0.05) pool(ctx, cam, ...P(pu, gf + 0.012), 0.42, '255,222,170', 13, alpha * 0.35 * dn);
      }
      // The portal: three orders, the inner one least proud, each stepping out and up.
      const ow = 0.075, zO = 0.27, dz = 0.022;
      for (let i = 0; i < 3; i++) {
        const d = 0.006 * (i + 1), jx = ow + 0.016 * (i + 0.5);
        for (const sg of [-1, 1]) box(gu + sg * jx - 0.008, gu + sg * jx + 0.008, gf - 0.01, gf + d, 0, zO + dz * i, TRIM, true, 420 + i * 2 + (sg > 0));
        box(gu - jx - 0.008, gu + jx + 0.008, gf - 0.01, gf + d, zO + dz * i, zO + dz * (i + 1), TRIM, true, 426 + i);
      }
      // ⚠ THE DOORS STAND ON THE BODY'S FACE, A HAIR PROUD OF IT, not back in a recess: a flat at the
      // bottom of a tunnel between the jambs is pulled through them at any oblique angle (the
      // Meridian's ⚠). The inner order stands 0.006 off them, which is the reveal.
      const yd = gf + 0.0015, lobby = mixRgb([64, 78, 88], [255, 206, 140], dn);
      face([[gu - ow, yd - 0.0006, zO], [gu + ow, yd - 0.0006, zO], [gu + ow, yd - 0.0006, 0], [gu - ow, yd - 0.0006, 0]], [0, 1, 0], frameCol);
      for (const sg of [-1, 1]) {
        const a = gu + sg * 0.004, b = gu + sg * (ow - 0.006);
        face([[Math.min(a, b), yd, 0.165], [Math.max(a, b), yd, 0.165], [Math.max(a, b), yd, 0.006], [Math.min(a, b), yd, 0.006]], [0, 1, 0], lobby);
        face([[gu + sg * 0.010 - 0.002, yd + 0.0004, 0.10], [gu + sg * 0.010 + 0.002, yd + 0.0004, 0.10], [gu + sg * 0.010 + 0.002, yd + 0.0004, 0.06], [gu + sg * 0.010 - 0.002, yd + 0.0004, 0.06]], [0, 1, 0], giltCol);
      }
      face([[gu - ow, yd, 0.173], [gu + ow, yd, 0.173], [gu + ow, yd, 0.165], [gu - ow, yd, 0.165]], [0, 1, 0], giltCol);
      {   // the sunburst fanlight over the doors: a half-disc of glass and seven bronze rays
        const r = ow - 0.006, zb = 0.173, fanPts = [[gu, yd, zb]];
        for (let k = 0; k <= 16; k++) { const t = Math.PI * k / 16; fanPts.push([gu + Math.cos(t) * r, yd, zb + Math.sin(t) * r]); }
        face(fanPts, [0, 1, 0], lobby);
        for (let k = 1; k < 8; k++) {
          const t = Math.PI * k / 8, c = Math.cos(t), s = Math.sin(t), w = 0.0022;
          face([[gu - s * w, yd + 0.0004, zb + c * w], [gu + s * w, yd + 0.0004, zb - c * w], [gu + c * r + s * w, yd + 0.0004, zb + s * r - c * w], [gu + c * r - s * w, yd + 0.0004, zb + s * r + c * w]], [0, 1, 0], frameCol);
        }
      }
      // The grille gates either side, narrow between a Guardian and the portal: dark openings under
      // lit transoms, iron bars when you're close.
      for (const bu of [gu - 0.1535, gu + 0.1535]) {
        face([[bu - 0.022, yd, 0.16], [bu + 0.022, yd, 0.16], [bu + 0.022, yd, 0], [bu - 0.022, yd, 0]], [0, 1, 0], mixRgb([30, 26, 22], [140, 104, 64], dn * 0.6));
        face([[bu - 0.022, yd, 0.19], [bu + 0.022, yd, 0.19], [bu + 0.022, yd, 0.166], [bu - 0.022, yd, 0.166]], [0, 1, 0], lobby);
        box(bu - 0.028, bu + 0.028, gf - 0.01, gf + 0.008, 0.19, 0.204, TRIM, true, 430);
        for (const sg of [-1, 1]) box(bu + sg * 0.025 - 0.003, bu + sg * 0.025 + 0.003, gf - 0.01, gf + 0.008, 0, 0.19, TRIM, true, 432);
        if (NEAR) for (let k = -2; k <= 2; k++) emitWire(ctx, cam, B3(bu + k * 0.008, yd + 0.002, 0.005), B3(bu + k * 0.008, yd + 0.002, 0.158), 1.2, 'rgba(30,32,34,0.92)', alpha, { pull: 0.004 });
        // a bronze lantern over it, on the body's face, lit from dusk
        const [lx, ly] = P(bu, gf + 0.0095);
        drum(ctx, cam, lx, ly, 0.214, 0.262, 0.0085, 0.0085, 8, alpha, () => rgb(dn > 0.05 ? [255, 214, 150] : BRONZE_RGB), rgb(BRONZE_RGB), BRONZE);
        if (dn > 0.05) pool(ctx, cam, lx, ly, 0.238, '255,206,140', 7, alpha * 0.6 * dn);
      }
      // THE PLATE. Flat, not a box (a box wears its palette's window skin over the lettering),
      // standing 0.016 off the stone so the backlight has somewhere to come out of. Narrow enough
      // to stand clear of the Guardians.
      const pz0 = 0.385, pz1 = 0.475, phw = 0.165, yp = gf + 0.016, yg = yp + 0.0015;
      const PQ = (y, x0, x1, za, zb, col) => face([[x0, y, zb], [x1, y, zb], [x1, y, za], [x0, y, za]], [0, 1, 0], col);
      // the halo: a rim of light round the plate on the plane just behind it after dark, its shadow by day
      const rim = dn > 0.05 ? mixRgb([30, 22, 14], [255, 206, 130], Math.min(1, dn * 1.4)) : [30, 22, 14];
      const t = 0.007, yr = yp - 0.004;
      PQ(yr, gu - phw - t, gu + phw + t, pz1, pz1 + t, rim); PQ(yr, gu - phw - t, gu + phw + t, pz0 - t, pz0, rim);
      PQ(yr, gu - phw - t, gu - phw, pz0, pz1, rim); PQ(yr, gu + phw, gu + phw + t, pz0, pz1, rim);
      PQ(yp, gu - phw, gu + phw, pz0, pz1, [30, 22, 16]);
      // the double fillet: a gilt border and a fine gilt line inside it
      const ft = 0.0055, inn = 0.012, lt = 0.0024;
      PQ(yg, gu - phw, gu + phw, pz1 - ft, pz1, giltCol); PQ(yg, gu - phw, gu + phw, pz0, pz0 + ft, giltCol);
      PQ(yg, gu - phw, gu - phw + ft, pz0, pz1, giltCol); PQ(yg, gu + phw - ft, gu + phw, pz0, pz1, giltCol);
      PQ(yg, gu - phw + inn, gu + phw - inn, pz1 - inn, pz1 - inn + lt, giltCol); PQ(yg, gu - phw + inn, gu + phw - inn, pz0 + inn - lt, pz0 + inn, giltCol);
      PQ(yg, gu - phw + inn - lt, gu - phw + inn, pz0 + inn - lt, pz1 - inn + lt, giltCol); PQ(yg, gu + phw - inn, gu + phw - inn + lt, pz0 + inn - lt, pz1 - inn + lt, giltCol);
      // GRANDSTAND, where this gate lets you in, as its twin's says BLEACHERS: raised gilt, each
      // letter casting its shadow down and right onto the bronze. Surface text, never billboarded.
      if (facing(0, 1, gu, yp)) {
        const hw = phw - 0.024, za = pz0 + inn + 0.004, zb = pz1 - inn - 0.004;
        const quad = (ox, oz) => { const y = yg + (ox ? 0.001 : 0.002), sx = ox * 0.0016, sz = oz * 0.0016;
          return [B3(gu - hw + sx, y, zb + sz), B3(gu + hw + sx, y, zb + sz), B3(gu + hw + sx, y, za + sz), B3(gu - hw + sx, y, za + sz)].map((p) => cam.proj(p[0], p[1], p[2])); };
        embossText(ctx, cam, quad, 'GRANDSTAND', '#ecc97e', '#120c06', night, alpha, { font: 'deco', fit: (2 * hw) / ((zb - za) * ZK) });
      }
      // floodlit from below after dark, and backlit
      if (dn > 0.05) {
        pool(ctx, cam, ...P(gu, gf + 0.05), pz0 - 0.03, '255,214,150', 16, alpha * 0.4 * dn);
        pool(ctx, cam, ...P(gu, yp - 0.006), (pz0 + pz1) / 2, '255,200,120', 18, alpha * 0.3 * dn, { add: true });
        pool(ctx, cam, ...P(gu, gf + 0.06), 0.09, '255,206,150', 14, alpha * 0.4 * dn);   // the lobby through the doors
      }
      // The rising sun on the setback's face: a gilt baseball for its disc, red stitching, nine rays.
      {
        const ys = gf - 0.004 + 0.0015, zs = G.top + 0.012, rd = 0.019;
        const disc = [[gu, ys, zs]];
        for (let k = 0; k <= 12; k++) { const a = Math.PI * k / 12; disc.push([gu + Math.cos(a) * rd, ys, zs + Math.sin(a) * rd]); }
        face(disc, [0, 1, 0], giltCol);
        for (const sg of [-1, 1]) {   // the stitches: two arcs of red, curving in toward the top
          const pts = [];
          for (let k = 0; k <= 4; k++) { const a = Math.PI * (0.18 + 0.32 * k / 4); pts.push([gu + sg * Math.cos(a) * rd * 0.62 + sg * 0.004, ys + 0.0004, zs + Math.sin(a) * rd * 0.8]); }
          for (let k = 0; k < 4; k++) face([[pts[k][0] - 0.0012, ys + 0.0004, pts[k][2]], [pts[k + 1][0] - 0.0012, ys + 0.0004, pts[k + 1][2]], [pts[k + 1][0] + 0.0012, ys + 0.0004, pts[k + 1][2]], [pts[k][0] + 0.0012, ys + 0.0004, pts[k][2]]], [0, 1, 0], [170 * dusk, 40 * dusk, 34 * dusk]);
        }
        for (let k = 1; k < 10; k++) {
          const a = Math.PI * k / 10, c = Math.cos(a), s = Math.sin(a), w = 0.0022, r0 = rd + 0.006, r1 = rd + 0.03 + (k % 2) * 0.008;
          face([[gu + c * r0 - s * w, ys, zs + s * r0 + c * w], [gu + c * r0 + s * w, ys, zs + s * r0 - c * w], [gu + c * r1 + s * w, ys, zs + s * r1 - c * w], [gu + c * r1 - s * w, ys, zs + s * r1 + c * w]], [0, 1, 0], giltCol);
        }
      }
      // the flag, from the top of the frontispiece
      { const [fx, fy] = P(gu, gf - 0.04); windFlag(ctx, cam, fx, fy, 0.655, 0.80, 0.06, STEEL, alpha, night, now, seed + 7); }
    }

    // 9) THE BLEACHER GATE on Halcyon Boulevard: the main gate's smaller twin, two grille gates
    //    between pylons and BLEACHERS in gilt on bronze over them.
    if (inTile(BGATE.u, -OUT + 0.01)) {
      const G = BGATE, gu = G.u, gf = G.face, u0 = gu - G.hw, u1 = gu + G.hw, yd = gf - 0.0015;
      box(u0, u1, gf, -BACK, Z.plinth, G.top, STONE, false, 450);
      box(u0 - 0.005, u1 + 0.005, gf - 0.006, -BACK, 0, Z.plinth, GRANITE, true, 451);
      box(u0, u1, gf - 0.004, -BACK, G.top, G.top + 0.012, ledge, true, 452);
      box(gu - 0.16, gu + 0.16, gf + 0.004, -BACK, G.top + 0.012, 0.50, STONE, false, 453);
      box(gu - 0.16, gu + 0.16, gf + 0.001, -BACK, 0.50, 0.51, ledge, true, 454);
      for (const pu of [u0 + 0.025, u1 - 0.025]) {
        box(pu - 0.025, pu + 0.025, gf - 0.015, -BACK, 0, 0.47, STONE, false, 455);
        box(pu - 0.019, pu + 0.019, gf - 0.012, -BACK, 0.47, 0.484, ledge, true, 456);
        for (const o of [-0.012, 0.012]) face([[pu + o - 0.0018, gf - 0.0175, 0.44], [pu + o + 0.0018, gf - 0.0175, 0.44], [pu + o + 0.0018, gf - 0.0175, 0.06], [pu + o - 0.0018, gf - 0.0175, 0.06]], [0, -1, 0], [96 * dusk, 84 * dusk, 66 * dusk]);
      }
      for (const bu of [gu - 0.07, gu + 0.07]) {
        face([[bu + 0.045, yd, 0.19], [bu - 0.045, yd, 0.19], [bu - 0.045, yd, 0], [bu + 0.045, yd, 0]], [0, -1, 0], mixRgb([30, 26, 22], [140, 104, 64], dn * 0.6));
        box(bu - 0.054, bu + 0.054, gf - 0.008, gf + 0.01, 0.19, 0.205, TRIM, true, 460);
        for (const sg of [-1, 1]) box(bu + sg * 0.05 - 0.005, bu + sg * 0.05 + 0.005, gf - 0.008, gf + 0.01, 0, 0.19, TRIM, true, 462);
        if (NEAR) for (let k = -3; k <= 3; k++) emitWire(ctx, cam, B3(bu + k * 0.012, yd - 0.002, 0.005), B3(bu + k * 0.012, yd - 0.002, 0.185), 1.2, 'rgba(30,32,34,0.92)', alpha, { pull: 0.004 });
        const [lx, ly] = P(bu, gf - 0.0095);
        drum(ctx, cam, lx, ly, 0.215, 0.26, 0.008, 0.008, 8, alpha, () => rgb(dn > 0.05 ? [255, 214, 150] : BRONZE_RGB), rgb(BRONZE_RGB), BRONZE);
        if (dn > 0.05) pool(ctx, cam, lx, ly, 0.238, '255,206,140', 7, alpha * 0.6 * dn);
      }
      const pz0 = 0.26, pz1 = 0.345, phw = 0.15, yp = gf - 0.014, yg = yp - 0.0015;
      const PQ = (y, x0, x1, za, zb, col) => face([[x1, y, zb], [x0, y, zb], [x0, y, za], [x1, y, za]], [0, -1, 0], col);
      PQ(yp, gu - phw, gu + phw, pz0, pz1, [30, 22, 16]);
      const ft = 0.005;
      PQ(yg, gu - phw, gu + phw, pz1 - ft, pz1, giltCol); PQ(yg, gu - phw, gu + phw, pz0, pz0 + ft, giltCol);
      PQ(yg, gu - phw, gu - phw + ft, pz0, pz1, giltCol); PQ(yg, gu + phw - ft, gu + phw, pz0, pz1, giltCol);
      if (facing(0, -1, gu, yp)) {
        // ⚠ READ FROM THE BOULEVARD, so the left edge is the east one: the quad runs +u to −u.
        const hw = 0.125, za = pz0 + 0.016, zb = pz1 - 0.016;
        const quad = (ox, oz) => { const y = yg - (ox ? 0.001 : 0.002), sx = -ox * 0.0016, sz = oz * 0.0016;
          return [B3(gu + hw + sx, y, zb + sz), B3(gu - hw + sx, y, zb + sz), B3(gu - hw + sx, y, za + sz), B3(gu + hw + sx, y, za + sz)].map((p) => cam.proj(p[0], p[1], p[2])); };
        embossText(ctx, cam, quad, 'BLEACHERS', '#ecc97e', '#120c06', night, alpha, { font: 'deco', fit: (2 * hw) / ((zb - za) * ZK) });
      }
      if (dn > 0.05) pool(ctx, cam, ...P(gu, gf - 0.05), pz0 - 0.03, '255,214,150', 14, alpha * 0.4 * dn);
    }

    // 10) THE ROOF. Each shell is its panels across the vault, the glazing down its crown, three
    //     bronze ribs over it and its two ends; the outer end of the first and the last is a fan
    //     window, glass behind bronze rays and a bronze frame round the arch. `how` is how this frame
    //     lays a face down: as mesh (lit metal, unlit glass) or, for a shell on the move, as a decal.
    const glassK = dn * st.domeK * 0.85;
    const crownGlass = mixRgb(mixRgb(GLASS_DAY, GLASS_DARK, dn), GLOW, glassK);
    const fanGlass = mixRgb(mixRgb([66, 84, 96], GLASS_DARK, dn), GLOW, glassK);
    const asMesh = (pts, out, col, fam) => (fam ? litFace(pts, out, col, fam, { lift: 0 }) : face(pts, out, col, { lift: 0 }));
    const asDecal = (pts, out, col) => decFace(pts, out, col);
    // ⚠ THE SHELLS' SKIN IS MASS IN THE MESH, NOT TRIM. As flats it stood 0.84 over the field tile's
    // only mass (the bases), which is what `gl:mesh` takes for trim that has come off its building. So
    // the panels, the crown glazing and the ends go in as roof faces, lit as their family or holding
    // their glow, and the shape below carries the vault they need. The ribs and the fan's bronze stay
    // trim on the skin. Off a capture this is `asMesh`.
    const asMass = (pts, out, col, fam) => {
      if (!MESH_SINK) return asMesh(pts, out, col, fam);
      if (pts.length < 3) return;
      const W = wind(pts.map(([u, v, z]) => B3(u, v, z)), worldDir(out));
      let nx = 0, ny = 0, nz = 0;
      for (let i = 0; i < W.length; i++) { const a = W[i], b = W[(i + 1) % W.length]; nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]); }
      const nl = Math.hypot(nx, ny, nz) || 1, lum = (0.299 * col[0] + 0.587 * col[1] + 0.114 * col[2]) / 255;
      const c = cl255(fam && lum > 0.42 ? col.map((v) => v * (1 - 0.55 * dn)) : col);
      MESH_SINK.push({ kind: 'roof', seed: 0, rgbOverride: c, alpha: 1, ...(fam ? { flat: 2, matId: materialIdOf(fam) } : { flat: true }), p: W, n: [nx / nl, ny / nl, nz / nl] });
    };
    // ⚠ THE SHAPE IS THE SHUT ROOF, WHATEVER IT IS DOING. The shape is per model, not per state, and
    // collision, the occluders and the distance LOD read it, so it can only be one pose: shut, the
    // dome, as a stepped envelope of boxes under each facet. A pilot who drops into the open bowl meets
    // the roof line, which is rarer and less wrong than flying through a dome that looks solid.
    const shapeBox = (u0, u1, v0, v1, z0, z1) => {
      u0 = Math.max(u0, X0); u1 = Math.min(u1, X1); v0 = Math.max(v0, Y0); v1 = Math.min(v1, Y1);
      if (u1 - u0 < 1e-4 || v1 - v0 < 1e-4) return;
      const nu = Math.max(1, Math.ceil((u1 - u0) / 0.88 - 1e-9)), nv = Math.max(1, Math.ceil((v1 - v0) / 0.88 - 1e-9));
      const su = (u1 - u0) / nu, sv = (v1 - v0) / nv;
      for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
        const [cx, cy] = P(u0 + su * (i + 0.5), v0 + sv * (j + 0.5));
        SHAPE_SINK.push({ kind: 'box', dx: cx, dy: cy, hwRaw: su / 2, fdRaw: sv / 2, wz0: z0 * ZK, wz1: z1 * ZK, pal: FINC, roof: true, yaw: yaw0 });
      }
    };
    // Each box tops out where its facet does over the part of it this tile holds: a facet cut at a
    // tile line is lower at the cut than at its far end.
    if (SHAPE_SINK) for (const S of SHELLS) for (let k = 0; k < NF; k++) {
      const a = S.arch[k], b = S.arch[k + 1];
      const u0 = Math.max(Math.min(a[0], b[0]), X0), u1 = Math.min(Math.max(a[0], b[0]), X1);
      if (u1 <= u0) continue;
      const zAt = (u) => a[1] + (b[1] - a[1]) * (u - a[0]) / (b[0] - a[0]);
      shapeBox(u0, u1, S.shut, S.shut + S.len, S.zs, Math.max(zAt(u0), zAt(u1)));
    }
    const clipT = (pts) => clip3(pts, X0, X1, Y0, Y1), clipU = (pts) => clip3(pts, X0, X1, -9, 9);
    const shell = (S, i, v0, how) => {
      const v1 = v0 + S.len, A = S.arch, skin = how === asMesh ? asMass : how;
      for (let k = 0; k < NF; k++) {
        const a = A[k], b = A[k + 1], crown = Math.abs(a[0] + b[0]) / 2 < 0.24;
        skin(clipT([[a[0], v0, a[1]], [b[0], v0, b[1]], [b[0], v1, b[1]], [a[0], v1, a[1]]]), [(a[2] + b[2]) / 2, 0, (a[3] + b[3]) / 2], crown ? crownGlass : SHELL, crown ? null : 'metal');
      }
      for (const vr of [v0 + 0.025, (v0 + v1) / 2, v1 - 0.025]) {
        for (let k = 0; k < NF; k++) {
          const a = A[k], b = A[k + 1], l = 0.005;
          const pa = [a[0] + a[2] * l, a[1] + a[3] * l], pb = [b[0] + b[2] * l, b[1] + b[3] * l];
          how(clipT([[pa[0], vr - 0.009, pa[1]], [pb[0], vr - 0.009, pb[1]], [pb[0], vr + 0.009, pb[1]], [pa[0], vr + 0.009, pa[1]]]), [(a[2] + b[2]) / 2, 0, (a[3] + b[3]) / 2], RIB, 'brass');
        }
      }
      for (const [ve, sg] of [[v0, -1], [v1, 1]]) {
        if (!inRow(ve)) continue;
        const end = A.map((a) => [a[0], ve, a[1]]);
        const fan = (i === 0 && sg < 0) || (i === SHELLS.length - 1 && sg > 0);
        if (!fan) { skin(clipU(end), [0, sg, 0], SHELL, 'metal'); continue; }
        skin(clipU(end), [0, sg, 0], fanGlass, null);
        const vo = ve + sg * 0.003, hub = [0, S.zs], hr = 0.07;
        for (let j = 2; j < NF; j += 2) {   // the rays, from the hub to every other point of the arch
          const a = A[j], du = a[0] - hub[0], dz = a[1] - hub[1], dl = Math.hypot(du, dz) || 1, pu = -dz / dl * 0.0055, pz = du / dl * 0.0055;
          const s0 = [hub[0] + du / dl * hr, hub[1] + dz / dl * hr];
          how(clipU([[s0[0] + pu, vo, s0[1] + pz], [a[0] + pu, vo, a[1] + pz], [a[0] - pu, vo, a[1] - pz], [s0[0] - pu, vo, s0[1] - pz]]), [0, sg, 0], BRONZE_RGB, 'brass');
        }
        for (let k = 0; k < NF; k++) {   // the frame round the arch
          const a = A[k], b = A[k + 1], ins = (p) => [hub[0] + (p[0] - hub[0]) * 0.955, hub[1] + (p[1] - hub[1]) * 0.955];
          const ia = ins(a), ib = ins(b);
          how(clipU([[a[0], vo, a[1]], [b[0], vo, b[1]], [ib[0], vo, ib[1]], [ia[0], vo, ia[1]]]), [0, sg, 0], BRONZE_RGB, 'brass');
        }
        const hubPts = [];   // the hub, a bronze half-disc on the sill
        for (let k = 0; k <= 8; k++) { const a = Math.PI * k / 8; hubPts.push([hub[0] + Math.cos(a) * hr, vo, hub[1] + Math.sin(a) * hr]); }
        how(clipU(hubPts), [0, sg, 0], BRONZE_RGB, 'brass');
      }
    };
    // Which shells this frame lays down, and how. See the ⚠ on the roof at the top of the file.
    const glLive = FLAT_OFF && !MESH_SINK;            // GLASS 2's adornment pass: the mesh has the resting roof
    if (st.moving && !MESH_SINK && !SHAPE_SINK) dutyPhase(now, 0, 1000, 1);   // a moving roof keeps this arm live (armRecord)
    if (!SHAPE_SINK) SHELLS.forEach((S, i) => {
      const fixed = S.open === S.shut;
      if (MESH_SINK) {
        const at = fixed ? 1 : st.meshRoof;
        if (at != null) shell(S, i, S.open + (S.shut - S.open) * at, asMesh);
      } else if (glLive) {
        if (!fixed && st.moving) shell(S, i, S.open + (S.shut - S.open) * st.p, asDecal);
      } else shell(S, i, S.open + (S.shut - S.open) * st.p, asMesh);
    });

    // 11) THE LIGHT THAT GETS OUT. With the roof shut after dark, the field's floods show through the
    //     clerestory all round and the glazing down the crown; with it open, through the gap.
    if (dn > 0.05 && st.domeK > 0.01) {
      for (const [u, v] of [[0, 1.5], [0, -1.5], [1.5, 0], [-1.5, 0], [-0.9, 1.5], [0.9, -1.5], [1.5, -0.9], [-1.5, 0.9]]) {
        if (!inTile(clamp(u, -1.49, 1.49), clamp(v, -1.49, 1.49))) continue;
        pool(ctx, cam, ...P(u, v), (Z.frieze + Z.cler) / 2, '255,232,194', 22, alpha * 0.35 * dn * st.domeK, { air: true });
      }
      if (inTile(0, 0)) pool(ctx, cam, ...P(0, 0), 0.86, '255,236,206', 60, alpha * 0.16 * dn * st.domeK, { air: true, max: 150 });
    }
    if (st.towerK > 0.01 && dn > 0.05) for (const su of [1, -1]) for (let j = 0; j < 7; j++) {
      const v = -1.26 + j * 0.42, u = su * (DECK - 0.01);
      if (!inTile(u, v)) continue;
      pool(ctx, cam, ...P(u, v), 0.415, '255,246,224', 8, alpha * 0.5 * st.towerK);
    }
    if (dn > 0.05) for (const [u, v] of [[0, 1.55], [-0.9, 1.55], [1.55, 0], [1.55, -0.9], [-1.55, 0.3], [0.3, -1.55]]) {
      if (!inTile(clamp(u, -1.49, 1.49), clamp(v, -1.49, 1.49))) continue;
      pool(ctx, cam, ...P(u, v), 0.08, '255,210,150', 16, alpha * 0.3 * dn);   // the concourse windows on the pavement
    }
  },
};
