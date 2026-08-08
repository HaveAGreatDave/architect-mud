// One-shot: relight every authored interior fixture that got LATCHED off.
//
// This is the general case the per-area `lights-*.mjs` clamps were each solving
// by hand, and the reason there keep being more of them.
//
// WHY IT HAPPENS. `light_on` / `light_on_intended` are runtime columns excluded
// from the content pipeline, so an additive CODEX import lands a new fixture at
// the DB default (off). `scripts/content/seed-runtime.mjs` exists to switch those
// on afterwards — but its gate is `light_on_intended IS NULL`, deliberately, so
// it can never stomp a switch a player actually threw.
//
// That gate is a RACE. If a live server takes a power tick before seed-runtime
// runs, the tick backfills `light_on_intended = COALESCE(intended, light_on) = 0`
// and the fixture is now indistinguishable from one somebody switched off on
// purpose. seed-runtime will skip it forever, and the room is dark for good.
// Bodega Vu lost both its rooms this way; the sweep found 18.
//
// WHY IT IS SAFE TO RUN. Scoped to fixtures where BOTH columns are 0 in a room
// where NOTHING is lit. A player who turns a light off in a room with two of them
// leaves the other on and is not touched. A shop lit by nothing at all is not a
// lighting decision anybody made — it is this bug.
//
// NOT a converging script: do NOT add it to oneshots.bat. Run it once, by hand,
// after a deploy that added interiors (same rule as the other clamps).
//   Local:  node scripts/lights-latched-off.mjs
//   Prod:   node --env-file=.env.prod scripts/lights-latched-off.mjs
import { query } from '../server/models/db.js';

const DRY = process.argv.includes('--dry');

// Rooms where every authored fixture is dark. GROUP BY + HAVING rather than a
// per-row test, because "somebody switched this one off" and "this room was
// never lit" are only distinguishable at the level of the ROOM.
const { rows: dark } = await query(`
  SELECT f.zone_id, z.name,
         count(*) FILTER (WHERE f.light_on = 1) AS lit,
         count(*) AS fixtures
    FROM furniture f
    LEFT JOIN zones z ON z.id = f.zone_id
   WHERE f.object_type = 'light'
     AND COALESCE(f.light_type, '') <> 'streetlight'
     AND COALESCE(f.lumen_output, 0) > 0
   GROUP BY f.zone_id, z.name
  HAVING count(*) FILTER (WHERE f.light_on = 1) = 0
     AND bool_and(COALESCE(f.light_on_intended, 0) = 0)
   ORDER BY z.name`);

if (!dark.length) { console.log('Nothing latched off. Every authored interior has a lit fixture.'); process.exit(0); }

console.log(`${dark.length} room(s) with no lit fixture:`);
for (const r of dark) console.log(`  ${String(r.fixtures).padStart(2)}x  ${r.name || r.zone_id}`);

if (DRY) { console.log('\n--dry: nothing written.'); process.exit(0); }

const zoneIds = dark.map(r => r.zone_id);
const { rowCount } = await query(
  `UPDATE furniture SET light_on = 1, light_on_intended = 1
    WHERE object_type = 'light'
      AND COALESCE(light_type, '') <> 'streetlight'
      AND COALESCE(lumen_output, 0) > 0
      AND zone_id = ANY($1)`,
  [zoneIds],
);
console.log(`\nLit ${rowCount} fixture(s) across ${zoneIds.length} room(s).`);
console.log('The running server re-reads furniture through its own cache funnel; /world/reload or a restart if they look stale.');
process.exit(0);
