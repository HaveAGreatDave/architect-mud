/**
 * BATTER DAYS FISH & CHIPS: the chip shop on Ironside Street, in the brick unit Tine & Temper left.
 *
 *   node scripts/content/batter-days.mjs [--dry-run]
 *
 * Tine & Temper sold pans and utensils, and every one of them was also on the kitchenware rack at
 * Ration Nine, across the road and one tile down. Nobody could say what the shop was for, so the unit
 * became a chippy: cheap food in paper on a street of depots, beside Nico's Noodle Bar.
 *
 * ⚠ THE OLD INTERIOR IS DELETED, NOT MOVED. Its ids were the pre-slug kind (`zone_kitchenware`,
 * `zone_kitchenware_util`) that `authorBuilding` cannot reach from any slug, so this building gets
 * new ids under `batter` and every file that belonged to the old one is removed below: its two
 * rooms, map, power rows, junction box, generator, furniture, the room's link back to the street,
 * and Tove Adaska, whose stock was Ration Nine's. Cold Shoulder's removal (69daa5e74) is the same
 * shape.
 *
 * ⚠ THE DRUM SMOKER AND THE CHARCOAL GRILL MOVE, AND THEY ARE THE ONLY PUBLIC ONES. They came in
 * with the cooking expansion (a8f0283b0) and were parked in the pan shop; a chip shop that smokes
 * its own haddock is a better home for both, so they go to the prep room under their old ids.
 *
 * Idempotent: every new id derives from the slug, and each deletion only fires while the file
 * still says what it used to.
 */
import fs from 'node:fs';
import path from 'node:path';
import { authorBuilding, loadContentStore } from './halcyon/lib.mjs';

const DRY = process.argv.includes('--dry-run');
const store = loadContentStore();

const NAME = 'Batter Days Fish & Chips';

const spec = {
  slug: 'batter', name: NAME, type: 'chip_shop',
  x: 918, y: 907, entrance: 'east', floors: 1, marker: 'BT', district: 'industrial',

  facade: {
    bgColor: '#221a14', color: '#e8b866',
    description: 'A low brick shop with a slate roof and a steel flue up the back corner, breathing steam and frying oil for as long as it is open. The front is one wide window, fogged on the inside, with a glass door in the middle. BATTER DAYS is painted over it in cream on dark green, with FISH & CHIPS smaller underneath, and a tin fish hangs off a bracket over the pavement. Rows of hooks still run along the brick either side of the door from when the place sold pans.',
  },

  rooms: [
    { key: 'shop', name: 'The Shop', floor: 'tile',
      description: 'A tiled room with a steel counter across the back and a glass hot cabinet on it, the battered fish lined up gold under its lamps. Behind the counter three fryers sit under a hood, the oil in them never quite still. A menu board hangs above the range, its prices changed in marker on tape. Salt, vinegar and a squeeze bottle of brown sauce stand on a shelf under the window, beside a bench for people waiting.',
      window: {
        name: 'the steamed-up window',
        description: 'The shop window onto Ironside Street, fogged from the inside to head height. Somebody has wiped a porthole in it with a sleeve to see who is coming.',
        light: 0.8, visibility: 0.4,
      } },
    { key: 'prep', name: 'The Prep Room', floor: 'tile', from: 'shop', dir: 'west',
      description: 'A narrow back room with a drain in the middle of the floor and the walls tiled to shoulder height. A drum peeler the size of a cement mixer stands in the corner beside a chipper bolted to the wall, and potato sacks are stacked to the window. A steel table holds a tub of batter under a cloth. The back door is propped open on a drum smoker and a charcoal grill.',
      window: null },
  ],

  utility: {
    name: 'The Cellar', floor: 'concrete',
    description: 'A low cellar under the shop, cold, and smelling of old oil. Drums of fryer fat stand in two rows, clean on the left and used on the right. The junction box is on the wall at the foot of the steps.',
  },

  lights: {
    prep: { name: 'the strip light', description: 'A single fluorescent tube in a cage over the prep table, with a fly paper hanging from it that nobody has changed.', lumens: 1500 },
  },

  props: [
    { key: 'range', room: 'shop', name: 'the fryers', objectType: 'fixture',
      description: 'Three deep fryers in brushed steel under an extractor hood, each with a wire basket hooked on its side. The oil in the middle one is darker than the others. A card taped to the hood reads STAFF ONLY. THIS MEANS YOU.',
      flags: { aliases: ['fryer', 'fryers', 'range', 'hood', 'baskets', 'oil'] } },
    { key: 'cabinet', room: 'shop', name: 'the hot cabinet', objectType: 'fixture',
      description: 'A glass cabinet on the counter with heat lamps in its roof. Battered fish, sausages and a tray of loose scraps sit on the racks, all of it the same gold.',
      flags: { aliases: ['cabinet', 'hot cabinet', 'glass', 'counter', 'lamps'] } },
    { key: 'board', room: 'shop', name: 'the menu board', objectType: 'decoration',
      description: 'A painted board over the range: FISH SUPPER, CHIPS, SAUSAGE, PEAS, PICKLED EGG, SCRAPS. The prices are in marker on strips of tape, and the fish has been re-taped twice.',
      flags: { aliases: ['board', 'menu', 'menu board', 'prices'],
        examine_detail: 'Under the tape on the fish, the first price is still legible. It was half what it is now.' } },
    { key: 'shelf', room: 'shop', name: 'the condiment shelf', objectType: 'decoration',
      description: 'A shelf under the window with a steel salt shaker, a glass bottle of malt vinegar with a dented cap, and a squeeze bottle of brown sauce that has been refilled from something larger.',
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
      flags: { aliases: ['table', 'batter', 'tub', 'prep table'] } },
    { key: 'sink', room: 'prep', name: 'the sink', objectType: 'sink',
      description: 'A deep steel sink with a tall swan-neck tap, for rinsing potatoes by the sackful.',
      flags: { aliases: ['sink', 'tap', 'basin'], water_source: true, interactions: ['lean'] } },
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
        description: 'A paper twist of loose batter skimmed off the fryer. Crisp, salty, and the cheapest hot thing on Ironside Street.' } },
  ],

  npc: {
    id: 'npc_batter_fryer', name: 'Gil Hesketh', sex: 'male', hp: 48,
    homeRoom: 'shop', workRoom: 'shop', shopName: NAME,
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
      'He wipes a porthole in the steamed-up window with his sleeve and looks out at Ironside Street.',
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
          { label: 'Didn\'t this place sell pans?', next: 'pans' },
          { label: 'Where does the fish come from?', next: 'fish' },
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
        text: '"Have to be." He jerks his head east, toward the Yards. "The depots change shift at two. Two hundred people come off the trucks hungry, and they don\'t want noodles, whatever Nico tells you. They want something they can eat in the cab out of paper. I do more between midnight and two than the whole afternoon."\n\n"Sundays I close at ten. Even the trucks stop Sundays."',
        options: [{ label: 'Back up.', next: 'root' }],
      },
      pans: {
        text: '"Tove\'s place. Pots, pans and that." He shrugs. "Ration Nine had all the same stuff on a rack across the road, cheaper and open later. She lasted about as long as you\'d think."\n\n"She left the hooks along the front. I hang the menu off two of them. The rest I\'ve not got round to."',
        options: [
          { label: 'Where is Ration Nine?', next: 'ration' },
          { label: 'Back up.', next: 'root' },
        ],
      },
      ration: {
        text: '"Across the road and down one, at the Marrow Street end." He points with a pair of tongs. "Groceries, and the pans if you want them. Mind the chiller. It bites."',
        actions: [{ action: 'GPS_TO', zone: 'zone_district_920_908' }],
        options: [{ label: 'Back up.', next: 'root' }],
      },
      fish: {
        text: '"The Codfather, out west by the water. Fawle drops it off at six with the ice still on." He lifts a fillet out of the tray to show you. "I smoke the haddock myself out the back, on the drum. Nobody asks for haddock. I do it anyway."',
        actions: [{ action: 'GPS_TO', zone: 'zone_district_903_905' }],
        options: [{ label: 'Back up.', next: 'root' }],
      },
      bye: {
        text: '"Mind, it\'s hot," he says, already turning back to the fryer.',
        options: [],
      },
    },
  },
};

const ids = await authorBuilding(store, spec);

// `authorUtilityRoom` gives the anchor room a stock fixture on insert only.
store.patch('furniture', 'furn_light_zone_batter_shop', {
  name: 'the counter lights',
  description: 'Two bare fluorescent tubes over the counter, and the heat lamps in the cabinet, which do most of the work.',
});

// Gil lives in the Meridian next door, in the flat Tove had. The flat's resident in
// npc_residences is Kessel, who stays; this is the second NPC sharing his home_zone.
store.patch('npcs', 'npc_batter_fryer', { home_zone: 'zone_meridian_unit_201', flags: {
  ...(store.get('npcs', 'npc_batter_fryer').flags || {}), personality: 'vendor',
} });

// The street door locks when Gil goes home, the same shop lock `fit-shop-locks.mjs` fits.
store.patch('doors', 'door_shop_batter_shop', {
  id: 'door_shop_batter_shop', zone_id: ids.facadeId, exit_dir: 'west', target_zone: 'zone_batter_shop',
  connection_id: `conn_hf_${ids.facadeId.replace(/^zone_/, '')}_west`, door_type: 'basic', flags: {},
  hololock_difficulty: 5, hp: 1000, hp_max: 1000, is_locked: 0, is_open: 0, lock_state: 'locked', name: null,
  tags: { 'lock:shoplock': { canHack: true, difficulty: 4, messages: {
    denied: 'The shop lock reads your hand and declines to recognise it.',
    lock: 'The bolt drops. The fryers tick as they cool.',
    unlock: 'The bolt lifts. The glass door swings in on a wall of warm air and frying.' } } },
});

// The smoker and the grill move to the prep room under their own ids.
for (const id of ['furn_smoker_drum', 'furn_charcoal_grill']) {
  if (store.get('furniture', id)) store.patch('furniture', id, { zone_id: 'zone_batter_prep' });
}

// Everything that was Tine & Temper. ⚠ EACH ONE IS DELETED ONLY WHILE IT STILL SAYS WHAT IT USED TO.
const was = (o) => o.zone_id === 'zone_kitchenware' || o.zone_id === 'zone_kitchenware_util';
const gone = [
  ['zones/zone_kitchenware.json', (o) => o.parent_zone === 'zone_district_918_907'],
  ['zones/zone_kitchenware_util.json', (o) => o.parent_zone === 'zone_district_918_907'],
  ['maps/map_int_kitchenware.json', (o) => o.parent_zone_id === 'zone_district_918_907'],
  ['power_zones/zone_kitchenware.json', (o) => o.generator_id === 'gen_zone_kitchenware_util'],
  ['power_zones/zone_kitchenware_util.json', (o) => o.generator_id === 'gen_zone_kitchenware_util'],
  ['generators/gen_zone_kitchenware_util.json', was],
  ['connections/conn_kitchenware_east_u5bt.json', (o) => o.a === 'zone_kitchenware'],
  ['npcs/npc_kitchenware_smith.json', (o) => o.work_zone_id === 'zone_kitchenware'],
  ...['counter', 'demo_range', 'kettle', 'light', 'panrail', 'rack', 'sink', 'whetstone']
    .map((k) => [`furniture/furn_kitchenware_${k}.json`, was]),
  ['furniture/furn_light_zone_kitchenware_util.json', was],
];
const removed = [];
for (const [rel, stale] of gone) {
  const p = path.join(store.baseDir, rel);
  if (fs.existsSync(p) && stale(JSON.parse(fs.readFileSync(p, 'utf8')))) { if (!DRY) fs.unlinkSync(p); removed.push(rel); }
}

const written = store.flush({ dryRun: DRY });
console.log(`${DRY ? 'DRY RUN: ' : ''}${written.length} file(s) ${DRY ? 'would be written' : 'written'}, ${removed.length} ${DRY ? 'would be ' : ''}removed`);
for (const r of removed) console.log('  - ' + r);
console.log(`  facade ${ids.facadeId}  map ${ids.mapId}  utility ${ids.utilityRoomId}`);
