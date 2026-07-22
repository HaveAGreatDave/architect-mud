// set-2a-akerson.mjs — one-shot: give Unit 2A (zone_apt_1) to the player Akerson.
// 2A is meant to be his but was never a real deed in the DB (it lived only as an
// ownerless content-export phantom, since removed). This writes a genuine tenancy row
// so ownership persists across restarts and the boot reconcile keeps NPCs out for good.
//
// Looks Akerson up by handle at runtime (no id baked into git). Idempotent, and refuses
// to clobber a different owner. Run:  node --env-file=.env.prod scripts/set-2a-akerson.mjs
//
// NOTE: the live server caches world.apartments in memory — the deed is correct in the
// DB immediately, but shows in-game only after the prod world reloads/restarts.
import { query } from '../server/models/db.js';

const ZONE = 'zone_apt_1';

const { rows: pl } = await query(
  "SELECT id, handle FROM players WHERE lower(handle)='akerson' OR lower(username)='akerson' LIMIT 1");
if (!pl.length) { console.error('No player "akerson" on this DB — aborting (nothing changed).'); process.exit(1); }
const ak = pl[0];

const { rows: cur } = await query('SELECT owner_id, owner_handle FROM apartments WHERE zone_id=$1', [ZONE]);
if (cur.length && cur[0].owner_id && cur[0].owner_id !== ak.id) {
  console.error(`2A already owned by ${cur[0].owner_handle} (${cur[0].owner_id}) — refusing to clobber. Aborting.`);
  process.exit(1);
}

const now = Math.floor(Date.now() / 1000);
await query(
  `INSERT INTO apartments (zone_id, owner_id, owner_handle, owner_type, is_locked, lock_difficulty, rent_cost, purchased_at, date_rented, building_name, rent_due_date)
   VALUES ($1,$2,$3,'player',0,4,100,$4,$4,NULL,NULL)
   ON CONFLICT (zone_id) DO UPDATE SET owner_id=$2, owner_handle=$3, owner_type='player', is_locked=0`,
  [ZONE, ak.id, ak.handle, now]);

const { rows: chk } = await query('SELECT owner_handle, owner_type, rent_cost FROM apartments WHERE zone_id=$1', [ZONE]);
console.log(`✓ Unit 2A → ${chk[0].owner_handle} (${chk[0].owner_type}), rent ${chk[0].rent_cost}c. Reload the live world for it to show in-game.`);
process.exit(0);
