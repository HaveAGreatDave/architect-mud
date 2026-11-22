// A REAL FONT, AS COCKPIT GEOMETRY.
//
// The seat renderer draws flat-coloured faces and nothing else: no textures, so a font file can't be
// laid on a panel the way a shop sign is. This turns a string set in one of the self-hosted faces
// (client/shared/fonts/) into rectangles a kit panel can draw (`Pn.rect`): the string is set once on
// a canvas at `ROWS` pixels to the cap height, every row's inked runs are found, and runs that repeat
// down consecutive rows are merged into one rectangle. A 3-digit readout comes to about a hundred
// rectangles, and it is cached per face and string, so a steady readout costs nothing after the first
// frame.
//
// ⚠ ONLY IN A BROWSER. Under Node (the gates) there's no canvas to set type on, and the DOM stub has
// an OffscreenCanvas that draws nothing, so `glyphRuns` returns null and the caller letters in the
// legend face instead (`fancyText` in interior-merlin.js does). The gates therefore check the same
// words at the same sizes; only the shapes of the letters differ.
// ⚠ THE FACE LOADS ON FIRST ASK. Until it has, `glyphRuns` returns null too, so the first frames are
// in the legend face and the font arrives a moment later. Load a face when its view opens, as
// docs/reference/fonts.md says, which is what asking for it from the seat does.
//
// Coordinates are in cap heights: the baseline at y 0, the top of an H at y 1, x from the pen's start;
// `w` is the advance width in the same units.

const FACES = {
  michroma: 'michroma.woff2',     // wide, flat-sided capitals: titles and badges
  syncopate: 'syncopate.woff2',   // very wide, tight: a nameplate
  orbitron: 'orbitron.woff2',     // geometric numerals: the big readouts
  // The hover cars' makers (docs/proposals/hover-cars.md), a face each.
  federo: 'federo.woff2',         // Hallard: a deco roman, as engraved on a coachbuilder's dials
  alfaslab: 'alfa-slab-one.woff2',   // Garrow: a heavy slab, stamped
  chakra: 'chakra-petch.woff2',   // Minim: a soft squared sans
};
const ROWS = 40;
const state = new Map();          // face -> 'loading' | 'ok' | 'fail'
const cache = new Map();          // face|str -> runs

// A browser with a real canvas and the font loading API, not the gates' DOM stub.
const live = () => typeof document !== 'undefined' && typeof document.createElement === 'function'
  && typeof FontFace === 'function' && !!document.fonts && typeof navigator === 'object'
  && !/node/i.test(String(navigator.userAgent || ''));

function ensure(face) {
  const file = FACES[face];
  if (!file) { state.set(face, 'fail'); return; }
  state.set(face, 'loading');
  try {
    const ff = new FontFace('gr-' + face, `url(${new URL('./fonts/' + file, import.meta.url).href})`);
    ff.load().then((f) => { document.fonts.add(f); state.set(face, 'ok'); }, () => state.set(face, 'fail'));
  } catch { state.set(face, 'fail'); }
}

let _cv = null;
export function glyphRuns(face, str) {
  str = String(str);
  if (!str.trim() || !live()) return null;
  const st = state.get(face);
  if (st !== 'ok') { if (!st) ensure(face); return null; }
  const key = face + '|' + str;
  if (cache.has(key)) return cache.get(key);
  let out = null;
  try {
    const cv = _cv || (_cv = document.createElement('canvas')), ctx = cv.getContext('2d', { willReadFrequently: true });
    // Size the font so an H is ROWS pixels tall.
    ctx.font = `${ROWS * 2}px "gr-${face}"`;
    const capAt2 = ctx.measureText('H').actualBoundingBoxAscent || ROWS * 1.4;
    const px = ROWS * 2 * ROWS / capAt2;
    ctx.font = `${px}px "gr-${face}"`;
    const m = ctx.measureText(str), cap = ctx.measureText('H').actualBoundingBoxAscent || ROWS;
    const pad = 4, asc = Math.ceil(m.actualBoundingBoxAscent || cap * 1.2), desc = Math.ceil(m.actualBoundingBoxDescent || cap * 0.3);
    const left = Math.ceil(m.actualBoundingBoxLeft || 0);
    const W = Math.ceil(Math.max(m.width, (m.actualBoundingBoxRight || 0) + left)) + pad * 2 + left, H = asc + desc + pad * 2;
    cv.width = W; cv.height = H;
    ctx.font = `${px}px "gr-${face}"`;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'alphabetic';
    const bx = pad + left, by = pad + asc;
    ctx.fillText(str, bx, by);
    const d = ctx.getImageData(0, 0, W, H).data;
    // Runs per row, merged down the rows while they repeat exactly.
    const rects = [];
    let open = new Map();
    for (let y = 0; y < H; y++) {
      const runs = [];
      for (let x = 0; x < W;) {
        if (d[(y * W + x) * 4 + 3] >= 128) { const x0 = x; while (x < W && d[(y * W + x) * 4 + 3] >= 128) x++; runs.push(x0 + ':' + x); } else x++;
      }
      const next = new Map();
      for (const r of runs) next.set(r, open.has(r) ? open.get(r) : y);
      for (const [r, y0] of open) if (!next.has(r)) { const [a, b] = r.split(':').map(Number); rects.push([a, y0, b, y]); }
      open = next;
    }
    for (const [r, y0] of open) { const [a, b] = r.split(':').map(Number); rects.push([a, y0, b, H]); }
    // Pixels to cap heights, y up from the baseline.
    const k = 1 / cap;
    out = { w: m.width * k, rects: rects.map(([x0, y0, x1, y1]) => [(x0 - bx) * k, (by - y1) * k, (x1 - bx) * k, (by - y0) * k]) };
  } catch { out = null; }
  cache.set(key, out);
  return out;
}
