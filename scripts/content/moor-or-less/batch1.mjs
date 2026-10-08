/**
 * MOOR OR LESS, batch 1: Keel's shed, on the water at last.
 *
 *   node scripts/content/moor-or-less/batch1.mjs [--dry-run]
 *
 * Run after batch0, which lays the hard the door opens onto. Before it, 920,901 is grass and
 * `authorBuilding` refuses the entrance.
 *
 * Keel built a forty-foot hull for years in a shed on Lever Lane, a quarter of a mile from any
 * water, and nobody could buy a boat from him there. This moves him, his hull and his shop down to
 * the north end of Ironside Street, where he sells and hires hulls across his bench, keeps a wet slot
 * under the roof, and does the yard work at six-tenths of the Fairweather price.
 *
 * ⚠ THE SLUG IS STILL `hulls`, AND THAT IS DELIBERATE. `authorBuilding` derives every interior id
 * from it, so `zone_hulls_shop`, `zone_hulls_back`, `map_int_hulls`, the utility room, its junction
 * box, generator and power rows are Keel's existing rows, re-parented onto 921,901. Nothing he owns
 * is deleted and re-made. The one file that has to go is the old shop->utility link, which
 * `authorBuilding` re-authors under its own id (`conn_hf_hulls_shop_down`).
 *
 * ⚠ ONE ROOM IS THE DESK, THE SHED AND THE BENCH. `desk.js` sells only where a `marina_desk` stands
 * with its clerk in the room (`work_zone_id`), and `refit` finishes a hull only in a `boat_covered`
 * room with a `repairman` in it. Keel is all three, so all three live in `zone_hulls_shop`. When he
 * goes home the desk is shut, which Fairweather's two clerks exist to avoid and this yard does not.
 *
 * ⚠ THE WET SLOT IS THE ROOM'S NORTH EXIT ONTO 921,900. `coveredSlot` (plugins/powerboat/yard.js)
 * finds a covered dock's water by its exits, so the helm puts a hull under this roof only if the room
 * links to open water. The `boatshed` arm draws the roof out over that tile on piles.
 *
 * Idempotent: every id derives from the slug, so a re-run is an upsert.
 */
import fs from 'node:fs';
import path from 'node:path';
import { authorBuilding, loadContentStore } from '../halcyon/lib.mjs';

const DRY = process.argv.includes('--dry-run');
const store = loadContentStore();

const RATE = 0.6;
const SLOT = 'zone_district_921_900';
const SHOP = 'zone_hulls_shop';

const hard = store.get('zones', 'zone_district_920_901');
if (hard?.flags?.terrain !== 'road') throw new Error('920,901 is not the hard yet: run moor-or-less/batch0.mjs first');

// The two rooms come over from Lever Lane with their old exits on them, and `authorBuilding` MERGES
// exits rather than replacing them. Cleared here so the old facade and the old room order don't
// survive as stale links.
for (const id of [SHOP, 'zone_hulls_back']) if (store.get('zones', id)) store.patch('zones', id, { exits: {} });

const spec = {
  slug: 'hulls', name: 'Moor or Less', type: 'boatshed',
  x: 921, y: 901, entrance: 'west', floors: 2, marker: 'ML', district: 'docks',

  facade: {
    bgColor: '#1a1a18', color: '#9a8a70',
    description: 'A tall timber boat shed on the hard, tarred black, with a corrugated roof that carries on out over the water on piles. MOOR OR LESS is painted on the gable in white house paint. The street door is ordinary. Round the water side, the doors are tall enough for a mast and stand open.',
  },

  rooms: [
    { key: 'shop', name: 'The Shed', floor: 'boards',
      description: 'A tall timber shed with its seaward doors open on a wet slot, the Basin slopping in and out under the roof. A hull stands on stocks along one side, planked to the waist. By the street door, a long bench with a sales book and a cash tin on it. Tools hang on shadow-boards on every wall.',
      window: {
        name: 'the seaward doors',
        description: 'Two doors the full height of the shed, propped open onto the slot and the Basin. Rain blows in when the wind is in the north.',
        light: 0.8, visibility: 0.9,
      } },
    { key: 'back', name: 'The Steam Box', floor: 'boards', from: 'shop', dir: 'east',
      description: 'A lean-to at the back of the shed. A long timber steam box sits over a firebox, warm for the first time in years. Planks wait in a rack beside it, cut to length and marked in pencil. A cot in the corner, and a stove with a kettle on it.',
      window: null },
  ],

  utility: {
    name: 'The Pump Pit', floor: 'dirt',
    description: 'Under the shed floor: the pump that keeps the slot from coming up into the shed at high water, the junction box on a post, and a lot of mud.',
  },

  lights: {
    back: { name: 'the bulkhead lamp', description: 'A caged lamp over the steam box, its glass gone brown with the heat.', lumens: 1600 },
  },

  props: [
    { key: '1', room: 'shop', name: 'the hull on the stocks', objectType: 'fixture',
      description: 'Forty feet of carvel planking on oak frames, planked to the waist with bare ribs above. The newest planks are pale. The oldest went grey in the shed on Lever Lane.',
      flags: { aliases: ['hull', 'boat', 'stocks', 'her', 'unfinished hull'],
        examine_detail: 'Every frame has a date pencilled on it. The first is twelve years old. The last is from last week.' } },
    { key: '2', room: 'shop', name: 'the shadow-boards', objectType: 'fixture',
      description: 'Boards on every wall with each tool outlined in white paint. Three outlines are empty. Those three tools are on the bench.',
      flags: { aliases: ['shadow-board', 'shadow-boards', 'boards', 'tools'] } },
    { key: '3', room: 'back', name: 'the steam box', objectType: 'fixture',
      description: 'A long timber box over a firebox, for softening planks so they take a bend. It is lit, and steam leaks from the joints along the lid.',
      flags: { aliases: ['steam box', 'box', 'firebox', 'planks', 'rack'] } },
    { key: 'desk', room: 'shop', name: 'the bench', objectType: 'furniture',
      description: 'A long workbench by the street door with a sales book on a string, a cash tin, and a Vaskin catalogue with the corners worn round. Hulls are sold and hired across it.',
      flags: { aliases: ['bench', 'desk', 'book', 'catalogue', 'tin'], marina_desk: true, interactions: ['use'] } },
    { key: 'hoist', room: 'shop', name: 'the chain hoist', objectType: 'fixture',
      description: 'A chain hoist on a beam over the wet slot, two canvas slings hanging off it. Hand-cranked, and the crank handle is wrapped in tape.',
      flags: { aliases: ['hoist', 'chain', 'slings', 'beam'] } },
    { key: 'slot', room: 'shop', name: 'the wet slot', objectType: 'fixture',
      description: 'A channel of open water running in under the shed from the Basin, wide enough for two hulls side by side. Tyres hang along both edges for fenders.',
      flags: { aliases: ['slot', 'water', 'channel', 'tyres'] } },
  ],

  npc: {
    id: 'npc_shipwright', name: 'Keel', sex: 'male', hp: 24,
    homeRoom: 'back', workRoom: 'shop', shopName: 'Moor or Less',
    description: 'A big man in his sixties in a scorched leather apron, with sawdust in the hair on his forearms. There is a carpenter\'s pencil behind one ear and another behind the other that he has forgotten about. He talks to the hull on the stocks more than he talks to customers.',
    clothing: [
      'a scorched leather apron',
      'a sweat-soaked workshirt with the sleeves rolled',
      'heavy canvas trousers gone stiff with tar',
      'rubber boots cut down to the ankle',
    ],
    schedule: {
      mon: [{ from: 6, to: 24 }], tue: [{ from: 6, to: 24 }], wed: [{ from: 6, to: 24 }],
      thu: [{ from: 6, to: 24 }], fri: [{ from: 6, to: 24 }], sat: [{ from: 6, to: 24 }], sun: [{ from: 6, to: 24 }],
    },
    inventory: [
      { item_id: 'item_hull_patch', price: 180 },
      { item_id: 'item_mooring_line', price: 70 },
      { item_id: 'item_boat_cover', price: 240 },
      { item_id: 'item_dinghy', price: 150 },
      { item_id: 'item_duct_tape', price: 11 },
      { item_id: 'item_industrial_tape', price: 15 },
      { item_id: 'item_solvent', price: 18 },
      { item_id: 'item_work_gloves', price: 13 },
      { item_id: 'item_pipe_wrench', price: 125 },
      { item_id: 'item_field_welder', price: 50 },
      { item_id: 'item_respirator_mask', price: 55 },
      { item_id: 'item_flashlight', price: 32 },
      { item_id: 'canteen', price: 15 },
      { item_id: 'item_towel_rough', price: 10 },
      { item_id: 'item_scrap_metal', price: 4 },
      { item_id: 'item_steel_plate', price: 7 },
      { item_id: 'item_spray_paint', price: 140 },
    ],
    chitchat: [
      'Keel planes a curl off the edge of a plank, sights along it, and planes another.',
      'He drives a fastening home in three blows, never four.',
      'Water slops up the slot and knocks a fender against the stocks.',
      'He stops, listens to an outboard going past outside, and shakes his head.',
      'He writes a figure on the slate by the bench, rubs it out with his thumb and writes a smaller one.',
    ],
    dialogue: {
      root: {
        text: '"Buying, hiring, berthing or broke?" Keel doesn\'t put the mallet down.',
        text_by_relation: {
          first: 'A big man in a leather apron is fitting a plank to the hull on the stocks. He finishes the stroke before he looks round.\n\n"Keel." He points the mallet at things as he names them. "Boats for sale and boats for hire, across that bench. Berths on the stages and the hard outside. Anything wrong with a hull, I fix it in here."\n\n"Same boats as the glass place on the west shore, and the same work. Six-tenths of the price, and the roof leaks."',
          known: '"You." He sets the mallet down on the plank. "What is it this time?"',
          familiar: '"Kettle\'s on the stove in the back." He doesn\'t look up from the plank. "What\'s she done?"',
        },
        options: [
          { label: 'I want to buy a boat.', next: 'buy' },
          { label: 'Can I hire one?', next: 'hire' },
          { label: 'Where do I keep her?', next: 'keep' },
          { label: 'How do I take her out?', next: 'drive' },
          { label: 'Where do I get fuel?', next: 'fuel' },
          { label: 'She needs work.', next: 'work' },
          { label: 'What else have you got?', next: '__shop__' },
          { label: 'What\'s the boat on the stocks?', next: 'hull' },
          { label: 'Nothing, thanks.', next: 'bye', enabled: true, actions: [], conditions: [] },
        ],
      },
      buy: {
        text: '"Vaskin hulls, off the same list the glass place sells from." He drops a catalogue on the bench, open. "Same price, too. I don\'t build them, I just sell them. She comes with a full tank and the first free berth in this yard."',
        actions: [{ action: 'BOAT_QUOTE', what: 'sale' }],
        options: [
          { label: 'I\'ll take the Rooster.', next: 'sell_hydro' },
          { label: 'I\'ll take the Spur.', next: 'sell_spur' },
          { label: 'I\'ll take the Gamecock.', next: 'sell_gamecock' },
          { label: 'Back up.', next: 'root' },
        ],
      },
      sell_hydro: {
        text: 'He licks a pencil and writes her into the book.',
        actions: [{ action: 'BOAT_SELL', hull: 'hydro' }],
        options: [{ label: 'How do I take her out?', next: 'drive' }, { label: 'Back up.', next: 'root' }],
      },
      sell_spur: {
        text: 'He licks a pencil and writes her into the book.',
        actions: [{ action: 'BOAT_SELL', hull: 'spur' }],
        options: [{ label: 'How do I take her out?', next: 'drive' }, { label: 'Back up.', next: 'root' }],
      },
      sell_gamecock: {
        text: 'He looks at you for a moment longer than he did for the other two, then writes her into the book.',
        actions: [{ action: 'BOAT_SELL', hull: 'gamecock' }],
        options: [{ label: 'How do I take her out?', next: 'drive' }, { label: 'Back up.', next: 'root' }],
      },
      hire: {
        text: '"Two hours, a full tank, one at a time." He nods at the keys on nails behind the bench. "Tie her up anywhere in this yard when you\'re done and she\'s back, or bring me the key sooner. No paint and no names on a hire."',
        actions: [{ action: 'BOAT_QUOTE', what: 'hire' }],
        options: [
          { label: 'Hire the Rooster.', next: 'hire_hydro' },
          { label: 'Hire the Spur.', next: 'hire_spur' },
          { label: 'Hire the Gamecock.', next: 'hire_gamecock' },
          { label: 'I\'m bringing a hire back.', next: 'return' },
          { label: 'Back up.', next: 'root' },
        ],
      },
      hire_hydro: {
        text: 'He takes a key off a nail.',
        actions: [{ action: 'BOAT_HIRE', hull: 'hydro' }],
        options: [{ label: 'How do I take her out?', next: 'drive' }, { label: 'Back up.', next: 'root' }],
      },
      hire_spur: {
        text: 'He takes a key off a nail.',
        actions: [{ action: 'BOAT_HIRE', hull: 'spur' }],
        options: [{ label: 'How do I take her out?', next: 'drive' }, { label: 'Back up.', next: 'root' }],
      },
      hire_gamecock: {
        text: 'He takes a key off the last nail, the one on its own.',
        actions: [{ action: 'BOAT_HIRE', hull: 'gamecock' }],
        options: [{ label: 'How do I take her out?', next: 'drive' }, { label: 'Back up.', next: 'root' }],
      },
      return: {
        text: 'He holds out a hand for the key.',
        actions: [{ action: 'BOAT_RETURN' }],
        options: [{ label: 'Back up.', next: 'root' }],
      },
      keep: {
        text: '"Three ways, and the roof\'s the dear one." He points with the mallet.\n\n"In here, in the slot under the roof, room for two: that\'s where I can work on her properly. Outside on the hard, on a cradle: cheapest. Or afloat on the stages, alongside, five berths."\n\n"Stand at a berth and <b>berth</b> reads you the board. <b>berth</b> and her name moves her in. <b>boats</b> tells you where she is now. Whatever the glass place charges, I charge six-tenths."',
        options: [
          { label: 'Where is mine now?', cmd: 'boats' },
          { label: 'Back up.', next: 'root' },
        ],
      },
      drive: {
        text: '"Go where she\'s lying and <b>board</b>. That puts you aboard. <b>helm</b> puts you at the wheel, and the controls card comes up the first time."\n\n"K is the key, and she won\'t start with the lever open. From the log, <b>conn start</b>, then <b>conn</b> with a bearing or a bell."\n\n"Coming home, stop alongside a berth and <b>disembark</b>. That ties her up. Do it on open water and you\'re swimming. If she dies out there, <b>tow</b> brings her home, and you settle the bill before she goes out again."',
        options: [{ label: 'Back up.', next: 'root' }],
      },
      fuel: {
        text: '"End of the outer stage. Hand pump on a drum." He mimes cranking it. "Come alongside, stop, and <b>fuel</b>. You pay by the unit, so a bigger tank costs more to fill."',
        options: [{ label: 'Back up.', next: 'root' }],
      },
      work: {
        text: '"I\'m in here from six in the morning to midnight." He taps the bench. "Stand in here with me and <b>refit</b>, and I\'ll put the hull back to sound wherever she\'s lying in this yard. Servicing, paint and a name, she has to be under this roof: <b>berth</b> her in the slot, or bring her in and stop. Then <b>refit service</b>, <b>refit paint</b> or <b>refit name</b>."\n\n"Away from here you patch her yourself. I sell the patches."',
        options: [{ label: 'Back up.', next: 'root' }],
      },
      hull: {
        text: '"Forty feet. Larch on oak." He runs a hand along the planking where it stops. "I started her in the shed on Lever Lane. It took four of us and a flatbed to get her down here."\n\nHe looks out through the open doors at the water.\n\n"She goes in when she\'s done. She\'s nearer it now than she\'s ever been."',
        options: [{ label: 'Back up.', next: 'root' }],
      },
      bye: {
        text: '"Mind the stage on your way out. It moves."',
        options: [],
      },
    },
  },
};

const ids = await authorBuilding(store, spec);

// The street door, with the shop lock it had on Lever Lane. Same id, new seam: the old link it sat
// on is deleted by ring-fenced.mjs.
store.patch('doors', 'door_shop_hulls_shop', {
  id: 'door_shop_hulls_shop', zone_id: ids.facadeId, exit_dir: 'east', target_zone: SHOP,
  connection_id: `conn_hf_${ids.facadeId.replace(/^zone_/, '')}_east`, door_type: 'basic', flags: {},
  hololock_difficulty: 5, hp: 1000, hp_max: 1000, is_locked: 0, is_open: 0, lock_state: 'locked', name: null,
  tags: { 'lock:shoplock': { canHack: true, difficulty: 4, messages: {
    denied: 'The shop lock reads your hand and declines to recognise it.',
    lock: 'The bolt drops and the shopfront goes quiet.',
    unlock: 'The bolt lifts. The shed door swings in.' } } },
});

// Keel lives in the Yards Tenement next door (his lockbox is there), so `authorBuilding`'s home in
// the back room is put back. The flags it wrote are only his clothes: he is still a vendor, and he is
// the yard's shipwright, which is what `refit` looks for.
const keel = store.get('npcs', 'npc_shipwright');
store.patch('npcs', 'npc_shipwright', {
  home_zone: 'zone_yards_tenement_u5_3',
  vendor_stock_size: 18,
  vendor_restock_rate: 1,
  flags: { ...(keel.flags || {}), personality: 'vendor', repairman: true },
});

// The shed is the covered dock, at the yard's rate, with its slot on the water to the north.
const shop = store.get('zones', SHOP);
store.patch('zones', SHOP, {
  exits: { ...(shop.exits || {}), north: SLOT },
  flags: { ...(shop.flags || {}), boat_covered: 2, yard_rate: RATE },
});
const slot = store.get('zones', SLOT);
store.patch('zones', SLOT, { exits: { ...(slot.exits || {}), south: SHOP } });
store.patch('connections', 'conn_hf_hulls_shop_north', {
  id: 'conn_hf_hulls_shop_north', a: SHOP, b: SLOT, dir: 'north', blocked: false, lockable: false, one_way: false,
});

// The rows `authorUtilityRoom` only writes on insert, so they still said Hulls Angels.
store.patch('furniture', `furn_light_${SHOP}`, {
  name: 'the work lamps',
  description: 'Two bare bulbs in tin shades on a wire strung across the shed, one over the bench and one over the slot.',
});
const gen = `gen_${ids.utilityRoomId}`;
if (store.get('generators', gen)) store.patch('generators', gen, { name: 'Moor or Less Junction Box' });

// The old shop->utility link, re-authored by `authorBuilding` as conn_hf_hulls_shop_down. Left in
// place it projects a second (zone_hulls_shop, down) edge and the import fails on zone_edges_pkey.
const removed = [];
for (const rel of ['connections/conn_hulls_shop_down_cf55.json']) {
  const p = path.join(store.baseDir, rel);
  if (fs.existsSync(p)) { if (!DRY) fs.unlinkSync(p); removed.push(rel); }
}

const written = store.flush({ dryRun: DRY });
console.log(`${DRY ? 'DRY RUN: ' : ''}${written.length} file(s) ${DRY ? 'would be written' : 'written'}, ${removed.length} ${DRY ? 'would be ' : ''}removed`);
for (const r of removed) console.log('  - ' + r);
console.log(`  facade ${ids.facadeId}  map ${ids.mapId}  utility ${ids.utilityRoomId}`);
