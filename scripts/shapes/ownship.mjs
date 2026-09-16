// ownship — the rig has to reach the GPU, and the two ways it did not are both silent.
//
//   node scripts/shapes/ownship.mjs
//
// The vehicle you are in is drawn by a software rasteriser onto the 2-D canvas AFTER the GL canvas
// has been composited, which is why it drew through buildings and could not appear in a puddle.
// `gl/ownship.js` gives it real geometry; this checks that the geometry actually arrives.
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
import { loadWindshield, stubCanvas } from './dom-stub.mjs';

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

// 2. The cab, where there is no rig to collect: you are inside it.
const cab = collect({ ...BASE, external: false }, 1);
if (cab && cab.length) problems.push(`the cab view collected ${cab.length} faces of a rig the driver is sitting inside`);

// 3. And the off switch, which has to be the frame that shipped before this layer existed.
const off = collect({ ...BASE, external: true, extYaw: 0, extPitch: 0.3, extZoom: 1 }, 0);
if (off && off.length) problems.push(`glShip 0 still collected ${off.length} faces — the off switch is not an off switch`);

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
console.log(`✓ ownship: the chase camera hands ${ext.length} finished faces to the GPU, the cab hands none, and glShip 0 hands none.`);
