/**
 * THE FISH WORKS: the Codfather becomes the place Coldwater's fish is landed and cut, with Batter
 * Days Fish & Chips built onto its front.
 *
 *   node scripts/content/fish-works.mjs [--dry-run]
 *
 * Six tiles move at once:
 *
 *   903,904   THE FISH QUAY: a timber quay over the water behind the works, two berths for the
 *             boats that bring the catch in. The works' landing hall opens north onto it.
 *   903,905   THE CODFATHER: no longer a shop. A tin-clad works with no name on it anywhere, where
 *             the catch is weighed, gutted and iced. Its only street door is the staff door, east
 *             onto the car park. Ignatius Fawle buys fish at the weigh-in.
 *   904,905   THE STAFF CAR PARK, where Slag & Wares stood.
 *   902,905   SLAG & WARES, moved one tile west of the works onto Cinder Yard, interior and keepers
 *             and all.
 *   903,906   BATTER DAYS FISH & CHIPS, moved from Ironside Street onto Filament Yard. Its door is
 *             south onto Greenside Row and its prep room opens straight into the cutting floor, so
 *             the two buildings read as one.
 *   918,907   UNIT 5, IRONSIDE STREET: Batter Days' old unit, boarded up and to let as a storefront.
 *
 * ⚠ THE ROOMS MOVE, THEY ARE NOT REBUILT. Batter Days keeps `zone_batter_*`, its keeper, its six
 * dishes and the city's only public smoker and charcoal grill (`furn_smoker_drum`,
 * `furn_charcoal_grill`), because the slug it was built under is the same. The Codfather keeps
 * `zone_codfather_slab` and `zone_codfather_ice` the same way. Their exits are cleared first:
 * `authorBuilding` MERGES a room's exits, so a moved room would keep its way back to the old tile.
 *
 * ⚠ SLAG & WARES IS MOVED BY HAND, NOT RE-AUTHORED. Its rooms, furniture and two keepers stay as
 * they are; only what names the tile changes (the facade, every room's `parent_zone` and
 * `world_exit_zone`, the map, the door and the door's connection).
 *
 * ⚠ THE CROSS-BUILDING LINKS ARE WRITTEN AFTER BOTH `authorBuilding` CALLS, the Palais's reason:
 * `authorUtilityRoom` walks the exits to decide what its junction box feeds, and with the link in
 * place either box would claim both buildings.
 *
 * Supersedes scripts/content/batter-days.mjs, which built the shop on Ironside Street.
 *
 * Idempotent: every id derives from a slug or a tile, and each deletion only fires while the file
 * still says what it used to.
 */
import fs from 'node:fs';
import path from 'node:path';
import { authorBuilding, loadContentStore } from './halcyon/lib.mjs';

const DRY = process.argv.includes('--dry-run');
const store = loadContentStore();

const tile = (x, y) => `zone_district_${x}_${y}`;
const COD = 'The Codfather';
const BATTER = 'Batter Days Fish & Chips';
const VACANT = 'Unit 5, Ironside Street';

const QUAY = tile(903, 904), WORKS = tile(903, 905), LOT = tile(904, 905);
const SLAG_OLD = tile(904, 905), SLAG = tile(902, 905);
const SHOP = tile(903, 906), OLD_SHOP = tile(918, 907);

const conn = (id, a, b, dir, { blocked = false, lockable = false } = {}) =>
  store.patch('connections', id, { id, a, b, dir, blocked, lockable, one_way: false });
const exitsOf = (id) => ({ ...(store.get('zones', id)?.exits || {}) });
const setExit = (id, dir, to) => {
  const e = exitsOf(id);
  if (to) e[dir] = to; else delete e[dir];
  store.patch('zones', id, { exits: e });
};
// Drop every exit on `id` that points at `target`.
const unlink = (id, target) => {
  const e = exitsOf(id);
  for (const [d, t] of Object.entries(e)) if (t === target) delete e[d];
  store.patch('zones', id, { exits: e });
};

// ── 1. SLAG & WARES, ONE TILE WEST ──────────────────────────────────────────
//
// Only done while the junkyard still stands on 904,905, so a re-run leaves it where it went.
{
  const old = store.get('zones', SLAG_OLD);
  if (old?.flags?.building_name === 'Slag & Wares') {
    const cinder = store.get('zones', SLAG);
    const flags = { ...old.flags, district: 'filaments', world_exit_zone: tile(902, 906) };
    store.patch('zones', SLAG, {
      name: old.name, description: old.description, marker: old.marker,
      ambient_theme: old.ambient_theme, ambient_events: old.ambient_events || [],
      ...(old.bg_color ? { bg_color: old.bg_color } : {}), ...(old.color ? { color: old.color } : {}),
      exits: { south: tile(902, 906), north: 'zone_slag_shop' },
      flags: { ...flags, region_id: cinder.flags.region_id || 'region_coldwater' },
    });
    for (const id of ['zone_slag_shop', 'zone_slag_back', 'zone_util_zone_slag_shop']) {
      const z = store.get('zones', id);
      store.patch('zones', id, { parent_zone: SLAG, flags: { ...z.flags, world_exit_zone: SLAG } });
    }
    setExit('zone_slag_shop', 'south', SLAG);
    store.patch('maps', 'map_int_slag', { parent_zone_id: SLAG });
    store.patch('connections', 'conn_district_900_903_west_1dcb', { a: SLAG });
    store.patch('doors', 'door_shop_slag_shop', { zone_id: SLAG });
  }
  // A facade takes no side doors: Cinder Yard's link north to the beach goes.
  unlink(tile(902, 904), SLAG);
  setExit(tile(902, 906), 'north', SLAG);
}

// ── 2. THE STAFF CAR PARK ───────────────────────────────────────────────────
//
// ⚠ `terrain: road`, for Moor or Less's reason: `streetFor` refuses an entrance whose neighbour is
// not a road, and the works' only street door opens onto this.
{
  const flags = { region_id: 'region_coldwater', district: 'filaments', terrain: 'road',
    building_type: 'staff_lot', entrance: 'south', floors: 1, street_life: true };
  store.patch('zones', LOT, {
    name: 'The Codfather: Staff Car Park',
    description: 'A square of cracked tarmac with four bays painted on it, two of them taken by vans with the backs open and ice water running out. A lamp post stands in the corner. On the west side a steel door with a push bar is propped open on a fish box, and a hose lies across the step.',
    ambient_theme: 'urban',
    ambient_events: [
      'Somebody in wellingtons comes out of the steel door, lights a cigarette and goes back in before it is finished.',
      'A van backs into a bay, beeping, and the driver starts throwing boxes of ice into the back.',
      'Water runs out of the open van and across the tarmac to the drain.',
      'A gull stands on the lamp post and watches the door.',
    ],
    color: '#5a5f62',
    map_id: 'map_world', parent_zone: null,
    exits: { south: tile(904, 906), north: tile(904, 904), east: tile(905, 905), west: WORKS },
    flags,
  });
  // The junkyard's map code goes with it. ⚠ OMIT the key, never null it (content:lint).
  { const z = store.get('zones', LOT); delete z.marker; store.put('zones', z); }
  // Every neighbour points back. 904,906 already does.
  setExit(tile(904, 904), 'south', LOT);
  setExit(tile(905, 905), 'west', LOT);
  setExit(tile(904, 906), 'north', LOT);
}

// ── 3. THE FISH QUAY ────────────────────────────────────────────────────────
//
// ⚠ PAINTED WATER AND STANDABLE, the Inner Stage's four flags (`pier`, `liquid: false`,
// `swimmable: false`, `routable`), so a hull can come alongside and a player can walk off it.
// `marina_berths: 2` is what lets a boat tie up here today; the fishing boats will use the same
// berths. `yard_rate` is Moor or Less's, because a berth here is priced off the same list.
{
  const prev = store.get('zones', QUAY);
  const flags = { ...(prev.flags || {}), region_id: 'region_coldwater', district: 'docks',
    terrain: 'water', building_type: 'fish_quay', entrance: 'south', floors: 1,
    pier: true, liquid: false, swimmable: false, routable: true, street_life: true,
    marina_berths: 2, yard_rate: 0.6, fishing_table_id: 'fish_coldwater_bay' };
  delete flags.scavenging_table_id;
  store.patch('zones', QUAY, {
    name: 'The Codfather: The Fish Quay',
    description: 'A timber quay on piles behind the fish works, the planks weathered grey-brown and white with gull mess. Two berths along the edge with tyres for fenders, a hand crane on a post for swinging boxes ashore, and a stack of empty fish boxes. A roller door south leads into the works.',
    ambient_theme: 'coast',
    ambient_events: [
      'The hand crane creaks round on its post in the wind.',
      'A gull lands on the box stack, looks inside the top one, and leaves disappointed.',
      'Water slaps up between the planks and runs back down.',
      'Inside the roller door a hose starts up, and somebody whistles over it.',
    ],
    color: '#5c5040',
    exits: { north: tile(903, 903), east: tile(904, 904), west: tile(902, 904), south: 'zone_codfather_weigh' },
    flags,
  });
  setExit(tile(903, 903), 'south', QUAY);
  setExit(tile(904, 904), 'west', QUAY);
  setExit(tile(902, 904), 'east', QUAY);
}

// ── 4. THE CODFATHER, AS A WORKS ────────────────────────────────────────────

// Clear the moved rooms' exits, or the merge keeps the old way out (see the header).
for (const id of ['zone_codfather_slab', 'zone_codfather_ice', 'zone_batter_shop', 'zone_batter_prep']) {
  if (store.get('zones', id)) store.patch('zones', id, { exits: {} });
}
// The old facade's links, all of which the new ones replace.
store.patch('zones', WORKS, { exits: {} });

const works = await authorBuilding(store, {
  slug: 'codfather', name: COD, type: 'fish_works',
  x: 903, y: 905, entrance: 'east', floors: 3, marker: 'FM', district: 'filaments',
  utilityAnchor: 'slab',

  facade: {
    bgColor: '#1b2226', color: '#8fa4ac',
    description: 'A three-storey works with no name on it anywhere: brick below, tin above with frosted strip windows, and a glazed lantern along the roof by the refrigeration plant. Its front is built onto the back of Batter Days. The only door this side is a steel staff door onto the car park, propped open on a fish box.',
  },

  rooms: [
    { key: 'slab', name: 'The Cutting Floor', floor: 'tile',
      description: 'A long tiled room, cold and wet, with a steel gutting table down the middle and hoses on reels above it. Workers in rubber aprons gut and fillet in a line without talking. One tile on the wall has a painted fish on it. The landing hall is north, the cold store west, and a swing door south goes through to the chip shop.',
      window: null },
    { key: 'weigh', name: 'The Landing Hall', floor: 'concrete', from: 'slab', dir: 'north',
      description: 'A high shed with a roller door open onto the quay. Boxes of fish come in off the boats here and go onto a brass scale by the door, and the weight is chalked on the box. A wooden drawer under the scale holds the cash. Boat crews wait their turn with their catch.',
      window: { name: 'the roller door',
        description: 'The roller door is up. Past it are the quay, two berths and the grey water of the Basin.',
        light: 0.8, visibility: 0.9 } },
    { key: 'ice', name: 'The Cold Store', floor: 'concrete', from: 'slab', dir: 'west',
      description: 'A cold room stacked to the ceiling with wooden boxes on slatted racks, each chalked with a name and a time. A mound of crushed ice sits in the corner under a tarpaulin with a shovel in it. The floor falls to a drain in the middle.',
      window: null },
  ],

  utility: {
    name: 'The Plant Room', floor: 'concrete',
    description: 'A low room under the cutting floor, thumping with the icemaker and smelling of brine. Pipes run up through the ceiling to the cold store. The junction box is on the wall at the foot of the steps.',
  },

  lights: {
    weigh: { name: 'the shed lamps', description: 'Three enamel shades on long flexes over the scale, swinging a little when the roller door lets the wind in.', lumens: 1800 },
    ice: { name: 'the caged lamp', description: 'One caged lamp over the door. The room is cold, and nobody stays in it longer than they have to.', lumens: 900 },
  },

  props: [
    { key: 'line', room: 'slab', name: 'the gutting table', objectType: 'fixture',
      description: 'A steel table the length of the room with a lip round the edge and a gutter down the middle that runs to the drain. Knives hang on a magnetic strip above each place.',
      flags: { aliases: ['table', 'gutting table', 'line', 'knives', 'gutter'] } },
    { key: 'hoses', room: 'slab', name: 'the hose reels', objectType: 'fixture',
      description: 'Red hose reels bolted along the wall at head height, one to every two places at the table. The floor under them never dries.',
      flags: { aliases: ['hose', 'hoses', 'reels', 'reel'] } },
    { key: 'crew', room: 'weigh', name: 'the boat crews', objectType: 'decoration',
      description: 'Three or four men in oilskins sitting on upturned boxes by the roller door, waiting for the scale. They talk about weather and prices and nothing else.',
      flags: { aliases: ['crews', 'crew', 'fishermen', 'men', 'oilskins'] } },
    { key: 'door', room: 'weigh', name: 'the roller door', objectType: 'fixture',
      description: 'A corrugated roller door, rolled up into its drum, with a chain hanging down the side to lower it. The bottom rail is dented where boxes have hit it.',
      flags: { aliases: ['roller door', 'door', 'shutter', 'chain'] } },
  ],
});

// The old fittings, kept and moved to where the work is now.
store.patch('furniture', 'furn_cod_slab', {
  name: 'the marble slab',
  description: 'The marble slab from when the place was a shop, now at the end of the gutting table. It is worn into a dish at one end, and the best fish is laid out on it for Gil.',
  flags: { aliases: 'slab,marble,ice', interactions: ['examine'] },
});
store.patch('furniture', 'furn_cod_scale', {
  zone_id: 'zone_codfather_weigh',
  description: 'A brass scale on a bracket by the roller door, the dial glass gone yellow. It reads a quarter of an ounce heavy in the seller\'s favour, and has since Fawle\'s father set it.',
});
store.patch('furniture', 'furn_cod_till', {
  zone_id: 'zone_codfather_weigh',
  description: 'A wooden drawer under the scale with no lock on it, divided into four with strips of tin. The wood round the pull has gone soft and pale from wet hands.',
});
store.patch('furniture', 'furn_cod_tile', {
  description: 'One tile at eye level has a fish painted on it unlike any other in the works, or in the Basin. It was here when the tiles went up.',
});
store.patch('furniture', 'furn_light_zone_codfather_slab', {
  name: 'the strip lights',
  description: 'Rows of cold white tubes in tin troughs over the gutting table, angled down so the fish is the brightest thing in the room.',
});
store.patch('furniture', 'furn_cod_compressor', {
  zone_id: works.utilityRoomId,
  description: 'The icemaker, on rubber feet, thumping. A service card wired to its guard gives two dates a year. It has failed once, for two days, and Fawle still talks about what that cost.',
});

// No sign anywhere: the kit's FISHMONGER board went with the shop.
{
  const f = { ...store.get('zones', WORKS).flags };
  delete f.sign_trade;
  store.patch('zones', WORKS, { flags: f });
}

// The staff door locks when the works shuts, the same shop lock the old front had.
store.patch('doors', 'door_shop_codfather_slab', {
  zone_id: WORKS, exit_dir: 'west', target_zone: 'zone_codfather_slab',
  connection_id: `conn_hf_${WORKS.replace(/^zone_/, '')}_west`,
  tags: { 'lock:shoplock': { canHack: true, difficulty: 4, messages: {
    denied: 'The staff door lock reads your hand and declines to recognise it.',
    lock: 'The bolt drops. Inside, the icemaker keeps thumping.',
    unlock: 'The bolt lifts. The steel door swings out on a wall of cold air.' } } },
});

// Fawle: the weigh-in, not the slab. He buys what the boats bring in.
{
  const n = store.get('npcs', 'npc_cod_fawle');
  store.patch('npcs', 'npc_cod_fawle', {
    work_zone_id: 'zone_codfather_weigh',
    description: 'A heavy-shouldered man in his fifties in a rubber apron over a collar and tie. His hands are red to the wrist. He weighs every box himself, pays cash out of the drawer, and is courteous to everyone and generous to no one.',
    vendor_shop_name: COD,
    flags: { ...(n.flags || {}), fish_buyer: true },
    chitchat: [
      'Fawle swings a box onto the scale, reads the dial and chalks the weight on the side.',
      'He lifts a fish out of a box by the gill, looks at its eye, and puts it back.',
      '"Off the boat at four. Not off the boat yesterday and kept. There is a difference and it is the whole business."',
      'He counts notes out of the drawer into a fisherman\'s wet hand.',
      '"Don\'t bring me anything glowing. There\'s a man in the Yards who\'ll buy that and he\'s welcome to it."',
      'The icemaker downstairs changes note. He glances at the floor and relaxes about three-quarters of the way.',
      'He chalks a time on a box and sends it through to the cold store.',
      '"Gil gets the best of it. He\'s fifteen feet away. Nobody in the city eats fresher fish than his customers, and they don\'t know it."',
    ],
    dialogue_tree: {
      root: {
        text: '"Morning." He doesn\'t look up from the scale. "If you\'ve got fish, put it on the scale. If you want fish, I\'ve got some."',
        text_by_relation: {
          first: 'A man in a rubber apron and a tie looks up from the scale.\n\n"Fawle. This is the Codfather, or what\'s left of it." He nods at the boxes. "I buy what the boats bring in and I pay properly for it. Anything you\'ve caught yourself, whole and raw, I\'ll take. What\'s it to be?"',
          known: '"You again." He wipes his hands. "Selling or buying?"',
          familiar: '"Put it on the scale," he says, already reaching for the chalk.',
        },
        options: [
          { label: 'I\'ve got fish to sell.', next: 'sell' },
          { label: 'What have you got?', next: '__shop__' },
          { label: 'Where\'s the shop gone?', next: 'shop' },
          { label: 'How fresh is fresh?', next: 'fresh' },
          { label: 'Your scale reads heavy.', next: 'scale' },
          { label: 'Hear anything worth hearing?', next: 'gossip' },
          { label: 'Just looking.', next: 'bye', enabled: true, actions: [], conditions: [] },
        ],
      },
      sell: {
        text: '"Whole and raw, straight off the line." He taps the scale pan. "Carp, bass, pike, razorgill, the big sturgeon if you\'re lucky. I pay near twice what the corner shop will, because I know what it\'s worth and they don\'t."\n\n"<b>sell</b> it to me and the money comes out of the drawer. Cooked fish I don\'t want. Boots I definitely don\'t want."',
        options: [
          { label: 'Show me what you\'d pay.', next: '__shop__' },
          { label: 'Back.', next: 'root' },
        ],
      },
      shop: {
        text: '"Gil has the front now." He jerks his head south, at the swing door. "He fries it, I land it, and we share a wall. I sold on the street for thirty years and I don\'t miss the street."\n\n"I took the name off the fascia when he moved in. My grandfather painted it. My mother hasn\'t forgiven me."',
        options: [
          { label: 'Why did your grandfather call it that?', next: 'name' },
          { label: 'Back.', next: 'root' },
        ],
      },
      name: {
        text: 'He closes his eyes briefly.\n\n"There was a film. He saw it, he came home, he had a man in on the Monday with a brush, and it was up there sixty years." He picks up the chalk. "I have heard every joke you are about to make. Including the one you think nobody has thought of."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      fresh: {
        text: '"The time on the box is when it came out of the water," he says, "not when it came in here. Anybody can tell you when it came in here."\n\n"Everything that goes wrong with a fish starts the minute it stops swimming. So it comes off the boat, onto the scale, onto the ice, and onto Gil\'s range by the afternoon."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      scale: {
        text: '"A quarter of an ounce heavy," he says. "In your favour. My father set it that way and told me not to correct it."\n\nHe flicks the pan and it rings.\n\n"Nobody who sells to me has ever stood here watching the dial and wondering. That\'s worth more than the fish I\'ve paid for twice."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      gossip: {
        text: '"Every boat crew in the Basin is in here before six," he says. "They\'re tired and pleased with themselves, and they tell me things."',
        actions: [{ action: 'GOSSIP_TELL' }],
        options: [{ label: 'Back.', next: 'root' }],
      },
      bye: {
        text: '"Right you are. Mind the floor, it\'s wet."',
        options: [],
      },
    },
  });
}

// ── 5. BATTER DAYS, ON THE FRONT OF THE WORKS ───────────────────────────────

store.patch('zones', SHOP, { exits: {} });

const shop = await authorBuilding(store, {
  slug: 'batter', name: BATTER, type: 'chip_shop',
  x: 903, y: 906, entrance: 'south', floors: 3, marker: 'BT', district: 'filaments',

  facade: {
    bgColor: '#13243a', color: '#f08a2a',
    description: 'A chip shop painted harbour blue, with orange awnings over a wide lit window and BATTER DAYS in orange across the front. Two floors of flats sit above it, with a bay window over the door. Picnic tables stand under the awnings. A steel flue up the back breathes steam, and behind it the fish works carries straight on.',
  },

  rooms: [
    { key: 'shop', name: 'The Shop', floor: 'tile',
      description: 'A blue-and-white tiled room with a steel counter across the back and a hot cabinet on it, the battered fish lined up gold under its lamps. Three fryers sit under a hood behind it. A menu board hangs over the range. The tables are out east, under the awnings, and the prep room is through the back.',
      window: {
        name: 'the shop window',
        description: 'The wide front window onto Greenside Row, fogged from the inside to head height. Through the clear strip at the top you can see the awnings and the picnic tables.',
        light: 0.8, visibility: 0.45,
      } },
    { key: 'prep', name: 'The Prep Room', floor: 'tile', from: 'shop', dir: 'north',
      description: 'A narrow back room with a drain in the floor and the walls tiled to shoulder height. A drum peeler stands beside a wall chipper, and potato sacks are stacked to the ceiling. A drum smoker and a charcoal grill stand by the extractor. A swing door north goes straight into the fish works.',
      window: null },
    { key: 'tables', name: 'The Tables', floor: 'concrete', from: 'shop', dir: 'east',
      description: 'Four timber picnic tables on the pavement under the orange awnings, out of the rain and not out of the wind. Salt and vinegar stand on each one. Gulls patrol the kerb. You can see along Greenside Row both ways from here.',
      window: {
        name: 'the street',
        description: 'Greenside Row, from under the awnings. Traffic, puddles, and the gulls waiting for somebody to drop a chip.',
        light: 1, visibility: 1,
      } },
  ],

  utility: {
    name: 'The Cellar', floor: 'concrete',
    description: 'A low cellar under the shop, cold and smelling of old oil. Drums of fryer fat stand in two rows, clean on the left and used on the right. The junction box is on the wall at the foot of the steps.',
  },

  lights: {
    prep: { name: 'the strip light', description: 'A single fluorescent tube in a cage over the prep table, with a fly paper hanging from it that nobody has changed.', lumens: 1500 },
    tables: { name: 'the festoon lights', description: 'A string of round bulbs under the awning, two of them gone, warm against the blue paint.', lumens: 900, type: 'string' },
  },

  props: [
    { key: 'range', room: 'shop', name: 'the fryers', objectType: 'fixture',
      description: 'Three deep fryers in brushed steel under an extractor hood, each with a wire basket hooked on its side. A card on the hood reads STAFF ONLY. THIS MEANS YOU.',
      flags: { aliases: ['fryer', 'fryers', 'range', 'hood', 'baskets', 'oil'] } },
    { key: 'cabinet', room: 'shop', name: 'the hot cabinet', objectType: 'fixture',
      description: 'A glass cabinet on the counter with heat lamps in its roof. Battered fish, sausages and a tray of loose scraps sit on the racks, all of it the same gold.',
      flags: { aliases: ['cabinet', 'hot cabinet', 'glass', 'counter', 'lamps'] } },
    { key: 'board', room: 'shop', name: 'the menu board', objectType: 'decoration',
      description: 'An orange board over the range: FISH SUPPER, CHIPS, SAUSAGE, PEAS, PICKLED EGG, SCRAPS. The prices are in marker on strips of tape.',
      flags: { aliases: ['board', 'menu', 'menu board', 'prices'],
        examine_detail: 'Under the tape on the fish, the first price is still legible. It was half what it is now.' } },
    { key: 'shelf', room: 'shop', name: 'the condiment shelf', objectType: 'decoration',
      description: 'A shelf under the window with a steel salt shaker, a glass bottle of malt vinegar with a dented cap, and a squeeze bottle of brown sauce.',
      flags: { aliases: ['shelf', 'salt', 'vinegar', 'sauce', 'brown sauce', 'condiments'] } },
    { key: 'bench', room: 'shop', name: 'the bench', objectType: 'furniture',
      description: 'A wooden bench along the side wall, its seat worn pale by people waiting for their number.',
      flags: { aliases: ['bench', 'seat'], interactions: ['sit', 'lean'] } },
    { key: 'cashbox', room: 'shop', name: 'the till', objectType: 'fixture',
      description: 'An old steel till under the counter, the drawer held shut with a padlock when the shop closes.',
      flags: { aliases: ['till', 'drawer', 'cash drawer'], vendor_safe: true, vendor_npc_id: 'npc_batter_fryer', hack_difficulty: 3 } },
    { key: 'peeler', room: 'prep', name: 'the peeler', objectType: 'fixture',
      description: 'A drum peeler on legs with a rough lining, plumbed to the drain. A sack of potatoes goes in the top and comes out of the hatch peeled and slightly smaller.',
      flags: { aliases: ['peeler', 'drum', 'rumbler'] } },
    { key: 'chipper', room: 'prep', name: 'the chipper', objectType: 'fixture',
      description: 'A cast-iron chipper bolted to the wall at chest height, with a lever as long as your arm and a grid of blades that pushes a whole potato through in one pull.',
      flags: { aliases: ['chipper', 'lever', 'blades'] } },
    { key: 'table', room: 'prep', name: 'the prep table', objectType: 'fixture',
      description: 'A steel table with a lip round the edge, a tub of batter on it under a damp cloth and a whisk standing up in the tub.',
      flags: { aliases: ['prep table', 'batter', 'tub'] } },
    { key: 'sink', room: 'prep', name: 'the sink', objectType: 'sink',
      description: 'A deep steel sink with a tall swan-neck tap, for rinsing potatoes by the sackful.',
      flags: { aliases: ['sink', 'tap', 'basin'], water_source: true, interactions: ['lean'] } },
    { key: 'picnic', room: 'tables', name: 'the picnic tables', objectType: 'furniture',
      description: 'Four timber picnic tables with the benches built on, painted blue once and weathered grey on top. Somebody has carved a fish into the end of one.',
      flags: { aliases: ['tables', 'table', 'picnic table', 'picnic tables', 'benches', 'bench'], interactions: ['sit', 'lean'] } },
    { key: 'awnings', room: 'tables', name: 'the awnings', objectType: 'decoration',
      description: 'Orange canvas awnings on steel arms along the front and side of the shop, with a scalloped edge. Rain runs off the front in a line onto the pavement.',
      flags: { aliases: ['awning', 'awnings', 'canvas'] } },
    { key: 'bin', room: 'tables', name: 'the bin', objectType: 'decoration',
      description: 'A steel bin chained to the awning post, full of chip paper. The gulls have had the lid off twice today.',
      flags: { aliases: ['bin', 'rubbish', 'litter bin'] } },
  ],

  items: [
    { id: 'item_fish_supper', name: 'fish supper', type: 'consumable', value: 16, weight: 500,
      description: null, flags: {},
      tags: { consumable: true, stackable: true, well_fed: true, restore_hunger: 45, restore_hp: 4,
        description: 'Battered cod laid on chips and wrapped twice in paper, the inner sheet already going clear with fat. The batter is the thick, blistered kind. Salt and vinegar whether you asked or not.' } },
    { id: 'item_chips', name: 'chips', type: 'consumable', value: 6, weight: 300,
      description: null, flags: {},
      tags: { consumable: true, stackable: true, restore_hunger: 22,
        description: 'A paper cone of thick-cut chips, soft in the middle. Too hot to eat for the first minute and gone by the fifth.' } },
    { id: 'item_battered_sausage', name: 'battered sausage', type: 'consumable', value: 7, weight: 180,
      description: null, flags: {},
      tags: { consumable: true, stackable: true, restore_hunger: 18,
        description: 'A sausage dipped in the fish batter and fried until the batter splits. It tastes mostly of the batter.' } },
    { id: 'item_mushy_peas', name: 'tub of mushy peas', type: 'consumable', value: 4, weight: 250,
      description: null, flags: {},
      tags: { consumable: true, stackable: true, restore_hunger: 10,
        description: 'A foam tub of marrowfat peas boiled to a green paste. It will stay hotter than anything else in the bag for twenty minutes.' } },
    { id: 'item_pickled_egg', name: 'pickled egg', type: 'consumable', value: 3, weight: 70,
      description: null, flags: {},
      tags: { consumable: true, stackable: true, restore_hunger: 7,
        description: 'A hard-boiled egg fished out of a jar of vinegar on the counter, grey-white and rubbery, wrapped in a square of paper.' } },
    { id: 'item_scraps', name: 'scraps', type: 'consumable', value: 1, weight: 60,
      description: null, flags: {},
      tags: { consumable: true, stackable: true, restore_hunger: 5,
        description: 'A paper twist of loose batter skimmed off the fryer. Crisp, salty, and the cheapest hot thing in the Filaments.' } },
  ],

  npc: {
    id: 'npc_batter_fryer', name: 'Gil Hesketh', sex: 'male', hp: 48,
    homeRoom: 'shop', workRoom: 'shop', shopName: BATTER,
    description: 'A heavy man in his forties with a shaved head and forearms speckled with small white burn scars from spitting fat. He moves behind the counter without looking, and talks to the fryers more than to the customers. A pencil lives behind one ear and a tea towel over one shoulder.',
    clothing: [
      'a white tunic gone cream at the cuffs',
      'a blue-striped apron spotted with batter',
      'black work trousers and steel-toed clogs',
      'a paper hat folded flat in his back pocket, unworn',
    ],
    // Late, because the Yards change shift at two.
    schedule: {
      mon: [{ from: 11, to: 26 }], tue: [{ from: 11, to: 26 }], wed: [{ from: 11, to: 26 }],
      thu: [{ from: 11, to: 26 }], fri: [{ from: 11, to: 27 }], sat: [{ from: 11, to: 27 }], sun: [{ from: 12, to: 22 }],
    },
    inventory: [
      { item_id: 'item_fish_supper', price: 16 },
      { item_id: 'item_chips', price: 6 },
      { item_id: 'item_battered_sausage', price: 7 },
      { item_id: 'item_mushy_peas', price: 4 },
      { item_id: 'item_pickled_egg', price: 3 },
      { item_id: 'item_scraps', price: 1 },
      { item_id: 'item_vinegar', price: 6 },
      { item_id: 'item_iced_tea_carton', price: 4 },
    ],
    chitchat: [
      'Hesketh lowers a basket into the middle fryer and the whole shop hisses.',
      'He shakes a basket of chips, looks at them, and drops them back in for another minute.',
      'He wraps a supper in two sheets of paper without looking down, and slides it across the counter.',
      '"Salt and vinegar?" he asks, already doing it.',
      'He skims the scraps off the top of the oil into the tray in the cabinet.',
      'The swing door at the back bangs open and a box of fillets on ice comes through. He takes it without looking round.',
      'He wipes a porthole in the steamed-up window with his sleeve and looks out at the tables.',
    ],
    dialogue: {
      root: {
        text: '"What can I get you?" He doesn\'t look up from the fryer.',
        text_by_relation: {
          first: 'The man behind the counter shakes a basket, hooks it on the side of the fryer and wipes his hands on the tea towel.\n\n"Gil. Batter Days." He nods at the board. "Fish, chips, sausage, peas. Scraps are a credit if you\'re skint. What can I get you?"',
          known: '"Back again." He is already reaching for the paper. "Supper?"',
          familiar: '"The usual," he says, and it is not a question. He drops a fish in the batter.',
        },
        options: [
          { label: 'What have you got?', next: '__shop__' },
          { label: 'What\'s good?', next: 'good' },
          { label: 'You\'re open late.', next: 'late' },
          { label: 'Where does the fish come from?', next: 'fish' },
          { label: 'Didn\'t you used to be on Ironside Street?', next: 'moved' },
          { label: 'Nothing, thanks.', next: 'bye', enabled: true, actions: [], conditions: [] },
        ],
      },
      good: {
        text: '"The supper." He taps the cabinet glass over the fish. "Cod, chips, done in beef dripping, which is the only right way and costs me more than the fish does. It\'ll keep you going a whole shift."\n\n"Scraps if you\'re broke. Nobody leaves here hungry, they just leave here with less."',
        options: [
          { label: 'A supper, then.', next: '__shop__' },
          { label: 'Back up.', next: 'root' },
        ],
      },
      late: {
        text: '"Have to be. The Yards change shift at two, and two hundred people come off the trucks hungry. They want something they can eat in the cab out of paper. I do more between midnight and two than the whole afternoon."\n\n"Sundays I close at ten. Even the trucks stop Sundays."',
        options: [{ label: 'Back up.', next: 'root' }],
      },
      fish: {
        text: '"Through there." He points the tongs at the swing door behind him. "Fawle lands it off the boats in the morning and it\'s in my batter by the afternoon. Nobody in the city eats fresher, and most of them have no idea."\n\n"Got a catch of your own? He\'ll buy it. Go out the front and round to the quay, or the staff door off the car park."',
        actions: [{ action: 'GPS_TO', zone: 'zone_district_903_904' }],
        options: [{ label: 'Back up.', next: 'root' }],
      },
      moved: {
        text: '"Ironside, yeah. Brick place by the Meridian." He shrugs. "Fawle had a front he wasn\'t using and I had a delivery I was walking across town for. Now it comes through a door."\n\n"The old unit\'s boarded up. Somebody\'ll take it. Somebody always does."',
        options: [{ label: 'Back up.', next: 'root' }],
      },
      bye: {
        text: '"Mind, it\'s hot," he says, already turning back to the fryer.',
        options: [],
      },
    },
  },
});

store.patch('furniture', 'furn_light_zone_batter_shop', {
  name: 'the counter lights',
  description: 'Two bare fluorescent tubes over the counter, and the heat lamps in the cabinet, which do most of the work.',
});

// Gil keeps his flat in the Meridian. It's a walk now.
store.patch('npcs', 'npc_batter_fryer', { home_zone: 'zone_meridian_unit_201', flags: {
  ...(store.get('npcs', 'npc_batter_fryer').flags || {}), personality: 'vendor',
} });

store.patch('doors', 'door_shop_batter_shop', {
  id: 'door_shop_batter_shop', zone_id: shop.facadeId, exit_dir: 'north', target_zone: 'zone_batter_shop',
  connection_id: `conn_hf_${shop.facadeId.replace(/^zone_/, '')}_north`, door_type: 'basic', flags: {},
  hololock_difficulty: 5, hp: 1000, hp_max: 1000, is_locked: 0, is_open: 0, lock_state: 'locked', name: null,
  tags: { 'lock:shoplock': { canHack: true, difficulty: 4, messages: {
    denied: 'The shop lock reads your hand and declines to recognise it.',
    lock: 'The bolt drops. The fryers tick as they cool.',
    unlock: 'The bolt lifts. The glass door swings in on a wall of warm air and frying.' } } },
});

// The smoker and the grill stay in the prep room, which came with the shop.
for (const id of ['furn_smoker_drum', 'furn_charcoal_grill']) {
  if (store.get('furniture', id)) store.patch('furniture', id, { zone_id: 'zone_batter_prep' });
}

// ── 6. THE TWO BUILDINGS AS ONE ─────────────────────────────────────────────
//
// The swing door between the prep room and the cutting floor, and the works' roller door onto the
// quay. Both cross from an interior map to somewhere else, so each needs a connection file.
setExit('zone_batter_prep', 'north', 'zone_codfather_slab');
setExit('zone_codfather_slab', 'south', 'zone_batter_prep');
conn('conn_hf_batter_prep_north', 'zone_batter_prep', 'zone_codfather_slab', 'north');
setExit('zone_codfather_weigh', 'north', QUAY);
conn('conn_hf_codfather_weigh_north', 'zone_codfather_weigh', QUAY, 'north');

// ── 7. UNIT 5, IRONSIDE STREET ──────────────────────────────────────────────
//
// Batter Days' old brick unit, boarded up and to let: a storefront unit like Unit 4, Marrow Street,
// so a player can buy it (`deed`, `buyshop`) and the next business has somewhere to go. The deed
// is player data; only the terms below are content.
{
  const sf = await authorBuilding(store, {
    slug: 'sf_ironside5', name: VACANT, type: 'shop',
    x: 918, y: 907, entrance: 'east', floors: 1, marker: 'I5', district: 'industrial',
    facade: {
      bgColor: '#221a14', color: '#8a7a68',
      description: 'A low brick shop with a slate roof, empty. The wide front window is boarded over with sheets of ply and a letting notice is stapled to the board by the door. A cold steel flue runs up the back corner, and rows of empty hooks still run along the brick either side of the door.',
    },
    rooms: [
      { key: 'shop', name: 'The Shop', floor: 'tile',
        description: 'An empty shop with the fryers gone and four bright squares on the tiles where they stood. The counter is still bolted to the floor. Daylight comes in round the edges of the boards over the window. A safe is set into the back wall with its door open.',
        window: { name: 'the boarded window',
          description: 'Sheets of ply screwed over the shop window from outside. Light gets in round the edges, and so does the noise of Ironside Street.',
          light: 0.35, visibility: 0.1 } },
    ],
    utility: {
      name: 'The Cellar', floor: 'concrete',
      description: 'A low cellar under the shop, cold and still smelling of old oil. Rings on the floor show where the fat drums stood. The junction box is on the wall at the foot of the steps.',
    },
    props: [
      { key: 'counter', room: 'shop', name: 'display counter', objectType: 'fixture',
        description: 'The old steel chip shop counter, bolted through the tiles, with the hot cabinet gone from the top of it and the glass well underneath still whole.',
        flags: { shop_display: true, woven: true } },
      { key: 'vault', room: 'shop', name: 'wall safe', objectType: 'fixture',
        description: 'A small safe set into the back wall, its door standing open on an empty shelf. Whoever cleared the shop out didn\'t try to take it.',
        flags: { hack_difficulty: 6, shop_vault: true } },
    ],
  });
  const room = 'zone_sf_ironside5_shop';
  store.patch('zones', room, { flags: { ...store.get('zones', room).flags,
    is_storefront: true, shop_price: 6500, shop_term: 10, shop_upkeep: 45 } });
  store.patch('furniture', `furn_light_${room}`, {
    name: 'the bare bulb',
    description: 'One bare bulb on a flex where the counter lights used to be.',
  });
  // The shop shutter, from the inside, the same lock every storefront unit carries.
  store.patch('doors', 'door_sf_ironside5', {
    id: 'door_sf_ironside5', zone_id: room, exit_dir: 'east', target_zone: sf.facadeId,
    connection_id: `conn_hf_${sf.facadeId.replace(/^zone_/, '')}_west`, door_type: 'shutter', flags: {},
    hololock_difficulty: 5, hp: 700, hp_max: 700, is_locked: 0, is_open: 1, lock_state: 'unlocked',
    name: 'shutter_sf_ironside5',
    tags: { 'lock:shopshutter': { canHack: true, difficulty: 5, messages: {
      denied: 'The shutter\'s keypad doesn\'t know you.',
      hackFail: 'The keypad relocks itself mid-sequence.',
      hackSuccess: 'The keypad gives in and the shutter jumps in its track.',
      lock: 'The shutter grinds down and the bolt drops into the floor plate.',
      unlock: 'The bolt lifts and the shutter rolls up.' } } },
  });
}

// ── 7b. ROOM NAMES ──────────────────────────────────────────────────────────
//
// `authorBuilding` names a room "Building — Room". The house rule is no em dashes, and the newer
// buildings (the Palais, Moor or Less) read "Building: Room", so every room here is renamed to that.
// A storefront's shop room is just the unit's name, as Unit 4, Marrow Street's is. Power rows copy
// the zone name when the utility room is written, so a second run brings them into line.
for (const map of ['map_int_codfather', 'map_int_batter', 'map_int_sf_ironside5']) {
  for (const z of store.all('zones').filter((r) => r.map_id === map)) {
    const want = z.id === 'zone_sf_ironside5_shop' ? VACANT : String(z.name).replace(' — ', ': ');
    if (want !== z.name) store.patch('zones', z.id, { name: want });
  }
}

// ── 8. FISH THE FISHMONGER WILL BUY ─────────────────────────────────────────
//
// Every catch on the two fishing tables, tagged so `fish_buyer` pays the specialist rate for it.
for (const id of ['item_fresh_catch', 'item_sludge_carp', 'item_razorgill', 'item_irontooth_bass',
  'item_ashen_pike', 'item_coldwater_sturgeon', 'item_glass_eel']) {
  const it = store.get('items', id);
  if (it) store.patch('items', id, { tags: { ...(it.tags || {}), raw_fish: true } });
}

// ── 9. WHAT THE MOVE LEAVES BEHIND ──────────────────────────────────────────
//
// ⚠ EACH ONE IS DELETED ONLY WHILE IT STILL SAYS WHAT IT USED TO.
const at = (a, dir) => (o) => o.a === a && o.dir === dir;
const gone = [
  ['connections/conn_district_903_905_north_1vn0.json', at(WORKS, 'north')],          // the old front door in
  ['connections/conn_district_903_905_south_3xts.json', at(WORKS, 'south')],          // the old front onto Filament Yard
  ['connections/conn_codfather_slab_north_9sxn.json', at('zone_codfather_slab', 'north')],  // the ice room was north
  ['connections/conn_codfather_slab_down_bliy.json', at('zone_codfather_slab', 'down')],    // now conn_hf_codfather_slab_down
  ['connections/conn_hf_batter_shop_west.json', at('zone_batter_shop', 'west')],             // the prep room was west
];
// 918,907's old door pair needs no entry: section 7 rewrites both ids in place.
const removed = [];
for (const [rel, stale] of gone) {
  const p = path.join(store.baseDir, rel);
  if (fs.existsSync(p) && stale(JSON.parse(fs.readFileSync(p, 'utf8')))) { if (!DRY) fs.unlinkSync(p); removed.push(rel); }
}

const written = store.flush({ dryRun: DRY });
console.log(`${DRY ? 'DRY RUN: ' : ''}${written.length} file(s) ${DRY ? 'would be written' : 'written'}, ${removed.length} ${DRY ? 'would be ' : ''}removed`);
if (process.argv.includes("--list")) for (const w of written) console.log("  w " + w);
if (process.argv.includes('--list')) for (const w of written) console.log('  w ' + path.relative(process.cwd(), w));
for (const r of removed) console.log('  - ' + r);
console.log(`  works ${works.facadeId} (${works.mapId})  shop ${shop.facadeId} (${shop.mapId})`);
