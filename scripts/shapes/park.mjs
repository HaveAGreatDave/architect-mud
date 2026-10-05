// park — a park tile's furniture is hand-written geometry, and the way it goes wrong is that a
// piece of it is pushed in the wrong frame or silently stops arriving.
//
//   node scripts/shapes/park.mjs
//   node scripts/shapes/park.mjs --report
//
// Trees, hedges, benches, lamps, bins, bollards and the kerbs round a pond or a bed are facets
// built in the tile's own frame (`parkGeom` in windshield.js) and handed to `gl/solids.js` as one
// retained group per tile. Nothing derives those numbers, so this holds them:
//
//   · every dressing draws something, and nothing it draws is non-finite or colourless;
//   · every facet stays on its own tile, which is one check for a part authored off the tile and
//     for a part pushed in the camera's frame (that lands at the eye, several tiles away);
//   · the same dressing two tiles further on is the same geometry two tiles further on;
//   · moving the eye inside its tile moves nothing;
//   · a frame that changes nothing hands back the same record arrays, which is what keeps the
//     tile on the GPU instead of re-sending it;
//   · and the canvas path paints the same tiles without throwing.
//
// Mutations it is checked against:
//   · drop `cam.ox/oy` in parkSolidsGL          → the nudge check fires
//   · author a tree a tile off its centre       → the on-its-own-tile check fires
//   · key PARK_RECS on something per-frame      → the retained check fires
//   · stop calling parkSolidsGL                 → every "draws something" check fires
import { loadWindshield, stubCanvas } from './dom-stub.mjs';

const ws = await loadWindshield();
const REPORT = process.argv.includes('--report');
const W = 640, H = 480;
stubCanvas('__park', W, H);

const FEATURES = ['grove', 'pond', 'benches', 'flowerbeds', 'path'];
// Flat grass with one park tile on it, several tiles ahead. ⚠ THE GRASS IS `citycore`, because a
// lawn of `park` tiles would put furniture on every tile and the control would measure all of it.
const N = 25, C = 12, AHEAD = 5;
function scene(feature, sx = C, sy = C - AHEAD) {
  return Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => (
    (feature && x === sx && y === sy)
      ? { kind: 'land', biome: 'park', flr: 0, pf: feature }
      : { kind: 'land', biome: 'citycore', flr: 0 }
  )));
}
const BASE = {
  cls: 'truck', variant: 'hauler', phase: 'ground', worldBlend: 1, height: 0, eyeH: 0.12, fovMul: 1.22,
  hour: 13, weather: 'clear', speed: 0, heading: 0,
  mapCenter: { x: 100, y: 100 }, mapOffset: { x: 0, y: 0 },
};

const clock = globalThis.performance;
globalThis.performance = { ...clock, now: () => 1e6 };
const was = { gl: ws.RENDER_TUNE.gl, floor: ws.RENDER_TUNE.glFloor, bay: ws.RENDER_TUNE.glBay };
const problems = [];

function collect(map, view = BASE) {
  let seen = null;
  ws.RENDER_TUNE.gl = 1; ws.RENDER_TUNE.glFloor = 1; ws.RENDER_TUNE.glBay = 1;
  ws.installGLWorld((_c, _cam, o) => {
    const bay = o.bay || [];
    seen = { recs: bay.map((q) => ({ p: q.p.map((v) => v.slice()), rgb: q.rgb, a: q.a })), groups: (bay.groups || []).map((g) => g.recs) };
    return null;
  });
  ws.paintWindshield('__park', { ...view, map });
  ws.installGLWorld(null);
  return seen;
}
const centroid = (recs) => {
  let x = 0, y = 0, n = 0;
  for (const q of recs) for (const v of q.p) { x += v[0]; y += v[1]; n++; }
  return n ? [x / n, y / n] : null;
};

// ── THE CONTROL ──────────────────────────────────────────────────────────────────────────────
// An empty sink is also what a switched-off renderer or a wrong scene returns, so the grass alone
// has to come back empty for any count below to mean the park.
const control = collect(scene(null));
if (!control) problems.push('the GL frame never reached the hook — nothing below can be measured');
else if (control.recs.length) problems.push(`grass with no park on it collected ${control.recs.length} solid faces — something else is filling this sink`);

const report = [];
for (const f of FEATURES) {
  const here = collect(scene(f));
  if (!here || !here.recs.length) { problems.push(`'${f}' collected no solid faces — the park's furniture is not reaching the depth buffer`); continue; }
  let bad = 0, noCol = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const q of here.recs) {
    if (!q.p || q.p.length < 3) { bad++; continue; }
    for (const v of q.p) {
      if (!v.every(Number.isFinite)) { bad++; break; }
      minX = Math.min(minX, v[0]); maxX = Math.max(maxX, v[0]);
      minY = Math.min(minY, v[1]); maxY = Math.max(maxY, v[1]);
      minZ = Math.min(minZ, v[2]); maxZ = Math.max(maxZ, v[2]);
    }
    if (!q.rgb || q.rgb.length !== 3 || !q.rgb.every(Number.isFinite) || !(q.a > 0)) noCol++;
  }
  if (bad) problems.push(`'${f}': ${bad} of ${here.recs.length} faces carry a non-finite or degenerate vertex`);
  if (noCol) problems.push(`'${f}': ${noCol} of ${here.recs.length} faces carry no usable colour or alpha`);
  // ── ⚠ ON ITS OWN TILE ──────────────────────────────────────────────────────────────────────
  // The tile is one unit square, so everything on it spans at most one unit each way. A part in
  // the camera's frame lands five tiles back at the eye and blows this by four.
  const span = Math.max(maxX - minX, maxY - minY);
  if (span > 1.0001) problems.push(`'${f}' spans ${span.toFixed(2)} tiles — a part is off its tile or pushed in the wrong frame`);
  if (minZ < -1e-6 || maxZ > 0.6) problems.push(`'${f}' runs from z ${minZ.toFixed(3)} to ${maxZ.toFixed(3)} — below the ground or taller than any park furniture`);
  // ── ⚠ TWO TILES ON IS TWO TILES ON ─────────────────────────────────────────────────────────
  // The same dressing two tiles east must come back as the same geometry two tiles east. The seed
  // differs with the tile, so a seeded dressing is not the same shape; an authored `pf` is, and
  // every tile here has one.
  const there = collect(scene(f, C + 2, C - AHEAD));
  const a = centroid(here.recs), b = there && centroid(there.recs);
  if (!b) problems.push(`'${f}' two tiles further on collected nothing`);
  else {
    const ddx = b[0] - a[0], ddy = b[1] - a[1];
    // A grove's trees and a bed's flowers are placed off the seed, so only a margin is honest.
    if (Math.abs(ddx - 2) > 0.35 || Math.abs(ddy) > 0.35) problems.push(`'${f}' two tiles east moved by (${ddx.toFixed(2)}, ${ddy.toFixed(2)}) instead of (2, 0) — the records are not in the map-window frame`);
  }
  // ── ⚠ MOVING THE EYE MOVES NOTHING ─────────────────────────────────────────────────────────
  const nudged = collect(scene(f), { ...BASE, mapOffset: { x: -0.38, y: 0.44 } });
  if (!nudged || nudged.recs.length !== here.recs.length) {
    problems.push(`'${f}': moving the eye within its tile changed the face count (${here.recs.length} vs ${nudged ? nudged.recs.length : 0})`);
  } else {
    let moved = 0;
    for (let i = 0; i < here.recs.length; i++) {
      const p = here.recs[i].p, r = nudged.recs[i].p;
      for (let k = 0; k < p.length; k++) for (let c = 0; c < 3; c++) if (Math.abs(p[k][c] - r[k][c]) > 1e-9) moved++;
    }
    if (moved) problems.push(`'${f}': moving the eye within its tile moved ${moved} coordinates — a part is pinned to the eye`);
  }
  // ── ⚠ AND IT STAYS ON THE GPU ──────────────────────────────────────────────────────────────
  // Two frames of the same scene must hand back the very same arrays, or gl/solids.js re-sends the
  // tile every frame. (`collect` copies the records, so identity is read off the groups.)
  const again = collect(scene(f));
  const g0 = here.groups, g1 = again ? again.groups : [];
  if (!g0.length) problems.push(`'${f}' was not pushed as a retained group`);
  else if (g0.length !== g1.length || g0.some((g, i) => g !== g1[i])) problems.push(`'${f}': a second identical frame built new record arrays — the tile is re-sent every frame`);
  report.push(`${f} ${here.recs.length}`);
}

// ── THE CANVAS PATH ──────────────────────────────────────────────────────────────────────────
// GLASS 2 off: the same facets are painted by the tile's queued face. It cannot be measured here
// beyond running, and running is what a missing helper or a bad projection breaks.
ws.RENDER_TUNE.gl = 0; ws.RENDER_TUNE.glFloor = 0; ws.RENDER_TUNE.glBay = 0;
for (const f of FEATURES) {
  for (const hour of [13, 23]) {
    try { ws.paintWindshield('__park', { ...BASE, hour, map: scene(f) }); }
    catch (e) { problems.push(`'${f}' threw on the canvas path at ${hour}:00 — ${e && e.message}`); }
  }
}

ws.RENDER_TUNE.gl = was.gl; ws.RENDER_TUNE.glFloor = was.floor; ws.RENDER_TUNE.glBay = was.bay;
globalThis.performance = clock;

if (REPORT) console.log('park faces: ' + report.join(' · '));
if (problems.length) {
  console.error('✗ park');
  for (const p of problems) console.error('  · ' + p);
  process.exit(1);
}
console.log(`  ✓ park — ${FEATURES.length} dressings solid, on their own tiles and retained`);
