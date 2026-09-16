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
// What this found, which is not what the reports assumed: the street lamps, the roadside scatter and
// the pavement actors are ALREADY on the depth buffer in a GL frame. Exactly one painter is not.
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
};

const clock = globalThis.performance;
globalThis.performance = { ...clock, now: () => 1e6 };
const glWas = ws.RENDER_TUNE.gl, floorWas = ws.RENDER_TUNE.glFloor;

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
  ws.paintWindshield('__wr', VIEW);              // settle every lazy cache and bake
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
ws.RENDER_TUNE.gl = glWas; ws.RENDER_TUNE.glFloor = floorWas;
globalThis.performance = clock;

const problems = [];
if (!control || !residue) problems.push('the tally never started — __emitWhoStart is not wired');

// The scene has to contain the thing being measured. Both of these paint on the canvas in GLASS 1
// by construction, so their absence means the map is wrong rather than that the city is clean.
for (const w of ['drawTrafficSignals', 'drawStreetLamps']) {
  if (!control || !control.some((r) => r.tag.includes(w))) {
    problems.push(`the GLASS 1 control drew no ${w} — the scene does not contain what this measures, so an empty GLASS 2 tally would mean nothing`);
  }
}

// ── THE ALLOW-LIST ──────────────────────────────────────────────────────────
// A `kept:` reason declared at the call site, or a painter named here WITH why it is still on the
// canvas. Not a budget: a budget passes a new leak the moment somebody closes an old one.
const KNOWN = new Map([
  ['drawTrafficSignals',
    'MITIGATED, NOT MOVED. The whole mast — pole, boom, drop brackets, heads and lenses — is still '
    + 'one emitFace closure, and that closure runs at FLUSH, after the GL pass has gone and the '
    + 'sinks are null, so even the parts that would route to gl/strokes.js cannot reach it. What it '
    + 'has instead is beginOcclusionClip — the same per-cell mask the own ship uses, applied inside '
    + 'the closure where OCC_FIELD is still alive. That is a ~5px grid eroded by a cell, not a '
    + 'per-pixel depth test, so a hair can survive against a building edge; the full fix is still '
    + 'emitWire for the steel and emitDecoFill for the head.'],
]);

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
