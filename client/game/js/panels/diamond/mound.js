// DEADBALL · THE MOUND. A trip out to the pitcher before an at-bat (sim v5's `mound`, which the
// server's manager decided: plugins/broadcast/sports/baseball.js), cut as a broadcast cuts one.
//
// THE VISIT (TRIP.visit). The pitching coach comes up out of the dugout and walks out, a long lens
// following him from the far camera well; then the picture's on the back of the mound (the `rub`
// camera), where the catcher has come out too and the pitcher has stepped off it. The coach gets
// there, has his word with his glove over his mouth and the catcher listening, and the two of them
// go back as the at-bat cuts in.
//
// THE CHANGE (TRIP.change). The manager comes out the same way. On the back of the mound he has his
// word with the catcher and the man he's taking out, who then walks off to the dugout, the long lens
// with him. The new man jogs in from the pen down the line in foul ground, the lens with him too;
// back on the mound the manager hands him the ball and walks off, and the at-bat cuts in.
//
// Every jump is under a cut: a man the picture leaves is put where the next shot needs him (a man
// walking out is nearer the mound when the camera comes back to him). The men in it are the cast's
// (diamond/cast.js tripCast gives the manager or the coach, and the man coming out, two of the
// fielding side's bench places), the battery included; when the at-bat cuts in the director puts the
// battery back where the cast has them and the others back on the bench.
//
// Pure: no DOM and no GL, so the gates run it.

import { makeBody, flat, faceTo, add, sub, mul } from './bodies.js';
import { goTo, walkAlong, restAt } from './between.js';
import { wayPath, dugoutOf } from './bases.js';
import { offLine, groundHeight, DUGOUT, FOUL_GROUND } from './geo.js';
import { CLIPS } from './clips.js';
import { TRIP } from './timing.js';

export { TRIP };
// Where it happens: the knot of them off the back of the mound on the grass (round `centre`,
// clear of the slope, where between.js's visit and the rub-up are), each man's place in it as an
// offset from the centre by side (+1 the fielding side's dugout); where the staff come up out of the
// dugout (along the line and off it); and the pen down the line in foul ground, the new man's
// start. `jog` is how fast he comes in (ft/s) and `seen` how far out he is when the lens finds him.
export const MOUND = Object.freeze({
  centre: [0, 0, 73.6],
  // (the new man takes the place the man coming out left: from the rub camera, the far side of the
  // knot is behind the staff man)
  pitcher: [0, 0, -2.6], staff: [2.5, 0, 1.5], catcher: [-2.5, 0, 1.5], fresh: [0, 0, -2.6],
  gate: Object.freeze({ s: 96, off: FOUL_GROUND.line - 2 }),
  pen: Object.freeze({ s: 182, off: 24 }),
  jog: 13, seen: 66,
  // how far out the staff are when the picture comes back to them
  near: 13,
});

const unit = (v) => { const l = Math.hypot(v[0], v[2]) || 1; return [v[0] / l, 0, v[2] / l]; };
// A still: he stands at `at` facing `yaw` from t (a jump, under a cut).
const stand = (B, at, yaw, t, clip = 'stand_idle') => B.play(clip, t, { frame: { at: [at[0], groundHeight(at[0], at[2]), at[2]], yaw }, fade: 0 });
// He walks straight from where he is toward `to` for `secs` seconds and no further (the camera's
// gone by then), at a brisk walk. Returns when he stops being planned.
const walkFor = (B, to, t, secs) => {
  const here = B.spotAt(t), L = Math.min(flat(here, to), secs * 4.4);
  if (L < 2) return t;
  return walkAlong(B, wayPath([here, add(here, mul(unit(sub(to, here)), L))]), t, { v: 4.4 });
};

// The trip for payload `p`, its cast `cast`, from world time T0 to the at-bat's cut in at t1.
// Returns { kind, bodies, shots, staff, out, talks, end } or null for no trip.
export function planTrip({ p, cast, T0, t1 }) {
  const m = p?.mound;
  if (!m || m.between || (m.kind !== 'visit' && m.kind !== 'change')) return null;
  const by = (f) => (cast || []).find(f) || null;
  const P = by((c) => c.look.role === 'pitcher' && c.look.slot % 12 === 0), C = by((c) => c.look.role === 'catcher');
  const S = by((c) => c.look.trip === 'staff'), O = m.kind === 'change' ? by((c) => c.look.trip === 'out') : null;
  if (!P || !C || !S || (m.kind === 'change' && !O)) return null;
  // the fielding side's dugout and pen: the batting side's is dugoutOf's (+1 third base)
  const side = -dugoutOf(p);
  const spot = (o) => add(MOUND.centre, [side * o[0], 0, o[2]]);
  const Q = MOUND.centre, PS = spot(MOUND.pitcher), SS = spot(MOUND.staff), CS = spot(MOUND.catcher), NS = spot(MOUND.fresh);
  const gate = offLine(side, MOUND.gate.s, MOUND.gate.off), dug = offLine(side, (DUGOUT.from + DUGOUT.to) / 2, FOUL_GROUND.line + 3);
  const body = (c, at, yaw, n) => makeBody({ n, id: c.id, slot: c.look.slot, role: c.look.role, at, yaw, mirror: c.mirror, scale: c.scale, place: true });
  const bodies = [], shots = [], talks = [];
  const cut = (at, shot) => shots.push({ at, shot });
  // the far camera well's long lens on a man walking, `frame` feet top to bottom where he is
  const eye = [-side * 48, 8, 16];
  const follow = (B, frame = 9) => ({ shot: 'field', eye, track: (t) => B.spotAt(t), frame });
  const talk = (B, t, face) => { restAt(B, B.spotAt(t), face, t); B.play('talk_mound', t + 0.35, { fade: 0.3 }); talks.push({ slot: B.slot, at: t + 0.35 }); return B.play('stand_idle', t + 0.35 + CLIPS.talk_mound.duration, { fade: 0.35 }); };
  const len = t1 - T0;

  // the staff man up out of the dugout and walking out, the lens with him
  const staff = body(S, gate, faceTo(gate, SS), 0);
  stand(staff, gate, faceTo(gate, SS), T0);
  const out1 = Math.min(6, len * 0.36);
  walkFor(staff, SS, T0 + 0.1, out1 - 0.1);
  cut(T0, follow(staff));
  // and on the mound, nearer: he walks in the rest of the way
  const near = add(SS, mul(unit(sub(gate, SS)), MOUND.near));
  const tB = T0 + out1;
  stand(staff, near, faceTo(near, SS), tB);
  const there = goTo(staff, SS, faceTo(SS, Q), tB + 0.05, { walk: true });
  cut(tB, 'rub');
  // the pitcher off the back of the mound and the catcher out, by the time the picture's there; on a
  // change the cast's pitcher is the new man, in the pen loosening up till the lens finds him
  const pen = offLine(side, MOUND.pen.s, MOUND.pen.off);
  const pitcher = m.kind === 'change' ? body(P, pen, faceTo(pen, Q), 1) : body(P, PS, faceTo(PS, Q), 1);
  const catcher = body(C, CS, faceTo(CS, Q), 2);
  if (m.kind === 'change') stand(pitcher, pen, faceTo(pen, Q), T0, 'idle_arm_stretch');
  else stand(pitcher, PS, faceTo(PS, Q), T0);
  stand(catcher, CS, faceTo(CS, Q), T0);
  bodies.push(staff, pitcher, catcher);

  if (m.kind === 'visit') {
    // a word, the catcher with his glove up too, and back they go
    const said = (there ?? tB + 3) + 0.15;
    talk(staff, said, faceTo(SS, PS));
    talk(catcher, said + 0.5, faceTo(CS, PS));
    pitcher.play('idle_cap_tug', said + 1.2, { fade: 0.3 });
    const off = said + 0.35 + CLIPS.talk_mound.duration + 0.4;
    walkFor(staff, gate, off, t1 - off);
    walkFor(catcher, [0, 0, -2.75], off + 0.3, t1 - off - 0.3);
    return { kind: 'visit', bodies, shots, talks, staff: staff.slot, end: t1 };
  }

  // the change: the man coming out is the one on the mound, and the new man's in the pen
  const old = body(O, PS, faceTo(PS, Q), 3);
  stand(old, PS, faceTo(PS, Q), T0);
  bodies.push(old);
  // the manager's word with the two of them
  const said = (there ?? tB + 3) + 0.15;
  talk(staff, said, faceTo(SS, PS));
  // then the man coming out walks off to the dugout, the lens on him
  const gone = said + 0.35 + CLIPS.talk_mound.duration - 0.6;
  const off1 = Math.min(gone + 3.4, t1 - 9);
  walkFor(old, dug, gone, t1 - gone);
  cut(gone + 0.4, follow(old, 10));
  // the new man jogging in from the pen, picked up `seen` feet out, the lens on him
  const from = add(NS, mul(unit(sub(pen, NS)), Math.min(MOUND.seen, flat(pen, NS))));
  stand(pitcher, from, faceTo(from, NS), off1);
  const arrive = goTo(pitcher, NS, faceTo(NS, SS), off1 + 0.02, { jog: MOUND.jog }) ?? off1 + 6;
  cut(off1, follow(pitcher, 11));
  // back on the mound: the ball to him, and the manager off
  cut(Math.min(arrive - 0.6, t1 - 4.5), 'rub');
  const hand = Math.min(arrive + 0.1, t1 - 4.2);
  talk(staff, hand, faceTo(SS, NS));
  talk(catcher, hand + 0.6, faceTo(CS, NS));
  const leave = hand + 0.35 + CLIPS.talk_mound.duration + 0.2;
  walkFor(staff, gate, leave, t1 - leave);
  walkFor(catcher, [0, 0, -2.75], leave + 0.4, t1 - leave - 0.4);
  return { kind: 'change', bodies, shots, talks, staff: staff.slot, out: old.slot, arrive, end: t1 };
}
