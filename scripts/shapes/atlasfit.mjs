// atlasfit — does every surface in the city fit one texture page, and is each one where it says?
//
// ⚠ THIS EXISTS BECAUSE THE ATLAS FAILS BY DRAWING A PLAUSIBLE PICTURE. There are two ways it can
// be wrong and neither throws:
//
//   A page the device cannot hold is refused, and the renderer falls back to flat palette colours.
//   That is the SAFE failure and it is still a city with no texture on it, announced by one console
//   warning nobody is reading. It is also what capped `texRes` at 1 for the life of the feature.
//
//   A rect that overlaps its neighbour ssamples somebody else's tile. Every wall still paints, every
//   frame, at full speed — with the wrong brick on it. No gate in the repo would notice, because
//   `walltex` checks the tiles BEFORE they are packed and `glmesh` checks the geometry that samples
//   them, and the packing in between was covered by nothing at all.
//
// So: pack every palette the city can bake, at every texRes that ships, and assert the page fits the
// WebGL2 floor guarantee, that every tile is inside it, that no two overlap, and that the same
// surfaces always pack the same way.
//
//   node scripts/shapes/atlasfit.mjs
import { loadWindshield } from './dom-stub.mjs';

const ws = await loadWindshield();
const { wallPaletteInfo, wallTexMixed, roofTex, RENDER_TUNE } = ws;
const { buildAtlas } = await import('../../client/game/js/panels/gl/atlas.js');

// The size WebGL2 guarantees and nothing more. A device with a bigger limit is a bonus, never a plan.
const FLOOR = 2048;
const SHIPS = RENDER_TUNE.texRes || 1;

let checks = 0, bad = 0;
const check = (cond, what) => { checks++; if (!cond) { bad++; if (bad <= 12) console.error('  ✗ ' + what); } };

const keys = wallPaletteInfo().map((x) => x.key || x);

function bakeAll(tr) {
  RENDER_TUNE.texRes = tr;
  const tiles = [];
  for (const k of keys) {
    const w = wallTexMixed(k, 0.5); if (w && w.width) tiles.push({ key: 'w:' + k, canvas: w });
    const r = roofTex(k, 0.5);      if (r && r.width) tiles.push({ key: 'r:' + k, canvas: r });
  }
  return tiles;
}

// ⚠ The shipping setting is checked first and by name. Everything below it is headroom; this one is
// the city players are looking at, and it is the only row whose failure is not hypothetical.
const RATES = [...new Set([SHIPS, 1, 2, 3])].sort((a, b) => a - b);

for (const tr of RATES) {
  const tiles = bakeAll(tr);
  const atlas = buildAtlas(tiles, FLOOR);
  if (!atlas) {
    check(false, `texRes ${tr}: the whole city's ${tiles.length} surfaces do not fit a ${FLOOR}px page `
      + `— on a floor-spec device this city draws flat colours`);
    continue;
  }
  const [W, H] = atlas.size;
  check(W <= FLOOR && H <= FLOOR, `texRes ${tr}: page ${W}x${H} exceeds the ${FLOOR} guarantee`);
  check(atlas.rect.size === tiles.length, `texRes ${tr}: ${tiles.length} tiles in, ${atlas.rect.size} rects out`);

  // Each rect must be inside the page and exactly the tile's own size — a tile packed into a cell
  // meant for a bigger one would sample stretched, which reads as a blurry building rather than a bug.
  const boxes = [];
  for (const t of tiles) {
    const r = atlas.rect.get(t.key);
    if (!r) { check(false, `texRes ${tr}: ${t.key} got no rect`); continue; }
    const x0 = Math.round(r[0] * W), y0 = Math.round(r[1] * H);
    const x1 = Math.round(r[2] * W), y1 = Math.round(r[3] * H);
    check(x0 >= 0 && y0 >= 0 && x1 <= W && y1 <= H, `texRes ${tr}: ${t.key} rect ${x0},${y0}..${x1},${y1} is outside the ${W}x${H} page`);
    check(x1 - x0 === t.canvas.width && y1 - y0 === t.canvas.height,
      `texRes ${tr}: ${t.key} is ${t.canvas.width}x${t.canvas.height} but its rect covers ${x1 - x0}x${y1 - y0}`);
    // The padded footprint, which is what must not collide — the skirt is drawn outside the rect.
    boxes.push({ key: t.key, x0: x0 - 1, y0: y0 - 1, x1: x1 + 1, y1: y1 + 1 });
  }

  // ── NO TWO TILES OVERLAP ────────────────────────────────────────────────────────────────────
  // Sweep by row band rather than comparing all pairs: 568 tiles is 161k pairs and this runs on
  // every push.
  boxes.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  let overlaps = 0, firstPair = '';
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length && boxes[j].y0 < boxes[i].y1; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) {
        if (!overlaps) firstPair = `${a.key} and ${b.key}`;
        overlaps++;
      }
    }
  }
  check(overlaps === 0, `texRes ${tr}: ${overlaps} tile pair(s) overlap in the page — first ${firstPair}`);

  // ── THE SAME SURFACES PACK THE SAME WAY ─────────────────────────────────────────────────────
  // The caller fills its key set by frame traversal, which is not a stable order. A page that
  // reshuffled between two frames of identical content would re-upload for nothing, and the upload
  // is the one part of this that touches the GPU.
  const shuffled = tiles.slice().reverse();
  const again = buildAtlas(shuffled, FLOOR);
  let moved = 0;
  for (const t of tiles) {
    const p = atlas.rect.get(t.key), q = again && again.rect.get(t.key);
    if (!q || p.some((v, i) => v !== q[i])) moved++;
  }
  check(moved === 0, `texRes ${tr}: ${moved} tile(s) land somewhere else when the input order changes`);

  console.log(`  · texRes ${tr}: ${tiles.length} surfaces → ${W}x${H} in ${atlas.bands} band(s)`
    + `${tr === SHIPS ? '   ← ships' : ''}`);
}

RENDER_TUNE.texRes = SHIPS;

// A page with one tile, and a page with tiles too wide for any layout, are the two ends nobody
// renders but somebody will eventually pass in.
check(buildAtlas([]) === null, 'an empty tile list should refuse rather than build a 0x0 page');
check(buildAtlas([{ key: 'x', canvas: { width: 4096, height: 16 } }], FLOOR) === null,
  'a tile wider than the device limit should refuse rather than overflow the page');

if (bad) {
  console.error(`\n✗ atlasfit — ${bad} of ${checks} checks failed.`);
  console.error('  A mispacked atlas draws every wall at full speed with the wrong texture on it.');
  process.exit(1);
}
console.log(`✓ atlasfit: ${checks} checks — every palette in the city packs inside the ${FLOOR}px WebGL2 floor at texRes ${RATES.join(', ')}, with no tile overlapping another.`);
