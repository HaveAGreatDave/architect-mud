/**
 * Prune dream/hallucination content rows that no longer have a file.
 *
 * WHY THIS EXISTS. The CODEX import is additive (`INSERT … ON CONFLICT DO UPDATE`)
 * and can never delete — so when a content file is renamed or a pool is rewritten
 * with new ids, the superseded rows stay in the database forever. They are not
 * inert: every one of them is still a live candidate the roller can draw, so a
 * rewritten pool keeps serving the old lines it was rewritten to replace.
 *
 * That is exactly what happened to `dream_tethers` — a rewrite that fixed
 * awkward death lines left the awkward ones in place alongside the fixes, and the
 * regress check caught them still being drawn.
 *
 * CONVERGING and safe to re-run: it deletes only rows whose id has no matching
 * file under content/<table>/, so a clean database is a no-op. Belongs in the
 * oneshots batch (see reference_prod_oneshot_scripts).
 *
 *   node scripts/prune-orphan-dream-rows.mjs                  # local
 *   node --env-file=.env.prod scripts/prune-orphan-dream-rows.mjs
 */
import { readdirSync, existsSync } from 'fs';
import { query } from '../server/models/db.js';

const TABLES = [
  'dream_tethers',
  'dream_templates',
  'dream_presences',
  'drug_transforms',
  'drug_reactions',
];

const ROOT = new URL('../content/', import.meta.url);

let total = 0;
for (const table of TABLES) {
  const dir = new URL(`${table}/`, ROOT);
  if (!existsSync(dir)) { console.log(`- ${table}: no content dir, skipped`); continue; }
  const ids = readdirSync(dir).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''));
  if (!ids.length) { console.log(`- ${table}: no files, skipped (refusing to empty a table)`); continue; }

  const { rows } = await query(
    `DELETE FROM ${table} WHERE NOT (id = ANY($1)) RETURNING id`, [ids]);
  total += rows.length;
  console.log(`- ${table}: ${rows.length} orphan(s) removed, ${ids.length} kept`);
  for (const r of rows) console.log(`    ${r.id}`);
}

console.log(total ? `\n✓ pruned ${total} orphaned row(s)` : '\n✓ nothing to prune');
process.exit(0);
