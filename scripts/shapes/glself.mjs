// IS A BUILDING'S OWN ADORNMENT DRAWING THROUGH ITS OWN MASS?
//
// There was no harness for this, and that is how the Solenne bug survived a fix aimed at exactly
// it. `__glLeak` puts a WALL between the camera and a subject and measures what comes through, so
// it answers "does this model draw through the building in front of it". It cannot see a band
// wrapped round a tower whose far arc is dragged out in front of the tower ITSELF — there is no
// second building in the scene, and the thing doing the occluding is the subject.
//
// ⚠ AND THAT CLASS IS THE ONE THE DEPTH BUFFER WAS SUPPOSED TO HAVE ENDED. Every adornment that
// reaches GL is depth-tested, so the geometry is right by construction — except that each one is
// first slid toward the eye along its own view ray, to stop it z-fighting the surface it lies on.
// That slide is a per-call-site number, and if it is larger than the building has to give, it drags
// the adornment out through the mass. A building's own near wall is about 0.44 tiles from its tile
// centre; `DECO_LIFT` is 0.6. `emitDecoQuad` and `emitDecoFill` were capped at `DECO_PULL` when
// that was found and `emitWire` was missed, which is every stroke in the city.
//
// ⚠ THE MEASUREMENT IS A DIFFERENCE, NOT AN ESTIMATE. The sink stores the pulled point and nothing
// records where it came from, so the pull is unreadable from a finished frame. Each arm is run
// TWICE — once normally, once with `PULL_OFF` — and the two sinks are compared item by item. The
// first run is where the renderer will draw it; the second is where it physically is. A leak is an
// item that is behind its own mass in the second and in front of it in the first.
//
// ⚠ AND THE OCCLUDER IS THE MODEL'S OWN SOLID, the same `modelSolid` CFIT collides against and the
// occlusion bake samples. So a corner that reads as hidden here is hidden by geometry that is
// really there, rather than by a silhouette this file drew for itself.
//
//   node scripts/shapes/glself.mjs            # gate
//   node scripts/shapes/glself.mjs --report   # every leaking model, with the worst offenders
import { loadWindshield } from './dom-stub.mjs';
import { eyePos } from '../../client/game/js/panels/gl/camera.js';

const ws = await loadWindshield();
const REPORT = process.argv.includes('--report');

const FH = 0.4, H = 1, SEED = 3;
// Two tiles, which is where a cab actually sits beside a frontage — and inside `DETAIL_PX`, so the
// derived kit is emitted at all. `glresidue` records what the default 8 tiles costs: nothing is
// collected, and the census reports a clean city while saying nothing about any of it.
const DX = 0, DY = -2;
const cam = ws.makeCam(640, 160, 360, { heading: 0, height: 0, eyeH: 0.24, map: null });
// The eye in the frame the sinks are in. `eyePos` solves the view matrix's own translation for the
// point that lands at the origin of camera space — the same call world.js makes for the specular.
const EYE = eyePos(cam);

// ⚠ SAMPLED ALONG THE SEGMENT, AND THE COUNT IS A FLOOR NOT A PREFERENCE. A wall here is about
// 0.05 tiles thick at its thinnest and the eye is a few tiles away, so a coarse march steps clean
// over a facade and reports every sign on it as unoccluded — which is a gate that passes everything.
const STEPS = 160;

// Does the open segment from `p` to the eye pass through the model's own solid? Local coordinates:
// the solid is built about the tile's own origin and the sinks are in camera-relative tiles.
function hidden(solid, p) {
  const ex = EYE[0] - DX, ey = EYE[1] - DY, ez = EYE[2];
  const lx = p[0] - DX, ly = p[1] - DY, lz = p[2];
  for (let i = 1; i < STEPS; i++) {
    const t = i / STEPS;
    if (solid(lx + (ex - lx) * t, ly + (ey - ly) * t, lz + (ez - lz) * t)) return true;
  }
  return false;
}

// Every adornment in a sink pair, as (drawn, true) point couples with a tag for the report.
function* couples(a, b) {
  const n = Math.min(a.strokes.length, b.strokes.length);
  for (let i = 0; i < n; i++) {
    // A wire is two endpoints and either can be the one that got dragged out.
    yield ['stroke', a.strokes[i].a, b.strokes[i].a];
    yield ['stroke', a.strokes[i].b, b.strokes[i].b];
  }
  const m = Math.min(a.decals.length, b.decals.length);
  for (let i = 0; i < m; i++) {
    const key = String(a.decals[i].key || 'decal').split('|')[0];
    for (let c = 0; c < a.decals[i].p.length && c < b.decals[i].p.length; c++) {
      yield ['decal:' + key, a.decals[i].p[c], b.decals[i].p[c]];
    }
  }
  // ⚠ SPRITES ARE NOT IN THIS LIST, AND THAT IS A STATEMENT RATHER THAN AN OMISSION. A light takes
  // no unproj pull at all — it gets a fixed nudge in CLIP z inside the vertex shader, which cannot
  // move it through a wall because it is a tie-breaker in the depth test and not a change of
  // position. There is nothing here for a difference to find, and `PULL_OFF` does not touch them.
}

const leaks = new Map();      // model → { n, tags: Map }
const byTag = new Map();
let models = 0, threw = 0, checked = 0, movedPts = 0;

for (const { key, m } of ws.shapeModelRegistry()) {
  models++;
  let solid = null;
  try { solid = ws.modelSolid(m, SEED, FH, H); } catch { solid = null; }
  // A model whose shape will not capture has no claim about its own volume, so it cannot be
  // measured — the same rule the occlusion bake follows rather than assuming an empty one.
  if (!solid) continue;

  const opts = { cam, night: 1, bn: 'THE EXAMPLE', dx: DX, dy: DY, fh: FH, h: H, seed: SEED, collect: true };
  const drawn = ws.canvasResidue(m, opts);
  const truth = ws.canvasResidue(m, { ...opts, noPull: true });
  if (drawn.threw || truth.threw) { threw++; continue; }
  if (!drawn.sink || !truth.sink) continue;

  for (const [tag, A, B] of couples(drawn.sink, truth.sink)) {
    if (!A || !B) continue;
    checked++;
    // Untouched by the pull — nothing to test. Cheap, and it skips most of the city.
    const d = Math.abs(A[0] - B[0]) + Math.abs(A[1] - B[1]) + Math.abs(A[2] - B[2]);
    if (d < 1e-9) continue;
    movedPts++;
    if (!hidden(solid, B)) continue;      // it was never behind its own mass — the pull rescued nothing
    if (hidden(solid, A)) continue;       // still behind it after the pull — the depth buffer has it
    const e = leaks.get(key) || { n: 0, tags: new Map() };
    e.n++; e.tags.set(tag, (e.tags.get(tag) || 0) + 1);
    leaks.set(key, e);
    byTag.set(tag, (byTag.get(tag) || 0) + 1);
  }
}

// ── THE ALLOW-LIST ──────────────────────────────────────────────────────────
//
// ⚠ REASONS, NEVER COUNTS, for the argument `glresidue` makes at length: a budget passes a new leak
// the moment somebody deletes an old one. An entry says why that part is authored INSIDE its host
// and therefore has to be pulled clear of it — which is a real category, not an excuse. A mast
// stands at its tile's centre with the front wall 0.44 tiles nearer; a fire stair is bolted to a
// wall it is physically within. Those must come out, or they are simply not drawn.
//
// ⚠ AND A BUDGET BESIDE EACH REASON, because a reason on its own is too coarse HERE in a way it is
// not in `glresidue`. The tag is the painter, and `emitWire` draws the mast that is supposed to be
// pulled clear AND the band that is not — so a regression inside an allowed category would be
// silently allowed. The numbers are committed: the total fell from 1,576 to 516 when `drawRing`
// stopped spending the full lift, and putting that one argument back takes it straight back up,
// which is the mutation test this gate was checked with.
const KNOWN = new Map([
  ['stroke', { budget: 460, why:
   'masts, fire stairs, catwalk rails and guy wires are authored INSIDE the host they hang off — a '
   + 'mast at its tile centre is 0.44 tiles behind its own front wall — so `emitWire` still spends '
   + 'the full DECO_LIFT and they are pulled clear on purpose. The Dynamo lost its entire external '
   + 'stair when they were not. ⚠ THE COST OF THAT IS EVERY OTHER STROKE, and it is why `drawRing` '
   + 'now asks for DECO_PULL explicitly: a band hugging a tower is not inside anything, and pulled '
   + '0.6 of a tile its far arc came out in front of the building as a closed ellipse.' }],
  // ⚠ THE NUMBER WENT 33 → 98 WHEN THE BLADE BECAME A BOX, AND THAT IS THE SHAPE CHANGING RATHER
  // THAN A REGRESSION. It was ONE quad and is now four — a lettered front, a dark back and two edge
  // returns — so it offers four times the points to this test. Per quad it got BETTER: 33 for the
  // single face before, 24.5 each for the four now, because a face built in world units sits where
  // the building actually is instead of at a screen-space half-width. If this climbs again without
  // the part gaining geometry, that is the regression this budget is here to catch.
  ['decal:blade', { budget: 41, why:
   '`neonBlade` mounts its anchor INSIDE the facade — on type:bar, 0.16 of a tile forward against a '
   + 'front wall at 0.328 — because the painter\'s queue always sorted it clear and nobody ever had '
   + 'to place it properly. At a tie-breaker pull the wall wins and the only part of the sign that '
   + 'draws is whatever crests the roofline, which is the sign not working. `BLADE_PROUD` is the '
   + 'named exception and 0.25 is measured: it clears the deepest facade and stays under the near '
   + 'face of a building one tile in front. The SIDES answer to the same reason and are keyed '
   + `'blade|…'` + ' so they land here: they share the anchor and the pull, and counted as plain '
   + 'solids they would spend the recessed-doorway budget, which is a different part entirely.' }],
  ['decal:gantry', { budget: 38, why:
   'a rooftop hoarding stands at its own tile CENTRE on legs, so its back board, its soffit and the '
   + 'far edge return are inside the roof mass they are standing on — the same shape of reason as the '
   + 'mast in `stroke`, and the same fix: they have to come out or they are simply not drawn. It is '
   + 'here rather than in `decal:solid` because only the quads carrying a PER-TILE name take '
   + 'the canvas path at all (a shared mesh cannot hold the name of one building), and counting '
   + 'against the recessed-doorway budget would make that number stop meaning anything.' }],
  // ⚠ THIS FELL 20 → 2 WHEN THE GANTRY GOT ITS OWN TAG, AND NOTHING WAS FIXED TO MAKE IT FALL.
  // Almost the whole of the old budget was rooftop hoardings arriving here unnamed, under a reason
  // that talks about doorways. The number was real and the label was wrong, which is the failure a
  // shared catch-all category has: it passes because it is big, and it is big because of something
  // nobody meant to put in it. 2 is what the doorways actually cost.
  ['decal:solid', { budget: 2, why:
   'the recessed doorway panels. `emitDecoFill` is already capped at DECO_PULL, and these are the '
   + 'few that are authored far enough INTO their own facade that even a 0.05 tie-breaker brings '
   + 'them out — which is what the cap exists to do. Its own note names the case: the three arms '
   + 'taking the default would otherwise send a doorway panel out through its own facade. '
   + '⚠ 12 → 20 WHEN `standOnMass` LANDED, and the 8 are a consequence of parts being placed '
   + 'CORRECTLY rather than of anything moving into its host. Roof plant that used to hang inside '
   + 'a crown box now stands on the deck beside it — asc_spire 3, halcyontowers 5, type:bank — so '
   + 'a condenser side is flush against the plant room it is pushed up against, which is what a '
   + 'real roof looks like and is exactly the coplanar case a tie-breaker pull is for. Standing '
   + 'them a hair proud instead was tried and measured: this went 20 → 22 (the leak is the SIDES, '
   + 'not the base) and `anchored` went 14 → 18 buried, because lifting a body raises its midpoint '
   + 'into the box above it.' }],
]);

const rows = [...leaks.entries()].sort((a, b) => b[1].n - a[1].n);
if (REPORT) {
  console.log(`\n  self-occlusion census — ${models} models, ${checked} adornment points, ${movedPts} moved by a pull\n`);
  for (const [tag, n] of [...byTag.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(6)}  ${tag}${KNOWN.has(tag) ? '   (allowed)' : ''}`);
  }
  console.log('');
  for (const [key, e] of rows.slice(0, 20)) {
    console.log(`  ${String(e.n).padStart(5)}  ${key}   ${[...e.tags.entries()].map(([t, n]) => t + ' ' + n).join(', ')}`);
  }
  console.log('');
}

const problems = [];
for (const [tag, n] of byTag) {
  const k = KNOWN.get(tag);
  if (!k) {
    const worst = rows.filter((r) => r[1].tags.has(tag)).slice(0, 3).map((r) => r[0]).join(', ');
    problems.push(`${tag} is not declared — ${n} points drawing through their own building, worst: ${worst}`);
  } else if (n > k.budget) {
    const worst = rows.filter((r) => r[1].tags.has(tag)).slice(0, 3).map((r) => r[0]).join(', ');
    problems.push(`${tag} leaks ${n} points against a committed ${k.budget} — worst: ${worst}`);
  }
}
// ⚠ A BUDGET THAT HAS FALLEN IS A FINDING TOO, and the only one this file reports as good news. It
// is not a failure — somebody fixed something — but leaving the old number in place means the next
// regression has that much room to hide in before anything goes red.
for (const [tag, k] of KNOWN) {
  const n = byTag.get(tag) || 0;
  if (n < k.budget) console.log(`  · ${tag} is down to ${n} from a committed ${k.budget} — re-bless it in glself.mjs`);
}

console.log(`  · ${checked} adornment points over ${models} models; ${movedPts} are moved by a pull`);
console.log(`  · ${[...byTag.values()].reduce((a, b) => a + b, 0)} of those come out in front of their own mass, over ${leaks.size} models`);
if (threw) console.log(`  · ${threw} model(s) threw and were skipped`);

if (problems.length) {
  console.error(`\n✗ glself — ${problems.length} problem(s):`);
  for (const p of problems) console.error('  ' + p);
  console.error('\n  Either give the part a smaller pull (DECO_PULL is the tie-breaker for anything');
  console.error('  that merely lies ON a surface), or add a REASON to KNOWN in this file saying why');
  console.error('  it is authored inside its own host. A number on its own is not a reason.');
  process.exit(1);
}
console.log(`✓ glself: every adornment pulled out of its own mass is one of ${KNOWN.size} declared reasons, each inside its committed budget.`);
