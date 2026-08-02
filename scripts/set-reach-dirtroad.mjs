// SUPERSEDED 2026-08-02 — DO NOT RE-RUN.
// Set Buzzard Field surface/theme; those are now the `surface`/`theme` columns.
// Airfield config moved off zone flags into the `airfields` table; edit the row in
// content/airfields/<id>.json (or the DB) instead. Kept as the record of the change.
// One-shot data transform: apply The Reach's dirt-strip flags to rows that already
// shipped. The CODEX import is additive (ON CONFLICT DO NOTHING) and can't update
// existing rows, so this backfills the flags the modified content files carry:
//   - the 4 runway centreline tiles get flags.terrain='dirt_road' (packed-dirt track)
//   - Buzzard Field's ramp tile gets airfield_surface='dust' + airfield_theme='wastes'
//     (so the departure/approach backdrop and apron both render as graded dirt).
// Idempotent — safe to re-run; unaffected by a concurrent additive import.
//   Local: node scripts/set-reach-dirtroad.mjs
//   Prod:  node --env-file=.env.prod scripts/set-reach-dirtroad.mjs
import { query } from '../server/models/db.js';

const RUNWAY_IDS = [
  'zone_the_reach_869_1955', 'zone_the_reach_869_1956',
  'zone_the_reach_869_1957', 'zone_the_reach_869_1958',
];
const FIELD_ID = 'zone_the_reach_870_1958';

const rw = await query(
  `UPDATE zones
      SET flags = jsonb_set(COALESCE(flags, '{}'::jsonb), '{terrain}', '"dirt_road"'::jsonb)
    WHERE id = ANY($1)
    RETURNING id, flags->>'terrain' AS terrain, flags->>'runway' AS runway`,
  [RUNWAY_IDS]);
console.log(`Runway tiles updated: ${rw.rowCount}`);
for (const row of rw.rows) console.log(`  ${row.id}  terrain=${row.terrain}  runway=${row.runway}`);

const fld = await query(
  `UPDATE zones
      SET flags = flags
        || '{"airfield_surface":"dust"}'::jsonb
        || '{"airfield_theme":"wastes"}'::jsonb
    WHERE id = $1
    RETURNING id, flags->>'airfield_surface' AS surface, flags->>'airfield_theme' AS theme`,
  [FIELD_ID]);
console.log(`Field tile updated: ${fld.rowCount}`);
for (const row of fld.rows) console.log(`  ${row.id}  surface=${row.surface}  theme=${row.theme}`);

process.exit(0);
