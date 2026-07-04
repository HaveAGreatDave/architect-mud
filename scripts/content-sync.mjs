// Get the latest shared world: pull, then rebuild the local DB from the seed —
// but ONLY if the pull actually changed db/seed.sql (so it won't needlessly wipe
// your local DB when nothing content-related came in).
//
//   npm run content:sync
import { execFileSync } from 'node:child_process';

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });
const cap = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim();

const before = cap('git', ['rev-parse', 'HEAD']);

console.log('→ Pulling latest …');
try {
  run('git', ['pull']);
} catch {
  console.error('\n✗ git pull failed (likely a merge conflict). Resolve it, then run:  npm run db:setup-local');
  process.exit(1);
}

const after = cap('git', ['rev-parse', 'HEAD']);
let seedChanged = false;
if (before !== after) {
  seedChanged = cap('git', ['diff', '--name-only', before, after]).split('\n').includes('db/seed.sql');
}

if (seedChanged) {
  console.log('\n🌍 World seed changed — rebuilding your local database from it …');
  run(process.execPath, ['scripts/setup-local-db.mjs']);
  console.log('\n✓ Local world updated to match the shared seed.');
} else {
  console.log('\n✓ Up to date — no world-seed changes; local database left untouched.');
}
