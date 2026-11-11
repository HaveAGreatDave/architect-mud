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
import { buildFigure, figureCut, figureSole, FIGURE_BONES, FIGURE_CUTS, FIG_SLOT } from './figure.js';
import { simplifyMesh } from './mesh-simplify.js';

// ── Matrices: column-major 4×4, element (row r, col c) at m[c * 4 + r] ─────────────────────────────
function m4() { const m = new Float64Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; }
function mul(a, b) {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}
function trans(x, y, z) { const m = m4(); m[12] = x; m[13] = y; m[14] = z; return m; }
function rotX(a) { const m = m4(), c = Math.cos(a), s = Math.sin(a); m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m; }
function rotY(a) { const m = m4(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m; }
function rotZ(a) { const m = m4(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[1] = s; m[4] = -s; m[5] = c; return m; }
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
function fk(P) {
  const W = [];
  for (let i = 0; i < BONES.length; i++) {
    const [, p, o] = BONES[i];
    const R = mul(rotZ(P.r[i * 3 + 2]), mul(rotX(P.r[i * 3]), rotY(P.r[i * 3 + 1])));
    const T = p < 0 ? trans(o[0] + P.root[0], o[1] + P.root[1], o[2] + P.root[2]) : mul(W[p], trans(o[0], o[1], o[2]));
    W[i] = mul(T, R);
  }
  return W;
}
const skinMats = (W) => W.map((w, i) => mul(w, trans(-REST[i][0], -REST[i][1], -REST[i][2])));

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
function hdBody(lod, sil) {
  const key = `${lod}:${sil}`;
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
  const { ids, I } = simplifyMesh({ P: F.P, I: keep, cls, skin, target: HD_TRIS[lod ? 1 : 0] });
  // How far each kept point moves along its normal for the three bodies and a woman's, as buildBody
  // measures the coarse mesh: the close-up figure has the same points at every weight.
  const E = at(0), Me = at(0.5), En = at(1), Wo = at(0.5, 'woman');
  const same = [E, Me, En, Wo].every((G) => G.nv === F.nv);
  const along = (G, v, H = F) => (G.P[v * 3] - H.P[v * 3]) * F.N[v * 3] + (G.P[v * 3 + 1] - H.P[v * 3 + 1]) * F.N[v * 3 + 1] + (G.P[v * 3 + 2] - H.P[v * 3 + 2]) * F.N[v * 3 + 2];
  const out = { p: [], b0: [], b1: [], w: [], m: [], body: [], i: Array.from(I) };
  for (const v of ids) {
    const w0 = F.W[v * 4], w1 = F.W[v * 4 + 1];
    out.p.push(F.P[v * 3], F.P[v * 3 + 1], F.P[v * 3 + 2]);
    out.b0.push(F.B[v * 4]); out.b1.push(w1 > 0 ? F.B[v * 4 + 1] : F.B[v * 4]); out.w.push(w0 / (w0 + w1 || 1));
    out.m.push(cls[v]);
    out.body.push(same ? along(E, v) : 0, same ? along(Me, v) : 0, same ? along(En, v) : 0, same ? along(Wo, v, Me) : 0);
  }
  _hdBodies.set(key, out);
  return out;
}

function buildBody(lod = 0, head = true, sil = 0) {
  const M = meshBuilder();
  const far = lod > 0;
  const N = far ? 6 : 14, SUB = far ? 0 : 1;
  const ell = (c, r, nu, nv, wf, mat, shape) => ellipsoid(M, c, r, far ? Math.max(4, nu >> 1) : nu, far ? Math.max(3, nv >> 1) : nv, wf, mat, shape);
  if (ACTOR_BAKE.hd) {
    const H = hdBody(lod, sil);
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
function idlePose(p) {
  const P = newPose();
  const s1 = Math.sin(TAU * p), s2 = Math.sin(2 * TAU * p + 0.7);
  P.root[0] = -0.028 + 0.006 * s1;
  setR(P, 'pelvis', 1 * DEG, 3 * DEG, -3.5 * DEG + 0.8 * DEG * s1);
  setR(P, 'thighR', 0, 0, 3.5 * DEG - 0.8 * DEG * s1);
  setR(P, 'thighL', -5 * DEG, -8 * DEG, 1.5 * DEG - 0.8 * DEG * s1);
  setR(P, 'shinL', 10 * DEG, 0, 0);
  setR(P, 'footL', 4 * DEG, 0, 0);
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
function stance(p) {
  const P = idlePose(0.25 + 0.06 * Math.sin(TAU * p));
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
  P.root = A.root.map((v, i) => v + (Bm.root[i] - v) * k);
  return P;
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
  setR(P, 'uarmL', m(-2, -14) * DEG, 0, m(0.07, 2.75)); setR(P, 'uarmR', m(-2, -14) * DEG, 0, m(-0.07, -2.75));
  setR(P, 'farmL', m(-12, -22) * DEG, 0, 0); setR(P, 'farmR', m(-10, -22) * DEG, 0, 0);
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
const sitting = (lean = 4) => {
  const P = sitBody();
  zeroR(P, 'spine');
  setR(P, 'thighL', 6 * DEG, -10 * DEG, 13 * DEG); setR(P, 'shinL', -26 * DEG, 0, 0); setR(P, 'footL', -10 * DEG, 0, 0);
  setR(P, 'thighR', -2 * DEG, 8 * DEG, -9 * DEG); setR(P, 'shinR', 14 * DEG, 0, 0); setR(P, 'footR', 8 * DEG, 0, 0);
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
  const P = sitting(-14), s = Math.sin(TAU * p);
  setR(P, 'thighL', 14 * DEG, -12 * DEG, 15 * DEG); setR(P, 'shinL', -38 * DEG, 0, 0); setR(P, 'footL', -14 * DEG, 0, 0);
  setR(P, 'thighR', 10 * DEG, 10 * DEG, -12 * DEG); setR(P, 'shinR', -24 * DEG, 0, 0); setR(P, 'footR', -8 * DEG, 0, 0);
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
function onSide(P) { setR(P, 'pelvis', 0, -Math.PI / 2, 0); P.root[2] += 0.06; return P; }
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
  return onSide(P);
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
  const P = stance(p), k = held(p, 0.08, 0.78), w = Math.sin(5 * TAU * p);
  setR(P, 'spine', 22 * DEG * k, 0, 0); setR(P, 'chest', 12 * DEG * k, 0, 0);
  setR(P, 'thighL', -6 * DEG * k, 0, 0); setR(P, 'thighR', -6 * DEG * k, 0, 0); setR(P, 'shinL', 10 * DEG * k, 0, 0); setR(P, 'shinR', 10 * DEG * k, 0, 0);
  arm(P, 'R', -12 - 48 * k, 15 * k, -0.08, -14 - 16 * k + 10 * w * k, -6);
  arm(P, 'L', -12 - 44 * k, -15 * k, 0.08, -14 - 18 * k - 10 * w * k, -6);
  setR(P, 'head', 15 * DEG * k, 8 * DEG * w * k, 0);
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
  const P = stance(p), c = Math.cos(3 * TAU * p), s = Math.sin(3 * TAU * p), look = held(p, 0.55, 0.8);
  for (const [sd, k] of [['L', 1], ['R', -1]]) {
    setR(P, 'thigh' + sd, -98 * DEG, 0, k * 16 * DEG); setR(P, 'shin' + sd, 128 * DEG, 0, 0); setR(P, 'foot' + sd, -30 * DEG, 0, 0);
  }
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
  const P = stance(p), k = held(p, 0.05, 0.5), fl = Math.sin(9 * TAU * p) * k;
  setR(P, 'spine', 26 * DEG * k, 0, 0); setR(P, 'chest', 8 * DEG * k, 6 * DEG * fl, 0);
  setR(P, 'thighR', -32 * DEG * k, 0, 0); setR(P, 'shinR', 30 * DEG * k, 0, 0);
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
  const P = stance(p), sh = Math.sin(30 * TAU * p);
  for (const s of ['L', 'R']) { setR(P, 'thigh' + s, -35 * DEG, 0, 0); setR(P, 'shin' + s, 55 * DEG, 0, 0); setR(P, 'foot' + s, -18 * DEG, 0, 0); }
  setR(P, 'spine', 22 * DEG, 0, 0); setR(P, 'chest', 10 * DEG, 2 * DEG * sh, 0);
  arm(P, 'R', -115, 55, 0.35, -125, -10); arm(P, 'L', -115, -55, -0.35, -125, -10);
  setR(P, 'head', 25 * DEG, 0, 0);
  return P;
}
// Dancing on the spot, two beats a cycle: the weight from foot to foot, the knees going, the arms bent.
// Dancing: the hips in a figure of eight over the feet, the knee giving on whichever side the weight leaves,
// a roll up the spine a beat behind the hips, and the right hand swept up over the head and down again
// once a cycle while the left stays near the hip.
function dancePose(p) {
  const P = stance(p), s = Math.sin(2 * TAU * p), c = Math.cos(2 * TAU * p), b = Math.sin(4 * TAU * p);
  const up = 0.5 - 0.5 * Math.cos(TAU * p);
  P.root[0] += 0.045 * s;
  setR(P, 'pelvis', 4 * DEG * b, 10 * DEG * c, 9 * DEG * s);
  for (const [sd, w, z] of [['L', Math.max(0, -s), 3], ['R', Math.max(0, s), -3]]) {
    setR(P, 'thigh' + sd, -(6 + 8 * w) * DEG, 0, z * DEG);
    setR(P, 'shin' + sd, (10 + 20 * w + 4 * (0.5 + 0.5 * b)) * DEG, 0, 0);
  }
  setR(P, 'spine', 5 * DEG * Math.sin(2 * TAU * p - 0.8), -6 * DEG * c, -5 * DEG * s);
  setR(P, 'chest', 6 * DEG * Math.sin(2 * TAU * p - 1.6), -6 * DEG * c, -4 * DEG * s);
  arm(P, 'R', -40 - 120 * up, 20, -0.15 - 0.15 * up, -60 + 40 * up, -10);
  arm(P, 'L', -18 - 10 * s, -40, 0.25, -70, -10);
  setR(P, 'neck', -4 * DEG * up, 0, 0); setR(P, 'head', (3 * b - 6 * up) * DEG, 10 * DEG * c, 6 * DEG * s);
  return P;
}
// A body roll: the wave goes up from the knees through the hips and the chest to the head, twice a cycle,
// and both hands run down the front of the body from the ribs to the thighs as it goes.
function bodyRollPose(p) {
  const P = stance(p), w = (ph) => Math.sin(2 * TAU * p - ph), k = 0.5 - 0.5 * Math.cos(2 * TAU * p);
  setR(P, 'thighL', -12 * DEG * (0.5 + 0.5 * w(0)), 0, 4 * DEG); setR(P, 'thighR', -12 * DEG * (0.5 + 0.5 * w(0)), 0, -4 * DEG);
  setR(P, 'shinL', 22 * DEG * (0.5 + 0.5 * w(0)), 0, 0); setR(P, 'shinR', 22 * DEG * (0.5 + 0.5 * w(0)), 0, 0);
  setR(P, 'pelvis', 12 * DEG * w(0.7), 0, 0);
  setR(P, 'spine', -9 * DEG * w(1.4), 0, 0); setR(P, 'chest', -10 * DEG * w(2.1), 0, 0);
  setR(P, 'neck', -6 * DEG * w(2.8), 0, 0); setR(P, 'head', -8 * DEG * w(3.3), 0, 0);
  arm(P, 'R', -38 + 30 * k, 40, -0.12, -100 + 50 * k, -14); arm(P, 'L', -38 + 30 * k, -40, 0.12, -100 + 50 * k, -14);
  return P;
}
// A hair whip: both hands up behind the head, the chest and head going round in a circle and flung back at the top.
function hairWhipPose(p) {
  const P = stance(p), s = Math.sin(TAU * p), c = Math.cos(TAU * p), fling = bump(p, 0.75, 0.06);
  setR(P, 'thighL', 0, 0, 5 * DEG); setR(P, 'thighR', 0, 0, -5 * DEG);
  setR(P, 'pelvis', 0, 6 * DEG * s, 4 * DEG * c);
  arm(P, 'R', -150, 30, -0.35, -110, -10); arm(P, 'L', -150, -30, 0.35, -110, -10);
  setR(P, 'spine', (6 * c - 6 * fling) * DEG, 0, 6 * DEG * s);
  setR(P, 'chest', (8 * c - 8 * fling) * DEG, 0, 8 * DEG * s);
  setR(P, 'neck', (10 * c - 14 * fling) * DEG, 0, 8 * DEG * s);
  setR(P, 'head', (12 * c - 18 * fling) * DEG, 0, 10 * DEG * s);
  return P;
}
const mixN = (a, b, k) => a + (b - a) * k;
// Taking a layer off, played once: the hands down to the hem, the garment drawn up over the head with the
// arms crossed, flung away to the right, and back to the hips with a roll of them.
function undressPose(p) {
  const P = stance(p), a = smooth(0.04, 0.28, p), b = smooth(0.3, 0.58, p), c = smooth(0.6, 0.72, p), d = smooth(0.78, 0.98, p);
  for (const [sd, s] of [['R', 1], ['L', -1]]) {
    let f = mixN(-6, -24, a), tw = mixN(0, s * 34, a), ab = mixN(-s * 0.1, -s * 0.05, a), el = mixN(-10, -48, a);
    f = mixN(f, -168, b); tw = mixN(tw, s * 8, b); ab = mixN(ab, s * 0.05, b); el = mixN(el, -36, b);   // crossed over the head
    if (sd === 'R') { f = mixN(f, -96, c); ab = mixN(ab, -0.95, c); el = mixN(el, -6, c); }            // and away
    f = mixN(f, -16, d); tw = mixN(tw, s * 30, d); ab = mixN(ab, -s * 0.3, d); el = mixN(el, -82, d);   // to the hips
    arm(P, sd, f, tw, ab, el, -10);
  }
  setR(P, 'spine', (8 * a * (1 - b) - 6 * b * (1 - d)) * DEG, 0, 0);
  setR(P, 'chest', -6 * DEG * b * (1 - d), -10 * DEG * c * (1 - d), 0);
  setR(P, 'head', (10 * a * (1 - b) - 12 * b * (1 - c)) * DEG, -14 * DEG * c * (1 - d), 0);
  setR(P, 'pelvis', 0, 8 * DEG * Math.sin(2 * TAU * p) * d, 6 * DEG * Math.sin(2 * TAU * p));
  return P;
}
// Putting a layer back on, played once: a dip to pick it up, then pulling it up the body and over the shoulders,
// and a smooth of it down at the hips.
function redressPose(p) {
  const P = stance(p), dip = held(p, 0.04, 0.3), up = smooth(0.38, 0.7, p), sm = held(p, 0.74, 0.86);
  setR(P, 'thighL', -34 * DEG * dip, 0, 3 * DEG); setR(P, 'thighR', -34 * DEG * dip, 0, -3 * DEG);
  setR(P, 'shinL', 60 * DEG * dip, 0, 0); setR(P, 'shinR', 60 * DEG * dip, 0, 0);
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
  const P = stance(p), s = Math.sin(TAU * p), k = 0.5 + 0.5 * s;
  arm(P, 'R', -128 + 10 * s, 8, -0.06, -6, -10);
  arm(P, 'L', -60 - 50 * k, -30, 0.55 + 0.2 * k, -20, -6);
  setR(P, 'thighR', (-48 - 14 * k) * DEG, 10 * DEG, -10 * DEG); setR(P, 'shinR', (72 + 10 * k) * DEG, 0, 0); setR(P, 'footR', 30 * DEG, 0, 0);
  setR(P, 'thighL', 4 * DEG, 0, 3 * DEG);
  setR(P, 'pelvis', -6 * DEG * k, 14 * DEG * s, 6 * DEG);
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
  setR(P, 'thighR', -5 * DEG * tap, 0, 0); setR(P, 'shinR', 9 * DEG * tap, 0, 0);
  return P;
}
// Stooping for something on the floor: the knees give and part, the back goes over, the right hand goes down to
// it with the left on the knee, and up again with it.
const stoopK = (p) => smooth(0.12, 0.34, p) * (1 - smooth(0.5, 0.74, p));
function pickUpPose(p) {
  const P = stance(p), k = stoopK(p);
  for (const [sd, z] of [['L', 1], ['R', -1]]) {
    setR(P, 'thigh' + sd, -92 * DEG * k, 0, z * 12 * DEG * k); setR(P, 'shin' + sd, 122 * DEG * k, 0, 0); setR(P, 'foot' + sd, -30 * DEG * k, 0, 0);
  }
  setR(P, 'spine', 40 * DEG * k, 0, 0); setR(P, 'chest', 18 * DEG * k, 0, 0);
  arm(P, 'R', -2 - 62 * k, 0, -0.07, -10 + 4 * k, -6);
  arm(P, 'L', -2 - 34 * k, -18 * k, 0.07 + 0.12 * k, -12 - 44 * k, -8);
  setR(P, 'neck', -8 * DEG * k, 0, 0); setR(P, 'head', 6 * DEG * k, 0, 0);
  return P;
}
// Squats, two a cycle: down with the arms out in front for balance, and up.
function squatsPose(p) {
  const P = stance(p), k = 0.5 - 0.5 * Math.cos(2 * TAU * p);
  for (const [sd, z] of [['L', 1], ['R', -1]]) {
    setR(P, 'thigh' + sd, -72 * DEG * k, 0, z * 8 * DEG * k); setR(P, 'shin' + sd, 96 * DEG * k, 0, 0); setR(P, 'foot' + sd, -24 * DEG * k, 0, 0);
  }
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
  setR(P, 'thighL', -20 * DEG * a, 0, 0); setR(P, 'shinL', 34 * DEG * a, 0, 0);
  setR(P, 'thighR', -20 * DEG * b, 0, 0); setR(P, 'shinR', 34 * DEG * b, 0, 0);
  return P;
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
// weight on the left leg with the right knee bent, the hips rolling round the pole and the body leaning back.
function poleHoldPose(p) {
  const P = stance(p), s = Math.sin(TAU * p), c = Math.cos(TAU * p);
  P.root[0] += 0.05 * s;
  setR(P, 'pelvis', 0, 12 * DEG * s, 7 * DEG * s);
  setR(P, 'thighR', -14 * DEG, 0, -4 * DEG); setR(P, 'shinR', 24 * DEG, 0, 0);
  arm(P, 'R', -152, 8, -0.08, -18, -10);
  arm(P, 'L', -26 + 16 * c, -30, 0.26, -58, -10);
  setR(P, 'spine', -6 * DEG, 0, 0); setR(P, 'chest', -6 * DEG, -8 * DEG * s, -4 * DEG * s);
  setR(P, 'head', -8 * DEG, 12 * DEG * s, 5 * DEG * s);
  return P;
}
// Both hands high on the pole, sinking slowly to a squat with the knees apart and the back arched, and up again.
function poleSlidePose(p) {
  const P = stance(p), k = 0.5 - 0.5 * Math.cos(TAU * p);
  for (const [sd, z] of [['L', 1], ['R', -1]]) {
    setR(P, 'thigh' + sd, -78 * k * DEG, 0, z * (6 + 20 * k) * DEG); setR(P, 'shin' + sd, 112 * k * DEG, 0, 0); setR(P, 'foot' + sd, -26 * k * DEG, 0, 0);
  }
  arm(P, 'R', -166 + 40 * k, 4, -0.06, -10 - 30 * k, -10); arm(P, 'L', -166 + 40 * k, -4, 0.06, -10 - 30 * k, -10);
  setR(P, 'spine', (-8 + 22 * k) * DEG, 0, 0); setR(P, 'chest', -6 * DEG * (1 - k), 0, 0);
  setR(P, 'head', (-14 + 18 * k) * DEG, 0, 0);
  return P;
}

function guardPose(p) {
  const P = stance(p), look = Math.sin(TAU * p);
  setR(P, 'thighL', 0, 0, 5 * DEG); setR(P, 'thighR', 0, 0, -5 * DEG);
  arm(P, 'R', -6, 70, -0.2, -50, -8); arm(P, 'L', -6, -70, 0.2, -50, -8);
  setR(P, 'chest', -3 * DEG, 0, 0);
  setR(P, 'neck', 0, 10 * DEG * look, 0); setR(P, 'head', 0, 20 * DEG * look, 0);
  return P;
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
];
export const ACTOR_CLIPS = CLIPS.map(({ name, frames, dur }) => ({ name, frames, dur }));
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
  { name: 'idlePockets', dur: 10, fn: pocketsPose }, { name: 'idleBehind', dur: 10, fn: behindPose },
  { name: 'idleScratch', dur: 10, fn: scratchPose }, { name: 'idleNeck', dur: 10, fn: neckPose },
  { name: 'idleWatch', dur: 10, fn: watchPose }, { name: 'idleStretch', dur: 10, fn: stretchPose },
  { name: 'idleYawn', dur: 10, fn: yawnPose, face: (p) => ({ open: yawnK(p), shut: yawnK(p) }) },
  { name: 'idleSigh', dur: 10, fn: sighPose, face: (p) => ({ open: 0.22 * smooth(0.38, 0.44, p) * (1 - smooth(0.54, 0.66, p)), round: 0.5 }) },
  { name: 'sitRest', dur: 10, fn: sitRestPose }, { name: 'sitClasp', dur: 10, fn: sitClaspPose },
  { name: 'sitLean', dur: 10, fn: sitLeanPose }, { name: 'sitBack', dur: 10, fn: sitBackPose }, { name: 'sitSprawl', dur: 12, fn: sitSprawlPose }, { name: 'sitBar', dur: 9, fn: sitBarPose }, { name: 'sitBarSmoke', dur: 11, fn: sitBarSmokePose }, { name: 'sitFold', dur: 10, fn: sitFoldPose },
  { name: 'sitPhone', dur: 6, fn: sitPhonePose }, { name: 'sitRead', dur: 9, fn: sitReadPose }, { name: 'sitDrink', dur: 10, fn: sitDrinkPose },
  { name: 'sitSmoke', dur: 9, fn: sitSmokePose }, { name: 'sitDrive', dur: 6, fn: sitDrivePose }, { name: 'sitDriveWave', dur: 1.6, fn: sitDriveWavePose }, { name: 'sitDoze', dur: 10, fn: sitDozePose, face: () => ({ shut: 1 }) },
  { name: 'sitSlump', dur: 10, fn: sitSlumpPose, face: () => ({ shut: 1, open: 0.18 }) },
  // at a table with a habit (client/shared/table-stash.js): the stage gives the phase, off the session's clock
  { name: 'sitCut', dur: 8, fn: sitCutPose }, { name: 'sitLine', dur: 8, fn: sitLinePose, face: (p) => ({ shut: smooth(0.5, 0.56, p) * (1 - smooth(0.8, 0.9, p)) }) },
  { name: 'sitSort', dur: 6, fn: sitSortPose }, { name: 'sitPill', dur: 6.5, fn: sitPillPose, face: (p) => ({ open: 0.2 * smooth(0.28, 0.32, p) * (1 - smooth(0.36, 0.4, p)) }) },
  { name: 'sitPack', dur: 6, fn: sitPackPose }, { name: 'sitPipe', dur: 11, fn: sitPipePose, face: (p) => ({ round: smooth(0.62, 0.68, p) * (1 - smooth(0.84, 0.96, p)), open: 0.15 * smooth(0.62, 0.68, p) * (1 - smooth(0.84, 0.96, p)) }) },
  { name: 'sitCook', dur: 9, fn: sitCookPose }, { name: 'sitTie', dur: 10, fn: sitOf(injectPose, 12) },
  { name: 'sitShake', dur: 4, fn: sitShakePose }, { name: 'sitHuff', dur: 9, fn: sitOf(huffPose, 6) }, { name: 'sitPour', dur: 5, fn: sitPourPose },
  { name: 'lieBack', dur: 12, fn: lieBackPose }, { name: 'lieArm', dur: 10, fn: lieArmPose }, { name: 'liePhone', dur: 8, fn: liePhonePose },
  { name: 'lieSide', dur: 12, fn: lieSidePose },
  { name: 'sleepSide', dur: 9, fn: sleepSidePose, face: () => ({ shut: 1 }) },
  { name: 'sleepBack', dur: 9, fn: sleepBackPose, face: () => ({ shut: 1, open: 0.12 }) },
  { name: 'sprawl', dur: 9, fn: sprawlPose, face: () => ({ shut: 1, open: 0.22 }) },
  { name: 'wipe', dur: 6, fn: wipePose }, { name: 'polish', dur: 6, fn: polishPose }, { name: 'stir', dur: 5, fn: stirPose },
  { name: 'rummage', dur: 7, fn: rummagePose }, { name: 'wash', dur: 5, fn: washPose }, { name: 'counter', dur: 10, fn: counterPose },
  { name: 'count', dur: 8, fn: countPose }, { name: 'write', dur: 8, fn: writePose },
  { name: 'eat', dur: 8, fn: eatPose, face: (p) => ({ open: chewK(p) }) }, { name: 'sitEat', dur: 8, fn: sitOf(eatPose, 12), face: (p) => ({ open: chewK(p) }) },
  { name: 'squatStir', dur: 6, fn: squatStirPose },
  { name: 'laugh', dur: 5, fn: laughPose, face: (p) => ({ open: 0.45 * laughK(p) * (0.7 + 0.3 * Math.sin(14 * TAU * p)) }) },
  { name: 'shrug', dur: 4, fn: shrugPose }, { name: 'cower', dur: 6, fn: cowerPose, face: () => ({ open: 0.2, round: 0.3 }) },
  { name: 'dance', dur: 2.4, fn: dancePose }, { name: 'poleHold', dur: 5, fn: poleHoldPose }, { name: 'poleSlide', dur: 7, fn: poleSlidePose }, { name: 'poleLean', dur: 6, fn: poleLeanPose },
  { name: 'bodyRoll', dur: 4, fn: bodyRollPose }, { name: 'hairWhip', dur: 3, fn: hairWhipPose },
  { name: 'undress', dur: 4, fn: undressPose, once: true }, { name: 'redress', dur: 4.5, fn: redressPose, once: true }, { name: 'shiver', dur: 6, fn: shiverPose },
  { name: 'cough', dur: 5, fn: coughPose, face: (p) => ({ open: 0.4 * coughK(p) }) }, { name: 'guard', dur: 12, fn: guardPose },
  // a show's stage directions, on their feet and in a chair
  { name: 'point', dur: 3, fn: pointPose }, { name: 'sitPoint', dur: 3, fn: sitOf(pointPose) },
  { name: 'spread', dur: 3.5, fn: spreadPose, face: (p) => ({ open: 0.25 * held(p, 0.12, 0.72) }) }, { name: 'sitSpread', dur: 3.5, fn: sitOf(spreadPose) },
  { name: 'slam', dur: 2.6, fn: slamPose, once: true }, { name: 'sitSlam', dur: 2.6, fn: sitOf(slamPose, 14), once: true },
  { name: 'holdup', dur: 4, fn: holdupPose }, { name: 'sitHoldup', dur: 4, fn: sitOf(holdupPose) },
  { name: 'flex', dur: 3.5, fn: flexPose, face: (p) => ({ open: 0.15 * held(p, 0.12, 0.76) }) }, { name: 'sitFlex', dur: 3.5, fn: sitOf(flexPose) },
  { name: 'clap', dur: 3, fn: clapPose }, { name: 'sitClap', dur: 3, fn: sitOf(clapPose) },
  { name: 'reach', dur: 3, fn: reachPose }, { name: 'sitReach', dur: 3, fn: sitOf(reachPose, 18) },
  { name: 'stare', dur: 8, fn: starePose }, { name: 'sitStare', dur: 8, fn: sitStarePose },
  { name: 'wink', dur: 2, fn: winkPose, face: (p) => ({ shut: winkK(p) }) }, { name: 'sitWink', dur: 2, fn: sitOf(winkPose), face: (p) => ({ shut: winkK(p) }) },
  { name: 'leanIn', dur: 4, fn: leanInPose },
  { name: 'stumble', dur: 2.8, fn: stumblePose, once: true, face: (p) => ({ open: 0.3 * held(p, 0.05, 0.5), round: 0.5 }) },
  { name: 'toss', dur: 2.4, fn: tossPose, once: true }, { name: 'sitToss', dur: 2.4, fn: sitOf(tossPose), once: true },
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
    ['idleRock', 1.2], ['idleTap', 0.8], ['idleRoll', 0.6], ['idleRub', 0.5], ['idleKnuckles', 0.5]],
  sit: [['sitRest', 4], ['sitSprawl', 3], ['sitBack', 2.5], ['sitClasp', 1], ['sitLean', 0.8], ['sitFold', 1.5], ['sitPhone', 1], ['sitRead', 0.6],
    ['sitScratch', 0.5], ['sitNeck', 0.5], ['sitWatch', 0.5], ['sitStretch', 0.4], ['sitYawn', 0.4], ['sitRub', 0.4]],
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
  bar: [['wipe', 3], ['polish', 3], ['counter', 2], ['idle', 2], ['wait', 1], ['idleLook', 1], ['count', 0.5]],
  shop: [['counter', 3], ['idle', 3], ['count', 1.5], ['write', 1.5], ['wait', 1.5], ['idleWatch', 1], ['idleLook', 1], ['idleBehind', 1]],
  // a dancer on shift: at her pole, or working the floor where there isn't one
  pole: [['poleHold', 3.5], ['poleLean', 2.5], ['poleSlide', 2.5], ['dance', 1.5], ['bodyRoll', 1], ['hairWhip', 0.5]],
  floorwork: [['dance', 4], ['bodyRoll', 2.5], ['hairWhip', 1.5], ['idleHip', 1], ['idleHipR', 1]],
  // half undressed or more (plugins/roomstage `peel`): no standing about, more of the big moves
  poleHot: [['poleLean', 3.5], ['poleSlide', 3], ['poleHold', 2], ['bodyRoll', 1.5], ['hairWhip', 1]],
  floorHot: [['bodyRoll', 3.5], ['dance', 3], ['hairWhip', 2.5]],
  guard: [['guard', 5], ['wait', 2], ['idleBehind', 2], ['idleLook', 2], ['idle', 1]],
  rough: [['idle', 3], ['shiver', 1.5], ['idleScratch', 1.5], ['cough', 1], ['idleNeck', 1], ['wait', 1], ['idleSigh', 1]],
};
// How long one of those is held before the next: a sleeper turns over now and then, not every ten seconds.
export const ACTOR_IDLE_SLOT = { sleep: 45, out: 60, lie: 20, sitSleep: 30, sitOut: 60 };
// What a body does when an emote line says it's doing something (client/shared/npc-acts.js names the act),
// by how it is: on its feet, sitting, lying. Missing means it carries on as it was.
export const ACTOR_ACTS = {
  smoke: { stand: 'smoke', sit: 'sitSmoke' }, phone: { stand: 'phone', sit: 'sitPhone', lie: 'liePhone' },
  read: { stand: 'phone', sit: 'sitRead', lie: 'liePhone' }, drink: { stand: 'drink', sit: 'sitDrink' },
  eat: { stand: 'eat', sit: 'sitEat' }, wipe: { stand: 'wipe' }, polish: { stand: 'polish' }, stir: { stand: 'stir' },
  rummage: { stand: 'rummage' }, wash: { stand: 'wash' }, lean: { stand: 'counter', sit: 'sitLean' }, count: { stand: 'count' },
  write: { stand: 'write', sit: 'sitRead' }, laugh: { stand: 'laugh', sit: 'sitBack' }, shrug: { stand: 'shrug' },
  cower: { stand: 'cower' }, dance: { stand: 'dance' }, undress: { stand: 'undress' }, redress: { stand: 'redress' }, shiver: { stand: 'shiver', sit: 'sitShiver' }, cough: { stand: 'cough' },
  blow: { stand: 'coldBlow', sit: 'sitBlow' }, swelter: { stand: 'hotFan', sit: 'sitFan' }, brow: { stand: 'hotBrow', sit: 'sitBrow' }, tug: { stand: 'hotTug', sit: 'sitTug' },
  stoop: { stand: 'pickUp' }, exercise: { stand: 'squats' }, rub: { stand: 'idleRub', sit: 'sitRub' }, knuckles: { stand: 'idleKnuckles', sit: 'sitClasp' },
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
};
export const ACTOR_ROOM_CLIPS = ROOM_CLIPS.map(({ name, dur, once }) => ({ name, dur, once: !!once }));
export const ACTOR_BONE = B;

// ── Root motion. The clip plays in place and the instance moves at a constant speed, so for the
// stance foot to stay put the pelvis has to surge ahead when the legs are fast and drop back when
// they are slow. The surge is baked into the clip, and its average speed is the stride. Solved on
// first use rather than at import, because windshield.js imports this module at boot. ──────────────
function solveRoot(clip) {
  if (clip.surge) return;
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
export function actorStrideM() { solveRoot(CLIPS[0]); return CLIPS[0].stride; }

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
export const ACTOR_HEAD_BONES = { texels: 6, head: 0, neck: 3 };
let _bake = null, _job = null, _done = [], _bakeHead = null, _worker = null;
// The far body's clips have half the frames: at a few pixels nobody can count them.
const clipFrames = (clip, lod) => (lod ? clip.frames >> 1 : clip.frames);
const silCount = () => (ACTOR_BAKE.hd ? ACTOR_SILHOUETTES.length : 1);
function bakeBegin(lod = 0, head = true, sil = 0, ground = null) {
  solveRoot(CLIPS[0]);
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
    for (const [bone, at] of [[B.head, ACTOR_HEAD_BONES.head], [B.neck, ACTOR_HEAD_BONES.neck]]) {
      const m = S[bone], o = (F * ACTOR_HEAD_BONES.texels + at) * 4;
      for (let r = 0; r < 3; r++) {
        J.bones[o + r * 4] = m[r]; J.bones[o + r * 4 + 1] = m[4 + r]; J.bones[o + r * 4 + 2] = m[8 + r];
        J.bones[o + r * 4 + 3] = m[12 + r] - (r === 1 ? minY : 0);
      }
    }
  }
  J.F++;
  if (++J.f >= len) { J.f = 0; J.ci++; }
  return J.ci >= CLIPS.length;
}
const bakeOut = (J) => ({ nv: J.nv, nt: J.nt, W: J.W, rows: J.rows, H: J.H, frames: J.frames, pos: J.pos, nrm: J.nrm,
  mat: J.mat, body: J.body, idx: J.ix, top: J.top, clips: J.clips, preview: J.preview, bones: J.bones, sil: J.sil, ground: J.ground });
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
  for (const k of Object.keys(_poseBody)) delete _poseBody[k];
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
// skinned on the GPU (gl/room-people.js figurePeople). `name` is an ACTOR_CLIPS name.
export function actorSkinAt(name, phase) {
  const clip = CLIPS.find((c) => c.name === name) || ROOM_CLIPS.find((c) => c.name === name) || CLIPS[1];
  if (clip.walk) solveRoot(clip);
  const ph = ((phase % 1) + 1) % 1, pose = clip.fn(ph);
  if (clip.surge) pose.root[2] += clip.surge(ph);
  return skinMats(fk(pose));
}

// Two clips part-way from one to the other, mixed on the pose, not the matrices, so an arm swings round
// rather than cutting through the body. Neither may be the walk.
export function actorSkinMix(a, pa, b, pb, k) {
  const pose = (name, ph) => (CLIPS.find((c) => c.name === name) || ROOM_CLIPS.find((c) => c.name === name) || CLIPS[1]).fn(((ph % 1) + 1) % 1);
  const A = pose(a, pa), Bp = pose(b, pb), P = newPose();
  for (let i = 0; i < P.r.length; i++) P.r[i] = A.r[i] + (Bp.r[i] - A.r[i]) * k;
  P.root = A.root.map((v, i) => v + (Bp.root[i] - v) * k);
  return skinMats(fk(P));
}
// One frame of a clip as a plain triangle list, for a figure drawn without the bake: the stands'
// fans (gl/ballpark-mesh.js crowdMorph), who need three poses and not every frame of every clip.
// Returns { p, n, mat } per corner (three corners a triangle, unindexed), metres, +Y up, +Z ahead,
// the lowest point on the ground as the bake drops it. The same body every call, so two poses pair
// up corner for corner.
const _poseBody = {};
export function actorPoseMesh(name, phase = 0, lod = 1) {
  const M = _poseBody[lod] || (_poseBody[lod] = buildBody(lod, true));
  const clip = CLIPS.find((c) => c.name === name) || CLIPS[1];
  const S = skinMats(fk(clip.fn(((phase % 1) + 1) % 1)));
  const nv = M.p.length / 3, P = new Float32Array(nv * 3);
  let minY = Infinity;
  for (let v = 0; v < nv; v++) {
    const x = M.p[v * 3], y = M.p[v * 3 + 1], z = M.p[v * 3 + 2], w = M.w[v], u = 1 - w, a = S[M.b0[v]], b = S[M.b1[v]];
    for (let k = 0; k < 3; k++) P[v * 3 + k] = w * (a[k] * x + a[4 + k] * y + a[8 + k] * z + a[12 + k]) + u * (b[k] * x + b[4 + k] * y + b[8 + k] * z + b[12 + k]);
    if (P[v * 3 + 1] < minY) minY = P[v * 3 + 1];
  }
  for (let v = 0; v < nv; v++) P[v * 3 + 1] -= minY;
  const Nn = new Float32Array(nv * 3), I = M.i;
  for (let t = 0; t < I.length; t += 3) {
    const i0 = I[t] * 3, i1 = I[t + 1] * 3, i2 = I[t + 2] * 3;
    const ux = P[i1] - P[i0], uy = P[i1 + 1] - P[i0 + 1], uz = P[i1 + 2] - P[i0 + 2], vx = P[i2] - P[i0], vy = P[i2 + 1] - P[i0 + 1], vz = P[i2 + 2] - P[i0 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const j of [i0, i1, i2]) { Nn[j] += nx; Nn[j + 1] += ny; Nn[j + 2] += nz; }
  }
  const p = new Float32Array(I.length * 3), n = new Float32Array(I.length * 3), mat = new Uint8Array(I.length);
  for (let k = 0; k < I.length; k++) {
    const v = I[k], l = Math.hypot(Nn[v * 3], Nn[v * 3 + 1], Nn[v * 3 + 2]) || 1;
    for (let c = 0; c < 3; c++) { p[k * 3 + c] = P[v * 3 + c]; n[k * 3 + c] = Nn[v * 3 + c] / l; }
    mat[k] = M.m[v];
  }
  return { p, n, mat };
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
