// THE SHAPE OF A FLOCK, MEASURED ONE WAY.
//
// A murmuration's proportions are judged by its three principal axes — Ballerini et al. measured
// real starling flocks at 1 : 2.8 : 5.6, the short axis vertical — and by how far apart neighbours
// fly. Two things judge our flocks by those numbers: fauna.mjs, which flies the CPU flock (murmur.js)
// headlessly, and the Modelshop's __glMurmurParity, which flies the GPU flock (gl/murmur-gpu.js) and
// reads it back. They share this file so that both are measured with the same ruler; two copies of an
// eigenvalue solve is how a flock passes one gate and fails the other for no reason about birds.
//
// Plain JavaScript with no imports, and in client/shared because that is a directory the Modelshop
// serves and scripts/ deliberately is not (see SERVE_DIRS in tools/modelshop/serve.mjs). Nothing in
// the game imports it.

/**
 * The three principal half-axes of a point cloud, smallest first, and its centroid.
 * Closed-form eigenvalues of the 3x3 covariance (the trigonometric solution for a symmetric matrix).
 */
export function principalAxes(pts) {
  const n = pts.length;
  let mx = 0, my = 0, mz = 0;
  for (const q of pts) { mx += q.x; my += q.y; mz += q.z; }
  mx /= n; my /= n; mz /= n;
  let xx = 0, yy = 0, zz = 0, xy = 0, xz = 0, yz = 0;
  for (const q of pts) { const a = q.x - mx, b = q.y - my, c = q.z - mz;
    xx += a * a; yy += b * b; zz += c * c; xy += a * b; xz += a * c; yz += b * c; }
  xx /= n; yy /= n; zz /= n; xy /= n; xz /= n; yz /= n;
  const p1 = xy * xy + xz * xz + yz * yz, q0 = (xx + yy + zz) / 3;
  const p2 = (xx - q0) ** 2 + (yy - q0) ** 2 + (zz - q0) ** 2 + 2 * p1;
  const pp = Math.sqrt(p2 / 6) || 1e-9;
  const B = [[(xx - q0) / pp, xy / pp, xz / pp], [xy / pp, (yy - q0) / pp, yz / pp],
             [xz / pp, yz / pp, (zz - q0) / pp]];
  const d = B[0][0] * (B[1][1] * B[2][2] - B[1][2] * B[2][1])
          - B[0][1] * (B[1][0] * B[2][2] - B[1][2] * B[2][0])
          + B[0][2] * (B[1][0] * B[2][1] - B[1][1] * B[2][0]);
  const r = Math.max(-1, Math.min(1, d / 2)), phi = Math.acos(r) / 3;
  const e1 = q0 + 2 * pp * Math.cos(phi);
  const e3 = q0 + 2 * pp * Math.cos(phi + 2 * Math.PI / 3);
  const e2 = 3 * q0 - e1 - e3;
  const v = [e1, e2, e3].map((x) => Math.sqrt(Math.max(x, 0))).sort((a, b) => a - b);
  return { I1: v[0], I2: v[1], I3: v[2], mx, my };
}

/** Median nearest-neighbour distance, brute force. Fine for a few thousand points. */
export function medianNND(pts) {
  const n = pts.length, nnd = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let best = Infinity;
    const a = pts[i];
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const b = pts[j], dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < best) best = d2;
    }
    nnd[i] = Math.sqrt(best);
  }
  nnd.sort();
  return nnd[n >> 1];
}

/** The bands fauna.mjs judges a flock by — real starlings sit at flat 2.8, plan 2.0. */
export const FLOCK_BANDS = Object.freeze({ FLAT_LO: 2.5, FLAT_HI: 4.0, PLAN_LO: 1.4, PLAN_HI: 3.2, DRIFT_MAX: 0.8 });
