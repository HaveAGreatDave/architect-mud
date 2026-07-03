// add-vendor-safes.js — place a vendor safe in every dedicated shop-building
// work zone that lacks one. A vendor safe is a `furniture` fixture flagged
// `vendor_safe:true` + `vendor_npc_id`; it physically holds that vendor's
// accumulated `vendor_credits` and is hackable via the vendor-safe plugin's
// `hack safe` → VAULT CRACK minigame (difficulty 5).
//
// Scope: interior shop-building vendors (is_building work zones). Cassius,
// Juno, Marta, Elio already have safes; the dock/waste/tunnel stall vendors
// work outdoors (no building) and are intentionally excluded. Residential-unit
// vendors (Reg, Lowry) sell out of apartments, not shop buildings, so they're
// excluded too. Idempotent: re-running skips safes that already exist.
import { query } from '../server/models/db.js';

const SAFES = [
  {
    id: 'furn_safe_sully',
    zone_id: 'zone_mq_pigeon_bar',
    npc_id: 'npc_barkeep',
    name: "Sully's till-safe",
    description:
      "A dented floor safe wedged into the cabinet under the back bar, half-hidden behind a crate of empties and a mop that has seen things. The dial is worn smooth from a decade of the same fingers. A strip of duct tape across the top reads, in marker: NOT THE TIP JAR.",
  },
  {
    id: 'furn_safe_quartermaster',
    zone_id: 'zone_weapons_shop',
    npc_id: 'npc_quartermaster',
    name: 'the Quartermaster’s munitions safe',
    description:
      "A slab-sided military strongbox bolted to the deck behind the counter, olive drab under the rust, stencilled PROPERTY OF NOBODY ANYMORE. The combination wheel is caged behind a fold-down armoured shroud, and a faded sticker warns that tampering voids a warranty that expired with the old world.",
  },
];

let created = 0, skipped = 0;

for (const s of SAFES) {
  // Skip if this vendor already has ANY vendor safe, or this id is taken.
  const { rows: existing } = await query(
    `SELECT id FROM furniture
     WHERE id=$1 OR flags @> $2::jsonb`,
    [s.id, JSON.stringify({ vendor_safe: true, vendor_npc_id: s.npc_id })]
  );
  if (existing.length) {
    console.log(`SKIP  ${s.id} (vendor ${s.npc_id} already has a safe: ${existing[0].id})`);
    skipped++;
    continue;
  }
  await query(
    `INSERT INTO furniture (id,zone_id,name,description,object_type,price,flags)
     VALUES ($1,$2,$3,$4,'fixture',600,$5)`,
    [
      s.id,
      s.zone_id,
      s.name,
      s.description,
      JSON.stringify({ vendor_safe: true, vendor_npc_id: s.npc_id, hack_difficulty: 5 }),
    ]
  );
  console.log(`CREATE ${s.id} in ${s.zone_id} for ${s.npc_id}`);
  created++;
}

console.log(`\nDone. ${created} created, ${skipped} skipped.`);
process.exit(0);
