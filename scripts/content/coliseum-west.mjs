// ONE-SHOT: move the map's Coliseum two tiles west, from x 893-897 to x 891-895, on the same rows
// (docs/proposals/coliseum-five-tiles.md, "Two tiles west").
//
//   node scripts/content/coliseum-west.mjs [--write]
//
//         889 890 891 892 893 894 895 896 897 898
//  y 915  ===== Hughson Way ====================  17
//  y 916   Y   T  BG   P   P   P  G3   R   K   K
//  y 917   Y   e  G4   P   P   P   P   R   T  14
//  y 918   +   E   P   P   P   P   P   R   T   W
//  y 919   Y   T   P   P   P   P   P   R   T   g
//  y 920   Y   T   P   P   P  HC   P   R   T  KM
//  y 921  ===== Sorrel Way =====================
//  y 922   g  HA   g  S4   g  FK   g  2B   g   .
//
// T a sealed tower, Y Yarrow Lane, E and e Teasel Walk, R Hughson Way, K Kerbstone Row, W Windrow Lane.
//
// The broadcast's park stands on the whole lot with home plate at 894.86,917.86, and the map's park is
// that park scaled about home plate. With home plate at 894.61,919.61 the Halcyon towers stand on TV's
// bearings from the field. `site.set` is TV's own ground and doesn't move.
//
// ⚠ EVERY ID STAYS, and id and grid already differ here, so a tile is found by where it stands. The
// park's tiles keep their bc/br types, because everything GLASS draws is block-relative. The rooms keep
// their ids and their facades, so only each door's street link and `world_exit_zone` change.
//
// Walls that are no longer adjacent or no longer true go, the new neighbours are walled as
// hughson-towers.mjs walled its tiles, and `exits` is rewritten from the projected graph, because
// content:lint holds the two edge for edge. Each prose edit names the text it replaces, so a line that
// moved under this refuses. It refuses to run twice: once the venue's block starts at x 891 there's
// nothing to do. Afterwards: content:import, snapshot-flight-world.mjs, wildlands:bake, shapes:bake.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CONTENT_DIR, canonicalJson } from './lib.mjs';
import { CARDINAL, projectEdges } from './derive.mjs';

const WRITE = process.argv.includes('--write');
const WORLD = 'map_world';
const BC = 'bc_1783289744953';
const OLD_X0 = 893, NEW_X0 = 891, Y0 = 916, SIDE = 5;
const REGION = 'region_coldwater', DISTRICT = 'halcyon_fields';
const dirOf = (t) => path.join(CONTENT_DIR, t);

const tables = {}, raw = new Map();
for (const t of ['zones', 'connections', 'power_zones', 'npcs', 'items', 'media_broadcasts']) {
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

// ── 0. The venue ────────────────────────────────────────────────────────────
const bc = tables.media_broadcasts.get(BC);
const site = bc?.sports_pools?.venue?.site;
if (!site) throw new Error(`${BC} has no venue site`);
if (site.block?.x0 === NEW_X0) { console.log('The park already stands at x 891-895; nothing to do.'); process.exit(0); }
if (site.block?.x0 !== OLD_X0) throw new Error(`the venue's block starts at x ${site.block?.x0}`);

// ── 1. The tiles, found by where they stand ─────────────────────────────────
const need = (x, y, test, what) => {
  const z = at(x, y);
  if (!z || !test(z)) throw new Error(`${x},${y} should be ${what}, is ${z?.id} ${z?.name}`);
  return z;
};
const isRoad = (z) => z.flags?.terrain === 'road';
const isTower = (z) => z.flags?.is_building && !z.flags?.facade;
const isPark = (z) => String(z.flags?.building_type || '').startsWith('ballpark');

const moves = [];   // [zone, new x, new y]
for (let y = Y0; y < Y0 + SIDE; y++) for (let x = OLD_X0; x < OLD_X0 + SIDE; x++) moves.push([need(x, y, isPark, 'the park'), x - 2, y]);
const parkIds = new Set(moves.map(([z]) => z.id));
const WAY = [];
for (let y = Y0; y < Y0 + SIDE; y++) {
  const z = need(892, y, (t) => isRoad(t) && t.name.includes('Hughson Way'), 'Hughson Way');
  WAY.push(z);
  moves.push([z, 896, y]);
}
const TEASEL_END = need(891, 918, (t) => isRoad(t) && t.name === 'Teasel Walk', 'Teasel Walk');
moves.push([TEASEL_END, 897, 916]);
const TOWERS = [[891, 916, '21 Hughson Way', 917], [891, 917, '23 Hughson Way', 918], [891, 919, '25 Hughson Way', 919], [891, 920, '27 Hughson Way', 920]]
  .map(([x, y, name, ny]) => { const z = need(x, y, (t) => isTower(t) && t.name === name, name); moves.push([z, 897, ny]); return z; });
const ALLEY = need(890, 917, (t) => isTower(t) && t.name === '12 Yarrow Lane', '12 Yarrow Lane');
const FITZ = need(896, 922, (t) => t.flags?.facade && t.name === "Fitz's Franks" && t.flags.entrance === 'north', "Fitz's Franks");
const TWOHB = need(894, 922, (t) => t.flags?.facade && t.name === '2 Halcyon Boulevard' && t.flags.entrance === 'north', '2 Halcyon Boulevard');
moves.push([FITZ, 894, 922], [TWOHB, 896, 922]);

const GATE = (type) => {
  const z = moves.map(([t]) => t).find((t) => t.flags?.building_type === type);
  if (!z?.flags?.facade) throw new Error(`no door of type ${type}`);
  return z;
};
const HC = GATE('ballpark'), BG = GATE('ballpark_bleachers'), G3 = GATE('ballpark_gate_c'), G4 = GATE('ballpark_gate_d');

// The streets, before anything moves.
const SORREL_GATE = need(894, 921, (t) => isRoad(t) && t.name === 'Sorrel Way', 'Sorrel Way');
const SORREL_EAST = need(896, 921, (t) => isRoad(t) && t.name === 'Sorrel Way', 'Sorrel Way');
const BLEACHER_ST = need(891, 915, (t) => isRoad(t) && t.name === 'Hughson Way', 'Hughson Way');
const moved = new Set(moves.map(([z]) => z.id));
moved.add(ALLEY.id);

// ── 2. The moves ────────────────────────────────────────────────────────────
for (const [z, x, y] of moves) { z.grid_x = x; z.grid_y = y; dirtyZone(z); }
reindex();
for (const [z, x, y] of moves) if (at(x, y) !== z) throw new Error(`${x},${y} holds two tiles`);

// 12 Yarrow Lane comes down: GATE D's door opens on this tile, and it joins Teasel Walk to Yarrow Lane.
const roadFlags = { district: DISTRICT, region_id: REGION, scavenging_table_id: 'scav_roadside_junk', street_life: true, terrain: 'road' };
ALLEY.name = 'Teasel Walk';
ALLEY.flags = { ...roadFlags };
ALLEY.ambient_theme = 'city';
ALLEY.ambient_events = [];
delete ALLEY.color; delete ALLEY.bg_color; delete ALLEY.marker;

TEASEL_END.name = 'Kerbstone Row';
WAY[0].name = 'Hughson Way + Kerbstone Row';
WAY[2].name = 'Hughson Way';
SORREL_EAST.name = 'Hughson Way + Sorrel Way';
dirtyZone(SORREL_EAST);
for (const t of TOWERS) t.flags.entrance = 'west';     // their street is on the other side now

// ── 3. Doors ────────────────────────────────────────────────────────────────
// [facade, street it opens on, the link file, the street it used to name]
const DOORS = [
  [BG, BLEACHER_ST, 'conn_hf_ballpark_893_916_north', 'zone_ballpark_893_915'],
  [G4, ALLEY, 'conn_hf_ballpark_893_917_west', WAY[1].id],
  [G3, WAY[0], 'conn_hf_ballpark_897_916_east', 'zone_district_898_916'],
  [HC, SORREL_GATE, 'conn_hf_ballpark_896_920_south', SORREL_EAST.id],
  [FITZ, SORREL_GATE, 'conn_hf_parkside_894_911_north', SORREL_EAST.id],
  [TWOHB, SORREL_EAST, 'conn_hf_district_892_911_north', SORREL_GATE.id],
];
for (const [door, street, file, was] of DOORS) {
  const c = tables.connections.get(file);
  if (!c || c.a !== door.id || c.b !== was || c.blocked) throw new Error(`${file} should link ${door.id} to ${was}, links ${c?.a} to ${c?.b}`);
  const [dx, dy] = CARDINAL[door.flags.entrance];
  if (c.dir !== door.flags.entrance || street !== at(door.grid_x + dx, door.grid_y + dy)) throw new Error(`${door.name}: ${street.id} isn't ${door.flags.entrance} of ${door.grid_x},${door.grid_y}`);
  c.b = street.id;
  touch('connections', file);
  door.flags.world_exit_zone = street.id;
}

// ── 4. Walls ────────────────────────────────────────────────────────────────
// A sealed tile is walled on every side a neighbour could walk in from; only a facade's own door opens.
const sealed = (z) => !!z?.flags?.building_type && !z.flags.facade;
const dirBetween = (a, b) => {
  if (!onWorld(a) || !onWorld(b)) return null;
  for (const [d, [dx, dy]] of Object.entries(CARDINAL)) if (a.grid_x + dx === b.grid_x && a.grid_y + dy === b.grid_y) return d;
  return null;
};
const dropped = [];
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

// ── 5. The venue ────────────────────────────────────────────────────────────
site.block = { x0: NEW_X0, x1: NEW_X0 + SIDE - 1, y0: Y0, y1: Y0 + SIDE - 1 };
site.x = Math.round((site.x - 2) * 100) / 100;
touch('media_broadcasts', BC);

// ── 6. Prose ────────────────────────────────────────────────────────────────
// [x, y, the text it had (a fragment), the text it has now]
const WALL_ALONG = "marble fins, tall bronze windows and a copper cornice";
const TILES = [
  [891, 915, 'Towers stand along both kerbs', "Hughson Way outside the bleacher gate. The grille gates are on the south side, 19 Hughson Way is across the road, and the Coliseum's wall runs east from here."],
  [892, 915, "Hughson Way's junction", "Hughson Way's junction: north to Halcyon Boulevard, west to the River Road and east along the Coliseum's north wall. The limestone stands straight across the road, with the dome over it."],
  [893, 915, 'between the bleacher gate and 3 Hughson Way', "Hughson Way, with the Coliseum's limestone wall on the south side. On the north a chrome stair goes up into a glass disc on six legs."],
  [896, 915, 'A low curved block stands on the north side.', "Hughson Way at the corner of the Coliseum. A branch goes south along its east wall to Sorrel Way, and the road runs on east to the turn. A low curved block stands on the north side."],
  [897, 915, 'past the Coliseum\'s corner tower', 'Hughson Way turns north here toward Halcyon Boulevard, and the end of Kerbstone Row opens on the south side. A stack of crowd barriers is chained to the lamp post.'],
  [896, 916, 'Hughson Way, under the Coliseum', 'Hughson Way outside GATE C of the Hughson Coliseum, bronze doors in a stepped limestone front on the west side. Kerbstone Row comes in from the east.'],
  [896, 917, 'Hughson Way, under the Coliseum', `Hughson Way, under the Coliseum's east wall: ${WALL_ALONG}, with the dome standing over them. 21 Hughson Way comes down to the far kerb in terraces.`],
  [896, 918, 'Hughson Way, under the Coliseum', "Hughson Way, with the Coliseum's limestone wall on the west side and the glass drum of 23 Hughson Way on the east. Crowd barriers are stacked against a lamp post, ready for game night."],
  [896, 919, 'Hughson Way, under the Coliseum', `Hughson Way, under the Coliseum's east wall: ${WALL_ALONG}. A chrome slab stands on the far kerb, its windows on this side tinted dark.`],
  [896, 920, 'Hughson Way, under the Coliseum', "The south end of Hughson Way, coming out on Sorrel Way between the Coliseum's corner tower and 27 Hughson Way."],
  [897, 916, 'The east end of Teasel Walk', 'The west end of Kerbstone Row, where it meets Hughson Way. GATE C of the Hughson Coliseum is straight across the road, and the terraces of 21 Hughson Way start on the south side.'],
  [890, 917, 'A plain chrome slab', "The end of Teasel Walk, a paved yard between the towers and the Coliseum. GATE D's bronze doors are on the east side under a lit fanlight, and Yarrow Lane is a few steps west."],
  [890, 918, 'Teasel Walk, a narrow paved cut', "Teasel Walk, stopped at the east end by the Coliseum's limestone wall. It turns north here to GATE D."],
  [889, 917, 'Yarrow Lane, a service street', "Yarrow Lane, with Teasel Walk's paved yard opening on the east side and GATE D at the back of it. Everything here is new and everything is locked."],
  [893, 921, 'New road along the estate', "The middle of Sorrel Way, under the Hughson Coliseum's south wall: limestone fins and lit windows along the north side, and the gardens along the south. Ticket stubs collect in the gutter."],
  [894, 921, 'The middle of Sorrel Way', "Sorrel Way outside the Hughson Coliseum's main gate, a stepped limestone frontispiece with the name in gilt over bronze doors. Cable covers run across the road in yellow rubber, feeding the floods. Crowd barriers are chained to the lamp posts."],
  [896, 921, 'outside the Hughson Coliseum\'s main gate', "Sorrel Way, where Hughson Way comes down past the Coliseum's east wall. On the south side 2 Halcyon Boulevard stands back behind a bare forecourt."],
];
for (const [x, y, was, now] of TILES) {
  const z = at(x, y);
  if (!z || !String(z.description).includes(was)) throw new Error(`${x},${y} no longer says: ${was}`);
  z.description = now;
  dirtyZone(z);
}

// [table, file, path, old text, new text]. A world tile's file is named by the tile's id.
const swap = (s, from, to, where) => {
  if (typeof s !== 'string' || !s.includes(from)) throw new Error(`${where}: "${from}" not found`);
  return s.replace(from, to);
};
const LINES = [
  ['zones', TOWERS[0].id, 'description', 'across from the bleacher gate', 'a few steps south of GATE C'],
  ['zones', TOWERS[1].id, 'description', 'straight across from GATE D', "straight across from the Coliseum's east wall"],
  ['zones', TOWERS[2].id, 'description', "beside the Coliseum's west wall", 'across the road from the Coliseum'],
  ['zones', TOWERS[2].id, 'description', 'after a home run', 'after a foul ball'],
  ['zones', G3.id, 'description', 'at the end of Kerbstone Row', 'on Hughson Way at the end of Kerbstone Row'],
  ['zones', G4.id, 'description', 'on Hughson Way across from the towers', 'at the end of Teasel Walk'],
  ['zones', 'zone_hughsongd_hall', 'description', 'The car park is through the doors behind you.', 'Teasel Walk is through the doors behind you.'],
  ['zones', 'zone_district_898_916', 'description', 'and stops at GATE C of the Hughson Coliseum, bronze doors in a stepped limestone front.', 'and ends at Hughson Way, straight across from GATE C of the Hughson Coliseum.'],
  ['zones', 'zone_district_898_919', 'description', "The Coliseum's east wall stands over it.", 'The back of 25 Hughson Way stands over it.'],
  ['zones', 'zone_ballpark_892_910', 'description', 'to the Coliseum and Sorrel Way', "to the Coliseum's north wall"],
  ['zones', 'zone_district_893_922', 'description', 'between 4 Sorrel Way and 2 Halcyon Boulevard', "between 4 Sorrel Way and Fitz's Franks"],
  ['zones', 'zone_district_897_922', 'description', "beside Fitz's Franks", 'beside 2 Halcyon Boulevard'],
  ['zones', 'zone_fitzfranks_counter', 'description', 'a serving hatch onto the boulevard', 'a serving hatch onto Sorrel Way'],
  ['zones', 'zone_hcbox_windows', 'flags.window.description', 'over the roofs to the south.', 'over the roofs to the south-west.'],
  ['zones', 'zone_kimble_shop', 'flags.window.description', 'and the main gate next door.', 'and the main gate down the road.'],
  ['items', 'item_fitz_frank', 'tags.description', "From Fitz's by the bleacher gate.", "From Fitz's by the main gate."],
  ['npcs', 'npc_fitz_rourke', 'description', 'the crowd noise from next door', 'the crowd noise from across the road'],
  ['npcs', 'npc_fitz_rourke', 'dialogue_tree.root.text_by_relation.first', 'He nods at the gate next door.', 'He nods at the gate across the road.'],
  ['npcs', 'npc_fitz_rourke', 'dialogue_tree.here.text', 'He waves the tongs at the boulevard.', 'He waves the tongs at the street.'],
  ['npcs', 'npc_kimble_odessa', 'dialogue_tree.sun.text', 'She points out of the window at the corner.', 'She points out of the window and down the road.'],
];
for (const [t, file, keyPath, from, to] of LINES) {
  const rec = tables[t].get(file);
  if (!rec) throw new Error(`no ${t}/${file}`);
  const keys = keyPath.split('.'), last = keys.pop();
  const obj = keys.reduce((o, k) => o?.[k], rec);
  obj[last] = swap(obj?.[last], from, to, `${file} ${keyPath}`);
  touch(t, file);
}

// A tile with a new name takes it on its power row too.
for (const z of [ALLEY, TEASEL_END, WAY[0], WAY[2], SORREL_EAST]) {
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
  const inWindow = onWorld(z) && z.grid_x >= 885 && z.grid_x <= 900 && z.grid_y >= 913 && z.grid_y <= 923;
  if (!inWindow) { outside.push(z.id); continue; }
  z.exits = nx;
  dirtyZone(z);
  exitsChanged++;
}

// ── 8. Check the prose, then write ──────────────────────────────────────────
for (const key of dirty) {
  const [t, file] = key.split('/');
  if (t !== 'zones') continue;
  const z = byId.get(file);
  if (!onWorld(z) || z.flags?.facade) continue;
  const words = String(z.description).trim().split(/\s+/).length;
  if (words > 60) throw new Error(`${z.id}: ${words} words`);
  if (String(z.description).includes('—')) throw new Error(`${z.id}: em dash`);
}
// Files this rewrites must already be canonical, or a run would churn lines it didn't mean to.
for (const key of dirty) {
  const was = raw.get(key);
  if (was != null && canonicalJson(JSON.parse(was)) !== was) throw new Error(`${key} isn't canonical on disk`);
}
const sealedLeft = zones.filter((z) => onWorld(z) && z.grid_x >= 885 && z.grid_x <= 900 && z.grid_y >= 913 && z.grid_y <= 923 && sealed(z) && Object.keys(z.exits || {}).length);
if (sealedLeft.length) throw new Error(`sealed tiles with exits: ${sealedLeft.map((z) => z.id).join()}`);
console.log(`${moves.length} tiles moved (${parkIds.size} park), 12 Yarrow Lane down; walls: ${dropped.length} dropped, ${minted.length} minted; exits rewritten on ${exitsChanged} tile(s); ${dirty.size} files, ${dropped.length} connection files removed`);
if (outside.length) console.log(`⚠ ${outside.length} tile(s) outside the window disagree with the projection (left alone):`, outside.slice(0, 10));
console.log('walls dropped:', dropped.join(' '));
if (!WRITE) { console.log('\n(dry run; pass --write)'); process.exit(0); }
for (const key of dirty) {
  const [t, file] = key.split('/');
  fs.writeFileSync(path.join(dirOf(t), `${file}.json`), canonicalJson(tables[t].get(file)), 'utf8');
}
for (const id of dropped) fs.rmSync(path.join(dirOf('connections'), `${id}.json`), { force: true });
console.log('✓ written; now run content:import, snapshot-flight-world.mjs, wildlands:bake and shapes:bake');
