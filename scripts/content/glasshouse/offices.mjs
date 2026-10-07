/**
 * The Glasshouse as Halcyon's quarter: a new office building on the boulevard and four new
 * department floors in Halcyon Towers.
 *
 *   - Halcyon Trade Office (893,904) replaces Fallow Provisions, which was placeholder content: an
 *     unnamed shopkeeper with no stock, generic rooms and a grassland description. Merrow (the
 *     consignment broker) and Corbin Estes (freight futures) move here from the Towers lobby,
 *     where they were standing for want of anywhere else.
 *   - Towers floors 53–56 are Developments, Logistics, Personnel and Security. The residences move
 *     up to 57 and the Executive Suite to 58, so it stays the top of the tower. Nothing quotes those
 *     two numbers; the receptionist's directory is rewritten here.
 *
 * Security is a floor rather than a building because the only empty Glasshouse plot that fronts a
 * road (892,904) is also the approach to The Vats' front door, and building on it sealed the Vats.
 *
 * Fired & Forgotten and Negative Equity stay what they are: Slake's quests start in the kiln and
 * Benedetta Salis's studio is the Ascendant conversion's last portrait. Aurelia stays a couture
 * house, and its facade loses the grassland text it had by mistake.
 *
 * Run after removing the placeholder's files (its rooms, keeper, map, door and power rows):
 *
 *   node scripts/content/glasshouse/offices.mjs [--dry-run]
 *   node scripts/content/mint-connections.mjs --write
 *   npm run content:lint
 */
import { authorBuilding, loadContentStore, SHOP_HOURS, VENDOR_GRAPH } from '../halcyon/lib.mjs';

const DRY = process.argv.includes('--dry-run');
const store = loadContentStore();
const GH = 'glasshouse';

const clothes = (...layers) => layers;

// ── Halcyon Trade Office ──────────────────────────────────────────────────────────────────────
const trade = {
  slug: 'gh_trade', name: 'Halcyon Trade Office', type: 'corporate_office',
  x: 893, y: 904, entrance: 'east', floors: 3, marker: 'HX', district: GH,
  facade: {
    bgColor: '#141a24', color: '#cfe6f4',
    description: 'A narrow glass front on the boulevard, three storeys of it, with the Halcyon eye etched into the door and a strip of freight prices running green along the fascia. Through the glass there is a counter, and two people behind it who look up together when the door opens.',
  },
  rooms: [
    { key: 'counter', name: 'Front Counter', floor: 'stone',
      description: 'A long counter of pale stone, with two chairs on the customer side set lower than the two behind it. The wall at the back is pigeonholes, each with a manifest folded into it and a coloured tag clipped to the fold. Merrow works the counter, turning cargo with no history into cargo with a good one.',
      window: { name: 'the glass front', description: 'Floor-to-ceiling glass onto Halcyon Boulevard, etched with the Halcyon eye at chest height.', light: 0.85, visibility: 0.9 } },
    { key: 'floor', name: 'Trading Room', floor: 'carpet', from: 'counter', dir: 'west',
      description: "A low room with no windows and six screens on the far wall, each showing a ship with a price beside it that moves. Corbin Estes has a desk here and, on paper, owns most of what is on the screens. The coffee is excellent and nobody has ever seen it delivered." },
  ],
  utility: { name: 'Plant Room', floor: 'concrete', description: 'A cupboard of humming switchgear behind a door marked PRIVATE. The junction box is bolted beside the door, and a small sealed hacking port sits below the latch.' },
  lights: {
    floor: { name: 'screen glow', lumens: 900, description: 'No lamps at all: the six screens light the room, and the light changes when the prices do.' },
  },
  props: [
    { key: 'pigeonholes', room: 'counter', name: 'pigeonholes', objectType: 'fixture',
      description: 'Ninety-six pigeonholes in pale wood, every one with a manifest in it. The tags are green for cleared, amber for pending and red for a cargo that is about to have a different history.' },
    { key: 'ticker', room: 'floor', name: 'freight screens', objectType: 'fixture',
      description: 'Six screens, six ships, six prices. Two of the ships are in the Basin. One of them has been at sea for four years and its price has gone up every one of them.' },
    { key: 'chairs', room: 'counter', name: 'low chairs', objectType: 'furniture', flags: { interactions: ['sit'] },
      description: 'Two leather chairs a hand lower than the ones across the counter. Sitting in one puts your eyes level with the stamp.' },
  ],
};

// ── The new Towers floors ─────────────────────────────────────────────────────────────────────
const MAP = 'map_int_halcyon', TOWERS = 'zone_district_895_906', CAR = 'zone_halcyon_elevator';
const GEN = 'gen_zone_util_zone_halcyon_lobby_1783455594534';
const FLOORS = [
  { n: 53, z: 5, id: 'zone_halcyon_developments', label: 'Developments — Head Office',
    name: 'Halcyon Developments — Head Office',
    description: 'The whole of Halcyon Fields stands on a table down the middle of the room, in white card at one to five hundred. Every finished tower is a block. Every unfinished one has an amber pin in it, and there are eleven. People with rolled drawings talk quietly into headsets about completion dates, and nobody looks at the pins.',
    npc: { id: 'npc_halcyon_thrale', name: 'Imogen Thrale', sex: 'female', home: 'zone_halcyon_apt_e',
      description: 'A tall woman in a pale suit with a laser pointer in her breast pocket like a pen. She is the Director of Land, and she stands at the model the way other people stand at a window.',
      clothing: clothes('a pale linen suit with a laser pointer clipped in the breast pocket', 'a silk shell top', 'plain white underwear'),
      chitchat: ['She moves a card tower a quarter-inch and steps back to look at it.', '"Every plot sells twice. Once off the plan and once when it is finished. The trick is the gap."', 'She does not look at the amber pins. It looks like practice.'],
      dialogue: {
        root: { text: '"You will be from the estate, or you are lost." She does not take her eyes off the model.',
          options: [{ label: 'What is all this?', next: 'model' }, { label: 'What are the amber pins?', next: 'pins' }, { label: 'Just looking.', next: 'bye' }] },
        model: { text: '"Halcyon Fields. Sixty-odd buildings on what used to be allotments and a gas works." She runs the pointer along a street of white card. "Every street is a meadow plant. Buyers like a meadow. Nobody has ever asked to live on Gasworks Lane."',
          options: [{ label: 'Back.', next: 'root' }] },
        pins: { text: '"Plots." A short pause. "Each one is a building that sold before it was finished and is now waiting for the market to remember it. They will all complete." She says it the way people say grace.',
          options: [{ label: 'Back.', next: 'root' }] },
        bye: { text: 'She goes back to the model.', options: [] },
      } },
  },
  { n: 54, z: 7, id: 'zone_halcyon_logistics', label: 'Logistics — Dispatch',
    name: 'Halcyon Logistics — Dispatch',
    description: 'Screens on three walls show the Basin as a dark field crossed by thin lines, each one a convoy with a Halcyon number. A dispatcher works a horseshoe desk with four handsets, one at a time. The board by the door lists the day\'s movements under ARRIVED and EXPECTED, and the second column is always longer.',
    npc: { id: 'npc_halcyon_kerrigan', name: 'Tomas Kerrigan', sex: 'male', home: 'zone_halcyon_apt_b',
      description: 'A heavy, patient man with a headset round his neck and three more on the desk, all live. He talks to drivers he has never met as if he has known them for years, and he has.',
      clothing: clothes('a rumpled white shirt with the sleeves rolled to the elbow', 'grey suit trousers', 'cotton boxers'),
      chitchat: ['"Copy, Seven. Hold at the Glacis and wait for the weigh."', 'He drags a convoy line a little further west on the screen with one finger.', '"Expected is a promise. Arrived is a fact. I live between the two."'],
      dialogue: {
        root: { text: '"If you are a driver, you are on the wrong floor. Drivers go to the depots." He holds up a finger, answers a handset, puts it down. "Go on."',
          options: [{ label: 'What does Halcyon move?', next: 'move' }, { label: 'Is there work?', next: 'work' }, { label: 'Bye.', next: 'bye' }] },
        move: { text: '"Everything that is insured. Which is everything." He nods at the lines. "Freight, fuel, water when the city runs short, people when they have the paperwork. If it moves in the Basin and somebody is worried about it, it has one of our numbers."',
          options: [{ label: 'Back.', next: 'root' }] },
        work: { text: '"Contract work is on the board in the lobby, paid the same day. Driving goes through the depots: buy a rig, take a load. I just watch the lines and shout at them."',
          options: [{ label: 'Back.', next: 'root' }] },
        bye: { text: 'He is already on a handset.', options: [] },
      } },
  },
  { n: 55, z: 8, id: 'zone_halcyon_personnel', label: 'Personnel — Recruitment',
    name: 'Halcyon Personnel — Recruitment',
    description: 'A waiting room with a ticket machine, forty chairs bolted in rows and a display over the counter showing the number being served, which has not changed since you came in. The posters show smiling staff under the Halcyon eye and the words A CAREER YOU CAN INSURE. One window is open, and the woman behind it is reading.',
    npc: { id: 'npc_halcyon_ashdown', name: 'Wren Ashdown', sex: 'female', home: 'zone_halcyon_apt_e',
      description: 'A neat woman behind the one open window, with reading glasses on a chain and a paperback held below the counter where she thinks nobody can see it.',
      clothing: clothes('a navy cardigan over a white blouse, glasses on a chain', 'a grey pleated skirt', 'plain cotton underwear'),
      chitchat: ['She turns a page below the counter.', 'The display over the counter clicks, considers it, and stays on 114.', '"Take a ticket. It helps."'],
      dialogue: {
        root: { text: '"Number?" She looks over her glasses.',
          options: [{ label: 'I want to work for Halcyon.', next: 'job' }, { label: "What's the ticket machine for?", next: 'ticket' }, { label: 'Never mind.', next: 'bye' }] },
        job: { text: '"Everyone does. A permanent post needs a referee, a fixed address and a surname, and you will forgive me if I guess." She slides a leaflet across. "Casual contracts are on the board in the Grand Lobby, paid the same day at Underwriting. That is how most of them start."',
          options: [{ label: 'Thanks.', next: 'bye' }] },
        ticket: { text: '"Morale."', options: [{ label: 'Back.', next: 'root' }] },
        bye: { text: 'The paperback comes back up.', options: [] },
      } },
  },
  { n: 56, z: 9, id: 'zone_halcyon_security', label: 'Security — Control',
    name: 'Halcyon Security — Control',
    description: 'Thirty screens in a curved bank, each a view of somewhere in the Glasshouse: the boulevard, the quay, the Grand Lobby, a corridor that could be anywhere. Two officers watch them in silence. A desk by the lift has a slot for passes and a reader that beeps at most of them. One of the screens shows this room.',
    npc: { id: 'npc_gh_marrack', name: 'Sergeant Ilse Marrack', sex: 'female', home: 'zone_halcyon_apt_b',
      description: 'A compact woman in Halcyon grey with a sergeant\'s bar on the collar and a pass reader clipped to her belt. She looks at your hands first and your face second.',
      clothing: clothes('a grey Halcyon security tunic with a sergeant\'s collar bar', 'charcoal trousers with a pass reader on the belt', 'plain black underwear'),
      chitchat: ['She reads a pass, turns it over, reads the back, and hands it to nobody in particular.', '"Visitors keep to the boulevard. It is a short walk and a long day if you do not."', 'She glances at the feed from the quay and makes a note without looking down.'],
      dialogue: {
        root: { text: '"Pass?" She holds out a hand without looking up from the screens.',
          options: [{ label: "I don't have one.", next: 'visitor' }, { label: 'What does Halcyon Security guard?', next: 'guard' }, { label: 'Never mind.', next: 'bye' }] },
        visitor: { text: '"Then you are a visitor. Visitors keep to the boulevard and the arcade, and they do not stand still for long." She looks at you properly for the first time. "That is not a threat. It is the policy. The threat is separate."',
          options: [{ label: 'Understood.', next: 'bye' }] },
        guard: { text: '"Halcyon property. Buildings, people, papers." She taps a screen. "Mostly papers. People steal buildings less often than you would think."',
          options: [{ label: 'Back.', next: 'root' }] },
        bye: { text: 'She goes back to the screens.', options: [] },
      } },
  },
];

const car = store.get('zones', CAR);
const keep = car.flags.elevator_floors.filter((f) => !FLOORS.some((n) => n.id === f.zone));
// The residences and the executive suite move above the new departments.
for (const f of keep) {
  if (f.zone === 'zone_halcyon_residences') f.n = 57;
  if (f.zone === 'zone_halcyon_exec') f.n = 58;
}
const floors = [...keep, ...FLOORS.map((f) => ({ label: f.label, n: f.n, zone: f.id }))].sort((a, b) => a.n - b.n);
const up = [...new Set([...(car.exits.up || []), ...FLOORS.map((f) => f.id)])];
store.patch('zones', CAR, { flags: { ...car.flags, elevator_floors: floors }, exits: { ...car.exits, up } });

const sameShape = store.get('zones', 'zone_halcyon_claims');
for (const f of FLOORS) {
  store.patch('zones', f.id, {
    id: f.id, name: f.name, description: f.description,
    ambient_events: [], ambient_theme: 'indoors', bg_color: sameShape.bg_color, color: sameShape.color,
    exits: { in: CAR }, map_id: MAP, parent_zone: TOWERS, grid_x: 0, grid_y: 0, grid_z: f.z,
    flags: { building_name: 'Halcyon Towers', floor: 'carpet', is_interior: true },
  });
  const tail = f.id.replace(/^zone_halcyon_/, '');
  store.patch('connections', `conn_halcyon_${tail}_in`, { id: `conn_halcyon_${tail}_in`, a: f.id, b: CAR, dir: 'in', blocked: false, lockable: false, one_way: true });
  store.patch('connections', `conn_halcyon_elevator_up_${tail}`, { id: `conn_halcyon_elevator_up_${tail}`, a: CAR, b: f.id, dir: 'up', blocked: false, lockable: false, one_way: true });
  store.patch('power_zones', f.id, { id: f.id, name: f.name, capacity_kw: 1000, max_capacity_kw: 1000, flags: {}, generator_id: GEN, source_type: 'junction_box' });
  store.patch('furniture', `furn_light_${f.id}`, {
    id: `furn_light_${f.id}`, zone_id: f.id, name: 'overhead light', description: 'A recessed overhead light panel.',
    object_type: 'light', light_type: 'overhead', lumen_output: 1300, power_draw_kw: 0.02, price: 0, hp: null, hp_max: null, flags: {},
  });
  const n = f.npc;
  store.patch('npcs', n.id, {
    id: n.id, name: n.name, sex: n.sex, description: n.description, npc_type: 'npc', faction: null, hp: 40, hp_max: 40,
    home_zone: n.home, work_zone_id: f.id, behaviour_graph: VENDOR_GRAPH, dialogue_tree: n.dialogue,
    chitchat: n.chitchat, banter: [], home_activities: [], flags: { clothing_layers: n.clothing, personality: 'official' },
    vendor_shop_name: null, vendor_inventory: [], vendor_schedule: SHOP_HOURS, vendor_restock_rate: 1, vendor_stock_size: 10,
    studio_zone_id: null, wander_zones: [], wanders: 0,
  });
}

// ── The two buildings ─────────────────────────────────────────────────────────────────────────
const built = [];
built.push(await authorBuilding(store, trade));

// Merrow and Corbin Estes work at the Trade Office now.
store.patch('npcs', 'npc_consignor', { work_zone_id: 'zone_gh_trade_counter' });
store.patch('npcs', 'npc_financier', { work_zone_id: 'zone_gh_trade_floor' });

// The receptionist's directory, which named Merrow in the lobby and the residences at 53.
const rec = store.get('npcs', 'npc_halcyon_reception');
const tree = { ...rec.dialogue_tree };
tree.floors = { ...tree.floors, text: '"Fifty is the Halcyon Arcade, with a kiosk for water. Fifty-three is Developments, fifty-four Logistics, fifty-five Personnel, if you are looking for work, and fifty-six Security. Fifty-seven is the Sky Hall Residences: stand in an empty flat and <b>rent</b> to take it."\n\n"Here in the lobby, Quill trades bonds and travel permits and Vane keeps the bar. Merrow has moved to the Trade Office, two doors north."' };
store.patch('npcs', 'npc_halcyon_reception', { dialogue_tree: tree });

// Aurelia's facade carried a grassland description.
store.patch('zones', 'zone_district_895_907', {
  description: 'A slender shaft of glass over a shopfront, with AURELIA in thin gold capitals on the fascia and a single gown on a stand behind the glass. The cornice is deep, the attic set back, and one corner swells into a curved oriel. Ondine Sarraf dresses the people who go to parties on the fifty-eighth floor.',
});

const written = store.flush({ dryRun: DRY });
console.log(`${DRY ? 'would write' : 'wrote'} ${written.length} file(s): ${built.length} buildings, ${FLOORS.length} Towers floors`);
console.log('\nnext:\n  node scripts/content/mint-connections.mjs --write\n  npm run content:lint');
