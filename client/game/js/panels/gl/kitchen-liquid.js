// THE LIQUID IN THE PAN: a small 2-D fluid the Kitchen Stage stirs and mixes
// (docs/proposals/kitchen-stage.md, "Liquids").
//
// A square grid over the pan's floor, masked to its circle, carrying a velocity and a colour per
// cell. Each step advects both semi-Lagrangian, takes out the divergence with a few Jacobi passes
// (so a stir becomes a swirl rather than a pile-up), lets the colour bleed a little and the motion
// die away. A new liquid poured in lands as a blob of its own colour; stirring is a force dragged
// through the grid; `evenness` says how mixed it is. The surface dips in the middle when it spins.
//
// It is picture only. Nothing here reaches the server: the stir that counts is still the `stir`
// command, which the Stage sends when you stir (kitchen-stage.js), and the colour of a cooked
// liquid still moves on the server's beat. Pure and DOM-free, so kitchen-smoke runs it in Node.

const N = 28;
const JACOBI = 12;
const VISC = 1.4;        // how fast motion dies, per second
const BLEED = 0.35;      // colour diffusion, cells² per second

export function createLiquid(R) {
  const n = N * N, mask = new Uint8Array(n);
  const h = (2 * R) / (N - 1);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -R + i * h, y = -R + j * h;
    mask[j * N + i] = x * x + y * y <= R * R ? 1 : 0;
  }
  return {
    N, R, h, mask,
    u: new Float32Array(n), v: new Float32Array(n),
    c: [new Float32Array(n), new Float32Array(n), new Float32Array(n)],
    t0: new Float32Array(n), t1: new Float32Array(n), p: new Float32Array(n), div: new Float32Array(n),
    sources: new Map(),   // id → colour already poured, so a refresh doesn't pour it twice
    filled: false, spin: 0,
    // set by the Stage from the cook beat: `thick` 0..1 as a sauce reduces (slower to move, slower
    // to blend, harder to push), and `cloud` a colour and weight laid over the whole surface, which
    // is what starch does to the water pasta boils in
    thick: 0, cloud: null,
  };
}

const idx = (i, j) => j * N + i;
const toCell = (L, x) => (x + L.R) / L.h;

// Bilinear read of a field at fractional cell coordinates, held to the grid.
function sample(f, x, y) {
  x = Math.max(0, Math.min(N - 1.001, x)); y = Math.max(0, Math.min(N - 1.001, y));
  const i = x | 0, j = y | 0, fx = x - i, fy = y - j, k = idx(i, j);
  return (f[k] * (1 - fx) + f[k + 1] * fx) * (1 - fy) + (f[k + N] * (1 - fx) + f[k + N + 1] * fx) * fy;
}

// Pour a liquid in: the first fills the pan, each later one lands as a blob that has to be mixed.
export function pour(L, id, rgb, at = null) {
  if (L.sources.has(id)) return false;
  L.sources.set(id, rgb);
  if (!L.filled) {
    for (let k = 0; k < N * N; k++) { L.c[0][k] = rgb[0]; L.c[1][k] = rgb[1]; L.c[2][k] = rgb[2]; }
    L.filled = true;
    return true;
  }
  const [px, py] = at || [(Math.random() - 0.5) * L.R, (Math.random() - 0.5) * L.R];
  const ci = toCell(L, px), cj = toCell(L, py), rad = N * 0.22;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const d = Math.hypot(i - ci, j - cj);
    if (d > rad) continue;
    const k = idx(i, j), w = 1 - (d / rad) ** 2;
    for (let ch = 0; ch < 3; ch++) L.c[ch][k] += (rgb[ch] - L.c[ch][k]) * w;
  }
  return true;
}
export function drain(L, id) { L.sources.delete(id); if (!L.sources.size) L.filled = false; }

// Drag a spoon through it: a push along (dx, dy) cm/s, falling off over `rad` cm round (x, y).
export function stirAt(L, x, y, dx, dy, rad = 3.5) {
  const ci = toCell(L, x), cj = toCell(L, y), r = rad / L.h, give = 1 / (1 + 2 * L.thick);
  dx *= give; dy *= give;
  for (let j = Math.max(0, Math.floor(cj - r)); j <= Math.min(N - 1, Math.ceil(cj + r)); j++) {
    for (let i = Math.max(0, Math.floor(ci - r)); i <= Math.min(N - 1, Math.ceil(ci + r)); i++) {
      const k = idx(i, j);
      if (!L.mask[k]) continue;
      const w = Math.exp(-((i - ci) ** 2 + (j - cj) ** 2) / (r * r * 0.5));
      L.u[k] += dx * w; L.v[k] += dy * w;
    }
  }
}

export function step(L, dt) {
  const { u, v, mask, t0, t1, p, div } = L, n = N * N, cells = dt / L.h;
  // advect the velocity by itself
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = idx(i, j);
    if (!mask[k]) { t0[k] = 0; t1[k] = 0; continue; }
    const x = i - u[k] * cells, y = j - v[k] * cells;
    t0[k] = sample(u, x, y); t1[k] = sample(v, x, y);
  }
  const damp = Math.exp(-VISC * (1 + 4 * L.thick) * dt);
  for (let k = 0; k < n; k++) { u[k] = mask[k] ? t0[k] * damp : 0; v[k] = mask[k] ? t1[k] * damp : 0; }
  // take out the divergence, so what's pushed one way comes round the other
  for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
    const k = idx(i, j);
    div[k] = mask[k] ? -0.5 * (u[k + 1] - u[k - 1] + v[k + N] - v[k - N]) : 0;
    p[k] = 0;
  }
  for (let it = 0; it < JACOBI; it++) {
    for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
      const k = idx(i, j);
      if (!mask[k]) continue;
      // a wall cell reads as this cell's own pressure: no flow through the rim
      const pl = mask[k - 1] ? p[k - 1] : p[k], pr = mask[k + 1] ? p[k + 1] : p[k];
      const pd = mask[k - N] ? p[k - N] : p[k], pu = mask[k + N] ? p[k + N] : p[k];
      p[k] = (div[k] + pl + pr + pd + pu) / 4;
    }
  }
  for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
    const k = idx(i, j);
    if (!mask[k]) continue;
    const pl = mask[k - 1] ? p[k - 1] : p[k], pr = mask[k + 1] ? p[k + 1] : p[k];
    const pd = mask[k - N] ? p[k - N] : p[k], pu = mask[k + N] ? p[k + N] : p[k];
    u[k] -= 0.5 * (pr - pl); v[k] -= 0.5 * (pu - pd);
  }
  // carry the colour along, and let it bleed into its neighbours
  if (L.filled) {
    const bleed = Math.min(0.24, BLEED * (1 - 0.7 * L.thick) * dt);
    for (const f of L.c) {
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const k = idx(i, j);
        t0[k] = mask[k] ? sample(f, i - u[k] * cells, j - v[k] * cells) : f[k];
      }
      for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
        const k = idx(i, j);
        if (!mask[k]) { f[k] = t0[k]; continue; }
        const nb = (mask[k - 1] ? t0[k - 1] : t0[k]) + (mask[k + 1] ? t0[k + 1] : t0[k]) + (mask[k - N] ? t0[k - N] : t0[k]) + (mask[k + N] ? t0[k + N] : t0[k]);
        f[k] = t0[k] + bleed * (nb - 4 * t0[k]);
      }
      // just outside the rim takes the colour just inside it, which the drawn edge blends with
      for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
        const k = idx(i, j);
        if (mask[k]) continue;
        let sum = 0, cnt = 0;
        for (const q of [k - 1, k + 1, k - N, k + N]) if (mask[q]) { sum += f[q]; cnt++; }
        if (cnt) f[k] = sum / cnt;
      }
    }
  }
  // how hard it's spinning: what dips the surface
  let s = 0, m = 0;
  for (let k = 0; k < n; k++) if (mask[k]) { s += u[k] * u[k] + v[k] * v[k]; m++; }
  L.spin = m ? Math.sqrt(s / m) : 0;
}

// 1 when the colour is the same everywhere, falling towards 0 as streaks of another colour remain.
export function evenness(L) {
  if (!L.filled || L.sources.size < 2) return 1;
  let m = 0;
  const mean = [0, 0, 0];
  for (let k = 0; k < N * N; k++) if (L.mask[k]) { m++; for (let ch = 0; ch < 3; ch++) mean[ch] += L.c[ch][k]; }
  for (let ch = 0; ch < 3; ch++) mean[ch] /= m;
  let varSum = 0;
  for (let k = 0; k < N * N; k++) if (L.mask[k]) for (let ch = 0; ch < 3; ch++) varSum += (L.c[ch][k] - mean[ch]) ** 2;
  // a spread of about a fifth of full scale per channel reads as not mixed at all
  return Math.max(0, Math.min(1, 1 - Math.sqrt(varSum / (m * 3)) / 0.2));
}

// The velocity at a point in the pan's frame, cm/s, for what floats in it.
export function flowAt(L, x, y) {
  const i = toCell(L, x), j = toCell(L, y);
  return [sample(L.u, i, j), sample(L.v, i, j)];
}

// The surface's height above `z` at a cell: a bowl that deepens with the spin, holding its volume.
function heightAt(L, i, j, depth) {
  const x = -L.R + i * L.h, y = -L.R + j * L.h, r2 = (x * x + y * y) / (L.R * L.R);
  const dip = Math.min(depth * 0.8, L.spin * 0.06);
  return depth + dip * (r2 - 0.5);
}

// The surface as triangles, into a kitchen-mesh batch. `M` is arena-mesh; `P` the pan's pose.
export function drawLiquid(M, b, L, P, depth, gloss = 0.2) {
  if (!L.filled) return;
  const a = 1 - 0.5 * gloss;
  // a corner past the rim is pulled back onto it, so the edge is round rather than stepped
  const pt = (i, j) => {
    let x = -L.R + i * L.h, y = -L.R + j * L.h;
    const r = Math.hypot(x, y);
    if (r > L.R) { x *= L.R / r; y *= L.R / r; }
    return [x, y, heightAt(L, i, j, depth)];
  };
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
    const k = idx(i, j);
    if (!(L.mask[k] || L.mask[k + 1] || L.mask[k + N] || L.mask[k + N + 1])) continue;
    const p00 = pt(i, j), p10 = pt(i + 1, j), p01 = pt(i, j + 1), p11 = pt(i + 1, j + 1);
    const nx = (p00[2] - p10[2]) / L.h, ny = (p00[2] - p01[2]) / L.h, nl = Math.hypot(nx, ny, 1);
    const nrm = P.n([nx / nl, ny / nl, 1 / nl]);
    const col = [
      (L.c[0][k] + L.c[0][k + 1] + L.c[0][k + N] + L.c[0][k + N + 1]) / 4,
      (L.c[1][k] + L.c[1][k + 1] + L.c[1][k + N] + L.c[1][k + N + 1]) / 4,
      (L.c[2][k] + L.c[2][k + 1] + L.c[2][k + N] + L.c[2][k + N + 1]) / 4, a,
    ];
    if (L.cloud) for (let ch = 0; ch < 3; ch++) col[ch] += (L.cloud.rgb[ch] - col[ch]) * L.cloud.k;
    M.tri(b, P.p(p00), P.p(p10), P.p(p11), nrm, nrm, nrm, col);
    M.tri(b, P.p(p00), P.p(p11), P.p(p01), nrm, nrm, nrm, col);
  }
}
