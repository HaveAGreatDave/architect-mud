// Build THE SCARLETWASTES — the badlands region southeast of Coldwater, and the Wildblood's town.
//
// A one-shot content generator. It writes files under `content/` and touches no database: git is the
// source of truth, so this emits the tree and `npm run content:import` loads it. Re-runnable — it
// overwrites its own output and nothing else.
//
// See docs/proposals/scarletwastes.md for the design. Two things this file is built around:
//
// 1. THE GROUND IS A FIELD, NOT A SPRINKLE. The region originally shipped as one flat sheet of
//    `redrock` to be hand-painted in the Studio later. It never was, and 4,836 identical tiles is
//    not a canvas, it is a colour. The landform is now DERIVED, from one continuous height surface,
//    so mesas carry their own scree skirts and scrub grows in the low ground that holds the runoff.
//    If you change it, change the surface. Do not scatter terrain per tile: a tile that disagrees
//    with its neighbour by accident is the failure the original brief was guarding against.
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

// ── LANDFORM ─────────────────────────────────────────────────────────────────
// The region shipped as one flat sheet of `redrock` so it could be painted by hand in the Studio.
// It never was, and 4,836 identical tiles is not a canvas, it is a colour. So the landform is
// derived here instead, and the rule that replaces "paint it later" is:
//
//   THE GROUND IS A FIELD, NOT A SPRINKLE. Every terrain here comes out of one continuous height
//   surface, so mesas have skirts, scrub grows in the low ground that holds what little water there
//   is, and the lake sits in the bottom of a basin. Nothing is scattered per tile. A tile never
//   disagrees with its neighbour by accident, which is the failure mode of a random scatter and the
//   reason the brief said not to do one.
//
// Deterministic value noise: a hash lattice sampled with a smoothstep, so a rebuild produces the
// identical map and no diff. No RNG anywhere in this file, on purpose.
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
  return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
}
// Two octaves. One is too smooth to read as broken country; three costs nothing and buys nothing.
const fbm = (x, y, scale, salt) => noise(x, y, scale, salt) * 0.68 + noise(x, y, scale / 2.7, salt + 91) * 0.32;

// ── THE SLAKE ────────────────────────────────────────────────────────────────
// The lake, west of the town, in the floor of the region's one real basin.
//
// It is the town's water source and it is NOT the town's pride. The Sweetwater takes rain off the
// roofs and that is the thing Sill Moraine built and the thing the Thornwarren boasts about. The
// Slake is what you fall back on in a dry month: hauled by cart, tipped into the same limestone and
// bone beds, tested in the same glass tubes. That ordering matters. A town with a lake at the door
// does not need to invent the best filtration for sixty miles, and the filtration is the argument.
//
// So the lake is authored as WORK: a wagon track, a hard standing, a jetty, a queue.
const LAKE = [1030, 978];
const LAKE_RX = 5.4, LAKE_RY = 4.1;
// Wobbled ellipse. The wobble is what stops it reading as a stamped oval from the air.
function lakeField(x, y) {
  const dx = (x - LAKE[0]) / LAKE_RX, dy = (y - LAKE[1]) / LAKE_RY;
  const r = Math.hypot(dx, dy);
  return r - (fbm(x, y, 5, 7) - 0.5) * 0.42;
}
const isLake = (x, y) => lakeField(x, y) < 1;
// The shore band is narrow on purpose. The field is an ELLIPSE metric, so a generous band is much
// wider in x than in y and puts cart ground against the thorn wall six tiles from any water.
const isShore = (x, y) => !isLake(x, y) && lakeField(x, y) < 1.2;

// THE WATER ROAD. Cart ruts from the shore round the outside of the wall to the Sally Gate, because
// the wall has two gaps in it and neither of them is on the lake side. Authored as an explicit tile
// list rather than derived: a route that bends around a town is a decision somebody made with a
// loaded cart, and a pathfinder would have found a different, worse one.
const WATER_ROAD = new Set();
// It stops at the waterline. The westmost tile is the hard standing you back a cart onto, and the
// tile west of THAT is open water: a road drawn one tile further is a road in the lake.
for (let y = 978; y <= 986; y++) WATER_ROAD.add(`1036_${y}`);
for (let x = 1036; x <= 1046; x++) WATER_ROAD.add(`${x}_986`);
WATER_ROAD.add('1046_985');

// The landform for any tile outside the town box and outside the authored set. Returns a family
// key; TERRAIN_OF maps it to a `flags.terrain` value, and the name/desc/ambient tables key off it.
//
// The height surface is one call. Everything else is a threshold on it, which is what makes the
// bands contiguous: a mesa always has a skirt of its own scree, never a cliff straight to hardpan.
// The caprock threshold, named because three things read it and a fourth would drift.
const MESA_H = 0.635;
// HIGH GROUND, asked the same way by everything that asks.
//
// Not `fbm > MESA_H` on its own: a tile the landform pass never gets to decide is not high
// ground, whatever the height field says about it. The town box and the authored set are
// flat by exemption, and so is anything the lake or the road already claimed. Ask the
// height field alone and the rim test believes the massif continues into the Thornwarren,
// declines to draw a face there, and the tableland runs into the thorn wall with no drop
// between them — a step you can see from the air and cannot explain.
const isMesa = (x, y) => x >= X0 && x <= X1 && y >= Y0 && y <= Y1
  && !inTown(x, y) && !OUTSIDE[`${x}_${y}`]
  && !isLake(x, y) && !isShore(x, y) && !WATER_ROAD.has(`${x}_${y}`)
  && fbm(x, y, 11, 3) > MESA_H;

// THE RIM IS A CLIFF, AND THE GAPS IN IT ARE THE POINT.
//
// A mesa tile with a lower neighbour is the edge of the tableland, and the edge of a
// tableland is a face you do not walk up. That single rule turns 943 loose high tiles
// into walled massifs: the impassable `cliff` terrain draws itself as one continuous
// escarpment (the piece set faces outward, see derive's autoTileName), and crossing
// the region becomes a question of where the ways through are.
//
// The ways through come from a SECOND CONTINUOUS FIELD, not a per-tile roll. That is
// the whole difference between a pass and a hole: noise above a threshold clusters, so
// a gap is two or three tiles of walkable ramp in a row that you can see from a
// distance and aim for. A hash per rim tile would scatter single-tile pinholes around
// every massif, and a wall with a door every fifth stone funnels nobody.
const isPass = (x, y) => fbm(x, y, 4.5, 77) > 0.70;

function landformAt(x, y) {
  if (WATER_ROAD.has(`${x}_${y}`)) return 'haul';
  if (isLake(x, y)) return 'lake';
  if (isShore(x, y)) return 'shore';
  const h = fbm(x, y, 11, 3);
  if (h > MESA_H) {
    const rim = !isMesa(x, y - 1) || !isMesa(x, y + 1) || !isMesa(x + 1, y) || !isMesa(x - 1, y);
    if (rim) return (isPass(x, y) || forcedRamps().has(`${x}_${y}`)) ? 'ramp' : 'cliff';
    return 'mesa';                     // caprock. flat on top, and the top is a long way up.
  }
  if (h > 0.575) return 'scree';       // the skirt of broken rock a mesa sheds
  // Scrub takes the low ground, because the low ground is where the runoff goes and stays.
  const wet = fbm(x, y, 7, 23) + (0.5 - h) * 0.55;
  if (wet > 0.635) return 'scrub';
  if (h < 0.36 && fbm(x, y, 6, 41) > 0.55) return 'pan';   // dry lake floor, the flattest thing here
  return 'flat';
}
// `mesa` is `plateau` and `cliff` is its rim: one landform, two terrains, because the top
// is walked and the rim is not. Together they raise a merged massif in the flight sim and
// the rim draws its own outline on the map, both off the same adjacency.
// EVERY MASSIF GETS A WAY UP, and this is the pass that guarantees it rather than hoping.
//
// The pass field is continuous and the mesas are not, so a small massif can easily fall
// entirely in low-pass country and come out sealed: a tableland with no route onto it, and
// no way for a player to tell it apart from one that has a notch they have not found. That
// is the worst of both — the funnel stops being readable, because "there is no way up here"
// stops implying "so there is one somewhere else".
//
// So: flood the high ground into massifs, and any massif with no ramp has its most
// pass-like rim tile promoted to one. Deterministic (the field decides which tile, not a
// counter or an iteration order), and it runs once at module load over 4,836 tiles.
//
// LAZY, and that is not a style choice: it walks `isMesa`, which reads the authored OUTSIDE
// table declared further down this file. Evaluated at module load it would hit that table in
// its temporal dead zone. Computed on first ask (from main), everything it needs exists.
let _forcedRamps = null;
const forcedRamps = () => (_forcedRamps ??= computeForcedRamps());
function computeForcedRamps() {
  const forced = new Set();
  const key = (x, y) => `${x}_${y}`;
  const high = isMesa;
  const seen = new Set();
  for (let x = X0; x <= X1; x++) {
    for (let y = Y0; y <= Y1; y++) {
      if (!high(x, y) || seen.has(key(x, y))) continue;
      // One massif: flood it, remembering its rim and whether anything in it is already a pass.
      const stack = [[x, y]], rim = [];
      let hasPass = false;
      seen.add(key(x, y));
      while (stack.length) {
        const [cx, cy] = stack.pop();
        const edge = !high(cx, cy - 1) || !high(cx, cy + 1) || !high(cx + 1, cy) || !high(cx - 1, cy);
        if (edge) { rim.push([cx, cy]); if (isPass(cx, cy)) hasPass = true; }
        for (const [nx, ny] of [[cx, cy - 1], [cx, cy + 1], [cx + 1, cy], [cx - 1, cy]]) {
          if (!high(nx, ny) || seen.has(key(nx, ny))) continue;
          seen.add(key(nx, ny));
          stack.push([nx, ny]);
        }
      }
      // A one-tile massif is a stack of rock, not a tableland. It has no inside to reach,
      // so it needs no way up and gets none: forcing a ramp there would carve a notch into
      // a boulder to reach its own outer edge.
      if (hasPass || rim.length <= 1) continue;
      const best = rim.reduce((a, b) => (isPass(b[0], b[1]) || fbm(b[0], b[1], 4.5, 77) > fbm(a[0], a[1], 4.5, 77) ? b : a));
      forced.add(key(best[0], best[1]));
    }
  }
  return forced;
}

const TERRAIN_OF = {
  lake: 'water', shore: 'dirt', haul: 'dirt_road', mesa: 'plateau', cliff: 'cliff',
  ramp: 'gravel', scree: 'gravel', scrub: 'scrub', pan: 'sand', flat: 'redrock',
};

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

// ── The landform, in words ───────────────────────────────────────────────────
// One entry per family from landformAt. `flat` is deliberately absent: it falls through to the
// original waste prose, so the country the region shipped with is still the country you cross most
// of, and the mesas and the scrub are the exceptions that make it read as distance.
//
// The lake gets no lyricism about being a relief. It is a working water source in a bad place and
// the people who use it treat it as a chore, which is the same thing the masks and the rota do.
const LANDFORM = {
  mesa: {
    names: ['The High Table', 'Caprock', 'The Standing Bench', 'Red Mesa', 'The Long Shelf'],
    descs: [
      'The top of a mesa, flat as a floor and red as an old brick, with the whole region laid out under it in bands of colour going away to nothing. The caprock rings under a boot. At the edge the ground simply stops and the drop is a long one, and the wind comes up it hard enough to lean on.',
      'Bare table rock, scoured clean, cut across by shallow channels the rain has worn and then worn deeper. Nothing grows up here at all. There is a cairn on the high point that somebody built a long time ago and nobody has knocked over.',
      'A shelf of red stone standing a hundred feet clear of the flats, its face banded in every shade the country has, laid down and then eaten back until only this much was left. From up here the dark line of the thorn is visible a long way off and reads as exactly what it is.',
    ],
    ambient: [
      'A bird goes over below you, which takes a moment to make sense of.',
      'The wind comes up the face of the drop in one long push and then drops away to nothing.',
      'A stone goes off the edge. You do not hear it land.',
      'Heat coming off the caprock in a shimmer, so the horizon detaches and floats a hand above the ground.',
      'Rain marks up here too, a thousand pale rings, on rock nothing has stood on in years.',
    ],
  },
  cliff: {
    names: ['The Red Wall', 'The Rimrock', 'The Escarpment', 'The Drop', 'Sheer'],
    descs: [
      'The rock goes up in one piece, banded red on red, too high to see the top of from underneath and too sheer to argue with. It runs away in both directions along the same line and does not offer anything that could be called a way up.',
      'A wall of caprock standing out of the flats, undercut at the base where the weather has got in and eaten the softer bed away, so the top overhangs slightly and the shade under it is deep and cold.',
      'The face of the tableland: a hundred feet of banded rock with nothing on it but the marks of the rain, and a fan of fallen stone piled at the foot where pieces of it have given up over the years.',
    ],
    ambient: [
      'A slab lets go somewhere along the face, a long way off, and the sound arrives well after it.',
      'Birds are nesting in the undercut, a whole colony of them, and they are not interested in you.',
      'The shadow of the wall lies out across the flats, cold, with a hard edge on it.',
      'You follow the foot of it for a while looking for a break, and there is not one here.',
    ],
  },
  ramp: {
    names: ['The Notch', 'The Way Up', 'The Break', 'Broken Stair'],
    descs: [
      'A break in the wall, and the only one for a long way: a ramp of fallen rock wedged into a notch in the face, steep and loose but climbable, going up into a cut that turns out of sight. Everything that crosses this country crosses it here, and the ground says so.',
      'Where the escarpment has failed, a whole section of it come down at once a long time ago and never cleared, making a ragged stair up to the tableland. Tracks come in from both sides and converge on it: feet, dogs, cart wheels, all of them funnelled to the one gap.',
    ],
    ambient: [
      'Every track in this country comes together here and goes up. There is no other way through for miles.',
      'Somebody has stacked a cairn at the foot of the notch, and somebody else has added to it.',
      'Loose rock underfoot the whole way up, and worn smooth in a line down the middle where the traffic goes.',
      'A pair of hounds sit at the top of the ramp, watching who comes through, and do not move.',
    ],
  },
  scree: {
    names: ['The Skirt', 'Talus', 'The Spill', 'Broken Foot', 'The Slide'],
    descs: [
      'The skirt of a mesa, a long slope of broken rock shed off the face above over a very long time, everything from fist-sized to the size of a truck. Nothing here is stable. Everything you put a foot on shifts a little and then decides not to.',
      'A fan of scree run out from a notch in the cliff above, sorted by nothing but weight: the big pieces at the bottom, the grit at the top, and a channel down the middle of it where the water goes when there is water.',
      'Loose ground at the foot of the wall of rock, walking on it a matter of picking the flat pieces. There are bones down among the stones and there is no telling how they got there or from how high.',
    ],
    ambient: [
      'Something shifts underfoot and a run of small stones goes down the slope ahead of you.',
      'A slab the size of a door lies where it landed, and it has not been there long enough to weather.',
      'The face above is banded like something cut through, and every band is a different red.',
      'Grit rattles down out of the notch above with no wind to explain it.',
    ],
  },
  scrub: {
    names: ['The Grey Thicket', 'Scrub Bench', 'The Bristle', 'Low Growth', 'The Grabbing Ground'],
    descs: [
      'Scrubland, and after a day of bare rock the colour of it is a shock: grey-green thorn to knee height in every direction, growing out of ground that is more grit than soil. It is not soft country. Every plant in it is armed, and the pale rings of the rain sit on the leaves as burn scars.',
      'Low thicket over a shallow pan where whatever rain falls runs to and stays a while. The scrub grows thickest along the channels and you can read the drainage off it from any small rise, like a map somebody drew in a hurry.',
      'Chest-high brush, tough as wire, with runs beaten through it at knee height by something that lives here and goes the same way every day. The wind through it makes a dry sound with no rest in it at all.',
    ],
    ambient: [
      'The scrub moves in a line off to your right, tracking you, and then stops when you stop.',
      'A thorn takes hold of a sleeve and does not let go until it is asked to properly.',
      'Something small and quick goes down a run in the brush and the whole thicket ticks with it.',
      'Seed pods, acid-pitted and rattling, hundreds of them, all at once and then not.',
      'A patch of the scrub is dead and bleached white in a ring about ten feet across. Nothing has grown back into it.',
    ],
  },
  pan: {
    names: ['The White Pan', 'Saltground', 'The Dry Bed', 'Bleach Flat'],
    descs: [
      'The floor of a lake that stopped being a lake a long time ago: pale silt baked into plates and curled at every edge, going away flat for a quarter of a mile. Your boots leave the first marks in it since the last rain. There is a crust of something white along the low side and it is not salt.',
      'A dry bed of fine pale sand and cracked mud, the flattest ground in the region and the emptiest. In the middle of it, absolutely alone, stands one dead tree with everything sanded off it but the trunk.',
    ],
    ambient: [
      'A dust devil stands up out on the pan, walks a hundred yards, and lies down again.',
      'The mud plates crack under a boot with a sound like biscuit.',
      'Your own tracks, going away behind you, the only marks on the whole flat.',
      'The white crust on the low ground is furred like frost and the day is far too hot for that.',
    ],
  },
  shore: {
    names: ['The Slake Shore', 'The Hard Standing', 'Cart Ground', 'The Draw'],
    descs: [
      'The margin of the lake, and the ground here is packed hard and rutted deep by cart wheels going down and coming back heavier. Barrels stacked and chained. A tide line of pale crust where the water has stood at higher marks, each old line a wetter year than this one.',
      'Sloped ground running down to water, graded by hand at some point and kept graded, with stone laid into the worst of it so a loaded axle does not sit down. Reeds at the edge, thin and grey, and a great many bootprints between them all pointing the same two ways.',
    ],
    ambient: [
      'A cart comes up off the shore with four barrels roped on and two people leaning into it, and neither of them is talking.',
      'Water slaps the stone once and then goes back to doing nothing.',
      'Empty barrels stacked in threes, every one of them numbered in the same hand as the drums in the town.',
      'A dog drinks at the margin, stops, looks out across the water for a while, and goes back to drinking.',
    ],
  },
  lake: {
    names: ['The Slake'],
    descs: [
      'Open water, a red-brown sheet of it lying in the bottom of the basin with the rock going up all round in steps. It is not clean and it does not pretend to be: a scum of pale crust rings the whole margin and the deep of it is the colour of stewed tea. It is also the only standing water for sixty miles that has anything alive in it, which is why there are ruts coming down to it from the east.',
    ],
    ambient: [
      'The surface takes the light flat and red and gives nothing back.',
      'Something moves out in the deep water and the rings come in slowly and go on coming for a long time.',
      'A skin of pale crust rocks against the margin and breaks up and re-forms.',
      'The wind comes across the water and arrives at you tasting of iron.',
    ],
  },
  haul: {
    names: ['The Water Road'],
    descs: [
      'Cart ruts, cut deep and kept, running between the lake and the town the long way round the outside of the thorn. The two sets of wheel marks are not the same depth: the ones going east are the loaded ones. Somebody has laid broken plate into the soft stretches and pegged it down, and somebody replaces a peg now and again.',
    ],
    ambient: [
      'Ruts either side of you, deep enough to turn an ankle in, worn by the same wheels going the same way for years.',
      'A barrel hoop lies in the ditch, rusted through, and somebody has scratched a tally into the plate beside it.',
      'A water cart comes the other way, empty, moving fast, and the two hauling it lift a hand without slowing.',
      'A spill line of dark ground runs along the rut for thirty yards and stops. Somebody had a bad day here.',
    ],
  },
};

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
    desc: 'A smaller gap in the thorn, one leaf, barred from the inside with a length of axle. This is the water gate in everything but name: the cart ruts come up to it deep and go away west round the outside of the wall, and there is a stack of empty barrels against the thorn waiting on the next run down to the Slake. Somebody has wedged a child\'s boot in the frame at head height, laces knotted, which is either a warning or a joke and is very obviously the second one.',
  },
  [`${CX}_${CY}`]: {
    name: 'The Commons', hub: true,
    desc: 'The middle of the town: a swept oval of packed ground with a long fire trench down the centre of it and cook pots on chains over the coals. Benches, most of them mended. A board on a post carries the week in chalk, and the week is water duty, roof duty, gate duty and, in a different hand and underlined twice, WHOEVER IS TAKING THE GOOD KNIFE PUT IT BACK. People come through constantly on their way to somewhere else. Almost nobody looks at you for longer than it takes to decide you are not carrying anything heavy.',
  },
  [`${CX}_${CY - 1}`]: {
    name: 'The Sweetwater', landmark: true,
    desc: 'The reason the town is here, and the best-made thing for sixty miles. Rain comes off every roof in the Thornwarren down channelled gutters into a stepped run of settling tanks, through three beds of crushed limestone and burnt bone, and comes out the far end into a covered cistern sweet enough to drink. The stonework is old and the ironwork is not, and both are immaculate. A test bench by the outflow holds a rack of little glass tubes and a chart, and the chart has been filled in twice a day, in different hands, for a very long time. There is a second inlet at the top of the run, wider, plated, built to take a barrel tipped straight into it, and the board above it reads SLAKE WATER: BOTH BEDS, TWICE. In a dry month the whole town drinks the lake, and it drinks it through this.',
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
  const tally = {};

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
      // LANDFORM. Authored tiles (the trophy road, the Pool, the strip, the roadhead, the hide, the
      // stripping ground) and everything in the town box keep the flat red ground they were written
      // on: those are set-pieces whose prose names the surface underfoot, and a mesa top under the
      // Screaming Line would contradict the sentence above it. Everywhere else gets the field.
      const lf = (inTown(x, y) || town || out) ? 'flat' : landformAt(x, y);
      const land = LANDFORM[lf] || null;
      if (!inTown(x, y)) tally[lf] = (tally[lf] || 0) + 1;
      const flags = { region_id: REGION, radiation: radAt(x, y), terrain: TERRAIN_OF[lf] };
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
      // The lake is the drinking source. The rad gradient out here bottoms at 9 on distance alone,
      // and a town that hauls its dry-month water out of a 9 is a town poisoning itself slowly,
      // which is the one thing the Thornwarren is written never to do. So the basin is a second
      // hole in the curve, for the same reason the town is the first one.
      // Keyed off the BASIN, not the family, so the hard standing at the waterline is not a step of
      // sixteen points from the water it is standing in.
      if (!inTown(x, y) && lakeField(x, y) < 1.2) flags.radiation = 4;
      if (out?.depot) { flags.truck_depot = { name: 'The Roadhead' }; flags.truck_fuel = true; }
      if (out?.strip) flags.airfield_id = 'scarlet_strip';
      // The wilds have no law out here, and the town enforces its own inside the thorn.
      if (!inside(x, y)) flags.lawless = true;
      // Scavenging: the open waste is worth working over. The town and its burial ground are not.
      // Nothing is scavenged off open water, and nothing is scavenged off a rock face
      // nobody can stand on. A cliff tile spawns nothing for the same reason: the move
      // gate means no player will ever meet what is standing there.
      if (!inTown(x, y) && lf !== 'lake' && lf !== 'cliff') flags.scavenging_table_id = 'scav_irradiated_salvage';
      if (lf === 'cliff') flags.no_spawn = true;
      if (inTown(x, y)) flags.no_spawn = true;

      const q = inside(x, y) ? QUARTERS[quarterAt(x, y)] : null;
      const name = town?.name || out?.name
        || (isWallMass ? 'The Thorn Wall' : q ? pick(q.names, x, y)
          : land ? pick(land.names, x, y) : pick(TILE_NAMES, x, y));

      const onRoad = y >= 963 && y <= 967 && x === NORTH_GATE[0];
      // The Pool's corruption band beats the landform: within six tiles of it the ground itself is
      // the set-piece, and it is the same wrong ground whatever shape the country is in.
      const description = town?.desc || out?.desc || (isWallMass ? WALL_DESC : q ? pick(q.descs, x, y)
        : dist(x, y, POOL) < 6
          ? 'Red rock, and the rock here is wrong: banded through with a colour that is not mineral, and warm to the back of the hand from a foot away. Nothing grows. The few bones lying about have gone the same colour as the ground.'
          : land
            ? pick(land.descs, x, y)
          : dist(x, y, [CX, CY]) < 14
            ? 'Open red country, and something has been through it: the ground is cut with a great many tracks, most of them feet, some of them dogs, all of them heading the same two ways. Off south the horizon has a dark line across it that does not behave like a ridge.'
            : 'Red rock to the horizon in every direction, pitted all over with pale rings a hair deep where the rain has stood and eaten. The wind never entirely stops. There is a great deal of sky and none of it is reassuring.');

      // The landform's own beats, then the region's, so a mesa top still gets the walking weather and
      // the ticking rock. A shore is a place in the Scarletwastes before it is a shore.
      const ambient = isWallMass ? [] : inside(x, y) ? AMBIENT_TOWN : onRoad ? AMBIENT_ROAD
        : land ? [...land.ambient, ...AMBIENT_WASTE.slice(0, 4)] : AMBIENT_WASTE;

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
  console.log(`  box        x${X0}-${X1} y${Y0}-${Y1}  (${X1 - X0 + 1}x${Y1 - Y0 + 1})`);
  console.log(`  landform   ${Object.entries(tally).sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${n}`).join(', ')}`);
  console.log(`  thornwarren x${TX0}-${TX1} y${TY0}-${TY1}  (${wallTiles} wall tiles, 2 gates)`);
  console.log(`  authored   ${authored} hand-written tiles`);
  console.log(`  walls      ${walls} blocked connection file(s)`);
}

main();
