// THE CAT'S CLIPS: what a cat does, as poses over time (docs/proposals/pets.md, "What he does on his own").
//
// A clip is carved from one of the four bakes (stand, sit, loaf, curl: CAT_POSES in gl/cat-kit.js) and moves its bones
// from there: a groom is the sit with a forepaw at the mouth, a walk is the stand with its paws stepping. The skin
// carries the carve to the frame (skinCat's `pose`, or the GPU's bones in gl/cat-gpu.js), so a frame costs a solve,
// never a carve. Keep a clip near its base: the further a bone goes from where it was carved, the more its joint
// pinches.
//
// frame(R, t, ctx) → { pose, mo }: `pose` a pose object as CAT_POSES gives, `mo` the motion over it (idleMotion's
// shape). `t` is seconds into the clip; a clip with `len` loops on it, one with `once` holds its last frame after.
// ctx: { seed, speed (m/s, for a gait), look (yaw toward what it's watching, radians) }. Pure: the same t and ctx give
// the same frame for everybody.
//
// `sound` says what it sounds like while it plays (gl/room-beasts.js plays it): a bed under the clip, and calls at
// moments. Keys are the field recordings (client/shared/field-recordings.js).
//
// Nothing here knows any particular cat.
import { CAT_POSES, idleMotion, solveRig, STILL, EAR_MOODS } from './cat-kit.js';

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const unit = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const frac = (x) => x - Math.floor(x);
// a bump that rises over [a, a+r], holds, and falls over [b-r, b]
const hold = (t, a, b, r = 0.3) => smooth(a, a + r, t) * (1 - smooth(b - r, b, t));
const rnd = (i, s) => { const x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453; return x - Math.floor(x); };

// the base pose, a fresh copy each frame (a clip changes it)
const copy = (o) => (Array.isArray(o) ? o.map(copy) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, copy(v)])) : o);
const _base = new WeakMap();
function baseOf(R, name) {
  let m = _base.get(R);
  if (!m) _base.set(R, (m = new Map()));
  let b = m.get(name);
  if (!b) {
    const pose = CAT_POSES[name](R), X = solveRig(R, pose, STILL);
    const ap = (i, p) => { const T = X[i]; return [T.R[0] * p[0] + T.R[1] * p[1] + T.R[2] * p[2] + T.t[0], T.R[3] * p[0] + T.R[4] * p[1] + T.R[5] * p[2] + T.t[1], T.R[6] * p[0] + T.R[7] * p[1] + T.R[8] * p[2] + T.t[2]]; };
    const H = R.HS, C = R.HC, hi = R.index.head;
    // where things are on the base pose, in the cat's ground frame: the mouth, each ear's root, the chest's front
    b = {
      pose,
      mouth: ap(hi, add3(C, [0, -0.06 * H, 0.16 * H])),
      chin: ap(hi, add3(C, [0, -0.075 * H, 0.06 * H])),
      ears: R.ears.map((e) => ap(R.index[e.bone.name], e.bone.j)),
      brisket: ap(R.index.chest, [0, R.Y(0.33), 0.25]),
    };
    m.set(name, b);
  }
  return { ...b, pose: copy(b.pose) };
}
const idle = (t, ctx, awake = 1) => idleMotion(t, { awake, seed: ctx.seed ?? 1 });
// the ears toward one of their moods (gl/cat-kit.js EAR_MOODS, after CatFACS), `k` of the way, over whatever the idle
// had them doing, so a twitch still shows through a mood
function moodEars(mo, mood, k = 1) {
  const m = EAR_MOODS[mood] || EAR_MOODS.neutral, e0 = mo.ears || [[0, 0, 0], [0, 0, 0]];
  mo.ears = e0.map((e, i) => e.map((x, j) => x * (1 - 0.7 * k) + m[i][j] * k));
  return mo;
}

// ── gaits ─────────────────────────────────────────────────────────────────────────────────────────
// A walk is the stand with each paw sliding back under the body while it's down and swinging forward while it's
// up. In the cat's own frame a planted paw moves back at the body's speed, so a stance covers v·duty/f; the cat
// itself is moved across the room by whoever plays the clip (gl/room-beasts.js), at the same speed.
// phase offsets: the walk and trot are a cat's lateral sequence (left hind, left fore, right hind, right fore); the
// gallop is a rotary one, the hinds together and the fores together, the spine flexing between
const GAITS = {
  walk: { f: 1.35, duty: 0.62, lift: 0.045, off: { LH: 0, LF: 0.25, RH: 0.5, RF: 0.75 }, bob: 0.006, tail: 0.2 },
  trot: { f: 2.3, duty: 0.48, lift: 0.06, off: { LH: 0, RF: 0.02, RH: 0.5, LF: 0.52 }, bob: 0.01, tail: 1 },
  gallop: { f: 3.4, duty: 0.32, lift: 0.08, off: { LH: 0, RH: 0.08, LF: 0.5, RF: 0.58 }, bob: 0.03, tail: 0.4, flex: 0.22 },
};
export const GAIT_SPEED = { walk: 0.32, trot: 0.75, gallop: 2.2 };
function gait(R, t, ctx, kind) {
  const G = GAITS[kind], b = baseOf(R, 'stand'), pose = b.pose, sc = R.look.scale;
  const v = (ctx.speed ?? GAIT_SPEED[kind]) / sc, S = v * G.duty / G.f, ph = t * G.f;
  for (const k of ['LF', 'RF', 'LH', 'RH']) {
    const L = pose.legs[k], u = frac(ph + G.off[k]), rest = R.legs[k].J.D;
    let z, y;
    if (u < G.duty) { z = S / 2 - S * (u / G.duty); y = 0; }
    else { const s = (u - G.duty) / (1 - G.duty); z = -S / 2 + S * smooth(0, 1, s); y = G.lift * Math.sin(Math.PI * s); }
    L.paw = [rest[0], rest[1] + y, rest[2] + z];
    // the toes droop as the paw comes up
    if (y > 0) L.fwd = unit([0, -y * 4, 1]);
  }
  // the body rides a little up as each pair passes under it, and the spine sways
  const at = pose.root.at;
  pose.root.at = [at[0], at[1] + G.bob * Math.cos(ph * Math.PI * 4) - (kind === 'gallop' ? 0.02 : 0), at[2]];
  pose.root.rot = [(G.flex || 0) * 0.5 * Math.sin(ph * Math.PI * 2), 0.04 * Math.sin(ph * Math.PI * 2), 0.03 * Math.sin(ph * Math.PI * 2)];
  if (G.flex) pose.spine.lumbar = [G.flex * Math.sin(ph * Math.PI * 2 + 1), 0, 0];
  // tail: level on a walk, up with a hooked tip on the trot over to somebody, streaming out on a run
  if (G.tail >= 1) pose.tail = tailUp(R);
  else if (kind === 'gallop') pose.tail = [[0, R.Y(0.42), -0.5], [0, R.Y(0.45), -0.65], [0, R.Y(0.47), -0.8], [0, R.Y(0.5), -0.92]];
  else pose.tail = [[0, R.Y(0.38), -0.48], [0, R.Y(0.36), -0.62], [0, R.Y(0.34), -0.76], [0, R.Y(0.38), -0.86]];
  const mo = idle(t, ctx, 1);
  mo.head = [0.08 - 0.05 * Math.cos(ph * Math.PI * 4), mo.head[1] * 0.25, 0];
  mo.tailSway = Math.sin(ph * Math.PI * 2) * 0.25; mo.tailFlick *= 0.3;
  return { pose, mo };
}
// A slow wandering value in -1..1: smooth noise along t (cubic between a random value at each whole step), so a head
// or a lid moves the way a living thing's does rather than on a sine
function drift(t, seed = 0) {
  const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f);
  return lerp(rnd(i, seed) * 2 - 1, rnd(i + 1, seed) * 2 - 1, u);
}
// A clip of being stroked over `base`: `amp` how far the head goes (a cat lying down moves less), `awake` how
// awake he is under the idle, `bed` the purr under it
function pettedOn(base, amp, awake, bed) {
  return {
    base, len: 0,
    sound: { bed, gain: 1, calls: base === 'curl' ? [] : [{ keys: ['cat_trill', 'cat_trill_b', 'cat_trill_c', 'cat_meow_small'], every: 7.5, gain: 0.35, p: 0.45 }] },
    frame(R, t, ctx) {
      const pose = baseOf(R, base).pose, spot = ctx.spot || 'head', sd = (ctx.seed ?? 1) * 0.37;
      const side = ctx.side || ((ctx.seed ?? 1) % 2 ? 1 : -1);
      if (base === 'sit') pose.spine.neck = [pose.spine.neck[0] - 0.15, 0, 0];
      const mo = idle(t, ctx, awake);
      // the drifts: slow, slower, slowest; and how far into the stroke (it builds over a second)
      const n1 = drift(t * 0.42, sd), n2 = drift(t * 0.27, sd + 3), n3 = drift(t * 0.17, sd + 7), k = smooth(0, 1.1, t) * amp;
      let head;
      if (spot === 'chin') head = [-0.58 - 0.08 * n1, 0.16 * n2, 0.1 * n3];
      else if (spot === 'cheek') head = [-0.18 + 0.06 * n3, side * (0.3 + 0.18 * n1), side * (0.32 + 0.2 * n2)];
      else if (spot === 'ears') head = [-0.12 + 0.08 * n1, 0.22 * n2, 0.18 * n3];
      else head = [-0.32 + 0.1 * n1, 0.24 * n2, 0.22 * n3];
      // now and then he turns his face off to one side and holds it there, eyes shut, enjoying it
      const away = smooth(0.35, 0.75, drift(t * 0.11, sd + 11)) * (spot === 'chin' ? 0.4 : 1);
      head = [head[0], head[1] + 0.45 * away * Math.sign(drift(3.1, sd + 13) || 1), head[2]];
      mo.head = [lerp(mo.head[0], head[0], k), lerp(mo.head[1], head[1], k), lerp(mo.head[2], head[2], k)];
      // the lids: a squint that comes and goes, deeper under the chin, and a slow blink every so often
      const sq = (spot === 'chin' ? 0.78 : 0.6) + 0.18 * n2 + 0.15 * away;
      const bl = frac(t / 6.3 + sd) < 0.09 ? Math.sin(frac(t / 6.3 + sd) / 0.09 * Math.PI) : 0;
      mo.lids = clamp(Math.max(mo.lids, base === 'curl' ? 0.9 : sq, bl));
      // the ears: content, and pressed out flat under a hand on them
      moodEars(mo, spot === 'ears' ? 'airplane' : 'content', spot === 'ears' ? 0.55 + 0.25 * n1 : 0.9);
      mo.whiskers = 0.15 + 0.2 * n3;
      mo.tailSway = 0.2 * drift(t * 0.3, sd + 17);
      mo.tailFlick = 0.12 * drift(t * 1.3, sd + 19) * (1 + away);
      return { pose, mo };
    },
  };
}
// the tail straight up with its tip hooked over: hello
function tailUp(R) { return [[0, R.Y(0.55), -0.36], [0, R.Y(0.72), -0.38], [0, R.Y(0.86), -0.36], [0.02, R.Y(0.92), -0.29], [0.03, R.Y(0.89), -0.24]]; }

// ── the clips ──────────────────────────────────────────────────────────────────────────────────────
export const CAT_CLIPS = {
  // holding a pose, idling
  stand: { base: 'stand', len: 0, frame: (R, t, ctx) => ({ pose: baseOf(R, 'stand').pose, mo: idle(t, ctx, 1) }) },
  sit: { base: 'sit', len: 0, frame: (R, t, ctx) => ({ pose: baseOf(R, 'sit').pose, mo: idle(t, ctx, 1) }) },
  loaf: { base: 'loaf', len: 0, frame: (R, t, ctx) => ({ pose: baseOf(R, 'loaf').pose, mo: moodEars(idle(t, ctx, 0.55), 'content', 0.4) }), sound: { calls: [{ keys: ['cat_purr'], every: 9, gain: 0.45, p: 0.4 }] } },
  sleep: {
    base: 'curl', len: 0, frame: (R, t, ctx) => ({ pose: baseOf(R, 'curl').pose, mo: moodEars(idle(t, ctx, 0.04), 'sleepy', 0.9) }),
    sound: { bed: 'cat_snore', gain: 0.5 },
  },

  // the gaits
  walk: { base: 'stand', len: 0, gait: 'walk', frame: (R, t, ctx) => gait(R, t, ctx, 'walk') },
  trot: { base: 'stand', len: 0, gait: 'trot', frame: (R, t, ctx) => gait(R, t, ctx, 'trot') },
  gallop: { base: 'stand', len: 0, gait: 'gallop', frame: (R, t, ctx) => gait(R, t, ctx, 'gallop'), sound: { calls: [{ keys: ['cat_zoomies', 'cat_land', 'cat_jump'], every: 1.6 }] } },

  // washing the face: lick the inside of a forepaw a few times, then wipe it over the ear, and again
  groom: {
    base: 'sit', len: 6,
    sound: { bed: 'cat_groom', gain: 0.8 },
    frame(R, t, ctx) {
      const b = baseOf(R, 'sit'), pose = b.pose, side = (ctx.seed ?? 1) % 2 ? 1 : -1, k = side > 0 ? 'LF' : 'RF';
      const up = hold(t, 0.2, 5.8, 0.5), wipe = hold(t, 3.2, 4.9, 0.35);
      const lick = Math.max(0, Math.sin(t * Math.PI * 2 * 2.6)) * (1 - wipe);
      // the paw comes up under the chin, turned in; on the wipe it goes up and back over the ear
      const mouth = add3(b.mouth, [side * 0.015, -0.03 - lick * 0.012, -0.005]);
      const ear = add3(b.ears[side > 0 ? 0 : 1], [side * 0.05, -0.01, 0.05]);
      const to = [lerp(mouth[0], ear[0], wipe), lerp(mouth[1], ear[1], wipe), lerp(mouth[2], ear[2], wipe)];
      const rest = pose.legs[k].paw;
      pose.legs[k] = { paw: [lerp(rest[0], to[0], up), lerp(rest[1], to[1], up), lerp(rest[2], to[2], up)],
        fwd: unit([-side * 0.5 * up, 0.9 * up, 1 - up * 0.6]), up: unit([side * 0.6 * up, 1 - up * 0.4, -0.6 * up]),
        meta: unit([0, 0.25 + 0.75 * up, 1 - 0.3 * up]), pole: unit([side * 0.3 * up, -1, -0.4]) };
      // the weight onto the other forepaw
      pose.root.rot = [pose.root.rot[0], 0, -side * 0.06 * up];
      const mo = idle(t, ctx, 0.7);
      mo.head = [0.28 * up * (1 - wipe) + lick * 0.1 + 0.35 * wipe, side * (0.15 * up - 0.25 * wipe), side * 0.35 * wipe];
      mo.lids = Math.max(mo.lids, 0.55 * up);
      mo.ears = [[0, 0.2 * wipe, 0.3 * wipe], [0, 0.2 * wipe, 0.3 * wipe]];
      mo.tailSway *= 0.3;
      return { pose, mo };
    },
  },

  // licking the flank: the head turned right round to the shoulder, long strokes
  flank: {
    base: 'loaf', len: 7,
    sound: { bed: 'cat_groom', gain: 0.7 },
    frame(R, t, ctx) {
      const pose = baseOf(R, 'loaf').pose, side = (ctx.seed ?? 1) % 2 ? 1 : -1, on = hold(t, 0, 7, 0.8);
      const stroke = Math.max(0, Math.sin(t * Math.PI * 2 * 1.8));
      pose.spine.chest = [pose.spine.chest[0], side * 0.35 * on, side * 0.1 * on];
      pose.spine.neck = [pose.spine.neck[0] + 0.25 * on, side * 0.7 * on, 0];
      const mo = idle(t, ctx, 0.6);
      mo.head = [(0.45 + 0.18 * stroke) * on, side * 0.65 * on, side * 0.2 * on];
      mo.lids = Math.max(mo.lids, 0.6 * on);
      return { pose, mo };
    },
  },

  // a hind foot up to scratch behind the ear, fast
  scratch: {
    base: 'sit', len: 3.4,
    frame(R, t, ctx) {
      const b = baseOf(R, 'sit'), pose = b.pose, side = (ctx.seed ?? 1) % 2 ? 1 : -1, k = side > 0 ? 'LH' : 'RH';
      const up = hold(t, 0.1, 3.2, 0.45), go = hold(t, 0.6, 2.8, 0.15);
      const ear = b.ears[side > 0 ? 0 : 1], buzz = Math.sin(t * Math.PI * 2 * 7.5) * go;
      const to = [ear[0] + side * 0.07, ear[1] - 0.17 + buzz * 0.025, ear[2] - 0.06 + buzz * 0.02];
      const rest = pose.legs[k].paw;
      pose.legs[k] = { ...pose.legs[k], paw: [lerp(rest[0], to[0], up), lerp(rest[1], to[1], up), lerp(rest[2], to[2], up)],
        fwd: unit([side * 0.2, 0.6 * up, 1]), meta: unit([side * 0.3 * up, 0.8 * up - 0.02, 1 - 0.5 * up]), pole: [side * 0.6, 0.5, 1] };
      pose.root.rot = [pose.root.rot[0], 0, side * 0.1 * up];
      const mo = idle(t, ctx, 0.7);
      mo.head = [0.15 * up, side * 0.2 * up, side * 0.45 * up + buzz * 0.03];
      mo.lids = Math.max(mo.lids, 0.7 * go);
      mo.ears[side > 0 ? 0 : 1] = [0, 0.5 * up, 0.5 * up];
      return { pose, mo };
    },
  },

  // the yawn: nose up, ears back, eyes screwed shut, a stretch of the neck
  yawn: {
    base: 'sit', len: 3.2,
    sound: { calls: [{ keys: ['cat_meow_short'], at: 1.2, gain: 0.35 }] },
    frame(R, t, ctx) {
      const pose = baseOf(R, 'sit').pose, k = hold(t, 0.3, 2.9, 0.6);
      pose.spine.neck = [pose.spine.neck[0] - 0.25 * k, 0, 0];
      const mo = idle(t, ctx, 1);
      mo.head = [-0.55 * k, mo.head[1] * (1 - k), 0];
      mo.lids = Math.max(mo.lids * (1 - k), 0.95 * k);
      moodEars(mo, 'airplane', 0.8 * k);
      mo.whiskers = 0.8 * k;
      return { pose, mo };
    },
  },

  // the stretch: forepaws out and chest down, bum in the air; then each back leg out behind in turn
  stretch: {
    base: 'stand', len: 5.6, once: true,
    sound: { calls: [{ keys: ['cat_trill', 'cat_trill_c'], at: 2.2, gain: 0.4, p: 0.5 }] },
    frame(R, t, ctx) {
      const pose = baseOf(R, 'stand').pose, f = hold(t, 0.1, 2.8, 0.7), h = hold(t, 2.9, 5.3, 0.5), side = (ctx.seed ?? 1) % 2 ? 1 : -1;
      for (const k of ['LF', 'RF']) { const p = pose.legs[k].paw; pose.legs[k].paw = [p[0], p[1], p[2] + 0.17 * f]; }
      pose.root.rot = [0.12 * f - 0.08 * h, 0, 0];
      pose.root.at = [pose.root.at[0], pose.root.at[1] - 0.01 * f, pose.root.at[2] + 0.04 * h];
      pose.spine.chest = [0.22 * f, 0, 0];
      pose.spine.lumbar = [0.08 * f, 0, 0];
      pose.spine.neck = [-0.5 * f, 0, 0];
      const k = side > 0 ? 'LH' : 'RH', p = pose.legs[k].paw;
      pose.legs[k].paw = [p[0], p[1] + 0.05 * h, p[2] - 0.2 * h];
      pose.legs[k].fwd = unit([0, -0.4 * h, 1]);
      pose.tail = pose.tail.map((q, i) => [q[0], q[1] + (0.12 + i * 0.04) * f, q[2]]);
      const mo = idle(t, ctx, 1);
      mo.head = [-0.15 * f, 0, 0];
      mo.lids = Math.max(mo.lids, 0.8 * f);
      mo.ears = [[0, 0.4 * f, 0.2 * f], [0, 0.4 * f, 0.2 * f]];
      return { pose, mo };
    },
  },

  // kneading: the forepaws treading up and down in turn, eyes half shut, purring
  knead: {
    base: 'stand', len: 0,
    sound: { bed: 'cat_purr_soft', gain: 1 },
    frame(R, t, ctx) {
      const pose = baseOf(R, 'stand').pose, ph = t * Math.PI * 2 * 1.5;
      pose.root.at = [pose.root.at[0], pose.root.at[1] - 0.035, pose.root.at[2]];
      pose.root.rot = [0.1, 0, 0.025 * Math.sin(ph)];
      ['LF', 'RF'].forEach((k, i) => {
        const p = pose.legs[k].paw, s = Math.max(0, Math.sin(ph + i * Math.PI));
        pose.legs[k].paw = [p[0], p[1] + 0.035 * s, p[2] + 0.04 + 0.02 * s];
        pose.legs[k].fwd = unit([0, -0.5 * s, 1]);
      });
      const mo = idle(t, ctx, 0.5);
      mo.head = [0.1 + 0.03 * Math.sin(ph), mo.head[1] * 0.2, 0];
      mo.lids = Math.max(mo.lids, 0.65);
      mo.tailSway *= 0.4;
      return { pose, mo };
    },
  },

  // sitting up on his bum like a person, front paws in the air
  situp: {
    base: 'sit', len: 5,
    sound: { calls: [{ keys: ['cat_meow_beg', 'cat_meow_small', 'cat_meow_hungry'], at: 1.4, gain: 0.6 }] },
    frame(R, t, ctx) {
      const b = baseOf(R, 'sit'), pose = b.pose, k = hold(t, 0.2, 4.7, 0.9);
      pose.root.rot = [pose.root.rot[0] - 0.55 * k, 0, 0];
      pose.root.at = [pose.root.at[0], pose.root.at[1] + 0.03 * k, pose.root.at[2] - 0.04 * k];
      pose.spine.neck = [pose.spine.neck[0] + 0.35 * k, 0, 0];
      ['LF', 'RF'].forEach((leg, i) => {
        const p = pose.legs[leg].paw, s = i ? -1 : 1, to = [s * 0.05, b.brisket[1] - 0.07, b.brisket[2] + 0.04];
        pose.legs[leg] = { paw: [lerp(p[0], to[0], k), lerp(p[1], to[1], k), lerp(p[2], to[2], k)],
          fwd: unit([0, -0.9 * k, 1 - 0.7 * k]), up: unit([0, 1 - 0.8 * k, 0.9 * k]), meta: unit([0, -0.9 * k, 1 - 0.6 * k]), pole: [0, -0.4, -1] };
      });
      const mo = idle(t, ctx, 1);
      mo.head = [-0.2 * k, mo.head[1] * 0.4, 0];
      mo.ears = [[0, -0.1 * k, 0], [0, -0.1 * k, 0]];
      mo.pupil = 0.7;
      return { pose, mo };
    },
  },

  // flopped over on his side, legs out, the tail going slowly
  flop: {
    base: 'stand', len: 0,
    frame(R, t, ctx) {
      const pose = baseOf(R, 'stand').pose, side = (ctx.seed ?? 1) % 2 ? 1 : -1;
      pose.root = { at: [side * 0.02, 0.165, -0.2], rot: [0, 0, side * 1.42] };
      pose.spine.neck = [0.1, 0, -side * 0.35];
      for (const k of ['LF', 'RF', 'LH', 'RH']) {
        const L = R.legs[k], d = L.J.D, front = L.front;
        pose.legs[k] = { rel: true, paw: [d[0] * 1.2, R.Y(0.05) + (front ? 0.02 : 0), d[2] + (front ? 0.07 : -0.08)], fwd: [0, 0, 1], up: [0, 1, 0], pole: front ? [0, 0, -1] : [0, 0, 1] };
      }
      pose.tail = [[side * -0.08, 0.05, -0.45], [side * -0.12, 0.03, -0.6], [side * -0.1, 0.025, -0.75], [side * -0.04, 0.025, -0.86]];
      const mo = idle(t, ctx, 0.35);
      mo.head = [mo.head[0] * 0.5, mo.head[1] * 0.4, mo.head[2]];
      mo.tailSway = Math.sin(t * 0.7) * 0.5;
      return { pose, mo };
    },
  },

  // nose down, smelling the floor, whiskers forward
  sniff: {
    base: 'stand', len: 4,
    frame(R, t, ctx) {
      const pose = baseOf(R, 'stand').pose, k = hold(t, 0.1, 3.9, 0.6);
      pose.spine.neck = [0.42 * k, 0.15 * Math.sin(t * 1.3) * k, 0];
      pose.root.rot = [0.08 * k, 0, 0];
      const mo = idle(t, ctx, 1);
      mo.head = [0.3 * k + 0.04 * Math.sin(t * 9) * k, 0.25 * Math.sin(t * 1.7) * k, 0];
      mo.whiskers = 1 * k;
      mo.ears = [[0.1 * k, -0.1 * k, 0], [0.1 * k, -0.1 * k, 0]];
      return { pose, mo };
    },
  },

  // watching something (a bird at the window): ears forward, pupils wide, the tail's tip going, the chatter
  watch: {
    base: 'sit', len: 8,
    sound: { calls: [{ keys: ['cat_chatter', 'cat_chatter_b', 'cat_chirp', 'cat_chirp_b'], at: 2.5, gain: 0.55, p: 0.7 }] },
    frame(R, t, ctx) {
      const pose = baseOf(R, 'sit').pose, k = hold(t, 0, 8, 0.4), chat = hold(t, 2.4, 3.6, 0.1);
      const mo = idle(t, ctx, 1);
      mo.head = [-0.15 * k + Math.sin(t * Math.PI * 2 * 11) * 0.025 * chat, (ctx.look ?? 0.4) * k, 0];
      moodEars(mo, 'together', k);
      mo.pupil = lerp(0.35, 0.95, k);
      mo.lids = 0;
      mo.whiskers = 0.9 * k;
      mo.tailFlick = Math.sin(t * 4.5) * 0.9 * k;
      return { pose, mo };
    },
  },

  // claws in the rug: forepaws up and forward, pulled back in turn
  claw: {
    base: 'stand', len: 3.6,
    sound: { calls: [{ keys: ['cat_scratch_floor', 'cat_scratch'], at: 0.3, gain: 0.7 }] },
    frame(R, t, ctx) {
      const pose = baseOf(R, 'stand').pose, k = hold(t, 0, 3.6, 0.5), ph = t * Math.PI * 2 * 2.2;
      pose.root.rot = [0.12 * k, 0, 0];
      pose.root.at = [pose.root.at[0], pose.root.at[1] - 0.02 * k, pose.root.at[2]];
      ['LF', 'RF'].forEach((leg, i) => {
        const p = pose.legs[leg].paw, s = 0.5 + 0.5 * Math.sin(ph + i * Math.PI);
        pose.legs[leg].paw = [p[0], p[1] + 0.02 * k * (1 - s), p[2] + k * (0.06 + 0.06 * s)];
      });
      const mo = idle(t, ctx, 1);
      mo.head = [0.2 * k, 0, 0];
      return { pose, mo };
    },
  },

  // low and still, the bum wiggling, then the pounce
  stalk: {
    base: 'stand', len: 5, once: true,
    sound: { calls: [{ keys: ['cat_land'], at: 4.15, gain: 0.7 }] },
    frame(R, t, ctx) {
      const pose = baseOf(R, 'stand').pose, low = hold(t, 0, 4.0, 0.6), wig = hold(t, 2.3, 3.8, 0.2), go = smooth(3.85, 4.1, t) * (1 - smooth(4.3, 4.9, t));
      pose.root.at = [pose.root.at[0] + Math.sin(t * 22) * 0.012 * wig, pose.root.at[1] - 0.07 * low + 0.06 * go, pose.root.at[2] + 0.15 * go];
      pose.root.rot = [-0.05 * low, Math.sin(t * 22) * 0.06 * wig, 0];
      pose.spine.neck = [-0.3 * low, 0, 0];
      for (const k of ['LF', 'RF']) { const p = pose.legs[k].paw; pose.legs[k].paw = [p[0], p[1] + 0.05 * go, p[2] + 0.22 * go]; }
      pose.tail = pose.tail.map((q, i) => [q[0], Math.max(0.03, q[1] - 0.05 * low), q[2]]);
      const mo = idle(t, ctx, 1);
      mo.head = [0.1 * low, 0, 0];
      moodEars(mo, 'together', low);
      mo.pupil = lerp(0.4, 1, low);
      mo.tailFlick = Math.sin(t * 7) * low;
      return { pose, mo };
    },
  },

  // greeting at somebody's feet: leaning on their shins, head bunting, tail up, purring
  rub: {
    base: 'stand', len: 4,
    sound: { bed: 'cat_purr_tom', gain: 0.8 },
    frame(R, t, ctx) {
      const pose = baseOf(R, 'stand').pose, ph = t / 4 * Math.PI * 2, side = (ctx.seed ?? 1) % 2 ? 1 : -1;
      const lean = side * (0.14 + 0.06 * Math.sin(ph));
      pose.root.rot = [0, 0.1 * Math.sin(ph), lean];
      pose.spine.neck = [-0.1, side * 0.25, side * 0.2];
      pose.tail = tailUp(R);
      const mo = idle(t, ctx, 1);
      const bunt = Math.max(0, Math.sin(ph * 2));
      mo.head = [-0.15 - 0.15 * bunt, side * 0.3, side * 0.35 * bunt];
      mo.lids = Math.max(mo.lids, 0.5);
      mo.tailFlick = 0.4 * Math.sin(t * 3);
      return { pose, mo };
    },
  },

  // sat at somebody's feet looking up at them, waiting to be stroked; a meow every so often
  wait: {
    base: 'sit', len: 6,
    // a meow at the start of each go round, and now and then a crosser one later in it: he's been waiting
    sound: { calls: [{ keys: ['cat_meow', 'cat_meow_small', 'cat_meow_beg', 'cat_trill_b', 'cat_meow_high'], at: 1, gain: 0.7 }, { keys: ['cat_meow_grumpy', 'cat_meow_cross', 'cat_meow_hungry'], at: 4.2, gain: 0.6, p: 0.35 }] },
    frame(R, t, ctx) {
      const pose = baseOf(R, 'sit').pose;
      pose.spine.neck = [pose.spine.neck[0] - 0.2, 0, 0];
      const mo = idle(t, ctx, 1);
      const mew = hold(t, 0.9, 1.7, 0.15);
      mo.head = [-0.45 + 0.05 * mew, mo.head[1] * 0.15, 0.12 * Math.sin(t * 0.8)];
      moodEars(mo, 'forward', 0.9);
      mo.pupil = 0.65;
      mo.tailSway = 0.25 * Math.sin(t * 0.9);
      mo.tailFlick = 0.5 * Math.sin(t * 2.4);
      return { pose, mo };
    },
  },

  // Being stroked, in whatever he was doing when the hand came: sat, loafed, stood or curled up asleep (petted,
  // pettedLoaf, pettedStand, pettedSleep), so a hand on a lying cat doesn't sit him up. Where he's touched (ctx.spot):
  // under the chin his head tips back; on a cheek he rubs his face along the hand; on the head or the ears he pushes up
  // into it. None of it is a fixed sway: the head wanders on slow drifts, the lids squint and open, a slow blink now
  // and then, and he doesn't look at you while it's nice (gl/room-beasts.js has him glance round now and then).
  petted: pettedOn('sit', 1, 0.6, 'cat_purr_petted'),
  pettedLoaf: pettedOn('loaf', 0.7, 0.45, 'cat_purr_petted'),
  pettedStand: pettedOn('stand', 0.85, 0.65, 'cat_purr_tom'),
  pettedSleep: pettedOn('curl', 0.35, 0.12, 'cat_purr_soft'),
  // stroked down the back lying down: the back rises into the hand a little, the tail's tip curls
  archLoaf: {
    base: 'loaf', len: 0,
    sound: { bed: 'cat_purr_tom', gain: 0.8 },
    frame(R, t, ctx) {
      const pose = baseOf(R, 'loaf').pose, sd = (ctx.seed ?? 1) * 0.37, up = 0.5 + 0.5 * drift(t * 0.45, sd);
      pose.spine.lumbar = [pose.spine.lumbar[0] - 0.08 * up, 0, 0];
      pose.root.at = [pose.root.at[0], pose.root.at[1] + 0.01 * up, pose.root.at[2]];
      const mo = idle(t, ctx, 0.5);
      mo.head = [0.08 * drift(t * 0.3, sd + 2), 0.25 * drift(t * 0.2, sd + 5), 0];
      mo.lids = Math.max(mo.lids, 0.55 + 0.3 * up);
      moodEars(mo, 'content', 0.9);
      mo.tailFlick = 0.25 * drift(t * 0.9, sd + 7);
      return { pose, mo };
    },
  },
  // stroked down the back: up on his legs with the back arched into the hand, the tail straight up, purring
  arch: {
    base: 'stand', len: 4,
    sound: { bed: 'cat_purr_tom', gain: 0.9 },
    frame(R, t, ctx) {
      const pose = baseOf(R, 'stand').pose, at = pose.root.at, ph = t / 4 * Math.PI * 2, up = 0.5 + 0.5 * Math.sin(ph);
      pose.root.at = [at[0], at[1] + 0.025 * up, at[2]];
      pose.root.rot = [0.06 - 0.06 * up, 0, 0];
      pose.spine.lumbar = [-0.16 * up, 0, 0];
      pose.spine.chest = [-0.06 * up, 0, 0];
      pose.tail = tailUp(R);
      const mo = idle(t, ctx, 0.7);
      mo.head = [0.12 * up, mo.head[1] * 0.3, 0];
      mo.lids = Math.max(mo.lids, 0.6);
      moodEars(mo, 'content', 0.9);
      return { pose, mo };
    },
  },
  // touched where he doesn't care for it (the tail, a paw): he looks round at the hand, ears out sideways, the tail
  // lashing, a short complaint
  bothered: {
    base: 'sit', len: 3,
    sound: { calls: [{ keys: ['cat_meow_grumpy', 'cat_meow_cross'], at: 0.5, gain: 0.5, p: 0.6 }] },
    frame(R, t, ctx) {
      const pose = baseOf(R, 'sit').pose, side = ctx.side || ((ctx.seed ?? 1) % 2 ? 1 : -1), k = smooth(0, 0.35, t);
      pose.spine.neck = [pose.spine.neck[0], side * 0.5 * k, 0];
      const mo = idle(t, ctx, 1);
      mo.head = [0.1 * k, side * 0.7 * k, 0];
      moodEars(mo, 'airplane', k);
      mo.pupil = 0.8;
      mo.whiskers = -0.5 * k;
      mo.tailFlick = Math.sin(t * 7) * 1.1 * k; mo.tailSway = Math.sin(t * 3) * 0.7 * k;
      return { pose, mo };
    },
  },

  // enough: ears flat sideways, tail lashing, a growl, then a swipe
  cross: {
    base: 'sit', len: 2.6, once: true,
    sound: { calls: [{ keys: ['cat_growl', 'cat_growl_hiss', 'cat_hiss', 'cat_hiss_b'], at: 0.2, gain: 0.8 }] },
    frame(R, t, ctx) {
      const b = baseOf(R, 'sit'), pose = b.pose, k = smooth(0, 0.3, t), sw = hold(t, 1.5, 2.1, 0.12);
      const p = pose.legs.RF.paw, to = add3(b.mouth, [-0.04, 0, 0.12]);
      pose.legs.RF = { ...pose.legs.RF, paw: [lerp(p[0], to[0], sw), lerp(p[1], to[1], sw), lerp(p[2], to[2], sw)], fwd: unit([0.3, 0.3 * sw, 1]) };
      pose.root.rot = [pose.root.rot[0] + 0.1 * k, 0, 0];
      const mo = idle(t, ctx, 1);
      mo.head = [0.15 * k, 0, 0];
      moodEars(mo, 'rotated', k);
      mo.pupil = 0.95;
      mo.lids = 0.15;
      mo.whiskers = -0.8 * k;
      mo.tailFlick = Math.sin(t * 9) * 1.2 * k; mo.tailSway = Math.sin(t * 4) * 0.8 * k;
      return { pose, mo };
    },
  },

  // a jump up onto something or down off it, in three parts the player drives (gl/room-beasts.js moves the cat along the
  // arc): `ctx.leap` = { part: 'crouch' | 'fly' | 'land', s (0..1 through the part), up (true going up) }. Going up he
  // measures it first: low on the haunches, eyes on the top, the bum wiggling; then the hind legs fire, the forelegs reach
  // for the edge, and the hinds tuck as he lands. Going down the front end leads: chest low over the edge, forelegs out
  // and down, landing on them first.
  leap: {
    base: 'stand', len: 0,
    sound: { calls: [{ keys: ['cat_jump'], at: 0.45, gain: 0.55, p: 0.6 }] },
    frame(R, t, ctx) {
      const pose = baseOf(R, 'stand').pose, L = ctx.leap || { part: 'crouch', s: 0, up: true }, up = L.up !== false, s = clamp(L.s ?? 0);
      const mo = idle(t, ctx, 1);
      const at = pose.root.at, legs = pose.legs;
      const shift = (k, dx, dy, dz) => { const p = legs[k].paw; legs[k].paw = [p[0] + dx, p[1] + dy, p[2] + dz]; };
      if (L.part === 'crouch') {
        const c = smooth(0, 0.35, s), wig = up ? hold(s, 0.35, 0.9, 0.12) : 0;
        pose.root.at = [at[0] + Math.sin(t * 24) * 0.014 * wig, at[1] - (up ? 0.075 : 0.05) * c, at[2] - (up ? 0.02 : -0.03) * c];
        pose.root.rot = [(up ? -0.2 : 0.3) * c, Math.sin(t * 24) * 0.06 * wig, 0];
        pose.spine.neck = [(up ? -0.35 : 0.45) * c, 0, 0];
        if (!up) { shift('LF', 0, 0, 0.06 * c); shift('RF', 0, 0, 0.06 * c); }
        else { shift('LF', 0, 0, -0.02 * c); shift('RF', 0, 0, -0.02 * c); }
        mo.head = [(up ? -0.3 : 0.35) * c, 0, 0];
        mo.ears = [[0, -0.25 * c, 0], [0, -0.25 * c, 0]];
        mo.pupil = lerp(0.45, 1, c);
        mo.lids = 0;
        mo.tailFlick = Math.sin(t * 9) * 0.6 * wig;
      } else if (L.part === 'fly') {
        // stretched out over the gap: the forelegs reaching, the hinds trailing, then gathering under
        const reach = Math.sin(Math.PI * Math.min(1, s * 1.4)), tuck = smooth(0.55, 1, s);
        const pitch = up ? lerp(-0.42, 0.05, s) : lerp(0.15, 0.45, s);
        pose.root.rot = [pitch, 0, 0];
        pose.root.at = [at[0], at[1] + 0.04, at[2]];
        pose.spine.lumbar = [-0.12 * reach, 0, 0];
        pose.spine.neck = [up ? -0.2 : 0.3, 0, 0];
        for (const k of ['LF', 'RF']) { shift(k, 0, 0.09 * reach + 0.02 * tuck, 0.13 * reach); legs[k].fwd = unit([0, -0.5 * reach, 1]); }
        for (const k of ['LH', 'RH']) { shift(k, 0, 0.07 * (1 - tuck) + 0.05 * tuck, -0.14 * (1 - tuck) + 0.02 * tuck); legs[k].fwd = unit([0, -0.8 * (1 - tuck), 1]); }
        mo.head = [up ? -0.15 : 0.25, 0, 0];
        mo.ears = [[0, 0.15, 0.1], [0, 0.15, 0.1]];
        mo.pupil = 1; mo.lids = 0;
        mo.whiskers = 0.8;
      } else {
        // the landing: the weight comes down through the legs and is let go
        const g = 1 - smooth(0, 1, s), lead = up ? 0 : 1;
        pose.root.at = [at[0], at[1] - 0.06 * g, at[2]];
        pose.root.rot = [(lead ? 0.22 : 0.06) * g, 0, 0];
        pose.spine.neck = [0.2 * g, 0, 0];
        if (lead) { shift('LF', 0, 0, 0.04 * g); shift('RF', 0, 0, 0.04 * g); }
        mo.head = [0.12 * g, 0, 0];
        mo.pupil = lerp(0.5, 0.9, g);
      }
      mo.tailSway *= 0.2;
      return { pose, mo };
    },
  },

  // eating from a dish on the floor: crouched over it, the head down, biting at the biscuits, every so often the head
  // tipped to one side to crunch with the back teeth
  eat: {
    base: 'stand', len: 0,
    sound: { bed: 'cat_eat_dry', gain: 0.85 },
    frame(R, t, ctx) {
      const pose = baseOf(R, 'stand').pose, at = pose.root.at, side = (ctx.seed ?? 1) % 2 ? 1 : -1;
      // a crunch every few seconds: the head comes up a little and tips
      const cyc = (t + (ctx.seed ?? 1) * 0.37) % 4.2, crunch = hold(cyc, 2.6, 3.9, 0.25), bite = Math.max(0, Math.sin(t * Math.PI * 2 * 2.2)) * (1 - crunch);
      // (the mouth comes down about 5 cm off the floor and 10 cm ahead of the forepaws: into a dish, not onto his feet;
      // gl/room-beasts.js stands him BOWL_REACH behind it)
      pose.root.at = [at[0], at[1] - 0.07, at[2]];
      pose.root.rot = [0.14, 0, 0];
      pose.spine.chest = [0.2, 0, 0];
      pose.spine.neck = [0.45 - 0.2 * crunch, 0, 0];
      for (const k of ['LF', 'RF']) { const p = pose.legs[k].paw; pose.legs[k].paw = [p[0] * 1.15, p[1], p[2]]; }
      const mo = idle(t, ctx, 0.85);
      mo.head = [0.25 + 0.07 * bite - 0.12 * crunch, 0.05 * side * crunch, 0.35 * side * crunch];
      mo.ears = [[0, 0.15, 0], [0, 0.15, 0]];
      mo.lids = Math.max(mo.lids, 0.35);
      mo.tailSway *= 0.25; mo.tailFlick *= 0.3;
      return { pose, mo };
    },
  },
  // drinking: lower still, the tongue lapping fast (a cat laps about four times a second), eyes half shut
  drink: {
    base: 'stand', len: 0,
    sound: { bed: 'cat_lap', gain: 0.8 },
    frame(R, t, ctx) {
      const pose = baseOf(R, 'stand').pose, at = pose.root.at;
      const lap = Math.sin(t * Math.PI * 2 * 3.8), pause = hold((t + (ctx.seed ?? 1)) % 7, 5.2, 6.8, 0.3);
      pose.root.at = [at[0], at[1] - 0.09, at[2]];
      pose.root.rot = [0.2, 0, 0];
      pose.spine.chest = [0.15, 0, 0];
      pose.spine.neck = [0.4 - 0.25 * pause, 0, 0];
      for (const k of ['LF', 'RF']) { const p = pose.legs[k].paw; pose.legs[k].paw = [p[0] * 1.2, p[1], p[2]]; }
      const mo = idle(t, ctx, 0.7);
      mo.head = [0.32 + 0.03 * lap * (1 - pause) - 0.2 * pause, 0, 0];
      mo.lids = Math.max(mo.lids, 0.5 * (1 - pause));
      mo.ears = [[0, 0.1, 0], [0, 0.1, 0]];
      mo.tailSway *= 0.2; mo.tailFlick *= 0.3;
      return { pose, mo };
    },
  },

  // the night yowl, head up
  yowl: {
    base: 'sit', len: 4,
    sound: { calls: [{ keys: ['cat_yowl', 'cat_yowl_tom', 'cat_meow_old'], at: 0.6, gain: 0.8 }] },
    frame(R, t, ctx) {
      const pose = baseOf(R, 'sit').pose, k = hold(t, 0.3, 3.6, 0.4);
      const mo = idle(t, ctx, 1);
      mo.head = [-0.4 * k, mo.head[1] * 0.3, 0];
      mo.ears = [[0, 0.2 * k, 0], [0, 0.2 * k, 0]];
      mo.pupil = 0.9;
      return { pose, mo };
    },
  },
};
export const CLIP_NAMES = Object.keys(CAT_CLIPS);

/** The frame of `name` at `t` seconds: { pose, mo, base }. A looping clip wraps, a one-shot holds its end. */
export function clipFrame(R, name, t, ctx = {}) {
  const c = CAT_CLIPS[name] || CAT_CLIPS.sit;
  const tt = c.len ? (c.once ? Math.min(t, c.len) : ((t % c.len) + c.len) % c.len) : t;
  const f = c.frame(R, tt, ctx);
  // sat or lying, the tail is on the floor round him: only its tip works, lifted clear, or it goes through the floor
  if (c.base !== 'stand') {
    f.mo.tailSway *= 0.35; f.mo.tailFlick *= 0.35;
    f.mo.tailLift = Math.max(f.mo.tailLift || 0, Math.abs(f.mo.tailFlick) * 0.5);
  }
  f.mo._t = t;
  return { ...f, base: c.base };
}
export { rnd as clipRnd };
