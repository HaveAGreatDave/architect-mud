// IS ANY ROAD MARKING FIGHTING ANOTHER ROAD MARKING FOR THE SAME PIXEL?
//
//   node scripts/shapes/roadpaint.mjs            # gate
//   node scripts/shapes/roadpaint.mjs --report   # every overlapping pair, by colour
//
// The eps ladder in windshield.js orders the four things that share the ground plane — the floor,
// the tarmac at SURF_EPS, the paint at ROAD_EPS, the headlight pool, the shadows. It has nothing
// to say about two bits of PAINT, because they are the same rung: a zebra bar and the double
// yellow it is laid across are both markings, both at ROAD_EPS, and therefore exactly coplanar.
//
// Coplanar with depth-write on is not "the first one wins". It is a per-pixel coin toss decided by
// the last bits of two triangles' interpolated depth, and it moves as the camera moves — which is
// what was reported from a truck cab as flashing white patches over the yellow lines. One ordinary
// crossroads produced 196 overlapping pairs: every kerb stroke against the pavement band it edges,
// every lane dash against the crossing it runs through, and the centreline against the zebra.
//
// ⚠ A LIFT IS NOT THE FIX AND THIS GATE DELIBERATELY DOES NOT ACCEPT ONE. There is 0.001 of a tile
// between ROAD_EPS and BEAM_EPS to spend, and the ladder's own measured table says 0.002 is worth
// 1.3 depth-buffer units at forty tiles — so a sub-step inside it buys a fraction of a unit and the
// fight comes back the moment the camera pulls back. What the paint needs is not a rung of its own
// but to stop writing depth at all, so the later quad composites over the earlier one exactly as it
// does on the canvas. That is the `paint` range in gl/ground.js, and what this checks is that every
// marking is in it.
//
// ⚠ AND IT CHECKS THE ORDER TOO, not just that there is one. A deterministic order is worthless if
// it is the wrong way round: the report was about the zebra covering the centreline, and the fix is
// that the ladder goes down BEFORE the lane paint. Push order is paint order, so that is a claim
// about indices in the ground list and can be asserted.
import { loadWindshield, stubCanvas } from './dom-stub.mjs';

const REPORT = process.argv.includes('--report');
const ws = await loadWindshield();
const W = 640, H = 360;
stubCanvas('__rp', W, H);

// A CROSSROADS AHEAD ON A TWO-WIDE ARTERY, with plain single-tile streets running off it. The
// junction is what carries the crossing, and the crossing is what overlaps the centreline; the
// two-wide block exercises the other producer of paint-on-paint, which is a pavement band with a
// kerb stroke run down its road side.
//
// ⚠ IT HAS TO BE AHEAD OF THE CAMERA. The camera sits at the window centre and the near clip drops
// the tile at its own feet, so a junction on the centre tile is a junction nothing draws — and an
// empty tally is exactly what this check is least entitled to report as a pass.
//
// AND A BEND OFF TO ONE SIDE, because a swept corner is the other thing that lays paint over paint
// and the crossroads above cannot produce one. Its own little L, clear of the junction, with the
// inside of the turn left as open ground — which is exactly the condition `elbowSweep` asks about,
// so this scene sweeps and a scene with a building on that tile would not.
const N = 41, R = 20, CROSS = R - 6;
const BX = R + 4, BY = R - 3;            // the elbow itself; its arms run south and west from here
const rdAt = (x, y) => {
  const ns = x === R || x === R + 1, ew = y === CROSS;
  if (ns && ew) return 'nesw';
  if (ns) return 'ns';
  if (ew) return 'ew';
  if (x === BX && y === BY) return 'sw';
  if (x === BX && (y === BY + 1 || y === BY + 2)) return 'ns';
  if (y === BY && (x === BX - 1 || x === BX - 2)) return 'ew';
  return null;
};
const map = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => {
  const rd = rdAt(x, y);
  if (rd) return { kind: 'land', biome: 'city', flr: 0, road: 1, rd, pw: 1 };
  return { kind: 'land', biome: 'city', flr: 0 };
}));

const VIEW = {
  cls: 'truck', variant: 'hauler', phase: 'ground', worldBlend: 1, height: 0, eyeH: 0.12, fovMul: 1.22,
  hour: 12, weather: 'clear', speed: 0.2, map, heading: 0,
  mapCenter: { x: 100, y: 100 }, mapOffset: { x: 0.1, y: -0.2 },
};

const clock = globalThis.performance;
globalThis.performance = { ...clock, now: () => 1e6 };
const glWas = ws.RENDER_TUNE.gl, floorWas = ws.RENDER_TUNE.glFloor;
ws.RENDER_TUNE.gl = 1; ws.RENDER_TUNE.glFloor = 1;

let ground = null;
const surface = globalThis.document.createElement('canvas');
surface.width = W; surface.height = H;
// ⚠ THE HOOK HAS TO RETURN A CANVAS. Anything else is the no-WebGL2 path, which puts RENDER_TUNE.gl
// back to 0 and paints the next frame in 2-D — and a 2-D frame produces no ground quads at all,
// which would read as a spotless road.
ws.installGLWorld((cells, cam, o) => { ground = o.ground || []; return { faces: 1, canvas: surface }; });
ws.paintWindshield('__rp', VIEW);        // settle every lazy cache and bake
ws.paintWindshield('__rp', VIEW);
// THE CONTROL FOR THE BEND. The same scene with `roadArc` off has to produce no angled paint at
// all — without it, "there is a curve in here" could be answered by something that was always
// there, and the check below would pass on a build where the sweep never ran.
const arcWas = ws.RENDER_TUNE.roadArc;
ws.RENDER_TUNE.roadArc = 0;
let square = null;
ws.installGLWorld((cells, cam, o) => { square = o.ground || []; return { faces: 1, canvas: surface }; });
ws.paintWindshield('__rp', VIEW);
ws.RENDER_TUNE.roadArc = arcWas;
ws.installGLWorld(null);
ws.RENDER_TUNE.gl = glWas; ws.RENDER_TUNE.glFloor = floorWas;
globalThis.performance = clock;

const problems = [];
if (!ground || !ground.length) problems.push('the GL pass collected no ground quads — the scene drew nothing, so nothing below means anything');

// ── OVERLAP, IN THE PLANE ───────────────────────────────────────────────────
// Separating-axis over two convex quads. Everything here is a rectangle in the ground plane, so
// the only axes worth testing are the four edge normals, and touching edge-to-edge is not overlap.
function overlaps(a, b) {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const nx = -(q[1] - p[1]), ny = q[0] - p[0];
      let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
      for (const v of a) { const d = v[0] * nx + v[1] * ny; if (d < aMin) aMin = d; if (d > aMax) aMax = d; }
      for (const v of b) { const d = v[0] * nx + v[1] * ny; if (d < bMin) bMin = d; if (d > bMax) bMax = d; }
      const eps = 1e-7 * Math.max(1, Math.abs(aMax) + Math.abs(bMax));
      if (aMax <= bMin + eps || bMax <= aMin + eps) return false;
    }
  }
  return true;
}
const bbox = (q) => {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const v of q.p) { if (v[0] < x0) x0 = v[0]; if (v[0] > x1) x1 = v[0]; if (v[1] < y0) y0 = v[1]; if (v[1] > y1) y1 = v[1]; }
  return [x0, x1, y0, y1];
};
// The 2-D pass fades a whole tile by distance, so the same marking carries a different alpha on
// every tile; the COLOUR is what says which line it is.
const name = (q) => q.rgb.join(',');
// YEL is 230,200,74 fresh and 204,176,88 worn; every other marking in the palette is neutral or
// cooler. Warmth is the discriminator, not a literal, so a retune of the paint does not silently
// stop this checking the thing it was written for.
const isYellow = (q) => q.rgb[0] > q.rgb[2] + 40;

const rows = (ground || []).map((q, i) => ({ q, i, bb: bbox(q), z: q.p[0][2] }));
const pairs = [];
for (let i = 0; i < rows.length; i++) {
  for (let j = i + 1; j < rows.length; j++) {
    const A = rows[i], B = rows[j];
    if (A.z !== B.z) continue;                                   // a different rung of the ladder already orders these
    if (A.bb[1] <= B.bb[0] || B.bb[1] <= A.bb[0] || A.bb[3] <= B.bb[2] || B.bb[3] <= A.bb[2]) continue;
    if (!overlaps(A.q.p, B.q.p)) continue;
    pairs.push([A, B]);
  }
}

// THE CONTROL. An empty list is the answer this most wants to give and the one it is least entitled
// to — it is also what comes back from a scene with no junction in it, or a frame the GL pass never
// ran. The city above contains a crossing laid over a centreline by construction.
if (!pairs.length) problems.push('no two ground quads overlap anywhere in the scene — the map does not contain what this measures');

// ── 1. NOTHING COPLANAR MAY WRITE DEPTH ─────────────────────────────────────
const fighting = pairs.filter(([A, B]) => !A.q.paint || !B.q.paint);
for (const [A, B] of fighting.slice(0, 8)) {
  problems.push(`${name(A.q)} and ${name(B.q)} overlap at z=${A.z} and at least one writes depth — that is a stipple, not an order`);
}
if (fighting.length > 8) problems.push(`…and ${fighting.length - 8} more overlapping depth-writing pair(s)`);

// ── 2. THE CENTRELINE GOES ON LAST ──────────────────────────────────────────
// The reported bug, as an assertion. Every pair where a yellow line overlaps a marking that is not
// yellow: the yellow has to be the later push, or the other one covers it.
const mixed = pairs.filter(([A, B]) => isYellow(A.q) !== isYellow(B.q));
if (!mixed.length) problems.push('no yellow marking overlaps a white one anywhere — the crossing no longer reaches the centreline, so the ordering below is untested');
const buried = mixed.filter(([A, B]) => (isYellow(A.q) ? A : B).i < (isYellow(A.q) ? B : A).i);
for (const [A, B] of buried.slice(0, 6)) {
  const y = isYellow(A.q) ? A : B, w = y === A ? B : A;
  problems.push(`yellow (${name(y.q)}) is pushed at ${y.i}, under ${name(w.q)} at ${w.i} — the white covers the centreline`);
}
if (buried.length > 6) problems.push(`…and ${buried.length - 6} more buried yellow overlap(s)`);

// ── 3. THE CORNER SWEEPS, AND ONLY BECAUSE IT WAS ASKED TO ──────────────────
// A city of axis-aligned streets has exactly one way to put a marking on a diagonal, and that is a
// swept corner: kerb strokes, lane dashes, crossing bars, pavement bands and tile fills all have
// their edges on x or y. So "is there angled paint in this scene" IS "did the bend sweep", with no
// second definition of a curve for this to drift away from. The control renders the same scene with
// `roadArc` off and demands NONE — without it, a check that merely finds a diagonal could be
// answered by something that was in the frame all along.
const angled = (list) => (list || []).filter((q) => {
  if (!q.paint) return false;
  for (let i = 0; i < q.p.length; i++) {
    const a = q.p[i], b = q.p[(i + 1) % q.p.length];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    if (Math.abs(ex) < 1e-9 && Math.abs(ey) < 1e-9) continue;
    const off = Math.abs(Math.atan2(ey, ex) % (Math.PI / 2));
    if (off > 0.09 && off < Math.PI / 2 - 0.09) return true;      // more than 5° off both axes
  }
  return false;
});
const swept = angled(ground), squared = angled(square);
if (!swept.length) problems.push(`no marking anywhere runs at an angle to the grid — the elbow at ${BX},${BY} drew a right angle, so roadArc is off or elbowSweep refused a corner whose inside is open ground`);
if (squared.length) problems.push(`${squared.length} angled marking(s) survive with roadArc = 0 — the sweep is not what put them there, so the check above is measuring something else`);

// ── 4. AND WHICH CORNERS SWEEP IS A QUESTION ABOUT THE INSIDE OF THE TURN ───
// The pixels above say a corner swept; this says the RULE that picks the corners is the one the
// world was surveyed against. 12 of Coldwater's 21 elbows sweep and 9 stay square, and every one of
// the 9 is refused for one of exactly two reasons — so those two reasons are asserted directly
// rather than through a scene, which would need a building placed in it to test the first.
const N4 = [0, -1], E4 = [1, 0], S4 = [0, 1], W4 = [-1, 0];
const cell = (o) => ({ kind: 'land', biome: 'city', flr: 0, ...o });
const openAt = (o) => (dx, dy) => (dx === 1 && dy === -1 ? cell(o) : cell({ road: 1, rd: 'ns' }));
if (!ws._elbowSweep(openAt({}), 0, 0, N4, E4)) problems.push('an elbow with open ground on the inside of the turn refuses to sweep');
if (ws._elbowSweep(openAt({ bt: 'shop' }), 0, 0, N4, E4)) problems.push('an elbow sweeps past a building standing on the inside of the turn — a block corner is square because the block is');
if (ws._elbowSweep(openAt({ road: 1, rd: 'ew' }), 0, 0, N4, E4)) problems.push('an elbow sweeps with ROAD on the inside — that is not a corner, it is the edge of a wider mat, and the sweep curves one carriageway into another');
if (ws._elbowSweep(() => null, 0, 0, N4, E4)) problems.push('an elbow sweeps with no tile at all on the inside of the turn');
if (ws._elbowSweep(openAt({}), 0, 0, N4, S4)) problems.push("'ns' resolved to a corner — a straight is not an elbow");
if (ws._elbowSweep(openAt({}), 0, 0, E4, W4)) problems.push("'ew' resolved to a corner — a straight is not an elbow");
// ⚠ A quarter-circle, every time. A corner that swept through more than 90° would be sweeping the
// long way round the block, which atan2 hands back on two of the four corners if nobody normalises.
for (const [a, b, lbl] of [[N4, E4, 'ne'], [E4, S4, 'es'], [S4, W4, 'sw'], [N4, W4, 'nw']]) {
  const q = ws._elbowSweep((dx, dy) => cell(dx === a[0] + b[0] && dy === a[1] + b[1] ? {} : { road: 1, rd: 'ns' }), 0, 0, a, b);
  if (!q) { problems.push(`the ${lbl} corner refused to sweep with its inside left open`); continue; }
  if (Math.abs(Math.abs(q.t1 - q.t0) - Math.PI / 2) > 1e-9) problems.push(`the ${lbl} corner sweeps ${(Math.abs(q.t1 - q.t0) * 180 / Math.PI).toFixed(1)}° — a tile corner is a quarter of a circle, so this one goes the long way round the block`);
}

if (REPORT) {
  const tally = new Map();
  for (const [A, B] of pairs) {
    const k = `${name(A.q)} (${A.q.paint ? 'paint' : 'SURFACE'})  x  ${name(B.q)} (${B.q.paint ? 'paint' : 'SURFACE'})`;
    tally.set(k, (tally.get(k) || 0) + 1);
  }
  console.log(`\n  ${ground.length} ground quads, ${pairs.length} overlapping coplanar pair(s)\n`);
  for (const [k, n] of [...tally.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(4)}  ${k}`);
  console.log('');
}

if (problems.length) {
  console.error(`\n✗ roadpaint — ${problems.length} problem(s):`);
  for (const p of problems) console.error('  · ' + p);
  console.error('\n  Paint laid on paint is settled by the order it goes down in, never by the depth');
  console.error('  buffer. See the four ranges at the top of client/game/js/panels/gl/ground.js.');
  process.exit(1);
}

const painted = ground.filter((q) => q.paint).length;
console.log(`✓ roadpaint: ${pairs.length} overlapping coplanar pair(s) across ${ground.length} ground quads, every one of them in the paint range.`);
console.log(`  · ${painted} marking quads test depth and write none; the other ${ground.length - painted} are surfaces`);
console.log(`  · ${mixed.length} yellow-over-white overlap(s), all of them with the centreline on top`);
console.log(`  · ${swept.length} angled marking quad(s) at the swept corner, against ${squared.length} with roadArc = 0`);
