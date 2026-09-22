// THE CITY IN THE GLASS — the half of it a headless run can see.
//
// `gl/skyline.js` turns the window's cells into one texel per bearing: how high the city stands in
// that direction and what colour it is. The shader then samples it by the reflected ray's azimuth.
//
// ⚠ NO HARNESS HERE REACHES A GL DRAW CALL — every one installs a hook that answers null, which is
// the no-WebGL2 path — so the shader half is checked by `gl:glsl` (every name declared) and by the
// picture in the Modelshop. What IS checkable, and is where the bugs live, is the STRIP: it is a
// pure function of the cells and the eye, and every way it goes wrong produces a plausible
// reflection of the wrong thing.
//
// Run: `node scripts/shapes/envstrip.mjs` (add `--report` for the per-claim lines).
import { buildSkyline, packSkyline, packSlope, unpackSlope, SKY_BINS } from '../../client/game/js/panels/gl/skyline.js';

const REPORT = process.argv.includes('--report');
const fails = [];
const fail = (s) => fails.push(s);
const ok = (s) => { if (REPORT) console.log('  ✓ ' + s); };

// A cell as the world pass hands it over: where the tile stands, and the face list the mesh memo
// has already given an average colour and a top.
const cell = (gx, gy, topZ, rgb) => ({ gx, gy, faces: Object.assign([], { topZ, avgRgb: rgb }) });
const EYE = [0, 0, 0.12];
const binAt = (deg) => ((Math.round((deg / 360) * SKY_BINS) % SKY_BINS) + SKY_BINS) % SKY_BINS;

// ── 1. A BUILDING RAISES ITS OWN BEARING AND NOBODY ELSE'S ───────────────────────────────────
{
  const s = buildSkyline([cell(10, 0, 3, [200, 60, 60])], EYE);
  const east = s.slope[binAt(0)], west = s.slope[binAt(180)];
  if (!(east > 0.2)) fail(`a tower 10 tiles due east raised its own bearing to only ${east.toFixed(3)}`);
  if (!(west < 0)) fail(`a tower due east raised the WESTERN bearing to ${west.toFixed(3)} — the strip is not directional`);
  if (Math.round(s.rgb[binAt(0) * 3]) !== 200) fail('the colour at a built bearing is not the building\'s');
  ok(`due east ${east.toFixed(2)}, due west ${west.toFixed(2)}, colour carried`);
}

// ── 2. NEARER AND TALLER BOTH STAND HIGHER, AND IT IS A SLOPE RATHER THAN A HEIGHT ───────────
//
// ⚠ THE WHOLE REASON THIS CANNOT BE A HEIGHTMAP. A reflected ray has a direction and no distance,
// so the only comparable quantity is angular — and a near low shed genuinely does stand higher in
// a reflection than a far tower. Written as a height the shed would vanish behind it.
{
  const far = buildSkyline([cell(30, 0, 9, [1, 2, 3])], EYE).slope[binAt(0)];
  const near = buildSkyline([cell(4, 0, 3, [1, 2, 3])], EYE).slope[binAt(0)];
  if (!(near > far)) fail(`a shed 4 tiles off (${near.toFixed(3)}) does not stand higher than a tower 30 off (${far.toFixed(3)}) — the strip is storing height, not slope`);
  const tall = buildSkyline([cell(10, 0, 6, [1, 2, 3])], EYE).slope[binAt(0)];
  const short = buildSkyline([cell(10, 0, 3, [1, 2, 3])], EYE).slope[binAt(0)];
  if (!(tall > short * 1.5)) fail('doubling a building\'s height at one distance did not raise its slope');
  ok(`near shed ${near.toFixed(2)} > far tower ${far.toFixed(2)}; twice the height ${tall.toFixed(2)} vs ${short.toFixed(2)}`);
}

// ── 3. A TILE HAS AN ANGULAR WIDTH, AND A NEAR ONE COVERS MORE BINS THAN A FAR ONE ───────────
//
// ⚠ WITHOUT THIS THE SKYLINE IS A COMB. Writing each cell into a single bin makes a building two
// tiles away — which spans about 28° — exactly as wide as one thirty tiles away, so the reflected
// city comes out as a row of spikes with sky between them.
{
  const width = (d) => buildSkyline([cell(d, 0, 4, [1, 2, 3])], EYE).slope.filter((v) => v > 0).length;
  const near = width(2), far = width(30);
  if (!(near > far)) fail(`a tile 2 tiles off covers ${near} bins and one 30 off covers ${far} — the angular width is not being spread`);
  if (!(far >= 1)) fail('a distant tile covers no bin at all');
  if (near > SKY_BINS * 0.5) fail(`a single tile 2 tiles off covers ${near} of ${SKY_BINS} bins — more than a hemisphere`);
  ok(`angular width: ${near} bins at 2 tiles, ${far} at 30`);
}

// ── 4. THE TILE YOU ARE STANDING IN IS SKIPPED ───────────────────────────────────────────────
//
// Its bearing is meaningless and its slope is enormous, so one tile would otherwise paint half the
// strip with the one building a reflection can never contain — the one the camera is inside.
{
  const s = buildSkyline([cell(0.1, 0.1, 8, [255, 0, 255])], EYE);
  const lit = s.slope.filter((v) => v > 0).length;
  if (lit) fail(`the tile under the camera painted ${lit} bins — it must be skipped, not clamped`);
  ok('the cell under the camera contributes nothing');
}

// ── 5. AN EMPTY BEARING IS SKY, NOT A SENTINEL ───────────────────────────────────────────────
//
// ⚠ A LEFTOVER -1e3 DECODES TO A NONSENSE ANGLE and the shader paints the city into clear air.
{
  const s = buildSkyline([], EYE);
  for (let i = 0; i < SKY_BINS; i++) if (!(s.slope[i] > -2 && s.slope[i] <= 0)) { fail(`an empty window left bin ${i} at ${s.slope[i]} — not a horizon`); break; }
  ok('an empty window is horizon in every bearing');
}

// ── 6. THE PACKING ROUND-TRIPS WHERE THE SKYLINE ACTUALLY LIVES ──────────────────────────────
//
// A slope is unbounded and the texel is 8 bits. The map keeps its resolution around ±1 (45°), which
// is where a skyline is; everything steeper crowds the ends, which is sky nothing reflects toward.
{
  let worst = 0, at = 0;
  for (let s = -1.5; s <= 3.0; s += 0.01) {
    const back = unpackSlope(Math.round(packSlope(s) * 255) / 255);
    const e = Math.abs(back - s) / Math.max(0.35, Math.abs(s));
    if (e > worst) { worst = e; at = s; }
  }
  if (worst > 0.12) fail(`the slope packing loses ${(worst * 100).toFixed(1)}% at slope ${at.toFixed(2)}`);
  ok(`slope packing worst relative error ${(worst * 100).toFixed(1)}% over -1.5..3.0`);
}

// ── 7. THE BYTES ARE THE STRIP ───────────────────────────────────────────────────────────────
{
  const s = buildSkyline([cell(8, 0, 4, [120, 180, 240])], EYE);
  const b = packSkyline(s);
  if (b.length !== SKY_BINS * 4) fail(`packed ${b.length} bytes, want ${SKY_BINS * 4}`);
  const i = binAt(0);
  if (b[i * 4] !== 120 || b[i * 4 + 1] !== 180 || b[i * 4 + 2] !== 240) fail('the packed colour is not the building\'s');
  if (Math.abs(unpackSlope(b[i * 4 + 3] / 255) - s.slope[i]) > 0.06) fail('the packed slope does not decode back');
  ok('the bytes carry the colour and the slope');
}

// ── 8. THE TALLEST IN A BEARING WINS, AND BRINGS ITS OWN COLOUR ──────────────────────────────
//
// ⚠ AND THE COLOUR HAS TO FOLLOW THE WINNER. Keeping the last cell's colour beside the tallest
// cell's slope gives a silhouette of one building painted as another, which is the sort of wrong
// that looks entirely plausible in a reflection.
//
// ⚠ AND THE TALL ONE GOES FIRST IN THE LIST, WHICH IS THE WHOLE TEST. With it last, a mutant that
// keeps the tallest SLOPE and writes every cell's colour still answers correctly — the last cell
// written is the tall one — so the check passes on a build that has the bug. Mutation-tested: that
// ordering is the difference between 6 of 7 caught and 7 of 7.
{
  const s = buildSkyline([cell(9, 0, 9, [240, 200, 160]), cell(10, 0, 2, [10, 10, 10])], EYE);
  const i = binAt(0);
  if (Math.round(s.rgb[i * 3]) !== 240) fail(`the tallest building in a bearing did not bring its own colour (got ${Math.round(s.rgb[i * 3])}, want 240)`);
  if (Math.abs(s.slope[i] - 9 / 9) > 0.1) fail('the tallest building in a bearing did not set the slope');
  ok('the tallest in a bearing wins, colour and all');
}

if (fails.length) {
  console.error('\n✗ envstrip: ' + fails.length + ' failure(s)');
  for (const f of fails) console.error('   · ' + f);
  process.exit(1);
}
console.log('✓ envstrip: the skyline strip is directional, angular rather than metric, spread by the tile\'s own width, '
  + 'skips the cell under the camera, and packs back to the slope it was built from.');
