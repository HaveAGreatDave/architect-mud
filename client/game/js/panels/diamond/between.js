// DEADBALL · BETWEEN AT-BATS. The dead time after a play has landed, until the next payload's due,
// filled the way a broadcast fills it: with things that decide nothing (docs/proposals/
// deadball-glass2.md, Between beats and replays).
//
// THE FIELD RESETS (`planBetween`). From wherever the play left him (the director seeds each man
// from its plan or the world, as offField does), every fielder walks back to his spot and stands
// easy, jogging if it's a long way; the pitcher walks off the back of the mound and rubs up the new
// ball; the catcher goes back behind the plate, the plate umpire steps off to the side and a base
// umpire goes back to his spot; a man on a bag stands easy on it; and a man who's out goes off to
// his side's dugout. Each sets off once his play's done
// with him, held back a beat at a time while his way would take him within reach of somebody
// already going. A man who couldn't be at rest before the next payload's due stays where he is: its
// cut puts everyone in his place anyway.
//
// THE ON-DECK HITTER (`deckPlan`) takes practice swings in his circle through the at-bat and after
// it, a waggle in his stance between them.
//
// THE CAMERAS (`shotsBetween`) go round the park meanwhile: wide over the field as it resets, the
// on-deck circle as he swings, the pitcher rubbing up the ball, a cutaway to the crowd, and wide
// again before the next payload's due. With too little time, the wide shot alone.
//
// Pure: no DOM and no GL.

import { CLIPS } from './clips.js';
import { rootAt } from './anim.js';
import { RUBBER, BAGS, MOUND, groundHeight } from './geo.js';
import { clamp, add, sub, mul, flat, wrap, faceTo, turn, ahead, hashStr, cloneBody } from './bodies.js';
import { wayPath, roundMound, BEHIND_THE_PLATE, dugoutSpot, dugoutOf, stopAt } from './bases.js';
import { faceHome } from './cast.js';

export const BETWEEN = Object.freeze({
  // how long after the landing the field starts back, and how long before the next payload's due
  // everyone's to be at rest
  settle: 0.8, margin: 1.5,
  // further than this he jogs (ft), and how fast (ft/s)
  walkFar: 55, jog: 11,
  // the room a man going keeps from anybody already going (ft), and the longest he's held back (s)
  room: 2.6, wait: 6,
  // on a long hold, how long the wide shot holds between the cutaways that come round again (s)
  wide: 9,
});
const WALK = CLIPS.run_walk;
export const WALK_V = rootAt(WALK, WALK.duration).at[1] / WALK.duration;
// The most a rest turns him from the way he came in, across its mix (a stance turned further in a
// mix crosses its legs: docs/reference/glass-notes.md), how far short of his spot his way turns him
// toward the way he's to face, and how long the mix into a rest takes.
const REST_TURN = 55, LEAD_IN = 3, REST_FADE = 0.45;
// Where the pitcher rubs up the ball, off the back of the mound on the grass facing the plate; where
// the catcher waits; and where the plate umpire steps off to, out of the catcher's way back.
export const RUB_SPOT = Object.freeze([0, 0, 70.4]);
const CATCHER_SPOT = Object.freeze([0, 0, -2.75]), UMP_ASIDE = Object.freeze([6, 0, -7]);

const unitOf = (v) => { const l = Math.hypot(v[0], v[2]) || 1; return [v[0] / l, 0, v[2] / l]; };
const nearSeg = (q, a, b) => { const ab = sub(b, a), L = ab[0] * ab[0] + ab[2] * ab[2], f = L ? clamp(((q[0] - a[0]) * ab[0] + (q[2] - a[2]) * ab[2]) / L, 0, 1) : 0; return flat(q, add(a, mul(ab, f))); };
// A way's corners turned no more than 60 degrees at a time: a sharper one is cut back to two
// points either side of it, so a walk's legs never cross in the mix at a corner.
function easeCorners(pts) {
  let out = pts.slice();
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    const next = [out[0]];
    for (let i = 1; i < out.length - 1; i++) {
      const a = next[next.length - 1], P = out[i], c = out[i + 1];
      const by = Math.abs(wrap(faceTo(P, c) - faceTo(a, P))), k = Math.min(2, flat(a, P) / 3, flat(P, c) / 3);
      if (by > 60 && k > 0.3) {
        next.push(add(P, mul(unitOf(sub(a, P)), k)), add(P, mul(unitOf(sub(c, P)), k)));
        changed = true;
      } else next.push(P);
    }
    next.push(out[out.length - 1]);
    out = next;
    if (!changed) break;
  }
  return out;
}

// ⚠ THE MOUND. A walk's frame stands at one height, and a swinging foot only clears the ground under
// it by a quarter of a foot, so on the mound's slope it would drag through the dirt. Near the mound
// the way goes in short stretches, each standing as high as the ground gets under it
// (`heightOver`, half way between its highest and lowest); a rest stands at the ground's height
// where it is. Higher than that and the legs
// can't reach the ground, the pelvis comes down and the swinging leg folds until its ankle's past
// what it can do. And nobody walks up it: the walk's planted foot, tipped up the slope with the
// shin over it, bends the ankle the same way, and the ground ahead comes up to the swinging foot. A man on the slope steps off it straight down (`offSlope`) and goes round it on
// the grass (bases.js roundMound); one on the top walks off the back, downhill all the way. The
// planted feet find the slope themselves (anim.js fitPlants).
const MOUND_TOP = 2.8, MOUND_FOOT = 9.6, MOUND_OFF = 10.8;
const MOUND_NEAR = 10.5, MOUND_STEP = 1.4;
// Off the mound's slope from `q`, straight down it: the point on the grass beyond, or null for a
// man not on the slope.
function offSlope(q) {
  const d = sub(q, [MOUND[0], 0, MOUND[1]]), r = Math.hypot(d[0], d[2]);
  if (r <= MOUND_TOP || r >= MOUND_FOOT) return null;
  return add([MOUND[0], 0, MOUND[1]], mul(unitOf(d), MOUND_OFF));
}
const nearMound = (a, b) => nearSeg([MOUND[0], 0, MOUND[1]], a, b) < MOUND_NEAR;
function heightOver(a, b) {
  const u = unitOf(sub(b, a)), side = [-u[2], 0, u[0]], L = flat(a, b);
  let top = 0, low = Infinity;
  for (let d = 0; d <= L + 1e-9; d += 0.3) for (const k of [-0.4, 0, 0.4]) {
    const q = add(add(a, mul(u, d)), mul(side, k)), y = groundHeight(q[0], q[2]);
    top = Math.max(top, y); low = Math.min(low, y);
  }
  return (top + low) / 2;
}
// A way's legs, each cut into short stretches where it's near the mound: [{ a, b, y }].
function stretchesOf(way) {
  const out = [];
  for (let i = 1; i < way.pts.length; i++) {
    const a = way.pts[i - 1], b = way.pts[i], L = flat(a, b);
    if (L < 0.05) continue;
    if (!nearMound(a, b)) { out.push({ a, b, y: 0 }); continue; }
    const n = Math.max(1, Math.ceil(L / MOUND_STEP));
    for (let k = 0; k < n; k++) {
      const p0 = add(a, mul(sub(b, a), k / n)), p1 = add(a, mul(sub(b, a), (k + 1) / n));
      out.push({ a: p0, b: p1, y: heightOver(p0, p1) });
    }
  }
  return out;
}

// He walks `way` from t0 at `o.v` (the cycle's own pace by default, played 0.8 to 1.3 as fast): a
// stretch of the cycle a leg (or a piece of one near the mound), each crossing the last at the same
// point in the stride half way through a short mix, as bases.js runAlong carries a run. From a
// standing start the first stretch starts half a mix's travel behind him (bodies.js runTo: a mix
// out of a man at rest surges). Returns when he's at the end of it, still walking.
export function walkAlong(B, way, t0, o = {}) {
  const p = clamp((o.v ?? WALK_V) / WALK_V, 0.8, 1.3), u = WALK_V * p, dur = WALK.duration, fade = o.fade ?? 0.35;
  let t = t0, start = null;
  for (const { a: pa, b: pb, y } of stretchesOf(way)) {
    const L = flat(pa, pb), h = faceTo(pa, pb);
    if (start == null) {
      const lead = (u * fade) / 2, at = sub(pa, ahead(h, lead));
      B.play('run_walk', t, { frame: { at: [at[0], y, at[2]], yaw: h }, speed: p, fade });
      start = t;
      t += (L + lead) / u;
    } else {
      const tm = t, ph = (((((tm - start) * p) / dur) % 1) + 1) % 1, st = tm - ((ph + 1) * dur) / p;
      const here = B.frameAt(tm).at, r = rootAt(WALK, (tm - st) * p), at = sub(here, turn([r.at[0], 0, r.at[1]], h));
      B.play('run_walk', st, { frame: { at: [at[0], y, at[2]], yaw: h }, speed: p, fade: 0.2, from: tm - 0.1 });
      start = st;
      t = tm + L / u;
    }
  }
  return t;
}

// He comes to rest at `at` at t in `clip` (stand_idle unless it says), turned toward `face` but no
// further than REST_TURN from the way he's facing then.
export function restAt(B, at, face, t, clip = 'stand_idle') {
  const was = B.facingAt(t), yaw = was + clamp(wrap(face - was), -REST_TURN, REST_TURN);
  B.play(clip, t, { frame: { at: [at[0], groundHeight(at[0], at[2]), at[2]], yaw }, fade: REST_FADE });
  return t;
}

// A way kept clear of men standing (`avoid`): a leg that passes within AVOID of one goes out round
// him instead, and a man who starts within AVOID of one steps away from him first (a play can leave
// a runner on the bag and the fielder who covered it right by him). One standing by the spot a man's
// going to is the room check's: planBetween holds the man going till it's clear.
const AVOID = 3;
function roundMen(pts, avoid) {
  if (!avoid?.length) return pts;
  // a man who starts within reach of one steps away from him first
  const out = [pts[0]], near = avoid.filter((q) => flat(q, pts[0]) < AVOID && flat(q, pts[pts.length - 1]) >= AVOID + 0.5);
  if (near.length) {
    const q = near.reduce((a, b) => (flat(a, pts[0]) <= flat(b, pts[0]) ? a : b));
    let n = sub(pts[0], q);
    if (Math.hypot(n[0], n[2]) < 0.3) n = sub(pts[pts.length - 1], pts[0]);
    out.push(add(q, mul(unitOf(n), AVOID + 0.5)));
  }
  for (let i = 1; i < pts.length; i++) {
    const a = out[out.length - 1], b = pts[i];
    for (const q of avoid) {
      if (flat(q, a) < AVOID + 0.5 || flat(q, b) < AVOID + 0.5 || nearSeg(q, a, b) >= AVOID) continue;
      const ab = sub(b, a), L = ab[0] * ab[0] + ab[2] * ab[2], f = clamp(((q[0] - a[0]) * ab[0] + (q[2] - a[2]) * ab[2]) / L, 0, 1);
      let n = sub(add(a, mul(ab, f)), q);
      if (Math.hypot(n[0], n[2]) < 0.3) n = [-ab[2], 0, ab[0]];
      out.push(add(q, mul(unitOf(n), AVOID + 0.5)));
      break;
    }
    out.push(b);
  }
  return out;
}

// He goes from where he is at t0 to `spot` and rests there facing `face` (`o.rest`, stand_idle by
// default): a walk, or for a long way a jog and a pull-up; off the mound's slope downhill and round
// it, round behind the plate where his way would take him through the catcher or the umpire, as a
// jog off does (bases.js), round anybody standing (`o.avoid`), by way of `o.via` if it says, and the
// last few feet toward the way he's to face, so the rest needn't turn him far. A man near enough
// rests where he is. Returns when he's resting, or null if he couldn't be by `o.by` (and then he's
// sent nowhere).
export function goTo(B, spot, face, t0, o = {}) {
  const from = B.spotAt(t0), rest = o.rest || 'stand_idle', by = o.by ?? Infinity;
  if (flat(from, spot) < 1.5) return restAt(B, from, face, t0, rest);
  const pts = [from], off = offSlope(from);
  if (off) pts.push(off);
  if (BEHIND_THE_PLATE.some((q) => nearSeg(q, from, spot) < 4 && flat(q, spot) > 6 && flat(q, from) > 6)) pts.push([0, 0, -17]);
  if (o.via) pts.push(o.via);
  const lead = !o.via && Math.abs(wrap(faceTo(pts[pts.length - 1], spot) - face)) <= 100 && flat(pts[pts.length - 1], spot) > LEAD_IN + 2;
  if (lead) pts.push(sub(spot, ahead(face, LEAD_IN)));
  pts.push(spot);
  const way = wayPath(easeCorners(roundMen(roundMound(pts), o.avoid)));
  if (way.len <= BETWEEN.walkFar || o.walk) {
    const v = clamp(way.len / Math.max(1, by - t0 - 2), WALK_V, WALK_V * 1.3);
    const T = cloneBody(B), arrive = walkAlong(T, way, t0, { v });
    if (arrive - REST_FADE / 2 + REST_FADE <= by) {
      walkAlong(B, way, t0, { v });
      return restAt(B, spot, face, arrive - REST_FADE / 2, rest);
    }
  }
  // a long way, or too far to walk in the time: a jog, pulled up at the spot, and the last few feet
  // walked where the pull-up leaves him short of it or past it (a jog cuts a corner near its end)
  const jog = (X) => {
    const on = stopAt(X, way, t0, way.len, { v: BETWEEN.jog }).on + 0.3, here = X.spotAt(on);
    if (flat(here, spot) <= 2) return { t: restAt(X, here, face, on, rest), at: here };
    const arrive = walkAlong(X, wayPath([here, spot]), on);
    return { t: restAt(X, spot, face, arrive - REST_FADE / 2, rest), at: spot };
  };
  if (jog(cloneBody(B)).t + REST_FADE > by) return null;
  return jog(B).t;
}

// The field put back between at-bats. `men` is every man the play can have moved, each
// { B, slot, role, go }: his plan so far (a body seeded with what he's doing, bodies.js) and when
// he's free of it. `p` is the payload and `cast` its cast; everyone's to be at rest by `by`.
// Adds each man's clips to his body and returns, for each one sent somewhere, { slot, role, to,
// rest, end }: where to, in what (`rest`) and when he's there.
export function planBetween({ p, cast, men, by }) {
  const taken = Array.isArray(p.basesAfter) ? p.basesAfter : [false, false, false];
  const castOf = (m) => cast.find((c) => c.look.slot === m.slot && c.id === m.B.id) || cast.find((c) => c.look.slot === m.slot);
  const jobs = [];
  for (const m of men) {
    const c = castOf(m), here = m.B.spotAt(m.go);
    let job = null;
    if (m.role === 'pitcher') job = { spot: RUB_SPOT, face: 180, rest: 'pitch_rub', walk: true };
    else if (m.role === 'catcher') job = { spot: CATCHER_SPOT, face: 0 };
    else if (m.role === 'fielder' && c) job = { spot: [c.at[0], 0, c.at[2]], face: faceHome(c.at) };
    else if (m.role === 'ump' && c) job = c.id === 'ump:plate' ? { spot: UMP_ASIDE, face: faceTo(UMP_ASIDE, [0, 0, 60]) } : { spot: [c.at[0], 0, c.at[2]], face: c.yaw };
    else if (m.role === 'batter' || m.role === 'runner') {
      // a man on a bag the play left taken stands easy on it; anyone else is out, or in, and goes off
      const bag = [1, 2, 3].find((b) => taken[b - 1] && flat(here, BAGS[b]) < 8);
      job = bag ? { spot: here, face: faceTo(here, [RUBBER[0], 0, RUBBER[2]]), stay: true } : { off: true };
    }
    if (job) jobs.push({ ...m, ...job, here });
  }
  // the men who needn't go anywhere first, so everyone going goes round them; then the men going off,
  // the furthest first, each to the deepest spot in his side's row that's left and up to it square
  // on, so he passes nobody stood in it; then everyone else, the furthest from his spot first
  const side = dugoutOf(p), off = jobs.filter((j) => j.off), rest = jobs.filter((j) => !j.off);
  off.sort((a, b) => flat(b.here, dugoutSpot(side, 0)) - flat(a.here, dugoutSpot(side, 0)));
  off.forEach((j, i) => { j.spot = dugoutSpot(side, off.length - 1 - i); j.via = [j.spot[0], 0, j.spot[2] + 10]; j.face = faceTo(j.spot, [0, 0, 60]); });
  const still = rest.filter((j) => j.stay || flat(j.here, j.spot) < 1.5), going = rest.filter((j) => !still.includes(j));
  going.sort((a, b) => flat(b.here, b.spot) - flat(a.here, a.spot));
  const gone = [], out = [], standing = [];
  // the least room a man's way keeps from everyone sent before him, over his way and a beat after
  const roomOf = (T, t0, t1) => {
    let least = Infinity;
    for (let t = t0; t <= t1; t += 0.2) {
      const q = T.spotAt(t);
      for (const g of gone) least = Math.min(least, flat(q, g.B.spotAt(t)) - g.need);
    }
    return least;
  };
  for (const j of [...still, ...off, ...going]) {
    // room enough from each, or from a man he starts nearer than that, half a foot less than he
    // started, never under 2.1 ft (offField's rule)
    const need0 = (g) => Math.max(2.1, Math.min(BETWEEN.room, flat(j.here, g.B.spotAt(j.go)) - 0.5));
    let best = null;
    for (let wait = 0; wait <= BETWEEN.wait + 1e-9; wait += 0.4) {
      const T = cloneBody(j.B), end = goTo(T, j.spot, j.face, j.go + wait, { by, rest: j.rest, walk: j.walk, via: j.via, avoid: standing });
      if (end == null) break;
      gone.forEach((g) => { g.need = need0(g); });
      const room = roomOf(T, j.go + wait, end + 1);
      if (!best || room > best.room) best = { wait, room };
      if (room >= 0) break;
    }
    if (!best) continue;
    const end = goTo(j.B, j.spot, j.face, j.go + best.wait, { by, rest: j.rest, walk: j.walk, via: j.via, avoid: standing });
    if (end == null) continue;
    gone.push({ B: j.B, need: 0 });
    standing.push(j.stay || flat(j.here, j.spot) < 1.5 ? j.here : j.spot);
    out.push({ slot: j.slot, role: j.role, to: j.spot, rest: j.rest || 'stand_idle', end, off: !!j.off, stay: !!j.stay });
  }
  return out;
}

// The on-deck hitter between pitches: his stance (bat_stance, a loop) from t0, and a practice swing
// every six to eleven seconds till t1, with one starting at each time in `at` (for the camera on
// him) and the rest kept clear of those. Returns [{ clip, t, fade }] in order.
export function deckPlan(t0, t1, salt, at = []) {
  const swing = CLIPS.deck_swing.duration, out = [{ clip: 'bat_stance', t: t0, fade: 0 }];
  const fixed = at.filter((x) => x >= t0 && x + swing < t1), clear = (t) => fixed.every((x) => t + swing + 1 <= x || t >= x + swing + 1);
  const swings = fixed.slice();
  let t = t0 + 1.5 + (hashStr('deck|' + salt) % 3000) / 1000, k = 0;
  while (t + swing < t1) {
    if (clear(t)) swings.push(t);
    t += swing + 2 + (hashStr(`deck|${salt}|${k++}`) % 5000) / 1000;
  }
  swings.sort((a, b) => a - b);
  for (const s of swings) {
    out.push({ clip: 'deck_swing', t: s, fade: 0.3 });
    out.push({ clip: 'bat_stance', t: s + swing, fade: 0.3 });
  }
  return out;
}

// The cameras between at-bats, from `from` to `until` (the next payload's due): wide over the field;
// then, where there's time, the on-deck circle (`deck`, a camera by name) for a swing, the pitcher
// off the back of the mound once he's rubbing up the ball (`rubAt`), a cutaway to the crowd, and
// wide again; and on a long hold round again, a cutaway every BETWEEN.wide seconds of the wide
// shot (the on-deck circle, the city beyond the park, the crowd), wide at the end.
// Returns [{ at, shot, swing }]: `swing` is when the on-deck hitter's swing is wanted for his shot.
export function shotsBetween({ from, until, deck, rubAt }) {
  const out = [], room = until - from;
  if (room < 2.5) return out;
  out.push({ at: from, shot: 'high' });
  if (room < 14) return out;
  let t = from + clamp(room * 0.22, 4, 7);
  const fits = (len) => t + len <= until - 3;
  if (deck && fits(5.5)) { out.push({ at: t, shot: deck, swing: t + 0.6 }); t += 5.5; }
  if (Number.isFinite(rubAt) && rubAt < until - 6) {
    const at = Math.max(t, rubAt - 0.3);
    if (at + 4.5 <= until - 3) { out.push({ at, shot: 'rub' }); t = at + 4.5; }
  }
  if (fits(4)) { out.push({ at: t, shot: 'crowd' }); t += 4; }
  if (out[out.length - 1].shot !== 'high') out.push({ at: t, shot: 'high' });
  const again = [deck && { shot: deck, len: 5.5, swing: 0.6 }, { shot: 'sky', len: 5 }, { shot: 'crowd', len: 4 }].filter(Boolean);
  for (let k = 0; ; k++) {
    const c = again[k % again.length], at = t + BETWEEN.wide;
    if (at + c.len > until - 3) break;
    out.push({ at, shot: c.shot, ...(c.swing ? { swing: at + c.swing } : {}) }, { at: at + c.len, shot: 'high' });
    t = at + c.len;
  }
  return out;
}
