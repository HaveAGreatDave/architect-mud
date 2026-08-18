// Build TERMINUS — the Exodus settlement. THE REDRAW (2026-08-18).
//
// A one-shot content generator. It writes files under `content/` and touches no database: git is
// the source of truth, so this emits the tree and `npm run content:import` loads it. Re-runnable —
// it overwrites its own output and nothing else.
//
// ── What changed, and why ────────────────────────────────────────────────────
//
// Pass 1 shipped a 14x14 box with the wall drawn as a straight COLUMN down the middle of it: apron
// west, rumour east. That was the right shape for a place whose entire content was a shut door, and
// the wrong shape the moment the inside became real. Three things were wrong with it:
//
//   1. A wall that is a LINE is a border, not a defence. You cannot walk round a settlement that
//      has no round. The wall is now a RING, and the compound is a thing with an outside.
//   2. 196 tiles of one flat terrain is not country, it is a colour — the same finding the
//      Scarletwastes wrote down when its own flat sheet never got hand-painted. The region is now
//      40x40 and its ground is DERIVED off one continuous height field, so the bands are
//      contiguous: a mesa sheds its own scree, scrub takes the drainage lines, the pans sit in the
//      low ground. If you want it different, change the surface. Never sprinkle a tile.
//   3. The Gantry was a pad on the apron, which made the Exodus's one great work a car park for
//      visitors. THE PAD IS NOW THE MIDDLE OF THE TEMPLE. They built it to leave the planet, so it
//      sits at the centre of everything they do and the compound is laid out around it the way a
//      church is laid out around an altar. The visitors' pad stays outside, where visitors go.
//
// The region grew EAST, NORTH and SOUTH and its west rim did not move, so the void's arrival tile
// (`zone_terminus_1200_940`, VOIDS in plugins/voidwalking/index.js) is untouched and none of this
// needed an engine change.
//
// LAYOUT (40x40, x 1200-1239, y 921-960). You arrive from the WEST, off Coldwater's east rim.
//
//        1200        1211              1229        1239
//   921  +--------------------------------------------+
//        |             open country (derived)         |
//   931  |           +====================+           |
//        |  APRON    #   the compound     #  country  |
//   940  |  ==road===G       * pad *      #           |
//        |           #                    #           |
//   949  |           +====================+           |
//        |             open country (derived)         |
//   960  +--------------------------------------------+
//
// Tiles are cheap fill; the authored cost is the buildings and the people.
//
// FIRST RUN, in order — the middle step exists because a building's two-letter map code can only be
// chosen by something that sees every building in the world at once, which this script cannot:
//
//   node scripts/build-terminus.mjs
//   npm run content:import && npm run map:derive
//   node scripts/bake-terminus-markers.mjs     <- writes the derived codes back into content
//   npm run content:import
//   node scripts/build-terminus-npcs.mjs && npm run content:import
//
// After that, re-running this script is safe: it carries any existing `marker` forward.

import { writeFileSync, readFileSync, readdirSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const REGION = 'region_terminus';

// The region box. The west rim is pinned at x1200 (the void lands there); everything else grew out.
const X0 = 1200, X1 = 1239, Y0 = 921, Y1 = 960;

// The compound. A RING of wall, 19x19, centred on (1220, 940), so the pad sits on the exact middle
// tile of the exact middle of the region. The road row and the centre row are the same row, which
// is why the processional runs dead straight from the gate to the pad and reads as one gesture.
const W0 = 1211, W1 = 1229, V0 = 931, V1 = 949;             // the wall ring's own tiles
const I0 = W0 + 1, I1 = W1 - 1, J0 = V0 + 1, J1 = V1 - 1;   // inside: x1212-1228, y932-948
const ROAD_Y = 940;
const GATE_X = W0, GATE_Y = ROAD_Y;                          // the one way in, on the west face
const PAD_X = 1220, PAD_Y = 940;                             // the Ascension

// Tiles whose authored content predates the redraw and must survive it untouched. Last Requisition
// is a built building with a shed interior, a vendor and a truck depot in it; the redraw moves the
// world around it, not it.
const PRESERVE = new Set(['1202_939', '1202_940']);

const id = (x, y) => `zone_terminus_${x}_${y}`;
const zonePath = (i) => join(ROOT, 'content', 'zones', `${i}.json`);
const powerPath = (i) => join(ROOT, 'content', 'power_zones', `${i}.json`);
const key = (x, y) => `${x}_${y}`;
const OPP = { north: 'south', south: 'north', east: 'west', west: 'east' };
const STEP = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };

// Canonical JSON: keys sorted, two-space indent, trailing newline — matches what `content:export`
// emits, so a later export produces no spurious diff. (A naive sorted-key REPLACER silently empties
// nested objects; sorting the KEYS during stringify does not.)
function canonical(obj) {
  const sort = (v) => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v).sort()) out[k] = sort(v[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(sort(obj), null, 2) + '\n';
}
const write = (p, obj) => writeFileSync(p, canonical(obj), 'utf8');
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

// ── THE GROUND ───────────────────────────────────────────────────────────────
//
// One continuous height surface, two-octave hashed value noise, no RNG — so a rebuild is
// byte-identical and a re-import produces no diff. Each terrain family is a THRESHOLD on that one
// surface, which is what makes the bands contiguous rather than speckled. Lifted deliberately from
// build-scarletwastes.mjs: this is the second region to use it, and it is now the house rule.
//
//   THE GROUND IS A FIELD, NOT A SPRINKLE.
//
// Terminus reads differently from the Scarletwastes despite sharing the machinery, and the
// difference is in the thresholds rather than the code: this is HIGHER, DRIER country. More bare
// rock, scrub only in the washes, and a salt pan in the southwest that nothing grows in at all.
// The Wildblood live in country that feeds them. These people live in country that does not, and
// grow their food in glass because of it.
function hash2(ix, iy, salt) {
  let h = (ix * 374761393 + iy * 668265263 + salt * 2246822519) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function noise(x, y, scale, salt) {
  const fx = x / scale, fy = y / scale;
  const ix = Math.floor(fx), iy = Math.floor(fy);
  const tx = fx - ix, ty = fy - iy;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const a = hash2(ix, iy, salt), b = hash2(ix + 1, iy, salt);
  const c = hash2(ix, iy + 1, salt), d = hash2(ix + 1, iy + 1, salt);
  const top = a + (b - a) * sx, bot = c + (d - c) * sx;
  return top + (bot - top) * sy;
}
const fbm = (x, y, scale, salt) => noise(x, y, scale, salt) * 0.68 + noise(x, y, scale / 2.7, salt + 91) * 0.32;

const inBox = (x, y) => x >= X0 && x <= X1 && y >= Y0 && y <= Y1;
const inCompound = (x, y) => x >= W0 && x <= W1 && y >= V0 && y <= V1;
const isWallRing = (x, y) => inCompound(x, y) && (x === W0 || x === W1 || y === V0 || y === V1);
const isInside = (x, y) => x >= I0 && x <= I1 && y >= J0 && y <= J1;

// THE APPROACH CORRIDOR IS EXEMPT FROM THE LANDFORM, and that is a correctness rule rather than a
// taste one. `cliff` is the only impassable terrain in the game and the height field does not know
// there is a road. One cliff tile dropped across y940 between the void's arrival tile and the gate
// and the whole region is unreachable on foot, with nothing anywhere to say so. The corridor is
// three rows deep, so the road has a shoulder and a truck that wanders off it is on ground rather
// than in a wall.
const inCorridor = (x, y) => x >= X0 && x < W0 && y >= ROAD_Y - 1 && y <= ROAD_Y + 1;
// So is the ground the Gantry and Last Requisition stand on. A pad on a 20-metre escarpment is not
// a pad, and a shed you cannot back a trailer up to is not a depot.
const APRON_FLAT = new Set([
  '1201_938', '1201_939', '1201_940', '1201_941',
  '1202_938', '1202_939', '1202_940', '1202_941',
  '1203_941', '1203_942', '1203_943', '1203_944',
  '1204_942', '1204_943', '1204_944', '1202_942',
]);

// THE THRESHOLDS ARE TUNED TO THIS WINDOW, NOT TO THE UNIT INTERVAL. Value noise is only uniform
// over an infinite plane; across any particular 40x40 patch of it the distribution is whatever it
// happens to be, and over this one the height field runs from 0.29 to 0.91 with its median at
// 0.633. Reusing the Scarletwastes' numbers unchanged is what produced the first build of this
// region: 63% of it above the scree line, and not one tile of hardpan, sand or salt anywhere,
// because three of the nine bands sat below the field's own floor. If you move the box, re-measure
// the field before you trust these.
const MESA_H = 0.710;    // caprock, ~22% of the country with its rim
const SCREE_H = 0.645;   // the talus skirt below it
const WET_H = 0.700;     // the washes
const PAN_H = 0.590;     // hardpan wants low ground
const DUNE_H = 0.520;    // sand wants lower

// THE SALT. One flat, in the southwest quarter and nowhere else, because a salt pan that turns up
// in four corners of a map is a texture rather than a place. It is asked FIRST and it is excluded
// from the high-ground test, for the same reason the compound is: a tile the landform pass never
// gets to decide is not high ground whatever the height field says, and a salt flat with a
// tableland growing out of the middle of it is not a salt flat.
const inSalt = (x, y) => x < 1219 && y > 945
  && fbm(x, y, 12, 3) < 0.70 && fbm(x, y, 9, 55) > 0.36;

// HIGH GROUND, asked the same way by everything that asks. A tile the landform pass never gets to
// decide is not high ground whatever the height field says about it — ask the field alone and the
// rim test believes the massif continues under the compound, declines to draw a face at the edge
// of it, and the tableland meets the wall with no drop between them.
const isMesa = (x, y) => inBox(x, y) && !inCompound(x, y) && !inCorridor(x, y)
  && !APRON_FLAT.has(key(x, y)) && !inSalt(x, y) && fbm(x, y, 12, 3) > MESA_H;

// The ways through come from a SECOND continuous field, not a per-tile roll. Noise above a
// threshold clusters, so a gap is two or three walkable tiles in a row you can see from a distance
// and aim for. A hash per rim tile scatters single-tile pinholes and funnels nobody.
const isPass = (x, y) => fbm(x, y, 4.5, 77) > 0.71;

function landformAt(x, y) {
  if (inSalt(x, y)) return 'salt';
  const h = fbm(x, y, 12, 3);
  if (h > MESA_H) {
    const rim = !isMesa(x, y - 1) || !isMesa(x, y + 1) || !isMesa(x + 1, y) || !isMesa(x - 1, y);
    if (rim) return isPass(x, y) ? 'ramp' : 'cliff';
    return 'mesa';                                   // caprock, flat on top and a long way up
  }
  if (h > SCREE_H) return 'scree';                   // the talus skirt a mesa sheds
  // The washes. Scrub takes the low ground because the low ground is where the runoff goes, and
  // out here there is not much of it, so the threshold is high and the scrub reads as a thin line
  // rather than a carpet.
  const wet = fbm(x, y, 7, 23) + (0.5 - h) * 0.5;
  if (wet > WET_H) return 'scrub';
  if (h < PAN_H && fbm(x, y, 6, 41) > 0.545) return 'pan';   // hardpan, the flattest ground here
  if (h < DUNE_H && fbm(x, y, 5, 61) > 0.55) return 'dune';  // blown sand collecting in the lee
  return 'flat';
}
const TERRAIN_OF = {
  flat: 'redrock', mesa: 'plateau', cliff: 'cliff', ramp: 'ramp',
  scree: 'gravel', scrub: 'scrub', pan: 'hardpan', salt: 'alkali', dune: 'sand',
};

// ── THE COMPOUND'S OWN GROUND ────────────────────────────────────────────────
//
// Inside the wall the ground is not weather, it is HOUSEKEEPING, so it is authored rather than
// derived. Three surfaces and no more: raked gravel on the ways people walk, swept hardpan
// everywhere else, and one square of concrete under the pad. The restraint is the point — a
// courtyard with five surfaces in it is a courtyard nobody sweeps.
const isProcessional = (x, y) => isInside(x, y) && y === ROAD_Y;
const isSpine = (x, y) => isInside(x, y) && x === PAD_X;
const isRing = (x, y) => isInside(x, y) && (x === I0 || x === I1 || y === J0 || y === J1);
const isPlaza = (x, y) => x >= PAD_X - 1 && x <= PAD_X + 1 && y >= PAD_Y - 1 && y <= PAD_Y + 1;
const isPad = (x, y) => x === PAD_X && y === PAD_Y;

// ── THE BUILDINGS ────────────────────────────────────────────────────────────
//
// Every `building_type` here is one `drawTypeModel` already models, checked against the case list
// in client/game/js/panels/windshield.js. Picking a type off the fiction rather than off the
// renderer's list is how you ship a grey box.
//
// `entrance` orients the 3D model toward the street AND decides the geometry: the street tile is
// the neighbour in the entrance direction, and the interior hangs off the OPPOSITE side. Getting
// that backwards produces a door in a wall and an interior you reach by walking into rock.
//
// A note on what is NOT here. There is no shop sign anywhere in the compound, no painted name, no
// board of opening hours. Everything is called what it is by the people who use it and by nobody
// else, and a visitor is expected to already know. That is not a detail, it is the district's whole
// manner: nothing is explained, because everyone already knows, and asking marks you.
const BUILDINGS = {
  // ── The apron, preserved ───────────────────────────────────────────────────
  // Last Requisition is a BUILT building: a shed interior, a vendor, a truck depot and prose
  // somebody wrote by hand, all of it added after the pass-1 generator and none of it in this
  // file. It is listed here so the geometry pass knows it is a facade (otherwise the exit rebuild
  // treats it as open ground and quietly deletes the only way into its shed), and `preserve`
  // stops everything else about it being regenerated from a table that does not know the half of
  // it. `interiorId` is spelled out because this one interior does not follow the `zone_exo_*`
  // naming the rest of the compound uses.
  '1202_939': {
    name: 'Last Requisition', type: 'truck_depot', entrance: 'south', floors: 3,
    slug: 'roadhead', interiorId: 'zone_yard_roadhead', preserve: true,
    seamId: 'conn_terminus_1202_939_north_haulb',
  },

  // ── The wall's one opening ─────────────────────────────────────────────────
  // Promoted out of the ring. Everything else in the ring is anonymous mass; this is the landmark,
  // and it is the only tile in the wall that earns a name and a map code.
  '1211_939': {
    name: 'The Gate House', type: 'civic', entrance: 'south', floors: 2, slug: 'gatehouse',
    desc: 'The wall thickens here into a squat two-storey block with a stair running up the inside of it to the walk. Arrow slits, of a sort, except that nothing about the people here suggests arrows. There is a bell mounted under the eave with no rope on it.',
    room: 'The Gate House',
    interior: 'A bare room with a stove, a kettle, four chairs and a table with a rota chalked on it. The rota runs three weeks ahead and every name on it has been written by the same hand. On a peg by the door, a coat nobody is wearing, and under the coat a pair of boots set square. Whoever is off shift is not in here, and the room has been left as though somebody is about to be.',
    floor: 'stone',
    light: ['a hooded lamp', 'A single hooded lamp over the table, turned low and never turned off. It is the only light burning on this wall after dark and it is deliberately not bright enough to see the road by.'],
    amb: [
      'Boots go up the stair on the far side of the wall, and along, and stop.',
      'The kettle is filled from a jug and set on without anybody saying anything about tea.',
      'Somebody crosses a name off the rota and writes it in again two rows down.',
      'Wind finds the arrow slits and makes a low sound out of them, three notes, always the same three.',
    ],
  },

  // ── The heart ──────────────────────────────────────────────────────────────
  // Directly north of the pad, facing it. It stands on the spine, which means the way north through
  // the compound goes AROUND the hall rather than through it: you cannot walk from the gate to the
  // north wall in a straight line, and the reason is a building full of people you cannot join yet.
  '1220_938': {
    name: 'The Waking Hall', type: 'civic', entrance: 'south', floors: 2, slug: 'waking',
    desc: 'A long low hall of dressed red stone, its doors standing open on the pad, its roof carrying a clerestory of narrow lights that catch the last of the sun and hold it after everything else has gone dark. There is no tower, no bell, no symbol cut anywhere into it. It is the biggest building here by a considerable margin and it is the only one that has not been made to look like anything.',
    room: 'The Waking Hall',
    interior: 'Benches, in rows, facing a floor rather than an altar. The floor at the far end is worn pale in one patch about the size of a person standing. Nothing hangs on the walls. The acoustics are extraordinary and entirely accidental, which nobody here will say, because saying it would mean somebody had checked.\n\nIt is very quiet, in a way that has nothing to do with sound.',
    floor: 'stone',
    psiDoor: true,
    light: ['the clerestory', 'A row of narrow lights along the top of the wall, angled so that what comes in is the light off the ceiling rather than the sun. After dark it is lamps, set low, and there are fewer of them than there should be.'],
    amb: [
      'The room goes quieter. Not less noisy. Quieter.',
      'Somebody at the back stands, crosses the floor, sits down again, and nobody looks up.',
      'A bench creaks in the empty half of the hall.',
      'Two people come in, sit apart, and do not once speak, and leave at the same moment.',
      'Somewhere above you the clerestory glass ticks as the heat goes out of the day.',
    ],
  },

  // ── The discipline ─────────────────────────────────────────────────────────
  // Fronting the processional, first building on your left as you walk in from the gate. That is
  // deliberate: it is the room a newcomer is taken to, and it is the room they leave lighter.
  '1216_941': {
    name: 'The Stillhouse', type: 'clinic', entrance: 'north', floors: 1, slug: 'stillhouse',
    desc: 'Single storey, thick-walled, no windows facing the road. A drum stands outside the door on a pallet with a lid strapped down on it, and the drum is the only thing in the compound that anybody has bothered to chain to anything.',
    room: 'The Stillhouse',
    interior: 'Whitewash, a drain in the middle of the floor, and a chair bolted down over it under a hood of salvaged medical gear. Along one wall, a bench with a great deal of clean linen folded on it and a bucket underneath. At the far end there is a second door, plain, with no handle on it.\n\nThe room smells of soap and, under the soap, of something else.',
    floor: 'tile',
    light: ['a work lamp on a bracket', 'A shielded work lamp on a swing bracket over the chair, the only thing in the room aimed at anything.'],
    amb: [
      'The drain gurgles once and settles.',
      'Linen is refolded on the bench by somebody who has folded a great deal of linen.',
      'The door at the far end does not open. You had not asked it to.',
      'Water runs somewhere behind the wall, for a long time, and stops all at once.',
    ],
  },

  // ── Ordinary human life. The whole argument of the place. ──────────────────
  '1224_939': {
    name: 'The Long Table', type: 'diner', entrance: 'south', floors: 1, slug: 'table',
    desc: 'A long shed with its whole south side folded open on props, so the room and the yard are the same room in daylight. Trestles, benches, and a stone hearth at the end with three pots on it. You can smell it from the gate.',
    room: 'The Long Table',
    interior: 'One table, forty feet of it, and benches down both sides worn to a shine. Three pots on the hearth, a stack of bowls, and a slate by the door with the day on it in one word: BARLEY. The floor has been swept so many times the stone has gone soft at the edges.\n\nPeople come in, eat, wash their own bowl, and go. Nobody sits at the head, because there is not one.',
    floor: 'stone',
    light: ['lamps down the beam', 'A row of oil lamps hung down the centre beam over the table, lit at dusk by whoever is nearest and put out by whoever leaves last.'],
    amb: [
      'The pot gets a stir and a taste and then a bit more of something.',
      'Somebody laughs, once, and the room turns and is pleased about it.',
      'Bowls go into the trough and come out clean and get stacked without a word passing.',
      'A child is fed first. Every time, and nobody arranges it.',
      'The slate is wiped and the same word is written on it again.',
    ],
  },
  '1213_935': {
    name: 'The Wash House', type: 'bathhouse', entrance: 'west', floors: 1, slug: 'wash',
    desc: 'A blockhouse with a chimney and a great deal of steam coming out from under the eaves in the cold part of the morning. A line of clogs outside the door, in pairs, in order of size.',
    room: 'The Wash House',
    interior: 'Duckboards, a long trough, and a copper at the end with a fire under it. Everything wooden in here has gone silver with steam. There are hooks, and on the hooks are towels, and each towel is a different colour and has clearly been that person\'s towel for years.\n\nWater is not wasted here. That is not a sign on the wall, it is just a thing that visibly does not happen.',
    floor: 'boards',
    light: ['a lantern on a hook', 'A storm lantern on a hook by the copper, well back from the steam, with a wire cage on it that somebody made carefully.'],
    amb: [
      'The copper is topped up from a jug and the fire is fed one stick.',
      'Somebody hums four notes, stops, and starts again from the beginning.',
      'Steam rolls along the ceiling and finds the gap under the eave.',
      'A towel is taken off its hook and a different one is put in its place.',
    ],
  },
  '1216_933': {
    name: 'The Long Dormitory', type: 'apartment', entrance: 'north', floors: 2, slug: 'dorm',
    desc: 'Two storeys of small square windows, every one of them the same size, and every one of them with the shutter set at exactly the same angle. Not a decision anybody made together, and not one anybody made separately either.',
    room: 'The Long Dormitory',
    interior: 'Beds down both walls, a chest at the foot of each, and nothing on top of any chest. The blankets are the same blanket. The pillows are the same pillow. Somebody\'s boots stand under a bed at the far end with a book laid across them, and that is the single most personal object in a room that sleeps sixty.\n\nThere are no locks and there is nothing here worth one.',
    floor: 'boards',
    light: ['the stair lamp', 'One lamp at the head of the stair, on all night, shaded so it lights the treads and nothing else.'],
    amb: [
      'Somebody turns over, two rows down, and settles.',
      'A blanket is squared off at the foot of a bed that is already made.',
      'The building ticks as it cools.',
      'Someone comes in off a night shift, undresses in the dark without a sound, and is asleep in under a minute.',
    ],
  },
  '1213_944': {
    name: 'The Mending Room', type: 'clinic', entrance: 'west', floors: 1, slug: 'mending',
    desc: 'A low white building with a bench outside the door and, on the bench, a jug and two cups. Whoever is waiting is waiting out here in the sun, and somebody has thought about that.',
    room: 'The Mending Room',
    interior: 'Two beds, a screen, a scrubbed table and a wall of small drawers, each one labelled in a small square hand. Splints, honey, boiled linen, willow, a bone saw kept very clean and used very rarely. There is no machine in this room. There is a great deal of knowledge in it, and most of it is in one person\'s head.\n\nA child\'s drawing is pinned inside the door where the patient can see it and the physician cannot.',
    floor: 'tile',
    light: ['the window and a lamp', 'The window is set high and wide and does most of the work. The lamp is for the nights, and it is a good one, and it is the one thing here they bought from outside.'],
    amb: [
      'A drawer goes out, and back, and the label gets straightened.',
      'Somebody outside on the bench pours a cup and does not drink it.',
      'Linen comes off the boil and is hung, steaming, on the line by the window.',
      'A splint is cut down to length with four unhurried strokes.',
    ],
  },
  '1219_935': {
    name: 'The Creche', type: 'civic', entrance: 'east', floors: 1, slug: 'creche',
    desc: 'A single room with a yard walled off in front of it, and in the yard a swing, a sand pit, and a low fence around a patch of dirt where things have been planted in rows by somebody about four years old.',
    room: 'The Creche',
    interior: 'Low benches, a slate wall, chalk in a tin, and a row of pegs at knee height with a coat on each. There are eleven children in here and the room is not loud.\n\nThey are drawing. Several of them are drawing the same thing, which is a shape with a great many straight lines going up out of it, and none of them are looking at each other\'s work.',
    floor: 'boards',
    light: ['the tall windows', 'Windows down the whole south wall, unusually large for this place, and a lamp on a high shelf for the winter afternoons.'],
    amb: [
      'A child looks up at the door a moment before anybody reaches it.',
      'Chalk goes back in the tin. All of it, without being asked.',
      'Somebody very small is crying, briefly, and is dealt with, and stops.',
      'Eleven children stop drawing at once and then, after a moment, carry on.',
      'A drawing is held up for approval to nobody in particular and gets it anyway.',
    ],
  },
  '1216_939': {
    name: 'The Open Door', type: 'hotel', entrance: 'south', floors: 2, slug: 'opendoor',
    desc: 'The only building in the compound whose door is propped, and it is propped with a stone that has clearly lived there for years. A water butt beside it with a dipper on a chain, and the chain is not there to stop anybody taking the dipper, it is there so the dipper does not get lost.',
    room: 'The Open Door',
    interior: 'A hall with six cells off it, each with a bed made up, a stool, a shelf and a jug. Nothing in any of them belongs to anybody. A ledger lies open on a stand by the door and a pen beside it, and the ledger is a list of first names and dates and nothing else, going back years, in a dozen hands.\n\nAt the far end there is a fire lit and a chair pulled up to it, and neither is for anyone in particular.',
    floor: 'boards',
    light: ['the hall fire and two lamps', 'The fire at the end throws most of it. Two lamps on the wall are lit at dusk and left burning all night, which in a place this careful with oil is a statement.'],
    amb: [
      'A cell door stands open on a made bed nobody has slept in.',
      'Somebody writes a first name in the ledger and does not write a surname.',
      'The fire is fed one log and left alone.',
      'A jug is taken away full and brought back full.',
      'Wind comes down the hall from the propped door and nobody moves to shut it.',
    ],
  },
  '1216_947': {
    name: 'The Quiet Ground', type: 'undertaker', entrance: 'south', floors: 1, slug: 'quiet',
    desc: 'A small stone building at the south wall with a walled plot behind it. The markers in the plot are all the same size and all the same stone, and each one carries a name and two dates and not one word more.',
    room: 'The Quiet Ground',
    interior: 'A cool room with a stone bier down the middle of it and a shelf of folded linen. A book lies open on a lectern: every name, in order, going back to a first entry that is not the first person to die here but the first one they had the paper to write down.\n\nThe last three entries are in the same hand as the first forty. That is not possible and nobody in the compound appears to have noticed.',
    floor: 'stone',
    light: ['a candle on the lectern', 'One candle on the lectern, lit for as long as there is a name on the bier and not otherwise. It is lit now.'],
    amb: [
      'The book\'s page is turned back and read and turned forward again.',
      'Linen is shaken out and refolded along its old creases.',
      'Cold comes up off the stone.',
      'Somebody comes in, stands, says nothing at all, and leaves.',
    ],
  },

  // ── The work ───────────────────────────────────────────────────────────────
  '1227_936': {
    name: 'The Bench', type: 'fabrication', entrance: 'east', floors: 1, slug: 'bench',
    desc: 'An open-fronted workshop with the tools hung on a board, each on its own painted outline, and not one outline empty. Whatever is being made in there is being made by hand and is being made slowly.',
    room: 'The Bench',
    interior: 'Vices, files, a treadle lathe, a forge banked low, and a rack of stock cut to length and sorted by length. Two long benches, and on the second one a thing half made that you cannot identify and that is clearly part of something much larger.\n\nOn the wall, a drawing. It is a drawing of a very tall structure, in section, dimensioned, and it has been corrected in three different hands over what looks like twenty years.',
    floor: 'concrete',
    light: ['a strip over each bench', 'One strip light over each bench, and nothing anywhere else, because a workshop lit evenly is a workshop where nobody can see what they are doing.'],
    amb: [
      'A file goes over metal eleven times and then the work is turned.',
      'The forge gets one pump of the bellows and settles back down.',
      'A tool goes back on the board, into its own outline, without anybody looking at the board.',
      'Somebody measures a thing that has already been measured, and gets the same answer, and writes it down anyway.',
    ],
  },
  '1221_934': {
    name: 'The Seed Vault', type: 'cold_storage', entrance: 'west', floors: 1, slug: 'seed',
    desc: 'Half sunk into the ground with a turf roof over it and a heavy door set into the slope. A thermometer is screwed to the door frame and a log hangs beside it on a string, and both of them are read twice a day.',
    room: 'The Seed Vault',
    interior: 'Cold, dry and dark. Drawers, floor to ceiling, four hundred of them, each labelled with a name and a year and a number that goes down by one or two every season and occasionally back up by a hundred.\n\nThis is the single most valuable thing in the region and there is no lock on the door.',
    floor: 'concrete',
    light: ['a low lamp', 'One lamp, kept low, because the drawers do better in the dark and everybody who works in here has known where everything is for years.'],
    amb: [
      'A drawer comes out an inch, is looked into, and goes back.',
      'The thermometer is read and a number is written in the log.',
      'It is very cold in here and very still and the stillness is the point.',
      'Somebody counts under their breath, in tens, and gets to four hundred, and starts again tomorrow.',
    ],
  },
  '1224_933': {
    name: 'The Glasshouse', type: 'greenhouse', entrance: 'north', floors: 2, slug: 'glass',
    desc: 'A long glazed vault on a low stone knee-wall, its ridge lights cracked open a hand\'s width. Inside, in rows, things are growing that nobody out here has bothered to grow in thirty years.',
    room: 'The Glasshouse',
    interior: 'Warm, wet, and thirty degrees off the world outside. Beans up strings, tomatoes tied back, a bed of greens, and at the far end a stand of something with a red stem that you have never seen before and that is being watched very closely by whoever is on today.\n\nThe glass is not new. It has been salvaged pane by pane over a very long time and no two panes are quite the same colour, so the light in here comes down in a hundred slightly different greens.',
    floor: 'dirt',
    light: ['the ridge lights', 'The glass does it in the day. At night there is a single bulb at the far end on a long flex, and it is on a timer somebody made out of a clock.'],
    amb: [
      'Water goes along a row, slowly, from a can with a rose on it.',
      'A ridge light is opened another two inches and propped.',
      'Something is tied back with a strip of rag, gently, twice.',
      'The whole vault ticks as the sun comes off it.',
      'A leaf is turned over and looked at underneath and turned back.',
    ],
  },
  '1227_946': {
    name: 'The Standing Charge', type: 'dynamo', entrance: 'east', floors: 1, slug: 'charge',
    desc: 'A shed with a stack, and from the stack a thin haze that is the only smoke anywhere in the compound. It is the one machine these people keep and it is kept better than anything else here, which is a sentence somebody inside would rather you did not write down.',
    room: 'The Standing Charge',
    interior: 'The plant. A single generator on a concrete pad, bedded on rubber, running at a speed it has clearly been running at for years, and around it a floor you could eat off. The log on the wall goes back eleven years in daily entries. Oil, hours, load, one line a day, no gaps.\n\nA second, older machine stands stripped in the corner under a sheet, kept for parts, and the sheet is clean.',
    floor: 'concrete',
    light: ['the bulkhead lights', 'Bulkhead lights in wire cages, three of them, and a fourth over the log so it can be written in without a lamp.'],
    amb: [
      'The generator changes note by about a quarter of nothing and changes back.',
      'A gauge is tapped, read, and written down.',
      'Somebody wipes a rag round a fitting that was already clean.',
      'The load comes on as the light goes, and the note dips, and holds.',
    ],
  },
};

// The four glasshouses that are MASS rather than rooms, plus the cisterns. These carry
// `building_type` and NOTHING else — no `is_building`, no `building_name` — which is the
// Thornwarren rule and the reason it exists: `bt` (what stops a truck, what the flight sim
// extrudes) reads `building_type` alone, while the map's marker namespace keys off
// `is_building` and derives a two-letter code from `building_name`. Sixty-eight anonymous
// structures all reaching for the same letters is exactly the exhaustion Terminus hit at
// THIRTEEN in pass 1, which is where W2..W8 and six copies of WA came from.
const MASS = {
  '1226_933': 'greenhouse', '1223_936': 'greenhouse',
  '1223_943': 'greenhouse', '1226_942': 'greenhouse',
  '1223_946': 'infra', '1214_937': 'infra', '1218_945': 'infra',
};

// ── Flavour ──────────────────────────────────────────────────────────────────
//
// Spare and devotional. NO EM DASHES anywhere in this file's prose: that punctuation is a voice
// tell reserved for the Ascendants and the Architect, and these people are neither.
//
// NOTHING IS EVER NAMED. Not one line below says psionic, or cult, or creed, or explains a thing.
// The unease is entirely in behaviour that has an innocent reading and a second one, and the
// player is allowed to take the innocent one forever.
//
// The four instruments, used everywhere and never labelled: somebody answering before they were
// asked; a great many people doing one thing at one moment with no signal for it; objects in an
// order nobody was near enough to have put them in; and a room going quiet in a way that has
// nothing to do with sound.
const AMBIENT_APRON = [
  'Wind comes off the flats in one long unbroken note and does not stop.',
  'Somebody is counting, somewhere out of sight, and does not hurry.',
  'A line of figures crosses the middle distance, walking, and none of them look over.',
  'Chalk marks on a rock face. A date, maybe. It has been corrected twice.',
  'The gate does not open. Nothing about it suggests it is going to.',
  'Two figures pass on the wall walk. Neither speaks. Both change direction.',
  'Somewhere behind the wall, a great many people stop doing something at the same moment.',
  'A child watches you from the top of the wall. An adult arrives and moves them along, and you do not hear anybody call.',
  'The light goes flat and red and every stone throws a shadow twice its length.',
  'Rope, coiled and re-coiled until it is perfect. Nobody has been near it.',
  'A hand goes up on the wall walk, in greeting, a moment before you had decided to raise yours.',
  'There is no rubbish here. Not a scrap, not anywhere, and no bins either.',
  'You get the brief and entirely unsupported sense of having been read, filed, and found uninteresting.',
];

const AMBIENT_COUNTRY = [
  'The wind comes off the mesa tops in a long shove and drops away to nothing.',
  'Grit runs along the ground in a thin sheet at ankle height and stops dead.',
  'Something raptor-shaped turns twice, a very long way up, and goes east.',
  'Heat comes up off the rock in a slow column you can see the far country bend through.',
  'A rock the size of a fist comes off a rim somewhere behind you and takes a long time to land.',
  'Bones, small ones, bleached, arranged by water rather than by anybody.',
  'The salt flat throws the light back so hard that for a moment the sky is the darker half.',
  'A wash runs off toward the west, dry, with a high-water mark on it from a year nobody remembers.',
  'Wheel ruts, old, going the wrong way for anywhere.',
  'Absolutely nothing happens for a while, at considerable scale.',
];

const AMBIENT_INSIDE = [
  'Somewhere across the compound, a number of people stop doing something at the same moment.',
  'A door opens ahead of you. There is nobody behind it, and nobody comes through.',
  'Two people pass, neither speaking, and one of them laughs.',
  'Somebody hands somebody else a tool a moment before it is reached for. Neither of them remarks.',
  'A stack of trays is squared off against a wall by somebody at the other end of the yard.',
  'The gravel has been raked. Recently. There are no footprints in it and you have seen four people cross it.',
  'A child stops, looks at you steadily, and is called away by somebody who did not call.',
  'There is no rubbish. Not a scrap, and no bins either, and no smell of any.',
  'The air goes still in a way that is nothing to do with the wind.',
  'A conversation two rows away has a hole in the middle of it, and then carries on.',
  'Somebody starts to answer you and stops, politely, and waits for you to say it.',
  'Everything you can see has been mended at least once and nothing has been replaced.',
];

const TILE_NAMES_COUNTRY = [
  'The Standing Flats', 'Red Shelf', 'The Waiting Ground', 'Sunstruck Pan',
  'The Long Quiet', 'Ochre Bench', 'The Patience', 'Scoured Rock',
];
const pick = (arr, x, y) => arr[Math.abs(x * 31 + y * 17) % arr.length];

const DESC_COUNTRY = {
  flat: 'Red rock under a sky that goes on being enormous about it. Nothing grows here that anybody planted, and nothing has needed to.',
  mesa: 'Caprock. Flat as a table and a very long way up, with the whole country laid out under it going brown into the haze. The wind up here has nothing at all to break it.',
  cliff: 'The rim of the tableland, a clean red face of it going up out of reach. There is no way up here. There is a way up somewhere, and this is not it.',
  ramp: 'A break in the rim where the face has come down at some point and left a slope of rubble at an angle a person can just about take. It is the way up, and everybody who has been here knows it.',
  scree: 'Loose broken rock in a long skirt off the high ground, sorted by size the way water sorts things, moving a little underfoot the whole time.',
  scrub: 'Grey-green thorn, waist high, following a line of damp that is not visible any other way. It is the only thing out here that is any colour at all.',
  pan: 'Cracked pale hardpan, flat to the horizon and ringing slightly underfoot, the mud of a lake that dried before anybody was counting.',
  salt: 'A crust of salt so white the light comes off it upward. Nothing grows on it, nothing crosses it that does not have to, and it can be seen from the wall at any hour.',
  dune: 'Blown sand, collected in the lee of the rock and combed into long ridges that shift over each other and hiss when the wind gets under them.',
};

// ── Derived tile classification ──────────────────────────────────────────────
//
// One function, asked once per tile, and everything downstream (exits, terrain, prose, the blocked
// connections, the reachability assert) reads its answer rather than re-deciding. Two passes that
// each work out for themselves what a tile is will disagree eventually, and the disagreement will
// be a wall somebody can walk through.
const GATE_KEY = key(GATE_X, GATE_Y);

function classify(x, y) {
  const k = key(x, y);
  if (BUILDINGS[k]) return 'facade';
  if (MASS[k]) return 'mass';
  if (k === GATE_KEY) return 'gateway';            // the one hole in the ring
  if (isWallRing(x, y)) return 'wall';
  if (isInside(x, y)) return 'court';
  return 'country';
}

// Is a tile something a body can stand on and walk off? Facades count: a facade IS a room (you
// stand in the doorway), which is why the Reach's shopfronts carry exits of their own.
const isWalkable = (kind) => kind === 'court' || kind === 'country' || kind === 'gateway';

// ── main ─────────────────────────────────────────────────────────────────────
function main() {
  for (const d of ['zones', 'power_zones', 'regions', 'generators', 'airfields',
                   'connections', 'maps', 'furniture', 'doors']) {
    const p = join(ROOT, 'content', d);
    if (!existsSync(p)) mkdirSync(p, { recursive: true });
  }

  // PRUNE FIRST. The old 14x14 build left blocked-connection files named for pairs that no longer
  // exist as walls (the wall column moved, the interior joined up), and a stale `blocked: true`
  // between two tiles that should now be neighbours is a wall with nothing standing in it: it
  // cannot be seen, cannot be examined, and is not in any zone's exits. Deleting the whole
  // generated set and reminting it is the only way to be sure the file tree says what this script
  // says. Hand-authored connections are named differently and are not touched.
  const connDir = join(ROOT, 'content', 'connections');
  let pruned = 0;
  for (const f of readdirSync(connDir)) {
    if (/^conn_terminus_/.test(f) || /^conn_exo_/.test(f)) { unlinkSync(join(connDir, f)); pruned++; }
  }

  const kinds = new Map();
  for (let x = X0; x <= X1; x++) for (let y = Y0; y <= Y1; y++) kinds.set(key(x, y), classify(x, y));

  // ── The tiles ──────────────────────────────────────────────────────────────
  let zones = 0, facades = 0;
  const landCount = {};
  for (let x = X0; x <= X1; x++) {
    for (let y = Y0; y <= Y1; y++) {
      const k = key(x, y), me = id(x, y), kind = kinds.get(k);
      const bld = BUILDINGS[k];

      // PRESERVED TILES. Read what is on disk, replace the exits (the world moved around them) and
      // write the rest back untouched. Regenerating Last Requisition from a table in this file
      // would silently drop its vendor wiring, its depot flags and prose somebody wrote by hand.
      if (PRESERVE.has(k)) {
        const existing = readJson(zonePath(me));
        if (existing) {
          existing.exits = exitsFor(x, y, kinds);
          existing.ambient_events = AMBIENT_APRON;
          write(zonePath(me), existing);
          zones++;
          continue;
        }
      }

      const exits = exitsFor(x, y, kinds);
      const flags = { region_id: REGION };
      let name, description, ambient, theme = 'wasteland';

      if (kind === 'facade') {
        // A BUILDING FOOTPRINT IS NOT GROUND. Painted terrain on a building tile suppresses the
        // tile's map code, so the facade would vanish from the map and the tablet. content:lint
        // catches it; it is written down here because it is easy to re-add by reflex.
        Object.assign(flags, {
          building_name: bld.name, building_type: bld.type, entrance: bld.entrance,
          facade: true, is_building: true, floors: bld.floors,
          world_exit_zone: id(x + STEP[bld.entrance][0], y + STEP[bld.entrance][1]),
        });
        if (inCompound(x, y)) flags.exodus_space = true;
        name = bld.name;
        description = bld.desc;
        ambient = bld.amb.slice(0, 3);
        theme = 'outdoors';
        facades++;
      } else if (kind === 'mass') {
        // building_type ONLY. See the note on MASS above: this is what stops sixty-eight anonymous
        // structures fighting over two-letter map codes.
        flags.building_type = MASS[k];
        flags.exodus_space = true;
        name = MASS[k] === 'greenhouse' ? 'Glasshouse' : 'The Cisterns';
        description = MASS[k] === 'greenhouse'
          ? 'A long glazed vault on a stone knee-wall, ridge lights propped open, the panes every colour glass goes when it has been salvaged one at a time over thirty years.'
          : 'Three tanks on a trestle with a ladder up the side and a gauge glass on each, and the gauge glasses have been read this morning.';
        ambient = [];
        theme = 'outdoors';
      } else if (kind === 'wall') {
        // Same rule as MASS, and the tiles this rule was WRITTEN for. Pass 1 gave thirteen wall
        // tiles a unique `building_name` apiece to dodge the marker collision, which worked and
        // does not scale: this ring is sixty-eight tiles. A boundary is not a landmark. The wall
        // reads on the map as the compound's own outline, which is what a wall should look like.
        flags.building_type = 'ruins';
        flags.exodus_space = true;
        name = 'The Wall';
        description = 'Rammed earth between shuttering, faced with salvaged plate and capped with a walk. Twice the height of a man and going on out of sight both ways. There are no windows in it, and there is no graffiti on it, in a world that has written on absolutely everything else.';
        ambient = [];
        theme = 'outdoors';
      } else if (kind === 'gateway') {
        flags.terrain = 'dirt_road';
        flags.exodus_space = true;
        name = 'The Gate';
        description = 'The gateway itself, a tunnel of dressed stone the depth of the wall, cool for about four paces and then hot again. Two leaves of plate steel stand in it, taller than they need to be and blank as a closed hand. There is no handle on the outside.';
        ambient = [
          'Somebody up on the walk shifts their weight and does not look down.',
          'The leaves of the gate stand a hand apart and go no further.',
          'The dark of the tunnel is about four degrees cooler than the road, and no more.',
        ];
        theme = 'outdoors';
      } else if (kind === 'court') {
        flags.exodus_space = true;
        const proc = isProcessional(x, y), spine = isSpine(x, y), ring = isRing(x, y);
        const plaza = isPlaza(x, y), pad = isPad(x, y);
        flags.terrain = pad ? 'concrete' : (proc || spine || ring || plaza) ? 'gravel' : 'hardpan';
        if (pad) flags.airfield_id = 'terminus_ascension';
        name = pad ? 'The Ascension'
          : plaza ? 'The Standing'
          : proc ? 'The Processional'
          : spine ? 'The Spine'
          : ring ? 'The Wall Walk'
          : pick(['The Swept Ground', 'The Long Yard', 'The Drying Ground', 'The Quiet Side'], x, y);
        description = pad ? PAD_DESC
          : plaza ? 'The open square around the pad, raked gravel, kept clear. There are marks in the ground here where things have been set down and taken up again a great many times, and no marks at all where people walk.'
          : proc ? 'A raked gravel way running dead straight from the gate to the middle of the compound. It is the only straight line in the place and everything else has been arranged either side of it.'
          : spine ? 'A raked way running north and south past the hall, wide enough for four abreast and used by people in ones.'
          : ring ? 'The way round the inside of the wall, close under it, in its shade for most of the day. A stair goes up to the walk every so often and the treads are worn in the middle.'
          : 'Swept hardpan between the buildings, pale and hard and rung flat by feet. There is nothing lying on it. Not a tool, not a rag, not a stone out of place.';
        ambient = AMBIENT_INSIDE;
        theme = 'outdoors';
      } else {
        // Open country. The landform decides.
        const road = inCorridor(x, y) && y === ROAD_Y;
        const land = road ? 'road' : landformAt(x, y);
        landCount[land] = (landCount[land] || 0) + 1;
        flags.terrain = road ? 'dirt_road' : TERRAIN_OF[land];
        name = road ? 'The Road' : pick(TILE_NAMES_COUNTRY, x, y);
        description = road
          ? 'Graded dirt, wide enough for something with a trailer on it, running east toward a wall that from here does not appear to have a way through. Tyre ruts, and the marks where heavy things have been dragged off the road and left.'
          : DESC_COUNTRY[land];
        // The wall is the horizon from anywhere near it, and the glass above it is the hook.
        if (Math.abs(x - PAD_X) < 16 && Math.abs(y - PAD_Y) < 16 && land !== 'mesa') {
          description += ' Off toward the middle of the country there is a wall, and above the wall, catching the light, a long row of glass roofs. Something is growing in there. Not for you.';
        }
        ambient = x < W0 && Math.abs(y - ROAD_Y) <= 3 ? AMBIENT_APRON : AMBIENT_COUNTRY;
        // THE GANTRY, the visitors' pad, out on the apron where visitors go. It keeps its own
        // airfield row and its own name; the pad in the middle of the compound is a different
        // thing for different people, and running the two together is what pass 1 did.
        if (x === 1203 && y === 943) {
          flags.airfield_id = 'terminus_gantry';
          name = 'The Gantry';
          description = 'A circle of hard standing scraped flat and edged with painted drums, well off the road and a good way from the wall. A windsock on a pole, a fuel bowser under a tarpaulin, and nothing else at all. It is maintained, and it is maintained by somebody who does not come out here except to maintain it.';
        }
      }

      // PRESERVE THE MARKER. A building tile ships with the two-letter map code it will derive, and
      // that code can only be chosen by something that sees every building in the world at once
      // (assignBuildingMarkers), which this script cannot. So the codes are baked in after the
      // first derive (see the header) and carried forward here. Without this line a rebuild
      // silently strips them and the map loses every landmark in the region again.
      //
      // AND ONLY FOR A TILE THAT IS STILL A BUILDING. The redraw demoted sixty-eight named wall
      // tiles and four glasshouses to anonymous mass, and carrying their old codes forward kept
      // twenty dead markers alive in content: tiles with no `building_name` to derive one from,
      // still shipping T2..T9 and G1..G5, one of which then collided with a code the new gate
      // legitimately derived. A stale marker is worse than a missing one, because the map draws it.
      const marker = kind === 'facade' ? (readJson(zonePath(me))?.marker ?? null) : null;

      write(zonePath(me), {
        ambient_events: ambient, ambient_theme: theme, description, exits, flags,
        grid_x: x, grid_y: y, grid_z: 0, id: me, map_id: 'map_world',
        ...(marker ? { marker } : {}),
        name, parent_zone: null,
      });
      write(powerPath(me), {
        capacity_kw: 10000, flags: {}, generator_id: 'gen_region_region_terminus',
        id: me, max_capacity_kw: 1000, name, source_type: 'city_grid',
      });
      zones++;
    }
  }

  // ── The interiors ──────────────────────────────────────────────────────────
  let interiors = 0;
  for (const [k, b] of Object.entries(BUILDINGS)) {
    const [bx, by] = k.split('_').map(Number);
    if (b.preserve) {
      // The room itself is already built and better than anything this table could say. What it
      // still needs is its SEAM, because the prune above deletes every generated connection in the
      // region and this one lives in that namespace: without reminting it, the only door into Last
      // Requisition's shed disappears on every rebuild, silently, while the shed itself stays
      // perfect. Keeping the original id means nothing that ever referenced it has to be found.
      writeConn(b.seamId, id(bx, by), b.interiorId, OPP[b.entrance], { lockable: true });
      continue;
    }
    interiors += writeInterior(bx, by, b);
  }
  // The Stillhouse's back room. It is a second interior on one building rather than a building of
  // its own, because the DOOR is the content: you are brought into the front room, something is
  // taken out of you there, and the plain door at the back does not open. One day it does. That is
  // the induction beat the psi lock type was built for, and it wants to be met early and by
  // everyone, which means it belongs in the room a newcomer is already taken to.
  writeStillwell();

  // ── The doors ──────────────────────────────────────────────────────────────
  //
  // Three, and each one is a rule rather than a lock.
  let doors = 0;
  // 1. THE GATE. The outer door, and the only thing in the region that reads the admission rule.
  //    Its lock family is registered in plugins/psionics/door.js beside the psi one.
  doors += writeDoor({
    connId: 'conn_terminus_gate', a: id(GATE_X - 1, GATE_Y), b: id(GATE_X, GATE_Y), dir: 'east',
    doorId: 'door_terminus_gate', name: 'the gate', doorType: 'reinforced', hp: 4000,
    lock: ['lock:terminusgate', {
      canHack: false,
      messages: {
        denied: 'The gate does not open.',
        lock: 'The leaves come together without a sound and stand as though they had never been apart.',
        unlock: 'The gate opens. Nobody touches it.',
      },
    }],
  });
  // 2. THE HALL. Awakened only. An initiate who has been let through the gate still cannot sit in
  //    the assembly, and nobody will explain why, because the door itself is the explanation.
  //    It hangs on the seam connection writeInterior already minted rather than a second one:
  //    two connections on one seam is two lock states, two hp pools and two tag sets on one door,
  //    which is "open in look and locked on move" waiting to happen.
  doors += writeDoor({
    connId: 'conn_exo_waking_in', a: id(1220, 938), b: 'zone_exo_waking', dir: 'north',
    doorId: 'door_exo_waking', name: 'the hall door', doorType: 'reinforced', hp: 3000,
    lock: ['lock:psi', {}],
  });
  // 3. THE STILLWELL. The first psi door anybody meets, and the reason it is here rather than on
  //    the Stillhouse's own front door: the purifier chair is in the FRONT room. Lock the front
  //    door against the unawakened and an initiate can never reach the machine that awakens them.
  //    A gate in front of its own key is the commonest way a chain like this dies.
  doors += writeDoor({
    connId: 'conn_exo_stillwell_in', a: 'zone_exo_stillhouse', b: 'zone_exo_stillwell', dir: 'east',
    doorId: 'door_exo_stillwell', name: 'the plain door', doorType: 'reinforced', hp: 3000,
    lock: ['lock:psi', {}],
  });

  // ── The walls the geometry cannot un-say ───────────────────────────────────
  //
  // `derive.mjs` projects an edge between any two orthogonally adjacent tiles on the same map and
  // then subtracts the facade rule ("a facade opens at flags.entrance and nowhere else").
  // Everything this region deliberately does NOT connect — into the wall, into a building's mass,
  // from the country into the compound — has to be declared, or the derive pass invents the exit
  // and quietly demolishes the wall the whole district is about.
  //
  // One file per PAIR, deterministically named so a re-run overwrites rather than accumulates.
  let walls = 0;
  for (let x = X0; x <= X1; x++) {
    for (let y = Y0; y <= Y1; y++) {
      for (const dir of ['east', 'south']) {                    // each pair visited once
        const [dx, dy] = STEP[dir];
        const nx = x + dx, ny = y + dy;
        if (nx > X1 || ny > Y1) continue;
        const a = id(x, y), b = id(nx, ny);
        const linked = readJson(zonePath(a))?.exits?.[dir] === b;
        if (linked) continue;
        // A FACADE ALREADY BLOCKS ITS OWN SIDES, and a wall in front of a wall is a file whose
        // reason has been edited away. derive's one geometric rule is `facadeBlocks(z, dir) =
        // facade && entrance !== dir`, so it never projects an edge into a facade except at its
        // door: writing a blocked connection there walls something geometry was never going to
        // build, and regress fails the build for it by name.
        if (facadeBlocks(a, dir) || facadeBlocks(b, OPP[dir])) continue;
        const cid = `conn_terminus_${x}_${y}_${dir}`;
        write(join(connDir, `${cid}.json`),
          { a, b, blocked: true, dir, id: cid, lockable: false, one_way: false });
        walls++;
      }
    }
  }

  // ── The region, the plant and the two pads ─────────────────────────────────
  write(join(ROOT, 'content', 'regions', `${REGION}.json`), {
    // Hot, dry, and NOT acid. The Scarletwastes added the per-region `acid` bias for a region that
    // is corrosive most of the time; Terminus is merely a desert, so it takes the two keys it
    // actually means and leaves acid unset rather than writing a zero. An authored zero is a
    // decision somebody has to re-derive later; an absent key is the default.
    base_terrain: 'redrock', climate_bias: { dryness: 0.88, temp: 9 }, defaults: {}, grid_z: 0,
    id: REGION, name: 'Terminus',
  });
  // THE PLANT MOVED INSIDE THE WALL, and that is the joke the whole apron is built on. The Exodus
  // renounce the machine and keep exactly one, in a shed, spotless, with an eleven-year log on the
  // wall; and the trading post outside the gate, the diesel pump and the lamps in Last Requisition
  // all run off it. They power the thing they disapprove of, and they never once mention it.
  write(join(ROOT, 'content', 'generators', 'gen_region_region_terminus.json'), {
    capacity_kw: 10000, city_generator_id: null, connection_range: 0, flags: {},
    fuel_burn_rate: 0, fuel_remaining: 0, fuel_type: null, generator_type: 'city_plant',
    id: 'gen_region_region_terminus', name: 'The Standing Charge', owner_id: null,
    zone_id: 'zone_exo_charge',
  });
  // TWO PADS, and the split is the design.
  //
  // The Gantry stays out on the apron: it is where a visitor with a Dragonfly puts down, and it is
  // the reason a trucker who drove 1,170 tiles is not stranded. It was always the visitors' pad;
  // pass 1 just had nowhere else to put one.
  write(join(ROOT, 'content', 'airfields', 'terminus_gantry.json'), {
    charter: false, charter_vtol_only: true, dealer: false, fuels: ['biofuel'],
    id: 'terminus_gantry', lawless: true, name: 'The Gantry', rental: false,
    residents_only: null, surface: 'dust', theme: 'wastes', vtol_only: true,
  });
  // The Ascension is the middle of the temple. `vtol_only` is the whole point: the circle-H pad
  // renders instead of a strip and anything with a wing cannot use it, because they were never
  // building for aeroplanes.
  //
  // Yes, you can land on it without being let through the gate, and that is deliberate rather than
  // a hole. The wall is a rule about the ROAD. What stops a stranger walking off the pad into the
  // hall is the hall's own door, which does not open, and no one will tell them why.
  write(join(ROOT, 'content', 'airfields', 'terminus_ascension.json'), {
    charter: false, charter_vtol_only: true, dealer: false, fuels: ['biofuel'],
    id: 'terminus_ascension', lawless: false, name: 'The Ascension', rental: false,
    residents_only: null, surface: 'concrete', theme: 'wastes', vtol_only: true,
  });

  // ── Reachability, asserted rather than hoped for ───────────────────────────
  //
  // `cliff` is the only impassable terrain in the game and it is placed by a noise field that has
  // never heard of the road. This walks the region the way a player does and fails the build if the
  // gate cannot be reached from the tile the void drops you on. A region you cannot get into does
  // not throw, does not warn and looks perfect in every file.
  const reach = reachable(id(X0, ROAD_Y));
  const problems = [];
  if (!reach.has(id(GATE_X, GATE_Y))) problems.push('the gate is not reachable from the arrival tile');
  if (!reach.has('zone_terminus_' + PAD_X + '_' + PAD_Y)) problems.push('the pad is not reachable from the arrival tile');
  let stranded = 0;
  for (let x = I0; x <= I1; x++) for (let y = J0; y <= J1; y++) {
    if (kinds.get(key(x, y)) === 'court' && !reach.has(id(x, y))) stranded++;
  }
  if (stranded) problems.push(`${stranded} tile(s) inside the wall are stranded`);

  console.log(`terminus: ${zones} zones, ${facades} facades, ${interiors + 1} interiors, ${doors} doors`);
  console.log(`  region  x${X0}-${X1} y${Y0}-${Y1}  (${(X1 - X0 + 1) * (Y1 - Y0 + 1)} tiles)`);
  console.log(`  wall    x${W0}-${W1} y${V0}-${V1}  ring, one gate at (${GATE_X},${GATE_Y})`);
  console.log(`  pad     (${PAD_X},${PAD_Y})  The Ascension, vtol only`);
  console.log(`  walls   ${walls} blocked connection file(s), ${pruned} pruned first`);
  console.log('  ground  ' + Object.entries(landCount).sort((a, b) => b[1] - a[1])
    .map(([k2, v]) => `${k2} ${v}`).join('  '));
  if (problems.length) {
    for (const p of problems) console.error(`  !! ${p}`);
    process.exit(1);
  }
  console.log('  reach   ok (gate, pad and every courtyard tile walkable from the arrival tile)');
}

// The same predicate derive.mjs uses, spelled the same way on purpose: a facade opens at
// `flags.entrance` and nowhere else. Two copies of a geometric rule that disagree is how a wall
// ends up in a file and not in the world.
const facadeBlocks = (zid, dir) => {
  const f = readJson(zonePath(zid))?.flags;
  return !!f?.facade && f.entrance !== dir;
};

// Orthogonal exits for one tile, derived from the tile kinds rather than re-tested here.
function exitsFor(x, y, kinds) {
  const k = key(x, y), kind = kinds.get(k);
  if (kind === 'wall' || kind === 'mass') return {};
  if (kind === 'facade') {
    const b = BUILDINGS[k];
    const [sx, sy] = STEP[b.entrance];
    // The street in the entrance direction, the interior behind it. Getting these two the wrong way
    // round puts the door in the back wall and the room inside the rock.
    return { [b.entrance]: id(x + sx, y + sy), [OPP[b.entrance]]: b.interiorId || `zone_exo_${b.slug}` };
  }
  const out = {};
  for (const dir of ['north', 'south', 'east', 'west']) {
    const [dx, dy] = STEP[dir];
    const nx = x + dx, ny = y + dy;
    if (!inBox(nx, ny)) continue;
    const nk = kinds.get(key(nx, ny));
    if (isWalkable(nk)) { out[dir] = id(nx, ny); continue; }
    // A facade is enterable from its street tile and from nowhere else. That single rule is what
    // stops a building being a hole in a wall on three sides.
    if (nk === 'facade') {
      const nb = BUILDINGS[key(nx, ny)];
      const [ex, ey] = STEP[nb.entrance];
      if (nx + ex === x && ny + ey === y) out[dir] = id(nx, ny);
    }
  }
  return out;
}

// Flood fill over what a body can actually walk, which is not the same as what has exits: `cliff`
// is refused by the engine's own move gate (engine:impassable-terrain), so a cliff tile with four
// exits is still a wall.
function reachable(startId) {
  const seen = new Set([startId]);
  const queue = [startId];
  const passable = (zid) => {
    const z = readJson(zonePath(zid));
    if (!z) return false;
    return z.flags?.terrain !== 'cliff';
  };
  if (!passable(startId)) return seen;
  while (queue.length) {
    const cur = queue.shift();
    const z = readJson(zonePath(cur));
    for (const dest of Object.values(z?.exits || {})) {
      if (seen.has(dest) || !/^zone_terminus_/.test(dest)) continue;
      if (!passable(dest)) continue;
      seen.add(dest); queue.push(dest);
    }
  }
  return seen;
}

const PAD_DESC = 'A circle of poured concrete a hundred feet across, swept, with a ring of low bollards round it and a painted mark at the centre that has been repainted so many times it stands proud of the surface.\n\nAt the four points of it stand four masts of welded lattice, each one twice the height of the hall, and between them, on gantries, the beginnings of something. It has been the beginnings of something for a very long time. The welds nearest the ground have been ground back and redone in a better hand than the ones at the top.\n\nNobody is working on it today. The tools are laid out at the foot of the north mast in the order they would be used.';

// One interior, plus its utility room, its map, its junction box, its lights, and the power rows
// for both. Every building in the compound gets the same treatment, which is why it is a function:
// a new interior that ships without power ships dark, and that has happened here before.
function writeInterior(bx, by, b) {
  const facade = id(bx, by);
  const zid = `zone_exo_${b.slug}`;
  const util = `zone_util_${zid}`;
  const mapId = `map_int_exo_${b.slug}`;
  const genId = `gen_${util}`;
  const flags = {
    building_name: b.name, building_type: b.type, floor: b.floor,
    exodus_space: true, is_building: true, is_interior: true,
    region_id: REGION, world_exit_zone: facade,
  };

  const exits = { [b.entrance]: facade, down: util };
  if (b.slug === 'stillhouse') exits.east = 'zone_exo_stillwell';

  write(zonePath(zid), {
    ambient_events: b.amb, ambient_theme: 'indoors', description: b.interior,
    exits, flags, grid_x: 0, grid_y: 0, grid_z: 0, id: zid, map_id: mapId,
    name: b.room, parent_zone: facade,
  });
  write(zonePath(util), {
    ambient_events: [], ambient_theme: 'indoors',
    description: 'A cramped below-grade utility room: bare stone, a floor drain, and the building junction box in its steel cabinet. Even down here somebody has swept.',
    exits: { up: zid },
    flags: { exodus_space: true, floor: 'concrete', is_interior: true, region_id: REGION, world_exit_zone: facade },
    grid_x: 0, grid_y: 0, grid_z: -1, id: util, map_id: mapId,
    name: `${b.room} — Utility Room`, parent_zone: facade,
  });
  write(join(ROOT, 'content', 'maps', `${mapId}.json`), {
    entry_zone_id: zid, id: mapId, name: b.name, parent_zone_id: facade,
  });
  write(join(ROOT, 'content', 'generators', `${genId}.json`), {
    capacity_kw: 5000, city_generator_id: 'gen_region_region_terminus', connection_range: 0,
    flags: {}, fuel_burn_rate: 0, fuel_remaining: 0, fuel_type: null,
    generator_type: 'junction_box', id: genId, name: `${b.name} — Utility Room Junction Box`,
    owner_id: null, zone_id: util,
  });
  for (const [rowId, rowName] of [[zid, b.room], [util, `${b.room} — Utility Room`]]) {
    write(powerPath(rowId), {
      capacity_kw: 1000, flags: {}, generator_id: genId,
      id: rowId, max_capacity_kw: 1000, name: rowName, source_type: 'junction_box',
    });
  }
  write(join(ROOT, 'content', 'furniture', `furn_jbox_${util}.json`), {
    description: 'A grey steel box with a lever on the side of it. The feed comes off the plant in the south corner, and somebody has written the load on the door in pencil and rubbed it out and written it again.',
    flags: { destructible: true, generator_id: genId },
    hp: 1200, hp_max: 1200, id: `furn_jbox_${util}`, light_type: 'lamp', lumen_output: null,
    name: 'junction box', object_type: 'junction_box', power_draw_kw: 0, price: 0, zone_id: util,
  });
  write(join(ROOT, 'content', 'furniture', `furn_light_${zid}.json`), {
    description: b.light[1], flags: {}, hp: null, hp_max: null,
    id: `furn_light_${zid}`, light_type: 'overhead', lumen_output: 1200,
    name: b.light[0], object_type: 'light', power_draw_kw: 0.04, price: 0, zone_id: zid,
  });

  // AN INTERIOR IS OFF THE GRID. `grid_x`/`grid_y` are 0 on every one of them, so `projectEdges`
  // has no adjacency to project and an interior seam that is not ALSO written down as a connection
  // file is an exit the derive pass simply drops. The zone's own `exits` are not enough and never
  // were; content:lint says so in as many words ("authored in zones.exits but nothing projects
  // it"). Three per building: the door, and the two halves of the stair to the utility room, which
  // are one-way files in a matched pair exactly as the rest of the world's utility rooms are.
  writeConn(`conn_exo_${b.slug}_in`, facade, zid, OPP[b.entrance], { lockable: true });
  writeConn(`conn_exo_${b.slug}_down`, zid, util, 'down', { one_way: true });
  writeConn(`conn_exo_${b.slug}_up`, util, zid, 'up', { one_way: true });
  return 1;
}

// One connection file. `lockable` is what a door can later be hung on; `one_way` is a CHOICE the
// file has to state, because an edge that projects one way with nothing saying so is a warp
// somebody has to come and explain later (derive calls those undeclared one-ways and reports them).
function writeConn(cid, a, b, dir, { lockable = false, one_way = false } = {}) {
  write(join(ROOT, 'content', 'connections', `${cid}.json`),
    { a, b, blocked: false, dir, id: cid, lockable, one_way });
  return cid;
}

// The back room of the Stillhouse. It hangs off another interior rather than off a facade of its
// own, so it borrows that building's map and utility room instead of minting a second set.
function writeStillwell() {
  const zid = 'zone_exo_stillwell';
  write(zonePath(zid), {
    ambient_events: [
      'The water moves. Nothing has touched it.',
      'The room is quiet in a way that has nothing to do with sound.',
      'A ring goes out across the basin, reaches the stone, and comes back.',
      'You become aware that you have been standing still for longer than you meant to.',
    ],
    ambient_theme: 'indoors',
    description: 'A room with nothing in it but a basin sunk into the floor, four feet across, cut from one piece of stone and filled to the brim with water. The water is absolutely still. The walls are bare and the ceiling is low and there is no lamp.\n\nThere are marks on the floor around the basin where people have stood, worn into the stone, and there are eleven of them, and they are not evenly spaced.',
    exits: { west: 'zone_exo_stillhouse' },
    flags: {
      building_name: 'The Stillhouse', building_type: 'clinic', exodus_space: true,
      floor: 'stone', is_building: true, is_interior: true, region_id: REGION,
      world_exit_zone: id(1216, 941),
    },
    grid_x: 0, grid_y: 0, grid_z: 0, id: zid, map_id: 'map_int_exo_stillhouse',
    name: 'The Stillwell', parent_zone: id(1216, 941),
  });
  write(powerPath(zid), {
    capacity_kw: 1000, flags: {}, generator_id: 'gen_zone_util_zone_exo_stillhouse',
    id: zid, max_capacity_kw: 1000, name: 'The Stillwell', source_type: 'junction_box',
  });
  // No light fixture, deliberately. There is no lamp in the room and there is no switch for one:
  // the only reason to build a windowless room with no light in it is that the people who use it
  // do not need one, and that is a sentence the room says without anybody in it saying anything.
  //
  // The seam is minted by writeDoor below, because this one has a door on it.
}

// A door plus the connection it stands on. A door identified by (zone, direction) is a coordinate,
// which is the failure the connection ids exist to stop (see scripts/content/anchor-doors.mjs), so
// the connection is written here alongside it and the door names it.
function writeDoor({ connId, a, b, dir, doorId, name, doorType, hp, lock }) {
  write(join(ROOT, 'content', 'connections', `${connId}.json`),
    { a, b, blocked: false, dir, id: connId, lockable: true, one_way: false });
  const [tag, cfg] = lock;
  write(join(ROOT, 'content', 'doors', `${doorId}.json`), {
    connection_id: connId, door_type: doorType, exit_dir: dir, flags: {},
    hololock_difficulty: 0, hp, hp_max: hp, id: doorId, is_locked: 1, is_open: 0,
    lock_state: 'locked', name,
    // UNBREAKABLE, for the same reason the Long Watch blast door is: there is no mechanism in
    // either of these to attack. A door you can bash is a door the answer to which is a crowbar,
    // and the answer to both of these is supposed to be a decision about who you are.
    tags: { [tag]: cfg, unbreakable: true },
    target_zone: b, zone_id: a,
  });
  return 1;
}

main();
