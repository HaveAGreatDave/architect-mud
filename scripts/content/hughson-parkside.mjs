/**
 * THE TRADES ROUND THE HUGHSON COLISEUM: five ballpark vendors and a cart yard on the plots that
 * touch the park, in place of the five Halcyon buildings that stood there.
 *
 *   node scripts/content/hughson-parkside.mjs [--dry-run]
 *
 * As built in docs/proposals/hughson-coliseum.md (§10). The park (scripts/content/hughson-coliseum.mjs)
 * stands on x 895-897, y 911-913; the plots either side of it on x 894 and x 898 were Halcyon's
 * glass and chrome, and a ballpark wants what a ballpark has outside it: a box office, food, a bar
 * and a souvenir stand.
 *
 * ⚠ WHAT WAS THERE IS SET ASIDE, NOT DELETED, the way the Coliseum's own block was
 * (hughson-coliseum.md §3): each facade moves whole onto `map_set_aside` on row 9, with its id,
 * prose, interiors, furniture and keeper, and its `world_exit_zone` names itself. Keepers who live
 * there carry `flags.set_aside`; anybody who only works there loses the work zone instead.
 *
 * ⚠ HALCYON FIELDS TAKES NO PUNS (building-styles.md §4.6, and David's rule for the quarter). Two of
 * these are the park's own and say so (Coliseum Box Office); the other three carry their keepers'
 * names and say what they sell.
 *
 * ⚠ THE NEW FACADES TAKE NEW IDS, zone_parkside_<x>_<y>, so no set-aside building's identity is
 * reused. Each is an ordinary authorBuilding door with a utility room, a light per room and a
 * `power_zones` row copied from the plot it replaces.
 *
 * Run `node scripts/content/mint-connections.mjs --write` afterwards. Idempotent.
 */
import fs from 'fs';
import path from 'path';
import { authorBuilding, loadContentStore } from './halcyon/lib.mjs';

const DRY = process.argv.includes('--dry-run');
const store = loadContentStore();
const HOLD = 'map_set_aside', HOLD_ROW = 9;
const DISTRICT = 'halcyon_fields';
const oldId = (x, y) => `zone_district_${x}_${y}`;
const newId = (x, y) => `zone_parkside_${x}_${y}`;
const zoneAt = (x, y) => store.all('zones').find((z) => z.map_id === 'map_world' && z.grid_x === x && z.grid_y === y && (z.grid_z ?? 0) === 0);

// ── 1. SET ASIDE WHAT WAS THERE ─────────────────────────────────────────────────────────────
// [x, y, holding grid x]. Row 9 is clear of the Coliseum's block (rows 1-3) and of the sets other
// builds put on rows 5 and 7.
const SITES = [[894, 911, 1], [894, 912, 3], [894, 913, 5], [898, 911, 7], [898, 913, 9]];
const gone = new Set(SITES.map(([x, y]) => oldId(x, y)));
for (const [x, y, gx] of SITES) {
  const id = oldId(x, y), z = store.get('zones', id);
  if (!z) throw new Error(`${id} does not exist`);
  if (z.map_id === HOLD) continue;   // already set aside on an earlier run
  if (z.map_id !== 'map_world') throw new Error(`${id} is on ${z.map_id}; the site has moved since this file was written`);
  const taken = store.all('zones').find((q) => q.map_id === HOLD && q.grid_x === gx && q.grid_y === HOLD_ROW);
  if (taken) throw new Error(`the holding map's ${gx},${HOLD_ROW} is already ${taken.id}`);
  const exits = {};
  for (const [dir, to] of Object.entries(z.exits || {})) {
    const t = store.get('zones', to);
    if (t && t.map_id !== 'map_world' && t.parent_zone === id) exits[dir] = to;   // only the way into its own rooms
  }
  const flags = { ...z.flags, set_aside: true, set_aside_from: `${x},${y}` };
  if (flags.facade) flags.world_exit_zone = id;
  store.put('zones', { ...z, map_id: HOLD, grid_x: gx, grid_y: HOLD_ROW, grid_z: 0, exits, flags });
}
// Their keepers, and anyone who only works there.
{
  const rooms = new Set(store.all('zones').filter((z) => gone.has(z.parent_zone)).map((z) => z.id));
  for (const n of store.all('npcs')) {
    if (rooms.has(n.home_zone) && !n.flags?.set_aside) store.patch('npcs', n.id, { flags: { ...(n.flags || {}), set_aside: true } });
    else if (!rooms.has(n.home_zone) && rooms.has(n.work_zone_id)) store.patch('npcs', n.id, { work_zone_id: null });
  }
}
// Nothing on the world points at a set-aside facade any more; the street connection files go too.
for (const z of store.all('zones')) {
  if (z.map_id !== 'map_world') continue;
  const exits = { ...(z.exits || {}) };
  let changed = false;
  for (const [dir, to] of Object.entries(exits)) if (gone.has(to)) { delete exits[dir]; changed = true; }
  if (changed) store.patch('zones', z.id, { exits });
}
const STREET_CONNS = [];
for (const c of store.all('connections')) {
  const [a, b] = [store.get('zones', c.a), store.get('zones', c.b)];
  if ((gone.has(c.a) && b?.map_id === 'map_world') || (gone.has(c.b) && a?.map_id === 'map_world')) STREET_CONNS.push(c.id);
}

// ── 2. THE TRADES ────────────────────────────────────────────────────────────────────────────
// Game nights are Monday, Wednesday and Friday at six; the food and the bar keep late hours then.
const GAME_LATE = (early, late, sat = []) => ({
  mon: [late], tue: [early], wed: [late], thu: [early], fri: [late], sat, sun: [],
});
const till = (npc) => ({ objectType: 'fixture', flags: { aliases: ['till', 'cash drawer', 'drawer', 'cash'], vendor_safe: true, vendor_npc_id: npc, hack_difficulty: 3 } });
const SPECS = [];

// The Coliseum Box Office, beside the main gate on Sorrel Way.
SPECS.push({
  slug: 'hcbox', utility: { name: 'Cellar', floor: 'concrete', description: 'A low cellar under the ticket hall, old ticket rolls in boxes going soft in the damp and the junction box on the wall by the steps.' }, name: 'Coliseum Box Office', roomName: 'Box Office', type: 'box_office',
  x: 898, y: 913, entrance: 'south', floors: 1, marker: 'TO',
  facade: { bgColor: '#2a1d18', color: '#d8c9a8',
    description: 'A low limestone pavilion beside the Coliseum\'s main gate, three barred ticket windows under a bronze canopy and BOX OFFICE in gilt over them. A queue rail of brass tube runs along the pavement in front.' },
  rooms: [
    { key: 'windows', name: 'Ticket Hall', floor: 'stone',
      description: 'A narrow hall behind the ticket windows, terrazzo underfoot and a brass rail to queue along. The fares are painted on a board over the glass: stands, club, bleachers. A seating plan of the park is framed on the back wall.',
      window: { name: 'the ticket windows', description: 'Three windows onto Sorrel Way, each with a brass grille and a slot worn smooth at the bottom. The Coliseum\'s main gate is next door.', light: 0.5, visibility: 0.6 } },
    { key: 'office', name: 'Counting Room', floor: 'linoleum', from: 'windows', dir: 'north',
      description: 'A back room with a safe, a long table and a rack of ticket rolls in every colour the park uses. A calendar on the wall has the game nights ringed in green pencil.',
      window: null },
  ],
  lights: { office: { name: 'the strip light', description: 'A single tube over the long table, one end gone pink.', lumens: 1200 } },
  props: [
    { key: 'board', room: 'windows', name: 'the fare board', objectType: 'decoration',
      description: 'A painted board over the windows lists the stands, the club and the bleachers, each with a price in cream on green. The bleachers\' price has been painted over twice and is lower each time.',
      flags: { aliases: ['board', 'fare board', 'fares', 'prices'] } },
    { key: 'plan', room: 'windows', name: 'the seating plan', objectType: 'decoration',
      description: 'A framed plan of the park, every section numbered, with section nine hatched out and stamped across in red to say it isn\'t for sale.',
      flags: { aliases: ['plan', 'seating plan', 'section nine', 'map'] } },
    { key: 'till', room: 'windows', name: 'the cash drawer', description: 'A steel drawer under the middle window, chained to the counter.', ...till('npc_hcbox_okafor') },
  ],
  items: [
    { id: 'item_coliseum_ticket', name: 'Coliseum ticket', type: 'misc', value: 12, weight: 2, description: null, flags: {},
      tags: { stackable: true, description: 'A stub off the roll at the Coliseum box office, green for the stands, the date stamped crooked across it. Good for one game, and for arguing with an usher who says otherwise.' } },
    { id: 'item_coliseum_schedule', name: 'pocket schedule', type: 'misc', value: 1, weight: 4, description: null, flags: {},
      tags: { stackable: true, description: 'A folded green card with the season printed inside: Monday, Wednesday and Friday at six, every week. That is the whole schedule, and they print it anyway.' } },
    { id: 'item_coliseum_scorecard', name: 'scorecard and pencil', type: 'misc', value: 2, weight: 10, description: null, flags: {},
      tags: { stackable: true, description: 'A card ruled for nine innings and two line-ups, with a stub of pencil tucked in the fold. The back has a diagram of how to score a double play.' } },
  ],
  npc: {
    id: 'npc_hcbox_okafor', name: 'Bernadette Okafor', sex: 'female', hp: 38,
    homeRoom: 'office', workRoom: 'windows', shopName: 'Coliseum Box Office',
    description: 'A small woman in her sixties in a green cardigan with the Coliseum\'s sunburst on the pocket, half-moon glasses on a chain and a roll of tickets on her wrist like a bracelet. She counts change twice, once for you and once for her.',
    clothing: ['a green cardigan with the Coliseum\'s sunburst on the pocket', 'half-moon glasses on a chain', 'a white blouse', 'a grey wool skirt', 'flat black shoes'],
    schedule: GAME_LATE({ from: 10, to: 17 }, { from: 10, to: 19 }, [{ from: 10, to: 14 }]),
    inventory: [{ item_id: 'item_coliseum_ticket', price: 12 }, { item_id: 'item_coliseum_schedule', price: 1 }, { item_id: 'item_coliseum_scorecard', price: 2 }],
    chitchat: [
      'Okafor tears a ticket off the roll along the perforation without looking.',
      'She stamps a date on a stub, blows on it, and squares it on the counter.',
      'She counts a stack of notes, loses her place at forty, and starts again.',
      'She looks over her glasses at the queue rail as if somebody had leaned on it.',
      'She rings a game night on the calendar in green pencil.',
    ],
    dialogue: {
      root: {
        text: '"Stands, club or bleachers?" She has a ticket half off the roll already.',
        text_by_relation: {
          first: 'The woman behind the glass looks at you over her half-moon glasses.\n\n"Bernadette Okafor. I sell the tickets, and I have sold them since before you were born." She taps the fare board. "Stands, club or bleachers?"',
          known: '"Back again." She is already tearing one off.',
          familiar: '"Stands, behind first, on the aisle." It is on the counter before you ask.',
        },
        options: [
          { label: 'What do you sell?', next: '__shop__' },
          { label: 'When do they play?', next: 'games' },
          { label: 'Why is section nine hatched out?', next: 'nine' },
          { label: 'What does the roof do?', next: 'roof' },
          { label: 'Nothing, thanks.', next: 'bye', enabled: true, actions: [], conditions: [] },
        ],
      },
      games: { text: '"Monday, Wednesday, Friday. First pitch at six, gates at five." She slides a pocket schedule across. "It has been those three nights for forty years. It is printed on the card in case anybody forgets."', options: [{ label: 'Back up.', next: 'root' }] },
      nine: { text: '"Because I do not sell seats that are a hole." She takes her glasses off. "Something came down in it one night. Sir Charles had the numbers kept on the seats, so nobody would forget where it was."', options: [{ label: 'Back up.', next: 'root' }] },
      roof: { text: '"It shuts when it rains and opens when it stops, and it takes its time either way." She nods up at the ceiling. "They put it on after my time started. It cost more than the park did. The park was built to last, so they built the roof to match."', options: [{ label: 'Back up.', next: 'root' }] },
      bye: { text: '"Keep your stub," she says. "They check."', options: [] },
    },
  },
});

// Fitz's Franks, beside the bleacher gate on Halcyon Boulevard.
SPECS.push({
  slug: 'fitzfranks', utility: { name: 'Cellar', floor: 'concrete', description: 'A cellar under the counter, the gas bottles chained to the wall, crates of buns on the steps and the junction box by the hatch.' }, name: 'Fitz\'s Franks', type: 'frank_stand',
  x: 894, y: 911, entrance: 'north', floors: 1, marker: 'FK',
  facade: { bgColor: '#2b1c14', color: '#e7c98e',
    description: 'A white-tiled frank counter on Halcyon Boulevard beside the Coliseum\'s bleacher gate, a red-and-white striped awning over a serving hatch and a frank in a bun lit in neon on the roof. The griddle smoke comes out of a tin chimney.' },
  rooms: [
    { key: 'counter', name: 'Counter', floor: 'tile',
      description: 'A white-tiled room with a steel counter across it and a serving hatch onto the boulevard. Mustard and relish stand in pump jars, the steam cabinet ticks, and a menu board hangs over the griddle.',
      window: { name: 'the serving hatch', description: 'A hatch onto Halcyon Boulevard with a steel shelf for the paper boats. The bleacher gate is next door.', light: 0.7, visibility: 0.7 } },
    { key: 'kitchen', name: 'Kitchen', floor: 'tile', from: 'counter', dir: 'south',
      description: 'A narrow kitchen with a chest freezer, a sink, and crates of buns stacked to the ceiling. A radio on the shelf is tuned to KSAB.',
      window: null },
  ],
  lights: { kitchen: { name: 'the kitchen light', description: 'A caged bulb over the sink, steamed up.', lumens: 900 } },
  props: [
    { key: 'griddle', room: 'counter', name: 'the griddle', objectType: 'furniture',
      description: 'A flat steel griddle the length of the counter, black with use, a row of franks rolling on it and onions going soft at the far end.',
      flags: { aliases: ['griddle', 'franks', 'onions', 'grill', 'steam cabinet'] } },
    { key: 'menu', room: 'counter', name: 'the menu board', objectType: 'decoration',
      description: 'A board over the griddle in hand-painted red: frank, sausage on a roll, cola, lemon soda, beer. Under it, smaller, a note that the Widowmaker is inside and they don\'t do it here.',
      flags: { aliases: ['menu', 'menu board', 'board', 'prices'] } },
    { key: 'till', room: 'counter', name: 'the cash drawer', description: 'A drawer under the hatch with a bell on it that rings every time it opens.', ...till('npc_fitz_rourke') },
  ],
  items: [
    { id: 'item_fitz_frank', name: 'frank', type: 'consumable', value: 5, weight: 170, description: null, flags: {},
      tags: { consumable: true, restore_hunger: 18, stackable: true, description: 'A frank in a steamed bun with mustard down it in a zigzag, wrapped in wax paper that has already given up. From Fitz\'s by the bleacher gate.' } },
    { id: 'item_fitz_sausage', name: 'sausage on a roll', type: 'consumable', value: 7, weight: 240, description: null, flags: {},
      tags: { consumable: true, restore_hunger: 26, stackable: true, description: 'A split sausage on a roll under fried peppers and onions, more onion than roll by the time it reaches you. It leaks down the wrist.' } },
  ],
  npc: {
    id: 'npc_fitz_rourke', name: 'Fitz Rourke', sex: 'male', hp: 44,
    homeRoom: 'kitchen', workRoom: 'counter', shopName: 'Fitz\'s Franks',
    description: 'A tall, stooped man in a paper hat and a striped apron, his sleeves rolled to the elbow and a pair of tongs in one hand at all times. He turns the franks to the crowd noise from next door.',
    clothing: ['a red-and-white striped apron', 'a paper hat', 'a short-sleeved white shirt', 'black work trousers', 'boxer shorts'],
    schedule: GAME_LATE({ from: 11, to: 16 }, { from: 15, to: 22 }, [{ from: 11, to: 15 }]),
    inventory: [{ item_id: 'item_fitz_frank', price: 5 }, { item_id: 'item_fitz_sausage', price: 7 }, { item_id: 'item_arcline_cola', price: 4 }, { item_id: 'item_lemon_soda', price: 4 }, { item_id: 'item_drug_beer', price: 5 }],
    chitchat: [
      'Rourke rolls the franks a quarter turn each with the tongs, one, two, three.',
      'He scrapes the griddle with a steel blade and the smoke goes up the chimney.',
      'A roar comes over the wall from the bleachers. He doesn\'t look up.',
      'He pumps a zigzag of mustard down a frank in one stroke.',
      'He taps the tongs together twice, which seems to mean next.',
    ],
    dialogue: {
      root: {
        text: '"Frank or sausage?" The tongs are already moving.',
        text_by_relation: {
          first: 'The man behind the hatch clicks his tongs at you.\n\n"Fitz. Fitz Rourke. Franks, sausages, something to wash them down." He nods at the gate next door. "Cheaper out here than in there, and I don\'t make you sign anything."',
          known: '"You again. Mustard?"',
          familiar: '"Two franks, mustard, no onion." It is in a boat before you finish the nod.',
        },
        options: [
          { label: 'What do you sell?', next: '__shop__' },
          { label: 'Cheaper than in there?', next: 'ray' },
          { label: 'How long have you been here?', next: 'here' },
          { label: 'Nothing, thanks.', next: 'bye', enabled: true, actions: [], conditions: [] },
        ],
      },
      ray: { text: '"Ray does the Widowmaker inside, with the waiver." He shrugs. "It\'s a good frank. It\'s a lot of frank. Mine is the one you can eat walking up the steps to the bleachers."', options: [{ label: 'Back up.', next: 'root' }] },
      here: { text: '"This plot was glass and a lobby with nobody in it." He waves the tongs at the boulevard. "The crowd walked past it twice a week, three times, and nobody sold them a thing. Now somebody does."', options: [{ label: 'Back up.', next: 'root' }] },
      bye: { text: '"Enjoy the game. Napkins are on the shelf."', options: [] },
    },
  },
});

// Pruitt's Peanuts & Pretzels, on Vetch Mews behind third base.
SPECS.push({
  slug: 'pruitt', utility: { name: 'Cellar', floor: 'concrete', description: 'Sacks of peanuts on pallets off the damp floor, the gas meter for the roaster, and the junction box by the steps.' }, name: 'Pruitt\'s Peanuts & Pretzels', roomName: 'Pruitt\'s', type: 'peanut_roaster',
  x: 894, y: 912, entrance: 'west', floors: 1, marker: 'PP',
  facade: { bgColor: '#2b2014', color: '#e8cf9a',
    description: 'A brick shop on Vetch Mews with a big copper roasting drum turning in the window, a green awning, and PEANUTS & PRETZELS in gilt on the fascia. It smells of salt and burnt sugar for a block in every direction.' },
  rooms: [
    { key: 'shop', name: 'Shop', floor: 'boards',
      description: 'A small shop with a glass case of pretzels on hooks, sacks of peanuts open along the wall with scoops in them, and the roasting drum turning in the window over a gas ring. Paper cones are stacked by the till.',
      window: { name: 'the shop window', description: 'The roasting drum turns in the window, its copper gone dark at the bottom. Vetch Mews is outside, and the side of the Coliseum.', light: 0.6, visibility: 0.6 } },
    { key: 'roastery', name: 'Roasting Room', floor: 'concrete', from: 'shop', dir: 'east',
      description: 'A back room with a dough table dusted white, a pretzel oven, and sacks of raw peanuts stacked on pallets. A chalk tally on the wall counts the sacks left to the end of the season.',
      window: null },
  ],
  lights: { roastery: { name: 'the oven light', description: 'A bare bulb over the dough table, and the orange of the oven door under it.', lumens: 1000 } },
  props: [
    { key: 'drum', room: 'shop', name: 'the roasting drum', objectType: 'furniture',
      description: 'A copper drum on a spit in the window, turning over a blue gas ring, the peanuts inside rattling as it goes round. A thermometer on the end reads hot.',
      flags: { aliases: ['drum', 'roasting drum', 'roaster', 'peanuts', 'gas ring'] } },
    { key: 'case', room: 'shop', name: 'the pretzel case', objectType: 'furniture',
      description: 'A glass case with pretzels hung on brass hooks in rows, salted and plain, a bowl of mustard on top with a sign that says ONE DIP.',
      flags: { aliases: ['case', 'pretzels', 'pretzel case', 'hooks', 'mustard'] } },
    { key: 'till', room: 'shop', name: 'the cash drawer', description: 'An old brass till with keys you have to lean on.', ...till('npc_pruitt_lorna') },
  ],
  items: [
    { id: 'item_pruitt_peanuts', name: 'cone of peanuts', type: 'consumable', value: 3, weight: 120, description: null, flags: {},
      tags: { consumable: true, restore_hunger: 10, stackable: true, description: 'A paper cone of peanuts in the shell, still warm from Pruitt\'s drum and salted on the outside. The shells go on the floor. Everybody\'s do.' } },
    { id: 'item_pruitt_pretzel', name: 'salted pretzel', type: 'consumable', value: 4, weight: 150, description: null, flags: {},
      tags: { consumable: true, restore_hunger: 14, stackable: true, description: 'A soft pretzel the size of a hand, knotted, brown and shining, with coarse salt that falls off as you carry it. One dip of mustard.' } },
    { id: 'item_pruitt_popcorn', name: 'bag of popcorn', type: 'consumable', value: 3, weight: 90, description: null, flags: {},
      tags: { consumable: true, restore_hunger: 8, stackable: true, description: 'Popcorn in a striped paper bag, buttered at the top and dry at the bottom, the way it always is.' } },
  ],
  npc: {
    id: 'npc_pruitt_lorna', name: 'Lorna Pruitt', sex: 'female', hp: 36,
    homeRoom: 'roastery', workRoom: 'shop', shopName: 'Pruitt\'s Peanuts & Pretzels',
    description: 'A broad woman with flour to the elbows and a scoop in her apron pocket, her grey hair tied up in a green scarf. She shakes the drum by hand when she thinks it is going too slowly.',
    clothing: ['a green apron floured to the hem', 'a green headscarf', 'a cream blouse with the sleeves pushed up', 'brown wool trousers', 'sturdy boots'],
    schedule: GAME_LATE({ from: 10, to: 16 }, { from: 14, to: 22 }, [{ from: 10, to: 14 }]),
    inventory: [{ item_id: 'item_pruitt_peanuts', price: 3 }, { item_id: 'item_pruitt_pretzel', price: 4 }, { item_id: 'item_pruitt_popcorn', price: 3 }, { item_id: 'item_lemon_soda', price: 4 }],
    chitchat: [
      'Pruitt gives the roasting drum a shove to help it round.',
      'She twists a rope of dough into a knot in three moves and lays it on the tray.',
      'She scoops peanuts into a cone and shakes salt over the top.',
      'She chalks another line through the sack tally on the wall.',
      'She taps the thermometer on the drum and grunts.',
    ],
    dialogue: {
      root: {
        text: '"Peanuts, pretzel, popcorn." She holds up the scoop. "Pick one, or I pick for you."',
        text_by_relation: {
          first: 'The woman at the drum wipes her hands down her apron.\n\n"Lorna Pruitt. Peanuts, pretzels and popcorn, and that is the whole list." She sniffs at the drum. "Those are nearly done. Wait for them."',
          known: '"You came back for the peanuts. They all do."',
          familiar: '"A cone and a pretzel, salt on both." She is filling the cone already.',
        },
        options: [
          { label: 'What do you sell?', next: '__shop__' },
          { label: 'What\'s the tally on the wall?', next: 'tally' },
          { label: 'Did you know Sir Charles?', next: 'charles' },
          { label: 'Nothing, thanks.', next: 'bye', enabled: true, actions: [], conditions: [] },
        ],
      },
      tally: { text: '"Sacks to the end of the season." She taps the chalk. "When it gets to nought, the season is over, whatever the league says. It has never once been wrong."', options: [{ label: 'Back up.', next: 'root' }] },
      charles: { text: '"Everybody round here knew him a little." She shakes the drum. "He bought a cone from my mother every opening day and paid with a note so she couldn\'t give change. He never sold the ground, and he never haggled over a peanut either."', options: [{ label: 'Back up.', next: 'root' }] },
      bye: { text: '"Shells on the floor, not in your pockets."', options: [] },
    },
  },
});

// Mulcahy's Sports Bar, on the corner of Halcyon Boulevard and Kettle Lane.
SPECS.push({
  slug: 'mulcahy', utility: { name: 'Cellar', floor: 'stone', description: 'The beer cellar: kegs on a stillage, the lines running up through the ceiling to the taps, and the junction box by the hatch.' }, name: 'Mulcahy\'s Sports Bar', roomName: 'Mulcahy\'s', type: 'sports_bar',
  x: 898, y: 911, entrance: 'north', floors: 2, marker: 'MB',
  facade: { bgColor: '#1f1a14', color: '#d9b77a',
    description: 'A two-storey brick tavern on the corner of Halcyon Boulevard and Kettle Lane, green paint and gold leaf on the windows, pennants in a line under the eaves and MULCAHY\'S in green neon over the door. The game is on a set in the window.' },
  rooms: [
    { key: 'bar', name: 'Bar', floor: 'boards',
      description: 'A long dark bar with a brass rail and a set high on the wall at the end of it, tuned to KSAB. Pennants and team photographs cover every wall, and the floor is sawdust over boards. A booth at the back is kept for whoever was there first.',
      window: { name: 'the front windows', description: 'Green-painted windows with MULCAHY\'S in gold leaf, backwards from in here. Halcyon Boulevard is outside, and the Coliseum\'s north wall across the corner.', light: 0.5, visibility: 0.6 } },
    { key: 'snug', name: 'The Snug', floor: 'carpet', from: 'bar', dir: 'south',
      description: 'A small back room with three tables and a dartboard, the carpet worn to the weave between the oche and the board. A framed photograph hangs over the fireplace.',
      window: null },
  ],
  lights: { snug: { name: 'the snug lamps', description: 'Two wall lamps with fringed shades, and a picture light over the photograph.', lumens: 900 } },
  props: [
    { key: 'counter', room: 'bar', name: 'the bar', objectType: 'furniture',
      description: 'A long mahogany bar with a brass foot rail, scarred with rings and initials. The taps are in a row at the near end and the till at the far one.',
      flags: { aliases: ['bar', 'counter', 'rail', 'taps', 'stool', 'stools'], interactions: ['sit'] } },
    { key: 'set', room: 'bar', name: 'the set over the bar', objectType: 'tv', powerKw: 0.3,
      description: 'A television in a wooden cabinet on a shelf high at the end of the bar, the sound down and the picture up. It stays on KSAB, channel 7.',
      flags: { aliases: 'set,tv,television,screen', broadcast_device_type: 'tv', broadcast_receiver: true, channel_default: 7, interactions: ['watch'], tuned_channel: 7, tv: true, tv_dial_freq: 7 } },
    { key: 'photo', room: 'snug', name: 'the photograph over the fireplace', objectType: 'decoration',
      description: 'A framed photograph of a man in a good coat at the gate of the Coliseum on its opening day, hat in one hand, shaking hands with a queue that runs out of the picture. Somebody has written SIR CHARLES on the mount in fountain pen.',
      flags: { aliases: ['photograph', 'photo', 'picture', 'sir charles', 'charles', 'fireplace'] } },
    { key: 'darts', room: 'snug', name: 'the dartboard', objectType: 'decoration',
      description: 'A dartboard on a cabinet, the treble twenty chewed to cork. A slate beside it has a game nobody finished.',
      flags: { aliases: ['dartboard', 'darts', 'board', 'slate'] } },
    { key: 'till', room: 'bar', name: 'the cash drawer', description: 'A till at the far end of the bar with a bell that has been taped silent.', ...till('npc_mulcahy_declan') },
  ],
  items: [
    { id: 'item_mulcahy_wings', name: 'basket of wings', type: 'consumable', value: 9, weight: 300, description: null, flags: {},
      tags: { consumable: true, restore_hunger: 22, stackable: true, description: 'A paper-lined basket of chicken wings in a red sauce that gets hotter for a minute after you stop eating it, with a pot of something cool that doesn\'t help.' } },
  ],
  npc: {
    id: 'npc_mulcahy_declan', name: 'Declan Mulcahy', sex: 'male', hp: 46,
    homeRoom: 'snug', workRoom: 'bar', shopName: 'Mulcahy\'s Sports Bar',
    description: 'A thickset man in his fifties with a broken nose and a green waistcoat, a bar towel over one shoulder and his eyes on the set over the bar whatever he is doing with his hands.',
    clothing: ['a green waistcoat', 'a bar towel over one shoulder', 'a white shirt with the sleeves gartered', 'dark trousers', 'boxer shorts'],
    schedule: { mon: [{ from: 12, to: 23 }], tue: [{ from: 12, to: 23 }], wed: [{ from: 12, to: 23 }], thu: [{ from: 12, to: 23 }], fri: [{ from: 12, to: 23 }], sat: [{ from: 12, to: 23 }], sun: [{ from: 12, to: 20 }] },
    inventory: [{ item_id: 'item_drug_beer', price: 5 }, { item_id: 'item_mulcahy_wings', price: 9 }, { item_id: 'item_cream_soda', price: 4 }, { item_id: 'item_arcline_cola', price: 4 }],
    chitchat: [
      'Mulcahy pulls a pint without looking away from the set.',
      'He wipes the bar in a long sweep and flicks the towel back over his shoulder.',
      'The bar groans at something on the set. Mulcahy says nothing, which says plenty.',
      'He straightens a pennant on the wall that was straight already.',
      'He chalks a score on the slate by the till.',
    ],
    dialogue: {
      root: {
        text: '"What\'ll it be?" His eyes go back to the set.',
        text_by_relation: {
          first: 'The man behind the bar gives you a look, then a nod.\n\n"Declan Mulcahy. It\'s my name on the window, so it\'s my bar." He jerks a thumb at the set. "Game\'s on three nights a week, and the rest of the time we talk about it."',
          known: '"You found your way back." He sets a glass down in front of you.',
          familiar: '"Your usual, and your stool." The stool is pulled out.',
        },
        options: [
          { label: 'What do you sell?', next: '__shop__' },
          { label: 'Who\'s in the photograph?', next: 'photo' },
          { label: 'How\'s the team?', next: 'team' },
          { label: 'Nothing, thanks.', next: 'bye', enabled: true, actions: [], conditions: [] },
        ],
      },
      photo: { text: '"Sir Charles, opening day, at his own gate." He doesn\'t need to look at it. "He shook every hand that came through. My grandfather\'s is in there somewhere, out of shot. Halcyon wanted the ground and he sent the cheque back. That\'s the whole story, and it\'s a good one."', options: [{ label: 'Back up.', next: 'root' }] },
      team: { text: '"Losing in an interesting way." He watches the set for a moment. "Losing in a boring way is worse. Ask anybody at this bar."', options: [{ label: 'Back up.', next: 'root' }] },
      bye: { text: '"Mind the step on the way out. It\'s been there longer than me."', options: [] },
    },
  },
});

// Kimble's Souvenirs & Cards, on Sorrel Way at the third-base corner.
SPECS.push({
  slug: 'kimble', utility: { name: 'Cellar', floor: 'concrete', description: 'Boxes of last season\'s caps, a rail of pennants in plastic, and the junction box by the steps.' }, name: 'Kimble\'s Souvenirs & Cards', roomName: 'Kimble\'s', type: 'souvenir_shop',
  x: 894, y: 913, entrance: 'south', floors: 1, marker: 'KM',
  facade: { bgColor: '#1d2219', color: '#e3c98c',
    description: 'A narrow shop on Sorrel Way with green-and-cream bunting over the door, pennants hung in the window in fans, a card machine glowing behind the glass, and SOUVENIRS & CARDS in gilt on the fascia.' },
  rooms: [
    { key: 'shop', name: 'Shop', floor: 'linoleum',
      description: 'A narrow shop lined with pennants, caps on a tree by the door, foam fingers in a bin, and a glass counter of signed balls on stands. A card machine hums in the corner, and the walls are papered with old game posters.',
      window: { name: 'the shop window', description: 'Pennants hung in fans in the window, faded on the street side. Sorrel Way is outside, and the Coliseum\'s south-west tower.', light: 0.6, visibility: 0.6 } },
    { key: 'stock', name: 'Stockroom', floor: 'concrete', from: 'shop', dir: 'north',
      description: 'Shelves of boxed caps and rolled pennants to the ceiling, a sewing machine for letters, and a crate of foam fingers waiting to be fluffed up.',
      window: null },
  ],
  lights: { stock: { name: 'the stockroom tube', description: 'A tube light that flickers when the sewing machine runs.', lumens: 1000 } },
  props: [
    { key: 'pennants', room: 'shop', name: 'the pennant wall', objectType: 'decoration',
      description: 'Felt pennants in every colour the league has ever worn, pinned in rows from the skirting to the ceiling. The Coliseum\'s own, green with a gold sunburst, hang at eye height.',
      flags: { aliases: ['pennants', 'pennant wall', 'wall', 'posters'] } },
    { key: 'balls', room: 'shop', name: 'the signed balls', objectType: 'decoration',
      description: 'Baseballs on little stands under the glass, every one signed and labelled in pen. One label just says FOUL, SECTION NINE, and the ball is scorched.',
      flags: { aliases: ['balls', 'signed balls', 'baseballs', 'counter', 'glass counter'] } },
    { key: 'cards', room: 'shop', name: 'Architect Draft card machine', objectType: 'fixture', powerKw: 0.4,
      description: 'A card machine wedged between the cap tree and the window, foil sleeves in three columns behind the glass. A hand-written card taped to it says the players are at the front.',
      flags: { click_cmd: 'buypack', interactions: [], notable: true, vends_packs: 1 } },
    { key: 'till', room: 'shop', name: 'the cash drawer', description: 'A drawer under the glass counter with a key on a string.', ...till('npc_kimble_odessa') },
  ],
  items: [
    { id: 'item_coliseum_pennant', name: 'Coliseum pennant', type: 'misc', value: 8, weight: 60, description: null, flags: {},
      tags: { stackable: true, description: 'A green felt pennant with the Coliseum\'s gold sunburst at the wide end and COLISEUM down the tail. It is for waving at a game or nailing to a wall, and most of them end up nailed.' } },
    { id: 'item_coliseum_cap', name: 'Coliseum cap', type: null, value: 16, weight: 110, description: null, flags: {},
      tags: { bulkiness: 1, insulation: 0.4, layer: 'outerwear', slot: 'head', description: 'A green wool ball cap with the Coliseum\'s sunburst stitched on the front in gold thread. The peak comes flat and is meant to be bent by its owner over a season.' } },
    { id: 'item_foam_finger', name: 'foam finger', type: 'misc', value: 6, weight: 80, description: null, flags: {},
      tags: { description: 'A giant green foam hand with one finger raised, the right one, and WE\'RE NUMBER 1 printed up it. Nobody at the Coliseum has believed that in years.' } },
  ],
  npc: {
    id: 'npc_kimble_odessa', name: 'Odessa Kimble', sex: 'female', hp: 34,
    homeRoom: 'stock', workRoom: 'shop', shopName: 'Kimble\'s Souvenirs & Cards',
    description: 'A wiry woman in her forties with a measuring tape round her neck and pins in her lapel, a Coliseum cap pushed back on her head. She refolds every pennant a customer has touched.',
    clothing: ['a Coliseum cap pushed back on the head', 'a measuring tape round the neck', 'a green cardigan bristling with pins', 'a striped shirt', 'jeans'],
    schedule: GAME_LATE({ from: 10, to: 18 }, { from: 10, to: 20 }, [{ from: 10, to: 16 }]),
    inventory: [{ item_id: 'item_coliseum_pennant', price: 8 }, { item_id: 'item_coliseum_cap', price: 16 }, { item_id: 'item_foam_finger', price: 6 }, { item_id: 'item_coliseum_scorecard', price: 2 }],
    chitchat: [
      'Kimble refolds a pennant somebody left crooked and pins it back up.',
      'She fluffs a foam finger back into shape and drops it in the bin.',
      'She bends the peak of a cap over her knee, tries it on, and bends it again.',
      'The card machine hums. She gives it a pat as she passes.',
      'She writes a label for a signed ball in careful capitals.',
    ],
    dialogue: {
      root: {
        text: '"Pennant, cap, or something to wave?" She has the tape in her hand already.',
        text_by_relation: {
          first: 'The woman behind the counter looks up from a pennant she is pinning.\n\n"Odessa Kimble. If it has the Coliseum on it, I sell it, and if it doesn\'t, I can sew it on." She nods at the machine in the corner. "Cards are over there. The machine takes money, not arguments."',
          known: '"You again. The caps are new in."',
          familiar: '"Your size is under the counter." It is.',
        },
        options: [
          { label: 'What do you sell?', next: '__shop__' },
          { label: 'What\'s the scorched ball?', next: 'ball' },
          { label: 'Why the sunburst?', next: 'sun' },
          { label: 'Nothing, thanks.', next: 'bye', enabled: true, actions: [], conditions: [] },
        ],
      },
      ball: { text: '"Off the night something came down in section nine." She doesn\'t open the case. "A boy brought it in the next morning, still warm, he said. I gave him a cap for it. It is not for sale, and he still comes in."', options: [{ label: 'Back up.', next: 'root' }] },
      sun: { text: '"It\'s over the main gate, with a ball for the sun." She points out of the window at the corner. "Sir Charles had it put there when they built the place. He said a park should look like the morning. I put it on everything."', options: [{ label: 'Back up.', next: 'root' }] },
      bye: { text: '"Come back on a game night. It\'s a madhouse. You\'ll love it."', options: [] },
    },
  },
});

const built = [];
for (const spec of SPECS) {
  const facadeId = newId(spec.x, spec.y);
  const prev = store.get('power_zones', oldId(spec.x, spec.y));
  const r = await authorBuilding(store, { ...spec, facadeId, district: DISTRICT });
  // The new facade sits where the old one did, so it takes its grid, and the city's power as the plot had it.
  const f = store.get('zones', facadeId);
  store.patch('zones', facadeId, { grid_x: spec.x, grid_y: spec.y, grid_z: 0, flags: { ...f.flags } });
  if (prev) store.patch('power_zones', facadeId, { ...prev, id: facadeId, name: spec.name });
  built.push([spec.name, r.facadeId]);
}
// Fill any column a fresh row needs from a neighbour's, so the import's NOT NULLs are met.
{
  const like = store.get('zones', 'zone_district_896_910');
  for (const spec of SPECS) {
    const id = newId(spec.x, spec.y), z = store.get('zones', id), fill = {};
    for (const k of Object.keys(like)) if (!(k in z)) fill[k] = k === 'flags' || k === 'exits' ? {} : (Array.isArray(like[k]) ? [] : null);
    if (Object.keys(fill).length) store.patch('zones', id, fill);
  }
}

// ── 3. THE CART YARD ─────────────────────────────────────────────────────────────────────────
// The grass strip between Mulcahy's and the box office, against the park's east wall, paved for the
// food carts that work the gates on game nights.
store.patch('zones', oldId(898, 912), {
  name: 'Cart Yard',
  description: 'A paved yard between the Coliseum\'s east wall and Kettle Lane, where the food carts park in a row under tarpaulins: a lemonade cart, a candy-floss wheel, a cart of roasting chestnuts. On game nights they roll out to the gates. A loading door is set in the limestone.',
  ambient_theme: 'urban',
  flags: { ...store.get('zones', oldId(898, 912)).flags, terrain: 'concrete' },
});

// MARK-4: a marker is unique across the world.
for (const spec of SPECS) {
  const clash = store.all('zones').filter((z) => z.marker === spec.marker && z.id !== newId(spec.x, spec.y));
  if (clash.length) throw new Error(`map code ${spec.marker} is already ${clash.map((z) => `${z.name} (${z.id})`).join(', ')}`);
}
// Nothing left on the world pointing into a set-aside building, and every new door has its street.
for (const spec of SPECS) if (!zoneAt(spec.x, spec.y) || zoneAt(spec.x, spec.y).id !== newId(spec.x, spec.y)) throw new Error(`${spec.name}: the plot ${spec.x},${spec.y} is not its new facade`);

const written = store.flush({ dryRun: DRY });
const removed = [];
for (const id of STREET_CONNS) {
  const p = path.join(store.baseDir, 'connections', `${id}.json`);
  if (fs.existsSync(p)) { removed.push(p); if (!DRY) fs.unlinkSync(p); }
}
console.log(`${DRY ? 'DRY RUN: ' : ''}${written.length} file(s) ${DRY ? 'would be written' : 'written'}, ${removed.length} connection file(s) ${DRY ? 'would be removed' : 'removed'}`);
for (const [n, id] of built) console.log(`  ${n}  ${id}`);
console.log('\nnext:\n  node scripts/content/mint-connections.mjs --write\n  npm run content:lint');
