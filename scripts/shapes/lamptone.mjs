// lamptone — does every street lamp burn untinted white?
//
//   node scripts/shapes/lamptone.mjs
//   node scripts/shapes/lamptone.mjs --report
//
// A street lamp's pool goes into `SPRITE_SINK`, `pickLights` ranks it, and the ground shader reads
// its raw colour as `uWetC`, so the streak on damp tarmac and the glint in standing water are both
// made of whatever the lamp is. Every lamp is neutral white in every biome; colour at night is the
// neon's job (2026-10-20). This fails on any tinted lamp: a biome table or a seeded failing tube
// creeping back in.
//
// It reads the pushed light, not the picture, so it needs no rasteriser and no GPU.
import { loadWindshield, stubCanvas } from './dom-stub.mjs';

const ws = await loadWindshield();
const REPORT = process.argv.includes('--report');
const W = 640, H = 360;
stubCanvas('__lamp', W, H);

// Bare road and nothing else, so every sprite in the frame is a lamp.
const N = 41, R = 20;
const mapFor = (biome) => Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => (
  Math.abs(x - R) <= 1
    ? { kind: 'land', biome, road: 1, rd: 'ns', flr: 0, pw: 1, sl: ((x + y) % 3 === 0) ? 1 : undefined }
    : { kind: 'land', biome, flr: 0 }
)));

const BIOMES = ['citycore', 'uptown', 'civic', 'marquee', 'freight', 'industrial', 'docks', 'infra', 'ruins', 'oldcoldwater', 'badlands', 'parkland'];

const clock = globalThis.performance;
globalThis.performance = { ...clock, now: () => 1e6 };
globalThis.window.devicePixelRatio = 1;
const problems = [];

function lampsFor(biome) {
  let sprites = null;
  // ⚠ Put the flag back every time: a hook that returns null is the no-WebGL2 path, and the pass
  // answers it by setting RENDER_TUNE.gl to 0, so only the first biome would open a sprite sink.
  ws.RENDER_TUNE.gl = 1;
  ws.installGLWorld((cells, cam, o) => { sprites = (o.sprites || []).slice(); return null; });
  // Night, because an unlit lamp pushes nothing.
  ws.paintWindshield('__lamp', { cls: 'truck', variant: 'hauler', phase: 'ground', worldBlend: 1,
    height: 0, eyeH: 0.12, hour: 23, weather: 'clear', speed: 0, heading: 0, resFloor: 1,
    map: mapFor(biome), mapCenter: { x: 100, y: 100 }, mapOffset: { x: 0.1, y: -0.2 } });
  ws.installGLWorld(null);
  return sprites || [];
}

const seen = new Map();
for (const biome of BIOMES) {
  const lamps = lampsFor(biome);
  if (!lamps.length) { problems.push(`${biome}: the scene lit no lamps at all; the census is vacuous, fix the scene`); continue; }
  const tones = new Map();
  for (const s of lamps) { const k = (s.rgb || []).join(','); tones.set(k, (tones.get(k) || 0) + 1); }
  seen.set(biome, { n: lamps.length, tones });
  for (const [k, n] of tones) {
    const [r, g, b] = k.split(',').map(Number);
    if (!(r === g && g === b)) problems.push(`${biome}: ${n} lamp(s) burning tinted rgb(${k}); street lamps are white`);
  }
}

ws.installGLWorld(null);
globalThis.performance = clock;

if (REPORT) {
  console.log('');
  for (const [biome, { n, tones }] of seen) {
    const list = [...tones].sort((x, y) => y[1] - x[1]).map(([k, c]) => `rgb(${k}) x${c}`).join('   ');
    console.log(`  ${biome.padEnd(13)}${String(n).padStart(3)} lamps   ${list}`);
  }
  console.log('');
}

if (problems.length) {
  console.error(`\n✗ lamptone: ${problems.length} problem(s):`);
  for (const p of problems) console.error('  · ' + p);
  console.error('\n  A lamp\'s colour is the puddle\'s colour; see LAMP_WHITE in windshield.js.');
  process.exit(1);
}
console.log(`✓ lamptone: every lamp in ${BIOMES.length} biomes burns untinted white.`);
