/**
 * GROUNDS FOR CONCERN, REBUILT: the corner café on Greenside Row, with a car park and a garden
 * where Pill Collins and Ohm Sweet Ohm stood.
 *
 *   node scripts/content/grounds-for-concern.mjs [--dry-run]
 *
 * Three tiles on the south side of Greenside Row, between Fine Print (903,908) and Meltwater Row:
 *
 *   904,908   GREENSIDE GARDENS, a small park on Pill Collins' plot (`zone_greenside_904_908`).
 *   905,908   GREENSIDE CAR PARK, the café's car park on Ohm Sweet Ohm's plot
 *             (`zone_greenside_905_908`), a walkable tile drawn by the `car_park` arm.
 *   906,908   GROUNDS FOR CONCERN, rebuilt in place under its old slug: the café, a roastery behind
 *             it and the cellar, with its own GLASS arm (`groundscafe`).
 *
 * ⚠ THE TWO SHOPS ARE SET ASIDE, NOT DELETED, the way set-aside-kettle-three.mjs did it the same
 * day (docs/proposals/stored-buildings.md): each facade moves whole onto `map_set_aside` with its id,
 * interior, furniture and door, its `world_exit_zone` names itself, and new tiles with new ids take
 * the plots. Both keepers live in buildings that stay, so they aren't set aside; their
 * `work_zone_id` goes to null, as Basil Quennell's did.
 *
 * ⚠ TEODOR SKENE WAS THE ONLY SELLER OF SIGNAL BOARDS, which six SPECTER recipes need, and of drone
 * cores and loyalty chips. His six salvage lines go to the Clinkerman at Slag & Wares, so nothing
 * becomes uncraftable when his stall goes.
 *
 * ⚠ THE CAFÉ KEEPS ITS OLD CONNECTION FILES. `authorBuilding` writes `conn_hf_*` files for every
 * link it makes, and two files on one pair project the same edge twice and break the import on
 * `zone_edges_pkey`. Where a pair already has a file, the new one is removed after the flush and
 * the old one is kept (its id belongs to it; see mint-connections.mjs).
 *
 * Run `node scripts/content/mint-connections.mjs --write` and `npm run content:lint` afterwards.
 * Idempotent.
 */
import fs from 'node:fs';
import path from 'node:path';
import { authorBuilding, loadContentStore } from './halcyon/lib.mjs';

const DRY = process.argv.includes('--dry-run');
const store = loadContentStore();
const HOLD = 'map_set_aside';
const tile = (x, y) => `zone_district_${x}_${y}`;
const NAME = 'Grounds for Concern';
const CAFE = tile(906, 908);
const GARDEN = 'zone_greenside_904_908', LOT = 'zone_greenside_905_908';

// ── 1. SET ASIDE PILL COLLINS AND OHM SWEET OHM ─────────────────────────────────────────────
// [x, y, holding grid x, y, keeper]. The holding grid's row 5 holds the Kettle three at 1, 3, 5.
const SETS = [[904, 908, 7, 5, 'npc_perpetua_lisk'], [905, 908, 9, 5, 'npc_amp_proprietor']];
for (const [x, y, gx, gy, keeper] of SETS) {
  const id = tile(x, y), z = store.get('zones', id);
  if (!z) throw new Error(`${id} does not exist`);
  if (z.map_id === 'map_world') {
    const exits = {};
    for (const [dir, to] of Object.entries(z.exits || {})) {
      const t = store.get('zones', to);
      if (t && t.map_id !== 'map_world' && t.parent_zone === id) exits[dir] = to;
    }
    const flags = { ...z.flags, set_aside: true, set_aside_from: `${x},${y}`, world_exit_zone: id };
    store.put('zones', { ...z, map_id: HOLD, grid_x: gx, grid_y: gy, grid_z: 0, exits, flags });
  }
  store.patch('npcs', keeper, { work_zone_id: null });
}
// Nothing on the world points at either facade any more.
const gone = new Set(SETS.map(([x, y]) => tile(x, y)));
for (const z of store.all('zones')) {
  if (z.map_id !== 'map_world') continue;
  const exits = { ...(z.exits || {}) };
  let changed = false;
  for (const [dir, to] of Object.entries(exits)) if (gone.has(to)) { delete exits[dir]; changed = true; }
  if (changed) store.patch('zones', z.id, { exits });
}

// Teodor's stall stock that nobody else sells, at the Clinkerman's prices for salvage.
{
  const n = store.get('npcs', 'npc_clinkerman');
  if (!n) throw new Error('npc_clinkerman does not exist');
  const inv = [...(n.vendor_inventory || [])];
  for (const [item_id, price] of [['item_loyalty_chip', 12], ['item_glowing_scrap', 15], ['item_cracked_circuit', 18],
    ['item_depleted_battery', 20], ['item_signal_board', 62], ['item_drone_core', 170]]) {
    if (!inv.some((i) => i.item_id === item_id)) inv.push({ item_id, price });
  }
  store.patch('npcs', 'npc_clinkerman', { vendor_inventory: inv });
}

// ── 2. THE GARDEN AND THE CAR PARK ──────────────────────────────────────────────────────────
const like = store.get('zones', 'zone_district_908_910');   // Fisherman's Green, for the column set
const blank = () => {
  const fill = {};
  for (const k of Object.keys(like)) fill[k] = k === 'flags' || k === 'exits' ? {} : (Array.isArray(like[k]) ? [] : null);
  return fill;
};
const ground = (id, x, y, o) => {
  store.put('zones', {
    ...blank(), ...(store.get('zones', id) || {}), id, name: o.name, description: o.description,
    map_id: 'map_world', grid_x: x, grid_y: y, grid_z: 0, parent_zone: null,
    ambient_theme: o.theme, ambient_events: o.events, ...(o.color ? { color: o.color } : {}),
    exits: o.exits, flags: { district: 'filaments', region_id: 'region_coldwater', street_life: true, ...o.flags },
  });
  const pz = store.get('power_zones', tile(x, y));
  if (pz) store.patch('power_zones', id, { ...pz, id, name: o.name });
};
ground(GARDEN, 904, 908, {
  name: 'Greenside Gardens', theme: 'urban', color: '#8fd08a',
  description: 'A small public garden off Greenside Row: two benches, a gravel path and beds of something hardy. The brick wall of Fine Print is on the west side and the café\'s car park on the east. A square of paler turf by the path marks where the chemist\'s step was.',
  events: [
    'Somebody sits on the end of a bench with a paper cup and both hands round it.',
    'A pigeon works its way along the gravel path, checking every stone.',
    'The smell of roasting coffee comes over from the café and settles in the beds.',
  ],
  exits: { north: tile(904, 907), south: tile(904, 909), east: LOT },
  flags: { terrain: 'park', park_feature: 'benches' },
});
ground(LOT, 905, 908, {
  name: 'Greenside Car Park', theme: 'urban', color: '#5a5f62',
  description: 'Five bays of fresh tarmac beside Grounds for Concern, lined in white with a concrete stop at the head of each. A blue sign on a post reserves it for customers. A lamp post stands by the entrance off Greenside Row, and bollards close the far end at Voss Avenue.',
  events: [
    'A car noses into a bay, stops, and the driver sits for a minute with the engine off before getting out.',
    'A delivery van stops across two bays with its hazards on.',
    'Somebody comes out of the café with a tray of cups and walks them to a car with the window down.',
  ],
  exits: { north: tile(905, 907), south: tile(905, 909), west: GARDEN },
  flags: { terrain: 'asphalt', building_name: 'Greenside Car Park', building_type: 'car_park', entrance: 'north', floors: 1 },
});
// The streets either side, and back.
for (const [id, dir, to] of [[tile(904, 907), 'south', GARDEN], [tile(904, 909), 'north', GARDEN],
  [tile(905, 907), 'south', LOT], [tile(905, 909), 'north', LOT]]) {
  const z = store.get('zones', id);
  store.patch('zones', id, { exits: { ...(z.exits || {}), [dir]: to } });
}

// ── 3. GROUNDS FOR CONCERN ──────────────────────────────────────────────────────────────────
const spec = {
  slug: 'grounds', name: NAME, type: 'coffee_shop',
  x: 906, y: 908, entrance: 'north', floors: 1, marker: 'GC', district: 'filaments',

  facade: {
    bgColor: '#291f1a', color: '#e8c89a',
    description: 'A one-storey brick café on the corner of Greenside Row and Meltwater Row, glazed along both streets under a green and cream striped awning. A white cup the size of a water tank stands on the roof and steams when they roast. Two tables out front, and the car park to the west.',
  },

  rooms: [
    { key: 'cafe', name: 'The Café', floor: 'boards',
      description: 'Six tables and a zinc counter, with a two-group lever machine on it that is worth more than the lease. Photographs of the green hang on every wall, all slightly crooked. A shelf by the window holds board games with taped corners and an honesty jar. The roastery is through the back.',
      window: {
        name: 'the front window',
        description: 'Plate glass onto Greenside Row with the name across it in gold leaf, backwards from in here. The awning keeps the rain off the two tables outside.',
        light: 0.85, visibility: 0.85,
      } },
    { key: 'roastery', name: 'The Roastery', floor: 'concrete', from: 'cafe', dir: 'south',
      description: 'A narrow back room taken up by a drum roaster on cast-iron legs, its cooling tray out front and its flue going up through the ceiling. Jute sacks of green beans are stacked to the window. A scale, a heat sealer and a roll of bags stand on the bench.',
      window: {
        name: 'the back window',
        description: 'A small window onto Voss Avenue, filmed brown on the inside from years of roasting.',
        light: 0.5, visibility: 0.3,
      } },
  ],

  utility: {
    name: 'The Cellar', floor: 'concrete',
    description: 'A low cellar under the café, smelling of coffee and damp. Spare sacks stand on pallets off the floor and the water heater ticks in the corner. The junction box is on the wall by the steps.',
  },

  lights: {
    roastery: { name: 'the strip light', description: 'A caged fluorescent tube over the roaster, its plastic diffuser gone brown from the heat.', lumens: 1800 },
  },

  props: [
    { key: 'counter', room: 'cafe', name: 'the counter', objectType: 'fixture',
      description: 'A zinc-topped counter with a glass case of butter tarts at one end and a knock box at the other. The zinc is dented where the portafilters get banged out.',
      flags: { aliases: ['counter', 'zinc', 'case', 'glass case', 'knock box'] } },
    { key: 'machine', room: 'cafe', name: 'the lever machine', objectType: 'fixture',
      description: 'A two-group lever espresso machine in chrome and green enamel, older than anybody who works here. Pulling a shot takes both hands and most of your weight.',
      flags: { aliases: ['machine', 'lever machine', 'espresso machine', 'lever rig', 'rig', 'lever', 'levers'] } },
    { key: 'tables', room: 'cafe', name: 'the tables', objectType: 'furniture',
      description: 'Six small tables with marble tops on iron bases. No two of the chairs match.',
      flags: { aliases: ['table', 'tables', 'chair', 'chairs'], interactions: ['sit'] } },
    { key: 'photos', room: 'cafe', name: 'the photographs', objectType: 'decoration',
      description: 'Framed photographs of the green in rain, snow, fog and one clear day, taken by regulars. Every one hangs slightly crooked and none of them are for sale.',
      flags: { aliases: ['photographs', 'photos', 'photo', 'pictures', 'gallery', 'frames'],
        examine_detail: 'On the back of the clear-day one, in pencil: "Acid rain twenty minutes later. Worth it."' } },
    { key: 'games', room: 'cafe', name: 'the games shelf', objectType: 'decoration',
      description: 'A shelf of board games by the window, every box taped at the corners. The chess set is short a white bishop and uses a salt cellar instead.',
      flags: { aliases: ['shelf', 'games', 'board games', 'games shelf', 'chess', 'chess set'] } },
    { key: 'jar', room: 'cafe', name: 'the honesty jar', objectType: 'decoration',
      description: 'A pickle jar with HONESTY BOX written on a strip of tape, half full of coins and two buttons.',
      flags: { aliases: ['jar', 'honesty jar', 'honesty box', 'pickle jar'] } },
    { key: 'board', room: 'cafe', name: 'the chalk board', objectType: 'decoration',
      description: 'An A-board that goes out by the door in the morning. Four things are chalked on it in a confident hand, and three of them have been rubbed out. The one left says FILTER.',
      flags: { aliases: ['board', 'chalk board', 'chalkboard', 'a-board', 'menu', 'sign'] } },
    { key: 'till', room: 'cafe', name: 'the till', objectType: 'fixture',
      description: 'A brass till under the counter that rings like a bicycle bell. The drawer is padlocked at closing.',
      flags: { aliases: ['till', 'drawer', 'cash drawer', 'register'], vendor_safe: true, vendor_npc_id: 'npc_tobiah_gresh', hack_difficulty: 3 } },
    { key: 'roaster', room: 'roastery', name: 'the roaster', objectType: 'fixture',
      description: 'A twelve-kilo drum roaster on cast-iron legs, the drum turning behind a little glass port. A cooling tray stirs the beans on the front. The flue goes up through the ceiling to the cup on the roof.',
      flags: { aliases: ['roaster', 'drum', 'drum roaster', 'cooling tray', 'tray', 'port', 'flue'] } },
    { key: 'sacks', room: 'roastery', name: 'the sacks', objectType: 'decoration',
      description: 'Jute sacks of green coffee stacked to the window, stencilled with farm names and weights in kilos. The top one has been slit open and taped shut again.',
      flags: { aliases: ['sacks', 'sack', 'beans', 'green beans', 'jute', 'coffee'] } },
    { key: 'bench', room: 'roastery', name: 'the bagging bench', objectType: 'fixture',
      description: 'A steel bench with a scale, a heat sealer and a roll of foil bags printed with the café\'s name in brown.',
      flags: { aliases: ['bench', 'bagging bench', 'scale', 'sealer', 'heat sealer', 'bags'] } },
    { key: 'sink', room: 'roastery', name: 'the sink', objectType: 'sink',
      description: 'A deep steel sink with a hose on the tap, for the milk jugs and the roaster\'s chaff tray.',
      flags: { aliases: ['sink', 'tap', 'hose', 'basin'], water_source: true, interactions: ['lean'] } },
  ],

  items: [
    { id: 'item_butter_tart', name: 'butter tart', type: 'consumable', value: 4, weight: 90,
      description: null, flags: {},
      tags: { consumable: true, stackable: true, restore_hunger: 9,
        description: 'A short pastry case filled with butter, brown sugar and egg, set soft in the middle. Whether it should have raisins is argued about here, and the answer is no.' } },
  ],

  npc: {
    id: 'npc_tobiah_gresh', name: 'Tobiah Gresh', sex: 'male', hp: 21,
    homeRoom: 'cafe', workRoom: 'cafe', shopName: NAME,
    description: 'A young man with a burn scar across one forearm in the exact shape of a steam wand. His canvas apron has gone dark down the front. He moves between the machine and the tables without hurrying, and he smells of the roast.',
    clothing: [
      'a canvas apron gone dark at the front',
      'a rolled-sleeve work shirt',
      'a pair of boxers',
    ],
    // The roaster goes on at half five and the door opens at six.
    schedule: Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [{ from: 6, to: 17 }]])),
    inventory: [
      { item_id: 'item_drug_coffee', price: 5 },
      { item_id: 'item_drink_bishops_blend', price: 20 },
      { item_id: 'item_cold_brew_can', price: 10 },
      { item_id: 'item_butter_tart', price: 4 },
      { item_id: 'item_dripping_bread', price: 9 },
      { item_id: 'item_coffee_grounds', price: 12 },
      { item_id: 'item_chicory_sachet', price: 5 },
      { item_id: 'item_chipped_mug', price: 4 },
    ],
    chitchat: [
      '"I can do it without the chicory, but I want it on record that you asked."',
      'taps out a puck, knocks the basket twice, and starts again from the beginning',
      '"The board says four things. Three of them are rubbed out. That is the menu."',
      'wipes down a table nobody has sat at yet, then does the one beside it',
      '"The roaster goes on at half five. I have had the conversation. It goes on at half five."',
      'carries two cups out to a car in the car park and comes back drying his hands on his apron',
    ],
    dialogue: {
      root: {
        text: [
          '"What can I get you?" He is already reaching for a cup.',
          'He looks up from the machine. "Take a table, I\'ll bring it over."',
        ],
        text_by_relation: {
          first: '"Tobiah." He puts down the jug. "Roast is done on the premises, which you will already know if you live anywhere near here and have ears."',
          known: '"Usual?" He is halfway to making it before you answer, which is a small kindness and also efficient.',
          familiar: '"Sit down." He nods at the window table, which he keeps free longer than he should.',
        },
        options: [
          { label: 'Let\'s see what you\'ve got.', next: '__shop__' },
          { label: 'What\'s good?', next: 'good' },
          { label: 'Tell me about the roaster.', next: 'roaster' },
          { label: 'What happened next door?', next: 'nextdoor' },
          { label: 'Another time.', next: 'bye', enabled: true, actions: [], conditions: [] },
        ],
      },
      good: {
        text: '"Bishop\'s Blend, if you\'ve got a minute to sit with it. House roast on the lever rig, short and thick." He nods at the case. "And a butter tart. No raisins. Don\'t start."',
        options: [
          { label: 'Go on, then.', next: '__shop__' },
          { label: 'Back up.', next: 'root' },
        ],
      },
      roaster: {
        text: '"Twelve-kilo drum, out the back. It goes on at half five because that\'s when the beans want it." He points at the ceiling. "The flue comes out through the cup on the roof. People think the cup is steaming. It\'s the roast."',
        options: [{ label: 'Back up.', next: 'root' }],
      },
      nextdoor: {
        text: '"The chemist and Teodor\'s stall went the same month. Perpetua retired, and Teodor sold his boards to the Clinkerman at Slag & Wares." He shrugs. "The landlord put a car park on one and grass on the other. I got the car park."',
        options: [
          { label: 'Where do I get medicine now?', next: 'chemist' },
          { label: 'Back up.', next: 'root' },
        ],
      },
      chemist: {
        text: '"Dosed & Confused, on Tallow Row. Sabra keeps the same drawers Perpetua did, near enough, and she\'s open later."',
        actions: [{ action: 'GPS_TO', zone: 'zone_district_917_911' }],
        options: [{ label: 'Back up.', next: 'root' }],
      },
      bye: { text: '"Right you are."', options: [] },
    },
  },
};

const ids = await authorBuilding(store, spec);

// Room names without the dash, which docs:prose counts on anything 30 characters or longer.
for (const [id, n] of [['zone_grounds_cafe', NAME], ['zone_grounds_roastery', `${NAME} Roastery`], ['zone_util_zone_grounds_cafe', `${NAME} Cellar`]]) {
  store.patch('zones', id, { name: n });
}
// He lives in Unit 4 of the Filament Buildings, which he shares with Perpetua Lisk.
store.patch('npcs', 'npc_tobiah_gresh', { home_zone: 'zone_filament_unit_4', flags: {
  ...(store.get('npcs', 'npc_tobiah_gresh').flags || {}), personality: 'vendor',
} });
// `authorUtilityRoom` only lights the anchor on insert, so the old fixture keeps its id.
store.patch('furniture', 'furn_light_zone_grounds_cafe', {
  name: 'the pendant lamps',
  description: 'Enamel pendant lamps on long flexes, one over each table, and a strip light under the counter.',
});
// The name is a pun, so the board says what it sells under it (building-styles.md §4.6).
store.patch('zones', CAFE, { flags: { ...store.get('zones', CAFE).flags, sign_trade: 'COFFEE' } });
store.patch('zones', CAFE, { ambient_events: [
  'The roaster inside reaches some threshold and the smell of it rolls out across the road.',
  'A chair is dragged out from under a table outside with a long scrape and somebody sits down heavily.',
  'Steam goes up from the cup on the roof and drifts off over Meltwater Row.',
] });
// The cellar's stair is two-way now the café has its `down` (it had none, so the cellar was
// reachable only from below). The old file keeps the pair.
store.patch('connections', 'conn_util_zone_grounds_cafe_up_fv8z', { one_way: false });

const written = store.flush({ dryRun: DRY });

// The pairs that already had a file before `authorBuilding` wrote a second one.
const removed = [];
for (const [neu, old] of [['conn_hf_district_906_908_south', 'conn_district_906_908_south_rz25'],
  ['conn_hf_grounds_cafe_down', 'conn_util_zone_grounds_cafe_up_fv8z']]) {
  const p = path.join(store.baseDir, 'connections', `${neu}.json`);
  if (fs.existsSync(path.join(store.baseDir, 'connections', `${old}.json`)) && fs.existsSync(p)) {
    if (!DRY) fs.unlinkSync(p);
    removed.push(neu);
  }
}
console.log(`${DRY ? 'DRY RUN: ' : ''}${written.length} file(s), ${removed.length} duplicate connection(s) dropped`);
console.log(`  facade ${ids.facadeId}  map ${ids.mapId}  utility ${ids.utilityRoomId}`);
console.log('\nnext:\n  node scripts/content/mint-connections.mjs --write\n  npm run content:lint');
