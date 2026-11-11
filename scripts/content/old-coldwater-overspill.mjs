// ONE-SHOT: the Overspill. Old Coldwater takes the ground the Curtain gave back south of the Pitch.
//
//   node scripts/content/old-coldwater-overspill.mjs [--dry-run]
//
// See docs/proposals/old-coldwater.md, "The Overspill". When the south wall moved from y 919 to
// y 923 (curtain-square.mjs, 2026-11-04), x 919-926 / y 919-922 became meadow inside the wall,
// right behind the Pitch. This paints it into the slum: a lane, a market yard, two rows of camp,
// five shacks and two ruins, and puts eighteen people in it.
//
// CONTENT FILES ONLY. Afterwards:
//   node scripts/content/mint-connections.mjs --write   (the sealed edges round the new buildings)
//   npm run shapes:bake                                 (the shack variants are new model keys)
//   node scripts/snapshot-flight-world.mjs
//   npm run content:lint
//
// ⚠ THE SHACKS AND RUINS ARE NOT FACADES. No door, no interior, no keeper, no map icon: the ruin
// rule (build-old-coldwater.mjs) applies to both. A shack is somebody's house and nobody is asking
// you in. `is_building` takes the tile out of the walk graph and raises the mass.
// ⚠ Every new building was checked against the walk graph by hand before it went in: y 922 is still
// reached through the Swap, the Snicket, the meadow at x 918 and the wall row, so none of them is a
// cut vertex. Nothing under the plot exits `up` (no Under seam), and no NPC, spawn or quest named
// any of these tiles.

import { loadContentStore } from '../../tools/lib/content-store.mjs';

const dryRun = process.argv.includes('--dry-run');
const store = loadContentStore();

const REGION = 'region_coldwater';
const DISTRICT = 'slum';
const idFor = (x, y) => `zone_district_${x}_${y}`;
const LANE_SCAV = 'scav_roadside_junk', CAMP_SCAV = 'scav_consumer_trash';

// ── the district ─────────────────────────────────────────────────────────────
// ⚠ The prefixes must name the new streets, or districtFor's fallback puts the boundary line in
// the wrong place for anything that doesn't carry flags.district.
{
  const d = store.get('districts', DISTRICT);
  const prefixes = [...new Set([...(d.prefixes || []), 'tenter lane', 'the overspill', 'the swap', 'the snicket', 'wallside', 'the drum', 'under the wall', 'the east wall', 'the far corner'])];
  const signature = [...d.signature];
  const extra = 'Nails squeal coming out of old timber. Everybody south of the Pitch is building something.';
  if (!signature.includes(extra)) signature.push(extra);
  store.patch('districts', DISTRICT, { prefixes, signature });
}

// ── ambient lines, by kind ───────────────────────────────────────────────────
const AMB = {
  lane: [
    'A handcart goes by loaded with bricks, one wheel squealing.',
    'Somebody shouts a price across the lane and somebody else laughs at it.',
    'A dog trots past with something in its mouth and does not stop.',
    'Two men carry a door between them, arguing about which way is level.',
    'Hammering starts up somewhere south of the lane, stops, and starts again.',
    'A woman goes by with a jerrycan in each hand, walking carefully.',
  ],
  camp: [
    'A radio in one of the tents finds a station, loses it, and finds it again.',
    'Someone shakes out a blanket and hangs it over a guy line.',
    'A kettle starts to whistle and is taken off quickly.',
    'A tent flap opens, somebody looks out at the weather, and it closes.',
    'Somebody is snoring in a tent nearby, loudly and evenly.',
    'A man walks between the tents counting pegs under his breath.',
  ],
  wall: [
    'The Curtain hums, steady, a few feet off.',
    'A moth batters against the light of the wall and drops.',
    'Out past the wall, dust lifts off the red flats and settles again.',
  ],
  market: [
    '"Batteries, tested, all of them tested!"',
    'A stallholder holds a boot up to the light and checks the sole.',
    'Somebody haggles over a coat and walks off. They come back a minute later.',
    'Coins are counted out onto a trestle one at a time.',
  ],
  drum: [
    'The drum spits as somebody feeds it a broken chair leg.',
    'Somebody pulls a crate closer to the fire and sits.',
    'Sparks go up out of the drum and go out.',
  ],
};
const pick = (pool, seed, n) => { const out = []; for (let i = 0; i < n; i++) out.push(pool[(seed * 7 + i * 3) % pool.length]); return [...new Set(out)]; };

// ── the ground ───────────────────────────────────────────────────────────────
// kind: lane (unmade track, street_life) | camp (flags.camp, the tent mark) | yard (open ground) |
//       wall (a Curtain tile kept walkable; `camp` per row) | market (camp ground with stalls)
// ⚠ `dirt` and `ash` only: both are auto_tile false, so nothing here draws a paved connector
// (the second pass in the doc says why dirt_road is wrong for a cart track).
const KIND = {
  lane:   { terrain: 'dirt', theme: 'city',        scav: LANE_SCAV, street_life: true, amb: 'lane' },
  camp:   { terrain: 'ash',  theme: 'residential', scav: CAMP_SCAV, camp: true, amb: 'camp' },
  market: { terrain: 'ash',  theme: 'city',        scav: LANE_SCAV, camp: true, street_life: true, amb: 'market' },
  drum:   { terrain: 'ash',  theme: 'residential', scav: CAMP_SCAV, camp: true, amb: 'drum' },
  wall:   { terrain: 'ash',  theme: 'residential', scav: CAMP_SCAV, camp: true, amb: 'wall' },
  bare:   { terrain: 'ash',  theme: 'residential', scav: CAMP_SCAV, amb: 'wall' },
};

const TILES = [
  // ── The Overspill (y 919): the old line of the south wall, tents on it within the week ─────
  [919, 919, 'camp', 'The Overspill', 'The western end of the Overspill, where the camp has reached the meadow and stopped for now. Most of the tents here still have the shop creases in the canvas. A line of stones marks out where somebody means to put the next one.'],
  [920, 919, 'camp', 'The Overspill', 'A strip of dead grass a stride wide runs east to west through the tents, dead straight, where the Curtain stood until this month. Nothing grows on it yet. People step over it without looking down.'],
  [921, 919, 'camp', 'The Overspill', 'The camp south of the Pitch. The pegs here are new and bright and the guy lines are tight. A man is driving in a peg with half a brick.'],
  [922, 919, 'camp', 'The Overspill', 'Tents in two uneven rows, each with a square of carpet laid outside the flap. A cable runs overhead from a pole in the Pitch to a pole here, with one bulb on it that has never lit.'],
  [923, 919, 'camp', 'The Overspill', 'Pitches marked out with string, three of them still empty. A man sits on a crate beside them and asks everybody who passes how many are in their family.'],
  [924, 919, 'camp', 'The Overspill', 'A tent has gone up round an old fence post the wall left standing, so the post comes out through the ridge. The canvas is wired to it. Washing hangs off the top.'],
  [925, 919, 'camp', 'The Overspill', 'Bigger pitches at this end, with windbreaks of corrugated tin wired to stakes on the south side. The tin came off the old houses on Tenter Lane, and some of it still has paint on.'],
  [926, 919, 'camp', 'The Overspill', 'The Overspill runs up to the east wall here. Two tents share one fly sheet stretched between them, and a cooking pot sits on three bricks in the gap with its lid on.'],

  // ── Tenter Lane (y 920): the old town's south lane, back inside the wall ───────────────────
  [919, 920, 'lane', 'Tenter Lane', 'Tenter Lane starts at the edge of the meadow as two cart ruts, filled with gravel for ten yards by somebody who then stopped. It runs east between the tents and the old houses. Everything on its south side was outside the wall until this month.'],
  [920, 920, 'lane', 'Tenter Lane', 'Packed red dirt, rutted, with old kerbstones showing along the south side. Somebody has swept a doorstep that has no house behind it any more.'],
  [921, 920, 'lane', 'Tenter Lane', 'The lane passes the mouth of the Swap, where trestles stand under tarps on the south side. It is the loudest stretch of Tenter Lane by day. Two people are arguing about the price of a kettle.'],
  [922, 920, 'lane', 'Tenter Lane', 'The Stack leans out over the lane on the south side, three shacks high, with a ladder lashed up the front. The ground under it is littered with bent nails. People walk round it, not under.'],
  [923, 920, 'lane', 'Tenter Lane', 'The old school stands on the south side with its roof gone and its bell frame still up. A row of coat pegs runs along the porch wall at knee height. Tenter Lane carries on east.'],
  [924, 920, 'lane', 'Tenter Lane', 'A stretch of lane with a standpipe on it. Somebody has bolted a new handle on and the water still does not come. A row of empty jerrycans waits beside it anyway.'],
  [925, 920, 'lane', 'Tenter Lane', 'The Snicket opens south from here between the Pallet House and the Box. The lane is churned to mud where the handcarts turn. Rain runs down it toward the wall.'],
  [926, 920, 'lane', 'Tenter Lane', 'Tenter Lane ends at the east wall. The Curtain stands across it floor to sky, and the ruts carry on through on the other side, red and empty, as far as you can see.'],

  // ── south of the lane (y 921): the five buildings are below; these two are open ground ─────
  [921, 921, 'market', 'The Swap', 'A yard off Tenter Lane where people sell what they have. Trestles stand in two rows under tarps, laid out with boots, tins, batteries, coats and engine parts. Prices are said out loud and nobody writes anything down.'],
  [925, 921, 'lane', 'The Snicket', 'A gap between the Pallet House and the Box that the people on Wallside use as a street. Duckboards are laid down the middle over the mud. Washing hangs across it overhead.'],

  // ── Wallside (y 922): the camp under the south wall ────────────────────────────────────────
  [920, 922, 'camp', 'Wallside', 'Tents pitched in a row along the south wall, guyed on the north side only. The light off the Curtain falls across them all night.'],
  [921, 922, 'camp', 'Wallside', 'The camp behind the Swap, where the stallholders sleep. Crates of stock are stacked between the tents under tarps, roped down.'],
  [922, 922, 'drum', 'The Drum', 'A clearing in the camp round a cut-down oil drum on four bricks, with chairs, crates and a car seat in a ring about it. The ground is burnt black in a circle. People come here after dark.'],
  [923, 922, 'camp', 'Wallside', 'Tents backed against the old school\'s rear wall. A gap in the brickwork has been hung with a blanket, and somebody sleeps in what was the cloakroom.'],
  [924, 922, 'camp', 'Wallside', 'A run of lean-tos made of doors and tarps, propped against each other. Each tarp is a different colour, and the people in them give the colour as their address.'],
  [925, 922, 'camp', 'Wallside', 'The Snicket comes out here among the tents. A water butt made from a blue chemical drum stands on the corner, full, with a tin cup on a string.'],
  [926, 922, 'camp', 'Wallside', 'The south-east end of Wallside, where the two walls close in. The tents here are the newest in the district and the furthest from anything. Most of them face the corner.'],

  // ── Under the Wall (y 923): Curtain tiles, camped on their inland side ─────────────────────
  [919, 923, 'bare', 'Under the Wall', 'The foot of the south wall at the meadow end. The Curtain stands a few feet off, humming. The camp has not reached this far west and the grass is still long.'],
  [920, 923, 'wall', 'Under the Wall', 'Tents pitched close against the south wall with their backs to the light. The waste beyond is red and flat to the hills, and the road out from the gate shows from here.'],
  [921, 923, 'wall', 'Under the Wall', 'A row of tents under the Curtain. One has a bicycle wheel on its pole, turning slowly in the wind. At night the light off the wall turns all the canvas the same colour.'],
  [922, 923, 'wall', 'Under the Wall', 'Under the south wall. Somebody has scratched a line in the dirt a stride out from the Curtain, and everybody keeps their things behind it.'],
  [923, 923, 'wall', 'Under the Wall', 'Two tents and a lean-to under the wall, with a cooking fire between them in a ring of stones. The smoke goes straight up the face of the wall.'],
  [924, 923, 'wall', 'Under the Wall', 'A man has strung a line of tins along the foot of the Curtain on a fishing line, so he hears anybody coming along it in the dark.'],
  [925, 923, 'wall', 'Under the Wall', 'Tents under the wall, close to the corner. The hum is louder here, two notes not quite together. The people who sleep here say you stop hearing it.'],
  [926, 923, 'wall', 'Under the Wall', 'The last pitch before the corner, a dome tent with a broken pole splinted with a broom handle.'],

  // ── the east wall (x 927) ─────────────────────────────────────────────────────────────────
  [927, 919, 'wall', 'The East Wall', 'The east wall where the Overspill meets it. One tent is pitched so close to the light that its back panel has gone pale and brittle. Its owner says it keeps the damp off.'],
  [927, 920, 'wall', 'The East Wall', 'The end of Tenter Lane. Tents are pitched along the foot of the Curtain with their backs to it, and at night the light off it is enough to see your hands by.'],
  [927, 921, 'wall', 'The East Wall', 'Tents in single file along the inside of the east wall, flap to back, with a path in front of them a boot wide. Each one has its shoes lined up outside.'],
  [927, 922, 'wall', 'The East Wall', 'The east wall near the corner. Somebody has stacked bricks from the old houses into a knee-high wall along the foot of the Curtain.'],
  [927, 923, 'bare', 'The Far Corner', 'The inside angle of the Curtain, where the south wall and the east wall meet and their hum beats slightly out of time. Somebody has brought a bench out: a plank on two crates.'],
];

let painted = 0;
const touched = new Set();
for (const [x, y, kindKey, name, description] of TILES) {
  const id = idFor(x, y);
  const prev = store.get('zones', id);
  if (!prev) throw new Error(`${id} does not exist; this script repaints, it does not create.`);
  if (prev.flags?.is_building || prev.flags?.facade) throw new Error(`${id} is a building; refusing to repaint it as ground.`);
  const k = KIND[kindKey];
  const flags = { ...prev.flags };
  for (const f of ['park_feature', 'artery', 'street_life', 'camp']) delete flags[f];
  flags.district = DISTRICT;
  flags.region_id = REGION;
  flags.terrain = k.terrain;
  flags.scavenging_table_id = k.scav;
  if (k.street_life) flags.street_life = true;
  if (k.camp) flags.camp = true;
  if (name === 'Tenter Lane') flags.artery = ['Tenter Lane'];
  // `curtain` is the wall's own flag and stays exactly as it was.
  const next = { ...prev, name, description, flags, ambient_theme: k.theme, ambient_events: pick(AMB[k.amb], x * 31 + y, 3) };
  delete next.color;
  delete next.bg_color;
  store.put('zones', next);
  touched.add(id);
  painted++;
}

// ── the buildings: five shacks and two ruins, none with a door ───────────────
// `shack` picks the variant from the model registry by name (model-registry.js): tin, bus, stack,
// pallet, box. The two ruins use the existing `ruin` arm; The Old School is drawn mirrored.
const BUILDINGS = [
  [919, 921, 'shack', 'The Bus', 'A single-decker bus with its wheels gone, sat on stacks of bricks with a tarp over the roof where the skylights were. A stovepipe comes out of one of the side windows. The destination blind has been wound to blank.'],
  [920, 921, 'ruin', 'The Gable End', 'Two old houses that stood outside the wall for years. The roofs went first and most of the front walls after, and what is left is one gable standing three storeys high with a fireplace on every floor. The doors and floorboards have been taken for building.'],
  [922, 921, 'shack', 'The Stack', 'Three shacks built one on top of another out of doors, pallets and sheet tin, each smaller than the one under it. A ladder is lashed up the front. The top one leans north, and its owner has tied it back to the old school with a rope.'],
  [923, 921, 'ruin', 'The Old School', 'A one-storey brick school with a bell frame on the ridge. The roof fell in while it was outside the wall, and the classrooms are full of slates and pigeon droppings. The blackboards are still up.'],
  [924, 921, 'shack', 'The Pallet House', 'A house built in two days out of shipping pallets, nailed and wired together and stuffed with rags against the draught. A tarp roof is held down with tyres. One window is a car door with the glass still in it.'],
  [926, 921, 'shack', 'The Box', 'A shipping container with a door cut in its side with a torch, the edges ground smooth. A tarp off the roof makes a porch. Rust has come through the paint in a tide line along the bottom.'],
  [919, 922, 'shack', 'The Tin Hut', 'A hut of corrugated tin on a timber frame, its pent roof weighted down with tyres and paving slabs. A stovepipe comes up through the roof with a tin can over the top to keep the rain out.'],
];

const OPPOSITE = { north: 'south', south: 'north', east: 'west', west: 'east', up: 'down', down: 'up' };
let sealed = 0;
for (const [x, y, type, name, description] of BUILDINGS) {
  const id = idFor(x, y);
  const prev = store.get('zones', id);
  if (!prev) throw new Error(`${id} does not exist`);
  if (prev.flags?.facade) throw new Error(`${id} is already a facade`);
  if (Object.values(prev.exits || {}).some((t) => String(t).startsWith('zone_under_'))) throw new Error(`${id} is an Under seam; it cannot be built on`);
  const flags = { ...prev.flags };
  for (const f of ['terrain', 'street_life', 'camp', 'scavenging_table_id', 'artery', 'park_feature']) delete flags[f];
  flags.district = DISTRICT;
  flags.region_id = REGION;
  flags.is_building = true;
  flags.building_type = type;
  flags.building_name = name;
  // The Stack is three shacks high; every other shack takes the type's two storeys (skyline-scale.js).
  if (name === 'The Stack') flags.floors = 3;
  // NO `facade`, NO `entrance`, NO `world_exit_zone`: there is no way in.
  const next = { ...prev, name, description, flags, exits: {}, ambient_theme: 'outdoors', ambient_events: [] };
  delete next.color;
  delete next.bg_color;
  store.put('zones', next);
  for (const z of store.all('zones')) {
    if (z.id === id) continue;
    const links = Object.entries(z.exits || {}).filter(([, t]) => t === id);
    if (!links.length) continue;
    const exits = { ...z.exits };
    for (const [dir] of links) delete exits[dir];
    store.patch('zones', z.id, { exits });
    sealed += links.length;
  }
}

// ── the people ───────────────────────────────────────────────────────────────
// Every graph is the Pitch's: home in the small hours, the fire after dark, and a day spent at
// home, on a walk, or at work. A stallholder works the Swap from seven to seven.
const DRUM = idFor(922, 922), SWAP = idFor(921, 921);
const LANE = [919, 920, 921, 922, 923, 924, 925, 926].map((x) => idFor(x, 920));
const OVER = [919, 921, 923, 925].map((x) => idFor(x, 919));
const WALL = [920, 922, 924, 926].map((x) => idFor(x, 922));

function graph({ fire = DRUM, fireLines, walk, work, workLines, from = 7, to = 19 }) {
  const n = {
    start: { type: 'start', next: 'is_late' },
    is_late: { type: 'condition', condition_type: 'HOUR_RANGE', params: { from: 1, to: 5 }, ifTrue: 'go_home', ifFalse: 'is_evening' },
    go_home: { type: 'action', action_type: 'GO_HOME', next: 'sleep' },
    sleep: { type: 'action', action_type: 'AT_HOME_LIFE', next: 'start' },
    is_evening: { type: 'condition', condition_type: 'HOUR_RANGE', params: { from: 19, to: 1 }, ifTrue: 'to_fire', ifFalse: work ? 'is_work' : 'day_pick' },
    to_fire: { type: 'action', action_type: 'GO_TO_WORK', params: { zone_id: fire }, next: 'fire_pick' },
    fire_wait: { type: 'wait', seconds: 150, jitter: 90, next: 'start' },
    day_pick: { type: 'random', branches: [{ weight: 3 }, { weight: 2 }], branch_0: 'day_home', branch_1: 'day_walk' },
    day_home: { type: 'action', action_type: 'GO_HOME', next: 'day_wait' },
    day_walk: { type: 'action', action_type: 'PATROL', params: { waypoints: walk, loop: true, mode: 'walk' }, next: 'day_wait' },
    day_wait: { type: 'wait', seconds: 240, jitter: 180, next: 'start' },
  };
  n.fire_pick = { type: 'random', branches: fireLines.map(() => ({ weight: 1 })) };
  fireLines.forEach((msg, i) => {
    n.fire_pick[`branch_${i}`] = `fire_${i}`;
    n[`fire_${i}`] = { type: 'action', action_type: 'EMOTE', params: { message: msg }, next: 'fire_wait' };
  });
  if (work) {
    n.is_work = { type: 'condition', condition_type: 'HOUR_RANGE', params: { from, to }, ifTrue: 'to_work', ifFalse: 'day_pick' };
    n.to_work = { type: 'action', action_type: 'GO_TO_WORK', params: { zone_id: work }, next: 'work_check' };
    n.work_check = { type: 'condition', condition_type: 'PLAYER_IN_ZONE', ifTrue: 'work_chat', ifFalse: 'work_pick' };
    n.work_chat = { type: 'action', action_type: 'VENDOR_CHITCHAT', next: 'work_wait' };
    n.work_pick = { type: 'random', branches: workLines.map(() => ({ weight: 1 })) };
    workLines.forEach((msg, i) => {
      n.work_pick[`branch_${i}`] = `work_${i}`;
      n[`work_${i}`] = { type: 'action', action_type: 'EMOTE', params: { message: msg }, next: 'work_wait' };
    });
    n.work_wait = { type: 'wait', seconds: 90, jitter: 60, next: 'start' };
  }
  return { _start: 'start', nodes: n };
}

const SCHED = (from, to) => Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [{ from, to }]]));

// Greeting split: `first` the first time, `text` after, `known`/`familiar` as the relation grows.
function talk(first, text, known, ask, answer, bye) {
  return {
    root: {
      text, text_by_relation: { first, known, familiar: known },
      options: [{ label: ask, next: 'ask' }, { label: 'Bye.', next: 'bye' }],
    },
    ask: { text: answer, options: [{ label: 'Right.', next: 'root' }] },
    bye: { text: bye, options: [] },
  };
}

const PEOPLE = [
  // ── The Bus ───────────────────────────────────────────────────────────────
  {
    id: 'npc_overspill_philippa_prentice', name: 'Philippa Prentice', sex: 'female', personality: 'unemployed', home: idFor(919, 920),
    description: 'A broad woman in her sixties in a transit company fleece with the badge still on. She drove buses for the city until the routes were cut, and found this one in the waste the week the wall moved.',
    clothing: ['a navy transit fleece with the company badge still sewn on', 'a thick roll-neck jumper', 'thermal leggings and a vest'],
    chitchat: ['"It was the 14. Halcyon to the South Gate and back. Forty minutes, or an hour in snow."', 'wipes the bus windscreen with her sleeve, out of habit.'],
    home_activities: ['sits in the driver\'s seat with the door open and a mug of tea.', 'checks the bricks under the axles, one at a time.', '"Haskell, the stove."'],
    fire: ['tells the ring at the drum which stop is which on the old route, all of them, in order.', 'warms her hands and says it was colder on the night shift.'],
    walk: [idFor(919, 920), idFor(921, 920), idFor(923, 920), SWAP],
    banter: [['"Did you get the pipe through the window?"', '"It\'s through. It smokes."', '"It\'s a stove. It\'s meant to smoke."', '"Inside, Philippa."']],
    dialogue: talk(
      'The woman on the bus step looks you over and nods.\n\n"Philippa. This is my bus. Well. It\'s nobody\'s bus, so it\'s mine."',
      '"Morning," says Philippa, from the step.', '"Come and sit on the step if you want. Mind the stove."',
      'How did you get it here?', '"It was sat out in the waste a hundred yards off with no wheels. When the wall moved, we rolled it on pipes. Took twelve of us a day."',
      'Philippa goes back to her tea.'),
  },
  {
    id: 'npc_overspill_haskell_prentice', name: 'Haskell Prentice', sex: 'male', personality: 'quiet', home: idFor(919, 920),
    description: 'A thin, grey man with a pencil behind each ear, who measures everything twice. He has fitted a stove, a bunk and a sink into a bus with no water, and is now working on the water.',
    clothing: ['a brown warehouse coat with a ruler in the breast pocket', 'a checked flannel shirt', 'a vest and long johns'],
    chitchat: ['measures a length of pipe, then measures it again.', '"If I can get the butt on the roof, it fills itself."'],
    home_activities: ['saws a length of pipe on the bus step.', 'sketches a gutter on the back of a cereal box.', 'feeds the stove one stick at a time.'],
    fire: ['explains to nobody in particular how rain off a roof could fill a drum.', 'sits a little back from the fire, listening.'],
    walk: [idFor(919, 920), SWAP, idFor(924, 920)],
    banter: [['"How much pipe do you need?"', '"Eleven feet."', '"Eleven? The bus isn\'t eleven feet tall."', '"It goes along, Philippa. Then down."']],
  },

  // ── The Stack ─────────────────────────────────────────────────────────────
  {
    id: 'npc_overspill_rowena_pocklington', name: 'Rowena Pocklington', sex: 'female', personality: 'labourer', home: idFor(922, 920),
    description: 'A short, strong woman in a roofer\'s knee pads with a claw hammer through her belt. She built the bottom two floors of the Stack and is building the third, and she sleeps in the middle one because it is the warmest.',
    clothing: ['a canvas work jacket with a hammer loop', 'a hooded top with the cuffs worn through', 'work trousers with knee pads and thermal underwear'],
    chitchat: ['"It\'s fine. It\'s just settling."','pulls a nail out of an old board with her claw hammer and drops it in a tin.'],
    home_activities: ['hammers a pallet slat across a gap.', 'climbs the ladder to the top floor and comes down again.', '"Rafe! Hold the bottom."'],
    fire: ['sits on a crate at the drum and picks splinters out of her hands with a pin.', 'says she can get a fourth floor on if the school wall holds.'],
    walk: [idFor(922, 920), idFor(923, 920), idFor(920, 920), SWAP],
    banter: [['"Is the rope tight?"', '"Tight as it goes."', '"Make it go tighter."'], ['"If the school wall comes down, we come down."', '"The school wall\'s been up a hundred years."', '"Not with us tied to it, it hasn\'t."']],
    dialogue: talk(
      'The woman at the foot of the ladder looks you up and down.\n\n"Rowena. If you\'re here about the lean, it\'s fine. It\'s tied."',
      '"Hello again," says Rowena.', '"You want to see the top floor? Mind the fourth rung."',
      'Where does the timber come from?', '"The old houses on the lane. Floorboards, doors, roof laths. Nobody\'s lived in them since the wall came down, so I don\'t think anybody minds."',
      'Rowena goes back to her hammering.'),
  },
  {
    id: 'npc_overspill_rafe_pocklington', name: 'Rafe Pocklington', sex: 'male', personality: 'chatty', home: idFor(922, 920),
    description: 'Rowena\'s younger brother, tall and loose-limbed, holding the bottom of the ladder and talking to whoever is passing. He has a cough he says is the dust.',
    clothing: ['an oversized parka with a fur hood gone flat', 'a football shirt', 'tracksuit bottoms and a T-shirt'],
    chitchat: ['"She says it\'s settling. I say it\'s leaning. One of us is on the bottom floor."', 'coughs into his elbow and says it\'s the dust.'],
    home_activities: ['holds the ladder with one hand and eats with the other.', 'sorts bent nails from straight ones.', 'sings along to a radio that isn\'t on.'],
    fire: ['tells a long story at the drum about a dog he used to have.', 'coughs, waves it off, and takes a seat closer to the fire.'],
    walk: [idFor(922, 920), idFor(921, 920), SWAP, idFor(921, 919), idFor(923, 919)],
  },
  {
    id: 'npc_overspill_augustin_ebbrell', name: 'Augustin Ebbrell', sex: 'male', personality: 'stoic', home: idFor(922, 920),
    description: 'A heavy, quiet man in his forties who rents the top floor of the Stack for two tins a week. He used to work the night bakery on Glacier Street. He keeps a sack of flour under his bunk.',
    clothing: ['a white baker\'s jacket gone grey at the cuffs', 'a wool jumper', 'baggy trousers and a vest'],
    chitchat: ['"Top floor\'s fine. You feel the wind, but you feel it everywhere."', 'brushes flour off his sleeve.'],
    home_activities: ['kneads dough in a bowl on his knee.', 'climbs the ladder slowly, testing each rung.', 'sleeps sitting up.'],
    fire: ['bakes flat bread on a sheet of tin over the drum and hands it round.', 'turns the bread on the tin with his fingers.'],
    walk: [idFor(922, 920), SWAP, DRUM],
    banter: [['"Augustin, is there bread?"', '"Later."', '"How much later?"', '"When the drum\'s hot."']],
  },

  // ── The Pallet House ──────────────────────────────────────────────────────
  {
    id: 'npc_overspill_gideon_kesterton', name: 'Gideon Kesterton', sex: 'male', personality: 'gruff', home: idFor(924, 920),
    description: 'A bald man with a carpenter\'s pencil and a bad knee, who built the Pallet House in two days and will tell you so. He builds for other people now, for food or tobacco, and he is booked up.',
    clothing: ['a sleeveless quilted vest over a sweatshirt', 'a grey sweatshirt with the hood torn off', 'cargo trousers and thermals'],
    chitchat: ['"Two days. Pallets, wire, a tarp and a car door. You want one, it\'s a week\'s wait."', 'rubs his knee and swears at it.'],
    home_activities: ['wires a pallet to the frame and tests it with his shoulder.', 'stuffs rags into a gap and stands back to look.', 'sharpens a pencil with a knife.'],
    fire: ['draws a floor plan in the dirt by the drum with a stick.', 'tells the drum his knee says rain.'],
    walk: [idFor(924, 920), idFor(925, 920), idFor(925, 921), idFor(924, 922), idFor(926, 922)],
    dialogue: talk(
      'The bald man doesn\'t stop working.\n\n"Gideon. I built that. Two days. If you\'re asking, it\'s a week\'s wait."',
      '"You again," says Gideon.', '"Pass me that wire, would you."',
      'Can you build me one?', '"I can. A week, for food. You bring the pallets or I charge for them. The car door was a one-off."',
      'Gideon goes back to the pallet he\'s wiring.'),
  },
  {
    id: 'npc_overspill_hettie_nwosu', name: 'Hettie Nwosu', sex: 'female', personality: 'charity', home: idFor(924, 920),
    description: 'A small, tidy woman with a cardboard box of medicines she keeps sorted by colour. She shares the Pallet House with Gideon and does most of the talking to the neighbours for both of them.',
    clothing: ['a long camel coat, patched at the elbows', 'a cardigan over a blouse', 'wool tights and a slip'],
    chitchat: ['"Paracetamol I can do. Antibiotics, ask at A Stitch In Time."', 'checks the dates on a strip of tablets and frowns.'],
    home_activities: ['sorts tablets into egg boxes.', 'writes on the back of her hand so she remembers who needs what.', 'sweeps the doorstep of the Pallet House.'],
    fire: ['asks round the drum after everybody\'s chest.', 'gives out cough sweets from her coat pocket, one each.'],
    walk: [idFor(924, 920), idFor(924, 922), idFor(923, 922), idFor(926, 922), idFor(925, 919)],
    banter: [['"Gideon, the tarp\'s loose."', '"It\'s meant to move."', '"It\'s meant to stay on."']],
  },

  // ── The Box ───────────────────────────────────────────────────────────────
  {
    id: 'npc_overspill_jinny_rennard', name: 'Jinny Rennard', sex: 'female', personality: 'lowlife', home: idFor(925, 920),
    description: 'A wiry woman in her twenties with grinder burns up both forearms. She cut the door in the Box with a borrowed torch, and she has been asked to give the torch back.',
    clothing: ['a leather welding jacket with burnt holes in the sleeves', 'a black hoodie', 'jeans and a thermal top'],
    chitchat: ['"I\'ll give it back when it runs out of gas. It\'s nearly out of gas."', 'picks at a burn on her arm.'],
    home_activities: ['files a sharp edge on the container door.', 'lies on the Box\'s roof under the tarp, looking at the sky.', 'counts gas cylinders by tapping them.'],
    fire: ['offers to cut anybody at the drum a window, for a price.', 'warms her hands with the sleeves pulled over them.'],
    walk: [idFor(925, 920), idFor(926, 920), idFor(927, 920), idFor(927, 922), idFor(926, 922)],
    banter: [['"Who did you borrow the torch off?"', '"A man."', '"Does the man know?"', '"He knows now."']],
  },
  {
    id: 'npc_overspill_ned_sallow', name: 'Ned Sallow', sex: 'male', personality: 'quiet', home: idFor(925, 920),
    description: 'A lanky young man in a hi-vis rain jacket, who shares the Box with Jinny and keeps it tidy. He sweeps the inside every morning and has laid carpet tiles on the floor.',
    clothing: ['a yellow hi-vis rain jacket', 'a thick fleece', 'tracksuit bottoms and a T-shirt'],
    chitchat: ['"It\'s warm in summer, apparently. Too warm. We\'ll see."', 'sweeps out the Box with a dustpan and brush.'],
    home_activities: ['lays another carpet tile and stands on it.', 'hangs a coat on a magnet on the container wall.', 'reads a paperback with the cover torn off.'],
    fire: ['sits close to Jinny at the drum and says very little.', 'passes round a bag of boiled sweets.'],
    walk: [idFor(925, 920), SWAP, idFor(924, 920)],
  },

  // ── The Tin Hut ───────────────────────────────────────────────────────────
  {
    id: 'npc_overspill_petronella_swales', name: 'Petronella Swales', sex: 'female', personality: 'gruff', home: idFor(920, 922),
    description: 'An old woman with a stick, a pipe and a mongrel dog that goes everywhere at her heel. She lived outside the wall, in the waste, for the whole of the time it stood here, and the wall moved to her rather than the other way round.',
    clothing: ['a man\'s waxed coat tied with string', 'two jumpers, one inside out', 'a long skirt over trousers'],
    chitchat: ['"I didn\'t come in. It came out."', 'knocks out her pipe on her stick.'],
    home_activities: ['sits in the door of the Tin Hut with the dog\'s head on her foot.', 'fills her pipe with something that isn\'t tobacco.', 'talks to the dog in a low voice.'],
    fire: ['sits nearest the drum and lets the dog lie on her feet.', 'says the waste was quieter, and nobody asks whether that was better.'],
    walk: [idFor(919, 920), idFor(918, 920), idFor(920, 922), idFor(919, 923)],
    dialogue: talk(
      'The old woman takes her pipe out of her mouth.\n\n"Swales. I was out there before you lot were in here. The dog\'s called Bob. Don\'t touch him."',
      '"Hm," says Petronella Swales.', '"Bob likes you. That\'s new."',
      'What was it like outside the wall?', '"Quiet. Cold. Things came at night and I had a shotgun. Now there\'s two hundred people within shouting distance and I can\'t sleep for the noise."',
      'Petronella puts her pipe back in.'),
  },

  // ── The Swap: three stallholders ──────────────────────────────────────────
  {
    id: 'npc_overspill_bettany_coyle', name: 'Bettany Coyle', sex: 'female', personality: 'vagrant', home: idFor(921, 922), work: SWAP,
    description: 'A big, cheerful woman behind a trestle heaped with coats, socks and gloves, every piece of it washed. She holds each one up to the light before she sells it, to show you where the holes are.',
    clothing: ['three coats at once, the outer one a red puffer', 'a cable-knit jumper', 'jogging bottoms and a thermal vest'],
    chitchat: ['"Washed, every one. Holes are free."', 'holds a jumper up to the light and pokes a finger through the elbow.'],
    home_activities: ['folds socks into pairs that don\'t quite match.', 'darns a mitten by the light from the wall.'],
    workLines: ['shakes out a coat and hangs it on the rail.', 'pairs up a heap of socks.', '"Gloves! Mittens! Odd ones half price!"', 'sniffs a jumper and puts it in the wash pile.'],
    fire: ['wears a different coat to the drum every night and says so.', 'warms her feet on the drum\'s bricks.'],
    walk: [SWAP, idFor(921, 920), idFor(923, 920)],
    shop: 'Bettany\'s stall', stock: [['item_wool_socks', 6], ['item_wool_mittens', 9], ['item_gloves_fingerless', 7], ['item_watch_cap', 8], ['item_hoodie_grey', 18], ['item_padded_jacket', 45], ['item_wind_blanket', 22], ['item_longjohns_thermal', 16]],
  },
  {
    id: 'npc_overspill_caradoc_umber', name: 'Caradoc Umber', sex: 'male', personality: 'lowlife', home: idFor(921, 922), work: SWAP,
    description: 'A sharp-faced man in a fingerless-glove-and-flat-cap combination, with a trestle of batteries, tape, wire and gas canisters laid out in rows. He tests every battery on his tongue in front of you.',
    clothing: ['a tweed jacket with the lining torn out', 'a waistcoat with no buttons left', 'corduroy trousers and a vest'],
    chitchat: ['"Tested. Watch." He licks a battery and nods.', 'straightens a row of butane canisters so the labels face out.'],
    home_activities: ['sorts batteries into dead, nearly dead and fine.', 'winds loose wire onto a cardboard spool.'],
    workLines: ['licks a battery, winces, and puts it in the good pile.', '"Gas! Tape! Wire! Torches that work!"', 'rearranges the trestle so the best stuff is at the front.', 'counts the canisters twice.'],
    fire: ['sells a lighter at the drum and lights the buyer\'s cigarette with it as proof.', 'keeps one hand on his cash tin.'],
    walk: [SWAP, idFor(921, 920), idFor(919, 920)],
    shop: 'Umber\'s trestle', stock: [['item_battery', 12], ['item_duct_tape', 13], ['item_butane_canister', 15], ['item_salvaged_wiring', 6], ['item_sewing_kit', 14], ['item_flashlight', 30], ['item_scrap_torch', 11], ['item_hand_warmers', 8]],
  },
  {
    id: 'npc_overspill_ama_boateng', name: 'Ama Boateng', sex: 'female', personality: 'chatty', home: idFor(921, 922), work: SWAP,
    description: 'A tall woman with a stockpot on a camping stove and a stack of tin bowls, ladling broth for whatever you have. She is the only stall in the Swap with a queue.',
    clothing: ['a striped apron over a quilted coat', 'a bright wax-print headwrap and a polo neck', 'warm leggings and a vest'],
    chitchat: ['"Broth, bread, whatever you\'ve got. Bring the bowl back."', 'tastes the broth off the ladle and adds salt.'],
    home_activities: ['scrubs tin bowls in a bucket.', 'chops onions on a board on her knee.'],
    workLines: ['stirs the stockpot slowly.', 'ladles a bowl and hands it over the trestle.', '"Hot! Broth is hot! Bowls back, please!"', 'turns the stove down and the pot stops spitting.'],
    fire: ['brings the end of the stockpot to the drum and shares it out.', 'tells the drum about her mother\'s cooking, at length.'],
    walk: [SWAP, DRUM, idFor(921, 919)],
    shop: 'Ama\'s pot', stock: [['item_bone_broth', 6], ['item_flat_bread', 4], ['item_dripping_bread', 5], ['item_ramen_noodles', 7], ['item_potato', 3], ['item_ration_hardtack', 5]],
  },

  // ── round the Drum ────────────────────────────────────────────────────────
  {
    id: 'npc_overspill_lyle_hebden', name: 'Lyle Hebden', sex: 'male', personality: 'chatty', home: idFor(923, 922), work: DRUM, from: 9, to: 17,
    description: 'A neat old man with a barber\'s chair he carried here from Nine Elms on his back. He cuts hair at the Drum by daylight for a tin of something, and shaves with a cut-throat razor if you trust him.',
    clothing: ['a white barber\'s smock, clean', 'a shirt and tie under a cardigan', 'pressed trousers and a vest'],
    chitchat: ['"Short back and sides, or a shave? It\'s a tin either way."', 'strops his razor on a belt hung from the chair.'],
    home_activities: ['oils the barber chair\'s pump.', 'cleans his combs in a jar of something blue.'],
    workLines: ['snips at the air with his scissors while he waits.', 'sweeps cut hair into the drum.', 'strops the razor, slowly.', '"Next! Anybody? Haircut, a tin."'],
    fire: ['sits in his own barber chair at the drum, which nobody else is allowed to.', 'tells the drum which famous heads he has cut, none of which anybody believes.'],
    walk: [DRUM, idFor(923, 920)],
  },
  {
    id: 'npc_overspill_dorrie_quarrie', name: 'Dorrie Quarrie', sex: 'female', personality: 'quiet', home: idFor(924, 922),
    description: 'A red-haired woman with a fiddle in a pillowcase, who plays at the Drum every night and nowhere else. She is not very good and nobody has ever told her so.',
    clothing: ['a green army greatcoat with the buttons replaced', 'a fair-isle jumper', 'woollen trousers and a vest'],
    chitchat: ['"I know four tunes. I play them in a different order."', 'tightens a peg on the fiddle and plucks the string.'],
    home_activities: ['rosins the bow with a stub of something.', 'plays the same three bars over and over, quietly.'],
    fire: ['plays a reel at the drum, a little fast, and people clap on the wrong beat.', 'plays something slow, and the talk round the drum stops for it.', 'breaks a string, swears, and ties it back together.', 'plays a tune somebody asks for, and gets most of it.'],
    walk: [idFor(924, 922), DRUM, idFor(922, 923)],
  },
  {
    id: 'npc_overspill_merle_moberly', name: 'Merle Moberly', sex: 'female', personality: 'chatty', home: idFor(925, 922),
    description: 'A sixteen-year-old in a hoodie with a satchel full of notes, running messages up and down the district for a coin a time. She knows where everybody is and who they owe.',
    clothing: ['a purple hoodie with the hood up', 'a school polo shirt from no school that still runs', 'leggings and trainers'],
    chitchat: ['"Message? A coin to the Pitch, two to Kessler Street."', 'checks a scrap of paper and sets off at a jog.'],
    home_activities: ['sorts notes into her satchel by street.', 'sleeps with the satchel under her head.'],
    fire: ['delivers the day\'s messages round the drum, out loud.', 'eats standing up and leaves before the music.'],
    walk: [idFor(925, 922), idFor(925, 921), idFor(925, 920), idFor(924, 919), idFor(923, 920), idFor(921, 920), SWAP],
  },
  {
    id: 'npc_overspill_tariq_darrow', name: 'Tariq Darrow', sex: 'male', personality: 'quiet', home: idFor(923, 919),
    description: 'A young man sitting on a holdall at the Overspill with everything he owns in it. He came in through the South Gate this morning and is waiting for somebody to say where he can pitch.',
    clothing: ['a good black coat, wet through', 'a grey jumper', 'jeans and a T-shirt'],
    chitchat: ['"Do you know who decides where the pitches go?"', 'looks at the empty pitches and then at the people near them.'],
    home_activities: ['sits on his holdall with his hands in his pockets.', 'reads a printed map of Coldwater and folds it up again.'],
    fire: ['stands at the edge of the ring at the drum until somebody moves up for him.', 'takes a bowl of broth and says thank you three times.'],
    walk: [idFor(923, 919), idFor(921, 919), idFor(921, 918), idFor(923, 918)],
    dialogue: talk(
      'The young man on the holdall stands up quickly.\n\n"Sorry. Tariq. I just got here. Do you know who I ask about a pitch?"',
      '"Hi," says Tariq.', '"I got a pitch. Third one along. Thanks for asking."',
      'Where did you come from?', '"Down the coast road. There was work, and then there wasn\'t. Somebody on the truck said there was room here."',
      'Tariq sits back down on his holdall.'),
  },
  {
    id: 'npc_overspill_eamon_craddock', name: 'Eamon Craddock', sex: 'male', personality: 'labourer', home: idFor(920, 922),
    description: 'A stocky man covered in brick dust, who spends every day inside the old houses on Tenter Lane with a crowbar and a barrow. He sells what he pulls out to the people building shacks.',
    clothing: ['a dusty donkey jacket', 'a ripped sweatshirt', 'work trousers and a thermal vest'],
    chitchat: ['"Slates, laths, floorboards. A tin a barrow."', 'tips a barrow of bricks out onto the lane and starts stacking them.'],
    home_activities: ['knocks old mortar off a brick with a trowel.', 'sleeps with his boots on.'],
    fire: ['sits at the drum with his crowbar across his knees.', 'tells the drum what he found in the school today: a register, a globe, a box of chalk.'],
    walk: [idFor(920, 920), idFor(923, 920), idFor(922, 920), SWAP, idFor(919, 920)],
    banter: [['"What did you get today?"', '"Floorboards out of the school. Good oak."', '"Is anybody using the school?"', '"Pigeons."']],
  },
];

let people = 0;
for (const p of PEOPLE) {
  const stock = p.stock ? p.stock.map(([item_id, price]) => {
    if (!store.get('items', item_id)) throw new Error(`${p.id}: no such item ${item_id}`);
    return { item_id, price };
  }) : [];
  const npc = {
    id: p.id,
    name: p.name,
    sex: p.sex,
    npc_type: 'npc',
    faction: null,
    hp: 20,
    hp_max: 20,
    description: p.description,
    flags: { mis_willing: false, personality: p.personality, clothing_layers: p.clothing },
    chitchat: p.chitchat,
    home_activities: p.home_activities,
    home_zone: p.home,
    work_zone_id: p.work || null,
    banter: p.banter || [],
    dialogue_tree: p.dialogue || {},
    behaviour_graph: graph({ fireLines: p.fire, walk: p.walk, work: p.work, workLines: p.workLines, from: p.from, to: p.to }),
    studio_zone_id: null,
    vendor_inventory: stock,
    vendor_restock_rate: 1,
    vendor_schedule: p.shop ? SCHED(7, 19) : p.work ? SCHED(p.from ?? 7, p.to ?? 19) : {},
    vendor_shop_name: p.shop || null,
    vendor_stock_size: 10,
    wander_zones: [],
    wanders: 0,
  };
  store.put('npcs', npc);
  people++;
}

const written = store.flush({ dryRun });
console.log(`${dryRun ? 'would write' : 'wrote'} ${written.length} file(s)`);
console.log(`  ground     ${painted} tiles`);
console.log(`  buildings  ${BUILDINGS.length} (${sealed} neighbour exit(s) sealed)`);
console.log(`  people     ${people}`);
console.log('\nnext:\n  node scripts/content/mint-connections.mjs --write\n  npm run shapes:bake\n  node scripts/snapshot-flight-world.mjs\n  npm run content:lint');
