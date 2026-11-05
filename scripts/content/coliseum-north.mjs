// ONE-SHOT: move the map's Coliseum two tiles north, from y 916-920 to y 914-918, on the same columns
// (docs/proposals/coliseum-five-tiles.md, "Two tiles north").
//
//   node scripts/content/coliseum-north.mjs [--write]
//
//         889 890 891 892 893 894 895 896 897 898
//  y 912   +   B   B   +  2HW  c   c   c   r
//  y 913   Y   T   a   R  SS   c   c  11HW r
//  y 914   Y   T  BG   P   P   P  G3   R   r
//  y 915   +   R  G4   P   P   P   P   R   r  17
//  y 916   Y   T   P   P   P   P   P   R   K   K
//  y 917   Y   e   P   P   P   P   P   R   T  14
//  y 918   +   E   P   P   P  HC   P   R   T   W
//  y 919   Y   T   R   R   R   R   R   R   T   g
//  y 920   Y   T   T  S3  S5   w  S7   R   T  KM
//  y 921  ===== Sorrel Way =====================
//  y 922   g  HA   g  S4   g  FK   g  B2   g   .
//
// T a sealed tower, c Hughson Court, Y Yarrow Lane, B Burnet Walk, E and e Teasel Walk, R Hughson Way,
// a its alley to the bleacher gate, K Kerbstone Row, W Windrow Lane, w Grandstand Walk.
//
// Home plate goes to 894.61,917.61, a quarter tile from the broadcast's 894.86,917.86. `site.set` is
// TV's own ground and doesn't move, so TV still stands the main gate on Sorrel Way. On the map it faces
// Hughson Way, with Grandstand Walk running on from it to Sorrel Way and Fitz's Franks.
//
// ⚠ THE TEN TILES DISPLACED ON THE NORTH SIDE GO INTO THE TEN VACATED ON THE SOUTH. Every id stays, and
// id and grid already differ here, so a tile is found by where it stands. The park keeps its bc/br
// types, and the rooms keep their ids and facades, so only a door's street link and `world_exit_zone`
// change. 3, 5 and 7 Hughson Way open on Sorrel Way from here, so they take their Sorrel Way addresses
// back, undoing hughson-estate.mjs: names, rooms, power rows, generators, maps, map codes and models.
// Run `npm run models:bake` after it, because NAMED_MODELS carries the same keys.
//
// Walls that are no longer adjacent or no longer true go, the new neighbours are walled, and `exits` is
// rewritten from the projected graph. Each prose edit names the text it replaces, so a line that moved
// under this refuses. It refuses to run twice: once the venue's block starts at y 914 there's nothing
// to do. Afterwards: content:import, snapshot-flight-world.mjs, wildlands:bake, shapes:bake.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CONTENT_DIR, canonicalJson } from './lib.mjs';
import { CARDINAL, projectEdges } from './derive.mjs';

const WRITE = process.argv.includes('--write');
const WORLD = 'map_world';
const BC = 'bc_1783289744953';
const X0 = 891, OLD_Y0 = 916, NEW_Y0 = 914, SIDE = 5;
const REGION = 'region_coldwater', DISTRICT = 'halcyon_fields';
const dirOf = (t) => path.join(CONTENT_DIR, t);

const tables = {}, raw = new Map();
for (const t of ['zones', 'connections', 'power_zones', 'generators', 'maps', 'npcs', 'furniture', 'media_broadcasts']) {
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
if (site.block?.y0 === NEW_Y0) { console.log('The park already stands at y 914-918; nothing to do.'); process.exit(0); }
if (site.block?.y0 !== OLD_Y0 || site.block?.x0 !== X0) throw new Error(`the venue's block is ${JSON.stringify(site.block)}`);

// ── 1. The tiles, found by where they stand ─────────────────────────────────
const need = (x, y, test, what) => {
  const z = at(x, y);
  if (!z || !test(z)) throw new Error(`${x},${y} should be ${what}, is ${z?.id} ${z?.name}`);
  return z;
};
const isRoad = (z) => z.flags?.terrain === 'road';
const isTower = (z) => z.flags?.is_building && !z.flags?.facade;
const isPark = (z) => String(z.flags?.building_type || '').startsWith('ballpark');
const named = (name) => (z) => z.name === name;

const moves = [];   // [zone, new x, new y]
for (let y = OLD_Y0; y < OLD_Y0 + SIDE; y++) for (let x = X0; x < X0 + SIDE; x++) moves.push([need(x, y, isPark, 'the park'), x, y - 2]);
const parkIds = new Set(moves.map(([z]) => z.id));
const ROW = [];     // the y 915 run: 891 to 895, in order
for (let x = 891; x <= 895; x++) {
  const z = need(x, 915, (t) => isRoad(t) && t.name === 'Hughson Way', 'Hughson Way');
  ROW.push(z);
  moves.push([z, x, 919]);
}
const WALK = need(892, 914, (t) => isRoad(t) && t.name === 'Hughson Way', 'Hughson Way');
moves.push([WALK, 894, 920]);
const TOWER19 = need(891, 914, (t) => isTower(t) && t.name === '19 Hughson Way', '19 Hughson Way');
moves.push([TOWER19, 891, 920]);
const FACADES = [[893, '3 Hughson Way', '3 Sorrel Way', 892, 'W3'], [894, '5 Hughson Way', '5 Sorrel Way', 893, 'S5'], [895, '7 Hughson Way', '7 Sorrel Way', 895, 'S7']]
  .map(([x, was, name, nx, marker]) => {
    const z = need(x, 914, (t) => t.flags?.facade && t.name === was && t.flags.entrance === 'south', was);
    moves.push([z, nx, 920]);
    return { z, was, name, marker };
  });
const ALLEY = need(891, 913, (t) => isTower(t) && t.name === '17 Hughson Way', '17 Hughson Way');
const FORECOURT = need(896, 914, (t) => isTower(t) && t.name === '9 Hughson Court', '9 Hughson Court');

const GATE = (type) => {
  const z = moves.map(([t]) => t).find((t) => t.flags?.building_type === type);
  if (!z?.flags?.facade) throw new Error(`no door of type ${type}`);
  return z;
};
const HC = GATE('ballpark'), BG = GATE('ballpark_bleachers'), G3 = GATE('ballpark_gate_c'), G4 = GATE('ballpark_gate_d');
const GATE_D_ST = need(890, 915, (t) => isRoad(t) && t.name === 'Hughson Way', 'Hughson Way');
const TEASEL_YARD = need(890, 917, (t) => isRoad(t) && t.name === 'Teasel Walk', 'Teasel Walk');
const sorrel = (x) => need(x, 921, (t) => isRoad(t) && t.name === 'Sorrel Way', 'Sorrel Way');
const S892 = sorrel(892), S893 = sorrel(893), S895 = sorrel(895);
const moved = new Set(moves.map(([z]) => z.id));
moved.add(ALLEY.id);
moved.add(FORECOURT.id);

// ── 2. The moves ────────────────────────────────────────────────────────────
for (const [z, x, y] of moves) { z.grid_x = x; z.grid_y = y; dirtyZone(z); }
reindex();
for (const [z, x, y] of moves) if (at(x, y) !== z) throw new Error(`${x},${y} holds two tiles`);

// 17 Hughson Way and 9 Hughson Court come down: the bleacher gate and GATE C need a street at the door.
const roadFlags = { district: DISTRICT, region_id: REGION, scavenging_table_id: 'scav_roadside_junk', street_life: true, terrain: 'road' };
for (const z of [ALLEY, FORECOURT]) {
  z.name = 'Hughson Way';
  z.flags = { ...roadFlags };
  z.ambient_theme = 'city';
  z.ambient_events = [];
  delete z.color; delete z.bg_color; delete z.marker;
  dirtyZone(z);
}
WALK.name = 'Grandstand Walk';
TOWER19.flags.entrance = 'north';      // its street is y 919 now

// ── 3. Doors ────────────────────────────────────────────────────────────────
// [facade, street it opens on, the link file]
const [F3, F5, F7] = FACADES.map((f) => f.z);
const DOORS = [
  [BG, ALLEY, 'conn_hf_ballpark_893_916_north', 'zone_ballpark_891_915'],
  [G4, GATE_D_ST, 'conn_hf_ballpark_893_917_west', TEASEL_YARD.id],
  [G3, FORECOURT, 'conn_hf_ballpark_897_916_east', 'zone_ballpark_892_916'],
  [HC, ROW[3], 'conn_hf_ballpark_896_920_south', 'zone_district_894_921'],
  [F3, S892, 'conn_hf_district_895_913_south', ROW[2].id],
  [F5, S893, 'conn_hf_district_896_913_south', ROW[3].id],
  [F7, S895, 'conn_hf_district_897_913_south', ROW[4].id],
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
site.block = { x0: X0, x1: X0 + SIDE - 1, y0: NEW_Y0, y1: NEW_Y0 + SIDE - 1 };
site.y = Math.round((site.y - 2) * 100) / 100;
touch('media_broadcasts', BC);

// ── 6. Addresses ────────────────────────────────────────────────────────────
// hughson-estate.mjs in reverse. It dropped "The" from two room names to stay under 30 characters, and
// the shorter street gives them back.
const RENAMES = FACADES.map((f) => [f.was, f.name]);
const renamed = (s) => {
  for (const [from, to] of RENAMES) if (s === from || s.startsWith(`${from} `)) return to + s.slice(from.length);
  return s;
};
let names = 0;
for (const [t, key] of [['zones', 'name'], ['maps', 'name'], ['npcs', 'vendor_shop_name'], ['power_zones', 'name'], ['generators', 'name']]) {
  for (const [file, o] of tables[t]) {
    let hit = false;
    if (typeof o[key] === 'string' && renamed(o[key]) !== o[key]) { o[key] = renamed(o[key]); hit = true; }
    if (t === 'zones' && o.flags?.building_name && renamed(o.flags.building_name) !== o.flags.building_name) { o.flags.building_name = renamed(o.flags.building_name); hit = true; }
    if (hit) { touch(t, file); names++; }
  }
}
for (const f of FACADES) f.z.marker = f.marker;
for (const [id, name] of [['zone_hf_assets_strong', '3 Sorrel Way — The Strongroom'], ['zone_util_zone_hf_fit_floor', '7 Sorrel Way — The Pool Plant']]) {
  byId.get(id).name = name;
  tables.power_zones.get(id).name = name;
}
const MODELS = [['5hughsonway', '5sorrelway'], ['7hughsonway', '7sorrelway']];

// ── 7. Prose ────────────────────────────────────────────────────────────────
// [x, y, the text it had (a fragment), the text it has now]
const TILES = [
  // The run along the south wall.
  [891, 919, 'Hughson Way outside the bleacher gate', "The west end of this stretch of Hughson Way, stopped by the side of 14 Yarrow Lane. The Coliseum's corner tower stands on the north side and 19 Hughson Way on the south."],
  [892, 919, "Hughson Way's junction", "Hughson Way, under the Coliseum's south wall: limestone fins and lit windows along the north side. On the south a glass disc stands on six legs with its back to the road."],
  [893, 919, "with the Coliseum's limestone wall", "Hughson Way, with the Coliseum's limestone wall on the north side and the back of 5 Sorrel Way on the south, a glass drum between two short curved wings."],
  [894, 919, 'set back behind four tables', "Hughson Way outside the Hughson Coliseum's main gate, a stepped limestone frontispiece with the name in gilt over bronze doors. Cable covers run across the road in yellow rubber, feeding the floods. Grandstand Walk goes off south to Sorrel Way."],
  [895, 919, "under the Coliseum's marble fins", "Hughson Way, under the Coliseum's marble fins. The tall back of 7 Sorrel Way stands on the south side, and the road joins the east side of the park a few steps on."],
  [894, 920, 'Hughson Way, with a glass disc', "Grandstand Walk, a paved cut between 5 and 7 Sorrel Way. The Coliseum's main gate is at the north end, across Hughson Way, and Fitz's Franks is at the south end, across Sorrel Way."],
  // The doors on Sorrel Way, and the street that lost the gate.
  [892, 921, 'a long view down to the gate', 'Sorrel Way, new tarmac and a long view down to the gate. On the north side a chrome stair goes up into a glass disc on six legs.'],
  [893, 921, 'The middle of Sorrel Way', 'Sorrel Way, with the gardens along the south side. On the north side 5 Sorrel Way is a glass drum set back behind four tables, with a chalkboard against the glass. Ticket stubs collect in the gutter.'],
  [894, 921, "outside the Hughson Coliseum's main gate", "Sorrel Way at the foot of Grandstand Walk, with the Coliseum's main gate up the walk to the north and Fitz's Franks on the south side. Crowd barriers are chained to the lamp posts."],
  [895, 921, 'A wide new street', 'Sorrel Way, with a strip of garden along the south side. On the north side 7 Sorrel Way comes down to the pavement in planted steps, with a chrome drum at the foot for a door.'],
  [896, 921, "where Hughson Way comes down past the Coliseum's east wall", "Sorrel Way, where Hughson Way comes down from the Coliseum. On the south side 2 Halcyon Boulevard stands back behind a bare forecourt."],
  // The east side.
  [896, 914, 'Three low storeys', "Hughson Way outside GATE C of the Hughson Coliseum, bronze doors in a stepped limestone front on the west side. The balconies of 11 Hughson Way stand over the north side."],
  [896, 915, "at the corner of the Coliseum", "Hughson Way, under the Coliseum's east wall: marble fins, tall bronze windows and a copper cornice. The road runs on east to the turn."],
  [896, 916, 'outside GATE C', "Hughson Way, under the Coliseum's east wall, where Kerbstone Row comes in from the east."],
  [896, 919, "under the Coliseum's east wall", "Hughson Way's junction, at the Coliseum's south-east corner: north along the east wall, west along the south wall to the main gate, and south to Sorrel Way. A chrome slab stands on the far kerb, its windows on this side tinted dark."],
  [897, 914, 'with 9 Hughson Court on the west side', 'Hughson Way, open on the west side to the road outside GATE C. Sorrel Way goes off to the east from here, past the Box Office.'],
  // The north side.
  [891, 913, 'Sixteen storeys', "A short cut off Hughson Way, ending at the Coliseum's bleacher gate, two grille gates in the north wall. Burnet Walk opens on the north side."],
  [892, 913, 'A chrome slab stands on the far kerb.', "Hughson Way outside the Halcyon Sales Suite, a lit glass drum between two curved wings. The road stops here at the Coliseum's north wall, and a short cut goes off west to the bleacher gate."],
  // West of the park.
  [890, 915, 'Hughson Way, two lanes and a kerb', 'The east end of this stretch of Hughson Way, stopped by GATE D of the Hughson Coliseum, bronze doors in a stepped limestone front. Crowd barriers are stacked against a lamp post, ready for game night.'],
  [890, 917, 'The end of Teasel Walk', "The end of Teasel Walk, a paved yard against the Coliseum's west wall. Nothing opens onto it. Crowd barriers are stacked along the limestone, ready for game night."],
  [890, 918, 'It turns north here to GATE D.', "Teasel Walk, stopped at the east end by the Coliseum's limestone wall. A paved yard opens on the north side."],
  [889, 917, 'GATE D at the back of it', "Yarrow Lane, with Teasel Walk's paved yard opening on the east side. Everything here is new and everything is locked."],
];
for (const [x, y, was, now] of TILES) {
  const z = at(x, y);
  if (!z || !String(z.description).includes(was)) throw new Error(`${x},${y} no longer says: ${was}`);
  z.description = now;
  dirtyZone(z);
}

// [table, file, path, old text, new text]
const swap = (s, from, to, where) => {
  if (typeof s !== 'string' || !s.includes(from)) throw new Error(`${where}: "${from}" not found`);
  return s.replace(from, to);
};
const LINES = [
  // The doors.
  ['zones', HC.id, 'description', 'frontispiece on Sorrel Way between', 'frontispiece on Hughson Way between'],
  ['zones', G3.id, 'description', 'on Hughson Way at the end of Kerbstone Row', 'on Hughson Way'],
  ['zones', G4.id, 'description', 'at the end of Teasel Walk', 'on Hughson Way'],
  ['zones', 'zone_hughsongd_hall', 'description', 'Teasel Walk is through the doors behind you.', 'Hughson Way is through the doors behind you.'],
  ['zones', 'zone_hughson_rotunda', 'flags.window.description', "Sorrel Way is outside, and Fitz's Franks across it.", "Hughson Way is outside, and Grandstand Walk runs on from it to Sorrel Way and Fitz's Franks."],
  // Their neighbours.
  ['zones', 'zone_district_898_916', 'description', 'and ends at Hughson Way, straight across from GATE C of the Hughson Coliseum.', "and ends at Hughson Way, under the Coliseum's east wall."],
  ['zones', 'zone_ballpark_891_918', 'description', 'GATE C of the Hughson Coliseum is straight across the road', "The Coliseum's east wall is straight across the road"],
  ['zones', 'zone_ballpark_891_916', 'description', 'a few steps south of GATE C', 'across from the Coliseum'],
  ['zones', 'zone_ballpark_892_920', 'description', "between the Coliseum's corner tower and 27 Hughson Way", 'between 7 Sorrel Way and 27 Hughson Way'],
  ['zones', 'zone_district_895_922', 'description', "across Sorrel Way from the Coliseum's south wall", 'on Sorrel Way'],
  ['zones', 'zone_hf_deposit_counter', 'flags.window.description', 'looking out at Sorrel Way and the Coliseum across it', 'looking out at Sorrel Way and the glass disc of 3 Sorrel Way across it'],
  ['zones', 'zone_kimble_shop', 'flags.window.description', 'and the main gate down the road.', 'and the main gate round the corner.'],
  ['zones', 'zone_wind_balcony', 'description', 'Below it are a low roof and Hughson Way', 'Below it is Hughson Way'],
  ['zones', 'zone_ballpark_895_912', 'description', 'its post comes through 5 Hughson Way', 'its post comes through 9 Hughson Way'],
  ['zones', 'zone_ballpark_895_913', 'description', "Curved wings along the back of 7 Hughson Way. The gym's machines face it, and most of them are empty.", "Curved wings built up against the Coliseum's north wall. The flats on that side get the organ through the plaster."],
  // 3, 5 and 7 on Sorrel Way.
  ['zones', F5.id, 'description', 'set back off Hughson Way behind', 'set back off Sorrel Way behind'],
  ['zones', F7.id, 'description', 'from the far end of Hughson Way', 'from the far end of Sorrel Way'],
  ['zones', 'zone_hf_grounds_room', 'description', 'carries out onto Hughson Way', 'carries out onto Sorrel Way'],
  ['zones', 'zone_hf_grounds_room', 'flags.window.description', 'with Hughson Court on one side and Hughson Way on the other. From the tables on the court side you can watch the people in the next building watching you, which is a running argument in here.', "with Sorrel Way on one side and Hughson Way on the other. From the tables on the north side all you can see is the Coliseum's wall, which is a running argument in here."],
  ['zones', 'zone_hf_grounds_gallery', 'flags.window.description', "you get the court on one side and the Coliseum's dome on the other", "you get Sorrel Way on one side and the Coliseum's dome on the other"],
  ['zones', 'zone_hf_fit_floor', 'description', 'The glass looks north at Hughson Court, so every machine faces a wall of somebody else\'s curtains.', "The glass looks north across Hughson Way, so every machine faces the Coliseum's limestone wall."],
  ['zones', 'zone_hf_fit_floor', 'flags.window.description', 'The back of Hughson Court fills the whole of it.', "The Coliseum's south wall fills the whole of it."],
  ['zones', 'zone_hf_fit_pool', 'flags.window.description', "with the Spire away to the north and the Coliseum's dome close by on the south side", "with the Coliseum's dome close by to the north and the Spire away past it"],
  ['furniture', 'furn_hf_grounds_board', 'description', 'Today it says 5 HUGHSON WAY.', 'Today it says 5 SORREL WAY.'],
  ['npcs', 'npc_hf_ferreira', 'chitchat.3', 'She wipes a table on the court side', 'She wipes a table on the north side'],
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
for (const z of [ALLEY, FORECOURT, WALK]) {
  const row = tables.power_zones.get(z.id);
  if (!row || row.name === z.name) continue;
  row.name = z.name;
  touch('power_zones', z.id);
}

// ── 8. Exits from the projected graph ───────────────────────────────────────
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
  const inWindow = onWorld(z) && z.grid_x >= 885 && z.grid_x <= 900 && z.grid_y >= 908 && z.grid_y <= 923;
  if (!inWindow) { outside.push(z.id); continue; }
  z.exits = nx;
  dirtyZone(z);
  exitsChanged++;
}

// ── 9. Check the prose, then write ──────────────────────────────────────────
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
const markers = zones.filter((z) => ['W3', 'S5', 'S7'].includes(z.marker));
if (markers.length !== 3) throw new Error(`map codes: ${markers.map((z) => `${z.marker} ${z.id}`).join(', ')}`);
const leaky = zones.filter((z) => onWorld(z) && z.grid_x >= 885 && z.grid_x <= 900 && z.grid_y >= 908 && z.grid_y <= 923 && sealed(z) && Object.keys(z.exits || {}).length);
if (leaky.length) throw new Error(`sealed tiles with exits: ${leaky.map((z) => z.id).join()}`);
console.log(`${moves.length} tiles moved (${parkIds.size} park), 17 Hughson Way and 9 Hughson Court down; ${names} files renamed; walls: ${dropped.length} dropped, ${minted.length} minted; exits rewritten on ${exitsChanged} tile(s); ${dirty.size} files, ${dropped.length} connection files removed`);
if (outside.length) console.log(`⚠ ${outside.length} tile(s) outside the window disagree with the projection (left alone):`, outside.slice(0, 10));
console.log('walls dropped:', dropped.join(' '));
if (!WRITE) { console.log('\n(dry run; pass --write)'); process.exit(0); }
for (const key of dirty) {
  const [t, file] = key.split('/');
  fs.writeFileSync(path.join(dirOf(t), `${file}.json`), canonicalJson(tables[t].get(file)), 'utf8');
}
for (const id of dropped) fs.rmSync(path.join(dirOf('connections'), `${id}.json`), { force: true });
for (const [from, to] of MODELS) {
  const p = path.join(dirOf('building_models'), `${from}.json`);
  const m = JSON.parse(fs.readFileSync(p, 'utf8'));
  m.id = to;
  for (const b of m.bind) if (b.key === from) b.key = to;
  fs.writeFileSync(path.join(dirOf('building_models'), `${to}.json`), canonicalJson(m), 'utf8');
  fs.rmSync(p);
}
console.log('✓ written; now rename the keys in NAMED_MODELS, run models:bake, then content:import and the bakes');
