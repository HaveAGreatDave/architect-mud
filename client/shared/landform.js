// LANDFORM — the shape of open country, as one deterministic function of the world coordinate.
//
// Two very different consumers read this and they must not disagree:
//
//  · the RENDERER shades the Mode-7 floor off it (windshield.js `groundElev`, and the same field
//    again in GLSL in gl/floor.js, because past the map window the shader synthesises its own
//    ground). That is a hillshade on a flat floor — a picture of relief, not relief.
//  · the VOID CORRIDOR places real raised tiles off it (plugins/trucking/corridor.js), which become
//    actual massifs with faces you drive around, through `flags.terrain` → `isHighCell` →
//    `drawCliffMass`.
//
// If those two ever drifted, the ground would be shaded as a basin and built as a mesa in the same
// place, which is worse than either on its own. So the field lives here once.
//
// ⚠ THE HASH IS THE SHADER'S INTEGER MIX, AND THAT IS FORCED RATHER THAN CHOSEN. windshield.js has
// two lattice noises differing only in their hash: `vnoise2` scatters through `frac` (a Math.sin),
// which needs a 64-bit mantissa to mean anything and so cannot survive GLSL highp. The relief is
// read on BOTH sides of the map-window edge — the LUT carries the near side and the shader
// synthesises the far side — so a relief the two disagree about hangs a ring of mismatched
// hillshade round the aircraft at the boundary. `Math.imul` is a 32-bit multiply and `>>> 0` is the
// unsigned read, so JS and GLSL walk identical arithmetic here.
//
// ⚠ AND gl/floor.js CARRIES A COPY BY NECESSITY — it is GLSL and cannot import a JS module. That
// copy is character-for-character and must stay so; there is no third copy, because windshield.js
// imports from here.

export function hn2h(a, b) {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h & 0xffff) / 65535;
}

export function hnoise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hn2h(xi, yi), b = hn2h(xi + 1, yi), c = hn2h(xi, yi + 1), d = hn2h(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Fractal Brownian motion: octaves of the lattice noise at doubling frequency and decaying
// amplitude.
//
// ⚠ NORMALISED, so `pers` changes the SPECTRUM and never the amplitude. Persistence is how much of
// each octave survives into the next — 0.5 is smooth rolling country, higher is broken ground — and
// without dividing by the series sum, turning it up would also make every hill taller and quietly
// retune the hillshade, the coast read and the far-field crossfade along with it.
// Returns ≈ ±0.5 whatever the octave count.
export function fbm2(x, y, oct, pers) {
  let amp = 0.5, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) { sum += (hnoise2(x * f, y * f) - 0.5) * amp; norm += amp; f *= 2; amp *= pers; }
  return sum / (norm * 2);
}

// ── THE COUNTRY ──────────────────────────────────────────────────────────────────────────────
//
// 0..1, where high is high ground. Deliberately a SEPARATE field from the renderer's `groundElev`
// rather than a threshold on it: that one is tuned to be a gentle wash under a hillshade — it has
// to look right everywhere, including under a city — and what places a mesa is a much slower,
// blockier question. Regions of high ground want to be tens of tiles across with long flanks, not
// wherever a rolling hill happens to crest.
//
// `LF_F` ≈ a 55-tile feature at the base octave; three octaves keeps the outline ragged without
// breaking the mass into speckle, which is what a fourth does at this threshold.
const LF_F = 0.018, LF_OCT = 3, LF_PERS = 0.5;
export function landformAt(x, y) {
  return 0.5 + fbm2(x * LF_F + 77.3, y * LF_F - 21.7, LF_OCT, LF_PERS);
}

// Is this tile high ground? A plain threshold on the field.
//
// ⚠ THE THRESHOLD IS THE WHOLE DENSITY CONTROL and it is deliberately high. `landformAt` is roughly
// symmetric about 0.5, so 0.5 would make half the world a plateau — which is not country with
// mesas in it, it is country with valleys cut into it, and from a cab the two look nothing alike.
export const LF_HIGH = 0.62;
export const isHigh = (x, y) => landformAt(x, y) >= LF_HIGH;

// Which of the two high terrains a tile is.
//
// ⚠ `plateau` IS THE TOP AND `cliff` IS THE RIM, and the split is derived from the neighbours rather
// than rolled: a tile whose four neighbours are all high is interior, and anything else is an edge.
// That is exactly the distinction `deriveSurfaceCell` then re-derives as `cf` (which sides the
// landform continues on) so the renderer can wall only the open sides and merge a painted blob into
// ONE massif with a continuous rim. Roll it per tile instead and you get walls through the middle of
// your own mesa.
//
// ⚠ And the two are not interchangeable underfoot: `plateau` is walkable and `cliff` is not. A
// breakdown out here finishes on foot, so a rim that is all cliff is a wall a stranded driver cannot
// cross — which is why the caller keeps the ground beside the road open rather than relying on this.
export function highTerrainAt(x, y) {
  if (!isHigh(x, y)) return null;
  const interior = isHigh(x + 1, y) && isHigh(x - 1, y) && isHigh(x, y + 1) && isHigh(x, y - 1);
  return interior ? 'plateau' : 'cliff';
}
