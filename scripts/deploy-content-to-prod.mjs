// Push LOCAL world content additively to PRODUCTION.
//
//   node scripts/deploy-content-to-prod.mjs --yes
//
// Reads content from your LOCAL DB (DATABASE_URL) using the exact same dump the
// dev panel export produces (schema + world rows, no player rows), then applies
// it to PROD_DATABASE_URL. The dump is additive — every row is
// `INSERT … ON CONFLICT DO NOTHING` — so it ADDS new content and can never
// overwrite or delete existing live rows.
//
// Guards: refuses unless DATABASE_URL is local (so we're reading local content)
// and PROD_DATABASE_URL is remote (so we're writing production). Requires --yes
// to run — pass it after a typed confirmation. Take a prod backup
// first (npm run db:backup-prod).
import 'dotenv/config';
import pg from 'pg';
import { buildDump } from '../server/api/backup.routes.js';

const yes = process.argv.includes('--yes');
if (!yes) {
  console.error('Refusing to run without --yes. This writes to PRODUCTION.');
  process.exit(1);
}

const localUrl = process.env.DATABASE_URL || '';
const prodUrl = process.env.PROD_DATABASE_URL || '';
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };
const isLocal = (h) => /^(localhost|127\.0\.0\.1|::1)$/.test(h);

const localHost = hostOf(localUrl);
const prodHost = hostOf(prodUrl);

if (!isLocal(localHost)) {
  console.error(`✗ DATABASE_URL host is "${localHost}", not local. We read LOCAL content to push — point .env DATABASE_URL back at localhost first.`);
  process.exit(1);
}
if (!prodUrl) {
  console.error('✗ PROD_DATABASE_URL is not set in .env.');
  process.exit(1);
}
if (isLocal(prodHost)) {
  console.error(`✗ PROD_DATABASE_URL host is "${prodHost}" (local). It must point at production Supabase.`);
  process.exit(1);
}

console.log(`→ Reading local content (${localHost}) …`);
const sql = await buildDump(); // uses the local pool via server/models/db.js
const inserts = (sql.match(/^INSERT INTO/gm) || []).length;
console.log(`  built dump: ${inserts} content rows, ${(sql.length / 1024).toFixed(0)} KB`);

console.log(`→ Applying additively to production (${prodHost}) …`);
const pool = new pg.Pool({
  connectionString: prodUrl,
  ssl: { rejectUnauthorized: false }, // Supabase requires TLS
  max: 1,
});

try {
  // The dump is self-contained and wrapped in BEGIN/COMMIT, so a single query
  // applies schema + additive content atomically.
  await pool.query(sql);
  console.log(`\n✓ Deployed. New content is live on production. Existing rows were left untouched (additive).`);
} catch (e) {
  console.error('\n✗ Deploy failed (nothing partially applied — the dump is one transaction):', e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
