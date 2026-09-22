// LIGHTNING — the shape of a stroke, as data.
//
// A bolt here is a TREE in normalized channel space: nodes carrying a lateral offset (ox, oy) and
// a height fraction `f` that runs 1 at the cloud base down to 0 at the ground. Nothing in this file
// knows about a canvas, a camera or a pane — a reader scales the tree into whatever space it draws
// in — so the same channel can be projected through the world camera out of a cockpit, mapped flat
// across a windscreen, and fitted into a hangar doorway, and all three are the same lightning.
//
// ⚠ THERE WERE THREE GENERATORS AND THEY WERE THREE DIFFERENT PHENOMENA. windshield.js grew its own
// for the world bolt AND a second for the on-glass one, and hangar-ambience.js a third for the
// door — each a nine-ish-node zigzag with its own jitter constant, its own width and its own
// colour, so a storm looked like one thing through the canopy, a slightly different thing on the
// glass in front of it, and a third thing from the hangar. One tree, three projections.
//
// ⚠ AND `f` IS 1 AT THE TOP, which is upside down from every screen coordinate a reader will map it
// into and right for the one thing the geometry is about: only the TRUNK is allowed to reach 0, so
// `f === 0` means this branch hit the ground and everything else ran out of leader in the air. A
// reader that wants a screen y takes `1 - f` and says so.

// ── WHAT SEPARATES A PHOTOGRAPH FROM A ZIGZAG ────────────────────────────────────────────────
//
// Three things, and a stem with two twigs hung off it can say none of them.
//
//   THE BRANCHING IS RECURSIVE. A stepped leader forks, and the forks fork, three or four
//   generations deep — twenty-odd branches on an ordinary ground strike, not two. What the eye
//   reads is the DEPTH of that tree; it does not count limbs.
//
//   THE WIDTH TAPERS WITH THE GENERATION. The main channel is a thick hot rope and the outermost
//   tendrils are hairlines, which is the whole reason the main channel READS as the main channel.
//   Drawn at one width a tree is a bush.
//
//   A BRANCH LEAVES AND KEEPS GOING. Each fork carries a lateral direction away from its parent and
//   HOLDS it, descending more slowly than the channel it left — which is what draws the long
//   near-horizontal tendrils reaching out across the sky. Re-jittering about the vertical instead
//   gives every fork the trunk's own wandering shape at a shorter length, which is why the old one
//   read as a crack in the glass: it was the same shape four times.
//
// The per-generation table is the whole of the tuning. `df` is how much height a node spends,
// `lat` how far it travels along its own bearing, and the two together ARE the branch angle:
// atan(lat/df) is 53° at gen 1, which is what the reference photographs show near the cloud base.
// `wander` is the kink on top of that — the thing that makes it lightning rather than a line.
export const BOLT_GEN = [
  // gen 0 — the trunk. `df` is overwritten with 1/segs so it lands exactly on the ground; `lat` is
  // 0 because a main channel has no bearing of its own, it wanders. It is also the only row whose
  // `fork` is high: a trunk throwing five branches and each of those throwing one or two is the
  // shape, and a flat probability all the way down makes a fir tree.
  { df: 0.100, lat: 0,     wander: 0.080, fork: 0.62, len: [10, 10], w: 1.00, a: 1.00 },
  { df: 0.055, lat: 0.075, wander: 0.055, fork: 0.45, len: [4, 8],   w: 0.46, a: 0.80 },
  { df: 0.048, lat: 0.062, wander: 0.050, fork: 0.32, len: [3, 6],   w: 0.22, a: 0.56 },
  { df: 0.042, lat: 0.050, wander: 0.045, fork: 0,    len: [2, 4],   w: 0.11, a: 0.36 },
];

// How fast a return stroke falls away, in ms. Short: a restrike is a flash and not a fade, and a
// long decay smears the pulses into each other until the bolt reads as one 300ms glow.
// How close to the deck a branch is allowed to get before it simply stops. A fraction of the
// channel's own height, so it is a real gap at any cloud base.
export const BRANCH_FLOOR = 0.03;

export const BOLT_DECAY = 55;
// What a LATER return stroke does to the side branches. Almost nothing, and that is physics rather
// than a look: the branches belong to the stepped leader, so the first stroke lights the whole tree
// and the ones after it run up the channel that is already there. It is also most of what makes a
// bolt read as flickering rather than as blinking — the trunk stammers while the tree behind it
// fades once and stays faded.
export const BOLT_BRANCH_RESTRIKE = 0.28;

// mulberry32 — small, fast and good enough for a shape nobody can check.
//
// ⚠ IT IS SEEDED RATHER THAN READING `Math.random`, AND THAT IS NOT A PURITY PREFERENCE. Every
// bench in this repo pins `Math.random` to a constant so a picture can be compared with itself, and
// a tree grown out of a constant is a straight line with a fork at every node — so the one
// instrument that could look at this would have been looking at something the game never draws.
function rng(seed) {
  let a = (seed | 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A seed from where and when the strike happened. Two clients drawing the same strike do not share
// a `t0` (each has its own clock), so this is variety rather than agreement — what it buys is that
// a bench moving the strike one tile gets a different bolt without touching the global PRNG.
export function boltSeed(x, y, t) {
  let h = 2166136261;
  for (const v of [x * 1e3, y * 1e3, t]) {
    h ^= (v | 0); h = Math.imul(h, 16777619);
    h ^= (h >>> 13);
  }
  return h | 0;
}

// Turn a parent's bearing into a child's: rotated 30°–80° either side of it, which is the range the
// photographs show. A trunk has no bearing, so its children are handed a random azimuth and the
// tree fans out in every direction rather than flattening into a plane.
//
// ⚠ AND IT IS FORCED OUTWARD, WHICH IS THE ONE RULE THAT STOPS IT LOOKING LIKE AN INSECT. A pure
// rotation can turn a sub-branch back toward the channel it came from, and half of them do — the
// tip then hooks round and runs home, which in a still frame reads as legs rather than as
// lightning. Real branches leave and keep leaving: charge goes where the field is, and the field
// points away from the conductor. So a child whose bearing points back at the trunk axis is
// mirrored about that axis, which preserves the deflection ANGLE and only chooses the side.
function deflect(dx, dy, ox, oy, rnd) {
  let nx, ny;
  if (!dx && !dy) { const a = rnd() * 6.2832; nx = Math.cos(a); ny = Math.sin(a); } else {
    const a = (0.52 + rnd() * 0.87) * (rnd() < 0.5 ? -1 : 1);
    const c = Math.cos(a), s = Math.sin(a);
    nx = dx * c - dy * s; ny = dx * s + dy * c;
    const m = Math.hypot(nx, ny) || 1; nx /= m; ny /= m;
  }
  const r = Math.hypot(ox, oy);
  if (r > 0.02 && (nx * ox + ny * oy) / r < -0.15) { nx = -nx; ny = -ny; }
  return [nx, ny];
}

// Grow one channel.
//
//   seed     — any integer; the same seed is the same bolt, for ever.
//   gens     — how many generations deep to go (1 = a bare trunk, 4 = the full tree). This is the
//              detail dial: a distant bolt behind a skyline does not need four.
//   segs     — nodes in the trunk. `df` is derived from it so the trunk lands exactly on f = 0.
//   fork     — a multiplier on every generation's fork probability. 0 is a bare trunk at any depth.
//   spread   — a multiplier on lateral travel, for a reader whose space is narrower than it is tall.
//
// Returns { branches, strokes, dur, seed }. `branches[0]` is always the trunk.
export function growBolt(seed, { gens = 4, segs = 10, fork = 1, spread = 1 } = {}) {
  const rnd = rng(seed);
  const depth = Math.max(1, Math.min(BOLT_GEN.length, gens | 0));
  const branches = [];
  // ⚠ BOUNDED, because the recursion's branching factor is a product of probabilities and a table
  // somebody will tune later. At the shipping numbers a bolt is twenty-odd branches; the cap is
  // what stops a fork probability typed with an extra digit becoming a frame that never returns.
  const MAX = 128;

  const grow = (gen, ox, oy, f0, dirx, diry, n, ground = false) => {
    if (branches.length >= MAX) return;
    const G = BOLT_GEN[gen];
    const pts = [{ ox, oy, f: f0 }];
    const me = { gen, pts };
    branches.push(me);
    const trunk = gen === 0;
    const df = trunk ? 1 / segs : G.df;
    let x = ox, y = oy, f = f0;
    for (let i = 0; i < n; i++) {
      // The trunk spends a fixed slice of its height per node so it lands on the ground rather than
      // near it. Everything else jitters, because a branch that ran out of leader stops wherever it
      // happened to be — which is the only thing that distinguishes a tip from a ground contact.
      f -= trunk ? df : df * (0.7 + rnd() * 0.6);
      // ⚠ A BRANCH STOPS IN THE AIR AND THE CHANNEL DOES NOT, which is the difference between a
      // tree and a root system. The leader that connects is the one that carries the return stroke;
      // the rest run out of charge wherever they happen to be. Left to ground freely, a long limb
      // reaches the deck as readily as the trunk does and the bottom of every bolt is a bush —
      // measured at 4.7 forks a bolt arriving, against about one in the photographs, where what
      // reaches the deck is the channel splitting in its last few metres.
      // ⚠ AND IT MAY NOT CLIMB TO GET THERE. Setting a spent branch straight to the floor lifts it
      // back up whenever the step overshot past the floor rather than merely past zero — 172 nodes
      // over sixty bolts, each a tip flicking upward at the very end, which is the one thing a
      // stepped leader never does. It stops at the floor or wherever it already was, whichever is
      // lower.
      // ⚠ AND HITTING THE FLOOR ENDS THE BRANCH, which the clamp alone does not do. `f <= 0` is the
      // only stop below, so a branch clamped to a floor of 0.03 is not stopped by it — it carries on
      // for the rest of its length at a CONSTANT HEIGHT, and a run of nodes at one height projects
      // to a horizontal line. That is a hard white bar lying across the road at the foot of the
      // bolt, which is what it looked like, and it reads as a rendering artefact rather than as
      // lightning because it is one.
      const floor = trunk || ground ? 0 : BRANCH_FLOOR;
      let spent = false;
      if (f < floor) { f = Math.max(0, Math.min(floor, pts[pts.length - 1].f)); spent = true; }
      x += dirx * G.lat * spread + (rnd() - 0.5) * G.wander * spread;
      y += diry * G.lat * spread + (rnd() - 0.5) * G.wander * spread;
      pts.push({ ox: x, oy: y, f });
      if (f <= 0 || spent) break;
      // ⚠ NOT OFF THE FIRST NODE. A fork at the root draws two branches leaving one point, which is
      // a Y and not a fork — what a stepped leader does is carry on and shed a branch a little way
      // down. Nor off the LAST: a child hung on a tip inherits an almost-spent `f` and draws two
      // nodes going nowhere.
      if (gen + 1 < depth && i >= 1 && i < n - 1 && f > 0.05 && rnd() < G.fork * fork) {
        const CG = BOLT_GEN[gen + 1];
        const [cx, cy] = deflect(dirx, diry, x, y, rnd);
        // ⚠ LONGER UP HIGH. The big limbs in a photograph come off the upper half of the channel,
        // because that is where the leader had the most charge left to spend; a flat length makes
        // a bottle brush, evenly bristled from cloud to ground.
        const t = 0.35 + 0.65 * f;
        // ⚠ AND ONE IN FIVE IS A LIMB. Lengths drawn from one narrow range give a bottle brush —
        // every branch the same size, which is the shape that reads as a diagram. A photograph has
        // two or three dominant limbs carrying most of the tree and a crowd of short ones around
        // them, so the long tail is drawn explicitly rather than hoped for from the spread.
        const limb = rnd() < 0.2 ? 1.7 : 1;
        const span = CG.len[0] + Math.round((CG.len[1] - CG.len[0]) * t * (0.55 + rnd() * 0.75) * limb);
        // One limb in six is allowed to arrive with the channel — a real strike often makes contact
        // in two or three places a few metres apart, and it is the last thing in the tree to read as
        // deliberate rather than as noise.
        grow(gen + 1, x, y, f, cx, cy, Math.max(2, Math.min(Math.round(CG.len[1] * 1.7), span)), gen === 0 && rnd() < 0.17);
      }
    }
  };

  grow(0, 0, 0, 1, 0, 0, segs);

  // ── THE RESTRIKES ────────────────────────────────────────────────────────────────────────────
  //
  // A cloud-to-ground flash is not one event. It is a return stroke and then two or three more up
  // the same channel over the next couple of hundred milliseconds, which is why lightning READS as
  // stammering rather than as a flashbulb. The old envelope was a sine over the bolt's life, and a
  // sine is exactly the thing a restrike is not: it is smooth, it is periodic, and it never gets
  // out of the way between strokes.
  //
  // ⚠ ROLLED AT BIRTH RATHER THAN SAMPLED PER FRAME. The old one multiplied by `Math.random() < 0.85
  // ? 1 : 0.35` every frame, so the bolt's brightness depended on how many frames the machine
  // happened to draw — a fast machine flickered and a slow one did not, and neither could be
  // photographed twice.
  const dur = 240 + rnd() * 210;
  const strokes = [{ t: 0, a: 1 }];
  let t = 0;
  for (let k = 0, n = 1 + ((rnd() * 3) | 0); k < n; k++) {
    t += 38 + rnd() * 95;
    if (t > dur * 0.82) break;
    strokes.push({ t, a: 0.45 + rnd() * 0.5 });
  }
  return { branches, strokes, dur, seed };
}

// How bright the channel and the side branches are at `age` ms.
//
// `ch` drives the trunk (and the flash on the glass, which must pulse with it or the white flood
// and the thing that caused it disagree about when it happened). `br` drives everything hanging off
// it — see BOLT_BRANCH_RESTRIKE.
export function boltBright(bolt, age) {
  const dur = bolt.dur;
  if (age >= dur || age < 0) return { ch: 0, br: 0 };
  // Windowed over the last quarter so the bolt certainly reaches zero rather than being culled part
  // way through a pulse, which reads as the last flash being cut off.
  const w = age > dur * 0.75 ? (dur - age) / (dur * 0.25) : 1;
  let first = 0, later = 0;
  for (const s of bolt.strokes) {
    const d = age - s.t;
    if (d < 0) continue;
    const p = s.a * Math.exp(-d / BOLT_DECAY);
    if (s.t === 0) { if (p > first) first = p; } else if (p > later) later = p;
  }
  const ch = Math.min(1, Math.max(first, later, 0.10)) * w;
  const br = Math.min(1, Math.max(first, later * BOLT_BRANCH_RESTRIKE, 0.06)) * w;
  return { ch, br };
}

// The widest the tree gets, in channel units. A reader culls on the STRIKE POINT and the tree
// reaches out well past it, so this is what says how much slack that cull needs.
export function boltExtent(bolt) {
  let m = 0;
  for (const b of bolt.branches) for (const p of b.pts) {
    const d = Math.abs(p.ox) > Math.abs(p.oy) ? Math.abs(p.ox) : Math.abs(p.oy);
    if (d > m) m = d;
  }
  return m;
}
