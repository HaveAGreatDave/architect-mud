// The Charles B. Hughson Coliseum: Deadball's ballpark, nine tiles, one model.
//
// Every arm takes drawTypeModelArm's arguments and its prologue locals, in this order:
//   (ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis)
// How a tile becomes a building is in docs/reference/world-rendering.md, and the park's content in
// scripts/content/hughson-coliseum.mjs and docs/proposals/hughson-coliseum.md.
//
// ⚠ ONE ARM, NINE SLICES. The park stands on x 895-897, y 911-913 in Halcyon Fields, and every tile
// is its own building type (`ballpark`, `ballpark_s`, ... `ballpark_bleachers`) whose registry row
// says which column (`bc`) and row (`br`) of the block it is and which way it was authored facing
// (`facing`). The whole park is drawn in BLOCK coordinates: u east and v south of the block's centre,
// in tiles, so tile (bc, br) has its centre at (bc - 1, br - 1). Each tile draws only what falls in
// its own square: flats are clipped to it, boxes are cut at its edges, and an arc is split where it
// crosses a tile line, so the nine slices meet without a seam.
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
// ⚠ GAME NIGHTS. The six light towers are on while Deadball is on air (`vl` on the cell, from the
// broadcast plugin's `venue.lit`, and `venueLive` for a view that was open when it changed). Off,
// the park is dark brick and a field after sunset; on, the lamps glow and the field reads as the
// brightest thing in the estate, which is what it should be from the air.
import {
  FACE_EPS, DETAIL_LIFT, _place, bakeSignText, clamp, draw3DBoxAt, drawFacetDrum, emitSurfaceText,
  emitWire, faceYaw, glowPool, nearOrMesh, rgb, windFlag,
} from '../../windshield.js';
import { flatOut } from './downtown.js';
import { venueLive } from '../../world-feed.js';

// ── THE PARK, IN BLOCK COORDINATES ───────────────────────────────────────────────────────────
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
const BACK = 1.42;                 // its back wall
const ROOF = [0.265, 0.29];        // the upper deck's roof slab
const LOW = -0.6;                  // past this the stands step down toward the corners
const BLEACH = -1.28;              // the bleachers' front, along the north and west edges
const ROTUNDA = { u: 1.22, v: 1.3, r: 0.19, z: 0.33 };
const TOWERS = [[1.40, 0.15], [0.15, 1.40], [1.40, -1.30], [-1.30, 1.40], [-1.40, -0.45], [-0.45, -1.40]];
const TOWER_Z = 0.8;
const SCOREBOARD = { u: -1.06, v: -1.06, w: 0.32, z0: 0.11, z1: 0.24 };

const BRICK = 'ty_unit_brick', BRICK_DK = 'ty_oc_brick_dk', STEEL = 'ty_fab_steel', STONE = 'ty_precast', STONE_DK = 'ty_precast_dk';
const GRASS_DAY = [62, 112, 58], GRASS_LIT = [112, 186, 92], GRASS_DARK = [24, 40, 26];
const DIRT_DAY = [150, 104, 70], DIRT_LIT = [206, 150, 104], DIRT_DARK = [52, 38, 30];
const TRACK_DAY = [122, 92, 68], SEAT = [44, 92, 62], LINE = [236, 236, 228];
const LAMP_OFF = [70, 74, 78], LAMP_ON = [255, 246, 224];
const WARM_DAY = [58, 54, 50], WARM_NIGHT = [255, 210, 150];
const mixRgb = (a, b, k) => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * k);
const arcPts = (c, r, a0, a1, n) => Array.from({ length: n + 1 }, (_, i) => { const t = a0 + (a1 - a0) * i / n; return [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]; });
const FAIR = [Math.PI, 1.5 * Math.PI];   // west round to north, through the outfield

// Sutherland-Hodgman against an axis-aligned square.
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

// Is the light on at this tile? The live push wins over the window's cell.
function litHere() {
  const live = _place ? venueLive(_place.wx, _place.wy) : undefined;
  if (live !== undefined) return live ? 1 : 0;
  return _place && _place.vl ? 1 : 0;
}

export const COLISEUM_ARMS = {
  ballpark(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE HUGHSON COLISEUM, every tile
    const D = m.facing === 'north' ? [0, -1] : [0, 1];
    const cu = (m.bc ?? 1) - 1, cv = (m.br ?? 1) - 1;
    const X0 = cu - 0.5, X1 = cu + 0.5, Y0 = cv - 0.5, Y1 = cv + 0.5;
    const inTile = (u, v) => u >= X0 && u < X1 && v >= Y0 && v < Y1;
    // block → the model's local frame (see the ⚠ on the frame above)
    const L = (u, v) => { const du = u - cu, dv = v - cv; return [du * D[1] - dv * D[0], du * D[0] + dv * D[1]]; };
    const Ld = (du, dv) => [du * D[1] - dv * D[0], du * D[0] + dv * D[1]];
    const P = (u, v) => F(...L(u, v));
    const B3 = (u, v, z) => { const [a, b] = L(u, v); const [wx, wy] = F(a, b); return [wx, wy, z]; };   // a block point, in the world
    const yaw0 = faceYaw(E), NEAR = nearOrMesh();
    const dn = night ? clamp(night, 0, 1) : 0, lit = litHere(), glow = lit * dn;
    const dusk = 1 - 0.6 * dn;

    // A box over block u0..u1, v0..v1, cut to this tile and into pieces the 0.44 cap allows.
    const box = (u0, u1, v0, v1, z0, z1, pal, roof, s = 0) => {
      u0 = Math.max(u0, X0); u1 = Math.min(u1, X1); v0 = Math.max(v0, Y0); v1 = Math.min(v1, Y1);
      if (u1 - u0 < 1e-4 || v1 - v0 < 1e-4) return;
      const nu = Math.max(1, Math.ceil((u1 - u0) / 0.88 - 1e-9)), nv = Math.max(1, Math.ceil((v1 - v0) / 0.88 - 1e-9));
      const su = (u1 - u0) / nu, sv = (v1 - v0) / nv;
      for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
        const [cx, cy] = P(u0 + su * (i + 0.5), v0 + sv * (j + 0.5));
        draw3DBoxAt(ctx, cam, cx, cy, su / 2, z0, z1, pal, seed + s + i * 7 + j * 13, night, alpha, roof, yaw0, sv / 2);
      }
    };
    // A box along a segment, drawn by the tile its middle is on.
    const seg = (a, b, thick, z0, z1, pal, roof, s = 0) => {
      const mu = (a[0] + b[0]) / 2, mv = (a[1] + b[1]) / 2;
      if (!inTile(mu, mv)) return;
      const [lx, ly] = Ld(b[0] - a[0], b[1] - a[1]), len = Math.hypot(lx, ly);
      if (len < 1e-4) return;
      const [cx, cy] = P(mu, mv);
      draw3DBoxAt(ctx, cam, cx, cy, len / 2, z0, z1, pal, seed + s, night, alpha, roof, yaw0 + Math.atan2(ly, lx), thick / 2);
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
    const arc = (r, a0, a1, thick, z0, z1, pal, roof, s = 0) => {
      const n = Math.max(1, Math.ceil((a1 - a0) * r / 0.08));
      for (let k = 0; k < n; k++) {
        const p0 = a0 + (a1 - a0) * k / n, p1 = a0 + (a1 - a0) * (k + 1) / n;
        segCut([HP[0] + r * Math.cos(p0), HP[1] + r * Math.sin(p0)], [HP[0] + r * Math.cos(p1), HP[1] + r * Math.sin(p1)], thick, z0, z1, pal, roof, s + k);
      }
    };
    // A flat on the ground (or any level), clipped to this tile.
    const flat = (poly, z, col, opts) => {
      const c = clipPoly(poly, X0, X1, Y0, Y1);
      if (c.length < 3) return;
      flatOut(ctx, cam, (a, b, zz) => { const [wx, wy] = F(a, b); return [wx, wy, zz]; }, c.map(([u, v]) => [...L(u, v), z]), [0, 0, 1], rgb(col), alpha, opts);
    };
    // A flat laid on the top of a box: a hair above it, and a lift so the painter puts it after the
    // box's own roof, whose centre is its centre.
    const ON_TOP = { lift: 0.03 };
    // A flat on a wall facing (nu, nv), given in block coordinates.
    const wallFlat = (pts, nu, nv, col) => {
      if (!pts.some(([u, v]) => inTile(u, v))) return;
      flatOut(ctx, cam, (a, b, zz) => { const [wx, wy] = F(a, b); return [wx, wy, zz]; }, pts.map(([u, v, z]) => [...L(u, v), z]), [...Ld(nu, nv), 0], rgb(col), alpha);
    };
    const facing = (nu, nv, pu, pv) => {
      const [ax, ay] = P(pu, pv), [bx, by] = P(pu + nu, pv + nv);
      return (bx - ax) * ((cam.ex || 0) - ax) + (by - ay) * ((cam.ey || 0) - ay) > 0;
    };

    // 1) THE GROUND: the infield's dirt, the grass, the warning track to the wall, and the foul ground
    //    out to the stands. Lit, the field is the brightest ground in the estate.
    // ⚠ ONE LAYER, AND NOTHING IN IT OVERLAPS. The 2-D painter orders flats by their mean depth, so a
    // flat laid over another one is drawn under it whenever its centre is the further of the two: a
    // concrete apron under the whole park came out as a dark tile across the outfield. So the field
    // is cut into pieces that meet edge to edge, each at the same height, and what sits on it (the
    // bags, home plate, the mound and the foul lines) is low mass, which both renderers sort by depth.
    // ⚠ AND EVERY FLAT IS CONVEX. The painter fans a polygon out from its first point, and a clipped
    // L or fan isn't star-shaped from wherever the clip leaves that point, so the field is laid as
    // wedges and rings from home plate, and rectangles, each clipped to the tile.
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
    // fair territory, the quarter from home plate between the lines
    fan(HP, DIRT_R, FAIR[0], FAIR[1], GZ, dirt, 12);
    ring(DIRT_R, RG, 24, grass);
    ring(RG, WALL_R, 24, track);
    // foul ground up the first-base line (east of it) and down the third (south of it): grass, with
    // the track along the stands and past the poles
    rect(HP[0], EDGE, HP[1] - RG, HP[1], GZ, grass);
    rect(HP[0], EDGE, HP[1] - WALL_R, HP[1] - RG, GZ, track);
    rect(EDGE, STAND, HP[1] - WALL_R, HP[1], GZ, track);
    rect(HP[0] - RG, HP[0], HP[1], EDGE, GZ, grass);
    rect(HP[0] - WALL_R, HP[0] - RG, HP[1], EDGE, GZ, track);
    rect(HP[0] - WALL_R, HP[0], EDGE, STAND, GZ, track);
    // and the dirt behind home plate, out to the backstop
    rect(HP[0], STAND, HP[1], STAND, GZ, dirt);
    // The bags and the plate are real, if low: the field tile's only mass is second base, and a tile
    // that captures no mass at all is a building with no building to shapes:smoke.
    for (const b of [[HP[0], HP[1] - BASE], [HP[0] - BASE, HP[1] - BASE], [HP[0] - BASE, HP[1]], HP]) box(b[0] - 0.016, b[0] + 0.016, b[1] - 0.016, b[1] + 0.016, 0, 0.012, STONE, true, 5);
    if (inTile(...MOUND)) {
      const [mx, my] = P(...MOUND), mud = rgb(dirt);
      drawFacetDrum(ctx, cam, mx, my, 0, 0.012, 0.055, 0.035, 10, alpha, () => mud, mud, STONE_DK);
    }
    // the foul lines, home to each pole, chalk a hair above the ground
    box(HP[0] - WALL_R, HP[0], HP[1] - 0.004, HP[1] + 0.004, 0, 0.006, STONE, true, 6);
    box(HP[0] - 0.004, HP[0] + 0.004, HP[1] - WALL_R, HP[1], 0, 0.006, STONE, true, 7);

    // 2) THE OUTFIELD WALL, padded green on the field side, and the two foul poles.
    arc(WALL_R + 0.012, FAIR[0], FAIR[1], 0.024, 0, 0.055, STONE_DK, true, 100);
    for (const p of [[HP[0] - WALL_R - 0.01, HP[1]], [HP[0], HP[1] - WALL_R - 0.01]]) {
      if (!inTile(...p)) continue;
      const [px, py] = P(...p);
      drawFacetDrum(ctx, cam, px, py, 0, 0.3, 0.006, 0.006, 6, alpha, () => rgb([214 * dusk, 186 * dusk, 40 * dusk]), 'rgb(120,104,24)', STEEL);
    }

    // 3) THE GRANDSTAND: an L along Sorrel Way and Kettle Lane, raked in three tiers to a brick back
    //    wall, with the upper deck's roof over the back half. It steps down toward both corners.
    const tiers = [[STAND, 1.20, 0.055], [1.20, 1.31, 0.11], [1.31, BACK, 0.17]];
    // The south stand runs along u and the east along v, each to the corner behind home, which is
    // the rotunda's: a brick block under it, so the two rakes don't run through each other.
    const runs = [['s', -1.5, STAND], ['e', -1.5, STAND]];
    box(STAND, 1.5, STAND, 1.5, 0, 0.17, BRICK, true, 34);
    for (const [side, a0, a1] of runs) {
      for (const [lo, hi, low] of [[a0, LOW, true], [LOW, a1, false]]) {
        const k = low ? 0.62 : 1;
        tiers.forEach(([t0, t1, z], i) => {
          if (side === 's') box(lo, hi, t0, t1, 0, z * k, STONE, true, 10 + i);
          else box(t0, t1, lo, hi, 0, z * k, STONE, true, 20 + i);
          // the seats along the tier's top, green rows
          const zt = z * k + 0.004;
          if (side === 's') flat([[lo, t0 + 0.01], [hi, t0 + 0.01], [hi, t1 - 0.012], [lo, t1 - 0.012]], zt, SEAT.map((c) => c * dusk), ON_TOP);
          else flat([[t0 + 0.01, lo], [t1 - 0.012, lo], [t1 - 0.012, hi], [t0 + 0.01, hi]], zt, SEAT.map((c) => c * dusk), ON_TOP);
        });
        const wallZ = low ? 0.2 : 0.3;
        if (side === 's') box(lo, hi, BACK, 1.5, 0, wallZ, BRICK, true, 30);
        else box(BACK, 1.5, lo, hi, 0, wallZ, BRICK, true, 31);
        if (!low) {
          // the roof over the upper deck, on steel
          if (side === 's') box(lo, hi, 1.24, 1.5, ROOF[0], ROOF[1], STEEL, true, 32);
          else box(1.24, 1.5, lo, hi, ROOF[0], ROOF[1], STEEL, true, 33);
        }
      }
    }
    // Section nine: a crater in the third-base seats, rope round it.
    fan([0.05, 1.27], 0.06, 0, 2 * Math.PI, 0.114, [26, 24, 22], 10, ON_TOP);

    // 4) THE OUTSIDE OF THE GRANDSTAND: an arcade of arched openings along both street faces, lit
    //    from the concourse after dark.
    const warm = mixRgb(WARM_DAY, WARM_NIGHT, Math.max(dn * 0.7, glow));
    for (let u = -1.35; u < 0.95; u += 0.22) {
      if (!inTile(u, 1.49)) continue;
      const z1 = u < LOW ? 0.1 : 0.15;
      wallFlat([[u - 0.06, 1.502, z1], [u + 0.06, 1.502, z1], [u + 0.06, 1.502, 0.02], [u - 0.06, 1.502, 0.02]], 0, 1, warm);
    }
    for (let v = -1.35; v < 0.95; v += 0.22) {
      if (!inTile(1.49, v)) continue;
      const z1 = v < LOW ? 0.1 : 0.15;
      wallFlat([[1.502, v + 0.06, z1], [1.502, v - 0.06, z1], [1.502, v - 0.06, 0.02], [1.502, v + 0.06, 0.02]], 1, 0, warm);
    }
    if (dn > 0.05) for (const [u, v] of [[0, 1.55], [-0.9, 1.55], [1.55, 0], [1.55, -0.9]]) {
      if (!inTile(Math.min(u, 1.49), Math.min(v, 1.49))) continue;
      const [gx, gy] = P(u, v); glowPool(ctx, cam, gx, gy, 0.08, '255,210,150', 16, alpha * 0.3 * dn);
    }
    // Flags along the top of the back wall.
    for (const [u, v] of [[-0.3, 1.47], [0.6, 1.47], [1.47, -0.3], [1.47, 0.6]]) {
      if (!inTile(u, v)) continue;
      const [fx, fy] = P(u, v); windFlag(ctx, cam, fx, fy, 0.3, 0.44, 0.07, STEEL, alpha, night, now, seed + Math.round(u * 10 + v * 100));
    }

    // 5) THE ROTUNDA AT THE MAIN GATE: a brick drum on the corner of Sorrel Way, the name in bronze
    //    letters on a band across its front, three iron gates under it. The only place the park says
    //    what it is called.
    if (inTile(ROTUNDA.u, ROTUNDA.v)) {
      const [rx, ry] = P(ROTUNDA.u, ROTUNDA.v);
      const brick = (f) => { const s = (0.5 + f.nl * 0.45) * dusk; return `rgb(${(150 * s) | 0},${(80 * s) | 0},${(60 * s) | 0})`; };
      drawFacetDrum(ctx, cam, rx, ry, 0, ROTUNDA.z, ROTUNDA.r, ROTUNDA.r, 18, alpha, brick, 'rgb(92,50,40)', BRICK);
      drawFacetDrum(ctx, cam, rx, ry, ROTUNDA.z, ROTUNDA.z + 0.03, ROTUNDA.r + 0.012, ROTUNDA.r + 0.012, 18, alpha, () => rgb([168 * dusk, 162 * dusk, 150 * dusk]), 'rgb(120,116,108)', STONE);
      drawFacetDrum(ctx, cam, rx, ry, ROTUNDA.z + 0.03, ROTUNDA.z + 0.09, ROTUNDA.r * 0.8, 0.02, 12, alpha, () => rgb([82 * dusk, 112 * dusk, 98 * dusk]), 'rgb(60,82,72)', STEEL);
      // the name band, flat across the front of the drum
      const fv = ROTUNDA.v + ROTUNDA.r + 0.004;
      box(ROTUNDA.u - 0.17, ROTUNDA.u + 0.17, fv - 0.012, fv, 0.2, 0.27, STONE_DK, true, 40);
      if (facing(0, 1, ROTUNDA.u, fv)) {
        const tex = bakeSignText((name || 'Charles B. Hughson Coliseum').toUpperCase(), '#c9a25a', dn, false, dn < 0.05, true, { font: 'block' });
        if (tex) {
          const q = [[ROTUNDA.u - 0.16, fv + FACE_EPS, 0.262], [ROTUNDA.u + 0.16, fv + FACE_EPS, 0.262], [ROTUNDA.u + 0.16, fv + FACE_EPS, 0.208], [ROTUNDA.u - 0.16, fv + FACE_EPS, 0.208]]
            .map(([u, v, z]) => { const [wx, wy] = P(u, v); return cam.proj(wx, wy, z); });
          if (q.every((p) => p.f > 0.12)) emitSurfaceText(ctx, cam, q, tex, false, alpha, DETAIL_LIFT * 2, false, DETAIL_LIFT * 2.5);
        }
        // the three gates, dark iron in lit arches
        for (const du of [-0.1, 0, 0.1]) {
          wallFlat([[ROTUNDA.u + du - 0.035, fv + 0.002, 0.16], [ROTUNDA.u + du + 0.035, fv + 0.002, 0.16], [ROTUNDA.u + du + 0.035, fv + 0.002, 0.01], [ROTUNDA.u + du - 0.035, fv + 0.002, 0.01]], 0, 1, warm);
          if (NEAR) for (let k = -2; k <= 2; k++) emitWire(ctx, cam, B3(ROTUNDA.u + du + k * 0.014, fv + 0.004, 0.01), B3(ROTUNDA.u + du + k * 0.014, fv + 0.004, 0.155), 1.3, 'rgba(30,32,34,0.9)', alpha, { pull: FACE_EPS });
        }
      }
      if (dn > 0.05) glowPool(ctx, cam, ...P(ROTUNDA.u, ROTUNDA.v + ROTUNDA.r + 0.05), 0.12, '255,210,150', 20, alpha * 0.45 * dn);
    }

    // 6) THE BLEACHERS along the outfield edges, two tiers of planks behind the wall, and the low
    //    brick outer wall behind them. The bleacher gate is in the north wall of the corner tile.
    box(-1.5, 0.9, BLEACH, BLEACH + 0.1, 0, 0.06, STONE, true, 50);
    box(-1.5, 0.9, -1.47, BLEACH, 0, 0.11, STONE, true, 51);
    box(BLEACH, BLEACH + 0.1, -1.47, 0.9, 0, 0.06, STONE, true, 52);
    box(-1.47, BLEACH, -1.47, 0.9, 0, 0.11, STONE, true, 53);
    box(-1.5, 0.9, -1.5, -1.47, 0, 0.14, BRICK, true, 54);
    box(-1.5, -1.47, -1.5, 0.9, 0, 0.14, BRICK, true, 55);
    const plank = [124 * dusk, 112 * dusk, 92 * dusk];
    flat([[-1.5, BLEACH + 0.005], [0.9, BLEACH + 0.005], [0.9, BLEACH + 0.095], [-1.5, BLEACH + 0.095]], 0.064, plank, ON_TOP);
    flat([[BLEACH + 0.005, -1.28], [BLEACH + 0.095, -1.28], [BLEACH + 0.095, 0.9], [BLEACH + 0.005, 0.9]], 0.064, plank, ON_TOP);
    flat([[-1.47, -1.47], [0.9, -1.47], [0.9, BLEACH - 0.005], [-1.47, BLEACH - 0.005]], 0.114, plank, ON_TOP);
    flat([[-1.47, -1.47], [BLEACH - 0.005, -1.47], [BLEACH - 0.005, 0.9], [-1.47, 0.9]], 0.114, plank, ON_TOP);
    // The bleacher gate: two iron gates in the north wall, BLEACHERS painted over them.
    if (inTile(-1.0, -1.49)) {
      const gv = -1.5 - 0.002;
      for (const du of [-0.06, 0.06]) wallFlat([[-1.0 + du + 0.045, gv, 0.11], [-1.0 + du - 0.045, gv, 0.11], [-1.0 + du - 0.045, gv, 0.005], [-1.0 + du + 0.045, gv, 0.005]], 0, -1, mixRgb([40, 42, 44], WARM_NIGHT, dn * 0.5));
      if (facing(0, -1, -1.0, -1.5)) {
        const tex = bakeSignText('BLEACHERS', '#e9e2cf', 0, false, true, true, { font: 'block' });
        if (tex) {
          const q = [[-0.86, gv - FACE_EPS, 0.135], [-1.14, gv - FACE_EPS, 0.135], [-1.14, gv - FACE_EPS, 0.115], [-0.86, gv - FACE_EPS, 0.115]]
            .map(([u, v, z]) => { const [wx, wy] = P(u, v); return cam.proj(wx, wy, z); });
          if (q.every((p) => p.f > 0.12)) emitSurfaceText(ctx, cam, q, tex, false, alpha, DETAIL_LIFT * 2, false, DETAIL_LIFT * 2.5);
        }
        if (NEAR) for (const du of [-0.06, 0.06]) for (let k = -2; k <= 2; k++) emitWire(ctx, cam, B3(-1.0 + du + k * 0.016, gv - 0.002, 0.005), B3(-1.0 + du + k * 0.016, gv - 0.002, 0.108), 1.3, 'rgba(30,32,34,0.9)', alpha, { pull: FACE_EPS });
      }
    }

    // 7) THE SCOREBOARD past centre field, on two legs, square to home plate.
    {
      const s = SCOREBOARD, a = Math.atan2(HP[1] - s.v, HP[0] - s.u) + Math.PI / 2;   // its face square to home
      const ea = [s.u - Math.cos(a) * s.w / 2, s.v - Math.sin(a) * s.w / 2], eb = [s.u + Math.cos(a) * s.w / 2, s.v + Math.sin(a) * s.w / 2];
      seg(ea, eb, 0.03, s.z0, s.z1, STONE_DK, true, 60);
      if (inTile(s.u, s.v)) {
        for (const t of [-0.32, 0.32]) {
          const [lx, ly] = P(s.u + Math.cos(a) * s.w * t, s.v + Math.sin(a) * s.w * t);
          drawFacetDrum(ctx, cam, lx, ly, 0, s.z0, 0.01, 0.01, 6, alpha, () => rgb([70 * dusk, 74 * dusk, 78 * dusk]), 'rgb(40,42,44)', STEEL);
        }
        // its face toward the field: the line score's lamps, lit on a game night
        const nu = Math.cos(a - Math.PI / 2), nv = Math.sin(a - Math.PI / 2), off = 0.017;
        const pts = [[ea[0] + nu * off, ea[1] + nv * off, s.z1 - 0.012], [eb[0] + nu * off, eb[1] + nv * off, s.z1 - 0.012], [eb[0] + nu * off, eb[1] + nv * off, s.z0 + 0.012], [ea[0] + nu * off, ea[1] + nv * off, s.z0 + 0.012]];
        wallFlat(pts, nu, nv, lit ? mixRgb([30, 34, 30], [250, 214, 120], 0.35 + 0.4 * dn) : [24, 26, 26]);
        if (lit && dn > 0.05) glowPool(ctx, cam, ...P(s.u + nu * 0.06, s.v + nv * 0.06), (s.z0 + s.z1) / 2, '250,214,120', 14, alpha * 0.35 * dn);
      }
    }

    // 8) THE SIX LIGHT TOWERS, a steel mast each and a bank of lamps turned to the field. On a game
    //    night the lamps burn and throw their light on the grass.
    TOWERS.forEach(([u, v], i) => {
      if (!inTile(u, v)) return;
      const [tx, ty] = P(u, v);
      drawFacetDrum(ctx, cam, tx, ty, 0, TOWER_Z, 0.016, 0.01, 6, alpha, () => rgb([96 * dusk, 100 * dusk, 106 * dusk]), 'rgb(50,52,56)', STEEL);
      const toward = Math.atan2(MOUND[1] - v, MOUND[0] - u), side = toward + Math.PI / 2;
      const ea = [u + Math.cos(side) * 0.05, v + Math.sin(side) * 0.05], eb = [u - Math.cos(side) * 0.05, v - Math.sin(side) * 0.05];
      seg(ea, eb, 0.02, TOWER_Z, TOWER_Z + 0.07, STEEL, true, 70 + i);
      const nu = Math.cos(toward), nv = Math.sin(toward), off = 0.012;
      wallFlat([[ea[0] + nu * off, ea[1] + nv * off, TOWER_Z + 0.062], [eb[0] + nu * off, eb[1] + nv * off, TOWER_Z + 0.062], [eb[0] + nu * off, eb[1] + nv * off, TOWER_Z + 0.008], [ea[0] + nu * off, ea[1] + nv * off, TOWER_Z + 0.008]],
        nu, nv, lit ? LAMP_ON : LAMP_OFF);
      if (lit) {
        glowPool(ctx, cam, ...P(u + nu * 0.03, v + nv * 0.03), TOWER_Z + 0.035, '255,246,224', 26, alpha * (0.35 + 0.5 * dn), { max: 90 });
        // the pool the tower throws on the field
        if (dn > 0.05) glowPool(ctx, cam, ...P(u + nu * 0.9, v + nv * 0.9), 0.02, '236,248,224', 70, alpha * 0.22 * dn, { max: 140 });
      }
      if (NEAR && lit && dn > 0.3) {   // the aircraft beacon on top
        const [bx, by] = P(u, v); glowPool(ctx, cam, bx, by, TOWER_Z + 0.09, '255,60,40', 6, alpha * 0.6);
      }
    });
  },
};
