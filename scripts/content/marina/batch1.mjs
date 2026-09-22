/**
 * FAIRWEATHER MARINA, batch 1 — THE CONSERVATORY.
 *
 *   node scripts/content/marina/batch1.mjs [--dry-run]
 *
 * The covered half of the yard: a glass hall a hull is lifted into, parked in, and
 * worked on. Run after batch0, which lays the quay its door opens onto — before that
 * the tile fails `sitecheck.mjs` with "no standable road neighbour".
 *
 * ⚠ TYPE IS `boathouse`, NAME IS "The Conservatory". The type is engine-side and
 * generic (a second game built on THOMAS can have a boathouse); the joke is content.
 * A conservatory is a glass building AND a place things are conserved, which is the
 * Ascendant promise pointed at a hull instead of at a person — they will keep it from
 * decaying and they will charge you for it.
 *
 * ⚠ THE ONE PERSON IN AN OTHERWISE UNATTENDED MARINA IS THE POINT. The berth plinth
 * outside says NO ATTENDANT IS PROVIDED and means it. Marit is here because a hull
 * needs hands and the quarter has not worked out how to automate that, which makes her
 * the only person on this shore who touches anything.
 *
 * Idempotent: every id derives from the slug, so a re-run is an upsert.
 */
import { authorBuilding, loadContentStore } from '../halcyon/lib.mjs';

const DRY = process.argv.includes('--dry-run');
const store = loadContentStore();

const spec = {
  slug: 'consv', name: 'The Conservatory', type: 'boathouse',
  x: 893, y: 902, entrance: 'south', floors: 2, marker: 'CV', district: 'glasshouse',

  facade: {
    bgColor: '#101820', color: '#bfe3ee',
    description: 'A hall of glass standing on a low chrome plinth, three bays long, with its gable end to the quay and its whole seaward end open onto the water. The glazing is not clear and not opaque: it is etched right through, so what you get is the shape of a hull inside it and the hoist gantry over the shape, and no detail at either. It is lit from within at every hour, evenly, with no bulb anywhere in it you could point to. Cut into the chrome over the doors, small: THE CONSERVATORY. Underneath, smaller again: HULLS KEPT.',
  },

  rooms: [
    { key: 'hall', name: 'The Hall', floor: 'concrete',
      description: 'A clear span the length of three boats, floored in pale epoxy that has been laid in one piece with no joint anywhere in it. Down both sides the cradles: steel frames on castors, four of them holding hulls, chocked and strapped and covered. The travel hoist runs the whole length on a gantry overhead, and at the north end the hall simply stops and becomes the water, a rectangle of black basin lying inside the building with a rubbing strake around three sides of it. The roof is glass. In daylight the whole room is the colour of the sky and in the dark it is the colour of nothing at all.',
      window: {
        name: 'the etched flank',
        description: 'The long wall, etched through so thoroughly that Halcyon Quay beyond it is a grey band with occasional slow shapes in it. Light goes both ways and nothing else does.',
        light: 0.8, visibility: 0.15,
      } },
    { key: 'bench', name: 'The Bench', floor: 'concrete', from: 'hall', dir: 'west',
      description: 'A working bay off the hall, and the first room on this shore that smells of anything. Resin, mostly, and the ghost of acetone. The bench runs the length of the wall in one slab of hardwood scarred to a depth that took years, with the tools racked above it in silhouettes painted onto the board so a gap is visible from across the room. There are no gaps. On the end wall, a stack of moulds, and a hull section cut away to show the lay-up, which is either a teaching aid or an argument somebody won.',
      window: null },
    { key: 'counter', name: 'The Counter', floor: 'boards', from: 'hall', dir: 'east',
      description: 'A narrow room with a chandlery down one side and a counter across the end of it, both in the same hardwood as the bench and by the same hand. Charts in a rack, rolled and labelled. Line on drums by diameter. Shackles, thimbles, fuel cards, fenders, and a shelf of things in boxes that cost more than the boxes suggest. A kettle, which is the single least Ascendant object within half a mile of here and is in plain view.',
      window: null },
    { key: 'loft', name: 'The Gallery', floor: 'boards', from: 'hall', dir: 'up',
      description: 'A mezzanine along the hall\'s west flank at gantry height, railed in steel, with a bed at one end behind a curtain on a track and a desk at the other. From up here you look down the length of the roof glass and out through the open end at the basin. Somebody has hung a single photograph over the desk and it is of a boat, from the water, being driven hard by a person too far off to identify.',
      window: {
        name: 'the roof glass',
        description: 'The whole south pitch of the roof, from the inside. The Glasshouse stands over it and the Spire is a lit line up the corner of the frame.',
        light: 0.85, visibility: 0.35,
      } },
  ],

  utility: {
    name: 'The Tank Room', floor: 'stone',
    description: 'Under the hall: the pumps that keep the dock inside the building at the same level as the basin outside it, and the plant that keeps a glass box at twenty degrees through a Coldwater winter. It is the loudest room in the marina by a long way, which is why it is buried.',
  },

  lights: {
    bench: { name: 'the bench lamps', description: 'Two long tubes on swing arms over the bench, set so close to the work that they throw almost nothing onto the rest of the room.', lumens: 2400 },
    counter: { name: 'the shelf strip', description: 'A warm strip run along under the top shelf, which lights the stock and the hands and leaves the ceiling dark.', lumens: 1400, type: 'lamp' },
    loft: { name: 'the reading lamp', description: 'One shaded lamp on the desk, angled down. From the hall floor it is the only warm thing in the building.', lumens: 900, type: 'lamp' },
  },

  props: [
    { key: 'hoist', room: 'hall', name: 'the travel hoist', objectType: 'fixture',
      description: 'A gantry on rails the length of the hall with two broad slings hanging off it, wide enough to take a hull under the turn of the bilge without marking it. The controls are on a pendant on a coiled lead, and the pendant has exactly four buttons.',
      flags: { aliases: ['hoist', 'gantry', 'crane', 'slings'], marina_hoist: true,
        interactions: { examine: 'The slings are webbing, not wire, and they are clean. Four buttons: up, down, and the two ends of the hall. Everything else about the machine has been taken out of the operator\'s hands.' } } },
    { key: 'dock', room: 'hall', name: 'the wet dock', objectType: 'fixture',
      description: 'The rectangle of open basin lying inside the north end of the hall, with a rubbing strake around three sides and a set of steps down into the water on the fourth. The level inside matches the level outside to within an inch, which is the tank room\'s whole job.',
      flags: { aliases: ['dock', 'wet dock', 'water', 'basin'],
        interactions: { examine: 'You can see straight down it and out under the end wall into the open basin. Something the size of a dog goes past under the surface, unhurried, and does not come back.' } } },
    { key: 'cradles', room: 'hall', name: 'the cradles', objectType: 'furniture',
      description: 'Steel frames on castors, adjustable at eight points, each one holding a hull off its keel and strapped across. Four are occupied. Every cover is fitted rather than draped, and every one has a tag at the bow.',
      flags: { aliases: ['cradles', 'cradle', 'hulls', 'boats', 'covers'],
        interactions: { examine: 'Three of the tags are current. The fourth is two years old, the strapping has been checked since, and the account it is billed to has not lapsed. Somebody is paying to keep a boat they have not come to see.' } } },
    { key: 'bench_top', room: 'bench', name: 'the bench', objectType: 'furniture',
      description: 'One slab of hardwood the length of the wall, scarred to a depth that took years and oiled often enough that the scars are darker than the surface. A vice at each end, one of them with a sailmaker\'s palm hanging off it.',
      flags: { aliases: ['bench', 'workbench', 'slab'], marina_bench: true,
        interactions: { examine: 'The near end is set up for small work and the far end for long. Between them, burnt into the wood with a hot iron and not recently: IF IT GOES BACK IN THE WATER IT WAS DONE PROPERLY.' } } },
    { key: 'moulds', room: 'bench', name: 'the cutaway', objectType: 'decoration',
      description: 'A section of hull sawn clean through and mounted on a stand, showing the lay-up: skin, core, skin, and a stringer let in where the load goes.',
      flags: { aliases: ['cutaway', 'section', 'moulds', 'mould'],
        interactions: { examine: 'A card under it names the layers and their thicknesses. Somebody has written on the card in pencil, in a different hand: "and this is the one that lets go".' } } },
    { key: 'charts', room: 'counter', name: 'the chart rack', objectType: 'furniture',
      description: 'A pigeonhole rack of rolled charts, labelled along the edge. The Basin, the fairway, the approaches, the wrecks.',
      flags: { aliases: ['charts', 'rack', 'chart'],
        interactions: { examine: 'The wreck chart is the one that has been handled. It is also the only one anybody has bothered to keep up to date, and the newest marks on it are in biro.' } } },
    { key: 'kettle', room: 'counter', name: 'the kettle', objectType: 'appliance',
      description: 'An electric kettle with a limescale ring in it, standing on a tray with two mugs and a tin. It is the least Ascendant object within half a mile and it is in plain view of the door.',
      flags: { aliases: ['kettle', 'tin', 'mugs'],
        interactions: { examine: 'Two mugs. One of them gets used.' } } },
  ],

  items: [
    { id: 'item_hull_patch', name: 'hull patch kit', type: 'gear', value: 240, weight: 2,
      description: null,
      flags: {},
      tags: { description: 'A flat tin holding pre-wetted cloth, a sachet of accelerator and a scraper. Slap it over a split and it will hold long enough to get you home, which is all it claims and all it does.', hull_patch: true } },
    { id: 'item_mooring_line', name: 'coil of mooring line', type: 'gear', value: 95, weight: 3,
      description: null,
      flags: {},
      tags: { description: 'Twelve metres of braided line with a spliced eye in one end, stiff enough to be new. It smells faintly of the drum it came off.' } },
    { id: 'item_boat_cover', name: 'fitted hull cover', type: 'gear', value: 310, weight: 5,
      description: null,
      flags: {},
      tags: { description: 'A tailored cover in pale technical cloth with a tag at the bow for a name that has not been written on it yet. It is the single most expensive way there is to stop something getting wet.' } },
  ],

  npc: {
    id: 'npc_consv_marit', name: 'Marit Colvane', sex: 'female', hp: 44,
    homeRoom: 'loft', workRoom: 'counter', shopName: 'The Conservatory',
    description: 'A short, heavy-shouldered woman in her forties in a boiler suit that has been washed so often the colour is a guess. Her forearms are a map of small old burns. She is the only person on this shore with anything under her fingernails, and she keeps her hands where you can see them in a way that reads less as manners and more as somebody who has been asked about them before.',
    clothing: [
      'a faded boiler suit with the sleeves pushed past the elbow',
      'a rubber apron hanging loose, worn only at the bench',
      'steel-capped boots gone pale with resin dust',
      'a thermal layer underneath, because a glass building is a cold building',
    ],
    inventory: [
      { item_id: 'item_hull_patch', price: 300 },
      { item_id: 'item_mooring_line', price: 120 },
      { item_id: 'item_boat_cover', price: 390 },
      { item_id: 'item_dinghy', price: 230 },
    ],
    chitchat: [
      'Colvane runs a thumb along a joint, finds something, and goes back over it.',
      'She turns a shackle over twice, looks at the pin, and puts it in a different tray.',
      'The kettle clicks off behind her. She does not turn round.',
      'She writes a figure on a docket, looks at it, and writes a smaller one underneath.',
      'Somewhere out in the hall a strap creaks as a hull settles a quarter inch into its cradle.',
    ],
    dialogue: {
      root: {
        text: '"Afternoon." She puts down whatever she was holding, which not everybody does. "Berths are on the plinth outside, the machine does all that. Anything with a hull in it, that\'s me."',
        text_by_relation: {
          first: 'The woman behind the counter finishes what she is doing before she looks up, and then looks up properly.\n\n"Marit Colvane." She wipes a hand, considers it, and does not offer it. "I keep the hulls. Berths are the plinth outside, that\'s all automatic and I have nothing to do with it, so don\'t come to me about the rate."\n\nShe says that last part like a woman who has had the conversation.\n\n"If it floats and it\'s yours, I can lift it, park it, or fix it. Usually in that order."',
          known: '"You again." She is already reaching for the docket book. "Lift, park, or fix?"',
          familiar: 'She has the kettle on before you have got the door shut, which is either hospitality or a diagnosis.\n\n"Sit down. I know what you\'ve done to it, I watched you come in."',
        },
        options: [
          { label: 'What do you sell?', next: '__shop__' },
          { label: 'Tell me about the hoist.', next: 'hoist' },
          { label: 'Who owns this place?', next: 'owners' },
          { label: 'Whose boat is the one nobody comes for?', next: 'lapsed' },
          { label: 'Heard anything?', next: 'gossip' },
          { label: 'Nothing for now.', next: 'bye', enabled: true, actions: [], conditions: [] },
        ],
      },
      hoist: {
        text: '"Four buttons." She holds up four fingers and folds them down one at a time. "Up. Down. That end. This end. There used to be eight and they took four off me, because somebody upstairs worked out that the other four were where the mistakes lived."\n\nShe shrugs with one shoulder.\n\n"They were right. I still resent it."',
        options: [
          { label: 'Does it ever drop one?', next: 'drop' },
          { label: 'Back up.', next: 'root' },
        ],
      },
      drop: {
        text: '"Not here." A pause exactly long enough to notice. "Slings are webbing and they get binned on a schedule, whatever they look like. That\'s their rule, not mine, and it\'s a good one. A wire sling tells you it\'s going by looking wrong for a month first. Webbing doesn\'t tell you anything at all."',
        options: [{ label: 'Back up.', next: 'root' }],
      },
      owners: {
        text: '"Halcyon own the water, the stone, the building and the glass." She counts none of it on her fingers. "They don\'t own the tools and they don\'t own me, and that took some arranging."\n\n"They wanted the whole yard automatic. Showed me a machine that was going to do the lay-up. It did, as well. Beautifully. Then it did the next one exactly the same, and the next one after that, and a hull isn\'t a next one, it\'s whatever came in the door."\n\n"So they kept the machine and they kept me. The machine does the covers."',
        options: [
          { label: 'Do they come down here?', next: 'visit' },
          { label: 'Back up.', next: 'root' },
        ],
      },
      visit: {
        text: '"Once a quarter, and never in the wet." She nods at the hall through the doorway. "They like it out there. Stand at the end by the dock, look at the water inside the building, say something about how it\'s the same level. It is the same level. That\'s the pumps, and the pumps are the only part of this place anyone has ever asked me about twice."',
        options: [{ label: 'Back up.', next: 'root' }],
      },
      lapsed: {
        text: 'She does not look out at the hall, which is how you know she knows exactly which one you mean.\n\n"Bay three. Two years in April." She squares the docket book against the counter edge. "Account\'s good. Pays on the day, every quarter, never a word with it."\n\n"I check the straps on that one same as the rest. Turn the engine over twice a year. It\'ll start."\n\nA beat.\n\n"I\'d rather they came and got it. But they\'re paying me to keep it ready, so I keep it ready, and what I think about it isn\'t on the docket."',
        options: [
          { label: 'Do you know who it is?', next: 'lapsed_who' },
          { label: 'Back up.', next: 'root' },
        ],
      },
      lapsed_who: {
        text: '"I know what\'s on the account." She lets that sit. "Which isn\'t the same as knowing, and it isn\'t mine to say either way."\n\n"Ask me again when you\'ve got a hull in here yourself. You\'d be surprised what I\'ll tell somebody who\'s paying me."',
        options: [{ label: 'Fair enough.', next: 'root' }],
      },
      gossip: {
        text: '"Nothing you\'d call news." She thinks about it properly rather than dismissing it. "The Echelon moved. Week before last, middle of the night, out and back inside four hours. Nobody\'s meant to notice that and I notice everything on this water because it all comes past my end wall."\n\n"Other than that: somebody\'s been taking a boat out of the hardstanding at night and putting it back. Covers go on wrong. Whoever it is, they\'re careful with it, which I mind less than I ought to."',
        options: [{ label: 'Back up.', next: 'root' }],
      },
      bye: {
        text: '"Right you are." She has the shackle back in her hand before you are through the door.',
        options: [],
      },
    },
  },
};

const ids = await authorBuilding(store, spec);

// The bench is where a hull gets put right, and the wear plugin's repair path finds its
// repairman by flag on the NPC rather than by name — content-driven, like every other
// role here. She gets gear repair for free by carrying it; the HULL half is the
// boatyard's and reads `marina_bench` on the fixture above.
store.patch('npcs', spec.npc.id, {
  flags: { ...(store.get('npcs', spec.npc.id).flags || {}), repairman: true },
});

const written = store.flush({ dryRun: DRY });
console.log(`${DRY ? 'DRY RUN — ' : ''}${written.length} file(s) ${DRY ? 'would be written' : 'written'}`);
console.log(`  facade ${ids.facadeId}  map ${ids.mapId}  utility ${ids.utilityRoomId}`);
