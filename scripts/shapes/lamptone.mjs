// lamptone — what colour is the street burning, and does the east still burn sodium?
//
//   node scripts/shapes/lamptone.mjs
//   node scripts/shapes/lamptone.mjs --report
//
// ⚠ THIS EXISTS BECAUSE THE LAMP IS THE PUDDLE. A street lamp's pool goes into `SPRITE_SINK`,
// `pickLights` ranks it, and the ground shader reads its RAW colour as `uWetC` — so the streak on
// damp tarmac and the glint in standing water are both made of whatever the lamp is. Measured on a
// wet street before this split: killing the glint moved 36% of road pixels by rgb(25,21,15), four
// times what the reflected city contributes (10% of pixels at rgb(6,3,2)). The colour in a puddle
// was never a reflection of anything a player could point at — it was six sodium lamps.
//
// So a lamp's colour is a whole-frame decision, and it fails in two directions that both look
// deliberate from inside the game:
//
//   · THE CITY QUIETLY GOES BACK TO SODIUM. `lampToneFor` keys on the biome, and `biomeOf` is a
//     chain of regexes over zone ids in plugins/flight/biomes.js. Rename a biome there, or mis-spell
//     one here, and the lookup misses, the default takes over, and the street is amber again — with
//     nothing thrown, nothing logged, and a picture that looks like a deliberate art choice.
//
//   · THE EAST GOES BLUE. Amber is RESERVED, not deleted: a works, a yard and a forecourt keep
//     sodium, and Terminus and the Scarletwastes are 78% and 71% amber on purpose. Widening the
//     cool set by one entry takes that away from a region nobody was looking at.
//
// ⚠ AND IT READS THE PUSHED LIGHT, NOT THE PICTURE. The sprite list is where the lamp's colour
// becomes a fact the rest of the frame reads, so asserting on it needs no rasteriser and no GPU —
// which is the only reason this can be a push gate at all.
import { loadWindshield, stubCanvas } from './dom-stub.mjs';

const ws = await loadWindshield();
const REPORT = process.argv.includes('--report');
const W = 640, H = 360;
stubCanvas('__lamp', W, H);

// ⚠ BARE ROAD AND NOTHING ELSE, so every sprite in the frame is a lamp. A building brings its own
// neon, its window bloom and its ground glows, and the census would then be measuring the city.
const N = 41, R = 20;
const mapFor = (biome) => Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => (
  Math.abs(x - R) <= 1
    ? { kind: 'land', biome, road: 1, rd: 'ns', flr: 0, pw: 1, sl: ((x + y) % 3 === 0) ? 1 : undefined }
    : { kind: 'land', biome, flr: 0 }
)));

// The split, as the palette board states it: blue is the field in the city, amber is reserved for
// industry and the east. `badlands` stands in for everything outside Coldwater — it is what
// `biomeOf` falls through to for an unsafe zone, and it must never go cool.
const COOL = ['citycore', 'uptown', 'civic', 'marquee'];
const WARM = ['freight', 'industrial', 'docks', 'infra', 'ruins', 'oldcoldwater', 'badlands', 'parkland'];
// What shipped before the split, to the byte. A lamp outside the cool set must be bit-identical to
// the one that has always been there — this is the claim that keeps the change to the city alone.
// ⚠ ONE LAMP IS ONE SPRITE NOW, AND WAS TWO. It used to push the halo at the fitting AND a tighter
// wash at its own foot, and both ended up in `uWetC`. The second one was a screen-space disc
// standing in for light lying on a plane seen almost edge-on, which is what `uPool` in gl/ground.js
// does properly — so with the pool on it is not pushed at all (see LAMP_HALO_S0). Both tones are
// still listed here, because at `glPool` 0 the foot wash comes back and this claim is that the
// reserved half of the city is bit-identical either way.
const SODIUM = ['255,206,132', '255,198,120'];

const clock = globalThis.performance;
globalThis.performance = { ...clock, now: () => 1e6 };
globalThis.window.devicePixelRatio = 1;
const problems = [];

function lampsFor(biome) {
  let sprites = null;
  // ⚠ PUT THE FLAG BACK EVERY TIME. A hook that returns null is the no-WebGL2 path, and the pass
  // answers it by setting RENDER_TUNE.gl to 0 — so without this only the FIRST biome in the sweep
  // ever opens a sprite sink and every one after it reports an empty street.
  ws.RENDER_TUNE.gl = 1;
  ws.installGLWorld((cells, cam, o) => { sprites = (o.sprites || []).slice(); return null; });
  // Night, because an unlit lamp pushes nothing at all and the census would be empty for a reason
  // that has nothing to do with its colour.
  ws.paintWindshield('__lamp', { cls: 'truck', variant: 'hauler', phase: 'ground', worldBlend: 1,
    height: 0, eyeH: 0.12, hour: 23, weather: 'clear', speed: 0, heading: 0, resFloor: 1,
    map: mapFor(biome), mapCenter: { x: 100, y: 100 }, mapOffset: { x: 0.1, y: -0.2 } });
  ws.installGLWorld(null);
  return sprites || [];
}

const seen = new Map();
for (const biome of [...COOL, ...WARM]) {
  const lamps = lampsFor(biome);
  if (!lamps.length) { problems.push(`${biome}: the scene lit no lamps at all — the census is vacuous, fix the scene`); continue; }
  // The tone is per LAMP (see LAMP_FAILING), so the question is which tones appear, not the mean.
  const tones = new Map();
  for (const s of lamps) { const k = (s.rgb || []).join(','); tones.set(k, (tones.get(k) || 0) + 1); }
  seen.set(biome, { n: lamps.length, tones });
  // ⚠ SODIUM RAMPS DOWN, MAGENTA DIPS IN THE MIDDLE. 'r > b' calls the failing tube warm, because
  // rgb(236,130,205) has more red than blue — and it is the one warm-ish tone that is meant to be
  // there. A sodium is monotone r > g > b; a magenta is r > b > g.
  const isWarm = ([r, g, b]) => r > g && g > b;
  for (const [k, n] of tones) {
    const rgb = k.split(',').map(Number);
    if (COOL.includes(biome) && isWarm(rgb)) {
      problems.push(`${biome}: ${n} lamp(s) still burning warm rgb(${k}) — the city has fallen back to sodium`);
    }
    if (WARM.includes(biome) && !isWarm(rgb)) {
      problems.push(`${biome}: ${n} lamp(s) burning cool rgb(${k}) — amber is reserved for industry and the east, and this takes it away`);
    }
  }
  // ⚠ AND THE RESERVED HALF IS BIT-IDENTICAL, NOT MERELY WARM. "Still warm" passes a lamp somebody
  // has retuned; the claim being made is that nothing outside the city changed at all.
  if (WARM.includes(biome)) {
    for (const k of tones.keys()) {
      if (!SODIUM.includes(k)) problems.push(`${biome}: a lamp is rgb(${k}), which is neither of the two sodiums that shipped (${SODIUM.map((s) => `rgb(${s})`).join(' / ')}) — the untouched half moved`);
    }
  }
}

// ── AND THE FAILING TUBE IS A MINORITY, WHICH IS THE OTHER WAY IT GOES WRONG QUIETLY ────────────
// About one core lamp in nine runs magenta — a real end-of-life mercury shift, and the city's own
// punctuation colour. A rate that drifts up turns a street into a light show; one that drifts to
// zero silently deletes the only thing making the run of blue-white worth looking at.
//
// ⚠ AND THE RATE IS COUNTED OVER THE MAP, NOT OVER THE FRAME. Seventeen lamps happen to be in this
// window and four of them are pink — 24%, against a true 12% — so a share taken off one frame is a
// sample, and a gate written against it would be measuring which street the scene happens to be on.
// Presence is what the frame can answer; the rate is arithmetic over the seed and needs no camera.
const core = seen.get('citycore');
if (core) {
  const isPink = ([r, g, b]) => r > g && b > g;
  const warmish = [...core.tones].filter(([k]) => { const [r, , b] = k.split(',').map(Number); return r > b; });
  const pink = [...core.tones].filter(([k]) => isPink(k.split(',').map(Number)));
  if (!pink.length) problems.push('no lamp in the core took the failing tube — the seeded minority has gone to zero and the street is one flat colour');
  if (warmish.length && !pink.length) problems.push('a core lamp is warm and is not the magenta failing tube — an unintended sodium has crept back in');
}
{
  // The same seed and the same test the renderer uses, over a district's worth of tiles.
  const frac = (n) => { const x = Math.sin((n + 1) * 12.9898) * 43758.5453; return x - Math.floor(x); };
  let pink = 0, all = 0;
  for (let wx = 60; wx < 160; wx++) for (let wy = 60; wy < 160; wy++) { all++; if (frac((wx * 73 + wy * 149) * 0.0173 + 0.31) < 0.11) pink++; }
  const share = pink / all;
  if (share < 0.05) problems.push(`only ${(100 * share).toFixed(1)}% of core lamps take the failing tube — below this it reads as a bug rather than as a city`);
  if (share > 0.18) problems.push(`${(100 * share).toFixed(1)}% of core lamps take the failing tube — that is a light show, not a street`);
  if (REPORT) console.log(`  failing tube over 10,000 tiles: ${(100 * share).toFixed(1)}%`);
}

// ⚠ AND THE SAME TILE MUST BE THE SAME LAMP TWICE. The tone is seeded on the world tile precisely so
// a lamp does not change colour as the map window recentres; a rolled one would twinkle between
// blue and pink as you drive, which is the one thing a street light must not do.
const a = lampsFor('citycore').map((s) => (s.rgb || []).join(',')).join('|');
const b = lampsFor('citycore').map((s) => (s.rgb || []).join(',')).join('|');
if (a !== b) problems.push('the same street lit two different ways on two passes — the tone is being rolled rather than seeded');

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
  console.error(`\n✗ lamptone — ${problems.length} problem(s):`);
  for (const p of problems) console.error('  · ' + p);
  console.error('\n  A lamp\'s colour is the puddle\'s colour — see LAMP_TONE in windshield.js.');
  process.exit(1);
}
console.log(`✓ lamptone: ${COOL.length} city biomes burn mercury with a seeded magenta minority, ${WARM.length} keep sodium bit-for-bit, and a tile lights the same way twice.`);
