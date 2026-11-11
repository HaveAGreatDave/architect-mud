// One-shot authoring pass for the Solenne Residences' amenity floors in ROOM (docs/proposals/building-stage.md):
// Bishop's Blend, Sweat Equity, The Aerie, the Sky Deck and the Sky Pad. Each was a bare box with its rows
// stood wherever placeSpot put them. This writes each room's `flags.room` (size, glass, tone, finish), gives
// every row a `flags.look` and a `flags.spot`, and adds the rows the room text promises and nothing stood
// for. Idempotent: a file is only written when it would change.
//
//   node scripts/content/solenne-amenities.mjs
//
// The frame (client/shared/room-layout.js): every one of these rooms faces north (face 0), so its front
// wall is north, right is east, left is west and the door from the hall is in the back wall. A spot's
// `at` is [u, v] in metres, u east of the room's middle and v south of the north wall; `turn` 0 faces
// north, 90 east, 180 south, -90 west.
import fs from 'fs';
import { canonicalJson } from './lib.mjs';

const ZONES = 'content/zones/', FURN = 'content/furniture/';
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const GOLD = '#b8913e';
const base = { balcony: false, face: 0, finish: 'fine', studio: false };

const ROOMS = {
  // a coffee house in walnut, the east wall glass, a coffered ceiling and two small chandeliers
  zone_solenne_salon: {
    ...base, w: 12, d: 9, h: 3.4, glass: ['right'],
    tone: { accent: GOLD, ceiling: '#2a211b', trim: '#17130f', wall: '#3a2a20' },
    decor: {
      walls: { kind: 'walnut', hex: '#5a3a26', on: ['front', 'left', 'back'] },
      ceiling: { kind: 'coffer', hex: '#2a211b', trim: GOLD, band: 0.5, drop: 0.3, cell: 2.2 },
      downlights: false,
      lights: [{ at: [-2.6, 4.5], r: 0.6, tiers: 2, drop: 1.2, k: 1.4 }, { at: [2.6, 4.5], r: 0.6, tiers: 2, drop: 1.2, k: 1.4 }],
      sconces: { y: 1.9, points: [['left', 1.1], ['left', 7.9], ['front', -4.6], ['front', 1.4], ['back', -2.4], ['back', 2.2]] },
      art: [{ wall: 'front', at: 3.7, w: 1.8, h: 1.1, y: 1.95, seed: 21 }],
      plants: [[5.3, 8.25, 1], [-5.3, 8.3, 0.9]],
    },
  },
  // a members' room in dark blue and walnut, glass to the north and west, one big chandelier
  zone_solenne_aerie: {
    ...base, w: 13, d: 10, h: 3.6, glass: ['front', 'left'],
    tone: { accent: GOLD, ceiling: '#1e262d', trim: '#11161b', wall: '#27313a' },
    decor: {
      walls: { kind: 'walnut', hex: '#4a3324', on: ['back', 'right'] },
      ceiling: { kind: 'cove', hex: '#1e262d', trim: GOLD, band: 0.5, drop: 0.2 },
      downlights: false,
      lights: [{ at: [0, 5], r: 0.95, tiers: 3, drop: 1.5, k: 1.6 }],
      sconces: { y: 1.9, points: [['right', 1.5], ['right', 4], ['right', 6.5], ['back', -4.6], ['back', -2.2]] },
      art: [{ wall: 'right', at: 2.75, w: 1.6, h: 1.2, y: 1.95, seed: 5 }, { wall: 'right', at: 5.25, w: 1.6, h: 1.2, y: 1.95, seed: 44 }],
      plants: [[5.8, 0.9, 1.05], [-5.8, 9.2, 0.95]],
    },
  },
  // a gym: rubber underfoot, glass north and east, a run of mirror down the west wall
  zone_solenne_gym: {
    ...base, w: 14, d: 10, h: 3.6, glass: ['front', 'right'], ground: 'rubber',
    tone: { ceiling: '#f1f2f2', trim: '#2a2d31', wall: '#dfe3e6' },
    decor: { rug: false, mirrors: [{ wall: 'left', at: 4.2, w: 7.2, y0: 0.15, y1: 3.1 }], plants: [[-6.3, 9.2, 0.9]] },
  },
  // the roof: no ceiling, a glass screen on three sides, pale stone underfoot
  zone_solenne_skydeck: {
    ...base, w: 16, d: 11, h: 3, open: true, glass: ['front', 'left', 'right'], ground: 'stone',
    tone: { accent: GOLD, trim: '#1c1f23', wall: '#3a3f45' },
    decor: { downlights: false, rug: false, plants: [[7.2, 10.2, 1.1], [-7.2, 10.2, 1.1], [7.2, 3.8, 0.9]] },
  },
  // the pad: the same, with the circle painted on it and the two bays' doors in the wall behind
  zone_solenne_helipad: {
    ...base, w: 18, d: 18, h: 3, open: true, glass: ['front', 'left', 'right'], ground: 'stone',
    tone: { trim: '#1c1f23', wall: '#3a3f45' },
    decor: {
      downlights: false, rug: false, pad: { at: [0, 8], r: 6 },
      doors: [{ wall: 'back', at: -5.5, w: 2.4, finish: 'steel', label: 'Bay 1' }, { wall: 'back', at: 5.5, w: 2.4, finish: 'steel', label: 'Bay 2' }],
    },
  },
};

// rows that exist: what each is drawn as, and where it stands
const armchair = { arche: 'seat', form: 'armchair' };
const PLACE = {
  // Bishop's Blend: the counter down the west wall, the piano on the north one, the chess set and the
  // chesterfield by the glass
  furn_solenne_salon_espresso: { look: { arche: 'top', form: 'press' }, spot: { on: 'furn_salon_counter', x: -0.8 } },
  furn_salon_pastry: { spot: { wall: 'left', along: 6.3 } },
  furn_salon_papers: { spot: { wall: 'back', along: -4.6 } },
  furn_wanted_board_bishops: { look: { arche: 'prop', form: 'cabinet', dims: [0.6, 0.4, 1.6] }, spot: { wall: 'back', along: 3.6 } },
  furn_solenne_piano: { look: { arche: 'prop', form: 'piano' }, spot: { wall: 'front', along: -1.6 } },
  furn_solenne_chess_table: { look: { arche: 'table', form: 'games' }, spot: { at: [3.9, 3] } },
  furn_solenne_chess_chair_1: { look: armchair, spot: { at: [3.9, 2], turn: 180 } },
  furn_solenne_chess_chair_2: { look: armchair, spot: { at: [3.9, 4], turn: 0 } },
  furn_salon_settee: { spot: { at: [3.9, 6.3], turn: 90 } },
  // The Aerie: the bar in front of its bottles by the door, chairs at the north and west glass
  furn_aerie_bar: { spot: { at: [3.9, 8.2], turn: 0 } },
  furn_aerie_chairs: { spot: { at: [-2.3, 2.1], turn: 0 } },
  furn_aerie_telescope: { look: { arche: 'small', form: 'telescope' }, spot: { at: [4.6, 1], turn: 0 } },
  // Sweat Equity: the press and the rack under the mirrors, the treadmills at the north glass
  furn_solenne_bench_press: { look: { arche: 'bed', form: 'pressbench' }, spot: { wall: 'left', along: 2.6 } },
  furn_gym_rack: { look: { arche: 'store', form: 'weights' }, spot: { wall: 'left', along: 5.4 } },
  furn_gym_treadmill: { look: { arche: 'surface', form: 'treadmill' }, spot: { at: [-2.2, 1.6], turn: 0 } },
  furn_gym_bench: { spot: { wall: 'back', along: 3.4 } },
  furn_gym_towels: { spot: { wall: 'back', along: 5.4 } },
  furn_solenne_tv_gym: { spot: { wall: 'back', along: -3.6 } },
  // the Sky Deck: the pool along the north parapet, loungers beside it, the fire and a sofa to the east
  furn_solenne_pool: { look: { arche: 'surface', form: 'pool', dims: [12, 2.6, 0.5] }, spot: { at: [-1.2, 1.6], turn: 180 } },
  furn_skydeck_loungers: { look: { arche: 'sofa', form: 'lounger' }, spot: { at: [-5.4, 5], turn: -90 } },
  furn_skydeck_firepit: { look: { arche: 'fireplace', form: 'firetrough', dims: [2.4, 0.6, 0.45] }, spot: { at: [3.6, 5.6], turn: 180 } },
  furn_skydeck_table: { spot: { at: [3.6, 6.7] } },
  furn_solenne_bar: { spot: { wall: 'back', along: -4.6 } },
  furn_solenne_tv_skydeck: { spot: { wall: 'back', along: 4.8 } },
};

// rows the rooms' text promises, or a room this size needs, that nothing stood for
const row = (id, zone_id, name, object_type, description, flags) => ({ description, flags, hp: null, hp_max: null, id, light_type: null, lumen_output: null, name, object_type, power_draw_kw: null, price: 0, zone_id });
const SALON = 'zone_solenne_salon', AERIE = 'zone_solenne_aerie', GYM = 'zone_solenne_gym', DECK = 'zone_solenne_skydeck';
const aerieChair = (n, at, turn) => row(`furn_aerie_chair_${n}`, AERIE, 'leather armchair', 'furniture', 'A low armchair in tan leather, turned to the glass. The leather has gone soft where the arms are.', { aliases: 'armchair,chair', interactions: ['sit'], look: armchair, spot: { at, turn } });
const NEW = [
  row('furn_salon_counter', SALON, 'marble counter', 'furniture', 'A short counter in white marble with a walnut front. The espresso rig stands on it, and there is nowhere on it to put a price list.', { aliases: 'counter,bar', interactions: ['lean'], look: { arche: 'surface', form: 'bar', dims: [3, 0.75, 1.1] }, spot: { wall: 'left', along: 3.6 } }),
  row('furn_salon_wing_chair_1', SALON, 'wing chair', 'furniture', 'A high-backed chair in oxblood leather, deep enough to lose an afternoon in.', { aliases: 'wing chair,chair', interactions: ['sit'], look: armchair, spot: { at: [-1.7, 4.3], turn: 90 } }),
  row('furn_salon_wing_chair_2', SALON, 'wing chair', 'furniture', 'A high-backed chair in oxblood leather. Somebody has left a folded paper on the arm.', { aliases: 'wing chair,chair', interactions: ['sit'], look: armchair, spot: { at: [0.7, 4.3], turn: -90 } }),
  row('furn_salon_low_table', SALON, 'low table', 'furniture', 'A low walnut table between the wing chairs, ringed where cups have stood on it.', { aliases: 'table', interactions: ['lean'], look: { arche: 'table', form: 'coffee' }, spot: { at: [-0.5, 4.3], turn: 90 } }),
  row('furn_aerie_backbar', AERIE, 'back bar', 'decoration', 'Glass shelves of bottles lit from behind, floor to ceiling. None of them has a label you could afford to recognise.', { aliases: 'bottles,shelves,back bar', look: { arche: 'surface', form: 'barwall' }, spot: { wall: 'back', along: 3.9 } }),
  aerieChair(2, [-1.1, 2.1], 0),
  aerieChair(3, [2.4, 2.3], 0),
  aerieChair(4, [-4.3, 4.5], -90),
  aerieChair(5, [-4.3, 6], -90),
  row('furn_aerie_side_table', AERIE, 'drinks table', 'furniture', 'A small round table at elbow height between two of the chairs, with a coaster on it and nothing else.', { aliases: 'table', interactions: ['lean'], look: { arche: 'table', form: 'coffee', dims: [0.5, 0.5, 0.52] }, spot: { at: [-4.5, 5.25] } }),
  row('furn_gym_treadmill_2', GYM, 'treadmill', 'furniture', 'A treadmill facing the north glass, so you can run at the city and get no nearer.', { aliases: 'treadmill,runner', interactions: ['lean'], look: { arche: 'surface', form: 'treadmill' }, spot: { at: [-0.8, 1.6], turn: 0 } }),
  row('furn_skydeck_lounger_2', DECK, 'teak lounger', 'furniture', 'A teak lounger with a cream cushion, its back set to the pool.', { aliases: 'lounger,sunbed', interactions: ['sit', 'lie'], look: { arche: 'sofa', form: 'lounger' }, spot: { at: [-4.2, 5], turn: -90 } }),
  row('furn_skydeck_lounger_3', DECK, 'teak lounger', 'furniture', 'A teak lounger with a cream cushion. A folded towel waits at the foot of it.', { aliases: 'lounger,sunbed', interactions: ['sit', 'lie'], look: { arche: 'sofa', form: 'lounger' }, spot: { at: [-3, 5], turn: -90 } }),
  row('furn_skydeck_sofa', DECK, 'deck sofa', 'furniture', 'A deep outdoor sofa in grey canvas, facing the fire and the drop past it.', { aliases: 'sofa,couch', interactions: ['sit', 'lie'], look: { arche: 'sofa', form: 'sofa' }, spot: { at: [3.6, 7.95], turn: 0 } }),
];

const save = (file, data) => {
  const text = canonicalJson(data);
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) return 0;
  fs.writeFileSync(file, text, 'utf8');
  return 1;
};
let wrote = 0;
for (const [id, room] of Object.entries(ROOMS)) {
  const z = read(`${ZONES}${id}.json`);
  z.flags.room = room;
  wrote += save(`${ZONES}${id}.json`, z);
}
for (const [id, { look, spot }] of Object.entries(PLACE)) {
  const r = read(`${FURN}${id}.json`);
  r.flags = { ...(r.flags || {}), ...(look ? { look } : {}), spot };
  wrote += save(`${FURN}${id}.json`, r);
}
for (const r of NEW) {
  if (r.description.length > 300) throw new Error(`${r.id}: description over 300 characters`);
  wrote += save(`${FURN}${r.id}.json`, r);
}
console.log(`${wrote} files written`);
