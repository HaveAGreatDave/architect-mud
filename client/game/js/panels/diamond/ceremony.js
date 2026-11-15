/**
 * DEADBALL — THE CHAMPIONS. What a final's last out turns into, after the pile (between.js
 * planPile), and the Charles B. Hughson Memorial Cup after that.
 *
 *   planMob       the pile gets up, the bench and the coaches come running out, the champions go
 *                 round each other slapping hands, and then they're one mass bouncing at the mound
 *                 (or the plate, on a walk-off) till the Cup's payload comes
 *   mobShots      the cameras on it: a push in on the pile, round it on a steadicam, a jib craning
 *                 up off the mob, the fireworks over the outfield and the crowd
 *   planCeremony  the Cup's payload (`phase: 'crown'`): the champions round the trophy's table by the
 *                 mound, and each of the night's stars (the payload's `stars`) walks up, lifts it off
 *                 the table and holds it up over his head; the last keeps it up while the team crowds
 *                 round him
 *   cupAt         where the Cup is at a time: on its table, or in a man's hands (his wrists, from the
 *                 world's pose), eased onto them as he takes it and off them as he puts it down
 *
 * The bodies are planned as between.js plans them (bodies.js makeBody, between.js goTo) and the
 * director puts their clips into the world. Pure: no DOM and no GL, so the gates run it.
 */

import { CLIPS } from './clips.js';
import { MOUND, groundHeight, DEG } from './geo.js';
import { add, sub, mul, flat, faceTo, hashStr, clamp, makeBody, onOf } from './bodies.js';
import { goTo } from './between.js';
import { toPark } from './world.js';

// Where the Cup's table stands (gl/ballpark-mesh.js TROPHY_AT, which final-smoke holds it to), how
// high its top is, and where the man who lifts it stands: behind it, facing the plate.
export const CUP_STAND = Object.freeze([-14, 0, 50]);
export const CUP_TABLE = 3;
export const LIFT_SPOT = Object.freeze([CUP_STAND[0], 0, CUP_STAND[2] + 1.75]);

const smooth = (x) => { const u = clamp(x, 0, 1); return u * u * (3 - 2 * u); };
const unit = (v) => { const l = Math.hypot(v[0], v[2]) || 1; return [v[0] / l, 0, v[2] / l]; };
const left = (yaw) => [Math.cos(yaw * DEG), 0, -Math.sin(yaw * DEG)];
const ground = (p) => [p[0], groundHeight(p[0], p[2]), p[2]];

// Where the champions pile on: at the mound, or at the plate on a walk-off, where the man who scored is
// (between.js planPile's own centre).
export const pileCentre = (p, end) => (end?.winner === p?.battingTeam ? [0, 0, 4] : [MOUND[0], 0, MOUND[1] - 1.5]);
// The champions' side, home or away.
export const winSide = (p, end) => {
  const batSide = p?.half === 'top' ? 'away' : 'home', fieldSide = batSide === 'away' ? 'home' : 'away';
  return end?.winner === p?.battingTeam ? batSide : fieldSide;
};

// THE MOB. `lie`: how long the pile lies there once the last man's on before it gets up, and `rise`
// between one man getting up and the next, the top of the pile first; `five`: how far apart two men
// stand to slap hands (each hand out a foot in front of him), and `fives` how many rounds of it where
// there's time; `rings`: the mob's rings round the middle, each its radius and how many it holds;
// `run`: how fast (ft/s) the bench and the coaches come out; `least`: the fewest seconds from the pile
// to the next payload that leaves room for any of it.
export const MOB = Object.freeze({ lie: 1.6, rise: 0.22, five: 2, fives: 2, rings: Object.freeze([[1.8, 4], [3.5, 8], [5.2, 12]]), run: 21, least: 14, bounce: Object.freeze(['celebrate_leap', 'celebrate_pump']) });
const ROLES = new Set(['pitcher', 'catcher', 'fielder', 'batter', 'runner', 'coach', 'bench']);

// `pile` is what planPile sent (each { slot, role, to, rest, end }), `men` as planPile has them (each
// { B, slot, role, go, c }), `from` when the pile went on and `by` when everyone's to be where he's
// going. Adds each champion's clips to his body and returns { gone, rise, fives, mobAt, centre }, or
// null with no room: `gone` as planPile's (the bench joining, and each man's place in the mob),
// `fives` when each pair slapped hands, `mobAt` when the first man's bouncing in the mob.
export function planMob({ p, end, men, pile, from, by }) {
  if (!p || !end?.champion || !Array.isArray(pile) || !(by - from >= MOB.least)) return null;
  const centre = pileCentre(p, end), side = winSide(p, end);
  const sent = new Map(pile.map((g) => [g.slot, g]));
  const champs = men.filter((m) => ROLES.has(m.role) && m.c?.look?.side === side);
  const piled = champs.filter((m) => sent.has(m.slot) && !sent.get(m.slot).off);
  const divers = piled.filter((m) => sent.get(m.slot).rest === 'pile_dive').sort((a, b) => sent.get(b.slot).end - sent.get(a.slot).end);
  const pileEnd = piled.reduce((t, m) => Math.max(t, sent.get(m.slot).end), from);
  const rise = clamp(pileEnd + MOB.lie, from + 5, by - 9);
  const gone = [], up = new Map();
  // the leaper is up already, and goes on leaping till the pile's off the ground
  for (const m of piled) if (sent.get(m.slot).rest !== 'pile_dive') up.set(m.slot, rise);
  // the bench and the coaches out of the dugout and the boxes, to the edge of the pile, leaping there
  const late = champs.filter((m) => !sent.has(m.slot));
  late.forEach((m, i) => {
    const here = m.B.spotAt(m.go), dir = unit(sub(here, centre)), spot = add(centre, mul(dir, 5 + (i % 2) * 1.6));
    const t = goTo(m.B, spot, faceTo(spot, centre), Math.max(m.go, from + 0.8 + 0.3 * i), { by: rise - 0.5, rest: 'celebrate_leap', jog: MOB.run });
    if (t == null) return;
    up.set(m.slot, Math.max(rise, t + 0.4));
    gone.push({ slot: m.slot, role: m.role, to: spot, rest: 'celebrate_leap', end: t, joined: true });
  });
  // the pile gets up, the top of it first, each man standing where he lay (a dive that ended up the
  // heap sinks onto the grass as he rises)
  divers.forEach((m, j) => {
    const t = rise + MOB.rise * j, here = m.B.spotAt(t), yaw = m.B.facingAt(t);
    m.B.play('slide_up_head', t, { frame: { at: ground(here), yaw }, fade: 0.55 });
    up.set(m.slot, t + CLIPS.slide_up_head.duration - 0.2);
  });
  const mob = champs.filter((m) => up.has(m.slot));
  if (mob.length < 2) return { gone, rise, fives: [], mobAt: null, centre };
  // round each other slapping hands, a partner a round dealt off the game, while there's time
  const free = new Map(mob.map((m) => [m.slot, up.get(m.slot)]));
  const fives = [], salt = `${p.inning}|${p.half}|${end.winner}`;
  const mobBy = by - 6;
  for (let r = 0; r < MOB.fives; r++) {
    const deal = mob.map((m) => ({ m, k: hashStr(`${salt}|five|${r}|${m.slot}`) })).sort((a, b) => a.k - b.k).map((x) => x.m);
    for (let i = 0; i + 1 < deal.length; i += 2) {
      const a = deal[i], b = deal[i + 1], t0 = Math.max(free.get(a.slot), free.get(b.slot)) + 0.15;
      if (t0 + 6 > mobBy) continue;
      const pa = a.B.spotAt(t0), pb = b.B.spotAt(t0);
      // somewhere between them, a little out from the middle so they come off the heap to do it
      let mid = mul(add(pa, pb), 0.5);
      const out = flat(mid, centre) < 0.3 ? [1, 0, 0] : unit(sub(mid, centre));
      mid = add(mid, mul(out, Math.max(0, 7 - flat(mid, centre))));
      let ax = unit(sub(pb, pa));
      if (flat(pa, pb) < 0.5) ax = [out[2], 0, -out[0]];
      const faceA = faceTo([0, 0, 0], ax), faceB = faceA + 180;
      // each a little to his own left, so the two right hands meet
      const sa = add(add(mid, mul(ax, -MOB.five / 2)), mul(left(faceA), 0.6)), sb = add(add(mid, mul(ax, MOB.five / 2)), mul(left(faceB), 0.6));
      const ta = goTo(a.B, sa, faceA, t0, { by: mobBy - 2, jog: 14 }), tb = ta == null ? null : goTo(b.B, sb, faceB, t0, { by: mobBy - 2, jog: 14 });
      if (ta == null || tb == null) continue;
      const T = Math.max(ta, tb) + 0.2;
      a.B.play('high_five', T, { frame: { at: ground(sa), yaw: faceA }, fade: 0.25 });
      b.B.play('high_five', T, { frame: { at: ground(sb), yaw: faceB }, fade: 0.25 });
      fives.push(T + 0.55);
      free.set(a.slot, T + CLIPS.high_five.duration);
      free.set(b.slot, T + CLIPS.high_five.duration);
    }
  }
  // one mass: rings round the middle, the men dealt to the places nearest round from where they are,
  // facing in, every man bouncing (his own way, off his name)
  const spots = [];
  let left_ = mob.length;
  for (const [r, cap] of MOB.rings) {
    const n = Math.min(cap, left_);
    if (n <= 0) break;
    const a0 = (hashStr(`${salt}|ring|${r}`) % 360) * DEG;
    for (let k = 0; k < n; k++) spots.push({ r, a: a0 + (k / n) * Math.PI * 2 });
    left_ -= n;
  }
  const angleOf = (q) => Math.atan2(q[0] - centre[0], q[2] - centre[2]);
  const order = mob.map((m) => ({ m, a: angleOf(m.B.spotAt(free.get(m.slot))) })).sort((x, y) => x.a - y.a);
  const byRing = new Map();
  for (const s of spots) { if (!byRing.has(s.r)) byRing.set(s.r, []); byRing.get(s.r).push(s); }
  // the men nearest the middle take the inner ring
  const near = [...order].sort((x, y) => flat(x.m.B.spotAt(free.get(x.m.slot)), centre) - flat(y.m.B.spotAt(free.get(y.m.slot)), centre));
  let at = 0, mobAt = null;
  for (const [r, list] of byRing) {
    const mine = near.slice(at, at + list.length).sort((x, y) => x.a - y.a);
    at += list.length;
    list.sort((x, y) => x.a - y.a);
    mine.forEach((x, k) => {
      const s = list[k], spot = [centre[0] + Math.sin(s.a) * r, 0, centre[2] + Math.cos(s.a) * r];
      const rest = MOB.bounce[hashStr(`${x.m.B.id}|bounce`) % MOB.bounce.length];
      const t = goTo(x.m.B, spot, faceTo(spot, centre), free.get(x.m.slot) + 0.1, { by, rest, jog: 12 });
      if (t == null) return;
      mobAt = mobAt == null ? t : Math.min(mobAt, t);
      gone.push({ slot: x.m.slot, role: x.m.role, to: spot, rest, end: t, mob: true });
    });
  }
  return { gone, rise, fives, mobAt, centre };
}

// ── the cameras ─────────────────────────────────────────────────────────────
// A camera going round `c` (a point) at `r` feet and `h` feet up, `w` radians a second from `a0`
// (0 is from the plate's side, looking out), its lens `fov`, looking at `look` feet up. `t0` is its
// cut in. A track gives { eye, at, fov, r } (camera.js aimOf 'party').
export function orbit({ c, r, h, w = 0, a0 = Math.PI, t0, fov = 34, look = 3.5, r1 = r, h1 = h, dur = 1, fov1 = fov, look1 = look }) {
  return (t) => {
    const k = smooth((t - t0) / dur), a = a0 + w * (t - t0), R = r + (r1 - r) * k, H = h + (h1 - h) * k;
    const eye = [c[0] + Math.sin(a) * R, Math.max(H, groundHeight(c[0] + Math.sin(a) * R, c[2] + Math.cos(a) * R) + 2.5), c[2] + Math.cos(a) * R];
    return { eye, at: [c[0], look + (look1 - look) * k, c[2]], fov: fov + (fov1 - fov) * k, r: Math.max(30, R * 0.8) };
  };
}
const party = (track) => ({ shot: 'party', track });
// The cameras through the mob, from `from` (the pile going on) to `by`: [{ at, shot }]. `bursts` are the
// shells' times, for the wide shot over the outfield when a wave goes up. With `motion` false every
// camera stands still.
export function mobShots({ centre, from, rise, mobAt, by, bursts = [], motion = true, salt = '' }) {
  const out = [{ at: from, shot: 'high' }];
  const c = centre, home = Math.atan2(-c[0], -c[2]);
  if (!motion) {
    out.push({ at: from + 2.2, shot: c[2] < 20 ? 'bat' : 'mound' });
    if (mobAt != null && mobAt + 8 < by) out.push({ at: mobAt + 6, shot: 'high' });
    return out;
  }
  const spin = hashStr(salt) % 2 ? 1 : -1;
  // in on the pile from the plate's side, low
  out.push({ at: from + 2.2, shot: party(orbit({ c, r: 64, r1: 30, h: 5.5, h1: 4.6, a0: home, w: 0.012 * spin, t0: from + 2.2, dur: Math.max(3, rise - from - 2.2), fov: 22, fov1: 30, look: 2.5, look1: 3.2 })) });
  // round the pile as it gets up and the hands come out
  out.push({ at: rise - 0.6, shot: party(orbit({ c, r: 26, h: 5.2, a0: home + 0.5 * spin, w: 0.2 * spin, t0: rise - 0.6, fov: 38, look: 3.8 })) });
  let t = mobAt != null ? Math.max(mobAt - 0.3, rise + 4) : rise + 7;
  const waves = [];
  for (const b of [...bursts].sort((x, y) => x - y)) if (!waves.length || b - waves[waves.length - 1] > 3) waves.push(b);
  // then round again till the end: a jib craning up off the mob, a steadicam in tight going the other
  // way, the shells over the outfield where a wave's going up, the crowd, wide and slow round
  const cycle = [
    (t0) => ({ len: 8, shot: party(orbit({ c, r: 18, r1: 58, h: 4, h1: 46, a0: home + 0.9, w: 0.14 * spin, t0, dur: 7.5, fov: 40, fov1: 34, look: 3.5, look1: 2 })) }),
    (t0) => ({ len: 7, shot: party(orbit({ c, r: 15, h: 4.4, a0: home - 0.6, w: -0.26 * spin, t0, fov: 44, look: 4.2 })) }),
    (t0) => { const wv = waves.find((x) => x > t0 - 0.5 && x < t0 + 6); return wv ? { len: 4.2, shot: 'shells', at: wv - 0.6 } : null; },
    (t0) => ({ len: 4, shot: 'crowd' }),
    (t0) => ({ len: 9, shot: party(orbit({ c, r: 34, h: 10, a0: home + 2.2, w: 0.09 * spin, t0, fov: 36, look: 3 })) }),
  ];
  for (let k = 0; t < by - 3; k++) {
    const x = cycle[k % cycle.length](t);
    if (!x) continue;
    const at = Math.max(t, x.at ?? t);
    if (at + 2 > by) break;
    out.push({ at, shot: x.shot });
    t = at + x.len;
  }
  return out;
}

// ── the Cup ─────────────────────────────────────────────────────────────────
// The ceremony's clock, in seconds: the cut to it covered by its card (`card`), the first star off
// at `first`, a lift (cup_lift, the cup off the table at `grab` into it), how long each holds it up
// (`hold`, the first longer), and how long the last waits before the team crowds round him.
export const CEREMONY = Object.freeze({ card: 2.6, first: 3.2, grab: 0.75, hold: Object.freeze([7, 5.5]), set: 0.75, crowd: 1.2, gap: 0.6 });
// Where the champions stand round the table, behind it as the plate sees it: a front arc of five
// and a back one of seven, facing the plate.
const ARCS = Object.freeze([[6, 5, 70], [9.5, 7, 78]]);
export function standSpots(n) {
  const out = [];
  for (const [r, cap, span] of ARCS) {
    for (let k = 0; k < cap && out.length < n; k++) {
      const a = (-span + (2 * span * (k + 0.5)) / cap) * DEG;
      out.push([CUP_STAND[0] + Math.sin(a) * r, 0, CUP_STAND[2] + Math.cos(a) * r]);
    }
  }
  return out;
}
// The plan for the Cup's payload, from `t0` (the world's time it's staged) to `until`. `cast` is
// crownCast's: the stars first. Returns { bodies (bodies.js plans, placed where the cast stands
// them), holders ([{ slot, grab, release }]: who has the Cup, from when to when), hoists (when each
// has it up), shots, until }.
export function planCeremony({ cast, stars = [], t0, until, motion = true, salt = '' }) {
  const C = CEREMONY, face = (p) => faceTo(p, [CUP_STAND[0], 0, -20]);
  const men = (cast || []).filter((c) => c.look?.role !== 'ump');
  const spots = standSpots(men.length);
  // the stars in the front arc's middle, the rest round them
  const front = [2, 1, 3, 0, 4], order = [];
  const isStar = (c) => stars.includes(c.id);
  const starMen = stars.map((s) => men.find((c) => c.id === s)).filter(Boolean);
  const rest = men.filter((c) => !isStar(c));
  starMen.forEach((c, i) => order.push([c, spots[front[i]]]));
  const used = new Set(starMen.map((_, i) => front[i]));
  let j = 0;
  for (const c of rest) { while (used.has(j)) j++; order.push([c, spots[j]]); used.add(j); }
  const bodies = order.filter(([, at]) => at).map(([c, at], i) => {
    const B = makeBody({ n: 60, id: c.id, slot: c.look.slot, role: c.look.role, at, yaw: face(at), mirror: c.mirror, scale: c.scale });
    const bounce = MOB.bounce[hashStr(`${c.id}|bounce`) % MOB.bounce.length];
    B.play(bounce, t0 + 0.1 * (i % 5), { frame: { at: ground(at), yaw: face(at) }, fade: 0 });
    B.home = at;
    return B;
  });
  const of = (c) => bodies.find((B) => B.slot === c.look.slot);
  const holders = [], hoists = [];
  let t = t0 + C.first;
  starMen.forEach((c, i) => {
    const B = of(c);
    if (!B) return;
    const last = i === starMen.length - 1;
    const arrive = goTo(B, LIFT_SPOT, 180, t, { by: until, walk: true });
    if (arrive == null) return;
    const L = arrive + 0.35;
    B.play('cup_lift', L, { frame: { at: ground(LIFT_SPOT), yaw: 180 }, fade: 0.3 });
    const upAt = L + CLIPS.cup_lift.duration;
    B.play('cup_hoist', upAt, { fade: 0.15 });
    hoists.push(L + 1.7);
    const hold = C.hold[Math.min(i, C.hold.length - 1)];
    if (last) { holders.push({ slot: B.slot, grab: L + C.grab, release: Infinity }); return; }
    // down onto the table again (the lift, played backwards: cup_lift's keys in reverse), and back to
    // his place; the next man's off as he turns away
    const down = upAt + hold;
    B.play('cup_set', down, { fade: 0.2 });
    const off = down + CLIPS.cup_set.duration;
    holders.push({ slot: B.slot, grab: L + C.grab, release: down + CLIPS.cup_set.duration - C.set });
    goTo(B, B.home, face(B.home), off + 0.1, { by: until, walk: true, rest: 'celebrate_pump' });
    t = off - 0.4;
  });
  // the team crowds round the last man while he holds it up, everyone bouncing
  const lastHold = holders[holders.length - 1];
  if (lastHold) {
    const at = lastHold.grab + C.crowd + 1.6, others = bodies.filter((B) => B.slot !== lastHold.slot);
    others.forEach((B, k) => {
      // round him on his sides and behind, never between him and the table
      const a = (-120 + (240 * (k + 0.5)) / others.length) * DEG, r = 2.6 + 1.9 * (k % 2);
      const spot = [LIFT_SPOT[0] + Math.sin(a) * r, 0, LIFT_SPOT[2] + Math.cos(a) * r];
      const rest = MOB.bounce[(k + 1) % MOB.bounce.length];
      goTo(B, spot, faceTo(spot, LIFT_SPOT), Math.max(at + 0.12 * k, B.clips.length ? onOf(B.clips[B.clips.length - 1]) + 0.05 : at), { by: until, rest, walk: true });
    });
  }
  const shots = ceremonyShots({ t0, until, hoists, holders, motion, salt });
  return { bodies, holders, hoists, shots, until };
}

// The cameras on the Cup: down onto the table under the card, in low on each man as he lifts it,
// round the team, the shells, a jib up over them, and to finish a long pull back high over the park.
export function ceremonyShots({ t0, until, hoists = [], motion = true, salt = '' }) {
  const c = [CUP_STAND[0], 0, CUP_STAND[2] + 3], home = Math.atan2(-c[0], -c[2]);
  if (!motion) return [{ at: t0, shot: party(orbit({ c, r: 34, h: 9, a0: home, t0, fov: 34, look: 4.5 })) }];
  const spin = hashStr(salt) % 2 ? 1 : -1, out = [];
  out.push({ at: t0, shot: party(orbit({ c, r: 120, r1: 30, h: 90, h1: 8, a0: home + 0.7, w: -0.08, t0, dur: CEREMONY.first + 1.5, fov: 40, fov1: 34, look: 2, look1: 4.5 })) });
  hoists.forEach((h, i) => {
    const lift = h - 1.7, side = (i % 2 ? -0.35 : 0.3);
    // low in front of him, the lens up after the Cup as it goes over his head
    out.push({ at: lift - 0.9, shot: party(orbit({ c: [LIFT_SPOT[0], 0, LIFT_SPOT[2]], r: 17, r1: 12, h: 3.6, h1: 3, a0: home + side, w: 0.015, t0: lift - 0.9, dur: 3.6, fov: 30, fov1: 34, look: 5, look1: 7.2 })) });
    // round the team with it up
    out.push({ at: h + 2.4, shot: party(orbit({ c, r: 24, h: 6, a0: home + side + 0.4 * spin, w: 0.22 * spin, t0: h + 2.4, fov: 38, look: 5 })) });
    if (i === 0) out.push({ at: h + 5.6, shot: 'shells' });
  });
  let t = (hoists.length ? hoists[hoists.length - 1] : t0 + 8) + 7;
  const cycle = [
    (t0_) => ({ len: 8, shot: party(orbit({ c, r: 16, r1: 52, h: 4, h1: 44, a0: home - 0.8, w: 0.12 * spin, t0: t0_, dur: 7, fov: 40, fov1: 34, look: 5, look1: 3 })) }),
    () => ({ len: 4.5, shot: 'shells' }),
    (t0_) => ({ len: 7, shot: party(orbit({ c, r: 14, h: 4.2, a0: home + 0.4, w: -0.24 * spin, t0: t0_, fov: 44, look: 5.4 })) }),
    () => ({ len: 4, shot: 'crowd' }),
    // the long pull back, high over the park, the city round it
    (t0_) => ({ len: 14, shot: party(orbit({ c, r: 30, r1: 230, h: 10, h1: 150, a0: home, w: 0.03 * spin, t0: t0_, dur: 13, fov: 36, fov1: 46, look: 4, look1: 10 })) }),
  ];
  for (let k = 0; t < until - 2; k++) {
    const x = cycle[k % cycle.length](t);
    out.push({ at: t, shot: x.shot });
    t += x.len;
  }
  return out;
}

// Where the Cup is at `t`: { base, up, yaw } (its foot's middle, the way its stem points, its turn
// in radians), or null while it's on its table. `holders` as planCeremony gives them; `poseOf(slot,
// t)` is the world's pose for him (world.js W.pose: his wrists in his frame, his frame's at and
// yaw). His hands hold the bowl low down at his chest and the stem over his head, so the foot is
// under them by `grip`, eased between the two; the first and last half-second ease it from the table
// onto his hands and back.
export const CUP_GRIP = Object.freeze({ low: 1.75, high: 0.75, lowY: 4.6, highY: 6.3, ease: 0.45 });
export function cupAt(holders, t, poseOf) {
  const h = (holders || []).find((x) => t >= x.grab && t < x.release);
  if (!h || typeof poseOf !== 'function') return null;
  const handsBase = (tt) => {
    const P = poseOf(h.slot, tt);
    if (!P || !P.wrL || !P.wrR) return null;
    const F = { at: P.at, yaw: P.yaw }, a = toPark(F, P.wrL), b = toPark(F, P.wrR), mid = mul(add(a, b), 0.5);
    const y = mid[1] - (P.at[1] || 0), k = smooth((y - CUP_GRIP.lowY) / (CUP_GRIP.highY - CUP_GRIP.lowY));
    return { base: [mid[0], mid[1] - (CUP_GRIP.low + (CUP_GRIP.high - CUP_GRIP.low) * k), mid[2]], yaw: P.yaw * DEG };
  };
  const now = handsBase(t);
  if (!now) return null;
  const table = [CUP_STAND[0], groundHeight(CUP_STAND[0], CUP_STAND[2]) + CUP_TABLE, CUP_STAND[2]];
  // onto his hands from the table, and back onto it
  let base = now.base;
  const inA = (t - h.grab) / CUP_GRIP.ease, outA = (h.release - t) / CUP_GRIP.ease;
  const k = Math.min(1, smooth(inA), Number.isFinite(h.release) ? smooth(outA) : 1);
  if (k < 1) base = [table[0] + (base[0] - table[0]) * k, table[1] + (base[1] - table[1]) * k, table[2] + (base[2] - table[2]) * k];
  return { base, up: [0, 1, 0], yaw: now.yaw * k };
}
