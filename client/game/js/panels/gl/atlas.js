// GLASS'S OWN TEXTURES, PACKED FOR THE GPU.
//
// The renderer already bakes every surface it uses: one 16x32 canvas per palette per day/night per
// texRes, generated on first sight and cached forever (`getTex`). Nine procedural painters draw
// brick, stone, plate, lattice, concrete, bale, brass, tile and stucco into them, and the facade
// branch puts the window grid through on top. None of that has to be rewritten for GL — a canvas
// uploads straight into a texture.
//
// What DOES have to be solved is that a draw call can bind one texture. Binding per face would make
// a city several hundred draw calls and throw away the only thing GL is being asked to prove, so the
// tiles are packed into one atlas and each vertex carries the rect it should sample from.
//
// ⚠ THE TILES ARE PADDED, AND THE PADDING IS NOT COSMETIC. A texture sampler filtering near a tile
// edge reads the neighbouring tile, so an unpadded atlas paints a thin seam of somebody else's
// brick along every wall — worst on exactly the distant walls where the filtering does most work. A
// one-texel skirt of the tile's own edge pixels is what makes bilinear safe.
//
// ⚠ AND IT OWNS NO PALETTE. It is handed tiles and hands back rects; which palettes exist and what
// they look like stays where it already lives.

const PAD = 1;

// `tiles` is [{ key, canvas }]. Returns { canvas, rect: Map(key -> [u0, v0, u1, v1]), size }.
// ⚠ `maxSize` IS NOT OPTIONAL ADVICE. WebGL2 guarantees only that MAX_TEXTURE_SIZE is at least
// 2048, and the banded packer below is what keeps the city inside it: under the uniform grid it
// replaced, every palette at `texRes: 2` wanted a 2048×4096 page. On a device at the
// floor that upload is an INVALID_VALUE and nothing else — no throw, no warning, a city wearing a
// black texture. Refusing the page instead hands the renderer back to flat palette colours, which
// is a picture somebody can look at and recognise.
export function buildAtlas(tiles, maxSize = Infinity) {
  if (!tiles.length) return null;
  // ── BANDED BY CELL SIZE, BECAUSE ONE OUTLIER USED TO SIZE EVERY CELL ───────────────────────
  //
  // ⚠ THIS WAS A UNIFORM GRID OF THE LARGEST CELL, AND THE COMMENT ON IT SAID THAT WASTES "A FEW
  // PERCENT". Measured, it wastes about seven eighths. The city bakes 283 wall tiles at 16x32 and
  // 284 roof tiles at 16x16 — and exactly ONE surface at 32x56, which under a uniform grid sized
  // the cell for all 568 of them. Every 16x16 roof sat in a 34x58 box.
  //
  // The cost of that was not memory, it was the RESOLUTION CEILING. `texRes` 2 wanted a 2048x4096
  // page, over the only size WebGL2 guarantees, so the whole city fell back to flat palette colours
  // on a floor-spec device and the dial could never be raised. Grouping tiles by their own cell and
  // laying each group out in its own band puts the same 568 surfaces at texRes 2 into 512x2048 —
  // and texRes 3 into 2048x2048, which the old packer could not reach at any setting.
  //
  // The page width is CHOSEN rather than derived: a band's column count is whatever fits across it,
  // so a wider page is fewer, taller bands. Trying the powers of two and keeping the smallest area
  // that fits the device is cheaper than reasoning about it and cannot pick a shape that does not.
  const groups = new Map();
  for (const t of tiles) {
    const k = t.canvas.width + 'x' + t.canvas.height;
    let g = groups.get(k); if (!g) groups.set(k, g = []);
    g.push(t);
  }
  // ⚠ Deterministic order, so the same set of surfaces always packs to the same page. The caller
  // fills its key set by frame traversal, which is not a stable order, and a page that reshuffled
  // between two frames of identical content would churn the upload for nothing.
  const bands = [...groups.entries()]
    .sort((x, y) => (y[1][0].canvas.height - x[1][0].canvas.height)
      || (y[1][0].canvas.width - x[1][0].canvas.width) || (x[0] < y[0] ? -1 : 1))
    .map(([, g]) => g.slice().sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0)));

  const widest = Math.max(...tiles.map((t) => t.canvas.width)) + PAD * 2;
  const layoutAt = (W) => {
    if (W < widest) return null;
    let H = 0;
    const rows = [];
    for (const g of bands) {
      const cw = g[0].canvas.width + PAD * 2, ch = g[0].canvas.height + PAD * 2;
      const cols = Math.max(1, Math.floor(W / cw));
      rows.push({ g, cw, ch, cols, y: H });
      H += Math.ceil(g.length / cols) * ch;
    }
    H = pow2(H);
    return H > maxSize ? null : { W, H, rows };
  };
  // ⚠ THE PAGE IS CHOSEN ON ITS LONGEST AXIS, NOT ITS AREA, and picking area first is a bug that
  // looks like it works. Halving the width doubles the band count and therefore the height, so every
  // candidate here has the SAME area — 64x8192, 128x4096 and 256x2048 are all 512k texels — and an
  // area comparison keeps whichever came first. That is the 64-wide one: a page eight thousand
  // texels tall, over the device limit on one axis while measuring as the smallest page available.
  let best = null;
  const CAP = Math.min(maxSize, 8192);
  for (let W = pow2(widest); W <= CAP; W *= 2) {
    const lay = layoutAt(W);
    if (!lay) continue;
    const worse = best && (Math.max(lay.W, lay.H) > Math.max(best.W, best.H)
      || (Math.max(lay.W, lay.H) === Math.max(best.W, best.H) && lay.W * lay.H >= best.W * best.H));
    if (!worse) best = lay;
  }
  if (!best) return null;
  const { W, H } = best;

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const rect = new Map();
  for (const band of best.rows) {
    band.g.forEach((t, i) => {
      const cx = (i % band.cols) * band.cw + PAD;
      const cy = band.y + Math.floor(i / band.cols) * band.ch + PAD;
      const tw = t.canvas.width, th = t.canvas.height;
      // The skirt: the tile drawn once oversized behind itself, then the tile on top. Cheaper than
      // four edge blits and gives the same result for a one-texel pad.
      ctx.drawImage(t.canvas, cx - PAD, cy - PAD, tw + PAD * 2, th + PAD * 2);
      ctx.drawImage(t.canvas, cx, cy);
      rect.set(t.key, [cx / W, cy / H, (cx + tw) / W, (cy + th) / H]);
    });
  }
  return { canvas, rect, size: [W, H], cell: [best.rows[0].cw, best.rows[0].ch], count: tiles.length, bands: best.rows.length };
}

function pow2(n) { let p = 1; while (p < n) p *= 2; return p; }

// The UV a vertex samples, given its face and its index in it.
//
// ⚠ IT MATCHES WHAT THE 2-D RENDERER DOES, which is to stretch ONE tile across the whole face —
// `drawTexQuadPersp` maps the image's full 0..1 across the quad and subdivides only to keep the
// perspective honest. A GL path that tiled by world size instead would be a different building:
// same geometry, different number of windows.
export function faceUVs(face) {
  const n = face.p.length;
  if (face.kind === 'wall' && n === 4) {
    // Wall vertex order is [top-i, top-j, bottom-j, bottom-i] — see draw3DBoxAt.
    return [[0, 0], [1, 0], [1, 1], [0, 1]];
  }
  // A roof (or any n-gon): plan-project onto its own bounding box. Roof tiles are square and have
  // no up, so this is the mapping `roofTex` was drawn for.
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of face.p) {
    if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
  }
  const dx = (x1 - x0) || 1, dy = (y1 - y0) || 1;
  return face.p.map((p) => [(p[0] - x0) / dx, (p[1] - y0) / dy]);
}
