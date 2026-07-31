// One-shot: un-strand the Franchise Strip dispatcher after the job board moved
// from zone_district_919_904 to zone_district_919_908.
//
// `npcs.zone_id` is a RUNTIME column (export-excluded), so the content move of
// home_zone/work_zone_id could not carry it — she stayed physically standing at
// the old tile, one block from her own board. She has wanders:0, so nothing was
// ever going to move her back. With her off-board, the co-location rule refuses
// every `gigs take`, and turnInNpcForQuest finds nobody to hand in to.
//
// Setting zone_id NULL is deliberate: the engine falls back to home_zone when it
// is null, which is exactly how a fresh content import places her. Self-healing,
// and correct wherever this is run.
//
// Local:  node scripts/relocate-fs-dispatcher.mjs
// Prod:   node --env-file=.env.prod scripts/relocate-fs-dispatcher.mjs   (once, after the deploy)
import { query } from '../server/models/db.js';

const { rows: before } = await query(
  `SELECT id, name, zone_id, home_zone FROM npcs WHERE id = 'npc_fs_dispatcher'`
);
if (!before.length) {
  console.log('npc_fs_dispatcher not present — nothing to do.');
  process.exit(0);
}
console.log(`before: ${before[0].name} at zone_id=${before[0].zone_id} (home_zone=${before[0].home_zone})`);

const r = await query(
  `UPDATE npcs SET zone_id = NULL
    WHERE id = 'npc_fs_dispatcher' AND zone_id IS DISTINCT FROM home_zone`
);
console.log(r.rowCount
  ? 'Cleared stale zone_id — she now resolves to her home_zone (the board).'
  : 'Already co-located with her board; no change.');
process.exit(0);
