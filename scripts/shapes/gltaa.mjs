// gltaa: the CPU half of the temporal resolve (gl/taa.js), as arithmetic.
//
//   node scripts/shapes/gltaa.mjs
//
// The resolve itself needs a GPU; what it's handed doesn't, and a wrong matrix there doesn't throw,
// it reprojects every pixel to the wrong place and the neighbourhood clamp quietly hides most of it
// as blur. So:
//   1. jitter 0 gives back the projection camera.js always returned, bit for bit;
//   2. a jitter of j moves every projected point by exactly j in NDC, and nothing else;
//   3. reprojMatrix takes a point's NDC this frame to where last frame's matrix put it, including
//      across a map-window recentre, against projecting the point directly;
//   4. the jitter sequence stays inside a pixel and averages to the pixel centre.
import { projMatrix, viewProjMatrix, setJitter, JITTER } from '../../client/game/js/panels/gl/camera.js';
import { reprojMatrix, invert4, jitterFor, TAA_TUNE } from '../../client/game/js/panels/gl/taa.js';

const problems = [];
const check = (cond, msg) => { if (!cond) problems.push(msg); };
let seed = 7;
const R = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// A camera in the shape viewMatrix/projMatrix read (see makeCam in windshield.js).
const camOf = () => {
  const head = R() * Math.PI * 2;
  return {
    sinh: Math.sin(head), cosh: Math.cos(head), back: 0.2 + R() * 2, fx: R() * 4 - 2, fy: R() * 4 - 2,
    EH: 0.1 + R() * 20, pitch: (R() - 0.5) * 0.4, FL: 300 + R() * 500, W: 960, depth: 300 + R() * 300,
    horizonY: 200 + R() * 140, near: 0.06, ox: 0, oy: 0,
  };
};
const H = 540;
const apply = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12] * p[3],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13] * p[3],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14] * p[3],
  m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15] * p[3],
];
const ndc = (c) => [c[0] / c[3], c[1] / c[3], c[2] / c[3]];

// 1 and 2.
{
  setJitter(0, 0);
  const cam = camOf();
  const base = projMatrix(cam, H);
  setJitter(0, 0);
  check(JSON.stringify(projMatrix(cam, H)) === JSON.stringify(base), 'jitter 0 changed the projection');
  let worst = 0, other = 0;
  for (let k = 0; k < 200; k++) {
    const c = camOf(), jx = (R() - 0.5) * 0.004, jy = (R() - 0.5) * 0.004;
    setJitter(0, 0); const a = viewProjMatrix(c, H);
    setJitter(jx, jy); const b = viewProjMatrix(c, H);
    setJitter(0, 0);
    const p = [R() * 40 - 20, R() * 40 - 20, R() * 10, 1];
    const pa = apply(a, p), pb = apply(b, p);
    if (pa[3] <= 0.05) continue;
    const na = ndc(pa), nb = ndc(pb);
    worst = Math.max(worst, Math.abs(nb[0] - na[0] - jx), Math.abs(nb[1] - na[1] - jy));
    other = Math.max(other, Math.abs(nb[2] - na[2]), Math.abs(pb[3] - pa[3]));
  }
  check(worst < 1e-9, `a jitter of j moved NDC by j plus up to ${worst.toExponential(2)}`);
  check(other < 1e-9, `the jitter moved depth or w by ${other.toExponential(2)}; it must touch x and y only`);
}

// 3.
{
  let worst = 0, n = 0;
  for (let k = 0; k < 400; k++) {
    const cur = camOf(), prev = { ...cur, fx: cur.fx + (R() - 0.5) * 0.4, fy: cur.fy + (R() - 0.5) * 0.4, sinh: Math.sin(Math.asin(cur.sinh) + (R() - 0.5) * 0.05), cosh: cur.cosh };
    prev.cosh = Math.sign(cur.cosh || 1) * Math.sqrt(Math.max(0, 1 - prev.sinh * prev.sinh));
    const shift = k % 3 ? [0, 0] : [Math.round(R() * 2 - 1), Math.round(R() * 2 - 1)];
    const Vc = viewProjMatrix(cur, H), Vp = viewProjMatrix(prev, H);
    const M = reprojMatrix(Vp, Vc, shift);
    if (!M) { problems.push('reprojMatrix returned null for an invertible camera'); break; }
    const q = [R() * 30 - 15, R() * 30 - 15, R() * 8, 1];
    const cc = apply(Vc, q), cp = apply(Vp, [q[0] + shift[0], q[1] + shift[1], q[2], 1]);
    if (cc[3] <= 0.1 || cp[3] <= 0.1) continue;
    const nc = ndc(cc);
    const via = apply(M, [nc[0], nc[1], nc[2], 1]);
    const a = ndc(via), b = ndc(cp);
    worst = Math.max(worst, Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
    n++;
  }
  check(n > 200, `only ${n} reprojection cases landed in front of both cameras`);
  check(worst < 1e-6, `reprojMatrix missed the direct projection by ${worst.toExponential(2)} in NDC`);
  const I = invert4([2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 1, 2, 3, 1]);
  const back = apply(I, apply([2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 1, 2, 3, 1], [5, 6, 7, 1]));
  check(Math.abs(back[0] - 5) + Math.abs(back[1] - 6) + Math.abs(back[2] - 7) < 1e-9, 'invert4 doesn\'t invert');
  check(invert4(new Array(16).fill(0)) === null, 'invert4 inverted a singular matrix');
}

// 4.
{
  const W = 960, Hd = 540;
  let mx = 0, my = 0, out = 0;
  for (let f = 0; f < TAA_TUNE.samples; f++) {
    const j = jitterFor(f, W, Hd);
    const px = j.x * W / 2, py = j.y * Hd / 2;
    if (Math.abs(px) > 0.5 || Math.abs(py) > 0.5) out++;
    mx += px; my += py;
  }
  check(out === 0, `${out} of ${TAA_TUNE.samples} jitter offsets fall outside the pixel`);
  check(Math.abs(mx / TAA_TUNE.samples) < 0.1 && Math.abs(my / TAA_TUNE.samples) < 0.1, `the jitter averages to (${(mx / TAA_TUNE.samples).toFixed(3)}, ${(my / TAA_TUNE.samples).toFixed(3)}) px, not the pixel centre`);
  const a = jitterFor(3, W, Hd), b = jitterFor(3 + TAA_TUNE.samples, W, Hd);
  check(a.x === b.x && a.y === b.y, 'the jitter sequence does not repeat every TAA_TUNE.samples frames');
}
setJitter(0, 0);

if (problems.length) {
  console.error(`✗ gl:taa: ${problems.length} problem(s)`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log('✓ gl:taa: jitter 0 is the old projection, a jitter moves NDC by exactly itself, the reprojection matches a direct projection across a recentre, and the sequence stays inside the pixel.');
