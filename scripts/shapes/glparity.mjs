// Does the GL camera draw the city from exactly where GLASS draws it?
//
// The spike's first question, and the one that decides whether the rest of it is worth measuring. A
// second renderer that puts every building an inch from where the first one does would look like an
// improvement and BE a regression: collision, the ground shadows, the occlusion field and the cold
// open all read the same geometry, so a camera that disagrees with `cam.proj` disagrees with the
// solid world.
//
// It is answerable without a GPU because the projection is arithmetic. `client/game/js/panels/gl/
// camera.js` writes GLASS's own pinhole as a 4×4 — two focal lengths (FL across, `depth` up) and a
// principal point at (W/2, horizonY), which is well above centre because the horizon is — and this
// runs the same points through both and compares.
//
// ⚠ THE TOLERANCE IS SUB-PIXEL, NOT "CLOSE". The two paths are the same expression reassociated, so
// they agree to floating-point dust; anything bigger is a real difference in the camera, not noise.
// A tolerance loose enough to absorb a genuine mistake is a gate that passes the day it matters.
import { loadWindshield } from './dom-stub.mjs';
import { viewProjMatrix, projectThrough } from '../../client/game/js/panels/gl/camera.js';

const ws = await loadWindshield();
const { makeCam } = ws;

const W = 1280, H = 720;
const HORIZON = H * 0.42, DEPTH = H * 0.55;
const TOL_PX = 0.01;
const TOL_F = 1e-9;

const HEADINGS = [0, 17, 45, 90, 128.5, 180, 233.75, 270, 359.9];
const EYES = [0.05, 0.24, 1.4, 6];
const PITCHES = [0, 0.2, -0.35, 0.9, 1.4];
const CHASES = [null, { back: 1.6, up: 0.22 }, { back: 0, up: 0, fx: 1.2, fy: -0.7 }];
const PTS = [
  [0, -5, 0], [0, -5, 1], [0.44, -5.44, 1.4], [-0.44, -4.56, 0.2],
  [3, -12, 2.9], [-7, -2, 0.6], [0.1, -0.6, 0.05], [12, -30, 6], [-0.3, -1.2, 3.2],
];

let checks = 0, bad = 0;
const worst = { px: 0, where: '' };

for (const heading of HEADINGS) {
  for (const eyeH of EYES) {
    for (const pitch of PITCHES) {
      for (const chase of CHASES) {
        const v = { heading, height: 0, eyeH, map: null, pitch };
        const cam = makeCam(W, HORIZON, DEPTH, v, chase || undefined);
        const m = viewProjMatrix(cam, H);
        for (const [x, y, z] of PTS) {
          const a = cam.proj(x, y, z);
          // Behind the near plane `proj` clamps f, and a clamped point is not a projection of
          // anything — it is a guard. Compare only where both are describing the same point.
          if (a.f <= 0.061) continue;
          const b = projectThrough(m, x, y, z, W, H);
          checks++;
          const dx = Math.abs(a.sx - b.sx), dy = Math.abs(a.sy - b.sy), df = Math.abs(a.f - b.f);
          const px = Math.max(dx, dy);
          if (px > worst.px) { worst.px = px; worst.where = `hdg ${heading} eye ${eyeH} pitch ${pitch} pt ${x},${y},${z}`; }
          if (px > TOL_PX || df > TOL_F) {
            bad++;
            if (bad <= 6) {
              console.log(`  ✗ hdg ${heading} eye ${eyeH} pitch ${pitch} chase ${chase ? JSON.stringify(chase) : 'none'} `
                + `pt (${x},${y},${z}): proj (${a.sx.toFixed(4)}, ${a.sy.toFixed(4)}, f ${a.f.toFixed(6)}) `
                + `vs gl (${b.sx.toFixed(4)}, ${b.sy.toFixed(4)}, f ${b.f.toFixed(6)})`);
            }
          }
        }
      }
    }
  }
}

if (bad) {
  console.error(`✗ glparity: ${bad} of ${checks} projections disagree — the GL camera is not GLASS's camera.`);
  process.exit(1);
}
console.log(`✓ glparity: ${checks} projections identical to cam.proj across `
  + `${HEADINGS.length} headings × ${EYES.length} eye heights × ${PITCHES.length} pitches × ${CHASES.length} chase offsets `
  + `(worst disagreement ${worst.px.toExponential(1)} px).`);
