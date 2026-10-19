// glcluster: the light grid (gl/lightgrid.js) lists every light that reaches a point.
//
//   node scripts/shapes/glcluster.mjs
//
// The grid replaces the wet road's six uniform lights with every light in the frame, binned on the
// ground by footprint. A footprint that's too small doesn't look like a bug: it's a streak or a pool
// cut off at a cell edge, a hard seam on the road that moves as you drive. Nothing headless can draw
// the road, so this checks the binning against the shader's own terms instead:
//
//   1. the contract: the expressions the footprints were derived from (each term's shape and the
//      gain it's drawn at) are still the ones in ground.js. Change the shader and this fails until
//      `measure` in gl/lightgrid.js follows.
//   2. coverage: over random scenes, at every sample point where a light's streak, glint or pool is
//      above the cut-off (the terms ported below, at their gains), the point's cell lists that light.
//   3. structure: no duplicates, contiguous offsets, indices in range, strongest first, and the
//      per-cell cut keeping the strongest when it bites.
import { readFileSync } from 'node:fs';
import { LIGHTGRID_TUNE, makeGroundGrid, buildGroundGrid, cellOf, peakOf } from '../../client/game/js/panels/gl/lightgrid.js';
import { LIGHT_TUNE } from '../../client/game/js/panels/gl/world.js';

const problems = [];
const check = (cond, msg) => { if (!cond) problems.push(msg); };

// ── 1. the contract ──────────────────────────────────────────────────────────────────────────────
{
  const src = readFileSync('client/game/js/panels/gl/ground.js', 'utf8');
  const fn = (name) => {
    const at = src.indexOf(name + '(');
    if (at < 0) return '';
    const open = src.indexOf('{', at);
    let d = 0;
    for (let i = open; i < src.length; i++) {
      if (src[i] === '{') d++;
      else if (src[i] === '}' && --d === 0) return src.slice(open, i + 1).replace(/\/\/[^\n]*/g, '');
    }
    return '';
  };
  const wet = fn('void wetLight'), pool = fn('vec3 poolLight');
  check(wet.length > 0, 'ground.js has no wetLight function');
  check(pool.length > 0, 'ground.js has no poolLight function');
  const want = {
    wetLight: [wet, [
      'if (el < 0.001) return;',
      'float k = uEyeH / max(0.05, uEyeH + P.z);',
      'vec2 spec = uEye + toLight * (el * k);',
      'float len = clamp(el * 0.9, 0.8, 10.0);',
      'float a = along >= 0.0 ? along / len : along / (len * 0.45);',
      'float t = lat / (max(0.25, R * 0.25) * sw);',
      'add += C * (sk * exp(-a * a) * exp(-t * t));',
      'float glen = len * 0.45 * gw;',
      'float ga = along >= 0.0 ? along / glen : along / (glen * 0.45);',
      'float gt = lat / (max(0.10, R * 0.12) * gw);',
      'glint += C * (gk * exp(-ga * ga) * exp(-gt * gt));',
    ]],
    poolLight: [pool, [
      'float h = max(0.14, P.z);',
      'float r2 = dot(rel, rel) + h * h;',
      'float hs = min(1.0, (0.33 * 0.33) / (h * h));',
      'return C * (hs * ((h * h * h) / (r2 * sqrt(r2))));',
    ]],
    // The gains, which live in main() rather than in the two functions. Every factor besides uWet,
    // uGlint, uPool and the colour must stay at most 1 for the footprints to hold.
    main: [src, [
      'float smear = uWet * 0.02 * (1.0 - pud);',
      'c += add * (smear * 4.5 * refl) * max(vec3(0.0), 1.0 - c);',
      'float imgW = uWet * pud;',
      'vec3 gcol = glint * (imgW * uGlint * refl * (0.35 + 0.65 * spark));',
      'refl = 0.02 + 0.98 * pow(1.0 - cosI, 5.0);',
      'pud = smoothstep(level, level + band, hollow);',
      'return gp * gp * gp;',
      'c += pool * (uPool * clamp(uNight, 0.0, 1.0) * (1.0 - gfog)) * max(vec3(0.0), 1.0 - c);',
    ]],
  };
  for (const [name, [body, lines]] of Object.entries(want)) {
    for (const l of lines) check(body.includes(l), `${name} in ground.js no longer reads '${l}': update the footprint in gl/lightgrid.js, then this list`);
  }
}

// ── the shader's terms, ported, at their gains ───────────────────────────────────────────────────
const EPS = LIGHTGRID_TUNE.eps * 1.01;   // a hair of margin for the GPU's float against this double
function reaches(L, x, y, eye, terms) {
  const C = peakOf(L);
  if (terms.wet > 0) {
    let tx = L.p[0] - eye.x, ty = L.p[1] - eye.y;
    const el = Math.hypot(tx, ty);
    if (el >= 0.001) {
      tx /= el; ty /= el;
      const k = eye.h / Math.max(0.05, eye.h + L.p[2]);
      const rx = x - (eye.x + tx * el * k), ry = y - (eye.y + ty * el * k);
      const along = rx * tx + ry * ty, lat = rx * -ty + ry * tx;
      const len = Math.min(10, Math.max(0.8, el * 0.9));
      const a = along >= 0 ? along / len : along / (len * 0.45);
      const sw = terms.streakW > 0 ? terms.streakW : 1, sk = terms.streakK >= 0 ? terms.streakK : 1;
      const t = lat / (Math.max(0.25, L.r * 0.25) * sw);
      if (C * sk * 4.5 * 0.02 * terms.wet * Math.exp(-a * a) * Math.exp(-t * t) > EPS) return true;
      const gw = terms.glintW > 0 ? Math.min(2, terms.glintW) : 1, gk = terms.glintK >= 0 ? terms.glintK : 1;
      const glen = len * 0.45 * gw;
      const ga = along >= 0 ? along / glen : along / (glen * 0.45);
      const gt = lat / (Math.max(0.10, L.r * 0.12) * gw);
      if (C * gk * terms.glint * terms.wet * Math.exp(-ga * ga) * Math.exp(-gt * gt) > EPS) return true;
    }
  }
  if (terms.pool > 0) {
    const h = Math.max(0.14, L.p[2]);
    const r2 = (x - L.p[0]) ** 2 + (y - L.p[1]) ** 2 + h * h;
    const hs = Math.min(1, (0.33 * 0.33) / (h * h));
    if (C * terms.pool * hs * (h * h * h) / (r2 * Math.sqrt(r2)) > EPS) return true;
  }
  return false;
}

// ── scenes ───────────────────────────────────────────────────────────────────────────────────────
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// Colours as pickLights makes `rgbRaw`: the sprite colour times its alpha times LIGHT_TUNE.wet
// (0.45), so at most 0.45 a channel. `cmax` raises that for the stress scene.
function scene(seed, nLights, span, eyeH, cmax = 0.45) {
  const R = rng(seed);
  const x0 = -span / 2 + R() * 4, y0 = -span / 2 + R() * 4;
  const bounds = [x0, y0, x0 + span * (0.6 + 0.4 * R()), y0 + span * (0.6 + 0.4 * R())];
  const eye = { x: x0 + (bounds[2] - x0) * R(), y: y0 + (bounds[3] - y0) * R(), h: eyeH };
  const lights = [];
  for (let i = 0; i < nLights; i++) {
    const a = R();
    lights.push({ p: [bounds[0] - 6 + (bounds[2] - bounds[0] + 12) * R(), bounds[1] - 6 + (bounds[3] - bounds[1] + 12) * R(), R() < 0.2 ? R() * 0.3 : R() * 12],
      r: 0.8 + 3.2 * Math.sqrt(R()), rgbRaw: [R() * cmax * a, R() * cmax * a, R() * cmax * a], score: R() });
  }
  // The awkward ones: right over the eye, a hair off it, and a lamp on the ground.
  lights.push({ p: [eye.x, eye.y, 2], r: 2, rgbRaw: [cmax, cmax, cmax], score: 2 });
  lights.push({ p: [eye.x + 0.0015, eye.y - 0.0005, 0.5], r: 3, rgbRaw: [cmax, cmax / 2, 0.1], score: 2 });
  lights.push({ p: [eye.x + 3, eye.y + 4, 0], r: 0.8, rgbRaw: [0.05, cmax, 0.05], score: 2 });
  lights.sort((p, q) => q.score - p.score);
  return { bounds, eye, lights };
}

function listOf(g, ci) {
  const off = g.cell[ci * 2], n = g.cell[ci * 2 + 1];
  return g.index.subarray(off, off + n);
}

function structure(g, label) {
  let sum = 0, expectOff = 0;
  for (let ci = 0; ci < g.nx * g.ny; ci++) {
    const off = g.cell[ci * 2], n = g.cell[ci * 2 + 1];
    check(off === expectOff, `${label}: cell ${ci} starts at ${off}, expected ${expectOff}`);
    expectOff = off + n; sum += n;
    const l = listOf(g, ci);
    for (let k = 0; k < l.length; k++) {
      check(l[k] < g.n, `${label}: cell ${ci} lists light ${l[k]} of ${g.n}`);
      if (k) check(l[k] > l[k - 1], `${label}: cell ${ci} isn't strongest first, or lists a light twice (${l[k - 1]}, ${l[k]})`);
    }
  }
  check(sum === g.entries, `${label}: ${sum} entries in the cells, ${g.entries} counted`);
}

let samples = 0, hits = 0;
// Every point a light reaches is in a cell that lists it, unless that cell was cut and the light
// ranks below everything it kept.
function coverage(g, sc, terms, label) {
  const { bounds, eye, lights } = sc;
  const R = rng(7);
  const step = 0.45;
  const pts = [];
  for (let y = bounds[1]; y <= bounds[3]; y += step) for (let x = bounds[0]; x <= bounds[2]; x += step) pts.push([x + (R() - 0.5) * step, y + (R() - 0.5) * step]);
  // Points exactly on cell edges and corners, where an off-by-one in the binning shows first.
  for (let cy = 0; cy <= g.ny; cy++) for (let cx = 0; cx <= g.nx; cx += 3) pts.push([g.ox + cx * g.size, g.oy + cy * g.size]);
  let missed = 0;
  for (const [x, y] of pts) {
    const l = listOf(g, cellOf(g, x, y));
    const listed = new Set(l);
    const full = l.length >= LIGHTGRID_TUNE.perCell, last = l.length ? l[l.length - 1] : -1;
    samples++;
    for (let i = 0; i < g.n; i++) {
      if (!reaches(lights[i], x, y, eye, terms)) continue;
      hits++;
      if (listed.has(i) || (full && i > last)) continue;
      if (missed++ < 3) problems.push(`${label}: light ${i} at (${lights[i].p.map((v) => v.toFixed(2))}) reaches (${x.toFixed(2)}, ${y.toFixed(2)}) and that point's cell doesn't list it`);
    }
  }
  if (missed > 3) problems.push(`${label}: ...and ${missed - 3} more misses`);
}

const g = makeGroundGrid();
const WET = { wet: 1, glint: 8, pool: 0 }, NIGHT = { wet: 0, glint: 8, pool: 1.6 }, BOTH = { wet: 1, glint: 8, pool: 1.6 };
// The grid path's own streak factors (LIGHTGRID_TUNE.streakW, streakK): narrow and strong, the shape
// it was tuned to.
const NARROW = { ...BOTH, streakW: 0.3, streakK: 2.5, glintW: 0.5, glintK: 0.3 };
const WIDE = { ...BOTH, streakW: 1.5, glintW: 2, glintK: 1.5 };
const SCENES = [
  [1, 220, 34, 0.2],    // a cab in a lit street
  [2, 400, 70, 0.2],    // the densest night frame, a wide window
  [3, 120, 73, 18],     // an aircraft's window, high up
  [4, 300, 20, 0.6],    // a small, crowded window
  [5, 40, 90, 3],       // a sparse outpost
];
const report = [];
for (const [seed, n, span, eh] of SCENES) {
  const sc = scene(seed, n, span, eh);
  for (const [tag, terms] of [['wet night', BOTH], ['wet day', WET], ['dry night', NIGHT], ['wet night, narrow', NARROW], ['wet night, wide', WIDE]]) {
    const label = `scene ${seed} ${tag} (${n} lights, ${span} tiles, eye ${eh})`;
    buildGroundGrid(g, sc.lights, sc.bounds, sc.eye, terms);
    check(g.n === Math.min(sc.lights.length, LIGHTGRID_TUNE.maxLights), `${label}: ${g.n} lights in the table`);
    check(g.cut === 0, `${label}: the per-cell cut bit (${g.cut} dropped, longest list ${g.maxCell}); a realistic frame shouldn't reach it`);
    structure(g, label);
    coverage(g, sc, terms, label);
    if (tag === 'wet night') report.push(`${seed}: ${g.binned}/${g.n} binned, longest ${g.maxCell}, mean ${(g.entries / (g.nx * g.ny)).toFixed(1)}`);
  }
}

// A dry day: nothing live, nothing binned.
{
  const sc = scene(9, 50, 30, 0.2);
  buildGroundGrid(g, sc.lights, sc.bounds, sc.eye, { wet: 0, glint: 8, pool: 0 });
  check(g.entries === 0 && g.binned === 0, `with neither term live the grid still binned ${g.binned} lights, ${g.entries} entries`);
}

// The per-cell cut keeps the strongest, and coverage still holds above it.
{
  const keep = LIGHTGRID_TUNE.perCell;
  const sc = scene(11, 200, 24, 0.2, 1.2);
  LIGHTGRID_TUNE.perCell = 4;
  buildGroundGrid(g, sc.lights, sc.bounds, sc.eye, BOTH);
  check(g.cut > 0, 'a per-cell cut of 4 against 200 bright lights cut nothing');
  check(g.maxCell <= 4, `a cell kept ${g.maxCell} lights against a cut of 4`);
  structure(g, 'cut of 4');
  coverage(g, sc, BOTH, 'cut of 4');
  const cutCells = [];
  for (let ci = 0; ci < g.nx * g.ny; ci++) cutCells.push(Array.from(listOf(g, ci)));
  LIGHTGRID_TUNE.perCell = keep;
  buildGroundGrid(g, sc.lights, sc.bounds, sc.eye, BOTH);
  for (let ci = 0; ci < g.nx * g.ny; ci++) {
    const full = Array.from(listOf(g, ci)).slice(0, 4);
    if (full.join() !== cutCells[ci].join()) { problems.push(`cut of 4: cell ${ci} kept [${cutCells[ci]}], the strongest four are [${full}]`); break; }
  }
}

// Mass mode, the wall's grid: every light is a disc of the larger of its two reaches (massLight in
// context.js cuts both off hard), so any point nearer than that in x,y must be listed.
{
  const sc = scene(21, 300, 60, 0.2);
  const R = rng(5);
  for (const L of sc.lights) { L.rw = L.r * (0.2 + R() * 0.4); L.rl = R() < 0.2 ? 0 : L.r * 0.8; }
  buildGroundGrid(g, sc.lights, sc.bounds, sc.eye, { mass: true });
  structure(g, 'mass');
  check(g.cut === 0, `mass: the per-cell cut bit (${g.cut})`);
  let missed = 0, pairs = 0;
  for (let y = sc.bounds[1] - 3; y <= sc.bounds[3] + 3; y += 0.37) for (let x = sc.bounds[0] - 3; x <= sc.bounds[2] + 3; x += 0.37) {
    const listed = new Set(listOf(g, cellOf(g, x, y)));
    for (let i = 0; i < g.n; i++) {
      const L = sc.lights[i], reach = Math.max(L.rw, L.rl);
      if (Math.hypot(x - L.p[0], y - L.p[1]) >= reach) continue;
      pairs++; hits++;
      if (!listed.has(i) && missed++ < 3) problems.push(`mass: light ${i} reaches (${x.toFixed(2)}, ${y.toFixed(2)}) and that point's cell doesn't list it`);
    }
  }
  check(pairs > 1000, `mass: only ${pairs} pairs sampled`);
  if (missed > 3) problems.push(`mass: ...and ${missed - 3} more misses`);
}

check(hits > 10000,`only ${hits} light-reaches-point pairs were sampled; the scenes are too sparse to test anything`);

if (problems.length) {
  console.error(`✗ gl:cluster: ${problems.length} problem(s)`);
  for (const p of problems.slice(0, 40)) console.error('  ' + p);
  console.error('  per scene, wet night: ' + report.join('; '));
  process.exit(1);
}
if (process.argv.includes('--verbose')) console.log('  per scene, wet night: ' + report.join('; '));
console.log(`✓ gl:cluster: ${SCENES.length} scenes x 5 weathers, ${samples} sample points, ${hits} light-reaches-point pairs, every one listed in its cell.`);
