/**
 * Halcyon Fields, batch 5 — the second campaign, east of Kettle Lane and along the Buried Road.
 *
 * Seven buildings on the service side: two vertical farms, a crescent, a pavilion, two halts
 * and a tower for the people who run the plant. Run after batch0 and batches 1–4.
 *
 * ⚠ THE HALTS ARE STATIONS WITH NO LINE, AND THAT IS CONTENT RATHER THAN AN OVERSIGHT. The
 * platform is built, the canopy is up, the board is powered and reads SERVICE COMMENCING, and
 * there is no railway in the Coldwater Basin. Nothing in the world model needs one for the
 * building to work — it is a room you can stand in out of the rain — and the gap between what
 * the hoarding on Kettle Lane shows and what is actually on the ground is the whole quarter's
 * argument in one object. Do not "fix" it by laying track.
 *
 *   node scripts/content/halcyon/batch5.mjs [--dry-run]
 */
import { authorBuilding, loadContentStore } from './lib.mjs';

const DRY = process.argv.includes('--dry-run');
const store = loadContentStore();
const SPECS = [];

// ── Salad Days ───────────────────────────────────────────────────────────────
SPECS.push({
  slug: 'hf_salad', name: 'Salad Days', type: 'vertical_farm',
  x: 898, y: 911, entrance: 'east', floors: 10, marker: 'SY', district: 'halcyon_fields',
  facade: {
    bgColor: '#1a1424', color: '#e07ad8',
    description: 'A chrome column with glazed growing trays cantilevered off it in opposed pairs, six pairs up, each one lit magenta from under the tray above. After dark it is the only thing in the quarter that is not cyan or pearl, and from Kettle Lane it reads as a ladder of pink rungs going up into nothing. The smell at the door is wet peat and cut leaves and it does not belong to any other building on this street.',
  },
  rooms: [
    { key: 'pack', name: 'The Packing Floor', floor: 'concrete',
      description: 'The foot of the core: a cold, bright room with a stainless run down one wall, crates stacked to the ceiling on the other, and the lift shaft in the middle with its doors open. Everything in here is damp and nothing in here is dirty. The floor slopes very slightly to a drain and you can feel it through your boots.' },
    { key: 'tray', name: 'The Fourth Tray', floor: 'metal', from: 'pack', dir: 'up',
      description: 'A glazed box the size of a long room, cantilevered off the core with the city on three sides of it, and racked floor to ceiling with growing channels. The light is magenta and absolute and it makes everybody in here look ill. Between the racks it is exactly wide enough for one person and a trolley, and the air is warm and smells overwhelmingly green.' },
  ],
  utility: { name: 'The Core Pumps', floor: 'concrete',
    description: 'Inside the base of the column, where the water for ten floors of racks starts. Three pumps, a mixing tank and a lot of very well-labelled pipework. The cabinet is on the one flat wall, above the high-water mark somebody has drawn in marker and dated.' },
  lights: { tray: { name: 'the grow lights', description: 'Full-width magenta arrays under every shelf, on eighteen hours a day. They are the reason this building is findable from anywhere in the quarter and they are also the reason nobody who works here can judge the colour of anything for an hour after a shift.', lumens: 1400, type: 'fixture' } },
  props: [
    { key: 'run', room: 'pack', name: 'the packing run', objectType: 'fixture',
      description: 'A long stainless bench with a water line over it, a set of scales at one end and a stack of flat crates at the other.',
      flags: { aliases: ['run', 'bench', 'packing'], vendor_safe: true, vendor_npc_id: 'npc_hf_salad_okonjo', hack_difficulty: 4 } },
    { key: 'crates', room: 'pack', name: 'the crate stack', objectType: 'decoration',
      description: 'Shallow chrome-framed crates, washed, stacked eleven high against the wall, every one stencilled with a delivery address.',
      flags: { aliases: ['crates', 'stack'], interactions: { examine: 'Almost every crate is stencilled for the Spire, or for a floor of it. Two at the bottom of the stack say Light Relief, fifth floor, and those two are the ones that are scuffed.' } } },
    { key: 'racks', room: 'tray', name: 'the growing racks', objectType: 'furniture',
      description: 'Channels of running water in tiers, with leaves out of both sides of every channel and a magenta array a hand\'s breadth above each one.',
      flags: { aliases: ['racks', 'channels', 'rack'], interactions: { examine: 'The water in the channels is moving faster than you would expect, and it is completely clear. There is no soil anywhere in this building.' } } },
  ],
  items: [
    { id: 'item_hf_salad_leaves', name: 'a bag of cut leaves', type: 'food', value: 18, weight: 60, description: null, flags: {},
      tags: { stackable: true, description: 'Cut an hour ago, ten floors above where you are standing, and still cold. Nothing else sold in the Basin at this price has ever been in the ground and neither has this, which is the point.' } },
    { id: 'item_hf_salad_herbs', name: 'a pot of living herbs', type: 'food', value: 32, weight: 140, description: null, flags: {},
      tags: { stackable: true, description: 'Sold in the channel plug it grew in, roots and all, so it keeps going on a windowsill for a season if you remember it. Most people do not.' } },
  ],
  npc: {
    id: 'npc_hf_salad_okonjo', name: 'Adaeze Okonjo', sex: 'female', hp: 36,
    homeRoom: 'tray', workRoom: 'pack', shopName: 'Salad Days',
    description: 'A wiry woman in her thirties in a waterproof apron, hands red from the cold run, working fast and talking at the same speed. She grew up on a farm outside the Basin that no longer exists and she is entirely unsentimental about soil, which surprises people who expect the opposite.',
    clothing: ['a heavy waterproof apron over everything', 'a long-sleeved thermal top pushed to the elbow', 'work trousers tucked into short rubber boots', 'plain underthings'],
    inventory: [
      { item_id: 'item_hf_salad_leaves', price: 18 },
      { item_id: 'item_hf_salad_herbs', price: 32 },
    ],
    chitchat: [
      'Okonjo weighs a crate, writes on it, and slides it down the run without looking.',
      'She rinses her hands under the water line and shakes them once, hard.',
      'The lift goes up empty and comes down full. She has the crates off it before it stops.',
      'She holds a leaf up to the light, looks at the underside, and puts it in the crate anyway.',
      'She wipes the scales down between weighings, every time, without thinking about it.',
    ],
    dialogue: {
      root: {
        text: '"Leaves are eighteen, herbs are thirty-two, and the herbs are alive so do not leave them in a bag." She keeps packing. "Ask away, I can do both."',
        text_by_relation: {
          first: 'The room is cold and bright and smells like rain on leaves, and the woman at the run does not stop working when you come in.\n\n"You are not a delivery," she says, "so you are either lost or buying. Both are fine."\n\nShe slides a crate along and starts another.\n\n"Okonjo. Ten floors of racks over your head and all of it comes down that lift. Leaves eighteen, herbs thirty-two. The herbs are alive. People take them home in a bag and kill them by evening, so I say it twice."',
          known: '"Leaves or herbs." She is already reaching. "And do not put the herbs in a bag."',
          familiar: 'She has the pot out and wrapped before you have crossed the floor, and pushes it at you with her forearm because her hands are wet.\n\n"That one is from the fourth," she says. "Best tray in the building. I am not meant to pick which tray anybody gets."',
        },
        options: [
          { label: 'No soil at all?', next: 'soil' },
          { label: 'Leaves, then.', next: '__shop__' },
          { label: 'Who eats all this?', next: 'eats' },
          { label: 'Why is it pink?', next: 'pink' },
          { label: 'Heard anything?', next: 'gossip' },
          { label: 'Another time.', next: 'bye' },
        ],
      },
      soil: {
        text: '"None. Not a handful in the building." She is not defensive about it at all. "Water, plant food, light, and the roots sit in the channel."\n\n"People want me to be sad about that. I grew up on dirt. Dirt is a nightmare — it has weather in it, and weevils, and it takes a year to tell you it failed." She weighs a crate. "This tells me in a day. I like it better and I am allowed to."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      eats: {
        text: '"Look at the crates." She nods at the stack without turning. "Read the stencils."\n\n"The Spire, the Spire, a floor of the Spire, the Spire. Ninety per cent of what leaves this building goes three streets that way and up." She shrugs. "It was built to feed a tower. That is not a secret, it is in the name of the contract."\n\n"The bit I like is the two at the bottom that say Light Relief. Fifth floor. Thirty people at six in the morning. That crate goes out every day and it is the one I load myself."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      pink: {
        text: '"Because the green is wasted on them." She taps a leaf. "A leaf throws green away — that is why it looks green. Give it red and blue and it uses nearly the lot, and red and blue together is that colour."\n\n"It is the most efficient light in the Basin and it makes everybody look like a corpse. I have stopped noticing." She glances at her own hands under it. "Mostly."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      gossip: {
        text: '"My water bill." She says it like a joke and then does not laugh. "I draw off the main on Kettle Lane, same as the glasshouse across the road. Metered, and I read it myself every week because I am careful."\n\n"Since the spring my meter says I am drawing about a fifth more than the racks use, and the racks are the only thing on my side of the valve." She rinses her hands. "Either my meter is wrong, or something between the main and my pumps is taking water, and I have had a man out and he says the meter is right."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      bye: { text: '"Out through the yard," she says. "And if the herbs wilt, stand the pot in a saucer of water and do not apologise to me about it."', options: [] },
    },
  },
});

// ── Root Cause ───────────────────────────────────────────────────────────────
SPECS.push({
  slug: 'hf_root', name: 'Root Cause', type: 'vertical_farm',
  x: 901, y: 914, entrance: 'east', floors: 10, marker: 'RT', district: 'halcyon_fields',
  facade: {
    bgColor: '#1a1424', color: '#e07ad8',
    description: 'The second of the two farms, identical to the first and turned a quarter turn, so the pair of them on either side of Kettle Lane spiral in opposite directions and the trays never line up. This one is not growing food. The trays are half empty, the lights are on anyway, and the door carries a research licence from the Ascendant campus with a number and no description of what is being researched.',
  },
  rooms: [
    { key: 'lab', name: 'The Analysis Floor', floor: 'tile',
      description: 'Where the packing room is in the other farm, this is benches: scales that read to four places, a rack of sample jars, two sinks and a printer that runs all day. It is very clean and very quiet and the only sound is the printer and the pumps in the wall.' },
    { key: 'trial', name: 'The Trial Tray', floor: 'metal', from: 'lab', dir: 'up',
      description: 'A growing tray with eleven channels running and twenty-nine empty, every live channel tagged with a number, and a second set of tags in a different colour on four of them. Between the racks somebody has taped a strip of paper to the floor with a date on it every hand\'s breadth, which appears to be measuring something that has been getting slowly closer to the window.' },
  ],
  utility: { name: 'The Sample Cellar', floor: 'concrete',
    description: 'Inside the base of the column, cold, with the pumps on one side and a locked cabinet of jars on the other going back three seasons. The building\'s own cabinet is beside the door, and it is the only one in the room that is not locked.' },
  lights: { trial: { name: 'the trial arrays', description: 'The same magenta arrays as the other farm, run at four different intensities over four groups of channels, which is why this building flickers very slightly from the road and the one across the street does not.', lumens: 1400, type: 'fixture' } },
  props: [
    { key: 'bench', room: 'lab', name: 'the analysis bench', objectType: 'fixture',
      description: 'A long bench with four-place scales under a draught shield, a rack of numbered jars, and a printer that has been running long enough to fill a box.',
      flags: { aliases: ['bench', 'scales', 'lab'], vendor_safe: true, vendor_npc_id: 'npc_hf_root_venn', hack_difficulty: 7 } },
    { key: 'jars', room: 'lab', name: 'the sample rack', objectType: 'decoration',
      description: 'Sixty small jars in a chrome rack, each with a number, a date and a line of water in the bottom of it.',
      flags: { aliases: ['jars', 'rack', 'samples'], interactions: { examine: 'The numbers are not sequential. They are grid references, and all of them are in the Basin, and the newest four are very close together.' } } },
    { key: 'tape', room: 'trial', name: 'the taped strip', objectType: 'decoration',
      description: 'A strip of paper taped down the walkway between the racks, marked off with dates going back most of a year and a pencil line at each one.',
      flags: { aliases: ['tape', 'strip', 'paper'], interactions: { examine: 'The lines get closer together as the dates get more recent, which means whatever is being measured is not just moving, it is speeding up.' } } },
  ],
  items: [
    { id: 'item_hf_root_kit', name: 'a water sampling kit', type: 'misc', value: 65, weight: 120, description: null, flags: {},
      tags: { stackable: true, description: 'Four sterile jars, a grease pencil, a card of instructions and a reply label addressed to this building. The instructions are clear, polite and do not say what is being tested for.' } },
    { id: 'item_hf_root_reading', name: 'a bench reading', type: 'misc', value: 48, weight: 4, description: null, flags: {},
      tags: { stackable: true, description: 'A printed slip giving the analysis of one sample: eleven figures, nine of them within a stated range and printed in black, two of them outside it and printed in black as well, because the printer does not know which is which.' } },
  ],
  npc: {
    id: 'npc_hf_root_venn', name: 'Corliss Venn', sex: 'male', hp: 30,
    homeRoom: 'trial', workRoom: 'lab', shopName: 'Root Cause',
    description: 'A thin, grey, unhurried man of about sixty in a lab coat over ordinary clothes, standing at the bench with a jar in his hand and the patience of somebody who has been waiting a year for a number to mean something. He answers questions completely and volunteers nothing, and it takes a while to notice that those are two different habits.',
    clothing: ['a lab coat, clean, with the top button missing', 'a cardigan under it in a colour nobody chose recently', 'grey trousers', 'plain underthings'],
    inventory: [
      { item_id: 'item_hf_root_kit', price: 65 },
      { item_id: 'item_hf_root_reading', price: 48 },
    ],
    chitchat: [
      'Venn holds a jar up to the light, turns it, and writes nothing down.',
      'The printer produces another slip. He does not look at it.',
      'He washes his hands at the near sink and dries them one finger at a time.',
      'He moves a jar from one end of the rack to the other and stands looking at the gap.',
      'He glances up at the ceiling, towards the trial tray, and goes back to the bench.',
    ],
    dialogue: {
      root: {
        text: '"Good afternoon." He sets the jar down carefully. "This is a licensed facility. You may be in this room and not the one above it."',
        text_by_relation: {
          first: 'A grey man in a lab coat looks up from a bench of scales as you come in, and waits for the door to close before he speaks.\n\n"Good afternoon. Corliss Venn."\n\nHe puts the jar in the rack, in a specific gap.\n\n"You have come into a licensed facility, which you are permitted to do — the licence is on the door and it covers this floor. The tray above us it does not cover, and I will stop you at the lift, politely, and you will not enjoy arguing with me about it because I will simply keep saying the same sentence."',
          known: '"Afternoon." He is already reaching for a kit. "Same four jars. Fill them from different places this time."',
          familiar: 'He has the kit out and the reply label already written before you have said anything, which is the closest this man comes to warmth.\n\n"Your last four were interesting," he says. "That is not a compliment and it is not nothing."',
        },
        options: [
          { label: 'What are you testing for?', next: 'testing' },
          { label: 'A sampling kit, then.', next: '__shop__' },
          { label: 'Why grow anything at all here?', next: 'grow' },
          { label: 'What is the taped strip upstairs?', next: 'strip' },
          { label: 'Heard anything?', next: 'gossip' },
          { label: 'Another time.', next: 'bye' },
        ],
      },
      testing: {
        text: '"Water." He says it as a complete answer and then, after a moment, decides to give you more. "Basin water. Mains, standing, run-off and bore, from sixty points, over three seasons."\n\n"For what, I am not going to tell you, and the reason is not secrecy. It is that if I tell you what I am looking for, you will find it, in the way that people do." He indicates the rack. "I would rather have your four jars than your opinion. I will pay for the jars."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      grow: {
        text: '"Because a plant is a better instrument than a scale." He almost warms up. "I can measure a part in a million in the water on that bench. The rack upstairs will tell me what a part in a million does over eleven weeks to something that was alive at the start of them."\n\n"Eleven channels running and twenty-nine empty, all fed from different sources. The empty ones are not a shortage of seed." He lets that sit. "They are the ones where nothing came up."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      strip: {
        text: 'He looks at the ceiling for a second before he answers, and what crosses his face is not evasion.\n\n"There is a line of discolouration in the concrete of that floor, running from the core out towards the south glazing. I have marked its leading edge every fortnight for a year."\n\n"When I started, it moved a finger\'s width in a fortnight. It is now moving that in four days." He picks the jar back up. "I have reported it. The report went to the campus and the campus sent a structural engineer, who looked at it and said it was efflorescence, which it is not, because efflorescence does not accelerate."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      gossip: {
        text: '"The woman across the road is drawing a fifth more water than her racks use." He says it without being asked about her. "She has told me. She told me because she thought it was her meter."\n\n"My meter says the same thing. So does the glasshouse on the Buried Road, which I checked without asking anybody, and I am not proud of how." He sets the jar down. "Three buildings on one main, all reading high, all with a good meter. That is not three faults. That is a fourth draw-off between us and the main, and there is nothing on the drawings between us and the main."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      bye: { text: '"Fill the jars to the shoulder and not to the brim," he says. "Air in the top ruins them and everybody does it."', options: [] },
    },
  },
});

// ── Sweeping Statement ───────────────────────────────────────────────────────
SPECS.push({
  slug: 'hf_sweep', name: 'Sweeping Statement', type: 'chrome_slab',
  x: 904, y: 915, entrance: 'south', floors: 7, marker: 'SB', district: 'halcyon_fields',
  facade: {
    bgColor: '#16232f', color: '#9fe0ff',
    description: 'A seven-storey crescent on the Buried Road, curved to follow a street that does not curve, which is the kind of decision that only makes sense from the air. It is the estate\'s own office: the people who draw Halcyon Fields work in it, and the ground floor is a model room with the whole quarter laid out in it at a scale where the buildings are the size of your thumb.',
  },
  rooms: [
    { key: 'model', name: 'The Model Room', floor: 'carpet',
      description: 'A long curved room with the whole estate on a table down the middle of it, built at a scale where the Spire comes to your shoulder. Every building is there. Some of them are a different colour from the rest and there is no key on the table explaining which colour means what.' },
    { key: 'drawing', name: 'The Drawing Office', floor: 'carpet', from: 'model', dir: 'up',
      description: 'The floor above, following the same arc: two long ranks of desks facing the glass, plan chests down the inner wall, and a smell of print. About half the desks are occupied and all of them are tidy in the particular way of people whose work is checked.' },
  ],
  utility: { name: 'The Print Room', floor: 'concrete',
    description: 'At the foot of the building where the three segments meet, with the plotter, the paper store and everything the building runs on. The cabinet is on the flat wall and somebody has taped a phase programme up beside it that is two seasons out of date.' },
  lights: { drawing: { name: 'the desk task lights', description: 'One articulated head per desk, aimed at the board rather than at the room, so from the Buried Road the whole first floor reads as a row of separate small lights and not as a lit office. It is the most flattering thing the estate has ever done to one of its own buildings by accident.', lumens: 900, type: 'lamp' } },
  props: [
    { key: 'table', room: 'model', name: 'the estate model', objectType: 'fixture',
      description: 'The whole of Halcyon Fields at a scale you could lean over, streets and all, with the Curtain along two sides of it as a strip of frosted acrylic.',
      flags: { aliases: ['model', 'table', 'estate'], interactions: { examine: 'The verge plots between the finished buildings are modelled as grass, neatly, with a fence round each one. On the ground there is no fence round any of them.' } } },
    { key: 'counter', room: 'model', name: 'the enquiry counter', objectType: 'fixture',
      description: 'A short chrome run by the door with a visitor book, a tray of settlement pens and a bell that has been taped down.',
      flags: { aliases: ['counter', 'enquiry', 'desk'], vendor_safe: true, vendor_npc_id: 'npc_hf_sweep_delacroix', hack_difficulty: 6 } },
    { key: 'chests', room: 'drawing', name: 'the plan chests', objectType: 'furniture',
      description: 'Twelve wide shallow drawers down the inner wall, each labelled with a phase number, and every one of them locked except the top.',
      flags: { aliases: ['chests', 'chest', 'plans', 'drawers'], hack_difficulty: 8, interactions: { examine: 'The labels run from PHASE 1 to PHASE 9. There are twelve drawers.' } } },
  ],
  items: [
    { id: 'item_hf_sweep_plan', name: 'a phase plan print', type: 'misc', value: 55, weight: 30, description: null, flags: {},
      tags: { stackable: true, description: 'A folded plot of the estate as approved, with the built parts hatched and the rest shown as outline. It is the only public drawing of Halcyon Fields and it stops at the boundary of phase four.' } },
    { id: 'item_hf_sweep_pen', name: 'a drawing-office pencil', type: 'misc', value: 9, weight: 4, description: null, flags: {},
      tags: { stackable: true, description: 'Hard lead, hexagonal, with the estate mark and a grade stamped on it. The drawing office gets through a box a week and sells the overrun at the counter because somebody worked out they could.' } },
  ],
  npc: {
    id: 'npc_hf_sweep_delacroix', name: 'Sylvie Delacroix', sex: 'female', hp: 28,
    homeRoom: 'drawing', workRoom: 'model', shopName: 'Sweeping Statement',
    description: 'A precise woman in her fifties in a soft grey suit, standing at the end of the model table with her hands behind her back like somebody presenting. She has drawn some of what is on that table and she is genuinely proud of it, and she answers questions about the parts she drew at length and questions about the rest in one sentence.',
    clothing: ['a soft grey suit, well made, worn every day', 'a cream blouse', 'low practical shoes', 'plain underthings'],
    inventory: [
      { item_id: 'item_hf_sweep_plan', price: 55 },
      { item_id: 'item_hf_sweep_pen', price: 9 },
    ],
    chitchat: [
      'Delacroix moves a thumb-sized building half a millimetre and steps back.',
      'She walks the length of the model looking at it from the low side.',
      'She checks the taped-down bell, which is still taped down.',
      'She writes a date on the visitor book page and rules a line under it.',
      'She looks at one of the differently-coloured buildings for a moment longer than the others.',
    ],
    dialogue: {
      root: {
        text: '"Come in, look at it properly." She gestures down the table. "It is meant to be leaned over. That is the whole point of a model."',
        text_by_relation: {
          first: 'The room is longer than it looks and curves away, and the whole of it is taken up by a model of the quarter you have just walked through.\n\n"Lean over it." The woman at the far end says it before she introduces herself. "Everybody stands at the end and squints. Come to the side and get your eye down to street level and it stops being a map."\n\nShe waits until you have.\n\n"Sylvie Delacroix. I drew the crescents and the pavilion. Somebody else drew the towers, and I will not be drawn on the towers."',
          known: '"Back at the table." She steps aside to give you the low side. "Look at the halt again. I have moved something."',
          familiar: 'She has already moved round to the far side so that you get the good angle, and she does it without comment, which is how you know.\n\n"Go on," she says. "Tell me what has changed since last time. Two people have got it and neither of them worked here."',
        },
        options: [
          { label: 'Why are some buildings a different colour?', next: 'colour' },
          { label: 'A phase plan, then.', next: '__shop__' },
          { label: 'There are twelve drawers and nine phases.', next: 'drawers' },
          { label: 'Why build a station with no line?', next: 'halt' },
          { label: 'Heard anything?', next: 'gossip' },
          { label: 'Another time.', next: 'bye' },
        ],
      },
      colour: {
        text: '"Built, building, and consented." She points to three of them in turn without hesitating. "Grey is up, pale is on site, and white is approved and not started."\n\n"There is no key because the model was made for a room where somebody always stood beside it and said that sentence." She smiles slightly. "I am that somebody. I have asked for a key twice. I am told the key spoils the object."',
        options: [{ label: 'And the fourth colour?', next: 'fourth' }, { label: 'Back.', next: 'root' }],
      },
      fourth: {
        text: 'The pause is short and she does not pretend it was not there.\n\n"There is no fourth colour on this model," she says. "There are three."\n\nShe moves her hand very slightly, and you notice that it is resting between you and a building at the east end of the table that is neither grey nor pale nor white.\n\n"You have a good eye," she adds, pleasantly, "and I have answered the question I am able to answer."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      drawers: {
        text: '"Yes." She does not look up at the ceiling and you can tell she wants to. "The chests were bought for a scheme with twelve phases and the consent is for nine."\n\n"That is not sinister. It is a furniture order placed before a planning decision, which happens on every job I have ever worked on." A beat. "The three at the bottom are locked and empty and I have not looked in them for four years, which is either discipline or cowardice and I genuinely do not know which."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      halt: {
        text: '"Because you build the hard thing while the ground is open." She says this with complete conviction and it is a good answer. "A halt needs foundations under a street. Once the street is surfaced and let and there are people living on it, putting those in costs four times as much and shuts the quarter for a season."\n\n"So it goes in first, and it stands there looking ridiculous for however long the line takes." She straightens. "I drew it. I would draw it again. And yes, I am aware of what the board on it says, and no, I did not write that."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      gossip: {
        text: '"The four verge plots." She indicates them on the model with one finger, not touching. "Modelled as grass, with a fence round each. There has never been a fence round any of them on the ground."\n\n"Somebody put those fences on this model. Somebody has drawn a boundary round four pieces of land and then not built the boundary." She puts her hands behind her back again. "In my trade that usually means the land is spoken for by somebody who has not decided whether to say so yet. It is on the model because the model is honest. It is not on the site because the site is public."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      bye: { text: '"Take a plan," she says. "It is accurate to the boundary of phase four, and I will not pretend that is the same as accurate."', options: [] },
    },
  },
});

// ── Frond Memories ───────────────────────────────────────────────────────────
SPECS.push({
  slug: 'hf_frond', name: 'Frond Memories', type: 'pavilion',
  x: 906, y: 917, entrance: 'north', floors: 2, marker: 'FD', district: 'halcyon_fields',
  facade: {
    bgColor: '#122018', color: '#9fe6c0',
    description: 'The second dome, on the service side of the Buried Road, and the only green thing between the cooling plant and the gasholder. It was built to the same drawing as its twin and it is warmer inside, because the waste main from the plant runs under it on the way to the glasshouse and somebody had the sense to take a tap off it. The planting here is twice the size of the planting in the other one.',
  },
  rooms: [
    { key: 'under', name: 'Under the Second Dome', floor: 'dirt',
      description: 'Hot, wet air and a great deal more green than the drawing intended. The ferns have gone up the inside of the glass on the north side and somebody has run wires for them. The gravel path is barely a path any more. Through the leaves on the south side you can see the cooling plant\'s deck standing on its legs, and the two things look like they belong on different planets.' },
  ],
  utility: { name: 'The Heat Tap', floor: 'concrete',
    description: 'A crawl-height room in the ring where the waste main from the cooling plant passes under the dome, with a small take-off, a valve and a great deal of lagging. It is the hottest room in Halcyon Fields by a long way. The cabinet is as far from the pipe as the room allows.' },
  lights: { under: { name: 'the bed lighting', description: 'The same buried uplighters as the other dome, most of them now completely overgrown, so the light comes up through a foot of leaf before it reaches the glass and the whole building glows a deeper green than its twin. Nobody has cut anything back to fix this.', lumens: 500, type: 'fixture' } },
  props: [
    { key: 'wires', room: 'under', name: 'the training wires', objectType: 'decoration',
      description: 'Fine wires run up the inside of the north glazing in a fan, with fern fronds tied in along them at intervals with garden twine.',
      flags: { aliases: ['wires', 'twine', 'training'], interactions: { examine: 'The ties are neat, recent and all in the same hand. Whoever is doing this is doing it carefully and is not being paid for it.' } } },
    { key: 'valve', room: 'under', name: 'the heat tap wheel', objectType: 'fixture',
      description: 'A small chrome handwheel on a lagged stub coming up through the bed at the edge of the path, with a temperature dial beside it.',
      flags: { aliases: ['valve', 'wheel', 'tap'], hack_difficulty: 3, interactions: { examine: 'The dial reads a good deal higher than the drawing beside it says it should, and somebody has pencilled the higher number onto the drawing and circled it.' } } },
    { key: 'bench', room: 'under', name: 'the remaining bench', objectType: 'furniture',
      description: 'One of the two benches. The other is under the planting somewhere and has not been seen for a season.',
      flags: { aliases: ['bench', 'seat'], interactions: { sit: 'You sit in wet heat under a great deal of leaf, and the gasholder and the cooling plant might as well be in another city.' } } },
  ],
  items: [],
  npc: {
    id: 'npc_hf_frond_hallowes', name: 'Teague Hallowes', sex: 'male', hp: 34,
    homeRoom: 'under', workRoom: 'under', shopName: null,
    description: 'A heavy-set man in his forties in cooling-plant overalls with the sleeves cut off, sitting on the remaining bench with his boots off. He works the fan deck across the road, he comes in here on his breaks, and at some point he started tying ferns to wires and has not stopped. He is faintly embarrassed about it and entirely unwilling to stop.',
    clothing: ['plant overalls with the sleeves cut off at the shoulder', 'a vest gone grey from washing', 'heavy trousers, the overall legs rolled', 'socks, with the boots beside him'],
    inventory: [],
    chitchat: [
      'Hallowes ties in a frond, tests it with one finger, and leaves it.',
      'He looks at the dial by the valve and does not touch the wheel.',
      'He wipes his face with the back of his arm. It is very warm in here.',
      'He pulls a boot on halfway and then takes it off again.',
      'He looks out through the leaves at the fan deck and checks the time.',
    ],
    dialogue: {
      root: {
        text: '"Shut the door." He does not get up. "Heat goes out of it in about a minute and takes a fortnight to come back."',
        text_by_relation: {
          first: 'The heat hits you first, and then the green, and then a large man with his boots off on the only visible bench.\n\n"Shut the door," he says, not unkindly. "That is not me being territorial, it is how long it takes to get the heat back."\n\nHe shifts along a little.\n\n"Hallowes. I am on the deck across the road. This is not my building and I do not work here and nobody works here. Sit down if you can find anywhere."',
          known: '"Door," he says, before anything else. "Then sit."',
          familiar: 'He has already shifted along the bench and pushed his boots under it before you are through the door.\n\n"Look at the north side," he says. "Two feet since you were here. Two feet."',
        },
        options: [
          { label: 'Are you meant to be doing the ferns?', next: 'ferns' },
          { label: 'Why is it so hot in here?', next: 'hot' },
          { label: 'What is it like working the deck?', next: 'deck' },
          { label: 'Heard anything?', next: 'gossip' },
          { label: 'Another time.', next: 'bye' },
        ],
      },
      ferns: {
        text: '"No." He says it flatly and then, after a moment, less flatly. "Nobody is meant to be doing anything in here. It is a condition. There is no gardener."\n\n"I sat in here on a break about a year ago and there was a frond down on the path and I put it back up. And then there was another one." He shrugs with his whole upper body. "Now I buy twine. I am not going to pretend that is not what has happened."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      hot: {
        text: '"Because I take heat off the waste main." He points at the floor with his chin. "It runs under this building on its way to the glasshouse, and when they laid it they put a stub up into the ring with a wheel on it, and they never connected anything to the stub."\n\n"So I connected the stub to the room." A pause. "Nobody has said anything. The main is carrying heat somebody has already paid to make and is throwing away at the far end. I am not stealing it, I am catching it before it gets wasted, and I have had that argument in my head enough times to say it that quickly."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      deck: {
        text: '"Loud, cold and high up." He grins. "Eight fans on a plate on legs and nothing under you but air. You get used to the noise in a week and the height never."\n\n"It is a good job. The plant is built like a bank — everything on it is finished to a standard I have not seen on any site I have worked." He rubs his thumb along the bench frame. "That is the bit that gets me. They built a fan deck like a bank. Somebody very badly does not want that plant to stop."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      gossip: {
        text: '"The load." He sits forward. "The deck sheds heat for the campus. I have run that plate for three years and I know what a normal night looks like on the gauges."\n\n"Since about the spring we are shedding more, and it is not hotter and the campus has not grown." He turns a hand over. "More heat is coming into my plate than the campus makes. Which means something else is on the loop that is not on my drawing, and it is putting out about as much as a whole floor of the Spire."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      bye: { text: '"Door," he says again, without any heat in it at all. "Please."', options: [] },
    },
  },
});

// ── Standing Room Only ───────────────────────────────────────────────────────
SPECS.push({
  slug: 'hf_standing', name: 'Standing Room Only', type: 'transit_halt',
  x: 893, y: 917, entrance: 'north', floors: 2, marker: 'SM', district: 'halcyon_fields',
  facade: {
    bgColor: '#141f2a', color: '#bfe8ff',
    description: 'A chrome canopy on four slim columns over a platform up on legs, with a stair at one end and a glazed waiting room on the deck. The indicator board on the canopy fascia is lit and reads SERVICE COMMENCING. There is no line. There is no track bed, no cutting, no embankment and nothing on the ground either side of it but the Buried Road, and the whole thing is finished to the standard of everything else in the quarter.',
  },
  rooms: [
    { key: 'platform', name: 'The Platform', floor: 'metal',
      description: 'A chrome deck a storey up with a canopy over it and a very good view in both directions along a route nothing runs on. The tactile strip is laid along both edges, correctly, in the right colour. At the far end there is a bench and a bin and a timetable case with nothing in the case.' },
    { key: 'waiting', name: 'The Waiting Room', floor: 'tile', from: 'platform', dir: 'east',
      description: 'A glazed box on the deck, warm, with a bench round three sides and a heater that works. On a wet night it is the driest free room in Halcyon Fields and there are usually two or three people in it who are not waiting for anything.' },
  ],
  utility: { name: 'The Undercroft Kiosk', floor: 'concrete',
    description: 'A room under the platform between the legs, drawn as a ticket office and never fitted out as one. It has a counter frame, no counter, and the building\'s cabinet on the back wall, which makes it the best-lit empty room on the estate.' },
  lights: { waiting: { name: 'the waiting room lighting', description: 'A single panel in the ceiling, on a sensor, which comes up when somebody steps in and stays up for eleven minutes. It is the most welcoming object in the quarter and it was specified by somebody who has waited for a train in the rain.', lumens: 800, type: 'fixture' } },
  props: [
    { key: 'board', room: 'platform', name: 'the indicator board', objectType: 'fixture',
      description: 'A lit panel on the canopy fascia, working perfectly, showing two lines of text that have not changed since it was energised.',
      flags: { aliases: ['board', 'indicator', 'sign'], hack_difficulty: 6, interactions: { examine: 'SERVICE COMMENCING. PLEASE STAND BEHIND THE YELLOW LINE. The second line is the one that gets to people.' } } },
    { key: 'case', room: 'platform', name: 'the timetable case', objectType: 'decoration',
      description: 'A glazed frame beside the stair head, locked, with a clean white backing board in it and nothing on the board.',
      flags: { aliases: ['case', 'timetable', 'frame'], interactions: { examine: 'The backing board is unmarked and the glass is polished. Somebody cleans this case.' } } },
    { key: 'bench', room: 'waiting', name: 'the waiting bench', objectType: 'furniture',
      description: 'A continuous bench round three sides of the glazed room, with the heater under the long side.',
      flags: { aliases: ['bench', 'seat'], vendor_safe: true, vendor_npc_id: 'npc_hf_standing_pell', hack_difficulty: 3,
        interactions: { sit: 'You sit on the warm side, because everybody does, and outside the glass the rain does something you are no longer part of.' } } },
  ],
  items: [
    { id: 'item_hf_standing_flask', name: 'a flask of something hot', type: 'drink', value: 6, weight: 240, description: null, flags: {},
      tags: { stackable: false, description: 'Poured out of a flask on a bench by a man who brings two flasks and only ever needs one. Six credits, which is what the flask costs him, divided by how many cups are in it.' } },
    { id: 'item_hf_standing_ticket', name: 'a commemorative ticket', type: 'misc', value: 15, weight: 2, description: null, flags: {},
      tags: { stackable: true, description: 'Card, printed, with the halt\'s name and a blank where a destination goes. A box of five hundred was delivered on the day the board was energised and nobody has ever needed one.' } },
  ],
  npc: {
    id: 'npc_hf_standing_pell', name: 'Ozias Pell', sex: 'male', hp: 30,
    homeRoom: 'waiting', workRoom: 'waiting', shopName: 'Standing Room Only',
    description: 'A neat, elderly man in a coat and a hat, on the warm side of the bench with two flasks beside him and a folded paper he has already read. He was a railwayman somewhere else for a very long time. He comes here every day, he sits in the waiting room, and he is entirely clear-eyed about what he is doing and does it anyway.',
    clothing: ['a good dark overcoat, brushed', 'a soft hat set square', 'a jacket and a knitted tie under it', 'trousers with a crease, and polished shoes'],
    inventory: [
      { item_id: 'item_hf_standing_flask', price: 6 },
      { item_id: 'item_hf_standing_ticket', price: 15 },
    ],
    chitchat: [
      'Pell pours a cup, holds it, and does not drink it yet.',
      'He looks up at the indicator board, reads it, and looks back down.',
      'He refolds the paper along its original creases.',
      'He checks a pocket watch against nothing in particular and puts it away.',
      'Somebody comes up the stair, sees the empty platform, and goes back down. He does not comment.',
    ],
    dialogue: {
      root: {
        text: '"Sit on the warm side." He moves a flask. "The heater is under this end and there is no reason for anybody to be cold in here."',
        text_by_relation: {
          first: 'The waiting room is warm and dry and there is an elderly man on the bench with two flasks beside him, and he looks up as though he has been waiting for somebody, which he has not.\n\n"Come in properly and shut it." He shifts along. "Warm side is this side. Heater is under here and there is no sense in anybody being cold."\n\nHe pours a cup without asking and sets it on the bench between you.\n\n"Pell. Before you ask: no, there is no service. There is no line. The board says what the board says." He picks up his own cup. "Six credits for that if you want it, and nothing if you do not."',
          known: '"Warm side." The cup is already poured. "Six, same as ever."',
          familiar: 'He has poured two before you are through the door and put one on the bench in the place you sit.\n\n"There was a survey party on the Buried Road this morning," he says, without any preamble at all. "Four of them and a level. I have been waiting all day to tell somebody."',
        },
        options: [
          { label: 'Why do you come here?', next: 'why' },
          { label: 'A cup, then.', next: '__shop__' },
          { label: 'Do you think a line will ever come?', next: 'line' },
          { label: 'You were a railwayman?', next: 'was' },
          { label: 'Heard anything?', next: 'gossip' },
          { label: 'Another time.', next: 'bye' },
        ],
      },
      why: {
        text: '"Because it is a good waiting room and I have spent my life in them." He says it without a scrap of self-pity. "It is warm, it is dry, the light comes on when you come in, and somebody who had waited for a train in the rain specified that light."\n\n"People come up the stair and look at the empty platform and feel foolish, and then they see me sitting here and they feel better, and some of them sit down." He turns the cup. "I am not pretending there is a train. I am occupying a room that would otherwise be empty, which is not the same thing, whatever my daughter says."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      line: {
        text: '"I think somebody meant one." He taps the bench. "You do not lay tactile strip on both edges of a platform for a building nobody intends to run trains at. That costs money and nobody sees it and it is only there for people who cannot see."\n\n"Whoever specified this halt was building a railway station." A pause. "Whether the person who specified it is still in the room where those decisions get made, I could not tell you. That is usually the whole of it, with these."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      was: {
        text: '"Forty-one years, somewhere that is not here, on a system that does not exist any more." He does not name it and you get the strong sense he would if you came back enough times. "Signals, then stations, then a desk I did not like."\n\n"I have stood on a platform in the dark with nothing coming for longer than you have been alive." He almost smiles. "This is not sad. A platform with nothing coming is simply a platform between trains, and the gap has never once been the interesting part of the job."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      gossip: {
        text: '"They cleaned the timetable case." He says it as though it were the main news of the season, which for him it is. "Last month. Somebody unlocked it, polished the glass, put a fresh backing board in and locked it again."\n\n"You do not do that to a case you have written off. You do that to a case you are going to put something in." He drinks. "I have been watching it since. There is a mark on the new board in the top left corner where something was pinned and taken down, and the mark is a corner of a sheet about so big." He indicates a timetable-sized rectangle with two fingers.',
        options: [{ label: 'Back.', next: 'root' }],
      },
      bye: { text: '"Mind the stair," he says. "The nosings are right but the light at the bottom is not, and I have written about it."', options: [] },
    },
  },
});

// ── Line of Enquiry ──────────────────────────────────────────────────────────
SPECS.push({
  slug: 'hf_line', name: 'Line of Enquiry', type: 'transit_halt',
  x: 908, y: 917, entrance: 'north', floors: 2, marker: 'LQ', district: 'halcyon_fields',
  facade: {
    bgColor: '#141f2a', color: '#bfe8ff',
    description: 'The second halt, at the east end of the Buried Road where the quarter runs out into the substation yard, and identical to the first except that this one is not finished: the canopy is up and the waiting room is a frame with no glass in it, and the indicator board has never been energised. It is the only unfinished building in Halcyon Fields and it has been unfinished for longer than most of the quarter has been standing.',
  },
  rooms: [
    { key: 'platform', name: 'The Unglazed Platform', floor: 'metal',
      description: 'A chrome deck under a canopy, open on all four sides, with the wind coming straight through where the waiting room should be. The tactile strip is laid on one edge and stops halfway along the other, ending in a clean line as if somebody was called away. Beyond the end of the platform there is a level bed of ballast about thirty paces long and then grass.' },
    { key: 'shell', name: 'The Waiting Room Shell', floor: 'metal', from: 'platform', dir: 'west',
      description: 'Four chrome uprights, a roof and no walls, with the glazing channels fitted and empty and a bench bolted down in the middle of it. Somebody has strung a tarpaulin across the windward side and weighted it with ballast off the bed, which is the only alteration anybody has made to this building since it stopped.' },
  ],
  utility: { name: 'The Unfitted Kiosk', floor: 'concrete',
    description: 'The room under the platform, same as its twin, and in the same state: a counter frame and no counter. The cabinet went in because the cabinet goes in before anything else does, and it is the only finished thing on the plot.' },
  lights: { shell: { name: 'the hooked-up worklight', description: 'A single caged worklight somebody has hooked over an upright and run off the kiosk supply, which has been there long enough that the cable has weathered to the colour of the frame. It is not in any drawing.', lumens: 400, type: 'fixture' } },
  props: [
    { key: 'ballast', room: 'platform', name: 'the ballast bed', objectType: 'decoration',
      description: 'Thirty paces of properly laid, properly graded track ballast running east off the end of the platform, squared at the sides, and then nothing.',
      flags: { aliases: ['ballast', 'bed', 'stone'], interactions: { examine: 'It is graded to a fall and the shoulders are dressed. Somebody laid this expecting sleepers on it within the month.' } } },
    { key: 'tarp', room: 'shell', name: 'the strung tarpaulin', objectType: 'decoration',
      description: 'A heavy sheet lashed across the windward opening and weighted at the bottom with ballast in a doubled edge, expertly done.',
      flags: { aliases: ['tarp', 'tarpaulin', 'sheet'], interactions: { examine: 'The lashings are seized off properly and the weights are evenly spaced. Whoever put this up has rigged a great many of them and did this one carefully.' } } },
    { key: 'bench', room: 'shell', name: 'the bolted bench', objectType: 'furniture',
      description: 'A chrome bench bolted to the deck in the middle of a room with no walls, which is the single most absurd object in the quarter.',
      flags: { aliases: ['bench', 'seat'], vendor_safe: true, vendor_npc_id: 'npc_hf_line_marchetti', hack_difficulty: 3,
        interactions: { sit: 'You sit on a bench in a waiting room that has no walls, under a roof that is perfect, and it is not as bad as it sounds, which is somehow worse.' } } },
  ],
  items: [
    { id: 'item_hf_line_offcut', name: 'a length of glazing channel', type: 'misc', value: 20, weight: 260, description: null, flags: {},
      tags: { stackable: true, description: 'Chrome section, cut square at both ends, off the pile that has been standing beside this platform since the work stopped. It is good material and there is a great deal of it and nobody has ever come for it.' } },
    { id: 'item_hf_line_docket', name: 'a suspended works docket', type: 'misc', value: 38, weight: 6, description: null, flags: {},
      tags: { stackable: true, description: 'A carbon copy off a pad, filled in properly, giving the date the glazing was due and a one-word reason in the box for why it was not done. The word is HOLD. There is no signature under it.' } },
  ],
  npc: {
    id: 'npc_hf_line_marchetti', name: 'Nella Marchetti', sex: 'female', hp: 38,
    homeRoom: 'shell', workRoom: 'shell', shopName: 'Line of Enquiry',
    description: 'A rangy woman in her fifties in a site coat, sitting on the bolted bench with a pad of dockets and a flask, watching the east end of the ballast bed. She was the foreman on this halt. The job was suspended, her gang was moved to the crescent, and she has come back here on her own time every week since to write a docket saying the glazing is still outstanding.',
    clothing: ['a heavy site coat with a foreman\'s tab on the shoulder', 'a fleece under it, older than the coat', 'work trousers with a rule pocket', 'steel-capped boots, resoled'],
    inventory: [
      { item_id: 'item_hf_line_offcut', price: 20 },
      { item_id: 'item_hf_line_docket', price: 38 },
    ],
    chitchat: [
      'Marchetti writes a date on a docket and tears off the carbon.',
      'She looks down the ballast bed to where it stops, and back.',
      'She checks the tarpaulin lashings, which do not need checking.',
      'She counts the pile of glazing channel with her eyes and does not write the number down.',
      'She pours from the flask and holds the cup with both hands.',
    ],
    dialogue: {
      root: {
        text: '"Sit down, it is out of the wind on that side." She does not stop writing. "Do not mind the docket. I am only keeping a record."',
        text_by_relation: {
          first: 'There is a roof and no walls and a woman in a site coat on a bench in the middle of it, writing on a pad, with a tarpaulin lashed across the windward opening behind her.\n\n"Behind the sheet, if you are stopping." She does not look up until she has finished the line. "Marchetti. I was foreman on this."\n\nShe tears off a carbon and adds it to a stack that is thicker than you would like.\n\n"It is not abandoned, before you ask. It is suspended. There is a difference on paper and I have eighty-one of these that say so."',
          known: '"Behind the sheet." She is already writing. "Eighty-two this week."',
          familiar: 'She moves the pad along the bench to make room and turns the flask cup upright with her thumb.\n\n"Sit," she says. "Something came off the east end last night and I want to tell somebody who will remember I said it."',
        },
        options: [
          { label: 'Why do you keep writing dockets?', next: 'dockets' },
          { label: 'A docket, then.', next: '__shop__' },
          { label: 'Why did it stop?', next: 'stop' },
          { label: 'The ballast goes thirty paces and stops.', next: 'ballast' },
          { label: 'Heard anything?', next: 'gossip' },
          { label: 'Another time.', next: 'bye' },
        ],
      },
      dockets: {
        text: '"Because a suspended job with no dockets on it is a finished job that nobody finished." She says it like a rule, because it is one. "The moment the paper stops, the works stop existing. Then in four years somebody finds a platform in a field and has to decide from scratch whether it was ever meant to be anything."\n\n"So every week I write one. Glazing outstanding. Same wording. It costs me an afternoon and a pad." She taps the stack. "When somebody finally asks what happened here, there is going to be an answer, and it is going to be in order and in date."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      stop: {
        text: '"HOLD." She holds up a carbon so you can read the one word in the box. "No signature, no reason, no date for lifting it. It came down on a Tuesday and by the Thursday my gang was on the crescent."\n\n"I asked. I asked properly, up the chain, in writing, twice." She puts the carbon back. "I got told the halt is in the phase and the line is in a later phase, which is the same sentence they give everybody and is not an answer to a hold notice. A hold is not a phase. A hold is somebody stopping a thing that had started."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      ballast: {
        text: '"Thirty-one paces." She says the number without checking. "Graded, dressed, falls right. That is a fortnight of work and it is the most expensive thirty-one paces in the quarter."\n\n"And it stops in the middle of nothing." She looks at it. "Which tells you that the hold came down after the bed went in and before the sleepers came. So somewhere there is a fortnight in which somebody changed their mind about a railway, and I can tell you which fortnight it was to the day, because I have the dockets."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      gossip: {
        text: '"Somebody is using the east end at night." She keeps her voice level and it takes effort. "The shoulders of the bed are dressed. You dress a shoulder once and then it stays dressed unless something runs on it."\n\n"Twice this season I have come out and found the shoulder walked down on the north side, both times over about ten paces, both times in the same place." She turns the cup. "That is not a fox and it is not kids. That is something with weight on it, moving along the bed, at the end where the bed stops. And I write it on the docket, and nobody has ever come and asked me about it."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      bye: { text: '"If you are going east from here," she says, "go round the bed, not down it. I would rather the shoulder stayed a record than became a path."', options: [] },
    },
  },
});

// ── Ivory Tower ──────────────────────────────────────────────────────────────
SPECS.push({
  slug: 'hf_ivory', name: 'Ivory Tower', type: 'chrome_tower',
  x: 897, y: 915, entrance: 'south', floors: 14, marker: 'IV', district: 'halcyon_fields',
  facade: {
    bgColor: '#18232e', color: '#dff0ff',
    description: 'Fourteen storeys of the same cylinder as the rest, finished in the palest chrome in the quarter, standing directly across the Buried Road from the Institute. The whole building is let to the Institute as residences for its fellows, which means it has fourteen floors, forty-one apartments and a research library on the top, and every single person in it has an opinion about the name.',
  },
  rooms: [
    { key: 'lobby', name: 'The Fellows\' Lobby', floor: 'tile',
      description: 'A round lobby with the lifts in the core and, against the curve, a noticeboard that is completely full: seminars, a notice about a lost umbrella, four arguments conducted entirely in pinned replies, and a printed sheet correcting the grammar of the building\'s own signage.' },
    { key: 'library', name: 'The Top Library', floor: 'boards', from: 'lobby', dir: 'up',
      description: 'The crown floor, glazed the whole way round, with low shelving so that the view is never blocked and eight desks facing outward. It is completely silent and it is the highest habitable room on this side of Coldwater, and the Curtain is out of the west windows at eye level.' },
  ],
  utility: { name: 'The Core Base', floor: 'concrete',
    description: 'The foot of the riser. Identical to the one in every other tower on the estate, except that somebody has pinned a printed notice above the cabinet explaining, at length, the correct use of the word "comprise" in the estate\'s own maintenance schedule.' },
  lights: { library: { name: 'the desk lamps', description: 'One green-shaded lamp per desk and nothing else at all, so that the room stays dark enough for the city to read through the glass. Every fellow who has ever worked here has argued for brighter light and lost.', lumens: 500, type: 'lamp' } },
  props: [
    { key: 'board', room: 'lobby', name: 'the fellows\' noticeboard', objectType: 'decoration',
      description: 'Cork, full to the edges, with four layers of paper on it in places and at least two conversations being conducted entirely in pinned notes.',
      flags: { aliases: ['board', 'noticeboard', 'notices'], interactions: { examine: 'One thread runs to eleven pinned replies and concerns whether the Institute\'s subject is philosophy or engineering. Nobody has conceded anything and the earliest note is dated two years ago.' } } },
    { key: 'desks', room: 'library', name: 'the reading desks', objectType: 'furniture',
      description: 'Eight desks facing outward round the curve, each with a green-shaded lamp and a blotter, and the whole Basin out in front of every one of them.',
      flags: { aliases: ['desk', 'desks', 'reading'], interactions: { sit: 'You sit facing the glass with a lamp at your elbow and the city below, and you understand immediately why nobody here has ever won the argument about brighter light.' } } },
    { key: 'counter', room: 'library', name: 'the issue desk', objectType: 'fixture',
      description: 'A small counter by the lift with a date stamp, a tray of slips and a tin for contributions towards the lamps.',
      flags: { aliases: ['counter', 'issue', 'librarian'], vendor_safe: true, vendor_npc_id: 'npc_hf_ivory_bellweather', hack_difficulty: 5 } },
  ],
  items: [
    { id: 'item_hf_ivory_offprint', name: 'a bound offprint', type: 'misc', value: 44, weight: 70, description: null, flags: {},
      tags: { stackable: true, description: 'Forty pages, stapled and cased, being one fellow\'s paper on the continuity of self reproduced at the Institute\'s expense. It is well argued and almost entirely unreadable and the fellow has signed the flyleaf without being asked.' } },
    { id: 'item_hf_ivory_card', name: 'a reader\'s card', type: 'misc', value: 25, weight: 2, description: null, flags: {},
      tags: { stackable: true, description: 'Admits the bearer to the top library, which is free to fellows and twenty-five to everybody else, and the twenty-five goes in the tin and the tin buys the lamps.' } },
  ],
  npc: {
    id: 'npc_hf_ivory_bellweather', name: 'Ottoline Bellweather', sex: 'female', hp: 26,
    homeRoom: 'library', workRoom: 'library', shopName: 'Ivory Tower',
    description: 'A small, dry, extremely quick woman of about seventy at the issue desk, who has been a librarian for fifty years in four institutions and regards this one as by some distance the silliest. She is enormously fond of the fellows and would not admit it under any pressure whatsoever.',
    clothing: ['a cardigan with the buttons done up wrong on purpose, she says', 'a blouse with a small brooch', 'a long skirt and flat shoes', 'plain underthings'],
    inventory: [
      { item_id: 'item_hf_ivory_offprint', price: 44 },
      { item_id: 'item_hf_ivory_card', price: 25 },
    ],
    chitchat: [
      'Bellweather stamps something with unnecessary force and looks satisfied.',
      'She glances down the row of desks, counts the occupied ones, and writes the number in a book.',
      'She shakes the tin, judges its weight, and puts it back exactly where it was.',
      'She straightens a shelf that is already straight, by one book.',
      'She looks out west at the Curtain for a moment, and then very deliberately does not.',
    ],
    dialogue: {
      root: {
        text: '"Twenty-five if you are not a fellow, and you are not a fellow." She has the card out. "Do not apologise for it, half of them cannot read either."',
        text_by_relation: {
          first: 'The lift opens onto silence and a very great deal of sky, and a small woman at a counter by the door holds up one finger before you have made any noise at all.\n\n"Quiet room," she says, quietly. "That is the only rule and it is not negotiable, and I enforce it on the fellows more than on visitors."\n\nShe produces a card.\n\n"Bellweather. Twenty-five for a reader\'s card, which goes in the tin, which buys the lamps. You may sit at any desk that does not have a coat on it, and if a fellow tells you that you may not, tell them I said you may."',
          known: '"Card is still twenty-five." She stamps it before you ask. "Desk four is free and desk four is the best one."',
          familiar: 'The card is stamped and on the counter before the lift has closed, and she taps it twice with one finger.\n\n"Four," she says. "I have kept a coat off it. Do not tell them that is a thing I do."',
        },
        options: [
          { label: 'Do they mind the building being called that?', next: 'name' },
          { label: 'A reader\'s card, then.', next: '__shop__' },
          { label: 'What do the fellows actually study?', next: 'study' },
          { label: 'Why keep the room so dark?', next: 'dark' },
          { label: 'Heard anything?', next: 'gossip' },
          { label: 'Another time.', next: 'bye' },
        ],
      },
      name: {
        text: '"They are furious about it and they will never say so." She is enjoying this enormously. "There were three pinned notes downstairs within a week of the signage going up."\n\n"The estate named it. The estate names everything in this quarter with a joke in it, and they have been doing it since the first hoarding went up, and the fellows have decided the correct response is dignity." She stamps something. "Which is of course exactly the response that makes the name funny. I have pointed this out. It did not help."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      study: {
        text: '"Continuity of self, which is a polite way of saying they argue about whether the thing that walks out of a vat is you." She says it entirely without weight. "Eleven of them. Forty-one flats and eleven fellows, before you ask, and yes I know what that means about the rest of the building."\n\n"It is not nonsense. I want to be clear about that, because people assume I think it is nonsense." She squares the tray of slips. "Three of them have been right about something important before anybody else was. The difficulty is that nobody can tell which three until afterwards."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      dark: {
        text: '"So you can see out." She gestures at the glass with the stamp. "Light the room properly and every window in it becomes a mirror after four in the afternoon, and then you have the most expensive reading room in the Basin with a view of itself."\n\n"They argue for brighter lamps twice a year. I let them argue and then I do not order the lamps." A small, entirely unrepentant pause. "I am seventy-one and there is a limit to how much of my remaining time I am prepared to spend being outvoted."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      gossip: {
        text: '"Somebody is reading up here at night." She says it flatly. "The tin is heavier on a Monday than I leave it on a Friday, by twenty-five or fifty, and there is no card gone from the tray."\n\n"So somebody comes up, takes no card, and pays anyway." She looks down the empty desks. "Desk seven has the blotter turned round. I turn it back every Monday and it is round again the Monday after, and it has been going on since the spring." A beat. "I have stopped turning it back. If somebody wants a desk badly enough to pay for a card they do not take, they may have desk seven."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      bye: { text: '"Take the west lift," she says, "and do not read on the stairs. I have seen where that ends and I had to fill in a form about it."', options: [] },
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
