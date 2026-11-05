// ONE-SHOT: put the eleven Halcyon buildings on the holding map back on the lot, and keep the rest of
// the grass round the park (docs/proposals/hughson-estate.md).
//
//   node scripts/content/hughson-estate.mjs [--write]
//
//         887 888 889 890 891 892 893 894 895 896 897
//  y 909  ===== Halcyon Boulevard ==================
//  y 910   p   p   p   p   p   R  6HB 8HB INS LND  r
//  y 911   p   p   p   p   p   R   p   p   p   K1  r
//  y 912   p   p   p   p   p   R  VM8  p   p   p   r
//  y 913   p   p   p   p   p   R  SS   p   p   K5  r
//  y 914   p   p   p   p   p   R  S3  S5  S7   p   r
//  y 915  ===== Hughson Way ========================
//
// A move is a swap, as in coliseum-resite.mjs: the building takes the plot's grid and map_id, and the
// green tile on the plot takes the building's old cell on the holding map, so no zone file is created
// or deleted. Each building keeps its entrance, because `flags.entrance` is the side its model draws
// the door on and its hall's exits are laid out from it. So each goes to a plot with a street on that
// side, and its street link comes back under the id it had before it was set aside.
//
// Then 892,910 to 892,914 become road, the rest of the green and ten grass gaps on Sorrel Way and
// Kettle Lane become park tiles, six buildings take a Hughson Way address, and the prose that names the
// old street or the old view is rewritten. Each edit names the text it replaces, so a line that moved
// under this refuses.
//
// `exits` is rewritten from the projected graph, because content:lint holds the two edge for edge. It
// refuses to run twice: once 5 Sorrel Way's tile is on map_world there's nothing to do.

import fs from 'node:fs';
import path from 'node:path';
import { CONTENT_DIR, canonicalJson } from './lib.mjs';
import { CARDINAL, OPPOSITE, projectEdges } from './derive.mjs';

const WRITE = process.argv.includes('--write');
const WORLD = 'map_world', HOLD = 'map_set_aside';
const REGION = 'region_coldwater', DISTRICT = 'halcyon_fields';
const PARK_COLOR = '#8fd08a';
const dirOf = (t) => path.join(CONTENT_DIR, t);

const tables = {};
const load = (t) => {
  tables[t] = new Map(fs.readdirSync(dirOf(t)).filter((f) => f.endsWith('.json'))
    .map((f) => { const o = JSON.parse(fs.readFileSync(path.join(dirOf(t), f), 'utf8')); return [f.slice(0, -5), o]; }));
  return tables[t];
};
for (const t of ['zones', 'connections', 'npcs', 'maps', 'furniture', 'power_zones', 'generators']) load(t);
const dirty = new Set();   // `${table}/${file}`
const touch = (t, file) => dirty.add(`${t}/${file}`);
const zones = [...tables.zones.values()];
const byId = new Map(zones.map((z) => [z.id, z]));
const onWorld = (z) => z && z.map_id === WORLD && (z.grid_z ?? 0) === 0 && z.grid_x != null;
const cell = new Map();
const reindex = () => { cell.clear(); for (const z of zones) if (onWorld(z)) cell.set(`${z.grid_x},${z.grid_y}`, z); };
reindex();
const at = (x, y) => cell.get(`${x},${y}`);
const dirtyZone = (z) => touch('zones', z.id);

if (byId.get('zone_district_896_913')?.map_id === WORLD) { console.log('5 Sorrel Way is already back on the map; nothing to do.'); process.exit(0); }

// ── 1. The moves ────────────────────────────────────────────────────────────
// [building id, name on the holding map, plot x, y, new address or null, new map code or null]
const MOVES = [
  ['zone_district_894_911', '6 Halcyon Boulevard', 893, 910, null, null],
  ['zone_district_895_911', '8 Halcyon Boulevard', 894, 910, null, null],
  ['zone_district_896_911', 'The Halcyon Institute', 895, 910, null, null],
  ['zone_district_897_911', 'Halcyon Land Office', 896, 910, null, null],
  ['zone_district_895_913', '3 Sorrel Way', 893, 914, '3 Hughson Way', 'W3'],
  ['zone_district_896_913', '5 Sorrel Way', 894, 914, '5 Hughson Way', 'W5'],
  ['zone_district_897_913', '7 Sorrel Way', 895, 914, '7 Hughson Way', 'W7'],
  ['zone_district_894_912', '8 Vetch Mews', 893, 912, '2 Hughson Way', '2W'],
  ['zone_district_894_913', 'Halcyon Sales Suite', 893, 913, null, null],
  ['zone_district_898_911', '1 Kettle Lane', 896, 911, '9 Hughson Way', '9W'],
  ['zone_district_898_913', '5 Kettle Lane', 896, 913, '11 Hughson Way', '1W'],
];
const KEEPERS = ['npc_going_crake', 'npc_course_quainton', 'npc_plot_follet', 'npc_hf_ferreira', 'npc_vested_fewtrell',
  'npc_hf_marchetti', 'npc_hf_salad_okonjo', 'npc_wind_marchbank'];

const plan = MOVES.map(([id, name, x, y, address, marker]) => {
  const b = byId.get(id), p = at(x, y);
  if (b?.name !== name || b.map_id !== HOLD || !b.flags?.facade) throw new Error(`${id} should be ${name} on the holding map, is ${b?.name} on ${b?.map_id}`);
  if (!p || p.name !== 'Hughson Green' || p.flags?.building_type || p.flags?.terrain === 'road') throw new Error(`${x},${y} is not an open plot: ${p?.id} ${p?.name}`);
  return { b, p, x, y, address, marker, oldName: name };
});
const report = [];
const movedIds = new Set();
for (const m of plan) {
  const { b, p, x, y } = m;
  m.from = b.flags.set_aside_from;
  [p.grid_x, p.grid_y, p.grid_z, p.map_id] = [b.grid_x, b.grid_y, 0, HOLD];
  p.exits = {};
  p.flags = { ...p.flags, set_aside: true, set_aside_from: `${x},${y}` };
  [b.grid_x, b.grid_y, b.grid_z, b.map_id] = [x, y, 0, WORLD];
  delete b.flags.set_aside;
  delete b.flags.set_aside_from;
  dirtyZone(b); dirtyZone(p);
  movedIds.add(b.id); movedIds.add(p.id);
  for (const c of tables.connections.values()) if (c.a === p.id || c.b === p.id) throw new Error(`${p.id} carries a connection: ${c.id}`);
}
reindex();

// ── 2. The road ─────────────────────────────────────────────────────────────
const roadTile = (z, description) => {
  z.name = 'Hughson Way';
  z.description = description;
  z.flags = { district: DISTRICT, region_id: REGION, scavenging_table_id: 'scav_roadside_junk', street_life: true, terrain: 'road' };
  z.ambient_theme = 'city';
  z.ambient_events = [];
  delete z.color; delete z.bg_color; delete z.marker;
  dirtyZone(z);
};
const ROAD = {
  '892,910': 'Hughson Way leaves Halcyon Boulevard here and runs straight south to the Coliseum and Sorrel Way. The blank flank of 6 Halcyon Boulevard is on the east side and flowerbeds are on the west.',
  '892,911': 'Hughson Way, two lanes and a kerb, with the green on both sides: the main lawn to the west, and on the east a planted gap leading into the courtyard behind the boulevard.',
  '892,912': 'Hughson Way, with a clipped hedge and flowerbeds along the west side. On the east side 2 Hughson Way comes down to the pavement in planted terraces, with a glazed door at the foot.',
  '892,913': "Hughson Way outside the Halcyon Sales Suite, a lit glass drum between two curved wings. Its doors open before you've reached them. A clipped hedge runs along the far kerb.",
  '892,914': 'Hughson Way, with a glass disc on chrome legs standing on the east side and the green on the west. Crowd barriers are stacked against a lamp post, ready for game night.',
};
for (const [k, d] of Object.entries(ROAD)) {
  const [x, y] = k.split(',').map(Number), z = at(x, y);
  if (z?.name !== 'Hughson Green') throw new Error(`${k} should be Hughson Green, is ${z?.name}`);
  roadTile(z, d);
}
const WAY = {
  '887,915': 'The west end of Hughson Way, where it meets the River Road. Hughson Green runs along the north side and the car park along the south.',
  '888,915': 'Hughson Way, two lanes and a kerb between the green and the car park. Crowd barriers are stacked against a lamp post, ready for game night.',
  '889,915': "Hughson Way, swept more often than the public streets. Benches line the green on the north side, and the car park's bays start at the kerb on the south.",
  '890,915': 'Hughson Way, two lanes and a kerb between the green and the car park. Crowd barriers are stacked against a lamp post, ready for game night.',
  '891,915': "Hughson Way, swept more often than the public streets. Benches line the green on the north side, and the car park's bays start at the kerb on the south.",
  '892,915': "Hughson Way's junction: north to Halcyon Boulevard, south along the Coliseum's wall to Sorrel Way, and west to the River Road. East, the road runs on under the park's north wall.",
  '893,915': 'Hughson Way between the bleacher gate and 3 Hughson Way. The bronze doors of the gate are on the south side, and on the north a chrome stair goes up into a glass disc on six legs.',
  '894,915': "Hughson Way, with the Coliseum's limestone wall on the south side. On the north side 5 Hughson Way is a glass drum set back behind four tables, with a chalkboard against the glass.",
  '895,915': "Hughson Way, under the Coliseum's marble fins. On the north side 7 Hughson Way comes down to the pavement in planted steps, with a chrome drum at the foot for a door.",
  '896,915': "Hughson Way, under the Coliseum's limestone wall: marble fins, tall bronze windows and a copper cornice, with the dome standing over them. A corner of the green opens on the north side.",
  '897,915': "Hughson Way turns north here, past the Coliseum's corner tower, toward Halcyon Boulevard. A stack of crowd barriers is chained to the lamp post.",
  '897,914': 'Hughson Way, with a corner of the green on the west side. Sorrel Way goes off to the east from here, past the Box Office.',
  '897,913': "Hughson Way, outside a modest door under a glass canopy: 11 Hughson Way, the convalescent rooms. The back of the Coliseum Box Office is across the road.",
  '897,912': 'Hughson Way, with flowerbeds on the west side and the Cart Yard on the east. Crowd barriers are stacked against a lamp post, ready for game night.',
  '897,911': "Hughson Way, at the foot of a chrome column of growing trays lit magenta. The door of 9 Hughson Way is on the west side and smells of wet peat. Mulcahy's side wall is across the road.",
  '897,910': "The top of Hughson Way, where it meets Halcyon Boulevard. The Land Office's hoarding stands over the west side, and Mulcahy's green neon shows on the east.",
};
for (const [k, d] of Object.entries(WAY)) {
  const [x, y] = k.split(',').map(Number), z = at(x, y);
  if (z?.name !== 'Hughson Way') throw new Error(`${k} should be Hughson Way, is ${z?.name}`);
  z.description = d;
  dirtyZone(z);
}

// ── 3. The green ────────────────────────────────────────────────────────────
const EV = {
  grove: ['The wind goes through the trees and drops a few leaves on the path.', 'A groundsman rakes the mulch back inside the edging.', 'A dog runs a long circle round the trees and comes back.'],
  pond: ['A duck works along the reeds and goes under.', 'Something rises in the pond and leaves a ring on the water.', 'A gull lands on the coping, looks at the water and leaves.'],
  lawn: ['Somebody cuts across the grass towards the gates with a folded scorecard.', 'The wind brings over the smell of frying onions from Sorrel Way.', 'A man on a bench reads the box score and folds the paper.'],
  beds: ['A groundsman kneels at the bed with a trowel and a bucket.', 'Bees work along the flowers.', 'A car goes by on Hughson Way with a scarf shut in the window.'],
  kerb: ['Somebody on a bench checks a ticket against the time.', 'A car noses along Hughson Way, looking for the way into the car park.', 'The wind brings over the smell of frying onions from Sorrel Way.'],
  court: ['A window opens somewhere above the courtyard and shuts again.', 'Somebody crosses the lawn with a paper cup, heading for the road.', 'The lamp over the benches buzzes and steadies.'],
  sorrel: ['Somebody stops on the kerb to retie a shoe.', 'A street sweeper goes by on Sorrel Way with its brushes up.', 'A sparrow lands on the kerb, finds nothing and goes.'],
};
const LIMES = 'Young limes on a bed of bark mulch inside a timber edging, with shrubs between them. Halcyon Boulevard runs along the north side, and the green opens out to the south.';
const LAUREL = 'The north edge of Hughson Green, planted thick with limes and laurel. A gravel path comes in off the boulevard here and heads for the pond.';
const MAPLES = "Maples and low shrubs on a mulch bed along the west side of the green, with the River Road past them. The trees take the edge off the Curtain's hum.";
const BARROW = "The west edge of the green: four trees inside a timber edging. A groundsman's barrow stands on the path with a rake and a bag of bulbs in it.";
const TAGS = 'A stand of four trees on a mulch bed, each with a small brass tag giving its kind. The pond shows through the trunks.';
const MOWING = "Trees and clipped shrubs inside a low timber edging, close to the pond. It's Sir Charles's ground, and the mowing comes out of the gate money.";
const BED_LONG = 'A long flowerbed inside a stone kerb, with a clipped box hedge between it and Hughson Way. A stone urn stands at each end.';
const BED_DOGS = 'Beds of hardy flowers along the east side of the green, kerbed in stone and weeded often. A small sign asks you to keep dogs off them.';
const KERB_CAR = 'Three benches round a lamp beside Hughson Way, looking across the road at the car park. The bin gets emptied after every game. Ticket stubs have got into the grass.';
const KERB_WAIT = 'The south edge of the green: benches, a lamp and two planted urns, a few steps from the kerb. People wait here for the rest of their party on game nights.';
const GREEN = [
  // The west lawn: groves toward the edges, the pond in the middle, beds by the road, benches along Hughson Way.
  [887, 910, 'grove', LAUREL, 'grove'], [888, 910, 'grove', LIMES, 'grove'], [889, 910, 'grove', LAUREL, 'grove'], [890, 910, 'grove', LIMES, 'grove'], [891, 910, 'flowerbeds', BED_LONG, 'beds'],
  [887, 911, 'grove', MAPLES, 'grove'], [888, 911, 'grove', TAGS, 'grove'],
  [889, 911, 'benches', 'Three benches and a lamp on the north side of the pond. Halcyon offered Sir Charles a fortune for this ground three times. He sent each cheque back with two tickets in the envelope, and the estate was built round him.', 'lawn'],
  [890, 911, 'grove', MOWING, 'grove'], [891, 911, 'flowerbeds', BED_DOGS, 'beds'],
  [887, 912, 'grove', BARROW, 'grove'],
  [888, 912, 'benches', 'Three benches round a lamp on the west side of the pond, with a bin and two planted urns. The dome shows over the trees to the south-east.', 'lawn'],
  [889, 912, 'pond', 'A round pond in the middle of Hughson Green, with a stone coping, a willow over the water and reeds along one side. A brass plate on the coping reads "Sir Charles\'s ground. Please walk on the grass."', 'pond'],
  [890, 912, 'benches', 'Benches and a lamp on the east side of the pond. On a game night people bring blankets and listen to the crowd through the walls.', 'lawn'],
  [891, 912, 'flowerbeds', BED_LONG, 'beds'],
  [887, 913, 'grove', MAPLES, 'grove'], [888, 913, 'grove', MOWING, 'grove'],
  [889, 913, 'benches', 'The south side of the pond: three benches round a lamp, and urns planted with something purple. A gravel path runs off toward Hughson Way and the gates.', 'lawn'],
  [890, 913, 'grove', TAGS, 'grove'], [891, 913, 'flowerbeds', BED_DOGS, 'beds'],
  [887, 914, 'benches', "A bench and a lamp at the south-west corner of the green, with the River Road on one side and Hughson Way on the other. The Curtain's hum is louder here.", 'kerb'],
  [888, 914, 'benches', KERB_CAR, 'kerb'], [889, 914, 'benches', KERB_WAIT, 'kerb'], [890, 914, 'benches', KERB_CAR, 'kerb'], [891, 914, 'benches', KERB_WAIT, 'kerb'],
  // The courtyard behind the buildings: flowerbeds and benches, in off the road through 893,911.
  [893, 911, 'flowerbeds', 'A planted gap between the back of 6 Halcyon Boulevard and the flank of 2 Hughson Way, leading east off the road into the rest of the green. Stone-kerbed beds run along both walls.', 'beds'],
  [894, 911, 'benches', "A square of lawn behind the boulevard frontage, with three benches round a lamp and a bin that's emptied. The backs of 6 and 8 Halcyon Boulevard look down into it.", 'court'],
  [895, 911, 'flowerbeds', "Flowerbeds behind the Halcyon Institute, kerbed in stone, with a hose reel chained to a post. After dark the magenta light from 9 Hughson Way's growing trays falls across them.", 'court'],
  [894, 912, 'flowerbeds', 'A long bed under the terraces of 2 Hughson Way. The terraces are watered at six and at seven, and the run-off keeps this bed greener than any other on the green.', 'court'],
  [895, 912, 'benches', "The middle of the courtyard: three benches round a lamp, two planted urns and a bin. Halcyon's buildings back onto it on every side, and the top of the dome shows over 7 Hughson Way.", 'court'],
  [896, 912, 'flowerbeds', "The narrow east end of the green, between 9 and 11 Hughson Way and open to the road. Flowerbeds run along both walls, and the Cart Yard's tarpaulins show across the way.", 'beds'],
  [894, 913, 'benches', 'Benches on the lawn behind 5 Hughson Way, the café. The noise of the room comes through its glass, and somebody has left a paper cup on the arm of a bench.', 'court'],
  [895, 913, 'flowerbeds', "Flowerbeds along the back of 7 Hughson Way. Through the ground-floor glass you can see the gym's machines in ranks, facing you, most of them empty.", 'court'],
  [896, 914, 'benches', "A corner of the green where Hughson Way turns north, with 7 and 11 Hughson Way behind it: three benches, a lamp and a bin. The Coliseum's limestone wall is across the road.", 'kerb'],
];
const parkTile = (z, name, feature, description, events) => {
  z.name = name;
  z.description = description;
  z.ambient_theme = 'urban';
  z.ambient_events = EV[events];
  z.color = PARK_COLOR;
  z.flags = { district: DISTRICT, park_feature: feature, region_id: REGION, street_life: true, terrain: 'park' };
  dirtyZone(z);
};
for (const [x, y, feature, description, events] of GREEN) {
  const z = at(x, y);
  if (z?.name !== 'Hughson Green') throw new Error(`${x},${y} should be Hughson Green, is ${z?.name}`);
  parkTile(z, 'Hughson Green', feature, description, events);
}
for (const z of zones) if (onWorld(z) && z.name === 'Hughson Green' && z.flags.terrain !== 'park') throw new Error(`${z.id} was left as ${z.flags.terrain}`);

// ── 4. The gaps ─────────────────────────────────────────────────────────────
// Ten grass tiles either side of the street. 898,919 and 903,920 each have a wall file against the
// tile beside them (the park, and the sealed shell of 8 Kerbstone Row), which stay.
const GAPS = [
  [887, 922, 'Sorrel Gardens', 'grove', 'Four young trees on a mulch bed at the corner of Sorrel Way and the River Road, inside a timber edging. The rough meadow starts again behind them.'],
  [889, 922, 'Sorrel Gardens', 'flowerbeds', 'A strip of garden between Halcyon West Halt and the Recital Hall, with a stone-kerbed flowerbed, a clipped hedge and an urn. The rough meadow starts again behind it.'],
  [891, 922, 'Sorrel Gardens', 'benches', 'A square of lawn between the Recital Hall and 4 Sorrel Way, with benches round a lamp and a bin. A folded concert programme stops one bench rocking.'],
  [893, 922, 'Sorrel Gardens', 'flowerbeds', 'A flowerbed in a stone kerb between 4 Sorrel Way and 2 Halcyon Boulevard, with a clipped hedge along the pavement. The planting is the same as the bed two plots along.'],
  [895, 922, 'Sorrel Gardens', 'benches', "A square of lawn across Sorrel Way from the Coliseum's south wall, with benches round a lamp, next door to Fitz's Franks. Most of the people sitting here are eating.", 'sorrel'],
  [897, 922, 'Sorrel Gardens', 'grove', "Four young trees on a mulch bed beside Fitz's Franks. Two posts from an old Halcyon plot board are still in the ground, with a sticker on one of them.", 'sorrel'],
  [898, 919, 'Windrow Corner', 'flowerbeds', "A kept corner where Windrow Lane meets Kettle Lane, behind Kimble's: a stone-kerbed flowerbed, a clipped hedge and an urn. The Coliseum's east wall stands over it.", 'sorrel'],
  [901, 920, 'Sorrel Gardens', 'benches', 'A small square of lawn off Sorrel Way, between Halcyon Pavilion and the Winter Garden, with benches round a lamp and a bin.', 'sorrel'],
  [903, 920, 'Sorrel Gardens', 'flowerbeds', "A flowerbed off Sorrel Way, between the Winter Garden and 1 Kerbstone Row. The plain chrome hoarding of 8 Kerbstone Row closes the north end.", 'sorrel'],
  [905, 920, 'Sorrel Gardens', 'grove', 'Four young trees on a mulch bed off Sorrel Way, between 1 and 15 Kerbstone Row, inside a timber edging.', 'sorrel'],
].map(([x, y, name, feature, description, events]) => ({ x, y, name, feature, description, events: events || 'sorrel' }));
for (const g of GAPS) {
  const z = at(g.x, g.y);
  if (z?.name !== 'Grasslands' || z.flags?.terrain !== 'grass') throw new Error(`${g.x},${g.y} should be open grass, is ${z?.name}`);
  parkTile(z, g.name, g.feature, g.description, g.events);
}
// A tile with a new name takes it on its power row too.
for (const z of zones) {
  const row = tables.power_zones.get(z.id);
  if (!row || row.name === z.name || !dirty.has(`zones/${z.id}`) || !onWorld(z) || z.flags?.facade) continue;
  row.name = z.name;
  touch('power_zones', z.id);
}

// ── 5. Doors ────────────────────────────────────────────────────────────────
const pair = (a, b) => [a, b].sort().join('~');
const spoken = new Set([...tables.connections.values()].filter((c) => !c.blocked).map((c) => pair(c.a, c.b)));
const minted = [];
for (const { b, x, y, oldName } of plan) {
  const ent = b.flags.entrance, [dx, dy] = CARDINAL[ent], street = at(x + dx, y + dy);
  if (!street || street.flags?.terrain !== 'road') throw new Error(`${oldName}: no road ${ent} of ${x},${y} (${street?.name})`);
  if (spoken.has(pair(b.id, street.id))) throw new Error(`${oldName}: ${street.id} already has a link`);
  const id = `conn_hf_${b.id.replace(/^zone_/, '')}_${ent}`;
  if (tables.connections.has(id)) throw new Error(`${id} already exists`);
  const c = { a: b.id, b: street.id, blocked: false, dir: ent, id, lockable: false, one_way: false };
  tables.connections.set(id, c);
  touch('connections', id);
  minted.push(id);
  b.flags.world_exit_zone = street.id;
  report.push(`${oldName}: ${x},${y}, door ${ent} onto ${street.name} (${street.id})`);
}

// ── 6. Addresses ────────────────────────────────────────────────────────────
const RENAMES = plan.filter((m) => m.address).map((m) => [m.oldName, m.address]);
const renamed = (s) => {
  for (const [from, to] of RENAMES) if (s === from || s.startsWith(`${from} `)) return to + s.slice(from.length);
  return s;
};
let names = 0;
for (const [t, keys] of [['zones', ['name']], ['maps', ['name']], ['npcs', ['vendor_shop_name']], ['power_zones', ['name']], ['generators', ['name']]]) {
  for (const [file, o] of tables[t]) {
    let hit = false;
    for (const k of keys) if (typeof o[k] === 'string' && renamed(o[k]) !== o[k]) { o[k] = renamed(o[k]); hit = true; }
    if (t === 'zones' && o.flags?.building_name && renamed(o.flags.building_name) !== o.flags.building_name) { o.flags.building_name = renamed(o.flags.building_name); hit = true; }
    if (hit) { touch(t, file); names++; }
  }
}
for (const { b, marker } of plan) if (marker) b.marker = marker;
// docs:prose counts the dash in a name of 30 characters or more, and these three reached 30 on the
// longer street name, so each drops its "The".
for (const [id, name] of [['zone_hf_assets_strong', '3 Hughson Way — Strongroom'], ['zone_util_zone_hf_fit_floor', '7 Hughson Way — Pool Plant'], ['zone_util_zone_wind_day', '11 Hughson Way — Pump Room']]) {
  byId.get(id).name = name;
  tables.power_zones.get(id).name = name;
}
// 5 and 7 are bound to their models by name (NAMED_MODELS in model-registry.js, which carries the same keys).
const MODELS = [['5sorrelway', '5hughsonway'], ['7sorrelway', '7hughsonway']];

// ── 7. Prose ────────────────────────────────────────────────────────────────
const sub = (t, file, keyPath, from, to) => {
  const o = tables[t].get(file);
  if (!o) throw new Error(`${t}/${file} does not exist`);
  const keys = keyPath.split('.');
  const last = keys.pop();
  const holder = keys.reduce((v, k) => v?.[k], o);
  const s = holder?.[last];
  if (typeof s !== 'string' || !s.includes(from)) throw new Error(`${t}/${file} ${keyPath} no longer says: ${from}`);
  holder[last] = s.replace(from, to);
  touch(t, file);
};
const Z = (file, key, from, to) => sub('zones', file, key, from, to);
// The moved facades.
Z('zone_district_894_912', 'description', 'coming down toward the mews', 'coming down toward Hughson Way');
Z('zone_district_894_912', 'description', 'at the bottom of the lowest step, off the mews,', 'at the bottom of the lowest step, off the street,');
Z('zone_district_894_913', 'description', 'wide enough to read from the boulevard', 'wide enough to read from across the road');
Z('zone_district_896_913', 'description', 'set back off Sorrel Way behind', 'set back off Hughson Way behind');
Z('zone_district_897_913', 'description', 'from the far end of Sorrel Way', 'from the far end of Hughson Way');
Z('zone_district_898_911', 'description', 'from Kettle Lane it reads as', 'from Hughson Way it reads as');
Z('zone_district_898_913', 'description', 'faces south across the meadow', 'faces south across the green');
Z('zone_district_898_913', 'description', 'reading 5 KETTLE LANE ·', 'reading 11 HUGHSON WAY ·');
// Their rooms.
Z('zone_hf_terms_hall', 'description', 'glazed on the mews side', 'glazed on the street side');
Z('zone_hf_terms_hall', 'flags.window.name', 'the mews glazing', 'the street glazing');
Z('zone_hf_terms_hall', 'flags.window.description', 'Floor to ceiling along the mews, so the hall is bright and entirely visible from outside. The view is Vetch Mews, which is a made road with nothing on the far side of it yet.',
  'Floor to ceiling along the street, so the hall is bright and entirely visible from outside. The view is Hughson Way and the flowerbeds on the far side of it.');
Z('zone_hf_terms_terrace', 'flags.window.description', 'softens the mews and the green beyond it', 'softens Hughson Way and the green beyond it');
Z('zone_hf_impression_suite', 'flags.window.description', 'out onto the mews on one side and open meadow on the other', 'out onto Hughson Way on one side and the green on the other');
Z('zone_hf_fit_floor', 'description', 'The glass looks out at Vetch Green, which means the view from every machine is of six birches and a bin, and that is genuinely the best view from a gym in this city.',
  "The glass looks north over Hughson Green, so every machine faces a flowerbed and a bench, and that's the best view from a gym in this city.");
Z('zone_hf_fit_floor', 'flags.window.description', 'Vetch Green fills the whole of it.', 'Hughson Green fills the whole of it.');
Z('zone_hf_fit_pool', 'flags.window.description', 'with the Spire away to the north and the wall shut across the south', "with the Spire away to the north and the Coliseum's dome close by on the south side");
Z('zone_hf_grounds_room', 'flags.window.description', 'The whole curve, with Vetch Green on one side and Sorrel Way on the other. From the tables on the green side you can watch the birches doing better than the trees on the street, which is a running argument in here.',
  'The whole curve, with Hughson Green on one side and Hughson Way on the other. From the tables on the green side you can watch the flowerbeds doing better than the trees on the street, which is a running argument in here.');
Z('zone_hf_grounds_gallery', 'flags.window.description', 'Over the wings you get the green, the mews and a slice of the Curtain, and from the far side, the top half of 15 Kerbstone Row.',
  "Over the wings you get the green on one side and the Coliseum's dome on the other.");
Z('zone_wind_day', 'description', 'and the meadow past it', 'and the green past it');
Z('zone_wind_day', 'flags.window.description', 'onto the balcony and the open meadow beyond it', 'onto the balcony and the green beyond it');
Z('zone_wind_balcony', 'description', 'From here the quarter reads as what it is: a new road, a hoarding, three buildings, and a great deal of grass going down to a wall of light. It is quiet enough that you can hear the wall.',
  "Below it are a bench on the green and Hughson Way, and across the road the Coliseum's limestone wall with the dome over it. On a game night you can hear the organ from here.");
// Neighbours.
Z('zone_mulcahy_bar', 'flags.window.description', 'Halcyon Boulevard is outside, and Hughson Green across the corner.', 'Halcyon Boulevard is outside, and the top of Hughson Way round the corner.');
for (const [x, y] of [[887, 921], [891, 921], [895, 921]]) {
  const z = at(x, y);
  if (z.description !== 'A wide new street with nothing much on it yet. Somebody has already parked across two of the bays.') throw new Error(`${x},${y} no longer reads as expected`);
  z.description = 'A wide new street with a strip of garden along the south side. Somebody has already parked across two of the bays.';
  dirtyZone(z);
}
// Furniture and people.
sub('furniture', 'furn_hf_grounds_board', 'description', 'Today it says 5 SORREL WAY.', 'Today it says 5 HUGHSON WAY.');
sub('furniture', 'furn_wind_steamers', 'description', 'They are turned to face the meadow and the wall beyond it.', 'They are turned to face the green and the Coliseum beyond it.');
sub('npcs', 'npc_hf_ferreira', 'chitchat.3', 'looking at the birches', 'looking at the flowerbeds');
sub('npcs', 'npc_hf_marchetti', 'dialogue_tree.root.text_by_relation.first', 'the meadow outside it is a boulevard', 'the green outside it is a boulevard');
sub('npcs', 'npc_hf_salad_okonjo', 'dialogue_tree.gossip.text', 'I draw off the main on Kettle Lane, same as the glasshouse across the road.', 'I draw off the Kettle Lane main, same as the rest of this street.');
sub('npcs', 'npc_wind_marchbank', 'dialogue_tree.gossip.text', 'The land office wants me to buy the plot next door and put another wing on it.', 'The land office wants me to buy a plot off Kettle Lane and open a second house.');

// ── 8. Keepers ──────────────────────────────────────────────────────────────
const worldFacade = (id) => {
  const r = byId.get(id), f = byId.get(r?.parent_zone);
  return !!r && onWorld(f) && !!f.flags?.facade && !f.flags?.set_aside;
};
for (const id of KEEPERS) {
  const n = tables.npcs.get(id);
  if (!n?.flags?.set_aside) throw new Error(`${id} isn't set aside`);
  delete n.flags.set_aside;
  touch('npcs', id);
  if (!worldFacade(n.home_zone) || !worldFacade(n.work_zone_id)) throw new Error(`${id}: home ${n.home_zone} or work ${n.work_zone_id} isn't inside a building on the map`);
  report.push(`${n.name}: back at ${byId.get(byId.get(n.work_zone_id).parent_zone).name}`);
}
for (const { b } of plan) {
  const m = [...tables.maps.values()].filter((mm) => mm.parent_zone_id === b.id);
  if (m.length !== 1) throw new Error(`${b.name}: ${m.length} interior maps`);
  if (byId.get(m[0].entry_zone_id)?.map_id !== m[0].id) throw new Error(`${b.name}: entry room isn't on ${m[0].id}`);
}

// ── 9. Exits from the projected graph ───────────────────────────────────────
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
  const inWindow = (onWorld(z) && z.grid_x >= 884 && z.grid_x <= 912 && z.grid_y >= 900 && z.grid_y <= 924) || z.map_id === HOLD;
  if (!inWindow && !movedIds.has(z.id)) { outside.push(z.id); continue; }
  z.exits = nx;
  dirtyZone(z);
  exitsChanged++;
}

// ── 10. Check the prose, then write ─────────────────────────────────────────
for (const z of zones) {
  if (!dirty.has(`zones/${z.id}`) || !onWorld(z) || z.flags?.facade) continue;
  const words = String(z.description).trim().split(/\s+/).length;
  if (words > 60) throw new Error(`${z.id}: ${words} words`);
  if (String(z.description).includes('—')) throw new Error(`${z.id}: em dash`);
}
for (const r of report) console.log('  ' + r);
console.log(`${plan.length} moved, ${GREEN.length} green tiles dressed, ${GAPS.length} gaps, ${Object.keys(ROAD).length} road; ${minted.length} street links; ${names} files renamed; exits rewritten on ${exitsChanged} tile(s); ${dirty.size} files in all`);
if (outside.length) console.log(`⚠ ${outside.length} tile(s) outside the window disagree with the projection (left alone):`, outside.slice(0, 10));
if (!WRITE) { console.log('\n(dry run; pass --write)'); process.exit(0); }
for (const key of dirty) {
  const [t, file] = key.split('/');
  fs.writeFileSync(path.join(dirOf(t), `${file}.json`), canonicalJson(tables[t].get(file)), 'utf8');
}
for (const [from, to] of MODELS) {
  const p = path.join(dirOf('building_models'), `${from}.json`);
  const m = JSON.parse(fs.readFileSync(p, 'utf8'));
  m.id = to;
  for (const b of m.bind) if (b.key === from) b.key = to;
  fs.writeFileSync(path.join(dirOf('building_models'), `${to}.json`), canonicalJson(m), 'utf8');
  fs.rmSync(p);
}
console.log('✓ written; now run: npm run models:bake');
