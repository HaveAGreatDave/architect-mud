// purge-phantom-apartments.mjs — one-shot data cleanup.
//
// The old content pipeline exported the `apartments` table and stamped ownerless
// "owner_type='player', owner_id=NULL" phantom rows over every DB. Now that
// apartments is player-classed (tenancy only) and per-unit rent price lives on the
// zone (flags.rent_cost), those ownerless rows are pure residue: they carry no
// tenancy and no longer carry authored pricing. A REAL tenancy always has an owner_id.
//
// A phantom = NO player owner AND NO org owner. Corp HQs set owner_id to the org id
// (plugins/corps) so `owner_id IS NULL` alone already skips them, but we guard on
// owner_org_id too so the intent is explicit and defensive for a destructive prod op:
// this can only ever delete a row that nobody — player or org — owns. Safe to run
// against prod:  node --env-file=.env.prod scripts/purge-phantom-apartments.mjs
// (omit the flag for local).  Idempotent.
import { query } from '../server/models/db.js';

const before = (await query('SELECT count(*)::int AS n FROM apartments')).rows[0].n;
const owned = (await query('SELECT count(*)::int AS n FROM apartments WHERE owner_id IS NOT NULL OR owner_org_id IS NOT NULL')).rows[0].n;
const res = await query('DELETE FROM apartments WHERE owner_id IS NULL AND owner_org_id IS NULL');
const after = (await query('SELECT count(*)::int AS n FROM apartments')).rows[0].n;

console.log(`apartments rows: ${before} → ${after}  (deleted ${res.rowCount} ownerless phantom(s); ${owned} genuine tenanc${owned === 1 ? 'y' : 'ies'}/HQ(s) preserved)`);
process.exit(0);
