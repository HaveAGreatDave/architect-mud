// Rebuild your LOCAL development database from the shared snapshot in db/seed.sql.
//
//   npm run db:setup-local
//
// Reads DATABASE_URL from .env, drops & recreates that database, and loads the
// committed world snapshot (schema + content, no player/account rows). Uses the
// `pg` driver directly, so no `psql` on PATH is required.
//
// Safety: refuses to run against a remote host — this only ever touches localhost.
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('✗ DATABASE_URL is not set. Copy .env and point it at your local Postgres, e.g.\n  DATABASE_URL=postgresql://postgres:postgres@localhost:5432/architect_dev');
  process.exit(1);
}

const target = new URL(url);
const host = target.hostname;
if (!/^(localhost|127\.0\.0\.1|::1)$/.test(host)) {
  console.error(`✗ Refusing to run: DATABASE_URL points at "${host}", not localhost.\n  This command DROPS and recreates the database — it must only touch your local machine.`);
  process.exit(1);
}
const dbName = decodeURIComponent(target.pathname.replace(/^\//, '')) || 'architect_dev';
const ident = (n) => '"' + n.replace(/"/g, '""') + '"';

const seedPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'db', 'seed.sql');
const seed = readFileSync(seedPath, 'utf8');

const adminUrl = new URL(url);
adminUrl.pathname = '/postgres'; // maintenance DB — can't DROP the DB you're connected to

async function main() {
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  // Kick off any existing connections (e.g. a running dev server) so DROP succeeds.
  await admin.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()`,
    [dbName]
  );
  await admin.query(`DROP DATABASE IF EXISTS ${ident(dbName)}`);
  await admin.query(`CREATE DATABASE ${ident(dbName)}`);
  await admin.end();

  const db = new pg.Client({ connectionString: url });
  await db.connect();
  await db.query(seed); // schema + content in one batch
  await db.end();
  console.log(`✓ Local database "${dbName}" rebuilt from db/seed.sql`);
}

main().catch((e) => { console.error('✗ setup-local failed:', e.message); process.exit(1); });
