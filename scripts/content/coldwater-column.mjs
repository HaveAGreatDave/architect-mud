// ONE-SHOT: a new column of tiles through Coldwater at x 914, and everything from the Solenne east moved one tile
// east, so the Solenne Residences can stand on four tiles (2 by 2) with Kestrel Court and Marrow House still beside it.
// The multi-tile building system and the Solenne's own model come after this (docs/proposals/multi-tile-buildings.md).
//
//   node scripts/content/coldwater-column.mjs            dry run: report, write nothing
//   node scripts/content/coldwater-column.mjs --write    write
//
// The cut is between x 913 and 914 (David chose it over 914|915, which split Golden Goose Gardens). It runs the
// whole height of the region, y 896 to 947, on every layer:
//   - every map_world tile in that band with x 914 to 955 moves to x + 1, and keeps its id, so nothing that names a
//     tile needs an edit. The region grows a column on its east rim (x 956).
//   - a new tile goes in at x 914 on every row, a copy of its west neighbour at 913 (water, the Strand, grass, Marrow
//     Street, Foundry Way, the waste past the Curtain), with these exceptions:
//       914,907 and 914,908  grass, the Solenne's ground until the multi-tile Solenne takes it. Not the Solenne's name:
//                            a model bound by name would draw a spire on each tile;
//       914,910 and 914,911  Media Lot car park inside the lot's wall, walled from Marrow Street and Foundry Way;
//       914,913              waste ground between Board Stiff and The Acid Test, like 913,914 behind them;
//       914,909 and 914,913 on layer -1  the sewer line, continued under the new column.
//   - the two walls on Golden Goose Gardens' west side move with it (they're re-pointed at the new tiles beside it);
//     a wall down the column at 913 (the Curtain's south face) is copied onto the new tiles.
//   - `exits` is rewritten from the projected graph along the seam (x 912 to 916), because content:lint holds the two
//     edge for edge; a tile further out that disagrees is reported, not touched.
//   - the street gradient's east end (regions.street_gradient.east) moves with the city.
//
// What this does NOT do, and what has to happen with it before a push (the dry run lists each):
//   - hard-coded coordinates east of the cut in code, tests and gates;
//   - the generated files: snapshot-flight-world.mjs, npm run wildlands:bake, npm run lite:bake, tools/worldmap;
//   - prod runtime rows with coordinates: aircraft.grid_x (parked aircraft) and boat_hold.x (a log);
//   - docs that give coordinates east of 913.
// It refuses to run twice: once zone_seam_914_909 exists there's nothing to do.
import fs from 'node:fs';
import path from 'node:path';
import { CONTENT_DIR, canonicalJson } from './lib.mjs';
import { projectEdges } from './derive.mjs';

const WRITE = process.argv.includes('--write');
const WORLD = 'map_world', CUT = 914, X_MAX = 955, Y0 = 896, Y1 = 947;
const dirOf = (t) => path.join(CONTENT_DIR, t);

const tables = {}, raw = new Map();
for (const t of ['zones', 'connections', 'power_zones', 'regions']) {
  tables[t] = new Map(fs.readdirSync(dirOf(t)).filter((f) => f.endsWith('.json')).map((f) => {
    const s = fs.readFileSync(path.join(dirOf(t), f), 'utf8');
    raw.set(`${t}/${f.slice(0, -5)}`, s);
    return [f.slice(0, -5), JSON.parse(s)];
  }));
}
const zones = tables.zones, conns = tables.connections;
if (zones.has('zone_seam_914_909')) { console.log('coldwater-column: already done'); process.exit(0); }
const dirty = new Set(), created = [];
const touch = (t, id) => dirty.add(`${t}/${id}`);
const inBand = (z) => z.map_id === WORLD && z.grid_x != null && z.grid_y >= Y0 && z.grid_y <= Y1;
const key = (x, y, zz) => `${x},${y},${zz ?? 0}`;
const cell = new Map();
for (const z of zones.values()) if (inBand(z)) cell.set(key(z.grid_x, z.grid_y, z.grid_z), z);
const at = (x, y, zz = 0) => cell.get(key(x, y, zz));

// ── 1. what stands either side of the cut, before anything moves ──────────────────────────────────────
const west = new Map(), east = new Map();
for (const z of cell.values()) {
  if (z.grid_x === CUT - 1) west.set(key(0, z.grid_y, z.grid_z), z);
  if (z.grid_x === CUT) east.set(key(0, z.grid_y, z.grid_z), z);
}
const need = (x, y, test, what, zz = 0) => {
  const z = at(x, y, zz);
  if (!z || !test(z)) throw new Error(`${x},${y},${zz} should be ${what}, is ${z?.id} ${z?.name}`);
  return z;
};
need(913, 908, (z) => z.name === 'Kestrel Court', 'Kestrel Court');
need(914, 908, (z) => z.name === 'Solenne Residences', 'the Solenne');
const PARKING = need(914, 911, (z) => z.flags?.media_lot?.part === 'parking', 'the Media Lot car park');
const GAP = need(913, 914, (z) => z.flags?.terrain === 'grass' && !z.flags?.is_building, 'waste ground');

// ── 2. the move ──────────────────────────────────────────────────────────────────────────────────────
let moved = 0;
for (const z of zones.values()) {
  if (!inBand(z) || z.grid_x < CUT || z.grid_x > X_MAX) continue;
  z.grid_x += 1;
  touch('zones', z.id);
  moved++;
}

// ── 3. the new column ────────────────────────────────────────────────────────────────────────────────
const copyOf = (src, id, y, zz, extra = {}) => {
  const { id: _i, exits: _e, marker: _m, ...rest } = JSON.parse(JSON.stringify(src));
  const flags = { ...(rest.flags || {}) };
  for (const k of ['facade', 'is_building', 'building_type', 'building_name', 'entrance', 'world_exit_zone', 'floors', 'map_icon', 'set_aside', 'set_aside_from']) delete flags[k];
  return { ...rest, id, grid_x: CUT, grid_y: y, grid_z: zz, exits: {}, ...extra, flags: { ...flags, ...(extra.flags || {}) } };
};
const OVERRIDE = {
  [key(0, 907, 0)]: () => at(913, 907),
  [key(0, 908, 0)]: () => at(913, 907),
  [key(0, 910, 0)]: () => ({ ...PARKING, flags: { ...PARKING.flags, media_lot: { part: 'parking', wall: 'n' } } }),
  [key(0, 911, 0)]: () => ({ ...PARKING, flags: { ...PARKING.flags, media_lot: { part: 'parking', wall: 's' } } }),
  [key(0, 913, 0)]: () => GAP,
};
const seamId = (y, zz) => `zone_seam_914_${y}${zz ? `_l${Math.abs(zz)}` : ''}`;
const sourceOf = new Map();
for (const [k, w] of west) {
  const [, y, zz] = k.split(',').map(Number);
  // a lower layer only gets a tile where it runs on across the cut
  if (zz !== 0 && !east.has(k)) continue;
  // where the west neighbour is a building, the ground east of the cut is copied instead (the Gate Post and the
  // Motor Pool at 913,925 and 913,926 face west onto the Post Lane, with the waste behind them)
  const e = east.get(k);
  const src = OVERRIDE[k] ? OVERRIDE[k]() : w.flags?.is_building && e && !e.flags?.is_building ? e : w;
  if (zz === 0 && !OVERRIDE[k] && src.flags?.is_building) throw new Error(`913,${y} and 914,${y} are both buildings (${w.name}, ${e?.name}); give the row an override`);
  const id = seamId(y, zz);
  const z = copyOf(src, id, y, zz);
  zones.set(id, z);
  cell.set(key(CUT, y, zz), z);
  touch('zones', id);
  created.push(id);
  sourceOf.set(id, src.id);
  const power = tables.power_zones.get(src.id);
  if (power) {
    const row = JSON.parse(JSON.stringify(power).split(`"${src.id}"`).join(`"${id}"`));
    tables.power_zones.set(id, row);
    touch('power_zones', id);
  }
}

// ── 4. walls ─────────────────────────────────────────────────────────────────────────────────────────
const minted = [], repointed = [];
const mint = (a, dir, b, why) => {
  const id = `conn_seam_914_${a.grid_y}_${dir}`;
  if (conns.has(id)) throw new Error(`${id} already exists`);
  conns.set(id, { a: a.id, b: b.id, blocked: true, dir, id, lockable: false, one_way: false });
  touch('connections', id);
  minted.push(`${id} (${why})`);
};
// Golden Goose Gardens' west wall moves with it
for (const id of ['conn_district_913_916_east_ek6e', 'conn_district_913_917_east_h91x']) {
  const c = conns.get(id), y = Number(id.split('_')[3]);
  if (!c || !c.blocked || c.dir !== 'east') throw new Error(`${id} isn't the barn's west wall`);
  c.a = seamId(y, 0);
  touch('connections', id);
  repointed.push(id);
}
// the lot's wall, round the two new car park tiles
mint(at(CUT, 909), 'south', at(CUT, 910), "the Media Lot's wall on Marrow Street");
mint(at(CUT, 912), 'north', at(CUT, 911), "the Media Lot's wall on Foundry Way");
// a wall down column 913 between two of its tiles is copied onto the new tiles beside them
for (const c of [...conns.values()]) {
  const a = zones.get(c.a), b = zones.get(c.b);
  if (!c.blocked || !a || !b || !inBand(a) || !inBand(b) || a.grid_x !== CUT - 1 || b.grid_x !== CUT - 1) continue;
  if (!['north', 'south'].includes(c.dir)) continue;
  const na = at(CUT, a.grid_y, a.grid_z), nb = at(CUT, b.grid_y, b.grid_z);
  if (!na || !nb || sourceOf.get(na.id) !== a.id || sourceOf.get(nb.id) !== b.id) continue;
  mint(na, c.dir, nb, `copy of ${c.id}`);
}

// ── 5. the region's street gradient ─────────────────────────────────────────────────────────────────
const region = tables.regions.get('region_coldwater');
if (region?.street_gradient?.east >= CUT) { region.street_gradient = { ...region.street_gradient, east: region.street_gradient.east + 1 }; touch('regions', 'region_coldwater'); }

// ── 6. exits from the projected graph, along the seam ──────────────────────────────────────────────
const all = [...zones.values()];
const { edges } = projectEdges(all, [...conns.values()]);
const out = new Map();
for (const e of edges) {
  if (!out.has(e.from_zone)) out.set(e.from_zone, {});
  const ex = out.get(e.from_zone);
  ex[e.direction] = ex[e.direction] == null ? e.to_zone : [].concat(ex[e.direction], e.to_zone);
}
let exitsChanged = 0;
const outside = [];
for (const z of all) {
  const nx = out.get(z.id) || {};
  if (canonicalJson(z.exits || {}) === canonicalJson(nx)) continue;
  const near = inBand(z) && z.grid_x >= CUT - 2 && z.grid_x <= CUT + 2;
  if (!near) { outside.push(z.id); continue; }
  z.exits = nx;
  touch('zones', z.id);
  exitsChanged++;
}

// ── 7. report ────────────────────────────────────────────────────────────────────────────────────────
// a file this rewrites that isn't canonical on disk gets reformatted too, which is churn in the diff: listed, so it
// can be checked for somebody's hand edit first
const loose = [...dirty].filter((key) => { const was = raw.get(key); return was != null && canonicalJson(JSON.parse(was)) !== was; });
if (loose.length) console.log(`⚠ ${loose.length} file(s) this rewrites aren't canonical on disk: ${loose.slice(0, 10).join(' ')}${loose.length > 10 ? ' …' : ''}`);
console.log(`coldwater-column: ${moved} tiles moved east, ${created.length} new tiles at x ${CUT}, ${repointed.length} walls re-pointed, ${minted.length} minted, exits rewritten on ${exitsChanged} tile(s), ${dirty.size} files`);
for (const id of created) { const z = zones.get(id); console.log(`  new ${id.padEnd(26)} ${String(z.grid_z).padStart(2)}  ${z.name}  (from ${sourceOf.get(id)})`); }
for (const m of minted) console.log(`  wall ${m}`);
if (outside.length) console.log(`⚠ ${outside.length} tile(s) away from the seam disagree with the projection (left alone): ${outside.slice(0, 12).join(' ')}`);
if (!WRITE) { console.log('\n(dry run; pass --write)'); process.exit(0); }
for (const key of dirty) {
  const [t, file] = key.split('/');
  fs.writeFileSync(path.join(dirOf(t), `${file}.json`), canonicalJson(tables[t].get(file)), 'utf8');
}
console.log('✓ written; now update the coordinates in code, then run content:import, snapshot-flight-world.mjs, wildlands:bake and lite:bake');
