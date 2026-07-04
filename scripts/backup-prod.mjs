// Full PRODUCTION backup (schema + ALL data, including players) to a local file.
//
//   npm run db:backup-prod
//
// Targets PROD_DATABASE_URL (NOT DATABASE_URL — that now points at your local dev
// DB). Writes a timestamped .sql into a folder OUTSIDE the repo, keeps the newest
// 10, and prunes older ones. The file contains password hashes/emails — keep it
// private, never commit it.
//
// Requires pg_dump (ships with Postgres). Set PG_DUMP to override its path.
// Optional: BACKUP_DIR to override where files are written.
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const url = process.env.PROD_DATABASE_URL;
if (!url) {
  console.error('✗ PROD_DATABASE_URL is not set. Add your Supabase SESSION-pooler URL (port 5432) to .env, e.g.\n' +
    '  PROD_DATABASE_URL=postgresql://USER:PASS@aws-1-us-west-2.pooler.supabase.com:5432/postgres');
  process.exit(1);
}
const host = new URL(url).hostname;
if (/^(localhost|127\.0\.0\.1|::1)$/.test(host)) {
  console.error(`✗ PROD_DATABASE_URL points at "${host}" (local). This backs up PRODUCTION — point it at Supabase.`);
  process.exit(1);
}

function resolvePgDump() {
  if (process.env.PG_DUMP) return process.env.PG_DUMP;
  for (const v of ['18', '17', '16', '15']) {
    const p = `C:/Program Files/PostgreSQL/${v}/bin/pg_dump.exe`;
    if (existsSync(p)) return p;
  }
  return 'pg_dump'; // rely on PATH (Mac/Linux)
}

const dir = process.env.BACKUP_DIR || join(homedir(), 'Documents', 'architect-backups');
mkdirSync(dir, { recursive: true });

const d = new Date();
const p2 = (n) => String(n).padStart(2, '0');
const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}`;
const out = join(dir, `architect-prod-FULL-backup_${stamp}.sql`);

try {
  execFileSync(resolvePgDump(), [url, '--no-owner', '--no-privileges', '-n', 'public', '-f', out],
    { stdio: ['ignore', 'inherit', 'inherit'] });
  const kb = (statSync(out).size / 1024).toFixed(0);
  console.log(`✓ Backed up production → ${out} (${kb} KB)`);

  // Retention: keep the 10 newest backups, delete the rest.
  const KEEP = 10;
  const files = readdirSync(dir)
    .filter(f => /^architect-prod-FULL-backup_.*\.sql$/.test(f))
    .sort(); // timestamped names sort chronologically
  const stale = files.slice(0, Math.max(0, files.length - KEEP));
  for (const f of stale) { rmSync(join(dir, f)); console.log(`  pruned old backup: ${f}`); }
} catch (e) {
  console.error('✗ backup-prod failed:', e.message);
  if (/ENOENT/.test(e.message)) console.error('  Could not find pg_dump. Set PG_DUMP to its full path.');
  process.exit(1);
}
