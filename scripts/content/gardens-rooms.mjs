// One-shot authoring pass for Golden Goose Gardens in ROOM (docs/proposals/slush-fund.md, "In ROOM"): the
// Concourse, the Stands, Rinkside and the Press Box as rooms you walk through, and four new ones: the Zamboni Bay
// off Rinkside, the Cup Room off the Stands, and the Men's and Women's rooms off the Concourse. This writes each
// room's `flags.room` and text, the new zones with their connections, power and lights, every row's `flags.look`
// and `flags.spot`, the rows the rooms need (the ticket window, the seat doors, the Cup's case, the champions'
// board, the window onto the ice, the restrooms' fittings) and Ken Raven's routine. Idempotent: a file is only
// written when it would change. Run it after slush-fund.mjs, which rewrites the rooms' exits from its own list.
//
//   node scripts/content/gardens-rooms.mjs
//
// The frame (client/shared/room-layout.js): every room here faces north (face 0), so the front wall is north,
// right is east, left is west and back is south. A spot's `at` is [u, v] in metres, u east of the room's middle
// and v south of the north wall; `turn` 0 faces north, 90 east, 180 south, -90 west.
//
// The plan: the street door is in the Concourse's north wall, the Stands through its south wall, the Men's Room
// west and the Women's Room east. The Cup Room is east of the Stands. Rinkside is under the Stands, a flight up
// from its west end, and the Zamboni Bay is south of Rinkside, its window and roller door in its east wall. The
// Press Box is over the Stands, a flight up from their east side. The Ice Plant stays a shut door.
import fs from 'fs';
import { canonicalJson } from './lib.mjs';

const ZONES = 'content/zones/', FURN = 'content/furniture/', CONN = 'content/connections/', POWER = 'content/power_zones/', NPCS = 'content/npcs/';
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const base = { balcony: false, face: 0, studio: false };
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

// ── the rooms ──────────────────────────────────────────────────────────────────────────────────────────
const ZONE = {
  [C]: { room: { ...base, w: 24, d: 9, h: 4.2, ground: 'terrazzo', tone: { wall: '#d8cdb4', trim: NAVY, ceiling: '#d9d0bc', accent: GOLD },
    decor: deco(4.2, [['front', -4], ['front', 4], ['back', -7], ['back', 7], ['front', -10.5], ['back', 10.6]], { more: {
      floor: { border: NAVY, field: '#bdb3a0', inset: 0.45, line: GOLD, w: 0.24, medallion: [0, 4.5, 1.7], ray: '#8a7a58', rays: 16, star: 'sunburst' },
      pilasters: { hex: '#d8cdb4', trim: GOLD, w: 0.34, y1: 3.6, points: [['front', -2.2], ['front', 2.2], ['back', -2], ['back', 2]] },
      lights: [{ at: [-6, 4.5], kind: 'tiers', r: 0.5, tiers: 3, drop: 1.2, k: 1.4 }, { at: [6, 4.5], kind: 'tiers', r: 0.5, tiers: 3, drop: 1.2, k: 1.4 }],
      downlights: false,
      doors: [{ wall: 'front', at: 10.6, w: 1, label: 'Records', finish: 'steel' }] } }),
    stadium: style([
      { wall: 'back', at: 0, y: 3.05, w: 2.8, h: 0.62, kind: 'gilt', text: 'To the Ice', sub: 'Stands and Rinkside' },
      { wall: 'front', at: 0, y: 3.05, w: 2.2, h: 0.5, kind: 'gilt', text: 'Way Out', sub: 'Glacier Street' },
      { wall: 'left', at: 4.5, y: 2.75, w: 1.3, h: 0.42, kind: 'enamel', text: 'Gentlemen' },
      { wall: 'right', at: 4.5, y: 2.75, w: 1.3, h: 0.42, kind: 'enamel', text: 'Ladies' },
      { wall: 'front', at: -8, y: 3.45, w: 3.4, h: 0.5, kind: 'gilt', text: 'Box Office', sub: 'Every game this week' },
      { wall: 'back', at: 8.6, y: 2.95, w: 3, h: 0.5, kind: 'neon', text: 'Hot Franks', sub: 'Beer · Coffee', tint: '#ff5a3a' },
    ]) } },
  [S]: { room: { ...base, w: 14, d: 12, h: 4.5, ground: 'concrete', tone: { wall: '#cfc4ac', trim: NAVY, ceiling: '#8e8c88', accent: GOLD },
    doors: { down: [-5, 1.2] }, stair: { at: [5, 10.8], climb: 'front', w: 1 },
    decor: deco(4.5, [['front', -4], ['front', 4], ['left', 9], ['right', 3], ['back', -1]]),
    stadium: style([
      { wall: 'right', at: 6, y: 2.85, w: 2, h: 0.5, kind: 'gilt', text: 'The Cup', sub: 'Hall of Champions' },
      { wall: 'back', at: 5, y: 3.3, w: 1.6, h: 0.4, kind: 'enamel', text: 'Press Box', sub: 'Staff only' },
      { wall: 'front', at: -5, y: 2.9, w: 1.8, h: 0.42, kind: 'enamel', text: 'Rinkside', sub: 'Down the stairs' },
    ]) } },
  [R]: { room: { ...base, w: 20, d: 10, h: 3.2, ground: 'rubber', tone: { wall: '#d2d6d8', trim: '#2b4860', ceiling: '#9aa0a4', accent: '#c8202a' },
    windowless: true, stair: { at: [-6, 8.6], climb: 'front', w: 1.2 }, decor: { rug: false, walls: { kind: 'brick', hex: '#7a4a3a', y1: 1.2, trim: NAVY } },
    stadium: style([
      { wall: 'back', at: -3, y: 2.55, w: 2.2, h: 0.5, kind: 'stencil', text: 'Zamboni Bay', tint: '#d8b030' },
      { wall: 'front', at: 4, y: 2.2, w: 2.4, h: 0.5, kind: 'enamel', text: 'Keep Off the Ice', sub: 'By order of the league', tint: '#a8201e' },
    ]) },
    description: "Ice level, behind the boards. The glass above them is scratched to a haze, and one pane behind the north net is newer than the rest. The benches are cut into the boards on the east side, with the penalty box between them. A wide door in the south wall goes through to the Zamboni bay. Stairs go up to the stands." },
  [P]: { room: { ...base, w: 10, d: 7, h: 2.6, ground: 'concrete', tone: { wall: '#6a6e72', trim: '#2a2c2e', ceiling: '#4a4c4e', accent: GOLD },
    windowless: true, doors: { down: [3, 1.0] }, decor: { rug: false }, stadium: style([{ wall: 'back', at: -2, y: 1.95, w: 1.6, h: 0.36, kind: 'neon', text: 'On Air', tint: '#ff3030' }]) } },
};

// the new zones, each a room of the same building, all at the interior's 0,0 like the rest
const zoneRow = (id, name, description, exits, flags = {}) => ({
  ambient_theme: 'indoors', description, exits,
  flags: { building_name: 'Golden Goose Gardens', building_type: 'ice_rink', is_building: true, is_interior: true, world_exit_zone: FACADE, open_all_hours: true, ...flags },
  grid_x: 0, grid_y: 0, grid_z: 0, id, map_id: MAP, name, parent_zone: FACADE,
});
const NEWZ = [
  zoneRow(BAY, 'The Gardens — Zamboni Bay',
    "A concrete garage behind the end boards, smelling of diesel and wet rubber. The resurfacer is parked nose to the roller door, dripping into a drain. A big window in the east wall looks straight out onto the ice, and there's a stool in front of it with a cup of coffee on the sill. Rinkside is north.",
    { north: R }, { floor: 'concrete', room: { ...base, w: 12, d: 10, h: 3.2, ground: 'concrete', windowless: true, doors: { north: -3 }, decor: { rug: false }, tone: { wall: '#a9aca8', trim: '#d8b030', ceiling: '#7c807e', accent: '#d8b030' },
      stadium: style([
        { wall: 'right', at: 7.2, y: 2.75, w: 2.6, h: 0.42, kind: 'stencil', text: 'Door Keep Clear', tint: '#d8b030' },
        { wall: 'left', at: 5, y: 2.2, w: 2.4, h: 0.5, kind: 'stencil', text: 'Ice Crew Only', tint: '#e8e4d8' },
        { wall: 'back', at: 3, y: 2.3, w: 2.2, h: 0.5, kind: 'enamel', text: 'No Smoking', sub: 'Fuel store', tint: '#a8201e' },
      ]) } }),
  zoneRow(CUP, 'The Gardens — Cup Room',
    "A small room off the stands with a carpet and the lights kept low. The Coldwater Cup stands in a glass case in the middle on a stone plinth. The board on the far wall is for whoever won it last. The Stands are west.",
    { west: S }, { floor: 'stone', room: { ...base, w: 9, d: 8, h: 3.8, ground: 'terrazzo', finish: 'fine', windowless: true, tone: { wall: '#2a3446', trim: GOLD, ceiling: '#1e2430', accent: GOLD },
      decor: { walls: { kind: 'walnut', hex: '#4a2c1c', y1: 2.6, rail: 1.0 }, frieze: { h: 0.24, hex: '#141820', line: GOLD, y: 3.25 },
        floor: { border: '#141820', field: '#b8ab90', inset: 0.4, line: GOLD, w: 0.22, medallion: [0, 3.8, 1.5], ray: '#8a6a3a', rays: 24, star: 'sunburst' },
        sconces: { kind: 'fan', y: 2.3, points: [['right', 2], ['right', 6], ['back', -3], ['back', 3]] }, lights: [{ at: [0, 3.8], kind: 'tiers', r: 0.55, tiers: 4, drop: 1.0, k: 1.2 }],
        pilasters: { hex: '#2a3446', trim: GOLD, w: 0.3, y1: 3.2, points: [['back', -1.5], ['back', 1.5]] }, downlights: false },
      stadium: style([{ wall: 'left', at: 4, y: 3.0, w: 2.4, h: 0.5, kind: 'gilt', text: 'Hall of Champions', sub: 'The Coldwater Cup' }]) } }),
  zoneRow(MENS, "The Gardens — Men's Room",
    "White tiles going yellow at the grout. Two urinals on the north wall, a steel trough along the west wall, and two cubicles at the back. One basin, and a mirror with a crack across it. The Concourse is east.",
    { east: C }, { floor: 'tile', room: { ...base, w: 6, d: 7, h: 3.2, ground: 'tile', windowless: true, decor: { rug: false, walls: { kind: 'tile', hex: '#e8e6dc', y1: 2.2, trim: '#2a4a5a' }, frieze: { h: 0.14, hex: '#2a4a5a', line: '#e6e8e2', y: 2.5 } }, stadium: style([{ wall: 'right', at: 1.6, y: 2.6, w: 0.8, h: 0.3, kind: 'enamel', text: 'Wash Your Hands' }]), tone: { wall: '#e6e8e2', trim: '#3a5a6a', ceiling: '#d8dad6', accent: '#3a5a6a' } } }),
  zoneRow(WOMENS, "The Gardens — Women's Room",
    "Pink tiles and a long queue's worth of scuffs on the floor. Three cubicles along the back wall, two basins under a mirror on the north wall, and a hand dryer that doesn't work. The Concourse is west.",
    { west: C }, { floor: 'tile', room: { ...base, w: 6, d: 7, h: 3.2, ground: 'tile', windowless: true, decor: { rug: false, walls: { kind: 'tile', hex: '#ecd2d2', y1: 2.2, trim: '#6a3a4a' }, frieze: { h: 0.14, hex: '#6a3a4a', line: '#f0e2e2', y: 2.5 } }, stadium: style([{ wall: 'front', at: 1.2, y: 2.3, w: 1.8, h: 0.34, kind: 'enamel', text: 'Powder Room' }]), tone: { wall: '#e8d6d6', trim: '#6a3a4a', ceiling: '#dcd0d0', accent: '#6a3a4a' } } }),
];
// the doors into them, from the rooms that have them
const EXITS = { [C]: { west: MENS, east: WOMENS }, [S]: { east: CUP }, [R]: { south: BAY } };
const conn = (a, dir, b) => ({ a, b, blocked: false, dir, id: `conn_slush_${a.replace('zone_slush_', '')}_${dir}`, lockable: false, one_way: false });
const CONNS = [conn(C, 'west', MENS), conn(C, 'east', WOMENS), conn(S, 'east', CUP), conn(R, 'south', BAY)];
const power = (id, name) => ({ capacity_kw: 5000, generator_id: GEN, id, name, source_type: 'junction_box' });
const light = (zone, name, description, lumen) => ({ description, flags: {}, id: `furn_light_${zone}`, light_type: 'overhead', lumen_output: lumen, name, object_type: 'light', power_draw_kw: 0.02, zone_id: zone });

// ── what's in them ─────────────────────────────────────────────────────────────────────────────────────
// existing rows: where they stand and what they're drawn as
const PLACE = {
  furn_slush_counter: { look: { arche: 'surface', form: 'bar', dims: [3.6, 0.8, 1.1] }, spot: { at: [8.6, 8.2], turn: 0 } },
  furn_slush_puck_cards: { look: { arche: 'prop', form: 'packs', label: 'Puck Cards', dims: [0.86, 0.72, 1.85] }, spot: { at: [6.6, 0.36], turn: 180 } },
  furn_slush_stands_cards: { look: { arche: 'prop', form: 'packs', label: 'Puck Cards', dims: [0.86, 0.72, 1.85] }, spot: { at: [-1.6, 11.6], turn: 0 } },
  furn_slush_ticket_machine: { look: { arche: 'prop', form: 'packs', label: 'Tickets', dims: [0.86, 0.72, 1.85] }, spot: { at: [-2.8, 11.6], turn: 0 } },
  furn_slush_benches: { look: { arche: 'bench', form: 'bench', dims: [3.2, 0.6, 0.85] }, spot: { at: [0.6, 8.6], turn: 0 } },
  furn_slush_organ: { look: { arche: 'prop', form: 'piano', dims: [1.6, 0.7, 1.3] }, spot: { at: [-5.8, 11.6], turn: 0 } },
  furn_slush_box: { look: { arche: 'bench', form: 'bench', dims: [2.4, 0.6, 0.85] }, spot: { at: [9.6, 5], turn: -90 } },
  furn_slush_booth: { look: { arche: 'prop', form: 'cabinet', dims: [1.2, 0.9, 2.2] }, spot: { at: [6, 9.4], turn: 0 } },
  furn_slush_desk: { look: { arche: 'surface', form: 'desk', dims: [2.4, 0.7, 0.76] }, spot: { at: [-2, 0.4], turn: 180 } },
  furn_slush_teleprinter: { look: { arche: 'prop', form: 'cabinet', dims: [0.7, 0.55, 1.1] }, spot: { at: [-4.4, 6.6], turn: 0 } },
  // the resurfacer goes into its own bay, parked nose to the roller door in the east wall
  furn_slush_resurfacer: { zone: BAY, look: { arche: 'prop', form: 'resurfacer' }, spot: { at: [1.6, 7.2], turn: 90 } },
};
// text that has to change with the rooms
const RETEXT = {
  furn_slush_cabinet: { flags: { examine_detail: 'A brass plate on the plinth: The Coldwater Cup. The plinth is empty. A card propped on it says the Cup is in the Cup Room, through the stands.' } },
  furn_slush_resurfacer: { description: "The Gardens' only resurfacer, parked nose to the roller door with a drip under the conditioner. Ken Raven's colours are on the tank, and his scarf hangs off the seat when he isn't in it." },
};

const row = (id, zone_id, name, object_type, description, flags) => ({ description, flags, hp: null, hp_max: null, id, light_type: null, lumen_output: null, name, object_type, power_draw_kw: null, price: 0, zone_id });
const seatDoor = (id, at, label, sections, words) => row(id, C, `the ${label.toLowerCase()} door`, 'decoration',
  `A concrete opening onto a short flight of steps, lit at the top where the bowl is. A sign over it says ${label.toUpperCase()}. An usher checks stubs at the bottom step.`,
  { aliases: [`${label.toLowerCase()} door`, `${label.toLowerCase()}`, ...words], interactions: ['buyticket'], seat_door: { stands: STANDS, sections }, look: { arche: 'prop', form: 'seatdoor', label, dims: [2.0, 1.4, 2.8] }, spot: { at, turn: 0 } });
const NEW = [
  // the Concourse: the ticket window and the doors into the seats, either side of the way through to the stands
  row('furn_slush_ticket_window', C, 'the ticket window', 'fixture', "A window in a steel frame with a grille over the glass and a dished slot under it. Nobody seems to be behind it, but put money in the slot and a ticket comes back out. Every game this week, every section.",
    { aliases: ['ticket window', 'window', 'box office', 'tickets', 'slot', 'grille'], interactions: ['buyticket'], ticket_window: { stands: STANDS }, look: { arche: 'surface', form: 'boxoffice', label: 'Tickets', dims: [2.4, 0.8, 2.5] }, spot: { at: [-8, 0.4], turn: 180 } }),
  seatDoor('furn_slush_door_lower', [-9.4, 8.3], 'Lower Bowl', ['glass', 'lower', 'corner', 'far'], ['lower door', 'lower bowl']),
  seatDoor('furn_slush_door_ends', [-5, 8.3], 'Ends', ['net', 'home'], ['ends door', 'end door']),
  seatDoor('furn_slush_door_upper', [3.6, 8.3], 'Upper Tier', ['upper', 'across', 'upperend', 'gods'], ['upper door', 'upper tier']),
  // the Cup Room
  row('furn_slush_cup_case', CUP, 'the Cup case', 'decoration', "The Coldwater Cup in a glass case on a stone plinth, lit from above. A stepped silver barrel banded in black, a gold collar and a bowl on top. The glass is smudged at child height all round.",
    { aliases: ['cup', 'coldwater cup', 'case', 'trophy', 'plinth', 'glass case'], look: { arche: 'prop', form: 'trophy', cup: 'hockey', label: 'The Coldwater Cup', dims: [1.1, 1.1, 2.2] }, spot: { at: [0, 3.8], turn: 0 } }),
  row('furn_slush_champions', CUP, 'the champions board', 'decoration', "A deep frame on the wall in black and gold, lit when there's a champion to show: the club's crest and colours, and the season they won it.",
    { aliases: ['board', 'champions board', 'champions', 'crest', 'frame'], champion_display: 'hockey', look: { arche: 'prop', form: 'champion', dims: [1.8, 0.16, 2.2] }, spot: { at: [0, 7.92], turn: 0 } }),
  // Rinkside: the boards and the glass along the north wall, the ice through it (a window onto the rink, dressed as boards)
  row('furn_slush_rinkside_boards', R, 'the boards', 'decoration', 'The boards and the glass over them, scuffed white with a yellow kick plate and a red cap rail. Through the glass, the ice, and the far stands going up into the dark.',
    { aliases: ['boards', 'glass', 'ice', 'rink'], rink_window: 'hockey', look: { arche: 'prop', form: 'rinkwindow', dress: 'boards', dims: [16, 0.3, 3.1], view: [100, -3, 4.2] }, spot: { at: [1, 0.16], turn: 180 } }),
  // the Zamboni Bay
  row('furn_slush_bay_window', BAY, 'the big window', 'decoration', "A wide window in a steel frame, low enough to see the ice over the boards. The glass is fogged at the corners. From here you can see the whole sheet and most of the benches.",
    { aliases: ['window', 'big window', 'glass', 'ice', 'rink'], rink_window: 'hockey', look: { arche: 'prop', form: 'rinkwindow', dims: [4.2, 0.3, 2.9], view: [-6, 30, 6.5] }, spot: { at: [5.85, 2.6], turn: -90 } }),
  row('furn_slush_bay_stool', BAY, 'the stool', 'furniture', 'A tall steel stool in front of the window, its seat patched with tape. A cup of coffee goes cold on the sill beside it.',
    { aliases: ['stool', 'seat'], interactions: ['sit'], look: { arche: 'seat', form: 'stool' }, spot: { at: [4.9, 2.6], turn: 90 } }),
  row('furn_slush_bay_bench', BAY, 'the workbench', 'furniture', 'A steel bench along the west wall: a vice, spare blades in a rack, a coil of hose and a drum with no label on it.',
    { aliases: ['workbench', 'bench', 'vice', 'blades', 'hose', 'drum'], interactions: ['lean'], look: { arche: 'surface', form: 'desk', dims: [2.6, 0.7, 0.9] }, spot: { at: [-5.6, 5], turn: 90 } }),
  // the restrooms
  ...[[-1.8, 'one'], [-0.8, 'two']].map(([u, n]) => row(`furn_slush_mens_urinal_${n}`, MENS, 'a urinal', 'toilet', 'A porcelain urinal on the north wall with a chrome flush pipe and a panel either side. The cake in it is blue.',
    { aliases: ['urinal', 'urinals'], look: { arche: 'urinal', form: 'urinal' }, spot: { at: [u, 0.2], turn: 180 } })),
  row('furn_slush_mens_trough', MENS, 'the trough', 'toilet', 'A steel trough along the west wall under a tiled splash back, a pipe along the top that sprays it now and then. On a game night there is a line for it.',
    { aliases: ['trough', 'urinal'], look: { arche: 'urinal', form: 'urinaltrough' }, spot: { at: [-2.78, 3.4], turn: 90 } }),
  ...[[-2.45, 'one'], [-1.45, 'two']].map(([u, n]) => row(`furn_slush_mens_stall_${n}`, MENS, 'a cubicle', 'toilet', 'A cubicle with a laminate door that only shuts if you hold it. Somebody has written the score of a game from years ago on the inside.',
    { aliases: ['cubicle', 'stall', 'toilet'], look: { arche: 'stall', form: 'cubicle' }, spot: { at: [u, 6.22], turn: 0 } })),
  row('furn_slush_mens_basin', MENS, 'the basin', 'sink', 'A basin with one tap that runs cold and one that runs colder. The soap is a bar of grey.',
    { aliases: ['basin', 'sink', 'tap'], water_source: true, look: { arche: 'sink', form: 'basin' }, spot: { at: [2.68, 1.4], turn: -90 } }),
  ...[[0.55, 'one'], [1.5, 'two'], [2.45, 'three']].map(([u, n]) => row(`furn_slush_womens_stall_${n}`, WOMENS, 'a cubicle', 'toilet', 'A cubicle with a pink laminate door and a hook on the back of it. The lock works, which nobody expected.',
    { aliases: ['cubicle', 'stall', 'toilet'], look: { arche: 'stall', form: 'cubicle' }, spot: { at: [u, 6.22], turn: 0 } })),
  ...[[0.6, 'one'], [1.8, 'two']].map(([u, n]) => row(`furn_slush_womens_basin_${n}`, WOMENS, 'a basin', 'sink', 'A basin under the long mirror, a dispenser of pink soap beside it.',
    { aliases: ['basin', 'sink', 'tap'], water_source: true, look: { arche: 'sink', form: 'basin' }, spot: { at: [u, 0.25], turn: 180 } })),
];

// Ken Raven keeps the machine in its bay, and watches the game from the stool by the window (plugins/stands crew.js)
const KEN = 'npc_slush_raven';
const KEN_FLAGS = { post: 'furn_slush_bay_stool', ice_crew: { sport: 'hockey', bay: BAY, post: 'furn_slush_bay_stool', machine: 'furn_slush_resurfacer', out: R } };
// Agnes stands behind her counter
const AGNES = 'npc_slush_agnes';

// ── write ──────────────────────────────────────────────────────────────────────────────────────────────
const save = (file, data) => {
  const text = canonicalJson(data);
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) return 0;
  fs.writeFileSync(file, text, 'utf8');
  return 1;
};
let wrote = 0;
ZONE[C].description = "A curved concourse under the stands. The terrazzo floor has a gold sunburst in the middle, gone grey with grit, and red brick to shoulder height under a navy and gold frieze. Turnstiles at the north doors, a concession counter with a fogged glass case, a ticket window, and three doors into the seats. A door marked Records is set in the far wall. The stands are south, the ice plant below.";
for (const [id, { room, description }] of Object.entries(ZONE)) {
  const z = read(`${ZONES}${id}.json`);
  z.flags = { ...z.flags, room };
  if (description) z.description = description;
  if (EXITS[id]) z.exits = { ...z.exits, ...EXITS[id] };
  wrote += save(`${ZONES}${id}.json`, z);
}
for (const z of NEWZ) {
  if (z.description.length > 600) throw new Error(`${z.id}: description too long`);
  wrote += save(`${ZONES}${z.id}.json`, z);
  wrote += save(`${POWER}${z.id}.json`, power(z.id, z.name));
}
for (const c of CONNS) wrote += save(`${CONN}${c.id}.json`, c);
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
  n.description = "A broad, grinning man in a navy ice-crew parka, RAVEN stencilled across the back and a green-and-navy tartan Highlanders scarf at the collar. Brown hair swept up at the front, a dark beard going grey at the chin, black rectangular glasses. He's watching the ice through the window with a cup of coffee.";
  wrote += save(`${NPCS}${KEN}.json`, n);
  const a = read(`${NPCS}${AGNES}.json`);
  a.flags = { ...a.flags, post: 'furn_slush_counter', post_gap: 0.3 };
  wrote += save(`${NPCS}${AGNES}.json`, a);
}
console.log(`${wrote} files written`);
