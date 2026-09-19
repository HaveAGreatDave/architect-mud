/**
 * Halcyon Fields, batch 2 — the plant.
 *
 * The east half of the quarter: everything that keeps the Spire running, sat between the
 * campus and the rest of the city. Fronts onto Kettle Lane, Kerbstone Row and Meltwater Row.
 *
 *   node scripts/content/halcyon/batch2.mjs [--dry-run]
 */
import { authorBuilding, loadContentStore } from './lib.mjs';

const DRY = process.argv.includes('--dry-run');
const store = loadContentStore();
const SPECS = [];

// ── Mains Attraction ─────────────────────────────────────────────────────────
// A pumping station built as a temple to water, because that is what people did, and it
// still pumps. The one building in the quarter whose ornament is older than its owners.
SPECS.push({
  slug: 'mains', name: 'Mains Attraction', type: 'pumping_station',
  x: 900, y: 913, entrance: 'west', floors: 4, marker: 'MN', district: 'halcyon_fields',
  facade: {
    bgColor: '#1e1a18', color: '#c4a98c',
    description: 'A tall hall in polychrome brick with round-arched windows in two orders and a course of moulded terracotta under the eaves, and a square chimney standing off the north end like a campanile. Somebody built a waterworks and could not help themselves. Over the door, in terracotta, a relief of a river god who has been in the soot so long he has gone the colour of the wall. The doors are open in working hours and the note that comes out of them is very low and very steady.',
  },
  rooms: [
    { key: 'engine', name: 'The Engine Hall', floor: 'tile',
      description: 'A single volume the full height of the building, with a gallery running round it at first-floor level on iron brackets cast as leaves. In the middle, the engine: a beam the length of a bus rocking over on its trunnion, once every four seconds, polished on every surface a hand can reach and painted maroon and green everywhere else. The floor is laid in patterned tile. It is a cathedral with a machine where the altar goes, and nobody who built it thought that was funny.',
      window: { name: 'the round-arched lights', description: 'Two orders of arched windows down both long walls, the upper ones filled with leaded glass in a pattern of reeds. The light comes down in bars and moves as the beam moves.', light: 0.7, visibility: 0.5 } },
    { key: 'gallery', name: 'The Gallery', floor: 'metal',
      from: 'engine', dir: 'up',
      description: 'The walkway round the engine hall at beam level, close enough to the top of the stroke that you feel the air move each time. From here you can see down onto the tile floor and out through the upper lights at the meadow. There is a bentwood chair on the gallery by the north window that nobody has ever moved, and a mug on the rail beside it with a ring in it.' },
  ],
  utility: { name: 'The Culvert', floor: 'stone',
    description: 'Below the hall, where the mains come in: a brick culvert you can stand up in, running with cold air and the sound of a great deal of water going past very quietly. The cabinet is up on a plinth out of the wet, and the plinth has a tide mark on it from a year somebody still talks about.' },
  lights: { gallery: { name: 'the gallery lamps', description: 'Brass lamps on the rail at intervals, wired long after the building went up and kept because they suit it.', lumens: 800, type: 'lamp' } },
  props: [
    { key: 'beam', room: 'engine', name: 'the beam engine', objectType: 'fixture',
      description: 'A beam the length of a bus rocking over on its trunnion once every four seconds, maroon and green, with every handrail and every oil cup polished to white metal.',
      flags: { aliases: ['engine', 'beam', 'machine'], interactions: { examine: 'There is a maker\'s plate on the entablature with a date on it that is older than anything else in this quarter by a long way, and the plate is the most polished thing in the building.' } } },
    { key: 'bench', room: 'engine', name: 'the tool bench', objectType: 'container',
      description: 'A bench along the south wall with the spanners laid out by size on a painted board, each one on its own painted silhouette, so a missing spanner is a shape.',
      flags: { aliases: ['bench', 'tools', 'spanners'], vendor_safe: true, vendor_npc_id: 'npc_mains_roke', hack_difficulty: 3 } },
    { key: 'chair', room: 'gallery', name: 'the bentwood chair', objectType: 'furniture',
      description: 'On the gallery by the north window, facing the beam rather than the view, with a mug on the rail beside it and a ring under the mug.',
      flags: { aliases: ['chair', 'seat'], interactions: { sit: 'You sit where somebody has sat a great many times. The beam comes over, and goes back, and comes over.' } } },
  ],
  items: [
    { id: 'item_mains_oil', name: 'a can of engine oil', type: 'misc', value: 12, weight: 400, description: null, flags: {},
      tags: { stackable: true, description: 'A long-spouted can, filled from the drum by the bench. He sells it to anybody who asks because he would rather machinery in this quarter was oiled than that he made a point about it.' } },
    { id: 'item_mains_water', name: 'a bottle of mains water', type: 'drink', value: 2, weight: 500, description: null, flags: {},
      tags: { stackable: true, description: 'Drawn off the rising main in the culvert, which is the cleanest water in Coldwater by some distance and costs two because he has to buy the bottles.' } },
    { id: 'item_mains_plate', name: 'a brass maker\'s plate', type: 'misc', value: 60, weight: 300, description: null, flags: {},
      tags: { stackable: true, description: 'A spare, never fitted, still in its wrapping paper with the date cast into it. There were six in a drawer and there are fewer now, and he only lets them go to people who ask what the date means.' } },
  ],
  npc: {
    id: 'npc_mains_roke', name: 'Absalom Roke', sex: 'male', hp: 42,
    homeRoom: 'gallery', workRoom: 'engine', shopName: 'Mains Attraction',
    description: 'A big, deliberate man in overalls with a rag permanently in one hand, walking the engine the way a farrier walks a horse. He is not quite deaf and talks over the beam out of habit even when it would not be necessary. His hands are black to the wrist and the backs of them are scrubbed pink.',
    clothing: ['navy overalls with the sleeves cut off at the shoulder, oiled through', 'a collarless shirt gone grey, rolled past the elbow', 'heavy boots with steel in them and no laces left in the top two holes', 'a vest and plain underthings'],
    inventory: [
      { item_id: 'item_mains_oil', price: 12 },
      { item_id: 'item_mains_water', price: 2 },
      { item_id: 'item_mains_plate', price: 60 },
    ],
    chitchat: [
      'Roke lays the back of his hand against a bearing housing, leaves it a second, and moves on.',
      'He wipes a rail that is already clean and looks along it at the light.',
      'The beam comes over. He counts something under his breath and does not write it down.',
      'He fills an oil cup, seats the cap, and turns it a quarter past finger-tight.',
      'He puts a hand flat on the engine bed and holds it there while the stroke goes through.',
    ],
    dialogue: {
      root: {
        text: '"Mind the floor, it\'s wet by the bed." He raises his voice over the beam without seeming to. "You can come right up to the rail. People think they can\'t."',
        text_by_relation: {
          first: 'The big man by the engine sees you and puts the rag in his pocket, which turns out to be how he gives somebody his attention.\n\n"Roke," he says, over the beam. "Come up to the rail, you\'re not in the way."\n\nHe waits while the stroke goes through, as though the introduction is not finished until it has.\n\n"That is a beam engine and it has been running since before anybody sensible would put a date on it. It pumps the mains for half this side of the city. People walk past this building every day of their lives thinking it is a church."',
          known: '"You\'re back." He nods at the rail. "She\'s running sweet today, there\'s no knock in her at all."',
          familiar: 'He has the oil can in his hand and holds it out before you have said anything.\n\n"Number four cup," he says. "You know the one. I\'ll watch, and I\'ll only say something if you\'re wrong."',
        },
        options: [
          { label: 'How old is it?', next: 'old' },
          { label: 'What have you got?', next: '__shop__' },
          { label: 'Why does a pump house look like this?', next: 'temple' },
          { label: 'Heard anything?', next: 'gossip' },
          { label: 'I\'ll leave you to it.', next: 'bye', enabled: true, actions: [], conditions: [] },
        ],
      },
      old: {
        text: '"Older than the Handoff, older than the plant up the road, older than the wall." He says it without any awe, as a list of facts he has checked. "There is a date on the maker\'s plate. I am not going to tell you what it is, you can go and read it."\n\n"She has had three sets of valves and one crank in my time and everything else on her is what came out of the works. That is not sentiment. That is what happens when a thing is built with the whole of the margin left in it."',
        options: [
          { label: 'What happens when you stop?', next: 'old_stop' },
          { label: 'Back.', next: 'root' },
        ],
      },
      old_stop: {
        text: 'The beam goes over twice before he answers.\n\n"Half the city has no water at the tap and I could not tell you how long it takes anybody to notice, because the towers hold a day." He looks up at it. "There is no second engine. There has not been a second engine since somebody took the other one for the metal."\n\n"So I do not stop. That is the whole of my job and everything else I do here is dressing."',
        options: [{ label: 'Back.', next: 'old' }],
      },
      temple: {
        text: '"Because they were proud of it." He says it as though it is obvious and then hears himself and softens. "A town gets clean water for the first time and the men who did it want the building to say so. So you get arches, and terracotta, and a god over the door."\n\n"Everyone who comes in here laughs at that and then stops laughing about four minutes later, and I have never once had to explain why."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      gossip: {
        text: '"The cooling plant down the row runs their heat into the glass house and does not meter it." Approving. "That is the right way round. I gave the woman there a length of pipe for it and I would do it again."\n\n"The substation man will not come in here because of the damp and I cannot get him to understand there is no damp, there is water, which is a different thing entirely."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      bye: { text: '"Go carefully on the tile," he says. "It is wet and it is old and it is prettier than you are."', options: [] },
    },
  },
});

// ── Cold Comfort ─────────────────────────────────────────────────────────────
// The Vats print people; printing people makes heat; the heat has to go somewhere. It goes
// up out of this building in a plume, and sideways down a pipe into a glass house.
SPECS.push({
  slug: 'cold', name: 'Cold Comfort', type: 'cooling_plant',
  x: 903, y: 917, entrance: 'north', floors: 3, marker: 'CF', district: 'halcyon_fields',
  facade: {
    bgColor: '#171a1c', color: '#9fb0b6',
    description: 'A low grey slab with no windows in its lower two thirds, and standing on top of it a lattice deck carrying eight fans in a row, all of them turning, none of them in step. On a cold morning the plume off them stands straight up for a hundred feet before it gives up. A lagged main as thick as a thigh leaves the north-west corner at head height, crosses the road on brick piers and goes away down the row, and nobody has ever put a meter on it.',
  },
  rooms: [
    { key: 'floor', name: 'The Exchanger Floor', floor: 'metal',
      description: 'A hall of plate exchangers standing in ranks like bookcases, each one dripping into a channel in the floor that runs to a drain. It is loud in a flat, even way that stops being a sound after a minute and becomes a pressure. Everything metal is beaded with water. The air smells of nothing at all, aggressively, the way air does when a great deal of trouble has been taken over it.' },
    { key: 'deck', name: 'The Fan Deck', floor: 'metal', from: 'floor', dir: 'up',
      description: 'Up an open stair onto the roof: eight fans in a row in their cowls, each in its own guard, running at whatever speed the floor below has decided it needs. Between them a catwalk, wet with condensate blown sideways. From here the whole quarter lays out: the wall, the meadow, the new road, and away north the Spire, which is what all of this is for.' },
  ],
  utility: { name: 'The Pump Room', floor: 'concrete',
    description: 'Under the exchanger floor with the circulating pumps and the cabinet, and a whiteboard on the wall carrying the return temperature written up four times a day in a column that goes back weeks.' },
  lights: { deck: { name: 'the deck floods', description: 'Two floods on the handrail pointed down at the catwalk rather than out, because a light pointed out at the meadow would be seen from the Spire.', lumens: 1600, type: 'overhead' } },
  props: [
    { key: 'exchangers', room: 'floor', name: 'the plate exchangers', objectType: 'fixture',
      description: 'Ranks of them, gasketed, dripping into a channel in the floor. Each one has a number stencilled on it and a card in a holder recording when it was last stripped.',
      flags: { aliases: ['exchangers', 'plates', 'ranks'], interactions: { examine: 'Number six has a card that has been full for a while, with the last four entries in the same week and then nothing.' } } },
    { key: 'board', room: 'floor', name: 'the log board', objectType: 'fixture',
      description: 'A whiteboard by the door with the return temperature written up four times a day in a column, and a locked cash tin screwed to the shelf under it.',
      flags: { aliases: ['board', 'log', 'tin'], vendor_safe: true, vendor_npc_id: 'npc_cold_stallard', hack_difficulty: 3 } },
    { key: 'fans', room: 'deck', name: 'the fan bank', objectType: 'fixture',
      description: 'Eight fans in cowls along the deck, guarded, none of them in step with any other. The noise up here is a wall you lean on.',
      flags: { aliases: ['fans', 'bank', 'cowls'], interactions: { examine: 'Fan three runs slower than the rest and has done for months. It is not broken. It is set that way, and there is a piece of tape on its starter with a date on it.' } } },
  ],
  items: [
    { id: 'item_cold_ear', name: 'a pair of ear defenders', type: 'misc', value: 20, weight: 260, description: null, flags: {},
      tags: { stackable: true, description: 'Heavy plastic cups on a sprung band, the padding gone hard. She keeps a rack of them by the door and makes visitors wear them, and is not remotely flexible about it.' } },
    { id: 'item_cold_gasket', name: 'a spare plate gasket', type: 'misc', value: 14, weight: 60, description: null, flags: {},
      tags: { stackable: true, description: 'A rubber ring the size of a dinner plate, in a paper sleeve with the exchanger type on it. She has a great many and is candid that she will never use most of them.' } },
    { id: 'item_cold_flask', name: 'a flask of something hot', type: 'drink', value: 5, weight: 400, description: null, flags: {},
      tags: { stackable: false, description: 'Filled off a tap on the return main, which is the hottest water in the quarter and is technically not for drinking. It is strong tea by the time it reaches you and nobody has ever complained.' } },
  ],
  npc: {
    id: 'npc_cold_stallard', name: 'Verity Stallard', sex: 'female', hp: 38,
    homeRoom: 'deck', workRoom: 'floor', shopName: 'Cold Comfort',
    description: 'A wiry woman in a boiler suit with ear defenders pushed up on her head like a hairband, carrying a clipboard she does not look at. She has the habit, from years on this floor, of standing closer to people than they expect and speaking at a level that is exactly right in here and slightly too loud everywhere else.',
    clothing: ['a grey boiler suit, damp at the shoulders because everything in here is damp', 'ear defenders pushed up on her head, on and off twenty times an hour', 'steel-toed boots with the tread gone smooth from wet plate', 'a vest and plain underthings'],
    inventory: [
      { item_id: 'item_cold_ear', price: 20 },
      { item_id: 'item_cold_gasket', price: 14 },
      { item_id: 'item_cold_flask', price: 5 },
    ],
    chitchat: [
      'Stallard lays a palm on an exchanger, waits, moves along two and does it again.',
      'She writes a number on the board without checking a gauge, then goes and checks the gauge.',
      'She pulls the ear defenders down, listens to something, and pushes them back up.',
      'She kicks a drain channel clear with the side of her boot as she passes.',
      'She looks up at the deck through the open stairwell for a moment, counting fans.',
    ],
    dialogue: {
      root: {
        text: '"Defenders on, they\'re by the door." She taps her own, up on her head. "Then you can go anywhere you like except up the stair without me."',
        text_by_relation: {
          first: 'The woman on the floor is in front of you faster than you expected and closer than you expected, and she is holding out a pair of ear defenders before she has said anything.\n\n"On. Now, please." She waits until they are. "Verity Stallard. This is a cooling plant."\n\nShe says the rest at a volume that would be rude anywhere else and is exactly right here.\n\n"Everything you can hear is heat leaving. The Ascendants make an enormous amount of it up at the vats and it comes down here and goes out of the top of this building, and if it stopped doing that for about four hours they would have a very bad week."',
          known: '"Defenders." She points at the rack without slowing down. "Then come through, I\'m on number six."',
          familiar: 'She has a flask poured before you are through the door and the defenders held out in the other hand.\n\n"Six is stripped and back together and it is behaving," she says. "You can tell me I was right about that, I have had nobody to tell all week."',
        },
        options: [
          { label: 'What is all this cooling?', next: 'what' },
          { label: 'What have you got?', next: '__shop__' },
          { label: 'Where does the pipe across the road go?', next: 'pipe' },
          { label: 'Heard anything?', next: 'gossip' },
          { label: 'I\'ll get out of the noise.', next: 'bye', enabled: true, actions: [], conditions: [] },
        ],
      },
      what: {
        text: '"The vats." She points north with the clipboard, through the wall. "Printing a body is mostly a heat problem. Everybody thinks it is a chemistry problem. It is a heat problem with some chemistry in it."\n\n"They pull the heat out up there into a circuit and the circuit comes down here, and I take it out of the water and put it into the air. Eight fans. That is the entire mystery."',
        options: [
          { label: 'Does the Spire know you exist?', next: 'what_know' },
          { label: 'Back.', next: 'root' },
        ],
      },
      what_know: {
        text: '"Somebody up there knows, because somebody pays me." She almost laughs. "Nobody has ever come down. In six years I have had one man from the campus in this building and he wanted to see the board, not the plant."\n\n"That suits me. It means nobody has ever told me how to run it, and I have run it better than the paperwork asks for, which is the only kind of showing off available to me."',
        options: [{ label: 'Back.', next: 'what' }],
      },
      pipe: {
        text: '"Into the glass house." No hesitation at all. "Return side, before it goes to the fans. It is heat I am paying to throw away, so it costs me nothing and it costs her nothing, and there is a barrel of lemons in my office because of it."\n\n"There is no meter and there is no contract. A man who is not me made that arrangement standing in the road and then left, and I inherited it and I have never once thought about undoing it."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      gossip: {
        text: '"The exchange across the row hums at a frequency that gets into my floor, and I have told the caretaker, and he agrees with me, and neither of us can do anything." A shrug. "The fire station keeps asking to run a drill through here and I keep saying yes and they never come."\n\n"And somebody has been selling plots along this road. I would not put a house next to eight fans. I said so. He wrote it down and thanked me."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      bye: { text: '"Defenders back on the rack," she says. "People take them. I would rather they asked."', options: [] },
    },
  },
});

// ── Holding Pattern ──────────────────────────────────────────────────────────
// A gasholder: a telescoping drum in a lattice guide frame, which rises and falls with the
// city's demand and is the one piece of machinery in Coldwater you can read from a mile off.
SPECS.push({
  slug: 'holder', name: 'Holding Pattern', type: 'gasholder',
  x: 905, y: 917, entrance: 'north', floors: 6, marker: 'HP', district: 'halcyon_fields',
  facade: {
    bgColor: '#141719', color: '#8e9aa0',
    description: 'A lattice frame of riveted standards and cross-bracing, and inside it a steel drum that rides up and down on rollers according to how much gas the city is holding. Today it is about two thirds up and there is a tide line of rust round it marking every level it has ever rested at. At the foot of the frame, dwarfed by it, a small brick gauge house with a slate roof and a door painted the same green as everything the works has ever owned.',
  },
  rooms: [
    { key: 'gauge', name: 'The Gauge House', floor: 'stone',
      description: 'One room at the foot of the frame, brick, with a stove and a kettle and a long bench of instruments under the window: a pressure gauge the size of a dinner plate, a chart recorder scratching away on a drum, and a position indicator whose needle stands wherever the holder does. Through the window the lattice goes up and out of the top of the frame, and you have to duck to see the crown of it.',
      window: { name: 'the gauge house window', description: 'A small square window facing the frame, so that a man at the bench can look up and check with his eyes what the needle has just told him. The glass is old and green and slightly wrong.', light: 0.4, visibility: 0.6 } },
  ],
  utility: { name: 'The Valve Pit', floor: 'concrete',
    description: 'A brick pit under the gauge house reached by a ladder, holding the inlet and outlet valves, a rack of keys for them and the cabinet. Everything down here is painted the same green and everything green has been repainted over rust at least twice.' },
  lights: {},
  props: [
    { key: 'bench', room: 'gauge', name: 'the instrument bench', objectType: 'fixture',
      description: 'A long bench under the window: a pressure gauge the size of a dinner plate, a chart recorder scratching on a slow drum, and the position indicator. A tin box at the end holds the takings.',
      flags: { aliases: ['bench', 'gauges', 'instruments', 'tin'], vendor_safe: true, vendor_npc_id: 'npc_holder_creel', hack_difficulty: 3 } },
    { key: 'chart', room: 'gauge', name: 'the chart recorder', objectType: 'decoration',
      description: 'A pen on an arm scratching a line onto a paper drum that turns once a day. The used charts are in a box under the bench, in order, going back years.',
      flags: { aliases: ['chart', 'recorder', 'drum'], interactions: { examine: 'Every chart is the same shape: up through the evening, flat overnight, and a long slide from six in the morning. You could set a clock by the corner at eight.' } } },
    { key: 'stove', room: 'gauge', name: 'the stove', objectType: 'furniture',
      description: 'A small iron stove with a kettle permanently on it and two chairs facing it, though only one of them is ever sat in.',
      flags: { aliases: ['stove', 'kettle', 'fire'], interactions: { sit: 'You take the chair that is not his. It is colder than the other one and he does not remark on it.' } } },
  ],
  items: [
    { id: 'item_holder_chart', name: 'a used day chart', type: 'media', value: 3, weight: 6, description: null, flags: {},
      tags: { stackable: true, description: 'A paper disc with a day of the city\'s gas demand scratched onto it in ink, dated in the middle in pencil. He sells them for three and he will tell you what was happening on that day, and he will be right.' } },
    { id: 'item_holder_key', name: 'a valve key', type: 'misc', value: 30, weight: 700, description: null, flags: {},
      tags: { stackable: true, description: 'A long iron tee for turning a buried valve, works-green under the rust. This one is a spare off the rack in the pit and fits about half the stop taps in the quarter.' } },
    { id: 'item_holder_tea', name: 'a mug off the stove', type: 'drink', value: 2, weight: 300, description: null, flags: {},
      tags: { stackable: false, description: 'Stewed to within an inch of its life on a stove that has not gone out in living memory. There is no milk and he does not apologise for that.' } },
  ],
  npc: {
    id: 'npc_holder_creel', name: 'Barnaby Creel', sex: 'male', hp: 35,
    homeRoom: 'gauge', workRoom: 'gauge', shopName: 'Holding Pattern',
    description: 'An old man in a works-green jacket sitting sideways to the bench so he can see both the needle and the window at once. He has a pipe he does not light and has not lit in a very long time, for reasons anybody standing under a gasholder can work out. He looks up when the needle moves and not when the door does.',
    clothing: ['a works-green serge jacket with the company badge unpicked off the breast', 'a flannel shirt buttoned to the collar, no tie', 'heavy trousers and boots polished on the toe only', 'a vest and long underthings, because the gauge house is cold'],
    inventory: [
      { item_id: 'item_holder_chart', price: 3 },
      { item_id: 'item_holder_key', price: 30 },
      { item_id: 'item_holder_tea', price: 2 },
    ],
    chitchat: [
      'Creel looks at the needle, then out of the window at the drum, and is satisfied by the agreement.',
      'He takes the unlit pipe out of his mouth, looks at it, and puts it back.',
      'The chart pen scratches half an inch and he does not need to watch it to know.',
      'He turns the kettle a quarter turn on the stove for no reason either of you could name.',
      'He writes the level in a book, and under it the time, and the time is to the minute.',
    ],
    dialogue: {
      root: {
        text: '"Come in out of it." He does not get up. "Kettle\'s on and the chair\'s free. Don\'t light anything."',
        text_by_relation: {
          first: 'The old man at the bench looks up at the needle first, and only then at you, and does not seem to think that needs explaining.\n\n"Creel." He takes the pipe out of his mouth. "Shut the door, it swings. And do not light anything anywhere on this plot, and I will keep saying that to you every time, and you will get used to it."\n\nHe nods at the window and the lattice going up past it.\n\n"That is a holder. It goes up when the city is not using gas and down when it is. You can read this whole quarter off it from a mile away if you know how, and almost nobody does."',
          known: '"Sit down." The kettle is already coming forward on the stove. "She\'s at two thirds and steady."',
          familiar: 'He has the second chair pulled round before you are properly in, and the mug is poured.\n\n"Look at the chart," he says, pleased with something. "Last night. Tell me what you think happened at about half eleven and then I will tell you if you are right."',
        },
        options: [
          { label: 'How do you read it?', next: 'read' },
          { label: 'What have you got?', next: '__shop__' },
          { label: 'Is any of this dangerous?', next: 'danger' },
          { label: 'Heard anything?', next: 'gossip' },
          { label: 'I\'ll leave you to the needle.', next: 'bye', enabled: true, actions: [], conditions: [] },
        ],
      },
      read: {
        text: '"Height is what is in her." He points out of the window with the pipe stem. "Low in the evening because everybody is cooking and lit. High by four in the morning. That is the ordinary shape and you would know it in a week."\n\n"What is interesting is when she does not do that. A works starting up. A street losing its supply. A cold snap two hours before anybody outside feels it. It is all on that drum before it is anywhere else."',
        options: [
          { label: 'Does anybody ask you?', next: 'read_ask' },
          { label: 'Back.', next: 'root' },
        ],
      },
      read_ask: {
        text: '"Nobody has asked me anything in eleven years." Not bitter. Faintly amused. "The works send a man to read the meters quarterly and he does not come in."\n\n"I keep the charts. They are in that box in order and they are the only continuous record of what this city has been doing hour by hour for as long as I have been sat here. If the day ever comes that somebody wants to know, it will be here, and it will be right."',
        options: [{ label: 'Back.', next: 'read' }],
      },
      danger: {
        text: '"Yes." Flat, immediate, no performance in it at all. "It is a very large amount of gas in a steel can, and the can is a hundred years old, and the only thing between it and the air is water in a tank."\n\n"Which is why I sit here and look at a needle, and why the pipe is not lit, and why I will be rude to you about a match and will not be sorry. The holder is fine. Holders are fine. People are the problem and I am the one who is here."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      gossip: {
        text: '"Fans come on down the row about four and I can hear them from here, which means the vats are busy, which means somebody is being printed." He says it as a weather observation. "Substation lad is frightened of this plot and walks the long way round it."\n\n"And somebody put a road through the meadow. I watched them cut it. There were kerbstones under the grass already, all the way along, and nobody who came to lay it seemed to know that."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      bye: { text: '"Mind the step," he says. "And nothing lit."', options: [] },
    },
  },
});

// ── Current Affairs ──────────────────────────────────────────────────────────
// The grid tap that feeds the campus. A fenced yard of transformer tanks and lattice gantry
// under warning signs nobody reads, and one small control room with one frightened man in it.
SPECS.push({
  slug: 'current', name: 'Current Affairs', type: 'substation',
  x: 907, y: 917, entrance: 'north', floors: 2, marker: 'CA', district: 'halcyon_fields',
  facade: {
    bgColor: '#191b17', color: '#a6ae96',
    description: 'A palisade fence with spikes turned outward, and behind it a yard of grey transformer tanks standing in bunds, each with a radiator bank down its flank and a stencilled number. Over them a lattice gantry carries the busbars in, dead straight, from a run of poles going away north. Signs on the fence at every second bay say DANGER OF DEATH with a symbol under them, and the signs are new, which is the only thing on the plot that is. It hums, on one note, always.',
  },
  rooms: [
    { key: 'switch', name: 'The Switch Room', floor: 'concrete',
      description: 'A single-storey brick room at the corner of the yard, air-conditioned and startlingly quiet after the hum outside. One wall is a mimic panel: the whole substation drawn as a diagram in enamel, with a lamp at every switch, and the lamps say what is closed and what is open. A desk faces it. There is a rubber mat on the floor in front of the panel and you are supposed to stand on it, and the man here always does.',
      window: { name: 'the yard window', description: 'A narrow window of laminated glass looking out at the tanks. You can see four of the eight bays from the desk, which he will tell you is not enough.', light: 0.4, visibility: 0.7 } },
  ],
  utility: { name: 'The Cable Basement', floor: 'concrete',
    description: 'Under the switch room, where the cables come in: a chamber of ducts with the cores fanned out and bonded, everything labelled twice, and the cabinet in the corner. It is warmer down here than upstairs and there is a faint smell of hot varnish that he says is normal and dislikes.' },
  lights: {},
  props: [
    { key: 'mimic', room: 'switch', name: 'the mimic panel', objectType: 'fixture',
      description: 'The whole substation drawn on enamel across one wall, with a lamp at every switch. Red is closed, green is open, and there is one lamp near the bottom that is neither.',
      flags: { aliases: ['mimic', 'panel', 'diagram'], interactions: { examine: 'The odd lamp is bay seven. Its label has been overwritten in marker with a different bay number, and then that has been crossed out too.' } } },
    { key: 'desk', room: 'switch', name: 'the duty desk', objectType: 'fixture',
      description: 'A steel desk facing the panel with a log, a telephone that works, a cash drawer and a mug ring nobody has cleaned off.',
      flags: { aliases: ['desk', 'log', 'drawer'], vendor_safe: true, vendor_npc_id: 'npc_current_tench', hack_difficulty: 4 } },
    { key: 'mat', room: 'switch', name: 'the rubber mat', objectType: 'decoration',
      description: 'A thick black mat on the floor in front of the panel, edges curling, with two pale patches in it exactly where a person\'s feet go.',
      flags: { aliases: ['mat', 'rubber'], interactions: { examine: 'The pale patches are worn right through to the backing. Whoever has stood here has stood here in the same place a very great many times.' } } },
  ],
  items: [
    { id: 'item_current_gloves', name: 'a pair of rubber gauntlets', type: 'misc', value: 45, weight: 380, description: null, flags: {},
      tags: { stackable: true, description: 'Elbow-length, dusted inside, with a test date stamped on the cuff that is still in. He will sell you a pair and then tell you, at length, what they are and are not for.' } },
    { id: 'item_current_fuse', name: 'a cartridge fuse', type: 'misc', value: 8, weight: 90, description: null, flags: {},
      tags: { stackable: true, description: 'A ceramic barrel with brass caps and a rating stamped along it, out of the spares drawer. Half the machinery in this quarter takes one of these and nobody keeps any.' } },
    { id: 'item_current_lamp', name: 'a hand inspection lamp', type: 'misc', value: 22, weight: 340, description: null, flags: {},
      tags: { stackable: true, description: 'A caged bulb on a long lead with a hook, the sort that lives in a basement. The lead has been shortened once and the repair is very neat indeed.' } },
  ],
  npc: {
    id: 'npc_current_tench', name: 'Oriel Tench', sex: 'male', hp: 29,
    homeRoom: 'switch', workRoom: 'switch', shopName: 'Current Affairs',
    description: 'A thin, careful man in his thirties standing on the mat in front of the panel with his hands behind his back, which is a habit rather than a pose. He checks things twice while you are talking to him and apologises for it each time. He is not nervous about you. He is nervous about the yard, permanently, and he is right to be.',
    clothing: ['a navy works coat with the arc-rated label still legible on the inside', 'a buttoned shirt and a tie he does not loosen even in here', 'heavy trousers with the cuffs inside his boots, deliberately', 'a vest and plain underthings'],
    inventory: [
      { item_id: 'item_current_gloves', price: 45 },
      { item_id: 'item_current_fuse', price: 8 },
      { item_id: 'item_current_lamp', price: 22 },
    ],
    chitchat: [
      'Tench reads the mimic panel left to right, all of it, and then does it again.',
      'He steps off the mat, remembers, and steps back on.',
      'He writes the time in the log and nothing beside it, which is what the log is for.',
      'He glances at bay seven\'s lamp, which is neither colour, and looks away again.',
      'Outside, the hum changes by about nothing, and he lifts his head anyway.',
    ],
    dialogue: {
      root: {
        text: '"Stay on this side of the desk and we will get on very well." He is entirely polite about it. "The yard is not somewhere you can go. Not with me, not for a minute, not to look."',
        text_by_relation: {
          first: 'The man in front of the panel turns round with his hands still behind his back, and the first thing he does is put himself between you and the door to the yard, without appearing to.\n\n"Oriel Tench. You should not be able to get in here, and the fact that you could is something I have written three letters about."\n\nHe relaxes about a degree.\n\n"Nothing in this room will hurt you. Everything through that door will kill you instantly, and not in a way that would look dramatic, which is the part people do not believe. So: this side of the desk."',
          known: '"You again, and on the right side of the desk." Almost warm. "What do you need?"',
          familiar: 'He is already reaching under the desk, and he actually smiles, which takes his whole face by surprise.\n\n"I kept you a fuse of the right rating," he says. "Do not tell me what it is for. I have decided I am happier not knowing and that is a new thing for me."',
        },
        options: [
          { label: 'What does this place feed?', next: 'feeds' },
          { label: 'What have you got?', next: '__shop__' },
          { label: 'What\'s wrong with bay seven?', next: 'seven' },
          { label: 'Heard anything?', next: 'gossip' },
          { label: 'I\'ll leave you to it.', next: 'bye', enabled: true, actions: [], conditions: [] },
        ],
      },
      feeds: {
        text: '"The campus, mostly." He indicates north on the panel without touching it. "The Spire, the vats, the clinic. And then this quarter, and then a share of the row beyond it, but the campus is the load. The campus is nearly all of the load."\n\n"Everything you can see out of that window exists so that a building four streets away never flickers. I find that easier to say out loud than most people find it to hear."',
        options: [
          { label: 'What if it did flicker?', next: 'feeds_fail' },
          { label: 'Back.', next: 'root' },
        ],
      },
      feeds_fail: {
        text: '"Then something in a tank up there stops being kept at the temperature it is kept at." He says it very evenly, which is how you can tell he has thought about it a great deal. "And I am told there are batteries for that, and I believe there are, and I have never been shown them."\n\n"So I keep two transformers on when one would do, which is wasteful and is entirely my decision, and nobody has ever queried it. I would rather be wasteful than find out."',
        options: [{ label: 'Back.', next: 'feeds' }],
      },
      seven: {
        text: 'He looks at the lamp that is neither colour and then makes himself look back at you.\n\n"Bay seven is isolated, and the label has been changed twice, and I did not change it." A pause. "It was isolated before I came. There is no work order for it. The cable from it goes north and it is not on any drawing I have."\n\n"I have asked. I got a form back confirming that bay seven is isolated, which I knew, and I have stopped asking, and I check that lamp about forty times a day."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      gossip: {
        text: '"The pump house man says there is no damp in his building and there is water everywhere in it, and I cannot make that make sense." He shakes his head. "The cooling plant says my transformers make her floor hum. They do. I cannot help it and I have told her so."\n\n"And there is a man selling building plots along this road who asked me whether the fence could be moved. I do not think he was being sly. I think he genuinely did not know what was behind it."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      bye: { text: '"Out the way you came," he says. "Not past the fence."', options: [] },
    },
  },
});

// ── Crossed Wires ────────────────────────────────────────────────────────────
// A telephone exchange. Windowless, louvred, humming, and still switching calls for a
// network whose subscribers are mostly gone. story.md: "The Architect's running something
// in there. Something heavy." This is a building that answers that line and never confirms it.
SPECS.push({
  slug: 'wires', name: 'Crossed Wires', type: 'exchange',
  x: 909, y: 915, entrance: 'south', floors: 5, marker: 'CW', district: 'halcyon_fields',
  facade: {
    bgColor: '#16171a', color: '#9a9c9e',
    description: 'A blank slab of pale brick five storeys high with no window anywhere in the first four of them, and a band of steel louvres across the whole of the fifth. There is one door, flush, steel, with no handle on the outside and a keyway rather than a lock you could look into. No sign, no plate, no name, though somebody has stencilled a six-figure number beside the door at waist height. It hums. Not loudly. Continuously.',
  },
  rooms: [
    { key: 'apparatus', name: 'The Apparatus Room', floor: 'linoleum',
      description: 'Rank upon rank of selector frames from the floor to well over your head, running away into a distance the outside of the building did not prepare you for. Every few seconds, somewhere in the room, a selector steps: a small dry sound, then another answering it two rows over. Nobody has plugged anything in here for a very long time and the machinery is still working, patiently, in the dark, on something.',
      window: { name: 'the louvre band', description: 'High up on the fifth floor, seen from the gantry: steel louvres open a few degrees, admitting a grey line of light and a great deal of cold air. The extract has to go somewhere.', light: 0.2, visibility: 0.3 } },
    { key: 'frame', name: 'The Main Frame', floor: 'linoleum', from: 'apparatus', dir: 'east',
      description: 'A two-storey wall of terminations with the jumper wires running between the verticals in bunches thick as an arm, tied off every six inches for decades by people who took pride in it. The routing is beautiful and completely illegible. Somewhere in this wall is the answer to where the traffic is going, and finding it would be the work of years.' },
  ],
  utility: { name: 'The Battery Room', floor: 'tile',
    description: 'Below: two long rows of lead cells on glazed insulators, floated across the supply, holding the exchange up if the grid ever lets go. The acid smell is faint and permanent. The cabinet is on the end wall, and there is a logbook on a string beside it with an entry every week going back further than anybody currently alive here.' },
  lights: {
    frame: { name: 'the frame lamps', description: 'A run of bulkheads down the frame aisle, half of them out, the rest throwing enough light to read a tag by and not enough to see the top of the wall.', lumens: 700, type: 'overhead' },
  },
  props: [
    { key: 'racks', room: 'apparatus', name: 'the selector frames', objectType: 'fixture',
      description: 'Ranks of them running away into the dark, each rack numbered, every selector on every rack stepping now and then on business of its own.',
      flags: { aliases: ['racks', 'frames', 'selectors'], interactions: { examine: 'The wipers are bright where they travel and tarnished where they do not, and on most of the racks the bright arc is wide. Whatever is running in here is using nearly all of it.' } } },
    { key: 'desk', room: 'apparatus', name: 'the caretaker\'s table', objectType: 'fixture',
      description: 'A wooden table just inside the door with a kettle, a logbook, a ring of keys and a tin. It is the only piece of furniture in the room that a person could use.',
      flags: { aliases: ['table', 'desk', 'keys', 'tin'], vendor_safe: true, vendor_npc_id: 'npc_wires_bewick', hack_difficulty: 5 } },
    { key: 'jumpers', room: 'frame', name: 'the jumper field', objectType: 'fixture',
      description: 'Two storeys of terminations with the jumpers running between them in bunches, tied off every six inches. The tying is the work of people who cared and the routing is unreadable.',
      flags: { aliases: ['jumpers', 'frame', 'wires'], interactions: { examine: 'One bunch is newer than all the others. Not new. Newer. It runs up out of the field and away north through a hole in the wall that was cut rather than cast.' } } },
  ],
  items: [
    { id: 'item_wires_cord', name: 'a patch cord', type: 'misc', value: 9, weight: 60, description: null, flags: {},
      tags: { stackable: true, description: 'A fabric-braided cord with a brass plug at each end, off a switchboard that is not in this building any more. Useless. Beautifully made. He sells them to anybody who wants one and is glad when somebody does.' } },
    { id: 'item_wires_relay', name: 'a spare relay', type: 'misc', value: 16, weight: 120, description: null, flags: {},
      tags: { stackable: true, description: 'A coil, an armature and a set of contacts on a bakelite base, in a paper sleeve with a code on it. The stores here hold thousands and the exchange has not called for one in years.' } },
    { id: 'item_wires_log', name: 'a page of the log', type: 'media', value: 4, weight: 4, description: null, flags: {},
      tags: { stackable: true, description: 'A torn-out week from the battery logbook: specific gravity, temperature, and a signature, every seven days without a gap. The handwriting changes four times down the page and the format never does.' } },
  ],
  npc: {
    id: 'npc_wires_bewick', name: 'Silas Bewick', sex: 'male', hp: 33,
    homeRoom: 'frame', workRoom: 'apparatus', shopName: 'Crossed Wires',
    description: 'A quiet, tidy man of indeterminate middle age in a grey coat, sitting at a wooden table just inside the door with a kettle and a logbook. He is the caretaker and he is, as far as he knows, the only person with a key. He talks in a low voice out of habit, because the room is listening in the only way a room like this can.',
    clothing: ['a grey cotton work coat buttoned to the throat, pockets weighed down with keys', 'a soft shirt and no tie, because there is no one to wear one for', 'plain trousers and soft shoes that make no noise on linoleum', 'a vest and plain underthings'],
    inventory: [
      { item_id: 'item_wires_cord', price: 9 },
      { item_id: 'item_wires_relay', price: 16 },
      { item_id: 'item_wires_log', price: 4 },
    ],
    chitchat: [
      'Bewick lifts his head at a selector stepping four rows away and then goes back to the log.',
      'He writes the specific gravity into the book, and the date, and blots it.',
      'He turns the ring of keys over on the table until the big one is on top.',
      'Somewhere deep in the racks three selectors step in quick succession, and he does not look up at all, which is worse.',
      'He wipes the table, which is clean, with a cloth, which is clean.',
    ],
    dialogue: {
      root: {
        text: '"Come in, and keep to the aisle." He says it quietly. "You can look at anything. Please do not touch a rack, and I am not being precious, I will explain if you want."',
        text_by_relation: {
          first: 'The door was open, which you did not expect, and there is a man at a table just inside it who looks up as though he has been expecting somebody for a long time and is not surprised it is you.\n\n"Silas Bewick. Caretaker." He puts the pen down. "I have the only key. That is not a boast, it is a complaint, and I have made it in writing."\n\nHe gestures at the racks going away into the dark.\n\n"This is a telephone exchange. It is a working telephone exchange. That is not the past tense and I want to be clear about it before you ask me anything else."',
          known: '"You came back." He moves the kettle onto the ring. "Sit down. Mind the aisle."',
          familiar: 'He has the second stool out before you are through the door and the kettle already on.\n\n"Rack forty-one was busy last night," he says, low. "Busier than Tuesday. I wrote it down. I do not know why I write it down."',
        },
        options: [
          { label: 'Who is it switching calls for?', next: 'who' },
          { label: 'What have you got?', next: '__shop__' },
          { label: 'What\'s the newer bunch of jumpers?', next: 'jumpers' },
          { label: 'Heard anything?', next: 'gossip' },
          { label: 'I should go.', next: 'bye', enabled: true, actions: [], conditions: [] },
        ],
      },
      who: {
        text: '"I do not know." He says it without any drama, which makes it worse. "There are perhaps forty working subscriber lines on this exchange and I have traced every one of them and they are a coal merchant, two pumping stations and a lot of empty offices."\n\n"The traffic on this floor is not forty lines\' worth. It has not been forty lines\' worth since before I started. Most of what steps in here is trunk, going through, and I cannot tell you where from or where to because the routing is in that wall and the wall is forty years of other people\'s jumpers."',
        options: [
          { label: 'Have you tried following one?', next: 'who_follow' },
          { label: 'Back.', next: 'root' },
        ],
      },
      who_follow: {
        text: '"Once. Properly, with a tone set, over a fortnight." He turns the keys over on the table. "I got it as far as the frame and then into a bunch that goes north out of the building, and north out of the building is the campus, and the campus is not a thing I can knock on."\n\n"So I stopped. I want to be honest that I stopped because I was frightened rather than because I ran out of method. The method was fine."',
        options: [{ label: 'Back.', next: 'who' }],
      },
      jumpers: {
        text: '"That is the bunch I followed." A small nod. "Newer than the field round it by a long way and older than me. Tied off by somebody who was taught the same way everybody here was taught, so it was not an outsider, whatever else it was."\n\n"It goes through a hole that was cut rather than cast, which means it went in after the building. And there is no record of it in any book in this exchange, and there is a book for everything, and I have read them all."',
        options: [
          { label: 'Do you think the Architect is in here?', next: 'jumpers_arch' },
          { label: 'Back.', next: 'root' },
        ],
      },
      jumpers_arch: {
        text: 'He is quiet for a while. A selector steps somewhere off to the left.\n\n"People say that about anything that hums." He picks the pen back up. "I have been in this room every working day for nine years and I have never seen anything I could point at and call strange. Racks step. That is what racks do. There is a lot of traffic. Traffic is not a personality."\n\nHe writes something in the log.\n\n"And I keep the batteries topped up on a Friday, and I have never once been late doing it, and I could not tell you who I think would mind."',
        options: [{ label: 'Back.', next: 'jumpers' }],
      },
      gossip: {
        text: '"The cooling plant says my frames put a hum through her floor. They do. It is the transformer in the battery room and it has been out of balance for years and I cannot get a part." He almost smiles. "The substation man will not come inside. He stood in the doorway once and went away again."\n\n"That is the whole of my society. The two of them, and the old boy at the holder, who at least has a stove."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      bye: { text: '"Pull it to behind you," he says. "It locks itself. Everything here does."', options: [] },
    },
  },
});

// ── Engine Trouble ───────────────────────────────────────────────────────────
// A fire station: a hose tower, three bay doors and a crew who are very good at a job they
// are almost never called to do, in a quarter that is mostly grass.
SPECS.push({
  slug: 'engine', name: 'Engine Trouble', type: 'fire_station',
  x: 910, y: 917, entrance: 'east', floors: 3, marker: 'ET', district: 'halcyon_fields',
  facade: {
    bgColor: '#1d1416', color: '#c06052',
    description: 'Three bay doors in red, tall enough and wide enough to take an appliance out at speed, with the aprons in front of them swept down to bare concrete. Above them two storeys of watch room and dormitory with ordinary windows, and standing off the north end a square hose tower going up another three storeys with louvres all the way and a hoist beam at the top. A bell is mounted on a bracket over the middle door and it is not decorative.',
  },
  rooms: [
    { key: 'bay', name: 'The Appliance Bay', floor: 'concrete',
      description: 'Three bays, two of them occupied, the third with a rectangle of clean floor where something used to stand. The appliances are red and scrupulous and the brass on them is the kind of bright that takes a rota. Boots and leggings stand ready in pairs beside each cab, folded down so a man can step into them. On the wall, a board of the quarter with pins in it, and every pin is a hydrant.',
      window: { name: 'the bay doors', description: 'Three of them, glazed across the top, showing a rectangle of Meltwater Row and the meadow past it. In daylight the bay is lit almost entirely through them.', light: 0.65, visibility: 0.8 } },
    { key: 'watch', name: 'The Watch Room', floor: 'linoleum', from: 'bay', dir: 'up',
      description: 'Up the stair over the bay: a long room with a table down the middle, mismatched chairs, a stove and a window that looks down Meltwater Row for a long way. The call board is on the end wall with the bell relay under it. There is a cribbage board on the table with a game abandoned in a winning position, and nobody has moved the pegs because nobody can agree whose turn it was.' },
  ],
  utility: { name: 'The Pump Store', floor: 'concrete',
    description: 'Under the bay: the spare lengths coiled on racks, the standpipes, a bench for testing, and the cabinet. Everything is labelled and everything is where the label says, which after a while stops looking like tidiness and starts looking like a practised fear.' },
  lights: { watch: { name: 'the watch room lamp', description: 'A shaded bulb over the middle of the table, low enough to put a good light on cards and leave the corners of the room in the dark.', lumens: 900, type: 'lamp' } },
  props: [
    { key: 'appliances', room: 'bay', name: 'the appliances', objectType: 'fixture',
      description: 'Two of them, red, backed in ready to go, with the brass work bright and the ladders racked. The third bay is empty and its floor is cleaner than the other two.',
      flags: { aliases: ['appliance', 'engine', 'engines', 'tender'], interactions: { examine: 'The empty bay has an outline painted on the floor and the outline is for something longer than either of the two that are here.' } } },
    { key: 'board', room: 'bay', name: 'the hydrant board', objectType: 'decoration',
      description: 'A plan of the quarter on the wall with a pin at every hydrant, and a length of string on a nail beside it for measuring a run.',
      flags: { aliases: ['board', 'hydrants', 'plan'], interactions: { examine: 'The new streets have been added in pencil, accurately, with the hydrants marked before they were laid. Somebody walked the row with the drawings.' } } },
    { key: 'lockers', room: 'bay', name: 'the kit', objectType: 'container',
      description: 'Boots and leggings in pairs beside each cab, folded down so a man can step into them, and helmets on the shelf above with the names painted on.',
      flags: { aliases: ['kit', 'boots', 'lockers', 'helmets'], vendor_safe: true, vendor_npc_id: 'npc_engine_thorne', hack_difficulty: 2 } },
    { key: 'crib', room: 'watch', name: 'the cribbage board', objectType: 'furniture',
      description: 'On the table, a game abandoned in a winning position, the pegs untouched because nobody can agree whose turn it was.',
      flags: { aliases: ['cribbage', 'crib', 'board', 'cards'], interactions: { examine: 'The winning peg is one hole from home. Whoever was about to lose has clearly been in no hurry to settle it and has had a long time not to.' } } },
  ],
  items: [
    { id: 'item_engine_hose', name: 'a length of hose', type: 'misc', value: 35, weight: 2200, description: null, flags: {},
      tags: { stackable: true, description: 'Canvas over rubber, rolled and strapped, with instantaneous couplings at both ends and a test date stencilled on the strap. Condemned for the run and perfectly good for anything else, which is why she sells them.' } },
    { id: 'item_engine_axe', name: 'a fireman\'s axe', type: 'weapon', value: 90, weight: 1400, description: null, flags: {},
      tags: { stackable: false, description: 'A pick head on a hickory haft with a leather belt loop, edge kept properly. It is a tool for getting through a door and it is very obviously also the other thing, and she will look at you while you buy it.' } },
    { id: 'item_engine_tea', name: 'a mug from the watch room', type: 'drink', value: 2, weight: 320, description: null, flags: {},
      tags: { stackable: false, description: 'Strong, wet and free if you are civil about it. She charges two because people who pay for a thing come back and people who are given a thing do not.' } },
  ],
  npc: {
    id: 'npc_engine_thorne', name: 'Dilys Thorne', sex: 'female', hp: 46,
    homeRoom: 'watch', workRoom: 'bay', shopName: 'Engine Trouble',
    description: 'A square, capable woman in her forties in shirtsleeves and braces, standing in the bay with a mug in one hand and her attention on the doors. She has the specific calm of somebody whose job is nearly all waiting and occasionally all of everything, and she does not waste any of it on being pleasant for its own sake, which somehow comes out as warmth.',
    clothing: ['a service shirt with the sleeves turned back and the collar open, braces over it', 'uniform trousers with a crease and a hard belt', 'boots she can step into the leggings from, kept by the cab', 'a vest and plain underthings'],
    inventory: [
      { item_id: 'item_engine_hose', price: 35 },
      { item_id: 'item_engine_axe', price: 90 },
      { item_id: 'item_engine_tea', price: 2 },
    ],
    chitchat: [
      'Thorne looks at the bay doors, which have not moved, and drinks her tea.',
      'She runs a thumb along a brass rail on the near appliance and checks her thumb.',
      'She straightens a pair of boots by half an inch so the pair is square to the cab.',
      'She glances at the hydrant board and at nothing on it in particular.',
      'Somewhere upstairs a chair scrapes, and she says a name at the ceiling without raising her voice, and the scraping stops.',
    ],
    dialogue: {
      root: {
        text: '"Come in, don\'t stand in the door." She does not put the mug down. "Anything you want to look at you can look at. Don\'t sit in a cab."',
        text_by_relation: {
          first: 'The woman in the bay watches you come in the way somebody watches a door they are paid to watch, and then stops watching, which is the part that puts you at ease.\n\n"Thorne. Station officer, for my sins and for four people." She nods at the appliances. "You can look at anything in here. You cannot sit in a cab, and that is not me being awkward, it is that people knock things."\n\nShe indicates the board on the wall.\n\n"Every hydrant in this quarter is on that. I put the new ones on before the road went down. If there is ever a fire in Halcyon Fields I would like it to be a boring one."',
          known: '"Back again." She tips the mug at the kettle upstairs. "There\'s tea if you want it and it\'s two."',
          familiar: 'She has already shouted something up the stair about a second mug before she turns round.\n\n"Sit on the running board, not in the cab," she says. "I have said that to you before and I will say it to you again, and one day you will do it and I will have to be unpleasant."',
        },
        options: [
          { label: 'How often do you get called?', next: 'called' },
          { label: 'What have you got?', next: '__shop__' },
          { label: 'What happened to the third appliance?', next: 'third' },
          { label: 'Heard anything?', next: 'gossip' },
          { label: 'I\'ll let you get on.', next: 'bye', enabled: true, actions: [], conditions: [] },
        ],
      },
      called: {
        text: '"Properly? Eleven times last year." She is not embarrassed by the number. "Chimney fires, a lorry, and one bad one down the Ashway that took all night and I do not talk about."\n\n"The rest is people stuck, doors off, a cat once, and pumping cellars out after weather. Most of this job is a pump and a ladder and not being in a hurry about it."',
        options: [
          { label: 'Eleven doesn\'t sound like much.', next: 'called_much' },
          { label: 'Back.', next: 'root' },
        ],
      },
      called_much: {
        text: '"It is not." She says it flatly. "And on the twelfth, which has not happened yet, the whole point of me is whether four people who have been playing cribbage for a fortnight can get out of that door in ninety seconds with the right kit on."\n\n"So we drill. Every day, twice, and they moan, and I make them do it again when it is slow. Being bored is the job. Being bad at it because you were bored is not something I will have in this building."',
        options: [{ label: 'Back.', next: 'called' }],
      },
      third: {
        text: '"Taken." No edge on it whatsoever, which is somehow worse. "Requisitioned north, six years back, and the paper said temporary and the paper is still in the drawer."\n\n"So we are two appliances for a quarter that is about to double in size, if the man with the hoarding is right. I have written about that. I have had a letter back confirming receipt of my letter."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      gossip: {
        text: '"The gasholder is the thing I think about." She says it without any theatre. "Old man there is careful and I would not swap him for anybody. But it is a great deal of gas and my nearest hydrant to it is further than I would like, and he knows that, and we have walked it together."\n\n"The exchange has no way in that I could use. One steel door and a caretaker with the only key. I have asked him for a copy twice and he has said no twice, and I do not think that is him being difficult."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      bye: { text: '"Mind the apron," she says. "It is swept for a reason."', options: [] },
    },
  },
});

// ── run ──────────────────────────────────────────────────────────────────────
for (const spec of SPECS) {
  const r = await authorBuilding(store, spec);
  console.log(`  ${spec.name.padEnd(18)} ${spec.x},${spec.y}  ent=${String(spec.entrance).padEnd(5)} ${r.facadeId}`);
}
const written = store.flush({ dryRun: DRY });
console.log(`\n${DRY ? 'DRY RUN — ' : ''}${written.length} file(s) ${DRY ? 'would change' : 'written'}`);
if (store.droppedRuntime.length) console.log(`  (dropped ${store.droppedRuntime.length} runtime write(s))`);
