// ROOM interiors for the two marinas, the Deadleg's racer bay and every truck depot's bunkroom
// (docs/proposals/building-stage.md). Each room gets its `flags.room` (size, facing, finish, decor),
// every drawn row in it a `flags.look` and a `flags.spot`, and the rows the room text promises that
// nothing stood for are added. The two covered slips and the racer bay carry `flags.room.stand`, where a
// called-up boat or racer is drawn (the vehicle stand contract: kind, at, face, len, wid, from, water).
//
//   node scripts/content/depot-rooms.mjs
//   npm run content:lint
//   node scripts/content/building-stage.mjs map_int_consv   (and map_int_hulls, map_int_yard_*)
//
// Idempotent: every id is fixed, and a file is only written when it would change. Edit this script and
// run it again, not the JSON. Every room here already has its `power_zones` row and a light.
//
// The frame (client/shared/room-layout.js): u is across the room, to the right as you face the front
// wall; v runs back from the front wall (0) to the back wall (d), in metres. A spot's `turn` 0 faces the
// front wall and 90 the right-hand wall. `along` is u on the front and back walls and v on the sides.
//
// Facings, so the plan's compass is plain:
//   Fairweather lobby     face 180: front south (the quay glass and street door), right west (the
//                         counter), left east (the dock hall), back north (Anchovies)
//   Fairweather counter   face 270: front west (the Hardstanding door), right north, back east (lobby)
//   Fairweather hall      face 90: front east (the water gate), right south, left north (the bench),
//                         back west (the lobby). The stair up to the gallery runs along the back wall
//   Fairweather bench     face 0: front north, back south (the hall)
//   Fairweather gallery   face 90, over the hall's back wall
//   Eastern Marina shed   face 0: front north (the seaward doors and the slot), left west (the street
//                         door), right east (the steam box)
//   Steam box             face 90: back west (the shed)
//   Deadleg racer bay     face 90: front east, back west (the shed), its door 3 m north of its middle
//   Bunkrooms             facing away from the shed, the door in the back wall
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

const plain = { balcony: false, studio: false };
const r2 = (n) => Math.round(n * 100) / 100;

// ── FAIRWEATHER MARINA ──────────────────────────────────────────────────────────────────────────────
const CHAMPAGNE = '#c9b48a';
// the covered slip in the dock hall: water from the gate in the front wall 14 m back into the hall
const HALL_SLIP = { u: 0, v: 7, len: 14, wid: 5.5 };
// the gallery stair: up the back wall from beside the lobby door, climbing north
const HALL = { w: 18, d: 24, h: 4.6 };
const HALL_STAIR = { at: [-1.3, r2(HALL.d - 0.65)], climb: 'left', w: 1.1 };
const LOFT = { w: 11, d: 4.5 };

const slipDecor = (s, kerb) => [
  // a timber kerb round the slip, and a yellow line a step back from it on the deck
  { kind: 'box', rect: [r2(s.u - s.wid / 2 - 0.25), r2(s.u + s.wid / 2 + 0.25), 0, r2(s.v + s.len / 2 + 0.25)], t: 0.25, hex: kerb },
  { kind: 'line', from: [r2(s.u - s.wid / 2 - 0.75), 0.3], to: [r2(s.u - s.wid / 2 - 0.75), r2(s.v + s.len / 2 + 0.75)], t: 0.08, hex: '#e8b818' },
  { kind: 'line', from: [r2(s.u + s.wid / 2 + 0.75), 0.3], to: [r2(s.u + s.wid / 2 + 0.75), r2(s.v + s.len / 2 + 0.75)], t: 0.08, hex: '#e8b818' },
  { kind: 'line', from: [r2(s.u - s.wid / 2 - 0.75), r2(s.v + s.len / 2 + 0.75)], to: [r2(s.u + s.wid / 2 + 0.75), r2(s.v + s.len / 2 + 0.75)], t: 0.08, hex: '#e8b818' },
];
const standOf = (kind, s, from, water) => ({ kind, at: [s.u, s.v], face: 'front', len: s.len, wid: s.wid, from, ...(water ? { water: true } : {}) });

const ROOMS = {
  // A club-house lobby: pale stone, glass onto the quay, one desk and the brushed steel board behind it.
  zone_marina_lobby: {
    ...plain, face: 180, w: 12, d: 9, h: 4.2, glass: ['front'], ground: 'stone',
    street_door: { kind: 'sliding', w: 2 },
    tone: { accent: CHAMPAGNE, ceiling: '#f1efea', trim: '#8a8478', wall: '#e6e2da' },
    decor: {
      rug: false,
      ceiling: { kind: 'cove', hex: '#ece8e0', trim: CHAMPAGNE, band: 0.45, drop: 0.25 },
      // the berth board: the whole back wall in brushed steel either side of the dark glass doors
      walls: { kind: 'bronze', hex: '#a9aeb2', trim: '#8a9096', on: ['back'] },
    },
  },
  // The chandlery: shelves down the left wall, the counter across the far end by the yard door.
  zone_consv_counter: {
    ...plain, face: 270, w: 4.6, d: 9, h: 3.2, doors: { west: 1.3 },
    tone: { accent: '#9a7a4a', ceiling: '#e8e2d6', trim: '#4a3a2a', wall: '#d9d1c2' },
    decor: { rug: false, strips: [{ at: [0, 3], along: 'v', len: 1.4 }, { at: [0, 6.5], along: 'v', len: 1.4 }] },
  },
  // A roof over a dock: decks either side of the slip, columns, the travel hoist's rails overhead.
  zone_consv_hall: {
    ...plain, face: 90, ...HALL, glass: ['right'], ground: 'concrete',
    stair: HALL_STAIR,
    stand: standOf('boat', HALL_SLIP, 'front', true),
    tone: { accent: '#9aa3a8', ceiling: '#d8dcdf', trim: '#3a4046', wall: '#c9ced2' },
    decor: {
      rug: false,
      columns: [[-4.6, 4, 0.3], [4.6, 4, 0.3], [-4.6, 10, 0.3], [4.6, 10, 0.3], [-4.6, 16.5, 0.3], [4.6, 16.5, 0.3]],
      paint: [
        ...slipDecor(HALL_SLIP, '#6a5238'),
        // the cradles' bays down the south deck
        { kind: 'box', rect: [5.6, 8.9, 2.2, 7.2], t: 0.05, hex: '#d8dcdf' },
        { kind: 'box', rect: [5.6, 8.9, 7.8, 12.8], t: 0.05, hex: '#d8dcdf' },
      ],
      // the travel hoist: a rail each side of the slip and the gantry across it
      pipes: [
        { from: [-3.4, 0.3, 4.3], to: [-3.4, 20, 4.3], r: 0.11, hex: '#4a5056' },
        { from: [3.4, 0.3, 4.3], to: [3.4, 20, 4.3], r: 0.11, hex: '#4a5056' },
        { from: [-3.4, 8, 4.05], to: [3.4, 8, 4.05], r: 0.14, hex: '#e8b818' },
      ],
      strips: [
        { at: [-6.5, 4], along: 'v', len: 2 }, { at: [-6.5, 11], along: 'v', len: 2 }, { at: [-6.5, 18], along: 'v', len: 2 },
        { at: [6.5, 4], along: 'v', len: 2 }, { at: [6.5, 11], along: 'v', len: 2 }, { at: [6.5, 18], along: 'v', len: 2 },
        { at: [0, 18.5], along: 'u', len: 2 },
      ],
      signs: [
        { wall: 'front', along: -6, y: 2.4, text: 'Deep Water', h: 0.12, hex: '#ffffff', plateHex: '#7a1a14' },
        { wall: 'front', along: 6, y: 2.4, text: 'No Mooring', h: 0.12, hex: '#ffffff', plateHex: '#7a1a14' },
        { wall: 'left', along: 12, y: 2.6, text: 'Workshop', h: 0.12, hex: '#1b1e22', plateHex: '#e8e4da' },
      ],
      lamps: [{ wall: 'front', along: -3.6, y: 3.6, hex: '#ffb020' }, { wall: 'front', along: 3.6, y: 3.6, hex: '#ffb020' }],
    },
  },
  // The working bay: one long hardwood bench under the tool board, the cutaway on the end wall.
  zone_consv_bench: {
    ...plain, face: 0, w: 9, d: 5, h: 3.2, ground: 'concrete', windowless: true,
    tone: { accent: '#8a6a44', ceiling: '#e2ddd2', trim: '#3a3026', wall: '#d6d0c4' },
    decor: {
      rug: false,
      walls: { kind: 'walnut', hex: '#7a5a3c', trim: '#2a2420', on: ['front'], y1: 2.6 },
      strips: [{ at: [-2, 0.9], along: 'u', len: 1.6 }, { at: [2, 0.9], along: 'u', len: 1.6 }],
      signs: [{ wall: 'left', along: 2.5, y: 2.2, text: 'Wear a Mask', h: 0.08, hex: '#101010', plateHex: '#e8c040' }],
    },
  },
  // The gallery over the hall: a long room under the roof glass, a bed at the south end and a desk at the north.
  zone_consv_loft: {
    ...plain, face: 90, w: LOFT.w, d: LOFT.d, h: 2.6, glass: ['front'],
    // where the stair's top lands, so the gallery's back wall stands over the hall's
    doors: { down: [r2(-LOFT.w / 2 + 0.62), r2(LOFT.d - 0.65)] },
    tone: { accent: '#9aa3a8', ceiling: '#e8e6e2', trim: '#3a4046', wall: '#dcd8d0' },
    decor: { art: [{ wall: 'left', at: 1.0, w: 0.6, h: 0.42, y: 1.55, seed: 12 }] },
  },

  // ── EASTERN MARINA ──
  // A tall timber shed over a wet slot, the seaward doors in the front wall, the sales bench by the street door.
  zone_hulls_shop: {
    ...plain, face: 0, w: 12, d: 18, h: 7, windowless: true, doors: { north: 1.5 },
    stand: standOf('boat', { u: 1.5, v: 6, len: 12, wid: 4.5 }, 'front', true),
    tone: { accent: '#6a5a44', ceiling: '#3a2e24', trim: '#241c16', wall: '#5e4a36' },
    decor: {
      rug: false,
      walls: { kind: 'walnut', hex: '#6b5236', trim: '#3a2e24', on: ['left', 'right', 'back'], y1: 3.2 },
      paint: slipDecor({ u: 1.5, v: 6, len: 12, wid: 4.5 }, '#4a3a2a'),
      // the beam the chain hoist runs on, over the slot
      pipes: [{ from: [1.5, 1, 6.2], to: [1.5, 12.5, 6.2], r: 0.13, hex: '#3a3530' }],
      pendants: [{ at: [-3.4, 6.2], y: 3.4, kind: 'school', k: 1.2 }, { at: [4.9, 9], y: 3.6, kind: 'school', k: 1.2 }],
    },
  },
  // The lean-to: the steam box along the end wall over its firebox, planks racked, a cot, a stove.
  zone_hulls_back: {
    ...plain, face: 90, w: 6, d: 4.5, h: 2.8, windowless: true,
    tone: { accent: '#6a5a44', ceiling: '#3a2e24', trim: '#241c16', wall: '#5e4a36' },
    decor: { rug: false, walls: { kind: 'walnut', hex: '#6b5236', trim: '#3a2e24', y1: 2.8 }, strips: [{ at: [0, 1.4], cage: true }] },
  },
};

// ── THE DEADLEG RACER BAY ──
// The racer comes up from the garage under the yard on a lift, in the middle of the bay inside hazard paint.
const RACER = { u: 1.5, v: 6.6, len: 10.5, wid: 5.5 };
{
  const door = -3, strip = [];
  // a chequered strip across the floor inside the shed door: white squares on the bare slab, two rows
  for (let j = 0; j < 2; j++) for (let i = 0; i < 16; i++) {
    if ((i + j) % 2) continue;
    const u0 = r2(door - 1.2 + i * 0.15), v = r2(13.35 - j * 0.15);
    strip.push({ kind: 'line', from: [u0, v], to: [r2(u0 + 0.15), v], t: 0.15, hex: '#e8e4da' });
  }
  ROOMS.zone_racerbay_deadleg = {
    ...plain, face: 90, w: 12, d: 14, h: 5, windowless: true, ground: 'concrete', doors: { west: 3 },
    stand: standOf('podracer', RACER, 'below', false),
    tone: { accent: '#8a6a4a', ceiling: '#33302c', trim: '#221e1a', wall: '#5b4c40' },
    decor: {
      rug: false,
      paint: [
        { kind: 'hazard', rect: [r2(RACER.u - RACER.wid / 2 - 0.2), r2(RACER.u + RACER.wid / 2 + 0.2), r2(RACER.v - RACER.len / 2 - 0.2), r2(RACER.v + RACER.len / 2 + 0.2)], t: 0.18 },
        ...strip,
      ],
      // turbines on their stands along the south wall
      pumps: [[5.3, 3.2], [5.3, 6.6], [5.3, 10]],
      // cable on pegs over the bench
      drops: [{ wall: 'left', along: 9.4, n: 4, r: 0.03 }, { wall: 'left', along: 10.6, n: 3, r: 0.035 }],
      strips: [{ at: [RACER.u, RACER.v], along: 'v', len: 1.6 }, { at: [-4.4, 7.5], along: 'v', len: 1.2, cage: true }],
      chalk: [{ wall: 'left', at: 3.2, y: 1.6, w: 1.3, h: 0.95, title: 'Racers' }],
      grates: [[-4.2, 3, 0.6, 0.6]],
    },
  };
}

// ── THE BUNKROOMS ──
// Every depot's is the same room: four cots heads to the walls, a toilet behind a partition in the front
// right corner, the set up in the front left corner, the fridge and two lockers either side of the door.
const BUNKS = {
  zone_bunk_deadleg: { key: 'deadleg', face: 0 },
  zone_bunk_bonded: { key: 'bonded', face: 0, art: { wall: 'back', at: 1.0, w: 0.5, h: 0.7, y: 1.5, seed: 3 } },
  zone_bunk_dryrun: { key: 'dryrun', face: 0, art: { wall: 'right', at: 1.6, w: 0.45, h: 0.6, y: 1.6, seed: 8 } },
  zone_bunk_lastload: { key: 'lastload', face: 90 },
  zone_bunk_roadhead: { key: 'roadhead', face: 0, window: true },
};
const BUNK = { w: 6.4, d: 6.8, h: 2.7 };
for (const [id, b] of Object.entries(BUNKS)) {
  ROOMS[id] = {
    ...plain, face: b.face, ...BUNK, ground: 'tile', ...(b.window ? {} : { windowless: true }),
    walls: [[1.7, 1.8, 0, 1.5], [1.8, 2.4, 1.4, 1.5]],
    tone: { ceiling: '#d8d4c8', trim: '#3a3a36', wall: '#b8b2a2' },
    decor: {
      rug: false,
      strips: [{ at: [0, 3.4], along: 'v', len: 1.2 }],
      mirrors: [{ wall: 'left', at: 5.1, w: 0.7, y0: 1.2, y1: 1.45 }],
      ...(b.art ? { art: [b.art] } : {}),
    },
  };
}

// ── THE ROWS THAT EXIST ─────────────────────────────────────────────────────────────────────────────
const cot = { arche: 'bed', form: 'bed', dims: [0.85, 1.95, 0.5] };
const PLACE = {
  // the lobby's desk, a little back of the middle, and the board on the steel wall behind it
  furn_marina_desk: { look: { arche: 'surface', form: 'reception', dims: [3.4, 0.85, 1.05] }, spot: { at: [-3, 6.4], turn: 0 } },
  furn_marina_board: { look: { arche: 'prop', form: 'cabinet', dims: [3.4, 0.06, 1.4] }, spot: { wall: 'back', along: -3, y: 1.75 } },
  // Anchovies keeps its own spec; its rows are stood where its text puts them, now that the lobby's back
  // door shows it: the stone bar across the back beside the door, one of the twelve covers at the north glass
  furn_anch_bar: { spot: { wall: 'back', along: 3.2 } },
  furn_anch_tables: { look: { arche: 'table', form: 'dining', dims: [1.4, 0.9, 0.76] }, spot: { at: [0, 1.3], turn: 0 } },
  // the counter: charts on the right wall, the kettle on the counter
  furn_consv_charts: { look: { arche: 'store', form: 'bookcase', dims: [1.2, 0.36, 2] }, spot: { wall: 'right', along: 6.4 } },
  furn_consv_kettle: { look: { arche: 'top', form: 'kettle' }, spot: { on: 'furn_consv_counter_top', x: -0.7 } },
  // the hall: the cradles down the south deck
  furn_consv_cradles: { look: { arche: 'surface', form: 'rail', dims: [10, 0.12, 1.1] }, spot: { wall: 'right', along: 7.5 } },
  // the bench along the front wall, the cutaway on its stand at the east end
  furn_consv_bench_top: { look: { arche: 'surface', form: 'desk', dims: [7.6, 0.85, 0.92] }, spot: { wall: 'front', along: 0 } },
  furn_consv_moulds: { look: { arche: 'prop', form: 'easel', dims: [1, 0.7, 1.6] }, spot: { wall: 'right', along: 3 } },
  // the Eastern Marina's sales bench by the street door, and the steam box along the lean-to's end wall
  furn_hulls_desk: { look: { arche: 'surface', form: 'desk', dims: [2.6, 0.75, 0.9] }, spot: { wall: 'left', along: 6.2 } },
  furn_hulls_3: { look: { arche: 'fireplace', form: 'firetrough', dims: [3.4, 0.7, 0.8] }, spot: { wall: 'front', along: 0 } },
};
for (const b of Object.values(BUNKS)) {
  const k = b.key;
  Object.assign(PLACE, {
    [`furn_bunk_${k}_cot1`]: { look: cot, spot: { wall: 'left', along: 2 } },
    [`furn_bunk_${k}_cot2`]: { look: cot, spot: { wall: 'left', along: 3.3 } },
    [`furn_bunk_${k}_cot3`]: { look: cot, spot: { wall: 'right', along: 3.3 } },
    [`furn_bunk_${k}_cot4`]: { look: cot, spot: { wall: 'right', along: 4.6 } },
    [`furn_bunk_${k}_tv`]: { look: { arche: 'screen', form: 'flat', dims: [0.9, 0.12, 0.55] }, spot: { wall: 'front', along: -2.3, y: 2 } },
    [`furn_bunk_${k}_fridge`]: { look: { arche: 'cold', form: 'fridge', dims: [0.62, 0.64, 1.45] }, spot: { wall: 'back', along: -2.3 } },
    [`furn_bunk_${k}_sink`]: { look: { arche: 'sink', form: 'basin' }, spot: { wall: 'left', along: 5.1 } },
    [`furn_bunk_${k}_toilet`]: { look: { arche: 'toilet', form: 'pan' }, spot: { wall: 'front', along: 2.6 } },
  });
}

// ── THE ROWS THE TEXT PROMISES ──────────────────────────────────────────────────────────────────────
const row = (id, zone_id, name, object_type, description, flags) => ({ description, flags, hp: null, hp_max: null, id, light_type: null, lumen_output: null, name, object_type, power_draw_kw: null, price: 0, zone_id });
const NEW = [
  row('furn_consv_counter_top', 'zone_consv_counter', 'the counter', 'furniture',
    'A hardwood counter across the end of the shop, oiled dark, with a lift-up flap at the yard door end. A brass rule is let into the top for measuring line.',
    { aliases: ['counter', 'flap', 'rule'], interactions: ['lean'], look: { arche: 'surface', form: 'bar', dims: [2.6, 0.7, 1.05] }, spot: { at: [-0.9, 1.4], turn: 180 } }),
  row('furn_consv_chandlery', 'zone_consv_counter', 'the chandlery shelves', 'decoration',
    'Steel shelving the length of the wall: shackles and thimbles in labelled drawers, fenders hung by size, line on drums by diameter, and boxed parts on the top shelf with the prices facing out.',
    { aliases: ['shelves', 'chandlery', 'shackles', 'thimbles', 'fenders', 'line', 'drums', 'parts', 'fuel cards'], look: { arche: 'store', form: 'shelves', dims: [4.6, 0.45, 2.1] }, spot: { wall: 'left', along: 4.6 } }),
  row('furn_consv_loft_bed', 'zone_consv_loft', 'the gallery bed', 'furniture',
    'A low bed behind a curtain on a ceiling track, made up tight. A torch and a tide table are on the shelf at its head.',
    { aliases: ['bed', 'curtain', 'torch', 'tide table'], interactions: ['sit', 'lie'], look: { arche: 'bed', form: 'bed', dims: [1.4, 2.05, 0.5] }, spot: { wall: 'right', along: 2.3 } }),
  row('furn_consv_loft_desk', 'zone_consv_loft', 'the gallery desk', 'furniture',
    'A plain steel desk with a logbook open on it and a pen laid across the page. The photograph hangs on the wall over it.',
    { aliases: ['desk', 'logbook', 'log', 'pen', 'photograph', 'photo'], interactions: ['lean'], look: { arche: 'surface', form: 'desk', dims: [1.3, 0.65, 0.76] }, spot: { wall: 'left', along: 1 } }),
  row('furn_hulls_planks', 'zone_hulls_back', 'the plank rack', 'decoration',
    'Oak planks on a timber rack, cut to length, each marked in pencil with the frame it goes to.',
    { aliases: ['rack', 'planks', 'plank', 'oak'], look: { arche: 'store', form: 'shelves', dims: [2.2, 0.5, 1.5] }, spot: { wall: 'left', along: 2.2 } }),
  row('furn_hulls_cot', 'zone_hulls_back', 'the cot', 'furniture',
    'A canvas cot in the corner with an army blanket on it. It is the warmest place in the yard.',
    { aliases: ['cot', 'bed', 'blanket'], interactions: ['sit', 'lie'], look: { arche: 'sofa', form: 'cot' }, spot: { wall: 'right', along: 2.6 } }),
  row('furn_hulls_stove', 'zone_hulls_back', 'the stove', 'decoration',
    'A cast iron stove with a dented kettle on the plate, piped out through the lean-to roof.',
    { aliases: ['stove', 'kettle', 'plate'], look: { arche: 'hob', form: 'range', dims: [0.7, 0.6, 0.9] }, spot: { wall: 'back', along: 2 } }),
  row('furn_racerbay_deadleg_bench', 'zone_racerbay_deadleg', 'the spanner bench', 'decoration',
    'A steel bench with spanners laid out on it by size, two of them missing. Steel cable hangs in coils on pegs above it.',
    { aliases: ['bench', 'spanners', 'spanner', 'cable', 'coils', 'pegs'], look: { arche: 'surface', form: 'desk', dims: [3, 0.75, 0.92] }, spot: { wall: 'left', along: 7.5 } }),
];
const LOCKER = (k, n, along) => row(`furn_bunk_${k}_locker${n}`, `zone_bunk_${k}`, n === 1 ? 'first locker' : 'second locker', 'decoration',
  n === 1 ? 'A grey steel locker with louvres in the door and a padlock through the hasp. Somebody has scratched a tally of days into the paint.'
    : 'A grey steel locker, the door bent at the bottom corner where it was kicked shut. No padlock, and nothing inside worth one.',
  { aliases: ['locker', 'lockers', n === 1 ? 'first locker' : 'second locker'], look: { arche: 'store', form: 'locker' }, spot: { wall: 'back', along } });
for (const b of Object.values(BUNKS)) NEW.push(LOCKER(b.key, 1, 1.55), LOCKER(b.key, 2, 2.2));

// ── WRITE ───────────────────────────────────────────────────────────────────────────────────────────
for (const [id, room] of Object.entries(ROOMS)) {
  const z = read('zones', id);
  z.flags.room = room;
  save('zones', z);
}
for (const [id, { look, spot }] of Object.entries(PLACE)) {
  const r = read('furniture', id);
  r.flags = { ...(r.flags || {}), ...(look ? { look } : {}), spot };
  save('furniture', r);
}
for (const r of NEW) {
  if (r.description.length > 300) throw new Error(`${r.id}: description over 300 characters`);
  if (/—/.test(r.description + r.name)) throw new Error(`${r.id}: em dash`);
  save('furniture', r);
}
console.log(`depot-rooms: ${wrote} files written`);
