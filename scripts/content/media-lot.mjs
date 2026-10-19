/**
 * THE MEDIA LOT, PHASE 1: KSAB's block between Marrow Street, Meltwater Row and Foundry Way, walled
 * like a studio lot (docs/proposals/media-lot.md).
 *
 *   node scripts/content/media-lot.mjs [--dry-run]
 *
 * ⚠ JUST MY TYPE AND WRAP PARTY ARE SET ASIDE, NOT DELETED, as the Coliseum's block, the Kettle three
 * and Meltwater Row's four were (docs/proposals/hughson-coliseum.md §3): each facade moves onto
 * `map_set_aside` with its id, prose, flags, interior and junction box, and its `world_exit_zone`
 * names itself. They sit on row 9 of the holding grid, clear of the Coliseum (rows 1 to 3), the
 * Kettle three (row 5) and Meltwater Row's four (row 7), two columns apart so they don't touch.
 * Birdie Stavros is set aside with her bar.
 *
 * ⚠ PAVEL LUDD MOVES, AND HIS PRESSES GO WITH HIM. He keeps the Sentinel's press now, in a Press
 * Hall off the bullpen. ⚠ NOT IN THE BULLPEN ITSELF: a room a vendor works in is a shop and shuts
 * outside his hours (plugins/commerce/shopdoor.js), and the bullpen is the way to the editor.
 *
 * ⚠ THE TWO FREED TILES TAKE NEW IDS, zone_medialot_<x>_<y>, so no set-aside building's identity is
 * overwritten. They're ground, not buildings: the gate court and the car park, `terrain: concrete`,
 * with `flags.media_lot` saying which part each is, where its gate is and which sides are walled.
 * The flight derive turns that into the `lot` mark (plugins/flight/state.js) and
 * client/game/js/panels/glass/media-lot.js draws it. Content walls the car park on Foundry Way with
 * a blocked connection, which `mint-connections --write` lands.
 *
 * ⚠ THE STAGE AND THE WRITERS' WING TURN ROUND WITH THEIR IDS. Both now open onto the court. A
 * facade's link into its building is the cardinal opposite its entrance and the entry room's way
 * out is the entrance itself (halcyon/lib.mjs), so each facade's connection into its rooms keeps
 * its id (a lock grant is keyed by it) and turns, and the stage's door row turns with it. The
 * Writers' Wing's Story Floor now leaves by the south, so its Script Vault moves to the north.
 * The stage keeps its doorman and box office: they stand on the facade tile, which keeps its id,
 * and plugins/broadcast/audience.js reads them there.
 *
 * Run `node scripts/content/mint-connections.mjs --write` afterwards, then `npm run content:lint`.
 * Idempotent: every id derives from a tile or a slug.
 */
import { loadContentStore } from './halcyon/lib.mjs';

const DRY = process.argv.includes('--dry-run');
const store = loadContentStore();

const HOLD = 'map_set_aside';
const REGION = 'region_coldwater';
const DISTRICT = 'nightlife';
const Z = (x, y) => `zone_district_${x}_${y}`;

const STAGE = Z(912, 911), WRITERS = Z(913, 910), SENTINEL = Z(914, 910);
const STUDIO = 'zone_studio_1782953094650';
const LOBBY = 'zone_ksab_lobby', VAULT = 'zone_ksab_gallery', VAULT_UTIL = 'zone_util_zone_ksab_gallery';
const COURT = 'zone_medialot_913_911', PARK = 'zone_medialot_914_911', BACKLOT = 'zone_medialot_912_910';
const BULLPEN = 'zone_sentinel_bullpen', PRESS = 'zone_sentinel_press';
const LUDD = 'npc_print_ludd', GUARD = 'npc_ksab_gate';

const must = (table, id) => {
  const row = store.get(table, id);
  if (!row) throw new Error(`${table}/${id} does not exist`);
  return row;
};
// A row a fresh import has to accept: every column a neighbour carries, empty where this one says nothing.
const fillLike = (like) => {
  const fill = {};
  for (const k of Object.keys(like)) fill[k] = k === 'flags' || k === 'exits' ? {} : (Array.isArray(like[k]) ? [] : null);
  return fill;
};

// ── 1. SET ASIDE JUST MY TYPE AND WRAP PARTY ──────────────────────────────────────────────────
// [x, y, holding grid x, holding grid y, building name, people set aside with it, and where each sleeps now]
// ⚠ THE DEADLINE WENT ON 2026-10-19, when the whole block was closed off: its tile was the lot's
// only corner with no way in from the court. Corva and Ivor Marrow lived in the Solenne; a set-aside
// keeper has to sleep in a set-aside room, so they move into their bar, and Ivor's residence row on
// Solenne flat A passes to Jerry Rosenberg, who shares it, so the flat doesn't come up for rent.
const SET_ASIDE = [
  [913, 911, 1, 9, 'Just My Type', []],
  [914, 911, 3, 9, 'Wrap Party', [['npc_wrap_stavros', null]]],
  [912, 910, 5, 9, 'The Deadline', [['npc_greenroom_bartender', 'zone_greenroom_lounge'], ['npc_greenroom_guest', 'zone_greenroom_booth']]],
];
{
  const row = store.get('npc_residences', 'zone_solenne_apt_a');
  if (row?.npc_id === 'npc_greenroom_guest') store.put('npc_residences', { ...row, npc_id: 'npc_jerry_rosenberg' });
}
for (const [x, y, gx, gy, name, keepers] of SET_ASIDE) {
  const id = Z(x, y), z = must('zones', id);
  if (z.flags?.building_name !== name) throw new Error(`${id} is "${z.flags?.building_name}", not ${name}; the site has moved since this file was written`);
  if (z.map_id === 'map_world') {
    // Keep only the link into its own rooms.
    const exits = {};
    for (const [dir, to] of Object.entries(z.exits || {})) {
      const t = store.get('zones', to);
      if (t && t.map_id !== 'map_world' && (t.parent_zone === id || store.get('maps', t.map_id)?.parent_zone_id === id)) exits[dir] = to;
    }
    store.put('zones', {
      ...z, map_id: HOLD, grid_x: gx, grid_y: gy, grid_z: 0, exits,
      flags: { ...z.flags, set_aside: true, set_aside_from: `${x},${y}`, world_exit_zone: id },
    });
  }
  for (const [keeper, home] of keepers) {
    const n = must('npcs', keeper);
    store.patch('npcs', keeper, { ...(home ? { home_zone: home } : {}), flags: { ...(n.flags || {}), set_aside: true } });
  }
}

// ── 2. THE LOT'S GROUND ──────────────────────────────────────────────────────────────────────
// Concrete, like The Forecourt at Golden Goose Gardens. `media_lot.wall` names the sides the lot's
// own wall stands on, `gate` the side the gate is in; the derive keeps a wall only where there's no
// exit and a gate only where there is one, so the picture can't disagree with the movement graph.
const like = must('zones', 'zone_district_914_915');
const ground = (id, x, y, name, description, exits, lot) => {
  const prev = store.get('zones', id) || {};
  store.put('zones', {
    ...fillLike(like), ...prev, id, name, description,
    map_id: 'map_world', grid_x: x, grid_y: y, grid_z: 0, parent_zone: null,
    exits, ambient_theme: 'city', ambient_events: prev.ambient_events || [], color: like.color,
    flags: { district: DISTRICT, region_id: REGION, terrain: 'concrete', media_lot: lot },
  });
};
ground(COURT, 913, 911, 'The Media Lot',
  'A swept concrete court inside KSAB\'s gate. The stage door is west under a red ON AIR lamp; the Writers\' Wing is north. The car park opens east. A board by the gatehouse lists the stage, the writers and the paper.',
  { south: Z(913, 912), west: STAGE, north: WRITERS, east: PARK },
  { part: 'court', gate: 's' });
ground(PARK, 914, 911, 'Media Lot Car Park',
  'Painted bays on concrete behind the lot\'s wall. Two KSAB news vans stand nose-out with their masts folded, and the Sentinel\'s van is backed up to the paper\'s loading dock, beside the paper\'s only door. A water tower stands in the corner on four legs, the station\'s disc on its tank.',
  { west: COURT, north: SENTINEL },
  { part: 'parking', wall: 'es' });
// The backlot, where the Deadline stood: the lot's north-west corner, walled on Marrow Street and
// Meltwater Row, and reached round the side of the stage or the Writers' Wing.
ground(BACKLOT, 912, 910, 'Media Lot Backlot',
  'A scene dock behind the lot\'s wall, where the corner bar used to be. Painted flats lean against the render in ranks, a street of shopfronts with nothing behind them, and timber crates stencilled KSAB are stacked by the stage\'s scene door. The Writers\' Wing is east and the stage is south.',
  { south: STAGE, east: WRITERS },
  { part: 'backlot', wall: 'nw' });
// The city grid feeds the new tiles as it fed the old ones.
for (const [x, y, id, name] of [[913, 911, COURT, 'The Media Lot'], [914, 911, PARK, 'Media Lot Car Park'], [912, 910, BACKLOT, 'Media Lot Backlot']]) {
  const pz = store.get('power_zones', Z(x, y));
  if (pz) store.patch('power_zones', id, { ...pz, id, name });
}

// ── 3. THE STAGE TURNS TO FACE THE COURT ─────────────────────────────────────────────────────
{
  const z = must('zones', STAGE);
  store.put('zones', {
    ...z,
    description: 'KSAB\'s sound stage: a blind shell with the call letters across it, one of them dark, and the transmitter mast over the roof. Its doors face into the lot: a scene dock door, the stage door under a red ON AIR lamp, and a box office window with a card taped inside: TICKETS HERE.',
    exits: { east: COURT, west: STUDIO, north: BACKLOT },
    flags: { ...z.flags, entrance: 'east', world_exit_zone: COURT, media_lot: { part: 'building', wall: 'ws' } },
  });
  const s = must('zones', STUDIO);
  const exits = { ...s.exits };
  for (const [d, t] of Object.entries(exits)) if (t === STAGE) delete exits[d];
  exits.east = STAGE;
  // A sound stage has no window onto anything; the stage lights it.
  const flags = { ...s.flags };
  delete flags.window;
  store.put('zones', { ...s, exits, flags });
  must('connections', 'conn_district_913_911_east_wegl');
  store.patch('connections', 'conn_district_913_911_east_wegl', { a: STAGE, b: STUDIO, dir: 'west' });
  must('doors', 'door_shoddy_zone_district_913_911_in');
  store.patch('doors', 'door_shoddy_zone_district_913_911_in', { zone_id: STAGE, exit_dir: 'west', target_zone: STUDIO });
}

// ── 4. THE WRITERS' WING TURNS TO FACE THE COURT ─────────────────────────────────────────────
{
  const z = must('zones', WRITERS);
  store.put('zones', {
    ...z,
    description: 'KSAB\'s Writers\' Wing, its marquee reading WRITERS\' WING · SCRIPT LOCKED 04:00. Through the glass, whiteboards stand in rows, and one desk lamp is burning at an hour when nothing should be. Its door faces into the lot.',
    exits: { south: COURT, north: LOBBY, west: BACKLOT },
    flags: { ...z.flags, entrance: 'south', world_exit_zone: COURT, media_lot: { part: 'building', wall: 'n' } },
  });
  const lobby = must('zones', LOBBY);
  store.put('zones', {
    ...lobby,
    exits: { south: WRITERS, north: VAULT },
    flags: {
      ...lobby.flags,
      window: {
        ...(lobby.flags?.window || {}),
        name: 'the lot window',
        description: 'Full-height glass onto the lot: the swept court, the gatehouse at the gate and the red lamp over the stage door.',
      },
    },
  });
  const vault = must('zones', VAULT);
  store.put('zones', { ...vault, grid_x: 0, grid_y: -1, grid_z: 0, exits: { ...Object.fromEntries(Object.entries(vault.exits || {}).filter(([, t]) => t !== LOBBY)), south: LOBBY } });
  const util = must('zones', VAULT_UTIL);
  store.put('zones', { ...util, grid_x: 0, grid_y: -1 });
  must('connections', 'conn_district_913_910_south_373a');
  store.patch('connections', 'conn_district_913_910_south_373a', { a: WRITERS, b: LOBBY, dir: 'north' });
}

// ── 5. THE STREETS ROUND THE LOT ─────────────────────────────────────────────────────────────
// Nothing on the world points at a set-aside facade, and the old street doors into the stage and
// the Writers' Wing close. Foundry Way's link north at the gate is the court's now.
{
  const gone = new Set(SET_ASIDE.map(([x, y]) => Z(x, y)));
  const turned = new Set([STAGE, WRITERS, SENTINEL]);
  for (const z of store.all('zones')) {
    if (z.map_id !== 'map_world' || z.id === COURT || z.id === PARK || z.id === BACKLOT || turned.has(z.id)) continue;
    const exits = { ...(z.exits || {}) };
    let changed = false;
    for (const [dir, to] of Object.entries(exits)) if (gone.has(to) || turned.has(to)) { delete exits[dir]; changed = true; }
    if (changed) store.patch('zones', z.id, { exits });
  }
  const gate = must('zones', Z(913, 912));
  store.patch('zones', gate.id, { exits: { ...gate.exits, north: COURT } });
}
const STREETS = [
  [913, 912, 'Foundry Way at KSAB\'s gate: two rendered piers with the station\'s name on a slab between them, a raised barrier arm, and a round gatehouse with a lamp in it. The lot\'s wall runs east past a water tower. Tyre tracks turn in under the barrier.'],
  [914, 912, 'Foundry Way along the wall of KSAB\'s car park, a storey of cream render with a cyan stripe at its foot. A water tower stands up behind it, the station\'s disc on the tank. Grit drifts against the wall.'],
  [911, 911, 'Meltwater Row beside KSAB\'s sound stage, a long blind wall with the lot\'s other buildings behind it. The stage\'s doors are round the back, inside the lot; the gate is on Foundry Way. Puddles stand in the ruts.'],
  [913, 909, 'Marrow Street along the back of KSAB\'s Writers\' Wing, with the lot\'s wall running either side of it, cream render with a cyan stripe at its foot. Every door on the block is inside the wall, through the gate on Foundry Way.'],
  [912, 909, 'Marrow Street at the corner of KSAB\'s lot. The wall turns here, cream render over a dark plinth, and painted flats show over the coping behind it. A dead neon bracket on the wall is the last of the bar that stood on the corner. Puddles stand in the ruts.'],
  [914, 909, 'Marrow Street outside the Coldwater Sentinel, its gilt masthead over a front door bricked up and rendered over. A card in the old counter window sends deliveries round to the KSAB gate on Foundry Way. Somebody dragged a mattress halfway across the road and gave up.'],
  [911, 910, 'Meltwater Row along the wall at the back of KSAB\'s lot, cream render with a cyan stripe, the tops of painted flats showing over it. A dead streetlight leans at the verge, and the wind carries grit that finds your teeth.'],
];
for (const [x, y, description] of STREETS) { must('zones', Z(x, y)); store.patch('zones', Z(x, y), { description }); }

// ── 5b. THE SENTINEL TURNS TO FACE THE CAR PARK ──────────────────────────────────────────────
// 2026-10-19: every door on the block opens inside the wall. The Sentinel's door is the one by its
// dock now. Its link into the bullpen keeps its id and turns north, the bullpen leaves by the
// south, and the press hall (step 6) moves to the bullpen's north.
{
  const z = must('zones', SENTINEL);
  store.put('zones', {
    ...z,
    description: 'The Coldwater Sentinel\'s back door, beside the loading dock where its van backs in: a steel door under a lamp, stencilled NO PARKING. Through a wired window, a wall of feed-screens flickers through headlines, and a printer inside never stops chattering.',
    exits: { south: PARK, north: BULLPEN },
    flags: { ...z.flags, entrance: 'south', world_exit_zone: PARK, media_lot: { part: 'building', wall: 'ne' } },
  });
  must('connections', 'conn_district_914_910_south_v3gs');
  store.patch('connections', 'conn_district_914_910_south_v3gs', { a: SENTINEL, b: BULLPEN, dir: 'north' });
  must('doors', 'door_basic_zone_district_914_910_in');
  store.patch('doors', 'door_basic_zone_district_914_910_in', { zone_id: SENTINEL, exit_dir: 'north', target_zone: BULLPEN });
  const b = must('zones', BULLPEN);
  store.put('zones', {
    ...b,
    flags: { ...b.flags, window: { ...(b.flags?.window || {}), name: 'the yard window', description: 'A wired pane onto the lot\'s car park: the paper\'s van at the dock, KSAB\'s vans in their bays and the water tower over the wall.' } },
  });
}

// ── 6. THE SENTINEL'S PRESS HALL, AND PAVEL LUDD IN IT ──────────────────────────────────────
{
  const bullpen = must('zones', BULLPEN);
  const prev = store.get('zones', PRESS) || {};
  store.put('zones', {
    ...fillLike(bullpen), ...prev,
    id: PRESS, name: 'Press Hall',
    description: 'The Sentinel\'s press hall, behind the bullpen. The paper\'s rotary press takes up most of it, a train of steel drums fed off a reel of newsprint. Pavel Ludd\'s flatbed stands by the back wall with its twin under a sheet, a drying line strung over both. The type cases are by the door.',
    ambient_theme: 'indoors', ambient_events: prev.ambient_events || [], bg_color: '#221f1a',
    map_id: bullpen.map_id, parent_zone: SENTINEL, grid_x: 0, grid_y: -1, grid_z: 0,
    exits: { south: BULLPEN },
    flags: {
      building_name: 'Coldwater Sentinel', building_type: 'office', floor: 'concrete',
      is_building: true, is_interior: true, world_exit_zone: SENTINEL,
    },
  });
  {
    const exits = Object.fromEntries(Object.entries(must('zones', BULLPEN).exits || {}).filter(([, t]) => t !== PRESS && t !== SENTINEL));
    store.patch('zones', BULLPEN, { exits: { ...exits, south: SENTINEL, north: PRESS } });
  }
  // The press hall is Ludd's counter, so its door is a shop door that shuts outside his hours.
  const conn = 'conn_sentinel_bullpen_south_press';
  store.put('connections', { id: conn, a: BULLPEN, b: PRESS, dir: 'north', blocked: false, lockable: true, one_way: false });
  const shopDoor = must('doors', 'door_shop_justmytype_floor');
  store.put('doors', {
    ...shopDoor,
    id: 'door_shop_sentinel_press', connection_id: conn, zone_id: BULLPEN, exit_dir: 'north', target_zone: PRESS,
    tags: { 'lock:shoplock': { canHack: true, difficulty: 4, messages: {
      denied: 'The press hall lock reads your hand and declines to recognise it.',
      lock: 'The bolt drops and the press hall door shuts.',
      unlock: 'The bolt lifts. The press hall door swings in.',
    } } },
  });
  const pz = must('power_zones', BULLPEN);
  store.patch('power_zones', PRESS, { ...pz, id: PRESS, name: 'Coldwater Sentinel Press Hall' });
  const lamp = must('furniture', 'furn_light_zone_sentinel_bullpen');
  store.put('furniture', {
    ...lamp, id: `furn_light_${PRESS}`, zone_id: PRESS, name: 'press hall lamps',
    description: 'Caged lamps on chains over the press, hung low enough to read a proof by.',
    light_type: 'overhead', lumen_output: 2600,
  });
  const fixture = must('furniture', 'furn_justmytype_1');
  store.put('furniture', {
    ...fillLike(fixture),
    id: 'furn_sentinel_rotary', zone_id: PRESS, name: 'the rotary press', object_type: 'fixture',
    description: 'The Sentinel\'s own press: a train of steel cylinders in a frame the length of a bus, fed off a reel of newsprint taller than a man. It runs once a night for the morning edition, and the bullpen floor shakes while it does.',
    flags: { notable: true, aliases: ['rotary press', 'rotary', 'cylinders', 'newsprint', 'reel'] },
    power_draw_kw: 12, price: 0,
  });
  store.put('furniture', {
    ...fillLike(fixture),
    id: 'furn_sentinel_jobboard', zone_id: PRESS, name: 'the jobbing board', object_type: 'decoration',
    description: 'A painted board on the press hall door, in Ludd\'s hand: handbills, running orders, setlists, menus, wreath cards, writs. The last line is priced separately, in smaller letters.',
    flags: { notable: true, aliases: ['board', 'jobbing board', 'list', 'prices'] },
    power_draw_kw: 0, price: 0,
  });
  // His own presses, the drying line and the type cases go with him.
  for (const id of ['furn_justmytype_1', 'furn_justmytype_2', 'furn_justmytype_3', 'furn_justmytype_4']) {
    must('furniture', id);
    store.patch('furniture', id, { zone_id: PRESS });
  }

  const ludd = must('npcs', LUDD);
  const tree = JSON.parse(JSON.stringify(ludd.dialogue_tree));
  const swap = (node, key, from, to) => {
    const v = tree[node]?.[key];
    if (typeof v !== 'string') throw new Error(`Ludd's ${node}.${key} is missing`);
    if (v.includes(to)) return v;
    if (!v.includes(from)) throw new Error(`Ludd's ${node}.${key} no longer says "${from}"`);
    return v.replace(from, to);
  };
  tree.root.text = swap('root', 'text',
    '"Board outside is what we do and it\'s in order of how much of it we do."',
    '"Board on the door is what I do on the side, in order of how much of it I do."');
  {
    const v = tree.root.text_by_relation?.first;
    if (typeof v !== 'string') throw new Error('Ludd\'s first greeting is missing');
    let w = v;
    if (!w.includes('Board on the door is the list')) {
      if (!w.includes('Board outside is the list')) throw new Error('Ludd\'s first greeting no longer names the board');
      w = w.replace('Board outside is the list', 'Board on the door is the list');
    }
    if (!w.includes('The big one\'s the paper\'s')) {
      if (!w.includes('"Two presses. This one runs.')) throw new Error('Ludd\'s first greeting no longer counts his presses');
      w = w.replace('"Two presses. This one runs.', '"The big one\'s the paper\'s, and I run it at night. These two are mine. This one runs.');
    }
    tree.root.text_by_relation = { ...tree.root.text_by_relation, first: w };
  }
  store.put('npcs', {
    ...ludd, dialogue_tree: tree,
    home_zone: PRESS, work_zone_id: PRESS, vendor_shop_name: 'Sentinel Press Hall',
  });
}

// ── 7. DOT KOWALCZYK ON THE GATE ─────────────────────────────────────────────────────────────
// Company, not a law: the gate stops nobody (media-lot.md §8, decision 6). She keeps hours on the
// vendor graph with nothing to sell, as Orsino Tull does at the stage door, so the court is never a
// shop and never shuts. She shares Meridian 404 with the Ration Nine cook; its residence row is his.
{
  const doorman = must('npcs', 'npc_ksab_doorman');
  const day = [{ from: 6, to: 22 }];
  store.put('npcs', {
    id: GUARD, name: 'Dot Kowalczyk', sex: 'female', npc_type: 'civilian', faction: null,
    hp: 60, hp_max: 60,
    description: 'A short woman in her sixties in a navy guard\'s blazer with KSAB\'s disc on the pocket, a cardigan buttoned under it. Reading glasses hang on a cord against her chest. She has a visitors\' book open on the gatehouse ledge and a pen on a chain, and she looks up at everyone who comes through the gate.',
    home_zone: 'zone_meridian_unit_404', work_zone_id: COURT,
    behaviour_graph: JSON.parse(JSON.stringify(doorman.behaviour_graph)),
    chitchat: [
      'Dot waves a news van through and writes its number in the book.',
      'She turns a page in the visitors\' book and runs a finger down it.',
      'A delivery rider asks for the Sentinel. She points east without looking up.',
      'She tries the gatehouse lamp, off and on again, and leaves it on.',
      'A buzzer goes somewhere behind the stage door. Dot checks her watch and writes the time down.',
    ],
    dialogue_tree: {
      root: {
        text: '"Sign the book." She turns the visitors\' book round and holds out the pen on its chain. "Stage is west, writers straight on, car park through on the right."',
        text_by_relation: {
          first: '"Dot." She doesn\'t get up. "I do the gate. Everybody signs the book, including the people who own the building." She turns it round for you. "Stage is west, writers straight on, and the car park\'s through on the right."',
          known: '"You again." She has the book turned round before you reach the booth.',
          familiar: '"Go on through." She writes your name in the book herself.',
        },
        options: [
          { label: 'What is this place?', next: 'lot' },
          { label: 'Where\'s the stage door?', next: 'stage' },
          { label: 'Can I park here?', next: 'park' },
          { label: 'Where\'s the bar?', next: 'bar' },
        ],
      },
      lot: {
        text: '"KSAB\'s lot. The stage, the writers and the car park." She nods at the wall to the east. "The paper\'s next door. They rent bays for their vans and walk through here to get to them, and they sign the book like everybody else."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      stage: {
        text: '"West side of the court, under the red lamp. When the lamp\'s lit they\'re taping, and Orsino on the door will want a pass. The box office is the window beside him."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      park: {
        text: '"Bays are for the station\'s vans and the paper\'s." She looks past you at the street. "If you\'ve brought a rig, there\'s room at the back. Keep it off the paper\'s dock or the morning edition doesn\'t go out."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      bar: {
        text: '"There was one, on the corner. The Deadline." She nods at the backlot. "Station wanted the ground for scenery, so it\'s flats now. The crews drink wherever\'s open when the shift finishes, and the shift doesn\'t finish."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      bye: {
        text: '"Sign out on your way past," she says, already writing.',
        options: [],
      },
    },
    banter: [], home_activities: [],
    flags: {
      personality: 'guard',
      clothing_layers: [
        'a navy guard\'s blazer with KSAB\'s disc on the breast pocket',
        'a grey cardigan, buttoned to the neck',
        'a white blouse with a frayed collar',
        'a plain bra and cotton knickers',
      ],
    },
    studio_zone_id: null,
    vendor_inventory: [], vendor_restock_rate: doorman.vendor_restock_rate, vendor_stock_size: doorman.vendor_stock_size,
    vendor_shop_name: null,
    vendor_schedule: { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day },
    wander_zones: [], wanders: 0,
  });
}

const written = store.flush({ dryRun: DRY });
console.log(`${DRY ? 'DRY RUN: ' : ''}${written.length} file(s) ${DRY ? 'would be written' : 'written'}`);
for (const p of written) console.log('  ' + p.replace(store.baseDir, 'content'));
console.log('\nnext:\n  node scripts/content/mint-connections.mjs --write\n  npm run content:lint');
