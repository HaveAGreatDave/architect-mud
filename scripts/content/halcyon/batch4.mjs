/**
 * Halcyon Fields, batch 4 — the second campaign, west of Kettle Lane.
 *
 * Seven buildings on the campus side: the landmark, three towers, two crescents and a
 * pavilion. Run after batch0 (the streets) and batches 1–3 (the first campaign).
 *
 * ⚠ THE TYPES REPEAT AND THAT IS THE DESIGN. Three of these seven are `chrome_tower` at
 * three different `floors`, and two are `chrome_slab`. An estate is a thing one developer
 * put up in one campaign, and what makes it read as one from a cockpit is that it repeats —
 * fourteen unique buildings on fourteen plots is a high street, not an estate. Every arm is
 * written against `h`, which is `floors × FLOOR_Z`, so `floors` below is the only thing
 * separating one plot from the next and it has to be right before anything else is judged.
 *
 *   node scripts/content/halcyon/batch4.mjs [--dry-run]
 */
import { authorBuilding, loadContentStore } from './lib.mjs';

const DRY = process.argv.includes('--dry-run');
const store = loadContentStore();
const SPECS = [];

// ── Common Ground ────────────────────────────────────────────────────────────
// The landmark: two towers with a glazed bridge slung between them, and you walk in under
// the gap. The only building in Coldwater with a hole through it above street level.
SPECS.push({
  slug: 'hf_common', name: 'Common Ground', type: 'sky_court',
  x: 892, y: 911, entrance: 'north', floors: 16, marker: 'CN', district: 'halcyon_fields',
  facade: {
    bgColor: '#101c26', color: '#bfe8ff',
    description: 'Two glass shafts off one chrome podium, unequal, with a glazed link slung between them nine storeys up. You go in underneath it, across a forecourt with nothing on it, and the shadow of the bridge lies across the paving in a hard bar that moves all day. The letting board by the door lists sixty-two apartments and has a plastic sleeve for a photograph that has never had a photograph in it.',
  },
  rooms: [
    { key: 'lobby', name: 'The Forecourt Lobby', floor: 'tile',
      description: 'A round room under a round ceiling, all of it the same pale grey, with a desk that is a single curved slab and nothing behind it but a wall. Two lifts, one of them keyed. The acoustics are very slightly wrong and everybody who comes in here drops their voice without deciding to.' },
    { key: 'bridge', name: 'The Link', floor: 'tile', from: 'lobby', dir: 'up',
      description: 'A glazed tube between the two towers, forty paces end to end, with the city on one side and the Curtain on the other. There are four chairs in it and a table with nothing on the table. Standing in the middle you can see straight down through the glass floor panel to the forecourt, and most people take one step to the left.' },
  ],
  utility: { name: 'The Podium Plant Room', floor: 'concrete',
    description: 'Under the forecourt, where the two towers share everything: one set of pumps, one tank, one board. The cabinet is on the wall between the two risers, and somebody has labelled the risers NORTH and TALL.' },
  lights: { bridge: { name: 'the link uplighters', description: 'A continuous trough along both sides at ankle height, throwing light up the glass rather than down onto the floor. At night the whole tube reads as a bar of light from the ground and as almost nothing from inside it.', lumens: 900, type: 'fixture' } },
  props: [
    { key: 'desk', room: 'lobby', name: 'the concierge slab', objectType: 'fixture',
      description: 'One curved piece of pale composite with no drawers, no shelf and no visible join. There is a worn patch where forearms go.',
      flags: { aliases: ['desk', 'slab', 'concierge'], vendor_safe: true, vendor_npc_id: 'npc_hf_common_tarn', hack_difficulty: 5 } },
    { key: 'board', room: 'lobby', name: 'the letting board', objectType: 'decoration',
      description: 'Sixty-two lines, each with a number and a status. Fifty-one say AVAILABLE and the rest say RESERVED, and none of them has ever said anything else.',
      flags: { aliases: ['board', 'letting', 'list'], interactions: { examine: 'The RESERVED ones are the same eleven numbers they were last season. Nobody has moved into any of them.' } } },
    { key: 'panel', room: 'bridge', name: 'the glass floor panel', objectType: 'decoration',
      description: 'A square of clear floor in the middle of the link, with the forecourt a long way down through it and a hairline scuff pattern around its edge where feet have gone round rather than across.',
      flags: { aliases: ['panel', 'floor', 'glass'], interactions: { examine: 'The scuffs make a neat oval. In two seasons of people walking this bridge, the oval has not been stepped inside once.' } } },
  ],
  items: [
    { id: 'item_hf_common_brochure', name: 'a Common Ground brochure', type: 'misc', value: 12, weight: 14, description: null, flags: {},
      tags: { stackable: true, description: 'Heavy paper, four folds, and a rendering on the front of the bridge at dusk with eleven people on it. Nobody has ever counted eleven people in this building at once.' } },
    { id: 'item_hf_common_fob', name: 'a visitor fob', type: 'misc', value: 55, weight: 4, description: null, flags: {},
      tags: { stackable: true, description: 'A chrome disc the size of a coin, warm from the drawer. It opens the unkeyed lift and the link, and it stops working at midnight whatever time you were given it.' } },
  ],
  npc: {
    id: 'npc_hf_common_tarn', name: 'Velia Tarn', sex: 'female', hp: 30,
    homeRoom: 'bridge', workRoom: 'lobby', shopName: 'Common Ground',
    description: 'A small, extremely tidy woman in the estate\'s own grey, standing at the slab with her hands flat on it. She is somewhere in her forties and has the particular brightness of somebody who has been told to be welcoming and has decided to be good at it rather than resent it. She knows every one of the fifty-one empty numbers by heart.',
    clothing: ['a grey estate tunic with a chrome collar pin', 'a pale undershirt, pressed', 'grey trousers with a hard crease', 'plain underthings'],
    inventory: [
      { item_id: 'item_hf_common_brochure', price: 12 },
      { item_id: 'item_hf_common_fob', price: 55 },
    ],
    chitchat: [
      'Tarn straightens something on the slab that was already straight.',
      'She looks up at the link, checks the light on it, and looks back down.',
      'A lift arrives at the lobby with nobody in it. She does not react.',
      'She runs a cloth along the edge of the slab, following the curve all the way round.',
      'Somewhere above, a door closes. She counts something under her breath and stops.',
    ],
    dialogue: {
      root: {
        text: '"Good afternoon." Her hands stay flat on the slab. "Are you viewing, or are you here for somebody?"',
        text_by_relation: {
          first: 'The woman at the slab watches you cross the forecourt through the glass and is already speaking by the time the door has finished opening.\n\n"Welcome to Common Ground. Velia Tarn." She says it the way you say a thing you have said a great many times and still mean. "Sixty-two apartments, two towers, and the link is open to residents and their guests from six until eleven."\n\nShe turns a fob over on the slab with one finger.\n\n"You are very welcome to go up and stand on the bridge. Most people want to. There is no charge for it, and I would honestly rather somebody was up there."',
          known: '"Back again." She has the fob out before you ask. "Bridge is open. Mind the panel, or don\'t, everybody minds the panel."',
          familiar: 'She is already turning the fob on the slab when you come in.\n\n"Nobody up there today," she says. "Go on. I\'ll watch the desk, which is what I do anyway."',
        },
        options: [
          { label: 'How many people actually live here?', next: 'empty' },
          { label: 'A fob for the bridge, then.', next: '__shop__' },
          { label: 'What is the link for?', next: 'link' },
          { label: 'Who built all this?', next: 'built' },
          { label: 'Heard anything?', next: 'gossip' },
          { label: 'Another time.', next: 'bye' },
        ],
      },
      empty: {
        text: '"Eleven flats occupied." She does not hesitate and she does not soften it. "Out of sixty-two. Two of the eleven are here at weekends only."\n\n"It is a new estate. They take time. I have been told the number by people whose job is to know it, and the number they say is three years." She glances at the board. "I have been here for two of them."',
        options: [{ label: 'And you believe them?', next: 'believe' }, { label: 'Back.', next: 'root' }],
      },
      believe: {
        text: 'She thinks about it properly, which is not the reaction you expected.\n\n"I believe the Ascendants do not build things they intend to leave empty," she says. "That is not the same as believing the three years. But it is the part I would bet on."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      link: {
        text: '"It is a shared room. That was the whole idea." She sounds like she is quoting and also like she agrees. "Two towers, one room in the middle, so the people in one know the people in the other."\n\n"The difficulty is that eleven households do not fill a room that size. So it is a very beautiful place to be the only person." A pause. "I go up at the end of a shift. I like it."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      built: {
        text: '"The same people who built the Spire, and they have not pretended otherwise." She nods north through the glass, where the Spire stands over the whole quarter. "You can see the family resemblance from the forecourt. That is deliberate. You are meant to look up at that and then look at this and think about the distance between them being short."\n\n"Whether it is short is not my department."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      gossip: {
        text: '"The lift on the tall side runs at night with nobody calling it." She says this in exactly the tone she used for the occupancy figure. "I have had the engineers. They say it is a calibration cycle and they have shown me the schedule and the schedule is real."\n\n"It runs at four. The schedule says two." She smooths the slab. "I expect the schedule is fine and I am wrong about the hour."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      bye: { text: '"Mind the step at the forecourt edge," she says. "It is the same colour as the paving. That one I have raised."', options: [] },
    },
  },
});

// ── Top Brass ────────────────────────────────────────────────────────────────
SPECS.push({
  slug: 'hf_topbrass', name: 'Top Brass', type: 'chrome_tower',
  x: 892, y: 909, entrance: 'south', floors: 18, marker: 'TP', district: 'halcyon_fields',
  facade: {
    bgColor: '#12202c', color: '#9fd8ff',
    description: 'Eighteen storeys of glass cylinder on a chrome saucer, with a bright collar at every fifth floor and a mast on the crown that carries a red light. It is the tallest thing on this side of the boulevard and it is very slightly narrower at the top than at the bottom, which you only notice by standing at the foot of it and looking straight up, which everybody does once.',
  },
  rooms: [
    { key: 'lobby', name: 'The Saucer', floor: 'tile',
      description: 'A round lobby under the podium disc, glazed the whole way round, so from inside it you are standing in the middle of a low pale ring with the boulevard going past on every side. Two lifts in the core. A single long bench follows the curve of the wall and nobody ever sits at the ends of it.' },
    { key: 'sky', name: 'The Fifteenth Collar', floor: 'carpet', from: 'lobby', dir: 'up',
      description: 'A plant floor that got finished as a residents\' room instead, halfway up the tower, with the glass going all the way round and nothing outside it but air and the Curtain. There is a kitchen counter, four chairs, and a noticeboard with two notices on it, one of which is about the other one.' },
  ],
  utility: { name: 'The Core Base', floor: 'concrete',
    description: 'The bottom of the riser, where everything that goes up the middle of the tower starts. Water, power and the lift gear, stacked in a room the shape of a slice. The cabinet is bolted to the flat side.' },
  lights: { sky: { name: 'the cove lighting', description: 'A continuous line where the ceiling meets the glass, which means the room has no visible lamp in it at all and the light appears to come off the ceiling itself. At night the collar reads from the ground as a lit band and nobody down there knows it is a room.', lumens: 800, type: 'fixture' } },
  props: [
    { key: 'bench', room: 'lobby', name: 'the curved bench', objectType: 'furniture',
      description: 'One piece of pale composite following the wall for most of a half-circle, with a dip worn into it exactly opposite the lifts.',
      flags: { aliases: ['bench', 'seat'], interactions: { sit: 'You sit in the dip, because everybody does, and you can see both lift doors without turning your head. That is why the dip is there.' } } },
    { key: 'counter', room: 'sky', name: 'the residents\' counter', objectType: 'fixture',
      description: 'A kitchen run with a kettle, two mugs and a jar of something, and a chrome facing that shows every fingerprint and has almost none on it.',
      flags: { aliases: ['counter', 'kitchen', 'kettle'], vendor_safe: true, vendor_npc_id: 'npc_hf_topbrass_okoye', hack_difficulty: 4 } },
    { key: 'notices', room: 'sky', name: 'the noticeboard', objectType: 'decoration',
      description: 'Two notices. The first asks residents to book the room. The second, below it, notes that nobody has booked the room.',
      flags: { aliases: ['board', 'notices', 'noticeboard'], interactions: { examine: 'The second notice is in a different hand and is not on estate paper. It has been there longer than the first.' } } },
  ],
  items: [
    { id: 'item_hf_topbrass_coffee', name: 'a cup of the collar coffee', type: 'drink', value: 14, weight: 190, description: null, flags: {},
      tags: { stackable: false, description: 'Made at the residents\' counter fifteen floors up, in a mug that belongs to the building. It is not good and the view is, and everybody makes the same trade.' } },
    { id: 'item_hf_topbrass_key', name: 'a collar card', type: 'misc', value: 40, weight: 3, description: null, flags: {},
      tags: { stackable: true, description: 'A thin chrome card that calls the lift to fifteen and nowhere else. The estate issues them to guests and does not take them back, which is either generosity or an oversight nobody has corrected.' } },
  ],
  npc: {
    id: 'npc_hf_topbrass_okoye', name: 'Dapo Okoye', sex: 'male', hp: 34,
    homeRoom: 'sky', workRoom: 'sky', shopName: 'Top Brass',
    description: 'A tall man in his fifties with a careful stoop from a lifetime of doorways built for other people, leaning on the residents\' counter with a cloth over one shoulder. He is not employed by the estate. He lives on eleven, he comes up here every day, and at some point in the last year he started making coffee for whoever else turned up, which was nobody and then occasionally somebody.',
    clothing: ['a soft grey cardigan with the elbows gone shiny', 'a collarless shirt, clean', 'dark trousers, comfortable rather than smart', 'slippers he keeps up here'],
    inventory: [
      { item_id: 'item_hf_topbrass_coffee', price: 14 },
      { item_id: 'item_hf_topbrass_key', price: 40 },
    ],
    chitchat: [
      'Okoye wipes the counter, which is already clean, in a long slow circle.',
      'He looks out at the Curtain for a while and then at the kettle.',
      'The lift arrives, waits, and goes away again. He does not turn round.',
      'He rearranges the two mugs so that the handles point the same way.',
      'He reads the second notice on the board again, as if it might have changed.',
    ],
    dialogue: {
      root: {
        text: '"You found it, then." He reaches for the kettle without being asked. "Sit anywhere. It is all anywhere."',
        text_by_relation: {
          first: 'The lift opens onto a room going all the way round the building, and a tall man at a counter looks up as if he has been expecting somebody for about a year.\n\n"Well." He puts the cloth down. "Somebody came up."\n\nHe straightens, and then decides not to make anything of it.\n\n"Dapo Okoye. Eleven. This is the residents\' room and you are allowed to be in it, whatever anybody downstairs implies." He turns a mug the right way up. "Coffee is fourteen and it is not worth fourteen. The window is free."',
          known: '"There you are." The kettle is already going. "Fourteen, same as before, and still not worth it."',
          familiar: 'He has the mug out and the kettle on before the lift doors have finished opening.\n\n"Sit down," he says. "I want to show you something the Curtain does at this hour and you have about four minutes."',
        },
        options: [
          { label: 'Why do you run the counter?', next: 'why' },
          { label: 'Coffee, then.', next: '__shop__' },
          { label: 'What is the second notice about?', next: 'notice' },
          { label: 'What does the Curtain do at this hour?', next: 'curtain' },
          { label: 'Heard anything?', next: 'gossip' },
          { label: 'Another time.', next: 'bye' },
        ],
      },
      why: {
        text: '"Because the room was going to waste and I was going to waste, and one of those I could do something about."\n\nHe says it lightly and then does not laugh, which makes it land differently.\n\n"There are eleven households in this tower and eighteen floors. I have met four of them, and I met three of those up here. So the counter works. It is the only thing in this building that works the way the brochure said it would."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      notice: {
        text: '"The estate put up a notice asking us to book the room." He nods at the board. "So I put up a notice saying nobody has booked the room. It is not a complaint. It is a fact, and I wanted it next to the other fact."\n\n"They have not taken it down. Two seasons now. I think somebody down there agrees with me and cannot say so on estate paper."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      curtain: {
        text: '"Watch the top edge of it." He does not point; he waits. "When the light goes, the wall keeps it about a minute longer than the ground does, because of the height. So for a minute there is a bright line out west and everything under it is already dark."\n\n"You cannot see that from the street. You cannot see it from the fourth floor either. You need about fifteen storeys and a west window, and there are exactly two buildings in the Basin with both, and the other one does not let me in."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      gossip: {
        text: '"The collars." He taps the glass. "Every fifth floor, outside, there is a band. They told us it was plant. There is plant on five and on twenty, and this floor is not plant, it is this."\n\n"So one of the three is not what it says on the drawing, and it is not this one, because I am standing in it." He picks the cloth back up. "It is probably nothing. Most things are. I would still like to know what is on five."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      bye: { text: '"Take the west lift down," he says. "The other one stops at nine for no reason anybody has explained to me."', options: [] },
    },
  },
});

// ── Rising Sums ──────────────────────────────────────────────────────────────
SPECS.push({
  slug: 'hf_rising', name: 'Rising Sums', type: 'chrome_tower',
  x: 895, y: 909, entrance: 'south', floors: 15, marker: 'RG', district: 'halcyon_fields',
  facade: {
    bgColor: '#13212e', color: '#9fd8ff',
    description: 'The same tower as its neighbour and three storeys shorter, which from the boulevard makes the pair of them look like one idea somebody had twice. The ground floor is let to a broker rather than to a porter, so the saucer has a counter in it and a board of figures that updates while you stand there, and the residents go round the outside to a side door.',
  },
  rooms: [
    { key: 'floor', name: 'The Trading Saucer', floor: 'tile',
      description: 'A round glazed room with a board round the inside of the curve carrying figures that move. Four desks face outward at the glass rather than inward at each other. It is bright, it is quiet, and the only sound is the board reticking, which it does every eleven seconds whether or not anything has changed.' },
    { key: 'back', name: 'The Settlement Room', floor: 'carpet', from: 'floor', dir: 'north',
      description: 'A small square room behind the core with no window at all, which in this building is a deliberate luxury: it is the only place on the plot where nobody can see you through glass. A table, four chairs and a jug of water that is refilled whether or not anybody drank any.' },
  ],
  utility: { name: 'The Riser Cupboard', floor: 'concrete',
    description: 'A slice-shaped room at the foot of the core with the board\'s own supply in it, separate from the building\'s, because a broker who loses the figures for ten minutes loses more than the estate pays for the whole riser. The cabinet is on the flat wall beside two very well-labelled breakers.' },
  lights: { floor: { name: 'the board wash', description: 'A cold line of light behind the figure board, throwing it forward off the curve of the wall so the numbers appear to be standing a hand\'s breadth clear of it. It is a trick and it works.', lumens: 1000, type: 'fixture' } },
  props: [
    { key: 'board', room: 'floor', name: 'the figure board', objectType: 'fixture',
      description: 'A ribbon of figures following the curve of the room for most of a circle, reticking every eleven seconds. Land, chrome, water rights and one column nobody will explain.',
      flags: { aliases: ['board', 'figures', 'ticker'], hack_difficulty: 7, interactions: { examine: 'The unexplained column is headed with two characters and a slash. It moves less than the others and, when it moves, the others follow it about a minute later.' } } },
    { key: 'counter', room: 'floor', name: 'the broker\'s counter', objectType: 'fixture',
      description: 'A short chrome run by the door with a drawer, a pad and a chair that is pushed in.',
      flags: { aliases: ['counter', 'desk', 'broker'], vendor_safe: true, vendor_npc_id: 'npc_hf_rising_calloway', hack_difficulty: 5 } },
    { key: 'jug', room: 'back', name: 'the water jug', objectType: 'decoration',
      description: 'Glass, full, with a cloth folded under it. It is refilled every morning and it is almost never poured from.',
      flags: { aliases: ['jug', 'water'], interactions: { examine: 'There is a ring on the cloth from a glass, and only one, and it is not fresh.' } } },
  ],
  items: [
    { id: 'item_hf_rising_note', name: 'a plot note', type: 'misc', value: 90, weight: 5, description: null, flags: {},
      tags: { stackable: true, description: 'A slip entitling the bearer to be told, once, what a named plot in Halcyon Fields last changed hands for. It does not entitle you to buy it and it says so at the bottom in the same size as everything else.' } },
    { id: 'item_hf_rising_pen', name: 'a settlement pen', type: 'misc', value: 22, weight: 6, description: null, flags: {},
      tags: { stackable: true, description: 'Chrome, heavy for its size, with the estate mark on the cap. They are given away to people who sign things and they are the most common object in the quarter.' } },
  ],
  npc: {
    id: 'npc_hf_rising_calloway', name: 'Ines Calloway', sex: 'female', hp: 32,
    homeRoom: 'back', workRoom: 'floor', shopName: 'Rising Sums',
    description: 'A sharp, unhurried woman of about thirty-five in a good coat she does not take off indoors, standing at the counter with her back to the figures because she can hear them. She sells information about land at a price that is always slightly less than you braced for, which is how she gets you back.',
    clothing: ['a long charcoal coat, well cut, worn indoors on purpose', 'a plain high-necked top', 'narrow dark trousers', 'plain underthings'],
    inventory: [
      { item_id: 'item_hf_rising_note', price: 90 },
      { item_id: 'item_hf_rising_pen', price: 22 },
    ],
    chitchat: [
      'The board reticks. Calloway does not turn round.',
      'She writes two figures on the pad, looks at them, and crosses out the first.',
      'She glances at the unexplained column for slightly longer than at the others.',
      'Somebody\'s lift goes past overhead. She notes the time without appearing to.',
      'She squares the pen on the pad and leaves it there.',
    ],
    dialogue: {
      root: {
        text: '"Afternoon." She does not move from the counter. "Buying, selling, or finding out?"',
        text_by_relation: {
          first: 'The woman at the counter has watched you since the forecourt and lets you get all the way to her before she says anything.\n\n"Rising Sums. Calloway." She turns the pad round so you can see it is blank. "We do not sell land. Nobody sells land in Halcyon Fields, because the estate has not released any."\n\n"What we sell is what the last one went for. Ninety for a named plot, and I will tell you to your face if the answer is going to disappoint you before you pay."',
          known: '"Back." The pad is already turned round. "Which plot?"',
          familiar: 'She has the note half written before you are through the door.\n\n"I know which one," she says. "And the answer moved this week, which I thought you would want to hear from me rather than off the board."',
        },
        options: [
          { label: 'What is the column nobody explains?', next: 'column' },
          { label: 'A plot note, then.', next: '__shop__' },
          { label: 'Who is actually buying here?', next: 'buying' },
          { label: 'Why sell figures rather than land?', next: 'why' },
          { label: 'Heard anything?', next: 'gossip' },
          { label: 'Another time.', next: 'bye' },
        ],
      },
      column: {
        text: 'She looks at it for a second before she answers, which is the most honest thing she does all day.\n\n"I do not know. It arrives on the same feed as the rest and it is headed with two characters that are not a commodity I have ever traded."\n\n"What I know is the shape of it. When that column moves, everything else on the board moves about a minute afterwards, in the direction it went. Every time." She shrugs with one shoulder. "So I read it, and I do not ask, and I have made a living out of a minute."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      buying: {
        text: '"Nobody you would recognise, and that is the finding." She taps the counter once. "The plots that have changed hands here have gone to holdings with three-letter names and a registered address that is a floor of the Spire."\n\n"Which does not mean the Ascendants are buying their own estate. It means somebody who can afford a floor of the Spire is." A pause. "I would like those to be different sentences and I cannot get them to be."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      why: {
        text: '"Because land you cannot buy is worth exactly what somebody tells you it is, and I am the somebody." She says it without any pleasure in it, as a description. "There is no market here. There is a release schedule."\n\n"When the estate opens the plots I will be selling land like everybody else and I will be worse at it than half of them. Until then, this is the trade there is."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      gossip: {
        text: '"The verge plots." She nods vaguely east, past Kettle Lane. "Four of them, between the finished buildings, still grass. The board has a figure for every plot in the quarter except those four."\n\n"Not a blank. Not a dash. They are simply not listed, and I have checked whether they were ever listed, and they were not." She turns the pad over. "Somebody decided before the first brick that those four were not for sale, and that is the kind of decision that usually has a reason standing on it later."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      bye: { text: '"If the board jumps while you are on the boulevard," she says, "come back up. That is when the notes are worth what I charge for them."', options: [] },
    },
  },
});

// ── Light Relief ─────────────────────────────────────────────────────────────
SPECS.push({
  slug: 'hf_relief', name: 'Light Relief', type: 'chrome_tower',
  x: 892, y: 915, entrance: 'south', floors: 13, marker: 'LG', district: 'halcyon_fields',
  facade: {
    bgColor: '#141f2a', color: '#a8dcff',
    description: 'The shortest of the three towers and the only one that is fully occupied, because it was let cheaply to the people who build the rest of the estate. Boots outside doors, washing on two of the collars, and a hand-painted board by the entrance listing four trades and a telephone number that is not the estate\'s. The glass is the same glass. Everything else about it is different.',
  },
  rooms: [
    { key: 'lobby', name: 'The Boot Room', floor: 'concrete',
      description: 'What was drawn as a lobby and is used as a boot room: a rack the full length of the curve, forty pairs on it, and a hose bib by the door with a drain under it. The pale composite floor has given up. Somebody has screwed a hook rail into the glazing mullions, which the estate has written two letters about.' },
    { key: 'canteen', name: 'The Fifth Collar', floor: 'linoleum', from: 'lobby', dir: 'up',
      description: 'The plant floor, taken over: six tables, a long counter, a tea urn that is never off, and the whole of the west glazing with the Curtain behind it. At seven in the morning there are thirty people in here and it is the loudest room in Halcyon Fields by a distance nobody else in the quarter would believe.' },
  ],
  utility: { name: 'The Riser Base', floor: 'concrete',
    description: 'The foot of the core, and the only room in the tower still used for what it was drawn for. Somebody has chalked a rota on the wall beside the cabinet, and the rota is about the urn.' },
  lights: { canteen: { name: 'the strip lights', description: 'Four bare strips the residents put up themselves, hung off the cove that was meant to do the lighting, because the cove is beautiful and you cannot read a docket by it.', lumens: 1100, type: 'fixture' } },
  props: [
    { key: 'rack', room: 'lobby', name: 'the boot rack', objectType: 'furniture',
      description: 'Scaffold board and angle iron, following the curve of the wall, with about forty pairs on it and a puddle under the middle third.',
      flags: { aliases: ['rack', 'boots'], interactions: { examine: 'Every pair is caked with the same pale grey dust. It is the dust the rest of the estate is made of, and it is in this building because these are the people making it.' } } },
    { key: 'urn', room: 'canteen', name: 'the tea urn', objectType: 'fixture',
      description: 'A big chrome cylinder with a tap and a permanent line of lime under it, bolted to the counter so nobody can take it home.',
      flags: { aliases: ['urn', 'tea', 'counter'], vendor_safe: true, vendor_npc_id: 'npc_hf_relief_madigan', hack_difficulty: 3 } },
    { key: 'rota', room: 'canteen', name: 'the rota', objectType: 'decoration',
      description: 'Chalk on the painted wall, thirteen names down one side and a fortnight across the top, most cells ticked.',
      flags: { aliases: ['rota', 'chalk', 'list'], interactions: { examine: 'Two names have been rubbed out and written back in, in a different hand, which is the nearest thing this building has to a formal apology.' } } },
  ],
  items: [
    { id: 'item_hf_relief_tea', name: 'a mug of urn tea', type: 'drink', value: 4, weight: 210, description: null, flags: {},
      tags: { stackable: false, description: 'Strong enough to stand a spoon in and four credits because that is what it costs to run the urn, split thirteen ways, rounded up. Nobody has ever made a profit on it and the rota exists to make sure nobody makes a loss either.' } },
    { id: 'item_hf_relief_roll', name: 'a bacon roll off the counter', type: 'food', value: 11, weight: 160, description: null, flags: {},
      tags: { stackable: true, description: 'Made at half five by whoever is on the rota, wrapped in paper, and gone by seven. The best thing to eat in Halcyon Fields and the only thing in Halcyon Fields that is not chrome-coloured.' } },
  ],
  npc: {
    id: 'npc_hf_relief_madigan', name: 'Bryher Madigan', sex: 'female', hp: 40,
    homeRoom: 'canteen', workRoom: 'canteen', shopName: 'Light Relief',
    description: 'A broad, weathered woman in her sixties working the urn with her sleeves rolled, forearms like a dockhand and reading glasses pushed up into grey hair. She laid pipe in this quarter for two years and her knee stopped her, so she took the counter, and the counter is now the reason thirty people eat before a shift.',
    clothing: ['a faded work shirt with the sleeves rolled above the elbow', 'a long canvas apron, stained and washed', 'heavy trousers with a knee support under them', 'thick socks and no boots indoors'],
    inventory: [
      { item_id: 'item_hf_relief_tea', price: 4 },
      { item_id: 'item_hf_relief_roll', price: 11 },
    ],
    chitchat: [
      'Madigan tops the urn up and checks the lime line under the tap.',
      'She calls a name across the room and somebody answers from behind the counter.',
      'She wipes a table with one hand and carries three mugs in the other.',
      'She looks at the rota, finds her own name, and looks away satisfied.',
      'Her knee goes as she turns. She swears at it, briefly and without heat, and carries on.',
    ],
    dialogue: {
      root: {
        text: '"Tea\'s four, roll\'s eleven, sit where you like." She is already moving. "You\'re not one of ours, are you."',
        text_by_relation: {
          first: 'The lift opens onto noise, which after the rest of this quarter is genuinely startling, and a big woman at an urn looks over the top of thirty people and clocks you immediately.\n\n"You\'re not one of ours."\n\nIt is not hostile. She puts a mug down in front of somebody and comes round the counter.\n\n"Madigan. This is the fifth. It is meant to be plant and it is a canteen, and if anybody from the estate asks you, it is plant." She looks you over once. "Tea\'s four. You are welcome, and I mean that, and I would still rather you did not stand in the servery."',
          known: '"There you are." The mug is poured before you have crossed the room. "Four. Sit down, you\'re in the way."',
          familiar: 'She has the mug and the roll on the counter before you are off the lift, and pushes them across with the back of her hand.\n\n"Eat that," she says. "You look like the estate feeds you."',
        },
        options: [
          { label: 'Why is this tower full when the others are empty?', next: 'full' },
          { label: 'Tea, then.', next: '__shop__' },
          { label: 'What are you all building?', next: 'building' },
          { label: 'Does the estate mind the canteen?', next: 'estate' },
          { label: 'Heard anything?', next: 'gossip' },
          { label: 'Another time.', next: 'bye' },
        ],
      },
      full: {
        text: '"Because they let it cheap to us and they let the others dear to nobody." She says it flatly, as arithmetic. "Thirteen floors, all taken, mostly two and three to a flat."\n\n"They did it so the site had a labour force that did not have to cross the city at five in the morning. It was a good decision and I will say so." She wipes the counter. "It is also the only building on this estate with anybody in it, and I do not think that was in the drawing."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      building: {
        text: '"Whatever is on the sheet." She jerks her chin south. "This season it is the halt and the two glasshouses on the Buried Road. Last season it was the crescent."\n\n"The halt is the one that gets talked about, because there is no line to it." She refills the urn. "We built a station. There is no railway. We put the board in and the board works and it says SERVICE COMMENCING, and it has said that since we screwed it on."',
        options: [{ label: 'And nobody has asked?', next: 'asked' }, { label: 'Back.', next: 'root' }],
      },
      asked: {
        text: '"Everybody has asked." She almost laughs. "You get the same answer every time, and it is not a lie, it is just not an answer: the halt is in the phase and the line is in a later phase."\n\n"Which is how every big job works. You put the hard bit in first while the ground is open." She looks at the urn. "I have been on jobs where the later phase came. I have been on more where it did not."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      estate: {
        text: '"They have written twice." She holds up two fingers. "First one was about the hook rail downstairs. Second one was about the first one."\n\n"Nobody has come up. I think the position is that a canteen on the fifth is against the lease and also the only reason the site starts on time, and somebody sensible has decided not to make those two facts meet in a room."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      gossip: {
        text: '"There is a plot on Kettle Lane that keeps getting pegged out and then un-pegged." She says it while working, not looking up. "Three times now. Pegs go in, string goes round, and a fortnight later somebody pulls the lot and it is grass again."\n\n"That is not indecision. Setting out costs money and you do not pay for it three times by accident." She sets the mug down hard enough to make the point. "Somebody keeps deciding to build there and somebody keeps deciding they cannot."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      bye: { text: '"Mug goes back on the counter," she says. "Not the table. I will find it on the table and I will know it was you."', options: [] },
    },
  },
});

// ── Curve Appeal ─────────────────────────────────────────────────────────────
SPECS.push({
  slug: 'hf_curve', name: 'Curve Appeal', type: 'chrome_slab',
  x: 897, y: 909, entrance: 'south', floors: 9, marker: 'CU', district: 'halcyon_fields',
  facade: {
    bgColor: '#16232f', color: '#9fe0ff',
    description: 'A nine-storey office that bends. The whole front is one long curved wall of glass on a chrome podium, with a turned column at each joint and a low frame on the roof, and because it is a curve it shows you a different building from every point on the boulevard. Six of the nine floors are let. The letting agent has stopped saying which six.',
  },
  rooms: [
    { key: 'atrium', name: 'The Inner Curve', floor: 'tile',
      description: 'The inside of the arc, which is a long shallow room that you can never see both ends of at once. Pale floor, pale ceiling, a reception island halfway along, and a row of chairs against the inside wall that have been arranged in a straight line inside a curve and look wrong in a way most people cannot name.' },
    { key: 'suite', name: 'The Fourth Floor Suite', floor: 'carpet', from: 'atrium', dir: 'up',
      description: 'An unlet floor kept show-ready: eleven desks, none of them used, a meeting room with the chairs at perfect intervals, and the light left on. There is a coat on the back of one chair which has been there long enough that it is part of the presentation.' },
  ],
  utility: { name: 'The Podium Switch Room', floor: 'concrete',
    description: 'Under the middle of the arc, where the three structural segments meet and every service in the building has to pass through the same wall. The cabinet is between two risers, and the room is the only square space in a building with no square spaces.' },
  lights: { suite: { name: 'the show-floor lighting', description: 'The whole ceiling grid, left on, at the level an agent thinks a floor shows best at. It costs the estate more per season than the floor would let for and nobody has been able to get the decision reversed.', lumens: 1200, type: 'fixture' } },
  props: [
    { key: 'island', room: 'atrium', name: 'the reception island', objectType: 'fixture',
      description: 'A curved counter standing free in the middle of the arc, with a screen, a visitor book and a bowl of chrome settlement pens.',
      flags: { aliases: ['island', 'reception', 'counter'], vendor_safe: true, vendor_npc_id: 'npc_hf_curve_stellan', hack_difficulty: 5 } },
    { key: 'chairs', room: 'atrium', name: 'the row of chairs', objectType: 'furniture',
      description: 'Eight identical chairs set in a dead straight line against a wall that is not straight, so the gap behind them goes from nothing to a hand\'s width and back.',
      flags: { aliases: ['chairs', 'row', 'seats'], interactions: { sit: 'You sit in one of the middle ones, which is the only place the line and the wall agree, and it is oddly the most comfortable thing about the building.' } } },
    { key: 'coat', room: 'suite', name: 'the coat on the chair', objectType: 'decoration',
      description: 'A good dark coat over the back of the fourth desk, positioned to suggest somebody has stepped out. It has a thin line of dust along the shoulders.',
      flags: { aliases: ['coat', 'chair'], interactions: { examine: 'The dust on the shoulders is even, which means it has not been moved. The pockets have been emptied and turned out and put back.' } } },
  ],
  items: [
    { id: 'item_hf_curve_particulars', name: 'a floor particulars folder', type: 'misc', value: 18, weight: 40, description: null, flags: {},
      tags: { stackable: true, description: 'Card covers, a plan of one floor, and a paragraph describing the view from a building that faces a meadow. The paragraph is not wrong and is dated in a way the plan is not.' } },
    { id: 'item_hf_curve_pass', name: 'a viewing pass', type: 'misc', value: 30, weight: 3, description: null, flags: {},
      tags: { stackable: true, description: 'Gets you onto the show floor unaccompanied, which the agent offers freely, because an empty floor shows better when there is nobody standing in it apologising for it.' } },
  ],
  npc: {
    id: 'npc_hf_curve_stellan', name: 'Rowe Stellan', sex: 'male', hp: 28,
    homeRoom: 'suite', workRoom: 'atrium', shopName: 'Curve Appeal',
    description: 'A neat, quick young man in a very good suit at the reception island, who has clearly been told that enthusiasm sells and has arrived at a version of it he can sustain for ten hours. He is better at this than the building deserves and he knows that too.',
    clothing: ['a slim charcoal suit, pressed, slightly too good for the salary', 'a pale shirt with a soft collar', 'dark shoes kept very clean', 'plain underthings'],
    inventory: [
      { item_id: 'item_hf_curve_particulars', price: 18 },
      { item_id: 'item_hf_curve_pass', price: 30 },
    ],
    chitchat: [
      'Stellan squares the bowl of pens with the edge of the island.',
      'He checks the screen, sees nothing, and checks it again a moment later.',
      'He glances down the curve towards the far end he cannot see.',
      'He signs the visitor book himself, at the top of a fresh page, to start it off.',
      'He practises a sentence under his breath and discards it.',
    ],
    dialogue: {
      root: {
        text: '"Welcome to Curve Appeal." He is out from behind the island before you have stopped walking. "Are you viewing? You can view. There is no appointment needed, there is barely an appointment system."',
        text_by_relation: {
          first: 'A young man in a very good suit comes round the island at a speed that suggests he has been waiting for somebody since the morning and has decided not to hide it.\n\n"Welcome to Curve Appeal. Rowe Stellan, letting." He puts out a hand and then withdraws it at exactly the right moment. "Nine floors, six let, and the fourth is open if you want to walk it."\n\nHe does not wait for you to ask the obvious thing.\n\n"Yes, it bends. Every floor plate is an arc. It is genuinely a nicer room to work in than a rectangle and I have four minutes of reasons why, and I will spare you three of them."',
          known: '"Back for the fourth?" He already has the pass out. "Thirty, and take as long as you want. Nobody is going to hurry you."',
          familiar: 'He does not do the pitch. He slides the pass across the island and leans on it.\n\n"Go up," he says. "It is a good floor. I would be pleased if one person who was not me thought so."',
        },
        options: [
          { label: 'Which six are let?', next: 'which' },
          { label: 'A viewing pass, then.', next: '__shop__' },
          { label: 'Why does a building bend?', next: 'bend' },
          { label: 'Whose coat is on the chair?', next: 'coat' },
          { label: 'Heard anything?', next: 'gossip' },
          { label: 'Another time.', next: 'bye' },
        ],
      },
      which: {
        text: 'The enthusiasm does not drop but it changes gear, which is the most interesting thing about him.\n\n"I used to answer that." He straightens the pens. "Six floors are contracted. Three of the six have somebody in them. The other three are held by companies that pay the rent and have not moved in, and my instruction is to say six let, which is true."\n\n"You asked, so now you know the shape of it. I would rather you heard it from me than counted the lights from the boulevard, which is what everybody does."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      bend: {
        text: '"Two real reasons and one that is a story." He counts them off and is plainly enjoying it. "The arc puts every desk within nine paces of glass, which a rectangle this deep cannot. And a curve braces itself, so the floor plate needs fewer columns."\n\n"The story is that the architect wanted a building you cannot photograph in one shot, so that you have to come and stand in front of it." He shrugs. "I have no idea if that is true. It does work, though. You walked the length of it outside before you came in. Everybody does."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      coat: {
        text: '"Mine." He says it immediately, which you did not expect. "It has been on that chair for a season and a half."\n\n"An empty floor shows badly. A floor with one coat on it shows like somebody has gone to get a sandwich." He adjusts a pen that does not need it. "It is a cheap trick and it works on about a third of people, and the third it works on are not the third who take the floor. I keep meaning to take it home."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      gossip: {
        text: '"The three companies that pay and do not move in." He keeps his voice at exactly the volume it was. "They have different names and they take the same three floors, and when I send the quarterly to all six tenants, three of them come back inside the minute."\n\n"The same minute. All three." He smiles the professional smile. "Which means one desk somewhere opens all three, and I am a letting agent, so I file it and I do not ask, and you can do what you like with it."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      bye: { text: '"If you come back, come at dusk," he says. "The curve does something with the light off the Spire for about ten minutes and it is the best thing about the building."', options: [] },
    },
  },
});

// ── Bent Double ──────────────────────────────────────────────────────────────
// ⚠ IT IS AT 896,909 AND NOT AT 893,909, WHICH WAS THE FIRST SITING AND WAS WRONG. 893,909 is
// Threshold Helipad — an airfield, carrying `airfield_id`, `hangar_interior_zone` and an `icon`,
// standing on concrete rather than grass. A candidate sweep that tests only `is_building`,
// `curtain` and `terrain === 'road'` passes it, because not one of those is what makes a helipad
// a helipad, and `authorBuilding` then keeps every flag it does not recognise: the facade came
// out carrying `airfield_id: 'af_helipad'`, and the flight-world snapshot dutifully reported
// "Bent Double (af_helipad) @ 893,909 (no runway)" as an airfield.
//
// The rule that catches it: A TILE IS SPOKEN FOR IF IT CARRIES ANY FLAG BEYOND THE ORDINARY
// GROUND SET — terrain, district, region, ambience, street life, a scavenging table. Anything
// else on a tile is somebody else's system holding it, and `sitecheck.mjs` does not test for
// that either. The move also keeps the fiction: this crescent and Curve Appeal are meant to
// meet, and 896 is next door to 897 where 893 was three plots away with a helipad in between.
SPECS.push({
  slug: 'hf_bent', name: 'Bent Double', type: 'chrome_slab',
  x: 896, y: 909, entrance: 'south', floors: 8, marker: 'BN', district: 'halcyon_fields',
  facade: {
    bgColor: '#15222d', color: '#9fe0ff',
    description: 'The crescent\'s twin, one storey shorter and curved the other way, so that where it meets its neighbour the two arcs make a shallow bowl of paving between them that the estate calls a square and nobody else calls anything. The whole ground floor is a physiotherapy practice, which is a joke the practice made first and put on the door.',
  },
  rooms: [
    { key: 'front', name: 'The Waiting Arc', floor: 'linoleum',
      description: 'A long shallow waiting room following the inside of the curve, with chairs down one side and the glass down the other. There is a rail along the wall at hand height for the whole length of it, which is the single most used object in the building and the only thing here that was designed by somebody who thought about it.' },
    { key: 'gym', name: 'The Rehabilitation Room', floor: 'boards',
      from: 'front', dir: 'north',
      description: 'A sprung floor, parallel bars, a wall of mirrors and a ceiling track with a harness on it. Everything is chrome and pale grey except a single rack of coloured bands by the door, and that rack is the brightest object within four streets.' },
  ],
  utility: { name: 'The Undercroft', floor: 'concrete',
    description: 'Below the bowl of paving, between the two crescents, and shared with next door — which is why there are two cabinets on the wall and only one of them is this building\'s. Somebody has painted a line on the floor and written OURS on the correct side of it.' },
  lights: { gym: { name: 'the ceiling track lighting', description: 'Movable heads on the same track the harness runs on, so the light follows the patient down the bars instead of casting their own shadow in front of them. A small thing, and the therapist will tell you it took three letters to get.', lumens: 1000, type: 'fixture' } },
  props: [
    { key: 'rail', room: 'front', name: 'the wall rail', objectType: 'fixture',
      description: 'A chrome rail at hand height running the whole length of the curve, polished bright in the middle third and dull at both ends.',
      flags: { aliases: ['rail', 'handrail'], interactions: { examine: 'The bright part starts at the door and stops exactly where the treatment room begins. You can read how far people can get unaided off the shine.' } } },
    { key: 'desk', room: 'front', name: 'the practice desk', objectType: 'fixture',
      description: 'A low counter at the near end of the arc with an appointment screen, a card tray and a jar of the coloured bands for sale.',
      flags: { aliases: ['desk', 'counter', 'practice'], vendor_safe: true, vendor_npc_id: 'npc_hf_bent_ferreira', hack_difficulty: 4 } },
    { key: 'bars', room: 'gym', name: 'the parallel bars', objectType: 'furniture',
      description: 'Two chrome rails at hip height with four paces of sprung floor between them, and a mirror at the far end so you have to watch yourself do it.',
      flags: { aliases: ['bars', 'parallel'], interactions: { examine: 'There is a strip of grip tape on the left-hand bar and none on the right. Most of the people who come here are recovering from the same operation on the same side.' } } },
  ],
  items: [
    { id: 'item_hf_bent_band', name: 'a resistance band', type: 'misc', value: 26, weight: 30, description: null, flags: {},
      tags: { stackable: true, description: 'A loop of coloured rubber in the only saturated colour in Halcyon Fields. Sold with a card of six exercises on it, four of which people actually do.' } },
    { id: 'item_hf_bent_rub', name: 'a tub of joint rub', type: 'misc', value: 34, weight: 90, description: null, flags: {},
      tags: { stackable: true, description: 'Mixed in the undercroft to the practice\'s own recipe, which is menthol, wintergreen and something the therapist will not name. It works, and it makes the whole waiting room smell like a changing shed.' } },
  ],
  npc: {
    id: 'npc_hf_bent_ferreira', name: 'Xan Ferreira', sex: 'male', hp: 42,
    homeRoom: 'gym', workRoom: 'front', shopName: 'Bent Double',
    description: 'A compact, very strong man of about forty with cropped hair and a physiotherapist\'s particular way of looking at how you came through the door. He worked on chrome rejection cases at the Ascendant clinic for nine years and left, and he will tell you that he left but not why, and the not-why is polite rather than evasive.',
    clothing: ['a plain grey short-sleeved tunic', 'loose dark trousers made to move in', 'flat shoes with no laces', 'plain underthings'],
    inventory: [
      { item_id: 'item_hf_bent_band', price: 26 },
      { item_id: 'item_hf_bent_rub', price: 34 },
    ],
    chitchat: [
      'Ferreira watches somebody come down the rail and does not help, which takes effort.',
      'He coils a band round his hand and puts it back in the jar the right way.',
      'He wipes the left-hand bar down and leaves the right one.',
      'He looks at the appointment screen, counts the afternoon, and rolls one shoulder.',
      'He moves a chair four inches so the gap by the rail is wide enough.',
    ],
    dialogue: {
      root: {
        text: '"Come in." He has already looked at how you walked in. "Sit if you want. I will not ask you what happened unless you want me to."',
        text_by_relation: {
          first: 'The man at the desk watches you the whole way down the arc, and what he is watching is your gait rather than your face.\n\n"Ferreira. Physiotherapy." He does not get up. "You are favouring one side, and before you tell me you are not, everybody says that, and I am right about four times in five."\n\nHe nudges the jar of bands forward.\n\n"I am not going to sell you a course of treatment on your way past. Bands are twenty-six and the card on them is worth more than the rubber. Sit down if you want to sit down."',
          known: '"Same side," he says, without looking up from the screen. "Bands are where they were."',
          familiar: 'He is out from behind the desk before you have got halfway along the arc, and he is looking at your hip.\n\n"Better," he says. "Genuinely better, and I do not say that to be nice. Sit down and let me see the other thing."',
        },
        options: [
          { label: 'Why physiotherapy, here?', next: 'here' },
          { label: 'A band, then.', next: '__shop__' },
          { label: 'You worked at the clinic?', next: 'clinic' },
          { label: 'Why is the rail only shiny in the middle?', next: 'rail' },
          { label: 'Heard anything?', next: 'gossip' },
          { label: 'Another time.', next: 'bye' },
        ],
      },
      here: {
        text: '"Because of what is three streets that way." He tips his head towards the campus without naming it. "People come out of that clinic with hardware in them and a discharge sheet that says the procedure was a success, and it was. Nobody teaches them to walk with it."\n\n"That is not a criticism of surgeons. Surgery is a different job." He shrugs. "Somebody has to be the second appointment, and the second appointment was forty minutes across the city until I put a door here."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      clinic: {
        text: '"Nine years." He says it evenly. "Rejection cases, mostly. I was good at it and they were good to me, and I left, and that is the whole of what I will say about leaving."\n\nHe holds your eye for a second to make sure it lands as a boundary and not as a hint.\n\n"They still send me people. That should tell you it was not a falling out."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      rail: {
        text: '"Because that is how far people can get on their own." He says it with something close to satisfaction. "They come in on the rail, they let go somewhere in the middle third, and they do the last stretch unaided, and the shine stops where the hands stop."\n\n"When somebody is finishing a course, I watch where they let go. It moves back down the arc week by week." He nods at the dull end. "The far end is dull because nobody has ever needed it going out. That is the only chart in this practice and it is screwed to the wall."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      gossip: {
        text: '"I am getting people off the estate now, not just off the campus." He frowns at the screen. "Site workers. Shoulders and backs, which is ordinary, and four of them this season with the same thing in the same hand."\n\n"Not an injury. A tremor, small, and it goes after a fortnight off the tools." He taps the desk twice. "Four is not a pattern. Four is four. But they are all on the same gang and they are all cutting the same material, and I have written that down somewhere I can find it if there is a fifth."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      bye: { text: '"Use the rail on the way out," he says. "Not because you need it. Because it costs you nothing and one day you will."', options: [] },
    },
  },
});

// ── Leaf It Out ──────────────────────────────────────────────────────────────
SPECS.push({
  slug: 'hf_leaf', name: 'Leaf It Out', type: 'pavilion',
  x: 894, y: 915, entrance: 'south', floors: 2, marker: 'LV', district: 'halcyon_fields',
  facade: {
    bgColor: '#122018', color: '#9fe6c0',
    description: 'A glass dome on a chrome ring, two storeys at the crown and wider than it is tall, which in this quarter makes it look like something that landed rather than something that was built. Inside is planting, a gravel path round the inside of the ring and two benches. It is free, it is always open, and it is the only building in Halcyon Fields where nobody will sell you anything.',
  },
  rooms: [
    { key: 'under', name: 'Under the Dome', floor: 'dirt',
      description: 'A single round room full of green, which after four streets of chrome is a physical relief. Ferns at the edges, three young trees that are not going to fit in ten years, and a gravel path following the ring with a bench on either side of it. The glass fogs at the top on a cold morning and clears in a ring from the middle outward.' },
  ],
  utility: { name: 'The Ring Duct', floor: 'concrete',
    description: 'A curved crawl-height service run inside the plinth, holding the irrigation and the lights. It is the only part of this building anybody had to be clever about, and the cabinet is at the point where the ring passes the door.' },
  lights: { under: { name: 'the ground lighting', description: 'Buried in the beds and aimed up through the planting, so the leaves are lit from underneath and the dome reads green from the whole length of the Buried Road. It is the one piece of lighting in the quarter that is not cyan and it was argued for.', lumens: 600, type: 'fixture' } },
  props: [
    { key: 'benches', room: 'under', name: 'the two benches', objectType: 'furniture',
      description: 'Chrome frames with slatted tops, set opposite each other across the path so that two people sitting down have to either look at each other or look past each other.',
      flags: { aliases: ['bench', 'benches', 'seat'], interactions: { sit: 'You sit. Somewhere above you the irrigation ticks over and a fern drips once onto the gravel, and for a moment the quarter outside stops being a quarter.' } } },
    { key: 'trees', room: 'under', name: 'the three young trees', objectType: 'decoration',
      description: 'Planted in a triangle in the middle bed, slender, healthy and already taller than the door.',
      flags: { aliases: ['tree', 'trees'], interactions: { examine: 'They are a species that reaches four times this height. Whoever specified them either knew that and did not care, or intends the dome to come off one day.' } } },
    { key: 'plaque', room: 'under', name: 'the dedication plaque', objectType: 'decoration',
      description: 'A small chrome plate on the inside of the ring by the door, with two lines on it and no name.',
      flags: { aliases: ['plaque', 'plate', 'dedication'], interactions: { examine: 'PUBLIC OPEN SPACE. PROVIDED UNDER CONDITION 14. It is the most honest sign in Halcyon Fields and it was probably not meant to be read that way.' } } },
  ],
  items: [],
  npc: {
    id: 'npc_hf_leaf_arbuckle', name: 'Merrit Arbuckle', sex: 'female', hp: 26,
    homeRoom: 'under', workRoom: 'under', shopName: null,
    description: 'An old woman in a waxed coat on the left-hand bench with a flask beside her and secateurs in her pocket, there most of the day. She is not employed here. She lived on this land when it was a meadow, in a place that is now under the substation, and she comes to the only part of it that still has anything growing on it.',
    clothing: ['a waxed coat gone soft with age', 'two jumpers, the under one older', 'thick trousers and wool socks', 'boots with the laces knotted where they broke'],
    inventory: [],
    chitchat: [
      'Arbuckle pours something from the flask and does not drink it straight away.',
      'She leans forward and takes a dead frond off the nearest bed with her fingers.',
      'She watches the fog clear off the top of the dome in a widening ring.',
      'She looks at the three trees for a while and shakes her head, smiling.',
      'She tucks the secateurs further down in her pocket when somebody comes in.',
    ],
    dialogue: {
      root: {
        text: '"Sit down if you like." She moves the flask an inch. "There are two benches and nobody has ever needed the second one."',
        text_by_relation: {
          first: 'The old woman on the left-hand bench does not look up until you are properly inside, and then looks at you the way you look at weather.\n\n"You are the fourth today," she says. "That is a good day."\n\nShe moves the flask along the bench to make room she did not need to make.\n\n"Merrit Arbuckle. I am not staff. There is no staff. It is a condition of the planning permission and the condition does not run to a person." A pause. "Sit. It is warmer in here than out there and that is also in the condition."',
          known: '"You again." She moves the flask without being asked. "The ferns have gone over on the north side. I have done what I can."',
          familiar: 'She has already moved the flask and turned slightly on the bench by the time you are through the door.\n\n"Come and look at the middle one," she says. "It has put on a hand\'s breadth since you were last here and I have nobody else to tell."',
        },
        options: [
          { label: 'You knew this land before?', next: 'before' },
          { label: 'Who looks after the planting?', next: 'planting' },
          { label: 'Those trees are going to outgrow this.', next: 'trees' },
          { label: 'Heard anything?', next: 'gossip' },
          { label: 'Another time.', next: 'bye' },
        ],
      },
      before: {
        text: '"All of it was a meadow and most of it was nothing." She says it without any weight on it. "There was a road under the middle of it that stopped mattering before I was born, and seedheads over the kerb, and in August you could not see the Curtain for the grass."\n\n"My house was where the substation is. Not near it. Where it is." She turns the flask round. "They paid properly and they paid early and I have no complaint I could put into words, and I come here anyway."',
        options: [{ label: 'Do you resent it?', next: 'resent' }, { label: 'Back.', next: 'root' }],
      },
      resent: {
        text: 'She thinks for a good while, which is the answer.\n\n"No," she says at last. "It is a better quarter than a meadow, for people. I have watched the tea urn on the fifth floor of that tower feed thirty people at six in the morning and a meadow never did that."\n\n"What I mind is that they built a dome and called it open space, and they were right to, and it is the only place left where anything is growing out of the ground it grew out of before." She pats the bench. "So this is where I sit. It is not a protest. It is just where I sit."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      planting: {
        text: '"The irrigation looks after the planting." She sounds unimpressed. "It is very good. It runs at four in the morning and it has never missed."\n\n"Nobody takes the dead stuff off, though, because the irrigation cannot and the condition does not run to a person." She produces the secateurs an inch out of her pocket and puts them back. "So I do. I have never asked and nobody has ever said anything, and I would rather it stayed that way."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      trees: {
        text: '"They will be through that glass in eleven years." She says it with enormous satisfaction. "I looked them up. Somebody specified a forest tree for a dome twenty feet high."\n\n"Now. Either that is the most expensive mistake in the quarter, or somebody in an office decided that in eleven years the dome comes off and this is a garden." She picks up the flask. "I know which one I have decided it is, and I am eighty-one, and I intend to be extremely annoying about it for as long as I can."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      gossip: {
        text: '"The glass sweats in a ring." She points up with one finger. "Cold morning, the whole crown fogs, and it clears from the middle outward in a circle. Every time."\n\n"That is warm air coming up through the middle of this building, and there is nothing in the middle of this building but a bed of ferns." She screws the flask shut. "There is something under the floor here that is warmer than the floor. I have mentioned it to two people in overalls and they both said the irrigation, and the irrigation runs cold."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      bye: { text: '"Pull the door to behind you," she says. "It does not latch and the heat goes straight out of the gap, and the heat is not mine to waste."', options: [] },
    },
  },
});

// ── run ──────────────────────────────────────────────────────────────────────
for (const spec of SPECS) {
  const r = await authorBuilding(store, spec);
  console.log(`  ${spec.name.padEnd(22)} ${spec.x},${spec.y}  ent=${String(spec.entrance).padEnd(5)} fl=${String(spec.floors).padStart(2)}  ${r.facadeId}`);
}
const written = store.flush({ dryRun: DRY });
console.log(`\n${DRY ? 'DRY RUN — ' : ''}${written.length} file(s) ${DRY ? 'would change' : 'written'}`);
if (store.droppedRuntime.length) console.log(`  (dropped ${store.droppedRuntime.length} runtime write(s))`);
