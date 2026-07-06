// Give the five Halcyon Assurance staff a work schedule + a commuter behaviour
// graph so they actually walk to their desks by day and retire to their new Sky
// Hall flats at night (built in build-halcyon-residences.mjs).
//
// COMMUTER GRAPH: the standard vendor graph, minus the shift-end safe/ATM cash-up.
// The game's only ATM is in the Embassy across town, so the stock graph would march
// these office workers out of the tower every evening. We reuse buildDefaultVendorGraph
// (so the node format stays exactly right) and just re-route shift-end straight home.
//
// SCHEDULE: 08:00–20:00 daily. Insurance is gated by the desk ZONE flag, not by an
// NPC being present (insurance/index.js), so an empty desk overnight doesn't stop a
// player buying or claiming — it just means the staff are home asleep. Hours are
// per-NPC data; tune freely.
//
// Rewrites existing rows → the reserved data-transform one-shot. Dry-run by default.
//
//   node scripts/schedule-halcyon-staff.mjs            # local, dry run
//   node scripts/schedule-halcyon-staff.mjs --apply    # local, write
//   node --env-file=.env.prod scripts/schedule-halcyon-staff.mjs --apply   # prod
//
import 'dotenv/config';
import { query } from '../server/models/db.js';
import { buildDefaultVendorGraph } from '../server/engine/ai-behaviour.js';

const APPLY = process.argv.includes('--apply');

// Standard vendor routine with the shift-end ATM cash-up pruned: endShift routes
// straight to the go-home node, and the safe/ATM/deposit nodes are removed.
function buildCommuterGraph() {
  const g = buildDefaultVendorGraph();
  g.nodes.check_work.endShift = 'go_home_ps';                 // was 'collect_safe'
  for (const n of ['collect_safe', 'go_to_atm', 'atm_emote', 'atm_wait', 'deposit', 'post_shift'])
    delete g.nodes[n];
  return g;
}

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const NINE_TO_LATE = Object.fromEntries(DAYS.map(d => [d, [{ from: 8, to: 20 }]])); // 08:00–20:00

const STAFF = [
  'npc_halcyon_reception', 'npc_halcyon_vp', 'npc_halcyon_adjuster',
  'npc_halcyon_underwriter', 'npc_halcyon_kiosk',
];

async function main() {
  console.log(`=== schedule-halcyon-staff (${APPLY ? 'APPLY' : 'DRY RUN'}) ===\n`);
  const graph = JSON.stringify(buildCommuterGraph());
  console.log(`commuter graph nodes: ${Object.keys(buildCommuterGraph().nodes).join(', ')}`);
  console.log(`schedule: 08:00–20:00 daily\n`);

  for (const id of STAFF) {
    const { rows } = await query(`SELECT name, work_zone_id, home_zone FROM npcs WHERE id=$1`, [id]);
    if (!rows.length) { console.log(`  ✗ ${id} not found — SKIPPED`); continue; }
    const r = rows[0];
    console.log(`  ${r.name.padEnd(14)} work=${(r.work_zone_id||'-').padEnd(28)} home=${r.home_zone}`);
    if (APPLY) {
      await query(`UPDATE npcs SET behaviour_graph=$1, vendor_schedule=$2 WHERE id=$3`,
        [graph, JSON.stringify(NINE_TO_LATE), id]);
    }
  }
  console.log(APPLY ? `\n✓ APPLIED. Restart / world reload to load the graphs + schedules.`
                    : `\nRe-run with --apply to write.`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
