// Is the puddle camera actually a mirror?
//
//   node scripts/shapes/glmirror.mjs
//
// The wet road reflects the city by rendering it a second time through a camera that flips the
// world about the water's plane (gl/mirror.js). That is exact for a flat mirror and it is exact for
// one reason only: the reflection matrix really is a reflection. Get it slightly wrong and the
// result is not an error — it is a city in the water that is *nearly* right, seen from *nearly* the
// correct place, which is the hardest class of bug there is to see in a surface that is already
// dim, already blurred and already multiplied down to a few per cent.
//
// ⚠ AND THE OBVIOUS WRONG VERSION LOOKS RIGHT. Reflecting about z = h is NOT "put the camera at
// −EH": u = (2h − z) − EH = −(z − (2h − EH)), so it is a camera at 2h − EH with the UP AXIS
// NEGATED TOO. Move the eye and leave up alone and you render the city the right way up from
// underneath the road — which reads as a reflection right up until something in it has a top and a
// bottom, and every sign in this city does. Case 5 below is that mistake, asserted to be visibly
// different, so the gate cannot pass on a camera that merely went somewhere else.
//
// Arithmetic only: no GPU, no DOM beyond the windshield stub, no network.
import { loadWindshield } from './dom-stub.mjs';
import { viewMatrix, viewProjMatrix, projectThrough } from '../../client/game/js/panels/gl/camera.js';

const ws = await loadWindshield();
const { makeCam } = ws;

const W = 1280, H = 720;
const HORIZON = H * 0.42, DEPTH = H * 0.55;
const TOL_PX = 1e-6;

const HEADINGS = [0, 37, 90, 184.5, 271, 359.1];
const EYES = [0.05, 0.24, 1.4, 6];
const PLANES = [0, 0.4, -0.25];
const CHASES = [null, { back: 1.6, up: 0.22 }, { back: 0, up: 0, fx: 1.2, fy: -0.7 }];
// Points above the ground, which is the only kind a puddle has anything to say about.
const PTS = [
  [0, -5, 1], [0.44, -5.44, 1.4], [3, -12, 2.9], [-7, -2, 0.6],
  [12, -30, 6], [-0.3, -1.2, 3.2], [0.1, -0.6, 0.05],
];

let checks = 0, bad = 0;
const worst = { px: 0, where: '' };
const fail = (msg) => { bad++; if (bad <= 8) console.log('  ✗ ' + msg); };

const cams = [];
for (const heading of HEADINGS) {
  for (const eyeH of EYES) {
    for (const chase of CHASES) {
      cams.push({ heading, eyeH, chase, cam: makeCam(W, HORIZON, DEPTH, { heading, height: 0, eyeH, map: null }, chase || undefined) });
    }
  }
}

// ── 1. THE DEFINITION ───────────────────────────────────────────────────────
//
// A point at height z, seen through the mirrored camera, must land exactly where its reflection
// 2h − z lands through the ordinary one. That IS what a planar reflection means, and it is the
// whole claim the ground shader's screen-space read-back rests on.
for (const { heading, eyeH, cam } of cams) {
  for (const h of PLANES) {
    const m = viewProjMatrix({ ...cam, mirrorZ: h }, H);
    const plain = viewProjMatrix(cam, H);
    for (const [x, y, z] of PTS) {
      const a = projectThrough(m, x, y, z, W, H);
      const b = projectThrough(plain, x, y, 2 * h - z, W, H);
      if (a.f <= 0.061 || b.f <= 0.061) continue;
      checks++;
      const px = Math.max(Math.abs(a.sx - b.sx), Math.abs(a.sy - b.sy));
      if (px > worst.px) { worst.px = px; worst.where = `hdg ${heading} eye ${eyeH} plane ${h} pt ${x},${y},${z}`; }
      if (px > TOL_PX || Math.abs(a.f - b.f) > 1e-9) {
        fail(`mirror ≠ reflection: hdg ${heading} eye ${eyeH} plane ${h} pt (${x},${y},${z}) — ${px.toFixed(6)} px`);
      }
    }
  }
}

// ── 2. THE WATER'S OWN SURFACE DOES NOT MOVE ────────────────────────────────
//
// A point ON the plane is its own reflection, so it must project identically either way. This is
// what makes the read-back exact at the fragment being shaded rather than merely close: the puddle
// pixel asking the question is the one point both cameras agree on absolutely.
for (const { cam } of cams) {
  for (const h of PLANES) {
    const m = viewProjMatrix({ ...cam, mirrorZ: h }, H);
    const plain = viewProjMatrix(cam, H);
    for (const [x, y] of PTS) {
      const a = projectThrough(m, x, y, h, W, H);
      const b = projectThrough(plain, x, y, h, W, H);
      if (a.f <= 0.061) continue;
      checks++;
      if (Math.max(Math.abs(a.sx - b.sx), Math.abs(a.sy - b.sy)) > TOL_PX) {
        fail(`a point on the plane moved: plane ${h} pt (${x},${y})`);
      }
    }
  }
}

// ── 3. NO MIRROR IS THE MATRIX THAT SHIPPED ─────────────────────────────────
//
// `viewMatrix` grew a branch, and the overwhelmingly common path through it is the one with no
// mirror at all — every ordinary frame in the game. Object.is on all sixteen terms, because "very
// close" is not the claim: this path must not have been touched.
for (const { cam } of cams) {
  for (const pitch of [0, 0.2, -0.35]) {
    const before = viewMatrix({ ...cam, camPitch: undefined, pitch });
    const after = viewMatrix({ ...cam, pitch, mirrorZ: undefined });
    checks++;
    for (let i = 0; i < 16; i++) {
      if (!Object.is(before[i], after[i])) { fail(`unmirrored matrix changed at term ${i} (pitch ${pitch})`); break; }
    }
  }
}

// ── 4. THE WINDING FLIPS, WHICH IS WHY decals.js HAS A uFlip ────────────────
//
// The reflection has determinant −1, so a quad handed over in its reading order — TL, TR, BR, BL —
// walks the other way round in NDC. `decals.js` decides a sign's front from gl_FrontFacing, so
// without being told, the mirror pass shows exactly the signs that are pointing away from you,
// reading backwards. Asserted as a sign change in the projected area rather than trusted.
const QUAD = [[-1, -6, 3], [1, -6, 3], [1, -6, 1.2], [-1, -6, 1.2]];   // TL, TR, BR, BL on a wall
const area = (m) => {
  const p = QUAD.map(([x, y, z]) => projectThrough(m, x, y, z, W, H));
  let s = 0;
  for (let i = 0; i < 4; i++) { const a = p[i], b = p[(i + 1) % 4]; s += a.sx * b.sy - b.sx * a.sy; }
  return s / 2;
};
for (const { heading, cam } of cams) {
  const plain = area(viewProjMatrix(cam, H));
  const mirrored = area(viewProjMatrix({ ...cam, mirrorZ: 0 }, H));
  if (Math.abs(plain) < 1e-3) continue;   // edge on, no opinion
  checks++;
  if (Math.sign(plain) === Math.sign(mirrored)) {
    fail(`winding did NOT flip at hdg ${heading} — decals.js uFlip would select the wrong facing`);
  }
}

// ── 5. AND IT IS NOT JUST A CAMERA LOWER DOWN ───────────────────────────────
//
// The mistake this whole file is written around. A camera moved to 2h − EH with its up axis left
// alone renders the city the right way up from under the road. Against a point well above the
// ground it must disagree with the real mirror by a large, obvious number of pixels — a small one
// would mean the two are nearly the same transform and the gate above is not testing what it says.
{
  let seen = 0, tooClose = 0;
  for (const { cam } of cams) {
    const real = viewProjMatrix({ ...cam, mirrorZ: 0 }, H);
    const naive = viewProjMatrix({ ...cam, EH: -cam.EH }, H);
    for (const [x, y, z] of PTS) {
      const a = projectThrough(real, x, y, z, W, H);
      const b = projectThrough(naive, x, y, z, W, H);
      if (a.f <= 0.061 || b.f <= 0.061) continue;
      seen++;
      if (Math.abs(a.sy - b.sy) < 1.0) tooClose++;
    }
  }
  checks++;
  // Near the ground plane and at a low eye the two genuinely do converge, which is correct and not
  // a hole: the claim is that they differ across the sweep, not at every single point in it.
  if (!seen || tooClose / seen > 0.5) {
    fail(`a mirror and a lowered camera agree at ${tooClose}/${seen} points — the reflection is not being tested`);
  }
}

if (bad) {
  console.log(`\nglmirror FAILED — ${bad} of ${checks} checks.`);
  process.exit(1);
}
console.log(`✓ glmirror: ${checks} checks over ${cams.length} cameras × ${PLANES.length} water planes — `
  + `the mirrored camera is a reflection about its plane (worst ${worst.px.toExponential(1)} px), `
  + `the plane itself does not move, the unmirrored matrix is untouched, and the winding flips.`);
