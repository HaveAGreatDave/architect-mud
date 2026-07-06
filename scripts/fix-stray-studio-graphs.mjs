// Repair NPCs that carry a studio (broadcast-actor) behaviour_graph but are NOT
// legitimate studio actors — the class of bug behind "Lowry the bartender keeps
// wandering off his work zone".
//
// WHY: the studio graph (HAVE_LIFE → GO_TO_WORK → AT_WORK → GO_HOME) gates every
// node on isNpcScheduledNow(), which is true ONLY while the NPC is slotted into a
// LIVE broadcast show. A non-broadcast NPC is never "scheduled", so AT_WORK never
// holds and HAVE_LIFE walks it to a random map_world zone every tick. A vendor's
// own vendor_schedule is never consulted, because the studio graph doesn't call
// CHECK_VENDOR_WORK. The broadcast plugin's self-heal (recalculateNpcSchedules)
// only rescues strays whose work_zone_id IS a studio zone, so any stray with a
// NULL work_zone_id slips through and wanders forever.
//
// FIX (single source of truth): for each NPC with a studio-shaped graph that is
// NOT a legit studio actor (no studio_zone_id AND not listed in any playlist
// item's npc_staff), null the graph and let the engine's own ensureBehaviourGraph
// reassign the correct default — vendor graph for an employed NPC (e.g. Lowry),
// unemployed graph for an unemployed NPC, or graphless (static set-piece) for a
// roleless NPC. No graph builders are duplicated here.
//
// Rewrites EXISTING rows, so it is not covered by the additive prod deploy
// (INSERT … ON CONFLICT DO NOTHING) — the reserved data-transformation one-shot.
// Dry-run by default.
//
//   node scripts/fix-stray-studio-graphs.mjs            # local, dry run (default)
//   node scripts/fix-stray-studio-graphs.mjs --apply    # local, write
//   node --env-file=.env.prod scripts/fix-stray-studio-graphs.mjs --apply   # prod
//
import 'dotenv/config';
import { query } from '../server/models/db.js';
import { ensureBehaviourGraph } from '../server/engine/ai-behaviour.js';

const APPLY = process.argv.includes('--apply');

// A studio-shaped graph holds an AT_WORK + HAVE_LIFE loop with no CHECK_VENDOR_WORK
// branch (which is the vendor graph's schedule gate). Matches both the engine's
// buildDefaultStudioGraph and the broadcast plugin's makeDefaultStudioGraph.
function isStudioShaped(g) {
  if (!g) return false;
  if (typeof g === 'string') { try { g = JSON.parse(g); } catch { return false; } }
  const nodes = g.nodes;
  if (!nodes) return false;
  const acts = new Set(Object.values(nodes).map(n => n.action_type || n.condition_type).filter(Boolean));
  return acts.has('AT_WORK') && acts.has('HAVE_LIFE') && !acts.has('CHECK_VENDOR_WORK');
}

async function main() {
  console.log(`=== fix-stray-studio-graphs (${APPLY ? 'APPLY' : 'DRY RUN'}) ===`);

  // Authoritative set of legitimately-staffed studio NPCs, from every playlist
  // item's persisted npc_staff list (live/weather staffing already reconciled by
  // the broadcast plugin's recalc into conditions.npc_staff).
  const { rows: plRows } = await query(`SELECT conditions FROM media_channel_playlist`);
  const legitStaff = new Set();
  for (const r of plRows) {
    let cond = r.conditions;
    if (typeof cond === 'string') { try { cond = JSON.parse(cond); } catch { cond = {}; } }
    if (Array.isArray(cond?.npc_staff)) cond.npc_staff.forEach(id => legitStaff.add(id));
  }

  const { rows } = await query(`SELECT * FROM npcs ORDER BY name`);
  const repairs = [];
  for (const row of rows) {
    if (!isStudioShaped(row.behaviour_graph)) continue;
    if (row.studio_zone_id) continue;          // has a studio column → legit actor
    if (legitStaff.has(row.id)) continue;      // staffed on a live show → legit actor

    const before = row.behaviour_graph;
    row.behaviour_graph = null;
    const did = ensureBehaviourGraph(row, 'npc'); // mutates row.behaviour_graph
    const target = did
      ? `${row.behaviour_graph._start ? Object.keys(row.behaviour_graph.nodes).length + '-node ' : ''}${row.studio_zone_id ? 'studio' : row.npc_type === 'unemployed' ? 'unemployed' : row.work_zone_id ? 'vendor/employed' : 'vendor'} graph`
      : 'graphless (static set-piece)';
    repairs.push({ id: row.id, name: row.name, npc_type: row.npc_type, work_zone_id: row.work_zone_id, did, newGraph: did ? JSON.stringify(row.behaviour_graph) : null, target });
  }

  if (!repairs.length) {
    console.log('\n✓ No stray studio graphs found — nothing to repair.');
    process.exit(0);
  }

  console.log(`\nFound ${repairs.length} NPC(s) with a stray studio graph:\n`);
  for (const r of repairs) {
    console.log(`  ${r.did ? '✓' : '·'} ${String(r.id).padEnd(24)} ${String(r.name || '').padEnd(20)} [type=${r.npc_type}, work=${r.work_zone_id || '-'}]  →  ${r.target}`);
  }

  if (APPLY) {
    for (const r of repairs) {
      await query(`UPDATE npcs SET behaviour_graph=$1 WHERE id=$2`, [r.newGraph, r.id]);
    }
    console.log(`\n✓ APPLIED: ${repairs.length} NPC(s) updated. Restart the server (or /world reload) to reload from DB.`);
  } else {
    console.log(`\nRe-run with --apply to write:\n  node scripts/fix-stray-studio-graphs.mjs --apply`);
  }
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
