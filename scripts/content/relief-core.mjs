// RELIEF: the carved country between the regions, worked out at bake time.
//
// One height field for the wildlands, carved by simulated water rather than thresholded noise, so
// canyons branch the way drainages do and a cliff is where a hard bed outcrops. See
// docs/proposals/wildlands-relief.md. scripts/content/bake-wildlands.mjs runs it into the shipped
// field, and the preview page (tools/worldmap/relief.html) runs it live. Per-tile reading is in
// client/shared/relief-rules.js, which both share.
//
// Pure ESM with no Node imports, so the bake and the browser run the same code. The numbers are
// content (`relief` in content/map/wildlands.json); nothing here names a region or a place.
//
// Units: tiles across, and height in TIER units, where 1 is about one cliff band. `zScale` in the
// config turns that into world z when something renders it.
import { hnoise2, fbm2 } from '../../client/shared/landform.js';
import { wildlandsAt, landformHeight } from '../../client/shared/wildlands.js';
import { cellSampler, dipAt, tierOfH, reliefTileAt, surfaceH, RELIEF_BIOMES } from '../../client/shared/relief-rules.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sstep = (e0, e1, v) => { const u = clamp((v - e0) / (e1 - e0), 0, 1); return u * u * (3 - 2 * u); };
const mix = (a, b, t) => a + (b - a) * t;

const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const NB_D = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

// A min-heap of cell indices keyed on a Float32Array, for the priority flood.
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
  return {
    push(v) { a[size] = v; up(size++); },
    pop() { const v = a[0]; a[0] = a[--size]; if (size > 0) down(0); return v; },
    get size() { return size; },
  };
}

// Two-pass chamfer distance on the cell grid from the seed cells, in tiles.
function chamfer(cw, ch, seed, cell) {
  const N = cw * ch, d = new Float32Array(N).fill(1e9);
  for (let i = 0; i < N; i++) if (seed[i]) d[i] = 0;
  const D = cell, DD = cell * Math.SQRT2;
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

// The hardness of the bed at height `hb` for a fully layered cell. Beds are listed bottom up, each
// running to its `top`; anything above the last is the last.
function bedHard(strata, hb) {
  for (const s of strata) if (hb < s.top) return s.hard;
  return strata.length ? strata[strata.length - 1].hard : 1;
}

// ── THE BAKE ─────────────────────────────────────────────────────────────────
//
// rect: { x0, y0, x1, y1 } in tiles. tiles: [{ x, y, r (region id), w (water) }], every placed
// map_world tile. cfg: the `relief` block of wildlands.json. Returns the cell planes.
//
// `wild` is { wildlandsAt, landformHeight } for the field being baked (see createWildlands); the
// preview leaves it out and reads the shipped field.
export function bakeRelief({ rect, tiles, cfg, onProgress, wild = {} }) {
  const wAt = wild.wildlandsAt || wildlandsAt, lfH = wild.landformHeight || landformHeight;
  const cell = cfg.cell || 2;
  const cw = Math.floor((rect.x1 - rect.x0) / cell) + 1, ch = Math.floor((rect.y1 - rect.y0) / cell) + 1;
  const N = cw * ch;
  const cx = (i) => rect.x0 + (i % cw) * cell, cy = (i) => rect.y0 + ((i / cw) | 0) * cell;

  // What each cell is: 0 free country, 1 sea, 2 placed region. A cell is placed if any tile in its
  // block is, so a region's rim never shows a cell of carved country inside it.
  const kind = new Uint8Array(N), regionIx = new Int8Array(N).fill(-1);
  const regionIds = [...new Set(tiles.map((t) => t.r).filter(Boolean))].sort();
  for (const t of tiles) {
    const i = Math.round((t.y - rect.y0) / cell) * cw + Math.round((t.x - rect.x0) / cell);
    if (i < 0 || i >= N) continue;
    kind[i] = t.w ? (kind[i] === 2 ? 2 : 1) : 2;
    if (t.r && !t.w) regionIx[i] = regionIds.indexOf(t.r);
  }
  for (let i = 0; i < N; i++) if (kind[i] === 0 && wAt(cx(i), cy(i)).sea) kind[i] = 1;

  const distSea = chamfer(cw, ch, kind.map((k) => (k === 1 ? 1 : 0)), cell);
  const distLand = chamfer(cw, ch, kind.map((k) => (k === 2 ? 1 : 0)), cell);
  const distRegion = Object.fromEntries(regionIds.map((r, ri) => [r, chamfer(cw, ch, regionIx.map((v) => (v === ri ? 1 : 0)), cell)]));

  // ── provinces: what each part of the country is made of ──
  const rocks = cfg.rocks || {};
  const bg = cfg.background || { uplift: 0.5, rock: 'layered', moisture: 0.3 };
  const U = new Float32Array(N), L = new Float32Array(N), HC = new Float32Array(N), M = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const x = cx(i), y = cy(i);
    const nz = (hnoise2(x * 0.03 + 1.7, y * 0.03 - 4.2) - 0.5) * 40;
    let sw = 0, u = 0, l = 0, hc = 0, m = 0;
    for (const p of cfg.provinces || []) {
      const d = distRegion[p.near]; if (!d) continue;
      const w = sstep(p.reach, p.reach * 0.35, d[i] + nz);
      if (w <= 0) continue;
      const rk = rocks[p.rock] || {};
      sw += w; u += w * p.uplift; l += w * (rk.layered ?? 1); hc += w * (rk.hard ?? 1); m += w * (p.moisture ?? 0.3);
    }
    const bw = Math.max(0, 1 - sw), rb = rocks[bg.rock] || {};
    const tot = sw + bw || 1;
    U[i] = (u + bw * bg.uplift) / tot;
    L[i] = (l + bw * (rb.layered ?? 1)) / tot;
    HC[i] = (hc + bw * (rb.hard ?? 1)) / tot;
    // The coast is wetter whatever the province says.
    M[i] = clamp((m + bw * (bg.moisture ?? 0.3)) / tot + sstep(cfg.coastWet ?? 60, 0, distSea[i]) * 0.35, 0, 1);
  }

  // ── the starting surface: uplift, eased to nothing at a region rim and at the shore ──
  const sh = cfg.shape || {};
  const h = new Float32Array(N);
  // ⚠ A LANDFORM IS LOCKED. Mount Cinder's cone is authored (wildlands.json `landforms`), and the
  // volcano has to stay the mountain it was: its cone, its crater and its plume. Erosion would cut
  // gullies down it and the pit fill would turn the crater into a flat lake, so a locked cell keeps
  // its height. Rain on it still runs off and carves the country round its foot.
  const lock = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (kind[i] !== 0) { h[i] = 0; continue; }
    const x = cx(i), y = cy(i);
    // ⚠ THE RISE FROM A RIM IS WARPED, AND THE ROCK BY A RIM IS SOFT. An even ramp up from every
    // region is a bowl, and the terraces turn a bowl into rings of cliff round the town. So the
    // band's width wanders, and layered rock only starts `rimFlat` tiles out, which leaves the
    // cliffs to the carving and the broad hills.
    const rw = (hnoise2(x * 0.035 + 6.6, y * 0.035 - 1.9) - 0.5) * (sh.rimWarp ?? 18);
    const rim = sstep(0, sh.rimRise ?? 24, distLand[i] + rw) * sstep(0, 3, distLand[i]) * sstep(0, sh.coastRise ?? 40, distSea[i]);
    L[i] *= sstep(sh.rimFlat ?? 12, (sh.rimFlat ?? 12) * 2.5, distLand[i] + rw);
    const broad = 1 + fbm2(x * (sh.broadF ?? 0.012) + 5.3, y * (sh.broadF ?? 0.012) - 2.1, 3, 0.5) * (sh.broadAmp ?? 0.9);
    const fine = fbm2(x * (sh.fineF ?? 0.06) - 3.7, y * (sh.fineF ?? 0.06) + 8.8, 3, 0.5) * (sh.fineAmp ?? 0.25);
    h[i] = Math.max(0, (U[i] * (sh.height ?? 3.2) * broad + fine) * rim);
    const cone = lfH(x, y);
    if (cone > 0) { h[i] += cone * (sh.landformHeight ?? 3); if (cone > 0.05) lock[i] = 1; }
  }

  // The beds dip a little, so a cliff line wanders across the contours instead of following one.
  const dip = new Float32Array(N);
  for (let i = 0; i < N; i++) dip[i] = dipAt(cfg.dip ?? 0.5, cx(i), cy(i));
  const strata = cfg.strata || [];
  const hardAt = (i) => mix(1, bedHard(strata, h[i] + dip[i]), L[i]) * HC[i];

  // ── erosion ──
  const er = cfg.erosion || {};
  const iters = er.iterations ?? 150, K = er.k ?? 0.004, Dif = er.creep ?? 0.08;
  const rain = new Float32Array(N);
  for (let i = 0; i < N; i++) rain[i] = (0.4 + 0.6 * M[i]) * cell * cell;
  const key = new Float32Array(N), rec = new Int32Array(N), ord = new Int32Array(N), A = new Float32Array(N);
  const seen = new Uint8Array(N), lake = new Float32Array(N), tmp = new Float32Array(N);
  let nOrd = 0;
  const EPS = 1e-5;

  // Priority flood from every outlet (the sea and the regions). Each free cell drains to the cell
  // that reached it, which gives every cell a way out; a pit is filled to its spill level, and the
  // fill is remembered as lake, which the biomes read as a dry lakebed.
  function flood(record) {
    seen.fill(0); nOrd = 0;
    const H = heap(N, key);
    // ⚠ THE EDGE OF THE BAKE IS OPEN. The country carries on past the rect; only the bake stops. A
    // closed edge pooled water against it and laid a dry lakebed along half the border. So a border
    // cell is an outlet at its own height, as the sea and the regions are.
    for (let i = 0; i < N; i++) {
      const x = i % cw, y = (i / cw) | 0;
      if (kind[i] !== 0 || x === 0 || y === 0 || x === cw - 1 || y === ch - 1) { key[i] = h[i]; seen[i] = 1; rec[i] = i; H.push(i); }
    }
    while (H.size) {
      const c = H.pop();
      if (kind[c] === 0) ord[nOrd++] = c;
      const x = c % cw, y = (c / cw) | 0;
      for (let k = 0; k < 8; k++) {
        const nx = x + NB[k][0], ny = y + NB[k][1];
        if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
        const n = ny * cw + nx;
        if (seen[n]) continue;
        seen[n] = 1; rec[n] = c;
        const fill = key[c] + EPS;
        if (lock[n]) key[n] = Math.max(h[n], fill);    // the crater stays a crater
        else { if (h[n] < fill) { if (record) lake[n] += fill - h[n]; h[n] = fill; } key[n] = h[n]; }
        H.push(n);
      }
    }
  }
  function accumulate() {
    for (let i = 0; i < N; i++) A[i] = kind[i] === 0 ? rain[i] : 0;
    for (let j = nOrd - 1; j >= 0; j--) { const i = ord[j], r = rec[i]; if (r !== i) A[r] += A[i]; }
  }

  flood(true);
  for (let it = 0; it < iters; it++) {
    if (it > 0) flood(false);
    accumulate();
    // Stream power, solved implicitly from the outlets upstream: each cell already knows its
    // receiver's new height, so a cell is pulled toward it and the step is stable at any size.
    for (let j = 0; j < nOrd; j++) {
      const i = ord[j], r = rec[i];
      if (lock[i] || h[i] <= h[r]) continue;
      const k = (i - r === 1 || r - i === 1 || i - r === cw || r - i === cw) ? 1 : Math.SQRT2;
      const F = K * Math.sqrt(A[i]) / (hardAt(i) * k * cell);
      h[i] = (h[i] + F * h[r]) / (1 + F);
    }
    // Hillslope creep. Soft ground slumps; a hard bed holds its face.
    if (Dif > 0) {
      for (let i = 0; i < N; i++) {
        if (kind[i] !== 0 || lock[i]) { tmp[i] = h[i]; continue; }
        const x = i % cw, y = (i / cw) | 0;
        const l = x > 0 ? h[i - 1] : h[i], rr = x < cw - 1 ? h[i + 1] : h[i];
        const u = y > 0 ? h[i - cw] : h[i], d = y < ch - 1 ? h[i + cw] : h[i];
        const hd = hardAt(i);
        tmp[i] = h[i] + Math.min(0.24, Dif / (hd * hd)) * (l + rr + u + d - 4 * h[i]);
      }
      h.set(tmp);
    }
    if (onProgress && (it % 10 === 0)) onProgress(it / iters);
  }
  // ── terraces ──
  // Erosion on a 2-tile grid leaves the steps too soft to read as cliffs: a caprock edge comes out
  // as a slope ten tiles wide. So layered rock is pulled toward a staircase whose risers sit just
  // under each cap's top: a flat bench for most of the interval, then a face. Soft rock is left as
  // it eroded, which is what keeps rolling country rolling.
  const tr = cfg.terrace || {};
  const tAmt = tr.amount ?? 0.85, bench = tr.bench ?? 0.75;
  const tops = [0, ...strata.filter((s) => s.cap).map((s) => s.top)];
  if (tAmt > 0 && tops.length > 1) {
    for (let i = 0; i < N; i++) {
      if (kind[i] !== 0 || lock[i] || L[i] <= 0) continue;
      const hb = h[i] + dip[i];
      let k = -1;
      for (let j = 0; j < tops.length - 1; j++) if (hb >= tops[j] && hb < tops[j + 1]) { k = j; break; }
      if (k < 0) continue;
      const lo = tops[k], hi = tops[k + 1], u = (hb - lo) / (hi - lo);
      const stair = lo + (hi - lo) * sstep(bench, 1, u) - dip[i];
      h[i] = Math.max(0, mix(h[i], stair, tAmt * L[i]));
    }
  }
  // ⚠ THE RING OF CELLS ROUND A REGION IS FLAT. A reader samples between cells, so a cell beside the
  // rim carrying any height at all lifts the placed tile next to it; creep can push a little back
  // into that ring after the uplift eased it to nothing. gl:wildlands holds every placed tile flat.
  for (let i = 0; i < N; i++) if (kind[i] === 0 && distLand[i] <= cell * 1.5) h[i] = 0;
  flood(false);
  accumulate();

  const hard = new Float32Array(N);
  for (let i = 0; i < N; i++) hard[i] = hardAt(i);
  const caps = strata.filter((s) => s.cap).map((s) => s.top);
  return { rect, cell, cw, ch, kind, h, flow: A, lake, moisture: M, layered: L, hard, dip, lock, strata, caps, cfg, regionIds, regionIx };
}

// ── READING IT PER TILE ──────────────────────────────────────────────────────

export function sampleCells(R, plane, x, y) {
  const fx = clamp((x - R.rect.x0) / R.cell, 0, R.cw - 1.001), fy = clamp((y - R.rect.y0) / R.cell, 0, R.ch - 1.001);
  const xi = fx | 0, yi = fy | 0, u = fx - xi, v = fy - yi, i = yi * R.cw + xi;
  const p = plane[i], q = plane[i + 1], r = plane[i + R.cw], s = plane[i + R.cw + 1];
  return p + (q - p) * u + (r - p) * v + (p - q - r + s) * u * v;
}
const nearestCell = (R, x, y) => clamp(Math.round((y - R.rect.y0) / R.cell), 0, R.ch - 1) * R.cw + clamp(Math.round((x - R.rect.x0) / R.cell), 0, R.cw - 1);

export const TERRAINS = RELIEF_BIOMES;

// The planes of a bake as a relief-rules.js view, so the preview reads a tile exactly as the game
// will once the bake is shipped.
export function viewOf(R) {
  const S = (p) => cellSampler(p, R.rect.x0, R.rect.y0, R.cell, R.cw, R.ch);
  return { h: S(R.h), layered: S(R.layered), flow: S(R.flow), wet: S(R.moisture), lake: S(R.lake), caps: R.caps, dip: R.cfg.dip ?? 0.5, rules: R.cfg.rules || {}, zScale: R.cfg.zScale ?? 0.5 };
}

// Every tile in the rect, read through reliefTileAt: height, step, tier, flow and biome (an index
// into TERRAINS). Placed tiles are left as biome '' (the region owns them).
export function tileGrid(R, wild = {}) {
  const wAt = wild.wildlandsAt || wildlandsAt, V = viewOf(R);
  const { x0, y0, x1, y1 } = R.rect, TW = x1 - x0 + 1, TH = y1 - y0 + 1, N = TW * TH;
  const H = new Float32Array(N), S = new Float32Array(N), T = new Int8Array(N), F = new Float32Array(N), TER = new Uint8Array(N);
  const placed = new Uint8Array(N), sea = new Uint8Array(N);
  for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
    const i = y * TW + x, wx = x0 + x, wy = y0 + y;
    if (R.kind[nearestCell(R, wx, wy)] === 2) { placed[i] = 1; H[i] = surfaceH(V, wx, wy); continue; }
    const at = wAt(wx, wy), r = reliefTileAt(V, wx, wy, at);
    H[i] = r.h; S[i] = r.step; T[i] = r.tier; F[i] = r.flow; sea[i] = at.sea ? 1 : 0;
    TER[i] = RELIEF_BIOMES.indexOf(r.biome);
  }
  return { x0, y0, TW, TH, H, S, T, F, TER, placed, sea };
}

// ── ROADS ON THE RELIEF ──────────────────────────────────────────────────────
//
// A* on the cell grid from one gate to another. Grade costs as its square, a step between tiers
// costs a lot and a steep one can't be crossed at all, a wash costs a floodway, and the sea and
// other regions are closed. The path is what the road builder will follow; here it is drawn.
//
// ⚠ PASS THE TILE GRID. Tiers on the 2-tile cells miss rims the per-tile pass finds, so without it a
// road threads a ramp a tile from a cliff face. With it, a road keeps `clear` tiles off every cliff
// tile and pays to come within `clearSoft`. If nothing gets through clear, the route is taken again
// without the hard clearance and marked `cutting`: that road has to be cut through the rock.
export function cliffDistance(R, G) {
  const seed = new Uint8Array(R.cw * R.ch), ci = TERRAINS.indexOf('cliff');
  for (let y = 0; y < G.TH; y++) for (let x = 0; x < G.TW; x++) {
    if (G.TER[y * G.TW + x] !== ci) continue;
    seed[nearestCell(R, G.x0 + x, G.y0 + y)] = 1;
  }
  return chamfer(R.cw, R.ch, seed, R.cell);
}
export function routeRoad(R, a, b, opts = {}) {
  const hardClear = opts.cliffDist ? routeOnce(R, a, b, opts, true) : null;
  if (hardClear) return hardClear;
  const p = routeOnce(R, a, b, opts, false);
  if (p && opts.cliffDist) p.cutting = true;
  return p;
}
function routeOnce(R, a, b, opts, clearHard) {
  const { cw, ch, cell, kind, h, layered, dip, flow } = R;
  const rc = R.cfg.roads || {};
  const cd = opts.cliffDist, clear = rc.clear ?? 3, clearSoft = rc.clearSoft ?? 7, wNear = rc.near ?? 4;
  const wGrade = rc.grade ?? 900, wTier = rc.tier ?? 60, wWash = rc.wash ?? 6, washFlow = rc.washFlow ?? (R.cfg.rules?.washFlow ?? 900);
  const cliffSlope = R.cfg.rules?.cliffSlope ?? 0.22, endR = rc.endRadius ?? 6;
  const toCell = (p) => clamp(Math.round((p[1] - R.rect.y0) / cell), 0, ch - 1) * cw + clamp(Math.round((p[0] - R.rect.x0) / cell), 0, cw - 1);
  const s = toCell(a), g = toCell(b), gx = g % cw, gy = (g / cw) | 0, sx = s % cw, sy = (s / cw) | 0;
  const N = cw * ch, G = new Float32Array(N).fill(Infinity), P = new Int32Array(N).fill(-1), fk = new Float32Array(N), done = new Uint8Array(N);
  const tier = (i) => tierOfH(R.caps, h[i] + dip[i], layered[i]);
  const open = heap(N, fk);
  G[s] = 0; fk[s] = 0; open.push(s);
  const near = (i, X, Y) => Math.hypot((i % cw) - X, ((i / cw) | 0) - Y) * cell <= endR;
  while (open.size) {
    const c = open.pop();
    if (done[c]) continue;
    done[c] = 1;
    if (c === g) break;
    const x = c % cw, y = (c / cw) | 0, tc = tier(c);
    for (let k = 0; k < 8; k++) {
      const nx = x + NB[k][0], ny = y + NB[k][1];
      if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
      const n = ny * cw + nx;
      if (done[n]) continue;
      if (kind[n] === 1) continue;
      const atEnd = near(n, sx, sy) || near(n, gx, gy);
      if (kind[n] === 2 && !atEnd) continue;
      if (clearHard && !atEnd && cd[n] < clear) continue;
      const d = NB_D[k] * cell, grade = Math.abs(h[n] - h[c]) / d;
      let cost = d * (1 + wGrade * grade * grade);
      if (cd && cd[n] < clearSoft) cost += d * wNear * (clearSoft - cd[n]) / clearSoft;
      const tn = tier(n);
      if (tn !== tc) { if (grade >= cliffSlope) continue; cost += wTier; }
      if (flow[n] >= washFlow && flow[c] < washFlow) cost += wWash;
      const ng = G[c] + cost;
      if (ng < G[n]) { G[n] = ng; P[n] = c; fk[n] = ng + Math.hypot(nx - gx, ny - gy) * cell; open.push(n); }
    }
  }
  if (!Number.isFinite(G[g])) return null;
  const pts = [];
  for (let c = g; c !== -1; c = P[c]) pts.push([R.rect.x0 + (c % cw) * cell, R.rect.y0 + ((c / cw) | 0) * cell]);
  pts.reverse();
  pts[0] = [a[0], a[1]]; pts[pts.length - 1] = [b[0], b[1]];
  return smooth(pts, opts.passes ?? 3);
}
// How many cliff tiles lie within `r` tiles of a road's centreline. The gate phase 4 adds.
export function cliffsNear(G, pts, r = 3) {
  const ci = TERRAINS.indexOf('cliff'), hit = new Set();
  for (const [x, y] of resample(pts, 1)) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (dx * dx + dy * dy > r * r) continue;
    const tx = Math.round(x) + dx - G.x0, ty = Math.round(y) + dy - G.y0;
    if (tx < 0 || ty < 0 || tx >= G.TW || ty >= G.TH) continue;
    const i = ty * G.TW + tx;
    if (G.TER[i] === ci) hit.add(i);
  }
  return hit.size;
}

// Chaikin corner-cutting, ends fixed. A stand-in for the arc builder in the preview.
function smooth(pts, passes) {
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

// Resample a polyline every `step` tiles.
export function resample(pts, step = 1) {
  const out = [pts[0]];
  let carry = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1], L = Math.hypot(bx - ax, by - ay);
    let s = step - carry;
    while (s <= L) { out.push([ax + (bx - ax) * s / L, ay + (by - ay) * s / L]); s += step; }
    carry = L - (s - step);
  }
  const last = pts[pts.length - 1];
  if (Math.hypot(last[0] - out[out.length - 1][0], last[1] - out[out.length - 1][1]) > 0.01) out.push(last);
  return out;
}

// The road's height along its length: the ground smoothed along the centreline, then clamped to
// the grade limit both ways. Cut is where the ground is above the road, fill where it is below.
export function roadProfile(R, pts, opts = {}) {
  const rc = R.cfg.roads || {};
  const zs = R.cfg.zScale ?? 0.5, maxGrade = (rc.maxGrade ?? 0.06) / zs, win = rc.smooth ?? 8;
  const P = resample(pts, 1), n = P.length;
  const g = P.map(([x, y]) => sampleCells(R, R.h, x, y));
  const z = g.map((_, i) => { let s = 0, c = 0; for (let j = Math.max(0, i - win); j <= Math.min(n - 1, i + win); j++) { s += g[j]; c++; } return s / c; });
  z[0] = g[0]; z[n - 1] = g[n - 1];
  for (let i = 1; i < n; i++) z[i] = clamp(z[i], z[i - 1] - maxGrade, z[i - 1] + maxGrade);
  for (let i = n - 2; i >= 0; i--) z[i] = clamp(z[i], z[i + 1] - maxGrade, z[i + 1] + maxGrade);
  let maxCut = 0, maxFill = 0, rawGrade = 0;
  for (let i = 0; i < n; i++) { maxCut = Math.max(maxCut, g[i] - z[i]); maxFill = Math.max(maxFill, z[i] - g[i]); if (i) rawGrade = Math.max(rawGrade, Math.abs(g[i] - g[i - 1])); }
  return { pts: P, ground: g, z, length: n - 1, maxCut, maxFill, rawGrade: rawGrade * zs, maxGrade: maxGrade * zs };
}
