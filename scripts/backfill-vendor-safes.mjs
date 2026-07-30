// backfill-vendor-safes.mjs — give every existing vendor a strongbox.
//
// The safe → collect → walk-to-ATM → deposit loop (ai-behaviour.js) and the
// per-sale `vendor_credits` payout (vendor.js) were already built; only 6 of ~46
// vendors physically had a safe, so the other ~40 accumulated credits with no
// vault to hold (or rob) them. This backfills one flavoured safe per vendor that
// lacks one, keyed by vendor_npc_id.
//
// Placement: work_zone_id → zone_id → home_zone, but a work_zone_id is only
// honoured when that zone is a BUILDING the vendor actually trades out of. A
// shared industrial floor is not a shop: eight Yards traders (a fence, a
// shipwright, a soup cook…) all carry work_zone_id=zone_coldwater_turbine_hall
// because that's a work_venue employing bench hands, and the first run of this
// script duly stacked eight strongboxes in the municipal power plant. A vendor
// with no shopfront of their own keeps the box at home, which is both correct
// and better content — a Yards trader's savings under the bed is robbable.
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
const { rows: zoneRows } = await query('SELECT id, flags FROM zones');
const realZones = new Set(zoneRows.map(z => z.id));
// A work zone only counts as this vendor's shop if it's a building AND isn't a
// work_venue run by somebody else (the boss's own safe belongs there; his bench
// hands' don't). Everyone else falls through to zone_id / home_zone.
const zoneFlags = new Map(zoneRows.map(z => [z.id, z.flags || {}]));
const isOwnShop = (zoneId, npcId) => {
  const fl = zoneFlags.get(zoneId);
  if (!fl?.is_building) return false;
  const employer = fl.work_venue?.employer_npc;
  return !employer || employer === npcId;
};

let created = 0, skipped = 0, noZone = 0;

for (const npc of vendors) {
  if (await vendorHasSafe(npc.id)) { skipped++; continue; }

  const work =
    npc.work_zone_id && realZones.has(npc.work_zone_id) && isOwnShop(npc.work_zone_id, npc.id)
      ? npc.work_zone_id
      : null;
  const zone = [work, npc.zone_id, npc.home_zone].find(z => z && realZones.has(z));
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
