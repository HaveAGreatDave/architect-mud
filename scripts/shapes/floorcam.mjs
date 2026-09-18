// floorcam — the floor and the geometry must be drawn from ONE camera.
//
//   node scripts/shapes/floorcam.mjs
//
// There are THREE readers of the ground camera, not two, and that is the whole of what this
// checks. `makeCam` builds the camera every building, kerb and lane marking is projected through;
// `drawMode7Floor` rasterises (or hands to a shader) the ground they stand on; and both are handed
// their terms by the SAME call site, separately. So the two can disagree, and nothing else in this
// repo can see it — `gl:parity` compares the GL matrix against `cam.proj` (one camera, both sides),
// `__glFloor()` compares the GPU floor against the software raster (one set of terms, both sides),
// and a disagreement between the floor's terms and the camera's is invisible to both.
//
// ⚠ IT HAS GONE WRONG THREE TIMES, ONCE PER AXIS, AND THE LAST ONE HAD BEEN THERE SINCE `fov`.
//
//   eye height — the floor read `RENDER_TUNE.eh` while `makeCam` read `v.eyeH ?? RENDER_TUNE.eh`.
//   vertical scale — the floor read the raw `focal` while `makeCam` read `focal * (v.fovMul || 1)`.
//   lateral scale — the floor spelled it as a bare `LAT = 1.15` while `makeCam` spells it as
//     `(W/2)/1.15 · fov · fovMul`, so the ground was a `1/(fov·fovMul)` magnification of the world
//     the buildings on it were projected into. Reported as the ground SHIFTING when the detached
//     camera moved or looked around, which is what a scale error about the frame centre looks like
//     the moment anything pans: the ground slides across the frame faster than the city on it.
//
// The truck cab is the seat that trips both: it is the only one that passes `eyeH` (0.12) and the
// only one that passes `fovMul` (1.22). On the canvas the second one hid, because the floor is only
// biome colour and the road is PAINTED over it in queue order — nothing ever compared the two. Once
// `GROUND_FULL` moved the road onto the GPU it became a depth fight: at a given screen row the floor
// calls the ground `EH*depth/(sy-horizonY)` and the camera puts the quad at `fovMul` times that, so
// the quad is further at EVERY pixel and loses the depth test everywhere. What a driver saw was the
// whole road — tarmac, kerbs, lane markings, crosswalk — replaced by flat biome green, with the
// external chase view of the same junction perfectly correct because it passes no `fovMul`.
//
// ⚠ THE COMPARISON IS FREE, BECAUSE THE FRAME ALREADY MAKES IT. `drawWorldObjects` hands the GL hook
// `cam` and `floor: FLOOR_STATE` in the same call, so the hook is the one place both are in scope at
// once. No internals are reached for and no second derivation is written down here — a gate that
// recomputed the right answer would be a fourth reader and could drift from all three.
//
// ⚠ AND EQUALITY IS EXACT (`Object.is`). These are the same expression evaluated twice, not two
// roads to one number, so "close" is the wrong bar: a tolerance here would pass the 1.22 that
// shipped, which is only 22%.
//
// ⚠ AND THE ROUND TRIP IS WHAT A FIELD LIST CANNOT BE. Comparing named terms only ever catches the
// terms somebody thought to name — this gate held eye height, vertical scale and horizon while the
// lateral scale, the camera offset and the heading went unchecked beside them. So the last check is
// the whole camera at once: take a ground pixel, invert it through the FLOOR to a world point, and
// project that point back through the CAMERA. Every term either renderer uses is in that loop, and
// a pixel that does not come back where it started is a building standing off its own ground by
// however far it missed by.
import { loadWindshield, stubCanvas } from './dom-stub.mjs';

const ws = await loadWindshield();
const W = 640, H = 360;
stubCanvas('__fc', W, H);

const N = 41;
const map = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => (
  { kind: 'land', biome: (x + y) % 5 === 0 ? 'redrock' : 'parkland', flr: 0 })));

const BASE = {
  cls: 'truck', phase: 'cruise', worldBlend: 1, height: 0, hour: 13,
  weather: 'clear', speed: 0.4, map, heading: 0,
  mapCenter: { x: 100, y: 100 }, mapOffset: { x: 0.2, y: -0.3 },
};

// The seats that actually differ, plus the identity case that must stay bit-identical.
const SEATS = [
  { label: 'aircraft cockpit (no overrides)', view: {} },
  { label: 'truck cab (eyeH 0.12, fovMul 1.22)', view: { eyeH: 0.12, fovMul: 1.22 } },
  { label: 'fovMul alone, wider', view: { fovMul: 1.22 } },
  { label: 'fovMul alone, narrower', view: { fovMul: 0.8 } },
  { label: 'eyeH alone', view: { eyeH: 2.0 } },
  { label: 'both, climbing', view: { eyeH: 0.12, fovMul: 1.22, height: 0.4 } },
  { label: 'external chase', view: { external: true, extYaw: 0, extPitch: 0.43, extZoom: 1 } },
  // The detached camera (freecam.js). It is the seat the lateral error was reported from, and the
  // only one that reaches the floor through `chase.fx`/`fy`/`ez` rather than through `back`/`up`.
  { label: 'freecam, centred', view: { external: true, freeCam: { x: 0, y: 0, z: 0.5, yaw: 0, pitch: 0, roll: 0, fov: 1 } } },
  { label: 'freecam, moved off the rig', view: { external: true, freeCam: { x: 3, y: -2, z: 1.4, yaw: 0, pitch: 0, roll: 0, fov: 1 } } },
  { label: 'freecam, yawed', view: { external: true, freeCam: { x: 0, y: 0, z: 0.5, yaw: 37, pitch: 0, roll: 0, fov: 1 } } },
  { label: 'freecam, zoomed 2x', view: { external: true, freeCam: { x: 0, y: 0, z: 0.5, yaw: 0, pitch: 0, roll: 0, fov: 2 } } },
];

// A ground pixel, inverted through the floor and projected back through the camera. The floor is
// `p = (sy − horizonY)/depth`, `d = EH/p`, `l = ((sx − cx)/halfW)·d·LAT`, and its (wx, wy) are
// MAP-WINDOW coordinates — `cam.proj` takes CRAFT-relative ones, which is the `ox`/`oy` on the way
// in. Nothing here is a fourth derivation: every number comes off the two objects under test.
function roundTrip(f, cam, sx, sy) {
  const d = f.EH / ((sy - f.horizonY) / f.depth);
  const l = ((sx - f.cx) / f.halfW) * d * f.LAT;
  const wx = f.ax + d * f.sinh + l * f.cosh, wy = f.ay - d * f.cosh + l * f.sinh;
  const q = cam.proj(wx - cam.ox, wy - cam.oy, 0);
  return [q.sx - sx, q.sy - sy];
}

const clock = globalThis.performance;
globalThis.performance = { ...clock, now: () => 1e6 };

const glWas = ws.RENDER_TUNE.gl, glFloorWas = ws.RENDER_TUNE.glFloor;
const problems = [];
const rows = [];

for (const seat of SEATS) {
  let seen = null;
  // The hook is the one place `cam` and `FLOOR_STATE` are both in scope. Answering null afterwards
  // is the ordinary "no WebGL2" path and is what floorfallback already pins; by then this has its
  // reading, and the flag is put back before the next seat.
  ws.installGLWorld((cells, cam, opts) => {
    const f = opts && opts.floor;
    if (f) seen = { f, cam, fDepth: f.depth, cDepth: cam.depth, fEH: f.EH, cEH: cam.EH, fHy: f.horizonY, cHy: cam.horizonY, fFL: f.FL, cFL: cam.FL };
    return null;
  });
  ws.RENDER_TUNE.gl = 1; ws.RENDER_TUNE.glFloor = 1;
  ws.paintWindshield('__fc', { ...BASE, ...seat.view });

  if (!seen) { problems.push(`${seat.label}: the GL hook never saw a FLOOR_STATE — this check cannot see anything`); continue; }
  rows.push(`  · ${seat.label}: depth ${seen.fDepth.toFixed(3)}, EH ${seen.fEH.toFixed(3)}, horizon ${seen.fHy.toFixed(3)}`);
  if (!Object.is(seen.fDepth, seen.cDepth)) problems.push(`${seat.label}: vertical scale — floor ${seen.fDepth}, camera ${seen.cDepth} (ratio ${(seen.cDepth / seen.fDepth).toFixed(4)})`);
  if (!Object.is(seen.fEH, seen.cEH)) problems.push(`${seat.label}: eye height — floor ${seen.fEH}, camera ${seen.cEH}`);
  if (!Object.is(seen.fHy, seen.cHy)) problems.push(`${seat.label}: horizon — floor ${seen.fHy}, camera ${seen.cHy}`);
  // The lateral scale, which both now take off one function (`viewLatFocal`). ⚠ THIS ONE IS NOT
  // SUFFICIENT ON ITS OWN and is kept for what it catches early: a SECOND derivation reappearing on
  // either side. It says the two agree about the number, never that the floor spends it — with
  // `RENDER_TUNE.floorLat` at 0 it passes on every seat while the ground is 22% out. The round trip
  // below is the check that cannot be satisfied vacuously.
  if (!Object.is(seen.fFL, seen.cFL)) problems.push(`${seat.label}: lateral scale — floor ${seen.fFL}, camera ${seen.cFL} (ratio ${(seen.cFL / seen.fFL).toFixed(4)})`);

  // …and the whole camera at once. A scale error about the frame centre is zero in the middle and
  // biggest at the edges, so the sweep is deliberately widest there.
  let worst = 0, worstAt = [0, 0, 0, 0];
  for (const fx of [0.02, 0.2, 0.5, 0.8, 0.98]) {
    for (const fy of [0.15, 0.5, 0.95]) {
      const sy = seen.f.horizonY + (H - seen.f.horizonY) * fy;
      if (!(sy > seen.f.horizonY + 2)) continue;
      const sx = W * fx;
      const [dx, dy] = roundTrip(seen.f, seen.cam, sx, sy);
      const e = Math.hypot(dx, dy);
      if (e > worst) { worst = e; worstAt = [sx, sy, dx, dy]; }
    }
  }
  rows[rows.length - 1] += `, round trip ${worst.toExponential(1)}px`;
  // A tolerance rather than exact equality, and only here: the floor reaches the same lateral focal
  // length by a different arithmetic route (`halfW / FL`, back through a multiply), so the loop
  // lands a few ulps out. A ten-thousandth of a pixel is four orders under a rounding error and six
  // under the 34.6px the bug this catches was worth.
  if (!(worst < 1e-4)) problems.push(`${seat.label}: a ground pixel does not come back — ${worst.toFixed(2)}px at (${worstAt[0].toFixed(0)}, ${worstAt[1].toFixed(0)}), off by dx ${worstAt[2].toFixed(2)} dy ${worstAt[3].toFixed(2)}`);
}

ws.installGLWorld(null);
ws.RENDER_TUNE.gl = glWas; ws.RENDER_TUNE.glFloor = glFloorWas;
globalThis.performance = clock;

if (problems.length) {
  console.error('\n✗ floorcam — ' + problems.length + ' disagreement(s) between the floor and the camera:');
  for (const p of problems) console.error('  · ' + p);
  console.error('\n  The ground is rasterised from one camera and the geometry standing on it is');
  console.error('  projected from another. On the 2-D painter that hides (the road is painted over');
  console.error('  the floor in queue order); with GROUND_FULL the road loses the depth test and the');
  console.error('  whole surface disappears under the biome colour. See drawMode7Floor.');
  process.exit(1);
}
console.log(`✓ floorcam: the floor and the camera agree on eye height, vertical scale, horizon and lateral scale across ${SEATS.length} seats, and a ground pixel round-trips through both.`);
for (const r of rows) console.log(r);
