import { readFileSync } from 'fs';
import { query } from './db.js';

// Restore a database dump produced by the dev panel's export button.
//
//   npm run db:restore -- path/to/architect-dump.sql
//
// The dump is self-contained (schema + content) and wrapped in BEGIN/COMMIT,
// so this just reads the file and runs it. Use this when `psql` isn't handy;
// otherwise `psql "$DATABASE_URL" -f dump.sql` does the same thing.

const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run db:restore -- <path-to-dump.sql>');
  process.exit(1);
}

const sql = readFileSync(file, 'utf8');

query(sql)
  .then(() => {
    console.log(`✓ Restored from ${file}`);
    process.exit(0);
  })
  .catch(e => {
    console.error('Restore failed:', e.message);
    process.exit(1);
  });
