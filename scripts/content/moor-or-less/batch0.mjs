/**
 * MOOR OR LESS, batch 0: the ground. A cheap boatyard at the north end of Ironside Street.
 *
 *   node scripts/content/moor-or-less/batch0.mjs [--dry-run]
 *
 * Fairweather Marina on the west shore is the Ascendants' and priced like it. This is the other end
 * of the city's waterfront: the docks district, between the Guardian Battery and the Load of Old
 * Rope wharf, four blocks from the shed Keel built a boat in for years. He has a yard on the water
 * now (batch1), and this lays what it stands on.
 *
 *   919,901   IRONSIDE HARD: the end of Ironside Street, concrete running down into the water.
 *   920,901   IRONSIDE HARD: the same concrete, with cradles on it. Keel's door opens onto it.
 *   919,900   THE INNER STAGE: a landing stage on oil drums, three berths.
 *   919,899   THE OUTER STAGE: the same, two berths and a fuel pump at the end.
 *
 * ⚠ BOTH HARD TILES ARE `terrain: road`. `authorBuilding`'s `streetFor` refuses an entrance whose
 * neighbour is not a road, and 920,901 is the only side of Keel's plot that is not water or another
 * building. The cradles on it are `boat_hardstanding`, which the renderer dresses with crates and
 * drums on its own (state.js `prp`).
 *
 * ⚠ A LANDING STAGE IS `building_type` AND NOT `is_building`, for the reason a pontoon is (see
 * docs/proposals/fairweather-marina.md §3): a facade leaves the walk graph. The four flags that make
 * a water tile standable (`pier`, `liquid: false`, `swimmable: false`, `routable`) are copied from the
 * Fairweather pontoons rather than worked out again.
 *
 * ⚠ `yard_rate: 0.6` IS THE POINT OF THE PLACE. plugins/powerboat/yard.js prices every berth and
 * every job against the Ascendant list, and this flag takes forty per cent off it here. It goes on
 * every zone the yard lets, so whichever one the player is standing in quotes the same rate.
 *
 * Idempotent: every id derives from its tile, so a re-run is an upsert.
 */
import { loadContentStore } from '../../../tools/lib/content-store.mjs';

const DRY = process.argv.includes('--dry-run');
const store = loadContentStore();

const DOCKS = 'docks';
const RATE = 0.6;
const tile = (x, y) => `zone_district_${x}_${y}`;
const OPPOSITE = { north: 'south', south: 'north', east: 'west', west: 'east' };

// Re-dress a tile that already exists. Flags MERGE, so the region and anything another system put
// there stays put.
function dress(x, y, { name, description, ambient, color, flags, drop = [] }) {
  const id = tile(x, y);
  const prev = store.get('zones', id);
  if (!prev) throw new Error(`no tile at ${x},${y}: this build re-dresses, it does not grow the map`);
  const merged = { ...(prev.flags || {}), district: DOCKS, region_id: 'region_coldwater', ...flags };
  for (const k of drop) delete merged[k];
  store.patch('zones', id, {
    name, description,
    ambient_theme: 'coast',
    ambient_events: ambient,
    color,
    flags: merged,
  });
  return id;
}

// A reciprocal pair. No `connections` row: grid neighbours on one map are projected from their
// coordinates (see the same note in marina/batch0.mjs).
function link(ax, ay, bx, by, dir) {
  const a = tile(ax, ay), b = tile(bx, by);
  const za = store.get('zones', a), zb = store.get('zones', b);
  store.patch('zones', a, { exits: { ...(za.exits || {}), [dir]: b } });
  store.patch('zones', b, { exits: { ...(zb.exits || {}), [OPPOSITE[dir]]: a } });
}

// ── 1. THE HARD ──────────────────────────────────────────────────────────────

dress(919, 901, {
  name: 'Ironside Hard',
  color: '#8a8478',
  description: 'Ironside Street ends in a concrete slipway that runs straight down into the Basin, green with weed below the tide line. A landing stage on oil drums goes out north from the top of it. West, the Guardian Battery\'s gun sits behind its sandbags. East, a timber boat shed stands on the hard with its doors open to the water.',
  ambient: [
    'The landing stage knocks against its piles and settles.',
    'Somebody\'s bilge pump kicks in out on the stage, coughs water over the side and stops.',
    'A gull walks down the slipway into the water and swims off without seeming to decide to.',
    'Diesel on the water makes a rainbow round the foot of the slip.',
  ],
  flags: { terrain: 'road', street_life: true, fishing_table_id: 'fish_coldwater_bay' },
});

dress(920, 901, {
  name: 'Ironside Hard',
  color: '#857f72',
  // ⚠ FIVE CRADLES AND THREE TO LET. The two with hulls on are other people's and are scenery; the
  // capacity is what the yard can actually let (Fairweather's rule, §3 of its proposal).
  description: 'The concrete hard in front of Keel\'s shed, cracked and patched with tar. Five cradles welded from scaffold pole stand along it. Two hold hulls under tarpaulins weighted with tyres; the other three are empty and chocked. Oil drums, coils of rope and a pallet of breeze blocks fill the gaps.',
  ambient: [
    'A tarpaulin cracks in the wind and settles back over its hull.',
    'Water drips off a keel onto the concrete, one drop at a time.',
    'From inside the shed: a mallet, three blows, a pause, three more.',
  ],
  flags: { terrain: 'road', street_life: true, boat_hardstanding: 3, yard_rate: RATE },
  // It was grass. The scavenging table was the grassland's, and the hard is somebody's yard now.
  drop: ['scavenging_table_id'],
});

// ── 2. THE LANDING STAGES ───────────────────────────────────────────────────
//
// Timber decking on lashed oil drums. The renderer's `landing_stage` arm (glass/models/waterfront.js)
// is the cheap relative of Fairweather's pontoon: the same freeboard and the same finger berths, built
// out of what the docks had lying about.

const STAGE = {
  terrain: 'water',
  building_type: 'landing_stage',
  entrance: 'south',
  floors: 1,
  pier: true,
  liquid: false,
  swimmable: false,
  routable: true,
  street_life: true,
  fishing_table_id: 'fish_coldwater_bay',
  yard_rate: RATE,
};

dress(919, 900, {
  name: 'Moor or Less: The Inner Stage',
  color: '#7a6e5c',
  description: 'A landing stage of timber decking on lashed oil drums, going out from the top of the slip. It moves when you step on it. Three berths along it, marked in house paint on the planks, with old tyres hung over the side for fenders and a cleat bolted down beside each number.',
  ambient: [
    'The drums under the deck boom as a swell runs through them.',
    'A tyre fender squeaks against the planks and goes quiet.',
    'Somebody has written BERTH 2 FOR SALE on the plank in chalk. It has been scuffed out.',
    'The Yards Tenement\'s windows light the water behind you one at a time.',
  ],
  flags: { ...STAGE, marina_berths: 3 },
});

dress(919, 899, {
  name: 'Moor or Less: The Outer Stage',
  color: '#6f6554',
  description: 'The outer end of the landing stage, out past the shelter of the hard, where the deck works under you properly. Two berths, and at the very end a hand pump on a fuel drum with a hose coiled on a nail. A life ring hangs on a post, faded to pink.',
  ambient: [
    'The whole stage lifts on a swell and drops a beat behind it.',
    'The hose swings on its nail and taps the drum.',
    'Out on the Basin a tug sounds once, a long way off.',
    'The life ring turns on its post in the wind.',
  ],
  flags: { ...STAGE, marina_berths: 2, boat_fuel: true },
});

// ── 3. THE WALK ─────────────────────────────────────────────────────────────
//
// Ironside Street already runs north onto 919,901 and the hard already joins 920,901. What is new is
// the way out onto the water.

link(919, 901, 919, 900, 'north');   // down the slip onto the inner stage
link(919, 900, 919, 899, 'north');   // and out along it

const written = store.flush({ dryRun: DRY });
console.log(`${DRY ? 'DRY RUN: ' : ''}${written.length} file(s) ${DRY ? 'would be written' : 'written'}`);
for (const p of written) console.log('  ' + p.replace(process.cwd() + '\\', '').replace(process.cwd() + '/', ''));
