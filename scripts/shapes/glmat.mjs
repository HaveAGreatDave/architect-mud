// Does every surface in the city know what it is made of?
//
// The material response (see RENDER_TUNE.glMat) shades a wall from a table indexed by the family
// its palette key resolves to. That index rides in the vertex buffer as a float and is read back in
// the fragment shader as a subscript into a uniform array — and a subscript out of range in GLSL ES
// is UNDEFINED BEHAVIOUR, not a clamp. On this driver it reads zeros, and a zero row is gloss 0:
// `pow(x, 0.0)` is 1.0 for every x, which is a full-strength mirror highlight over the whole
// surface. So the failure mode of a mis-resolved material is not a slightly wrong wall. It is a
// building made of liquid chrome, on one machine, with nothing in any log.
//
// ⚠ AND IT IS A CLASS OF BUG NO OTHER GATE HERE CAN SEE. `gl:mesh` compares geometry and `gl:glsl`
// compares names; both pass with every building in the city pointing at family 41.
//
// It also prints the census — how much of the city each family actually covers — because a response
// system that resolves correctly and reaches four faces is a different outcome from one that
// resolves correctly and reaches the city, and only one of those is worth the frame cost.
import { loadWindshield } from './dom-stub.mjs';
import { MAX_MATERIALS } from '../../client/game/js/panels/gl/context.js';

const ws = await loadWindshield();
const { MAT_ORDER, wallMaterialTable, wallMaterialId, roofMaterialId, wallMaterialOf, wallPaletteInfo } = ws;

const problems = [];
const table = wallMaterialTable();

// ── THE TABLE ITSELF ────────────────────────────────────────────────────────
if (MAT_ORDER.length > MAX_MATERIALS) {
  problems.push(`${MAT_ORDER.length} families against a shader array of ${MAX_MATERIALS} — every family past the end reads out of range`);
}
if (table.length !== MAT_ORDER.length) {
  problems.push(`the table has ${table.length} rows for ${MAT_ORDER.length} families`);
}
for (const r of table) {
  const nums = [r.gloss, r.metal, r.fres, r.bump, r.sheen];
  if (nums.some((n) => !Number.isFinite(n))) { problems.push(`${r.name}: a non-finite column`); continue; }
  // ⚠ GLOSS BELOW 1 IS THE MIRROR TRAP ABOVE, arriving through the front door instead of through an
  // out-of-range read. The shader carries a max(1.0, …) so it cannot actually happen, and a row
  // authored that way would still be somebody meaning something they did not get.
  if (r.gloss < 1) problems.push(`${r.name}: gloss ${r.gloss} — below 1 is a mirror, not a matte`);
  if (r.metal < 0 || r.metal > 1) problems.push(`${r.name}: metal ${r.metal} is outside 0..1`);
  if (r.fres < 0 || r.fres > 1) problems.push(`${r.name}: fres ${r.fres} is outside 0..1`);
  if (r.bump < 0 || r.bump > 1) problems.push(`${r.name}: bump ${r.bump} is outside 0..1`);
  if (r.sheen < 0 || r.sheen > 1) problems.push(`${r.name}: sheen ${r.sheen} is outside 0..1`);
}

// ── EVERY PALETTE KEY, WALL AND ROOF ────────────────────────────────────────
const inRange = (id) => Number.isInteger(id) && id >= 0 && id < MAT_ORDER.length;
const palettes = wallPaletteInfo();
for (const p of palettes) {
  const id = wallMaterialId(p.key);
  if (!inRange(id)) { problems.push(`wall ${p.key}: material id ${id} is out of range`); continue; }
  // The id and the NAME must be the same answer. Two ways to ask one question is two things to
  // keep in step, and the picker in the Modelshop groups by the name while the shader reads the id.
  if (MAT_ORDER[id] !== p.material) problems.push(`wall ${p.key}: id ${id} is '${MAT_ORDER[id]}' but wallMaterialOf says '${p.material}'`);
  const rid = roofMaterialId(p.key);
  if (!inRange(rid)) problems.push(`roof ${p.key}: material id ${rid} is out of range`);
}
// ⚠ AN UNKNOWN KEY MUST LAND ON THE DEFAULT FACADE, never on -1 and never past the end. This is the
// case a new palette key hits on the day it is added and before anybody files it in a family.
for (const junk of ['', 'not_a_palette', 'ty_does_not_exist', '__weird']) {
  if (!inRange(wallMaterialId(junk))) problems.push(`unknown key '${junk}' resolves to ${wallMaterialId(junk)} — it must fall to the default facade`);
  if (!inRange(roofMaterialId(junk))) problems.push(`unknown roof key '${junk}' resolves to ${roofMaterialId(junk)}`);
}

// ── AND EVERY FACE OF EVERY BUILDING ────────────────────────────────────────
//
// The reason this sweeps the registry rather than trusting the palette list: a face carries a `pal`
// that came out of a model arm, and an arm can name a key the palette table does not hold. That is
// the path an out-of-range index would actually take.
const census = new Map();
let models = 0, faces = 0, palFaces = 0;
for (const { key, m } of ws.shapeModelRegistry()) {
  models++;
  let mesh;
  try { mesh = ws.captureModelMesh(m, { fh: 0.4, h: 1, seed: 3 }); } catch { continue; }
  for (const f of mesh) {
    faces++;
    if (!f.pal) continue;
    palFaces++;
    const id = f.kind === 'roof' ? roofMaterialId(f.pal) : wallMaterialId(f.pal);
    if (!inRange(id)) { problems.push(`${key}: face palette '${f.pal}' resolves to ${id}`); continue; }
    const name = MAT_ORDER[id];
    census.set(name, (census.get(name) || 0) + 1);
  }
}

if (problems.length) {
  console.error(`✗ glmat: ${problems.length} problem${problems.length === 1 ? '' : 's'}`);
  for (const p of problems.slice(0, 24)) console.error(`  ✗ ${p}`);
  process.exit(1);
}

const ranked = [...census.entries()].sort((a, b) => b[1] - a[1]);
const unused = MAT_ORDER.filter((n) => !census.has(n));
console.log(`✓ glmat: ${MAT_ORDER.length} families, ${palettes.length} palette keys and ${palFaces} of ${faces} faces over ${models} models all resolve in range.`);
console.log(`  · the city by material: ${ranked.slice(0, 8).map(([n, c]) => `${n} ${c}`).join(', ')}`);
// Not a failure. A family can exist for roofs the wall sweep never sees, or for a building nobody
// has placed yet — the same reason the authored-model binding report is a warning and not a gate.
if (unused.length) console.log(`  · reached by no wall face at this capture: ${unused.join(', ')}`);
