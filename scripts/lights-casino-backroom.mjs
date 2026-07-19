// One-shot: switch ON the Neon Vig back-room light.
//
// The back room's power_zones row + light fixture (furn_light_zone_casino_backroom)
// ship through the CODEX content pipeline (git). But `light_on` / `light_on_intended`
// and the `lighting_states` roll-up are runtime, export-excluded columns, so the
// additive insert lands the fixture at the DB default (off) → the room reads dark.
// This flips it on and rebuilds the room's lighting_states, matching the floor.
// (Same pattern as scripts/lights-media-civic.mjs / lights-solenne.mjs.)
//
//   local:  node scripts/lights-casino-backroom.mjs
//   prod:   node --env-file=.env.prod scripts/lights-casino-backroom.mjs   (once, after deploy)
import { query } from '../server/models/db.js';

const ZONE = 'zone_casino_backroom';

const r = await query(
  `UPDATE furniture SET light_on = 1, light_on_intended = 1
   WHERE object_type = 'light' AND zone_id = $1`,
  [ZONE],
);

// Rebuild the room's lighting roll-up from its now-on fixtures (same query the
// engine's lighting sync uses), so the room reads lit without waiting on a tick.
await query(
  `INSERT INTO lighting_states (zone_id, has_emergency_lighting, artificial_light_level, fixture_count, total_lumens)
   SELECT $1, 0, 0,
          COUNT(*)::int,
          COALESCE(SUM(CASE WHEN light_on = 1 THEN COALESCE(lumen_output, 0) ELSE 0 END), 0)::int
   FROM furniture WHERE zone_id = $1 AND object_type = 'light'
   ON CONFLICT (zone_id) DO UPDATE
     SET fixture_count = EXCLUDED.fixture_count, total_lumens = EXCLUDED.total_lumens`,
  [ZONE],
);

console.log(`Lit ${r.rowCount} fixture(s) in ${ZONE} and rebuilt its lighting_states.`);
process.exit(0);
