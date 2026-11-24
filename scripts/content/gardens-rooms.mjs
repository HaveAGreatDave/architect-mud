// One-shot authoring pass for Golden Goose Gardens in ROOM (docs/proposals/slush-fund.md, "In ROOM"): the
// Concourse, the Stands, Rinkside and the Press Box as rooms you walk through, and four more: the Zamboni Bay off
// Rinkside, the Cup Room off the Stands, and the Men's and Women's rooms off the Concourse. This writes each room's
// `flags.room` and text, the zones with their connections, power and lights, every row's `flags.look` and
// `flags.spot`, the rows the rooms need (the ticket window, the turnstiles, the seat doors, the venue's sets, the
// Cup's case, the champions' board, the restrooms' fittings) and Ken Raven's routine. Idempotent: a file is only
// written when it would change. Run it after slush-fund.mjs, which rewrites the rooms' exits from its own list.
//
//   node scripts/content/gardens-rooms.mjs
//
// THE ROOMS STAND AT THE REAL RINK. Rinkside, the Stands and the Press Box are stacked along the north boards, one
// over the other, and the Zamboni Bay is behind the west end boards with the gate in them. Each of them carries
// `flags.room.rink` (panels/room-rink.js): the live game is drawn under the room and its openings onto the ice
// (`rink.open`) are holes in the room's picture, so what's past the boards is the game, at the room's own frame rate. The placement is
// worked out here from the building's own plan (client/shared/building-graph.js), anchored on two planes: the Bay's
// front wall just behind the west end boards and Rinkside's just behind the north boards. Every room then gets the
// same rink in its own frame, so the ice through a doorway into the next room is the same ice.
//
// The rink's frame (gameday's, rink/geo.js): x along the sheet west to east, 0 to 200 ft; y across it, 0 the south
// boards and 85 the north; z up from the ice. The plan's is x east, z north, metres.
//
// A room's frame (client/shared/room-layout.js): u across (right as you face the front wall), v back from the front
// wall. A spot's `at` is [u, v] and `turn` 0 faces the front wall, 90 the right-hand wall. A door offset in
// `flags.room.doors` is the plan's (along x on a north or south wall, along z on an east or west one); `doors.down`
// and `stair` are the room's own [u, v]. The Concourse faces north (its front wall is the street), the rink rooms
// face the ice: Rinkside, the Stands and the Press Box south, the Bay east.
import fs from 'fs';
import { canonicalJson } from './lib.mjs';
import { buildingGraph, buildingLayout, zoneSpecOf } from '../../client/shared/building-graph.js';
import { flightOf, FT_PER_M } from '../../client/shared/room-layout.js';
import { GATE_Y } from '../../client/game/js/panels/rink/zamboni.js';
import { RC } from '../../client/game/js/panels/rink/geo.js';

const ZONES = 'content/zones/', FURN = 'content/furniture/', CONN = 'content/connections/', POWER = 'content/power_zones/', NPCS = 'content/npcs/';
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const base = { balcony: false, studio: false };
const MAP = 'map_int_slush', FACADE = 'zone_district_915_916', GEN = 'gen_zone_util_zone_slush_concourse', STANDS = 'zone_slush_stands';
const C = 'zone_slush_concourse', S = STANDS, R = 'zone_slush_rinkside', P = 'zone_slush_pressbox';
const BAY = 'zone_slush_bay', CUP = 'zone_slush_cup', MENS = 'zone_slush_mens', WOMENS = 'zone_slush_womens';
const NAVY = '#1f3550', GOLD = '#c9a24a', BRICK = '#8e4a34';
// THE GARDENS' HOUSE STYLE (spec.stadium, panels/stadium-signs.js): the front's gilt deco letters and its navy and gold,
// inside a brick barn built in a year on money nobody can account for and not looked after since. Limelight for the
// big words, Italiana for the small; the seat doors' portals in brick. The Coliseum sets its own.
const STYLE = { font: 'Limelight', sub: 'Italiana', ink: NAVY, plate: '#f3ead6', accent: GOLD, frame: NAVY, portal: 'brick', brick: BRICK };
const style = (signs) => ({ ...STYLE, signs });
// a brick dado to `y1`, a gilt zigzag frieze under the ceiling, and fan sconces at `points`
const deco = (H, points, o = {}) => ({ rug: false, walls: { kind: 'brick', hex: BRICK, y1: o.dado ?? Math.min(2.6, H - 1), trim: NAVY },
  frieze: { h: 0.24, hex: NAVY, line: GOLD, y: H - 0.5 }, sconces: { kind: 'fan', y: 2.3, points }, ...o.more });

// ceiling strips (gl/room-decor.js `strips`), each a lamp: a grid of them along u, `cage` for a caged bulkhead
const strips = (us, vs, o = {}) => us.flatMap((u) => vs.map((v) => ({ at: [u, v], len: o.len || 1.5, along: 'u', ...(o.cage ? { cage: true } : {}) })));

// ── where the rink is ──────────────────────────────────────────────────────────────────────────────
// The two planes the rooms are anchored on, in the rink's feet: a room's front wall stands just behind the boards'
// back face (gl/arena.js, 0.28 ft out), so nothing of the arena's boards is inside it
const BOARDS_BACK = 0.3, NORTH_BOARDS = 85;
// Rinkside's and the Stands' openings run only along the straight: past it the corner's seats stand in front of them
const STRAIGHT_X = RC;
// the end straight, where the Bay's opening onto the ice can run: past the corner's start the seats are in front of it
const END_OPEN_Y = 69;

// ── the rooms ──────────────────────────────────────────────────────────────────────────────────────
// The rink rooms' openings (`rink.open`) are filled in after the plan, when where the straight is is known.
const ZONE = {
  [C]: { room: { ...base, face: 0, w: 24, d: 9, h: 4.2, ground: 'terrazzo', tone: { wall: '#d8cdb4', trim: NAVY, ceiling: '#d9d0bc', accent: GOLD },
    // the way in from Glacier Street: a pair of bronze doors under a fanlight (building-graph.js street_door), and the
    // way through to the stands a wide portal between the pilasters, not a door
    street_door: { kind: 'swing', w: 2.8 }, door_w: { south: 2.6 },
    decor: deco(4.2, [['front', -3.4], ['front', 3.4], ['back', -7], ['back', 7], ['front', -10.5], ['back', 10.6]], { more: {
      floor: { border: NAVY, field: '#bdb3a0', inset: 0.45, line: GOLD, w: 0.24, medallion: [0, 4.5, 1.7], ray: '#8a7a58', rays: 16, star: 'sunburst' },
      pilasters: { hex: '#d8cdb4', trim: GOLD, w: 0.34, y1: 3.6, points: [['front', -2.2], ['front', 2.2], ['back', -2], ['back', 2]] },
      lights: [{ at: [-6, 4.5], kind: 'tiers', r: 0.5, tiers: 3, drop: 1.2, k: 1.4 }, { at: [6, 4.5], kind: 'tiers', r: 0.5, tiers: 3, drop: 1.2, k: 1.4 }],
      downlights: false,
      doors: [{ wall: 'front', at: 10.6, w: 1, label: 'Records', finish: 'steel' }] } }),
    stadium: style([
      { wall: 'back', at: 0, y: 3.05, w: 2.8, h: 0.62, kind: 'gilt', text: 'To the Ice', sub: 'Stands and Rinkside' },
      { wall: 'front', at: 0, y: 3.55, w: 3.6, h: 0.5, kind: 'gilt', text: 'Golden Goose Gardens', sub: 'Glacier Street' },
      { wall: 'left', at: 4.5, y: 2.75, w: 1.3, h: 0.42, kind: 'enamel', text: 'Gentlemen' },
      { wall: 'right', at: 4.5, y: 2.75, w: 1.3, h: 0.42, kind: 'enamel', text: 'Ladies' },
      { wall: 'front', at: -8, y: 3.45, w: 3.4, h: 0.5, kind: 'gilt', text: 'Box Office', sub: 'Every game this week' },
      { wall: 'back', at: 8.6, y: 2.95, w: 3, h: 0.5, kind: 'neon', text: 'Hot Franks', sub: 'Beer · Coffee', tint: '#ff5a3a' },
    ]) } },
  [S]: { room: { ...base, face: 180, w: 14, d: 12, h: 3.8, ground: 'concrete', tone: { wall: '#cfc4ac', trim: NAVY, ceiling: '#5e5c58', accent: GOLD },
    // the Cup Room's door 3 m back from the front (the plan's z: south of the Stands' middle), and the flight up to
    // the Press Box along the west wall, climbing toward the ice. `doors.down` is where Rinkside's flight comes up
    doors: { east: -3 }, door_w: { north: 2.6, east: 1.6 }, stair: { at: [5.6, 10.6], climb: 'front', w: 1 },
    decor: deco(3.8, [['left', 9], ['right', 3], ['back', -4], ['back', 4]], { more: { strips: strips([-4, 0, 4], [5.5, 10]) } }),
    stadium: style([
      { wall: 'left', at: 3, y: 2.75, w: 2, h: 0.5, kind: 'gilt', text: 'The Cup', sub: 'Hall of Champions' },
      { wall: 'right', at: 9.2, y: 3.0, w: 1.6, h: 0.4, kind: 'enamel', text: 'Press Box', sub: 'Staff only' },
      { wall: 'back', at: -3, y: 2.9, w: 1.8, h: 0.42, kind: 'enamel', text: 'Rinkside', sub: 'Down the stairs' },
    ]) },
    description: "A terrace at the top of the lower bowl, right over the north boards. A glass rail runs along the front, and past it is the whole sheet under the lights. Rows of slatted benches face the ice, the organ sits at the back, and a ticket machine and a card machine stand by the stairs. A flight goes down to rinkside and another up to the press box. The Cup Room is east and the concourse north." },
  [R]: { room: { ...base, face: 180, w: 20, d: 10, h: 3.2, ground: 'rubber', tone: { wall: '#d2d6d8', trim: '#2b4860', ceiling: '#9aa0a4', accent: '#c8202a' },
    // the Bay's door on the west wall, half a metre south of the middle (the plan's z), and the flight up to the Stands
    doors: { west: -0.5 }, door_w: { west: 1.6 }, stair: { at: [-7.1, 5.0], climb: 'back', w: 1.2 }, decor: { rug: false, walls: { kind: 'brick', hex: '#7a4a3a', y1: 1.2, trim: NAVY }, strips: strips([-6, 0, 6], [3, 7.5]) },
    stadium: style([
      { wall: 'right', at: 4.5, y: 2.6, w: 2.2, h: 0.5, kind: 'stencil', text: 'Zamboni Bay', tint: '#d8b030' },
      { wall: 'front', at: 3.6, y: 2.2, w: 2.4, h: 0.5, kind: 'enamel', text: 'Keep Off the Ice', sub: 'By order of the league', tint: '#a8201e' },
    ]) },
    description: "Ice level, behind the north boards. The glass over them is scratched to a haze, and one pane behind the west net is newer than the rest. The team benches are cut into the boards with the penalty box between them, and the goal judge's booth stands in the corner. A door in the west wall goes through to the Zamboni bay. Stairs go up to the stands." },
  [P]: { room: { ...base, face: 180, w: 10, d: 9, h: 2.8, ground: 'concrete', tone: { wall: '#6a6e72', trim: '#2a2c2e', ceiling: '#4a4c4e', accent: GOLD },
    // (its glass along the front, over the ice, is its `rink.open`, set with the rink below)
    decor: { rug: false, strips: strips([-2.5, 2.5], [4.2], { len: 1.2 }) }, stadium: style([{ wall: 'back', at: -2, y: 2.05, w: 1.6, h: 0.36, kind: 'neon', text: 'On Air', tint: '#ff3030' }]) },
    description: "A glassed box over the north stands, up a steep flight from the terrace. KSAB's commentary desk runs along the glass, two microphones on it and a cushion on one chair, and a monitor on each side wall shows what goes out. A teleprinter in a steel case stands on its own table at the back." },
};

// the zones made here, each a room of the same building, all at the interior's 0,0 like the rest
const zoneRow = (id, name, description, exits, flags = {}) => ({
  ambient_theme: 'indoors', description, exits,
  flags: { building_name: 'Golden Goose Gardens', building_type: 'ice_rink', is_building: true, is_interior: true, world_exit_zone: FACADE, open_all_hours: true, ...flags },
  grid_x: 0, grid_y: 0, grid_z: 0, id, map_id: MAP, name, parent_zone: FACADE,
});
const NEWZ = [
  zoneRow(BAY, 'The Gardens — Zamboni Bay',
    "A concrete garage behind the west end boards, smelling of diesel and wet rubber. Its east side is the boards themselves, and the gate in them opens straight onto the ice. The resurfacer is parked nose to the gate, dripping into a drain, and there's a stool by the boards with a cup of coffee on the ledge. A door at the north end goes through to rinkside.",
    { east: R }, { floor: 'concrete', room: { ...base, face: 90, w: 20, d: 8, h: 3.2, ground: 'concrete', doors: { east: 8.2 }, decor: { rug: false, walls: { kind: 'brick', hex: '#6a4a3a', y1: 1.0, trim: '#d8b030' }, strips: [...strips([-7.5, -2.5, 2.5, 7.5], [3.4], { cage: true }), ...strips([-3], [6.9])] }, tone: { wall: '#a9aca8', trim: '#d8b030', ceiling: '#7c807e', accent: '#d8b030' },
      stadium: style([
        { wall: 'front', at: -1.6, y: 2.5, w: 2.6, h: 0.42, kind: 'stencil', text: 'Gate Keep Clear', tint: '#d8b030' },
        { wall: 'left', at: 3, y: 2.3, w: 2.4, h: 0.5, kind: 'stencil', text: 'Ice Crew Only', tint: '#e8e4d8' },
        { wall: 'back', at: 4, y: 2.3, w: 2.2, h: 0.5, kind: 'enamel', text: 'No Smoking', sub: 'Fuel store', tint: '#a8201e' },
      ]) } }),
  zoneRow(CUP, 'The Gardens — Cup Room',
    "A small room off the stands with a carpet and the lights kept low. The Coldwater Cup stands in a glass case in the middle on a stone plinth. The board on the far wall is for whoever won it last. The Stands are west.",
    { west: S }, { floor: 'stone', room: { ...base, face: 0, w: 9, d: 6, h: 3.8, ground: 'terrazzo', finish: 'fine', windowless: true, tone: { wall: '#2a3446', trim: GOLD, ceiling: '#1e2430', accent: GOLD },
      decor: { walls: { kind: 'walnut', hex: '#4a2c1c', y1: 2.6, rail: 1.0 }, frieze: { h: 0.24, hex: '#141820', line: GOLD, y: 3.25 },
        floor: { border: '#141820', field: '#b8ab90', inset: 0.4, line: GOLD, w: 0.22, medallion: [0, 2.9, 1.3], ray: '#8a6a3a', rays: 24, star: 'sunburst' },
        sconces: { kind: 'fan', y: 2.3, points: [['right', 1.6], ['right', 4.4], ['back', -3], ['back', 3]] }, lights: [{ at: [0, 2.9], kind: 'tiers', r: 0.55, tiers: 4, drop: 1.0, k: 1.2 }],
        pilasters: { hex: '#2a3446', trim: GOLD, w: 0.3, y1: 3.2, points: [['back', -1.5], ['back', 1.5]] }, downlights: false },
      stadium: style([{ wall: 'front', at: 0, y: 3.0, w: 2.4, h: 0.5, kind: 'gilt', text: 'Hall of Champions', sub: 'The Coldwater Cup' }]) } }),
  zoneRow(MENS, "The Gardens — Men's Room",
    "White tiles going yellow at the grout. Two urinals on the north wall, a steel trough along the west wall, and two cubicles at the back. One basin, a mirror with a crack across it, and a television high on the wall by the door. The Concourse is east.",
    { east: C }, { floor: 'tile', room: { ...base, face: 0, w: 6, d: 7, h: 3.2, ground: 'tile', windowless: true, decor: { rug: false, walls: { kind: 'tile', hex: '#e8e6dc', y1: 2.2, trim: '#2a4a5a' }, frieze: { h: 0.14, hex: '#2a4a5a', line: '#e6e8e2', y: 2.5 } }, stadium: style([{ wall: 'right', at: 1.6, y: 2.6, w: 0.8, h: 0.3, kind: 'enamel', text: 'Wash Your Hands' }]), tone: { wall: '#e6e8e2', trim: '#3a5a6a', ceiling: '#d8dad6', accent: '#3a5a6a' } } }),
  zoneRow(WOMENS, "The Gardens — Women's Room",
    "Pink tiles and a long queue's worth of scuffs on the floor. Three cubicles along the back wall, two basins under a mirror on the north wall, a television on the east wall, and a hand dryer that doesn't work. The Concourse is west.",
    { west: C }, { floor: 'tile', room: { ...base, face: 0, w: 6, d: 7, h: 3.2, ground: 'tile', windowless: true, decor: { rug: false, walls: { kind: 'tile', hex: '#ecd2d2', y1: 2.2, trim: '#6a3a4a' }, frieze: { h: 0.14, hex: '#6a3a4a', line: '#f0e2e2', y: 2.5 } }, stadium: style([{ wall: 'front', at: 1.2, y: 2.3, w: 1.8, h: 0.34, kind: 'enamel', text: 'Powder Room' }]), tone: { wall: '#e8d6d6', trim: '#6a3a4a', ceiling: '#dcd0d0', accent: '#6a3a4a' } } }),
];
// every exit these rooms have inside the building (a key in the old exits and not here is taken out: Rinkside's
// south door and the Bay's north one became the west and east ones)
const EXITS = {
  [C]: { west: MENS, east: WOMENS }, [S]: { east: CUP },
  [R]: { west: BAY, up: S }, [BAY]: { east: R },
};
const DROP = { [R]: ['south'], [BAY]: ['north'] };
const conn = (a, dir, b) => ({ a, b, blocked: false, dir, id: `conn_slush_${a.replace('zone_slush_', '')}_${dir}`, lockable: false, one_way: false });
const CONNS = [conn(C, 'west', MENS), conn(C, 'east', WOMENS), conn(S, 'east', CUP), conn(R, 'west', BAY)];
const GONE = [`${CONN}conn_slush_rinkside_south.json`, `${FURN}furn_slush_bay_window.json`, `${FURN}furn_slush_rinkside_boards.json`];
const power = (id, name) => ({ capacity_kw: 5000, generator_id: GEN, id, name, source_type: 'junction_box' });
const light = (zone, name, description, lumen) => ({ description, flags: {}, id: `furn_light_${zone}`, light_type: 'overhead', lumen_output: lumen, name, object_type: 'light', power_draw_kw: 0.02, zone_id: zone });

// ── what's in them ─────────────────────────────────────────────────────────────────────────────────
// existing rows: where they stand and what they're drawn as. The Bay's are filled in after the plan, by the gate.
const PLACE = {
  furn_slush_counter: { look: { arche: 'surface', form: 'bar', dims: [3.6, 0.8, 1.1] }, spot: { at: [8.6, 8.2], turn: 0 } },
  furn_slush_puck_cards: { look: { arche: 'prop', form: 'packs', label: 'Puck Cards', dims: [0.86, 0.72, 1.85] }, spot: { at: [6.6, 0.36], turn: 180 } },
  furn_slush_stands_cards: { look: { arche: 'prop', form: 'packs', label: 'Puck Cards', dims: [0.86, 0.72, 1.85] }, spot: { at: [-6.3, 11.6], turn: 0 } },
  furn_slush_ticket_machine: { look: { arche: 'prop', form: 'packs', label: 'Tickets', dims: [0.86, 0.72, 1.85] }, spot: { at: [-5.2, 11.6], turn: 0 } },
  furn_slush_benches: { look: { arche: 'bench', form: 'bench', dims: [3.2, 0.6, 0.85] }, spot: { at: [1.9, 1.3], turn: 0 } },
  furn_slush_organ: { look: { arche: 'prop', form: 'piano', dims: [1.6, 0.7, 1.3] }, spot: { at: [3.3, 11.4], turn: 0 } },
  furn_slush_box: { look: { arche: 'bench', form: 'bench', dims: [2.4, 0.6, 0.85] }, spot: { at: [-3.6, 0.45], turn: 0 } },
  furn_slush_booth: { look: { arche: 'prop', form: 'cabinet', dims: [1.2, 0.9, 2.2] }, spot: { at: [6.5, 0.6], turn: 0 } },
  furn_slush_desk: { look: { arche: 'surface', form: 'desk', dims: [2.4, 0.7, 0.76] }, spot: { at: [0, 0.6], turn: 180 } },
  furn_slush_teleprinter: { look: { arche: 'prop', form: 'cabinet', dims: [0.7, 0.55, 1.1] }, spot: { at: [-3.8, 8.3], turn: 0 } },
  // the resurfacer in its bay, nose to the gate (where along the front wall is the gate's, set after the plan)
  furn_slush_resurfacer: { zone: BAY, look: { arche: 'prop', form: 'resurfacer' }, spot: null },
};
// text that has to change with the rooms
const RETEXT = {
  furn_slush_cabinet: { flags: { examine_detail: 'A brass plate on the plinth: The Coldwater Cup. The plinth is empty. A card propped on it says the Cup is in the Cup Room, through the stands.' } },
  furn_slush_resurfacer: { description: "The Gardens' only resurfacer, parked nose to the gate in the end boards with a drip under the conditioner. Ken Raven's colours are on the tank, and his scarf hangs off the seat when he isn't in it." },
  furn_slush_box: { description: "The penalty box: a bench in a glass pen cut into the boards, a door onto the ice at each end. The timekeeper's stool beside it has a clipboard on it and a stopwatch on a string." },
};

const row = (id, zone_id, name, object_type, description, flags) => ({ description, flags, hp: null, hp_max: null, id, light_type: null, lumen_output: null, name, object_type, power_draw_kw: null, price: 0, zone_id });
const seatDoor = (id, at, label, sections, words) => row(id, C, `the ${label.toLowerCase()} door`, 'decoration',
  `A concrete opening onto a short flight of steps, lit at the top where the bowl is. A sign over it says ${label.toUpperCase()}. An usher checks stubs at the bottom step.`,
  { aliases: [`${label.toLowerCase()} door`, `${label.toLowerCase()}`, ...words], interactions: ['buyticket'], seat_door: { stands: STANDS, sections }, look: { arche: 'prop', form: 'seatdoor', label, dims: [2.0, 1.4, 2.8] }, spot: { at, turn: 0 } });
// A VENUE'S SET (flags.tv_public, plugins/roomstage): on whenever anybody's in its room, on the channel the games are on,
// every one in a room showing the same picture. `spot.y` hangs it with its middle that high.
const venueSet = (id, zone, name, description, words, spot) => ({ ...row(id, zone, name, 'tv', description, {
  aliases: ['tv', 'television', 'set', 'screen', ...words], tv: true, tv_public: true, broadcast_receiver: true, broadcast_device_type: 'tv',
  channel_default: 7, tuned_channel: 7, tv_dial_freq: 7, interactions: ['watch'], look: { arche: 'screen', form: 'flat' }, spot }), power_draw_kw: 0.1 });
const bench = (id, at, name, description, words) => row(id, S, name, 'furniture', description,
  { aliases: ['bench', 'benches', 'seat', 'seats', ...words], interactions: ['sit', 'lie'], look: { arche: 'bench', form: 'bench', dims: [3.2, 0.6, 0.85] }, spot: { at, turn: 0 } });
const NEW = [
  // the Concourse: the ticket window, the turnstiles inside the street doors, the doors into the seats either side of
  // the way through to the stands, and the sets the game's on
  row('furn_slush_ticket_window', C, 'the ticket window', 'fixture', "A window in a steel frame with a grille over the glass and a dished slot under it. Nobody seems to be behind it, but put money in the slot and a ticket comes back out. Every game this week, every section.",
    { aliases: ['ticket window', 'window', 'box office', 'tickets', 'slot', 'grille'], interactions: ['buyticket'], ticket_window: { stands: STANDS }, look: { arche: 'surface', form: 'boxoffice', label: 'Tickets', dims: [2.4, 0.8, 2.5] }, spot: { at: [-8, 0.4], turn: 180 } }),
  ...[-2.25, -0.75, 0.75, 2.25].map((u, i) => row(`furn_slush_turnstile_${i + 1}`, C, 'a turnstile', 'decoration', 'A waist-high steel turnstile with three arms and a reader on the lid that shows a green arrow whether you have a ticket or not. The arms turn either way.',
    { aliases: ['turnstile', 'turnstiles', 'gate', 'arms', 'reader'], look: { arche: 'prop', form: 'turnstile', dims: [0.34, 0.95, 1.02] }, spot: { at: [u, 2.3], turn: 0 } })),
  seatDoor('furn_slush_door_lower', [-9.4, 8.3], 'Lower Bowl', ['glass', 'lower', 'corner', 'far'], ['lower door', 'lower bowl']),
  seatDoor('furn_slush_door_ends', [-5, 8.3], 'Ends', ['net', 'home'], ['ends door', 'end door']),
  seatDoor('furn_slush_door_upper', [3.6, 8.3], 'Upper Tier', ['upper', 'across', 'upperend', 'gods'], ['upper door', 'upper tier']),
  venueSet('furn_slush_tv_doors_west', C, 'the set by the box office', 'A television in a steel cage on the wall, high enough that nobody can reach the knobs. It carries the game.', ['box office set', 'west set'], { at: [-5.2, 0.07], turn: 180, y: 3.0 }),
  venueSet('furn_slush_tv_doors_east', C, 'the set over the card machine', 'A television in a steel cage on the wall over the card machine. The picture is better than the one by the box office. It carries the game.', ['card machine set', 'east set'], { at: [5.2, 0.07], turn: 180, y: 3.0 }),
  venueSet('furn_slush_tv_franks', C, 'the set over the franks', 'A television on a bracket over the concession counter, angled down at the queue. Grease has filmed the bottom of the screen.', ['franks set', 'counter set'], { at: [5.6, 8.93], turn: 0, y: 3.0 }),
  // the Stands: the glass rail along the edge, and rows of benches facing the ice behind the one already there
  row('furn_slush_stands_rail', S, 'the rail', 'decoration', 'A glass rail along the front of the terrace on steel posts, a navy handrail along the top worn to bare metal where people lean. The drop on the other side is to the boards.',
    { aliases: ['rail', 'glass', 'handrail', 'railing', 'edge', 'balustrade'], interactions: ['lean'], look: { arche: 'prop', form: 'balustrade', dims: [13.5, 0.1, 1.05] }, spot: { at: [0, 0.06], turn: 0 } }),
  bench('furn_slush_stands_row_a', [-1.5, 1.3], 'the front bench', 'A slatted bench at the front of the terrace, against the rail. The best seat in the house for anybody who likes being hit by the puck.', ['front bench', 'front row']),
  bench('furn_slush_stands_row_b', [1.9, 2.8], 'the middle bench', 'A slatted bench one row back from the rail. Section nine is stencilled on the end, and the slats are carved with initials.', ['middle bench', 'middle row']),
  bench('furn_slush_stands_row_c', [-1.5, 2.8], 'the bench by the gangway', 'A slatted bench one row back from the rail, by the gangway. Somebody has screwed a cup holder to its end.', ['gangway bench']),
  bench('furn_slush_stands_row_d', [1.9, 4.3], 'the back bench', 'A slatted bench at the back of the rows, a step higher than the rest. You can see over everybody from here.', ['back bench', 'back row']),
  // Rinkside: the two clubs' benches either side of the penalty box, at the boards
  row('furn_slush_bench_home', R, "the home bench", 'furniture', "The home club's bench, cut into the boards: a long padded seat, a rack of sticks behind it and a water bottle crate under it. The door onto the ice is held shut with a hockey tape loop.",
    { aliases: ['home bench', 'bench', 'benches', 'players bench'], interactions: ['sit'], look: { arche: 'bench', form: 'bench', dims: [3.2, 0.6, 0.85] }, spot: { at: [-7.3, 0.45], turn: 0 } }),
  row('furn_slush_bench_away', R, "the visitors' bench", 'furniture', "The visitors' bench, cut into the boards: the same padded seat as the home one, with the padding worn through, and a draught along it from the gate.",
    { aliases: ['visitors bench', 'away bench', 'bench', 'benches'], interactions: ['sit'], look: { arche: 'bench', form: 'bench', dims: [3.2, 0.6, 0.85] }, spot: { at: [0, 0.45], turn: 0 } }),
  // the Press Box: a monitor on each side wall, showing what goes out
  venueSet('furn_slush_tv_press_east', P, 'the east monitor', "KSAB's monitor: a flat screen on the east wall showing the broadcast as it goes out, a few seconds behind the glass.", ['monitor', 'east monitor'], { at: [-4.93, 2.2], turn: 90, y: 1.95 }),
  venueSet('furn_slush_tv_press_west', P, 'the west monitor', "A second monitor on the west wall, the same picture as the east one, with a strip of tape across the bottom that says DO NOT TOUCH.", ['monitor', 'west monitor'], { at: [4.93, 2.2], turn: -90, y: 1.95 }),
  // the Cup Room
  row('furn_slush_cup_case', CUP, 'the Cup case', 'decoration', "The Coldwater Cup in a glass case on a stone plinth, lit from above. A stepped silver barrel banded in black, a gold collar and a bowl on top. The glass is smudged at child height all round.",
    { aliases: ['cup', 'coldwater cup', 'case', 'trophy', 'plinth', 'glass case'], look: { arche: 'prop', form: 'trophy', cup: 'hockey', label: 'The Coldwater Cup', dims: [1.1, 1.1, 2.2] }, spot: { at: [0, 2.9], turn: 0 } }),
  row('furn_slush_champions', CUP, 'the champions board', 'decoration', "A deep frame on the wall in black and gold, lit when there's a champion to show: the club's crest and colours, and the season they won it.",
    { aliases: ['board', 'champions board', 'champions', 'crest', 'frame'], champion_display: 'hockey', look: { arche: 'prop', form: 'champion', dims: [1.8, 0.16, 2.2] }, spot: { at: [0, 5.92], turn: 0 } }),
  // the Zamboni Bay (the stool's and the resurfacer's places along the front wall are set after the plan)
  row('furn_slush_bay_stool', BAY, 'the stool', 'furniture', 'A tall steel stool against the end boards beside the gate, its seat patched with tape. A cup of coffee goes cold on the ledge of the boards.',
    { aliases: ['stool', 'seat'], interactions: ['sit'], look: { arche: 'seat', form: 'stool' }, spot: null }),
  row('furn_slush_bay_bench', BAY, 'the workbench', 'furniture', 'A steel bench along the back wall: a vice, spare blades in a rack, a coil of hose and a drum with no label on it.',
    { aliases: ['workbench', 'bench', 'vice', 'blades', 'hose', 'drum'], interactions: ['lean'], look: { arche: 'surface', form: 'desk', dims: [2.6, 0.7, 0.9] }, spot: { at: [-3, 7.55], turn: 0 } }),
  // the restrooms, a set in each
  ...[[-1.8, 'one'], [-0.8, 'two']].map(([u, n]) => row(`furn_slush_mens_urinal_${n}`, MENS, 'a urinal', 'toilet', 'A porcelain urinal on the north wall with a chrome flush pipe and a panel either side. The cake in it is blue.',
    { aliases: ['urinal', 'urinals'], look: { arche: 'urinal', form: 'urinal' }, spot: { at: [u, 0.2], turn: 180 } })),
  row('furn_slush_mens_trough', MENS, 'the trough', 'toilet', 'A steel trough along the west wall under a tiled splash back, a pipe along the top that sprays it now and then. On a game night there is a line for it.',
    { aliases: ['trough', 'urinal'], look: { arche: 'urinal', form: 'urinaltrough' }, spot: { at: [-2.78, 3.4], turn: 90 } }),
  ...[[-2.45, 'one'], [-1.45, 'two']].map(([u, n]) => row(`furn_slush_mens_stall_${n}`, MENS, 'a cubicle', 'toilet', 'A cubicle with a laminate door that only shuts if you hold it. Somebody has written the score of a game from years ago on the inside.',
    { aliases: ['cubicle', 'stall', 'toilet'], look: { arche: 'stall', form: 'cubicle' }, spot: { at: [u, 6.22], turn: 0 } })),
  row('furn_slush_mens_basin', MENS, 'the basin', 'sink', 'A basin with one tap that runs cold and one that runs colder. The soap is a bar of grey.',
    { aliases: ['basin', 'sink', 'tap'], water_source: true, look: { arche: 'sink', form: 'basin' }, spot: { at: [2.68, 1.4], turn: -90 } }),
  venueSet('furn_slush_tv_mens', MENS, 'the set by the door', 'A small television bolted high on the wall by the door and turned toward the trough, so nobody misses a goal. The cage over it is dented.', ['door set'], { at: [2.93, 5.5], turn: -90, y: 2.0 }),
  ...[[0.55, 'one'], [1.5, 'two'], [2.45, 'three']].map(([u, n]) => row(`furn_slush_womens_stall_${n}`, WOMENS, 'a cubicle', 'toilet', 'A cubicle with a pink laminate door and a hook on the back of it. The lock works, which nobody expected.',
    { aliases: ['cubicle', 'stall', 'toilet'], look: { arche: 'stall', form: 'cubicle' }, spot: { at: [u, 6.22], turn: 0 } })),
  ...[[0.6, 'one'], [1.8, 'two']].map(([u, n]) => row(`furn_slush_womens_basin_${n}`, WOMENS, 'a basin', 'sink', 'A basin under the long mirror, a dispenser of pink soap beside it.',
    { aliases: ['basin', 'sink', 'tap'], water_source: true, look: { arche: 'sink', form: 'basin' }, spot: { at: [u, 0.25], turn: 180 } })),
  venueSet('furn_slush_tv_womens', WOMENS, 'the set on the east wall', 'A small television on a bracket on the east wall, turned so the queue can see it. Somebody has stuck a club sticker over the maker\'s name.', ['east set'], { at: [2.93, 2.6], turn: -90, y: 1.9 }),
];

// Ken Raven keeps the machine in its bay, and watches the game from the stool by the boards (plugins/stands crew.js)
const KEN = 'npc_slush_raven';
const KEN_FLAGS = { post: 'furn_slush_bay_stool', ice_crew: { sport: 'hockey', bay: BAY, post: 'furn_slush_bay_stool', machine: 'furn_slush_resurfacer', out: R } };
// Agnes stands behind her counter
const AGNES = 'npc_slush_agnes';

// ── the zones as they'll be written ────────────────────────────────────────────────────────────────
ZONE[C].description = "A curved concourse under the stands. The terrazzo floor has a gold sunburst in the middle, gone grey with grit, and red brick to shoulder height under a navy and gold frieze. Bronze doors from Glacier Street, a row of turnstiles, a ticket window, a concession counter with a fogged glass case, and three doors into the seats. Televisions on the walls carry the game. A door marked Records is set in the far wall. The stands are south, the ice plant below.";
const zones = new Map();
for (const [id, { room, description }] of Object.entries(ZONE)) {
  const z = read(`${ZONES}${id}.json`);
  // the room is what's written here, and the rink and its openings added below
  z.flags = { ...z.flags, room: { ...room } };
  delete z.flags.window;
  if (description) z.description = description;
  if (EXITS[id] || DROP[id]) { z.exits = { ...z.exits, ...EXITS[id] }; for (const k of DROP[id] || []) delete z.exits[k]; }
  zones.set(id, z);
}
for (const z of NEWZ) { if (EXITS[z.id]) z.exits = { ...EXITS[z.id] }; zones.set(z.id, z); }

// ── the stairs: each room above stands with its `down` at the top of the flight from the room below ──────
// Both rooms face the same way, so a point in the lower room's frame is the same in the upper one's less how far east
// of the lower room's middle the upper one's is (u runs west in a south-facing room). The Stands stand 4.1 m east
// of Rinkside's middle, over its straight, and the Press Box 2 m west of the Stands' middle.
const downAt = (lower, upper, east) => {
  const st = zones.get(lower).flags.room.stair, h = zones.get(lower).flags.room.h, head = flightOf(st, h).head;
  const room = zones.get(upper).flags.room;
  room.doors = { ...(room.doors || {}), down: [+(head[0] + east).toFixed(3), head[1]] };
};
downAt(R, S, 4.1);
downAt(S, P, -2);

// ── the plan, and the rink in it ───────────────────────────────────────────────────────────────────
const others = fs.readdirSync(ZONES).filter((f) => f.endsWith('.json')).map((f) => read(`${ZONES}${f}`)).filter((z) => (z.map_id === MAP || z.id === FACADE) && !zones.has(z.id));
const all = [...others, ...zones.values()], byId = new Map(all.map((z) => [z.id, z]));
const specOf = (z) => zoneSpecOf(byId, z);
const graph = buildingGraph({ zones: all, maps: [read(`content/maps/${MAP}.json`)], specOf }).get(MAP);
const plan = buildingLayout(graph, { zones: all, specOf });
const room = (id) => { const r = plan.rooms[id]; if (!r) throw new Error(`${id} is not on the plan`); return r; };
// the Bay's front wall is just behind the west end boards and Rinkside's just behind the north ones; the ice is
// Rinkside's floor
const FT = FT_PER_M, X0 = -BOARDS_BACK - room(BAY).at[0] * FT, Y0 = NORTH_BOARDS + BOARDS_BACK - room(R).at[1] * FT, ICE = room(R).floor;
const rinkOf = (id) => { const r = room(id); return { sport: 'hockey', at: [+(X0 + r.at[0] * FT).toFixed(2), +(Y0 + r.at[1] * FT).toFixed(2)], look: r.face, ice: +(r.floor - ICE).toFixed(3) }; };
// a south-facing room's u at rink x, and the Bay's u at rink y (it faces east, so u runs south)
const uSouth = (id, x) => +((zones.get(id).flags.room.rink.at[0] - x) / FT).toFixed(2);
const uEast = (y) => +((zones.get(BAY).flags.room.rink.at[1] - y) / FT).toFixed(2);
for (const id of [R, S, P, BAY]) zones.get(id).flags.room.rink = rinkOf(id);
{
  // the openings onto the ice: Rinkside's and the Stands' along the straight (the Stands' behind a glass rail), the
  // Bay's along the end boards, from the corner's start down past the gate
  const rs = zones.get(R).flags.room, ss = zones.get(S).flags.room, bs = zones.get(BAY).flags.room;
  const edge = (spec) => +(spec.w / 2 - 0.12).toFixed(2);
  rs.rink.open = [{ wall: 'front', a: -edge(rs), b: Math.min(edge(rs), uSouth(R, STRAIGHT_X)), y0: 0, y1: rs.h - 0.05 }];
  ss.rink.open = [{ wall: 'front', a: -edge(ss), b: Math.min(edge(ss), uSouth(S, STRAIGHT_X - 4)), y0: 0, y1: ss.h - 0.05 }];
  bs.rink.open = [{ wall: 'front', a: Math.max(-edge(bs), uEast(END_OPEN_Y)), b: edge(bs), y0: 0, y1: bs.h - 0.05 }];
  // the Press Box's glass along its front, over the ice: a window, with the ice under the room through it
  zones.get(P).flags.room.rink.open = [{ wall: 'front', a: -4.8, b: 4.8, y0: 0.7, y1: 2.62, glass: true }];
  // the resurfacer nose to the gate, and Ken's stool against the boards on its north side
  const gate = uEast(GATE_Y);
  PLACE.furn_slush_resurfacer.spot = { at: [gate, 2.6], turn: 0 };
  // the machine's lane painted on the floor from the gate, a drain under where it drips, and an arrow out
  bs.decor = { ...bs.decor, paint: [{ kind: 'hazard', rect: [+(gate - 1.45).toFixed(2), +(gate + 1.45).toFixed(2), 0.05, 4.7] }, { kind: 'arrow', at: [gate, 5.4], dir: [0, -1], s: 0.7 }], grates: [[gate, 3.4, 0.5, 1.4]] };
  NEW.find((r) => r.id === 'furn_slush_bay_stool').flags.spot = { at: [+(gate - 2.9).toFixed(2), 0.55], turn: 0 };
}
// the plan again with the openings in, and it must be clean: no room on another, every flight in its rooms
{
  const again = buildingLayout(graph, { zones: all, specOf });
  if (again.problems.length) throw new Error(`the Gardens' plan has problems: ${JSON.stringify(again.problems)}`);
}

// ── write ──────────────────────────────────────────────────────────────────────────────────────────
const save = (file, data) => {
  const text = canonicalJson(data);
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) return 0;
  fs.writeFileSync(file, text, 'utf8');
  return 1;
};
let wrote = 0;
for (const z of zones.values()) {
  if (z.description.length > 600) throw new Error(`${z.id}: description too long`);
  wrote += save(`${ZONES}${z.id}.json`, z);
}
for (const z of NEWZ) wrote += save(`${POWER}${z.id}.json`, power(z.id, z.name));
for (const c of CONNS) wrote += save(`${CONN}${c.id}.json`, c);
for (const f of GONE) if (fs.existsSync(f)) { fs.unlinkSync(f); wrote++; }
wrote += save(`${FURN}furn_light_${BAY}.json`, light(BAY, 'the bay lights', 'Two caged sodium lamps on the ceiling, buzzing, and a strip light over the workbench.', 2600));
wrote += save(`${FURN}furn_light_${CUP}.json`, light(CUP, 'the Cup room lights', 'Low brass sconces on the walls, and a spot in the case lid over the Cup.', 1800));
wrote += save(`${FURN}furn_light_${MENS}.json`, light(MENS, "the men's room light", 'A long fluorescent tube that flickers when the door bangs.', 2200));
wrote += save(`${FURN}furn_light_${WOMENS}.json`, light(WOMENS, "the women's room light", 'Two fluorescent tubes behind a frosted panel.', 2400));
for (const [id, { look, spot, zone }] of Object.entries(PLACE)) {
  const r = read(`${FURN}${id}.json`);
  r.flags = { ...(r.flags || {}), ...(look ? { look } : {}), spot };
  if (zone) r.zone_id = zone;
  const t = RETEXT[id];
  if (t) { const { flags, ...rest } = t; Object.assign(r, rest); if (flags) r.flags = { ...r.flags, ...flags }; }
  wrote += save(`${FURN}${id}.json`, r);
}
for (const [id, t] of Object.entries(RETEXT)) {
  if (PLACE[id]) continue;
  const r = read(`${FURN}${id}.json`);
  const { flags, ...rest } = t;
  Object.assign(r, rest);
  if (flags) r.flags = { ...r.flags, ...flags };
  wrote += save(`${FURN}${id}.json`, r);
}
for (const r of NEW) {
  if (r.description.length > 300) throw new Error(`${r.id}: description over 300 characters`);
  wrote += save(`${FURN}${r.id}.json`, r);
}
{
  const n = read(`${NPCS}${KEN}.json`);
  n.home_zone = BAY; n.work_zone_id = BAY;
  n.flags = { ...n.flags, ...KEN_FLAGS };
  n.description = "A broad, grinning man in a navy ice-crew parka, RAVEN stencilled across the back and a green-and-navy tartan Highlanders scarf at the collar. Brown hair swept up at the front, a dark beard going grey at the chin, black rectangular glasses. He's on his stool by the gate, watching the game over the boards with a cup of coffee.";
  wrote += save(`${NPCS}${KEN}.json`, n);
  const a = read(`${NPCS}${AGNES}.json`);
  a.flags = { ...a.flags, post: 'furn_slush_counter', post_gap: 0.3 };
  wrote += save(`${NPCS}${AGNES}.json`, a);
}
console.log(`${wrote} files written`);
console.log('the rink:', Object.fromEntries([R, S, P, BAY].map((id) => [id, zones.get(id).flags.room.rink])));
