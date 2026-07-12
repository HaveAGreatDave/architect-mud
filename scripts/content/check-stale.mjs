// check-stale — is the local DB behind the checked-in content/ tree?
//
// Compares the DB's import marker (content_pipeline.last_imported_sha) against
// HEAD: if committed content/ files changed since the last import, the local
// world is stale and anything run against it (regress, dev server) will
// disagree with git — the exact "regress fails locally but CI was green"
// confusion the July 2026 district batch caused when a rebase pull skipped
// the post-merge auto-import.
//
//   node scripts/content/check-stale.mjs               exit 1 when stale (pretest:regress)
//   node scripts/content/check-stale.mjs --warn-only   warn but exit 0 (predev)
//
// Never blocks on infrastructure problems: no marker, unreachable DB, or a
// marker commit unknown to git all warn and exit 0 — the run itself will
// surface those loudly enough.
import { execFileSync } from 'node:child_process';
import { MARKER_KEY } from './lib.mjs';
import pool, { query } from '../../server/models/db.js';

const warnOnly = process.argv.includes('--warn-only');
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

let marker;
try {
  const { rows } = await query('SELECT value FROM server_settings WHERE key=$1', [MARKER_KEY]);
  marker = rows[0]?.value;
} catch (e) {
  console.warn(`⚠ content staleness check skipped: DB unreachable (${e.message.split('\n')[0]})`);
  process.exit(0);
} finally {
  await pool.end().catch(() => {});
}

if (!marker) {
  console.warn(`⚠ content staleness check skipped: no import marker in this DB — run npm run content:import once to set it.`);
  process.exit(0);
}

const head = git('rev-parse', 'HEAD').trim();
if (marker === head) process.exit(0);

let changed;
try {
  changed = git('diff', '--name-only', '--no-renames', marker, 'HEAD', '--', 'content/')
    .split('\n').filter(Boolean);
} catch (e) {
  console.warn(`⚠ content staleness check skipped: cannot diff against marker ${marker.slice(0, 10)} (${e.message.split('\n')[0]})`);
  process.exit(0);
}
if (!changed.length) process.exit(0);

const behind = git('rev-list', '--count', `${marker}..HEAD`).trim();
console.error(`${warnOnly ? '⚠' : '✗'} Local DB content is STALE: ${changed.length} content file(s) changed in the ${behind} commit(s) since it last imported (${marker.slice(0, 10)}).`);
console.error(`  The local world disagrees with git — regress and gameplay will not match what CI tested.`);
console.error(`  Fix:  npm run content:import -- --guard-wip`);
process.exit(warnOnly ? 0 : 1);
