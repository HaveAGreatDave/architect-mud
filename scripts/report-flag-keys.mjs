// Read-only drift report: distinct flags-bag keys on zones / npcs / furniture
// vs the documented inventory in docs/flags-keys.md.
//
//   node scripts/report-flag-keys.mjs                        (local dev DB)
//   node --env-file=.env.prod scripts/report-flag-keys.mjs   (prod, read-only)
//
// The flags bags are uncatalogued JSONB grab-bags read via flags->>'key' —
// this report is how new keys get noticed and documented. Keys present in the
// DB but missing from docs/flags-keys.md are listed as UNDOCUMENTED.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { query } from '../server/models/db.js';

const docPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'flags-keys.md');
let documented = new Set();
try {
  // Documented keys: every backticked token in the first column of a table row
  // (rows may combine related keys: | `deal_from` / `deal_to` | ... ).
  for (const line of readFileSync(docPath, 'utf8').split('\n')) {
    if (!line.startsWith('|')) continue;
    const firstCol = line.split('|')[1] || '';
    for (const m of firstCol.matchAll(/`([^`]+)`/g)) documented.add(m[1]);
  }
} catch { console.warn('docs/flags-keys.md not found — listing all keys as undocumented.'); }

for (const table of ['zones', 'npcs', 'furniture']) {
  const { rows } = await query(`
    SELECT k AS key, COUNT(*) AS uses
    FROM ${table}, LATERAL jsonb_object_keys(flags) k
    GROUP BY k ORDER BY k
  `);
  const missing = rows.filter(r => !documented.has(r.key));
  console.log(`\n${table}: ${rows.length} distinct flag keys, ${missing.length} undocumented`);
  for (const r of rows) console.log(`  ${documented.has(r.key) ? ' ' : '✗'} ${r.key} (${r.uses})`);
}
process.exit(0);
