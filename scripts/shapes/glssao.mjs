// THE SCREEN-SPACE OCCLUSION PASS, AS FAR AS IT CAN BE PROVED WITHOUT A GPU.
//
// Almost all of this feature is a fragment shader, and there is no rasteriser here — so what this
// gate holds is the part that decides whether the occlusion lands on the geometry at all: the
// inversion from a depth sample back to a point in space.
//
// ⚠ THAT INVERSION IS THE THING MOST LIKELY TO BE SILENTLY WRONG, AND ITS FAILURE LOOKS LIKE A
// TUNING PROBLEM. It does not throw and it does not draw nothing: get a constant wrong and the
// pass resolves occlusion for a camera that is not the one the vertices went through, which reads
// as a badly chosen radius — a bit of dirt in the wrong corners — rather than as a broken feature.
// Nobody would go looking at a matrix for that.
//
// So the round trip is against `projMatrix` ITSELF, the function the mass vertex shader multiplies
// by. Take a view-space point, push it through the real matrix to a depth-buffer value and a pixel,
// invert both back, and demand the original point. Anything that changes the projection — a new
// clip range, a principal-point term, a pitch row — fails here rather than in the picture.
//
// ⚠ AND IT COVERS PITCH, because `camPitch` exists and only the Modelshop passes one today. A view
// that starts using it must not discover that the occlusion pass was written for a level camera.
import { projMatrix, viewMatrix, multiply, NEAR, FAR } from '../../client/game/js/panels/gl/camera.js';
import { RECONSTRUCT, SSAO_TAPS } from '../../client/game/js/panels/gl/ssao.js';

const problems = [];
const A = (FAR + NEAR) / (FAR - NEAR), B = -2 * FAR * NEAR / (FAR - NEAR);

// ── 1. THE KERNEL ─────────────────────────────────────────────────────────────
//
// ⚠ DETERMINISTIC, AND THAT IS A REQUIREMENT RATHER THAN A PREFERENCE. Every measurement in this
// renderer is a before/after on one scene, so a kernel seeded from Math.random would make two runs
// of the same bench disagree and there would be no way to tell a retune from noise.
{
  const mod = await import('../../client/game/js/panels/gl/ssao.js');
  // Re-importing gives the same module instance, so instead the shape is checked: the module
  // exports its tap count and the kernel is built from it at load.
  if (!(SSAO_TAPS >= 8 && SSAO_TAPS <= 32)) problems.push(`SSAO_TAPS is ${SSAO_TAPS}, outside the 8..32 a per-fragment loop can afford`);
  if (typeof mod.createSSAOLayer !== 'function') problems.push('ssao.js does not export createSSAOLayer');
  console.log(`  · kernel: ${SSAO_TAPS} taps`);
}

// ── 2. THE DEPTH INVERSION ────────────────────────────────────────────────────
//
// A view-space forward distance, through the projection's own z mapping and back.
{
  let worst = 0;
  for (const z of [0.1, 0.5, 1, 2, 5, 12, 30, 80, 200, 300]) {
    // What projMatrix does to the z and w rows: clip.z = A·z + B, clip.w = z.
    const ndc = (A * z + B) / z;
    const dz = (ndc + 1) / 2;
    const back = RECONSTRUCT.dist(dz, A, B);
    const err = Math.abs(back - z) / z;
    if (err > worst) worst = err;
  }
  if (worst > 1e-5) problems.push(`the depth inversion is out by ${(worst * 100).toFixed(4)}% at worst`);
  console.log(`  · depth inversion: worst relative error ${(worst * 100).toExponential(2)}% over 0.1..300 tiles`);

  // ⚠ THE FAR PLANE MUST ANSWER "NOTHING THERE", NOT A HUGE NUMBER THAT IS STILL A NUMBER. The sky
  // writes 1.0 into the depth buffer, and a reconstruction that handed back a finite point there
  // would let the sky occlude the skyline — a dark rim around every building against open air,
  // which is the single most recognisable way a screen-space pass announces itself.
  if (Number.isFinite(RECONSTRUCT.dist(1.0, A, B))) problems.push('the far plane reconstructs to a finite distance — the sky can occlude');
  if (Number.isFinite(RECONSTRUCT.dist(0.9999995, A, B))) problems.push('a depth one ulp inside the far plane reconstructs to a finite distance');

  // ⚠ AND WHERE THAT CUTOFF ACTUALLY FALLS IS WORTH PINNING, because it is a distance rather than a
  // depth value and nothing about `0.999999` says what it means in tiles. Today it is about 397 of
  // the 400-tile clip range, and the furthest the world is ever drawn is 34 — so it can only ever
  // catch genuine sky. A tighter threshold would start reading distant BUILDINGS as sky, which
  // deletes their occlusion silently and only in the depth the horizon is at.
  let cutoff = Infinity;
  for (let z = 400; z > 1; z -= 0.5) {
    const ndc = (A * z + B) / z;
    if (Number.isFinite(RECONSTRUCT.dist((ndc + 1) / 2, A, B))) { cutoff = z; break; }
  }
  if (!(cutoff > 120)) problems.push(`everything past ${cutoff} tiles reconstructs as sky — the world is drawn to 34, but that is far too close a margin`);
  console.log(`  · anything past ${cutoff.toFixed(0)} tiles reads as sky (clip range ${FAR}, world drawn to ~34)`);
}

// ── 3. AND THE FULL ROUND TRIP, THROUGH THE REAL MATRIX ───────────────────────
{
  const cams = [];
  for (const pitch of [0, 0.18, -0.12]) {
    for (const heading of [0, 0.7, 2.4]) {
      cams.push({ W: 640, H: 360, FL: 300, depth: 210, horizonY: 148,
        sinh: Math.sin(heading), cosh: Math.cos(heading), back: 0.6, fx: 0.2, fy: -0.4, EH: 0.12, camPitch: pitch });
    }
  }
  let worst = 0, n = 0;
  for (const cam of cams) {
    const H = cam.H;
    const m = multiply(projMatrix(cam, H), viewMatrix({ ...cam, pitch: cam.camPitch }));
    const fxn = 2 * cam.FL / cam.W, fyn = 2 * cam.depth / H, cy0 = 1 - 2 * cam.horizonY / H;
    const V = viewMatrix({ ...cam, pitch: cam.camPitch });
    for (const p of [[3, 9, 0.5], [-7, 21, 4], [0.5, 2, 12], [14, 60, 0.1], [-2, 5, 30]]) {
      // The point in VIEW space, which is what the shader reconstructs.
      const vx = V[0] * p[0] + V[4] * p[1] + V[8] * p[2] + V[12];
      const vy = V[1] * p[0] + V[5] * p[1] + V[9] * p[2] + V[13];
      const vz = V[2] * p[0] + V[6] * p[1] + V[10] * p[2] + V[14];
      if (!(vz > 0.1)) continue;                       // behind the eye; the pass skips those too
      // Through the full matrix to clip, then to a pixel and a depth value.
      const cx = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
      const cy = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
      const cz = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
      const cw = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
      const ndcX = cx / cw, ndcY = cy / cw, dz = (cz / cw + 1) / 2;
      // And back, the way the shader does it.
      const w = RECONSTRUCT.dist(dz, A, B);
      const got = RECONSTRUCT.view(ndcX, ndcY, w, fxn, fyn, cy0);
      const err = Math.max(Math.abs(got[0] - vx), Math.abs(got[1] - vy), Math.abs(got[2] - vz));
      if (err > worst) worst = err;
      n++;
    }
  }
  // In TILES, because view space here is metric — see the header of ssao.js. A tenth of a
  // millimetre of a tile is float noise; anything a gate would care about is orders above it.
  if (worst > 1e-3) problems.push(`the view-space reconstruction is out by ${worst.toFixed(5)} tiles at worst`);
  console.log(`  · round trip: ${n} points over ${cams.length} cameras (pitch included), worst ${worst.toExponential(2)} tiles`);
}

if (problems.length) {
  console.error(`\n✗ glssao — ${problems.length} problem(s):`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log('✓ glssao: a depth sample inverts back to the point it came from, through the same projection the vertices use, at every pitch and heading tested.');
