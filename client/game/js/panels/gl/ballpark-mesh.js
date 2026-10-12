// GLASS 2 · THE BALLPARK'S GEOMETRY, AS TRIANGLES.
//
// Deadball's park in 3-D (the Grandstand, gameday-grandstand.js): the field, the outfield
// wall with its distances, the foul poles, the bleachers and the batter's eye, the lower
// bowl and the upper deck with every row of seats, the backstop net, six light towers and
// the scoreboard. All of it is built from the venue (sports_pools.venue, with diamond/geo.js
// filling in what a venue leaves out), so a park per club is data.
//
// ⚠ NOTHING HERE TOUCHES WEBGL OR THE DOM. It fills Float32Arrays, so it runs in node and
// ballpark-smoke.mjs builds the whole park and checks every float.
//
// Vertex layout, 12 floats: position (3), normal (3), uv (2), colour (3, linear light), and
// the material (1). gl/ballpark.js shades by material:
//
//   GROUND  the field, painted in the shader: grass, mowing, the warning track, the lines,
//           the infield canvas (diamond/dirt.js) laid over it
//   CLOTH, SKIN, LEATHER, GLOSS, SATIN, METAL, CONCRETE, PAD, PLATE, MATTE  by roughness
//   EMISSIVE  a lamp that works: its colour is its light
//   BOARD     the scoreboard: lamps drawn from a small mask of the line score
//   HEAD, EAR, HAIR, NECK  a player's head, shaded as the Actor Lab shades the street figure's
//   EXTERIOR  the park's outer wall, brick and arcade, painted in the shader from feet along
//             and feet up (uv) and its height (colour)
//   FACADE, STREET, POOL  the city round the park (gl/cityscape.js): facades and streets
//             painted from their coordinates, and the pool of light under a street lamp
//
// Feet, home plate at the origin, +z out to centre field, +x toward third base, y up.
//
// ⚠ NO FACE CULLING, as in arena.js: the builders don't keep one winding.

import { DEG, BAGS, MOUND, RUBBER, moundHeight, venueField, fenceDistance, parkOutline, insideOutline, seeded } from '../diamond/geo.js';

export const STRIDE = 12;
export const MAT = Object.freeze({
  GROUND: 0, CLOTH: 1, SKIN: 2, LEATHER: 3, GLOSS: 4, SATIN: 5, METAL: 6, EMISSIVE: 7,
  CONCRETE: 8, PAD: 9, BOARD: 10, PLATE: 11, MATTE: 13,
  // a player's head (gl/ballplayer-mesh.js): the face, the ears, the hair and the neck
  HEAD: 20, EAR: 21, HAIR: 22, NECK: 23,
  // the park's outer wall
  EXTERIOR: 24,
  // the city round the park (gl/cityscape.js)
  FACADE: 30, STREET: 31, POOL: 32,
});

// ── colour ──────────────────────────────────────────────────────────────────
// A hex colour as linear light: the shader lights in linear, and the final pass encodes.
const _lin = new Map();
const decode = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export function lin(hex) {
  let v = _lin.get(hex);
  if (!v) {
    const n = parseInt(String(hex).slice(1, 7), 16);
    v = [decode(((n >> 16) & 255) / 255), decode(((n >> 8) & 255) / 255), decode((n & 255) / 255)];
    _lin.set(hex, v);
  }
  return v;
}
const WHITE = [1, 1, 1];

// ── vectors ─────────────────────────────────────────────────────────────────
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const madd = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const TAU = Math.PI * 2;

// ── a growable batch ────────────────────────────────────────────────────────
export function createBatch(cap = 4096) { return { data: new Float32Array(cap * STRIDE), n: 0 }; }
function grow(b, more) {
  const need = (b.n + more) * STRIDE;
  if (need <= b.data.length) return;
  const d = new Float32Array(Math.max(need, b.data.length * 2));
  d.set(b.data.subarray(0, b.n * STRIDE));
  b.data = d;
}
export function vtx(b, p, n, uv, col, mat) {
  grow(b, 1);
  const o = b.n * STRIDE, d = b.data;
  d[o] = p[0]; d[o + 1] = p[1]; d[o + 2] = p[2];
  d[o + 3] = n[0]; d[o + 4] = n[1]; d[o + 5] = n[2];
  d[o + 6] = uv[0]; d[o + 7] = uv[1];
  d[o + 8] = col[0]; d[o + 9] = col[1]; d[o + 10] = col[2];
  d[o + 11] = mat;
  b.n++;
}
const UV01 = [[0, 0], [1, 0], [1, 1], [0, 1]];
// A flat quad, a→b→c→d round its edge, as two triangles.
export function quad(b, a, bb, c, d, n, col, mat, uvs = UV01) {
  vtx(b, a, n, uvs[0], col, mat); vtx(b, bb, n, uvs[1], col, mat); vtx(b, c, n, uvs[2], col, mat);
  vtx(b, a, n, uvs[0], col, mat); vtx(b, c, n, uvs[2], col, mat); vtx(b, d, n, uvs[3], col, mat);
}
// A box from its centre and half-sizes, turned `yaw` degrees about the vertical.
export function box(b, c, hs, yaw, col, mat, uvScale = 0) {
  const cs = Math.cos(yaw * DEG), sn = Math.sin(yaw * DEG);
  const P = (x, y, z) => [c[0] + x * cs + z * sn, c[1] + y, c[2] - x * sn + z * cs];
  const R = (x, y, z) => [x * cs + z * sn, y, -x * sn + z * cs];
  const [X, Y, Z] = hs;
  const faces = [
    [[-X, -Y, Z], [X, -Y, Z], [X, Y, Z], [-X, Y, Z], [0, 0, 1]], [[X, -Y, -Z], [-X, -Y, -Z], [-X, Y, -Z], [X, Y, -Z], [0, 0, -1]],
    [[X, -Y, Z], [X, -Y, -Z], [X, Y, -Z], [X, Y, Z], [1, 0, 0]], [[-X, -Y, -Z], [-X, -Y, Z], [-X, Y, Z], [-X, Y, -Z], [-1, 0, 0]],
    [[-X, Y, Z], [X, Y, Z], [X, Y, -Z], [-X, Y, -Z], [0, 1, 0]], [[-X, -Y, -Z], [X, -Y, -Z], [X, -Y, Z], [-X, -Y, Z], [0, -1, 0]],
  ];
  for (const [a, bb, cc, d, n] of faces) {
    const uvs = uvScale ? [[0, 0], [2 * X / uvScale, 0], [2 * X / uvScale, 2 * Y / uvScale], [0, 2 * Y / uvScale]] : UV01;
    quad(b, P(...a), P(...bb), P(...cc), P(...d), R(...n), col, mat, uvs);
  }
}
// A parametric surface: `pos(i, j)` for rows i and columns j, joined round when `wrap`.
// Normals come from the neighbours, turned outward from `centre` (or flipped by `flip`).
export function grid(b, rows, cols, pos, { wrap = true, uv = (i, j) => [j / cols, i / (rows - 1)], col = WHITE, mat = 0, centre = null, flip = false } = {}) {
  const P = [];
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) P.push(pos(i, j));
  const at = (i, j) => P[i * cols + (wrap ? ((j % cols) + cols) % cols : Math.max(0, Math.min(cols - 1, j)))];
  const N = [];
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const n = cross(sub(at(i, j + 1), at(i, j - 1)), sub(at(Math.min(i + 1, rows - 1), j), at(Math.max(i - 1, 0), j)));
    const l = len(n);
    N.push(l > 1e-9 ? mul(n, 1 / l) : [0, 1, 0]);
  }
  let sign = flip ? -1 : 1;
  if (centre) { let s = 0; for (let k = 0; k < P.length; k += 7) s += dot(N[k], sub(P[k], centre)); sign = s < 0 ? -1 : 1; }
  const colsE = wrap ? cols : cols - 1;
  for (let i = 0; i < rows - 1; i++) for (let j = 0; j < colsE; j++) {
    const q = (ii, jj) => { const k = ii * cols + (wrap ? jj % cols : jj); return [P[k], mul(N[k], sign), uv(ii, jj)]; };
    const a = q(i, j), bq = q(i, j + 1), c = q(i + 1, j + 1), d = q(i + 1, j);
    for (const v of [a, bq, c, a, c, d]) vtx(b, v[0], v[1], v[2], typeof col === 'function' ? col(v[0]) : col, mat);
  }
}
export function cylinder(b, base, h, r, col, mat, segs = 16) {
  grid(b, 2, segs, (i, j) => { const a = j / segs * TAU; return [base[0] + Math.sin(a) * r, base[1] + i * h, base[2] + Math.cos(a) * r]; },
    { col, mat, centre: [base[0], base[1] + h / 2, base[2]], uv: (i, j) => [j / segs, i] });
}
// An ellipsoid on the axes `ax` with radii `r`, rows from the top pole to the bottom.
export function ellipsoid(b, c, ax, r, rows, cols, col, mat) {
  grid(b, rows, cols, (i, j) => {
    const th = i / (rows - 1) * Math.PI, ph = j / cols * TAU;
    const l = [Math.sin(th) * Math.sin(ph) * r[0], Math.cos(th) * r[1], Math.sin(th) * Math.cos(ph) * r[2]];
    return add(c, add(add(mul(ax[0], l[0]), mul(ax[1], l[1])), mul(ax[2], l[2])));
  }, { col, mat, centre: c });
}
// A vertical wall along a polyline, from y0 to y1, its texture running `uvU` feet a repeat.
export function strip(b, pts, y0, y1, col, mat, uvU = 8, flipN = false) {
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], c = pts[i + 1], d = len(sub(c, a));
    let n = norm(cross([0, 1, 0], sub(c, a)));
    if (flipN) n = mul(n, -1);
    quad(b, [a[0], y0, a[2]], [c[0], y0, c[2]], [c[0], y1, c[2]], [a[0], y1, a[2]], n, col, mat,
      [[acc / uvU, 1], [(acc + d) / uvU, 1], [(acc + d) / uvU, 0], [acc / uvU, 0]]);
    acc += d;
  }
}

// ── the field ───────────────────────────────────────────────────────────────
// The ground is one grid the shader paints; the mound, the rubber, the plate and the bags
// are geometry on it.
function buildField(B, outline) {
  const g = B('plain'), C = 20;
  for (let x = -520; x < 520; x += C) for (let z = -260; z < 560; z += C) {
    if (!insideOutline(outline, [x + C / 2, 0, z + C / 2], 16)) continue;
    quad(g, [x, 0, z], [x + C, 0, z], [x + C, 0, z + C], [x, 0, z + C], [0, 1, 0], WHITE, MAT.GROUND);
  }
  grid(g, 16, 48, (i, j) => {
    const r = 9.2 * Math.pow(i / 15, 0.9), a = j / 48 * TAU;
    const x = MOUND[0] + Math.sin(a) * r, z = MOUND[1] + Math.cos(a) * r;
    return [x, moundHeight(x, z), z];
  }, { col: WHITE, mat: MAT.GROUND, flip: true, uv: () => [0, 0] });
  box(g, RUBBER, [1.0, 0.04, 0.25], 0, lin('#f4f2ea'), MAT.PLATE);
  // home plate: a pentagon, its point at the origin
  const plate = [[-0.708, 0.03, 1.417], [0.708, 0.03, 1.417], [0.708, 0.03, 0.708], [0, 0.03, 0], [-0.708, 0.03, 0.708]];
  const c0 = [0, 0.03, 0.8], white = lin('#f4f2ea');
  for (let i = 0; i < 5; i++) {
    const a = plate[i], bb = plate[(i + 1) % 5];
    vtx(g, c0, [0, 1, 0], [0, 0], white, MAT.PLATE); vtx(g, bb, [0, 1, 0], [0, 0], white, MAT.PLATE); vtx(g, a, [0, 1, 0], [0, 0], white, MAT.PLATE);
  }
  for (const k of [1, 2, 3]) box(g, [BAGS[k][0], 0.14, BAGS[k][2]], [0.63, 0.14, 0.63], 45, lin('#f2f1ea'), MAT.PLATE);
}

// ── the stands ──────────────────────────────────────────────────────────────
// The lower bowl's front edge: down the first-base line, round behind the plate, up the
// third-base line.
export function bowlPath() {
  const pts = [];
  const d1 = norm([-1, 0, 1]), n1 = norm([-1, 0, -1]), d3 = norm([1, 0, 1]), n3 = norm([1, 0, -1]);
  for (let s = 318; s > 62; s -= 8) pts.push(add(mul(d1, s), mul(n1, 44)));
  for (let i = 0; i <= 40; i++) {
    const a = (-80 - 200 * i / 40) * DEG, u = i / 40, rr = 75 - 15 * Math.sin(Math.PI * u);
    pts.push([rr * Math.sin(a), 0, rr * Math.cos(a)]);
  }
  for (let s = 62; s <= 318; s += 8) pts.push(add(mul(d3, s), mul(n3, 44)));
  return pts;
}

const SHIRTS = ['#e8e6df', '#d9d6cc', '#1d2a4a', '#1f7f80', '#9a2b22', '#4f5a69', '#2e2e2e', '#5d3a24', '#3d5f8a', '#7c7c74', '#c8a446', '#2f5132', '#b5b1a5', '#a33f2a', '#16264a', '#6b2d4a'];
const SKINS = ['#e9c2a0', '#d9a77f', '#b77a52', '#8d5a3b', '#5e3a26', '#f0cdb0'];
// One crowd instance: position (3), facing (1), shirt (3), size (1), skin (3).
export const CROWD_STRIDE = 11;
// Who sits, who stands and who cheers, as cumulative shares.
const CROWD_MIX = [0.86, 0.97];
function hashStr(s) { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

// A bank of seats behind a front edge (`path`): the front wall and its parapet, then row on
// row of treads, risers, seat backs and fans, and a wall at the back. `o.crater` leaves the
// scorched hole in section nine that the booth keeps mentioning.
function stands(B, crowd, path, o) {
  const N = path.length, nrm = [];
  for (let i = 0; i < N; i++) {
    const a = path[Math.max(0, i - 1)], c = path[Math.min(N - 1, i + 1)];
    let n = norm(cross([0, 1, 0], sub(c, a)));
    const outward = o.outward ? o.outward(path[i]) : norm(sub(path[i], [0, 0, 60]));
    if (dot(n, outward) < 0) n = mul(n, -1);
    nrm.push(n);
  }
  const start = o.start || 0;
  const at = (i, off, y) => [path[i][0] + nrm[i][0] * off, y, path[i][2] + nrm[i][2] * off];
  const crater = (i, k) => o.crater && i > N * 0.79 && i < N * 0.86 && k > 3 && k < 17;
  const plain = B('plain');
  if (!o.fascia) {
    for (let i = 0; i < N - 1; i++) {
      const behind = Math.abs(Math.atan2(path[i][0], path[i][2])) > 140 * DEG;
      const key = behind && o.ads ? 'ads' : o.name === 'bleach' ? 'concrete' : 'pad';
      quad(B(key), at(i, start, 0), at(i + 1, start, 0), at(i + 1, start, o.front), at(i, start, o.front), mul(nrm[i], -1), WHITE, MAT.PAD,
        [[i / 4, 1], [(i + 1) / 4, 1], [(i + 1) / 4, 0], [i / 4, 0]]);
      // the parapet in front of the first row, so its fans don't look as if they're standing
      quad(plain, at(i, start + 0.3, o.front), at(i + 1, start + 0.3, o.front), at(i + 1, start + 0.3, o.front + 2.5), at(i, start + 0.3, o.front + 2.5), mul(nrm[i], -1), lin('#20262e'), MAT.CONCRETE);
      quad(plain, at(i, start, o.front + 2.5), at(i + 1, start, o.front + 2.5), at(i + 1, start + 0.6, o.front + 2.5), at(i, start + 0.6, o.front + 2.5), [0, 1, 0], lin('#3a4048'), MAT.METAL);
    }
  } else {
    for (let i = 0; i < N - 1; i++) {
      quad(plain, at(i, start, o.y0 - 10), at(i + 1, start, o.y0 - 10), at(i + 1, start, o.y0), at(i, start, o.y0), mul(nrm[i], -1), lin('#1c2c4e'), MAT.CONCRETE);
      quad(plain, at(i, start, o.y0 - 10), at(i + 1, start, o.y0 - 10), at(i + 1, start + 12, o.y0 - 10), at(i, start + 12, o.y0 - 10), [0, -1, 0], lin('#2a2c2f'), MAT.CONCRETE);
    }
  }
  const rr = seeded(hashStr(o.name));
  const seatBack = lin('#173446'), seatTop = lin('#132c3b');
  for (let k = 0; k < o.rows; k++) {
    const off0 = start + k * o.depth, off1 = off0 + o.depth, y = o.y0 + k * o.rise;
    // under the upper deck the rows are in its shadow
    const shade = o.name === 'lower' && off0 > 56 ? 0.45 : 1;
    const tc = [shade, shade, shade];
    for (let i = 0; i < N - 1; i++) {
      if (crater(i, k)) continue;
      const segLen = len(sub(path[i + 1], path[i]));
      quad(B('seat'), at(i, off0, y), at(i + 1, off0, y), at(i + 1, off1, y), at(i, off1, y), [0, 1, 0], tc, MAT.CONCRETE, [[0, 0], [segLen / 7.6, 0], [segLen / 7.6, 1], [0, 1]]);
      quad(B('concrete'), at(i, off1, y), at(i + 1, off1, y), at(i + 1, off1, y + o.rise), at(i, off1, y + o.rise), mul(nrm[i], -1), mul(tc, 0.8), MAT.CONCRETE, [[0, 0], [1, 0], [1, 0.3], [0, 0.3]]);
      quad(plain, at(i, off0 + 2.15, y), at(i + 1, off0 + 2.15, y), at(i + 1, off0 + 2.25, y + 2.7), at(i, off0 + 2.25, y + 2.7), mul(nrm[i], -1), mul(seatBack, shade), MAT.PAD);
      quad(plain, at(i, off0 + 1.2, y + 1.45), at(i + 1, off0 + 1.2, y + 1.45), at(i + 1, off0 + 2.15, y + 1.5), at(i, off0 + 2.15, y + 1.5), [0, 1, 0], mul(seatTop, shade), MAT.PAD);
      // fans, two feet apart along the row, in clumps, an aisle every sixth section
      const nSeat = Math.floor(segLen / 1.95), aisle = i % 6 === 0;
      for (let q = 0; q < nSeat; q++) {
        if (aisle && q < 2) continue;
        const t = (q + 0.5) / nSeat, pi = lerp3(path[i], path[i + 1], t), ni = norm(lerp3(nrm[i], nrm[i + 1], t));
        const p = [pi[0] + ni[0] * (off0 + 1.55), y, pi[2] + ni[2] * (off0 + 1.55)];
        const clump = 0.5 + 0.5 * Math.sin(p[0] * 0.031 + Math.sin(p[2] * 0.017) * 3) * Math.sin(p[2] * 0.027 + k * 0.4);
        const behindHome = Math.abs(Math.atan2(p[0], p[2])) > 135 * DEG && o.name === 'lower';
        if (rr() > (o.full ? 1.2 : (behindHome ? 0.72 : o.occ) * (0.55 + 0.9 * clump))) continue;
        const toward = sub([0, 0, 70], p), yaw = Math.atan2(toward[0], toward[2]);
        const shirt = lin(SHIRTS[Math.floor(rr() * SHIRTS.length)]), sk = lin(SKINS[Math.floor(rr() * SKINS.length)]);
        const v = rr(), list = v < CROWD_MIX[0] ? crowd.sit : v < CROWD_MIX[1] ? crowd.stand : crowd.cheer;
        list.push(p[0], p[1], p[2], yaw + (rr() - 0.5) * 0.3, shirt[0] * shade, shirt[1] * shade, shirt[2] * shade, 0.92 + rr() * 0.16, sk[0] * shade, sk[1] * shade, sk[2] * shade);
      }
    }
  }
  if (o.crater) {
    const i0 = Math.ceil(N * 0.79) + 1, i1 = Math.floor(N * 0.86);
    for (let i = i0 - 1; i < i1; i++) {
      for (let k = 3; k < 17; k++) {
        const off0 = k * o.depth, off1 = off0 + o.depth;
        const dip = Math.sin((i - i0 + 1) / (i1 - i0 + 1) * Math.PI) * Math.sin((k - 3) / 14 * Math.PI) * 9;
        const y = o.y0 + 3 * o.rise + (k - 3) * o.rise * 0.6 - dip;
        quad(plain, at(i, off0, y), at(i + 1, off0, y), at(i + 1, off1, y), at(i, off1, y), [0, 1, 0], lin('#211a15'), MAT.CONCRETE);
      }
      for (let q = 0; q < 3; q++) {
        const k = 4 + Math.floor(rr() * 12), p = at(i, k * o.depth + rr() * 2, o.y0 + k * o.rise * 0.7);
        box(B('concrete'), p, [0.8 + rr() * 2, 0.4 + rr(), 0.8 + rr() * 2], rr() * 90, lin('#6a655e'), MAT.CONCRETE);
      }
    }
  }
  const last = start + o.rows * o.depth, ytop = o.y0 + o.rows * o.rise;
  for (let i = 0; i < N - 1; i++) {
    quad(B('concrete'), at(i, last, ytop - o.rise), at(i + 1, last, ytop - o.rise), at(i + 1, last, ytop + 7), at(i, last, ytop + 7), mul(nrm[i], -1), [0.7, 0.7, 0.7], MAT.CONCRETE);
  }
}

// The distances on the wall, rounded to five feet the way a park paints them: the lines,
// the gaps and straightaway centre.
export function wallNumbers(fence) {
  const r5 = (x) => Math.round(x / 5) * 5;
  return [[-45, r5(fenceDistance(45 * DEG, fence))], [45, r5(fenceDistance(45 * DEG, fence))],
    [-22.5, r5(fenceDistance(22.5 * DEG, fence))], [22.5, r5(fenceDistance(22.5 * DEG, fence))], [0, r5(fence.centre)]];
}

// ── the park ────────────────────────────────────────────────────────────────
// Everything inside the outer wall, built from the venue. Returns the opaque batches by
// texture key, the translucent ones, the crowd's instances, the towers and the field.
//
//   opaque: plain (untextured), pad, concrete, seat, ads, nums (the wall's distances,
//           alpha-tested, one cell of a four-cell atlas each), board (the scoreboard),
//           exterior (the outer wall)
//   translucent: net (the backstop)
//   sign: the face over the main gate the park's name is painted on
export function buildPark(venue, opts = {}) {
  const field = venueField(venue);
  const outline = parkOutline(field);
  const opaque = new Map(), translucent = new Map();
  let into = opaque;
  const B = (key) => { let b = into.get(key); if (!b) { b = createBatch(); into.set(key, b); } return b; };
  const crowd = { sit: [], stand: [], cheer: [] };

  buildField(B, outline);

  const fence = field.fence;
  // the outfield wall: padded, with concrete behind
  const wall = [];
  for (let d = -45; d <= 45; d += 1) { const t = d * DEG, r = fenceDistance(t, fence); wall.push([Math.sin(t) * r, 0, Math.cos(t) * r]); }
  strip(B('pad'), wall, 0, fence.height, WHITE, MAT.PAD, 9);
  strip(B('concrete'), wall.map((p) => mul(p, 1.012)), 0, fence.height + 0.1, lin('#5c5f63'), MAT.CONCRETE, 20);
  const numbers = wallNumbers(fence), texts = [...new Set(numbers.map(([, n]) => String(n)))].slice(0, 4);
  // Each number lies flat on the wall where it's painted. ⚠ ALONG THE WALL, NOT ACROSS THE
  // BEARING: off centre the fence runs at a slant to the circle round the plate (its distance
  // changes by about 90 ft a radian in the gaps), so a plate square to the bearing sinks an end
  // a foot into the padding and the 375 reads as 75.
  const wallAt = (th) => { const r = fenceDistance(th, fence); return [Math.sin(th) * r, 0, Math.cos(th) * r]; };
  for (const [deg, n] of numbers) {
    const cell = texts.indexOf(String(n));
    if (cell < 0) continue;
    const th = deg * DEG, e = 0.25 * DEG;
    const tng = norm(sub(wallAt(th + e), wallAt(th - e)));
    const nn = norm(cross([0, 1, 0], tng)), toward = dot(nn, wallAt(th)) > 0 ? mul(nn, -1) : nn;
    const c = add(add(wallAt(th), mul(toward, 0.15)), [0, fence.height * 0.53, 0]), w = 4.2, h = 2.4, u0 = cell / 4, u1 = (cell + 1) / 4;
    const nn2 = toward;
    quad(B('nums'), madd(madd(c, tng, -w), [0, 1, 0], -h), madd(madd(c, tng, w), [0, 1, 0], -h), madd(madd(c, tng, w), [0, 1, 0], h), madd(madd(c, tng, -w), [0, 1, 0], h),
      nn2, WHITE, MAT.PAD, [[u1, 1], [u0, 1], [u0, 0], [u1, 0]]);
  }
  // the foul poles
  for (const sg of [-1, 1]) {
    const th = sg * 45 * DEG, r = fenceDistance(th, fence) + 0.6;
    cylinder(B('plain'), [Math.sin(th) * r, 0, Math.cos(th) * r], 70, 0.45, lin('#e9c418'), MAT.CONCRETE);
  }
  // the bleachers either side of the batter's eye
  for (const [a0, a1] of [[-44, -8], [8, 44]]) {
    const path = [];
    for (let d = a0; d <= a1; d += 1) { const t = d * DEG, r = fenceDistance(t, fence) + 4; path.push([Math.sin(t) * r, 0, Math.cos(t) * r]); }
    stands(B, crowd, path, { rows: 14, y0: 11, rise: 1.55, depth: 2.6, front: 11, outward: (p) => norm([p[0], 0, p[2]]), occ: 0.32, name: 'bleach', full: opts.full });
  }
  // the batter's eye, dark so the hitter can see the pitch
  const eye = [];
  for (let d = -8; d <= 8; d += 1) { const t = d * DEG, r = fenceDistance(t, fence) + 6; eye.push([Math.sin(t) * r, 0, Math.cos(t) * r]); }
  strip(B('plain'), eye, fence.height, 34, lin('#0e2a1e'), MAT.CONCRETE, 20);
  // the lower bowl, its ads behind the plate, and the upper deck over it
  const bowl = bowlPath();
  stands(B, crowd, bowl, { rows: 24, y0: 4.5, rise: 1.3, depth: 2.7, front: 4.5, occ: 0.42, name: 'lower', crater: true, ads: true, full: opts.full });
  stands(B, crowd, bowl.filter((p) => len(p) < 255), { rows: 15, y0: 54, rise: 1.95, depth: 2.6, start: 64, front: 9, occ: 0.26, name: 'upper', fascia: true, full: opts.full });
  // the backstop net, see-through
  into = translucent;
  const net = [];
  for (let a = -140; a >= -220; a -= 4) { const t = a * DEG; net.push([Math.sin(t) * 61, 0, Math.cos(t) * 61]); }
  strip(B('net'), net, 4.5, 36, WHITE, MAT.METAL, 1.2);
  into = opaque;
  // the light towers: a mast, a frame and a bank of 24 lamps, the working ones lit
  for (const T of field.towers) {
    cylinder(B('plain'), T.base, T.h - 8, 2.2, lin('#6c7076'), MAT.METAL, 12);
    const fwd = T.dir, right = norm(cross(fwd, [0, 1, 0])), up = norm(cross(right, fwd)), c = T.lamp;
    const P = (x, y, z) => add(add(add(c, mul(right, x)), mul(up, y)), mul(fwd, z));
    quad(B('plain'), P(-17, -10, -0.8), P(17, -10, -0.8), P(17, 10, -0.8), P(-17, 10, -0.8), mul(fwd, -1), lin('#3a3d42'), MAT.METAL);
    for (let r = 0; r < 4; r++) for (let q = 0; q < 6; q++) {
      const lc = add(add(c, mul(right, (q - 2.5) * 5.4)), mul(up, (r - 1.5) * 4.8)), live = T.live[r * 6 + q];
      grid(B('plain'), 2, 12, (i, j) => { const a = j / 12 * TAU; return add(add(lc, add(mul(right, Math.sin(a) * 1.9), mul(up, Math.cos(a) * 1.9))), mul(fwd, -0.7 + i * 0.9)); },
        { col: lin('#2a2c30'), mat: MAT.METAL, centre: lc });
      grid(B('plain'), 3, 12, (i, j) => { const a = j / 12 * TAU, rr = 1.6 * i / 2; return add(add(lc, add(mul(right, Math.sin(a) * rr), mul(up, Math.cos(a) * rr))), mul(fwd, 0.25)); },
        { col: live ? [26, 25, 22] : lin('#1a1b1d'), mat: live ? MAT.EMISSIVE : MAT.METAL, centre: madd(lc, fwd, -5) });
    }
  }
  // the scoreboard, behind right-centre: a face of lamps on a dark frame, on two legs
  const board = boardFrame(field);
  {
    const { c, n, t, w, h, yaw } = board;
    const P = (a, b) => add(add(c, mul(t, a)), [0, b, 0]);
    quad(B('board'), P(-w, -h), P(w, -h), P(w, h), P(-w, h), n, WHITE, MAT.BOARD, [[0, 1], [1, 1], [1, 0], [0, 0]]);
    box(B('plain'), madd(c, n, -2.5), [w + 3, h + 3, 2], yaw, lin('#1d1f22'), MAT.CONCRETE);
    for (const a of [-40, 40]) box(B('plain'), madd(add(add([c[0], 0, c[2]], mul(t, a)), [0, 22.5, 0]), n, -2.5), [2, 22.5, 2], yaw, lin('#55585c'), MAT.METAL);
  }
  // the outer wall, the flags along the grandstand, and the sign for the park's name
  const sign = buildExterior(B, outline);
  return { opaque, translucent, sign, crowd: { sit: new Float32Array(crowd.sit), stand: new Float32Array(crowd.stand), cheer: new Float32Array(crowd.cheer) },
    field, outline, numbers: texts, board };
}

// ── the outer wall ──────────────────────────────────────────────────────────
// Brick along the outline in the manner of the city ballparks of the early 1990s: 94 ft round
// the grandstand, 48 along the lines, 42 round the outfield and 36 behind the batter's eye. The
// heights follow parkOutline's own shape (diamond/geo.js): `s` runs along a foul line and `d`
// off it into foul ground.
export const EXTERIOR_H = Object.freeze({ stand: 94, line: 48, outfield: 42, eye: 36 });
export function exteriorHeight(p) {
  const r = Math.hypot(p[0], p[2]), th = Math.atan2(p[0], p[2]);
  const s = (Math.abs(p[0]) + p[2]) / Math.SQRT2, d = (Math.abs(p[0]) - p[2]) / Math.SQRT2;
  if (Math.abs(th) <= 45 * DEG && r > 300) return Math.abs(th) < 8 * DEG ? EXTERIOR_H.eye : EXTERIOR_H.outfield;
  if (d > 130 || r < 200 || (s < 252 && d > 100)) return EXTERIOR_H.stand;
  return EXTERIOR_H.line;
}
// The sign over the main gate behind home plate: its middle, half-width and half-height.
export const PARK_SIGN = Object.freeze({ c: [0, 63, -197.5], w: 66, h: 8.5 });
// One face a segment of the outline, facing out. The shader (EXTERIOR) paints the piers, the
// arcade, the club level's windows and the steel tier from feet along (uv.x) and feet up (uv.y),
// with the wall's height in the colour, and paints the back plain. A coping on top gives the
// wall its thickness from above. Returns the sign's own batch, which the renderer draws once the
// venue's name is painted for it.
function buildExterior(B, outline) {
  const O = outline;
  let area = 0;
  for (let i = 0; i < O.length; i++) { const a = O[i], b = O[(i + 1) % O.length]; area += a[0] * b[2] - b[0] * a[2]; }
  const sg = area > 0 ? 1 : -1;
  let u = 0;
  for (let i = 0; i < O.length; i++) {
    const a = O[i], c = O[(i + 1) % O.length], L = Math.hypot(c[0] - a[0], c[2] - a[2]);
    if (L < 0.01) continue;
    const ha = exteriorHeight(a), hc = exteriorHeight(c), hm = exteriorHeight([(a[0] + c[0]) / 2, 0, (a[2] + c[2]) / 2]);
    const H = Math.min(ha, hc, hm) === EXTERIOR_H.stand ? EXTERIOR_H.stand : Math.max(Math.min(ha, hc), Math.min(hm, EXTERIOR_H.line));
    const dx = (c[0] - a[0]) / L, dz = (c[2] - a[2]) / L, n = [sg * dz, 0, -sg * dx];
    quad(B('exterior'), [a[0], 0, a[2]], [c[0], 0, c[2]], [c[0], H, c[2]], [a[0], H, a[2]], n, [0.4, H / 100, H < 45 ? 1 : 0], MAT.EXTERIOR,
      [[u, 0], [u + L, 0], [u + L, H], [u, H]]);
    const t = 2.5;
    quad(B('plain'), [a[0], H, a[2]], [c[0], H, c[2]], [c[0] - n[0] * t, H, c[2] - n[2] * t], [a[0] - n[0] * t, H, a[2] - n[2] * t], [0, 1, 0], lin('#6b6152'), MAT.CONCRETE);
    u += L;
  }
  // flagpoles along the top of the grandstand, and their flags
  const FLAGS = ['#16264a', '#1d8a8c', '#f2f0e8', '#b04a1c'].map(lin);
  for (let k = -6; k <= 6; k++) {
    const th = (180 + k * 9) * DEG, p = [Math.sin(th) * 189, EXTERIOR_H.stand, Math.cos(th) * 189], tg = [Math.cos(th), 0, -Math.sin(th)];
    cylinder(B('plain'), p, 26, 0.35, lin('#d9d9d4'), MAT.METAL, 6);
    quad(B('plain'), add(p, [0, 19, 0]), add(madd(p, tg, 9), [0, 19.5, 0]), add(madd(p, tg, 9), [0, 25.5, 0]), add(p, [0, 25.6, 0]), [Math.sin(th), 0, Math.cos(th)], FLAGS[(k + 8) % 4], MAT.PAD);
  }
  // the sign: a lit face, the name painted on it, readable from outside the gate
  const sign = createBatch(16), { c, w, h } = PARK_SIGN;
  quad(sign, [c[0] + w, c[1] - h, c[2]], [c[0] - w, c[1] - h, c[2]], [c[0] - w, c[1] + h, c[2]], [c[0] + w, c[1] + h, c[2]], [0, 0, -1], WHITE, MAT.EMISSIVE,
    [[0, 1], [1, 1], [1, 0], [0, 0]]);
  return sign;
}

// Where the scoreboard hangs and which way it faces: centre, normal (toward the plate),
// the face's horizontal axis, half-width and half-height, and its yaw in degrees.
export function boardFrame(field) {
  const th = field.board.bearing * DEG, R = field.board.r;
  const c = [Math.sin(th) * R, 66, Math.cos(th) * R], n = norm([-c[0], 0, -c[2]]);
  return { c, n, t: norm(cross([0, 1, 0], n)), w: 62, h: 21, yaw: Math.atan2(n[0], n[2]) / DEG + 180 };
}

// ── the crowd's figures ─────────────────────────────────────────────────────
// One figure a kind, instanced over the crowd's positions: 7 floats a vertex, position (3),
// normal (3) and the part (0 skin, 1 shirt, 2 trousers, 3 hair, 4 a rally towel). `far` is
// the coarse level, about half the triangles, for a crowd seen from the broadcast cameras.
export function crowdMesh(kind, { towels = false, far = false } = {}) {
  const ER = far ? 4 : 6, EC = far ? 6 : 10, TC = far ? 4 : 6;
  const out = [];
  const push = (p, n, part) => out.push(p[0], p[1], p[2], n[0], n[1], n[2], part);
  const ell = (c, r, part, rows = ER, cols = EC, vmax = 1) => {
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      const P = (ii, jj) => {
        const th = vmax * ii / rows * Math.PI, ph = jj / cols * TAU;
        const l = [Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph)];
        return [[c[0] + l[0] * r[0], c[1] + l[1] * r[1], c[2] + l[2] * r[2]], norm([l[0] / r[0], l[1] / r[1], l[2] / r[2]])];
      };
      const a = P(i, j), b = P(i, j + 1), cc = P(i + 1, j + 1), d = P(i + 1, j);
      for (const q of [a, b, cc, a, cc, d]) push(q[0], q[1], part);
    }
  };
  const tube = (a, b, r0, r1, part, cols = TC) => {
    const t = norm(sub(b, a)), x = norm(cross(t, Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), z = cross(x, t);
    for (let j = 0; j < cols; j++) {
      const P = (s, jj) => { const ang = jj / cols * TAU, n = add(mul(x, Math.cos(ang)), mul(z, Math.sin(ang))); return [add(s ? b : a, mul(n, s ? r1 : r0)), n]; };
      const q0 = P(0, j), q1 = P(0, j + 1), q2 = P(1, j + 1), q3 = P(1, j);
      for (const q of [q0, q1, q2, q0, q2, q3]) push(q[0], q[1], part);
    }
  };
  if (kind === 'sit') {
    ell([0, 2.42, -0.12], [0.39, 0.88, 0.29], 1);
    ell([0, 3.78, -0.05], [0.27, 0.32, 0.29], 0); ell([0, 3.86, -0.09], [0.285, 0.3, 0.3], 3, Math.ceil(ER * 2 / 3), EC, 0.5);
    for (const sg of [-1, 1]) {
      tube([sg * 0.22, 1.62, -0.05], [sg * 0.25, 1.66, 0.95], 0.23, 0.19, 2); tube([sg * 0.25, 1.66, 0.95], [sg * 0.25, 0.3, 1.1], 0.16, 0.12, 2);
      tube([sg * 0.46, 3.15, -0.08], [sg * 0.52, 2.3, 0.18], 0.14, 0.12, 1); tube([sg * 0.52, 2.3, 0.18], [sg * 0.24, 1.95, 0.75], 0.1, 0.08, 0);
    }
  } else {
    ell([0, 3.95, 0], [0.34, 1.0, 0.25], 1);
    ell([0, 5.42, 0.04], [0.27, 0.32, 0.29], 0); ell([0, 5.5, 0.0], [0.285, 0.3, 0.3], 3, Math.ceil(ER * 2 / 3), EC, 0.5);
    for (const sg of [-1, 1]) {
      tube([sg * 0.22, 3.1, 0], [sg * 0.24, 1.6, 0.05], 0.2, 0.16, 2); tube([sg * 0.24, 1.6, 0.05], [sg * 0.25, 0.1, 0], 0.15, 0.11, 2);
      if (kind === 'stand') { tube([sg * 0.45, 4.75, 0], [sg * 0.55, 3.8, 0.05], 0.12, 0.1, 1); tube([sg * 0.55, 3.8, 0.05], [sg * 0.5, 2.95, 0.25], 0.09, 0.07, 0); }
      else { tube([sg * 0.45, 4.75, 0], [sg * 0.75, 5.6, 0.1], 0.12, 0.1, 1); tube([sg * 0.75, 5.6, 0.1], [sg * 0.6, 6.5, 0.15], 0.09, 0.07, 0); }
    }
    if (kind === 'cheer' && towels) {
      // a rally towel in the right hand, caught mid-wave, both faces
      const q = (a, b, c2, d) => { const n = norm(cross(sub(b, a), sub(d, a))); for (const p of [a, b, c2, a, c2, d]) push(p, n, 4); for (const p of [a, c2, b, a, d, c2]) push(p, mul(n, -1), 4); };
      q([0.62, 6.45, 0.14], [1.55, 6.75, 0.0], [1.6, 7.75, -0.05], [0.58, 7.5, 0.1]);
    }
  }
  return new Float32Array(out);
}
export const CROWD_VERTEX = 7;
