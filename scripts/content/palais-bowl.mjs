/**
 * The Palais Bowl: an open-air theatre on the three tiles of Fisherman's Green behind the Coldwater
 * Palais, 908 to 910 on row 910.
 *
 *   node scripts/content/palais-bowl.mjs [--dry-run]
 *
 * ⚠ THE TILES STAY WALKABLE AND KEEP THEIR IDS. They were park; they're still outdoors, still
 * `terrain: park`, and keep every exit, so you walk in off Meltwater Row or up from the statue. A
 * `building_type` with no `is_building` and no `facade` is what gives GLASS something to draw
 * without taking the tile off the walk graph (docs/reference/world-rendering.md). The model is
 * client/game/js/panels/glass/models/palais-bowl.js, and the centre tile carries the map icon.
 *
 * The Palais's stage tile is already walled from 909,910 (conn_hf_district_909_909_south), so the
 * bowl's stage backs onto stone and nobody walks into the stage house. Prue Gantry still sleeps on
 * the middle tile.
 *
 * Idempotent: every id is fixed.
 */
import { loadContentStore } from './halcyon/lib.mjs';

const DRY = process.argv.includes('--dry-run');
const store = loadContentStore();
const NAME = 'The Palais Bowl';

// [zone, building_type, description, extra flags]
const TILES = [
  ['zone_district_908_910', 'palais_bowl_w',
    'The west end of the bowl: six stone tiers curving round toward the stage, worn smooth along the edges where people sit. An aisle cuts down through them to the floor. Past the top row the green carries on as if none of this were here.', {}],
  ['zone_district_909_910', 'palais_bowl',
    'A low stone stage against the back wall of the Palais, under a stone canopy on two piers, with the scene dock doors behind it. Tiers of stone benches rise away from it in a shallow bowl. On a warm night the Palais opens the dock doors and the band plays out here instead.', { icon: 'palais-bowl' }],
  ['zone_district_910_910', 'palais_bowl_e',
    'The east end of the bowl, six stone tiers stepping down toward the stage. The top row backs onto the green, and somebody has left a cushion on it, which is either optimism or a reservation.', {}],
];

for (const [id, type, description, extra] of TILES) {
  const z = store.get('zones', id);
  if (!z) throw new Error(`${id} does not exist`);
  const flags = { ...z.flags, building_type: type, building_name: NAME, entrance: 'north', floors: 1, ...extra };
  delete flags.park_feature;   // the park's own dressing; the bowl draws its own ground
  store.put('zones', { ...z, name: NAME, description, flags });
}

const furniture = (id, zone, name, aliases, interactions, description, object_type = 'furniture') => store.put('furniture', {
  description, flags: { aliases, interactions }, hp: null, hp_max: null, id, light_type: null, lumen_output: null,
  name, object_type, power_draw_kw: null, price: 0, zone_id: zone,
});
furniture('furn_bowl_tiers_w', 'zone_district_908_910', 'the tiers', 'tiers,tier,steps,benches,bench,seats,seat', ['examine', 'sit'],
  'Stone benches in six curved rows, each a step higher than the last. The edges are rounded off by sitting, and the aisle steps are cut into them at an angle.');
furniture('furn_bowl_tiers', 'zone_district_909_910', 'the front tier', 'tier,front tier,bench,benches,seat,seats,steps', ['examine', 'sit'],
  'The lowest row of the bowl, close enough to the stage to see the band\'s shoes. The stone is warm late into the evening.');
furniture('furn_bowl_tiers_e', 'zone_district_910_910', 'the tiers', 'tiers,tier,steps,benches,bench,seats,seat,cushion', ['examine', 'sit'],
  'Stone benches in six curved rows, stepping down to the stage. A flat red cushion sits on the top row with nobody on it.');
furniture('furn_bowl_stage', 'zone_district_909_910', 'the stage', 'stage,platform,canopy,boards,dock doors,doors', ['examine'],
  'A stone platform a step high with boards laid over it, scuffed pale where the band stands. Behind it the Palais\'s scene dock doors, iron, painted green, and a padlock that is only on when nothing is.',
  'decoration');

const written = store.flush({ dryRun: DRY });
console.log(`${DRY ? 'DRY RUN: ' : ''}${written.length} file(s)`);
for (const p of written) console.log('  ' + p);
