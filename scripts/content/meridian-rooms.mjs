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
const plaques = (n) => Object.fromEntries([1, 2, 3, 4].map((i) => [`zone_meridian_unit_${n}0${i}`, `${n}0${i}`]));

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
    ...base, w: 12, d: 9, h: 4.4, finish: 'fine', ground: 'terrazzo',
    tone: { accent: GILT, ceiling: '#ece3cf', trim: BLACK, wall: CREAM },
    // the street door: two bronze-framed glass leaves under a fanlight, as the portal outside has them
    street_door: { kind: 'swing', w: 2, trim: '#5a4430', glass: '#7f97a0', monogram: 'M' },
    decor: {
      walls: { kind: 'stone', hex: '#211e1c', y1: 1.3, pitch: 1.0, trim: GILT },
      frieze: { y: 3.6, h: 0.24, hex: BLACK, line: GILT },
      ceiling: { kind: 'coffer', hex: '#ece3cf', trim: GILT, band: 0.6, drop: 0.32, cell: 2.2 },
      floor: { border: '#1c1916', inset: 0.5, w: 0.26, line: GILT, medallion: [0, 4.5, 1.7], star: 'sunburst', rays: 16, ray: '#b98a4a', field: '#e9dfcb' },
      downlights: false, rug: false,
      lights: [{ at: [0, 4.5], kind: 'tiers', r: 0.6, tiers: 4, drop: 1.5, k: 1.7 }],
      sconces: { kind: 'fan', y: 2.2, points: [['front', -2.2], ['front', 2.2], ['front', 4.4], ['back', -4.2], ['back', 4.2], ['left', 2.4], ['left', 6.0], ['right', 3.05], ['right', 6.6]] },
      pilasters: { w: 0.34, hex: '#e8dfcc', trim: GILT, y1: 4.05, points: [['back', -3], ['back', 0], ['back', 3], ['front', -1.4], ['front', 1.4]] },
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

// A landing: 16 m of hall, 3.2 m across, the stairs on the north wall and the two lifts on the south, between
// fluted pilasters. `tier` is how far gone it is: 0 kept, 1 tired, 2 gone.
function landing(n, tier, text) {
  const kept = tier === 0, gone = tier === 2;
  const decor = {
    frieze: { y: 2.8, h: 0.22, hex: BLACK, line: gone ? '#6f8064' : GILT },
    ceiling: { kind: 'cove', hex: gone ? '#cfc6b4' : '#ece3cf', trim: gone ? '#6f8064' : GILT, band: 0.35, drop: 0.14 },
    downlights: false, rug: false,
    sconces: { kind: 'fan', y: 1.9, points: kept ? [['front', -6.8], ['front', -2.6], ['front', 2.6], ['front', 6], ['back', -6], ['back', -2.6], ['back', 1.8]] : tier === 1 ? [['front', -2.6], ['front', 6], ['back', -6], ['back', 1.8]] : [['front', -6.8], ['back', 1.8]] },
    pilasters: { w: 0.3, hex: gone ? '#cfc6b4' : '#e8dfcc', trim: gone ? '#6f8064' : GILT, y1: 3.04, points: [['back', 2.26], ['back', 4.2], ['back', 6.7]] },
    doors: [
      { wall: 'front', at: -5, w: 1, finish: 'steel', label: 'Stairs' },
      { wall: 'back', at: 3, w: 1, finish: 'bronze', pair: true, dial: DIAL.a, ...(gone ? { trim: '#6f8064' } : {}) },
      { wall: 'back', at: 5.4, w: 1, finish: 'bronze', pair: true, dial: DIAL.b, ...(gone ? { trim: '#6f8064' } : {}) },
    ],
    plaques: plaques(n),
  };
  // the black glass dado, painted over on the fourth
  if (n !== 4) decor.walls = { kind: 'stone', hex: '#211e1c', y1: 1.0, pitch: 1.0, trim: gone ? '#6f8064' : GILT };
  // the claret runner: whole on the first two, worn on the third, cut off halfway on the fourth, gone above
  if (n <= 3) decor.runner = { along: 'u', w: 1.3, end: 0.6, hex: n === 3 ? '#4a1a20' : '#5a1a24', border: n === 3 ? '#7a6038' : '#b08a48' };
  if (n === 4) decor.runner = { along: 'u', w: 1.3, end: 0.6, hex: '#4a1a20', border: '#7a6038', span: [-8, -0.6] };
  const room = {
    ...base, w: 16, d: 3.2, h: 3.2, windowless: true, finish: gone ? 'plain' : 'fine', ground: n === 6 ? 'concrete' : 'terrazzo',
    tone: gone ? { accent: '#6f8064', ceiling: '#cfc6b4', trim: '#2a2622', wall: '#c9bea6' } : { accent: GILT, ceiling: '#ece3cf', trim: BLACK, wall: n === 4 ? '#e2d6b8' : CREAM },
    decor,
  };
  return { floor: n <= 4 ? 'carpet' : n === 5 ? 'stone' : 'concrete', name: `The Meridian - Floor ${n} Hallway`, description: text, room };
}

const ZONE = {
  zone_meridian_lobby: LOBBY,
  zone_meridian_floor_1: landing(1, 0, 'A long hall with a claret runner down the middle and terrazzo either side. Black glass to the dado, cream plaster above, a shell lamp every few metres. Doors 101 to 104, one on each wall, numbers in bronze. The lift doors are shut with a yellowed card in the slot. A steel fire door says STAIRS.'),
  zone_meridian_floor_2: landing(2, 0, 'The same claret runner as downstairs, cleaner. Someone on this floor polishes the bronze: the numbers on 201 to 204 shine, and the lift dials have been rubbed back to gold. Every shell lamp works. A doormat outside 202 says WELCOME. The fire door to the stairs is on the north wall.'),
  zone_meridian_floor_3: landing(3, 1, 'The runner is worn through to the backing in a path from the stairs to 302. Half the shell lamps have lost their glass and burn bare. The black glass on the walls is cracked in three places and taped in one. Doors 301 to 304. A child\'s bike leans on the lift doors.'),
  zone_meridian_floor_4: landing(4, 1, 'The runner stops halfway down the hall, cut off square with a knife, and the terrazzo past it is gritty. Somebody painted the black glass magnolia, all of it. Doors 401 to 404, two of them with extra locks screwed on. The fire door to the stairs has a boot print at kick height.'),
  zone_meridian_floor_5: landing(5, 2, 'Water has come through the ceiling and run down the walls in brown tracks. Two buckets stand on the bare terrazzo under the worst of it. The zigzag under the ceiling is still there, its gilt gone green. Doors 501 to 504. Most of the shell lamps are dark.'),
  zone_meridian_floor_6: landing(6, 2, 'The top landing, right under the roof. Concrete has been poured where the terrazzo broke up, in grey patches with boot prints set in them. The ceiling is stained black in one corner. Doors 601 to 604. The fire door to the stairs carries on up to the roof hatch.'),
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
  z.flags = { ...z.flags, floor: text.floor, room, ...(window ? { window } : {}) };
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
