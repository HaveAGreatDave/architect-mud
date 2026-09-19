// ONE-SHOT: lay the ground for Old Coldwater, the slums in the south-east corner.
//
//   node scripts/content/build-old-coldwater.mjs [--dry-run]
//
// See docs/proposals/old-coldwater.md. This writes CONTENT FILES ONLY — no database,
// no server. It is the step BEFORE the five buildings, because scripts/place-building.mjs
// refuses a tile with no standable road neighbour and this block had none: Kessler Street
// stops at y915 and everything south of it is unfronted grass.
//
// What it does, in order:
//
//   1. The district. content/districts/slum.json already existed with ZERO tiles and no
//      claim on it anywhere (the Under uses neither the id nor the name), so it is
//      adopted rather than adding a twenty-fourth. Renamed to Old Coldwater; the blurb,
//      signature, skyline and prefixes are rewritten for an open-air shanty instead of
//      the covered underside the original lines describe.
//
//   2. The ground: 32 tiles repainted with names, prose, terrain and flags. Ropewalk and
//      Peg Lane are `dirt_road` — the old town predates the grid and was never surfaced.
//
//   3. The two ruins, authored BY HAND rather than through place-building, because a
//      collapsed house has no interior, no door, no power and no keeper. They carry
//      `is_building` WITHOUT the `facade` tag, which is what keeps them off the map-icon
//      path (buildingIconSvg is gated on `facade`) while still raising mass out the
//      canopy. Their own exits go, and every neighbour's exit into them goes with them.
//
// ⚠ THE TENTS ARE NOT BUILDINGS. A building tile leaves the walk graph and joins the CFIT
// collision sweep, so a tent city made of `building_type` is one you cannot walk into and
// can fly into. The camp is `flags.camp` on standable ground, which deriveSurfaceCell turns
// into a `mark` — the seam the statue, the South Gate, the road signs and the depot shed
// already use.
//
// Run `node scripts/content/mint-connections.mjs --write` afterwards: turning a tile into a
// building leaves an edge geometry still projects and exits no longer declare, and that gap
// has to land as a `blocked: true` connection or content:lint reports it forever.

import { loadContentStore } from '../../tools/lib/content-store.mjs';

const dryRun = process.argv.includes('--dry-run');
const store = loadContentStore();

const REGION = 'region_coldwater';
const DISTRICT = 'slum';
const idFor = (x, y) => `zone_district_${x}_${y}`;

// ── 1. the district ──────────────────────────────────────────────────────────
store.patch('districts', DISTRICT, {
  id: DISTRICT,
  name: 'Old Coldwater',
  blurb: 'The oldest ground in the city, still standing and still lived in, which is the problem.',
  color: '#cf6a2e',
  landmark: idFor(927, 916),
  // ⚠ These must match the street names below. districtFor falls through to a prefix
  // match on the zone name for anything that doesn't carry flags.district, so a stale
  // list here puts the boundary-crossing line in the wrong place.
  prefixes: ['ropewalk', 'peg lane', 'the pitch', 'rag row'],
  signature: [
    'Woodsmoke, wet canvas, and the ammoniac tang of a place with no drains.',
    'Everything here was built by hand, badly, a very long time ago, and is still up.',
    'Somebody is hammering. Somebody is always hammering.',
    'The ground is packed earth polished to a shine by boots, and it holds the rain in ruts.',
  ],
  skyline: "Old Coldwater's roofline sags below everything around it, chimneys and aerials and no two ridges level",
  sort: 140,
});

// ── 2. the ground ────────────────────────────────────────────────────────────
// `kind` drives terrain, theme and the loot table; everything else is per tile.
//   lane  — Ropewalk / Peg Lane / Rag Row, unmade cart track
//   camp  — the Pitch, standable dirt carrying flags.camp (the tent mark)
//   wall  — a Curtain tile, kept walkable exactly as it already was
//   yard  — open ground off a lane, standable, no tents
//
// ⚠ NOT ONE OF THESE AUTO-TILES, AND `dirt_road` IS THE TRAP IT LOOKS LIKE THE ANSWER TO.
// The first cut made the lanes `dirt_road`, which is the obvious reading of "an unpaved street"
// and is wrong here: `deriveAutoTile` joins two tiles when BOTH terrains carry `auto_tile`, and
// that set is exactly {road, dirt_road} — deliberately, so a GRADED HAUL ROAD like The Glacis
// meets a paved street at a proper junction. Ropewalk is a cart track that was never surveyed,
// and measured against the real palette it was drawing `new` on FIVE CONSECUTIVE TILES and a
// full `nesw` crossroads at 921,916: a paved T-junction into Kessler at every tile of the slum,
// with The Gate Road growing an arm east to meet it.
//
// `dirt` and `ash` both carry `auto_tile: false`, so no piece is drawn and nothing fuses. The
// lane still READS as a lane, by contrast rather than by connector art: #6b5138 worn brown
// against #4f4b47 churned grey is a track through a camp, which is what the concept says it is.
// ⚠ And losing `dirt_road`'s `speed_mult: 2` is correct rather than a cost — the Shingles is mud,
// and walking it being slower than walking Kessler Street is the district working.
const KIND = {
  lane: { terrain: 'dirt', theme: 'city', scav: 'scav_roadside_junk', street_life: true },
  camp: { terrain: 'ash', theme: 'residential', scav: 'scav_consumer_trash', camp: true },
  wall: { terrain: 'ash', theme: 'residential', scav: 'scav_consumer_trash' },
  yard: { terrain: 'dirt', theme: 'city', scav: 'scav_roadside_junk', street_life: true },
};

const TILES = [
  // ── Ropewalk, the spine (y916) ─────────────────────────────────────────────
  [919, 916, 'lane', 'Ropewalk', "Where the Gate Road gives up being a road. The tarmac stops against a kerb nothing has been laid against in years, and Ropewalk runs east from it as packed dirt, rutted, going wherever the carts went first. The houses start twenty feet in and not one of them lines up with the next."],
  [920, 916, 'lane', 'Ropewalk', "Packed earth between two rows of frontages nobody ever surveyed. The doorsteps sit at six different heights and every one has been worn into a dish. Somebody has swept their length of it edge to edge and stopped exactly at the boundary."],
  [921, 916, 'lane', 'Ropewalk', "Peg Lane opens south here, a gap barely wide enough for two people to pass each other, with a run of washing strung across it high up. Ropewalk carries on east. The gap is where everybody turns."],
  [922, 916, 'lane', 'Ropewalk', "Bed Rock leans out over this stretch, four storeys of it, close enough that the lane is in shadow by mid-afternoon. Rain comes off the eaves in one place and has dug itself a trench. A cat has the dry part."],
  [923, 916, 'lane', 'Ropewalk', "The queue for No Such Thing starts about here and doubles back on itself most days. There is no shouting in it. People have stood in this exact line long enough to have worked out the etiquette, and newcomers get told."],
  [924, 916, 'lane', 'Ropewalk', "Rag Row comes down unmade from Kessler Street and meets Ropewalk at a corner nobody planned. There's a standpipe on the junction with its handle wired off. The wire has been there long enough to rust into the thread."],
  [925, 916, 'lane', 'Ropewalk', "Two houses gone on the south side, taken down to knee height and left. The rubble got tidied into a wall and the wall has stood long enough to have a gate in it. Whatever the gate is for, it isn't the rubble."],
  [926, 916, 'lane', 'Ropewalk', "The last of the frontages. Still Standing holds the corner with its counter open to the lane, and past it the light goes strange: everything at this end is lit down one side by something that never moves and never changes colour."],
  [927, 916, 'wall', 'Ropewalk, The Cut', "The street stops. The Curtain comes down through it floor to sky, and the other half of Ropewalk stands on the far side, forty feet off: roofs, a chimney, a gable with the render off it. Nothing over there has moved in eleven years. Nothing over there has fallen down either."],

  // ── the frontage (y917) — the five buildings are placed separately ─────────
  [921, 917, 'lane', 'Peg Lane', "A gap between two buildings that counts as a street because people use it as one. Washing overhead at three heights, a gutter down the middle doing its best, and daylight at the far end where the camp opens out."],
  // ⚠ 925,917 IS THE STORM DRAIN AND CANNOT BE BUILT ON. `zone_under_925_917` exits `up` into this
  // tile and this tile exits `down` into it — the only seam into the Under anywhere in the block.
  // The first draft of this script had a ruin here, which would have sealed that drain silently.
  // It stays walkable, and it is a DEAD END: no south exit, so Peg Lane remains the only way into
  // the Pitch (see the proposal). The severing of the 925,917 ↔ 925,918 pair is done below.
  [925, 917, 'yard', 'The Sink', "A yard between two buildings, four paces across, with a storm grating in the middle of it that the ground falls away towards. The bars are worn bright on top and there is no rust on them at all. Whatever uses this drain uses it often enough to keep it polished."],
  [927, 917, 'wall', 'The East Wall', "The Curtain, close enough to put a hand on if anybody ever did. It makes no sound worth calling a sound and throws no heat at all. Tents are pitched hard against it the whole length of the corner, because the ground is dry here and nothing can come at you from the east."],

  // ── the Pitch (y918) ───────────────────────────────────────────────────────
  [920, 918, 'camp', 'The Pitch', "The west end of the camp, backed up against the junkyard fence. The tents here are the oldest: canvas gone the colour of the ground, patched with whatever came to hand, guyed to pegs somebody drove years ago and never once moved."],
  [921, 918, 'camp', 'The Pitch', "Peg Lane comes out here and the camp opens in front of you, a few hundred tents on flat ground with lanes between them barely wide enough to walk. Somebody is always sitting at this end, and they always look up."],
  [922, 918, 'camp', 'The Pitch', "Canvas either side, close enough to put a hand on both. A brazier burns in a cut-down drum with four people round it and room for a fifth. The smoke goes straight up. There is no wind in here at all."],
  [923, 918, 'camp', 'The Pitch', "A lane of tents with a standpipe at the end that actually works, which is why this is the busiest part of the camp and why the ground is churned to grey mud for six feet in every direction."],
  [924, 918, 'camp', 'The Pitch', "Somebody has built up instead of out: a tent on a platform on four salvaged posts, with a second tent underneath it. It has stood long enough for the posts to settle, and it leans. Nobody appears worried about this."],
  [925, 918, 'camp', 'The Pitch', "The far end, where the tents thin out and the pitches get bigger and better kept. There is no rope, no fence and no sign of any kind, and it is completely obvious where the good ground starts."],
  [926, 918, 'camp', 'The Pitch', "Two walls of hard light meet at a right angle here, floor to sky, and the camp runs right up to both of them. It is the only corner of Coldwater the wind has never once got into, and the pitches here are handed down rather than taken."],
  [927, 918, 'wall', 'The Corner', "The inside angle of the Curtain, where the south wall and the east wall meet and the hum of the two of them beats against each other slightly out of time. The light is good enough to read by. There is a bench."],

  // ── Rag Row (y914-915) ─────────────────────────────────────────────────────
  [924, 914, 'lane', 'Rag Row', "Kessler Street's kerbs stop dead and Rag Row starts: unmade ground, ruts, and the backs of the Nine Elms blocks looking down into it. This is where the residents put the things they don't want collected."],
  // 925,914 is The Burnt House — see RUINS below.
  [926, 914, 'camp', 'Rag Row', "The tents start here, pitched tight against the east wall in a single row that runs south out of sight. The nearest one has a doormat. Fly-tipping comes down the row in tidy sorted heaps, which is the strange part: metal here, fabric there, glass in a drum with a chalked price on it that gets kept up to date."],
  [924, 915, 'lane', 'Rag Row', "A row of pitches down one side and open churned ground on the other, where a cart gets turned round. That turning circle is the only piece of ground in the Shingles nobody has built on, and it isn't an accident."],
  [925, 915, 'camp', 'Rag Row', "Washing lines strung from the tent row to a set of posts driven into the mud, three deep. In this district a line is property, and everybody knows exactly whose is whose."],
  [926, 915, 'camp', 'Rag Row', "Hard against the Curtain, where the light coming off it is bright enough at night to work by. Two women are re-canvassing a tent frame, and neither of them is using a lamp."],
];

let painted = 0;
for (const [x, y, kindKey, name, description] of TILES) {
  const id = idFor(x, y);
  const prev = store.get('zones', id);
  if (!prev) throw new Error(`${id} does not exist — this script repaints, it does not create.`);
  const k = KIND[kindKey];

  // Keep only what is still true of the tile. `color` was a grass tint and the ground is
  // no longer grass; `park_feature` and `artery` belonged to the street this used to be.
  const flags = { ...prev.flags };
  delete flags.park_feature;
  delete flags.artery;
  delete flags.street_life;
  delete flags.camp;

  flags.district = DISTRICT;
  flags.region_id = REGION;
  flags.terrain = k.terrain;
  flags.scavenging_table_id = k.scav;
  if (k.street_life) flags.street_life = true;
  if (k.camp) flags.camp = true;
  // Ropewalk is a named through-route and reads as one on the minimap and in `route`.
  if (name === 'Ropewalk') flags.artery = ['Ropewalk'];

  const next = { ...prev, name, description, flags, ambient_theme: k.theme };
  delete next.color;
  delete next.bg_color;
  store.put('zones', next);
  painted++;
}

// ── 3. the two ruins ─────────────────────────────────────────────────────────
// Mass with no door: `is_building` raises it out the canopy and takes it out of the walk
// graph, and the ABSENCE of a `facade` tag is what keeps it off the icon path and out of
// resolveFacadeTransit. Nothing about a ruin is enterable, so nothing here mints an
// interior map, a lobby, a door, a generator or a keeper.
const RUINS = [
  [920, 917, 'A Collapsed Terrace', "Three houses that came down together and were never cleared, because clearing them would mean agreeing whose they were. The front wall is up to the first-floor windows and the sky is behind it. Rooks nest in the chimney breast, which is the tallest thing left."],
  [925, 914, 'The Burnt House', "It burned a long time ago and burned properly: the brick shell stands, the roof is gone, and the joist pockets run in two neat rows down the inside of the walls like something anatomical. Somebody has bricked the doorway up, neatly, with the wrong brick."],
];

const OPPOSITE = { north: 'south', south: 'north', east: 'west', west: 'east', up: 'down', down: 'up' };
let sealed = 0;
for (const [x, y, name, description] of RUINS) {
  const id = idFor(x, y);
  const prev = store.get('zones', id);
  if (!prev) throw new Error(`${id} does not exist`);

  const flags = { ...prev.flags };
  delete flags.terrain;       // a building has no ground surface
  delete flags.street_life;
  delete flags.camp;
  delete flags.scavenging_table_id;   // you cannot forage a building you cannot enter
  delete flags.artery;
  delete flags.park_feature;
  flags.district = DISTRICT;
  flags.region_id = REGION;
  flags.is_building = true;
  flags.building_type = 'ruin';
  flags.building_name = name;
  // NO `facade`, NO `entrance`, NO `world_exit_zone`: there is no way in.

  const next = { ...prev, name, description, flags, exits: {}, ambient_theme: 'outdoors' };
  delete next.color;
  delete next.bg_color;
  store.put('zones', next);

  // Every neighbour that pointed at it stops pointing at it.
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

// ── 4. the Sink is a dead end ────────────────────────────────────────────────
// The drain yard opens off Ropewalk and onto nothing else. Without this the block has TWO ways
// into the Pitch four tiles apart, which makes the camp a thoroughfare rather than a cul-de-sac;
// Peg Lane being the only approach is the whole reason being followed into it matters.
// Both halves of the pair go, or the projection reports a one-way link forever.
const SEVER = [[idFor(925, 917), 'south', idFor(925, 918)], [idFor(925, 918), 'north', idFor(925, 917)]];
for (const [from, dir, to] of SEVER) {
  const z = store.get('zones', from);
  if (!z || z.exits?.[dir] !== to) continue;
  const exits = { ...z.exits };
  delete exits[dir];
  store.patch('zones', from, { exits });
}

// ── write ────────────────────────────────────────────────────────────────────
const written = store.flush({ dryRun });
console.log(`${dryRun ? 'would write' : 'wrote'} ${written.length} file(s)`);
console.log(`  district  ${DISTRICT} → Old Coldwater`);
console.log(`  ground    ${painted} tiles repainted`);
console.log(`  ruins     ${RUINS.length} (${sealed} neighbour exit(s) sealed)`);
console.log(`\nnext: place the five buildings, then:\n  node scripts/content/mint-connections.mjs --write\n  npm run content:lint`);
