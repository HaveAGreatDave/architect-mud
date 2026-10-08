/**
 * RING FENCED: the boxing gym on Lever Lane, in the shed Hulls Angels left.
 *
 *   node scripts/content/ring-fenced.mjs [--dry-run]
 *
 * Hulls Angels was a boat shed a quarter of a mile from any water, and nobody could buy a boat
 * there: hulls are bought at a marina. Keel moved down to the water (scripts/content/moor-or-less/)
 * and the shed became the city's first real gym. The Sump's back room has a rebound wall and the
 * Precinct's cells have a bench, and those were the only training stations in Coldwater.
 *
 * ⚠ RUN moor-or-less/batch1.mjs FIRST, OR KEEL'S ROOMS ARE LEFT POINTING HERE. The old interior
 * (`zone_hulls_*`, `map_int_hulls`, its utility room and junction box) is Keel's and moves with him;
 * this building gets new ids under the `ringf` slug. What it cannot reuse is deleted below: the old
 * facade's link west into `zone_hulls_shop`, the door on that link, and the shop's down link, which
 * the shed's own utility room re-authors under its new id.
 *
 * ⚠ THE STORY IS IN THE FRONT WALL. The mast-height doors were bricked up to head height and a
 * normal door was cut into the infill. The `gym` arm in glass/models/yards.js draws exactly that, so
 * the prose and the model say the same thing.
 *
 * Idempotent: every id derives from the slug, so a re-run is an upsert.
 */
import fs from 'node:fs';
import path from 'node:path';
import { authorBuilding, loadContentStore } from './halcyon/lib.mjs';

const DRY = process.argv.includes('--dry-run');
const store = loadContentStore();

// Keel's shed must already have left, or authorBuilding's neighbour sweep would find his rooms
// still parented here and treat them as this building's.
const oldShop = store.get('zones', 'zone_hulls_shop');
if (oldShop && oldShop.parent_zone === 'zone_district_916_905') {
  throw new Error('zone_hulls_shop still belongs to 916,905: run scripts/content/moor-or-less/batch1.mjs first');
}

const spec = {
  slug: 'ringf', name: 'Ring Fenced', type: 'gym',
  x: 916, y: 905, entrance: 'east', floors: 2, marker: 'RF', district: 'yards',

  facade: {
    bgColor: '#1e1a18', color: '#c8b49a',
    description: 'A brick works shed under a curved tin roof, painted red. The front was a pair of doors tall enough for a mast. The opening has been bricked up to head height in newer brick and glazed above, with an ordinary steel door cut into the bottom. RING FENCED is painted over the door, red on cream. Tyres are stacked by the step.',
  },

  rooms: [
    { key: 'floor', name: 'The Floor', floor: 'concrete',
      description: 'A works floor under curved roof trusses, a strip of rooflight running along the ridge. A boxing ring stands in the middle on a timber stage, its ropes taped where they have split. Three heavy bags hang off a rail on the east wall, with a slip rope strung at head height beside them. A ladder goes up to the office.',
      window: {
        name: 'the old door glass',
        description: 'Wired glass in a steel grid, filling the top of the opening where the mast doors were. Lever Lane is a grey blur through it. The lower panes on the side walls are painted white from the inside.',
        light: 0.6, visibility: 0.2,
      } },
    { key: 'iron', name: 'The Iron Room', floor: 'concrete', from: 'floor', dir: 'west',
      description: 'The old machine shop, floored in rubber cut from conveyor belt. A weight bench and a rack of plates, no two from the same maker. A circuit runs the length of the room: a tractor tyre to flip, a sled on a rope, and a row of sandbags. Chalk on everything.',
      window: null },
    { key: 'office', name: 'The Office', floor: 'boards', from: 'floor', dir: 'up',
      description: 'A mezzanine office with a window looking down on the ring. A desk, a filing cabinet and a camp bed made up tight. Fight posters cover the walls, some of them from before. A wet towel is draped over the kettle to keep the chalk off it.',
      window: {
        name: 'the office window',
        description: 'A pane in a steel frame looking down on the ring. You can see every corner of it from here.',
        light: 0.5, visibility: 0.9,
      } },
  ],

  utility: {
    name: 'The Boiler Room', floor: 'concrete',
    description: 'Under the floor: the boiler for the showers, the building\'s junction box and a floor drain that takes everything the showers send it.',
  },

  lights: {
    iron: { name: 'the tube lights', description: 'Four fluorescent tubes on chains, one of them flickering at a rate you stop noticing after a set or two.', lumens: 2600 },
    office: { name: 'the desk lamp', description: 'An angled lamp clamped to the edge of the desk, aimed at the ledger.', lumens: 800, type: 'lamp' },
  },

  props: [
    { key: 'ring', room: 'floor', name: 'the ring', objectType: 'furniture',
      description: 'A sixteen-foot ring on a timber stage, three ropes a side, the canvas patched in two places with sailcloth. The corner pads are older than the canvas.',
      flags: { aliases: ['ring', 'ropes', 'canvas', 'stage'],
        examine_detail: 'A stencil on the canvas under the patches: a promotion\'s name, mostly scrubbed out. The ring came cheap when they went under.' } },
    { key: 'bags', room: 'floor', name: 'the heavy bags', objectType: 'furniture',
      description: 'Three leather heavy bags on chains along a rail, split and taped so often the tape holds the shape. A slip rope runs between two posts beside them at head height.',
      flags: { aliases: ['bag', 'bags', 'heavy bag', 'heavy bags', 'slip rope', 'rope'],
        interactions: ['spar'], station_style: 'bag' } },
    { key: 'board', room: 'floor', name: 'the notice board', objectType: 'decoration',
      description: 'A cork board by the door with a fight card pinned to it for Friday. Three of the names have been crossed out and written back in.',
      flags: { aliases: ['board', 'notice board', 'card', 'fight card'],
        examine_detail: 'Under the fight card, in marker on a piece of shirt cardboard: NO WRAPS, NO BAGS. NO GLOVES, NO RING. PAY TAMSIN.' } },
    { key: 'bench', room: 'iron', name: 'the weight bench', objectType: 'furniture',
      description: 'A flat bench with a cracked vinyl pad and a squat rack welded over it, bolted to the floor through the rubber. The bar is knurled smooth in the middle.',
      flags: { aliases: ['bench', 'weight bench', 'bar', 'rack', 'plates'],
        interactions: ['lie', 'lift'] } },
    { key: 'circuit', room: 'iron', name: 'the circuit', objectType: 'furniture',
      description: 'A tractor tyre for flipping, a steel sled on twenty feet of rope, and six sandbags in a row. Chalk lines on the floor mark the turns.',
      flags: { aliases: ['circuit', 'tyre', 'tire', 'sled', 'sandbags'],
        interactions: ['drill'] } },
    { key: 'cot', room: 'office', name: 'the camp bed', objectType: 'furniture',
      description: 'A canvas camp bed with an army blanket pulled tight enough to bounce a coin on.',
      flags: { aliases: ['bed', 'camp bed', 'cot'], bed: true, interactions: ['sit', 'lie', 'lean'] } },
    { key: 'cashbox', room: 'office', name: 'the cash box', objectType: 'fixture',
      description: 'A green steel cash box in the bottom drawer of the filing cabinet, with a combination lock and a dent in the lid.',
      flags: { aliases: ['cash box', 'box', 'drawer', 'filing cabinet'], vendor_safe: true, vendor_npc_id: 'npc_ringf_tamsin', hack_difficulty: 3 } },
  ],

  items: [
    { id: 'item_hand_wraps', name: 'hand wraps', type: 'armor', value: 18, weight: 80,
      description: null,
      flags: { slot: 'hands' },
      tags: { slot: 'hands', layer: 'underwear', bulkiness: 0,
        description: 'Two rolls of grey cotton wrap, four metres each, with a thumb loop at one end and hook-and-loop at the other. Washed until they have gone soft.' } },
    { id: 'item_skipping_rope', name: 'skipping rope', type: 'misc', value: 12, weight: 300,
      description: null,
      flags: {},
      tags: { description: 'A leather rope on two turned wooden handles, the leather worn pale where it hits the floor.' } },
  ],

  npc: {
    id: 'npc_ringf_tamsin', name: 'Tamsin Brannock', sex: 'female', hp: 52,
    homeRoom: 'office', workRoom: 'floor', shopName: 'Ring Fenced',
    description: 'A woman in her fifties, short and wide through the shoulders, with a nose that was broken and set by somebody in a hurry. Grey hair cut close to the skull. She has a stopwatch on a bootlace round her neck and knuckles gone flat from use.',
    clothing: [
      'a tracksuit top zipped to the chin',
      'grey sweatpants with chalk handprints on the thighs',
      'flat-soled boxing boots laced high',
      'a stopwatch on a bootlace round her neck',
    ],
    schedule: {
      mon: [{ from: 6, to: 22 }], tue: [{ from: 6, to: 22 }], wed: [{ from: 6, to: 22 }],
      thu: [{ from: 6, to: 22 }], fri: [{ from: 6, to: 22 }], sat: [{ from: 8, to: 20 }], sun: [{ from: 10, to: 16 }],
    },
    inventory: [
      { item_id: 'item_hand_wraps', price: 24 },
      { item_id: 'item_skipping_rope', price: 16 },
      { item_id: 'item_electrolyte_sachet', price: 7 },
      { item_id: 'item_pain_pills', price: 20 },
      { item_id: 'item_towel_rough', price: 12 },
    ],
    chitchat: [
      'Brannock clicks the stopwatch and calls "Time." Nobody on the bags stops.',
      'She tapes a split in the top rope without looking at it.',
      'She watches somebody on the bag for a full minute, then walks over and moves their back foot two inches.',
      'The kettle clicks off up in the office. She does not go up for it.',
      'She writes a name on the fight card, looks at it, and crosses it out again.',
    ],
    dialogue: {
      root: {
        text: '"Wraps on before you touch a bag." She glances at your hands. "What do you want?"',
        text_by_relation: {
          first: 'The woman by the ring clicks a stopwatch, says "Time," and only then looks round.\n\n"Tamsin Brannock. This is my gym." She looks you over, hands first. "Bench and the circuit are through the back. The bags are here. The ring is for people I\'ve watched on the bags, and I haven\'t watched you yet."',
          known: '"Back again." She is already looking at your hands. "Wrapped?"',
          familiar: '"There you are." She points at the bags with the stopwatch. "Three rounds. Then we\'ll talk."',
        },
        options: [
          { label: 'What do you sell?', next: '__shop__' },
          { label: 'How does it work here?', next: 'train' },
          { label: 'What is the ring for?', next: 'ring' },
          { label: 'Wasn\'t this a boat shed?', next: 'shed' },
          { label: 'Who were you before this?', next: 'past' },
          { label: 'Nothing, thanks.', next: 'bye', enabled: true, actions: [], conditions: [] },
        ],
      },
      train: {
        text: '"Three stations." She points them out with the stopwatch. "The bags, here. That\'s hands and eyes. <b>spar</b>. The bench through the back: lie on it and <b>lift</b>. That\'s strength. The circuit next to it, <b>drill</b>, is your lungs."\n\n"None of it makes you anything you didn\'t bring in with you. What you did out there, you turn into something you keep, in here. You run out of what you did out there, you go and do some more. <b>stop</b> when you\'re done."',
        options: [
          { label: 'What does it cost?', next: 'cost' },
          { label: 'Back up.', next: 'root' },
        ],
      },
      cost: {
        text: '"The door\'s free." She shrugs. "Wraps aren\'t, and you\'re not going on my bags without them. I make my money on wraps, sachets and fight nights. Mostly fight nights."',
        options: [{ label: 'Back up.', next: 'root' }],
      },
      ring: {
        text: '"Fridays." She nods at the card on the board. "Three or four bouts, people from the Yards and whoever comes up from the docks. Gate money goes to the winner and the house. The house is me."\n\n"I bought the ring off a promotion that went under. Their name\'s still on the canvas under the patches. Nobody\'s come for it."',
        options: [{ label: 'Back up.', next: 'root' }],
      },
      shed: {
        text: '"It was." She looks up at the front wall. "The doors went right up into the roof, tall enough for a mast. Keel, the boatbuilder, was in here years building a hull that never left the building."\n\n"He took her down to the water in the end. Took four of us and a flatbed, and she still isn\'t finished. He\'s got a yard at the bottom of Ironside Street now. I had the hole bricked up to head height, glass put in the top, and a normal door in the bottom."',
        options: [
          { label: 'Where is his yard?', next: 'keel' },
          { label: 'Back up.', next: 'root' },
        ],
      },
      keel: {
        text: '"North end of Ironside Street, on the water past the gun battery." She points, roughly. "Moor or Less. He\'ll sell you a boat, rent you one, or fix the one you\'ve got. Cheaper than the glass place on the west shore. Not as clean."',
        actions: [{ action: 'GPS_TO', zone: 'zone_district_921_901' }],
        options: [{ label: 'Back up.', next: 'root' }],
      },
      past: {
        text: '"Somebody who got hit for money." She touches her nose. "Light-welterweight, on the undercard at the Sump before they turned it over to Slagball. Twenty-two fights. I won enough of them."\n\n"Then I started telling the others what they were doing wrong, and they started paying me to. This is cheaper on the face."',
        options: [{ label: 'Back up.', next: 'root' }],
      },
      bye: {
        text: '"Wraps," she says, without turning round.',
        options: [],
      },
    },
  },
};

const ids = await authorBuilding(store, spec);

// `authorUtilityRoom` gives the anchor room a stock fixture on insert only.
store.patch('furniture', 'furn_light_zone_ringf_floor', {
  name: 'the ring lights',
  description: 'A square frame of fluorescent tubes hung on chains over the ring, with more tubes down the bag rail.',
});

// The street door locks when Tamsin goes home, the same shop lock `fit-shop-locks.mjs` fits.
store.patch('doors', 'door_shop_ringf_floor', {
  id: 'door_shop_ringf_floor', zone_id: ids.facadeId, exit_dir: 'west', target_zone: 'zone_ringf_floor',
  connection_id: `conn_hf_${ids.facadeId.replace(/^zone_/, '')}_west`, door_type: 'basic', flags: {},
  hololock_difficulty: 5, hp: 1000, hp_max: 1000, is_locked: 0, is_open: 0, lock_state: 'locked', name: null,
  tags: { 'lock:shoplock': { canHack: true, difficulty: 4, messages: {
    denied: 'The shop lock reads your hand and declines to recognise it.',
    lock: 'The bolt drops and the shopfront goes quiet.',
    unlock: 'The bolt lifts. The steel door swings in onto the gym floor.' } } },
});

// The old seams this building replaces. Each one is re-authored under a new id, by this script or by
// Keel's, and leaving the old file would project a second edge on the same (zone, direction) pair.
// ⚠ EACH ONE IS DELETED ONLY WHILE IT STILL SAYS WHAT IT USED TO. The door's id now belongs to Keel's
// new street door on 921,901, so a re-run must leave that file alone.
const gone = [
  // 916,905 west -> zone_hulls_shop; now conn_hf_district_916_905_west
  ['connections/conn_district_916_905_west_c47f.json', (o) => o.a === 'zone_district_916_905'],
  // the shop lock on that link; this building's is door_shop_ringf_floor
  ['doors/door_shop_hulls_shop.json', (o) => o.zone_id === 'zone_district_916_905'],
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
