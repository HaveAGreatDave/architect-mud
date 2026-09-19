// nearfit — the ground at the bottom of the frame has to be IN FRONT of the clip plane.
//
//   node scripts/shapes/nearfit.mjs
//
// A near plane is a distance in world tiles and an eye height is not a constant, and when the two
// are the same size the plane eats the bottom of the frame. `NEAR` was a fixed 0.06 tiles, which an
// aeroplane at eye 0.24 never comes near — the nearest ground it can see is about four tiles out —
// and which a camera pressed down onto the road at eye 0.05 is INSIDE. Everything nearer than the
// plane is clipped, so in that band there is no road quad, no kerb and no lane marking; the only
// thing left that can draw is the floor, which paints the TERRAIN. Reported as grass under the road
// when you are flat on it, in a band across the bottom tenth of the frame.
//
// ⚠ NOTHING ELSE HERE CAN SEE IT. Every headless harness in this repo installs a GL hook that
// answers null, so not one of them reaches a clip test; `gl:parity` compares the matrix's x and y
// rows against `cam.proj` and the near plane is in neither; `gl:floorcam` compares the floor's terms
// against the camera's, and both were reading the same wrong plane.
//
// So the questions are the three that are expressible without a rasteriser:
//
//   1. REACH — at the bottom row, is the ground in front of the plane? Asked through the SHIPPING
//      matrix rather than through a formula of this file's own: build `viewProjMatrix`, search for
//      the ground distance that lands on the last row, and compare its clip `w` with the plane.
//      ⚠ It cannot be asked through `cam.proj`, which clamps `f` at 0.06 — so below that the row
//      saturates and the search silently answers 0.06 for every seat, which is the number under
//      test. The matrix does not clamp, and it is what actually decides whether a fragment exists.
//   2. NO SEAT MOVES THAT DID NOT HAVE TO — the fitted plane is capped at `NEAR`, so every seat
//      whose ground already reached its own bottom row must come back EXACTLY 0.06 and keep the
//      depth budget that came with it. Object.is, not a tolerance: these are meant to be the same
//      number, not two roads to one.
//   3. ONE PLANE, SPENT EVERYWHERE — the mass, the ground, the floor, the sprites and the strokes
//      share one depth buffer, and two of them built from two different near planes do not disagree
//      visibly. They disagree by a hair, which reads as z-fighting somebody then goes looking for in
//      the eps ladder. So: the matrix's z row must equal `zRow(cam.near)`, and the files that write
//      `clip.z` or unproject a depth themselves must derive it from `zRow` rather than spelling a
//      clip range of their own — `gl/floor.js` held a literal `const near = 0.06, far = 400.0`
//      until this shipped, which is the exact second copy camera.js's own ⚠ warns about.
//
// ⚠ AND THE MUTATION CONTROL IS THE SIZE OF THE BUG. Every reach case is run a second time with the
// fit switched off, and the low seats must FAIL it — a gate whose control passes is a gate that
// would have passed before the fix.
import { loadWindshield, stubCanvas } from './dom-stub.mjs';
import { readFileSync } from 'node:fs';
import { blank } from '../lib/blank-scanner.mjs';
import { nearFor, zRow, projMatrix, viewProjMatrix, projectThrough, NEAR, NEAR_MIN } from '../../client/game/js/panels/gl/camera.js';

const ws = await loadWindshield();
stubCanvas('__nf', 640, 360);

// A seat is a view + chase pair and the frame it is drawn into. `fits` says whether this seat is one
// the plane is expected to move for; anything else must come back bit-identical.
const SEATS = [
  { label: 'aircraft cockpit', v: { heading: 0, height: 0, map: null }, fits: false },
  { label: 'aircraft, climbing', v: { heading: 0, height: 0.6, map: null }, fits: false },
  { label: 'truck cab (eyeH 0.12, fovMul 1.22)', v: { heading: 0, height: 0, eyeH: 0.12, fovMul: 1.22, map: null }, fits: false },
  { label: 'cab chase', v: { heading: 0, height: 0, eyeH: 0.12, map: null }, chase: { back: 1.6, up: 0.22 }, fits: false },
  { label: 'helm chase', v: { heading: 35, height: 0, map: null }, chase: { back: 3.2, up: 1.1 }, fits: false },
  // The seats the plane exists for. `street` is the Modelshop's own ground seat; the other two are
  // the free camera pressed down onto the road, which is where `makeCam` floors the eye at 0.05.
  { label: 'street (eyeH 0.06)', v: { heading: 0, height: 0, eyeH: 0.06, map: null }, fits: true },
  { label: 'freecam on the deck (ez 0.05)', v: { heading: 0, height: 0, map: null }, chase: { back: 0, up: 0, ez: 0.05 }, fits: true },
  { label: 'freecam under the deck (ez -0.4, floored)', v: { heading: 0, height: 0, map: null }, chase: { back: 0, up: 0, ez: -0.4 }, fits: true },
  { label: 'ground seat, tilted down', v: { heading: 0, height: 0, eyeH: 0.06, camPitch: 0.25, map: null }, fits: true },
  { label: 'ground seat, tilted up', v: { heading: 0, height: 0, eyeH: 0.06, camPitch: -0.12, map: null }, fits: true },
];

// Three frames, because the fit reads the canvas: a phone-ish pane, the Modelshop's, and a big one.
const FRAMES = [[640, 360], [1098, 618], [1920, 1080]];

// The ground distance whose bottom-row pixel is the last row of the frame, found through the
// shipping matrix. Monotonic in d (nearer ground is lower on screen), so a bisection is exact to
// whatever tolerance it is run to; the answer wanted is its clip `w`, which IS camera-space forward
// distance and IS what the near plane is compared against.
function groundAtBottomRow(cam, W, H, near) {
  const m = viewProjMatrix(cam, H, near);
  const at = (d) => projectThrough(m, 0, -d, 0, W, H);
  let lo = 1e-5, hi = 400;
  if (at(hi).sy > H) return at(hi);          // the whole ground is below the last row: nothing to prove
  for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (at(mid).sy > H) lo = mid; else hi = mid; }
  return at(hi);
}

const problems = [], rows = [], clipped = new Set();
let reach = 0, unchanged = 0, controlFailed = 0;

for (const seat of SEATS) {
  for (const [W, H] of FRAMES) {
    const cam = ws.makeCam(W, H * 0.42, H * 0.55, seat.v, seat.chase);
    // Exactly what world.js does, in the same words, so this gate cannot be measuring a fourth
    // derivation of the plane.
    cam.near = nearFor(cam, H, 1);

    // 2. Only ever comes in — and for a seat that did not need it, not at all.
    if (!(cam.near <= NEAR)) problems.push(`${seat.label} @${W}x${H}: fitted plane ${cam.near} is BEYOND NEAR ${NEAR}`);
    if (!(cam.near >= NEAR_MIN)) problems.push(`${seat.label} @${W}x${H}: fitted plane ${cam.near} is under the floor ${NEAR_MIN}`);
    if (!seat.fits) {
      if (Object.is(cam.near, NEAR)) unchanged++;
      else problems.push(`${seat.label} @${W}x${H}: plane moved to ${cam.near} on a seat whose ground already reached its bottom row — this seat is meant to be bit-identical`);
    } else if (!(cam.near < NEAR)) {
      problems.push(`${seat.label} @${W}x${H}: plane stayed at ${NEAR} on a seat that needs it fitted — the fix reaches nothing here`);
    }

    // 1. Reach, and its control.
    const got = groundAtBottomRow(cam, W, H, cam.near);
    if (got.f > cam.near) reach++;
    else problems.push(`${seat.label} @${W}x${H}: the ground at the last row is ${got.f.toFixed(5)} tiles out, INSIDE the ${cam.near.toFixed(5)} plane — it is clipped, and the floor's terrain draws there instead`);

    const was = groundAtBottomRow(cam, W, H, NEAR);
    if (!(was.f > NEAR)) { controlFailed++; clipped.add(seat.label); }
    rows.push(`  ${seat.label.padEnd(38)} ${String(W).padStart(4)}x${String(H).padStart(4)}  eye ${cam.EH.toFixed(3)}  near ${cam.near.toFixed(5)}  bottom-row ground ${got.f.toFixed(5)}  (fixed plane: ${was.f.toFixed(5)}${was.f > NEAR ? '' : ' CLIPPED'})`);
  }
}

// 3. One plane, spent everywhere.
//
// The matrix first: the two coefficients `sprites.js` and `strokes.js` push as `uAB` have to BE the
// z row the vertices are projected through, or a light lands at one depth and is compared at another.
for (const [W, H] of FRAMES) {
  const cam = ws.makeCam(W, H * 0.42, H * 0.55, { heading: 0, height: 0, eyeH: 0.05, map: null });
  cam.near = nearFor(cam, H, 1);
  // ⚠ THE PROJECTION'S OWN z ROW, NOT THE VIEW-PROJECTION'S. `viewProjMatrix` multiplies the view
  // rotation in, so its `[10]`/`[14]` are not A and B any more — a first cut compared those and
  // reported every seat as broken while the code was right, which is the direction that costs an
  // afternoon chasing a correct renderer.
  const m = projMatrix(cam, H), z = zRow(cam.near);
  if (!Object.is(m[10], z[0]) || !Object.is(m[14], z[1])) {
    problems.push(`zRow(${cam.near}) = [${z}] does not match the matrix's own z row [${m[10]}, ${m[14]}] at ${W}x${H}`);
  }
}

// …and then the files, located rather than counted. A count passes when somebody deletes one line
// and adds another; what matters is that each of these five spends the frame's plane and none of
// them writes a clip range of its own.
// ⚠ COMMENTS BLANKED FIRST, with `imports:smoke`'s own scanner rather than a second one. These
// files carry long prose about the plane they used to spell, so a regex over raw source finds the
// paragraph explaining the fix and reports it as the bug — which it did on the first run.
const SRC = (p) => blank(readFileSync('client/game/js/panels/gl/' + p, 'utf8'));
const MUST = [
  ['camera.js', /export function projMatrix\(cam, H, near = \(cam && cam\.near\) \|\| NEAR/, "projMatrix's default is the camera's own plane"],
  ['world.js', /cam\.near = nearFor\(cam, cssH, opts\.nearFit/, 'world.js stamps the frame\'s plane on the camera'],
  // ⚠ THE SECOND ARGUMENT IS THE CLAIM; THE FIRST IS THE FOG'S BUSINESS. This matched the call
  // spelled literally until the fog pass began folding `fogHScale` into the options object, at
  // which point a correct hand-off read as a missing one. What must hold is that the floor is
  // given `cam.near`; what is in the bag beside it is not this gate's question.
  ['world.js', /drawFloor\([^()]*,\s*cam\.near\)/, 'the floor is handed the frame\'s plane (it is the one layer with no `cam`)'],
  ['floor.js', /function draw\(s, near = NEAR\)/, 'the floor takes a plane rather than holding one'],
  ['floor.js', /const zr = zRow\(near\)/, "the floor's depth mapping comes from zRow"],
  ['sprites.js', /const zr = zRow\(\(cam && cam\.near\) \|\| NEAR\)/, "the sprite layer's z row is per frame"],
  ['strokes.js', /const zr = zRow\(\(cam && cam\.near\) \|\| NEAR\)/, "the stroke layer's z row is per frame"],
  ['context.js', /const \[A, B\] = zRow\(\(cam && cam\.near\) \|\| NEAR\)/, "the SSAO depth unproject reads the frame's plane"],
];
for (const [file, re, what] of MUST) {
  if (!re.test(SRC(file))) problems.push(`gl/${file}: ${what} — not found. A pass on its own near plane is invisible in the picture and reads as z-fighting.`);
}
// The literal that was there, and must not come back. `0.06` is a legitimate number elsewhere in
// these files (alphas, thresholds), so this looks for it being SPELLED as a clip range.
for (const file of ['floor.js', 'sprites.js', 'strokes.js', 'ground.js', 'decals.js', 'billboards.js', 'curtain.js', 'solids.js', 'clouds.js']) {
  const m = SRC(file).match(/near\s*=\s*0\.06|0\.06\s*,\s*far|far\s*=\s*400/);
  if (m) problems.push(`gl/${file}: spells its own clip range (${JSON.stringify(m[0])}) — import NEAR/FAR/zRow from camera.js, which is where they are named once.`);
}

// The control, named rather than counted. Three seats are the reported bug itself — a camera at
// street level and a free camera pressed onto the road — and every one of them has to be CLIPPED
// with the plane put back to 0.06, or this gate would have passed before the fix. A seat that is
// merely fitted is not evidence: `NEAR_FIT`'s cushion moves the plane a little on seats that were
// already reaching, which is harmless and proves nothing.
const MUST_CLIP = ['street (eyeH 0.06)', 'freecam on the deck (ez 0.05)', 'freecam under the deck (ez -0.4, floored)'];
for (const label of MUST_CLIP) {
  if (!clipped.has(label)) {
    problems.push(`the mutation control is not biting on "${label}": its bottom row is reached even at the FIXED ${NEAR} plane, `
      + 'so this gate would have passed before the fix. Either the seat no longer stands on the ground or the control is wrong.');
  }
}

if (problems.length) {
  console.error(`\n✗ nearfit — ${problems.length} problem(s):`);
  for (const p of problems) console.error('  · ' + p);
  console.error('\n  A clip plane that reaches into the frame deletes the road, its kerbs and its');
  console.error('  markings from the near band and leaves the floor\'s terrain showing through.');
  console.error('  See `nearFor` in client/game/js/panels/gl/camera.js.');
  process.exit(1);
}
console.log(`✓ nearfit: ${reach} seat/frame pairs reach their own bottom row, ${unchanged} keep the fixed ${NEAR} exactly, `
  + `${controlFailed} would be clipped without the fit, and all ${MUST.length} consumers spend the frame's own plane.`);
for (const r of rows) console.log(r);
