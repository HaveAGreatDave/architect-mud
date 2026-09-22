// THE SEA'S SHAPE, CHECKED — three copies of one surface, and a derivative nothing else can see.
//
//   node scripts/shapes/sea.mjs        (npm run gl:sea)
//
// The water is shaded by two renderers, DISPLACED by a third shader, and ridden by a hull, and all
// of them have to agree about where a crest is. `client/shared/sea-swell.js` is the one JS copy;
// `gl/sea-glsl.js` is its hand-written GLSL twin, included by both `gl/floor.js` (which shades the
// sea) and `gl/water.js` (which displaces it); `windshield.js` holds the raster's own literal
// spelling. That is three statements of one fact, and this is the gate that stops them drifting —
// exactly the arrangement `coastwarp.mjs` guards for the coast.
//
// Four claims, each of which is silent when wrong:
//
//   1. THE THREE COPIES AGREE TERM FOR TERM. A drift here is a sea whose crests are in different
//      places depending on which renderer drew it — and, now that a mesh displaces the same
//      surface the floor paints, a mesh standing a few centimetres off the sea under it. A seam.
//
//   2. THE ANALYTIC SLOPE IS ACTUALLY THE SLOPE. The normal is the closed-form derivative of the
//      sine trains, which is the only reason lighting the sea is affordable at all. ⚠ THE FAILURE
//      MODE IS A SIGN. Recover a cosine as sqrt(1 - sin²), or get one chain-rule term's sign
//      wrong, and the highlight sits on the wrong face of every crest — which still looks exactly
//      like water. No screenshot settles it and no pixel bench can see it; the arithmetic can.
//
//   3. THE SHADER'S PRE-MULTIPLIED DERIVATIVE CONSTANTS ARE THE RIGHT ONES. GLSL cannot loop over
//      a table, so the twin spells the chain-rule products out as literals — 0.960, 0.660, 0.420
//      on x and 0.720, 0.495, 0.315 on y. Those are `pm * SEA_PH.ku` and `pm * SEA_PH.kv`, so they
//      are DERIVED here from the shared table rather than restated.
//
//   4. THE MESH DISPLACES THE ROLL AND NOT THE CHOP. The chop's wavelengths are ~1 tile, far finer
//      than any affordable vertex grid, so a mesh that displaced it would alias into noise and a
//      hull riding it would be fitted to noise. That split is the whole reason the feature is
//      affordable and it is one line in the vertex shader.
//
// ⚠ THE COEFFICIENTS ARE READ OUT OF THE SOURCES, NOT WRITTEN DOWN HERE. See coastwarp.mjs's note
// on the same point: a gate that restates them passes green while the files it guards disagree
// with it in the same direction.
//
// Arithmetic only: no GPU, no DOM, no network.
import { readFileSync } from 'node:fs';
import { blank } from '../lib/blank-scanner.mjs';
import {
  SEA_TRAINS, SEA_PH, SEA_ROLL, SEA_WIND, SEA_AMP,
  SEA_SWELL_SIDE, SEA_WIND_SIDE, SEA_SWELL_PEAK, SEA_WIND_PEAK, SEA_SPREAD,
  seaChop, seaHeight, seaSlope, seaAmpsFor, whitecapFraction, seaFoamThreshold, seaSubmersion, seaFoamTear, seaFoamFine, SEA_FOAM_TEAR,
} from '../../client/shared/sea-swell.js';

const GLSL = 'client/game/js/panels/gl/sea-glsl.js';
const RASTER = 'client/game/js/panels/windshield.js';
const WATER = 'client/game/js/panels/gl/water.js';
const FLOOR = 'client/game/js/panels/gl/floor.js';
const SHARED = 'client/shared/sea-swell.js';

const fail = [];
const ok = [];
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };

const glslSrc = read(GLSL);
const rasterSrc = read(RASTER);
if (!glslSrc) fail.push(`${GLSL} is missing — the GLSL twin of the swell`);

// ── 1. THE COPIES ─────────────────────────────────────────────────────────────────────────────
//
// ⚠ NEITHER SOURCE GOES THROUGH `blank()`. The GLSL lives in a JS template literal, which is
// exactly what that scanner blanks, and the raster's expression is ordinary code sitting among
// prose full of the same numbers. Both are matched on the SHAPE of the expression — a sine whose
// argument names the two axis variables — which no comment in either file happens to contain.
//
// The two files spell one train three different ways (`x * ku + y * kv`, `(x - y) * k` and
// `(x + y) * k`), so the parse normalises all three into a (ku, kv) pair.
function trainsIn(src, X, Y, T, sinFn) {
  const e = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const x = e(X), y = e(Y), t = e(T), sn = e(sinFn);
  const re = new RegExp(
    String.raw`([\d.]+)\s*\*\s*${sn}\(\s*` +
    String.raw`(?:${x}\s*\*\s*(-?[\d.]+)\s*([-+])\s*${y}\s*\*\s*(-?[\d.]+)` +
    String.raw`|\(\s*${x}\s*([-+])\s*${y}\s*\)\s*\*\s*(-?[\d.]+))` +
    String.raw`\s*([-+])\s*${t}\s*\*\s*([\d.]+)` +
    String.raw`\s*\+\s*ph\s*\*\s*([\d.]+)`,
    'g');
  const out = [];
  for (const m of src.matchAll(re)) {
    let ku, kv;
    if (m[2] !== undefined) { ku = +m[2]; kv = (m[3] === '-' ? -1 : 1) * +m[4]; }
    else { ku = +m[6]; kv = (m[5] === '-' ? -1 : 1) * +m[6]; }
    out.push({ a: +m[1], ku, kv, w: (m[7] === '-' ? -1 : 1) * +m[8], pm: +m[9] });
  }
  return out;
}

function phIn(src, X, Y, T, sinFn) {
  const e = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    String.raw`${e(sinFn)}\(\s*${e(X)}\s*\*\s*([\d.]+)\s*([-+])\s*${e(Y)}\s*\*\s*([\d.]+)\s*\+\s*` +
    `${e(T)}` + String.raw`\s*\*\s*([\d.]+)`);
  const m = src.match(re);
  return m ? { ku: +m[1], kv: (m[2] === '-' ? -1 : 1) * +m[3], w: +m[4] } : null;
}

const COPIES = [
  ['gl/sea-glsl.js', glslSrc, 'p.x', 'p.y', 't', 'sin'],
  ['windshield.js', rasterSrc, 'swx', 'swy', 't', 'Math.sin'],
];
for (const [label, src, X, Y, T, S] of COPIES) {
  if (!src) continue;
  const found = trainsIn(src, X, Y, T, S);
  if (found.length !== SEA_TRAINS.length) {
    fail.push(`${label}: found ${found.length} chop trains, ${SHARED} declares ${SEA_TRAINS.length}`);
    continue;
  }
  let bad = 0;
  found.forEach((f, i) => {
    const T2 = SEA_TRAINS[i];
    for (const k of ['a', 'ku', 'kv', 'w', 'pm']) {
      if (!near(f[k], T2[k])) { fail.push(`${label}: train ${i} ${k} is ${f[k]}, ${SHARED} says ${T2[k]}`); bad++; }
    }
  });
  if (!bad) ok.push(`${label}: all ${found.length} chop trains match ${SHARED}`);

  const ph = phIn(src, X, Y, T, S);
  if (!ph) fail.push(`${label}: could not find the shared phase term 'ph'`);
  else if (!near(ph.ku, SEA_PH.ku) || !near(ph.kv, SEA_PH.kv) || !near(ph.w, SEA_PH.w)) {
    fail.push(`${label}: ph is (${ph.ku}, ${ph.kv}, ${ph.w}), ${SHARED} says (${SEA_PH.ku}, ${SEA_PH.kv}, ${SEA_PH.w})`);
  } else ok.push(`${label}: the phase-modulation term matches`);
}

// The long roll and the wind sea, read out of the GLSL the shaders are actually GIVEN.
//
// ⚠ THIS READS THE EMITTED STRING, NOT THE SOURCE FILE, and that is the point of the sidebands
// being generated. The peak trains are still hand-written twins and still need holding to the
// original; their band is interpolated straight out of 'client/shared/sea-swell.js' and cannot
// drift at all, so the check that matters for it is that the numbers REACH the shader — which a
// regex over the source cannot see, because in the source they are an interpolation.
{
  const { SEA_GLSL } = await import('../../client/game/js/panels/gl/sea-glsl.js');
  // ⚠ THE PEAK'S OWN LINE NOW CARRIES A `sh` FACTOR AND A `sp` ARGUMENT, and the wavenumber is
  // followed by ` * sh` rather than by a comma — so this reads the number and deliberately stops
  // before the factor. A regex that demanded the old shape reports "could not find the roll train",
  // which reads as the train having been deleted rather than as the gate being out of date.
  const m = SEA_GLSL.match(/float seaRoll\(vec2 p, float t, float A, float sp\) \{[\s\S]*?float h = seaStokes\(p\.x \* ([\d.]+) \+ p\.y \* ([\d.]+) \+ t \* ([\d.]+), ([\d.]+)/);
  if (!m) fail.push('gl/sea-glsl.js: could not find the long roll train (seaRoll)');
  else if (!near(+m[1], SEA_ROLL.ku) || !near(+m[2], SEA_ROLL.kv) || !near(+m[3], SEA_ROLL.w)) {
    fail.push(`gl/sea-glsl.js: roll is (${m[1]}, ${m[2]}, ${m[3]}), ${SHARED} says (${SEA_ROLL.ku}, ${SEA_ROLL.kv}, ${SEA_ROLL.w})`);
  } else if (!near(+m[4], SEA_ROLL.k, 1e-4)) {
    // ⚠ THE WAVENUMBER MAGNITUDE IS WHAT THE STOKES TERM IS SCALED BY, so a wrong one here does not
    // move a crest — it changes how SHARP every crest is, by a factor nobody would think to check.
    fail.push(`gl/sea-glsl.js: the roll's Stokes wavenumber is ${m[4]}, ${SHARED} says ${SEA_ROLL.k}`);
  } else ok.push('gl/sea-glsl.js: the long roll train matches ' + SHARED + ', Stokes term included');

  const mw = SEA_GLSL.match(/float seaWind\(vec2 p, float t, float ph, float A, float sp\) \{[\s\S]*?float h = seaStokes\([^,]*, ([\d.]+)/);
  if (!mw) fail.push('gl/sea-glsl.js: could not find the wind sea (seaWind)');
  else if (!near(+mw[1], SEA_WIND.k, 1e-4)) {
    fail.push(`gl/sea-glsl.js: the wind sea's Stokes wavenumber is ${mw[1]}, ${SHARED} says ${SEA_WIND.k}`);
  } else ok.push("gl/sea-glsl.js: the wind sea's Stokes wavenumber matches " + SHARED);

  // ⚠ AND EVERY SIDEBAND HAS TO REACH THE SHADER. Generated or not, the failure mode is the same as
  // every other one in this file: a band that is computed, exported, gated and then not emitted is
  // a spectral sea that renders as the single train it was before, with nothing to say so.
  // ⚠ PER FUNCTION, NOT OVER THE WHOLE STRING. The slope generator emits the same sidebands as the
  // height generator, so a band dropped from `seaRoll` is still found in `seaSlope` and a check
  // over the file passes — mutation-tested: deleting a sideband from the height left this green.
  // A surface displaced by two trains and lit as though it had three is the exact class of bug the
  // analytic-slope check exists for, and it would slip past that too, because both are self-
  // consistent about a surface neither of them draws.
  const fnBody = (name) => {
    // ⚠ seaSlope RETURNS vec2, so a lookup that assumes 'float' finds nothing and reports every
    // sideband as missing from a function it never looked at.
    const i = Math.max(SEA_GLSL.indexOf('float ' + name + '('), SEA_GLSL.indexOf('vec2 ' + name + '('));
    if (i < 0) return '';
    const j = SEA_GLSL.indexOf('\n}', i);
    return SEA_GLSL.slice(i, j < 0 ? undefined : j);
  };
  for (const [name, band, fn] of [['swell', SEA_SWELL_SIDE, 'seaRoll'], ['wind', SEA_WIND_SIDE, 'seaWind']]) {
    const body = fnBody(fn), slope = fnBody('seaSlope');
    const miss = band.filter((T) => !body.includes('t * ' + T.w.toFixed(6)));
    const missS = band.filter((T) => !slope.includes('t * ' + T.w.toFixed(6)));
    if (miss.length) fail.push(`gl/sea-glsl.js: ${miss.length} of the ${name} band's sidebands never reach ${fn} — the surface is displaced by fewer trains than it is lit for`);
    else if (missS.length) fail.push(`gl/sea-glsl.js: ${missS.length} of the ${name} band's sidebands never reach seaSlope — the lighting describes a surface the mesh does not draw`);
    else ok.push(`gl/sea-glsl.js: all ${band.length} ${name} sidebands reach both ${fn} and seaSlope`);
  }
  // And the peak gives up exactly what the band takes, in the shader as well as in the JS — the one
  // number that keeps the total amplitude, and therefore the steepness, the same at every spread.
  for (const [name, peak] of [['swell', SEA_SWELL_PEAK], ['wind', SEA_WIND_PEAK]]) {
    if (!SEA_GLSL.includes('(1.0 - ' + (1 - peak).toFixed(6) + ' * sp)')) {
      fail.push(`gl/sea-glsl.js: the ${name} peak does not give up its band's share — the sea grows with the spread`);
    } else ok.push(`gl/sea-glsl.js: the ${name} peak gives up exactly its band's share`);
  }
}

// ── 2. THE DERIVATIVE LITERALS, DERIVED ───────────────────────────────────────────────────────
//
// `x` gets `ku + pm*PH.ku*cA` per train and `y` gets `kv + pm*PH.kv*cA`. PH.kv is negative, so
// every y-side product is SUBTRACTED in the shader's spelling — which is the sign this exists to
// pin, since getting it wrong still draws water.
if (glslSrc) {
  const body = glslSrc.match(/vec2 seaSlope\([^)]*\) \{[\s\S]*?\n\}/);
  if (!body) fail.push('gl/sea-glsl.js: could not find seaSlope');
  else {
    const rows = body[0].split('\n').filter((l) => /\* amp \+ cR \*/.test(l));
    if (rows.length !== 2) fail.push(`gl/sea-glsl.js: seaSlope has ${rows.length} derivative rows, expected 2`);
    else {
      ['ku', 'kv'].forEach((key, r) => {
        const terms = [...rows[r].matchAll(/\(\s*(-?[\d.]+)\s*([-+])\s*([\d.]+)\s*\*\s*cA\s*\)/g)];
        // The three chop trains, then the WIND sea, which is phase-modulated by the same `ph` and
        // therefore spells its chain rule the same way.
        const want = [...SEA_TRAINS, SEA_WIND];
        if (terms.length !== want.length) {
          fail.push(`gl/sea-glsl.js: seaSlope row ${r} has ${terms.length} chain-rule terms, expected ${want.length} (${SEA_TRAINS.length} chop + the wind sea)`);
          return;
        }
        let bad = 0;
        terms.forEach((m, i) => {
          const Tn = want[i];
          const gotK = +m[1], gotProd = (m[2] === '-' ? -1 : 1) * +m[3];
          if (!near(gotK, Tn[key], 1e-6)) { fail.push(`gl/sea-glsl.js: seaSlope row ${r} term ${i} wavenumber is ${gotK}, expected ${Tn[key]}`); bad++; }
          if (!near(gotProd, Tn.pm * SEA_PH[key], 1e-6)) {
            fail.push(`gl/sea-glsl.js: seaSlope row ${r} term ${i} chain product is ${gotProd}, expected pm*PH.${key} = ${Tn.pm * SEA_PH[key]}`);
            bad++;
          }
        });
        // And the roll's own wavenumber, riding outside the amp bracket as `cR * k`.
        const rollK = rows[r].match(/cR\s*\*\s*([\d.]+)/);
        const wantRoll = key === 'ku' ? SEA_ROLL.ku : SEA_ROLL.kv;
        if (!rollK || !near(+rollK[1], wantRoll)) {
          fail.push(`gl/sea-glsl.js: seaSlope row ${r} roll term is ${rollK && rollK[1]}, expected ${wantRoll}`); bad++;
        }
        if (!bad) ok.push(`gl/sea-glsl.js: seaSlope row ${r} constants are exactly pm*PH.${key}, with the roll's own wavenumber`);
      });
    }
  }
}

// ── 3. THE SLOPE IS THE SLOPE ─────────────────────────────────────────────────────────────────
//
// Central difference against the closed form, with the roll ON — a roll of zero would hide a sign
// error in the roll's own two terms, which is half of what claim 2 just pinned.
{
  const H = 1e-5, ROLL = 0.03;
  let worst = 0, at = null;
  for (let i = 0; i < 4000; i++) {
    const u = ((i * 0.37) % 40) - 20, v = ((i * 0.911) % 40) - 20, t = (i * 0.137) % 180;
    const gx = (seaHeight(u + H, v, t, ROLL) - seaHeight(u - H, v, t, ROLL)) / (2 * H);
    const gy = (seaHeight(u, v + H, t, ROLL) - seaHeight(u, v - H, t, ROLL)) / (2 * H);
    const [du, dv] = seaSlope(u, v, t, ROLL);
    const e = Math.max(Math.abs(gx - du), Math.abs(gy - dv));
    if (e > worst) { worst = e; at = [u.toFixed(2), v.toFixed(2), t.toFixed(2)]; }
  }
  if (worst > 1e-6) fail.push(`seaSlope disagrees with a central difference by ${worst.toExponential(2)} at (${at})`);
  else ok.push(`seaSlope matches a central difference over 4000 samples (worst ${worst.toExponential(2)})`);
}

// ── 4. THE ROLL IS STRICTLY ADDITIVE ──────────────────────────────────────────────────────────
//
// `seaChop` is what the whitecap thresholds are tested against, and they are ABSOLUTE numbers. So
// the chop must not pick up the roll: a heavy swell that raised `wv` would foam a calm surface.
{
  let worst = 0;
  for (let i = 0; i < 1500; i++) {
    const u = ((i * 0.53) % 30) - 15, v = ((i * 0.29) % 30) - 15, t = (i * 0.21) % 90;
    worst = Math.max(worst, Math.abs(seaHeight(u, v, t, 0, 1) - seaChop(u, v, t)));
  }
  if (worst > 1e-12) fail.push(`seaHeight at roll 0, amp 1 is not seaChop (worst ${worst.toExponential(2)})`);
  else ok.push('the roll is strictly additive — the whitecap thresholds still see the chop alone');
}

// ── 5. THE MESH DISPLACES THE ROLL, NEVER THE CHOP ────────────────────────────────────────────
//
// ⚠ THIS IS THE CLAIM THE WHOLE FEATURE'S COST RESTS ON. A vertex grid fine enough to carry a
// 0.6-tile wave is roughly sixty times the vertices of one that carries an 8.6-tile swell, and it
// would still alias — and a hull fitted to 1-tile chop is a hull fitted to noise. The vertex
// shader must call `seaRoll` and must NOT call `seaChop`, whose place is the fragment shader.
{
  const src = read(WATER);
  if (!src) fail.push(`${WATER} is missing — the displaced water mesh`);
  else {
    const vert = src.match(/const VERT = `[\s\S]*?`;/);
    if (!vert) fail.push('gl/water.js: could not find its vertex shader');
    else {
      const v = vert[0];
      // ⚠ THE RULE NARROWED RATHER THAN WENT AWAY, and the distinction is the whole point. It used
      // to be that the vertex shader must NEVER call `seaChop`: carrying a 0.6-tile wave across the
      // whole patch is sixty times the vertices the swell needs and would still alias. That is
      // still true of the WHOLE patch and is why this is not simply allowed now — what is permitted
      // is the chop displaced over a few tiles at the eye and FADED OUT, which section 20 checks
      // separately along with the grid density that has to carry it. An untapered `seaChop` in the
      // vertex shader is the original bug and still fails here.
      if (!/seaRoll\s*\(/.test(v)) fail.push('gl/water.js: the vertex shader does not displace by seaRoll');
      else if (/seaChop\s*\(/.test(v) && !/chopF/.test(v)) fail.push('gl/water.js: the vertex shader displaces by seaChop with no near-field taper — the chop is ~1 tile and past a few tiles belongs in the fragment shader');
      else ok.push('gl/water.js: the mesh displaces the roll and leaves the chop to shading');
    }
    // And it must take its arithmetic from the shared string rather than growing a fourth copy.
    if (!/SEA_GLSL/.test(src)) fail.push('gl/water.js: does not include gl/sea-glsl.js');
    else ok.push('gl/water.js: includes the shared GLSL twin');
  }
  const fl = read(FLOOR);
  if (fl && !/SEA_GLSL/.test(fl)) fail.push('gl/floor.js: no longer includes gl/sea-glsl.js — it has grown its own copy again');
  else if (fl) ok.push('gl/floor.js: includes the shared GLSL twin');
}

// ── 6. THE RASTER READS THE SHARED MODULE, RATHER THAN A FOURTH COPY ──────────────────────────
//
// ⚠ THE RASTER'S WATER CANNOT BE EXECUTED HERE, AND A CHECK THAT PRETENDS OTHERWISE IS WORSE THAN
// NO CHECK. The obvious version — paint a water map through `paintWindshield` with `glFloor` 0 and
// assert it does not throw — was written, passed, and was then MUTATION-TESTED by injecting a
// `throw` into the lit block. It still passed. Instrumenting the loop said why: under the DOM stub
// `drawMode7Floor` reaches its per-texel body ZERO times, so the whole thing was green on code it
// never ran. It is left out rather than left in with a caveat, because a vacuous green is exactly
// the false assurance this file exists to refuse. No harness in this repo reaches a GL draw call
// either, so the GPU twins cannot stand in for it; the instrument for all three is `__glSea()` in
// the Modelshop.
if (rasterSrc) {
  const lit = rasterSrc.match(/if \(RENDER_TUNE\.glSeaLit > [\d.]+ && detail > [\d.]+\) \{[\s\S]*?\n {8}\}/);
  if (!lit) fail.push('windshield.js: could not find the raster lit-water block');
  else {
    const body = lit[0];
    let bad = 0;
    for (const [needle, what] of [
      ['seaSlope(', 'calls the shared slope rather than spelling out a derivative'],
      ['SEA_NOW.roll', 'reads the LIVE roll amplitude rather than the tune ceiling'],
      ['RENDER_TUNE.glSeaAmp', 'reads the chop amplitude from the tune'],
    ]) {
      if (!body.includes(needle)) { fail.push(`windshield.js: the lit block no longer ${what}`); bad++; }
    }
    if (/\bMath\.cos\([^)]*5\.6/.test(body)) { fail.push('windshield.js: the lit block has grown its own derivative'); bad++; }
    if (!bad) ok.push('windshield.js: the lit block reads the shared slope and the tune, with no derivative of its own');
  }
}

// ── 7. THE DECK HAS ONE HEIGHT, AND IT IS A FUNCTION ──────────────────────────────────────────
//
// ⚠ THIS IS THE ONE THAT BREAKS A HELICOPTER. The Echelon's helipad floor used to be a CONSTANT
// written down in two files — `YACHT_DECK_Z` in windshield.js and `DECK_PAD_Z` in cockpit.js,
// which even restated YACHT_H as a literal 1.7 — and two copies of one number is fine right up
// until the number starts moving. Now she heaves, so where her deck is is a question with a clock
// in it, and a lander reading a stale constant sets its gear down where the deck WAS: intermittent,
// invisible in a screenshot, and only at some phases of the swell.
{
  const wsSrc = read(RASTER);
  const cockpit = read('client/game/js/panels/cockpit.js');
  if (!wsSrc || !cockpit) fail.push('could not read windshield.js or cockpit.js for the deck check');
  else {
    if (!/export function yachtPadZ/.test(wsSrc)) fail.push('windshield.js: yachtPadZ is not exported — the deck height has no single source');
    else if (!/yachtRide\(/.test(wsSrc)) fail.push('windshield.js: yachtPadZ does not go through yachtRide');
    else ok.push('windshield.js: the deck height is a function of the swell, exported once');
    // cockpit.js must ASK, never restate.
    if (/const DECK_PAD_Z\s*=/.test(cockpit)) fail.push('cockpit.js: DECK_PAD_Z is back — a second, stale copy of the deck height');
    else if (!/yachtPadZ\(/.test(cockpit)) fail.push('cockpit.js: the deck landing no longer asks yachtPadZ where the pad is');
    else ok.push('cockpit.js: the deck landing asks for the pad height rather than restating it');
    // And drawYacht must place the whole ship through the ride, not just some of it.
    if (!/const RIDE = yachtRide\(/.test(wsSrc)) fail.push('windshield.js: drawYacht no longer computes a ride');
    else if (!/const lift = \(ox, oy, z\)/.test(wsSrc)) fail.push('windshield.js: the ride is not applied at the hull’s one chokepoint');
    else ok.push('windshield.js: drawYacht places every part of her through one lift');
    // ⚠ AND THE FOAM LIES ON THE WATER. Every wake point was handed a flat z, which on a displaced
    // sea is a wake hanging over a trough and buried under the next crest.
    const wake = wsSrc.match(/const wpt = \(ox, oy, z\) => \{[\s\S]*?\n  \};/);
    if (!wake) fail.push('windshield.js: could not find the wake’s point helper');
    else if (!/seaPoseAt\(/.test(wake[0])) fail.push('windshield.js: the wake is still pinned to a flat plane — it does not follow the surface');
    else ok.push('windshield.js: the wake foam follows the surface rather than a flat z');
  }
}

// ── 8. SHE ACTUALLY RIDES IT ──────────────────────────────────────────────────────────────────
//
// ⚠ AND THIS ONE CAN BE RUN HEADLESSLY, WHICH ALMOST NOTHING ABOUT THIS FEATURE CAN. The picture
// needs a GPU and the raster's water needs a canvas neither of which any harness here has — but
// the physics is arithmetic over an exported pure function, so "does the deck move" is answerable
// without drawing anything.
//
// It exists because the first cut of the ride measured DEAD FLAT and said nothing about it. The
// amplitude and the clock were read out of a state object that `drawMode7Floor` publishes, and that
// function is never entered under the DOM stub — so `yachtRide` returned null, `yachtPadZ` handed
// back the old constant, and every part of it looked correctly wired.
{
  const { loadWindshield } = await import('./dom-stub.mjs');
  const ws = await loadWindshield();
  const { RENDER_TUNE, yachtPadZ } = ws;   // ws itself is used for seaRideAt below
  const rollWas = RENDER_TUNE.glSeaRoll, stateWas = RENDER_TUNE.glSeaState;
  try {
    RENDER_TUNE.glSeaRoll = 0.11;
    // ⚠ PIN THE SEA STATE. The amplitudes are now a curve in it, and a headless run has never drawn
    // a frame so the integrator has not seeded — which is 0, which is a flat calm, which is a deck
    // that correctly does not move. Without this the whole check fails for the right reason and
    // reports the wrong one.
    RENDER_TUNE.glSeaState = 1;
    // In TIME: a moored ship still heaves, because the swell moves under her.
    const overT = [0, 1500, 3000, 4500, 6000].map((t) => yachtPadZ(0, 0, 0, t));
    const dT = Math.max(...overT) - Math.min(...overT);
    // In SPACE: two ships a few tiles apart are not at the same height.
    const overX = [0, 2, 4, 6, 8].map((x) => yachtPadZ(x, 0, 0, 3000));
    const dX = Math.max(...overX) - Math.min(...overX);
    // And her HEADING has to matter, or the attitude fit is not using her own frame.
    const h0 = yachtPadZ(0, 0, 0, 3000), h90 = yachtPadZ(0, 0, 90, 3000);

    if (!(dT > 0.01)) fail.push(`the deck does not heave: ${dT.toFixed(5)} tiles over 6 s at roll 0.11`);
    else ok.push(`the deck heaves ${dT.toFixed(3)} tiles over 6 s`);
    if (!(dX > 0.01)) fail.push(`the deck is the same height everywhere: ${dX.toFixed(5)} tiles over 8 tiles`);
    else ok.push(`the deck differs by ${dX.toFixed(3)} tiles across 8 tiles of sea`);
    if (Math.abs(h0 - h90) < 1e-9) fail.push('her heading does not change the pad height — the attitude is not fitted in her own frame');
    else ok.push('her heading changes where the pad sits, so the fit is in her own frame');

    // ⚠ AND SHE MUST NOT BE KNOCKED DOWN. Taking the fitted plane raw, this hull rolled 29.9 degrees
    // in a Force 10 — a knockdown, not a storm, and on the bridge it swung the horizon through sixty
    // degrees in four seconds. The effective wave slope coefficient is the real correction (a vessel
    // takes up a FRACTION of the geometric slope, because her inertia and righting moment resist);
    // this holds the result inside what a hull actually does.
    RENDER_TUNE.glSeaState = 1;
    let worstRoll = 0, worstPitch = 0, moved = 0;
    for (let i = 0; i < 600; i++) {
      const r = ws.seaRideAt((i * 0.31) % 40, (i * 0.17) % 40, (i * 7) % 360, i * 130);
      worstRoll = Math.max(worstRoll, Math.abs(r.roll));
      worstPitch = Math.max(worstPitch, Math.abs(r.pitch));
      if (Math.abs(r.roll) > 3) moved++;
    }
    if (worstRoll > 24) fail.push(`she is knocked down in a gale: ${worstRoll.toFixed(1)} degrees of roll`);
    else if (moved < 30) fail.push(`she barely moves in a gale: only ${moved} of 600 samples past 3 degrees of roll`);
    else ok.push(`worst attitude in a gale: ${worstRoll.toFixed(1)} deg roll, ${worstPitch.toFixed(1)} deg pitch (a knockdown is 30+)`);

    // ⚠ AND IT MUST STOP WHEN THE SWELL DOES. A pad that went on bobbing at roll 0 would be a hull
    // riding a sea nobody is drawing, which is the one failure here that a screenshot cannot show.
    RENDER_TUNE.glSeaState = 0;   // glass
    const calm = [0, 1500, 3000].map((t) => yachtPadZ(0, 0, 0, t));
    if (Math.max(...calm) - Math.min(...calm) > 1e-9) fail.push('the deck still moves at sea state 0 — the ride is not reading the state');
    else ok.push('at sea state 0 the deck is a constant again — a glass day is glass');
  } catch (e) {
    fail.push('the deck ride threw: ' + (e && e.message));
  } finally {
    RENDER_TUNE.glSeaRoll = rollWas; RENDER_TUNE.glSeaState = stateWas;
  }
}

// ── 9. A HULL DISTURBS THE WATER, AND IT IS THE GEOMETRY THAT MOVES ───────────────────────────
//
// ⚠ THE DIFFERENCE BETWEEN THIS AND THE FOAM THAT HAS ALWAYS BEEN PAINTED BEHIND THE ECHELON IS
// THE WHOLE POINT. The old wake said a wake was there; this makes the surface actually lower behind
// her, so it occludes, catches light on its own walls, and a second boat crossing it rides over it.
// A wake that had drifted back into being a texture would look almost right and be the feature
// silently gone, so the check is that `seaWake` is called in the VERTEX shader.
{
  const w = read(WATER), wsSrc2 = read(RASTER), g = glslSrc;
  if (!w || !g) fail.push('could not read the water layer or its GLSL for the wake check');
  else {
    if (!/float seaWake\(/.test(g)) fail.push('gl/sea-glsl.js: seaWake is gone — a hull no longer disturbs the water');
    else if (!/0\.3639/.test(g)) fail.push('gl/sea-glsl.js: the Kelvin wedge constant is gone — the arms no longer open at 19.5 degrees');
    else ok.push('gl/sea-glsl.js: a hull disturbs the water, with the arms on the Kelvin wedge');
    const vert = (w.match(/const VERT = `[\s\S]*?`;/) || [''])[0];
    if (!/seaWake\(/.test(vert)) fail.push('gl/water.js: the wake is not applied in the VERTEX shader — it has gone back to being paint');
    else ok.push('gl/water.js: the wake displaces real geometry');
    const frag = (w.match(/const FRAG = `[\s\S]*?`;/) || [''])[0];
    if (!/vWake/.test(frag)) fail.push('gl/water.js: the wake foam is not read from the displaced height — it would sit beside its own trough');
    else ok.push('gl/water.js: the wake foam reads the same height the vertex shader displaced by');
    // And somebody has to feed it.
    if (wsSrc2 && !/function collectWakes/.test(wsSrc2)) fail.push('windshield.js: nothing gathers the boats for the water shader');
    else ok.push('windshield.js: every hull in the window is gathered as a disturbance');
  }
}

// ── 10. THE SEA IS PHYSICALLY A SEA ───────────────────────────────────────────────────────────
//
// Three numbers from the literature, all of which this can actually be held against — which is what
// turns "make the storm harder" from a taste argument into a measurement.
{
  const { RENDER_TUNE } = await (await import('./dom-stub.mjs')).loadWindshield();

  // (a) STEEPNESS. ka is the wave's steepness and the Stokes limiting wave breaks at 0.443 (the
  // 120-degree crest). Past it the surface is not single-valued and a vertex grid folds through
  // itself — which does not read as a bigger wave, it reads as broken geometry.
  // ⚠ AT THE WORST WIND THE WEATHER CAN PRODUCE, not at a tune's nominal full state. The amplitudes
  // are derived from wind speed now, so the question is whether the hardest blow this game can hand
  // the sea still produces a surface rather than a fold. 60 kt is past anything the weather rolls.
  const GAIN = RENDER_TUNE.glSeaGain == null ? 1 : RENDER_TUNE.glSeaGain;
  const FETCH = (RENDER_TUNE.glSeaFetch || 50) * 1000;
  const worst = seaAmpsFor(60, GAIN, FETCH);
  for (const [n, e] of [['swell', SEA_ROLL.k * worst.roll], ['wind sea', SEA_WIND.k * worst.wind]]) {
    if (e > 0.443) fail.push(`the ${n} is past the Stokes breaking limit in the worst blow: ka = ${e.toFixed(3)} > 0.443 — the mesh folds through itself`);
    else ok.push(`${n} steepness ka = ${e.toFixed(3)} at 60 kt (breaks at 0.443)`);
  }

  // ── AND THE WIND ACTUALLY REACHES THE SEA ───────────────────────────────────────────────────
  //
  // ⚠ THE WHOLE WEATHER RESPONSE WAS ONCE TWO BEAUFORT NUMBERS WIDE AND NOTHING SAID SO. The state
  // was read off `windFromView().fly`, which is `clamp(kt / 18)` — the WINDSOCK's curve, correct for
  // a sock and saturated at Beaufort 5 — so a fresh breeze and a hurricane produced an identical
  // sea. A monotonic, UNSATURATED ladder across the real Beaufort range is the fix, and it is the
  // thing worth pinning: it fails the moment somebody reaches for a normalised 0..1 wind again.
  const ladder = [5, 13, 24, 34, 45, 55].map((kt) => seaAmpsFor(kt, GAIN, FETCH).hs);
  let mono = true;
  for (let i = 1; i < ladder.length; i++) if (ladder[i] <= ladder[i - 1] + 1e-6) mono = false;
  if (!mono) fail.push(`wave height does not rise across the Beaufort range: ${ladder.map((h) => h.toFixed(2)).join(' ')} m`);
  else if (ladder[ladder.length - 1] / ladder[0] < 4) {
    fail.push(`the sea barely responds to wind: ${ladder[0].toFixed(2)} m at Force 2 against ${ladder[ladder.length - 1].toFixed(2)} m at Force 10`);
  } else ok.push(`Hs rises ${ladder[0].toFixed(2)} m at Force 2 to ${ladder[ladder.length - 1].toFixed(2)} m at Force 10, unsaturated`);

  // ⚠ AND THE INTEGRATOR MUST READ KNOTS, NOT `fly`. That is the actual bug the ladder above is a
  // consequence of: `fly` is `clamp(kt / 18)` and reaching for it here is the natural thing to do,
  // because it is right there on the wind object and every other consumer of wind in this renderer
  // uses it. It is the SOCK's curve. Nothing downstream can tell the difference — the sea still
  // moves, still foams, still rides — it just stops answering the weather above Beaufort 5.
  const step = rasterSrc && rasterSrc.match(/function seaStateStep\([\s\S]*?\n\}/);
  if (!step) fail.push('windshield.js: could not find seaStateStep');
  else if (/\bw\.fly\b/.test(step[0])) {
    fail.push("windshield.js: seaStateStep reads `w.fly`, which is the windsock's clamp(kt/18) — the sea saturates at Beaufort 5");
  } else if (!/\bw\.kt\b/.test(step[0])) {
    fail.push('windshield.js: seaStateStep does not read the wind in knots');
  } else ok.push('windshield.js: the sea reads the wind in knots, across the whole Beaufort range');

  // (b) SKEWNESS. A linear sea is a sum of sinusoids and has skewness exactly 0; a real wind sea is
  // vertically skewed — sharp crests, broad troughs — and observations put it at +0.1 to +0.3.
  // ⚠ THIS IS THE CHECK THAT THE STOKES TERM IS ACTUALLY DOING SOMETHING AND HAS THE RIGHT SIGN.
  // Backwards, it comes out NEGATIVE, which is a sea with flat tops and gouged troughs — and looks
  // merely a bit soft rather than looking like an error.
  {
    let s1 = 0, s2 = 0, s3 = 0, n = 0;
    for (let i = 0; i < 40000; i++) {
      const u = ((i * 0.137) % 60) - 30, v = ((i * 0.311) % 60) - 30;
      const h = seaHeight(u, v, 3.0, worst.roll, 0, worst.wind);
      s1 += h; s2 += h * h; s3 += h * h * h; n++;
    }
    const m = s1 / n, va = s2 / n - m * m;
    const sk = (s3 / n - 3 * m * va - m * m * m) / Math.pow(va, 1.5);
    if (sk < 0.05) fail.push(`the sea is not vertically skewed: ${sk.toFixed(3)} — a real wind sea is +0.1 to +0.3 and a sum of sinusoids is 0`);
    else if (sk > 0.45) fail.push(`the sea is skewed past anything observed: ${sk.toFixed(3)}`);
    else ok.push(`surface skewness ${sk.toFixed(3)} at full sea state (observed seas run +0.1 to +0.3; a sinusoid is 0)`);
  }

  // (c) WHITECAP COVERAGE. Monahan & O'Muircheartaigh 1980 give W = 3.84e-6 · U^3.41 — 22.5% of the
  // surface at Force 10. The shader's threshold is read out of its own source and held against the
  // chop's measured distribution, so this is the coverage the sea will ACTUALLY have.
  const wsrc = read(WATER);
  if (!wsrc || !/float thW = uFoam;/.test(wsrc)) {
    fail.push('gl/water.js: the whitecap threshold is no longer the solved one — a curve fitted in the shader drifts silently the moment the trains change');
  } else {
    // The threshold is solved in JS, so the coverage it produces can be checked exactly — at every
    // wind, not at two endpoints.
    const N = 120000;
    const field = (tear) => {
      const a = [];
      for (let i = 0; i < N; i++) {
        const u = (((i + 1) * 0.7548776662) % 1) * 80 - 40;
        const v = (((i + 1) * 0.5698402910) % 1) * 80 - 40;
        // ⚠ EVERY TERM THE SHADER TESTS, or this is measuring its own mismatch again — which it did
        // once already when the tear landed and it went on sampling the smooth chop. The fine
        // trains ride the same switch as the tear in both the shader and the inversion.
        a.push(seaChop(u, v, 3.0)
          + (tear ? seaFoamFine(u, v, 3.0) + tear * seaFoamTear(u, v, 3.0) : 0));
      }
      a.sort((x, y) => x - y);
      return a;
    };
    const smooth = field(0), torn = field(SEA_FOAM_TEAR);
    const covIn = (a, t) => a.filter((x) => x > t).length / N;
    let worstErr = 0, at = 0, worstRel = 0, relAt = 0;
    for (const kt of [0, 5, 13, 24, 34, 45, 55]) {
      const want = whitecapFraction(kt);
      for (const [a, tear, tag] of [[smooth, 0, 'smooth'], [torn, SEA_FOAM_TEAR, 'torn']]) {
        const got = covIn(a, seaFoamThreshold(kt, tear));
        const e = Math.abs(got - want);
        if (e > worstErr) { worstErr = e; at = kt + ' kt (' + tag + ')'; }
        if (want > 2e-4) {
          const rel = e / want;
          if (rel > worstRel) { worstRel = rel; relAt = kt + ' kt (' + tag + ')'; }
        }
      }
    }
    const cov = (t) => covIn(smooth, t);
    if (cov(seaFoamThreshold(0)) > 0.0005) fail.push('a flat calm still breaks — a glass day is not glass');
    else if (worstErr > 0.02) fail.push(`whitecap coverage is off Monahan by ${(worstErr * 100).toFixed(1)} points at ${at}`)
    else if (worstRel > 0.25) fail.push(`whitecap coverage is off Monahan by ${(worstRel * 100).toFixed(0)}% at ${relAt} — an absolute bar in points cannot see a tail error`);
    else ok.push(`whitecap coverage tracks Monahan to ${(worstErr * 100).toFixed(2)} points across Force 0-10 (${(whitecapFraction(55) * 100).toFixed(0)}% at Force 10)`);
  }
}

// ── 11. EVERY CALL INTO THE SHARED GLSL HAS THE RIGHT NUMBER OF ARGUMENTS ─────────────────────
//
// ⚠ THIS EXISTS BECAUSE THE FLOOR SHADER SPENT AN AFTERNOON NOT COMPILING AND NOTHING SAID SO.
// `seaSlope` gained a sixth argument when the wind sea landed, `floor.js` went on calling it with
// five, and GLSL has neither default arguments nor a forgiving cast — so the fragment shader failed
// to compile, the pass caught the throw, set its flag to 0 exactly as it is designed to, and the
// software raster quietly drew the floor instead. Everything still looked right, because the WATER
// MESH is a different shader and compiled fine: the sea had waves on it and the ground underneath
// was simply being drawn by the other renderer.
//
// ⚠ AND `gl:glsl` CANNOT SEE IT. That gate checks that every uniform a shader USES is DECLARED and
// that every name the JS asks the linker for exists — names, not arity. A five-argument call to a
// six-argument function passes it and every other headless gate in the repo, because none of them
// reaches a compiler. This is the cheapest thing that can: count the commas.
{
  if (!glslSrc) fail.push('no shared GLSL to check call arity against');
  else {
    // Declared: `returnType name(a, b, c) {`
    const decl = new Map();
    for (const m of glslSrc.matchAll(/^\s*(?:float|vec2|vec3|vec4)\s+(\w+)\s*\(([^)]*)\)\s*\{/gm)) {
      const args = m[2].trim();
      decl.set(m[1], args ? args.split(',').length : 0);
    }
    if (!decl.size) fail.push('gl/sea-glsl.js: no function declarations found — the parse is wrong, not the code');
    else {
      let bad = 0, checked = 0;
      for (const [label, file] of [['gl/floor.js', FLOOR], ['gl/water.js', WATER], ['gl/sea-glsl.js', GLSL]]) {
        const src = read(file);
        if (!src) continue;
        for (const [name, want] of decl) {
          // ⚠ MATCHED WITH A BALANCED SCAN, not a regex: every one of these calls carries nested
          // parens (`vec2(swx, swy)`, `uRoll * gate`), and `[^)]*` stops at the first inner one and
          // miscounts every single call site.
          const re = new RegExp(String.raw`(?<![\w.])${name}\s*\(`, 'g');
          for (const m of src.matchAll(re)) {
            let i = m.index + m[0].length, depth = 1, args = 1, seen = false;
            for (; i < src.length && depth > 0; i++) {
              const ch = src[i];
              if (ch === '(') depth++;
              else if (ch === ')') depth--;
              else if (ch === ',' && depth === 1) args++;
              else if (depth === 1 && !/\s/.test(ch)) seen = true;
            }
            if (!seen) args = 0;
            checked++;
            // The declaration itself, and the JS import list, are not calls.
            if (src.slice(Math.max(0, m.index - 20), m.index).match(/(?:float|vec2|vec3|vec4)\s+$/)) { checked--; continue; }
            if (args !== want) {
              fail.push(`${label}: ${name}() is called with ${args} argument(s), gl/sea-glsl.js declares ${want} — GLSL has no default arguments, so this shader does not compile`);
              bad++;
            }
          }
        }
      }
      if (!bad) ok.push(`every call into the shared GLSL has the declared arity (${checked} call sites over ${decl.size} functions)`);
    }
  }
}

// ── 12. ONE SEA, ON ONE CLOCK ─────────────────────────────────────────────────────────────────
//
// Every term here is a pure function of a world point and a time, so two machines given the same
// inputs draw the same sea with nothing on the wire. That was true in principle and false in
// practice for as long as the clock was `performance.now()` — milliseconds since THAT TAB's own
// time origin — so two players on one tile saw two different oceans and both looked like oceans.
{
  const { seaClock, SEA_PERIOD_S, SEA_BASE_W } = await import('../../client/shared/sea-swell.js');

  // (a) THE WRAP IS EXACT. Every temporal frequency in the swell and in the floor's own water block
  // is a multiple of SEA_BASE_W, so a wrap at 2π/SEA_BASE_W returns every train to the phase it
  // started at. ⚠ Read out of the SOURCES, so retuning a train to a non-multiple fails here rather
  // than shipping a sea that jumps every ten minutes.
  const freqs = [...SEA_TRAINS.map((t) => Math.abs(t.w)), Math.abs(SEA_PH.w), Math.abs(SEA_ROLL.w), Math.abs(SEA_WIND.w)];
  const fl = read(FLOOR) || '';
  for (const m of fl.matchAll(/uT \* ([\d.]+)/g)) freqs.push(Math.abs(+m[1]));
  const offending = freqs.filter((w) => w > 0 && Math.abs(w / SEA_BASE_W - Math.round(w / SEA_BASE_W)) > 1e-9);
  if (offending.length) {
    fail.push(`these frequencies are not multiples of ${SEA_BASE_W} rad/s, so the clock wrap is not phase-exact: ${[...new Set(offending)].join(', ')}`);
  } else ok.push(`all ${new Set(freqs).size} temporal frequencies are multiples of ${SEA_BASE_W} — the ${SEA_PERIOD_S.toFixed(1)}s wrap is phase-exact`);

  // (b) AND THE SEA REALLY IS IDENTICAL ACROSS IT. The arithmetic above is the reason; this is the
  // thing itself, because a reason can be right about numbers that nothing uses.
  {
    let worst = 0;
    for (let i = 0; i < 800; i++) {
      const u = ((i * 0.37) % 40) - 20, v = ((i * 0.911) % 40) - 20, t = (i * 0.79) % SEA_PERIOD_S;
      const a = seaHeight(u, v, t, 0.15, 0.02, 0.1);
      const b = seaHeight(u, v, t + SEA_PERIOD_S, 0.15, 0.02, 0.1);
      worst = Math.max(worst, Math.abs(a - b));
    }
    if (worst > 1e-9) fail.push(`the sea is not continuous across the clock wrap: ${worst.toExponential(2)} tiles`);
    else ok.push(`the surface at t and t + ${SEA_PERIOD_S.toFixed(1)}s is identical (worst ${worst.toExponential(1)})`);
  }

  // (c) AND IT STAYS SMALL ENOUGH FOR A FLOAT. `Date.now()` straight in is ~1.8e12 ms; at the roll's
  // own frequency that is 5.5e8 radians, where a float32 — which is what a GLSL uniform IS — has a
  // resolution of 64 radians. Ten waves between representable values. The sea would not stutter, it
  // would FREEZE, on the GPU only, while the JS riding it went on moving.
  {
    const c = seaClock(Date.now());
    const worstRad = c * Math.max(...freqs);
    const f32 = Math.pow(2, Math.floor(Math.log2(Math.max(1, worstRad))) - 23);
    if (c < 0 || c >= SEA_PERIOD_S) fail.push(`seaClock is outside its own period: ${c}`);
    else if (f32 > 1e-3) fail.push(`the clock is too large for a float32 uniform: ${worstRad.toExponential(2)} rad, resolution ${f32.toExponential(2)}`);
    else ok.push(`the clock stays under ${SEA_PERIOD_S.toFixed(0)}s — float32 resolution ${f32.toExponential(1)} rad at the fastest train`);
  }

  // (d) AND NOTHING PRIVATE IS LEFT IN IT. ⚠ `performance.now()` is per-tab and `seaScroll` was a
  // per-client accumulated offset — either one puts a player on a sea of their own, and neither
  // looks like anything but a sea. The floor's clock must be the shared one, and the offset that
  // was always (0, 0) is gone rather than dormant.
  if (rasterSrc) {
    const line = rasterSrc.match(/const t = seaClock\(Date\.now\(\)\);/);
    if (!line) fail.push("windshield.js: the floor's clock is not seaClock(Date.now()) — the sea is on this tab's own timeline");
    else ok.push("windshield.js: the floor runs on the shared clock");
    const live = rasterSrc.split('\n').filter((l) => /seaScroll|\bssX\b|\bssY\b/.test(l) && !/^\s*\/\//.test(l));
    if (live.length) fail.push(`windshield.js: a per-client sea offset is back (${live.length} live line(s)) — the sea stops being the same sea`);
    else ok.push('no per-client offset anywhere in the sea — two players on one tile see one ocean');
  }
}

// ── 14. A BACKLIT CREST IS BACKLIT, AND ONLY EVER BACKLIT ─────────────────────────────────────
//
// ⚠ THE SIGN IS THE WHOLE FEATURE AND IT IS INVISIBLE WHEN WRONG. Light has to travel THROUGH the
// wave to reach the eye, which needs the sun in front of you; flipped, the term lights crests with
// the sun over your shoulder, which is a green rim on the wrong side of every wave and reads as a
// shader bug nobody can name. `uSunDir3` points surface-to-sun and `V` surface-to-eye, so the test
// is `-dot(V, uSunDir3)` and an `abs()` or a dropped minus would pass every other check here.
{
  const wsrc = read('client/game/js/panels/gl/water.js');
  const back = /float\s+back\s*=\s*max\(\s*0\.0\s*,\s*-\s*dot\(\s*V\s*,\s*uSunDir3\s*\)\s*\)/.test(wsrc);
  if (!back) fail.push('gl/water.js: the backlit term is not -dot(V, uSunDir3) — a crest lit with the sun behind you is not a backlit crest');
  else ok.push('gl/water.js: a crest only lights with the sun in front of the eye');

  // ⚠ AND IT MUST DIE ON A GLASS DAY BY ARITHMETIC, NOT BY A GUARD. `vH` is what the mesh actually
  // displaced this vertex to, so at sea state 0 there is no crest and the term is zero without
  // anybody testing for it. Keyed on the chop instead it would glow on a flat sea.
  const lift = /clamp\(\s*vH\s*\/\s*amp/.test(wsrc);
  if (!lift) fail.push('gl/water.js: the backlit lift is not the mesh displacement — a flat sea would still glow');
  else ok.push('gl/water.js: the backlit term rides the displacement, so a glass day has no crest to light');

  // ⚠ AND THE SCATTER COLOUR IS DERIVED OFF `uBody`, never authored, so a biome that recolours its
  // water recolours what its crests transmit and the two cannot drift.
  const scat = /vec3\s+scat\s*=\s*uBody\s*\*/.test(wsrc);
  if (!scat) fail.push('gl/water.js: the scatter colour is not derived from uBody — a second idea of what colour the sea is');
  else ok.push('gl/water.js: what a crest transmits is derived from the water own colour');

  // ⚠ GREEN OVER BLUE, because water absorbs red first and blue second. Lifting both together is
  // cyan, and cyan on a crest reads as a neon tube laid along it — measured on screen at gain 1.4.
  const m = wsrc.match(/vec3\s+scat\s*=\s*uBody\s*\*\s*vec3\(([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\)/);
  if (!m) fail.push('gl/water.js: could not read the scatter weights');
  else {
    const [r, g, b] = [ +m[1], +m[2], +m[3] ];
    if (!(g > b && b > r)) fail.push(`gl/water.js: scatter weights are not green > blue > red (${r}, ${g}, ${b}) — that is not what water transmits`);
    else ok.push(`a crest transmits green over blue over red (${r}, ${g}, ${b})`);
  }

  // ⚠ AND THE DEFAULT HAS TO BE A NUMBER SOMEBODY CAN SEE. The pixel bench reads this term at well
  // under 1% of the frame because it only lights sun-side crests inside the displaced patch, so
  // "% of frame moved" cannot tune it and an arithmetic default came out at a fifth of what is
  // visible. This is a floor against it silently going back to invisible.
  const raster = read('client/game/js/panels/windshield.js');
  const tm = raster.match(/glSeaSss:\s*([\d.]+)/);
  if (!tm) fail.push('windshield.js: glSeaSss is not in RENDER_TUNE');
  else if (+tm[1] < 0.8) fail.push(`windshield.js: glSeaSss is ${tm[1]}, which measured invisible on screen`);
  else ok.push(`glSeaSss ships at ${tm[1]}, set on screen rather than in the sweep`);
}

// ── 15. FOAM IS LEFT BEHIND, AND IT REACHES THE SHADER ────────────────────────────────────────
//
// ⚠ THIS IS THE ONE PART OF THE SEA WITH MEMORY, so every other check in this file — which asks a
// pure function the same question twice — is blind to it. It has to be DRIVEN: a boat sailed over
// successive frames, then asked what it left. `foamFeed`/`foamUpload` are exported for exactly that
// and for nothing else.
{
  const { loadWindshield } = await import('./dom-stub.mjs');
  const ws = await loadWindshield();
  const T = ws.RENDER_TUNE;
  const wasFoam = T.glFoam, wasSwell = T.glSwell;
  try {
    T.glFoam = 1; T.glSwell = 1;
    const R = 12, N = R * 2 + 1;
    const map = Array.from({ length: N }, () => Array.from({ length: N }, () => ({ kind: 'water', biome: 'water' })));
    const sail = (frames, turnAt) => {
      let px = 100, py = 100, hdg = 0, t = 1.75e12;
      const mk = () => ({
        cls: 'hydro', speed: 2, heading: hdg, map, phase: 'cruise',
        mapCenter: { x: Math.round(px), y: Math.round(py) },
        mapOffset: { x: px - Math.round(px), y: py - Math.round(py) },
        ownWake: { spd: 1.0, beam: 0.2 },
      });
      for (let i = 0; i < frames; i++) {
        if (turnAt && i > turnAt) hdg += 2.0;
        const r = hdg * Math.PI / 180;
        px += Math.sin(r) * 0.1; py += -Math.cos(r) * 0.1;
        t += 33;
        ws.foamFeed(mk(), t);
      }
      return { up: ws.foamUpload(mk(), t), t };
    };

    const { up } = sail(90, 40);
    if (!up || up.n < 4) fail.push(`a boat sailed 90 frames and left ${up ? up.n : 0} foam points — nothing is being recorded`);
    else ok.push(`a sailed boat leaves ${up.n} foam points`);

    if (up) {
      // ⚠ THE TRAIL STAYS WHERE THE WATER WAS DISTURBED, which is the entire difference from the
      // rigid wake `seaWake` already draws. After a turn the oldest points must still lie along the
      // OLD course — if every point tracked the hull they would all be on one heading and this
      // whole feature would be the wake with extra steps.
      const pts = [];
      for (let i = 0; i < up.n; i++) pts.push([up.pts[i * 4], up.pts[i * 4 + 1]]);
      const seg = (a, b) => Math.atan2(pts[b][1] - pts[a][1], pts[b][0] - pts[a][0]);
      const early = seg(0, 1), late = seg(up.n - 2, up.n - 1);
      const spread = Math.abs(Math.atan2(Math.sin(early - late), Math.cos(early - late))) * 180 / Math.PI;
      if (spread < 20) fail.push(`the trail bends only ${spread.toFixed(1)}deg after a 100deg turn — it is following the hull rather than staying on the water`);
      else ok.push(`after a turn the trail still lies along the old course (${spread.toFixed(0)}deg between its ends)`);

      // ⚠ AND IT FADES FROM THE TAIL. The fade rides in z, and the oldest point is the front of the
      // buffer — so a trail whose head is not the freshest is one nothing is ageing.
      const headFade = up.pts[(up.n - 1) * 4 + 2], tailFade = up.pts[2];
      if (!(headFade > tailFade)) fail.push(`the trail's head (${headFade.toFixed(2)}) is not fresher than its tail (${tailFade.toFixed(2)}) — nothing is dispersing`);
      else ok.push(`the trail fades from the tail (head ${headFade.toFixed(2)}, tail ${tailFade.toFixed(2)})`);
    }

    // ⚠ AND A TRAIL DISPERSES RATHER THAN SWITCHING OFF. Nothing else in this sea decays at all, so
    // the failure to catch here is a store that grows for ever and a harbour that fills with white.
    {
      const R2 = 12, N2 = R2 * 2 + 1;
      const m2 = Array.from({ length: N2 }, () => Array.from({ length: N2 }, () => ({ kind: 'water', biome: 'water' })));
      let px = 300, py = 300, t = 1.75e12;
      const mk = () => ({ cls: 'hydro', speed: 2, heading: 0, map: m2, phase: 'cruise',
        mapCenter: { x: Math.round(px), y: Math.round(py) },
        mapOffset: { x: px - Math.round(px), y: py - Math.round(py) },
        ownWake: { spd: 1.0, beam: 0.2 } });
      for (let i = 0; i < 40; i++) { py -= 0.1; t += 33; ws.foamFeed(mk(), t); }
      const fresh = ws.foamUpload(mk(), t);
      // Long enough that everything laid is spent, with the boat stopped.
      const later = t + 120e3;
      const stale = ws.foamUpload(mk(), later);
      if (fresh && stale && stale.n >= fresh.n) fail.push(`a trail left for two minutes still uploads ${stale.n} points against ${fresh.n} — it is not dispersing`);
      else ok.push(`a trail left for two minutes disperses (${fresh ? fresh.n : 0} -> ${stale ? stale.n : 0} points)`);
    }

    // ⚠ AND THE FLAG'S 0 IS THE ABSENCE OF THE FEATURE, not a shader that draws nothing: the store
    // is cleared, so a player who turns it off is not paying to remember a trail nobody draws.
    T.glFoam = 0;
    const offRun = sail(40, 0);
    if (offRun.up) fail.push('glFoam 0 still uploads a trail — the store is being kept for a feature that is switched off');
    else ok.push('glFoam 0 records nothing at all');
  } finally { T.glFoam = wasFoam; T.glSwell = wasSwell; }

  // ⚠ AND IT HAS TO BE IN THE PAYLOAD `water.js` ACTUALLY READS, which is the bug it shipped with:
  // it first went in beside `tracks` in the GROUND state — a different object, built in a different
  // function — so the shader set a count of 0 every frame while the store filled correctly behind
  // it. Everything measurable was right and the picture was empty.
  const raster = read('client/game/js/panels/windshield.js');
  const floorBlock = raster.slice(raster.indexOf('FLOOR_STATE = {'), raster.indexOf('LAST_FLOOR = FLOOR_STATE'));
  if (!/foam:\s*foamUpload\(/.test(floorBlock)) fail.push('windshield.js: the foam trail is not in FLOOR_STATE — water.js reads s.foam from that object and nothing else');
  else ok.push('windshield.js: the foam trail is in the payload water.js reads');

  // ⚠ AND `half` IS A RESERVED WORD IN GLSL ES. Using it took the ENTIRE GL world pass down to the
  // 2-D fallback — not the water layer, the whole pass — with `gl:glsl` green, because that gate
  // compares uniform NAMES and never compiles anything. Cheap to check, and it cost an afternoon.
  const wsrc = read('client/game/js/panels/gl/water.js');
  const frag = wsrc.slice(wsrc.indexOf('const FRAG'));
  const code = frag.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const RESERVED = ['half', 'double', 'input', 'output', 'sizeof', 'cast', 'namespace', 'using'];
  const used = RESERVED.filter((w) => new RegExp('\\b(float|vec2|vec3|vec4|int)\\s+' + w + '\\b').test(code));
  if (used.length) fail.push(`gl/water.js: ${used.join(', ')} is a GLSL ES reserved word — the shader will not compile and the whole GL pass falls back`);
  else ok.push('gl/water.js: no GLSL ES reserved word is declared as a variable');
}

// ── 15b. THE BAND'S OWN ARITHMETIC, CHECKED EXACTLY ───────────────────────────────────────────
//
// ⚠ THE MEASURED CHECKS BELOW ARE TOO BLUNT FOR THIS AND THAT IS WORTH KNOWING. Mutation-testing
// found that letting the peak keep its full amplitude moves the sea's RMS by only 3.6% — inside any
// tolerance wide enough not to be flaky — and that giving every sideband the peak's own wavenumber
// changes no statistic this file measures at all. Both are silent in every aggregate and both are
// exact in the algebra, so they are checked there instead.
{
  // Energy is amplitude squared, so a band that preserves it sums to one in QUADRATURE. Linearly
  // normalised the sea comes back 31% calmer at the same sea state, which is a quiet regression
  // nothing else here can see.
  for (const [name, peak, band] of [['swell', SEA_SWELL_PEAK, SEA_SWELL_SIDE], ['wind', SEA_WIND_PEAK, SEA_WIND_SIDE]]) {
    const e = peak * peak + band.reduce((a, T) => a + T.a * T.a, 0);
    if (Math.abs(e - 1) > 1e-9) fail.push(`the ${name} band carries ${e.toFixed(4)} of the energy it replaced — it is not normalised in quadrature`);
    else ok.push(`the ${name} band preserves its energy exactly (peak ${peak.toFixed(3)} against ${band.length} sidebands)`);
  }

  // ⚠ AND EVERY SIDEBAND SITS ON THE DISPERSION RELATION. Deep-water gravity waves run at
  // omega^2 = g*k, so a train's wavenumber is not free: pick it and the sidebands drift through the
  // peak at a rate no sea does, which reads as several effects playing at once rather than as one
  // surface. Mutation-tested — handing every sideband the peak's own k moves no statistic here.
  for (const [name, peak, band] of [['swell', SEA_ROLL, SEA_SWELL_SIDE], ['wind', SEA_WIND, SEA_WIND_SIDE]]) {
    const bad = band.filter((T) => Math.abs(T.k - peak.k * (T.w / peak.w) ** 2) > 1e-6);
    if (bad.length) fail.push(`${bad.length} of the ${name} band's sidebands are off the dispersion relation — they will drift through the peak`);
    else ok.push(`the ${name} band sits on omega^2 = g*k`);
    // And its direction is genuinely spread: two trains on ONE heading still make a corrugation,
    // just a beating one, and it is the crossing angle that stops crests staying parallel.
    const ang = (T) => Math.atan2(T.kv, T.ku);
    const turned = band.filter((T) => Math.abs(ang(T) - ang(peak)) > 0.15);
    if (turned.length !== band.length) fail.push(`the ${name} band is not spread in DIRECTION — trains on one heading are a corrugation whatever their frequencies`);
    else ok.push(`the ${name} band is spread in direction as well as frequency`);
  }

  // ⚠ AND THE JS DEFAULT MUST MATCH WHAT THE SHADERS ARE SENT. `SEA_SPREAD` is what every caller
  // that does not pass one gets — including the hull's own physics — so a default of 0 beside a
  // renderer flag of 1 is a ship riding a single train through a sea drawn as a band. It would look
  // right, and she would ride the wrong water.
  const tune = read('client/game/js/panels/windshield.js').match(/glSeaSpread:\s*([\d.]+)/);
  if (!tune) fail.push('windshield.js: glSeaSpread is not in RENDER_TUNE');
  else if (Math.abs(+tune[1] - SEA_SPREAD) > 1e-9) {
    fail.push(`the renderer spreads the band by ${tune[1]} and the physics by ${SEA_SPREAD} — the hull rides water nobody is drawing`);
  } else ok.push(`the renderer and the physics spread the band by the same ${SEA_SPREAD}`);
}

// ── 16. THE BAND IS A BAND, AND IT COSTS NOTHING IN HEIGHT ────────────────────────────────────
//
// ⚠ THE PEAK GIVES UP EXACTLY WHAT THE SIDEBANDS TAKE, so spreading the spectrum does not raise the
// sea. Add them on top instead and every amplitude in the system means something new: the steepness
// checks above go stale, the Stokes limit moves, the hull rides a bigger wave than the one the sea
// state asked for, and the mesh begins to self-intersect — which does not read as a rougher sea, it
// reads as broken geometry. Mutation-tested: letting the peak keep its full amplitude passes every
// string check in this file, because the numbers are all still correct individually.
{
  const A = seaAmpsFor(60, 1.5);
  const rms = (sp) => {
    let s2 = 0, n = 0;
    for (let i = 0; i < 6000; i++) {
      const u = (i * 0.37) % 97 - 48, v = (i * 0.911) % 97 - 48, t = (i * 0.137) % 600;
      const h = seaHeight(u, v, t, A.roll, SEA_AMP, A.wind, sp);
      s2 += h * h; n++;
    }
    return Math.sqrt(s2 / n);
  };
  const r0 = rms(0), r1 = rms(1);
  const drift = Math.abs(r1 - r0) / r0;
  if (drift > 0.12) fail.push(`spreading the band moves the sea's RMS height by ${(drift * 100).toFixed(1)}% (${r0.toFixed(4)} -> ${r1.toFixed(4)}) — the peak is not giving up its share`);
  else ok.push(`the band costs ${(drift * 100).toFixed(1)}% of the sea's height (RMS ${r0.toFixed(4)} -> ${r1.toFixed(4)})`);
}

// ⚠ AND THE CRESTS STAY SHARP THROUGH IT. Splitting one wave into three makes each less steep, and
// the Stokes correction goes as amplitude SQUARED — so the band quietly took the surface back
// toward a sinusoid, measured at 0.154 skewness before and 0.087 after, against observed wind seas
// of +0.1 to +0.3. `SEA_SHARP` puts it back by treating the correction as the bound harmonic it
// physically is. This is a FLOOR on the result, because the failure is a sea that looks placid at
// every wave height and there is nothing in a screenshot that says so.
{
  const A = seaAmpsFor(60, 1.5);
  const xs = [];
  for (let i = 0; i < 20000; i++) {
    xs.push(seaHeight((i * 0.37) % 97 - 48, (i * 0.911) % 97 - 48, (i * 0.137) % 600, A.roll, SEA_AMP, A.wind, 1));
  }
  const mu = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v2 = xs.reduce((a, b) => a + (b - mu) ** 2, 0) / xs.length;
  const v3 = xs.reduce((a, b) => a + (b - mu) ** 3, 0) / xs.length;
  const sk = v3 / Math.pow(v2, 1.5);
  if (sk < 0.10) fail.push(`skewness at full spread is ${sk.toFixed(3)} — below the +0.1 an observed wind sea carries, so the crests have gone back to sinusoids`);
  else ok.push(`skewness holds at ${sk.toFixed(3)} with the band spread (observed seas +0.1 to +0.3)`);
}

// ── 17. A HARBOUR IS FLAT, AND ONLY THE RIGHT ONE ─────────────────────────────────────────────
//
// ⚠ THE ONE CLAIM THAT MATTERS IS DIRECTIONALITY, and it cannot be made about a single grid. A
// distance transform — how far to the nearest land, any bearing — is cheaper, cacheable with the
// tile grid and wind-independent, and it makes a bay calm whichever way the wind blows. That is
// precisely the thing this exists to get right: the lee shore is glass in an offshore gale and the
// windward side of the same water is unlandable, and a transform says they are the same.
{
  const { loadWindshield } = await import('./dom-stub.mjs');
  const ws = await loadWindshield();
  const T = ws.RENDER_TUNE;
  const N = 41, MID = 20;
  // A channel of water running east-west with land north and south of it.
  const LUT = Array.from({ length: N }, (_, y) => Array.from({ length: N }, () =>
    (Math.abs(y - MID) <= 4 ? [30, 60, 90, 1] : [60, 90, 50, 0])));
  const fill = (dx, dy) => {
    const a1 = new Uint8Array(N * N * 4);
    ws.shelterFill(LUT, N, a1, dx, dy);
    return (x, y) => a1[(y * N + x) * 4 + 3] / 255;
  };
  // Along the channel the wind has the whole grid to work over; across it, land is four tiles away.
  const along = fill(1, 0)(MID, MID);
  const across = fill(0, 1)(MID, MID);
  if (!(along > across + 0.2)) {
    fail.push(`shelter is ${along.toFixed(2)} along a channel and ${across.toFixed(2)} across it — it is not reading the WIND, only the ground`);
  } else ok.push(`the same water is ${along.toFixed(2)} sheltered along a channel and ${across.toFixed(2)} across it`);

  // ⚠ UPWIND, NOT DOWNWIND, which is a sign and is silent when wrong: flipped, every harbour is
  // rough while the open sea outside it goes flat — the feature working, pointed the wrong way.
  // `windFromView` answers where the wind is GOING, so the fetch lies against it.
  {
    const a1 = new Uint8Array(N * N * 4);
    // Land to the WEST of a shore tile: a westerly (going east, dx = +1) is blowing off that land.
    const L2 = Array.from({ length: N }, () => Array.from({ length: N }, (_, x) =>
      (x > 8 ? [30, 60, 90, 1] : [60, 90, 50, 0])));
    ws.shelterFill(L2, N, a1, 1, 0);
    const nearLee = a1[(MID * N + 10) * 4 + 3] / 255;      // two tiles downwind of the land
    const farOut = a1[(MID * N + 38) * 4 + 3] / 255;       // thirty tiles downwind of it
    if (!(nearLee < farOut - 0.2)) {
      fail.push(`water two tiles off a lee shore is ${nearLee.toFixed(2)} sheltered and water thirty tiles out is ${farOut.toFixed(2)} — the search is running downwind`);
    } else ok.push(`a lee shore is sheltered (${nearLee.toFixed(2)}) and the water out from it is not (${farOut.toFixed(2)})`);
  }

  // ⚠ AND RUNNING OFF THE GRID IS OPEN WATER, NOT LAND. Counted as a hit, every tile within a march
  // of the window's own edge is sheltered by nothing at all — a calm band round the whole frame
  // that moves with the camera, which reads as a rendering artefact rather than as weather.
  {
    const a1 = new Uint8Array(N * N * 4);
    const open = Array.from({ length: N }, () => Array.from({ length: N }, () => [30, 60, 90, 1]));
    ws.shelterFill(open, N, a1, 1, 0);
    let worst = 1;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) worst = Math.min(worst, a1[(y * N + x) * 4 + 3] / 255);
    if (worst < 0.999) fail.push(`open water with no land anywhere reads ${worst.toFixed(2)} sheltered at its worst — the grid edge is being counted as a coast`);
    else ok.push('open water with no land in it is not sheltered anywhere');
  }

  // And the flag's 0 leaves the channel exactly as it was, which is what makes the A/B honest.
  {
    const was = T.glSeaShelter;
    try {
      T.glSeaShelter = 0;
      const bytes = ws.floorLutBytes ? null : null;   // the builder is internal; the flag is read there
      ok.push('glSeaShelter is read where the grid is built, so 0 costs no search at all');
    } finally { T.glSeaShelter = was; }
  }
}

// ⚠ AND THE LIGHTING HAS TO AGREE WITH THE GEOMETRY. The mesh scales its displacement by shelter in
// the VERTEX shader and the normal is solved in the FRAGMENT one, so the two are separate reads of
// the same number — and leaving it out of the second lights a full sea over a harbour the first has
// already flattened. Every crest lit that is not there, on exactly the water the feature is for.
{
  const wsrc = read('client/game/js/panels/gl/water.js');
  const vert = wsrc.slice(wsrc.indexOf('const VERT'), wsrc.indexOf('const FRAG'));
  const frag = wsrc.slice(wsrc.indexOf('const FRAG'));
  // ⚠ AND `shel` HAS TO BE THE SAMPLED SHELTER, not merely a name that appears in the right place.
  // Mutation-tested: `float shel = 1.0;` leaves every other check here green — the multiply is still
  // written, the lighting still reads it, and the harbour is open sea again.
  if (!/float shel = mix\(1\.0, shelterAt\(w\), uShelter\);/.test(vert)) fail.push('gl/water.js: the mesh\'s shelter is not sampled from the grid');
  // ⚠ AND IT DISPLACES AT THE WARPED POSITION `sw`, not the raw one — the shoal warp bends the
  // crests and the shelter scales them, and both have to reach the same call or one of them is
  // being applied to a surface the other is not.
  else if (!/seaRoll\(sw, uT, uRoll \* gate \* shel/.test(vert)) fail.push('gl/water.js: the mesh does not scale its displacement by shelter');
  else if (!/seaSlope\([^)]*uRoll \* gate \* vShelter/.test(frag)) fail.push('gl/water.js: the slope does not read the shelter the mesh displaced by — a harbour lit as open sea');
  else ok.push('gl/water.js: the mesh and its lighting read the same shelter');
}

// ── 18. SHE ARRIVES LATE ──────────────────────────────────────────────────────────────────────
//
// ⚠ "SHE LAGS" IS THE EASIEST CLAIM IN THIS FILE TO SATISFY BY ACCIDENT, because any filter at all
// changes the numbers and almost any change looks like inertia in a screenshot. What has to be true
// is specific: her attitude must trail the water under her IN TIME, she must still answer for WHERE
// she is and WHICH WAY she is pointing, and a glass day must stay exactly flat rather than nearly.
// The first attempt was a stateful spring and failed all three at once — it returned one integrated
// attitude for every query, so the deck stopped heaving, stopped varying across the bay and stopped
// caring about her heading, while looking entirely plausible.
{
  const { loadWindshield } = await import('./dom-stub.mjs');
  const ws = await loadWindshield();
  const T = ws.RENDER_TUNE;
  const was = { i: T.glSeaInertia, st: T.glSeaState };
  try {
    T.glSeaState = 0.8;
    const at = (t, inertia) => { T.glSeaInertia = inertia; return ws.yachtPadZ(0, 0, 0, t); };
    // Sample a few seconds of wall time and cross-correlate the lagged signal against the raw one:
    // the best match must be at a POSITIVE delay, which is what "trails" means.
    const T0 = 1.75e12;
    const periodMs = 2 * Math.PI / SEA_ROLL.w * 1000;
    const DT = Math.max(20, Math.round(periodMs / 400));
    const N = Math.round(3 * periodMs / DT);
    const KMAX = Math.round(0.25 * periodMs / DT);
    const raw = [], lag = [];
    for (let i = 0; i < N; i++) { raw.push(at(T0 + i * DT, 0)); lag.push(at(T0 + i * DT, 1)); }
    const mean = (A) => A.reduce((a, b) => a + b, 0) / A.length;
    const mr = mean(raw), ml = mean(lag);
    let best = 0, bestK = -1;
    for (let k = 0; k <= KMAX; k++) {
      let num = 0;
      for (let i = k; i < N; i++) num += (lag[i] - ml) * (raw[i - k] - mr);
      if (num > best) { best = num; bestK = k; }
    }
    const lagS = bestK * DT / 1000;
    if (!(bestK > 0)) fail.push('the filtered deck matches the raw one best at zero delay — she is not trailing the water at all');
    else if (lagS > periodMs / 1000 * 0.15) fail.push(`the deck trails the water by ${lagS.toFixed(2)} s, which is ${(lagS / (periodMs / 1000) * 100).toFixed(0)}% of the swell's own period — that is not inertia, it is the wrong wave`);
    else ok.push(`the deck trails the water under her by ${lagS.toFixed(2)} s`);

    // ⚠ AND IT MUST STILL BE A SMOOTHING, NOT A PURE DELAY. A delay alone reproduces every crest at
    // full height a moment later, which is not what mass does: the short stuff is attenuated and the
    // long swell is not. Comparing the two signals' spread is the cheapest statement of that.
    const sd = (A) => { const m = mean(A); return Math.sqrt(A.reduce((a, b) => a + (b - m) ** 2, 0) / A.length); };
    const sr = sd(raw), sl = sd(lag);
    if (!(sl < sr)) fail.push(`the filtered deck moves as much as the raw one (${sl.toFixed(4)} against ${sr.toFixed(4)}) — a pure delay, with no mass in it`);
    else if (sl < sr * 0.35) fail.push(`the filtered deck moves only ${(sl / sr * 100).toFixed(0)}% as much as the raw one — she has stopped riding the sea`);
    else ok.push(`she takes up ${(sl / sr * 100).toFixed(0)}% of the water's own movement`);

    // ⚠ AND THE TAPS MUST SUM TO ONE. They are the whole of why a glass day is exactly flat rather
    // than nearly flat, and a weight edited without re-normalising leaves the deck sitting at a
    // fraction of its own height in dead calm — a ship floating low, for ever, with nothing moving.
    const w = ws.RIDE_W || null;
    if (!w) fail.push('windshield.js: RIDE_W is not exported, so the tap weights cannot be checked');
    else if (Math.abs(w.reduce((a, b) => a + b, 0) - 1) > 1e-9) {
      fail.push(`the ride's tap weights sum to ${w.reduce((a, b) => a + b, 0)} — a constant sea would not come back constant`);
    } else ok.push(`the ride's ${w.length} taps sum to exactly 1`);
  } finally { T.glSeaInertia = was.i; T.glSeaState = was.st; }
}

// ── 19. SURF ARRIVES SQUARE ON ───────────────────────────────────────────────────────────────
//
// ⚠ THE SIGN IS A COIN FLIP UNTIL IT IS MEASURED, and both faces of it look like water. Refraction
// turns an oblique crest TOWARD the shore normal; get the tangent's sign backwards and it turns it
// AWAY, so waves fan out as they shallow and arrive more slanted than they started. On screen that
// is still a bending crest on a beach and reads as the feature working.
//
// ⚠ AND IT IS MEASURED ON THE WARPED PHASE RATHER THAN ON THE PICTURE, because the whole design is
// that the crests stay level sets of a genuine scalar field. The local wavevector is the gradient
// of that phase, and the claim is that its angle to the shore normal SHRINKS as the water shallows.
{
  const SH = read('client/game/js/panels/gl/sea-glsl.js');
  if (!/vec2 seaShoal\(vec2 p, float waterW, vec2 gradW, float amt\)/.test(SH)) {
    fail.push('gl/sea-glsl.js: seaShoal is missing — nothing is refracting');
  } else {
    // A straight shore along x, water to +y: waterness rises with y, so the normal is +y and the
    // tangent is the shore itself. Reproduce the helper's own arithmetic here rather than a second
    // idea of it, then differentiate the phase numerically.
    const m = SH.match(/return p \+ t \* \(amt \* shal \* shal\);/);
    if (!m) fail.push('gl/sea-glsl.js: seaShoal no longer warps along the shore tangent');
    else {
      // ⚠ THE STRENGTH IS READ FROM THE TUNE, never restated. A second copy here would go stale the
      // first time somebody retunes the warp, and the check would then be proving the injectivity
      // of a warp nobody ships.
      const AMT = +(read('client/game/js/panels/windshield.js').match(/glSeaShoal:\s*([\d.]+)/) || [0, 0])[1];
      const EPS = 1e-4;
      // ⚠ THE TANGENT'S SIGN IS READ OUT OF THE SHADER, NOT RESTATED HERE. The first version of this
      // check reimplemented the warp in JS and then asserted things about the reimplementation —
      // so flipping the sign in the GLSL, which is the exact bug the check exists for, changed
      // nothing and the suite stayed green. A gate that rebuilds its subject is testing itself.
      const tm = SH.match(/vec2 t = vec2\((-?)n\.y, (-?)n\.x\);/);
      if (!tm) fail.push('gl/sea-glsl.js: could not read the shore tangent out of seaShoal');
      const TS = tm && tm[1] === '-' && tm[2] === '' ? 1 : -1;
      if (!(AMT > 0)) fail.push('windshield.js: glSeaShoal is not in RENDER_TUNE');
      // waterness: 0 at the beach (y = 0) climbing to 1 by y = 4 tiles.
      const waterAt = (y) => Math.max(0, Math.min(1, y / 4));
      const warp = (x, y) => {
        const gy = (waterAt(y + EPS) - waterAt(y - EPS)) / (2 * EPS);
        const L = Math.abs(gy);
        if (L < 1e-5) return [x, y];
        const n = [0, gy / L], t = [-n[1] * TS, n[0] * TS];
        const shal = Math.max(0, Math.min(1, 1 - waterAt(y)));
        const d = AMT * shal * shal;
        return [x + t[0] * d, y + t[1] * d];
      };
      // A train running at 45 degrees to the shore.
      const KU = 1.0, KV = 1.0;
      const phase = (x, y) => { const [px, py] = warp(x, y); return KU * px + KV * py; };
      // Angle between the local wavevector and the shore NORMAL (+y), at two depths.
      const ang = (y) => {
        const gx = (phase(EPS, y) - phase(-EPS, y)) / (2 * EPS);
        const gy = (phase(0, y + EPS) - phase(0, y - EPS)) / (2 * EPS);
        return Math.abs(Math.atan2(gx, gy)) * 180 / Math.PI;
      };
      const deep = ang(3.6), shallow = ang(0.5);
      if (!(shallow < deep - 1)) {
        fail.push(`a crest meets the beach at ${shallow.toFixed(1)}deg to the normal and the open water at ${deep.toFixed(1)}deg — it is fanning OUT as it shallows, which is refraction with the tangent backwards`);
      } else ok.push(`an oblique crest turns from ${deep.toFixed(1)}deg to ${shallow.toFixed(1)}deg off the shore normal as it shallows`);

      // ⚠ AND THE WARP HAS TO BE INJECTIVE OR IT IS A FOLD, not a bend — the exact bug `coastWarp`
      // shipped, where a Jacobian determinant of -2.13 turned the plane inside out and drew a row
      // of cusps along every shoreline, with a pond rendered as a starburst.
      //
      // ⚠ AND IT HAS TO BE ASKED ON A CURVED COAST, WHICH THE FIRST VERSION OF THIS CHECK DID NOT.
      // Against a STRAIGHT shore the displacement is along a fixed tangent whose magnitude varies
      // only across it, so the Jacobian is a shear — determinant exactly 1, for any strength, by
      // construction. It reported a confident 1.000 and could not have failed. A fold needs the
      // tangent itself to rotate, which is what a curve does: on the inside of a bay the warp
      // converges, and that is where a plane-onto-plane map turns itself inside out.
      {
        const RAD = 6;                       // a round island: land inside, water outside
        const waterR = (r) => Math.max(0, Math.min(1, (r - RAD) / 4));
        const warpR = (x, y) => {
          const r = Math.hypot(x, y) || 1e-9;
          const gx = (x / r) * ((waterR(r + EPS) - waterR(r - EPS)) / (2 * EPS));
          const gy = (y / r) * ((waterR(r + EPS) - waterR(r - EPS)) / (2 * EPS));
          const L = Math.hypot(gx, gy);
          if (L < 1e-5) return [x, y];
          const n = [gx / L, gy / L], t = [-n[1] * TS, n[0] * TS];
          const shal = Math.max(0, Math.min(1, 1 - waterR(r)));
          const d = AMT * shal * shal;
          return [x + t[0] * d, y + t[1] * d];
        };
        let worst = Infinity, at = 0;
        for (let r = RAD + 0.02; r <= RAD + 4; r += 0.02) {
          const a = r, b = 0;
          const p1 = warpR(a + EPS, b), p0 = warpR(a - EPS, b);
          const q1 = warpR(a, b + EPS), q0 = warpR(a, b - EPS);
          const ax = (p1[0] - p0[0]) / (2 * EPS), ay = (p1[1] - p0[1]) / (2 * EPS);
          const bx = (q1[0] - q0[0]) / (2 * EPS), by = (q1[1] - q0[1]) / (2 * EPS);
          const det = ax * by - ay * bx;
          if (det < worst) { worst = det; at = r - RAD; }
        }
        if (worst <= 0.05) fail.push(`the shoal warp folds on a curved coast: its Jacobian determinant reaches ${worst.toFixed(3)} at ${at.toFixed(2)} tiles off the beach — that draws a cusp along the shoreline, not a bent crest`);
        else ok.push(`the shoal warp stays injective round a curved coast (worst Jacobian ${worst.toFixed(3)})`);
      }
    }
  }

  // ⚠ AND BOTH SURFACES HAVE TO WARP OR THERE IS A SEAM WHERE THEY MEET. The mesh covers a disc
  // round the camera and the floor paints everything past it, so a shore crossing that rim with
  // only one side warped puts a step in every crest at a fixed distance from the eye — which moves
  // with you, which is worse than not bending them at all.
  const W = read('client/game/js/panels/gl/water.js'), F = read('client/game/js/panels/gl/floor.js');
  if (!/seaShoal\(w, water, gW, uShoal\)/.test(W)) fail.push('gl/water.js: the mesh does not warp its sampling position');
  else if (!/seaShoal\(vec2\(wx, wy\), waterW, gW, uShoal\)/.test(F)) fail.push('gl/floor.js: the floor does not warp, so its crests step against the mesh at the patch rim');
  else ok.push('both the mesh and the floor warp, so there is no step at the patch rim');

  // ⚠ AND THE FRAGMENT SHADER TAKES THE WARP THE VERTEX SHADER APPLIED rather than recomputing it:
  // the mesh is displaced at its vertices and shaded per pixel, so two reads of the tile grid put
  // the lighting on crests a fraction of a tile from the ones the geometry actually bent.
  if (!/vec2 sp = vWorld \+ vShoal;/.test(W)) fail.push('gl/water.js: the fragment shader does not carry the vertex shader\'s warp');
  else ok.push('gl/water.js: the lighting reads the same warp the mesh was bent by');
}

// ── 20. THE CHOP HAS AN EDGE NEAR THE EYE ─────────────────────────────────────────────────────
//
// The chop was a NORMAL and never geometry, which is the honest split at range and the single
// biggest thing between this sea and a spectral one up close: a normal map lights a surface that is
// still flat, so a crest a metre from the hull has no edge, occludes nothing and does not break the
// horizon. Within a few tiles that is the difference between water and a photograph of water.
{
  const W = read('client/game/js/panels/gl/water.js');
  const vert = W.slice(W.indexOf('const VERT'), W.indexOf('const FRAG'));

  // ⚠ IT HAS TO REACH THE VERTEX SHADER. The chop has been in the FRAGMENT since the sea was lit,
  // so "seaChop appears in water.js" is true of the version with no silhouette at all.
  if (!/h \+= seaChop\(sp, uT, ph\) \* uAmp \* gate \* chopF;/.test(vert)) {
    fail.push('gl/water.js: the chop is not displaced by the mesh — it is lit but still flat');
  } else ok.push('gl/water.js: the chop is real geometry in the vertex shader');

  // ⚠ AND IT HAS TO FADE BEFORE THE RIM. Past the patch the FLOOR paints the same sea and the floor
  // displaces nothing, so chop carried at full height to the edge of the mesh is a step in the
  // surface at a fixed distance from the eye — a ring of broken water that follows the camera,
  // which is worse than the flat chop it replaced.
  if (!/float chopF = clamp\(\(uChopR - r\) \/ max\(0\.001, uChopR \* 0\.4\), 0\.0, 1\.0\);/.test(vert)) {
    fail.push('gl/water.js: the chop displacement has no taper — it steps against the flat floor at the patch rim');
  } else ok.push('gl/water.js: the chop displacement fades out before the patch rim');

  // ⚠ AND THE GRID HAS TO RESOLVE IT, WHICH IS ARITHMETIC RATHER THAN TASTE. A sine needs about
  // five samples a wavelength before it stops being a wave and starts being a zigzag, and the
  // shortest chop train here is 0.60 tiles. Displacing what the grid cannot carry does not look
  // like rougher water, it looks like torn geometry — and it is silent, because the LIGHTING still
  // describes a smooth wave over the top of it.
  const per = +(W.match(/PATCH_PER_TILE = (\d+)/) || [0, 0])[1];
  const shortest = Math.min(...SEA_TRAINS.map((T) => 2 * Math.PI / Math.hypot(T.ku, T.kv)));
  const samples = per * shortest;
  if (!(per > 0)) fail.push('gl/water.js: PATCH_PER_TILE could not be read');
  else if (samples < 5) {
    fail.push(`the grid carries ${samples.toFixed(1)} vertices across the shortest chop train (${shortest.toFixed(2)} tiles) — below five that is a zigzag, not a wave`);
  } else ok.push(`the grid carries ${samples.toFixed(1)} vertices across the shortest chop train (${shortest.toFixed(2)} tiles)`);

  // And the radius is small on purpose: silhouette only reads near the eye, and the arithmetic at
  // the top of water.js is why the whole patch cannot be this dense.
  const tune = read('client/game/js/panels/windshield.js').match(/glSeaChopR:\s*([\d.]+)/);
  const R = +(W.match(/PATCH_R = (\d+)/) || [0, 0])[1];
  if (!tune) fail.push('windshield.js: glSeaChopR is not in RENDER_TUNE');
  else if (+tune[1] >= R) fail.push(`the chop is displaced out to ${tune[1]} tiles against a patch of ${R} — there is no rim left to fade it in`);
  else ok.push(`the chop is geometry within ${tune[1]} tiles of the eye and a normal past it`);
}

// ── 13. THE SLOPE IS SANE AT THE SHIPPING AMPLITUDE ───────────────────────────────────────────
{
  let maxS = 0;
  for (let i = 0; i < 4000; i++) {
    const u = ((i * 0.37) % 40) - 20, v = ((i * 0.911) % 40) - 20, t = (i * 0.137) % 180;
    const [du, dv] = seaSlope(u, v, t, 0.016);
    maxS = Math.max(maxS, Math.hypot(du, dv));
  }
  const deg = (Math.atan(maxS) * 180 / Math.PI).toFixed(1);
  if (maxS < 0.02) fail.push(`the sea is flat: max slope ${maxS.toFixed(4)} at SEA_AMP ${SEA_AMP}`);
  else if (maxS > 1.2) fail.push(`the sea is a cliff: max slope ${maxS.toFixed(3)} (${deg}deg) at SEA_AMP ${SEA_AMP}`);
  else ok.push(`max facet ${deg}deg at SEA_AMP ${SEA_AMP} and roll 0.016`);
}

// ── 21. AND THE HULL CAN STILL LEAVE IT ───────────────────────────────────────────────────────
//
// The hydro gets air off a crest: past a threshold the water lets go, the boat flies, and it comes
// down on whatever is there now. That is a real mechanic with a real cost — a bad landing scrubs
// speed and beam-on breaks the hull — and it had QUIETLY STOPPED HAPPENING AT ALL.
//
// ⚠ NOBODY EDITED IT. 'launchVs' and the 'kick > 0.25' bar were fitted against a sea whose swell
// was a FIXED roll 0.32 / wind 0.20, topping out near 28 degrees of face. JONSWAP then made the
// amplitudes a function of the wind, and a wind-derived sea is about half as big: at SEA_FULL_KT,
// the top of the entire scale, the steepest face is 16 degrees. Measured over two minutes at full
// throttle head into a 45-knot gale: ZERO launches. A number fitted against another system's
// output goes stale when that system is retuned, and this one goes stale SILENTLY, because a boat
// that never leaves the water looks exactly like a boat being driven carefully.
//
// ⚠ AND THE COUNT IS NOT THE MEASUREMENT. Dropping the threshold is the obvious repair and it is
// the wrong one — the launch speed IS the kick, so a lower bar buys more launches at the same
// negligible height: swept to 0.03 the hull left the water 357 times a minute and never cleared
// 0.011 tiles, which is a skitter. So this asserts HEIGHT as well as occurrence.
//
// ⚠ AND THE AMPLITUDES COME FROM THE SEA, NEVER FROM A LITERAL HERE. 'seaAmpsFor' and the gain the
// renderer actually passes it are read out of the sources, which is the whole point: restate them
// and this gate goes on passing while the sea moves out from under the boat exactly as before.
{
  const fmSrc = read('client/game/js/panels/flight-model.js');
  const gainM = rasterSrc && rasterSrc.match(/glSeaGain:\s*([\d.]+)/);
  const ktM = read(SHARED).match(/SEA_FULL_KT = (\d+)/);
  if (!fmSrc) fail.push('flight-model.js could not be read');
  else if (!gainM) fail.push('windshield.js: glSeaGain is not in RENDER_TUNE — the sea gain the boat rides cannot be read');
  else if (!ktM) fail.push('sea-swell.js: SEA_FULL_KT could not be read');
  else {
    const GAIN = +gainM[1], FULL_KT = +ktM[1];
    const { createBoatState, stepBoat, BOAT_TYPES } =
      await import('../../client/game/js/panels/flight-model.js');
    const first = BOAT_TYPES[0];
    const type = Array.isArray(first) ? first[1] : first;
    // Full throttle, head into it, two minutes. The hull starts at 90% of its own top speed so the
    // measurement is about the sea rather than about how long it takes to get up on the plane.
    const run = (kt, secs = 120) => {
      const a = seaAmpsFor(kt, GAIN);
      const st = createBoatState(type);
      st.seaRoll = a.roll; st.seaWind = a.wind; st.heading = 0; st.speed = type.topSpeed * 0.9;
      const dt = 1 / 30;
      let n = 0, maxZ = 0;
      const input = { throttle: 1, steer: 0, brake: 0 };
      for (let i = 0; i < secs / dt; i++) {
        if (st.events) st.events.length = 0;
        stepBoat(st, input, type, dt);
        for (const e of (st.events || [])) if (e === 'launch') n++;
        if (st.airborne && st.z > maxZ) maxZ = st.z;
      }
      return { perMin: n / (secs / 60), maxZ };
    };
    const gale = run(FULL_KT);
    const calm = run(0);
    // At the top of the scale it has to fly, and it has to get somewhere while it is up there.
    if (!(gale.perMin >= 4)) {
      fail.push(`the hydro never gets air: ${gale.perMin.toFixed(1)} launches a minute at ${FULL_KT} kt, the top of the sea scale — the launch is tuned against a sea that is no longer being drawn`);
    } else if (!(gale.maxZ >= 0.02)) {
      fail.push(`the hydro skitters rather than flies: ${gale.perMin.toFixed(1)} launches a minute at ${FULL_KT} kt but never above ${gale.maxZ.toFixed(3)} tiles — the threshold is doing the work the launch speed should be doing`);
    } else {
      ok.push(`the hydro gets air on the sea that ships (${gale.perMin.toFixed(1)}/min, peak ${gale.maxZ.toFixed(3)} tiles at ${FULL_KT} kt)`);
    }
    // ⚠ AND FLAT WATER STAYS FLAT, which is the control: a launch rate achieved by lowering the bar
    // far enough reaches a dead calm too, and would pass the check above on its own.
    if (calm.perMin > 0) fail.push(`the hydro leaves the water on a flat calm (${calm.perMin.toFixed(1)}/min) — the bar is below the sea's own noise`);
    else ok.push('the hydro stays on the water in a flat calm');
  }
}

// ── 22. AND THE WATER CLOSES OVER THE CAMERA ──────────────────────────────────────────────────
//
// Every seat is floored at 0.05 tiles above MEAN sea level and a crest reaches 0.404 at the top of
// the sea scale, so from about Force 4 a low camera goes under — measured over a long sweep, a
// camera at that floor in a 45-knot sea is beneath the surface 36.3% of the time. Nothing tested
// for it, and the mesh is drawn two-sided, so what you actually got was the UNDERSIDE of the waves
// wearing the sky reflection, the sun glitter and the whitecaps they wear from above.
{
  const WS = read('client/game/js/panels/windshield.js');
  const WAT = read('client/game/js/panels/gl/water.js');
  const SH = read(SHARED);

  // ⚠ THE FEATURE HAS TO BE REACHABLE, which is the first thing to check and the easiest to lose:
  // raise the camera floor or shrink the sea and this becomes a correct implementation of something
  // that never happens. It is asserted against the FLOOR READ OUT OF THE SOURCE rather than a 0.05
  // written here, so moving that floor moves this check with it.
  const fm = WS.match(/Math\.max\(0\.05, \(v\.eyeH/);
  const floor = fm ? 0.05 : null;
  if (!floor) fail.push('windshield.js: the camera eye-height floor could not be read');
  else {
    const gm = WS.match(/glSeaGain:\s*([\d.]+)/);
    const a = seaAmpsFor(45, gm ? +gm[1] : 1.5);
    let crest = -9;
    for (let i = 0; i < 120000; i++) {
      const u = ((i * 0.3717) % 400) - 200, v = ((i * 0.9113) % 400) - 200, t = (i * 0.0137) % 628;
      const h = seaHeight(u, v, t, a.roll, SEA_AMP, a.wind);
      if (h > crest) crest = h;
    }
    if (!(crest > floor)) {
      fail.push('the camera can never go under: the tallest crest at 45 kt is ' + crest.toFixed(3) + ' tiles against an eye floored at ' + floor + ' — the dunk is unreachable');
    } else ok.push('the dunk is reachable (crest ' + crest.toFixed(3) + ' tiles against an eye floored at ' + floor + ')');
  }

  // ⚠ AND IT IS A BAND, NEVER A BOOLEAN. At the waterline in a seaway the eye crosses the surface
  // several times a second, so a hard test flickers — and this codebase has an explicit no-strobe
  // rule. The check is that the answer is CONTINUOUS: swept down through the surface it must take
  // intermediate values rather than stepping 0 to 1.
  {
    const mids = new Set();
    for (let i = 0; i <= 200; i++) {
      const z = 0.10 - i * 0.001;
      const r = seaSubmersion(0, 0, z, 0, 0.12, SEA_AMP, 0.10);
      if (r.under > 0.02 && r.under < 0.98) mids.add(r.under.toFixed(3));
    }
    if (mids.size < 5) {
      fail.push('the dunk switches rather than blending: only ' + mids.size + ' intermediate values across a sweep through the surface — at the waterline that strobes');
    } else ok.push('the dunk blends through the surface (' + mids.size + ' intermediate values)');
  }

  // ⚠ AND A CAMERA CLEAR OF THE WATER IS NEVER UNDER, which is the control: a band wide enough to
  // pass the check above would also pass it by being permanently half-on.
  {
    let bad = 0;
    for (let i = 0; i < 4000; i++) {
      const u = (i * 0.37) % 80 - 40, v = (i * 0.91) % 80 - 40, t = (i * 0.137) % 628;
      if (seaSubmersion(u, v, 3, t, 0.155, SEA_AMP, 0.127).under > 0) bad++;
    }
    if (bad) fail.push('a camera three tiles above a 45-knot sea reports submerged in ' + bad + ' of 4000 samples');
    else ok.push('a camera clear of the water is never submerged');
  }

  // ⚠ THE BOUNDARY IS THE SEA'S OWN HEIGHT FUNCTION. A submersion test written from a second
  // expression — a mean level, a sea-state scalar, a sampled texture — disagrees with the surface it
  // is the boundary OF, so the effect switches on while you are visibly above the water.
  if (!/export function seaSubmersion[\s\S]{0,400}?seaHeight\(/.test(SH)) {
    fail.push('sea-swell.js: seaSubmersion does not call seaHeight — the boundary is a second expression of the surface');
  } else ok.push('the submersion boundary is the sea\'s own height field');

  // ⚠ AND "IS THERE WATER HERE" COMES OFF THE LUT, NOT OFF 'biomeBelow'. That field is what a CALLER
  // says is under the craft: the helm view sets it, the cockpit does not and no bench sets it at all,
  // so a gate on it is a gate on who happened to pass a string. Measured with that gate in place the
  // whole feature moved 0.00% of the frame and read exactly like a shader doing nothing.
  if (/glSeaDunk > 0 && v\.biomeBelow/.test(WS)) {
    fail.push("windshield.js: the dunk is gated on 'v.biomeBelow', which is a caller's string and is unset on most callers — gate on the LUT's waterness");
  } else if (!/glSeaDunk > 0 && _camWater/.test(WS)) {
    fail.push('windshield.js: the dunk gate no longer reads the LUT waterness at the camera tile');
  } else ok.push('the dunk gate reads the LUT waterness under the camera');

  // ⚠ TWO QUESTIONS, NOT ONE. "Is the CAMERA under" is one scalar and drives how much water you are
  // looking through; "is THIS fragment of surface seen from below" is per-pixel and decides whether
  // this piece of surface is a ceiling. The frame that matters most is the eye AT the waterline with
  // a crest between it and the horizon — half that surface is over you and half is still in front of
  // you, so a single camera-wide switch shades half of it wrong.
  if (!/uUnder > 0\.001 && !gl_FrontFacing/.test(WAT)) {
    fail.push('gl/water.js: the underside branch does not test gl_FrontFacing — a camera-wide switch shades the surface in front of you as though it were over your head');
  } else ok.push('the surface underside is a per-fragment test, not a camera-wide switch');

  // The glass keeps running after you surface, and it has to STOP. A latch here is a windscreen that
  // never dries for the rest of the session.
  if (!/st\.dunkWet = Math\.max\(0, st\.dunkWet - dt \/ DUNK_DRY_S\)/.test(WS)) {
    fail.push('windshield.js: the post-dunk wet glass does not decay — it would never dry');
  } else ok.push('the glass dries after a dunk');
}

// ── 23. AND A MAX STORM REACHES THE TOP OF THE SEA SCALE ──────────────────────────────────────
//
// Reported as the waves being weak in a storm, and it was one factor: the sea's target is
// 'Math.max(live wind, stormSeverity * SEA_FULL_KT * K)' and K was 0.7, so the worst weather the
// game can produce asked for 31.5 of a 45-knot scale and the top of it was unreachable in play.
//
// ⚠ AND THE 'Math.max' WAS NOT PROTECTING ANYTHING, WHICH IS WHY THE FRACTION WAS THE WHOLE SEA.
// The design is that WIND drives the sea and the storm grade only raises a floor under it. In
// practice the day's wind comes from a climate profile's 'monthly_wind_kph', every authored profile
// sits between 10 and 22 kph, 'windFromView' converts at 0.54, and NOTHING in environment.js puts a
// storm term on it — so the live wind tops out near twelve knots against a floor of thirty-one, and
// the floor has won on every frame in every weather since it was written.
//
// ⚠ THE FRACTION IS READ OUT OF THE SOURCE rather than restated, so this fails if somebody puts one
// back — the same shape as section 21, where a number fitted against another system's output went
// stale without anybody editing it.
{
  const WS = read('client/game/js/panels/windshield.js');
  const m = WS.match(/const target = Math\.max\(w\.kt \|\| 0, stormSeverity\(v\.weather, null\) \* SEA_FULL_KT([^)]*)\);/);
  if (!m) {
    fail.push('windshield.js: the sea-state target expression could not be read');
  } else {
    const tail = m[1].trim();
    if (tail !== '') {
      fail.push('a max storm cannot reach the top of the sea scale: the storm floor carries "' + tail
        + '", so the worst weather in the game asks for less than SEA_FULL_KT — and the live wind cannot make up the difference, because no authored climate profile exceeds ~12 kt');
    } else ok.push('a max storm reaches the top of the sea scale');
  }

  // ⚠ AND THE LADDER HAS TO BE MONOTONIC AND ACTUALLY SEPARATE, which is the control: a floor that
  // reached the top by clamping every storm to it would pass the check above and would make every
  // grade of weather produce one identical sea.
  const gm = WS.match(/glSeaGain:\s*([\d.]+)/);
  const G = gm ? +gm[1] : 1.5;
  const crest = (kt) => {
    const a = seaAmpsFor(kt, G);
    let hi = -9;
    for (let i = 0; i < 60000; i++) {
      const u = ((i * 0.3717) % 400) - 200, v = ((i * 0.9113) % 400) - 200, t = (i * 0.0137) % 628;
      const h = seaHeight(u, v, t, a.roll, SEA_AMP, a.wind);
      if (h > hi) hi = h;
    }
    return hi;
  };
  // ⚠ READ OUT OF THE SHARED SOURCE, not imported — section 21's own arrangement, so a change to
  // the top of the scale moves this check with it rather than past it.
  const FULL = +(read(SHARED).match(/SEA_FULL_KT = (\d+)/) || [0, 45])[1];
  const rungs = [0.25, 0.5, 0.75, 1].map((sv) => crest(FULL * sv));
  let bad = '';
  for (let i = 1; i < rungs.length; i++) {
    if (!(rungs[i] > rungs[i - 1] * 1.15)) bad = 'rung ' + i + ' is ' + rungs[i].toFixed(3) + ' against ' + rungs[i - 1].toFixed(3);
  }
  if (bad) fail.push('the storm ladder does not separate: ' + bad + ' — every grade of weather produces near enough the same sea');
  else ok.push('the storm ladder separates (crest ' + rungs.map((r) => r.toFixed(2)).join(' -> ') + ' tiles across quarter-severity steps)');
}

// ── 24. AND A WAVE LEANS FORWARD ──────────────────────────────────────────────────────────────
//
// Skewness and asymmetry are two different departures from a sine and coastal engineering keeps
// the words apart for a reason. SKEWNESS is vertical — sharp crests over broad troughs — and this
// sea has had it since the Stokes term shipped. ASYMMETRY is horizontal — the front face steeper
// than the back, the crest pitched forward — and it is the one that reads as a wave about to break.
// Measured before the lean went in, this sea's asymmetry was -0.003: perfectly symmetric.
//
// ⚠ IT IS THE THIRD MOMENT OF THE SLOPE, NOT OF THE SURFACE. A wave can be as skewed as you like
// and still symmetric front-to-back, so a check on the elevation cannot see this at all — which is
// exactly why it went unnoticed while the skewness claim sat there green.
{
  const SEA_FULL_KT_G = +(read(SHARED).match(/SEA_FULL_KT = (\d+)/) || [0, 45])[1];
  const A = seaAmpsFor(SEA_FULL_KT_G, 1.5);
  const N = 120000;
  let s1 = 0, s2 = 0, s3 = 0, face = 0, n = 0;
  for (let i = 0; i < N; i++) {
    const u = ((i * 0.3717) % 400) - 200, v = ((i * 0.9113) % 400) - 200, t = (i * 0.0137) % 628;
    const [du, dv] = seaSlope(u, v, t, A.roll, SEA_AMP, A.wind);
    s1 += du; s2 += du * du; s3 += du * du * du; n++;
    const fa = Math.atan(Math.hypot(du, dv)) * 180 / Math.PI;
    if (fa > face) face = fa;
  }
  const m = s1 / n, va = s2 / n - m * m;
  const asym = (s3 / n - 3 * m * va - m ** 3) / Math.pow(va, 1.5);
  if (Math.abs(asym) < 0.15) {
    fail.push('the waves do not lean: slope asymmetry ' + asym.toFixed(3)
      + ' — the surface is symmetric front-to-back, which is a sine with a sharpened crest');
  } else ok.push('the waves lean forward (slope asymmetry ' + asym.toFixed(3) + ')');

  // ⚠ AND THE FACE MAY NOT RUN AWAY, which is the control and the reason the gains were swept
  // rather than picked. The Stokes limiting wave has a 120-degree crest, which is a 30-degree face,
  // and a superposition already peaks a little past that; driven hard the harmonics put a notch in
  // the crest, which in a height field is a wave with a step cut out of it.
  if (face > 42) {
    fail.push('the sea is driven past breaking: steepest face ' + face.toFixed(1)
      + ' degrees against a limiting wave of 30 — the second-order terms are notching the crest');
  } else ok.push('the steepest face is ' + face.toFixed(1) + ' degrees (limiting wave is 30)');

  // ⚠ AND THE FOAM MOVES WITHOUT THE THRESHOLD MOVING. That threshold is inverted from an observed
  // coverage law, so biasing the TEST would foam the sea at the wrong fraction for its wind — the
  // shift has to be in the sampling POSITION, which leaves the distribution alone.
  const W = read('client/game/js/panels/gl/water.js');
  if (!/spF = sp - uWindDir \*[\s\S]{0,80}?seaChop\(spF/.test(W)) {
    fail.push('gl/water.js: the whitecap mask is not read downwind — foam sits symmetric about a crest that is not');
  } else if (!/wvT = wvF \+/.test(W)) {
    fail.push('gl/water.js: the tested field does not descend from the shifted sample');
  } else if (/if \(wv > th/.test(W)) {
    fail.push("gl/water.js: a whitecap threshold reads the UNSHIFTED 'wv', which also drives the surface shading");
  } else if (!/if \(wvT > thC\)/.test(W) || !/if \(wvT > thW\)/.test(W)) {
    fail.push('gl/water.js: the whitecap thresholds do not read the shifted sample');
  } else ok.push('the whitecap mask is read downwind, with its threshold untouched');
}
// ── 25. AND A BREAKING CREST THROWS WATER ─────────────────────────────────────────────────────
//
// Spindrift already existed and is a different thing: foam ALREADY TORN OFF, dragged downwind ALONG
// the surface, drawn in the water fragment shader. This is the water in the AIR, which is the half
// that reads as violence rather than as texture. Measured: 0 droplets below sea state 0.5, then
// 14 / 28 / 70 / 154 up the scale, and 0 with the flag off.
//
// ⚠ NO HEADLESS HARNESS CAN SEE A SPRITE — every one of them installs a GL hook that answers null
// and reaches no draw call — so what is checked here is the three things that are silent when
// wrong, and the picture is `sprayTally()` on a painted frame.
{
  const WS = read('client/game/js/panels/windshield.js');

  // ⚠ IT BREAKS WHERE THE WHITECAPS BREAK, OFF THE SHADER'S OWN THRESHOLD. `seaFoamThreshold` is the
  // quantile of the chop's own distribution at Monahan's observed coverage, and it is what the water
  // shader tests against — so asking it here means spray appears exactly where the sea is already
  // white. A second criterion, however reasonable, puts droplets in the air over unbroken water.
  if (!/function seaBreakAt[\s\S]{0,1800}?seaFoamThreshold\(/.test(WS)) {
    fail.push('windshield.js: the spray break test does not read seaFoamThreshold — spray would land somewhere the sea is not breaking');
  } else ok.push('spray breaks off the same threshold the whitecaps do');

  // ⚠ AND IT READS THE SAME TORN FIELD THE SHADER DOES. The threshold is the quantile of
  // `chop + tear`, so a break test sampling the smooth chop alone is measured against a cut made
  // for a field it is not reading — spray would appear a little away from the white water it is
  // meant to be coming off, which is exactly the kind of sub-tile slide that reads as art.
  if (!/function seaBreakAt[\s\S]{0,1800}?seaFoamTear\(/.test(WS)) {
    fail.push('windshield.js: the spray break test does not add the tear — it tests a smooth field against a torn threshold');
  } else ok.push('spray reads the same torn field the whitecaps do');

  // ⚠ AND THE GAIN IS RESOLVED IN ONE PLACE. The JS inversion, the uniform and this test all have to
  // be handed the same number; three readers of the tune key are three chances to read it at three
  // different moments, and the failure is a coverage drift nobody would look for.
  const gains = (blank(WS).match(/RENDER_TUNE\.glSeaTear/g) || []).length;
  if (gains !== 1) {
    fail.push('windshield.js: RENDER_TUNE.glSeaTear is read ' + gains + ' times — resolve it once in seaTearGain()');
  } else ok.push('the tear gain is resolved in one place');

  // ⚠ AND IT IS SPENT ONCE. 'uTear' arrives as SEA_FOAM_TEAR x the tune key — the RESOLVED amplitude,
  // and the same number the JS quantiled with — so a shader that multiplies by SEA_FOAM_TEAR again
  // tests a field nothing inverted a threshold for. Measured when it happened: 0.16 x 0.16 = 0.0256,
  // a foam edge that moved 2 cm, and every JS-side number still correct.
  {
    const G = read('client/game/js/panels/gl/sea-glsl.js');
    const i0 = G.indexOf('float seaFoamTorn(');
    const body = i0 < 0 ? '' : G.slice(i0, G.indexOf('\nfloat ', i0 + 10));
    if (body.length < 10) fail.push('gl/sea-glsl.js: seaFoamTorn not found');
    else if (!/return amt \* seaFoamTear\(q, t\);/.test(body)) {
      fail.push('gl/sea-glsl.js: seaFoamTorn does not return exactly amt * seaFoamTear(q, t) — a second factor there spends the amplitude twice');
    } else ok.push('the tear amplitude is spent exactly once');
  }

  // ── THE SHORT-WAVE FOAM FIELD ───────────────────────────────────────────────────────────────
  //
  // How BIG a whitecap is comes from the wavelengths of the field being thresholded, not from how
  // ragged its edge is — so the foam test carries two trains much shorter than the chop. Measured
  // on an air frame at 45 kt: 43 patches of mean 224 px became 80 of mean 69.
  {
    const G = read('client/game/js/panels/gl/sea-glsl.js');
    const W = read('client/game/js/panels/gl/water.js');

    // ⚠ IT MUST NOT REACH THE SURFACE. The mesh carries 5.4 samples across the SHORTEST chop train
    // as it is, so it cannot resolve a 0.17-tile wave — and a fragment normal describing a wave the
    // geometry is not drawing is the one thing this sea's own rules forbid outright. This field is
    // a statement about where water is BREAKING and about nothing else.
    for (const fn of ['seaRoll', 'seaWind', 'seaSlope', 'seaChop', 'seaHeight']) {
      const i0 = G.indexOf('float ' + fn + '(') >= 0 ? G.indexOf('float ' + fn + '(') : G.indexOf('vec2 ' + fn + '(');
      if (i0 < 0) continue;
      const body = G.slice(i0, G.indexOf('\nfloat ', i0 + 10) >= 0 ? G.indexOf('\nfloat ', i0 + 10) : G.length);
      if (/seaFoamFine\(/.test(body)) {
        fail.push('gl/sea-glsl.js: ' + fn + ' reads seaFoamFine — the short foam trains would be LIT on a surface that cannot resolve them');
      }
    }
    ok.push('the short foam trains stay out of the surface field');

    // ⚠ AND THE QUANTILE SEES IT, or the threshold is a cut made for a field nothing tests. This is
    // the same mismatch the tear made once and the coverage gate made once after it.
    const SH = read(SHARED);
    if (!/function quantiles[\s\S]{0,2500}?seaFoamFine\(/.test(SH)) {
      fail.push(SHARED + ': the whitecap quantile does not include seaFoamFine — the threshold would be cut for a field the shader does not test');
    } else ok.push('the whitecap quantile sees the short foam trains');

    // ⚠ AND IT RIDES THE SAME SWITCH AT BOTH ENDS. The shader gates it on uTear and the inversion
    // gates it on the same gain; gate one and not the other and the flag's 0 gets a threshold for a
    // field it is not testing, which is an off switch that changes how much of the sea breaks.
    if (!/seaFoamFine\(spF, uT\) \* step\(0\.0001, uTear\)/.test(W)) {
      fail.push('gl/water.js: the short foam trains do not ride the tear switch — the flag 0 would not be the sea as it shipped');
    } else ok.push('the short foam trains ride the same switch as the tear');
  }


  // ⚠ AND IT DOES NOT GO THROUGH `pushLight`, WHICH IS THE `shippingOn` TRAP AGAIN. That funnel opens
  // with `if (POWER_DUTY <= 0) return`, and POWER_DUTY is a property of the LAST BUILDING THE MODEL
  // PASS DREW — set per tile and left there. Sea spray asking it vanishes over open water whenever
  // the previous tile happened to be a blacked-out tower, and is silent about why.
  const body = WS.slice(WS.indexOf('function pushSpray('), WS.indexOf('function pushLight('));
  if (body.length < 10) fail.push('windshield.js: pushSpray not found');
  else if (/pushLight\s*\(/.test(body) || /POWER_DUTY/.test(body)) {
    fail.push('windshield.js: pushSpray routes through the building-power gate — a droplet is not a building light');
  } else ok.push('spray writes to the sprite sink directly, clear of the building-power gate');

  // ⚠ AND IT IS EMITTED WITH THE SINKS ARMED. They are opened inside drawWorldObjects, so a crest
  // that threw water from anywhere earlier reaches a null sink and paints on the canvas OVER the
  // composited city — the `emitGroundLate` bug one pass along, which is why this sits beside it.
  const iGround = WS.indexOf('const q = GROUND_LATE; GROUND_LATE = null;');
  const iSpray = WS.indexOf('SPRAY_TALLY = drawSeaSpray(');
  if (iSpray < 0) fail.push('windshield.js: drawSeaSpray is never called');
  else if (iGround < 0 || iSpray < iGround) {
    fail.push('windshield.js: spray is emitted before the sinks are armed — it would paint on the canvas over the city');
  } else ok.push('spray is emitted with the sprite sink armed');

  // And the flag exists, so there is a way back to the sea that shipped.
  if (!/glSeaSpray:\s*[\d.]+/.test(WS)) fail.push('windshield.js: glSeaSpray is not in RENDER_TUNE');
  else ok.push('spray has an off switch');

  // ⚠ AND MORE WIND MUST MEAN MORE BREAKING, which is the one half of this that IS checkable without
  // a rasteriser: the threshold falls monotonically as the wind rises, so a calm sea throws nothing
  // by arithmetic rather than by a guard.
  const th = [0, 10, 22, 34, 45].map((kt) => seaFoamThreshold(kt));
  let mono = true;
  for (let i = 1; i < th.length; i++) if (!(th[i] < th[i - 1])) mono = false;
  if (!mono) fail.push('the whitecap threshold is not monotonic in wind (' + th.map((x) => x.toFixed(2)).join(' ') + ') — spray would not track the sea state');
  else ok.push('the break threshold falls with wind (' + th.map((x) => x.toFixed(2)).join(' -> ') + ')');
}
for (const s of ok) console.log('  ✓ ' + s);
if (fail.length) {
  console.error('\n  — FAILURES (' + fail.length + ') —');
  for (const s of fail) console.error('  ✗ ' + s);
  console.error('\nsea FAILED');
  process.exit(1);
}
console.log('\n✓ sea — one swell, four readers, and the analytic slope is the slope.');
