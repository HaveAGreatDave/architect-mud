// Does anything in the renderer fill a path that isn't there?
//
// A canvas keeps its current path across `fill()`, so a face painted several times over — the base,
// the Gouraud ramp, the fog — describes its polygon ONCE and fills it three times. That is worth
// real money here: a headless tally of a city frame put path CONSTRUCTION (beginPath + moveTo +
// lineTo + closePath) at ~75% of all canvas2d calls, well above the texture blits everyone assumes
// are the expensive part.
//
// ⚠ IT ALSO CREATES A FAILURE MODE WITH NO SYMPTOM. The current path is NOT part of the state that
// `save`/`restore` carry, and several things in this file open paths of their own in the middle of
// drawing a face — `texTri` clips a path per column triangle, `drawTexQuad` does it twice. Reuse a
// path across one of those and `fill()` paints the LAST CLIP TRIANGLE, or nothing at all. There is
// no error, no warning, and the only evidence is a wall that is subtly the wrong shade or a fog
// overlay that silently stopped applying — on one branch, at one distance, in one weather.
//
// ── ⚠ AND THE DEFAULT SCENE DOES NOT REACH EITHER BRANCH ─────────────────────
// This is the part worth reading before touching the file. `viewRenderSmoke`'s world is an 8-tile
// window, so every building in it is nearer than FOG_NEAR (6) and every wall clears `wallLodPx` —
// which means the fast, obvious version of this gate exercised the TEXTURED, UNFOGGED wall and
// nothing else, and the textured unfogged wall is the one branch the change did not touch. A gate
// that green-lights the case you did not alter is not a gate.
//
// So the suite is driven four times with the tune pushed to force each combination: flat-fill vs
// textured, fogged vs not. `fog` is a strength multiplier on a distance ramp, so cranking it is how
// an 8-tile scene gets a fog overlay at all.
import { loadWindshield, stubCanvas } from './dom-stub.mjs';

const ws = await loadWindshield();
const el = stubCanvas('__path-ws', 1600, 900);
const inner = el.getContext('2d');

// A canvas's current path is cleared by beginPath and by nothing else — not by fill, not by stroke,
// not by restore. `clip` leaves it in place too, which is exactly what makes the texTri case
// dangerous rather than obvious.
const OPENS = new Set(['beginPath']);
const ADDS = new Set(['moveTo', 'lineTo', 'rect', 'roundRect', 'arc', 'arcTo', 'ellipse', 'quadraticCurveTo', 'bezierCurveTo']);
// fillRect / strokeRect / fillText do not read the current path, so they are deliberately not here.

let T = null;
const reset = () => (T = { pathLen: 0, sinceBegin: 0, fills: 0, strokes: 0, reused: 0, empty: [], counts: new Map() });
reset();

el.getContext = () => new Proxy({}, {
  get(_t, k) {
    const v = inner[k];
    if (typeof v !== 'function') return v;
    return (...a) => {
      T.counts.set(k, (T.counts.get(k) || 0) + 1);
      if (OPENS.has(k)) { T.pathLen = 0; T.sinceBegin = 0; }
      else if (ADDS.has(k)) T.pathLen++;
      else if (k === 'fill' || k === 'stroke') {
        if (k === 'fill') T.fills++; else T.strokes++;
        if (T.pathLen === 0 && T.empty.length < 12) T.empty.push(`${k}() on an empty path`);
        if (++T.sinceBegin > 1) T.reused++;
      }
      return v(...a);
    };
  },
  set(_t, k, v) { inner[k] = v; return true; },
});

const TUNE = ws.RENDER_TUNE;
const SAVED = { wallLodPx: TUNE.wallLodPx, fog: TUNE.fog };
// ⚠ `fog` is a strength multiplier on a squared distance ramp that is zero inside FOG_NEAR, and the
// smoke's world is 8 tiles across — so an ordinary 0.2 lands under the 0.004 threshold the overlay
// is gated on and no wall in this scene ever fogs. 20 is what it takes to make an 8-tile building
// fog at all. It changes only the overlay's alpha, and this gate counts calls, not pixels.
const PASSES = [
  { name: 'textured, no fog', wallLodPx: 0, fog: 0 },
  { name: 'flat-fill, no fog', wallLodPx: 1e9, fog: 0 },
  { name: 'textured + fog', wallLodPx: 0, fog: 20 },
  { name: 'flat-fill + fog', wallLodPx: 1e9, fog: 20 },
];

let bad = 0;
const check = (cond, what) => { if (!cond) { bad++; console.log(`  ✗ ${what}`); } };
const results = [];

// ⚠ PIN THE CLOCK AND THE DICE, WHICH THIS GATE NEVER DID AND EVERY OTHER BENCH HERE DOES. The
// four passes below are the SAME scene rendered four ways and compared by call count, so anything
// in the scene that rolls a die makes the comparison noise. It was latent for a fortnight and then
// stopped being latent: measured on 2026-09-20 it failed **four runs in five** standalone, with
// the fog delta swinging between −4,656 and +746 paths on a signal of about +750. Nothing was
// wrong with the renderer — the scatter, the flocks, the meteors and the drifting cloud deck are
// all unpinned, and the flock count alone moves thousands of fills.
//
// ⚠ AND IT IS RESEEDED PER PASS, not once at the top. Pinning at the top makes pass 1 differ from
// pass 4 by however far the sequence has advanced, which is the same bug with a smaller number.
// ⚠ AND `Date.now` IS A THIRD CLOCK, not a tidier spelling of the first two. The ambient bird
// flocks run on it BY DESIGN (it is written down as such), so pinning `performance.now` alone
// still leaves thousands of fills moving between passes — measured: five runs, deltas from −3,523
// to +1,139, every one of them different from the last.
const REAL_NOW = performance.now.bind(performance);
const REAL_RND = Math.random;
const REAL_DATE = Date.now;
const pinDice = () => {
  performance.now = () => 1e6;
  Date.now = () => 1758000000000;
  let s = 0x2545f49;
  Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
};
const unpinDice = () => { performance.now = REAL_NOW; Math.random = REAL_RND; Date.now = REAL_DATE; };

// ⚠ AND ONE THROWAWAY PASS FIRST, OR THE FIRST REAL ONE IS MEASURING THE CACHES. Shapes, meshes,
// wall textures and the moon face are all memoised on first sight, so pass 1 pays for every one of
// them and pass 4 gets them free — a systematic bias between the very passes this gate subtracts
// from each other. Same trap the motion sweep records: measuring both settings in one process
// reports the cache, not the flag.
// ── ⚠ AND A SCENE THE FOG CAN ACTUALLY REACH ─────────────────────────────────
//
// 'fogWeight' clamps to ZERO inside FOG_NEAR — 'clamp((f - 6) / 28, 0, 1)' — so a face nearer than
// six tiles cannot fog AT ANY AMOUNT. This gate used to lean on whatever happened to be standing
// past that line in the shared view smoke, and the whole fog signal was **56 fills out of 39,947**,
// which is 0.14% of the frame resting on a handful of faces just over the boundary. When those
// scenes changed the signal went to exactly zero and the gate reported the fog pass as "not
// running" — while fog was demonstrably live (it still tinted nine ground colours) and the reuse it
// exists to protect was still holding. A guard whose premise is an accident of somebody else's test
// fixture will keep going off for reasons that have nothing to do with what it guards.
//
// So the fog branch gets geometry it can definitely see: a corridor of shopfronts running from two
// tiles out to twenty, rendered onto the same tracked canvas in every pass so the deltas stay a
// comparison of like with like. Measured, it carries 240 fog fills where the shared smoke now
// carries none, and the count is identical at fog 20 and fog 200 — past a threshold every eligible
// face is already fogging, which is what a saturated overlay count should do.
const DEEP_R = 20, DEEP_N = DEEP_R * 2 + 1;
const DEEP_BARE = { kind: 'land', biome: 'badlands', flr: 0 };
const DEEP_MAP = Array.from({ length: DEEP_N }, (_, j) => Array.from({ length: DEEP_N }, (_, i) => {
  const dy = j - DEEP_R, dx = i - DEEP_R;
  return (dy < -1 && (dx === -2 || dx === 2))
    ? { kind: 'land', biome: 'citycore', bt: 'shop', flr: 3 } : DEEP_BARE;
}));
const deepScene = () => ws.paintWindshield('__path-ws', {
  cls: 'truck', phase: 'ground', worldBlend: 1, height: 0, eyeH: 0.12, speed: 0,
  hour: 13, weather: 'clear', map: DEEP_MAP, heading: 0,
  mapCenter: { x: 900, y: 900 }, mapOffset: { x: 0, y: 0 },
  wxField: null, acX: 900, acY: 900, tune: { gl: 0 },
});

pinDice(); reset(); ws.viewRenderSmoke('__path-ws'); deepScene(); unpinDice();

for (const p of PASSES) {
  reset();
  pinDice();
  TUNE.wallLodPx = p.wallLodPx; TUNE.fog = p.fog;
  const views = ws.viewRenderSmoke('__path-ws');
  deepScene();
  unpinDice();
  const paths = T.counts.get('beginPath') || 0;
  // ⚠ A CLIP PATH IS NOT A PAINT PATH. texTri lays a triangle and clips to it before every
  // textured blit, so a perspective-corrected surface emits one beginPath per cell with no fill
  // or stroke behind it. That is the blit doing its job, not a wall forgetting to reuse its
  // polygon, and the paths-per-paint bound below is about the latter — so the clips come off
  // first. Without this, subdividing a roof more finely reads as the one-path rule breaking.
  const clips = T.counts.get('clip') || 0;
  const build = ['beginPath', 'moveTo', 'lineTo', 'closePath'].reduce((s, k) => s + (T.counts.get(k) || 0), 0);
  const total = [...T.counts.values()].reduce((s, n) => s + n, 0);
  results.push({ ...p, paths, clips, fills: T.fills, strokes: T.strokes, reused: T.reused, build, total, ran: views.ran });

  check(T.empty.length === 0, `${p.name}: ${T.empty.length} fill/stroke call(s) reached an empty path — a blit clobbered a path something later reused:\n      ${T.empty.join('\n      ')}`);
  check(T.fills > 0 && views.ran > 0, `${p.name}: the suite painted nothing — the harness is not reaching the renderer`);
  check(T.reused > 0, `${p.name}: no path was ever filled twice — the one-path rule has been undone`);
}
TUNE.wallLodPx = SAVED.wallLodPx; TUNE.fog = SAVED.fog;

for (const r of results) {
  console.log(`  · ${r.name.padEnd(18)} ${String(r.paths).padStart(6)} paths / ${String(r.fills).padStart(6)} fills + ${String(r.strokes).padStart(5)} strokes  →  ${((r.paths - r.clips) / (r.fills + r.strokes)).toFixed(3)} paint paths per paint (+${r.clips} clips) · ${(r.build / r.total * 100).toFixed(0)}% of calls describe paths`);
}

// ── The assertion the old code could not have satisfied ──────────────────────
// Every paint used to carry its own path, so `paths ≥ fills + strokes` held by construction — the
// wall block described the same four points up to three times. A flat, fogged wall now lays them
// once and fills three times, which is the only way this ratio can drop below one. It is a bound
// rather than a golden number: nothing here depends on how many walls the scene happens to have.
const fogged = results.find((r) => r.name === 'flat-fill + fog');
check(fogged.paths - fogged.clips < fogged.fills + fogged.strokes,
  `flat-fill + fog still describes a path for every paint (${fogged.paths - fogged.clips} paint paths for ${fogged.fills + fogged.strokes} paints, ${fogged.clips} clips excluded) — the reuse is gone`);

// …and turning fog ON must cost fewer paths than it costs fills. Under the old code that was an
// equality by construction — every fog overlay laid its own four points down — so any margin at all
// is reuse that did not exist before.
//
// ⚠ IT IS A MARGIN AND NOT A ZERO, AND THE FIRST DRAFT OF THIS GATE GOT THAT WRONG. `wallLodPx`
// flattens WALLS; a roof is textured whichever way that knob is set, and drawTexQuad clobbers the
// path, so a fogged textured roof genuinely has to describe its polygon again. Asserting fog costs
// no paths at all failed here on exactly those roofs — correct code, wrong assertion.
const flatDry = results.find((r) => r.name === 'flat-fill, no fog');
const dPath = fogged.paths - flatDry.paths, dFill = fogged.fills - flatDry.fills;
check(dFill > 0, 'turning fog on added no fills — the pass is not running, so its path count proves nothing');
check(dPath < dFill,
  `fog cost ${dPath} paths for ${dFill} fills — every overlay is describing its own polygon again, which is the old behaviour`);
console.log(`  · fog costs ${dPath} paths for ${dFill} fills on the flat branch — ${dFill - dPath} overlays landed on a path that was already there`);

console.log(bad === 0
  ? '✓ pathreuse: every fill and stroke had a path under it, across all four wall branches — and overlays reuse the path beneath them'
  : `✗ pathreuse: ${bad} check(s) FAILED`);
process.exit(bad === 0 ? 0 : 1);
