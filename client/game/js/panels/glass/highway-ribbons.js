// THE VOID HIGHWAY AS ONE RIBBON OF TARMAC.
//
// The corridor reaches the client as cells, and drawn cell by cell a bend is a staircase of
// squares, each laying its own stripes at its own angle; where two roads meet, two sets of stripes
// cross. The server also ships each road's centreline near the viewer (plugins/trucking/roadnet.js
// nearRibbons), and this turns that into ground quads: one continuous shoulder, carriageway, wear
// and paint per road, laid along the curve. windshield.js (drawHighwayRibbons) moves them into the
// map window's frame, fades them with distance and pushes them into the ground mesh, and skips the
// corridor cells a ribbon covers.
//
// Pure: no DOM, no renderer state, world tiles in and world tiles out.
//
// ── WHAT A ROAD LOOKS LIKE HERE ──
// Old tarmac nobody has resurfaced, in three states off the condition the server ships (0 good,
// 1 broken), drifting slowly along the road so a stretch holds for tens of tiles:
//   good:   grey tarmac, the paint still reads, the odd patch and crack.
//   worn:   browner, tar patches, cracks along the wheel tracks, paint faded and broken, sand in
//           from the edges.
//   broken: pale and broken up, slabs gone to gravel, potholes in the wheel tracks, heavy drift,
//           only scraps of paint.
//
// ── WHERE TWO ROADS MEET ──
// A road that leaves or joins another starts or ends ON it (the server carries every run one
// vertex into the road it shares). So the two carriageways overlap for a stretch, and the paint
// has to say which road is which, the way a real exit does:
//   • an edge line is not painted where it lies on another road's tarmac;
//   • the lesser road (lower `pri`, then higher `id`) paints no centre or lane lines while its
//     tarmac overlaps the greater one's.
// The greater road's markings run straight through, the lesser road's outer edge line runs on, and
// its inner edge line starts where the two carriageways come apart: a gore, with nothing extra.
//
// Every surface goes into the PAINT range of the ground mesh (gl/ground.js), so the order of the
// list is the order things land: all shoulders, then all carriageways, then all wear in the
// surface, then all paint, then the sand on top. One road's shoulder can never cover another
// road's tarmac, and coplanar surfaces never fight over depth.

const fract = (v) => v - Math.floor(v);
const hash = (x, y) => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);
function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
const lerp = (a, b, t) => a + (b - a) * t;
const mix3 = (p, q, t) => [lerp(p[0], q[0], t), lerp(p[1], q[1], t), lerp(p[2], q[2], t)];

// Colours. The tarmac ones are sun-bleached: browner and paler than the city's fresh #2b2f36.
const TAR_GOOD = [64, 64, 62], TAR_WORN = [68, 63, 55], TAR_BROKEN = [80, 73, 61];
const DIRT = [116, 98, 68], DIRT_PALE = [130, 112, 80];
const PAINT_W = [226, 224, 214], PAINT_Y = [218, 178, 74];
const PATCH = [30, 30, 32], CRACK = [24, 23, 22], GRAVEL = [106, 96, 78], HOLE = [16, 15, 15];
const SAND = [146, 122, 82];

// Shoulder widths. `sh` comes off the payload (SHOULDER_W); FADE is how far its outer edge feathers
// into the ground, so the floor's tile squares under it never show as a staircase.
const FADE = 0.35;
const tarOf = (c) => (c < 0.55 ? mix3(TAR_GOOD, TAR_WORN, c / 0.55) : mix3(TAR_WORN, TAR_BROKEN, (c - 0.55) / 0.45));
// How much of the paint is left, and how often a whole tile of it is gone.
// The road seen from past the map window, where the floor shader paints it as one band of one
// colour (gl/floor.js farRoad): the carriageway and the shoulder mixed by their share of the width.
export const RIBBON_FAR_RGB = mix3(tarOf(0.3), DIRT, 1.2 / (0.95 + 1.2)).map(Math.round);
const paintAlpha = (c) => (c < 0.35 ? 0.82 : c < 0.78 ? 0.82 - (c - 0.35) * 1.0 : 0.22);
const paintGone = (c) => (c < 0.35 ? 0.03 : c < 0.78 ? 0.12 + (c - 0.35) * 0.4 : 0.7);

function prep(raw) {
  const p = raw.p, n = Math.floor(p.length / 5);
  const r = { id: raw.id | 0, pri: raw.pri | 0, dirt: !!raw.dirt, n,
    X: new Float64Array(n), Y: new Float64Array(n), W: new Float64Array(n), C: new Float64Array(n), L: new Int8Array(n),
    A: new Float64Array(n), NX: new Float64Array(n), NY: new Float64Array(n), x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (let i = 0; i < n; i++) {
    r.X[i] = p[i * 5]; r.Y[i] = p[i * 5 + 1]; r.W[i] = p[i * 5 + 2]; r.C[i] = p[i * 5 + 3]; r.L[i] = p[i * 5 + 4];
    r.A[i] = i ? r.A[i - 1] + Math.hypot(r.X[i] - r.X[i - 1], r.Y[i] - r.Y[i - 1]) : (raw.a0 || 0);
    r.x0 = Math.min(r.x0, r.X[i]); r.y0 = Math.min(r.y0, r.Y[i]); r.x1 = Math.max(r.x1, r.X[i]); r.y1 = Math.max(r.y1, r.Y[i]);
  }
  // The normal at a vertex is off the mean of the two segments either side of it, so the two
  // quads that share it share an edge: a bend is joined, never two strips laid over each other.
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    const tx = r.X[b] - r.X[a], ty = r.Y[b] - r.Y[a], L = Math.hypot(tx, ty) || 1;
    r.NX[i] = ty / L; r.NY[i] = -tx / L;
  }
  return r;
}

// The ribbon's frame at distance `a` along it: centre, normal, width, condition, lanes.
function frameAt(r, a) {
  const A = r.A;
  let i = 0, j = r.n - 1;
  if (a <= A[0]) j = 1; else if (a >= A[r.n - 1]) i = r.n - 2;
  else { while (j - i > 1) { const m = (i + j) >> 1; if (A[m] <= a) i = m; else j = m; } }
  j = i + 1;
  const t = Math.max(0, Math.min(1, (a - A[i]) / ((A[j] - A[i]) || 1)));
  let nx = lerp(r.NX[i], r.NX[j], t), ny = lerp(r.NY[i], r.NY[j], t);
  const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
  return { x: lerp(r.X[i], r.X[j], t), y: lerp(r.Y[i], r.Y[j], t), nx, ny,
    w: lerp(r.W[i], r.W[j], t), c: lerp(r.C[i], r.C[j], t), lanes: Math.min(r.L[i], r.L[j]) };
}

// The first vertex strictly past distance a along the ribbon.
function firstAfter(r, a) {
  let lo = 0, hi = r.n;
  while (lo < hi) { const m = (lo + hi) >> 1; if (r.A[m] <= a) lo = m + 1; else hi = m; }
  return lo;
}

// Distance from a point to a ribbon's centreline, and its half-width there. Null when the point
// is clear of its bounding box, which is almost always.
function nearest(r, x, y, pad = 4) {
  if (x < r.x0 - pad || x > r.x1 + pad || y < r.y0 - pad || y > r.y1 + pad) return null;
  let best = Infinity, bw = 0, bt = 0, bi = 0;
  for (let i = 0; i + 1 < r.n; i++) {
    const ax = r.X[i], ay = r.Y[i], ex = r.X[i + 1], ey = r.Y[i + 1];
    // A segment whose box is further off than the best so far cannot beat it.
    if (x < Math.min(ax, ex) - best || x > Math.max(ax, ex) + best || y < Math.min(ay, ey) - best || y > Math.max(ay, ey) + best) continue;
    const bx = ex - ax, by = ey - ay, l2 = bx * bx + by * by;
    const tr = l2 < 1e-9 ? 0 : ((x - ax) * bx + (y - ay) * by) / l2, t = Math.max(0, Math.min(1, tr));
    const d = Math.hypot(x - (ax + bx * t), y - (ay + by * t));
    if (d < best) { best = d; bw = lerp(r.W[i], r.W[i + 1], t); bt = tr; bi = i; }
  }
  // How far past either END of the run the point is (0 inside), so a cap is not treated as
  // extending the road.
  const L0 = Math.hypot(r.X[1] - r.X[0], r.Y[1] - r.Y[0]) || 1;
  const Ln = Math.hypot(r.X[r.n - 1] - r.X[r.n - 2], r.Y[r.n - 1] - r.Y[r.n - 2]) || 1;
  const past = bi === 0 && bt < 0 ? -bt * L0 : bi === r.n - 2 && bt > 1 ? (bt - 1) * Ln : 0;
  return { d: best, w: bw, past };
}

export function buildRibbons(near) {
  const rs = (near && near.r || []).map(prep).filter((r) => r.n >= 2);
  // Lesser roads first, in every pass: where two overlap, the greater one's tarmac and paint land on top.
  rs.sort((p, q) => p.pri - q.pri || q.id - p.id);
  const SH = near && near.sh > 0 ? near.sh : 1.2;
  const recs = [];
  // Is a world point on another ribbon's carriageway?
  const onTar = (self, x, y) => {
    for (const o of rs) {
      if (o === self) continue;
      const q = nearest(o, x, y, 2);
      if (q && q.past < 0.05 && q.d < q.w - 0.03) return true;
    }
    return false;
  };
  // Does a greater road's carriageway overlap this one here?
  const yields = (self, f) => {
    for (const o of rs) {
      if (o === self || o.pri < self.pri || (o.pri === self.pri && o.id > self.id)) continue;
      const q = nearest(o, f.x, f.y, 4);
      if (q && q.past < 0.05 && q.d < f.w + q.w) return true;
    }
    return false;
  };

  // Does a greater road's carriageway cover this one entirely here? Then nothing of this one is
  // drawn: not its surface, its wear or its sand.
  const buriedAt = (self, x, y, w) => {
    for (const o of rs) {
      if (o === self || o.pri < self.pri || (o.pri === self.pri && o.id > self.id)) continue;
      const q = nearest(o, x, y, 3);
      if (q && q.past < 0.05 && q.d + w <= q.w + 0.05) return true;
    }
    return false;
  };
  for (const r of rs) r.vis = Array.from({ length: r.n }, (_, i) => (buriedAt(r, r.X[i], r.Y[i], r.W[i]) ? 0 : 1));

  // A band down the whole ribbon between two lateral offsets, each a function of the vertex. One
  // quad per segment, sharing edges.
  const band = (r, oLo, oHi, rgbAt, aLo, aHi, road = 0) => {
    for (let i = 0; i + 1 < r.n; i++) {
      const j = i + 1;
      const lo0 = oLo(i), hi0 = oHi(i), lo1 = oLo(j), hi1 = oHi(j);
      const P = (k, o) => [r.X[k] + r.NX[k] * o, r.Y[k] + r.NY[k] * o];
      const ci = rgbAt(i), cj = rgbAt(j);
      recs.push({ w: [P(i, lo0), P(j, lo1), P(j, hi1), P(i, hi0)], rgbs: [ci, cj, cj, ci],
        as: [aLo(i), aLo(j), aHi(j), aHi(i)], road,
        lat: road ? [lo0, lo1, hi1, hi0] : null, kerb: road ? 0.59 * r.W[i] : 0 });
    }
  };
  // A stripe from a0 to a1 along the ribbon at lateral `off` with half-width `hw`, bending with it.
  // `off` and `hw` are in TILES, or with `rel` set, in half-widths (0.5 = the edge). With `soft`
  // it fades in and out along its length instead of starting and stopping on a hard line.
  const stripe = (r, a0, a1, off, hw, rgb, alpha, road = 0, rel = false, soft = false) => {
    if (a1 <= a0) return;
    const pts = [a0];
    if (soft) pts.push(a0 + (a1 - a0) * 0.35, a0 + (a1 - a0) * 0.65);
    for (let i = firstAfter(r, a0); i < r.n && r.A[i] < a1; i++) pts.push(r.A[i]);
    pts.push(a1);
    if (soft) pts.sort((p, q) => p - q);
    const al = (a) => (soft ? alpha * Math.min(1, Math.min(a - a0, a1 - a) / ((a1 - a0) * 0.35)) : alpha);
    for (let k = 0; k + 1 < pts.length; k++) {
      const f0 = frameAt(r, pts[k]), f1 = frameAt(r, pts[k + 1]);
      const o0 = rel ? off * 2 * f0.w : off, o1 = rel ? off * 2 * f1.w : off;
      const h0 = rel ? hw * 2 * f0.w : hw, h1 = rel ? hw * 2 * f1.w : hw;
      const P = (f, o) => [f.x + f.nx * o, f.y + f.ny * o];
      recs.push({ w: [P(f0, o0 - h0), P(f1, o1 - h1), P(f1, o1 + h1), P(f0, o0 + h0)], rgbs: [rgb, rgb, rgb, rgb],
        as: [al(pts[k]), al(pts[k + 1]), al(pts[k + 1]), al(pts[k])], road, lat: null, kerb: 0 });
    }
  };
  // Per-tile dice, keyed to the road and to how far along it the tile is: a patch is a place on
  // the road, not a place on the screen, and does not move when the window does.
  const dice = (r, k) => (j) => hash(r.id * 0.0173 + k * 1.31, j * 7.77 + 0.5);
  // Each tile's frame, and whether a greater road buries it, worked out once: three passes walk the
  // tiles, and asking the other roads three times was most of the cost of a rebuild.
  for (const r of rs) {
    r.T = [];
    for (let k = Math.ceil(r.A[0]); k + 1 <= r.A[r.n - 1]; k++) {
      const f = frameAt(r, k + 0.5);
      if (!buriedAt(r, f.x, f.y, f.w)) r.T.push([k, f]);
    }
  }
  const tiles = (r, fn) => { for (const [k, f] of r.T) fn(k, dice(r, k), f); };

  // ── 1. THE SHOULDERS ── graded dirt either side, feathered into the ground at its outer edge.
  for (const r of rs) {
    const dirtAt = (i) => { const m = 0.9 + 0.2 * vnoise(r.X[i] * 0.4, r.Y[i] * 0.4); return mix3(DIRT, DIRT_PALE, Math.min(1, r.C[i])).map((v) => v * m); };
    const one = () => 1, zero = () => 0;
    for (const s of [-1, 1]) {
      const inner = (i) => s * r.W[i], solid = (i) => s * (r.W[i] + SH - FADE), outer = (i) => s * (r.W[i] + SH + FADE * 0.6);
      if (s < 0) { band(r, solid, inner, dirtAt, one, one); band(r, outer, solid, dirtAt, zero, one); }
      else { band(r, inner, solid, dirtAt, one, one); band(r, solid, outer, dirtAt, one, zero); }
    }
  }
  // ── 2. THE CARRIAGEWAYS ──
  // ⚠ A LESSER ROAD IS NOT DRAWN WHERE IT LIES WHOLLY ON A GREATER ONE. A branch starts on the trunk
  // it leaves, and its own tarmac there is a shade off the trunk's (the condition and the type
  // differ), which drew the stretch they share as a rectangle laid across the trunk. It fades in
  // as it comes off.
  for (const r of rs) {
    const colAt = (i) => {
      const m = 0.93 + 0.14 * vnoise(r.X[i] * 0.3 + 17, r.Y[i] * 0.3);
      return (r.dirt ? mix3(DIRT, DIRT_PALE, 0.3) : tarOf(r.C[i])).map((v) => v * m);
    };
    band(r, (i) => -r.W[i], (i) => r.W[i], colAt, (i) => r.vis[i], (i) => r.vis[i], 1);
  }
  // ── 3. WEAR IN THE SURFACE ── patches and cracks; on a broken road, gravel and potholes.
  for (const r of rs) {
    if (r.dirt) {
      // A dirt highway: no tar to fail, but every lane wears its own pair of ruts.
      tiles(r, (k, h, f) => {
        const lanes = Math.max(1, f.lanes);
        for (let i = 0; i < lanes; i++) {
          const cl = -0.5 + (i + 0.5) / lanes;
          for (const s of [-1, 1]) stripe(r, k, k + 1, cl + s * 0.11 / lanes, 0.012, CRACK, 0.32, 0, true);
        }
      });
      continue;
    }
    tiles(r, (k, h, f) => {
      const c = f.c, worn = c >= 0.35, broken = c > 0.78;
      if (h(1) < (broken ? 0.35 : worn ? 0.3 : 0.07)) {
        const a0 = k + h(2) * 0.6;
        stripe(r, a0, a0 + 0.3 + h(3) * 0.6, (h(4) - 0.5) * 0.7, 0.05 + h(5) * 0.1, PATCH, 0.45, 1, true);
      }
      for (let q = 0; q < 2; q++) {
        if (h(10 + q) > (broken ? 0.6 : worn ? 0.5 : 0.14)) continue;
        const a0 = k + h(12 + q) * 0.5;
        stripe(r, a0, a0 + 0.6 + h(14 + q) * 0.9, (h(16 + q) - 0.5) * 0.8, 0.005, CRACK, 0.55, 1, true);
      }
      if (worn && h(20) < (broken ? 0.25 : 0.1)) {
        const a0 = k + h(21);
        stripe(r, a0, a0 + 0.02, 0, 0.5, CRACK, 0.5, 1, true);   // a crack straight across
      }
      if (broken) {
        // A slab gone to gravel is three overlapping pieces of different widths, so it has a ragged
        // edge rather than reading as a rectangle somebody painted.
        for (let q = 0; q < 2; q++) {
          if (h(30 + q) > 0.5) continue;
          const a0 = k + h(32 + q) * 0.7, len = 0.25 + h(34 + q) * 0.45, off = (h(36 + q) - 0.5) * 0.7, hw = 0.05 + h(38 + q) * 0.1;
          for (let z = 0; z < 3; z++) {
            const j = hash(r.id + k * 3.1 + q, z * 5.3);
            stripe(r, a0 + len * z * 0.28, a0 + len * (0.45 + z * 0.28), off + (j - 0.5) * hw, hw * (0.55 + j * 0.6), GRAVEL, 0.55, 1, true);
          }
        }
        // Potholes sit in the wheel tracks, where the load goes.
        const lanes = Math.max(1, f.lanes);
        for (let q = 0; q < 3; q++) {
          if (h(40 + q) > 0.45) continue;
          const lane = Math.floor(h(43 + q) * lanes), cl = -0.5 + (lane + 0.5) / lanes;
          const off = cl + (h(46 + q) < 0.5 ? -1 : 1) * 0.12 / lanes;
          const a0 = k + h(49 + q) * 0.9;
          stripe(r, a0, a0 + 0.05 + h(52 + q) * 0.06, off, 0.012 + h(55 + q) * 0.012, HOLE, 0.85, 1, true);
        }
      }
    });
  }
  // ── 4. THE PAINT ──
  for (const r of rs) {
    if (r.dirt) continue;
    tiles(r, (k, h, f) => {
      const al = paintAlpha(f.c), gone = paintGone(f.c);
      // Edge lines, one each side, each left off where it lies on another road's tarmac.
      for (const s of [-1, 1]) {
        if (h(60 + s) < gone) continue;
        const o = s * (f.w - 0.07);
        if (onTar(r, f.x + f.nx * o, f.y + f.ny * o)) continue;
        stripe(r, k, k + 1, o, 0.026, PAINT_W, al);
      }
      if (yields(r, f)) return;
      const lanes = f.lanes;
      // The centre: a double yellow down a road with traffic both ways and room for it, a dashed
      // one down a two-lane road, nothing down a one-lane slip road.
      if (lanes >= 4) {
        for (const s of [-1, 1]) if (h(70 + s) >= gone) stripe(r, k, k + 1, s * 0.05, 0.02, PAINT_Y, al);
      } else if (lanes >= 2 && h(70) >= gone) {
        stripe(r, k + 0.1, k + 0.55, 0, 0.022, PAINT_Y, al);
      }
      // Lane lines, dashed, between the lanes on each side of the centre.
      if (lanes >= 4) {
        const per = lanes / 2;
        for (let i = 1; i < per; i++) for (const s of [-1, 1]) {
          if ((k & 1) || h(80 + i * 3 + s) < gone) continue;
          stripe(r, k + 0.2, k + 0.85, s * (i / per) * f.w, 0.02, PAINT_W, al * 0.9);
        }
      }
    });
  }
  // ── 5. SAND ON TOP ── blown in off the verge, heaviest at the edges, and now and then right across.
  for (const r of rs) {
    const heavy = (i) => (r.C[i] < 0.35 ? 0.5 : r.C[i] > 0.78 ? 1.8 : 1);
    const ws = (i, s) => (0.05 + 0.13 * vnoise(r.X[i] * 0.45 + s * 9, r.Y[i] * 0.45)) * heavy(i);
    const sa = (i) => Math.min(0.6, 0.3 * heavy(i)) * r.vis[i];
    const col = () => SAND, zero = () => 0;
    band(r, (i) => -r.W[i], (i) => -r.W[i] + ws(i, -1), col, sa, zero);
    band(r, (i) => r.W[i] - ws(i, 1), (i) => r.W[i], col, zero, sa);
    tiles(r, (k, h, f) => {
      if (h(90) > (f.c > 0.78 ? 0.2 : f.c >= 0.35 ? 0.07 : 0.015)) return;
      const a0 = k + h(91) * 0.6;
      // Two layers, the narrower one denser, so the drift has a body and a thin edge.
      const a1 = a0 + 0.5 + h(92) * 0.6, off = (h(93) - 0.5) * 0.3, al = 0.16 + h(94) * 0.1;
      stripe(r, a0, a1, off, 0.45, SAND, al, 0, true, true);
      stripe(r, a0 + (a1 - a0) * 0.2, a1 - (a1 - a0) * 0.25, off + (h(95) - 0.5) * 0.2, 0.25, SAND, al, 0, true, true);
    });
  }

  // Does a ribbon cover the tile centred here? A corridor cell that answers yes is not drawn as a
  // tile. Memoised per tile, because the answer only changes when the roads do.
  const memo = new Map();
  const covers = (x, y) => {
    const key = x * 100003 + y;
    let v = memo.get(key);
    if (v !== undefined) return v;
    v = false;
    for (const r of rs) {
      const q = nearest(r, x, y, SH + 2);
      if (q && q.past < 0.4 && q.d <= q.w + SH + 0.6) { v = true; break; }
    }
    memo.set(key, v);
    return v;
  };
  return { recs, covers, n: rs.length };
}
