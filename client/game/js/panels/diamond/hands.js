// DEADBALL · THE HAND SHAPES. How a ballplayer's hands are held, by name: what a clip keys (its `hands`, diamond/
// clip-schema.js) and what figure-rig.js handHolds picks for a hand round a bat, in a glove or on the ball. Each is
// a gl/figure-hands.js shape: four finger curls (`f`, index to little finger, 0 as figure.js models the hand, 1 a
// fist, under 0 straightened back), the thumb's curl and its swing across the palm (`th`, `op`) or its joints one
// by one (`tj`: the root, the swing, the knuckle, the last joint, radians), how far the fingers fan (`sp`), and how
// far the fingers fold as round a handle rather than as a fist (`gk`). handPose turns one into the twenty angles
// the figure's hand is drawn with.
//
// Pure data: no DOM, no GL. The clip schema reads the names, so a clip can't key a shape that isn't here.

const S = (f, th, op = 0, sp = 0, more = {}) => Object.freeze({ f: Object.freeze(f), th, op, sp, ...more });
// a shape given joint by joint (gl/figure-hands.js handPose's twenty angles)
const P = (j) => Object.freeze({ j: Object.freeze(j) });

export const HANDS = Object.freeze({
  // ── round the bat ──
  // the power grip, each finger joint by joint, within a real hand's range: the index and middle fingers folded hard
  // at the knuckle (80°) and their tips round to the thumb, the ring and little fingers less at the knuckle and more
  // at the last joint, and the thumb swung across and round with its tip bent back; the skin that curls into the wood
  // presses flat onto it (figure-rig.js GRIP_HOLD), no more than 4 mm of it. Fitted 2026-11-15 for what a camera sees
  // of the handle through the hand: two 3 mm cells a row of 24, at the seam and where the hand ends
  // Refitted 2026-11-23 for the smaller hand (figure.js handScaleOf 0.97, was 1.1): the index folded further, the
  // little finger's tip and the thumb brought round, and just over three cells a row show, which is as close as the
  // shorter fingers get round the same handle
  bat: P([1.6, 1.05, 1.05, 0.1, 1.4, 1.05, 0.75, -0.08, 1.35, 0.7, 0.19, 0, 1.1, 0.9, 1.25, 0, 0.71, 1.41, 0.37, -0.41]),
  // the waggle's grip in the stance, eased 1° at every joint (3.2 cells a row show); any looser and the seam opens
  // down the hand; the grip closes for the load
  batLoose: P([1.58, 1.03, 1.03, 0.1, 1.38, 1.03, 0.73, -0.08, 1.33, 0.68, 0.17, 0, 1.08, 0.88, 1.23, 0, 0.71, 1.41, 0.37, -0.41]),
  // ── in the glove and free ──
  // a light curl, so nothing comes out through the leather
  glove: S([0.25, 0.25, 0.25, 0.25], 0.2, 0.15),
  // hanging loose, the fingers curled a little more from the index to the little finger
  free: S([0.22, 0.27, 0.32, 0.36], 0.25, 0.1, 0.05),
  // a ball in the hand, as a pitcher holds a four-seamer: the index and middle fingers over the top of it and only
  // a little bent, the ring and little fingers tucked against its side, the thumb brought round under it
  // (the index and thumb refitted to the smaller hand, 2026-11-23, figure-rig.js BALL_HOLD)
  ball: S([0.44, 0.46, 0.85, 0.95], 0.7, 0.8, -0.15),
  // ── the calls and the gestures ──
  // a fist, the thumb across the fingers: the umpire's out and his strike, a fist pump
  fist: S([1.05, 1.05, 1.05, 1.05], 0, 0, 0, { tj: Object.freeze([0.3, 0.9, 0.5, 0.6]) }),
  // the index finger out and the rest closed: the umpire's punch-out point, a man pointing
  point: S([-0.3, 1.05, 1.05, 1.05], 0, 0, 0, { tj: Object.freeze([0.3, 0.9, 0.5, 0.6]) }),
  // the hand flat and the fingers together, the thumb along them: the umpire's safe, his dead ball and foul
  flat: S([-0.15, -0.1, -0.08, -0.05], 0, 0, -0.15, { tj: Object.freeze([-0.2, -0.3, -0.1, 0]) }),
  // the fingers spread wide and straight back: arms up in celebration
  open: S([-0.4, -0.35, -0.35, -0.4], 0, 0, 0.9, { tj: Object.freeze([-0.35, -0.4, -0.2, -0.1]) }),
  // cupped a little for a clap, a high five's palm
  clap: S([0.05, 0.08, 0.1, 0.12], 0, 0, -0.1, { tj: Object.freeze([-0.1, 0.1, 0.05, 0.1]) }),
  // the thumb up from a closed hand
  thumbUp: S([1.05, 1.05, 1.05, 1.05], 0, 0, 0, { tj: Object.freeze([-0.35, -0.2, -0.25, -0.2]) }),
  // ── the signs: the catcher's under his thigh, a fielder's outs ──
  // one finger, two, three, four (the wiggle), the fist; each held straight down with the others closed
  sign1: S([-0.2, 1.05, 1.05, 1.05], 0, 0, 0, { tj: Object.freeze([0.3, 0.9, 0.5, 0.6]) }),
  sign2: S([-0.2, -0.2, 1.05, 1.05], 0, 0, -0.2, { tj: Object.freeze([0.3, 0.9, 0.5, 0.6]) }),
  sign3: S([-0.2, -0.2, -0.2, 1.05], 0, 0, -0.2, { tj: Object.freeze([0.3, 0.9, 0.5, 0.6]) }),
  sign4: S([-0.2, -0.2, -0.2, -0.2], 0, 0, 0.35, { tj: Object.freeze([0.3, 0.9, 0.5, 0.6]) }),
  // two outs as an infielder shows them: the index and the little finger up, the middle two closed
  outs2: S([-0.2, 1.05, 1.05, -0.2], 0, 0, 0.3, { tj: Object.freeze([0.3, 0.9, 0.5, 0.6]) }),
});
export const HAND_NAMES = Object.freeze(Object.keys(HANDS));
// the hand in a glove shut on a catch (glove-flex.js): the fingers folded with the stalls, so none comes out
// through the back of the leather. Not a clip's to key, so it isn't in HANDS.
export const GLOVE_SHUT = S([0.62, 0.62, 0.6, 0.58], 0.45, 0.4);
// the shapes a hand round the bat may be keyed to (a gripping hand ignores any other)
export const BAT_HANDS = Object.freeze(['bat', 'batLoose']);

// Where a ball sits in the hand holding it, from the wrist along the hand bone's own axes (diamond/rig.js boneFrames:
// X, Y down the hand, Z), in feet a unit of scale: figure-rig.js BALL_HOLD, the spot on the figure's fingers where
// the four-seamer's fingertips and thumb meet it, carried onto Deadball's hand, so the director needn't load the
// figure to put the ball there. figure-rig.mjs holds the two together.
export const BALL_IN_FINGERS = Object.freeze({ L: Object.freeze([-0.16404, 0.22966, 0.27559]), R: Object.freeze([0.16404, 0.22966, 0.27559]) });

// THE CATCHER'S SIGNS. The pitch he calls, by diamond/flight.js's pitch types, as the fingers he puts down: one the
// fastball (and the sinker, its two-seam cousin), two the curve, three the slider (and the cutter), four the change
// (and the splitter, thrown off the same arm speed), the wiggle of all four for the knuckleball. With a man on
// second, who can see them, he puts down three and the pitcher takes the second (`SIGN_SECOND`); otherwise the one.
export const PITCH_SIGNS = Object.freeze({
  'four-seam fastball': 'sign1', sinker: 'sign1', curveball: 'sign2', slider: 'sign3', cutter: 'sign3',
  changeup: 'sign4', splitter: 'sign4', knuckleball: 'sign4',
});
export const SIGN_SECOND = 1;
const SIGN_LIST = ['sign1', 'sign2', 'sign3', 'sign4'];
// The signs for a pitch as a run of shapes for the hand that gives them: [the one] or, with a man on second,
// three, the real one second and the others off `seed`, never the same twice running.
export function signsFor(type, onSecond = false, seed = 0) {
  const real = PITCH_SIGNS[String(type || '').toLowerCase()] || 'sign1';
  if (!onSecond) return [real];
  const a = SIGN_LIST[(seed >>> 0) % 4], c0 = SIGN_LIST[((seed >>> 2) + 1) % 4];
  const first = a === real ? SIGN_LIST[(SIGN_LIST.indexOf(a) + 1) % 4] : a, last = c0 === real ? SIGN_LIST[(SIGN_LIST.indexOf(c0) + 2) % 4] : c0;
  return [first, real, last];
}

// How long a keyed shape takes to come in, seconds: the hand closes or opens over it from what it was.
export const HAND_BLEND = 0.12;

// A clip's hands at clip time t (anim.js sampleClip): for each hand the shapes in play and how much of each, as
// [[name, weight], ...], where '' is the hand as the picture would hold it unkeyed (round the bat, in the glove,
// on the ball, or loose). Null when the clip keys none. `mirror` swaps the hands, as a left-hander does the clip.
export function handsAt(clip, t, mirror = false) {
  const H = clip.hands;
  if (!H || !H.length) return null;
  const out = {};
  for (const S of ['L', 'R']) {
    let prev = '', cur = '', at = -Infinity;
    for (const e of H) {
      if (e.t > t) break;
      if (!(S in e)) continue;
      prev = cur; cur = e[S]; at = e.t;
    }
    // (one keyed at the clip's start is held from it: what came before is the clip it fades in from)
    const k = at <= 1e-9 ? 1 : Math.min(1, Math.max(0, (t - at) / HAND_BLEND)), w = k * k * (3 - 2 * k);
    out[mirror ? (S === 'L' ? 'R' : 'L') : S] = w >= 1 || prev === cur ? [[cur, 1]] : [[prev, 1 - w], [cur, w]];
  }
  return out;
}
// Two clips' hands as one pose mixes them (anim.js mixPose), `w` of the way from a to b.
export function mixHands(a, b, w) {
  if (!a && !b) return null;
  const A = a || { L: [['', 1]], R: [['', 1]] }, B = b || { L: [['', 1]], R: [['', 1]] }, out = {};
  for (const S of ['L', 'R']) out[S] = [...A[S].map(([n, x]) => [n, x * (1 - w)]), ...B[S].map(([n, x]) => [n, x * w])].filter(([, x]) => x > 1e-4);
  return out;
}
