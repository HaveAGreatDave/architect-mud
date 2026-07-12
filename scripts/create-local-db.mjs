// Create your LOCAL development database (empty), so `npm run content:import`
// can then apply the schema + world content from the git content/ tree.
//
//   npm run db:create-local
//
// Reads DATABASE_URL from .env and creates that database if it doesn't exist.
// Uses the `pg` driver directly, so no `psql`/`createdb` on PATH is required.
// Non-destructive: if the database already exists it's left untouched (re-run
// `npm run content:import` to bring an existing DB up to date).
//
// Safety: refuses to run against a remote host — this only ever touches localhost.
import 'dotenv/config';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('✗ DATABASE_URL is not set. Copy .env and point it at your local Postgres, e.g.\n  DATABASE_URL=postgresql://postgres:postgres@localhost:5432/architect_dev');
  process.exit(1);
}

const target = new URL(url);
const host = target.hostname;
if (!/^(localhost|127\.0\.0\.1|::1)$/.test(host)) {
  console.error(`✗ Refusing to run: DATABASE_URL points at "${host}", not localhost.\n  This command must only touch your local machine.`);
  process.exit(1);
}

const dbName = decodeURIComponent(target.pathname.replace(/^\//, '')) || 'architect_dev';
const ident = (n) => '"' + n.replace(/"/g, '""') + '"';

const adminUrl = new URL(url);
adminUrl.pathname = '/postgres'; // maintenance DB — can't create/inspect the target from within itself

const admin = new pg.Client({ connectionString: adminUrl.toString() });
await admin.connect();
try {
  const { rows } = await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [dbName]);
  if (rows.length) {
    console.log(`✓ Database "${dbName}" already exists — run \`npm run content:import\` to bring it current.`);
  } else {
    await admin.query(`CREATE DATABASE ${ident(dbName)}`);
    console.log(`✓ Created empty database "${dbName}". Now run \`npm run content:import\` to apply schema + world content.`);
  }
} finally {
  await admin.end();
}
