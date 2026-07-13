// One-shot data transform: set Halcyon Towers' storey count so the flight-sim skyline
// raises it as a supertower that spears through the realistic cloud deck.
//
// The `floors` flag ships in the content JSON (source of truth), but content:import is
// additive (ON CONFLICT DO NOTHING) and never rewrites an existing row — so prod's already-
// present Halcyon row won't pick up the new flag on deploy. This backfills it directly.
//
//   Prod:  node --env-file=.env.prod scripts/set-halcyon-floors.mjs
//   Local: node scripts/set-halcyon-floors.mjs
//
// After running against prod, re-bake the open-rig snapshot so it reflects the taller tower:
//   node --env-file=.env.prod scripts/snapshot-flight-world.mjs

import { query } from '../server/models/db.js';

const ZONE = 'zone_district_895_906';   // Halcyon Towers exterior tile
const FLOORS = 60;

const r = await query(
  `UPDATE zones
      SET flags = jsonb_set(coalesce(flags, '{}'::jsonb), '{floors}', $2::jsonb)
    WHERE id = $1
    RETURNING id, name, flags->>'floors' AS floors`,
  [ZONE, String(FLOORS)],
);

if (!r.rows.length) {
  console.error(`✗ no zone ${ZONE} — nothing updated`);
  process.exit(1);
}
console.log(`✓ ${r.rows[0].name} (${r.rows[0].id}) → floors ${r.rows[0].floors}`);
process.exit(0);
