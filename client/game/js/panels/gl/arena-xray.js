// GLASS 2 · THE X-RAY. A hit that ends a man's season or his life is run back slowed right
// down, and as it lands the picture goes dark and blue and you see through him: his flesh a
// faint shell, his skeleton inside it lit white, and the bone the hit breaks breaking.
//
// The director decides when (rink/director.js, `D.xrayPending`), the replay slows down round
// the moment of impact and works out how far into it the picture is (rink/replay.js puts
// `xray` on its source: `k` the X-ray's strength, `d` replay seconds from impact, `crack`
// how far the break has opened), and this file draws it. Everything here is a pure function
// of the man's 21 joints, the bone and `d`, so a replay run twice breaks the same way.
//
// The skeleton is built in his body frame from the joints alone (rink/rig.js lists them):
// spine up from the pelvis to the neck, the shoulders across, forward their cross. A bone is
// a list of segments and balls tagged with its name; the broken one is split where it
// breaks, its two ends pushed apart and turned, and chips thrown off it.
//
// GORE is the viewer's setting (gameday-rink.js keeps it):
//   full   the organs inside him, the one nearest the break bursting, blood out of it
//   bones  the skeleton and the break, chips of bone, no organs and no blood
//   off    no X-ray at all: the hit's replay is slowed, and that's all (the director checks)

import * as M from './arena-mesh.js';
import { V, clamp, rng, hash } from '../rink/util.js';

export const XRAY_GORE = ['full', 'bones', 'off'];

// the joint the picture closes in on for each bone (replay.js reads this for its camera)
export const XRAY_FOCUS = {
  skull: 3, jaw: 3, neck: 2, spine: 1, ribs: 1, pelvis: 0,
  clavicleL: 4, clavicleR: 7, humerusL: 5, humerusR: 8, femurL: 11, femurR: 14, tibiaL: 12, tibiaR: 15,
};

const BONE = [0.84, 0.92, 1, 1], BONE_EDGE = [0.62, 0.76, 0.9, 1], SOCKET = [0.05, 0.08, 0.12, 1];
const MARROW = [0.55, 0.05, 0.05, 1], BLOOD = [0.62, 0.02, 0.03, 1], BLOOD_DARK = [0.34, 0.01, 0.02, 1];
const ORGAN = { brain: [0.8, 0.45, 0.5, 1], lung: [0.78, 0.26, 0.3, 1], heart: [0.66, 0.06, 0.08, 1], liver: [0.46, 0.09, 0.07, 1], gut: [0.72, 0.38, 0.32, 1] };
// the flesh is a shell drawn additively, so its colour is what it adds
const GHOST = [0.2, 0.62, 0.78, 0.2], FLASH = [1, 0.96, 0.88, 1];

const ok = (p) => p && Number.isFinite(p[0]);

// His body frame: U up his spine, S to his left, F forward.
function frame(J) {
  const U = V.norm(V.sub(J[2], J[0]));
  const ortho = (v) => V.norm(V.sub(v, V.mul(U, V.dot(v, U))));
  const S = ortho(V.sub(J[4], J[7]));
  return { U, S, F: V.cross(S, U) };
}

// The skeleton as tagged pieces: { seg: [A, B, ra, rb], tag } and { ball: [C, r], tag }.
function skeleton(J, missing) {
  const { U, S, F } = frame(J), out = [];
  // (a piece is returned, so a rib can be marked as it's made)
  const seg = (A, B, ra, rb, tag, col = BONE) => { const q = { A, B, ra, rb, tag, col }; out.push(q); return q; };
  const ball = (C, r, tag, col = BONE, ax = null) => out.push({ C, r, tag, col, ax });
  const at = (o, u, f, s) => V.add(o, V.add(V.mul(U, u), V.add(V.mul(F, f), V.mul(S, s))));
  // the skull and the face: a head is about 0.9 ft, the skull a little smaller
  if (!missing.head) {
    const H = at(J[3], 0.04, 0.02, 0);
    ball(H, 0.36, 'skull', BONE, [F, S, U, [0.38, 0.32, 0.4]]);
    for (const s of [1, -1]) ball(at(H, 0.02, 0.3, s * 0.13), 0.085, 'skull', SOCKET);
    ball(at(H, -0.12, 0.34, 0), 0.05, 'skull', SOCKET);
    // the jaw: down from under each ear to the chin
    const chin = at(H, -0.36, 0.26, 0);
    for (const s of [1, -1]) seg(at(H, -0.12, 0.02, s * 0.25), chin, 0.05, 0.045, 'jaw');
    // the neck, seven of them, from the top of the chest to the skull's base
    for (let i = 0; i < 6; i++) {
      const t = (i + 0.5) / 6;
      ball(V.lerp(at(J[2], -0.05, -0.05, 0), at(H, -0.3, -0.08, 0), t), 0.075, 'neck', BONE, [F, S, U, [0.09, 0.1, 0.055]]);
    }
  }
  // the spine: a column of vertebrae down his back
  for (let i = 0; i < 12; i++) {
    const t = (i + 0.5) / 12, C = V.lerp(at(J[0], 0.1, -0.22, 0), at(J[2], -0.08, -0.16, 0), t);
    ball(C, 0.09, 'spine', BONE, [F, S, U, [0.11, 0.12, 0.065]]);
  }
  // the ribs: seven pairs round the chest from the spine to the sternum, widest in the middle
  const tl = V.len(V.sub(J[2], J[0]));
  for (let k = 0; k < 7; k++) {
    const h = 0.42 + k * 0.075, w = 0.5 + 0.12 * Math.sin((k + 1) / 8 * Math.PI), d = 0.36 + 0.05 * Math.sin((k + 1) / 8 * Math.PI);
    const C = V.add(J[0], V.mul(U, h * tl));
    for (const s of [1, -1]) {
      let prev = null;
      for (let i = 0; i <= 6; i++) {
        const th = (i / 6) * Math.PI * 0.86, p = V.add(C, V.add(V.mul(F, -Math.cos(th) * d - 0.04), V.add(V.mul(S, s * Math.sin(th) * w), V.mul(U, -0.06 * Math.sin(th)))));
        if (prev) seg(prev, p, 0.032, 0.032, 'ribs', BONE).rib = { k, s, i };
        prev = p;
      }
    }
  }
  seg(at(J[0], 0.5 * tl, 0.34, 0), at(J[0], 0.9 * tl, 0.32, 0), 0.04, 0.05, 'ribs');
  // the collarbones, the arms
  for (const [sh, el, ha, s, L] of [[4, 5, 6, 1, 'L'], [7, 8, 9, -1, 'R']]) {
    seg(at(J[2], -0.12, 0.14, s * 0.06), at(J[sh], 0.04, 0.05, 0), 0.04, 0.04, 'clavicle' + L);
    if (missing['arm' + L]) continue;
    if (ok(J[el])) { seg(J[sh], J[el], 0.07, 0.055, 'humerus' + L); ball(J[sh], 0.1, 'humerus' + L); ball(J[el], 0.07, 'humerus' + L, BONE_EDGE); }
    if (ok(J[el]) && ok(J[ha])) {
      for (const o of [-0.04, 0.04]) seg(V.add(J[el], V.mul(F, o)), V.add(J[ha], V.mul(F, o)), 0.035, 0.03, 'forearm' + L);
      ball(J[ha], 0.07, 'hand' + L, BONE_EDGE);
    }
  }
  // the pelvis: the two wings and the sacrum between them
  for (const s of [1, -1]) ball(at(J[0], 0.12, -0.02, s * 0.3), 0.2, 'pelvis', BONE, [F, S, U, [0.1, 0.24, 0.2]]);
  ball(at(J[0], 0.02, -0.2, 0), 0.12, 'pelvis');
  // the legs
  for (const [hip, kn, an, toe, L] of [[10, 11, 12, 16, 'L'], [13, 14, 15, 17, 'R']]) {
    if (missing['leg' + L]) continue;
    ball(J[hip], 0.12, 'femur' + L);
    seg(J[hip], J[kn], 0.085, 0.07, 'femur' + L);
    ball(J[kn], 0.1, 'femur' + L, BONE_EDGE);
    seg(J[kn], J[an], 0.07, 0.05, 'tibia' + L);
    seg(V.add(J[kn], V.mul(F, -0.08)), V.add(J[an], V.mul(F, -0.06)), 0.03, 0.028, 'tibia' + L);
    if (ok(J[toe])) seg(J[an], J[toe], 0.05, 0.035, 'foot' + L);
  }
  return { parts: out, U, S, F };
}
// Where the bone breaks, and which way: a point on it and the direction its ends go.
function breakOf(sk, bone, seed) {
  const r = rng(seed);
  const pieces = sk.parts.filter((p) => p.tag === bone);
  if (!pieces.length) return null;
  if (bone === 'ribs') {
    // two or three ribs on one side, low on the chest where a check lands
    const s = r() < 0.5 ? 1 : -1, k0 = 1 + Math.floor(r() * 3), ks = [k0, k0 + 1, ...(r() < 0.6 ? [k0 + 2] : [])];
    const hit = pieces.filter((p) => p.rib && p.rib.s === s && ks.includes(p.rib.k) && p.rib.i === 4);
    const at = hit.length ? V.lerp(hit[0].A, hit[0].B, 0.5) : V.lerp(pieces[0].A, pieces[0].B, 0.5);
    return { at, n: V.norm(V.add(V.mul(sk.S, -s), V.mul(sk.F, 0.3))), pieces: hit, kind: 'ribs' };
  }
  if (bone === 'skull') {
    const C = pieces[0].C, n = V.norm(V.add(V.mul(sk.S, r() < 0.5 ? 1 : -1), V.add(V.mul(sk.F, 0.4), V.mul(sk.U, 0.5))));
    return { at: V.add(C, V.mul(n, 0.36)), n: V.mul(n, -1), pieces: [pieces[0]], kind: 'skull' };
  }
  if (bone === 'neck' || bone === 'spine') {
    const p = pieces[Math.floor(pieces.length * (bone === 'neck' ? 0.45 : 0.3 + r() * 0.4))];
    return { at: p.C, n: V.norm(V.add(V.mul(sk.S, r() < 0.5 ? 1 : -1), V.mul(sk.F, -0.5))), pieces: [p], kind: 'column' };
  }
  if (bone === 'pelvis') {
    const p = pieces[r() < 0.5 ? 0 : 1];
    return { at: p.C, n: V.norm(V.mul(sk.S, pieces.indexOf(p) ? -1 : 1)), pieces: [p], kind: 'ball' };
  }
  // a long bone: snapped across near its middle
  const p = pieces.find((q) => q.A) || pieces[0];
  if (!p.A) return { at: p.C, n: sk.F, pieces: [p], kind: 'ball' };
  const t = 0.4 + r() * 0.2, u = V.norm(V.sub(p.B, p.A));
  const side = V.norm(V.cross(u, Math.abs(V.dot(u, sk.U)) > 0.9 ? sk.F : sk.U));
  return { at: V.lerp(p.A, p.B, t), t, n: side, pieces: [p], kind: 'long' };
}

// The flesh: a shell round him, so the skeleton has a body to be inside.
function ghost(b, J, missing) {
  const T = (a, c, ra, rb) => { if (ok(J[a]) && ok(J[c])) M.tube(b, J[a], J[c], ra, rb, GHOST, 10); };
  T(0, 2, 0.62, 0.7);
  if (!missing.head) { T(2, 3, 0.22, 0.2); M.sphere(b, J[3], 0.47, GHOST, 12, 8); }
  M.sphere(b, J[0], 0.58, GHOST, 10, 7);
  if (!missing.armL) { T(4, 5, 0.24, 0.2); T(5, 6, 0.19, 0.15); }
  if (!missing.armR) { T(7, 8, 0.24, 0.2); T(8, 9, 0.19, 0.15); }
  if (!missing.legL) { T(10, 11, 0.33, 0.25); T(11, 12, 0.24, 0.17); }
  if (!missing.legR) { T(13, 14, 0.33, 0.25); T(14, 15, 0.24, 0.17); }
}

// His insides, for full gore: the organ nearest the break swells and goes dark as it bursts.
function organs(b, sk, J, missing, br, crack) {
  const { U, S, F } = sk, tl = V.len(V.sub(J[2], J[0]));
  const at = (o, u, f, s) => V.add(o, V.add(V.mul(U, u), V.add(V.mul(F, f), V.mul(S, s))));
  const list = [];
  if (!missing.head) list.push(['brain', at(J[3], 0.08, 0.0, 0), [0.25, 0.2, 0.22]]);
  for (const s of [1, -1]) list.push(['lung', at(J[0], 0.66 * tl, 0.02, s * 0.25), [0.2, 0.2, 0.36]]);
  list.push(['heart', at(J[0], 0.62 * tl, 0.14, 0.08), [0.13, 0.12, 0.15]]);
  list.push(['liver', at(J[0], 0.4 * tl, 0.1, -0.16), [0.16, 0.26, 0.11]]);
  list.push(['gut', at(J[0], 0.2 * tl, 0.14, 0), [0.24, 0.3, 0.18]]);
  for (const [name, C, r] of list) {
    const near = br && V.len(V.sub(C, br.at)) < 0.55;
    const swell = near ? 1 + 0.35 * crack : 1, col = near ? mixC(ORGAN[name], BLOOD_DARK, crack * 0.7) : ORGAN[name];
    M.ellipsoid(b, C, F, S, U, r.map((x) => x * swell), col, 10, 7);
  }
}
const mixC = (a, c, k) => [a[0] + (c[0] - a[0]) * k, a[1] + (c[1] - a[1]) * k, a[2] + (c[2] - a[2]) * k, 1];

// The bones, with the broken one broken.
function bones(b, sk, br, crack) {
  const gap = 0.14 * crack;
  for (const p of sk.parts) {
    const broken = br && br.pieces.includes(p);
    if (p.A) {
      if (!broken) { M.tube(b, p.A, p.B, p.ra, p.rb, p.col, 7); continue; }
      // snapped: the two halves pulled apart at the break, each kinked away from the other
      const t = br.t ?? 0.5, Mid = V.lerp(p.A, p.B, t), n = br.n;
      const m1 = V.add(Mid, V.add(V.mul(n, gap), V.mul(V.norm(V.sub(p.A, Mid)), gap * 0.35)));
      const m2 = V.add(Mid, V.add(V.mul(n, -gap * 0.6), V.mul(V.norm(V.sub(p.B, Mid)), gap * 0.35)));
      const r = (p.ra + p.rb) / 2;
      M.tube(b, p.A, m1, p.ra, r, p.col, 7); M.tube(b, m2, p.B, r, p.rb, p.col, 7);
      // the jagged ends, and the marrow in them
      if (crack > 0.05) {
        for (const [e, o] of [[m1, p.A], [m2, p.B]]) {
          const u = V.norm(V.sub(e, o));
          M.tube(b, e, V.add(e, V.add(V.mul(u, r * 1.6), V.mul(n, r * 0.8))), r * 0.9, 0.004, BONE_EDGE, 5);
          M.sphere(b, V.add(e, V.mul(u, -r * 0.3)), r * 0.7, MARROW, 6, 4);
        }
      }
      continue;
    }
    const ax = p.ax || [[1, 0, 0], [0, 1, 0], [0, 0, 1], [p.r, p.r, p.r]];
    if (!broken) { M.ellipsoid(b, p.C, ax[0], ax[1], ax[2], ax[3], p.col, 9, 6); continue; }
    if (br.kind === 'skull') {
      // the skull holds, dented in where it was hit, a plate of it lifted at the edge
      M.ellipsoid(b, p.C, ax[0], ax[1], ax[2], ax[3], p.col, 12, 8);
      M.sphere(b, V.add(br.at, V.mul(br.n, -0.03 + 0.06 * crack)), 0.11 * (0.4 + crack), SOCKET, 8, 5);
      continue;
    }
    // a vertebra or a wing of the pelvis knocked out of line and split in two
    for (const s of [1, -1]) {
      const C = V.add(p.C, V.mul(br.n, s * gap * (s > 0 ? 1.2 : 0.4)));
      M.ellipsoid(b, C, ax[0], ax[1], ax[2], ax[3].map((x) => x * 0.72), p.col, 8, 5);
    }
  }
  // cracks run out from the break across whatever it's on
  if (br && crack > 0) {
    const r = rng(hash('crack' + br.kind));
    const tang = V.norm(V.cross(br.n, Math.abs(br.n[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1])), bit = V.cross(br.n, tang);
    const n = br.kind === 'skull' ? 7 : 4;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r(), len = (0.12 + r() * 0.18) * crack;
      let p0 = br.at;
      for (let s = 0; s < 3; s++) {
        const aa = a + (r() - 0.5) * 0.8, d = V.add(V.mul(tang, Math.cos(aa)), V.mul(bit, Math.sin(aa)));
        const p1 = V.add(p0, V.mul(d, len / 3));
        M.tube(b, p0, p1, 0.012, 0.008, SOCKET, 4);
        p0 = p1;
      }
    }
  }
}

// Chips of bone and, for full gore, blood thrown out of the break. `d` is replay seconds
// since impact: everything flies on a fixed path from it, so it's the same every frame.
function debris(b, br, d, gore, seed) {
  if (!br || d <= 0) return;
  const r = rng(seed ^ 0x51ab);
  const fly = (v0, g, t) => V.add(br.at, V.add(V.mul(v0, t), [0, 0, -0.5 * g * t * t]));
  const chips = gore === 'full' ? 14 : 7;
  for (let i = 0; i < chips; i++) {
    const v0 = V.add(V.mul(br.n, 1.2 + r() * 2.2), [(r() - 0.5) * 2.4, (r() - 0.5) * 2.4, (r() - 0.2) * 2]);
    M.sphere(b, fly(v0, 9, d), 0.018 + r() * 0.025, i % 3 ? BONE : BONE_EDGE, 4, 3);
  }
  if (gore !== 'full') return;
  // the spray, and a slower welling cloud behind it
  for (let i = 0; i < 40; i++) {
    const v0 = V.add(V.mul(br.n, 2 + r() * 5), [(r() - 0.5) * 3, (r() - 0.5) * 3, r() * 2.6]);
    const t = Math.max(0, d - r() * 0.15);
    if (t > 0) M.sphere(b, fly(v0, 18, t), 0.02 + r() * 0.035, i % 4 ? BLOOD : BLOOD_DARK, 5, 3);
  }
  const well = Math.min(1, d * 3);
  for (let i = 0; i < 6; i++) M.sphere(b, V.add(br.at, V.mul([(r() - 0.5), (r() - 0.5), (r() - 0.5)], 0.25 * well)), (0.06 + r() * 0.06) * well, BLOOD_DARK, 7, 5);
}

// Everything for one frame of X-ray, into three batches: the shell (`glow`, drawn
// additively without depth), the insides and the bones (`solid`, lit, depth-tested), and the
// flash at the break (`glow` too). Null when there's nobody to X-ray.
export function buildXray(out, W, xr, gore) {
  const body = W.bodies().find((q) => q.seed === xr.seed && q.side === xr.side);
  const J = body && W.rigOf(body);
  if (!J) return null;
  for (let i = 0; i < 18; i++) if (!ok(J[i])) return null;
  const missing = body.missing || {};
  const sk = skeleton(J, missing);
  const seed = hash(`xray${xr.seed}${xr.side}${xr.bone}`);
  const br = breakOf(sk, xr.bone, seed);
  const d = xr.d, crack = clamp(d / 0.12, 0, 1);
  ghost(out.glow, J, missing);
  if (gore === 'full') organs(out.solid, sk, J, missing, br, crack);
  bones(out.solid, sk, br, crack);
  // a limb that came off takes its bone with it, out of the end of it
  for (const l of W.limbs || []) {
    if (!l.owner || l.owner.seed !== xr.seed || !l.pts || l.pts.length < 2) continue;
    const P = l.pts.map((q) => [q.x, q.y, q.z]);
    if (l.part === 'head') M.sphere(out.solid, P[0], 0.36, BONE, 10, 7);
    else for (let i = 1; i < P.length; i++) M.tube(out.solid, P[i - 1], P[i], 0.07, 0.055, BONE, 7);
    if (gore === 'full') M.sphere(out.solid, P[0], 0.08, MARROW, 6, 4);
  }
  debris(out.solid, br, d, gore, seed);
  if (br && d >= 0) {
    const f = Math.exp(-d * 9);
    if (f > 0.02) M.sphere(out.glow, br.at, 0.12 + 0.5 * (1 - f), [FLASH[0] * f, FLASH[1] * f, FLASH[2] * f, f], 10, 7);
  }
  return br;
}
