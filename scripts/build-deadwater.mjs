// Build DEADWATER — the region southwest of Coldwater Basin, and the Null's works.
//
// A one-shot content generator. It writes files under `content/` and touches no database: git is the
// source of truth, so this emits the tree and `npm run content:import` loads it. Re-runnable — it
// overwrites its own output and nothing else.
//
// See docs/proposals/deadwater.md for the design. Three rules the whole file is written under:
//
// 1. THE WAR IS REAL; THE REASON IS UNFALSIFIABLE. The Null intend to march on the Architect, and
//    one of them believes the world is a simulation they can delete themselves from. Nothing here
//    confirms it and nothing here refutes it. That belief appears in EXACTLY ONE authored tile and
//    nowhere in any ambient pool, because ambience that whispers "none of this is real" turns a
//    region into a theme. No quest may ever reward a player for working it out.
//
// 2. THEIR MACHINES ARE ANALOG, AND IT IS STATED ONLY AS MAINTENANCE. No manifesto. A hand crank, a
//    cover plate off, a man filing a part flat, a clock you can watch the escapement of. Nobody in
//    this file explains why. The Bench (the prosthetic arm being serviced by its owner, mid-
//    conversation, about something else) is the whole thesis in one examinable object.
//
// 3. NOBODY REMARKS ON THE ION STORM. There is no ambient beat, no NPC line and no forecast copy
//    about the fact that the grid-killing weather does nothing here. The absence of the line IS the
//    line. Every tile carries `flags.emp_shadow` for a plugin that does not exist yet.
//
// AND A FOURTH, WHICH IS THE DIFFERENCE FROM THE THORNWARREN: EVERYTHING HERE IS LEGIBLE. The
// Scarletwastes runs on "terror outside, domestic inside, nothing remarks on it". Repeating that
// shape would make two regions read as one idea twice. Deadwater's disquiet is the opposite: every
// mechanism has its cover off, every part is in a tray in order, and nothing is hidden from you at
// all. These people are not savage. They are CALM, and they are calm about something enormous.
//
// NO EM DASHES in any player-facing prose in this file. That punctuation is a voice tell reserved
// for the Ascendants and the Architect, and the Null would take it as an insult.
//
// LAYOUT (93x52, x726-818, y950-1001 — the exact mirror of the Scarletwastes across Coldwater).
// You arrive from the NORTHEAST at the Roadhead, overland off Coldwater's west rim, or from the EAST
// off the Reach. There is deliberately NO AIRFIELD: nobody here maintains a strip, and that is a
// statement rather than an omission.
//
//                          THE DEADWATER (reservoir, still water)
//                    ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~                 roadhead (812,955)
//                  ═══════════ THE DAM ═══════════   <- y972, one gallery through it   /
//                    +---------------------------+                                    /
//                    |        THE WORKS          |  x762-776, y973-980  <------------'
//                    +---------------------------+
//                              | tailrace                       .  eastern ruts (818,988)
//
// FIRST RUN, in order — the middle step exists because a building's two-letter map code can only be
// chosen by something that sees every building in the world at once, which this script cannot:
//
//   node scripts/build-deadwater.mjs
//   npm run content:import && npm run map:derive
//   npm run content:export          <- carries the derived codes back into content
//   npm run content:import
//
// After that, re-running this script is safe: it carries any existing `marker` forward.

import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const REGION = 'region_deadwater';
const X0 = 726, X1 = 818, Y0 = 950, Y1 = 1001;

// ── The works ────────────────────────────────────────────────────────────────
const WX0 = 762, WX1 = 776, WY0 = 973, WY1 = 980;
const CX = 769, CY = 976;                       // the Tally, dead centre
const inWorks = (x, y) => x >= WX0 && x <= WX1 && y >= WY0 && y <= WY1;

// ── The dam ──────────────────────────────────────────────────────────────────
// A gravity dam: a solid mass holding water back by its own weight. No cables, no active machinery,
// nothing to fail. The least clever dam you can build, which is exactly why it is still here.
//
// It is building MASS (`building_type` gates solidity in `groundObstructionAt` — without it a
// vehicle drives straight through, because exits stop walkers and nothing else). It claims NO map
// code: `isBuildingTile` keys the marker namespace off `facade || is_building` and `uniqueMarkerFor`
// derives the code from `building_name`, so nineteen tiles reaching for the same two letters is the
// namespace exhaustion Terminus hit at THIRTEEN. A barrier is not a landmark. `building_type` only.
const DAM_Y = 972, DX0 = 760, DX1 = 778;
const GALLERY_X = 769;                          // the way THROUGH, on foot
// The two shoulders are walkable: the Spillway at the west end and the Gauge House at the east.
// Those are places you stand in, not stone you walk into, and turning them into mass gave them
// authored prose no player could ever reach.
//
// So the dam is NOT a chokepoint, and nothing here should pretend it is: the lake is only ten tiles
// deep in a region fifty-two tall, and a walker who wants the north shore can simply go round. The
// dam stops you the way a building stops you, and the Gallery is the short way, not the only way.
const isDamMass = (x, y) => y === DAM_Y && x > DX0 && x < DX1 && x !== GALLERY_X;

// ── The reservoir ────────────────────────────────────────────────────────────
// An ellipse, so the lake is not a rectangle. Its southern lip sits flush against the dam.
// `water` carries `liquid/swimmable` and `routable:false` from the palette, so it is crossable by
// swimming and never by pathfinding, which is what a reservoir should be.
const LAKE_CX = 769, LAKE_CY = 966.5, LAKE_RX = 12, LAKE_RY = 5.5;
const inLake = (x, y) =>
  y >= 962 && y <= 971
  && ((x - LAKE_CX) ** 2) / (LAKE_RX ** 2) + ((y - LAKE_CY) ** 2) / (LAKE_RY ** 2) <= 1;

// The tailrace: the channel the water leaves the turbines by, running south out of the works.
const inTailrace = (x, y) => x === GALLERY_X && y >= WY1 + 1 && y <= WY1 + 4;

// ── The roads ────────────────────────────────────────────────────────────────
// Two hauls converge on the works: one off Coldwater's rim to the northeast, one off the Reach to
// the east. Orthogonal dog-legs, because a diagonal road cannot auto-tile.
const ROAD = new Set();
for (let x = 790; x <= 812; x++) ROAD.add(`${x}_955`);          // A: west along the top
for (let y = 955; y <= 976; y++) ROAD.add(`790_${y}`);          // A: south
for (let x = 777; x <= 790; x++) ROAD.add(`${x}_976`);          // A: west into the works
for (let x = 777; x <= 818; x++) ROAD.add(`${x}_988`);          // B: west off the Reach
for (let y = 980; y <= 988; y++) ROAD.add(`777_${y}`);          // B: north into the works
const onRoad = (x, y) => ROAD.has(`${x}_${y}`);

const ROADHEAD = [812, 955];
const EASTERN_RUTS = [818, 988];

const id = (x, y) => `zone_dw_${x}_${y}`;
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

// ── LANDFORM: the volcanic ground ────────────────────────────────────────────
// The region shipped as one flat sheet of `ash` with a graded gravel platform in the middle of it.
// The ash/gravel split was rule 4 doing real work (the ground changes underfoot exactly where
// somebody started looking after it) and it is KEPT WHOLE: nothing below paints inside the works.
//
// Everything outside it becomes volcanic country, and the reason is the water. A reservoir this
// still, in a basin this dead, held at a temperature nothing seasonal explains, has something under
// it. So the ground says so: lava rock, the mineral apron a hot spring lays down, stands of trees
// that died standing, and the cliffs of an old flow front.
//
// SAME RULE AS THE SCARLETWASTES: the ground is a field, not a sprinkle. One continuous height
// surface, one moisture-ish surface, thresholds on both. Deterministic hashed value noise, no RNG,
// so a rebuild is byte-identical.
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

// Ground the landform pass is NOT allowed to touch: the works platform, the dam, the roads, the
// water and every authored set-piece. Asked once, by everything, so the exemptions cannot drift
// apart between the terrain, the rim test and the massif flood-fill.
const LANDFORM_OFF = (x, y) => inWorks(x, y) || onRoad(x, y) || isDamMass(x, y)
  || inLake(x, y) || inTailrace(x, y) || y === DAM_Y;

const MESA_H = 0.645;
// High ground: an old flow front, standing above the ash the way a lava field does where it stopped.
const isMesa = (x, y) => x >= X0 && x <= X1 && y >= Y0 && y <= Y1
  && !LANDFORM_OFF(x, y) && !OUTSIDE[`${x}_${y}`] && fbm(x, y, 12, 5) > MESA_H;
// The ways up. A second continuous field, so a gap is two or three tiles you can see and aim for
// rather than a scatter of pinholes. See docs/proposals/scarletwastes.md for why that matters.
const isPass = (x, y) => fbm(x, y, 4.5, 61) > 0.70;

// Every massif gets a way up, guaranteed rather than hoped for. Lazy: it walks isMesa, which reads
// the authored OUTSIDE table declared below, so evaluating at module load would hit its dead zone.
let _forced = null;
const forcedRamps = () => (_forced ??= (() => {
  const forced = new Set(), seen = new Set();
  const key = (x, y) => `${x}_${y}`;
  for (let x = X0; x <= X1; x++) {
    for (let y = Y0; y <= Y1; y++) {
      if (!isMesa(x, y) || seen.has(key(x, y))) continue;
      const stack = [[x, y]], rim = [];
      let hasPass = false;
      seen.add(key(x, y));
      while (stack.length) {
        const [cx, cy] = stack.pop();
        if (!isMesa(cx, cy - 1) || !isMesa(cx, cy + 1) || !isMesa(cx + 1, cy) || !isMesa(cx - 1, cy)) {
          rim.push([cx, cy]);
          if (isPass(cx, cy)) hasPass = true;
        }
        for (const [nx, ny] of [[cx, cy - 1], [cx, cy + 1], [cx + 1, cy], [cx - 1, cy]]) {
          if (!isMesa(nx, ny) || seen.has(key(nx, ny))) continue;
          seen.add(key(nx, ny));
          stack.push([nx, ny]);
        }
      }
      if (hasPass || rim.length <= 1) continue;   // a one-tile massif has no inside to reach
      const best = rim.reduce((a, b) => (fbm(b[0], b[1], 4.5, 61) > fbm(a[0], a[1], 4.5, 61) ? b : a));
      forced.add(key(best[0], best[1]));
    }
  }
  return forced;
})());

// The sinter apron: the pale mineral shelf a hot spring lays down around itself. Keyed off distance
// from the LAKE rather than from noise, because that is what it physically is — the water put it
// there, so it rings the water and reaches no further than the water has reached.
const lakeField = (x, y) => Math.hypot((x - LAKE_CX) / LAKE_RX, (y - LAKE_CY) / LAKE_RY);

function landformAt(x, y) {
  if (inLake(x, y) || inTailrace(x, y)) return 'spring';
  if (LANDFORM_OFF(x, y)) return 'ash';
  if (isMesa(x, y)) {
    const rim = !isMesa(x, y - 1) || !isMesa(x, y + 1) || !isMesa(x + 1, y) || !isMesa(x - 1, y);
    if (rim) return (isPass(x, y) || forcedRamps().has(`${x}_${y}`)) ? 'ramp' : 'cliff';
    return 'flow';                       // the top of the old flow, walkable
  }
  // The apron, then the trees the water killed, then the rock, then ash.
  if (lakeField(x, y) < 1.5) return 'sinter';
  // Dead stands take the ground just outside the apron: close enough to the water that whatever
  // comes up with it got them, far enough that they had grown first.
  if (lakeField(x, y) < 3.4 && fbm(x, y, 6, 17) > 0.56) return 'snags';
  if (fbm(x, y, 9, 33) > 0.60) return 'lava';
  return 'ash';
}
const TERRAIN_OF = {
  spring: 'hotspring', sinter: 'sinter', snags: 'deadwood', lava: 'basalt',
  flow: 'plateau', cliff: 'cliff', ramp: 'ramp', ash: 'ash',
};

// ── AMBIENT: the open ground ─────────────────────────────────────────────────
// Ash: burnt grey waste that takes a print and keeps it. The wind is in here because the region has
// no engine noise anywhere in it, and silence has to be described or it reads as unfinished. Note
// what NOBODY here ever says: what burned, or when. Ash with an explanation attached is a backstory;
// ash without one is a place.
const AMBIENT_WASTE = [
  'Ash, packed hard and grey as a cold hearth, taking the print of your boot and keeping it.',
  'The wind comes across the flat and there is nothing here for it to make a noise against.',
  'A length of rail lies half-sunk in the ash, bright along its top edge where boots have crossed it.',
  'Tyre ruts, old ones, pressed into the grey and never rained back out.',
  'Something metal has been dragged across the flat here, one long score, going west.',
  'A stack of sorted plate, weathered but square, waiting a very long time for somebody to come back for it.',
  'The light goes flat and colourless and the horizon stops being a line at all.',
  'A survey peg, driven true, with a number burned into the top of it in a hand that meant it.',
  'A bird goes over, low, and you hear the feathers.',
  'Bolt holes in a concrete pad, forty of them, in two neat rows, and no machine on them.',
  'Your boots come up grey to the ankle and stay that way.',
];

// ── AMBIENT: the reservoir shore ─────────────────────────────────────────────
// The name of the region, doing its work. Deadwater is the still water in a wake, and the thing
// about still water is how much it looks like something you could walk on.
// THE WATER IS HOT, and the region never explains why. It is stated the way everything else here is
// stated, as maintenance: somebody logs the temperature, somebody rakes the screen, nobody wonders
// aloud. The stillness is unchanged and so is the name — Deadwater is the flat water in a wake, and
// warm water lies flatter than cold. What the heat costs is the one beat that used to say `cold`.
const AMBIENT_WATER = [
  'The water does not move. Not a ripple, not a slap against the stone, nothing.',
  'Steam comes off the surface in slow sheets and leans away downwind without hurrying.',
  'The far shore is in the water as well as above it, and the two do not disagree by a hair.',
  'Something breaks the surface out in the middle, once, and the rings go out for a very long time.',
  'A rime of pale mineral along the stone, and above it, older rings of it, each one a dry year.',
  'The warmth comes off it in a sheet and stops about a foot inland.',
  'The smell is minerals and old eggs, and after a while you stop noticing it.',
  'A thermometer on a cord hangs off the staging into the water, and the cord is worn where it is lifted.',
  'A rowing boat is drawn up on the stone, turned over, its bottom recently tarred.',
];

// ── The volcanic ground, in words ────────────────────────────────────────────
// `ash` is deliberately absent: it falls through to the region's original prose, so the country you
// cross most of is still the country Deadwater shipped as, and the rest are the exceptions.
const LANDFORM = {
  lava: {
    names: ['The Clinker', 'Blackground', 'The Ropes', 'Slagfield', 'The Hard Black'],
    descs: [
      'Black rock, and it went off in ropes: the whole surface is a set of frozen coils and folds lying over each other in the direction it was going. It rings under a boot and it takes the skin off a hand that goes down on it. Nothing has grown in it and there is no soil in it to grow in.',
      'A field of broken black glass and clinker, sharp all over, with the pale ash blown into the hollows between the lobes so the ground reads as a dark map with light rivers in it.',
      'Lava rock, gone matt and grey-black with age, standing a foot or two proud of the ash flat it stopped on. The edge of it is as clean as a tide line: this far, and then it cooled.',
    ],
    ambient: [
      'The rock is warm through the boot, and it is not the sun doing it.',
      'A piece of clinker breaks off under your heel with a sound like crockery.',
      'Steam standing up out of a crack, thin and steady, going nowhere.',
      'The black eats the light. Even at noon the ground reads as a hole.',
    ],
  },
  sinter: {
    names: ['The White Apron', 'Sinter Shelf', 'The Terraces', 'Crustground'],
    descs: [
      'The pale shelf the water has been laying down around itself for a very long time: mineral crust in flat terraces, off-white and faintly yellow, ringed and lipped like something poured. It is hollow in places and it says so underfoot, so you keep to the trodden line.',
      'Crust, bone-pale, crazed all over into plates and stained sulphur-yellow along every crack. Warm through the sole. Somebody has laid a run of planks across the worst of it and pegged them down, and the planks are recent.',
    ],
    ambient: [
      'The crust gives very slightly underfoot and does not break, which is somehow worse.',
      'A plate of it lifts at the edge and there is water under it, and the water is moving.',
      'Yellow along every crack, in a colour nothing else here is.',
      'Somebody has driven a peg at the edge of the sound ground and painted the top of it white.',
    ],
  },
  snags: {
    names: ['The Standing Dead', 'Grey Stand', 'The Bare Wood', 'Deadfall Rise'],
    descs: [
      'A stand of trees that died where they stood and never fell: bark long gone, trunks silver-grey and sanded smooth on the windward side, every branch bare and none of them broken off. There is no undergrowth at all. They are not close enough together to be a wood and there are far too many of them to be anything else.',
      'Dead timber, standing. Whatever killed them did it to all of them in the same season, because they are all the same shade of grey and every one of them still has its shape. The ground between is packed ash and it takes a print.',
    ],
    ambient: [
      'The wind goes through the stand and makes almost no sound, because there is nothing left on them to make one with.',
      'A trunk has a ring of pale mineral around it at knee height, and so does the next one, and so does the next.',
      'Every one of them is grey on the same side, and it is the same side as the water.',
      'A bird is up in the bare branches, doing nothing, in no hurry.',
    ],
  },
  flow: {
    names: ['The Flow Top', 'High Black', 'The Level', 'Old Flow'],
    descs: [
      'The top of the old flow, flat as a poured floor and black as a stove, with the ash drifted into every low place in it. From up here the whole grey basin lies out below with the water standing in the middle of it and the steam going up off it in a line.',
      'A level of hard black rock standing above the flats, cracked into slabs the size of doors by nothing but time. Where the slabs have parted the crack goes down further than you can see and lets no light in.',
    ],
    ambient: [
      'From up here the steam off the water reads as one long standing plume.',
      'The slabs ring differently where they are hollow underneath, and you find yourself testing them.',
      'Ash has drifted into every crack and made a pale grid of the whole level.',
      'The wind is steadier up here, and colder, and it comes off the water warm.',
    ],
  },
  cliff: {
    names: ['The Flow Front', 'The Black Wall', 'Stopline', 'The Edge of the Flow'],
    descs: [
      'The front of the old flow, where it stopped: a wall of black rock standing clear of the ash, rubbly at the top and sheer in the middle, undercut at the foot where the weather has been at the softer bed under it. There is no way up it here. It runs off in both directions along the same line.',
      'A face of frozen rock, columnar where it cooled slowly, so the whole wall is a rank of black pillars standing shoulder to shoulder. Broken stuff piled at the foot of it. It is one piece and it does not offer a hold.',
    ],
    ambient: [
      'The wall throws a hard cold shadow out across the ash, with an edge you could measure.',
      'Columns, all the same width, all the way along, and nobody cut them.',
      'A block has come off the face recently, and it lies where it landed with the ash not yet blown over it.',
      'You walk the foot of it for a while looking for a break, and there is not one here.',
    ],
  },
  ramp: {
    names: ['The Breach', 'The Way Up', 'Broken Front', 'The Gap'],
    descs: [
      'A break in the flow front, and the only one for a long way: a slope of fallen black rock wedged into the gap, steep and loose, going up onto the level. Everything that crosses this ground crosses it here and the ground says so, because the ash on the approach is beaten flat and it is not beaten flat anywhere else.',
      'Where the wall has failed and come down in a fan, making a rough stair onto the flow. Somebody has rolled the worst blocks aside and left them in a line at the bottom, which is the only work anybody has done to it.',
    ],
    ambient: [
      'Every track on this flat comes together here and goes up.',
      'Loose black rock the whole way, worn to a pale line down the middle where the traffic goes.',
      'Somebody has stacked the moved blocks in a row rather than just shoving them off, which tells you who lives here.',
      'A survey peg at the foot of the gap, driven true, with a number burned into the top of it.',
    ],
  },
};

// ── AMBIENT: the works ───────────────────────────────────────────────────────
// Hand tools, patient noise, and people who are not in a hurry. NOT ONE of these mentions the
// Architect, the march, or the simulation. This is a place where people live and mend things.
const AMBIENT_WORKS = [
  'Somebody is filing something flat, and has been for a while, and is in no hurry to stop.',
  'A hand crank goes round twelve times, pauses, and goes round twelve more.',
  'Two people are arguing about a tolerance. Neither of them is angry and both of them are certain.',
  'Woodsmoke, machine oil, and under both of them, wet stone.',
  'A tray of bearings on a bench, laid out in a row in the order they came out.',
  'The clock on the shop wall ticks, and you can see the escapement doing it.',
  'A belt slaps somewhere overhead, running off a shaft that runs off the water.',
  'Somebody drops a spanner and somebody else, out of sight, names the size of it correctly.',
  'A child goes past carrying a part in both hands, very carefully, on an errand that clearly matters.',
  'Chalk marks on a doorframe at four heights, the highest one recent.',
  'Somebody laughs, once, and goes back to work.',
  'A kettle comes to the boil on a plate over the forge and is taken off it by somebody who was waiting.',
];

const TILE_NAMES = [
  'The Grey Flat', 'Long Ash', 'The Sorting Ground', 'Cinderlevel',
  'The Bare Mile', 'Cold Ash', 'The Wide Quiet', 'The Print Ground',
  'The Old Survey', 'Grey Mile', 'The Empty Pad', 'Broken Level',
];

const DAM_DESC = 'The dam, seen from its foot: a wedge of poured stone eighty feet high and far thicker at the bottom than the top, holding back everything on the other side of it by weighing more than the water does. There is nothing on it that moves. No cable, no motor, no panel, no light. Somebody has painted a level scale up one face in feet, by hand, and somebody else has been reading it twice a day for long enough to wear a path to the foot of it.';

// ── The works, hand-authored ─────────────────────────────────────────────────
const WORKS = {
  [`${GALLERY_X}_${DAM_Y}`]: {
    name: 'The Gallery', gallery: true,
    desc: 'A tunnel driven straight through the body of the dam, wide enough for two and lit by nothing at all, so you go through it with a hand on the wall. The wall is dry. Halfway along, a gauge is set into the stone at chest height with a brass cover on a hinge, and the cover is open, and the needle behind it is steady. Somebody has chalked the date beside it. The far end is a grey rectangle of daylight with water noise underneath it.',
  },
  [`${GALLERY_X}_${WY0}`]: {
    name: 'The Turbine Hall', hall: true,
    desc: 'A long stone room built into the toe of the dam, and the loudest place for sixty miles: four horizontal wheels turning in cast housings, taking water off the dam and putting out shaft power along a line of overhead belting that goes out through the wall and into the rest of the works. Every housing has an inspection cover off and standing against it. There are no screens. There is a logbook on a lectern by the door with a pencil on a string, and the last entry is from this morning, and the handwriting is bad and the numbers are not.',
  },
  [`${CX - 1}_${WY0 + 1}`]: {
    name: 'The Bench', bench: true,
    desc: 'A long steel bench under a window, laid out for close work: a vice, a rack of files graded fine to coarse, an oil stone, a tray. Somebody is sitting at it with their sleeve rolled to the shoulder and their arm off at the elbow, and the arm is in the vice with the forearm plate open. They are cleaning a track in it with a bristle brush, without looking, the way you clean something you know. What they are talking to you about is the water rota, which they think is unfair, at length, with examples.',
  },
  [`${CX}_${CY}`]: {
    name: 'The Tally', hub: true,
    desc: 'The middle of the works: a swept yard with a roofed board at one end of it and benches along both sides. The board carries the week in chalk, ruled off in columns by somebody with a straight edge, and the columns are shaft duty, gauge duty, gate duty and stores. Every name has hours against it and every entry is initialled. People cross constantly on their way somewhere. Two of them look up, decide you are not carrying anything that needs a hand, and carry on.',
  },
  [`${CX + 1}_${CY}`]: {
    name: 'The Stores',
    desc: 'A long shed of racked steel shelving, and the most orderly room you have been in since you got here: fasteners by thread and length in labelled drawers, bar stock standing in bins by section, bearings boxed and dated, all of it on a card index in a cabinet by the door. Nothing is locked. A slate hangs on a nail by the exit with the last four things taken written on it, each with a name beside it, and one of them has been rubbed out and written back in with the quantity corrected.',
  },
  [`${CX - 1}_${CY}`]: {
    name: 'The Forge',
    desc: 'An open-fronted smithy with a hand-cranked blower on the hearth and a drop hammer worked off the overhead line shaft. Tongs on the wall in order of jaw. A quench trough with a skin on it. What comes out of here is made to be taken apart again: everything on the finished rack is pinned or bolted, and there is not one weld on any of it that could not be cut with a hacksaw by somebody standing where you are.',
  },
  [`${CX}_${CY - 1}`]: {
    name: 'The Winding Shop',
    desc: 'Benches down both walls and coils of enamelled wire on spindles overhead, feeding down to four winding jigs turned by hand. Two people are rewinding a motor between them, one counting turns out loud and the other writing the count on the casing in grease pencil. The old windings are in a bin, stripped out and kept, because the copper is the point. A board on the wall carries a hand-drawn winding table with corrections pencilled over the printing.',
  },
  [`${CX}_${CY + 1}`]: {
    name: 'The Standpipe',
    desc: 'The works\' water: a cast column with four taps round it and a stone trough beneath, fed off the tailrace through a sand bed you can see the top of. A tin cup hangs on a chain. The chain has been mended with wire, and the wire has been dressed flat so it will not catch a hand. Somebody has scratched a fill line inside the trough and everybody appears to respect it.',
  },
  [`${CX - 2}_${CY}`]: {
    name: 'The Sleepers',
    desc: 'A bunkhouse of two long rows, beds made, boots under, each locker with a name card in a brass frame and about half of them with something pinned beside the card: a photograph, a pressed flower, a drawing done by a child of a man with one arm longer than the other. A stove at each end. It smells of soap and cold iron. Nobody is in here at this hour and the floor has been swept this morning.',
  },
  [`${CX + 2}_${CY}`]: {
    name: 'The Surgery',
    desc: 'A boarded room with a scrubbed table, a rack of instruments laid out on cloth in order of size, and a hand-cranked drill on a stand with three bits beside it in a fold of leather. A chart of the arm is pinned to the wall, drawn by hand, annotated in two colours. On a shelf behind the table sit four finished limbs, plain steel and leather, each with its own maintenance card tied to the wrist by a loop of string.',
  },
  [`${CX - 2}_${CY - 1}`]: {
    name: 'The Schoolroom',
    desc: 'A dozen crates facing a slate, and on the wall above the slate a clock with the case off, so the escapement is out in the open and the whole class can watch it let go, and let go, and let go. The slate this morning carries long division, a diagram of a lever with the fulcrum in the wrong place and a correction beside it in a smaller hand, and, low down where a short person could reach, somebody\'s name written out thirty times, getting better.',
  },
  [`${CX + 2}_${CY + 1}`]: {
    name: 'The Long Table',
    desc: 'Trestles and boards under a run of roofing sheet, seating perhaps sixty at a push, with the benches worn pale in the places people sit. This is where the works eats when it eats together. A hatch at one end, a rota pinned beside it, and on the wall a framed sheet of paper too old to read from where you are standing, which somebody has dusted.',
  },
  [`${CX - 2}_${CY + 1}`]: {
    name: 'The Reckoning', creed: true,
    desc: 'A small room off the yard with one table, four chairs and every wall covered in working: figures, columns, distances, fuel loads, a route east across the whole width of the world drawn in a hand that has drawn it many times, and a running total at the bottom that has been rubbed out and replaced so often the plaster has gone thin there. It is all arithmetic. Not one word of it is an argument. Whoever does this comes in, works, and goes back to their shift, and the door is not locked, and nobody has ever needed it to be.',
  },
  [`${WX1}_${WY1}`]: {
    name: 'The Grey Yard',
    desc: 'Where the machines come to be taken apart properly: hulls opened along their seams and laid out flat, casings stacked by alloy, the frames dragged off in rows once they are empty. It is done methodically and it is done from one end. What is not in any of the stacks is the part that used to do the thinking, and there is a separate shelf for those, indoors, under a cloth.',
  },
};

// The quarters. Everything inside the works that is not a landmark gets fill from the quadrant it
// falls in, so the place has neighbourhoods without thirty more bespoke strings.
const QUARTERS = {
  shops: {
    names: ['The Shops', 'Belt Row', 'The Line', 'Shaft Row'],
    descs: [
      'Workshops open to the yard under the overhead line shaft, each one taking its power off the belting with a wooden clutch you throw by hand. A lathe, a shaper, a bench drill, all of them turning off the same water.',
      'A bay stacked with work in progress, each piece with a tag wired to it saying what is wrong and who found it.',
      'Somebody is teaching somebody else to grind a drill by hand, patiently, and it is clearly not the first attempt or the second.',
    ],
  },
  yards: {
    names: ['The Yards', 'Sorting Row', 'The Stacks', 'Plate Row'],
    descs: [
      'Sorted salvage in long rows, and sorted is the word that matters: plate by thickness, section by size, wire coiled by gauge, each row with a tally slate on the end post.',
      'A hardstanding of cracked concrete with a crane gantry over it, hand-geared, the winch handle chained to the frame so it cannot walk off.',
      'Drums of oil on their sides in a cradle, labelled, with a drip tray under the tap and sand in the tray.',
    ],
  },
  homes: {
    names: ['The Rows', 'Low Row', 'The Steps', 'Quarry Row'],
    descs: [
      'Dwellings in a terrace of poured stone, flat-roofed, each door a different colour and every one of them painted recently. Window boxes. A bicycle upside down on a step with its chain off.',
      'A narrow way between the rows with a drain down the middle of it and washing strung overhead. A cat has the warm end and is not sharing it.',
      'Front steps, swept. Somebody has set a row of tins along a sill with something green coming up in each one.',
    ],
  },
  water: {
    names: ['The Sluices', 'Tail Row', 'The Channels', 'Wet Row'],
    descs: [
      'Open channels of dressed stone carrying the tailwater away, with hand-wound penstock gates at every junction and a scale painted beside each gate.',
      'A settling basin with a rake leaning against it and the silt drawn up the bank in a neat grey ridge, drying.',
      'The sound of moving water off the tailrace, constant, and a walkway of plank and pipe over the top of it with a handrail on both sides.',
    ],
  },
};
const quarterAt = (x, y) => {
  const e = x >= CX, s = y >= CY;
  return e ? (s ? 'water' : 'yards') : (s ? 'homes' : 'shops');
};

// ── Outside the works ────────────────────────────────────────────────────────
const OUTSIDE = {
  [`${ROADHEAD[0]}_${ROADHEAD[1]}`]: { name: 'The Roadhead', depot: true,
    desc: 'Where the track in from the northeast stops pretending to be a road: a graded turning circle, a fuel tank up on a stand with a hand pump and a gauge glass, and a plate shack with a stove pipe. A board by the door lists distances, in a column, in feet and miles, all of them correct. Somebody has left a full can of water on the step with a tin over the top of it, and it is obvious from the ring in the dust that it lives there.' },
  [`${EASTERN_RUTS[0]}_${EASTERN_RUTS[1]}`]: { name: 'The Eastern Ruts', ruts: true,
    desc: 'The eastern way in, which is two wheel ruts and a great deal of optimism, running off across the flat toward country that eventually turns to scrub. A cairn stands at the region line with a rail driven into it and a plate wired to the rail, and the plate has a distance stamped into it and an arrow, and both are right.' },
  '769_961': { name: 'The Head of the Water', shore: true,
    desc: 'The top of the reservoir, where whatever feeds it comes in: a stone-lined cut, a trash screen raked clean, and a gauge board bolted to the rock with the water standing at a mark somebody has ringed in white paint. The water arrives without a sound worth mentioning and stops moving immediately.' },
  '760_972': { name: 'The Spillway', spill: true,
    desc: 'The west shoulder of the dam, where the overflow goes when there is overflow: a broad stone chute stepped down the outside face, dry today, swept, with a scour line up both walls showing how high it has run and a date cut into the stone beside the highest one. There is a handrail. It has been repainted.' },
  '778_972': { name: 'The Gauge House', gaugehouse: true,
    desc: 'A stone hut on the east shoulder, one room, one window, one chair. A float on a wire goes down through a pipe in the floor to the water and up to a drum of paper on the wall, and a pen on an arm draws the level across the paper as the drum turns, driven by a weight on a cord that somebody winds every day. There are years of these charts rolled and labelled on a shelf. The pen has ink in it.' },
};

function main() {
  for (const d of ['zones', 'power_zones', 'regions', 'connections']) {
    const p = join(ROOT, 'content', d);
    if (!existsSync(p)) mkdirSync(p, { recursive: true });
  }

  let zones = 0, damTiles = 0, lake = 0, authored = 0;

  for (let x = X0; x <= X1; x++) {
    for (let y = Y0; y <= Y1; y++) {
      const me = id(x, y);
      const key = `${x}_${y}`;
      const works = WORKS[key];
      const out = OUTSIDE[key];
      const mass = isDamMass(x, y);
      const water = inLake(x, y) || inTailrace(x, y);

      // EXITS. Reciprocal orthogonal links to every neighbour inside the region box. The only thing
      // that breaks the grid is the body of the dam.
      //
      // A dam-mass tile carries no exits and nothing links INTO one. That is not sufficient by
      // itself — derive.mjs projects an edge between any two adjacent tiles on the same map, so
      // every one of those non-links has to be un-said by a blocked connection file below.
      const exits = {};
      if (!mass) {
        const link = (dx, dy, dir) => {
          const nx = x + dx, ny = y + dy;
          if (nx < X0 || nx > X1 || ny < Y0 || ny > Y1) return;
          if (isDamMass(nx, ny)) return;                     // never walk into the dam
          exits[dir] = id(nx, ny);
        };
        link(0, -1, 'north'); link(0, 1, 'south'); link(1, 0, 'east'); link(-1, 0, 'west');
      }

      // FLAGS. The region ships as flat canvas to be painted by hand later. A building footprint is
      // the one place terrain must NOT be set — painted terrain on a building tile suppresses its
      // map code. content:lint catches it; it is easy to re-add by reflex.
      // Both the dam mass and the Turbine Hall carry a `building_type`, and NEITHER may be painted:
      // terrain on a building footprint suppresses its map code, which is how the Thornwarren wall
      // vanished off the map and the tablet the first time. content:lint catches it.
      const built = mass || works?.hall === true;
      const flags = { region_id: REGION };
      // ASH OUTSIDE, GRAVEL INSIDE THE WORKS, and that split is not decoration: it is rule 4 in
      // terrain. The open region is burnt grey waste nobody tends. The works platform is graded
      // hardstanding these people laid and go on maintaining, so the ground changes underfoot at
      // exactly the line where somebody started looking after it. Two coherent zones, which is not
      // the same thing as scattering terrain about — inside each one it stays a flat canvas for the
      // Studio. `ash` also carries its OWN flight biome rather than falling into generic badlands
      // (plugins/flight/biomes.js:35), so the region reads distinct from the air for free.
      //
      // THE LANDFORM PASS sits UNDER that split and never crosses it: the works platform is still
      // graded gravel, the roads are still dirt_road, and the ash/gravel line still falls exactly
      // where somebody started looking after the ground. Outside it, the flat sheet of ash has
      // become volcanic country, because the water is hot and something has to be putting the heat
      // in. See LANDFORM_OFF, which is the one place those exemptions are written down.
      const lf = built ? 'ash' : landformAt(x, y);
      const land = LANDFORM[lf] || null;
      if (!built) {
        flags.terrain = onRoad(x, y) ? 'dirt_road'
          : inWorks(x, y) ? 'gravel'
            : TERRAIN_OF[lf];
      }

      // THE ION-STORM SHADOW. Stamped on all 4,836 tiles now and consumed later by the jamming
      // work: the EMP handler will skip a player standing on one of these. Cheap to stamp here,
      // expensive to backfill. Nothing in this file says a word about it out loud.
      flags.emp_shadow = true;

      if (mass) {
        // SOLID, BUT NOT A LANDMARK. See the note on DAM_Y above: `building_type` only, so the dam
        // stops a truck without claiming nineteen two-letter map codes.
        Object.assign(flags, { building_type: 'ruins', floors: 1 });
        damTiles++;
      }
      // The Turbine Hall is mass you can WALK INTO: `building_type` makes it solid to a vehicle
      // (groundObstructionAt reads it) while the exits above still admit a person. No `is_building`,
      // so no interior map and no marker — in Phase 1 it is a room, not a building with a door.
      if (works?.hall) Object.assign(flags, { building_type: 'power', floors: 2 });

      if (out?.depot) { flags.truck_depot = { name: 'The Roadhead' }; flags.truck_fuel = true; }
      // No law out on the grade. The works keeps its own order, and keeps it very well.
      if (!inWorks(x, y)) flags.lawless = true;
      else flags.no_spawn = true;
      // The open grade is worth working over. The lake, the works, the dam and every authored
      // set-piece are not: a loot table on the Gauge House would have people searching a chair.
      // A cliff face is added to that list: nobody can stand on one, so a loot table there is a
      // table no player will ever roll on, and anything spawned would be spawned out of reach.
      if (!inWorks(x, y) && !water && !built && !works && !out && lf !== 'cliff') {
        flags.scavenging_table_id = 'scav_industrial_salvage';
      }
      if (lf === 'cliff') flags.no_spawn = true;
      if (water) lake++;

      const q = inWorks(x, y) && !works ? QUARTERS[quarterAt(x, y)] : null;
      const name = works?.name || out?.name
        || (mass ? 'The Dam' : q ? pick(q.names, x, y)
          : water ? (inTailrace(x, y) ? 'The Tailrace' : 'The Deadwater')
            : land ? pick(land.names, x, y)
              : pick(TILE_NAMES, x, y));

      const description = works?.desc || out?.desc || (mass ? DAM_DESC : q ? pick(q.descs, x, y)
        : inTailrace(x, y)
          ? 'The channel the water leaves by, running south in a cut of dressed stone with a plank walk along one side of it. It moves fast here and it is the only thing in the region in a hurry.'
          : water
            ? 'Still water, and a great deal of it, and it is warm. The surface holds the sky without altering it in any way and gives off steam in slow sheets that lean away downwind and come apart about head height. It smells of minerals and old eggs. Nothing about it moves unless something makes it move, and whatever is heating it is a long way underneath.'
            : land
              ? pick(land.descs, x, y)
            : dist(x, y, [CX, CY]) < 18
              ? 'Packed ash, and it holds a print the way nothing else does: the flat is crossed with tracks, most of them feet and one set of wheels, all going the same two ways, and none of them washed out. Off north a grey wall goes across the whole horizon with water standing behind it.'
              : 'Grey ash to the horizon, level and going nowhere in particular. Nothing grows in it worth the word and nothing has for a long time. There is a great deal of sky, and the quiet out here is not the absence of noise, it is the absence of anything that would make one.');

      // The landform's own beats come FIRST and the region's follow, so a flow top still gets the
      // survey pegs and the grey ash underfoot. A tile is somewhere in Deadwater before it is a
      // lava field. Water and the ground within sight of it keep the shore pool whole.
      const ambient = mass ? []
        : inWorks(x, y) ? AMBIENT_WORKS
          : (water || dist(x, y, [LAKE_CX, LAKE_CY]) < 8) ? AMBIENT_WATER
            : land ? [...land.ambient, ...AMBIENT_WASTE.slice(0, 4)]
              : AMBIENT_WASTE;

      if (works || out) authored++;

      // PRESERVE THE MARKER. A building tile ships with the two-letter map code it will derive, and
      // that code can only be chosen by something that sees every building in the world at once
      // (assignBuildingMarkers), which this script cannot. So the codes are baked in by an export
      // after the first derive (see the header) and carried forward here.
      let marker = null;
      try { marker = JSON.parse(readFileSync(zonePath(me), 'utf8')).marker ?? null; } catch { /* new tile */ }

      write(zonePath(me), {
        ambient_events: ambient, ambient_theme: 'wasteland', description, exits, flags,
        grid_x: x, grid_y: y, grid_z: 0, id: me, map_id: 'map_world',
        ...(marker ? { marker } : {}),
        name, parent_zone: null,
      });

      // POWER: A ROW PER TILE WITH NO GENERATOR, WHICH IS THE WHOLE POINT.
      //
      // `simulatePowerNetwork` Phase 6 sweeps `zonesByGen.get('__orphan__')` and writes `offline`
      // every cycle, so an orphan row is permanently and authoritatively dark, and no dev-panel
      // action can accidentally light it.
      //
      // The row must EXIST. A MISSING row is read as unpowered by getZonePowerStatus, lights,
      // warmth and synthesis, but as POWERED by plugins/atm/index.js and as LIVE by
      // plugins/broadcast/index.js — so leaving the rows out would have given a deliberately dark
      // region working cash machines. There is deliberately NO `content/generators/` row for this
      // region either: the Scarletwastes has one, and this region not having one is its argument
      // made in schema rather than in prose.
      write(powerPath(me), {
        capacity_kw: 0, flags: {}, generator_id: null,
        id: me, max_capacity_kw: 0, name, source_type: 'city_grid',
      });
      zones++;
    }
  }

  // ── The dam the geometry cannot un-say ─────────────────────────────────────
  // derive.mjs projects an edge between any two orthogonally adjacent tiles on the same map. The
  // open grade needs none of these (every neighbour is a real link), so this runs ONLY over the dam
  // line and one tile of margin. Without it the derive pass invents exits straight through eighty
  // feet of poured stone.
  //
  // One file per PAIR, deterministically named so a re-run overwrites rather than accumulates.
  //
  // AND SWEPT FIRST, which the Scarletwastes build does not do and got away with only because its
  // wall never moved. Overwriting is not enough: when the dam's shoulders stopped being mass, the
  // blocked files written for them on the previous run stayed on disk, and a stale `blocked: true`
  // beside a live authored exit is a lint failure at best and a wall across a doorway at worst.
  // Deleting our own prefix and rewriting is the only re-runnable shape.
  const connDir = join(ROOT, 'content', 'connections');
  let swept = 0;
  for (const f of readdirSync(connDir)) {
    if (!f.startsWith('conn_dw_')) continue;
    unlinkSync(join(connDir, f));
    swept++;
  }

  let blocked = 0;
  const declared = (x, y, dir, to) => {
    try { return JSON.parse(readFileSync(zonePath(id(x, y)), 'utf8')).exits?.[dir] === to; }
    catch { return false; }
  };
  const OPP = { north: 'south', south: 'north', east: 'west', west: 'east' };
  for (let x = DX0 - 1; x <= DX1 + 1; x++) {
    for (let y = DAM_Y - 1; y <= DAM_Y + 1; y++) {
      if (x < X0 || x > X1 || y < Y0 || y > Y1) continue;
      for (const [dx, dy, dir] of [[1, 0, 'east'], [0, 1, 'south']]) {   // each pair once
        const nx = x + dx, ny = y + dy;
        if (nx > X1 || ny > Y1 || nx > DX1 + 1 || ny > DAM_Y + 1) continue;
        const a = id(x, y), b = id(nx, ny);
        if (declared(x, y, dir, b) || declared(nx, ny, OPP[dir], a)) continue;   // a real link
        const cid = `conn_dw_${x}_${y}_${dir}`;
        write(join(ROOT, 'content', 'connections', `${cid}.json`),
          { a, b, blocked: true, dir, id: cid, lockable: false, one_way: false });
        blocked++;
      }
    }
  }

  write(join(ROOT, 'content', 'regions', `${REGION}.json`), {
    // temp/dryness only. `effectiveBias` recognises exactly temp, dryness and acid, and Deadwater
    // is deliberately NOT the acid region: cold and dry, not corrosive. Adding a fourth key here
    // would do nothing at all. See docs/systems-weather-extreme.md.
    base_terrain: 'ash',
    climate_bias: { dryness: 0.5, temp: 4 },
    defaults: {}, grid_z: 0, id: REGION, name: 'Deadwater',
  });

  console.log(`deadwater: wrote ${zones} zones + ${zones} power_zones (all orphan/offline), 1 region`);
  console.log(`  box       x${X0}-${X1} y${Y0}-${Y1}  (${X1 - X0 + 1}x${Y1 - Y0 + 1})`);
  console.log(`  works     x${WX0}-${WX1} y${WY0}-${WY1}`);
  console.log(`  dam       y${DAM_Y} x${DX0}-${DX1}  (${damTiles} mass tiles, 1 gallery at x${GALLERY_X})`);
  console.log(`  water     ${lake} tiles (reservoir + tailrace)`);
  console.log(`  authored  ${authored} hand-written tiles`);
  console.log(`  blocked   ${blocked} connection file(s) (swept ${swept} stale)`);
  console.log(`  roadhead  ${id(ROADHEAD[0], ROADHEAD[1])}   ruts ${id(EASTERN_RUTS[0], EASTERN_RUTS[1])}`);
}

main();
