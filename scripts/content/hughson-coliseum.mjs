/**
 * THE CHARLES B. HUGHSON COLISEUM: Deadball's ballpark, on the map at last.
 *
 *   node scripts/content/hughson-coliseum.mjs [--dry-run]
 *
 * Phase 6 of docs/proposals/deadball-glass2.md, as built in docs/proposals/hughson-coliseum.md.
 * The park the broadcast draws in 3-D stands on the nine tiles x 895-897, y 911-913 in Halcyon
 * Fields, the Glasshouse's estate (sports_pools.venue.site on the Deadball row says the same
 * block). It's named for Sir Charles B. Hughson, who owned the ground and wouldn't sell it, so
 * Halcyon built the estate round him. The statue, the plaque, the vendor and Chip Vega's booth
 * lines (data/scripts/baseball.bsm) tell it; change one and check the others.
 *
 * ⚠ WHAT WAS THERE IS SET ASIDE, NOT DELETED. Six buildings (8 Halcyon Boulevard, the Halcyon
 * Institute, the Halcyon Land Office, 3, 5 and 7 Sorrel Way) and the three tiles of Vetch Green
 * move onto a holding map, `map_set_aside`, on a grid of their own in the same layout. Each keeps
 * its id, name, prose, flags, interiors, furniture and NPCs; only its map, its grid, its links to
 * the world streets and its `world_exit_zone` change, and `flags.set_aside_from` says where it
 * stood. Their four keepers carry `flags.set_aside`, which the game loop reads to leave them in
 * their rooms with their routines paused. Deleting a content file deletes its row on the next
 * deploy and orphans any player row pointing at it; scripts/oneshots/hughson-coliseum-players.mjs
 * moves those first. A building comes back by moving its tile onto a new plot and reconnecting
 * its door, the way docs/proposals/stored-buildings.md describes.
 *
 * ⚠ THE PARK'S TILES TAKE NEW IDS, zone_ballpark_<x>_<y>, so no set-aside building's identity is
 * overwritten. Two are doors: the main gate behind home plate (897,913, south onto Sorrel Way) and
 * the bleacher gate (895,911, north onto Halcyon Boulevard). The other seven are sealed mass the
 * way the Slush Fund's are: a name, a building type for GLASS, `entrance` for the model's facing,
 * `floors` for its height, empty exits and no `is_building`.
 *
 * ⚠ THE TYPES ARE SLICES, AND ONE ARM DRAWS ALL NINE (glass/models/coliseum.js, the `ballpark`
 * rows in model-registry.js). Every row says which column and row of the block it is.
 *
 * Run `node scripts/content/mint-connections.mjs --write` afterwards, as for the Slush Fund.
 * Idempotent: every id derives from the slug or the tile.
 */
import fs from 'fs';
import path from 'path';
import { authorBuilding, loadContentStore } from './halcyon/lib.mjs';

const DRY = process.argv.includes('--dry-run');
const store = loadContentStore();

const NAME = 'Charles B. Hughson Coliseum';
const ROOMS = 'The Coliseum';        // room names stay under 30 characters, so docs:prose doesn't count their dash
const DISTRICT = 'halcyon_fields';
const REGION = 'region_coldwater';
const HOLD = 'map_set_aside';
const BLOCK = { x0: 895, x1: 897, y0: 911, y1: 913 };
const oldId = (x, y) => `zone_district_${x}_${y}`;
const parkId = (x, y) => `zone_ballpark_${x}_${y}`;
const tiles = [];
for (let y = BLOCK.y0; y <= BLOCK.y1; y++) for (let x = BLOCK.x0; x <= BLOCK.x1; x++) tiles.push([x, y]);

// The venue the broadcast draws has to be this block, or the park on TV and the park on the map
// are two different places.
{
  const bc = store.get('media_broadcasts', 'bc_1783289744953');
  const b = bc?.sports_pools?.venue?.site?.block;
  if (!b || b.x0 !== BLOCK.x0 || b.x1 !== BLOCK.x1 || b.y0 !== BLOCK.y0 || b.y1 !== BLOCK.y1) {
    throw new Error(`the Deadball venue's block is ${JSON.stringify(b)}, not ${JSON.stringify(BLOCK)}`);
  }
}

// ── 1. SET ASIDE WHAT WAS THERE ─────────────────────────────────────────────────────────────
// The holding map holds the block in its own layout, one tile in from its origin, so the green
// still joins up and every building still faces the way it did. Nothing on it connects to the
// world: a facade's way out is the green in its own column.
const SET_ASIDE_NPCS = ['npc_going_crake', 'npc_course_quainton', 'npc_plot_follet', 'npc_hf_ferreira'];
const STREET_CONNS = [
  'conn_hf_district_895_911_north', 'conn_hf_district_896_911_north', 'conn_hf_district_897_911_north',
  'conn_hf_district_895_913_south', 'conn_hf_district_896_913_south', 'conn_hf_district_897_913_south',
];
const already = store.get('zones', oldId(896, 912))?.map_id === HOLD;
if (!already) {
  for (const [x, y] of tiles) {
    const z = store.get('zones', oldId(x, y));
    if (!z) throw new Error(`${oldId(x, y)} does not exist`);
    if (z.map_id !== 'map_world') throw new Error(`${oldId(x, y)} is on ${z.map_id}; the site has moved since this file was written`);
  }
}
store.patch('maps', HOLD, { id: HOLD, name: 'Set Aside', parent_zone_id: null, entry_zone_id: oldId(896, 912) });
for (const [x, y] of tiles) {
  const id = oldId(x, y), z = store.get('zones', id);
  const flags = { ...(z.flags || {}), set_aside: true, set_aside_from: `${x},${y}` };
  const exits = {};
  for (const [dir, to] of Object.entries(z.exits || {})) {
    const t = store.get('zones', to);
    // Keep the links inside the block (the green's own walks) and into a building's interior.
    if (t && (t.map_id === HOLD || (t.flags?.set_aside) || tiles.some(([tx, ty]) => oldId(tx, ty) === to) || (t.map_id !== 'map_world' && t.parent_zone === id))) exits[dir] = to;
  }
  if (flags.facade) flags.world_exit_zone = oldId(x, 912);   // the green in its own column
  store.put('zones', { ...z, map_id: HOLD, grid_x: x - BLOCK.x0 + 1, grid_y: y - BLOCK.y0 + 1, grid_z: 0, exits, flags });
}
for (const id of SET_ASIDE_NPCS) {
  const n = store.get('npcs', id);
  if (!n) throw new Error(`${id} does not exist`);
  store.patch('npcs', id, { flags: { ...(n.flags || {}), set_aside: true } });
}

// ── 2. THE GATES AND THE ROOMS ───────────────────────────────────────────────────────────────
// The main gate's street (897,914) still points north at the old 7 Sorrel Way; authorBuilding
// repoints it at the new door. The bleacher gate's street likewise.
const main = await authorBuilding(store, {
  slug: 'hughson', name: NAME, roomName: ROOMS, type: 'ballpark', facadeId: parkId(897, 913),
  x: 897, y: 913, entrance: 'south', floors: 3, marker: 'HC', district: DISTRICT,
  utilityAnchor: 'concourse',

  facade: {
    bgColor: '#2a1d18', color: '#d8c9a8',
    description: 'The main gate of the Charles B. Hughson Coliseum: a round brick rotunda on Sorrel Way, arched along the top, with the name in bronze letters over three iron gates. The light towers stand over the stands behind it.',
  },

  rooms: [
    { key: 'rotunda', name: 'Rotunda', floor: 'tile',
      description: 'A round brick hall inside the main gate, floored in terrazzo worn grey in front of the turnstiles. A bronze of Sir Charles stands in the middle on a granite plinth, with a plaque on the wall behind him. The ticket office is east and the concourse north.',
      window: {
        name: 'the gates',
        description: 'Three iron gates in brick arches, folded back against the wall on game nights. Sorrel Way is outside, and the corner of Kettle Lane.',
        light: 0.5, visibility: 0.6,
      } },
    { key: 'tickets', name: 'Ticket Office', floor: 'linoleum', from: 'rotunda', dir: 'east',
      description: 'A narrow office behind three barred windows onto the rotunda. Rolls of tickets hang on a rack, a cash box is chained to the counter, and a seating plan is pinned to the wall with section nine crossed out in red pen.',
      window: null },
    // ⚠ THE CONCOURSE IS NOT THE SHOP. A room a vendor works in is a shop, and a shop locks outside
    // his hours (plugins/commerce/shopdoor.js), so with Ray at a counter here the stands and the
    // bleachers were shut six days a week. The counter has a room of its own off to the side.
    { key: 'concourse', name: 'Concourse', floor: 'concrete', from: 'rotunda', dir: 'north',
      description: 'A long concourse under the stands, its concrete floor sticky in patches and lit by caged bulbs. The concession stand is through an opening to the west, under a hand-painted menu board. Stairs climb to the club level, and the ramps lead north to the stands.',
      window: null },
    { key: 'stand', name: 'Concessions', floor: 'tile', from: 'concourse', dir: 'west',
      description: 'A tiled room off the concourse, under the third-base stands. A steel counter runs the width of it with a hot plate, a beer tap and a stack of paper boats, under a hand-painted menu board. A roll of waivers hangs on a nail by the till.',
      window: null },
    { key: 'stands', name: 'The Stands', floor: 'concrete', from: 'concourse', dir: 'north',
      description: 'Green wooden seats in rows behind home plate, bolted to concrete steps. The diamond lies below, the outfield wall beyond it, six light towers over all of it. One seat in the front row has a brass plate on it and nobody in it. Section nine is west, the bleachers north.',
      window: {
        name: 'the field',
        description: 'The diamond, the infield dirt raked in arcs, and the outfield running out to a padded wall with numbers painted on it. The scoreboard stands on legs past centre field.',
        light: 0.9, visibility: 1,
      } },
    { key: 'nine', name: 'Section Nine', floor: 'concrete', from: 'stands', dir: 'west',
      description: 'The seats down the third-base line end at a crater. The concrete steps go down into it and stop at the edge. A rope is tied across the top row, and the seats either side of the hole are still numbered.',
      window: null },
    { key: 'club', name: 'Club Level', floor: 'carpet', from: 'concourse', dir: 'up',
      description: 'A lounge above the concourse with a long bar down one side and windows over the field down the other. The carpet is patterned with baseballs and worn through to the backing in a path from the stairs to the bar.',
      window: {
        name: 'the club windows',
        description: 'Tall windows over the first-base line, filmed with old smoke. The field is green below them and the towers are level with the glass.',
        light: 0.6, visibility: 0.8,
      } },
    { key: 'pressbox', name: 'Press Box', floor: 'linoleum', from: 'club', dir: 'up',
      description: 'A narrow box under the roof of the stands, glazed along the front. Two microphones stand on a desk with a scorebook open between them, and a cushion is tied to one of the chairs. The name stencilled on the back of that chair is VEGA.',
      window: {
        name: 'the press box glass',
        description: 'A long sloped window over home plate, a crack across one pane mended with tape. From here the whole field fits in the glass.',
        light: 0.6, visibility: 1,
      } },
  ],

  utility: {
    name: 'Plant Room', floor: 'concrete',
    description: 'Under the concourse: the switchgear for the light towers, six breakers in a row with a tower number painted over each. Two of them are taped in the off position. The building\'s junction box is on the wall by the door.',
  },

  lights: {
    rotunda: { name: 'the rotunda lamps', description: 'Globe lamps on iron brackets round the wall of the rotunda, one with its glass missing.', lumens: 2400 },
    stand: { name: 'the counter lights', description: 'Two fluorescent tubes over the counter, one of them slow to come on.', lumens: 1800 },
    tickets: { name: 'the office strip light', description: 'A strip light over the ticket counter with a dead fly in the diffuser.', lumens: 1200 },
    stands: { name: 'the light towers', description: 'Six steel towers round the park, each with a bank of floodlamps aimed at the field. Not every lamp in every bank comes on.', lumens: 9000 },
    nine: { name: 'the aisle lamp', description: 'A caged lamp on a pole at the end of the aisle, leaning toward the crater.', lumens: 800, type: 'lamp' },
    club: { name: 'the bar lights', description: 'Brass pendant lamps over the bar, and a lit mirror behind it.', lumens: 2000 },
    pressbox: { name: 'the desk lamp', description: 'A gooseneck lamp clamped to the desk and bent down over the scorebook.', lumens: 600, type: 'lamp' },
  },

  props: [
    { key: 'statue', room: 'rotunda', name: 'the statue of Sir Charles', objectType: 'decoration',
      description: 'A bronze of Sir Charles B. Hughson on a granite plinth, hat in one hand and the other raised toward the stands. The toes of his shoes are rubbed bright gold by people touching them for luck on the way in.',
      flags: { aliases: ['statue', 'bronze', 'sir charles', 'charles', 'hughson', 'plinth', 'shoes'],
        examine_detail: 'Cut into the front of the plinth: Sir Charles B. Hughson. He would not sell.' } },
    { key: 'plaque', room: 'rotunda', name: 'the dedication plaque', objectType: 'decoration',
      description: 'A bronze plaque set into the brick: The Charles B. Hughson Coliseum. For Sir Charles, who kept the gates open. Under it, on a newer steel plate: Halcyon Fields Estates gratefully acknowledges the existing structure.',
      flags: { aliases: ['plaque', 'dedication', 'dedication plaque', 'plate', 'steel plate'] } },
    { key: 'turnstiles', room: 'rotunda', name: 'the turnstiles', objectType: 'decoration',
      description: 'A row of iron turnstiles with brass counters on top, the arms worn smooth. The counters read in the millions and none of them agree.',
      flags: { aliases: ['turnstile', 'turnstiles', 'counter', 'counters', 'arms'] } },
    { key: 'plan', room: 'tickets', name: 'the seating plan', objectType: 'decoration',
      description: 'A printed plan of the park pinned to the wall, every section numbered. Section nine is crossed out in red, and somebody has drawn a small circle beside it.',
      flags: { aliases: ['plan', 'seating plan', 'map', 'section nine'] } },
    { key: 'counter', room: 'stand', name: 'the concession stand', objectType: 'furniture',
      description: 'A steel counter with a hot plate, a beer tap and a stack of paper boats. The menu board over it is hand-painted: Widowmaker, beer, coffee. Under the Widowmaker, smaller: waiver included.',
      flags: { aliases: ['stand', 'concession', 'concession stand', 'counter', 'menu', 'menu board', 'board', 'tap', 'hot plate'] } },
    { key: 'till', room: 'stand', name: 'the cash drawer', objectType: 'fixture',
      description: 'A steel cash drawer under the concession counter, chained to the frame, with a key lock and a dent in the front.',
      flags: { aliases: ['cash drawer', 'drawer', 'till', 'cash'], vendor_safe: true, vendor_npc_id: 'npc_hughson_ray', hack_difficulty: 3 } },
    { key: 'scoreboard', room: 'stands', name: 'the video board', objectType: 'tv', powerKw: 0.4,
      description: 'A screen in a steel frame hung under the press box, angled down at the seats. It carries KSAB\'s picture on channel 7, whatever is on, so a game here can be watched twice.',
      flags: { aliases: 'video board,board,screen,tv,television',
        broadcast_device_type: 'tv', broadcast_receiver: true, channel_default: 7, interactions: ['watch'],
        tuned_channel: 7, tv: true, tv_dial_freq: 7 } },
    { key: 'seats', room: 'stands', name: 'the seats', objectType: 'furniture',
      description: 'Green wooden seats with iron arms, bolted in rows to the concrete. The paint has worn off the arms where hands go.',
      flags: { aliases: ['seat', 'seats', 'row', 'rows', 'chair'], interactions: ['sit'] } },
    { key: 'charlesseat', room: 'stands', name: 'Sir Charles\'s seat', objectType: 'decoration',
      description: 'A front-row seat behind home plate, folded up and kept clean. A brass plate on the back reads SIR CHARLES. The seats either side of it are scuffed. This one is not.',
      flags: { aliases: ['sir charles\'s seat', 'charles\'s seat', 'brass plate', 'front row', 'empty seat'] } },
    { key: 'organ', room: 'stands', name: 'the ballpark organ', objectType: 'furniture',
      description: 'An electric organ in a booth at the top of the aisle, its speakers wired to the light towers. A card taped above the keys has one song title on it.',
      flags: { aliases: 'organ,ballpark organ,keys,booth', instrument: 'organ', interactions: ['examine', 'play'] } },
    { key: 'crater', room: 'nine', name: 'the crater', objectType: 'decoration',
      description: 'A round hole in the stands three rows across, its edges ragged concrete and bent rebar. Rainwater stands in the bottom of it with a seat cushion floating in it.',
      flags: { aliases: ['crater', 'hole', 'rope', 'rebar', 'cushion'] } },
    { key: 'bar', room: 'club', name: 'the club bar', objectType: 'furniture',
      description: 'A long mahogany bar with a brass rail along its foot and stools along it. The mirror behind it is lit, and the bottles in front of the mirror are mostly empty.',
      flags: { aliases: ['bar', 'club bar', 'rail', 'stool', 'stools', 'mirror', 'bottles'], interactions: ['sit'] } },
    { key: 'desk', room: 'pressbox', name: 'the broadcast desk', objectType: 'furniture',
      description: 'A desk at the window with two microphones, a monitor and the night\'s scorebook, kept in pencil. The chair with the cushion on it has VEGA stencilled on the back.',
      flags: { aliases: ['desk', 'broadcast desk', 'microphones', 'microphone', 'scorebook', 'monitor', 'chair'], interactions: ['sit'] } },
  ],

  items: [
    { id: 'item_widowmaker', name: 'Widowmaker', type: 'consumable', value: 7, weight: 260,
      description: null,
      flags: {},
      tags: { consumable: true, restore_hunger: 26, stackable: true,
        description: 'A foot-long frank in a split bun under chilli, raw onion and a yellow sauce, in a paper boat with a waiver printed on the side. Sold at the Hughson Coliseum.' } },
  ],

  npc: {
    id: 'npc_hughson_ray', name: 'Ray Dombrowski', sex: 'male', hp: 42,
    homeRoom: 'stand', workRoom: 'stand', shopName: 'Concessions',
    description: 'A heavy man in his fifties in a white paper hat and an apron with chilli down the front, his forearms red from the hot plate. A pencil rides behind one ear. He wipes the counter in slow circles and looks up every time the crowd makes a noise.',
    clothing: [
      'an apron with chilli down the front',
      'a white paper hat',
      'a short-sleeved shirt with the Coliseum\'s crest on the pocket',
      'work trousers',
      'boxer shorts',
    ],
    // Open for the game: Deadball is on KSAB at six on Monday, Wednesday and Friday.
    schedule: {
      mon: [{ from: 16, to: 22 }], tue: [], wed: [{ from: 16, to: 22 }], thu: [],
      fri: [{ from: 16, to: 22 }], sat: [], sun: [],
    },
    inventory: [
      { item_id: 'item_widowmaker', price: 7 },
      { item_id: 'item_drug_beer', price: 5 },
      { item_id: 'item_drug_coffee', price: 4 },
    ],
    chitchat: [
      'Dombrowski turns three franks on the hot plate with his fingers.',
      'He tops up the chilli from a steel pot and stirs it with the ladle he serves it with.',
      'He pulls a beer, holds it to the light, and pours the top inch away.',
      'Somewhere above, the crowd groans. He nods as if he expected it.',
      'He straightens the stack of waivers on the counter.',
    ],
    dialogue: {
      root: {
        text: '"Widowmaker, beer, coffee." He points the ladle at the board. "What\'ll it be?"',
        text_by_relation: {
          first: 'The man behind the counter wipes his hands on his apron.\n\n"Ray Dombrowski. I do the stand." He nods up at the board. "Widowmaker comes with a waiver. Everybody signs it. Nobody reads it."',
          known: '"You came back." He already has a boat in his hand.',
          familiar: '"The usual, with the onions." It is already on the counter.',
        },
        options: [
          { label: 'What do you sell?', next: '__shop__' },
          { label: 'Who was Sir Charles?', next: 'charles' },
          { label: 'What happened to section nine?', next: 'nine' },
          { label: 'When do they play?', next: 'games' },
          { label: 'Nothing, thanks.', next: 'bye', enabled: true, actions: [], conditions: [] },
        ],
      },
      charles: {
        text: '"He owned the ground. Halcyon wanted it for offices, three times, and three times he sent the cheque back with two tickets in the envelope. So they built the whole estate round him."\n\nHe looks past you at the rotunda. "He used to stand at the gate on opening day and shake every hand that came through. Mine too. I was nine. Nobody knows who started calling him Sir. He never asked anybody to stop."',
        options: [{ label: 'Back up.', next: 'root' }],
      },
      nine: {
        text: '"Something came down in it one night. Nobody was sitting there, which is the only good thing about a bad season." He shrugs. "They roped it off and kept the numbers on the seats. Chip on the radio says his ex-wife sat there. Chip says a lot of things."',
        options: [{ label: 'Back up.', next: 'root' }],
      },
      games: {
        text: '"Monday, Wednesday, Friday. Six o\'clock, on KSAB, and here." He taps the counter. "When the towers come on, I\'m open. When they go off, I\'m not."',
        options: [{ label: 'Back up.', next: 'root' }],
      },
      bye: {
        text: '"Enjoy the game," he says. "Sign the waiver."',
        options: [],
      },
    },
  },
});

// The anchor's light came from authorUtilityRoom with a stock name.
store.patch('furniture', 'furn_light_zone_hughson_concourse', {
  name: 'the concourse lights',
  description: 'Caged bulbs along the concourse ceiling, every fourth one out, and a red EXIT sign at each ramp.',
});

const bleachers = await authorBuilding(store, {
  slug: 'hughsonbl', name: NAME, roomName: ROOMS, type: 'ballpark_bleachers', facadeId: parkId(895, 911),
  x: 895, y: 911, entrance: 'north', floors: 2, marker: 'BG', district: DISTRICT,

  facade: {
    bgColor: '#2a1d18', color: '#d8c9a8',
    description: 'The bleacher gate of the Hughson Coliseum, two iron gates in the outfield wall on Halcyon Boulevard. The brick is lower here, and the backs of the bleachers show over it. A painted board beside the gates says BLEACHERS.',
  },

  rooms: [
    { key: 'bleachers', name: 'Bleachers', floor: 'boards',
      description: 'Plank benches climb in tiers behind the outfield wall, open to the sky and splintered at the edges. The scoreboard stands on steel legs behind the top row. The bleacher gate is north, and an aisle runs south round the outfield to the stands.',
      window: {
        name: 'the outfield',
        description: 'The outfield grass and the padded wall below, a distance painted on it in white. Somebody has chalked a lower number underneath.',
        light: 0.9, visibility: 1,
      } },
  ],

  utility: {
    name: 'Undercroft', floor: 'dirt',
    description: 'The space under the bleacher planks: dust, dropped cups, coins in the gaps, and the scoreboard\'s cables running up a steel leg. The junction box is bolted to the leg.',
  },

  props: [
    { key: 'benches', room: 'bleachers', name: 'the bleacher benches', objectType: 'furniture',
      description: 'Long plank benches on steel frames, numbered in paint along their fronts. Initials are cut into most of the planks, some of them inside hearts.',
      flags: { aliases: ['bench', 'benches', 'bleacher benches', 'plank', 'planks', 'initials'], interactions: ['sit', 'lie'] } },
    { key: 'scoreboard', room: 'bleachers', name: 'the scoreboard', objectType: 'decoration',
      description: 'A steel scoreboard on four legs behind the top row, nine innings across and a lamp for every ball, strike and out. The clock in its middle has stopped at a time that is not on the dial.',
      flags: { aliases: ['scoreboard', 'clock', 'lamps', 'legs'] } },
  ],
});

store.patch('furniture', 'furn_light_zone_hughsonbl_bleachers', {
  name: 'the bleacher floods',
  description: 'The near light tower\'s lower bank, angled back over the bleachers so the cheap seats can see their feet.',
});

// The aisle round the outfield joins the bleachers to the stands. The two halves are two interior
// maps (one per gate), so this link is a connection file of its own.
{
  const a = 'zone_hughsonbl_bleachers', b = 'zone_hughson_stands', id = 'conn_hf_hughsonbl_bleachers_south';
  store.patch('connections', id, { a, b, dir: 'south', id, blocked: false, lockable: false, one_way: false });
  store.patch('zones', a, { exits: { ...store.get('zones', a).exits, south: b } });
  store.patch('zones', b, { exits: { ...store.get('zones', b).exits, north: a } });
}

// ── 3. THE SEVEN SEALED TILES ────────────────────────────────────────────────────────────────
// [x, y, building_type, floors, description]. Every one faces south (the bleacher gate alone faces
// north) and coliseum.js draws them from constants so the nine meet.
const SEALED = [
  [896, 911, 'ballpark_n', 1,
    'The outfield wall of the Hughson Coliseum along Halcyon Boulevard: plain brick, with the backs of the bleachers above it and the scoreboard on its legs.'],
  [897, 911, 'ballpark_ne', 2,
    'The right-field corner of the Hughson Coliseum, where the brick drops to bleacher height and a light tower stands over the corner.'],
  [895, 912, 'ballpark_w', 1,
    'The left-field side of the Hughson Coliseum, brick backing onto the Vetch Mews plots, with a light tower over it.'],
  [896, 912, 'ballpark_c', 1,
    'The field of the Hughson Coliseum: grass, a dirt infield, and the stands round it.'],
  [897, 912, 'ballpark_e', 3,
    'The first-base grandstand of the Hughson Coliseum, its brick flank to Kettle Lane, with louvres and a loading door set in the wall.'],
  [895, 913, 'ballpark_sw', 2,
    'The third-base end of the Hughson Coliseum\'s grandstand, where the brick steps down toward the left-field corner under a light tower.'],
  [896, 913, 'ballpark_s', 3,
    'The Hughson Coliseum\'s grandstand along Sorrel Way: brick piers and arched openings with the concourse lit behind them, and the upper deck\'s steel above.'],
];
for (const [x, y, type, floors, description] of SEALED) {
  const id = parkId(x, y);
  const prev = store.get('zones', id) || {};
  store.put('zones', {
    ...prev, id, name: NAME, description,
    map_id: 'map_world', grid_x: x, grid_y: y, grid_z: 0, parent_zone: null,
    exits: {}, ambient_theme: 'urban', ambient_events: prev.ambient_events || [],
    color: '#d8c9a8', bg_color: '#2a1d18',
    flags: { district: DISTRICT, region_id: REGION, building_name: NAME, building_type: type, floors, entrance: 'south', venue_lights: true },
  });
}
// The two doors carry the same flag: game nights light the towers on every tile of the park.
for (const id of [parkId(897, 913), parkId(895, 911)]) {
  const z = store.get('zones', id);
  store.patch('zones', id, { grid_x: Number(id.split('_')[2]), grid_y: Number(id.split('_')[3]), grid_z: 0, flags: { ...z.flags, venue_lights: true } });
}
// Fill any column a fresh row needs from a neighbour's, so the import's NOT NULLs are met.
{
  const like = store.get('zones', 'zone_district_896_910');
  for (const [x, y] of tiles) {
    const z = store.get('zones', parkId(x, y));
    const fill = {};
    for (const k of Object.keys(like)) if (!(k in z)) fill[k] = k === 'flags' || k === 'exits' ? {} : (Array.isArray(like[k]) ? [] : null);
    if (Object.keys(fill).length) store.patch('zones', parkId(x, y), fill);
  }
}

// Every world tile that pointed into the old block stops pointing at it, and nothing points into a
// sealed tile. (authorBuilding already gave each gate's street its one link to the door.)
let cut = 0;
const parkIds = new Set(tiles.map(([x, y]) => parkId(x, y)));
const oldIds = new Set(tiles.map(([x, y]) => oldId(x, y)));
for (const z of store.all('zones')) {
  if (z.map_id !== 'map_world' || parkIds.has(z.id)) continue;
  const exits = { ...(z.exits || {}) };
  let changed = false;
  for (const [dir, to] of Object.entries(exits)) {
    const sealedPark = parkIds.has(to) && to !== parkId(897, 913) && to !== parkId(895, 911);
    if (oldIds.has(to) || sealedPark) { delete exits[dir]; changed = true; cut++; }
  }
  if (changed) store.patch('zones', z.id, { exits });
}

// The city grid feeds the new tiles as it fed the old ones.
for (const [x, y] of tiles) {
  const prev = store.get('power_zones', oldId(x, y));
  if (prev) store.patch('power_zones', parkId(x, y), { ...prev, id: parkId(x, y), name: NAME });
}

// ── 4. THE STREETS ROUND IT ──────────────────────────────────────────────────────────────────
const GROUND = [
  [896, 910, 'Halcyon Boulevard',
    'Loose stone crunches underfoot, greyed with dust and old oil. The brick outfield wall of the Hughson Coliseum runs along the south side, and the scoreboard\'s steel legs stand over it. A dead streetlight leans at the verge.'],
  [895, 910, 'Halcyon Boulevard',
    'A wide run of packed gravel and grit, graded flat by traffic and rain. The Hughson Coliseum\'s bleacher gate opens off the south side, two iron gates in the outfield wall. Puddles stand in the ruts.'],
  [897, 914, 'Sorrel Way',
    'The corner outside the Hughson Coliseum\'s main gate, a brick rotunda with the name in bronze over three iron gates. Cable covers run across the road in yellow rubber, feeding the light towers. Crowd barriers are chained to the lamp posts.'],
  [896, 914, 'Sorrel Way',
    'The middle of Sorrel Way, under the Hughson Coliseum\'s grandstand: brick piers and arched openings along the north side, and the estate\'s chrome along the south. Ticket stubs collect in the gutter.'],
  [898, 912, 'Grasslands',
    'A strip of grass between the Hughson Coliseum\'s first-base wall and Kettle Lane, seedheads nodding over a buried kerb. A path is worn across it to a loading door in the brick.'],
];
for (const [x, y, name, description] of GROUND) store.patch('zones', oldId(x, y), { name, description });

// MARK-4: a marker is unique across the world.
for (const [mk, id] of [['HC', main.facadeId], ['BG', bleachers.facadeId]]) {
  const clash = store.all('zones').filter((z) => z.marker === mk && z.id !== id);
  if (clash.length) throw new Error(`map code ${mk} is already ${clash.map((z) => `${z.name} (${z.id})`).join(', ')}`);
}

const written = store.flush({ dryRun: DRY });
// The six links between the old facades and the street go with the facades. A connection file is an
// edge, not an entity anything points at, so these are the only files this build removes.
const removed = [];
for (const id of STREET_CONNS) {
  const p = path.join(store.baseDir, 'connections', `${id}.json`);
  if (fs.existsSync(p)) { removed.push(p); if (!DRY) fs.unlinkSync(p); }
}
console.log(`${DRY ? 'DRY RUN: ' : ''}${written.length} file(s) ${DRY ? 'would be written' : 'written'}, ${removed.length} connection file(s) ${DRY ? 'would be removed' : 'removed'}`);
console.log(`  main gate ${main.facadeId}  map ${main.mapId}  utility ${main.utilityRoomId}`);
console.log(`  bleacher gate ${bleachers.facadeId}  map ${bleachers.mapId}  utility ${bleachers.utilityRoomId}`);
console.log(`  set aside ${tiles.length} tile(s) on ${HOLD}, ${SET_ASIDE_NPCS.length} NPC(s); ${cut} world exit(s) into the block removed`);
console.log('\nnext:\n  node scripts/content/mint-connections.mjs --write\n  npm run content:lint');
