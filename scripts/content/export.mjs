// content:export — dump the LOCAL database's content rows into content/<table>/<pk>.json.
//
//   npm run content:export             export from local DB (the daily driver)
//   node scripts/content/export.mjs --prod --yes   one-off: export FROM prod
//                                      (used once, for the Phase-3 baseline)
//
// One file per row, canonical serialization (see lib.mjs). Files whose rows
// vanished locally are deleted from the working tree — that is how content
// deletions enter git: review the `git status` diff, then commit.
//
// This never touches a database's rows (read-only) and never commits for you:
// export → review `git diff` → commit → push is deliberately a human loop.
import 'dotenv/config';
import { connectTarget, exportContent, CONTENT_DIR } from './lib.mjs';

const args = new Set(process.argv.slice(2));
const prod = args.has('--prod');
const yes = args.has('--yes');

try {
  const { client, host } = await connectTarget({ prod, yes, purpose: 'export content FROM' });
  const stats = await exportContent(client, CONTENT_DIR);
  await client.end();

  let created = 0, updated = 0, removed = 0, rows = 0;
  for (const s of stats) {
    rows += s.rows; created += s.created; updated += s.updated; removed += s.removed;
    if (s.created || s.updated || s.removed) {
      console.log(`  ${s.table.padEnd(26)} +${s.created} ~${s.updated} -${s.removed} (${s.rows} rows)`);
    }
  }
  console.log(`✓ Exported ${rows} rows from ${host} → content/ (${created} new, ${updated} changed, ${removed} removed files).`);
  if (created || updated || removed) {
    console.log('  Review with `git status` / `git diff content/`, then commit.');
  }
  process.exit(0);
} catch (e) {
  console.error('✗ content:export failed:', e.message);
  process.exit(1);
}
