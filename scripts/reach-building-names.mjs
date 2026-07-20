// One-shot: point each Reach facade's `flags.building_name` at its themed name so the
// flight-sim renderer routes to the bespoke NAMED_MODELS (buzzard/saloon/dynamo/layover)
// instead of the generic type default. See docs/reference/world-rendering.md.
//
// The zone `name` was already themed, but `flags.building_name` still held the generic
// placeholder ("Hangar", "Residence", …), which is what state.js reads into `bn`. The
// git content files now carry the themed flag too, but content:import is additive
// (ON CONFLICT DO NOTHING) and can't rewrite an existing row — hence this data transform.
// Idempotent: re-running just re-sets the same value. Run /world/reload (or restart) after.
//
//   local:  node scripts/reach-building-names.mjs
//   prod:   node --env-file=.env.prod scripts/reach-building-names.mjs
import 'dotenv/config';
import { query } from '../server/models/db.js';

const NAMES = {
  zone_the_reach_870_1958: 'Buzzard Field',
  zone_the_reach_872_1954: "The Coyote's Rest",
  zone_the_reach_871_1954: 'The Dynamo',
  zone_the_reach_873_1954: 'The Layover',
};

async function main() {
  for (const [id, name] of Object.entries(NAMES)) {
    const { rowCount } = await query(
      `UPDATE zones SET flags = jsonb_set(flags, '{building_name}', to_jsonb($2::text)) WHERE id = $1`,
      [id, name]);
    console.log(rowCount ? `  ✓ ${id} → "${name}"` : `  · ${id} not found (skipped)`);
  }
  console.log('Done. Run /world/reload (or restart the server) to see the models.');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
