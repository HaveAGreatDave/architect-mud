// ANIMALS IN THE ROOM: an enemy with a fauna model (flags.fauna, "kind/id") drawn on the Room Stage's floor.
//
// ⚠ THE MESH IS GLASS'S. The faces and their colours come from faunaWorldFaces (fauna3d.js), the same call the
// street's hounds are drawn from, so a gutter hound in a flat is the gutter hound in Bracken's pack. Nothing here
// shapes an animal; it only scales the model to metres, stands it on the floor and turns it.
//
// The server says which animals are in the room (plugins/roomstage beastsIn) and nothing about where: an enemy has
// no place in a room. So each stands at a spot hashed from its id, the same every frame and for everybody, facing
// whoever it's watching (the eye it's given) or else the door.
//
// An animal with a close-up body (gl/beast-looks.js) is drawn from that instead: the beast kit's model, built once,
// to the close-up figure's standard. GLASS's model is what's left for anything without one.
import { faunaWorldFaces } from '../fauna3d.js';
import { createBatch, vtx, lin, MAT } from './ballpark-mesh.js';
import { beastMesh, toBatch, placeAt } from './beast-kit.js';
import { BEAST_LOOKS } from './beast-looks.js';
import { catLook, skinCat, idleMotion } from './cat-kit.js';
import { bakeCatOff } from './cat-bake.js';

// ── cats (a pet's NPC with the cat kit's numbers: plugins/pets) ────────────────────────────────────────────
// A cat is carved per pose in a worker (gl/cat-bake.js). Where it settles and how it lies there come from the clock
// and its id, so everyone sees the same cat with no messages: every few minutes it takes another spot and another
// pose. It's moved there, not walked; walking between spots is phase 3.
//
// It holds still while it's settled. Skinning a carve to its idle costs 60 to 130 ms on the main thread, far too much
// for every frame, so the stage builds the beasts again only when a cat settles somewhere new or a carve lands
// (catSettle, catsVersion), and the skinned cat is kept for any other rebuild. The breathing, the ears and the blink
// the Cattery shows want skinning on the GPU first.
const CAT_H = 0.008, CAT_FACE_H = 0.004;  // the room's carve: coarser than the Cattery's, the face twice as fine
const CAT_SETTLE_MS = 4 * 60 * 1000;      // how long it holds a spot
const CAT_POSES_BY_WEIGHT = ['loaf', 'loaf', 'sit', 'curl', 'curl', 'stand'];
const _cats = new Map();                  // look key + pose → bake, or 'pending'
const _skinned = new Map();               // cat id → { key, M }: the cat as it's settled now
let _catVer = 0;
/** Bumped whenever a cat's carve lands: the stage builds the beasts again. */
export const catsVersion = () => _catVer;
/** Whether any of these beasts is a cat. */
export const hasCats = (beasts) => !!beasts?.some((b) => b?.cat);
/** Whether they're all cats, which don't turn to face you, so walking about needn't build them again. */
export const onlyCats = (beasts) => !!beasts?.length && beasts.every((b) => b?.cat);
/** Which settle the cats are in: it changes when they move to a new spot. */
export const catSettle = (now = Date.now()) => Math.floor(now / CAT_SETTLE_MS);
function catBake(look, pose) {
  const key = JSON.stringify(look) + '@' + pose;
  const b = _cats.get(key);
  if (b && b !== 'pending') return b;
  if (!b) {
    _cats.set(key, 'pending');
    bakeCatOff(catLook(JSON.parse(JSON.stringify(look))), pose, { h: CAT_H, faceH: CAT_FACE_H })
      .then((nb) => { _cats.set(key, nb); _catVer++; }, (e) => { _cats.delete(key); console.error('[room-beasts] cat carve failed', e); });
  }
  return null;
}
/** Where a cat is settled now and how: its spot, its pose, how awake and which way it faces, from the clock and its id. */
export function catState(L, id, now = Date.now()) {
  const seg = catSettle(now), r = hash(id + ':' + seg);
  const pose = CAT_POSES_BY_WEIGHT[Math.floor(r * CAT_POSES_BY_WEIGHT.length)];
  return { seg, pose, at: beastSpot(L, id + ':' + seg), awake: pose === 'curl' ? 0.05 : pose === 'loaf' ? 0.6 : 1, turn: hash(id + ':t' + seg) };
}
function drawCat(b, L, bt, now) {
  const st = catState(L, bt.id, now);
  // until this pose is carved, the cat stays as it was
  const bake = catBake(bt.cat, st.pose);
  const key = bake ? st.seg + '@' + st.pose : null;
  let sk = _skinned.get(bt.id);
  if (bake && (sk?.key !== key || sk.L !== L)) {
    const M = beastMesh();
    // a moment of its idle, the same for everyone: asleep, its eyes shut
    skinCat(bake, M, idleMotion(st.seg * 7.3, { awake: st.awake, seed: hash(bt.id) * 10 }), {});
    const at = bt.at || st.at, a = st.turn * Math.PI * 2;
    sk = { key, L, M, xf: placeAt(L.world(at[0], at[1], L.baseAt?.(at[0], at[1]) || 0), [Math.sin(a), 0, Math.cos(a)]) };
    _skinned.set(bt.id, sk);
  }
  if (sk) toBatch(b, sk.M, sk.xf);
}

// each close-up body, built once: it holds its stance, as the GLASS model holds its first walk pose
const _close = new Map();
function closeUp(fauna) {
  if (_close.has(fauna)) return _close.get(fauna);
  const look = BEAST_LOOKS[fauna], M = look ? beastMesh() : null;
  if (M) look(M, 0);
  _close.set(fauna, M);
  return M;
}

// How long each kind is, nose to tail, in metres. The fauna tables are in their own model units, sized for the
// street; a room needs the real animal.
const LENGTH_M = { quadruped: 1.35, bird: 0.6 };

// one model's faces in model units (x forward, y left, z up) with its extent, cached per kind/id/state/beat
const _model = new Map();
function modelOf(kind, id, state, beat) {
  const key = kind + '/' + id + ':' + state + ':' + beat;
  let m = _model.get(key);
  if (m !== undefined) return m;
  const faces = faunaWorldFaces(kind, id, { state, beat, scale: 1 });
  if (!faces.length) { _model.set(key, null); return null; }
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, cx = 0, cy = 0, cz = 0, n = 0;
  for (const f of faces) for (const p of f.p) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[2]); cx += p[0]; cy += p[1]; cz += p[2]; n++; }
  m = { faces, x0, x1, z0, c: [cx / n, cy / n, cz / n] };
  _model.set(key, m);
  return m;
}

const hex = (c) => '#' + c.slice(0, 3).map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const hash = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };

/** Where a beast stands in the layout's frame: [u, v], u across the room, v back from the front wall. */
export function beastSpot(L, id, i = 0) {
  const w = L.spec?.w || 4, d = L.spec?.d || 4, a = hash(id), b = hash(id + ':v');
  return [(a - 0.5) * w * 0.55 + (i % 2 ? 0.6 : 0), d * (0.3 + 0.3 * b)];
}

/**
 * The batch for every beast in the room. `beasts` is [{ id, fauna: 'kind/id' }], `eye` [u, v] or null: what
 * they turn to face. Each holds its first walk pose: an animal in a room stands its ground.
 */
export function beastsBatch(L, beasts, { eye = null, now = Date.now() } = {}) {
  const b = createBatch(4096);
  if (!L || !beasts?.length) return b;
  beasts.forEach((bt, i) => {
    if (bt.cat) { drawCat(b, L, bt, now); return; }
    const [kind, id] = String(bt.fauna || '').split('/');
    const at = bt.at || beastSpot(L, bt.id, i);
    const near = closeUp(String(bt.fauna || ''));
    if (near) {
      const to = eye || [0, L.spec?.d || 4], A = L.world(at[0], at[1], 0), B = L.world(to[0], to[1], 0);
      const fl = Math.hypot(B[0] - A[0], B[2] - A[2]) || 1;
      toBatch(b, near, placeAt(L.world(at[0], at[1], L.baseAt?.(at[0], at[1]) || 0), [(B[0] - A[0]) / fl, 0, (B[2] - A[2]) / fl]));
      return;
    }
    const m = kind && id ? modelOf(kind, id, 'walk', 0) : null;
    if (!m) return;
    const s = (LENGTH_M[kind] || 1) / Math.max(1e-6, m.x1 - m.x0);
    // the way it faces, from the layout's own transform: what it's looking at less where it stands, in the world
    const to = eye || [0, L.spec?.d || 4];
    const A = L.world(at[0], at[1], 0), B = L.world(to[0], to[1], 0);
    let F = [B[0] - A[0], 0, B[2] - A[2]];
    const fl = Math.hypot(F[0], F[2]) || 1; F = [F[0] / fl, 0, F[2] / fl];
    // model +y is the animal's left; with +Y up that's (f.z, 0, −f.x), as gl/room-people.js turns a figure
    const S = [F[2], 0, -F[0]], U = [0, 1, 0];
    const O = L.world(at[0], at[1], L.baseAt?.(at[0], at[1]) || 0);
    const place = (p) => {
      const x = p[0] * s, y = p[1] * s, z = (p[2] - m.z0) * s;
      return [O[0] + F[0] * x + S[0] * y, O[1] + z, O[2] + F[2] * x + S[2] * y];
    };
    const C = place(m.c);
    for (const f of m.faces) {
      const q = f.p.map(place);
      if (q.length < 3) continue;
      // a flat face's normal, turned out of the body
      const u = [q[1][0] - q[0][0], q[1][1] - q[0][1], q[1][2] - q[0][2]], v = [q[2][0] - q[0][0], q[2][1] - q[0][1], q[2][2] - q[0][2]];
      let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const nl = Math.hypot(n[0], n[1], n[2]) || 1; n = [n[0] / nl, n[1] / nl, n[2] / nl];
      const mid = q.reduce((a, p) => [a[0] + p[0] / q.length, a[1] + p[1] / q.length, a[2] + p[2] / q.length], [0, 0, 0]);
      if ((mid[0] - C[0]) * n[0] + (mid[1] - C[1]) * n[1] + (mid[2] - C[2]) * n[2] < 0) n = [-n[0], -n[1], -n[2]];
      const col = lin(hex(f.rgb)), uv = [0, 0];
      // the same fan solids.js and gl/fauna.js use: (p0, pi, pi+1)
      for (let k = 1; k + 1 < q.length; k++) for (const p of [q[0], q[k], q[k + 1]]) vtx(b, p, n, uv, col, MAT.MATTE);
    }
  });
  return b;
}
