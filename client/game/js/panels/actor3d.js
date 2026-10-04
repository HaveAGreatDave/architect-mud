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

// ── The skeleton. Every rest rotation is identity, so a bind matrix is a translation. ──────────────
const BONES = [
  ['pelvis', -1, [0, 0.95, 0]],
  ['spine', 0, [0, 0.10, 0]],
  ['chest', 1, [0, 0.17, 0]],
  ['neck', 2, [0, 0.21, -0.005]],
  ['head', 3, [0, 0.10, 0.01]],
  ['uarmL', 2, [0.195, 0.17, -0.01]],
  ['farmL', 5, [0, -0.29, 0]],
  ['handL', 6, [0, -0.25, 0]],
  ['uarmR', 2, [-0.195, 0.17, -0.01]],
  ['farmR', 8, [0, -0.29, 0]],
  ['handR', 9, [0, -0.25, 0]],
  ['thighL', 0, [0.095, -0.03, 0]],
  ['shinL', 11, [0, -0.43, 0]],
  ['footL', 12, [0, -0.41, 0]],
  ['thighR', 0, [-0.095, -0.03, 0]],
  ['shinR', 14, [0, -0.43, 0]],
  ['footR', 15, [0, -0.41, 0]],
  // The ball of each foot, so the heel can lift while the toes stay down. Last, so no other bone's
  // index moves.
  ['toeL', 13, [0, -0.06, 0.095]],
  ['toeR', 16, [0, -0.06, 0.095]],
];
export const ACTOR_BONES = BONES.length;
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
function loft(M, st, nu, sub, wf, mat) {
  const S = [];
  for (let i = 0; i < st.length - 1; i++) {
    for (let s = 0; s <= sub; s++) { const t = s / (sub + 1); S.push(st[i].map((v, j) => v + (st[i + 1][j] - v) * t)); }
  }
  S.push(st[st.length - 1]);
  stitch(M, S.map(([y, rx, rz, cx, cz]) => {
    const ring = [];
    for (let k = 0; k < nu; k++) { const ph = k * TAU / nu; ring.push(M.vert(cx + rx * Math.cos(ph), y, cz + rz * Math.sin(ph), wf, mat)); }
    return ring;
  }));
}
const flatSole = (x, y, z) => [x, Math.max(y, 0.004), z];

// `lod` 0 is the close-up body. 1 is the far one, for somebody a few pixels tall: six sides to every
// loft, every other station, no face, and a hand or a shoe is a lump. It keeps the skeleton, the
// weights and the material slots, so it plays the same clips in the same outfit.
function buildBody(lod = 0) {
  const M = meshBuilder();
  const far = lod > 0;
  const N = far ? 6 : 14, SUB = far ? 0 : 1;
  const thin = (st) => (far ? st.filter((_, i) => i % 2 === 0 || i === st.length - 1) : st);
  const ell = (c, r, nu, nv, wf, mat, shape) => ellipsoid(M, c, r, far ? Math.max(4, nu >> 1) : nu, far ? Math.max(3, nv >> 1) : nv, wf, mat, shape);
  const torso = chainW([
    { y: 1.43, a: B.neck, b: B.chest, h: 0.025 },
    { y: 1.17, a: B.chest, b: B.spine, h: 0.06 },
    { y: 1.02, a: B.spine, b: B.pelvis, h: 0.05 },
  ]);
  // Below the hips the coat is split front and back, so each side follows its own thigh; the centre
  // line stays with the pelvis, which keeps the two halves joined.
  const coatW = (x, y, z) => {
    if (y > 0.93) return torso(x, y, z);
    const k = smooth(0.93, 0.62, y) * 0.92 * Math.min(1, Math.abs(x) / 0.03);
    return [B.pelvis, x >= 0 ? B.thighL : B.thighR, 1 - k];
  };
  loft(M, thin([
    [1.475, 0.070, 0.070, 0, -0.005],
    [1.445, 0.125, 0.095, 0, -0.01],
    [1.43, 0.170, 0.108, 0, -0.01],
    [1.40, 0.200, 0.116, 0, -0.01],
    [1.33, 0.195, 0.125, 0, 0.0],
    [1.24, 0.180, 0.128, 0, 0.005],
    [1.13, 0.165, 0.118, 0, 0.0],
    // The hips are wider than the thighs' tops with room to spare: at 0.175 the tops poked out of
    // the coat's front corners and read as a patch of trouser colour, like a pocket.
    [1.02, 0.168, 0.118, 0, -0.005],
    [0.92, 0.190, 0.130, 0, -0.005],
    [0.78, 0.200, 0.142, 0, 0.0],
    [0.62, 0.205, 0.150, 0, 0.005],
  ]), N, SUB, coatW, COAT);
  loft(M, [[1.57, 0.047, 0.05, 0, 0.0], [1.46, 0.052, 0.056, 0, -0.005]], N, SUB,
    chainW([{ y: 1.53, a: B.head, b: B.neck, h: 0.025 }]), SKIN);
  const head = rigid(B.head);
  const jaw = (x, y, z) => { const t = clamp01((1.625 - y) / 0.085); return [x * (1 - 0.28 * t), y, z * (1 - 0.1 * t) + 0.01 * t]; };
  ell([0, 1.645, 0.012], [0.077, 0.106, 0.094], 18, 12, head, SKIN, jaw);
  if (!far) {
    ellipsoid(M, [0, 1.632, 0.103], [0.013, 0.024, 0.018], 8, 6, head, SKIN);
    ellipsoid(M, [0, 1.598, 0.093], [0.02, 0.0045, 0.006], 8, 4, head, LIP);
  }
  // The hair is an ellipsoid with everything under the hairline pulled up onto it: high at the brow,
  // low at the nape.
  const hair = (x, y, z) => { const f = 1.64 + 0.6 * Math.max(z, -0.1); return y < f ? [x * 0.93, f, z * 0.93] : [x, y, z]; };
  ell([0, 1.668, 0.0], [0.084, 0.094, 0.1], 18, 10, head, HAIR, hair);
  for (const s of [1, -1]) {
    const L = s > 0 ? 'L' : 'R', x = 0.195 * s, lx = 0.095 * s;
    if (!far) {
      ellipsoid(M, [0.077 * s, 1.643, 0.0], [0.011, 0.028, 0.018], 8, 5, head, SKIN);
      ellipsoid(M, [0.029 * s, 1.66, 0.095], [0.012, 0.0075, 0.006], 8, 5, head, EYE);
      ellipsoid(M, [0.03 * s, 1.684, 0.093], [0.02, 0.005, 0.008], 8, 4, head, HAIR);
    }
    loft(M, thin([
      [1.43, 0.058, 0.062, x, -0.01], [1.36, 0.058, 0.06, x, -0.01], [1.26, 0.054, 0.056, x, -0.01],
      [1.16, 0.048, 0.05, x, -0.01], [1.10, 0.046, 0.048, x, -0.01], [1.02, 0.045, 0.046, x, -0.01],
      [0.93, 0.043, 0.044, x, -0.01], [0.875, 0.046, 0.046, x, -0.01],
    ]), N, SUB, chainW([
      { y: 1.39, a: B.chest, b: B['uarm' + L], h: 0.03 },
      { y: 1.10, a: B['uarm' + L], b: B['farm' + L], h: 0.045 },
    ]), COAT);
    ell([x, 0.795, 0.005], [0.026, 0.068, 0.043], 10, 8, rigid(B['hand' + L]), SKIN);
    if (!far) ellipsoid(M, [x, 0.83, 0.038], [0.016, 0.03, 0.016], 8, 6, rigid(B['hand' + L]), SKIN);
    loft(M, thin([
      [0.965, 0.075, 0.085, lx, -0.005], [0.88, 0.080, 0.086, lx, 0.0], [0.76, 0.072, 0.078, lx, 0.005],
      [0.62, 0.060, 0.064, lx, 0.005], [0.53, 0.053, 0.057, lx, 0.0], [0.47, 0.053, 0.058, lx, 0.0],
      [0.40, 0.055, 0.062, lx, -0.008], [0.30, 0.050, 0.055, lx, -0.005], [0.18, 0.045, 0.048, lx, 0.0],
      [0.10, 0.050, 0.052, lx, 0.0],
    ]), N, SUB, chainW([
      { y: 0.93, a: B.pelvis, b: B['thigh' + L], h: 0.04 },
      { y: 0.49, a: B['thigh' + L], b: B['shin' + L], h: 0.04 },
      { y: 0.095, a: B['shin' + L], b: B['foot' + L], h: 0.02 },
    ]), LEGS);
    // The shoe bends at the ball: behind it rides the foot, in front the toes.
    const toeW = (x, y, z) => [B['foot' + L], B['toe' + L], 1 - smooth(0.072, 0.118, z)];
    ell([lx, 0.052, 0.045], [0.048, 0.052, 0.122], 20, 7, toeW, SHOE, flatSole);
  }
  return M;
}

// ── Clips. Each is a pose as a function of phase 0..1, and each loops. ─────────────────────────────
// A bump on the unit circle, so a curve built from them wraps cleanly at the end of the cycle.
function bump(q, c, w) { let d = q - c; d -= Math.round(d); return Math.exp(-0.5 * (d / w) * (d / w)); }

// The walk: sagittal joint curves shaped after clinical gait data. Right heel strike at 0, left at 0.5.
// The hip flexes 30° at heel strike and extends 12° at toe-off, peaking in late swing; the knee has
// its small loading bend and its big swing bend (about 60° at 72%); the ankle rolls, the heel comes
// up from 40% while the toes bend at the ball and stay down, it pushes off at 62%, then clears. Each
// leg turns out a few degrees and lands a little inside the hip, so the feet fall about 12 cm apart
// rather than hip-width.
function walkPose(p) {
  const P = newPose();
  const leg = (q, s, side) => {
    const hip = 9 + 21 * Math.cos(TAU * (q - 0.03)) + 2.5 * Math.sin(2 * TAU * q);
    const knee = 4 + 14 * bump(q, 0.13, 0.06) + 58 * bump(q, 0.72, 0.11);
    const ank = -6 * bump(q, 0.05, 0.035) + 11 * bump(q, 0.4, 0.11) - 20 * bump(q, 0.62, 0.055) + 4 * bump(q, 0.82, 0.08);
    setR(P, 'thigh' + s, -hip * DEG, side * 6 * DEG, -side * 2 * DEG);
    setR(P, 'shin' + s, knee * DEG, 0, 0);
    setR(P, 'foot' + s, -ank * DEG, 0, 0);
  };
  leg(p, 'R', -1); leg((p + 0.5) % 1, 'L', 1);
  const c = Math.cos(TAU * p), s = Math.sin(TAU * p);
  // The pelvis turns toward the swinging leg, drops on the swing side and shifts over the stance foot.
  setR(P, 'pelvis', 2 * DEG, 5 * DEG * c, -4 * DEG * s);
  P.root[0] = -0.022 * s;
  // The trunk counter-rotates so the shoulders turn against the hips; the head holds steady.
  setR(P, 'spine', 2 * DEG, -4 * DEG * c, 3 * DEG * s);
  setR(P, 'chest', 1 * DEG, -4 * DEG * c, 1 * DEG * s);
  setR(P, 'neck', -1 * DEG, 1.5 * DEG * c, 0);
  setR(P, 'head', -1.5 * DEG + 1.2 * DEG * Math.cos(2 * TAU * p), 1.5 * DEG * c, -0.5 * DEG * s);
  // The arms swing against the legs: the right arm comes forward with the left leg. They hang from
  // the shoulder and lag the legs a little; the forearm lags the upper arm, the hand lags the
  // forearm, and both swing a touch across the body.
  const ca = Math.cos(TAU * (p - 0.05)), ce = Math.cos(TAU * (p - 0.12)), sh = Math.sin(TAU * (p - 0.1));
  setR(P, 'uarmR', -(4 - 18 * ca) * DEG, 4 * DEG, -0.10);
  setR(P, 'uarmL', -(4 + 18 * ca) * DEG, -4 * DEG, 0.10);
  setR(P, 'farmR', -(14 + 18 * (0.5 - 0.5 * ce)) * DEG, 0, 0);
  setR(P, 'farmL', -(14 + 18 * (0.5 + 0.5 * ce)) * DEG, 0, 0);
  setR(P, 'handR', (-8 - 7 * sh) * DEG, 0, 0);
  setR(P, 'handL', (-8 + 7 * sh) * DEG, 0, 0);
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
];
export const ACTOR_CLIPS = CLIPS.map(({ name, frames, dur }) => ({ name, frames, dur }));
export const actorClipPose = (name, p) => CLIPS.find((c) => c.name === name).fn(p);
export const actorFK = fk;
export const ACTOR_BONE = B;

// ── Root motion. The clip plays in place and the instance moves at a constant speed, so for the
// stance foot to stay put the pelvis has to surge ahead when the legs are fast and drop back when
// they are slow. The surge is baked into the clip, and its average speed is the stride. Solved on
// first use rather than at import, because windshield.js imports this module at boot. ──────────────
function solveRoot(clip) {
  if (clip.surge) return;
  // Points along each sole in the foot bone's own frame, heel to toe. The one lowest on the ground is
  // what the foot is pivoting on, so it's the one that has to stay still: locking the ankle instead
  // lets the heel skate at strike and the toes skate at push-off. Past the ball of the foot a point
  // rides the toe bone, which stays flat while the heel comes up.
  const SOLE = [-0.03, 0.015, 0.06, 0.095, 0.13, 0.16].map((z) => [0, -0.076, z]);
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
    // The lower ankle says which foot is down; the lowest point on that sole is its pivot.
    const foot = pts[i][0].ankle < pts[i][1].ankle ? 0 : 1, sole = pts[i][foot].sole;
    let k = 0;
    for (let j = 1; j < sole.length; j++) if (sole[j][0] < sole[k][0]) k = j;
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
//     preview, far }  where `preview` is the unhalved positions, frame-major, for the gate and the
//     Modelshop, and `far` is the same shape again for the lod-1 body (see buildBody) at half the frames.
//
// The whole bake is about 2 ms a frame, 112 frames, so the game takes it in slices (actorBakeStep)
// and draws the billboard until it is done, rather than stalling one frame for a quarter of a second.
let _bake = null, _job = null, _near = null;
// The far body's clips have half the frames: at a few pixels nobody can count them.
const clipFrames = (clip, lod) => (lod ? clip.frames >> 1 : clip.frames);
function bakeBegin(lod = 0) {
  solveRoot(CLIPS[0]);
  const M = buildBody(lod);
  const nv = M.p.length / 3, rows = Math.ceil(nv / 1024), W = Math.ceil(nv / rows);
  const frames = CLIPS.reduce((x, c) => x + clipFrames(c, lod), 0), H = frames * rows;
  return {
    lod, nv, nt: M.i.length / 3, W, rows, H, frames, top: 0, ci: 0, f: 0, F: 0, clips: {},
    pos: new Uint16Array(W * H * 4), nrm: new Uint16Array(W * H * 4), preview: new Float32Array(nv * frames * 3),
    P: new Float32Array(nv * 3), Nn: new Float32Array(nv * 3), mat: new Float32Array(M.m),
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
  // Height: whichever foot is lowest touches the ground. The walk's bob comes out of this.
  const idle = clip.name === 'idle';
  for (let v = 0; v < nv; v++) { const y = (P[v * 3 + 1] -= minY); if (idle && y > J.top) J.top = y; }
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
  J.F++;
  if (++J.f >= len) { J.f = 0; J.ci++; }
  return J.ci >= CLIPS.length;
}
// Bake for up to `budgetMs`, then return: the finished bake once there is one, null until then.
// The near body bakes first and the far one after it; the bake is ready once both are.
export function actorBakeStep(budgetMs = 2) {
  if (_bake) return _bake;
  if (!_job) _job = bakeBegin(_near ? 1 : 0);
  const t0 = performance.now();
  for (;;) {
    if (bakeFrame(_job)) {
      const J = _job;
      _job = null;
      const out = { nv: J.nv, nt: J.nt, W: J.W, rows: J.rows, H: J.H, frames: J.frames, pos: J.pos, nrm: J.nrm,
        mat: J.mat, idx: J.ix, top: J.top, clips: J.clips, preview: J.preview };
      if (!_near) { _near = out; _job = bakeBegin(1); } else { _bake = { ..._near, far: out }; return _bake; }
    }
    if (performance.now() - t0 >= budgetMs) return null;
  }
}
// The finished bake if there is one, without doing any work.
export const actorBakeReady = () => _bake;
// The whole bake at once, for the gate and the Modelshop.
export function actorBake() { return actorBakeStep(Infinity); }

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
// colours, `mat` ([coat, trousers, shoes] as ACTOR_MATERIAL codes), and `tone`, the blob's six-way
// bucket, taken from the coat's lightness so a figure keeps roughly its brightness when it crosses
// between the mesh and the billboard.
export function actorOutfit(rand) {
  const o = {};
  PARTS.forEach((p, k) => { o[p] = pick(ACTOR_OUTFITS[p], rand(k)); });
  o.mat = ['coat', 'legs', 'shoes'].map((p) => pick(ACTOR_MATERIALS[p], rand(MAT_K[p])));
  const [r, g, b] = o.coat;
  const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  o.tone = Math.max(0, Math.min(5, Math.floor(luma * 1.9 * 6)));
  return o;
}
