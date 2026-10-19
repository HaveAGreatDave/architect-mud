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
import { solvePose, mirrorPose, POSES, BONE, bindPoses, SC_JOINT } from '../diamond/rig.js';
// the pose language moved to the rig; the gates and the renderer still find it here
export { solvePose, mirrorPose, POSES };
import { headMesh, hairMesh, skullPoint, ZC as SKULL_ZC } from '../actor-head.js';
import { FACE_LAYOUTS, actorFace, faceHair, faceLip } from '../actor-faces.js';
import { clubOf } from '../club-crest.js';

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
export function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function hashStr(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const decode = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export const hex = (h) => { const n = parseInt(String(h).slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => decode(v / 255)); };

// The house kits, for a club with no identity of its own: home cream with navy pinstripes and
// teal, away grey with black and rust.
export const KITS = {
  home: { base: '#f2f0e8', ink: '#16264a', trim: '#1d8a8c', cap: '#16264a', under: '#1d3b30', helmet: '#16264a', belt: '#16264a', house: true, sig: 'house:home' },
  away: { base: '#9a9da2', ink: '#17171a', trim: '#b04a1c', cap: '#17171a', under: '#2c2c2c', helmet: '#121214', belt: '#111111', house: true, sig: 'house:away' },
};
// The kit a side wears tonight. A club with an identity (sports_pools.clubs, held by
// club-crest.js) wears its own, the home kit at home and the road kit away, with anything it
// leaves out filled from the house kit; any other club wears the house kit. `sig` names the kit,
// so the atlas and the bodies rebuild when a club's arrives; `club` carries the crest.
const _worn = new WeakMap();
export function sideKit(side, team) {
  const s = side === 'away' ? 'away' : 'home', house = KITS[s];
  const club = team ? clubOf(team, 'baseball') : null, own = club?.kit?.[s === 'away' ? 'road' : 'home'];
  if (!own || typeof own !== 'object') return house;
  let k = _worn.get(own);
  if (!k || k.club !== club) {
    k = { ...house, pants: own.base || house.base, stirrups: own.ink || house.ink, ...own, house: false, club };
    k.bill = k.bill || k.cap;
    k.number = Array.isArray(own.number) && own.number.length ? own.number : [k.ink, k.trim];
    k.wordmark = String(own.wordmark || '').trim();
    k.sig = `${s}:${hashStr(JSON.stringify(own) + '|' + JSON.stringify(club.crest?.small || club.crest?.layers || null))}`;
    _worn.set(own, k);
  }
  return k;
}
export const SKINS = ['#e9c2a0', '#d9a77f', '#b77a52', '#8d5a3b', '#5e3a26', '#f0cdb0'];
export const HAIRS = ['#1d1510', '#3a2416', '#5b3a1e', '#141414', '#7a5530', '#2a1c12'];

// ── the kit atlas ──────────────────────────────────────────────────────────────
// One 2048² texture holds every jersey (a 512×256 slot each, 28 of them, in rows 0 to 6) and,
// in row 7, each side's trousers and socks. A jersey is flattened round the body: u runs round it
// with the chest a quarter of the way in and the back three quarters, v from the collar down.
export const kitCell = (slot) => [(slot % 4) / 4, Math.floor(slot / 4) / 8, 1 / 4, 1 / 8];
export const KIT_PANTS = { home: [0, 7 / 8, 1 / 4, 1 / 8], away: [1 / 4, 7 / 8, 1 / 4, 1 / 8] };
export const KIT_SOCKS = { home: [2 / 4, 7 / 8, 1 / 4, 1 / 8], away: [3 / 4, 7 / 8, 1 / 4, 1 / 8] };
// A cell's uv from a part's own 0..1, kept a texel or two inside so the slots don't bleed.
const inCell = (c, u, v) => [c[0] + (0.004 + clamp(u, 0, 1) * 0.992) * c[2], c[1] + (0.008 + clamp(v, 0, 1) * 0.984) * c[3]];
// A skinned body is built once and stands in any slot, so its jersey's uv is the cell's own 0..1
// moved two to the right, and the shader puts it in the slot's cell (uKitCell in gl/ballpark.js).
const KIT_REL = Object.freeze([2, 0, 1, 1]);

// ── skinned vertices ─────────────────────────────────────────────────────────────
// A skinned vertex is ballpark-mesh.js's twelve floats and two more words: four bone indices and
// four weights, a byte each, the weights summing to 255.
export const SKIN_STRIDE = STRIDE + 2;
function createSkinBatch(cap = 4096) { const data = new Float32Array(cap * SKIN_STRIDE); return { data, u8: new Uint8Array(data.buffer), n: 0, skin: true }; }
function growSkin(b, more) {
  const need = (b.n + more) * SKIN_STRIDE;
  if (need <= b.data.length) return;
  const d = new Float32Array(Math.max(need, b.data.length * 2));
  d.set(b.data.subarray(0, b.n * SKIN_STRIDE));
  b.data = d; b.u8 = new Uint8Array(d.buffer);
}
// `w` is [[bone, weight], …]: up to four, any weights, kept as bytes that sum to 255.
function vtxSkin(b, p, n, uv, col, mat, w) {
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
    if (l > 1e-9) { N.push(mul(n, 1 / l)); continue; }
    // a pole, where the row pinches to a point: out from the middle of the next row in, whichever
    // way the pole faces (a fixed up shaded a pole facing anywhere else as a dark dot)
    const k = i === 0 ? 1 : i === rows - 1 ? rows - 2 : i;
    let m = [0, 0, 0];
    for (let jj = 0; jj < cols; jj++) m = add(m, at(k, jj));
    const d = sub(at(i, j), mul(m, 1 / cols)), ld = len(d);
    N.push(ld > 1e-9 ? mul(d, 1 / ld) : [0, 1, 0]);
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
        return { p: P[idx], n: mul(N[idx], sign), uv: uv(ii, jj), col: c, mat: m, w: wts ? wts(ii, jj % cols) : G.cur };
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

// The body's profiles. The torso's rings: [frame, height in it, half-width, depth in front, depth
// behind, what it's made of]. The torso is the body without its arms: narrow under them, deep at
// the chest and the seat, the jersey bloused a touch over the belt. The breadth of the shoulders is
// the arms' own (ARM's cap), so an arm hanging at the side lies against the ribs and an arm across
// the chest passes in front of it; the hull the rig keeps the arms off (diamond/rig.js HULL)
// stands just inside these.
export const TORSO = Object.freeze([
  ['pelvis', -0.42, 0.30, 0.22, 0.26, 'pants'], ['pelvis', -0.30, 0.54, 0.36, 0.44, 'pants'], ['pelvis', -0.12, 0.61, 0.38, 0.46, 'pants'],
  ['pelvis', 0.06, 0.595, 0.38, 0.41, 'pants'], ['pelvis', 0.18, 0.57, 0.375, 0.385, 'pants'], ['pelvis', 0.22, 0.575, 0.385, 0.385, 'belt'],
  ['pelvis', 0.30, 0.57, 0.38, 0.38, 'belt'], ['spine', 0.03, 0.578, 0.402, 0.377, 'jersey'], ['spine', 0.26, 0.58, 0.41, 0.37, 'jersey'],
  ['chest', 0.02, 0.60, 0.44, 0.385, 'jersey'], ['chest', 0.20, 0.625, 0.475, 0.405, 'jersey'], ['chest', 0.36, 0.615, 0.45, 0.42, 'jersey'],
  ['chest', 0.47, 0.6, 0.39, 0.4, 'jersey'], ['chest', 0.55, 0.5, 0.31, 0.34, 'jersey'], ['chest', 0.61, 0.29, 0.23, 0.25, 'jersey'],
  ['neck', 0.02, 0.24, 0.225, 0.225, 'skin'],
].map(Object.freeze));
// A leg, hip to ankle, and an arm, shoulder to wrist: [along it from the joint, half-width across,
// half-depth, what it's made of]. The pants are cut full through the thigh and gathered below the
// knee, bloused over the elastic, the stirrup sock below. The arm's tube starts just short of the
// shoulder joint, inside the deltoid (`deltoid`, on the collarbone, so the cap stays on top of the
// shoulder wherever the arm swings: a cap on the arm stood up behind it like a pad whenever the
// arm came across); the sleeve ends half way down the upper arm in its piping, and the undershirt
// runs on to the wrist.
const LEG = [[-0.24, 0.31, 0.33, 'pants'], [0.08, 0.322, 0.342, 'pants'], [0.5, 0.302, 0.318, 'pants'], [1.0, 0.262, 0.276, 'pants'], [1.4, 0.24, 0.252, 'pants'],
  [1.6, 0.236, 0.246, 'pants'], [1.8, 0.242, 0.252, 'pants'], [1.88, 0.234, 0.244, 'pants'], [1.905, 0.2, 0.208, 'pants'], [1.93, 0.176, 0.186, 'sock'],
  [2.15, 0.18, 0.198, 'sock'], [2.45, 0.158, 0.172, 'sock'], [2.78, 0.12, 0.13, 'sock'], [3.02, 0.104, 0.11, 'sock']];
const SLACKS = [[-0.24, 0.30, 0.32, 'pants'], [0.10, 0.31, 0.33, 'pants'], [0.55, 0.285, 0.30, 'pants'], [1.05, 0.25, 0.26, 'pants'], [1.55, 0.225, 0.235, 'pants'],
  [2.1, 0.205, 0.215, 'pants'], [2.6, 0.19, 0.20, 'pants'], [3.0, 0.18, 0.19, 'pants']];
const ARM = [[-0.035, 0, 0, 'sleeve'], [-0.03, 0.12, 0.124, 'sleeve'], [-0.02, 0.175, 0.18, 'sleeve'],
  [-0.02, 0.21, 0.216, 'sleeve'], [0.1, 0.218, 0.223, 'sleeve'], [0.24, 0.212, 0.218, 'sleeve'], [0.38, 0.208, 0.214, 'sleeve'],
  [0.43, 0.207, 0.213, 'trim'], [0.455, 0.206, 0.212, 'trim'], [0.462, 0.186, 0.19, 'under'], [0.47, 0.172, 0.178, 'under'],
  [0.62, 0.178, 0.184, 'under'], [0.82, 0.154, 0.16, 'under'], [0.98, 0.143, 0.15, 'under'], [1.14, 0.152, 0.157, 'under'],
  [1.42, 0.127, 0.114, 'under'], [1.7, 0.103, 0.082, 'under'], [1.86, 0.094, 0.076, 'under'], [1.89, 0.08, 0.066, 'under'], [1.91, 0, 0, 'under']];

function sampleProfile(prof, n0 = 3) {
  const out = [];
  for (let i = 0; i < prof.length - 1; i++) {
    const a = prof[i], b = prof[i + 1], n = Math.max(1, Math.min(n0, Math.round((b[0] - a[0]) / 0.11)));
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
  const cols = 20, rows = rings.length;
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
// The deltoid under the sleeve: a cap over the shoulder joint, riding the collarbone, rounder on top
// than under, where the arm's own tube runs on out of it.
function deltoid(G, J, W, S, s, keyOf, colOf, matOf, uvOf) {
  const C = W['clav' + S] || W.chest, sg = S === 'L' ? 1 : -1, c = add(J['sh' + S], m3v(C, [-sg * 0.015 * s, 0, 0])), rows = 7, cols = 14;
  // its poles, where a sphere's grid pinches, point down into the arm and up into the trapezius,
  // where nothing sees them; on top a pole showed as a dark dot
  const Pa = norm([sg * 0.6, -0.8, 0]), Qa = [0, 0, 1], Ra = cross(Pa, Qa);
  // the jersey's stripes laid on from the front, so they run down the shoulder and don't gather at a pole
  const unitAt = (i, j) => { const th = i / (rows - 1) * Math.PI, ph = j / cols * TAU, ct = Math.cos(th), st = Math.sin(th); return [0, 1, 2].map((k) => Pa[k] * ct + st * (Qa[k] * Math.cos(ph) + Ra[k] * Math.sin(ph))); };
  emitGrid(G, rows, cols, (i, j) => {
    const u = unitAt(i, j);
    return add(c, m3v(C, [u[0] * 0.19 * s, u[1] * (u[1] > 0 ? 0.135 : 0.12) * s, u[2] * 0.2 * s]));
  },{ key: keyOf('sleeve'), col: colOf('sleeve'), mat: matOf('sleeve'), uv: (i, j) => { const u = unitAt(i, j); return uvOf('sleeve', clamp(0.5 + sg * u[0] * 0.5, 0, 1), clamp(0.3 - u[1] * 0.3, 0, 1)); }, centre: c, wts: () => [[BONE['clav' + S], 1]] });
}
// The torso's frames as bones, for a skinned body.
const FRAME_BONE = { pelvis: BONE.pelvis, spine: BONE.spine, chest: BONE.chest, neck: BONE.neck };
const LEG_RIG = { L: { a: BONE.thighL, b: BONE.shinL, parent: BONE.pelvis, root: [-0.24, 0.25, 0.5] }, R: { a: BONE.thighR, b: BONE.shinR, parent: BONE.pelvis, root: [-0.24, 0.25, 0.5] } };
const ARM_RIG = { L: { a: BONE.upperArmL, b: BONE.forearmL, parent: BONE.clavL, root: [-0.21, 0.12, 0.3] }, R: { a: BONE.upperArmR, b: BONE.forearmR, parent: BONE.clavR, root: [-0.21, 0.12, 0.3] } };
// The top of the torso at either side, over the shoulder blade and up to the neck, rides its
// collarbone (BONE.clavL, clavR) by up to CLAV_RIDE: a shrug lifts it and a reach across carries it
// forward, with the arm's own cap. The posed build moves it as the skin would: by the girdle's turn
// since the bind pose (the rig's frames), about the sternoclavicular joint.
const CLAV_RIDE = 0.55;
const clavShare = (yc, sinA) => CLAV_RIDE * smooth(0.28, 0.5, yc) * (1 - smooth(0.6, 0.68, yc)) * smooth(0.3, 0.85, Math.abs(sinA));
const tr3 = (M) => [[M[0][0], M[1][0], M[2][0]], [M[0][1], M[1][1], M[2][1]], [M[0][2], M[1][2], M[2][2]]];
const m3m = (a, b) => [m3v(a, b[0]), m3v(a, b[1]), m3v(a, b[2])];
const BIND_W = new Map();
function bindGirdle(s) {
  let g = BIND_W.get(s);
  if (!g) {
    const { W } = solvePose(bindPoses(s).body);
    BIND_W.set(s, (g = { L: m3m(tr3(W.chest), W.clavL), R: m3m(tr3(W.chest), W.clavR) }));
  }
  return g;
}
function torso(G, J, W, s, keyOf, colOf, matOf, uvOf, extra = 0, front = 0) {
  const R = TORSO.map(([f, y, w, df, db, part]) => {
    const M = W[f], add2 = part === 'jersey' ? front : 0;
    return { f, y, c: add(J[f], m3v(M, [0, y * s, 0])), X: M[0], Z: M[2], w: (w + extra) * s, df: (df + extra + add2) * s, db: (db + extra + add2 * 0.6) * s, part };
  });
  const rings = [];
  // a ring's height in the chest's frame, for what rides the collarbones (the neck's ring stands
  // about where the chest's top one does)
  const yc = (r) => (r.f === 'chest' ? r.y : r.f === 'neck' ? 0.64 : -1);
  for (let i = 0; i < R.length - 1; i++) {
    const a = R[i], b = R[i + 1];
    for (let k = 0; k < 3; k++) {
      const t = k / 3, p0 = R[Math.max(0, i - 1)].c, p3 = R[Math.min(R.length - 1, i + 2)].c, t2 = t * t, t3 = t2 * t;
      // Catmull-Rom through the ring centres
      const c = [0, 1, 2].map((q) => 0.5 * ((2 * a.c[q]) + (-p0[q] + b.c[q]) * t + (2 * p0[q] - 5 * a.c[q] + 4 * b.c[q] - p3[q]) * t2 + (-p0[q] + 3 * a.c[q] - 3 * b.c[q] + p3[q]) * t3));
      rings.push({ c, X: norm(lerp(a.X, b.X, t)), Z: norm(lerp(a.Z, b.Z, t)), w: a.w + (b.w - a.w) * t, df: a.df + (b.df - a.df) * t, db: a.db + (b.db - a.db) * t,
        part: a.part, v: (i + t) / (R.length - 1), f0: a.f, f1: b.f, t, yc: yc(a) + (yc(b) - yc(a)) * t });
    }
  }
  const L = R[R.length - 1];
  rings.push({ c: L.c, X: L.X, Z: L.Z, w: L.w, df: L.df, db: L.db, part: L.part, v: 1, f0: L.f, f1: L.f, t: 0, yc: yc(L) });
  // the girdle's turn since the bind pose, each side, in the chest's frame
  const Gb = bindGirdle(s), Cw = W.chest, CwT = tr3(Cw);
  const turn = {};
  for (const S of ['L', 'R']) turn[S] = W['clav' + S] ? m3m(m3m(CwT, W['clav' + S]), tr3(Gb[S])) : null;
  const scOf = (S) => [(S === 'L' ? 1 : -1) * SC_JOINT[0] * s, SC_JOINT[1] * s, SC_JOINT[2] * s];
  const cols = 34, pw = 2.5, sp = (x) => Math.sign(x) * Math.pow(Math.abs(x), 2 / pw);
  emitGrid(G, rings.length, cols, (i, j) => {
    const r = rings[i], a = (j / cols - 0.25) * TAU, ca = Math.cos(a);
    const p = add(r.c, add(mul(r.X, sp(Math.sin(a)) * r.w), mul(r.Z, sp(ca) * (ca > 0 ? r.df : r.db))));
    const w = G.skin ? 0 : clavShare(r.yc, Math.sin(a)), S = Math.sin(a) > 0 ? 'L' : 'R';
    if (!(w > 0) || !turn[S]) return p;
    // about the collarbone's joint, by the share that rides it
    const sc = scOf(S), Lc = m3v(CwT, sub(p, J.chest)), moved = add(sc, m3v(turn[S], sub(Lc, sc)));
    return add(J.chest, m3v(Cw, lerp(Lc, moved, w)));
  }, {
    key: (i) => keyOf(rings[i].part), col: (ii) => colOf(rings[Math.min(ii, rings.length - 1)].part), mat: (i) => matOf(rings[i].part),
    uv: (i, j) => uvOf(rings[i].part, j / cols, rings[i].v), centre: J.chest,
    wts: (ii, jj) => {
      const r = rings[Math.min(ii, rings.length - 1)];
      const base = r.f0 === r.f1 ? [[FRAME_BONE[r.f0], 1]] : [[FRAME_BONE[r.f0], 1 - r.t], [FRAME_BONE[r.f1], r.t]];
      const sa = Math.sin((jj / cols - 0.25) * TAU), w = clavShare(r.yc, sa);
      return w > 0 ? [...base.map(([b, x]) => [b, x * (1 - w)]), [BONE[sa > 0 ? 'clavL' : 'clavR'], w]] : base;
    },
  });
}
// A shoe's sole lies flat when the foot does: a planted foot's line from the ankle to the toe runs
// down at FOOT_PITCH (diamond/anim.js puts the ankle 0.28 ft up and the toe 0.07 ft up, 0.62 out),
// so the sole is that line turned back up by as much, and its bottom 0.28 ft under the ankle.
const FOOT_PITCH = Math.asin((0.28 - 0.07) / 0.62);
// The cleat's outline from the heel to the toe: [along the sole from under the ankle, half-width,
// the upper's top over the sole's bottom, the bottom's lift (the toe springs up)], in feet.
const CLEAT = [[-0.235, 0.05, 0.19, 0.016], [-0.215, 0.095, 0.255, 0.006], [-0.15, 0.125, 0.3, 0], [-0.05, 0.14, 0.31, 0], [0.08, 0.15, 0.27, 0],
  [0.22, 0.156, 0.22, 0], [0.36, 0.165, 0.17, 0], [0.5, 0.168, 0.135, 0.004], [0.62, 0.158, 0.11, 0.012], [0.71, 0.13, 0.092, 0.022],
  [0.77, 0.085, 0.076, 0.032], [0.8, 0.02, 0.058, 0.04]];
// the steel spikes under it: [along, across]
const SPIKES = [[0.45, 0.1], [0.45, -0.1], [0.58, 0.105], [0.58, -0.105], [0.7, 0.06], [0.7, -0.06], [0.76, 0], [-0.17, 0], [-0.1, 0.075], [-0.1, -0.075]];
// A cleat: black leather over a firm sole, a white stripe sweeping up the outside to the heel,
// laces up the instep and steel spikes under it. `col` is the leather; `stripe` false for the
// umpires' and the crew's plain shoes, which have no spikes either.
function shoe(G, J, S, s, col, stripe = true) {
  const an = J['an' + S], toe = J['toe' + S];
  const F = norm(sub(toe, an)), side0 = norm(cross(norm(sub(J['kn' + S], an)), F)), U = norm(cross(F, side0));
  const Fs = norm(add(mul(F, Math.cos(FOOT_PITCH)), mul(U, Math.sin(FOOT_PITCH)))), Us = norm(sub(mul(U, Math.cos(FOOT_PITCH)), mul(F, Math.sin(FOOT_PITCH))));
  const Sd = norm(cross(Us, Fs)), out = S === 'L' ? 1 : -1, base = madd(an, Us, -0.28 * s);
  const at = (along, across, up) => add(base, add(mul(Fs, along * s), add(mul(Sd, across * s), mul(Us, up * s))));
  const sole = hex('#1b1b1c'), white = hex('#e8e6e0'), lace = mul(col, 1.9), cols = 14;
  // the sole: from the ground up to where the upper sits on it, a hair wider than the upper
  const soleTop = (i) => (CLEAT[i][0] < 0 ? 0.055 : 0.04) + CLEAT[i][3];
  emitGrid(G, CLEAT.length, cols, (i, j) => {
    const [x, w, , lift] = CLEAT[i], a = j / cols * TAU, ca = Math.cos(a), sa = Math.sin(a);
    const y = lift + (soleTop(i) - lift) * (0.5 + 0.5 * Math.sign(ca) * Math.pow(Math.abs(ca), 0.25));
    return at(x, (w + 0.012) * Math.sign(sa) * Math.pow(Math.abs(sa), 0.5), y);
  }, { key: 'plain', col: sole, mat: MAT.MATTE, centre: at(0.25, 0, 0.05) });
  // the upper, its cross-section a rounded box on the sole
  emitGrid(G, CLEAT.length, cols, (i, j) => {
    const [x, w, top] = CLEAT[i], yb = soleTop(i) - 0.004, a = j / cols * TAU, ca = Math.cos(a), sa = Math.sin(a);
    const hh = (top - yb) / 2, y = yb + hh + hh * Math.sign(ca) * Math.pow(Math.abs(ca), ca < 0 ? 0.35 : 0.9);
    return at(x, w * Math.sign(sa) * Math.pow(Math.abs(sa), 0.7), y);
  }, {
    key: 'plain', mat: MAT.LEATHER, centre: at(0.25, 0, 0.1),
    col: (ii, jj) => {
      const [x, , top] = CLEAT[ii], a = jj / cols * TAU, ca = Math.cos(a), sa = Math.sin(a), f = 0.5 - 0.5 * ca;
      // laces in rungs up the instep, and the stripe along the outside, rising toward the heel
      if (ca > 0.82 && x > 0.06 && x < 0.5 && Math.abs(sa) < 0.4) return Math.round(x * 30) % 2 ? lace : mul(lace, 0.7);
      const mid = 0.42 + 0.22 * clamp((0.45 - x) / 0.6, 0, 1);
      if (stripe && sa * out > 0.55 && x > -0.2 && x < 0.62 && Math.abs(f - mid) < 0.09 && top > 0.09) return white;
      return col;
    },
  });
  if (!stripe) return;
  // the spikes, little steel pyramids under the sole
  const b = G.B('plain'), steel = hex('#9a9c9f');
  for (const [x, z] of SPIKES) {
    const lift = x < 0 ? 0 : x > 0.7 ? 0.02 : 0;
    const tip = at(x, z, lift - 0.032), r = 0.018;
    const c4 = [[r, r], [r, -r], [-r, -r], [-r, r]].map(([u, v]) => at(x + u, z + v, lift + 0.002));
    for (let k = 0; k < 4; k++) {
      const p1 = c4[k], p2 = c4[(k + 1) % 4], n = norm(cross(sub(p2, p1), sub(tip, p1)));
      const nn = dot(n, Us) > 0 ? mul(n, -1) : n, v = (p) => ({ p, n: nn, uv: [0, 0], col: steel, mat: MAT.METAL, w: G.cur });
      tri(b, v(p1), v(p2), v(tip));
    }
  }
}
// A hand: round a bat's handle a fist of ridged fingers, a thumb, a heel and a strap; otherwise
// open along the forearm.
function hand(G, J, S, s, col, mat) {
  const c = J['hand' + S];
  if (J['grip' + S]) {
    const d = J.batDir, back = norm(sub(J['wr' + S], c)), bk = norm(sub(back, mul(d, dot(back, d)))), side = norm(cross(d, bk));
    const Wd = 0.29 * s, rows = 15, cols = 22;
    emitGrid(G, rows, cols, (i, j) => {
      const t = i / (rows - 1), a = j / cols * TAU, along = (t - 0.5) * Wd;
      const cap = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(2 * t - 1), 6)), 0.5);
      const fingerSide = 0.5 - 0.5 * Math.cos(a), roll = 0.5 + 0.5 * Math.cos(t * 4 * TAU);
      const knuckle = Math.pow(Math.max(0, Math.cos(a - Math.PI * 0.62)), 3) * (0.5 + 0.5 * Math.cos(t * 4 * TAU));
      const r = (0.062 + 0.011 * roll * fingerSide + 0.012 * knuckle) * s * (0.35 + 0.65 * cap);
      const rr = Math.max(r * cap, 0.048 * s);
      return add(madd(c, d, along), add(mul(bk, Math.cos(a) * rr), mul(side, Math.sin(a) * rr)));
    }, { key: 'plain', col, mat, centre: c });
    // the hand itself, from the wrist out to the knuckles round the handle: without it the fingers
    // held the bat a fifth of a foot short of the forearm, a fist floating off the end of the arm.
    // The wrist sits where the rig puts it from the grip, so the hand rides the fist's bone whole
    const w = J['wr' + S], toC = sub(c, w), Lh = len(toC), a1 = mul(toC, 1 / (Lh || 1)), a3 = norm(cross(a1, d));
    ellipsoid(G, 'plain', lerp(w, c, 0.5), [a3, a1, d], [0.068 * s, Lh / 2 + 0.03 * s, 0.112 * s], 9, 14, col, mat);
    // the thumb, down the side of the handle past the fingers
    const sg = S === 'L' ? 1 : -1, tb = madd(madd(lerp(w, c, 0.55), side, sg * 0.075 * s), d, 0.04 * s), tt = add(madd(c, d, Wd * 0.38), mul(add(mul(bk, -0.25), mul(side, sg * 0.9)), 0.066 * s));
    tube(G, [[tb, 0.036 * s, 0.032 * s], [lerp(tb, tt, 0.5), 0.034 * s, 0.03 * s], [tt, 0.03 * s, 0.027 * s], [madd(tt, norm(sub(tt, tb)), 0.025 * s), 0.012 * s, 0.011 * s]], side, 7, { key: 'plain', col: mul(col, 0.95), mat, centre: lerp(tb, tt, 0.5) });
    return;
  }
  // open: the palm from the wrist to the knuckles, four fingers curled a little toward it and the
  // thumb off its side, in the hand's frame (hd to the fingertips, pm out of the palm, the thumb on
  // +sd for the right hand and -sd for the left)
  const hd = J['hdir' + S], pm = J['palm' + S], sd = norm(cross(pm, hd)), th = S === 'L' ? -1 : 1, wr = J['wr' + S];
  const P = (x, y, z) => add(wr, add(mul(sd, th * x * s), add(mul(hd, y * s), mul(pm, z * s))));
  ellipsoid(G, 'plain', P(0, 0.16, -0.005), [sd, hd, pm], [0.112 * s, 0.155 * s, 0.045 * s], 9, 14, col, mat);
  for (let f = 0; f < 4; f++) {
    const x = 0.075 - f * 0.05, L = [0.22, 0.24, 0.225, 0.18][f], st = [];
    for (let k = 0; k <= 5; k++) { const u = k / 5, r = (0.027 - 0.004 * u) * (k === 5 ? 0.45 : 1); st.push([P(x * (1 + 0.15 * u), 0.29 + L * u, 0.035 * u * u), r * s, r * 0.9 * s]); }
    tube(G, st, sd, 6, { key: 'plain', col, mat, centre: P(x, 0.29 + L / 2, 0) });
  }
  const tst = [];
  for (let k = 0; k <= 5; k++) { const u = k / 5, r = (0.034 - 0.006 * u) * (k === 5 ? 0.5 : 1); tst.push([P(0.08 + 0.12 * u, 0.06 + 0.17 * u, 0.02 + 0.05 * u), r * s, r * s]); }
  tube(G, tst, pm, 6, { key: 'plain', col, mat, centre: P(0.14, 0.15, 0.04) });
}
// A tube along a path: stations [point, half-width, half-depth], its width laid along `side` made
// square to the path at each one. Rows along it, `cols` round it.
function tube(G, st, side, cols, opt) {
  emitGrid(G, st.length, cols, (i, j) => {
    const c = st[i][0], t = norm(sub(st[Math.min(i + 1, st.length - 1)][0], st[Math.max(i - 1, 0)][0]));
    let x = sub(side, mul(t, dot(side, t)));
    x = len(x) < 1e-5 ? norm(cross(t, Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])) : norm(x);
    const z = cross(t, x), a = j / cols * TAU;
    return add(c, add(mul(x, Math.sin(a) * st[i][1]), mul(z, Math.cos(a) * st[i][2])));
  }, opt);
}
// A glove on hand S, in the hand's frame as an open hand's: x toward the thumb, y to the
// fingertips, z out of the palm (the pocket's side). A fielder's: the body over the palm and the
// back of the hand, four long finger stalls fanned a little and curled toward the pocket, laced
// across their tips, the thumb's stall off the side, the web laced between it and the first
// finger, and the strap at the wrist. A catcher's mitt: a round, thick pillow with a deep pocket
// and a laced rim.
function glove(G, J, S, s, kind) {
  const hd = J['hdir' + S], pm = J['palm' + S], sd = norm(cross(pm, hd)), th = S === 'L' ? -1 : 1, wr = J['wr' + S];
  const P = (x, y, z) => add(wr, add(mul(sd, th * x * s), add(mul(hd, y * s), mul(pm, z * s))));
  const catcher = kind === 'catcher', leather = catcher ? hex('#5a3820') : hex('#8a5a2e'), lace = mul(leather, 0.42), dark = mul(leather, 0.62);
  if (catcher) {
    // the pillow, its palm side dished into the pocket
    ellipsoid(G, 'leather', P(0, 0.27, 0.02), [sd, hd, pm], [0.3 * s, 0.3 * s, 0.13 * s], 14, 22, leather, MAT.LEATHER,
      { deform: (l) => { if (l[2] > 0) { const q = 1 - Math.min(1, (l[0] * l[0] + l[1] * l[1]) / (0.09 * s * s)); l[2] = l[2] * 0.42 - 0.07 * s * q; } return l; } });
    // the rim round the pocket, laced
    const rim = [];
    for (let k = 0; k <= 24; k++) { const a = k / 24 * TAU; rim.push([P(Math.sin(a) * 0.255, 0.27 + Math.cos(a) * 0.255, 0.05), 0.05 * s, 0.045 * s]); }
    tube(G, rim, pm, 8, { key: 'plain', col: (ii) => (ii % 2 ? lace : dark), mat: MAT.LEATHER, centre: P(0, 0.27, 0.05) });
    // the thumb's bulge and the strap
    ellipsoid(G, 'leather', P(0.2, 0.16, 0.0), [sd, hd, pm], [0.09 * s, 0.14 * s, 0.09 * s], 8, 12, leather, MAT.LEATHER);
    tube(G, [[P(0, 0.02, -0.02), 0.11 * s, 0.07 * s], [P(0, 0.07, -0.02), 0.115 * s, 0.075 * s]], sd, 12, { key: 'plain', col: lace, mat: MAT.LEATHER, centre: P(0, 0.045, -0.02) });
    return;
  }
  // the body: the palm's pad on its side, the back of the hand on the other
  ellipsoid(G, 'leather', P(0.01, 0.2, 0.0), [sd, hd, pm], [0.19 * s, 0.2 * s, 0.075 * s], 11, 18, leather, MAT.LEATHER,
    { deform: (l) => { if (l[2] > 0) l[2] *= 0.6; return l; } });
  // the finger stalls, the first next to the thumb, laced across their tips
  const ROOTS = [[0.105, 0.6], [0.035, 0.58], [-0.035, 0.53], [-0.105, 0.44]];
  ROOTS.forEach(([x, L], f) => {
    const st = [];
    for (let k = 0; k <= 6; k++) {
      const u = k / 6, end = k === 6 ? 0.4 : k === 5 ? 0.8 : 1;
      st.push([P(x * (1 + 0.28 * u), 0.3 + L * u, 0.075 * u * u), 0.044 * end * s, 0.04 * end * s]);
    }
    tube(G, st, sd, 8, { key: 'leather', col: (ii) => (ii >= 5 ? lace : f % 2 ? mul(leather, 0.93) : leather), mat: MAT.LEATHER, centre: P(x, 0.3 + L / 2, 0.02) });
  });
  // the thumb's stall, out from the heel of the palm toward the first finger's tip
  const tst = [];
  for (let k = 0; k <= 6; k++) { const u = k / 6, end = k === 6 ? 0.4 : k === 5 ? 0.8 : 1; tst.push([P(0.15 + 0.2 * u, 0.1 + 0.42 * u, 0.02 + 0.06 * u * u), 0.05 * end * s, 0.046 * end * s]); }
  tube(G, tst, pm, 8, { key: 'leather', col: (ii) => (ii >= 5 ? lace : leather), mat: MAT.LEATHER, centre: P(0.25, 0.3, 0.03) });
  // the web, laced in a basket between the thumb and the first finger, bowed out behind the pocket
  emitGrid(G, 6, 5, (i, j) => {
    const v = i / 5, u = j / 4, y = 0.36 + 0.46 * v, xi = 0.12 * (1 + 0.28 * (y - 0.3) / 0.6), xt = 0.15 + 0.2 * Math.min(1, (y - 0.1) / 0.42);
    return P(xi + (xt - xi) * u, y, 0.045 - 0.035 * Math.sin(u * Math.PI));
  }, { key: 'plain', col: (ii, jj) => ((ii + jj) % 2 ? lace : dark), mat: MAT.LEATHER, wrap: false, centre: P(0.18, 0.6, 0.2) });
  // the strap at the wrist
  tube(G, [[P(0, -0.01, -0.03), 0.12 * s, 0.075 * s], [P(0, 0.05, -0.03), 0.125 * s, 0.078 * s]], sd, 12, { key: 'plain', col: dark, mat: MAT.LEATHER, centre: P(0, 0.02, -0.03) });
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
  const L = FACE_LAYOUTS.map((q, i) => [q, i]).filter(([q]) => !q.makeup && (look.role === 'ump' || look.role === 'crew' || q.age <= 0.7));
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
function cap(G, W, s, look, col, under, cell, billTop = col) {
  const F = headFrame(W, look);
  skullShell(G, F, capBand, 0.011, { col, mat: MAT.CLOTH });
  ellipsoid(G, 'plain', toHead(F, [0, 1.7505 + 0.0125, SKULL_ZC]), [W.head[0], W.head[1], W.head[2]], [0.03 * s, 0.018 * s, 0.03 * s], 5, 8, col, MAT.CLOTH);
  bill(G, F, capBand, 0.011, 0.074, 1.25, BILL_DROP.cap, billTop, under, MAT.CLOTH);
  if (cell != null) logoOn(G, F, capBand, 0.011, -0.42, 0.42, capBand(0) + 0.004, capBand(0) + 0.044, cell, MAT.CLOTH);
}
// The batting helmet: the shell comes down over the ear facing the pitcher and stops above the
// other one, the flap standing off the ear it covers.
function helmet(G, W, s, look, flapSide, col, cell) {
  const F = headFrame(W, look), ear = earFall, band = helmetBand(flapSide);
  const t = (a, y) => 0.021 + (Math.sin(a) * flapSide > 0 ? 0.009 * ear(a) * Math.exp(-(((y - 1.615) / 0.045) ** 2)) : 0);
  skullShell(G, F, band, t, { col, mat: MAT.GLOSS, rows: 14, cols: 40 });
  skullShell(G, F, band, (a, y) => t(a, y) - 0.005, { col: hex('#141414'), mat: MAT.CLOTH, rows: 14, cols: 40 });
  bill(G, F, band, 0.022, 0.036, 0.62, BILL_DROP.helmet, col, mul(col, 0.6), MAT.GLOSS);
  if (cell != null) logoOn(G, F, band, 0.022, flapSide * 1.15, flapSide * 1.75, 1.665, 1.715, cell, MAT.GLOSS, flapSide > 0);
  // the vents over the crown, and the hole in the flap over the ear
  const hole = hex('#0b0b0c');
  for (const [a, y] of [[0.42, 1.742], [-0.42, 1.742], [Math.PI, 1.728]]) spotOn(G, F, a, y, 0.1, 0.006, 0.0225, hole);
  spotOn(G, F, flapSide * 1.62, 1.6, 0.13, 0.012, t(flapSide * 1.62, 1.6) + 0.0015, hole);
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
// The catcher's shin guards down the front of each leg, hip-relative as a leg's profile: a cap over
// the knee, then plates down the shin with a groove ('v') between each.
const SHIN_GUARD = [[1.32, 0.24, 0.265, 'g'], [1.45, 0.272, 0.295, 'g'], [1.58, 0.275, 0.298, 'g'], [1.7, 0.25, 0.27, 'g'], [1.74, 0.232, 0.25, 'v'],
  [1.78, 0.243, 0.262, 'g'], [2.08, 0.222, 0.24, 'g'], [2.11, 0.206, 0.222, 'v'], [2.14, 0.218, 0.235, 'g'], [2.48, 0.196, 0.212, 'g'],
  [2.51, 0.18, 0.195, 'v'], [2.54, 0.19, 0.205, 'g'], [2.88, 0.172, 0.186, 'g'], [3.06, 0.162, 0.175, 'g']];
// A foot's frame as its shoe stands: `at` under the ankle on the sole's bottom, Fs along the sole,
// Us up off it, Sd to the player's left (shoe has it).
function footFrame(J, S, s) {
  const an = J['an' + S], F = norm(sub(J['toe' + S], an)), side0 = norm(cross(norm(sub(J['kn' + S], an)), F)), U = norm(cross(F, side0));
  const Fs = norm(add(mul(F, Math.cos(FOOT_PITCH)), mul(U, Math.sin(FOOT_PITCH)))), Us = norm(sub(mul(U, Math.cos(FOOT_PITCH)), mul(F, Math.sin(FOOT_PITCH))));
  return { at: madd(an, Us, -0.28 * s), Fs, Us, Sd: norm(cross(Us, Fs)) };
}
// The catcher: a hard skull cap worn back to front, the mask and the throat guard hanging under
// it, a chest protector of padded panels from the belt to the collarbones with a cap over each
// shoulder, and shin guards over the knees and down to flaps over the laces.
function catcherGear(G, J, W, s, look, col) {
  const F = headFrame(W, look), cur = G.cur;
  skullShell(G, F, (a) => 1.672 - 0.05 * (1 - Math.cos(a)) / 2, 0.02, { col, mat: MAT.GLOSS });
  mask(G, W, s, look);
  // the throat guard: a black plate hanging from the mask's chin, in front of the neck
  emitGrid(G, 3, 7, (i, j) => { const a = (j / 6 - 0.5) * 1.3, y = 1.505 - 0.05 * i / 2; return toHead(F, [Math.sin(a) * 0.05, y, SKULL_ZC + 0.07 + Math.cos(a) * 0.035 - 0.012 * i]); },
    { key: 'plain', col: hex('#141414'), mat: MAT.GLOSS, wrap: false, centre: F.c });
  const groove = mul(col, 0.45);
  for (const S of ['L', 'R']) {
    limb(G, J['hip' + S], J['kn' + S], J['an' + S], m3v(W.pelvis, [0, 0, 1]), SHIN_GUARD, s,
      () => 'plain', (p) => (p === 'v' ? groove : col), () => MAT.GLOSS, () => [0, 0], LEG_RIG[S]);
    // the flap over the laces
    const f = footFrame(J, S, s);
    G.cur = [[BONE['foot' + S], 1]];
    ellipsoid(G, 'plain', add(f.at, add(mul(f.Fs, 0.2 * s), mul(f.Us, 0.2 * s))), [f.Sd, f.Fs, f.Us], [0.13 * s, 0.17 * s, 0.05 * s], 6, 12, col, MAT.GLOSS,
      { deform: (l) => { if (l[2] < 0) l[2] *= 0.3; return l; } });
  }
  // the chest protector, its panels standing proud between the seams
  const pad = hex('#1a2b52'), seam = mul(pad, 0.5), rows = TORSO.slice(5, 14);
  const pts = rows.map(([f, y, w, df]) => ({ c: add(J[f], m3v(W[f], [0, y * s, 0])), X: W[f][0], Z: W[f][2], w: (w + 0.045) * s, d: (df + 0.085) * s }));
  emitGrid(G, pts.length, 15, (i, j) => {
    const r = pts[i], a = (j / 14 - 0.5) * 190 * DEG, sunk = j % 3 === 0 || i % 2 === 1 ? 0.975 : 1;
    return add(r.c, add(mul(r.X, Math.sin(a) * r.w), mul(r.Z, Math.pow(Math.max(0, Math.cos(a)), 0.7) * r.d * sunk)));
  }, { key: 'plain', col: (ii, jj) => (jj % 3 === 0 || ii % 2 === 1 ? seam : pad), mat: MAT.CLOTH, wrap: false, centre: J.chest, wts: (ii) => [[FRAME_BONE[rows[Math.min(ii, pts.length - 1)][0]], 1]] });
  // a padded cap over each shoulder, on its collarbone, over the top of the deltoid
  for (const [S, sg] of [['L', 1], ['R', -1]]) {
    const C = W['clav' + S] || W.chest;
    G.cur = [[BONE['clav' + S], 1]];
    ellipsoid(G, 'plain', add(J['sh' + S], m3v(C, [-sg * 0.01 * s, 0.05 * s, 0.01 * s])), C, [0.235 * s, 0.135 * s, 0.245 * s], 7, 14, pad, MAT.CLOTH, { vmax: 0.6 });
  }
  G.cur = cur;
}
// A spot on headwear's shell, dark, a little proud of it: a vent, or the ear's hole in a helmet's flap.
function spotOn(G, F, a0, y0, ra, ry, t, col) {
  emitGrid(G, 2, 10, (i, j) => { const ph = j / 10 * TAU; return toHead(F, skullOut(y0 + ry * Math.sin(ph) * i, a0 + ra * Math.cos(ph) * i, t)); },
    { key: 'plain', col, mat: MAT.MATTE, centre: F.c });
}
// The plate umpire's ball bags, one on each hip.
function ballBags(G, J, W, s, col) {
  const cur = G.cur;
  G.cur = [[BONE.pelvis, 1]];
  for (const sg of [1, -1]) {
    ellipsoid(G, 'plain', add(J.pelvis, m3v(W.pelvis, [sg * 0.52 * s, 0.03 * s, 0.16 * s])), W.pelvis, [0.12 * s, 0.15 * s, 0.13 * s], 7, 10, col, MAT.CLOTH);
    ellipsoid(G, 'plain', add(J.pelvis, m3v(W.pelvis, [sg * 0.53 * s, 0.15 * s, 0.17 * s])), W.pelvis, [0.125 * s, 0.035 * s, 0.135 * s], 5, 10, mul(col, 0.7), MAT.CLOTH);
  }
  G.cur = cur;
}
// The belt's buckle in front and its loops round it, on the belt rings (TORSO's pelvis +0.22 and +0.30).
function beltDress(G, J, W, s, extra, col) {
  const cur = G.cur, w = (0.5725 + extra) * s, d = (0.3825 + extra) * s, y = 0.26 * s, pw = 2.5, sp = (x) => Math.sign(x) * Math.pow(Math.abs(x), 2 / pw);
  G.cur = [[BONE.pelvis, 1]];
  const on = (a, out) => add(J.pelvis, m3v(W.pelvis, [sp(Math.sin(a)) * (w + out), y, sp(Math.cos(a)) * (d + out)]));
  ellipsoid(G, 'plain', on(0, 0.012 * s), W.pelvis, [0.075 * s, 0.05 * s, 0.014 * s], 5, 10, hex('#b9b3a3'), MAT.METAL);
  for (const a of [-2.4, -1.35, -0.62, 0.62, 1.35, 2.4]) {
    const n = norm(sub(on(a, 0.01 * s), on(a, 0)));
    ellipsoid(G, 'plain', on(a, 0.006 * s), [norm(cross(W.pelvis[1], n)), W.pelvis[1], n], [0.016 * s, 0.062 * s, 0.009 * s], 4, 6, mul(col, 0.75), MAT.LEATHER);
  }
  G.cur = cur;
}
// The jersey's neckline piped in the trim, round the torso's top ring of jersey (chest +0.61).
function collar(G, J, W, s, col, extra) {
  const [, y, w0, df0, db0] = TORSO[14], cur = G.cur, pw = 2.5, sp = (x) => Math.sign(x) * Math.pow(Math.abs(x), 2 / pw), st = [];
  G.cur = [[BONE.chest, 1]];
  for (let k = 0; k <= 18; k++) {
    const a = k / 18 * TAU, ca = Math.cos(a), w = (w0 + extra) * s + 0.004, d = ((ca > 0 ? df0 : db0) + extra) * s + 0.004;
    st.push([add(J.chest, m3v(W.chest, [sp(Math.sin(a)) * w, y * s + 0.01 * s, sp(ca) * d])), 0.016 * s, 0.016 * s]);
  }
  tube(G, st, W.chest[1], 4, { key: 'plain', col, mat: MAT.CLOTH, centre: add(J.chest, m3v(W.chest, [0, y * s, 0])) });
  G.cur = cur;
}
// A band round the forearm at the wrist, and a hitter's guard over the elbow he leads with.
function wristband(G, J, S, s, col) {
  const cur = G.cur, el = J['el' + S], d = norm(sub(J['wr' + S], el)), L = len(sub(J['wr' + S], el)), side = norm(cross(d, J['epole' + S] || [0, 1, 0]));
  G.cur = [[BONE['forearm' + S], 1]];
  tube(G, [0.66, 0.73, 0.8].map((u, i) => [madd(el, d, L * u), (i === 1 ? 0.122 : 0.116) * s, (i === 1 ? 0.106 : 0.1) * s]), side, 12,
    { key: 'plain', col, mat: MAT.CLOTH, centre: madd(el, d, L * 0.73) });
  G.cur = cur;
}
// A batting glove's cuff round the wrist, over the end of the sleeve, its strap darker, closed over
// the wrist so that looking down the forearm shows glove and not the sleeve inside it.
function gloveCuff(G, J, S, s, col) {
  const cur = G.cur, el = J['el' + S], d = norm(sub(J['wr' + S], el)), L = len(sub(J['wr' + S], el)), side = norm(cross(d, J['epole' + S] || [0, 1, 0]));
  G.cur = [[BONE['forearm' + S], 1]];
  tube(G, [[0.85, 0.104, 0.088], [0.89, 0.112, 0.095], [0.94, 0.11, 0.094], [1.0, 0.104, 0.09], [1.05, 0.088, 0.077], [1.09, 0.055, 0.048], [1.11, 0, 0]].map(([u, a, b]) => [madd(el, d, L * u), a * s, b * s]), side, 12,
    { key: 'plain', col: (ii) => (ii === 1 || ii === 2 ? mul(col, 0.6) : col), mat: MAT.LEATHER, centre: madd(el, d, L * 0.95) });
  G.cur = cur;
}
function elbowGuard(G, J, S, s, col) {
  const cur = G.cur, el = J['el' + S], pole = J['epole' + S] || [0, -1, 0], up = norm(sub(J['sh' + S], el)), fo = norm(sub(J['wr' + S], el));
  const along = norm(sub(up, fo)), across = norm(cross(pole, along));
  G.cur = [[BONE['upperArm' + S], 0.5], [BONE['forearm' + S], 0.5]];
  ellipsoid(G, 'plain', madd(el, pole, 0.08 * s), [across, along, pole], [0.15 * s, 0.21 * s, 0.1 * s], 8, 12, col, MAT.GLOSS);
  G.cur = cur;
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
  // what he wears that's his own, off a draw of its own so the looks above don't move: a band on
  // one wrist or both, and a hitter's guard over the elbow he leads with (his helmet's flap side)
  if (o.role !== 'ump' && o.role !== 'crew') {
    const g = rng(hashStr('gear:' + o.id)), w = g(), lead = (o.flapSide ?? 1) > 0 ? 'L' : 'R';
    L.wristbands = w < 0.4 ? null : w < 0.7 ? 'both' : w < 0.85 ? 'L' : 'R';
    L.elbowGuard = o.helmet && g() < 0.35 ? lead : null;
  }
  return Object.assign(L, o);
}

// Those who don't wear a club's kit: the umpires in navy and grey, and the grounds crew in green
// work shirts and khaki (diamond/crew.js). Plain colours, slacks, a plain cap.
const PLAIN = Object.freeze({
  ump: Object.freeze({ shirt: '#1d2740', pants: '#7d8186', belt: '#111111', cap: '#111317', capUnder: '#0a0a0c', shoe: '#0e0e0e', girth: 0.07 }),
  crew: Object.freeze({ shirt: '#2e4a35', pants: '#a39169', belt: '#3a2a1a', cap: '#2e4a35', capUnder: '#1b2b20', shoe: '#2a2018', girth: 0.04 }),
});

// Builds one player into `G`'s batches. `pose` is a pose table entry with `at` and `yaw`; `look`
// says who he is: { id, side ('home' | 'away'), role ('ump', 'crew', 'catcher', 'pitcher'...), slot
// (his jersey's cell in the kit atlas), glove ('L' | 'R'), helmet, flapSide, mask, battingGloves,
// kit (sideKit's; the house kit for his side when it's missing) }.
export function buildPlayer(G, pose, look) {
  const { J, W, s } = solvePose(pose);
  const plain = PLAIN[look.role] || null, ump = !!plain, side = look.side === 'away' ? 'away' : 'home', kit = look.kit || KITS[side];
  const navyU = hex(plain ? plain.shirt : '#1d2740'), greyU = hex(plain ? plain.pants : '#7d8186');
  const under = ump ? navyU : hex(kit.ink), trim = ump ? navyU : hex(kit.trim), skin = hex(look.skin);
  const jersey = G.skin ? KIT_REL : kitCell(look.slot ?? 0), pants = KIT_PANTS[side], socks = KIT_SOCKS[side];
  const keyOf = (p) => (ump ? 'plain' : (p === 'jersey' || p === 'sleeve' || p === 'pants' || p === 'sock') ? 'kit' : 'plain');
  const colOf = (p) => ump ? (p === 'pants' ? greyU : p === 'skin' ? skin : p === 'belt' ? hex(plain.belt) : navyU)
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
    deltoid(G, J, W, S, s, keyOf, colOf, matOf, uvOf);
    G.cur = [[BONE['foot' + S], 1]];
    shoe(G, J, S, s, ump ? hex(plain.shoe) : hex('#151515'), !ump);
  }
  torso(G, J, W, s, keyOf, colOf, matOf, uvOf, look.girth || 0, ump ? plain.girth : 0);
  beltDress(G, J, W, s, look.girth || 0, ump ? hex(plain.belt) : hex(kit.belt));
  if (!ump) collar(G, J, W, s, trim, look.girth || 0);
  // his own: a band at the wrist, a guard over the elbow he leads with
  const band = hex(kit.ink);
  for (const S of ['L', 'R']) if (!ump && (look.wristbands === 'both' || look.wristbands === S)) wristband(G, J, S, s, band);
  if (!ump && look.elbowGuard) elbowGuard(G, J, look.elbowGuard, s, hex(kit.helmet));
  if (!ump && look.battingGloves) for (const S of ['L', 'R']) gloveCuff(G, J, S, s, hex(look.battingGloves));
  if (look.role === 'ump' && look.mask) ballBags(G, J, W, s, mul(navyU, 0.9));
  head(G, J, W, s, look);
  look.s = s;
  const logo = side === 'home' ? 0 : 1;
  G.cur = [[BONE.head, 1]];
  if (look.role === 'catcher') catcherGear(G, J, W, s, look, hex(kit.helmet));
  else if (ump) { cap(G, W, s, look, hex(plain.cap), hex(plain.capUnder), null); if (look.mask) mask(G, W, s, look); }
  else if (look.helmet) helmet(G, W, s, look, look.flapSide || 1, hex(kit.helmet), logo);
  else cap(G, W, s, look, hex(kit.cap), hex(kit.under), logo, hex(kit.bill || kit.cap));
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
