// ONE-SHOT: put streetlights on Halcyon Fields.
//
//   node scripts/content/light-halcyon-fields.mjs [--dry-run]
//
// The quarter shipped with 64 road tiles across eight streets, every one of them already
// carrying a `power_zones` row, and NOT ONE streetlight — so the newest neighbourhood in
// Coldwater was also the only lit district in the city that went dark at dusk. Compare
// `commercial`, which is 18 road tiles and 18 lamps.
//
// ⚠ WINDROW LANE IS DELIBERATELY UNLIT. It is the perimeter service road behind the
// Kerbstone Row frontage, and a quarter four hundred people short of being occupied has
// not got round to lighting the back lane yet. That is 18 of the 64 tiles; the junction
// at 899,918 (`Kettle Lane + Windrow Lane`) IS lit, because Kettle Lane is a through
// street and the junction belongs to it. 64 − 18 = 46.
//
// ⚠ THE LAMPS DO NOT NEED SWITCHING ON AND MUST NOT BE GIVEN `light_on`. It is an
// export-excluded runtime column, so an authored value would be dropped on import anyway —
// but unlike an interior fixture a streetlight is genuinely self-healing: `syncStreetlights`
// in server/engine/environment.js reconciles every `light_type: 'streetlight'` row against
// its zone's power status and LOCAL ambient visibility on the 30-second and 30-minute ticks.
// So these light themselves at dusk, and under a passing storm cell, with no seed-runtime
// step. (An interior fixture is the opposite case — see reference_authored_lights_import_off.)
//
// ⚠ THE DESCRIPTION IS NOT THE ONE THE OTHER 82 SHARE. Every streetlight in the game to
// date reads "a row of city-grid streetlights on cracked poles", which is the old grid.
// Halcyon Fields is a developer's estate that went up in one campaign and its columns are
// new — the district's whole read is that it is unfinished rather than worn out.
//
// Load: 46 × 5 kW = 230 kW onto a City Power Plant carrying 2,265 kW of 10,000.

import { loadContentStore } from '../../tools/lib/content-store.mjs';

const dryRun = process.argv.includes('--dry-run');
const store = loadContentStore();

const DISTRICT = 'halcyon_fields';
// The one street that stays dark. Matched on the zone's NAME, not its coordinates, so a
// re-run after the lane is extended picks the new tiles up without editing this file.
const UNLIT_STREET = 'Windrow Lane';

const DESCRIPTION =
  'Tall aluminium columns at a developer\'s even spacing, batch stickers still on the poles. ' +
  'No switch out here; they come on by themselves once it gets dark.';

const roads = store.all('zones').filter(z =>
  z.map_id === 'map_world' &&
  z.grid_z === 0 &&
  z.flags?.district === DISTRICT &&
  /road/.test(z.flags?.terrain || ''));

let lit = 0, skipped = 0, already = 0;
for (const z of roads.sort((a, b) => a.grid_y - b.grid_y || a.grid_x - b.grid_x)) {
  if (z.name === UNLIT_STREET) { skipped++; continue; }
  const id = `furniture_streetlight_${z.id}`;
  if (store.get('furniture', id)) { already++; continue; }
  store.put('furniture', {
    description: DESCRIPTION,
    flags: {},
    hp: null,
    hp_max: null,
    id,
    light_type: 'streetlight',
    lumen_output: 6000,
    name: 'street lights',
    object_type: 'light',
    power_draw_kw: 5,
    price: 200,
    zone_id: z.id,
  });
  lit++;
}

// Every one of these tiles already has a power_zones row — assert it rather than assume it,
// because a lamp on an unpowered tile is a lamp that never comes on and says nothing about why.
const unpowered = roads.filter(z => z.name !== UNLIT_STREET && !store.get('power_zones', z.id));
if (unpowered.length) {
  console.error(`REFUSING: ${unpowered.length} road tile(s) have no power_zones row:`);
  for (const z of unpowered) console.error(`  ${z.grid_x},${z.grid_y} ${z.name}`);
  process.exit(1);
}

const written = store.flush({ dryRun });
console.log(`${dryRun ? 'would write' : 'wrote'} ${written.length} file(s)`);
console.log(`  lit      ${lit} tile(s)`);
console.log(`  already  ${already}`);
console.log(`  unlit    ${skipped} (${UNLIT_STREET}, by design)`);
console.log(`  load     ${lit * 5} kW added`);
