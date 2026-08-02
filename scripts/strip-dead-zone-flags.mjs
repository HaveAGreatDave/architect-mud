// scripts/strip-dead-zone-flags.mjs — one-shot DATA TRANSFORMATION.
//
// Removes two zone flags that were authored and never read. The additive content
// deploy (INSERT … ON CONFLICT DO NOTHING) can never remove a key from an existing
// row, so the DB half has to be a deliberate one-shot; the content half is rewritten
// in place so git and the DB agree.
//
//   • utility_room (67 zones) — written by installGenerator (environment.js) and by
//     tools/lib/utility-room.mjs, read by NOTHING. What makes a room the junction
//     box's home is the junction box: furniture carrying `generator_id`.
//   • fence_cache (3 zones) — written by scripts/reach-dead-drops.mjs, read by
//     NOTHING. The authoritative list of dead drops is FENCE_CACHES in
//     plugins/flight/contracts.js, which the tile ids must already stay in step with.
//
// Both catalog entries are gone from client/shared/tagCatalog.js, so content:lint
// would reject these files until this has run.
//
// Idempotent and converging: a row that no longer carries either key is untouched.
//
// Local:  node scripts/strip-dead-zone-flags.mjs
// Prod:   node --env-file=.env.prod scripts/strip-dead-zone-flags.mjs
import fs from 'fs';
import path from 'path';
import { query } from '../server/models/db.js';
import { CONTENT_DIR, canonicalJson } from './content/lib.mjs';

const DEAD = ['utility_room', 'fence_cache'];

// ── Content files ───────────────────────────────────────────────────────────
const dir = path.join(CONTENT_DIR, 'zones');
let files = 0;
for (const name of fs.readdirSync(dir)) {
  if (!name.endsWith('.json')) continue;
  const file = path.join(dir, name);
  const row = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!row.flags || !DEAD.some(k => k in row.flags)) continue;
  for (const k of DEAD) delete row.flags[k];
  fs.writeFileSync(file, canonicalJson(row), 'utf8');
  files++;
}
console.log(`content: rewrote ${files} zone files`);

// ── The DB ──────────────────────────────────────────────────────────────────
// `flags - $1::text[]` removes both keys in one statement, and the `?|` guard keeps
// the UPDATE off the 5,797 rows that never had either.
const { rowCount } = await query(
  `UPDATE zones SET flags = flags - $1::text[] WHERE flags ?| $1::text[]`, [DEAD]
);
console.log(`db: cleared the keys on ${rowCount} zones`);

const { rows: left } = await query(
  `SELECT count(*)::int AS n FROM zones WHERE flags ?| $1::text[]`, [DEAD]
);
console.log(`db: rows still carrying either key: ${left[0].n}`);
process.exit(0);
