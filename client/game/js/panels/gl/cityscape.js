// GLASS 2 · A CITY DRAWN FAR.
//
// The city round a broadcast's park, built from a composed set (client/shared/city-set.js):
// every building GLASS draws, at the flight sim's own size, from its baked shape
// (client/shared/building-shapes.js); the filler the set puts on empty plots; the streets from
// each road tile's arms; cobra-head sodium lamps with a pool of light under each; the Curtain's
// walls; and past them red rock, or the bay past a shore. One static set of batches when the
// venue arrives, drawn by gl/ballpark.js with its own light.
//
// Facades and streets are shaded from coordinates, not textures (FACADE_GLSL, STREET_GLSL): a
// facade's uv is bays across and storeys up, its colour (seed, style, share of windows lit); a
// street's uv runs 0..1 across its tile, its colour (arms, kind, seed).
//
// ⚠ NOTHING HERE TOUCHES WEBGL OR THE DOM: it fills ballpark-mesh.js's batches, so a gate builds
// the whole city in node. It names no region: what a building looks like comes from its shape and
// the venue's art direction (`styleOf`), and where it stands from the set.

import { createBatch, vtx, quad, MAT } from './ballpark-mesh.js';
import { shapeFor, shapeVal } from '../../../../shared/building-shapes.js';
import { floorsFor, buildingScale, tileSeed, CURTAIN_H } from '../../../../shared/skyline-scale.js';
import { styleOf, insidePoly, SET_STYLES } from '../../../../shared/city-set.js';

// The share of a style's windows lit at night, and its bay width in feet.
export const STYLE_LIT = Object.freeze({ glass: 0.26, concrete: 0.3, brick: 0.46, ribbon: 0.22, works: 0.08, farm: 0.92, stone: 0.5, ruin: 0, chrome: 0.3 });
const BAY = { brick: 9, works: 16, chrome: 14 };
// Sodium, as an emissive lamp's colour in the park's linear light, and the lamps' reach. A
// lamp's head is 26 ft up and lights a pool 38 ft round (gl/ballpark.js takes the ratio).
const SODIUM = [30, 13, 3.5], RED = [60, 3, 1.5], LAMP_H = 26, POOL_R = 38;
const LAMP_REACH = 3200, ROCK = [0.036, 0.019, 0.013], BAY_WATER = [0.006, 0.008, 0.011], ROOF = [0.05, 0.05, 0.052];
// A building's entrance as a tile direction (east, south).
const ENT = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function hashStr(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const unit = (s) => hashStr(s) / 4294967296;

// A building's shape, resolved the way the flight sim sizes it: its segments as tile offsets
// (east, south) from the tile's middle, heights in tiles, and the height of one storey. Null for
// a building with no shape.
export function cityShape(b) {
  const list = shapeFor(b.n || '', b.t);
  if (!list) return null;
  const floors = floorsFor(b.t, b.f);
  const { fh, h } = buildingScale(floors, tileSeed(b.x, b.y));
  const E = ENT[b.e] || ENT.south, px = E[1], py = -E[0];
  // model-local (x right of the door, y toward it) to a tile offset
  const T = (lx, ly) => [lx * px + ly * E[0], lx * py + ly * E[1]];
  const V = (p) => shapeVal(p, fh, h);
  const segs = [];
  for (const s of list) {
    const cx = V(s.cx), cy = V(s.cy), hx = V(s.hx), hy = V(s.hy), z0 = V(s.z0), z1 = V(s.z1);
    if (s.kind === 'mast') { segs.push({ k: 'mast', p: T(cx, cy), z0, z1 }); continue; }
    if (!(hx > 0.0005) || !(hy > 0.0005) || !(z1 > z0)) continue;
    const cw = Math.cos(s.yaw || 0), sw = Math.sin(s.yaw || 0);
    const L = (ax, ay) => T(cx + ax * cw - ay * sw, cy + ax * sw + ay * cw);
    if (s.kind === 'drum') {
      const n = Math.max(6, Math.min(24, s.n || 12));
      const ring = (r) => Array.from({ length: n }, (_, i) => { const a = (i + 0.5) / n * Math.PI * 2; return L(Math.cos(a) * r, Math.sin(a) * r); });
      segs.push({ k: 'drum', bot: ring(V(s.rb)), top: ring(V(s.rt)), z0, z1 });
    } else if (s.kind === 'arch') {
      const ribs = [];
      for (let i = 0; i <= 8; i++) { const th = i / 8 * Math.PI; ribs.push([L(-hx, Math.cos(th) * hy), L(hx, Math.cos(th) * hy), Math.sin(th)]); }
      segs.push({ k: 'arch', ribs, z0, z1 });
    } else {
      segs.push({ k: 'box', pts: [L(-hx, -hy), L(hx, -hy), L(hx, hy), L(-hx, hy)], z0, z1 });
    }
  }
  return { segs, floors, storey: h / Math.max(1, floors) };
}

// The city's batches from a composed set. Returns { opaque, glow, curtain, stats }: `opaque` and
// `glow` (the lamps' pools, drawn adding light) map a key to a batch, `curtain` the walls as
// { a, b, h } (park-frame ground points and a height) for the Curtain's own shader.
export function buildCityscape(set, { art = null, outline = [] } = {}) {
  const T = set.T, EX = set.EX, EN = set.EN;
  const opaque = new Map(), glow = new Map();
  const B = (key, into = opaque) => { let b = into.get(key); if (!b) { b = createBatch(); into.set(key, b); } return b; };
  const stats = { buildings: 0, missing: [], filler: 0, lamps: 0, beacons: 0, roads: 0 };
  const G = -0.3;   // the city's ground, a hair under the park's

  // walls between rings of points, the facade's uv in bays and storeys
  const loft = (rings, look) => {
    const b = B('city'), col = [look.seed, SET_STYLES.indexOf(look.style) / 15, look.lit];
    const bay = look.bay, F = look.floor;
    const c0 = rings[0].pts.reduce((a, p) => add(a, mul(p, 1 / rings[0].pts.length)), [0, 0, 0]);
    for (let r = 0; r < rings.length - 1; r++) {
      const A = rings[r], Bq = rings[r + 1], n = A.pts.length;
      let acc = 0;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const p0 = add(A.pts[i], [0, A.y, 0]), q0 = add(A.pts[j], [0, A.y, 0]), q1 = add(Bq.pts[j], [0, Bq.y, 0]), p1 = add(Bq.pts[i], [0, Bq.y, 0]);
        const w = Math.hypot(q0[0] - p0[0], q0[2] - p0[2]);
        if (w < 0.01) continue;
        let nn = norm(cross(sub(q0, p0), sub(p1, p0)));
        const mid = mul(add(p0, q0), 0.5);
        if (dot(nn, sub(mid, [c0[0], mid[1], c0[2]])) < 0) nn = mul(nn, -1);   // facing out
        const u0 = acc / bay, u1 = (acc + w) / bay;
        acc += w;
        quad(b, p0, q0, q1, p1, nn, col, MAT.FACADE, [[u0, A.y / F], [u1, A.y / F], [u1, Bq.y / F], [u0, Bq.y / F]]);
      }
    }
    const top = rings[rings.length - 1], c = top.pts.reduce((a, p) => add(a, mul(p, 1 / top.pts.length)), [0, 0, 0]);
    const rb = B('roofs');
    for (let i = 0; i < top.pts.length; i++) {
      const j = (i + 1) % top.pts.length;
      vtx(rb, add(c, [0, top.y, 0]), [0, 1, 0], [0, 0], ROOF, MAT.MATTE);
      vtx(rb, add(top.pts[i], [0, top.y, 0]), [0, 1, 0], [0, 0], ROOF, MAT.MATTE);
      vtx(rb, add(top.pts[j], [0, top.y, 0]), [0, 1, 0], [0, 0], ROOF, MAT.MATTE);
    }
  };
  // an aircraft beacon: a small bright box, which the bloom makes a light
  const lamp = (p, r, col) => {
    const b = B('lamps'), h = r;
    for (const [a, bb, c, d, n] of [
      [[-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h], [0, 0, 1]], [[h, -h, -h], [-h, -h, -h], [-h, h, -h], [h, h, -h], [0, 0, -1]],
      [[h, -h, h], [h, -h, -h], [h, h, -h], [h, h, h], [1, 0, 0]], [[-h, -h, -h], [-h, -h, h], [-h, h, h], [-h, h, -h], [-1, 0, 0]],
      [[-h, h, h], [h, h, h], [h, h, -h], [-h, h, -h], [0, 1, 0]],
    ]) quad(b, add(p, a), add(p, bb), add(p, c), add(p, d), n, col, MAT.EMISSIVE);
  };
  // a box `hl` along `dir` and `hw` across it, from y0 to y1
  const slab = (b, c, dir, hl, hw, y0, y1, col, mat) => {
    const a = norm([dir[0], 0, dir[2]]), s = [-a[2], 0, a[0]];
    const P = (i, j, y) => [c[0] + a[0] * i + s[0] * j, y, c[2] + a[2] * i + s[2] * j];
    const lo = [P(-hl, -hw, y0), P(hl, -hw, y0), P(hl, hw, y0), P(-hl, hw, y0)], hi = lo.map((p) => [p[0], y1, p[2]]);
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; quad(b, lo[i], lo[j], hi[j], hi[i], norm(cross(sub(lo[j], lo[i]), [0, 1, 0])), col, mat); }
    quad(b, hi[0], hi[1], hi[2], hi[3], [0, 1, 0], col, mat);
    quad(b, lo[3], lo[2], lo[1], lo[0], [0, -1, 0], col, mat);
  };
  const post = (p, y0, y1, r, col, mat = MAT.METAL) => {
    const b = B('posts');
    for (let i = 0; i < 4; i++) {
      const a0 = i / 4 * Math.PI * 2, a1 = (i + 1) / 4 * Math.PI * 2;
      const d0 = [Math.cos(a0) * r, 0, Math.sin(a0) * r], d1 = [Math.cos(a1) * r, 0, Math.sin(a1) * r], n = norm(add(d0, d1));
      quad(b, add(p, add(d0, [0, y0, 0])), add(p, add(d1, [0, y0, 0])), add(p, add(d1, [0, y1, 0])), add(p, add(d0, [0, y1, 0])), n, col, mat);
    }
  };

  // ── the buildings ──
  for (const { b, at } of set.placed) {
    const shape = cityShape(b);
    if (!shape) { stats.missing.push(b.n || b.t); continue; }
    stats.buildings++;
    const style = styleOf(art, b), seed = unit('b:' + b.x + ',' + b.y);
    const look = { seed, style, lit: STYLE_LIT[style] * (0.7 + 0.6 * unit('lit:' + b.x + ',' + b.y)), bay: BAY[style] || 11.5, floor: Math.max(6, shape.storey * T) };
    const P = (p) => [at[0] + EX[0] * p[0] * T - EN[0] * p[1] * T, 0, at[2] + EX[2] * p[0] * T - EN[2] * p[1] * T];
    let topY = 0, topAt = at;
    for (const s of shape.segs) {
      const y0 = s.z0 * T + G, y1 = s.z1 * T + G;
      if (s.k === 'mast') {
        const c = P(s.p);
        post(c, y0, y1, 0.9, [0.06, 0.06, 0.065]);
        lamp([c[0], y1 + 2, c[2]], 1.3, RED); stats.beacons++;
        if (y1 > topY) { topY = y1; topAt = c; }
        continue;
      }
      if (s.k === 'box' || s.k === 'drum') {
        const bot = (s.k === 'box' ? s.pts : s.bot).map(P), top = (s.k === 'box' ? s.pts : s.top).map(P);
        loft([{ pts: bot, y: y0 }, { pts: top, y: y1 }], look);
        if (y1 > topY) { topY = y1; topAt = bot.reduce((a, p) => add(a, mul(p, 1 / bot.length)), [0, 0, 0]); }
      } else if (s.k === 'arch') {
        const ab = B('roofs');
        for (let i = 0; i < s.ribs.length - 1; i++) {
          const [a0, b0, f0] = s.ribs[i], [a1, b1, f1] = s.ribs[i + 1];
          const A = add(P(a0), [0, y0 + f0 * (y1 - y0), 0]), Bq = add(P(b0), [0, y0 + f0 * (y1 - y0), 0]);
          const C = add(P(b1), [0, y0 + f1 * (y1 - y0), 0]), D = add(P(a1), [0, y0 + f1 * (y1 - y0), 0]);
          let n = norm(cross(sub(Bq, A), sub(D, A)));
          if (n[1] < 0) n = mul(n, -1);
          quad(ab, A, Bq, C, D, n, [0.07, 0.07, 0.072], MAT.MATTE);
        }
        if (y1 > topY) topY = y1;
      }
    }
    // an aircraft light on anything tall
    if (topY > 230) { lamp([topAt[0], topY + 3, topAt[2]], topY > 600 ? 1.8 : 1.2, RED); stats.beacons++; }
  }

  // ── the filler ──
  for (const f of set.fill) {
    const h = f.floors * 11.5, hw = f.w / 2, hd = f.d / 2;
    const pts = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([a, c]) => [f.at[0] + EX[0] * a + EN[0] * c, 0, f.at[2] + EX[2] * a + EN[2] * c]);
    loft([{ pts, y: G }, { pts, y: h + G }], { seed: f.seed, style: f.style, lit: STYLE_LIT[f.style] * (0.6 + 0.6 * f.seed), bay: BAY[f.style] || 12, floor: 11.5 });
    stats.filler++;
  }

  // ── the ground: streets from their arms, paved plots, the plaza round the walls ──
  const g = B('streets');
  const cellQuad = (i, j, a0, b0, a1, b1, colr) => {
    const P4 = [[a0, b0], [a1, b0], [a1, b1], [a0, b1]].map(([a, bb]) => add(set.cellPt(i, j, a, bb), [0, G, 0]));
    quad(g, P4[0], P4[1], P4[2], P4[3], [0, 1, 0], colr, MAT.STREET, [[a0, b0], [a1, b0], [a1, b1], [a0, b1]]);
  };
  const type = (i, j) => set.cells.get(i + ',' + j);
  const isRoad = (i, j) => type(i, j) === 'road';
  const { iMin, iMax, jMin, jMax, iS0, iS1, jS0, jS1 } = set.grid;
  // under the superblock, paving a little lower still, so no gap between the park's own ground
  // and the plaza's shows through
  { const a = set.cellPt(iS0, jS0, 0, 0), b = set.cellPt(iS1, jS0, 1, 0), c = set.cellPt(iS1, jS1, 1, 1), d = set.cellPt(iS0, jS1, 0, 1);
    quad(g, add(a, [0, G - 0.3, 0]), add(b, [0, G - 0.3, 0]), add(c, [0, G - 0.3, 0]), add(d, [0, G - 0.3, 0]), [0, 1, 0], [0, 0.5, 0.5], MAT.STREET,
      [[0, 0], [iS1 - iS0 + 1, 0], [iS1 - iS0 + 1, jS1 - jS0 + 1], [0, jS1 - jS0 + 1]]); }
  // a cobra head: the pole, its arm out over the road, the dark housing and the lit glass under
  // it, so from the side a lamp is a lamp and from below it's a light
  const STEEL = [0.035, 0.036, 0.04];
  const lampAt = (base, toward) => {
    if (insidePoly(outline, base, 6)) return;
    const dir = norm([toward[0] - base[0], 0, toward[2] - base[2]]), h = LAMP_H + G;
    post(base, G, h + 0.6, 0.45, STEEL);
    const head = add(base, mul(dir, 7));
    slab(B('posts'), add(base, mul(dir, 3.6)), dir, 3.6, 0.25, h - 0.3, h + 0.3, STEEL, MAT.METAL);
    slab(B('posts'), head, dir, 1.6, 0.7, h - 0.7, h + 0.2, [0.03, 0.03, 0.032], MAT.METAL);
    slab(B('lamps'), head, dir, 1.2, 0.5, h - 0.9, h - 0.7, SODIUM, MAT.EMISSIVE);
    // its pool on the ground
    const R = POOL_R, c = [head[0], G + 0.08, head[2]], pb = B('pool', glow);
    quad(pb, add(c, [-R, 0, -R]), add(c, [R, 0, -R]), add(c, [R, 0, R]), add(c, [-R, 0, R]), [0, 1, 0], [1.0, 0.46, 0.13], MAT.POOL);
    stats.lamps++;
  };
  for (let i = iMin; i <= iMax; i++) for (let j = jMin; j <= jMax; j++) {
    const t = type(i, j), seed = unit('s:' + i + ',' + j);
    if (t === 'plot') { cellQuad(i, j, 0, 0, 1, 1, [0, 0.5, seed]); continue; }
    if (t === 'park' || t === 'plaza') {
      // paving right up to the walls: the parts of the tile the park's own ground doesn't cover
      for (let a = 0; a < 3; a++) for (let c = 0; c < 3; c++) {
        if (!insidePoly(outline, set.cellPt(i, j, (a + 0.5) / 3, (c + 0.5) / 3), 12)) cellQuad(i, j, a / 3, c / 3, (a + 1) / 3, (c + 1) / 3, [0, 0.5, seed]);
      }
      continue;
    }
    if (t !== 'road') continue;
    stats.roads++;
    const mask = (isRoad(i, j - 1) ? 1 : 0) | (isRoad(i + 1, j) ? 2 : 0) | (isRoad(i, j + 1) ? 4 : 0) | (isRoad(i - 1, j) ? 8 : 0);
    cellQuad(i, j, 0, 0, 1, 1, [mask / 16, 1, seed]);
    const c = set.cellPt(i, j), dist = Math.hypot(c[0], c[2]);
    if (dist > LAMP_REACH) continue;
    const ns = (mask & 5) !== 0 && (mask & 10) === 0, ew = (mask & 10) !== 0 && (mask & 5) === 0;
    if (ns || ew) {
      for (const tt of [0.25, 0.75]) {
        const side = tt < 0.5 ? 0 : 1;
        lampAt(ns ? set.cellPt(i, j, side ? 0.92 : 0.08, tt) : set.cellPt(i, j, tt, side ? 0.92 : 0.08), ns ? set.cellPt(i, j, 0.5, tt) : set.cellPt(i, j, tt, 0.5));
      }
    } else lampAt(set.cellPt(i, j, 0.08, 0.08), c);   // a crossing: one on its corner
  }
  // lamp standards round the park's walls, every 64 ft on the plaza
  let run = 0;
  for (let k = 0; k < outline.length; k++) {
    const a = outline[k], b = outline[(k + 1) % outline.length], L = Math.hypot(b[0] - a[0], b[2] - a[2]);
    if (L < 0.01) continue;
    for (let s0 = (64 - run) % 64; s0 < L; s0 += 64) {
      const p = [a[0] + (b[0] - a[0]) * s0 / L, 0, a[2] + (b[2] - a[2]) * s0 / L];
      let n = norm([b[2] - a[2], 0, a[0] - b[0]]);
      if (insidePoly(outline, add(p, mul(n, 4)))) n = mul(n, -1);
      const base = add(p, mul(n, 34)), [u, v] = set.uvOf(base), tt = type(Math.floor(u / T), Math.floor(-v / T));
      if ((tt === 'plaza' || tt === 'park') && !insidePoly(outline, base, 24)) lampAt(base, p);
    }
    run = (run + L) % 64;
  }

  // ── the edges: the Curtain on a wall, the bay past a shore, red rock past the rest ──
  const { uW, uE, vN, vS, kinds } = set.walls;
  const P = (u, v) => [EX[0] * u + EN[0] * v, 0, EX[2] * u + EN[2] * v];
  const curtain = [], H = CURTAIN_H * T;
  const sides = { w: [P(uW, vS), P(uW, vN)], e: [P(uE, vS), P(uE, vN)], s: [P(uW, vS), P(uE, vS)], n: [P(uW, vN), P(uE, vN)] };
  for (const [side, [a, b]] of Object.entries(sides)) if (kinds[side] === 'wall') curtain.push({ a, b, h: H });
  const R = 9000, ground = B('edge');
  const flat = (Q, y, col, mat) => { const q = Q.map(([u, v]) => add(P(u, v), [0, y, 0])); quad(ground, q[0], q[1], q[2], q[3], [0, 1, 0], col, mat); };
  const beyondCol = (side) => (kinds[side] === 'shore' ? [BAY_WATER, -2, MAT.GLOSS] : [ROCK, -0.35, MAT.MATTE]);
  { const [c, y, m] = beyondCol('s'); flat([[uW - R, vS - R], [uE + R, vS - R], [uE + R, vS], [uW - R, vS]], y, c, m); }
  { const [c, y, m] = beyondCol('n'); flat([[uW - R, vN], [uE + R, vN], [uE + R, vN + R], [uW - R, vN + R]], y, c, m); }
  { const [c, y, m] = beyondCol('w'); flat([[uW - R, vS], [uW, vS], [uW, vN], [uW - R, vN]], y, c, m); }
  { const [c, y, m] = beyondCol('e'); flat([[uE, vS], [uE + R, vS], [uE + R, vN], [uE, vN]], y, c, m); }
  // a quay's face where the city meets the water
  for (const [side, [a, b]] of Object.entries(sides)) {
    if (kinds[side] !== 'shore') continue;
    const out = side === 'n' ? EN : side === 's' ? mul(EN, -1) : side === 'w' ? mul(EX, -1) : EX;
    quad(ground, add(a, [0, -2, 0]), add(b, [0, -2, 0]), add(b, [0, G, 0]), add(a, [0, G, 0]), out, [0.05, 0.048, 0.045], MAT.CONCRETE);
  }

  let tris = 0;
  for (const m of [opaque, glow]) for (const b of m.values()) tris += b.n / 3;
  stats.tris = Math.round(tris);
  return { opaque, glow, curtain, stats };
}

// ── the shading ──
// A hash the city's shaders share.
const CITY_HASH = `float cityHash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }`;

// A facade, from its bays and storeys: vUv is (bay, storey), vCol (seed, style / 15, share of
// windows lit). Windows have mullions, offices light a zone at a time and homes a window at a
// time, a lit room is brighter at its ceiling, some have a blind half down, now and then one has
// the blue of a television, and the ground floor is shopfronts. Once a window is under a pixel the
// pattern averages, so far towers don't shimmer.
export const FACADE_GLSL = `
${CITY_HASH}
void facade(out vec3 alb, out float rough, out float f0s, out vec3 emis, out float metal){
  float seed = vCol.r * 97.0; int st = int(vCol.g * 15.0 + 0.5); float litF = vCol.b;
  vec2 uv = vUv; vec2 cell = floor(uv); vec2 f = fract(uv);
  vec3 wall; vec2 win; float wr = 0.7; metal = 0.0; int panes = 1;
  vec3 lc = vec3(1.0, 0.62, 0.33);
  float pick = cityHash(cell + seed * 5.1);
  float tint = 0.85 + 0.3 * cityHash(vec2(seed, 7.7));
  if (st == 0) { wall = vec3(0.030, 0.034, 0.042); win = vec2(0.92, 0.70); wr = 0.16; panes = 2; lc = pick < 0.7 ? vec3(0.78, 0.88, 1.0) : vec3(1.0, 0.80, 0.55); }
  else if (st == 1) { wall = vec3(0.16, 0.15, 0.14); win = vec2(0.52, 0.52); lc = pick < 0.55 ? vec3(0.85, 0.92, 1.0) : vec3(1.0, 0.70, 0.42); }
  else if (st == 2) { wall = vec3(0.13, 0.062, 0.042); win = vec2(0.40, 0.52); lc = pick < 0.78 ? vec3(1.0, 0.60, 0.30) : pick < 0.9 ? vec3(0.40, 0.55, 1.0) : vec3(1.0, 0.86, 0.60); }
  else if (st == 3) { wall = vec3(0.21, 0.21, 0.22); win = vec2(1.0, 0.36); panes = 3; lc = vec3(0.86, 0.93, 1.0); }
  else if (st == 4) { wall = vec3(0.085, 0.080, 0.075); win = vec2(0.30, 0.26); lc = vec3(1.0, 0.52, 0.18); }
  else if (st == 5) { wall = vec3(0.05, 0.06, 0.05); win = vec2(0.94, 0.66); lc = pick < 0.75 ? vec3(1.0, 0.16, 0.72) : vec3(0.62, 0.22, 1.0); }
  else if (st == 6) { wall = vec3(0.30, 0.29, 0.27); win = vec2(0.14, 0.72); lc = vec3(0.62, 0.95, 1.0); }
  else if (st == 8) { wall = vec3(0.20, 0.21, 0.23); win = vec2(1.0, 0.42); wr = 0.42; panes = 3; metal = 1.0; lc = pick < 0.65 ? vec3(0.84, 0.92, 1.0) : vec3(1.0, 0.78, 0.52); }
  else { wall = vec3(0.045, 0.040, 0.036); win = vec2(0.46, 0.52); lc = vec3(0.0); litF = 0.0; }
  wall *= tint;
  vec2 fw = fwidth(uv) + 1e-4;
  vec2 lo = 0.5 - win * 0.5, hi = 0.5 + win * 0.5;
  vec2 m2 = smoothstep(lo - fw, lo + fw, f) * (1.0 - smoothstep(hi - fw, hi + fw, f));
  if (win.x >= 1.0) m2.x = 1.0;
  float wm = m2.x * m2.y;
  // mullions: the glass is two or three panes to a bay, framed in the cladding's own colour
  float pu = fract(f.x * float(panes));
  float mull = panes > 1 ? 1.0 - smoothstep(0.03 * float(panes), 0.03 * float(panes) + fw.x * float(panes) * 1.5, min(pu, 1.0 - pu)) : 0.0;
  // offices light by zone, homes window by window
  float zone = cityHash(vec2(floor(cell.x / 4.0), cell.y) + seed * 31.7);
  float one = cityHash(cell + seed * 17.3);
  float lit = (st == 2 || st == 6) ? step(one, litF) : step(zone, litF) * step(one, 0.93);
  float bri = 0.55 + 0.9 * cityHash(cell + seed * 3.7);
  // inside a lit room: the ceiling's lights near the head of the glass, a blind half down now and
  // then, and the odd set left on
  float wy = clamp((f.y - lo.y) / max(win.y, 1e-3), 0.0, 1.0);
  float room = mix(0.45, 1.15, smoothstep(0.1, 0.95, wy));
  float blind = cityHash(cell + seed * 9.1);
  if (blind < 0.28) room *= mix(1.0, 0.32, step(1.0 - 0.35 - 0.4 * blind, wy));
  if (cityHash(cell + seed * 2.3) < 0.04) lc = vec3(0.35, 0.55, 1.0);
  // the ground floor is shopfronts and lobbies, mostly lit
  if (cell.y < 1.0 && st != 4 && st != 7) { lit = step(cityHash(cell + 9.0), 0.78); lc = (st == 0 || st == 8 || st == 3) ? vec3(1.0, 0.93, 0.8) : vec3(1.0, 0.72, 0.42); bri = 0.28 + 0.3 * cityHash(cell + seed * 4.4); room = mix(0.6, 1.0, smoothstep(0.2, 0.9, wy)); }
  float far = smoothstep(0.28, 0.75, max(fw.x, fw.y));
  float wmS = wm * (1.0 - mull);
  wmS = mix(wmS, win.x * win.y, far);
  lit = mix(lit, litF, far); bri = mix(bri, 0.95, far); room = mix(room, 0.85, far);
  alb = mix(wall, vec3(0.018, 0.021, 0.026), wmS);
  rough = mix(wr, 0.10, wmS); f0s = mix(0.035, 0.06, wmS);
  metal *= 1.0 - wmS;
  emis = lc * bri * room * lit * wmS;
}`;

// A street and its pavements from the tile's road arms: vCol.r * 16 is the arms (1 north,
// 2 east, 4 south, 8 west), vCol.g the kind (1 a road, 0.5 paving), vCol.b a seed; vUv runs 0..1
// across the tile, x east and y south. Asphalt, pale kerbs, pavement slabs about five feet
// square, a double yellow and broken lane lines on a straight, crossings on a junction's arms.
export const STREET_GLSL = `
float citySdBox(vec2 p, vec2 c, vec2 h){ vec2 d = abs(p - c) - h; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
void street(out vec3 alb, out float rough, out float f0s){
  int arms = int(vCol.r * 16.0 + 0.5); float kind = vCol.g; vec2 t = vUv; vec2 fw = fwidth(t) + 1e-4;
  const float SW = 0.16;
  bool nA = (arms & 1) != 0, eA = (arms & 2) != 0, sA = (arms & 4) != 0, wA = (arms & 8) != 0;
  float dR = 9.0;
  if (kind > 0.75) {
    dR = citySdBox(t, vec2(0.5), vec2(0.5 - SW));
    if (nA) dR = min(dR, citySdBox(t, vec2(0.5, 0.25), vec2(0.5 - SW, 0.2501)));
    if (sA) dR = min(dR, citySdBox(t, vec2(0.5, 0.75), vec2(0.5 - SW, 0.2501)));
    if (wA) dR = min(dR, citySdBox(t, vec2(0.25, 0.5), vec2(0.2501, 0.5 - SW)));
    if (eA) dR = min(dR, citySdBox(t, vec2(0.75, 0.5), vec2(0.2501, 0.5 - SW)));
  }
  float fwm = max(fw.x, fw.y);
  float road = 1.0 - smoothstep(-fwm, fwm, dR);
  vec4 n1 = texture(uGrass, vPos.xz / 7.0), n2 = texture(uGrass, vPos.xz / 140.0);
  vec3 asphalt = vec3(0.030, 0.030, 0.033) * (0.8 + 0.4 * n1.r) * (0.85 + 0.3 * n2.g);
  // pavement slabs, the joints fading out with distance
  vec2 sl = abs(fract(vPos.xz / 5.0) - 0.5); float jfw = fwidth(vPos.x / 5.0) + 1e-4;
  float joint = (1.0 - smoothstep(0.46, 0.46 + jfw * 1.5, max(sl.x, sl.y))) * (1.0 - smoothstep(0.15, 0.5, jfw));
  vec3 pave = vec3(0.105, 0.102, 0.098) * (0.88 + 0.24 * n1.g) * (0.9 + 0.2 * n2.r) * (1.0 - 0.3 * (1.0 - joint));
  float kerb = (kind > 0.75) ? (1.0 - smoothstep(0.0, fwm * 1.5 + 0.004, abs(dR - 0.004))) : 0.0;
  alb = mix(pave, asphalt, road);
  alb = mix(alb, vec3(0.16, 0.155, 0.15), kerb * 0.8);
  rough = mix(0.82, 0.62, road); f0s = mix(0.03, 0.04, road);
  if (road > 0.0) {
    int nArms = int(nA) + int(eA) + int(sA) + int(wA);
    bool straightNS = nA && sA && !eA && !wA, straightEW = eA && wA && !nA && !sA;
    float paint = 0.0; vec3 pc = vec3(0.0);
    if (straightNS || straightEW) {
      float across = straightNS ? t.x : t.y, along = straightNS ? t.y : t.x;
      float fa = straightNS ? fw.x : fw.y;
      float yl = 1.0 - smoothstep(0.0028, 0.0028 + fa, abs(abs(across - 0.5) - 0.006));
      float dash = step(fract(along * 1.46 + 0.1), 0.25);
      float wl = (1.0 - smoothstep(0.0028, 0.0028 + fa, abs(abs(across - 0.5) - 0.17))) * dash;
      pc = mix(vec3(0.42, 0.30, 0.04), vec3(0.50), step(0.5, wl)); paint = max(yl, wl);
    } else if (nArms >= 3 || (nArms == 2 && !(straightNS || straightEW))) {
      float zb = 0.0;
      if (nA) zb = max(zb, step(abs(t.y - SW * 0.5), SW * 0.38) * step(0.5, fract(t.x * 13.0)) * step(SW, t.x) * step(t.x, 1.0 - SW));
      if (sA) zb = max(zb, step(abs(t.y - 1.0 + SW * 0.5), SW * 0.38) * step(0.5, fract(t.x * 13.0)) * step(SW, t.x) * step(t.x, 1.0 - SW));
      if (wA) zb = max(zb, step(abs(t.x - SW * 0.5), SW * 0.38) * step(0.5, fract(t.y * 13.0)) * step(SW, t.y) * step(t.y, 1.0 - SW));
      if (eA) zb = max(zb, step(abs(t.x - 1.0 + SW * 0.5), SW * 0.38) * step(0.5, fract(t.y * 13.0)) * step(SW, t.y) * step(t.y, 1.0 - SW));
      paint = zb; pc = vec3(0.48);
    }
    paint *= (0.75 + 0.25 * n1.b) * (1.0 - smoothstep(0.02, 0.06, fwm));
    alb = mix(alb, pc, paint * road);
  }
  if (kind < 0.75 && kind > 0.25) { alb = pave; rough = 0.84; }
}`;
