// THE LIGHT GRID: every light in the frame, binned by where it can land (RENDER_TUNE.glCluster).
//
// pickLights (world.js) ranks the frame's lights and the consumers take the top few as uniform
// arrays: the wall 16, the wet road 6. A dense night frame has 120 to 400, so most never reach the
// road, and the ones that do swap in and out as the ranking churns. This bins the whole list into a
// grid instead, kept in three textures, and a fragment walks only the lights whose footprint covers
// its own cell. See docs/proposals/glass-lights-and-taa.md.
//
// ⚠ THE ROAD'S GRID LIES ON THE GROUND, NOT ON THE SCREEN. A wet-road streak is anchored at the
// mirror point between the eye and the light, not at the light, and every term ground.js evaluates
// depends on the fragment's world x,y alone. So the grid is a plain 2-D grid over the map window in
// the same frame as `vWorld`: no projection, no near-plane clipping, no height range to guess.
//
// ⚠ A FOOTPRINT IS WHERE A LIGHT CAN STILL MOVE THE PICTURE, SO IT'S SIZED BY ITS GAIN. Every streak
// passes within a tile or two of the eye (its mirror point sits at eh / (eh + h) of the way to the
// light), so with a fixed cut-off the cells round the camera listed nearly every light in the frame.
// The streak is at most 0.09 of the light's colour and the glint at most uGlint of it, so each term
// is cut where colour * gain * exp(-K*K) falls under `eps`: a bright sign keeps a long streak and a
// dim window's is short or absent, which is also what the shader would have drawn.
//
// ⚠ THE FOOTPRINTS MIRROR THE SHADER, AND THE GATE HOLDS THEM TOGETHER. `measure` is the extent of
// `wetLight` in ground.js (the streak and the glint) and of `poolLight`. Change a term there and the
// footprint here must follow, or a light is cut off at a cell edge, which shows as a seam on the
// road that moves as you drive. scripts/shapes/glcluster.mjs reads the shader's expressions and
// fails if they've changed, and fails if any point a light reaches is in a cell that doesn't list it.
//
// ⚠ THE SHADER CHUNK DECLARES NO UNIFORMS. glsl-smoke cuts an imported snippet, so declarations in
// here would be invisible to it and every use in the consumer would be reported. Each consumer
// declares the names in LIGHTGRID_UNIFORMS in its own shader, where the gate can see them.

export const LIGHTGRID_TUNE = {
  // How many lights the grid holds. The light table is LG_W texels wide, two a light, in two rows.
  maxLights: 512,
  maxCells: 64,      // per axis; the cell table is allocated at this size once
  cellMin: 1.0,      // tiles. 0.75 cost half as much again in the binning (27k entries against 17k
                     // for a cab frame) and the shader reads the same lights either way
  // A cell's list is cut here, strongest first, and the cut is counted (`cut` in the stats).
  // ⚠ IT'S THE TABLE SIZE, SO IT NEVER BITES, AND THAT'S DELIBERATE. From a cab every streak's mirror
  // point is within a tile or two of the eye, so the cells just ahead of it list nearly every light
  // in front, and that's the shader's own model (tarmac scatters wide), not a binning fault. At 128
  // a dense frame cut hundreds of entries there, and a cut tail stops at a cell edge: a seam on the
  // road. If those cells cost too much, the fix is in the term, not a cut here.
  perCell: 512,
  // The cut-off, in output colour: below half a step of an 8-bit channel.
  eps: 1 / 512,
  // The road streak and the glint on the grid path, as factors on what the six-light path draws
  // (uLGStreakW/K and uLGGlintW/K in ground.js). Width is both axes for the glint, at most 2.
  // ⚠ THE GLINT IS WHAT SUMMED INTO A SHEET, NOT THE STREAK. At the six-light settings the grid
  // brightened 29.6% of a wet street at 23:00 and 26.4% at 13:00 (pink by night, red by day); with
  // the glint off it added 5.6% and 1.6%. Swept 2026-10-18 on the Modelshop wet street, judged by
  // eye at both hours: glint 0.5 / 0.3 gives separate reflections under each sign and a mean change
  // of +0.3 levels against six lights, so the road carries the light it did, spread over every sign.
  streakW: 1,
  streakK: 1,
  glintW: 0.5,
  glintK: 0.3,
};

// The gains the shader puts on each term, at most. ground.js: the streak is added as
// add * (smear * 4.5 * refl) with smear = uWet * 0.02 * (1 - pud) and refl <= 1; the glint as
// glint * (imgW * uGlint * refl * (0.35 + 0.65 * spark)) with imgW = uWet * pud and spark <= 1.
// Both also go through a headroom factor of at most 1. The gate checks these expressions.
const STREAK_GAIN = 4.5 * 0.02;

const LG_W = 1024;                      // light table and index list width; the GLSL uses the same
const IDX_ROWS = 64;                    // index capacity: LG_W * IDX_ROWS entries
const IDX_CAP = LG_W * IDX_ROWS;
const PAIR_CAP = IDX_CAP * 2;           // (cell, light) pairs before the per-cell cut

// The names a consumer declares in its own fragment shader, and asks for by these strings.
export const LIGHTGRID_UNIFORMS = ['uLGLight', 'uLGCell', 'uLGIdx', 'uLGOn', 'uLGOrigin', 'uLGInv', 'uLGDim'];

// The declarations, for a consumer to paste (not splice: see the ⚠ above about glsl-smoke):
//
//   uniform highp sampler2D  uLGLight;   // RGBA32F, two rows of two texels a light (lgP/lgC, lgX/lgY)
//   uniform highp usampler2D uLGCell;    // RG32UI, a cell's (offset, count)
//   uniform highp usampler2D uLGIdx;     // R32UI, the light indices, cell by cell
//   uniform int   uLGOn;                 // 1 when the grid is bound and current
//   uniform vec2  uLGOrigin;             // the grid's corner, in vWorld's frame
//   uniform float uLGInv;                // 1 / cell size, in tiles
//   uniform ivec2 uLGDim;                // cells across and down
export const LIGHTGRID_GLSL = `
const int LG_W = ${LG_W};
uvec2 lgCell(vec2 p) {
  ivec2 c = clamp(ivec2(floor((p - uLGOrigin) * uLGInv)), ivec2(0), uLGDim - 1);
  return texelFetch(uLGCell, c, 0).xy;
}
int lgAt(uint k) {
  int i = int(k);
  return int(texelFetch(uLGIdx, ivec2(i % LG_W, i / LG_W), 0).r);
}
vec4 lgP(int li) { return texelFetch(uLGLight, ivec2(li * 2, 0), 0); }
// lgC is (rgbRaw, sr): sr is the sign-on-its-wall reach (LIGHT_TUNE.signR), 0 for a wash.
vec4 lgC(int li) { return texelFetch(uLGLight, ivec2(li * 2 + 1, 0), 0); }
// The second row, for the wall and the solids lit like it: (rgb, rw) and (rl, lamp). 'rgb' is the
// wash colour, with its gain and the night folded in; 'lamp' the night-weighted colour a solid
// object catches (actors, solids). Both as pickLights makes them.
vec4 lgX(int li) { return texelFetch(uLGLight, ivec2(li * 2, 1), 0); }
vec4 lgY(int li) { return texelFetch(uLGLight, ivec2(li * 2 + 1, 1), 0); }
`;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const peakOf = (L) => { const c = L.rgbRaw || L.rgb || [0, 0, 0]; return Math.max(c[0], c[1], c[2]); };

// ── FOOTPRINTS ─────────────────────────────────────────────────────────────────────────────────

// How many standard deviations out a Gaussian term of peak `peak` stays above `eps`, or 0 if it
// never reaches it. Outside |a| <= K and |t| <= K one factor of exp(-a*a) * exp(-t*t) is under
// exp(-K*K) and the other is at most 1, so the term is under eps everywhere outside the rectangle.
const sigmas = (peak, eps) => (peak > eps ? Math.sqrt(Math.log(peak / eps)) : 0);

// One light's footprint, in scratch reused for every light: up to two rectangles as their four
// corners in order round each, and a pool radius. Nothing here allocates; the binning runs over
// every light every frame.
const FP_X = new Float64Array(8), FP_Y = new Float64Array(8);
let fpRects = 0, fpDisc = 0;

// Padded by a thousandth of a tile on every side, since the shader's float sees a point on an edge
// a hair either side of where this double does.
const PAD = 1e-3;

// Rectangle `k`: from the mirror point (sx, sy), along (dx, dy) from `a0` to `a1`, `w` either side.
function setRect(k, sx, sy, dx, dy, a0, a1, w) {
  const nx = -dy, ny = dx, o = k * 4;
  a0 -= PAD; a1 += PAD; w += PAD;
  FP_X[o] = sx + dx * a0 - nx * w;     FP_Y[o] = sy + dy * a0 - ny * w;
  FP_X[o + 1] = sx + dx * a1 - nx * w; FP_Y[o + 1] = sy + dy * a1 - ny * w;
  FP_X[o + 2] = sx + dx * a1 + nx * w; FP_Y[o + 2] = sy + dy * a1 + ny * w;
  FP_X[o + 3] = sx + dx * a0 + nx * w; FP_Y[o + 3] = sy + dy * a0 + ny * w;
}

// Where one light's streak, glint and pool can land, into the scratch above. Mirrors `wetLight`
// and `poolLight` in ground.js. `wet` is uWet, `glint` uGlint, `pool` uPool times the night (0 for
// a term that isn't live).
//
// The streak runs `len` toward the light and 0.45 * len back from the mirror point `spec`, and its
// width is max(0.25, r * 0.25). The glint is the same field at 0.45 of the length and
// max(0.10, r * 0.12) wide, with its own gain, so it gets its own rectangle.
//
// ⚠ A LIGHT OVER THE EYE HAS NO DIRECTION, and the shader skips it below el = 0.001. The float the
// GPU computes isn't this double, so near that line the answer could go either way: the light gets a
// square round the eye big enough for any direction, which is conservative whichever way it falls.
function measure(L, ex, ey, eh, wet, glint, pool, eps, sw = 1, sk = 1, gw = 1, gk = 1) {
  fpRects = 0;
  const C = peakOf(L);
  const Ks = wet > 0 ? sigmas(C * STREAK_GAIN * wet * sk, eps) : 0;
  const Kg = wet > 0 && glint > 0 ? sigmas(C * glint * wet * gk, eps) : 0;
  if (Ks > 0 || Kg > 0) {
    let dx = L.p[0] - ex, dy = L.p[1] - ey;
    const el = Math.hypot(dx, dy);
    const ws = Ks * Math.max(0.25, (L.r || 0) * 0.25) * sw, wg = Kg * Math.max(0.10, (L.r || 0) * 0.12) * gw;
    if (el < 0.002) {
      // len is at its floor of 0.8 here; any direction, so a square.
      const s = Math.max(Ks, Kg * gw) * 0.8 + Math.max(ws, wg);
      setRect(fpRects++, ex, ey, 1, 0, -s, s, s);
    } else {
      dx /= el; dy /= el;
      const k = eh / Math.max(0.05, eh + L.p[2]);
      const sx = ex + dx * el * k, sy = ey + dy * el * k;
      const len = clamp(el * 0.9, 0.8, 10);
      if (Ks > 0) setRect(fpRects++, sx, sy, dx, dy, -Ks * len * 0.45, Ks * len, ws);
      const glen = len * 0.45 * gw;
      if (Kg > 0) setRect(fpRects++, sx, sy, dx, dy, -Kg * glen * 0.45, Kg * glen, wg);
    }
  }
  fpDisc = pool > 0 ? poolRadius(L, pool, eps) : 0;
}

// How far a lamp's pool reaches, in tiles, or 0 if it never lifts the road by `eps`. Mirrors
// `poolLight`: hs * h^3 / (d^2 + h^2)^1.5 with h = max(0.14, z) and hs = min(1, 0.33^2 / h^2),
// times the colour and `gain` (uPool times the night; the fog and headroom factors are at most 1).
export function poolRadius(L, gain, eps = LIGHTGRID_TUNE.eps) {
  if (!(gain > 0)) return 0;
  const h = Math.max(0.14, L.p[2]);
  const hs = Math.min(1, (0.33 * 0.33) / (h * h));
  const peak = hs * peakOf(L) * gain;
  if (peak <= eps) return 0;
  const d2 = Math.pow(peak / eps, 2 / 3) * h * h - h * h;
  return Math.sqrt(Math.max(0, d2)) + PAD;
}

// ── SCANLINES ──────────────────────────────────────────────────────────────────────────────────
//
// Each shape is convex, so where it crosses a row of cells (a band ya..yb) it covers one span of x,
// and every cell under that span is hit and no other. The span is the min and max over the corners
// inside the band and the points where the edges cross its two lines. A row on the grid's edge
// stretches to infinity on its outer side, matching the shader's clamp, and an infinite line just
// isn't crossed.
let spanLo = 0, spanHi = 0;
function rectSpan(o, ya, yb) {
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < 4; k++) {
    const x0 = FP_X[o + k], y0 = FP_Y[o + k];
    if (y0 >= ya && y0 <= yb) { if (x0 < lo) lo = x0; if (x0 > hi) hi = x0; }
    const j = o + ((k + 1) & 3), x1 = FP_X[j], y1 = FP_Y[j];
    if (y0 === y1) continue;
    if (ya !== -Infinity && (ya - y0) * (ya - y1) <= 0) { const x = x0 + (x1 - x0) * (ya - y0) / (y1 - y0); if (x < lo) lo = x; if (x > hi) hi = x; }
    if (yb !== Infinity && (yb - y0) * (yb - y1) <= 0) { const x = x0 + (x1 - x0) * (yb - y0) / (y1 - y0); if (x < lo) lo = x; if (x > hi) hi = x; }
  }
  spanLo = lo; spanHi = hi;
  return lo <= hi;
}
function discSpan(px, py, r, ya, yb) {
  const dy = py < ya ? ya - py : py > yb ? py - yb : 0;
  if (dy > r) return false;
  const half = Math.sqrt(r * r - dy * dy);
  spanLo = px - half; spanHi = px + half;
  return true;
}

// ── THE GRID ───────────────────────────────────────────────────────────────────────────────────

// One grid's buffers, allocated once and reused every frame (no garbage on the hot path; see
// Stage 1b in docs/proposals/glass-headroom.md).
export function makeGroundGrid() {
  const T = LIGHTGRID_TUNE;
  return {
    light: new Float32Array(LG_W * 4),
    light2: new Float32Array(LG_W * 4),
    cell: new Uint32Array(T.maxCells * T.maxCells * 2),
    index: new Uint32Array(IDX_CAP),
    pairCell: new Uint32Array(PAIR_CAP),
    pairLight: new Uint32Array(PAIR_CAP),
    fill: new Uint32Array(T.maxCells * T.maxCells),
    stamp: new Int32Array(T.maxCells * T.maxCells),
    ox: 0, oy: 0, size: 1, nx: 0, ny: 0,
    n: 0,         // lights in the table
    binned: 0,    // lights with a footprint this frame
    entries: 0,   // indices written
    cut: 0,       // entries dropped by the per-cell cut or the index capacity
    maxCell: 0,   // the longest list, after the cut
  };
}

// Bin `lights` (best first, as pickLights ranks them) over `bounds` = [x0, y0, x1, y1] in vWorld's
// frame. `eye` is { x, y, h }: the camera's ground point and height, as ground.js gets them. `terms`
// is { wet, glint, pool }: uWet, uGlint, and uPool times the night. Returns `g`, filled.
export function buildGroundGrid(g, lights, bounds, eye, terms) {
  const T = LIGHTGRID_TUNE;
  const wet = terms.wet || 0, glint = terms.glint || 0, pool = terms.pool || 0, eps = T.eps;
  const sw = terms.streakW > 0 ? terms.streakW : 1, sk = terms.streakK >= 0 ? terms.streakK : 1;
  const gw = terms.glintW > 0 ? Math.min(2, terms.glintW) : 1, gk = terms.glintK >= 0 ? terms.glintK : 1;
  // `mass`: the wall's grid, every light a disc of its reach (see massLight in context.js).
  const mass = !!terms.mass;
  g.n = 0; g.binned = 0; g.entries = 0; g.cut = 0; g.maxCell = 0; g.nx = 0; g.ny = 0;
  if (!lights || !lights.length || !bounds) return g;
  const bx0 = bounds[0], by0 = bounds[1];
  const W = Math.max(1e-3, bounds[2] - bx0), H = Math.max(1e-3, bounds[3] - by0);
  const size = Math.max(T.cellMin, W / T.maxCells, H / T.maxCells);
  const nx = Math.min(T.maxCells, Math.max(1, Math.ceil(W / size)));
  const ny = Math.min(T.maxCells, Math.max(1, Math.ceil(H / size)));
  g.ox = bx0; g.oy = by0; g.size = size; g.nx = nx; g.ny = ny;
  const nCells = nx * ny;
  const gx1 = bx0 + nx * size, gy1 = by0 + ny * size;
  const stamp = g.stamp, pairCell = g.pairCell, pairLight = g.pairLight;
  g.fill.fill(0, 0, nCells);
  stamp.fill(-1, 0, nCells);
  const n = Math.min(lights.length, T.maxLights, LG_W / 2);
  let pairs = 0;
  for (let i = 0; i < n; i++) {
    const L = lights[i], c = L.rgbRaw || L.rgb || [0, 0, 0];
    const o = i * 8;
    g.light[o] = L.p[0]; g.light[o + 1] = L.p[1]; g.light[o + 2] = L.p[2]; g.light[o + 3] = L.r || 0;
    g.light[o + 4] = c[0]; g.light[o + 5] = c[1]; g.light[o + 6] = c[2]; g.light[o + 7] = L.sr || 0;
    const wc = L.rgb || c, rw = L.rw == null ? (L.r || 0) : L.rw, rl = L.rl || 0;
    g.light2[o] = wc[0]; g.light2[o + 1] = wc[1]; g.light2[o + 2] = wc[2]; g.light2[o + 3] = rw;
    const lc = L.lamp || L.rgb || c;
    g.light2[o + 4] = rl; g.light2[o + 5] = lc[0]; g.light2[o + 6] = lc[1]; g.light2[o + 7] = lc[2];
    // The wall's terms all cut off hard at a reach (massLight in context.js), so its footprint is a
    // disc of the larger one. Distance in x,y is never more than in 3-D, so it can only over-list.
    if (mass) { fpRects = 0; fpDisc = Math.max(rw, rl) > 0 ? Math.max(rw, rl) + PAD : 0; }
    else measure(L, eye.x, eye.y, eye.h, wet, glint, pool, eps, sw, sk, gw, gk);
    const pr = fpDisc, px = L.p[0], py = L.p[1];
    if (!fpRects && !(pr > 0)) continue;
    g.binned++;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let k = 0; k < fpRects * 4; k++) {
      const x = FP_X[k], y = FP_Y[k];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (pr > 0) {
      if (px - pr < x0) x0 = px - pr; if (px + pr > x1) x1 = px + pr;
      if (py - pr < y0) y0 = py - pr; if (py + pr > y1) y1 = py + pr;
    }
    // Entirely off the ground: no fragment can read it (the road's bounds are the ground's own
    // extent). ⚠ NOT IN MASS MODE: the wall's bounds are the lights' extent, a wall past them reads
    // the edge cell, and the edge cell has to list a light that only reaches out there.
    if (!mass && (x1 < bx0 - size || y1 < by0 - size || x0 > gx1 + size || y0 > gy1 + size)) continue;
    const cy0 = clamp(Math.floor((y0 - by0) / size), 0, ny - 1), cy1 = clamp(Math.floor((y1 - by0) / size), 0, ny - 1);
    for (let cy = cy0; cy <= cy1; cy++) {
      const ya = cy === 0 ? -Infinity : by0 + cy * size, yb = cy === ny - 1 ? Infinity : by0 + (cy + 1) * size;
      const row = cy * nx;
      for (let s = 0; s <= fpRects; s++) {
        // The rectangles, then the disc.
        const ok = s < fpRects ? rectSpan(s * 4, ya, yb) : pr > 0 && discSpan(px, py, pr, ya, yb);
        if (!ok) continue;
        const ca = clamp(Math.floor((spanLo - bx0) / size), 0, nx - 1), cb = clamp(Math.floor((spanHi - bx0) / size), 0, nx - 1);
        for (let cx = ca; cx <= cb; cx++) {
          const ci = row + cx;
          if (stamp[ci] === i) continue;
          stamp[ci] = i;
          if (pairs >= PAIR_CAP) { g.cut++; continue; }
          pairCell[pairs] = ci; pairLight[pairs] = i; pairs++;
        }
      }
    }
  }
  g.n = n;
  // Counting sort by cell, stable, so each cell's list keeps pickLights' order: strongest first,
  // which is what the per-cell cut keeps.
  const cnt = g.fill;
  for (let k = 0; k < pairs; k++) cnt[pairCell[k]]++;
  let off = 0;
  for (let ci = 0; ci < nCells; ci++) {
    const c = Math.min(cnt[ci], T.perCell, Math.max(0, IDX_CAP - off));
    g.cut += cnt[ci] - c;
    g.cell[ci * 2] = off; g.cell[ci * 2 + 1] = c;
    if (c > g.maxCell) g.maxCell = c;
    off += c;
    cnt[ci] = 0;                         // reused as the write cursor below
  }
  for (let k = 0; k < pairs; k++) {
    const ci = pairCell[k];
    if (cnt[ci] >= g.cell[ci * 2 + 1]) continue;
    g.index[g.cell[ci * 2] + cnt[ci]++] = pairLight[k];
  }
  g.entries = off;
  return g;
}

// Which cell a point reads, exactly as `lgCell` computes it. The gate uses this.
export function cellOf(g, x, y) {
  const cx = clamp(Math.floor((x - g.ox) / g.size), 0, g.nx - 1);
  const cy = clamp(Math.floor((y - g.oy) / g.size), 0, g.ny - 1);
  return cy * g.nx + cx;
}

// ── THE TEXTURES ───────────────────────────────────────────────────────────────────────────────

// The three textures for one GL context. Created at full size once; each frame writes only the
// part it uses. Every texture is NEAREST: an integer texture with a filtering mode is incomplete,
// and an incomplete texture samples as zero, which here would be a road with no lights and no error.
// Returns null if the device won't take them, and the caller stays on the uniform path.
export function createLightGridTextures(gl) {
  const T = LIGHTGRID_TUNE;
  const made = [];
  const mk = (internal, w, h) => {
    const t = gl.createTexture();
    made.push(t);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, internal, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const light = mk(gl.RGBA32F, LG_W, 2);
  const cell = mk(gl.RG32UI, T.maxCells, T.maxCells);
  const idx = mk(gl.R32UI, LG_W, IDX_ROWS);
  gl.bindTexture(gl.TEXTURE_2D, null);
  if (gl.getError() !== gl.NO_ERROR) { for (const t of made) gl.deleteTexture(t); return null; }

  function upload(g) {
    if (!g.n || !g.nx) return;
    // ⚠ UNPACK STATE IS SHARED WITH EVERY OTHER LAYER. Some set FLIP_Y for an image and put it back;
    // a typed-array upload under a stray FLIP_Y would land upside down, which for an index list is
    // every cell reading another cell's lights.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.bindTexture(gl.TEXTURE_2D, light);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, g.n * 2, 1, gl.RGBA, gl.FLOAT, g.light.subarray(0, g.n * 8));
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 1, g.n * 2, 1, gl.RGBA, gl.FLOAT, g.light2.subarray(0, g.n * 8));
    gl.bindTexture(gl.TEXTURE_2D, cell);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, g.nx, g.ny, gl.RG_INTEGER, gl.UNSIGNED_INT, g.cell.subarray(0, g.nx * g.ny * 2));
    const rows = Math.ceil(g.entries / LG_W);
    if (rows) {
      gl.bindTexture(gl.TEXTURE_2D, idx);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, LG_W, rows, gl.RED_INTEGER, gl.UNSIGNED_INT, g.index.subarray(0, rows * LG_W));
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  // Binds the three to `unit`, `unit + 1` and `unit + 2` and sets the uniforms. `loc` holds the
  // locations of LIGHTGRID_UNIFORMS by their names. Leaves TEXTURE0 active, as the layers expect.
  // With `g` null or empty, uLGOn goes to 0 and the textures are still bound, so the sampler units
  // are complete whatever the shader's branch does.
  function bind(loc, unit, g) {
    const on = !!(g && g.n && g.nx);
    gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, light);
    gl.activeTexture(gl.TEXTURE0 + unit + 1); gl.bindTexture(gl.TEXTURE_2D, cell);
    gl.activeTexture(gl.TEXTURE0 + unit + 2); gl.bindTexture(gl.TEXTURE_2D, idx);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(loc.uLGLight, unit);
    gl.uniform1i(loc.uLGCell, unit + 1);
    gl.uniform1i(loc.uLGIdx, unit + 2);
    gl.uniform1i(loc.uLGOn, on ? 1 : 0);
    if (on) {
      gl.uniform2f(loc.uLGOrigin, g.ox, g.oy);
      gl.uniform1f(loc.uLGInv, 1 / g.size);
      gl.uniform2i(loc.uLGDim, g.nx, g.ny);
    }
  }

  return { upload, bind };
}

// For a context that couldn't make the textures. The samplers still need units of their own with
// nothing bound: left at their default of 0, an integer sampler shares a unit with a float one, and
// WebGL2 refuses the whole draw over that whatever the shader's branch would have done.
export function bindNoLightGrid(gl, loc, unit) {
  for (let k = 0; k < 3; k++) { gl.activeTexture(gl.TEXTURE0 + unit + k); gl.bindTexture(gl.TEXTURE_2D, null); }
  gl.activeTexture(gl.TEXTURE0);
  gl.uniform1i(loc.uLGLight, unit);
  gl.uniform1i(loc.uLGCell, unit + 1);
  gl.uniform1i(loc.uLGIdx, unit + 2);
  gl.uniform1i(loc.uLGOn, 0);
}
