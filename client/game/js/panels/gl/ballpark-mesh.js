// GLASS 2 · THE BALLPARK'S GEOMETRY, AS TRIANGLES.
//
// Deadball's park in 3-D (the Grandstand, gameday-grandstand.js): the field, the outfield
// wall with its distances, the foul poles, the bleachers and the batter's eye, the lower
// bowl and the upper deck with every row of seats, the backstop net and the scoreboard, all
// built from the venue (sports_pools.venue, with diamond/geo.js filling in what a venue leaves
// out); and round it the Charles B. Hughson Coliseum as the map has it (buildBowl): the art deco
// bowl, its four corner light towers, its gates and the Hughson Dome over it.
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
//   EXTERIOR  the bowl's wall between the fins, limestone with a concourse window in a bronze
//             frame in every bay, painted in the shader from feet along and feet up (uv); on the
//             outfield faces the window's glass is a hole, and its bronze is geometry
//   DECO, GILT  the rest of the bowl's outside: its stone, and its bronze, gilt and copper
//   GLAZE     glass lit from inside: the clerestory and the roof's glazing when it's shut (uv.x
//             0), the towers' slits and the concourse's lamps every night (uv.x 1); and the
//             outfield windows' clear glass, translucent, which lights nothing (uv.x 2)
//   PLAQUE    the plates over the gates, painted (ballpark.js paintPlates); the name cut in the
//             band beside them is DECO from the same atlas
//   FACADE, STREET, POOL  the city round the park (gl/cityscape.js): facades and streets
//             painted from their coordinates, and the pool of light under a street lamp
//
// Feet, home plate at the origin, +z out to centre field, +x toward third base, y up.
//
// ⚠ NO FACE CULLING, as in arena.js: the builders don't keep one winding.

import { DEG, BAGS, MOUND, RUBBER, FOUL_GROUND, DUGOUT, offLine, moundHeight, venueField, fenceDistance, parkOutline, insideOutline, seeded, BOWL, sf, sOf, fromBlock, ftUp } from '../diamond/geo.js';
import { FT_M } from '../../../../shared/world-scale.js';
import { WIN_OPEN, sunburst, headPanels, wallRects } from '../glass/coliseum-window.js';
import { actorPoseMesh } from '../actor3d.js';
import {
  BACK, BAND, BGATE, DECK, DOME, FIN_AT, GATE, GIRDER, GUARD, LANTERN, OUT, POLES, SHELLS, SIDE_GATES, TOWER, UNIT_FT, Z,
  FIXED_END, archOf, isFan, rail, shellArch, shellAt, shellProfile, sillZ, springZ,
} from '../../../../shared/coliseum-plan.js';

export const STRIDE = 12;
export const MAT = Object.freeze({
  GROUND: 0, CLOTH: 1, SKIN: 2, LEATHER: 3, GLOSS: 4, SATIN: 5, METAL: 6, EMISSIVE: 7,
  CONCRETE: 8, PAD: 9, BOARD: 10, PLATE: 11, MATTE: 13,
  // the ball, its colour the point on it before its spin (gl/ballpark.js setBall), so the shader
  // can draw its seams where they are on the ball
  BALL: 14,
  // a player's head (gl/ballplayer-mesh.js): the face, the ears, the hair and the neck
  HEAD: 20, EAR: 21, HAIR: 22, NECK: 23,
  // the bowl (buildBowl): its wall between the fins, painted with the concourse windows; the rest
  // of its stone; its bronze, gilt and copper; glass lit from inside; and the name plate
  EXTERIOR: 24, DECO: 25, GILT: 26, GLAZE: 27, PLAQUE: 28,
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

// A rod of radius r from A to B, four-sided: a rope.
export function rod(b, A, B, r, col, mat) {
  const d = norm(sub(B, A)), e1 = norm(cross(d, Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), e2 = cross(d, e1);
  const off = (k) => { const a = (k + 0.5) * TAU / 4; return add(mul(e1, r * Math.cos(a)), mul(e2, r * Math.sin(a))); };
  for (let k = 0; k < 4; k++) {
    const p = off(k), q = off(k + 1), n = norm(add(p, q));
    quad(b, add(A, p), add(A, q), add(B, q), add(B, p), n, col, mat);
  }
}

// ── the grounds crew's mats ────────────────────────────────────────────────
// A drag mat (diamond/crew.js matAt) into batch `b`: steel mesh lying on the dirt, the pipe across
// its front, and a rope from each end of the pipe up over the right shoulder of the man pulling
// that side to his hands. `men` are [{ side (+1 the mat's right), shoulder, hands }], points in
// the park; a man with no shoulder (his pose not in yet) has his rope straight to his hands.
const MAT_LOOK = Object.freeze({ mesh: '#4a4d50', pipe: '#5d6266', rope: '#a8916a', thick: 0.05, ropeR: 0.035 });
export function dragMat(b, m, men = []) {
  const yaw = m.yaw * DEG, u = [Math.sin(yaw), 0, Math.cos(yaw)], n = [-u[2], 0, u[0]], L = MAT_LOOK;
  box(b, [m.at[0], L.thick / 2, m.at[2]], [m.w / 2, L.thick / 2, m.l / 2], m.yaw, lin(L.mesh), MAT.MATTE);
  const front = madd(m.at, u, m.l / 2);
  box(b, [front[0], 0.08, front[2]], [m.w / 2 + 0.1, 0.06, 0.06], m.yaw, lin(L.pipe), MAT.METAL);
  for (const man of men) {
    const end = madd(front, n, (man.side * m.w) / 2);
    const from = [end[0], 0.1, end[2]];
    if (man.shoulder) { rod(b, from, man.shoulder, L.ropeR, lin(L.rope), MAT.CLOTH); rod(b, man.shoulder, man.hands, L.ropeR, lin(L.rope), MAT.CLOTH); }
    else rod(b, from, man.hands, L.ropeR, lin(L.rope), MAT.CLOTH);
  }
}

// ── the field ───────────────────────────────────────────────────────────────
// The ground is one grid the shader paints; the mound, the rubber, the plate and the bags
// are geometry on it.
function buildField(B, outline) {
  const g = B('plain'), C = 20;
  // over the outline's extent: the bowl's far corner is past centre field
  const x0 = Math.floor(Math.min(...outline.map((p) => p[0])) / C) * C, x1 = Math.max(...outline.map((p) => p[0]));
  const z0 = Math.floor(Math.min(...outline.map((p) => p[2])) / C) * C, z1 = Math.max(...outline.map((p) => p[2]));
  for (let x = x0; x < x1; x += C) for (let z = z0; z < z1; z += C) {
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
// Each point up a line inside a dugout (geo.js DUGOUT) carries `raise`, the lift of the rows over
// it, and each end of a dugout is two points in the same place, one lifted and one not, so the
// rows step up there in a wall rather than a slope.
// `flat` false keeps the old round back: the upper deck stays on it, clear of the broadcast's high
// cameras behind the plate, while the lower bowl comes in to the straight backstop.
function bowlPath(flat = true) {
  const pts = [];
  const d1 = norm([-1, 0, 1]), n1 = norm([-1, 0, -1]), d3 = norm([1, 0, 1]), n3 = norm([1, 0, -1]);
  const inside = (s) => s >= DUGOUT.from - 1e-6 && s <= DUGOUT.to + 1e-6, edge = (s) => Math.abs(s - DUGOUT.from) < 1e-6 || Math.abs(s - DUGOUT.to) < 1e-6;
  const up = (d, n, s, entering) => {
    const p = add(mul(d, s), mul(n, FOUL_GROUND.line));
    if (!edge(s)) { if (inside(s)) p.raise = DUGOUT.raise; pts.push(p); return; }
    const a = p.slice(), b = p.slice();
    (entering ? b : a).raise = DUGOUT.raise;
    pts.push(a, b);
  };
  for (let s = 318; s > 62; s -= 8) up(d1, n1, s, Math.abs(s - DUGOUT.to) < 1e-6);
  // round behind the plate the bowl's curve, cut off by a straight backstop FOUL_GROUND.back behind
  // it, so the middle rows come in close rather than bowing away round a circle
  for (let i = 0; i <= 40; i++) {
    const a = (-80 - 200 * i / 40) * DEG, u = i / 40, off = Math.cos(a + Math.PI);
    const rr = Math.min(75 - 15 * Math.sin(Math.PI * u), flat && off > 0.05 ? FOUL_GROUND.back / off : Infinity);
    pts.push([rr * Math.sin(a), 0, rr * Math.cos(a)]);
  }
  for (let s = 62; s <= 318; s += 8) up(d3, n3, s, Math.abs(s - DUGOUT.from) < 1e-6);
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
  // The lower bowl's rows over a dugout (bowlPath `raise`): lifted whole over the recess, the first
  // RAISED rows, eased back to where they'd be over the next EASE, so the recess under them stands
  // at field level and the bowl behind is as it was.
  const RAISED = Math.ceil(DUGOUT.deep / (o.depth || 1)), EASE = 6;
  const liftOf = (i, k) => {
    const r = o.name === 'lower' ? path[i].raise || 0 : 0;
    if (!r) return 0;
    if (k < RAISED) return r;
    const t = Math.min(1, (k - RAISED + 1) / EASE);
    return r * (1 - t * t * (3 - 2 * t));
  };
  const crater = (i, k) => o.crater && i > N * 0.79 && i < N * 0.86 && k > 3 && k < 17;
  // The Diamond Club (`o.club`): the first rows round behind the plate, `arc` degrees either side,
  // sunk to field level against the backstop wall with nothing in front of them. Its segments take
  // none of the bowl's front wall or its first `rows` rows (clubRows draws them).
  const C = o.club;
  const clubSeg = (i) => !!C && [path[i], path[i + 1]].every((p) => Math.abs(Math.atan2(p[0], p[2])) > (180 - C.arc) * DEG);
  const plain = B('plain');
  if (C) clubRows(plain, crowd, path, nrm, clubSeg, o);
  if (!o.fascia) {
    for (let i = 0; i < N - 1; i++) {
      if (clubSeg(i)) continue;
      const behind = Math.abs(Math.atan2(path[i][0], path[i][2])) > 140 * DEG;
      const key = behind && o.ads ? 'ads' : o.name === 'bleach' ? 'concrete' : 'pad';
      const l0 = liftOf(i, 0), l1 = liftOf(i + 1, 0);
      // over a dugout the front is its open mouth, so no wall
      if (!(l0 > 0 && l1 > 0)) {
        quad(B(key), at(i, start, 0), at(i + 1, start, 0), at(i + 1, start, o.front), at(i, start, o.front), mul(nrm[i], -1), WHITE, MAT.PAD,
          [[i / 4, 1], [(i + 1) / 4, 1], [(i + 1) / 4, 0], [i / 4, 0]]);
      }
      // the parapet in front of the first row, so its fans don't look as if they're standing
      quad(plain, at(i, start + 0.3, o.front + l0), at(i + 1, start + 0.3, o.front + l1), at(i + 1, start + 0.3, o.front + 2.5 + l1), at(i, start + 0.3, o.front + 2.5 + l0), mul(nrm[i], -1), lin('#20262e'), MAT.CONCRETE);
      quad(plain, at(i, start, o.front + 2.5 + l0), at(i + 1, start, o.front + 2.5 + l1), at(i + 1, start + 0.6, o.front + 2.5 + l1), at(i, start + 0.6, o.front + 2.5 + l0), [0, 1, 0], lin('#3a4048'), MAT.METAL);
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
      if (crater(i, k) || (C && k < C.rows && clubSeg(i))) continue;
      const segLen = len(sub(path[i + 1], path[i]));
      // each end of the row at its own lift (liftOf): across a dugout's end, where the two points
      // stand in one place, these are its wall
      const ya = y + liftOf(i, k), yb = y + liftOf(i + 1, k), yn = y + o.rise + liftOf(i, k + 1), ym = y + o.rise + liftOf(i + 1, k + 1);
      quad(B('seat'), at(i, off0, ya), at(i + 1, off0, yb), at(i + 1, off1, yb), at(i, off1, ya), [0, 1, 0], tc, MAT.CONCRETE, [[0, 0], [segLen / 7.6, 0], [segLen / 7.6, 1], [0, 1]]);
      quad(B('concrete'), at(i, off1, ya), at(i + 1, off1, yb), at(i + 1, off1, ym), at(i, off1, yn), mul(nrm[i], -1), mul(tc, 0.8), MAT.CONCRETE, [[0, 0], [1, 0], [1, 0.3], [0, 0.3]]);
      quad(plain, at(i, off0 + 2.15, ya), at(i + 1, off0 + 2.15, yb), at(i + 1, off0 + 2.25, yb + 2.7), at(i, off0 + 2.25, ya + 2.7), mul(nrm[i], -1), mul(seatBack, shade), MAT.PAD);
      quad(plain, at(i, off0 + 1.2, ya + 1.45), at(i + 1, off0 + 1.2, yb + 1.45), at(i + 1, off0 + 2.15, yb + 1.5), at(i, off0 + 2.15, ya + 1.5), [0, 1, 0], mul(seatTop, shade), MAT.PAD);
      // the side of a dugout's lifted rows where they step down at its end
      if (Math.abs(ya - yb) > 1e-3 && segLen < 0.01) {
        // facing away from the lifted side, along the bowl's front
        const tg = norm(sub(path[Math.min(N - 1, i + 2)], path[Math.max(0, i - 1)])), wn = ya < yb ? mul(tg, -1) : tg;
        quad(B('concrete'), at(i, off0, Math.min(ya, yb)), at(i, off1, Math.min(ya, yb)), at(i, off1, Math.max(ya, yb)), at(i, off0, Math.max(ya, yb)), wn, mul(tc, 0.7), MAT.CONCRETE);
      }
      // fans, two feet apart along the row, in clumps, an aisle every sixth section
      const nSeat = Math.floor(segLen / 1.95), aisle = i % 6 === 0;
      for (let q = 0; q < nSeat; q++) {
        if (aisle && q < 2) continue;
        const t = (q + 0.5) / nSeat, pi = lerp3(path[i], path[i + 1], t), ni = norm(lerp3(nrm[i], nrm[i + 1], t));
        const p = [pi[0] + ni[0] * (off0 + 1.55), ya + (yb - ya) * t, pi[2] + ni[2] * (off0 + 1.55)];
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

// The Diamond Club's rows (stands `o.club`), on the bowl's own path and row depths so the bowl's
// next row starts where its back wall stops: a mahogany front wall `wall` feet high with a brass
// rail, carpeted treads stepping `rise` a row from `y0`, wide oxblood leather armchairs three feet
// apart, and a panelled back wall up to the bowl with a warm lamp strip along it. Its fans dress
// for it. The seats' eye (zone_hughson_stands, section `diamond`) is the front row's.
const CLUB_LOOK = Object.freeze({ wood: '#4a2416', carpet: '#3a1418', leather: '#7a1620', brass: '#c8a446', pitch: 3.1 });
const CLUB_SHIRTS = ['#1d2a4a', '#2e2e2e', '#e8e6df', '#16264a', '#4f5a69', '#f2f0e6'];
function clubRows(plain, crowd, path, nrm, clubSeg, o) {
  const C = o.club, L = CLUB_LOOK, N = path.length;
  const wood = lin(L.wood), carpet = lin(L.carpet), leather = lin(L.leather), brass = lin(L.brass);
  const rr = seeded(hashStr('club'));
  const yBowl = o.y0 + C.rows * o.rise, back = C.rows * o.depth;
  for (let i = 0; i < N - 1; i++) {
    if (!clubSeg(i)) continue;
    const at = (t, off, y) => { const p = lerp3(path[i], path[i + 1], t), n = norm(lerp3(nrm[i], nrm[i + 1], t)); return [p[0] + n[0] * off, y, p[2] + n[2] * off]; };
    const fwd = mul(nrm[i], -1), segLen = len(sub(path[i + 1], path[i]));
    // the front wall, its cap and the brass rail on posts along it
    quad(plain, at(0, 0, 0), at(1, 0, 0), at(1, 0, C.wall), at(0, 0, C.wall), fwd, wood, MAT.SATIN);
    quad(plain, at(0, 0, C.wall), at(1, 0, C.wall), at(1, 0.5, C.wall), at(0, 0.5, C.wall), [0, 1, 0], mul(wood, 0.8), MAT.SATIN);
    quad(plain, at(0, 0.25, C.wall + 0.85), at(1, 0.25, C.wall + 0.85), at(1, 0.25, C.wall + 1.0), at(0, 0.25, C.wall + 1.0), fwd, brass, MAT.METAL);
    rod(plain, at(0, 0.25, C.wall), at(0, 0.25, C.wall + 0.9), 0.06, brass, MAT.METAL);
    for (let k = 0; k < C.rows; k++) {
      const off0 = k * o.depth, off1 = off0 + o.depth, y = C.y0 + k * C.rise;
      quad(plain, at(0, off0, y), at(1, off0, y), at(1, off1, y), at(0, off1, y), [0, 1, 0], carpet, MAT.MATTE);
      if (k < C.rows - 1) quad(plain, at(0, off1, y), at(1, off1, y), at(1, off1, y + C.rise), at(0, off1, y + C.rise), fwd, wood, MAT.SATIN);
      // the armchairs, each facing the field, and who's in them
      const nSeat = Math.max(1, Math.floor(segLen / L.pitch));
      for (let q = 0; q < nSeat; q++) {
        const t = (q + 0.5) / nSeat, n = norm(lerp3(nrm[i], nrm[i + 1], t)), yaw = Math.atan2(-n[0], -n[2]) / DEG;
        const p = at(t, off0 + 1.55, y), bk = at(t, off0 + 2.35, y);
        box(plain, [p[0], y + 1.2, p[2]], [1.15, 0.25, 0.85], yaw, leather, MAT.LEATHER);
        box(plain, [bk[0], y + 2.35, bk[2]], [1.15, 0.95, 0.18], yaw, mul(leather, 0.85), MAT.LEATHER);
        for (const s of [-1, 1]) {
          const side = madd(p, norm(cross([0, 1, 0], n)), s * 1.3);
          box(plain, [side[0], y + 1.75, side[2]], [0.13, 0.3, 0.8], yaw, wood, MAT.SATIN);
          box(plain, [side[0], y + 2.07, side[2]], [0.15, 0.03, 0.82], yaw, brass, MAT.METAL);
        }
        if (rr() > (o.full ? 1.2 : C.occ)) continue;
        const toward = sub([0, 0, 70], p), fy = Math.atan2(toward[0], toward[2]);
        const shirt = lin(CLUB_SHIRTS[Math.floor(rr() * CLUB_SHIRTS.length)]), sk = lin(SKINS[Math.floor(rr() * SKINS.length)]);
        (rr() < 0.92 ? crowd.sit : crowd.stand).push(p[0], y, p[2], fy + (rr() - 0.5) * 0.2, shirt[0], shirt[1], shirt[2], 0.94 + rr() * 0.12, sk[0], sk[1], sk[2]);
      }
    }
    // the back wall, panelled up to the bowl's next row, and the lamps along under its lip
    const yb = C.y0 + (C.rows - 1) * C.rise;
    quad(plain, at(0, back, yb), at(1, back, yb), at(1, back, yBowl), at(0, back, yBowl), fwd, wood, MAT.SATIN);
    quad(plain, at(0, back - 0.05, yBowl - 0.9), at(1, back - 0.05, yBowl - 0.9), at(1, back - 0.05, yBowl - 0.6), at(0, back - 0.05, yBowl - 0.6), fwd, [1.4, 1.1, 0.75], MAT.EMISSIVE);
    quad(plain, at(0, back - 0.2, yBowl - 0.3), at(1, back - 0.2, yBowl - 0.3), at(1, back - 0.2, yBowl), at(0, back - 0.2, yBowl), fwd, brass, MAT.METAL);
  }
}

// The dugouts (geo.js DUGOUT): under the lifted rows of each line, a recess at field level with
// its roof, its back and end walls, a bench along the back, a water cooler, and a strip of lamps
// under the roof's lip. The floor is the ground, which the shader paints as concrete outside the
// field, and the mouth is open: the men walk in and out across it (bases.js dugoutSpot). `front` is
// the lower bowl's front wall height.
function dugouts(B, front) {
  const plain = B('plain'), conc = B('concrete'), D = DUGOUT, line = FOUL_GROUND.line;
  const roof = front + D.raise - 0.05;
  for (const side of [-1, 1]) {
    const P = (s, off, y) => { const p = offLine(side, s, line + off); return [p[0], y, p[2]]; };
    const along = norm(sub(offLine(side, 1, 0), offLine(side, 0, 0))), out = norm(sub(offLine(side, 0, 1), offLine(side, 0, 0)));
    const toField = mul(out, -1), s0 = D.from, s1 = D.to, deep = D.deep;
    // the roof, seen from below, and its lip at the mouth
    quad(conc, P(s0, 0, roof), P(s1, 0, roof), P(s1, deep, roof), P(s0, deep, roof), [0, -1, 0], lin('#2b2f35'), MAT.CONCRETE);
    quad(plain, P(s0, -0.2, roof - 0.6), P(s1, -0.2, roof - 0.6), P(s1, -0.2, roof + 0.05), P(s0, -0.2, roof + 0.05), toField, lin('#1d2a44'), MAT.PAD);
    // the lamps along under the lip, warm
    quad(plain, P(s0 + 1, 0.4, roof - 0.62), P(s1 - 1, 0.4, roof - 0.62), P(s1 - 1, 0.9, roof - 0.62), P(s0 + 1, 0.9, roof - 0.62), [0, -1, 0], [1.4, 1.1, 0.75], MAT.EMISSIVE);
    // the back wall, padded, and the end walls
    quad(plain, P(s0, deep, 0), P(s1, deep, 0), P(s1, deep, roof), P(s0, deep, roof), toField, lin('#1d2a44'), MAT.PAD);
    quad(conc, P(s0, -0.3, 0), P(s0, deep, 0), P(s0, deep, roof + 0.05), P(s0, -0.3, roof + 0.05), along, lin('#34383e'), MAT.CONCRETE);
    quad(conc, P(s1, -0.3, 0), P(s1, deep, 0), P(s1, deep, roof + 0.05), P(s1, -0.3, roof + 0.05), mul(along, -1), lin('#34383e'), MAT.CONCRETE);
    // the bench along the back, its seat and its front
    const bs0 = s0 + 1.5, bs1 = s1 - 4, b0 = deep - 1.7, b1 = deep - 0.2, wood = lin('#6b4a2e');
    quad(plain, P(bs0, b0, 1.55), P(bs1, b0, 1.55), P(bs1, b1, 1.55), P(bs0, b1, 1.55), [0, 1, 0], wood, MAT.MATTE);
    quad(plain, P(bs0, b0, 0), P(bs1, b0, 0), P(bs1, b0, 1.55), P(bs0, b0, 1.55), toField, mul(wood, 0.55), MAT.MATTE);
    // the water cooler at the far end, on its stand
    const cool = P(s1 - 2, deep - 1.1, 0), yaw = side > 0 ? -45 : -135;
    box(plain, [cool[0], 1.1, cool[2]], [0.9, 1.1, 0.7], yaw, lin('#3a3f46'), MAT.METAL);
    box(plain, [cool[0], 2.75, cool[2]], [0.62, 0.55, 0.62], yaw, lin('#e2731f'), MAT.GLOSS);
  }
}

// The distances on the wall, rounded to five feet the way a park paints them: the lines,
// the gaps and straightaway centre.
function wallNumbers(fence) {
  const r5 = (x) => Math.round(x / 5) * 5;
  return [[-45, r5(fenceDistance(45 * DEG, fence))], [45, r5(fenceDistance(45 * DEG, fence))],
    [-22.5, r5(fenceDistance(22.5 * DEG, fence))], [22.5, r5(fenceDistance(22.5 * DEG, fence))], [0, r5(fence.centre)]];
}

// ── the park ────────────────────────────────────────────────────────────────
// Everything inside the outer wall, built from the venue, and the bowl round it. Returns the
// opaque batches by texture key, the translucent ones, the crowd's instances and the field.
//
//   opaque: plain (untextured), pad, concrete, seat, ads, nums (the wall's distances,
//           alpha-tested, one cell of a four-cell atlas each), board (the scoreboard),
//           exterior (the bowl's wall between the fins)
//   translucent: net (the backstop)
//   sign: the plates over the two gates and the name cut in the band beside them, painted (PLATE_ATLAS)
//   lamps: what burns on its own, each lit by the renderer as the hour and the roof have it:
//          tower (the towers' floods), deck (the rows under the decks), beacon, lantern, halo
//   roof: [{ batch, fixed, i }], a shell of the dome each, built shut and drawn at shellShift
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
  // the outfield's advertising: a panel on the padding between each pair of distance numbers,
  // clear of the batter's eye, each one of the ad strip's four cells (the renderer's `ads`, the
  // same atlas as the strip behind the plate), laid along the wall as the numbers are
  [[-33.5, 0], [-12, 1], [12, 2], [33.5, 3]].forEach(([deg, cell]) => {
    const th = deg * DEG, e = 0.25 * DEG;
    const tng = norm(sub(wallAt(th + e), wallAt(th - e)));
    const nn = norm(cross([0, 1, 0], tng)), toward = dot(nn, wallAt(th)) > 0 ? mul(nn, -1) : nn;
    const c = add(add(wallAt(th), mul(toward, 0.12)), [0, fence.height * 0.5, 0]), w = 12, h = Math.min(3, fence.height * 0.36), u0 = cell / 4, u1 = (cell + 1) / 4;
    quad(B('ads'), madd(madd(c, tng, -w), [0, 1, 0], -h), madd(madd(c, tng, w), [0, 1, 0], -h), madd(madd(c, tng, w), [0, 1, 0], h), madd(madd(c, tng, -w), [0, 1, 0], h),
      toward, WHITE, MAT.PAD, [[u1, 1], [u0, 1], [u0, 0], [u1, 0]]);
  });
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
  // planted, as a real one is: four ledges up its face, each a dark concrete planter with a hedge
  // of clipped juniper along it, mounds overlapping so the top is lumpy and the face isn't. The
  // greens stay as dark as the wall behind, so the ball still has nothing to get lost in.
  {
    const R = seeded(0x6a756e), at = (deg, out, y) => { const t = deg * DEG, r = fenceDistance(t, fence) + out; return [Math.sin(t) * r, y, Math.cos(t) * r]; };
    const greens = ['#10301c', '#0e2b19', '#13341f', '#0c2817'].map(lin), sill = lin('#1e2224');
    for (const [y, out] of [[fence.height + 0.6, 4.3], [fence.height + 7.2, 4.6], [fence.height + 13.8, 4.9], [fence.height + 20.4, 5.2]]) {
      const ledge = [];
      for (let d = -8; d <= 8; d += 1) ledge.push(at(d, out - 0.4, 0));
      strip(B('plain'), ledge, y - 0.9, y, sill, MAT.CONCRETE, 20);
      for (let d = -7.8; d <= 7.8; d += 0.42) {
        const c = at(d + (R() - 0.5) * 0.15, out + 0.5, y + 0.9 + R() * 0.5), th = Math.atan2(c[0], c[2]);
        const ax = [[Math.cos(th), 0, -Math.sin(th)], [0, 1, 0], [Math.sin(th), 0, Math.cos(th)]];
        ellipsoid(B('plain'), c, ax, [1.9 + R() * 0.6, 1.5 + R() * 0.6, 1.1], 5, 8, greens[(R() * greens.length) | 0], MAT.MATTE);
      }
    }
  }
  // the lower bowl, its ads behind the plate, and the upper deck over it
  const bowl = bowlPath();
  // No net behind the plate: the Diamond Club's front row sits on the backstop wall with nothing
  // between it and the catcher.
  stands(B, crowd, bowl, { rows: 24, y0: 4.5, rise: 1.3, depth: 2.7, front: 4.5, occ: 0.42, name: 'lower', crater: true, ads: true, full: opts.full,
    club: { arc: 30, rows: 4, y0: 0.6, rise: 0.8, wall: 2.6, occ: 0.7 } });
  dugouts(B, 4.5);
  stands(B, crowd, bowlPath(false).filter((p) => len(p) < 255), { rows: 15, y0: 54, rise: 1.95, depth: 2.6, start: 64, front: 9, occ: 0.26, name: 'upper', fascia: true, full: opts.full });
  // the scoreboard, behind right-centre: a face of lamps on a dark frame, on two legs
  const board = boardFrame(field);
  {
    const { c, n, t, w, h, yaw } = board;
    const P = (a, b) => add(add(c, mul(t, a)), [0, b, 0]);
    quad(B('board'), P(-w, -h), P(w, -h), P(w, h), P(-w, h), n, WHITE, MAT.BOARD, [[0, 1], [1, 1], [1, 0], [0, 0]]);
    box(B('plain'), madd(c, n, -2.5), [w + 3, h + 3, 2], yaw, lin('#1d1f22'), MAT.CONCRETE);
    for (const a of [-40, 40]) box(B('plain'), madd(add(add([c[0], 0, c[2]], mul(t, a)), [0, 22.5, 0]), n, -2.5), [2, 22.5, 2], yaw, lin('#55585c'), MAT.METAL);
  }
  // the videoboard, behind left-centre: a 16:9 screen in its own batch ('jumbo'), which the
  // renderer draws with the picture the grandstand paints (diamond/jumbo.js), on a frame and legs
  const jumbo = jumboFrame(field);
  {
    const { c, n, t, w, h, yaw } = jumbo;
    const P = (a, b) => add(add(c, mul(t, a)), [0, b, 0]);
    quad(B('jumbo'), P(-w, -h), P(w, -h), P(w, h), P(-w, h), n, WHITE, MAT.EMISSIVE, [[0, 1], [1, 1], [1, 0], [0, 0]]);
    box(B('plain'), madd(c, n, -2.5), [w + 3, h + 3, 2], yaw, lin('#1d1f22'), MAT.CONCRETE);
    const legH = (c[1] - h) / 2;
    for (const a of [-34, 34]) box(B('plain'), madd(add(add([c[0], 0, c[2]], mul(t, a)), [0, legH, 0]), n, -2.5), [2, legH, 2], yaw, lin('#55585c'), MAT.METAL);
  }
  // the bowl round it all, its towers, its gates and its roof
  const deco = buildBowl(B, field, (key) => { let b = translucent.get(key); if (!b) { b = createBatch(); translucent.set(key, b); } return b; });
  return { opaque, translucent, sign: deco.plates, lamps: deco.lamps, roof: deco.roof, crowd: { sit: new Float32Array(crowd.sit), stand: new Float32Array(crowd.stand), cheer: new Float32Array(crowd.cheer) },
    field, outline, numbers: texts, board, jumbo };
}

// ── the bowl ────────────────────────────────────────────────────────────────
// The Charles B. Hughson Coliseum as the map draws it (glass/models/coliseum.js), transcribed by
// `B2T`: the plan's park units (u east, v south of the block's centre) to the bowl's feet, through
// the world's ruler (diamond/geo.js fromBlock and ftUp). The wall's five courses, the fins and the
// concourse windows, the four corner towers, the decks and the four gates are the
// plan's numbers (client/shared/coliseum-plan.js), the ones the map's arm draws: the same park.
// So is the roof, the Hughson Dome: the plan's shells, girders and lantern.
// Every box in the bowl stands square to the foul lines, as the map's park stands on the tile grid.
// Since the park went to true size the main gate stands across from home on both, so it's
// transcribed like everything else (GATE.u is home plate's u).
const KH = UNIT_FT;   // a park unit across, in feet: the broadcast's park is true size whatever the map draws
const B2T = (u, v, z = 0) => sf(fromBlock(u), fromBlock(v), ftUp(z));
const toBlock = (s) => OUT - (s + BOWL.near) / KH;
// ⚠ A GATE'S BODY STOPS INSIDE THE WALL, short of its inner face. In the inner face's own plane its
// back fought the window painted there, and from the field the window came and went in streaks.
const GATE_BACK = BACK + 0.004;
export const BOWL_Z = Object.freeze(Object.fromEntries(Object.entries(Z).map(([k, z]) => [k, ftUp(z)])));
// the bays between the fins, in feet: the concourse windows are painted one a bay (ballpark.js)
export const BAY = 0.245 * KH;
// The Guardians either side of the main gate: a pylon `hw` half wide, standing to `top`.
// The main gate's plate, z0 to z1 and `hw` either side, narrow enough to stand clear of them.
export const MAIN_PLATE = Object.freeze({ z0: 0.385, z1: 0.475, hw: 0.165 });
// The name band on Sorrel Way and the boulevard: plain stone in the wall under the frieze, `d` proud,
// over windows cut short for it, from the face's gate to the corner tower on its longer side
// (`bandRun`). The towers stand at TOWER.at on the map, as the venue's do here.
const TW = TOWER.at - TOWER.r0;
const bandRun = (g) => {
  const a = [-TW, g.u - g.hw - 0.03], b = [g.u + g.hw + 0.03, TW];
  return a[1] - a[0] >= b[1] - b[0] ? a : b;
};
// Each face's run, in block u: `s` on Sorrel Way, `n` on the boulevard. The shader stops the windows
// short under it (ballpark.js EXTERIOR_GLSL).
export const BAND_RUNS = Object.freeze({ s: Object.freeze(bandRun(GATE)), n: Object.freeze(bandRun(BGATE)) });
// The same for the shader, as the wall's uv has it (feet along from the first fin), with the heights
// in feet that a window under the band stops at: its frame, and its glass.
export const BAND_UV = Object.freeze({ s: BAND_RUNS.s.map((t) => (t - FIN_AT[0]) * KH), n: BAND_RUNS.n.map((t) => (t - FIN_AT[0]) * KH),
  frame: ftUp(BAND.z0 - 0.010), glass: ftUp(BAND.z0 - 0.016) });
// The concourse windows (glass/coliseum-window.js, the map's): one a bay between each pair of fins.
// The outfield faces, the boulevard's and the west's, have the bigger one (WIN_OPEN) cut through
// the wall (buildBowl), and their wall's colour says so (green 1), so the shader paints its frame.
const WIN_BAYS = FIN_AT.slice(1).map((t, j) => (FIN_AT[j] + t) / 2);
export const OPEN_FACE = (n) => n[1] === -1 || n[0] === -1;
// The sun in a window's head, round at this view's proportions: a tile along is KH feet, a tile up 226.
const SUNBURST = sunburst(KH / ftUp(1), WIN_OPEN);
// GLAZE's uv: the concourse's lamps, lit every night; and clear glass, which lights nothing.
const LIT_NIGHTLY = [[1, 0], [1, 0], [1, 0], [1, 0]], CLEAR = [[2, 0], [2, 0], [2, 0], [2, 0]];
// the roof's glass, which ballpark.js draws see-through in a pass of its own
const ROOF_GLASS = [3, 0];
export { wallRects };
// A carved face: the DECO shader leaves the coursing off a face whose uv.x is negative, because a
// figure with the wall's joints across it read as stacked masonry on the map.
const DRESSED = [-1, 0];
// The roof: the Hughson Dome, the plan's (coliseum-plan.js DOME, SHELLS, GIRDER, LANTERN), the same
// shells the map's arm draws. Each shell is built shut as a batch of its own and drawn along its rails
// as far as the roof has got (shellShift, gl/ballpark.js uShift); the girders, the rails, the sills and
// the lantern never move, so they're in the bowl's own batches.
// ⚠ THE GAPS ARE MEASURED: each level clears the one over it by about seven feet everywhere, and its
// underside, the steel under it and the ribs on the shell under that fit in the gap (ballpark-smoke).
export { SHELLS, shellProfile };
// Where shell 'i' stands at 'p' (0 open, 1 shut) against where it's built (shut): feet along the
// first-base line, as the offset its batch is drawn at (gl/ballpark.js uShift).
export function shellShift(i, p) {
  return sf(0, fromBlock(shellAt(i, p)) - fromBlock(SHELLS[i].shut));
}
// A shell's skin is SKIN feet thick, and the steel under it hangs to SHELL_STEEL feet under the skin.
export const SKIN = 1.6, SHELL_STEEL = 3.4;
// Shell level k's half arch, `d` feet in from its skin along the profile's normal, in park units.
export function profileIn(k, d) {
  const up = ftUp(1), F = shellProfile(k).map(([r, z]) => [r * KH, z * up]);
  const n = F.slice(0, -1).map((a, j) => { const b = F[j + 1], dr = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dr, dz) || 1; return [dz / l, -dr / l]; });
  return F.map(([R, Zf], j) => {
    const a = n[Math.max(0, j - 1)], b = n[Math.min(n.length - 1, j)], m = [a[0] + b[0], a[1] + b[1]], l = Math.hypot(m[0], m[1]) || 1;
    return [(R - d * m[0] / l) / KH, (Zf - d * m[1] / l) / up];
  });
}

// The lights at `p` (0 open, 1 shut): each tower's at its lamp house, crossing over to its lamps
// under a deck (`under`) as the roof comes over it, out by the time the shells are halfway and up
// again at the deck by the time they've closed, so no light ever jumps while it's lit. The decks'
// own rows burn either way, and harder while the towers hand over (twice as hard halfway), so the
// field doesn't go dim under a moving roof. [{ lamp, dir, k }], in the venue's order.
export function roofLights(towers, p) {
  const s = Math.min(1, Math.max(0, +p || 0));
  return towers.map((T) => {
    if (T.kind === 'deck' || !T.under) return { lamp: T.lamp, dir: T.dir, k: T.kind === 'deck' ? 1 + 4 * s * (1 - s) : 1 - s };
    return s < 0.5 ? { lamp: T.lamp, dir: T.dir, k: 1 - 2 * s } : { lamp: T.under.lamp, dir: T.under.dir, k: 2 * s - 1 };
  });
}

// The roof's travel: where it is, 0 open to 1 shut, eased out of rest and back into it over `ms`
// as the map's is (world-feed.js ROOF_MS). The first state it hears is where it already is; a change
// starts from wherever it has got to.
export function roofTrack(ms) {
  let e = null;
  const at = (now) => {
    if (!e) return 1;
    const u = Math.min(1, Math.max(0, (now - e.t0) / ms)), s = u * u * (3 - 2 * u);
    return e.from + (e.to - e.from) * s;
  };
  return {
    set(shut, now) {
      if (shut == null) return;
      const to = shut ? 1 : 0;
      if (!e) { e = { from: to, to, t0: now - ms }; return; }
      if (e.to === to) return;
      e = { from: at(now), to, t0: now };
    },
    at,
    moving: (now) => !!e && now - e.t0 < ms,
    get to() { return e ? e.to : 1; },
  };
}

// The plates' atlas (ballpark.js paintPlates), in pixels: the main gate's plate at the top, the
// bleacher gate's under it, and under them the name band on each face in two halves, the reader's
// left first (`band.s`, `band.n`). Each cell is its face's shape in feet, so nothing is stretched;
// halves, so the band's letters have twice the pixels a single 2048 row would give them.
export const PLATE_ATLAS = (() => {
  const W = 2048, band = {};
  let y = 1056;
  for (const k of ['s', 'n']) {
    const r = BAND_RUNS[k], h = Math.round(W * ftUp(BAND.z1 - BAND.z0) / (((r[1] - r[0]) / 2) * KH));
    band[k] = Object.freeze([0, 1].map(() => { const c = Object.freeze([0, y, W, h]); y += h + 20; return c; }));
  }
  return Object.freeze({ w: W, h: 2048, main: Object.freeze([0, 0, W, 606]), bleach: Object.freeze([0, 626, 1336, 410]), band: Object.freeze(band) });
})();

const COL = Object.freeze({
  stone: lin('#a48a66'), trim: lin('#968e7c'), fin: lin('#c6c4be'), bronze: lin('#604428'), copper: lin('#4e8a76'),
  granite: lin('#3a3e44'), conc: lin('#7a7e82'), inner: lin('#3c3a36'), shell: lin('#b8bcba'), shellIn: lin('#6a7074'), steel: lin('#3e4448'), truss: lin('#a9aeb0'),
  rib: lin('#604a32'), gilt: lin('#deb260'), glass: lin('#3a4c58'), lobby: lin('#40505a'), grille: lin('#1e1a16'),
  flute: lin('#60543f'), red: lin('#aa2822'), plate: lin('#1e1610'), pole: lin('#d9d9d4'), flag: lin('#16264a'),
  floor: lin('#8c8272'), pane: lin('#1c262e'), leaf: lin('#4a3226'),
});
const TOWER_CORNERS = [[1, 1], [-1, 1], [1, -1], [-1, -1]];
const LAMP_LIT = [26, 25, 22], LAMP_DEAD = lin('#1a1b1d');
// how far a lamp's housing stands off its tower's lamp house, in block units (about 1.7 ft)
const LAMP_BOX = 0.008;

// A box square to the foul lines, over s3a..s3b, s1a..s1b and y0..y1 feet, each face its own normal;
// `top` colours its top (a ledge flashed in copper).
function sbox(b, s3a, s3b, s1a, s1b, y0, y1, col, mat, top = null) {
  if (s3b - s3a < 1e-6 || s1b - s1a < 1e-6 || y1 - y0 < 1e-6) return;
  const P = (i, j, k) => sf(i ? s3b : s3a, j ? s1b : s1a, k ? y1 : y0);
  const n3 = sf(1, 0), n1 = sf(0, 1), ft = (a, c) => [[0, c], [a, c], [a, 0], [0, 0]];
  const w3 = s3b - s3a, w1 = s1b - s1a, h = y1 - y0;
  quad(b, P(0, 0, 0), P(0, 1, 0), P(0, 1, 1), P(0, 0, 1), mul(n3, -1), col, mat, ft(w1, h));
  quad(b, P(1, 1, 0), P(1, 0, 0), P(1, 0, 1), P(1, 1, 1), n3, col, mat, ft(w1, h));
  quad(b, P(1, 0, 0), P(0, 0, 0), P(0, 0, 1), P(1, 0, 1), mul(n1, -1), col, mat, ft(w3, h));
  quad(b, P(0, 1, 0), P(1, 1, 0), P(1, 1, 1), P(0, 1, 1), n1, col, mat, ft(w3, h));
  quad(b, P(0, 0, 1), P(0, 1, 1), P(1, 1, 1), P(1, 0, 1), [0, 1, 0], top || col, mat);
  quad(b, P(0, 0, 0), P(1, 0, 0), P(1, 1, 0), P(0, 1, 0), [0, -1, 0], col, mat);
}
// The same over block u0..u1, v0..v1, z0..z1 (tiles).
function bbox(b, u0, u1, v0, v1, z0, z1, col, mat, top = null) {
  sbox(b, fromBlock(Math.max(u0, u1)), fromBlock(Math.min(u0, u1)), fromBlock(Math.max(v0, v1)), fromBlock(Math.min(v0, v1)), ftUp(Math.min(z0, z1)), ftUp(Math.max(z0, z1)), col, mat, top);
}
// A flat face from block points [u, v, z], convex, fanned from its first point and turned to face
// the block direction `out` [u, v, z].
function bface(b, pts, out, col, mat, uv = [0, 0]) {
  if (pts.length < 3) return;
  const W = pts.map(([u, v, z]) => B2T(u, v, z)), want = sf(-out[0], -out[1], out[2]);
  let n = [0, 0, 0];
  for (let i = 0; i < W.length; i++) { const a = W[i], c = W[(i + 1) % W.length]; n = add(n, [(a[1] - c[1]) * (a[2] + c[2]), (a[2] - c[2]) * (a[0] + c[0]), (a[0] - c[0]) * (a[1] + c[1])]); }
  n = norm(n);
  if (dot(n, want) < 0) n = mul(n, -1);
  for (let i = 1; i + 1 < W.length; i++) { vtx(b, W[0], n, uv, col, mat); vtx(b, W[i], n, uv, col, mat); vtx(b, W[i + 1], n, uv, col, mat); }
}
// An upright drum round a block point, from z0 to z1 tiles, its radius r0 at the foot to r1 at the top.
function bdrum(b, u, v, z0, z1, r0, r1, col, mat, segs = 8, uv = null) {
  const c = B2T(u, v, 0), y0 = ftUp(z0), y1 = ftUp(z1);
  grid(b, 2, segs, (i, j) => { const a = j / segs * TAU, r = (i ? r1 : r0) * KH; return [c[0] + Math.sin(a) * r, i ? y1 : y0, c[2] + Math.cos(a) * r]; },
    { col, mat, centre: [c[0], (y0 + y1) / 2, c[2]], ...(uv ? { uv: () => uv } : {}) });
}

// Builds the bowl into the park's batches (B), from the venue's lights (field.towers). Returns the
// plates' batch (the plate over each gate and the name in the bands, drawn once they're painted), the lamps' batches (the towers'
// floods, the decks' rows, the beacons, the lanterns and the plates' halo, each lit on its own), and
// the roof: a batch a shell of the dome, built shut.
function buildBowl(B, field, BT) {
  const plain = B('plain');
  const lamps = { tower: createBatch(2048), deck: createBatch(1024), beacon: createBatch(256), lantern: createBatch(512), halo: createBatch(128) };
  const SIDES = [[0, 1], [0, -1], [1, 0], [-1, 0]];
  const SPT = (n, t, d, z) => (n[1] ? [t, n[1] * (OUT + d), z] : [n[0] * (OUT + d), t, z]);
  const sideBox = (n, t0, t1, d0, d1, z0, z1, col, mat, top) => {
    const a = n[1] || n[0], w0 = a * (OUT + d0), w1 = a * (OUT + d1);
    if (n[1]) bbox(plain, t0, t1, w0, w1, z0, z1, col, mat, top); else bbox(plain, w0, w1, t0, t1, z0, z1, col, mat, top);
  };
  const sideFace = (b, n, t0, t1, d, z0, z1, col, mat, uv) => bface(b, [SPT(n, t0, d, z1), SPT(n, t1, d, z1), SPT(n, t1, d, z0), SPT(n, t0, d, z0)], [n[0], n[1], 0], col, mat, uv);

  // The concourse behind an open face: a floor at the sills, a ceiling at the heads with a strip of
  // lamps down it lit every night, and a wall across each end. From the field, through an opening,
  // it's the corridor and the backs of the windows; from the street, the corridor and the stands.
  // The skins' backs are the dark of an unlit room (ballpark.js, a back face of EXTERIOR).
  const glazing = BT('glazing');
  const concourse = (n, run) => {
    const P = (t, d, z) => B2T(...SPT(n, t, d, z)), zf = WIN_OPEN.z0, zc = WIN_OPEN.z1 + 0.004;
    quad(plain, P(-run, -0.07, zf), P(run, -0.07, zf), P(run, 0, zf), P(-run, 0, zf), [0, 1, 0], COL.floor, MAT.CONCRETE);
    quad(plain, P(-run, 0, zc), P(run, 0, zc), P(run, -0.07, zc), P(-run, -0.07, zc), [0, -1, 0], COL.inner, MAT.CONCRETE);
    quad(plain, P(-run, -0.04, zc - 0.001), P(run, -0.04, zc - 0.001), P(run, -0.03, zc - 0.001), P(-run, -0.03, zc - 0.001), [0, -1, 0], COL.lobby, MAT.GLAZE, LIT_NIGHTLY);
    for (const t of [-run, run]) {
      const inward = norm(sub(P(0, -0.035, zf), P(t, -0.035, zf)));
      quad(plain, P(t, -0.07, zf), P(t, 0, zf), P(t, 0, zc), P(t, -0.07, zc), inward, COL.inner, MAT.CONCRETE);
    }
  };
  // One opening's bronze and glass, in the outer skin (WIN_OPEN): the glass across it, the mullions
  // and the transoms, and over the lights outside the middle one a bronze panel each, stepping down
  // toward the frame, with the step the middle light rises past to the head under its sun. Under the
  // band it's square-headed and has no sun.
  const tracery = (n, tc, banded) => {
    const W = WIN_OPEN, top = banded ? W.band : W.z1, bronze = (t0, t1, z0, z1) => sideBox(n, t0, t1, -0.004, 0.004, z0, z1, COL.bronze, MAT.GILT);
    const G = [[tc - W.hw, W.z0], [tc + W.hw, W.z0], [tc + W.hw, top], [tc - W.hw, top]].map(([t, z]) => B2T(...SPT(n, t, 0, z)));
    quad(glazing, G[0], G[1], G[2], G[3], norm(sf(-n[0], -n[1], 0)), COL.pane, MAT.GLAZE, CLEAR);
    for (const m of W.mulls) for (const sg of [-1, 1]) bronze(tc + sg * m - W.bar, tc + sg * m + W.bar, W.z0, top);
    for (const z of W.transoms) bronze(tc - W.hw, tc + W.hw, z - W.bar, z + W.bar);
    if (banded) return;
    for (const [t0, t1, z0, z1] of headPanels(W)) for (const sg of [-1, 1]) bronze(tc + Math.min(sg * t0, sg * t1), tc + Math.max(sg * t0, sg * t1), z0, z1);
    // the sun, on both sides of the glass: gilt from the street, and its back seen from the concourse
    for (const poly of SUNBURST) for (const s of [1, -1]) bface(plain, poly.map(([t, z]) => SPT(n, tc + t, s * 0.0045, z)), [s * n[0], s * n[1], 0], COL.gilt, MAT.GILT);
  };

  // 6) THE WALL, all four sides: a granite plinth, the limestone wall with a concourse window in
  //    every bay, a frieze, the clerestory set back behind the fins, and the cornice flashed in
  //    copper. North and south run to the corners; east and west stop inside them.
  //    ⚠ THE OUTFIELD FACES ARE OPEN. On the boulevard and the west the windows are cut through
  //    both skins onto a concourse between them (`concourse`), with their bronze and glass in the
  //    outer skin (`tracery`), so the city shows through them from the field. Sorrel Way and the
  //    east have the grandstand against them and keep the windows painted (EXTERIOR).
  const ext = B('exterior');
  // ⚠ THE INSIDE SKIN STANDS PROUD OF THE COURSES. The plinth, frieze, clerestory and cornice boxes
  // have their own backs at -0.07; the inside faces drawn in that plane fought them, and from the
  // field the back wall flickered. So the inside faces sit a hair further in.
  const IN_SKIN = -0.072;
  SIDES.forEach((n, k) => {
    const ns = !!n[1], run = ns ? OUT + 0.01 : BACK;
    // ⚠ NOT ACROSS A GATE: its frontispiece stands in front of this face
    const sg = n[0] ? SIDE_GATES.find((g) => g.side === n[0]) : null;
    const gate = (t) => (n[1] === 1 && t > GATE.u - GATE.hw - 0.04 && t < GATE.u + GATE.hw + 0.04)
      || (n[1] === -1 && t > BGATE.u - BGATE.hw - 0.04 && t < BGATE.u + BGATE.hw + 0.04)
      || (!!sg && t > sg.v - sg.hw - 0.04 && t < sg.v + sg.hw + 0.04);
    const gs = n[1] === 1 ? GATE : n[1] === -1 ? BGATE : null;
    const span = gs ? [gs.u - gs.hw, gs.u + gs.hw] : sg ? [sg.v - sg.hw, sg.v + sg.hw] : null;
    // the name band on Sorrel Way and the boulevard, its face the lettered cells (bandAt)
    const bnd = n[1] === 1 ? BAND_RUNS.s : n[1] === -1 ? BAND_RUNS.n : null;
    const inBand = (t) => !!bnd && t > bnd[0] && t < bnd[1];
    sideBox(n, -run, run, -0.07, 0.008, 0, Z.plinth, COL.granite, MAT.DECO);
    sideBox(n, -run, run, -0.07, 0.006, Z.wall, Z.frieze, COL.trim, MAT.DECO);
    sideBox(n, -run, run, -0.07, -0.018, Z.frieze, Z.cler, COL.stone, MAT.DECO);
    sideBox(n, -run, run, -0.07, 0.01, Z.cler, Z.corn, COL.trim, MAT.DECO, COL.copper);
    {
      // the wall between plinth and frieze, its feet along from the first fin so the windows fall
      // between the fins; on an open face, cut round the openings
      const ux = (t) => (t - FIN_AT[0]) * KH, nn = norm(sf(-n[0], -n[1], 0));
      const bays = OPEN_FACE(n) ? WIN_BAYS.filter((tc) => !gate(tc)) : [];
      const holes = (outside) => bays.map((tc) => [tc - WIN_OPEN.hw, tc + WIN_OPEN.hw, WIN_OPEN.z0, outside && inBand(tc) ? WIN_OPEN.band : WIN_OPEN.z1]);
      for (const [ta, tb, za, zb] of wallRects(run, holes(true), Z.plinth, Z.wall)) {
        const W = [[ta, za], [tb, za], [tb, zb], [ta, zb]].map(([t, z]) => B2T(...SPT(n, t, 0, z)));
        quad(ext, W[0], W[1], W[2], W[3], nn, [k * 0.25, bays.length ? 1 : 0, 0], MAT.EXTERIOR, [[ux(ta), ftUp(za)], [ux(tb), ftUp(za)], [ux(tb), ftUp(zb)], [ux(ta), ftUp(zb)]]);
      }
      // and its inside over the stands, the same stone and the same windows onto the concourse, so the
      // bowl seen from the field is the one seen from the street (its uv runs the other way, so the
      // bays read from the field as they do from the street). Inside, nothing stops a window short.
      for (const [ta, tb, za, zb] of wallRects(run, holes(false), Z.plinth, Z.wall)) {
        const I = [[tb, za], [ta, za], [ta, zb], [tb, zb]].map(([t, z]) => B2T(...SPT(n, t, -0.07, z)));
        quad(ext, I[0], I[1], I[2], I[3], mul(nn, -1), [k * 0.25 + 0.125, bays.length ? 1 : 0, 0], MAT.EXTERIOR, [[ux(-tb), ftUp(za)], [ux(-ta), ftUp(za)], [ux(-ta), ftUp(zb)], [ux(-tb), ftUp(zb)]]);
      }
      const J = [SPT(n, -run, IN_SKIN, 0), SPT(n, run, IN_SKIN, 0), SPT(n, run, IN_SKIN, Z.plinth), SPT(n, -run, IN_SKIN, Z.plinth)].map(([u, v, z]) => B2T(u, v, z));
      quad(plain, J[0], J[1], J[2], J[3], mul(nn, -1), COL.inner, MAT.CONCRETE);
      const K = [SPT(n, -run, IN_SKIN, Z.wall), SPT(n, run, IN_SKIN, Z.wall), SPT(n, run, IN_SKIN, Z.corn), SPT(n, -run, IN_SKIN, Z.corn)].map(([u, v, z]) => B2T(u, v, z));
      quad(plain, K[0], K[1], K[2], K[3], mul(nn, -1), COL.stone, MAT.DECO);
      if (bays.length) {
        concourse(n, run);
        for (const tc of bays) tracery(n, tc, inBand(tc));
      }
    }
    const runs = span ? [[-run + 0.01, span[0]], [span[1], run - 0.01]] : [[-run + 0.01, run - 0.01]];
    // GATE C and GATE D: the map's plain frontispiece (glass/models/coliseum.js 9b), its doors and its
    // fanlight, lit every night. Its plate is bare bronze here; the map letters it.
    if (sg) {
      // ⚠ ITS BODY STOPS INSIDE THE WALL (GATE_BACK), or its back fights the windows painted on the
      // wall's inside face and they flash from the field
      const t0 = sg.v - sg.hw, t1 = sg.v + sg.hw, gb = GATE_BACK - OUT;
      sideBox(n, t0 - 0.005, t1 + 0.005, gb, 0.016, 0, Z.plinth, COL.granite, MAT.DECO);
      sideBox(n, t0, t1, gb, 0.012, Z.plinth, sg.top, COL.stone, MAT.DECO);
      sideBox(n, t0 - 0.004, t1 + 0.004, gb, 0.016, sg.top, sg.top + 0.012, COL.trim, MAT.DECO, COL.copper);
      sideBox(n, t0 + 0.04, t1 - 0.04, gb, 0.008, sg.top + 0.012, sg.top + 0.05, COL.stone, MAT.DECO);
      sideBox(n, t0 + 0.07, t1 - 0.07, gb, 0.008, sg.top + 0.05, sg.top + 0.064, COL.trim, MAT.DECO, COL.copper);
      for (const o of [-1, 1]) sideBox(n, sg.v + o * 0.10 - 0.012, sg.v + o * 0.10 + 0.012, 0.012, 0.022, Z.plinth, sg.top - 0.01, COL.fin, MAT.DECO);
      sideFace(plain, n, sg.v - 0.06, sg.v + 0.06, 0.0125, Z.plinth, 0.22, COL.bronze, MAT.GILT);
      sideFace(plain, n, sg.v - 0.05, sg.v + 0.05, 0.0130, 0.235, 0.29, COL.lobby, MAT.GLAZE, [1, 0]);
      sideFace(plain, n, sg.v - 0.07, sg.v + 0.07, 0.0145, 0.315, 0.37, COL.plate, MAT.GILT);
    }
    for (const [t0, t1] of runs) sideFace(plain, n, t0, t1, -0.016, Z.frieze + 0.004, Z.cler - 0.004, COL.glass, MAT.GLAZE, [0, 0]);
    if (bnd) sideBox(n, bnd[0], bnd[1], -0.01, BAND.d, BAND.z0, BAND.z1, COL.trim, MAT.DECO);
    // the fins, marble-pale through the frieze and the clerestory to break the cornice, capped; under
    // the band they stop, and carry on over it
    FIN_AT.forEach((t) => {
      if (gate(t)) return;
      if (inBand(t)) {
        sideBox(n, t - 0.011, t + 0.011, -0.01, 0.022, Z.plinth, BAND.z0, COL.fin, MAT.DECO);
        sideBox(n, t - 0.011, t + 0.011, -0.01, 0.022, BAND.z1, 0.49, COL.fin, MAT.DECO);
      } else sideBox(n, t - 0.011, t + 0.011, -0.01, 0.022, Z.plinth, 0.49, COL.fin, MAT.DECO);
      sideBox(n, t - 0.007, t + 0.007, -0.01, 0.017, 0.49, 0.512, COL.trim, MAT.DECO);
    });
  });

  // The decks over the east and west concourse, roofed in copper under the dome's girders, the columns
  // under them and a row of floods along each deck's edge, turned to the field: what lights the field
  // with the dome shut.
  const decks = field.towers.filter((T) => T.kind === 'deck');
  for (const su of [1, -1]) {
    const lo = (a, b) => (su > 0 ? [a, b] : [-b, -a]);
    // its underside a hair (0.1 ft) under Z.cler: the wall's courses end at Z.cler under it, and
    // nothing is culled, so their tops and the soffit tied in depth and flickered from the stands
    bbox(plain, ...lo(DECK, BACK), -BACK, BACK, Z.cler - 0.0005, Z.corn, COL.trim, MAT.DECO, COL.copper);
    // ⚠ ON THE FAR SIDE, BEHIND THE BLEACHERS. The map's columns stand at 1.18 either side; on the
    // left-field side that is in the broadcast's bleachers, so they stand at the deck's back there.
    const cu = su > 0 ? 1.18 : -1.33;
    for (let j = 0; j < 7; j++) { const v = -1.26 + j * 0.42; bbox(plain, cu - 0.009, cu + 0.009, v - 0.009, v + 0.009, 0, Z.cler, COL.conc, MAT.CONCRETE); }
    const D = decks.find((T) => Math.sign(toBlock(sOf(T.base)[0])) === su), live = D ? D.live : [];
    for (let j = 0; j < 24; j++) {
      const v = 1.26 - 2.52 * (j + 0.5) / 24, u = su * (DECK - 0.002);
      bbox(plain, u - su * 0.012, u, v - 0.011, v + 0.011, 0.402, 0.428, COL.bronze, MAT.GILT);
      bface(live[j] ? lamps.deck : plain, [[u - su * 0.0004, v - 0.009, 0.425], [u - su * 0.0004, v + 0.009, 0.425], [u - su * 0.0004, v + 0.009, 0.405], [u - su * 0.0004, v - 0.009, 0.405]],
        [-su, 0, 0], live[j] ? LAMP_LIT : LAMP_DEAD, live[j] ? MAT.EMISSIVE : MAT.METAL);
    }
  }

  // 7) THE FOUR TOWERS, one at each corner as on the map: a fluted limestone shaft, two setbacks, a
  //    bronze lamp house, a stepped crown, a finial and a red beacon. The field's light is on the
  //    poles (7b).
  for (const [su, sv] of TOWER_CORNERS) {
    const tu = su * TOWER.at, tv = sv * TOWER.at, R = TOWER;
    const sq = (r, z0, z1, col, mat, top) => bbox(plain, tu - r, tu + r, tv - r, tv + r, z0, z1, col, mat, top);
    sq(R.r0 + 0.006, 0, Z.plinth, COL.granite, MAT.DECO);
    sq(R.r0, Z.plinth, R.z0, COL.stone, MAT.DECO);
    sq(R.r0 + 0.006, R.z0, R.z0 + 0.016, COL.trim, MAT.DECO, COL.copper);
    sq(R.r1, R.z0 + 0.016, R.z1, COL.stone, MAT.DECO);
    sq(R.r1 + 0.005, R.z1, R.z1 + 0.012, COL.trim, MAT.DECO, COL.copper);
    sq(R.r2, R.z1 + 0.012, R.z2, COL.bronze, MAT.GILT);
    sq(R.r2 + 0.004, R.z2, R.z2 + 0.014, COL.trim, MAT.DECO, COL.copper);
    sq(R.r3, R.z2 + 0.014, R.z3, COL.trim, MAT.DECO);
    // three fins on each outer face, the middle one carried up the first setback; between them a
    // lit slit and a gilt chevron near the top of the shaft
    for (const [nu, nv] of [[su, 0], [0, sv]]) {
      const fu = (o) => (nu ? tu + nu * R.r0 : tu + o), fv = (o) => (nv ? tv + nv * R.r0 : tv + o);
      [-0.055, 0, 0.055].forEach((o) => {
        const hu = nu ? 0.012 : 0.008, hv = nv ? 0.012 : 0.008, top = o ? R.z0 : R.z1 - 0.02;
        bbox(plain, fu(o) - hu, fu(o) + hu, fv(o) - hv, fv(o) + hv, Z.plinth + 0.02, top, COL.fin, MAT.DECO);
      });
      for (const o of [-0.0275, 0.0275]) {
        const u = fu(o) + nu * 0.0004, v = fv(o) + nv * 0.0004, w = 0.0065;
        const at = (a, z) => (nu ? [u, v + a, z] : [u + a, v, z]);
        bface(plain, [at(-w, 0.52), at(w, 0.52), at(w, 0.20), at(-w, 0.20)], [nu, nv, 0], COL.glass, MAT.GLAZE, [1, 0]);
        for (const sg of [-1, 1]) bface(plain, [at(0, 0.585), at(sg * 0.018, 0.565), at(sg * 0.018, 0.557), at(0, 0.577)], [nu, nv, 0], COL.gilt, MAT.GILT);
      }
    }
    bdrum(plain, tu, tv, R.z3, R.z3 + 0.07, 0.014, 0.004, COL.bronze, MAT.GILT);
    bbox(lamps.beacon, tu - 0.003, tu + 0.003, tv - 0.003, tv + 0.003, R.z3 + 0.07, R.z3 + 0.078, [9, 1.2, 0.8], MAT.EMISSIVE);
  }
  // 7b) THE LIGHT POLES, the map's (the plan's POLES): a steel mast on each deck's roof behind the
  //     girder, a catwalk and a bank of 24 floods turned to the field. Each pole's dead lamps are the
  //     venue light's on its side and end (the middle ones take the nearer end's), and only the end
  //     poles' lights cast.
  {
    const K = POLES.bank, r = POLES.r, towers = field.towers.filter((t) => t.kind === 'tower');
    for (const su of [1, -1]) for (const pv of POLES.vs) {
      const pu = su * POLES.u, f = pu - su * (r + K.d);
      const T = towers.find((t) => { const [a, b] = sOf(t.lamp); return Math.sign(toBlock(a)) === su && Math.sign(toBlock(b)) === (Math.sign(pv) || 1); });
      const live = T ? T.live : [];
      bbox(plain, pu - r, pu + r, pv - r, pv + r, Z.corn, K.z0, COL.steel, MAT.METAL);
      bbox(plain, Math.min(f, pu + su * r), Math.max(f, pu + su * r), pv - K.hw, pv + K.hw, K.z0, K.z1, COL.steel, MAT.METAL);
      bbox(plain, Math.min(f - su * 0.012, pu), Math.max(f - su * 0.012, pu), pv - K.hw - 0.004, pv + K.hw + 0.004, K.z0 - 0.007, K.z0 - 0.003, COL.steel, MAT.METAL);
      const lu = f - su * 0.0004, cw = 2 * K.hw / K.cols, rh = (K.z1 - K.z0) / K.rows;
      for (let a = 0; a < K.rows; a++) for (let b = 0; b < K.cols; b++) {
        const on = live[a * K.cols + b], v0 = pv - K.hw + b * cw + 0.002, v1 = v0 + cw - 0.004, z0 = K.z0 + a * rh + 0.002, z1 = z0 + rh - 0.004;
        bface(on ? lamps.tower : plain, [[lu, v0, z1], [lu, v1, z1], [lu, v1, z0], [lu, v0, z0]], [-su, 0, 0], on ? LAMP_LIT : LAMP_DEAD, on ? MAT.EMISSIVE : MAT.METAL);
      }
    }
  }


  // 8) THE MAIN GATE on Sorrel Way, and 9) the bleacher gate on Halcyon Boulevard, its smaller twin.
  const plates = createBatch(64);
  mainGate(plain, lamps, plates);
  bleacherGate(plain, lamps, plates);
  // and the park's name cut into the band on both faces, read from the street each is on
  bandAt(plates, [0, 1], BAND_RUNS.s, PLATE_ATLAS.band.s, true);
  bandAt(plates, [0, -1], BAND_RUNS.n, PLATE_ATLAS.band.n, false);

  // 10) THE DOME. The girders, their rails, the sills and the lantern, which never move, and the three
  //     shells, each built shut as a batch of its own the renderer slides as far as the roof has got
  //     (shellShift).
  buildDomeFixed(plain, lamps);
  const roof = SHELLS.map((S, i) => ({ batch: buildShell(S, i), fixed: S.open === S.shut, i }));
  return { plates, lamps, roof };
}

// What of the roof never moves (the map's arm, section 10): the girder along each deck, a bronze band
// with a gilt chevron frieze, and the rails stepping down and in under it, one for each level of shell
// under the top; the sills across the two ends; and the lantern on the fixed shell's crown, a bronze
// foot astride the ridge, two drums of glass in bronze mullions lit every night, a fluted gilt cap,
// and the finial, the main gate's sun with a baseball for its disc, and its red beacon.
function buildDomeFixed(plain, lamps) {
  const G = GIRDER, [f0, f1] = G.frieze, N = 16, fl = 0.004;
  const panel = (c, t, n, L) => {
    const F = (s, z) => [c[0] + t[0] * s, c[1] + t[1] * s, z];
    bface(plain, [F(-L, f1), F(L, f1), F(L, f1 - fl), F(-L, f1 - fl)], n, COL.gilt, MAT.GILT);
    bface(plain, [F(-L, f0 + fl), F(L, f0 + fl), F(L, f0), F(-L, f0)], n, COL.gilt, MAT.GILT);
    const cw = L * 0.8, top = f1 - 0.010, ch = f1 - f0 - 0.024, th = 0.007;
    for (const sg of [-1, 1]) bface(plain, [F(0, top), F(sg * cw, top - ch), F(sg * cw, top - ch - th), F(0, top - th)], n, COL.gilt, MAT.GILT);
  };
  for (const su of [1, -1]) {
    const lo = (a, b) => (su > 0 ? [a, b] : [-b, -a]);
    bbox(plain, ...lo(G.u0, G.u1), -OUT, OUT, G.z0, G.z1, COL.bronze, MAT.GILT);
    for (let k = 1; k < SHELLS.length; k++) { const [ro, ri, top] = rail(k); bbox(plain, ...lo(ri, ro), -BACK, BACK, Z.cler, top, COL.bronze, MAT.GILT); }
    for (let i = 0; i < N; i++) panel([su * (G.u1 + 0.002), -OUT + (2 * i + 1) * OUT / N], [0, 1], [su, 0, 0], OUT / N);
  }
  bbox(plain, -G.u0, G.u0, -OUT, -BACK, G.z0, sillZ(-1), COL.bronze, MAT.GILT);
  bbox(plain, -G.u0, G.u0, BACK, OUT, G.z0, sillZ(1), COL.bronze, MAT.GILT);
  for (let i = 0; i < N; i++) panel([-G.u1 + (2 * i + 1) * G.u1 / N, FIXED_END * (OUT + 0.002)], [1, 0], [0, FIXED_END, 0], G.u1 / N);
  const Lt = LANTERN, Lv = Lt.v, zr = KH / ftUp(1), disc = (r, z, out, col, mat, uv) => bface(plain, Array.from({ length: 24 }, (_, k) => { const a = 2 * Math.PI * k / 24; return [r * Math.cos(a), Lv + r * Math.sin(a), z]; }), out, col, mat, uv);
  bdrum(plain, 0, Lv, Lt.foot.z0, Lt.foot.z1, Lt.foot.r, Lt.foot.r, COL.bronze, MAT.GILT, 24);
  disc(Lt.foot.r, Lt.foot.z1 + 0.001, [0, 0, 1], COL.bronze, MAT.GILT);
  for (const Gl of Lt.glass) {
    bdrum(plain, 0, Lv, Gl.z0, Gl.z1, Gl.r, Gl.r, COL.lobby, MAT.GLAZE, 24, [1, 0]);
    bdrum(plain, 0, Lv, Gl.z1, Gl.z1 + Lt.ledge, Gl.r + 0.012, Gl.r + 0.012, COL.bronze, MAT.GILT, 24);
    disc(Gl.r + 0.012, Gl.z1 + Lt.ledge, [0, 0, 1], COL.bronze, MAT.GILT);
    for (let k = 0; k < Lt.mullions; k++) {
      const a = 2 * Math.PI * (k + 0.5) / Lt.mullions, u = Math.cos(a) * Gl.r, v = Lv + Math.sin(a) * Gl.r;
      bbox(plain, u - 0.004, u + 0.004, v - 0.004, v + 0.004, Gl.z0, Gl.z1, COL.bronze, MAT.GILT);
    }
  }
  bdrum(plain, 0, Lv, Lt.cap.z0, Lt.cap.z1, Lt.cap.r0, Lt.cap.r1, COL.gilt, MAT.GILT, Lt.cap.flutes);
  bdrum(plain, 0, Lv, Lt.cap.z1, Lt.stem.z1, Lt.stem.r, Lt.stem.r, COL.gilt, MAT.GILT, 8);
  // the sun, on all four sides, round though a unit up is not a unit across (zr)
  const S = Lt.sun;
  for (const nn of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    const at = (s, z, d = 0.004) => (nn[1] ? [s, Lv + nn[1] * d, z] : [nn[0] * d, Lv + s, z]), out = [nn[0], nn[1], 0];
    bface(plain, Array.from({ length: 16 }, (_, k) => { const a = 2 * Math.PI * k / 16; return at(Math.cos(a) * S.r, S.z + Math.sin(a) * S.r * zr); }), out, COL.gilt, MAT.GILT);
    for (const sg of [-1, 1]) {
      const pts = [];
      for (let k = 0; k <= 4; k++) { const a = -0.9 + 1.8 * k / 4; pts.push([sg * S.r * (1 - 0.45 * Math.cos(a)), S.z + Math.sin(a) * S.r * 0.8 * zr]); }
      for (let k = 0; k < 4; k++) bface(plain, [at(pts[k][0] - 0.0012, pts[k][1], 0.0044), at(pts[k + 1][0] - 0.0012, pts[k + 1][1], 0.0044), at(pts[k + 1][0] + 0.0012, pts[k + 1][1], 0.0044), at(pts[k][0] + 0.0012, pts[k][1], 0.0044)], out, COL.red, MAT.SATIN);
    }
    for (let k = 0; k < S.rays; k++) {
      const a = 2 * Math.PI * (k + 0.5) / S.rays, c = Math.cos(a), s = Math.sin(a), w = 0.0025, r0 = S.r + 0.004, r1 = S.r + S.ray * (k % 2 ? 0.7 : 1);
      bface(plain, [at(c * r0 - s * w, S.z + (s * r0 + c * w) * zr), at(c * r0 + s * w, S.z + (s * r0 - c * w) * zr), at(c * r1 + s * w, S.z + (s * r1 - c * w) * zr), at(c * r1 - s * w, S.z + (s * r1 + c * w) * zr)], out, COL.gilt, MAT.GILT);
    }
  }
  bbox(lamps.beacon, -0.004, 0.004, Lv - 0.004, Lv + 0.004, Lt.beacon - 0.004, Lt.beacon + 0.004, [9, 1.2, 0.8], MAT.EMISSIVE);
}

// A shell, built shut (the map's arm, section 10, `shell`): each band of its level's arch along its
// length, those along the crown its glazing strip, see-through; its underside SKIN feet in, painted
// steel (a mirror under the floods read as black with a blot for every lamp); a bronze rib at every
// DOME.ribs, standing proud and stepping with the arch, and under it the steel arch it's the top of;
// between the arches pale Warren trusses that read against the dark underside, with purlins along
// the vault; and its ends. ⚠ NOTHING HANGS PAST SHELL_STEEL: the shell under this one slides through
// beneath it with its ribs up (ballpark-smoke).
// ⚠ AN INNER END IS A BEAM, NOT A WALL. The map closes every end with a panel across the whole arch,
// which nobody sees from above; from the field it walled the roof off where one shell meets the next.
// So an end where the shells step is a band under the arch, deeper than any gap between two shells,
// and only the two outer ends are walls, the glass fans.
function buildShell(S, i) {
  const b = createBatch(16384), k = S.k, v0 = S.shut, v1 = v0 + S.len;
  const A = shellArch(k), U = archOf(profileIn(k, SKIN)), St = archOf(profileIn(k, SHELL_STEEL)), Tr = archOf(profileIn(k, SHELL_STEEL - 0.8)), Cn = archOf(profileIn(k, SKIN + 1.1));
  const Bm = archOf(profileIn(k, 0.05 * KH)), n = A.length - 1, zs = springZ(k), D = DOME;
  const at = (p, v) => [p[0], v, p[1]], neg = (o) => o.map((x) => -x);
  const nOut = (j) => [A[j][1] - A[j + 1][1], 0, A[j + 1][0] - A[j][0]];
  const lift = (j, h) => { const a = nOut(Math.max(0, j - 1)), c = nOut(Math.min(n - 1, j)), la = Math.hypot(a[0], a[2]) || 1, lc = Math.hypot(c[0], c[2]) || 1, m = [a[0] / la + c[0] / lc, a[2] / la + c[2] / lc], l = Math.hypot(m[0], m[1]) || 1; return [A[j][0] + m[0] / l * h, A[j][1] + m[1] / l * h]; };
  for (let j = 0; j < n; j++) {
    const g = Math.abs(A[j][0] + A[j + 1][0]) / 2 < D.glaze - k * D.dr, uv = g ? ROOF_GLASS : [0, 0], o = nOut(j);
    bface(b, [at(A[j], v0), at(A[j + 1], v0), at(A[j + 1], v1), at(A[j], v1)], o, g ? COL.glass : COL.leaf, g ? MAT.GLAZE : MAT.METAL, uv);
    bface(b, [at(U[j], v0), at(U[j + 1], v0), at(U[j + 1], v1), at(U[j], v1)], neg(o), g ? COL.glass : COL.shellIn, g ? MAT.GLAZE : MAT.CONCRETE, uv);
    for (const f of D.ribs) {
      const w = D.ribW / 2, vr = v0 + S.len * f, va = vr - w, vb = vr + w, ea = lift(j, D.rib), eb = lift(j + 1, D.rib);
      bface(b, [at(ea, va), at(eb, va), at(eb, vb), at(ea, vb)], o, COL.rib, MAT.GILT);
      bface(b, [at(A[j], va), at(A[j + 1], va), at(eb, va), at(ea, va)], [0, -1, 0], COL.rib, MAT.GILT);
      bface(b, [at(A[j], vb), at(A[j + 1], vb), at(eb, vb), at(ea, vb)], [0, 1, 0], COL.rib, MAT.GILT);
      // the steel arch under it
      bface(b, [at(St[j], va), at(St[j + 1], va), at(St[j + 1], vb), at(St[j], vb)], neg(o), COL.steel, MAT.CONCRETE);
      bface(b, [at(U[j], va), at(U[j + 1], va), at(St[j + 1], va), at(St[j], va)], [0, -1, 0], COL.steel, MAT.CONCRETE);
      bface(b, [at(U[j], vb), at(U[j + 1], vb), at(St[j + 1], vb), at(St[j], vb)], [0, 1, 0], COL.steel, MAT.CONCRETE);
    }
    // the trusses between the arches: a bottom chord, and a Warren web zigzagging bay to bay
    for (let q = 0; q + 1 < D.ribs.length; q++) {
      const vt = v0 + S.len * (D.ribs[q] + D.ribs[q + 1]) / 2, tw = 0.0035, va = vt - tw, vb = vt + tw, [ja, jb] = j % 2 ? [j, j + 1] : [j + 1, j];
      bface(b, [at(Tr[j], va), at(Tr[j + 1], va), at(Tr[j + 1], vb), at(Tr[j], vb)], neg(o), COL.truss, MAT.CONCRETE);
      bface(b, [at(U[ja], va), at(U[ja], vb), at(Tr[jb], vb), at(Tr[jb], va)], neg(o), COL.truss, MAT.CONCRETE);
    }
    if (j % 2 === 0 && j > 1 && j < n - 2) {   // a purlin along the vault, on every other panel line
      const w = 0.003, s = (p, d) => [p[0] + d, p[1]];
      bface(b, [at(s(Cn[j], -w), v0), at(s(Cn[j], w), v0), at(s(Cn[j], w), v1), at(s(Cn[j], -w), v1)], neg(o), COL.truss, MAT.CONCRETE);
    }
  }
  for (const [ve, sg] of [[v0, -1], [v1, 1]]) {
    const out = [0, sg, 0], fan = isFan(i, sg);
    if (!fan) {
      // its outer face, and its inner face a few inches in, each lit from its own side
      for (const [v, o, col, mat] of [[ve, out, COL.leaf, MAT.METAL], [ve - sg * 0.0015, neg(out), COL.shellIn, MAT.CONCRETE]]) {
        for (let j = 0; j < n; j++) bface(b, [at(A[j], v), at(A[j + 1], v), at(Bm[j + 1], v), at(Bm[j], v)], o, col, mat);
      }
      continue;
    }
    const hub = [0, ve, zs];
    for (let j = 0; j < n; j++) bface(b, [hub, at(A[j], ve), at(A[j + 1], ve)], out, COL.glass, MAT.GLAZE, ROOF_GLASS);
    const vo = ve + sg * 0.003, hr = 0.07, F = (u, z) => [u, vo, z];
    for (let j = 3; j + 3 < n + 1; j += 3) {   // the rays, from the hub to every third point of the arch
      const a = A[j], du = a[0], dz = a[1] - zs, dl = Math.hypot(du, dz) || 1, pu = -dz / dl * 0.0055, pz = du / dl * 0.0055, s0 = [du / dl * hr, zs + dz / dl * hr];
      bface(b, [F(s0[0] + pu, s0[1] + pz), F(a[0] + pu, a[1] + pz), F(a[0] - pu, a[1] - pz), F(s0[0] - pu, s0[1] - pz)], out, COL.bronze, MAT.GILT);
    }
    for (let j = 0; j < n; j++) {   // the frame round the arch, a band in from it
      const ins = (p) => [p[0] * 0.955, zs + (p[1] - zs) * 0.955], ia = ins(A[j]), ic = ins(A[j + 1]);
      bface(b, [F(A[j][0], A[j][1]), F(A[j + 1][0], A[j + 1][1]), F(ic[0], ic[1]), F(ia[0], ia[1])], out, COL.bronze, MAT.GILT);
    }
    bface(b, Array.from({ length: 9 }, (_, q) => { const t = Math.PI * q / 8; return F(Math.cos(t) * hr, zs + Math.sin(t) * hr); }), out, COL.gilt, MAT.GILT);
  }
  return b;
}

// The plate over a gate, the name on it painted (ballpark.js paintPlates): a quad standing off the
// stone (PLAQUE), a halo round it on the plane behind for after dark, and the bronze it hangs from.
// `cell` is its rect in PLATE_ATLAS; `east` whether the reader's right is the map's east.
function plateAt(plain, lamps, plates, gu, yp, pz0, pz1, phw, sgOut, cell, east) {
  const t = 0.007, yr = yp - sgOut * 0.004, out = [0, sgOut, 0];
  const PQ = (b, y, x0, x1, za, zb, col, mat) => bface(b, [[x0, y, zb], [x1, y, zb], [x1, y, za], [x0, y, za]], out, col, mat);
  PQ(lamps.halo, yr, gu - phw - t, gu + phw + t, pz1, pz1 + t, [5, 3.4, 1.8], MAT.EMISSIVE); PQ(lamps.halo, yr, gu - phw - t, gu + phw + t, pz0 - t, pz0, [5, 3.4, 1.8], MAT.EMISSIVE);
  PQ(lamps.halo, yr, gu - phw - t, gu - phw, pz0, pz1, [5, 3.4, 1.8], MAT.EMISSIVE); PQ(lamps.halo, yr, gu + phw, gu + phw + t, pz0, pz1, [5, 3.4, 1.8], MAT.EMISSIVE);
  // the bronze bracket it stands off the stone on, inside the halo
  bbox(plain, gu - phw + 0.01, gu + phw - 0.01, yp - sgOut * 0.016, yp - sgOut * 0.002, pz0 + 0.01, pz1 - 0.01, COL.plate, MAT.GILT);
  const W = PLATE_ATLAS.w, Hh = PLATE_ATLAS.h, [cx, cy, cw, ch] = cell, u0 = cx / W, u1 = (cx + cw) / W, v0 = cy / Hh, v1 = (cy + ch) / Hh;
  // the reader's left first, at the foot
  const L = east ? gu - phw : gu + phw, Rr = east ? gu + phw : gu - phw;
  const Wp = [[L, yp, pz0], [Rr, yp, pz0], [Rr, yp, pz1], [L, yp, pz1]].map(([u, v, z]) => B2T(u, v, z));
  quad(plates, Wp[0], Wp[1], Wp[2], Wp[3], norm(sf(0, -sgOut)), WHITE, MAT.PLAQUE, [[u0, v1], [u1, v1], [u1, v0], [u0, v0]]);
}

// The park's name cut into a face's band (the map's `inscribe`): the band's front, a hair proud of
// its stone, in two halves from the reader's left, each one cell of the atlas, where paintPlates has
// cut the line. DECO, so it takes the stone's light and coursing and meets the band without a seam.
// `east` whether the reader's right is the map's east.
// ⚠ THE ATLAS PAINTS THE STONE GREY (BAND_STONE), so the cut's lit lip can be paler than the stone
// round it; the face's colour is the band's over that grey, so the stone matches its box.
export const BAND_STONE = 200;
function bandAt(plates, n, run, cells, east) {
  const d = BAND.d + 0.0015, mid = (run[0] + run[1]) / 2, ends = east ? [run[0], mid, run[1]] : [run[1], mid, run[0]];
  const W = PLATE_ATLAS.w, Hh = PLATE_ATLAS.h, nn = norm(sf(0, -n[1])), col = mul(COL.trim, 1 / decode(BAND_STONE / 255));
  cells.forEach(([cx, cy, cw, ch], i) => {
    const L = ends[i], R = ends[i + 1], u0 = cx / W, u1 = (cx + cw) / W, v0 = cy / Hh, v1 = (cy + ch) / Hh;
    const Wp = [[L, BAND.z0], [R, BAND.z0], [R, BAND.z1], [L, BAND.z1]].map(([t, z]) => B2T(t, n[1] * (OUT + d), z));
    quad(plates, Wp[0], Wp[1], Wp[2], Wp[3], nn, col, MAT.DECO, [[u0, v1], [u1, v1], [u1, v0], [u0, v0]]);
  });
}

// The main gate on Sorrel Way: a stepped frontispiece between two Guardian pylons, a portal in three
// receding orders round bronze doors and a sunburst fanlight, a narrow grille gate with a lantern over
// it either side, GRANDSTAND on its plate, the gilt rising sun on the setback with a baseball for its
// disc, and the flag. The map's section 8, line for line.
function mainGate(plain, lamps, plates) {
  const G = GATE, gu = G.u, gf = G.face, u0 = gu - G.hw, u1 = gu + G.hw;
  const face = (pts, col, mat = MAT.DECO, uv) => bface(plain, pts, [0, 1, 0], col, mat, uv);
  bbox(plain, u0, u1, GATE_BACK, gf, Z.plinth, G.top, COL.stone, MAT.DECO);
  bbox(plain, u0 - 0.005, u1 + 0.005, GATE_BACK, gf + 0.006, 0, Z.plinth, COL.granite, MAT.DECO);
  bbox(plain, u0, u1, GATE_BACK, gf + 0.004, G.top, G.top + 0.012, COL.trim, MAT.DECO, COL.copper);
  // the setback, between the pylons' inner faces
  const sb = G.hw - 2 * GUARD.hw;
  bbox(plain, gu - sb, gu + sb, GATE_BACK, gf - 0.004, G.top + 0.012, 0.60, COL.stone, MAT.DECO);
  bbox(plain, gu - sb, gu + sb, GATE_BACK, gf - 0.001, 0.60, 0.61, COL.trim, MAT.DECO, COL.copper);
  bbox(plain, gu - 0.10, gu + 0.10, GATE_BACK, gf - 0.008, 0.61, 0.655, COL.stone, MAT.DECO, COL.copper);
  // THE GUARDIANS, after the Hope Memorial Bridge's in Cleveland: a pylon either side of the gate,
  // fluted below, and on a corbel halfway up it a helmeted figure in relief, robed to the feet,
  // square-shouldered, the west one cradling a gilt ball and the east one resting on a gilt bat held
  // point-down. ⚠ ROUND ON THE MAP IS ROUND HERE TOO: the map draws z 1.4 times taller and this view
  // ftUp, so a circle's height is its radius times ZR, not the map's 1/1.4.
  const ZR = KH / ftUp(1), FIG = lin('#c8b89a'), FOLD = lin('#968870');
  for (const [sg, pu] of [[-1, u0 + GUARD.hw], [1, u1 - GUARD.hw]]) {
    const ph = GUARD.hw, yF = gf + 0.006;
    bbox(plain, pu - ph - 0.006, pu + ph + 0.006, GATE_BACK, gf + 0.010, 0, Z.plinth, COL.granite, MAT.DECO);
    bbox(plain, pu - ph, pu + ph, GATE_BACK, yF, Z.plinth, GUARD.top, COL.stone, MAT.DECO);
    bbox(plain, pu - ph + 0.006, pu + ph - 0.006, GATE_BACK, yF - 0.002, GUARD.top, GUARD.top + 0.012, COL.trim, MAT.DECO, COL.copper);
    bbox(plain, pu - ph + 0.017, pu + ph - 0.017, GATE_BACK, yF - 0.006, GUARD.top + 0.012, GUARD.top + 0.026, COL.trim, MAT.DECO, COL.copper);
    bbox(plain, pu - ph + 0.029, pu + ph - 0.029, GATE_BACK, yF - 0.010, GUARD.top + 0.026, GUARD.top + 0.038, COL.trim, MAT.DECO, COL.copper);
    for (const o of [-0.03, 0, 0.03]) face([[pu + o - 0.002, yF + 0.0006, 0.25], [pu + o + 0.002, yF + 0.0006, 0.25], [pu + o + 0.002, yF + 0.0006, 0.06], [pu + o - 0.002, yF + 0.0006, 0.06]], COL.flute);
    // the corbel, stepped
    bbox(plain, pu - 0.032, pu + 0.032, yF, yF + 0.008, 0.256, 0.272, COL.trim, MAT.DECO);
    bbox(plain, pu - 0.044, pu + 0.044, yF, yF + 0.012, 0.272, 0.286, COL.trim, MAT.DECO);
    // The figure, carved (the map's `carve`): each piece a convex outline [u, z] on the pylon's face,
    // its front `d` proud and its sides back to the face, dressed stone with no coursing.
    const carve = (sil, d) => {
      const cu = sil.reduce((t, p) => t + p[0], 0) / sil.length, cz = sil.reduce((t, p) => t + p[1], 0) / sil.length;
      face(sil.map(([a, z]) => [pu + a, yF + d, z]), FIG, MAT.DECO, DRESSED);
      sil.forEach((p, i) => {
        const q = sil[(i + 1) % sil.length], mu = (p[0] + q[0]) / 2 - cu, mz = (p[1] + q[1]) / 2 - cz;
        let nu = q[1] - p[1], nz = -(q[0] - p[0]);
        if (nu * mu + nz * mz < 0) { nu = -nu; nz = -nz; }
        bface(plain, [[pu + p[0], yF, p[1]], [pu + q[0], yF, q[1]], [pu + q[0], yF + d, q[1]], [pu + p[0], yF + d, p[1]]], [nu, 0, nz], FIG, MAT.DECO, DRESSED);
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
    for (const o of [-0.014, 0, 0.014]) face([[pu + o - 0.0012, yF + 0.0093, 0.425], [pu + o + 0.0012, yF + 0.0093, 0.425], [pu + o + 0.0012, yF + 0.0093, 0.292], [pu + o - 0.0012, yF + 0.0093, 0.292]], FOLD, MAT.DECO, DRESSED);   // the robe's folds
    face([[pu - 0.0125, yF + 0.0122, 0.531], [pu + 0.0125, yF + 0.0122, 0.531], [pu + 0.0125, yF + 0.0122, 0.526], [pu - 0.0125, yF + 0.0122, 0.526]], FOLD, MAT.DECO, DRESSED);   // the brim's shadow over the eyes
    // the forearms across the body, and what the hands hold
    if (sg < 0) {
      carve([[-0.033, 0.437], [0.033, 0.437], [0.033, 0.452], [-0.033, 0.452]], 0.0125);
      const yb = yF + 0.0133, rr = 0.017, zc = 0.452 + rr * ZR, disc = [];
      for (let k = 0; k < 16; k++) { const a = TAU * k / 16; disc.push([pu + Math.cos(a) * rr, yb, zc + Math.sin(a) * rr * ZR]); }
      face(disc, COL.gilt, MAT.GILT);
      for (const ss of [-1, 1]) {   // its stitches, two arcs bowed in toward the middle
        const pts = [];
        for (let k = 0; k <= 4; k++) { const a = -1.2 + 2.4 * k / 4; pts.push([pu + ss * rr * (0.8 - 0.35 * Math.cos(a)), zc + Math.sin(a) * rr * 0.8 * ZR]); }
        for (let k = 0; k < 4; k++) face([[pts[k][0] - 0.001, yb + 0.0004, pts[k][1]], [pts[k + 1][0] - 0.001, yb + 0.0004, pts[k + 1][1]], [pts[k + 1][0] + 0.001, yb + 0.0004, pts[k + 1][1]], [pts[k][0] + 0.001, yb + 0.0004, pts[k][1]]], COL.red);
      }
    } else {
      const yb = yF + 0.0115;   // the bat stands on the robe, under the hands
      face([[pu - 0.0028, yb, 0.47], [pu + 0.0028, yb, 0.47], [pu + 0.0085, yb, 0.30], [pu - 0.0085, yb, 0.30]], COL.gilt, MAT.GILT);
      face([[pu - 0.006, yb, 0.476], [pu + 0.006, yb, 0.476], [pu + 0.006, yb, 0.469], [pu - 0.006, yb, 0.469]], COL.gilt, MAT.GILT);   // the knob
      carve([[-0.033, 0.446], [0.033, 0.446], [0.033, 0.46], [-0.033, 0.46]], 0.0125);
      carve([[-0.009, 0.443], [0.009, 0.443], [0.009, 0.468], [-0.009, 0.468]], 0.0132);   // the hands, one over the other on the handle
    }
  }
  // the portal: three orders, the inner one least proud, each stepping out and up
  const ow = 0.075, zO = 0.27, dz = 0.022;
  for (let i = 0; i < 3; i++) {
    const d = 0.006 * (i + 1), jx = ow + 0.016 * (i + 0.5);
    for (const sg of [-1, 1]) bbox(plain, gu + sg * jx - 0.008, gu + sg * jx + 0.008, gf - 0.01, gf + d, 0, zO + dz * i, COL.trim, MAT.DECO);
    bbox(plain, gu - jx - 0.008, gu + jx + 0.008, gf - 0.01, gf + d, zO + dz * i, zO + dz * (i + 1), COL.trim, MAT.DECO);
  }
  // the doors on the body's face, the inner order standing 0.006 off them for the reveal
  const yd = gf + 0.0015;
  face([[gu - ow, yd - 0.0006, zO], [gu + ow, yd - 0.0006, zO], [gu + ow, yd - 0.0006, 0], [gu - ow, yd - 0.0006, 0]], COL.bronze, MAT.GILT);
  for (const sg of [-1, 1]) {
    const a = gu + sg * 0.004, b = gu + sg * (ow - 0.006);
    face([[Math.min(a, b), yd, 0.165], [Math.max(a, b), yd, 0.165], [Math.max(a, b), yd, 0.006], [Math.min(a, b), yd, 0.006]], COL.lobby, MAT.GLAZE, [1, 0]);
    face([[gu + sg * 0.010 - 0.002, yd + 0.0004, 0.10], [gu + sg * 0.010 + 0.002, yd + 0.0004, 0.10], [gu + sg * 0.010 + 0.002, yd + 0.0004, 0.06], [gu + sg * 0.010 - 0.002, yd + 0.0004, 0.06]], COL.gilt, MAT.GILT);
  }
  face([[gu - ow, yd, 0.173], [gu + ow, yd, 0.173], [gu + ow, yd, 0.165], [gu - ow, yd, 0.165]], COL.gilt, MAT.GILT);
  {   // the sunburst fanlight over the doors: a half-disc of glass and seven bronze rays
    const r = ow - 0.006, zb = 0.173, fanPts = [[gu, yd, zb]];
    for (let k = 0; k <= 16; k++) { const t = Math.PI * k / 16; fanPts.push([gu + Math.cos(t) * r, yd, zb + Math.sin(t) * r]); }
    face(fanPts, COL.lobby, MAT.GLAZE, [1, 0]);
    for (let k = 1; k < 8; k++) {
      const t = Math.PI * k / 8, c = Math.cos(t), s = Math.sin(t), w = 0.0022;
      face([[gu - s * w, yd + 0.0004, zb + c * w], [gu + s * w, yd + 0.0004, zb - c * w], [gu + c * r + s * w, yd + 0.0004, zb + s * r - c * w], [gu + c * r - s * w, yd + 0.0004, zb + s * r + c * w]], COL.bronze, MAT.GILT);
    }
  }
  // the grille gates either side, narrow between a Guardian and the portal: dark openings under lit
  // transoms, iron bars, a bronze lantern over each
  for (const bu of [gu - 0.1535, gu + 0.1535]) {
    face([[bu - 0.022, yd, 0.16], [bu + 0.022, yd, 0.16], [bu + 0.022, yd, 0], [bu - 0.022, yd, 0]], COL.grille, MAT.GLAZE, [1, 0]);
    face([[bu - 0.022, yd, 0.19], [bu + 0.022, yd, 0.19], [bu + 0.022, yd, 0.166], [bu - 0.022, yd, 0.166]], COL.lobby, MAT.GLAZE, [1, 0]);
    bbox(plain, bu - 0.028, bu + 0.028, gf - 0.01, gf + 0.008, 0.19, 0.204, COL.trim, MAT.DECO);
    for (const sg of [-1, 1]) bbox(plain, bu + sg * 0.025 - 0.003, bu + sg * 0.025 + 0.003, gf - 0.01, gf + 0.008, 0, 0.19, COL.trim, MAT.DECO);
    for (let k = -2; k <= 2; k++) bbox(plain, bu + k * 0.008 - 0.0008, bu + k * 0.008 + 0.0008, yd + 0.0006, yd + 0.0022, 0.005, 0.158, lin('#202224'), MAT.METAL);
    bdrum(plain, bu, gf + 0.0095, 0.214, 0.22, 0.0095, 0.0095, COL.bronze, MAT.GILT);
    bdrum(lamps.lantern, bu, gf + 0.0095, 0.22, 0.256, 0.0085, 0.0085, [6, 4.6, 2.8], MAT.EMISSIVE);
    bdrum(plain, bu, gf + 0.0095, 0.256, 0.264, 0.0095, 0.004, COL.bronze, MAT.GILT);
  }
  // THE PLATE, GRANDSTAND on it, standing 0.016 off the stone and clear of the Guardians
  plateAt(plain, lamps, plates, gu, gf + 0.016, MAIN_PLATE.z0, MAIN_PLATE.z1, MAIN_PLATE.hw, 1, PLATE_ATLAS.main, true);
  // the rising sun on the setback's face: a gilt baseball for its disc, red stitching, nine rays
  {
    const ys = gf - 0.004 + 0.0015, zs = G.top + 0.012, rd = 0.019;
    const disc = [[gu, ys, zs]];
    for (let k = 0; k <= 12; k++) { const a = Math.PI * k / 12; disc.push([gu + Math.cos(a) * rd, ys, zs + Math.sin(a) * rd]); }
    face(disc, COL.gilt, MAT.GILT);
    for (const sg of [-1, 1]) {   // the stitches: two arcs of red, curving in toward the top
      const pts = [];
      for (let k = 0; k <= 4; k++) { const a = Math.PI * (0.18 + 0.32 * k / 4); pts.push([gu + sg * Math.cos(a) * rd * 0.62 + sg * 0.004, ys + 0.0004, zs + Math.sin(a) * rd * 0.8]); }
      for (let k = 0; k < 4; k++) face([[pts[k][0] - 0.0012, ys + 0.0004, pts[k][2]], [pts[k + 1][0] - 0.0012, ys + 0.0004, pts[k + 1][2]], [pts[k + 1][0] + 0.0012, ys + 0.0004, pts[k + 1][2]], [pts[k][0] + 0.0012, ys + 0.0004, pts[k][2]]], COL.red);
    }
    for (let k = 1; k < 10; k++) {
      const a = Math.PI * k / 10, c = Math.cos(a), s = Math.sin(a), w = 0.0022, r0 = rd + 0.006, r1 = rd + 0.03 + (k % 2) * 0.008;
      face([[gu + c * r0 - s * w, ys, zs + s * r0 + c * w], [gu + c * r0 + s * w, ys, zs + s * r0 - c * w], [gu + c * r1 + s * w, ys, zs + s * r1 - c * w], [gu + c * r1 - s * w, ys, zs + s * r1 + c * w]], COL.gilt, MAT.GILT);
    }
  }
  // the flag, from the top of the frontispiece
  {
    const p = B2T(gu, gf - 0.04, 0.655), top = ftUp(0.80) - p[1];
    cylinder(plain, p, top, 0.5, COL.pole, MAT.METAL, 6);
    const along = norm(sf(-1, 0)), y = p[1] + top;
    quad(plain, [p[0], y - 1, p[2]], madd([p[0], y - 1.5, p[2]], along, 22), madd([p[0], y - 14.5, p[2]], along, 22), [p[0], y - 14, p[2]], norm(sf(0, -1)), COL.flag, MAT.CLOTH);
  }
}

// The bleacher gate on Halcyon Boulevard: two grille gates between pylons and BLEACHERS in gilt on
// bronze over them. The map's section 9.
function bleacherGate(plain, lamps, plates) {
  const G = BGATE, gu = G.u, gf = G.face, u0 = gu - G.hw, u1 = gu + G.hw, yd = gf - 0.0015;
  const face = (pts, col, mat = MAT.DECO, uv) => bface(plain, pts, [0, -1, 0], col, mat, uv);
  bbox(plain, u0, u1, gf, -GATE_BACK, Z.plinth, G.top, COL.stone, MAT.DECO);
  bbox(plain, u0 - 0.005, u1 + 0.005, gf - 0.006, -GATE_BACK, 0, Z.plinth, COL.granite, MAT.DECO);
  bbox(plain, u0, u1, gf - 0.004, -GATE_BACK, G.top, G.top + 0.012, COL.trim, MAT.DECO, COL.copper);
  bbox(plain, gu - 0.16, gu + 0.16, gf + 0.004, -GATE_BACK, G.top + 0.012, 0.50, COL.stone, MAT.DECO);
  bbox(plain, gu - 0.16, gu + 0.16, gf + 0.001, -GATE_BACK, 0.50, 0.51, COL.trim, MAT.DECO, COL.copper);
  for (const pu of [u0 + 0.025, u1 - 0.025]) {
    bbox(plain, pu - 0.025, pu + 0.025, gf - 0.015, -GATE_BACK, 0, 0.47, COL.stone, MAT.DECO);
    bbox(plain, pu - 0.019, pu + 0.019, gf - 0.012, -GATE_BACK, 0.47, 0.484, COL.trim, MAT.DECO, COL.copper);
    for (const o of [-0.012, 0.012]) face([[pu + o + 0.0018, gf - 0.0155, 0.44], [pu + o - 0.0018, gf - 0.0155, 0.44], [pu + o - 0.0018, gf - 0.0155, 0.06], [pu + o + 0.0018, gf - 0.0155, 0.06]], COL.flute);
  }
  for (const bu of [gu - 0.07, gu + 0.07]) {
    face([[bu + 0.045, yd, 0.19], [bu - 0.045, yd, 0.19], [bu - 0.045, yd, 0], [bu + 0.045, yd, 0]], COL.grille, MAT.GLAZE, [1, 0]);
    bbox(plain, bu - 0.054, bu + 0.054, gf - 0.008, gf + 0.01, 0.19, 0.205, COL.trim, MAT.DECO);
    for (const sg of [-1, 1]) bbox(plain, bu + sg * 0.05 - 0.005, bu + sg * 0.05 + 0.005, gf - 0.008, gf + 0.01, 0, 0.19, COL.trim, MAT.DECO);
    for (let k = -3; k <= 3; k++) bbox(plain, bu + k * 0.012 - 0.0008, bu + k * 0.012 + 0.0008, yd - 0.0022, yd - 0.0006, 0.005, 0.185, lin('#202224'), MAT.METAL);
    bdrum(plain, bu, gf - 0.0095, 0.215, 0.22, 0.009, 0.009, COL.bronze, MAT.GILT);
    bdrum(lamps.lantern, bu, gf - 0.0095, 0.22, 0.254, 0.008, 0.008, [6, 4.6, 2.8], MAT.EMISSIVE);
    bdrum(plain, bu, gf - 0.0095, 0.254, 0.262, 0.009, 0.004, COL.bronze, MAT.GILT);
  }
  plateAt(plain, lamps, plates, gu, gf - 0.014, 0.26, 0.345, 0.15, -1, PLATE_ATLAS.bleach, false);
}

// The main gate's plate, for the gates: its middle, the way it faces, and its half-width and
// half-height in feet.
export const PARK_SIGN = Object.freeze({ c: B2T(GATE.u, GATE.face + 0.016, (MAIN_PLATE.z0 + MAIN_PLATE.z1) / 2), n: norm(sf(0, -1)), w: MAIN_PLATE.hw * KH, h: ftUp((MAIN_PLATE.z1 - MAIN_PLATE.z0) / 2) });

// Where the scoreboard hangs and which way it faces: centre, normal (toward the plate),
// the face's horizontal axis, half-width and half-height, and its yaw in degrees.
function boardFrame(field) {
  const th = field.board.bearing * DEG, R = field.board.r;
  const c = [Math.sin(th) * R, 66, Math.cos(th) * R], n = norm([-c[0], 0, -c[2]]);
  return { c, n, t: norm(cross([0, 1, 0], n)), w: 62, h: 21, yaw: Math.atan2(n[0], n[2]) / DEG + 180 };
}

// The videoboard's frame, the scoreboard's shape at 16:9: 96 by 54 ft, standing across centre
// field from it.
function jumboFrame(field) {
  const j = field.jumbo || { bearing: 31, r: 420 };
  const th = j.bearing * DEG, R = j.r;
  const c = [Math.sin(th) * R, 72, Math.cos(th) * R], n = norm([-c[0], 0, -c[2]]);
  return { c, n, t: norm(cross([0, 1, 0], n)), w: 48, h: 27, yaw: Math.atan2(n[0], n[2]) / DEG + 180 };
}

// ── the crowd's figures ─────────────────────────────────────────────────────
// One figure a kind, instanced over the crowd's positions: 7 floats a vertex, position (3),
// normal (3) and the part. `far` is the coarse level for a crowd seen from the broadcast cameras.
//
// ⚠ IT READS AS A PERSON BY ITS SILHOUETTE, so the shape is in the outline, not the detail: a torso
// lofted from rings (hips, waist, chest, shoulders broader than the hips), a head on top of it,
// upper arms and forearms, hands, legs and shoes. The look-dev's egg on tubes read as a bottle from
// the cameras' distances, sitting or walking.
//
// ⚠ THE PART IS A CODE THE SHADERS READ BY RANGE: below 0.5 skin, below 1.5 shirt, below 2.5
// trousers, below 3.5 dark (hair, shoes), 4 a rally towel. The quarter values inside a range say
// which limb a vertex is on, for the walker (gl/streetlife.js), whose arms and legs swing:
//   0 face and neck   0.25 a hand   1 the shirt   1.25 a sleeve   1.75 the hips
//   2.25 a leg        3 hair        3.25 a shoe
export const CROWD_PART = Object.freeze({ skin: 0, hand: 0.25, shirt: 1, sleeve: 1.25, hips: 1.75, leg: 2.25, hair: 3, shoe: 3.25, face: 3.45, towel: 4 });
const CP = CROWD_PART;
// Each pose's joints, in feet, the figure facing +z. Every pose is built from the same pieces in
// the same order, so the three pair up vertex for vertex (crowdMorph).
const CROWD_POSE = {
  stand: { lift: 0, lean: 0, hip: [0.19, 3.15, 0], knee: [0.21, 1.72, 0.04], ankle: [0.21, 0.28, 0], shoe: [0.21, 0.13, 0.1],
    sh: [0.48, 4.68, 0], elbow: [0.56, 3.86, 0.04], wrist: [0.53, 3.06, 0.16], hand: [0.53, 2.93, 0.18] },
  sit: { lift: -1.45, lean: -0.1, hip: [0.19, 1.75, 0.02], knee: [0.21, 1.8, 1.38], ankle: [0.21, 0.3, 1.5], shoe: [0.21, 0.13, 1.62],
    sh: [0.48, 3.23, -0.1], elbow: [0.55, 2.42, 0.1], wrist: [0.32, 2.04, 0.74], hand: [0.29, 1.97, 0.84] },
  cheer: { lift: 0, lean: 0, hip: [0.19, 3.15, 0], knee: [0.21, 1.72, 0.04], ankle: [0.21, 0.28, 0], shoe: [0.21, 0.13, 0.1],
    sh: [0.48, 4.68, 0], elbow: [0.78, 5.5, 0.1], wrist: [0.66, 6.34, 0.15], hand: [0.64, 6.5, 0.15] },
};
// The torso's rings from the crotch to the top of the shoulders: height, half-width, half-depth,
// and the part of the band above it.
const TORSO = [[2.92, 0.24, 0.16, CP.hips], [3.2, 0.4, 0.25, CP.hips], [3.62, 0.35, 0.22, CP.shirt], [4.25, 0.44, 0.26, CP.shirt], [4.68, 0.5, 0.24, CP.shirt], [4.96, 0.3, 0.18, CP.shirt]];
export function crowdMesh(kind, { towels = false, far = false } = {}) {
  const ER = far ? 4 : 5, EC = far ? 6 : 10, TC = far ? 4 : 6, SR = 2, SC = far ? 3 : 5;
  const J = CROWD_POSE[kind === 'sit' ? 'sit' : kind === 'cheer' ? 'cheer' : 'stand'];
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
  // the torso, lofted ring to ring; sitting, it drops to the seat and leans back a little
  const ring = (k, ph) => {
    const [y, rx, rz] = TORSO[k], f = (y - TORSO[0][0]) / (TORSO[TORSO.length - 1][0] - TORSO[0][0]);
    const c = [0, y + J.lift, J.lean * f];
    return [[c[0] + Math.sin(ph) * rx, c[1], c[2] + Math.cos(ph) * rz], norm([Math.sin(ph) / rx, 0, Math.cos(ph) / rz])];
  };
  for (let k = 0; k + 1 < TORSO.length; k++) for (let j = 0; j < EC; j++) {
    const p0 = j / EC * TAU, p1 = (j + 1) / EC * TAU;
    const a = ring(k, p0), b = ring(k, p1), c = ring(k + 1, p1), d = ring(k + 1, p0);
    for (const q of [a, b, c, a, c, d]) push(q[0], q[1], TORSO[k][3]);
  }
  // the head on the shoulders, and the hair over it
  const top = TORSO[TORSO.length - 1][0] + J.lift, hz = J.lean;
  ell([0, top + 0.33, hz + 0.03], [0.25, 0.31, 0.27], CP.skin);
  ell([0, top + 0.41, hz - 0.01], [0.27, 0.29, 0.29], CP.hair, Math.ceil(ER * 2 / 3), EC, 0.5);
  for (const sg of [-1, 1]) {
    const m = (v) => [sg * v[0], v[1], v[2]];
    tube(m(J.hip), m(J.knee), 0.24, 0.18, CP.leg); tube(m(J.knee), m(J.ankle), 0.17, 0.12, CP.leg);
    ell(m(J.shoe), [0.14, 0.12, 0.3], CP.shoe, SR, SC);
    tube(m(J.sh), m(J.elbow), 0.14, 0.11, CP.sleeve); tube(m(J.elbow), m(J.wrist), 0.1, 0.08, CP.sleeve);
    ell(m(J.hand), [0.075, 0.1, 0.075], CP.hand, SR, SC);
  }
  if (kind === 'cheer' && towels) {
    // a rally towel in the right hand, caught mid-wave, both faces
    const q = (a, b, c2, d) => { const n = norm(cross(sub(b, a), sub(d, a))); for (const p of [a, b, c2, a, c2, d]) push(p, n, CP.towel); for (const p of [a, c2, b, a, d, c2]) push(p, mul(n, -1), CP.towel); };
    q([0.62, 6.45, 0.14], [1.55, 6.75, 0.0], [1.6, 7.75, -0.05], [0.58, 7.5, 0.1]);
  }
  return new Float32Array(out);
}
export const CROWD_VERTEX = 7;

// The three poses as one figure, so a fan can get up (gl/crowd.js): each vertex's place and
// normal sitting, standing and cheering, then its part. crowdMesh builds every pose from the same
// pieces in the same order, so their vertices pair up; the towel only the cheer holds is folded
// into the hand in the other two.
export const CROWD_MORPH = 19;
const CROWD_HAND = { sit: CROWD_POSE.sit.hand, stand: CROWD_POSE.stand.hand };
export function crowdMorph(o = {}) {
  if (o.street !== false) return streetMorph(o);
  const sit = crowdMesh('sit', { ...o, towels: false }), stand = crowdMesh('stand', { ...o, towels: false }), cheer = crowdMesh('cheer', o);
  const V = CROWD_VERTEX, n = cheer.length / V, body = sit.length / V;
  if (stand.length / V !== body || n < body) throw new Error('the crowd\'s poses no longer pair up');
  const out = new Float32Array(n * CROWD_MORPH);
  for (let i = 0; i < n; i++) {
    const at = i * CROWD_MORPH, c = i * V;
    if (i < body) { out.set(sit.subarray(c, c + 6), at); out.set(stand.subarray(c, c + 6), at + 6); }
    else { out.set([...CROWD_HAND.sit, 0, 1, 0], at); out.set([...CROWD_HAND.stand, 0, 1, 0], at + 6); }
    out.set(cheer.subarray(c, c + 6), at + 12);
    out[at + 18] = cheer[c + 6];
  }
  return out;
}

// The fan as the street's people are (actor3d.js): the same coat, trousers, shoes, hands and head,
// posed by the street rig's own `sit`, `idle` and `cheer` clips, so the stands and the pavement are
// one population. Both levels are the street's far body (612 triangles to the old fan's 260 and 460). Feet, facing +z, in the
// CROWD_MORPH layout, and its parts are CROWD_PART codes, so the crowd shaders don't change. The
// towel hangs off the right hand in the cheer and folds into it in the other two. `street: false`
// on crowdMorph is the old hand-built fan (crowdMesh).
const FT = 1 / FT_M;
// the street rig's materials as the crowd's parts: 0 skin, 1 coat, 2 trousers, 3 shoes, 4 hair, 5 eyes, 6 lips
const STREET_PART = [CP.skin, CP.shirt, CP.leg - 0.25, CP.shoe, CP.hair, CP.hair, CP.skin];
// Kept by `towels` alone: both levels are the one body (`lod` below), so `far` doesn't change it, and
// building it twice was half a second of the park's build. The park's warm-up bakes it in a worker
// (crowd-morph-worker.js) and hands it over with seedCrowdMorph, so the build finds it made.
const _streetMorph = new Map();
export function seedCrowdMorph(towels, out) {
  if (out instanceof Float32Array && out.length % CROWD_MORPH === 0 && !_streetMorph.has(`${!!towels}`)) _streetMorph.set(`${!!towels}`, out);
}
function streetMorph({ towels = false } = {}) {
  const key = `${!!towels}`;
  if (_streetMorph.has(key)) return _streetMorph.get(key);
  // the street's far body for both levels: its close one is 4,800 triangles, which a full house can't pay for
  const lod = 1;
  const poses = [actorPoseMesh('sit', 0, lod), actorPoseMesh('idle', 0, lod), actorPoseMesh('cheer', 0.125, lod)];
  // the right hand (the rig's +X is its left): the highest skin below the shoulders' reach on -X,
  // which in the cheer is the fist over the head
  const hand = (m) => { let at = null; for (let k = 0; k < m.mat.length; k++) if (m.mat[k] === 0 && m.p[k * 3] < -0.15 && (!at || m.p[k * 3 + 1] > at[1])) at = [m.p[k * 3], m.p[k * 3 + 1], m.p[k * 3 + 2]]; return (at || [0, 1, 0]).map((v) => v * FT); };
  const body = poses[0].mat.length, face = FAN_FACE.length, n = body + (towels ? 12 : 0) + face, out = new Float32Array(n * CROWD_MORPH);
  for (let i = 0; i < body; i++) {
    const at = i * CROWD_MORPH;
    for (let k = 0; k < 3; k++) {
      const m = poses[k], o = at + k * 6;
      // the rig faces +Z with +X its left; the fan faces +z with +x its left too
      out[o] = m.p[i * 3] * FT; out[o + 1] = m.p[i * 3 + 1] * FT; out[o + 2] = m.p[i * 3 + 2] * FT;
      out[o + 3] = m.n[i * 3]; out[o + 4] = m.n[i * 3 + 1]; out[o + 5] = m.n[i * 3 + 2];
    }
    out[at + 18] = STREET_PART[poses[2].mat[i]] ?? CP.shirt;
    // skin out from the neck or under the chin, standing, is a hand: CP.hand, or the crowd shader
    // (crowd.js `head`) turns it with the head and the sleeve's triangles stretch into shards
    const sx = poses[1].p[i * 3], sy = poses[1].p[i * 3 + 1];
    if (poses[2].mat[i] === 0 && (Math.abs(sx) > 0.13 || sy < 1.3)) out[at + 18] = CP.hand;
  }
  mittHands(out, body, poses);
  if (towels) {
    const [hs, hd, hc] = poses.map(hand);
    // caught mid-wave out over the shoulder, both faces, as crowdMesh's
    const a = hc, b = [hc[0] - 0.95, hc[1] + 0.3, hc[2] - 0.12], c2 = [hc[0] - 1.0, hc[1] + 1.3, hc[2] - 0.18], d = [hc[0] + 0.04, hc[1] + 1.05, hc[2] - 0.05];
    const nn = norm(cross(sub(b, a), sub(d, a))), tri = [[a, b, c2, nn], [a, c2, d, nn], [a, c2, b, mul(nn, -1)], [a, d, c2, mul(nn, -1)]];
    let i = body;
    for (const [p, q, r, nm] of tri) for (const v of [p, q, r]) {
      const at = i++ * CROWD_MORPH;
      out.set([...hs, 0, 1, 0], at); out.set([...hd, 0, 1, 0], at + 6); out.set([...v, ...nm], at + 12); out[at + 18] = CP.towel;
    }
  }
  fanHead(out, body, poses, n - face);
  _streetMorph.set(key, out);
  return out;
}
// The far body's head is small on a long neck, with no eyes or mouth (only the close body has
// them, and a full house can't pay for that one). In every pose the head is made 12% bigger and
// set down its neck 3.5 cm, so the neck mostly sits inside the collar, and a face is laid on it in
// a few triangles: eyes, brows and a mouth in CP.face, and a nose in skin that the light shapes.
// The face is placed in the standing head's frame (metres, +z ahead) and carried into each pose
// by that pose's own head frame, worked out from the head's vertices.
const HEAD_GROW = 1.12, NECK_DROP = 0.035;
const FAN_FACE = (() => {
  const zAt = (x, y) => 0.118 * Math.sqrt(Math.max(0, 1 - (x / 0.1) ** 2)) - 0.25 * (y - 1.665) ** 2 + 0.006;
  const tris = [];
  const quad = (cx, cy, w, h, part, diamond = false) => {
    const P = (x, y) => [x, y, zAt(x, y)];
    const a = diamond ? P(cx - w, cy) : P(cx - w, cy - h), b = diamond ? P(cx, cy - h) : P(cx + w, cy - h);
    const c = diamond ? P(cx + w, cy) : P(cx + w, cy + h), d = diamond ? P(cx, cy + h) : P(cx - w, cy + h);
    tris.push([a, b, c, part], [a, c, d, part]);
  };
  for (const s of [-1, 1]) {
    quad(s * 0.034, 1.667, 0.012, 0.0065, CP.face, true);             // an eye
    quad(s * 0.036, 1.687, 0.016, 0.0035, CP.face);                    // its brow
  }
  quad(0, 1.603, 0.019, 0.0035, CP.face);                              // the mouth
  // the nose: a wedge out of the face, its two sides lit differently
  const tip = [0, 1.632, zAt(0, 1.632) + 0.022], root = [0, 1.668, zAt(0, 1.668)];
  const l = [-0.013, 1.628, zAt(-0.013, 1.628)], r = [0.013, 1.628, zAt(0.013, 1.628)];
  tris.push([root, l, tip, CP.skin], [root, tip, r, CP.skin], [l, r, tip, CP.skin]);
  return tris.flatMap(([a, b, c, part]) => [a, b, c].map((p) => ({ p, part, n: norm(cross(sub(b, a), sub(c, a))) })));
})();
function fanHead(out, body, poses, faceAt) {
  const S = CROWD_MORPH, I = poses[1];
  // which corners are the head (skin above the chin that isn't a hand, and the hair) and which the
  // neck, both by where they stand
  const isHead = new Uint8Array(body), neckT = new Float32Array(body);
  for (let i = 0; i < body; i++) {
    const m = I.mat[i], y = I.p[i * 3 + 1], part = out[i * S + 18];
    if (part === CP.hand) continue;
    if (m === 4 || m === 5 || m === 6 || (m === 0 && y > 1.55)) isHead[i] = 1;
    else if (m === 0 && y > 1.44) neckT[i] = Math.min(1, (y - 1.44) / 0.11);
  }
  const frameOf = (k) => {
    const o = k * 6, P = (i) => [out[i * S + o] / FT, out[i * S + o + 1] / FT, out[i * S + o + 2] / FT];
    let c = [0, 0, 0], top = [0, 0, 0], low = [0, 0, 0], front = [0, 0, 0], nt = 0, nl = 0, nf = 0, nc = 0;
    for (let i = 0; i < body; i++) if (isHead[i]) {
      const p = P(i), y = I.p[i * 3 + 1], z = I.p[i * 3 + 2];
      c = add(c, p); nc++;
      if (y > 1.71) { top = add(top, p); nt++; }
      if (y < 1.6) { low = add(low, p); nl++; }
      if (z > 0.08 && y < 1.7) { front = add(front, p); nf++; }
    }
    c = mul(c, 1 / nc);
    const u = norm(sub(mul(top, 1 / nt), mul(low, 1 / nl)));
    let f = sub(mul(front, 1 / nf), c); f = norm(sub(f, mul(u, f[0] * u[0] + f[1] * u[1] + f[2] * u[2])));
    return { c, u, f, x: cross(u, f) };
  };
  const F = [0, 1, 2].map(frameOf), F0 = F[1];
  const local = (p) => { const d = sub(p, F0.c); return [d[0] * F0.x[0] + d[1] * F0.x[1] + d[2] * F0.x[2], d[0] * F0.u[0] + d[1] * F0.u[1] + d[2] * F0.u[2], d[0] * F0.f[0] + d[1] * F0.f[1] + d[2] * F0.f[2]]; };
  const place = (Fk, l, grow) => add(add(add(Fk.c, mul(Fk.x, l[0] * grow)), add(mul(Fk.u, l[1] * grow), mul(Fk.f, l[2] * grow))), mul(Fk.u, -NECK_DROP));
  for (let k = 0; k < 3; k++) {
    const Fk = F[k], o = k * 6;
    for (let i = 0; i < body; i++) {
      const at = i * S + o;
      if (isHead[i]) {
        const p = [out[at] / FT, out[at + 1] / FT, out[at + 2] / FT];
        const q = add(add(Fk.c, mul(sub(p, Fk.c), HEAD_GROW)), mul(Fk.u, -NECK_DROP));
        out[at] = q[0] * FT; out[at + 1] = q[1] * FT; out[at + 2] = q[2] * FT;
      } else if (neckT[i] > 0) {
        const t = neckT[i] * NECK_DROP;
        out[at] -= Fk.u[0] * t * FT; out[at + 1] -= Fk.u[1] * t * FT; out[at + 2] -= Fk.u[2] * t * FT;
      }
    }
    FAN_FACE.forEach((v, j) => {
      const at = (faceAt + j) * S + o, q = place(Fk, local(v.p), HEAD_GROW), nl = local(add(F0.c, v.n));
      const nn = norm(add(add(mul(Fk.x, nl[0]), mul(Fk.u, nl[1])), mul(Fk.f, nl[2])));
      out[at] = q[0] * FT; out[at + 1] = q[1] * FT; out[at + 2] = q[2] * FT;
      out.set(nn, at + 3);
      out[at + 18] = v.part;
    });
  }
}

// The far body's fingers are a fan of thin spikes that read as claws a row away, so each hand's
// triangles become a plain mitt in every pose: an eight-faced lozenge from the wrist (the sleeve's
// corners nearest the hand) out past the hand's centre, flattened across the palm, and the
// triangles it doesn't need folded to a point inside it.
function mittHands(out, body, poses) {
  const S = CROWD_MORPH, LONG = 0.3, WIDE = 0.15, THICK = 0.08;
  for (const side of [1, -1]) {
    const own = [];
    for (let t = 0; t < body; t += 3) if ([0, 1, 2].every((j) => out[(t + j) * S + 18] === CP.hand) && Math.sign(poses[1].p[t * 3]) === side) own.push(t);
    if (!own.length) continue;
    for (let k = 0; k < 3; k++) {
      const P = (i) => [out[i * S + k * 6], out[i * S + k * 6 + 1], out[i * S + k * 6 + 2]];
      let c = [0, 0, 0];
      for (const t of own) for (let j = 0; j < 3; j++) c = add(c, mul(P(t + j), 1 / (own.length * 3)));
      // the wrist: the sleeve's corners within a hand's length of it
      let w = [0, 0, 0], nw = 0;
      for (let i = 0; i < body; i++) if (out[i * S + 18] === CP.shirt && len(sub(P(i), c)) < 0.45) { w = add(w, P(i)); nw++; }
      const ax = nw ? norm(sub(c, mul(w, 1 / nw))) : [0, -1, 0];
      const across = norm(Math.abs(ax[1]) > 0.9 ? cross(ax, [1, 0, 0]) : cross(ax, [0, 1, 0])), palm = norm(cross(ax, across));
      const mid = madd(c, ax, 0.05), tip = madd(mid, ax, LONG), heel = madd(mid, ax, -LONG * 0.6);
      const ring = [madd(mid, across, WIDE), madd(mid, palm, THICK), madd(mid, across, -WIDE), madd(mid, palm, -THICK)];
      const faces = [];
      for (let r = 0; r < 4; r++) { const a = ring[r], b = ring[(r + 1) % 4]; faces.push([tip, a, b], [heel, b, a]); }
      own.forEach((t, f) => {
        const tri = faces[f] || [mid, mid, mid];
        const fn = faces[f] ? norm(cross(sub(tri[1], tri[0]), sub(tri[2], tri[0]))) : ax;
        const n = dot(fn, sub(tri[0], mid)) < 0 ? mul(fn, -1) : fn;
        tri.forEach((p, j) => { const o = (t + j) * S + k * 6; out.set(p, o); out.set(n, o + 3); });
      });
    }
  }
}

// ── a final's dress ─────────────────────────────────────────────────────────
// What a final adds to the park (gl/ballpark.js setFinal): fan bunting along the front of the
// upper deck in gold, white and red, a gold pennant over every light tower, the final's logo
// painted on the grass behind the plate and in foul ground down both lines, and the trophy on its
// table beside the mound for the champions. Batches by texture key as buildPark's: 'plain' and
// 'finalLogo' (its texture is painted with the final's name); the trophy is its own batch, drawn
// once the champions are crowned.
export const TROPHY_AT = Object.freeze([-14, 0, 50]);
// where each logo lies, its centre, its half-width and half-depth, and which way its top faces
export const LOGOS = Object.freeze([
  { c: [0, 0, -36], w: 14, d: 7, up: [0, 0, -1] },
  { c: [-91, 0, 63], w: 11, d: 5.5, up: [0, 0, 1] },
  { c: [91, 0, 63], w: 11, d: 5.5, up: [0, 0, 1] },
]);
export function buildDress(venue) {
  const field = venueField(venue), out = new Map();
  const B = (key) => { let b = out.get(key); if (!b) { b = createBatch(); out.set(key, b); } return b; };
  const GOLD = lin('#e2b13c'), CREAM = lin('#f4efe0'), RED = lin('#b3261e');
  // the bunting: a half-fan every other bay of the upper deck's front, hung from its top edge
  const deck = bowlPath().filter((p) => len(p) < 255), N = deck.length;
  for (let i = 1; i < N - 1; i += 2) {
    const a = deck[i - 1], b = deck[i + 1], p = deck[i];
    let n = norm(cross([0, 1, 0], sub(b, a)));
    if (dot(n, norm(sub(p, [0, 0, 60]))) < 0) n = mul(n, -1);
    const t = norm(sub(b, a)), c = add(madd(p, n, 63.6), [0, 53.8, 0]), R = 3.4, face = mul(n, -1);
    [GOLD, CREAM, RED].forEach((col, s) => {
      const r0 = R * (2 - s) / 3, r1 = R * (3 - s) / 3;
      for (let k = 0; k < 10; k++) {
        const a0 = Math.PI + Math.PI * k / 10, a1 = Math.PI + Math.PI * (k + 1) / 10;
        const at = (r, an) => add(madd(c, t, Math.cos(an) * r), [0, Math.sin(an) * r, 0]);
        quad(B('plain'), at(r0, a0), at(r1, a0), at(r1, a1), at(r0, a1), face, col, MAT.CLOTH);
      }
    });
  }
  // a pennant from each light tower's finial
  for (const [su, sv] of TOWER_CORNERS) {
    const base = B2T(su * TOWER.at, sv * TOWER.at), fwd = norm([-base[0], 0, -base[2]]), right = norm(cross(fwd, [0, 1, 0])), top = [base[0], ftUp(0.975), base[2]];
    cylinder(B('plain'), top, 12, 0.3, lin('#d9d9d4'), MAT.METAL, 6);
    const head = add(top, [0, 12, 0]);
    quad(B('plain'), head, add(head, [0, -4.4, 0]), add(madd(head, right, 11), [0, -2.2, 0]), add(madd(head, right, 11), [0, -2.2, 0]), fwd, GOLD, MAT.CLOTH);
  }
  // the logos, flat on the grass, a hair over it
  for (const L of LOGOS) {
    const up = L.up, right = norm(cross(up, [0, 1, 0])), c = [L.c[0], 0.06, L.c[2]];
    const P = (x, z) => madd(madd(c, right, x), up, z);
    quad(B('finalLogo'), P(-L.w, -L.d), P(L.w, -L.d), P(L.w, L.d), P(-L.w, L.d), [0, 1, 0], WHITE, MAT.MATTE, [[0, 1], [1, 1], [1, 0], [0, 0]]);
  }
  // the trophy on its table: a draped table, a stepped base, the stem, the cup and two handles
  const trophy = createBatch(2048), at = TROPHY_AT;
  box(trophy, add(at, [0, 1.5, 0]), [2.2, 1.5, 1.4], 30, lin('#1d2a4a'), MAT.CLOTH);
  const profile = [[0.9, 0], [0.9, 0.25], [0.62, 0.32], [0.55, 0.6], [0.22, 0.75], [0.18, 1.4], [0.3, 1.55], [0.75, 1.8], [1.05, 2.4], [1.15, 3.1], [1.1, 3.2], [0.9, 3.1]];
  const base = add(at, [0, 3, 0]);
  for (let k = 0; k + 1 < profile.length; k++) {
    const [r0, y0] = profile[k], [r1, y1] = profile[k + 1];
    for (let j = 0; j < 16; j++) {
      const a0 = j / 16 * TAU, a1 = (j + 1) / 16 * TAU;
      const p = (r, y, a) => add(base, [Math.sin(a) * r, y, Math.cos(a) * r]);
      const nm = (a) => norm([Math.sin(a) * (y1 - y0), r0 - r1, Math.cos(a) * (y1 - y0)]);
      vtx(trophy, p(r0, y0, a0), nm(a0), [0, 0], GOLD, MAT.METAL); vtx(trophy, p(r1, y1, a0), nm(a0), [0, 0], GOLD, MAT.METAL); vtx(trophy, p(r1, y1, a1), nm(a1), [0, 0], GOLD, MAT.METAL);
      vtx(trophy, p(r0, y0, a0), nm(a0), [0, 0], GOLD, MAT.METAL); vtx(trophy, p(r1, y1, a1), nm(a1), [0, 0], GOLD, MAT.METAL); vtx(trophy, p(r0, y0, a1), nm(a1), [0, 0], GOLD, MAT.METAL);
    }
  }
  for (const s of [-1, 1]) for (let k = 0; k < 6; k++) {
    const a = -Math.PI / 2 + Math.PI * k / 5, h = add(base, [s * (1.15 + Math.cos(a) * 0.45), 2.7 + Math.sin(a) * 0.5, 0]);
    box(trophy, h, [0.09, 0.09, 0.09], 0, GOLD, MAT.METAL);
  }
  return { opaque: out, trophy };
}
