/**
 * Halcyon Fields, batch 9 — the nineteen that got a door.
 *
 * batch8 authored thirty plots as mass-without-a-door: `is_building` with no `facade`, on the
 * stated reasoning that a residential tower in a quarter nobody has moved into does not have a
 * public room, and that thirty invented lobbies would be thirty corridors with a lift in them.
 * That reasoning held for the ELEVEN SHELLS and did not hold for the other nineteen, which the
 * same file describes as "clad, topped out and let". A finished building on a made-up street with
 * no way into it is not restraint, it is a facade in the theatrical sense — and a player walking
 * Kerbstone Row meets six of them in a row.
 *
 * ⚠ THE ELEVEN `shell_tower` PLOTS ARE DELIBERATELY NOT IN THIS FILE. A building with the crane
 * still tied in at three levels is a building site, and a site office you can walk into already
 * exists (Snagging List, batch7). They are also the eleven amber tacks on Pardoe's plan in Ground
 * Rent, which batch8 asserts the count of — converting one would make his line wrong. The gate at
 * the bottom of this file refuses a `shell_tower` for both reasons.
 *
 * ⚠ THE ENTRANCE DIRECTION IS THE ONE batch8 ALREADY AUTHORED, AND IT IS NOT A FREE CHOICE.
 * `flags.entrance` has been reaching `deriveSurfaceCell` since batch8 ran, so it is the side the
 * GLASS model has been drawing its hood, canopy and lettering on all along. Changing it here to
 * something more convenient would put the door on a blank elevation and leave the drawn one on a
 * wall you cannot open. All nineteen already face a road — checked, and `authorBuilding` refuses a
 * spec whose entrance neighbour is not `terrain: 'road'`, so the plan cannot drift from the ground.
 *
 * ⚠ THE EXTERIOR PROSE IS batch8'S, RE-READ RATHER THAN REWRITTEN. `outside()` pulls the
 * description off the tile that is already there and appends one sentence about the way in. The
 * nineteen paragraphs were written to be read from the street and they still are; what was missing
 * from them was never the building, it was the door.
 *
 * ⚠ ONE OF THEM IS AN APARTMENT BUILDING — Chain Free, whose launch terms batch8 already put on a
 * board by its own door ("no chain, no onward purchase, completion in twenty-eight days") and which
 * is "a third occupied anyway". Three of its four authored units are vacant and carry
 * `is_apartment` + `rent_cost`, so RENT works in them with nothing else built; the fourth is
 * Lindqvist's, which is the intended shape (one pool, an NPC in a rentable unit).
 *
 * Every room gets a light, every building gets a utility room, a junction box, a generator and a
 * `power_zones` row, because that is what `authorBuilding` does and a room with no fixture is not
 * dark — it reads as open air.
 *
 * Idempotent: every id derives from the placement, so a re-run is an upsert.
 *
 *   node scripts/content/halcyon/batch9.mjs [--dry-run]
 *
 * then:
 *   node scripts/content/mint-connections.mjs --write
 *   npm run content:lint
 */
import { authorBuilding, loadContentStore } from './lib.mjs';

const DRY = process.argv.includes('--dry-run');
const store = loadContentStore();
const HF = 'halcyon_fields';
const SPECS = [];

// The exterior paragraph batch8 wrote, plus the sentence it did not need until now. Reading it
// back off the tile rather than restating it means there is one description of each of these
// buildings from the street, and it is the one that has been shipping.
const outside = (x, y, door) => {
  const z = store.get('zones', `zone_district_${x}_${y}`);
  if (!z) throw new Error(`no tile ${x},${y}`);
  if (z.flags?.building_type === 'shell_tower') throw new Error(`${z.name} is a shell — see the header`);
  return `${z.description} ${door}`;
};

// ── 1. Long Lease ────────────────────────────────────────────────────────────
// Sold entire, before the steel was up, to one purchaser. What that buys the ground floor is a
// porter's desk in a hall nobody crosses, and a man whose whole job is the difference between an
// empty building and an unattended one.
SPECS.push({
  slug: 'hf_longlease', name: 'Long Lease', type: 'bead_tower',
  x: 892, y: 914, entrance: 'east', floors: 15, marker: 'LC', district: HF,

  facade: {
    bgColor: '#0f1a24', color: '#c2e2ff',
    description: outside(892, 914, 'The doors under the hood are glass and they are unlocked, which surprises people, and there is a man behind the desk inside who will tell you so if you hesitate.'),
  },

  rooms: [
    { key: 'hall', name: 'The Entrance Hall', floor: 'stone',
      description: 'A tall pale room at the bottom of the spine, pinched at the top the way every collar in the building is, so the ceiling comes down to meet the lift doors rather than running level to them. There is a desk, a bench nobody sits on, and a run of fifteen brass floor numbers set into the stone in a line from the door to the lift. Somebody polishes them. The sound in here is the sound of a room that is usually empty.',
      window: {
        name: 'the hood glazing',
        description: 'Curved glass either side of the entrance hood, out onto the corner where Sorrel Way meets the mews. From the desk you see everybody who comes past and almost nobody comes past.',
        light: 0.75, visibility: 0.85,
      } },
    { key: 'post', name: 'The Post Room', floor: 'tile', from: 'hall', dir: 'north',
      description: 'A narrow room behind the desk with a hundred and twenty brass boxes in it, twelve to a column, and a long shelf under them for parcels. Four of the boxes are full to the flap and have been for months. The rest are empty and have never been anything else. On the shelf there is a kettle, a chair, a radio, and a paperback face down at the halfway mark, and the whole arrangement is a great deal more lived-in than the hall.',
    },
  ],
  lights: {
    post: { name: 'a strip light over the boxes', description: 'A single chrome batten the length of the shelf, angled at the brass so the numbers read from the door. It hums at a pitch you stop hearing after about a minute and start hearing again the moment you think about it.', lumens: 540 },
  },
  utility: { name: 'The Riser Base', floor: 'concrete',
    description: 'The bottom of the spine, where everything that goes up the building starts: water, power, data, and a lift pit with about four inches of standing water in it that has been reported three times.' },

  props: [
    { key: 'boxes', room: 'post', name: 'a wall of brass mailboxes', objectType: 'container',
      description: 'A hundred and twenty of them, numbered by floor and flat, every lock working and every key handed over at completion. Four are in use. The brass on those four is brighter round the keyhole than on the other hundred and sixteen, which is the only measurement anybody in this building has of how many people actually live in it.' },
    { key: 'desk', room: 'hall', name: "the porter's desk", objectType: 'furniture',
      description: 'Chrome and pale stone, curved to the room, with a chair behind it and a sightline down the whole hall to the door. Under the lip, where nothing shows, somebody has taped a list of the four occupied flats and what time each of them usually comes in.' },
  ],

  items: [
    { id: 'item_hf_headlease', name: 'a copy of the headlease', type: 'media', value: 12, weight: 45, description: null, flags: {},
      tags: { stackable: true, description: 'A hundred and twenty-five years, one purchaser, and a schedule of covenants that runs to nine pages. The ninth page is the one worth the twelve credits: it lists what the leaseholder may not do, and the list is longer than the one for what they may.' } },
    { id: 'item_hf_spareflatkey', name: 'a spare mailbox key', type: 'misc', value: 6, weight: 5, description: null, flags: {},
      tags: { stackable: true, description: 'Small, brass, and stamped with a number that is not a flat number but a box number, which are not the same thing in this building and have caused two arguments.' } },
  ],

  npc: {
    id: 'npc_hf_brask', name: 'Corvin Brask', sex: 'male', hp: 38,
    homeRoom: 'post', workRoom: 'hall', shopName: "The Porter's Desk",
    description: 'A heavy, unhurried man in a grey estate jacket with the cuffs turned once, standing rather than sitting because sitting makes the shift longer. He has the manner of somebody who has worked in buildings with four hundred people in them and now works in one with four, and has not decided yet whether that is a promotion.',
    clothing: [
      'a grey estate jacket, single button, the cuffs turned once',
      'a pressed shirt with no tie, because the tie was optional and he checked',
      'dark trousers with a crease kept in them',
      'flat black shoes, soled twice',
      'plain underthings',
    ],
    inventory: [
      { item_id: 'item_hf_headlease', price: 12 },
      { item_id: 'item_hf_spareflatkey', price: 6 },
    ],
    chitchat: [
      'Brask walks the length of the hall, turns at the lift, and walks back, which takes eleven seconds and which he does about forty times a shift.',
      'He straightens the bench nobody sits on by about an inch.',
      'The radio in the post room finishes a song and he goes through and changes the station without hurrying.',
      'He checks the four full mailboxes, touches nothing, and comes back.',
      'A lift arrives at the ground floor with nobody in it. He looks at it until the doors close again.',
    ],
    dialogue: {
      root: {
        text: '"Afternoon." He does not ask what you want, which is a kind of manners.',
        text_by_relation: {
          first: 'The man behind the desk watches you the whole way across the hall without it being rude, and speaks when you are close enough that he does not have to raise his voice.\n\n"You can come in. People stop at the glass because of the hood — it is designed to look like you are not meant to." He says it as though he has said it a hundred times, which he has, to perhaps nine people. "Corvin Brask. I look after this."\n\nHe gestures at the hall, and the gesture takes in rather more emptiness than he probably intends.',
          known: '"You again." He nods at the bench. "Sit down if you like. Nobody ever has."',
          familiar: 'He has the kettle on in the post room before you reach the desk, which is not a thing he does for tenants.\n\n"Nothing today," he says. "Nothing yesterday either."',
        },
        options: [
          { label: 'Who lives here?', next: 'who' },
          { label: 'What have you got?', next: '__shop__' },
          { label: 'Is it always this quiet?', next: 'quiet' },
          { label: 'Nothing. Good afternoon.', next: 'bye' },
        ],
      },
      who: {
        text: '"Four flats out of forty-eight." He says the numbers flatly, the way you say a thing you have checked. "Two on six, one on eleven, one on fifteen. The rest were bought by the same purchaser as the building and are furnished, cleaned on a rota and not lived in."\n\nHe puts a hand on the desk.\n\n"I have keys to all of them. I have been into all of them. They are very nice."',
        options: [
          { label: 'That is a strange job.', next: 'job' },
          { label: 'Back.', next: 'root' },
        ],
      },
      job: {
        text: '"It is a job." A pause, and then, because you are still there: "I did the tower at the Yards end for nine years. Four hundred and some, every one of them in and out twice a day, half of them wanting something. You could not hear yourself."\n\nHe looks down the hall.\n\n"I thought I would like this. I would like it better with about forty more people in it."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      quiet: {
        text: '"The building is not quiet. The building makes a great deal of noise." He tilts his head at the ceiling. "Pumps at four, lift at six, and the collars flex when the wind gets round the west side — you hear that in the hall as a sort of knock, twice, about a second apart."\n\n"It is the people who are quiet. There are not enough of them to be anything else."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      bye: { text: '"Mind the step at the hood. Everybody does it once." He is already looking past you at the door.', options: [] },
    },
  },
});

// ── 2. Terms Agreed ──────────────────────────────────────────────────────────
// Four planted terraces with the protective film still on the glass. What you can walk into is the
// hall and the second terrace, and the second terrace is the whole point of the building.
SPECS.push({
  slug: 'hf_terms', name: 'Terms Agreed', type: 'cascade_block',
  x: 894, y: 912, entrance: 'west', floors: 8, marker: 'TA', district: HF,

  facade: {
    bgColor: '#0e1820', color: '#c6e6d8',
    description: outside(894, 912, 'The way in is a glazed slot at the bottom of the lowest step, off the mews, with a chrome plate beside it reading TERRACES OPEN TO VIEW and an arrow that points at nothing in particular.'),
  },

  rooms: [
    { key: 'hall', name: 'The Entrance Hall', floor: 'stone',
      description: 'A low wide room the full width of the bottom step, glazed on the mews side and open to the stair on the other, with the four terrace levels named on a chrome board and a bootscraper set into the floor that has never scraped a boot. It smells faintly of wet soil, which comes down the stair from the planting and is the only thing about the hall that is not immaculate.',
      window: {
        name: 'the mews glazing',
        description: 'Floor to ceiling along the mews, so the hall is bright and entirely visible from outside. The view is Vetch Mews, which is a made road with nothing on the far side of it yet.',
        light: 0.8, visibility: 0.9,
      } },
    { key: 'terrace', name: 'The Second Terrace', floor: 'stone', from: 'hall', dir: 'up',
      description: 'A long planted step with a glass balustrade down the open side and the protective film still on every pane of it — gone milky, lifting at the corners, and left because the contractor who was to strip it was engaged on the terraces above and never came down again. The beds are irrigated on a timer, four minutes at six and four minutes at seven, into soil that has had nothing planted in it. The timer works perfectly.',
      window: {
        name: 'the balustrade',
        description: 'Glass from the deck to waist height the whole way along, through a milky film that softens the mews and the green beyond it into shapes. Wipe a hand across it and nothing changes, because the film is on the outside.',
        light: 0.7, visibility: 0.4,
      } },
  ],
  lights: {
    terrace: { name: 'a line of deck uplighters', description: 'Set into the paving at the foot of the balustrade, every two metres, throwing light up through the film so that after dark the whole open side of the terrace glows evenly and shows you nothing at all.', lumens: 340, type: 'uplight' },
  },
  utility: { name: 'The Irrigation Plant', floor: 'concrete',
    description: 'Tanks, a pump, a controller with a small screen, and a printed schedule taped beside it that has been followed without exception for two years. The controller reports the health of a planting scheme that does not exist and reports it as good.' },

  props: [
    { key: 'timer', room: 'terrace', name: 'an irrigation controller', objectType: 'decoration', powerKw: 0.1,
      description: 'A neat chrome box on the terrace wall with a screen the size of a playing card. It shows two cycles a day, a soil-moisture reading, and a green tick. The moisture probe is in bed four. Bed four, like all of them, is soil and nothing else, and the probe is perfectly happy about it.' },
    { key: 'film', room: 'terrace', name: 'the protective film', objectType: 'decoration',
      description: 'Blue-white, applied at the factory, meant to come off on the day of handover. Two winters on it has bonded at the middle of each pane and given up at the corners, so it lifts in the wind with a sound like somebody turning a page, all the way along, at slightly different times.' },
  ],
});

// ── 3. Deposit Taken ─────────────────────────────────────────────────────────
// Marketed as workspace, sold as workspace, used as storage. The counter is the only part of it
// anybody is running, and the person running it is running it well.
SPECS.push({
  slug: 'hf_deposit', name: 'Deposit Taken', type: 'atrium_court',
  x: 895, y: 915, entrance: 'north', floors: 4, marker: 'DT', district: HF,

  facade: {
    bgColor: '#101820', color: '#bcd8ee',
    description: outside(895, 915, 'The doors on the Sorrel Way side are propped with a fire extinguisher during the day and there is a counter three paces inside them, which is not what the drum was drawn for and is what it is.'),
  },

  rooms: [
    { key: 'counter', name: 'The Counter', floor: 'concrete',
      description: 'A slice of the drum partitioned off with plasterboard that does not go all the way to the glass, so the curve of the room carries on behind it and you can see racking through the gap. The counter itself is a workshop bench with a chrome front screwed to it. On the wall: a rate card, a diagram of the unit sizes, and a handwritten sign about what may not be stored here, which has been added to four times in four different pens.',
      window: {
        name: 'the drum glazing',
        description: 'The curve, from the partition round to the doors, looking out at Sorrel Way and the backs of the towers on the mews. At this height the glass is the only part of the building anybody designed and it is being used as a shopfront.',
        light: 0.8, visibility: 0.85,
      } },
    { key: 'racking', name: 'The Racking Floor', floor: 'concrete', from: 'counter', dir: 'east',
      description: 'The rest of the drum, four bays deep and curved, racked out to the underside of the second floor in galvanised steel that was bought second-hand and is the only un-chrome metal in Halcyon Fields. Three of the bays are let. The fourth holds about four hundred identical chrome-fronted kitchen units, still wrapped, belonging to the estate, stored here against the day the flats they were bought for are finished.',
    },
  ],
  lights: {
    counter: { name: 'a light over the counter', description: 'A single reflector on a swan neck bolted to the top of the partition and bent over the bench, aimed at where a docket is signed. The rest of the slice of drum is lit by the glazing and, after dark, by whatever Sorrel Way is doing.', lumens: 460 },
    racking: { name: 'a run of bay lights', description: 'Corrugated reflectors on a chain, one per bay, wired along the top rail of the racking in a way an inspector would have opinions about. They come on together with a thump you feel through the floor.', lumens: 900, type: 'industrial' },
  },
  utilityAnchor: 'racking',
  utility: { name: 'The Lower Bay', floor: 'concrete',
    description: 'A half-level under the racking that was drawn as a cycle store and is used for the things nobody will sign for: two pallets of cladding panel, a drum of sealant gone solid, and the switchgear, which is the only thing down here anybody looks at.' },

  props: [
    { key: 'ratecard', room: 'counter', name: 'a rate card', objectType: 'decoration',
      description: 'Four unit sizes, four monthly rates, and a line at the bottom about minimum terms. The rates are in a printed column and there is a second column beside it in biro, and the biro column is higher, and the date beside it is recent.' },
    { key: 'units', room: 'racking', name: 'four hundred wrapped kitchen units', objectType: 'container',
      description: 'Chrome-fronted, flat-packed, factory-wrapped, stacked eight high in the bay the estate does not pay for because the estate owns the building. They were ordered against a completion that has moved twice. The wrapping has gone slack on the bottom courses under the weight, and one carton near the front has been opened and taped shut again by somebody who wanted to know if they were any good.' },
  ],

  items: [
    { id: 'item_hf_stackcrate', name: 'a stacking crate', type: 'furniture', value: 22, weight: 900, description: null, flags: {},
      tags: { description: 'Grey, lidded, and moulded to stack four high without slipping. It is the single most useful object sold anywhere in Halcyon Fields and it is sold here by accident, because the storage counter had a pallet of them left over and started shifting them.' } },
    { id: 'item_hf_wrapfilm', name: 'a roll of pallet wrap', type: 'material', value: 9, weight: 350, description: null, flags: {},
      tags: { stackable: true, description: 'Two hundred metres of it on a cardboard core, clear, and clingy enough that the first three turns are the hardest part of any job it is used for. Sold from behind the counter to anybody who asks and to a number of people who did not.' } },
  ],

  npc: {
    id: 'npc_hf_fenwick', name: 'Ottilia Fenwick', sex: 'female', hp: 36,
    homeRoom: 'racking', workRoom: 'counter', shopName: 'Deposit Taken Storage',
    description: 'A wiry woman in a padded gilet over a boiler suit, with a pencil behind one ear and a pair of gloves tucked into the waistband at the small of her back. She came with the racking, which she bought, and she has the look of somebody who took on a unit as a sideline and found herself running the building.',
    clothing: [
      'a navy padded gilet with the estate crest picked off the breast',
      'a boiler suit worn soft at the knees and elbows',
      'a pair of rigger gloves tucked into the waistband at the back',
      'steel-capped boots with the laces doubled round the ankle',
      'plain underthings',
    ],
    inventory: [
      { item_id: 'item_hf_stackcrate', price: 22 },
      { item_id: 'item_hf_wrapfilm', price: 9 },
    ],
    chitchat: [
      'Fenwick takes the pencil from behind her ear, writes a number on the back of her hand, and puts the pencil back.',
      'She goes through to the racking, moves one carton six inches, and comes back satisfied.',
      'A bay light out in the third row flickers and she looks at it for a long moment without doing anything about it.',
      'She rewinds a length of pallet wrap onto the roll by hand, which takes a while and is clearly a thing she does to be doing something.',
      'Somewhere behind the partition the stack of kitchen units settles, one carton, with a sound like a door closing.',
    ],
    dialogue: {
      root: {
        text: '"Storing or collecting?" She has the pencil out before you answer.',
        text_by_relation: {
          first: 'The woman behind the counter looks up, takes in the fact that you are not carrying anything, and puts the pencil down again.\n\n"Not storing, then." She says it without disappointment. "Ottilia Fenwick. This is a storage unit in a building that was sold as offices, before you ask, and yes, I know what it was drawn for. So does everybody."\n\nShe nods at the partition, and the racking visible past the end of it.\n\n"Four bays. Three of them are let. The fourth one is the estate\'s and the estate does not pay."',
          known: '"Back." She reaches under the counter and puts a crate on top of it without being asked, which is either a joke or an offer.',
          familiar: '"Third bay has space from the end of the month," she says, before anything else. "I am telling you first because you will not mess me about."',
        },
        options: [
          { label: 'What is in the fourth bay?', next: 'fourth' },
          { label: 'What are you selling?', next: '__shop__' },
          { label: 'This was meant to be offices.', next: 'offices' },
          { label: 'Not today.', next: 'bye' },
        ],
      },
      fourth: {
        text: '"Kitchens." She says it like a diagnosis. "Four hundred of them, chrome fronts, flat-packed, ordered for the towers on the mews. They have been here nineteen months and they were meant to be here six weeks."\n\nShe taps the counter once.\n\n"I do not charge for them because they own the building. But I am the one who has to walk round them, and every time a completion date moves I get another pallet."',
        options: [
          { label: 'Has anybody opened one?', next: 'opened' },
          { label: 'Back.', next: 'root' },
        ],
      },
      opened: {
        text: '"I opened one." No hesitation at all. "Second month. I wanted to know whether we were storing something good or storing something they could not sell."\n\nA beat.\n\n"It is good. Better than mine. That is the part that annoys me."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      offices: {
        text: '"It was. Two floors of it above us still are, on paper, and there is nobody in them." She shrugs, and the gilet does most of it. "The drum is the nicest room in this quarter that anybody can afford, which is why it has racking in it. If it had desks in it the rent would be four times what I pay and I would be somewhere with no windows."\n\n"Change of Use, on the row, is going through all this with the land office. Eleven months so far. I am watching how they get on."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      bye: { text: '"Mind the extinguisher on the way out. It is holding the door." She has the pencil back out already.', options: [] },
    },
  },
});

// ── 4. Above Board ───────────────────────────────────────────────────────────
// Seventeen storeys of offices that shear as they rise. The lobby and the mezzanine are public
// because the planning consent said they would be, and the consent is the only reason.
SPECS.push({
  slug: 'hf_aboveboard', name: 'Above Board', type: 'torque_tower',
  x: 900, y: 911, entrance: 'west', floors: 17, marker: 'AB', district: HF,

  facade: {
    bgColor: '#0e1620', color: '#b8dcf6',
    description: outside(900, 911, 'At the bottom, where the twist has not started yet, the ground floor is square to Kettle Lane and glazed the whole way round, and the revolving door in the middle of it turns whether or not anybody is going through it.'),
  },

  rooms: [
    { key: 'lobby', name: 'The Lobby', floor: 'stone',
      description: 'A square room at the bottom of a building that stops being square about four floors up, which is a thing you can feel rather than see: the core is dead centre and the lift doors face you squarely, and everything above the ceiling is quietly going somewhere else. Pale stone, a long bench, a single chrome sculpture that the planning consent calls public art and everybody in the building calls the corkscrew.',
      window: {
        name: 'the ground-floor glazing',
        description: 'The whole square, floor to soffit, out onto Kettle Lane on one side and the undeveloped strip behind on the other. Looking straight up through it you can see the second floor overhanging the first by about a foot, and the third overhanging the second.',
        light: 0.8, visibility: 0.9,
      } },
    { key: 'mezz', name: 'The Mezzanine', floor: 'carpet', from: 'lobby', dir: 'up',
      description: 'A gallery round three sides of the lobby, a half-turn into the twist, so the balustrade on the far side is noticeably not parallel with the one you are standing at. There are eight chairs up here and a table with a water jug on it, and the consent requires all of it to be open to the public between nine and five. Nobody has ever tested that, and the chairs are always exactly where they were.',
      window: {
        name: 'the first sheared glazing',
        description: 'The lowest floor where the turn shows. Stand at the north end and the glass runs away from the street; stand at the south end and it runs toward it. People who work here stop noticing inside a week.',
        light: 0.75, visibility: 0.85,
      } },
  ],
  lights: {
    mezz: { name: 'a cove running the balustrade', description: 'Concealed the whole length of the gallery rail, washing the ceiling rather than the floor, so the light in here has no source you can point at and no shadow under anything.', lumens: 480, type: 'cove' },
  },
  utility: { name: 'The Core Base', floor: 'concrete',
    description: 'The bottom of the only part of this building that does not turn. Switchgear, a water booster set, and the lift motor room, which sits dead square in a footprint that by the top of the building has rotated a quarter turn away from it.' },

  props: [
    { key: 'corkscrew', room: 'lobby', name: 'the corkscrew', objectType: 'decoration',
      description: 'Four metres of polished chrome ribbon rising off a stone plinth with a quarter turn in it, commissioned to explain the building to people standing at the bottom of it. It does. A plaque at the base gives the sculptor, the year and the title, which is "Progression", and somebody has scratched a small tick beside it.' },
    { key: 'jug', room: 'mezz', name: 'a water jug and eight glasses', objectType: 'furniture',
      description: 'Filled every morning, covered, and changed every evening whether or not the level has moved. The level does not move. The glasses are turned upside down on a folded cloth and the cloth is folded the same way every day by the same person.' },
  ],
});

// ── 5. Chain Free ────────────────────────────────────────────────────────────
// ⚠ THE APARTMENT BUILDING. batch8 already put the launch terms on a board by this door and
// already said it was a third occupied, which is exactly a building with flats going. Three of the
// four authored units are vacant and rentable; the fourth is Lindqvist's, because a letting agent
// who does not live in his own building is a letting agent nobody believes.
SPECS.push({
  slug: 'hf_chainfree', name: 'Chain Free', type: 'bead_tower',
  x: 900, y: 914, entrance: 'west', floors: 13, marker: 'CE', district: HF,

  facade: {
    bgColor: '#0f1922', color: '#c8e6ff',
    description: outside(900, 914, 'The door beside the board is open during the day and there is a desk visible through it with somebody behind it, which is the only building on this street where that is true.'),
  },

  rooms: [
    { key: 'lobby', name: 'The Letting Office', floor: 'stone',
      description: 'The bottom bulge of the tower, used half as a lobby and half as an office, with a desk at an angle across the curve and two chairs facing it. On the wall behind the desk: a cutaway of the building with every flat coloured in, green for sold, amber for reserved and white for available, redrawn by hand often enough that the paper has gone soft at the pin holes. There is a great deal more white on it than the board outside would lead you to expect.',
      window: {
        name: 'the bulge glazing',
        description: 'The whole curve of the lowest bead, from the collar down to the floor, looking out at the junction where Kettle Lane meets Sorrel Way. It is the only lit window on this side of the street after six.',
        light: 0.8, visibility: 0.9,
      } },
    { key: 'landing', name: 'The Third Collar', floor: 'carpet', from: 'lobby', dir: 'up',
      description: 'A landing at the pinch between two bulges, which is the narrowest part of the floor it serves, because that is where the lifts are in a building shaped like this. Four doors off it, a window slot at the collar you can see straight down the lane from, and a fire plan on the wall with the four flats numbered. Whoever laid the carpet ran it into all four doorways and it stops cleanly at the threshold of the only one that gets used.',
    },
    { key: 'u1', name: 'Flat 3A', floor: 'boards', from: 'landing', dir: 'north',
      description: 'A single room and a bathroom off it, curved on the outside wall because the whole building is, with a kitchen run along the flat side and a bed space at the window end. Everything in it is new and nothing in it has been chosen: the units are the estate standard, the floor is the estate standard, and the tap makes a noise on first opening that the brochure did not mention. It is a good flat. Nobody has ever slept in it.',
      window: {
        name: 'the curved window',
        description: 'The outside of the bead, north-facing, looking up Kettle Lane toward the boulevard and over the top of the low buildings on Sorrel Way. Cold light, even light, and the glass is triple-glazed so the lane is silent.',
        light: 0.7, visibility: 0.85,
      } },
    { key: 'u2', name: 'Flat 3B', floor: 'boards', from: 'landing', dir: 'east',
      description: 'The same room as 3A turned a quarter of the way round the bulge, so the curve of the wall runs the other way and the bed space is at the narrow end rather than the wide one. The protective film is still on the kitchen fronts. There is a folded card on the worktop with a phone number on it and a line reading ANY QUESTIONS AT ALL, and it has been there long enough to have curled.',
      window: {
        name: 'the curved window',
        description: 'East over Sorrel Way and the backs of the Cinder Lane towers, with a slice of the green between two of them. In the afternoon this room is the warmest in the building and there is nobody in it.',
        light: 0.75, visibility: 0.8,
      } },
    { key: 'u3', name: 'Flat 3C', floor: 'boards', from: 'landing', dir: 'south',
      description: 'The south flat, and the one the cutaway on the office wall has had coloured amber and rubbed back to white twice. It is identical to the other two except that somebody moved in for eleven days and then did not, and the marks their table left in the floor finish are still there in a rectangle by the window, four of them, very faint.',
      window: {
        name: 'the curved window',
        description: 'South down Kettle Lane to the row, with the Curtain closing the view off at the end of it. On a clear evening the whole lane is in shadow and the top of the wall is not.',
        light: 0.7, visibility: 0.85,
      } },
    { key: 'u4', name: 'Flat 3D', floor: 'boards', from: 'landing', dir: 'west',
      description: 'The one flat on this landing that is lived in, and it is lived in lightly: a bed made tight, a chair, a table with one place at it, and a shelf of ring binders that have no business in a flat and are here because there is nowhere else to put them. The kitchen has been used. The card with the phone number on it has been taken off the worktop and pinned, upside down, to the inside of a cupboard door.',
      window: {
        name: 'the curved window',
        description: 'West, straight at the Curtain, close enough here that it fills the glass from sill to head and there is no sky in this window at all. He says he chose it on purpose.',
        light: 0.5, visibility: 0.6,
      } },
  ],
  lights: {
    landing: { name: 'four downlights at the collar', description: 'Set in a ring at the narrowest point of the floor, which puts all four of them within about two metres of each other and lights the landing very brightly and the four doorways not at all.', lumens: 600 },
    u1: { name: 'a ceiling pendant', description: 'Estate standard: a chrome cone on a short drop over where the table would go, if there were a table.', lumens: 420, type: 'pendant' },
    u2: { name: 'a ceiling pendant', description: 'The same cone in the same place, still wearing the small paper tag the electrician left on the flex.', lumens: 420, type: 'pendant' },
    u3: { name: 'a ceiling pendant', description: 'The same cone again, and the only one of the four that has been switched on enough to have collected any dust on the top of it.', lumens: 420, type: 'pendant' },
    u4: { name: 'a reading lamp', description: 'Not estate standard — a proper lamp, brought in, clamped to the shelf of binders and aimed at the chair. It is the only warm light in the building.', lumens: 300, type: 'lamp' },
  },
  utility: { name: 'The Pump Room', floor: 'concrete',
    description: 'Under the lowest bead, where the water is boosted to the top of the tower. It runs at four in the morning and it is audible in the flats on the lower three floors, which is one of two facts about this building that the brochure leaves out.' },

  props: [
    { key: 'cutaway', room: 'lobby', name: 'a cutaway of the building', objectType: 'decoration',
      description: 'The whole tower drawn in section with every flat on it, coloured green, amber or white by hand. The paper is soft at the pin holes from being taken down and put back. Count the colours rather than reading the board outside and the building is not a third occupied, it is a fifth.' },
    { key: 'board', room: 'lobby', name: 'the launch terms', objectType: 'decoration',
      description: 'No chain, no onward purchase, completion in twenty-eight days. Every one of those was true when it was printed and every one of them is still true, which is the strange part: the terms are not the reason nobody is buying, and nobody at the estate has worked out what is.' },
    { key: 'fireplan', room: 'landing', name: 'a fire plan', objectType: 'decoration',
      description: 'Third floor, four flats, two staircases, and a YOU ARE HERE dot at the collar. Somebody has written the occupants\' names on it in pencil beside the flat numbers. Three of the four lines are blank and the fourth says LINDQVIST.' },
    { key: 'binders', room: 'u4', name: 'a shelf of ring binders', objectType: 'container',
      description: 'Reservation forms, withdrawn reservations, and the correspondence that went with them, filed by month rather than by flat, which tells you what he is actually tracking. The withdrawn file is thicker than the live one and he has not moved it to the back.' },
  ],

  items: [
    { id: 'item_hf_reservation', name: 'a reservation form', type: 'media', value: 0, weight: 20, description: null, flags: {},
      tags: { stackable: true, description: 'Two sides, estate crest, and a box at the bottom for a deposit figure that is left blank so that it can be agreed. The small print gives fourteen days to withdraw and does not say what happens on the fifteenth, which Lindqvist will tell you if you ask and will not volunteer.' } },
    { id: 'item_hf_flatkeyset', name: 'a set of viewing keys', type: 'misc', value: 15, weight: 30, description: null, flags: {},
      tags: { stackable: false, description: 'Three keys on a chrome fob with a paper tag, signed out and signed back in, and sold rather than lent to anybody who has been in more than twice. The tag has had four names on it and three of them are crossed out.' } },
  ],

  npc: {
    id: 'npc_hf_lindqvist', name: 'Marius Lindqvist', sex: 'male', hp: 34,
    homeRoom: 'u4', workRoom: 'lobby', shopName: 'Chain Free Lettings',
    description: 'A tall, slightly stooped man in his fifties in a good suit worn without much conviction, sitting at a desk set at an angle so that he can see the door without facing it. He is the only person selling anything in Halcyon Fields who lives in the thing he is selling, and he mentions it early, because it is the strongest argument he has.',
    clothing: [
      'a navy suit, good cloth, the jacket usually over the back of the chair',
      'a shirt with the top button undone by about eleven in the morning',
      'no tie, and a mark on the collar where one used to sit',
      'brown shoes that are wrong with the suit and comfortable',
      'plain underthings',
    ],
    inventory: [
      { item_id: 'item_hf_reservation', price: 0 },
      { item_id: 'item_hf_flatkeyset', price: 15 },
    ],
    chitchat: [
      'Lindqvist takes the cutaway down, looks at it at arm\'s length, and puts it back on the same two pins.',
      'He makes a call that is answered by a recording, listens to all of it, and puts the handset down without leaving anything.',
      'The pump under the floor starts up, and he glances at the ceiling as though somebody upstairs had spoken.',
      'He straightens the two chairs facing the desk so that they are exactly the same distance from it.',
      'Somebody walks past outside and he watches them all the way to the corner.',
    ],
    dialogue: {
      root: {
        text: '"Come in properly, you are letting the cold in." He is already moving the second chair.',
        text_by_relation: {
          first: 'The man at the desk stands up before you are all the way through the door, and it is not a salesman\'s stand — it is faster than that, and a little too glad.\n\n"Marius Lindqvist." He puts a hand out. "Three flats available on the third, two on the seventh, one on the eleventh, and I will save you the first question: yes, I live here. Flat 3D. Have done since the day it topped out."\n\nHe gestures at the cutaway on the wall behind him, then does not look at it.\n\n"Twenty-eight days to completion, no chain and nothing onward. That has been true for two years."',
          known: '"You are the only person who has been in here twice." He says it lightly and it does not come out lightly. "Sit down."',
          familiar: 'He has the kettle going in the back before you have crossed the room, and the viewing keys are already on the desk.\n\n"Three A is the one," he says. "I have stopped pretending otherwise."',
        },
        options: [
          { label: 'What is actually available?', next: 'avail' },
          { label: 'What have you got for sale?', next: '__shop__' },
          { label: 'Why is nobody buying?', next: 'why' },
          { label: 'You live here?', next: 'lives' },
          { label: 'I will think about it.', next: 'bye' },
        ],
      },
      avail: {
        text: '"Third floor: A, B and C, all of them ready, all of them furnished to estate standard, and all three of them have been ready since the building was signed off." He counts them on the desk with two fingers. "Go up. The lift works. The doors are on the latch and I will not follow you round, because people hate that and I have learned."\n\nA beat.\n\n"If you want one, the terms are the terms. There is no haggling because there is nothing to haggle about — the price has not moved in two years and neither has anything else."',
        options: [
          { label: 'What about the fourth?', next: 'fourth' },
          { label: 'Back.', next: 'root' },
        ],
      },
      fourth: {
        text: '"Three D is mine." Flat, no flourish. "Not the estate\'s, not on the schedule. Mine. If you take one of the other three you will have me across the landing, and I am telling you now rather than after, because the ones who found out after did not like it."\n\nHe almost smiles.\n\n"I am quiet. I am out from eight. And the pump wakes me before it wakes you."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      why: {
        text: '"That is the question." He sits back, and for a moment he is not selling anything. "It is not the price. It is not the build — the build is good, better than the ones on the mews, and I say that knowing what it costs me to say it."\n\nHe turns a pen over once.\n\n"People come. They look. They stand at that window and they look up Kettle Lane at seven in the evening and there is nobody on it. Not a soul, in a quarter with forty buildings in it. And they do not say that is the reason. They say they will think about it."',
        options: [
          { label: 'So it needs people.', next: 'people' },
          { label: 'Back.', next: 'root' },
        ],
      },
      people: {
        text: '"It needs one." He taps the desk. "One flat, with somebody in it who puts a light on at six and has the window open in summer and argues with somebody on the landing. That is the whole of it. Everything else is built."\n\nHe looks at you a fraction longer than is comfortable.\n\n"So. Three A."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      lives: {
        text: '"I do." He nods up at the ceiling. "Third floor, west side. The window faces the Curtain and there is no sky in it at all, which everybody thinks is a joke until they stand in it, and then they understand that it is quiet in a way nothing else in this city is."\n\n"I took the worst aspect in the building deliberately. If I had taken the best one, I could not sell the best one."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      bye: { text: '"Everybody thinks about it." He says it without any edge at all, which is worse. "Keys are here when you want them."', options: [] },
    },
  },
});

// ── 6. Fixed Rate ────────────────────────────────────────────────────────────
// Six sides drawn to a point, and a lobby with three corners that are not ninety degrees. One
// room, deliberately: there is nothing else on the ground floor and pretending otherwise would be
// the invention batch8 was right about.
SPECS.push({
  slug: 'hf_fixedrate', name: 'Fixed Rate', type: 'glass_prism',
  x: 901, y: 912, entrance: 'east', floors: 16, marker: 'FR', district: HF,

  facade: {
    bgColor: '#0e151e', color: '#b4d8f2',
    description: outside(901, 912, 'The door is cut into one of the six faces, off Cinder Lane, and it is the only break anywhere in the glass — no hood, no canopy, no lettering, just a line in the tint and a chrome pull.'),
  },

  rooms: [
    { key: 'lobby', name: 'The Six-Sided Lobby', floor: 'stone',
      description: 'A hexagon, because the building is one, which means not a single corner in this room is a right angle and every piece of furniture in it has had to be made rather than bought. The core is a hexagon too, set inside the first and turned thirty degrees, so the space between them is six triangles and the lifts are in two of them. People stop just inside the door to work out where to go, every time, and the building has never solved it.',
      window: {
        name: 'the tinted faces',
        description: 'Five of the six sides, floor to ceiling, in glass dark enough that the lane outside is a shade cooler than it is. From in here at dusk the street looks like it is half an hour later than it is.',
        light: 0.55, visibility: 0.8,
      } },
  ],
  utility: { name: 'The Base of the Core', floor: 'concrete',
    description: 'Inside the inner hexagon, which is the only part of this building with a flat wall you can put a panel on. Switchgear, meters, and a chalk line on the floor marking the thirty-degree turn between the two hexagons, left by whoever set the core out and never cleaned off.' },

  props: [
    { key: 'bench', room: 'lobby', name: 'a made-to-fit bench', objectType: 'furniture',
      description: 'One of six, each a triangle, each made specially because nothing rectangular fits anywhere in this room. The invoice for them is the third-largest line in the building\'s fit-out and is filed under joinery, and there is a note against it in the estate office in a different hand reading SIX BENCHES.' },
    { key: 'directory', room: 'lobby', name: 'a chrome directory', objectType: 'decoration',
      description: 'Sixteen floors listed with a tenant against four of them. The other twelve read AVAILABLE in the same typeface at the same size, which was a decision — the alternative was twelve blanks, and twelve blanks look worse than twelve advertisements for yourself.' },
  ],
});

// ── 7. Prime Location ────────────────────────────────────────────────────────
// Nineteen floors of shearing glass, named before the streets round it were laid. The sky lobby is
// public because it was in the brochure, and the brochure is a document the estate cannot get out
// of as easily as it can get out of a completion date.
SPECS.push({
  slug: 'hf_prime', name: 'Prime Location', type: 'torque_tower',
  x: 903, y: 912, entrance: 'west', floors: 19, marker: 'PL', district: HF,

  facade: {
    bgColor: '#0f1721', color: '#c6e8ff',
    description: outside(903, 912, 'The entrance is a double-height slot in the chrome podium on the Cinder Lane side, with the name cut into the stone above it in letters a foot high and a lit collar directly overhead that makes the doorway the brightest thing on the lane.'),
  },

  rooms: [
    { key: 'lobby', name: 'The Podium Lobby', floor: 'stone',
      description: 'Double height, stone the colour of the outside, and largely empty on purpose — there is a desk at the far end, a lift bank of four, and about thirty feet of nothing between them and the door, which is a thing you pay for. The only decoration is the name again, in the same letters as outside, cut into the wall behind the desk so that anybody standing at it has it over their shoulder.',
      window: {
        name: 'the podium glazing',
        description: 'Two storeys of it either side of the entrance, out onto Cinder Lane. From in here the buildings opposite are exactly the height of the bottom third of the glass, which is a proportion somebody worked out and which will stop being true when the plots behind them are built.',
        light: 0.8, visibility: 0.9,
      } },
    { key: 'sky', name: 'The Sky Lobby', floor: 'stone', from: 'lobby', dir: 'up',
      description: 'The tenth floor, where the lifts change over, and the one room in Halcyon Fields that does what the brochure said it would: a full floor plate given to nothing, glazed on all four shearing sides, with benches down the middle and a view that includes the Spire, the Curtain, the basin and — on the north side, uncomfortably close — the top eight floors of Glass Ceiling. There is nobody up here. There is a rule that there is always somebody up here and there is nobody.',
      window: {
        name: 'the sheared glazing',
        description: 'Halfway up the twist, so no two walls of this room are parallel with the streets below them, and you have to hunt for Cinder Lane even though you came up from it. On a clear day you can see the Reach.',
        light: 0.9, visibility: 0.95,
      } },
  ],
  lights: {
    sky: { name: 'a perimeter cove', description: 'Round all four sheared sides at the head of the glass, turned down after dark so that the room is dimmer than the city outside it and the view keeps working. Whoever specified that understood the building.', lumens: 380, type: 'cove' },
  },
  utility: { name: 'The Podium Plant', floor: 'concrete',
    description: 'Behind the lobby wall the name is cut into, and about eleven times the volume of anything you can walk into upstairs. Chillers, a transformer chamber, and the lift pit for a bank of four, of which two have been isolated since the summer for a reason recorded as USAGE.' },

  props: [
    { key: 'benches', room: 'sky', name: 'a line of stone benches', objectType: 'furniture',
      description: 'Six of them down the middle of the floor plate, facing alternately north and south, in the same stone as the podium. They are cold, they are beautiful, and they have been sat on so rarely that the polish on them is still the polish the mason put there.' },
    { key: 'plaque', room: 'lobby', name: 'a foundation plaque', objectType: 'decoration',
      description: 'Chrome on stone, recording that the building was named in a year when the ground it stands on was a field. It gives the name, the year, and the developer, and it does not give a completion date, which by the time it was cast had already stopped being a thing anybody was casting into stone.' },
  ],
});

// ── 8. Mod Cons ──────────────────────────────────────────────────────────────
// The specification plate with eleven lines on it, and the eleventh line — CONNECTED TO THE ESTATE
// NETWORK — is a whole trade. The woman who runs it has opinions about what that line means.
SPECS.push({
  slug: 'hf_modcons', name: 'Mod Cons', type: 'cascade_block',
  x: 903, y: 914, entrance: 'west', floors: 7, marker: 'MB', district: HF,

  facade: {
    bgColor: '#101820', color: '#bfe4d8',
    description: outside(903, 914, 'The door is at the bottom step, under the first terrace, with the chrome plate beside it and a smaller steel one below that which was added later and reads CONNECTIONS — GROUND FLOOR, PLEASE RING.'),
  },

  rooms: [
    { key: 'hall', name: 'The Specification Hall', floor: 'stone',
      description: 'A narrow entrance hall running under the first terrace, lit from a slot at the top of one wall, with the residents\' lift at the end of it and a glazed door halfway along into the comms room. The eleven-line specification is repeated in here, engraved rather than printed, at eye height, where everybody who lives in the building walks past it twice a day. Lines one to ten are about the building. Line eleven is about the estate.',
      window: {
        name: 'the clerestory slot',
        description: 'A long thin light at the top of the wall where the terrace meets the block, giving a strip of sky and the undersides of the planting on the step above. When it rains you can hear the terrace drain before you can hear the rain.',
        light: 0.5, visibility: 0.3,
      } },
    { key: 'comms', name: 'The Comms Room', floor: 'tile', from: 'hall', dir: 'north',
      description: 'A room that was drawn as a bin store and is now the most complicated eight square metres in Halcyon Fields: two racks, a patch field with about three hundred ports on it, a wall of labelled cable, and a bench with a stool at it. The estate network comes into this building here and leaves it upstairs, and everything in between is one person\'s work and is neater than the building it is in.',
    },
  ],
  lights: {
    hall: { name: 'a light in the clerestory slot', description: 'Run along the top of the wall inside the slot itself, so the hall is lit from the same line the daylight comes in on and there is no fitting anywhere visible from standing height. It fades up on a photocell rather than switching, which is the most expensive thing about the hall.', lumens: 380, type: 'cove' },
    comms: { name: 'a bench light on an arm', description: 'Clamped to the bench and aimed at the patch field rather than the room, so the ports are lit from the side and every one of them reads. The room light is a second fitting nobody switches on.', lumens: 500, type: 'task' },
  },
  utilityAnchor: 'comms',
  utility: { name: 'The Intake', floor: 'concrete',
    description: 'Under the comms room, where the estate\'s ducts come up through the slab in a bank of nine and only four of them have anything in them. The other five are capped, labelled, and were paid for, which is a sentence that explains a great deal about this quarter.' },

  props: [
    { key: 'plate', room: 'hall', name: 'the specification plate', objectType: 'decoration',
      description: 'Eleven lines, engraved, each one a thing the building has. Ten of them are heating, glazing, acoustic separation and so on and nobody reads them. The eleventh is CONNECTED TO THE ESTATE NETWORK, and it is the only line with no qualifying detail after it anywhere on the plate or in the brochure.' },
    { key: 'patch', room: 'comms', name: 'the patch field', objectType: 'fixture', powerKw: 0.4,
      description: 'Three hundred ports in twelve blocks, labelled by flat, and about forty of them carrying anything. The labelling is immaculate and it is not the estate\'s labelling — the estate\'s is underneath, in a different hand, and is wrong in two places that somebody has struck through and corrected.' },
    { key: 'cable', room: 'comms', name: 'a wall of coiled cable', objectType: 'container',
      description: 'Every coil hung on its own hook, every hook labelled with a length, and every coil dressed in the same direction. There are more hooks than coils and the empty ones have not been taken down, which tells you what shape the stock is meant to be.' },
  ],

  items: [
    { id: 'item_hf_patchlead', name: 'a made-up patch lead', type: 'component', value: 14, weight: 60, description: null, flags: {},
      tags: { stackable: true, description: 'Two metres, terminated by hand, tested and tagged with the date. It is better than anything you can buy in the Filaments and it costs more, and the reason it costs more is on the tag.' } },
    { id: 'item_hf_netfilter', name: 'an inline filter', type: 'device', value: 55, weight: 120, description: null, flags: {},
      tags: { description: 'A small sealed chrome block with a port at each end, sold with no explanation and a shrug. What it does to a line on the estate network is take a great deal of information off it and pass everything else through unchanged, and it is not illegal, and nobody at the estate has asked her to stop selling it.' } },
  ],

  npc: {
    id: 'npc_hf_toussaint', name: 'Ghalia Toussaint', sex: 'female', hp: 35,
    homeRoom: 'comms', workRoom: 'comms', shopName: 'Mod Cons Connections',
    description: 'A compact woman on a stool at a bench, with a headtorch pushed up onto her forehead and a crimp tool in her hand more often than not. She is the only person in Halcyon Fields who was hired by the estate and is no longer paid by it, and she is still here, and the racks are still immaculate.',
    clothing: [
      'a charcoal work shirt with the sleeves rolled to the elbow',
      'a tool belt worn low with a crimp tool and a tester in it',
      'dark trousers with a long pocket down one thigh',
      'a headtorch pushed up onto the forehead and left there',
      'plain underthings',
    ],
    inventory: [
      { item_id: 'item_hf_patchlead', price: 14 },
      { item_id: 'item_hf_netfilter', price: 55 },
    ],
    chitchat: [
      'Toussaint pulls a lead out of the field, looks at both ends of it, and puts it back in the same port.',
      'She writes a label, holds it up against the light, and writes it again.',
      'The tester in her belt chirps twice and she ignores it.',
      'She coils a length of cable against her elbow in eleven turns without looking at it once.',
      'Something in the rack changes note, very slightly, and she goes still for about two seconds and then carries on.',
    ],
    dialogue: {
      root: {
        text: '"Door was open." She does not look up from the bench. "That is not an invitation, it is a fact."',
        text_by_relation: {
          first: 'The woman on the stool finishes the crimp before she turns round, and the turn is unhurried.\n\n"You are not from a flat in this building, because I know all eleven of them." She looks at you properly. "Ghalia Toussaint. I do the connections. Not just here — the whole south end of the estate, since the contractor that had it went."\n\nShe nods at the patch field, three hundred ports of it.\n\n"Forty live. Out of three hundred. So I have time to talk, which is a thing I have stopped pretending is good."',
          known: '"You." She kicks the second stool out from under the bench with her heel. "Sit down and do not touch the field."',
          familiar: 'She has a lead made up and tagged on the corner of the bench before you speak, which means she was expecting you, which means she has been thinking about the last thing you said.\n\n"I looked into it," she says. "You were right and you were right for the wrong reason."',
        },
        options: [
          { label: 'What does line eleven actually mean?', next: 'line11' },
          { label: 'What are you selling?', next: '__shop__' },
          { label: 'The estate stopped paying you?', next: 'paid' },
          { label: 'I will leave you to it.', next: 'bye' },
        ],
      },
      line11: {
        text: '"CONNECTED TO THE ESTATE NETWORK." She says it in the flat voice of somebody quoting. "It means the building takes its data off the estate\'s spine instead of off the city\'s. It is faster. It is genuinely faster, I am not going to stand here and tell you it is not."\n\nShe turns the crimp tool over.\n\n"It also means every port in that field goes through one room at the top of the Spire before it goes anywhere else. That is not a secret. It is in the technical schedule. It is on page forty-one of a document nobody who buys a flat has ever read, and it is not on the plate in the hall."',
        options: [
          { label: 'Is that why you sell the filter?', next: 'filter' },
          { label: 'Back.', next: 'root' },
        ],
      },
      filter: {
        text: '"I sell the filter because people ask me for it." A small shrug. "Second week I was here, a man on the fourth floor asked me whether there was a way to be on the network without being on the network. There is. It is not clever and it is not hidden — it sits in the line and it is the size of your thumb."\n\n"Nobody has told me to stop. I have thought about why nobody has told me to stop, and the answer I keep arriving at is that eleven flats is not enough people for anyone to care."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      paid: {
        text: '"The contractor went under in the spring." She says it without heat. "Their people went with them. The estate re-tendered the south end and the tender is at the land office with everything else in this quarter, and in the meantime there are eleven families and a health club and a bar down the lane that all need to be on something."\n\nShe taps the bench.\n\n"So I am here. I invoice the buildings direct and they mostly pay. It is better money than the contractor was and it is worse in every other way, and I would take the contractor back tomorrow."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      bye: { text: '"Pull the door to. It sticks and then it does not latch, and then it is open all night." She is back at the bench already.', options: [] },
    },
  },
});

// ── 9. Aspect Ratio ──────────────────────────────────────────────────────────
// Sold on which way its windows face, with the lift lobbies at the pinches, so every landing in it
// is the narrowest part of the building. That is the joke and the lobby is where it lands.
SPECS.push({
  slug: 'hf_aspect', name: 'Aspect Ratio', type: 'bead_tower',
  x: 903, y: 915, entrance: 'west', floors: 12, marker: 'AA', district: HF,

  facade: {
    bgColor: '#0f1923', color: '#c0e0fa',
    description: outside(903, 915, 'The entrance is at the widest part of the lowest bulge, which is the one place on the building where a door can be full height, and the glass either side of it curves away from you as you approach.'),
  },

  rooms: [
    { key: 'lobby', name: 'The Wide Floor', floor: 'stone',
      description: 'The fattest part of the lowest bead, which makes it the biggest room in the tower by a long way and gives it a wall that curves continuously through three hundred and sixty degrees with one flat piece in it, and the flat piece is the lift. A brochure stand, four chairs against the curve, and a long chrome radiator following the wall that had to be made in eleven segments.',
      window: {
        name: 'the full curve',
        description: 'The whole way round except behind the lift core, looking out onto Cinder Lane, the backs of Kerbstone Row and, if you walk far enough round, the green. It is the only lobby in the quarter you can see three streets from without moving your feet, only your head.',
        light: 0.85, visibility: 0.9,
      } },
    { key: 'landing', name: 'The Narrowest Landing', floor: 'carpet', from: 'lobby', dir: 'up',
      description: 'The first collar, and a fair advertisement for every other landing in the building: a pinch about two and a half metres across with a lift on one side and three doors on the other, and no window, because at the collar there is no outside wall to put one in. The brochure has a photograph of this landing taken with a very wide lens from inside the lift.',
    },
  ],
  lights: {
    landing: { name: 'a ring of collar lights', description: 'Six of them in the ceiling at the pinch, which at this diameter puts them almost shoulder to shoulder and makes the landing the brightest two and a half metres in the tower. Walking out of the lift you squint, every time.', lumens: 700 },
  },
  utility: { name: 'The Base Plant', floor: 'concrete',
    description: 'Directly under the wide floor, and the same shape, so it is the only plant room in Halcyon Fields with a curved wall and it has caused every contractor who has worked in it to say the same sentence.' },

  props: [
    { key: 'stand', room: 'lobby', name: 'a brochure stand', objectType: 'container',
      description: 'Chrome, angled, holding about forty copies of a brochure whose cover is a photograph of a corner window with a woman standing in it. There is no corner window in this building. Every window in it is curved, which is the argument the brochure makes on page three, and which is why the cover is wrong in a way nobody caught.' },
    { key: 'rad', room: 'lobby', name: 'a segmented radiator', objectType: 'fixture',
      description: 'Eleven straight lengths of chrome set end to end round the curve, close enough to read as one continuous piece from across the room and not from beside it. The joints are at different spacings because the eleventh piece was cut on site.' },
  ],
});

// ── 10. Glass Ceiling ────────────────────────────────────────────────────────
// Twenty storeys to an actual point. The top four floors are one unit with no internal walls that
// has never been let, and the lift goes there because there is nothing else to stop at.
SPECS.push({
  slug: 'hf_glassceiling', name: 'Glass Ceiling', type: 'glass_prism',
  x: 904, y: 911, entrance: 'east', floors: 20, marker: 'GX', district: HF,

  facade: {
    bgColor: '#0d151e', color: '#cae4ff',
    description: outside(904, 911, 'The way in is on the Cowslip Rise face, a full-height slot with a revolving door in it, and the tint of the glass over the door is a shade lighter than the rest of the building so that the entrance reads from the boulevard.'),
  },

  rooms: [
    { key: 'lobby', name: 'The Lobby', floor: 'stone',
      description: 'Six-sided at the bottom of a building that is six-sided all the way up, and taller than it is wide, which is a thing people notice with their shoulders before they notice it with their eyes. Stone, a desk with nobody at it, and a lift indicator over the doors with twenty numbers on it of which four ever light. It is very quiet and the quiet has a ring to it, because there is no soft surface anywhere in the room.',
      window: {
        name: 'the tinted faces',
        description: 'Five sides of it, out onto the boulevard end of Cowslip Rise and, through the tint, most of the north half of the quarter. The glass is dark enough that the lobby lights are visible in it from inside, layered over the street.',
        light: 0.6, visibility: 0.8,
      } },
    { key: 'apex', name: 'The Apex Floor', floor: 'concrete', from: 'lobby', dir: 'up',
      description: 'The top four storeys are one unit and this is the bottom of it: a single volume with no internal walls whatever, tapering, so the six faces come in over your head and the room gets smaller the further up you look until it ends in a point about forty feet above the floor. Screed floor, exposed services, and a ring of tape on the slab marking out a stair that was never built. There is no light fitting except the one temporary one. Sound in here does something you can hear yourself doing.',
      window: {
        name: 'the six faces',
        description: 'All six of them, from the floor to the apex, which means the view includes the sky at the top of every single wall. On a clear morning the whole Basin is in here and there is nothing in the room to look at it from.',
        light: 0.95, visibility: 0.95,
      } },
  ],
  lights: {
    apex: { name: 'a temporary festoon', description: 'A single string of lamps run up one arris on cable hooks by whoever last showed the unit, plugged into a socket on the slab and left. It lights the bottom eight feet of a forty-foot room and does nothing at all above that, so the point of the building is in the dark from underneath it.', lumens: 260, type: 'festoon' },
  },
  utility: { name: 'The Tank Room', floor: 'concrete',
    description: 'Under the lobby, holding the water for twenty floors of a building with people on four of them, which means the tanks are turned over by a pump on a timer rather than by anybody using them. The timer is the only thing in the building that runs to the design brief.' },

  props: [
    { key: 'indicator', room: 'lobby', name: 'a twenty-floor indicator', objectType: 'fixture', powerKw: 0.05,
      description: 'A chrome strip over the lift doors with the floor numbers cut into it and a lamp behind each one. Sixteen of the lamps have never been lit. They are all in working order — somebody checks them on the service visit — and they are all checked by hand, one at a time, twice a year.' },
    { key: 'tape', room: 'apex', name: 'a taped-out stair', objectType: 'decoration',
      description: 'Yellow tape on the screed, a full flight and a half-landing, set out at full size so that the unit could be shown with the stair "indicated". It was set out four years ago, it has been walked over ever since, and it is still legible because nobody walks over the middle of a room this size.' },
  ],
});

// ── 11. Peppercorn ───────────────────────────────────────────────────────────
// One credit a year for a hundred and fifty years, let to the estate's own security contractor.
// It is the only building in the quarter that is watching the rest of them.
SPECS.push({
  slug: 'hf_peppercorn', name: 'Peppercorn', type: 'atrium_court',
  x: 904, y: 913, entrance: 'east', floors: 3, marker: 'PA', district: HF,

  facade: {
    bgColor: '#101620', color: '#b6dcf7',
    description: outside(904, 913, 'The door on the Cowslip Rise side is a glass one in a chrome frame with a keypad beside it that is not switched on, and there is a light burning behind the drum glazing at every hour of the day and night.'),
  },

  rooms: [
    { key: 'desk', name: 'The Front Desk', floor: 'tile',
      description: 'A quarter of the drum, partitioned in glass rather than plasterboard so that you can see the camera wall from the door and are meant to. A high counter, a signing-in book that is genuinely used, and a rack of visitor passes on hooks numbered one to forty of which four are gone. On the counter, a bowl of the estate\'s own boiled sweets, which is somebody\'s attempt at warmth in a room with nothing else soft in it.',
      window: {
        name: 'the drum glazing',
        description: 'The curve, out onto Cowslip Rise and up it toward the boulevard, which is a sightline that takes in the entrances of four other buildings. That is not an accident and the drum was not drawn for it.',
        light: 0.75, visibility: 0.9,
      } },
    { key: 'wall', name: 'The Camera Wall', floor: 'tile', from: 'desk', dir: 'north',
      description: 'The rest of the ground floor, given over to one wall of screens and a bench in front of it with two chairs at a bench built for four. Forty-one feeds, laid out in a grid that mirrors the map of the quarter rather than the order they were installed in, which took somebody a weekend. Eleven of the tiles are dark, and the labels under those eleven all read the same thing: PLOT VACANT.',
    },
  ],
  lights: {
    wall: { name: 'a pair of bench lamps', description: 'Turned down low and aimed at the desk rather than at the screens, because a lit room behind a camera wall is a room you cannot see the cameras in. They are on a dimmer and the dimmer has a piece of tape on it marking where it lives.', lumens: 260, type: 'lamp' },
  },
  utility: { name: 'The Equipment Room', floor: 'concrete',
    description: 'Under the desk, where forty-one feeds come in and one goes out. Racked, cooled, and tidier than the building above it by a wide margin. There is a spare rack with nothing in it and a label on the front of it reading PHASE THREE.' },

  props: [
    { key: 'screens', room: 'wall', name: 'the camera wall', objectType: 'fixture', powerKw: 1.2,
      description: 'Forty-one tiles in a grid that is the quarter seen from above: the boulevard along the top, the mews on the left, the row along the bottom. Once you have understood that you cannot stop reading it as a map, and the eleven dark tiles stop being broken screens and become the eleven plots with cranes on them.' },
    { key: 'book', room: 'desk', name: 'a signing-in book', objectType: 'container',
      description: 'Hardbound, ruled, and filled in properly — name, building, time in, time out — which almost nothing in this quarter is. Read back through it and the traffic is contractors, contractors, contractors, and about one person a week who is neither.' },
    { key: 'sweets', room: 'desk', name: 'a bowl of boiled sweets', objectType: 'decoration',
      description: 'Estate crest on every wrapper, ordered by the case for a marketing suite and distributed to every reception in the quarter. This is the only one where the bowl ever needs filling, and it gets filled from a box under the counter that is down to about a third.' },
  ],

  items: [
    { id: 'item_hf_visitorpass', name: 'a visitor pass', type: 'misc', value: 0, weight: 8, description: null, flags: {},
      tags: { stackable: true, description: 'Chrome-edged card on a lanyard, numbered, and signed out against the book. It opens nothing and is not meant to — what it does is stop anybody in the quarter asking you a second time, which on a site with this many contractors on it is most of what a pass is for.' } },
    { id: 'item_hf_cylinder', name: 'a spare door cylinder', type: 'component', value: 40, weight: 180, description: null, flags: {},
      tags: { stackable: true, description: 'Estate standard, brass, keyed to a blank, and sold over the counter to residents who have lost keys and to a certain number of people who have not. Vallance writes every one of them in the book, which he is not required to do.' } },
  ],

  npc: {
    id: 'npc_hf_vallance', name: 'Hektor Vallance', sex: 'male', hp: 44,
    homeRoom: 'wall', workRoom: 'desk', shopName: 'Peppercorn Front Desk',
    description: 'A broad, still man behind a high counter in a dark contractor\'s jacket with no company name on it, who watches you come up Cowslip Rise on a screen before you reach the door and is standing at the counter by the time you do. He is polite in the specific way of somebody who has decided in advance that he is going to be.',
    clothing: [
      'a dark contractor\'s softshell with the company patch unpicked from the sleeve',
      'a plain shirt buttoned to the collar',
      'cargo trousers with nothing in most of the pockets',
      'boots with the toes scuffed pale and the rest kept black',
      'plain underthings',
    ],
    inventory: [
      { item_id: 'item_hf_visitorpass', price: 0 },
      { item_id: 'item_hf_cylinder', price: 40 },
    ],
    chitchat: [
      'Vallance writes a time in the book, turns the book a quarter turn, and squares it to the counter edge.',
      'He watches one tile on the wall for a while, then goes back to the counter without doing anything about it.',
      'He refills the sweet bowl from a box under the counter and shakes the box afterwards to hear how much is left.',
      'A pass comes back on its lanyard and he hangs it on its own numbered hook rather than the nearest one.',
      'One of the dark tiles flickers, briefly shows a crane, and goes dark again. He does not look up.',
    ],
    dialogue: {
      root: {
        text: '"Signing in?" He has the book turned round and the pen on top of it.',
        text_by_relation: {
          first: 'The man behind the counter is already standing when you come through the door, which means he saw you coming, which is the whole of what this building is.\n\n"Vallance. Front desk." He turns the book round. "You do not have to sign. Everybody does, because I put the book there, and putting the book there does most of my job for me."\n\nHe nods at the glass partition and the wall of screens behind it.\n\n"That is the rest of it. Forty-one cameras, eleven of them looking at nothing yet. Take a pass if you are going to be on the estate a while. It is free and it saves you being asked."',
          known: '"You are in the book already." He says it as a greeting. "Pass is on its hook."',
          familiar: 'He has the pass off the hook before you reach the counter and the sweet bowl pushed a little way toward you, which from him is a considerable amount.\n\n"Nothing on the wall today," he says. "Which I am telling you because you are one of about four people who asks."',
        },
        options: [
          { label: 'What are the dark screens?', next: 'dark' },
          { label: 'What can I get from you?', next: '__shop__' },
          { label: 'One credit a year?', next: 'rent' },
          { label: 'Just passing.', next: 'bye' },
        ],
      },
      dark: {
        text: '"Plots with cranes on them." He does not turn round to look. "Camera goes up when the hoarding does, because the hoarding is what gets stolen. Then the plot stops and the camera stops with it, and the estate will not pay a line rental on a feed of a building site nobody is working."\n\nHe taps the counter once.\n\n"So there are eleven black squares on that wall and they are all in the right place, and after a while you stop seeing eleven broken screens and start seeing the map."',
        options: [
          { label: 'Does the map bother you?', next: 'map' },
          { label: 'Back.', next: 'root' },
        ],
      },
      map: {
        text: '"It is a good wall." A pause that is longer than it needs to be. "Somebody laid it out to match the ground. Took a weekend. It was me."\n\nHe almost shrugs.\n\n"What bothers me is that when one of the black ones comes back on, I will notice from across the room. I have thought about that. There is no version of this job where you get to not notice."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      rent: {
        text: '"One credit a year, hundred and fifty years." He says the numbers like a man who has checked them. "A peppercorn. It is a real thing in a lease — you put a nominal rent in so that there is a rent, because a lease with no rent in it is a different document."\n\n"The developer thought it was funny. It is in the contract. And every year somebody in the estate office raises an invoice for one credit and somebody here pays it, and they will both be dead long before it runs out."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      bye: { text: '"Take a sweet. Nobody takes the sweets." He squares the book to the counter edge again.', options: [] },
    },
  },
});

// ── 12. Dual Aspect ──────────────────────────────────────────────────────────
// The same terraces front and back, which is what the name means and is not a boast. The one you
// can walk onto is the back one, facing the backs of Meltwater Row.
SPECS.push({
  slug: 'hf_dualaspect', name: 'Dual Aspect', type: 'cascade_block',
  x: 906, y: 914, entrance: 'west', floors: 9, marker: 'DA', district: HF,

  facade: {
    bgColor: '#101a20', color: '#c2e2d8',
    description: outside(906, 914, 'The entrance is in the bottom step facing Cowslip Rise, glazed, with the terrace levels listed beside it on a chrome plate and a second plate under that reading LOWER TERRACE — OPEN.'),
  },

  rooms: [
    { key: 'hall', name: 'The Entrance Hall', floor: 'stone',
      description: 'A through-hall in the bottom step, glazed at both ends, so from the door on Cowslip Rise you can see straight out the back of the building at the backs of Meltwater Row. That sightline is the building\'s entire argument and it is set up the moment you step in. There is a bench in the middle of it, side-on, so you can sit facing either way.',
      window: {
        name: 'the through-glazing',
        description: 'Both ends of the hall at once: new estate on one side, the working backs of an older street on the other, with about nine metres of pale stone between them. Nobody who comes in here fails to look both ways.',
        light: 0.8, visibility: 0.9,
      } },
    { key: 'terrace', name: 'The Gravel Terrace', floor: 'stone', from: 'hall', dir: 'up',
      description: 'The lowest of the four steps on the rear elevation, and one of the two that are still gravel. Beds marked out in timber edging, a hose reel, a stack of bagged compost gone hard at the corners, and a view over the yard walls of Meltwater Row into four back yards that are all being used for something. The two terraces above this one are planted and hanging over the edge, so you are standing under somebody else\'s garden.',
      window: {
        name: 'the terrace edge',
        description: 'No glass at all on this one — the balustrade is chrome rail, and the drop is nine metres onto the service strip. The nearest yard has a line out in it more days than not.',
        light: 0.9, visibility: 0.9,
      } },
  ],
  lights: {
    terrace: { name: 'four bollard lights', description: 'Set along the timber edging at the beds that have nothing in them, on a photocell, so they come on at dusk over bare gravel every evening of the year and have done for two.', lumens: 220, type: 'bollard' },
  },
  utility: { name: 'The Terrace Plant', floor: 'concrete',
    description: 'Under the hall, with the irrigation, the terrace drainage and a sump that takes everything four planted steps shed in a storm. It is the loudest room in the building for about ninety seconds after it stops raining.' },

  props: [
    { key: 'bench', room: 'hall', name: 'a double-sided bench', objectType: 'furniture',
      description: 'One slab of stone with a back down the middle of it, so it seats people facing opposite ways. Sit on the estate side and you look at Cowslip Rise. Sit on the other and you look at somebody\'s washing. The estate side is noticeably less worn.' },
    { key: 'compost', room: 'terrace', name: 'a stack of bagged compost', objectType: 'container',
      description: 'Eighteen bags, delivered for the lower two terraces, gone hard at the corners where the rain has got at the pallet wrap. Somebody has cut one open and used about half of it on one bed, and that bed is the only thing growing on this terrace.' },
  ],
});

// ── 13. New to Market ────────────────────────────────────────────────────────
// The estate's standard tower, the fourth one, new to market for two years. It has a show flat,
// which is the whole reason it is open.
SPECS.push({
  slug: 'hf_newmarket', name: 'New to Market', type: 'chrome_tower',
  x: 907, y: 915, entrance: 'south', floors: 14, marker: 'NM', district: HF,

  facade: {
    bgColor: '#0f1721', color: '#bfe2ff',
    description: outside(907, 915, 'The entrance faces Kerbstone Row across the podium, and there is a chrome A-board on the pavement outside it that says SHOW HOME OPEN and is brought in at six and put out again at nine.'),
  },

  rooms: [
    { key: 'lobby', name: 'The Podium Lobby', floor: 'stone',
      description: 'A round room at the bottom of a round building, which sounds obvious and is rarer than it should be — the lift core is a drum inside a drum and the floor is laid in concentric bands out from it. There is a desk, unattended, and beside the lift a chrome sign with an arrow and the words SHOW HOME — FOURTH FLOOR, and the arrow is pointing at the lift rather than upward, which somebody clearly argued about.',
      window: {
        name: 'the podium glazing',
        description: 'The whole circumference bar the service side, giving a continuous view that turns through most of a full circle as you walk round the core: the row, the Curtain, the back of Priced to Sell, the row again.',
        light: 0.8, visibility: 0.9,
      } },
    { key: 'show', name: 'The Show Home', floor: 'boards', from: 'lobby', dir: 'up',
      description: 'A flat on the fourth that has been dressed rather than furnished: everything in it is the right size and nothing in it is quite real. Books chosen for their spines, a fruit bowl with three apples in it that are changed on a rota, a wardrobe with four shirts in it and nothing else, and a bed made so tight the cover has a pressed crease down the middle. There is a faint smell of the diffuser on the hall table and under it, very faintly, of a flat nobody cooks in.',
      window: {
        name: 'the curved glazing',
        description: 'The outside of the drum at fourth-floor height, looking south over Kerbstone Row and the Curtain beyond it. The blind is always at exactly the same height, and there is a pencil mark on the frame where the blind is meant to stop.',
        light: 0.75, visibility: 0.85,
      } },
  ],
  lights: {
    show: { name: 'a dressed lighting scheme', description: 'Four separate fittings in a one-bedroom flat — a pendant, two lamps and a run of concealed light under the kitchen wall units — all of them on and all of them on at the same time, which nobody who lived here would ever do and which is the single biggest reason the room photographs well.', lumens: 760 },
  },
  utility: { name: 'The Core Base', floor: 'concrete',
    description: 'A ring-shaped room round the bottom of the lift drum, the same plan as the lobby above it and none of the finish, with the switchgear on the outer wall and a stack of the show home\'s spare cushions in a bin bag against the inner one.' },

  props: [
    { key: 'fruit', room: 'show', name: 'a bowl of three apples', objectType: 'decoration',
      description: 'Green, matched for size, arranged with the stalks pointing the same way, and replaced on a rota by whoever opens up. They are real apples. They have never been eaten, and there is a note in the opening-up checklist about what to do with the old ones that just says BIN.' },
    { key: 'wardrobe', room: 'show', name: 'a dressed wardrobe', objectType: 'container',
      description: 'Four shirts on matched hangers spaced two fingers apart, a coat, and nothing else on a rail built for a great deal more. The shoe shelf below has two pairs on it and both are left-foot-forward. Open the drawers and they are empty and lined with tissue.' },
    { key: 'sign', room: 'lobby', name: 'a show home sign', objectType: 'decoration',
      description: 'Chrome, freestanding, with an arrow on it pointing horizontally at the lift doors. It was made with the arrow pointing up, and somebody in the estate office decided that an upward arrow in a lobby means the floor above rather than the fourth, and had it remade.' },
  ],
});

// ── 14. Party Wall ───────────────────────────────────────────────────────────
// Six floors against the Curtain with a blank west flank, and a party wall award for a boundary
// with nothing on the other side of it. The framed copy is in the estate office; what is in here
// is the wall.
SPECS.push({
  slug: 'hf_partywall', name: 'Party Wall', type: 'cascade_block',
  x: 892, y: 917, entrance: 'north', floors: 6, marker: 'PW', district: HF,

  facade: {
    bgColor: '#101620', color: '#b8d8ee',
    description: outside(892, 917, 'The door is at the east end of the bottom step, off Kerbstone Row, as far from the blank flank as the building can put it.'),
  },

  rooms: [
    { key: 'hall', name: 'The Entrance Hall', floor: 'stone',
      description: 'A short hall in the bottom step with the lift at the end of it and a noticeboard beside the lift that has four things on it, three of which are about the terraces. Glazed on the row side. The west wall of this room is the blank flank, and it is the only wall in Halcyon Fields with no glass, no chrome and no opening anywhere in its entire height.',
      window: {
        name: 'the row glazing',
        description: 'Onto Kerbstone Row, with the Curtain closing the view about thirty metres to the west. At this end of the street the wall is close enough that the light in here is grey until about two in the afternoon and then very briefly is not.',
        light: 0.55, visibility: 0.8,
      } },
    { key: 'flank', name: 'The Flank Corridor', floor: 'stone', from: 'hall', dir: 'west',
      description: 'A dead-end corridor running along the inside of the blind wall, put there because the flats could not use the depth and something had to. Six metres of pale stone on one side and six metres of nothing on the other, with a cleaner\'s cupboard at the far end and a tap. People who live here use it to store bicycles, which they are not supposed to do and which is the only thing anybody has ever thought of to do with it.',
    },
  ],
  lights: {
    flank: { name: 'a run of ceiling lights on a sensor', description: 'Four fittings down the length of the corridor on a movement sensor, and the sensor is at the hall end, so they come on when you enter and go off about eleven seconds after you have stopped at the tap.', lumens: 400 },
  },
  utility: { name: 'The Cupboard Under', floor: 'concrete',
    description: 'Below the flank corridor and the same shape, which makes it long and narrow and a genuinely awkward room to get switchgear into. The panel is at the far end. Whoever installed it had to walk the whole length of the building underground to do it and left a mark on the wall with their shoulder the entire way.' },

  props: [
    { key: 'board', room: 'hall', name: 'a noticeboard', objectType: 'decoration',
      description: 'Four notices: two about the terrace irrigation timings, one about not leaving bicycles in the flank corridor, and one that is the annual fire-alarm test date and has been out of date for seven months. The bicycle notice has been up longest and has the most pin holes in it.' },
    { key: 'wall', room: 'flank', name: 'the blind flank', objectType: 'decoration',
      description: 'Six metres of one continuous piece of wall with nothing in it whatever, and a pencil line at about chest height running the entire length dead level, which is a setting-out line the plasterers used and which nobody painted over because nobody comes down here. Three bicycles are leaning on it.' },
  ],
});

// ── 15. Right of Way ─────────────────────────────────────────────────────────
// The footpath the estate could not extinguish, and a building designed round it after a year of
// trying not to. The passage is public, so the passage is where the only kiosk in the quarter is.
SPECS.push({
  slug: 'hf_rightofway', name: 'Right of Way', type: 'atrium_court',
  x: 894, y: 917, entrance: 'north', floors: 4, marker: 'RW', district: HF,

  facade: {
    bgColor: '#101a1e', color: '#c4e2d6',
    description: outside(894, 917, 'The passage mouth on Kerbstone Row is the way in and there is no door on it at all, because a door on it would be the one thing the award specifically forbids.'),
  },

  rooms: [
    { key: 'passage', name: 'The Passage', floor: 'stone',
      description: 'A covered way cut clean through the middle of a building, lit from a slot in the soffit down its whole length, paved in the same stone at both ends as the pavements it joins. It is four metres wide, which is three and a half more than the footpath legally needed and is what the estate agreed to in exchange for being allowed to build over it at all. Halfway along, on the east side, there is a kiosk in a recess that was drawn as a bin store.',
      window: {
        name: 'the passage ends',
        description: 'Two openings, one at each end, framing Kerbstone Row one way and Windrow Lane the other. Standing in the middle you can see both streets at once, which is the only place in the quarter you can.',
        light: 0.6, visibility: 0.7,
      } },
    { key: 'office', name: 'The Room Off The Passage', floor: 'boards', from: 'passage', dir: 'east',
      description: 'Behind the kiosk, and reached through it: a small square room with a sink, a chair, a two-ring burner, a bed made up on a couch that is clearly slept on, and a window into the passage rather than to the outside. It is not residential accommodation and it is not not. There is a calendar on the wall with the deliveries marked on it and nothing else.',
    },
  ],
  lights: {
    passage: { name: 'a lit soffit', description: 'A continuous slot of light down the whole length of the passage ceiling, on day and night, because the award says the path must be lit and does not say when. It is the only thing in Halcyon Fields that has never once been switched off.', lumens: 640, type: 'cove' },
    office: { name: 'a bulkhead over the sink', description: 'A chrome-rimmed bulkhead fitting of the sort you get in a plant room, put here because the room was never drawn to be a room. It is the wrong light for a place somebody sleeps and she has put a scarf over half of it.', lumens: 320, type: 'bulkhead' },
  },
  utilityAnchor: 'office',
  utility: { name: 'The Bin Store That Was', floor: 'concrete',
    description: 'Under the kiosk — the actual bin store, relocated downstairs when the recess above it became a shop, which is why the bins have to come up a ramp. The switchgear shares it with them and there is a line painted on the floor that the bins are meant to stay behind.' },

  props: [
    { key: 'kiosk', room: 'passage', name: 'the kiosk', objectType: 'furniture',
      description: 'A counter across a recess with a roller shutter over it and a chrome canopy above, fitted out for about four hundred credits with materials off this estate. It sells papers, hot drinks, cigarettes and about eleven other things, and it is the only place in Halcyon Fields where you can buy something without an appointment.' },
    { key: 'award', room: 'passage', name: 'a stone plate in the paving', objectType: 'decoration',
      description: 'Set into the floor at the midpoint of the passage, flush, engraved: PUBLIC FOOTPATH — NOT TO BE OBSTRUCTED, and a date. The date is about two hundred years before the building. The stone is a different stone from the paving round it and is the oldest made thing in Halcyon Fields by a very long way.' },
    { key: 'calendar', room: 'office', name: 'a delivery calendar', objectType: 'decoration',
      description: 'Papers on a Tuesday and a Friday, milk on a Monday, and a third delivery marked with a circle on the last Thursday of the month that has no label on it at all. Every past circle has been ticked.' },
  ],

  items: [
    { id: 'item_hf_passagepaper', name: 'a folded evening paper', type: 'media', value: 4, weight: 55, description: null, flags: {},
      tags: { stackable: true, description: 'Yesterday\'s, because the quarter is at the end of the round and nobody here has ever complained about it. Six pages of the Basin and two of the estate, and the two of the estate are an advertisement laid out to look like the other six.' } },
    { id: 'item_hf_kioskbrew', name: 'a cup of kiosk tea', type: 'drink', value: 3, weight: 130, description: null, flags: {},
      tags: { stackable: false, description: 'Out of an urn that is filled at half past six and is never quite emptied, into a paper cup with a lid that does not fit. It is too strong, it is too hot, and every contractor on this estate has one in their hand at some point in the morning.' } },
  ],

  npc: {
    id: 'npc_hf_culhane', name: 'Imelda Culhane', sex: 'female', hp: 33,
    homeRoom: 'office', workRoom: 'passage', shopName: 'The Passage Kiosk',
    description: 'A small, sharp woman in three layers behind a counter in a covered passage, with her hands round a cup most of the time because the passage funnels the wind straight through and nobody thought about that. She has the best information in Halcyon Fields and she has it because everybody walks past her and nobody notices a kiosk.',
    clothing: [
      'a quilted body warmer over two jumpers, the top one darned at one elbow',
      'fingerless gloves that are actually gloves with the fingers cut off',
      'a long skirt over boots, which is warmer than trousers and she will say so',
      'a scarf wound twice and tucked in',
      'plain underthings',
    ],
    inventory: [
      { item_id: 'item_hf_passagepaper', price: 4 },
      { item_id: 'item_hf_kioskbrew', price: 3 },
    ],
    chitchat: [
      'Culhane wraps both hands round the cup and watches somebody go through the passage without turning her head.',
      'She squares the papers on the counter, which does not need doing, and looks up the passage at the row.',
      'The wind gets up and goes straight through from end to end, and she pulls the scarf without seeming to notice she has.',
      'She writes something short in a notebook and puts it back under the counter.',
      'Someone comes through from the lane, nods at her, and does not stop. She nods back at exactly the right moment.',
    ],
    dialogue: {
      root: {
        text: '"Tea is on. Paper is yesterday\'s and always will be." She lifts the cup an inch.',
        text_by_relation: {
          first: 'You are almost past the recess before you notice there is a counter in it, and the woman behind it is not at all surprised by that.\n\n"Everybody does that." She nods at the passage running away from her in both directions. "Four metres wide and nobody looks sideways in it. I have watched about eleven thousand people go through here and I would say four hundred have seen me."\n\nShe puts a hand on the papers.\n\n"Imelda Culhane. Tea, papers, smokes. And before you ask — yes, in a bin store. It was drawn as one. I asked."',
          known: '"You saw me the second time as well." She sounds genuinely pleased about it. "Go on."',
          familiar: 'The tea is already poured and on the counter, and she has not asked.\n\n"There was a van in here at four this morning," she says. "Not one of ours. I will tell you about it if you want."',
        },
        options: [
          { label: 'What is the stone in the floor?', next: 'stone' },
          { label: 'What are you selling?', next: '__shop__' },
          { label: 'You see everybody, then.', next: 'sees' },
          { label: 'On my way.', next: 'bye' },
        ],
      },
      stone: {
        text: '"That is the whole building." She says it with some satisfaction. "There was a path across this ground before there was a Halcyon Fields and before there was most of Coldwater, and it is written down, and the estate spent a year and a great deal of money finding out that they could not make it not be."\n\nShe taps the counter.\n\n"So they built over it. Four metres, covered, lit, and they have to keep it open, and they have to keep it clean. They are also not allowed to put a door on either end. That is why it is cold in here and that is why I am wearing this."',
        options: [
          { label: 'Do they mind the kiosk?', next: 'mind' },
          { label: 'Back.', next: 'root' },
        ],
      },
      mind: {
        text: '"They cannot decide." A short laugh. "I am not obstructing the path, because I am in a recess, and they checked. And the recess is a bin store on the drawing, and a bin store is not a shop, and that is at the land office along with everything else in this quarter."\n\n"Eleven months. It will be eleven months and something by the time they get to it. Meanwhile there is nowhere else on this estate to buy a cup of tea, and half the estate office comes through here."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      sees: {
        text: '"I see everybody." No boast in it at all. "Not because I am watching. Because this is the only way from the row to the lane without going round, and going round is four hundred metres, and nobody goes round."\n\nShe looks up the passage.\n\n"The man from the security desk comes through at seven. The lettings man from Chain Free comes through at eight, and he walks up the lane and back down it before he opens, every day, which I have never mentioned to him. And there is a van on the last Thursday of the month that comes in from the lane end and does not come out of the row end."',
        options: [
          { label: 'Where does the van go?', next: 'van' },
          { label: 'Back.', next: 'root' },
        ],
      },
      van: {
        text: '"It turns round." She says it a fraction too evenly. "There is nowhere to turn round in the lane, so it comes in here, and it stops, and then it goes back the way it came."\n\nA pause.\n\n"That is what I have decided it does. I mark it on the calendar. I have been marking it for nine months and I have not once gone and looked, and I would rather you did not tell me you have."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      bye: { text: '"Mind the wind at the lane end. It comes round the corner and takes the paper out of your hand." She is already looking past you.', options: [] },
    },
  },
});

// ── 16. Well Appointed ───────────────────────────────────────────────────────
// The one building in the quarter where somebody was allowed to spend money on how it looks. The
// collars are a brighter chrome and the lobby knows it.
SPECS.push({
  slug: 'hf_wellappointed', name: 'Well Appointed', type: 'bead_tower',
  x: 896, y: 917, entrance: 'north', floors: 11, marker: 'WB', district: HF,

  facade: {
    bgColor: '#0f1a24', color: '#cce8ff',
    description: outside(896, 917, 'The entrance is under the lowest collar on the Kerbstone Row side, and the collar is carried down round the door as a chrome hood in the same bright finish, which cost about four times what a plain one would have.'),
  },

  rooms: [
    { key: 'lobby', name: 'The Lobby', floor: 'stone',
      description: 'A round room with a bright chrome band running round it at head height, continuing the collar through the wall and out the other side, so the building\'s one piece of vanity does not stop at the front door. Pale stone, three chairs that match each other, and a floor laid in a spiral rather than in bands, which took a fortnight and which nobody has ever remarked on to the people who live here.',
      window: {
        name: 'the bulge glazing',
        description: 'The curve of the lowest bead, out onto Kerbstone Row and, at the east side, a slice of Sorrel Way. In the evening the light comes in off the bright collar outside and lands on the ceiling.',
        light: 0.8, visibility: 0.85,
      } },
    { key: 'collar', name: 'The First Collar', floor: 'carpet', from: 'lobby', dir: 'up',
      description: 'The landing at the first pinch, which in this building is the one place you can see how the bright finish is actually made: the collar is not a band applied to the building, it is a structural ring, and up here the inside face of it is exposed and polished and you can put your hand on it. It is cold and it is perfect and there is a small plate on it giving the fabricator\'s name.',
    },
  ],
  lights: {
    collar: { name: 'a light in the ring', description: 'Concealed inside the structural collar itself and washing down the inside face of it, so the landing is lit by a ring of reflected light with no fitting visible anywhere. It is the single most expensive light in Halcyon Fields and it is on a landing with three doors off it.', lumens: 440, type: 'cove' },
  },
  utility: { name: 'The Ring Base', floor: 'concrete',
    description: 'The bottom of the spine, where the collars are tied down. Plain, painted, and containing one thing worth looking at: an off-cut of the bright collar section about a metre long, left standing against the wall, unpolished on the inside and mirror on the out.' },

  props: [
    { key: 'band', room: 'lobby', name: 'the chrome band', objectType: 'decoration',
      description: 'Head height, continuous, carried straight through the glass at two points with a joint so fine you have to look for it. It reflects the whole room back at you slightly compressed, and everybody who waits for the lift in here ends up looking at themselves in it and then looking away.' },
    { key: 'plate', room: 'collar', name: "a fabricator's plate", objectType: 'decoration',
      description: 'Four inches by two, engraved with a company name, a town and a year, screwed to the inside of the ring where only somebody standing on this landing will ever see it. It is the only maker\'s mark on any building in this quarter.' },
  ],
});

// ── 17. Change of Use ────────────────────────────────────────────────────────
// Consented as offices, built as offices, let floor by floor to a dance studio, a paper store, a
// clinic and two floors of nothing. The application to regularise it has been at the land office
// for eleven months.
SPECS.push({
  slug: 'hf_changeofuse', name: 'Change of Use', type: 'chrome_slab',
  x: 897, y: 917, entrance: 'north', floors: 6, marker: 'CK', district: HF,

  facade: {
    bgColor: '#121620', color: '#c4d8e8',
    description: outside(897, 917, 'The entrance is in the middle of the crescent facing Kerbstone Row, and there are four separate name plates screwed to the chrome beside it at four different heights in four different styles, which is the whole building in one glance.'),
  },

  rooms: [
    { key: 'lobby', name: 'The Shared Lobby', floor: 'stone',
      description: 'A lobby that was drawn for one tenant and is used by four, which shows: there is one desk and nobody has ever sat at it, four separate signing books on the sill instead, and a lift whose call button has a laminated card taped beside it listing which floor is which. The card has been redone twice. Somebody has left a rack of coat hooks by the stair that the landlord did not install.',
      window: {
        name: 'the crescent glazing',
        description: 'Curved along the row, so the view bends: the east end of Kerbstone Row one way, and the Curtain the other, and from the middle you get both in the same pane.',
        light: 0.75, visibility: 0.85,
      } },
    { key: 'studio', name: 'The Dance Studio', floor: 'boards', from: 'lobby', dir: 'up',
      description: 'The second floor, floor to ceiling in mirror down the inside wall and glass down the outside one, which means the room contains the street twice. Sprung boards laid over an office screed by somebody who knew what they were doing, a barre the whole length of the mirror, and a stack of chairs in the corner for the evenings when it is something else. There is chalk dust in the corners and the windows are permanently a little misted at the bottom.',
      window: {
        name: 'the curved glazing',
        description: 'The whole outside of the crescent at second-floor height, and reflected in the mirror opposite, so from the middle of the floor Kerbstone Row is in front of you and behind you at once. People stop dancing and look at that and then carry on.',
        light: 0.8, visibility: 0.85,
      } },
  ],
  lights: {
    studio: { name: 'a run of fittings on the mirror wall', description: 'Angled at the boards rather than at the mirror, because a light aimed at a mirrored wall is a light aimed at everybody in the room. Whoever hung them worked that out on the second evening and moved all nine.', lumens: 820 },
  },
  utility: { name: 'The Riser Cupboard', floor: 'concrete',
    description: 'Under the lobby, with the switchgear and four separate meters on a board, labelled STUDIO, PAPER, CLINIC and — on the fourth, in a different hand — ?. The fourth one turns.' },

  props: [
    { key: 'plates', room: 'lobby', name: 'four name plates', objectType: 'decoration',
      description: 'Screwed to the chrome beside the door at four heights: an engraved brass one, a printed acrylic one, a machine-cut chrome one that matches the building and a piece of card in a plastic sleeve. Reading down them is reading the order the tenants arrived in and how sure each of them was that they were staying.' },
    { key: 'barre', room: 'studio', name: 'a barre', objectType: 'fixture',
      description: 'The full length of the mirror, at two heights, bracketed into a wall that was built to take pinboards. The brackets are far better than the wall and there is a line of small repairs under each one where the plaster has given up and been made good, four times, in a slightly different colour each time.' },
    { key: 'chairs', room: 'studio', name: 'a stack of chairs', objectType: 'furniture',
      description: 'Forty of them in the corner, stacked eight high, because the studio is a meeting room three evenings a week and a residents\' association two more. Putting them out takes eleven minutes and putting them away takes six, which Adeyemi has timed.' },
  ],

  items: [
    { id: 'item_hf_rosinblock', name: 'a block of rosin', type: 'misc', value: 5, weight: 40, description: null, flags: {},
      tags: { stackable: true, description: 'Amber, brittle, and kept in a tin tray by the barre for anybody whose shoes are slipping on boards that were laid over an office floor and have never quite stopped being slightly too fast.' } },
    { id: 'item_hf_studiotowel', name: 'a studio towel', type: 'misc', value: 7, weight: 200, description: null, flags: {},
      tags: { stackable: true, description: 'Plain, grey, and laundered so often it has gone soft all the way through. Sold rather than lent since the summer, when the stack went from forty to eleven inside a month and nobody would say anything about it.' } },
  ],

  npc: {
    id: 'npc_hf_adeyemi', name: 'Roshan Adeyemi', sex: 'male', hp: 40,
    homeRoom: 'studio', workRoom: 'studio', shopName: 'The Second Floor Studio',
    description: 'A lean man in his thirties in soft clothes, barefoot on a sprung floor, who moves round a room the way somebody does when they have worked out where everything in it is. He teaches four classes a day in a building consented for offices and has been waiting eleven months to find out whether he is allowed to.',
    clothing: [
      'a loose grey top with the sleeves pushed past the elbow',
      'soft wide trousers gathered at the ankle',
      'a towel over one shoulder more often than not',
      'bare feet, with a pair of soft shoes left by the barre',
      'plain underthings',
    ],
    inventory: [
      { item_id: 'item_hf_rosinblock', price: 5 },
      { item_id: 'item_hf_studiotowel', price: 7 },
    ],
    chitchat: [
      'Adeyemi walks the length of the barre with one hand on it, not holding it, just touching.',
      'He looks at the misted bottom of the glass, wipes a hand across it, and leaves the mark.',
      'He puts a foot flat on a board near the middle of the floor and rocks his weight onto it, listening.',
      'Somewhere below, a lift arrives and does not open, and he glances at the door.',
      'He takes two chairs off the stack, looks at the room, and puts them both back.',
    ],
    dialogue: {
      root: {
        text: '"Come in — mind the boards, they are faster than they look." He is already moving out of your way.',
        text_by_relation: {
          first: 'The room contains the street twice, and it takes a moment to work out that half of it is a mirror. The man crossing it toward you does not hurry.\n\n"Roshan Adeyemi. Second floor." He puts a hand out and there is chalk on it, and he notices and wipes it on the towel first. "Four classes a day, three evenings of something else, and a stack of forty chairs for when the residents want to argue about the terraces."\n\nHe nods at the floor.\n\n"This was an office. That is the only interesting thing about the building and unfortunately it is also the problem."',
          known: '"You came up." He sounds pleased, and slightly surprised. "Nobody comes up unless they are coming to something."',
          familiar: 'He is at the barre when you come in and finishes what he is doing before he turns round, which is the compliment.\n\n"Still nothing from the land office," he says. "Eleven months and something."',
        },
        options: [
          { label: 'What is the problem?', next: 'problem' },
          { label: 'What have you got?', next: '__shop__' },
          { label: 'What is on the other floors?', next: 'floors' },
          { label: 'I will let you work.', next: 'bye' },
        ],
      },
      problem: {
        text: '"The building is consented as offices." He says it the way you say something you have said to a great many people. "Every floor in it. A dance studio is not an office. Nor is a clinic, nor is a warehouse full of other people\'s paper."\n\nHe rocks his weight onto a board and it gives, very slightly.\n\n"So there is an application in, to regularise the lot of us at once, which the landlord made and which is the right way round — one application, four tenants. It has been at the land office eleven months. In the meantime we are all here and nobody has told us to stop, and everybody in this building has worked out that being told to stop and being told nothing look identical from the inside."',
        options: [
          { label: 'What happens if it is refused?', next: 'refused' },
          { label: 'Back.', next: 'root' },
        ],
      },
      refused: {
        text: '"I lift a floor." A small shrug that is not small. "The boards are mine. I laid them over their screed on battens so that I could take them up again, and I did that on the first day, before I taught a single class, because I am not stupid."\n\nHe looks down at them.\n\n"It took four weekends. It would take me two to get them out. I have thought about that more than is good for me and I have decided that laying a floor you can take up is not the same as expecting to."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      floors: {
        text: '"Ground is the lobby, and nobody is on the desk because there are four of us and the desk is one desk." He counts up with his chin. "I am second. Third is a company that stores paper for other companies, which is exactly as quiet a neighbour as it sounds. Fourth is a clinic, two days a week."\n\n"Fifth and sixth are nothing. Empty, unlit, never let. The lift goes there and the call button works and I have been up once, and there is nothing at all."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      bye: { text: '"Take the stair if the lift is slow. It is quicker and nobody uses it." He is back at the barre before you reach the door.', options: [] },
    },
  },
});

// ── 18. Blue Chip ────────────────────────────────────────────────────────────
// Twelve floors owned by one institution and empty by design. There is a lobby and there is
// nobody in it, and that is the building — a room authored to be exactly as empty as the fiction
// says, which is a different thing from a building with no door in it.
SPECS.push({
  slug: 'hf_bluechip', name: 'Blue Chip', type: 'chrome_tower',
  x: 901, y: 917, entrance: 'north', floors: 12, marker: 'BB', district: HF,

  facade: {
    bgColor: '#0e151e', color: '#b0d6f0',
    description: outside(901, 917, 'The door is on the Kerbstone Row side at the corner of the podium, unlocked, with no name on it and no bell, and there is a mat inside it that the doors push back a quarter of an inch every time they open.'),
  },

  rooms: [
    { key: 'lobby', name: 'The Lobby', floor: 'stone',
      description: 'A round lobby, immaculate, lit, heated, and empty — not empty of people, empty of things. There is a lift. There is a fire notice. There is nothing else: no desk, no chairs, no board, no bin, no plant, nothing on any wall anywhere. It is cleaned on a contract and the contract is honoured, and the stone has the deep even shine of a floor that has been polished a great many times and walked on almost never.',
      window: {
        name: 'the podium glazing',
        description: 'The full circumference, giving the emptiest room in Halcyon Fields the best view of the street in it. From outside after dark the lobby is lit and visible and there is never anybody in it, and that is the single most unsettling thing on Kerbstone Row.',
        light: 0.8, visibility: 0.9,
      } },
  ],
  utility: { name: 'The Core Base', floor: 'concrete',
    description: 'Switchgear, a booster set, and a lift pit, all of it running at the design load for a building with a hundred and forty-four flats in it and nobody in any of them. The water is turned over on a timer so that it does not go stale, which is a thing a building does for the benefit of nobody.' },

  props: [
    { key: 'notice', room: 'lobby', name: 'a fire notice', objectType: 'decoration',
      description: 'The only object on any wall in the room: a chrome-framed card giving the assembly point, which is the pavement outside, and the responsible person, which is a company rather than a name. Underneath, in the box for the last drill, the date is the day the building was handed over.' },
    { key: 'mat', room: 'lobby', name: 'an entrance mat', objectType: 'decoration',
      description: 'Recessed flush into the stone, the full width of the doors, brushed clean on the same contract as the floor. It is unworn in a way you can see: the pile stands up everywhere except in one strip about a foot wide where the cleaner walks in and out.' },
  ],
});

// ── 19. Stamp Duty ───────────────────────────────────────────────────────────
// A glazed disc on six legs, and the whole ground floor is the space under it, which everybody on
// the row uses to get out of the rain. The floor above is a records office and somebody is in it.
SPECS.push({
  slug: 'hf_stampduty', name: 'Stamp Duty', type: 'lens_hall',
  x: 902, y: 917, entrance: 'north', floors: 4, marker: 'DU', district: HF,

  facade: {
    bgColor: '#0f1721', color: '#c0dcf4',
    description: outside(902, 917, 'There is no front door at street level, because at street level there is no front — you walk in under the disc between two of the legs, and the stair up to the records office is wrapped round the leg nearest the corner.'),
  },

  rooms: [
    { key: 'undercroft', name: 'The Undercroft', floor: 'stone',
      description: 'A paved room with no walls: six chrome legs, a lit soffit overhead, and the weather on all sides of it. It is the most used space in Halcyon Fields by a distance — everybody on Kerbstone Row stands in here when it rains, contractors eat lunch in here, and two of the legs have the polish worn off them at shoulder height on the side you lean on. The lighting in the soffit is on all day because there is no daylight under a disc.',
      window: {
        name: 'the open sides',
        description: 'Six of them, between the legs, which is not a window and is how you see out of this room. Standing at the middle you have the row, the lane, Cinder Lane coming down, and the Curtain, in six separate framed slices.',
        light: 0.7, visibility: 0.95,
      } },
    { key: 'records', name: 'The Records Office', floor: 'boards', from: 'undercroft', dir: 'up',
      description: 'Inside the disc: one round room, glazed the whole way round, thickest through the middle so the ceiling is high at the centre and comes down to head height at the glass. Shelving radiates from a core in the middle like spokes, so every aisle is wider at the outside than the inside, and the whole of the estate\'s paper that is not at the land office is in here in date order. It is warm, it smells of paper, and it is the quietest room in the quarter.',
      window: {
        name: 'the lens glazing',
        description: 'The full circumference at first-floor height, and because the disc is thickest through the middle the glass leans out at the top, so standing at it you are looking slightly down at the pavement and slightly out from the building at the same time.',
        light: 0.85, visibility: 0.9,
      } },
  ],
  lights: {
    records: { name: 'a light at every aisle', description: 'One fitting down the centre of each radiating aisle, which puts them all within a foot of each other at the core and a long way apart at the glass, so the middle of the room is bright and the outside of it is lit by the windows and not much else.', lumens: 560 },
  },
  // ⚠ NOT ANCHORED IN THE RECORDS OFFICE, though that is where you would put it. That room is
  // reached by `up`, so its own `down` is the stair back to the undercroft, and the utility room
  // is written last and would take the slot — see the second guard in lib.mjs, which this
  // building is the reason for.
  utility: { name: 'The Pit Below the Paving', floor: 'concrete',
    description: 'Under the undercroft, reached by a flush hatch between two of the legs that everybody on Kerbstone Row has stood on and nobody has noticed. Switchgear on one wall, a sump on the other, and about four inches of leaf litter in the corner that has come down through the hatch grating over two autumns and that nobody has ever been sent to sweep out.' },

  props: [
    { key: 'shelving', room: 'records', name: 'radiating shelving', objectType: 'container',
      description: 'Sixteen runs off a central core, every one of them a different length because the room is round and the core is not in the exact middle. Filed by date rather than by plot, which is the estate\'s system and not anybody else\'s, and which means finding a single building means knowing when something happened to it.' },
    { key: 'legs', room: 'undercroft', name: 'the six legs', objectType: 'decoration',
      description: 'Chrome, tapered, and carrying a disc four floors deep. Two of them have the mirror finish worn to a soft grey at shoulder height on the row side, in a patch about the size of a hand, from two years of people leaning on them out of the rain. Nobody has polished it out, which is the only maintenance decision in Halcyon Fields anybody made on purpose.' },
    { key: 'deedbox', room: 'records', name: 'a rank of deed boxes', objectType: 'container',
      description: 'Black japanned tin with the owner painted on each lid in a thin yellow hand, most of them a company and four of them a person. They may not leave the building, which is written on the inside of the cupboard door rather than on the boxes, so you only find it out after you have got one down.' },
  ],

  items: [
    { id: 'item_hf_deedcopy', name: 'a certified copy of a deed', type: 'media', value: 35, weight: 60, description: null, flags: {},
      tags: { stackable: true, description: 'Stamped, dated and signed across the fold, which is what makes it worth thirty-five credits rather than the cost of the paper. Which deed depends on what you asked for, and Quillon will make a copy of anything in the room for anybody who can name it.' } },
    { id: 'item_hf_searchcert', name: 'a search certificate', type: 'media', value: 20, weight: 40, description: null, flags: {},
      tags: { stackable: true, description: 'A single sheet confirming that a search of the estate\'s own records against a named plot found what it found. It is the shortest document in the building and the only one that can say nothing at all and still be worth paying for.' } },
  ],

  npc: {
    id: 'npc_hf_quillon', name: 'Elspeth Quillon', sex: 'female', hp: 30,
    homeRoom: 'records', workRoom: 'records', shopName: 'The Records Office',
    description: 'A narrow, precise woman of about sixty at a desk in the middle of a round room, in a cardigan the colour of the shelving, who looks up when the stair sounds and not before. She has the estate\'s entire paper history in sixteen radiating aisles behind her and she can find any of it, provided you can tell her roughly when.',
    clothing: [
      'a long cardigan in a brown that matches the shelving, pockets stretched',
      'a plain blouse buttoned high',
      'a tweed skirt and thick stockings, because the glass is cold at ankle height',
      'flat shoes that make no sound on boards',
      'plain underthings',
    ],
    inventory: [
      { item_id: 'item_hf_deedcopy', price: 35 },
      { item_id: 'item_hf_searchcert', price: 20 },
    ],
    chitchat: [
      'Quillon takes a file down an aisle, reads the spine, and puts it back without opening it.',
      'She writes a date on a slip and puts the slip in a wooden tray that already has four in it.',
      'She goes to the glass, looks straight down at the undercroft, and comes back.',
      'The heating ticks somewhere behind the shelving and she counts, silently, and stops at eleven.',
      'She squares a stack of paper by tapping it on the desk three times, which in this room is a loud noise.',
    ],
    dialogue: {
      root: {
        text: '"You came up." She marks her place before she looks at you. "Not many do."',
        text_by_relation: {
          first: 'The stair comes up inside one of the legs and puts you out at the edge of a round room, and the woman at the desk in the middle of it has heard you the whole way.\n\n"Elspeth Quillon." She takes her glasses off rather than putting them on. "Records. Everything the estate has that the land office has not got, which at the moment is rather more than usual."\n\nShe indicates the sixteen aisles running away from her in every direction.\n\n"Filed by date. Not by plot. I did not choose that and I have stopped arguing about it, and it means that if you want a building you must first tell me a year."',
          known: '"Back." She reaches for the tray of slips without looking at it. "Which year?"',
          familiar: 'There is a file already out on the corner of the desk with a slip in it, and she does not mention it until you do.\n\n"I found the other one," she says. "It is not what you thought and it is better."',
        },
        options: [
          { label: 'Filed by date?', next: 'date' },
          { label: 'What can you do for me?', next: '__shop__' },
          { label: 'Nobody comes up?', next: 'nobody' },
          { label: 'Another time.', next: 'bye' },
        ],
      },
      date: {
        text: '"By date." She says it without complaint, which takes effort. "The estate\'s system, from when the estate was one field and four drawings and everything that happened to it happened in order. It worked perfectly for about three years."\n\nShe puts a hand flat on the desk.\n\n"It stopped working when the same plot started having things happen to it four times. Vacant Possession has a file in nine different years. If you do not know which of the nine you want, you are going to be here a while, and I will help, and we will both be here a while."',
        options: [
          { label: 'Can it not be re-filed?', next: 'refile' },
          { label: 'Back.', next: 'root' },
        ],
      },
      refile: {
        text: '"It can." A very small pause. "It would take one person about two years, and at the end of it the estate would have a records office filed by plot and a person who knew where nothing was, because I would be finished."\n\nShe puts the glasses back on.\n\n"I have written that down twice and sent it twice. The second time I took out the last part."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      nobody: {
        text: '"The undercroft is the busiest room in the quarter." She nods at the floor. "Forty people under there when it rains. The stair is in the leg on the corner, it is signed, and it is lit, and in two years I have had perhaps ninety people up it."\n\n"They stand out of the rain and they look at the six legs and they never once wonder what the disc is for. I used to find that irritating. I have come round to it — it is the only privacy in a building made entirely of glass."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      bye: { text: '"Mind the stair. It turns tighter at the top than it does at the bottom, because it is inside a leg that tapers." She has the glasses off again already.', options: [] },
    },
  },
});

// ── run ──────────────────────────────────────────────────────────────────────
// ⚠ THE GATE IS A SHELL CHECK, NOT A COUNT. batch8 asserts there are exactly eleven `shell_tower`
// plots, because Pardoe says the number out loud in Ground Rent. This file must therefore leave
// all eleven alone, and the cheapest way to be sure of that is to refuse a shell here — which
// `outside()` already does at read time, and which this re-checks against the FINISHED spec list
// in case somebody adds one without going through it.
for (const s of SPECS) {
  if (s.type === 'shell_tower') throw new Error(`${s.name} is a shell_tower — see the header; the eleven are Pardoe's eleven amber tacks`);
}
const slugs = new Set(SPECS.map((s) => s.slug));
if (slugs.size !== SPECS.length) throw new Error('duplicate slug in SPECS');

// Every unit that is meant to be RENTABLE, and the price. Applied after `authorBuilding`, because
// `is_apartment` is not part of a building spec and should not be — `lib.mjs` authors rooms, and a
// flat is a room with two extra flags on it. ⚠ `rent_cost` lives on the ZONE and not in the
// `apartments` table, which is purely a player-tenancy ledger: authored here it survives every
// restart, rebuild and prod import, and an unpriced unit would silently fall back to 100.
const APARTMENTS = {
  zone_hf_chainfree_u1: 200,
  zone_hf_chainfree_u2: 200,
  zone_hf_chainfree_u3: 200,
  zone_hf_chainfree_u4: 200,   // Lindqvist's — priced the same, and occupied because he lives in it
};

// ⚠ OCCUPANCY IS AUTHORED, NOT DERIVED FROM `home_zone`. `getNpcResidence` reads the
// `npc_residences` table and nothing writes a row there off an NPC's home — so setting
// Lindqvist's `home_zone` to 3D puts him IN the flat and leaves the flat READY TO RENT,
// which is a player taking a lease on the room the letting agent sleeps in. The registry is
// a content table with its own files (69 of them) and this is the one this batch owes it.
const RESIDENCES = {
  zone_hf_chainfree_u4: 'npc_hf_lindqvist',
};

const results = [];
for (const spec of SPECS) results.push(await authorBuilding(store, spec));

for (const [zid, rent] of Object.entries(APARTMENTS)) {
  const z = store.get('zones', zid);
  if (!z) throw new Error(`${zid} was not authored — the apartment list is out of step with the specs`);
  store.patch('zones', zid, { flags: { ...(z.flags || {}), is_apartment: true, rent_cost: rent } });
}

for (const [zid, npcId] of Object.entries(RESIDENCES)) {
  if (!APARTMENTS[zid]) throw new Error(`${zid} has a resident but is not an apartment`);
  store.patch('npc_residences', zid, { zone_id: zid, npc_id: npcId, note: null });
}

// MARK-4: a marker has to be unique across the world or the map draws two tiles with one code.
// These nineteen keep batch8's markers, so the only way this trips is if somebody changed one.
const mine = new Map(SPECS.map((s) => [s.marker, s.name]));
const dupes = [];
for (const z of store.all('zones')) {
  if (!z.marker || !mine.has(z.marker)) continue;
  if (mine.get(z.marker) !== z.name && !z.id.startsWith('zone_hf_')) dupes.push(`${z.marker}: ${z.name} vs ${mine.get(z.marker)}`);
}
if (dupes.length) throw new Error(`marker collision(s):\n  ${dupes.join('\n  ')}`);

const written = store.flush({ dryRun: DRY });
console.log(`${DRY ? 'would write' : 'wrote'} ${written.length} file(s)`);
console.log(`  buildings   ${results.length}`);
console.log(`  keepers     ${SPECS.filter((s) => s.npc).length}`);
console.log(`  flats       ${Object.keys(APARTMENTS).length} (${Object.keys(APARTMENTS).length - Object.keys(RESIDENCES).length} vacant, ${Object.keys(RESIDENCES).length} resident)`);
console.log(`\nnext:\n  node scripts/content/mint-connections.mjs --write\n  npm run content:lint`);
