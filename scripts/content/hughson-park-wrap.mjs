// ONE-SHOT: the West and East Gardens, so the Coliseum's grounds wrap round all four sides, with a
// bronze of Sir Charles on the west side facing the park.
//
//   node scripts/content/hughson-park-wrap.mjs [--write]
//
//         889 890 891 ... 895 896 897 898
//  y 913   r   gv  F   F  ...  (North Plaza)  r
//  y 914   r   fb  [the Coliseum]  pa  r
//  y 915   r   pa  [           ]   fb  r
//  y 916   r   ST  [           ]   pa  r     ST Sir Charles, facing the middle of the park
//  y 917   r   pa  [           ]   be  gv
//  y 918   r   fb  [           ]   fb  po
//  y 919   r   gv  (the south gardens) pa  gv
//  y 920   r   be  (           )   pa  be
//
// ⚠ NOTHING IS DELETED. Nine sealed towers (6, 8, 10, 14 and 16 Yarrow Lane; 21, 23, 25 and 27
// Hughson Way) go to the holding map on row 29, a cell apart, and nine new tiles take their plots.
// The road tiles (Hughson Way and Teasel Walk) keep their ids and turn to park. None of the towers
// has rooms or people. Walls and exits as in hughson-north-gardens.mjs. It refuses to run twice.
// Afterwards: content:import, snapshot-flight-world.mjs, shapes:bake, wildlands:bake, lite:bake.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CONTENT_DIR, canonicalJson } from './lib.mjs';
import { CARDINAL, projectEdges } from './derive.mjs';

const WRITE = process.argv.includes('--write');
const WORLD = 'map_world', HOLD = 'map_set_aside';
const CENTRE = { x: 893, y: 916 };   // the middle of the field; the statue faces it
const dirOf = (t) => path.join(CONTENT_DIR, t);

const tables = {}, raw = new Map();
for (const t of ['zones', 'connections', 'power_zones', 'furniture']) {
  tables[t] = new Map(fs.readdirSync(dirOf(t)).filter((f) => f.endsWith('.json')).map((f) => {
    const s = fs.readFileSync(path.join(dirOf(t), f), 'utf8');
    raw.set(`${t}/${f.slice(0, -5)}`, s);
    return [f.slice(0, -5), JSON.parse(s)];
  }));
}
const dirty = new Set();
const touch = (t, file) => dirty.add(`${t}/${file}`);
const zones = [...tables.zones.values()];
const byId = tables.zones;
const onWorld = (z) => z && z.map_id === WORLD && (z.grid_z ?? 0) === 0 && z.grid_x != null;
const cell = new Map();
const reindex = () => { cell.clear(); for (const z of zones) if (onWorld(z)) cell.set(`${z.grid_x},${z.grid_y}`, z); };
reindex();
const at = (x, y) => cell.get(`${x},${y}`);
const dirtyZone = (z) => touch('zones', z.id);

if (at(890, 916)?.name !== '10 Yarrow Lane') { console.log('890,916 is no longer 10 Yarrow Lane; nothing to do.'); process.exit(0); }

// [x, y, dressing, name, description]
const W = 'West Gardens', E = 'East Gardens';
const PLAN = [
  [891, 913, 'forecourt', 'North Plaza', "The west end of North Plaza, granite flags along the Coliseum's north wall. The West Gardens go off south down the side of the park."],
  [892, 913, 'forecourt', 'North Plaza', "North Plaza under the Coliseum's north wall, with a bronze lamp standard every few steps. Hughson Way comes down to the paving from the north and stops."],
  [890, 913, 'grove', W, "The north-west corner of the Coliseum's grounds, a stand of plane trees with benches under them. Yarrow Lane is on the west side."],
  [890, 914, 'flowerbeds', W, "The West Gardens, beds of red and gold along the Coliseum's west wall. A groundskeeper's barrow is parked on the gravel."],
  [890, 915, 'path', W, 'A gravel walk through the West Gardens where Hughson Way used to run. Yarrow Lane is a few steps west.'],
  [890, 916, 'statue', W, "The West Gardens, round a bronze of Sir Charles B. Hughson on a granite plinth. He faces the Coliseum with one hand raised and his hat in the other. His shoes are rubbed gold at the toes."],
  [890, 917, 'path', W, "A gravel walk through the West Gardens, between the Coliseum's west wall and Yarrow Lane."],
  [890, 918, 'flowerbeds', W, "The West Gardens, beds of red and gold in clipped box edging. The Coliseum's corner tower stands over the east side."],
  [890, 919, 'grove', W, 'The south-west corner of the gardens, plane trees and a drinking fountain. Grandstand Plaza starts on the east side.'],
  [890, 920, 'benches', W, 'Benches under a lamp at the south end of the West Gardens. Sorrel Way is just south.'],
  [896, 914, 'path', E, "A gravel walk down the east side of the Coliseum, past GATE C's bronze doors in the west wall. North Plaza is just north."],
  [896, 915, 'flowerbeds', E, "The East Gardens, beds of red and gold along the Coliseum's east wall. Hughson Way is across the kerb on the east side."],
  [896, 916, 'path', E, "A gravel walk through the East Gardens. Kerbstone Row goes off east from the kerb."],
  [896, 917, 'benches', E, "Benches in the East Gardens, facing the Coliseum's east wall. On game nights you can hear the crowd through it."],
  [896, 918, 'flowerbeds', E, "The East Gardens, beds of red and gold under the Coliseum's south-east tower."],
  [896, 919, 'path', E, 'A gravel walk where Hughson Way met the plaza. Grandstand Plaza is on the west side.'],
  [896, 920, 'path', E, 'The south end of the East Gardens, coming out on Sorrel Way beside Hughson Gardens.'],
  [897, 917, 'grove', E, "A stand of plane trees on the East Gardens' outer edge. Kerbstone Row's towers stand over the east side."],
  [897, 918, 'pond', E, 'An ornamental pond in the East Gardens with lilies on it and a few carp. Somebody has thrown a programme in.'],
  [897, 919, 'grove', E, 'Plane trees in the East Gardens, with Windrow Corner across the way on the east side.'],
  [897, 920, 'benches', E, 'Benches at the south-east corner of the gardens, facing Sorrel Way.'],
];
const EVENTS = [
  'A groundskeeper picks ticket stubs out of a flowerbed one at a time.',
  'Somebody eats a hot dog on a bench and watches the Coliseum wall.',
  'A pigeon lands on the nearest lamp and looks at you.',
];
const TEMPLATE = byId.get('zone_northgardens_1');
if (!TEMPLATE) throw new Error('zone_northgardens_1 missing; run hughson-north-gardens.mjs first');
const moved = new Set(), dropped = [];
let hold = 0;
for (const [x, y, feature, name, desc] of PLAN) {
  let z = at(x, y);
  if (!z) throw new Error(`${x},${y} is empty`);
  if (z.flags?.building_type) {
    if (z.flags.facade) throw new Error(`${x},${y} ${z.name} is a facade; not planned for`);
    const hx = 1 + 2 * hold++, hy = 29;
    const taken = zones.find((o) => o.map_id === HOLD && o.grid_x === hx && o.grid_y === hy);
    if (taken) throw new Error(`holding cell ${hx},${hy} holds ${taken.id}`);
    z.flags.set_aside = true; z.flags.set_aside_from = `${x},${y}`;
    z.map_id = HOLD; z.grid_x = hx; z.grid_y = hy;
    dirtyZone(z); moved.add(z.id);
    const id = `zone_hughsonpark_${x}_${y}`;
    if (byId.has(id)) throw new Error(`${id} exists`);
    const g = JSON.parse(JSON.stringify(TEMPLATE));
    g.id = id; g.exits = {};
    zones.push(g); byId.set(id, g);
    const pw = JSON.parse(JSON.stringify(tables.power_zones.get(TEMPLATE.id)));
    pw.id = id; tables.power_zones.set(id, pw); touch('power_zones', id);
    z = g;
  } else if (z.flags?.terrain !== 'road') throw new Error(`${x},${y} ${z.name} should be a road or a tower`);
  z.map_id = WORLD; z.grid_x = x; z.grid_y = y; z.grid_z = 0;
  delete z.flags.scavenging_table_id;
  z.flags.terrain = 'park';
  z.flags.park_feature = feature;
  z.flags.street_life = true;
  if (feature === 'forecourt') z.flags.park_focus = { x: 894.5, y: 913.5 };
  else if (feature === 'statue') z.flags.park_focus = { ...CENTRE };
  else delete z.flags.park_focus;
  z.name = name; z.description = desc;
  z.ambient_events = EVENTS.slice();
  z.ambient_theme = 'urban';
  z.color = '#8fd08a';
  dirtyZone(z); moved.add(z.id);
  const row = tables.power_zones.get(z.id);
  if (row && row.name !== z.name) { row.name = z.name; touch('power_zones', z.id); }
  reindex();
}

// The statue, so `look statue` answers on its tile.
const ST = at(890, 916);
const FURN = 'furn_hughson_park_statue';
if (tables.furniture.has(FURN)) throw new Error(`${FURN} exists`);
tables.furniture.set(FURN, {
  description: "Sir Charles B. Hughson in bronze, twice life size, on a granite plinth in a ring of red and gold bedding. He faces the Coliseum with his right hand raised toward the stands and his hat in his left. The toes of his shoes are rubbed gold where people touch them for luck.",
  flags: {
    aliases: ['statue', 'bronze', 'sir charles', 'charles', 'hughson', 'plinth', 'shoes'],
    examine_detail: 'Cut into the front of the plinth: Sir Charles B. Hughson. He would not sell.',
  },
  id: FURN, name: 'the statue of Sir Charles', object_type: 'decoration', zone_id: ST.id,
});
touch('furniture', FURN);

// ── Walls ───────────────────────────────────────────────────────────────────
const sealed = (z) => !!z?.flags?.building_type && !z.flags.facade;
const dirBetween = (a, b) => {
  if (!onWorld(a) || !onWorld(b)) return null;
  for (const [d, [dx, dy]] of Object.entries(CARDINAL)) if (a.grid_x + dx === b.grid_x && a.grid_y + dy === b.grid_y) return d;
  return null;
};
for (const [id, c] of [...tables.connections]) {
  if (!c.blocked || !(moved.has(c.a) || moved.has(c.b))) continue;
  const a = byId.get(c.a), b = byId.get(c.b);
  if (dirBetween(a, b) === c.dir && (sealed(a) || sealed(b))) continue;
  dropped.push(id);
  tables.connections.delete(id);
}
const pair = (a, b) => [a, b].sort().join('~');
const spoken = new Set([...tables.connections.values()].map((c) => pair(c.a, c.b)));
const slug = (id) => String(id).replace(/^zone_/, '').replace(/[^a-z0-9]+/gi, '_').slice(0, 34);
const suffix = (a, dir, b) => createHash('sha1').update(`${a}|${dir}|${b}`).digest().readUInt32BE(0).toString(36).padStart(4, '0').slice(-4);
const minted = [];
for (const e of projectEdges(zones, [...tables.connections.values()]).edges) {
  if (e.kind !== 'grid' || !(moved.has(e.from_zone) || moved.has(e.to_zone))) continue;
  if (!onWorld(byId.get(e.from_zone)) || !onWorld(byId.get(e.to_zone))) continue;
  if (!sealed(byId.get(e.from_zone)) && !sealed(byId.get(e.to_zone))) continue;
  const key = pair(e.from_zone, e.to_zone);
  if (spoken.has(key)) continue;
  spoken.add(key);
  const id = `conn_${slug(e.from_zone)}_${e.direction}_${suffix(e.from_zone, e.direction, e.to_zone)}`;
  if (tables.connections.has(id) || fs.existsSync(path.join(dirOf('connections'), `${id}.json`))) throw new Error(`${id} already exists`);
  tables.connections.set(id, { a: e.from_zone, b: e.to_zone, blocked: true, dir: e.direction, id, lockable: false, one_way: false });
  touch('connections', id);
  minted.push(id);
}

// ── Exits from the projected graph ──────────────────────────────────────────
const { edges } = projectEdges(zones, [...tables.connections.values()]);
const out = new Map();
for (const e of edges) {
  if (!out.has(e.from_zone)) out.set(e.from_zone, {});
  const ex = out.get(e.from_zone);
  ex[e.direction] = ex[e.direction] == null ? e.to_zone : [].concat(ex[e.direction], e.to_zone);
}
let exitsChanged = 0;
const outside = [];
for (const z of zones) {
  const nx = out.get(z.id) || {};
  if (canonicalJson(z.exits || {}) === canonicalJson(nx)) continue;
  const near = onWorld(z) && z.grid_x >= 888 && z.grid_x <= 899 && z.grid_y >= 911 && z.grid_y <= 922;
  if (!near && !moved.has(z.id)) { outside.push(z.id); continue; }
  z.exits = nx;
  dirtyZone(z);
  exitsChanged++;
}

// ── Check, then write ───────────────────────────────────────────────────────
for (const key of dirty) {
  const was = raw.get(key);
  if (was != null && canonicalJson(JSON.parse(was)) !== was) throw new Error(`${key} isn't canonical on disk`);
}
for (const [x, y] of PLAN) { const z = at(x, y); if (Object.keys(z.exits || {}).length < 2) throw new Error(`${z.id} is cut off: ${JSON.stringify(z.exits)}`); }
console.log(`${hold} towers set aside, ${PLAN.length} park tiles; walls: ${dropped.length} dropped, ${minted.length} minted; exits on ${exitsChanged} tile(s); ${dirty.size} files`);
if (outside.length) console.log(`⚠ ${outside.length} tile(s) elsewhere disagree with the projection (left alone)`);
if (!WRITE) { console.log('\n(dry run; pass --write)'); process.exit(0); }
for (const key of dirty) {
  const [t, file] = key.split('/');
  fs.writeFileSync(path.join(dirOf(t), `${file}.json`), canonicalJson(tables[t].get(file)), 'utf8');
}
for (const id of dropped) fs.rmSync(path.join(dirOf('connections'), `${id}.json`), { force: true });
console.log('✓ written');
