// One-shot: give the prod role an explicit search_path default.
//
// Why: on 2026-07-19 every /api/audio/* route in prod started failing with
// `relation "audio_sfx" does not exist` against tables that plainly existed.
// Root cause was an EMPTY search_path on Neon's POOLER endpoint — under which no
// unqualified table name resolves at all (`zones`, `players`, everything). The
// direct endpoint was unaffected: it reported `"$user", public`.
//
// pg_db_role_setting was empty, i.e. the role carried no search_path default, so
// the pooler had nothing to hand new sessions. This sets that default.
//
// db.js also pins `SET search_path TO public` per connection, which protects the
// game on its own. This is the durable server-side half — it also covers psql,
// one-shots, and anything else that connects without going through db.js.
//
// Run:  node --env-file=.env.prod scripts/fix-prod-search-path.mjs
// Local: node scripts/fix-prod-search-path.mjs
import { query } from '../server/models/db.js';

const before = await query('SELECT setconfig FROM pg_catalog.pg_db_role_setting');
console.log('role settings before:', JSON.stringify(before.rows));

// Postgres' default for a fresh cluster; "$user" first, then public.
await query('ALTER ROLE neondb_owner SET search_path = "$user", public');

const after = await query('SELECT setconfig FROM pg_catalog.pg_db_role_setting');
console.log('role settings after :', JSON.stringify(after.rows));

// A brand-new session (the ALTER only affects connections opened after it) should
// now resolve an unqualified table without db.js's per-connection SET doing the work.
const sp = await query('SHOW search_path');
console.log('this session search_path (unchanged, set by db.js):', sp.rows[0].search_path);

console.log('\nDone. Verify with a fresh pooler connection:');
console.log('  curl -s https://architect-mud.onrender.com/api/audio/sfx | head -c 120');
process.exit(0);
