// THE FIGURE'S OCCLUSION. How shut in each vertex of a figure is by the rest of it, baked once when the
// mesh is built (figure.js buildFigure, the close-up level), so the shader can sink an armpit, the gap
// under a chin, the inside of a collar and the crack between two fingers into shadow the way a lamp alone
// never does (the cat statue's carving taught the room this: gl/cat-statue.js).
//
// The mesh is rasterised into a shell of voxels; from each vertex a fan of rays goes out over the
// hemisphere round its normal, and each that meets the shell within `reach` closes the vertex in a
// little, more the nearer it meets it. 1 is open sky, 0 shut. Pure: arrays in, a Float32Array out.

// the ray fan: directions over the hemisphere round +z, cosine-weighted, kept off the grazing band where
// a ray would only meet the surface it starts on
const FAN = (() => {
  const n = 14, out = [];
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n, a = i * 2.399963, r = Math.sqrt(u) * 0.95;
    out.push([Math.cos(a) * r, Math.sin(a) * r, Math.sqrt(1 - r * r)]);
  }
  return out;
})();

export function occlusionOf({ P, N, I }, { cell = 0.012, reach = 0.11, skip = null } = {}) {
  const nv = P.length / 3, ao = new Float32Array(nv).fill(1);
  if (!nv) return ao;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let v = 0; v < nv; v++) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (z < z0) z0 = z;
    if (x > x1) x1 = x; if (y > y1) y1 = y; if (z > z1) z1 = z;
  }
  // room round it for a ray to run its full reach from just off the outermost vertex
  const pad = reach + cell * 3;
  x0 -= pad; y0 -= pad; z0 -= pad;
  const nx = Math.ceil((x1 - x0 + pad) / cell) + 1, ny = Math.ceil((y1 - y0 + pad) / cell) + 1, nz = Math.ceil((z1 - z0 + pad) / cell) + 1;
  const grid = new Uint8Array(nx * ny * nz), at = (x, y, z) => (((x - x0) / cell) | 0) + nx * ((((y - y0) / cell) | 0) + ny * (((z - z0) / cell) | 0));
  // the shell: every triangle sampled finer than a voxel
  for (let k = 0; k + 2 < I.length; k += 3) {
    const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3;
    if (skip && (skip(I[k]) || skip(I[k + 1]) || skip(I[k + 2]))) continue;
    const e = Math.max(Math.hypot(P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]), Math.hypot(P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]), Math.hypot(P[c] - P[b], P[c + 1] - P[b + 1], P[c + 2] - P[b + 2]));
    const n = Math.max(1, Math.ceil(e / (cell * 0.7)));
    for (let i = 0; i <= n; i++) for (let j = 0; i + j <= n; j++) {
      const u = i / n, w = j / n;
      grid[at(P[a] + (P[b] - P[a]) * u + (P[c] - P[a]) * w, P[a + 1] + (P[b + 1] - P[a + 1]) * u + (P[c + 1] - P[a + 1]) * w, P[a + 2] + (P[b + 2] - P[a + 2]) * u + (P[c + 2] - P[a + 2]) * w)] = 1;
    }
  }
  // the rays, from just off each vertex along its normal
  const steps = Math.ceil(reach / cell);
  for (let v = 0; v < nv; v++) {
    let n0 = N[v * 3], n1 = N[v * 3 + 1], n2 = N[v * 3 + 2];
    const l = Math.hypot(n0, n1, n2);
    if (l < 1e-6) continue;
    n0 /= l; n1 /= l; n2 /= l;
    // a frame round the normal
    let t0 = Math.abs(n1) < 0.9 ? -n2 : 0, t1 = Math.abs(n1) < 0.9 ? 0 : n2, t2 = Math.abs(n1) < 0.9 ? n0 : -n1;
    const tl = Math.hypot(t0, t1, t2); t0 /= tl; t1 /= tl; t2 /= tl;
    const b0 = n1 * t2 - n2 * t1, b1 = n2 * t0 - n0 * t2, b2 = n0 * t1 - n1 * t0;
    const px = P[v * 3] + n0 * cell * 1.3, py = P[v * 3 + 1] + n1 * cell * 1.3, pz = P[v * 3 + 2] + n2 * cell * 1.3;
    let shut = 0;
    for (const [fx, fy, fz] of FAN) {
      const dx = t0 * fx + b0 * fy + n0 * fz, dy = t1 * fx + b1 * fy + n1 * fz, dz = t2 * fx + b2 * fy + n2 * fz;
      for (let s = 1; s <= steps; s++) {
        const d = s * cell;
        if (grid[at(px + dx * d, py + dy * d, pz + dz * d)]) { shut += 1 - (d / reach) * 0.6; break; }
      }
    }
    ao[v] = Math.max(0, 1 - shut / FAN.length);
  }
  return ao;
}
