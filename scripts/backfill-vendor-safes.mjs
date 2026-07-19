// backfill-vendor-safes.mjs — give every existing vendor a strongbox.
//
// The safe → collect → walk-to-ATM → deposit loop (ai-behaviour.js) and the
// per-sale `vendor_credits` payout (vendor.js) were already built; only 6 of ~46
// vendors physically had a safe, so the other ~40 accumulated credits with no
// vault to hold (or rob) them. This backfills one flavoured safe per vendor that
// lacks one, keyed by vendor_npc_id.
//
// Placement: work_zone_id → zone_id → home_zone. The last catches the static
// shopkeepers (barista, pawn fence, club bartenders…) whose "home" IS their shop.
// Vendors with no zone at all are skipped and reported.
//
// Idempotent (dedupes by vendor_npc_id, so bespoke safes like furn_safe_sully are
// preserved). Local:  node scripts/backfill-vendor-safes.mjs
//           Prod:  node --env-file=.env.prod scripts/backfill-vendor-safes.mjs
import { query } from '../server/models/db.js';
import { vendorSafeRow, vendorHasSafe } from '../server/engine/vendor-safe-furniture.js';

const { rows: vendors } = await query(`
  SELECT id, name, vendor_shop_name, work_zone_id, zone_id, home_zone
  FROM npcs
  WHERE npc_type = 'vendor' OR jsonb_array_length(COALESCE(vendor_inventory, '[]'::jsonb)) > 0
  ORDER BY id`);

// Real zones only — some vendors carry a stale zone_id pointing at a zone that no
// longer exists; fall through to the next candidate rather than orphan a safe in a
// phantom zone (furniture there never renders and can't be robbed).
const { rows: zoneRows } = await query('SELECT id FROM zones');
const realZones = new Set(zoneRows.map(z => z.id));

let created = 0, skipped = 0, noZone = 0;

for (const npc of vendors) {
  if (await vendorHasSafe(npc.id)) { skipped++; continue; }

  const zone = [npc.work_zone_id, npc.zone_id, npc.home_zone].find(z => z && realZones.has(z));
  if (!zone) {
    console.log(`NOZONE ${npc.id} (${npc.name}) — no existing work/zone/home, cannot place a safe`);
    noZone++;
    continue;
  }

  const row = vendorSafeRow(npc, zone);
  const keys = Object.keys(row);
  await query(
    `INSERT INTO furniture (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})
     ON CONFLICT (id) DO NOTHING`,
    keys.map(k => row[k])
  );
  console.log(`CREATE ${row.id} → ${zone}  ("${row.name}")`);
  created++;
}

console.log(`\nDone. ${created} created, ${skipped} already had a safe, ${noZone} had no placement zone.`);
process.exit(0);
