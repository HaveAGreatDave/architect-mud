// One-shot content: split the merged "Hotel / Bar" building_type into the two
// distinct categories, classifying each existing building automatically.
//   Run once:  node scripts/normalize-bar-hotel.js         (apply)
//              node scripts/normalize-bar-hotel.js --dry    (preview only)
//   Restart the server (or /world/reload) after — zone flags load into the world cache.
//
// Rule: a bar/hotel building HOUSES PEOPLE iff its interior map contains any
// is_apartment zone (rentable lodging units). Houses people -> 'hotel'; otherwise
// -> 'bar'. Scoped strictly to buildings already typed 'bar' or 'hotel' (the merged
// category being split) so nothing else is touched. Idempotent.
import { query } from '../server/models/db.js';

const DRY = process.argv.includes('--dry');
const asBool = (v) => v === true || v === 'true' || v === 't';

async function main() {
  const { rows: buildings } = await query(`
    SELECT id, name, map_id, flags
    FROM zones
    WHERE COALESCE((flags->>'is_building')::boolean, false) = true
      AND flags->>'building_type' IN ('bar', 'hotel')
    ORDER BY id`);

  let changed = 0;
  for (const b of buildings) {
    // Does this building's interior map hold any rentable lodging (is_apartment)?
    const { rows: [{ housed }] } = await query(`
      SELECT EXISTS(
        SELECT 1 FROM zones
        WHERE map_id = $1 AND COALESCE((flags->>'is_apartment')::boolean, false) = true
      ) AS housed`, [b.map_id]);

    const want = asBool(housed) ? 'hotel' : 'bar';
    const cur = (b.flags || {}).building_type;
    const mark = cur === want ? '=' : '→';
    console.log(`  ${mark} ${b.id.padEnd(26)} "${b.name}"  ${cur} ${mark} ${want}`);
    if (cur === want) continue;

    changed++;
    if (!DRY) {
      const flags = { ...(b.flags || {}), building_type: want };
      await query('UPDATE zones SET flags = $1 WHERE id = $2', [JSON.stringify(flags), b.id]);
    }
  }

  console.log(`\n${DRY ? '[dry] ' : ''}${buildings.length} bar/hotel building(s) scanned, ${changed} reclassified.`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
