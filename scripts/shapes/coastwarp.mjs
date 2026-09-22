// THE COAST WARP, CHECKED — two claims that are silent when wrong, and one of them shipped wrong.
//
// `RENDER_TUNE.coastWarp` domain-warps the ground sampling position so a coast meanders off the
// square tile grid instead of poking out as hard 90° corners. It does that by displacing the point
// the LUT is read at, which is a map of the plane onto itself — and a map of the plane onto itself
// has to be INJECTIVE or it is not a warp, it is a fold.
//
// ⚠ IT FOLDED. It was one sine per axis at amplitude 0.9 tiles and frequency 1.9 rad/tile, and
// the Jacobian determinant of that pair bottoms out at -2.13: at every antinode the map turns the
// plane inside out over a lens about a tile across. What a fold draws is a CUSP, so the warp was
// putting a row of sharp corners on the coast at the sine's own 3.3-tile period — sharper corners,
// at a higher frequency, than the tile quantisation it exists to soften. It read as a sawtooth on
// every shoreline in the game, and south of Coldwater the river came out as a zigzag with the pond
// on the end of it rendered as a starburst.
//
// That is invisible to every other gate in this repo. It is not a crash, not a NaN, not a dropped
// uniform, not a geometry mismatch — it is a correct shader drawing a wrong shape, and the only
// thing that can say so is the arithmetic. So:
//
//   1. THE WARP NEVER FOLDS at the shipping amplitude, at any phase.
//   2. THE TWO RENDERERS AGREE TERM FOR TERM. gl/floor.js and windshield.js each hold their own
//      copy of the expression — the shader cannot import the raster's and the raster cannot read
//      GLSL — so the coefficients are two facts stating one thing, and the drift is a coast that
//      meanders differently depending on which renderer drew it.
//
// ⚠ THE COEFFICIENTS ARE READ OUT OF THE SOURCE, NOT RESTATED HERE. A gate carrying its own copy
// of the numbers is a THIRD place they have to agree, and it passes green while the two it is
// guarding disagree with it in the same direction.
import { readFileSync } from 'node:fs';
import { blank } from '../lib/blank-scanner.mjs';

const GL = 'client/game/js/panels/gl/floor.js';
const RASTER = 'client/game/js/panels/windshield.js';

// One octave of the warp, as both files spell it: weight, the frequency on the CROSS axis, and the
// frequency on the point's OWN axis. `nx = wx + amp * Σ w·sin(awy·fa + awx·fb)`.
const OCTAVE = /([\d.]+)\s*\*\s*(?:Math\.)?sin\(\s*aw([xy])\s*\*\s*([\d.]+)\s*[-+]\s*aw([xy])\s*\*\s*([\d.]+)/g;

// ⚠ THE SHADER CANNOT GO THROUGH `blank()`. It lives in a JS template literal, and blanking
// template literals is exactly what that scanner is for — the whole shader comes back as spaces.
// GLSL only has the two comment forms, so strip those and nothing else.
const stripGlslComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, '');

// The `nx = …` line of each file's warp. Both spell the x displacement off `awy` first.
function octavesOf(path, glsl = false) {
  const raw = readFileSync(path, 'utf8');
  const src = glsl ? stripGlslComments(raw) : blank(raw);
  const at = src.indexOf('nx = wx +');
  if (at < 0) throw new Error(`coastwarp: no 'nx = wx +' warp in ${path}`);
  if (src.indexOf('nx = wx +', at + 1) >= 0) {
    throw new Error(`coastwarp: more than one 'nx = wx +' warp in ${path} — this gate reads the `
      + 'first, so a second one would go unchecked');
  }
  const line = src.slice(at, src.indexOf('\n', at));
  const out = [];
  for (const m of line.matchAll(OCTAVE)) out.push({ w: +m[1], fa: +m[3], fb: +m[5] });
  if (!out.length) {
    // A single un-weighted octave — `sin(awy * 1.9 + awx * 0.5)` with no coefficient in front.
    const one = /(?:Math\.)?sin\(\s*aw[xy]\s*\*\s*([\d.]+)\s*[-+]\s*aw[xy]\s*\*\s*([\d.]+)/.exec(line);
    if (one) out.push({ w: 1, fa: +one[1], fb: +one[2] });
  }
  if (!out.length) throw new Error(`coastwarp: could not read any octave out of ${path}`);
  return out;
}

// The shipping amplitude, off the tunable rather than off a number written here.
function shippingAmp() {
  const src = blank(readFileSync(RASTER, 'utf8'));
  const m = /coastWarp:\s*([\d.]+)/.exec(src);
  if (!m) throw new Error('coastwarp: no RENDER_TUNE.coastWarp in windshield.js');
  return +m[1];
}

// Min determinant of ∂(nx,ny)/∂(x,y) over a patch wide enough to visit every phase of every
// octave. Positive everywhere ⇒ the warp is a warp; anywhere ≤ 0 ⇒ it folds the plane there.
function minJacobian(amp, oct, step = 0.04, span = 40) {
  let worst = Infinity, at = null;
  for (let x = 0; x < span; x += step) {
    for (let y = 0; y < span; y += step) {
      let dnxdx = 1, dnxdy = 0, dnydx = 0, dnydy = 1;
      for (const { w, fa, fb } of oct) {
        const c1 = Math.cos(y * fa + x * fb);          // nx displaced by sin(awy·fa + awx·fb)
        const c2 = Math.cos(x * fa - y * fb + 2.1);    // ny is the same wave with the axes swapped
        dnxdx += amp * w * fb * c1; dnxdy += amp * w * fa * c1;
        dnydx += amp * w * fa * c2; dnydy += -amp * w * fb * c2;
      }
      const det = dnxdx * dnydy - dnxdy * dnydx;
      if (det < worst) { worst = det; at = [x.toFixed(2), y.toFixed(2)]; }
    }
  }
  return { worst, at };
}

const report = process.argv.includes('--report');
const amp = shippingAmp();
const gl = octavesOf(GL, true);
const raster = octavesOf(RASTER);
const fails = [];

// 1 — the two copies are one expression.
const key = (o) => o.map(({ w, fa, fb }) => `${w}·sin(${fa},${fb})`).join(' + ');
if (key(gl) !== key(raster)) {
  fails.push('  the two renderers hold different coast warps, so the same coastline meanders '
    + 'differently depending on which one drew it:\n'
    + `    ${GL}\n      ${key(gl)}\n    ${RASTER}\n      ${key(raster)}`);
}

// 2 — it does not fold.
const { worst, at } = minJacobian(amp, gl);
if (worst <= 0) {
  fails.push(`  the warp FOLDS at amplitude ${amp}: min Jacobian determinant ${worst.toFixed(3)} at `
    + `(${at[0]}, ${at[1]}). A folded domain warp draws cusps, not a meander — it puts sharper `
    + 'corners on the coast than the tile grid it exists to soften. Keep amplitude × frequency '
    + 'under 1 per octave: carry the throw on a slow octave and the raggedness on a fast one.');
}

if (report) {
  const tot = gl.reduce((s, o) => s + o.w * amp, 0);
  console.log(`coast warp — amplitude ${amp} tiles over ${gl.length} octave(s):`);
  for (const { w, fa, fb } of gl) {
    console.log(`  w ${w.toFixed(2)}  freq ${fa} rad/tile (${(2 * Math.PI / fa).toFixed(1)}-tile `
      + `wavelength)  cross ${fb}  →  amp×freq ${(amp * w * fa).toFixed(3)}`);
  }
  console.log(`  peak displacement ${tot.toFixed(2)} tiles, min Jacobian determinant ${worst.toFixed(3)}`);
}

if (fails.length) {
  console.error(`✗ coastwarp — ${fails.length} problem(s):`);
  for (const f of fails) console.error(f);
  process.exit(1);
}
console.log(`✓ coastwarp: ${gl.length} octave(s) at amplitude ${amp}, identical in both renderers, `
  + `min Jacobian determinant ${worst.toFixed(3)} (> 0, so it never folds)`);
