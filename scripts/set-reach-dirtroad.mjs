// One-shot data transform: set flags.terrain='dirt_road' on The Reach's runway
// centreline tiles so the strip renders as a packed-dirt track. The CODEX import is
// additive (ON CONFLICT DO NOTHING) and can't update existing rows, so this backfills
// the flag onto rows that already shipped. Idempotent.
//   Local: node scripts/set-reach-dirtroad.mjs
//   Prod:  node --env-file=.env.prod scripts/set-reach-dirtroad.mjs
import { query } from '../server/models/db.js';

const ids = [
  'zone_the_reach_869_1955', 'zone_the_reach_869_1956',
  'zone_the_reach_869_1957', 'zone_the_reach_869_1958',
];
const r = await query(
  `UPDATE zones
      SET flags = jsonb_set(COALESCE(flags, '{}'::jsonb), '{terrain}', '"dirt_road"'::jsonb)
    WHERE id = ANY($1)
    RETURNING id, flags->>'terrain' AS terrain, flags->>'runway' AS runway`,
  [ids]);
console.log(`Updated ${r.rowCount} runway tile(s):`);
for (const row of r.rows) console.log(`  ${row.id}  terrain=${row.terrain}  runway=${row.runway}`);
process.exit(0);
