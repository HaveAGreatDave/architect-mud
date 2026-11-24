// The rooms of Precinct 9 (923,911) and the Yards Tenement's lobby, laid out for the one world: each room's
// `flags.room`, a `flags.look` on every row that stands in one, and the rows the rooms' text promises. GLASS
// draws them inside the building (docs/proposals/one-world-interiors.md), from the same specs the Stage reads.
//
//   node scripts/content/precinct-rooms.mjs
//   npm run content:lint
//   node scripts/content/building-stage.mjs map_int_mq_precinct
//
// Idempotent: every id is fixed and a file is only written when it would change. Edit this and run it again,
// not the JSON.
//
// ⚠ THE ROOMS FIT THE MODEL (glass/models/downtown.js `police`). At 923,911 (skyline-scale.js buildingScale) the
// precinct's walls are 15.1 m square and 14.4 m to the attic's top: four storeys, the ground floor 3.3 m high.
// If the tile moves, its size moves and these numbers with it. The street door is under the portico in the
// middle of the east face, so the lobby is on the east front with its door 1.8 m north of its own middle.
//
// The frame: every room faces east (face 90), so the front wall is east, right is south, left is north and back
// is west. A spot's `at` is [u, v]: u south of the room's middle, v west of its east wall. In the building's own
// metres (x east, y north, the middle of the plate 0,0) the rooms are:
//   lobby     x 2 to 7.2, y -4.6 to 1        the duty desk behind glass, the bench, the card machine
//   bullpen   x -3 to 7.2, y 1 to 5          north of the lobby, the desks shoved together
//   util      x 3 to 7.2, y 5 to 7.2         off the bullpen's north wall
//   holding   x -1 to 4.6, y -6 to 1         the basement, under the lobby; its stair climbs north into the lobby
//   gym       x -7.2 to -1, y -6 to 1        west of holding
//   showers   x 4.6 to 7.2, y -6 to 1        east of holding
//
// The Yards Tenement's lobby (922,902) is its only room with a spec, so its stairs and the basement door are
// shut doors. It faces south, the street.
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

const P = 'zone_mq_precinct_';
const east = { balcony: false, studio: false, face: 90 };
// institutional grey over a blue dado, the trim the force's navy
const GREY = { accent: '#36446a', ceiling: '#b4b8bc', trim: '#26304a', wall: '#9a9ea2' };
const SLAB = { accent: '#4a4e52', ceiling: '#6a6c6e', trim: '#2e3032', wall: '#7c7e80' };   // the basement's bare concrete
const WET = { accent: '#5a6a6a', ceiling: '#a8aa9e', trim: '#3a4040', wall: '#b4ae90' };    // tiles gone the colour of a bad tooth

// Holding's concrete, darker with what's soaked into it
const FILTH = { accent: '#2e2f2c', ceiling: '#3a3934', trim: '#1c1d1a', wall: '#4a473e' };

const ROOMS = {
  // The lobby: the duty officer behind glass on the back wall, the waiting bench, the wall-screen of WANTED faces.
  [`${P}lobby`]: {
    ...east, w: 5.6, d: 5.2, h: 3.3, ground: 'terrazzo', glass: [],
    doors: { east: 1.8, north: 0, down: [-2.09, 3.6] },
    street_door: { kind: 'single', w: 1.2, trim: '#26304a', glass: '#6f8494' },
    tone: GREY,
    decor: {
      rug: false,
      strips: [{ at: [0, 1.6], along: 'u', len: 1.2 }, { at: [0, 3.8], along: 'u', len: 1.2 }],
      screens: [{ wall: 'right', along: 2.6, y: 1.9, w: 1.6, h: 0.9, show: 'ad', text: 'WANTED' }],
      signs: [{ wall: 'back', along: 0, y: 2.7, text: 'PRECINCT 9', h: 0.22, style: 'cut' }],
      paint: [{ kind: 'line', from: [-2.4, 3.3], to: [2.6, 3.3] }],
    },
  },
  // The bullpen: mismatched desks shoved together, the corkboard of red string, half the lights dead.
  [`${P}bullpen`]: {
    ...east, w: 4, d: 10.2, h: 3.3, ground: 'rubber', windowless: true,
    doors: { south: 2.5, north: 2.5 },
    tone: GREY,
    dim: 0.7,
    decor: {
      rug: false,
      strips: [{ at: [0, 2.5], along: 'v', len: 1.2 }, { at: [0, 5.2], along: 'v', len: 1.2 }, { at: [0, 7.9], along: 'v', len: 1.2 }],
      mags: [{ at: [0.6, 4.4], n: 6, seed: 21 }],
    },
  },
  // The electrical room: the breaker panel and the junction box, nothing else.
  [`${P}util`]: {
    ...east, w: 2.2, d: 4.2, h: 3.3, ground: 'concrete', windowless: true,
    doors: { south: -0.5 },
    tone: SLAB,
    decor: {
      rug: false,
      strips: [{ at: [0, 2.1], along: 'v', len: 1.2, cage: true }],
      drops: [{ wall: 'left', along: 1.2, n: 4 }, { wall: 'left', along: 3.0, n: 3 }],
      signs: [{ wall: 'back', along: 0, y: 2.2, text: 'DANGER 400V', h: 0.1, style: 'plate' }],
    },
  },
  // Holding: two cages of bar-steel either side of a gangway, a drain, a bench bolted to each cage's wall. No lamp:
  // the only light is what comes down through the four little barred windows at the top of the outside walls, at
  // pavement level, so it's dark down here at night and grey at noon (`dim` takes the room's lamp near to nothing).
  // The cages are `cells`: round bars no more than 10 cm apart, solid to the walk. The stair up to the lobby is in
  // front of them.
  [`${P}holding`]: {
    ...east, w: 7, d: 5.6, h: 3.2, ground: 'concrete', dim: 0.1, unlit: true, daylight: 0.22,
    panes: [
      { wall: 'left', a: 3.1, b: 3.7, y0: 2.78, y1: 3.06 }, { wall: 'left', a: 4.6, b: 5.2, y0: 2.78, y1: 3.06 },
      { wall: 'right', a: 3.1, b: 3.7, y0: 2.78, y1: 3.06 }, { wall: 'right', a: 4.6, b: 5.2, y0: 2.78, y1: 3.06 },
    ],
    doors: { west: 0, east: 0 },
    stair: { at: [1.8, 1.0], climb: 'left', w: 1.0 },
    tone: FILTH,
    decor: {
      rug: false,
      // the north cage (u -3.5 to -0.9) and the south one (0.9 to 3.5), each barred on its gangway side and its front,
      // with a door in the front
      cells: [
        { u: [-3.5, -0.9], v: [2.4, 5.6], sides: ['front', 'right'], door: { side: 'front', at: -2.2, w: 0.8 } },
        { u: [0.9, 3.5], v: [2.4, 5.6], sides: ['front', 'left'], door: { side: 'front', at: 2.2, w: 0.8 } },
      ],
      grates: [[0, 3.6, 0.4, 0.4], [-2.2, 4.6, 0.3, 0.3], [2.2, 4.6, 0.3, 0.3]],
      // the water that never drains off, and what's left in the corners
      puddles: [{ at: [0.1, 3.7], r: [0.6, 0.45], seed: 3 }, { at: [-2.4, 4.9], r: [0.35, 0.25], seed: 5 }, { at: [2.0, 4.4], r: [0.4, 0.3], seed: 8 }],
      rubbish: [{ at: [-3.0, 5.2], r: [0.4, 0.3], n: 9, seed: 41 }, { at: [3.1, 5.1], r: [0.35, 0.4], n: 8, seed: 42 }, { at: [0, 4.9], r: [0.5, 0.4], n: 6, seed: 43 }],
      damp: [{ at: [-3.2, 3.0], r: 0.7 }, { at: [3.2, 4.0], r: 0.8 }, { at: [-1.6, 5.4], r: 0.6 }, { at: [1.6, 5.3], r: 0.7 }, { at: [0, 0.4], r: 0.5 }],
    },
  },
  // The pit: a concrete box, one caged lamp, the bench bolted through the slab, the tally on the far wall.
  [`${P}gym`]: {
    ...east, w: 7, d: 6.2, h: 3.2, ground: 'concrete', windowless: true,
    doors: { east: 0 },
    tone: SLAB,
    decor: {
      rug: false,
      strips: [{ at: [0, 3.1], cage: true }],
      signs: [{ wall: 'back', along: 0, y: 1.7, text: 'IIII IIII IIII IIII IIII IIII', h: 0.3, style: 'paint' }],
    },
  },
  // The wash block: six heads on one pipe (the gang shower on its front wall), a trench drain, no doors on anything.
  // The tiles have gone the colour of a bad tooth and the floor is never dry (`wet`, `puddles`).
  [`${P}showers`]: {
    ...east, w: 7, d: 2.6, h: 3.2, ground: 'tile', windowless: true, wet: true,
    doors: { west: 0 },
    tone: WET,
    decor: {
      rug: false,
      walls: { kind: 'tile', hex: '#c8bc98', y1: 2.1 },
      strips: [{ at: [0, 1.3], along: 'u', len: 1.2, cage: true }],
      puddles: [{ at: [-2.2, 0.9], r: [0.7, 0.4], seed: 11 }, { at: [0.6, 1.0], r: [0.9, 0.45], seed: 12 }, { at: [2.4, 1.6], r: [0.5, 0.35], seed: 13 }, { at: [-0.6, 1.9], r: [0.4, 0.3], seed: 14 }],
      damp: [{ at: [-2.6, 2.2], r: 0.5 }, { at: [2.8, 2.2], r: 0.4 }],
    },
  },
  // The Yards Tenement's lobby: a wall of dented mailboxes, the dead buzzer panel, the lift chained shut.
  zone_yards_tenement_lobby: {
    balcony: false, studio: false, face: 180, w: 6, d: 5, h: 3.4, ground: 'concrete',
    tone: { accent: '#5a4a3a', ceiling: '#8a8070', trim: '#2a2420', wall: '#7a6e5e' },
    decor: {
      rug: false,
      strips: [{ at: [0, 2.5], along: 'u', len: 1.2 }],
      rubbish: [{ at: [-1.2, 3.8], r: [0.8, 0.5], n: 10, seed: 31 }],
      damp: [{ at: [2.2, 4.4], r: 0.6 }],
    },
  },
};

// ── THE ROWS THAT EXIST ─────────────────────────────────────────────────────────────────────────────
const PLACE = {
  furn_dd_precinct_bench: { spot: { wall: 'right', along: 1.4 } },
  furn_cardmach_precinct: { spot: { wall: 'left', along: 1.2 } },
  furn_dd_yards_mailbox: { spot: { wall: 'left', along: 2.2 } },
  furn_cardmach_tenement: { spot: { wall: 'right', along: 1.4 } },
  furn_cell_cot: { look: { arche: 'bench', form: 'slab', wear: 0.9 }, spot: { wall: 'left', along: 4.0 } },
  // the concrete plates (gl/room-decor.js pressbench `look.dress`)
  furn_cell_weightbench: { look: { arche: 'bed', form: 'pressbench', dress: 'concrete', wear: 0.9 }, spot: { at: [0, 3.0], turn: 0 } },
  furn_cell_showers: { look: { arche: 'shower', form: 'gang', wear: 0.9 }, spot: { wall: 'front', along: 0 } },
  furn_cell_sink: { look: { arche: 'sink', form: 'trough', wear: 0.9 }, spot: { wall: 'right', along: 1.3 } },
  furn_cell_toilet: { look: { arche: 'toilet', form: 'pan', wear: 0.9 }, spot: { wall: 'back', along: 2.6 } },
};

// ── THE ROWS THE TEXT PROMISES ──────────────────────────────────────────────────────────────────────
const row = (id, zone, name, description, flags, price = 0, object_type = 'furniture') => ({
  description, flags, hp: null, hp_max: null, id, light_type: null, lumen_output: null, name, object_type, power_draw_kw: null, price, zone_id: zone,
});
const ADD = [
  row('furn_precinct_duty_desk', `${P}lobby`, 'duty desk', "The duty officer's desk behind a sheet of scratched bulletproof glass, with a steel tray under it you slide things through. The fees list is taped to the glass at eye level.",
    { aliases: 'desk,duty desk,glass,counter', look: { arche: 'surface', form: 'counter', dims: [2.6, 0.7, 1.1], wear: 0.6 }, spot: { wall: 'back', along: 0.4 } }),
  row('furn_precinct_desks', `${P}bullpen`, 'shoved-together desks', 'Four desks from four different decades pushed into one block, each buried in case files. Nobody has seen the wood of the middle two in years.',
    { aliases: 'desks,desk,files,case files', look: { arche: 'surface', form: 'desk', dims: [2.8, 1.6, 0.76], wear: 0.8 }, spot: { at: [0, 4.0], turn: 90 } }),
  row('furn_precinct_desk_chairs', `${P}bullpen`, 'office chairs', 'Office chairs with the springs gone, each one tipped back at the angle its owner gave up at.',
    { aliases: 'chair,chairs,office chair', interactions: ['sit'], look: { arche: 'seat', form: 'office', wear: 0.85 }, spot: { at: [-1.2, 4.0], turn: 180 } }),
  row('furn_precinct_corkboard', `${P}bullpen`, 'corkboard', "A corkboard mapping the district's gangs in pins and red string. The string has been added to so often it no longer matches the gangs.",
    { aliases: 'corkboard,board,string,map', look: { arche: 'prop', form: 'cabinet', dims: [1.6, 0.05, 1.0], wear: 0.7 }, spot: { wall: 'left', along: 6.5, y: 1.2 } }),
  row('furn_precinct_filing', `${P}bullpen`, 'filing cabinets', 'A row of grey filing cabinets. The top drawer of every one is jammed, and the labels are in a filing system nobody here was trained in.',
    { aliases: 'filing,cabinets,filing cabinets,drawers', look: { arche: 'store', form: 'drawers', dims: [1.8, 0.6, 1.3], wear: 0.8 }, spot: { wall: 'back', along: 0 } }),
  row('furn_precinct_breakers', `${P}util`, 'breaker panel', 'A grey breaker panel plastered with faded safety notices, and one evidence tag nobody ever filed.',
    { aliases: 'breakers,breaker panel,panel', look: { arche: 'prop', form: 'cabinet', dims: [0.9, 0.2, 1.2], wear: 0.6 }, spot: { wall: 'back', along: 0, y: 0.6 } }),
  row('furn_precinct_pullup', `${P}gym`, 'pull-up frame', 'A frame of welded square tube bolted through the floor: a bar across the top for pull-ups and two taped handles out front for dips. The bar is worn bright where the hands go.',
    { aliases: 'pull-up bar,pullup bar,dip bars,frame,bar', look: { arche: 'prop', form: 'pullup', wear: 0.9 }, spot: { wall: 'left', along: 3.0 } }),
  row('furn_precinct_cell_bench', `${P}holding`, 'cell bench', 'A steel bench bolted along the cage wall, worn shiny where people sat waiting.',
    { aliases: 'bench,cell bench', interactions: ['sit'], look: { arche: 'bench', form: 'slab', wear: 0.9 }, spot: { wall: 'right', along: 4.0 } }),
];

// ── WRITE ───────────────────────────────────────────────────────────────────────────────────────────
for (const [id, room] of Object.entries(ROOMS)) {
  const z = read('zones', id);
  save('zones', { ...z, flags: { ...z.flags, room } });
}
for (const [id, { look, spot }] of Object.entries(PLACE)) {
  const f = read('furniture', id);
  const flags = { ...f.flags, spot };
  if (look) flags.look = { ...(f.flags?.look || {}), ...look };
  save('furniture', { ...f, flags });
}
for (const r of ADD) save('furniture', r);
console.log(`precinct-rooms: ${wrote} files written`);
