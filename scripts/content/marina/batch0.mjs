/**
 * FAIRWEATHER MARINA, batch 0 — the ground.
 *
 *   node scripts/content/marina/batch0.mjs [--dry-run]
 *
 * The west shore has no road on it. `sitecheck.mjs` passes exactly one tile in this
 * whole corner (894,903, off the head of Halcyon Boulevard) and fails every other
 * candidate with "no standable road neighbour (nowhere to put the door)" — so the
 * quay has to be laid before anything can front onto it. Same order Old Coldwater
 * was built in, and for the same reason.
 *
 * What this lays:
 *
 *   892-894,903   HALCYON QUAY — esplanade, terrain `road`, carrying the boulevard
 *                 down to the water. This is what the Conservatory's door opens onto.
 *   894,902       PONTOON A — a walkable deck standing over the inlet.
 *   894,901       PONTOON B — the outer deck, reaching north into the Basin.
 *   892,902       THE HARDSTANDING — open-air boat park, the cheap half of the yard.
 *
 * ⚠ THE PONTOONS ARE `building_type` AND NOT `is_building`. A facade is not standable
 * and leaves the walk graph; `building_type` alone renders a model and joins the CFIT
 * sweep while staying a tile you walk on. That is exactly the shape the central pier
 * at 909,901-904 already uses, and it is copied from it rather than re-derived.
 *
 * ⚠ 897,901 (Basin Jetty) AND 897,898 (the Echelon's mooring) ARE NOT TOUCHED. The
 * jetty's `flags.pier` is what `plugins/yacht/index.js` docks her gangway to, and two
 * zones already share 897,898.
 *
 * District is `glasshouse`, not `docks`. The docks signature is "brine and diesel and
 * rotting rope", which is the wrong quarter entirely — this is the Ascendants' own
 * waterfront and it reads the way the rest of their ground reads.
 *
 * Idempotent: every id derives from its tile, so a re-run is an upsert.
 */
import { loadContentStore } from '../../../tools/lib/content-store.mjs';

const DRY = process.argv.includes('--dry-run');
const store = loadContentStore();

const GH = 'glasshouse';
const tile = (x, y) => `zone_district_${x}_${y}`;
const OPPOSITE = { north: 'south', south: 'north', east: 'west', west: 'east' };

// Re-dress a tile that already exists. Flags MERGE — the region, the fishing table and
// anything else another system put there stays put.
function dress(x, y, { name, description, ambient, color, bg, flags, marker }) {
  const id = tile(x, y);
  const prev = store.get('zones', id);
  if (!prev) throw new Error(`no tile at ${x},${y} — this build re-dresses, it does not grow the map`);
  store.patch('zones', id, {
    name, description,
    ambient_theme: 'coast',
    ambient_events: ambient,
    color, ...(bg ? { bg_color: bg } : {}),
    ...(marker ? { marker } : {}),
    flags: { ...(prev.flags || {}), district: GH, region_id: 'region_coldwater', ...flags },
  });
  return id;
}

// A reciprocal pair, both directions.
//
// ⚠ NO `connections` ROW. The rule that "every exit needs one" is about links geometry
// cannot see — an interior, a stair, a facade seam. These are grid-adjacent tiles on one
// map, which `projectEdges` already projects from the coordinates (and `facadeBlocks`
// already understands), which is why not one of the 17,497 zone files around here has a
// connection row for its ordinary neighbours. Minting them anyway is a second statement
// of the same edge.
function link(ax, ay, bx, by, dir) {
  const a = tile(ax, ay), b = tile(bx, by);
  const za = store.get('zones', a), zb = store.get('zones', b);
  store.patch('zones', a, { exits: { ...(za.exits || {}), [dir]: b } });
  store.patch('zones', b, { exits: { ...(zb.exits || {}), [OPPOSITE[dir]]: a } });
}

// ── 1. THE QUAY ──────────────────────────────────────────────────────────────
//
// `terrain: road` is load-bearing rather than cosmetic: `authorBuilding`'s `streetFor`
// refuses an entrance whose neighbour is not a road, and the auto-tiler will not run
// the boulevard down to the water without it.

dress(894, 903, {
  name: 'Halcyon Quay',
  color: '#cfd8de',
  description: 'The boulevard stops being a boulevard here and becomes a quay, without anything marking where one ends and the other starts. Pale slabs laid dead flat, a kerb of the same stone, and a rail of brushed steel along the water with a gap in it where the pontoon goes down. Everything is very clean and very empty. A lit glass plinth stands where a harbourmaster would stand if there were one.',
  ambient: [
    'Water moves under the pontoon and comes back up against the stone.',
    'The rail is cold enough to take the skin off your palm and is polished anyway.',
    'A gull lands on the plinth, finds nothing, and leaves.',
    'Somewhere behind you a climate curtain sighs across a doorway.',
  ],
  flags: { terrain: 'road', street_life: true, fishing_table_id: 'fish_coldwater_bay' },
});

dress(893, 903, {
  name: 'Halcyon Quay',
  color: '#cfd8de',
  description: 'The quay runs west along the back of the marina, one slab wide and swept. On the water side the Conservatory stands over it with its flank in glass, lit from inside whatever the hour. On the land side there is a strip of gravel raked into lines, which somebody comes and rakes again.',
  ambient: [
    'Light comes through the Conservatory flank and lies across the slabs in bars.',
    'The gravel has been raked since this morning. Nobody saw it done.',
    'Water slaps once against something out of sight and stops.',
  ],
  flags: { terrain: 'road', street_life: true },
});

dress(892, 903, {
  name: 'Halcyon Quay',
  color: '#c6ced4',
  description: 'The west end of the quay, where the stone stops and the ground goes back to salt and rubble. The Curtain stands up out of the flats a little way off, and the gun nest on the rise above has its barrel pointed out over the water rather than down at you. Between the two, the hardstanding: a fenced apron of concrete with hulls up on cradles under covers.',
  ambient: [
    'A cover lifts on a hull up on its cradle, drops back, and lies still.',
    'The gun on the rise traverses a few degrees and settles again.',
    'Grit comes off the flats and goes across the clean stone in a thin line.',
  ],
  flags: { terrain: 'road', street_life: true },
});

// ── 2. THE HARDSTANDING ──────────────────────────────────────────────────────
//
// The cheap half of the yard and the outdoor counterpart to the Conservatory: a hull
// out here is parked, not preserved. No building — concrete, a fence and cradles, which
// is a place rather than a structure.

dress(892, 902, {
  name: 'The Hardstanding',
  color: '#b9c0c4',
  description: 'An apron of concrete behind a mesh fence, marked out in bays with paint that is still the colour it was mixed. Six cradles, four of them holding hulls under fitted covers with the owner\'s name on a tag at the bow. The covers are immaculate. Two of the tags have gone brittle enough to read as old.',
  ambient: [
    'Wind gets under a cover, lifts it the length of a hull, and lets it down.',
    'A tag turns on its wire and turns back.',
    'The fence hums once in the wind and stops.',
  ],
  flags: { terrain: 'concrete', street_life: true },
});

// ── 3. THE PONTOONS ──────────────────────────────────────────────────────────
//
// Water tiles you stand on. The four flags that make that true are `pier`, `liquid:
// false`, `swimmable: false` and `routable` — lifted wholesale off the central pier
// rather than reasoned out again, because getting one of them wrong gives you either a
// deck you swim through or open water you can walk across.
//
// `marina_berths` is the count the boatyard reads, and it is the ONLY marina flag: a
// tile with berths on it IS a marina pontoon, so a companion `marina: true` would be a
// second statement of the same fact and a second thing to keep in step.

dress(894, 902, {
  name: 'Fairweather Marina',
  color: '#bcd7e4',
  marker: '⚓',
  description: 'The inner pontoon, a deck of pale composite grating that gives very slightly underfoot and is the only thing here that admits the water is moving. Cleats and power points alternate down both sides, each bay numbered into the deck in a typeface that is not shouting. The Conservatory stands over the west side with its doors on the water. To the north the pontoon runs on out into the Basin.',
  ambient: [
    'The deck takes the swell and hands it back a second later, half as much.',
    'A power point wakes up as you pass it, decides against it, and goes dark.',
    'Water works its way along under the grating, all the way down and back.',
    'The number cut into the deck at your feet is 4. There is no 13.',
  ],
  flags: {
    terrain: 'water',
    building_type: 'pontoon',
    entrance: 'south',
    floors: 1,
    pier: true,
    liquid: false,
    swimmable: false,
    routable: true,
    street_life: true,
    fishing_table_id: 'fish_coldwater_bay',
    marina_berths: 6,
  },
});

dress(894, 901, {
  name: 'Fairweather Marina',
  color: '#a9ccdd',
  description: 'The outer pontoon, past the shelter of the inlet, where the deck starts to work under you properly. The far end is a steel ladder and a life ring in a bracket, both of them new. From out here the Glasshouse is a wall of lit glass to the south and the Echelon lies off to the east, black and enormous and not moored to anything of ours.',
  ambient: [
    'The whole run lifts, travels, and sets down again a beat late.',
    'A halyard somewhere hits a mast twice and then stops, which is somebody\'s job.',
    'The life ring turns in its bracket. Nobody has ever taken it down.',
    'Out east the Echelon shows one white light and nothing else.',
  ],
  flags: {
    terrain: 'water',
    building_type: 'pontoon',
    entrance: 'south',
    floors: 1,
    pier: true,
    liquid: false,
    swimmable: false,
    routable: true,
    street_life: true,
    fishing_table_id: 'fish_coldwater_bay',
    marina_berths: 4,
  },
});

// ── 4. THE WALK ──────────────────────────────────────────────────────────────
//
// Halcyon Boulevard -> the quay -> the pontoons.

link(894, 904, 894, 903, 'north');   // up off the boulevard
link(894, 903, 893, 903, 'west');    // along the quay
link(893, 903, 892, 903, 'west');
link(892, 903, 892, 902, 'north');   // out onto the hardstanding
link(894, 903, 894, 902, 'north');   // down onto the inner pontoon
link(894, 902, 894, 901, 'north');   // and out along it

// ── 5. THE PLINTH ────────────────────────────────────────────────────────────
//
// The berth board. An Ascendant marina has no harbourmaster, which is the joke and also
// the reason this is a fixture rather than an NPC: the machine takes your money and the
// absence is the point.

store.patch('furniture', 'furn_marina_plinth', {
  id: 'furn_marina_plinth',
  zone_id: tile(894, 903),
  name: 'the berth plinth',
  description: 'A slab of frosted glass standing waist high off the stone, lit from somewhere inside it so evenly that it throws no shadow at all. The face carries the berth list, the rate and a slot for a hand. It does not have a keyboard and it does not appear to want one.',
  object_type: 'fixture',
  light_type: 'lamp',
  light_on: 1,
  light_on_intended: 1,
  power_draw_kw: 0.04,
  lumen_output: 600,
  flags: {
    aliases: ['plinth', 'board', 'berth board', 'glass'],
    marina_plinth: true,
    interactions: {
      examine: 'FAIRWEATHER MARINA — MOORINGS BY ARRANGEMENT. Ten berths. The rate is set out underneath in a smaller size, and it is not small money. Below that, in smaller type again: NO ATTENDANT IS PROVIDED. THE MARINA IS NOT RESPONSIBLE FOR WHAT IS LEFT ABOARD.',
    },
  },
});

const written = store.flush({ dryRun: DRY });
console.log(`${DRY ? 'DRY RUN — ' : ''}${written.length} file(s) ${DRY ? 'would be written' : 'written'}`);
for (const p of written) console.log('  ' + p.replace(process.cwd() + '\\', '').replace(process.cwd() + '/', ''));
