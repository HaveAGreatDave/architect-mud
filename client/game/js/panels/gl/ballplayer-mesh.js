// GLASS 2 · BALLPLAYERS, AS TRIANGLES.
//
// Deadball's people in the 3-D park (the Grandstand): the nine in the field, the batter, the men
// on base, the on-deck hitter, the coaches and the umpires, at the park's full quality.
//
//   · the skeleton is solved from a pose by the rig (diamond/rig.js): the torso and head by
//     forward kinematics, the limbs by two-bone IK to where the pose puts the hands and feet;
//   · the body is lofted round it: a torso of rings, tubes down the limbs that bend round the
//     knee and the elbow, shoes, hands that wrap a bat with ridged fingers, gloves, the bat;
//   · the head is the street figure's (actor-head.js, level 0) with its face from the baked atlas
//     (actor-faces.js), tinted per player, so a close-up has brows, irises and lips;
//   · caps, helmets and masks are grown off the skull's own surface to a band line, so the cap's
//     band sits above the brow and the bill shades the eyes without hiding them.
//
// Everything a player looks like comes off his name (or, for a fielder the payload doesn't name,
// his club and position), so he's the same in every game and on every TV.
//
// Two ways to build one. `buildPlayer` lofts him round a solved pose, a still (the gate builds
// every pose that way). `buildBody` builds him once in the rig's bind pose with four bone weights
// a vertex, and the GPU skins him into any pose after (gl/skin.js): the torso's rings blend
// between the spine's frames, a limb's between its two bones across the knee or elbow, the head
// between the neck and the skull, and the hands, feet, gloves, headwear and bat ride one bone
// each. A hitter also gets his two fists and his bat, built in a batting stance on bones of their
// own that fold away while his hands are free.
//
// ⚠ NOTHING HERE TOUCHES WEBGL OR THE DOM: it fills ballpark-mesh.js's batches, so the gate builds
// every pose in node. Units are feet in the park's frame (diamond/geo.js); the head is built in its
// own bind space (metres, y up, facing +z) and scaled onto the head joint.

import { createBatch, vtx, MAT, STRIDE } from './ballpark-mesh.js';
import { DEG } from '../diamond/geo.js';
import { solvePose, mirrorPose, POSES, BONE, bindPoses } from '../diamond/rig.js';
// the pose language moved to the rig; the gates and the renderer still find it here
export { solvePose, mirrorPose, POSES };
import { headMesh, hairMesh, skullPoint, ZC as SKULL_ZC } from '../actor-head.js';
import { FACE_LAYOUTS, actorFace, faceHair, faceLip } from '../actor-faces.js';

const TAU = Math.PI * 2;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const madd = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// 3×3 matrices as three column vectors
const m3v = (m, v) => [m[0][0] * v[0] + m[1][0] * v[1] + m[2][0] * v[2], m[0][1] * v[0] + m[1][1] * v[1] + m[2][1] * v[2], m[0][2] * v[0] + m[1][2] * v[1] + m[2][2] * v[2]];
const m3m = (a, b) => [m3v(a, b[0]), m3v(a, b[1]), m3v(a, b[2])];
export function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function hashStr(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const decode = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export const hex = (h) => { const n = parseInt(String(h).slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => decode(v / 255)); };

// The kits until the clubs bring their own (Phase 5): home cream with navy pinstripes and teal,
// away grey with black and rust.
export const KITS = {
  home: { base: '#f2f0e8', ink: '#16264a', trim: '#1d8a8c', cap: '#16264a', under: '#1d3b30', helmet: '#16264a', belt: '#16264a' },
  away: { base: '#9a9da2', ink: '#17171a', trim: '#b04a1c', cap: '#17171a', under: '#2c2c2c', helmet: '#121214', belt: '#111111' },
};
export const SKINS = ['#e9c2a0', '#d9a77f', '#b77a52', '#8d5a3b', '#5e3a26', '#f0cdb0'];
export const HAIRS = ['#1d1510', '#3a2416', '#5b3a1e', '#141414', '#7a5530', '#2a1c12'];

// ── the kit atlas ──────────────────────────────────────────────────────────────
// One 2048² texture holds every jersey (a 512×256 slot each, 28 of them, in rows 0 to 6) and,
// in row 7, each side's trousers and socks. A jersey is flattened round the body: u runs round it
// with the chest a quarter of the way in and the back three quarters, v from the collar down.
export const KIT_SLOTS = 28;
export const kitCell = (slot) => [(slot % 4) / 4, Math.floor(slot / 4) / 8, 1 / 4, 1 / 8];
export const KIT_PANTS = { home: [0, 7 / 8, 1 / 4, 1 / 8], away: [1 / 4, 7 / 8, 1 / 4, 1 / 8] };
export const KIT_SOCKS = { home: [2 / 4, 7 / 8, 1 / 4, 1 / 8], away: [3 / 4, 7 / 8, 1 / 4, 1 / 8] };
// A cell's uv from a part's own 0..1, kept a texel or two inside so the slots don't bleed.
const inCell = (c, u, v) => [c[0] + (0.004 + clamp(u, 0, 1) * 0.992) * c[2], c[1] + (0.008 + clamp(v, 0, 1) * 0.984) * c[3]];
// A skinned body is built once and stands in any slot, so its jersey's uv is the cell's own 0..1
// moved two to the right, and the shader puts it in the slot's cell (uKitCell in gl/ballpark.js).
export const KIT_REL = Object.freeze([2, 0, 1, 1]);

// ── skinned vertices ─────────────────────────────────────────────────────────────
// A skinned vertex is ballpark-mesh.js's twelve floats and two more words: four bone indices and
// four weights, a byte each, the weights summing to 255.
export const SKIN_STRIDE = STRIDE + 2;
export function createSkinBatch(cap = 4096) { const data = new Float32Array(cap * SKIN_STRIDE); return { data, u8: new Uint8Array(data.buffer), n: 0, skin: true }; }
function growSkin(b, more) {
  const need = (b.n + more) * SKIN_STRIDE;
  if (need <= b.data.length) return;
  const d = new Float32Array(Math.max(need, b.data.length * 2));
  d.set(b.data.subarray(0, b.n * SKIN_STRIDE));
  b.data = d; b.u8 = new Uint8Array(d.buffer);
}
// `w` is [[bone, weight], …]: up to four, any weights, kept as bytes that sum to 255.
export function vtxSkin(b, p, n, uv, col, mat, w) {
  growSkin(b, 1);
  const o = b.n * SKIN_STRIDE, d = b.data;
  d[o] = p[0]; d[o + 1] = p[1]; d[o + 2] = p[2];
  d[o + 3] = n[0]; d[o + 4] = n[1]; d[o + 5] = n[2];
  d[o + 6] = uv[0]; d[o + 7] = uv[1];
  d[o + 8] = col[0]; d[o + 9] = col[1]; d[o + 10] = col[2];
  d[o + 11] = mat;
  const list = w.filter(([, x]) => x > 0).sort((a, c) => c[1] - a[1]).slice(0, 4);
  const sum = list.reduce((t, [, x]) => t + x, 0) || 1, by = (o + STRIDE) * 4;
  let left = 255;
  for (let k = 0; k < 4; k++) {
    const e = list[k];
    const q = !e ? 0 : k === list.length - 1 ? left : Math.round(e[1] / sum * 255);
    b.u8[by + k] = e ? e[0] : 0; b.u8[by + 4 + k] = q;
    left -= q;
  }
  b.n++;
}

// ── building ───────────────────────────────────────────────────────────────────
// `G.B(key)` hands back the batch for a texture key: 'plain', 'kit', 'leather', 'wood', 'logo',
// 'mask'. Vertices are ballpark-mesh.js's: position, normal, uv, linear colour, material.
function tri(b, a, c, d) {
  if (b.skin) for (const q of [a, c, d]) vtxSkin(b, q.p, q.n, q.uv, q.col, q.mat, q.w);
  else for (const q of [a, c, d]) vtx(b, q.p, q.n, q.uv, q.col, q.mat);
}
// A parametric surface, rows i and columns j, joined round when `wrap`. `key`, `mat` and `col` may
// be per row (a function of i); `col` may also be per point.
function emitGrid(G, rows, cols, pos, opt) {
  const { wrap = true, uv = (i, j) => [j / cols, i / (rows - 1)], col, mat, key, centre, flip = false, wts } = opt;
  const P = [];
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) P.push(pos(i, j));
  const at = (i, j) => P[i * cols + (wrap ? ((j % cols) + cols) % cols : clamp(j, 0, cols - 1))];
  const N = [];
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const n = cross(sub(at(i, j + 1), at(i, j - 1)), sub(at(Math.min(i + 1, rows - 1), j), at(Math.max(i - 1, 0), j)));
    const l = len(n);
    N.push(l > 1e-9 ? mul(n, 1 / l) : [0, 1, 0]);
  }
  let sign = flip ? -1 : 1;
  if (centre) { let sm = 0; for (let k = 0; k < P.length; k += 7) sm += dot(N[k], sub(P[k], centre)); sign = sm < 0 ? -1 : 1; }
  const colsE = wrap ? cols : cols - 1;
  for (let i = 0; i < rows - 1; i++) {
    const b = G.B(typeof key === 'function' ? key(i) : key);
    const m = typeof mat === 'function' ? mat(i) : mat;
    for (let j = 0; j < colsE; j++) {
      const q = (ii, jj) => {
        const idx = ii * cols + (wrap ? jj % cols : jj);
        const c = typeof col === 'function' ? col(ii, jj % cols, P[idx], i) : col;
        return { p: P[idx], n: mul(N[idx], sign), uv: uv(ii, jj), col: c, mat: m, w: wts ? wts(ii) : G.cur };
      };
      const a = q(i, j), bq = q(i, j + 1), c = q(i + 1, j + 1), d = q(i + 1, j);
      tri(b, a, bq, c); tri(b, a, c, d);
    }
  }
}
function ellipsoid(G, key, c, ax, r, rows, cols, col, mat, { vmin = 0, vmax = 1, deform } = {}) {
  emitGrid(G, rows, cols, (i, j) => {
    const v = vmin + (vmax - vmin) * i / (rows - 1), th = v * Math.PI, ph = j / cols * TAU;
    let l = [Math.sin(th) * Math.sin(ph) * r[0], Math.cos(th) * r[1], Math.sin(th) * Math.cos(ph) * r[2]];
    if (deform) l = deform(l, v, ph);
    return add(c, add(add(mul(ax[0], l[0]), mul(ax[1], l[1])), mul(ax[2], l[2])));
  }, { key, col: typeof col === 'function' ? (ii, jj, p) => col(p) : col, mat, centre: c });
}

// The body's profiles: where each ring sits and how wide and deep it is, and what it's made of.
const TORSO = [
  ['pelvis', [0, -0.40, -0.03], 0.36, 0.27, 'pants'], ['pelvis', [0, -0.27, -0.04], 0.55, 0.40, 'pants'],
  ['pelvis', [0, -0.08, -0.02], 0.62, 0.43, 'pants'], ['pelvis', [0, 0.10, 0.00], 0.605, 0.41, 'pants'],
  ['pelvis', [0, 0.20, 0.01], 0.59, 0.40, 'belt'], ['pelvis', [0, 0.27, 0.01], 0.585, 0.395, 'belt'],
  ['spine', [0, 0.02, 0.015], 0.585, 0.395, 'jersey'], ['spine', [0, 0.26, 0.025], 0.61, 0.415, 'jersey'],
  ['chest', [0, 0.04, 0.035], 0.66, 0.445, 'jersey'], ['chest', [0, 0.24, 0.045], 0.71, 0.465, 'jersey'],
  ['chest', [0, 0.41, 0.025], 0.735, 0.43, 'jersey'], ['chest', [0, 0.53, -0.01], 0.64, 0.35, 'jersey'],
  ['chest', [0, 0.61, -0.025], 0.42, 0.28, 'jersey'], ['neck', [0, 0.02, 0.0], 0.24, 0.225, 'skin'],
];
const LEG = [[-0.24, 0.30, 0.32, 'pants'], [0.10, 0.31, 0.33, 'pants'], [0.55, 0.285, 0.30, 'pants'], [1.05, 0.245, 0.26, 'pants'], [1.42, 0.222, 0.235, 'pants'],
  [1.62, 0.218, 0.228, 'pants'], [1.86, 0.22, 0.226, 'pants'], [1.875, 0.172, 0.182, 'sock'], [2.12, 0.176, 0.196, 'sock'], [2.45, 0.156, 0.172, 'sock'],
  [2.78, 0.118, 0.128, 'sock'], [3.02, 0.102, 0.108, 'sock']];
const SLACKS = [[-0.24, 0.30, 0.32, 'pants'], [0.10, 0.31, 0.33, 'pants'], [0.55, 0.285, 0.30, 'pants'], [1.05, 0.25, 0.26, 'pants'], [1.55, 0.225, 0.235, 'pants'],
  [2.1, 0.205, 0.215, 'pants'], [2.6, 0.19, 0.20, 'pants'], [3.0, 0.18, 0.19, 'pants']];
const ARM = [[-0.18, 0.235, 0.25, 'sleeve'], [0.06, 0.25, 0.26, 'sleeve'], [0.30, 0.232, 0.24, 'sleeve'], [0.45, 0.224, 0.23, 'sleeve'], [0.47, 0.226, 0.232, 'trim'], [0.50, 0.226, 0.232, 'trim'],
  [0.505, 0.168, 0.175, 'under'], [0.72, 0.158, 0.168, 'under'], [0.98, 0.133, 0.14, 'under'], [1.22, 0.148, 0.15, 'under'], [1.62, 0.112, 0.098, 'under'], [1.86, 0.094, 0.08, 'under']];

function sampleProfile(prof, n0 = 3) {
  const out = [];
  for (let i = 0; i < prof.length - 1; i++) {
    const a = prof[i], b = prof[i + 1], n = (b[0] - a[0] < 0.03) ? 1 : n0;
    for (let k = 0; k < n; k++) { const t = k / n; out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3]]); }
  }
  out.push(prof[prof.length - 1]);
  return out;
}
// A tube down a two-bone chain that bends round the middle joint. `rig` is its bones for a
// skinned body: { a, b } the upper and lower bone, and `root` [from, to, most] how much of the top
// rides the parent (the pelvis or the chest) so a hip or shoulder bends without a crease.
function limb(G, J0, J1, J2, ref, prof, s, keyOf, colOf, matOf, uvOf, rig = null) {
  const rings = sampleProfile(prof);
  const L1 = len(sub(J1, J0)), T1 = norm(sub(J1, J0)), T2 = norm(sub(J2, J1));
  const w = 0.16 * s;
  const centreAt = (sv) => {
    if (Math.abs(sv - L1) < w) {
      const u = (sv - (L1 - w)) / (2 * w), A = madd(J1, T1, -w), C = madd(J1, T2, w);
      return add(add(mul(A, (1 - u) * (1 - u)), mul(J1, 2 * u * (1 - u))), mul(C, u * u));
    }
    return sv < L1 ? madd(J0, T1, sv) : madd(J1, T2, sv - L1);
  };
  const tanAt = (sv) => norm(lerp(T1, T2, smooth(L1 - w, L1 + w, sv)));
  const cols = 22, rows = rings.length;
  const wOf = rig ? (sv) => {
    const t = smooth(L1 - w, L1 + w, sv), up = rig.root ? rig.root[2] * (1 - smooth(rig.root[0] * s, rig.root[1] * s, sv)) : 0;
    return [[rig.parent, up], [rig.a, (1 - t) * (1 - up)], [rig.b, t * (1 - up)]];
  } : null;
  emitGrid(G, rows, cols, (i, j) => {
    const [sv0, rx, rz] = rings[i], sv = sv0 * s, c = centreAt(sv), t = tanAt(sv);
    let zA = sub(ref, mul(t, dot(ref, t)));
    if (len(zA) < 1e-4) zA = [0, 0, 1];
    zA = norm(zA);
    const xA = norm(cross(t, zA)), a = j / cols * TAU;
    return add(c, add(mul(xA, Math.sin(a) * rx * s), mul(zA, Math.cos(a) * rz * s)));
  }, {
    key: (i) => keyOf(rings[i][3]), col: (ii) => colOf(rings[Math.min(ii, rows - 1)][3]), mat: (i) => matOf(rings[i][3]),
    uv: (i, j) => uvOf(rings[i][3], j / cols, rings[i][0] / prof[prof.length - 1][0]), centre: lerp(J0, J2, 0.5),
    wts: wOf ? (ii) => wOf(rings[Math.min(ii, rows - 1)][0] * s) : undefined,
  });
}
// The torso's frames as bones, for a skinned body.
const FRAME_BONE = { pelvis: BONE.pelvis, spine: BONE.spine, chest: BONE.chest, neck: BONE.neck };
const LEG_RIG = { L: { a: BONE.thighL, b: BONE.shinL, parent: BONE.pelvis, root: [-0.24, 0.25, 0.5] }, R: { a: BONE.thighR, b: BONE.shinR, parent: BONE.pelvis, root: [-0.24, 0.25, 0.5] } };
const ARM_RIG = { L: { a: BONE.upperArmL, b: BONE.forearmL, parent: BONE.chest, root: [-0.18, 0.2, 0.35] }, R: { a: BONE.upperArmR, b: BONE.forearmR, parent: BONE.chest, root: [-0.18, 0.2, 0.35] } };
function torso(G, J, W, s, keyOf, colOf, matOf, uvOf, extra = 0, front = 0) {
  const R = TORSO.map(([f, o, w, d, part]) => {
    const M = W[f];
    return { f, c: add(J[f], m3v(M, mul(o, s))), X: M[0], Z: M[2], w: (w + extra) * s, d: (d + extra + (part === 'jersey' ? front : 0)) * s, part };
  });
  const rings = [];
  for (let i = 0; i < R.length - 1; i++) {
    const a = R[i], b = R[i + 1];
    for (let k = 0; k < 3; k++) {
      const t = k / 3, p0 = R[Math.max(0, i - 1)].c, p3 = R[Math.min(R.length - 1, i + 2)].c, t2 = t * t, t3 = t2 * t;
      // Catmull-Rom through the ring centres
      const c = [0, 1, 2].map((q) => 0.5 * ((2 * a.c[q]) + (-p0[q] + b.c[q]) * t + (2 * p0[q] - 5 * a.c[q] + 4 * b.c[q] - p3[q]) * t2 + (-p0[q] + 3 * a.c[q] - 3 * b.c[q] + p3[q]) * t3));
      rings.push({ c, X: norm(lerp(a.X, b.X, t)), Z: norm(lerp(a.Z, b.Z, t)), w: a.w + (b.w - a.w) * t, d: a.d + (b.d - a.d) * t, part: a.part, v: (i + t) / (R.length - 1), f0: a.f, f1: b.f, t });
    }
  }
  const L = R[R.length - 1];
  rings.push({ c: L.c, X: L.X, Z: L.Z, w: L.w, d: L.d, part: L.part, v: 1, f0: L.f, f1: L.f, t: 0 });
  const cols = 32, pw = 2.5, sp = (x) => Math.sign(x) * Math.pow(Math.abs(x), 2 / pw);
  emitGrid(G, rings.length, cols, (i, j) => {
    const r = rings[i], a = (j / cols - 0.25) * TAU;
    return add(r.c, add(mul(r.X, sp(Math.sin(a)) * r.w), mul(r.Z, sp(Math.cos(a)) * r.d)));
  }, {
    key: (i) => keyOf(rings[i].part), col: (ii) => colOf(rings[Math.min(ii, rings.length - 1)].part), mat: (i) => matOf(rings[i].part),
    uv: (i, j) => uvOf(rings[i].part, j / cols, rings[i].v), centre: J.chest,
    wts: (ii) => { const r = rings[Math.min(ii, rings.length - 1)]; return r.f0 === r.f1 ? [[FRAME_BONE[r.f0], 1]] : [[FRAME_BONE[r.f0], 1 - r.t], [FRAME_BONE[r.f1], r.t]]; },
  });
}
function shoe(G, J, S, s, col) {
  const an = J['an' + S], toe = J['toe' + S];
  const fwd = norm(sub(toe, an)), side = norm(cross([0, 1, 0], fwd)), up = norm(cross(fwd, side));
  const heel = madd(madd(an, fwd, -0.2 * s), up, -0.14 * s), L = len(sub(toe, heel));
  const ax = norm(sub(toe, heel)), upA = norm(sub(up, mul(ax, dot(up, ax)))), sideA = norm(cross(upA, ax));
  const ST = [[0, 0.07, 0.07, 0.06], [0.06, 0.13, 0.12, 0.10], [0.25, 0.165, 0.16, 0.11], [0.45, 0.17, 0.15, 0.09], [0.65, 0.175, 0.105, 0.05], [0.85, 0.16, 0.08, 0.035], [0.97, 0.1, 0.05, 0.03], [1.0, 0.02, 0.02, 0.03]];
  emitGrid(G, ST.length, 20, (i, j) => {
    const [t, w, h, cy] = ST[i], c = madd(madd(heel, ax, t * L), upA, cy * s), a = j / 20 * TAU;
    const yy = Math.cos(a) > 0 ? Math.cos(a) * h : Math.cos(a) * Math.min(h, 0.05);   // a flat sole
    return add(c, add(mul(sideA, Math.sin(a) * w * s), mul(upA, yy * s)));
  }, { key: 'plain', col, mat: MAT.LEATHER, centre: madd(heel, ax, 0.4 * L) });
}
// A hand: round a bat's handle a fist of ridged fingers, a thumb, a heel and a strap; otherwise
// open along the forearm.
function hand(G, J, S, s, col, mat) {
  const c = J['hand' + S];
  if (J['grip' + S]) {
    const d = J.batDir, back = norm(sub(J['wr' + S], c)), bk = norm(sub(back, mul(d, dot(back, d)))), side = norm(cross(d, bk));
    const Wd = 0.29 * s, rows = 18, cols = 28;
    emitGrid(G, rows, cols, (i, j) => {
      const t = i / (rows - 1), a = j / cols * TAU, along = (t - 0.5) * Wd;
      const cap = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(2 * t - 1), 6)), 0.5);
      const fingerSide = 0.5 - 0.5 * Math.cos(a), roll = 0.5 + 0.5 * Math.cos(t * 4 * TAU);
      const knuckle = Math.pow(Math.max(0, Math.cos(a - Math.PI * 0.62)), 3) * (0.5 + 0.5 * Math.cos(t * 4 * TAU));
      const r = (0.062 + 0.011 * roll * fingerSide + 0.012 * knuckle) * s * (0.35 + 0.65 * cap);
      const rr = Math.max(r * cap, 0.048 * s);
      return add(madd(c, d, along), add(mul(bk, Math.cos(a) * rr), mul(side, Math.sin(a) * rr)));
    }, { key: 'plain', col, mat, centre: c });
    const heel = madd(c, bk, 0.1 * s);
    ellipsoid(G, 'plain', heel, [side, d, bk], [0.075 * s, 0.11 * s, 0.075 * s], 10, 14, col, mat);
    const strap = add(heel, mul(norm(sub(J['wr' + S], heel)), Math.min(0.09 * s, len(sub(J['wr' + S], heel)) * 0.6)));
    ellipsoid(G, 'plain', strap, [side, d, bk], [0.068 * s, 0.05 * s, 0.068 * s], 8, 12, mul(col, 0.55), mat);
    const th = add(madd(c, d, Wd * 0.32), mul(add(mul(bk, -0.35), mul(side, S === 'L' ? 0.95 : -0.95)), 0.072 * s));
    ellipsoid(G, 'plain', th, [side, d, bk], [0.03 * s, 0.075 * s, 0.032 * s], 8, 10, mul(col, 0.95), mat);
    return;
  }
  const hd = J['hdir' + S], pm = J['palm' + S], sd = norm(cross(pm, hd));
  ellipsoid(G, 'plain', c, [sd, hd, pm], [0.085 * s, 0.17 * s, 0.05 * s], 10, 14, col, mat);
  ellipsoid(G, 'plain', madd(madd(c, sd, 0.075 * s * (S === 'L' ? -1 : 1)), hd, -0.04 * s), [sd, hd, pm], [0.03 * s, 0.08 * s, 0.035 * s], 6, 8, col, mat);
}
function glove(G, J, S, s, kind) {
  const hd = J['hdir' + S], pm = J['palm' + S], sd = norm(cross(pm, hd));
  const c = madd(madd(J['wr' + S], hd, kind === 'catcher' ? 0.27 * s : 0.3 * s), pm, 0.05 * s);
  const r = kind === 'catcher' ? [0.29, 0.29, 0.13] : [0.2, 0.34, 0.1];
  const leather = kind === 'catcher' ? hex('#5a3820') : hex('#8a5a2e');
  ellipsoid(G, 'leather', c, [sd, hd, pm], mul(r, s), 14, 20, leather, MAT.LEATHER, { deform: (l) => { if (l[2] > 0) l[2] *= 0.45; return l; } });
  ellipsoid(G, 'plain', madd(c, hd, r[1] * 0.75 * s), [sd, hd, pm], [r[0] * 0.55 * s, r[1] * 0.3 * s, r[2] * 0.6 * s], 8, 12, mul(leather, 0.55), MAT.LEATHER);
  ellipsoid(G, 'leather', madd(c, hd, -r[1] * 0.85 * s), [sd, hd, pm], [r[0] * 0.95 * s, 0.07 * s, r[2] * 1.05 * s], 8, 14, mul(leather, 0.85), MAT.LEATHER);
}
function bat(G, J, s) {
  const k = J.batKnob, d = J.batDir, L = 2.8 * s;
  const ref = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], xA = norm(cross(d, ref)), zA = norm(cross(xA, d));
  const PR = [[0, 0.0], [0.005, 0.06], [0.03, 0.078], [0.06, 0.05], [0.12, 0.043], [0.9, 0.046], [1.5, 0.075], [2.0, 0.1], [2.45, 0.108], [2.74, 0.106], [2.78, 0.09], [2.8, 0.0]];
  emitGrid(G, PR.length, 16, (i, j) => { const [t, r] = PR[i], a = j / 16 * TAU; return add(madd(k, d, t / 2.8 * L), add(mul(xA, Math.sin(a) * r * s), mul(zA, Math.cos(a) * r * s))); },
    { key: 'wood', col: [1, 1, 1], mat: MAT.SATIN, uv: (i, j) => [PR[i][0] / 2.8, j / 16], centre: madd(k, d, L / 2) });
}

// ── the head ───────────────────────────────────────────────────────────────────
// The street figure's head (actor-head.js, level 0) with its face from the atlas. Its bind space
// is metres, y up, facing +z, left on +x: the pose space's axes, so the skull's middle goes to the
// head joint and the rest is scale. The neck blends from the neck at the collar to the head under
// the jaw, as the game's does.
const HEAD_BIND_C = [0, 1.636, -0.006];
const FT = 3.28084;
// Who gets which face: off the name, for the same face in every game. A 1990s ballplayer has no
// makeup and nobody's past forty; stubble or a beard on nearly half. Umpires can be any age.
const rgb255 = (h) => { const n = parseInt(String(h).slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
export function faceFor(look) {
  const h = hashStr('face:' + look.id + (look.role || ''));
  const rand = (k) => rng((h ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0)();
  const f = actorFace(rand);
  const L = FACE_LAYOUTS.map((q, i) => [q, i]).filter(([q]) => !q.makeup && (look.role === 'ump' || q.age <= 0.7));
  const pool = rand(20) < 0.45 ? L.filter(([q]) => q.beard > 0) : L.filter(([q]) => q.beard === 0);
  const layout = look.layout ?? pool[Math.floor(rand(13) * pool.length) % pool.length][1];
  // the atlas's lip colour reads as lipstick under the floods, so it's taken halfway back to the skin
  const skin = rgb255(look.skin), lip = faceLip(skin).map((c, i) => c + (skin[i] - c) * 0.5);
  return {
    skin: skin.map((c) => c / 255), hair: faceHair(rgb255(look.hair), layout).map((c) => c / 255), lip: lip.map((c) => c / 255),
    iris: f.iris.map((c) => c / 255), layout, style: look.hairStyle ?? f.hairStyle, eyeBlack: look.eyeBlack ? 1 : 0, seed: (h % 997) / 10,
  };
}
function head(G, J, W, s, look) {
  const H = W.head, Nk = W.neck;
  const c = add(J.head, m3v(H, [0, 0.31 * s, 0.03 * s]));
  look.headC = c;
  // where the head's middle would be if it sat straight on the neck
  const cN = add(J.neck, m3v(Nk, [0, 0.65 * s, 0.06 * s]));
  const k = FT * s * (look.headScale || 1);
  // the face's slot in the shader's uniform arrays: the caller's (the kit slot), or the next free
  const face = faceFor(look), idx = look.headIndex ?? G.heads.length;
  G.heads.push(face);
  look.face = face;
  const emit = (M) => {
    const b = G.B('plain'), V = [];
    for (let i = 0; i < M.P.length / 3; i++) {
      const q = [(M.P[i * 3] - HEAD_BIND_C[0]) * k, (M.P[i * 3 + 1] - HEAD_BIND_C[1]) * k, (M.P[i * 3 + 2] - HEAD_BIND_C[2]) * k];
      // an athlete's neck, thicker than the street figure's, most at the collar; and a broader jaw
      if (M.F[i] === 7 && M.P[i * 3 + 1] < 1.61) q[0] *= 1 + 0.07 * smooth(1.61, 1.55, M.P[i * 3 + 1]) * smooth(0.0, 0.03, Math.abs(M.P[i * 3]));
      if (M.F[i] === 12) { const g = 1.22 + 0.16 * smooth(1.53, 1.43, M.P[i * 3 + 1]); q[0] *= g; q[2] = (-0.018 - HEAD_BIND_C[2]) * k + (q[2] - (-0.018 - HEAD_BIND_C[2]) * k) * g; }
      const n0 = [M.N[i * 3], M.N[i * 3 + 1], M.N[i * 3 + 2]], w = M.W[i];
      const p = lerp(add(cN, m3v(Nk, q)), add(c, m3v(H, q)), w), n = norm(lerp(m3v(Nk, n0), m3v(H, n0), w));
      const f = M.F[i], mat = f === 7 ? MAT.HEAD : f === 8 ? MAT.EAR : f === 9 ? MAT.HAIR : MAT.NECK;
      // the colour carries what the head's shader needs: the bind point's depth, the rest normal's z
      // (or an ear's hollow), and which player this is
      V.push({ p, n, uv: [M.UV[i * 2], M.UV[i * 2 + 1]], col: [M.P[i * 3 + 2], f === 8 ? M.X[i] : n0[2], idx], mat, w: [[BONE.neck, 1 - w], [BONE.head, w]] });
    }
    for (let t = 0; t < M.I.length; t += 3) tri(b, V[M.I[t]], V[M.I[t + 1]], V[M.I[t + 2]]);
  };
  emit(headMesh(0));
  emit(hairMesh(face.style, 0));
}

// Headwear fitted to the skull in the head's bind space: a shell `t` off the skull from the crown
// down to a band line, and a bill off the band's front. `band(a)` is the band's height at angle a
// round the head, 0 in front and pi behind, positive on the player's left.
const headFrame = (W, look) => ({ c: look.headC, H: W.head, k: FT * look.s * (look.headScale || 1) });
const toHead = (F, p) => add(F.c, m3v(F.H, mul(sub(p, HEAD_BIND_C), F.k)));
const skullOut = (y, a, t) => {
  const p = skullPoint(y, Math.PI / 2 - a);
  return add(p, mul(norm([p[0], (p[1] - 1.63) * 1.25, p[2] - SKULL_ZC]), t));
};
function skullShell(G, F, band, t, opt) {
  const rows = opt.rows || 12, cols = opt.cols || 40, T = typeof t === 'function' ? t : () => t;
  emitGrid(G, rows, cols, (i, j) => {
    const a = (j / cols) * TAU - Math.PI, v = Math.pow(i / (rows - 1), 0.85);
    const y = 1.7505 + (band(a) - 1.7505) * v;
    return toHead(F, skullOut(y, a, T(a, y)));
  }, { key: opt.key || 'plain', col: opt.col, mat: opt.mat, centre: F.c });
}
function bill(G, F, band, t, L, span, drop, colTop, colUnder, mat) {
  const across = 9, along = 6;
  const pt = (i, j, off) => {
    const sAc = (j / (across - 1)) * 2 - 1, u = i / (along - 1), a = sAc * span, base = skullOut(band(a), a, t);
    const d = norm(lerp(norm([base[0], 0, base[2] - SKULL_ZC]), [0, 0, 1], 0.55));
    const p = add(base, mul(d, L * (1 - 0.38 * sAc * sAc) * u));
    p[1] += -drop * u - 0.012 * sAc * sAc * u + off;
    return toHead(F, p);
  };
  emitGrid(G, along, across, (i, j) => pt(i, j, 0), { key: 'plain', col: colTop, mat, wrap: false, flip: true });
  emitGrid(G, along, across, (i, j) => pt(i, j, -0.003), { key: 'plain', col: colUnder, mat, wrap: false, flip: false });
}
// A club's monogram on the crown or the helmet's side: `cell` is its place in the logo atlas.
function logoOn(G, F, band, t, a0, a1, y0, y1, cell, mat, mirror = false) {
  emitGrid(G, 4, 4, (i, j) => { const a = a0 + (a1 - a0) * (j / 3), y = y1 - (y1 - y0) * (i / 3); return toHead(F, skullOut(y, a, t + 0.0012)); },
    { key: 'logo', col: [1, 1, 1], mat, wrap: false, centre: F.c, uv: (i, j) => [(cell + (mirror ? 1 - j / 3 : j / 3)) / 2, i / 3] });
}
// The cap's band, and the batting helmet's for the ear it covers. Exported for the gate, which
// holds them above the brow and the ears (ballpark-smoke.mjs).
export const capBand = (a) => 1.684 - 0.03 * (1 - Math.cos(a)) / 2;
const earFall = (a) => { const d = Math.abs(a) - 1.8; return Math.exp(-((d / (d < 0 ? 0.26 : 0.5)) ** 2)); };
export const helmetBand = (flapSide) => (a) => 1.678 - 0.062 * (1 - Math.cos(a)) / 2 + (Math.sin(a) * flapSide > 0 ? -0.07 : 0.012) * earFall(a);
// How far each bill drops at its tip, and the mask's bars from the brow to under the chin, in metres.
export const BILL_DROP = Object.freeze({ cap: 0.012, helmet: 0.006 });
export const MASK_SPAN = Object.freeze([1.705, 1.505]);
function cap(G, W, s, look, col, under, cell) {
  const F = headFrame(W, look);
  skullShell(G, F, capBand, 0.011, { col, mat: MAT.CLOTH });
  ellipsoid(G, 'plain', toHead(F, [0, 1.7505 + 0.0125, SKULL_ZC]), [W.head[0], W.head[1], W.head[2]], [0.03 * s, 0.018 * s, 0.03 * s], 5, 8, col, MAT.CLOTH);
  bill(G, F, capBand, 0.011, 0.074, 1.25, BILL_DROP.cap, col, under, MAT.CLOTH);
  if (cell != null) logoOn(G, F, capBand, 0.011, -0.42, 0.42, capBand(0) + 0.004, capBand(0) + 0.044, cell, MAT.CLOTH);
}
// The batting helmet: the shell comes down over the ear facing the pitcher and stops above the
// other one, the flap standing off the ear it covers.
function helmet(G, W, s, look, flapSide, col, cell) {
  const F = headFrame(W, look), ear = earFall, band = helmetBand(flapSide);
  const t = (a, y) => 0.021 + (Math.sin(a) * flapSide > 0 ? 0.009 * ear(a) * Math.exp(-(((y - 1.615) / 0.045) ** 2)) : 0);
  skullShell(G, F, band, t, { col, mat: MAT.GLOSS, rows: 14, cols: 48 });
  skullShell(G, F, band, (a, y) => t(a, y) - 0.005, { col: hex('#141414'), mat: MAT.CLOTH, rows: 14, cols: 48 });
  bill(G, F, band, 0.022, 0.036, 0.62, BILL_DROP.helmet, col, mul(col, 0.6), MAT.GLOSS);
  if (cell != null) logoOn(G, F, band, 0.022, flapSide * 1.15, flapSide * 1.75, 1.665, 1.715, cell, MAT.GLOSS, flapSide > 0);
}
// A mask's bars a few centimetres off the face, from the brow to under the chin.
function mask(G, W, s, look) {
  const F = headFrame(W, look);
  emitGrid(G, 9, 13, (i, j) => {
    const a = ((j / 12) * 2 - 1) * 1.15, y = MASK_SPAN[0] - (MASK_SPAN[0] - MASK_SPAN[1]) * (i / 8), yy = Math.max(y, 1.53);
    const p = skullOut(yy, a, 0.036 + 0.02 * Math.cos(a));
    p[1] = y;
    if (y < 1.53) p[2] -= (1.53 - y) * 0.6;
    return toHead(F, p);
  }, { key: 'mask', col: [0.2, 0.2, 0.22], mat: MAT.METAL, wrap: false, centre: F.c, uv: (i, j) => [j / 12, i / 8] });
}
// The catcher: a hard skull cap worn back to front, the mask, a chest protector and shin guards.
function catcherGear(G, J, W, s, look, col) {
  const F = headFrame(W, look);
  skullShell(G, F, (a) => 1.672 - 0.05 * (1 - Math.cos(a)) / 2, 0.02, { col, mat: MAT.GLOSS });
  mask(G, W, s, look);
  for (const S of ['L', 'R']) {
    limb(G, J['hip' + S], J['kn' + S], J['an' + S], m3v(W.pelvis, [0, 0, 1]), [[1.35, 0.255, 0.28, 'g'], [1.6, 0.265, 0.29, 'g'], [2.0, 0.215, 0.235, 'g'], [2.6, 0.185, 0.2, 'g'], [3.05, 0.17, 0.18, 'g']], s,
      () => 'plain', () => col, () => MAT.GLOSS, () => [0, 0], LEG_RIG[S]);
  }
  const pad = hex('#1a2b52');
  const pts = TORSO.slice(5, 12).map(([f, o, w, d]) => ({ c: add(J[f], m3v(W[f], mul(o, s))), X: W[f][0], Z: W[f][2], w: (w + 0.05) * s, d: (d + 0.09) * s }));
  emitGrid(G, pts.length, 12, (i, j) => { const r = pts[i], a = (j / 11 - 0.5) * 190 * DEG; return add(r.c, add(mul(r.X, Math.sin(a) * r.w), mul(r.Z, Math.pow(Math.max(0, Math.cos(a)), 0.7) * r.d))); },
    { key: 'plain', col: (ii, jj) => mul(pad, jj % 3 === 0 ? 0.75 : 1), mat: MAT.CLOTH, wrap: false, centre: J.chest, wts: (ii) => [[FRAME_BONE[TORSO[5 + Math.min(ii, pts.length - 1)][0]], 1]] });
}

// ── one player ─────────────────────────────────────────────────────────────────
// What a player looks like, off his id: skin, hair, a beard on some, eye black on some, a style.
export function lookOf(o) {
  const r = rng(hashStr(o.id));
  const L = { skin: SKINS[Math.floor(r() * SKINS.length)], hair: HAIRS[Math.floor(r() * HAIRS.length)] };
  r();   // the old egg's beard draw, kept so a look doesn't move with the heads
  L.eyeBlack = r() < 0.3;
  // cropped, neat, tousled, now and then long under the cap; the umpires keep it short
  L.hairStyle = o.role === 'ump' ? [0, 1][Math.floor(r() * 2)] : [0, 1, 0, 1, 2, 0, 1, 3][Math.floor(r() * 8)];
  return Object.assign(L, o);
}

// Builds one player into `G`'s batches. `pose` is a pose table entry with `at` and `yaw`; `look`
// says who he is: { id, side ('home' | 'away'), role ('ump', 'catcher', 'pitcher'...), slot (his
// jersey's cell in the kit atlas), glove ('L' | 'R'), helmet, flapSide, mask, battingGloves }.
export function buildPlayer(G, pose, look) {
  const { J, W, s } = solvePose(pose);
  const ump = look.role === 'ump', side = look.side === 'away' ? 'away' : 'home', kit = KITS[side];
  const navyU = hex('#1d2740'), greyU = hex('#7d8186');
  const under = ump ? navyU : hex(kit.ink), trim = ump ? navyU : hex(kit.trim), skin = hex(look.skin);
  const jersey = G.skin ? KIT_REL : kitCell(look.slot ?? 0), pants = KIT_PANTS[side], socks = KIT_SOCKS[side];
  const keyOf = (p) => (ump ? 'plain' : (p === 'jersey' || p === 'sleeve' || p === 'pants' || p === 'sock') ? 'kit' : 'plain');
  const colOf = (p) => ump ? (p === 'pants' ? greyU : p === 'skin' ? skin : p === 'belt' ? hex('#111111') : navyU)
    : (p === 'jersey' || p === 'sleeve' || p === 'pants' || p === 'sock') ? [1, 1, 1] : p === 'belt' ? hex(kit.belt) : p === 'under' ? under : p === 'trim' ? trim : p === 'skin' ? skin : [1, 0, 1];
  const matOf = (p) => (p === 'skin' ? MAT.SKIN : p === 'belt' ? MAT.LEATHER : MAT.CLOTH);
  const uvOf = (p, u, v) => p === 'jersey' ? inCell(jersey, u, (0.93 - v) / 0.47)
    : p === 'sleeve' ? inCell(jersey, 0.505 + u * 0.06, 0.05 + v * 0.3)
    : p === 'pants' ? inCell(pants, u, v)
    : p === 'sock' ? inCell(socks, u, v) : [u, v];
  // down the leg: the sock runs down the shin
  const legUv = (p, u, v) => p === 'sock' ? inCell(socks, u, (v - 0.62) / 0.38) : p === 'pants' ? inCell(pants, u, v * 1.5) : [u, v];
  for (const S of ['L', 'R']) {
    limb(G, J['hip' + S], J['kn' + S], J['an' + S], m3v(W.pelvis, [0, 0, 1]), ump ? SLACKS : LEG, s, keyOf, colOf, matOf, legUv, LEG_RIG[S]);
    limb(G, J['sh' + S], J['el' + S], J['wr' + S], m3v(W.chest, [0, 0, -1]), ARM, s, keyOf, colOf, matOf, uvOf, ARM_RIG[S]);
    G.cur = [[BONE['foot' + S], 1]];
    shoe(G, J, S, s, ump ? hex('#0e0e0e') : hex('#151515'));
  }
  torso(G, J, W, s, keyOf, colOf, matOf, uvOf, look.girth || 0, ump ? 0.07 : 0);
  head(G, J, W, s, look);
  look.s = s;
  const logo = side === 'home' ? 0 : 1;
  G.cur = [[BONE.head, 1]];
  if (look.role === 'catcher') catcherGear(G, J, W, s, look, hex(kit.helmet));
  else if (ump) { cap(G, W, s, look, hex('#111317'), hex('#0a0a0c'), null); if (look.mask) mask(G, W, s, look); }
  else if (look.helmet) helmet(G, W, s, look, look.flapSide || 1, hex(kit.helmet), logo);
  else cap(G, W, s, look, hex(kit.cap), hex(kit.under), logo);
  for (const S of ['L', 'R']) {
    // a hand on a bat holds the bat, glove or no glove
    G.cur = [[BONE[(J['grip' + S] ? 'fist' : 'hand') + S], 1]];
    if (look.glove === S && !J['grip' + S]) glove(G, J, S, s, look.role === 'catcher' ? 'catcher' : 'fielder');
    else hand(G, J, S, s, look.battingGloves ? hex(look.battingGloves) : skin, look.battingGloves ? MAT.LEATHER : MAT.SKIN);
  }
  G.cur = [[BONE.bat, 1]];
  if (pose.bat) bat(G, J, s);
  return { J, W, s, feet: [J.anL, J.anR, J.toeL, J.toeR] };
}

// One player for the GPU to skin: built once, in the rig's bind pose (diamond/rig.js bindPoses),
// into a set made with `{ skin: true }`. A hitter (anyone in a helmet) also gets his fists and his
// bat, built in the rig's batting stance on their own bones. The jersey's uv is relative to its
// cell (KIT_REL) and the face's slot is the draw's, so one body stands in any slot all game.
export function buildBody(G, look) {
  if (!G.skin) throw new Error('buildBody wants a skinned set: createPlayerSet({ skin: true })');
  const { body, grip } = bindPoses(look.scale || 1);
  const res = buildPlayer(G, body, { ...look, headIndex: 0 });
  if (look.helmet) {
    const { J, s } = solvePose(grip), col = look.battingGloves ? hex(look.battingGloves) : hex(look.skin);
    for (const S of ['L', 'R']) { G.cur = [[BONE['fist' + S], 1]]; hand(G, J, S, s, col, look.battingGloves ? MAT.LEATHER : MAT.SKIN); }
    G.cur = [[BONE.bat, 1]];
    bat(G, J, s);
  }
  return res;
}

// A set of batches to build players into, and the heads' face records in the order built. A
// skinned set's batches carry bone weights (buildBody).
export function createPlayerSet({ skin = false } = {}) {
  const batches = new Map(), heads = [];
  const make = () => (skin ? createSkinBatch(1 << 13) : createBatch(1 << 14));
  return { batches, heads, skin, cur: [[BONE.pelvis, 1]], B: (key) => { let b = batches.get(key); if (!b) { b = make(); batches.set(key, b); } return b; } };
}
