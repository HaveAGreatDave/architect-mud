// statue — the Fisherman of Coldwater is hand-written geometry, and the way it goes wrong is that
// a piece of it silently stops being drawn.
//
//   node scripts/shapes/statue.mjs
//   node scripts/shapes/statue.mjs --report
//
// The monument is the one mark built as facets rather than as a silhouette: two hundred-odd
// polygons pushed into `gl/solids.js`, the same depth-writing layer the rig and the depot shed
// share. Every other part of the renderer derives its coordinates — a model captures itself, a
// decal comes back through `cam.unproj`, a light is handed its own radius. This does not. It is
// two hundred numbers somebody typed, in a frame nothing checks, and that is exactly the shape of
// thing a gate has to hold.
//
// ⚠ THE FAILURE IT EXISTS FOR IS THE WRONG FRAME, AND IT IS SILENT IN BOTH RENDERERS. `box` and
// `taper` take the monument's own frame and add the tile offset themselves; `limb` and `sweep`
// take points that are ALREADY camera-relative, because that is what `at()` returns. Both
// conventions are in the same function, four lines apart, and the arms were wrapped in a `rel()`
// that subtracted the tile offset back off — which put every arm and the whole fishing rod at the
// CAMERA'S OWN ORIGIN. On the 2-D path those facets fail `cam.proj`'s near test and are dropped;
// on the GL path they are pushed at the eye and clipped by the near plane. Nothing throws, nothing
// warns, and the monument simply has no arms. It shipped that way, and the only piece of tackle
// anybody could see was the LINE — a stroke, in world coordinates, and so the one part that was
// never wrapped.
//
// ⚠ AND A COUNT WOULD NOT HAVE CAUGHT IT. The facets are pushed either way; they are pushed
// somewhere else. So this holds every vertex against the monument's own tile, and asks separately
// whether the parts that are hardest to notice missing — the rod above the hat, the reach out over
// the water — are there at all.
//
// Mutations it is checked against (each one restores a real or plausible bug):
//   · wrap the arms in `rel()` again          → the radius check fires, and so does the nudge one
//   · delete the `sweep` call                 → the rod-height check fires
//   · author the rod tip past the coping      → the radius check fires
//   · drop `cam.ox/oy` in the solids push     → the nudge check fires
//   · stop pushing the statue entirely        → the "collected nothing" check fires
import { loadWindshield, stubCanvas } from './dom-stub.mjs';

const ws = await loadWindshield();
const REPORT = process.argv.includes('--report');
const W = 640, H = 480;
stubCanvas('__statue', W, H);

// A flat park with the monument on one tile, several tiles ahead. ⚠ THE DISTANCE IS THE MARGIN:
// a facet left in the camera's own frame lands at the EYE, so the further the monument stands from
// the seat the further such a facet is from where it belongs. At six tiles the mutation is worth
// six of them against a bar of half a one.
const N = 25, C = 12, AHEAD = 6;
const SX = C, SY = C - AHEAD;
const map = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => (
  (x === SX && y === SY)
    ? { kind: 'land', biome: 'park', flr: 0, mark: 'statue' }
    : { kind: 'land', biome: 'park', flr: 0 }
)));
const bare = map.map((row) => row.map((c) => (c.mark ? { ...c, mark: undefined } : c)));

const BASE = {
  cls: 'truck', variant: 'hauler', phase: 'ground', worldBlend: 1, height: 0, eyeH: 0.12, fovMul: 1.22,
  hour: 13, weather: 'clear', speed: 0, heading: 0,
  mapCenter: { x: 100, y: 100 }, mapOffset: { x: 0, y: 0 },
};

const clock = globalThis.performance;
globalThis.performance = { ...clock, now: () => 1e6 };
const was = { gl: ws.RENDER_TUNE.gl, floor: ws.RENDER_TUNE.glFloor, bay: ws.RENDER_TUNE.glBay };
const problems = [];

// The hook is where the frame hands its sinks over, so it is where "did it arrive" is answerable.
function collect(view, cells = map) {
  let seen = null;
  ws.RENDER_TUNE.gl = 1; ws.RENDER_TUNE.glFloor = 1; ws.RENDER_TUNE.glBay = 1;
  ws.installGLWorld((_c, cam, o) => {
    seen = { bay: (o.bay || []).map((q) => ({ p: q.p.map((v) => v.slice()), rgb: q.rgb, a: q.a })),
             ox: cam.ox, oy: cam.oy };
    return null;
  });
  ws.paintWindshield('__statue', { ...view, map: cells });
  ws.installGLWorld(null);
  return seen;
}

const on = collect(BASE);
const off = collect(BASE, bare);

// ── ⚠ THE CONTROL IS NOT OPTIONAL ────────────────────────────────────────────────────────────
// An empty tally is also what comes back from a scene with no monument in it, from a renderer that
// is switched off, and from a harness that built the wrong map. The difference against the same
// scene with the mark removed is the monument and nothing else.
if (!on || !on.bay.length) {
  problems.push('the GL frame collected NO statue geometry — the monument reaches neither the depth buffer nor the 2-D sort');
} else if (off && off.bay.length) {
  problems.push(`the scene without the mark still collected ${off.bay.length} solid faces — something other than the monument is filling this sink, so every check below is measuring the wrong thing`);
}

let centre = null, maxR = 0, maxZ = 0, reach = 0;
if (on && on.bay.length && !(off && off.bay.length)) {
  let bad = 0, noCol = 0;
  for (const q of on.bay) {
    if (!q.p || q.p.length < 3) { bad++; continue; }
    for (const v of q.p) if (!Number.isFinite(v[0]) || !Number.isFinite(v[1]) || !Number.isFinite(v[2])) { bad++; break; }
    if (!q.rgb || q.rgb.length !== 3 || !q.rgb.every(Number.isFinite)) noCol++;
    if (!(q.a > 0) || !Number.isFinite(q.a)) noCol++;
  }
  if (bad) problems.push(`${bad} of ${on.bay.length} statue faces carry a non-finite vertex — that buffer rasterises nothing and throws nothing`);
  if (noCol) problems.push(`${noCol} of ${on.bay.length} statue faces carry no usable colour or alpha`);

  // ── ⚠ THE CENTRE IS TAKEN FROM THE GROUND, NOT FROM THE WHOLE SET ─────────────────────────
  // Averaging everything would move the target along with whatever went astray, which is the one
  // way to write this check so that it cannot fail. The basin ring and the bottom plinth step are
  // drawn through `box`/`face` in the monument's own frame, so they are right whatever the limbs
  // are doing — and they are the only things down at the pavement.
  const low = [];
  for (const q of on.bay) for (const v of q.p) if (v[2] <= 0.06) low.push(v);
  if (low.length < 32) {
    problems.push(`only ${low.length} vertices sit at pavement level — the basin and the plinth steps are not being drawn, so there is nothing to locate the monument by`);
  } else {
    centre = [low.reduce((s, v) => s + v[0], 0) / low.length, low.reduce((s, v) => s + v[1], 0) / low.length];
    for (const q of on.bay) for (const v of q.p) {
      const r = Math.hypot(v[0] - centre[0], v[1] - centre[1]);
      if (r > maxR) maxR = r;
      if (v[2] > maxZ) maxZ = v[2];
      if (v[2] > 0.95 && r > reach) reach = r;
    }
    // ── ⚠ A MONUMENT LIVES ON ITS OWN TILE, WHICH IS BOTH CHECKS IN ONE NUMBER ──────────────
    // Outward it is the basin coping at 0.365 tiles and the rod tip authored just inside it, so
    // 0.45 clears everything real by a fifth. It fires on a limb left in the camera's frame
    // (six tiles out) and equally on a rod authored out over the pavement, which the drawer's own
    // comment forbids and nothing enforced.
    const MAX_R = 0.45;
    if (maxR > MAX_R) {
      problems.push(`a statue face sits ${maxR.toFixed(2)} tiles from the monument's own centre (bar ${MAX_R}) — either a part is being pushed in the wrong frame, or it is authored out over the pavement`);
    }
    // ── ⚠ AND THE ROD IS THE PART THAT GOES MISSING QUIETLY ─────────────────────────────────
    // The figure finishes at the crown of the sou'wester, 0.92 tiles up. Everything above that is
    // the fishing rod, and a monument with no rod on it still draws a perfectly good statue — so
    // nothing else in this file would notice. It must also REACH, or a rod pointing straight up is
    // a flagpole: the point of it is that it holds the line out over the water.
    const ROD_Z = 1.15, ROD_REACH = 0.18;
    if (!(maxZ > ROD_Z)) {
      problems.push(`the monument tops out at ${maxZ.toFixed(2)} tiles (bar ${ROD_Z}) — the figure is there and the fishing rod is not`);
    } else if (!(reach > ROD_REACH)) {
      problems.push(`nothing above the figure's head reaches further than ${reach.toFixed(2)} tiles from the centre (bar ${ROD_REACH}) — the rod stands straight up instead of holding the line out over the basin`);
    }
  }
}

// ── ⚠ DRIVING PAST IT MUST NOT MOVE IT ───────────────────────────────────────────────────────
// `mapOffset` is where the eye sits INSIDE its own tile, so it moves every tile's camera-relative
// offset by the same amount the other way, and `cam.ox`/`cam.oy` are what convert the painter's
// frame into the map-window one the GL pass is handed. The two cancel exactly for anything
// standing on a tile. A part pushed in the camera's own frame does not cancel — it is pinned to
// the eye — so it slides across the park as you drive at it, which is the same bug as the radius
// check above seen from the other side, and the side that survives a bar being retuned.
const nudged = collect({ ...BASE, mapOffset: { x: -0.38, y: 0.44 } });
if (!on || !on.bay.length || !nudged || !nudged.bay.length) {
  problems.push('the map-offset comparison collected nothing — it cannot see the thing it is checking');
} else if (Object.is(on.ox, nudged.ox) && Object.is(on.oy, nudged.oy)) {
  problems.push(`both frames reported cam.ox/oy ${on.ox}/${on.oy} — the offset did not change, so this check proves nothing`);
} else if (on.bay.length !== nudged.bay.length) {
  problems.push(`moving the camera within its tile changed the statue's face count (${on.bay.length} vs ${nudged.bay.length})`);
} else {
  // ⚠ A TOLERANCE HERE AND NOWHERE ELSE, for the reason bay.mjs records: `dx` goes down by the
  // offset and `cam.ox` goes back up by it, and in floating point `(a - d) + d` is not `a`. The
  // residue is ~1e-16 of a tile against a mutation worth the whole offset.
  let moved = 0, worst = 0, n = 0;
  for (let i = 0; i < on.bay.length; i++) {
    const a = on.bay[i].p, b = nudged.bay[i].p;
    if (a.length !== b.length) { moved++; continue; }
    for (let k = 0; k < a.length; k++) for (let c = 0; c < 3; c++) {
      const d = Math.abs(a[k][c] - b[k][c]); n++;
      if (d > worst) worst = d;
      if (d > 1e-9) moved++;
    }
  }
  if (moved) problems.push(`moving the camera within its tile moved ${moved} of ${n} statue coordinates (worst ${worst.toExponential(2)} tiles) — a part of the monument is pinned to the eye rather than to its tile`);
}

ws.RENDER_TUNE.gl = was.gl; ws.RENDER_TUNE.glFloor = was.floor; ws.RENDER_TUNE.glBay = was.bay;
globalThis.performance = clock;

if (REPORT) {
  console.log(`statue: ${on ? on.bay.length : 0} faces, ${off ? off.bay.length : 0} without the mark`);
  if (centre) {
    console.log(`  widest ${maxR.toFixed(3)} tiles from centre · tallest ${maxZ.toFixed(3)} tiles · reach above the hat ${reach.toFixed(3)}`);
  }
}
if (problems.length) {
  console.error('✗ statue');
  for (const p of problems) console.error('  · ' + p);
  process.exit(1);
}
console.log(`  ✓ statue — ${on.bay.length} faces on its own tile, rod ${maxZ.toFixed(2)} tiles up and ${reach.toFixed(2)} out`);
