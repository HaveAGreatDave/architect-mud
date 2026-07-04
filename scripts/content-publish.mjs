// Publish world content to the team: regenerate db/seed.sql from your LOCAL DB,
// commit just that file, and push. One command to share content.
//
//   npm run content:publish            (auto commit message)
//   npm run content:publish -- "msg"   (custom message)
//
// Set CONTENT_NO_PUSH=1 to commit without pushing.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });

// 1) Regenerate the seed from your local content.
console.log('→ Exporting world content to db/seed.sql …');
run(process.execPath, ['scripts/export-seed.mjs']);

// 2) Detect a *semantic* change, ignoring incidental row-reordering. The DB can
// return content rows in a different physical order after edits, which would
// churn the file without any real change; comparing a sorted-line view of the
// new seed against the committed one filters that out.
// maxBuffer must exceed the seed size (~1 MB+) or git show throws ENOBUFS and the
// guard silently no-ops into an always-commit. Strip CR so CRLF vs LF never counts.
const norm = (s) => s.replace(/\r/g, '').split('\n').sort().join('\n');
let headSeed = '';
try { headSeed = execFileSync('git', ['show', 'HEAD:db/seed.sql'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }); } catch { headSeed = ''; }
const newSeed = readFileSync('db/seed.sql', 'utf8');

if (headSeed && norm(headSeed) === norm(newSeed)) {
  // Only row order shuffled — no real content change. Discard the churn.
  run('git', ['checkout', '--', 'db/seed.sql']);
  console.log('\n✓ No content changes to publish — db/seed.sql already matches the last publish.');
  process.exit(0);
}

// 3) Commit ONLY db/seed.sql (path-limited: ignores any other staged/unstaged files).
const custom = process.argv.slice(2).join(' ').trim();
const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
const msg = custom || `Update world seed (${stamp})`;
run('git', ['commit', 'db/seed.sql', '-m', msg]);

// 4) Push (unless suppressed).
if (process.env.CONTENT_NO_PUSH) {
  console.log('\n✓ Committed (push skipped: CONTENT_NO_PUSH set). Push when ready with: git push');
} else {
  run('git', ['push']);
  console.log('\n✓ Content published. Teammates get it with:  npm run content:sync');
}
