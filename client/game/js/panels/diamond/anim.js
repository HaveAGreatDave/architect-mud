// DEADBALL · THE CLIP PLAYER. A player's motion: clips keyed in the rig's pose language, played back
// with the layers that keep him in contact with the game.
//
// A clip is a run of poses (diamond/rig.js POSES is the language) at times, with the moments the
// director waits on (the ball leaves the hand, the bat meets it, the glove takes it, the umpire's
// call) and the stretches a foot is planted. The library is content, one file a clip under
// content/animation_clips/ (diamond/clip-schema.js says what a file may hold), baked to
// diamond/clips.js by scripts/shapes/bake-clips.mjs, which also fills in what a key leaves out
// (`completePose`) so that playback only interpolates.
//
//   · sampling (`sampleClip`): every number in a pose runs on a Catmull-Rom curve through the keys,
//     so a joint's speed carries smoothly through each one; a clip starts and ends at rest unless
//     it says it's `moving` at that end (a run that goes on into a slide), and a loop runs on
//     round its end; directions are put back to unit length; a bat is held between
//     two keys that both have it, and taken up or let go at a key, the hands handed over smoothly
//     (`batHandoff`);
//   · plants: while a foot is planted it's held where it was put down, on the ground, so nothing
//     slides; a foot coming down meets the ground where it really is (`ground`), easing onto its
//     spot and off it; and where a planted foot is out of its leg's reach the pelvis drops until
//     it isn't (`fitPlants`), so the pitcher's drive off the rubber sinks him onto the back leg
//     instead of dragging the foot;
//   · root motion: a clip that travels (a run, a dive, a slide) carries its frame's path, `root`,
//     and is keyed in the moving frame; its planted feet are held where they landed on the ground
//     (`rootAt`), and `rebase` says a pose in another frame, for a crossfade between two clips
//     whose frames have moved apart;
//   · his own way of doing it (`vary`, off his name: the leg kick, the stance), and a left-hander's
//     mirror, are part of the sample; his arm slot is which delivery he's played;
//   · layers over a sampled pose, in the pose's real frame: `reach` brings a hand to a point (the
//     glove to the ball), the body following where the arm alone can't get there; `lookAt` turns
//     the neck and head toward one;
//   · `mixPose` mixes two sampled poses, for a crossfade from one clip into the next.
//
// `JOINT_LIMITS` and `limitBreaks` say what a body can do; the bake holds every key to them and
// anim-smoke every frame.
//
// Pure: no WebGL and no DOM, so the gates run it. Times are seconds; places are feet in the pose's
// own frame (x to the player's left, y up, z his forward), placed in the park by `at` and `yaw`.

import { solvePose, solveTorso, solveHips, mirrorPose, scalePose } from './rig.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp = (a, b, t) => a + (b - a) * t;
const r4 = (v) => Math.round(v * 1e4) / 1e4 || 0;
const DEG = 180 / Math.PI;
const angle = (a, b) => Math.acos(clamp((a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / ((len(a) * len(b)) || 1), -1, 1)) * DEG;
const copy = (v) => JSON.parse(JSON.stringify(v));
function hashStr(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

// ── the pose's fields ──────────────────────────────────────────────────────────
// What a pose holds and how each part plays back: points move, directions turn (and are put back to
// unit length), angles in degrees move, flags step.
export const POINTS = Object.freeze(['pelvis', 'wrL', 'wrR']);
export const ANGLES3 = Object.freeze(['spine', 'chest', 'neck', 'head']);
export const ANGLES = Object.freeze(['pitch', 'twist', 'roll']);
export const DIRS = Object.freeze(['toeL', 'toeR', 'kneeL', 'kneeR', 'elbL', 'elbR', 'handL', 'handR', 'palmL', 'palmR']);
export const FEET = Object.freeze(['L', 'R']);
// The height of an ankle off the ground under it, by the rig's scale (solvePose puts a planted
// ankle there), and the lengths of a leg and an arm, hip to ankle and shoulder to wrist.
export const ANKLE_UP = 0.28;
const LEG = 1.55 + 1.50, ARM = 0.98 + 0.90;
// A foot flat on the ground: its toe (0.62 ft out from the ankle) 0.07 ft up, where solvePose puts
// a planted toe. `flatToe` lays a toe's direction down to that, keeping the way it points.
const TOE_LEN = 0.62, TOE_UP = 0.07;
export function flatToe(d, drop = (ANKLE_UP - TOE_UP) / TOE_LEN) {
  const h = Math.hypot(d[0], d[2]), k = Math.sqrt(Math.max(0, 1 - drop * drop));
  return h < 1e-6 ? [0, -drop, k] : [d[0] / h * k, -drop, d[2] / h * k];
}

// A pose with nothing left out, so two keys can always be mixed: the solver's own defaults for the
// angles and the knees, elbows and toes, a planted foot's toe flat on the ground, every direction
// at unit length, and the hand and palm
// worked out by solving where a key leaves them to the solver. A key with a bat also gets the
// wrists the bat puts its hands at, so a key without the bat can take over from there. The bake
// runs this on every key.
export function completePose(P) {
  const out = copy(P);
  for (const k of ANGLES3) out[k] = out[k] ? [0, 1, 2].map((i) => out[k][i] || 0) : [0, 0, 0];
  for (const k of ANGLES) out[k] = out[k] || 0;
  for (const S of FEET) {
    const sg = S === 'L' ? 1 : -1;
    out['knee' + S] = out['knee' + S] || [0, 0, 1];
    out['elb' + S] = out['elb' + S] || [sg * 0.4, -0.2, -1];
    out['toe' + S] = out['toe' + S] || [0, 0, 1];
    out['plant' + S] = out['plant' + S] !== false;
    // a foot on the ground lies flat on it, as solvePose would put it, so a curve through this key
    // and a plant on it agree
    if (out['plant' + S] && out['ank' + S].length === 2) out['toe' + S] = flatToe(out['toe' + S]);
  }
  if (out.bat) out.bat = { knob: out.bat.knob.slice(), dir: norm(out.bat.dir).map(r4), bottom: out.bat.bottom || 'L', ...(out.bat.one ? { one: true } : {}) };
  if (out.bat || FEET.some((S) => !out['hand' + S] || !out['palm' + S])) {
    const { J } = solvePose({ ...out, at: [0, 0, 0], yaw: 0 });
    for (const S of FEET) {
      if (J['grip' + S]) {
        // a hand on the bat: the way it would point and turn if it let go
        out['wr' + S] = J['wr' + S].map(r4);
        out['hand' + S] = out['hand' + S] || norm(sub(J['wr' + S], J['el' + S])).map(r4);
        out['palm' + S] = out['palm' + S] || [S === 'L' ? -1 : 1, 0, 0];
      } else {
        out['hand' + S] = out['hand' + S] || J['hdir' + S].map(r4);
        out['palm' + S] = out['palm' + S] || J['palm' + S].map(r4);
      }
    }
  }
  for (const k of DIRS) out[k] = norm(out[k]).map(r4);
  return out;
}

// A planted ankle as a point: [x, z] on the ground becomes [x, y, z] at the ground's height there
// (`ground(x, z)` is the ground in the pose's own frame; flat at 0 unless the director says).
const flatGround = () => 0;
const ankle3 = (a, ground, s) => (a.length === 2 ? [a[0], ground(a[0], a[1]) + ANKLE_UP * s, a[1]] : a.slice());

// Catmull-Rom through four values at times t0..t3, at u in [0, 1] between t1 and t2. Non-uniform:
// a key's slope is its neighbours' over the time between them, times (1 - its tension): a key's
// `tension` (Kochanek-Bartels; 0 if it has none) below 0 carries the motion through it faster, as a
// throwing hand goes through the release, and 1 stops it there. A missing neighbour (null) is the
// end of a clip, where the slope is zero, so a clip comes to rest at its ends; at an end the clip
// says it's moving through (`ends`, from `movingEnds`) the slope is the segment's own, so the
// motion goes on at the speed it has.
function cr(p0, p1, p2, p3, t0, t1, t2, t3, u, k1 = 1, k2 = 1, ends = NO_ENDS) {
  const dt = t2 - t1 || 1e-6;
  const m1 = p0 === null ? (ends.start ? p2 - p1 : 0) : (p2 - p0) / (t2 - t0) * dt * k1;
  const m2 = p3 === null ? (ends.end ? p2 - p1 : 0) : (p3 - p1) / (t3 - t1) * dt * k2;
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * p1 + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * p2 + (u3 - u2) * m2;
}

// Which ends of a clip it's moving through (`moving`: 'start', 'end' or 'both'); a loop has none.
const NO_ENDS = Object.freeze({ start: false, end: false });
export const movingEnds = (clip) => (clip.loop || !clip.moving ? NO_ENDS : { start: clip.moving !== 'end', end: clip.moving !== 'start' });

// The keys either side of `t`, and the two beyond them for the slopes: null past a clip's ends, and
// round the end of a loop, whose last key is its first again.
function bracket(clip, t) {
  const keys = clip.keys, n = keys.length;
  let i = 0;
  while (i < n - 2 && keys[i + 1].t <= t) i++;
  const k1 = keys[i], k2 = keys[i + 1];
  const beyond = (j) => {
    if (j >= 0 && j < n) return keys[j];
    if (!clip.loop) return null;
    const k = j < 0 ? keys[j + n - 1] : keys[j - n + 1];
    return { ...k, t: k.t + (j < 0 ? -clip.duration : clip.duration) };
  };
  const u = k2.t > k1.t ? clamp((t - k1.t) / (k2.t - k1.t), 0, 1) : 0;
  return { k0: beyond(i - 1), k1, k2, k3: beyond(i + 2), u };
}

// ── root motion ────────────────────────────────────────────────────────────────
// A clip that travels (a run, a dive, a slide) carries `root`: where its own frame has got to,
// keyed at times like the poses, `{ t, at: [x, z], yaw }` in the frame the clip started in, so
// its first key is at [0, 0] facing 0. Its poses are keyed in the moving frame, and a planted foot
// is held where it landed on the ground, so the frame moves on and the foot stays put. A loop's
// frame carries on from where its last lap ended (its laps run straight: its last key faces 0).
//
// The frame moves on a cubic through the keys, each key's speed its neighbours' as for the poses
// but carried on through the ends rather than stopped, so a slide starts at the speed of the run
// that went into it. `rootAt(clip, t)` is the frame at clip time t, from the clip's start: `at`
// on the ground and `yaw` in degrees, turning as a pose's `yaw` does. A left-hander's is the
// mirror (`mirror`).
const rootYaw = (k) => k.yaw || 0;
function rootLap(clip, t) {
  const R = clip.root, n = R.length, D = clip.duration, lap = R[n - 1].at;
  // the keys beyond the ends: a loop's from the laps either side, anything else on the same line
  const beyond = (j) => {
    if (j >= 0 && j < n) return { t: R[j].t, x: R[j].at[0], z: R[j].at[1], y: rootYaw(R[j]) };
    if (!clip.loop) return null;
    const k = j < 0 ? R[j + n - 1] : R[j - n + 1], sg = j < 0 ? -1 : 1;
    return { t: k.t + sg * D, x: k.at[0] + sg * lap[0], z: k.at[1] + sg * lap[1], y: rootYaw(k) };
  };
  let i = 0;
  while (i < n - 2 && R[i + 1].t <= t) i++;
  const a = beyond(i), b = beyond(i + 1), p = beyond(i - 1), q = beyond(i + 2);
  const dt = b.t - a.t || 1e-6, u = clamp((t - a.t) / dt, 0, 1);
  const at = (f) => {
    // at a key, its neighbours' slope; at an end with nothing beyond, the segment's own
    const y0 = f(a), y1 = f(b);
    const m0 = p ? (y1 - f(p)) / (b.t - p.t) : (y1 - y0) / dt, m1 = q ? (f(q) - y0) / (q.t - a.t) : (y1 - y0) / dt;
    const u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * y0 + (u3 - 2 * u2 + u) * m0 * dt + (-2 * u3 + 3 * u2) * y1 + (u3 - u2) * m1 * dt;
  };
  return { at: [at((k) => k.x), at((k) => k.z)], yaw: at((k) => k.y) };
}
export function rootAt(clip, t, opts = {}) {
  if (!clip.root || !clip.root.length) return { at: [0, 0], yaw: 0 };
  let r;
  if (clip.loop) {
    const D = clip.duration, laps = Math.floor(t / D), lap = clip.root[clip.root.length - 1].at;
    const w = rootLap(clip, t - laps * D);
    r = { at: [w.at[0] + laps * lap[0], w.at[1] + laps * lap[1]], yaw: w.yaw };
  } else r = rootLap(clip, clamp(t, 0, clip.duration));
  return opts.mirror ? { at: [-r.at[0], r.at[1]], yaw: -r.yaw } : r;
}
// A frame's point and turn: the point q in frame F (`{ at: [x, z], yaw }`) where it is in the
// frame F stands in, and back.
const turnY = (v, deg) => { const c = Math.cos(deg / DEG), s = Math.sin(deg / DEG); return [c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]]; };
const outOf = (F, q) => { const r = turnY(q, F.yaw); return [r[0] + F.at[0], r[1], r[2] + F.at[1]]; };
const into = (F, p) => turnY([p[0] - F.at[0], p[1], p[2] - F.at[1]], -F.yaw);
// A pose keyed in one frame, said in another: `rel` is the first frame as the second sees it
// (`{ at: [x, z], y, yaw }`, `y` how much higher the first stands). Points move and turn,
// directions turn, the pelvis's twist takes the turn, and everything above the pelvis rides it. A
// crossfade between two clips whose frames have moved apart mixes them in one frame: a pitcher's
// frame is on the rubber and the one he fields from is on the grass.
export function rebase(P, rel) {
  const dy = (rel && rel.y) || 0;
  if (!rel || (!rel.yaw && !rel.at[0] && !rel.at[1] && !dy)) return P;
  const up = (q) => (dy ? [q[0], q[1] + dy, q[2]] : q);
  const out = { ...P, twist: (P.twist || 0) + rel.yaw };
  for (const k of POINTS) out[k] = up(outOf(rel, P[k]));
  for (const S of FEET) {
    const a = P['ank' + S];
    if (a.length === 2) { const q = outOf(rel, [a[0], 0, a[1]]); out['ank' + S] = [q[0], q[2]]; } else out['ank' + S] = up(outOf(rel, a));
  }
  for (const k of DIRS) out[k] = turnY(P[k], rel.yaw);
  if (P.bat) out.bat = { ...P.bat, knob: up(outOf(rel, P.bat.knob)), dir: turnY(P.bat.dir, rel.yaw) };
  return out;
}

// How firmly a foot is held at `t`: 1 through a plant, easing in over the plant's `ease` (PLANT_EASE
// unless it says) before it and out over it after (less where the clip's end or the same foot's
// next plant is nearer), so a foot glides onto and off its spot and the pelvis follows smoothly. A
// run's stance is shorter than that, and its keys already have the foot going back with the ground,
// so its plants ease over a few hundredths.
export const PLANT_EASE = 0.1;
export const easeOf = (p) => (Number.isFinite(p.ease) ? p.ease : PLANT_EASE);
// Each foot's plants, sorted out once a clip: a clip doesn't change (the Pose Lab bakes a new one
// for every edit).
const FOOT_PLANTS = new WeakMap();
function plantsOf(clip, S) {
  let m = FOOT_PLANTS.get(clip);
  if (!m) {
    const all = clip.plants || [];
    FOOT_PLANTS.set(clip, (m = { L: all.filter((p) => p.foot === 'L'), R: all.filter((p) => p.foot === 'R') }));
  }
  return m[S] || [];
}
function holdOf(clip, S, t) {
  let best = { w: 0, p: null };
  const mine = plantsOf(clip, S);
  for (let i = 0; i < mine.length; i++) {
    const p = mine[i], prev = mine[i - 1], next = mine[i + 1];
    const e = Math.min(easeOf(p), Math.max(0, p.from), prev ? (p.from - prev.to) / 2 : Infinity);
    const f = Math.min(easeOf(p), Math.max(0, clip.duration - p.to), next ? (next.from - p.to) / 2 : Infinity);
    let w = 0;
    if (t >= p.from && t <= p.to) w = 1;
    else if (t < p.from && e > 0 && t > p.from - e) w = 1 - (p.from - t) / e;
    else if (t > p.to && f > 0 && t < p.to + f) w = 1 - (t - p.to) / f;
    w = w * w * (3 - 2 * w);
    if (w > best.w) best = { w, p };
  }
  return best;
}

// The pose a clip holds at `t` (seconds from its start; held at its ends, or round again for a
// loop). Options:
//   · `ground(x, z)`, the ground's height in the pose's real frame (the director's: a pitcher's
//     mound falls away under his stride); flat at 0 if not given;
//   · `scale`, the player's size;
//   · `traits`, his own way of doing it (`traitsOf`), applied by the clip's role;
//   · `mirror`, for a left-hander: the clips are keyed right-handed and he does it in a mirror.
//     `ground` is still the real one; the sample works out which side is which.
export function sampleClip(clip, t, opts = {}) {
  const s = opts.scale || 1, real = opts.ground || flatGround, mirror = !!opts.mirror;
  const ground = mirror ? (x, z) => real(-x, z) : real;
  t = clip.loop ? ((t % clip.duration) + clip.duration) % clip.duration : clamp(t, 0, clip.duration);
  const run = (tt) => {
    const holds = {}, here = clip.root ? rootAt(clip, tt) : null;
    let P = planted(clip, curve(clip, tt, ground, s), tt, ground, s, holds, here);
    if (opts.traits) P = vary(P, opts.traits, clip.role, here);
    return fitPlants(P, ground, s, holds);
  };
  const P = batHandoff(clip, t, run(t), run, s);
  return mirror ? mirrorPose(P) : P;
}

// A bat let go at a key, or taken up at one: the hands' own curve, between that key and the next
// (or the one before), starts where the bat had the wrists in this very sample and going as fast,
// and eases onto the keys' over the segment. Without it the hands would jump, because the bat
// puts them by where the chest really is (after the plants are fitted and the player's own way is
// done), and the key only knows where it was keyed.
const BAT_EPS = 1e-4;
function batHandoff(clip, t, P, run, s) {
  if (clip.keys.length < 2) return P;
  const { k1, k2, u } = bracket(clip, t);
  const release = k1.pose.bat && !k2.pose.bat && u > 0, pickup = !k1.pose.bat && k2.pose.bat && u < 1;
  if (!release && !pickup) return P;
  const k = release ? k1 : k2, side = release ? -1 : 1, dt = k2.t - k1.t;
  // the wrists the bat gives at the key and just to its bat side, and the hands' curve at the key
  // and just to the other side
  const wr = (Q) => { const { J } = solvePose({ ...Q, at: [0, 0, 0], yaw: 0, scale: s }); return { L: J.wrL, R: J.wrR }; };
  const atBat = wr(run(k.t)), nearBat = wr(run(k.t + side * BAT_EPS));
  const cur = run(k.t - side * BAT_EPS), here = run(k.t);
  // `here` has the bat in it, so the curve's own wrists at the key are the key's, taken off the curve
  const curveAt = { L: here.wrL, R: here.wrR }, curveNear = { L: cur.wrL, R: cur.wrR };
  const h = release ? u : 1 - u, h00 = 2 * h * h * h - 3 * h * h + 1, h10 = h * h * h - 2 * h * h + h;
  const out = { ...P };
  for (const S of FEET) {
    const d = [0, 1, 2].map((i) => atBat[S][i] - curveAt[S][i]);
    // how much faster the bat moves the wrist than the curve does, along the segment's way
    const dv = [0, 1, 2].map((i) => ((nearBat[S][i] - atBat[S][i]) + (curveNear[S][i] - curveAt[S][i])) / (side * BAT_EPS));
    out['wr' + S] = [0, 1, 2].map((i) => P['wr' + S][i] + d[i] * h00 + dv[i] * dt * h10 * (release ? 1 : -1));
    // the solver keeps a free hand off the body (rig.js HULL) by other means than a hand on a bat,
    // so its push comes in as the bat's hold goes out: at the key the hand is where the bat had it
    out['clear' + S] = 1 - h00;
  }
  return out;
}

// The keys' curves alone, before the plants hold the feet. The keys are for the rig at scale 1, so
// a man of scale `s` does them `s` times the size about the frame's origin (rig.js scalePose): the
// pelvis, the wrists, the ankles and the bat's knob. The root's path isn't scaled, so a stride is as
// long on anyone and every plan worked out from it (rootAt) holds at any height.
const VEC3 = Object.freeze([...POINTS, ...ANGLES3]);
function curve(clip, t, ground, s) {
  const keys = clip.keys;
  if (keys.length === 1) {
    const P = scalePose(copy(keys[0].pose), s);
    for (const S of FEET) { P['ank' + S] = ankle3(P['ank' + S], ground, s); P['plant' + S] = false; }
    return P;
  }
  const { k0, k1, k2, k3, u } = bracket(clip, t);
  const a = k1.pose, b = k2.pose, z = k0 ? k0.pose : null, y = k3 ? k3.pose : null;
  const t0 = k0 ? k0.t : 0, t1 = k1.t, t2 = k2.t, t3 = k3 ? k3.t : 0, q1 = 1 - (k1.tension || 0), q2 = 1 - (k2.tension || 0), ends = movingEnds(clip);
  // a number through the keys (the ones either side of the two may be past an end), and three.
  // Every sample of every body runs through here, so it makes no closure or array a number.
  const at4 = (p0, p1, p2, p3) => cr(p0, p1, p2, p3, t0, t1, t2, t3, u, q1, q2, ends);
  const vec = (A, B, Z, Y) => [at4(Z ? Z[0] : null, A[0], B[0], Y ? Y[0] : null), at4(Z ? Z[1] : null, A[1], B[1], Y ? Y[1] : null), at4(Z ? Z[2] : null, A[2], B[2], Y ? Y[2] : null)];
  const ank = s === 1 ? (q) => (q.length === 2 ? [q[0], ground(q[0], q[1]) + ANKLE_UP, q[1]] : q)
    : (q) => (q.length === 2 ? [q[0] * s, ground(q[0] * s, q[1] * s) + ANKLE_UP * s, q[1] * s] : [q[0] * s, q[1] * s, q[2] * s]);
  const P = {};
  for (const k of ANGLES) P[k] = at4(z ? z[k] : null, a[k], b[k], y ? y[k] : null);
  for (const k of VEC3) P[k] = vec(a[k], b[k], z && z[k], y && y[k]);
  // the points are linear in the keys, so scaling the curve is scaling the keys
  if (s !== 1) for (const k of POINTS) P[k] = [P[k][0] * s, P[k][1] * s, P[k][2] * s];
  for (const k of DIRS) P[k] = norm(vec(a[k], b[k], z && z[k], y && y[k]));
  for (const S of FEET) {
    const k = 'ank' + S;
    P[k] = vec(ank(a[k]), ank(b[k]), z && ank(z[k]), y && ank(y[k]));
    // planted only while a plant holds it (`planted`): a key's flag is for a still
    P['plant' + S] = false;
  }
  // the bat: between two keys that both have it, it moves; otherwise it's in the hands only at a
  // key that has it, so it's taken up or let go there, where the wrists already are
  if (a.bat && b.bat) {
    P.bat = {
      knob: [0, 1, 2].map((i) => cr(k0 ? (k0.pose.bat || a.bat).knob[i] : null, a.bat.knob[i], b.bat.knob[i], k3 ? (k3.pose.bat || b.bat).knob[i] : null, t0, k1.t, k2.t, t3, u, q1, q2, ends)),
      dir: norm([0, 1, 2].map((i) => cr(k0 ? (k0.pose.bat || a.bat).dir[i] : null, a.bat.dir[i], b.bat.dir[i], k3 ? (k3.pose.bat || b.bat).dir[i] : null, t0, k1.t, k2.t, t3, u, q1, q2, ends))),
      bottom: a.bat.bottom || 'L',
      ...(a.bat.one ? { one: true } : {}),
    };
  } else if (a.bat && u <= 0) P.bat = copy(a.bat);
  else if (b.bat && u >= 1) P.bat = copy(b.bat);
  if (P.bat && s !== 1) P.bat.knob = P.bat.knob.map((x) => x * s);
  return P;
}

// The pelvis lowered (and, where lowering can't do it, moved toward the foot) until every held
// foot is inside its leg's reach, short of where the solver starts to soften it (rig.js IK_SOFT);
// the solver would otherwise lift a foot it can't reach off its spot. `holds` is how firmly each foot is held ({ L, R }, 0 to 1; by
// default a foot on the ground, [x, z], is held), and the move is in proportion, so it comes and
// goes as smoothly as the hold. The drop each foot needs is eased in where it starts (a soft ramp,
// FIT_SOFT feet wide) and the two feet's are taken together by a smooth maximum, so the pelvis
// never changes speed all at once. `ground` and `s` as for sampleClip.
const REACH = 0.975, FIT_SOFT = 0.03, FIT_P = 6;
const softRamp = (x) => (x > 20 * FIT_SOFT ? x : FIT_SOFT * Math.log1p(Math.exp(x / FIT_SOFT)));
export function fitPlants(P, ground = flatGround, s = 1, holds = null) {
  // the hips ride the pelvis, so they're worked out once and moved with it
  const J = solveHips({ ...P, at: [0, 0, 0], yaw: 0, scale: s });
  const reach = LEG * s * REACH, held = [];
  for (const S of FEET) {
    const a = P['ank' + S], w = holds ? holds[S] || 0 : a.length === 2 ? 1 : 0;
    if (w > 0) held.push({ an: ankle3(a, ground, s), hip: J['hip' + S], w });
  }
  if (!held.length) return P;
  // a foot further out along the ground than a leg can reach by sinking: the pelvis comes toward
  // it first (a key that asks this is wrong, and the gate says so)
  let mx = 0, mz = 0;
  for (const { an, hip, w } of held) {
    const h = Math.hypot(hip[0] + mx - an[0], hip[2] + mz - an[2]), over = h - reach * 0.97;
    if (over > 0) { mx += (an[0] - hip[0] - mx) / h * over * w; mz += (an[2] - hip[2] - mz) / h * over * w; }
  }
  // then down, by what the furthest foot needs
  let sum = 0;
  for (const { an, hip, w } of held) {
    const h = Math.hypot(hip[0] + mx - an[0], hip[2] + mz - an[2]), v = hip[1] - an[1];
    const need = v - Math.sqrt(Math.max(0, reach * reach - h * h));
    sum += Math.pow(softRamp(need) * w, FIT_P);
  }
  const my = -Math.pow(sum, 1 / FIT_P);
  return mx || my || mz ? { ...P, pelvis: [P.pelvis[0] + mx, P.pelvis[1] + my, P.pelvis[2] + mz] } : P;
}

// A planted foot held where it was put down, on the ground; a free one as the curve has it. Where
// each plant put its foot is worked out once a clip and kept beside it (the clips are shared and
// may be frozen, so not on it). A clip that travels keeps the spot in the frame it started in, so
// the foot stays where it landed as the frame moves on (rootAt).
const PLANTED = new WeakMap();
function planted(clip, P, t, ground, s, holds = {}, here = clip.root ? rootAt(clip, t) : null) {
  for (const S of FEET) {
    const { w, p } = holdOf(clip, S, t);
    holds[S] = w;
    if (!p) continue;
    let memo = PLANTED.get(clip);
    if (!memo) PLANTED.set(clip, (memo = new Map()));
    let landed = memo.get(p);
    if (!landed) {
      const q = curve(clip, p.from, ground, s)['ank' + S];
      if (clip.root) { const g = outOf(rootAt(clip, p.from), [q[0], 0, q[2]]); landed = [g[0], g[2]]; } else landed = [q[0], q[2]];
      memo.set(p, landed);
    }
    let at = landed;
    if (here) { const l = into(here, [landed[0], 0, landed[1]]); at = [l[0], l[2]]; }
    // on the spot, or easing on or off it: between where the curve has the foot and the spot, on
    // the ground, the toe coming down flat as it lands, onto the ground under the toe
    const gy = ground(at[0], at[1]), d = P['toe' + S], h = Math.hypot(d[0], d[2]) || 1;
    const tip = [at[0] + d[0] / h * TOE_LEN * s * 0.94, at[1] + d[2] / h * TOE_LEN * s * 0.94];
    const flat = flatToe(d, clamp((gy + ANKLE_UP * s - ground(tip[0], tip[1]) - TOE_UP) / (TOE_LEN * s), -0.9, 0.9));
    if (w >= 1) { P['ank' + S] = at.slice(); P['plant' + S] = true; P['toe' + S] = flat; continue; }
    const c = P['ank' + S], spot = [at[0], gy + ANKLE_UP * s, at[1]];
    P['ank' + S] = [c[0] + (spot[0] - c[0]) * w, c[1] + (spot[1] - c[1]) * w, c[2] + (spot[2] - c[2]) * w];
    P['toe' + S] = norm([0, 1, 2].map((i) => lerp(d[i], flat[i], w)));
  }
  return P;
}

// Two sampled poses mixed, `w` of the way from `a` to `b`: a crossfade from one clip into the next.
// A foot on the ground in both stays on it. A bat in only one of them changes hands halfway, so a
// crossfade shouldn't be where a bat comes or goes; a clip does that at a key. `opts` as for
// sampleClip (`ground`, `scale`).
// A man stood still is never quite still: he breathes, his weight drifts from foot to foot and he
// looks about. `breathe` lays that over any pose at world time t, at weight w, his own pace and
// phase off `seed` (his slot), so a call that describes nothing doesn't freeze the park. The feet
// are where the pose put them; only the pelvis, torso, head and (without a bat) the wrists move.
export function breathe(P, t, seed = 0, w = 1) {
  if (w <= 0) return P;
  const h = hashStr('idle:' + seed), ph = (k) => ((h >>> (k * 4)) & 15) / 16 * Math.PI * 2;
  const pace = 0.9 + ((h >>> 24) & 15) / 60;
  const breath = Math.sin(t * Math.PI * 2 / (3.6 * pace) + ph(0)) * w;
  const sway = Math.sin(t * Math.PI * 2 / (7.5 * pace) + ph(1)) * w;
  const look = Math.sin(t * Math.PI * 2 / (9.5 * pace) + ph(2)) * w;
  const out = { ...P };
  if (P.pelvis) out.pelvis = [P.pelvis[0] + 0.05 * sway, P.pelvis[1] + 0.02 * breath, P.pelvis[2]];
  const add3 = (k, d) => { const v = P[k] || [0, 0, 0]; out[k] = [(v[0] || 0) + d[0], (v[1] || 0) + d[1], (v[2] || 0) + d[2]]; };
  add3('chest', [1.4 * breath, 0, 1.2 * sway]);
  add3('neck', [0, 3 * look, 0]);
  add3('head', [0.8 * breath, 7 * look, 0]);
  if (!P.bat) for (const k of ['wrL', 'wrR']) if (P[k]) out[k] = [P[k][0], P[k][1] + 0.03 * breath, P[k][2]];
  return fidget(out, t, seed, w);
}

// Every so often a man stood about does something: looks round the park, stretches his back,
// rolls his shoulders, shakes his arms out or shifts onto one leg. One gesture of FIDGET_LEN
// seconds every FIDGET_EVERY or so, which one and when off his slot and the episode, so two men
// never do the same thing together and the same moment always draws the same.
const FIDGET_EVERY = 11, FIDGET_LEN = 2.8;
const FIDGETS = ['look', 'stretch', 'shrug', 'shake', 'shift', 'look'];
function fidget(P, t, seed, w) {
  const h = hashStr('fidget:' + seed), period = FIDGET_EVERY * (0.8 + ((h & 255) / 255) * 0.9);
  const sh = t + ((h >>> 8) & 1023) / 1023 * period, n = Math.floor(sh / period);
  const e = hashStr(`fidget:${seed}:${n}`);
  // where in the period it starts, so the gaps between gestures aren't even
  const start = ((e & 255) / 255) * (period - FIDGET_LEN), u = (sh - n * period - start) / FIDGET_LEN;
  if (u <= 0 || u >= 1) return P;
  const env = Math.sin(Math.PI * u) ** 2 * w, side = (e >>> 8) & 1 ? 1 : -1, kind = FIDGETS[((e >>> 9) & 255) % FIDGETS.length];
  const out = { ...P };
  const add3 = (k, d) => { const v = P[k] || [0, 0, 0]; out[k] = [(v[0] || 0) + d[0] * env, (v[1] || 0) + d[1] * env, (v[2] || 0) + d[2] * env]; };
  const wrists = (f) => { if (!P.bat) for (const [k, s] of [['wrL', -1], ['wrR', 1]]) if (P[k]) { const d = f(s); out[k] = [P[k][0] + d[0] * env, P[k][1] + d[1] * env, P[k][2] + d[2] * env]; } };
  if (kind === 'look') {
    // round to one side and back past the middle: the stands, the board, the sky
    const sweep = Math.sin(Math.PI * 2 * u) * 0.4 + side;
    add3('neck', [0, 14 * sweep, 0]); add3('head', [-6, 26 * sweep, 0]); add3('chest', [0, 6 * sweep, 0]);
  } else if (kind === 'stretch') {
    // leans back and twists, hands coming up
    add3('spine', [-8, 12 * side, 0]); add3('chest', [-6, 10 * side, 0]); add3('head', [-10, 0, 0]);
    wrists((s) => [0.05 * s, 0.25, 0]);
  } else if (kind === 'shrug') {
    const roll = Math.sin(Math.PI * 4 * u);
    add3('chest', [3 * roll, 0, 2 * roll]); add3('head', [-3 * roll, 0, 0]);
    wrists(() => [0, 0.07 * roll, 0]);
  } else if (kind === 'shake') {
    const jig = Math.sin(t * Math.PI * 2 * 3.2);
    wrists((s) => [0.04 * jig * s, 0.05 * jig, 0.03 * jig]);
    add3('chest', [0, 0, 1.5 * jig]);
  } else if (P.pelvis) {
    // onto one leg and back: the hip drops toward it and the shoulders level against it
    out.pelvis = [P.pelvis[0] + 0.14 * side * env, P.pelvis[1] - 0.03 * env, P.pelvis[2]];
    add3('spine', [0, 0, -4 * side]); add3('chest', [0, 0, 3 * side]);
  }
  return out;
}

// A foot planted in both clips of a mix on spots further apart than MIX_STEP feet is lifted across
// between them, up to MIX_LIFT feet at the middle of the mix (half the way it goes, if that's less).
const MIX_STEP = 0.12, MIX_LIFT = 0.3;
export function mixPose(a, b, w, opts = {}) {
  w = clamp(w, 0, 1);
  if (w <= 0) return a;
  if (w >= 1) return b;
  const ground = opts.ground || flatGround, s = opts.scale || 1;
  const P = {};
  for (const k of ANGLES) P[k] = lerp(a[k], b[k], w);
  for (const k of [...POINTS, ...ANGLES3]) P[k] = [0, 1, 2].map((i) => lerp(a[k][i], b[k][i], w));
  for (const k of DIRS) P[k] = norm([0, 1, 2].map((i) => lerp(a[k][i], b[k][i], w)));
  for (const S of FEET) {
    const pa = a['ank' + S], pb = b['ank' + S];
    const both = pa.length === 2 && pb.length === 2;
    // A foot each clip plants on a different spot steps across in a low arc rather than skating
    // along the grass between them; on the same spot, near enough, it stays planted.
    const apart = both ? Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) : 0;
    if (both && apart <= MIX_STEP * s) P['ank' + S] = [lerp(pa[0], pb[0], w), lerp(pa[1], pb[1], w)];
    else {
      const A = ankle3(pa, ground, s), B = ankle3(pb, ground, s);
      P['ank' + S] = [0, 1, 2].map((i) => lerp(A[i], B[i], w));
      if (both) P['ank' + S][1] += Math.min(MIX_LIFT * s, apart * 0.5) * Math.sin(Math.PI * w);
    }
    P['plant' + S] = both && apart <= MIX_STEP * s;
  }
  for (const S of FEET) if (a['clear' + S] != null || b['clear' + S] != null) P['clear' + S] = lerp(a['clear' + S] ?? 1, b['clear' + S] ?? 1, w);
  if (a.bat && b.bat) P.bat = { knob: [0, 1, 2].map((i) => lerp(a.bat.knob[i], b.bat.knob[i], w)), dir: norm([0, 1, 2].map((i) => lerp(a.bat.dir[i], b.bat.dir[i], w))), bottom: (w < 0.5 ? a : b).bat.bottom, ...((w < 0.5 ? a : b).bat.one ? { one: true } : {}) };
  else if ((w < 0.5 ? a : b).bat) P.bat = (w < 0.5 ? a : b).bat;
  return guardMix(P);
}
// A mix lerps the hand's way apart from the forearm, which only the solve settles, and a free foot's
// apart from the ground: half way between a mitt held up and a run's swinging arm the hand can be
// bent further back than a wrist goes, and a foot swung through can dip its toe into the grass. Each
// clip is a body that can on its own; this keeps the mix one too. A hand bent past MIX_WRIST is
// turned back to it toward the forearm in the plane of the two, its palm kept square to it; a free
// toe below the ground is raised to it.
const MIX_WRIST = 96;
function guardMix(P) {
  const J = solvePose({ ...P, at: [0, 0, 0], yaw: 0 }).J;
  for (const S of FEET) {
    if (!J['grip' + S]) {
      const f = norm(sub(J['wr' + S], J['el' + S])), h = norm(P['hand' + S]), c = clamp(f[0] * h[0] + f[1] * h[1] + f[2] * h[2], -1, 1);
      if (Math.acos(c) * DEG > MIX_WRIST) {
        const u0 = [h[0] - f[0] * c, h[1] - f[1] * c, h[2] - f[2] * c], ul = len(u0);
        if (ul > 1e-4) {
          const k = MIX_WRIST / DEG, nh = [0, 1, 2].map((i) => f[i] * Math.cos(k) + (u0[i] / ul) * Math.sin(k));
          const p0 = P['palm' + S], d = p0[0] * nh[0] + p0[1] * nh[1] + p0[2] * nh[2];
          P['hand' + S] = nh;
          P['palm' + S] = norm([p0[0] - nh[0] * d, p0[1] - nh[1] * d, p0[2] - nh[2] * d]);
        }
      }
    }
    const a = P['ank' + S];
    if (a.length === 3 && J['toe' + S][1] < JOINT_LIMITS.floor.toe + 0.02) {
      // the toe's tip is TOE_LEN out from the ankle along the foot: tipped up until it clears
      const d = norm(P['toe' + S]), least = (JOINT_LIMITS.floor.toe + 0.02 - J['an' + S][1]) / TOE_LEN, hz = Math.hypot(d[0], d[2]) || 1, k = Math.sqrt(Math.max(0, 1 - least * least));
      if (least > d[1]) P['toe' + S] = [d[0] / hz * k, least, d[2] / hz * k];
    }
  }
  return P;
}

// ── events ─────────────────────────────────────────────────────────────────────
// Where on the bat it meets the ball: the sweet spot, this far from the knob along the bat.
export const SWEET_SPOT = 2.35;

// When a clip's first event of a kind happens (release, contact, catch, call, step, hit), or null: the
// director lines a clip up on it (the release on the pitch's start, the contact on the ball).
export const eventTime = (clip, kind) => { const e = (clip.events || []).find((x) => x.kind === kind); return e ? e.t : null; };
// The events a clip plays past going from `t0` to `t1` (after t0, up to and including t1).
export const eventsBetween = (clip, t0, t1) => (clip.events || []).filter((e) => e.t > t0 && e.t <= t1);

// ── layers ─────────────────────────────────────────────────────────────────────
// The point in a hand a reach brings to its target: a glove's or a catcher's mitt's pocket, or the
// palm of a bare hand.
export function handPoint(P, S, kind = 'glove', s = 1) {
  const wr = P['wr' + S], hd = P['hand' + S], pm = P['palm' + S];
  const along = kind === 'mitt' ? 0.27 : kind === 'glove' ? 0.3 : 0.17, out = kind === 'bare' ? 0 : 0.05;
  return [wr[0] + (hd[0] * along + pm[0] * out) * s, wr[1] + (hd[1] * along + pm[1] * out) * s, wr[2] + (hd[2] * along + pm[2] * out) * s];
}
// Where a clip has the point of the hand that makes its catch, at the catch, in the frame the clip
// started in (a clip that travels carries it there): `{ t, at, event }`, or null for a clip with no
// catch. The director places a fielding clip by it, so the glove comes to the ball; a mirrored
// clip's is the mirror, and `scale` is the player's size. It's where the arm really puts the hand
// (`handAt`): a stretch keyed at full length is softened short of its key, and a ball put at the
// key has the reach pull the body after it.
export function catchPoint(clip, opts = {}) {
  const e = (clip.events || []).find((x) => x.kind === 'catch');
  if (!e) return null;
  const kind = opts.kind || (clip.role === 'catcher' ? 'mitt' : e.hand === 'R' ? 'bare' : 'glove'), s = opts.scale || 1;
  const P = sampleClip(clip, e.t, { scale: s }), h = handAt(P, e.hand, kind, s), r = rootAt(clip, e.t);
  const q = outOf(r, h), at = opts.mirror ? [-q[0], q[1], q[2]] : q;
  return { t: e.t, at, event: e };
}
// The point of hand S as the arm really holds it: handPoint from the wrist the solver reaches,
// which a limb keyed past its soft limit (rig.js IK_SOFT) falls short of. In the pose's frame.
export function handAt(P, S, kind = 'glove', s = 1) {
  const J = solvePose({ ...P, at: [0, 0, 0], yaw: 0, scale: s }).J;
  return handPoint({ ...P, ['wr' + S]: J['wr' + S] }, S, kind, s);
}
// Moves hand S so its `kind` point meets `target` (in the pose's real frame), `w` of the way: the
// director ramps `w` up to 1 at the catch and back down after it. The further the reach takes the
// hand from where the clip had it, the more it turns to point along the line from the shoulder
// through the target, so the wrist doesn't break over. Where the arm can't get there from where the
// body is, the body goes toward it, by up to `follow` feet (the pelvis moves, the planted feet stay
// planted). Options: `kind` ('glove', 'mitt' or 'bare'), `follow`, `scale`, `ground` (as for
// sampleClip).
const FOLLOW_SINK = 0.25;
export function reach(P, S, target, w = 1, opts = {}) {
  if (!(w > 0)) return P;
  const s = opts.scale || 1, kind = opts.kind || 'glove', ground = opts.ground || flatGround;
  let out = P;
  {
    const moved = len(sub(target, handPoint(P, S, kind, s))), k = clamp(moved / (0.8 * s), 0, 1) * w;
    if (k > 0) {
      const sh = solveTorso({ ...P, at: [0, 0, 0], yaw: 0, scale: s }).J['sh' + S], r = norm(sub(target, sh)), hd = P['hand' + S];
      out = { ...P, ['hand' + S]: norm([0, 1, 2].map((i) => lerp(hd[i], r[i], k))) };
    }
  }
  const follow = (opts.follow || 0) * s;
  if (follow > 0) {
    const pelvis0 = out.pelvis;
    for (let pass = 0; pass < 3; pass++) {
      const { J } = solveTorso({ ...out, at: [0, 0, 0], yaw: 0, scale: s });
      const hp = handPoint(out, S, kind, s), wr = out['wr' + S];
      const wrT = [target[0] - (hp[0] - wr[0]), target[1] - (hp[1] - wr[1]), target[2] - (hp[2] - wr[2])];
      const d = sub(wrT, J['sh' + S]), L = len(d), arm = ARM * s * 0.98;
      if (L <= arm + 1e-3) break;
      // toward the target by what the arm is short, held to `follow` in all and weighted by `w`;
      // the body shifts and rises for a ball but sinks no more than FOLLOW_SINK, since a squat has
      // nowhere lower to go
      const k = (L - arm) / L * w;
      let p = [out.pelvis[0] + d[0] * k, Math.max(out.pelvis[1] + d[1] * k, pelvis0[1] - FOLLOW_SINK * s), out.pelvis[2] + d[2] * k];
      const m = sub(p, pelvis0), ml = len(m);
      if (ml > follow) p = [pelvis0[0] + m[0] / ml * follow, pelvis0[1] + m[1] / ml * follow, pelvis0[2] + m[2] / ml * follow];
      out = fitPlants({ ...out, pelvis: p }, ground, s);
    }
  }
  const at = handPoint(out, S, kind, s), wr = out['wr' + S];
  return { ...out, ['wr' + S]: [wr[0] + (target[0] - at[0]) * w, wr[1] + (target[1] - at[1]) * w, wr[2] + (target[2] - at[2]) * w] };
}

// Where a catch's `reach` box puts a ball at (x, y): on the plane across the ball's line (`from`,
// default straight at him) through `home`, the glove's point at the catch; x runs along his left as
// he faces the ball, from the pose frame's origin, and y is the height off the ground.
export function catchTarget(home, x, y, from = [0, 0, 1]) {
  const h = Math.hypot(from[0], from[2]) || 1, across = [from[2] / h, 0, -from[0] / h];
  const off = x - (home[0] * across[0] + home[2] * across[2]);
  return [home[0] + across[0] * off, y, home[2] + across[2] * off];
}

// The bat turned about its knob so the barrel comes through `target` (the pose's real frame), `w`
// of the way: the swing's own path is a height, and this puts it on the pitch, in or out, up or
// down. The hands follow the bat, as they always do. With `opts.reach`, the hands first carry the
// knob along the ground toward the target (or back from it), by up to that many feet, until the
// target is the sweet spot's length away: how a hitter gets the barrel to a pitch on the outer
// edge. Where that's not enough, they go down to it (or up) by up to half as far again. Wherever
// that or the turn leaves a hand short of the bat, the body goes toward it, by up to `opts.follow`
// feet along the ground (the planted feet stay planted), and bends at the waist for a hand short
// below, so both hands stay on. `scale` and `ground` as for sampleClip.
export function aimBat(P, target, w = 1, opts = {}) {
  if (!(w > 0) || !P.bat) return P;
  const s = opts.scale || 1, ground = opts.ground || flatGround;
  let k = P.bat.knob;
  const most = (opts.reach || 0) * s;
  if (most > 0) {
    const d = sub(target, k), h = Math.hypot(d[0], d[2]), want = Math.sqrt(Math.max(0, SWEET_SPOT * SWEET_SPOT - d[1] * d[1]));
    const by = clamp(h - want, -most, most) * w;
    if (by && h > 1e-6) k = [k[0] + d[0] / h * by, k[1], k[2] + d[2] / h * by];
    // still out of reach once that's all used: the hands go down to it too (or up), by up to half
    // as far again. Along the ground alone, a pitch in the low corner away met the bat 3 ft up it.
    const h2 = h - clamp(h - want, -most, most), dy = Math.abs(d[1]);
    if (Math.hypot(h2, dy) > SWEET_SPOT + 1e-9 && dy > 1e-6) {
      const drop = Math.min(dy - Math.sqrt(Math.max(0, SWEET_SPOT * SWEET_SPOT - h2 * h2)), most / 2) * w;
      k = [k[0], k[1] + Math.sign(d[1]) * drop, k[2]];
    }
  }
  const d0 = P.bat.dir, to = norm(sub(target, k));
  let out = { ...P, bat: { ...P.bat, knob: k, dir: norm([0, 1, 2].map((i) => lerp(d0[i], to[i], w))) } };
  const follow = (opts.follow || 0) * s, limit = ARM * s * 0.98;
  if (follow > 0) {
    const pelvis0 = out.pelvis;
    for (let pass = 0; pass < 4; pass++) {
      const { J } = solvePose({ ...out, at: [0, 0, 0], yaw: 0, scale: s });
      let worst = null;
      for (const S of FEET) {
        const v = sub(J['wrT' + S], J['sh' + S]), L = len(v);
        if (L > limit && (!worst || L - limit > worst.over)) worst = { v, L, over: L - limit };
      }
      if (!worst) break;
      const k2 = (worst.over + 0.01 * s) / worst.L;
      // what's short below him, the waist bends for: the spine and chest forward, each up to 15
      // degrees past the clip's, the shoulders swinging down about 1.4 ft out from the bend
      const down = Math.max(0, -worst.v[1] * k2);
      const bend = Math.min(15, Math.asin(Math.min(1, down / (1.4 * s))) * DEG);
      const sp = out.spine, ch = out.chest;
      out = { ...out, spine: [Math.min(sp[0] + bend * 0.5, P.spine[0] + 15), sp[1], sp[2]], chest: [Math.min(ch[0] + bend * 0.5, P.chest[0] + 15), ch[1], ch[2]] };
      // the rest along the ground
      let p = [out.pelvis[0] + worst.v[0] * k2, out.pelvis[1], out.pelvis[2] + worst.v[2] * k2];
      const m = sub(p, pelvis0), ml = len(m);
      if (ml > follow) p = [0, 1, 2].map((i) => pelvis0[i] + m[i] * follow / ml);
      out = fitPlants({ ...out, pelvis: p }, ground, s);
    }
  }
  return out;
}

// The neck and head turned toward `target` (the pose's real frame), `w` of the way, the turn shared
// between them and held inside what a neck can do: 75 degrees round each way and 40 up or down in
// all, the head taking two parts in five.
export const LOOK_LIMIT = Object.freeze({ yaw: 75, pitch: 40 });
export function lookAt(P, target, w = 1, s = 1) {
  if (!(w > 0)) return P;
  const { J, W } = solveTorso({ ...P, at: [0, 0, 0], yaw: 0, scale: s });
  const eye = [J.head[0], J.head[1] + 0.3 * s, J.head[2]];
  const d = sub(target, eye);
  // into the chest's frame: its x, y and z axes are W.chest's columns
  const C = W.chest, x = d[0] * C[0][0] + d[1] * C[0][1] + d[2] * C[0][2], y = d[0] * C[1][0] + d[1] * C[1][1] + d[2] * C[1][2], z = d[0] * C[2][0] + d[1] * C[2][1] + d[2] * C[2][2];
  const yaw = clamp(Math.atan2(x, z) * DEG, -LOOK_LIMIT.yaw, LOOK_LIMIT.yaw);
  const pitch = clamp(-Math.atan2(y, Math.hypot(x, z)) * DEG, -LOOK_LIMIT.pitch, LOOK_LIMIT.pitch);
  // what the clip had in the neck and head, moved toward the look
  const n = P.neck, h = P.head;
  return { ...P, neck: [lerp(n[0], pitch * 0.6, w), lerp(n[1], yaw * 0.6, w), n[2]], head: [lerp(h[0], pitch * 0.4, w), lerp(h[1], yaw * 0.4, w), h[2]] };
}

// ── his own way ────────────────────────────────────────────────────────────────
// A player's own way of doing things, off his name, so a regular viewer knows him by it: the
// pitcher's arm slot (which delivery the director plays him) and leg kick, the hitter's stance
// width, crouch and bat angle, and how quick he is about it. Stable all season.
export function traitsOf(id) {
  const h = hashStr('traits:' + id), r = (k) => ((h >>> (k * 3)) & 1023) / 1023;
  return {
    armSlot: r(0) < 0.15 ? 'side' : r(0) < 0.6 ? 'three' : 'over',
    kick: 0.8 + 0.4 * r(1),
    width: 0.88 + 0.24 * r(2),
    crouch: 0.85 + 0.3 * r(3),
    batAngle: -12 + 24 * r(4),
    tempo: 0.92 + 0.16 * r(5),
  };
}
// The ends of each trait's range, for the gate: every clip has to hold up done either way.
export const TRAIT_RANGE = Object.freeze({ kick: [0.8, 1.2], width: [0.88, 1.12], crouch: [0.85, 1.15], batAngle: [-12, 12] });
// A pose done his way: `role` says which traits apply. sampleClip calls this before it fits the
// plants, so a wider stance still has its feet in reach. The arm slot isn't here: each slot is a
// delivery of its own (pitch_stretch_over, _three, _side). `here` is where a clip that travels has
// carried its frame (rootAt): a hitter's stance is the box's, so his width and crouch ease out
// over his first LEAVE_BOX feet out of it, the width taken across the box as he stood in it, so a
// foot still on its spot stays there.
const LEAVE_BOX = 3;
export function vary(P, traits, role, here = null) {
  if (!traits) return P;
  const out = { ...P };
  if (role === 'pitcher') {
    // the leg kick lifts the stride foot (his left, the clips being a right-hander's) higher or
    // lower; the back foot's drag after the release is the delivery's, not his
    const a = out.ankL;
    if (a.length === 3) out.ankL = [a[0], ANKLE_UP + (a[1] - ANKLE_UP) * traits.kick, a[2]];
  } else if (role === 'batter') {
    // a wider or narrower base, sitting lower or taller in it, the bat laid back or held up
    const far = here ? clamp(Math.hypot(here.at[0], here.at[1]) / LEAVE_BOX, 0, 1) : 0, k = 1 - far * far * (3 - 2 * far);
    const width = 1 + (traits.width - 1) * k, crouch = 1 + (traits.crouch - 1) * k;
    for (const S of FEET) {
      const a = out['ank' + S];
      if (!here) { out['ank' + S] = a.length === 2 ? [a[0] * width, a[1]] : [a[0] * width, a[1], a[2]]; continue; }
      const g = outOf(here, a.length === 2 ? [a[0], 0, a[1]] : a), q = into(here, [g[0] * width, g[1], g[2]]);
      out['ank' + S] = a.length === 2 ? [q[0], q[2]] : q;
    }
    out.pelvis = [out.pelvis[0], out.pelvis[1] - (crouch - 1) * 0.6, out.pelvis[2]];
    if (out.bat) {
      // about the axis from his chest to the plate (his z), so the barrel lies back toward the
      // catcher or stands up: how he holds it waiting, so it fades as the bat comes down out of
      // the upright, and the swing is the swing
      const d = out.bat.dir, up = clamp((d[1] - 0.3) / 0.4, 0, 1);
      const t = traits.batAngle / DEG * up * up * (3 - 2 * up), c = Math.cos(t), sn = Math.sin(t);
      if (t) out.bat = { ...out.bat, dir: norm([d[0] * c - d[1] * sn, d[0] * sn + d[1] * c, d[2]]) };
    }
  }
  return out;
}

// ── what a body can do ─────────────────────────────────────────────────────────
// Degrees, and feet off the ground. A hinge's bend is its angle off straight; the ankle's is the
// angle between the shin and the foot (about 95 standing); the hip's are the thigh's lean forward
// off the pelvis's down (back is negative) and out to the side (across is negative); the spine,
// chest, neck and head are the most of each turn a pose may give them, |x|, |y| and |z|; and the
// floor is how low a joint's centre may go.
export const JOINT_LIMITS = Object.freeze({
  knee: 150, elbow: 160, wrist: 100,
  ankle: Object.freeze([50, 172]),
  hipFlex: Object.freeze([-40, 130]), hipAbd: Object.freeze([-50, 65]),
  spine: Object.freeze([45, 40, 30]), chest: Object.freeze([40, 45, 30]), neck: Object.freeze([55, 80, 35]), head: Object.freeze([45, 60, 30]),
  lookYaw: 100,
  floor: Object.freeze({ pelvis: 0.5, knee: 0.15, ankle: 0.2, toe: -0.05, wrist: 0.1 }),
});

// What a pose does with its joints: `P` the pose and `sol` its solve (solvePose) at the origin,
// facing +z, so heights are off the ground there. The bend of a hand on a bat isn't measured;
// the bat decides it.
export function jointAngles(P, sol) {
  const { J, W } = sol;
  const out = {};
  for (const [S, sg] of [['L', 1], ['R', -1]]) {
    out['knee' + S] = angle(sub(J['kn' + S], J['hip' + S]), sub(J['an' + S], J['kn' + S]));
    out['elbow' + S] = angle(sub(J['el' + S], J['sh' + S]), sub(J['wr' + S], J['el' + S]));
    out['ankle' + S] = angle(sub(J['kn' + S], J['an' + S]), sub(J['toe' + S], J['an' + S]));
    out['wrist' + S] = J['grip' + S] ? null : angle(sub(J['wr' + S], J['el' + S]), J['hdir' + S]);
    // the thigh in the pelvis's frame
    const t = sub(J['kn' + S], J['hip' + S]), M = W.pelvis;
    const d = [t[0] * M[0][0] + t[1] * M[0][1] + t[2] * M[0][2], t[0] * M[1][0] + t[1] * M[1][1] + t[2] * M[1][2], t[0] * M[2][0] + t[1] * M[2][1] + t[2] * M[2][2]];
    out['hipFlex' + S] = Math.atan2(d[2], -d[1]) * DEG;
    out['hipAbd' + S] = Math.asin(clamp(sg * d[0] / (len(d) || 1), -1, 1)) * DEG;
  }
  out.lookYaw = (P.neck ? P.neck[1] : 0) + (P.head ? P.head[1] : 0);
  return out;
}
// Every way a pose goes past JOINT_LIMITS, as words (an empty list is a pose a body can make).
export function limitBreaks(P, sol) {
  const L = JOINT_LIMITS, a = jointAngles(P, sol), out = [];
  const f = (v) => v.toFixed(1);
  for (const S of FEET) {
    if (a['knee' + S] > L.knee) out.push(`knee${S} bends ${f(a['knee' + S])}° (most ${L.knee})`);
    if (a['elbow' + S] > L.elbow) out.push(`elbow${S} bends ${f(a['elbow' + S])}° (most ${L.elbow})`);
    if (a['wrist' + S] !== null && a['wrist' + S] > L.wrist) out.push(`wrist${S} bends ${f(a['wrist' + S])}° (most ${L.wrist})`);
    if (a['ankle' + S] < L.ankle[0] || a['ankle' + S] > L.ankle[1]) out.push(`ankle${S} at ${f(a['ankle' + S])}° (${L.ankle[0]} to ${L.ankle[1]})`);
    if (a['hipFlex' + S] < L.hipFlex[0] || a['hipFlex' + S] > L.hipFlex[1]) out.push(`hip${S} forward ${f(a['hipFlex' + S])}° (${L.hipFlex[0]} to ${L.hipFlex[1]})`);
    if (a['hipAbd' + S] < L.hipAbd[0] || a['hipAbd' + S] > L.hipAbd[1]) out.push(`hip${S} out ${f(a['hipAbd' + S])}° (${L.hipAbd[0]} to ${L.hipAbd[1]})`);
  }
  for (const k of ANGLES3) {
    const e = P[k] || [0, 0, 0];
    for (let i = 0; i < 3; i++) if (Math.abs(e[i] || 0) > L[k][i]) out.push(`${k} ${'xyz'[i]} ${f(e[i])}° (most ${L[k][i]})`);
  }
  if (Math.abs(a.lookYaw) > L.lookYaw) out.push(`neck and head turn ${f(a.lookYaw)}° (most ${L.lookYaw})`);
  const { J } = sol, F = L.floor;
  if (J.pelvis[1] < F.pelvis) out.push(`pelvis ${f(J.pelvis[1])} ft up (least ${F.pelvis})`);
  for (const S of FEET) {
    for (const [name, j, min] of [['knee', 'kn', F.knee], ['ankle', 'an', F.ankle], ['toe', 'toe', F.toe], ['wrist', 'wr', F.wrist]]) {
      if (J[j + S][1] < min) out.push(`${name}${S} ${J[j + S][1].toFixed(2)} ft up (least ${min})`);
    }
  }
  return out;
}
