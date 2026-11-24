// One-shot authoring pass for the Meridian in ROOM (docs/proposals/building-stage.md): the lobby and the six
// landings above it, in the building's own art deco. Terrazzo with a brass sunburst, black glass to the dado,
// a gilt zigzag under the ceiling, fluted pilasters, shell lamps and two dead lifts; kept on the lower floors and
// a step further gone each floor up, to a roof that leaks onto the sixth. This writes each room's `flags.room`,
// its text, and every lobby row's `flags.look` and `flags.spot`. Idempotent: a file is only written when it
// would change. Edit this and run it again, not the JSON.
//
//   node scripts/content/meridian-rooms.mjs
//
// The frame (client/shared/room-layout.js): every room here faces north (face 0), so the front wall is north,
// right is east, left is west and back is south. A spot's `at` is [u, v] in metres, u east of the room's middle
// and v south of the north wall; `turn` 0 faces north, 90 east, 180 south, -90 west. The street door is in the
// lobby's east wall. Each landing has a flat on every wall: north and south in the middle of the long walls,
// east and west at the ends, so the stairs and the lifts take the long walls either side of them.
import fs from 'fs';
import { canonicalJson } from './lib.mjs';

const ZONES = 'content/zones/', FURN = 'content/furniture/';
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const GILT = '#c49a52', BLACK = '#1e1c1a', CREAM = '#e6dcc8', base = { balcony: false, face: 0, studio: false };

// The two lifts stopped where they died: the dial reads L on the left to 6 on the right, 30 degrees a floor.
const DIAL = { a: 60, b: 0 };

const LOBBY = {
  floor: 'stone',
  description: 'Terrazzo floor with a brass sunburst in the middle, cracked straight through. Black glass to shoulder height, cream plaster above, a gilt zigzag under the ceiling. Two bronze lift doors on the south wall, both out of order. The security desk faces the street door with nobody behind it. Pried-open mailboxes by the door. A fire door to the stairs.',
  window: {
    description: 'A tall steel-framed window with a border of chevrons etched into the glass. Somebody keeps a patch clean at eye height.',
    light: 0.85,
    name: 'the lobby window',
    visibility: 0.9,
  },
  room: {
    // 6 m: the podium's height, so the lobby's windows (which stop at 6.0 m on the model) are all its own
    ...base, w: 12, d: 9, h: 6, finish: 'fine', ground: 'terrazzo',
    tone: { accent: GILT, ceiling: '#ece3cf', trim: BLACK, wall: CREAM },
    // the street door: two bronze-framed glass leaves under a fanlight, as the portal outside has them
    street_door: { kind: 'swing', w: 2, trim: '#5a4430', glass: '#7f97a0', monogram: 'M' },
    decor: {
      walls: { kind: 'stone', hex: '#211e1c', y1: 1.3, pitch: 1.0, trim: GILT },
      frieze: { y: 5.2, h: 0.24, hex: BLACK, line: GILT },
      ceiling: { kind: 'coffer', hex: '#ece3cf', trim: GILT, band: 0.6, drop: 0.32, cell: 2.2 },
      floor: { border: '#1c1916', inset: 0.5, w: 0.26, line: GILT, medallion: [0, 4.5, 1.7], star: 'sunburst', rays: 16, ray: '#b98a4a', field: '#e9dfcb' },
      downlights: false, rug: false,
      lights: [{ at: [0, 4.5], kind: 'tiers', r: 0.6, tiers: 4, drop: 2.6, k: 1.7 }],
      sconces: { kind: 'fan', y: 2.2, points: [['front', -2.2], ['front', 2.2], ['front', 4.4], ['back', -4.2], ['back', 4.2], ['left', 2.4], ['left', 6.0], ['right', 3.05], ['right', 6.6]] },
      pilasters: { w: 0.34, hex: '#e8dfcc', trim: GILT, y1: 5.65, points: [['back', -3], ['back', 0], ['back', 3], ['front', -1.4], ['front', 1.4]] },
      art: [{ wall: 'left', at: 4.5, w: 1.4, h: 0.9, y: 2.6, seed: 31 }],
      doors: [
        { wall: 'back', at: -1.4, w: 1.1, finish: 'bronze', pair: true, dial: DIAL.a, label: 'Out of order' },
        { wall: 'back', at: 1.4, w: 1.1, finish: 'bronze', pair: true, dial: DIAL.b, label: 'Out of order' },
        { wall: 'front', at: -4, w: 1, finish: 'steel', label: 'Stairs' },
        { wall: 'left', at: 7.6, w: 1, finish: 'steel', label: 'Service' },
      ],
    },
  },
};

// ⚠ THE ROOMS FIT THE TOWER (scripts/content/meridian-refit.mjs). At 919,908 the arm draws a 15.7 m shaft with five
// window floors from 11.48 m, 3.28 m apart; a 12.1 m setback with three from 30.06 m, 3.69 m apart; and an 8.6 m one
// with two from 42.9 m, 3.76 m apart. A floor stands on the one below at that one's ceiling (building-graph.js), so each
// landing's `h` is the step to the next floor, and the two landings under a setback take the jump over its cornice.
// The plan's x is the tile's less about 2 m (the street door's doorway), so every landing and flat is laid west of the
// middle by that, and fits the plate with 0.2 m to spare whichever way the doorway falls. Each flat's windows are where
// the model's bays are (meridianStage's `us` times `fh` 7.39 m).
const STEP = { 1: 5.48, 2: 3.28, 3: 3.28, 4: 3.28, 5: 3.28, 6: 5.46, 7: 3.69, 8: 3.69, 9: 5.46, 10: 3.76 };
// a landing's size and doors: on the shaft the flats are north and south of it, above it one flat is west
const HALL = { shaft: { w: 5, d: 3 }, set: { w: 3, d: 2.4 }, top: { w: 2.4, d: 2 } };
const stageOf = (n) => (n <= 6 ? 'shaft' : n <= 9 ? 'set' : 'top');

// A landing, `tier` how far gone it is: 0 kept, 1 tired, 2 gone. Floor 1 is the mezzanine, with no flats.
function landing(n, tier, name, text) {
  const kept = tier === 0, gone = tier === 2, st = n === 1 ? 'shaft' : stageOf(n), { w, d } = HALL[st], h = STEP[n];
  const flats = n === 1 ? [] : st === 'shaft' ? [`${n}01`, `${n}03`] : [{ 7: '102', 8: '202', 9: '302', 10: '402' }[n]];
  const decor = {
    frieze: { y: Math.min(2.8, h - 0.4), h: 0.22, hex: BLACK, line: gone ? '#6f8064' : GILT },
    ceiling: { kind: 'cove', hex: gone ? '#cfc6b4' : '#ece3cf', trim: gone ? '#6f8064' : GILT, band: 0.35, drop: 0.14 },
    downlights: false, rug: false,
    sconces: { kind: 'fan', y: 1.9, points: st === 'shaft' ? [['left', d / 2], ['right', d / 2 - 0.9]] : [['back', 0]] },
    // the stairs go on up from the east wall; the shaft's landings keep one dead lift on the west
    doors: [
      { wall: 'right', at: d / 2, w: 1, finish: 'steel', label: 'Stairs' },
      ...(st === 'shaft' ? [{ wall: 'left', at: d / 2, w: 1, finish: 'bronze', pair: true, dial: DIAL.a, ...(gone ? { trim: '#6f8064' } : {}) }] : []),
    ],
    plaques: Object.fromEntries(flats.map((u) => [`zone_meridian_unit_${u}`, LABEL[u]])),
  };
  if (n !== 4) decor.walls = { kind: 'stone', hex: '#211e1c', y1: 1.0, pitch: 1.0, trim: gone ? '#6f8064' : GILT };
  if (n <= 3 && st === 'shaft') decor.runner = { along: 'u', w: 1.1, end: 0.4, hex: n === 3 ? '#4a1a20' : '#5a1a24', border: n === 3 ? '#7a6038' : '#b08a48' };
  // the flats' doors: north and south 1 m west of the middle on the shaft, the west wall's middle above it
  const doors = st === 'shaft' ? (n === 1 ? {} : { north: -1, south: -1 }) : { west: 0 };
  const room = {
    ...base, w, d, h, doors, windowless: true, finish: gone ? 'plain' : 'fine', ground: n >= 6 ? 'concrete' : 'terrazzo',
    tone: gone ? { accent: '#6f8064', ceiling: '#cfc6b4', trim: '#2a2622', wall: '#c9bea6' } : { accent: GILT, ceiling: '#ece3cf', trim: BLACK, wall: n === 4 ? '#e2d6b8' : CREAM },
    decor,
  };
  return { floor: n <= 4 ? 'carpet' : n === 5 ? 'stone' : 'concrete', name, description: text, room };
}

// THE FLATS. `u` is the zone's number, which stays; LABEL is the number on the door.
const LABEL = { 201: '201', 203: '203', 301: '301', 303: '303', 401: '401', 403: '403', 501: '501', 503: '503', 601: '601', 603: '603', 102: '701', 202: '801', 302: '901', 402: 'PH' };
// the model's bays along each face, from the middle (meridianStage `us`): a pane each, the bay's own width
const bays = (us, half, y0, y1) => us.map((u) => ({ wall: 'front', a: +(u - half).toFixed(2), b: +(u + half).toFixed(2), y0, y1 }));
const SHAFT_PANES = bays([-5.5, -3.65, -1.8, 1.8, 3.65, 5.5], 0.45, 0.75, 2.9);
const SET_PANES = bays([-3.99, -1.33, 1.33, 3.99], 0.5, 0.85, 3.3);
const TOP_PANES = (y1) => bays([-2.22, 0, 2.22], 0.5, 0.85, y1);
// north flats face north (0) and south ones south (180), so the front wall is the street wall; the door is in the
// back wall, offset to bring the flat back under the middle of the tower. The west flats face west (270).
const flat = (u, size, text) => ({ name: u === '402' ? 'The Penthouse' : u === '502' ? 'The Penthouse, Upper Floor' : `Unit ${LABEL[u]}`, description: text, room: { balcony: false, ...size } });
const north = (u, text) => flat(u, { face: 0, w: 14.2, d: 5.8, h: 3, doors: { south: 1.1 }, panes: SHAFT_PANES }, text);
const south = (u, text) => flat(u, { face: 180, w: 14.2, d: 5.8, h: 3, doors: { north: 1.1 }, panes: SHAFT_PANES }, text);
const west = (u, text) => flat(u, { face: 270, w: 11.6, d: 6.05, h: 3.4, doors: { east: 0 }, panes: SET_PANES }, text);

const FLATS = {
  zone_meridian_unit_201: north('201', 'A long flat across the north face of the second floor, six steel windows in a row over Marrow Street. Boards underfoot, a galley kitchen at one end, a bed at the other. The radiator knocks twice an hour and works.'),
  zone_meridian_unit_203: south('203', 'The south side of the second floor: six windows onto the back of Lever Lane, a kitchen along the inside wall and a bed by the last window. Somebody has hung net curtains on every one of them.'),
  zone_meridian_unit_301: north('301', 'Six windows over Marrow Street and a long room behind them, boards worn pale in a path from the door to the kitchen. One window has cardboard where a pane should be.'),
  zone_meridian_unit_303: south('303', 'A long flat on the south side of the third floor. The windows look down on the bins behind Lever Lane. The plaster is cracked over the bed and the kitchen tap drips.'),
  zone_meridian_unit_401: north('401', 'The fourth floor, north side: six windows, a long room, a kitchen with one working ring. Two of the windows are painted shut. The other four rattle when a truck goes past.'),
  zone_meridian_unit_403: south('403', 'The fourth floor, south side. A long room with a bed, a table and a kitchen in a row, and six windows onto the backs of the lane. A drying rack stands in front of the radiator.'),
  zone_meridian_unit_501: north('501', 'Rain has come in at the top of two windows and stained the wall under them. Otherwise it\'s the same long flat as the floors below: boards, a kitchen at one end, a bed at the other.'),
  zone_meridian_unit_503: south('503', 'A long flat on the fifth floor, south side. There\'s a bucket under the ceiling by the third window. The view over the lane is better up here, and so is the draught.'),
  zone_meridian_unit_601: north('601', 'The top of the shaft, north side, right under the cornice. Six windows over Marrow Street, a long cold room, and a kitchen somebody has scrubbed back to the steel.'),
  zone_meridian_unit_603: south('603', 'The sixth floor, south side. Six windows, a long room, a bed under the last one. The ceiling has been patched in grey plaster and painted cream, and the patch shows.'),
  zone_meridian_unit_102: west('102', 'Unit 701, on the first setback. A flat on the west face with four tall windows, the copper roof of the floor below just under the sills. Quieter than downstairs. The kitchen is new and the bath isn\'t.'),
  zone_meridian_unit_202: west('202', 'Unit 801. Four tall windows on the west face, high enough to see the Basin past the roofs. Boards, a kitchen along the inside wall, a bed under the last window.'),
  zone_meridian_unit_302: west('302', 'Unit 901, the top of the first setback. Four tall windows and a view west over half the city. The radiators are older than anyone in the building and still the warmest in it.'),
  zone_meridian_unit_402: flat('402', { face: 270, w: 8, d: 4.65, h: 3.76, doors: { east: 0 }, panes: TOP_PANES(3.36) }, 'The penthouse, the lower floor: one high room on the last setback, three windows west over the city and a stair up in the corner. Polished boards, a deco sideboard, a kitchen in green tile. Sir Charles lives here.'),
  zone_meridian_unit_502: flat('502', { face: 270, w: 8, d: 4.65, h: 3.4, panes: TOP_PANES(3.3) }, 'The penthouse\'s upper floor, just under the crown. A bedroom with three windows west and the copper of the roof ticking as it cools. On the sill, a ticket stub from the Coliseum\'s opening day, in a frame.'),
};

const ZONE = {
  zone_meridian_lobby: LOBBY,
  zone_meridian_floor_1: landing(1, 0, 'The Meridian - Mezzanine', 'A landing behind the stone band over the street door, with no windows and no flats. The fire stairs carry on up from the east wall. The lift doors on the west have a yellowed card in the slot.'),
  zone_meridian_floor_2: landing(2, 0, 'The Meridian - Floor 2 Landing', 'A short landing with a claret runner. Someone on this floor polishes the bronze: 201 to the north and 203 to the south both shine. The lift dial has been rubbed back to gold. Stairs on the east wall.'),
  zone_meridian_floor_3: landing(3, 1, 'The Meridian - Floor 3 Landing', 'The runner is worn through to the backing. One shell lamp has lost its glass and burns bare. 301 is north and 303 south. A child\'s bike leans on the lift doors.'),
  zone_meridian_floor_4: landing(4, 1, 'The Meridian - Floor 4 Landing', 'Somebody painted the black glass magnolia, all of it. 401 to the north, 403 to the south, both with extra locks screwed on. The fire door to the stairs has a boot print at kick height.'),
  zone_meridian_floor_5: landing(5, 2, 'The Meridian - Floor 5 Landing', 'Water has come through the ceiling and run down the walls in brown tracks, and a bucket stands under the worst of it. 501 is north and 503 south. The shell lamps are dark.'),
  zone_meridian_floor_6: landing(6, 2, 'The Meridian - Floor 6 Landing', 'The top of the shaft. Concrete poured where the terrazzo broke up, with boot prints set in it. 601 north, 603 south. The stairs climb past the cornice to the setbacks.'),
  zone_meridian_floor_7: landing(7, 1, 'The Meridian - Floor 7 Landing', 'A small landing on the first setback, one door on the west wall: 701. The stairs are narrower from here up. The paint is newer than downstairs.'),
  zone_meridian_floor_8: landing(8, 1, 'The Meridian - Floor 8 Landing', 'A square of terrazzo, a shell lamp and one door on the west wall, 801. The stairs carry on up from the east.'),
  zone_meridian_floor_9: landing(9, 1, 'The Meridian - Floor 9 Landing', 'The last landing on the first setback: 901 on the west wall and the stairs on the east, climbing over the cornice to the top.'),
  zone_meridian_floor_10: landing(10, 0, 'The Meridian - Floor 10 Landing', 'A small landing kept like the lobby: polished bronze, a clean runner, fresh flowers on a shelf. The penthouse door is on the west wall with PH on it. The stairs carry on up to the roof.'),
  ...FLATS,
};

// the lobby's rows: what's drawn, and where it stands
const PLACE = {
  furn_secdesk_zone_meridian_lobby: { look: { arche: 'surface', form: 'reception', dims: [2.6, 0.7, 1.05] }, spot: { at: [-3, 4.5], turn: 90 } },
  furn_bench_zone_meridian_lobby: { look: { arche: 'bench', form: 'bench', dims: [1.8, 0.6, 0.85] }, spot: { at: [1.6, 7.3], turn: 180 } },
};

// text that has to change with the room: the desk, the bench and the mailboxes as the lobby draws them. The mailboxes
// aren't drawn: no form is a bank of them, and a steel locker isn't one.
const RETEXT = {
  furn_bench_zone_meridian_lobby: { description: 'A slatted waiting bench on cast-iron legs, facing the two dead lifts. The varnish is worn through where people sit, and someone has carved a tally of days into the end of it. It still takes your weight.' },
  furn_secdesk_zone_meridian_lobby: { description: 'A security desk with a fluted bronze front and a marble top. The chair behind it is gone. A brass lamp at one end, a bell at the other, and a terminal on the worktop behind cycling static. A coffee ring has fossilised by the bell.' },
  furn_mailboxes_zone_meridian_lobby: { description: 'A wall of bronze mailboxes by the street door, a chevron stamped on every flap. Most were pried open years ago and hang off one hinge. A flyer for a pizza place that closed is still wedged in 4C.' },
};

const save = (file, data) => {
  const text = canonicalJson(data);
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) return 0;
  fs.writeFileSync(file, text, 'utf8');
  return 1;
};
let wrote = 0;
for (const [id, { room, window, name, ...text }] of Object.entries(ZONE)) {
  const z = read(`${ZONES}${id}.json`);
  z.description = text.description;
  if (name) z.name = name;
  z.flags = { ...z.flags, ...(text.floor ? { floor: text.floor } : {}), room, ...(window ? { window } : {}) };
  wrote += save(`${ZONES}${id}.json`, z);
}
for (const id of Object.keys(RETEXT).filter((x) => !PLACE[x])) {
  const r = { ...read(`${FURN}${id}.json`), ...RETEXT[id] };
  if (r.flags) { delete r.flags.look; delete r.flags.spot; }
  if (r.description.length > 300) throw new Error(`${id}: description over 300 characters`);
  wrote += save(`${FURN}${id}.json`, r);
}
for (const [id, { look, spot }] of Object.entries(PLACE)) {
  const r = read(`${FURN}${id}.json`);
  r.flags = { ...(r.flags || {}), ...(look ? { look } : {}), spot };
  Object.assign(r, RETEXT[id] || {});
  if (r.description.length > 300) throw new Error(`${id}: description over 300 characters`);
  wrote += save(`${FURN}${id}.json`, r);
}
console.log(`${wrote} files written`);
