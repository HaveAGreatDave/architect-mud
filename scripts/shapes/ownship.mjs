// ownship — the rig has to reach the GPU, and the two ways it did not are both silent.
//
//   node scripts/shapes/ownship.mjs
//
// The vehicle you are in is drawn by a software rasteriser onto the 2-D canvas AFTER the GL canvas
// has been composited, which is why it drew through buildings and could not appear in a puddle.
// `gl/solids.js` gives it real geometry; this checks that the geometry actually arrives.
//
// ⚠ IT ARRIVES OR IT DOES NOT, AND NOTHING IN THE PICTURE SAYS WHICH. The rig is still painted on
// the canvas afterwards, so a frame with an EMPTY sink looks exactly like a frame with a full one —
// the truck is there either way, and all that is missing is its reflection and its depth. That is
// the same shape as the Curtain's own trap, and it is what this gate exists for:
//
//   · COLLECTED TOO LATE. The model is drawn after `drawWorldObjects` returns, and the sinks are
//     torn down in that function's `finally`. Filling the sink at the draw therefore fills it after
//     the pass has already gone to the GPU — reaching it never, drawing nothing, reporting nothing.
//     So the collection runs inside the world pass instead, off `ownShipModelOpts`.
//
//   · AND CULLED TOO EARLY. The backface cull is relative to the EYE; the reflection looks at the
//     rig from UNDERNEATH the road, so the faces the mirror needs are precisely the ones the camera
//     cannot see. Collect after the cull and the reflection is hollow — the same argument the
//     shadow casters were already making a few lines above it.
//
// ⚠ AND A NON-FINITE VERTEX IS THE OTHER SILENT ONE. A vertex buffer full of NaN rasterises nothing
// and throws nothing, which is the failure `shapes:smoke` already watches the authored vehicles for.
import { loadWindshield, stubCanvas, rigOnly } from './dom-stub.mjs';

const ws = await loadWindshield();
const W = 640, H = 360;
stubCanvas('__os', W, H);

const N = 41;
const map = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => (
  { kind: 'land', biome: 'parkland', flr: 0, surf: (x === 20 || y === 20) ? 'road' : null })));

const BASE = {
  cls: 'truck', variant: 'hauler', phase: 'ground', worldBlend: 1, height: 0, eyeH: 0.12, fovMul: 1.22,
  hour: 13, weather: 'clear', speed: 0.3, map, heading: 30,
  mapCenter: { x: 100, y: 100 }, mapOffset: { x: 0.2, y: -0.3 },
  livery: { base: '#8a2b2b', trim: '#d8d8d8' }, gearAnim: 1,
};

const clock = globalThis.performance;
globalThis.performance = { ...clock, now: () => 1e6 };

const glWas = ws.RENDER_TUNE.gl, shipWas = ws.RENDER_TUNE.glShip;
const problems = [];

// The hook is where the frame hands its sinks over, so it is where "did it arrive" is answerable.
function collect(view, tune) {
  let seen = null;
  ws.RENDER_TUNE.gl = 1;
  ws.RENDER_TUNE.glShip = tune;
  ws.installGLWorld((cells, cam, opts) => { seen = opts.ship ? opts.ship.slice() : null; return null; });
  ws.paintWindshield('__os', view);
  ws.installGLWorld(null);
  return seen;
}

// 1. The chase camera, which is the only seat that draws the rig at all.
const ext = collect({ ...BASE, external: true, extYaw: 0, extPitch: 0.3, extZoom: 1 }, 1);
if (!ext || !ext.length) {
  problems.push('the external view collected NO rig geometry — it reaches neither the depth buffer nor the reflection');
} else {
  let bad = 0, noCol = 0;
  for (const q of ext) {
    if (!q.p || q.p.length < 3) { bad++; continue; }
    for (const v of q.p) if (!Number.isFinite(v[0]) || !Number.isFinite(v[1]) || !Number.isFinite(v[2])) { bad++; break; }
    if (!q.rgb || q.rgb.length !== 3 || !q.rgb.every(Number.isFinite)) noCol++;
  }
  if (bad) problems.push(`${bad} of ${ext.length} collected faces carry a non-finite vertex — that buffer rasterises nothing and throws nothing`);
  if (noCol) problems.push(`${noCol} of ${ext.length} collected faces carry no usable colour`);
  // ⚠ THE UNDERSIDE IS THE POINT. A rig collected only from the faces the eye can see reflects as a
  // hollow shell, so the set has to contain polygons facing DOWN as well as up. Anything below the
  // centroid of the lot is the cheap statement of that and does not need a normal.
  let zMin = Infinity, zMax = -Infinity;
  for (const q of ext) for (const v of q.p) { if (v[2] < zMin) zMin = v[2]; if (v[2] > zMax) zMax = v[2]; }
  if (!(zMax > zMin)) problems.push('every collected vertex is at one height — the rig is flat, so the transform is not being applied');
}

// 2. ORBITING THE CAMERA MUST NOT MOVE THE RIG.
//
// ⚠ THIS IS THE ONE THE FIRST VERSION OF THIS GATE COULD NOT SEE, AND IT SHIPPED BECAUSE OF THAT.
// `paintWindshield` hands `drawWorldObjects` the view with the camera's heading written into
// `heading` — vehicle heading plus extYaw plus chaseYaw — and the own-ship geometry is collected
// inside that function. With only `heading` to read, the rig was rebuilt at the CAMERA's angle:
// the canvas-drawn truck (which gets the unrotated view) stayed put, and its REFLECTION spun as
// you dragged the view. Two trucks, one of them in the water, disagreeing about which way it faced.
//
// The geometry is a pure function of the vehicle, so orbiting is the cleanest possible statement of
// it: same rig, same place, two camera angles, and every vertex has to land on the same number.
// Exact equality, because these are the same expression evaluated twice — a tolerance here would
// pass an orbit of a degree and the bug is an orbit of any size.
const orbitA = collect({ ...BASE, external: true, extYaw: 0, extPitch: 0.3, extZoom: 1 }, 1);
// ⚠ 90 DEGREES, NOT A NUDGE. extYaw is in DEGREES (see extOrbit in paintWindshield), so the
// 1.2 this was first written with was a 1.2-degree orbit and moved the rig by a thousandth of a
// tile — a true failure reported as a number nobody would look twice at. A quarter turn makes the
// break the size of the truck.
const orbitB = collect({ ...BASE, external: true, extYaw: 90, extPitch: 0.3, extZoom: 1 }, 1);
if (!orbitA || !orbitB || !orbitA.length || !orbitB.length) {
  problems.push('the orbit comparison collected nothing — it cannot see the thing it is checking');
} else if (orbitA.length !== orbitB.length) {
  problems.push(`orbiting changed the face COUNT (${orbitA.length} vs ${orbitB.length}) — the rig is being rebuilt against the camera`);
} else {
  let moved = 0, worst = 0;
  for (let i = 0; i < orbitA.length; i++) {
    const a = orbitA[i].p, b = orbitB[i].p;
    for (let k = 0; k < a.length; k++) {
      for (let c = 0; c < 3; c++) {
        const d = Math.abs(a[k][c] - b[k][c]);
        if (d > worst) worst = d;
        if (!Object.is(a[k][c], b[k][c])) moved++;
      }
    }
  }
  if (moved) problems.push(`orbiting the camera moved ${moved} of the rig's coordinates (worst ${worst.toFixed(3)} tiles) — the reflection rotates with the eye`);
}

// 3. The cab, where there is no rig to collect: you are inside it.
//
// ⚠ THE INTERIOR SHELL IS IN THIS BUFFER TOO, AND IT IS SUPPOSED TO BE. OWNSHIP_SINK had exactly
// one producer when this file was written, so counting the whole thing and calling the answer
// "the rig" was true by construction. It is not any more: the cab's floor, roof, seat and door
// cards are solids at the camera and they go through the same layer, which is how they end up in
// the depth buffer and in a puddle. They carry `interior` for this — see the ⚠ at the push.
//
// ⚠ AND THE FILTER IS NOT A WEAKENING, because the claim underneath is unchanged and is now
// SHARPER: from the seat there must be no RIG, and a shell is not a rig. A check counting both
// would have to be deleted rather than filtered, and then nothing would assert either.
const cab = rigOnly(collect({ ...BASE, external: false }, 1));
if (cab.length) problems.push(`the cab view collected ${cab.length} faces of a rig the driver is sitting inside`);

// 4. And the off switch, which has to be the frame that shipped before this layer existed.
const off = rigOnly(collect({ ...BASE, external: true, extYaw: 0, extPitch: 0.3, extZoom: 1 }, 0));
if (off.length) problems.push(`glShip 0 still collected ${off.length} faces — the off switch is not an off switch`);

ws.installGLWorld(null);
ws.RENDER_TUNE.gl = glWas; ws.RENDER_TUNE.glShip = shipWas;
globalThis.performance = clock;

if (problems.length) {
  console.error('\n✗ ownship — ' + problems.length + ' problem(s):');
  for (const p of problems) console.error('  · ' + p);
  console.error('\n  The rig is painted on the canvas either way, so none of this is visible in the');
  console.error('  frame — what goes missing is its reflection and its place in the depth buffer.');
  process.exit(1);
}
console.log(`✓ ownship: the chase camera hands ${ext.length} finished faces to the GPU, orbiting moves none of them, the cab hands none, and glShip 0 hands none.`);
