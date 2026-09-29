// OLD COLDWATER'S PAINT: SLOGANS ON THE WALLS, AND STILL NO SIGNS.
//
//   node scripts/shapes/slumpaint.mjs            # gate
//   node scripts/shapes/slumpaint.mjs --report   # the counts
//
// The Shingles' buildings paint their walls with `slumScrawl`, which on the decal path now writes an
// anti-Architect slogan on most of them (`slumSlogan`). The rule it has to keep is the one the
// district was built on: paint may carry words, a sign may not, and nothing on these walls reads as
// lit after dark. So, over a street of the six slum trades by day and by night:
//
//   · slogans reach the decal sink on the GL path, more than one of them;
//   · the night frame uses the darkened pages and never the day ones;
//   · with no GL hook (the canvas path) there are none, because a textured quad there is a flat fill;
//   · and no sign lettering (`st:`) or neon reaches the sink from these buildings.
import { loadWindshield, stubCanvas } from './dom-stub.mjs';

const REPORT = process.argv.includes('--report');
const problems = [];
const report = (...a) => { if (REPORT) console.log(...a); };

const ws = await loadWindshield();
const Wc = 640, Hc = 360;
stubCanvas('__sp', Wc, Hc);
const N = 41, R = 20;
const TRADES = ['flophouse', 'soup_kitchen', 'bonesetter', 'shebeen', 'water_seller', 'ruin'];
// A north-south lane under the camera with the six trades down both sides of it, a tile or two out.
const map = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => {
  if (x === R) return { kind: 'land', biome: 'city', flr: 0, road: 1, rd: 'ns' };
  const k = R - y;
  if (Math.abs(x - R) === 1 && k >= 1 && k <= 6) {
    return { kind: 'land', biome: 'city', flr: 0, bt: TRADES[(k - 1 + (x > R ? 3 : 0)) % TRADES.length], is_building: 1, floors: 2 };
  }
  return { kind: 'land', biome: 'city', flr: 0 };
}));
const view = (hour) => ({ cls: 'truck', variant: 'hauler', phase: 'ground', worldBlend: 1, height: 0, eyeH: 0.12, fovMul: 1.22,
  hour, weather: 'clear', speed: 0, map, heading: 0, mapCenter: { x: 921, y: 916 }, mapOffset: { x: 0, y: 0 }, resFloor: 1 });

const clock = globalThis.performance;
globalThis.performance = { ...clock, now: () => 1e6 };
const was = { gl: ws.RENDER_TUNE.gl, floor: ws.RENDER_TUNE.glFloor };

function frame(v, gl) {
  ws.RENDER_TUNE.gl = gl ? 1 : 0; ws.RENDER_TUNE.glFloor = gl ? 1 : 0;
  let got = null;
  if (gl) {
    const c = globalThis.document.createElement('canvas'); c.width = Wc; c.height = Hc;
    ws.installGLWorld((cells, cam, o) => { got = (o.decals || []).map((d) => String(d.key)); return { faces: 1, canvas: c }; });
  } else ws.installGLWorld(null);
  ws.paintWindshield('__sp', v);
  ws.paintWindshield('__sp', v);
  ws.installGLWorld(null);
  return got || [];
}
const slogans = (keys) => keys.filter((k) => k.startsWith('slum|slogan|'));

const day = frame(view(13), true), night = frame(view(23), true);
report(`day: ${slogans(day).length} slogans of ${day.length} decals; night: ${slogans(night).length} of ${night.length}`);
if (slogans(day).length < 2) problems.push(`${slogans(day).length} slogans on a street of twelve slum buildings by day; most walls should carry one`);
if (slogans(night).length < 2) problems.push(`${slogans(night).length} slogans on the same street at night`);
if (slogans(night).some((k) => k.endsWith('|d'))) problems.push('a slogan at night wears the day page; it would be the brightest thing on the wall');
if (slogans(day).some((k) => k.endsWith('|n'))) problems.push('a slogan by day wears the night page');
if (new Set(slogans(day)).size < 2) problems.push('every wall says the same thing');
for (const [name, keys] of [['day', day], ['night', night]]) {
  const signs = keys.filter((k) => k.startsWith('st:') || /neon/i.test(k));
  if (signs.length) problems.push(`${signs.length} sign or neon decals on the slum street by ${name}: ${[...new Set(signs)].slice(0, 3).join(', ')}`);
}
// The canvas path: nothing reaches a sink, so ask the drawer another way. With no hook there are no
// decals at all; what matters is that the frame paints and nothing throws.
try { frame(view(13), false); } catch (e) { problems.push(`the canvas path threw: ${e.message}`); }

ws.RENDER_TUNE.gl = was.gl; ws.RENDER_TUNE.glFloor = was.floor;
globalThis.performance = clock;

if (problems.length) {
  console.error(`\n✗ slumpaint — ${problems.length} problem(s):`);
  for (const p of [...new Set(problems)]) console.error('  ' + p);
  process.exit(1);
}
console.log(`✓ slumpaint: ${slogans(day).length} slogans on an Old Coldwater street by day and ${slogans(night).length} darkened by night, and no signs.`);
