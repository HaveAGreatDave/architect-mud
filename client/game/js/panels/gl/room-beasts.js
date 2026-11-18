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
//
// A cat (a pet: plugins/pets) is drawn apart, by catsFrame below: skinned on the GPU (gl/cat-gpu.js) and moving every
// frame, living its day (client/shared/cat-life.js) and answering the server's beats.
import { faunaWorldFaces } from '../fauna3d.js';
import { createBatch, vtx, lin, MAT } from './ballpark-mesh.js';
import { toBatch, placeAt, beastMesh } from './beast-kit.js';
import { BEAST_LOOKS } from './beast-looks.js';
import { catLook, tailTarget, tailRadius, TAIL_N, solveRig } from './cat-kit.js';
import { bakeCatOff } from './cat-bake.js';
import { CAT_CLIPS, clipFrame, GAIT_SPEED, tailCarryOf, LITTER } from './cat-clips.js';
import { createTail, stepTail } from './cat-tail.js';
import { catLife, catPerchOf, catPerches, catAtChores, catSettle, catMeets, catMarkOf, TURN_MS } from '../../../../shared/cat-life.js';
import { meetGeom, meetPlace, meetPhase } from './cat-meet.js';
import { roomPath, roomNearFree, roomFree, onFoot, doorwaysOf, openingInside, facing } from '../../../../shared/room-layout.js';
import { SecondOrder, SecondOrderAngle } from '../../../../shared/second-order.js';

// ── cats ───────────────────────────────────────────────────────────────────────────────────────────
// Each of the four poses a clip is carved from (stand, sit, loaf, curl) is carved once in a worker (gl/cat-bake.js) at
// the room's grid; every clip is skinned from one of them. Until a pose is carved its clips wait, and the cat holds
// the last frame it had.
//
// What it does: its day, from cat-life.js and the clock, the same for everyone, with the piece it's up on (catPerchOf)
// and its goes at its bowls (catAtBowls, from the bowls the server sends with it); or a beat the server sent (`bt.beat`:
// { act, since, who, door }), which goes over the day until it's done. Where it is and which way it faces is this
// client's own: it walks from where it was to where it's going, round the furniture (roomPath), and jumps up onto a
// top or down off one, so two people may see it take a slightly different line, never a different act.
//
// HOW IT MOVES. Nothing is tweened. Every layer of the body follows what it's after through a second-order system
// (client/shared/second-order.js: frequency f, damping ζ, response r), set from the cat's nature (the Feline Five,
// motionOf): an impulsive cat turns quick and overshoots, a skittish one snaps its head round before the rest of it, a
// steady one eases. Its heading, its speed (it gets going and brakes, never starts or stops dead), its head turning to
// look at somebody, its ears, its lean into a turn and back on its haunches as it brakes, and the dip and bounce when it
// lands a jump. The rhythm under it (breath, gait, the look about) is the clips' harmonics. Its paws are put on the
// ground under each one (a stair, the top it's on) by the legs' two-bone reach, and its tail is a spring chain with
// its own weight (gl/cat-tail.js).
// the room's carve, sculpt units: the body at CAT_H, the face twice as fine; a phone (`lite`) carves at the old, coarser
// grid, which is about half the triangles
const CAT_H = 0.0055, CAT_FACE_H = 0.0028, LITE_H = 0.008, LITE_FACE_H = 0.004;
const BASES = ['stand', 'sit', 'loaf', 'curl'];
const _bakes = new Map();                 // look key + pose → bake, or 'pending'
let _catVer = 0;
/** Bumped whenever a cat's carve lands. */
export const catsVersion = () => _catVer;
/** Whether any of these beasts is a cat. */
export const hasCats = (beasts) => !!beasts?.some((b) => b?.cat);
/** Whether they're all cats (catsFrame draws them, not the beasts batch), so walking about needn't build it again. */
export const onlyCats = (beasts) => !!beasts?.length && beasts.every((b) => b?.cat);
function catBake(look, pose, lite = false) {
  const h = lite ? LITE_H : CAT_H, faceH = lite ? LITE_FACE_H : CAT_FACE_H;
  const key = JSON.stringify(look) + '@' + pose + '@' + h;
  const b = _bakes.get(key);
  if (b && b !== 'pending') return b;
  if (!b) {
    _bakes.set(key, 'pending');
    bakeCatOff(catLook(JSON.parse(JSON.stringify(look))), pose, { h, faceH })
      .then((nb) => { _bakes.set(key, nb); _catVer++; }, (e) => { _bakes.delete(key); console.error('[room-beasts] cat carve failed', e); });
  }
  return null;
}

// how long each beat lasts, ms, and how near the person it stops, metres
const BEAT_MS = { greet: 75000, petted: 22000, cross: 2800, call: 30000 };
const NEAR_M = 0.42;
// how far behind a bowl's middle it stands to eat or drink, in the sculpt's units (gl/cat-clips.js eat and drink put
// the mouth there; times the cat's scale, metres)
const BOWL_REACH = 0.317;
// how far in from a top's edge it lands, and the three parts of a jump (seconds) with the arc over the straight line
const EDGE_IN = 0.16;
// (a step over a low rim, into his tray and out of it, is a quick hop with no measuring it up first)
const JUMP = { up: { crouch: 0.62, fly: 0.36, land: 0.34, arc: 0.12 }, down: { crouch: 0.3, fly: 0.3, land: 0.38, arc: 0.06 }, step: { crouch: 0.16, fly: 0.26, land: 0.2, arc: 0.16 } };
const DECEL = 2.2;                        // m/s² it brakes at, coming up to where it's going
// what he does when he's touched in each spot (the stroker's own picture, and a 'petted' beat's for everybody):
// gl/cat-clips.js petted (by spot), arch, bothered, cross
const SPOT_CLIP = { chin: 'petted', cheek: 'petted', head: 'petted', ears: 'petted', back: 'arch', tail: 'bothered', paws: 'bothered', belly: 'cross' };
// ...in whatever he was doing when the hand came (`base`, the pose he's carved from now): stroked lying down he stays
// lying down, stood he stays stood, asleep he barely wakes. The tail, a paw and the belly still have him round.
const PET_ON = { loaf: 'pettedLoaf', stand: 'pettedStand', curl: 'pettedSleep' };
function spotClip(spot, base) {
  const c = SPOT_CLIP[spot] || 'petted';
  if (c === 'petted') return PET_ON[base] || 'petted';
  if (c === 'arch' && (base === 'loaf' || base === 'curl')) return 'archLoaf';
  return c;
}
// How long the body takes to go from one clip (or one spot under the hand) to the next, seconds. Within a carve the
// frame it was on blends into the new one, so a hand moving from cheek to chin, or a cat stopping, flows.
const FADE_S = 0.5;
function mixDeep(a, b, k) {
  if (typeof b === 'number') return typeof a === 'number' ? a + (b - a) * k : b;
  if (Array.isArray(b)) return Array.isArray(a) && a.length === b.length ? b.map((v, i) => mixDeep(a[i], v, k)) : b;
  if (b && typeof b === 'object') { const o = {}; for (const key in b) o[key] = a && typeof a === 'object' && key in a ? mixDeep(a[key], b[key], k) : b[key]; return o; }
  return b;
}
// Getting up and sitting down, between two carves: how long it takes and which end of him goes first. A cat gets up
// from a sit front end first (the forelegs straighten, then the haunches lift) and sits down back end first (the
// haunches go down, then the forepaws walk in). Out of a loaf he pushes up on the forelegs; into one he folds the front.
const GETUP = {
  'sit>stand': { dur: 1.3, lead: 'front' },
  'stand>sit': { dur: 1.5, lead: 'hind' },
  'loaf>stand': { dur: 1.6, lead: 'front' },
  'stand>loaf': { dur: 1.8, lead: 'hind' },
  'sit>loaf': { dur: 1.5, lead: 'front' },
  'loaf>sit': { dur: 1.4, lead: 'front' },
};
// a pose list resampled to n points along it, so a tail of four points can blend into one of six
function resample(pts, n) {
  if (!Array.isArray(pts) || pts.length === n || pts.length < 2) return pts;
  const out = [];
  for (let i = 0; i < n; i++) {
    const s = (i / (n - 1)) * (pts.length - 1), a = Math.floor(s), b = Math.min(pts.length - 1, a + 1), u = s - a;
    out.push(pts[a].map((v, j) => v + (pts[b][j] - v) * u));
  }
  return out;
}
// The pose `k` (0..1) of the way from `a` to `b`, each part on its own clock: the leading end moves over the first
// two-thirds, the other end over the last two-thirds, the spine between, the tail last. The body dips a little
// mid-way as the weight comes off one pair of legs and onto the other.
function stagePose(a, b, k, lead) {
  const early = smooth01(k / 0.65), late = smooth01((k - 0.35) / 0.65), mid = smooth01((k - 0.15) / 0.7), tail = smooth01((k - 0.25) / 0.75);
  const kf = lead === 'front' ? early : late, kh = lead === 'front' ? late : early;
  const o = mixDeep(a, b, mid);
  o.root = mixDeep(a.root, b.root, kh);
  o.root.at = [...o.root.at];
  o.root.at[1] -= 0.012 * Math.sin(Math.PI * k);
  o.spine = { ...o.spine, chest: mixDeep(a.spine?.chest, b.spine?.chest, kf), neck: mixDeep(a.spine?.neck, b.spine?.neck, kf), lumbar: mixDeep(a.spine?.lumbar, b.spine?.lumbar, kh) };
  o.legs = {};
  for (const L of Object.keys(b.legs || {})) o.legs[L] = mixDeep(a.legs?.[L], b.legs[L], L[1] === 'F' ? kf : kh);
  o.tail = mixDeep(resample(a.tail, (b.tail || []).length), b.tail, tail);
  return o;
}
const TOUCH_MS = 450;                    // a touch not heard of this long has stopped
const _actors = new Map();                // cat id → its state on this client
// Two cats together (cat-life.js catMeets, staged by gl/cat-meet.js): who's with whom, worked out once a second, and
// each encounter's state on this client: which phase it's on, when that phase's clock started (when the cat coming got
// to its place) and, in a chase, how many runs there have been
const _meets = new Map();                 // encounter key → { phase, t0, zk }
let _meetMemo = { sig: null, map: new Map() };
function meetsOf(L, beasts, now, hour) {
  const cats = beasts.filter((b) => b?.cat);
  if (cats.length < 2) return _meetMemo.map.size ? (_meetMemo = { sig: null, map: new Map() }).map : _meetMemo.map;
  const sig = Math.floor(now / 1000) + '|' + Math.round(hour * 60) + '|' + cats.map((b) => b.id + (b.beat ? ':' + b.beat.act + b.beat.since : '')).join(',');
  if (_meetMemo.sig !== sig || _meetMemo.L !== L) {
    const busy = (b) => !!(b.beat && now - b.beat.since < (BEAT_MS[b.beat.act] || 0));
    _meetMemo = { sig, L, map: catMeets(L, cats.map((b) => ({ id: b.id, nature: b.nature, look: b.cat, bowls: b.bowls, tray: b.tray, busy: busy(b) })), now, hour) };
    const keys = new Set([..._meetMemo.map.values()].map((m) => m.key));
    for (const k of _meets.keys()) if (!keys.has(k)) _meets.delete(k);
  }
  return _meetMemo.map;
}
// which side of a cat at `at` facing `head` a point `q` is on: +1 its left (the rig's +X), -1 its right
function sideOf(L, at, head, q) {
  const P = L.world(at[0] + Math.sin(head), at[1] + Math.cos(head), 0), B0 = L.world(at[0], at[1], 0), W = L.world(q[0], q[1], 0);
  const fx = P[0] - B0[0], fz = P[2] - B0[2];
  return Math.sign((W[0] - B0[0]) * fz - (W[2] - B0[2]) * fx) || 1;
}
const intoBox = (b, q, m) => [clamp(q[0], b[0] + m, b[1] - m), clamp(q[1], b[2] + m, b[3] - m)];

// How a cat's body answers, from its nature (the Feline Five, 0..1 each): [f, ζ, r] for each second-order layer.
// Impulsive: quicker and bouncier everywhere. Skittish: the head and ears snap ahead of the rest (r > 1). Dominant: the
// tail carried high and steady. Outgoing: it looks at people more, and turns to them sooner.
export function motionOf(n = {}) {
  const i = n.impulsive ?? 0.5, s = n.skittish ?? 0.5, d = n.dominant ?? 0.5, o = n.outgoing ?? 0.5;
  return {
    head: [1.3 + 1.6 * i + 1.2 * s, Math.max(0.35, 0.85 - 0.4 * i), 0.3 + 1.8 * s],
    look: [0.6 + 0.8 * o, 1, 0],
    turn: [0.7 + 0.8 * i, Math.max(0.45, 0.9 - 0.3 * i), 0.15 + 0.6 * s],
    speed: [0.9 + 0.9 * i, 1, 0],
    bounce: [2.4 + 1.2 * i, Math.max(0.2, 0.42 - 0.15 * i), 0],
    lean: [1.8 + 0.6 * i, 0.55, 0],
    ears: [3.2 + 2.5 * s, 0.4, 1 + 0.8 * s],
    tail: { tone: 0.72 + 0.28 * d, fTip: 1.0 + 0.7 * i, zTip: Math.max(0.15, 0.4 - 0.2 * i) },
    attention: 0.25 + 0.55 * o,
  };
}

const ang = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const headingTo = (a, b) => Math.atan2(b[0] - a[0], b[1] - a[1]);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth01 = (x) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// where a spot key puts a cat: hashed onto the floor, then onto the nearest free floor
function spotOf(L, key) {
  const s = beastSpot(L, key);
  return roomNearFree(L, s[0], s[1], 1.6) || s;
}
// the inside of the doorway to `dir` (an exit direction), if the room has one that way
function doorOf(L, dir) {
  if (!dir) return null;
  const o = doorwaysOf(L.spec).find((x) => x.dir === dir);
  return o ? openingInside(L, o).at : null;
}
// the tops in the room, worked out once a layout
const _perches = new WeakMap();
function perchesOf(L, look) {
  let m = _perches.get(L);
  if (!m) _perches.set(L, (m = new Map()));
  const k = JSON.stringify(look?.build || {});
  if (!m.has(k)) m.set(k, [...catPerches(L, look), ...traysOf(L)]);
  return m.get(k);
}
// A litter tray stands in the room as a top he steps up into (cat-life.js catAtTray): its litter's surface, inside its
// rim. It's never somewhere he settles; only his go at it takes him there.
const TRAY_LITTER = 0.05, TRAY_RIM = 0.02;
function traysOf(L) {
  const k = unitsPerM(L);
  return (L.placed || []).filter((p) => p.form === 'littertray').map((p) => {
    const q = Math.round(((p.turn % 360) + 360) % 360 / 90) % 2, hw = (q ? p.d : p.w) / 2 - TRAY_RIM * k, hd = (q ? p.w : p.d) / 2 - TRAY_RIM * k;
    const [fu, fv] = facing(p.turn || 0);
    return { id: p.id, name: p.name, arche: 'tray', form: p.form, u: p.u, v: p.v, w: p.w, d: p.d, turn: p.turn || 0, top: TRAY_LITTER * k + (p.y0 || 0),
      free: [-p.w / 2, p.w / 2], box: [p.u - hw, p.u + hw, p.v - hd, p.v + hd], face: [fu, fv], backTop: null, annex: !!p.annex };
  });
}
const perchById = (L, look, id) => (id ? perchesOf(L, look).find((p) => p.id === id) || null : null);
const inBox = (b, u, v, m = 0) => u > b[0] - m && u < b[1] + m && v > b[2] - m && v < b[3] + m;
// the point on a top `p` it lands on coming from `from` (floor), `m` inside its nearest edge, of the part `b` it can sit on
function edgeOf(p, from, m = EDGE_IN, b = p.box) {
  const cu = b[1] - b[0] > 2 * m ? clamp(from[0], b[0] + m, b[1] - m) : (b[0] + b[1]) / 2;
  const cv = b[3] - b[2] > 2 * m ? clamp(from[1], b[2] + m, b[3] - m) : (b[2] + b[3]) / 2;
  return [cu, cv];
}
// room units to the metre (a room laid out in feet is 3.28)
function unitsPerM(L) {
  const a = L.world(0, 0, 0), b = L.world(1, 0, 0);
  return 1 / (Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1);
}
// The part of a top a cat can settle on, room units: a sofa's seat cushions, clear of the back cushions behind and the
// arms either side (gl/room-mesh.js sofa: the seat starts 0.26 m in, an arm is 0.2 m), and a chair's seat in front of
// its back. On the box itself he'd sit inside the back or on the arm with his rump in the air.
function topBox(p, k) {
  const b = p.box.slice(), f = p.face;
  if (!f) return b;
  const sofa = p.arche === 'sofa' && p.form !== 'lounger';
  const back = (sofa ? 0.26 : p.backTop ? 0.08 : 0) * k, arm = (sofa ? 0.2 : 0) * k;
  [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(([nu, nv], i) => {
    const dot = nu * f[0] + nv * f[1], d = dot < -0.5 ? back : dot > 0.5 ? 0 : arm;
    b[i] += i % 2 ? -d : d;
  });
  return b;
}
// How much top it takes in a pose, metres from its root: behind (z0) and in front (z1) along its heading, and to its
// right (x0) and left (x1), off the pose's own carve (a fat cat's flanks stand well out past his paws, and curled up
// he's wider than he's long). The head and the tail may go over an edge, as a cat's do; the body and the paws don't.
const FOOT_PAD = 0.02;
const _feet = new WeakMap();
function footOf(bake) {
  let f = _feet.get(bake);
  if (f) return f;
  const R = bake.rig, sc = R.look.scale, grp = R.bones.map((b) => b.group), P = bake.P, W = bake.Ww, B = bake.Wb;
  let z0 = 0, z1 = 0, x0 = 0, x1 = 0;
  for (let i = 0; i < bake.verts; i++) {
    let bi = 0, bw = -1;
    for (let j = 0; j < 4; j++) if (W[i * 4 + j] > bw) { bw = W[i * 4 + j]; bi = B[i * 4 + j]; }
    const g = grp[bi];
    if (g === 'tail' || g === 'head' || g === 'ear') continue;
    const x = P[i * 3], z = P[i * 3 + 2];
    if (z < z0) z0 = z; if (z > z1) z1 = z; if (x < x0) x0 = x; if (x > x1) x1 = x;
  }
  f = { z0: z0 * sc - FOOT_PAD, z1: z1 * sc + FOOT_PAD, x0: x0 * sc - FOOT_PAD, x1: x1 * sc + FOOT_PAD };
  _feet.set(bake, f);
  return f;
}
// which way the rig's +X (its left) lies in the room's own frame, turned to face +v: +1 along +u, -1 along -u
const _sides = new WeakMap();
function leftOf(L) {
  let s = _sides.get(L);
  if (s == null) {
    const B0 = L.world(0, 0, 0), P = L.world(0, 1, 0), F = [P[0] - B0[0], P[2] - B0[2]], fl = Math.hypot(F[0], F[1]) || 1;
    const q = L.local([B0[0] + F[1] / fl, B0[1], B0[2] - F[0] / fl]);
    _sides.set(L, (s = Math.sign(q[0]) || 1));
  }
  return s;
}
// that footprint turned to heading `h`, as offsets from the root in room units: [u0, u1, v0, v1]
function footSpan(h, F, k, s = 1) {
  const fu = Math.sin(h), fv = Math.cos(h);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const z of [F.z0, F.z1]) for (const x of [F.x0 * s, F.x1 * s]) {
    const du = (fu * z + fv * x) * k, dv = (fv * z - fu * x) * k;
    u0 = Math.min(u0, du); u1 = Math.max(u1, du); v0 = Math.min(v0, dv); v1 = Math.max(v1, dv);
  }
  return [u0, u1, v0, v1];
}
// where on the top `b` it settles, facing `h`, nearest `at` with all of it on the top (in the middle, where it can't be)
function fitOnTop(b, at, h, F, k, side = 1) {
  const s = footSpan(h, F, k, side), one = (q, lo, hi) => (lo <= hi ? clamp(q, lo, hi) : (lo + hi) / 2);
  return [one(at[0], b[0] - s[0], b[1] - s[1]), one(at[1], b[2] - s[2], b[3] - s[3])];
}
// the heading nearest `h0` it fits on the top `b` facing: along a narrow top, not across it
function fitHeading(b, h0, F, k, side = 1) {
  let best = h0, least = Infinity;
  for (let i = 0; i <= 12; i++) for (const sg of i ? [1, -1] : [1]) {
    const h = h0 + sg * i * Math.PI / 12, s = footSpan(h, F, k, side);
    const over = Math.max(0, s[1] - s[0] - (b[1] - b[0])) + Math.max(0, s[3] - s[2] - (b[3] - b[2]));
    if (over < 1e-4) return h;
    if (over < least) { least = over; best = h; }
  }
  return best;
}
// whether a point on the floor is behind a chair's or a sofa's back (cat-life.js catPerches: `face`, `backTop`)
function behindBack(p, q) {
  if (!p?.backTop || !p.face) return false;
  const du = q[0] - (p.box[0] + p.box[1]) / 2, dv = q[1] - (p.box[2] + p.box[3]) / 2;
  return du * p.face[0] + dv * p.face[1] < -0.25 * Math.min(p.box[1] - p.box[0], p.box[3] - p.box[2]);
}
// the floor beside a top it jumps from or to: the side nearest `toward`, as near as it can stand; never from behind a
// chair's back while another side is free
function approachOf(L, p, toward, also = null) {
  const b = p.box, F = onFoot(L), off = L.radius + 0.06, best = [];
  const at = also || [(b[0] + b[1]) / 2, (b[2] + b[3]) / 2];
  const cu = clamp(at[0], b[0] + 0.1, b[1] - 0.1), cv = clamp(at[1], b[2] + 0.1, b[3] - 0.1);
  for (const c of [[b[0] - off, cv], [b[1] + off, cv], [cu, b[2] - off], [cu, b[3] + off]]) {
    const q = roomNearFree(L, c[0], c[1], 0.45);
    if (q && roomFree(F, q[0], q[1])) best.push([dist(q, toward) + 0.6 * dist(q, at) + (behindBack(p, q) ? 6 : 0), q]);
  }
  best.sort((x, y) => x[0] - y[0]);
  return best[0]?.[1] || roomNearFree(L, at[0], at[1], 1.6) || toward;
}
// where it stands to eat from (or drink from) its station, and the bowl's middle it faces
function bowlSpot(L, bowls, kind, sc = 0.6) {
  const p = bowls?.id && L.placed?.find((q) => q.id === bowls.id);
  if (!p) return null;
  const [fu, fv] = facing(p.turn || 0), su = -fv, sv = fu, x = (kind === 'water' ? 1 : -1) * p.w / 4;
  const c = [p.u + su * x, p.v + sv * x], F = onFoot(L);
  // behind it, in front of it, or either side: wherever there's floor
  for (const [du, dv] of [[-fu, -fv], [fu, fv], [su, sv], [-su, -sv]]) {
    const r = p.d / 2 + BOWL_REACH * sc - 0.03, q = [c[0] + du * r, c[1] + dv * r];
    if (roomFree(F, q[0], q[1]) || roomFree(L, q[0], q[1])) return { at: q, face: c };
  }
  const q = roomNearFree(L, c[0], c[1], 0.8);
  return q ? { at: q, face: c } : null;
}
// what's under a point in the room (room units, the floor's own frame): the top of a piece it's over and at or above,
// or the floor
function groundAt(L, look, u, v, y = 9) {
  let g = L.baseAt?.(u, v) || 0;
  for (const p of perchesOf(L, look)) if (inBox(p.box, u, v) && p.top <= y + 0.08 && p.top > g) g = p.top;
  return g;
}

/**
 * The cats in the room this frame: { cats: [what R.setCats takes], voices: [what room-cat-sound.js hears] }.
 * `o`: { now (ms, the wall clock), hour (the game's), whereIs(id) → [u, v] of a person or null, folk() → [{ id, at }], lowOf(id) → head height as a share of standing
 * everybody in the room, drawer (catDrawer), lite (a phone: the coarser carve), light (0..1, how much light there is:
 * the lamps and the day through the windows, for the pupils), mouth(id) → 0..1 how open a cat's mouth is for the
 * call it's making now (room-cat-sound.js) }.
 */
export function catsFrame(L, beasts, o) {
  const out = { cats: [], voices: [] };
  if (!L || !beasts?.length || !o.drawer) return out;
  const now = o.now ?? Date.now();
  const meets = meetsOf(L, beasts, now, o.hour ?? 13);
  for (const bt of beasts) {
    if (!bt?.cat) continue;
    const bakes = Object.fromEntries(BASES.map((p) => [p, catBake(bt.cat, p, !!o.lite)]));
    const life = catLife(bt.id, now, o.hour ?? 13, bt.nature || {});
    const look = bt.cat;

    // ── what it means to do now, and where ──────────────────────────────────────────────────────
    const beat = bt.beat && now - bt.beat.since < (BEAT_MS[bt.beat.act] || 0) ? bt.beat : null;
    // a hand on him from this client (catTouch): pressed, he stops where he is and answers it; only hovering, he looks
    const A1 = _actors.get(bt.id), touch = A1?.touch && now - A1.touch.t < TOUCH_MS ? A1.touch : null;
    // his bowls and his tray (cat-life.js catAtChores): whichever he went to last
    const bowl = beat ? null : catAtChores(bt.id, now, bt.bowls, bt.tray);
    let D = null, since = life.since, seed = hash(bt.id + ':' + life.since), spot = null, side = 0;
    if (touch?.down && beat?.act !== 'cross' && !A1.jump) {
      const uv = L.local(touch.at);
      // he stays as he is; touched on the tail or a paw he turns round to see what you're doing
      D = { on: A1.on, keep: true, hold: true, face: touch.spot === 'tail' || touch.spot === 'paws' ? [uv[0], uv[1]] : null, act: spotClip(touch.spot, A1.lastBase), key: 'touch' };
      since = touch.since; seed = hash(bt.id + ':' + touch.since); spot = touch.spot; side = touch.side || 0;
    } else if (beat) {
      const who = beat.who && o.whereIs?.(beat.who);
      since = beat.since; seed = hash(bt.id + ':' + beat.since);
      if (beat.act === 'cross') D = { on: null, keep: true, act: 'cross', key: 'cross:' + beat.since };
      else {
        const to = who || doorOf(L, beat.door);
        spot = beat.spot || null;
        D = { on: null, at: to, face: to, near: true, gait: 'trot', act: beat.act === 'petted' ? spotClip(beat.spot, 'sit') : 'wait', key: 'beat:' + beat.since + ':' + (to ? Math.round(to[0] * 4) + ',' + Math.round(to[1] * 4) : '') };
        // stroked where it's lying: it stays up there and pushes into the hand
        const A0 = _actors.get(bt.id);
        if (beat.act === 'petted' && A0?.on && who && dist(who, A0.at) < 1.3) D = { on: A0.on, perch: perchById(L, look, A0.on), at: A0.at, face: null, hold: true, act: spotClip(beat.spot, A0.lastBase), key: D.key };
        if (!to) D.at = null;
      }
    } else if (bowl?.kind === 'tray') {
      // His tray: over to it, a hop in over the rim, the dig facing the back of it, round to face out for the squat, the
      // sniff and the cover (gl/cat-clips.js LITTER), and out again when the clip's done; after the other, now and then,
      // a mad dash round the flat. A tray too dirty to get into, he goes on the floor in front of it. The phases run off
      // when he got there on this client; the go itself is everybody's.
      const T = bt.tray?.id ? perchById(L, look, bt.tray.id) : null, A0 = _actors.get(bt.id), key = 'tray:' + bowl.since, P = LITTER[bowl.act];
      const there = A0?.goalKey === key && A0.arrived ? A0.arrived : null, s = there ? (now - there) / 1000 : 0, len = P.len + (bowl.fussy ? 2.5 : 0);
      if (A0?.trayDone === key) {
        if (bowl.zoom && now - A0.trayDoneAt < 9000) D = { on: null, at: spotOf(L, bt.id + ':pz:' + bowl.since + ':' + (A0.zk ?? 0)), gait: 'gallop', act: 'stand', key: 'pz:' + bowl.since + ':' + (A0.zk ?? 0), zoom: true };
      } else if (T) {
        // too dirty to dig in, he stands up on its front edge facing out and goes from there, with no dig
        if (there && s > (bowl.mess ? len - P.t2 : len)) { A0.trayDone = key; A0.trayDoneAt = now; }
        const out = Math.atan2(T.face[0], T.face[1]), inward = Math.atan2(-T.face[0], -T.face[1]);
        const hd = Math.abs(T.face[0]) > Math.abs(T.face[1]) ? (T.box[1] - T.box[0]) / 2 : (T.box[3] - T.box[2]) / 2;
        D = bowl.mess ? { on: T.id, perch: T, at: [T.u + T.face[0] * hd * 0.85, T.v + T.face[1] * hd * 0.85], act: bowl.act, key, yaw: out }
          : { on: T.id, perch: T, at: [T.u, T.v], act: bowl.act, key, yaw: there ? (s < P.t1 + (bowl.fussy ? 2.5 : 0) ? inward : out) : null };
        // (fussy about a dirty one: a long sniff at it first, then the dig)
        since = bowl.since; seed = hash(bt.id + ':' + bowl.since);
        if (bowl.mess) { if (there) since = there - P.t2 * 1000; }
        else if (bowl.fussy && there) { if (s < 2.5) D.act = 'sniff'; else since = there + 2500; }
      }
    } else if (bowl) {
      // at an empty bowl because he's hungry or thirsty, he sits by it and demands; thirsty, half the time he goes up
      // on the kitchen sink instead and drinks from the tap
      const sink = bowl.tap ? perchesOf(L, look).find((p) => p.arche === 'sink') : null;
      if (sink) D = { on: sink.id, perch: sink, at: [(sink.box[0] + sink.box[1]) / 2, (sink.box[2] + sink.box[3]) / 2], act: 'drink', key: 'tap:' + bowl.since };
      else {
        const bs = bowlSpot(L, bt.bowls, bowl.kind, bt.cat?.scale ?? 0.6);
        if (bs) D = { on: null, at: bs.at, face: bs.face, gait: bowl.act === 'beg' ? 'trot' : 'walk', act: bowl.act === 'beg' ? (bowl.pester ? 'demand' : 'wait') : bowl.act, key: 'bowl:' + bowl.kind + ':' + bowl.since };
      }
      if (D) { since = bowl.since; seed = hash(bt.id + ':' + bowl.since); }
    }
    if (!D && life.act === 'zoomies') {
      const A0 = _actors.get(bt.id), zk = A0?.zk ?? 0;
      D = { on: null, at: spotOf(L, bt.id + ':z:' + life.since + ':' + zk), gait: 'gallop', act: 'stand', key: 'z' + life.since + ':' + zk, zoom: true };
    }
    // rubbing his cheek on the corner of something (cat-life.js catMarkOf: the same corner for everybody)
    if (!D && life.act === 'mark') {
      const M = catMarkOf(L, life);
      if (M) D = { on: null, at: M.at, face: M.face, gait: 'walk', act: 'mark', key: 'mark:' + life.since };
    }
    if (!D) {
      // up on something, or on the floor (on the rug, if he's settled and there is one), and what he does there: no
      // biscuits on a hard top (catSettle)
      const P = catPerchOf(L, life, look), st = catSettle(L, life, P);
      const act = st.act === 'wander' || st.act === 'zoomies' || st.act === 'mark' ? 'stand' : st.act;
      D = P ? { on: P.id, perch: perchById(L, look, P.id) || P, at: P.at, act, key: 'p:' + life.spot } : { on: null, at: st.rug || spotOf(L, life.spot), act, key: life.spot + (st.rug ? ':rug' : ''), gait: 'walk' };
    }

    // ── with another cat ──────────────────────────────────────────────────────────────────────────
    // An encounter (catMeets) goes over the day: the one staying (`a`) keeps the place its day gives it and, once the
    // other's there, plays the phase's clip turned the way the staging says; the one coming (`b`) goes to its place by
    // `a` (up onto the piece `a` is on, for a groom or a heap) and plays its own. `b` drives the phases.
    const mt = !touch?.down && !beat && !bowl ? meets.get(bt.id) : null;
    let meetSide = 0, meetLook = null;
    {
      const me = _actors.get(bt.id), other = mt && _actors.get(mt.with);
      if (mt && me?.rig && other?.rig) {
        let ms = _meets.get(mt.key);
        if (!ms) _meets.set(mt.key, (ms = { phase: 0, t0: null, zk: 0 }));
        const ph = meetPhase(mt.kind, ms.phase), isA = mt.role === 'a';
        const A = isA ? me : other, Bc = isA ? other : me;
        const pl = meetPlace(ph.place, { at: A.at, head: A.head }, { at: Bc.at, head: Bc.head }, meetGeom(A.rig), meetGeom(Bc.rig));
        meetSide = sideOf(L, me.at, me.head, other.at);
        if (isA) {
          const there = ms.t0 != null;
          if (ph.place === 'chase') {
            // it runs, a new spot each time it gets there
            D = { on: null, at: spotOf(L, bt.id + ':mz:' + mt.key + ':' + ms.zk), gait: 'gallop', act: 'stand', key: 'mz:' + mt.key + ':' + ms.zk, meetZoom: ms };
          } else if (!D.on || D.on === mt.on) {
            const lying = mt.kind === 'groom' || mt.kind === 'pile';
            D = { ...D, act: there ? ph.a : lying ? D.act : (D.act === 'sit' || D.act === 'stand' ? D.act : 'stand'), yaw: there ? pl.headA : null, hold: true, key: D.key + ':m' };
            // watching the other come, where the two end up facing; otherwise it holds still, or the place behind it
            // or beside it would go round with it
            if (!there && !lying && pl.headA != null) { D.yaw = Math.atan2(other.at[0] - me.at[0], other.at[1] - me.at[1]); meetLook = other; }
          }
          if (there) { since = ms.t0; seed = hash(bt.id + ':' + mt.key + ':' + ms.phase); }
        } else {
          const share = mt.on && A.on === mt.on ? perchById(L, look, mt.on) : null;
          let tgt = ph.place === 'chase' ? A.at : pl.at;
          if (share) tgt = intoBox(share.box, tgt, 0.12);
          else if (ph.place !== 'chase') tgt = roomNearFree(L, tgt[0], tgt[1], 0.6) || tgt;
          const there = ph.place === 'chase' || (dist(me.at, tgt) < 0.09 && !me.jump && (share ? me.on === share.id : !me.on));
          if (ms.t0 == null && (ph.timed || there)) ms.t0 = now;
          if (ms.t0 != null && ph.dur && now - ms.t0 > ph.dur * 1000) { ms.phase++; ms.t0 = null; }
          D = { on: share ? share.id : null, perch: share, at: tgt, yaw: there ? pl.headB : null, near: ph.place === 'chase',
            // (trotting over to somebody across the room, as a cat comes to say hello; walking up the last of it)
            gait: mt.kind === 'play' ? (ph.place === 'chase' ? 'gallop' : 'trot') : ph.place === 'flee' || dist(me.at, tgt) > 1.4 ? 'trot' : 'walk',
            act: there ? ph.b : 'stand', key: 'meet:' + mt.key + ':' + ms.phase };
          if (ms.t0 != null) { since = ms.t0; seed = hash(bt.id + ':' + mt.key + ':' + ms.phase); }
        }
      }
    }

    // ── its state on this client ───────────────────────────────────────────────────────────────────
    let A = _actors.get(bt.id);
    if (!A) {
      const M = motionOf(bt.nature || {}), at = D.at || spotOf(L, life.spot), h0 = hash(life.spot) * Math.PI * 2;
      A = { L, at: at.slice(), on: D.on && D.perch ? D.on : null, head: h0, want: h0, path: null, goalKey: D.key, walkT: 0, last: now, arrived: now, jump: null, v: 0, lastV: 0, M,
        dyn: { look: new SecondOrder(...M.look, 0), head: new SecondOrder(...M.head, [0, 0]), turn: new SecondOrderAngle(...M.turn, h0), speed: new SecondOrder(...M.speed, 0),
          dip: new SecondOrder(...M.bounce, 0), lean: new SecondOrder(...M.lean, [0, 0]), ears: new SecondOrder(...M.ears, [0, 0, 0, 0, 0, 0]),
          // the ear tips, a softer spring behind the ears themselves: they swing on after the ear has turned
          tips: new SecondOrder(2.4 + 1.2 * (bt.nature?.impulsive ?? 0.5), 0.28, 0, [0, 0, 0, 0, 0, 0]),
          eyes: new SecondOrder(7, 0.95, 0.4, [0, 0, 0]) },
        pupil: null,
        tail: createTail(TAIL_N), fresh: true, attn: null };
      _actors.set(bt.id, A);
    }
    // the room laid out again (a piece moved, a bowl went down): it stays where it is, and works its way out again
    if (A.L !== L) { A.L = L; A.path = null; A.leg = null; if (A.on && !perchById(L, look, A.on)) A.on = null; }
    // a slow frame walks it as far as the time says (up to half a second, past which it was a hidden tab)
    const dt = Math.min(0.5, Math.max(0, (now - A.last) / 1000));
    A.last = now;
    if (A.goalKey !== D.key) { A.goalKey = D.key; A.arrived = 0; A.path = null; A.leg = null; if (D.zoom) A.zk = A.zk ?? 0; }

    // ── getting there ─────────────────────────────────────────────────────────────────────────────
    let moving = false, gait = D.gait || 'walk', leap = null;
    const cur = A.on ? perchById(L, look, A.on) : null, ku = unitsPerM(L), lsd = leftOf(L);
    // how much top a pose takes, from its carve (or the nearest carve there is, until it's carved)
    const footIn = (base) => { const b = bakes[base] || BASES.map((p) => bakes[p]).find(Boolean); return b ? footOf(b) : null; };
    // up on a top: the part he can sit on, and how much of it he takes in the pose he'll settle in
    const topNow = () => {
      const p = A.on ? perchById(L, look, A.on) : null, F = p && footIn(CAT_CLIPS[D.act]?.base || 'stand');
      return F ? { b: topBox(p, ku), F } : null;
    };
    // which way he faces once he's there: the way he's told, or his own way, turned along a top too narrow to sit across
    const restWant = () => {
      if (D.yaw != null) return D.yaw;
      if (D.face) return headingTo(A.at, D.face);
      if (beat || D.hold) return A.want;
      const h = hash(D.key) * Math.PI * 2, T = topNow();
      return T ? fitHeading(T.b, h, T.F, ku, lsd) : h;
    };
    // where he's first seen up on a top: square on it, all of him, facing the way he'll settle, from the first frame his
    // carve is there (before that he isn't drawn at all)
    if (!A.fitted && !A.jump) {
      const T = A.on ? topNow() : null;
      if (T) {
        const h = restWant();
        A.at = fitOnTop(T.b, A.at, h, T.F, ku, lsd); A.want = A.head = h; A.path = null;
        A.dyn.turn.reset?.(h);
        A.fitted = true;
      } else if (!A.on) A.fitted = true;
    }
    const startJump = (up, to, toY, on) => {
      const fromY = A.on && cur ? cur.top : (L.baseAt?.(A.at[0], A.at[1]) || 0);
      // from behind a chair's back (only when there's no other side to go from): the arc clears the top of the back
      const seat = up ? D.perch : cur, over = seat && behindBack(seat, up ? A.at : to) ? seat.backTop + 0.1 - (fromY + toY) / 2 : 0;
      const small = Math.abs(toY - fromY) < 0.15 * ku;
      A.jump = { up, from: A.at.slice(), fromY, to, toY, on, t: 0, T: JUMP[small ? 'step' : up ? 'up' : 'down'], since: now, over: Math.max(0, over), small };
      A.want = headingTo(A.at, to);
    };
    // along a way (round the furniture on the floor; straight across a top), getting going and braking as a body does
    const travel = (tgt, onTop, want = gait) => {
      const left = dist(tgt, A.at);
      if (left < 0.05 && A.v < 0.08) { A.v = 0; A.dyn.speed.reset(0); A.path = null; return false; }
      if (!A.path?.length) A.path = onTop ? [tgt] : (roomPath(L, A.at, tgt) || [A.at, tgt]).slice(1);
      let remain = 0, p = A.at;
      for (const q of A.path) { remain += dist(p, q); p = q; }
      const top = Math.min(GAIT_SPEED[want] || GAIT_SPEED.walk, Math.sqrt(2 * DECEL * remain) + 0.05);
      A.v = Math.max(0.06, A.dyn.speed.update(dt, top));
      let step = A.v * dt;
      while (step > 0 && A.path.length) {
        const n = A.path[0], du = n[0] - A.at[0], dv = n[1] - A.at[1], l = Math.hypot(du, dv);
        if (l > 1e-3) A.want = Math.atan2(du, dv);
        if (l <= step) { A.at = n.slice(); step -= l; A.path.shift(); } else { A.at = [A.at[0] + du / l * step, A.at[1] + dv / l * step]; step = 0; }
      }
      A.walkT += dt;
      return true;
    };
    if (A.jump) {
      const J = A.jump, T = J.T;
      J.t += dt;
      const c = T.crouch, f = c + T.fly, e = f + T.land;
      if (J.t < c) { leap = { part: 'crouch', s: J.t / c, up: J.up, small: J.small }; A.at = J.from.slice(); }
      else if (J.t < f) {
        const s = (J.t - c) / T.fly;
        leap = { part: 'fly', s, up: J.up, small: J.small };
        A.at = [lerp(J.from[0], J.to[0], s), lerp(J.from[1], J.to[1], s)];
        A.flyY = lerp(J.fromY, J.toY, s) + 4 * Math.max(T.arc + (J.up ? 0.25 * Math.max(0, J.toY - J.fromY) : 0), J.over || 0) * s * (1 - s);
      } else {
        if (!J.landed) { J.landed = true; A.on = J.on; A.at = J.to.slice(); A.dyn.dip.kick(J.up ? -0.35 : -0.75); }
        leap = { part: 'land', s: Math.min(1, (J.t - f) / T.land), up: J.up, small: J.small };
        if (J.t >= e) { A.jump = null; A.path = null; leap = null; }
      }
    } else if (!D.keep && (A.on || null) !== (D.on || null)) {
      if (A.on && cur) {
        // down off this top first: to its edge nearest where it's going, then the jump to the floor beside it
        const toward = D.on && D.perch ? approachOf(L, D.perch, A.at) : D.at || A.at;
        if (A.leg?.key !== 'down:' + D.key) { const land = approachOf(L, cur, toward); A.leg = { key: 'down:' + D.key, land, edge: edgeOf(cur, land) }; }
        if (!travel(A.leg.edge, true, 'walk')) startJump(false, A.leg.land, L.baseAt?.(A.leg.land[0], A.leg.land[1]) || 0, null);
        else moving = true;
      } else if (A.on) A.on = null;
      else if (D.perch) {
        // up onto it: walk to the floor beside it, then the jump to its edge
        // (landing far enough in that his back end is on it too, facing in from the edge)
        if (A.leg?.key !== 'up:' + D.key) {
          const ap = approachOf(L, D.perch, A.at, D.at), F = footIn('stand');
          A.leg = { key: 'up:' + D.key, ap, edge: edgeOf(D.perch, ap, F ? Math.max(EDGE_IN, -F.z0 * ku) : EDGE_IN, topBox(D.perch, ku)) };
        }
        if (!travel(A.leg.ap, false)) startJump(true, A.leg.edge, D.perch.top, D.on);
        else moving = true;
      }
    } else if (D.at && !D.keep) {
      let tgt = D.at;
      if (D.near) {
        const d0 = dist(D.at, A.at);
        tgt = d0 > NEAR_M ? [D.at[0] + (A.at[0] - D.at[0]) / d0 * NEAR_M, D.at[1] + (A.at[1] - D.at[1]) / d0 * NEAR_M] : A.at;
      }
      // on a top, the spot his whole body fits facing the way he'll settle (catPerchOf keeps only his root off the edge)
      const T = A.on ? topNow() : null;
      if (T) tgt = fitOnTop(T.b, tgt, restWant(), T.F, ku, lsd);
      moving = travel(tgt, !!A.on);
      if (!moving && !A.arrived) { A.arrived = now; if (D.zoom) A.zk = (A.zk || 0) + 1; if (D.meetZoom) D.meetZoom.zk++; }
    }
    if (!moving && !A.jump) A.v = 0;
    // come up to somebody it was greeting: round their legs first, then sat waiting
    let act = D.act;
    // (hungry, with his dish empty, it's not a stroke he's after: he sits there and demands)
    if (beat?.act === 'greet' && !moving) act = A.arrived && now - A.arrived < 4500 ? 'rub' : beat.hungry ? 'demand' : 'wait';
    if (!moving && !A.jump) A.want = restWant();
    // and settled up there, never with any of him over its edge, whatever put him where he is
    if (!moving && !A.jump && A.on && !D.keep) { const T = topNow(); if (T) A.at = fitOnTop(T.b, A.at, A.want, T.F, ku, lsd); }
    // its heading: turned through its own dynamics (quick and over a little for a quick cat, eased for a slow one)
    const head0 = A.head;
    A.head = A.dyn.turn.update(dt, A.want);
    const yawRate = dt > 0 ? ang(A.head - head0) / dt : 0;
    // and the gait from how fast it's actually going
    if (moving) gait = A.v > 1.25 ? 'gallop' : A.v > 0.5 ? 'trot' : 'walk';

    // ── the clip ───────────────────────────────────────────────────────────────────────────────────
    const clip = leap ? 'leap' : moving ? gait : (CAT_CLIPS[act] ? act : 'stand');
    const c = CAT_CLIPS[clip];
    let bake = bakes[c.base], useClip = clip;
    if (!bake) {
      // not carved yet: the plain hold of whatever is
      const have = BASES.find((p) => bakes[p]);
      if (!have) continue;
      bake = bakes[have]; useClip = { stand: 'stand', sit: 'sit', loaf: 'loaf', curl: 'sleep' }[have];
    }
    const start = moving ? 0 : leap ? A.jump?.since ?? now : Math.max(since, A.arrived || since);
    const t = moving ? A.walkT : (now - start) / 1000;
    const R = bake.rig, sc = R.look.scale;
    A.rig = R;
    const f = clipFrame(R, useClip, t, { seed: Math.floor(seed * 1000), speed: moving ? A.v : undefined, leap, spot, side: side || meetSide, tailCarry: tailCarryOf(bt.nature) });
    {
      const base = CAT_CLIPS[useClip].base, fk = useClip + ':' + (spot || '');
      if (A.fk !== fk) {
        A.fade = A.lastF && A.lastF.base === base && useClip !== 'leap' && A.lastF.clip !== 'leap' ? { from: A.lastF, t: 0 } : null;
        // from one carve to another (sat to stood, lying to stood and back): a staged get-up or sit-down instead of a cut
        const fb = A.lastF?.base;
        A.trans = fb && fb !== base && GETUP[fb + '>' + base] && bakes[fb] && useClip !== 'leap' && A.lastF.clip !== 'leap'
          ? { from: A.lastF, fromBase: fb, t: 0, ...GETUP[fb + '>' + base], ...(moving ? { dur: GETUP[fb + '>' + base].dur * 0.6 } : {}) } : null;
        A.fk = fk;
      }
      if (A.trans) {
        A.trans.t += dt;
        const k = clamp(A.trans.t / A.trans.dur, 0, 1);
        f.pose = stagePose(A.trans.from.pose, f.pose, k, A.trans.lead);
        f.mo = mixDeep(A.trans.from.mo, f.mo, smooth01(k));
        // the first half drawn on the carve he's leaving, the second on the one he's going to, so neither is bent far
        if (k < 0.5) A.drawBake = bakes[A.trans.fromBase];
        else A.drawBake = null;
        if (k >= 1) { A.trans = null; A.drawBake = null; }
      } else A.drawBake = null;
      if (A.fade) {
        A.fade.t += dt;
        const k = smooth01(A.fade.t / FADE_S);
        f.pose = mixDeep(A.fade.from.pose, f.pose, k); f.mo = mixDeep(A.fade.from.mo, f.mo, k);
        if (k >= 1) A.fade = null;
      }
      A.lastF = { base, clip: useClip, pose: structuredClone(f.pose), mo: structuredClone(f.mo) };
      A.lastBase = base;
    }

    // ── the body's own dynamics over the clip ───────────────────────────────────────────────────────
    const standing = CAT_CLIPS[useClip].base === 'stand';
    // where it is: the arc of a jump, the top it's on, or the floor under it
    const baseY = A.jump && leap?.part === 'fly' ? A.flyY : A.jump && leap?.part === 'crouch' ? A.jump.fromY : A.on && perchById(L, look, A.on) ? perchById(L, look, A.on).top : (L.baseAt?.(A.at[0], A.at[1]) || 0);
    const O = L.world(A.at[0], A.at[1], baseY);
    const P = L.world(A.at[0] + Math.sin(A.head), A.at[1] + Math.cos(A.head), 0), B0 = L.world(A.at[0], A.at[1], 0);
    let F = [P[0] - B0[0], 0, P[2] - B0[2]];
    const fl = Math.hypot(F[0], F[2]) || 1; F = [F[0] / fl, 0, F[2] / fl];
    const Lx = [F[2], 0, -F[0]];
    const toWorld = (q) => [O[0] + (Lx[0] * q[0] + F[0] * q[2]) * sc, O[1] + q[1] * sc, O[2] + (Lx[2] * q[0] + F[2] * q[2]) * sc];
    const toGround = (w) => { const d = [(w[0] - O[0]) / sc, (w[1] - O[1]) / sc, (w[2] - O[2]) / sc]; return [d[0] * Lx[0] + d[2] * Lx[2], d[1], d[0] * F[0] + d[2] * F[2]]; };
    const pose = f.pose, mo = f.mo;

    // leaning: back on its haunches as it brakes, forward as it gets going, into a turn the faster it's going
    const accel = dt > 0 ? (A.v - A.lastV) / dt : 0;
    A.lastV = A.v;
    const lean = A.dyn.lean.update(dt, [clamp(-accel * 0.045, -0.16, 0.16), clamp(-yawRate * A.v * 0.16, -0.28, 0.28)]);
    // the landing's dip, sprung back
    const dip = Math.max(-0.08, A.dyn.dip.update(dt, 0));
    if (standing) {
      pose.root.rot = [pose.root.rot[0] + lean[0], pose.root.rot[1], pose.root.rot[2] + lean[1]];
      pose.root.at = [pose.root.at[0], pose.root.at[1] + dip / sc, pose.root.at[2]];
      // the ground under each paw (a stair, the edge of the top it's on): the paw goes to it, and the body pitches
      // with the difference between its front and back ends
      if (!A.jump) {
        let fr = 0, hi = 0;
        for (const k of ['LF', 'RF', 'LH', 'RH']) {
          const L2 = pose.legs[k];
          if (!L2 || L2.rel) continue;
          const w = toWorld(L2.paw), q = L.local(w), g = groundAt(L, look, q[0], q[1], baseY + 0.05) - baseY;
          const dy = clamp(g / sc, -0.2, 0.2);
          L2.paw = [L2.paw[0], L2.paw[1] + dy, L2.paw[2]];
          if (k[1] === 'F') fr += dy / 2; else hi += dy / 2;
        }
        if (fr || hi) {
          pose.root.at = [pose.root.at[0], pose.root.at[1] + (fr + hi) / 2, pose.root.at[2]];
          pose.root.rot = [pose.root.rot[0] + Math.atan2(hi - fr, 0.42), pose.root.rot[1], pose.root.rot[2]];
        }
      }
    }

    // looking at somebody: who, for how long, and whether at all, from its attention and the clock; the head turns
    // there through its own dynamics and the clip's own looking about gives way to it
    let lookAt = null;
    // a hand on him or near his face: he looks at it, and pushes into it (the petted clip's rubbing does the rest)
    // While it's nice he mostly doesn't look at you: a look round at the hand when it first comes, then only now and
    // then (more for an outgoing cat, less when he's being scratched under the chin or down the back)
    const glance = (from, sp) => {
      if (now - from < 900) return true;
      const p = clamp(0.16 + 0.22 * (bt.nature?.outgoing ?? 0.5) - (sp === 'back' || sp === 'belly' ? 0.08 : 0) - (sp === 'chin' ? 0.1 : 0), 0.04, 0.5);
      return hash(bt.id + ':gl:' + Math.floor(now / 2600)) < p;
    };
    if (touch && !touch.down && ['chin', 'cheek', 'head', 'ears'].includes(touch.spot)) lookAt = { w: touch.at };
    else if (touch?.down) { if (glance(touch.since, touch.spot)) lookAt = { w: touch.at }; }
    else if (beat && beat.act !== 'cross' && beat.who) {
      const w = o.whereIs?.(beat.who);
      if (w && (beat.act !== 'petted' || glance(beat.since, beat.spot))) lookAt = { at: w, y: (beat.act === 'petted' ? 0.85 : 1.5) * (o.lowOf?.(beat.who) ?? 1) };
    }
    // watching the other cat come over
    else if (meetLook && !A.jump) lookAt = { at: meetLook.at, y: 0.22 };
    // the slow blink is at somebody: whoever's nearest; demanding at his dish, he looks round at whoever ought to fill it
    else if ((act === 'slowblink' || (act === 'demand' && bowl)) && !moving && !A.jump) {
      const folk = (o.folk?.() || []).filter((x) => dist(x.at, A.at) < (act === 'demand' ? 6 : 4)).sort((x, y) => dist(x.at, A.at) - dist(y.at, A.at));
      if (folk.length && (act === 'slowblink' || hash(bt.id + ':dl:' + Math.floor(now / 3000)) < 0.6)) lookAt = { at: folk[0].at, y: 1.45 * (o.lowOf?.(folk[0].id) ?? 1) };
    }
    else if (!mt && !bowl && !life.asleep && !A.jump && !moving && !['groom', 'flank', 'scratch', 'cello', 'hairball', 'shake', 'pee', 'poo'].includes(act)) {
      const slot = Math.floor(now / 7000 + hash(bt.id) * 3);
      if (hash(bt.id + ':attn:' + slot) < A.M.attention) {
        const folk = (o.folk?.() || []).filter((x) => dist(x.at, A.at) < 3.5);
        if (folk.length) { const who = folk[Math.floor(hash(bt.id + ':who:' + slot) * folk.length)]; lookAt = { at: who.at, y: 1.45 * (o.lowOf?.(who.id) ?? 1) }; }
      }
    }
    let gaze = [0, 0], w = 0;
    if (lookAt) {
      const tg = toGround(lookAt.w || L.world(lookAt.at[0], lookAt.at[1], lookAt.y)), hc = [0, R.HC[1] + (pose.root.at[1] - R.bones[R.index.pelvis].j[1]), R.HC[2]];
      const yaw = Math.atan2(tg[0] - hc[0], tg[2] - hc[2]), pitch = -Math.atan2(tg[1] - hc[1], Math.hypot(tg[0] - hc[0], tg[2] - hc[2]));
      if (Math.abs(yaw) < 1.6) { gaze = [clamp(pitch, -0.9, 0.55), clamp(yaw, -1.3, 1.3)]; w = 1; }
    }
    const wl = A.dyn.look.update(dt, w), lh = A.dyn.head.update(dt, gaze);
    if (wl > 0.01) {
      const hm = mo.head || [0, 0, 0];
      // the neck takes some of it, the head the rest
      mo.head = [lerp(hm[0], lh[0] * 0.6, wl), lerp(hm[1], lh[1] * 0.65, wl), hm[2] * (1 - wl * 0.5)];
      if (pose.spine?.neck) pose.spine.neck = [pose.spine.neck[0] + lh[0] * 0.4 * wl, (pose.spine.neck[1] || 0) + lh[1] * 0.35 * wl, pose.spine.neck[2] || 0];
      // and when it's a person it means to look at, its ears come round to them
      mo.ears = (mo.ears || [[0, 0, 0], [0, 0, 0]]).map((e) => [e[0], e[1] - 0.2 * wl, e[2]]);
    }
    // The eyes. Where he's looking, they get there first: what the head hasn't turned yet, the eyes make up, so on a new
    // target they flick across and come back to the middle as the head catches up. With nothing to look at they make
    // small shifts of their own every second or two. Something close (a hand) turns them both in.
    {
      let ex = 0, ey = 0, verge = 0;
      if (lookAt && w > 0) {
        ex = clamp((gaze[1] - lh[1] * wl) / 0.55, -1, 1); ey = clamp(-(gaze[0] - lh[0] * wl) / 0.45, -1, 1);
        const tw = lookAt.w || L.world(lookAt.at[0], lookAt.at[1], lookAt.y), hw = toWorld([0, R.HC[1], R.HC[2]]);
        verge = clamp(0.1 / Math.max(0.12, Math.hypot(tw[0] - hw[0], tw[1] - hw[1], tw[2] - hw[2])), 0, 0.5);
      } else {
        const slot = Math.floor(now / 1700 + hash(bt.id + ':sac') * 5);
        ex = (hash(bt.id + ':sx:' + slot) - 0.5) * 0.7; ey = (hash(bt.id + ':sy:' + slot) - 0.5) * 0.35;
      }
      const ge = A.dyn.eyes.update(dt, [ex, ey, verge]);
      mo.gaze = [ge[0], ge[1], Math.max(0, ge[2])];
    }
    // The pupils. The light sets them: a slit in sunlight, a full circle in the dark, each cat's own size tilting it a
    // little; excitement opens them wider (a clip says so with its own pupil, and fixing on something does). They close
    // down quicker than they open, as an eye's do.
    {
      const light = clamp(o.light ?? 0.6, 0, 1), own = (R.look.eyes?.pupil ?? 0.35) - 0.35;
      let want = clamp(lerp(0.95, 0.05, Math.pow(light, 0.6)) + own * 0.3, 0.04, 1);
      if (mo.pupil != null) want = Math.max(want, mo.pupil);
      if (w > 0) want = Math.max(want, want + 0.22 * wl * (A.M.attention ?? 0.5));
      const p0 = A.pupil ?? want, rate = want < p0 ? 2.6 : 0.9;
      A.pupil = p0 + (Math.min(1, want) - p0) * (1 - Math.exp(-rate * dt));
      mo.pupil = A.pupil;
    }
    // the ears through their own springs: they flick round and settle rather than snap
    const e0 = mo.ears || [[0, 0, 0], [0, 0, 0]], es = A.dyn.ears.update(dt, [...e0[0], ...e0[1]]);
    mo.ears = [[es[0], es[1], es[2]], [es[3], es[4], es[5]]];
    // and the tips behind them: how far they've been left behind, and a swing the other way as the body turns
    const tl = A.dyn.tips.update(dt, es);
    mo.earTips = [0, 1].map((i) => [(tl[i * 3] - es[i * 3]) * 1.1, (tl[i * 3 + 1] - es[i * 3 + 1]) * 1.1 - yawRate * 0.05, (tl[i * 3 + 2] - es[i * 3 + 2]) * 1.1]);

    // the tail: where the pose means it, then its physics, in the room
    const tone = useClip === 'sleep' ? 0.25 : CAT_CLIPS[useClip].base === 'loaf' || useClip === 'flop' ? 0.45 : A.M.tail.tone;
    const tgt = tailTarget(R, pose, mo).map(toWorld);
    const big = !A.fresh && A.tailAt && dist([O[0], O[2]], A.tailAt) > 1.2;
    const tp = stepTail(A.tail, tgt, dt, {
      tone, kTip: (2 * Math.PI * A.M.tail.fTip) ** 2, zTip: A.M.tail.zTip, reset: A.fresh || big,
      r: (i) => tailRadius(R.look.build, i) * sc + 0.005,
      under: (x, z, y) => { const q = L.local([x, y, z]); return L.floor + groundAt(L, look, q[0], q[1], q[2]); },
    });
    mo.tailPts = tp.map(toGround);
    A.tailAt = [O[0], O[2]]; A.fresh = false;

    // what's drawn this frame, for catHit
    A.drawn = { R, pose, mo, toWorld };
    // the mouth: open as far as the clip says (a hiss) or the call he is making is loud now (room-cat-sound.js mouth)
    mo.mouth = Math.max(mo.mouth || 0, o.mouth?.(bt.id) || 0);
    out.cats.push(o.drawer.frame(A.drawBake || bake, pose, mo, { O, F }));
    out.voices.push({ id: bt.id, clip: useClip, t, since: moving ? 'move' : leap ? 'leap:' + A.jump?.since : String(start), pos: O, look: R.look });
  }
  // a cat no longer here is forgotten
  for (const id of _actors.keys()) if (!beasts.some((b) => b?.id === id)) _actors.delete(id);
  return out;
}
/** For a gate or a bench: where each cat is on this client and which way it faces. */
export const catActors = () => _actors;

// ── touching him ───────────────────────────────────────────────────────────────────────────────────
// The spots on a cat a hand can find, each a point on one bone of the rest cat with a reach (metres): small spots first,
// so the chin wins over the head it's under. 'side' is +1 on his left.
function spotsOf(R) {
  const H = R.HS, C = R.HC, Y = R.Y, at = (dx, dy, dz) => [C[0] + dx * H, C[1] + dy * H, C[2] + dz * H];
  const out = [
    { spot: 'chin', bone: 'head', p: at(0, -0.075, 0.05), r: 0.035 },
    { spot: 'cheek', side: 1, bone: 'head', p: at(0.075, -0.02, 0.03), r: 0.035 },
    { spot: 'cheek', side: -1, bone: 'head', p: at(-0.075, -0.02, 0.03), r: 0.035 },
    { spot: 'ears', side: 1, bone: 'earLt', p: R.bones[R.index.earLt].j, r: 0.03 },
    { spot: 'ears', side: -1, bone: 'earRt', p: R.bones[R.index.earRt].j, r: 0.03 },
    { spot: 'head', bone: 'head', p: at(0, 0.065, -0.01), r: 0.045 },
    { spot: 'belly', bone: 'lumbar', p: [0, Y(0.27), -0.08], r: 0.06 },
    { spot: 'back', bone: 'chest', p: [0, Y(0.52), 0.06], r: 0.07 },
    { spot: 'back', bone: 'lumbar', p: [0, Y(0.51), -0.1], r: 0.07 },
    { spot: 'back', bone: 'pelvis', p: [0, Y(0.48), -0.22], r: 0.07 },
  ];
  for (const k of ['LF', 'RF', 'LH', 'RH']) out.push({ spot: 'paws', bone: k + 'pw', p: R.legs[k].J.D, r: 0.035 });
  for (let i = 3; i < TAIL_N; i += 2) out.push({ spot: 'tail', bone: 'tail' + i, p: R.tail[i].j, r: 0.035 });
  return out;
}
/**
 * The cat and the spot on it under a point on the screen, or null: { id, name, spot, side, at (world) }. 'project'
 * is the renderer's (world, w, h) => { x, y } or null. Only a cat drawn this frame can be found.
 */
export function catHit(project, x, y, w, h, beasts = []) {
  let best = null;
  for (const [id, A] of _actors) {
    const d = A.drawn;
    if (!d) continue;
    const X = solveRig(d.R, d.pose, d.mo);
    for (const s of spotsOf(d.R)) {
      const T = X[d.R.index[s.bone]], q = s.p;
      const g = [T.R[0] * q[0] + T.R[1] * q[1] + T.R[2] * q[2] + T.t[0], T.R[3] * q[0] + T.R[4] * q[1] + T.R[5] * q[2] + T.t[1], T.R[6] * q[0] + T.R[7] * q[1] + T.R[8] * q[2] + T.t[2]];
      const wp = d.toWorld(g), a = project(wp, w, h), b = a && project([wp[0], wp[1] + s.r, wp[2]], w, h);
      if (!a || !b) continue;
      const rp = Math.max(10, Math.hypot(b.x - a.x, b.y - a.y)), k = Math.hypot(x - a.x, y - a.y) / rp;
      if (k < 1.25 && (!best || k < best.k)) best = { k, id, spot: s.spot, side: s.side || 0, at: wp };
    }
  }
  if (!best) return null;
  const bt = beasts.find((b) => b.id === best.id);
  return { id: best.id, name: bt?.name || '', spot: best.spot, side: best.side, at: best.at };
}
/**
 * A hand on a cat from this client: { spot, side, at (world), down } while the pointer's over him (down: pressed and
 * stroking), null to take it away. Called as the pointer moves; a touch not renewed for TOUCH_MS lapses on its own.
 */
export function catTouch(id, t) {
  const A = _actors.get(id);
  if (!A) return;
  if (!t) { A.touch = null; return; }
  const same = A.touch && A.touch.down === !!t.down && A.touch.spot === t.spot && Date.now() - A.touch.t < TOUCH_MS;
  A.touch = { ...t, down: !!t.down, t: Date.now(), since: same ? A.touch.since : Date.now() };
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
// FNV-1a with murmur3's finaliser, so keys that differ in their last digit land far apart
const hash = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return (h >>> 0) / 4294967296; };

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
    if (bt.cat) return;   // catsFrame draws the cats
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
