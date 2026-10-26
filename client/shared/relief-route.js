// RELIEF ROUTE: the line a road takes across the carved country, found before the road is built.
//
// A* on the relief's 2-tile cells from one gate to another. The road keeps to the lowest tier,
// the valley floors between the mesas: a step onto raised ground is never taken while any way
// round exists, and the road pays to come near one. Grade costs as its square, crossing a dry wash
// costs a floodway, and the sea and every other region are closed.
//
// One router for the two readers. The game builds its highways along this (plugins/trucking/
// corridor.js, over the shipped field through `reliefGrid` in wildlands.js) and the preview page
// draws it (scripts/content/relief-core.mjs, over a bake it has just run). See
// docs/proposals/wildlands-relief.md.
//
// A grid G is { cw, ch, cell, x0, y0, h, tier, flow, closed, high } on the cells:
//   h      height, tier units          tier   the cell's tier (0 is the valley floor)
//   flow   drainage area               closed 1 for the sea and placed regions
//   high   distance in tiles to the nearest raised (tier ≥ 1) cell
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const NB_D = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

function heap(n, key) {
  const a = new Int32Array(n); let size = 0;
  const up = (i) => { const v = a[i], k = key[v]; while (i > 0) { const p = (i - 1) >> 1; if (key[a[p]] <= k) break; a[i] = a[p]; i = p; } a[i] = v; };
  const down = (i) => {
    const v = a[i], k = key[v];
    for (;;) {
      let c = 2 * i + 1; if (c >= size) break;
      if (c + 1 < size && key[a[c + 1]] < key[a[c]]) c++;
      if (key[a[c]] >= k) break;
      a[i] = a[c]; i = c;
    }
    a[i] = v;
  };
  return { push(v) { a[size] = v; up(size++); }, pop() { const v = a[0]; a[0] = a[--size]; if (size > 0) down(0); return v; }, get size() { return size; } };
}

// Two-pass chamfer distance in tiles from every cell `seed` marks.
export function chamferCells(cw, ch, cell, seed) {
  const N = cw * ch, d = new Float32Array(N).fill(1e9), D = cell, DD = cell * Math.SQRT2;
  for (let i = 0; i < N; i++) if (seed(i)) d[i] = 0;
  const rl = (i, j, c) => { const v = d[j] + c; if (v < d[i]) d[i] = v; };
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const i = y * cw + x;
    if (y > 0) { rl(i, i - cw, D); if (x > 0) rl(i, i - cw - 1, DD); if (x < cw - 1) rl(i, i - cw + 1, DD); }
    if (x > 0) rl(i, i - 1, D);
  }
  for (let y = ch - 1; y >= 0; y--) for (let x = cw - 1; x >= 0; x--) {
    const i = y * cw + x;
    if (y < ch - 1) { rl(i, i + cw, D); if (x < cw - 1) rl(i, i + cw + 1, DD); if (x > 0) rl(i, i + cw - 1, DD); }
    if (x < cw - 1) rl(i, i + 1, D);
  }
  return d;
}

export const ROUTE_DEFAULTS = { grade: 150, tier: 400, wash: 6, endRadius: 8, clear: 3, clearSoft: 14, near: 6 };

// The path from a to b (world tiles), as a smoothed polyline, or null if there is none. `c` is the
// `roads` block of wildlands.json `relief`. The result carries `stepped` (it had to change tier,
// which is a cutting) and `squeezed` (it had to come closer to raised ground than `clear`).
export function routeOnGrid(G, a, b, c = {}) {
  const o = { ...ROUTE_DEFAULTS, ...c };
  const hard = routeOnce(G, a, b, o, true);
  if (hard) return hard;
  const p = routeOnce(G, a, b, o, false);
  if (p) p.squeezed = true;
  return p;
}

function routeOnce(G, a, b, o, clearHard) {
  const { cw, ch, cell, h, tier, flow, closed, high } = G;
  const toCell = (p) => clamp(Math.round((p[1] - G.y0) / cell), 0, ch - 1) * cw + clamp(Math.round((p[0] - G.x0) / cell), 0, cw - 1);
  const s = toCell(a), g = toCell(b), gx = g % cw, gy = (g / cw) | 0, sx = s % cw, sy = (s / cw) | 0;
  const N = cw * ch, Gs = new Float32Array(N).fill(Infinity), P = new Int32Array(N).fill(-1), fk = new Float32Array(N), done = new Uint8Array(N);
  const open = heap(N, fk);
  Gs[s] = 0; fk[s] = 0; open.push(s);
  // Near either gate the road is still in its own region's mouth, where the rules do not bite.
  const nearEnd = (i) => { const x = i % cw, y = (i / cw) | 0; return Math.hypot(x - sx, y - sy) * cell <= o.endRadius || Math.hypot(x - gx, y - gy) * cell <= o.endRadius; };
  while (open.size) {
    const c = open.pop();
    if (done[c]) continue;
    done[c] = 1;
    if (c === g) break;
    const x = c % cw, y = (c / cw) | 0;
    for (let k = 0; k < 8; k++) {
      const nx = x + NB[k][0], ny = y + NB[k][1];
      if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
      const n = ny * cw + nx;
      if (done[n]) continue;
      const end = nearEnd(n);
      if (closed[n] && !end) continue;
      if (clearHard && !end && high[n] < o.clear) continue;
      const d = NB_D[k] * cell, grade = Math.abs(h[n] - h[c]) / d;
      let cost = d * (1 + o.grade * grade * grade);
      if (tier[n] !== tier[c]) cost += o.tier;
      if (!end && high[n] < o.clearSoft) cost += d * o.near * (o.clearSoft - high[n]) / o.clearSoft;
      if (flow[n] >= (o.washFlow ?? 900) && flow[c] < (o.washFlow ?? 900)) cost += o.wash;
      const ng = Gs[c] + cost;
      if (ng < Gs[n]) { Gs[n] = ng; P[n] = c; fk[n] = ng + Math.hypot(nx - gx, ny - gy) * cell; open.push(n); }
    }
  }
  if (!Number.isFinite(Gs[g])) return null;
  const cells = [];
  for (let c = g; c !== -1; c = P[c]) cells.push(c);
  cells.reverse();
  let stepped = false;
  for (let i = 1; i < cells.length; i++) if (tier[cells[i]] !== tier[cells[i - 1]] && !nearEnd(cells[i])) { stepped = true; break; }
  const pts = cells.map((c) => [G.x0 + (c % cw) * cell, G.y0 + ((c / cw) | 0) * cell]);
  pts[0] = [a[0], a[1]]; pts[pts.length - 1] = [b[0], b[1]];
  const out = chaikin(pts, 3);
  out.stepped = stepped;
  return out;
}

// Corner-cutting, ends fixed.
function chaikin(pts, passes) {
  let p = pts;
  for (let k = 0; k < passes; k++) {
    const q = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, ay] = p[i], [bx, by] = p[i + 1];
      q.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}

// Arc length along a polyline, and the point at a given arc length.
export function polyLength(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; }
export function cumLengths(pts) { const c = [0]; for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return c; }
export function pointAtLength(pts, cum, d) {
  if (d <= 0) return pts[0];
  if (d >= cum[cum.length - 1]) return pts[pts.length - 1];
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= d) lo = m; else hi = m; }
  const t = (d - cum[lo]) / ((cum[hi] - cum[lo]) || 1);
  return [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * t, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * t];
}
// The arc length of the point on the polyline nearest (x, y), searched forward from `from` only:
// a road never goes back along its own route.
export function progressOn(pts, cum, x, y, from = 0, window = 120) {
  let best = from, bd = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    if (cum[i + 1] < from || cum[i] > from + window) continue;
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
    const t = clamp(((x - ax) * dx + (y - ay) * dy) / L2, 0, 1);
    const px = ax + dx * t, py = ay + dy * t, d = (px - x) ** 2 + (py - y) ** 2;
    if (d < bd) { bd = d; best = cum[i] + Math.sqrt(L2) * t; }
  }
  return Math.max(from, best);
}
