// DOES THE PUDDLE FIELD KNOW IT IS ON A ROAD?
//
//   node scripts/shapes/puddle.mjs            # gate
//   node scripts/shapes/puddle.mjs --report   # the cross-section every surface in the scene emits
//
// Water on a road is not scattered. A carriageway is built with a crown and a crossfall of about
// two and a half per cent either side precisely so that it is not: the camber delivers everything
// to the channel against the kerb and the channel takes it to a gully. So standing water lives in
// the gutter line, in the wheel ruts traffic has worn into the travelled way, and in whatever sags
// between one gully and the next — and essentially never in the middle of an unrutted lane.
//
// gl/ground.js builds that cross-section out of two per-vertex numbers, 'aLat' (tiles from the
// crown) and 'aKerb' (where the kerb is, in the same units). This checks the half a headless gate
// can reach: that the PRODUCER emits them, and emits them correctly.
//
// ⚠ IT DELIBERATELY DOES NOT RE-IMPLEMENT THE SHADER. A JS copy of the GLSL would be a second model
// of the same thing and would agree with whatever the first one did, which is the duplicate
// implementation the rest of this renderer is written to avoid. What is checked here is the DATA: a
// wrong 'aKerb' puts the gutter under the pavement, a missing one turns the whole feature off.
//
// ⚠ AND THE SILENT FAILURE IS THE WHOLE REASON THIS EXISTS. With 'aKerb' 0 the shader falls back to
// the isotropic field — which is a perfectly good-looking road, because it is the road that
// shipped. A break here throws nothing, warns nothing and draws nothing obviously wrong. It just
// quietly stops being a drainage model and goes back to blobs.
import { loadWindshield, stubCanvas } from './dom-stub.mjs';

const REPORT = process.argv.includes('--report');
const ws = await loadWindshield();
const W = 640, H = 360;
stubCanvas('__pud', W, H);

// A THREE-WIDE ARTERY running north-south, a one-tile side street, a crossroads and an apron. The
// artery exercises blockSpan (a block of tiles that is ONE road, not three roads side by side); the
// side street is the width-1 case; the junction and the apron are the two surfaces that have to
// report no cross-section at all.
const N = 41, R = 20;
const ART = [R - 1, R, R + 1];
const SIDE = R + 6;
const CROSS = R - 6;
const APRON = { x: R - 8, y: R - 4 };   // ⚠ AHEAD of the camera (heading 0 looks toward lower y) or it is never drawn
const cellAt = (x, y) => {
  if (x === APRON.x && y === APRON.y) return { kind: 'field', biome: 'city', flr: 0 };
  const ns = ART.includes(x) || x === SIDE, ew = y === CROSS;
  if (ns && ew) return { kind: 'land', biome: 'city', flr: 0, road: 1, rd: 'nesw', pw: 1 };
  if (ns) return { kind: 'land', biome: 'city', flr: 0, road: 1, rd: 'ns', pw: 1 };
  if (ew) return { kind: 'land', biome: 'city', flr: 0, road: 1, rd: 'ew', pw: 1 };
  return { kind: 'land', biome: 'city', flr: 0 };
};
const map = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => cellAt(x, y)));

const VIEW = {
  cls: 'truck', variant: 'hauler', phase: 'ground', worldBlend: 1, height: 0, eyeH: 0.12, fovMul: 1.22,
  hour: 12, weather: 'clear', speed: 0, map, heading: 0,
  mapCenter: { x: 100, y: 100 }, mapOffset: { x: 0, y: 0 },
};

const clock = globalThis.performance;
globalThis.performance = { ...clock, now: () => 1e6 };
const glWas = ws.RENDER_TUNE.gl, floorWas = ws.RENDER_TUNE.glFloor;
ws.RENDER_TUNE.gl = 1; ws.RENDER_TUNE.glFloor = 1;
let ground = null;
const surface = globalThis.document.createElement('canvas');
surface.width = W; surface.height = H;
// ⚠ THE HOOK HAS TO RETURN A CANVAS. Anything else is the no-WebGL2 path, which finishes the frame
// in 2-D and emits no ground quads at all — and an empty tally would read as a pass.
ws.installGLWorld((cells, cam, o) => { ground = o.ground || []; return { faces: 1, canvas: surface }; });
ws.paintWindshield('__pud', VIEW);
ws.paintWindshield('__pud', VIEW);
ws.installGLWorld(null);
ws.RENDER_TUNE.gl = glWas; ws.RENDER_TUNE.glFloor = floorWas;
globalThis.performance = clock;

const problems = [];
const quads = ground || [];
if (!quads.length) problems.push('the scene produced no ground quads at all');
const fills = quads.filter((q) => !q.paint && !q.add && !q.over);
const roadFills = fills.filter((q) => q.road);
const otherFills = fills.filter((q) => !q.road);

// 1. EVERY CARRIAGEWAY FILL CARRIES ONE — EXCEPT THE JUNCTIONS, WHICH IS NOT AN EXEMPTION BUT THE
//    ANSWER. A crossroads is where two crossfalls meet and neither wins, which is exactly why
//    intersections are the classic ponding location; there is no crown to measure from and the
//    isotropic field is the right shape for it. The scene has four of them (three artery columns
//    and the side street, each crossing the east-west run), so the count is an assertion rather
//    than a tolerance: any OTHER tile losing its cross-section moves this number.
const JUNCTIONS = ART.length + 1;
if (roadFills.length < 8) problems.push(`only ${roadFills.length} carriageway fills in the scene — the sweep is not reaching the road`);
const noXsec = roadFills.filter((q) => !(q.kerb > 0) || !q.lat || q.lat.length !== 4);
if (noXsec.length !== JUNCTIONS) problems.push(`${noXsec.length} carriageway fills carry no cross-section, expected exactly the ${JUNCTIONS} junction tiles`);

// 2. AND A JUNCTION AND AN APRON MUST NOT. Not because the data is unavailable but because the
//    answer is that there isn't one: a crossroads is where two crossfalls meet and neither wins,
//    which is exactly why intersections pond in the middle.
if (!otherFills.length) problems.push('the apron was never drawn — the non-carriageway half of this gate checked nothing');
const stray = otherFills.filter((q) => q.kerb > 0);
if (stray.length) problems.push(`${stray.length} non-carriageway fills claim a cross-section`);

// 3. THE TARMAC HAS TO REACH ITS OWN KERB, and the paint must not run far past it. Two copies of
//    where a kerb sits is two answers to one question, and this failure is invisible in a picture:
//    a kerb reported half a tile too wide puts the gutter under the footway.
const latSpan = (q) => (q.lat ? Math.max(...q.lat.map(Math.abs)) : 0);
const byKerb = new Map();
for (const q of quads) {
  if (!q.road || !(q.kerb > 0)) continue;
  const k = q.kerb.toFixed(4);
  const e = byKerb.get(k) || { kerb: q.kerb, fill: 0, paint: 0 };
  if (q.paint) e.paint = Math.max(e.paint, latSpan(q)); else e.fill = Math.max(e.fill, latSpan(q));
  byKerb.set(k, e);
}
for (const [, e] of byKerb) {
  if (e.fill < e.kerb * 0.9) problems.push(`a carriageway with kerb ${e.kerb.toFixed(3)} lays tarmac only to lat ${e.fill.toFixed(3)} — the fill does not reach its own kerb`);
  if (e.paint > e.kerb + 0.35) problems.push(`paint reaches lat ${e.paint.toFixed(3)} on a kerb of ${e.kerb.toFixed(3)} — more than a pavement band past the kerb face`);
}

// 4. A BLOCK IS ONE ROAD. The three-wide artery has to resolve to ONE kerb shared by all its tiles.
//    Three narrow ones would mean every tile still believes it is a whole street, which is the same
//    mistake the marking pass records as drawing a row of traffic islands.
const kerbs = [...new Set(roadFills.map((q) => q.kerb.toFixed(3)))].sort();
const wide = kerbs.filter((k) => Number(k) > 0.6);
if (!wide.length) problems.push(`no wide carriageway found — the three-wide artery resolved to kerbs ${kerbs.join(', ')}, so blockSpan is not reaching the cross-section`);

// 5. AND THE CROWN IS IN THE MIDDLE OF IT. Across the whole block the lateral runs kerb to kerb and
//    is symmetrical about zero; a block whose lats are all one sign put its crown at the edge.
if (wide.length) {
  const wideLats = roadFills.filter((q) => q.kerb.toFixed(3) === wide[0]).flatMap((q) => q.lat);
  const lo = Math.min(...wideLats), hi = Math.max(...wideLats);
  if (!(lo < -0.3 && hi > 0.3)) problems.push(`the wide block's lateral runs ${lo.toFixed(2)}..${hi.toFixed(2)} — it does not straddle its own crown`);
  if (Math.abs(lo + hi) > 0.12) problems.push(`the wide block's lateral is lopsided (${lo.toFixed(2)}..${hi.toFixed(2)}) — the crown is off centre`);
}

if (REPORT) {
  console.log(`  ground quads ${quads.length}, fills ${fills.length} (carriageway ${roadFills.length}, other ${otherFills.length})`);
  console.log(`  kerbs found: ${kerbs.join(', ')}`);
  for (const [k, e] of byKerb) console.log(`    kerb ${k}: tarmac reaches lat ${e.fill.toFixed(3)}, paint reaches ${e.paint.toFixed(3)}`);
}

if (problems.length) {
  console.error(`\n✗ puddle — ${problems.length} problem(s):`);
  for (const p of problems) console.error('  ' + p);
  console.error('\n  gl/ground.js builds the gutter, the camber and the wheel ruts out of aLat/aKerb.');
  console.error('  Without them it falls back to isotropic noise, which looks fine and is not a road.');
  process.exit(1);
}
console.log(`✓ puddle: ${roadFills.length} carriageway fills carry a cross-section, ${otherFills.length} other fills correctly carry none, kerbs ${kerbs.join('/')}`);
