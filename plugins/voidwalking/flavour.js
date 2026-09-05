// ── VOID COUNTRY: what the ground is called, and what is standing on it ───────
//
// The crossing used to draw from ten room names and eight descriptions, picked INDEPENDENTLY of the
// terrain the same seed had just rolled. So "Bone Country" could hand you drifting grey ash and a
// marsh could crunch underfoot, and on a fifteen-room walk you met the same eight sentences twice
// each. At one room per TILE that walk is 93 to 282 rooms and the repetition stops being a blemish
// and becomes the whole texture of the system.
//
// ⚠ THE GROUND PICKS THE WORDS. Everything here is keyed by terrain, so a room's name, its
// description and the surface underfoot are one decision rather than three. That is not tidiness: it
// is the thing that lets the landform field drive prose for free the moment it exists, because the
// field's output IS a terrain key. Nothing in this file knows where a room is, only what it is made
// of, which is why it can be written before the field is.
//
// ⚠ NO EM DASHES. The em dash is the Architect's voice and the Ascendants' after it (docs/story.md),
// and the waste is neither. It has no opinions and nobody is talking.
//
// Tone: bleak and flat, with the occasional human detail that has outlived the human. The joke is
// never told out here, it is just left lying around.

// The surfaces a crossing can put underfoot. Real terrain keys, so the minimap, the pacing multiplier
// and the procedural footstep bed all resolve without anything being taught about the void.
// `plateau` is the top of a mesa: it only comes up when a cut goes OVER something the road went round.
export const VOID_TERRAINS = ['scrub', 'ash', 'redrock', 'marsh', 'hardpan', 'alkali', 'gravel', 'sand'];
export const CUT_TERRAINS = ['plateau', 'gravel', 'redrock'];

export const GROUND = {
  scrub: {
    names: ['The Thornline', 'Scrub Reach', 'The Bristle', 'Grey Sage', 'The Snagging', 'Dogtooth Flat'],
    descs: [
      'Waist-high scrub the colour of old newspaper, growing in rows it was never planted in.',
      'Thorn catches at your legs with the patience of something that has all week. The wind moves through it and sounds like a crowd a long way off.',
      'Grey brush to the horizon, and every third bush is dead and still standing, holding its shape out of habit.',
      "Something has been through here recently and low to the ground. The scrub is bent one way and hasn't sprung back.",
    ],
  },
  ash: {
    names: ['Ashfall', 'The Grey Miles', 'Softfall', 'Cinder Reach', 'The Sift', 'Palefall'],
    descs: [
      'Fine grey ash drifts down from a colourless sky and settles on your shoulders like a verdict.',
      'You sink to the ankle with every step and the ground gives up a small grey ghost each time.',
      'Ash lies in drifts against everything that ever stood up out of it. Nothing stands up out of it now.',
      'The air tastes of a fire that finished a very long time ago and has never quite been put out.',
    ],
  },
  redrock: {
    names: ['The Rust Flats', 'Ironback', 'Red Bench', 'The Bleeding Ground', 'Oxide Reach', 'Coppermouth'],
    descs: [
      'Red stone, iron-stained and flaking, standing in low shelves that all lean the same way.',
      'Rusted wreckage juts from the dust like the bones of something that died mid-crawl.',
      'The rock here is the colour of a bad scab and comes away in your hand if you lean on it.',
      "Every surface is oxide red and every shadow is black, and there's nothing in between anywhere you look.",
    ],
  },
  marsh: {
    names: ['A Dead Wash', 'The Seep', 'Sourwater', 'The Suck', 'Rotgut Flat', 'The Standing Damp'],
    descs: [
      'Standing water with a skin on it, and the skin is the wrong colour for water.',
      "The ground breathes when you step on it. Something under the surface accommodates your weight and doesn't like it.",
      "A dry wash that isn't dry, choked with wind-scoured debris and the smell of old rot.",
      "Reeds, or what's left of reeds, standing in a broth that has been reducing since before the Handoff.",
    ],
  },
  hardpan: {
    names: ['Cracked Hardpan', 'The Tiles', 'Ringing Flat', 'The Old Lakebed', 'Shardground', 'The Drum'],
    descs: [
      'Cracked pale hardpan, flat to the horizon and ringing slightly underfoot, the mud of a lake that dried before anybody was counting.',
      'The ground is broken into plates the size of dinner tables and every one of them rocks a little when you cross it.',
      'Heat-shimmer boils off a horizon with nothing on it. Every direction looks the same, which is to say: bad.',
      'Somewhere out here a vehicle turned around. You can see where, and you can see that it took several attempts.',
    ],
  },
  alkali: {
    names: ['Saltblind', 'The White', 'Bitter Flat', 'Soda Reach', 'The Glare', 'Lyeground'],
    descs: [
      'The salt flat throws the light back so hard that for a moment the sky is the darker half.',
      'White crust that crunches like frost and burns like it too, once it gets into a crack in your boot.',
      "Your own footprints go grey against the white and stay that way. So do the ones already here, which aren't yours.",
      "Nothing has grown here in living memory and the ground isn't sorry about it.",
    ],
  },
  gravel: {
    names: ['The Rattle', 'Shingle Reach', 'Loose Country', 'The Ballast', 'Gritwash', 'The Skidding'],
    descs: [
      'Loose stone that slides out from under you and announces every step to everything within a quarter mile.',
      "Gravel graded flat by water that hasn't run here for a century, still holding the shape of the current.",
      "Every stone is the same size, which isn't something nature usually bothers to arrange.",
      "The ground rattles and resettles behind you, so it always sounds like there's somebody a step back.",
    ],
  },
  sand: {
    names: ['The Slow Miles', 'Dunelap', 'The Combing', 'Softfoot', 'The Drifting', 'Windrow'],
    descs: [
      'Sand in long combed rows, and walking across the grain costs you twice what walking along it would.',
      'The dunes have moved since anybody drew a map of this and they will move again before anybody draws another.',
      'Grit runs along the ground in a thin sheet at ankle height and stops dead when the wind does.',
      'Something is buried here, and the wind is roughly half done deciding whether to show you.',
    ],
  },
  plateau: {
    names: ['The High Table', 'Overlook', 'The Bench', 'Skyfloor', 'The Long Roof', 'Topside'],
    descs: [
      'The top of the mesa, flat as a table and utterly exposed. You can see a very long way, and be seen from all of it.',
      "Up here the wind has nothing to break it and works on you steadily, like it's being paid by the hour.",
      'Bare stone, scoured clean, with the whole country laid out below and the road a thin scratch across the middle of it.',
      "Nothing grows on the roof of the world. Whatever came up here came up for a reason and didn't stay.",
    ],
  },
};

// ── HIGHLIGHTS: the things worth stopping for, and the things that stop you ───
//
// A crossing that is only ground is a corridor with a step counter. These are what a walk gets talked
// about for afterwards, and the mix is deliberate: relief and salvage are rare enough to be worth the
// detour, hazards are common enough that the relief has to be earned, and markers are free texture
// that costs the player nothing but makes the country feel like somewhere people have been.
//
// ⚠ `kind` IS THE MECHANICAL CONTRACT AND THE PROSE IS NOT. A reader wires behaviour off `kind`,
// never off a name or a description, so adding a fifteenth salvage site is a content change and
// adding a new `kind` is a code change. Keep that line: it is what makes this file safe to extend.
//
// ⚠ A KIND MAY SHIP WITH NO FLAGS, AND `shelter` DOES. Its prose is real and its mechanic is not:
// the engine's SSOT for "is this zone climatically sheltered" is `isIndoorZone`, which reads
// `is_interior`/`is_apartment`/`is_building`, and setting any of those on a culvert in the waste would
// enrol it in the indoor-temperature loop and the building/power network. Rather than invent a
// `void_shelter` nothing reads — the unconsumed key this project treats as a build failure — the
// kind carries description only until weather exposure grows a seam it can use. Regress asserts every
// flag that IS present has a reader.
//
//   salvage  loot roll, the risk-for-loot gamble
//   respite  rest and heal, at a price (water, and an ambush roll while you sit)
//   water    refill, no healing
//   shelter  weather cover, no healing
//   hazard   it costs you something to be here
//   marker   pure texture, no mechanics, never gated
//
// `terrains` narrows a feature to ground it makes sense on. Omitted means anywhere.
export const FEATURES = [
  // ── salvage ────────────────────────────────────────────────────────────────
  // ⚠ The first two carry over from the old DETOUR_NAMES list verbatim. A detour draws from this
  // pool now, so dropping them would have quietly retired two rooms players have already walked.
  { id: 'wreck_buried',   kind: 'salvage', name: 'A Half-Buried Wreck',
    desc: "Wreckage juts from the dust off the line, the kind of place that swallows the desperate and, sometimes, rewards them. No telling which until you're in it." },
  { id: 'wreck_cache',    kind: 'salvage', name: "A Scavenger's Cache",
    desc: "Something went down out here long ago and was never picked clean. Or it was, and what picked it's still around." },
  { id: 'wreck_hauler',   kind: 'salvage', name: 'A Downed Hauler',
    desc: 'A rig on its side with the trailer folded most of the way round to meet the cab. Long stripped, but nobody ever gets all of it.' },
  { id: 'wreck_convoy',   kind: 'salvage', name: 'A Picked-Over Convoy',
    desc: 'Four vehicles nose to tail, all of them burnt, all of them opened. Somebody stopped them here and somebody else has been back since.' },
  { id: 'wreck_bunker',   kind: 'salvage', name: 'A Collapsed Bunker',
    desc: 'A dark opening in the ground, half fallen in. Salvage, maybe. A grave, maybe. Both, maybe.' },
  { id: 'wreck_silo',     kind: 'salvage', name: 'A Buried Silo',
    desc: 'A hatch standing a foot proud of the ground with sixty years of drift banked against it. The hinges have been cut. Recently.' },
  { id: 'wreck_relay',    kind: 'salvage', name: 'A Toppled Relay Mast',
    desc: 'Two hundred feet of lattice lying across the country like a dropped comb, still bolted to a slab that came up with it.' },
  { id: 'wreck_spill',    kind: 'salvage', name: 'A Cargo Spill',
    desc: "Crates burst across half an acre. Most are empty. The ones that aren't have been left for a reason you can't see yet." },
  { id: 'wreck_rig',      kind: 'salvage', name: 'A Sunken Rig', terrains: ['marsh'],
    desc: 'Something big went into the soft ground here at speed and only the top third argued about it.' },
  { id: 'wreck_scoured',  kind: 'salvage', name: 'A Wind-Scoured Ruin', terrains: ['sand', 'alkali', 'hardpan'],
    desc: 'Walls worn down to knee height on the windward side and still shoulder high on the other. You can tell which way the weather comes from without looking up.' },

  // ── respite ────────────────────────────────────────────────────────────────
  { id: 'spring_hot',     kind: 'respite', name: 'A Hot Spring',
    desc: "Water coming up out of the rock at a temperature that has no business out here, steaming in a basin somebody has lined with flat stones. Somebody who hasn't been back in a while.",
    flags: { water_source: true } },
  { id: 'spring_vent',    kind: 'respite', name: 'The Steam Vent', terrains: ['redrock', 'plateau', 'gravel'],
    desc: 'A crack in the ground breathing warm and wet, and a ring of stones around it where people have sat. The stones are worn smooth on top.',
    flags: { stove_tier: 1 } },
  { id: 'spring_seep',    kind: 'respite', name: 'A Warm Seep', terrains: ['marsh', 'scrub'],
    desc: 'Warm water spreading out of a bank in a fan, and the only green thing for a day in any direction growing where it does.',
    flags: { water_source: true } },
  { id: 'fire_pit',       kind: 'respite', name: "Somebody's Firepit",
    desc: 'A firepit, a windbreak of stacked stone, and enough dry scrub piled beside it for one night. The pile has been kept up. Nobody leaves that for themselves.',
    flags: { stove_tier: 1 } },

  // ── water ──────────────────────────────────────────────────────────────────
  { id: 'water_cistern',  kind: 'water', name: 'A Cistern',
    desc: "A concrete tank sunk to its lip, lid askew, a foot of water in the bottom that's only mostly the wrong colour.",
    flags: { water_source: true } },
  { id: 'water_catch',    kind: 'water', name: 'A Rain Catch',
    desc: "A tarp strung between four posts and funnelled into a drum. Whoever rigged it knew what they were doing and isn't here.",
    flags: { water_source: true } },
  { id: 'water_drip',     kind: 'water', name: 'The Dripline', terrains: ['redrock', 'plateau'],
    desc: 'Water comes off an overhang one drop at a time into a hollow it has been cutting for longer than there have been people to watch it.',
    flags: { water_source: true } },

  // ── shelter ────────────────────────────────────────────────────────────────
  { id: 'shelter_culvert', kind: 'shelter', name: 'A Culvert',
    desc: "A concrete pipe wide enough to sit up in, running under a road that's no longer above it." },
  { id: 'shelter_turret',  kind: 'shelter', name: "The Turret's Shadow",
    desc: 'An automated gun on a mast, long dead, its housing throwing the only shade for miles. It tracks you anyway, slowly, out of whatever it has instead of habit.' },
  { id: 'shelter_hang',    kind: 'shelter', name: 'An Overhang', terrains: ['redrock', 'plateau', 'gravel'],
    desc: 'Rock leaning far enough out to keep the weather off, and a wall under it black with the smoke of everybody who worked that out before you.' },

  // ── hazard ─────────────────────────────────────────────────────────────────
  { id: 'hazard_rad',     kind: 'hazard', name: 'A Rad Pocket',
    desc: 'Nothing marks it. Nothing needs to. The ground is glassed in a rough circle and the wind goes round rather than across.',
    flags: { radiation: 34 } },
  { id: 'hazard_sink',    kind: 'hazard', name: 'The Sinkhole Ground', terrains: ['hardpan', 'alkali', 'marsh'],
    desc: 'The crust here rings hollow and there are holes in it the size of a truck, with nothing at the bottom of them that you can see.' },
  { id: 'hazard_mines',   kind: 'hazard', name: 'A Minefield',
    desc: "Somebody fenced this once. The fence is down and the reason for it's not, and there's a line of small neat craters where a previous walker found that out." },
  { id: 'hazard_gas',     kind: 'hazard', name: 'A Gas Seep', terrains: ['marsh', 'gravel', 'redrock'],
    desc: 'The air here is heavier than air. It pools in the low ground and it has no smell at all, which is the problem with it.' },
  { id: 'hazard_glass',   kind: 'hazard', name: 'The Glass Scar',
    desc: "A strip of fused ground running dead straight for half a mile, edges still sharp. Something came down here at a shallow angle and didn't stop.",
    flags: { radiation: 18 } },
  { id: 'hazard_sniper',  kind: 'hazard', name: "The Sniper's Shadow", terrains: ['plateau', 'redrock', 'gravel'],
    desc: 'Open ground with high ground over it, and four bodies out in the middle spaced about as far apart as a person can run.' },

  // ── marker ─────────────────────────────────────────────────────────────────
  { id: 'mark_hubcaps',   kind: 'marker', name: 'A Hubcap Shrine',
    desc: 'Two hundred hubcaps wired to a mast in rings, biggest at the bottom. It turns in the wind and makes a noise like a till. Nobody is claiming responsibility.' },
  { id: 'mark_complaint', kind: 'marker', name: 'The Complaint Board',
    desc: "A noticeboard on two posts, in the middle of absolutely nothing, with eleven laminated complaints pinned to it about the conduct of a crossing committee that hasn't met since before the Handoff. Three are replies. One is a reply to a reply." },
  { id: 'mark_boots',     kind: 'marker', name: 'The Line of Boots',
    desc: 'Forty pairs of boots set out along a fence wire in a neat row, toes all one way. Somebody has kept the row straight.' },
  { id: 'mark_sign',      kind: 'marker', name: 'A Sign for Somewhere Gone',
    desc: "A highway sign face-down in the dust with the name of a town on it. The town isn't on any map you have seen and the sign is a hundred miles from any road." },
  { id: 'mark_milepost',  kind: 'marker', name: 'A Milepost',
    desc: 'A post with a number cut into it, and under the number, scratched later by a different hand: NOT FROM HERE. IT IS FURTHER.' },
  { id: 'mark_chair',     kind: 'marker', name: 'The Chair',
    desc: "An office chair, upright, facing away from the road, in perfect condition. The dust around it's undisturbed for six feet in every direction." },
];

// ── THE WAYSIDE ──────────────────────────────────────────────────────────────
//
// Not a highlight. A highlight is rolled; a wayside is DERIVED — it is the place where the walking
// route and the road are the same place, which the trail's own geometry decides (see `trailOffsetAt`
// in index.js). So it is not in FEATURES, it cannot be seeded, and it always beats whatever the
// highlight roll came up with for that tile.
//
// ⚠ IT LOOKS TEMPORARY BECAUSE IT IS TEMPORARY. The trail reseeds every window, so the camp genuinely
// will not be here next week: guy lines, mismatched fabric, nothing founded, nothing that took a
// machine to put there. The prose and the mechanism agree without either being bent to fit.
//
// ⚠ AND IT IS NOT A SAFE ROOM. The relief on offer is water, a fire and knowing exactly where you
// are. It is `lawless` like every other tile out here, a sleeping body stays in it, and the road is
// also where the things that work roads are.
export const WAYSIDE = {
  name: 'A Wayside Camp',
  // `water_source` is the barrel, and cooking's `fill` reads it off the zone (see waterSourceIn).
  // `stove_tier` is the firepit, read by cooking's own stove lookup. Both are the ORDINARY tags the
  // rest of the world uses, never void-specific ones, which is why fill and cook work out here with
  // nothing taught about the void.
  flags: { water_source: true, stove_tier: 1 },
  descs: [
    'Four tents in a huddle off the shoulder, guyed against a wind that clearly gets worse than this. A water barrel on a pallet, a firepit ringed with stones, and a crossing sign at the roadside with the foot path worn away from it in both directions.',
    'A camp, of sorts: canvas over a frame, a drum of water with a tin cup wired to it so nobody walks off with the cup, and a fire that somebody banked rather than put out. The sign at the road is hand-lettered and the lettering has been gone over twice.',
    "Tents pitched close for the windbreak, none of them matching. There's a barrel, there's a firepit, and there's a post at the roadside with a crossbar on it, and the ground around all three is beaten flat by feet rather than by anything with wheels.",
    'Somebody set this up to be taken down again. Poles, canvas, a water drum, a ring of blackened stones, and the path coming in off the country to meet the road right here and nowhere else along it.',
  ],
};

const KINDS = ['salvage', 'respite', 'water', 'shelter', 'hazard', 'marker'];

// How often a room is anything other than ground. ⚠ These are the pacing dial for the whole crossing
// and they are deliberately LOW: at one room per tile a 1-in-20 highlight is still five per crossing,
// and a walk where every fourth room is an event is not a waste, it is a theme park.
export const FEATURE_CHANCE = 0.055;
export const KIND_WEIGHTS = { marker: 34, hazard: 24, salvage: 18, water: 10, shelter: 8, respite: 6 };

const pickFrom = (rng, arr) => arr[Math.floor(rng() * arr.length)];

// The ground's own name and description. Falls back to hardpan for a terrain nothing has been written
// for yet, rather than throwing or handing back an empty string: a new terrain key from the landform
// field should read as plain country, not as a crash.
export function groundFlavour(rng, terrain) {
  const g = GROUND[terrain] || GROUND.hardpan;
  return { name: pickFrom(rng, g.names), description: pickFrom(rng, g.descs) };
}

// What is standing on this ground, if anything. `rng` must be a fresh generator seeded off the room's
// own salt, so a feature is stable for the window and identical for everyone crossing it.
export function featureFor(rng, terrain) {
  if (rng() >= FEATURE_CHANCE) return null;
  const kind = weightedKind(rng);
  const pool = FEATURES.filter(f => f.kind === kind && (!f.terrains || f.terrains.includes(terrain)));
  // A kind with nothing written for this ground falls through to a marker rather than to nothing, so
  // the roll that said "something is here" is never silently spent on an empty room.
  if (!pool.length) return pickFrom(rng, FEATURES.filter(f => f.kind === 'marker'));
  return pickFrom(rng, pool);
}

function weightedKind(rng) {
  let total = 0;
  for (const k of KINDS) total += KIND_WEIGHTS[k] || 0;
  let roll = rng() * total;
  for (const k of KINDS) {
    roll -= KIND_WEIGHTS[k] || 0;
    if (roll < 0) return k;
  }
  return 'marker';
}

export const _test = { KINDS, pickFrom, weightedKind };
