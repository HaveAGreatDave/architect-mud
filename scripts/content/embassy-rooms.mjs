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
// The street door is in the lobby's west wall, the washroom off its east wall; the flats sit north,
// south, east and west of each landing.
import fs from 'fs';
import { canonicalJson } from './lib.mjs';

const ZONES = 'content/zones/', FURN = 'content/furniture/';
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const GOLD = '#b8913e', ROSE = '#d39aa2', base = { balcony: false, face: 0, studio: false };

const LOBBY = 'zone_residential_lobby', L2 = 'zone_embassy_floor_2nd', L3 = 'zone_embassy_floor2', L4 = 'zone_embassy_floor3';
const plaques = (n, first) => Object.fromEntries(['A', 'B', 'C', 'D'].map((x, i) => [`zone_apt_${first + i}`, `${n}${x}`]));

const ZONE = {
  [LOBBY]: {
    floor: 'stone',
    description: "Pink marble underfoot, dulled to the colour of old soap. Lowry's bar runs along the north wall under COCKTAILS in pink neon, peanut shells round its stools. A card table sits under a green lamp by the jukebox. Behind the reception desk, a key on every hook. Everything is dusted. Nothing is fixed.",
    intro_lore: 'The Embassy was a hotel before the Handoff, and the staff never got the memo. Lowry still sets out the good glasses, still says "sir", still keeps a key for every room in the pigeonholes, though half the doors upstairs have been rekeyed by tenants. The basin\'s most sought-after slum keeps hotel hours.',
    room: {
      ...base, w: 14, d: 10, h: 4.6, finish: 'fine', ground: 'marble',
      tone: { accent: GOLD, ceiling: '#e9d6cf', trim: '#2a1a14', wall: ROSE },
      // the street door: a pair of hinged bronze-and-glass leaves under a fanlight, swinging in
      street_door: { kind: 'swing', w: 2, trim: '#8a6a44', glass: '#7f97a0', monogram: 'E', fanlight: true, runner: '#7a1e2a' },
      sign: { text: 'EMBASSY', sub: 'RECEPTION', wall: 'back', at: -1.5, y: 3.7, size: 0.42 },
      decor: {
        walls: { kind: 'walnut', hex: '#5a3a26', y1: 1.25, rail: 1.0 },
        ceiling: { kind: 'coffer', hex: '#e9d6cf', trim: GOLD, band: 0.6, drop: 0.32, cell: 2.3 },
        floor: { border: '#7a3e44', inset: 0.7, line: '#c9a14a', w: 0.28, medallion: [0, 5, 1.6] },
        downlights: false, rug: false,
        lights: [{ at: [0, 5], r: 1.1, tiers: 3, drop: 1.9, k: 1.6 }],
        sconces: { y: 2.3, points: [['front', 2.2], ['front', 5.6], ['back', -4.6], ['back', 1.4], ['right', 1.4], ['right', 8.6], ['left', 2], ['left', 8.2]] },
        art: [{ wall: 'front', at: 4, w: 1.6, h: 1.1, y: 2.9, seed: 27 }],
        // the bar's dressing (gl/room-saloon.js): its neon and lamps, the card table's lamp, fans, the hang of old
        // photographs over the console, antlers over the washroom door, a chalkboard, darts by the stairs, the
        // payphone past the ATMs, a coat stand by the street door, and what the night left on the floor
        neon: [{ wall: 'front', at: -3.9, y: 3.6, text: 'COCKTAILS', h: 0.34, hex: '#ff4f8a', lamp: 0.35 }],
        pendants: [
          { at: [3.4, 6.2], y: 1.72, kind: 'card', len: 1.4, k: 1.1, tint: [0.95, 1.12, 0.85] },
          { at: [-5.7, 1.6], y: 2.35, kind: 'school' }, { at: [-3.9, 1.6], y: 2.35, kind: 'school', k: 0.9, tint: [1.12, 0.96, 0.78] }, { at: [-2.1, 1.6], y: 2.35, kind: 'school' },
        ],
        fans: [[3.4, 2.9, 0.7], [-3.9, 6.2, 0.7]],
        salon: [{ wall: 'right', at: 2.9, y: 2.35, w: 1.7, h: 1.15, seed: 4 }],
        trophy: [{ wall: 'right', at: 5, y: 3.15 }],
        chalk: [{ wall: 'left', at: 2.2, y: 1.75, w: 0.8, h: 1, title: 'Tonight' }],
        darts: [{ wall: 'back', at: -5.1, y: 1.73 }],
        payphone: [{ wall: 'back', at: 6.8, y: 1.4 }],
        hatstand: [[-6.6, 6.5]],
        litter: [{ at: [-3.9, 2.75], r: [2.7, 0.45], n: 80, seed: 3 }, { at: [3.4, 6.2], r: [1.6, 1.1], n: 20, seed: 5 }],
        plants: [[-6.3, 9.2, 1.15], [6.3, 0.8, 1.05]],
        doors: [{ wall: 'back', at: 3.2, w: 1.1, label: 'Out of order' }],
      },
    },
  },
  [L2]: {
    floor: 'carpet',
    description: "The corridor still behaves like a hotel. A burgundy runner worn to the weft, and rose wallpaper with a little gold crest, lifting at the seams. Four doors, 2A to 2D, brass numbers square, brass paper slots that haven't seen a paper since the Handoff. A sconce every second door. Every second sconce works.",
    intro_lore: "One flight up from Lowry's, the Embassy still pretends to be a hotel: a runner underfoot, numbers square in their screws, a landing that hasn't quite given up. Four doors, four locks, four small holdouts against the basin outside.",
    room: {
      ...base, w: 16, d: 3.2, h: 3, finish: 'fine', windowless: true,
      tone: { accent: GOLD, ceiling: '#ead9cf', trim: '#2a1a14', wall: ROSE },
      decor: {
        walls: { kind: 'walnut', hex: '#5a3a26', y1: 1.0, rail: 0.85 },
        ceiling: { kind: 'cove', hex: '#ead9cf', trim: GOLD, band: 0.35, drop: 0.14 },
        runner: { along: 'u', w: 1.3, end: 0.6, hex: '#5a1a22', border: '#a8823a' },
        downlights: false, rug: false,
        sconces: { y: 1.85, points: [['front', -5.5], ['front', 5.5], ['back', -5.5], ['back', 5.5]] },
        art: [{ wall: 'front', at: -2.6, w: 0.9, h: 1.1, y: 1.8, seed: 11 }],
        plaques: plaques(2, 1),
      },
    },
  },
  [L3]: {
    floor: 'boards',
    description: "The runner stops short of the doors as if it lost its nerve. The rose paper has been painted over in a pink that doesn't match. Units 3A to 3D, numbers hanging by single screws. A dead vending machine stands where the luggage trolley was, glass cracked, snacks fossilised. A print of the hotel's own front hangs crooked.",
    intro_lore: 'Two flights up from Lowry\'s bar, the hotel starts telling the truth about itself: the runner gone short, the paper painted over, a vending machine that died guarding snacks nobody will ever eat. Four doors, four locks, four small victories against everything on the other side of them.',
    room: {
      ...base, w: 16, d: 3.2, h: 3, windowless: true,
      tone: { accent: '#8a6a44', ceiling: '#d9c9bd', trim: '#2a1e18', wall: '#c99aa0' },
      decor: {
        ceiling: { kind: 'cove', hex: '#d9c9bd', trim: '#8a6a44', band: 0.3, drop: 0.12 },
        runner: { along: 'u', w: 1.2, end: 4.2, hex: '#4a1a20', border: '#7a6038' },
        rug: false,
        sconces: { y: 1.85, points: [['front', -5.5], ['back', 5.5]] },
        art: [{ wall: 'back', at: -3.4, w: 0.8, h: 0.6, y: 1.7, seed: 52 }],
        plaques: plaques(3, 5),
      },
    },
  },
  [L4]: {
    floor: 'concrete',
    description: "Top of the stairs, and the hotel has stopped pretending. Water stains bloom across the ceiling and the rose paper hangs in tongues. One emergency light burns red over the stairwell. Units 4A to 4D have newer locks and heavier doors. The newel post is carved with the hotel's crest and duct-taped where it broke.",
    intro_lore: 'One more flight and the building gives up pretending it was ever nice. The people up here climbed past two landings to get further from the noise, the smell and each other. The one working light burns red, which some call thematic and others call the bulb they had.',
    room: {
      ...base, w: 16, d: 3.2, h: 3, windowless: true, ground: 'concrete',
      tone: { accent: '#5a4a3a', ceiling: '#a89a8a', trim: '#1e1814', wall: '#8a6a66' },
      decor: { rug: false, plaques: plaques(4, 9) },
    },
  },
};

const PLACE = {
  // the bar stands out from the north wall with its back bar behind it, west of the window, and the bartender
  // between them (npc flags.post); its stools are one run of six (room-layout.js 'stools')
  furniture_embassy_bar_counter: { look: { arche: 'surface', form: 'bar', dims: [5.4, 0.72, 1.12], dress: 'saloon' }, spot: { at: [-3.9, 1.6], turn: 180 } },
  furniture_embassy_stools: { look: { arche: 'seat', form: 'stools', dims: [4.8, 0.45, 0.78] }, spot: { at: [-3.9, 2.42], turn: 0 } },
  furniture_1783065860962: { spot: { wall: 'front', along: 1.6 } },
  // the card table: a racetrack for six, the dealer's end to the north, four chairs round the other three sides
  furn_embassy_poker_table: { look: { arche: 'table', form: 'poker', dims: [2.3, 1.25, 0.78], dress: 'saloon' }, spot: { at: [3.4, 6.2], turn: 180 } },
  furn_embassy_chair_1: { spot: { at: [1.7, 6.2], turn: 90 } },
  furn_embassy_chair_2: { spot: { at: [2.85, 7.15], turn: 0 } },
  furn_embassy_chair_3: { spot: { at: [3.95, 7.15], turn: 0 } },
  furn_embassy_chair_4: { spot: { at: [5.1, 6.2], turn: -90 } },
  furniture_1783470518660: { spot: { wall: 'back', along: 4.9 } },
  furniture_1783521389502: { spot: { wall: 'back', along: 5.9 } },
  furniture_embassy_corkboard: { spot: { wall: 'left', along: 7.4 } },
  furniture_lobby_trashbin: { spot: { wall: 'left', along: 3.4 } },
  furn_hero_poster_ocelot: { spot: { wall: 'right', along: 7.2 } },
  furn_floor2_vending: { spot: { wall: 'back', along: -6.6 } },
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
  row('furn_embassy_reception', LOBBY, 'reception desk', 'fixture', 'A long desk in fluted brass and pink marble, polished to a shine nobody pays for. A brass bell at one end. The guest book on it stops the week of the Handoff; tenants have signed under it since.', { aliases: 'desk,reception,bell,guest book,guestbook', interactions: ['lean'], look: { arche: 'surface', form: 'reception', dims: [3.6, 0.8, 1.1] }, spot: { at: [-1.5, 8.2], turn: 0 } }),
  row('furn_embassy_key_wall', LOBBY, 'key pigeonholes', 'decoration', 'A wall of walnut pigeonholes behind the desk, one for every room, each with a numbered key on a brass fob. A few hooks are empty. Lowry knows which ones, and won\'t say.', { aliases: 'pigeonholes,keys,key wall,fobs', look: { arche: 'store', form: 'cabinet', dims: [3, 0.35, 2.3] }, spot: { wall: 'back', along: -1.5 } }),
  row('furn_embassy_back_bar', LOBBY, 'back bar', 'fixture', 'Three mahogany arches over a smoked mirror, two lit shelves of bottles in each, and LOUNGE in brass along the top. A brass till sits at one end and a wireless at the other. The clock over the middle stopped at ten past nine.', { aliases: 'back bar,mirror,bottles,shelves,till,register,wireless,radio,clock', look: { arche: 'surface', form: 'barwall', dims: [5.4, 0.5, 3], dress: 'saloon', trade: 'Lounge' }, spot: { wall: 'front', along: -3.9 } }),
  row('furn_embassy_jukebox', LOBBY, 'jukebox', 'decoration', 'A walnut jukebox with its tubes lit red through blue. Most of the title strips have faded blank, and the coin slot takes a coin nobody has carried in years.', { aliases: 'juke,jukebox,records', look: { arche: 'prop', form: 'jukebox', dims: [0.95, 0.62, 1.55] }, spot: { wall: 'front', along: 3.3 } }),
  row('furn_embassy_console', LOBBY, 'console table', 'decoration', 'A marble console by the washroom door with a tall vase of lilies on it. The lilies are silk, and someone dusts them every morning.', { aliases: 'console,table,lilies,vase', look: { arche: 'surface', form: 'console', dims: [1.6, 0.42, 0.86], dress: 'lilies' }, spot: { wall: 'right', along: 3.4 } }),
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
