// One-shot authoring pass: the Coyote's Rest's rooms fitted to its GLASS model (the `saloon` arm in
// client/game/js/panels/glass/models/the-reach.js, rebuilt 2026-11-23; docs/proposals/reach-rebuild.md).
// The model doesn't move to fit the rooms; the rooms are laid out to fit it, the Embassy's way.
// Idempotent: a file is only written when it would change.
//
//   node scripts/content/coyotes-rest-rooms.mjs          (writes; then npm run content:import)
//   node scripts/content/coyotes-rest-rooms.mjs --check  (says what would change, writes nothing)
//
// THE MODEL, in metres (a tile is 17.857 m; the arm works in tiles). Four storeys of board on a
// 0.39 m stone plinth: the walls are 14.3 m across and 11.4 m deep, the floors are at 4.29, 7.68 and
// 11.07 m and the roof at 14.46 m. So, inside: the bar storey is 3.75 m high and each one above it
// 3.25 m, every room is 10.8 m deep, and a floor is 13.6 m across.
//
// THE ROOMS, every one facing south onto Main Street (face 180: the front wall is the street, `u`
// runs to your right as you face it, which is west, and `v` runs back, north, from the front wall):
//   cellar   The Stash, 6 x 5 m under the back of the bar, up a flight through a trapdoor behind the
//            bar. The utility room with the junction box is off its north wall.
//   ground   The Saloon Floor, 13.6 x 10.8. A flight up the east wall to the Gallery.
//   second   The Gallery, 13.6 x 10.8, behind the porch gallery the model draws. (A balcony you walk out on
//            is built for a flat only, so its French doors are windows for now.)
//            A flight up the middle to the third floor.
//   third    The Upstairs Landing, 3.2 wide up the middle, with the East Room and the West Room either
//            side (4.9 x 10.8 each). The flight from the Gallery comes up its east half and the next
//            one goes on up its west half, side by side; its doors are near the front, clear of both.
//   fourth   The Top Landing and the Top East Room and Top West Room, the same.
// Every window the model draws is a sash `panes` entry in the room behind it.
import fs from 'node:fs';
import { canonicalJson } from './lib.mjs';
import { flightOf } from '../../client/shared/room-layout.js';

const CHECK = process.argv.includes('--check');
const Z = 'content/zones/', CN = 'content/connections/', PW = 'content/power_zones/', FU = 'content/furniture/';
// Every file is staged here and written once at the end, so a row placed after it's made (PLACE) is one
// write and a second run writes nothing.
const staged = new Map();
const put = (file, obj) => staged.set(file, obj);
const read = (f) => (staged.has(f) ? JSON.parse(JSON.stringify(staged.get(f))) : JSON.parse(fs.readFileSync(f, 'utf8')));

const P = 'zone_bld_899_1171_';
const FACADE = 'zone_the_reach_872_1954', LOBBY = P + 'lobby', STASH = P + 'store', UTIL = 'zone_util_zone_bld_899_1171_lobby';
const GALLERY = P + 'gallery', L3 = P + 'f3', L3E = P + 'f3e', L3W = P + 'f3w', L4 = P + 'f4', L4E = P + 'f4e', L4W = P + 'f4w';
const MAP = 'map_int_bld_899_1171', GEN = 'gen_zone_util_zone_bld_899_1171_lobby';

// ── THE NUMBERS ─────────────────────────────────────────────────────────────────────────────────────
const W = 13.6, D = 10.8, HG = 3.75, HU = 3.25, LW = 3.2, RW = 4.9, DOOR_V = 2.0;
const SIDE_OFF = DOOR_V - D / 2;   // a landing's side doors, near the front: metres north of the walls' middle
const sash = (wall, a, b, y0, y1) => ({ wall, a, b, y0, y1, kind: 'sash' });   // a `panes` entry drawn as a timber sash (room-layout.js roomSpecOf)
// the flights, and where each one comes out in the room above (`doors.down` there)
const ST_SALOON = { at: [-5.7, 2.6], climb: 'back', w: 1.1 };   // half a metre off the east wall, so its well upstairs clears the radiator under the Gallery's window
const ST_GALLERY = { at: [-1.0, 3.6], climb: 'back', w: 0.9 };
const ST_L3 = { at: [1.0, 3.6], climb: 'back', w: 0.9 };
const ST_STASH = { at: [1.5, 0.7], climb: 'back', w: 1.0 };
const head = (st, h) => flightOf(st, h).head;
const TRAP = [5.4, 9.6];   // where the cellar flight comes up, behind the bar near the back corner

// The upstairs rooms' windows: the model's bays (u 5.71, 2.95, 0, -2.95, -5.71 on the front; 4.46, 0,
// -4.46 on the back; v 8.93, 5.0 and 1.79 down the sides) in each room's own frame.
const UP_Y = [0.89, 2.68];
const frontBay = (u, hw = 0.68) => sash('front', +(u - hw).toFixed(2), +(u + hw).toFixed(2), ...UP_Y);
const backBay = (u, hw = 0.64) => sash('back', +(u - hw).toFixed(2), +(u + hw).toFixed(2), ...UP_Y);
const sideBay = (wall, v) => sash(wall, +(v - 0.64).toFixed(2), +(v + 0.64).toFixed(2), ...UP_Y);
const SIDE_C = LW / 2 + 0.28 + RW / 2;   // a side room's middle, off the landing's

const room = (o) => ({ balcony: false, face: 180, studio: false, ...o });
const SPECS = {
  [LOBBY]: room({
    // the hinged pair another pass gave it, widened to the model's doorway (1.86 m)
    w: W, d: D, h: HG, street_door: { kind: 'swing', w: 1.8 },
    panes: [
      sash('front', 1.91, 3.99, 0.71, 3.0), sash('front', -3.99, -1.91, 0.71, 3.0),
      sash('front', 4.96, 6.46, 0.89, 2.64), sash('front', -6.46, -4.96, 0.89, 2.64),
      sash('right', 8.29, 9.57, 1.07, 2.64), sash('right', 2.22, 3.5, 1.07, 2.64),
      sash('left', 8.29, 9.57, 1.07, 2.64),
    ],
    stair: ST_SALOON, doors: { down: TRAP },
  }),
  [STASH]: room({ w: 6, d: 5, h: 2.6, windowless: true, stair: ST_STASH }),
  [GALLERY]: room({
    w: W, d: D, h: HU,
    panes: [
      sash('front', -3.7, -2.2, 0.32, 2.86), frontBay(0), frontBay(5.71), frontBay(-5.71),
      sideBay('right', 8.93), sideBay('right', 5.0), sideBay('right', 1.79),
      sideBay('left', 8.93), sideBay('left', 5.0),
      backBay(4.46), backBay(0), backBay(-4.46),
    ],
    stair: ST_GALLERY, doors: { down: head(ST_SALOON, HG) },
  }),
  [L3]: room({ w: LW, d: D, h: HU, panes: [frontBay(0), backBay(0)], stair: ST_L3, doors: { east: SIDE_OFF, west: SIDE_OFF, down: head(ST_GALLERY, HU) } }),
  [L3E]: room({ w: RW, d: D, h: HU, panes: [frontBay(-2.95 + SIDE_C), frontBay(-5.71 + SIDE_C), sideBay('left', 8.93), sideBay('left', 5.0), backBay(-4.46 + SIDE_C)], doors: { west: SIDE_OFF } }),
  [L3W]: room({ w: RW, d: D, h: HU, panes: [frontBay(5.71 - SIDE_C), frontBay(2.95 - SIDE_C), sideBay('right', 8.93), sideBay('right', 5.0), sideBay('right', 1.79), backBay(4.46 - SIDE_C)], doors: { east: SIDE_OFF } }),
  [L4]: room({ w: LW, d: D, h: HU, panes: [frontBay(0), backBay(0)], doors: { east: SIDE_OFF, west: SIDE_OFF, down: head(ST_L3, HU) } }),
  [L4E]: room({ w: RW, d: D, h: HU, panes: [frontBay(-2.95 + SIDE_C), frontBay(-5.71 + SIDE_C), sideBay('left', 8.93), sideBay('left', 5.0), backBay(-4.46 + SIDE_C)], doors: { west: SIDE_OFF } }),
  // the ghost sign is painted across the top floor's west wall, so this room has no window on that side
  [L4W]: room({ w: RW, d: D, h: HU, panes: [frontBay(5.71 - SIDE_C), frontBay(2.95 - SIDE_C), backBay(4.46 - SIDE_C)], doors: { east: SIDE_OFF } }),
};

// ── HOW EACH ROOM IS FINISHED ───────────────────────────────────────────────────────────────────────
// Board walls and an old bar's dressing (gl/room-decor.js and gl/room-saloon.js; the Embassy lobby is the
// pattern). The bar runs down the west wall with the back bar behind it; the stair is on the east wall and
// the trapdoor behind the far end of the bar, so the floor between is the poker table's.
const BOARD = '#5e432c', BOARD_UP = '#6a4c32';
const TONE = { wall: '#8a7258', trim: '#3a2a1c', ceiling: '#4c3e32' }, TONE_UP = { wall: '#9a8a6e', trim: '#4a3624', ceiling: '#7a6c5a' };
const DECOR = {
  [LOBBY]: {
    walls: { kind: 'walnut', hex: BOARD, rail: 1.0, y1: HG, trim: '#2a1e14' },
    neon: [
      { wall: 'right', at: 3.6, y: 3.2, text: 'WHISKEY', hex: '#ff9526', h: 0.3, lamp: 0.2 },
      { wall: 'back', at: -1.6, y: 3.05, text: 'COLD BEER', hex: '#38e4ff', h: 0.26, lamp: 0.15 },
    ],
    pendants: [
      { at: [-2.6, 7.0], y: 1.75, kind: 'card', len: 1.4, k: 0.8, tint: [0.95, 1.12, 0.85] },
      ...[2.0, 3.6, 5.2].map((v) => ({ at: [4.4, v], y: 2.7, kind: 'school', k: 0.45, tint: [1.15, 0.92, 0.7] })),
    ],
    fans: [[-1.5, 3.4, 0.7], [1.6, 7.6, 0.7]],
    salon: [{ wall: 'back', at: -4.2, y: 2.45, w: 1.8, h: 1.1, seed: 7 }],
    trophy: [{ wall: 'back', at: 2.6, y: 2.9 }],
    chalk: [{ wall: 'right', at: 7.3, y: 1.8, w: 0.8, h: 1.0, title: 'Tonight' }],
    darts: [{ wall: 'back', at: -6.1, y: 1.73 }],
    payphone: [{ wall: 'front', at: -1.4, y: 1.45, note: true }],
    hatstand: [[1.45, 0.55]],
    litter: [{ at: [3.5, 3.6], r: [0.5, 2.0], n: 70, seed: 3 }, { at: [-2.6, 7.0], r: [1.6, 1.2], n: 30, seed: 5 }],
  },
  [GALLERY]: {
    walls: { kind: 'walnut', hex: BOARD_UP, rail: 1.0, y1: HU, trim: '#2e2216' },
    pendants: [{ at: [3.0, 4.0], y: 1.7, kind: 'card', len: 1.2, k: 0.7, tint: [0.95, 1.12, 0.85] }],
    fans: [[3.0, 7.6, 0.65]],
    salon: [{ wall: 'right', at: 6.5, y: 2.2, w: 1.6, h: 1.0, seed: 11 }],
    trophy: [{ wall: 'back', at: -2.6, y: 2.5 }],
    litter: [{ at: [3.0, 4.0], r: [1.2, 1.0], n: 20, seed: 9 }],
  },
  [STASH]: { walls: { kind: 'brick', hex: '#6a5446', y1: 2.6 } },
};
for (const id of [L3, L3E, L3W, L4, L4E, L4W]) DECOR[id] = { walls: { kind: 'walnut', hex: BOARD_UP, rail: 0.95, y1: 1.05, trim: '#2e2216' } };
for (const id of Object.keys(SPECS)) {
  SPECS[id].tone = id === LOBBY || id === STASH ? TONE : TONE_UP;
  if (DECOR[id]) SPECS[id].decor = DECOR[id];
}
SPECS[STASH].ground = 'concrete';
// the swing pair in timber and amber glass, as Jolene's
SPECS[LOBBY].street_door = { kind: 'swing', w: 1.8, trim: '#5a3a22', glass: '#a08a5a', fanlight: true };

// Where the pieces stand, in each room's own frame ({ at: [u, v], turn } or { wall, along }; `turn` 0
// faces the street, 90 the west wall). Merged into each row's `flags`.
const PLACE = {
  furn_bld_899_1171_the_bar: { look: { arche: 'surface', form: 'bar', dims: [4.4, 0.75, 1.1], dress: 'saloon' }, spot: { at: [4.4, 3.6], turn: -90 } },
  furn_bld_899_1171_a_bar_stool: { spot: { at: [3.55, 3.0], turn: 90 } },
  furn_bld_899_1171_a_corner_booth: { spot: { at: [-5.2, 9.6], turn: 180 } },
  furn_reach_poker_table: { look: { arche: 'table', form: 'poker', dims: [2.3, 1.25, 0.78], dress: 'saloon' }, spot: { at: [-2.6, 7.0], turn: 0 } },
  furn_reach_chair_1: { spot: { at: [-2.6, 5.85], turn: 180 } },
  furn_reach_chair_2: { spot: { at: [-2.6, 8.15], turn: 0 } },
  furn_reach_chair_3: { spot: { at: [-4.05, 7.0], turn: 90 } },
  furn_reach_chair_4: { spot: { at: [-1.15, 7.0], turn: -90 } },
  furn_cardmach_saloon: { spot: { wall: 'left', along: 1.2 } },
  furn_reach_jobboard: { spot: { wall: 'back', along: 1.0 } },
  furn_coyote_piano: { spot: { wall: 'back', along: -4.2 } },
  furn_coyote_gallery_card_table: { spot: { at: [3.0, 4.0], turn: 0 } },
  furn_coyote_gallery_chair_1: { spot: { at: [3.0, 3.1], turn: 180 } },
  furn_coyote_gallery_chair_2: { spot: { at: [3.0, 4.9], turn: 0 } },
  furn_coyote_gallery_booth_1: { spot: { wall: 'back', along: 4.2 } },
  furn_coyote_gallery_booth_2: { spot: { wall: 'back', along: 2.0 } },
  furn_coyote_gallery_couch: { spot: { wall: 'right', along: 4.2 } },
  furn_coyote_l3e_bed: { spot: { wall: 'back', along: 0 } },
  furn_coyote_l3e_chair: { spot: { at: [1.2, 1.4], turn: 0 } },
  furn_coyote_l3e_cabinet: { spot: { wall: 'left', along: 7.0 } },
  furn_coyote_l3w_bed: { spot: { wall: 'back', along: 0 } },
  furn_coyote_l3w_chair: { spot: { at: [-1.2, 1.4], turn: 0 } },
  furn_coyote_l3w_crate: { spot: { at: [0, 7.6], turn: 0 } },
  furn_coyote_l4e_bed: { spot: { wall: 'back', along: 0 } },
  furn_coyote_l4e_desk: { spot: { wall: 'left', along: 7.0 } },
  furn_coyote_l4e_chair: { spot: { at: [-1.55, 7.0], turn: -90 } },
  furn_coyote_l4w_bed: { spot: { wall: 'back', along: 0 } },
  furn_coyote_l4w_cupboard: { spot: { wall: 'right', along: 5.0 } },
  furn_coyote_l4w_chair: { spot: { at: [1.0, 3.0], turn: 0 } },
};

// ── THE TEXT ────────────────────────────────────────────────────────────────────────────────────────
const TEXT = {
  [FACADE]: "Four storeys of weathered board on Main Street, the tallest thing in the Reach that isn't a mast. A covered gallery runs across the front over the porch, every window has a different curtain, and there's a dish or an aerial on every ledge. Up on the false front a coyote howls in amber neon, the brightest light for fifty miles. The batwing doors are always open.",
  [LOBBY]: "Sticky boards underfoot, a long bar down one wall, and light the colour of weak whiskey. Somewhere a speaker coughs out a song older than everyone in the room. A stair climbs the east wall to the Gallery, and behind the bar a trapdoor drops to the cellar. Nobody looks up when the door goes, but everybody clocks you.",
  [STASH]: "Down the trapdoor and past the kegs: crates that never had a manifest, stacked in the cool dark and smelling of yeast, gun oil and other people's secrets. What the Reach runs, it runs through rooms like this.",
  [GALLERY]: "The room over the saloon. Card tables, two booths against the back wall and a couch nobody admits to sleeping on. French doors open onto the gallery over Main Street, where you can watch the street without the street watching you. The noise from downstairs comes up through the boards.",
  [L3]: "A bare-board landing between two doors, one bulb, and the neon coming pink through the front window. The stairs go on up, and back down to the Gallery.",
  [L3E]: "Marla's room, over the bar. A shelf of half-empty bottles she's \"testing\", a dresser with a cracked mirror, and by the bed a spiral ledger listing, in tiny handwriting, exactly who in the Reach owes what to whom. The saloon comes up through the floor all night.",
  [L3W]: "Doc's room, and unnervingly neat: a bed made with hospital corners, one chair squared to the window, and three sealed decks of cards fanned on the trunk at the foot of the bed like a tidy little threat.",
  [L4]: "The top of the house. The boards creak, the air's warm, and the coyote's glow comes in amber through the front window and lies across the floor.",
  [L4E]: "Del's room up under the roof, and a cheerful disaster: cards on every surface, IOUs pinned to the wall like trophies, a bottle on its side, and a derringer-shaped lump under the pillow. The coyote's light gets in at night whatever you do with the curtain.",
  [L4W]: "The quietest room in the building, with no window on the side where the old sign's painted. A bed, a wardrobe, a card table with one chair, and a deck of cards laid out in a game of patience.",
};
const NAMES = {
  [GALLERY]: 'The Gallery', [L3]: 'The Upstairs Landing', [L3E]: "Marla's Room", [L3W]: "Doc's Room",
  [L4]: 'The Top Landing', [L4E]: "Del's Room", [L4W]: 'The Top West Room',
};

// ── THE ROOMS ON THE MAP ────────────────────────────────────────────────────────────────────────────
// Interior grid: north is -y, east is +x, up is +z (the Stash stood north of the bar at 0,-1,0).
const GRID = {
  [LOBBY]: [0, 0, 0], [STASH]: [0, 0, -1], [UTIL]: [0, -1, -1], [GALLERY]: [0, 0, 1],
  [L3]: [0, 0, 2], [L3E]: [1, 0, 2], [L3W]: [-1, 0, 2], [L4]: [0, 0, 3], [L4E]: [1, 0, 3], [L4W]: [-1, 0, 3],
};
const EXITS = {
  [LOBBY]: { south: FACADE, down: STASH, up: GALLERY },
  [STASH]: { up: LOBBY, north: UTIL },
  [UTIL]: { south: STASH },
  [GALLERY]: { down: LOBBY, up: L3 },
  [L3]: { down: GALLERY, up: L4, east: L3E, west: L3W },
  [L3E]: { west: L3 }, [L3W]: { east: L3 },
  [L4]: { down: L3, east: L4E, west: L4W },
  [L4E]: { west: L4 }, [L4W]: { east: L4 },
};

const stash = read(Z + STASH + '.json');
for (const id of Object.keys(GRID)) {
  const f = Z + id + '.json';
  const old = fs.existsSync(f) ? read(f) : null;
  const base = old || { ...stash, id, ambient_events: undefined, ambient_theme: undefined, marker: undefined };
  const z = { ...base, id, map_id: MAP, parent_zone: FACADE, grid_x: GRID[id][0], grid_y: GRID[id][1], grid_z: GRID[id][2], exits: EXITS[id] };
  if (NAMES[id]) z.name = NAMES[id];
  if (TEXT[id]) z.description = TEXT[id];
  const flags = { ...(base.flags || {}) };
  if (SPECS[id]) flags.room = SPECS[id];
  if (id !== UTIL) flags.floor = 'boards';
  z.flags = flags;
  for (const k of Object.keys(z)) if (z[k] === undefined) delete z[k];
  put(f, z);
}
{ const f = Z + FACADE + '.json', z = read(f); put(f, { ...z, description: TEXT[FACADE] }); }

// ── THE CONNECTIONS ─────────────────────────────────────────────────────────────────────────────────
// One row per edge; the reverse is implied. The bar's old `down` (to the utility room) becomes the
// trapdoor to the Stash, and the utility room hangs off the Stash.
const conns = [
  ['conn_bld_899_1171_lobby_down_syfg', LOBBY, STASH, 'down'],
  ['conn_bld_899_1171_store_north_cy01', STASH, UTIL, 'north'],
  ['conn_bld_899_1171_lobby_up_cy02', LOBBY, GALLERY, 'up'],
  ['conn_bld_899_1171_gallery_up_cy03', GALLERY, L3, 'up'],
  ['conn_bld_899_1171_f3_up_cy04', L3, L4, 'up'],
  ['conn_bld_899_1171_f3_east_cy05', L3, L3E, 'east'],
  ['conn_bld_899_1171_f3_west_cy06', L3, L3W, 'west'],
  ['conn_bld_899_1171_f4_east_cy07', L4, L4E, 'east'],
  ['conn_bld_899_1171_f4_west_cy08', L4, L4W, 'west'],
];
for (const [id, a, b, dir] of conns) put(CN + id + '.json', { a, b, blocked: false, dir, id, lockable: false, one_way: false });

// ── POWER, LIGHT AND FURNITURE ──────────────────────────────────────────────────────────────────────
const POWER_NAMES = { [GALLERY]: 'Gallery', [L3]: 'Upstairs Landing', [L3E]: 'East Room', [L3W]: 'West Room', [L4]: 'Top Landing', [L4E]: 'Top East Room', [L4W]: 'Top West Room' };
for (const [id, name] of Object.entries(POWER_NAMES)) {
  put(PW + id + '.json', { capacity_kw: 5000, flags: {}, generator_id: GEN, id, max_capacity_kw: 1000, name, source_type: 'junction_box' });
  put(FU + 'furn_light_' + id + '.json', {
    description: id === L3 || id === L4 ? 'A bare bulb on a twist of flex, swinging a little when the door downstairs goes.' : 'A fringed shade on a drop cord, wired down the back stair to the panel in the cellar.',
    flags: {}, hp: null, hp_max: null, id: 'furn_light_' + id, light_type: 'overhead', lumen_output: id === GALLERY ? 1600 : 1000,
    name: 'Overhead Light', object_type: 'light', power_draw_kw: 0.03, price: 0, zone_id: id,
  });
}
const piece = (id, zone, name, description, arche, form, extra = {}) => put(FU + id + '.json', {
  description, flags: { look: { arche, form }, ...extra }, hp: null, hp_max: null, id, light_type: null, lumen_output: null,
  name, object_type: 'furniture', power_draw_kw: null, price: 0, zone_id: zone,
});
const lie = { interactions: ['lie'] }, sit = { interactions: ['sit'] };
piece('furn_coyote_piano', LOBBY, 'a player piano', "An upright with its front off and a punched roll in it. It plays the same four songs, and the regulars sing the wrong words to all of them.", 'prop', 'piano');
piece('furn_coyote_gallery_booth_1', GALLERY, 'a booth', 'High-backed and patched with tape, against the back wall, the kind of seat you can talk in.', 'seat', 'booth', sit);
piece('furn_coyote_gallery_booth_2', GALLERY, 'a booth', 'The other booth, with a better view of the stairs.', 'seat', 'booth', sit);
piece('furn_coyote_gallery_card_table', GALLERY, 'a card table', 'Green baize worn through to the board at the corners, cigarette burns along every edge.', 'table', 'dining');
piece('furn_coyote_gallery_chair_1', GALLERY, 'a chair', 'A bentwood chair, one leg wired back on.', 'seat', 'chair', sit);
piece('furn_coyote_gallery_chair_2', GALLERY, 'a chair', 'A bentwood chair.', 'seat', 'chair', sit);
piece('furn_coyote_gallery_couch', GALLERY, 'a couch', "A long couch gone flat in the middle. Nobody admits to sleeping on it.", 'sofa', 'sofa', lie);
for (const [zone, k, bed, other] of [
  [L3E, 'l3e', 'An iron bed with a quilt that came from somebody\'s grandmother.', ['a dresser', 'A dresser with a cracked mirror and a hairbrush on it.', 'store', 'cabinet']],
  [L3W, 'l3w', 'A bed made tight enough to bounce a coin.', ['a trunk', 'A steamer trunk with a padlock through the hasp.', 'store', 'crate']],
  [L4E, 'l4e', 'A bed under the slope of the roof, too short for anyone tall.', ['a desk', 'A school desk with its lid carved full of initials, none of them the tenant\'s.', 'surface', 'desk']],
  [L4W, 'l4w', 'A narrow bed against the blind wall.', ['a wardrobe', 'A plywood wardrobe with a door that won\'t stay shut.', 'store', 'cupboard']],
]) {
  piece(`furn_coyote_${k}_bed`, zone, 'a bed', bed, 'bed', 'bed', lie);
  piece(`furn_coyote_${k}_chair`, zone, 'a chair', 'A kitchen chair with a cushion tied to it.', 'seat', 'chair', sit);
  piece(`furn_coyote_${k}_${other[3]}`, zone, other[0], other[1], other[2], other[3]);
}

// the back bar behind the long bar, and the cellar's stock
put(FU + 'furn_coyote_back_bar.json', {
  description: 'Three arched mirror bays gone cloudy at the edges, lit shelves of bottles with the labels turned out, and a till with a bullet hole in the drawer. A dusty coyote skull sits on top, wearing somebody\'s hat.',
  flags: { aliases: 'back bar,mirror,bottles,shelves,till,register,skull', look: { arche: 'surface', form: 'barwall', dims: [3.6, 0.5, 2.6], dress: 'saloon', trade: 'Saloon' }, spot: { wall: 'right', along: 3.6 } },
  hp: null, hp_max: null, id: 'furn_coyote_back_bar', light_type: null, lumen_output: null, name: 'back bar', object_type: 'fixture', power_draw_kw: null, price: 0, zone_id: LOBBY,
});
for (const [k, v] of [[1, 2.0], [2, 4.4], [3, 5.2]]) piece('furn_coyote_stool_' + k, LOBBY, 'a bar stool', ['A stool with a split seat, taped.', 'A stool one leg shorter than the others.', 'A stool with a coyote burnt into the seat.'][k - 1], 'seat', 'stool', { interactions: ['sit'], spot: { at: [3.55, v], turn: 90 } });
piece('furn_coyote_stash_crates', STASH, 'stacked crates', 'Crates stencilled with names of companies that went under before you were born, none of them holding what they say.', 'prop', 'crate', { spot: { wall: 'back', along: -1.2 } });
piece('furn_coyote_stash_kegs', STASH, 'kegs', 'Steel kegs in a timber crib, the lines to the taps upstairs going up through a hole in the floor.', 'prop', 'crate', { spot: { wall: 'left', along: 3.0 } });

// ── WHO LIVES UPSTAIRS ──────────────────────────────────────────────────────────────────────────────
// The people who work the bar live over it (reach-rebuild.md, "Who works where"): Marla Kest, Doc Teller and
// Del Roan move out of their Layover cabins into the rooms above, each taking the character of the cabin they
// left. The top west room waits for the day bartender. Windy Marsh, who sleeps on the saloon floor, moves
// in the motel's own phase. Their work zones and hours don't change here.
const HOMES = { npc_1784515589442: L3E, npc_reach_dealer: L3W, npc_reach_gambler: L4E };
const CABINS = { npc_1784515589442: ['zone_bld_900_1171_cabin_marla', 'Cabin 2'], npc_reach_dealer: ['zone_bld_900_1171_cabin_doc', 'Cabin 4'], npc_reach_gambler: ['zone_bld_900_1171_cabin_del', 'Cabin 5'] };
for (const [npc, room] of Object.entries(HOMES)) {
  const f = 'content/npcs/' + npc + '.json', n = read(f);
  if (n.home_zone !== room && n.home_zone !== CABINS[npc][0]) throw new Error(`${npc} lives in ${n.home_zone}, not the cabin this expects; look before moving them`);
  put(f, { ...n, home_zone: room });
  put('content/npc_residences/' + room + '.json', { note: 'lives over the bar (coyotes-rest-rooms.mjs)', npc_id: npc, zone_id: room });
  const z = read(Z + room + '.json');
  put(Z + room + '.json', { ...z, flags: { ...z.flags, is_dwelling: true } });
  // the cabin they left: a number and an empty room, until the motel is rebuilt (reach-rebuild.md, the Layover)
  const [cab, num] = CABINS[npc], c = read(Z + cab + '.json');
  { const pf = PW + cab + '.json'; if (fs.existsSync(pf)) { const pz = read(pf); put(pf, { ...pz, name: num }); } }
  put(Z + cab + '.json', { ...c, name: num, description: 'A motel cabin: a sagging bed, a lamp on a chair, a fan that rattles, and a window onto the walk. Nobody lives in it right now, and it shows.' });
}

// Every piece's place, merged into its row (other rows' keys kept as they are).
for (const [id, add] of Object.entries(PLACE)) {
  const f = FU + id + '.json';
  if (!fs.existsSync(f) && !staged.has(f)) throw new Error(`no furniture row ${id}`);
  const row = read(f);
  put(f, { ...row, flags: { ...(row.flags || {}), ...add, ...(add.look ? { look: { ...(row.flags?.look || {}), ...add.look } } : {}) } });
}

const writes = [];
for (const [file, obj] of staged) {
  const text = canonicalJson(obj);
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) continue;
  writes.push(file);
  if (!CHECK) fs.writeFileSync(file, text, 'utf8');
}
console.log(`coyotes-rest-rooms: ${writes.length} file(s) ${CHECK ? 'would change' : 'written'}`);
for (const f of writes) console.log('  ' + f);
