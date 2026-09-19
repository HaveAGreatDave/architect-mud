/**
 * Halcyon Fields, batch 3 — the two that belong somewhere else.
 *
 * Both of these were sited by their SUBJECT rather than by the quarter: an incinerator goes
 * where the bodies are, and a water tower goes where the city's centre of gravity is. Neither
 * is in Halcyon Fields and neither takes its district — the incinerator joins `industrial`
 * beside the clone facility and the tower joins `ashway` on Meltwater Row, which also drags
 * two more tiles out of the misfiled `wasteland` pool.
 *
 *   node scripts/content/halcyon/batch3.mjs [--dry-run]
 */
import { authorBuilding, loadContentStore } from './lib.mjs';

const DRY = process.argv.includes('--dry-run');
const store = loadContentStore();
const SPECS = [];

// ── Ash Management ───────────────────────────────────────────────────────────
// The city's refuse, and quietly whatever the clone facility two doors down is finished
// with. ⚠ TONE: this one is not funny about its own subject. The joke, such as it is, is the
// name on the gate and the fact that it is a municipal service with a docket book.
SPECS.push({
  slug: 'ash', name: 'Ash Management', type: 'incinerator',
  x: 920, y: 902, entrance: 'west', floors: 5, marker: 'AM', district: 'industrial',
  facade: {
    bgColor: '#16150f', color: '#a89878',
    description: 'A brick tipping hall with a road ramp up one side and a weighbridge plate set into the apron at the bottom of it, and standing off the back of the hall a chimney that is the tallest thing in this half of the city by a long way. The smoke off it is thin and almost white and goes straight up on a still day. On the gate, in works lettering on a green plate: ASH MANAGEMENT · TRADE AND MUNICIPAL · WEIGHBRIDGE IN USE.',
  },
  rooms: [
    { key: 'tip', name: 'The Tipping Hall', floor: 'concrete',
      description: 'A high brick hall with the road ramp coming in at first-floor level and the bunker opening in the floor below it, so that a lorry backs up to a rail and tips into a hole. The hole is deep and you do not want to look into it and you do. Above, on a rail under the roof, the grab travels the length of the bunker on its own business and drops its load through the charging door with a sound the building takes a while to finish having.' },
    { key: 'furnace', name: 'The Furnace Floor', floor: 'metal', from: 'tip', dir: 'down',
      description: 'Below the bunker, along the front of the grates: six inspection doors in a row, each with a hinged cover and a smoked glass the size of a hand. The floor plate is warm through your boots. It is not the heat you expect, which would be a blast; it is a steady, patient warmth coming up from underneath, and the noise is a low roar that has no edges on it at all.' },
  ],
  // The pit is under the GRATES, so it hangs off the furnace floor rather than off the
  // tipping hall — which is also the only arrangement the exit slots allow.
  utilityAnchor: 'furnace',
  utility: { name: 'The Ash Pit', floor: 'concrete',
    description: 'Under the grates, where what is left comes out: a concrete pit with a quench trough and a conveyor going up to the yard, and the clinker moving along it slowly, grey and glassy and still ticking as it cools. The cabinet is on the wall by the stair, as far from the trough as the room allows.' },
  lights: { furnace: { name: 'the inspection lamps', description: 'Caged bulbs over each door, throwing enough light to find a handle by. The real light in the room comes up through the smoked glass and moves.', lumens: 800, type: 'overhead' } },
  props: [
    { key: 'grab', room: 'tip', name: 'the grab', objectType: 'fixture',
      description: 'A clamshell on a rail under the roof, travelling the length of the bunker, dropping and closing and lifting on a cycle that has nothing to do with whether anybody is watching.',
      flags: { aliases: ['grab', 'crane', 'clamshell'], interactions: { examine: 'It picks from a different part of the bunker each time rather than working a face, which he will tell you is so the load burns evenly, and which is also why nothing stays near the top for long.' } } },
    { key: 'weigh', room: 'tip', name: 'the weighbridge desk', objectType: 'fixture',
      description: 'A hatch at the top of the ramp with a scale head, a docket book on a chain, a carbon between every leaf and a cash tin under the counter.',
      flags: { aliases: ['desk', 'weighbridge', 'dockets', 'tin'], vendor_safe: true, vendor_npc_id: 'npc_ash_studd', hack_difficulty: 3 } },
    { key: 'doors', room: 'furnace', name: 'the inspection doors', objectType: 'fixture',
      description: 'Six in a row along the front of the grates, each with a hinged cover over a smoked glass the size of a hand. The covers are worn bright round the handles.',
      flags: { aliases: ['doors', 'inspection', 'glass'], interactions: { examine: 'Number four\'s cover is worn brighter than the rest. It is the one over the middle of the grate and it is the one you check if you want to know that the burn is right.' } } },
  ],
  items: [
    { id: 'item_ash_docket', name: 'a weighbridge docket', type: 'media', value: 1, weight: 2, description: null, flags: {},
      tags: { stackable: true, description: 'A carbon of a load: gross, tare, net, the trade name and a time. The description column is filled in on most of them and blank on a few, and the blank ones are all from the same account.' } },
    { id: 'item_ash_clinker', name: 'a lump of clinker', type: 'misc', value: 2, weight: 700, description: null, flags: {},
      tags: { stackable: true, description: 'Grey, glassy, light for its size and full of holes, off the conveyor out of the quench. People use it for hardcore and for drainage, and one man in the Yards grinds it and sells it back as grit.' } },
    { id: 'item_ash_shovel', name: 'a long-handled shovel', type: 'misc', value: 18, weight: 1600, description: null, flags: {},
      tags: { stackable: true, description: 'A square mouth on a six-foot ash handle, the blade worn back an inch from what it started as. He has a rack of them and sells the ones that have gone too short for the pit.' } },
  ],
  npc: {
    id: 'npc_ash_studd', name: 'Ezra Studd', sex: 'male', hp: 44,
    homeRoom: 'furnace', workRoom: 'tip', shopName: 'Ash Management',
    description: 'A grey, unhurried man in a works coat with the collar up, sitting at the weighbridge hatch with a docket book in front of him and the grab going over behind him every ninety seconds. There is ash in the creases of his hands that has been there long enough to be part of the hand. He is not grim about any of this. He is careful about it, which is different and takes longer to notice.',
    clothing: ['a heavy works coat, ash-grey whatever colour it started, collar turned up indoors', 'a flannel shirt and a scarf he does not take off', 'stiff trousers and boots with the laces replaced by wire at the top', 'a vest and long underthings'],
    inventory: [
      { item_id: 'item_ash_docket', price: 1 },
      { item_id: 'item_ash_clinker', price: 2 },
      { item_id: 'item_ash_shovel', price: 18 },
    ],
    chitchat: [
      'Studd writes a net weight into the book, tears the carbon, and spikes the top copy.',
      'He looks up as the grab goes over, follows it the length of the rail, and looks back down.',
      'He turns the docket book round on the chain so it faces the hatch, ready for the next one.',
      'He wipes the scale head glass with his cuff. It is grey again within the minute.',
      'Somewhere below, a load goes through the charging door, and the floor takes a moment to settle.',
    ],
    dialogue: {
      root: {
        text: '"Trade or municipal?" He has the book turned round before you answer. "If you have not got a load, come up the steps rather than the ramp. Lorries do not look."',
        text_by_relation: {
          first: 'The man at the hatch finishes writing before he looks up, which takes a while, and when he does he looks at your hands first to see whether you are carrying anything.\n\n"Studd." He turns the book round out of habit and then turns it back. "No load, then. That is fine, people come up."\n\nBehind him the grab drops, closes and lifts, and he does not turn round.\n\n"This is the destructor. Trade and municipal. Everything this city stops wanting comes up that ramp and goes in that hole, and what comes out the other end is clinker and a thin white smoke, and that is the whole of it."',
          known: '"No load again." He almost smiles. "Come up, then. Mind the plate, it is greasy."',
          familiar: 'He has the kettle going on the ring behind the hatch before you have reached the top of the steps.\n\n"Number four glass is worth a look today," he says. "She is burning clean as anything. You will not see that every week and I have got nobody else to say it to."',
        },
        options: [
          { label: 'What comes up the ramp?', next: 'loads' },
          { label: 'What have you got?', next: '__shop__' },
          { label: 'Some dockets have no description.', next: 'blank' },
          { label: 'Heard anything?', next: 'gossip' },
          { label: 'I\'ll get out of the way.', next: 'bye', enabled: true, actions: [], conditions: [] },
        ],
      },
      loads: {
        text: '"Household off the round, which is most of it by weight and none of it by trouble." He counts on the edge of the book. "Trade waste. Market sweepings. Condemned stock off the bonded warehouse, and that comes with a man to watch it go in."\n\n"And clinical. From the clinics, and from the facility across the way. That is a separate account and a separate time of day and it does not queue with the rest."',
        options: [
          { label: 'A separate time of day?', next: 'loads_time' },
          { label: 'Back.', next: 'root' },
        ],
      },
      loads_time: {
        text: '"Half five in the morning." He says it plainly. "Before the round starts. One vehicle, sealed, and it goes straight over the plate and up the ramp without stopping, and I take the weight off the head and I do not open anything."\n\n"That is not me being furtive. It is how you are supposed to run a clinical account and I would run it the same way if the load were bandages. It happens not to be bandages."',
        options: [{ label: 'Back.', next: 'loads' }],
      },
      blank: {
        text: 'He looks at the book for a moment and does not pretend not to know what you mean.\n\n"The description column is filled in by the man bringing it. On that account it comes in blank and I am not required to fill it." A pause. "I could ask. Nobody has ever told me not to ask."\n\n"What I do instead is weigh it, and write the weight, and keep the carbon. There are nine years of carbons in that cupboard and every one of those loads is in them by weight and by time. If it ever matters to anybody, it is written down. That is the most I have worked out how to do."',
        options: [
          { label: 'Does it bother you?', next: 'blank_bother' },
          { label: 'Back.', next: 'root' },
        ],
      },
      blank_bother: {
        text: '"I burn what the city sends me and I do it properly." He squares the book. "The grate is set right, the stack is clean, the ash is quenched and nothing goes out of here that should not."\n\n"What comes up the ramp is not my decision and never has been. I have thought about that more than I would recommend. The conclusion I reached is that somebody ought to be doing this carefully, and it may as well be somebody who has noticed."',
        options: [{ label: 'Back.', next: 'blank' }],
      },
      gossip: {
        text: '"Tenement behind me complains about the stack and they are right, and the stack is not the problem, the wind is." He shrugs. "Two-Cell next door runs a line off my yard light and thinks I have not noticed. He can have it."\n\n"And there is a fire station gone in over the other side of the meadow. I would like them to come and look at my bunker. I have asked. They have not been, and I understand why, and I would still like them to come."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      bye: { text: '"Down the steps," he says. "Not the ramp."', options: [] },
    },
  },
});

// ── High Water Mark ──────────────────────────────────────────────────────────
// A legged tank at the geometric centre of the built city, holding about a day for half of
// it, with a pump house at its foot and the best view in Coldwater up a ladder nobody else
// is allowed to climb.
SPECS.push({
  slug: 'hwm', name: 'High Water Mark', type: 'water_tower',
  x: 910, y: 907, entrance: 'south', floors: 6, marker: 'HW', district: 'ashway',
  facade: {
    bgColor: '#161b1d', color: '#9fb4bc',
    description: 'Four riveted steel legs on concrete pads, cross-braced the whole way up, carrying a tank with a domed top and a walkway round its skirt. On the tank, in letters that were white and are now the colour of the tank, COLDWATER. The overflow pipe comes down one leg and ends a foot off the ground over a grating, and there is a wet patch under it that never entirely dries. At the foot of the legs, a brick pump house with one door and a small high window.',
  },
  rooms: [
    { key: 'pump', name: 'The Pump House', floor: 'stone',
      description: 'One brick room at the foot of the legs, most of it taken up by two pumps on a shared bedplate and the pipework going up through the roof. A gauge board on the wall gives the level in the tank in feet and inches, and beside it hangs a chalked slate with the morning\'s reading and the same reading from a year ago today, which somebody bothers to look up.',
      window: { name: 'the high window', description: 'A small square of glass up near the eaves, letting in a bar of light that crosses the bedplate in the afternoon and has bleached a stripe into it.', light: 0.4, visibility: 0.5 } },
    { key: 'gallery', name: 'The Tank Gallery', floor: 'metal', from: 'pump', dir: 'up',
      description: 'A hundred rungs up the inside of a leg and out through a hatch onto the walkway round the tank skirt. From here you can see the whole of it: the basin, the piers, the Spire, the Marquee, the new road going through the meadow to the wall, the gasholder sitting at whatever level it is sitting at, and away south the Curtain closing the lot off in a line of light. The wind up here is constant and the handrail is cold in any weather.' },
  ],
  utility: { name: 'The Valve Chamber', floor: 'concrete',
    description: 'A chamber under the pump house floor holding the inlet, the outlet and the scour, all three painted different colours by somebody who wanted the next person to be in no doubt. The cabinet is up on brackets clear of the floor, because this room has been wet before.' },
  lights: { gallery: { name: 'the walkway lamp', description: 'One bulkhead by the hatch, on a switch inside it, so that a person coming up in the dark can see the rungs and nothing above them is lit at all.', lumens: 500, type: 'lamp' } },
  props: [
    { key: 'gauges', room: 'pump', name: 'the gauge board', objectType: 'fixture',
      description: 'A painted board with the tank level in feet and inches, the delivery pressure, and a slate hanging beside it carrying this morning\'s reading and the same date last year.',
      flags: { aliases: ['gauges', 'board', 'slate'], vendor_safe: true, vendor_npc_id: 'npc_hwm_kemp', hack_difficulty: 3 } },
    { key: 'pumps', room: 'pump', name: 'the duty pumps', objectType: 'fixture',
      description: 'Two on a shared bedplate, one running and one not, with a changeover lever between them and a tally chalked on the wall of which has done how many hours.',
      flags: { aliases: ['pumps', 'bedplate', 'lever'], interactions: { examine: 'The tally is almost exactly even over years, which does not happen by itself. Somebody changes them over on a schedule and has never once let it drift.' } } },
    { key: 'rail', room: 'gallery', name: 'the walkway rail', objectType: 'furniture',
      description: 'A pipe handrail round the tank skirt, cold in any weather, with the paint worn to bright metal in two places where hands go.',
      flags: { aliases: ['rail', 'handrail', 'walkway'], interactions: { examine: 'The two worn places are on the south side, facing the meadow and the wall. Nobody stands on the north side, where the view is the basin and the money.' } } },
  ],
  items: [
    { id: 'item_hwm_water', name: 'a cup from the tap', type: 'drink', value: 1, weight: 280, description: null, flags: {},
      tags: { stackable: false, description: 'Off the sample tap on the delivery main, which is the water half this city drinks about ten minutes before they drink it. She charges one because a thing that is free gets treated like a thing that is free.' } },
    { id: 'item_hwm_dip', name: 'a dip tape', type: 'misc', value: 26, weight: 340, description: null, flags: {},
      tags: { stackable: true, description: 'A steel tape on a reel with a brass plumb on the end and the feet stamped rather than printed, so it still reads after it has been wet ten thousand times. There is a spare in the chamber and she will part with it.' } },
    { id: 'item_hwm_key', name: 'a hatch padlock key', type: 'misc', value: 40, weight: 20, description: null, flags: {},
      tags: { stackable: true, description: 'A stubby brass key on a fob of hard leather, cut for the padlock on the leg hatch. There are three in the world, she has two, and she is direct about what the third one buys you and what it does not.' } },
  ],
  npc: {
    id: 'npc_hwm_kemp', name: 'Orla Kemp', sex: 'female', hp: 39,
    homeRoom: 'gallery', workRoom: 'pump', shopName: 'High Water Mark',
    description: 'A lean, windburnt woman in a waterproof coat she wears indoors because she is about to go out in it, with a slate under one arm and a tape in her pocket. She climbs the tower every morning before it is properly light and she has done for eleven years, and she talks about the view the way somebody talks about a person they live with.',
    clothing: ['a stiff waterproof coat worn indoors, because she is always about to be up a ladder', 'a wool jersey under it with the cuffs pulled over her hands', 'work trousers and boots with good tread, replaced on a schedule', 'a vest and plain underthings'],
    inventory: [
      { item_id: 'item_hwm_water', price: 1 },
      { item_id: 'item_hwm_dip', price: 26 },
      { item_id: 'item_hwm_key', price: 40 },
    ],
    chitchat: [
      'Kemp chalks a figure onto the slate, rubs it out with her thumb, and writes it again.',
      'She listens to the running pump for a second with her head on one side and is satisfied.',
      'She looks up at the roof where the pipework goes through, which tells her nothing, and does it anyway.',
      'She checks the changeover tally on the wall against a date in her head.',
      'Water goes through the overflow outside, briefly, and she is out of the door before it stops.',
    ],
    dialogue: {
      root: {
        text: '"Mind the bedplate, it is slick." She does not stop what she is doing. "If you want the tap it is on the delivery main and it is a cup for one."',
        text_by_relation: {
          first: 'The woman by the gauge board glances at your boots before your face, which turns out to be the most relevant thing about you in here.\n\n"Kemp. Watch the bedplate, there is oil and water on it and they take turns."\n\nShe taps the board with the edge of the slate.\n\n"Tank up top holds about a day for half this city. Two pumps, one running. When you turn a tap on Marrow Street the water has been through that roof about ten minutes before it reaches you, and nobody has ever thought about that once."',
          known: '"You know where the tap is." The slate goes under her arm. "Level is good today. Better than good."',
          familiar: 'She has the key off the hook and is turning it over in her fingers before she has said anything at all.\n\n"Wind is nothing today," she says. "You will not get a morning like this again for a fortnight. Boots?"',
        },
        options: [
          { label: 'Can I go up?', next: 'up' },
          { label: 'What have you got?', next: '__shop__' },
          { label: 'What happens if it runs dry?', next: 'dry' },
          { label: 'Heard anything?', next: 'gossip' },
          { label: 'I\'ll leave you to it.', next: 'bye', enabled: true, actions: [], conditions: [] },
        ],
      },
      up: {
        text: '"A hundred rungs inside a leg, in the dark, with a hatch at the top you have to shoulder." She looks at you levelly. "It is not the climb that stops people. It is the last six feet coming out of the hatch onto the walkway with nothing round you yet."\n\n"There are three keys. I have two. I am not going to tell you the third is unobtainable, because it is not, but I will tell you I have only ever let two people up and one of them worked here."',
        options: [
          { label: 'What\'s it like up there?', next: 'up_view' },
          { label: 'Back.', next: 'root' },
        ],
      },
      up_view: {
        text: 'She stops chalking.\n\n"You can see the whole of it. The basin and the piers, the Spire lit from the inside, the Marquee going on and off, that new road they have cut through the meadow, and the gasholder sitting at whatever it is sitting at so you know what kind of night the city is having."\n\n"And the wall. All the way along the bottom, in a line, humming. From up there it does not look like it is keeping anything out. It looks like an edge somebody drew and everyone agreed to."',
        options: [{ label: 'Back.', next: 'up' }],
      },
      dry: {
        text: '"It does not, because I am here." No boast in it. "The tank fills overnight off the mains when nobody is drawing, and it empties from about six. If a pump drops out at the wrong hour I have got maybe four hours before the top of the Marquee loses pressure and about eight before anybody on a hill has nothing."\n\n"So I changeover on a schedule, and I strip one every quarter whether it needs it or not, and the tally on that wall is even to about an hour. That is not fussiness. That is the entire job."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      gossip: {
        text: '"The pumping station down the row lifts the mains that fill me, so the old boy on the beam engine and I are the same pipe with a tower in the middle of it." She says it fondly. "He will not come up and I will not go down the culvert, and we get on very well."\n\n"There is a new quarter going in west of the meadow with a fire station in it. First thing the officer there did was walk the hydrants with a string. Second thing she did was come and ask me what pressure I could give her at four in the morning, which nobody has asked me in eleven years."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      bye: { text: '"Bedplate," she says, without looking up. "Both feet."', options: [] },
    },
  },
});

// ── run ──────────────────────────────────────────────────────────────────────
for (const spec of SPECS) {
  const r = await authorBuilding(store, spec);
  console.log(`  ${spec.name.padEnd(18)} ${spec.x},${spec.y}  ent=${String(spec.entrance).padEnd(5)} ${spec.district.padEnd(11)} ${r.facadeId}`);
}
const written = store.flush({ dryRun: DRY });
console.log(`\n${DRY ? 'DRY RUN — ' : ''}${written.length} file(s) ${DRY ? 'would change' : 'written'}`);
if (store.droppedRuntime.length) console.log(`  (dropped ${store.droppedRuntime.length} runtime write(s))`);
