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
// 2048, and every palette in the city at `texRes: 2` wants a 2048×4096 page. On a device at the
// floor that upload is an INVALID_VALUE and nothing else — no throw, no warning, a city wearing a
// black texture. Refusing the page instead hands the renderer back to flat palette colours, which
// is a picture somebody can look at and recognise.
export function buildAtlas(tiles, maxSize = Infinity) {
  if (!tiles.length) return null;
  // Every wall tile is the same size and every roof tile is the same size, so a shelf packer is
  // overkill: a uniform grid of the largest cell wastes a few percent and cannot get the arithmetic
  // wrong. The cell is the biggest tile plus its skirt.
  const cw = Math.max(...tiles.map((t) => t.canvas.width)) + PAD * 2;
  const ch = Math.max(...tiles.map((t) => t.canvas.height)) + PAD * 2;
  // ⚠ THE GRID IS BALANCED ON THE CELL, NOT ON THE COUNT. A square grid of tall cells makes a page
  // twice as high as it is wide, which is the shape most likely to cross a device limit on one axis
  // while wasting half the other. Solving for cols·cw ≈ rows·ch instead costs one square root.
  const cols = Math.max(1, Math.round(Math.sqrt(tiles.length * ch / cw)));
  const rows = Math.ceil(tiles.length / cols);
  const W = pow2(cols * cw), H = pow2(rows * ch);
  if (W > maxSize || H > maxSize) return null;

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const rect = new Map();
  tiles.forEach((t, i) => {
    const cx = (i % cols) * cw + PAD, cy = Math.floor(i / cols) * ch + PAD;
    const tw = t.canvas.width, th = t.canvas.height;
    // The skirt: the tile drawn once oversized behind itself, then the tile on top. Cheaper than
    // four edge blits and gives the same result for a one-texel pad.
    ctx.drawImage(t.canvas, cx - PAD, cy - PAD, tw + PAD * 2, th + PAD * 2);
    ctx.drawImage(t.canvas, cx, cy);
    rect.set(t.key, [cx / W, cy / H, (cx + tw) / W, (cy + th) / H]);
  });
  return { canvas, rect, size: [W, H], cell: [cw, ch], count: tiles.length };
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
