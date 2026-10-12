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
//     so a joint's speed carries smoothly through each one; a clip starts and ends at rest, and a
//     loop runs on round its end; directions are put back to unit length; a bat is held between
//     two keys that both have it, and taken up or let go at a key;
//   · plants: while a foot is planted it's held where it was put down, on the ground, so nothing
//     slides; a foot coming down meets the ground where it really is (`ground`), easing onto its
//     spot and off it; and where a planted foot is out of its leg's reach the pelvis drops until
//     it isn't (`fitPlants`), so the pitcher's drive off the rubber sinks him onto the back leg
//     instead of dragging the foot;
//   · his own way of doing it (`vary`, off his name: the arm slot, the leg kick, the stance), and
//     a left-hander's mirror, are part of the sample;
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

import { solvePose, solveTorso, mirrorPose } from './rig.js';

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
  if (out.bat) out.bat = { knob: out.bat.knob.slice(), dir: norm(out.bat.dir).map(r4), bottom: out.bat.bottom || 'L' };
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
// end of a clip, where the slope is zero, so a clip comes to rest at its ends.
function cr(p0, p1, p2, p3, t0, t1, t2, t3, u, k1 = 1, k2 = 1) {
  const dt = t2 - t1 || 1e-6;
  const m1 = p0 === null ? 0 : (p2 - p0) / (t2 - t0) * dt * k1;
  const m2 = p3 === null ? 0 : (p3 - p1) / (t3 - t1) * dt * k2;
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * p1 + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * p2 + (u3 - u2) * m2;
}

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

// Whether a foot is planted at `t`: inside one of the clip's plants.
export const plantAt = (clip, S, t) => (clip.plants || []).find((p) => p.foot === S && t >= p.from - 1e-9 && t <= p.to + 1e-9) || null;
// How firmly a foot is held at `t`: 1 through a plant, easing in over PLANT_EASE before it and out
// over PLANT_EASE after it (less where the clip's end or the same foot's next plant is nearer), so
// a foot glides onto and off its spot and the pelvis follows smoothly.
export const PLANT_EASE = 0.1;
function holdOf(clip, S, t) {
  let best = { w: 0, p: null };
  const mine = (clip.plants || []).filter((p) => p.foot === S);
  for (let i = 0; i < mine.length; i++) {
    const p = mine[i], prev = mine[i - 1], next = mine[i + 1];
    const e = Math.min(PLANT_EASE, Math.max(0, p.from), prev ? (p.from - prev.to) / 2 : Infinity);
    const f = Math.min(PLANT_EASE, Math.max(0, clip.duration - p.to), next ? (next.from - p.to) / 2 : Infinity);
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
  const holds = {};
  let P = planted(clip, curve(clip, t, ground, s), t, ground, s, holds);
  if (opts.traits) P = vary(P, opts.traits, clip.role);
  P = fitPlants(P, ground, s, holds);
  return mirror ? mirrorPose(P) : P;
}

// The keys' curves alone, before the plants hold the feet.
function curve(clip, t, ground, s) {
  const keys = clip.keys;
  if (keys.length === 1) {
    const P = copy(keys[0].pose);
    for (const S of FEET) { P['ank' + S] = ankle3(P['ank' + S], ground, s); P['plant' + S] = false; }
    return P;
  }
  const { k0, k1, k2, k3, u } = bracket(clip, t);
  const a = k1.pose, b = k2.pose;
  const t0 = k0 ? k0.t : 0, t3 = k3 ? k3.t : 0, q1 = 1 - (k1.tension || 0), q2 = 1 - (k2.tension || 0);
  const at4 = (get) => cr(k0 ? get(k0.pose) : null, get(a), get(b), k3 ? get(k3.pose) : null, t0, k1.t, k2.t, t3, u, q1, q2);
  const P = {};
  for (const k of ANGLES) P[k] = at4((q) => q[k]);
  for (const k of [...POINTS, ...ANGLES3]) P[k] = [0, 1, 2].map((i) => at4((q) => q[k][i]));
  for (const k of DIRS) P[k] = norm([0, 1, 2].map((i) => at4((q) => q[k][i])));
  for (const S of FEET) {
    const A = [k0, k1, k2, k3].map((k) => (k ? ankle3(k.pose['ank' + S], ground, s) : null));
    P['ank' + S] = [0, 1, 2].map((i) => cr(A[0] && A[0][i], A[1][i], A[2][i], A[3] && A[3][i], t0, k1.t, k2.t, t3, u, q1, q2));
    // planted only while a plant holds it (`planted`): a key's flag is for a still
    P['plant' + S] = false;
  }
  // the bat: between two keys that both have it, it moves; otherwise it's in the hands only at a
  // key that has it, so it's taken up or let go there, where the wrists already are
  if (a.bat && b.bat) {
    P.bat = {
      knob: [0, 1, 2].map((i) => cr(k0 ? (k0.pose.bat || a.bat).knob[i] : null, a.bat.knob[i], b.bat.knob[i], k3 ? (k3.pose.bat || b.bat).knob[i] : null, t0, k1.t, k2.t, t3, u, q1, q2)),
      dir: norm([0, 1, 2].map((i) => cr(k0 ? (k0.pose.bat || a.bat).dir[i] : null, a.bat.dir[i], b.bat.dir[i], k3 ? (k3.pose.bat || b.bat).dir[i] : null, t0, k1.t, k2.t, t3, u, q1, q2))),
      bottom: a.bat.bottom || 'L',
    };
  } else if (a.bat && u <= 0) P.bat = copy(a.bat);
  else if (b.bat && u >= 1) P.bat = copy(b.bat);
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
  const { J } = solveTorso({ ...P, at: [0, 0, 0], yaw: 0, scale: s });
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
// may be frozen, so not on it).
const PLANTED = new WeakMap();
function planted(clip, P, t, ground, s, holds = {}) {
  for (const S of FEET) {
    const { w, p } = holdOf(clip, S, t);
    holds[S] = w;
    if (!p) continue;
    let memo = PLANTED.get(clip);
    if (!memo) PLANTED.set(clip, (memo = new Map()));
    const key = `${S}:${p.from}`;
    let at = memo.get(key);
    if (!at) {
      const q = curve(clip, p.from, ground, s)['ank' + S];
      at = [q[0], q[2]];
      memo.set(key, at);
    }
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
    if (both) P['ank' + S] = [lerp(pa[0], pb[0], w), lerp(pa[1], pb[1], w)];
    else { const A = ankle3(pa, ground, s), B = ankle3(pb, ground, s); P['ank' + S] = [0, 1, 2].map((i) => lerp(A[i], B[i], w)); }
    P['plant' + S] = both;
  }
  if (a.bat && b.bat) P.bat = { knob: [0, 1, 2].map((i) => lerp(a.bat.knob[i], b.bat.knob[i], w)), dir: norm([0, 1, 2].map((i) => lerp(a.bat.dir[i], b.bat.dir[i], w))), bottom: (w < 0.5 ? a : b).bat.bottom };
  else if ((w < 0.5 ? a : b).bat) P.bat = (w < 0.5 ? a : b).bat;
  return P;
}

// ── events ─────────────────────────────────────────────────────────────────────
// When a clip's first event of a kind happens (release, contact, catch, call, step), or null: the
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
// pitcher's arm slot and leg kick, the hitter's stance width, crouch and bat angle, and how quick
// he is about it. Stable all season.
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
// A pose done his way: `role` says which traits apply. sampleClip calls this before it fits the
// plants, so a wider stance still has its feet in reach.
export function vary(P, traits, role) {
  if (!traits) return P;
  const out = { ...P };
  if (role === 'pitcher') {
    // The clips are keyed for a right-hander, who throws with R and whose throwing side at the
    // release is +z. As the slot drops, the throwing hand's path above the shoulder swings down
    // and out to that side; the kick lifts higher or lower.
    const tilt = { over: 0, three: 25, side: 55 }[traits.armSlot] / DEG, SH = 4.4;
    const w = out.wrR;
    if (w[1] > SH) {
      const r = w[1] - SH;
      out.wrR = [w[0], SH + r * Math.cos(tilt), w[2] + r * Math.sin(tilt)];
    }
    for (const S of FEET) {
      if (out['plant' + S] === false && out['ank' + S].length === 3) {
        const a = out['ank' + S];
        out['ank' + S] = [a[0], ANKLE_UP + (a[1] - ANKLE_UP) * traits.kick, a[2]];
      }
    }
  } else if (role === 'batter') {
    // a wider or narrower base, sitting lower or taller in it, the bat laid back or held up
    for (const S of FEET) {
      const a = out['ank' + S];
      out['ank' + S] = a.length === 2 ? [a[0] * traits.width, a[1]] : [a[0] * traits.width, a[1], a[2]];
    }
    out.pelvis = [out.pelvis[0], out.pelvis[1] - (traits.crouch - 1) * 0.6, out.pelvis[2]];
    if (out.bat) {
      // about the axis from his chest to the plate (his z), so the barrel lies back toward the
      // catcher or stands up
      const t = traits.batAngle / DEG, d = out.bat.dir, c = Math.cos(t), sn = Math.sin(t);
      out.bat = { ...out.bat, dir: norm([d[0] * c - d[1] * sn, d[0] * sn + d[1] * c, d[2]]) };
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
