// TWO CATS TOGETHER, as the picture plays it: what each does through an encounter and where the one coming (`b`)
// stands against the one staying (`a`). Which encounter, between whom and when is client/shared/cat-life.js catMeets,
// the same for the server and every client; this file is only the staging, so two people may see a cat come round
// by a slightly different line, never a different act. gl/room-beasts.js plays it in a room, and the Cattery's pair
// view (tools/modelshop/cattery.html) plays it on the spot.
//
// An encounter is phases. Each names a place (where `b` goes, below) and the clip each cat plays there; a phase's
// clock starts when `b` gets to its place and runs `dur` seconds, then the next. Until `b` is there, `a` stands and
// watches it come. The last phase holds until the encounter's turn is over.
//
// Places, in the room's floor (u, v), a heading h facing (sin h, cos h):
//   face   nose to nose: `b` in front of `a`, both turned to each other
//   rear   `b` behind `a`, its nose at the root of `a`'s tail
//   cheek  head by head facing opposite ways, close enough to rub along each other
//   near   a little way off, sat
//   beside lying alongside `a`, the same way round, its head by `a`'s
//   curl   curled up against `a`, the other way round
//   box    face to face, close, for boxing on their hind legs
//   chase  `a` runs, `b` after it (gl/room-beasts.js moves both)
//   apart  a long stride off, `a` turned side-on to it to look bigger
//   flee   `b` well away, out of it
//
// Nothing here knows any particular cat.

export const MEET_PLAN = {
  // nose to nose, then a sniff round the back end, then a rub of heads, then sat near each other
  greet: [
    { dur: 3.2, place: 'face', a: 'noseTouch', b: 'noseTouch' },
    { dur: 4.2, place: 'rear', a: 'present', b: 'sniffRear' },
    { dur: 4.5, place: 'cheek', a: 'rub', b: 'rub' },
    { dur: 0, place: 'near', a: 'sit', b: 'sit' },
  ],
  // up on their hind legs boxing, then one tears off and the other after it, and again
  play: [
    { dur: 4.5, place: 'box', a: 'box', b: 'box' },
    { dur: 5, place: 'chase', a: 'gallop', b: 'gallop', timed: true },
    { dur: 3.5, place: 'box', a: 'box', b: 'box' },
    { dur: 5, place: 'chase', a: 'gallop', b: 'gallop', timed: true },
    { dur: 0, place: 'near', a: 'sit', b: 'stand' },
  ],
  // the bossy one puffs up side-on and hisses; the other flattens, then gets out of the way
  spat: [
    { dur: 4, place: 'apart', a: 'hiss', b: 'cower' },
    { dur: 0, place: 'flee', a: 'sit', b: 'sit' },
  ],
  // lying alongside, the groomer washing the other's head and neck
  groom: [{ dur: 0, place: 'beside', a: 'groomed', b: 'allogroom' }],
  // asleep against each other
  pile: [{ dur: 0, place: 'curl', a: 'sleep', b: 'sleep' }],
};
/** The clip `role` plays in `kind`'s phase `i` (wrapping the last phase). */
export const meetPhase = (kind, i) => { const P = MEET_PLAN[kind] || MEET_PLAN.greet; return P[Math.min(i, P.length - 1)]; };

/** A cat's measures for placing it, in metres, off its rig (gl/cat-kit.js catRig): how far its nose, its head and the
 * root of its tail are from its middle, and how wide its head and body are. */
// (lying: a loafed cat is about 0.2 of the sculpt either side of its middle, its legs folded out under it; a curled
// one is a ring about 0.28 across the middle, sat off to its left and back, measured off the carves)
export function meetGeom(R) {
  const sc = R.look.scale, b = R.look.build || {}, fat = (b.chest ?? 1) * (1 + 0.13 * (b.bodyFluff ?? 0));
  return {
    nose: (R.HC[2] + 0.1 * R.HS) * sc, head: R.HC[2] * sc, rear: -R.TB[2] * sc,
    headW: 0.1 * R.HS * (b.cheeks ?? 1) * sc, lieW: 0.2 * fat * sc,
    curlR: 0.28 * fat * sc, curlC: [0.09 * fat * sc, -0.058 * sc],
  };
}

const fwd = (h) => [Math.sin(h), Math.cos(h)];
const headingTo = (p, q) => Math.atan2(q[0] - p[0], q[1] - p[1]);
const unit2 = (d, or) => { const l = Math.hypot(d[0], d[1]); return l > 1e-4 ? [d[0] / l, d[1] / l] : or; };
/**
 * Where `b` goes for `place` and which way each faces: { at: [u, v], headB, headA (null: `a` keeps its own) }.
 * `a`, `b`: { at: [u, v], head } as each is now; `ga`, `gb`: their meetGeom.
 */
export function meetPlace(place, a, b, ga, gb) {
  const f = fwd(a.head), toB = unit2([b.at[0] - a.at[0], b.at[1] - a.at[1]], f);
  // across `a`: whichever side `b` is on, so it comes round the near way
  let S = [f[1], -f[0]];
  if (S[0] * toB[0] + S[1] * toB[1] < 0) S = [-S[0], -S[1]];
  const at = (k1, k2) => [a.at[0] + f[0] * k1 + S[0] * k2, a.at[1] + f[1] * k1 + S[1] * k2];
  const along = (d, r) => [a.at[0] + d[0] * r, a.at[1] + d[1] * r];
  switch (place) {
    case 'face': { const p = along(toB, ga.nose + gb.nose + 0.02); return { at: p, headB: headingTo(p, a.at), headA: headingTo(a.at, p) }; }
    case 'box': { const p = along(toB, 0.55 * (ga.nose + gb.nose) + 0.04); return { at: p, headB: headingTo(p, a.at), headA: headingTo(a.at, p) }; }
    case 'rear': return { at: at(-(ga.rear + gb.nose + 0.01), 0), headB: a.head, headA: null };
    case 'cheek': return { at: at(ga.head + gb.head - 0.02, (ga.headW + gb.headW) * 1.25), headB: a.head + Math.PI, headA: null };
    case 'near': { const p = along(toB, ga.nose + gb.nose + 0.25); return { at: p, headB: headingTo(p, a.at) + 0.9, headA: null }; }
    case 'beside': return { at: at(0.07, 0.8 * (ga.lieW + gb.lieW)), headB: a.head, headA: null };
    case 'curl': {
      // the two rings touching (pressed a little into each other, as sleeping cats are), `b` the other way round
      const hb = a.head + Math.PI, local = (h, q) => { const F = fwd(h); return [q[0] * F[1] + q[1] * F[0], -q[0] * F[0] + q[1] * F[1]]; };
      const ca = local(a.head, ga.curlC), cb = local(hb, gb.curlC), d = 0.92 * (ga.curlR + gb.curlR);
      const c = [a.at[0] + ca[0] + S[0] * d, a.at[1] + ca[1] + S[1] * d];
      return { at: [c[0] - cb[0], c[1] - cb[1]], headB: hb, headA: null };
    }
    case 'apart': { const p = along(toB, 0.75); return { at: p, headB: headingTo(p, a.at), headA: headingTo(a.at, p) + Math.PI / 2 }; }
    case 'flee': { const p = along(toB, 2.2); return { at: p, headB: headingTo(a.at, p), headA: null }; }
    // a chase is moved by whoever plays it: `b` runs at `a`
    default: return { at: b.at, headB: headingTo(b.at, a.at), headA: null };
  }
}
