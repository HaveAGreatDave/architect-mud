// RAIN COLUMNS: heavy rain seen from a distance, standing under its cell.
//
//   node scripts/shapes/raincolumns.mjs
//   node scripts/shapes/raincolumns.mjs --report    # the counts per case
//
// `drawRainColumns` hangs soft grey bands from the cloud base to the ground across the heavy core of
// each rain cell, as strokes on the depth buffer. No headless harness reaches a GL draw call, so what
// is checked is what the frame hands the stroke layer (the same seam rainbow.mjs reads). Each claim
// would stay silent in a screenshot if it were wrong:
//
//   1. a heavy shower 30 tiles off draws columns; a light one, a snow one, and a heavy one while the
//      server's roll is off draw none
//   2. every band stands in the cell's heavy core (plus the wind's rake), from the ground to the
//      cloud base, never under the ground
//   3. it lays colour over the scene (not additive light) with a soft edge, so it reads as rain and
//      not as a plank
//   4. nothing within the near fade of the eye: standing in the shower, the canopy's curtain is the
//      rain, not a column in your face
//   5. a cell past the range draws nothing, and `rainColumns` 0 draws nothing, while the same frame
//      with it on does (so a dry case is the gate, not a guard higher up)
import { loadWindshield, stubCanvas } from './dom-stub.mjs';

const ws = await loadWindshield();
const REPORT = process.argv.includes('--report');
stubCanvas('__cols', 640, 360);

const N = 41, CX = 500, CY = 500;
const map = Array.from({ length: N }, () => Array.from({ length: N }, () => ({ kind: 'land', biome: 'grassland', flr: 0 })));
const field = (cells, extra = {}) => ({
  tick: 30, bounds: { minX: CX - 100, maxX: CX + 100, minY: CY - 100, maxY: CY + 100 },
  wind: { dir: 90, kph: 20 }, baseCloud: 0.72, falling: true,
  cells: cells.map(([x, y, r, intensity = 0.95, type = 'precip', precip = 'rain']) => ({ x, y, r, vx: 0, vy: 0, type, intensity, precip })),
  ...extra,
});

const clock = globalThis.performance;
globalThis.performance = { ...clock, now: () => 1e6 };
const was = { gl: ws.RENDER_TUNE.gl, floor: ws.RENDER_TUNE.glFloor, cols: ws.RENDER_TUNE.rainColumns, pixel: ws.RENDER_TUNE.pixel, geese: ws.RENDER_TUNE.geese };
ws.RENDER_TUNE.geese = 0;
ws.RENDER_TUNE.pixel = 16;   // the floor isn't under test, and at 1 its per-texel raster is the cost

function collect(view) {
  let seen = { eye: [0, 0, 0], cols: [] };
  ws.RENDER_TUNE.gl = 1; ws.RENDER_TUNE.glFloor = 1;
  ws.installGLWorld((cells, cam, o) => {
    seen = { eye: [cam.ex || 0, cam.ey || 0, cam.EH || 0],
             cols: (o.strokes || []).filter((s) => s.tag === 'raincolumn').map((s) => ({ a: s.a.slice(), b: s.b.slice(), add: !!s.add, feather: s.feather, alpha: s.alpha })) };
    return null;
  });
  // One paint per collection: a hook that answers null is the no-WebGL2 path and puts gl back to 0.
  ws.paintWindshield('__cols', view);
  ws.installGLWorld(null);
  return seen;
}

// A cab on the ground looking east (heading 90) toward whatever shower is put there.
const view = (wxField, at = [CX, CY], heading = 90) => ({
  cls: 'truck', phase: 'cruise', worldBlend: 1, height: 0, eyeH: 0.12, speed: 0.2,
  hour: 13, weather: 'rain', map, heading,
  mapCenter: { x: at[0], y: at[1] }, mapOffset: { x: 0, y: 0 },
  wxField, acX: at[0], acY: at[1],
});

const problems = [], rows = [];
const run = (tag, v) => { const s = collect(v); rows.push({ tag, n: s.cols.length }); return s; };

// ── 1. Heavy draws; light, snow and not-falling don't ──────────────────────
const HEAVY = [CX + 30, CY, 24];
const heavy = run('heavy shower 30 tiles east', view(field([HEAVY])));
if (!heavy.cols.length) problems.push('a heavy shower 30 tiles off drew no columns');
const light = run('light shower 30 tiles east', view(field([[CX + 30, CY, 24, 0.5]])));
if (light.cols.length) problems.push(`a light shower (intensity 0.5) drew ${light.cols.length} column strokes`);
const snow = run('heavy snow 30 tiles east', view(field([[CX + 30, CY, 24, 0.95, 'precip', 'snow']])));
if (snow.cols.length) problems.push(`a snow cell drew ${snow.cols.length} rain-column strokes`);
const idle = run('heavy shower, roll off', view(field([HEAVY], { falling: false })));
if (idle.cols.length) problems.push(`with the server's roll off, a heavy cell drew ${idle.cols.length} column strokes`);

// ── 2 and 3. Where the bands stand, and how they blend ─────────────────────
// Frame coordinates are offsets from acX/acY (see drawRainColumns), so the cell sits at (+30, 0).
// The core is 0.45 r and the bands sit within 0.85 of it; the rake at 20 kph is under a tile.
const coreR = HEAVY[2] * 0.45 * 0.85 + 1.2;
let top = 0;
for (const s of heavy.cols) {
  for (const P of [s.a, s.b]) {
    if (P[2] < -1e-6) problems.push(`a column point is under the ground: z=${P[2]}`);
    if (Math.hypot(P[0] - 30, P[1]) > coreR) { problems.push(`a column band stands ${Math.hypot(P[0] - 30, P[1]).toFixed(1)} tiles from the cell centre, outside its core (${coreR.toFixed(1)})`); break; }
    top = Math.max(top, P[2]);
  }
  if (s.add) problems.push('a column stroke is additive: rain is laid over the scene, not added as light');
  if (!(s.feather > 0 && s.feather < 0.99)) problems.push(`a column stroke has feather ${s.feather}: it would draw as a hard-edged plank (or the neon glow profile)`);
}
if (heavy.cols.length && !(heavy.cols.some((s) => s.a[2] === 0 || s.b[2] === 0))) problems.push('no column reaches the ground');
if (heavy.cols.length && !(top > 0.2)) problems.push(`the columns top out at z=${top.toFixed(3)}, nowhere near a cloud base`);

// ── 4. Standing in the shower ──────────────────────────────────────────────
const inside = run('standing at the centre of a heavy shower', view(field([[CX, CY, 24]])));
for (const s of inside.cols) {
  const d = Math.min(Math.hypot(s.a[0] - inside.eye[0], s.a[1] - inside.eye[1]), Math.hypot(s.b[0] - inside.eye[0], s.b[1] - inside.eye[1]));
  if (d < 3) { problems.push(`a column band stands ${d.toFixed(1)} tiles from the eye, inside the near fade`); break; }
}

// ── 5. Range, and the mutation control ─────────────────────────────────────
const far = run('heavy shower 110 tiles east', view(field([[CX + 110, CY, 24]])));
if (far.cols.length) problems.push(`a shower 110 tiles off drew ${far.cols.length} column strokes, past the range`);
ws.RENDER_TUNE.rainColumns = 0;
const off = run('heavy shower 30 tiles east, rainColumns 0', view(field([HEAVY])));
ws.RENDER_TUNE.rainColumns = was.cols;
if (off.cols.length) problems.push(`rainColumns 0 still drew ${off.cols.length} column strokes`);

Object.assign(ws.RENDER_TUNE, { gl: was.gl, glFloor: was.floor, rainColumns: was.cols, pixel: was.pixel, geese: was.geese });
globalThis.performance = clock;

if (REPORT) {
  console.log('\n  column strokes, by case:');
  for (const r of rows) console.log(`    ${String(r.n).padStart(5)}   ${r.tag}`);
}
if (problems.length) {
  console.error(`\n✗ raincolumns — ${problems.length} problem(s):`);
  for (const p of [...new Set(problems)].slice(0, 20)) console.error('  ' + p);
  process.exit(1);
}
console.log(`✓ raincolumns: a heavy shower 30 tiles off stands ${heavy.cols.length} soft column strokes from the ground to the base in its core; `
  + 'light, snow, roll-off, out-of-range and switched-off showers draw none, and none stands within the near fade.');
