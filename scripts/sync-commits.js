// Sync git history into the dev_commits table so the Dev Log works on hosts
// whose checkout is shallow (--depth 1) or absent. Run from a full clone,
// pointed at the same Supabase DB the server uses:
//
//   npm run sync:commits           incremental — only commits not already stored
//   npm run sync:commits -- --full  re-scan ALL commits (e.g. after changing the
//                                    core-seam list, to recompute core flags)
//
// Installed as a git post-commit hook (scripts/git-hooks/post-commit) it runs
// automatically & backgrounded after each commit. Upserts by hash — idempotent.

import { execFile } from 'child_process';
import { promisify } from 'util';
import { query } from '../server/models/db.js';
import { CORE_SEAM_FILES, gitAuthorKey } from '../server/engine/dev-history.js';

const execFileP = promisify(execFile);
const US = '\x1f', RS = '\x1e';
const PRETTY = `--pretty=format:${RS}%H${US}%an${US}%ae${US}%aI${US}%s`;
const full = process.argv.includes('--full');

// Parse `git log … --numstat` output (with the PRETTY format above) into rows.
function parseLog(stdout) {
  const out = [];
  for (const rec of stdout.split(RS)) {
    const t = rec.replace(/^\n+/, '');
    if (!t.trim()) continue;
    const nl = t.indexOf('\n');
    const head = nl === -1 ? t : t.slice(0, nl);
    const rest = nl === -1 ? '' : t.slice(nl + 1);
    const [hash, name, email, iso, subject] = head.split(US);
    if (!hash) continue;
    let files = 0, add = 0, del = 0, coreLines = 0;
    const coreFiles = [];
    for (const line of rest.split('\n')) {
      const p = line.split('\t');
      if (p.length !== 3) continue;
      files++;
      const a = p[0] === '-' ? 0 : (parseInt(p[0], 10) || 0);
      const d = p[1] === '-' ? 0 : (parseInt(p[1], 10) || 0);
      add += a; del += d;
      if (CORE_SEAM_FILES.has(p[2])) { coreLines += a + d; coreFiles.push(p[2].replace(/^server\//, '')); }
    }
    out.push({ hash, name: name || '?', email: email || '', key: gitAuthorKey(email, name),
      iso, subject: subject || '', files, add, del, coreLines, coreFiles });
  }
  return out;
}

async function upsert(commits) {
  const COLS = 11, CHUNK = 150;
  let done = 0;
  for (let i = 0; i < commits.length; i += CHUNK) {
    const chunk = commits.slice(i, i + CHUNK);
    const values = [], params = [];
    chunk.forEach((c, idx) => {
      const b = idx * COLS;
      values.push(`($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11}::jsonb)`);
      params.push(c.hash, c.name, c.email, c.key, c.iso, c.subject, c.files, c.add, c.del, c.coreLines, JSON.stringify(c.coreFiles));
    });
    await query(
      `INSERT INTO dev_commits
         (hash, author_name, author_email, author_key, authored_at, subject, files_changed, lines_added, lines_deleted, core_lines, core_files)
       VALUES ${values.join(',')}
       ON CONFLICT (hash) DO UPDATE SET
         author_name=EXCLUDED.author_name, author_email=EXCLUDED.author_email, author_key=EXCLUDED.author_key,
         authored_at=EXCLUDED.authored_at, subject=EXCLUDED.subject, files_changed=EXCLUDED.files_changed,
         lines_added=EXCLUDED.lines_added, lines_deleted=EXCLUDED.lines_deleted,
         core_lines=EXCLUDED.core_lines, core_files=EXCLUDED.core_files`,
      params
    );
    done += chunk.length;
    if (commits.length > CHUNK) process.stdout.write(`\r  upserted ${done}/${commits.length}`);
  }
}

async function main() {
  const opts = { cwd: process.cwd(), maxBuffer: 512 * 1024 * 1024 };
  let commits;

  if (full) {
    const { stdout } = await execFileP('git', ['log', '--no-merges', PRETTY, '--numstat'], opts);
    commits = parseLog(stdout);
    console.log(`Full sync: parsed ${commits.length} commits.`);
  } else {
    const [{ rows: existRows }, { stdout: hashOut }] = await Promise.all([
      query(`SELECT hash FROM dev_commits`),
      execFileP('git', ['log', '--no-merges', '--pretty=%H'], opts),
    ]);
    const existing = new Set(existRows.map(r => r.hash));
    const allHashes = hashOut.split('\n').map(s => s.trim()).filter(Boolean);
    const newHashes = allHashes.filter(h => !existing.has(h));
    if (!newHashes.length) { console.log('dev_commits already up to date.'); process.exit(0); }
    // A big backlog (empty table, or a large pull) is cheaper as one full walk.
    if (existing.size === 0 || newHashes.length > 500) {
      const { stdout } = await execFileP('git', ['log', '--no-merges', PRETTY, '--numstat'], opts);
      commits = parseLog(stdout).filter(c => !existing.has(c.hash));
    } else {
      const { stdout } = await execFileP('git', ['log', '--no-walk', PRETTY, '--numstat', ...newHashes], opts);
      commits = parseLog(stdout);
    }
    console.log(`Incremental sync: ${commits.length} new commit(s).`);
  }

  if (commits.length) await upsert(commits);
  const { rows } = await query(`SELECT COUNT(*)::int AS c FROM dev_commits`);
  console.log(`\nDone. dev_commits holds ${rows[0].c} commits.`);
  process.exit(0);
}

main().catch(err => { console.error('sync-commits failed:', err.message); process.exit(1); });
