// Build THE SCARLETWASTES — the badlands region southeast of Coldwater, and the Wildblood's town.
//
// A one-shot content generator. It writes files under `content/` and touches no database: git is the
// source of truth, so this emits the tree and `npm run content:import` loads it. Re-runnable — it
// overwrites its own output and nothing else.
//
// See docs/proposals/scarletwastes.md for the design. Two things this file is built around:
//
// 1. THE GROUND IS UNIFORM ON PURPOSE. Every tile outside the town is `redrock` and nothing else.
//    That is not laziness, it is the brief: the region ships as one flat canvas so it can be painted
//    by hand in the Studio afterwards. Do not "improve" it by scattering terrain here. Paint it.
//
// 2. THE TOWN IS THE POINT. The Wildblood have never had a home; they have had three squatters in a
//    Coldwater tenement and four empty zone shells. This builds The Thornwarren as a walled town,
//    and the whole of its authoring follows ONE rule:
//
//       THE TERROR IS ON THE APPROACH. THE INSIDE IS DOMESTIC, AND NOTHING EVER REMARKS ON IT.
//
//    The trophy road north of the gate is a performance, and the tell is that it is MAINTAINED.
//    Inside the wall it is laundry, school slates, stew and a water committee. No line of prose in
//    here says the Wildblood are not monsters, no NPC will ever say it, and no quest may ever reward
//    a player for working it out. The player is allowed to keep their first impression forever. That
//    it does not survive contact with a bathhouse is the entire design.
//
// NO EM DASHES in any player-facing prose in this file. That punctuation is a voice tell reserved
// for the Ascendants and the Architect, and this is the last place in the world it belongs.
//
// LAYOUT (93x52, x 1000-1092, y 950-1001 — the same box size as Coldwater). You arrive from the
// NORTHWEST, off Coldwater's southeast rim, by air at the strip or overland to the roadhead.
//
//     roadhead (1024,957)   strip (1030,960)
//              \                /
//               .    THE OPEN WASTE (redrock, acid rain, rising rads)
//                    |
//                    v  the trophy road, y963-967
//              +-----------+
//              | THORNWARREN|  x1038-1054, y968-984, walled, two gates
//              +-----------+
//                            .  the Quickening Pool (outside, deliberately)
//
// FIRST RUN, in order — the middle step exists because a building's two-letter map code can only be
// chosen by something that sees every building in the world at once, which this script cannot:
//
//   node scripts/build-scarletwastes.mjs
//   npm run content:import && npm run map:derive
//   npm run content:export          ← carries the derived codes back into content
//   npm run content:import
//
// After that, re-running this script is safe: it carries any existing `marker` forward.

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const REGION = 'region_scarletwastes';
const X0 = 1000, X1 = 1092, Y0 = 950, Y1 = 1001;

// ── The town box ─────────────────────────────────────────────────────────────
// The wall is the PERIMETER of this box. Everything strictly inside is town.
const TX0 = 1038, TX1 = 1054, TY0 = 968, TY1 = 984;
const CX = 1046, CY = 976;                 // the Commons, dead centre
const NORTH_GATE = [1046, 968];
const SOUTH_GATE = [1046, 984];
const inTown = (x, y) => x >= TX0 && x <= TX1 && y >= TY0 && y <= TY1;
const onWall = (x, y) => inTown(x, y) && (x === TX0 || x === TX1 || y === TY0 || y === TY1);
const inside = (x, y) => inTown(x, y) && !onWall(x, y);

// The Quickening Pool sits OUTSIDE the wall. You go out to it, deliberately, which is the only way
// a rite reads as a choice. A town that irradiates its own children is not the town this is.
const POOL = [1057, 988];

const id = (x, y) => `zone_scw_${x}_${y}`;
const zonePath = (i) => join(ROOT, 'content', 'zones', `${i}.json`);
const powerPath = (i) => join(ROOT, 'content', 'power_zones', `${i}.json`);

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
const dist = (x, y, [px, py]) => Math.hypot(x - px, y - py);
const pick = (arr, x, y) => arr[Math.abs(x * 31 + y * 17) % arr.length];

// ── RADIATION ────────────────────────────────────────────────────────────────
// A gradient, not a number. It rises toward the Pool, which is the region's hot heart and the reason
// the Wildblood are here at all. It reads as CAUSE and is never offered as EXPLANATION: no
// description in this file connects the rads to how anybody looks.
//
// The town is the deliberate hole in the curve. Inside the wall the rads drop, because these people
// swept, sealed and drained the ground they intended to raise children on. That dip is an argument
// made in integers, and it is the only place the argument is made at all.
function radAt(x, y) {
  if (inside(x, y)) return 12;                       // swept ground. lower than the waste outside.
  if (onWall(x, y)) return 20;
  const d = dist(x, y, POOL);
  if (d <= 1) return 70;                             // lethal set-piece
  return Math.max(9, Math.round(58 - (d - 1) * 1.7));
}

// ── AMBIENT: the open waste ──────────────────────────────────────────────────
// Red rock, acid weather, and things growing that have no business growing. The last beat is the
// region's whole argument in one line, and it never says who it is about.
const AMBIENT_WASTE = [
  'The wind comes across the flats carrying grit and a faint sharp smell, like a struck match held too long.',
  'Rain marks on the rock, thousands of them, each one a pale ring eaten a hair deep.',
  'A long way off, weather is walking. It is the wrong colour for weather.',
  'Something small goes over your boot and is gone into a crack before you can name it.',
  'The rock ticks as it cools. It goes on doing it after you stop walking.',
  'Bones, bleached and scattered, and none of them arranged in any way that means anything.',
  'A drum of standing water, lid long gone, the surface skinned over and still.',
  'Scrub has come up through a seam in the hardpan and made a fist of itself there.',
  'Old wreckage, stripped to the frame, every panel worth carrying already carried away.',
  'The light goes flat and red and every stone throws a shadow twice its length.',
  'Something is growing out of a crack in the rock that should not be able to. It is doing well.',
];

// ── AMBIENT: the trophy road ─────────────────────────────────────────────────
// The fear band. Every beat is theatre, and two of them quietly admit it: the props are REPAIRED,
// and the hounds are under command. A player who notices has been told everything. Most will not.
const AMBIENT_ROAD = [
  'The wind goes through something hollow up ahead and comes out the far side as a note.',
  'A skull on a pole, and under the jaw, a neat loop of fresh wire where the old wire failed.',
  'Dogs, somewhere off the road, keeping pace and not closing.',
  'Something has been staked out flat on the rock and left to the weather. It was a drone.',
  'The smell arrives before the next stake does.',
  'Rags on a line of poles, all of them acid-eaten to lace, all of them hung deliberately.',
  'A hound walks out onto the road, looks at you, and goes back off it without hurrying.',
  'Bones threaded on wire, swinging, each one drilled through the same way by the same hand.',
  'Somebody has painted the rock. You decide not to work out what with.',
];

// ── AMBIENT: inside the wall ─────────────────────────────────────────────────
// The flip. Domestic, unhurried, entirely uninterested in you. NOT ONE of these acknowledges the
// road you just walked, apologises for it, or explains it. That silence is the whole trick.
const AMBIENT_TOWN = [
  'Somebody two roofs over is having an argument about a bucket, and losing it.',
  'Woodsmoke, and under it, onions.',
  'Washing on a line, pegged out in order of size.',
  'A child runs past on an errand, entirely uninterested in you.',
  'A door opens, a bowl of grey water goes out into a channel, the door shuts.',
  'Someone is singing badly and not stopping.',
  'Two women go by carrying a rolled mat between them, arguing amiably about whose it is.',
  'A dog asleep in the shade of a water drum, legs going, dreaming.',
  'Chalk on a wall at knee height. A hand, traced round, and a smaller one inside it.',
  'Somebody laughs, a proper one, from the bottom of the chest, and it sets off two more.',
  'A very old man is asleep in a chair in the sun with a cat on him.',
  'The bell on the cistern gate goes twice. Nobody hurries, but everybody turns.',
];

const TILE_NAMES = [
  'The Long Red', 'Scald Pan', 'The Standing Heat', 'Rustwater',
  'The Bare Mile', 'Cinder Bench', 'The Slow Burn', 'Hardpan',
  'The Weeping Rock', 'Ash Flats', 'The Quiet Red', 'Broken Country',
];

// ── The wall ─────────────────────────────────────────────────────────────────
// GROWN, NOT BUILT, and that is the single most important sentence in this file.
//
// The Architect's Curtain is a sheet of hard light: absolute, sterile, and it does exactly what it
// was told to do forever. The Wildblood wall is a hedge. It is thorn, cultivated for years into
// salvage lattice, and where you cut it, it closes. Two peoples' entire philosophies stated as
// masonry, and neither of them has to say a word about it.
//
// It is building MASS (building_type gates solidity in groundObstructionAt — without it a vehicle
// drives straight through, because exits stop walkers and nothing else). `building_name` must be
// UNIQUE per tile: thirteen Terminus tiles called "The Wall" exhausted the marker namespace and
// produced WA six times over. So each tile carries a unique building_name while the player-facing
// `name` stays "The Thorn Wall".
const WALL_DESC = 'Thorn, grown thick as a man is broad and twice his height, trained for years through a lattice of salvage plate and rail. The stems are finger-thick and grey and set with spines the length of your hand. Where somebody has cut into it at some point the cut has closed over, knotted and ugly and entirely shut. Nothing about it was manufactured. All of it was decided.';

// ── The town, hand-authored ──────────────────────────────────────────────────
// Roughly thirty landmark tiles. Everything else inside the wall is quarter fill (below).
//
// The load-bearing entries are the mundane ones. The mask rack at the gate is the whole thesis in
// one examinable object: the horror is a costume, and the costume is PADDED, because somebody has
// to wear it for eight hours.
const TOWN = {
  [`${NORTH_GATE[0]}_${NORTH_GATE[1]}`]: {
    name: 'The North Gate', gate: true,
    desc: 'The thorn parts at a frame of welded rail, and the gap is filled by two leaves of plate hung on truck springs. They stand open. A rack beside them holds the masks: bone, horn, welded plate, one of them a drone\'s faceplate turned inside out, and every single one lined with quilted rag and stitched down at the edges so it will not chafe on a long shift. A tally board hangs under the rack with names against hours in four different hands. Past the gate there is washing on a line.',
  },
  [`${SOUTH_GATE[0]}_${SOUTH_GATE[1]}`]: {
    name: 'The Sally Gate', gate: true,
    desc: 'A smaller gap in the thorn, one leaf, barred from the inside with a length of axle. A worn track runs south from it toward country nobody has bothered to name. Somebody has wedged a child\'s boot in the frame at head height, laces knotted, which is either a warning or a joke and is very obviously the second one.',
  },
  [`${CX}_${CY}`]: {
    name: 'The Commons', hub: true,
    desc: 'The middle of the town: a swept oval of packed ground with a long fire trench down the centre of it and cook pots on chains over the coals. Benches, most of them mended. A board on a post carries the week in chalk, and the week is water duty, roof duty, gate duty and, in a different hand and underlined twice, WHOEVER IS TAKING THE GOOD KNIFE PUT IT BACK. People come through constantly on their way to somewhere else. Almost nobody looks at you for longer than it takes to decide you are not carrying anything heavy.',
  },
  [`${CX}_${CY - 1}`]: {
    name: 'The Sweetwater', landmark: true,
    desc: 'The reason the town is here, and the best-made thing for sixty miles. Rain comes off every roof in the Thornwarren down channelled gutters into a stepped run of settling tanks, through three beds of crushed limestone and burnt bone, and comes out the far end into a covered cistern sweet enough to drink. The stonework is old and the ironwork is not, and both are immaculate. A test bench by the outflow holds a rack of little glass tubes and a chart, and the chart has been filled in twice a day, in different hands, for a very long time.',
  },
  [`${CX - 1}_${CY - 1}`]: {
    name: 'The Bathhouse',
    desc: 'A long low shed of plate and hide with a slate roof pitched steep, steam going up out of a vent at one end and a queue of people at the other, waiting with rolled towels and complete patience. Inside, water runs. The smell that comes out of the door is soap, and it is the least likely smell in the region.',
  },
  [`${CX + 1}_${CY - 1}`]: {
    name: 'The Roofwalk',
    desc: 'A run of duckboard along the backs of the dwellings at gutter height, put there so the roof crews can work the channels without going through anybody\'s house. Every roof in sight is pitched at the same steep shed angle and every one drains into the same run of tin. Catchment drums stand under each downpipe, lidded, numbered, and chained to the wall so nobody borrows one.',
  },
  [`${CX - 1}_${CY}`]: {
    name: 'Rindle\'s',
    desc: 'A trader\'s lean-to grown outward over the years into most of a shop: a plate awning, a counter made from a truck bed, and shelves back into the shade holding salvage, cured meat, wire, rad-meds, seed, and boots in every size arranged smallest to largest. A hand-lettered card by the till reads NO CREDIT, and under it, in the same hand, EXCEPT FOR YOU, KESH, and under that a list of eleven other names.',
  },
  [`${CX + 1}_${CY}`]: {
    name: 'The Physic',
    desc: 'A clean tent over a boarded floor, with the sides rolled up in the heat. Two cots, both made. A cabinet of instruments laid out in order on a folded cloth, a hand-drawn chart of the body pinned to the centre post with a great many annotations, and a bucket of soapy water by the entrance that gets changed while you are standing there. Somebody in here is having a splinter taken out and is being extremely brave about it, out loud, at length.',
  },
  [`${CX}_${CY + 1}`]: {
    name: 'The Chorus\' Den',
    desc: 'A round shelter of hide over bent rail, set a little apart, with the door mat beaten and the step swept. This is where the elder holds court, which in practice means this is where arguments about water rota come to die. There are cushions. There are a great many cushions.',
  },
  [`${CX - 1}_${CY + 1}`]: {
    name: 'The Schoolrock',
    desc: 'A flat shelf of red stone under a stretched sail, ringed by upturned crates. Slates stacked in a crate at one end, chalk in a tin. The rock itself is covered in workings: sums, a map of the region that gets the Pool badly wrong, somebody\'s name written out forty times getting steadily better, and a hopscotch grid that goes up to fourteen.',
  },
  [`${CX + 1}_${CY + 1}`]: {
    name: 'The Kiln',
    desc: 'A barrel kiln and a bread oven sharing one chimney and one very territorial old woman. Racks of drying pots, most of them water jars, all of them the same shape because that shape fits the catchment drums. The bread comes out at the same hour every day and the queue knows the hour.',
  },
  [`${CX - 2}_${CY}`]: {
    name: 'The Washline',
    desc: 'A yard of criss-crossed line under a rigged canopy, because you do not dry washing under open sky here and everybody knows why. Sheets, work rags, small clothes, a great many socks. Two people are taking a sheet down between them in the practised way of people who have done it ten thousand times, and are talking about somebody else entirely.',
  },
  [`${CX + 2}_${CY}`]: {
    name: 'The Foundry',
    desc: 'An open-sided works of salvaged plate where the region\'s scrap comes to be argued with: a drop hammer, a bank of gas bottles, a bath of quench oil with a skin on it. Everything made here is made to be mended, and you can tell, because half of what is stacked by the door has been mended already.',
  },
  [`${CX}_${CY - 2}`]: {
    name: 'The Netting',
    desc: 'Rows of growing beds under a low canopy of fine mesh and stretched plastic, the whole run of it sloped to shed rain off to the side rather than through. Beans up strings. Something leafy in flats. It is not much and it is fiercely defended: a hand-painted board at the row end reads THIS IS NOT A SHORTCUT.',
  },
  [`${CX}_${CY + 2}`]: {
    name: 'The Tended Ground',
    desc: 'The burial ground, walled off with a knee-high course of dry stone and planted over with the same thorn as the wall, kept low. The markers are salvage plate with names punched through so the light comes past. Somebody has been at the weeds recently. There is a jar of water on one of the newer ones, and the jar is full.',
  },
  [`${CX + 2}_${CY - 2}`]: {
    name: 'The Houndyard',
    desc: 'A run of wire and shade cloth with a dozen hounds in it, long-legged and scarred and heavy in the shoulder. They come up to the wire to look at you, all of them at once and in silence, which is much worse than barking. A woman inside the run is going down the line with a bucket and a rag, doing ears, and every one of them sits for her.',
  },
  [`${CX - 2}_${CY + 2}`]: {
    name: 'The Thorn Walk',
    desc: 'The inside face of the wall, and a path along it worn smooth by the daily round. Up close the thorn is not a hedge, it is an argument that took thirty years: layered, pegged, cut back and let go and cut back again, the salvage lattice long since swallowed. A crew is working a section with hooks and heavy gloves, and what they are doing is not repairing it. They are pruning it.',
  },
  [`${CX + 2}_${CY + 2}`]: {
    name: 'The Long Table',
    desc: 'A single table sixty feet long under a run of sailcloth, made from eleven different tables and painted once, badly, a long time ago. This is where the town eats when it eats together, which the state of the benches suggests is often.',
  },
};

// The quarters. Everything inside the wall that is not a landmark gets fill from the quadrant it
// falls in, so the town has neighbourhoods without thirty more bespoke strings.
const QUARTERS = {
  warren: {
    names: ['The Warren', 'Low Row', 'The Steps', 'Cinder Lane', 'The Hollow'],
    descs: [
      'Dwellings packed shoulder to shoulder: plate, hide, rammed earth, every roof pitched the same steep angle into the same run of tin gutter. Doorways are curtained against the grit. Somebody has planted something in a cut-down drum by a step and it is being watered.',
      'A narrow way between houses, barely two abreast, with washing strung over it and a drain channel cut down the middle of the packed ground. A cat owns the sunny end.',
      'Homes built into and onto each other over a long time, so it is not clear where one stops. Numbers have been painted on the doors by somebody with strong opinions about numbers.',
    ],
  },
  works: {
    names: ['The Works', 'Hammer Row', 'The Yard', 'Sparks', 'The Cut'],
    descs: [
      'Workshops open to the lane: a wheelwright, a stitcher, somebody rebuilding a pump on a trestle with the parts laid out on a cloth in the order they came off.',
      'A yard stacked with sorted salvage. Sorted is the word that matters. Plate here, rail there, wire coiled by gauge, and a tally slate on the post at the end of each row.',
      'Somebody is teaching somebody else to braze, patiently, for what is clearly not the first time.',
    ],
  },
  green: {
    names: ['The Green', 'The Beds', 'Netting Row', 'The Damp'],
    descs: [
      'Growing beds under stretched mesh, sloped to shed the rain off sideways. The soil in them was carried here. All of it, by hand, from somewhere else.',
      'Water butts and a hand pump, and a rota nailed to the post beside it with everybody\'s name on it and a great many ticks.',
      'A low glasshouse of mismatched panes puttied into a salvage frame, every pane a slightly different colour, the whole thing beautiful entirely by accident.',
    ],
  },
  sink: {
    names: ['The Sink', 'Gutter Row', 'The Drains', 'Tank Row'],
    descs: [
      'Where the town\'s water goes when it has been used: open channels running to a reed bed, the reeds looking better than anything else growing for sixty miles.',
      'A bank of catchment tanks on stone footings, lidded and numbered, with the run of guttering coming off six roofs into the top of them.',
      'Grey water, soap, and the smell of wet stone. Two people are unblocking a channel with a rod and are enjoying it far more than the job warrants.',
    ],
  },
};
const quarterAt = (x, y) => {
  const e = x >= CX, s = y >= CY;
  return e ? (s ? 'sink' : 'works') : (s ? 'green' : 'warren');
};

// ── Outside the wall ─────────────────────────────────────────────────────────
const OUTSIDE = {
  // THE TROPHY ROAD. Five tiles of authored dread north of the gate. Read them in order: they get
  // worse, and then the last one is a gate with washing behind it.
  '1046_967': { name: 'The Trophy Road', road: true,
    desc: 'The last of the stakes, and the worst of them, set close enough together here that the road runs through a corridor of them. Drone hulls, split open and splayed on frames. Something that was a Custodian unit, upside down. The wind moves it all slightly. Ahead the thorn wall goes across the whole horizon and there is a gap in it with light coming through.' },
  '1046_966': { name: 'The Screaming Line', road: true,
    desc: 'Poles either side of the track, and lashed to each one a length of bone drilled through in a row of holes. The wind is doing the rest. It is not a sound a throat could make and it does not stop, and it has been tuned: the holes are spaced, and they are spaced the same on every pole.' },
  '1046_965': { name: 'The Trophy Road', road: true,
    desc: 'Skulls on poles down both sides of the track, every one of them wired at the jaw, most of them animal and some of them very much not. The wire is bright. It has been replaced recently, and not all at once, but a bit at a time, the way you maintain anything you intend to keep.' },
  '1046_964': { name: 'The Trophy Road', road: true,
    desc: 'The track narrows between two banked heaps of scoured metal, and the first of the stakes begins. Rags hang off the frames, eaten to lace by the rain, and where a frame has gone through at the joint somebody has scabbed a new plate over it and bolted it down square.' },
  '1046_963': { name: 'The Turning', road: true,
    desc: 'A cairn of drone parts at the side of the track, taller than you, and past it the ground has been cleared for a long way in both directions so that anything coming has to come in the open. There are dogs out on the flat, keeping level with you, not closing. From here you can see something dark along the southern horizon and it goes on for a very long way.' },

  // THE POOL. Outside the wall, reached on purpose.
  [`${POOL[0]}_${POOL[1]}`]: { name: 'The Quickening Pool', pool: true,
    desc: 'A sink in the rock holding water the colour of a bruise, lit from underneath by nothing that should be lighting it. The rim is worn smooth in three places by a great many feet. There are offerings: wire, teeth, a child\'s shoe, a wedding band. The air over the water shakes. Whatever is in this pool is not a metaphor and it does not care who you are, and everybody who has ever come here came here on purpose.' },
  [`${POOL[0] - 1}_${POOL[1] - 1}`]: { name: 'The Approach', pool: true,
    desc: 'A path worn into the rock by feet, going one way. Cairns beside it, each one built by somebody, none of them the same. The last cairn has a lamp on it, sheltered, and the lamp has oil in it.' },

  // THE ROADHEAD + THE STRIP. Reachability. Neither is Wildblood work and neither pretends to be.
  '1024_957': { name: 'The Roadhead', depot: true,
    desc: 'Where the track from the northwest gives up being a track: a graded turning circle in the hardpan, a drum of diesel under a lean-to, and a plate shack with a hatch in it. Ruts run off southeast. A board by the hatch lists distances to places, and somebody has scratched out the last entry and written under it, in a different hand, DONT.' },
  '1030_960': { name: 'The Strip', strip: true,
    desc: 'A run of hardpan somebody once flattened and nobody since has maintained, marked out with painted drums at intervals and a windsock on a pole that has been repaired with a shirt. It is long enough. It is not much more than long enough. Off at the far end sits the burnt-out frame of something that found that out.' },

  // THE LONG WATCH HIDE. Recon, not a base. They watch the gate and they never come down.
  '1041_961': { name: 'The Rise', hide: true,
    desc: 'A shelf of higher rock with a good long view south to the wall and the gap in it. Up under the overhang, where the shadow sits all day, somebody has built a hide: netting over a frame, dressed with rock and dead scrub, and done well enough that you are past it before you see it. There is a lens in there catching the light. Nothing moves. Whoever is inside has watched you the whole way up and has decided to go on doing nothing, and there is a second set of ruts leading away north that are much fresher than the first.' },

  // THE NULL CREW. Roving scrappers, southeast among the wrecks.
  '1068_990': { name: 'The Stripping Ground', crew: true,
    desc: 'A field of machine wreckage worked over methodically from one end: cores pulled, casings stacked by alloy, the picked-over frames dragged aside in rows. A crew is here now, four of them, in grey, working without much talk. They do not look up. They are not stripping this for scrap value. Everything they have kept is the part that used to do the thinking.' },
  '1069_990': { name: 'The Stripping Ground', crew: true,
    desc: 'More of the field, unworked yet, the wrecks lying where they came down and the sand drifted up their windward sides. A pole has been driven into the ground at the edge of the worked ground with a rag on it, marking how far they have got.' },
};

function main() {
  for (const d of ['zones', 'power_zones', 'regions', 'generators', 'airfields', 'connections']) {
    const p = join(ROOT, 'content', d);
    if (!existsSync(p)) mkdirSync(p, { recursive: true });
  }

  let zones = 0, wallTiles = 0, authored = 0;

  for (let x = X0; x <= X1; x++) {
    for (let y = Y0; y <= Y1; y++) {
      const me = id(x, y);
      const key = `${x}_${y}`;
      const wall = onWall(x, y);
      const town = TOWN[key];
      const gate = town?.gate === true;
      const out = OUTSIDE[key];
      const isWallMass = wall && !gate;

      // EXITS. Reciprocal orthogonal links to every neighbour inside the region box. The only thing
      // that breaks the grid is the wall: you enter the Thornwarren through a gate or not at all.
      //
      // A wall tile carries no exits of its own, and nothing links INTO one. Note this is not
      // sufficient by itself: derive.mjs projects an edge between any two adjacent tiles on the same
      // map, so every one of those non-links has to be un-said by a blocked connection file below.
      const exits = {};
      if (!isWallMass) {
        const link = (dx, dy, dir) => {
          const nx = x + dx, ny = y + dy;
          if (nx < X0 || nx > X1 || ny < Y0 || ny > Y1) return;
          if (onWall(nx, ny) && !(TOWN[`${nx}_${ny}`]?.gate)) return;   // never walk into the thorn
          exits[dir] = id(nx, ny);
        };
        link(0, -1, 'north'); link(0, 1, 'south'); link(1, 0, 'east'); link(-1, 0, 'west');
      }

      // FLAGS. The ground is redrock everywhere, with no exceptions and no roads: the region ships
      // as one flat canvas to be painted by hand later. A building footprint is the one place
      // terrain must NOT be set — painted terrain on a building tile suppresses its map code and the
      // wall would vanish off the map and the tablet. content:lint catches it; it is easy to re-add
      // by reflex.
      const flags = { region_id: REGION, radiation: radAt(x, y), terrain: 'redrock' };
      if (isWallMass) {
        // SOLID, BUT NOT A LANDMARK. The wall has to stop a vehicle: `groundObstructionAt` reads
        // buildingHeightZ, and the render cell's `bt` comes from `flags.building_type` and nothing
        // else (plugins/flight/state.js:772). Exits stop walkers; only this stops a truck.
        //
        // What it must NOT do is claim a map code. `isBuildingTile` in derive.mjs keys the marker
        // namespace off `facade || is_building`, and `uniqueMarkerFor` derives the code from
        // `building_name` — so 62 tiles called "Thornwarren Wall N" all reach for TW, collide with
        // Terminus's wall (which got there first), and spill into numbered codes. That is the
        // marker-namespace exhaustion Terminus hit at THIRTEEN tiles, and the fix there was unique
        // names because those thirteen were meant to be on the map.
        //
        // These are not. A boundary is not a landmark, and sixty-two two-letter labels strung along
        // a hedge is map noise even in the world where it works. So: building_type only. No
        // `is_building`, no `building_name`, therefore no code, therefore no collision. The town
        // reads on the map as its own outline, which is what a walled town looks like from above.
        Object.assign(flags, { building_type: 'ruins', floors: 1 });
        wallTiles++;
      }
      if (out?.depot) { flags.truck_depot = { name: 'The Roadhead' }; flags.truck_fuel = true; }
      if (out?.strip) flags.airfield_id = 'scarlet_strip';
      // The wilds have no law out here, and the town enforces its own inside the thorn.
      if (!inside(x, y)) flags.lawless = true;
      // Scavenging: the open waste is worth working over. The town and its burial ground are not.
      if (!inTown(x, y)) flags.scavenging_table_id = 'scav_irradiated_salvage';
      if (inTown(x, y)) flags.no_spawn = true;

      const q = inside(x, y) ? QUARTERS[quarterAt(x, y)] : null;
      const name = town?.name || out?.name
        || (isWallMass ? 'The Thorn Wall' : q ? pick(q.names, x, y) : pick(TILE_NAMES, x, y));

      const onRoad = y >= 963 && y <= 967 && x === NORTH_GATE[0];
      const description = town?.desc || out?.desc || (isWallMass ? WALL_DESC : q ? pick(q.descs, x, y)
        : dist(x, y, POOL) < 6
          ? 'Red rock, and the rock here is wrong: banded through with a colour that is not mineral, and warm to the back of the hand from a foot away. Nothing grows. The few bones lying about have gone the same colour as the ground.'
          : dist(x, y, [CX, CY]) < 14
            ? 'Open red country, and something has been through it: the ground is cut with a great many tracks, most of them feet, some of them dogs, all of them heading the same two ways. Off south the horizon has a dark line across it that does not behave like a ridge.'
            : 'Red rock to the horizon in every direction, pitted all over with pale rings a hair deep where the rain has stood and eaten. The wind never entirely stops. There is a great deal of sky and none of it is reassuring.');

      const ambient = isWallMass ? [] : inside(x, y) ? AMBIENT_TOWN : onRoad ? AMBIENT_ROAD : AMBIENT_WASTE;

      if (town || out) authored++;

      // PRESERVE THE MARKER. A building tile ships with the two-letter map code it will derive, and
      // that code can only be chosen by something that sees every building in the world at once
      // (assignBuildingMarkers), which this script cannot. So the codes are baked in by an export
      // after the first derive (see the header) and carried forward here. Without this line a
      // rebuild silently strips them and the map loses the wall again.
      let marker = null;
      try { marker = JSON.parse(readFileSync(zonePath(me), 'utf8')).marker ?? null; } catch { /* new tile */ }

      // `marker` is OMITTED when null rather than written as null: the content registry marks it
      // omitWhenNull, so an explicit null is a value where the absence of the key is the default.
      write(zonePath(me), {
        ambient_events: ambient, ambient_theme: 'wasteland', description, exits, flags,
        grid_x: x, grid_y: y, grid_z: 0, id: me, map_id: 'map_world',
        ...(marker ? { marker } : {}),
        name, parent_zone: null,
      });
      write(powerPath(me), {
        capacity_kw: 10000, flags: {}, generator_id: 'gen_region_region_scarletwastes',
        id: me, max_capacity_kw: 1000, name, source_type: 'city_grid',
      });
      zones++;
    }
  }

  // ── The wall the geometry cannot un-say ────────────────────────────────────
  // derive.mjs projects an edge between any two orthogonally adjacent tiles on the same map. The
  // open waste needs none of these (every neighbour is a real link), so this runs ONLY over the town
  // box and one tile of margin. Without it the derive pass invents exits straight through the thorn
  // and quietly demolishes the wall the whole town is about.
  //
  // One file per PAIR, deterministically named so a re-run overwrites rather than accumulates.
  let walls = 0;
  const declared = (x, y, dir, to) => {
    try { return JSON.parse(readFileSync(zonePath(id(x, y)), 'utf8')).exits?.[dir] === to; }
    catch { return false; }
  };
  const OPP = { north: 'south', south: 'north', east: 'west', west: 'east' };
  for (let x = TX0 - 1; x <= TX1 + 1; x++) {
    for (let y = TY0 - 1; y <= TY1 + 1; y++) {
      if (x < X0 || x > X1 || y < Y0 || y > Y1) continue;
      for (const [dx, dy, dir] of [[1, 0, 'east'], [0, 1, 'south']]) {   // each pair once
        const nx = x + dx, ny = y + dy;
        if (nx > X1 || ny > Y1 || nx > TX1 + 1 || ny > TY1 + 1) continue;
        const a = id(x, y), b = id(nx, ny);
        if (declared(x, y, dir, b) || declared(nx, ny, OPP[dir], a)) continue;   // a real link
        const cid = `conn_scw_${x}_${y}_${dir}`;
        write(join(ROOT, 'content', 'connections', `${cid}.json`),
          { a, b, blocked: true, dir, id: cid, lockable: false, one_way: false });
        walls++;
      }
    }
  }

  write(join(ROOT, 'content', 'regions', `${REGION}.json`), {
    // acid: the share of this region's precipitation that falls as acid. Read by the weather
    // plugin's region bias (effectiveBias), which turns it into precipType 'acid' on the sampled
    // field; everything downstream (the corroding effect, acidCover shielding, gear wear, the audio
    // route, the forecast) is the machinery the global hero event already drives. temp/dryness are
    // the two keys that already existed. See docs/systems-weather-extreme.md.
    base_terrain: 'redrock',
    climate_bias: { acid: 0.75, dryness: 0.8, temp: 7 },
    defaults: {}, grid_z: 0, id: REGION, name: 'The Scarletwastes',
  });
  write(join(ROOT, 'content', 'generators', 'gen_region_region_scarletwastes.json'), {
    capacity_kw: 10000, city_generator_id: null, connection_range: 0, flags: {},
    fuel_burn_rate: 0, fuel_remaining: 0, fuel_type: null, generator_type: 'city_plant',
    id: 'gen_region_region_scarletwastes', name: 'The Thornwarren Bank', owner_id: null,
    zone_id: id(CX + 2, CY),
  });
  // A strip, not a pad: things with wings get in here, which is how the outside world arrives. It is
  // lawless and it is not for rent, because nobody out here is administering anything.
  write(join(ROOT, 'content', 'airfields', 'scarlet_strip.json'), {
    charter: false, charter_vtol_only: false, dealer: false, fuels: ['avgas'],
    id: 'scarlet_strip', lawless: true, name: 'The Strip', rental: false,
    residents_only: null, surface: 'dust', theme: 'wastes', vtol_only: false,
  });

  console.log(`scarletwastes: wrote ${zones} zones + ${zones} power_zones, 1 region, 1 generator, 1 airfield`);
  console.log(`  box        x${X0}-${X1} y${Y0}-${Y1}  (${X1 - X0 + 1}x${Y1 - Y0 + 1}, all redrock)`);
  console.log(`  thornwarren x${TX0}-${TX1} y${TY0}-${TY1}  (${wallTiles} wall tiles, 2 gates)`);
  console.log(`  authored   ${authored} hand-written tiles`);
  console.log(`  walls      ${walls} blocked connection file(s)`);
}

main();
