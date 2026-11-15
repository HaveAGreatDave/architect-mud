// Coldwater Regional Airport and the four hangars in ROOM (docs/proposals/building-stage.md): each room's
// `flags.room`, a `flags.look` and `flags.spot` on every row that's drawn, and the few rows the room text
// already promises (the ops desks, the tool racks, the tower desk, the heavy hangar's drums, a second row of
// lounge seats). A regional airport kept running on a short budget: laminate, rubber floors, strip lights,
// half the boxes dark. The hangars are concrete under trusses, and the Reach's is grubbier than the rest.
// Idempotent: every id is fixed and a file is only written when it would change. Edit this and run it
// again, not the JSON.
//
//   node scripts/content/airport-rooms.mjs
//   npm run content:lint
//   node scripts/content/building-stage.mjs map_int_cw_departures   (and each map below)
//
// The frame (client/shared/room-layout.js, building-graph.js): a spot's `at` is [u, v] in metres, v back
// from the front wall and u across the room. `turn` 0 faces the front wall, 180 the back, 90 toward +u and
// -90 toward -u. Which compass way u runs depends on the room's `face`:
//   face 90  (front wall east):  +u is south, the left wall north, the right wall south, the back wall west
//   face 180 (front wall south): +u is west,  the left wall east,  the right wall west,  the back wall north
//   face 270 (front wall west):  +u is north, the left wall south, the right wall north, the back wall east
//
// The terminal is two buildings (map_int_cw_departures and map_int_cw_arrivals), joined by a `link` the plan
// draws shut; a steel door on each side stands for it. Utility rooms keep no spec, so they're shut doors.
//
// HANGAR STANDS: each hangar carries `flags.room.stand`, where a player's called-up aircraft is drawn:
//   { kind: 'aircraft', at: [u, v], face, len, wid, from }
// `at` is the middle of the box on the floor, `face` the wall the nose points at, `len` along the nose and
// `wid` across it, `from` the wall it's towed in through. The box is kept clear of every piece, and the walk
// from the street door runs down one side of it. Hazard paint marks its edge and a tug lane runs in to it.
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

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────────
const YELLOW = '#e8b818', WHITE = '#e8eef2', BLUE = '#2a5f96', RED = '#8a1a14', STEEL = '#c8ccd0';
const r2 = (x) => Math.round(x * 100) / 100;
const base = { balcony: false, studio: false, finish: 'plain' };
// a grid of ceiling lights: one at every (u, v), less any listed in `skip`
const strips = (us, vs, o = {}, skip = []) => us.flatMap((u) => vs.filter((v) => !skip.some(([a, b]) => a === u && b === v)).map((v) => ({ at: [u, v], ...o })));
// a run of stanchions and the belt (or rope) between them, each span under 2 m so no bracket goes up to the ceiling
// (gl/room-decor.js puts one every 2 m along a level pipe). `gaps` are the spans left open, by index.
function stanchions(pts, { y = 0.95, post = STEEL, belt = '#1f3a6a', gaps = [] } = {}) {
  const out = pts.map(([u, v]) => ({ from: [u, v, 0], to: [u, v, y + 0.05], r: 0.022, hex: post }));
  for (let i = 0; i + 1 < pts.length; i++) if (!gaps.includes(i)) out.push({ from: [...pts[i], y], to: [...pts[i + 1], y], r: 0.012, hex: belt });
  return out;
}
// a level run split into spans under 2 m, so it's held by its flanges and not hung from the ceiling
function spans(a, b, y, r, hex) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(len / 1.9)), out = [];
  for (let i = 0; i < n; i++) {
    const p = (t) => [r2(a[0] + (b[0] - a[0]) * t), r2(a[1] + (b[1] - a[1]) * t), y];
    out.push({ from: p(i / n), to: p((i + 1) / n), r, hex });
  }
  return out;
}
// roof trusses across a hangar: a level run, so gl/room-decor.js hangs it from the roof every 2 m
const truss = (u0, u1, v, y) => ({ from: [u0, v, y], to: [u1, v, y], r: 0.11, hex: '#4a5056' });
// a sign on a plate: white on blue for the way somewhere, white on red for a warning
const way = (wall, along, y, text, h = 0.14) => ({ wall, along, y, text, h, hex: '#ffffff', plateHex: BLUE });
const warn = (wall, along, y, text, h = 0.08) => ({ wall, along, y, text, h, hex: '#ffffff', plateHex: RED });
const caution = (wall, along, y, text, h = 0.1) => ({ wall, along, y, text, h, hex: '#101010', plateHex: YELLOW });
// a stand's paint: a hazard band round it, a lane painted in from the wall it's towed through, with arrows
const standPaint = (S, { t = 0.2, lane = YELLOW } = {}) => {
  const [u, v] = S.at, hw = S.wid / 2, hl = S.len / 2;
  return [
    { kind: 'hazard', rect: [r2(u - hw), r2(u + hw), r2(v - hl), r2(v + hl)], t },
    { kind: 'line', from: [u, 0.3], to: [u, r2(v + hl - 1.5)], t: 0.12, hex: lane, arrows: true },
    { kind: 'line', from: [r2(u - 1.6), 0.3], to: [r2(u - 1.6), r2(v - hl)], t: 0.06, hex: lane },
    { kind: 'line', from: [r2(u + 1.6), 0.3], to: [r2(u + 1.6), r2(v - hl)], t: 0.06, hex: lane },
  ];
};

// ── THE DEPARTURES SIDE (map_int_cw_departures) ─────────────────────────────────────────────────────
// Every room faces east, onto the apron. Check-in is the entry, security is west of it through its back
// wall, and the lounge and Gate 1 run south of security, so the lounge's window and the gate's glass are
// on the apron side too.
const AIR_TONE = { wall: '#c9cdc8', trim: '#3a4046', ceiling: '#dfe2e0', accent: BLUE };
const LOUNGE_TONE = { wall: '#b9b2a4', trim: '#3a3630', ceiling: '#d8d2c6', accent: BLUE };

// the six desks are one counter from u -10.2 to 2.2, numbered from the south end as a passenger reads them
const DESK_U = [1.17, -0.9, -2.97, -5.03, -7.1, -9.17];
const CHECKIN = {
  ...base, face: 90, w: 22, d: 15, h: 5.5, ground: 'tile', glass: ['front'],
  street_door: { kind: 'sliding', w: 2.4 },
  doors: { west: -6 },
  tone: AIR_TONE,
  sign: { text: 'DEPARTURES', wall: 'back', at: -4, y: 4.85, size: 0.36 },
  decor: {
    rug: false,
    // the ceiling panels, one dead over desk 5 (its fitting is missing)
    strips: strips([-8, -3, 2, 7], [3.5, 7.5, 11.5], { len: 2.4, along: 'u' }, [[-8, 11.5]]),
    // the departures board over the desks, on two chains from the ceiling
    screens: [{ wall: 'back', along: -4, y: 3.75, w: 3.6, h: 0.95, show: 'status' }],
    pipes: [-5.6, -2.4].map((u) => ({ from: [u, 14.95, 4.25], to: [u, 14.95, 5.5], r: 0.012, hex: '#5a5e62' })),
    // a number box over each desk; only desk 2's is lit
    signs: [
      ...DESK_U.map((u, i) => ({ wall: 'back', along: u, y: 2.75, text: String(i + 1), h: 0.26, hex: i === 1 ? '#ffd23a' : '#4a5056', plateHex: '#1b1e22', ...(i === 1 ? { lit: true } : {}) })),
      way('back', 6, 2.6, 'Security', 0.16),
      warn('right', 7, 2.2, 'No smoking'),
    ],
    // the belt scales let into the floor beside each desk, the line to wait behind and desk 2's lane
    grates: DESK_U.map((u) => [r2(u + 0.62), 10.75, 0.6, 0.7]),
    paint: [
      { kind: 'line', from: [-10.2, 9.9], to: [2.2, 9.9], t: 0.08, hex: YELLOW },
      { kind: 'line', from: [-2.0, 9.8], to: [-2.0, 5.6], t: 0.06, hex: WHITE },
      { kind: 'line', from: [0.2, 9.8], to: [0.2, 5.6], t: 0.06, hex: WHITE },
      { kind: 'arrow', at: [-0.9, 6.4], dir: [0, 1], hex: WHITE, s: 0.6 },
    ],
    // the arrivals hall is through this door, in the other half of the terminal
    doors: [{ wall: 'left', at: 7.5, w: 1.4, finish: 'steel', label: 'Arrivals' }],
    payphone: [{ wall: 'right', at: 11.5, y: 1.4 }],
  },
};

const SECURITY = {
  ...base, face: 90, w: 10, d: 12, h: 3.6, ground: 'rubber', windowless: true,
  doors: { south: -3 },
  tone: AIR_TONE,
  decor: {
    rug: false,
    strips: strips([-3, 0, 3], [2, 5, 8, 11], { len: 1.2, along: 'u' }),
    pipes: [
      // the roped lane from the check-in door to the arch
      ...stanchions([[-0.9, 1], [-0.9, 2.6], [-0.9, 4.2]], { belt: '#7a1a1a' }),
      ...stanchions([[0.9, 1], [0.9, 2.6], [0.9, 4.2]], { belt: '#7a1a1a' }),
      // the scanner arch: two posts each side, a head across
      ...[-0.55, 0.55].flatMap((u) => [5.05, 5.55].map((v) => ({ from: [u, v, 0], to: [u, v, 2.1], r: 0.07, hex: '#8a9096' }))),
      ...[5.05, 5.55].map((v) => ({ from: [-0.55, v, 2.1], to: [0.55, v, 2.1], r: 0.08, hex: '#8a9096' })),
      ...[-0.55, 0.55].map((u) => ({ from: [u, 5.05, 2.1], to: [u, 5.55, 2.1], r: 0.06, hex: '#8a9096' })),
    ],
    // the X-ray belt's monitor, where the operator stands
    screens: [{ wall: 'left', along: 3, y: 1.6, w: 0.6, h: 0.4, show: 'status' }],
    signs: [
      way('right', 9, 2.55, 'Departures'),
      caution('left', 3, 2.35, 'All bags on the belt', 0.08),
      warn('back', -2, 2.2, 'No smoking'),
    ],
    paint: [
      { kind: 'box', rect: [-0.5, 0.5, 4.7, 5.9], t: 0.05, hex: YELLOW },
      { kind: 'line', from: [0.4, 6.3], to: [4.3, 9], t: 0.06, hex: WHITE, arrows: true },
    ],
  },
};

const LOUNGE = {
  ...base, face: 90, w: 16, d: 18, h: 3.6, ground: 'rubber', glass: ['front'],
  doors: { north: -6, south: -4 },
  tone: LOUNGE_TONE,
  decor: {
    rug: false,
    // wide shallow pendants on long cables, warmer than the panels out front; four of them are the room's lamps,
    // with the room's own shade in the middle (gl/room-light.js has room for six)
    pendants: [[-5, 4.5], [0, 4.5], [5, 4.5], [-5, 13.5], [0, 13.5], [5, 13.5]].map((at) => ({ at, y: 2.5, kind: 'school', ...(at[0] ? { k: 1, tint: [1.08, 1, 0.86] } : {}) })),
    // the departures screen over the machines on the back wall
    screens: [{ wall: 'back', along: -0.4, y: 2.55, w: 1.6, h: 0.6, show: 'status' }],
    signs: [way('right', 13, 2.55, 'Gate 1'), warn('back', -6, 2.2, 'No smoking')],
    paint: [{ kind: 'line', from: [-7.6, 14.5], to: [7.6, 13.5], t: 0.05, hex: '#8a96a0' }],
  },
};

// the queue's three belts run across the room, each open at alternate ends, so it zigzags to the desk
const QUEUE_U = [-3.6, -1.8, 0, 1.8, 3.6];
const GATE = {
  ...base, face: 90, w: 10, d: 14, h: 3.6, ground: 'rubber', glass: ['front'],
  doors: { north: -6 },
  tone: LOUNGE_TONE,
  sign: { text: 'GATE 1', wall: 'back', at: 1.5, y: 2.75, size: 0.42 },
  decor: {
    rug: false,
    strips: strips([-2.5, 2.5], [3, 7, 11], { len: 1.6, along: 'v' }),
    pipes: [
      ...stanchions(QUEUE_U.map((u) => [u, 6.0]), { gaps: [0] }),
      ...stanchions(QUEUE_U.map((u) => [u, 7.4]), { gaps: [3] }),
      ...stanchions(QUEUE_U.map((u) => [u, 8.8]), { gaps: [0] }),
      // the desk microphone on its stalk
      { from: [0.55, 3.05, 1.0], to: [0.45, 3.35, 1.38], r: 0.007, hex: '#2a2d30' },
    ],
    signs: [way('front', 2.6, 2.7, 'Boarding', 0.16), warn('left', 6, 2.2, 'No smoking')],
    // where the glass door onto the walkway is: a box on the floor and a line out to it from the desk
    paint: [{ kind: 'box', rect: [1.9, 3.3, 0.1, 1.2], t: 0.05, hex: YELLOW }, { kind: 'line', from: [1.3, 2.9], to: [2.6, 1.3], t: 0.05, hex: WHITE, arrows: true }],
  },
};

// ── THE ARRIVALS SIDE (map_int_cw_arrivals) ─────────────────────────────────────────────────────────
// The hall faces east onto the apron through a wall of glass; baggage reclaim is west through its back wall.
const ARRIVALS = {
  ...base, face: 90, w: 24, d: 12, h: 5, ground: 'terrazzo', glass: ['front'],
  street_door: { kind: 'sliding', w: 2.4 },
  doors: { west: 6 },
  tone: { wall: '#c4c8c6', trim: '#2c3136', ceiling: '#d6dad8', accent: '#3ad8e8' },
  sign: { text: 'ARRIVALS', wall: 'back', at: 3, y: 4.3, size: 0.36 },
  decor: {
    rug: false,
    strips: strips([-9, -4.5, 0, 4.5, 9], [3, 8], { len: 2.6, along: 'u' }),
    // the arrivals board over the desk
    screens: [{ wall: 'back', along: 3, y: 3.2, w: 3.2, h: 0.9, show: 'status' }],
    signs: [way('back', -6, 2.6, 'Baggage', 0.16), warn('left', 3, 2.2, 'No smoking')],
    // check-in is through the south door, in the other half of the terminal; the stair down is staff only
    doors: [{ wall: 'right', at: 6, w: 1.4, finish: 'steel', label: 'Check-in' }, { wall: 'left', at: 9.5, w: 0.95, finish: 'steel', label: 'Staff' }],
  },
};

// The carousel: a steel island with a belt of slats round it, flush with the floor, and a lip of steel at
// its edge; the belt runs back to the hatch in the back wall.
const BELT = { u: 1.45, v0: 5.2, v1: 12.8 };
const BAGGAGE = {
  ...base, face: 90, w: 14, d: 16, h: 3.4, ground: 'tile', windowless: true,
  tone: { wall: '#a9aca6', trim: '#2a2d30', ceiling: '#c8cac6', accent: YELLOW },
  decor: {
    rug: false,
    strips: strips([-3.5, 3.5], [2.5, 6, 9.5, 13], { len: 2.4, along: 'v' }),
    grates: [[-1.05, 9, 0.8, 7.6], [1.05, 9, 0.8, 7.6], [0, 5.575, 1.3, 0.75], [0, 12.425, 1.3, 0.75], [0, 14.4, 0.9, 3.2]],
    pipes: [
      ...spans([-BELT.u, BELT.v0], [-BELT.u, BELT.v1], 0.3, 0.035, '#9aa0a6'),
      ...spans([BELT.u, BELT.v0], [BELT.u, BELT.v1], 0.3, 0.035, '#9aa0a6'),
      ...spans([-BELT.u, BELT.v0], [BELT.u, BELT.v0], 0.3, 0.035, '#9aa0a6'),
    ],
    paint: [{ kind: 'hazard', rect: [-1.75, 1.75, 4.9, 12.8], t: 0.12 }],
    doors: [{ wall: 'back', at: 0, w: 1.4, finish: 'steel' }],
    signs: [
      { wall: 'back', along: 0, y: 2.55, text: 'Please let your bags come to you', h: 0.08, hex: '#101010', plateHex: '#e8e4d8' },
      way('right', 12, 2.45, 'Lost property', 0.09),
      way('front', -3, 2.6, 'Way out'),
    ],
  },
};

// ── THE TOWER (map_int_cw_tower) ────────────────────────────────────────────────────────────────────
// The lobby at the foot of the shaft: glass on three sides, the lift and the stair in the back wall, both shut.
const TOWER = {
  ...base, face: 90, w: 9, d: 9, h: 3.6, ground: 'concrete', glass: ['front', 'left', 'right'],
  tone: { wall: '#9aa0a4', trim: '#23272b', ceiling: '#c6cacc', accent: STEEL },
  decor: {
    rug: false,
    // the ring of downlights, set back from the glass
    strips: strips([-2.2, 2.2], [2.6, 6.4], { len: 0.5, along: 'u' }),
    doors: [
      { wall: 'back', at: -1.6, w: 1.2, finish: 'steel', pair: true, trim: STEEL, dial: 30, label: 'Lift' },
      { wall: 'back', at: 2.3, w: 0.95, finish: 'steel', label: 'Stairs' },
    ],
    // the speaker that reads out the wind and the pressure, and the readout beside it
    screens: [{ wall: 'back', along: -3.6, y: 1.75, w: 0.5, h: 0.4, show: 'gauges' }],
    lamps: [{ wall: 'back', along: -3.6, y: 2.35, hex: '#3a3d40' }],
    signs: [caution('back', 0.4, 2.5, 'Authorised staff only', 0.07)],
  },
};

// ── THE HANGARS ─────────────────────────────────────────────────────────────────────────────────────
const HANGAR_TONE = { wall: '#6f767a', trim: '#2a2e31', ceiling: '#3a3f43', accent: YELLOW };

// Coldwater Regional Hangar: faces south, where the roller door is. The street door is the east end of the
// same wall; the ops desk is on the east wall, the workbench and racks on the west.
const OUT_STAND = { kind: 'aircraft', at: [1.5, 13.5], face: 'front', len: 20, wid: 22, from: 'front' };
const OUTSKIRTS = {
  ...base, face: 180, w: 30, d: 28, h: 8, ground: 'concrete', windowless: true,
  doors: { south: 12 },
  stand: OUT_STAND,
  tone: HANGAR_TONE,
  decor: {
    rug: false,
    strips: strips([-9, -3, 3, 9], [6, 14, 22], { len: 3, along: 'v' }),
    paint: [
      ...standPaint(OUT_STAND),
      // the walkway from the street door, kept off the stand
      { kind: 'line', from: [-12.9, 0.5], to: [-12.9, 27.4], t: 0.08, hex: WHITE },
      { kind: 'line', from: [-10.1, 0.5], to: [-10.1, 27.4], t: 0.08, hex: WHITE },
    ],
    grates: [[1.5, 13.5, 8, 0.4]],
    pipes: [
      truss(-15, 15, 7, 7.4), truss(-15, 15, 14, 7.4), truss(-15, 15, 21, 7.4),
      // an air line down the west wall, hung from the roof
      { from: [14.7, 1, 3.2], to: [14.7, 27, 3.2], r: 0.04, hex: '#3a6a9a' },
    ],
    drops: [{ wall: 'left', along: 11.2, n: 4, r: 0.03 }],
    // the bank of flight monitors over the ops desk
    screens: [
      { wall: 'left', along: 9.2, y: 1.45, w: 0.62, h: 0.4, show: 'status' },
      { wall: 'left', along: 10, y: 1.45, w: 0.62, h: 0.4, show: 'gauges' },
      { wall: 'left', along: 10.8, y: 1.45, w: 0.62, h: 0.4, show: 'status' },
      { wall: 'left', along: 9.6, y: 1.95, w: 0.62, h: 0.4, show: 'gauges' },
      { wall: 'left', along: 10.4, y: 1.95, w: 0.62, h: 0.4, show: 'status' },
    ],
    signs: [
      { wall: 'back', along: 1.5, y: 5.4, text: 'Hangar 1', h: 0.9, hex: YELLOW, plate: false },
      caution('front', 1.5, 3.4, 'Keep clear', 0.22),
      warn('front', -8.6, 2.4, 'No smoking'),
      warn('right', 19, 2.6, 'No naked flames'),
    ],
    lamps: [{ wall: 'front', along: -9.8, y: 3.8 }, { wall: 'front', along: 12.8, y: 3.8 }],
    doors: [{ wall: 'back', at: -12, w: 0.95, finish: 'steel', label: 'Stairs' }],
  },
};

// Coldwater Regional Heavy Hangar: faces west, the street door at the south end of that wall. The stand
// takes the whole slab between the nose line and the tail line; the drums are racked along the north wall.
const HEAVY_STAND = { kind: 'aircraft', at: [2, 15.5], face: 'front', len: 25, wid: 22, from: 'front' };
const HEAVY = {
  ...base, face: 270, w: 30, d: 30, h: 8, ground: 'concrete', windowless: true,
  doors: { west: -13 },
  stand: HEAVY_STAND,
  tone: { wall: '#62696c', trim: '#24282b', ceiling: '#33383c', accent: YELLOW },
  decor: {
    rug: false,
    // caged high-bay lamps under the trusses
    strips: strips([-9, -1, 7], [5, 12.5, 20, 27], { cage: true }),
    paint: [
      ...standPaint(HEAVY_STAND, { t: 0.24 }),
      // the nose line and the tail line
      { kind: 'line', from: [-9, 3.4], to: [13, 3.4], t: 0.16, hex: YELLOW },
      { kind: 'line', from: [-9, 27.6], to: [13, 27.6], t: 0.16, hex: YELLOW },
      { kind: 'line', from: [-13.9, 0.5], to: [-13.9, 29.4], t: 0.08, hex: WHITE },
      { kind: 'line', from: [-11, 0.5], to: [-11, 29.4], t: 0.08, hex: WHITE },
    ],
    grates: [[2, 9, 14, 0.4], [2, 22, 14, 0.4]],
    pipes: [truss(-15, 15, 7.5, 7.5), truss(-15, 15, 15, 7.5), truss(-15, 15, 22.5, 7.5)],
    drops: [{ wall: 'left', along: 20, n: 5, r: 0.04, into: true }],
    signs: [
      { wall: 'back', along: 2, y: 5.6, text: 'Hangar 3', h: 1.1, hex: YELLOW, plate: false },
      warn('right', 15.5, 3.2, 'Jet fuel. No naked flames', 0.12),
      caution('front', 2, 3.6, 'Keep clear', 0.26),
    ],
    lamps: [{ wall: 'front', along: -9.6, y: 4 }, { wall: 'front', along: 13.6, y: 4 }],
  },
};

// Threshold Helipad Hangar: faces west, where the bay doors stand open onto the ramp (the front's glass). The
// street door is at the south end of the east wall; a landing circle is painted in the middle of the stand.
const THR_STAND = { kind: 'aircraft', at: [1, 11], face: 'front', len: 16, wid: 16, from: 'front' };
const THRESHOLD = {
  ...base, face: 270, w: 26, d: 26, h: 7.5, ground: 'concrete', glass: ['front'],
  doors: { east: -10 },
  stand: THR_STAND,
  tone: HANGAR_TONE,
  decor: {
    rug: false,
    pad: { at: THR_STAND.at, r: 6 },
    strips: strips([-8, 0, 8], [5, 13, 21], { len: 3, along: 'v' }),
    paint: [
      { kind: 'hazard', rect: [-7, 9, 3, 19], t: 0.2 },
      { kind: 'line', from: [1, 0.3], to: [1, 4.4], t: 0.12, hex: YELLOW, arrows: true },
      { kind: 'line', from: [-10.9, 25.6], to: [-10.9, 0.6], t: 0.08, hex: WHITE },
      { kind: 'line', from: [-7.4, 25.6], to: [-7.4, 0.6], t: 0.08, hex: WHITE },
    ],
    pipes: [truss(-13, 13, 6, 7), truss(-13, 13, 13, 7), truss(-13, 13, 20, 7)],
    screens: [
      { wall: 'left', along: 11.4, y: 1.45, w: 0.62, h: 0.4, show: 'status' },
      { wall: 'left', along: 12.2, y: 1.45, w: 0.62, h: 0.4, show: 'gauges' },
      { wall: 'left', along: 13, y: 1.45, w: 0.62, h: 0.4, show: 'status' },
    ],
    drops: [{ wall: 'left', along: 14, n: 4, r: 0.03 }],
    signs: [
      caution('right', 11, 2.5, 'Mind the rotors', 0.16),
      warn('back', -6, 2.2, 'No smoking'),
    ],
    doors: [{ wall: 'back', at: 6, w: 0.95, finish: 'steel', label: 'Stairs' }],
    lamps: [{ wall: 'back', along: -11.4, y: 2.5 }],
  },
};

// The Hangar Bay at Buzzard Field, the Reach: faces west onto the apron door, which is the street. Darker,
// dirtier, half the lights caged work-lamps, the flight-ops desk by the apron door, the tarps along the back
// and butts on the floor under the one NO SMOKING sign.
const REACH_STAND = { kind: 'aircraft', at: [0, 11.5], face: 'front', len: 18, wid: 18, from: 'front' };
const REACH = {
  ...base, face: 270, w: 26, d: 24, h: 7, ground: 'concrete', windowless: true,
  doors: { west: -10.5 },
  stand: REACH_STAND,
  tone: { wall: '#4a4640', trim: '#1e1c1a', ceiling: '#2a2826', accent: '#b8862a' },
  decor: {
    rug: false,
    strips: [...strips([-6, 6], [6, 16], { cage: true }), { at: [0, 21.5], len: 2.4, along: 'u' }],
    pendants: [{ at: [-11.6, 8], y: 2.3, kind: 'school', k: 0.9, tint: [1.12, 0.96, 0.78] }, { at: [11, 3], y: 2.2, kind: 'school', k: 0.8, tint: [1.12, 0.96, 0.78] }],
    paint: [
      { kind: 'hazard', rect: [-9, 9, 2.5, 20.5], t: 0.14 },
      { kind: 'line', from: [0, 0.3], to: [0, 2.5], t: 0.1, hex: '#a8902a' },
    ],
    pipes: [truss(-13, 13, 6, 6.6), truss(-13, 13, 12, 6.6), truss(-13, 13, 18, 6.6)],
    drops: [{ wall: 'right', along: 2, n: 3, r: 0.03 }],
    screens: [{ wall: 'right', along: 2.4, y: 1.5, w: 0.55, h: 0.36, show: 'status' }],
    // the ops board by the desk, hand-lettered in paint marker on plywood, and the card wired to the pump
    signs: [
      { wall: 'right', along: 5.6, y: 2.25, text: 'No manifests', h: 0.11, hex: '#1a1a1a', plateHex: '#a8865a' },
      { wall: 'right', along: 5.6, y: 1.95, text: 'No questions', h: 0.11, hex: '#a01818', plateHex: '#a8865a' },
      { wall: 'right', along: 5.6, y: 1.65, text: 'Cash on the skid', h: 0.11, hex: '#1a3a8a', plateHex: '#a8865a' },
      { wall: 'left', along: 14, y: 1.55, text: 'Cash on the skid', h: 0.05, hex: '#1a1a1a', plateHex: '#c8b48a' },
      warn('left', 4.2, 2.2, 'No smoking'),
    ],
    litter: [{ at: [-12.2, 4.2], r: [0.6, 1.1], n: 40, seed: 7 }, { at: [10.6, 5], r: [1.4, 1], n: 30, seed: 11 }],
    grates: [[0, 11.5, 6, 0.4]],
    doors: [{ wall: 'back', at: -9, w: 0.95, finish: 'steel', label: 'Stairs' }],
    lamps: [{ wall: 'front', along: -8.8, y: 3.4, hex: '#ff8a1a' }],
  },
};

const ROOMS = {
  zone_cw_checkin: CHECKIN, zone_cw_security: SECURITY, zone_cw_lounge: LOUNGE, zone_cw_gate: GATE,
  zone_cw_arrivals: ARRIVALS, zone_cw_baggage: BAGGAGE, zone_cw_tower: TOWER,
  zone_hangar_outskirts: OUTSKIRTS, zone_heavy_bay: HEAVY, zone_hangar_threshold: THRESHOLD, zone_bld_897_1175_lobby: REACH,
};

// ── THE ROWS ────────────────────────────────────────────────────────────────────────────────────────
// What each existing row is drawn as and where it stands. A fixture with no look isn't drawn, so the boards,
// the scanner arch and the half-stripped flyer stay in the text; the room's decor draws the boards and the arch.
const office = { arche: 'seat', form: 'office' };
const workbench = (wear) => ({ arche: 'surface', form: 'counter', dims: [2.6, 0.75, 0.92], wear });
const PLACE = {
  // check-in
  furn_cw_checkin_desks: { look: { arche: 'surface', form: 'counter', dims: [12.4, 0.8, 1.0], wear: 0.5 }, spot: { at: [-4, 11.6], turn: 0 } },
  furn_cw_checkin_bench: { look: { arche: 'bench', form: 'bench', dims: [2.4, 0.6, 0.85], wear: 0.6 }, spot: { wall: 'front', along: -5 } },
  // security
  furn_cw_xray_belt: { look: { arche: 'surface', form: 'counter', dims: [3.4, 0.7, 0.85], wear: 0.4 }, spot: { at: [-2, 2.9], turn: 90 } },
  furn_cw_confiscation_bin: { look: { arche: 'cabinet', form: 'vitrine', dims: [0.6, 0.45, 1.0] }, spot: { at: [-1.5, 5.6], turn: 90 } },
  // the lounge: the seats face the window, the machines stand along the back wall
  furn_cw_lounge_seats: { look: { arche: 'bench', form: 'bench', dims: [9, 0.62, 0.85], wear: 0.5 }, spot: { at: [0, 7], turn: 0 } },
  furn_cw_snack_machine: { look: { arche: 'prop', form: 'cabinet', dims: [0.95, 0.85, 1.85] }, spot: { wall: 'back', along: -1.6 } },
  furn_cw_drinks_machine: { look: { arche: 'cabinet', form: 'vitrine', dims: [1.0, 0.8, 1.95] }, spot: { wall: 'back', along: -0.45 } },
  furn_cw_coffee_machine: { look: { arche: 'prop', form: 'cabinet', dims: [0.8, 0.75, 1.8] }, spot: { wall: 'back', along: 0.7 } },
  // Gate 1: the desk faces the queue, the queue's back rail is the row, the door's reader is by the glass
  furn_cw_gate_desk: { look: { arche: 'surface', form: 'desk', dims: [2.0, 0.7, 1.0] }, spot: { at: [0, 3.2], turn: 180 } },
  furn_cw_queue_belts: { look: { arche: 'surface', form: 'rail', dims: [5.4, 0.12, 1.0] }, spot: { at: [0.9, 10.2], turn: 0 } },
  furn_cw_gate_door: { look: { arche: 'prop', form: 'cabinet', dims: [0.45, 0.3, 1.3] }, spot: { wall: 'front', along: 4.0 } },
  // arrivals and baggage
  furn_cw_arrivals_desk: { look: { arche: 'surface', form: 'counter', dims: [3.2, 0.8, 1.05], wear: 0.3 }, spot: { at: [3, 9], turn: 0 } },
  furn_cw_arrivals_chairs: { look: { arche: 'bench', form: 'bench', dims: [3.0, 0.6, 0.85], wear: 0.6 }, spot: { wall: 'front', along: -8 } },
  furn_cw_baggage_carousel: { look: { arche: 'small', form: 'box', dims: [6.0, 1.2, 0.5] }, spot: { at: [0, 9], turn: 90 } },
  furn_cw_baggage_trolleys: { look: { arche: 'surface', form: 'rail', dims: [2.6, 0.12, 1.0] }, spot: { wall: 'left', along: 3 } },
  furn_cw_lost_property: { look: { arche: 'cabinet', form: 'cupboard', dims: [1.2, 0.3, 0.6] }, spot: { wall: 'right', along: 12 } },
  // the hangars
  furn_hangar_bench_outskirts: { look: workbench(0.7), spot: { wall: 'right', along: 17 } },
  furn_hangar_chair_outskirts: { look: office, spot: { at: [-13.5, 10], turn: -90 } },
  furn_cardmach_hangar: { look: { arche: 'prop', form: 'cabinet', dims: [0.8, 0.6, 1.75] }, spot: { wall: 'front', along: -14.2 } },
  furn_hangar_bench_threshold: { look: workbench(0.7), spot: { wall: 'right', along: 21 } },
  furn_hangar_chair_threshold: { look: office, spot: { at: [-11.5, 12], turn: -90 } },
  furn_bld_897_1175_a_tool_workbench: { look: { arche: 'surface', form: 'counter', dims: [2.8, 0.8, 0.92], wear: 0.9 }, spot: { wall: 'left', along: 8 } },
  furn_bld_897_1175_avgas_cache: { look: { arche: 'prop', form: 'tank', dims: [1.0, 1.0, 1.1], wear: 0.8 }, spot: { wall: 'left', along: 14 } },
  furn_bld_897_1175_contraband_tarps: { look: { arche: 'store', form: 'crate', dims: [7, 1.4, 1.6], wear: 0.8 }, spot: { wall: 'back', along: 0 } },
  furn_bld_897_1175_the_flight_ops_desk_chair: { look: { ...office, wear: 0.8 }, spot: { at: [11, 4.1], turn: 0 } },
};

// Rows the room text already names that weren't there to draw.
const row = (id, zone_id, name, object_type, description, flags) => ({ description, flags, hp: null, hp_max: null, id, light_type: null, lumen_output: null, name, object_type, power_draw_kw: null, price: 0, zone_id });
const NEW = [
  row('furn_cw_lounge_seats_front', 'zone_cw_lounge', 'the front row of seats', 'furniture',
    'The row nearest the glass: moulded seats on a steel beam, bolted to the floor. Two of the armrests are missing.',
    { aliases: 'front row,front seats,seats', interactions: ['sit'], look: { arche: 'bench', form: 'bench', dims: [9, 0.62, 0.85], wear: 0.5 }, spot: { at: [0, 3.8], turn: 0 } }),
  row('furn_cw_tower_desk', 'zone_cw_tower', 'the tower desk', 'fixture',
    "A steel desk facing the door, with a phone and a visitors' book on it. The last entry in the book is in pencil and has been rubbed out.",
    { aliases: 'desk,phone,book,visitors book', look: { arche: 'surface', form: 'desk', dims: [1.8, 0.8, 0.76] }, spot: { at: [0, 5.4], turn: 0 } }),
  row('furn_hangar_opsdesk_outskirts', 'zone_hangar_outskirts', 'the ops desk', 'fixture',
    'A steel desk on castors under a bank of flight monitors: the weather, the runway lights and a radar picture with nothing on it. A radio handset hangs off the side on its cord.',
    { aliases: 'ops desk,desk,monitors,radio,handset', look: { arche: 'surface', form: 'desk', dims: [2.2, 0.8, 0.76] }, spot: { wall: 'left', along: 10 } }),
  row('furn_hangar_racks_outskirts', 'zone_hangar_outskirts', 'the tool racks', 'fixture',
    'Steel racking along the wall: drawers of sockets, coils of safety wire, a tyre on its rim and a box of rags. Every tool has a painted outline, and about half the outlines are empty.',
    { aliases: 'racks,rack,tools,tool rack,racking', look: { arche: 'store', form: 'shelves', dims: [4.0, 0.5, 2.2], wear: 0.6 }, spot: { wall: 'right', along: 21.5 } }),
  row('furn_hangar_opsdesk_threshold', 'zone_hangar_threshold', 'the ops desk', 'fixture',
    'A steel desk on castors under a bank of flight monitors: the weather, the ramp camera and a radar picture with nothing on it. A radio handset hangs off the side on its cord.',
    { aliases: 'ops desk,desk,monitors,radio,handset', look: { arche: 'surface', form: 'desk', dims: [2.2, 0.8, 0.76] }, spot: { wall: 'left', along: 12 } }),
  row('furn_hangar_racks_threshold', 'zone_hangar_threshold', 'the tool racks', 'fixture',
    'Steel racking along the wall: drawers of sockets, a rotor blade in a padded sleeve, coils of safety wire and a box of rags. Every tool has a painted outline, and most are in them.',
    { aliases: 'racks,rack,tools,tool rack,racking,blade', look: { arche: 'store', form: 'shelves', dims: [4.0, 0.5, 2.2], wear: 0.5 }, spot: { wall: 'right', along: 16 } }),
  row('furn_heavy_bay_drums', 'zone_heavy_bay', 'the fuel drums', 'fixture',
    'Jet-fuel drums racked three high along the wall, the rack bowed in the middle. Each lid has a date painted on it. A drip tray under the bottom row is full.',
    { aliases: 'drums,fuel,jet fuel,rack,drip tray', look: { arche: 'store', form: 'shelves', dims: [14, 1.0, 2.8], wear: 0.7 }, spot: { wall: 'right', along: 15.5 } }),
  row('furn_bld_897_1175_ops_desk', 'zone_bld_897_1175_lobby', 'the flight-ops desk', 'fixture',
    'Three scavenged flight monitors zip-tied to a steel desk, a radio under them hissing static, and a hand-mic on a hook, worn smooth where the thumb goes.',
    { aliases: 'ops desk,desk,monitors,radio,hand-mic,mic', look: { arche: 'surface', form: 'desk', dims: [2.0, 0.8, 0.76], wear: 0.9 }, spot: { at: [11, 3], turn: 180 } }),
];

// ── WRITE ───────────────────────────────────────────────────────────────────────────────────────────
for (const [id, room] of Object.entries(ROOMS)) {
  const z = read('zones', id);
  z.flags = { ...z.flags, room };
  save('zones', z);
}
for (const [id, { look, spot }] of Object.entries(PLACE)) {
  const r = read('furniture', id);
  r.flags = { ...(r.flags || {}), look, spot };
  save('furniture', r);
}
for (const r of NEW) {
  if (r.description.length > 300) throw new Error(`${r.id}: description over 300 characters`);
  if (/—/.test(r.description)) throw new Error(`${r.id}: an em dash`);
  save('furniture', r);
}
// every room with a spec is lit: its power_zones row and a light (all of them have both already)
for (const id of Object.keys(ROOMS)) {
  if (!fs.existsSync(file('power_zones', id))) throw new Error(`${id}: no power_zones row`);
  const lit = fs.readdirSync(path.join(CONTENT_DIR, 'furniture')).some((f) => f.startsWith('furn_light_') && JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, 'furniture', f), 'utf8')).zone_id === id);
  if (!lit) throw new Error(`${id}: no light`);
}
console.log(`airport-rooms: ${wrote} file(s) written`);
