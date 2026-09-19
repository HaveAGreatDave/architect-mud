// WHAT THE WORLD PASS STILL PAINTS ON THE CANVAS, OVER THE COMPOSITED CITY?
//
//   node scripts/shapes/worldresidue.mjs            # gate: fails on an unlisted painter
//   node scripts/shapes/worldresidue.mjs --report   # both tallies, side by side
//
// `glresidue` asks this question of a BUILDING MODEL, one at a time, out of the model registry. It
// is the right question asked of half the frame: a model arm draws what a building WEARS, and
// everything a building STANDS AMONG — the traffic signals, the street lamps, the people on the
// pavement, the roadside scatter — is drawn by the world sweep, which that census never runs. So the
// painters the reports name by hand ("traffic lights show thru buildings") had never been measured,
// and the gate written for exactly this class could not see them.
//
// ⚠ AND THE PROBE IS WEAKER OUT HERE. A model's adornments are on the depth buffer. Anything left on
// the 2-D canvas is painted AFTER the GL composite, with `decoHidden`/`groundHidden` the only thing
// between it and a tower — and those answer per SURFACE, hidden only when the WHOLE of it is
// covered. A signal head half behind a building is both the common case and the one they
// deliberately answer "draw" to.
//
// What this found, which is not what the reports assumed: the street lamps and the roadside scatter
// are ALREADY on the depth buffer in a GL frame. Exactly one painter is not.
//
// ⚠ AND IT SAID "AND THE PAVEMENT ACTORS" FOR MONTHS, WITH NO ACTOR IN THE SCENE. `VIEW` carried
// neither `actors` nor `roadside`, so the pedestrian pass was never once run by the census written
// to find exactly this class — and the pedestrians were the one ground object that had NOT joined
// the billboards, queueing through `emitFace` to paint over the composited city with an
// all-or-nothing probe at their feet as the only thing in the way. A gate that reports on a painter
// it does not run is worse than no gate, because it is quoted. They are in the scene now, and in
// the control list below, so their absence fails this for its own reason.
//
// ⚠ IT RUNS THE FRAME TWICE, AND THE CONTROL IS NOT OPTIONAL. An empty tally is the answer this
// check most wants to give and the one it is least entitled to: it is also what comes back when the
// scene contained no street furniture at all. That happened twice while this was being written —
// the first map set `surf: 'road'` where drawTrafficSignals reads `c.road`, the second put the
// junction under the camera where the near clip drops it — and both times the census reported a
// clean city. So the GLASS 1 frame is a CONTROL: the painters have to show up there, or this fails
// for its own reason rather than passing for the renderer's.
import { loadWindshield, stubCanvas } from './dom-stub.mjs';

const ws = await loadWindshield();
const REPORT = process.argv.includes('--report');
const W = 640, H = 360;
stubCanvas('__wr', W, H);

// A CROSSROADS AHEAD, WITH A FRONTAGE EITHER SIDE — the scene the reports are about: a signal head
// and a lamp column with a building standing between them and the camera.
//
// ⚠ THE FIELDS ARE THE ONES THE PAINTERS TEST. drawTrafficSignals wants `c.road` and an `rd`
// DIRECTION STRING of three or more letters (isJunction); drawStreetLamps wants `c.sl`. And the
// junction has to be AHEAD: the camera sits at the window centre and the near clip drops a tile at
// its own feet, so a crossing on the centre tile is a crossing nothing draws.
const N = 41, R = 20, CROSS = R - 6;
const dirsAt = (x, y) => (x === R && y === CROSS) ? 'nesw' : x === R ? 'ns' : y === CROSS ? 'ew' : null;
const map = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => {
  const rd = dirsAt(x, y);
  if (rd) return { kind: 'land', biome: 'city', flr: 0, road: 1, rd, pw: 1, sl: ((x + y) % 4 === 0) ? 1 : undefined };
  // ⚠ AND THE ECHELON, BECAUSE THIS CENSUS COULD NOT SEE HER EITHER. The same gap the pedestrians
  // sat in: `drawYacht` paints through the world sweep and no scene here had ever contained one, so
  // a two-tile ship painting over the whole city was invisible to the gate written to find exactly
  // that. Her hull is in gl/solids.js and her fittings — the pad ring, the rails, the mast, the deck
  // lamps, the sidelights and the wake — followed it there, so she declares nothing and leaves
  // nothing. That she leaves nothing is a claim this file is the only thing that checks.
  if (x === R - 5 && y === CROSS - 3) return { kind: 'land', biome: 'water', road: 0, mark: 'yacht', heading: 40, wake: { spd: 0.2 }, flr: 0 };
  // …AND A BERTH WITH A FREIGHTER IN IT, for the Echelon's reason exactly. She is the second ship
  // in the game and the same census could not see her either: her hull goes to gl/solids.js and
  // her fittings — the mast, the derrick posts, the handrail, the deck lamps and the wake — are
  // emitted inline beside it, so like the yacht she should leave nothing behind. Unlike the yacht
  // she has a canvas FALLBACK that declares itself (`keptOnCanvas('freighter')`), and a declared
  // reason is only worth anything if a scene actually reaches it.
  // ⚠ THE CYCLE IS FORCED, not left to the clock. `berthPhase` is a function of wall time, so an
  // unforced berth is empty for a third of every cycle — and a census that silently draws no ship
  // is the vacuous control this file's own header is about. `RENDER_TUNE.shipForce` is pinned below.
  if (x === R - 7 && y === CROSS - 4) return { kind: 'land', biome: 'water', road: 0, mark: 'berth', bf: 'north', bq: 'west', flr: 0 };
  const near = Math.abs(x - R) <= 2 || Math.abs(y - CROSS) <= 2;
  return near
    ? { kind: 'land', biome: 'city', flr: 0, bt: 'shop', is_building: 1, floors: 4 }
    : { kind: 'land', biome: 'city', flr: 0 };
}));

const VIEW = {
  cls: 'truck', variant: 'hauler', phase: 'ground', worldBlend: 1, height: 0, eyeH: 0.12, fovMul: 1.22,
  // Night: the lamps, the signal lenses and the lit scatter are all night-gated, and a daylight
  // census would miss most of the surface this exists to find. Same reason glresidue picks night.
  hour: 22, weather: 'clear', speed: 0.2, map, heading: 0,
  mapCenter: { x: 100, y: 100 }, mapOffset: { x: 0.1, y: -0.2 },
  // PEOPLE, on the pavement and out on the verge. Both figure passes read these and neither runs
  // at all without them, which is how this census came to carry a claim about painters it had
  // never executed. Placed AHEAD of the camera (forward is -y at heading 0) and off the centreline,
  // where the near clip keeps them and the kerb snap has somewhere to put them.
  actors: Array.from({ length: 12 }, (_, i) => ({ t: 'wr' + i, x: 100 + ((i % 4) - 2) * 0.4, y: 100 - 2 - (i % 6) })),
  roadside: { x: 100.8, y: 100 - 9, t: 'wrhh' },
};

// ⚠ THE CLOCK IS PINNED BUT NOT STUCK, AND THE PEOPLE ARE WHY. An actor seen for the first time is
// born at the current time and fades in over FADE_MS; with a clock that never advances, the age of
// every figure is 0 on every frame for ever, the alpha never clears the 0.03 cull and not one
// figure is drawn. A
// frozen clock and a pass that has been deleted look identical from here. So the settle frame and
// the census frame sit FADE_MS apart, deliberately, and it is still a fixed pair rather than wall
// time — nothing drifts between runs.
const FADE_MS = 900;
const clock = globalThis.performance;
let T = 1e6;
globalThis.performance = { ...clock, now: () => T };
const glWas = ws.RENDER_TUNE.gl, floorWas = ws.RENDER_TUNE.glFloor, shipWas = ws.RENDER_TUNE.shipForce;
// The berth, pinned mid-load. Left to the clock it is empty for a third of every cycle, and a
// census whose ship happened not to be there would report a clean canvas for the wrong reason.
ws.RENDER_TUNE.shipForce = 0.55;

let sinks = null;
function tally(glOn) {
  ws.RENDER_TUNE.gl = glOn ? 1 : 0;
  ws.RENDER_TUNE.glFloor = glOn ? 1 : 0;
  if (glOn) {
    // ⚠ THE HOOK HAS TO RETURN A CANVAS, NOT MERELY A TRUTHY OBJECT. `if (out && out.canvas)` is
    // what counts as having drawn; anything else is the no-WebGL2 path, which puts RENDER_TUNE.gl
    // back to 0 and paints the NEXT frame in 2-D — so the census comes back holding the whole city
    // and reads as two thousand faces of residue that are only the other renderer working.
    const c = globalThis.document.createElement('canvas');
    c.width = W; c.height = H;
    ws.installGLWorld((cells, cam, o) => {
      sinks = { strokes: (o.strokes || []).length, sprites: (o.sprites || []).length,
                decals: (o.decals || []).length, ground: (o.ground || []).length };
      return { faces: 1, canvas: c };
    });
  } else ws.installGLWorld(null);
  ws.paintWindshield('__wr', VIEW);              // settle every lazy cache and bake — and BIRTH the actors
  T += FADE_MS + 100;                            // …so they have finished fading in by the census frame
  globalThis.window.__emitWhoStart();
  ws.paintWindshield('__wr', VIEW);
  const rows = globalThis.window.__emitWho();
  if (typeof rows === 'string') return null;
  return rows.map((l) => {
    const m = l.match(/^(\d+)\s+(.*)$/);
    return m ? { faces: +m[1], tag: m[2], painter: m[2].split(' < ')[0] } : null;
  }).filter(Boolean);
}

const control = tally(false);
const residue = tally(true);

ws.installGLWorld(null);
ws.RENDER_TUNE.gl = glWas; ws.RENDER_TUNE.glFloor = floorWas; ws.RENDER_TUNE.shipForce = shipWas;
globalThis.performance = clock;

const problems = [];
if (!control || !residue) problems.push('the tally never started — __emitWhoStart is not wired');

// The scene has to contain the thing being measured. Both of these paint on the canvas in GLASS 1
// by construction, so their absence means the map is wrong rather than that the city is clean.
// ⚠ NAME THE PASS, NOT THE DRAWER. The tally tags a face with the function that QUEUED it, and a
// figure is queued by its pass — `emitScatterFace < drawStreetActors` — so looking for the drawer
// underneath it (drawActorFigure) finds nothing and fails a scene that is perfectly correct.
// ⚠ THE GEESE ARE NOT IN THIS LIST, AND CANNOT BE. `drawGeese` is day-gated — a flock stops drawing
// above `GOOSE_NIGHT_OFF`, as the ambient birds already do — and this census runs at hour 22 on
// purpose, because the lamps, the signal lenses and the lit scatter are all night-gated and a
// daylight sweep would miss most of the surface it exists to find. One scene cannot be both.
// So the same question is asked of the geese in scripts/shapes/fauna.mjs, which has a day scene
// and a field of turf, with the same instrument. Adding them here instead of there produces a
// control that never draws them, which fails for its own reason — and adding the name without the
// check would be the vacuous-gate mistake this file's own header is about.
// ⚠ AND FOR A `kept:` PAINTER THIS PROVES THE BRANCH WAS ENTERED, NOT THAT ANYTHING WAS DRAWN.
// `keptOnCanvas` registers its reason at the CALL SITE and the tally counts the QUEUED closure as
// one face, so `kept:yacht` and `kept:freighter` both read 1 whether the ship painted a hull or
// returned on its first line. Measured, not assumed: moving the berth's cycle to its empty point
// leaves the row at 1 and every form of this test still passes. That is the right amount for this
// file to claim — whether she is drawn at all is `scripts/shapes/moving.mjs`'s question, and it
// is mutation-tested there. What this one settles is that the canvas branch is REACHED and leaves
// nothing behind that has no reason on file.
for (const w of ['drawTrafficSignals', 'drawStreetLamps', 'drawStreetActors', 'drawRoadside', 'yacht', 'freighter']) {
  if (!control || !control.some((r) => r.tag.includes(w))) {
    problems.push(`the GLASS 1 control drew no ${w} — the scene does not contain what this measures, so an empty GLASS 2 tally would mean nothing`);
  }
}

// ── THE ALLOW-LIST ──────────────────────────────────────────────────────────
// A `kept:` reason declared at the call site, or a painter named here WITH why it is still on the
// canvas. Not a budget: a budget passes a new leak the moment somebody closes an old one.
//
// ⚠ IT IS EMPTY, AND THAT IS THE POINT RATHER THAN AN OVERSIGHT. `drawTrafficSignals` was the last
// entry: the mast was MITIGATED rather than moved, carrying `beginOcclusionClip` — a ~5px cell grid
// eroded by one — because the whole thing was one `emitFace` closure and a closure runs at FLUSH,
// after the GL pass has gone and every sink is null, so the parts that would route to gl/strokes.js
// could never reach it. It is drawn during the sweep now: the steel through emitWire, the plates
// through emitDecoFill, the lenses as baked decals and the lamps through glowPool. Nothing in the
// world pass is left on the canvas, so an entry added here needs a reason, not a name.
const KNOWN = new Map([]);

const unlisted = (residue || []).filter((r) => !r.tag.startsWith('kept:') && !KNOWN.has(r.painter));
for (const r of unlisted) problems.push(`${r.tag} — ${r.faces} faces on the canvas with no reason on file`);

if (REPORT) {
  const show = (label, list) => {
    console.log(`\n  ${label}`);
    if (!list || !list.length) { console.log('    (nothing)'); return; }
    for (const r of [...list].sort((a, b) => b.faces - a.faces)) console.log(`    ${String(r.faces).padStart(5)}  ${r.tag}`);
  };
  show('GLASS 1 — the whole canvas queue (the control)', control);
  show('GLASS 2 — what is LEFT on the canvas', residue);
  console.log('\n  GLASS 2 — where the rest went instead: ' + JSON.stringify(sinks));
  console.log('');
}

if (problems.length) {
  console.error(`\n✗ worldresidue — ${problems.length} problem(s):`);
  for (const p of problems) console.error('  · ' + p);
  console.error('\n  Anything on the canvas is painted over the composited city with only an');
  console.error('  all-or-nothing probe between it and a building. Depth-buffer it, or declare why not.');
  process.exit(1);
}

const total = residue.reduce((n, r) => n + r.faces, 0);
console.log(`✓ worldresidue: the world pass leaves ${residue.length} painter(s) and ${total} face(s) on the canvas, all accounted for.`);
console.log(`  · control: ${control.length} painters in GLASS 1 — GLASS 2 moved them to ${sinks.strokes} strokes, ${sinks.sprites} sprites, ${sinks.decals} decals, ${sinks.ground} ground quads`);
for (const r of residue) console.log(`  · ${r.painter} — ${r.faces} face(s) still painted over the city`);
