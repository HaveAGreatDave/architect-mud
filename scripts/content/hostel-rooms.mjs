// ⚠ SUPERSEDED 2026-11-23: don't re-run. The first floor is now the mess (kitchen and dining), the room off the
// desk that was the kitchen is the toilets, and the rooms carry `torn`, `kit` and `bags`. The content files are
// the truth; re-running this puts the cots and the old kitchen back.
//
// ROOM interiors for Hostel Takeover (917,903), the free hostel beside the clone facility
// (docs/proposals/building-stage.md). Every room gets its `flags.room`, every drawn row a `flags.look` and
// `flags.spot`, and the rows the rooms need are added: cots by the dozen, the communal kitchen off the desk,
// the wash's showers and cubicles. It's run down on purpose: rubbish, magazines, damp, and the top floor's
// roof lets the rain in (gl/room-squat.js: `rubbish`, `mags`, `damp`, `leaks`).
//
//   node scripts/content/hostel-rooms.mjs
//   npm run content:lint
//   node scripts/content/building-stage.mjs map_int_trackmarks
//
// Idempotent: every id is fixed, and a file is only written when it would change. Edit this script and
// run it again, not the JSON.
//
// The frame (client/shared/room-layout.js): u is across the room, to the right as you face the front
// wall; v runs back from the front wall (0) to the back wall (d), in metres. A spot's `turn` 0 faces the
// front wall and 90 the right-hand wall. `along` is u on the front and back walls and v on the sides.
//
// Every room faces 180: front south (the street), right west, left east, back north. The stack climbs one
// flight per floor, each landing taking it from one side and sending the next up from the other, sized to
// the GLASS model's storeys (hosteltakeover.json, a tile is 17.86 m):
//   desk + kitchen + wash   the brick locking room, 9.3 by 8.6 m: desk south-east, kitchen west, wash north
//   first floor             the signal box's operating floor, 10 by 9 m
//   second floor            the red container laid across it, 13 by 5 m
//   third floor             the blue container turned a quarter round, 5.4 by 10.6 m, a metre east
//   fourth floor            the corrugated shed, 9.6 by 8.2 m
//   fifth floor             the plank cabin under the sign, 6.8 by 6.1 m, a little east. Its roof leaks
import fs from 'node:fs';
import path from 'node:path';
import { CONTENT_DIR, canonicalJson } from './lib.mjs';

const file = (dir, id) => path.join(CONTENT_DIR, dir, `${id}.json`);
const read = (dir, id) => JSON.parse(fs.readFileSync(file(dir, id), 'utf8'));
let wrote = 0;
const save = (dir, row) => {
  const f = file(dir, row.id), text = canonicalJson(row);
  if (fs.existsSync(f) && fs.readFileSync(f, 'utf8') === text) return;
  fs.writeFileSync(f, text, 'utf8');
  wrote++;
};

const plain = { balcony: false, studio: false, face: 180 };
// nicotine walls, a ceiling gone brown, the trim chipped to the primer
const TONE = { accent: '#6a5a3a', ceiling: '#b8ac8a', trim: '#3a3026', wall: '#a89a78' };
const STEEL = { accent: '#7a3a2a', ceiling: '#5a4a40', trim: '#2a2220', wall: '#8a3a2c' };     // the red container
const BLUE = { accent: '#2a4a6a', ceiling: '#3a4652', trim: '#1a2026', wall: '#3a5a7a' };      // the blue one
const TIN = { accent: '#6a6a62', ceiling: '#7a7a72', trim: '#3a3a36', wall: '#8a8a80' };       // corrugated sheet
const PLANK = { accent: '#6a4a2a', ceiling: '#5a4430', trim: '#2a2018', wall: '#7a5c3c' };     // the cabin

// ── THE ROOMS ───────────────────────────────────────────────────────────────────────────────────────
const ROOMS = {
  // The desk: the street door, the counter with the ledger, lockers, a sofa nobody should sit on, and
  // the stair up the east wall.
  zone_trackmarks_shop: {
    ...plain, w: 5.6, d: 5, h: 3, ground: 'tile',
    stair: { at: [-2.2, 0.6], climb: 'back', w: 0.9 },
    tone: TONE,
    decor: {
      rug: false,
      strips: [{ at: [0.6, 2.5], along: 'u', len: 1.2, cage: true }],
      rubbish: [{ at: [1.4, 1.5], r: [1.1, 0.6], n: 12, seed: 1 }, { at: [-0.8, 3.8], r: [0.5, 0.4], n: 5, seed: 2 }],
      mags: [{ at: [0.4, 1.4], n: 7, seed: 1 }],
      damp: [{ at: [1.8, 4.2], r: 0.5 }],
    },
  },
  // The communal kitchen: a worktop down the west wall with the hotplate at its end, a sink under the
  // back wall, the shared fridge, a long table, and a bin nobody empties.
  zone_hostel_kitchen: {
    ...plain, w: 3.4, d: 5, h: 3, ground: 'tile', windowless: true,
    tone: { ...TONE, wall: '#b0a47e' },
    decor: {
      rug: false,
      strips: [{ at: [0, 2.5], along: 'v', len: 1.2 }],
      rubbish: [{ at: [-0.9, 3.9], r: [0.6, 0.5], n: 14, seed: 3 }, { at: [0.4, 2.8], r: [0.5, 0.4], n: 6, seed: 4 }],
      mags: [{ at: [-1.1, 0.7], n: 4, seed: 2 }],
      damp: [{ at: [1.0, 4.4], r: 0.4 }],
    },
  },
  // The wash: three showers on the back wall, the trough sink beside them, two cubicles on the west wall.
  zone_trackmarks_back: {
    ...plain, w: 5.6, d: 3.6, h: 3, ground: 'tile', windowless: true,
    tone: { accent: '#5a6a6a', ceiling: '#b8b8a8', trim: '#3a4040', wall: '#c2c4b4' },
    decor: {
      rug: false,
      strips: [{ at: [0, 1.8], along: 'u', len: 1.2, cage: true }],
      rubbish: [{ at: [-0.6, 1.6], r: [0.6, 0.4], n: 6, seed: 5 }],
      damp: [{ at: [-1.1, 3.0], r: 0.7 }, { at: [1.6, 3.2], r: 0.4 }],
      grates: [[-1.1, 2.4, 0.5, 0.3]],
    },
  },
  // The first floor: the signal box's operating floor, cots in rows where the levers stood.
  zone_hostel_dorm: {
    ...plain, w: 10, d: 9, h: 2.8, ground: 'boards', glass: ['front', 'left', 'right'],
    doors: { down: [-4.0, 4.7] },
    stair: { at: [4.3, 0.8], climb: 'back', w: 0.9 },
    tone: TONE,
    decor: {
      rug: false,
      // the stove pipe up the middle
      pipes: [{ from: [0.6, 6.0, 0], to: [0.6, 6.0, 2.8], r: 0.09, hex: '#2a2420' }],
      strips: [{ at: [-1, 2.5], cage: true }, { at: [1.5, 6.4], cage: true }],
      rubbish: [{ at: [0.3, 5.6], r: [2.6, 0.5], n: 26, seed: 6 }, { at: [-2.4, 2.2], r: [1.2, 0.8], n: 12, seed: 7 }],
      mags: [{ at: [-3.3, 6.2], n: 6, seed: 3 }, { at: [2.2, 2.4], n: 4, seed: 4 }],
      damp: [{ at: [-2.5, 7.5], r: 0.6 }],
    },
  },
  // The second floor: the red container, cots down its north wall and one at each end.
  zone_hostel_dorm_2: {
    ...plain, w: 13, d: 5, h: 2.6, ground: 'metal', windowless: true,
    doors: { down: [4.3, 2.85] },
    stair: { at: [1.3, 1.0], climb: 'left', w: 0.9 },
    tone: STEEL,
    decor: {
      rug: false,
      strips: [{ at: [-3, 2.5], along: 'u', len: 1.2 }, { at: [3, 2.5], along: 'u', len: 1.2 }],
      rubbish: [{ at: [0, 3.4], r: [5, 0.4], n: 24, seed: 8 }],
      mags: [{ at: [-4.6, 3.3], n: 5, seed: 5 }, { at: [3.2, 3.3], n: 6, seed: 6 }],
      damp: [{ at: [-1.2, 4.2], r: 0.4 }],
    },
  },
  // The third floor: the blue container, cots head to foot down the east wall, flags hung between them.
  zone_hostel_dorm_3: {
    ...plain, w: 5.4, d: 10.6, h: 2.6, ground: 'metal', windowless: true,
    doors: { down: [-1.33, 3.8] },
    stair: { at: [2.0, 4.0], climb: 'back', w: 0.9 },
    tone: BLUE,
    decor: {
      rug: false,
      strips: [{ at: [0, 2.5], along: 'v', len: 1.2 }, { at: [0, 7.5], along: 'v', len: 1.2 }],
      rubbish: [{ at: [-0.8, 6.4], r: [0.5, 2.6], n: 18, seed: 9 }],
      mags: [{ at: [-1.2, 8.6], n: 7, seed: 7 }],
      damp: [{ at: [0.6, 9.4], r: 0.45 }],
    },
  },
  // The fourth floor: the shed on scaffold, cots on every wall and two down the middle.
  zone_hostel_dorm_4: {
    ...plain, w: 9.6, d: 8.2, h: 2.6, ground: 'boards', windowless: true,
    doors: { down: [0.93, 6.3] },
    stair: { at: [-3.0, 1.0], climb: 'back', w: 0.9 },
    tone: TIN,
    decor: {
      rug: false,
      strips: [{ at: [0.5, 2.5], cage: true }, { at: [0.5, 5.5], cage: true }],
      rubbish: [{ at: [0.6, 3.0], r: [1.8, 1.2], n: 22, seed: 10 }],
      mags: [{ at: [3.5, 6.3], n: 5, seed: 8 }],
      damp: [{ at: [-1.5, 6.8], r: 0.5 }, { at: [3.0, 2.2], r: 0.35 }],
    },
  },
  // The fifth floor: the plank cabin under the sign. Mattresses on the floor along the back wall, cots
  // down the sides, and three leaks in the roof with a bucket, a roasting tin and nothing under them.
  zone_hostel_dorm_5: {
    ...plain, w: 6.8, d: 6.1, h: 2.5, ground: 'boards', windowless: true,
    doors: { down: [-2.1, 3.09] },
    tone: PLANK,
    decor: {
      rug: false,
      strips: [{ at: [0.5, 2.0], cage: true }],
      rubbish: [{ at: [0.4, 3.0], r: [1.6, 0.9], n: 20, seed: 11 }],
      mags: [{ at: [1.9, 3.4], n: 8, seed: 9 }],
      damp: [{ at: [-1.0, 5.0], r: 0.9 }, { at: [2.4, 4.6], r: 0.6 }, { at: [0, 1.0], r: 0.5 }],
      leaks: [{ at: [0.5, 2.6], catch: 'bucket', r: 0.55 }, { at: [2.0, 1.7], catch: 'pan', r: 0.4 }, { at: [1.6, 4.0], catch: 'none', r: 0.35 }],
    },
  },
};

// ── THE ROWS THAT EXIST ─────────────────────────────────────────────────────────────────────────────
const PLACE = {
  // the desk
  furn_trackmarks_1: { look: { arche: 'surface', form: 'reception', dims: [1.8, 0.6, 1.05], wear: 0.95 }, spot: { at: [1.2, 2.6], turn: 180 } },
  furn_hostel_kettle: { look: { arche: 'top', form: 'kettle', wear: 0.95 }, spot: { on: 'furn_trackmarks_1', x: 0.55 } },
  furn_trackmarks_2: { look: { arche: 'store', form: 'locker', dims: [1.8, 0.5, 1.85], wear: 0.95 }, spot: { wall: 'back', along: 1.9 } },
  furn_hostel_sofa: { spot: { wall: 'front', along: 1.7 } },
  furn_hostel_telly: { spot: { wall: 'right', along: 1.5, y: 1.6 } },
  furn_hostel_chairs: { spot: { at: [-0.9, 2.3], turn: 270 } },
  furn_hostel_noticeboard: { look: { arche: 'prop', form: 'cabinet', dims: [0.9, 0.05, 0.7], wear: 0.85 }, spot: { wall: 'back', along: -1.3, y: 1.3 } },
  furn_hostel_ashtray: { spot: { at: [-0.4, 1.3], turn: 0 } },
  furn_hostel_heater: { spot: { at: [2.4, 1.5], turn: 0 } },
  // the kitchen: what was cooked on in the desk is in its own room now
  furn_hostel_hotplate: { zone: 'zone_hostel_kitchen', spot: { wall: 'right', along: 2.4 } },
  furn_hostel_fridge: { zone: 'zone_hostel_kitchen', spot: { wall: 'back', along: -0.9 } },
  furn_hostel_table: { zone: 'zone_hostel_kitchen', look: { arche: 'table', form: 'dining', dims: [1.6, 0.86, 0.76], wear: 0.95 }, spot: { at: [-0.2, 1.5], turn: 90 } },
  // the wash
  furn_trackmarks_3: { look: { arche: 'sink', form: 'trough', wear: 0.95 }, spot: { wall: 'front', along: 1.6 } },
  furn_hostel_washbench: { spot: { wall: 'left', along: 1.3 } },
  furn_hostel_dryer: { look: { arche: 'store', form: 'shelves', dims: [1.0, 0.4, 1.5], wear: 0.95 }, spot: { wall: 'front', along: -1.8 } },
  furn_hostel_laundry: { spot: { wall: 'front', along: -0.9 } },
  // the dorms' own
  furn_hostel_d1_chair: { spot: { at: [-3.2, 3.0], turn: 90 } },
  furn_hostel_d1_crates: { spot: { wall: 'front', along: 1.5 } },
  furn_hostel_d2_crates: { spot: { wall: 'front', along: -2.0 } },
  furn_hostel_d2_heater: { spot: { at: [-0.4, 3.0], turn: 0 } },
  furn_hostel_d3_crates: { spot: { wall: 'front', along: -1.2 } },
  furn_hostel_d3_table: { spot: { at: [-1.1, 6.3], turn: 0 } },
  furn_hostel_d4_sacks: { spot: { wall: 'front', along: 1.5 } },
  furn_hostel_d5_crates: { spot: { wall: 'front', along: 1.2 } },
  furn_hostel_d5_bucket: { spot: { at: [-0.3, 1.3], turn: 0 } },
};

// ── THE ROWS THE ROOMS NEED ─────────────────────────────────────────────────────────────────────────
const row = (id, zone_id, name, object_type, description, flags) => ({ description, flags, hp: null, hp_max: null, id, light_type: null, lumen_output: null, name, object_type, power_draw_kw: null, price: 0, zone_id });
const NEW = [
  // the kitchen
  row('furn_hostel_kitchen_worktop', 'zone_hostel_kitchen', 'the worktop', 'furniture',
    'A length of laminate worktop on breeze blocks, burnt in rings where pans went down hot. A bread knife is chained to it, and the chain is longer than the knife.',
    { aliases: ['worktop', 'counter', 'knife', 'chain'], interactions: ['lean'], look: { arche: 'surface', form: 'counter', dims: [1.6, 0.62, 0.92], wear: 0.95 }, spot: { wall: 'right', along: 1.0 } }),
  row('furn_hostel_kitchen_sink', 'zone_hostel_kitchen', 'the sink', 'fixture',
    'A steel sink full to the taps with everybody\'s washing-up, all of it soaking and none of it being washed. A sign over it says YOUR MUM DOESN\'T LIVE HERE.',
    { aliases: ['sink', 'tap', 'taps', 'washing-up', 'dishes', 'sign'], interactions: ['lean'], water_source: true, look: { arche: 'sink', form: 'kitchen', dims: [1.2, 0.6, 0.92], tier: 0, wear: 0.95 }, spot: { wall: 'right', along: 4.2 } }),
  row('furn_hostel_kitchen_shelves', 'zone_hostel_kitchen', 'the food shelves', 'furniture',
    'Steel shelves with names on masking tape along every edge. Most of the names have nothing above them any more. What\'s left is tins with no labels and half a jar of something brown.',
    { aliases: ['shelves', 'shelf', 'tins', 'jar', 'names', 'tape'], container: 20000, look: { arche: 'store', form: 'shelves', dims: [1.2, 0.4, 1.9], wear: 0.95 }, spot: { wall: 'front', along: -0.8 } }),
  row('furn_hostel_kitchen_bin', 'zone_hostel_kitchen', 'the bin', 'decoration',
    'A pedal bin with the pedal snapped off and the lid propped open by what\'s inside it. The rota taped to the wall above says whose turn it is. It was their turn in the spring.',
    { aliases: ['bin', 'rubbish', 'rota', 'lid'], look: { arche: 'small', form: 'box', dims: [0.4, 0.4, 0.62], wear: 1 }, spot: { at: [-1.3, 3.4], turn: 0 } }),
  // the wash
  ...[['first', -2.3, 'The first shower runs cold. The head has been bashed with something to clear it and now sprays mostly at the wall.'],
    ['second', -1.2, 'The second shower runs cold. A curtain of cut-up bin bag hangs on three of its eight rings.'],
    ['third', -0.1, 'The third shower runs colder than the other two. Its drain gurgles before it does anything, so everyone uses it last.']].map(([n, along, d]) =>
    row(`furn_hostel_shower_${n}`, 'zone_trackmarks_back', `${n} shower`, 'shower', d,
      { aliases: ['shower', 'showers', `${n} shower`], look: { arche: 'shower', form: 'stall', wear: 0.95 }, spot: { wall: 'back', along } })),
  ...[['first', 1.1, 'A cubicle with a door that has been kicked in so often it now opens both ways. The lock is a bent nail.'],
    ['second', 2.1, 'A cubicle with no seat on the pan and no paper on the roll. Somebody has written a phone number on the wall and somebody else has crossed it out.']].map(([n, along, d]) =>
    row(`furn_hostel_cubicle_${n}`, 'zone_trackmarks_back', `${n} cubicle`, 'toilet', d,
      { aliases: ['cubicle', 'stall', 'toilet', 'loo', `${n} cubicle`], look: { arche: 'stall', form: 'cubicle', wear: 0.95 }, spot: { wall: 'right', along } })),
];

// Cots: a canvas cot is the sofa archetype's 'cot' form, 1.9 m long. Along a wall it lies against it; in a
// row it stands head to the wall, turned 90 so its length runs back into the room.
const COT_TEXT = [
  'A canvas cot with the number in marker on the frame. The canvas has gone the shape of whoever slept in it last.',
  'A canvas cot with a blanket balled at the foot. There\'s a burn hole in the canvas just where your hip goes.',
  'A canvas cot, one leg propped on a brick. The number on the frame has been crossed out and written again.',
  'A canvas cot with a coat for a pillow. The coat isn\'t yours and nobody has come back for it.',
  'A canvas cot, the canvas patched with duct tape. It creaks when you look at it.',
];
const cotLook = { arche: 'sofa', form: 'cot', wear: 0.95 };
const COTS = {
  zone_hostel_dorm: [
    // three heads to the east wall north of the stair, six to the back wall, a row of five down the middle
    ...[5.6, 6.7, 7.8].map((v) => ({ at: [-4.0, v], turn: 0 })),
    ...[-2.5, -1.4, -0.3, 0.8, 1.9, 3.0].map((u) => ({ at: [u, 8.0], turn: 90 })),
    ...[-2.0, -0.9, 0.2, 1.3, 2.4].map((u) => ({ at: [u, 4.0], turn: 90 })),
  ],
  zone_hostel_dorm_2: [
    ...[-5.4, -3.4, -1.4, 0.6, 2.6].map((along) => ({ wall: 'back', along })),
    { wall: 'left', along: 2.5 }, { wall: 'right', along: 2.5 },
  ],
  zone_hostel_dorm_3: [
    ...[1.2, 3.2, 5.2, 7.2, 9.3].map((along) => ({ wall: 'left', along })),
    { wall: 'right', along: 1.2 }, { wall: 'right', along: 9.4 },
  ],
  zone_hostel_dorm_4: [
    ...[1.2, 3.2, 5.2, 7.2].map((along) => ({ wall: 'right', along })),
    ...[-3.8, -1.8, 0.2, 2.2].map((along) => ({ wall: 'back', along })),
    { at: [-1.5, 4.0], turn: 90 }, { at: [2.5, 4.0], turn: 90 },
    { wall: 'left', along: 1.5 }, { wall: 'left', along: 6.0 },
  ],
  zone_hostel_dorm_5: [{ wall: 'right', along: 1.2 }, { wall: 'right', along: 3.2 }, { wall: 'left', along: 1.0 }],
};
let n = 0;
for (const [zone, spots] of Object.entries(COTS)) {
  const floor = zone === 'zone_hostel_dorm' ? 1 : +zone.slice(-1);
  spots.forEach((spot, i) => {
    n++;
    NEW.push(row(`furn_hostel_cot_${floor}_${i + 1}`, zone, `cot ${floor}${String(i + 1).padStart(2, '0')}`, 'bed', COT_TEXT[(n * 3 + i) % COT_TEXT.length],
      { aliases: ['cot', 'cots', 'bed', `cot ${floor}${String(i + 1).padStart(2, '0')}`], interactions: ['sit', 'lie', 'sleep'], look: cotLook, spot }));
  });
}
// the top floor's mattresses, on the boards along the back wall
[-2.8, -1.6, -0.4, 0.8].forEach((along, i) => NEW.push(row(`furn_hostel_mattress_5_${i + 1}`, 'zone_hostel_dorm_5', `mattress ${i + 1}`, 'bed',
  ['A mattress on a pallet, the ticking stained in tide marks from the last time it rained.', 'A mattress on a pallet, pushed as far from the bucket as it will go. It\'s still damp at one corner.',
    'A mattress on a pallet with a plastic sheet over it, which is what passes for a roof up here.', 'A mattress on a pallet. It smells of wet dog, and there has never been a dog.'][i],
  { aliases: ['mattress', 'mattresses', 'pallet', 'bed', `mattress ${i + 1}`], interactions: ['sit', 'lie', 'sleep'], look: { arche: 'bed', form: 'mattress', wear: 1 }, spot: { wall: 'back', along } })));

// The old aggregate rows the cots replace on each floor: their text promised bunks, hammocks and pallets
const GONE = ['furn_hostel_bunks', 'furn_hostel_bunks_2', 'furn_hostel_bunks_3', 'furn_hostel_bunks_4', 'furn_hostel_bunks_5'];

// ── THE TEXT ────────────────────────────────────────────────────────────────────────────────────────
const TEXT = {
  zone_trackmarks_shop: 'The old locking room, with a counter where the lever rods came down through the ceiling. A sign-in ledger lies chained open on it beside a kettle that\'s never been switched off. Lockers stand along the back wall, half of them missing doors. A painted arrow points up the stairs: COTS, FIVE FLOORS, FIRST COME. The wash is north and the kitchen west.',
  zone_trackmarks_back: 'A back room tiled by three different people who never met. Three showers stand along the back wall. Two run cold and one runs colder. The sink is a steel trough, with a mirror screwed above it at the height of nobody in particular. Two cubicles with bad doors stand on the west wall. Somebody has scratched a tally of first mornings into the grout.',
  zone_hostel_dorm: 'The signal box\'s old operating floor, windowed on three sides, the lever frame long gone for scrap. Cots stand in rows where the levers were, numbered in marker, with the floor between them lost under cans, wrappers and other people\'s socks. A stove pipe runs up the middle to the floors above. A board on the stair says NO FIGHTING. NO DYING. WARDEN\'S ORDERS.',
  zone_hostel_dorm_2: 'A shipping container laid across the signal box roof, its doors welded shut at one end and cut through at the other for the stair. Cots run down the north wall end to end, with a gangway beside them just wide enough to turn in. The ribs inside are painted in alternating colours, so you can count your way to a cot in the dark.',
  zone_hostel_dorm_3: 'The second container, stacked on the first and turned a quarter round, so this floor points down the cut. Two portholes have been cut in the side with a gas axe and glazed with bus windows. Cots run head to foot down the east wall, with a curtain of old flags between each one and the next, which is as private as this building gets.',
  zone_hostel_dorm_4: 'A shed of corrugated sheet on scaffold poles, with more washers holding the roof down than bolts. Cots stand on every wall and two down the middle, the light ones, because bunks would weigh too much this high up. When the wind gets up the whole floor sways a little. The regulars sleep through it, and the new ones lie very still.',
  zone_hostel_dorm_5: 'A plank cabin at the top of the stack, with the sign\'s frame bolted through its roof. The roof lets the rain in at three places, and there\'s a bucket under one, a roasting tin under another and a wet patch under the third. Mattresses lie on pallets along the back wall, as far from the leaks as they go. The FREE ROOMS tube buzzes overhead all night and turns the room red, then dark, then red.',
};
const AMBIENT = {
  zone_hostel_dorm_5: [
    'The sign overhead buzzes, cuts out, and the room goes dark for a breath before it comes back red.',
    'Somebody turns over on a pallet and pulls the blanket over their eyes against the red.',
    'Wind whistles through the gaps between the planks.',
    'Water drips into the bucket, a slow plink that everyone up here has learned to sleep through.',
    'A drop lands on somebody\'s face. They wipe it off without waking and turn over.',
  ],
};

// The kitchen zone, off the desk's west wall
const KITCHEN = {
  ambient_events: [
    'The fridge shudders, hums, and shudders again.',
    'A tap drips into the washing-up. Nobody has turned it off properly in years.',
    'Somebody opens the fridge, looks for a long time at a carton with someone else\'s name on it, and drinks from it.',
    'The hotplate ticks as it cools.',
  ],
  ambient_theme: 'indoors',
  bg_color: '#241f19',
  color: '#c9a86a',
  description: 'A narrow kitchen made out of the locking room\'s old battery store. A worktop on breeze blocks, a hotplate and a sink full of washing-up run down the west wall. A long table takes up the rest, with a bin beside it that nobody empties. The desk is east.',
  exits: { east: 'zone_trackmarks_shop' },
  flags: {
    building_name: 'Hostel Takeover', building_type: 'hostel', floor: 'tile', is_building: true, is_interior: true,
    region_id: 'region_coldwater', sanctuary: true, world_exit_zone: 'zone_district_917_903',
  },
  grid_x: -1, grid_y: 0, grid_z: 0,
  id: 'zone_hostel_kitchen',
  map_id: 'map_int_trackmarks',
  name: 'Hostel Takeover, the kitchen',
  parent_zone: 'zone_district_917_903',
};

// ── WRITE ───────────────────────────────────────────────────────────────────────────────────────────
{
  const k = fs.existsSync(file('zones', KITCHEN.id)) ? read('zones', KITCHEN.id) : {};
  save('zones', { ...k, ...KITCHEN, flags: { ...KITCHEN.flags, room: ROOMS.zone_hostel_kitchen } });
  save('connections', { a: 'zone_trackmarks_shop', b: 'zone_hostel_kitchen', blocked: false, dir: 'west', id: 'conn_trackmarks_shop_west_hk01', lockable: false, one_way: false });
  // its power and its light, on the hostel's own generator like every other room in it
  save('power_zones', { capacity_kw: 200, flags: {}, generator_id: 'gen_zone_util_zone_trackmarks_shop', id: 'zone_hostel_kitchen', max_capacity_kw: 200, name: 'Hostel Takeover, the kitchen', source_type: 'city_grid' });
  save('furniture', { description: 'A strip light with one tube working and the other flickering at the ends, which is worse.', flags: {}, hp: null, hp_max: null, id: 'furn_light_zone_hostel_kitchen', light_type: 'overhead', lumen_output: 1200, name: 'strip light', object_type: 'light', power_draw_kw: 0.02, price: 0, zone_id: 'zone_hostel_kitchen' });
}
for (const [id, room] of Object.entries(ROOMS)) {
  if (id === 'zone_hostel_kitchen') continue;
  const z = read('zones', id);
  z.flags.room = room;
  if (TEXT[id]) z.description = TEXT[id];
  if (AMBIENT[id]) z.ambient_events = AMBIENT[id];
  if (id === 'zone_trackmarks_shop') z.exits = { ...z.exits, west: 'zone_hostel_kitchen' };
  save('zones', z);
}
for (const [id, { look, spot, zone }] of Object.entries(PLACE)) {
  const r = read('furniture', id);
  r.flags = { ...(r.flags || {}), ...(look ? { look: { ...(r.flags?.look || {}), ...look } } : {}), spot };
  if (zone) r.zone_id = zone;
  save('furniture', r);
}
for (const r of NEW) {
  if (r.description.length > 300) throw new Error(`${r.id}: description over 300 characters`);
  if (/—/.test(r.description + r.name)) throw new Error(`${r.id}: em dash`);
  save('furniture', r);
}
// and any cot or mattress a shorter list no longer writes
const made = new Set(NEW.map((r) => r.id));
for (const fn of fs.readdirSync(path.join(CONTENT_DIR, 'furniture'))) { const id = fn.replace(/.json$/, ''); if (/^furn_hostel_(cot|mattress)_/.test(id) && !made.has(id)) { fs.unlinkSync(file('furniture', id)); wrote++; } }
for (const id of GONE) if (fs.existsSync(file('furniture', id))) { fs.unlinkSync(file('furniture', id)); wrote++; }
console.log(`hostel-rooms: ${wrote} files written, ${n} cots`);
