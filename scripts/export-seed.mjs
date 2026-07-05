// Regenerate the shared world snapshot (db/seed.sql) from your LOCAL database.
// Run this after you change content locally, then commit db/seed.sql so your
// teammate gets the same world with `git pull` + `npm run db:setup-local`.
//
//   npm run db:export-seed
//
// SINGLE SOURCE OF TRUTH: this reuses buildDump() from server/api/backup.routes.js
// — the exact same schema + filtered-content dump the dev-panel "Database Backup →
// Export" button and the Relay's prod deploy produce. There is intentionally NO
// second CONTENT_TABLES list here anymore: a duplicate list silently drifted and
// dropped whole subsystems (flight's aircraft_types/aa_sites, audio, media, …)
// from the git seed while the dev-panel path stayed current. One list, one dump.
//
// No pg_dump / PostgreSQL client tools required — buildDump() runs pure SQL via the
// `pg` driver, same as everything else.
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildDump } from '../server/api/backup.routes.js';

const url = process.env.DATABASE_URL;
if (!url) { console.error('✗ DATABASE_URL is not set (check your .env).'); process.exit(1); }
const host = new URL(url).hostname;
if (!/^(localhost|127\.0\.0\.1|::1)$/.test(host)) {
  console.error(`✗ DATABASE_URL points at "${host}", not localhost. Export the seed from your LOCAL db only.`);
  process.exit(1);
}

try {
  // buildDump() embeds SCHEMA_SQL (the single schema source of truth) ahead of the
  // filtered content INSERTs, all inside one BEGIN…COMMIT with SET CONSTRAINTS ALL
  // DEFERRED — the format setup-local-db.mjs / db:restore already load. Normalize to
  // pure LF: SCHEMA_SQL may be checked out CRLF on Windows, and mixing that with the
  // dump's LF drifts blank lines by a stray \r and defeats content-publish's change
  // detection. The whole seed is written pure-LF.
  const seed = (await buildDump()).replace(/\r\n?/g, '\n');

  const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'db', 'seed.sql');
  writeFileSync(out, seed, 'utf8'); // pure LF, always
  console.log(`✓ Wrote db/seed.sql (${(seed.length / 1024).toFixed(0)} KB). Commit it to share the world.`);
  process.exit(0);
} catch (e) {
  console.error('✗ export-seed failed:', e.message);
  if (e.stack) console.error(e.stack);
  process.exit(1);
}
