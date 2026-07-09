// Read-only drift report: distinct item tag keys in the DB vs the tag catalog.
//
//   node scripts/report-tag-keys.mjs                   (local dev DB)
//   node --env-file=.env.prod scripts/report-tag-keys.mjs   (prod, read-only)
//
// Run this BEFORE tightening tag validation: any legitimate uncatalogued key
// it reports should be added to client/shared/tagCatalog.js first.
import { query } from '../server/models/db.js';
import { TAG_CATALOG, validateTags } from '../server/engine/tags.js';

const { rows } = await query(`
  SELECT k AS key, COUNT(*) AS uses
  FROM items, LATERAL jsonb_object_keys(tags) k
  GROUP BY k ORDER BY k
`);

const unknown = rows.filter(r => !TAG_CATALOG[r.key] && !r.key.includes(':') && !r.key.startsWith('bait_') && r.key !== '__super' && r.key !== '__own');
console.log(`${rows.length} distinct tag keys across items; catalog has ${Object.keys(TAG_CATALOG).length} entries.`);
if (unknown.length) {
  console.log(`\n✗ ${unknown.length} key(s) NOT in the catalog:`);
  for (const r of unknown) console.log(`  ${r.key}  (${r.uses} item${r.uses > 1 ? 's' : ''})`);
} else {
  console.log('✓ every stored tag key is catalogued.');
}

// Shape check per item (misshapen values on known keys)
const { rows: items } = await query(`SELECT id, tags FROM items WHERE tags IS NOT NULL AND tags != '{}'::jsonb`);
let shapeProblems = 0;
for (const it of items) {
  const v = validateTags(it.tags);
  if (v.badShape.length) {
    shapeProblems++;
    console.log(`  shape: ${it.id} — ${v.badShape.join('; ')}`);
  }
}
console.log(shapeProblems ? `✗ ${shapeProblems} item(s) with misshapen tag values.` : '✓ no shape problems.');
process.exit(0);
