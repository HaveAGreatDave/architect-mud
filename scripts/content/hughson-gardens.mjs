// ONE-SHOT: Hughson Gardens and Grandstand Plaza, in front of the Coliseum's main gate
// (docs/proposals/hughson-gardens.md).
//
//   node scripts/content/hughson-gardens.mjs [--write]
//
//         890 891 892 893 894 895 896 897
//  y 918   E   P   P   P  HC   P   R   T        P the park, HC its main gate
//  y 919   T   F   F   F   F   F   R   T        F Grandstand Plaza (was Hughson Way)
//  y 920   T   g1  g2  g3  w   g4  R   T        w Grandstand Walk, paved too
//  y 921  ===== Sorrel Way ==============        g Hughson Gardens (were 19 Hughson Way, 3, 5 and 7 Sorrel Way)
//
// g1 the pergola, g2 the parterre, g3 and g4 the two fountains either side of the walk.
//
// ⚠ NOTHING IS DELETED. The four buildings on y 920 go to the holding map (row 23), and four Hughson
// Green tiles that have waited there since hughson-estate.mjs come back to take their plots, so a move
// is a swap and every id stays. 3, 5 and 7 Sorrel Way keep their rooms; their street links go and
// `world_exit_zone` points at the facade itself, as every set-aside facade's does. Nadia Ferreira,
// who keeps 5 Sorrel Way, takes `flags.set_aside`. 19 Hughson Way is a sealed tower with no rooms.
//
// The plaza and the walk keep their ids and become `park` terrain with the `forecourt` dressing; the
// gardens take `fountain`, `parterre` and `pergola` (client/game/js/panels/glass/park-formal.js). All
// ten tiles share one `park_focus`, the main gate's threshold, which is what the forecourt's sunburst
// and the parterre's fans are laid round.
//
// Walls follow their tiles as in coliseum-north.mjs, and `exits` is rewritten from the projected graph.
// Each prose edit names the text it replaces. It refuses to run twice: once 892,920 isn't 3 Sorrel
// Way there's nothing to do. Afterwards: content:import, snapshot-flight-world.mjs, shapes:bake,
// wildlands:bake, and on prod `scripts\oneshots.bat prod` for anyone standing in a set-aside room.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CONTENT_DIR, canonicalJson } from './lib.mjs';
import { CARDINAL, projectEdges } from './derive.mjs';

const WRITE = process.argv.includes('--write');
const WORLD = 'map_world', HOLD = 'map_set_aside';
const FOCUS = { x: 894, y: 918.5 };   // the main gate's threshold, the south face of 894,918
const dirOf = (t) => path.join(CONTENT_DIR, t);

const tables = {}, raw = new Map();
for (const t of ['zones', 'connections', 'power_zones', 'npcs']) {
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

// ── 1. The tiles, found by where they stand ─────────────────────────────────
if (at(892, 920)?.name !== '3 Sorrel Way') { console.log('892,920 is no longer 3 Sorrel Way; nothing to do.'); process.exit(0); }
const need = (x, y, test, what) => {
  const z = at(x, y);
  if (!z || !test(z)) throw new Error(`${x},${y} should be ${what}, is ${z?.id} ${z?.name}`);
  return z;
};
const isRoad = (z) => z.flags?.terrain === 'road';
const HC = need(894, 918, (z) => z.flags?.building_type === 'ballpark' && z.flags.facade, 'the main gate');
const ROW = [891, 892, 893, 894, 895].map((x) => need(x, 919, (z) => isRoad(z) && z.name === 'Hughson Way', 'Hughson Way'));
const WALK = need(894, 920, (z) => isRoad(z) && z.name === 'Grandstand Walk', 'Grandstand Walk');
const TOWER = need(891, 920, (z) => z.name === '19 Hughson Way' && z.flags?.is_building && !z.flags.facade, '19 Hughson Way');
const FAC = [[892, '3 Sorrel Way'], [893, '5 Sorrel Way'], [895, '7 Sorrel Way']]
  .map(([x, name]) => need(x, 920, (z) => z.name === name && z.flags?.facade, name));

// The four green tiles on the holding map, the ones with no neighbours there, and where each goes.
// [green, plot x, its dressing, the building it swaps with, that building's holding cell]
const green = (id) => {
  const z = byId.get(id);
  if (!z || z.map_id !== HOLD || z.name !== 'Hughson Green' || !z.flags?.set_aside) throw new Error(`${id} isn't a set-aside Hughson Green tile`);
  return z;
};
const SWAPS = [
  [green('zone_ballpark_893_912'), 891, 'pergola', TOWER, [1, 23]],
  [green('zone_ballpark_893_913'), 892, 'parterre', FAC[0], [3, 23]],
  [green('zone_ballpark_896_911'), 893, 'fountain', FAC[1], [5, 23]],
  [green('zone_ballpark_896_913'), 895, 'fountain', FAC[2], [7, 23]],
];
for (const [, , , , [hx, hy]] of SWAPS) {
  const taken = zones.find((z) => z.map_id === HOLD && z.grid_x === hx && z.grid_y === hy);
  if (taken) throw new Error(`holding cell ${hx},${hy} holds ${taken.id}`);
}
const moved = new Set(SWAPS.flatMap(([g, , , b]) => [g.id, b.id]));

// ── 2. The buildings go to the holding map ──────────────────────────────────
const dropped = [];
for (const [, x, , b, [hx, hy]] of SWAPS) {
  b.flags.set_aside = true;
  b.flags.set_aside_from = `${x},920`;
  b.map_id = HOLD; b.grid_x = hx; b.grid_y = hy;
  if (b.flags.facade) {
    const link = [...tables.connections.values()].find((c) => c.a === b.id && c.dir === b.flags.entrance && !c.blocked);
    if (!link || !String(b.flags.world_exit_zone).startsWith('zone_district_')) throw new Error(`${b.name}: no street link`);
    dropped.push(link.id);
    tables.connections.delete(link.id);
    b.flags.world_exit_zone = b.id;
  }
  dirtyZone(b);
}
const KEEPER = tables.npcs.get('npc_hf_ferreira');
if (KEEPER?.work_zone_id !== 'zone_hf_grounds_room') throw new Error('Nadia Ferreira no longer keeps 5 Sorrel Way');
KEEPER.flags = { ...(KEEPER.flags || {}), set_aside: true };
touch('npcs', KEEPER.id);

// ── 3. The gardens come back ────────────────────────────────────────────────
const GARDEN_PROSE = {
  pergola: 'Hughson Gardens, the west walk: a pergola of limestone piers and timber from Sorrel Way up to the plaza, with wisteria hanging through the slats. There are benches underneath and lavender along both edges.',
  parterre: "Hughson Gardens, a parterre of clipped box fanned out like the sun over the Coliseum's gate and filled with red, white and gold bedding. A gilt-tipped obelisk stands in the middle. There's a sign asking you not to sit on the hedges.",
  fountain893: 'Hughson Gardens, the west fountain: an octagonal limestone basin, two tiers and a gilt sun on top, with jets arching in from the rim. Yews in stone planters stand at the corners. On game nights the basin fills up with ticket stubs.',
  fountain895: 'Hughson Gardens, the east fountain, the twin of the one across Grandstand Walk: a limestone basin, two tiers and a gilt sun, jets arching in from the rim and yews at the corners. The benches face the water, not the Coliseum.',
};
const GARDEN_EVENTS = [
  'The fountains drop for a second, then come back up.',
  'Somebody sits on the edge of the basin and eats a hot dog over the water.',
  'A groundskeeper picks ticket stubs out of a hedge one at a time.',
];
for (const [g, x, feature] of SWAPS) {
  g.map_id = WORLD; g.grid_x = x; g.grid_y = 920;
  delete g.flags.set_aside; delete g.flags.set_aside_from;
  g.flags.terrain = 'park';
  g.flags.park_feature = feature;
  g.flags.park_focus = { ...FOCUS };
  g.name = 'Hughson Gardens';
  g.description = GARDEN_PROSE[feature] || GARDEN_PROSE[feature + x];
  g.ambient_events = GARDEN_EVENTS.slice();
  dirtyZone(g);
}
reindex();
for (const [g, x] of SWAPS) if (at(x, 920) !== g) throw new Error(`${x},920 holds two tiles`);

// ── 4. The plaza ────────────────────────────────────────────────────────────
for (const z of [...ROW, WALK]) {
  if (z !== WALK) z.name = 'Grandstand Plaza';
  z.flags.terrain = 'park';
  z.flags.park_feature = 'forecourt';
  z.flags.park_focus = { ...FOCUS };
  dirtyZone(z);
}

// ── 5. Walls ────────────────────────────────────────────────────────────────
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

// ── 6. Prose ────────────────────────────────────────────────────────────────
// [x, y, the text it had (a fragment), the text it has now]
const TILES = [
  [891, 919, 'stopped by the side of 14 Yarrow Lane', "The west end of Grandstand Plaza, stopped by the side of 14 Yarrow Lane. The Coliseum's corner tower stands over the north side, and a pergola runs off south through Hughson Gardens to Sorrel Way."],
  [892, 919, 'a glass disc stands on six legs', "Grandstand Plaza, granite flags under the Coliseum's south wall, with a bronze lamp standard every few steps and benches facing the wall. The parterre in Hughson Gardens is on the south side."],
  [893, 919, 'the back of 5 Sorrel Way', "Grandstand Plaza, with the Coliseum's limestone wall on the north side and a fountain on the south. Dark granite rings in the paving curve round toward the main gate."],
  [894, 919, "outside the Hughson Coliseum's main gate", "Grandstand Plaza outside the Hughson Coliseum's main gate, a stepped limestone frontispiece with the name in gilt over bronze doors. A bronze sun is set in the paving at the threshold. Grandstand Walk goes off south between the two fountains to Sorrel Way."],
  [895, 919, 'The tall back of 7 Sorrel Way', "The east end of Grandstand Plaza, under the Coliseum's marble fins, with a fountain on the south side. The paving stops at the kerb of Hughson Way a few steps east."],
  [894, 920, 'a paved cut between 5 and 7 Sorrel Way', "Grandstand Walk, a paved way between the two fountains of Hughson Gardens, lined with banner poles. The Coliseum's main gate is at the north end across the plaza, and Fitz's Franks is across Sorrel Way at the south end, behind a row of bollards."],
  [892, 921, 'a chrome stair goes up into a glass disc', 'Sorrel Way, new tarmac and a long view down to the gate. On the north side Hughson Gardens has a parterre of clipped hedges with an obelisk in the middle.'],
  [893, 921, '5 Sorrel Way is a glass drum', 'Sorrel Way, with the gardens along the south side. On the north side a fountain plays in Hughson Gardens. Ticket stubs collect in the gutter.'],
  [895, 921, '7 Sorrel Way comes down to the pavement', 'Sorrel Way, with a strip of garden along the south side and a fountain in Hughson Gardens on the north. When the wind is up the spray carries over the pavement.'],
  [891, 921, 'Somebody has already parked across two of the bays.', 'A wide new street with a strip of garden along the south side. On the north side a pergola walk goes up through Hughson Gardens to the Coliseum.'],
  [896, 919, 'west along the south wall to the main gate', "Hughson Way's junction, at the Coliseum's south-east corner: north along the east wall and south to Sorrel Way. To the west the road stops and Grandstand Plaza begins. A chrome slab stands on the far kerb, its windows on this side tinted dark."],
  [896, 920, 'between 7 Sorrel Way and 27 Hughson Way', 'The south end of Hughson Way, coming out on Sorrel Way between Hughson Gardens and 27 Hughson Way.'],
];
for (const [x, y, was, now] of TILES) {
  const z = at(x, y);
  if (!z || !String(z.description).includes(was)) throw new Error(`${x},${y} no longer says: ${was}`);
  z.description = now;
  dirtyZone(z);
}
const LINES = [
  [HC.id, 'description', 'frontispiece on Hughson Way between', 'frontispiece on Grandstand Plaza between'],
  ['zone_hughson_rotunda', 'flags.window.description', 'Hughson Way is outside, and Grandstand Walk runs on from it to Sorrel Way', 'Grandstand Plaza is outside, and Grandstand Walk runs on from it between the fountains to Sorrel Way'],
  ['zone_hf_deposit_counter', 'flags.window.description', 'the glass disc of 3 Sorrel Way across it', 'the fountains of Hughson Gardens across it'],
];
for (const [file, keyPath, from, to] of LINES) {
  const rec = byId.get(file);
  const keys = keyPath.split('.'), last = keys.pop();
  const obj = keys.reduce((o, k) => o?.[k], rec);
  if (typeof obj?.[last] !== 'string' || !obj[last].includes(from)) throw new Error(`${file} ${keyPath}: "${from}" not found`);
  obj[last] = obj[last].replace(from, to);
  dirtyZone(rec);
}
// A tile with a new name takes it on its power row too.
for (const z of [...ROW, ...SWAPS.map(([g]) => g)]) {
  const row = tables.power_zones.get(z.id);
  if (!row || row.name === z.name) continue;
  row.name = z.name;
  touch('power_zones', z.id);
}

// ── 7. Exits from the projected graph ───────────────────────────────────────
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
  const near = onWorld(z) && z.grid_x >= 887 && z.grid_x <= 899 && z.grid_y >= 915 && z.grid_y <= 923;
  if (!near && !moved.has(z.id)) { outside.push(z.id); continue; }
  z.exits = nx;
  dirtyZone(z);
  exitsChanged++;
}

// ── 8. Check, then write ────────────────────────────────────────────────────
for (const key of dirty) {
  const [t, file] = key.split('/');
  if (t !== 'zones') continue;
  const z = byId.get(file);
  if (!onWorld(z) || z.flags?.facade) continue;
  const words = String(z.description).trim().split(/\s+/).length;
  if (words > 60) throw new Error(`${z.id}: ${words} words`);
  if (String(z.description).includes('—')) throw new Error(`${z.id}: em dash`);
}
for (const key of dirty) {
  const was = raw.get(key);
  if (was != null && canonicalJson(JSON.parse(was)) !== was) throw new Error(`${key} isn't canonical on disk`);
}
const leaky = zones.filter((z) => onWorld(z) && sealed(z) && z.grid_y >= 915 && z.grid_y <= 923 && z.grid_x >= 887 && z.grid_x <= 899 && Object.keys(z.exits || {}).length);
if (leaky.length) throw new Error(`sealed tiles with exits: ${leaky.map((z) => z.id).join()}`);
for (const [g] of SWAPS) if (Object.keys(g.exits || {}).length < 2) throw new Error(`${g.id} is cut off: ${JSON.stringify(g.exits)}`);
console.log(`4 buildings set aside, 4 garden tiles back, 6 tiles paved; walls: ${dropped.length} dropped, ${minted.length} minted; exits rewritten on ${exitsChanged} tile(s); ${dirty.size} files`);
if (outside.length) console.log(`⚠ ${outside.length} tile(s) elsewhere disagree with the projection (left alone):`, outside.slice(0, 10));
console.log('dropped:', dropped.join(' '));
console.log('minted:', minted.join(' '));
if (!WRITE) { console.log('\n(dry run; pass --write)'); process.exit(0); }
for (const key of dirty) {
  const [t, file] = key.split('/');
  fs.writeFileSync(path.join(dirOf(t), `${file}.json`), canonicalJson(tables[t].get(file)), 'utf8');
}
for (const id of dropped) fs.rmSync(path.join(dirOf('connections'), `${id}.json`), { force: true });
console.log('✓ written; now content:import, snapshot-flight-world.mjs, shapes:bake and wildlands:bake');
