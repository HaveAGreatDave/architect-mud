// bay — the depot shed is geometry now, and both ways it can fail to be are invisible.
//
//   node scripts/shapes/bay.mjs
//   node scripts/shapes/bay.mjs --report
//
// The shed is the one building in GLASS drawn at a fixed size by its own function rather than
// extruded from a storey stack, so it is in `MASS_EXCEPT`, it never reaches the GL mass, and until
// now it was painted on the 2-D canvas AFTER the city was composited — with `markHidden`, an
// all-or-nothing probe, the only thing between it and a warehouse in front of it. A depot is a tile
// wide and a third of a storey tall, so standing behind a row of shops MOST of it is hidden and
// NONE of it is all hidden, and it drew whole. That is "the depot shows thru buildings".
//
// `gl/solids.js` takes it now — the same depth-writing layer the rig goes through — and this checks
// that the geometry arrives, because nothing in the picture says whether it did:
//
//   · COLLECTED TOO LATE is the whole of the first failure. Every other mark is drawn through
//     `emitFace`, which queues a closure that runs at FLUSH — after the GL pass has gone and every
//     sink is null. A shed collected from in there reaches the GPU never, draws nothing and reports
//     nothing, which is the Curtain's own trap. So the bay branch calls the painter INLINE.
//
//   · AND THE WRONG FRAME is the second. `F` answers in the camera-relative tile frame the 2-D
//     painter projects from; the GL pass is handed `camAt`, which is that frame plus `cam.ox/oy`.
//     ⚠ That offset is where the eye sits INSIDE its own tile, so it is always under a tile and a
//     shed built without it lands somewhere entirely plausible — on the ground, the right size, in
//     roughly the right place, sliding a fraction of a tile sideways as you drive at it. A first
//     draft of this gate held the shed against the map window's bounding box, which is the check
//     that reads as watertight and cannot fail: restoring the bug left every vertex well inside it.
//
// ⚠ AND THE CONTROL IS NOT OPTIONAL, for the reason worldresidue records: an empty tally is also
// what comes back when the scene contains no depot. So the GLASS 1 frame has to PAINT one.
import { loadWindshield, stubCanvas } from './dom-stub.mjs';

const ws = await loadWindshield();
const REPORT = process.argv.includes('--report');
const W = 640, H = 360;
stubCanvas('__bay', W, H);

// A depot ahead with frontage either side of the approach — the scene the report is about.
const N = 41, R = 20, DEPOT = R - 5;
const map = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => {
  if (x === R && y === DEPOT) return { kind: 'land', biome: 'freight', bt: 'truck_depot', ent: 'north', flr: 1, mark: 'bay', bn: 'TEST DEPOT' };
  if (x === R) return { kind: 'land', biome: 'freight', flr: 0, road: 1, rd: 'ns', surf: 'road' };
  return Math.abs(x - R) <= 2
    ? { kind: 'land', biome: 'freight', flr: 0, bt: 'warehouse', is_building: 1, floors: 3 }
    : { kind: 'land', biome: 'freight', flr: 0 };
}));

const BASE = {
  cls: 'truck', variant: 'hauler', phase: 'ground', worldBlend: 1, height: 0, eyeH: 0.12, fovMul: 1.22,
  hour: 13, weather: 'clear', speed: 0.2, map, heading: 0,
  mapCenter: { x: 100, y: 100 }, mapOffset: { x: 0.1, y: -0.2 },
};

const clock = globalThis.performance;
globalThis.performance = { ...clock, now: () => 1e6 };
const glWas = ws.RENDER_TUNE.gl, floorWas = ws.RENDER_TUNE.glFloor, bayWas = ws.RENDER_TUNE.glBay;
const problems = [];

// The hook is where the frame hands its sinks over, so it is where "did it arrive" is answerable.
function collect(view, tune) {
  let seen = null;
  ws.RENDER_TUNE.gl = 1; ws.RENDER_TUNE.glFloor = 1; ws.RENDER_TUNE.glBay = tune;
  ws.installGLWorld((cells, cam, o) => {
    seen = { bay: (o.bay || []).slice(), decals: (o.decals || []).length,
             sprites: (o.sprites || []).length, ox: cam.ox, oy: cam.oy };
    return null;
  });
  ws.paintWindshield('__bay', view);
  ws.installGLWorld(null);
  return seen;
}

// Every coordinate of one collection against another. Both of the checks below are the same
// statement — the shed's geometry is a pure function of the tile it stands on — asked of two
// different things that ought not to change it.
//
// ⚠ AND ONLY ONE OF THEM MAY ASK IT EXACTLY. Orbiting evaluates the identical expression on the
// identical inputs, so a single differing bit is a real finding and `eps` is 0. Moving the camera
// inside its tile does not: `dx` goes down by the offset and `cam.ox` goes up by it, and in floating
// point `(a - d) + d` is not `a`. That residue is ~1e-16 of a tile against a mutation worth 0.64 of
// one, so the bar is nine orders of magnitude clear of both — a tolerance here, and nowhere else.
function differs(A, B, eps = 0) {
  if (A.length !== B.length) return { count: [A.length, B.length] };
  let moved = 0, worst = 0;
  for (let i = 0; i < A.length; i++) {
    const a = A[i].p, b = B[i].p;
    if (a.length !== b.length) { moved++; continue; }
    for (let k = 0; k < a.length; k++) for (let c = 0; c < 3; c++) {
      const d = Math.abs(a[k][c] - b[k][c]);
      if (d > worst) worst = d;
      if (eps ? d > eps : !Object.is(a[k][c], b[k][c])) moved++;
    }
  }
  return moved ? { moved, worst } : null;
}

const span = (list) => {
  let a = Infinity, b = -Infinity;
  for (const q of list) for (const v of q.p) { if (v[2] < a) a = v[2]; if (v[2] > b) b = v[2]; }
  return b - a;
};

const on = collect({ ...BASE }, 1);

if (!on || !on.bay.length) {
  problems.push('the GL frame collected NO shed geometry — it reaches neither the depth buffer nor the reflection');
} else {
  let bad = 0, noCol = 0;
  for (const q of on.bay) {
    if (!q.p || q.p.length < 3) { bad++; continue; }
    let ok = true;
    for (const v of q.p) if (!Number.isFinite(v[0]) || !Number.isFinite(v[1]) || !Number.isFinite(v[2])) { ok = false; break; }
    if (!ok) bad++;
    if (!q.rgb || q.rgb.length !== 3 || !q.rgb.every(Number.isFinite)) noCol++;
    if (!(q.a > 0) || !Number.isFinite(q.a)) noCol++;
  }
  if (bad) problems.push(`${bad} of ${on.bay.length} collected faces carry a non-finite vertex — that buffer rasterises nothing and throws nothing`);
  if (noCol) problems.push(`${noCol} of ${on.bay.length} collected faces carry no usable colour or alpha`);
  // A shed is a shed: eaves at 0.30 and a ridge at 0.43, so the set has to stand up.
  const tall = span(on.bay);
  if (!(tall > 0.2)) problems.push(`the shed is ${tall.toFixed(3)} tiles tall — it is flat, so the local-to-world transform is not being applied`);
}

// ── ⚠ DRIVING PAST IT MUST NOT MOVE IT, WHICH IS HOW cam.ox/oy IS CHECKED ────────────────────
//
// `mapOffset` is where the camera sits INSIDE its own centre tile, so changing it moves the eye and
// moves every tile's camera-relative `dx`/`dy` by the same amount the other way. `cam.ox`/`cam.oy`
// ARE that offset, and adding them is what converts the painter's camera-relative frame into the
// map-window frame the GL pass is handed. The two terms cancel exactly — which is the point, and
// is also the only way to see the addition at all from out here: the offset is SUB-TILE, so a shed
// built without it is still comfortably inside the map window and no bounding box will ever notice.
// Drop the addition and the depot slides across the ground as you drive up to it.
const nudged = collect({ ...BASE, mapOffset: { x: -0.38, y: 0.44 } }, 1);
if (!on || !on.bay.length || !nudged || !nudged.bay.length) {
  problems.push('the map-offset comparison collected nothing — it cannot see the thing it is checking');
} else if (Object.is(on.ox, nudged.ox) && Object.is(on.oy, nudged.oy)) {
  problems.push(`both frames reported cam.ox/oy ${on.ox}/${on.oy} — the offset did not change, so this check proves nothing`);
} else {
  const d = differs(on.bay, nudged.bay, 1e-9);
  if (d && d.count) problems.push(`moving the camera within its tile changed the face COUNT (${d.count[0]} vs ${d.count[1]})`);
  else if (d) problems.push(`moving the camera within its tile moved ${d.moved} of the shed's coordinates (worst ${d.worst.toExponential(2)} tiles) — cam.ox/oy is not being applied, so the depot slides across the ground as you drive at it`);
}

// ORBITING MUST NOT MOVE A BUILDING. The shed is a fixed thing on a fixed tile and its geometry is
// a pure function of that tile, so two camera angles have to agree on every coordinate — exactly,
// because these are the same expression evaluated twice. This is the check that caught the rig's
// reflection rotating with the eye, and a building is the stronger case for it.
const orbitA = collect({ ...BASE, external: true, extYaw: 0, extPitch: 0.3, extZoom: 1 }, 1);
const orbitB = collect({ ...BASE, external: true, extYaw: 90, extPitch: 0.3, extZoom: 1 }, 1);
if (!orbitA || !orbitB || !orbitA.bay.length || !orbitB.bay.length) {
  problems.push('the orbit comparison collected nothing — it cannot see the thing it is checking');
} else {
  const d = differs(orbitA.bay, orbitB.bay);
  if (d && d.count) problems.push(`orbiting changed the face COUNT (${d.count[0]} vs ${d.count[1]}) — the shed is being rebuilt against the camera`);
  else if (d) problems.push(`orbiting the camera moved ${d.moved} of the shed's coordinates (worst ${d.worst.toFixed(3)} tiles) — a building is following the eye`);
}

// THE OFF SWITCH, which has to be the frame that shipped before this layer existed — and it is also
// the CONTROL: with the shed back on the canvas, the canvas has to be painting one. An empty GL
// tally beside an empty canvas tally is a scene with no depot in it, not a clean frame.
let offBay = 0;
ws.RENDER_TUNE.gl = 1; ws.RENDER_TUNE.glFloor = 1; ws.RENDER_TUNE.glBay = 0;
ws.installGLWorld((cells, cam, o) => { offBay = (o.bay || []).length; return null; });
ws.paintWindshield('__bay', BASE);
globalThis.window.__emitWhoStart();
ws.paintWindshield('__bay', BASE);
const rows = globalThis.window.__emitWho();
ws.installGLWorld(null);

if (offBay) problems.push(`glBay 0 still collected ${offBay} faces — the off switch is not an off switch`);
const painted = Array.isArray(rows) && rows.some((l) => l.includes('emitMarked'));
if (!painted) problems.push('with glBay 0 the canvas queued no mark — the scene does not contain a depot, so an empty GL tally would mean nothing');

ws.RENDER_TUNE.gl = glWas; ws.RENDER_TUNE.glFloor = floorWas; ws.RENDER_TUNE.glBay = bayWas;
globalThis.performance = clock;

if (REPORT && on) {
  console.log(`\n  shed faces on the GPU: ${on.bay.length}`);
  console.log(`  decals (the floor legends + the name board): ${on.decals}`);
  console.log(`  sprites (the high-bays, their pools, the door spill): ${on.sprites}`);
  console.log(`  canvas queue with glBay 0: ${Array.isArray(rows) ? rows.filter((l) => l.includes('emitMarked')).join(' | ') : rows}\n`);
}

if (problems.length) {
  console.error('\n✗ bay — ' + problems.length + ' problem(s):');
  for (const p of problems) console.error('  · ' + p);
  console.error('\n  The shed is not painted on the canvas any more, so a failure here is a depot that');
  console.error('  is simply not in the frame — no error, no warning, an empty tile where a building is.');
  process.exit(1);
}
console.log(`✓ bay: the depot reaches the GPU as ${on.bay.length} faces standing ${span(on.bay).toFixed(2)} tiles tall; neither orbiting the camera nor moving it within its tile shifts any of them, glBay 0 collects none, and the canvas control still paints one.`);
