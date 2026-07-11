// One-shot PROD data fix — run AFTER the Phase 6 deploy (c1f964e5, the legacy
// overworld decommission). Relocates flight runtime state that still pointed at
// the four outlying airfields deleted in Phase 6 onto Coldwater Regional, the
// surviving regional field.
//
//   node --env-file=.env.prod scripts/phase6-relocate-flight.mjs   (prod)
//   node scripts/phase6-relocate-flight.mjs                        (local)
//
// This is a DATA transformation, not content: it rewrites existing runtime rows
// (aircraft.parked_zone_id, flight_contracts, flight quest instances) that the
// additive content deploy can't touch. Idempotent — a second run finds nothing
// left to move. Restart the server (or /world reload) afterwards so the aircraft
// and turf load back into memory.
import { query } from '../server/models/db.js';

// The surviving regional field the retired outliers fold into.
const TARGET_ZONE = 'zone_district_925_903';        // Coldwater Regional (af_regional)
const TARGET_MAP = 'map_world', TARGET_GX = 925, TARGET_GY = 903;

// The four outlying airfields + their hangar interiors deleted in Phase 6.
const RETIRED = [
  'zone_dock_slip', 'zone_slag_gate', 'zone_waste_scald', 'zone_yard_marshalling',
  'zone_hangar_dock_slip', 'zone_hangar_slag_gate', 'zone_hangar_waste_scald', 'zone_hangar_yard_marshalling',
];

async function main() {
  // Refuse to move anything onto a target that isn't there (guards a bad deploy).
  const { rows: tgt } = await query('SELECT id FROM zones WHERE id=$1', [TARGET_ZONE]);
  if (!tgt.length) { console.error(`✗ target zone ${TARGET_ZONE} not found — aborting (did Phase 6 deploy?).`); process.exit(1); }

  // 1) Aircraft parked at a retired field/hangar — or any craft whose parked_zone_id
  //    now dangles because its zone was deleted — get parked at Coldwater Regional,
  //    on the ground, cold. (Airborne craft have a null parked_zone_id and are skipped.)
  const { rows: stranded } = await query(
    `SELECT id, name, parked_zone_id FROM aircraft
      WHERE parked_zone_id IS NOT NULL
        AND (parked_zone_id = ANY($1) OR parked_zone_id NOT IN (SELECT id FROM zones))`,
    [RETIRED]
  );
  for (const a of stranded) {
    await query(
      `UPDATE aircraft SET parked_zone_id=$1, map_id=$2, grid_x=$3, grid_y=$4,
              airborne=0, altitude_band='ground', throttle=0, engine_on=0, hangar_id=NULL
        WHERE id=$5`,
      [TARGET_ZONE, TARGET_MAP, TARGET_GX, TARGET_GY, a.id]
    );
    console.log(`  ✈ ${a.id} (${a.name || '—'}): ${a.parked_zone_id} → ${TARGET_ZONE}`);
  }
  console.log(`✓ Relocated ${stranded.length} aircraft onto Coldwater Regional.`);

  // 2) Legacy flight_contracts (open/active only — historical rows stay as flown)
  //    whose origin or destination was a retired field → repoint to the target.
  const fcDest = await query(
    `UPDATE flight_contracts SET dest_zone=$1 WHERE dest_zone = ANY($2) AND status IN ('open','active')`,
    [TARGET_ZONE, RETIRED]);
  const fcOrig = await query(
    `UPDATE flight_contracts SET origin_zone=$1 WHERE origin_zone = ANY($2) AND status IN ('open','active')`,
    [TARGET_ZONE, RETIRED]);
  console.log(`✓ flight_contracts repointed: ${fcDest.rowCount} dest, ${fcOrig.rowCount} origin.`);

  // 3) Unified-quest flight instances (quest_type='flight', the live model after the
  //    job-board/contract unification) whose meta.destZone / meta.originZone is a
  //    retired field → rewrite the key in place. Covers ephemeral board rolls and
  //    any a player has already accepted (their player_quests ride along).
  const { rows: flQuests } = await query(
    `SELECT id, meta FROM quests
      WHERE quest_type='flight' AND (meta->>'destZone' = ANY($1) OR meta->>'originZone' = ANY($1))`,
    [RETIRED]);
  for (const q of flQuests) {
    const m = q.meta || {};
    if (RETIRED.includes(m.destZone)) m.destZone = TARGET_ZONE;
    if (RETIRED.includes(m.originZone)) m.originZone = TARGET_ZONE;
    await query('UPDATE quests SET meta=$1 WHERE id=$2', [JSON.stringify(m), q.id]);
    console.log(`  ⛃ ${q.id}: → ${TARGET_ZONE}`);
  }
  console.log(`✓ Relocated ${flQuests.length} flight quest instance(s).`);

  console.log('\n✓ Done. Restart the server (or /world reload) to reload aircraft into memory.');
}

main().then(() => process.exit(0)).catch(e => { console.error('✗ relocate failed:', e); process.exit(1); });
