// PAVEMENT PEOPLE AS A SKINNED MESH, THEIR CLIPS BAKED INTO TEXTURES.
//
// The figure `drawActorFigure` draws on the pavement is a head on a body, which is right at a few
// pixels and reads as a placeholder once somebody is close. This module is the close-up figure: one
// skinned body (coat, trousers, shoes, hands, a face) on a 19-bone skeleton, three looping clips
// (walk, idle, wave), and a bake that skins every vertex for every frame once and returns the result
// as texture data. gl/actors.js draws it the way gl/fauna.js draws the birds: two rows of the pose
// texture picked by gl_VertexID and blended, one instanced draw for everybody.
//
// No DOM, no GL. Everything here is a pure function of its constants, so the gate
// (scripts/shapes/actors.mjs) runs it in Node and so does the Modelshop.
//
// Units are metres, Y up, the figure facing +Z with its left hand on +X. gl/actors.js maps that onto
// GLASS's ground-plane tiles; windshield.js decides how many tiles a metre is (see actorMetreTiles).

import { actorFace, faceHair, faceLip, FACE_LAYOUTS } from './actor-faces.js';
import { buildFigure, figureCut, figureSole, FIGURE_BONES, FIGURE_BONE, FIGURE_CUTS, FIG_SLOT } from './figure.js';
import { simplifyMesh } from './mesh-simplify.js';
import { gaitClips } from './actor-gait.js';
import { planter } from './actor-plant.js';
import { moodClips, MOOD_ACTS, MOOD_IDLES } from './actor-moods.js';

// ── Matrices: column-major 4×4, element (row r, col c) at m[c * 4 + r] ─────────────────────────────
function m4() { const m = new Float64Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; }
const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };

// ── The skeleton (figure.js FIGURE_BONES). Every rest rotation is identity, so a bind matrix is a
// translation. ──────────────────────────────────────────────────────────────────────────────────────
const BONES = FIGURE_BONES;
const B = {};
BONES.forEach((b, i) => { B[b[0]] = i; });
const REST = [];
BONES.forEach(([, p, o], i) => { REST[i] = p < 0 ? o.slice() : [REST[p][0] + o[0], REST[p][1] + o[1], REST[p][2] + o[2]]; });

function newPose() { return { r: new Float64Array(BONES.length * 3), root: [0, 0, 0] }; }
// Rotations add, so a clip can lay an overlay on a base pose.
function setR(P, bone, x, y, z) { const i = B[bone] * 3; P.r[i] += x; P.r[i + 1] += y; P.r[i + 2] += z; }
function zeroR(P, bone) { const i = B[bone] * 3; P.r[i] = P.r[i + 1] = P.r[i + 2] = 0; }

// Local rotation is Rz·Rx·Ry: flexion about X, abduction about Z, twist about Y.
// ⚠ NO NEW MATRICES BUT THE ONES IT RETURNS. fk runs for every close-up person every frame (gl/room-people.js
// figurePeople, in a room and on the street), and a walk runs it twice. Built from mul/rotX/trans it made eleven
// Float64Arrays a bone, and those allocations were two-thirds of the posing. The scratch versions below do the same
// sums in the same order, so the matrices come out bit for bit as before (the bake included).
const _rx = m4(), _ry = m4(), _rz = m4(), _t = m4(), _xy = m4(), _r = m4(), _pt = m4();
function mulTo(o, a, b) {
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}
function transTo(m, x, y, z) { m.fill(0); m[0] = m[5] = m[10] = m[15] = 1; m[12] = x; m[13] = y; m[14] = z; return m; }
function fk(P) {
  const W = new Array(BONES.length);
  for (let i = 0; i < BONES.length; i++) {
    const [, p, o] = BONES[i];
    let c = Math.cos(P.r[i * 3]), s = Math.sin(P.r[i * 3]);
    _rx[5] = c; _rx[6] = s; _rx[9] = -s; _rx[10] = c;
    c = Math.cos(P.r[i * 3 + 1]); s = Math.sin(P.r[i * 3 + 1]);
    _ry[0] = c; _ry[2] = -s; _ry[8] = s; _ry[10] = c;
    c = Math.cos(P.r[i * 3 + 2]); s = Math.sin(P.r[i * 3 + 2]);
    _rz[0] = c; _rz[1] = s; _rz[4] = -s; _rz[5] = c;
    const R = mulTo(_r, _rz, mulTo(_xy, _rx, _ry));
    const T = p < 0 ? transTo(_pt, o[0] + P.root[0], o[1] + P.root[1], o[2] + P.root[2]) : mulTo(_pt, W[p], transTo(_t, o[0], o[1], o[2]));
    W[i] = mulTo(new Float64Array(16), T, R);
  }
  return W;
}
const skinMats = (W) => W.map((w, i) => mulTo(new Float64Array(16), w, transTo(_t, -REST[i][0], -REST[i][1], -REST[i][2])));
// Feet on the floor (actor-plant.js): a standing clip says where the feet are and the legs are solved to them, so
// the hips can sway, turn and dip over feet that stay put.
const { plant, aimFoot, ankleAt } = planter({ fk, B, BONES, REST, setR, zeroR, DEG });

// ── The mesh ───────────────────────────────────────────────────────────────────────────────────────
// Each vertex carries two bones and the weight of the first, plus a material slot the shader colours
// from the instance's outfit: 0 skin, 1 coat, 2 trousers, 3 shoes, 4 hair, 5 eyes, 6 lips.
export const ACTOR_MAT = { skin: 0, coat: 1, legs: 2, shoes: 3, hair: 4, eyes: 5, lips: 6 };
const { skin: SKIN, coat: COAT, legs: LEGS, shoes: SHOE, hair: HAIR, eyes: EYE, lips: LIP } = ACTOR_MAT;

function meshBuilder() {
  const M = { p: [], b0: [], b1: [], w: [], m: [], i: [] };
  M.vert = (x, y, z, wf, mat) => {
    const [b0, b1, w] = wf(x, y, z);
    M.p.push(x, y, z); M.b0.push(b0); M.b1.push(b1); M.w.push(w); M.m.push(mat);
    return M.p.length / 3 - 1;
  };
  return M;
}
const rigid = (b) => () => [b, b, 1];
// Joints listed top to bottom: a vertex within ±h of a joint blends the bone above into the one below.
function chainW(joints) {
  return (x, y) => {
    for (const j of joints) {
      if (y >= j.y + j.h) return [j.a, j.a, 1];
      if (y > j.y - j.h) return [j.a, j.b, smooth(j.y - j.h, j.y + j.h, y)];
    }
    const last = joints[joints.length - 1];
    return [last.b, last.b, 1];
  };
}
// Rings run top to bottom with x = cos φ and z = sin φ, so (upper k, upper k+1, lower k) winds outward.
function stitch(M, rings) {
  for (let j = 0; j < rings.length - 1; j++) {
    const u = rings[j], l = rings[j + 1], n = u.length;
    for (let k = 0; k < n; k++) { const k1 = (k + 1) % n; M.i.push(u[k], u[k1], l[k], u[k1], l[k1], l[k]); }
  }
}
function ellipsoid(M, c, r, nu, nv, wf, mat, shape) {
  const V = (x, y, z) => { if (shape) [x, y, z] = shape(x, y, z); return M.vert(x, y, z, wf, mat); };
  const top = V(c[0], c[1] + r[1], c[2]);
  const rings = [];
  for (let j = 1; j < nv; j++) {
    const th = j * Math.PI / nv, st = Math.sin(th), ct = Math.cos(th), ring = [];
    for (let k = 0; k < nu; k++) {
      const ph = k * TAU / nu;
      ring.push(V(c[0] + r[0] * st * Math.cos(ph), c[1] + r[1] * ct, c[2] + r[2] * st * Math.sin(ph)));
    }
    rings.push(ring);
  }
  const bot = V(c[0], c[1] - r[1], c[2]);
  const f = rings[0], L = rings[rings.length - 1];
  for (let k = 0; k < nu; k++) M.i.push(top, f[(k + 1) % nu], f[k]);
  stitch(M, rings);
  for (let k = 0; k < nu; k++) M.i.push(L[k], L[(k + 1) % nu], bot);
}
// A vertical loft through stations [y, rx, rz, cx, cz], top to bottom, with `sub` rings between each.
// `shape` moves each point before it's weighted; `cap` is a point that closes the top ring.
function loft(M, st, nu, sub, wf, mat, shape, cap) {
  const S = [];
  for (let i = 0; i < st.length - 1; i++) {
    for (let s = 0; s <= sub; s++) { const t = s / (sub + 1); S.push(st[i].map((v, j) => v + (st[i + 1][j] - v) * t)); }
  }
  S.push(st[st.length - 1]);
  const V = (x, y, z) => { if (shape) [x, y, z] = shape(x, y, z); return M.vert(x, y, z, wf, mat); };
  const rings = S.map(([y, rx, rz, cx, cz]) => {
    const ring = [];
    for (let k = 0; k < nu; k++) { const ph = k * TAU / nu; ring.push(V(cx + rx * Math.cos(ph), y, cz + rz * Math.sin(ph))); }
    return ring;
  });
  if (cap) { const c = V(...cap), f = rings[0]; for (let k = 0; k < nu; k++) M.i.push(c, f[(k + 1) % nu], f[k]); }
  stitch(M, rings);
}

// `lod` 0 is the close-up body. 1 is the far one, for somebody a few pixels tall. Both are the
// close-up figure's coat, trousers, shoes and hands (figure.js), sampled coarsely: the crowd wears
// what the Room Stage's people wear, just without the detail, and the far body is the same again
// with six sides to a loft and lumps for hands. Each keeps the skeleton, two bones a vertex and
// the material slots, so it plays the same clips in the same outfit.
//
// `head` false leaves out the neck, the head and everything on it, which is the close-up body the
// game bakes: gl/actors.js draws actor-head.js's head in their place, riding bk.bones. The far body
// always keeps its own, and so does actorBake({ head: true }), which the Actor Lab and the gate use.
const SLOT_MAT = { [FIG_SLOT.skin]: SKIN, [FIG_SLOT.top]: COAT, [FIG_SLOT.collar]: COAT, [FIG_SLOT.legs]: LEGS, [FIG_SLOT.shoes]: SHOE, [FIG_SLOT.gear]: SHOE };

// ── The street cut down from the close-up figure ───────────────────────────────────────────────────
// With ACTOR_BAKE.hd on, the street's bodies aren't sampled coarsely: each is the sculpted close-up
// figure (`hd`, about 21,000 triangles) cut down to the crowd's or the far body's budget by
// mesh-simplify.js, which keeps only the figure's own vertices. So the bones, the materials and the
// four body-type offsets come across by index, and the street wears the shapes the rooms do.
//
// There's a bake for each silhouette rather than one coat for everybody: a person's cut (figure.js
// FIGURE_CUTS, off the street token) picks the silhouette nearest it by its hem and its sleeve
// (actorSilhouette). Each is about 8 MB of pose textures, so four, not one a cut.
//
// The head stays actor-head.js's, riding the head bone as before: the figure's own head, neck, hair and
// eyes are left out (HD_DROP), and the old head goes on where the lab and the gate ask for one.
//
// On since 2026-11-08, ahead of the rooms' sculpted figure (sculpted-figure.md stage 6). False goes back
// to the coarse coat for everybody. Flip it before the bake starts, or call actorBakeReset after.
export const ACTOR_BAKE = { hd: true };
export const ACTOR_SILHOUETTES = [
  { name: 'coat', cut: 'coat' },
  { name: 'jacket', cut: 'jacket' },
  { name: 'tee', cut: 'tee' },
  { name: 'long', cut: 'trench' },
];
// The silhouette a cut reads as from a street away: to the ankle, to the thigh or knee, or to the
// waist with long sleeves or bare arms. 0 whenever the street is on the one coat.
export function actorSilhouette(cut) {
  if (!ACTOR_BAKE.hd) return 0;
  const c = FIGURE_CUTS[cut];
  if (!c) return 0;
  const hem = c.top?.hem ?? 0.9, cuff = c.sleeve?.cuff;
  if (hem < 0.45) return 3;
  if (hem < 0.8) return 0;
  return cuff == null || cuff > 1 ? 2 : 1;
}
const HD_DROP = new Set([FIG_SLOT.hair, FIG_SLOT.face, FIG_SLOT.ear, FIG_SLOT.neck, FIG_SLOT.card, FIG_SLOT.eye, FIG_SLOT.lid]);
// Triangles for the crowd's body and the far one: what the coarse levels had.
const HD_TRIS = [3600, 430];
const _hdBodies = new Map();
function hdBody(lod, sil, tris = HD_TRIS[lod ? 1 : 0]) {
  const key = `${lod}:${sil}:${tris}`;
  if (_hdBodies.has(key)) return _hdBodies.get(key);
  const cut = (ACTOR_SILHOUETTES[sil] || ACTOR_SILHOUETTES[0]).cut;
  const at = (weight = null, build = 'average') => buildFigure({ cut, level: 'hd', sculpt: true, weight, build });
  const F = at();
  const keep = [];
  for (let t = 0; t < F.I.length; t += 3) {
    const a = F.I[t], b = F.I[t + 1], c = F.I[t + 2];
    if (!HD_DROP.has(F.S[a]) && !HD_DROP.has(F.S[b]) && !HD_DROP.has(F.S[c])) keep.push(a, b, c);
  }
  const cls = Uint8Array.from(F.S, (s) => SLOT_MAT[s] ?? COAT);
  const skin = (v) => { const o = []; for (let k = 0; k < 4; k++) if (F.W[v * 4 + k] > 0) o.push([F.B[v * 4 + k], F.W[v * 4 + k]]); return o; };
  const { ids, I } = simplifyMesh({ P: F.P, I: keep, cls, skin, target: tris });
  // How far each kept point moves along its normal for the three bodies and a woman's, as buildBody
  // measures the coarse mesh: the close-up figure has the same points at every weight.
  const E = at(0), Me = at(0.5), En = at(1), Wo = at(0.5, 'woman');
  const same = [E, Me, En, Wo].every((G) => G.nv === F.nv);
  const along = (G, v, H = F) => (G.P[v * 3] - H.P[v * 3]) * F.N[v * 3] + (G.P[v * 3 + 1] - H.P[v * 3 + 1]) * F.N[v * 3 + 1] + (G.P[v * 3 + 2] - H.P[v * 3 + 2]) * F.N[v * 3 + 2];
  const out = { p: [], b0: [], b1: [], w: [], m: [], body: [], i: Array.from(I) };
  // the bake has the 19 clip bones only: the close-up figure's collarbones go back on the chest
  const bake = (b) => (b === FIGURE_BONE.clavL || b === FIGURE_BONE.clavR ? FIGURE_BONE.chest : b);
  for (const v of ids) {
    const w0 = F.W[v * 4], w1 = F.W[v * 4 + 1];
    out.p.push(F.P[v * 3], F.P[v * 3 + 1], F.P[v * 3 + 2]);
    out.b0.push(bake(F.B[v * 4])); out.b1.push(bake(w1 > 0 ? F.B[v * 4 + 1] : F.B[v * 4])); out.w.push(w0 / (w0 + w1 || 1));
    out.m.push(cls[v]);
    out.body.push(same ? along(E, v) : 0, same ? along(Me, v) : 0, same ? along(En, v) : 0, same ? along(Wo, v, Me) : 0);
  }
  _hdBodies.set(key, out);
  return out;
}

function buildBody(lod = 0, head = true, sil = 0, tris = undefined) {
  const M = meshBuilder();
  const far = lod > 0;
  const N = far ? 6 : 14, SUB = far ? 0 : 1;
  const ell = (c, r, nu, nv, wf, mat, shape) => ellipsoid(M, c, r, far ? Math.max(4, nu >> 1) : nu, far ? Math.max(3, nv >> 1) : nv, wf, mat, shape);
  if (ACTOR_BAKE.hd || tris) {
    const H = hdBody(lod, sil, tris);
    for (let k = 0; k < H.p.length; k++) M.p.push(H.p[k]);
    for (let k = 0; k < H.w.length; k++) { M.b0.push(H.b0[k]); M.b1.push(H.b1[k]); M.w.push(H.w[k]); M.m.push(H.m[k]); }
    for (let k = 0; k < H.i.length; k++) M.i.push(H.i[k]);
    M.body = H.body.slice();
  } else {
    // the clothes and hands, two bones a vertex: the figure's two heaviest, renormalised
    const F = buildFigure({ cut: 'coat', level: far ? 'far' : 'crowd' });
    for (let v = 0; v < F.nv; v++) {
      const w0 = F.W[v * 4], w1 = F.W[v * 4 + 1], b1 = w1 > 0 ? F.B[v * 4 + 1] : F.B[v * 4];
      M.p.push(F.P[v * 3], F.P[v * 3 + 1], F.P[v * 3 + 2]); M.b0.push(F.B[v * 4]); M.b1.push(b1); M.w.push(w0 / (w0 + w1 || 1)); M.m.push(SLOT_MAT[F.S[v]] ?? COAT);
    }
    for (const i of F.I) M.i.push(i);
    // How far each point moves along its normal to make the three bodies and a woman's, against this one. The mesh
    // is the same at every weight, so a street body is one bake and four numbers a vertex, and any weight is free.
    const lv = far ? 'far' : 'crowd', at = (weight, build = 'average') => buildFigure({ cut: 'coat', level: lv, sculpt: true, weight, build });
    const E = at(0), Me = at(0.5), En = at(1), Wo = at(0.5, 'woman');
    M.body = [];
    const along = (G, v, H = F) => (G.P[v * 3] - H.P[v * 3]) * F.N[v * 3] + (G.P[v * 3 + 1] - H.P[v * 3 + 1]) * F.N[v * 3 + 1] + (G.P[v * 3 + 2] - H.P[v * 3 + 2]) * F.N[v * 3 + 2];
    const same = [E, Me, En, Wo].every((G) => G.nv === F.nv);
    for (let v = 0; v < F.nv; v++) M.body.push(same ? along(E, v) : 0, same ? along(Me, v) : 0, same ? along(En, v) : 0, same ? along(Wo, v, Me) : 0);
  }
  const onHead = rigid(B.head);
  if (head) {
    loft(M, [[1.57, 0.047, 0.05, 0, 0.0], [1.46, 0.052, 0.056, 0, -0.005]], N, SUB,
      chainW([{ y: 1.53, a: B.head, b: B.neck, h: 0.025 }]), SKIN);
    const jaw = (x, y, z) => { const t = clamp01((1.625 - y) / 0.085); return [x * (1 - 0.28 * t), y, z * (1 - 0.1 * t) + 0.01 * t]; };
    ell([0, 1.645, 0.012], [0.077, 0.106, 0.094], 18, 12, onHead, SKIN, jaw);
    if (!far) {
      ellipsoid(M, [0, 1.632, 0.103], [0.013, 0.024, 0.018], 8, 6, onHead, SKIN);
      ellipsoid(M, [0, 1.598, 0.093], [0.02, 0.0045, 0.006], 8, 4, onHead, LIP);
    }
    // The hair is an ellipsoid with everything under the hairline pulled up onto it: high at the
    // brow, low at the nape.
    const hair = (x, y, z) => { const f = 1.64 + 0.6 * Math.max(z, -0.1); return y < f ? [x * 0.93, f, z * 0.93] : [x, y, z]; };
    ell([0, 1.668, 0.0], [0.084, 0.094, 0.1], 18, 10, onHead, HAIR, hair);
  }
  if (head && !far) {
    for (const s of [1, -1]) {
      ellipsoid(M, [0.077 * s, 1.643, 0.0], [0.011, 0.028, 0.018], 8, 5, onHead, SKIN);
      ellipsoid(M, [0.029 * s, 1.66, 0.095], [0.012, 0.0075, 0.006], 8, 5, onHead, EYE);
      ellipsoid(M, [0.03 * s, 1.684, 0.093], [0.02, 0.005, 0.008], 8, 4, onHead, HAIR);
    }
  }
  return M;
}

// ── Clips. Each is a pose as a function of phase 0..1, and each loops. ─────────────────────────────
// A bump on the unit circle, so a curve built from them wraps cleanly at the end of the cycle.
function bump(q, c, w) { let d = q - c; d -= Math.round(d); return Math.exp(-0.5 * (d / w) * (d / w)); }

// The walk: sagittal joint curves shaped after clinical gait data. Right heel strike at 0, left at 0.5.
// The hip flexes about 28° at heel strike and extends 11° at toe-off, peaking in late swing; the knee
// has its small loading bend (16° at 14%) and its big swing bend (about 63° at 72%); the ankle rolls,
// the heel comes up from 40% while the toes bend at the ball and stay down, it pushes off at 62%, then
// clears, lifting 9° through late swing so the shoe's flat sole clears the ground (4° let the ball brush
// it). Each leg turns out a few degrees and lands a little inside the hip, so the feet fall about 12 cm
// apart rather than hip-width. The stride is 1.58 m. Shorter than that, the ankle curve has to be
// retuned with it: at a 26.5° hip the trailing toe and the leading heel swap as the lowest point in
// double support and the root solve skates the foot (scripts/shapes/actors.mjs catches it).
//
// The weight is what sells it. The pelvis drops on the swing side in a sharp dip just after each heel
// strike, when the body lands on the new foot, rather than a smooth sway; the stance hip takes it, so
// the thighs roll back against it and the feet stay under the body. The trunk leans a few degrees into
// the walk and bends over the stance leg, and the head rides level on top of all of it.
//
// Nobody walks symmetrically: the right arm swings a little further than the left, the left elbow
// stays a touch more bent, and the head sits a degree off true. Small enough that it never reads as a
// limp, enough that the walk stops looking like a metronome.
function walkPose(p) {
  const P = newPose();
  const c = Math.cos(TAU * p), s = Math.sin(TAU * p);
  // The drop on the swing side: a dip after each heel strike (right lands at 0, left at 0.5) under a
  // smaller sway, in degrees, positive when the left side is up.
  const list = -2.2 * (bump(p, 0.11, 0.075) - bump(p, 0.61, 0.075)) - 1 * s;
  const leg = (q, s, side) => {
    const hip = 8.5 + 19.5 * Math.cos(TAU * (q - 0.03)) + 2.5 * Math.sin(2 * TAU * q);
    const knee = 3 + 15 * bump(q, 0.14, 0.06) + 62 * bump(q, 0.72, 0.11);
    const ank = -6 * bump(q, 0.05, 0.035) + 11 * bump(q, 0.4, 0.11) - 20 * bump(q, 0.62, 0.055) + 9 * bump(q, 0.82, 0.08);
    setR(P, 'thigh' + s, -hip * DEG, side * 6 * DEG, (-side * 2 - 0.8 * list) * DEG);
    setR(P, 'shin' + s, knee * DEG, 0, 0);
    setR(P, 'foot' + s, -ank * DEG, 0, 0);
  };
  leg(p, 'R', -1); leg((p + 0.5) % 1, 'L', 1);
  // The pelvis turns toward the swinging leg, drops on the swing side and shifts over the stance foot,
  // a little late, because the body lands on the foot before it moves over it.
  setR(P, 'pelvis', 3 * DEG, 4.5 * DEG * c, list * DEG);
  P.root[0] = -0.024 * Math.sin(TAU * (p - 0.04));
  // The trunk leans into the walk, counter-rotates so the shoulders turn against the hips, and bends
  // back over the stance leg against the pelvis's drop; the head holds steady and level.
  setR(P, 'spine', 2.5 * DEG, -4 * DEG * c, (-0.6 * list + 1.5 * s) * DEG);
  setR(P, 'chest', 1.5 * DEG, -4.5 * DEG * c, (-0.3 * list + 0.5 * s) * DEG);
  setR(P, 'neck', -2.5 * DEG, 1.5 * DEG * c, 0.4 * list * DEG);
  setR(P, 'head', -2 * DEG + 1.4 * DEG * Math.cos(2 * TAU * p), 1.5 * DEG * c - 1 * DEG, (-1 + 0.5 * list) * DEG);
  // The arms swing against the legs: the right arm comes forward with the left leg. They hang from
  // the shoulder and lag the legs a little; the forearm lags the upper arm, the hand lags the
  // forearm. Going forward an arm swings in across the body and its elbow bends; going back it
  // swings straight and opens.
  const ca = Math.cos(TAU * (p - 0.05)), ce = Math.cos(TAU * (p - 0.12)), sh = Math.sin(TAU * (p - 0.1));
  const fwdR = Math.max(0, -ca), fwdL = Math.max(0, ca);
  setR(P, 'uarmR', -(3 - 19 * ca) * DEG, (5 + 4 * fwdR) * DEG, -0.10 + 0.05 * fwdR);
  setR(P, 'uarmL', -(4 + 15 * ca) * DEG, (-5 - 4 * fwdL) * DEG, 0.10 - 0.05 * fwdL);
  setR(P, 'farmR', -(12 + 22 * (0.5 - 0.5 * ce)) * DEG, 0, 0);
  setR(P, 'farmL', -(17 + 19 * (0.5 + 0.5 * ce)) * DEG, 0, 0);
  setR(P, 'handR', (-8 - 8 * sh) * DEG, 0, 0);
  setR(P, 'handL', (-9 + 6 * sh) * DEG, 0, 0);
  // The toes. Through late stance the ball of the foot bends by exactly as much as the heel has come
  // up, so the toes lie flat on the ground and stay where they are. Once the other heel is down
  // (double support, from 50%) they let go and the foot rolls off over its tip: with both feet
  // down, flat toes behind can't stay still against the heel in front, and they scrub. After toe-off
  // they come back straight, and they lift a little to meet the ground at heel strike.
  const W = fk(P);
  for (const [s, q] of [['R', p], ['L', (p + 0.5) % 1]]) {
    const m = W[B['foot' + s]];
    const pitch = Math.atan2(m[9], Math.hypot(m[8], m[10]));
    const flat = Math.max(0, -pitch) * smooth(0.26, 0.34, q) * (1 - smooth(0.48, 0.6, q));
    setR(P, 'toe' + s, -(flat + 6 * DEG * bump(q, 0.97, 0.05)), 0, 0);
  }
  return P;
}

// Standing about: weight on the right leg, the left relaxed, breathing, looking up and down the street.
// Both feet are on the floor (plant): the right under the hips, the left a little forward and out with its
// toe turned out, and the left hip dropped, so the left knee bends because the hip has come down over it.
const IDLE_FEET = { R: { x: -0.085, z: -0.01, turn: 7 }, L: { x: 0.12, z: 0.06, turn: 14 } };
// `planted` false leaves the legs straight and the root where it was, for a clip that plants them itself (the
// first plant would be thrown away: it rewrites every leg bone and the root).
function idlePose(p, planted = true) {
  const P = newPose();
  const s1 = Math.sin(TAU * p), s2 = Math.sin(2 * TAU * p + 0.7);
  setR(P, 'pelvis', 1 * DEG, 3 * DEG, -3.5 * DEG + 0.8 * DEG * s1);
  if (planted) plant(P, IDLE_FEET, { weight: 0.28 + 0.03 * s1, dx: 0.004 * s1 });
  setR(P, 'spine', -1 * DEG + 0.8 * DEG * s1, -2 * DEG, 2.5 * DEG);
  setR(P, 'chest', 1.2 * DEG * Math.cos(TAU * p), -1 * DEG, 1.5 * DEG);
  setR(P, 'neck', 0, 8 * DEG * s1, 0);
  setR(P, 'head', 2 * DEG + 2 * DEG * s2, 16 * DEG * s1 + 5 * DEG * s2, -2 * DEG);
  setR(P, 'uarmR', (-2 + 1.5 * s1) * DEG, 0, -0.07);
  setR(P, 'uarmL', (-2 - 1.5 * s1) * DEG, 0, 0.07);
  setR(P, 'farmR', -10 * DEG, 0, 0);
  setR(P, 'farmL', -12 * DEG, 0, 0);
  setR(P, 'handR', -6 * DEG, 0, 0);
  setR(P, 'handL', -6 * DEG, 0, 0);
  return P;
}

// The hitcher: standing, right arm up, two waves a cycle.
function wavePose(p) {
  const P = idlePose(0.15 + 0.08 * Math.sin(TAU * p));
  zeroR(P, 'uarmR'); zeroR(P, 'farmR'); zeroR(P, 'handR');
  const w = Math.sin(2 * TAU * p);
  setR(P, 'uarmR', -0.30, 0, -2.25);
  setR(P, 'farmR', 0, 0, -0.85 + 0.40 * w);
  setR(P, 'handR', 0, 0, 0.15 * w);
  return P;
}

// ── Standing about with somebody, or with nothing to do. glass/street-life.js picks between these. ──
// Each starts from idle's legs and hips held near one phase, so the stance is the same person's, and
// re-poses the arms and head. The arm rotations are the walk's conventions: flexion about X is
// negative forward, the right arm's abduction is negative outward and the left's positive, and a
// twist about the upper arm's own Y turns the forearm across the body (positive for the right arm).
const ARMS = ['neck', 'head', 'uarmR', 'farmR', 'handR', 'uarmL', 'farmL', 'handL'];
function stance(p, planted = true) {
  const P = idlePose(0.25 + 0.06 * Math.sin(TAU * p), planted);
  for (const b of ARMS) zeroR(P, b);
  return P;
}

// Talking: the right hand does most of it, opening out on three beats a cycle, the left joins on
// the second, and the head nods on each and turns between the listeners.
function talkPose(p) {
  const P = stance(p);
  const beat = bump(p, 0.18, 0.06) + bump(p, 0.52, 0.05) + bump(p, 0.80, 0.07);
  const g = Math.sin(2 * TAU * p);
  setR(P, 'uarmR', (-16 - 10 * beat) * DEG, 14 * DEG, -0.14 - 0.10 * beat);
  setR(P, 'farmR', (-66 - 16 * g) * DEG, 0, 0);
  setR(P, 'handR', -12 * DEG, 0, (-8 - 18 * beat) * DEG);
  const two = bump(p, 0.52, 0.09);
  setR(P, 'uarmL', (-8 - 10 * two) * DEG, -10 * DEG, 0.09 + 0.06 * two);
  setR(P, 'farmL', (-30 - 34 * two - 5 * Math.sin(3 * TAU * p + 1.1)) * DEG, 0, 0);
  setR(P, 'handL', -8 * DEG, 0, 10 * two * DEG);
  setR(P, 'chest', 2.5 * beat * DEG, 3 * DEG * Math.sin(TAU * p), 0);
  setR(P, 'neck', 0, 7 * DEG * Math.sin(TAU * p), 0);
  setR(P, 'head', (2 + 6 * beat) * DEG, 9 * DEG * Math.sin(TAU * p + 0.6), 2.5 * DEG * g);
  return P;
}

// The arm angles in the next four were solved rather than eyeballed: a random search over each arm's
// four angles for a hand position (and an elbow position, so the elbows stay near the body), with the
// forearm kept clear of the coat and, folded, of the other forearm, and the upper arm's twist held
// under about 80°, past which the shoulder of the coat shows a corner. Hence the odd decimals.

// Listening: hands loosely together at the belt, weight shifting, a nod now and then.
function listenPose(p) {
  const P = idlePose(p);
  for (const b of ARMS) zeroR(P, b);
  const nod = bump(p, 0.30, 0.04) + 0.7 * bump(p, 0.37, 0.035) + bump(p, 0.78, 0.05);
  setR(P, 'uarmR', -10.4 * DEG, 59.7 * DEG, -0.171);
  setR(P, 'farmR', -68.5 * DEG, 0, 0);
  setR(P, 'handR', -10 * DEG, 0, 0);
  setR(P, 'uarmL', -15.2 * DEG, -64.4 * DEG, 0.168);
  setR(P, 'farmL', -63.3 * DEG, 0, 0);
  setR(P, 'handL', -10 * DEG, 0, 0);
  setR(P, 'neck', 2 * DEG, 4 * DEG * Math.sin(TAU * p), 0);
  setR(P, 'head', (3 + 9 * nod) * DEG, 6 * DEG * Math.sin(TAU * p + 2.0), -3 * DEG * Math.sin(TAU * p));
  return P;
}

// Waiting: arms folded, the left over the right, looking up and down the street.
function waitPose(p) {
  const P = stance(p);
  setR(P, 'uarmR', -26.2 * DEG, 80.0 * DEG, 0.043);
  setR(P, 'farmR', -74.0 * DEG, 0, 0);
  setR(P, 'uarmL', -39.2 * DEG, -77.7 * DEG, -0.019);
  setR(P, 'farmL', -88.9 * DEG, 0, 0);
  setR(P, 'handR', 0, 0, 8 * DEG);
  setR(P, 'handL', 0, 0, -8 * DEG);
  const look = Math.sin(TAU * p);
  setR(P, 'neck', 0, 10 * DEG * look, 0);
  setR(P, 'head', 1 * DEG, 24 * DEG * look + 4 * DEG * Math.sin(2 * TAU * p), 0);
  return P;
}

// On the phone: both hands up in front of the chest, head down, glancing up once a cycle.
function phonePose(p) {
  const P = stance(p);
  const up = bump(p, 0.70, 0.07);
  setR(P, 'uarmR', -20 * DEG, 34 * DEG, -0.04);
  setR(P, 'farmR', (-84 + 3 * Math.sin(4 * TAU * p)) * DEG, 0, 0);
  setR(P, 'handR', -14 * DEG, 0, 10 * DEG);
  setR(P, 'uarmL', -18 * DEG, -30 * DEG, 0.04);
  setR(P, 'farmL', -80 * DEG, 0, 0);
  setR(P, 'handL', -14 * DEG, 0, -10 * DEG);
  setR(P, 'neck', (10 - 7 * up) * DEG, 0, 0);
  setR(P, 'head', (24 - 20 * up) * DEG, 14 * DEG * up * Math.sin(TAU * p * 2), 0);
  return P;
}

// Smoking: the left forearm across the waist holding the right elbow, the right hand coming up to
// the mouth once a cycle, held there, and back down; the head lifts a little as they let it out.
function smokePose(p) {
  const P = stance(p);
  // 0 down, 1 at the mouth: up over 0.10 to 0.24, held to 0.40, down by 0.54.
  const lift = smooth(0.10, 0.24, p) * (1 - smooth(0.40, 0.54, p));
  const out = bump(p, 0.62, 0.06);
  const mix = (a, b) => a + (b - a) * lift;
  setR(P, 'uarmL', -42.3 * DEG, -110.8 * DEG, -0.233);
  setR(P, 'farmL', -64.1 * DEG, 0, 0);
  setR(P, 'handL', 0, 0, -6 * DEG);
  setR(P, 'uarmR', mix(-16.0, -76.1) * DEG, mix(30.2, 71.5) * DEG, mix(0.010, 0.629));
  setR(P, 'farmR', mix(-104.6, -110.0) * DEG, 0, 0);
  setR(P, 'handR', mix(-20, -27.4) * DEG, 0, 6 * DEG);
  setR(P, 'neck', 0, 5 * DEG * Math.sin(TAU * p), 0);
  setR(P, 'head', (2 - 3 * lift - 9 * out) * DEG, (-6 * lift + 8 * Math.sin(TAU * p + 1.4)) * DEG, 0);
  return P;
}

// Leaning back on a wall. The wall is behind them (the clip faces +Z, out to the road), and glass/street-life.js
// stands them LEAN.wall metres in front of it. The hips go back and the trunk tips back until the shoulders are on
// it; the weight is on the right foot, planted out in front. `up` puts the left foot flat on the wall behind, the
// knee forward, the way somebody settles in for a smoke; otherwise both feet are out in front, a little apart.
// The arms, neck and head are another clip's (takeArms): the cigarette going, or folded.
export const LEAN = { wall: 0.3, back: 8, dz: -0.27 };
function leanBody(p, up) {
  const P = newPose(), s1 = Math.sin(TAU * p);
  setR(P, 'pelvis', -4 * DEG, 4 * DEG, -2.5 * DEG + 0.6 * DEG * s1);
  const R = { x: -0.1, z: 0.19, turn: 12 };
  if (up) {
    // the left leg up: the knee forward, the shin back from it to the wall a little under knee height, and the foot
    // pitched toes down so its sole is flat on the wall (the pelvis's tilt, the thigh and the shin come to 74°)
    setR(P, 'thighL', -40 * DEG, -12 * DEG, 3 * DEG);
    setR(P, 'shinL', 118 * DEG, 0, 0);
    setR(P, 'footL', 16 * DEG, 0, 0);
    plant(P, { R, L: { air: true } }, { weight: 0, dz: LEAN.dz + 0.004 * s1 });
  } else {
    plant(P, { R, L: { x: 0.11, z: 0.21, turn: 16 } }, { weight: 0.42 + 0.04 * s1, dz: LEAN.dz - 0.01 + 0.004 * s1 });
  }
  setR(P, 'spine', -LEAN.back * DEG + 0.5 * DEG * s1, -3 * DEG, 1.5 * DEG);
  setR(P, 'chest', -2 * DEG + 0.8 * DEG * Math.cos(TAU * p), -2 * DEG, 1 * DEG);
  return P;
}
// With a cigarette going: smokePose's arms and head over the lean, the head brought forward off the wall a little.
function leanSmokePose(p) {
  const P = takeArms(leanBody(p, true), smokePose(p));
  setR(P, 'neck', 5 * DEG, 0, 0);
  return P;
}
// Arms folded, both feet out in front.
function leanWallPose(p) {
  const P = takeArms(leanBody(p, false), waitPose(p));
  setR(P, 'neck', 5 * DEG, 0, 0);
  return P;
}

// ── A street dealer at his spot (docs/proposals/street-dealers.md). ──
// One long loop of somebody who isn't waiting for a bus. Each tell is small and on its own could be anyone; together
// they're a man minding the street. Hands in his pockets most of the time. Times are in seconds into DEALER_DUR so
// the beats keep their real lengths whatever the cycle is.
//   - glances: a quick turn of the head along the street, eyes first, held a moment, back slower than it went. The
//     second one is a double-take, the other way, shorter. Nobody idle looks round that fast.
//   - the bag: the right hand comes out and pats the bum bag twice, the head dipping to it, then straight back up.
//   - a scan: a slow look one way and on round the other, the chest going with it.
//   - the phone: out, a look down at it, a look up the street in the middle of reading, a thumb, and away again.
//   - settling: a shrug of the shoulders into the coat, and a sniff.
const DEALER_DUR = 32;
// 0..1 then back: in over `a` seconds, held `h`, out over `o`, starting at `s` seconds.
function beat(p, s, a, h, o) {
  const t = ((p * DEALER_DUR - s) % DEALER_DUR + DEALER_DUR) % DEALER_DUR;
  if (t < a) return smooth(0, 1, t / a);
  if (t < a + h) return 1;
  if (t < a + h + o) return 1 - smooth(0, 1, (t - a - h) / o);
  return 0;
}
// The dealer's arms, neck, head and shoulders, laid over whichever body (leaning or standing).
function dealerUpper(P, p) {
  const s1 = Math.sin(TAU * p * 3), s2 = Math.sin(TAU * p * 5 + 1.3);
  // glances: [start, sign, size]; a double-take after the first; the eyes lead, so the neck starts a touch after the head
  const glance = 1.0 * beat(p, 3.0, 0.22, 0.7, 0.55) - 0.6 * beat(p, 4.3, 0.18, 0.35, 0.45)
    - 0.85 * beat(p, 13.5, 0.25, 0.9, 0.6) + 0.7 * beat(p, 26.2, 0.2, 0.6, 0.5);
  const neckG = 1.0 * beat(p, 3.06, 0.24, 0.66, 0.55) - 0.6 * beat(p, 4.36, 0.2, 0.3, 0.45)
    - 0.85 * beat(p, 13.56, 0.27, 0.86, 0.6) + 0.7 * beat(p, 26.26, 0.22, 0.56, 0.5);
  // the slow scan: round one way, then the other, over about four seconds
  const sc = (t) => beat(p, t, 1.1, 0.4, 0.9);
  const scan = sc(17.5) - sc(19.4);
  // the bag: hand out of the pocket to the belt front and two pats
  const bag = beat(p, 9.0, 0.45, 1.0, 0.5), pat = bag * (bump(p, (9.6) / DEALER_DUR, 0.006) + bump(p, (9.95) / DEALER_DUR, 0.006));
  // the phone: out, read, a look up in the middle, back to reading, away
  const ph = beat(p, 21.5, 0.6, 3.6, 0.6), up = ph * beat(p, 23.1, 0.18, 0.5, 0.3);
  const thumb = ph * Math.max(0, Math.sin(TAU * p * DEALER_DUR * 1.7));
  // settling: the shoulders up into the coat and down, and a sniff
  const shrug = beat(p, 29.0, 0.35, 0.15, 0.5), sniff = beat(p, 11.8, 0.12, 0.08, 0.2);
  // the arms
  armTo(P, 'L', 'pocketL');
  if (ph > 0) armTo(P, 'R', 'pocketR', 'phoneR', ph);
  else armTo(P, 'R', 'pocketR', 'claspR', bag);
  setR(P, 'handR', -8 * DEG * pat + 3 * DEG * thumb, 0, 0);
  setR(P, 'uarmR', 0, 0, -0.03 * pat);
  // the shoulders into the coat
  setR(P, 'chest', (-1.5 * shrug) * DEG, (6 * glance + 9 * scan) * DEG, 0);
  setR(P, 'uarmL', 0, 0, 0.05 * shrug);
  setR(P, 'uarmR', 0, 0, -0.05 * shrug);
  // the head: chin a little down by habit, a slow drift, the glances and the scan on top, down to the bag and the phone
  const yaw = 4 * s1 + 2 * s2 + 38 * glance + 30 * scan;
  const down = 6 + 16 * beat(p, 9.0, 0.35, 1.1, 0.4) + 22 * (ph - up) - 6 * up + 5 * sniff;
  setR(P, 'neck', (4 + 0.4 * down) * DEG, (6 * s1 + 18 * neckG + 14 * scan) * DEG, 0);
  setR(P, 'head', (down * 0.6 - 4 * sniff) * DEG, yaw * DEG, (1.5 * s2 - 3 * glance) * DEG);
  return P;
}
// Leaning on a wall, the left foot up on it, the heel of the free foot tapping now and then.
function dealerLeanPose(p) {
  const P = leanBody(p, true);
  for (const b of ARMS) zeroR(P, b);
  dealerUpper(P, p);
  setR(P, 'footL', 6 * DEG * (bump(p, 7.1 / DEALER_DUR, 0.004) + bump(p, 7.5 / DEALER_DUR, 0.004) + bump(p, 7.9 / DEALER_DUR, 0.004)), 0, 0);
  setR(P, 'neck', 5 * DEG, 0, 0);
  return P;
}
// Standing where there's no wall: the weight on the right leg, the left loose, and once a cycle the weight across
// onto the left and back, slowly, as somebody does who's been stood there an hour.
function dealerStandPose(p) {
  const P = idlePose(0.25 + 0.04 * Math.sin(TAU * p), false);
  const swap = beat(p, 14.5, 1.6, 6, 1.8);
  // the hip drops on the side the weight leaves, before the feet are planted, so the plant keeps both soles down
  setR(P, 'pelvis', 0, 0, 4 * swap * DEG);
  plant(P, IDLE_FEET, { weight: 0.28 + 0.4 * swap + 0.02 * Math.sin(TAU * p * 4), dx: 0.004 * Math.sin(TAU * p * 4) });
  for (const b of ARMS) zeroR(P, b);
  return dealerUpper(P, p);
}

// Walking with a cigarette going: the walk's legs and left arm, four strides to a cycle, the right forearm carried
// up a little with the cigarette in it, and once a cycle the hand up to the mouth for a drag on the move and down
// again. Four strides, because a drag every stride would be a chain-smoker's; its stride is four of the walk's
// (actorStrideM), so the feet still cover the ground the figure does.
const WALK_SMOKE_STRIDES = 4;
function walkSmokePose(p) {
  const q = (p * WALK_SMOKE_STRIDES) % 1, P = walkPose(q);
  const lift = smooth(0.30, 0.40, p) * (1 - smooth(0.54, 0.64, p)), out = bump(p, 0.72, 0.05);
  const ca = Math.cos(TAU * (q - 0.05)), mix = (a, b) => a + (b - a) * lift;
  for (const b of ['uarmR', 'farmR', 'handR']) zeroR(P, b);
  // carried: a small swing, the elbow bent so the cigarette's held out in front of the hip
  setR(P, 'uarmR', mix(-(6 - 8 * ca), -76.1) * DEG, mix(14, 71.5) * DEG, mix(-0.08, 0.629));
  setR(P, 'farmR', mix(-62, -110.0) * DEG, 0, 0);
  setR(P, 'handR', mix(-24, -27.4) * DEG, 0, 6 * DEG);
  setR(P, 'head', -6 * DEG * out, -4 * DEG * lift, 0);
  return P;
}

// ── Taking something, at home. Room Stage only: they're posed on the CPU and never baked, so these
// cost the street nothing. The name is the drug's flags.taken (plugins/npc-drugs); 'smoke' is the
// clip above, and 'prep' is the measuring out before any of them.
// The right hand from the waist (0) to the mouth (1), as smokePose takes it there.
function handToMouth(P, k) {
  const mix = (a, b) => a + (b - a) * k;
  setR(P, 'uarmR', mix(-16.0, -76.1) * DEG, mix(30.2, 71.5) * DEG, mix(0.010, 0.629));
  setR(P, 'farmR', mix(-104.6, -110.0) * DEG, 0, 0);
  setR(P, 'handR', mix(-20, -27.4) * DEG, 0, 6 * DEG);
}
function leftAcrossWaist(P) {
  setR(P, 'uarmL', -42.3 * DEG, -110.8 * DEG, -0.233);
  setR(P, 'farmL', -64.1 * DEG, 0, 0);
  setR(P, 'handL', 0, 0, -6 * DEG);
}
// Measuring it out: both hands low in front, busy, and the head down over them.
function prepPose(p) {
  const P = stance(p), w = Math.sin(6 * TAU * p), up = bump(p, 0.55, 0.05);
  setR(P, 'uarmR', -14 * DEG, 30 * DEG, -0.04);
  setR(P, 'farmR', (-70 + 5 * w) * DEG, 0, 0);
  setR(P, 'handR', (-10 + 8 * w) * DEG, 0, 10 * DEG);
  setR(P, 'uarmL', -12 * DEG, -28 * DEG, 0.04);
  setR(P, 'farmL', -72 * DEG, 0, 0);
  setR(P, 'handL', -14 * DEG, 0, -10 * DEG);
  setR(P, 'neck', (14 - 10 * up) * DEG, 0, 0);
  setR(P, 'head', (26 - 22 * up) * DEG, 16 * DEG * up, 0);
  return P;
}
// A line off the back of the left hand: it comes up under the face, the head goes down to it, one
// hard sniff, and the head snaps back with the right hand pinching the nose.
function snortPose(p) {
  const P = stance(p);
  const up = smooth(0.06, 0.22, p) * (1 - smooth(0.46, 0.60, p));
  const down = smooth(0.20, 0.32, p) * (1 - smooth(0.42, 0.48, p));
  const pinch = smooth(0.46, 0.56, p) * (1 - smooth(0.76, 0.90, p));
  const back = smooth(0.42, 0.50, p) * (1 - smooth(0.70, 0.92, p));
  const mix = (a, b, k) => a + (b - a) * k;
  // the left hand to under the nose, as handToMouth takes the right, and the right from hanging
  setR(P, 'uarmL', mix(-12, -68, up) * DEG, mix(-18, -66, up) * DEG, mix(0, -0.55, up));
  setR(P, 'farmL', mix(-30, -112, up) * DEG, 0, 0);
  setR(P, 'handL', -24 * DEG * up, 0, -6 * DEG);
  setR(P, 'uarmR', mix(-8, -76.1, pinch) * DEG, mix(12, 71.5, pinch) * DEG, mix(0, 0.629, pinch));
  setR(P, 'farmR', mix(-24, -110, pinch) * DEG, 0, 0);
  setR(P, 'handR', -27.4 * DEG * pinch, 0, 6 * DEG);
  setR(P, 'chest', 8 * DEG * down, 0, 0);
  setR(P, 'neck', (16 * down - 8 * back) * DEG, 0, 0);
  setR(P, 'head', (24 * down - 18 * back) * DEG, 5 * DEG * back * Math.sin(5 * TAU * p), 0);
  return P;
}
// A needle: the left arm held out with its inside up, the right hand across to the elbow, the head
// bent to it, a long still press, then the left arm comes in slowly and the head goes back.
function injectPose(p) {
  const P = stance(p);
  const out = smooth(0.06, 0.20, p) * (1 - smooth(0.62, 0.80, p));
  const push = smooth(0.18, 0.30, p) * (1 - smooth(0.54, 0.64, p));
  const nod = smooth(0.62, 0.76, p) * (1 - smooth(0.90, 1, p));
  const mix = (a, b, k) => a + (b - a) * k;
  setR(P, 'uarmL', mix(-8, -30, out) * DEG, mix(-10, -28, out) * DEG, 0.04);
  setR(P, 'farmL', mix(-16, -62, out) * DEG, 0, 0);
  setR(P, 'handL', 12 * DEG * out, 0, 0);
  setR(P, 'uarmR', mix(-10, -30, push) * DEG, mix(16, 58, push) * DEG, mix(0, 0.1, push));
  setR(P, 'farmR', mix(-24, -98, push) * DEG, 0, 0);
  setR(P, 'handR', -14 * DEG * push, 0, 0);
  setR(P, 'neck', (14 * out - 6 * nod) * DEG, 0, 0);
  setR(P, 'head', (22 * out - 12 * nod) * DEG, -14 * DEG * out, 0);
  return P;
}
// A pill or a tab: hand to the mouth quickly, head back to get it down, a swallow, and done.
function swallowPose(p) {
  const P = stance(p);
  const lift = smooth(0.12, 0.26, p) * (1 - smooth(0.40, 0.54, p));
  const back = smooth(0.30, 0.40, p) * (1 - smooth(0.58, 0.72, p));
  leftAcrossWaist(P);
  handToMouth(P, lift);
  setR(P, 'neck', -8 * DEG * back, 0, 0);
  setR(P, 'head', (-20 * back + 4 * bump(p, 0.52, 0.03)) * DEG, 0, 0);
  return P;
}
// Off a rag, a can or a bulb: both hands to the face, one long breath in with the chest rising and
// the head going back, held, then a sway as it lands.
function huffPose(p) {
  const P = stance(p);
  const lift = smooth(0.08, 0.22, p) * (1 - smooth(0.56, 0.70, p));
  const breath = smooth(0.22, 0.50, p) * (1 - smooth(0.56, 0.66, p));
  const sway = smooth(0.60, 0.72, p) * (1 - smooth(0.90, 1, p));
  const mix = (a, b) => a + (b - a) * lift;
  handToMouth(P, lift);
  setR(P, 'uarmL', mix(-16.0, -76.1) * DEG, -mix(30.2, 71.5) * DEG, -mix(0.010, 0.629));
  setR(P, 'farmL', mix(-104.6, -110.0) * DEG, 0, 0);
  setR(P, 'handL', mix(-20, -27.4) * DEG, 0, -6 * DEG);
  setR(P, 'chest', -6 * DEG * breath, 3 * DEG * sway * Math.sin(2 * TAU * p), 0);
  setR(P, 'neck', -6 * DEG * breath, 0, 0);
  setR(P, 'head', (-14 * breath + 6 * sway) * DEG, 10 * DEG * sway * Math.sin(2 * TAU * p), 5 * DEG * sway);
  return P;
}
// A glass or a bottle: to the mouth and tipped back in two swallows, then down again with a breath.
function drinkPose(p) {
  const P = stance(p);
  const lift = smooth(0.10, 0.24, p) * (1 - smooth(0.60, 0.74, p));
  const tip = smooth(0.22, 0.34, p) * (1 - smooth(0.56, 0.66, p));
  leftAcrossWaist(P);
  handToMouth(P, lift);
  setR(P, 'handR', (-27.4 * lift - 16 * tip) * DEG, 0, 6 * DEG);
  setR(P, 'neck', -10 * DEG * tip, 0, 0);
  setR(P, 'head', (-22 * tip + 3 * Math.sin(4 * TAU * p) * tip + 6 * bump(p, 0.80, 0.05)) * DEG, 0, 0);
  return P;
}

// ── In a seat. The Coliseum's fans from the air (windshield.js parkFigures). ──
// Sitting: thighs out level and shins straight down, so the bake's lowest point (the feet) puts the
// seat about half a metre up; hands on the lap, and the head following the play.
function sitBody() {
  const P = newPose();
  P.root[1] = -0.44;
  for (const sd of ['L', 'R']) {
    setR(P, 'thigh' + sd, -88 * DEG, 0, sd === 'L' ? 4 * DEG : -4 * DEG);
    setR(P, 'shin' + sd, 86 * DEG, 0, 0);
  }
  setR(P, 'spine', 4 * DEG, 0, 0);
  return P;
}
function sitPose(p) {
  const P = sitBody();
  setR(P, 'chest', 2 * DEG * Math.cos(TAU * p), 0, 0);
  setR(P, 'head', 4 * DEG, 22 * DEG * Math.sin(TAU * p), 0);
  armTo(P, 'L', 'lapL'); armTo(P, 'R', 'lapR');
  return P;
}
// Up and cheering: both arms over the head, pumping twice a cycle, and a bounce on the toes.
function cheerPose(p) {
  const P = idlePose(0.25);
  for (const b of ARMS) zeroR(P, b);
  const w = Math.sin(2 * TAU * p);
  P.root[1] = 0.03 * Math.max(0, w);
  setR(P, 'uarmR', -0.25, 0, -2.6 + 0.25 * w); setR(P, 'uarmL', -0.25, 0, 2.6 - 0.25 * w);
  setR(P, 'farmR', 0, 0, -0.35); setR(P, 'farmL', 0, 0, 0.35);
  setR(P, 'head', -10 * DEG, 0, 0);
  return P;
}

// ── Solved arms. Each is a random search for a wrist, an elbow and a fingertip against the skeleton, as
// the four above were: [flexion deg, twist deg, abduction rad, elbow deg, wrist flexion deg, wrist abduction deg].
const ARM_AT = {
  hangL: [-2, 0, 0.07, -12, -6, 0], hangR: [-2, 0, -0.07, -10, -6, 0],
  lapL: [7.1, -26.8, 0.211, -91.1, -3.8, 4.5], lapR: [6.9, 27, -0.212, -91.1, -2.9, -5.7],
  claspL: [-1.7, -37.1, 0.123, -89.4, 2.3, -18.8], claspR: [-1, 34.6, -0.13, -86.3, -4.6, 19],
  leanL: [-19.6, -15.2, -0.068, -92.8, 17.7, -33.3], leanR: [-19.7, 15.4, 0.065, -92.7, 16.9, 33.2],
  hipL: [14.6, -66.9, 0.776, -92.2, -4.4, 15], hipR: [15.3, 66.5, -0.784, -95.3, -0.5, -14.8],
  pocketL: [9, -56.6, 0.387, -61.8, 23, -22.2], pocketR: [10.3, 55.6, -0.397, -65.1, 28.4, 21.2],
  behindL: [27.7, -88.7, 0.354, -76, -25.3, -9.7], behindR: [27.1, 87.7, -0.293, -68.9, -46, 21.6],
  scratchR: [-155.3, 65.4, 0.508, -125.4, 49, 14.3], neckR: [-180.5, 59.3, 0.375, -133.3, 9.4, 24.3],
  watchL: [-30.2, -32.9, 0.129, -101.3, -2, -31.3],
  // the right hand at the mouth is handToMouth's end; the rest were searched from it for a hand centred just off
  // the forehead, either side of the mouth, and at the collar
  mouthR: [-76.1, 71.5, 0.629, -110, -27.4, 6], browR: [-108.3, 28.1, -0.036, -86.8, -27.4, 6],
  collarR: [-54.5, 44.4, -0.075, -126.8, -8, 0], cupL: [-61.6, -52.6, -0.51, -114.3, -10, 0], cupR: [-61.6, 52.6, 0.51, -114.3, -10, 0],
  // the right hand up in front of the chest with a phone in it (phonePose's right arm)
  phoneR: [-20, 34, -0.04, -84, -14, 10],
};
// An arm k of the way from one solved place to another.
function armTo(P, side, a, b = a, k = 1) {
  const v = ARM_AT[a].map((x, i) => x + (ARM_AT[b][i] - x) * k);
  setR(P, 'uarm' + side, v[0] * DEG, v[1] * DEG, v[2]);
  setR(P, 'farm' + side, v[3] * DEG, 0, 0);
  setR(P, 'hand' + side, v[4] * DEG, 0, v[5] * DEG);
}
// A pose seen in a mirror: a person's other way of standing.
function mirrored(P) {
  const Q = newPose(), other = (n) => n.replace(/^(uarm|farm|hand|thigh|shin|foot|toe)([LR])$/, (m, a, s) => a + (s === 'L' ? 'R' : 'L'));
  for (let i = 0; i < BONES.length; i++) { const j = B[other(BONES[i][0])]; Q.r[j * 3] = P.r[i * 3]; Q.r[j * 3 + 1] = -P.r[i * 3 + 1]; Q.r[j * 3 + 2] = -P.r[i * 3 + 2]; }
  Q.root = [-P.root[0], P.root[1], P.root[2]];
  return Q;
}
// How much of a gesture is on at phase p: on over the first fifth of a slot, off over the last.
const held = (p, a = 0.1, b = 0.8) => smooth(a, a + 0.14, p) * (1 - smooth(b, b + 0.14, p));

// ── Standing about in a room, one at a time for a slot each: gl/room-people.js picks (ACTOR_IDLES). ──
// Weight over on the other foot, and back.
function idleShiftPose(p) {
  const A = idlePose(p), Bm = mirrored(idlePose(p)), k = held(p, 0.05, 0.75), P = newPose();
  for (let i = 0; i < P.r.length; i++) P.r[i] = A.r[i] + (Bm.r[i] - A.r[i]) * k;
  // the feet stay where they are and the weight goes across onto the other one; mirroring the stance would slide
  // both feet across the floor
  return plant(P, IDLE_FEET, { weight: mixN(0.28, 0.72, k) + 0.03 * Math.sin(TAU * p), dx: 0.004 * Math.sin(TAU * p) });
}
// Looking over one shoulder, then the other, the chest going with it.
function idleLookPose(p) {
  const P = stance(p), a = held(p, 0.08, 0.38), b = held(p, 0.5, 0.78), turn = a - b;
  armTo(P, 'L', 'hangL'); armTo(P, 'R', 'hangR');
  setR(P, 'chest', 0, 12 * DEG * turn, 0);
  setR(P, 'neck', 0, 18 * DEG * turn, 0);
  setR(P, 'head', 2 * DEG, 30 * DEG * turn, 0);
  return P;
}
function hipPose(p) {
  const P = stance(p), s = Math.sin(TAU * p);
  armTo(P, 'L', 'hipL'); armTo(P, 'R', 'hangR');
  setR(P, 'chest', 0, -4 * DEG, -1.5 * DEG);
  setR(P, 'neck', 0, 6 * DEG * s, 0);
  setR(P, 'head', 1 * DEG, 14 * DEG * s, 2 * DEG);
  return P;
}
const hipRPose = (p) => mirrored(hipPose(p));
// ── More ways of standing about. Each is the idle's own stance with something done over it for part of a slot. ──
// Both hands on the hips, the chest out, looking the place over.
function hipsPose(p) {
  const P = stance(p), s = Math.sin(TAU * p), k = held(p, 0.06, 0.8);
  armTo(P, 'L', 'hangL', 'hipL', k); armTo(P, 'R', 'hangR', 'hipR', k);
  setR(P, 'spine', -2 * DEG * k, 0, 0);
  setR(P, 'chest', -3 * DEG * k, 5 * DEG * s * k, 0);
  setR(P, 'neck', 0, 8 * DEG * s, 0);
  setR(P, 'head', -2 * DEG * k, 16 * DEG * s, 0);
  return P;
}
// Head back, looking up at whatever's up there, and round at it.
function lookUpPose(p) {
  const P = stance(p), k = held(p, 0.1, 0.6), s = Math.sin(2 * TAU * p);
  armTo(P, 'L', 'hangL'); armTo(P, 'R', 'hangR');
  setR(P, 'spine', -3 * DEG * k, 0, 0);
  setR(P, 'chest', -4 * DEG * k, 4 * DEG * s * k, 0);
  setR(P, 'neck', -10 * DEG * k, 6 * DEG * s * k, 0);
  setR(P, 'head', -16 * DEG * k, 10 * DEG * s * k, 2 * DEG * k);
  return P;
}
// A cough into the fist, twice (ROOM_CLIPS' face opens the mouth on each).
const idleCoughK = (p) => bump(p, 0.3, 0.035) + bump(p, 0.42, 0.035);
function idleCoughPose(p) {
  const P = stance(p), k = held(p, 0.16, 0.5), c = idleCoughK(p);
  armTo(P, 'L', 'hangL'); armTo(P, 'R', 'hangR', 'mouthR', k);
  setR(P, 'spine', 5 * DEG * c, 0, 0);
  setR(P, 'chest', (3 * k + 7 * c) * DEG, 0, 0);
  setR(P, 'neck', 5 * DEG * k, 0, 0);
  setR(P, 'head', (8 * k + 8 * c) * DEG, -4 * DEG * k, 0);
  return P;
}
// The back of the hand drawn across the forehead.
function idleWipePose(p) {
  const P = stance(p), k = held(p, 0.14, 0.46), sweep = smooth(0.2, 0.42, p);
  // (the hand goes to between the mouth's place and the brow's and slides across from there: all the way to the
  // brow's, which was found for a seated lean, a standing arm put the fist over the head)
  const to = ARM_AT.mouthR.map((x, i) => x + (ARM_AT.browR[i] - x) * (0.45 + 0.15 * sweep)), v = ARM_AT.hangR.map((x, i) => x + (to[i] - x) * k);
  armTo(P, 'L', 'hangL');
  setR(P, 'uarmR', v[0] * DEG, v[1] * DEG, v[2]); setR(P, 'farmR', v[3] * DEG, 0, 0); setR(P, 'handR', v[4] * DEG, 0, v[5] * DEG);
  setR(P, 'neck', -4 * DEG * k, 0, 0);
  setR(P, 'head', -8 * DEG * k, (6 - 12 * sweep) * DEG * k, 3 * DEG * k);
  return P;
}
// Two fingers in the collar, the chin up and round to ease the neck.
function collarPose(p) {
  const P = stance(p), k = held(p, 0.12, 0.58), s = Math.sin(3 * TAU * p);
  armTo(P, 'L', 'hangL'); armTo(P, 'R', 'hangR', 'collarR', k);
  setR(P, 'neck', -6 * DEG * k, 8 * DEG * s * k, 0);
  setR(P, 'head', -8 * DEG * k, 12 * DEG * s * k, 4 * DEG * s * k);
  return P;
}
// Hands clasped in front, waiting politely, a slow look each way.
function claspPose(p) {
  const P = stance(p), s = Math.sin(TAU * p), k = held(p, 0.04, 0.84);
  armTo(P, 'L', 'hangL', 'claspL', k); armTo(P, 'R', 'hangR', 'claspR', k);
  setR(P, 'chest', 1 * DEG, 0, 0);
  setR(P, 'neck', 0, 6 * DEG * s, 0);
  setR(P, 'head', 3 * DEG, 14 * DEG * s, 0);
  return P;
}
// A shrug at nobody: the hands turn out, the head tips, and it's gone.
function idleShrugPose(p) {
  const P = stance(p), k = held(p, 0.3, 0.42), s = Math.sin(TAU * p);
  armTo(P, 'L', 'hangL'); armTo(P, 'R', 'hangR');
  setR(P, 'uarmL', -6 * DEG * k, 0, 0.22 * k); setR(P, 'uarmR', -6 * DEG * k, 0, -0.22 * k);
  setR(P, 'farmL', -48 * DEG * k, 0, 0); setR(P, 'farmR', -48 * DEG * k, 0, 0);
  setR(P, 'handL', -20 * DEG * k, 0, -30 * DEG * k); setR(P, 'handR', -20 * DEG * k, 0, 30 * DEG * k);
  setR(P, 'chest', -2 * DEG * k, 0, 0);
  setR(P, 'neck', 0, 5 * DEG * s, 0);
  setR(P, 'head', 2 * DEG * k, 10 * DEG * s, 7 * DEG * k);
  return P;
}
// Bored: the arms swung forward and back together, loose, the hands nearly meeting in front.
function swingPose(p) {
  const P = stance(p), k = held(p, 0.08, 0.78), s = Math.sin(5 * TAU * p), f = Math.max(0, s);
  armTo(P, 'L', 'hangL'); armTo(P, 'R', 'hangR');
  setR(P, 'uarmL', -22 * DEG * s * k, -10 * DEG * f * k, 0); setR(P, 'uarmR', -22 * DEG * s * k, 10 * DEG * f * k, 0);
  setR(P, 'farmL', -14 * DEG * f * k, 0, 0); setR(P, 'farmR', -14 * DEG * f * k, 0, 0);
  setR(P, 'head', 3 * DEG, 10 * DEG * Math.sin(TAU * p), 0);
  return P;
}
// The weight from one foot to the other and back, slowly, without settling on either.
function swayPose(p) {
  const P = idlePose(p), s = Math.sin(2 * TAU * p);
  for (const b of ARMS) zeroR(P, b);
  armTo(P, 'L', 'hangL'); armTo(P, 'R', 'hangR');
  setR(P, 'chest', 0, 0, -1.5 * DEG * s);
  setR(P, 'head', 1 * DEG, 8 * DEG * Math.sin(TAU * p), 1 * DEG * s);
  return plant(P, IDLE_FEET, { weight: 0.5 + 0.2 * s });
}
function pocketsPose(p) {
  const P = idlePose(p);
  for (const b of ARMS) zeroR(P, b);
  armTo(P, 'L', 'pocketL'); armTo(P, 'R', 'pocketR');
  const s = Math.sin(TAU * p);
  setR(P, 'neck', 0, 5 * DEG * s, 0);
  setR(P, 'head', (2 + 2 * Math.sin(2 * TAU * p)) * DEG, 12 * DEG * s, 0);
  return P;
}
// Hands behind the back, chest out, rocking a little onto the toes.
function behindPose(p) {
  const P = stance(p), r = Math.max(0, Math.sin(2 * TAU * p));
  armTo(P, 'L', 'behindL'); armTo(P, 'R', 'behindR');
  P.root[1] += 0.008 * r;
  setR(P, 'chest', -3 * DEG, 0, 0);
  setR(P, 'head', -1 * DEG, 10 * DEG * Math.sin(TAU * p), 0);
  return P;
}
function scratchPose(p) {
  const P = stance(p), k = held(p, 0.1, 0.62), w = k * Math.sin(p * TAU * 11);
  armTo(P, 'L', 'hangL'); armTo(P, 'R', 'hangR', 'scratchR', k);
  setR(P, 'handR', 8 * DEG * w, 0, 5 * DEG * w);
  setR(P, 'head', 6 * DEG * k, -6 * DEG * k, -7 * DEG * k);
  return P;
}
// A stiff neck: the hand up to it, the head rolled over.
function neckPose(p) {
  const P = stance(p), k = held(p, 0.1, 0.66), r = k * Math.sin(p * TAU * 2.5);
  armTo(P, 'L', 'hangL'); armTo(P, 'R', 'hangR', 'neckR', k);
  setR(P, 'neck', 5 * DEG * k, 0, 6 * DEG * r);
  setR(P, 'head', 8 * DEG * k, 6 * DEG * r, 8 * DEG * r);
  return P;
}
// A look at the wrist, a look up, and the arm down.
function watchPose(p) {
  const P = stance(p), k = held(p, 0.12, 0.56), look = smooth(0.14, 0.24, p) * (1 - smooth(0.44, 0.52, p));
  armTo(P, 'L', 'hangL', 'watchL', k); armTo(P, 'R', 'hangR');
  setR(P, 'chest', 2 * DEG * look, 4 * DEG * k, 0);
  setR(P, 'neck', 7 * DEG * look, 5 * DEG * look, 0);
  setR(P, 'head', 15 * DEG * look, 9 * DEG * look, 0);
  return P;
}
// Both arms up and the back arched, up on the toes for it.
function stretchPose(p) {
  const P = stance(p), k = held(p, 0.1, 0.5), m = (a, b) => a + (b - a) * k;
  // reached up all the way, near enough straight, one arm a little higher than the other (the close-up figure's
  // shoulders rise to meet it: gl/room-people.js girdle)
  setR(P, 'uarmL', m(-2, -10) * DEG, 0, m(0.07, 2.97)); setR(P, 'uarmR', m(-2, -13) * DEG, 0, m(-0.07, -3.05));
  setR(P, 'farmL', m(-12, -16) * DEG, 0, 0); setR(P, 'farmR', m(-10, -11) * DEG, 0, 0);
  setR(P, 'handL', m(-6, 12) * DEG, 0, 0); setR(P, 'handR', m(-6, 12) * DEG, 0, 0);
  P.root[1] += 0.014 * k;
  setR(P, 'spine', -5 * DEG * k, 0, 0);
  setR(P, 'chest', -5 * DEG * k, 0, 0);
  setR(P, 'head', -12 * DEG * k, 0, 0);
  return P;
}
// A yawn behind the hand: the head going back, the jaw dropping (ROOM_CLIPS' face).
const yawnK = (p) => smooth(0.14, 0.3, p) * (1 - smooth(0.46, 0.6, p));
function yawnPose(p) {
  const P = stance(p), k = held(p, 0.1, 0.56), y = yawnK(p);
  armTo(P, 'L', 'hangL'); armTo(P, 'R', 'hangR');
  zeroR(P, 'uarmR'); zeroR(P, 'farmR'); zeroR(P, 'handR');
  handToMouth(P, k);
  setR(P, 'chest', -3 * DEG * y, 0, 0);
  setR(P, 'neck', -5 * DEG * y, 0, 0);
  setR(P, 'head', -12 * DEG * y, 0, 0);
  return P;
}
// A long breath in and all of it out, the shoulders dropping.
// Asleep in a clone vat (gl/room-vat.js): weightless, so nothing hangs straight. The toes point, the knees are soft
// and not alike, the arms float a little off the body with the hands limp, the head is bowed and over to one side.
// Two slow breaths a cycle lift the chest and the arms with it, and once a cycle the right hand twitches.
function vatFloatPose(p) {
  const P = newPose(), b = Math.sin(2 * TAU * p), d = Math.sin(TAU * p), tw = bump(p, 0.63, 0.012);
  setR(P, 'pelvis', 3 * DEG, 2 * DEG * d, -1.5 * DEG);
  setR(P, 'thighL', (-9 - 2 * d) * DEG, -4 * DEG, 5 * DEG); setR(P, 'shinL', (16 + 3 * d) * DEG, 0, 0); setR(P, 'footL', 30 * DEG, 0, 3 * DEG);
  setR(P, 'thighR', (-3 + 1.5 * d) * DEG, 5 * DEG, -3 * DEG); setR(P, 'shinR', (9 - 2 * d) * DEG, 0, 0); setR(P, 'footR', 24 * DEG, 0, -4 * DEG);
  setR(P, 'spine', 5 * DEG, -2 * DEG, 1.5 * DEG);
  setR(P, 'chest', (4 - 2.5 * b) * DEG, 1.5 * DEG, -1 * DEG);
  arm(P, 'L', -8 - 3 * b, -6, 0.3 + 0.05 * b + 0.03 * d, -26 - 4 * b, -16, -6);
  arm(P, 'R', -4 - 2 * b, 8, -0.24 - 0.04 * b, -18 - 3 * b - 14 * tw, -12 - 20 * tw, 4);
  setR(P, 'neck', (16 + 1.5 * b) * DEG, -3 * DEG, 4 * DEG);
  setR(P, 'head', (13 + 1 * b) * DEG, -6 * DEG, 7 * DEG);
  return P;
}

function sighPose(p) {
  const P = stance(p), inn = smooth(0.12, 0.34, p) * (1 - smooth(0.38, 0.5, p)), out = smooth(0.38, 0.5, p) * (1 - smooth(0.62, 0.8, p));
  armTo(P, 'L', 'hangL'); armTo(P, 'R', 'hangR');
  setR(P, 'chest', (-5 * inn + 4 * out) * DEG, 0, 0);
  setR(P, 'head', (-6 * inn + 9 * out) * DEG, 0, 0);
  return P;
}

// ── Seated. The legs and hips are sitPose's, and the arms each one's. ──
// Nobody sits square: the room's seat (not the Coliseum crowd's, which is sitBody alone) has the left foot out
// in front and the right tucked back under the chair, the knees apart and not level, the hips turned a little
// and the shoulders off true, so a seated person looks settled rather than placed.
// ⚠ A SEATED THIGH IS AT GIMBAL LOCK. Local rotation is Rz·Rx·Ry, and a thigh raised to the seat is x ≈ -90, where
// z and y both turn it about its own length. Neither opens the knees: adding to them rolled the thigh, which swung
// the shins out with the knees still together and left the toes pointing in. seatLeg takes a leg as people
// describe it and works the Euler angles out from that.
// `flex` raises the thigh from hanging (90 is level), `spread` turns the knee out from straight ahead (negative
// across the other leg), `roll` turns the thigh about its own length (positive swings the foot in toward the other
// one), `knee` bends the shin from straight, `ankle` points the toes (positive down), `toe` turns the foot out. With
// the shin upright the foot follows the knee, so an open knee has its toes pointing out over it.
const _m3 = (A, Bm) => A.map((r) => [0, 1, 2].map((c) => r[0] * Bm[0][c] + r[1] * Bm[1][c] + r[2] * Bm[2][c]));
const _x3 = (a) => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
const _y3 = (a) => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]];
function seatLeg(P, sd, { flex = 88, spread = 4, roll = 0, knee = 86, ankle = 0, toe = 6 } = {}) {
  const s = sd === 'L' ? 1 : -1, M = _m3(_y3(s * spread * DEG), _m3(_x3(-flex * DEG), _y3(s * roll * DEG)));
  const x = Math.asin(Math.max(-1, Math.min(1, M[2][1]))), y = Math.atan2(-M[2][0], M[2][2]), z = Math.atan2(-M[0][1], M[1][1]);
  for (const b of ['thigh', 'shin', 'foot']) zeroR(P, b + sd);
  setR(P, 'thigh' + sd, x, y, z); setR(P, 'shin' + sd, knee * DEG, 0, 0); setR(P, 'foot' + sd, ankle * DEG, s * toe * DEG, 0);
}
// The ways of sitting, as [left leg, right leg]. `rest` is everybody's: knees a hand apart, the left foot out in
// front and the right back under the seat, toes a little out. Each has a man's version in SEAT_WIDE.
const SEAT_LEGS = {
  rest: [{ flex: 84, spread: 5, knee: 66, ankle: -8, toe: 6 }, { flex: 90, spread: 3, knee: 100, ankle: 8, toe: 4 }],
  // his knees over his feet and his toes pointing straight out over them
  open: [{ flex: 86, spread: 17, knee: 74, ankle: -4, toe: 6 }, { flex: 90, spread: 15, knee: 94, ankle: 4, toe: 8 }],
  // slid forward, both legs out long and apart, toes out
  sprawl: [{ flex: 72, spread: 14, knee: 40, ankle: -14, toe: 10 }, { flex: 76, spread: 12, knee: 52, ankle: -8, toe: 12 }],
  // legs out in front, crossed at the ankle, left over right
  ankles: [{ flex: 78, spread: 2, roll: 18, knee: 46, ankle: -16, toe: 2 }, { flex: 80, spread: 2, roll: 10, knee: 50, ankle: -12, toe: 2 }],
  // out in front, the heels together and the toes apart
  anklesOpen: [{ flex: 78, spread: 8, knee: 46, ankle: -16, toe: 16 }, { flex: 80, spread: 8, knee: 50, ankle: -12, toe: 16 }],
  // the left leg crossed over the right knee, its foot hanging outside the right shin
  crossL: [{ flex: 106, spread: -18, roll: 20, knee: 82, ankle: -14, toe: 0 }, { flex: 86, spread: 6, knee: 82, ankle: 0, toe: 6 }],
  // a man's crossed leg: the left ankle up on the right knee
  fourL: [{ flex: 105, spread: 25, roll: 92, knee: 115, ankle: 8, toe: 0 }, { flex: 88, spread: 10, knee: 86, ankle: 0, toe: 10 }],
  // both feet drawn back under the seat, up on the toes, knees together
  tuck: [{ flex: 86, spread: 2, roll: 3, knee: 116, ankle: 26, toe: 2 }, { flex: 86, spread: 2, roll: 3, knee: 112, ankle: 24, toe: 2 }],
  tuckOpen: [{ flex: 86, spread: 12, knee: 110, ankle: 22, toe: 10 }, { flex: 86, spread: 12, knee: 106, ankle: 20, toe: 10 }],
};
// the right-over-left sets, mirrored
const mirrorLegs = ([l, r]) => [r, l];
SEAT_LEGS.crossR = mirrorLegs(SEAT_LEGS.crossL); SEAT_LEGS.fourR = mirrorLegs(SEAT_LEGS.fourL);
const SEAT_WIDE = { rest: 'open', ankles: 'anklesOpen', crossL: 'fourL', crossR: 'fourR', tuck: 'tuckOpen' };
function seatLegs(P, name) {
  const [l, r] = SEAT_LEGS[name] || SEAT_LEGS.rest;
  seatLeg(P, 'L', l); seatLeg(P, 'R', r);
  P.legs = name;
  return P;
}
// Each set's own angles, so a man's twin can swap the set and keep what the clip did to the shins and feet on top.
const LEG_BONES = ['thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];
const LEG_R = {};
for (const n of Object.keys(SEAT_LEGS)) { const Q = seatLegs(newPose(), n); LEG_R[n] = LEG_BONES.map((b) => [0, 1, 2].map((k) => Q.r[B[b] * 3 + k])); }
const sitting = (lean = 4, legs = 'rest') => {
  const P = sitBody();
  zeroR(P, 'spine');
  seatLegs(P, legs);
  setR(P, 'pelvis', 0, 3 * DEG, -2 * DEG);
  setR(P, 'spine', lean * DEG, -3 * DEG, 2 * DEG);
  setR(P, 'chest', 0, -2 * DEG, -1.5 * DEG);
  return P;
};
// Hands on the lap, looking about the room.
function sitRestPose(p) {
  const P = sitting(-4), s = Math.sin(TAU * p);
  // the left hand in the lap, the right forearm along its thigh
  armTo(P, 'L', 'lapL'); armTo(P, 'R', 'lapR', 'leanR', 0.45);
  setR(P, 'chest', 1.5 * DEG * Math.cos(TAU * p * 2), 0, 0);
  setR(P, 'neck', 0, 6 * DEG * s, 0);
  setR(P, 'head', (5 + 2 * Math.sin(2 * TAU * p)) * DEG, 14 * DEG * s, 0);
  return P;
}
// Hands together, thumbs going, a heel tapping.
function sitClaspPose(p) {
  const P = sitting(-1), tap = Math.max(0, Math.sin(p * TAU * 9)), th = Math.sin(p * TAU * 13);
  armTo(P, 'L', 'claspL'); armTo(P, 'R', 'claspR');
  setR(P, 'handL', 2 * DEG * th, 0, 0); setR(P, 'handR', -2 * DEG * th, 0, 0);
  setR(P, 'footR', 7 * DEG * tap, 0, 0);
  setR(P, 'head', 4 * DEG, 10 * DEG * Math.sin(TAU * p), 0);
  return P;
}
// Forward, forearms on the thighs, head up.
function sitLeanPose(p) {
  const P = sitting(26);
  armTo(P, 'L', 'leanL'); armTo(P, 'R', 'leanR');
  setR(P, 'neck', -10 * DEG, 0, 0);
  setR(P, 'head', -8 * DEG, 12 * DEG * Math.sin(TAU * p), 0);
  return P;
}
// Back in the seat, looking at the ceiling.
function sitBackPose(p) {
  const P = sitting(-5), k = held(p, 0.15, 0.6);
  armTo(P, 'L', 'lapL'); armTo(P, 'R', 'lapR');
  setR(P, 'chest', -2 * DEG, 0, 0);
  setR(P, 'head', (4 - 16 * k) * DEG, 7 * DEG * Math.sin(TAU * p), 0);
  return P;
}
// Sprawled: slid down and well back, both legs out long, the right arm along the seat back and the left hand on
// the belly, the head tipped a little to one side and looking about.
function sitSprawlPose(p) {
  const P = sitting(-14, 'sprawl'), s = Math.sin(TAU * p);
  setR(P, 'chest', -5 * DEG, 4 * DEG * s, 0);
  arm(P, 'R', 88, 30, -1.15, -62, 4, 14); onBelly(P, 'L');
  setR(P, 'neck', 4 * DEG, 0, 0);
  setR(P, 'head', (3 + 2 * Math.sin(2 * TAU * p)) * DEG, 16 * DEG * s, 6 * DEG);
  return P;
}
// Slouched on a stool with his back to a bar: leant well back, the elbows hooked over the bar top behind,
// the forearms along it, loose in the shoulders, the head lolling a little and coming back.
function sitBarPose(p) {
  const P = sitting(-18), s = Math.sin(TAU * p);
  setR(P, 'chest', -8 * DEG, 5 * DEG * s, 0);
  arm(P, 'R', 88, 30, -1.15, -62, 4, 14); arm(P, 'L', 80, -36, 1.05, -70, 8, -10);
  setR(P, 'neck', 6 * DEG, 0, 0);
  setR(P, 'head', (4 + 3 * Math.sin(2 * TAU * p)) * DEG, 14 * DEG * s, 3 * DEG * s);
  return P;
}
// Three sheets to the wind on a barstool, side-on to the bar: leaning into it, the right elbow out on the bar top
// with the forearm along it and the hand hanging loose off the end, the left hand with a cigarette at the chest and
// up to the mouth now and then (smokePose's right hand, mirrored), the head lolling, and everything going round in a
// slow drunken circle that the chest and head each follow a beat late.
function sitBarSmokePose(p) {
  const P = sitting(3), s = Math.sin(TAU * p), c = Math.cos(TAU * p), s2 = Math.sin(TAU * p * 2 + 0.8);
  setR(P, 'spine', (2 + 2 * c) * DEG, 5 * DEG, (-8 + 3 * s) * DEG);
  setR(P, 'chest', (-2 + 2 * s2) * DEG, (7 + 2 * c) * DEG, (-4 + 2 * Math.sin(TAU * p - 0.6)) * DEG);
  arm(P, 'R', -14 + 3 * s, 28, -0.66 - 0.04 * c, -76 + 4 * s, 22, 10);
  const lift = smooth(0.30, 0.40, p) * (1 - smooth(0.52, 0.62, p)), mix = (a, b) => a + (b - a) * lift;
  for (const b of ['uarmL', 'farmL', 'handL']) zeroR(P, b);
  setR(P, 'uarmL', mix(-16.0, -44.0) * DEG, -mix(30.2, 58.0) * DEG, -mix(0.010, 0.46));
  setR(P, 'farmL', mix(-104.6, -118.0) * DEG, 0, 0);
  setR(P, 'handL', mix(-20, -27.4) * DEG, 0, -6 * DEG);
  setR(P, 'neck', 6 * DEG, 0, -4 * DEG * Math.sin(TAU * p - 1.1));
  setR(P, 'head', (7 + 4 * s2 - 8 * lift) * DEG, (-12 + 9 * Math.sin(TAU * p - 1.6)) * DEG, 7 * DEG * Math.sin(TAU * p - 1.3));
  return P;
}
// Arms folded.
function sitFoldPose(p) {
  const P = sitting(2), W = waitPose(p);
  for (const b of ['uarmR', 'farmR', 'handR', 'uarmL', 'farmL', 'handL']) { const i = B[b] * 3; P.r[i] = W.r[i]; P.r[i + 1] = W.r[i + 1]; P.r[i + 2] = W.r[i + 2]; }
  setR(P, 'head', 3 * DEG, 12 * DEG * Math.sin(TAU * p), 0);
  return P;
}
// One leg crossed over the other at the knee, the hands stacked on the top knee, sat back and looking about. A man's
// twin has the ankle up on the knee instead (SEAT_WIDE).
function sitCrossPose(p) {
  const P = sitting(-6, 'crossL'), s = Math.sin(TAU * p);
  setR(P, 'pelvis', 0, 4 * DEG, -3 * DEG);
  armTo(P, 'L', 'lapL', 'claspL', 0.6); armTo(P, 'R', 'lapR', 'claspR', 0.6);
  setR(P, 'uarmL', -6 * DEG, 0, 0); setR(P, 'uarmR', -10 * DEG, 0, 0);
  setR(P, 'footL', 6 * DEG * Math.max(0, Math.sin(TAU * p * 6)), 0, 0);
  setR(P, 'neck', 0, 5 * DEG * s, 0);
  setR(P, 'head', (3 + 2 * Math.sin(2 * TAU * p)) * DEG, 15 * DEG * s, 0);
  return P;
}
const sitCrossRPose = (p) => { const P = mirrored(sitCrossPose(p)); P.legs = 'crossR'; return P; };
// Legs out long, crossed at the ankle, sat well back with the hands folded on the belly.
function sitAnklesPose(p) {
  const P = sitting(-10, 'ankles'), s = Math.sin(TAU * p);
  onBelly(P, 'L'); onBelly(P, 'R');
  setR(P, 'chest', (-3 + 1.5 * Math.cos(TAU * p * 2)) * DEG, 0, 0);
  setR(P, 'head', (2 + 3 * held(p, 0.3, 0.55)) * DEG, 12 * DEG * s, 0);
  return P;
}
// Feet drawn back under the seat, leaning in with the forearms on the knees and the hands loose between them.
function sitTuckPose(p) {
  const P = sitting(20, 'tuck'), s = Math.sin(TAU * p);
  armTo(P, 'L', 'leanL'); armTo(P, 'R', 'leanR');
  setR(P, 'handL', 0, 0, 4 * DEG * s); setR(P, 'handR', 0, 0, -4 * DEG * s);
  setR(P, 'neck', -8 * DEG, 0, 0);
  setR(P, 'head', -6 * DEG, 14 * DEG * s, 0);
  return P;
}

// ── Seated side by side. Two people on one piece talk, laugh, show each other a phone, nudge each other: gl/room-people.js
// pairs them (pairPlan) and gives each its half on the same slot of the clock. Each clip is built with the other
// person on their left and mirrored for the right ('…L' and '…R'). Nothing reaches across to the other body: they
// turn, lean and look, which never puts a hand through somebody. ──
// turned toward the left by `k` of a conversational turn, from the hips up
function turnLeft(P, k) {
  setR(P, 'pelvis', 0, 6 * DEG * k, 0);
  setR(P, 'spine', 0, 10 * DEG * k, 2 * DEG * k);
  setR(P, 'chest', 0, 10 * DEG * k, 0);
  setR(P, 'neck', 0, 14 * DEG * k, 0);
  setR(P, 'head', 0, 18 * DEG * k, -3 * DEG * k);
}
// Talking: turned to them, the right hand making the point, the head going with it.
function sitChatPose(p) {
  const P = sitting(4), s = Math.sin(TAU * p * 3), beat = Math.max(0, Math.sin(TAU * p * 5)), on = held(p, 0.08, 0.86);
  turnLeft(P, 1);
  armTo(P, 'L', 'lapL');
  armTo(P, 'R', 'lapR', 'leanR', 0.3);
  setR(P, 'uarmR', -26 * DEG * on, 20 * DEG * on, -0.15 * on);
  setR(P, 'farmR', (-30 - 12 * beat) * DEG * on, 0, 0);
  setR(P, 'handR', -10 * DEG * on, 0, 14 * DEG * s * on);
  setR(P, 'head', (2 - 4 * beat * on) * DEG, 4 * DEG * s, 0);
  return P;
}
// Listening: turned to them, hands together, a nod now and then.
function sitListenPose(p) {
  const P = sitting(6), nod = bump(p, 0.3, 0.03) + bump(p, 0.62, 0.03) + 0.6 * bump(p, 0.82, 0.025);
  turnLeft(P, 0.85);
  armTo(P, 'L', 'claspL'); armTo(P, 'R', 'claspR');
  setR(P, 'neck', 6 * DEG * nod, 0, 0);
  setR(P, 'head', (4 + 10 * nod) * DEG, 0, 0);
  return P;
}
// Both laughing: turned in, rocking back on the laugh, a hand to the chest.
function sitLaughPairPose(p) {
  const P = sitting(2), laugh = held(p, 0.15, 0.6), shake = Math.sin(TAU * p * 14) * laugh;
  turnLeft(P, 0.7 - 0.3 * laugh);
  setR(P, 'spine', (-6 * laugh + 2 * shake) * DEG, 0, 0);
  setR(P, 'chest', (-4 * laugh + 1.5 * shake) * DEG, 0, 0);
  armTo(P, 'L', 'lapL'); armTo(P, 'R', 'lapR', 'collarR', 0.7 * laugh);
  setR(P, 'head', (-10 * laugh + 2 * shake) * DEG, 0, 0);
  return P;
}
const LAUGH_FACE = (p) => { const l = held(p, 0.15, 0.6); return { open: 0.3 * l, round: 0.1 }; };
// Showing them something on the phone: it held out low toward them, glancing from it to their face.
function sitShowPhonePose(p) {
  const P = takeArms(sitting(10), phonePose(p)), look = held(p, 0.45, 0.7);
  turnLeft(P, 0.6);
  setR(P, 'uarmR', -8 * DEG, 16 * DEG, -0.1); setR(P, 'uarmL', -6 * DEG, 12 * DEG, -0.08);
  setR(P, 'head', -14 * DEG * look, 10 * DEG * look, 0);
  return P;
}
// Leaning over to look at it: turned and bent toward them, eyes down on their hands.
function sitLookPhonePose(p) {
  const P = sitting(16), k = held(p, 0.05, 0.9);
  turnLeft(P, 1);
  setR(P, 'spine', 0, 0, 7 * DEG * k);
  armTo(P, 'L', 'lapL'); armTo(P, 'R', 'leanR');
  setR(P, 'neck', 8 * DEG * k, 0, 0);
  setR(P, 'head', 16 * DEG * k, 6 * DEG * k, 0);
  return P;
}
// A nudge: leaning in and bumping them with the shoulder, then back, grinning.
function sitNudgePose(p) {
  const P = sitting(4), bumpK = bump(p, 0.32, 0.05), back = held(p, 0.4, 0.8);
  turnLeft(P, 0.5);
  setR(P, 'spine', 0, 0, 12 * DEG * bumpK);
  setR(P, 'chest', 0, 0, 5 * DEG * bumpK);
  armTo(P, 'L', 'lapL'); armTo(P, 'R', 'lapR');
  setR(P, 'head', (-4 * back) * DEG, 8 * DEG * back, -6 * DEG * bumpK);
  return P;
}
// Nudged: knocked a little away on the bump and turning back to them with a look.
function sitNudgedPose(p) {
  const P = sitting(4), hit = bump(p, 0.34, 0.05), look = held(p, 0.4, 0.85);
  turnLeft(P, 0.3 + 0.6 * look);
  setR(P, 'spine', 0, 0, -9 * DEG * hit);
  setR(P, 'chest', 0, 0, -4 * DEG * hit);
  armTo(P, 'L', 'claspL'); armTo(P, 'R', 'claspR');
  setR(P, 'head', -3 * DEG * look, 0, 5 * DEG * hit);
  return P;
}
// the same clip for the other one on their right
// The body and head are mirrored; the arms are left as they were, so what's in the right hand stays in the right
// hand (gl/figure-reach.js holds it there) and is held out to whoever's on that side the same. The legs go back to
// the set as it is: mirrored, they'd not match the angles a man's twin swaps from.
const ARM_BONES = ['uarmR', 'farmR', 'handR', 'uarmL', 'farmL', 'handL'];
const toRight = (fn) => (p) => { const Q = fn(p); return seatLegs(takeArms(mirrored(Q), Q, ARM_BONES), Q.legs || 'rest'); };
// ── At home on a sofa or an armchair. What's in the hand is gl/figure-reach.js CLIP_HANDS's, drawn by gl/room-held.js. ──
// A mug of something hot in both hands on the lap, blown on and sipped twice a cycle.
function sitMugPose(p) {
  const P = sitting(-4, 'ankles'), lift = held(p, 0.18, 0.36) + held(p, 0.62, 0.78);
  armTo(P, 'L', 'lapL', 'claspL', 0.7);
  armTo(P, 'R', 'claspR');
  handToMouth(P, lift);
  setR(P, 'head', (-6 * lift + 3) * DEG, 10 * DEG * Math.sin(TAU * p) * (1 - lift), 0);
  return P;
}
// A can on the knee, sat back, a swig now and then, the head going back for it.
function sitCanPose(p) {
  const P = sitting(-8), lift = held(p, 0.3, 0.46);
  armTo(P, 'L', 'lapL');
  armTo(P, 'R', 'lapR', 'leanR', 0.5);
  handToMouth(P, lift);
  setR(P, 'handR', -18 * DEG * lift, 0, 6 * DEG);
  setR(P, 'head', (-12 * lift + 3) * DEG, 12 * DEG * Math.sin(TAU * p) * (1 - lift), 0);
  return P;
}
// A paperback open in the left hand, the legs crossed, a page turned with the right once a cycle.
function sitBookPose(p) {
  const P = sitting(6, 'crossL'), turn = bump(p, 0.62, 0.04);
  armTo(P, 'L', 'lapL', 'leanL', 0.4);
  setR(P, 'uarmL', -24 * DEG, 0, 0); setR(P, 'farmL', -24 * DEG, 0, 0);
  armTo(P, 'R', 'lapR', 'claspR', 0.4 + 0.6 * turn);
  setR(P, 'uarmR', -18 * DEG * turn, 0, 0);
  setR(P, 'neck', 8 * DEG, 0, 0); setR(P, 'head', (16 + 2 * Math.sin(TAU * p * 3)) * DEG, -6 * DEG, 0);
  return P;
}
// Flicking through the channels: the remote pointed at the set, a press every couple of seconds, sat well back.
function sitRemotePose(p) {
  const P = sitting(-10, 'sprawl'), press = Math.max(0, Math.sin(TAU * p * 4)) ** 6, up = held(p, 0.1, 0.85);
  armTo(P, 'L', 'lapL');
  armTo(P, 'R', 'lapR', 'leanR', 0.6);
  setR(P, 'uarmR', -30 * DEG * up, 8 * DEG * up, 0); setR(P, 'farmR', 30 * DEG * up, 0, 0);
  setR(P, 'handR', (-12 * up - 6 * press) * DEG, 0, 0);
  setR(P, 'head', -2 * DEG, 0, 0);
  return P;
}
// Playing a game: the pad in both hands, leaning in at the screen, thumbs going, a jolt when something happens.
// `mood` is +1 for a win, -1 for a loss, 0 for playing on.
const gamePose = (mood = 0, turn = 0) => (p) => {
  const P = sitting(mood < 0 ? -12 : 18, mood ? 'rest' : 'tuck'), th = Math.sin(TAU * p * 11), jolt = bump(p, 0.45, 0.03), end = held(p, 0.55, 0.9);
  if (turn) turnLeft(P, turn * end);
  armTo(P, 'L', 'leanL', 'claspL', 0.7); armTo(P, 'R', 'leanR', 'claspR', 0.7);
  setR(P, 'uarmL', -14 * DEG, 0, 0); setR(P, 'uarmR', -14 * DEG, 0, 0);
  setR(P, 'handL', 3 * DEG * th, 0, 0); setR(P, 'handR', -3 * DEG * th, 0, 0);
  setR(P, 'spine', -4 * DEG * jolt, 0, 0);
  if (mood > 0) { setR(P, 'uarmL', -70 * DEG * end, 0, 0.3 * end); setR(P, 'uarmR', -70 * DEG * end, 0, -0.3 * end); setR(P, 'head', -12 * DEG * end, 0, 0); }
  if (mood < 0) { setR(P, 'spine', -6 * DEG * end, 0, 0); setR(P, 'head', (-14 * end) * DEG, 0, 0); setR(P, 'neck', -6 * DEG * end, 0, 0); }
  setR(P, 'neck', -6 * DEG * (1 - end), 0, 0);
  return P;
};
// Lying back with the book held up over the face.
function lieBookPose(p) {
  const P = lieBackPose(p), turn = bump(p, 0.6, 0.04);
  setR(P, 'uarmL', 0, 0, 0); arm(P, 'L', -70, -10, 0.1, -70, -10);
  arm(P, 'R', -40 - 20 * turn, 20, -0.1, -80, -10);
  setR(P, 'head', 12 * DEG, 0, 0);
  return P;
}
// Side by side: a can raised to theirs, a clink, and a swig.
function sitCheersPose(p) {
  const P = sitting(4), up = held(p, 0.12, 0.42), clink = bump(p, 0.32, 0.025), drink = held(p, 0.55, 0.78);
  turnLeft(P, 0.8 * (1 - drink));
  armTo(P, 'L', 'lapL');
  armTo(P, 'R', 'lapR', 'leanR', 0.5);
  setR(P, 'uarmR', (-48 * up) * DEG, 26 * DEG * up, -0.25 * up); setR(P, 'farmR', (30 * up + 6 * clink) * DEG, 0, 0);
  handToMouth(P, drink);
  setR(P, 'head', (-10 * drink) * DEG, 0, 0);
  return P;
}
// Handing the remote over: held out to them, and let go of. The other takes it with the same move, so it reads as
// passed either way.
function sitPassRemotePose(p) {
  const P = sitting(8), out = held(p, 0.15, 0.55);
  turnLeft(P, 0.9);
  armTo(P, 'L', 'lapL');
  armTo(P, 'R', 'lapR', 'leanR', 0.4);
  setR(P, 'uarmR', -40 * DEG * out, 40 * DEG * out, -0.2 * out); setR(P, 'farmR', 40 * DEG * out, 0, 0);
  return P;
}
// What two seated people do together, as [one, the other, how often]; pairPlan swaps who's who each time.
// `home` ones only on a sofa or an armchair, where there's a set to watch and a game to play (pairsOf).
export const ACTOR_PAIR_ACTS = [['sitChat', 'sitListen', 4], ['sitLaughPair', 'sitLaughPair', 1.5], ['sitShowPhone', 'sitLookPhone', 1.5], ['sitNudge', 'sitNudged', 0.8],
  ['sitCheers', 'sitCheers', 1, 'home'], ['sitGamePair', 'sitGamePair', 1.5, 'home'], ['sitGameWin', 'sitGameLose', 1, 'home'], ['sitPassRemote', 'sitPassRemote', 0.6, 'home']];
// One pose's arms, neck and head on another's body: a standing clip's hands on a seated or lying body.
const UPPER_BONES = ['uarmR', 'farmR', 'handR', 'uarmL', 'farmL', 'handL', 'neck', 'head'];
function takeArms(P, Q, bones = UPPER_BONES) {
  for (const b of bones) { const i = B[b] * 3; P.r[i] = Q.r[i]; P.r[i + 1] = Q.r[i + 1]; P.r[i + 2] = Q.r[i + 2]; }
  return P;
}
// An arm set straight from its angles, as ARM_AT holds them: [flexion deg, twist deg, abduction rad, elbow deg, wrist deg].
function arm(P, side, f, tw, ab, el, wr = -8, wz = 0) {
  zeroR(P, 'uarm' + side); zeroR(P, 'farm' + side); zeroR(P, 'hand' + side);
  setR(P, 'uarm' + side, f * DEG, tw * DEG, ab); setR(P, 'farm' + side, el * DEG, 0, 0); setR(P, 'hand' + side, wr * DEG, 0, wz * DEG);
}
// The hands loosely on the belly, as listenPose holds them at the belt.
function onBelly(P, side) { if (side === 'R') arm(P, 'R', -10.4, 59.7, -0.171, -68.5, -10); else arm(P, 'L', -15.2, -64.4, 0.168, -63.3, -10); }

// ── Seated, doing something. ──
function sitPhonePose(p) { return takeArms(sitting(8), phonePose(p)); }
// A tablet or a paper low on the lap, the head down to it, and a page turned once a cycle.
function sitReadPose(p) {
  const P = takeArms(sitting(10), phonePose(p)), turn = bump(p, 0.55, 0.04);
  setR(P, 'farmR', 14 * DEG, 0, 0); setR(P, 'farmL', 14 * DEG, 0, 0);
  setR(P, 'uarmR', 0, -22 * DEG * turn, -0.12 * turn);
  setR(P, 'head', 8 * DEG, 0, 0);
  return P;
}
// A drink in the right hand, on the thigh between two sips.
function sitDrinkPose(p) {
  const P = sitting(4), lift = smooth(0.14, 0.24, p) * (1 - smooth(0.34, 0.44, p)) + smooth(0.64, 0.74, p) * (1 - smooth(0.84, 0.94, p));
  armTo(P, 'L', 'lapL');
  handToMouth(P, lift);
  setR(P, 'handR', -16 * DEG * lift, 0, 6 * DEG);
  setR(P, 'head', (-10 * lift + 4) * DEG, 8 * DEG * Math.sin(TAU * p) * (1 - lift), 0);
  return P;
}
// At a wheel: sat up, both hands forward on the rim, the head steady, the wheel worked a little.
function sitDrivePose(p) {
  const P = sitting(6), s = Math.sin(TAU * p);
  arm(P, 'R', -62 + 4 * s, 18, -0.12, -38 - 4 * s, -10);
  arm(P, 'L', -62 - 4 * s, -18, 0.12, -38 + 4 * s, -10);
  setR(P, 'head', 2 * DEG, 5 * DEG * Math.sin(TAU * p * 2), 0);
  return P;
}
// At the wheel with the right hand on it and the left up, waving: the hitcher's wave, mirrored.
function sitDriveWavePose(p) {
  const P = sitDrivePose(0), w = Math.sin(2 * TAU * p);
  zeroR(P, 'uarmL'); zeroR(P, 'farmL'); zeroR(P, 'handL');
  setR(P, 'uarmL', -0.30, 0, 2.25);
  setR(P, 'farmL', 0, 0, 0.85 - 0.40 * w);
  setR(P, 'handL', 0, 0, -0.15 * w);
  setR(P, 'head', -2 * DEG, 0, 8 * DEG);
  return P;
}
function sitSmokePose(p) {
  const P = sitting(2), lift = smooth(0.10, 0.24, p) * (1 - smooth(0.40, 0.54, p)), out = bump(p, 0.62, 0.06);
  armTo(P, 'L', 'lapL');
  handToMouth(P, lift);
  setR(P, 'head', (2 - 3 * lift - 9 * out) * DEG, 8 * DEG * Math.sin(TAU * p + 1.4) * (1 - lift), 0);
  return P;
}
// ── At a table with a habit (client/shared/table-stash.js, gl/room-stash.js draws the kit). Each starts from a
// chair pulled up to a top about 0.3 m over the seat, the forearms out over it and the head down to the work.
// `ra` and `la` nudge each arm off the rest: [flexion deg, twist deg, elbow deg].
function atTable(lean = 14, ra = [0, 0, 0], la = [0, 0, 0]) {
  const P = sitting(lean);
  arm(P, 'R', -50 + ra[0], 22 + ra[1], -0.1, -62 + ra[2], -8, -4);
  arm(P, 'L', -48 + la[0], -24 + la[1], 0.1, -60 + la[2], -8, 4);
  return P;
}
// Cutting lines with a card: the right hand chopping quick and small, the left steadying the mirror, head down.
function sitCutPose(p) {
  const ch = Math.sin(14 * TAU * p), sw = Math.sin(2 * TAU * p);
  const P = atTable(18, [3 * ch, 6 * sw, 4 * ch], [0, 0, 0]);
  setR(P, 'handR', (-14 + 10 * ch) * DEG, 0, -4 * DEG);
  setR(P, 'neck', 16 * DEG, 0, 0);
  setR(P, 'head', (22 + 2 * bump(p, 0.5, 0.05)) * DEG, -6 * DEG, 0);
  return P;
}
// A line off the table: down to it with the note in the right hand and the left holding the other nostril,
// one long pull along it, then up hard, the head back, eyes shut, and a pinch and a sniff.
function sitLinePose(p) {
  const down = smooth(0.06, 0.22, p) * (1 - smooth(0.46, 0.56, p)), pull = smooth(0.24, 0.44, p) * (1 - smooth(0.46, 0.5, p));
  const back = smooth(0.48, 0.56, p) * (1 - smooth(0.78, 0.95, p)), pinch = smooth(0.56, 0.64, p) * (1 - smooth(0.8, 0.92, p));
  const P = atTable(14 + 28 * down - 10 * back, [-18 * down + 10 * pull, 0, -30 * down], [0, 0, 0]);
  setR(P, 'handR', (-20 - 10 * down) * DEG, 0, 6 * DEG * pull);
  // the left hand up to the face while they're down; after, to the nose
  const k = Math.max(down, pinch);
  setR(P, 'uarmL', (-38 - 40 * k) * DEG, (-26 - 40 * k) * DEG, 0.1 - 0.5 * k);
  setR(P, 'farmL', (-72 - 40 * k) * DEG, 0, 0);
  setR(P, 'chest', (10 * down - 6 * back) * DEG, 0, 0);
  setR(P, 'neck', (22 * down - 14 * back) * DEG, 0, 0);
  setR(P, 'head', (26 * down - 22 * back) * DEG, 4 * DEG * back * Math.sin(6 * TAU * p), 4 * DEG * back);
  return P;
}
// Sorting pills on the table with one finger, the other hand flat, slow, head down.
function sitSortPose(p) {
  const s = Math.sin(3 * TAU * p);
  const P = atTable(16, [4 * s, 8 * Math.cos(3 * TAU * p), 6 * s], [0, 0, 0]);
  setR(P, 'neck', 12 * DEG, 0, 0);
  setR(P, 'head', 18 * DEG, -4 * DEG * s, 0);
  return P;
}
// One off the dish: a reach to the table, the hand to the mouth, the head back to get it down, then the
// glass to the mouth and a swallow.
function sitPillPose(p) {
  const reach = smooth(0.04, 0.16, p) * (1 - smooth(0.2, 0.3, p));
  const pill = smooth(0.24, 0.34, p) * (1 - smooth(0.42, 0.5, p)), tip = smooth(0.34, 0.42, p) * (1 - smooth(0.5, 0.6, p));
  const glass = smooth(0.58, 0.68, p) * (1 - smooth(0.82, 0.92, p)), gulp = smooth(0.66, 0.72, p) * (1 - smooth(0.8, 0.86, p));
  const P = sitting(6 + 10 * reach);
  armTo(P, 'L', 'lapL', 'leanL', 0.4);
  if (reach > 0.01) arm(P, 'R', -40 * reach - 16, 24, -0.1, -74 * reach - 30 * (1 - reach), -8);
  else handToMouth(P, Math.max(pill, glass));
  setR(P, 'neck', (-8 * tip - 8 * gulp + 8 * reach) * DEG, 0, 0);
  setR(P, 'head', (-18 * tip - 16 * gulp + 14 * reach + 3) * DEG, 0, 0);
  return P;
}
// Packing a pipe: both hands close together over the table, the right thumb working at the bowl.
function sitPackPose(p) {
  const w = Math.sin(8 * TAU * p);
  const P = atTable(16, [-6, -10, -10 + 4 * w], [-6, 12, -12]);
  setR(P, 'handR', (-20 + 8 * w) * DEG, 0, 0);
  setR(P, 'neck', 14 * DEG, 0, 0);
  setR(P, 'head', 20 * DEG, 0, 0);
  return P;
}
// The pipe: right hand to the mouth with it, the left cupping a lighter under the bowl, a long pull with the
// chest filling, held, and the head going back to let it out.
function sitPipePose(p) {
  const lift = smooth(0.06, 0.18, p) * (1 - smooth(0.6, 0.72, p)), pull = smooth(0.2, 0.5, p) * (1 - smooth(0.55, 0.62, p));
  const out = smooth(0.62, 0.7, p) * (1 - smooth(0.84, 0.98, p));
  const P = sitting(4);
  handToMouth(P, lift);
  armTo(P, 'L', 'lapL', 'cupL', lift * (1 - smooth(0.5, 0.58, p)));
  setR(P, 'chest', (-5 * pull - 3 * out) * DEG, 0, 0);
  setR(P, 'neck', (6 * lift - 10 * out) * DEG, 0, 0);
  setR(P, 'head', (8 * lift - 22 * out) * DEG, 0, 0);
  return P;
}
// Cooking it up: the spoon in the left hand a little off the table, the lighter in the right under it, still.
function sitCookPose(p) {
  const f = Math.sin(23 * TAU * p) * 0.6;
  const P = atTable(16, [-4, -14, -14 + f], [-10, 10, -16]);
  setR(P, 'handL', -4 * DEG, 0, 0);
  setR(P, 'neck', 14 * DEG, 0, 0);
  setR(P, 'head', 22 * DEG, 4 * DEG, 0);
  return P;
}
// Shaking a can before the rag: the right fist going up and down by the chest.
function sitShakePose(p) {
  const s = Math.sin(10 * TAU * p);
  const P = sitting(6);
  armTo(P, 'L', 'lapL');
  arm(P, 'R', -30 + 8 * s, 30, -0.1, -96 + 10 * s, -10);
  setR(P, 'head', 6 * DEG, 8 * DEG, 0);
  return P;
}
// Pouring: the right hand out over the table, the wrist turning the bottle over the glass, and back.
function sitPourPose(p) {
  const tip = smooth(0.2, 0.36, p) * (1 - smooth(0.6, 0.76, p));
  const P = atTable(12, [-6, 0, -10], [0, 0, 0]);
  setR(P, 'handR', -10 * DEG, 0, -50 * DEG * tip);
  setR(P, 'neck', 10 * DEG, 0, 0);
  setR(P, 'head', 16 * DEG, 0, 0);
  return P;
}
// Asleep in the chair: the head dropping forward, and once a cycle it jerks up and goes down again.
function sitDozePose(p) {
  const P = sitting(10), jerk = smooth(0.7, 0.73, p) * (1 - smooth(0.76, 0.9, p)), b = Math.sin(2 * TAU * p);
  armTo(P, 'L', 'lapL'); armTo(P, 'R', 'lapR');
  setR(P, 'chest', 3 * DEG + 1.5 * DEG * b, 0, 0);
  setR(P, 'neck', (24 - 22 * jerk) * DEG, 0, 4 * DEG);
  setR(P, 'head', (20 - 18 * jerk) * DEG, 6 * DEG * jerk, 5 * DEG * (1 - jerk));
  return P;
}
// Out cold in the chair: slid down and over to one side, the arms hanging and the head on the shoulder.
function sitSlumpPose(p) {
  const P = sitting(-14), b = Math.sin(2 * TAU * p);
  setR(P, 'spine', 0, 0, 6 * DEG); setR(P, 'chest', 2 * DEG * b, 0, 8 * DEG);
  arm(P, 'L', -14, 0, 0.18, -18, -10); arm(P, 'R', -6, 0, -0.1, -10, -10);
  setR(P, 'neck', 14 * DEG, 0, 14 * DEG); setR(P, 'head', 16 * DEG, -10 * DEG, 14 * DEG);
  return P;
}

// ── Lying down. Each is posed upright, as if stood against the bed, and laid on its back by gl/room-people.js
// placeOf, the front to the ceiling; the ones on their side roll over in the pose (onSide). A pillow lifts the
// head, and the feet fall a little apart and point. ──
function lying(p, breaths = 2) {
  const P = newPose(), b = Math.sin(breaths * TAU * p);
  for (const s of ['L', 'R']) {
    setR(P, 'thigh' + s, -4 * DEG, 0, (s === 'L' ? 3 : -3) * DEG);
    setR(P, 'shin' + s, 6 * DEG, 0, 0);
    setR(P, 'foot' + s, 24 * DEG, 0, 0);
  }
  arm(P, 'L', -2, 0, 0.12, -10, -6); arm(P, 'R', -2, 0, -0.12, -10, -6);
  setR(P, 'chest', -2 * DEG * b, 0, 0);
  setR(P, 'head', 14 * DEG, 0, 0);
  return P;
}
// Rolled onto the side, the left side up: a quarter turn of the whole body about its length, and the middle a
// little higher off the bed. In the pose, not in the placing, so turning over blends like any other move.
// The top leg comes down onto the bottom one, knee on knee and ankle on ankle: `drop` degrees in at the hip and
// `turn` degrees of twist to bring the foot back up (more bent knees need more of both; measured, each pose's
// own). The bottom leg loses lying's splay, so it lies along the bed.
function onSide(P, drop = 18, turn = 18) {
  setR(P, 'pelvis', 0, -Math.PI / 2, 0); P.root[2] += 0.06;
  setR(P, 'thighL', 0, -turn * DEG, -drop * DEG); setR(P, 'thighR', 0, 0, 3 * DEG);
  return P;
}
// Awake on the back, hands on the belly, a knee coming up now and then, looking about.
function lieBackPose(p) {
  const P = lying(p), k = held(p, 0.2, 0.6), look = Math.sin(TAU * p);
  onBelly(P, 'L'); onBelly(P, 'R');
  setR(P, 'thighL', -38 * DEG * k, 0, 0); setR(P, 'shinL', 72 * DEG * k, 0, 0);
  setR(P, 'neck', 0, 10 * DEG * look, 0); setR(P, 'head', 0, 16 * DEG * look, 0);
  return P;
}
// An arm over the eyes.
function lieArmPose(p) {
  const P = lying(p);
  onBelly(P, 'L');
  arm(P, 'R', -112, 68.8, 0.56, -118.8, -20);
  setR(P, 'thighR', -30 * DEG, 0, 0); setR(P, 'shinR', 58 * DEG, 0, 0);
  return P;
}
// A phone held up over the face, a thumb going.
function liePhonePose(p) {
  const P = lying(p), th = Math.sin(TAU * p * 9);
  arm(P, 'R', -74, 24, -0.04, -64, -12 + 4 * th, 8); arm(P, 'L', -72, -22, 0.04, -62, -12, -8);
  setR(P, 'head', -6 * DEG, 0, 0);
  return P;
}
// On a press bench, pressing (plugins/weightbench `lift`): four reps a cycle, each lowered slow to the chest with the
// elbows flared, a breath at the bottom and driven back up to lockout, the last one a grind. The feet are planted off the
// pad's end, knees bent over them; the head flat, the eyes on the bar. gl/room-held.js draws the bar between the palms.
function liePressPose(p) {
  const P = lying(p, 4), reps = 4, q = (p * reps) % 1, last = p * reps >= reps - 1;
  // 0 at lockout, 1 with the bar on the chest: down over 45% of the rep, a beat there, up over 30% (slower on the last)
  const up = last ? 0.45 : 0.3, e = q < 0.45 ? smooth(0, 0.45, q) : q < 0.55 ? 1 : 1 - smooth(0.55, 0.55 + up, q);
  const lerp = (a, b) => a + (b - a) * e;
  arm(P, 'L', lerp(-88, -22), lerp(4, 0), lerp(0.28, 1.15), lerp(-6, -100), -4);
  arm(P, 'R', lerp(-88, -22), lerp(-4, 0), lerp(-0.28, -1.15), lerp(-6, -100), -4);
  for (const s of ['L', 'R']) { setR(P, 'thigh' + s, -14 * DEG, 0, (s === 'L' ? 14 : -14) * DEG); setR(P, 'shin' + s, 88 * DEG, 0, 0); setR(P, 'foot' + s, -6 * DEG, 0, 0); }
  // the chest lifts into the drive, the head stays down
  setR(P, 'chest', -5 * DEG * (1 - e), 0, 0); setR(P, 'head', 4 * DEG, 0, 0);
  return P;
}
// On the side, awake: the knees drawn up a little, the lower arm under the head and the other on the bed.
function lieSidePose(p) {
  const P = lying(p);
  for (const [s, f, k] of [['L', -34, 44], ['R', -42, 58]]) { setR(P, 'thigh' + s, f * DEG, 0, 0); setR(P, 'shin' + s, k * DEG, 0, 0); }
  setR(P, 'spine', 8 * DEG, 0, 0);
  arm(P, 'R', -98, 40, 0.05, -122, -10); arm(P, 'L', -36, -20, -0.12, -42, -6);
  setR(P, 'head', -8 * DEG, 10 * DEG * Math.sin(TAU * p), 0);
  return onSide(P);
}
// Asleep on the side, curled, both hands up by the face. Slower breaths.
function sleepSidePose(p) {
  const P = lying(p, 2);
  for (const [s, f, k] of [['L', -60, 88], ['R', -70, 98]]) { setR(P, 'thigh' + s, f * DEG, 0, 0); setR(P, 'shin' + s, k * DEG, 0, 0); }
  setR(P, 'spine', 16 * DEG, 0, 0); setR(P, 'chest', 6 * DEG, 0, 0);
  arm(P, 'R', -84, 40, 0.02, -126, -16); arm(P, 'L', -70, -40, -0.06, -118, -12);
  setR(P, 'head', 2 * DEG, 0, 0);
  return onSide(P, 27, 18);
}
// Asleep on the back, the head turned on the pillow and the mouth open.
function sleepBackPose(p) {
  const P = lying(p, 2);
  onBelly(P, 'R');
  setR(P, 'thighL', -10 * DEG, 0, 8 * DEG); setR(P, 'shinL', 20 * DEG, 0, 0);
  setR(P, 'neck', 0, 12 * DEG, 0); setR(P, 'head', 0, 20 * DEG, 6 * DEG);
  return P;
}
// Passed out where they fell: an arm flung out, a knee fallen sideways, the head rolled over.
function sprawlPose(p) {
  const P = lying(p, 2);
  arm(P, 'R', -10, 0, -1.35, -24, 4); onBelly(P, 'L');
  setR(P, 'thighL', -36 * DEG, 0, 24 * DEG); setR(P, 'shinL', 68 * DEG, 0, 0);
  setR(P, 'neck', 0, 18 * DEG, 0); setR(P, 'head', -6 * DEG, 26 * DEG, 12 * DEG);
  return P;
}

// Sunbathing on a towel (plugins/beach): on the back, one arm over the eyes, a knee up that comes down and goes
// up again now and then, the other hand on the belly.
function sunbathePose(p) {
  const P = lying(p, 2), k = held(p, 0.15, 0.55);
  onBelly(P, 'L');
  arm(P, 'R', -112, 68.8, 0.56, -118.8, -20);
  setR(P, 'thighR', -34 * DEG * (0.4 + 0.6 * k), 0, 0); setR(P, 'shinR', 64 * DEG * (0.4 + 0.6 * k), 0, 0);
  // the chin a little down onto the chest, as on a towel: with the neck straight the back of it shows over the collar
  setR(P, 'head', 0, 8 * DEG, 0); setR(P, 'neck', 6 * DEG, 0, 0);
  setR(P, 'pelvis', -Math.PI / 2, 0, 0);   // on the back: a street clip lays itself down, nothing puts it on a bed
  return P;
}
// Breaststroke (plugins/beach), face down in the water: the arms reach forward together and sweep out and back,
// the legs draw up and kick out, the head lifts for a breath as the arms pull.
function swimPose(p) {
  const P = lying(p, 0), s = Math.sin(TAU * p), pull = 0.5 + 0.5 * s, kick = 0.5 - 0.5 * Math.cos(TAU * p);
  setR(P, 'pelvis', Math.PI / 2, 0, 0);   // flat on the front: a street clip lays itself down
  for (const side of ['L', 'R']) {
    const sg = side === 'L' ? -1 : 1;
    arm(P, side, -150 + 70 * pull, sg * (10 + 40 * pull), sg * (0.15 + 0.35 * pull), -20 - 70 * pull, -6);
    setR(P, 'thigh' + side, -40 * DEG * kick, 0, sg * -14 * DEG * kick);
    setR(P, 'shin' + side, 90 * DEG * kick, 0, 0);
  }
  setR(P, 'neck', -18 * DEG * pull, 0, 0); setR(P, 'head', -26 * DEG * pull, 0, 0);
  return P;
}

// ── On their feet, doing something: what an emote line says they're doing (client/shared/npc-acts.js),
// or the work they're at. There are no props: the hands do what they would with them. ──
// Wiping a counter: leant over it, the right hand going round in circles and the left flat on the top.
function wipePose(p) {
  const P = stance(p), c = Math.cos(3 * TAU * p), s = Math.sin(3 * TAU * p), up = bump(p, 0.8, 0.05);
  setR(P, 'spine', 8 * DEG, 0, 0); setR(P, 'chest', 10 * DEG, 0, 0);
  arm(P, 'R', -38 + 7 * c, 22 + 14 * s, -0.12, -48 + 8 * s, 10);
  arm(P, 'L', -32, -12, 0.1, -42, 12);
  setR(P, 'head', (18 - 20 * up) * DEG, 8 * DEG * up, 0);
  return P;
}
// A glass held up in the left hand, the cloth turning in it.
function polishPose(p) {
  const P = stance(p), tw = Math.sin(8 * TAU * p), up = bump(p, 0.7, 0.06);
  arm(P, 'L', -20, -30, 0.05, -96, -10);
  arm(P, 'R', -22, 40, -0.02, -88 + 6 * Math.sin(4 * TAU * p), -10, 25 * tw);
  setR(P, 'head', (20 - 16 * up) * DEG, 10 * DEG * up, 0);
  return P;
}
// ── Behind a bar. What a bartender does between customers and for them (ACTOR_IDLES.bar), and what an emote line
// says they're doing ("pours without being asked"). The bottle, the tin and the glass are gl/figure-reach.js's.
// A pour: the right hand down to the speed rail for the bottle, up over the glass the left hand steadies on the
// bar, a long pour with the bottle lifting as it goes, a snap upright, and the bottle back in the rail.
function pourPose(p) {
  const P = stance(p), up = held(p, 0.08, 0.8), tip = smooth(0.3, 0.4, p) * (1 - smooth(0.66, 0.74, p)), lift = bump(p, 0.52, 0.07);
  const dip = bump(p, 0.04, 0.035) + bump(p, 0.93, 0.035), steady = held(p, 0.2, 0.76);
  setR(P, 'spine', (6 + 8 * dip) * DEG, 0, 0); setR(P, 'chest', 4 * DEG, -6 * DEG * up, 0);
  arm(P, 'R', -10 - 38 * up - 18 * lift + 8 * dip, 20 * up, -0.1 - 0.08 * up, -18 - 40 * up + 10 * lift, -8, -80 * tip);
  arm(P, 'L', -12 - 38 * steady, -16 * steady, 0.07 + 0.03 * steady, -22 - 22 * steady, -10);
  setR(P, 'head', (8 + 14 * up) * DEG, -8 * DEG * up, 0);
  return P;
}
// Shaking a cocktail: the tin up by the right shoulder in both hands, shaken hard, then down over the bar to strain.
function shakeTinPose(p) {
  const P = stance(p), k = held(p, 0.06, 0.7), s = k * Math.sin(9 * TAU * p), strain = held(p, 0.8, 0.92) * (1 - k);
  arm(P, 'R', -20 - 80 * k - 30 * strain + 10 * s, 30 * k + 16 * strain, -0.14 - 0.24 * k, -40 - 78 * k - 20 * strain + 16 * s, -10, -60 * strain);
  arm(P, 'L', -20 - 78 * k - 24 * strain + 10 * s, -72 * k - 16 * strain, 0.02, -40 - 84 * k - 16 * strain + 16 * s, -14);
  setR(P, 'chest', 3 * DEG * s, 10 * DEG * k, 0); setR(P, 'head', (4 + 14 * strain) * DEG, -6 * DEG * k, 3 * DEG * s);
  return P;
}
// Pulling a pint: the right hand up to the tap's handle and drawing it down toward them, the left holding the glass
// tipped under the spout and levelling it as it fills.
function tapPullPose(p) {
  const P = stance(p), k = held(p, 0.08, 0.82), pull = smooth(0.24, 0.34, p) * (1 - smooth(0.7, 0.8, p)), fill = smooth(0.3, 0.75, p);
  setR(P, 'spine', 6 * DEG * k, 0, 0);
  arm(P, 'R', -12 - 70 * k + 18 * pull, 20 * k, -0.12, -14 - 40 * k - 40 * pull, -6 + 20 * pull);
  arm(P, 'L', -12 - 52 * k, -12 * k, 0.08, -20 - 22 * k, -8, 35 * k * (1 - fill));
  setR(P, 'head', (10 + 12 * k) * DEG, 0, 0);
  return P;
}
// A bottle held up against the light and turned, the head back to read how much is left in it.
function checkBottlePose(p) {
  const P = stance(p), k = held(p, 0.1, 0.78), turn = Math.sin(2 * TAU * p) * k;
  arm(P, 'R', -12 - 118 * k, 30 * k, -0.1 - 0.08 * k, -12 - 70 * k, -10, 30 * turn);
  armTo(P, 'L', 'hipL');
  setR(P, 'neck', -10 * DEG * k, 0, 0); setR(P, 'head', -16 * DEG * k, 10 * DEG * turn, 6 * DEG * k);
  return P;
}
// A drink sent down the bar: a lean and a reach along the top, a flick of the wrist, and the head after it.
function slideGlassPose(p) {
  const P = stance(p), reach = held(p, 0.08, 0.5), push = smooth(0.32, 0.42, p) * (1 - smooth(0.62, 0.8, p)), look = smooth(0.35, 0.5, p) * (1 - smooth(0.8, 0.95, p));
  setR(P, 'spine', (6 + 14 * reach) * DEG, 0, 0); setR(P, 'chest', 6 * DEG * reach, 18 * DEG * push, 0);
  arm(P, 'R', -20 - 50 * reach - 10 * push, 10 + 40 * push, -0.1 - 0.25 * push, -40 + 30 * reach + 10 * push, 10);
  arm(P, 'L', -18 - 30 * reach, -20, 0.08, -60, -8);
  setR(P, 'head', 14 * DEG * reach, 30 * DEG * look, 0);
  return P;
}
// At the hob: a hand stirring in small circles, the other on the pan's handle.
function stirPose(p) {
  const P = stance(p), c = Math.cos(4 * TAU * p), s = Math.sin(4 * TAU * p);
  setR(P, 'chest', 8 * DEG, 0, 0);
  arm(P, 'R', -32 + 5 * c, 20 + 10 * s, -0.1, -55, -4);
  arm(P, 'L', -28, -15, 0.12, -50, -6);
  setR(P, 'head', 22 * DEG, 0, 0);
  return P;
}
// Bent into a cupboard or a fridge, both hands going through it, and straight again.
function rummagePose(p) {
  const P = stance(p, false), k = held(p, 0.08, 0.78), w = Math.sin(5 * TAU * p);
  setR(P, 'spine', 22 * DEG * k, 0, 0); setR(P, 'chest', 12 * DEG * k, 0, 0);
  // bent over: the knees give and the hips go back over the heels to balance the lean
  plant(P, IDLE_FEET, { weight: 0.4, sink: 0.035 * k, dz: -0.04 * k });
  arm(P, 'R', -12 - 48 * k, 15 * k, -0.08, -14 - 16 * k + 10 * w * k, -6);
  arm(P, 'L', -12 - 44 * k, -15 * k, 0.08, -14 - 18 * k - 10 * w * k, -6);
  setR(P, 'head', 15 * DEG * k, 8 * DEG * w * k, 0);
  return P;
}
// AT THE FRIDGE (plugins/roomstage npc-life.js USE_STEPS 'cold'). The door's on the left hand: room-stage.js
// plays the '…R' mirror when its hinge is on their right. Opening: the left hand out to the handle, then
// carried out to the side as the door swings with it, and the first of the lean in.
function fridgeOpenPose(p) {
  const P = stance(p), k = smooth(0, 0.35, p), o = smooth(0.35, 0.9, p), lean = smooth(0.55, 1, p);
  arm(P, 'L', -12 - 52 * k + 4 * o, -6 * k + 16 * o, 0.08 + 0.04 * k + 0.34 * o, -12 - 42 * k + 26 * o, -10);
  setR(P, 'spine', 10 * DEG * lean, 0, 0); setR(P, 'chest', 4 * DEG * lean, 0, 0);
  setR(P, 'head', (6 + 10 * lean) * DEG, 0, 0);
  return P;
}
// Stood in the open door with a hand on its top, leant in from the hips, looking the shelves over top to bottom
// and side to side, the other hand going in after something halfway through and coming out again.
function fridgeLookPose(p) {
  const P = stance(p, false), scan = 0.5 + 0.5 * Math.sin(TAU * p - Math.PI / 2), side = Math.sin(2 * TAU * p);
  const k = held(p, 0.45, 0.72), w = Math.sin(6 * TAU * p) * k;
  setR(P, 'spine', 16 * DEG, 0, 0); setR(P, 'chest', 8 * DEG, 0, 0);
  plant(P, IDLE_FEET, { weight: 0.4, sink: 0.025, dz: -0.035 });
  arm(P, 'L', -56, 16, 0.42, -16, -12);
  arm(P, 'R', -10 - 58 * k, 14 * k, -0.08 - 0.02 * k, -14 - 12 * k + 8 * w, -6);
  setR(P, 'neck', (4 + 8 * scan) * DEG, 0, 0);
  setR(P, 'head', (4 + 18 * scan) * DEG, 12 * DEG * side * (1 - k), 0);
  return P;
}
// UNDER THE SHOWER: both hands in the hair with the head tipped back into the water, then soaping the arms and
// chest with the head down, and the hair again.
function showerPose(p) {
  const P = stance(p), hair = held(p, 0.04, 0.4), body = held(p, 0.5, 0.84), w = Math.sin(7 * TAU * p);
  arm(P, 'R', -10 - 140 * hair - 34 * body, 22 * hair + 62 * body, -0.08 - 0.32 * hair, -14 - 112 * hair - 76 * body + 10 * w * (hair + body), -8);
  arm(P, 'L', -10 - 138 * hair - 18 * body, -22 * hair - 30 * body, 0.08 + 0.32 * hair, -14 - 110 * hair - 52 * body - 10 * w * hair, -8);
  setR(P, 'chest', (-3 * hair + 6 * body) * DEG, 4 * DEG * w * body, 0);
  setR(P, 'neck', (-10 * hair + 8 * body) * DEG, 0, 0); setR(P, 'head', (-14 * hair + 14 * body) * DEG, 6 * DEG * w * hair, 0);
  return P;
}
// At the sink: both hands low in front, rubbing.
function washPose(p) {
  const P = stance(p), r = Math.sin(5 * TAU * p);
  setR(P, 'chest', 10 * DEG, 0, 0);
  arm(P, 'R', -30, 35, -0.05, -62, -8, 15 * r); arm(P, 'L', -30, -35, 0.05, -62, -8, -15 * r);
  setR(P, 'head', 20 * DEG, 0, 0);
  return P;
}
// Leant on a counter on both forearms, looking about the room.
function counterPose(p) {
  const P = stance(p), look = Math.sin(TAU * p);
  setR(P, 'spine', 18 * DEG, 0, 0); setR(P, 'chest', 8 * DEG, 0, 0);
  arm(P, 'R', -12, 30, -0.12, -88, 6); arm(P, 'L', -12, -30, 0.12, -88, 6);
  setR(P, 'neck', -10 * DEG, 8 * DEG * look, 0); setR(P, 'head', -6 * DEG, 18 * DEG * look, 0);
  return P;
}
// Counting money: notes in the left hand, the right thumbing through them, the head down to it.
function countPose(p) {
  const P = stance(p), k = held(p, 0.05, 0.75), flick = k * Math.max(0, Math.sin(16 * TAU * p));
  arm(P, 'L', -18, -40, 0.1, -80, -20); arm(P, 'R', -20, 45, -0.1, -82, -15 + 15 * flick);
  setR(P, 'head', (25 - 18 * (1 - k)) * DEG, 0, 0);
  return P;
}
// Writing on a pad held against the waist.
function writePose(p) {
  const P = stance(p), up = bump(p, 0.7, 0.05);
  arm(P, 'L', -22, -55, 0.12, -85, -6);
  arm(P, 'R', -24, 50, -0.12, -88 + 4 * Math.sin(9 * TAU * p), -10 + 6 * Math.sin(14 * TAU * p));
  setR(P, 'head', (28 - 24 * up) * DEG, 0, 0);
  return P;
}
// Eating something out of the left hand: two bites a cycle, and chewing.
const biteK = (p) => smooth(0.1, 0.2, p) * (1 - smooth(0.26, 0.36, p)) + smooth(0.55, 0.65, p) * (1 - smooth(0.71, 0.81, p));
function eatPose(p) {
  const P = stance(p);
  arm(P, 'L', -20, -35, 0.08, -86, -12);
  handToMouth(P, biteK(p));
  setR(P, 'head', (6 - 4 * biteK(p)) * DEG, 6 * DEG * Math.sin(TAU * p), 0);
  return P;
}
const chewK = (p) => 0.14 * Math.abs(Math.sin(6 * TAU * p)) * (1 - biteK(p));
// Squatting on the heels at a camping stove on the floor: knees apart, the right hand stirring the pan low in
// front, the left forearm on the knee, and now and then a lean in to look. The soles find the floor (room-people.js).
function squatStirPose(p) {
  const P = stance(p, false), c = Math.cos(3 * TAU * p), s = Math.sin(3 * TAU * p), look = held(p, 0.55, 0.8);
  // down on the haunches over feet a little apart and turned out, the heels just up, the hips back behind them
  plant(P, { L: { x: 0.17, z: 0.08, turn: 22, heel: 10 }, R: { x: -0.16, z: 0.03, turn: 18, heel: 12 } }, { weight: 0.55, sink: 0.5, dz: -0.1 });
  setR(P, 'spine', (24 + 6 * look) * DEG, 0, 0); setR(P, 'chest', 10 * DEG, 0, 0);
  arm(P, 'R', -48 + 6 * c, 18 + 10 * s, -0.12, -38, -6);
  arm(P, 'L', -40, -18, 0.2, -52, -8);
  setR(P, 'neck', 6 * DEG, 0, 0); setR(P, 'head', (16 + 8 * look) * DEG, 4 * DEG * s, 0);
  return P;
}
// A laugh: the head back, the shoulders going, a hand to the belly.
const laughK = (p) => held(p, 0.08, 0.56);
function laughPose(p) {
  const P = stance(p), k = laughK(p), sh = Math.sin(14 * TAU * p);
  arm(P, 'L', -12 * k - 2, -50 * k, 0.07 + 0.08 * k, -12 - 58 * k, -8);
  arm(P, 'R', -2, 0, -0.07, -12, -6);
  setR(P, 'chest', (-6 * k + 2.5 * k * sh) * DEG, 0, 0);
  setR(P, 'neck', -6 * DEG * k, 0, 0); setR(P, 'head', (-12 * k + 3 * k * sh) * DEG, 6 * DEG * k, 0);
  return P;
}
// A shrug: the forearms out, palms up, the head on one side.
function shrugPose(p) {
  const P = stance(p), k = held(p, 0.15, 0.45);
  arm(P, 'R', -2 - 8 * k, -25 * k, -0.07 - 0.2 * k, -12 - 68 * k, -6, -30 * k);
  arm(P, 'L', -2 - 8 * k, 25 * k, 0.07 + 0.2 * k, -12 - 68 * k, -6, 30 * k);
  setR(P, 'chest', -3 * DEG * k, 0, 0); setR(P, 'head', 4 * DEG * k, 0, 10 * DEG * k);
  return P;
}
// ── Show business: what a script's stage directions ask of somebody on a set (client/shared/npc-acts.js). ──
// Pointing: the right arm out at something, a jab on the word.
function pointPose(p) {
  const P = stance(p), k = held(p, 0.12, 0.7), jab = 4 * bump(p, 0.35, 0.05);
  arm(P, 'R', -2 - 78 * k - jab, 0, -0.07 - 0.06 * k, -12 + 8 * k, -2);
  setR(P, 'chest', 0, -6 * DEG * k, 0); setR(P, 'head', 0, -8 * DEG * k, 0);
  return P;
}
// Both hands brought up in front of you, palms up, and held there to be looked at: the In Between's first look at
// your own hands as you're printed (cine-cam.js ARRIVAL_SHOTS). Played once; it rises in the first second, then
// holds, breathing.
function handsOutPose(p) {
  const P = stance(p), k = held(p, 0.05, 0.98), br = 1.2 * Math.sin(TAU * 2 * p) * k;
  arm(P, 'R', -2 - 52 * k + br, -4 * k, -0.07 - 0.1 * k, -12 - 38 * k, -8 - 14 * k, -78 * k);
  arm(P, 'L', -2 - 52 * k + br, 4 * k, 0.07 + 0.1 * k, -12 - 38 * k, -8 - 14 * k, 78 * k);
  setR(P, 'chest', 4 * DEG * k, 0, 0); setR(P, 'head', 18 * DEG * k, 0, 0);
  return P;
}
// The arms flung wide, a showman's welcome.
function spreadPose(p) {
  const P = stance(p), k = held(p, 0.12, 0.72);
  arm(P, 'R', -2 - 30 * k, -10 * k, -0.07 - 1.1 * k, -12, -6, -20 * k);
  arm(P, 'L', -2 - 30 * k, 10 * k, 0.07 + 1.1 * k, -12, -6, 20 * k);
  setR(P, 'chest', -5 * DEG * k, 0, 0); setR(P, 'head', -6 * DEG * k, 0, 0);
  return P;
}
// A fist up and down on the table, hard, once.
// The slam has its beats: a small dip as he gathers himself, the arm drawn up and back with the shoulders
// turning into it, a fast drop to the table with the chest following through past it and a little bounce off,
// a hold, and a slow settle. Each is eased, so nothing starts or stops on a frame.
const slamGather = (p) => bump(p, 0.07, 0.05);
const slamUp = (p) => smooth(0.08, 0.32, p) * (1 - smooth(0.38, 0.45, p));
const slamHit = (p) => smooth(0.38, 0.45, p) * (1 - smooth(0.64, 0.92, p));
const slamBounce = (p) => bump(p, 0.48, 0.035);
function slamPose(p) {
  const P = stance(p), g = slamGather(p), up = slamUp(p), hit = slamHit(p), bo = slamBounce(p);
  arm(P, 'R', -2 + 10 * g - 110 * up - 42 * hit + 10 * bo, 6 * up, -0.07 - 0.1 * up, -12 - 18 * g - 60 * up - 18 * hit, -8 + 10 * up);
  // the other arm comes a little off the side with the effort
  arm(P, 'L', -2 - 14 * up - 6 * hit, 0, 0.07 + 0.08 * up, -12 - 22 * up, -6);
  setR(P, 'chest', (14 * hit - 4 * up + 3 * g - 3 * bo) * DEG, (-9 * up + 6 * hit) * DEG, 0); setR(P, 'head', (10 * hit - 6 * up - 4 * bo) * DEG, 0, 0);
  return P;
}
// Something held up over the head for the camera to see.
function holdupPose(p) {
  const P = stance(p), k = held(p, 0.1, 0.78);
  arm(P, 'R', -2 - 150 * k, 0, -0.07 - 0.15 * k, -12 + 2 * k, -10);
  setR(P, 'neck', -6 * DEG * k, 0, 0); setR(P, 'head', -12 * DEG * k, 0, 0);
  return P;
}
// Both biceps, squeezed on a pulse. The upper arm turns so the elbow bends the forearm up, not forward.
const FLEX_TW = 85;
function flexPose(p) {
  const P = stance(p), k = held(p, 0.12, 0.76), pulse = 6 * k * Math.max(0, Math.sin(6 * TAU * p));
  arm(P, 'R', -2 - 10 * k, -FLEX_TW * k, -0.07 - 1.25 * k, -12 - 100 * k - pulse, -14);
  arm(P, 'L', -2 - 10 * k, FLEX_TW * k, 0.07 + 1.25 * k, -12 - 100 * k - pulse, -14);
  setR(P, 'chest', -4 * DEG * k, 0, 0); setR(P, 'head', -4 * DEG * k, 0, 0);
  return P;
}
// Clapping in front of the chest.
// An acoustic guitar played standing (gl/room-held.js draws it): the left hand out on the neck at the chest, the
// right arm across the belly strumming over the sound hole, the head down to the fretboard and swaying with it.
function guitarPose(p) {
  const P = stance(p), k = 1, st = Math.sin(16 * TAU * p), sw = Math.sin(2 * TAU * p);
  setR(P, 'spine', 4 * DEG * k, 3 * DEG * sw * k, 0); setR(P, 'chest', 3 * DEG * k, -6 * DEG * k, 0);
  arm(P, 'L', -6 - 44 * k, 25 * k, 0.1 + 0.3 * k, -12 - 48 * k, -8, -20 * k);
  arm(P, 'R', -4 - 52 * k + 3 * st * k, 44 * k, -0.14 - 0.12 * k, -10 - 30 * k + 6 * st * k, -8 + 14 * st * k, -30 * k);
  setR(P, 'head', 16 * DEG * k, 14 * DEG * k, 5 * DEG * sw * k);
  return P;
}
function clapPose(p) {
  const P = stance(p), k = held(p, 0.06, 0.86), c = Math.abs(Math.sin(8 * TAU * p));
  arm(P, 'R', -2 - 38 * k, 50 * k, -0.07 - 0.08 * c * k, -12 - 58 * k, -8);
  arm(P, 'L', -2 - 38 * k, -50 * k, 0.07 + 0.08 * c * k, -12 - 58 * k, -8);
  return P;
}
// Out for something at arm's length (a button, a shoulder, a camera), and back.
function reachPose(p) {
  const P = stance(p), k = held(p, 0.1, 0.62);
  arm(P, 'R', -2 - 72 * k, 0, -0.07 - 0.08 * k, -12 + 2 * k, -4);
  setR(P, 'chest', 10 * DEG * k, -8 * DEG * k, 0); setR(P, 'head', 4 * DEG * k, 0, 0);
  return P;
}
// ── Two at once: plugins/roomstage npc-life.js PAIRS stands them face to face and plays one of these on both. ──
// A high five: the hand up by the head with the elbow bent, then pushed up and forward to meet the other's at the
// top, and down again. Face to face, one person's right hand is over the other's left, so whoever came over plays
// highFive (right) and the other highFiveL (left); gl/figure-reach.js puts both palms on the one point between them
// (its 'fiveR'/'fiveL' goals), so the hands meet whatever the bodies. The arm is never straight: a straight arm up
// at an angle reads as a salute.
function highFivePose(p, L = false) {
  const side = L ? 'L' : 'R', sg = L ? -1 : 1, P = stance(p), k = held(p, 0.08, 0.66);
  const hit = smooth(0.3, 0.42, p) * (1 - smooth(0.56, 0.72, p)), slap = bump(p, 0.43, 0.035);
  arm(P, side, -2 - (150 - 14 * hit) * k, 0, sg * (-0.07 + 0.17 * k), -12 - (74 - 52 * hit) * k, -8 - 22 * k + 14 * slap);
  setR(P, 'chest', (6 * hit + 3 * slap - 2 * k) * DEG, -sg * 8 * DEG * k, 0); setR(P, 'head', (-6 * k + 4 * hit) * DEG, 0, 0);
  return P;
}
const highFiveLPose = (p) => highFivePose(p, true);
// A fist bump: the fist drawn back to the hip, pushed out at chest height to meet the other's in the middle, a small
// bounce off it, and down. Right and left as the high five, onto gl/figure-reach.js's 'bumpR'/'bumpL'.
function fistBumpPose(p, L = false) {
  const side = L ? 'L' : 'R', sg = L ? -1 : 1, P = stance(p), k = held(p, 0.08, 0.7);
  const out = smooth(0.24, 0.4, p) * (1 - smooth(0.58, 0.74, p)), bo = bump(p, 0.45, 0.04);
  arm(P, side, -2 + (22 - 28 * out) * k, 0, sg * (-0.07 + 0.06 * k), -12 - (116 - 14 * out + 6 * bo) * k, -4);
  setR(P, 'chest', (3 * out - 2 * bo) * DEG, -sg * 6 * DEG * k, 0); setR(P, 'head', (4 * out) * DEG, 0, 0);
  return P;
}
const fistBumpLPose = (p) => fistBumpPose(p, true);
// A hug: both arms round somebody a head away, a lean in, the head to one side, a pat or two on the back.
function hugPose(p) {
  const P = stance(p), k = held(p, 0.06, 0.82), pat = Math.max(0, Math.sin(6 * TAU * p)) * smooth(0.35, 0.45, p) * k;
  arm(P, 'R', -2 - 80 * k, 12 * k, -0.07 - 0.22 * k, -12 - 48 * k - 10 * pat, -8);
  arm(P, 'L', -2 - 56 * k, -4 * k, 0.07 + 0.3 * k, -12 - 62 * k, -8);
  setR(P, 'chest', 10 * DEG * k, 0, 0); setR(P, 'neck', 6 * DEG * k, 0, 0); setR(P, 'head', 4 * DEG * k, 26 * DEG * k, 8 * DEG * k);
  return P;
}
// A handshake: the right hand out to the middle and pumped three times.
function shakePose(p) {
  const P = stance(p), k = held(p, 0.1, 0.7), pump = Math.sin(6 * TAU * p) * smooth(0.25, 0.32, p) * (1 - smooth(0.6, 0.66, p));
  arm(P, 'R', -2 - (44 + 7 * pump) * k, 48 * k, -0.07 + 0.14 * k, -12 - 34 * k, -6, -10 * k);
  setR(P, 'chest', 6 * DEG * k, -6 * DEG * k, 0); setR(P, 'head', 6 * DEG * k, 0, 0);
  return P;
}
// A toast: the bottle out and up to the middle, a clink, and a swig after.
function toastPose(p) {
  const P = stance(p), up = held(p, 0.06, 0.4), swig = held(p, 0.5, 0.82);
  arm(P, 'R', -2 - 82 * up - 50 * swig, 44 * up + 34 * swig, -0.07 - 0.06 * up, -12 - 30 * up - 104 * swig, -10);
  setR(P, 'head', (-4 * up - 16 * swig) * DEG, 0, 0); setR(P, 'chest', (4 * up - 4 * swig) * DEG, 0, 0);
  return P;
}
// ── At a party: plugins/outings scenes.js stands a group of friends together and plays one of these on each. ──
// Every one plants both feet (plant/footwork), and none is the mirror of itself: the drink is in the right hand.
//
// Dancing with friends over eight beats, smaller than a dancer's: a step-touch from foot to foot, the knees
// giving on each downbeat, the drink held up and out of the way in the right hand, the left forearm loose and
// bobbing, the shoulders going against the hips and the head nodding late.
function groovePose(p) {
  const P = stance(p, false), dip = onBeat(p, 8), s = Math.sin(4 * TAU * p), c = Math.cos(4 * TAU * p), w = onFeet(p, 8, 0.5);
  setR(P, 'pelvis', (2 + 3 * dip) * DEG, 6 * DEG * c, 0);
  footwork(P, w, { x: 0.12, z: 0.05, heel: 22, sink: 0.025 + 0.03 * dip, dx: 0.02 * (2 * w - 1), hike: 6 });
  setR(P, 'spine', (3 + 2 * dip) * DEG, -4 * DEG * c, -3 * DEG * s);
  setR(P, 'chest', 2 * DEG * Math.sin(4 * TAU * p - 1.2), -7 * DEG * c, -4 * DEG * s);
  arm(P, 'R', -58 + 6 * dip, 30, -0.22, -96 + 8 * s, -12);
  arm(P, 'L', -26 - 10 * dip, -30, 0.2 + 0.05 * s, -78 - 18 * dip, -10, -8 * s);
  setR(P, 'neck', (-2 + 4 * onBeat(p, 8, 3)) * DEG, 0, 0);
  setR(P, 'head', (3 * Math.sin(8 * TAU * p - 1.4)) * DEG, 8 * DEG * Math.cos(4 * TAU * p - 0.8), 5 * DEG * Math.sin(4 * TAU * p - 0.8));
  return P;
}
// A toast with the whole group: the weight onto the left foot as the drink goes up high into the middle, a
// clink at the top, the left hand on the hip throughout, then back over the right for a long swig, head back.
const toastUpK = (p) => held(p, 0.06, 0.38);
function toastUpPose(p) {
  const P = stance(p, false), up = toastUpK(p), clink = bump(p, 0.3, 0.025), swig = held(p, 0.52, 0.82);
  setR(P, 'pelvis', 1 * DEG, (4 * up - 3 * swig) * DEG, (3 * up - 3 * swig) * DEG);
  plant(P, IDLE_FEET, { weight: 0.3 + 0.38 * up - 0.2 * swig, dz: 0.015 * up, sink: 0.01 * swig });
  arm(P, 'R', -2 - 140 * up - 40 * swig + 6 * clink, 30 * up + 34 * swig, -0.07 - 0.12 * up, -12 - 22 * up - 108 * swig, -10 - 8 * clink);
  arm(P, 'L', 10, -40, 0.52, -92, -14);
  setR(P, 'spine', (2 * up - 3 * swig) * DEG, -4 * DEG * up, 2 * DEG);
  setR(P, 'chest', (5 * up - 6 * swig) * DEG, -6 * DEG * up, 0);
  setR(P, 'neck', (-6 * up - 6 * swig) * DEG, 0, 0); setR(P, 'head', (-10 * up - 18 * swig) * DEG, 4 * DEG * up, 4 * DEG * up);
  return P;
}
// Huddled in close, talking low: leant in from the hips over a forward left foot, the weight on it, the drink
// at the chest with the left arm folded under it, nodding along and looking from one face to the next.
function huddlePose(p) {
  const P = stance(p, false), s = Math.sin(TAU * p), nod = bump(p, 0.2, 0.05) + bump(p, 0.62, 0.06);
  setR(P, 'pelvis', 4 * DEG, -4 * DEG, 3 * DEG);
  plant(P, { R: { x: -0.1, z: -0.06, turn: 12 }, L: { x: 0.1, z: 0.1, turn: 6 } }, { weight: 0.68 + 0.04 * s, dz: 0.02 });
  setR(P, 'spine', 9 * DEG, 0, -2 * DEG); setR(P, 'chest', 8 * DEG, 3 * DEG * s, 0);
  arm(P, 'R', -24, 46, -0.16, -104, -12);
  arm(P, 'L', -16, -64, 0.17, -70, -10);
  setR(P, 'neck', -10 * DEG, 10 * DEG * s, 0);
  setR(P, 'head', (-2 + 8 * nod) * DEG, 22 * DEG * Math.sin(TAU * p + 0.4), 5 * DEG * Math.sin(TAU * p + 1.1));
  return P;
}
// Downing it: the feet set apart, the left hand on the hip, the bottle tipped up and the head going back further
// as it empties, the knees softening, then the bottle down and a gasp.
const chugK = (p) => held(p, 0.08, 0.72);
function chugPose(p) {
  const P = stance(p, false), k = chugK(p), deep = smooth(0.2, 0.7, p) * k, done = bump(p, 0.88, 0.05);
  setR(P, 'pelvis', (-2 * deep) * DEG, 3 * DEG, -2 * DEG);
  plant(P, { R: { x: -0.12, z: 0.0, turn: 10 }, L: { x: 0.13, z: 0.04, turn: 16 } }, { weight: 0.45, sink: 0.02 * deep + 0.03 * done, dz: -0.015 * deep });
  arm(P, 'R', -2 - 110 * k - 40 * deep, 40 * k, -0.07 - 0.1 * k, -12 - 118 * k + 30 * deep, -10 - 20 * deep);
  arm(P, 'L', 8, -42, 0.5, -90, -14);
  setR(P, 'spine', -4 * deep * DEG, 0, 0); setR(P, 'chest', (-6 * deep + 8 * done) * DEG, 0, 0);
  setR(P, 'neck', (-8 * k - 8 * deep) * DEG, 0, 0); setR(P, 'head', (-10 * k - 16 * deep + 10 * done) * DEG, 0, 3 * DEG);
  return P;
}
// Egging the drinker on over four beats: the right fist banged up on every beat, a bounce at the knees with it,
// the drink in the left, the head and chest jerked forward with each shout.
function chantPose(p) {
  const P = stance(p, false), b = onBeat(p, 4, 6), s = Math.sin(4 * TAU * p);
  setR(P, 'pelvis', 2 * DEG, -5 * DEG, 2 * DEG);
  plant(P, IDLE_FEET, { weight: 0.4 + 0.08 * s, sink: 0.012 + 0.03 * b });
  arm(P, 'R', -86 - 46 * b, 28, -0.2, -98 + 40 * b, -12);
  arm(P, 'L', -30, -46, 0.18, -82, -10);
  setR(P, 'spine', 3 * b * DEG, -3 * DEG, 0); setR(P, 'chest', (6 * b - 2) * DEG, -5 * DEG, 0);
  setR(P, 'head', (-6 + 8 * b) * DEG, 5 * DEG, 2 * DEG * s);
  return P;
}
// Laughing at somebody on the floor: bent forward with a hand braced on the left knee, the right pointing down at
// them, the shoulders going, and straightening up now and then to wipe an eye.
const pointLaughK = (p) => held(p, 0.06, 0.66);
function pointLaughPose(p) {
  const P = stance(p, false), k = pointLaughK(p), sh = Math.sin(14 * TAU * p) * k, wipe = held(p, 0.72, 0.9);
  setR(P, 'pelvis', 10 * DEG * k, -6 * DEG, 2 * DEG);
  plant(P, { R: { x: -0.12, z: -0.04, turn: 12 }, L: { x: 0.12, z: 0.1, turn: 8 } }, { weight: 0.62, sink: 0.05 * k + 0.01, dz: -0.04 * k });
  setR(P, 'spine', (14 * k + 2 * sh) * DEG, 0, 3 * DEG); setR(P, 'chest', (10 * k + 3 * sh) * DEG, -6 * DEG, 0);
  arm(P, 'L', -46 * k - 4, -20 * k, 0.12, -24 * k - 12, -6);
  arm(P, 'R', -2 - 64 * k - 60 * wipe, 6, -0.12, -12 - 8 * k - 110 * wipe, -6);
  setR(P, 'neck', -18 * DEG * k, 0, 0); setR(P, 'head', (-14 * k + 4 * sh + 6 * wipe) * DEG, 8 * DEG, 4 * DEG * k);
  return P;
}
// Wrapped up in one another off in a corner: close, an arm round their waist, the other hand on their chest, the
// head tilted in, the weight on one hip, swaying slowly together.
function canoodlePose(p) {
  const P = stance(p, false), s = Math.sin(TAU * p), s2 = Math.sin(2 * TAU * p + 0.5);
  setR(P, 'pelvis', 2 * DEG, 4 * DEG, -3 * DEG);
  plant(P, { R: { x: -0.09, z: 0.0, turn: 6 }, L: { x: 0.11, z: 0.08, turn: 14 } }, { weight: 0.34 + 0.08 * s, dz: 0.02 });
  setR(P, 'spine', 5 * DEG, 0, 3 * DEG); setR(P, 'chest', 6 * DEG, 4 * DEG * s, -2 * DEG);
  arm(P, 'R', -58, 42, -0.42, -82 + 6 * s2, -10, 10);
  arm(P, 'L', -50, -36, 0.1, -96 + 5 * s, -12);
  setR(P, 'neck', -6 * DEG, 0, 0); setR(P, 'head', (4 + 2 * s2) * DEG, 10 * DEG, 14 * DEG);
  return P;
}
// Arms round each other's shoulders, singing: the right arm up and over a neighbour's shoulder, the drink held up
// in the left, the whole body swaying from foot to foot over eight beats, the head back on the long notes.
function swaySingPose(p) {
  const P = stance(p, false), s = Math.sin(2 * TAU * p), belt = held(p, 0.4, 0.58) + held(p, 0.86, 0.95);
  setR(P, 'pelvis', 1 * DEG, 0, 4 * DEG * s);
  plant(P, { R: { x: -0.13, z: 0.0, turn: 10 }, L: { x: 0.13, z: 0.02, turn: 12 } }, { weight: 0.5 + 0.26 * s, sink: 0.015, dx: 0.02 * s });
  setR(P, 'spine', 0, 0, -3 * DEG * s); setR(P, 'chest', -3 * DEG * belt, 0, -4 * DEG * s);
  arm(P, 'R', -24, 8, -1.35, -58, -8);
  arm(P, 'L', -86 - 20 * belt, -26, 0.2, -76 + 20 * belt, -10);
  setR(P, 'neck', -4 * DEG * belt, 0, 0); setR(P, 'head', (-14 * belt + 2) * DEG, 6 * DEG * s, 7 * DEG * s);
  return P;
}
// Not moving at all: no sway, no glance, the eyes on one place.
function starePose() { const P = stance(0); setR(P, 'head', 2 * DEG, 0, 0); return P; }
function sitStarePose() { const P = sitting(); armTo(P, 'L', 'lapL'); armTo(P, 'R', 'lapR'); setR(P, 'head', 3 * DEG, 0, 0); return P; }
// A wink: the head on one side and the face screwed up for a beat.
const winkK = (p) => held(p, 0.3, 0.44);
function winkPose(p) {
  const P = stance(p), k = winkK(p);
  setR(P, 'head', -3 * DEG * k, 6 * DEG * k, 12 * DEG * k);
  return P;
}
// In toward the lens from the waist.
function leanInPose(p) {
  const P = stance(p), k = held(p, 0.1, 0.8);
  setR(P, 'spine', 12 * DEG * k, 0, 0); setR(P, 'chest', 18 * DEG * k, 0, 0);
  setR(P, 'neck', -14 * DEG * k, 0, 0); setR(P, 'head', -8 * DEG * k, 0, 0);
  return P;
}
// A trip: the body pitches forward, the arms go everywhere, and they catch themselves.
function stumblePose(p) {
  const P = stance(p, false), k = held(p, 0.05, 0.5), fl = Math.sin(9 * TAU * p) * k;
  setR(P, 'spine', 26 * DEG * k, 0, 0); setR(P, 'chest', 8 * DEG * k, 6 * DEG * fl, 0);
  // the right foot caught and up off the floor, all the weight thrown onto the left and forward over it
  plant(P, { L: IDLE_FEET.L, R: { ...IDLE_FEET.R, heel: 30 * k, lift: 0.07 * k } }, { weight: mixN(0.28, 0.95, smooth(0, 0.5, k)), sink: 0.04 * k, dz: 0.05 * k });
  arm(P, 'R', -2 - 90 * k + 20 * fl, 0, -0.07 - 0.6 * k, -20, -8);
  arm(P, 'L', -2 - 70 * k - 20 * fl, 0, 0.07 + 0.7 * k, -30, -8);
  setR(P, 'head', -10 * DEG * k, 0, 0);
  return P;
}
// A wind-up and a fling, underarm: into a pan, a sink, a tray.
const tossWind = (p) => smooth(0.12, 0.32, p) * (1 - smooth(0.42, 0.48, p));
const tossFling = (p) => smooth(0.42, 0.5, p) * (1 - smooth(0.7, 0.86, p));
function tossPose(p) {
  const P = stance(p), w = tossWind(p), f = tossFling(p);
  arm(P, 'R', -2 + 20 * w - 85 * f, 0, -0.07 - 0.1 * w, -12 - 80 * w + 6 * f, -8 + 20 * w);
  setR(P, 'chest', 6 * DEG * f, (14 * w - 10 * f) * DEG, 0);
  return P;
}
// ── At a card table (plugins/gametable says it, client/shared/npc-acts.js reads it). ──
// A check: the right hand comes forward onto the felt and knocks twice, knuckles down, the left keeping its cards.
const rapTap = (p) => bump(p, 0.34, 0.035) + bump(p, 0.5, 0.035);
function sitRapPose(p) {
  const P = sitting(14), k = held(p, 0.04, 0.72), up = k * (1 - rapTap(p));
  // a long reach: a card table's chairs stand back from its rail
  arm(P, 'R', -2 - 100 * k, 0, -0.07, -12 - 22 * k - 30 * up, -8 + 26 * k, 0);
  arm(P, 'L', -46, -14, 0.1, -60, -12);
  setR(P, 'spine', (6 + 12 * k) * DEG, 0, 0); setR(P, 'chest', 8 * DEG * k, -8 * DEG * k, 0); setR(P, 'head', 6 * DEG * k, 0, 0);
  return P;
}
// At somebody's door (plugins/roomstage knockPost): the right fist comes up to the leaf at head height and raps three
// times, rap-rap, rap, then drops, and they stand back and wait with the weight on one hip. One loop is one knock;
// roomstage plays it once per knock and stands them at the door between knocks (gametable's KNOCK_EVERY_MS).
const knockRap = (p) => bump(p, 0.1, 0.012) + bump(p, 0.135, 0.012) + bump(p, 0.19, 0.012);
function knockPose(p) {
  const P = stance(p * 2), k = held(p, 0.02, 0.24), r = knockRap(p);
  // the fist forward and up, the forearm flicking in from the elbow on each rap
  arm(P, 'R', -2 - 78 * k, 10 * k, -0.07 - 0.05 * k, -12 - 88 * k + 22 * r, -8 - 12 * k);
  arm(P, 'L', -6, -8, 0.1, -18, -8);
  setR(P, 'chest', 3 * DEG * r, -6 * DEG * k, 0); setR(P, 'head', (-4 * k + 8 * (1 - k) * held(p, 0.4, 0.86)) * DEG, 0, 0);
  return P;
}
// A fold: the cards flicked face down toward the middle with the back of the hand.
function sitMuckPose(p) {
  const P = sitting(10), w = held(p, 0.05, 0.3), f = held(p, 0.28, 0.62);
  arm(P, 'R', -2 - 84 * w - 16 * f, 0, -0.07 - 0.06 * w, -12 - 50 * w + 46 * f, -8 + 24 * f);
  arm(P, 'L', -12, -40, 0.12, -40, -8);
  setR(P, 'chest', (4 + 6 * f) * DEG, 6 * DEG * w, 0); setR(P, 'head', 6 * DEG, -8 * DEG * f, 0);
  return P;
}
// A call or a bet: both hands round a stack, pushed out over the line and let go.
function sitChipsPose(p) {
  const P = sitting(12), k = held(p, 0.08, 0.66), push = smooth(0.25, 0.5, p) * (1 - smooth(0.7, 0.86, p));
  for (const [s, sg] of [['R', 1], ['L', -1]]) arm(P, s, -2 - 88 * k - 12 * push, 0, sg * -0.07 + sg * 0.12 * k, -12 - 36 * k + 30 * push, -8);
  setR(P, 'spine', (6 + 10 * k + 10 * push) * DEG, 0, 0); setR(P, 'head', 6 * DEG * k, 0, 0);
  return P;
}
// Dealing: the deck held in the left hand at the chest, the right pitching a card off the top in a flick each beat,
// the head turning after it round the table.
function dealPose(p) {
  const P = stance(p), c = Math.cos(TAU * p * 3), s = Math.sin(TAU * p * 3);
  arm(P, 'L', -20, -30, 0.05, -96, -10);
  arm(P, 'R', -2 - 58 - 10 * s, 0, -0.07 - 0.12 * (0.5 + 0.5 * c), -12 - 30 + 26 * s, -8 + 20 * s);
  setR(P, 'chest', 8 * DEG, 12 * DEG * Math.sin(TAU * p), 0); setR(P, 'head', 18 * DEG, 22 * DEG * Math.sin(TAU * p), 0);
  return P;
}
// Both hands at the front of the coat, tugging it straight, the chin up.
function adjustPose(p) {
  const P = stance(p), k = held(p, 0.1, 0.78), tug = 6 * k * Math.sin(3 * TAU * p);
  arm(P, 'R', -28 * k - 2, 62 * k, -0.06, -12 - 98 * k + tug, -8);
  arm(P, 'L', -28 * k - 2, -62 * k, 0.06, -12 - 98 * k + tug, -8);
  setR(P, 'head', -8 * DEG * k, 0, 0);
  return P;
}
// The same, in a chair: the arms and head do it and the seat holds the rest.
const sitOf = (fn, lean = 8) => (p) => takeArms(sitting(lean), fn(p));

// Frightened: crouched, the arms up over the head, shaking.
function cowerPose(p) {
  const P = stance(p, false), sh = Math.sin(30 * TAU * p);
  // crouched over the feet where they were, up on the balls, the hips back under the bent back
  plant(P, { L: { ...IDLE_FEET.L, heel: 18 }, R: { ...IDLE_FEET.R, heel: 14 } }, { weight: 0.45, sink: 0.24, dz: -0.07 });
  setR(P, 'spine', 22 * DEG, 0, 0); setR(P, 'chest', 10 * DEG, 2 * DEG * sh, 0);
  arm(P, 'R', -115, 55, 0.35, -125, -10); arm(P, 'L', -115, -55, -0.35, -125, -10);
  setR(P, 'head', 25 * DEG, 0, 0);
  return P;
}
// ── A dancer's clips. Every one lasts a whole number of beats at the club's 124 bpm (gl/room.js's `beat` lamp
// runs on the same clock), and gl/room-people.js starts each slot on a bar, so the hips land when the red wash
// fires. `beats(p, n)` is where in the beat a clip of n beats is: 0 on the beat, rising to 1 just before the next.
export const DANCE_BEAT = 60 / 124;
const beatOf = (p, n) => { const x = p * n; return x - Math.floor(x); };
// a dip that lands on the beat and lets go before the next, as a knee gives on a downbeat
const onBeat = (p, n, w = 4) => Math.exp(-beatOf(p, n) * w);
// ── Her feet. Every dancer's clip is footwork on two footholds (plant, actor-plant.js): the feet stay where she put
// them and the legs are solved to them, so nothing the hips do slides a foot or lifts one off the floor. Dancing
// in place is the weight going from foot to foot:
//   - the hips go over the foot that has the weight, and the hip on the other side drops, so the loaded leg is
//     long and nearly straight and the free one bends;
//   - the free foot comes up onto its ball with the heel turned out, which brings its knee in across the other;
//     it goes flat again as the weight comes back, heel first down, never sliding;
//   - a knee gives because the hips go down (`sink`), and both bend, because both feet are still on the floor;
//   - the weight moves on the beat and stays a moment, rather than swinging back and forth like a pendulum.
// `w` is the share on the left. o: { x, half the stance's width; z, how far the left foot is ahead of the right;
// heel, how far a free heel comes up; turn, toe out on a loaded foot; turnIn, how far a free one turns in; sink,
// dx, dz; hike, how far the free side's hip drops, degrees; shift }. Set the pelvis's tilt and turn before it.
function footwork(P, w, o = {}) {
  const { x = 0.11, z = 0, heel = 30, turn = 9, turnIn = 8, sink = 0, dx = 0, dz = 0, hike = 7, shift, liftL = 0, liftR = 0 } = o;
  const free = (k) => clamp01((0.5 - k) * 2.4);
  const fL = free(w), fR = free(1 - w);
  // a foothold at the ball: the free foot swivels on it, heel out, as it comes up; `liftL`/`liftR` raise a free one
  // off the floor, toe pointed
  const foot = (sg, f, zz, up) => ({ x: sg * x, z: zz + 0.11, ball: true, heel: heel * Math.pow(f, 0.75) + 90 * up, lift: up, turn: turn - (turn + turnIn) * smooth(0.25, 1, f) });
  setR(P, 'pelvis', 0, 0, hike * (2 * w - 1) * DEG);
  return plant(P, { L: foot(1, fL, z / 2, liftL), R: foot(-1, fR, -z / 2, liftR) }, { weight: w, sink, dx, dz, shift });
}
// A planted leg taken off the floor into the clip's own angles (degrees, [x, y, z] for the thigh, shin and foot) by
// `k`, 0 planted and 1 the clip's, so a kick leaves the floor from where the foot was rather than jumping to it.
// Put the weight on the other foot first: a leg can't come up while it's holding her.
function liftLeg(P, sd, k, thigh, shin, foot) {
  if (!(k > 0)) return P;
  for (const [b, a] of [['thigh', thigh], ['shin', shin], ['foot', foot], ['toe', [0, 0, 0]]]) {
    const i = B[b + sd] * 3;
    for (let c = 0; c < 3; c++) P.r[i + c] += (a[c] * DEG - P.r[i + c]) * k;
  }
  return P;
}
// the weight on the beat: from one foot to the other quickly, then staying there (`n` steps over the clip, the
// first onto the left)
const onFeet = (p, n, hold = 0.7) => { const s = Math.sin(n * Math.PI * p); return 0.5 + 0.5 * Math.sign(s) * Math.pow(Math.abs(s), hold); };

// Dancing on the spot over eight beats: the weight goes from foot to foot on every beat, the free heel up and its
// knee in, a dip on each downbeat, the hips rolling a figure of eight with the chest turning against them and the
// head a little behind the chest. The right hand sweeps up over the head through the first bar, the left through
// the second.
function dancePose(p) {
  const P = stance(p, false), s = Math.sin(4 * TAU * p), c = Math.cos(4 * TAU * p), dip = onBeat(p, 8);
  const upR = Math.sin(Math.PI * Math.min(1, 2 * p)) ** 2, upL = Math.sin(Math.PI * Math.max(0, 2 * p - 1)) ** 2;
  const w = onFeet(p, 8);
  setR(P, 'pelvis', (3 + 4 * dip) * DEG, 9 * DEG * c, 0);
  footwork(P, w, { sink: 0.03 + 0.035 * dip, dx: 0.025 * (2 * w - 1), hike: 9 });
  setR(P, 'spine', (2 * dip + 4 * Math.sin(4 * TAU * p - 0.9)) * DEG, -6 * DEG * c, -5 * DEG * s);
  setR(P, 'chest', 5 * DEG * Math.sin(4 * TAU * p - 1.7), -9 * DEG * c, -5 * DEG * s);
  arm(P, 'R', -32 - 128 * upR + 6 * s, 22, -0.18 - 0.2 * upR, -64 + 44 * upR, -10, 10 * s);
  arm(P, 'L', -32 - 128 * upL - 6 * s, -22, 0.18 + 0.2 * upL, -64 + 44 * upL, -10, -10 * s);
  setR(P, 'neck', -4 * DEG * (upR + upL), 0, 0);
  setR(P, 'head', (4 * dip - 8 * (upR + upL)) * DEG, 9 * DEG * Math.cos(4 * TAU * p - 0.6), 6 * DEG * Math.sin(4 * TAU * p - 0.6));
  return P;
}
// A body roll over eight beats, one every two: the wave goes up from the knees through the hips, the waist, the
// chest and the neck to the head, each a little after the one below, and the hands run down the front from the
// ribs to the thighs with it. The fourth roll ends with a pop of the hip.
function bodyRollPose(p) {
  const P = stance(p, false), w = (ph) => Math.sin(4 * TAU * p - ph), k = 0.5 - 0.5 * Math.cos(4 * TAU * p), pop = bump(p, 0.88, 0.04);
  const kn = 0.5 + 0.5 * w(0);
  // the knees go forward and down first, then the hips come through over them: the feet flat, a little apart,
  // the left a touch ahead, the weight even until the pop puts it on the left
  setR(P, 'pelvis', 13 * DEG * w(0.6), 0, 0);
  footwork(P, 0.5 + 0.4 * pop, { x: 0.1, z: 0.06, sink: 0.07 * kn, dz: 0.035 * w(0.6) - 0.02, heel: 22, hike: 10 });
  setR(P, 'spine', -9 * DEG * w(1.3), 0, -5 * DEG * pop); setR(P, 'chest', -11 * DEG * w(2.0), 0, -5 * DEG * pop);
  setR(P, 'neck', -6 * DEG * w(2.6), 0, 0); setR(P, 'head', -9 * DEG * w(3.2), 0, 4 * DEG * pop);
  arm(P, 'R', -40 + 32 * k, 40, -0.12, -102 + 52 * k, -14); arm(P, 'L', -40 + 32 * k, -40, 0.12, -102 + 52 * k, -14);
  return P;
}
// A hair whip over eight beats: both hands up behind the head, the chest and head circling once a bar and flung
// back on its third beat, the knees giving into the fling.
function hairWhipPose(p) {
  const P = stance(p, false), s = Math.sin(2 * TAU * p), c = Math.cos(2 * TAU * p), fling = bump(p, 0.31, 0.035) + bump(p, 0.81, 0.035);
  // feet wide and flat to throw from, the knees giving into each fling and the weight going round with the head
  setR(P, 'pelvis', 4 * fling * DEG, 7 * DEG * s, 0);
  footwork(P, 0.5 + 0.18 * c, { x: 0.14, turn: 12, sink: 0.02 + 0.06 * fling, dz: -0.02 * fling, hike: 5 });
  arm(P, 'R', -150, 30, -0.35, -110, -10); arm(P, 'L', -150, -30, 0.35, -110, -10);
  setR(P, 'spine', (6 * c - 7 * fling) * DEG, 0, 6 * DEG * s);
  setR(P, 'chest', (8 * c - 9 * fling) * DEG, 0, 8 * DEG * s);
  setR(P, 'neck', (10 * c - 16 * fling) * DEG, 0, 8 * DEG * s);
  setR(P, 'head', (12 * c - 22 * fling) * DEG, 0, 10 * DEG * s);
  return P;
}
// Hip circles over eight beats, one a bar: the hips going round over soft knees, the left hand on the hip and the
// right drawn slowly up the thigh and the side to the hair, and down again.
function hipCirclePose(p) {
  const P = stance(p, false), s = Math.sin(2 * TAU * p), c = Math.cos(2 * TAU * p), up = 0.5 - 0.5 * Math.cos(TAU * p);
  // the hips go round over feet that don't move: out over the left foot, forward, over the right, back, the
  // weight following them and the heel of whichever foot they've left coming up a little
  setR(P, 'pelvis', 9 * DEG * c, 0, 0);
  footwork(P, 0.5 + 0.38 * s, { x: 0.12, sink: 0.045, dx: 0.02 * s, dz: 0.045 * c, heel: 16, hike: 12 });
  setR(P, 'spine', -4 * DEG * c, 0, -8 * DEG * s); setR(P, 'chest', -4 * DEG * c, 0, -5 * DEG * s);
  arm(P, 'L', -14, -34, 0.34, -84, -10);
  arm(P, 'R', -10 - 150 * up, 30 * up, -0.14 - 0.24 * up, -20 - 90 * up, -10);
  setR(P, 'head', (-6 * up + 3 * c) * DEG, 0, 6 * DEG * s);
  return P;
}
// Dropping low over eight beats: down into a deep squat with the knees wide through the first bar, the hands on
// the knees and the back flat, a beat held there, and up again through the second with a roll up the spine.
function dropLowPose(p) {
  const P = stance(p, false), down = smooth(0, 0.42, p) * (1 - smooth(0.56, 0.96, p)), roll = bump(p, 0.74, 0.08);
  // a wide stance, toes out, so the knees open over the feet; the hips go down and back to keep her over them,
  // and the heels come up at the bottom, as they do in heels
  setR(P, 'pelvis', -10 * roll * DEG, 0, 0);
  plant(P, { L: { x: 0.2, z: 0.12, ball: true, turn: 30, heel: 24 * down * down }, R: { x: -0.2, z: 0.12, ball: true, turn: 30, heel: 24 * down * down } },
    { sink: 0.44 * down, dz: -0.1 * down });
  setR(P, 'spine', (26 * down - 10 * roll) * DEG, 0, 0); setR(P, 'chest', (6 * down - 12 * roll) * DEG, 0, 0);
  arm(P, 'R', -18 - 34 * down, 24, -0.12 - 0.3 * down, -18 - 20 * down, -10); arm(P, 'L', -18 - 34 * down, -24, 0.12 + 0.3 * down, -18 - 20 * down, -10);
  setR(P, 'neck', -10 * down * DEG, 0, 0); setR(P, 'head', (-16 * down - 8 * roll) * DEG, 0, 0);
  return P;
}
// An arch over eight beats: the right hand up behind the head and the left on the hip, the back arched and let go
// once a bar, the hip popped out on the second and fourth beats.
function backArchPose(p) {
  const P = stance(p, false), arch = Math.sin(Math.PI * beatOf(p, 2)) ** 2, pop = bump(p, 0.125, 0.035) + bump(p, 0.375, 0.035) + bump(p, 0.625, 0.035) + bump(p, 0.875, 0.035);
  // all the weight on the left, its leg long; the right up on its ball with the knee in, and the hip popped out
  // over the left foot on the second and fourth beats
  setR(P, 'pelvis', -6 * arch * DEG, 6 * DEG * pop, 6 * DEG * pop);
  footwork(P, 0.86 + 0.1 * pop, { x: 0.1, z: -0.04, dx: 0.035 * pop, sink: 0.015 + 0.02 * arch, heel: 34, hike: 9 });
  setR(P, 'spine', -12 * arch * DEG, 0, -5 * DEG * pop); setR(P, 'chest', -14 * arch * DEG, 0, -4 * DEG * pop);
  arm(P, 'R', -150, 30, -0.35, -110, -10); arm(P, 'L', -14, -34, 0.34, -84, -10);
  setR(P, 'neck', -10 * arch * DEG, 0, 0); setR(P, 'head', -14 * arch * DEG, 10 * DEG, 4 * DEG * pop);
  return P;
}
// A look back over eight beats: turned half away with the hips, the chest further, looking back over the right
// shoulder, the right hand flat on the hip behind, the hips swaying on every beat.
function lookBackPose(p) {
  const P = stance(p, false), s = Math.sin(4 * TAU * p), turn = smooth(0, 0.12, p) * (1 - smooth(0.88, 1, p)), dip = onBeat(p, 8);
  // the hips turned away over feet that stay facing the room (the thighs turn in their sockets), the weight
  // from foot to foot on every beat
  setR(P, 'pelvis', 3 * dip * DEG, -28 * turn * DEG, 0);
  const w = onFeet(p, 8);
  footwork(P, w, { x: 0.1, z: 0.05, sink: 0.02 + 0.025 * dip, dx: 0.02 * (2 * w - 1), heel: 26, hike: 9 });
  setR(P, 'spine', -4 * DEG, -10 * turn * DEG, -4 * DEG * s); setR(P, 'chest', -4 * DEG, -14 * turn * DEG, -4 * DEG * s);
  arm(P, 'R', 22, 30, -0.3, -44, -10); arm(P, 'L', -14, -34, 0.3, -70, -10);
  setR(P, 'neck', 0, -14 * turn * DEG, 0); setR(P, 'head', -4 * DEG, -30 * turn * DEG, 5 * DEG * s);
  return P;
}
// A shimmy over four beats: leaning in a touch with the arms open low, the shoulders going back and forth twice a
// beat while the hips and head hold still.
function shimmyPose(p) {
  const P = stance(p, false), sh = Math.sin(8 * TAU * p), dip = onBeat(p, 4);
  // feet flat and a little wide, knees soft, the hips back to balance the lean
  footwork(P, 0.5, { x: 0.13, sink: 0.035 + 0.02 * dip, dz: -0.03 });
  setR(P, 'spine', 10 * DEG, 0, 0); setR(P, 'chest', 2 * DEG, 13 * DEG * sh, 0);
  arm(P, 'R', -36, 10, -0.62, -30, -10); arm(P, 'L', -36, -10, 0.62, -30, -10);
  setR(P, 'neck', -6 * DEG, -10 * DEG * sh, 0); setR(P, 'head', -6 * DEG, -3 * DEG * sh, 0);
  return P;
}
// Kneeling on the stage over sixteen beats: up on both knees, the body rolling up from the hips once every two
// beats, the arms going up overhead through the first two bars and back down the body through the last two, and an
// arch back on the last beat of each bar.
function kneelRollPose(p) {
  const P = stance(p, false), w = (ph) => Math.sin(8 * TAU * p - ph), up = Math.sin(Math.PI * p) ** 2, arch = bump(p, 0.22, 0.03) + bump(p, 0.47, 0.03) + bump(p, 0.72, 0.03) + bump(p, 0.97, 0.03);
  zeroR(P, 'pelvis'); setR(P, 'pelvis', 10 * DEG * w(0), 0, 4 * DEG * Math.sin(4 * TAU * p));
  // On her knees, which are on the floor and stay there, the toes tucked under and the shins along the floor
  // behind. The roll and the arch move the hips forward of the knees and back, so the thighs lean, not the knees.
  const lean = (-3 + 7 * arch + 5 * w(0)) * DEG;
  kneel(P, lean, 0.12, 0.04);
  setR(P, 'spine', (-8 * w(0.8) - 8 * arch) * DEG, 0, 0); setR(P, 'chest', (-9 * w(1.6) - 10 * arch) * DEG, 0, 0);
  arm(P, 'R', -30 - 130 * up, 26, -0.16 - 0.2 * up, -80 + 60 * up, -10); arm(P, 'L', -30 - 130 * up, -26, 0.16 + 0.2 * up, -80 + 60 * up, -10);
  setR(P, 'neck', -6 * DEG * w(2.2), 0, 0); setR(P, 'head', (-8 * w(2.8) - 14 * arch) * DEG, 0, 0);
  return P;
}
// Kneeling (plant): both knees on the floor `x` either side and `z` ahead of the figure's spot, the shins back
// along the floor and the toes tucked under, the hips over the knees with the thighs leaning `lean` (radians,
// positive is the hips forward). The knee's joint is a few centimetres up, where the kneecap's front puts it.
const KNEE_UP = 0.06, TUCK = 80;
function kneel(P, lean, x = 0.12, z = 0) {
  const A = Math.hypot(...BONES[B.shinL][2]), Bn = Math.hypot(...BONES[B.footL][2]);
  const [ay, dz] = ankleAt(TUCK), back = Math.sqrt(Math.max(0, Bn * Bn - (ay - KNEE_UP) ** 2));
  const foot = (sg) => ({ x: sg * x, z: z - back - dz, turn: 0, heel: TUCK });
  return plant(P, { L: foot(1), R: foot(-1) }, { shift: 0, dz: z + A * Math.sin(lean), y: KNEE_UP + A * Math.cos(lean) - REST[B.thighL][1] });
}
// Taking a tip, played once: down to a crouch at the rail with the right hand out for the note, the note tucked in
// at the hip, up again, and a kiss blown to whoever gave it.
function tipTakePose(p) {
  const P = stance(p, false), low = smooth(0.04, 0.24, p) * (1 - smooth(0.52, 0.7, p)), take = smooth(0.12, 0.26, p), tuck = smooth(0.32, 0.46, p);
  const kiss = smooth(0.66, 0.76, p), blow = smooth(0.8, 0.88, p), done = smooth(0.9, 1, p);
  // down into a crouch on the balls of her feet, knees open over toes turned out, the hips back over the heels;
  // stood, the hips sway from foot to foot
  const sw = Math.sin(2 * TAU * p) * (1 - low);
  setR(P, 'pelvis', 0, 0, 8 * DEG * sw);
  plant(P, { L: { x: 0.15, z: 0.12, ball: true, turn: 24, heel: 30 * low }, R: { x: -0.15, z: 0.12, ball: true, turn: 24, heel: 30 * low } },
    { weight: 0.5 + 0.3 * sw - 0.08 * low, sink: 0.38 * low, dz: -0.07 * low });
  setR(P, 'spine', 22 * low * DEG, 0, 0); setR(P, 'chest', 6 * low * DEG, 0, 0);
  let f = mixN(-10, -62, take), tw = 0, ab = mixN(-0.1, -0.12, take), el = mixN(-14, -12, take);
  f = mixN(f, -8, tuck); tw = mixN(tw, 40, tuck); ab = mixN(ab, -0.28, tuck); el = mixN(el, -50, tuck);   // at the hip
  f = mixN(f, -64, kiss); tw = mixN(tw, 64, kiss); ab = mixN(ab, -0.14, kiss); el = mixN(el, -128, kiss);   // to the mouth
  f = mixN(f, -84, blow); tw = mixN(tw, 20, blow); el = mixN(el, -20, blow);                              // and out
  f = mixN(f, -12, done); tw = mixN(tw, 0, done); ab = mixN(ab, -0.1, done); el = mixN(el, -16, done);
  arm(P, 'R', f, tw, ab, el, -8);
  arm(P, 'L', mixN(-14, -40, low), -34, mixN(0.34, 0.3, low), mixN(-84, -30, low), -10);
  setR(P, 'head', (-10 * low - 4 * kiss * (1 - blow)) * DEG, 0, 6 * DEG * kiss * (1 - done));
  return P;
}
const kissK = (p) => smooth(0.7, 0.76, p) * (1 - smooth(0.86, 0.92, p));
// Holding a tip out to a dancer, played once: the right hand up and out with the note in it, a lean in after it,
// and back.
function tipOfferPose(p) {
  const P = stance(p), k = held(p, 0.08, 0.66);
  arm(P, 'R', -6 - 82 * k, 6, -0.08 - 0.06 * k, -14 + 4 * k, -4);
  setR(P, 'chest', 10 * DEG * k, -8 * DEG * k, 0); setR(P, 'head', -8 * DEG * k, 0, 0);
  return P;
}
// Cheering a dancer on over four beats: the right fist pumped up on the first and third, the left down with a
// drink, the head going with it.
function fistPumpPose(p) {
  const P = stance(p), pump = bump(p, 0.02, 0.06) + bump(p, 0.52, 0.06);
  arm(P, 'R', -70 - 70 * pump, 24, -0.2, -100 + 60 * pump, -10);
  arm(P, 'L', -24, -50, 0.16, -76, -10);
  setR(P, 'chest', -4 * pump * DEG, 0, 0); setR(P, 'head', -10 * pump * DEG, 0, 0);
  return P;
}
// A note held up and waved for the dancer to see, over four beats: the right arm up, the hand going on each beat.
function billWavePose(p) {
  const P = stance(p), wv = Math.sin(4 * TAU * p);
  arm(P, 'R', -132, 16, -0.26, -34, -10, 14 * wv);
  setR(P, 'chest', -3 * DEG, -6 * DEG, 0); setR(P, 'head', -8 * DEG, 0, 0);
  return P;
}
const mixN = (a, b, k) => a + (b - a) * k;
// Getting changed, played once, the way anybody does it: the fingers down the front of the top, a shrug that
// takes it off the shoulders, each arm drawn out behind, a fold of it and a stoop to put it on the side; then
// thumbs in the waistband, a bend with the knees to push the bottoms down, a foot stepped out of each, and up.
// Every move overlaps the next and the weight goes from foot to foot under it, so nothing starts from still.
function undressPose(p) {
  const P = stance(p, false);
  const btn = held(p, 0.02, 0.17), shrug = held(p, 0.17, 0.27), outR = held(p, 0.24, 0.31), outL = held(p, 0.29, 0.36);
  const fold = held(p, 0.36, 0.44), down = held(p, 0.5, 0.76), stepL = held(p, 0.66, 0.72), stepR = held(p, 0.73, 0.8);
  const bend = Math.max(fold * 0.55, down), walk = Math.sin(TAU * 0.5 * p * 4);
  // the fingers working down a button at a time: a small dip of the hands on each
  const pick = Math.sin(TAU * 7 * p) * btn;
  for (const [sd, s] of [['R', 1], ['L', -1]]) {
    let f = -10, tw = 0, ab = -s * 0.1, el = -12;
    f = mixN(f, -42 + 18 * smooth(0.02, 0.17, p) + 3 * pick, btn); tw = mixN(tw, s * 52, btn); el = mixN(el, -118 + 26 * smooth(0.02, 0.17, p), btn);
    // the shrug: the hands go back and down, the elbows behind
    f = mixN(f, 22, shrug); tw = mixN(tw, s * 10, shrug); ab = mixN(ab, -s * 0.28, shrug); el = mixN(el, -30, shrug);
    // each arm drawn out of its sleeve, behind and down, the other hand pulling the cuff
    const out = sd === 'R' ? outR : outL, pull = sd === 'R' ? outL : outR;
    f = mixN(f, 34, out); el = mixN(el, -6, out); ab = mixN(ab, -s * 0.2, out);
    f = mixN(f, -30, pull); tw = mixN(tw, s * 60, pull); el = mixN(el, -70, pull);
    // a fold in front of the belly, then laid down on the side as she stoops
    f = mixN(f, -48, fold); tw = mixN(tw, s * 44, fold); ab = mixN(ab, s * 0.05, fold); el = mixN(el, -84, fold);
    // thumbs in the waistband, pushing down the thighs as the body folds over
    f = mixN(f, mixN(-8, -34, smooth(0.5, 0.7, p)), down); tw = mixN(tw, s * 20, down); ab = mixN(ab, -s * 0.16, down); el = mixN(el, -16, down);
    arm(P, sd, f, tw, ab, el, -10);
  }
  // down for the bottoms with the knees and the back both bending, a foot lifted out of them one at a time
  footwork(P, 0.5 + 0.18 * walk * (1 - down) - 0.32 * stepL + 0.32 * stepR, { x: 0.11, sink: 0.12 * down + 0.03 * fold, dz: -0.05 * down, heel: 6, liftL: 0.09 * stepL, liftR: 0.09 * stepR });
  setR(P, 'spine', (6 * btn + 26 * bend - 4 * shrug) * DEG, 0, 0);
  setR(P, 'chest', (6 * btn - 8 * shrug + 8 * bend) * DEG, (6 * outR - 6 * outL) * DEG, 0);
  setR(P, 'pelvis', 0, 4 * DEG * walk * (1 - down), 0);
  setR(P, 'head', (22 * btn + 16 * fold + 18 * down - 6 * shrug) * DEG, (8 * outR - 8 * outL) * DEG, 0);
  return P;
}
// Taking a layer off on stage, played once and slower than anybody changing: the hips never stop, both hands slide
// from the hips up the sides to the hem, the garment rises over the head with the arms crossed and the back arching,
// it's held out at arm's length a beat and dropped, and the hands come down the body to the hips.
function stripPose(p) {
  const P = stance(p, false), roll = Math.sin(2 * TAU * p), a = smooth(0.02, 0.3, p), b = smooth(0.3, 0.56, p), c = smooth(0.58, 0.74, p), d = smooth(0.76, 0.98, p);
  for (const [sd, s] of [['R', 1], ['L', -1]]) {
    let f = mixN(-8, -30, a), tw = mixN(s * 20, s * 40, a), ab = mixN(-s * 0.18, -s * 0.06, a), el = mixN(-20, -60, a);
    f = mixN(f, -170, b); tw = mixN(tw, s * 6, b); ab = mixN(ab, s * 0.06, b); el = mixN(el, -40, b);
    if (sd === 'R') { f = mixN(f, -84, c); tw = mixN(tw, -10, c); ab = mixN(ab, -0.9, c); el = mixN(el, -4, c); }
    else { f = mixN(f, -60, c); ab = mixN(ab, 0.3, c); el = mixN(el, -90, c); }
    f = mixN(f, -14, d); tw = mixN(tw, s * 34, d); ab = mixN(ab, -s * 0.26, d); el = mixN(el, -76, d);
    arm(P, sd, f, tw, ab, el, -10);
  }
  setR(P, 'spine', (6 * a * (1 - b) - 10 * b * (1 - d)) * DEG, 0, 4 * DEG * roll);
  setR(P, 'chest', -8 * DEG * b * (1 - d), (-10 * c * (1 - d) + 5 * Math.sin(2 * TAU * p - 0.7)) * DEG, -3 * DEG * roll);
  setR(P, 'head', (8 * a * (1 - b) - 16 * b * (1 - c)) * DEG, (-16 * c * (1 - d) + 8 * Math.sin(2 * TAU * p - 1.3)) * DEG, 0);
  setR(P, 'pelvis', 3 * DEG * Math.cos(2 * TAU * p), 12 * DEG * roll, 4 * DEG * Math.cos(2 * TAU * p));
  footwork(P, 0.5 + 0.32 * roll, { heel: 18, hike: 8, sink: 0.015 });
  return P;
}
// Putting a layer back on, played once: a dip to pick it up, then pulling it up the body and over the shoulders,
// and a smooth of it down at the hips.
function redressPose(p) {
  const P = stance(p, false), dip = held(p, 0.04, 0.3), up = smooth(0.38, 0.7, p), sm = held(p, 0.74, 0.86);
  // down for it over her feet, the knees bending because the hips go down and back, then up
  footwork(P, 0.5, { x: 0.12, sink: 0.17 * dip, dz: -0.06 * dip, heel: 10 });
  setR(P, 'spine', 30 * DEG * dip, 0, 0); setR(P, 'chest', (10 * dip - 4 * up) * DEG, 0, 0);
  setR(P, 'head', (14 * dip - 6 * up) * DEG, 0, 0);
  for (const [sd, s] of [['R', 1], ['L', -1]]) {
    const f = mixN(mixN(-6, -40, dip), -60, up), el = mixN(mixN(-10, -20, dip), -130, up), tw = mixN(0, s * 50, up);
    arm(P, sd, mixN(f, -14, sm), mixN(tw, s * 34, sm), -s * mixN(0.12, 0.2, up), mixN(el, -70, sm), -10);
  }
  setR(P, 'uarmR', 0, 0, -0.1 * held(p, 0.5, 0.66)); setR(P, 'uarmL', 0, 0, 0.1 * held(p, 0.5, 0.66));   // a shrug into it
  return P;
}
// Leaning out from the pole on one straight arm, the right leg hooked round it and the head hung back,
// swinging out and in.
function poleLeanPose(p) {
  const P = stance(p, false), s = Math.sin(TAU * p), k = 0.5 + 0.5 * s;
  arm(P, 'R', -128 + 10 * s, 8, -0.06, -6, -10);
  arm(P, 'L', -60 - 50 * k, -30, 0.55 + 0.2 * k, -20, -6);
  setR(P, 'pelvis', -6 * DEG * k, 14 * DEG * s, 6 * DEG);
  // standing on the left alone, the right leg hooked round the pole; held up by the arm, the hips can go back
  // past the foot as she swings out
  for (const b of ['thighR', 'shinR', 'footR', 'toeR']) zeroR(P, b);
  setR(P, 'thighR', (-48 - 14 * k) * DEG, 10 * DEG, -10 * DEG); setR(P, 'shinR', (72 + 10 * k) * DEG, 0, 0); setR(P, 'footR', 30 * DEG, 0, 0);
  plant(P, { L: { x: 0.07, z: -0.02, turn: 10 }, R: { air: true } }, { shift: 0.9, sink: 0.02 + 0.02 * k, dz: -0.06 * k });
  setR(P, 'spine', (-10 - 8 * k) * DEG, 0, 4 * DEG); setR(P, 'chest', (-8 - 6 * k) * DEG, -6 * DEG * s, 0);
  setR(P, 'neck', -10 * DEG * k, 0, 0); setR(P, 'head', (-10 - 12 * k) * DEG, 8 * DEG * s, 0);
  return P;
}
// Cold: the arms wrapped tight, hunched, shaking.
function shiverPose(p) {
  const P = takeArms(stance(p), waitPose(p), ['uarmR', 'farmR', 'handR', 'uarmL', 'farmL', 'handL']);
  setR(P, 'farmR', -10 * DEG, 0, 0); setR(P, 'farmL', -10 * DEG, 0, 0);
  setR(P, 'spine', 4 * DEG, 0, 0); setR(P, 'chest', 6 * DEG, 0, 1.2 * DEG * Math.sin(60 * TAU * p));
  setR(P, 'neck', 8 * DEG, 0, 0); setR(P, 'head', 6 * DEG, 1.5 * DEG * Math.sin(52 * TAU * p), 0);
  return P;
}
// ── More to do with nothing to do, and what a room too cold or too hot does to somebody (ACTOR_IDLES). ──
const ARM6 = ['uarmR', 'farmR', 'handR', 'uarmL', 'farmL', 'handL'];
// Hands in the pockets, rocking from the heels to the toes.
function rockPose(p) {
  const P = pocketsPose(p), r = Math.sin(2 * TAU * p);
  P.root[1] += 0.01 * Math.max(0, r); P.root[2] += 0.012 * r;
  setR(P, 'chest', -2 * DEG * r, 0, 0);
  return P;
}
// Rubbing the eyes with the heel of the right hand, the head down into it.
const rubK = (p) => held(p, 0.1, 0.6);
function rubFacePose(p) {
  const P = stance(p), k = rubK(p), w = k * Math.sin(10 * TAU * p);
  armTo(P, 'L', 'hangL'); armTo(P, 'R', 'hangR', 'browR', k);
  setR(P, 'handR', 5 * DEG * w, 0, 4 * DEG * w);
  setR(P, 'neck', 3 * DEG * k, 0, 0); setR(P, 'head', 6 * DEG * k, -4 * DEG * k, 0);
  return P;
}
// Cracking the knuckles: the hands together at the belt, a squeeze, and another, the head down to watch.
function knucklesPose(p) {
  const P = stance(p), k = held(p, 0.08, 0.7), sq = bump(p, 0.3, 0.03) + bump(p, 0.52, 0.03);
  armTo(P, 'L', 'hangL', 'claspL', k); armTo(P, 'R', 'hangR', 'claspR', k);
  setR(P, 'farmL', -5 * DEG * sq, 0, 0); setR(P, 'farmR', -5 * DEG * sq, 0, 0);
  setR(P, 'head', (10 * k + 3 * sq) * DEG, 0, 0);
  return P;
}
// Rolling the shoulders and the neck loose, the arms hanging.
function rollPose(p) {
  const P = stance(p), k = held(p, 0.08, 0.74), a = 2 * TAU * p;
  armTo(P, 'L', 'hangL'); armTo(P, 'R', 'hangR');
  setR(P, 'uarmL', 7 * DEG * k * Math.sin(a), 0, 0.05 * k * Math.cos(a)); setR(P, 'uarmR', 7 * DEG * k * Math.sin(a + 0.6), 0, -0.05 * k * Math.cos(a + 0.6));
  setR(P, 'chest', 3 * DEG * k * Math.cos(a), 0, 2 * DEG * k * Math.sin(a));
  setR(P, 'neck', 7 * DEG * k * Math.cos(a), 0, 9 * DEG * k * Math.sin(a)); setR(P, 'head', 5 * DEG * k * Math.cos(a), 0, 6 * DEG * k * Math.sin(a));
  return P;
}
// Arms folded and a foot tapping.
function tapPose(p) {
  const P = waitPose(p), tap = Math.max(0, Math.sin(8 * TAU * p)) * held(p, 0.1, 0.7);
  // the right toes tapping, the heel down where it is and the weight on the left
  return plant(P, { L: IDLE_FEET.L, R: { ...IDLE_FEET.R, heel: -16 * tap } }, { weight: 0.62 });
}
// Stooping for something on the floor: the knees give and part, the back goes over, the right hand goes down to
// it with the left on the knee, and up again with it.
const stoopK = (p) => smooth(0.12, 0.34, p) * (1 - smooth(0.5, 0.74, p));
function pickUpPose(p) {
  const P = stance(p, false), k = stoopK(p);
  // down over the feet where they are, onto the balls, the hips going back as the back goes over
  plant(P, { L: { ...IDLE_FEET.L, heel: 22 * k }, R: { ...IDLE_FEET.R, heel: 16 * k } }, { weight: 0.45, sink: 0.42 * k, dz: -0.1 * k });
  setR(P, 'spine', 40 * DEG * k, 0, 0); setR(P, 'chest', 18 * DEG * k, 0, 0);
  arm(P, 'R', -2 - 62 * k, 0, -0.07, -10 + 4 * k, -6);
  arm(P, 'L', -2 - 34 * k, -18 * k, 0.07 + 0.12 * k, -12 - 44 * k, -8);
  setR(P, 'neck', -8 * DEG * k, 0, 0); setR(P, 'head', 6 * DEG * k, 0, 0);
  return P;
}
// Squats, two a cycle: down with the arms out in front for balance, and up.
function squatsPose(p) {
  const P = stance(p, false), k = 0.5 - 0.5 * Math.cos(2 * TAU * p);
  // a proper squat: feet shoulder-width and turned out, flat, the hips back and down, the arms out to balance
  plant(P, { L: { x: 0.15, z: 0.02, turn: 15 }, R: { x: -0.15, z: 0.02, turn: 15 } }, { sink: 0.36 * k, dz: -0.13 * k });
  setR(P, 'spine', 22 * DEG * k, 0, 0);
  arm(P, 'R', -2 - 80 * k, 0, -0.07, -12, -6); arm(P, 'L', -2 - 80 * k, 0, 0.07, -12, -6);
  setR(P, 'head', -10 * DEG * k, 0, 0);
  return P;
}
// Cold, not yet shaking: hunched, the arms folded tight and the hands rubbing the upper arms.
function coldRubPose(p) {
  const P = takeArms(stance(p), waitPose(p), ARM6), r = Math.sin(7 * TAU * p) * held(p, 0.05, 0.8);
  setR(P, 'farmR', (-8 + 5 * r) * DEG, 0, 0); setR(P, 'farmL', (-8 - 5 * r) * DEG, 0, 0);
  setR(P, 'spine', 4 * DEG, 0, 0); setR(P, 'chest', 5 * DEG, 0, 0);
  setR(P, 'neck', 6 * DEG, 0, 0); setR(P, 'head', 5 * DEG, 10 * DEG * Math.sin(TAU * p), 0);
  return P;
}
// Blowing into cupped hands: both up to the mouth, the head down to them, a breath and another.
const blowK = (p) => held(p, 0.12, 0.7);
const puffK = (p) => blowK(p) * Math.max(0, Math.sin(3 * TAU * p));
function coldBlowPose(p) {
  const P = stance(p), k = blowK(p), puff = puffK(p);
  armTo(P, 'L', 'hangL', 'cupL', k); armTo(P, 'R', 'hangR', 'cupR', k);
  setR(P, 'spine', 3 * DEG * k, 0, 0); setR(P, 'chest', (5 * k + 2 * puff) * DEG, 0, 0);
  setR(P, 'neck', 8 * DEG * k, 0, 0); setR(P, 'head', 12 * DEG * k, 0, 0);
  return P;
}
// Stamping the feet with the arms wrapped: one knee up and down, then the other, shaking all the while.
function coldStampPose(p) {
  const P = shiverPose(p), s = Math.sin(3 * TAU * p), a = Math.max(0, s) ** 2, b = Math.max(0, -s) ** 2;
  // stamping: each foot straight up and down on its own spot, the weight onto the other one while it's up
  return plant(P, { L: { ...IDLE_FEET.L, lift: 0.07 * a, heel: 12 * a }, R: { ...IDLE_FEET.R, lift: 0.07 * b, heel: 12 * b } },
    { weight: 0.5 + 0.45 * (Math.max(0, -s) ** 0.6 - Math.max(0, s) ** 0.6), sink: 0.015 });
}
// Too hot: fanning the face with the right hand, the head back.
function hotFanPose(p) {
  const P = stance(p), k = held(p, 0.08, 0.76), w = k * Math.sin(20 * TAU * p);
  armTo(P, 'L', 'hangL'); armTo(P, 'R', 'hangR', 'mouthR', 0.85 * k);
  setR(P, 'farmR', 3 * DEG * w, 0, 0); setR(P, 'handR', 0, 0, 22 * DEG * w);
  setR(P, 'chest', -2 * DEG * k, 0, 0); setR(P, 'head', -7 * DEG * k, 5 * DEG * k, 0);
  return P;
}
// The back of the wrist across the forehead and away, and a breath out after it.
function hotBrowPose(p) {
  const P = stance(p), k = held(p, 0.12, 0.5), sweep = smooth(0.2, 0.5, p), out = held(p, 0.62, 0.8);
  armTo(P, 'L', 'hangL'); armTo(P, 'R', 'hangR', 'browR', k);
  setR(P, 'uarmR', 0, (10 - 20 * sweep) * DEG * k, 0);
  setR(P, 'chest', 3 * DEG * out, 0, 0);
  setR(P, 'head', (8 * k + 5 * out) * DEG, (6 - 12 * sweep) * DEG * k, 0);
  return P;
}
// A finger in the collar, pulling it off the neck, the chin up and going round.
function hotTugPose(p) {
  const P = stance(p), k = held(p, 0.1, 0.7), tug = k * Math.max(0, Math.sin(4 * TAU * p));
  armTo(P, 'L', 'hangL'); armTo(P, 'R', 'hangR', 'collarR', k);
  setR(P, 'farmR', 7 * DEG * tug, 0, 0);
  setR(P, 'neck', -4 * DEG * k, 0, 0); setR(P, 'head', -8 * DEG * k, 10 * DEG * k * Math.sin(TAU * p), 0);
  return P;
}
// Hands on the hips, the head hung back, blowing out.
const sagK = (p) => held(p, 0.15, 0.6);
function hotSagPose(p) {
  const P = stance(p), k = sagK(p);
  armTo(P, 'L', 'hipL'); armTo(P, 'R', 'hipR');
  setR(P, 'chest', -4 * DEG * k, 0, 0); setR(P, 'neck', -6 * DEG * k, 0, 0);
  setR(P, 'head', (4 - 16 * k) * DEG, 6 * DEG * Math.sin(TAU * p), 0);
  return P;
}

// A cough into the hand, three of them.
const coughK =(p) => bump(p, 0.22, 0.02) + bump(p, 0.3, 0.02) + 0.8 * bump(p, 0.4, 0.025);
function coughPose(p) {
  const P = stance(p), k = held(p, 0.1, 0.55), c = coughK(p);
  armTo(P, 'L', 'hangL');
  handToMouth(P, 0.9 * k);
  setR(P, 'chest', 12 * DEG * c, 0, 0); setR(P, 'head', 10 * DEG * c, 0, 0);
  return P;
}
// On guard: the feet apart, the hands together low in front, the chest up, the head going round the room.
// At a dancer's pole, which stands a quarter of a metre in front of her: the right hand high on it, the
// weight on the left leg with the right knee bent and its heel up, the hips rolling round the pole once every four
// beats over sixteen, the chest a little behind them and the body leaning back, the left hand drawn up the body
// and away through the second half.
function poleHoldPose(p) {
  const P = stance(p, false), s = Math.sin(4 * TAU * p), c = Math.cos(4 * TAU * p), dip = onBeat(p, 16, 5), up = Math.sin(Math.PI * Math.max(0, 2 * p - 1)) ** 2;
  // the hips go round the pole over feet that stay put: mostly on the left, the right up on its ball with the
  // knee in, the weight easing onto it as the hips come round that side
  setR(P, 'pelvis', 3 * dip * DEG, 12 * DEG * s, 3 * DEG * c);
  footwork(P, 0.8 - 0.12 * Math.max(0, -s), { x: 0.1, z: -0.05, sink: 0.015 + 0.025 * dip, dx: 0.03 * s, dz: 0.03 * c, heel: 34, hike: 9 });
  arm(P, 'R', -152, 8, -0.08, -18, -10);
  arm(P, 'L', -26 + 12 * c - 120 * up, -30 + 40 * up, 0.26 + 0.2 * up, -58 + 30 * up, -10);
  setR(P, 'spine', -6 * DEG, -4 * DEG * Math.sin(4 * TAU * p - 0.8), 0); setR(P, 'chest', -6 * DEG, -8 * DEG * Math.sin(4 * TAU * p - 1.4), -4 * DEG * s);
  setR(P, 'head', (-8 - 8 * up) * DEG, 12 * DEG * Math.sin(4 * TAU * p - 1.9), 5 * DEG * s);
  return P;
}
// A kick at the pole over sixteen beats: the right hand high on it and the weight on the right foot, the left leg
// swept up and round in a fan through the second bar with the body leaning back from it and the left arm out for
// balance, then down and a hip roll till the end.
function poleKickPose(p) {
  const P = stance(p, false), k = smooth(0.2, 0.36, p) * (1 - smooth(0.48, 0.62, p)), arc = Math.sin(Math.PI * smooth(0.2, 0.62, p)), s = Math.sin(4 * TAU * p) * (1 - k);
  // the weight goes all onto the right foot before the kick (`ready`) and stays there till the leg's down, so the
  // kick comes off a leg that's already carrying her; then it's the hips swaying from foot to foot again
  const ready = smooth(0.12, 0.2, p) * (1 - smooth(0.62, 0.7, p));
  setR(P, 'pelvis', -8 * k * DEG, 10 * DEG * s, 0);
  // the foot comes straight up off its spot first, the knee leading, and only clear of the floor does the leg open
  // out into the fan; down, the same in reverse, so the foot lands where it left
  const off = smooth(0, 0.4, k), out = smooth(0.3, 1, k);
  footwork(P, mixN(0.5 + 0.3 * s, 0.04, ready), { x: 0.1, sink: 0.02, dx: 0.02 * s, dz: -0.04 * k, heel: 30, hike: 8, liftL: 0.2 * off });
  liftLeg(P, 'L', out, [-78, 0, 2 + 34 * arc], [6, 0, 0], [30, 0, 0]);
  setR(P, 'spine', -10 * k * DEG, 0, -4 * DEG * s); setR(P, 'chest', -10 * k * DEG, -6 * DEG * s, 0);
  arm(P, 'R', -152 + 10 * k, 8, -0.08, -18 + 10 * k, -10);
  arm(P, 'L', -26 - 54 * k, -30 + 20 * k, 0.26 + 0.8 * k, -58 + 46 * k, -10);
  setR(P, 'head', (-8 - 10 * k) * DEG, 10 * DEG * s, 0);
  return P;
}
// Both hands high on the pole, sinking slowly to a squat with the knees apart and the back arched, and up again.
function poleSlidePose(p) {
  const P = stance(p, false), k = 0.5 - 0.5 * Math.cos(TAU * p);
  // down the pole into a squat over a wide stance, toes and knees out, onto the balls of the feet at the bottom;
  // she's holding the pole, so the hips can stay further forward than a free squat's
  plant(P, { L: { x: 0.19, z: 0.1, ball: true, turn: 28, heel: 26 * k * k }, R: { x: -0.19, z: 0.1, ball: true, turn: 28, heel: 26 * k * k } },
    { sink: 0.42 * k, dz: -0.05 * k });
  arm(P, 'R', -166 + 40 * k, 4, -0.06, -10 - 30 * k, -10); arm(P, 'L', -166 + 40 * k, -4, 0.06, -10 - 30 * k, -10);
  setR(P, 'spine', (-8 + 22 * k) * DEG, 0, 0); setR(P, 'chest', -6 * DEG * (1 - k), 0, 0);
  setR(P, 'head', (-14 + 18 * k) * DEG, 0, 0);
  return P;
}

function guardPose(p) {
  const P = stance(p, false), look = Math.sin(TAU * p);
  plant(P, { L: { x: 0.16, z: 0.04, turn: 12 }, R: { x: -0.15, z: -0.02, turn: 10 } }, { weight: 0.5, sink: 0.015 });
  arm(P, 'R', -6, 70, -0.2, -50, -8); arm(P, 'L', -6, -70, 0.2, -50, -8);
  setR(P, 'chest', -3 * DEG, 0, 0);
  setR(P, 'neck', 0, 10 * DEG * look, 0); setR(P, 'head', 0, 20 * DEG * look, 0);
  return P;
}
// On the door: hands clasped low in front, the weight moved from foot to foot, a slow look right across the room
// that stops at each end before it comes back.
function guardScanPose(p) {
  const P = stance(p, false), k = held(p, 0.04, 0.84), s = Math.sin(TAU * p), look = Math.sign(s) * Math.pow(Math.abs(s), 0.45);
  plant(P, { L: { x: 0.17, z: 0.03, turn: 12 }, R: { x: -0.16, z: -0.02, turn: 10 } }, { weight: 0.5 + 0.12 * Math.sin(TAU * p + 1), sink: 0.012 });
  armTo(P, 'L', 'hangL', 'claspL', k); armTo(P, 'R', 'hangR', 'claspR', k);
  setR(P, 'chest', -2 * DEG, 6 * DEG * look, 0);
  setR(P, 'neck', 0, 12 * DEG * look, 0); setR(P, 'head', 2 * DEG, 26 * DEG * look, 0);
  return P;
}
// A hand up to the earpiece to listen, the head tipped to it and the eyes down, then the arms folded again.
function guardEarPose(p) {
  const P = stance(p, false), k = held(p, 0.15, 0.5), r = 1 - k;
  plant(P, { L: { x: 0.16, z: 0.04, turn: 12 }, R: { x: -0.15, z: -0.02, turn: 10 } }, { weight: 0.55, sink: 0.015 });
  arm(P, 'L', -6, -70, 0.2, -50, -8);
  // (the ear is half way from the collar to the back of the neck, ARM_AT's collarR and neckR)
  const G = [-6, 70, -0.2, -50, -8, 0], E = ARM_AT.collarR.map((v, i) => v + (ARM_AT.neckR[i] - v) * 0.55);
  // (the elbow goes out and the forearm turns first, so the hand comes up beside the face, not across it)
  const A = G.map((v, i) => v + (E[i] - v) * (i === 1 || i === 2 ? Math.sqrt(k) : k * k * (3 - 2 * k)));
  arm(P, 'R', A[0], A[1], A[2], A[3], A[4], A[5]);
  setR(P, 'chest', -3 * DEG, 0, 0);
  setR(P, 'neck', 4 * DEG * k, 0, -5 * DEG * k); setR(P, 'head', 10 * DEG * k, -8 * DEG * k, -10 * DEG * k);
  return P;
}
// Behind a counter with nobody to serve: squaring things on it, a hand at a time, then looking up at the door.
function tidyPose(p) {
  const P = stance(p), k = held(p, 0.08, 0.7), a = Math.sin(3 * TAU * p), b = Math.sin(3 * TAU * p + 2);
  setR(P, 'spine', 12 * DEG * k, 0, 0); setR(P, 'chest', 6 * DEG * k, 4 * DEG * a * k, 0);
  arm(P, 'R', -14 * k - 8 * a * k, 30, -0.1, -80 * k - 12 * a * k, -10 * k);
  arm(P, 'L', -14 * k - 8 * b * k, -30, 0.1, -80 * k - 12 * b * k, -10 * k);
  setR(P, 'head', (24 * k - 10 * (1 - k)) * DEG, 6 * DEG * a * k, 0);
  return P;
}

// ── In the stands: the fans' clips (gl/fan-vat.js bakes them). ──
// An arm solved to put the middle of its palm at `to`, given in the chest bone's own frame (metres:
// +x the figure's left, +y up the spine, +z ahead), so a target rides the lean of whatever body it's
// on. Coordinate descent on the shoulder's flexion, twist and abduction and the elbow, from a hanging
// arm, with a little pull back toward that arm so the elbow stays down and out. `base` names the body
// it's solved on ('stand' or 'sit'); the answer is kept by base, side and target, so a clip solves its
// handful of targets once and every frame after that is a lookup.
const _reach = new Map();
const PALM = [0, -0.085, 0.01];
function palmOf(W, side) {
  const m = W[B['hand' + side]];
  return [m[0] * PALM[0] + m[4] * PALM[1] + m[8] * PALM[2] + m[12], m[1] * PALM[0] + m[5] * PALM[1] + m[9] * PALM[2] + m[13], m[2] * PALM[0] + m[6] * PALM[1] + m[10] * PALM[2] + m[14]];
}
function reach(base, side, to) {
  const key = `${base}${side}${to.map((v) => v.toFixed(3)).join()}`;
  if (_reach.has(key)) return _reach.get(key);
  const body = base === 'sit' ? sitting(4) : stance(0);
  const C = fk(body)[B.chest];
  const T = [0, 1, 2].map((r) => C[r] * to[0] + C[4 + r] * to[1] + C[8 + r] * to[2] + C[12 + r]);
  const s = side === 'L' ? 1 : -1;
  // [flexion, twist, abduction, elbow], radians; the elbow only bends one way
  let v = [-0.3, 0.4 * s, 0.15 * s, -1.2];
  const rest = v.slice();
  const cost = (q) => {
    const P = { r: body.r.slice(), root: body.root.slice() };
    for (const b of ['uarm', 'farm', 'hand']) { const i = B[b + side] * 3; P.r[i] = P.r[i + 1] = P.r[i + 2] = 0; }
    const iu = B['uarm' + side] * 3, ifa = B['farm' + side] * 3;
    P.r[iu] = q[0]; P.r[iu + 1] = q[1]; P.r[iu + 2] = q[2]; P.r[ifa] = Math.min(0, q[3]);
    const p = palmOf(fk(P), side), d = [p[0] - T[0], p[1] - T[1], p[2] - T[2]];
    let e = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    for (let k = 0; k < 4; k++) e += 2e-4 * (q[k] - rest[k]) ** 2;
    // the elbow out from the body rather than across it
    e += 4e-3 * Math.max(0, -s * q[2]) ** 2;
    return e;
  };
  let best = cost(v);
  for (let step = 0.5; step > 1e-4; step *= 0.6) {
    for (let it = 0; it < 12; it++) {
      let moved = false;
      for (let k = 0; k < 4; k++) for (const d of [step, -step]) {
        const q = v.slice(); q[k] += d;
        const c = cost(q);
        if (c < best) { best = c; v = q; moved = true; }
      }
      if (!moved) break;
    }
  }
  _reach.set(key, v);
  return v;
}
// Set an arm to a solved reach, or part-way between two.
function reachTo(P, base, side, a, b = a, k = 0) {
  const u = reach(base, side, a), w = b === a ? u : reach(base, side, b);
  const q = u.map((x, i) => x + (w[i] - x) * k);
  zeroR(P, 'uarm' + side); zeroR(P, 'farm' + side); zeroR(P, 'hand' + side);
  setR(P, 'uarm' + side, q[0], q[1], q[2]); setR(P, 'farm' + side, Math.min(0, q[3]), 0, 0);
}
const mirrorX = (t) => [-t[0], t[1], t[2]];
// Sat quiet, hands in the lap: the seat every fan's other clips start from.
function fanSitPose(p) {
  const P = sitting(4), s = Math.sin(TAU * p);
  armTo(P, 'L', 'lapL'); armTo(P, 'R', 'lapR');
  setR(P, 'chest', 1.5 * DEG * Math.cos(TAU * p), 0, 0);
  setR(P, 'head', 3 * DEG, 6 * DEG * s, 0);
  return P;
}
// Getting up, `p` 0 sat to 1 stood: the two poses mixed on the joints, so the knees and the arms
// swing round rather than cut through the seat. Played by how far up he is, not by the clock.
function fanRisePose(p) {
  const A = fanSitPose(0), Z = stance(0), k = smooth(0, 1, p), P = newPose();
  armTo(Z, 'L', 'hangL'); armTo(Z, 'R', 'hangR');
  for (let i = 0; i < P.r.length; i++) P.r[i] = A.r[i] + (Z.r[i] - A.r[i]) * k;
  P.root = A.root.map((v, i) => v + (Z.root[i] - v) * k);
  // half-way up he leans forward over his feet, as anybody getting out of a seat does
  setR(P, 'spine', 22 * DEG * Math.sin(Math.PI * k), 0, 0);
  return P;
}
// Clapping: the palms meet in front of the chest twice a cycle and part to a shoulder's width.
const CLAP_IN = [0.025, 0.06, 0.3], CLAP_OUT = [0.17, 0.1, 0.27];
const SIT_CLAP_IN = [0.025, -0.02, 0.3], SIT_CLAP_OUT = [0.16, 0.02, 0.27];
function clapArms(P, base, p, inn, out) {
  // shut fast and open slower, so the beat is on the meeting
  const c = Math.pow(0.5 + 0.5 * Math.cos(2 * TAU * p), 0.6);
  reachTo(P, base, 'L', out, inn, c); reachTo(P, base, 'R', mirrorX(out), mirrorX(inn), c);
}
function fanClapPose(p) {
  const P = stance(p);
  clapArms(P, 'stand', p, CLAP_IN, CLAP_OUT);
  setR(P, 'head', -3 * DEG, 4 * DEG * Math.sin(TAU * p), 0);
  return P;
}
function fanSitClapPose(p) {
  const P = sitting(10);
  clapArms(P, 'sit', p, SIT_CLAP_IN, SIT_CLAP_OUT);
  setR(P, 'head', 0, 4 * DEG * Math.sin(TAU * p), 0);
  return P;
}
// One fist punched up, over and over, the other on the hip.
const FIST_LOW = [-0.24, 0.42, 0.16], FIST_HIGH = [-0.2, 0.86, 0.12];
function fanFistPose(p) {
  const P = stance(p);
  armTo(P, 'L', 'hipL');
  // up hard and down easy, twice a cycle
  const q = (2 * p) % 1, k = q < 0.3 ? smooth(0, 0.3, q) : 1 - smooth(0.3, 1, q);
  reachTo(P, 'stand', 'R', FIST_LOW, FIST_HIGH, k);
  setR(P, 'chest', -4 * DEG * k, 6 * DEG, 0);
  setR(P, 'head', -10 * DEG * k, 0, 0);
  return P;
}
// Shouting through the hands, leant into it.
function fanCupPose(p) {
  const P = stance(p), s = Math.sin(TAU * p);
  armTo(P, 'L', 'cupL'); armTo(P, 'R', 'cupR');
  setR(P, 'spine', (6 + 3 * s) * DEG, 0, 0);
  setR(P, 'head', (-6 - 3 * s) * DEG, 0, 0);
  return P;
}
// A rally towel whirled over the head in the right hand, the left fist going with it.
const TOWEL_C = [-0.14, 0.8, 0.12];
function fanTowelPose(p) {
  const P = stance(p), a = TAU * p, r = 0.16;
  // a few points round the circle, solved once each, and the arm eased between the two either side
  const N = 6, f = p * N, i = Math.floor(f) % N, j = (i + 1) % N;
  const at = (n) => [TOWEL_C[0] + r * Math.cos(TAU * n / N), TOWEL_C[1], TOWEL_C[2] + r * Math.sin(TAU * n / N)];
  reachTo(P, 'stand', 'R', at(i), at(j), f - Math.floor(f));
  reachTo(P, 'stand', 'L', [0.22, 0.5, 0.18], [0.2, 0.62, 0.16], 0.5 + 0.5 * Math.sin(a));
  setR(P, 'head', -6 * DEG, 0, 0);
  return P;
}
// Sat, both hands on top of the head: the other lot have scored.
function fanDespairPose(p) {
  const P = sitting(18), s = Math.sin(TAU * p);
  reachTo(P, 'sit', 'L', [0.07, 0.56, 0.04]); reachTo(P, 'sit', 'R', [-0.07, 0.56, 0.04]);
  setR(P, 'neck', 8 * DEG, 0, 0);
  setR(P, 'head', (10 + 3 * s) * DEG, 8 * DEG * Math.sin(TAU * p * 0.5), 0);
  return P;
}
// Every clip the fans play. `k` clips are played by a value (fanRise by how far up he is), the rest
// loop on the clock. ROOM's own seated clips (sitRest, sitLean, sitFold) are baked beside these.
const FAN_CLIPS = [
  { name: 'fanSit', dur: 9, fn: fanSitPose },
  { name: 'fanRise', dur: 1, fn: fanRisePose, k: true },
  { name: 'fanClap', dur: 0.9, fn: fanClapPose },
  { name: 'fanSitClap', dur: 0.9, fn: fanSitClapPose },
  { name: 'fanFist', dur: 1.4, fn: fanFistPose },
  { name: 'fanCup', dur: 2.2, fn: fanCupPose },
  { name: 'fanTowel', dur: 1.1, fn: fanTowelPose },
  { name: 'fanDespair', dur: 7, fn: fanDespairPose },
];
export const ACTOR_FAN_CLIPS = FAN_CLIPS.map(({ name, dur, k }) => ({ name, dur, k: !!k }));
// A fan clip's pose at `p` as skin matrices, the lowest point of the body not yet dropped to the
// ground (the bake does that, as it does for its own clips). Any clip actorSkinAt knows, too.
export function actorFanSkin(name, p) {
  const c = FAN_CLIPS.find((x) => x.name === name);
  return c ? skinMats(fk(c.fn(c.k ? Math.min(1, Math.max(0, p)) : ((p % 1) + 1) % 1))) : actorSkinAt(name, p);
}

// Frames per clip and seconds per cycle. The walk's cycle time is only its nominal pace: in the game
// its phase follows the distance walked (see actorStrideM), so it is never read as a clock.
// The standing clips are slow, so they bake few frames; the shader blends between neighbours.
const CLIPS = [
  { name: 'walk', frames: 32, dur: 1.10, fn: walkPose, walk: true },
  { name: 'idle', frames: 48, dur: 4.0, fn: idlePose },
  { name: 'wave', frames: 32, dur: 1.6, fn: wavePose },
  { name: 'talk', frames: 32, dur: 4.4, fn: talkPose },
  { name: 'listen', frames: 24, dur: 6.0, fn: listenPose },
  { name: 'wait', frames: 16, dur: 6.0, fn: waitPose },
  { name: 'phone', frames: 20, dur: 6.0, fn: phonePose },
  { name: 'smoke', frames: 36, dur: 9.0, fn: smokePose },
  { name: 'sit', frames: 12, dur: 8.0, fn: sitPose },
  { name: 'cheer', frames: 16, dur: 1.2, fn: cheerPose },
  // ⚠ NEW CLIPS GO ON THE END: windshield.js PARK_CLIP and the arms' figure lists index this list.
  // A smoker's (glass/street-life.js): leaning on a wall with one going or with the arms folded, and walking with
  // one, which is the walk four strides at a time (`of`, `n`): 16 frames a stride, where the walk has 32, because
  // nobody close enough to count them is drawn with the bake.
  { name: 'leanSmoke', frames: 36, dur: 9.0, fn: leanSmokePose },
  { name: 'leanWall', frames: 16, dur: 6.0, fn: leanWallPose },
  { name: 'walkSmoke', frames: 16 * WALK_SMOKE_STRIDES, dur: 1.10 * WALK_SMOKE_STRIDES, fn: walkSmokePose, walk: true, of: 'walk', n: WALK_SMOKE_STRIDES },
  // Out cold on the ground: somebody the vehicle you're in has knocked flying (windshield.js streetRag) lands in it.
  { name: 'sprawl', frames: 8, dur: 9, fn: sprawlPose },
  // At the beach (plugins/beach, windshield.js drawBeachProps): on a towel in the sun, and out in the water.
  { name: 'sunbathe', frames: 12, dur: 14, fn: sunbathePose },
  { name: 'swim', frames: 24, dur: 1.6, fn: swimPose },
];
export const ACTOR_CLIPS = CLIPS.map(({ name, frames, dur }) => ({ name, frames, dur }));
// The clips that walk, whose phase is the distance walked over actorStrideM(name) rather than the clock.
export const ACTOR_WALKS = new Set(CLIPS.filter((c) => c.walk).map((c) => c.name));
// The clips with a cigarette in the right hand, which gl/actor-smoke.js draws and lights.
export const ACTOR_SMOKES = new Set(['smoke', 'leanSmoke', 'walkSmoke']);
// Never baked: actorSkinAt plays them. 'once' runs from its start and holds there, so the Stage
// gives it a phase of its own (room-stage.js eased) rather than a looping one.
const ROOM_CLIPS = [
  { name: 'prep', dur: 6.0, fn: prepPose },
  { name: 'snort', dur: 6.5, fn: snortPose, once: true },
  { name: 'inject', dur: 7.5, fn: injectPose, once: true },
  { name: 'swallow', dur: 5.0, fn: swallowPose, once: true },
  { name: 'huff', dur: 7.0, fn: huffPose, once: true },
  { name: 'drink', dur: 6.0, fn: drinkPose, once: true },
  { name: 'idleShift', dur: 10, fn: idleShiftPose }, { name: 'idleLook', dur: 10, fn: idleLookPose },
  { name: 'idleHip', dur: 10, fn: hipPose }, { name: 'idleHipR', dur: 10, fn: hipRPose },
  { name: 'idleHips', dur: 10, fn: hipsPose }, { name: 'idleLookUp', dur: 10, fn: lookUpPose }, { name: 'idleWipe', dur: 10, fn: idleWipePose },
  { name: 'idleCough', dur: 10, fn: idleCoughPose, face: (p) => ({ open: 0.32 * Math.min(1, idleCoughK(p)), round: 0.4 }) },
  { name: 'idleCollar', dur: 10, fn: collarPose }, { name: 'idleClasp', dur: 10, fn: claspPose }, { name: 'idleShrug', dur: 10, fn: idleShrugPose },
  { name: 'idleSwing', dur: 10, fn: swingPose }, { name: 'idleSway', dur: 10, fn: swayPose },
  { name: 'idlePockets', dur: 10, fn: pocketsPose }, { name: 'idleBehind', dur: 10, fn: behindPose },
  { name: 'idleScratch', dur: 10, fn: scratchPose }, { name: 'idleNeck', dur: 10, fn: neckPose },
  { name: 'idleWatch', dur: 10, fn: watchPose }, { name: 'idleStretch', dur: 10, fn: stretchPose },
  { name: 'idleYawn', dur: 10, fn: yawnPose, face: (p) => ({ open: yawnK(p), shut: yawnK(p) }) },
  { name: 'idleSigh', dur: 10, fn: sighPose, face: (p) => ({ open: 0.22 * smooth(0.38, 0.44, p) * (1 - smooth(0.54, 0.66, p)), round: 0.5 }) },
  { name: 'sitRest', dur: 10, fn: sitRestPose }, { name: 'sitClasp', dur: 10, fn: sitClaspPose },
  { name: 'sitLean', dur: 10, fn: sitLeanPose }, { name: 'sitBack', dur: 10, fn: sitBackPose }, { name: 'sitSprawl', dur: 12, fn: sitSprawlPose }, { name: 'sitBar', dur: 9, fn: sitBarPose }, { name: 'sitBarSmoke', dur: 11, fn: sitBarSmokePose }, { name: 'sitFold', dur: 10, fn: sitFoldPose },
  { name: 'sitMug', dur: 10, fn: sitMugPose }, { name: 'sitCan', dur: 9, fn: sitCanPose }, { name: 'sitBook', dur: 12, fn: sitBookPose },
  { name: 'sitRemote', dur: 8, fn: sitRemotePose }, { name: 'sitGame', dur: 6, fn: gamePose(0) }, { name: 'lieBook', dur: 12, fn: lieBookPose },
  { name: 'sitCross', dur: 12, fn: sitCrossPose }, { name: 'sitCrossR', dur: 12, fn: sitCrossRPose }, { name: 'sitAnkles', dur: 11, fn: sitAnklesPose }, { name: 'sitTuck', dur: 9, fn: sitTuckPose },
  // side by side with somebody (ACTOR_PAIR_ACTS): the other one on the left, and on the right
  ...[['sitChat', sitChatPose, 6], ['sitListen', sitListenPose, 6], ['sitLaughPair', sitLaughPairPose, 5, LAUGH_FACE], ['sitShowPhone', sitShowPhonePose, 7], ['sitLookPhone', sitLookPhonePose, 7], ['sitNudge', sitNudgePose, 4, LAUGH_FACE], ['sitNudged', sitNudgedPose, 4],
    ['sitCheers', sitCheersPose, 6], ['sitGamePair', gamePose(0, 0.3), 5], ['sitGameWin', gamePose(1, 0.8), 5, LAUGH_FACE], ['sitGameLose', gamePose(-1), 5], ['sitPassRemote', sitPassRemotePose, 5]]
    .flatMap(([n, fn, dur, face]) => [{ name: n + 'L', dur, fn, ...(face ? { face } : {}) }, { name: n + 'R', dur, fn: toRight(fn), ...(face ? { face } : {}) }]),
  { name: 'sitPhone', dur: 6, fn: sitPhonePose }, { name: 'sitRead', dur: 9, fn: sitReadPose }, { name: 'sitDrink', dur: 10, fn: sitDrinkPose },
  { name: 'sitSmoke', dur: 9, fn: sitSmokePose }, { name: 'sitDrive', dur: 6, fn: sitDrivePose }, { name: 'sitDriveWave', dur: 1.6, fn: sitDriveWavePose }, { name: 'sitDoze', dur: 10, fn: sitDozePose, face: () => ({ shut: 1 }) },
  { name: 'sitSlump', dur: 10, fn: sitSlumpPose, face: () => ({ shut: 1, open: 0.18 }) },
  // at a table with a habit (client/shared/table-stash.js): the stage gives the phase, off the session's clock
  { name: 'sitCut', dur: 8, fn: sitCutPose }, { name: 'sitLine', dur: 8, fn: sitLinePose, face: (p) => ({ shut: smooth(0.5, 0.56, p) * (1 - smooth(0.8, 0.9, p)) }) },
  { name: 'sitSort', dur: 6, fn: sitSortPose }, { name: 'sitPill', dur: 6.5, fn: sitPillPose, face: (p) => ({ open: 0.2 * smooth(0.28, 0.32, p) * (1 - smooth(0.36, 0.4, p)) }) },
  { name: 'sitPack', dur: 6, fn: sitPackPose }, { name: 'sitPipe', dur: 11, fn: sitPipePose, face: (p) => ({ round: smooth(0.62, 0.68, p) * (1 - smooth(0.84, 0.96, p)), open: 0.15 * smooth(0.62, 0.68, p) * (1 - smooth(0.84, 0.96, p)) }) },
  { name: 'sitCook', dur: 9, fn: sitCookPose }, { name: 'sitTie', dur: 10, fn: sitOf(injectPose, 12) },
  { name: 'sitShake', dur: 4, fn: sitShakePose }, { name: 'sitHuff', dur: 9, fn: sitOf(huffPose, 6) }, { name: 'sitPour', dur: 5, fn: sitPourPose },
  { name: 'lieBack', dur: 12, fn: lieBackPose }, { name: 'lieArm', dur: 10, fn: lieArmPose }, { name: 'liePhone', dur: 8, fn: liePhonePose }, { name: 'liePress', dur: 12, fn: liePressPose, face: (p) => ({ shut: 0.35 * (((p * 4) % 1) > 0.45 && ((p * 4) % 1) < 0.85 ? 1 : 0), open: 0.25 * (((p * 4) % 1) > 0.55 && ((p * 4) % 1) < 0.85 ? 1 : 0) }) },
  { name: 'lieSide', dur: 12, fn: lieSidePose },
  { name: 'sleepSide', dur: 9, fn: sleepSidePose, face: () => ({ shut: 1 }) },
  { name: 'sleepBack', dur: 9, fn: sleepBackPose, face: () => ({ shut: 1, open: 0.12 }) },
  { name: 'sprawl', dur: 9, fn: sprawlPose, face: () => ({ shut: 1, open: 0.22 }) },
  { name: 'wipe', dur: 6, fn: wipePose }, { name: 'guitar', dur: 8, fn: guitarPose }, { name: 'polish', dur: 6, fn: polishPose }, { name: 'stir', dur: 5, fn: stirPose },
  // behind a bar
  { name: 'pour', dur: 6, fn: pourPose }, { name: 'shakeTin', dur: 5, fn: shakeTinPose }, { name: 'tapPull', dur: 6, fn: tapPullPose },
  { name: 'checkBottle', dur: 6, fn: checkBottlePose }, { name: 'slideGlass', dur: 4, fn: slideGlassPose },
  { name: 'rummage', dur: 7, fn: rummagePose }, { name: 'wash', dur: 5, fn: washPose }, { name: 'counter', dur: 10, fn: counterPose },
  { name: 'fridgeOpen', dur: 1.6, fn: fridgeOpenPose, once: true }, { name: 'fridgeOpenR', dur: 1.6, fn: (p) => mirrored(fridgeOpenPose(p)), once: true },
  { name: 'fridgeLook', dur: 7, fn: fridgeLookPose }, { name: 'fridgeLookR', dur: 7, fn: (p) => mirrored(fridgeLookPose(p)) },
  { name: 'shower', dur: 8, fn: showerPose, face: (p) => ({ shut: held(p, 0.04, 0.4) }) },
  { name: 'count', dur: 8, fn: countPose }, { name: 'write', dur: 8, fn: writePose },
  { name: 'eat', dur: 8, fn: eatPose, face: (p) => ({ open: chewK(p) }) }, { name: 'sitEat', dur: 8, fn: sitOf(eatPose, 12), face: (p) => ({ open: chewK(p) }) },
  { name: 'squatStir', dur: 6, fn: squatStirPose },
  { name: 'laugh', dur: 5, fn: laughPose, face: (p) => ({ open: 0.45 * laughK(p) * (0.7 + 0.3 * Math.sin(14 * TAU * p)) }) },
  { name: 'shrug', dur: 4, fn: shrugPose }, { name: 'cower', dur: 6, fn: cowerPose, face: () => ({ open: 0.2, round: 0.3 }) },
  // a dancer's, each a whole number of beats at the club's 124 bpm (DANCE_BEAT)
  { name: 'dance', dur: 8 * DANCE_BEAT, fn: dancePose }, { name: 'poleHold', dur: 16 * DANCE_BEAT, fn: poleHoldPose }, { name: 'poleSlide', dur: 16 * DANCE_BEAT, fn: poleSlidePose }, { name: 'poleLean', dur: 16 * DANCE_BEAT, fn: poleLeanPose },
  { name: 'poleKick', dur: 16 * DANCE_BEAT, fn: poleKickPose }, { name: 'bodyRoll', dur: 8 * DANCE_BEAT, fn: bodyRollPose }, { name: 'hairWhip', dur: 8 * DANCE_BEAT, fn: hairWhipPose },
  { name: 'hipCircle', dur: 8 * DANCE_BEAT, fn: hipCirclePose }, { name: 'dropLow', dur: 8 * DANCE_BEAT, fn: dropLowPose }, { name: 'backArch', dur: 8 * DANCE_BEAT, fn: backArchPose },
  { name: 'lookBack', dur: 8 * DANCE_BEAT, fn: lookBackPose }, { name: 'shimmy', dur: 4 * DANCE_BEAT, fn: shimmyPose }, { name: 'kneelRoll', dur: 16 * DANCE_BEAT, fn: kneelRollPose },
  { name: 'tipTake', dur: 3.4, fn: tipTakePose, once: true, face: (p) => ({ round: 0.9 * kissK(p), open: 0.08 * kissK(p) }) },
  // and the punters': a note held out, and cheering her on
  // a street dealer at his spot: on a wall, and on open ground
  { name: 'dealerLean', dur: DEALER_DUR, fn: dealerLeanPose, face: (p) => ({ shut: 0.6 * bump(p, 11.85 / DEALER_DUR, 0.004) }) },
  { name: 'dealerStand', dur: DEALER_DUR, fn: dealerStandPose, face: (p) => ({ shut: 0.6 * bump(p, 11.85 / DEALER_DUR, 0.004) }) },
  { name: 'tipOffer', dur: 2.6, fn: tipOfferPose, once: true }, { name: 'sitTipOffer', dur: 2.6, fn: sitOf(tipOfferPose, 18), once: true },
  { name: 'fistPump', dur: 4 * DANCE_BEAT, fn: fistPumpPose, face: (p) => ({ open: 0.3 * (bump(p, 0.02, 0.06) + bump(p, 0.52, 0.06)) }) }, { name: 'sitFistPump', dur: 4 * DANCE_BEAT, fn: sitOf(fistPumpPose, 4), face: (p) => ({ open: 0.3 * (bump(p, 0.02, 0.06) + bump(p, 0.52, 0.06)) }) },
  { name: 'billWave', dur: 4 * DANCE_BEAT, fn: billWavePose }, { name: 'sitBillWave', dur: 4 * DANCE_BEAT, fn: sitOf(billWavePose, 6) },
  { name: 'undress', dur: 9, fn: undressPose, once: true }, { name: 'strip', dur: 6, fn: stripPose, once: true }, { name: 'redress', dur: 4.5, fn: redressPose, once: true }, { name: 'shiver', dur: 6, fn: shiverPose },
  { name: 'vatFloat', dur: 11, fn: vatFloatPose, face: () => ({ shut: 1 }) },
  { name: 'cough', dur: 5, fn: coughPose, face: (p) => ({ open: 0.4 * coughK(p) }) }, { name: 'guard', dur: 12, fn: guardPose },
  { name: 'guardScan', dur: 14, fn: guardScanPose }, { name: 'guardEar', dur: 8, fn: guardEarPose }, { name: 'tidy', dur: 9, fn: tidyPose },
  // a show's stage directions, on their feet and in a chair
  { name: 'point', dur: 3, fn: pointPose }, { name: 'sitPoint', dur: 3, fn: sitOf(pointPose) },
  { name: 'handsOut', dur: 6, fn: handsOutPose, once: true },
  { name: 'spread', dur: 3.5, fn: spreadPose, face: (p) => ({ open: 0.25 * held(p, 0.12, 0.72) }) }, { name: 'sitSpread', dur: 3.5, fn: sitOf(spreadPose) },
  { name: 'slam', dur: 2.6, fn: slamPose, once: true }, { name: 'sitSlam', dur: 2.6, fn: sitOf(slamPose, 14), once: true },
  { name: 'holdup', dur: 4, fn: holdupPose }, { name: 'sitHoldup', dur: 4, fn: sitOf(holdupPose) },
  { name: 'flex', dur: 3.5, fn: flexPose, face: (p) => ({ open: 0.15 * held(p, 0.12, 0.76) }) }, { name: 'sitFlex', dur: 3.5, fn: sitOf(flexPose) },
  { name: 'clap', dur: 3, fn: clapPose }, { name: 'sitClap', dur: 3, fn: sitOf(clapPose) },
  { name: 'highFive', dur: 2.4, fn: (p) => highFivePose(p), once: true }, { name: 'highFiveL', dur: 2.4, fn: highFiveLPose, once: true },
  { name: 'fistBump', dur: 2.2, fn: (p) => fistBumpPose(p), once: true }, { name: 'fistBumpL', dur: 2.2, fn: fistBumpLPose, once: true }, { name: 'hug', dur: 6, fn: hugPose },
  { name: 'shake', dur: 3, fn: shakePose, once: true }, { name: 'toast', dur: 5, fn: toastPose },
  // a group of friends at a party (plugins/outings scenes.js); the beat clips are whole beats at the club's tempo
  { name: 'groove', dur: 8 * DANCE_BEAT, fn: groovePose }, { name: 'toastUp', dur: 6, fn: toastUpPose, face: (p) => ({ open: 0.3 * bump(p, 0.3, 0.04) }) },
  { name: 'huddle', dur: 7, fn: huddlePose }, { name: 'chug', dur: 6, fn: chugPose, face: (p) => ({ open: 0.45 * bump(p, 0.9, 0.04), shut: 0.6 * smooth(0.2, 0.7, p) * chugK(p) }) },
  { name: 'chant', dur: 4 * DANCE_BEAT, fn: chantPose, face: (p) => ({ open: 0.4 * onBeat(p, 4, 6) }) },
  { name: 'pointLaugh', dur: 5, fn: pointLaughPose, face: (p) => ({ open: 0.45 * pointLaughK(p) * (0.7 + 0.3 * Math.sin(14 * TAU * p)), shut: 0.5 * pointLaughK(p) }) },
  { name: 'canoodle', dur: 9, fn: canoodlePose, face: () => ({ shut: 0.5 }) },
  { name: 'swaySing', dur: 8 * DANCE_BEAT, fn: swaySingPose, face: (p) => ({ open: 0.2 + 0.25 * (held(p, 0.4, 0.58) + held(p, 0.86, 0.95)), round: 0.3 }) },
  { name: 'reach', dur: 3, fn: reachPose }, { name: 'sitReach', dur: 3, fn: sitOf(reachPose, 18) },
  { name: 'stare', dur: 8, fn: starePose }, { name: 'sitStare', dur: 8, fn: sitStarePose },
  { name: 'wink', dur: 2, fn: winkPose, face: (p) => ({ shut: winkK(p) }) }, { name: 'sitWink', dur: 2, fn: sitOf(winkPose), face: (p) => ({ shut: winkK(p) }) },
  { name: 'leanIn', dur: 4, fn: leanInPose },
  { name: 'stumble', dur: 2.8, fn: stumblePose, once: true, face: (p) => ({ open: 0.3 * held(p, 0.05, 0.5), round: 0.5 }) },
  { name: 'toss', dur: 2.4, fn: tossPose, once: true }, { name: 'sitToss', dur: 2.4, fn: sitOf(tossPose), once: true },
  // at a card table
  { name: 'knock', dur: 7, fn: knockPose },
  { name: 'sitRap', dur: 1.8, fn: sitRapPose, once: true }, { name: 'sitMuck', dur: 2, fn: sitMuckPose, once: true },
  { name: 'sitChips', dur: 2.2, fn: sitChipsPose, once: true },
  { name: 'deal', dur: 2.4, fn: dealPose }, { name: 'sitDeal', dur: 2.4, fn: sitOf(dealPose, 10) },
  { name: 'adjust', dur: 4, fn: adjustPose }, { name: 'sitAdjust', dur: 4, fn: sitOf(adjustPose) },
  // more to idle at, on their feet and in a chair
  { name: 'idleRock', dur: 10, fn: rockPose }, { name: 'idleRub', dur: 10, fn: rubFacePose, face: (p) => ({ shut: rubK(p) }) },
  { name: 'idleKnuckles', dur: 10, fn: knucklesPose }, { name: 'idleRoll', dur: 10, fn: rollPose }, { name: 'idleTap', dur: 6, fn: tapPose },
  { name: 'pickUp', dur: 5, fn: pickUpPose }, { name: 'squats', dur: 6, fn: squatsPose },
  { name: 'sitStretch', dur: 10, fn: sitOf(stretchPose, -4) }, { name: 'sitYawn', dur: 10, fn: sitOf(yawnPose, 2), face: (p) => ({ open: yawnK(p), shut: yawnK(p) }) },
  { name: 'sitScratch', dur: 10, fn: sitOf(scratchPose) }, { name: 'sitNeck', dur: 10, fn: sitOf(neckPose) }, { name: 'sitWatch', dur: 10, fn: sitOf(watchPose) },
  { name: 'sitRub', dur: 10, fn: sitOf(rubFacePose, 12), face: (p) => ({ shut: rubK(p) }) },
  // a room too cold, and too hot
  { name: 'coldRub', dur: 6, fn: coldRubPose }, { name: 'coldBlow', dur: 7, fn: coldBlowPose, face: (p) => ({ open: 0.2 * puffK(p), round: 0.8 }) },
  { name: 'coldStamp', dur: 5, fn: coldStampPose },
  { name: 'sitShiver', dur: 6, fn: sitOf(shiverPose, 14) }, { name: 'sitColdRub', dur: 6, fn: sitOf(coldRubPose, 12) },
  { name: 'sitBlow', dur: 7, fn: sitOf(coldBlowPose, 14), face: (p) => ({ open: 0.2 * puffK(p), round: 0.8 }) },
  { name: 'hotFan', dur: 6, fn: hotFanPose }, { name: 'hotBrow', dur: 6, fn: hotBrowPose }, { name: 'hotTug', dur: 6, fn: hotTugPose },
  { name: 'hotSag', dur: 8, fn: hotSagPose, face: (p) => ({ open: 0.22 * sagK(p), round: 0.6 }) },
  { name: 'sitFan', dur: 6, fn: sitOf(hotFanPose, -2) }, { name: 'sitBrow', dur: 6, fn: sitOf(hotBrowPose, 4) }, { name: 'sitTug', dur: 6, fn: sitOf(hotTugPose, 2) },
];
// What somebody does with nothing to do, as [clip, how often]: gl/room-people.js gives them one for each
// slot of ten seconds or so, off their id and the clock.
export const ACTOR_IDLES = {
  stand: [['idle', 5], ['idleShift', 2], ['idleLook', 2], ['idleHip', 1.5], ['idleHipR', 1.5], ['idlePockets', 2], ['idleBehind', 1], ['wait', 1.5], ['listen', 1],
    ['idleScratch', 0.7], ['idleNeck', 0.7], ['idleWatch', 0.7], ['idleStretch', 0.4], ['idleYawn', 0.4], ['idleSigh', 0.7],
    ['idleRock', 1.2], ['idleTap', 0.8], ['idleRoll', 0.6], ['idleRub', 0.5], ['idleKnuckles', 0.5],
    ['idleHips', 1.2], ['idleSway', 1.5], ['idleClasp', 1.2], ['idleLookUp', 0.7], ['idleSwing', 0.6], ['idleShrug', 0.4], ['idleCough', 0.4], ['idleWipe', 0.4], ['idleCollar', 0.5], ...MOOD_IDLES.stand],
  sit: [['sitRest', 4], ['sitSprawl', 1.5], ['sitBack', 2.5], ['sitCross', 2], ['sitCrossR', 2], ['sitAnkles', 1.5], ['sitTuck', 1], ['sitClasp', 1], ['sitLean', 0.8], ['sitFold', 1.5], ['sitPhone', 1], ['sitRead', 0.6],
    ['sitScratch', 0.5], ['sitNeck', 0.5], ['sitWatch', 0.5], ['sitStretch', 0.4], ['sitYawn', 0.4], ['sitRub', 0.4], ...MOOD_IDLES.sit],
  // on a sofa or an armchair (gl/room-people.js HOME_SEAT): the same, and the things people do at home
  sitHome: [['sitRest', 3], ['sitSprawl', 1.5], ['sitBack', 2], ['sitCross', 2], ['sitCrossR', 2], ['sitAnkles', 2], ['sitTuck', 1], ['sitPhone', 1.5], ['sitScroll', 1],
    ['sitMug', 2], ['sitCan', 1.5], ['sitBook', 1.5], ['sitRemote', 2], ['sitGame', 1.2], ['sitFold', 1], ['sitYawn', 0.4], ['sitStretch', 0.4]],
  lieHome: [['lieBack', 3], ['lieArm', 2], ['liePhone', 2], ['lieSide', 2], ['lieBook', 2]],
  // a room past room temperature, mild and then harsh (client/shared/comfort.js feelBand): gl/room-people.js
  // gives somebody one of these in place of their own for some of their slots, more of them the worse it is
  cool: [['coldRub', 3], ['wait', 2], ['coldBlow', 1], ['shiver', 0.5]],
  cold: [['shiver', 3], ['coldStamp', 2], ['coldBlow', 2], ['coldRub', 1.5]],
  sitCool: [['sitFold', 2], ['sitColdRub', 2], ['sitBlow', 1]],
  sitCold: [['sitShiver', 3], ['sitBlow', 1.5], ['sitColdRub', 1.5]],
  warm: [['hotFan', 2], ['hotTug', 2], ['hotBrow', 1], ['idleSigh', 1]],
  hot: [['hotFan', 2.5], ['hotBrow', 2.5], ['hotSag', 2], ['hotTug', 1.5]],
  sitWarm: [['sitFan', 2], ['sitTug', 1.5], ['sitBack', 1]],
  sitHot: [['sitFan', 3], ['sitBrow', 2], ['sitBack', 1.5], ['sitTug', 1]],
  // lying down awake, asleep, and out cold
  lie: [['lieBack', 4], ['lieArm', 2], ['liePhone', 2], ['lieSide', 2]],
  sleep: [['sleepSide', 3], ['sleepBack', 2]],
  out: [['sprawl', 1]],
  // asleep or out cold in a chair, with nowhere to lie
  sitSleep: [['sitDoze', 1]], sitOut: [['sitSlump', 1]],
  // at work: behind a bar, behind a shop counter, on guard; and somebody living rough
  bar: [['wipe', 2.5], ['polish', 2.5], ['pour', 2], ['tapPull', 1.5], ['shakeTin', 1.2], ['checkBottle', 0.8], ['slideGlass', 0.8], ['counter', 2], ['idle', 1.5], ['wait', 1], ['idleLook', 1], ['count', 0.5]],
  shop: [['counter', 3], ['idle', 2], ['tidy', 2], ['count', 1.5], ['write', 1.5], ['wait', 1.5], ['idleWatch', 1], ['idleLook', 1], ['idleBehind', 1]],
  // a dancer on shift: at her pole, or working the floor where there isn't one
  pole: [['poleHold', 3], ['poleLean', 2.5], ['poleSlide', 2.5], ['poleKick', 1.5], ['dance', 1], ['bodyRoll', 1], ['backArch', 1], ['hairWhip', 0.5]],
  floorwork: [['dance', 3], ['hipCircle', 2], ['bodyRoll', 2], ['shimmy', 1.5], ['lookBack', 1.5], ['dropLow', 1.5], ['backArch', 1], ['hairWhip', 1], ['kneelRoll', 0.8]],
  // half undressed or more (plugins/roomstage `peel`): no standing about, more of the big moves
  poleHot: [['poleLean', 3], ['poleSlide', 3], ['poleKick', 2], ['poleHold', 1.5], ['bodyRoll', 1.5], ['dropLow', 1], ['backArch', 1], ['hairWhip', 1]],
  floorHot: [['bodyRoll', 3], ['dropLow', 2.5], ['hipCircle', 2], ['hairWhip', 2], ['kneelRoll', 2], ['dance', 2], ['lookBack', 1.5], ['backArch', 1.5]],
  // somebody in the room watching a dancer (plugins/roomstage `punter`): looking, clapping, a note in the air
  punter: [['stare', 3], ['clap', 1.5], ['fistPump', 1], ['billWave', 1], ['leanIn', 1], ['idleHip', 1], ['idle', 1], ['wink', 0.5]],
  sitPunter: [['sitStare', 3], ['sitBack', 2], ['sitClap', 1.5], ['sitFistPump', 1], ['sitBillWave', 1], ['sitLean', 1], ['sitDrink', 1], ['sitWink', 0.5]],
  guard: [['guard', 4], ['guardScan', 2.5], ['guardEar', 1], ['wait', 1.5], ['idleBehind', 2], ['idleLook', 1], ['idle', 1]],
  rough: [['idle', 3], ['shiver', 1.5], ['idleScratch', 1.5], ['cough', 1], ['idleNeck', 1], ['wait', 1], ['idleSigh', 1]],
};
// How long one of those is held before the next: a sleeper turns over now and then, not every ten seconds.
// A dancer's is eight bars, so every clip of hers plays a whole number of times in it (gl/room-people.js starts it on a bar).
export const ACTOR_IDLE_SLOT = { sleep: 45, out: 60, lie: 20, sitSleep: 30, sitOut: 60, pole: 32 * DANCE_BEAT, floorwork: 32 * DANCE_BEAT, poleHot: 32 * DANCE_BEAT, floorHot: 32 * DANCE_BEAT };
// The lists that keep the club's beat: their slots start on a bar, not anywhere off the id.
export const ACTOR_ON_BEAT = new Set(['pole', 'floorwork', 'poleHot', 'floorHot']);
// What a body does when an emote line says it's doing something (client/shared/npc-acts.js names the act),
// by how it is: on its feet, sitting, lying. Missing means it carries on as it was.
export const ACTOR_ACTS = {
  rap: { sit: 'sitRap' }, muck: { stand: 'toss', sit: 'sitMuck' }, chips: { stand: 'reach', sit: 'sitChips' }, deal: { stand: 'deal', sit: 'sitDeal' },
  smoke: { stand: 'smoke', sit: 'sitSmoke' }, phone: { stand: 'phone', sit: 'sitPhone', lie: 'liePhone' },
  read: { stand: 'phone', sit: 'sitRead', lie: 'liePhone' }, drink: { stand: 'drink', sit: 'sitDrink' },
  eat: { stand: 'eat', sit: 'sitEat' }, wipe: { stand: 'wipe' }, guitar: { stand: 'guitar' }, polish: { stand: 'polish' }, stir: { stand: 'stir' },
  pour: { stand: 'pour', sit: 'sitPour' }, mix: { stand: 'shakeTin' }, pint: { stand: 'tapPull' }, slide: { stand: 'slideGlass' }, eye: { stand: 'checkBottle' },
  rummage: { stand: 'rummage' }, wash: { stand: 'wash' }, lean: { stand: 'counter', sit: 'sitLean' }, count: { stand: 'count' },
  write: { stand: 'write', sit: 'sitRead' }, laugh: { stand: 'laugh', sit: 'sitBack' }, shrug: { stand: 'shrug' },
  cower: { stand: 'cower' }, dance: { stand: 'dance' }, undress: { stand: 'undress' }, strip: { stand: 'strip' }, redress: { stand: 'redress' }, shiver: { stand: 'shiver', sit: 'sitShiver' }, cough: { stand: 'cough' },
  blow: { stand: 'coldBlow', sit: 'sitBlow' }, swelter: { stand: 'hotFan', sit: 'sitFan' }, brow: { stand: 'hotBrow', sit: 'sitBrow' }, tug: { stand: 'hotTug', sit: 'sitTug' },
  stoop: { stand: 'pickUp' }, exercise: { stand: 'squats' }, press: { lie: 'liePress' }, rub: { stand: 'idleRub', sit: 'sitRub' }, knuckles: { stand: 'idleKnuckles', sit: 'sitClasp' },
  rock: { stand: 'idleRock' }, tap: { stand: 'idleTap', sit: 'sitClasp' }, roll: { stand: 'idleRoll', sit: 'sitNeck' },
  fold: { stand: 'wait', sit: 'sitFold' }, yawn: { stand: 'idleYawn', sit: 'sitBack' }, stretch: { stand: 'idleStretch', sit: 'sitBack' },
  sigh: { stand: 'idleSigh', sit: 'sitBack', lie: 'lieArm' }, scratch: { stand: 'idleScratch' }, look: { stand: 'idleLook', sit: 'sitRest', lie: 'lieBack' },
  time: { stand: 'idleWatch' }, wave: { stand: 'wave' }, nod: { stand: 'listen', sit: 'sitClasp' }, wait: { stand: 'wait', sit: 'sitClasp' },
  doze: { sit: 'sitDoze', lie: 'sleepSide' },
  point: { stand: 'point', sit: 'sitPoint' }, spread: { stand: 'spread', sit: 'sitSpread' }, slam: { stand: 'slam', sit: 'sitSlam' },
  holdup: { stand: 'holdup', sit: 'sitHoldup' }, flex: { stand: 'flex', sit: 'sitFlex' }, clap: { stand: 'clap', sit: 'sitClap' },
  reach: { stand: 'reach', sit: 'sitReach' }, grab: { stand: 'reach', sit: 'sitReach' }, stare: { stand: 'stare', sit: 'sitStare', lie: 'lieBack' },
  lens: { stand: 'stare', sit: 'sitStare' }, wink: { stand: 'wink', sit: 'sitWink' }, leanin: { stand: 'leanIn', sit: 'sitLean' },
  stumble: { stand: 'stumble' }, toss: { stand: 'toss', sit: 'sitToss' }, adjust: { stand: 'adjust', sit: 'sitAdjust' },
  slouch: { stand: 'counter', sit: 'sitBar' }, barsmoke: { stand: 'smoke', sit: 'sitBarSmoke' }, brace: { stand: 'guard' }, enter: { stand: 'idleLook', sit: 'sitRest' },
  ...MOOD_ACTS,
};
// A man's seat: the same clip on his set of legs (SEAT_WIDE): knees out over his feet with the toes pointing out,
// or the ankle up on the knee where she'd cross her legs. What the clip did to the shins and feet on top of its set
// (a heel tapping) is kept. gl/room-people.js plays '<clip>Wide' for a man. Driving and sprawled legs are left as
// they are, and so is any clip that didn't sit on a set.
const WIDE_SKIP = /^sit(Drive|Sprawl)/;
function wideKnees(P) {
  const to = SEAT_WIDE[P.legs], from = LEG_R[P.legs];
  if (!to || !from) return P;
  const keep = LEG_BONES.map((b, j) => [0, 1, 2].map((k) => P.r[B[b] * 3 + k] - from[j][k]));
  seatLegs(P, to);
  LEG_BONES.forEach((b, j) => { if (!b.startsWith('thigh')) for (let k = 0; k < 3; k++) P.r[B[b] * 3 + k] += keep[j][k]; });
  return P;
}
// ROOM's gaits (actor-gait.js): walks solved by IK from where the feet go, each with its own stride
ROOM_CLIPS.push(...gaitClips({ newPose, setR, zeroR, fk, B, BONES, REST, bump, smooth, TAU, DEG, aimFoot }));
// panic, and more to idle at (actor-moods.js); its seated ones are already sitOf's, so they get their Wide below
ROOM_CLIPS.push(...moodClips({ stance, arm, setR, held, bump, smooth, TAU, DEG, sitOf, plant, feet: IDLE_FEET, poses: { pockets: pocketsPose, wait: waitPose } }));
for (const c of ROOM_CLIPS.slice()) {
  if (c.name.startsWith('sit') && !WIDE_SKIP.test(c.name)) ROOM_CLIPS.push({ ...c, name: c.name + 'Wide', fn: (p) => wideKnees(c.fn(p)) });
}
export const ACTOR_ROOM_CLIPS = ROOM_CLIPS.map(({ name, dur, once }) => ({ name, dur, once: !!once }));
export const ACTOR_BONE = B;

// ── Root motion. The clip plays in place and the instance moves at a constant speed, so for the
// stance foot to stay put the pelvis has to surge ahead when the legs are fast and drop back when
// they are slow. The surge is baked into the clip, and its average speed is the stride. Solved on
// first use rather than at import, because windshield.js imports this module at boot. ──────────────
function solveRoot(clip) {
  if (clip.surge) return;
  // a walk played n strides to a cycle (walkSmoke) takes its root off the walk it's made of
  if (clip.of) {
    const w = CLIPS.find((c) => c.name === clip.of);
    solveRoot(w);
    clip.stride = w.stride * clip.n;
    clip.surge = (p) => w.surge((p * clip.n) % 1);
    return;
  }
  // Points along each sole in the foot bone's own frame, heel to toe: the shoe's own sole line
  // (figure.js figureSole), which curves up at the heel and the toe. The one lowest on the ground is
  // what the foot is pivoting on, so it's the one that has to stay still: locking the ankle instead
  // lets the heel skate at strike and the toes skate at push-off. Past the ball of the foot a point
  // rides the toe bone, which stays flat while the heel comes up.
  const SOLE = figureSole().map(([z, y]) => [0, y - REST[B.footL][1], z]);
  const BALL = BONES[B.toeL][2];
  const S = 256, pts = [];
  for (let i = 0; i <= S; i++) {
    const W = fk(clip.fn((i / S) % 1));
    pts.push([[B.footL, B.toeL], [B.footR, B.toeR]].map(([f, t]) => {
      const m = W[f];
      return { ankle: m[13], sole: SOLE.map(([x, y, z]) => {
        const [M, px, py, pz] = z > BALL[2] ? [W[t], x - BALL[0], y - BALL[1], z - BALL[2]] : [m, x, y, z];
        return [M[1] * px + M[5] * py + M[9] * pz + M[13], M[2] * px + M[6] * py + M[10] * pz + M[14]];
      }) };
    }));
  }
  const v = new Float64Array(S);
  let mean = 0;
  for (let i = 0; i < S; i++) {
    // The lowest point of either sole is the foot that's down and its pivot. (The lower ankle used to
    // choose the foot, which in double support pinned the leading heel while the trailing toe was
    // still the lowest thing on the body and slid.)
    let foot = 0, k = 0;
    for (let f = 0; f < 2; f++) { const s = pts[i][f].sole; for (let j = 0; j < s.length; j++) if (s[j][0] < pts[i][foot].sole[k][0]) { foot = f; k = j; } }
    const sole = pts[i][foot].sole;
    v[i] = -(pts[i + 1][foot].sole[k][1] - sole[k][1]);
    mean += v[i] / S;
  }
  const surge = new Float64Array(S + 1);
  for (let i = 0; i < S; i++) surge[i + 1] = surge[i] + v[i] - mean;
  const avg = surge.reduce((x, y) => x + y, 0) / (S + 1);
  clip.stride = mean * S;
  clip.surge = (p) => { const x = p * S, i = Math.floor(x), t = x - i; return surge[i] + (surge[Math.min(S, i + 1)] - surge[i]) * t - avg; };
}
// Metres covered by one walk cycle (two steps). A walker's phase is distance / stride.
// `name` is any walk clip: the street's `walk` or one of ROOM's gaits.
export function actorStrideM(name = 'walk') {
  const c = CLIPS.find((x) => x.name === name && x.walk) || ROOM_CLIPS.find((x) => x.name === name && x.walk) || CLIPS[0];
  solveRoot(c); return c.stride;
}

// ── Half floats: the pose textures cost 8 bytes a texel instead of 16. ─────────────────────────────
const _f = new Float32Array(1), _u = new Uint32Array(_f.buffer);
function toHalf(v) {
  _f[0] = v; const x = _u[0];
  const sign = (x >>> 16) & 0x8000;
  let e = ((x >>> 23) & 0xff) - 127 + 15, m = x & 0x7fffff;
  if (e <= 0) { if (e < -10) return sign; m = (m | 0x800000) >> (1 - e); return sign | ((m + 0x1000) >> 13); }
  if (e >= 31) return sign | 0x7c00;
  let h = sign | (e << 10) | (m >> 13);
  if (m & 0x1000) h++;
  return h;
}

// ── The bake ───────────────────────────────────────────────────────────────────────────────────────
// Every vertex skinned for every frame of every clip, written as texels: a column per vertex (wrapped
// so no row is wider than 1024, well inside WebGL2's guaranteed 2048), a band of `rows` rows per frame.
// Positions and normals are separate RGBA16F textures of the same shape. Built once and kept:
//
//   { nv, nt, W, rows, H, frames, pos, nrm, mat, idx, top, clips: { walk|idle|wave: { row0, len, dur } },
//     preview, bones, far }  where `preview` is the unhalved positions, frame-major, for the gate and
//     the Modelshop, `bones` is the head and neck matrices (see ACTOR_HEAD_BONES), and `far` is the
//     same shape again for the lod-1 body (see buildBody) at half the frames, without `bones`.
//
// The whole bake is about 2 ms a frame, 112 frames, so the game takes it in slices (actorBakeStep)
// and draws the billboard until it is done, rather than stalling one frame for a quarter of a second.
//
// The head (actor-head.js) isn't baked: it's rigid on the head bone, and its neck blends the head
// bone into the neck bone, so a frame of it is two matrices rather than a column per vertex. The
// near bake writes them into `bones`, a frame a row of ACTOR_HEAD_BONES.texels RGBA32F texels: the
// head's matrix then the neck's, each as its three rows [m00 m01 m02 tx], [m10 …], [m20 …]. Each
// takes a bind-space point to where the bake puts it, root surge and drop to the ground included,
// so a head drawn with them sits on the body exactly. Rows line up with the pose texture's frames
// (a clip's row0 is its first row here too).
//
// The game's near body has no head of its own (buildBody `head` false), so its `top` is measured off
// the old head riding the head bone, which is the number the old head gave. windshield.js sizes
// everybody from it, so nobody changes height when their head does.
//
// With ACTOR_BAKE.hd on there's a near and a far bake for each of ACTOR_SILHOUETTES, in `sils`, and the
// bake itself is the first of them, so a reader that knows nothing of silhouettes gets the coat. Every
// silhouette's near body stands on the first one's ground (`ground`, a frame's drop), so the one set of
// head bones fits them all. The whole of it is several seconds of work, so in a browser it goes to a
// worker (actor-bake-worker.js) and the street draws the billboard until it's back.
// The right hand rides along at 6, for the cigarette (gl/actor-smoke.js).
export const ACTOR_HEAD_BONES = { texels: 9, head: 0, neck: 3, handR: 6 };
let _bake = null, _job = null, _done = [], _bakeHead = null, _worker = null;
// The far body's clips have half the frames: at a few pixels nobody can count them.
const clipFrames = (clip, lod) => (lod ? clip.frames >> 1 : clip.frames);
const silCount = () => (ACTOR_BAKE.hd ? ACTOR_SILHOUETTES.length : 1);
function bakeBegin(lod = 0, head = true, sil = 0, ground = null) {
  for (const c of CLIPS) if (c.walk) solveRoot(c);
  const M = buildBody(lod, head, sil);
  const nv = M.p.length / 3, rows = Math.ceil(nv / 1024), W = Math.ceil(nv / rows);
  const frames = CLIPS.reduce((x, c) => x + clipFrames(c, lod), 0), H = frames * rows;
  // The old head's points on the head bone alone, to measure `top` with when the head isn't baked.
  let crown = null;
  if (!head) {
    const F = buildBody(lod, true, sil), c = [];
    for (let v = 0; v < F.w.length; v++) if (F.b0[v] === B.head && F.b1[v] === B.head) c.push(F.p[v * 3], F.p[v * 3 + 1], F.p[v * 3 + 2]);
    crown = new Float64Array(c);
  }
  return {
    lod, sil, nv, nt: M.i.length / 3, W, rows, H, frames, top: 0, ci: 0, f: 0, F: 0, clips: {}, crown,
    ground: ground || new Float32Array(frames), ownGround: !ground,
    pos: new Uint16Array(W * H * 4), nrm: new Uint16Array(W * H * 4), preview: new Float32Array(nv * frames * 3),
    bones: lod ? null : new Float32Array(frames * ACTOR_HEAD_BONES.texels * 4),
    skel: lod ? null : new Float32Array(frames * BONES.length * 12),
    P: new Float32Array(nv * 3), Nn: new Float32Array(nv * 3), mat: new Float32Array(M.m), body: Float32Array.from({ length: nv * 4 }, (_, i) => M.body[i] || 0),
    rp: new Float64Array(M.p), rw: new Float64Array(M.w), b0: new Uint8Array(M.b0), b1: new Uint8Array(M.b1), ix: new Uint16Array(M.i),
  };
}
function bakeFrame(J) {
  const clip = CLIPS[J.ci], len = clipFrames(clip, J.lod);
  if (J.f === 0) J.clips[clip.name] = { row0: J.F, len, dur: clip.dur };
  const { nv, W, rows, P, Nn, rp, rw, b0, b1, ix, pos, nrm } = J;
  const ph = J.f / len, pose = clip.fn(ph);
  if (clip.surge) pose.root[2] += clip.surge(ph);
  const S = skinMats(fk(pose));
  let minY = Infinity;
  for (let v = 0; v < nv; v++) {
    const x = rp[v * 3], y = rp[v * 3 + 1], z = rp[v * 3 + 2], w = rw[v], u = 1 - w;
    const a = S[b0[v]], b = S[b1[v]];
    const px = w * (a[0] * x + a[4] * y + a[8] * z + a[12]) + u * (b[0] * x + b[4] * y + b[8] * z + b[12]);
    const py = w * (a[1] * x + a[5] * y + a[9] * z + a[13]) + u * (b[1] * x + b[5] * y + b[9] * z + b[13]);
    const pz = w * (a[2] * x + a[6] * y + a[10] * z + a[14]) + u * (b[2] * x + b[6] * y + b[10] * z + b[14]);
    P[v * 3] = px; P[v * 3 + 1] = py; P[v * 3 + 2] = pz;
    if (py < minY) minY = py;
  }
  // Height: whichever foot is lowest touches the ground. The walk's bob comes out of this. A
  // silhouette after the first stands on the first one's ground, so the heads fit it too.
  if (J.ownGround) J.ground[J.F] = minY; else minY = J.ground[J.F];
  const idle = clip.name === 'idle';
  for (let v = 0; v < nv; v++) { const y = (P[v * 3 + 1] -= minY); if (idle && y > J.top) J.top = y; }
  if (idle && J.crown) {
    const h = S[B.head], C = J.crown;
    for (let i = 0; i < C.length; i += 3) { const y = h[1] * C[i] + h[5] * C[i + 1] + h[9] * C[i + 2] + h[13] - minY; if (y > J.top) J.top = y; }
  }
  Nn.fill(0);
  for (let t = 0; t < ix.length; t += 3) {
    const i0 = ix[t] * 3, i1 = ix[t + 1] * 3, i2 = ix[t + 2] * 3;
    const ux = P[i1] - P[i0], uy = P[i1 + 1] - P[i0 + 1], uz = P[i1 + 2] - P[i0 + 2];
    const vx = P[i2] - P[i0], vy = P[i2 + 1] - P[i0 + 1], vz = P[i2 + 2] - P[i0 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    Nn[i0] += nx; Nn[i0 + 1] += ny; Nn[i0 + 2] += nz;
    Nn[i1] += nx; Nn[i1 + 1] += ny; Nn[i1 + 2] += nz;
    Nn[i2] += nx; Nn[i2 + 1] += ny; Nn[i2 + 2] += nz;
  }
  const F = J.F;
  for (let v = 0; v < nv; v++) {
    const o = ((F * rows + Math.floor(v / W)) * W + (v % W)) * 4;
    const nx = Nn[v * 3], ny = Nn[v * 3 + 1], nz = Nn[v * 3 + 2], l = Math.hypot(nx, ny, nz) || 1;
    pos[o] = toHalf(P[v * 3]); pos[o + 1] = toHalf(P[v * 3 + 1]); pos[o + 2] = toHalf(P[v * 3 + 2]); pos[o + 3] = 0x3c00;
    nrm[o] = toHalf(nx / l); nrm[o + 1] = toHalf(ny / l); nrm[o + 2] = toHalf(nz / l); nrm[o + 3] = 0;
  }
  J.preview.set(P, F * nv * 3);
  if (J.bones) {
    for (const [bone, at] of [[B.head, ACTOR_HEAD_BONES.head], [B.neck, ACTOR_HEAD_BONES.neck], [B.handR, ACTOR_HEAD_BONES.handR]]) {
      const m = S[bone], o = (F * ACTOR_HEAD_BONES.texels + at) * 4;
      for (let r = 0; r < 3; r++) {
        J.bones[o + r * 4] = m[r]; J.bones[o + r * 4 + 1] = m[4 + r]; J.bones[o + r * 4 + 2] = m[8 + r];
        J.bones[o + r * 4 + 3] = m[12 + r] - (r === 1 ? minY : 0);
      }
    }
  }
  if (J.skel) {
    // every bone, as the head's three are: an outfit body (actorOutfitBody) skins from these on the GPU
    for (let bone = 0; bone < BONES.length; bone++) {
      const m = S[bone], o = (F * BONES.length + bone) * 12;
      for (let r = 0; r < 3; r++) {
        J.skel[o + r * 4] = m[r]; J.skel[o + r * 4 + 1] = m[4 + r]; J.skel[o + r * 4 + 2] = m[8 + r];
        J.skel[o + r * 4 + 3] = m[12 + r] - (r === 1 ? minY : 0);
      }
    }
  }
  J.F++;
  if (++J.f >= len) { J.f = 0; J.ci++; }
  return J.ci >= CLIPS.length;
}
const bakeOut = (J) => ({ nv: J.nv, nt: J.nt, W: J.W, rows: J.rows, H: J.H, frames: J.frames, pos: J.pos, nrm: J.nrm,
  mat: J.mat, body: J.body, idx: J.ix, top: J.top, clips: J.clips, preview: J.preview, bones: J.bones, skel: J.skel, sil: J.sil, ground: J.ground });
// The next job: each silhouette's near body (without its head) and then its far one. `_done` holds
// the finished ones in that order.
function nextJob() {
  const k = _done.length, s = k >> 1, far = k & 1;
  if (s >= silCount()) return null;
  return far ? bakeBegin(1, true, s) : bakeBegin(0, false, s, s ? _done[0].ground : null);
}
function bakeFinish() {
  const sils = [];
  for (let s = 0; s < _done.length; s += 2) sils.push({ ..._done[s], far: _done[s + 1] });
  return { ...sils[0], sils };
}
// The HD bake in a worker, when there's a browser to have one: true while it runs or once it's back,
// false if this can't (no Worker, or it failed), and the bake goes on in slices here instead.
function bakeInWorker() {
  if (_worker !== null) return _worker !== false;
  try {
    if (typeof Worker !== 'function' || typeof document === 'undefined') { _worker = false; return false; }
    const w = new Worker(new URL('./actor-bake-worker.js', import.meta.url), { type: 'module' });
    _worker = w;
    w.onmessage = (e) => { if (e.data && e.data.bake && _worker === w) _bake = e.data.bake; w.terminate(); };
    w.onerror = () => { w.terminate(); if (_worker === w) _worker = false; };
    w.postMessage({ hd: ACTOR_BAKE.hd });
    return true;
  } catch { _worker = false; return false; }
}
// Bake for up to `budgetMs`, then return: the finished bake once there is one, null until then.
// The near body (without its head) bakes first and the far one after it, a silhouette at a time; the
// bake is ready once all of them are.
export function actorBakeStep(budgetMs = 2) {
  if (_bake) return _bake;
  if (ACTOR_BAKE.hd && budgetMs !== Infinity && bakeInWorker()) return _bake;
  if (!_job) _job = nextJob();
  const t0 = performance.now();
  for (;;) {
    if (bakeFrame(_job)) {
      _done.push(bakeOut(_job));
      _job = nextJob();
      if (!_job) { _bake = bakeFinish(); return _bake; }
    }
    if (performance.now() - t0 >= budgetMs) return null;
  }
}
// The finished bake if there is one, without doing any work.
export const actorBakeReady = () => _bake;
// Throw the bake away, so the next step starts again: after flipping ACTOR_BAKE.hd in the lab or the
// console. gl/actors.js sees the new bake and uploads it.
export function actorBakeReset() {
  if (_worker && _worker !== false) _worker.terminate();
  _bake = null; _job = null; _done = []; _bakeHead = null; _worker = null;
}
// The whole bake at once, for the gate and the Modelshop. `head: true` is the near body with its old
// head on, which the Actor Lab finds its parts in and the gate measures the bones against; its far
// body is the game's.
// It doesn't wait for every silhouette: a room asks for this, and only needs the coat.
export function actorBake({ head = false } = {}) {
  if (!head) return actorBakeStep(Infinity);
  if (!_bakeHead) {
    const run = (J) => { while (!bakeFrame(J)); return bakeOut(J); };
    const near = run(bakeBegin(0, true));
    _bakeHead = { ...near, far: _bake ? _bake.far : run(bakeBegin(1, true)), sils: _bake ? _bake.sils : null };
  }
  return _bakeHead;
}
// A clip's pose at `phase` as skin matrices, one a bone (column-major 4×4, bind space to the clip's
// own, the walk's root surge in but not the drop to the ground): for a figure posed on the CPU and
// skinned on the GPU (gl/room-people.js figurePeople). `name` is an ACTOR_CLIPS, ACTOR_ROOM_CLIPS or
// ACTOR_FAN_CLIPS name (the stands' close-up fans, gl/crowd-hd.js, play the fans' own clips).
const clipNamed = (name) => CLIPS.find((c) => c.name === name) || ROOM_CLIPS.find((c) => c.name === name) || FAN_CLIPS.find((c) => c.name === name) || CLIPS[1];
// a clip's phase: a loop's wrapped, a fan clip played by a value (fanRise) held between 0 and 1
const phaseIn = (clip, ph) => (clip.k ? Math.min(1, Math.max(0, ph)) : ((ph % 1) + 1) % 1);
export function actorSkinAt(name, phase) {
  const clip = clipNamed(name);
  if (clip.walk) solveRoot(clip);
  const ph = phaseIn(clip, phase), pose = clip.fn(ph);
  if (clip.surge) pose.root[2] += clip.surge(ph);
  return skinMats(fk(pose));
}

// Several clips at once, each by its weight ([[name, phase, weight], …]), mixed on the pose as actorSkinMix
// mixes two: what a fan in the stands is doing, sat, getting up and cheering at once as gl/crowd.js FAN_GLSL
// mixes his baked frames. None may be the walk.
export function actorSkinBlend(list) {
  const P = newPose();
  let sum = 0;
  for (const [name, ph, w] of list) {
    if (!(w > 0.001)) continue;
    const clip = clipNamed(name), A = clip.fn(phaseIn(clip, ph));
    for (let i = 0; i < P.r.length; i++) P.r[i] += A.r[i] * w;
    for (let i = 0; i < 3; i++) P.root[i] += A.root[i] * w;
    sum += w;
  }
  if (!(sum > 0)) return actorSkinAt('idle', 0);
  for (let i = 0; i < P.r.length; i++) P.r[i] /= sum;
  for (let i = 0; i < 3; i++) P.root[i] /= sum;
  return skinMats(fk(P));
}

// Two clips part-way from one to the other, mixed on the pose, not the matrices, so an arm swings round
// rather than cutting through the body. Neither may be the walk.
export function actorSkinMix(a, pa, b, pb, k) {
  const pose = (name, ph) => { const clip = clipNamed(name); return clip.fn(phaseIn(clip, ph)); };
  const A = pose(a, pa), Bp = pose(b, pb), P = newPose();
  for (let i = 0; i < P.r.length; i++) P.r[i] = A.r[i] + (Bp.r[i] - A.r[i]) * k;
  P.root = A.root.map((v, i) => v + (Bp.root[i] - v) * k);
  return skinMats(fk(P));
}
// What a clip does to the face at `phase`: { open, round, shut }, or null if nothing.
export function actorClipFace(name, phase) {
  const c = ROOM_CLIPS.find((x) => x.name === name);
  return c?.face ? c.face(((phase % 1) + 1) % 1) : null;
}

// The body unposed, in bind space, with each vertex's two bones and the first one's weight: for the
// gate, which measures the head's matrices against it. Built fresh; the game never calls it.
export function actorBind(lod = 0, head = true) {
  const M = buildBody(lod, head);
  return { p: new Float32Array(M.p), b0: new Uint8Array(M.b0), b1: new Uint8Array(M.b1), w: new Float32Array(M.w), mat: new Uint8Array(M.m), idx: new Uint16Array(M.i) };
}
// The body without its head, cut down to `tris` triangles from the sculpted figure in silhouette `sil`
// (ACTOR_SILHOUETTES), for the stands' fans (gl/fan-vat.js), who bake their own clips and wear their
// own head. As actorBind, plus `body`: how far each point moves along its normal for the three builds
// and a woman's, four a vertex, in metres. Kept by its arguments.
export function actorFanBody({ tris = 430, sil = 0 } = {}) {
  const M = buildBody(1, false, sil, tris);
  return { p: new Float32Array(M.p), b0: new Uint8Array(M.b0), b1: new Uint8Array(M.b1), w: new Float32Array(M.w), mat: new Uint8Array(M.m), idx: new Uint16Array(M.i), body: new Float32Array(M.body) };
}

// ── Outfit bodies: a crowd body for each outfit's shape ───────────────────────────────────────────
// The four silhouettes above are baked a vertex a frame, about 8 MB each, so a skirt, shorts or a hat
// can't have one, and somebody walking up changed shape as the close-up figure took over. An outfit body
// is the close-up figure in that person's cut, bottoms and hat, cut down to the crowd's budget as
// hdBody cuts the silhouettes, and posed on the GPU from the bake's bone matrices (bk.skel), so it plays
// every clip at no cost but its own vertices. Colours stay per person, on the instance.
//
// `shape` is { cut, bottoms, hat } (streetLook hands it over as `shape`). Returned in bind space:
// p and n (the figure's own normals), mb (the crowd's material slot, first bone, second bone, the first
// one's weight), body (as hdBody's) and i. The head stays actor-head.js's, as the silhouettes'.
export const OUTFIT_BODY = { on: 1, tris: 3600, hats: 1, keep: 64 };
export const outfitKey = (sh) => (sh ? `${sh.cut || 'coat'}|${sh.bottoms || ''}|${OUTFIT_BODY.hats ? sh.hat || '' : ''}` : '');
export function actorOutfitBody(shape, tris = OUTFIT_BODY.tris) {
  const spec = { cut: shape.cut || 'coat', bottoms: shape.bottoms || '', hat: OUTFIT_BODY.hats ? shape.hat || '' : '' };
  const at = (weight = null, build = 'average') => buildFigure({ ...spec, level: 'hd', sculpt: true, weight, build });
  const F = at();
  const keep = [];
  for (let t = 0; t < F.I.length; t += 3) {
    const a = F.I[t], b = F.I[t + 1], c = F.I[t + 2];
    if (!HD_DROP.has(F.S[a]) && !HD_DROP.has(F.S[b]) && !HD_DROP.has(F.S[c])) keep.push(a, b, c);
  }
  const cls = Uint8Array.from(F.S, (s) => SLOT_MAT[s] ?? (s === FIG_SLOT.hat ? HAIR : COAT));
  const skin = (v) => { const o = []; for (let k = 0; k < 4; k++) if (F.W[v * 4 + k] > 0) o.push([F.B[v * 4 + k], F.W[v * 4 + k]]); return o; };
  const { ids, I } = simplifyMesh({ P: F.P, I: keep, cls, skin, target: tris });
  const E = at(0), Me = at(0.5), En = at(1), Wo = at(0.5, 'woman');
  const same = [E, Me, En, Wo].every((G) => G.nv === F.nv);
  const along = (G, v, H = F) => (G.P[v * 3] - H.P[v * 3]) * F.N[v * 3] + (G.P[v * 3 + 1] - H.P[v * 3 + 1]) * F.N[v * 3 + 1] + (G.P[v * 3 + 2] - H.P[v * 3 + 2]) * F.N[v * 3 + 2];
  const bake = (b) => (b === FIGURE_BONE.clavL || b === FIGURE_BONE.clavR ? FIGURE_BONE.chest : b);
  const nv = ids.length, out = { key: outfitKey(spec), nv, p: new Float32Array(nv * 3), n: new Float32Array(nv * 3), mb: new Float32Array(nv * 4), body: new Float32Array(nv * 4), i: new Uint16Array(I) };
  ids.forEach((v, k) => {
    for (let j = 0; j < 3; j++) { out.p[k * 3 + j] = F.P[v * 3 + j]; out.n[k * 3 + j] = F.N[v * 3 + j]; }
    const w0 = F.W[v * 4], w1 = F.W[v * 4 + 1];
    out.mb[k * 4] = cls[v]; out.mb[k * 4 + 1] = bake(F.B[v * 4]); out.mb[k * 4 + 2] = bake(w1 > 0 ? F.B[v * 4 + 1] : F.B[v * 4]); out.mb[k * 4 + 3] = w0 / (w0 + w1 || 1);
    if (same) { out.body[k * 4] = along(E, v); out.body[k * 4 + 1] = along(Me, v); out.body[k * 4 + 2] = along(En, v); out.body[k * 4 + 3] = along(Wo, v, Me); }
  });
  return out;
}
// The outfit bodies built so far, by outfitKey, and the ones asked for. Each takes a second or so (five
// close-up figures and a simplify), so in a browser they're built in a worker one at a time, and whoever
// wears one waiting is drawn in their silhouette until it's back. Without a worker (Node, the gates) it's
// built where it's asked for.
const _outfits = new Map(), _outfitWant = [];
let _outfitWorker = null, _outfitBusy = '';
function outfitNext() {
  if (_outfitBusy || !_outfitWant.length) return;
  const sh = _outfitWant.shift(), k = outfitKey(sh);
  if (_outfits.has(k)) return outfitNext();
  _outfitBusy = k;
  _outfitWorker.postMessage({ shape: sh, tris: OUTFIT_BODY.tris, hats: OUTFIT_BODY.hats });
}
export function actorOutfitReady(shape) {
  if (!OUTFIT_BODY.on || !shape) return null;
  const k = outfitKey(shape), got = _outfits.get(k);
  if (got !== undefined) return got;
  if (_outfitWorker === null) {
    try {
      if (typeof Worker !== 'function' || typeof document === 'undefined') throw 0;
      const w = new Worker(new URL('./actor-outfit-worker.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => { const b = e.data && e.data.body; _outfits.set(_outfitBusy, b || null); _outfitBusy = ''; outfitNext(); };
      w.onerror = () => { w.terminate(); _outfitWorker = false; };
      _outfitWorker = w;
    } catch { _outfitWorker = false; }
  }
  if (_outfits.size >= OUTFIT_BODY.keep) return null;
  if (_outfitWorker === false) { let b = null; try { b = actorOutfitBody(shape); } catch { /* the silhouette keeps them */ } _outfits.set(k, b); return b; }
  if (_outfitBusy !== k && !_outfitWant.some((s) => outfitKey(s) === k)) _outfitWant.push(shape);
  outfitNext();
  return null;
}
// What's built and waiting, for a bench and the gate.
export const actorOutfitStats = () => ({ built: _outfits.size, waiting: _outfitWant.length + (_outfitBusy ? 1 : 0) });

// ── Outfits ────────────────────────────────────────────────────────────────────────────────────────
// Colours as 0..255 sRGB, the unit every palette in windshield.js uses. Each entry is [rgb, weight];
// the weights keep the loud colours rare so a street reads as a street and not a parade.
//
// An outfit is picked from the actor's TOKEN, never from the NPC. The token is a salted hash that is
// stable for a session and means nothing across a restart (see street-actors.js); dressing a figure
// in the NPC's real clothes would turn "the man in the red coat" into an identity readable from a
// street away, which is the tracker the token exists to prevent.
export const ACTOR_OUTFITS = {
  coat: [
    [[52, 54, 58], 3], [[30, 29, 30], 2], [[36, 44, 70], 2], [[84, 92, 100], 2], [[78, 84, 50], 2],
    [[34, 70, 52], 1], [[120, 62, 34], 2], [[92, 30, 34], 1], [[150, 116, 76], 2], [[168, 132, 40], 1],
    [[34, 98, 104], 1], [[80, 44, 78], 1], [[78, 102, 132], 1], [[196, 188, 168], 1],
    [[214, 104, 30], 0.5], [[170, 40, 36], 0.5],
  ],
  legs: [
    [[34, 34, 38], 2], [[46, 62, 96], 2], [[88, 110, 150], 1.5], [[96, 98, 104], 1.5], [[150, 134, 98], 1.5],
    [[98, 70, 48], 1.5], [[84, 92, 56], 1], [[124, 50, 48], 0.7], [[180, 172, 150], 0.7], [[60, 44, 76], 0.5],
  ],
  skin: [
    [[236, 200, 172], 1], [[214, 170, 136], 1], [[190, 142, 106], 1], [[160, 112, 80], 1],
    [[124, 84, 58], 1], [[92, 62, 44], 1], [[66, 44, 32], 1],
  ],
  hair: [
    [[22, 18, 16], 4], [[52, 34, 22], 3], [[96, 64, 38], 2], [[120, 52, 28], 1], [[178, 146, 86], 1],
    [[150, 146, 140], 1], [[210, 208, 200], 0.5], [[40, 140, 140], 0.3], [[170, 40, 120], 0.3], [[220, 210, 170], 0.3],
  ],
  shoes: [
    [[26, 24, 24], 3], [[70, 46, 30], 2], [[90, 90, 92], 1], [[120, 92, 60], 1],
  ],
};
const PARTS = ['coat', 'legs', 'skin', 'hair', 'shoes'];
// What the coat, the trousers and the shoes are made of, by weight: the codes gl/actors.js lights.
// Plain cloth is the street; the rest are what catch the eye up close. Picked off the token like the
// colours, and for the same reason.
export const ACTOR_MATERIAL = { cloth: 0, satin: 1, leather: 2, vinyl: 3, metal: 4 };
export const ACTOR_MATERIALS = {
  coat: [[0, 70], [1, 8], [2, 12], [3, 7], [4, 3]],
  legs: [[0, 86], [1, 5], [2, 8], [4, 1]],
  shoes: [[0, 25], [2, 55], [3, 20]],
};
// Their slots in rand(k), clear of the colours' 0-4 and of 6-9, which windshield.js hashes for
// height, gait, heading and phase.
const MAT_K = { coat: 10, legs: 11, shoes: 12 };
function pick(list, r) {
  let total = 0;
  for (const [, w] of list) total += w;
  let x = r * total;
  for (const [c, w] of list) { if ((x -= w) < 0) return c; }
  return list[list.length - 1][0];
}
// `rand(k)` is a stable 0..1 per part index k (windshield.js passes the actor hash). Returns the five
// colours, `mat` ([coat, trousers, shoes] as ACTOR_MATERIAL codes), `face` (actorFace's pick, its
// layout's makeup and the lips' colour), and `tone`, the blob's six-way
// bucket, taken from the coat's lightness so a figure keeps roughly its brightness when it crosses
// between the mesh and the billboard.
// The street's body types, off until the sculpted figure goes live, so a street and its rooms change together.
export const ACTOR_BODIES = { on: false };
// [ectomorph, mesomorph, endomorph, woman]: how much of each offset a person's body takes (figure.js somaOf has the
// same scale). Off the token, like everything else on the street: the NPC's real build or sex would be a tracker
// readable from a street away. Slots 40 to 42; a face with makeup or long hair is usually a woman's.
function bodyOf(rand, face) {
  const w = (rand(40) + rand(41)) / 2, woman = rand(42) < (face.makeup || face.hairStyle === 3 ? 0.85 : 0.2) ? 1 : 0;
  return [Math.max(0, 1 - 2 * w), 1 - Math.abs(2 * w - 1), Math.max(0, 2 * w - 1), woman];
}
export function actorOutfit(rand) {
  const o = {};
  PARTS.forEach((p, k) => { o[p] = pick(ACTOR_OUTFITS[p], rand(k)); });
  o.mat = ['coat', 'legs', 'shoes'].map((p) => pick(ACTOR_MATERIALS[p], rand(MAT_K[p])));
  // The face (actor-faces.js), off the same token. Its layout's age greys the hair wherever the hair
  // is drawn, so the far body and the head agree; the lips' colour comes from the skin.
  const f = actorFace(rand);
  o.hair = faceHair(o.hair, f.layout).map(Math.round);
  o.face = { ...f, makeup: FACE_LAYOUTS[f.layout].makeup, lip: faceLip(o.skin) };
  // What they wear over the trousers close up (figure.js FIGURE_CUTS); the crowd's bake is the coat.
  o.cut = figureCut(rand);
  const [r, g, b] = o.coat;
  const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  o.tone = Math.max(0, Math.min(5, Math.floor(luma * 1.9 * 6)));
  if (ACTOR_BODIES.on) o.body = bodyOf(rand, o.face);
  return o;
}
