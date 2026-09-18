// skypan — does the horizon ridge pan with the ground, or does it slide against it?
//
// ⚠ THIS FAILURE IS SILENT AND LOOKS LIKE WEATHER. The skyline is stylised noise at the far edge of
// the frame, so a ridge panning at the wrong rate does not read as a bug — it reads as haze moving,
// or as nothing at all until somebody sweeps the camera and notices the mountains crawling along
// the coastline. Nothing else in the repo can see it: `shapes:smoke` proves the painters RUN,
// `glparity` compares the two renderers' cameras to each other, and every pixel harness lives in
// the Modelshop. This is the one property that says the backdrop and the world agree.
//
// The property. A distant ridge is at (effectively) infinite range, so under a pure yaw it is RIGID
// IN BEARING: the compass direction a given ridge feature sits at does not change, only which screen
// column that bearing lands in. GLASS is rectilinear — `sx = cx + tan(rel)·FL` — so that column moves
// as tan, and its local pan rate goes as sec² of the angle off the optical axis. A mapping that is
// LINEAR in heading agrees with that near the middle of the frame and nowhere else.
//
// Which is what shipped until 2026-09-17: `p = x / fovK + (heading / 360) * W * 2.5 * par`. Measured
// at the seat's own lens, a horizon-distance ground point pans 23.6 px/° at the frame edge while the
// ridge panned 9.8 — so the backdrop sheared against the terrain on every turn, worst at the edges
// and worst of all through a wide lens, where the edge of the frame is 76° off axis.
//
//   node scripts/shapes/skypan.mjs
import { makeCam, skyColumnP } from '../../client/game/js/panels/windshield.js';

const W = 1280, H = 640, HZ = H * 0.42, FOCAL = H * 0.55;
const RAD = Math.PI / 180;
// The two bands drawSkyline paints, as it passes them. Held here so a retune of the authored
// parallax has to come past this file rather than silently changing what the gate is checking.
const PAR_FAR = 0.82, PAR_NEAR = 1.10;

let checks = 0, bad = 0;
const fail = (what) => { checks++; bad++; if (bad <= 12) console.log(`  ✗ ${what}`); };
const check = (cond, what) => { if (cond) checks++; else fail(what); };
const near = (a, b, tol, what) => check(Math.abs(a - b) <= tol, `${what} — got ${a}, want ${b} (±${tol})`);

// The seat the identity is exact at: an aircraft passes no `fovMul`, so the sky camera's focal
// length and the ground camera's are the same number. (The cab asks for 1.22 and they are not —
// that is the stated gap recorded at `skyFocal`, and it is not what this file is about.)
const camAt = (heading, fovMul) =>
  makeCam(W, HZ, FOCAL, { heading, height: 0, map: null, fovMul });

// Where the GROUND camera puts a point sitting at compass bearing `bear`, very far away.
// Bearing 0 is north, which is -y — see the `f`/`l` solve in makeCam.
const groundX = (cam, heading, bear, r = 50000) => {
  const b = bear * RAD;
  return cam.proj(r * Math.sin(b), -r * Math.cos(b), 0).sx;
};

// The mapping that used to ship, for the mutation control below.
const legacyP = (x, fovK, headingDeg, par) => x / fovK + (headingDeg / 360) * W * 2.5 * par;

// ── 1. RIGID IN BEARING, AGAINST THE GROUND CAMERA ──────────────────────────
// A ridge feature at a fixed compass bearing must keep the SAME noise coordinate however the
// camera turns. Swept over lenses, headings and bearings across the whole frame.
const LENSES = [0.4, 0.683, 1, 1.6, 3.2];
// ⚠ A FIXED ABSOLUTE BEARING, WITH THE CAMERA TURNING UNDER IT. The first cut of this file held the
// angle off the NOSE fixed instead, which holds the screen column perfectly still and therefore asks
// nothing at all — it passed the fix and the bug identically.
const BEARINGS = [-62, -30, -9, 0, 9, 30, 62];
const HEADINGS = [-6, 0, 5, 13, 24];
let legacyCaught = 0;
for (const fovMul of LENSES) {
  const FL = camAt(0, fovMul).FL;
  for (const bear of BEARINGS) {
    let ref = null, refLegacy = null, movedLegacy = false;
    for (const heading of HEADINGS) {
      if (Math.abs(bear - heading) > 70) continue;           // past that the tan is off the canvas anyway
      const x = groundX(camAt(heading, fovMul), heading, bear);
      const p = skyColumnP(x, W, FL, heading * RAD, 1);
      if (ref == null) ref = p;
      else near(p, ref, 1e-6, `lens ${fovMul} bearing ${bear}°: ridge coordinate moved when the camera turned to ${heading}°`);
      const lp = legacyP(x, fovMul, heading, 1);
      if (refLegacy == null) refLegacy = lp;
      else if (Math.abs(lp - refLegacy) > 1e-6) movedLegacy = true;
    }
    if (movedLegacy) legacyCaught++;
  }
}

// ── 2. THE MUTATION CONTROL ─────────────────────────────────────────────────
// A check that cannot fail is worth nothing. Restore the old mapping and case 1 must reject it at
// every bearing — including dead ahead, because a feature at a fixed bearing leaves the middle of
// the frame the moment the camera turns.
const pairs = LENSES.length * BEARINGS.length;
check(legacyCaught === pairs,
  `the legacy linear mapping must FAIL case 1 at every bearing — caught ${legacyCaught} of ${pairs}`);

// ── 3. THE PAN RATE IS THE GROUND'S, AT THE EDGE AND NOT ONLY AT THE CENTRE ──
// This is the bug in its own words: for a 5° yaw, how far does a ridge feature move, against how
// far the ground moves a point at the same bearing? At par 1 they must be the same number.
const YAW = 5;
for (const fovMul of LENSES) {
  const FL = camAt(0, fovMul).FL;
  for (const off of [0, 30, 55, 68]) {
    const h0 = 23, h1 = h0 + YAW, bear = h0 + off;
    const gx0 = groundX(camAt(h0, fovMul), h0, bear), gx1 = groundX(camAt(h1, fovMul), h1, bear);
    // Where the ridge puts the feature that was at gx0, one yaw later: solve p(x1, h1) = p(gx0, h0).
    const b = Math.atan((gx0 - W / 2) / FL) - YAW * RAD;
    const rx1 = W / 2 + FL * Math.tan(b);
    near(rx1, gx1, 1e-6 * Math.max(1, Math.abs(gx1)),
      `lens ${fovMul} at ${off}° off axis: ridge lands ${rx1.toFixed(2)} where the ground lands ${gx1.toFixed(2)}`);
  }
}

// ── 4. THE SHIPPED LOOK IS PRESERVED ────────────────────────────────────────
// Feature SIZE is the half of this that is not about panning, and it is the half a "fix" is most
// likely to break. Two properties: at the seat's own lens the centre column is exactly one noise
// unit per pixel (which is what the linear mapping gave, so the ridge looks like itself), and the
// features magnify with the lens like everything else in the frame.
{
  const dx = 1e-4;
  const density = (fovMul) => {
    const FL = camAt(0, fovMul).FL;
    return (skyColumnP(W / 2 + dx, W, FL, 0, 1) - skyColumnP(W / 2 - dx, W, FL, 0, 1)) / (2 * dx);
  };
  near(density(1), 1, 1e-6, 'at fovMul 1 the centre column must be 1 noise unit per pixel');
  near(density(2) * 2, 1, 1e-6, 'doubling the focal length must double the ridge feature width on screen');
  near(density(0.5) * 0.5, 1, 1e-6, 'halving the focal length must halve the ridge feature width on screen');
}

// ── 5. THE AUTHORED PARALLAX SURVIVES ───────────────────────────────────────
// The two bands slide against each other on purpose. Correcting the common-mode rate must not
// change that ratio — it is the depth cue the backdrop is drawn for.
{
  // ⚠ A RATE, NOT A FINITE STEP. The parallax is `par` times the ground's own rate, and a 5° step
  // through a tan is column-dependent — measured that way the ratio comes out 1.331 at 180 px off
  // centre and the check reads as a failure of the fix rather than of the measurement.
  const FL = camAt(0, 1).FL, x = W / 2 + 180, dY = 1e-6;
  // The closed-form inverse of skyColumnP. Tied to the real function on the next line rather than
  // trusted, so this section cannot quietly go on testing a mapping the renderer no longer uses.
  const moved = (par) => W / 2 + FL * Math.tan(Math.atan((x - W / 2) / FL) - dY * par);
  near(skyColumnP(moved(1), W, FL, dY, 1), skyColumnP(x, W, FL, 0, 1), 1e-9,
    'the inverse used below must land on the same noise coordinate skyColumnP gives');
  const slide = (par) => (x - moved(par)) / dY;
  // Tolerance carries the truncation of a finite difference through a tan (O(dY·tan β)); any real
  // change to either `par` moves this by ~1e-2.
  near(slide(PAR_NEAR) / slide(PAR_FAR), PAR_NEAR / PAR_FAR, 1e-5,
    'the near band must still slide against the far one at the authored 1.10/0.82');
  check(slide(PAR_NEAR) > slide(1) && slide(1) > slide(PAR_FAR),
    'the near band pans faster than infinity and the far band slower — the authored depth cue');
}

console.log(bad
  ? `\n✗ skypan: ${bad} of ${checks} checks failed`
  : `✓ skypan: ${checks} checks — the ridge is rigid in bearing and pans with the ground`);
process.exit(bad ? 1 : 0);
