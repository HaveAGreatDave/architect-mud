/**
 * Halcyon Fields, batch 1b — the rest of the money half.
 *
 * Six buildings on Halcyon Boulevard's south kerb, Kettle Lane's west side and Kerbstone
 * Row's north side. Run after batch0 (the streets) and batch1 (the concert hall).
 *
 *   node scripts/content/halcyon/batch1b.mjs [--dry-run]
 */
import { authorBuilding, loadContentStore } from './lib.mjs';

const DRY = process.argv.includes('--dry-run');
const store = loadContentStore();
const SPECS = [];

// ── Vested Interest ──────────────────────────────────────────────────────────
// A members' club whose membership closed at some point nobody can name, so the porter
// is the last person alive who knows who is entitled to walk in.
SPECS.push({
  slug: 'vested', name: 'Vested Interest', type: 'members_club',
  x: 894, y: 911, entrance: 'north', floors: 4, marker: 'VI', district: 'halcyon_fields',
  facade: {
    bgColor: '#1b1a1e', color: '#c8c0ae',
    description: 'A stone townhouse front with a shallow portico and four steps up to a black door. No sign, no board, no plate, no name anywhere on it. The ground-floor windows are shuttered on the inside and the first-floor ones have been bricked flush and faced over so neatly that you have to look twice. One lamp burns over the door in a wrought bracket, and it is the only lit thing on this stretch of the boulevard after six.',
  },
  rooms: [
    { key: 'hall', name: 'The Hall', floor: 'tile',
      description: 'Black and white stone underfoot in a diamond pattern, and a hall stand with eleven pegs, four of them holding coats. The porter\'s desk faces the door rather than the room. On it, a ledger, a brass bell nobody rings, and a leather-bound book of members that is closed and has a ribbon in it. The staircase goes up into a part of the building the door to the smoking room does not suggest exists.' },
    { key: 'smoking', name: 'The Smoking Room', floor: 'carpet', from: 'hall', dir: 'south',
      description: 'Four leather armchairs at a fireplace that works, arranged so that no two of them face each other directly. The carpet has a track worn from the door to the third chair and nowhere else. On the mantel a clock runs eleven minutes slow and has done for years, because the man who wound it wound it that way and nobody has felt able to correct it.' },
  ],
  utility: { name: 'The Cellar', floor: 'stone',
    description: 'A brick cellar with wine racks along one wall, most of them empty and all of them labelled. The building\'s cabinet is bolted between two of the bays, and somebody has hung a cloth over it so that it is not the first thing you see.' },
  lights: { smoking: { name: 'the standard lamps', description: 'Two floor lamps with parchment shades, set to throw light on the chair arms and not much on anybody\'s face. That is not an accident.', lumens: 700, type: 'lamp' } },
  props: [
    { key: 'desk', room: 'hall', name: 'the porter\'s desk', objectType: 'fixture',
      description: 'A mahogany desk facing the door, with a ledger open on it and a pen laid across the page at a right angle.',
      flags: { aliases: ['desk', 'porter'], vendor_safe: true, vendor_npc_id: 'npc_vested_fewtrell', hack_difficulty: 4 } },
    { key: 'book', room: 'hall', name: 'the book of members', objectType: 'decoration',
      description: 'Leather, closed, with a ribbon marking a page a third of the way in. Nobody has asked to see it in a long time and nobody has needed to.',
      flags: { aliases: ['book', 'members', 'ledger'], interactions: { examine: 'The ribbon marks the last page that was written on. The entries below it are in the same hand as the ones above, and they stop mid-column.' } } },
    { key: 'pegs', room: 'hall', name: 'the hall stand', objectType: 'furniture',
      description: 'Eleven brass pegs in a row, each with a small engraved number and no name. Four coats hang on it. The other seven pegs are polished as often as the four.',
      flags: { aliases: ['stand', 'pegs', 'coats'], interactions: { examine: 'Peg six has a coat on it that has not moved in a very long time, and has been brushed recently.' } } },
    { key: 'chairs', room: 'smoking', name: 'the armchairs', objectType: 'furniture',
      description: 'Four of them in cracked oxblood leather, set at angles that let a man look at the fire rather than at anybody else.',
      flags: { aliases: ['chair', 'chairs', 'armchair'], interactions: { sit: 'You sit. The leather is cold at first and then very much not, and the chair is better than anything you own.' } } },
    { key: 'clock', room: 'smoking', name: 'the mantel clock', objectType: 'decoration',
      description: 'Under a glass dome, running eleven minutes slow, wound every Sunday by somebody who is careful to keep it that way.',
      flags: { aliases: ['clock', 'mantel'], interactions: { examine: 'The key sits beside it on a square of felt. The felt has a clean square in the middle of it where the key lives.' } } },
  ],
  items: [
    { id: 'item_vested_ticket', name: 'a day ticket', type: 'misc', value: 40, weight: 2, description: null, flags: {},
      tags: { stackable: true, description: 'A stiff card with the date written on it in ink and no name, no crest and no address. It admits the bearer for one day and says so in a typeface that assumes you already knew.' } },
    { id: 'item_vested_scotch', name: 'a glass of the club scotch', type: 'drink', value: 30, weight: 110, description: null, flags: {},
      tags: { stackable: false, description: 'A heavy tumbler, a large measure, no ice offered. The bottle it came from has no label on it and lives under the desk rather than behind a bar, because there is no bar.' } },
    { id: 'item_vested_cigar', name: 'a club cigar', type: 'misc', value: 26, weight: 12, description: null, flags: {},
      tags: { stackable: true, description: 'Kept in a cedar box in the cellar and brought up one at a time. It is old enough that it has stopped improving, and everybody here would rather have it than a new one.' } },
  ],
  npc: {
    id: 'npc_vested_fewtrell', name: 'Ambrose Fewtrell', sex: 'male', hp: 36,
    homeRoom: 'smoking', workRoom: 'hall', shopName: 'Vested Interest',
    description: 'A heavy, slow-moving man in a black coat with a velvet collar, standing behind the desk rather than sitting at it. He is perhaps sixty-five and has the stillness of somebody who has spent forty years not being surprised by anybody coming through a door. He knows your name or he does not, and either way his face says nothing about which.',
    clothing: ['a black porter\'s coat with a velvet collar, brushed daily', 'a stiff collar and a plain dark tie', 'black trousers with a crease kept by a press he owns', 'vest and plain underthings'],
    inventory: [
      { item_id: 'item_vested_ticket', price: 40 },
      { item_id: 'item_vested_scotch', price: 30 },
      { item_id: 'item_vested_cigar', price: 26 },
    ],
    chitchat: [
      'Fewtrell squares the pen across the ledger page, a right angle, and looks at it until it is right.',
      'He glances at the hall stand, counts something, and goes back to the desk.',
      'Somewhere behind the smoking-room door a fire settles and somebody says nothing about it.',
      'He wipes a mark off the desk with a cloth he keeps in his sleeve.',
      'The lamp over the door buzzes once. He does not look up, but he writes something in the ledger.',
    ],
    dialogue: {
      root: {
        text: '"Afternoon." He does not move from behind the desk. "Members and their guests. You can take a day ticket if you want to sit down."',
        text_by_relation: {
          first: 'The man behind the desk watches you come up the steps and through the door and does not say anything until you are properly inside, which takes longer than you expect.\n\n"Afternoon. Fewtrell." He inclines his head about an inch. "This is a members\' club. There is no sign because there has never needed to be one."\n\nHe opens the ledger to a fresh line.\n\n"You are not a member. You can be a guest for the day for forty, and that is not me being difficult, it is simply the figure. Coats on the stand, and the fire is lit."',
          known: '"Afternoon." The ledger is already open. "Day ticket, or are you just warming up?"',
          familiar: 'He has the ticket written before you are through the inner door, and turns it on the desk with two fingers.\n\n"Third chair is free," he says. "I have kept the fire up. Don\'t make anything of that."',
        },
        options: [
          { label: 'Who are the members?', next: 'members' },
          { label: 'A day ticket, then.', next: '__shop__' },
          { label: 'How do I join?', next: 'join' },
          { label: 'Why is there no sign?', next: 'sign' },
          { label: 'Heard anything?', next: 'gossip' },
          { label: 'Another time.', next: 'bye', enabled: true, actions: [], conditions: [] },
        ],
      },
      members: {
        text: '"Eleven." He says the number without looking anything up. "Four of them come in most weeks. Two of them I have not seen in over a year and their pegs are kept, and their pegs will go on being kept."\n\n"The rest are somewhere between. That is the whole of it. It is not a large club and it was never meant to be."',
        options: [
          { label: 'And the other five?', next: 'members_gone' },
          { label: 'Back.', next: 'root' },
        ],
      },
      members_gone: {
        text: 'He is quiet for long enough that you think he has decided not to answer.\n\n"Two went up to the Spire," he says. "Properly up, the way they do it. One of them came back down and sat in that room for an hour and did not say a word and has not been back."\n\n"I could not tell you whether that was him. I am not the man to ask and I would not want to be."',
        options: [{ label: 'Back.', next: 'members' }],
      },
      join: {
        text: '"You are asking the wrong man, which is not me putting you off." He turns his hands over once. "A member proposes you and a member seconds you and then the committee sits."\n\n"The committee has not sat in my time here. I do not know who is on it. There is nothing written down that says, and I have looked, because it is the sort of thing a porter ought to know."',
        options: [
          { label: 'So nobody can join?', next: 'join_no' },
          { label: 'Back.', next: 'root' },
        ],
      },
      join_no: {
        text: '"Nobody has, in nineteen years." No complaint in it at all. "The subscriptions still come in. The bank still takes them. The coal still arrives on a Tuesday, and I have never once ordered it."\n\n"Somewhere there is a standing arrangement doing all of this and it has outlived whoever set it up. I keep the place as though the committee will walk in tomorrow, because one day somebody might, and I would like the brass done."',
        options: [{ label: 'Back.', next: 'join' }],
      },
      sign: {
        text: '"If you need to be told what it is, it is not for you." He says it flatly, as a piece of information rather than a snub, and then softens it about a degree. "That was the thinking. I did not do the thinking."\n\n"The practical effect is that half the boulevard has walked past this door for years believing it is somebody\'s house. I have not corrected them."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      gossip: {
        text: '"Men talk in that room and it stays in that room, which is most of what they pay for." A pause. "I will say the land office two doors down has been in twice, asking after the committee."\n\n"He was very polite about it. He wanted to know who could sell the building. I told him the truth, which is that I have no idea, and he wrote that down as though it were an answer he could use."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      bye: { text: '"Sir." He returns to the ledger before you reach the door.', options: [] },
    },
  },
});

// ── Going Concern ────────────────────────────────────────────────────────────
// An auction house whose lots are mostly the effects of people who Ascended and had no
// further use for a dinner service. The catalogue is beautifully written. Nobody bids.
SPECS.push({
  slug: 'going', name: 'Going Concern', type: 'auction_house',
  x: 895, y: 911, entrance: 'north', floors: 4, marker: 'GG', district: 'halcyon_fields',
  facade: {
    bgColor: '#201c1a', color: '#cfc2a4',
    description: 'A wide brick front with a run of clerestory glazing high up under the eaves, because a saleroom is lit from above or it is not lit at all. At street level there is one ordinary door for people and, beside it, a goods door wide enough and high enough to take a piano upright, with a rail let into the stone at ankle height where trolleys have been running into it for years. GOING CONCERN is painted straight onto the brick in a serif two feet tall, and under it, in half the size: VALUATIONS · CLEARANCES · WEDNESDAYS.',
  },
  rooms: [
    { key: 'saleroom', name: 'The Saleroom', floor: 'boards',
      description: 'A long top-lit room with the lots set out down both sides on trestles and the floor left clear in the middle for the trolleys. Every item carries a paper tag on a string. The rostrum is a plain box on a plinth at the far end with three steps up to it and a gavel resting on the rail, and the chairs in front of it are stacked rather than set out, which tells you what Wednesdays are usually like.',
      window: { name: 'the clerestory', description: 'A run of high glazing under the eaves, grey and even, lighting the lots from above the way a saleroom is supposed to be lit. You cannot see out of it and that is the point.', light: 0.7, visibility: 0.15 } },
    { key: 'strong', name: 'The Strongroom', floor: 'concrete', from: 'saleroom', dir: 'south',
      description: 'A windowless room behind the rostrum with a steel door standing open on a bar, and shelving from floor to ceiling holding the lots that do not go out on the trestles. Jewellery, papers, three cased medals, a box of house keys with the addresses still on the fobs. It is colder in here than in the saleroom and it smells faintly of tarnish.' },
  ],
  utility: { name: 'The Loading Bay', floor: 'concrete',
    description: 'Below the saleroom and reached by a hatch and a short iron stair: the bay the goods door feeds, with a hand trolley parked against the wall and a stack of blankets for wrapping. The building\'s cabinet is on the end wall behind a wire cage, out of the way of the barrows.' },
  lights: { strong: { name: 'the strongroom bulkhead', description: 'A single caged bulkhead over the door, which is enough light to read a tag by and not enough to read a document by. That is deliberate.', lumens: 600, type: 'overhead' } },
  props: [
    { key: 'rostrum', room: 'saleroom', name: 'the rostrum', objectType: 'fixture',
      description: 'A plain box on a plinth with three steps up to it and a worn rail across the front. The gavel rests in a groove cut for it.',
      flags: { aliases: ['rostrum', 'gavel', 'podium'], vendor_safe: true, vendor_npc_id: 'npc_going_crake', hack_difficulty: 3 } },
    { key: 'trestles', room: 'saleroom', name: 'the lots', objectType: 'container',
      description: 'Trestle tables down both walls with this week\'s lots laid out on them, each with a numbered paper tag on a string. A dinner service, a carriage clock, a case of surgical instruments, a box of photographs.',
      flags: { aliases: ['lots', 'trestles', 'tables'], interactions: { examine: 'Lot 41 is a box of photographs of people nobody has identified. The catalogue entry for it is four sentences long and is the best writing in the building.' } } },
    { key: 'chairs', room: 'saleroom', name: 'the stacked chairs', objectType: 'furniture',
      description: 'Sixty folding chairs in stacks of ten against the side wall. On a sale day about a dozen come down.',
      flags: { aliases: ['chairs', 'stack'], interactions: { examine: 'The top chair of each stack is clean and the ones underneath are not, which is how you can tell how far down anybody ever gets.' } } },
    { key: 'shelves', room: 'strong', name: 'the strongroom shelving', objectType: 'container',
      description: 'Steel shelving floor to ceiling, holding the small lots: jewellery in trays, papers in tubes, three cased medals, and a box of house keys with the addresses still on the fobs.',
      flags: { aliases: ['shelves', 'shelving', 'keys'], interactions: { examine: 'The key box is the one thing in here nobody has catalogued. There are a great many keys in it and every fob is a street you could walk to.' } } },
  ],
  items: [
    { id: 'item_going_catalogue', name: 'a sale catalogue', type: 'media', value: 5, weight: 16, description: null, flags: {},
      tags: { stackable: true, description: 'This week\'s lots, numbered, each with two or three lines under it. The descriptions are unsigned, exact, and quietly fond of the things they describe, which is not what you expect from a list of other people\'s belongings.' } },
    { id: 'item_going_paddle', name: 'a bidder\'s paddle', type: 'misc', value: 8, weight: 30, description: null, flags: {},
      tags: { stackable: true, description: 'A numbered board on a stick, hardboard, with the number painted on by hand and touched up more than once. Low numbers are kept back for people who come every week, and there are eleven low numbers.' } },
    { id: 'item_going_lotcard', name: 'a lot ticket', type: 'misc', value: 3, weight: 2, description: null, flags: {},
      tags: { stackable: true, description: 'A paper tag on a string with a number on one side and, on the other, a provenance written in a small careful hand. Most of them end with a date and the word CLEARANCE, which means the owner did not sell it and did not need it any more.' } },
  ],
  npc: {
    id: 'npc_going_crake', name: 'Dorothea Crake', sex: 'female', hp: 33,
    homeRoom: 'strong', workRoom: 'saleroom', shopName: 'Going Concern',
    description: 'A small, quick woman in a working apron over good clothes, moving down the trestles with a pencil behind her ear and a catalogue folded back on itself in one hand. She handles everything she passes, briefly, the way somebody does when touching a thing is how they think about it.',
    clothing: ['a canvas work apron with a pencil pocket, worn over everything else', 'a good tweed skirt and jacket that have been very good indeed', 'flat shoes she can stand in for six hours', 'a slip and plain underthings'],
    inventory: [
      { item_id: 'item_going_catalogue', price: 5 },
      { item_id: 'item_going_paddle', price: 8 },
      { item_id: 'item_going_lotcard', price: 3 },
    ],
    chitchat: [
      'Crake lifts a carriage clock, turns it over, reads the base, and puts it back exactly where it was.',
      'She writes something in the catalogue margin and underlines it twice.',
      'She straightens a paper tag so the number faces the aisle.',
      'She stops at the box of photographs and looks at the top one for a moment longer than she needs to.',
      'The pencil comes out from behind her ear, gets used, and goes back.',
    ],
    dialogue: {
      root: {
        text: '"Have a look, nothing\'s roped." She does not stop walking the trestles. "Sale is Wednesday, viewing is every day up to it, and you can handle anything that isn\'t in the strongroom."',
        text_by_relation: {
          first: 'The woman working down the trestles glances up, takes you in, and carries on to the end of the row before she comes back.\n\n"Dorothea Crake. It\'s my sale." She says it without ceremony. "Viewing\'s free and you can pick things up. People are nervous about picking things up. Don\'t be."\n\nShe taps the catalogue against her knuckles.\n\n"Wednesday at two. Bring a paddle or shout, I don\'t care which, but shout clearly."',
          known: '"You again." She is already reaching for the catalogue. "Anything caught you, or are you browsing?"',
          familiar: 'She waves you down the row without looking up from the tag she is writing.\n\n"Lot 41\'s still here," she says. "Fourth week. I have stopped pretending that surprises me and I have not stopped putting it out."',
        },
        options: [
          { label: 'Where does all this come from?', next: 'where' },
          { label: 'Catalogue, please.', next: '__shop__' },
          { label: 'Who buys any of it?', next: 'buyers' },
          { label: 'What\'s in the strongroom?', next: 'strong' },
          { label: 'Heard anything?', next: 'gossip' },
          { label: 'Just looking.', next: 'bye', enabled: true, actions: [], conditions: [] },
        ],
      },
      where: {
        text: '"Clearances, mostly." She stops at a dinner service and turns a plate up to the light without picking the whole stack apart. "Somebody goes up to the Spire, and what they had is suddenly nobody\'s. The firm handling it wants the flat empty by the end of the month and rings me."\n\n"So I get a life, in about forty boxes, and I have a fortnight to work out what any of it was."',
        options: [
          { label: 'That must be grim.', next: 'where_grim' },
          { label: 'Back.', next: 'root' },
        ],
      },
      where_grim: {
        text: '"It would be if I were careless with it." She sets the plate down. "Look at the tags. Every one of those took me a few minutes I did not have to spend."\n\n"Nobody is coming back for this. So the last thing that is ever going to happen to somebody\'s carriage clock is me writing down what it is, correctly, and putting it where somebody can see it. That is not grim. That is the job, and I am good at it."',
        options: [{ label: 'Back.', next: 'where' }],
      },
      buyers: {
        text: '"Eleven regulars and whoever wanders in." A short laugh with nothing bitter in it. "A dealer from the Yards comes for the metal. A woman off Marrow Street buys glass and I have never once seen her resell any of it, so I think she just likes glass."\n\n"Most weeks about a third of the room goes. The rest comes out again the following Wednesday with the same tag on it."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      strong: {
        text: '"Small and valuable, or small and impossible to replace." She nods at the steel door. "Jewellery. Papers. Three sets of medals that nobody has claimed and I will not put on a trestle where somebody can pocket them."\n\n"And a box of house keys. Every fob has an address on it. I have never worked out what to do with that box and I am not going to throw it away."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      gossip: {
        text: '"The concert hall sends me their broken chairs and I send them back mended, which is not a trade either of us has ever discussed out loud." She turns a tag over. "The club won\'t let me value anything. Asked twice."\n\n"And the land office keeps putting a card through my door about relocating to a purpose-built unit. I have got a clerestory and a goods door. He has got a drawing."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      bye: { text: '"Wednesday at two," she says, already three lots further down.', options: [] },
    },
  },
});

// ── Course Correction ────────────────────────────────────────────────────────
// A Halcyon-endowed institute lecturing on continuity of self, to twelve people, run by
// a registrar who has attended every lecture for nineteen years and believes none of it.
SPECS.push({
  slug: 'course', name: 'Course Correction', type: 'institute',
  x: 896, y: 911, entrance: 'north', floors: 4, marker: 'CX', district: 'halcyon_fields',
  facade: {
    bgColor: '#1c1d21', color: '#d2cdb8',
    description: 'A stone box wearing an order of pilasters two storeys tall and a shallow pediment it does not need, up six steps from the boulevard. The inscription across the frieze reads THAT WHICH CONTINUES IS NOT THEREBY THE SAME, which is cut deep and well and is a translation of something nobody here can name the original of. Beneath it, on a modest brass plate at eye height: THE HALCYON INSTITUTE · PUBLIC LECTURES · ADMISSION FREE.',
  },
  rooms: [
    { key: 'theatre', name: 'The Lecture Theatre', floor: 'boards',
      description: 'A raked half-circle of bench seating for a hundred and forty, facing a demonstration bench and a blackboard on a roller that still runs true. The benches are oak with a brass rail along the back of each for the row behind to rest on. The front two rows are worn. Nothing behind them is. A jug of water and one glass stand on the bench, and both are refilled before every lecture whether or not the last one was touched.' },
    { key: 'reading', name: 'The Reading Room', floor: 'carpet', from: 'theatre', dir: 'south',
      description: 'Twelve desks with green shaded lamps, a wall of bound transcripts going back further than the institute has any business going back, and a card index in a cabinet of forty small drawers. Every lecture ever given here is in that index, cross-referenced by subject and by speaker, in one hand throughout.' },
  ],
  utility: { name: 'The Boiler Room', floor: 'stone',
    description: 'Under the theatre, low enough to stoop in: the boiler that keeps a hundred and forty seats at a temperature twelve of them appreciate, and the cabinet that runs the lamps. Somebody has chalked a maintenance schedule on the wall and has been ticking it off for a very long time.' },
  lights: { reading: { name: 'the desk lamps', description: 'Twelve green glass shades on brass stems, one to a desk, all of them switched on before opening whether or not anybody is expected.', lumens: 900, type: 'lamp' } },
  props: [
    { key: 'bench', room: 'theatre', name: 'the demonstration bench', objectType: 'fixture',
      description: 'A long oak bench with a gas tap, a sink and a lip round the edge to stop things rolling off. There is a burn mark near the left end that predates everybody.',
      flags: { aliases: ['bench', 'demonstration'], interactions: { examine: 'The gas tap still works. The sink drains. Neither has been used in years and both are tested every month.' } } },
    { key: 'board', room: 'theatre', name: 'the blackboard', objectType: 'decoration',
      description: 'A rolling board two panels deep on a counterweighted frame that still runs true. The chalk tray is full and the sleeve is clean.',
      flags: { aliases: ['board', 'blackboard'], interactions: { examine: 'The top panel still carries the last lecture: a diagram of two boxes with an arrow between them, and under the second box a question mark somebody drew hard enough to break the chalk.' } } },
    { key: 'index', room: 'reading', name: 'the card index', objectType: 'container',
      description: 'Forty small drawers in an oak cabinet, each with a brass pull and a written label. Every lecture given here is in it, by subject and by speaker.',
      flags: { aliases: ['index', 'cards', 'cabinet'], vendor_safe: true, vendor_npc_id: 'npc_course_quainton', hack_difficulty: 2 } },
    { key: 'transcripts', room: 'reading', name: 'the bound transcripts', objectType: 'container',
      description: 'A wall of them, half-bound in green cloth, spines lettered by hand. The run is unbroken, which over this many years is the kind of thing somebody has to have decided to do.',
      flags: { aliases: ['transcripts', 'books', 'shelves'], interactions: { examine: 'The volumes from the last nineteen years are all in the same hand. The ones before that are in four or five hands and are noticeably worse.' } } },
  ],
  items: [
    { id: 'item_course_transcript', name: 'a bound transcript', type: 'media', value: 18, weight: 210, description: null, flags: {},
      tags: { stackable: false, description: 'One term of lectures, half-bound in green cloth and lettered by hand. Somebody has taken down every word, including the questions from the floor, including the ones that were not really questions.' } },
    { id: 'item_course_card', name: 'a subscription card', type: 'misc', value: 12, weight: 2, description: null, flags: {},
      tags: { stackable: true, description: 'Admits the bearer to the term\'s lectures, which are free, so what it actually buys is a chair kept for you in the second row and your name written in a book. A surprising number of people want that.' } },
    { id: 'item_course_offprint', name: 'a lecture offprint', type: 'media', value: 4, weight: 12, description: null, flags: {},
      tags: { stackable: true, description: 'Eight pages stapled at the corner, run off after the fact. The argument is careful and the conclusion is that the question cannot be settled from the inside, which is not what the endowment was hoping for.' } },
  ],
  npc: {
    id: 'npc_course_quainton', name: 'Hollis Quainton', sex: 'male', hp: 31,
    homeRoom: 'reading', workRoom: 'theatre', shopName: 'The Halcyon Institute',
    description: 'A dry, narrow man of about sixty in a cardigan under a jacket, sitting at the end of the front bench with a notebook open on his knee even when the theatre is empty. He is the registrar, which here means he unlocks the doors, takes down every word, binds the results and has done so for nineteen years without missing one.',
    clothing: ['a grey cardigan with a pen burn on the pocket, under a jacket he does not take off', 'a soft-collared shirt, no tie, because nobody made him', 'corduroy trousers gone shiny at the knee from a notebook', 'vest and plain underthings'],
    inventory: [
      { item_id: 'item_course_transcript', price: 18 },
      { item_id: 'item_course_card', price: 12 },
      { item_id: 'item_course_offprint', price: 4 },
    ],
    chitchat: [
      'Quainton turns a page of the notebook, finds it blank, and turns it back.',
      'He checks the water jug on the bench, which is full, and sets it a half inch to the left.',
      'He runs the blackboard up and down once on its counterweight, listening to it rather than looking.',
      'He reads something in his own handwriting, frowns at it, and does not change it.',
      'He counts the front two rows under his breath and gets the number he got last week.',
    ],
    dialogue: {
      root: {
        text: '"Come in, it\'s free." He does not get up. "Thursdays at seven, and the subject is on the card by the door. You can sit anywhere. You will have a lot of choice."',
        text_by_relation: {
          first: 'The man on the front bench looks up from a notebook, takes his time about it, and then stands after all, which seems to cost him something.\n\n"Hollis Quainton, registrar." A short nod. "Public lectures, Thursdays at seven, admission free and it says so outside because it is true."\n\nHe indicates the empty benches without apology.\n\n"A hundred and forty seats and we get twelve. I record every word regardless, and it is bound at the end of term, and it goes on that wall. You may find that absurd. I have made my peace with it."',
          known: '"You came back." He marks his place with a finger. "Thursday, seven. Same bench is free, they all are."',
          familiar: 'He has the offprint out of the drawer before you have said anything, and holds it out at arm\'s length.\n\n"You will want to argue with page five," he says. "Everybody who is paying attention argues with page five. Come on Thursday and argue with it out loud, and I will write down what you said."',
        },
        options: [
          { label: 'What are the lectures about?', next: 'subject' },
          { label: 'What have you got?', next: '__shop__' },
          { label: 'Who funds this?', next: 'funds' },
          { label: 'Do you believe any of it?', next: 'believe' },
          { label: 'Heard anything?', next: 'gossip' },
          { label: 'Another time.', next: 'bye', enabled: true, actions: [], conditions: [] },
        ],
      },
      subject: {
        text: '"Continuity of self." He says it the way a man says a word he has said several thousand times. "Whether the thing that walks out of a vat is the thing that walked into one. Whether it matters. What would settle it, if anything could."\n\n"It is not a mystical question and we do not treat it as one. It is a question about identity over time and the fact that a machine is involved changes nothing about the structure of it."',
        options: [
          { label: 'And the answer?', next: 'subject_answer' },
          { label: 'Back.', next: 'root' },
        ],
      },
      subject_answer: {
        text: '"There isn\'t one that can be reached from where we are standing." He is quite cheerful about it. "You cannot check from the inside, because whatever came out is satisfied that it is you. And you cannot check from the outside, because everything you could measure is the same."\n\n"Nineteen years of transcripts on that wall and the honest summary is on page five of every offprint we have ever printed. I do not think that is a failure. I think it is the shape of the question."',
        options: [{ label: 'Back.', next: 'subject' }],
      },
      funds: {
        text: '"Halcyon Assurance." He waits to see whether that lands. "An endowment, like the hall down the road, and terms drawn up by somebody with a sense of duty and no sense of what it would look like in forty years."\n\n"They wanted a public institute considering the philosophical basis of continuity. They got one. I do not think it has ever occurred to anybody there to check what it has been concluding."',
        options: [
          { label: 'What if they did check?', next: 'funds_check' },
          { label: 'Back.', next: 'root' },
        ],
      },
      funds_check: {
        text: 'He closes the notebook on his finger.\n\n"Then somebody would read the transcripts, and somebody would notice that an institute they pay for has spent nineteen years failing to endorse the thing they sell, and the terms would be looked at."\n\n"I have thought about that more than I would like. I have never once softened a word of a transcript because of it. If that is the day it stops, then it stops having been honest, and that is the only version of stopping I could stand."',
        options: [{ label: 'Back.', next: 'funds' }],
      },
      believe: {
        text: 'A long pause. He looks at the blackboard rather than at you.\n\n"I have taken down every argument made in this room for nineteen years, on both sides, by people cleverer than me." He taps the notebook. "And I would not get in the vat."\n\n"That is not an argument. I want to be clear that I know it is not an argument. It is a thing about me and not a thing about the question, and I would not put it in a transcript."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      gossip: {
        text: '"We share a wall with a club that has not admitted anybody in nineteen years, which I find restful." He almost smiles. "Somebody from the Spire came to a lecture in the spring. Sat at the back. Asked one question and it was a good one."\n\n"He has not come again. I wrote the question down."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      bye: { text: '"Thursdays at seven," he says, and finds his page again.', options: [] },
    },
  },
});

// ── Plot Twist ───────────────────────────────────────────────────────────────
// A land office selling plots in a quarter that is mostly still grass, from behind a
// hoarding showing a finished one. One room, because that is the whole enterprise.
SPECS.push({
  slug: 'plot', name: 'Plot Twist', type: 'land_office',
  x: 897, y: 911, entrance: 'north', floors: 2, marker: 'PT', district: 'halcyon_fields',
  facade: {
    bgColor: '#1a1e1c', color: '#cfd6c4',
    description: 'A single-storey glazed office not much bigger than a shed, and bolted to the front of it on a scaffold frame, twice its height and three times its width, a hoarding. The artist\'s impression on it shows a boulevard of pale buildings under a blue sky, with trees at even spacing and people walking in both directions. The trees are not here. The people are not here. Under the picture, in letters a foot high: HALCYON FIELDS · PLOTS RELEASED · ENQUIRE WITHIN.',
  },
  rooms: [
    { key: 'office', name: 'The Office', floor: 'linoleum',
      description: 'One room, warm, lit hard, with a desk, two chairs on the visitor side and a plan of the quarter pinned across the whole back wall under a sheet of perspex. The plan is beautiful. Every plot on it is numbered and hatched and about a fifth of them are coloured in, which on this plan means sold. Through the glass behind you the actual quarter is a field with a road in it.',
      window: { name: 'the shopfront glass', description: 'The full width of the office, giving onto Halcyon Boulevard and, past it, the meadow. The glass is cleaned twice a week by somebody who takes it seriously.', light: 0.6, visibility: 0.85 } },
  ],
  utility: { name: 'The Store', floor: 'concrete',
    description: 'A cellar under the office reached by a trap behind the desk, holding the rolled plans, a stack of unused hoarding panels in a different colour scheme, and the cabinet. The spare panels show the same boulevard with a bandstand on it.' },
  lights: {},
  props: [
    { key: 'plan', room: 'office', name: 'the plan of the quarter', objectType: 'decoration',
      description: 'Pinned across the back wall under perspex: every plot numbered and hatched, about a fifth of them coloured in. It is drawn well enough to be worth looking at as a drawing.',
      flags: { aliases: ['plan', 'map', 'wall'], interactions: { examine: 'The coloured plots are scattered rather than grouped, which is what it looks like when the sales are real and the buyers chose for themselves. Three of them are along the Curtain, where the view is a wall.' } } },
    { key: 'desk', room: 'office', name: 'the desk', objectType: 'fixture',
      description: 'A steel desk with a blotter, a tray of forms, a jug of water for visitors and a tin cash box in the left drawer.',
      flags: { aliases: ['desk', 'box', 'drawer'], vendor_safe: true, vendor_npc_id: 'npc_plot_follet', hack_difficulty: 2 } },
    { key: 'model', room: 'office', name: 'the presentation model', objectType: 'decoration',
      description: 'A card-and-balsa model of the quarter on a table by the window, under a dust cover that comes off for appointments. The trees are dyed sponge. Somebody has made the streetlamps out of pins.',
      flags: { aliases: ['model', 'balsa'], interactions: { examine: 'The concert hall on the model is right. The works at the other end are right. Everything between them is buildings that do not exist, made with exactly as much care as the two that do.' } } },
  ],
  items: [
    { id: 'item_plot_prospectus', name: 'a plot prospectus', type: 'media', value: 0, weight: 40, description: null, flags: {},
      tags: { stackable: true, description: 'Twelve pages, thick paper, good printing. Elevations, a schedule of plot sizes, a page about drainage that is more honest than the rest of it, and the same boulevard on the cover as on the hoarding outside.' } },
    { id: 'item_plot_plan', name: 'a rolled plan', type: 'media', value: 15, weight: 90, description: null, flags: {},
      tags: { stackable: true, description: 'A copy of the wall plan, rolled in a tube, with the sold plots left uncoloured so you can colour your own in. Drawn to a scale you could actually build from, which is not true of most drawings in this city.' } },
    { id: 'item_plot_pen', name: 'a Halcyon Fields pen', type: 'misc', value: 6, weight: 10, description: null, flags: {},
      tags: { stackable: true, description: 'A good heavy pen with the development name down the barrel in gold. He gives these away to anybody who sits down, and he had them made before a single plot sold.' } },
  ],
  npc: {
    id: 'npc_plot_follet', name: 'Merrick Follet', sex: 'male', hp: 30,
    homeRoom: 'office', workRoom: 'office', shopName: 'Plot Twist',
    description: 'A neat, hopeful man in his forties in a suit that is pressed every single day, standing up the moment the door moves. He has the plan, the model, the prospectus and the pens, and he believes in all of it without any visible effort, which is either the most impressive or the most alarming thing about him.',
    clothing: ['a pressed grey suit, the jacket kept on indoors whatever the weather', 'a clean white shirt and a development-coloured tie', 'good shoes he polishes at the desk when it is quiet', 'vest and plain underthings'],
    inventory: [
      { item_id: 'item_plot_prospectus', price: 0 },
      { item_id: 'item_plot_plan', price: 15 },
      { item_id: 'item_plot_pen', price: 6 },
    ],
    chitchat: [
      'Follet takes the dust cover off the model, checks it, and puts the cover back on.',
      'He squares the tray of forms against the edge of the blotter.',
      'He looks out at the meadow for a moment with an expression that is entirely unclouded.',
      'He colours a hatched plot on the wall plan very carefully, right up to the line.',
      'He breathes on the perspex over the plan and polishes the spot out with his sleeve.',
    ],
    dialogue: {
      root: {
        text: '"Come in, come in." He is already up and round the desk. "Are you looking at plots, or are you just out of the wind? Either is fine, but sit down for the second one too."',
        text_by_relation: {
          first: 'The door has barely moved before the man behind the desk is on his feet and coming round it with his hand out.\n\n"Merrick Follet. Halcyon Fields." He says the name of the development the way other people say the name of a person they love. "Have you seen the plan? Come and see the plan, it costs nothing and it is genuinely good."\n\nHe steers you at the back wall without quite touching you.\n\n"Forty-one plots released. Nine gone. Drainage is in, the spine road is in, and the row is cut all the way to the wall. This is not a drawing of a place that might happen. Some of it is outside that window."',
          known: '"There you are." He is up before you are through. "Two more coloured in since you were last here. I will not say which, it spoils it."',
          familiar: 'He has the tube out from under the desk before the door has shut.\n\n"I kept you a plan," he says, and then, with the first crack you have ever heard in it, "nobody has asked for one in a fortnight. Take it anyway."',
        },
        options: [
          { label: 'What are you actually selling?', next: 'selling' },
          { label: 'What have you got?', next: '__shop__' },
          { label: 'Who bought the nine?', next: 'nine' },
          { label: 'The hoarding doesn\'t match the street.', next: 'hoarding' },
          { label: 'Heard anything?', next: 'gossip' },
          { label: 'Not today.', next: 'bye', enabled: true, actions: [], conditions: [] },
        ],
      },
      selling: {
        text: '"Ground." He taps the perspex. "A numbered plot, with the road already made up to it, drainage already under it and a title that is clean, which in this city is not nothing."\n\n"What you put on it is your business. I am not selling you a house. I have never once told anybody I was selling them a house, whatever the picture outside suggests, and I did not choose the picture."',
        options: [
          { label: 'Who did choose it?', next: 'selling_who' },
          { label: 'Back.', next: 'root' },
        ],
      },
      selling_who: {
        text: '"The firm that owns the land, and they are not on this street." He says it evenly. "I asked for a photograph of the row as it actually is. I was sent that instead, with the trees on it."\n\n"I put it up because it is my job to put it up. I also put the model in the window, which is the same quarter with nothing on the plots, because anybody who walks in ought to be able to see both."',
        options: [{ label: 'Back.', next: 'selling' }],
      },
      nine: {
        text: '"Three to one man, who has said nothing about what he wants them for and paid without arguing." He counts on his fingers, enjoying it. "Two to the works at the east end, which is expansion and is the best sign we have had."\n\n"One to a woman who wants a garden and nothing else on it at all, which I have written into the deed. And three along the wall, cheap, because the view is the Curtain."',
        options: [
          { label: 'Who buys a plot facing the wall?', next: 'nine_wall' },
          { label: 'Back.', next: 'root' },
        ],
      },
      nine_wall: {
        text: '"People who have looked at the price and then at the wall and decided the wall is quiet." He shrugs, cheerfully. "It hums. It does not move, it does not change, and nothing comes through it. You could do a great deal worse for a neighbour."\n\n"I would take one myself if I were allowed to buy here, and I am not, because I sell them."',
        options: [{ label: 'Back.', next: 'nine' }],
      },
      hoarding: {
        text: 'He looks out at the meadow with you for a second, entirely unbothered.\n\n"No. Not yet." He turns back. "Everything on that board is buildable on the ground it is drawn on. I have checked it against the plan myself, plot by plot, and the only liberty it takes is the trees, and you could plant the trees."\n\n"It is not a lie. It is early. Those are different things and I am aware that from out there they look identical."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      gossip: {
        text: '"The club two doors down will not tell me who owns their building, and I think it is because they genuinely do not know." He shakes his head, delighted. "The auction house thinks I am trying to move her out. I am not. I would like her to buy the plot behind her and put a proper store on it."\n\n"And the hall will not discuss the forecourt. I only wanted to measure it. It is the best-proportioned piece of ground in the quarter and there is gravel on it."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      bye: { text: '"Take a prospectus," he says. "They are free and I have hundreds."', options: [] },
    },
  },
});

// ── Second Wind ──────────────────────────────────────────────────────────────
// A convalescent hydro for people recovering from chrome. Rest, light and a glass of
// mineral water, which works about as well as anything else and costs a great deal less.
SPECS.push({
  slug: 'wind', name: 'Second Wind', type: 'hydro',
  x: 898, y: 913, entrance: 'east', floors: 4, marker: 'WN', district: 'halcyon_fields',
  facade: {
    bgColor: '#1a1d1f', color: '#cddbd8',
    description: 'A pale rendered block stepped back at every floor, so that each storey gives the one below it a balcony running the full width, and every balcony faces south across the meadow. The rails are painted white and repainted often. There are more chairs on them than there are people in them. At street level a modest door under a glass canopy, and a plate beside it reading SECOND WIND · CONVALESCENT ROOMS · NO APPOINTMENT NEEDED.',
  },
  rooms: [
    { key: 'day', name: 'The Day Room', floor: 'linoleum',
      description: 'A long room with the south wall almost entirely glass, giving onto the first balcony and the meadow past it. Cane chairs with blankets folded over the arms, set in twos and threes facing out rather than in. A trolley with a urn on it, a stack of thick white cups, and a jug of the water with a card propped against it giving the analysis in milligrams per litre, which somebody had done properly at some expense.',
      window: { name: 'the south glass', description: 'Almost the whole wall, onto the balcony and the open meadow beyond it. The light comes in all afternoon and is most of the treatment.', light: 0.85, visibility: 0.9 } },
    { key: 'balcony', name: 'The Balcony', floor: 'tile', from: 'day', dir: 'south',
      description: 'A deep balcony the full width of the building, open to the south, with eight steamer chairs along it and a low white rail. From here the quarter reads as what it is: a new road, a hoarding, three buildings, and a great deal of grass going down to a wall of light. It is quiet enough that you can hear the wall.' },
  ],
  utility: { name: 'The Pump Room', floor: 'tile',
    description: 'Below the day room: the tank the mineral water is drawn into, the pump that lifts it, and the cabinet. The tank is scrubbed weekly and there is a chart on the wall recording it, initialled every time.' },
  lights: {
    balcony: { name: 'the balcony lamps', description: 'A run of shaded lamps under the soffit, kept low, because the point of the balcony is the outside and a bright lamp puts your own reflection on it.', lumens: 500, type: 'lamp' },
  },
  props: [
    { key: 'chairs', room: 'day', name: 'the cane chairs', objectType: 'furniture',
      description: 'Set in twos and threes facing the glass rather than each other, each with a folded blanket over the arm. The blankets are heavier than they look and are the reason anybody stays.',
      flags: { aliases: ['chair', 'chairs', 'cane'], interactions: { sit: 'You sit facing the meadow. The blanket goes over your knees before you have decided whether you wanted it to.' } } },
    { key: 'urn', room: 'day', name: 'the water trolley', objectType: 'fixture',
      description: 'An urn, a stack of thick white cups, and a jug of the mineral water with its analysis propped against it on a card.',
      flags: { aliases: ['trolley', 'urn', 'jug', 'water'], vendor_safe: true, vendor_npc_id: 'npc_wind_marchbank', hack_difficulty: 2 } },
    { key: 'chart', room: 'day', name: 'the treatment chart', objectType: 'decoration',
      description: 'A framed card listing the regime: rest, air, light, the water, and a walk to the end of the balcony and back when you feel able.',
      flags: { aliases: ['chart', 'card', 'regime'], interactions: { examine: 'At the bottom, in a different hand and clearly added later: AND NOT TO BE ALONE. That line has been gone over twice in ink.' } } },
    { key: 'steamers', room: 'balcony', name: 'the steamer chairs', objectType: 'furniture',
      description: 'Eight of them along the rail, slatted, with footrests that pull out. They are turned to face the meadow and the wall beyond it.',
      flags: { aliases: ['steamer', 'chairs', 'deck'], interactions: { sit: 'The slats take your weight with a series of small complaints and then hold. The wall hums, a long way off, and you get used to it faster than you expect.' } } },
  ],
  items: [
    { id: 'item_wind_water', name: 'a glass of the water', type: 'drink', value: 4, weight: 220, description: null, flags: {},
      tags: { stackable: false, description: 'Drawn from the tank downstairs, cold, faintly mineral, faintly metallic. The analysis card says what is in it to three decimal places. What it does for a healing body is probably nothing, and drinking it is a reason to sit still for five minutes, which is not nothing.' } },
    { id: 'item_wind_blanket', name: 'a convalescent blanket', type: 'misc', value: 55, weight: 900, description: null, flags: {},
      tags: { stackable: false, description: 'Grey wool, heavier than it looks, with SECOND WIND stitched into one corner in white. People take them and people bring them back, and the count has stayed about right for years.' } },
    { id: 'item_wind_week', name: 'a week of rooms', type: 'misc', value: 180, weight: 2, description: null, flags: {},
      tags: { stackable: true, description: 'A card entitling the bearer to a bed, the day room, the balcony and the water for seven days. It is cheap because the treatment is cheap: the building faces south and somebody keeps an eye on you.' } },
  ],
  npc: {
    id: 'npc_wind_marchbank', name: 'Ottilie Marchbank', sex: 'female', hp: 37,
    homeRoom: 'balcony', workRoom: 'day', shopName: 'Second Wind',
    description: 'A broad, unhurried woman in a starched apron over a grey dress, moving between the chairs with a jug in one hand. She looks at everybody who comes in the way a person looks at a thing they are about to be responsible for, and having looked, she stops looking, which is a kindness most people here have not had recently.',
    clothing: ['a starched white apron over everything, changed twice a day', 'a plain grey nursing dress with the sleeves rolled to the elbow', 'soft-soled shoes for a floor she crosses four hundred times a day', 'a slip and plain underthings'],
    inventory: [
      { item_id: 'item_wind_water', price: 4 },
      { item_id: 'item_wind_blanket', price: 55 },
      { item_id: 'item_wind_week', price: 180 },
    ],
    chitchat: [
      'Marchbank tops up a cup nobody has asked her to top up and moves on before it can become a conversation.',
      'She folds a blanket over a chair arm, squares it, and leaves it there for whoever sits down next.',
      'She looks along the balcony, counts the chairs that are occupied, and goes back to the urn.',
      'She opens the south door two inches and leaves it, because the room was getting close.',
      'She writes a time against a name on the board by the trolley.',
    ],
    dialogue: {
      root: {
        text: '"Sit down before you say anything." She nods at the chairs facing the glass. "There\'s water and there\'s a blanket, and neither of them costs you anything to try."',
        text_by_relation: {
          first: 'The woman with the jug looks at you, properly, for about two seconds: your colour, how you are standing, what you are favouring. Then she stops, which is the part you notice.\n\n"Ottilie Marchbank. Sit facing the window."\n\nShe says it as an instruction rather than an offer, and she is already pouring.\n\n"You do not have to tell me what was done to you. Half the people in these chairs have got something in them that was not there last year, and I have never once asked. The regime is on the wall. It is four things and none of them are clever."',
          known: '"You know where the chairs are." The jug is already moving. "South end is warmer this time of day."',
          familiar: 'She has a blanket over the arm of the end chair before you have crossed the room, and the water poured.\n\n"You are standing better than the last time," she says, and goes back to the urn without waiting to be thanked, which is deliberate.',
        },
        options: [
          { label: 'What is this place?', next: 'what' },
          { label: 'What have you got?', next: '__shop__' },
          { label: 'Does the water do anything?', next: 'water' },
          { label: 'Who ends up here?', next: 'who' },
          { label: 'Heard anything?', next: 'gossip' },
          { label: 'Maybe later.', next: 'bye', enabled: true, actions: [], conditions: [] },
        ],
      },
      what: {
        text: '"Rooms and a balcony." She indicates the glass. "Every floor is stepped back so every floor faces south, which is the only clever thing about the building and it was done before I got here."\n\n"People come out of a clinic with something new in them and nowhere quiet to go. They come here for a week and they sit in the light and somebody counts them twice a day. That is the service."',
        options: [
          { label: 'That\'s all?', next: 'what_all' },
          { label: 'Back.', next: 'root' },
        ],
      },
      what_all: {
        text: '"That is all, and I will not pretend otherwise to anybody in a chair." She says it without any edge. "I am not a surgeon and there is not one thing in this building that could put right what a bad fitting does."\n\n"What I can tell you is that the ones who go somewhere warm and quiet for a week do better than the ones who go back to a room on their own. I have watched it for eleven years. I cannot tell you why and I have stopped needing to."',
        options: [{ label: 'Back.', next: 'what' }],
      },
      water: {
        text: '"Probably not." She laughs, briefly. "There is an analysis on the card and it is real, and what it says is that there is a bit of iron in it and a bit of sulphur and it will not hurt you."\n\n"It is cold, it is free with a room, and drinking a glass of it takes five minutes you would otherwise spend getting up. I sell it as water. The building is called what it is called and I did not name it."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      who: {
        text: '"Chrome, mostly." She sets the jug down. "First-timers who did not know it would hurt. Old hands who have had something taken out rather than put in, which is worse and nobody warns them."\n\n"And a few who have nothing wrong with them at all and simply cannot be where they live. I have never turned one of those away and I never will."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      gossip: {
        text: '"The glasshouse down the row sends up flowers on a Friday and will not take anything for them." A small, real warmth. "The hall keeps asking me to send people to concerts, and I have started to, because sitting still for an hour listening to something is the regime with better company."\n\n"The land office wants me to buy the plot next door and put another wing on it. He may be right. I have not got the money and he knows that and he keeps asking anyway, nicely."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      bye: { text: '"Sit for a bit before you go out," she says. "The wind comes up the row."', options: [] },
    },
  },
});

// ── Glass Half Full ──────────────────────────────────────────────────────────
// A winter garden under a glazed barrel vault, heated by waste heat piped from the works
// across the road. The gardener thinks that is the best arrangement anybody here has made.
SPECS.push({
  slug: 'glass', name: 'Glass Half Full', type: 'winter_garden',
  x: 896, y: 915, entrance: 'south', floors: 2, marker: 'GF', district: 'halcyon_fields',
  facade: {
    bgColor: '#141d18', color: '#b8d9c0',
    description: 'A glazed barrel vault on a low brick plinth, running the depth of the plot, with cast-iron ribs at close centres and a ridge vent open a hand\'s width along its whole length whatever the weather. From outside the glass is green with what is behind it rather than with algae. Where the vault meets the plinth at the north end, a lagged pipe as thick as a thigh comes up out of the ground, crosses the path on two brick piers and goes in through the wall, and it is warm to the touch.',
  },
  rooms: [
    { key: 'house', name: 'The Long House', floor: 'stone',
      description: 'Under the vault: a flagged central path with staging down both sides, and above you a barrel of glass with the ribs black against it. It is hot, and wet, and the air is heavy in a way nothing else in this city is. Ferns at the cool end, then citrus in tubs, then at the far end, where the pipe comes in and the heat is worst, things with leaves the size of a door that should not be alive at this latitude and plainly are.',
      window: { name: 'the vault', description: 'The whole roof. Grey light comes down through the glass and the ribs lay black stripes across everything under it, and when it rains you cannot hear yourself think in here.', light: 0.8, visibility: 0.5 } },
  ],
  utility: { name: 'The Stokehold', floor: 'stone',
    description: 'Where the pipe comes in: a brick chamber with the heat exchanger in it, ticking, and the cabinet on the wall beside it. A thermometer on a nail has a pencil line drawn beside the mark she wants it at, and it is sitting on the line.' },
  lights: {},
  props: [
    { key: 'staging', room: 'house', name: 'the staging', objectType: 'container',
      description: 'Slatted benches down both sides of the path, holding trays of seedlings, cuttings in jars and pots turned regularly so nothing leans.',
      flags: { aliases: ['staging', 'bench', 'trays', 'pots'], vendor_safe: true, vendor_npc_id: 'npc_glass_lound', hack_difficulty: 2 } },
    { key: 'pipe', room: 'house', name: 'the heat main', objectType: 'fixture',
      description: 'A lagged pipe as thick as a thigh, coming through the north wall on brick piers and running the length of the house under the staging. It is warm along its whole run and the ferns nearest it are the biggest in the building.',
      flags: { aliases: ['pipe', 'main', 'heat'], interactions: { examine: 'There is no meter on it anywhere. Whatever arrangement put this pipe here was made between two people rather than between two firms.' } } },
    { key: 'citrus', room: 'house', name: 'the citrus tubs', objectType: 'furniture',
      description: 'Six half-barrels down the middle of the path with lemon and something that might be a bitter orange, all of them fruiting, none of them as tall as they should be.',
      flags: { aliases: ['citrus', 'tubs', 'lemon', 'trees'], interactions: { examine: 'Each tub has a date burnt into the rim. The oldest is nineteen years ago and it is still the best of them.' } } },
    { key: 'vent', room: 'house', name: 'the ridge vent', objectType: 'fixture',
      description: 'A continuous vent along the ridge worked by a rack and a long crank handle at the cool end, standing open a hand\'s width.',
      flags: { aliases: ['vent', 'ridge', 'crank'], interactions: { examine: 'The crank is polished where a hand goes and there is chalk on the wall beside it recording the setting, changed twice a day, every day.' } } },
  ],
  items: [
    { id: 'item_glass_cutting', name: 'a rooted cutting', type: 'misc', value: 9, weight: 120, description: null, flags: {},
      tags: { stackable: true, description: 'Taken, struck and potted on, with a stick label giving what it is and the date it took. She will tell you where to stand it and how often to water it and she will not sell you one that cannot live where you are going to put it.' } },
    { id: 'item_glass_seed', name: 'a paper of seed', type: 'misc', value: 5, weight: 8, description: null, flags: {},
      tags: { stackable: true, description: 'A folded paper packet with the name written on the fold and the year under it. Saved here rather than bought in, which means it has already survived one season in this city.' } },
    { id: 'item_glass_tea', name: 'a cup of tea in the warm', type: 'drink', value: 3, weight: 180, description: null, flags: {},
      tags: { stackable: false, description: 'Made on a ring in the stokehold and drunk standing up among the ferns. The cup is warm before the tea is in it, because everything in this building is.' } },
  ],
  npc: {
    id: 'npc_glass_lound', name: 'Cressida Lound', sex: 'female', hp: 34,
    homeRoom: 'house', workRoom: 'house', shopName: 'Glass Half Full',
    description: 'A weathered woman in her fifties in shirtsleeves whatever the season, because the season stops at the door. Her forearms are scratched, her hands are ingrained past washing, and she is usually holding something she has just decided about. She talks to you over her shoulder while she finishes what she is doing, and then gives you her whole attention at once.',
    clothing: ['a man\'s shirt with the sleeves rolled past the elbow, wet at the cuffs', 'a canvas apron with a pocket of stick labels and a pencil', 'heavy trousers and boots that have never once been clean', 'a vest and plain underthings'],
    inventory: [
      { item_id: 'item_glass_cutting', price: 9 },
      { item_id: 'item_glass_seed', price: 5 },
      { item_id: 'item_glass_tea', price: 3 },
    ],
    chitchat: [
      'Lound turns a pot a quarter turn and moves to the next one, and the next, all down the bench.',
      'She pinches something out between finger and thumb and drops it in her apron pocket rather than on the floor.',
      'She puts a hand flat on the heat main, holds it there a second, and nods at nothing.',
      'Water drips off the ribs somewhere behind you and lands on a leaf the size of a tray.',
      'She writes a date on a stick label, pushes it into a pot, and reads it back.',
    ],
    dialogue: {
      root: {
        text: '"Shut it behind you." She does not look round immediately. "Mind the tubs. You can go all the way down, it is just hotter at the far end."',
        text_by_relation: {
          first: 'The door swings shut behind you and the air changes completely, and the woman at the staging finishes potting the thing in her hands before she turns round.\n\n"Cressida Lound. Shut it properly, that is the whole building." She wipes her hands on the apron. "This is a winter garden. There is no admission, there is no tour, and you may walk to the far end and back as many times as you like."\n\nShe nods down the path at the leaves the size of doors.\n\n"People come in here in the middle of winter and stand about for an hour and buy nothing. That is what it is for, and it is heated for nothing, so I am not losing by it."',
          known: '"You know the way." She is already turning back to the bench. "Far end is worth it today, the big one has opened."',
          familiar: 'She has the kettle on before she has said anything, and calls down the path over the ferns.\n\n"Come and look at the lemon," she says. "Nineteen years and it has finally done something interesting. I am not going to tell you what, you can walk down."',
        },
        options: [
          { label: 'How is this warm?', next: 'heat' },
          { label: 'What have you got?', next: '__shop__' },
          { label: 'Who pays for all this?', next: 'pays' },
          { label: 'What grows down the far end?', next: 'far' },
          { label: 'Heard anything?', next: 'gossip' },
          { label: 'Just passing through.', next: 'bye', enabled: true, actions: [], conditions: [] },
        ],
      },
      heat: {
        text: 'She puts a hand on the lagged main running under the staging, and leaves it there.\n\n"That comes from the works at the other end of the row. They make cold for the vats, and making cold makes heat, and that heat has to go somewhere or it goes into the sky."\n\n"It comes in here instead. There is no meter on it. There is no contract on it either, before you ask, and I have thought about that a good deal."',
        options: [
          { label: 'No contract?', next: 'heat_deal' },
          { label: 'Back.', next: 'root' },
        ],
      },
      heat_deal: {
        text: '"A man at the plant and me, standing in the road, about six years ago." She is plainly still pleased about it. "He had heat he was throwing away and a pipe run he had to make anyway. I had a glass house and no coal."\n\n"It is the best arrangement anybody in this quarter has made and it is not written down anywhere. If he goes, I do not know what happens. So I send him lemons, and that is not a joke, I actually do."',
        options: [{ label: 'Back.', next: 'heat' }],
      },
      pays: {
        text: '"The plot came with the development and the glass came out of the ground, more or less." She taps a cast rib with a knuckle and it rings. "This vault is older than the road outside it. It was under twenty years of bramble and I found it because the ground was warm in one line across the meadow."\n\n"So somebody built this here long before anybody called it Halcyon Fields, and had the same idea about the heat, and nobody remembers them."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      far: {
        text: '"Things that have no business being alive this far north." She says it with satisfaction rather than wonder. "The big-leaved ones nearest the pipe. A fig that fruits. Two that I cannot name and neither can anybody who has come in and looked."\n\n"They are not rare. They are just warm. That is the whole trick and it is worth remembering when somebody tells you a thing cannot be done in this city."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      gossip: {
        text: '"I send flowers up to the convalescent place on a Friday and I will not take anything for them, and she has stopped arguing." She snaps a dead frond off and pockets it. "The hall gets a tub for the foyer at Christmas."\n\n"And the land office wants to put a terrace of houses on the meadow either side of me. I told him the ground is warm in a line and he should follow it and see what else is down there. He wrote it down. I think he thought I meant it as an objection."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      bye: { text: '"Shut it behind you," she says. "Both hands, it sticks."', options: [] },
    },
  },
});

// ── run ──────────────────────────────────────────────────────────────────────
for (const spec of SPECS) {
  const r = await authorBuilding(store, spec);
  console.log(`  ${spec.name.padEnd(20)} ${spec.x},${spec.y}  ent=${String(spec.entrance).padEnd(5)} ${r.facadeId}`);
}
const written = store.flush({ dryRun: DRY });
console.log(`\n${DRY ? 'DRY RUN — ' : ''}${written.length} file(s) ${DRY ? 'would change' : 'written'}`);
if (store.droppedRuntime.length) console.log(`  (dropped ${store.droppedRuntime.length} runtime write(s))`);
