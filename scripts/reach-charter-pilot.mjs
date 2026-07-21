// scripts/reach-charter-pilot.mjs — one-shot content authoring.
//
// Opens a charter desk at Buzzard Field and puts Cass Renner behind it.
//
// The Reach is air-only, so a player who flies in and loses their aircraft was
// genuinely marooned — no NPC ride existed anywhere in the region. Cass already
// runs the field and already flew contraband for a living ("she flew contraband
// into worse places than this"), so she's the charter rather than a new NPC.
//
// Two pieces:
//   1. zones.flags.airfield_charter on Buzzard Field — charter.js:225 refuses
//      with "There's no charter desk here" without it.
//   2. npcs.flags.charter_pilot = { field, shift_start } on Cass. The lookup is
//      getNpcsByFlag('charter_pilot') — keyed on the FLAG, not the personality
//      (that's why Examiner Reyes, who has the personality but no flag block,
//      isn't a bookable ride). Her personality stays `guard`: gatekeeping the
//      only door into the Reach is still her actual job.
//
// ⚠ Her vendor_schedule is CLEARED, matching all four existing charter pilots.
// charter.js `syncPilots()` owns a pilot's position from `shift_start` (a fixed
// 8-hour shift) and hard-relocates them every tick; leaving a vendor_schedule on
// her would put the commute graph's GO_TO_WORK/GO_HOME in a tug-of-war with it.
// She still sleeps at her cabin — pilotTarget() sends an off-shift pilot to
// home_zone, which is already zone_bld_900_1171_cabin_cass.
//
// Idempotent. Writes the DB and both content files.
//
//   node scripts/reach-charter-pilot.mjs                     # local dev DB
//   node --env-file=.env.prod scripts/reach-charter-pilot.mjs # prod

import { writeFileSync } from 'node:fs';
import { query } from '../server/models/db.js';
import { contentEntries } from '../server/models/content-registry.js';
import { CONTENT_DIR, canonicalJson, fileNameForRow, rowToFileObject } from './content/lib.mjs';

const CASS  = 'npc_1784516450269';
const FIELD = 'zone_the_reach_870_1958';   // Buzzard Field (hangar_interior_zone → zone_bld_897_1175_lobby)
const SHIFT_START = 8;                      // 0800–1600; the strip is a daylight operation

async function syncFile(table, id) {
  const entry = contentEntries().find(e => e.table === table);
  const { rows } = await query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
  if (!rows.length) throw new Error(`${table}/${id} vanished`);
  writeFileSync(`${CONTENT_DIR}/${table}/${fileNameForRow(entry, rows[0])}`,
    canonicalJson(rowToFileObject(entry, rows[0])), 'utf8');
}

async function main() {
  const { rows: field } = await query('SELECT flags FROM zones WHERE id = $1', [FIELD]);
  if (!field.length) throw new Error(`${FIELD} not found`);
  if (field[0].flags?.hangar_interior_zone == null) {
    throw new Error(`${FIELD} has no hangar_interior_zone — the pilot would have no desk to sit at`);
  }
  // charter_vtol_only would ALSO make the field VTOL-only for everyone
  // (state.js:380 folds it into airfield_vtol_only), which would break the
  // fixed-wing raws runs off the dirt strip. Never set it here.
  await query(
    `UPDATE zones SET flags = jsonb_set(COALESCE(flags,'{}'::jsonb), '{airfield_charter}', 'true') WHERE id = $1`,
    [FIELD]);
  console.log(`  ✓ ${FIELD}: charter desk open`);

  const { rows: cass } = await query('SELECT flags, home_zone FROM npcs WHERE id = $1', [CASS]);
  if (!cass.length) throw new Error(`${CASS} (Cass Renner) not found`);
  const flags = { ...(cass[0].flags || {}), charter_pilot: { field: FIELD, shift_start: SHIFT_START } };
  await query('UPDATE npcs SET flags = $2, vendor_schedule = $3 WHERE id = $1',
    [CASS, JSON.stringify(flags), '{}']);
  const p = h => String(h % 24).padStart(2, '0') + '00';
  console.log(`  ✓ Cass Renner: charter pilot, ${p(SHIFT_START)}–${p(SHIFT_START + 8)}, home ${cass[0].home_zone}`);

  await syncFile('zones', FIELD);
  await syncFile('npcs', CASS);
  console.log('\nDone. Restart or /world/reload, then `charter` at Buzzard Field.');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
