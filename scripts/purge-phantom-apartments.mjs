// purge-phantom-apartments.mjs — one-shot data cleanup.
//
// The old content pipeline exported the `apartments` table and stamped ownerless
// "owner_type='player', owner_id=NULL" phantom rows over every DB. Now that
// apartments is player-classed (tenancy only) and per-unit rent price lives on the
// zone (flags.rent_cost), those ownerless rows are pure residue: they carry no
// tenancy and no longer carry authored pricing. A REAL tenancy always has an owner_id.
//
// This deletes only ownerless rows — it can never touch a genuine rental. Safe to run
// against prod:  node --env-file=.env.prod scripts/purge-phantom-apartments.mjs
// (omit the flag for local).  Idempotent.
import { query } from '../server/models/db.js';

const before = (await query('SELECT count(*)::int AS n FROM apartments')).rows[0].n;
const owned = (await query('SELECT count(*)::int AS n FROM apartments WHERE owner_id IS NOT NULL')).rows[0].n;
const res = await query('DELETE FROM apartments WHERE owner_id IS NULL');
const after = (await query('SELECT count(*)::int AS n FROM apartments')).rows[0].n;

console.log(`apartments rows: ${before} → ${after}  (deleted ${res.rowCount} ownerless phantom(s); ${owned} genuine tenanc${owned === 1 ? 'y' : 'ies'} preserved)`);
process.exit(0);
