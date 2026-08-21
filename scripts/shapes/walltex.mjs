// Is the baked day↔night wall crossfade the same picture as the two blits it replaced?
//
// A wall used to be painted twice: the day texture, then the night one over it at `alpha · NB`.
// `drawTexQuadP` splits a steeply-angled wall into up to twelve perspective-correct columns of two
// triangles, and every triangle is a save/clip/transform/drawImage/restore — so a near wall could
// cost 48 clipped blits, and a night city street from a truck cab is nothing but near walls at steep
// angles. It now composites the pair once into a cached 16×32 canvas and blits that.
//
// Two things could be wrong with that and neither is visible from inside the renderer.
//
// FIRST, THE PICTURE. "Bake the crossfade instead of blitting it twice" is only sound because
// source-over of two opaque layers at a fraction is the same as one layer of the mixed colour — at
// full opacity. It is NOT the same when the wall itself is translucent, which every building in the
// horizon haze band is. So this asserts the identity against an independent software compositor
// rather than against the formula in the comment: `over()` below is written from the Porter-Duff
// definition and knows nothing about what windshield.js claims.
//
// SECOND, THE CACHE. The bake is only cheaper if "once" is true. Keyed wrong it would either
// reallocate a canvas per NB step (churn through a dusk) or leak one per biome per step into a map
// that never evicts — WALL_COL has some 250 palettes, so that is thousands of canvases nobody would
// ever notice until a long session went slow. So this counts document.createElement('canvas') while
// sweeping the whole ramp and demands the count stay flat.
import { loadWindshield } from './dom-stub.mjs';

const { wallTexMixed } = await loadWindshield();

let checks = 0, bad = 0;
const check = (cond, what) => { checks++; if (!cond) { bad++; if (bad <= 10) console.log(`  ✗ ${what}`); } };

// ── 1. The picture ───────────────────────────────────────────────────────────
// Porter-Duff source-over of an opaque source at coverage `a` onto `dst`. One channel; the three
// are independent so one is the whole proof.
const over = (dst, src, a) => src * a + dst * (1 - a);

const CH = [0, 12, 60, 128, 200, 255];        // background, day and night channel values
const NBS = [0, 0.05, 0.25, 0.5, 0.75, 0.95, 1];
const ALPHAS = [1, 0.98, 0.75, 0.5, 0.25, 0.03];
const EPS = 1e-12;

let worstOpaque = 0, worstTermErr = 0;
for (const B of CH) for (const D of CH) for (const N of CH) for (const NB of NBS) for (const alpha of ALPHAS) {
  const twoBlit = over(over(B, D, alpha), N, alpha * NB);
  const oneBlit = over(B, over(D, N, NB), alpha);          // the baked mix, then one blit
  const diff = twoBlit - oneBlit;
  if (alpha === 1) {
    worstOpaque = Math.max(worstOpaque, Math.abs(diff));
    check(Math.abs(diff) < EPS, `opaque wall differs: B=${B} D=${D} N=${N} NB=${NB} → ${diff}`);
  } else {
    // ⚠ The documented term. If somebody changes the blit order, the alpha the composite is drawn
    // at, or premultiplies differently, this is the line that notices — the comment in
    // windshield.js states this exact expression and nothing else in the codebase checks it.
    worstTermErr = Math.max(worstTermErr, Math.abs(diff - alpha * NB * (1 - alpha) * (D - B)));
    check(Math.abs(diff - alpha * NB * (1 - alpha) * (D - B)) < 1e-9,
      `translucent delta is not the documented term: B=${B} D=${D} N=${N} NB=${NB} a=${alpha}`);
  }
}
console.log(`  · opaque walls identical to ${worstOpaque === 0 ? 'the byte' : worstOpaque.toExponential(1)}; the fade-band delta matches α·NB·(1−α)·(D−B) to ${worstTermErr.toExponential(1)}`);

// …and the direction of that delta is worth pinning too, because it is the reason the change is an
// improvement rather than a tolerated regression: the two-blit form composited the night pass onto a
// wall that was ALREADY partly transparent, so a ghosting building came out under-nighted.
{
  const B = 20, D = 200, N = 40, NB = 1, alpha = 0.4;      // full night, a mid-fade wall, dark sky
  const twoBlit = over(over(B, D, alpha), N, alpha * NB);
  const oneBlit = over(B, over(D, N, NB), alpha);
  check(twoBlit > oneBlit, 'the old two-blit form was not the lighter (under-nighted) one — check the premise');
}

// ── 2. The cache ─────────────────────────────────────────────────────────────
const BIOMES = ['citycore', 'uptown', 'marquee', 'freight', 'industrial', 'oldcoldwater', 'docks', 'civic', 'ruins', 'infra'];

// The ends short-circuit to the baked variants themselves, so full day and full night — most of the
// clock — composite nothing at all.
for (const b of BIOMES) {
  const day = wallTexMixed(b, 0), day2 = wallTexMixed(b, 0.0001);
  const nite = wallTexMixed(b, 1), nite2 = wallTexMixed(b, 0.9999);
  check(day === day2, `${b}: NB just above 0 did not short-circuit to the day texture`);
  check(nite === nite2, `${b}: NB just below 1 did not short-circuit to the night texture`);
  check(day !== nite, `${b}: day and night are the same object`);
  const mid = wallTexMixed(b, 0.5);
  check(mid !== day && mid !== nite, `${b}: the mid-crossfade handed back a baked variant`);
  check(mid.width === day.width && mid.height === day.height, `${b}: the composite is not the texture's size`);
}

// Warm every baked variant first — those legitimately allocate, once each, through the texture
// cache. What must NOT grow is the composite.
for (const b of BIOMES) { wallTexMixed(b, 0); wallTexMixed(b, 1); wallTexMixed(b, 0.5); }

const realCreate = globalThis.document.createElement;
let canvases = 0;
globalThis.document.createElement = (t) => { if (String(t).toLowerCase() === 'canvas') canvases++; return realCreate(t); };

// Sweep the whole ramp, forwards and back, several times over — a dusk and a dawn and a dusk.
for (let pass = 0; pass < 3; pass++) {
  for (let i = 0; i <= 200; i++) {
    const nb = pass % 2 ? 1 - i / 200 : i / 200;
    for (const b of BIOMES) wallTexMixed(b, nb);
  }
}
globalThis.document.createElement = realCreate;

check(canvases === 0, `sweeping NB allocated ${canvases} canvas(es) — the composite is reallocating instead of redrawing in place`);
console.log(`  · ${BIOMES.length} biomes × 603 NB samples across three ramps allocated ${canvases} canvases`);

// Identity: the same biome at the same NB step must hand back the same object, or nothing upstream
// can rely on it (the `minify` test reads .width/.height off it every wall).
for (const b of BIOMES) {
  const a = wallTexMixed(b, 0.37);
  check(a === wallTexMixed(b, 0.37), `${b}: the same NB handed back two different canvases`);
  // Quantisation: NB values inside one step share a canvas AND its contents; a step apart they must
  // still share the canvas (redrawn in place) rather than allocate a second.
  check(wallTexMixed(b, 0.37) === wallTexMixed(b, 0.62), `${b}: a different NB step allocated a second canvas`);
}

// Distinct biomes must never share one — that would be every wall in the city wearing one palette.
{
  const seen = new Map();
  for (const b of BIOMES) {
    const c = wallTexMixed(b, 0.5);
    const prior = seen.get(c);
    check(prior === undefined, `${b} shares its composite canvas with ${prior}`);
    seen.set(c, b);
  }
}

console.log(bad === 0
  ? `✓ walltex: ${checks} checks passed — the baked crossfade is the same picture and the cache holds`
  : `✗ walltex: ${bad} of ${checks} checks FAILED`);
process.exit(bad === 0 ? 0 : 1);
