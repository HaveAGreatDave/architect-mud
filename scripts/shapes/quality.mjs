// HOW BUILT IS EACH BUILDING?
//
// The quality pass over the city's 173 models needs to be driven by a number, not by taste. Taste
// works one building at a time and cannot answer "which twenty are worst" or "did that batch help",
// which are the only two questions a pass of this size actually asks.
//
// So: four properties a finished building has, measured off the model itself, and a count of how
// many models have each. The bar is deliberately low — this is a floor, not a style guide. Nothing
// here says a building should look like anything in particular; it says a building should have a
// roof you can read from the air, something lit after dark, a ground floor that is not the same
// wall as the twelfth, and some trim on it.
//
// ⚠ IT IS A REPORT, NOT A GATE, and that is deliberate rather than unfinished. A gate on this would
// fail the day somebody adds a model and go on failing until they finished it, which is exactly the
// pressure that produces a building nobody wanted to make. `--fail-under N` exists for the day the
// pass is done and the number is worth holding; until then the number is for reading.
//
// Run: `npm run models:quality` (add `--all` to list every model, `--json` for the raw rows).
import { loadWindshield } from './dom-stub.mjs';

const ws = await loadWindshield();
const FH = 0.4, H = 1, SEED = 3;

const argv = process.argv.slice(2);
const ALL = argv.includes('--all');
const JSON_OUT = argv.includes('--json');
const failUnder = (() => {
  const i = argv.indexOf('--fail-under');
  return i >= 0 && argv[i + 1] != null ? Number(argv[i + 1]) : null;
})();

// ── THE FOUR PROPERTIES ──────────────────────────────────────────────────────
//
// Each is read off something the renderer already produces, never off a field an author would have
// to remember to set — a quality metric you can satisfy by writing `quality: 5` measures nothing.
//
//  roof     a roof face in the mesh. Ten models have no top at all, which from a cockpit is the
//           one surface you spend the whole flight looking down at.
//  lit      the adornment pass emits a light sprite, builds a gradient, or sets a blur at night.
//           ⚠ ALL THREE, and the first draft had only the last two — which measures a neon blade
//           (shadowBlur) and cannot see a glow at all, because `glowPool` blits a bitmap that was
//           built once on its own canvas and cached per colour. A building lit only by glows and
//           beacons therefore read as completely dark, and the first run of this reported 109 of
//           173 emitting nothing after dark. `shapeAdornCost` now runs with the sprite sink
//           installed and counts what lands in it.
//  ground   at least two distinct wall palettes. A shopfront under brick, a blank party wall, a
//           dark plinth: the cheapest thing that stops a building reading as one extruded colour.
//  trim     any adornment SURFACE — the panels, sills, louvres, coping and reveals that reach the
//           mesh as `flat` faces — or an authored `detail` list. Not lights: those are `lit`.
function grade(m) {
  let mesh = [];
  try { mesh = ws.captureModelMesh(m, { fh: FH, h: H, seed: SEED }); } catch { mesh = []; }
  const segs = ws.shapeForModel(m, SEED) || [];

  const roofFaces = mesh.filter((f) => f.kind === 'roof').length;
  const flatFaces = mesh.filter((f) => f.kind === 'flat').length;
  const pals = new Set(mesh.filter((f) => f.kind === 'wall' && f.pal).map((f) => f.pal));

  let lights = 0;
  try {
    const cost = ws.shapeAdornCost(m, 2, 0.9, 4);
    lights = (cost.grads || 0) + (cost.blurs || 0) + (cost.sprites || 0);
  } catch { lights = 0; }

  const detail = Array.isArray(m.detail) ? m.detail.length : 0;

  const has = {
    roof: roofFaces > 0,
    lit: lights > 0,
    ground: pals.size >= 2,
    trim: flatFaces > 0 || detail > 0,
  };
  return {
    segs: segs.length, faces: mesh.length, roofFaces, flatFaces, detail, lights,
    pals: pals.size, has, score: Object.values(has).filter(Boolean).length,
  };
}

const rows = [];
for (const { key, m } of ws.shapeModelRegistry()) rows.push({ key, ...grade(m) });

if (JSON_OUT) {
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}

const n = rows.length;
const count = (f) => rows.filter(f).length;
const pct = (k) => `${k} of ${n} (${Math.round(k / n * 100)}%)`;

console.log(`── model quality — ${n} models at fh ${FH}, h ${H} ───────────────────────────`);
console.table([
  { property: 'a roof face', has: pct(count((r) => r.has.roof)), missing: count((r) => !r.has.roof) },
  { property: 'a light at night', has: pct(count((r) => r.has.lit)), missing: count((r) => !r.has.lit) },
  { property: 'more than one wall palette', has: pct(count((r) => r.has.ground)), missing: count((r) => !r.has.ground) },
  { property: 'any trim', has: pct(count((r) => r.has.trim)), missing: count((r) => !r.has.trim) },
]);
console.log(`   ${pct(count((r) => r.score === 4))} have all four · ${pct(count((r) => r.score <= 1))} have one or none`);
console.log(`   ${pct(count((r) => r.segs <= 2))} are two mass segments or fewer — a box and a lid`);
console.log(`   mesh: ${rows.reduce((a, r) => a + r.faces, 0)} faces, of which ${rows.reduce((a, r) => a + r.flatFaces, 0)} are trim`);

// The worst first, because that is the order the pass runs in. Ties break on mass, so the barest
// building of a given score comes up before a richly-built one that happens to be unlit.
const worst = rows.slice().sort((a, b) => a.score - b.score || a.segs - b.segs || a.faces - b.faces);
const show = ALL ? worst : worst.slice(0, 25);
console.log(`\n── ${ALL ? 'every model' : 'the 25 to do first'}, worst first ──`);
console.table(show.map((r) => ({
  model: r.key,
  score: `${r.score}/4`,
  segs: r.segs,
  roof: r.has.roof ? '✓' : '—',
  lit: r.has.lit ? r.lights : '—',
  walls: r.pals,
  trim: r.has.trim ? (r.detail ? `${r.flatFaces}+${r.detail}` : r.flatFaces) : '—',
})));

if (failUnder != null) {
  const bad = rows.filter((r) => r.score < failUnder);
  if (bad.length) {
    console.error(`\n✗ quality: ${bad.length} model(s) score under ${failUnder}.`);
    process.exit(1);
  }
  console.log(`\n✓ quality: every model scores ${failUnder} or better.`);
}
