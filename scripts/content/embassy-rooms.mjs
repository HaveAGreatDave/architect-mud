// One-shot authoring pass for the Embassy Hotel in ROOM (docs/proposals/building-stage.md): the lobby and
// lounge, and the three landings above it. A grand hotel that outlived its era and kept up appearances:
// rose plaster, walnut, brass and marble downstairs, and each floor up a step further gone. This writes each
// room's `flags.room`, its text, every row's `flags.look` and `flags.spot`, and the rows the text promises.
// Idempotent: a file is only written when it would change.
//
//   node scripts/content/embassy-rooms.mjs
//
// The frame (client/shared/room-layout.js): every room here faces north (face 0), so the front wall is
// north, right is east, left is west and back is south. A spot's `at` is [u, v] in metres, u east of the
// room's middle and v south of the north wall; `turn` 0 faces north, 90 east, 180 south, -90 west.
// The street door is in the lobby's west wall, the washroom off its east wall; the rooms sit north,
// south, east and west of each landing.
//
// ⚠ EVERY ROOM HERE FITS INSIDE THE GLASS MODEL (content/building_models/embassyhotelbar.json), and the model
// doesn't move to fit the rooms. At its tile (921,904 since the column at x 914 went in) the bar storey is 0 to 5.37 m, and
// the rose shaft is 15.7 m square with its eyebrow courses at 9.50 and 13.43 m and its top at 17.39, so the lobby is 5.37 m
// high and the landings 4.13, 3.93 and 3.96. ⚠ A building's size is jittered by its tile's seed (skyline-scale.js
// buildingScale), so if the tile moves again these heights, and each flight's `doors.down` above it, move too. Each
// landing is 4.4 x 8 m in the middle of the plate with a pair of flights side by side down it; its `doors` offsets
// put its four rooms (scripts/content/embassy-hotel-rooms.mjs) against the outside walls.
import fs from 'fs';
import { canonicalJson } from './lib.mjs';

const ZONES = 'content/zones/', FURN = 'content/furniture/';
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const GOLD = '#b8913e', ROSE = '#d39aa2', base = { balcony: false, face: 0, studio: false };

const LOBBY = 'zone_residential_lobby', L2 = 'zone_embassy_floor_2nd', L3 = 'zone_embassy_floor2', L4 = 'zone_embassy_floor3';
// each landing's doors (gl/room-lock.js panelDoorOf): the units on that floor carry the same, so the door is one door
// from either side. Walnut and brass on the second floor, painted over on the third, flush and heavier on the fourth
const LEAVES = {
  [L2]: { kind: 'panel', wood: '#4a2c1c', metal: GOLD },
  [L3]: { kind: 'panel', wood: '#5e3f36', metal: '#8a6a44' },
  [L4]: { kind: 'panel', wood: '#3a3430', metal: '#9aa0a6', flush: true },
};
const plaques = (n, first) => Object.fromEntries(['A', 'B', 'C', 'D'].map((x, i) => [`zone_apt_${first + i}`, `${n}${x}`]));

const ZONE = {
  [LOBBY]: {
    floor: 'stone',
    description: "Pink marble underfoot, dulled to the colour of old soap. Lowry's bar runs along the north wall under COCKTAILS in pink neon, peanut shells round its stools. A card table sits under a green lamp by the jukebox. Behind the reception desk, a key on every hook and five clocks stopped at the same minute. The stairs start at the back of the room, beside a lift that has said OUT OF ORDER since the Handoff, and climb toward the bar. A leather sofa and two wing chairs sit on a worn rug in the far corner. Everything is dusted. Nothing is fixed.",
    intro_lore: 'The Embassy was a hotel before the Handoff, and the staff never got the memo. Lowry still sets out the good glasses, still says "sir", still keeps a key for every room in the pigeonholes, though half the doors upstairs have been rekeyed by tenants. The basin\'s most sought-after slum keeps hotel hours.',
    room: {
      ...base, w: 14, d: 10, h: 5.37, finish: 'fine', ground: 'marble',
      tone: { accent: GOLD, ceiling: '#e9d6cf', trim: '#2a1a14', wall: ROSE },
      // the street door: a pair of hinged bronze-and-glass leaves under a fanlight, swinging in
      street_door: { kind: 'swing', w: 2, trim: '#8a6a44', glass: '#7f97a0', monogram: 'E', fanlight: true, runner: '#7a1e2a', dark: true, hand: true },
      // the stairs up to the second-floor landing: from beside the dead lift in the back wall, climbing north toward
      // the bar. They rise 5.37 m, so the steepest going (0.22) keeps the flight to 6.2 m, and they run up the middle
      // of the plate because the landing above is there. The landing stands over the top with its `doors.down`
      // (building-stage.md, Stairs)
      stair: { at: [0.84, 8.6], climb: 'front', w: 1.1, going: 0.22 },
      decor: {
        walls: { kind: 'walnut', hex: '#5a3a26', y1: 1.25, rail: 1.0 },
        ceiling: { kind: 'coffer', hex: '#e9d6cf', trim: GOLD, band: 0.6, drop: 0.32, cell: 2.3 },
        // the medallion and the chandelier over it stand west of the stairs, which climb up the room's middle
        floor: { border: '#7a3e44', inset: 0.7, line: '#c9a14a', w: 0.28, medallion: [-2.2, 4.4, 1.4] },
        downlights: false,
        // the sitting corner: a Persian rug under the sofa, the chairs and the low table
        rug: { at: [-3.6, 6.85], w: 3.8, d: 2.7, style: 'persian' },
        lights: [{ at: [-2.2, 4.4], r: 1.1, tiers: 3, drop: 1.9, k: 1.6 }],
        sconces: { y: 2.3, kind: 'twin', hex: GOLD, points: [['front', 2.2], ['front', 5.6], ['back', 1.4], ['right', 8.6], ['left', 2], ['left', 9.4]] },
        art: [{ wall: 'front', at: 4, w: 1.6, h: 1.1, y: 2.9, seed: 27, lamp: true }],
        // the reception wall (gl/room-hotel.js): the name in raised brass lit from behind, over a row of clocks for five
        // cities, all stopped at the same minute as the back bar's, over the key wall
        letters: [
          { wall: 'right', at: 2.75, y: 3.68, text: 'EMBASSY', h: 0.3 },
          { wall: 'right', at: 2.75, y: 3.34, text: 'RECEPTION', h: 0.085, depth: 0.012, halo: false },
        ],
        clocks: [{ wall: 'right', at: 2.75, y: 2.78, r: 0.13, gap: 0.46, list: [
          { name: 'Coldwater', t: '9:10' }, { name: 'New York', t: '12:10' }, { name: 'London', t: '5:10' }, { name: 'Paris', t: '6:10' }, { name: 'Tokyo', t: '2:10' },
        ] }],
        // the board at the foot of the stairs; its arrows are as you face it, looking south
        directory: [{ wall: 'back', at: 1.7, y: 1.55, w: 0.62, title: 'Embassy Hotel', lines: [
          { text: 'Rooms 2A-4D', arrow: 'up' }, { text: 'Reception', arrow: 'left' }, { text: 'Washroom', arrow: 'left' },
        ] }],
        // a standard lamp at each end of the sofa, lighting the corner
        standards: [{ at: [-5.05, 7.75], k: 0.55 }, { at: [-2.15, 7.75], k: 0.55 }],
        // the bar's dressing (gl/room-saloon.js): its neon and lamps, the card table's lamp, fans, the hang of old
        // photographs over the console, antlers over the washroom door, a chalkboard, the payphone past the ATMs,
        // a coat stand by the street door, and what the night left on the floor
        neon: [{ wall: 'front', at: -3.9, y: 3.6, text: 'COCKTAILS', h: 0.34, hex: '#ff4f8a', lamp: 0.35 }],
        pendants: [
          { at: [3.7, 5.7], y: 1.72, kind: 'card', len: 1.4, k: 1.1, tint: [0.95, 1.12, 0.85] },
          { at: [-5.7, 1.6], y: 2.35, kind: 'school' }, { at: [-3.9, 1.6], y: 2.35, kind: 'school', k: 0.9, tint: [1.12, 0.96, 0.78] }, { at: [-2.1, 1.6], y: 2.35, kind: 'school' },
        ],
        fans: [[3.4, 2.9, 0.7], [-3.9, 6.2, 0.7]],
        salon: [{ wall: 'right', at: 7.4, y: 2.35, w: 1.7, h: 1.15, seed: 4 }],
        trophy: [{ wall: 'right', at: 5, y: 3.15 }],
        chalk: [{ wall: 'left', at: 2.2, y: 1.75, w: 0.8, h: 1, title: 'Tonight' }],
        payphone: [{ wall: 'back', at: 6.8, y: 1.4 }],
        hatstand: [[-6.6, 6.5]],
        litter: [{ at: [-3.9, 2.75], r: [2.7, 0.45], n: 80, seed: 3 }, { at: [3.7, 5.7], r: [1.6, 1.1], n: 20, seed: 5 }],
        // one in the far corner past the sofa, one at the north end of the desk
        plants: [[-6.5, 9.4, 1.15], [6.3, 0.6, 1.05]],
        doors: [{ wall: 'back', at: 3.2, w: 1.1, label: 'Out of order' }],
      },
    },
  },
  [L2]: {
    floor: 'carpet',
    description: "The landing still behaves like a hotel. Rose wallpaper with a little gold crest, lifting at the seams, and two flights side by side down the middle, one up from the lobby and one on up. Four doors, 2A to 2D, brass numbers square, brass paper slots that haven't seen a paper since the Handoff. A sconce by every door. Every second sconce works.",
    intro_lore: "One flight up from Lowry's, the Embassy still pretends to be a hotel: numbers square in their screws, a landing that hasn't quite given up. Four doors, four locks, four small holdouts against the basin outside.",
    room: {
      ...base, w: 4.4, d: 8, h: 4.13, finish: 'fine', windowless: true,
      // the lobby's flight arrives up the west half of the middle, climbing north; the next leaves up the east half,
      // climbing south, so a walkway runs down each side to the doors. The offsets stand 2A and 2B along the north
      // and south walls and 2C and 2D across the back and the street front (fitted with building-graph.js's layout)
      doors: { down: [-0.55, 1.44], north: -1.47, south: 1.47, east: -3.15, west: 3.15 },
      stair: { at: [0.55, 1.0], climb: 'back', w: 1.1, going: 0.22 },
      tone: { accent: GOLD, ceiling: '#ead9cf', trim: '#2a1a14', wall: ROSE },
      decor: {
        walls: { kind: 'walnut', hex: '#5a3a26', y1: 1.0, rail: 0.85 },
        ceiling: { kind: 'cove', hex: '#ead9cf', trim: GOLD, band: 0.35, drop: 0.14 },
        downlights: false, rug: false,
        sconces: { y: 1.85, points: [['left', 3], ['left', 6.4], ['right', 1.6], ['right', 4.8]] },
        art: [{ wall: 'front', at: 1.0, w: 0.9, h: 1.1, y: 1.8, seed: 11 }],
        plaques: plaques(2, 1),
        leaves: LEAVES[L2],
      },
    },
  },
  [L3]: {
    floor: 'boards',
    description: "The rose paper has been painted over in a pink that doesn't match. Units 3A to 3D, numbers hanging by single screws. A dead vending machine stands in the corner where the luggage trolley was, glass cracked, snacks fossilised. A print of the hotel's own front hangs crooked.",
    intro_lore: 'Two flights up from Lowry\'s bar, the hotel starts telling the truth about itself: the paper painted over, a vending machine that died guarding snacks nobody will ever eat. Four doors, four locks, four small victories against everything on the other side of them.',
    room: {
      ...base, w: 4.4, d: 8, h: 3.93, windowless: true,
      // up from the second floor in the east half, climbing south; on up to the fourth in the west half, climbing north
      doors: { down: [0.55, 5.62], north: -1.47, south: 1.47, east: -3.15, west: 3.15 },
      stair: { at: [-0.55, 7.0], climb: 'front', w: 1.1, going: 0.22 },
      tone: { accent: '#8a6a44', ceiling: '#d9c9bd', trim: '#2a1e18', wall: '#c99aa0' },
      decor: {
        ceiling: { kind: 'cove', hex: '#d9c9bd', trim: '#8a6a44', band: 0.3, drop: 0.12 },
        rug: false,
        sconces: { y: 1.85, points: [['left', 3], ['right', 4.8]] },
        art: [{ wall: 'front', at: 1.2, w: 0.8, h: 0.6, y: 1.7, seed: 52 }],
        plaques: plaques(3, 5),
        leaves: LEAVES[L3],
      },
    },
  },
  [L4]: {
    floor: 'concrete',
    description: "Top of the stairs, and the hotel has stopped pretending. Water stains bloom across the ceiling and the rose paper hangs in tongues. One emergency light burns red over the stairwell. Units 4A to 4D have newer locks and heavier doors. The newel post is carved with the hotel's crest and duct-taped where it broke.",
    intro_lore: 'One more flight and the building gives up pretending it was ever nice. The people up here climbed past two landings to get further from the noise, the smell and each other. The one working light burns red, which some call thematic and others call the bulb they had.',
    room: {
      ...base, w: 4.4, d: 8, h: 3.96, windowless: true, ground: 'concrete',
      // the last flight comes up the west half, climbing north
      doors: { down: [-0.55, 2.6], north: -1.47, south: 1.47, east: -3.15, west: 3.15 },
      tone: { accent: '#5a4a3a', ceiling: '#a89a8a', trim: '#1e1814', wall: '#8a6a66' },
      decor: { rug: false, plaques: plaques(4, 9), leaves: LEAVES[L4] },
    },
  },
};

const PLACE = {
  // the bar stands out from the north wall with its back bar behind it, west of the window, and the bartender
  // between them (npc flags.post); its stools are one run of six (room-layout.js 'stools')
  furniture_embassy_bar_counter: { look: { arche: 'surface', form: 'bar', dims: [5.4, 0.72, 1.12], dress: 'saloon' }, spot: { at: [-3.9, 1.6], turn: 180 } },
  furniture_embassy_stools: { look: { arche: 'seat', form: 'stools', dims: [4.8, 0.45, 0.78] }, spot: { at: [-3.9, 2.42], turn: 0 } },
  furniture_1783065860962: { spot: { wall: 'front', along: 1.6 } },
  // the card table: a racetrack for six, the dealer's end to the north, four chairs round the other three sides,
  // a little north of the room's middle so there's room to walk between it and the desk, and east of the stairs
  furn_embassy_poker_table: { look: { arche: 'table', form: 'poker', dims: [2.3, 1.25, 0.78], dress: 'saloon' }, spot: { at: [3.7, 5.7], turn: 180 } },
  furn_embassy_chair_1: { spot: { at: [2.0, 5.7], turn: 90 } },
  furn_embassy_chair_2: { spot: { at: [3.15, 6.65], turn: 0 } },
  furn_embassy_chair_3: { spot: { at: [4.25, 6.65], turn: 0 } },
  furn_embassy_chair_4: { spot: { at: [5.4, 5.7], turn: -90 } },
  furniture_1783470518660: { spot: { wall: 'back', along: 4.9 } },
  furniture_1783521389502: { spot: { wall: 'back', along: 5.9 } },
  furniture_embassy_corkboard: { spot: { wall: 'left', along: 7.4 } },
  furniture_lobby_trashbin: { spot: { wall: 'left', along: 3.4 } },
  furn_hero_poster_ocelot: { spot: { wall: 'right', along: 9.35 } },
  // in the third-floor landing's north-east corner, clear of both walkways' doors
  furn_floor2_vending: { spot: { wall: 'right', along: 1.0 } },
};

// text that has to change with the room: the stools and the corkboard say what they are now
const RETEXT = {
  furniture_embassy_stools: { name: 'velvet bar stools', description: 'Six stools at the counter in burgundy velvet, gone bald at the seat and shiny where the brass foot-rail has been kicked for decades. They swivel, all but one.' },
  furniture_embassy_bar_counter: { description: 'A mahogany bar in raised panels under a padded oxblood rail, a brass foot rail and a spittoon at each end. Three taps, a bowl of peanuts and a candle in red glass. Lowry keeps it spotless out of sheer habit.' },
  furn_embassy_poker_table: { description: "A racetrack card table in walnut and green baize, the padded rail studded with brass and worn smooth at the elbows. Cup holders, an ashtray nobody empties, and a dealer's tray at the north end, clean and ready." },
  furniture_embassy_corkboard: { description: 'Pinned to the panelling by the street door. Handwritten unit listings cover every inch, half of them crossed out and re-listed at a worse price.' },
};

const row = (id, zone_id, name, object_type, description, flags) => ({ description, flags, hp: null, hp_max: null, id, light_type: null, lumen_output: null, name, object_type, power_draw_kw: null, price: 0, zone_id });
const NEW = [
  row('furn_embassy_reception', LOBBY, 'reception desk', 'fixture', 'A long mahogany desk in raised panels under a pink marble top, polished to a shine nobody pays for. A brass bell, a green banker\'s lamp, and the guest book, which stops the week of the Handoff. Tenants have signed under it since.', { aliases: 'desk,reception,bell,guest book,guestbook,register,lamp', interactions: ['lean'], look: { arche: 'surface', form: 'reception', dims: [3, 0.8, 1.1], dress: 'hotel' }, spot: { at: [5.25, 2.75], turn: -90 } }),
  row('furn_embassy_key_wall', LOBBY, 'key pigeonholes', 'decoration', 'A wall of walnut pigeonholes behind the desk, one for every room, each with a numbered key on a brass fob. A few hooks are empty, and a few letters wait for people who never came back. Lowry knows which, and won\'t say.', { aliases: 'pigeonholes,keys,key wall,fobs,letters,clocks', look: { arche: 'prop', form: 'pigeonholes', dims: [2.6, 0.4, 2.3] }, spot: { wall: 'right', along: 2.75 } }),
  // the sitting corner under the stairs, on its rug (the room's decor.rug), lit by two standard lamps
  row('furn_embassy_chesterfield', LOBBY, 'chesterfield', 'furniture', 'A buttoned sofa in oxblood leather, gone grey where a thousand arms have rested, with a row of brass nails along the front. Two nails are missing. Lowry has noticed.', { aliases: 'sofa,couch,chesterfield,leather sofa', interactions: ['sit', 'lie'], look: { arche: 'sofa', form: 'chesterfield', dims: [2.1, 0.92, 0.76], dress: 'oxblood' }, spot: { at: [-3.6, 7.8], turn: 0 } }),
  row('furn_embassy_wingback_1', LOBBY, 'green wing chair', 'furniture', 'A high-backed wing chair in green velvet, worn to the weave where heads have rested, with brass nails down each arm. It sinks further than you expect.', { aliases: 'chair,wing chair,wingback,armchair', interactions: ['sit'], look: { arche: 'seat', form: 'wingback', dims: [0.86, 0.86, 1.15], dress: 'emerald' }, spot: { at: [-5.0, 6.45], turn: 90 } }),
  row('furn_embassy_wingback_2', LOBBY, 'claret wing chair', 'furniture', 'The other wing chair, in claret velvet, with the good springs. Regulars wait for it rather than take the green one.', { aliases: 'chair,wing chair,wingback,armchair', interactions: ['sit'], look: { arche: 'seat', form: 'wingback', dims: [0.86, 0.86, 1.15], dress: 'claret' }, spot: { at: [-2.2, 6.45], turn: -90 } }),
  row('furn_embassy_low_table', LOBBY, 'low table', 'furniture', 'A low walnut table with a marble top. On it, a brass ashtray, two hardbacks nobody has opened and a glass dish of matches. Yesterday\'s paper is on the shelf underneath, and so is last week\'s.', { aliases: 'table,coffee table,low table,ashtray,paper,newspaper', look: { arche: 'table', form: 'cocktail', dims: [1.1, 0.6, 0.45] }, spot: { at: [-3.6, 6.6], turn: 0 } }),
  row('furn_embassy_luggage_cart', LOBBY, 'luggage cart', 'decoration', 'A brass birdcage cart on a red carpet deck, parked in front of the lift that doesn\'t work. Two suitcases, a hatbox and a garment bag ride on it. Nobody has claimed them.', { aliases: 'cart,trolley,luggage,suitcases,hatbox,luggage cart', look: { arche: 'prop', form: 'trolley', dims: [1.15, 0.62, 1.85] }, spot: { at: [3.2, 9.3], turn: 0 } }),
  row('furn_embassy_back_bar', LOBBY, 'back bar', 'fixture', 'Three mahogany arches over a smoked mirror, two lit shelves of bottles in each, and LOUNGE in brass along the top. A brass till sits at one end and a wireless at the other. The clock over the middle stopped at ten past nine.', { aliases: 'back bar,mirror,bottles,shelves,till,register,wireless,radio,clock', look: { arche: 'surface', form: 'barwall', dims: [5.4, 0.5, 3], dress: 'saloon', trade: 'Lounge' }, spot: { wall: 'front', along: -3.9 } }),
  row('furn_embassy_jukebox', LOBBY, 'jukebox', 'decoration', 'A walnut jukebox with its tubes lit red through blue. Most of the title strips have faded blank, and the coin slot takes a coin nobody has carried in years.', { aliases: 'juke,jukebox,records', look: { arche: 'prop', form: 'jukebox', dims: [0.95, 0.62, 1.55] }, spot: { wall: 'front', along: 3.3 } }),
  row('furn_embassy_console', LOBBY, 'console table', 'decoration', 'A marble console past the washroom door with a tall vase of lilies on it. The lilies are silk, and someone dusts them every morning.', { aliases: 'console,table,lilies,vase', look: { arche: 'surface', form: 'console', dims: [1.6, 0.42, 0.86], dress: 'lilies' }, spot: { wall: 'right', along: 7.4 } }),
];

const save = (file, data) => {
  const text = canonicalJson(data);
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) return 0;
  fs.writeFileSync(file, text, 'utf8');
  return 1;
};
let wrote = 0;
for (const [id, { room, ...text }] of Object.entries(ZONE)) {
  const z = read(`${ZONES}${id}.json`);
  z.description = text.description;
  z.flags = { ...z.flags, floor: text.floor, intro_lore: text.intro_lore, room };
  wrote += save(`${ZONES}${id}.json`, z);
}
for (const [id, { look, spot }] of Object.entries(PLACE)) {
  const r = read(`${FURN}${id}.json`);
  r.flags = { ...(r.flags || {}), ...(look ? { look } : {}), spot };
  Object.assign(r, RETEXT[id] || {});
  wrote += save(`${FURN}${id}.json`, r);
}
for (const r of NEW) {
  if (r.description.length > 300) throw new Error(`${r.id}: description over 300 characters`);
  wrote += save(`${FURN}${r.id}.json`, r);
}
console.log(`${wrote} files written`);
