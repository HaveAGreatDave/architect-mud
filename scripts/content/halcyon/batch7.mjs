/**
 * Halcyon Fields, batch 7 — the twelve you can walk into.
 *
 * Run after batch6, which lays Vetch Mews, Sorrel Way, Cowslip Rise and Windrow Lane. Every
 * entrance below opens onto one of those or onto a street that was already there; `authorBuilding`
 * derives the street from the entrance direction and REFUSES a spec whose door does not face a
 * road, so the plan cannot drift from the ground.
 *
 * ⚠ THESE TWELVE ARE THE ONES WITH A REASON TO GO IN. The other thirty-one plots (batch8) are
 * clad, topped out and shut: a residential tower in a quarter nobody has moved into does not have
 * a lobby you can wander around, and thirty-one invented ones would be thirty-one rooms with
 * nothing in them. The split is the district's own fiction rather than a shortcut — read the ⚠ at
 * the top of batch8 before converting one of those to a facade.
 *
 * ⚠ AND THE PROGRAMMES ARE ALL ESTATE PROGRAMMES. Not one of these is a trade that could equally
 * have gone in the Filaments: a sales suite, an estate office, a site office, a concierge, a
 * deposit house, a viewing platform. What a half-built quarter has that a finished one does not is
 * the machinery of SELLING itself, and that is the thing to build here while it is still true.
 *
 * Idempotent: every id derives from the placement, so a re-run is an upsert.
 *
 *   node scripts/content/halcyon/batch7.mjs [--dry-run]
 */
import { authorBuilding, loadContentStore, SHOP_HOURS } from './lib.mjs';

const DRY = process.argv.includes('--dry-run');
const store = loadContentStore();
const HF = 'halcyon_fields';
const SPECS = [];

// ── 1. Artist's Impression ───────────────────────────────────────────────────
// The marketing suite, and the one building in the quarter that is entirely about the quarter.
// Everything in it is a picture of somewhere that does not exist yet, including the model, which
// is scrupulously accurate about the buildings that are up and completely made up about the rest.
SPECS.push({
  slug: 'hf_impression', name: "Artist's Impression", type: 'atrium_court',
  x: 894, y: 913, entrance: 'west', floors: 3, marker: 'AI', district: HF,

  facade: {
    bgColor: '#101a24', color: '#bfe2ff',
    description: 'Two low curved wings folded round a glass drum, all of it lit from inside at a level that does not change between noon and midnight. The doors are automatic and open at eight feet, which is further out than anyone expects. Across the drum, in chrome letters spaced wide enough to read from the boulevard: HALCYON FIELDS — A NEW QUARTER. Under it, much smaller, a line of legal type nobody has ever stood close enough to finish.',
  },

  rooms: [
    { key: 'suite', name: 'The Sales Floor', floor: 'carpet',
      description: 'Pale carpet with the vacuum lines still in it and four desks that are never all occupied at once. The middle of the room is the model: the whole quarter at one inch to twenty feet, under a dust case, lit from inside by threads of fibre no thicker than hair. The built parts of it are exact down to the crane. The rest of it is finished, landscaped, and full of small brass people.',
      window: {
        name: 'the drum glazing',
        description: 'Curved glass the whole way round, out onto the mews on one side and open meadow on the other. The view from the desks is of the ground the model says is a boulevard.',
        light: 0.85, visibility: 0.9,
      } },
    { key: 'booth', name: 'The Negotiator\'s Booth', floor: 'carpet', from: 'suite', dir: 'east',
      description: 'A glazed cubicle off the floor with a round table, three chairs and no window to the outside, so the only view is back across the model. On the table: a leather folder, a good pen, and a printed schedule of plots with a second price written beside each one in pencil. The pencil column is lower than the printed one on every line.',
      window: {
        name: 'the internal glazing',
        description: 'A pane onto the sales floor, so whoever is sitting here can see the model and be seen not looking at it.',
        light: 0.6, visibility: 0.5,
      } },
  ],
  lights: {
    booth: { name: 'a downlight over the table', description: 'A single recessed lamp centred exactly on the table, throwing a circle of light onto the folder and leaving the three faces round it in the dimmer edge of it. Somebody chose that.', lumens: 620 },
  },
  utility: { name: 'The Plant Room', floor: 'concrete',
    description: 'Under the drum, where the air handling that keeps the sales floor at one temperature all year actually lives. It is louder down here than the whole rest of the building is quiet.' },

  props: [
    { key: 'model', room: 'suite', name: 'the estate model', objectType: 'decoration', powerKw: 0.2,
      description: 'The quarter at one inch to twenty feet under a dust case. Every building that exists is on it and correct. Every building that does not exist is also on it, in the same material, at the same finish, with no line anywhere saying which is which — and the one on the corner of Kerbstone Row, which on the model is a concert terrace, is in fact a gasholder.' },
    { key: 'boards', room: 'suite', name: 'a rank of display boards', objectType: 'decoration',
      description: 'Six backlit panels of the quarter at dusk, photographed from angles that require standing in mid-air. In four of them the pavements are full. In the fifth the light is coming from the wrong side of the Basin, and once you have seen it you cannot stop seeing it.' },
    { key: 'schedule', room: 'booth', name: 'a schedule of plots', objectType: 'container',
      description: 'A printed list of every plot in Halcyon Fields with its price, and a pencil column beside it that is lower on every line. At the bottom, in the same pencil, a note that reads simply: AUTHORISED TO 12%.' },
  ],

  npc: {
    id: 'npc_hf_marchetti', name: 'Odile Marchetti', sex: 'female', hp: 32,
    homeRoom: 'booth', workRoom: 'suite', shopName: "Artist's Impression",
    description: 'A composed woman in her forties in a charcoal suit cut better than anything else in the quarter, standing at the model rather than at a desk. She holds a folder she does not open. When she talks about the estate she talks about it in the present tense, and it takes a while to notice that half of what she is describing is not there.',
    clothing: [
      'a charcoal suit, single-breasted, cut close and pressed that morning',
      'a pale blouse with the collar outside the jacket',
      'low heels kept for the carpet and changed at the door',
      'a chrome estate badge at the lapel, the size of a thumbnail',
      'plain underthings',
    ],
    inventory: [
      { item_id: 'item_hf_brochure', price: 0 },
      { item_id: 'item_hf_siteplan', price: 18 },
    ],
    chitchat: [
      'Marchetti walks the long way round the model, which takes her past the window, which is where the light is.',
      'She turns a display board a few degrees toward the door and steps back to check it.',
      'The fibre lighting inside the model flickers on one street. She notices, and does not look at it again.',
      'She writes something in the folder without opening it more than an inch.',
      'Somewhere under the floor the air handling changes note, and the room gets very slightly colder.',
    ],
    dialogue: {
      root: {
        text: '"Welcome to Halcyon Fields." She says it to the room as much as to you, then arrives at your elbow. "Take your time with the model. Everybody does."',
        text_by_relation: {
          first: 'The woman at the model looks up before the doors have finished closing behind you, and is beside you a moment later without seeming to have hurried.\n\n"Odile Marchetti. Welcome to Halcyon Fields." She gestures at the case with the folder. "That is the whole quarter. Take as long as you like — people always want to find where they are standing, and it is there."\n\nShe points to a low curved building on the model. It is this one. On the model, the meadow outside it is a boulevard with trees down the middle.',
          known: '"You came back." A small, real smile. "Nobody comes back twice to look at a model. What is it you actually want to know?"',
          familiar: 'She does not come over. She lifts the folder an inch in greeting and carries on with what she is doing, which after the fourth or fifth visit is the warmest thing she does.\n\n"Kettle to the row is still not made up," she says, without preamble. "I know. I have said."',
        },
        options: [
          { label: 'What is actually built?', next: 'built' },
          { label: 'What is for sale?', next: '__shop__' },
          { label: 'Who is buying?', next: 'buyers' },
          { label: 'The model is wrong on the corner.', next: 'corner' },
          { label: 'Another time.', next: 'bye' },
        ],
      },
      built: {
        text: '"Phase one is complete and occupied." She counts it off on the folder. "The boulevard frontage, the two towers at the west end, the halt. Phase two is structurally complete and awaiting fit-out, which is what you are looking at when you look at the ones with hoardings."\n\nA beat.\n\n"Phase three is the meadow."',
        options: [
          { label: 'When is phase three?', next: 'phase3' },
          { label: 'Back.', next: 'root' },
        ],
      },
      phase3: {
        text: '"When phase two is let." She does not soften it. "That is not evasion, it is the actual mechanism. Nothing goes up until the last thing that went up has a tenant, because that is the covenant the money came with."\n\n"So the honest answer is that the meadow depends on you, and on about four hundred other people, and I have said that to all of them."',
        options: [{ label: 'Back.', next: 'built' }],
      },
      buyers: {
        text: '"Two kinds." She holds up the folder. "People who want to live here, which is a smaller number than the boards suggest, and people who want to own a thing in a quarter the Spire is expanding into, which is nearly everybody else."\n\n"The second kind never see the flat. I post them a photograph of the door."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      corner: {
        text: 'She looks at the corner of the model for a moment longer than she needs to.\n\n"The concert terrace," she says. "Yes. That is a gasholder."\n\nShe does not explain it away and does not apologise for it either.\n\n"The model was built to the consented scheme. The scheme changed. Rebuilding the model costs more than a plot is worth, so it stands, and I tell anyone who spots it, and about one person in thirty spots it." A pause. "You are the first this month."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      bye: { text: '"The brochure is free and the site plan is not, which tells you which one is any use." She is already back at the model.', options: [] },
    },
  },

  items: [
    { id: 'item_hf_brochure', name: 'a Halcyon Fields brochure', type: 'media', value: 0, weight: 40, description: null, flags: {},
      tags: { stackable: true, description: 'Heavy paper, square format, and photographed entirely at dusk. Every image has people in it and none of them have faces. The plan on the last spread is drawn at no stated scale and the north arrow points up the page rather than north.' } },
    { id: 'item_hf_siteplan', name: 'a stamped site plan', type: 'media', value: 18, weight: 30, description: null, flags: {},
      tags: { stackable: true, description: 'A proper drawing rather than a picture: plot boundaries, levels, the service runs and the phasing, stamped and dated by somebody with a licence number. It is the only document in the building that distinguishes what is built from what is drawn, which is why it costs eighteen credits and the brochure costs nothing.' } },
  ],
});

// ── 2. Fixed Assets ──────────────────────────────────────────────────────────
// A gallery in the sense that a bonded warehouse is a wine cellar. The art is owned by people who
// have never seen it and is hung because hanging it is cheaper than insuring it in a crate.
SPECS.push({
  slug: 'hf_assets', name: 'Fixed Assets', type: 'lens_hall',
  x: 895, y: 913, entrance: 'south', floors: 4, marker: 'FA', district: HF,

  facade: {
    bgColor: '#0e1a22', color: '#cfeaff',
    description: 'A glazed disc on six chrome legs, thickest through the middle and drawn to an edge all round, with nothing underneath it but a paved circle and the light coming down out of the soffit. You go up into it through a chrome stair core on the street side. There is no name on the building anywhere: the only lettering is a plate beside the door at chest height, engraved, four words long.',
  },

  rooms: [
    { key: 'hang', name: 'The Hang', floor: 'stone',
      description: 'A single round room with the glass sloping away on every side and the floor a polished disc of pale stone. The walls are free-standing panels arranged in a loose spiral, and on them is a great deal of very good work hung four inches too close together. Each piece carries a card with a title, a date, and a six-digit reference number. None of the cards carry a name.',
      window: {
        name: 'the lens glazing',
        description: 'The whole perimeter, sloping out and then back in, so the view is of the quarter through about four feet of tinted glass. From in here the towers look shorter than they are.',
        light: 0.8, visibility: 0.85,
      } },
    { key: 'strong', name: 'The Strongroom', floor: 'metal', from: 'hang', dir: 'north',
      description: 'Racking, floor to ceiling, in the thick part of the lens where the glass is furthest away. Everything is in shallow slotted frames with the faces inward, spaced by a hand, at a temperature and a humidity the plant downstairs holds to a decimal place. There is more in here than on the walls outside by a factor of about nine.',
    },
  ],
  lights: {
    strong: { name: 'a rack of low-UV strips', description: 'Long, dim, colour-corrected tubes clipped to every gantry, at a level that would be miserable to read by and is exactly what the insurers specify. They come on rack by rack as you walk and go off behind you.', lumens: 240, type: 'strip' },
  },
  utility: { name: 'The Conditioning Plant', floor: 'metal',
    description: 'In the stair core under the floor of the lens: the chillers, the humidifiers and the monitoring that keeps the strongroom inside a band half a degree wide. There is a paper chart on the wall with a pen tracing it, which is a redundancy nobody has ever removed.' },

  props: [
    { key: 'panels', room: 'hang', name: 'the hanging panels', objectType: 'decoration',
      description: 'Free-standing walls in pale board on chrome feet, arranged in a spiral so that the room takes about four minutes to walk and you never see more than a third of it at once. The spacing is generous. The spacing of the work on them is not.' },
    { key: 'plate', room: 'hang', name: 'a brass ledger plate', objectType: 'decoration',
      description: 'Screwed to the centre column, engraved with the terms of the arrangement: works held on deposit, owners unnamed, admission free, nothing for sale. The last line reads THE COLLECTION IS NOT A COLLECTION and is, on a close reading, a tax position rather than a joke.' },
    { key: 'racks', room: 'strong', name: 'the slotted racking', objectType: 'container',
      description: 'Shallow steel frames on runners, each one numbered, each one holding a face turned inward. Pulling a frame out is silent and takes both hands. There are four hundred and eleven of them and the lights only ever come on over the one you are at.' },
  ],
});

// ── 3. Quiet Enjoyment ───────────────────────────────────────────────────────
// Serviced apartments — the covenant term is the joke, and it is also a promise the building
// cannot keep, because the crane on the plot behind it starts at six.
SPECS.push({
  slug: 'hf_quiet', name: 'Quiet Enjoyment', type: 'bead_tower',
  x: 892, y: 913, entrance: 'east', floors: 14, marker: 'QE', district: HF,

  facade: {
    bgColor: '#10161f', color: '#b6dcf7',
    description: 'A chrome spine with six glazed bulges threaded on it, each one pinched to a collar between, so the tower reads from the mews as a stack of rooms rather than as a stack of floors. The doors are at the foot of the spine under a shallow chrome hood. A small board beside them lists fourteen floors, a concierge, and a telephone number for out of hours, and somebody has stuck a printed notice over the bottom third of it about the lift.',
  },

  rooms: [
    { key: 'desk', name: 'The Concierge Desk', floor: 'stone',
      description: 'A round lobby in the thick of the first bulge, with the spine coming up through the middle of it and the desk built round the spine. Six chairs nobody uses, a rack of post going soft at the edges, and a board of fourteen numbered hooks with eleven keys on it. The floor is very good stone, laid by somebody good, and there is a chip out of it by the lift doors the size of a fist.',
      window: {
        name: 'the bulge glazing',
        description: 'Curved glass all round at head height, looking out at the mews on one side and, on the other, the hoarding of the plot behind. The glass is good enough that you can hear the crane rather than the traffic.',
        light: 0.7, visibility: 0.8,
      } },
    { key: 'show', name: 'The Show Apartment', floor: 'boards', from: 'desk', dir: 'up',
      description: 'Two floors up, at the fat part of a bead, and furnished to within an inch of its life: everything matched, everything new, a bowl of fruit that is not fruit. The curved glass makes the room a wedge, which the furniture has been arranged to disguise and does not. On the counter, a folded card thanks you for viewing and asks you not to use the taps.',
      window: {
        name: 'the curved glazing',
        description: 'The whole outer wall, floor to ceiling, bowing out and back. Fourteen storeys of Halcyon Fields below and the Curtain a field away, humming, close enough to see the rain not reaching the ground on the far side of it.',
        light: 0.9, visibility: 0.95,
      } },
  ],
  lights: {
    show: { name: 'a run of concealed cove lighting', description: 'Hidden in the shadow gap where the ceiling meets the curve, throwing light up and back so the room has no visible fitting in it anywhere. It is on a timer and the timer is set for showing rather than for living.', lumens: 780, type: 'cove' },
  },
  utility: { name: 'The Riser Base', floor: 'concrete',
    description: 'The bottom of the spine, where every service in the building arrives and is labelled. Somebody has written the date beside four of the labels and a question mark beside a fifth.' },

  props: [
    { key: 'hooks', room: 'desk', name: 'the key board', objectType: 'container',
      description: 'Fourteen numbered hooks behind the desk. Eleven of them have keys on. That is not eleven empty flats: three of the eleven are let to people who have never collected a key, and the concierge knows which three and does not say.' },
    { key: 'post', room: 'desk', name: 'a rack of uncollected post', objectType: 'container',
      description: 'Pigeonholes by flat number, and most of the paper in them has gone soft at the exposed edge from the light off the glazing. The oldest item in the rack has been there long enough that the address it was sent from no longer exists.' },
    { key: 'notice', room: 'desk', name: 'a printed notice about the lift', objectType: 'decoration',
      description: 'Laminated, taped over the lower third of the building board, apologising for the lift and giving a date by which it will be resolved. The date has passed. Under the lamination somebody has slid a second, handwritten slip that reads: AND AGAIN.' },
    { key: 'card', room: 'show', name: 'a folded viewing card', objectType: 'decoration',
      description: 'Thick cream card, printed, standing on the counter. It thanks you for viewing, gives a telephone number, and asks that you do not use the taps. The water is connected. The reason for the card is that the drains on this riser are not.' },
  ],

  npc: {
    id: 'npc_hf_ostrow', name: 'Berenike Ostrow', sex: 'female', hp: 30,
    homeRoom: 'desk', workRoom: 'desk', shopName: 'Quiet Enjoyment',
    description: 'A short, unhurried woman of about sixty behind the desk, in a grey uniform jacket with the building crest on the pocket and her own cardigan over the back of the chair. She has the manner of somebody who was hired to be decorative and has quietly become the only person in the building who knows how anything works.',
    clothing: [
      'a grey concierge jacket with the building crest embroidered at the pocket',
      'a plain skirt and thick tights, because the lobby glazing is cold at the ankles',
      'her own cardigan, navy, not part of the uniform and never remarked on',
      'flat shoes with the heels worn on the outside edge',
      'plain underthings',
    ],
    inventory: [
      { item_id: 'item_hf_lobbycoffee', price: 6 },
      { item_id: 'item_hf_earplugs', price: 9 },
    ],
    schedule: SHOP_HOURS,
    chitchat: [
      'Ostrow turns a letter over, looks at the postmark, and puts it back in the same hole.',
      'She glances at the lift indicator. It has said 7 for some time.',
      'The crane on the plot behind takes a load up, and the whole lobby hums for about four seconds.',
      'She writes a time in a ruled book without appearing to check a clock.',
      'A key on the board swings very slightly, and she reaches over and stills it.',
    ],
    dialogue: {
      root: {
        text: '"Afternoon." She does not get up. "If you are viewing, the show flat is two up and the stair is quicker than the lift. If you are delivering, leave it on the end of the desk."',
        text_by_relation: {
          first: 'The woman behind the desk finishes writing a time in a book before she looks up, which somehow does not read as rude.\n\n"Quiet Enjoyment. Fourteen floors, eleven let, concierge till eight." A short pause. "That is the whole of the sales talk and I am not paid for the sales talk, so."\n\nShe nods at the stair.\n\n"Show flat is two up. Take the stair. I will explain the lift if you want the lift explained."',
          known: '"Back again." She pushes the visitors\' book an inch toward you, which is as close as she comes to a greeting.',
          familiar: 'She has the stair door on the latch before you are across the lobby.\n\n"Lift is still the lift," she says. "Tea is in the pot and the pot is mine, but there is a cup."',
        },
        options: [
          { label: 'What is wrong with the lift?', next: 'lift' },
          { label: 'Anything for sale?', next: '__shop__' },
          { label: 'Eleven of fourteen?', next: 'let' },
          { label: 'Is it quiet?', next: 'quiet' },
          { label: 'Nothing, thanks.', next: 'bye' },
        ],
      },
      lift: {
        text: '"Nothing is wrong with the lift." She says it with the flatness of the eleventh telling. "The lift is a very good lift. What is wrong is that it is one lift for fourteen floors because a second one came out of the scheme at the costing stage, and when it is serviced there is no lift at all."\n\n"It is being serviced. It has been being serviced since a week last Tuesday."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      let: {
        text: '"Eleven let." A pause exactly long enough to be a correction. "Four lived in."\n\n"The rest are owned by people who have never been up the stair. I take their post, I run their taps once a month so the traps do not dry out, and I have never met one of them. That is not a complaint. It is a quieter building than the ones with people in."',
        options: [
          { label: 'Doesn\'t that bother you?', next: 'bother' },
          { label: 'Back.', next: 'root' },
        ],
      },
      bother: {
        text: '"It bothers the four." She tips her head at the ceiling. "A building with four people in it is not a building, it is four people each on their own in a very expensive tube. They have started leaving their doors open when they are in. All four of them, without discussing it."\n\n"I think that is the saddest thing I have ever watched happen and I would not dream of mentioning it to them."',
        options: [{ label: 'Back.', next: 'let' }],
      },
      quiet: {
        text: 'She lets that one sit for a second.\n\n"It is called Quiet Enjoyment because that is a thing written into the lease. It means nobody may interfere with your use of the flat." A very small movement of the mouth. "It does not mean quiet."\n\n"The crane behind starts at six. Not six-thirty. Six. I have the notice about it in a drawer and I am not putting it up, because the ones who are here already know and the ones who are not here are not here."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      bye: { text: '"Mind the chip by the lift. Everybody finds it with their foot." She goes back to the book.', options: [] },
    },
  },

  items: [
    { id: 'item_hf_lobbycoffee', name: 'a cup of lobby coffee', type: 'drink', value: 6, weight: 120, description: null, flags: {},
      tags: { stackable: false, description: 'Out of a machine that cost more than the chairs, into a cup with the building crest on it. It is genuinely good, which surprises everybody, because the machine is on the service contract and the service contract was written by the same people who took out the second lift.' } },
    { id: 'item_hf_earplugs', name: 'a pair of wax earplugs', type: 'misc', value: 9, weight: 4, description: null, flags: {},
      tags: { stackable: true, description: 'In a little chrome tin with the building crest on the lid, which is not a thing a concierge is supposed to sell and is the single most useful object in the building. She buys them herself and sells them at cost.' } },
  ],
});

// ── 4. Air Rights ────────────────────────────────────────────────────────────
// The landmark: two legs, a span, and a room in the top of it. It is the only building in
// Coldwater with a hole through it at ground level that is not a gate.
SPECS.push({
  slug: 'hf_airrights', name: 'Air Rights', type: 'chrome_arch',
  x: 906, y: 915, entrance: 'south', floors: 9, marker: 'AH', district: HF,

  facade: {
    bgColor: '#0f1922', color: '#c6e8ff',
    description: 'Two chrome legs that lean in and meet, with a glazed room slung across the top of them and nothing underneath but the road. The legs are hollow and one of them has a lift in it; the other has a stair nobody is encouraged to use. Standing under it you can hear the whole thing move — not sway, exactly, but change note, the way a bridge does. There is no sign. Everyone calls it the Arch.',
  },

  rooms: [
    { key: 'foot', name: 'The West Foot', floor: 'stone',
      description: 'A round chamber in the base of the leg, barely wider than the lift, with the curve of the outside wall coming in overhead. There is a bench, a fire notice, and a plate listing the engineers and the year. Above the lift door a dial the size of a dinner plate shows the car\'s position on a scale marked in metres rather than floors, which is the first clue that this is not really a building.',
      window: {
        name: 'the slot',
        description: 'A vertical slit of glass a hand wide running the height of the chamber, giving you a sliver of Kerbstone Row and about four feet of sky.',
        light: 0.4, visibility: 0.5,
      } },
    { key: 'key', name: 'The Key', floor: 'metal', from: 'foot', dir: 'up',
      description: 'The room in the top of the arch: a glazed box thirty feet long with the floor of it a single sheet of something you can see straight down through, out over the road, out over the quarter, and on a clear day out to where the Basin stops being water. It is free to come up and there is nothing to buy. Two benches face outward. Nobody sits on them; everyone stands at the glass with their hands behind their back.',
      window: {
        name: 'the span glazing',
        description: 'Three sides and the floor. The Curtain runs west to east across the bottom of the view, the city stacks up to the north, and the whole of Halcyon Fields lies underneath you looking, from here, considerably emptier than it does from the street.',
        light: 1.0, visibility: 1.0,
      } },
  ],
  lights: {
    key: { name: 'a run of floor-edge lighting', description: 'Set into the junction of the glass floor and the glass wall, throwing light outward and down rather than into the room, so that after dark the Key is visible from the whole quarter and there is nothing in it reflecting off the inside of the glass.', lumens: 540, type: 'cove' },
  },
  utility: { name: 'The Leg Base', floor: 'metal',
    description: 'Below the lift pit at the bottom of the west leg: the winding gear, the counterweight track, and the load cells that somebody reads once a week. On the wall, a chart of how much the arch is allowed to move and how much it actually does. The two lines have never crossed.' },

  props: [
    { key: 'dial', room: 'foot', name: 'the position dial', objectType: 'fixture', powerKw: 0.05,
      description: 'A chrome dial the size of a dinner plate over the lift door, marked from 0 to 54 in metres. It is the first thing that tells you this was designed by people who think in structures rather than in storeys, and the second thing is that there is no button for a floor, only UP.' },
    { key: 'plate', room: 'foot', name: 'an engineer\'s plate', objectType: 'decoration',
      description: 'Cast, bolted at chest height, listing the design engineer, the contractor and the year. Under the year, a line that is not on any other building in the city: RIGHTS IN THE AIR ABOVE THIS ROAD ARE HELD IN PERPETUITY. The name of the holder has been left off, and there is a bolt hole where it would have gone.' },
    { key: 'benches', room: 'key', name: 'two benches', objectType: 'furniture',
      description: 'Chrome, facing outward, one at each end of the span. They are the right height and the right rake and nobody sits on them. People come up, walk to the glass, and stand.' },
  ],
});

// ── 5. Safe as Houses ────────────────────────────────────────────────────────
// A deposit house rather than a bank: nothing here lends, nothing here pays interest, and
// nothing here is insured. You rent a box and you are the only one with a key.
SPECS.push({
  slug: 'hf_safe', name: 'Safe as Houses', type: 'torque_tower',
  x: 901, y: 911, entrance: 'east', floors: 16, marker: 'HB', district: HF,
  // ⚠ The sub-basement goes under the BOX CORRIDOR, not under the hall, because the corridor is
  // already `down` from the hall and a zone has one exit per direction. `authorUtilityRoom` writes
  // last and would win silently, leaving the corridor one-way into a hall that no longer points
  // at it. The guard in lib.mjs refuses that rather than resolving it — which is how this line
  // came to exist rather than being discovered as a broken stair.
  utilityAnchor: 'corridor',

  facade: {
    bgColor: '#0e151d', color: '#b0d6f0',
    description: 'A tower that shears as it rises — each floor turned a few degrees on the one below, so the corner you are looking at walks round the building as you drive past it and the whole thing looks slightly wrung out. The entrance is a chrome drum canopy on the lane side with one door in it, and the door is thicker than a door needs to be. The name is cut into the canopy fascia, small, in letters about four inches high.',
  },

  rooms: [
    { key: 'hall', name: 'The Hall', floor: 'stone',
      description: 'A low, wide room at the foot of the tower with a stone floor and no chairs at all, which is deliberate: nobody is meant to wait here. A single counter runs across the far end in one piece of chrome with a gap in it you walk through. Behind the gap the floor changes to steel and the ceiling drops, and that is where the building stops being a lobby.',
      window: {
        name: 'the canopy glazing',
        description: 'A band of glass round the drum at eye height, so from the counter you can see the ankles of everyone on Cinder Lane and nothing above the knee.',
        light: 0.55, visibility: 0.4,
      } },
    { key: 'corridor', name: 'The Box Corridor', floor: 'metal', from: 'hall', dir: 'down',
      description: 'Below the hall, and the only straight line in the building: a corridor the whole depth of the plot with boxes floor to ceiling on both sides, all of them the same chrome, all of them numbered, none of them labelled. Every twelve feet there is a shelf that folds down out of the wall and a light over it. There are no cameras in here and a sign at the door says so.',
    },
  ],
  lights: {
    corridor: { name: 'a chain of shelf lamps', description: 'One over each fold-down shelf, wired so that only the nearest three are ever lit and the rest of the corridor stays dark in both directions. You can never see the far end of it and there is not actually anything at the far end of it.', lumens: 300, type: 'task' },
  },
  utility: { name: 'The Sub-Basement', floor: 'concrete',
    description: 'Under the box corridor: the power, the door gear, and the pumps that keep the water table where it belongs. The one thing in the building that does not have a key on it is the door down here, which somebody noticed once and nobody has done anything about.' },

  props: [
    { key: 'counter', room: 'hall', name: 'the chrome counter', objectType: 'furniture',
      description: 'One continuous piece of brushed chrome the width of the room with a walk-through gap in the middle of it. There is no glass, no grille and no till. What there is, set into the top at the gap, is a brass plate worn concave by a great many hands resting in the same spot while somebody checked something.' },
    { key: 'terms', room: 'hall', name: 'a card of terms', objectType: 'decoration',
      description: 'Engraved rather than printed, screwed to the wall beside the gap. Four clauses. The first says the house holds no second key. The third says the house does not know, and will not ask, what is in a box. The fourth says that in the event of a default the box is drilled in the presence of two witnesses and its contents destroyed unexamined. There is no clause about insurance because there is no insurance.' },
    { key: 'boxes', room: 'corridor', name: 'the deposit boxes', objectType: 'container',
      description: 'Chrome fronts floor to ceiling, numbered in a sequence that does not start at one. Roughly a third of them have the thin film of dust that says nobody has opened them this year; a dozen are polished bright round the keyhole. You can tell a great deal about this quarter by which numbers are which.' },
  ],
});

// ── 6. Fit for Purpose ───────────────────────────────────────────────────────
// The health club, on the terraces. The pool is on the top one and is the only outdoor water in
// Coldwater anybody swims in on purpose.
SPECS.push({
  slug: 'hf_fit', name: 'Fit for Purpose', type: 'cascade_block',
  x: 897, y: 913, entrance: 'south', floors: 7, marker: 'FC', district: HF,

  facade: {
    bgColor: '#101a20', color: '#bfe4d8',
    description: 'Four masses of falling height, each one a step further forward than the one behind, so the building comes down to the pavement in stages instead of standing on it. Every terrace is planted and lit from underneath, and the top one has water on it — you can see the light off the pool moving on the soffit of the terrace above from the far end of Sorrel Way. The entrance is a chrome drum at the foot with a towel rail bolted beside it, which nobody has ever used for a towel.',
  },

  rooms: [
    { key: 'floor', name: 'The Floor', floor: 'linoleum',
      description: 'A long room under the first terrace with the machines in ranks facing the glass, all of them the same make, all of them new enough that the rubber still smells. Two thirds of them have never been used. The glass looks out at Vetch Green, which means the view from every machine is of six birches and a bin, and that is genuinely the best view from a gym in this city.',
      window: {
        name: 'the terrace glazing',
        description: 'Floor to ceiling the length of the room, with the underside of the terrace above cutting the sky off at the top of the frame. Vetch Green fills the whole of it.',
        light: 0.75, visibility: 0.8,
      } },
    { key: 'pool', name: 'The Top Terrace', floor: 'tile',
      from: 'floor', dir: 'up',
      description: 'The highest of the four steps, open to the sky, with a pool along the outer edge of it that finishes in a lip you can see over the side of. The water is heated and the air is not, so on a cold morning the whole terrace is inside a cloud of its own making and you can hear the Curtain but cannot see it. Six loungers. Planting on three sides. Nobody up here but you, most of the time.',
      window: {
        name: 'the open edge',
        description: 'No glass at all — a lip, a rail, and the whole of Halcyon Fields from seven storeys, with the Spire away to the north and the wall shut across the south.',
        light: 1.0, visibility: 1.0,
      } },
  ],
  lights: {
    pool: { name: 'underwater lighting', description: 'Set into the pool wall below the line, throwing light up through the water so that after dark the terrace is lit entirely from the pool and everything on it has moving light on its underside. It is the best-looking thing in the quarter and it was, on the drawings, value-engineered out twice.', lumens: 460, type: 'submerged' },
  },
  utility: { name: 'The Pool Plant', floor: 'tile',
    description: 'Filtration, dosing and the heat exchanger, in a room that is warm and smells of chlorine and is, at four in the morning, the single most comfortable place in Halcyon Fields.' },

  props: [
    { key: 'machines', room: 'floor', name: 'ranks of machines', objectType: 'furniture', powerKw: 0.4,
      description: 'Identical, chrome, numbered, facing the glass. Every one has a card in a holder on the frame for logging your sets, and every card is blank except for the three nearest the door, which are full.' },
    { key: 'board', room: 'floor', name: 'a members\' board', objectType: 'decoration',
      description: 'A chrome frame with slots for a hundred and twenty name cards. There are nineteen cards in it. Four of them are in the same handwriting, which is the manager filling in the corners so the board does not look like what it is.' },
    { key: 'loungers', room: 'pool', name: 'six loungers', objectType: 'furniture',
      description: 'Teak and chrome, set out in a fan facing the lip, and moved back into the fan every evening whatever anybody did with them. The one on the end has a book left face-down on it that has been there long enough for the sun to have taken the colour off the cover.' },
  ],
});

// ── 7. Overlooked ────────────────────────────────────────────────────────────
// A viewing spire, built as an amenity and named by whoever names things in this quarter, who has
// either a very dry sense of humour or none at all.
SPECS.push({
  slug: 'hf_overlooked', name: 'Overlooked', type: 'glass_prism',
  x: 903, y: 911, entrance: 'west', floors: 18, marker: 'OV', district: HF,

  facade: {
    bgColor: '#0d151e', color: '#cae4ff',
    description: 'Six sides of tinted glass drawn out to an actual point, with a chrome fin up each corner and nothing on top at all — no plant, no mast, no deck. It is the only tall thing in Coldwater that ends rather than stopping. From the lane it reads as a crystal somebody has pushed into the meadow; from four streets away, at dusk, it reads as the one thing on the skyline that has been designed all the way to the end.',
  },

  rooms: [
    { key: 'lobby', name: 'The Lobby', floor: 'stone',
      description: 'A six-sided room at the foot, narrowing overhead, with the lift in the middle of it and a turnstile that has been chocked open with a folded card since the day it was installed. The walls carry six panels, one to a side, about the view: what you can see from the top, at what bearing, in what weather. The last panel is about the Curtain and has been rewritten at least twice.',
      window: {
        name: 'the base glazing',
        description: 'Six tall lights, one to a face, each one looking down a different line of the quarter. From in here you can see Cinder Lane, Cowslip Rise and about half of Kerbstone Row without moving.',
        light: 0.7, visibility: 0.75,
      } },
    { key: 'lookout', name: 'The Lookout', floor: 'metal', from: 'lobby', dir: 'up',
      description: 'The top of the shaft, where the six faces have come in far enough that the room is barely wider than the lift and the point is another two storeys above your head with nothing in it. The glass leans inward on every side, so you stand with your forehead nearly on it and the ground directly below you, which is a thing very few buildings let you do. There is a rail. Nobody uses the rail.',
      window: {
        name: 'the leaning glass',
        description: 'Six inward-sloping faces, so the view is straight down as much as out: the whole quarter, the Basin beyond it, and the Curtain running away east and west with the light going up it.',
        light: 1.0, visibility: 1.0,
      } },
    // ⚠ UP, NOT DOWN, AND THAT IS A CORRECTNESS FIX RATHER THAN A CHANGE OF MIND. A zone has one
    // exit per direction, and the Lookout's `down` is already its way back to the lobby — so a
    // ring hung below it overwrites that link and strands anybody who goes up the tower. It is
    // the same collision `utilityAnchor` exists to refuse, one floor further in, and the only
    // thing that caught it was `content:lint` reporting an exit geometry projects and the zone
    // no longer declares. The winding gear belongs over the lift head anyway.
    { key: 'ring', name: 'The Machine Ring', floor: 'metal', from: 'lookout', dir: 'up',
      description: 'A narrow ring around the lift head one level above the lookout floor, reached by a ladder through a hatch that is not locked and is not meant to be found. Winding gear, a window-cleaning cradle on its rails, and a door out onto the outside of the glass with a warning on it and a handle. Somebody has been eating up here.',
    },
  ],
  lights: {
    lookout: { name: 'a ring of floor uplights', description: 'Set into the floor at the foot of the glass all the way round, aimed up the inside of each face so the whole point of the building glows from within after dark and the room itself stays almost unlit.', lumens: 380, type: 'uplight' },
    ring: { name: 'a caged bulkhead lamp', description: 'One lamp in a wire cage over the hatch, on a switch with no plate on it, throwing a hard shadow of the cradle rails across the floor.', lumens: 180, type: 'bulkhead' },
  },
  utility: { name: 'The Lift Pit', floor: 'concrete',
    description: 'At the bottom of the shaft, under the lobby floor: buffers, the pit ladder, and a surprising amount of water for a building with no plumbing in it.' },

  props: [
    { key: 'panels', room: 'lobby', name: 'six interpretation panels', objectType: 'decoration',
      description: 'One to each face, printed on backlit glass, naming what you can see on that bearing. Five of them are about the city. The sixth is about the Curtain, and it has plainly been written three times: you can see the ghost of the previous text where the backing has faded unevenly behind it.' },
    { key: 'turnstile', room: 'lobby', name: 'a chocked turnstile', objectType: 'fixture',
      description: 'Chrome, waist height, with a card slot and a fare plate reading 4 CREDITS. It has been chocked open since the week it went in with a folded brochure, and the brochure has gone the colour of weak tea. Nobody has ever collected four credits in this building.' },
    { key: 'cradle', room: 'ring', name: 'a cleaning cradle', objectType: 'fixture',
      description: 'A two-man cradle on rails that run right round the ring, with its harness points, its winch and a tin under the seat holding a flask, a sandwich box and a paperback. Whoever cleans the outside of this building takes their lunch four hundred feet up on the wrong side of the glass.' },
  ],
});

// ── 8. Ground Rent ───────────────────────────────────────────────────────────
// The estate office. Where you pay the service charge, and where you go to be told that the thing
// you are complaining about is not covered by the service charge.
SPECS.push({
  slug: 'hf_groundrent', name: 'Ground Rent', type: 'atrium_court',
  x: 901, y: 915, entrance: 'east', floors: 3, marker: 'GR', district: HF,

  facade: {
    bgColor: '#101820', color: '#b8dcf0',
    description: 'Two short curved wings round a glazed drum, low and wide and considerably less grand than anything it manages. The name is on the drum in chrome letters, and under it, in a smaller and much newer typeface, HALCYON FIELDS ESTATE MANAGEMENT LTD — which is a different company from the one on the hoardings, as several people have noticed and none have been able to do anything about.',
  },

  rooms: [
    { key: 'counter', name: 'The Counter', floor: 'linoleum',
      description: 'A public room in the drum with a chest-high chrome counter across it and four chairs against the wall which, unlike the ones at the sales suite, are all in use. On the counter: a bell, a pad of complaint forms, and a laminated card of what the service charge covers. The card is one side. The list of what it does not cover is not printed anywhere and is delivered verbally, at the counter, by somebody who has it by heart.',
      window: {
        name: 'the drum glazing',
        description: 'Curved glass onto Cinder Lane and Kerbstone Row. The one thing everybody at the counter does while they wait is look out of it at the estate they are complaining about.',
        light: 0.8, visibility: 0.85,
      } },
    { key: 'back', name: 'The Back Office', floor: 'carpet', from: 'counter', dir: 'north',
      description: 'Behind the counter in the west wing: four desks, a wall of lever-arch files by plot number, and a plan of the quarter pinned up with coloured tacks in it. Green for let, red for in dispute, and a third colour nobody has written a key for that is used on eleven plots and is, if you look at which eleven, the ones with cranes still on them.',
    },
  ],
  lights: {
    back: { name: 'a bank of ceiling panels', description: 'Flat white panels in a grid, all of them on, at an intensity that makes the room feel like the middle of the afternoon at any hour. Two of them flicker on a cycle of about eleven seconds and have done since the fit-out.', lumens: 900, type: 'panel' },
  },
  utility: { name: 'The Records Basement', floor: 'concrete',
    description: 'Under the back office: shelving, boxes by year, and the original contract documents for the whole estate in the far corner under a dust sheet. It is the only room in Halcyon Fields where a complete and honest account of the place exists, and nobody has been down here in fourteen months.' },

  props: [
    { key: 'card', room: 'counter', name: 'a laminated charges card', objectType: 'decoration',
      description: 'One side of A4 under plastic, screwed to the counter so it cannot be taken away. It lists what the service charge covers in eleven lines. Cleaning of common parts, lighting of common parts, grounds maintenance, lift maintenance. Every line has the word COMMON in it somewhere, and that word is doing a very great deal of work.' },
    { key: 'forms', room: 'counter', name: 'a pad of complaint forms', objectType: 'container',
      description: 'Triplicate, numbered, with a carbon between each copy. The top copy is for the office, the second for the managing agent and the third for you. In practice the pad is always on about 40 and the box file behind the counter is always on about 6, and nobody at the counter has ever been able to account for the difference.' },
    { key: 'plan', room: 'back', name: 'a tacked estate plan', objectType: 'decoration',
      description: 'The quarter at a workable scale with coloured tacks in it. Green for let, red for in dispute, and a third colour — a sort of dull amber — on eleven plots, with no key anywhere. The eleven are the plots with cranes still standing on them, which anybody looking out of the window could work out in about four seconds.' },
  ],

  npc: {
    id: 'npc_hf_pardoe', name: 'Ellery Pardoe', sex: 'male', hp: 34,
    homeRoom: 'back', workRoom: 'counter', shopName: 'Ground Rent',
    description: 'A heavyset man in his fifties at the counter in a shirt and tie with the tie loosened exactly one inch, no more. He has the specific patience of somebody who has explained the same distinction four thousand times and has never once let it show. When he says he is sorry he means it, and when he says there is nothing he can do he means that too.',
    clothing: [
      'a white shirt, ironed, with the cuffs turned back one fold each',
      'a dark tie loosened by exactly one inch',
      'grey trousers and a belt on the fourth hole',
      'shoes polished on the toe and not on the sides',
      'a plain vest and shorts',
    ],
    inventory: [
      { item_id: 'item_hf_chargecopy', price: 4 },
      { item_id: 'item_hf_planprint', price: 25 },
    ],
    chitchat: [
      'Pardoe writes a reference number on a form, tears off the top copy, and files the other two without looking.',
      'He glances at the ceiling panel that flickers, which he does about once an hour and has never mentioned to anyone.',
      'Somebody at the counter starts a sentence with "I appreciate it is not your fault, but" and he nods before they finish it.',
      'He straightens the laminated card, which is screwed down and does not move.',
      'He drinks about a third of a cup of tea and puts it down out of reach of the counter edge.',
    ],
    dialogue: {
      root: {
        text: '"Afternoon." He takes his hand off the pad. "If it is the charge, I can tell you what it covers. If it is a repair, I will need the plot number."',
        text_by_relation: {
          first: 'The man at the counter finishes a form, squares it, and gives you the whole of his attention, which after the first second is slightly unnerving.\n\n"Ellery Pardoe, estate office." He turns the laminated card a few degrees toward you. "That is what the charge covers. Anything not on that is not covered, and I would rather say so now than at the end."\n\nHe says it without a shred of defensiveness. It is not his list.',
          known: '"Back." He reaches for the pad before you have said anything, then stops himself. "Sorry. Habit. Go on."',
          familiar: 'He has the pad out and a reference number already written on the top sheet.\n\n"Go on then," he says. "And before you ask, yes, I did put it up the line, and no, they have not come back."',
        },
        options: [
          { label: 'What does the charge actually cover?', next: 'covers' },
          { label: 'Can I have a copy of anything?', next: '__shop__' },
          { label: 'Who is Estate Management Ltd?', next: 'company' },
          { label: 'The amber tacks on your plan.', next: 'amber' },
          { label: 'Nothing today.', next: 'bye' },
        ],
      },
      covers: {
        text: '"Common parts." He taps the card. "Every line on there has the word in it. Cleaning of common parts, lighting of common parts, maintenance of common parts."\n\n"What that means in practice is that if a thing is inside your front door it is yours, and if it is outside your front door it is common, and if it is the front door itself we have had four separate opinions on that and none of them in writing."',
        options: [
          { label: 'That sounds like most of it isn\'t covered.', next: 'covers2' },
          { label: 'Back.', next: 'root' },
        ],
      },
      covers2: {
        text: '"Most of it is covered." A pause. "Most of what goes WRONG is not, because what goes wrong in a new building is the fit-out and the fit-out is inside your door."\n\nHe does not enjoy this part and does not hide that either.\n\n"I have written it up three times. The answer that came back was that the schedule was agreed at purchase and the purchasers had the benefit of advice. Which they did. It was our advice."',
        options: [{ label: 'Back.', next: 'covers' }],
      },
      company: {
        text: '"A different company from the one on the hoardings, yes." He says it as though confirming the weather. "Same building, same money, different registration. There is a reason and the reason is the reason you think it is."\n\n"If a claim ever lands, it lands on this one, and this one is me, four desks and a basement."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      amber: {
        text: 'He looks at the plan through the doorway for a second, then back at you.\n\n"Green is let. Red is in dispute." He leaves a gap. "Amber is not a status. Amber is a note to me."\n\n"Every one of those has a crane on it and a completion date that has moved twice. I mark them so I know which ones to ring about before somebody at this counter asks me a question I cannot answer." He straightens the pad. "It has stopped working. There are eleven of them now."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      bye: { text: '"Right you are." The pad comes back under his hand.', options: [] },
    },
  },

  items: [
    { id: 'item_hf_chargecopy', name: 'a copy of the charge schedule', type: 'media', value: 4, weight: 20, description: null, flags: {},
      tags: { stackable: true, description: 'A photocopy of the laminated card, four credits, which is what it costs the office to make. It is one side. On the back, in Pardoe\'s handwriting, is a list of six things people most often assume are on the front and are not.' } },
    { id: 'item_hf_planprint', name: 'a print of the estate plan', type: 'media', value: 25, weight: 35, description: null, flags: {},
      tags: { stackable: true, description: 'The quarter at a workable scale, plot boundaries and numbers, run off the office machine. It shows every plot including the ones that are still meadow, which makes it the only drawing available to the public that does not lie about how much of Halcyon Fields exists.' } },
  ],
});

// ── 9. Sitting Tenant ────────────────────────────────────────────────────────
// The bar. There is exactly one in the quarter, it is in a unit that was marketed as offices, and
// the licence it trades on is somebody's residential lease read very carefully.
SPECS.push({
  slug: 'hf_sitting', name: 'Sitting Tenant', type: 'chrome_slab',
  x: 900, y: 915, entrance: 'west', floors: 5, marker: 'IA', district: HF,

  facade: {
    bgColor: '#121620', color: '#c4d8e8',
    description: 'A crescent of chrome and glass that bends along the lane, with drums at the joints and a coping band running the whole curve. Four of its five floors are dark and empty and the ground one is not: warm light, a lot of it, and the only door in Halcyon Fields with anybody standing outside it. The unit number is still on the glass in vinyl — UNIT 2 — and somebody has stuck a hand-cut chrome letter S in front of it so it reads SUNIT 2, which is a joke that has outlived its author.',
  },

  rooms: [
    { key: 'bar', name: 'The Bar', floor: 'boards',
      description: 'A long curved room following the bend of the building, boarded out in something warm over a floor that was laid for desks, with a bar down the inside of the curve made of scaffold board and chrome offcuts. Nothing matches. The chairs came from four fit-outs. On the wall behind the optics, framed, is a lease with a clause highlighted in yellow, and that clause is why this room is allowed to exist.',
      window: {
        name: 'the curved glazing',
        description: 'The whole outside of the bend, floor to ceiling, looking up Kettle Lane. At night the room is the brightest thing on the street and everyone walking past looks in, which the regulars have long since stopped noticing.',
        light: 0.6, visibility: 0.9,
      } },
    { key: 'back', name: 'The Back Room', floor: 'concrete', from: 'bar', dir: 'north',
      description: 'The part of the unit that was never fitted out, kept as it came: bare screed, a services spine down the ceiling with nothing hanging off it, and the outline of where a partition was going to go still chalked on the floor. There are crates in it, a chest freezer, and four chairs in a circle in the middle of the chalk outline, which is where the lock-in happens.',
    },
  ],
  lights: {
    back: { name: 'a festoon on a hook', description: 'A string of lamps looped over a services hook and left where it landed, which lights the circle of chairs and about two feet either side and nothing else. It is the only lighting in the room and there is no switch — you unplug it.', lumens: 220, type: 'festoon' },
  },
  utility: { name: 'The Cellar', floor: 'concrete',
    description: 'Down a ladder rather than a stair, because the stair was in phase two of a fit-out that stopped. Barrels, a cooler, and a run of line that goes up through a hole somebody drilled in a floor slab they were definitely not allowed to drill.' },

  props: [
    { key: 'lease', room: 'bar', name: 'a framed lease', objectType: 'decoration',
      description: 'The lease for Unit 2, framed behind the optics, with one clause picked out in yellow highlighter. The clause permits the tenant to provide refreshment to invited guests on the demised premises. It does not define invited, it does not define guests, and it does not cap the number of either. Somebody drew it badly, once, in a hurry, and this room is the result.' },
    { key: 'bar', room: 'bar', name: 'the scaffold bar', objectType: 'furniture',
      description: 'Board and chrome offcuts, all of it from skips on this estate, all of it better material than a bar would normally be built from. The top has been oiled about nine times. Under the overhang, out of sight, somebody has written the date of the first night in marker and the names of the eleven people who were here.' },
    { key: 'chairs', room: 'back', name: 'four chairs in a circle', objectType: 'furniture',
      description: 'Set out in the middle of a chalk outline of a partition that was never built, facing inward. They are not put away at the end of the night and they are not moved during the day. The arrangement is treated by everybody in the building as a fixture.' },
  ],
});

// ── 10. Grounds for Concern ──────────────────────────────────────────────────
// The café on the green. Two floors, both of them glass, and the only place in the quarter you can
// sit down without buying a flat.
SPECS.push({
  slug: 'hf_grounds', name: 'Grounds for Concern', type: 'atrium_court',
  x: 896, y: 913, entrance: 'south', floors: 2, marker: 'GB', district: HF,

  facade: {
    bgColor: '#121a1c', color: '#c8e4d4',
    description: 'A low glass drum between two short curved wings, set back off Sorrel Way behind four tables that are outside whatever the weather is doing. The lantern on top is lit all day. The name is in chrome script across the drum, and beneath it, on a chalkboard propped against the glass, somebody rewrites a joke every morning that is never quite as good as the name.',
  },

  rooms: [
    { key: 'room', name: 'The Room', floor: 'tile',
      description: 'One round space under the lantern with the counter across the back of it and tables round the curve, and the light coming straight down through the middle so that at noon there is a bright disc on the floor everybody walks round rather than through. It smells of coffee and wet coats. It is the loudest room in Halcyon Fields by a distance and the sound of it carries out onto the green.',
      window: {
        name: 'the drum glazing',
        description: 'The whole curve, with Vetch Green on one side and Sorrel Way on the other. From the tables on the green side you can watch the birches doing better than the trees on the street, which is a running argument in here.',
        light: 0.85, visibility: 0.9,
      } },
    { key: 'gallery', name: 'The Gallery', floor: 'boards', from: 'room', dir: 'up',
      description: 'A half-floor round the inside of the drum, reached by a chrome stair, with a rail and six small tables against it. You sit looking down into the room and out over the top of the wings at the same time. This is where people come to work, and the unwritten rule that nobody takes a call up here has held for eight months without ever having been stated.',
      window: {
        name: 'the upper curve',
        description: 'Glass from the rail up, all the way round. Over the wings you get the green, the mews and a slice of the Curtain, and from the far side, the top half of Ivory Tower.',
        light: 0.9, visibility: 0.9,
      } },
  ],
  lights: {
    gallery: { name: 'shaded pendants over the tables', description: 'One to a table, hung low on a long flex from the underside of the lantern, each with a chrome shade that puts the light on the table and keeps it out of the glass. At night the gallery reads from outside as six warm circles floating inside a lit drum.', lumens: 340, type: 'pendant' },
  },
  utility: { name: 'The Back of House', floor: 'tile',
    description: 'Below the counter: the water treatment, the compressor, the sacks, and a wall of white tile somebody has stuck twelve years of postcards to. None of the postcards are from anywhere in the Basin.' },

  props: [
    { key: 'board', room: 'room', name: 'a chalkboard', objectType: 'decoration',
      description: 'Propped against the glass by the door and rewritten every morning. Today it says GROUNDS FOR CONCERN — ALSO FOR CELEBRATION, WHICH IS CHEAPER. It has been better and it has been much worse, and there are people on this estate who walk past specifically to read it.' },
    { key: 'counter', room: 'room', name: 'the counter', objectType: 'furniture',
      description: 'Chrome and pale stone across the back of the drum, with the machine at one end and a glass case at the other, and between them a jar for the tips that is never emptied in front of anybody. On the underside of the overhang, where only the staff see it, is a tally of days open.' },
    { key: 'rail', room: 'gallery', name: 'the gallery rail', objectType: 'fixture',
      description: 'Chrome, waist height, right round the inside of the drum, with a shelf on the inner face wide enough for a cup and not for a plate — which is a decision, and which is why nobody eats up here.' },
  ],

  npc: {
    id: 'npc_hf_ferreira', name: 'Nadia Ferreira', sex: 'female', hp: 30,
    homeRoom: 'gallery', workRoom: 'room', shopName: 'Grounds for Concern',
    description: 'A wiry woman in her thirties working the machine with her sleeves pushed up past the elbow and a cloth over one shoulder that she uses about every ninety seconds. She talks to everybody, remembers what they had, and has a running commentary on the estate that is funnier and more accurate than anything in the sales suite.',
    clothing: [
      'a chambray shirt with the sleeves shoved up past the elbow',
      'a chrome-grey apron with two burn marks on the front hem',
      'jeans gone pale at the thigh where she leans on the counter',
      'canvas shoes with no grip left on them at all',
      'plain underthings',
    ],
    inventory: [
      { item_id: 'item_hf_flatwhite', price: 9 },
      { item_id: 'item_hf_pastry', price: 7 },
      { item_id: 'item_hf_beans', price: 46 },
    ],
    chitchat: [
      'Ferreira knocks the portafilter out, wipes it, and has the next one in before the noise has finished.',
      'She looks up at the chalkboard through the glass, winces slightly, and does not change it.',
      'Somebody comes in and she has started their order before they are past the door.',
      'She wipes a table on the green side and stands looking at the birches for a second longer than the job needs.',
      'The machine sighs and she says something to it that is not quite words.',
    ],
    dialogue: {
      root: {
        text: '"Morning." The cloth comes off her shoulder and back again. "Gallery is open, downstairs is loud, and I would not sit by the door if I were you."',
        text_by_relation: {
          first: 'The woman behind the machine gets one going before she looks up, which turns out to be the order of operations for everything in here.\n\n"Right — first time." She says it as a fact, not a question. "Downstairs is loud, gallery is quiet, nobody takes calls up there and I have never had to say so out loud, which I am unreasonably proud of."\n\nShe knocks the filter out.\n\n"Nadia. What are you having?"',
          known: '"Oh, you\'re back." She is already reaching. "Same?"',
          familiar: 'It is on the counter before you have got your coat off, and she is halfway through a sentence about the trees.\n\n"— and the ones on Sorrel are dead, all six, and the straps are still on. Anyway. Morning."',
        },
        options: [
          { label: 'What are you selling?', next: '__shop__' },
          { label: 'How is trade?', next: 'trade' },
          { label: 'What do people talk about in here?', next: 'gossip' },
          { label: 'Why here?', next: 'why' },
          { label: 'Later.', next: 'bye' },
        ],
      },
      trade: {
        text: '"Trade is four hundred people who live in a quarter built for four thousand, and every single one of them comes in here." She grins. "So: excellent, and terrifying."\n\n"If phase three happens I am the only café for a mile and I will need three more of me. If it does not happen, I am the only café for a mile and there will be nobody to sell to. Both of those are the same sentence and I think about it constantly."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      gossip: {
        text: '"The lift at Quiet Enjoyment. The lift at Quiet Enjoyment. And then, for a change, the lift at Quiet Enjoyment." She wipes the counter. "After that: the service charge, whose tacks are amber, and whether the pool up at the club is actually heated, which it is, because I have been in it."\n\n"And the crane. Everyone has an opinion about what time the crane starts and they are all wrong, because it is six."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      why: {
        text: '"Rent." She says it cheerfully. "They could not let this unit. It had been empty a year and it is a round room, which nobody wants for an office, and I got it for an amount I am not going to say out loud in it."\n\nShe glances up at the lantern.\n\n"And then I stood in the middle of the floor at noon and the light came straight down and made that disc, and I would have taken it at twice the money. Do not tell Pardoe I said that."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      bye: { text: '"Go on then. Mind the disc, everybody walks round it." She is already onto the next one.', options: [] },
    },
  },

  items: [
    { id: 'item_hf_flatwhite', name: 'a flat white', type: 'drink', value: 9, weight: 160, description: null, flags: {},
      tags: { stackable: false, description: 'Properly made, in a heavy cup, by somebody who has done it eleven thousand times and still watches the pour. It is the best coffee in the south of the city and the competition is a machine in a lobby two streets away.' } },
    { id: 'item_hf_pastry', name: 'a morning pastry', type: 'food', value: 7, weight: 90, description: null, flags: {},
      tags: { stackable: true, description: 'Bought in rather than baked here, from a place on Marrow Street, and reheated at seven. By eleven they are gone and she will tell you so rather than sell you one at two.' } },
    { id: 'item_hf_beans', name: 'a bag of roasted beans', type: 'food', value: 46, weight: 250, description: null, flags: {},
      tags: { stackable: true, description: 'A kilo in a foil bag with a hand-stamped label and a roast date written on in pen. The stamp is a chalkboard with nothing on it, which took her three goes to get right and is the only piece of graphic design she has ever paid for.' } },
  ],
});

// ── 11. Snagging List ────────────────────────────────────────────────────────
// The site office, which is also, informally and profitably, the only builders' merchant this side
// of the Yards.
SPECS.push({
  slug: 'hf_snagging', name: 'Snagging List', type: 'cascade_block',
  x: 904, y: 917, entrance: 'north', floors: 3, marker: 'NG', district: HF,

  facade: {
    bgColor: '#141a1e', color: '#c0cfd8',
    description: 'A low stepped block with its terraces given over to racked material rather than planting: board, ducting, coils of cable and a stack of the estate\'s own chrome cladding panels under a tarpaulin. The ground floor is the site office. A whiteboard is bolted to the outside wall by the door, wiped and rewritten daily, and the column headed OUTSTANDING has always been the longest one on it.',
  },

  rooms: [
    { key: 'office', name: 'The Site Office', floor: 'linoleum',
      description: 'One room with a counter, three hard hats on pegs, and every wall carrying a drawing. The drawings are marked up in three colours by three different people and the marks do not agree. On the counter is a bound book of defects with a plot number at the head of each page, and about a third of the pages have a line ruled through them and a date, which means somebody actually came back.',
      window: {
        name: 'the office glazing',
        description: 'A wide band onto Kerbstone Row, dusty on the outside and clean on the inside, with a strip of tape at eye level somebody put up to stop people walking into it.',
        light: 0.7, visibility: 0.7,
      } },
    { key: 'store', name: 'The Material Store', floor: 'concrete', from: 'office', dir: 'east',
      description: 'The rest of the ground floor, racked out and surprisingly well ordered: everything labelled, everything by size, a lot of it the estate\'s own specification and none of it, strictly, anybody\'s to sell. The chrome cladding panels in the corner are worth more than the rest of the room together and are stacked face to face with felt between them, which is somebody being careful with something they are stealing.',
    },
  ],
  lights: {
    store: { name: 'a run of caged strip lights', description: 'Wire-caged tubes down the middle of the racking, on a pull cord at each end, throwing hard shadows off every rack so that the aisles read as much deeper than they are.', lumens: 520, type: 'strip' },
  },
  utility: { name: 'The Compressor Room', floor: 'concrete',
    description: 'A lean-to under the first terrace with the compressor, the welder and a bottle store that is chained, padlocked and, on inspection, entirely empty.' },

  props: [
    { key: 'book', room: 'office', name: 'the defects book', objectType: 'container',
      description: 'A4, bound, a page per plot, ruled into date, defect, trade and sign-off. About a third of the pages have a line through them. Roughly a dozen have a defect written in one hand and, underneath in another, NOT A DEFECT — DESIGN. Those dozen are the interesting ones.' },
    { key: 'drawings', room: 'office', name: 'marked-up drawings', objectType: 'decoration',
      description: 'The quarter, floor by floor, pinned four deep and marked in red, green and a blue that has gone purple. The three colours are the architect, the contractor and the estate office, and there are at least six places where all three have drawn a different thing in the same spot and none of them have spoken about it.' },
    { key: 'panels', room: 'store', name: 'a stack of cladding panels', objectType: 'container',
      description: 'The estate\'s own chrome facade panel, face to face with felt between, forty or so of them. They are worth a great deal, they are on nobody\'s inventory, and the tarpaulin they are under on the terrace outside is a different tarpaulin from the one in the photograph on the office wall.' },
  ],
});

// ── 12. Top of the Market ────────────────────────────────────────────────────
// The restaurant at the top of the twisted tower. The fifteen floors underneath it are flats, and
// the restaurant is the only part of the building the public has ever been inside.
SPECS.push({
  slug: 'hf_topmarket', name: 'Top of the Market', type: 'torque_tower',
  x: 898, y: 915, entrance: 'south', floors: 15, marker: 'TE', district: HF,

  facade: {
    bgColor: '#0f151e', color: '#bcd8ee',
    description: 'A tower that turns as it climbs, so from the corner of Kerbstone Row and Kettle Lane you are looking at an edge that walks slowly round the building as you cross the junction. The flats start at the fourth floor. At the top, where the twist has come nearly a quarter turn, the crown floor is lit differently from everything under it — warmer, lower, and on when the rest of the tower is dark. That is the restaurant, and it has its own door at street level with its own lift.',
  },

  rooms: [
    { key: 'lift', name: 'The Restaurant Lobby', floor: 'stone',
      description: 'A narrow ground-floor lobby with one lift in it and nothing else: no desk, no cloakroom, four feet of stone floor and a pair of doors. On the wall, a single framed card with the name on it and no menu, no prices and no hours. The lift has two buttons. The upper one does not light until somebody upstairs decides it does.',
      window: {
        name: 'the door glazing',
        description: 'The glass of the street doors, and through it the junction: Kerbstone Row going west, Kettle Lane going north, and the tower you are standing in going up out of the frame.',
        light: 0.5, visibility: 0.6,
      } },
    { key: 'crown', name: 'The Crown Floor', floor: 'boards',
      from: 'lift', dir: 'up',
      description: 'The top floor of the tower, and because the tower has turned nearly a quarter of the way round on its way up, the room is not aligned with the street grid at all — every window looks down a diagonal, and the effect from a table is of a city that has been rotated slightly and left that way. Fourteen tables. A bar along the core. The kitchen is behind the lift and is smaller than the smallest of the flats below.',
      window: {
        name: 'the crown glazing',
        description: 'The whole perimeter, canted off the grid by the twist, so no window frames a street square-on. The Basin to the north, the Curtain to the south, and between them the quarter with its lights on in the wrong places.',
        light: 0.95, visibility: 1.0,
      } },
  ],
  lights: {
    crown: { name: 'low table lamps', description: 'One to a table, chrome, shaded down so hard that the light lands on the cloth and almost nowhere else. The room is deliberately darker than the view, which is the whole trick and the reason the glass does not become a mirror after dark.', lumens: 180, type: 'table' },
  },
  utility: { name: 'The Lift Motor Room', floor: 'concrete',
    description: 'Off the lobby, behind an unmarked door: the gear for the restaurant lift, which is a separate machine from the residents\' lift on the other side of the core and, unlike the residents\' lift, has never once been out of service.' },

  props: [
    { key: 'card', room: 'lift', name: 'a framed card', objectType: 'decoration',
      description: 'Cream, engraved, in a chrome frame at eye height. It says TOP OF THE MARKET and nothing else — no menu, no prices, no hours, no telephone number. Everyone who has ever stood in this lobby has read it twice looking for the rest of it.' },
    { key: 'tables', room: 'crown', name: 'fourteen tables', objectType: 'furniture',
      description: 'Set for fourteen and never for more, because the kitchen is behind the lift and is smaller than a flat. Every table is at the glass; there is not one in the middle of the room. The spacing between them is the most expensive thing about the place.' },
    { key: 'bar', room: 'crown', name: 'the core bar', objectType: 'furniture',
      description: 'Wrapped round the lift core in one continuous curve of chrome with six stools at it, facing inward at the core rather than outward at the view — which everybody questions once and nobody questions twice, because after ten minutes at the bar you realise you are watching the whole room in the polished core instead.' },
  ],
});

// ── run ──────────────────────────────────────────────────────────────────────
for (const spec of SPECS) {
  const r = await authorBuilding(store, spec);
  console.log(`  ${spec.name.padEnd(24)} ${spec.x},${spec.y}  ${String(spec.type).padEnd(14)} ent=${String(spec.entrance).padEnd(5)} ${r.facadeId}`);
}
// ⚠ MAP CODES HAVE TO BE UNIQUE ACROSS THE WORLD (audit MARK-4) and nothing in authorBuilding
// checks it — content:lint does, at the end of a run that has already written 280 files. Seven
// of the twelve below collided on the first pass with buildings in four other districts, which
// is what two-letter initials over 231 existing codes gets you. Same guard as batch8.
const mine = new Map(SPECS.map((s) => [s.marker, s.name]));
const dupes = [];
for (const z of store.all('zones')) {
  if (!z.marker || !mine.has(z.marker)) continue;
  if (mine.get(z.marker) !== z.name) dupes.push(z.marker + ': ' + z.name + ' vs ' + mine.get(z.marker));
}
if (dupes.length) throw new Error(`marker collision(s):\n  ${dupes.join('\n  ')}`);

const written = store.flush({ dryRun: DRY });
console.log(`\n${DRY ? 'DRY RUN — ' : ''}${written.length} file(s) ${DRY ? 'would change' : 'written'}`);
if (store.droppedRuntime.length) console.log(`  (dropped ${store.droppedRuntime.length} runtime write(s))`);
