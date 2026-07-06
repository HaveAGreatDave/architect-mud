// Give the Embassy's two staff — Lowry Cormack (bartender) and Orion Dex (house
// card dealer) — apartments in the building they work in, and a daily 04:00–08:00
// off-shift window so they clock out, head upstairs to sleep, and clock back on.
//
// WHAT THIS SETS (both NPCs):
//   • home_zone  → an unclaimed Embassy unit one step off the lobby, so GO_HOME /
//     AT_HOME_LIFE (the vendor graph's off-shift path) walks them home to sleep.
//       Lowry → zone_apt_9 (Unit 3A),  Orion → zone_apt_10 (Unit 3B) — neighbours
//     on the third-floor landing. Both are absent from the `apartments` housing
//     ledger, so no player can rent the unit an NPC lives in.
//   • vendor_schedule → on all day EXCEPT 04:00–08:00, i.e. two blocks/day
//     [{from:0,to:4},{from:8,to:24}]. isVendorWorkTime() reads this; the shift ends
//     at 04:00 (one endShift → the lobby ATM cash-up, then home) and resumes at 08:00.
//   • behaviour_graph → the standard vendor graph (CHECK_VENDOR_WORK-driven). Lowry
//     already runs it; Orion is switched from his static stay-at-the-felt graph so
//     he actually commutes home on the break. On-shift both hold at the lobby.
//
// Rewrites EXISTING rows → not covered by the additive prod deploy; the reserved
// data-transformation one-shot. Dry-run by default.
//
//   node scripts/house-embassy-staff.mjs            # local, dry run (default)
//   node scripts/house-embassy-staff.mjs --apply    # local, write
//   node --env-file=.env.prod scripts/house-embassy-staff.mjs --apply   # prod
//
import 'dotenv/config';
import { query } from '../server/models/db.js';
import { buildDefaultVendorGraph } from '../server/engine/ai-behaviour.js';

const APPLY = process.argv.includes('--apply');

// On all day except the 04:00–08:00 break: hours 0–3 and 8–23 are working.
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const OFF_0408 = Object.fromEntries(
  DAY_KEYS.map(d => [d, [{ from: 0, to: 4 }, { from: 8, to: 24 }]])
);

const STAFF = [
  { id: 'npc_embassy_barkeep', name: 'Lowry Cormack', home: 'zone_apt_9',  unit: 'Unit 3A' },
  { id: 'npc_orion_dex',       name: 'Orion Dex',     home: 'zone_apt_10', unit: 'Unit 3B' },
];

async function main() {
  console.log(`=== house-embassy-staff (${APPLY ? 'APPLY' : 'DRY RUN'}) ===\n`);

  // Guard: the chosen homes must exist, be apartments, and not be a rented/owned unit.
  for (const s of STAFF) {
    const { rows: z } = await query(`SELECT flags FROM zones WHERE id=$1`, [s.home]);
    if (!z.length) { console.error(`  ✗ ${s.home} does not exist — aborting.`); process.exit(1); }
    if (z[0].flags?.is_apartment !== true) { console.error(`  ✗ ${s.home} is not an apartment — aborting.`); process.exit(1); }
    const { rows: owned } = await query(
      `SELECT owner_handle FROM apartments WHERE zone_id=$1 AND (owner_id IS NOT NULL OR owner_handle IS NOT NULL)`, [s.home]
    ).catch(() => ({ rows: [] }));
    if (owned.length) { console.error(`  ✗ ${s.home} is owned by ${owned[0].owner_handle} — pick another unit.`); process.exit(1); }
  }

  const graph = JSON.stringify(buildDefaultVendorGraph());

  for (const s of STAFF) {
    const { rows: before } = await query(
      `SELECT home_zone, vendor_schedule FROM npcs WHERE id=$1`, [s.id]
    );
    if (!before.length) { console.error(`  ✗ NPC ${s.id} not found — aborting.`); process.exit(1); }
    console.log(`${s.name} (${s.id})`);
    console.log(`  home_zone      : ${before[0].home_zone}  →  ${s.home} (${s.unit})`);
    console.log(`  vendor_schedule: off 04:00–08:00 daily  (mon e.g. ${JSON.stringify(OFF_0408.mon)})`);
    console.log(`  behaviour_graph: standard vendor graph (CHECK_VENDOR_WORK)\n`);

    if (APPLY) {
      await query(
        `UPDATE npcs SET home_zone=$1, vendor_schedule=$2, behaviour_graph=$3 WHERE id=$4`,
        [s.home, JSON.stringify(OFF_0408), graph, s.id]
      );
    }
  }

  if (APPLY) console.log(`✓ APPLIED. Restart the server (or /world reload) to reload NPCs from DB.`);
  else console.log(`Re-run with --apply to write:\n  node scripts/house-embassy-staff.mjs --apply`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
