// content:guard-deletions — pre-push safety net against the "export over a stale DB" bug.
//
// Reads a newline-delimited list of content/ files this push DELETES on stdin,
// and blocks (exit 1) any deletion that your local DB never imported.
//
// Why this exists: `content:export` deletes files whose rows "vanished locally".
// If you pull a teammate's new content into content/ but never `content:import`
// it, your DB is missing those rows — so the next `content:export` deletes their
// files, and a commit+push silently wipes their work from git. (This is exactly
// how commit d2efde7d deleted ~20 quest/NPC/item files.)
//
// The tell is the import marker (content_pipeline.last_imported_sha): a
// legitimately-authored deletion removes a file whose row your DB imported, so
// the file EXISTED at your marker. The stale-export bug deletes a file that was
// added by a pull AFTER your marker and never imported — it did NOT exist at
// your marker. We block exactly that case.
//
// Invoked by scripts/git-hooks/pre-push. Escape hatches: a genuine emergency is
// `git push --no-verify`; a deliberate bulk purge you understand is
// `CONTENT_GUARD_SKIP=1 git push`.
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { connectTarget, MARKER_KEY, REPO_ROOT } from './lib.mjs';

function gitOk(...argv) {
  try { execFileSync('git', argv, { cwd: REPO_ROOT, stdio: 'ignore' }); return true; }
  catch { return false; }
}

// Files to check arrive on stdin, one path per line (repo-relative, forward-slash).
const paths = await new Promise((resolve) => {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { buf += d; });
  process.stdin.on('end', () => resolve(buf.split('\n').map(s => s.trim()).filter(Boolean)));
});

if (!paths.length) process.exit(0); // no content deletions in this push — nothing to guard

if (process.env.CONTENT_GUARD_SKIP === '1') {
  console.warn('[content-guard] CONTENT_GUARD_SKIP=1 — deletion safety check skipped by request.');
  process.exit(0);
}

function block(reason, suspects) {
  console.error('');
  console.error('✗ [content-guard] content DELETIONS blocked — ' + reason);
  for (const p of suspects) console.error(`    − ${p}`);
  console.error('');
  console.error('  This is the fingerprint of an export against a stale database: you likely');
  console.error('  pulled these files but never `npm run content:import`, so `content:export`');
  console.error('  deleted them because their rows were missing from your local DB.');
  console.error('');
  console.error('  Fix: restore the deletions, then import the pulled content:');
  console.error('    git checkout -- ' + suspects.slice(0, 3).join(' ') + (suspects.length > 3 ? ' …' : ''));
  console.error('    npm run content:import   (then `npm run content:status` should be clean)');
  console.error('');
  console.error('  Deliberate purge you understand?  CONTENT_GUARD_SKIP=1 git push');
  console.error('  Real emergency?                   git push --no-verify');
  process.exit(1);
}

let marker;
try {
  const { client } = await connectTarget({ purpose: 'read the import marker of' });
  const { rows } = await client.query('SELECT value FROM server_settings WHERE key=$1', [MARKER_KEY]);
  marker = rows[0]?.value;
  await client.end();
} catch (e) {
  // Can't reach the DB → can't verify a destructive push. Fail safe: block.
  block(`cannot verify (local DB unreachable: ${e.message.split('\n')[0]}).`, paths);
}

if (!marker) {
  block('no import marker in your local DB (never imported) — cannot verify these are real deletions.', paths);
}

// A deleted file that did NOT exist at the marker was never imported by this DB.
const suspects = paths.filter(p => !gitOk('cat-file', '-e', `${marker}:${p}`));
if (suspects.length) {
  block(`${suspects.length} deleted file(s) were never imported by your DB (added after marker ${marker.slice(0, 10)}):`, suspects);
}

console.log(`[content-guard] ${paths.length} content deletion(s) verified against import marker ${marker.slice(0, 10)} — OK.`);
process.exit(0);
