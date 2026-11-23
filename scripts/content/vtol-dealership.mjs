/**
 * THE HOVER CAR DEALERSHIP on Marrow Street, and Adequate!'s move to make room for it
 * (docs/proposals/vtol-dealership.md).
 *
 *   node scripts/content/vtol-dealership.mjs [--dry-run]                    the rooms only
 *   node scripts/content/vtol-dealership.mjs --adequate 911,907 [--dry-run] the move, then the whole building
 *
 * ⚠ THIS WRITES CONTENT. Without `--adequate` it writes only what is the dealership's own: its
 * showroom, plant room, fittings, staff, field row and their power and light. It doesn't touch
 * 912,908 or any other tile, so it's safe to run while Adequate! still stands there.
 *
 * With `--adequate x,y` it first moves Adequate! onto that tile, then turns 912,908 into the
 * dealership's facade:
 *
 *   - Adequate!'s facade takes the new tile's id, the way Any Port and The Slip moved. Its rooms,
 *     map, door, furniture, connection files and Bettine Halm keep their ids and follow it.
 *   - The door faces the road beside the new tile. If that isn't south, the sales floor's way
 *     out, its connection file and its door turn with it.
 *   - Every other tile's exit into the new facade is removed, so the street door is the only door.
 *
 * It's idempotent: run again with the same tile and nothing changes. To move Adequate! a second
 * time, give the new tile; the tile it leaves isn't put back (restore that one file from git).
 *
 * Afterwards: `node scripts/content/mint-connections.mjs --write`, `npm run content:lint`, and
 * after an import `node scripts/snapshot-flight-world.mjs`, `npm run shapes:bake`, `npm run lite:bake`.
 *
 * The room is laid out from DEALER_PLAN (client/shared/dealer-display.js), the numbers the GLASS
 * arm builds its glass box from, so the rooms fit the model and a change to one is a change to both.
 */
import fs from 'node:fs';
import path from 'node:path';
import { authorBuilding, loadContentStore, OPPOSITE, VENDOR_GRAPH } from './halcyon/lib.mjs';
import { DEALER_BAYS, DEALER_PLAN } from '../../client/shared/dealer-display.js';

const DRY = process.argv.includes('--dry-run');
const argOf = (flag) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : null; };
const MOVE = argOf('--adequate');
const real = loadContentStore();
const tile = (x, y) => `zone_district_${x}_${y}`;

const NAME = 'Higher Purchase', TRADE = 'HOVER CARS', SLUG = 'dealer_marrow';
const X = 912, Y = 908, FACADE = tile(X, Y), STREET = tile(X, Y + 1);
const SHOWROOM = `zone_${SLUG}_showroom`, PLANT = `zone_util_${SHOWROOM}`, FIELD = `af_${SLUG}`;
const SALES = 'npc_lucian_varney', TECH = 'npc_marlowe_dax', HOME = 'zone_kestrel_7b';
const GARAGE = 'zone_seam_914_908';

// ── 1. ADEQUATE! MOVES ──────────────────────────────────────────────────────────────────────
const DIRS = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
// The street-level tile at a grid square. A tile's id needn't say where it is (zone_lot_912_913), and the
// drains under the streets share the square one level down.
const groundAt = (x, y) => real.all('zones').find((z) => z.map_id === 'map_world' && z.grid_x === x && z.grid_y === y && (z.grid_z ?? 0) === 0) || null;
if (MOVE) {
  const [tx, ty] = MOVE.split(',').map(Number);
  if (!Number.isInteger(tx) || !Number.isInteger(ty)) throw new Error('--adequate wants x,y');
  const from = real.all('zones').find((z) => z.map_id === 'map_world' && z.flags?.building_name === 'Adequate!' && z.flags?.facade);
  const to = groundAt(tx, ty);
  if (!to) throw new Error(`no street-level tile at ${tx},${ty}`);
  if (from && from.id !== to.id) {
    if (to.flags?.is_building) throw new Error(`${to.id} is already a building (${to.name})`);
    // the door faces the first road beside the new tile, south for choice
    const door = ['south', 'north', 'east', 'west'].find((d) => groundAt(tx + DIRS[d][0], ty + DIRS[d][1])?.flags?.terrain === 'road');
    if (!door) throw new Error(`${to.id} has no road beside it`);
    const street = groundAt(tx + DIRS[door][0], ty + DIRS[door][1]).id;
    const was = from.flags.entrance, entry = from.exits[OPPOSITE[was]];
    // the facade's content, on the new tile's id and place
    const flags = { ...from.flags, entrance: door, world_exit_zone: street, district: to.flags?.district && to.flags.district !== 'wasteland' ? to.flags.district : from.flags.district };
    real.put('zones', { ...from, id: to.id, grid_x: to.grid_x, grid_y: to.grid_y, grid_z: to.grid_z ?? 0,
      exits: { [door]: street, [OPPOSITE[door]]: entry }, flags });
    // its rooms follow it, and the entry room's way out turns to face the new door
    for (const z of real.all('zones')) {
      if (z.parent_zone !== from.id && z.flags?.world_exit_zone !== from.id) continue;
      if (z.id === from.id || z.map_id === 'map_world') continue;
      const exits = { ...z.exits };
      for (const [d, t] of Object.entries(exits)) if (t === from.id) { delete exits[d]; exits[z.id === entry ? door : d] = to.id; }
      real.patch('zones', z.id, { parent_zone: z.parent_zone === from.id ? to.id : z.parent_zone, exits,
        flags: { ...z.flags, ...(z.flags?.world_exit_zone === from.id ? { world_exit_zone: to.id } : {}) } });
    }
    for (const m of real.all('maps')) if (m.parent_zone_id === from.id) real.patch('maps', m.id, { parent_zone_id: to.id });
    for (const c of real.all('connections')) {
      if (c.a !== from.id && c.b !== from.id) continue;
      if (c.a !== entry && c.b !== entry) continue;          // only the link to its own sales floor
      real.patch('connections', c.id, { a: c.a === from.id ? to.id : c.a, b: c.b === from.id ? to.id : c.b,
        dir: c.a === entry ? door : OPPOSITE[door] });
    }
    for (const d of real.all('doors')) {
      if (d.zone_id === entry && d.target_zone === from.id) real.patch('doors', d.id, { target_zone: to.id, exit_dir: door });
    }
    const pz = real.get('power_zones', from.id);
    if (pz && !real.get('power_zones', to.id)) real.patch('power_zones', to.id, { ...pz, id: to.id });
    // the tile it leaves is bare ground with its street door, until the dealership is written onto it below
    real.put('zones', { ...from, name: 'Marrow Street', description: 'A cleared plot on the corner of Marrow Street and Meltwater Row.',
      ambient_events: [], marker: null, exits: { [was]: from.exits[was] },
      flags: { district: from.flags.district, region_id: from.flags.region_id } });
    // the street's link back at the door, and no other way in
    for (const z of real.all('zones')) {
      if (z.map_id !== 'map_world' || z.id === to.id) continue;
      const exits = { ...(z.exits || {}) };
      let changed = false;
      for (const [d, t] of Object.entries(exits)) if (t === to.id && z.id !== street) { delete exits[d]; changed = true; }
      if (z.id === street && exits[OPPOSITE[door]] !== to.id) { exits[OPPOSITE[door]] = to.id; changed = true; }
      if (changed) real.patch('zones', z.id, { exits });
    }
    console.log(`Adequate! moves ${from.grid_x},${from.grid_y} -> ${tx},${ty}, door ${door} onto ${real.get('zones', street).name}`);
  }
}

// ── 2. THE DEALERSHIP ───────────────────────────────────────────────────────────────────────
// Without --adequate, 912,908 is still somebody's, so only the dealership's own rows are written.
const still = real.get('zones', FACADE)?.flags?.building_name;
const WHOLE = !!MOVE && still !== 'Adequate!';
const own = (id) => id.startsWith(`zone_${SLUG}_`) || id.startsWith(`zone_util_zone_${SLUG}_`);
const store = WHOLE ? real : new Proxy(real, { get(t, k) {
  if (k !== 'patch') return typeof t[k] === 'function' ? t[k].bind(t) : t[k];
  return (table, id, data) => {
    if (table === 'zones' && !own(id)) return;
    if (table === 'connections' && (!own(data?.a || '') || !own(data?.b || ''))) return;
    return t.patch(table, id, data);
  };
} });

// The room, from the model's plan. u runs along the front wall and v back from it, in metres.
const P = DEALER_PLAN, M = P.tileM;
const W = +((P.x1 - P.x0) * M).toFixed(2), D = +((P.yFront - P.yBack) * M).toFixed(2), H = +((P.ceil - P.floor) * M).toFixed(2);
const XMID = (P.x0 + P.x1) / 2;
// ⚠ SEEN FROM INSIDE, facing the street, the party wall is on the left: the room's +u is the arm's -x.
const U = (x) => +(-(x - XMID) * M).toFixed(2), V = (y) => +((P.yFront - y) * M).toFixed(2);
const display = DEALER_BAYS.map((bay) => {
  const t = P.tables[bay.where];
  return { bay: bay.where, at: [U(t.at[0]), V(t.at[1])], r: +(P.tableR * M).toFixed(2), h: 0.14,
    turn: Math.round(Math.atan2(-t.nose[0], t.nose[1]) * 180 / Math.PI) };
});
const doorU = U(P.doorX), glassSide = 'right';   // the arm's -x, the other street
const room = {
  w: W, d: D, h: H, face: 180, studio: false, balcony: false, finish: 'fine', ground: 'stone',
  // ⚠ A DOOR IS PLACED ALONG THE WORLD'S AXIS, not the room's u: east is positive on a south wall, so it's the
  //    arm's own x. The panes beside it are in u, which runs the other way.
  doors: { south: +((P.doorX - XMID) * M).toFixed(2) },
  street_door: { kind: 'sliding', w: +(P.doorHalf * 2 * M).toFixed(2), glass: '#9fc4d4', trim: '#5c646c' },
  panes: [
    { wall: 'front', a: +(doorU + 1.2).toFixed(2), b: +(W / 2 - 0.15).toFixed(2), y0: 0.05, y1: +(H - 0.35).toFixed(2) },
    { wall: glassSide, a: 0.15, b: +(D - 0.3).toFixed(2), y0: 0.05, y1: +(H - 0.35).toFixed(2) },
  ],
  tone: { wall: '#2b2e34', ceiling: '#e9eaec', trim: '#aab2ba', accent: '#d6e8ff' },
  display,
  decor: {
    rug: false,
    strips: [-4.6, 0, 4.6].flatMap((u) => [2.6, 7.4].map((v) => ({ along: 'u', at: [u, v], len: 2.4 }))),
    signs: [
      { wall: 'back', along: 0, y: +(H - 0.75).toFixed(2), h: 0.34, text: NAME.toUpperCase(), hex: '#e8f4ff', lit: true, plate: true, plateHex: '#14161a' },
      ...DEALER_BAYS.filter((b) => 'cd'.includes(b.where)).map((bay) => ({
        wall: 'back', along: U(P.tables[bay.where].at[0]), y: 2.9, h: 0.26, text: bay.maker.toUpperCase(),
        hex: '#' + bay.line.map((v) => v.toString(16).padStart(2, '0')).join(''), lit: true, plate: true, plateHex: '#14161a' })),
      { wall: 'left', along: 8.9, y: 2.3, h: 0.12, text: 'STAFF ONLY', hex: '#f2efe4', plate: true, plateHex: '#3a3f46' },
    ],
    doors: [{ wall: 'left', at: 8.9, w: 1, finish: 'steel' }],
  },
};

// What each turntable says, in the text world. The cars themselves are docs/proposals/hover-cars.md.
const BAY_TEXT = {
  Corvane: 'A Corvane Merlin in red on a turntable ringed in violet: a low wedge with gull-wing doors and four fans where the wheels would be. A card on a stand gives the price and says HIRE BY THE HOUR.',
  Castellan: 'A Castellan Wraith on a turntable ringed in teal: a long bonnet, a cab set well back and a fastback tail, in dark green over tan hide. The card says every one is built to order.',
  Brakk: 'A Brakk Wolverine on a turntable ringed in white: square, wide and orange, with the biggest fans in the room and the weld seams left showing. The card says FREIGHT FANS, FOUR OF THEM.',
  Vex: 'A Vex Hornet on a turntable ringed in magenta: a tall little car in mint green with glass most of the way round. The card lists its insurance band, which is the lowest there is.',
};
const CAR_WORD = { Corvane: 'merlin', Castellan: 'wraith', Brakk: 'wolverine', Vex: 'hornet' };

const spec = {
  slug: SLUG, name: NAME, type: 'vtol_dealer', roomName: NAME,
  x: X, y: Y, entrance: 'south', floors: 2, marker: 'HP', district: 'marrow',

  facade: {
    bgColor: '#161a20', color: '#d6e8ff',
    description: 'A glass showroom on the corner of Marrow Street and Meltwater Row, under a thin white roof with a black sign band. Four hover cars stand on turntables behind the glass. A fifth is clamped nose-up on a pylon over the corner, and there is a landing pad on the roof. The doors are <b>north</b>.',
  },

  rooms: [
    { key: 'showroom', name: 'Showroom', floor: 'stone',
      description: 'A white floor under a high ceiling, with glass on two sides. Four hover cars stand on low turntables, one from each maker, each ringed in its maker\'s colour. The sales desk is at the back, beside the lift up to the roof pad. Marrow Street is <b>south</b> through the glass doors.',
      window: {
        name: 'the showroom glass',
        description: 'Floor-to-ceiling glass along Marrow Street and round the corner onto Meltwater Row. People slow down on the pavement to look at the cars, and the cars are angled so they can.',
        light: 0.95, visibility: 0.95,
      } },
  ],

  utility: {
    name: 'Plant Room', floor: 'concrete',
    description: 'A low concrete room under the showroom. The building\'s junction box is on one wall and the charger switchgear on the other, in grey cabinets that hum. A cable tray runs up through the ceiling to the roof pad.',
  },

  props: [
    { key: 'desk', room: 'showroom', name: 'the sales desk', objectType: 'fixture',
      description: 'A long white desk with a dark top, a screen at one end and a tray of key cards at the other. A brochure for each maker is fanned out along the front edge.',
      flags: { aliases: 'desk,sales desk,counter,brochures,key cards', interactions: ['lean'], dealer_desk: true,
        look: { arche: 'surface', form: 'reception', dims: [3, 0.8, 1.05], dress: 'hotel' }, spot: { at: [0.3, +(D - 0.95).toFixed(2)], turn: 180 } } },
    { key: 'drawer', room: 'showroom', name: 'the desk drawer', objectType: 'fixture',
      description: 'A locked steel drawer under the sales desk, for deposits and spare key cards.',
      flags: { aliases: 'drawer,desk drawer,cash drawer', vendor_safe: true, vendor_npc_id: SALES, hack_difficulty: 4 } },
    ...DEALER_BAYS.map((bay) => ({ key: `bay_${bay.where}`, room: 'showroom', name: `the ${bay.maker} turntable`, objectType: 'decoration',
      description: BAY_TEXT[bay.maker],
      flags: { aliases: `${bay.maker.toLowerCase()},${bay.maker.toLowerCase()} turntable,turntable,plinth,${CAR_WORD[bay.maker]}` } })),
    { key: 'lift', room: 'showroom', name: 'the car lift', objectType: 'decoration',
      description: 'A steel door in the back wall, wide enough for a car, with PAD lit over it. It takes a car from the floor to the roof and brings one down for service.',
      flags: { aliases: 'lift,car lift,lift door,pad' } },
    { key: 'chairs', room: 'showroom', name: 'the waiting chairs', objectType: 'furniture',
      description: 'Two low leather chairs and a glass table by the window, where people sit while the paperwork is done.',
      flags: { aliases: 'chairs,chair,waiting chairs,table', interactions: ['sit'] } },
  ],
};
const ids = await authorBuilding(store, spec);

// The showroom is the field's own room: it names the facade as its ramp, so the flight plugin's
// counter is dealt on the way in and `buy`, `rent`, `sell` and `hangaract` work at the desk.
const sz = real.get('zones', SHOWROOM);
real.patch('zones', SHOWROOM, { name: `${NAME} Showroom`, bg_color: '#161a20', color: '#d6e8ff',
  ambient_events: [
    'A turntable creeps round a few degrees and stops.',
    'Somebody on the pavement cups their hands against the glass to look in.',
    'The lift behind the desk hums up to the roof and comes back down.',
  ],
  flags: { ...sz.flags, hangar_interior: true, hangar_ramp: FACADE, room } });
real.patch('zones', PLANT, { name: `${NAME} Plant Room` });
real.patch('furniture', `furn_light_${SHOWROOM}`, { name: 'the showroom lights',
  description: 'Rows of white light battens in the ceiling, and a spot over each turntable.' });
real.patch('airfields', FIELD, { id: FIELD, name: NAME, dealer: true, rental: true, charter: false, charter_vtol_only: false,
  vtol_only: true, fuels: ['charge'], lawless: false, residents_only: null, surface: null, theme: null });

// ── 3. THE STAFF ────────────────────────────────────────────────────────────────────────────
const HOURS = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [{ from: 8, to: d === 'sun' ? 17 : 20 }]]));
const person = (id, o) => real.patch('npcs', id, {
  id, name: o.name, sex: o.sex, description: o.description, npc_type: 'vendor', faction: null, hp: o.hp, hp_max: o.hp,
  home_zone: HOME, work_zone_id: SHOWROOM, behaviour_graph: VENDOR_GRAPH, dialogue_tree: o.dialogue,
  chitchat: o.chitchat, banter: [], home_activities: [],
  flags: { ...(real.get('npcs', id)?.flags || {}), clothing_layers: o.clothing, personality: o.personality, ...(o.post ? { post: o.post, post_gap: 0.5 } : {}) },
  vendor_shop_name: NAME, vendor_inventory: [], vendor_schedule: HOURS, vendor_restock_rate: 0, vendor_stock_size: 0,
  studio_zone_id: null, wander_zones: [], wanders: 0,
});
person(SALES, {
  name: 'Lucian Varney', sex: 'male', hp: 22, personality: 'vendor', post: `furn_${SLUG}_desk`,
  description: 'A tall man in a grey suit with no tie and very clean shoes. He stands with his hands behind his back until you look at a car for more than a few seconds, and then he is beside you.',
  clothing: ['a grey two-button suit', 'a white open-collar shirt', 'polished black shoes', 'grey boxers'],
  chitchat: [
    '"Sit in it. It costs nothing to sit in it."',
    'wipes a fingerprint off the Merlin\'s door with his cuff',
    '"The Hornet\'s the one people buy. The Merlin\'s the one they come in to look at."',
    'straightens the brochures on the desk so the edges line up',
    '"Hire one for an hour first. Most people are back before the hour\'s up, asking about colours."',
    'watches somebody on the pavement look at the cars, and waits',
  ],
  dialogue: {
    root: {
      text: ['"Which one are you looking at?"', '"Take your time. They\'re not going anywhere."'],
      text_by_relation: {
        first: '"Lucian Varney. Four makers, one of each on the floor, and they all fly." He nods at the turntables. "Have a look round."',
        known: '"Back again." He looks pleased about it. "Same one, or have you changed your mind?"',
        familiar: '"There you are. How\'s she flying?"',
      },
      options: [
        { label: 'What have you got?', next: 'makers' },
        { label: 'How do I buy one?', next: 'buying' },
        { label: 'Can I try one first?', next: 'hire' },
        { label: 'Where do I keep it?', next: 'parking' },
        { label: 'Do you buy them back?', next: 'selling' },
        { label: 'Just looking.', next: 'bye', enabled: true, actions: [], conditions: [] },
      ],
    },
    makers: {
      text: '"The Corvane Merlin\'s the fast one. The Castellan Wraith goes furthest, the Brakk Wolverine\'s built like a dock crane, and the Vex Hornet turns on the spot. Same price, all four." He shrugs. "Pick the one you like looking at."',
      options: [{ label: 'How do I buy one?', next: 'buying' }, { label: 'Back up.', next: 'root' }],
    },
    buying: {
      text: '"At the desk. <b>buy</b> shows you the list and <b>buy merlin</b> buys you one. She\'s on the roof pad by the time you\'ve signed. You\'ll need a licence to fly her off it."',
      options: [{ label: 'Where do I keep it?', next: 'parking' }, { label: 'Back up.', next: 'root' }],
    },
    hire: {
      text: '"<b>rent</b> one. You pay for the hour and bring her back to the pad. If you like her, we talk."',
      options: [{ label: 'Back up.', next: 'root' }],
    },
    parking: {
      text: '"Marrow Street Parking, next door. Land on their roof, <b>garage park</b>, and keep the ticket. It\'s free, which is why we built here."',
      actions: [{ action: 'GPS_TO', zone: GARAGE }],
      options: [{ label: 'Back up.', next: 'root' }],
    },
    selling: {
      text: '"We do. Land her on the pad, come down, and <b>sell</b> at the desk. You won\'t get what you paid."',
      options: [{ label: 'Back up.', next: 'root' }],
    },
    bye: { text: '"I\'ll be here."', options: [] },
  },
});
person(TECH, {
  name: 'Marlowe Dax', sex: 'female', hp: 24, personality: 'gruff',
  description: 'A short woman in grey overalls with a charge meter clipped to one pocket and a rag in the other. Her forearms are freckled with small burns. She looks at the cars the way other people look at a kettle that is about to boil.',
  clothing: ['grey zip-front overalls with the sleeves pushed up', 'a black vest', 'black work boots', 'grey briefs'],
  chitchat: [
    'crouches by a fan duct and turns a blade a few degrees with one finger',
    '"Don\'t lean on that one. It\'s just been polished and he\'ll blame me."',
    'reads the charge meter, taps it, and reads it again',
    '"They all take the same charge. Whatever he tells you about range, halve it in the cold."',
    'wipes her hands on the rag and puts it back in the same pocket',
  ],
  dialogue: {
    root: {
      text: ['"If it\'s about buying, that\'s him at the desk."', '"Mind the turntable. It moves."'],
      text_by_relation: {
        first: '"Marlowe. I keep them charged and I fix what people bring back." She looks at your hands. "You fly?"',
        known: '"You again. Anything broken?"',
        familiar: '"Bring her round to the pad if she\'s pulling. I\'ll have a look."',
      },
      options: [
        { label: 'Which one would you buy?', next: 'pick' },
        { label: 'Can you fix mine?', next: 'fix' },
        { label: 'Never mind.', next: 'bye', enabled: true, actions: [], conditions: [] },
      ],
    },
    pick: {
      text: '"The Wolverine. It\'s ugly and nothing on it is hard to get at." She nods at the Merlin. "That one\'s lovely until you have to change a fan."',
      options: [{ label: 'Back up.', next: 'root' }],
    },
    fix: {
      text: '"Land her on the roof pad and ask at the desk. <b>repair</b> for the hull, <b>refuel</b> for charge. I do the work, he does the bill."',
      options: [{ label: 'Back up.', next: 'root' }],
    },
    bye: { text: '"Right."', options: [] },
  },
});
// They share The Flute 7B, two doors along. The row names Lucian; Marlowe shares his home_zone.
real.patch('npc_residences', HOME, { zone_id: HOME, npc_id: SALES, note: null });

// ── 4. THE FACADE, once the tile is free ─────────────────────────────────────────────────────
if (WHOLE) {
  const f = real.get('zones', FACADE);
  real.patch('zones', FACADE, {
    ambient_events: [
      'The cars behind the glass catch the light as a cloud moves off.',
      'A hover car settles onto the roof pad and its fans wind down.',
      'Somebody stops on the corner to look up at the car on the pylon.',
    ],
    flags: { ...f.flags, sign_trade: TRADE, airfield_id: FIELD, hangar_interior_zone: SHOWROOM, dealer_stock: 'hover_car' },
  });
  // The garage next door named its old neighbour.
  const g = real.get('zones', GARAGE);
  if (g?.description?.includes('between Adequate! and The Flute')) {
    real.patch('zones', GARAGE, { description: g.description.replace('between Adequate! and The Flute', `between ${NAME} and The Flute`) });
  }
}

const written = real.flush({ dryRun: DRY });
if (DRY) for (const w of written) console.log('  ' + path.relative(process.cwd(), String(w.file || w.path || w)));
// `authorBuilding` writes a `conn_hf_*` file for the plant room's stair; authorUtilityRoom's own covers the pair.
const removed = [];
{
  const dir = path.join(real.baseDir, 'connections');
  const mine = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.startsWith(`conn_util_${SHOWROOM}_`)) : [];
  const dup = path.join(dir, `conn_hf_${SLUG}_showroom_down.json`);
  if (mine.length && fs.existsSync(dup)) { if (!DRY) fs.unlinkSync(dup); removed.push(path.basename(dup)); }
}
console.log(`${DRY ? 'DRY RUN: ' : ''}${written.length} file(s) written${removed.length ? `, ${removed.length} duplicate connection dropped` : ''}`);
console.log(WHOLE ? `  facade ${ids.facadeId}  map ${ids.mapId}  utility ${ids.utilityRoomId}`
  : `  rooms only: ${FACADE} is still ${still || 'open ground'}. Run again with --adequate x,y to move it and write the facade.`);
console.log('\nnext:\n  node scripts/content/mint-connections.mjs --write\n  npm run content:lint');
