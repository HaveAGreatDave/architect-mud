// Does the lateral frustum cull ever throw away something you could see?
//
// `drawWorldObjects` now skips a building whose four footprint corners all project off the side of
// the canvas. That is the cheapest large win available to the truck cab — from a ground camera
// nearly half the buildings in the window are off-cone, and each was running its full model arm and
// taking the perspective-correct wall blit outside the canvas — and it is also the class of change
// that punches holes in a skyline if the reasoning behind it is a hair wrong. There are no pixel
// tests here, so the only thing making it safe is a property:
//
//     sx = cx + (l / f) · FL,  and neither l nor f reads wz
//
// A building wall is vertical, so its whole screen-x extent is the extent of the two footprint
// corners it stands on — at the base, at the parapet, and at every height in between. If that holds,
// four corners bound the entire extruded box exactly and the cull is lossless rather than lucky.
//
// So: assert the height-independence against the shipping `makeCam` rather than believing it, then
// assert soundness the blunt way — sample the real footprint densely at many heights and demand
// that nothing the predicate rejected lands anywhere near the canvas. And finally assert the thing
// nobody would notice breaking: that it still culls ANYTHING. A predicate that quietly started
// returning false everywhere would pass every safety check in this file and give the frames back.
import { makeCam, offCanvasLaterally } from '../../client/game/js/panels/windshield.js';

const W = 1600, HZ = 420, DEPTH = 900;
const HEADINGS = [0, 17, 45, 90, 128.5, 180, 233.75, 270, 359.9];
// The two seats that read this: a cab (ground camera, its own wider focal length) and a cockpit.
const SEATS = [
  { name: 'cab', v: { heading: 0, height: 0, eyeH: 0.12, fovMul: 1.22, map: null }, chase: null },
  { name: 'cab-chase', v: { heading: 0, height: 0, eyeH: 0.12, map: null }, chase: { back: 1.6, up: 0.22 } },
  { name: 'cockpit', v: { heading: 0, height: 0.3, map: null }, chase: null },
];
// Heights spanning a flat shed to the tallest tower the stretch sliders can make.
const ZS = [0, 0.02, 0.11, 0.4, 1.0, 2.2, 5.5, 12];
// The real footprint is BUILDING_FOOT (~0.44) × bldgFoot; the near test pads to 0.62 and the cull
// tests 1.0. Sampling to 0.62 therefore proves genuine headroom rather than a coincidence at the
// exact radius the predicate happens to use.
const SAMPLE_HW = 0.62;

let checks = 0, bad = 0;
const fail = (what) => { checks++; bad++; if (bad <= 10) console.log(`  ✗ ${what}`); };
const ok = () => { checks++; };
const check = (cond, what) => cond ? ok() : fail(what);

// ── 1. sx does not depend on wz ──────────────────────────────────────────────
// The whole cull rests on this one line of `proj`. Object.is, not a tolerance: if this ever drifts
// to "close enough" the bound stops being exact and the argument above stops being an argument.
for (const seat of SEATS) {
  for (const heading of HEADINGS) {
    const cam = makeCam(W, HZ, DEPTH, { ...seat.v, heading }, seat.chase);
    for (const [dx, dy] of [[0, -5], [3, -12], [-8, -2], [0.4, -0.3], [20, -20], [-0.7, 0.9]]) {
      const ref = cam.proj(dx, dy, ZS[0]).sx;
      for (const wz of ZS) {
        check(Object.is(cam.proj(dx, dy, wz).sx, ref),
          `${seat.name} h=${heading} (${dx},${dy}) sx moved with wz=${wz}`);
      }
    }
  }
}

// ── 2. Soundness: nothing culled is anywhere near the canvas ─────────────────
// A dense sweep of tiles around the camera, at every heading and seat. For each one the predicate
// says draw or skip; for each SKIP, project the real footprint at every height and demand every
// sample sits off-canvas. Not "off by the margin" — genuinely outside [0, W], which is what the
// 96px pad is there to buy.
const RING = [];
for (let dx = -30; dx <= 30; dx += 1) for (let dy = -30; dy <= 30; dy += 1) {
  const d2 = dx * dx + dy * dy;
  if (d2 > 0.25 && d2 <= 30 * 30) RING.push([dx, dy]);
}
const SAMPLES = [];
for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) {
  SAMPLES.push([(i / 3 - 1) * SAMPLE_HW, (j / 3 - 1) * SAMPLE_HW]);
}

let culled = 0, kept = 0;
for (const seat of SEATS) {
  for (const heading of HEADINGS) {
    const cam = makeCam(W, HZ, DEPTH, { ...seat.v, heading }, seat.chase);
    for (const [dx, dy] of RING) {
      if (!offCanvasLaterally(cam, dx, dy, W)) { kept++; continue; }
      culled++;
      let worst = null;
      for (const [a, b] of SAMPLES) for (const wz of ZS) {
        const sx = cam.proj(dx + a, dy + b, wz).sx;
        if (sx >= 0 && sx <= W && (worst === null || Math.abs(sx - W / 2) < Math.abs(worst - W / 2))) worst = sx;
      }
      check(worst === null, `${seat.name} h=${heading} tile (${dx},${dy}) culled but projects to sx=${worst && worst.toFixed(1)} on a 0..${W} canvas`);
    }
  }
}

// ── 3. It still culls, and it culls the right things ─────────────────────────
// The failure mode this catches is the silent one: a predicate that stopped firing would satisfy
// every check above perfectly and simply hand the frame rate back to where it was.
const share = culled / (culled + kept);
check(share > 0.25, `the cull fires on only ${(share * 100).toFixed(1)}% of tiles in range — it has stopped doing its job`);
console.log(`  · ${(share * 100).toFixed(1)}% of in-range tiles culled across ${SEATS.length} seats × ${HEADINGS.length} headings`);

{
  const cam = makeCam(W, HZ, DEPTH, { heading: 0, height: 0, eyeH: 0.12, fovMul: 1.22, map: null }, null);
  // Heading 0 is −y, so dead ahead is (0, −n) and abeam is (±n, 0).
  check(!offCanvasLaterally(cam, 0, -20, W), 'a building dead ahead at 20 tiles was culled');
  check(!offCanvasLaterally(cam, 0, -3, W), 'a building dead ahead at 3 tiles was culled');
  check(offCanvasLaterally(cam, 25, 0, W), 'a building square abeam at 25 tiles was NOT culled');
  check(offCanvasLaterally(cam, -25, 0, W), 'a building square abeam to port at 25 tiles was NOT culled');
  // ⚠ The one that must never fire. A tile the camera is standing on, or just behind, has corners on
  // both sides of the near plane; `proj` clamps their f to 0.06 and their sx explodes, which widens
  // the box past any canvas rather than narrowing it. That is the direction this has to fail in.
  for (const [dx, dy] of [[0, 0], [0, 0.5], [0.4, 0.4], [0, 1.2], [-0.9, 0.6], [0, 2]]) {
    check(!offCanvasLaterally(cam, dx, dy, W), `a tile straddling the lens (${dx},${dy}) was culled`);
  }
  // …and nothing behind you should be culled by this pass either — the near test owns that, and a
  // building that is BOTH behind and abeam must not be reported as merely off to the side.
  check(!offCanvasLaterally(cam, 0.3, 0.3, W), 'a tile just aft of the lens was culled laterally');
}

// ── 4. A wider canvas culls less, never more ─────────────────────────────────
// Monotonicity in W. Cheap to assert and it pins the sign of the comparison, which is the one
// character in this whole change that could be wrong without anything looking wrong.
for (const heading of HEADINGS) {
  const cam = makeCam(W, HZ, DEPTH, { heading, height: 0, eyeH: 0.12, fovMul: 1.22, map: null }, null);
  for (const [dx, dy] of RING) {
    if (offCanvasLaterally(cam, dx, dy, W * 4) && !offCanvasLaterally(cam, dx, dy, W)) {
      fail(`h=${heading} (${dx},${dy}) culled on a WIDER canvas but kept on a narrow one`);
    } else ok();
  }
}

console.log(bad === 0
  ? `✓ frustum: ${checks} checks passed — the lateral cull is height-exact and never drops a visible building`
  : `✗ frustum: ${bad} of ${checks} checks FAILED`);
process.exit(bad === 0 ? 0 : 1);
