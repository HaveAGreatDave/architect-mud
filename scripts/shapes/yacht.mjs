// yacht — the Echelon's hull is geometry now, and every way that can fail is invisible.
//
//   node scripts/shapes/yacht.mjs
//   node scripts/shapes/yacht.mjs --report
//
// She is drawn by her own function rather than extruded from a storey stack, so she is in
// `MASS_EXCEPT` and never reaches the GL mass — and unlike every other mark, her branch carried no
// occlusion probe of any kind, not even an all-or-nothing one. The canvas is painted AFTER the city
// is composited, so a two-tile ship drew over every building in the Basin from every angle. That is
// "the Echelon shows through buildings", and it is the same shape as the depot shed, the signal
// mast, the lights, the Curtain and the signage before it.
//
// `gl/solids.js` takes her hull now — the same depth-writing layer the rig and the shed go through —
// and this checks the handover, because nothing in the picture says whether it happened:
//
//   · COLLECTED TOO LATE is the first failure, and the one this branch was built to hit. Her whole
//     draw was one `emitFace` closure, which runs at FLUSH — after the pass has gone to the GPU and
//     every sink is null — so a hull collected from in there reaches the GPU never, draws nothing
//     and reports nothing. The Curtain's own trap. The hull is collected INLINE now.
//
//   · CULLED OR CLIPPED FIRST is the second, and it is the subtler one. Her painter culls backfaces
//     against the eye and clips to the near plane before it draws, and both are answers about where
//     the CAMERA is. Collect after either and the SHAPE the depth buffer holds is a function of the
//     camera — she loses her far side as you orbit her, which looks like nothing at all until a
//     reflection or a shadow reads the buffer. `bay.mjs` names the same failure by its face count.
//
//   · AND CLAIMED BUT NOT COLLECTED is the third. The fittings pass is told the hull is already in
//     the depth buffer; tell it that after a collection that threw and the ship is not drawn at all.
import { loadWindshield, stubCanvas } from './dom-stub.mjs';

const ws = await loadWindshield();
const REPORT = process.argv.includes('--report');
const W = 640, H = 360;
stubCanvas('__yacht', W, H);

// Open Basin water with the Echelon a few tiles ahead — her ordinary case, and the one the report
// is about: nothing around her but the city behind.
const N = 41, R = 20;
const map = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => (
  x === R && y === R - 5
    ? { kind: 'land', biome: 'water', road: 0, mark: 'yacht', heading: 30, wake: { spd: 0.2 }, flr: 0 }
    : { kind: 'land', biome: 'water', road: 0, flr: 0 }
)));

const BASE = {
  cls: 'truck', variant: 'hauler', phase: 'ground', worldBlend: 1, height: 0, eyeH: 0.12, fovMul: 1.22,
  hour: 13, weather: 'clear', speed: 0, map, heading: 0, resFloor: 1,
  mapCenter: { x: 100, y: 100 }, mapOffset: { x: 0.1, y: -0.2 },
};

const clock = globalThis.performance;
globalThis.performance = { ...clock, now: () => 1e6 };
globalThis.window.devicePixelRatio = 1;
const glWas = ws.RENDER_TUNE.gl, floorWas = ws.RENDER_TUNE.glFloor, shipWas = ws.RENDER_TUNE.glShip;
const problems = [];

function collect(view, ship, gl = 1) {
  let seen = null;
  ws.RENDER_TUNE.gl = gl; ws.RENDER_TUNE.glFloor = gl; ws.RENDER_TUNE.glShip = ship;
  if (gl) {
    ws.installGLWorld((cells, cam, o) => {
      seen = { ship: (o.ship || []).slice(), ox: cam.ox, oy: cam.oy };
      const c = globalThis.document.createElement('canvas'); c.width = W; c.height = H;
      return { faces: 1, canvas: c };
    });
  } else { ws.installGLWorld(null); seen = { ship: [], ox: 0, oy: 0 }; }
  ws.paintWindshield('__yacht', view);        // settle every lazy cache
  globalThis.window.__emitWhoStart();
  ws.paintWindshield('__yacht', view);
  const rows = globalThis.window.__emitWho();
  ws.installGLWorld(null);
  seen.canvas = Array.isArray(rows) ? rows.reduce((n, l) => n + (parseInt(l, 10) || 0), 0) : -1;
  return seen;
}

const span = (list, axis) => {
  let a = Infinity, b = -Infinity;
  for (const q of list) for (const v of q.p) { if (v[axis] < a) a = v[axis]; if (v[axis] > b) b = v[axis]; }
  return b - a;
};

const on = collect({ ...BASE }, 1);
if (!on.ship.length) {
  problems.push('the GL frame collected NO hull geometry — the Echelon still paints over the composited city');
} else {
  let bad = 0, noCol = 0;
  for (const q of on.ship) {
    if (!q.p || q.p.length < 3) { bad++; continue; }
    for (const v of q.p) if (!Number.isFinite(v[0]) || !Number.isFinite(v[1]) || !Number.isFinite(v[2])) { bad++; break; }
    if (!q.rgb || q.rgb.length !== 3 || !q.rgb.every(Number.isFinite)) noCol++;
    if (!(q.a > 0) || !Number.isFinite(q.a)) noCol++;
  }
  if (bad) problems.push(`${bad} of ${on.ship.length} collected faces carry a non-finite vertex — that buffer rasterises nothing and throws nothing`);
  if (noCol) problems.push(`${noCol} of ${on.ship.length} collected faces carry no usable colour or alpha`);
  // She is a long low blade: about two tiles of hull, and real topside rather than a flat sheet.
  const tall = span(on.ship, 2), long = Math.max(span(on.ship, 0), span(on.ship, 1));
  if (!(tall > 0.02)) problems.push(`the hull is ${tall.toFixed(4)} tiles tall — it is flat, so the local-to-world transform is not being applied`);
  if (!(long > 0.5)) problems.push(`the hull is ${long.toFixed(3)} tiles long — that is not a ship, so the hull frame is wrong`);
}

// ── ⚠ THE SHAPE MUST NOT BE A FUNCTION OF THE CAMERA ────────────────────────
// The same hull from two seats. Her painter culls backfaces and clips to the near plane, and
// collecting after either would hand the depth buffer a different ship from each one — which draws a
// perfect picture and is wrong in a way only a comparison can see. `bay.mjs` records the same
// signature: 127 faces from the road and 126 from a quarter turn round.
//
// ⚠ AND IT COMPARES THE GEOMETRY, NOT THE COUNT, WHICH COST A DRAFT TO LEARN. A hull is very nearly
// symmetric, so a backface cull drops about half of it from every seat: restoring the bug gave 76
// faces from one seat and 76 from the other, and a count check passed it. `wv` reads the SHIP's
// own heading and never the camera's, so every collected vertex must be bit-identical between the
// two frames — which is a claim a cull cannot satisfy by coincidence.
//
// ⚠ AND THE EYE HAS TO ACTUALLY MOVE, WHICH TURNING THE HEADING DOES NOT DO. `camPos` is where the
// eye sits in the camera-relative frame, and a ground seat has no chase offset at all — it is
// (0, 0, EH) at every heading — so the backface test gives the identical answer however far the
// camera swings, and a first draft of this check passed the very bug it was written for TWICE. The
// external chase camera is what puts the eye somewhere else.
const turned = collect({ ...BASE, external: true, extYaw: 1.2, extPitch: 0.3, extZoom: 1.3, hideOwnShip: true }, 1);
if (on.ship.length && turned.ship.length) {
  if (on.ship.length !== turned.ship.length) {
    problems.push(`the hull arrives as ${on.ship.length} faces from one seat and ${turned.ship.length} from another`
      + ' — it is being culled or clipped before it is collected, so the depth buffer holds a different ship per seat');
  } else {
    let moved = 0, worst = 0;
    for (let i = 0; i < on.ship.length; i++) {
      const a = on.ship[i].p, b = turned.ship[i].p;
      if (a.length !== b.length) { moved++; continue; }
      for (let k = 0; k < a.length; k++) for (let c = 0; c < 3; c++) {
        const d = Math.abs(a[k][c] - b[k][c]);
        if (d > worst) worst = d;
        if (!Object.is(a[k][c], b[k][c])) moved++;
      }
    }
    if (moved) {
      problems.push(`moving the eye changed ${moved} of the hull's collected coordinates, worst ${worst.toFixed(4)} tiles`
        + ' — the geometry is camera-dependent, so it is being culled or clipped before it is collected');
    }
  }
}

// ── AND THE WAY OUT STILL WORKS ─────────────────────────────────────────────
// ⚠ THE CONTROL IS THE CANVAS COUNT, NOT THE SINK. An empty sink is also what comes back from a
// scene with no yacht in it, so GLASS 1 has to PAINT one: `drawYacht` is queued through `emitFace`,
// and with the hull left to the canvas that closure is the only face in an empty-water frame.
const off = collect({ ...BASE }, 0);
if (off.ship.length) problems.push(`glShip 0 still collected ${off.ship.length} faces — the switch does not reach this path`);
const flat = collect({ ...BASE }, 1, 0);
if (flat.canvas < 1) problems.push('the GLASS 1 control queued nothing at all — the scene contains no Echelon, so every answer above is vacuous');

ws.installGLWorld(null);
ws.RENDER_TUNE.gl = glWas; ws.RENDER_TUNE.glFloor = floorWas; ws.RENDER_TUNE.glShip = shipWas;
globalThis.performance = clock;

if (REPORT) {
  console.log('');
  const row = (l, s) => console.log(`  ${l.padEnd(28)}${String(s.ship.length).padStart(5)} hull faces   ${String(s.canvas).padStart(3)} canvas face(s)`);
  row('GLASS 2, glShip 1', on);
  row('GLASS 2, external chase', turned);
  row('GLASS 2, glShip 0', off);
  row('GLASS 1 (control)', flat);
  if (on.ship.length) console.log(`\n  the hull spans ${span(on.ship, 0).toFixed(2)} x ${span(on.ship, 1).toFixed(2)} tiles and stands ${span(on.ship, 2).toFixed(3)} tall.`);
  console.log('');
}

if (problems.length) {
  console.error(`\n✗ yacht — ${problems.length} problem(s):`);
  for (const p of problems) console.error('  · ' + p);
  console.error('\n  The hull has to be collected INLINE and BEFORE the cull — see the ⚠ over drawYacht.');
  process.exit(1);
}
console.log(`✓ yacht: the Echelon's hull reaches the GPU as ${on.ship.length} faces spanning ${span(on.ship, 0).toFixed(2)}x${span(on.ship, 1).toFixed(2)} tiles`
  + `, the shape is identical from a second seat, glShip 0 collects none, and the GLASS 1 control still paints her.`);
