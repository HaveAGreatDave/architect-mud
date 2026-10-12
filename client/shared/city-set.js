// A city composed for television round a full-size park (docs/proposals/deadball-glass2.md,
// On TV the city is a set). The map gives the park a compact block; the broadcast draws it full
// size, so what the cameras see outside its walls is a set built from the map's buildings, not
// a copy of the map:
//
//   1. the park stands in a superblock, the tiles its outline touches, paved round its walls;
//   2. streets run every third tile out from it, so a block is two plots by two, and the ring
//      streets meet behind home plate;
//   3. the edges are straight: each side's Curtain or shore at the map's distance, pushed out
//      past the park like everything else and put on a tile line;
//   4. each building takes the free plot nearest its bearing-true place, nearest first; one on
//      the water stays on the water, as far off the set's shore as it stands off the map's, and
//      one beyond the Curtain stays where it stands;
//   5. plots no building claims get filler in their quarter's style;
//   6. nothing tall stands within 48 ft of a street-level camera.
//
// Pure, so every client builds the same set and a gate checks it in Node. It names no region:
// the site, the skyline (server/engine/skyline.js) and the park's outline say everything, and the
// look of a quarter comes from the venue's own art direction (`styles`).
//
// Frames: the park's is feet with home plate at the origin, +z to centre field, +x toward third
// and y up. The map's is tiles, x east and y south. The set's grid is the map's directions in the
// park's frame: cell (i, j) runs i east and j south, with home plate at the corner of (0, 0).

// GLASS's tile in feet: a storey is 3.5 m, so a tile is about 17.9 m.
export const SET_TILE = 58.6;
const TAU = Math.PI * 2;

// One tile east and one tile north as directions in the park's frame, for a park whose centre
// field lies on compass `bearing` (degrees: 0 north, 90 east).
export function mapAxes(bearing) {
  const b = Number(bearing || 0) * Math.PI / 180;
  return { EX: [-Math.cos(b), 0, Math.sin(b)], EN: [Math.sin(b), 0, Math.cos(b)] };
}

function hashStr(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const unit = (s) => hashStr(s) / 4294967296;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Point in the outline's polygon (xz), or within `margin` of its edge.
export function insidePoly(poly, p, margin = 0) {
  const x = p[0], z = p[2];
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][2], xj = poly[j][0], zj = poly[j][2];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
  }
  if (c || margin <= 0) return c;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const abx = b[0] - a[0], abz = b[2] - a[2], apx = x - a[0], apz = z - a[2];
    const t = Math.min(1, Math.max(0, (apx * abx + apz * abz) / (abx * abx + abz * abz || 1)));
    if (Math.hypot(apx - abx * t, apz - abz * t) < margin) return true;
  }
  return false;
}
// How far a ray from home plate on heading `th` (radians, atan2(x, z)) runs to the polygon's
// far edge.
function rayTo(poly, th) {
  const dx = Math.sin(th), dz = Math.cos(th);
  let best = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], ex = b[0] - a[0], ez = b[2] - a[2];
    const den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = (a[0] * ez - a[2] * ex) / den, u = (a[0] * dz - a[2] * dx) / den;
    if (t > 0 && u >= -1e-6 && u <= 1 + 1e-6) best = Math.max(best, t);
  }
  return best;
}

// The art direction a venue's content gives its city: a style per building type, and quarters
// of the map (tile rectangles, the first that holds a tile wins) whose tall and low buildings
// and filler take their own styles. The styles are the facade shader's (gl/cityscape.js).
export const SET_STYLES = Object.freeze(['glass', 'concrete', 'brick', 'ribbon', 'works', 'farm', 'stone', 'ruin', 'chrome']);
function quarterOf(art, x, y) {
  for (const q of art?.quarters || []) {
    if (q.x && (x < q.x[0] || x > q.x[1])) continue;
    if (q.y && (y < q.y[0] || y > q.y[1])) continue;
    return q;
  }
  return null;
}
// A quarter with `all` dresses everything in it alike, whatever its type (a district gone to
// ruin); otherwise a type's own style wins, then the quarter's for a tall or a low building.
export function styleOf(art, b) {
  const q = quarterOf(art, b.x, b.y);
  if (SET_STYLES.includes(q?.all)) return q.all;
  const s = art?.styles?.[b.t];
  if (SET_STYLES.includes(s)) return s;
  const style = (b.f || 0) >= (art?.tallFloors || 6) ? q?.tall : q?.low;
  return SET_STYLES.includes(style) ? style : 'concrete';
}

// Compose the set. `site` { x, y, bearing, block: { x0, x1, y0, y1 } } (tiles, the block's
// bounds inclusive); `skyline` { buildings, edges } from the server; `outline` the full park's
// outline in its own frame ([x, y, z] points, ballpark-mesh's `outline`); `art` the venue's
// art direction; `cameras` the low cameras' eyes, kept clear of tall things.
export function composeSet({ site, skyline, outline, art = null, tile = SET_TILE, reach = 40, cameras = [] }) {
  const T = tile, sx = Number(site?.x), sy = Number(site?.y);
  const { EX, EN } = mapAxes(site?.bearing);
  const blk = site?.block || { x0: Math.floor(sx), x1: Math.floor(sx), y0: Math.floor(sy), y1: Math.floor(sy) };
  const inBlock = (x, y) => x >= blk.x0 && x <= blk.x1 && y >= blk.y0 && y <= blk.y1;
  // a map tile coordinate in the park's frame, before and after the park is made full size
  const t2p = (x, y) => [EX[0] * (x - sx) * T - EN[0] * (y - sy) * T, 0, EX[2] * (x - sx) * T - EN[2] * (y - sy) * T];
  const uvOf = (p) => [dot(p, EX), dot(p, EN)];
  const cellPt = (i, j, a = 0.5, b = 0.5) => [EX[0] * (i + a) * T - EN[0] * (j + b) * T, 0, EX[2] * (i + a) * T - EN[2] * (j + b) * T];

  // The warp: every point keeps its bearing from home plate and moves out by the difference, in
  // that direction, between the full park's outline and the block's edge. Inside the block the
  // ground scales up to the full outline, so nothing tears.
  const N = 1440, full = new Float64Array(N), bl = new Float64Array(N), raw = new Float64Array(N);
  const corners = [[blk.x0, blk.y0], [blk.x1 + 1, blk.y0], [blk.x1 + 1, blk.y1 + 1], [blk.x0, blk.y1 + 1]].map(([x, y]) => t2p(x, y));
  for (let i = 0; i < N; i++) { const th = (i / N) * TAU - Math.PI; raw[i] = rayTo(outline, th) + 6; bl[i] = Math.max(1, rayTo(corners, th)); }
  // the outline's steps (the end of a deck, the board) would tear the city: smooth them, never inward
  for (let i = 0; i < N; i++) {
    let s = 0, w = 0;
    for (let k = -16; k <= 16; k++) { const ww = 1 - Math.abs(k) / 17; s += raw[(i + k + N) % N] * ww; w += ww; }
    full[i] = Math.max(s / w, raw[i]);
  }
  const radii = (th) => {
    const f = ((th + Math.PI) / TAU) * N, i0 = ((Math.floor(f) % N) + N) % N, i1 = (i0 + 1) % N, t = f - Math.floor(f);
    return [full[i0] * (1 - t) + full[i1] * t, bl[i0] * (1 - t) + bl[i1] * t];
  };
  const warp = (p) => {
    const r = Math.hypot(p[0], p[2]);
    if (r < 1e-6) return p.slice();
    const [Rf, Rb] = radii(Math.atan2(p[0], p[2]));
    const r2 = r <= Rb ? r * Rf / Rb : r + (Rf - Rb);
    return [p[0] * r2 / r, p[1], p[2] * r2 / r];
  };
  const unwarp = (p) => {
    const r = Math.hypot(p[0], p[2]);
    if (r < 1e-6) return p.slice();
    const [Rf, Rb] = radii(Math.atan2(p[0], p[2]));
    const r0 = r <= Rf ? r * Rb / Rf : r - (Rf - Rb);
    return [p[0] * r0 / r, p[1], p[2] * r0 / r];
  };
  // the map tile a point of the set stands for
  const sourceTile = (p) => { const [u, v] = uvOf(unwarp(p)); return [Math.floor(sx + u / T), Math.floor(sy - v / T)]; };

  // ── the edges, straight and on tile lines ──
  const E = skyline?.edges || {}, snap = (w) => Math.round(w / T) * T;
  const median = (a) => { const s = a.slice().sort((p, q) => p - q); return s.length ? s[s.length >> 1] : 0; };
  const kinds = {};
  const sideU = (side) => {
    const e = E[side];
    if (e?.wall != null) { kinds[side] = 'wall'; return snap(uvOf(warp(t2p(e.wall, sy)))[0]); }
    if (e?.shore?.length) { kinds[side] = 'shore'; return snap(median(e.shore.map(([y, x]) => uvOf(warp(t2p(x, y + 0.5)))[0]))); }
    kinds[side] = null;
    return snap((side === 'w' ? -1 : 1) * reach * T);
  };
  const sideV = (side) => {
    const e = E[side];
    if (e?.wall != null) { kinds[side] = 'wall'; return snap(uvOf(warp(t2p(sx, e.wall)))[1]); }
    if (e?.shore?.length) { kinds[side] = 'shore'; return snap(median(e.shore.map(([x, y]) => uvOf(warp(t2p(x + 0.5, y)))[1]))); }
    kinds[side] = null;
    return snap((side === 'n' ? 1 : -1) * reach * T);
  };
  const walls = { uW: sideU('w'), uE: sideU('e'), vN: sideV('n'), vS: sideV('s'), kinds };

  // ── the superblock and the streets ──
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const p of outline) { const [u, v] = uvOf(p); u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  const iS0 = Math.floor(u0 / T), iS1 = Math.floor(u1 / T), jS0 = Math.floor(-v1 / T), jS1 = Math.floor(-v0 / T);
  const iMin = Math.round(walls.uW / T), iMax = Math.round(walls.uE / T) - 1, jMin = Math.round(-walls.vN / T), jMax = Math.round(-walls.vS / T) - 1;
  const grid = { iS0, iS1, jS0, jS1, iMin, iMax, jMin, jMax };
  // A ring round the superblock, then every third tile out from it, so the gate behind home plate
  // looks onto a corner. Across the superblock's span the lines keep the low side's spacing,
  // dropping one that would run beside the ring. The set's north and south edges are a road (a
  // lane inside a wall, a road along a shore), and no cross street runs beside either.
  const streetLine = (k, lo, hi) => (k < lo ? (lo - 1 - k) % 3 === 0 : k > hi ? (k - hi - 1) % 3 === 0 : (k - lo + 1) % 3 === 0 && hi + 1 - k >= 3);
  const cells = new Map();
  for (let i = iMin; i <= iMax; i++) for (let j = jMin; j <= jMax; j++) {
    const c = cellPt(i, j);
    let t;
    if (i >= iS0 && i <= iS1 && j >= jS0 && j <= jS1) t = insidePoly(outline, c, 22) ? 'park' : 'plaza';
    else if (j === jMax || j === jMin) t = 'road';
    else if (streetLine(i, iS0, iS1) || (streetLine(j, jS0, jS1) && j !== jMax - 1 && j !== jMin + 1)) t = 'road';
    else t = 'plot';
    cells.set(i + ',' + j, t);
  }

  // ── the buildings, nearest first, each to the free plot nearest its bearing-true place ──
  const used = new Set(), placed = [], unplaced = [];
  const lowEyes = cameras.filter((e) => e && e[1] < 80);
  const clearOf = (p, r) => lowEyes.every((e) => Math.hypot(p[0] - e[0], p[2] - e[2]) > r);
  // a shore's line where it meets a column (or row) of the map
  const shoreAt = (side, k) => { const s = E[side]?.shore || []; let best = null; for (const [a, b] of s) if (best == null || Math.abs(a - k) < Math.abs(best[0] - k)) best = [a, b]; return best ? best[1] : null; };
  const beyond = (b) => (E.w?.wall != null && b.x + 0.5 < E.w.wall) || (E.e?.wall != null && b.x + 0.5 > E.e.wall)
    || (E.n?.wall != null && b.y + 0.5 < E.n.wall) || (E.s?.wall != null && b.y + 0.5 > E.s.wall);
  const wetSide = ['n', 's', 'w', 'e'].find((s) => kinds[s] === 'shore');
  for (const b of skyline?.buildings || []) {
    if (inBlock(b.x, b.y)) continue;
    const m = t2p(b.x + 0.5, b.y + 0.5), tgt = warp(m), [tu, tv] = uvOf(tgt);
    const ci = Math.floor(tu / T), cj = Math.floor(-tv / T);
    if (beyond(b)) { placed.push({ b, at: tgt, loose: true }); continue; }
    if (b.w && wetSide) {
      // on the water, as far off the set's shore as it stands off the map's
      const vert = wetSide === 'n' || wetSide === 's', k = vert ? b.x : b.y, line = shoreAt(wetSide, k);
      const off = Math.max(10, Math.abs((line ?? (vert ? b.y : b.x)) - (vert ? b.y + 0.5 : b.x + 0.5)) * T);
      const at = wetSide === 'n' ? [EX[0] * tu + EN[0] * (walls.vN + off), 0, EX[2] * tu + EN[2] * (walls.vN + off)]
        : wetSide === 's' ? [EX[0] * tu + EN[0] * (walls.vS - off), 0, EX[2] * tu + EN[2] * (walls.vS - off)]
          : wetSide === 'w' ? [EX[0] * (walls.uW - off) + EN[0] * tv, 0, EX[2] * (walls.uW - off) + EN[2] * tv]
            : [EX[0] * (walls.uE + off) + EN[0] * tv, 0, EX[2] * (walls.uE + off) + EN[2] * tv];
      placed.push({ b, at, loose: true, wet: true });
      continue;
    }
    let best = null, bd = Infinity;
    for (const R of [4, 7]) {
      for (let di = -R; di <= R; di++) for (let dj = -R; dj <= R; dj++) {
        const k = (ci + di) + ',' + (cj + dj);
        if (used.has(k) || cells.get(k) !== 'plot') continue;
        const c = cellPt(ci + di, cj + dj), d = Math.hypot(c[0] - tgt[0], c[2] - tgt[2]);
        if (d < bd && ((b.f || 0) < 5 || clearOf(c, 48))) { bd = d; best = [ci + di, cj + dj, c]; }
      }
      if (best) break;
    }
    if (best) { used.add(best[0] + ',' + best[1]); placed.push({ b, at: best[2], cell: [best[0], best[1]] }); }
    else if (!cells.has(ci + ',' + cj)) placed.push({ b, at: tgt, loose: true });
    else unplaced.push(b.n || b.t);
  }

  // ── filler on the plots nobody real stands on, in the quarter's own style ──
  const fill = [];
  for (let i = iMin; i <= iMax; i++) for (let j = jMin; j <= jMax; j++) {
    const k = i + ',' + j;
    if (cells.get(k) !== 'plot' || used.has(k)) continue;
    const c = cellPt(i, j), far = Math.hypot(c[0], c[2]);
    if (unit('fill:' + k) >= (far < 1400 ? 0.92 : 0.6)) continue;
    const [mx, my] = sourceTile(c), q = quarterOf(art, mx, my);
    const list = (q?.fill || []).filter((s) => SET_STYLES.includes(s));
    const style = list.length ? list[Math.floor(unit('style:' + k) * list.length)] : 'concrete';
    const [lo, hi] = Array.isArray(q?.floors) ? q.floors : [2, 8];
    // lower near the park, so the stands aren't walled in
    const near = Math.min(1, Math.max(0.45, far / 1400));
    const floors = Math.max(1, Math.round((lo + unit('fl:' + k) * (hi - lo)) * near));
    if (floors > 4 && !clearOf(c, 48)) continue;
    fill.push({ i, j, at: c, style, floors, w: T * (0.62 + 0.2 * unit('w:' + k)), d: T * (0.62 + 0.2 * unit('d:' + k)), seed: unit('s:' + k) });
  }

  // how far each building moved off its true bearing from home plate
  const errs = [];
  for (const { b, at } of placed) {
    const m = t2p(b.x + 0.5, b.y + 0.5);
    let d = Math.abs(Math.atan2(at[0], at[2]) - Math.atan2(m[0], m[2])) * 180 / Math.PI;
    if (d > 180) d = 360 - d;
    errs.push({ d, r: Math.hypot(m[0], m[2]), name: b.n || b.t });
  }
  const nearErr = errs.filter((e) => e.r < 900).sort((a, b) => b.d - a.d);
  return {
    T, EX, EN, walls, grid, cells, placed, unplaced, fill,
    bearing: { median: median(errs.map((e) => e.d)), worstNear: nearErr[0] || null },
    cellPt, uvOf, warp, unwarp, sourceTile, t2p,
  };
}
