// THE BOUNCE — does a span actually ring when its flock pushes off, and does it settle?
//
// ⚠ NO HEADLESS HARNESS HERE REACHES A DRAW CALL, so this asks the arithmetic instead: walk a real
// flock's cycle, read the load the cable is drawn at, and hold it to the four things that separate
// a bounce from a bug — it swings BOTH WAYS, it decays, it ends exactly at rest, and it never
// bends the cable into the traffic on the way.
import { loadWindshield } from './dom-stub.mjs';

const ws = await loadWindshield();
const { wireSag, wireRing, WIRE_RING_S, RENDER_TUNE } = ws;

// ⚠ IMPORTED, NEVER MIRRORED. A first cut restated the ring here to test its SHAPE, which is
// a gate that passes with the feature deleted — the renderer could stop ringing entirely and this
// would still describe a beautiful decaying oscillation of its own invention.
const RING_S = WIRE_RING_S;
const ring = (share, t) => wireRing(share, t);

const problems = [];
const SHARE = 108, SPAN = 1, LINES = 4;
const TRUCK = 0.0842, WANT = TRUCK * 2.0;
const Z_TOP = 0.0842 * 3.6, GAP = 0.026;
const bottom = Z_TOP - (LINES - 1) * GAP;

// ── 1. it swings both ways ──────────────────────────────────────────────────
let lo = Infinity, hi = -Infinity, loT = 0, hiT = 0;
for (let t = 0; t < RING_S; t += 0.002) {
  const v = ring(SHARE, t);
  if (v < lo) { lo = v; loT = t; }
  if (v > hi) { hi = v; hiT = t; }
}
if (!(lo < -1)) problems.push('the ring never lifts the cable — no upswing at all');
if (!(hi > 1)) problems.push('the ring never pulls back down — it is a one-way flick, not a bounce');
// ⚠ AND IT LIFTS FIRST. A released cable rises before it falls back; a ring that swings DOWN out
// of the gate is a sign error, and it still satisfies 'both ways' — which is how a flipped sign
// survived the first cut of this gate.
if (!(loT < hiT)) problems.push(`the cable falls before it rises (down at ${hiT.toFixed(2)}s, up at ${loT.toFixed(2)}s) — the sign is inverted`);

// ── 2. it decays, and ends at rest ──────────────────────────────────────────
const peaks = [];
for (let t = 0.002; t < RING_S - 0.002; t += 0.002) {
  const a = Math.abs(ring(SHARE, t - 0.002)), b = Math.abs(ring(SHARE, t)), c = Math.abs(ring(SHARE, t + 0.002));
  if (b > a && b >= c && b > 0.5) peaks.push({ t, v: b });
}
if (peaks.length < 3) problems.push(`only ${peaks.length} peaks in the ring — it is not oscillating`);
for (let k = 1; k < peaks.length; k++) {
  if (peaks[k].v >= peaks[k - 1].v) { problems.push('the ring grows instead of decaying'); break; }
}
if (Math.abs(ring(SHARE, RING_S - 0.001)) > SHARE * 0.02) problems.push('the ring is still moving when it is cut off — it would end in a step');
if (ring(SHARE, RING_S) !== 0) problems.push('the ring does not return to exactly rest');
if (ring(SHARE, 0) !== 0) problems.push('the ring starts with a step rather than from rest');

// ── 3. the cable never rings down into the traffic ──────────────────────────
// ⚠ THE WORST CASE IS THE DOWNSWING WHILE BIRDS ARE STILL ON IT, not the moment of release: the
// load is what is left standing PLUS the swing, so a cable half unloaded and swinging down carries
// more than either term alone.
let worstDrop = 0, worstAt = null;
for (let settle = 0; settle <= 1.0001; settle += 0.02) {
  for (let t = 0; t < RING_S; t += 0.01) {
    const load = SHARE * (1 - settle) + ring(SHARE, t);
    const sag = wireSag(SPAN, load / LINES);
    const clear = bottom - sag;
    if (clear < worstDrop || worstAt === null) { worstDrop = clear; worstAt = { settle: +settle.toFixed(2), t: +t.toFixed(2), load: +load.toFixed(1) }; }
  }
}
if (worstDrop < TRUCK) problems.push(`a ringing cable reaches ${worstDrop.toFixed(3)} tiles — under a lorry at ${TRUCK}`);

// ── 4. and the upswing does not invert it into an arch ──────────────────────
const upSag = wireSag(SPAN, (SHARE * 0 + lo) / LINES);
const bare = wireSag(SPAN, 0);
if (upSag > bare) problems.push('the upswing makes the cable sag MORE, not less — the sign is wrong');
if (upSag < -bare) problems.push(`the upswing inverts the cable into an arch (${upSag.toFixed(4)} tiles)`);
// ⚠ THERE HAS TO BE AN OVERSHOOT AT ALL. `wireSag` clamped the bird term at zero for as long as it
// existed, which silently deletes the half of the bounce that rises and leaves the cable resting at
// exactly bare — and a gate that only asks "is it more than bare" calls that a pass.
if (!(upSag < bare * 0.95)) problems.push(`the upswing does not lift the cable past its rest sag (${upSag.toFixed(4)} vs ${bare.toFixed(4)} bare)`);

// ── 5. the flag is the absence of it ────────────────────────────────────────
RENDER_TUNE.wireRing = 0;
RENDER_TUNE.wireRing = 1;

if (problems.length) {
  console.log(`✗ wirering: ${problems.length} problem(s)`);
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log('✓ wirering: a span released by 108 birds swings '
  + `${(-lo).toFixed(1)} birds' worth up at ${loT.toFixed(2)}s and ${hi.toFixed(1)} back down at ${hiT.toFixed(2)}s, `
  + `over ${peaks.length} decaying peaks, and is at rest by ${RING_S}s.`);
console.log(`  · worst clearance while ringing: ${worstDrop.toFixed(3)} tiles `
  + `(${(worstDrop / TRUCK).toFixed(2)}x a lorry) at settle ${worstAt.settle}, t ${worstAt.t}s, load ${worstAt.load}.`);
console.log(`  · the upswing lifts it to ${upSag.toFixed(4)} tiles against ${bare.toFixed(4)} bare — flatter, never arched.`);
