// One-shot: reap orphaned surveillance-clip broadcasts (the `bc_clip_*` /
// "Footage: <zone>" entries that pile up in the dev panel's Broadcasts tab).
//
// Each datachip mints a hidden enabled=0 broadcast so the chip can play on a
// zone's TVs (ensureClipBroadcast). When the underlying security_clips row AND
// every physical datachip for it are gone, that broadcast is dead weight — it
// can never be aired again because nothing points at it.
//
// This deletes a bc_clip_ broadcast ONLY when BOTH are true:
//   • its security_clips row no longer exists, and
//   • no `item_datachip_*` for it is held in any inventory/container/deck.
// A broadcast whose clip is gone but whose chip is still the last surviving copy
// of the footage is LEFT ALONE — deleting it would brick that chip. Orphan chip
// item *definitions* with zero inventory instances are swept alongside.
//
//   node scripts/reap-orphan-clip-broadcasts.js                       (local)
//   node --env-file=.env.prod scripts/reap-orphan-clip-broadcasts.js  (prod)
//   ...append `--dry` to report without deleting.
import { query } from '../server/models/db.js';

const dry = process.argv.includes('--dry');

// A datachip is "held" if it has any player_inventory row (carried, in a
// container, or seated in a media deck — the inventory table covers all three).
const DEAD_BROADCASTS = `
  SELECT b.id FROM media_broadcasts b
  WHERE b.id LIKE 'bc_clip_%'
    AND NOT EXISTS (SELECT 1 FROM security_clips c WHERE ('bc_clip_'||c.id) = b.id)
    AND NOT EXISTS (
      SELECT 1 FROM items i
      JOIN player_inventory pi ON pi.item_id = i.id
      WHERE i.tags->>'broadcast_id' = b.id)`;

const { rows: dead } = await query(DEAD_BROADCASTS);
if (!dead.length) {
  console.log('No orphaned clip broadcasts to reap — every bc_clip_ broadcast still has a live clip or a held chip.');
  process.exit(0);
}
const ids = dead.map(r => r.id);
console.log(`${ids.length} orphaned clip broadcast(s) found${dry ? ' (dry run — nothing deleted)' : ''}.`);

// Unheld chip item definitions for those broadcasts (no inventory instance).
const { rows: chips } = await query(
  `SELECT id FROM items
     WHERE tags->>'broadcast_id' = ANY($1)
       AND NOT EXISTS (SELECT 1 FROM player_inventory pi WHERE pi.item_id = items.id)`,
  [ids]
);
const chipIds = chips.map(r => r.id);

if (dry) {
  console.log(`Would delete ${ids.length} broadcast(s) and ${chipIds.length} unheld chip item(s).`);
  process.exit(0);
}

const b = await query('DELETE FROM media_broadcasts WHERE id = ANY($1)', [ids]);
const it = chipIds.length ? await query('DELETE FROM items WHERE id = ANY($1)', [chipIds]) : { rowCount: 0 };
console.log(`Deleted ${b.rowCount} orphaned clip broadcast(s) and ${it.rowCount} unheld datachip item(s).`);
process.exit(0);
