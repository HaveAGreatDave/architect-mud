// ONE-SHOT: take up the Hughson Car Park and Hughson Green and build towers on them
// (docs/proposals/hughson-towers.md).
//
//   node scripts/content/hughson-towers.mjs [--write]
//
//         887 888 889 890 891 892 893 894 895 896 897
//  y 909  ===== Halcyon Boulevard ==================
//  y 910   T   T   Y   T   T   R  6HB 8HB INS LND  r
//  y 911   T   T   Y   T   T   R   c   c   c  9HW  r
//  y 912   B   B   +   B   B   R  2HW  c   c   c   r
//  y 913   T   T   Y   T   T   R  SS   c   c 11HW  r
//  y 914   T   T   Y   T   T   R  3HW 5HW 7HW  c   r
//  y 915  ===== Hughson Way ========================
//  y 916   T   T   Y   T   T   R  the park
//  y 917   T   T   Y   T   T   R
//  y 918   E   E   +   E   E   R
//  y 919   T   T   Y   T   T   R
//  y 920   T   T   Y   T   T   R
//  y 921  ===== Sorrel Way =========================
//
// T a tower, Y Yarrow Lane, B Burnet Walk, E Teasel Walk, c Hughson Court (the low block in the old
// courtyard). Every id stays: the tile takes a new role, as the lot's tiles did in coliseum-five.mjs.
//
// The field looks north-west from home plate, so this lot is the whole view over the outfield wall:
// left field is the old car park, centre the old lawn, right the courtyard. The heights follow from
// that. The ridge is the River Road, tallest at the back, and it falls toward the park so the stands
// aren't walled in. The court stays low because it stands in front of the Spire and Halcyon Towers.
//
// The towers are sealed tiles, `is_building` with no `facade`, as the shells are. `authorBuilding`
// can give one a door later without touching its neighbours' streets.
//
// `exits` is rewritten from the projected graph, because content:lint holds the two edge for edge.
// Each prose edit names the text it replaces, so a line that moved under this refuses. It refuses to
// run twice: once 889,912 is a road there's nothing to do.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CONTENT_DIR, canonicalJson } from './lib.mjs';
import { projectEdges } from './derive.mjs';

const WRITE = process.argv.includes('--write');
const WORLD = 'map_world';
const REGION = 'region_coldwater', DISTRICT = 'halcyon_fields';
const dirOf = (t) => path.join(CONTENT_DIR, t);

const tables = {};
for (const t of ['zones', 'connections', 'npcs', 'furniture']) {
  tables[t] = new Map(fs.readdirSync(dirOf(t)).filter((f) => f.endsWith('.json'))
    .map((f) => [f.slice(0, -5), JSON.parse(fs.readFileSync(path.join(dirOf(t), f), 'utf8'))]));
}
const dirty = new Set();
const zones = [...tables.zones.values()];
const onWorld = (z) => z && z.map_id === WORLD && (z.grid_z ?? 0) === 0 && z.grid_x != null;
const cell = new Map();
for (const z of zones) if (onWorld(z)) cell.set(`${z.grid_x},${z.grid_y}`, z);
const at = (x, y) => cell.get(`${x},${y}`);
const dirtyZone = (z) => dirty.add(`zones/${z.id}`);

if (at(889, 912)?.flags?.terrain === 'road') { console.log('889,912 is already a road; nothing to do.'); process.exit(0); }

// ── 1. The plots ────────────────────────────────────────────────────────────
// [x, y, address, building_type, floors, entrance, map code, description]
// A tower bound to its own silhouette in NAMED_MODELS still carries a type its neighbours can read.
const PLOTS = [
  // The ridge on the River Road, its doors on the river side.
  [887, 910, '1 River Road', 'sky_court', 50, 'west', 'Q1', 'Two unequal glass shafts off one podium, tied together by glazed links high up, fifty storeys in all. The upper link is a residents\' lounge, and from the street you can see one person in it.'],
  [887, 911, '3 River Road', 'chrome_tower', 42, 'west', 'Q2', 'Forty-two storeys of glass with sixteen chrome fins running unbroken from the pavement to the parapet. The west flats look through the Curtain at the river, tinted blue, at no extra charge.'],
  [887, 913, '5 River Road', 'chrome_tower', 38, 'west', 'Q3', 'Glass drums stepping in as they rise, thirty-eight storeys, with a chrome ledge at each step. The doorman stands inside the glass and doesn\'t look up.'],
  [887, 914, '7 River Road', 'torque_tower', 34, 'west', 'Q4', 'Floor plates turned a few degrees each on the one below, so the tower has done a quarter turn by the thirty-fourth. The lifts run straight, which took an engineer some years.'],
  [887, 916, '9 River Road', 'chrome_tower', 46, 'west', 'Q5', 'A spindle of glass forty-six storeys tall, with one vast belly halfway up, drawn in at the top and the bottom. The hoarding has come down, and the name of the letting agent has stayed.'],
  [887, 917, '11 River Road', 'chrome_tower', 36, 'west', 'Q6', 'Four glazed drums of flats on one spine, with daylight between them. The gaps are called gardens in the brochure and hold one tree each.'],
  [887, 919, '13 River Road', 'chrome_slab', 44, 'west', 'Q7', 'A tall curved slab, forty-four storeys, turned to catch the sun off the river all afternoon. The glare reaches the Coliseum\'s west stands at about the sixth inning.'],
  [887, 920, '15 River Road', 'chrome_tower', 32, 'west', 'Q8', 'A square chrome tower on the corner of the River Road and Sorrel Way, thirty-two storeys and very plain. It looks like what the others were before anybody got ideas.'],
  // The west side of Yarrow Lane.
  [888, 910, '1 Yarrow Lane', 'chrome_tower', 30, 'east', 'Y1', 'A chrome tower of thirty storeys on the corner of the boulevard. The lobby is lit all night, and the desk in it has a bowl of apples nobody has been seen to take.'],
  [888, 911, '3 Yarrow Lane', 'glass_prism', 24, 'east', 'Y2', 'Six sides of tinted glass drawn up to a point. The top four floors are too narrow to let and hold the plant.'],
  [888, 913, '5 Yarrow Lane', 'bead_tower', 26, 'east', 'Y3', 'Glazed bulges threaded on a chrome spine, pinched to a collar between each. Every flat is curved and no wardrobe in the city fits one.'],
  [888, 914, '7 Yarrow Lane', 'chrome_slab', 22, 'east', 'Y4', 'A plain glass cylinder of twenty-two storeys with one broad chrome band wound round it from the pavement to the roof. The band is a balcony on six floors and a maintenance problem on all of them.'],
  [888, 916, '9 Yarrow Lane', 'chrome_tower', 28, 'east', 'Y5', 'A chrome tower of twenty-eight storeys with a plain glass door and a keypad. A sign on the door says deliveries go round the back, and there is no back.'],
  [888, 917, '11 Yarrow Lane', 'torque_tower', 20, 'east', 'Y6', 'Twenty storeys of turned floor plates, the short one of the family. From Teasel Walk it looks like a stack of plates somebody nudged.'],
  [888, 919, '13 Yarrow Lane', 'torque_tower', 30, 'east', 'Y7', 'Thirty storeys, each turned a little on the last. The window cleaners charge by the corner.'],
  [888, 920, '15 Yarrow Lane', 'chrome_slab', 20, 'east', 'Y8', 'A chrome slab of twenty storeys on Sorrel Way, every blind in it set to the same height. The blinds are in the lease.'],
  // The east side of Yarrow Lane.
  [890, 910, '2 Yarrow Lane', 'torque_tower', 36, 'west', 'Y9', 'A turned tower of thirty-six storeys on the boulevard, its corners catching the light one floor at a time as the sun goes round.'],
  [890, 911, '4 Yarrow Lane', 'chrome_tower', 28, 'west', 'YA', 'A square tower of twenty-eight storeys with its corners cut off, getting wider as it rises. The corner flats went first, and there are eight on a floor.'],
  [890, 913, '6 Yarrow Lane', 'chrome_tower', 30, 'west', 'YB', 'A long glass lozenge on its end, thirty storeys, rounded at both ends as if it might be rolled somewhere. The plaza in front of it is the width of a doormat.'],
  [890, 914, '8 Yarrow Lane', 'bead_tower', 24, 'west', 'YC', 'A string of glass bulges on a chrome spine. On a game night the crowd noise comes up the lane and you can see the residents move to the south side.'],
  [890, 916, '10 Yarrow Lane', 'chrome_tower', 26, 'west', 'YD', 'Flat glazed plates threaded on a chrome spine, twenty-six storeys, each swung out the opposite way from the last. The odd floors and the even floors have separate committees, and the two don\'t speak.'],
  [890, 917, '12 Yarrow Lane', 'chrome_slab', 20, 'west', 'YE', 'A plain chrome slab of twenty storeys. Its east flats are sold on the view of the bleachers and let by people who have never been to a game.'],
  [890, 919, '14 Yarrow Lane', 'glass_prism', 22, 'west', 'YF', 'Six sides of tinted glass rising to a point, twenty-two storeys. The point has an aircraft lamp on it that the Coliseum\'s groundsman says he can read by.'],
  [890, 920, '16 Yarrow Lane', 'cascade_block', 14, 'west', 'YG', 'Four falling masses coming down toward Sorrel Way, each further forward than the one behind. The terraces were planted once, and the planting is still in its pots.'],
  // Hughson Way, the low side, facing the park.
  [891, 910, '13 Hughson Way', 'chrome_slab', 18, 'east', 'U1', 'A chrome slab of eighteen storeys at the top of Hughson Way, turned edge-on to the boulevard so the good side faces the Coliseum.'],
  [891, 911, '15 Hughson Way', 'cascade_block', 12, 'east', 'U2', 'Masses of falling height stepping down to Hughson Way, twelve storeys at the back. Every terrace has one chair on it.'],
  [891, 913, '17 Hughson Way', 'chrome_slab', 16, 'east', 'U3', 'Sixteen storeys of chrome and glass, flat-fronted and quiet. A notice in the lobby asks residents not to wave at the blimp.'],
  [891, 914, '19 Hughson Way', 'atrium_court', 10, 'east', 'U4', 'Two curved wings round a glazed drum, ten storeys, wider than it is tall. The drum is a lobby, and the lobby has a fountain with a rope round it.'],
  [891, 916, '21 Hughson Way', 'cascade_block', 12, 'east', 'U5', 'Stepped terraces coming down to the kerb across from the bleacher gate. On game nights somebody on the fourth step sells the view by the chair and has had two letters about it.'],
  [891, 917, '23 Hughson Way', 'atrium_court', 10, 'east', 'U6', 'Curved wings round a glass drum, straight across from GATE D. The wings keep the noise out, and the brochure says so twice.'],
  [891, 919, '25 Hughson Way', 'chrome_slab', 14, 'east', 'U7', 'A chrome slab of fourteen storeys beside the Coliseum\'s west wall. Its windows on that side are a dark tint, on the ball club\'s request, after a home run.'],
  [891, 920, '27 Hughson Way', 'atrium_court', 8, 'east', 'U8', 'The low end of the block, eight storeys of curved wing on the corner of Sorrel Way. A plate by the door gives the name of a management company and no number.'],
  // Hughson Court, in the old courtyard. Low on purpose: this is the view of the Spire from home plate.
  [893, 911, '1 Hughson Court', 'cascade_block', 7, 'west', 'J1', 'A stepped block on the old courtyard, seven storeys at the back. It fills the gap that used to lead in off Hughson Way.'],
  [894, 911, '2 Hughson Court', 'atrium_court', 6, 'north', 'J2', 'Curved wings behind 8 Halcyon Boulevard, six storeys, built to the plot line on every side. The light reaches the drum at noon and leaves shortly after.'],
  [895, 911, '3 Hughson Court', 'chrome_slab', 8, 'north', 'J3', 'A short chrome slab behind the Halcyon Institute, eight storeys. After dark the magenta from 9 Hughson Way\'s growing trays falls across its east wall.'],
  [894, 912, '4 Hughson Court', 'atrium_court', 6, 'west', 'J4', 'Six storeys of curved wing behind the terraces of 2 Hughson Way. The run-off from the terraces goes down its west wall at six and at seven.'],
  [895, 912, '5 Hughson Court', 'cascade_block', 8, 'south', 'J5', 'Four falling masses in the middle of the court, the tallest of them eight storeys. It has no street, and its post comes through 5 Hughson Way.'],
  [896, 912, '6 Hughson Court', 'chrome_slab', 7, 'east', 'J6', 'A narrow chrome block between 9 and 11 Hughson Way, seven storeys, on a plot no wider than it is. The Cart Yard\'s tarpaulins show across the road.'],
  [894, 913, '7 Hughson Court', 'chrome_slab', 6, 'south', 'J7', 'A chrome block of six storeys behind the Sales Suite, kept off the model in the suite next door.'],
  [895, 913, '8 Hughson Court', 'atrium_court', 6, 'south', 'J8', 'Curved wings along the back of 7 Hughson Way. The gym\'s machines face it, and most of them are empty.'],
  [896, 914, '9 Hughson Court', 'atrium_court', 3, 'south', 'J9', 'Three low storeys of curved wing on the corner where Hughson Way turns north, kept down so the balconies of 11 Hughson Way can still see the Coliseum.'],
];

// ── 2. The lanes ────────────────────────────────────────────────────────────
const YARROW = 'Yarrow Lane, a service street between tower lobbies, with the wind coming down it from the boulevard. Everything here is new and everything is locked.';
const BURNET = 'Burnet Walk, a narrow paved cut between the towers. The light gets down here for about an hour either side of noon.';
const TEASEL = 'Teasel Walk, a narrow paved cut between the towers, with the Coliseum\'s wall closing the view at the east end.';
const LANES = {
  '889,910': ['Yarrow Lane', 'Yarrow Lane leaves Halcyon Boulevard between two towers and runs straight south to Sorrel Way. The wind comes down it hard, and the Coliseum\'s dome shows past the end of Burnet Walk.'],
  '889,911': ['Yarrow Lane', 'Yarrow Lane, with towers up both sides on Halcyon\'s ground lease. Halcyon offered Sir Charles a fortune for this ground three times. He sent each cheque back with two tickets in the envelope, so they rent it.'],
  '889,912': ['Burnet Walk + Yarrow Lane', 'Yarrow Lane crosses Burnet Walk here, where the pond was. A brass plate is set in the paving, moved from the coping: "Sir Charles\'s ground. Please walk on the grass." Nobody has had the heart to take it up.'],
  '889,913': ['Yarrow Lane', YARROW],
  '889,914': ['Yarrow Lane', 'Yarrow Lane, a block from Hughson Way. A car noses along it looking for a car park that isn\'t there any more.'],
  '889,916': ['Yarrow Lane', 'Yarrow Lane, on what was the Hughson Car Park. An attendant\'s folding chair is still chained to a lamp post. Crowd barriers are stacked beside it, ready for game night.'],
  '889,917': ['Yarrow Lane', YARROW],
  '889,918': ['Teasel Walk + Yarrow Lane', 'Yarrow Lane crosses Teasel Walk. East down the walk the Coliseum\'s wall fills the end of the street, and on a game night you can hear the organ from here.'],
  '889,919': ['Yarrow Lane', YARROW],
  '889,920': ['Yarrow Lane', 'The south end of Yarrow Lane, opening onto Sorrel Way. The towers stop here, and past the Recital Hall the meadow runs to the Curtain.'],
  '887,912': ['Burnet Walk', BURNET],
  '888,912': ['Burnet Walk', BURNET],
  '890,912': ['Burnet Walk', BURNET],
  '891,912': ['Burnet Walk', 'The east end of Burnet Walk, with Hughson Way in front of you and the terraces of 2 Hughson Way across it.'],
  '887,918': ['Teasel Walk', 'The west end of Teasel Walk, where it comes out on the River Road and the Curtain\'s hum takes over from the crowd\'s.'],
  '888,918': ['Teasel Walk', TEASEL],
  '890,918': ['Teasel Walk', TEASEL],
  '891,918': ['Teasel Walk', 'The east end of Teasel Walk, straight across Hughson Way from the Coliseum\'s limestone wall.'],
};

// ── 3. The streets that meet them, and the lines that stopped being true ─────
// [x, y, new name or null, old text, new text]
const EDGE = [
  [887, 915, null, 'Hughson Green runs along the north side and the car park along the south.', 'The towers start on both sides.'],
  [888, 915, null, 'between the green and the car park', 'between two rows of towers'],
  [889, 915, 'Hughson Way + Yarrow Lane', 'Benches line the green on the north side, and the car park\'s bays start at the kerb on the south.', 'Yarrow Lane crosses it here, between towers on all four corners.'],
  [890, 915, null, 'between the green and the car park', 'between two rows of towers'],
  [891, 915, null, 'Benches line the green on the north side, and the car park\'s bays start at the kerb on the south.', 'Towers stand along both kerbs, and the Coliseum\'s wall starts past the end of them.'],
  [892, 910, null, 'flowerbeds are on the west', '13 Hughson Way is on the west'],
  [892, 911, null, 'with the green on both sides: the main lawn to the west, and on the east a planted gap leading into the courtyard behind the boulevard.', 'with a stepped block on either side: 15 Hughson Way to the west and Hughson Court to the east, filling the gap that led into the old courtyard.'],
  [892, 912, 'Burnet Walk + Hughson Way', 'with a clipped hedge and flowerbeds along the west side', 'with Burnet Walk going off between the towers on the west side'],
  [892, 913, null, 'A clipped hedge runs along the far kerb.', 'A chrome slab stands on the far kerb.'],
  [892, 914, null, 'and the green on the west', 'and 19 Hughson Way on the west'],
  [892, 918, 'Hughson Way + Teasel Walk', null, null],
  [893, 917, null, 'across from the car park', 'across from the towers'],
  [896, 915, null, 'A corner of the green opens on the north side.', 'A low curved block stands on the north side.'],
  [897, 912, null, 'with flowerbeds on the west side', 'with Hughson Court on the west side'],
  [897, 914, null, 'with a corner of the green on the west side', 'with 9 Hughson Court on the west side'],
  [889, 909, null, 'with Hughson Green open along the south side and the Coliseum\'s dome past the far end of it', 'with Yarrow Lane going off south between the towers'],
  [886, 912, 'Burnet Walk + The River Road', null, null],
  [886, 918, 'The River Road + Teasel Walk', null, null],
  [889, 921, 'Sorrel Way + Yarrow Lane', null, null],
];

// [table, file, path, old text, new text]
const LINES = [
  ['zones', 'zone_district_894_912', 'description', 'From the green you can see', 'From the pavement you can see'],
  ['zones', 'zone_district_898_913', 'description', 'every balcony faces south across the green', 'every balcony faces south at the Coliseum'],
  ['zones', 'zone_sound_foyer', 'flags.window.description', 'the new road and the Coliseum\'s car park beyond it', 'the new road and the towers beyond it'],
  ['zones', 'zone_hf_aspect_lobby', 'flags.window.description', 'if you walk far enough round, the green', 'if you walk far enough round, the dome'],
  ['zones', 'zone_hf_chainfree_u2', 'flags.window.description', 'a slice of the green between two of them', 'a slice of the Coliseum\'s dome between two of them'],
  ['zones', 'zone_hf_fit_floor', 'description', 'The glass looks north over Hughson Green, so every machine faces a flowerbed and a bench, and that\'s the best view from a gym in this city.', 'The glass looks north at Hughson Court, so every machine faces a wall of somebody else\'s curtains.'],
  ['zones', 'zone_hf_fit_floor', 'flags.window.description', 'Hughson Green fills the whole of it.', 'The back of Hughson Court fills the whole of it.'],
  ['zones', 'zone_hf_grounds_gallery', 'flags.window.description', 'you get the green on one side', 'you get the court on one side'],
  ['zones', 'zone_hf_grounds_room', 'description', 'carries out onto the green', 'carries out onto Hughson Way'],
  ['zones', 'zone_hf_grounds_room', 'flags.window.description', 'with Hughson Green on one side and Hughson Way on the other. From the tables on the green side you can watch the flowerbeds doing better than the trees on the street, which is a running argument in here.', 'with Hughson Court on one side and Hughson Way on the other. From the tables on the court side you can watch the people in the next building watching you, which is a running argument in here.'],
  ['zones', 'zone_hf_impression_suite', 'flags.window.description', 'and the green on the other. The view from the desks is of the ground the model says is a boulevard.', 'and the court on the other. The view from the desks is of the road the model says is a boulevard.'],
  ['zones', 'zone_hf_terms_hall', 'flags.window.description', 'the flowerbeds on the far side of it', 'the towers on the far side of it'],
  ['zones', 'zone_hf_terms_terrace', 'flags.window.description', 'Hughson Way and the green beyond it', 'Hughson Way and the towers beyond it'],
  ['zones', 'zone_wind_balcony', 'description', 'Below it are a bench on the green and Hughson Way', 'Below it are a low roof and Hughson Way'],
  ['zones', 'zone_wind_day', 'description', 'the first balcony and the green past it', 'the first balcony and the Coliseum past it'],
  ['zones', 'zone_wind_day', 'flags.window.description', 'onto the balcony and the green beyond it', 'onto the balcony and the Coliseum beyond it'],
  ['furniture', 'furn_wind_steamers', 'description', 'They are turned to face the green and the Coliseum beyond it.', 'They are turned to face the Coliseum.'],
];
// A line inside a larger record, found by its text rather than its path.
const BURIED = [
  ['npcs', 'npc_hf_ferreira', 'She wipes a table on the green side and stands looking at the flowerbeds for a second longer than the job needs.', 'She wipes a table on the court side and stands looking out of the window for a second longer than the job needs.'],
  ['npcs', 'npc_hf_marchetti', 'On the model, the green outside it is a boulevard with trees down the middle.', 'On the model, the road outside it is a boulevard with trees down the middle.'],
];

// ── 4. Apply ────────────────────────────────────────────────────────────────
const lotTile = (z, x, y) => {
  const ok = z && (z.name === 'Hughson Green' || z.name === 'Hughson Car Park');
  if (!ok) throw new Error(`${x},${y} should be green or car park, is ${z?.id} ${z?.name}`);
  for (const c of tables.connections.values()) if (c.a === z.id || c.b === z.id) throw new Error(`${z.id} carries a connection: ${c.id}`);
};

const codes = new Set(zones.map((z) => z.marker).filter(Boolean));
const addresses = new Set(zones.map((z) => z.flags?.building_name).filter(Boolean));
for (const [x, y, name, type, floors, entrance, marker, description] of PLOTS) {
  const z = at(x, y);
  lotTile(z, x, y);
  if (codes.has(marker)) throw new Error(`${name}: map code ${marker} is taken`);
  if (addresses.has(name)) throw new Error(`${name} already exists`);
  codes.add(marker); addresses.add(name);
  z.name = name;
  z.description = description;
  z.marker = marker;
  z.ambient_theme = 'urban';
  z.ambient_events = [];
  z.flags = { building_name: name, building_type: type, district: DISTRICT, entrance, floors, is_building: true, region_id: REGION };
  delete z.color; delete z.bg_color;
  dirtyZone(z);
}

for (const [k, [name, description]] of Object.entries(LANES)) {
  const [x, y] = k.split(',').map(Number), z = at(x, y);
  lotTile(z, x, y);
  z.name = name;
  z.description = description;
  z.ambient_theme = 'city';
  z.ambient_events = [];
  z.flags = { district: DISTRICT, region_id: REGION, scavenging_table_id: 'scav_roadside_junk', street_life: true, terrain: 'road' };
  delete z.color; delete z.bg_color; delete z.marker;
  dirtyZone(z);
}

for (const z of zones) if (onWorld(z) && (z.name === 'Hughson Green' || z.name === 'Hughson Car Park')) throw new Error(`${z.grid_x},${z.grid_y} was left as ${z.name}`);

const swap = (s, from, to, where) => {
  if (typeof s !== 'string' || !s.includes(from)) throw new Error(`${where}: "${from}" not found`);
  return s.replace(from, to);
};
for (const [x, y, name, from, to] of EDGE) {
  const z = at(x, y);
  if (!z) throw new Error(`no tile at ${x},${y}`);
  if (name) z.name = name;
  if (from) z.description = swap(z.description, from, to, `${x},${y}`);
  dirtyZone(z);
}
for (const [t, file, keyPath, from, to] of LINES) {
  const rec = tables[t].get(file);
  if (!rec) throw new Error(`no ${t}/${file}`);
  const keys = keyPath.split('.'), last = keys.pop();
  const obj = keys.reduce((o, k) => o?.[k], rec);
  obj[last] = swap(obj?.[last], from, to, `${file} ${keyPath}`);
  dirty.add(`${t}/${file}`);
}
for (const [t, file, from, to] of BURIED) {
  const rec = tables[t].get(file);
  const walk = (o) => {
    let n = 0;
    for (const k of Object.keys(o)) {
      if (typeof o[k] === 'string' && o[k].includes(from)) { o[k] = o[k].replace(from, to); n++; }
      else if (o[k] && typeof o[k] === 'object') n += walk(o[k]);
    }
    return n;
  };
  if (!walk(rec)) throw new Error(`${file}: "${from}" not found`);
  dirty.add(`${t}/${file}`);
}

// ── 5. Walls, then exits from the projected graph ───────────────────────────
// ⚠ `is_building` doesn't stop the grid. Only a `facade` does, so a sealed tile is walled with a
// blocked connection on every side a neighbour would step in from, as the park's slices are.
const sealed = new Set(PLOTS.map(([x, y]) => at(x, y).id));
const suffix = (a, dir, b) => createHash('sha1').update(`${a}|${dir}|${b}`).digest().readUInt32BE(0).toString(36).padStart(4, '0').slice(-4);
const walled = new Set();
for (const e of projectEdges(zones, [...tables.connections.values()]).edges) {
  if (e.kind !== 'grid' || !(sealed.has(e.from_zone) || sealed.has(e.to_zone))) continue;
  const pair = [e.from_zone, e.to_zone].sort().join('~');
  if (walled.has(pair)) continue;
  walled.add(pair);
  const id = `conn_${e.from_zone.replace(/^zone_/, '')}_${e.direction}_${suffix(e.from_zone, e.direction, e.to_zone)}`;
  if (tables.connections.has(id)) throw new Error(`${id} already exists`);
  tables.connections.set(id, { a: e.from_zone, b: e.to_zone, blocked: true, dir: e.direction, id, lockable: false, one_way: false });
  dirty.add(`connections/${id}`);
}
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
  const inWindow = onWorld(z) && z.grid_x >= 885 && z.grid_x <= 898 && z.grid_y >= 908 && z.grid_y <= 922;
  if (!inWindow) { outside.push(z.id); continue; }
  z.exits = nx;
  dirtyZone(z);
  exitsChanged++;
}

// ── 6. Check the prose, then write ──────────────────────────────────────────
for (const key of dirty) {
  const [t, file] = key.split('/');
  if (t !== 'zones') continue;
  const z = tables.zones.get(file);
  if (!onWorld(z) || z.flags?.facade) continue;
  const words = String(z.description).trim().split(/\s+/).length;
  if (words > 60) throw new Error(`${z.id}: ${words} words`);
  if (String(z.description).includes('—')) throw new Error(`${z.id}: em dash`);
}
const tall = PLOTS.filter((p) => p[4] >= 14).length;
console.log(`${PLOTS.length} buildings (${tall} of 14 storeys or more), ${Object.keys(LANES).length} lane tiles; ${walled.size} walls; exits rewritten on ${exitsChanged} tile(s); ${dirty.size} files`);
if (outside.length) console.log(`⚠ ${outside.length} tile(s) outside the window disagree with the projection (left alone):`, outside.slice(0, 10));
if (!WRITE) { console.log('\n(dry run; pass --write)'); process.exit(0); }
for (const key of dirty) {
  const [t, file] = key.split('/');
  fs.writeFileSync(path.join(dirOf(t), `${file}.json`), canonicalJson(tables[t].get(file)), 'utf8');
}
console.log('✓ written; now bind the models, then run content:import and the bakes');
