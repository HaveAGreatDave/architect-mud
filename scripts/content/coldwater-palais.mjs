/**
 * THE COLDWATER PALAIS: a music hall on Meltwater Row, three tiles across, in front of
 * Fisherman's Green.
 *
 *   node scripts/content/coldwater-palais.mjs [--dry-run]
 *
 * Built in the Meridian's decade, out of the Meridian's stone, and kept up since. It's laid out
 * the way Coldwater Regional's terminal is: one building over several tiles, each tile its own
 * facade and type, sharing one `building_name`.
 *
 *   908,909  palais_foyer  the box office foyer, door north onto Meltwater Row        map BX
 *   909,909  palais_stage  the auditorium and stage house; not a door, the stage     map MH
 *   910,909  palais_bar    the bar foyer, door north onto Meltwater Row              map PB
 *
 * ⚠ THE MIDDLE TILE IS A BUILDING WITH NO DOOR, like Priced to Sell: `is_building`, a type, a
 * marker, an `entrance` for the arm to face, and no exits. Its neighbours' links into it are cut
 * here, the half `authorBuilding` does for a facade.
 *
 * ⚠ THE AUDITORIUM IS IN THE BOX OFFICE'S MAP, and the bar reaches it through the stalls' east
 * door, the way the airport's arrivals hall reaches check-in across two maps. That link is written
 * LAST, after both `authorBuilding` calls, because `authorUtilityRoom` walks the exits to decide
 * what each junction box feeds, and with the link in place either box would claim both halves.
 *
 * Idempotent: every id derives from a slug, so a re-run rewrites the same files.
 */
import { authorBuilding, loadContentStore } from './halcyon/lib.mjs';

const DRY = process.argv.includes('--dry-run');
const store = loadContentStore();

const NAME = 'The Coldwater Palais';
const district = 'commercial';

// ── the box office foyer, and the house behind it ─────────────────────────────
const west = {
  slug: 'palais', name: NAME, type: 'palais_foyer',
  x: 908, y: 909, entrance: 'north', floors: 3, marker: 'BX', district,
  // The trap room goes under the stage, which is where a theatre keeps its machinery.
  utilityAnchor: 'stage',

  facade: {
    bgColor: '#2a2219', color: '#e8c878',
    description: 'The west foyer of the Palais: three floors of limestone with a round stone tower on the corner, banded in bronze and capped in green copper. Two bronze doors under a canopy, BOX OFFICE lettered in the glass over them, a lit window either side. The stone has been washed this year. Nobody washes stone any more.',
  },

  rooms: [
    { key: 'foyer', name: 'The Box Office Foyer', floor: 'stone',
      description: 'A tall foyer floored in black and cream stone, laid in a sunburst from the box office window. Bronze rails, plaster fluted like a shell over the doors, and a chandelier of stacked glass rings that somebody climbs a ladder to dust. Framed bills line the walls, the oldest gone brown. The stalls are through the doors to the east.',
      window: {
        name: 'the foyer windows',
        description: 'Tall windows in bronze frames either side of the doors, looking out on Meltwater Row. The glass is clean enough to see your own reflection in it over the street.',
        light: 0.7, visibility: 0.8,
      } },
    { key: 'stalls', name: 'The Stalls', floor: 'carpet', from: 'foyer', dir: 'east',
      description: 'Rows of red plush seats rake down toward the stage under a ceiling painted with a blue sky and gold clouds. The proscenium is gilt plaster, stepped in toward the curtain. In the pit a theatre organ sits on its lift. Doors at the back lead to the foyers either side, and a stair curves up to the circle.',
      window: null },
    { key: 'stage', name: 'The Stage', floor: 'boards', from: 'stalls', dir: 'south',
      description: 'Bare boards, worn pale down the middle where everybody stands, with a brass edge on the lip and a row of footlights under it. A concert grand stands stage left with its dust sheet folded back. Overhead the fly tower goes up into the dark, ropes and painted cloths hanging in it. A trap door leads down.',
      window: null },
    { key: 'circle', name: 'The Dress Circle', floor: 'carpet', from: 'stalls', dir: 'up',
      description: 'The circle hangs over the back of the stalls on a curve of plaster, three rows deep, the seats older and softer than the ones below. A brass rail runs along the front. From up here the stage is small and bright and the whole room is in front of you, which is what the extra credits used to buy.',
      window: null },
    { key: 'dressing', name: 'The Dressing Rooms', floor: 'boards', from: 'stage', dir: 'west',
      description: 'A corridor of narrow rooms off the side of the stage, doors propped open. Mirrors ringed with bulbs, a rail of costumes in plastic, a sink with a cracked tile splashback, and a kettle. The walls are signed in pen and lipstick by everyone who has played here, back to names the city has forgotten.',
      window: null },
  ],

  utility: {
    name: 'The Trap Room', floor: 'concrete',
    description: 'The space under the stage, low and crowded with timber posts. The trap lifts stand on their counterweights, ropes greased and coiled. A row of old painted flats leans along one wall. The junction box is by the stair, labelled in three generations of handwriting.',
  },

  lights: {
    foyer: { name: 'the chandelier', description: 'A chandelier of stacked glass rings, five tiers of them, hung from a plaster rose. Every ring is clean.', lumens: 2600 },
    stalls: { name: 'the house lights', description: 'Lamps in fluted bronze cups along the side walls and a ring of them round the painted ceiling. They go down before the show and come up at the end.', lumens: 2400 },
    circle: { name: 'the circle lamps', description: 'Small shaded lamps along the circle rail, low enough not to bother anyone watching the stage.', lumens: 1800 },
    dressing: { name: 'the mirror bulbs', description: 'Bare bulbs round every mirror. Most of them work.', lumens: 2000 },
  },

  props: [
    { key: 'boxoffice', room: 'foyer', name: 'the box office', objectType: 'fixture',
      description: 'A bronze kiosk with a curved glass front and a slot at the bottom for money and tickets. A card in the window gives the doors as eight o\'clock. Behind the glass there is a cash drawer, a book of tickets and a stool.',
      flags: { aliases: ['box office', 'kiosk', 'window', 'tickets', 'glass'] } },
    { key: 'drawer', room: 'foyer', name: 'the cash drawer', objectType: 'fixture',
      description: 'A steel drawer under the box office counter, locked with a key on a chain round the box office manager\'s wrist.',
      flags: { aliases: ['drawer', 'cash drawer', 'cash'], vendor_safe: true, vendor_npc_id: 'npc_palais_boxoffice', hack_difficulty: 3 } },
    { key: 'bills', room: 'foyer', name: 'the old bills', objectType: 'decoration',
      description: 'Framed posters down both walls, one for every season the Palais has been open. The newest are photographs. The oldest are hand-lettered, and the ink has gone the colour of tea.',
      flags: { aliases: ['bills', 'posters', 'frames', 'playbills'],
        examine_detail: 'The one nearest the door is from the opening season. The top line is a dance band, the prices are in a currency the city stopped using, and at the bottom it promises that the Palais will never close. So far it hasn\'t.' } },
    { key: 'banquette', room: 'foyer', name: 'the banquette', objectType: 'furniture',
      description: 'A long seat in green leather along the wall under the bills, buttoned and worn smooth at the ends.',
      flags: { aliases: ['banquette', 'seat', 'bench'], interactions: ['sit', 'lean'] } },
    { key: 'seats', room: 'stalls', name: 'the stalls seats', objectType: 'furniture',
      description: 'Red plush tip-up seats with brass numbers on the backs. Some of the plush has been patched in a red that is nearly the same.',
      flags: { aliases: ['seats', 'seat', 'stalls', 'chairs'], interactions: ['sit'] } },
    { key: 'organ', room: 'stalls', name: 'the theatre organ', objectType: 'furniture',
      description: 'A theatre organ on its lift in the pit, the console cream and gilt, three keyboards stepped like a staircase and a horseshoe of coloured stop tabs. The pipes are behind grilles either side of the proscenium. The lid is closed but not locked.',
      flags: { aliases: ['organ', 'console', 'pipes'], instrument: 'organ', interactions: ['examine', 'play'],
        examine_detail: 'A brass plate on the console gives the maker, the year, and the name of the man who played it on the first night. Somebody still polishes the plate.' } },
    { key: 'proscenium', room: 'stalls', name: 'the proscenium', objectType: 'decoration',
      description: 'The arch round the stage, gilt plaster stepped in toward the curtain in five bands, a sunburst at the top of it. The gilt has been touched up in places, carefully.',
      flags: { aliases: ['proscenium', 'arch', 'gilt', 'sunburst'] } },
    { key: 'piano', room: 'stage', name: 'the concert grand', objectType: 'furniture',
      description: 'A concert grand in black, the dust sheet folded back off the lid and the stool set square to it. The keys have gone the colour of old teeth. It is in tune.',
      flags: { aliases: ['piano', 'grand', 'concert grand', 'keys'], instrument: 'piano', interactions: ['examine', 'play'],
        examine_detail: 'A card on the music desk, in Minnie Pruett\'s handwriting, says anyone may play it, and anyone who can\'t shouldn\'t.' } },
    { key: 'curtain', room: 'stage', name: 'the house curtain', objectType: 'decoration',
      description: 'Red velvet, gold fringed, gathered up into the arch. It smells of dust and old perfume, and comes down in one heavy sweep when somebody hauls the rope.',
      flags: { aliases: ['curtain', 'tabs', 'velvet', 'rope'] } },
    { key: 'footlights', room: 'stage', name: 'the footlights', objectType: 'decoration',
      description: 'A row of lamps in a brass trough along the lip of the stage, each with a coloured gel. Two of the gels have melted at the corners.',
      flags: { aliases: ['footlights', 'lamps', 'trough', 'gels'] } },
    { key: 'cseats', room: 'circle', name: 'the circle seats', objectType: 'furniture',
      description: 'Deep seats in faded green velvet, three rows of them on a curve, with more room for your knees than anywhere downstairs.',
      flags: { aliases: ['seats', 'seat', 'chairs'], interactions: ['sit'] } },
    { key: 'rail', room: 'circle', name: 'the brass rail', objectType: 'furniture',
      description: 'A brass rail along the front of the circle, polished bright by elbows.',
      flags: { aliases: ['rail', 'brass rail', 'balcony'], interactions: ['lean'] } },
    { key: 'mirrors', room: 'dressing', name: 'the dressing mirrors', objectType: 'decoration',
      description: 'A mirror in every room, each one ringed with bulbs, each one with a shelf under it crowded with pots, brushes and good-luck cards.',
      flags: { aliases: ['mirror', 'mirrors', 'shelf', 'cards'],
        examine_detail: 'The walls round the mirrors are covered in signatures. One of them, low down by the door, is just a drawing of a cat.' } },
    { key: 'costumes', room: 'dressing', name: 'the costume rail', objectType: 'decoration',
      description: 'A rail of costumes in clear plastic covers: a tailcoat, a sequinned dress that weighs more than it looks, three identical sailor suits.',
      flags: { aliases: ['costumes', 'rail', 'clothes', 'tailcoat', 'dress'] } },
    { key: 'sink', room: 'dressing', name: 'the sink', objectType: 'sink',
      description: 'A small sink with a cracked tile splashback and a bar of soap worn to a sliver.',
      flags: { aliases: ['sink', 'tap', 'basin'], water_source: true, interactions: ['lean'] } },
  ],

  items: [
    { id: 'item_palais_programme', name: 'a Palais programme', type: 'media', value: 3, weight: 20,
      description: null, flags: {},
      tags: { stackable: true,
        description: 'A folded card printed in two colours, the Palais drawn on the front in the style of the old bills. Inside: this week\'s acts, the bar prices, and a paragraph on the building\'s history that leaves out anything embarrassing.' } },
    { id: 'item_choc_ice', name: 'a choc ice', type: 'consumable', value: 4, weight: 80,
      description: null, flags: {},
      tags: { consumable: true, stackable: true, restore_hunger: 8,
        description: 'A block of vanilla ice cream in a thin shell of chocolate, wrapped in foil. Cold enough to hurt your teeth, and gone in four bites.' } },
    { id: 'item_palais_chocolates', name: 'a box of chocolates', type: 'consumable', value: 9, weight: 200,
      description: null, flags: {},
      tags: { consumable: true, stackable: true, restore_hunger: 12, restore_sanity: 4,
        description: 'A flat box of chocolates with the Palais blade printed on the lid. Nine in a tray, each in a paper cup. The card says which is which and is wrong about two of them.' } },
  ],

  npc: {
    id: 'npc_palais_boxoffice', name: 'Minnie Pruett', sex: 'female', hp: 36,
    homeRoom: 'foyer', workRoom: 'foyer', shopName: `${NAME} Box Office`,
    description: 'A small woman in her sixties with silver hair set in waves and a pencil through them. She wears a bottle-green uniform jacket with brass buttons, too formal for anyone else in the city and exactly right on her. She knows every seat in the house by number and most of the people who have sat in them.',
    clothing: [
      'a bottle-green uniform jacket with brass buttons',
      'a cream blouse with a cameo at the collar',
      'a black pencil skirt and low-heeled shoes',
      'reading glasses on a chain',
    ],
    // The box office opens at noon and stays open through the interval.
    schedule: {
      mon: [{ from: 12, to: 22 }], tue: [{ from: 12, to: 22 }], wed: [{ from: 12, to: 22 }],
      thu: [{ from: 12, to: 22 }], fri: [{ from: 12, to: 23 }], sat: [{ from: 12, to: 23 }], sun: [{ from: 14, to: 21 }],
    },
    inventory: [
      { item_id: 'item_palais_programme', price: 3 },
      { item_id: 'item_choc_ice', price: 4 },
      { item_id: 'item_palais_chocolates', price: 9 },
    ],
    chitchat: [
      'Pruett tears a ticket along its perforation without looking at it.',
      'She straightens a frame on the wall by a hair, then steps back to check.',
      '"Doors at eight," she tells nobody in particular. "Not five past."',
      'She polishes the box office glass with a cloth she keeps in her sleeve.',
      'She runs a finger down the seating plan and makes a small mark in pencil.',
    ],
    dialogue: {
      root: {
        text: '"Box office." Pruett looks at you over her glasses. "What can I do for you?"',
        text_by_relation: {
          first: 'The woman in the box office finishes writing something, caps her pen, and looks up through the glass.\n\n"Minnie Pruett. I run the front of house, which means everything you can see and most of what you can\'t." She taps the card in the window. "Doors at eight. Programmes, ices and chocolates from me. Drinks from Lionel at the bar, east side. What can I do for you?"',
          known: '"Back again." She is already reaching for a programme. "Good."',
          familiar: '"Your usual seat\'s free," she says. "I kept it."',
        },
        options: [
          { label: 'What have you got?', next: '__shop__' },
          { label: 'What\'s on?', next: 'whatson' },
          { label: 'How old is this place?', next: 'history' },
          { label: 'Can anyone play the piano?', next: 'piano' },
          { label: 'Nothing, thanks.', next: 'bye' },
        ],
      },
      whatson: {
        text: '"Something every night." She turns the programme round so you can read it. "Bands mostly, and dancing after, when the floor\'s cleared. A comedian on Tuesdays, who is not as good as he thinks. A pianist on Sundays, who is better than she thinks."\n\n"Whoever\'s on, the organ goes up at the interval. That\'s been true since before I was born."',
        options: [
          { label: 'A programme, then.', next: '__shop__' },
          { label: 'Back up.', next: 'root' },
        ],
      },
      history: {
        text: '"Built the same decade as the Meridian, by the same people, out of the same stone." She says it like a catechism. "It\'s been a music hall, a cinema for a bit, a dance hall, a shelter, a music hall again. It\'s never been shut for longer than a month."\n\n"That\'s not luck. Somebody fixes the roof every year whether there\'s money or not. Mostly that\'s me."',
        options: [
          { label: 'Where\'s the Meridian?', next: 'meridian' },
          { label: 'Back up.', next: 'root' },
        ],
      },
      meridian: {
        text: '"East, along Marrow Street, past the Deadline. The stepped one with the green crown, you can\'t miss it." She points with the pen. "Same stone as ours. Look at it in the rain and you\'ll see it\'s the same colour as these walls when they\'re wet."',
        actions: [{ action: 'GPS_TO', zone: 'zone_district_918_908' }],
        options: [{ label: 'Back up.', next: 'root' }],
      },
      piano: {
        text: '"The grand on the stage? Anyone may play it." She holds up a finger. "Anyone who can. If you can\'t, the organ is worse, so don\'t try that either."\n\n"Go through to the stalls and up on to the stage. Sit down at it and play. If people come in to listen, that\'s how most of the acts we book started."',
        options: [{ label: 'Back up.', next: 'root' }],
      },
      bye: {
        text: '"Enjoy the show," she says, and goes back to the seating plan.',
        options: [],
      },
    },
  },
};

// ── the bar foyer ──────────────────────────────────────────────────────────────
const east = {
  slug: 'palais_east', name: NAME, type: 'palais_bar',
  x: 910, y: 909, entrance: 'north', floors: 3, marker: 'PB', district,

  facade: {
    bgColor: '#2a2219', color: '#e8c878',
    description: 'The east foyer is the west one in a mirror: the same stone, the same corner tower and copper cap, the same bronze doors under a canopy. The glass over these says BAR. Through the windows there is a long counter, a lot of mirror, and more bottles than the rest of Meltwater Row put together.',
  },

  rooms: [
    { key: 'bar', name: 'The Crush Bar', floor: 'tile',
      description: 'A long room with the bar down one side and a mirror behind it the full length, a bottle on every glass shelf. The ceiling is a shallow vault of gold leaf, dull but whole. Little round tables, a brass foot rail, and a door at the west end through to the stalls, kept open so the band carries.',
      window: {
        name: 'the bar windows',
        description: 'Tall windows in bronze frames onto Meltwater Row, the Palais\'s own marquee lighting the pavement outside.',
        light: 0.7, visibility: 0.8,
      } },
  ],

  utility: {
    name: 'The Cellar', floor: 'concrete',
    description: 'A brick cellar under the bar, cold enough to keep beer in. Kegs stand in a row on a timber stillage with their lines running up through the ceiling, and crates of empties are stacked by the hatch. The junction box is on the end wall.',
  },

  props: [
    { key: 'counter', room: 'bar', name: 'the bar', objectType: 'fixture',
      description: 'A bar of dark wood with a brass top and a brass foot rail, long enough for twenty people to stand at in the interval and not be served.',
      flags: { aliases: ['bar', 'counter', 'rail', 'foot rail'], interactions: ['lean'] } },
    { key: 'mirror', room: 'bar', name: 'the back bar', objectType: 'decoration',
      description: 'The mirror behind the bar, the length of the room, its silvering gone grey at the edges. The bottles on its glass shelves double in it so the bar looks twice as well stocked as it is.',
      flags: { aliases: ['mirror', 'back bar', 'bottles', 'shelves'] } },
    { key: 'till', room: 'bar', name: 'the till', objectType: 'fixture',
      description: 'A brass till with round keys and a bell, older than the bar it stands on.',
      flags: { aliases: ['till', 'register', 'cash'], vendor_safe: true, vendor_npc_id: 'npc_palais_barman', hack_difficulty: 3 } },
    { key: 'tables', room: 'bar', name: 'the little tables', objectType: 'furniture',
      description: 'Round tables with marble tops and bronze feet, two chairs to each and usually four people.',
      flags: { aliases: ['tables', 'table', 'chairs', 'chair'], interactions: ['sit'] } },
  ],

  items: [
    { id: 'item_drink_palais_sidecar', name: 'a sidecar', type: 'consumable', value: 14, weight: 300,
      description: null, flags: {},
      tags: { consumable: true, stackable: true, hydrating: true, laced_drug: 'drug_alcohol', laced_potency: 1, restore_thirst: 20, restore_sanity: 6,
        description: 'Brandy, orange liqueur and lemon, shaken hard and poured into a coupe with a sugared rim. It was the house drink on the first night and it still is.' } },
  ],

  npc: {
    id: 'npc_palais_barman', name: 'Lionel Lasko', sex: 'male', hp: 44,
    homeRoom: 'bar', workRoom: 'bar', shopName: `${NAME} Bar`,
    description: 'A tall, stooped man of about seventy in a white bar jacket buttoned to the collar, his moustache waxed to two fine points. He pours without looking and polishes without stopping, and he has an opinion about every band that has played here in the last forty years.',
    clothing: [
      'a white bar jacket buttoned to the collar',
      'a black bow tie',
      'black trousers with a satin stripe',
      'polished black shoes',
    ],
    // The bar opens at five and serves until the dancing stops.
    schedule: {
      mon: [{ from: 17, to: 25 }], tue: [{ from: 17, to: 25 }], wed: [{ from: 17, to: 25 }],
      thu: [{ from: 17, to: 25 }], fri: [{ from: 17, to: 27 }], sat: [{ from: 17, to: 27 }], sun: [{ from: 17, to: 24 }],
    },
    inventory: [
      { item_id: 'item_drink_palais_sidecar', price: 14 },
      { item_id: 'item_drink_rust_whiskey', price: 10 },
      { item_id: 'item_drug_beer', price: 6 },
      { item_id: 'item_iced_tea_carton', price: 4 },
    ],
    chitchat: [
      'Lasko shakes a cocktail with both hands, very fast, and pours it without spilling a drop.',
      'He holds a glass up to the light, finds something wrong with it, and polishes it again.',
      'He straightens the bottles on the back bar so the labels face the room.',
      '"In my day," he says to the mirror, and doesn\'t finish.',
      'He listens to the band through the open door, nods once, and goes back to work.',
    ],
    dialogue: {
      root: {
        text: '"Evening." Lasko sets a coaster down in front of you. "What\'ll it be?"',
        text_by_relation: {
          first: 'The barman finishes polishing a glass, holds it up to the light, and only then looks at you.\n\n"Lionel Lasko. I\'ve kept this bar since before you were born, probably." He sets a coaster down. "Sidecars are the house drink. Whiskey if you must, beer if you\'re working. What\'ll it be?"',
          known: '"Back again." He is already reaching for the brandy.',
          familiar: '"A sidecar," he says, and starts shaking one before you sit down.',
        },
        options: [
          { label: 'What have you got?', next: '__shop__' },
          { label: 'What\'s a sidecar?', next: 'sidecar' },
          { label: 'Who\'s good, out of the acts?', next: 'acts' },
          { label: 'Nothing, thanks.', next: 'bye' },
        ],
      },
      sidecar: {
        text: '"Brandy, orange, lemon, sugar on the rim." He spins a coupe on the bar with one finger. "It was the house drink on the opening night. I\'ve made more of them than anyone alive. Call it arithmetic."',
        options: [
          { label: 'One of those.', next: '__shop__' },
          { label: 'Back up.', next: 'root' },
        ],
      },
      acts: {
        text: '"The Sunday pianist. Nobody comes to hear her because she\'s on a Sunday, and that\'s their loss." He lowers his voice. "The Tuesday comedian, avoid. The bands are bands. Some nights one of them is good and the whole room knows it before the first number is over."\n\n"And if you play yourself, the grand on the stage is open. Minnie\'s rule. She\'ll tell you the rest of the rule."',
        options: [{ label: 'Back up.', next: 'root' }],
      },
      bye: {
        text: '"Mind the step on the way out," he says. "Everybody misses it."',
        options: [],
      },
    },
  },
};

const westIds = await authorBuilding(store, west);
const eastIds = await authorBuilding(store, east);

// `authorBuilding` names a facade after the building. The bar's tile says which one it is, the way
// the airport's departures tile does; `building_name` stays the same on both.
store.patch('zones', eastIds.facadeId, { name: `${NAME} Bar` });

// `authorBuilding` titles a room `Building — Room`. The house voice has no em dashes, and the newer
// buildings say `Building: Room` (the Eastern Marina, the Ironside Clinic), so these do too.
for (const z of store.all('zones')) {
  if (!/^zone_(palais_|util_zone_palais_)/.test(z.id) || !String(z.name).includes(' — ')) continue;
  store.patch('zones', z.id, { name: z.name.replace(' — ', ': ') });
}

// The two anchors' stock lights, which `authorUtilityRoom` writes on insert only.
store.patch('furniture', 'furn_light_zone_palais_stage', {
  name: 'the stage lights',
  description: 'Spotlights on a bar over the stage, and footlights in a trough along the lip. When they are all up the boards look warm and everyone in the stalls looks dark.',
});
store.patch('furniture', 'furn_light_zone_palais_east_bar', {
  name: 'the bar lights',
  description: 'Glass globes on bronze stems along the bar, and the mirror behind it doubles every one.',
});

// ── the middle tile: the stage, which is a building but not a door ───────────
const midId = 'zone_district_909_909';
{
  const prev = store.get('zones', midId) || {};
  const flags = { ...(prev.flags || {}) };
  delete flags.terrain; delete flags.scavenging_table_id; delete flags.street_life;
  store.patch('zones', midId, {
    name: NAME,
    description: 'The middle of the Palais is blind stone with a stepped bay standing out of it, and a bronze blade off the bay with PALAIS down both faces in letters taller than a man. Across its foot runs a marquee ringed with bulbs, the bill in black capitals on milk glass. The stage house rises behind, copper on top.',
    ambient_theme: 'urban', bg_color: '#2a2219', color: '#e8c878',
    marker: 'MH', map_id: 'map_world', parent_zone: null,
    exits: {},
    flags: {
      ...flags,
      building_name: NAME, building_type: 'palais_stage', district,
      entrance: 'north', floors: 5, is_building: true, region_id: 'region_coldwater',
    },
  });
  // Nothing walks into it from outside: cut every neighbour's link to it.
  for (const z of store.all('zones')) {
    if (z.id === midId) continue;
    const links = Object.entries(z.exits || {}).filter(([, t]) => t === midId);
    if (!links.length) continue;
    const exits = { ...z.exits };
    for (const [dir] of links) delete exits[dir];
    store.patch('zones', z.id, { exits });
  }
}

// ── the stalls' east door into the bar, across the two maps ─────────────────
{
  const stalls = 'zone_palais_stalls', bar = 'zone_palais_east_bar';
  store.patch('zones', stalls, { exits: { ...store.get('zones', stalls).exits, east: bar } });
  store.patch('zones', bar, { exits: { ...store.get('zones', bar).exits, west: stalls } });
  const id = 'conn_hf_palais_stalls_east';
  store.patch('connections', id, { a: stalls, b: bar, dir: 'east', id, blocked: false, lockable: false, one_way: false });
}

// The house laid out on its own map, so the minimap draws the stalls beside the foyer and the stage
// below them rather than falling back to the exit graph. The circle is a floor up.
for (const [key, x, y, z] of [['foyer', 0, 0, 0], ['stalls', 1, 0, 0], ['stage', 1, 1, 0], ['dressing', 0, 1, 0], ['circle', 1, 0, 1]]) {
  store.patch('zones', `zone_palais_${key}`, { grid_x: x, grid_y: y, grid_z: z });
}

// ⚠ WALLS THE GRID WOULD OTHERWISE OPEN. `zone_edges` projects an exit between any two cells that
// touch, so a wall has to be said: the stage tile to the street and the park (a facade is exempt,
// a doorless building isn't), and the foyer to the dressing rooms, which sit under it on the grid
// and are reached round through the stage. Priced to Sell carries the same kind of file.
for (const [a, b, dir] of [[midId, 'zone_district_909_908', 'north'], [midId, 'zone_district_909_910', 'south'],
  ['zone_palais_foyer', 'zone_palais_dressing', 'south']]) {
  const id = `conn_hf_${a.replace(/^zone_/, '')}_${dir}`;
  store.patch('connections', id, { a, b, dir, id, blocked: true, lockable: false, one_way: false });
}

// ── the staff live in the Meridian, in a flat nobody had ─────────────────────
// Two to a unit (see npc_residences): Minnie holds the lease, Lionel has the box room.
const home = 'zone_meridian_unit_503';
for (const id of ['npc_palais_boxoffice', 'npc_palais_barman']) {
  store.patch('npcs', id, { home_zone: home, flags: { ...(store.get('npcs', id).flags || {}), personality: 'vendor' } });
}
store.patch('npc_residences', home, { zone_id: home, npc_id: 'npc_palais_boxoffice', note: null });

const written = store.flush({ dryRun: DRY });
console.log(`${DRY ? 'DRY RUN: ' : ''}${written.length} file(s) ${DRY ? 'would be written' : 'written'}`);
console.log(`  west  ${westIds.facadeId}  map ${westIds.mapId}  utility ${westIds.utilityRoomId}`);
console.log(`  east  ${eastIds.facadeId}  map ${eastIds.mapId}  utility ${eastIds.utilityRoomId}`);
console.log(`  stage ${midId}`);
