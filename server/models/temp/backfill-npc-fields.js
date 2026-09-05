/**
 * Diagnoses and backfills NPC fields affected by the vendor/home-life system.
 *
 * What this checks:
 *   1. behaviour_graph = '{}'  → auto-assign default studio or vendor graph
 *   2. vendor_schedule = '{}' or '[]'  → assign default 10-22 schedule (any employed,
 *      non-actor NPC — vendor or not)
 *   3. schedule graph uses old HAVE_LIFE nodes where AT_HOME_LIFE is now expected
 *      (home_idle / home_life_ps nodes)  → offer to rebuild graph
 *   4. employed (non-actor) NPC has no work_zone_id  → flag (can't commute)
 *   5. npc_type = 'npc' but has a vendor_inventory  → flag for manual review
 *   6. employed (non-actor) NPC stuck on the old AT_WORK-based studio graph
 *      (arrives at work, then immediately leaves) → offer to rebuild graph
 *
 * Dry-run by default (prints what it would do).
 * Pass --apply to actually write changes.
 *
 * Run:
 *   node server/models/temp/backfill-npc-fields.js
 *   node server/models/temp/backfill-npc-fields.js --apply
 */

import 'dotenv/config';
import { query } from '../db.js';

const APPLY = process.argv.includes('--apply');

// ── Default values (must match ai-behaviour.js) ──────────────────────────────

const DEFAULT_VENDOR_SCHEDULE = {
  mon:[{from:10,to:22}], tue:[{from:10,to:22}], wed:[{from:10,to:22}],
  thu:[{from:10,to:22}], fri:[{from:10,to:22}], sat:[{from:10,to:22}], sun:[{from:10,to:22}],
};

function buildDefaultVendorGraph() {
  return {
    _start: 'start',
    nodes: {
      start:          { type:'start',  next:'check_work' },
      check_work:     { type:'action', action_type:'CHECK_VENDOR_WORK',
                        goToWork:'go_to_work', haveLife:'have_life',
                        endShift:'collect_safe', offWork:'off_home_check' },
      go_to_work:     { type:'action', action_type:'GO_TO_WORK',  next:'work_wait' },
      work_wait:      { type:'wait',   seconds:60, next:'player_check' },
      player_check:   { type:'condition', condition_type:'PLAYER_IN_ZONE',
                        ifTrue:'work_say', ifFalse:'check_work' },
      work_say:       { type:'action', action_type:'VENDOR_CHITCHAT', next:'check_work' },
      have_life:      { type:'action', action_type:'HAVE_LIFE',    next:'check_work' },
      collect_safe:   { type:'action', action_type:'VENDOR_COLLECT_SAFE', next:'go_to_atm' },
      go_to_atm:      { type:'action', action_type:'VENDOR_GO_TO_ATM',    next:'atm_emote' },
      atm_emote:      { type:'action', action_type:'EMOTE',
                        params:{ message:'steps up to the ATM terminal and makes a deposit.' },
                        next:'atm_wait' },
      atm_wait:       { type:'wait', seconds:10, next:'deposit' },
      deposit:        { type:'action', action_type:'VENDOR_DEPOSIT', next:'post_shift' },
      post_shift:     { type:'random', branches:[{weight:1},{weight:5}],
                        branch_0:'have_life', branch_1:'go_home_ps' },
      go_home_ps:     { type:'action', action_type:'GO_HOME',     next:'home_life_ps' },
      home_life_ps:   { type:'action', action_type:'AT_HOME_LIFE', next:'check_work' },
      off_home_check: { type:'condition', condition_type:'AT_HOME',
                        ifTrue:'home_idle', ifFalse:'off_random' },
      home_idle:      { type:'action', action_type:'AT_HOME_LIFE', next:'check_work' },
      off_random:     { type:'random', branches:[{weight:1},{weight:5}],
                        branch_0:'have_life', branch_1:'go_home_off' },
      go_home_off:    { type:'action', action_type:'GO_HOME', next:'check_work' },
    },
  };
}

function buildDefaultStudioGraph() {
  return {
    _start: 'start',
    nodes: {
      start:      { type:'start',  next:'have_life' },
      have_life:  { type:'action', action_type:'HAVE_LIFE',  next:'go_to_work' },
      go_to_work: { type:'action', action_type:'GO_TO_WORK', next:'at_work' },
      at_work:    { type:'action', action_type:'AT_WORK',    next:'go_home' },
      go_home:    { type:'action', action_type:'GO_HOME',    next:'home_wait' },
      home_wait:  { type:'wait',   seconds:60, next:'start' },
    },
  };
}

function buildDefaultUnemployedGraph() {
  return {
    _start: 'start',
    nodes: {
      start:      { type:'start', next:'have_life' },
      have_life:  { type:'action', action_type:'HAVE_LIFE', next:'home_check' },
      home_check: { type:'condition', condition_type:'AT_HOME', ifTrue:'home_idle', ifFalse:'have_life' },
      home_idle:  { type:'action', action_type:'AT_HOME_LIFE', next:'have_life' },
    },
  };
}

// Check whether a vendor graph has the old HAVE_LIFE home nodes instead of AT_HOME_LIFE.
function vendorGraphHasOldHomeNodes(graph) {
  if (!graph || !graph.nodes) return false;
  const nodes = graph.nodes;
  const homeNodes = ['home_idle', 'home_life_ps'];
  return homeNodes.some(k => nodes[k] && nodes[k].action_type === 'HAVE_LIFE');
}

// Check whether a graph is the old buildDefaultStudioGraph() shape (AT_WORK-based).
// That graph only holds an NPC at work via isNpcScheduledNow (broadcast actors) — a
// non-actor employed NPC stuck with it will walk to work and immediately walk home.
function isOldStudioGraphShape(graph) {
  if (!graph || !graph.nodes) return false;
  return graph.nodes.at_work?.action_type === 'AT_WORK';
}

// Is the graph empty (no _start)?
function isEmptyGraph(graph) {
  if (!graph) return true;
  if (typeof graph === 'string') {
    try { graph = JSON.parse(graph); } catch { return true; }
  }
  return !graph._start;
}

// Is the schedule empty ('{}'  or '[]' or falsy)?
function isEmptySchedule(sched) {
  if (!sched) return true;
  if (typeof sched === 'string') {
    try { sched = JSON.parse(sched); } catch { return true; }
  }
  if (Array.isArray(sched)) return true; // '[]' — wrong type
  return Object.keys(sched).length === 0;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`=== backfill-npc-fields (${APPLY ? 'APPLY' : 'DRY RUN'}) ===\n`);

  const { rows: npcs } = await query('SELECT * FROM npcs ORDER BY name');
  console.log(`Found ${npcs.length} NPC(s).\n`);

  const fixes = {
    emptyGraph: [],           // needs default graph
    emptySchedule: [],        // vendor needs default schedule
    oldHomeNodes: [],         // vendor graph uses HAVE_LIFE where AT_HOME_LIFE expected
    noWorkZone: [],           // employed (non-actor) has no work_zone_id (info only — can't auto-fix)
    mismatchedType: [],       // has vendor_inventory but npc_type != 'vendor' (info only)
    staleStudioGraph: [],     // employed (non-actor) stuck on the old AT_WORK-based studio graph
  };

  for (const npc of npcs) {
    const graph  = typeof npc.behaviour_graph === 'string'
      ? (() => { try { return JSON.parse(npc.behaviour_graph); } catch { return {}; } })()
      : (npc.behaviour_graph || {});
    const sched  = typeof npc.vendor_schedule === 'string'
      ? (() => { try { return JSON.parse(npc.vendor_schedule); } catch { return {}; } })()
      : (npc.vendor_schedule || {});
    const inv    = typeof npc.vendor_inventory === 'string'
      ? (() => { try { return JSON.parse(npc.vendor_inventory); } catch { return []; } })()
      : (npc.vendor_inventory || []);

    const isVendor     = npc.npc_type === 'vendor';
    const isUnemployed = npc.npc_type === 'unemployed';
    const isActor      = !!npc.studio_zone_id;
    // Anyone with a job who isn't a broadcast actor respects a manual schedule,
    // same as vendors (buildDefaultVendorGraph / DEFAULT_VENDOR_SCHEDULE).
    const isScheduled  = !isUnemployed && !isActor;

    // 1. Empty graph
    if (isEmptyGraph(graph)) {
      fixes.emptyGraph.push({ id: npc.id, name: npc.name, isUnemployed, isActor });
    }

    // 2. Employed (non-actor) NPC with empty/missing schedule
    if (isScheduled && isEmptySchedule(sched)) {
      fixes.emptySchedule.push({ id: npc.id, name: npc.name });
    }

    // 3. Vendor graph with old HAVE_LIFE home nodes
    if (isScheduled && !isEmptyGraph(graph) && vendorGraphHasOldHomeNodes(graph)) {
      fixes.oldHomeNodes.push({ id: npc.id, name: npc.name });
    }

    // 4. Employed (non-actor) NPC with no work_zone_id (info only)
    if (isScheduled && !npc.work_zone_id) {
      fixes.noWorkZone.push({ id: npc.id, name: npc.name });
    }

    // 6. Employed (non-actor) NPC stuck with the old studio graph (never holds at work)
    if (isScheduled && !isEmptyGraph(graph) && isOldStudioGraphShape(graph)) {
      fixes.staleStudioGraph.push({ id: npc.id, name: npc.name });
    }

    // 5. Has vendor inventory but npc_type is 'npc' (might have been created before npc_type existed)
    if (npc.npc_type !== 'vendor' && inv.length > 0) {
      fixes.mismatchedType.push({ id: npc.id, name: npc.name, npc_type: npc.npc_type, inv_count: inv.length });
    }
  }

  // ── Report ──────────────────────────────────────────────────────────────────

  console.log("── 1. Empty behaviour_graph (NPC doesn't tick at all) ──────────────────");
  if (!fixes.emptyGraph.length) {
    console.log('   ✓ None.');
  } else {
    for (const f of fixes.emptyGraph) {
      const graphType = f.isUnemployed ? 'buildDefaultUnemployedGraph' : f.isActor ? 'buildDefaultStudioGraph' : 'buildDefaultVendorGraph';
      console.log(`   ✗ ${f.id.padEnd(35)} (${f.name}) → assign ${graphType}()`);
    }
  }

  console.log('\n── 2. Employed NPC with empty vendor_schedule (never goes to work) ──────');
  if (!fixes.emptySchedule.length) {
    console.log('   ✓ None.');
  } else {
    for (const f of fixes.emptySchedule) {
      console.log(`   ✗ ${f.id.padEnd(35)} (${f.name}) → assign DEFAULT_VENDOR_SCHEDULE`);
    }
  }

  console.log('\n── 3. Vendor graph with old HAVE_LIFE home nodes (no sleep cycle) ───────');
  if (!fixes.oldHomeNodes.length) {
    console.log('   ✓ None.');
  } else {
    for (const f of fixes.oldHomeNodes) {
      console.log(`   ✗ ${f.id.padEnd(35)} (${f.name}) → rebuild with buildDefaultVendorGraph()`);
    }
  }

  console.log('\n── 4. Employed NPC with no work_zone_id (info only — manual fix required) ');
  if (!fixes.noWorkZone.length) {
    console.log('   ✓ None.');
  } else {
    for (const f of fixes.noWorkZone) {
      console.log(`   ⚠  ${f.id.padEnd(35)} (${f.name}) → set work_zone_id in dev panel`);
    }
  }

  console.log('\n── 5. npc_type=npc but has vendor_inventory (possible stale type) ───────');
  if (!fixes.mismatchedType.length) {
    console.log('   ✓ None.');
  } else {
    for (const f of fixes.mismatchedType) {
      console.log(`   ⚠  ${f.id.padEnd(35)} (${f.name}) npc_type=${f.npc_type}, ${f.inv_count} inventory items → manually set npc_type=vendor if this is a shop`);
    }
  }

  console.log('\n── 6. Employed NPC stuck on the old studio graph (arrives at work, leaves immediately) ');
  if (!fixes.staleStudioGraph.length) {
    console.log('   ✓ None.');
  } else {
    for (const f of fixes.staleStudioGraph) {
      console.log(`   ✗ ${f.id.padEnd(35)} (${f.name}) → rebuild with buildDefaultVendorGraph()`);
    }
  }

  // ── Apply ───────────────────────────────────────────────────────────────────

  const totalAuto = fixes.emptyGraph.length + fixes.emptySchedule.length + fixes.oldHomeNodes.length + fixes.staleStudioGraph.length;

  if (!APPLY) {
    console.log(`\n${'─'.repeat(70)}`);
    if (totalAuto === 0) {
      console.log('\n✓ Nothing to backfill. All NPC fields look correct.');
    } else {
      console.log(`\n${totalAuto} auto-fixable issue(s) found. Re-run with --apply to write changes:`);
      console.log('  node server/models/temp/backfill-npc-fields.js --apply');
    }
    const manualCount = fixes.noWorkZone.length + fixes.mismatchedType.length;
    if (manualCount) console.log(`\n${manualCount} manual item(s) require dev-panel edits (see above).`);
    process.exit(0);
  }

  // Apply fixes
  console.log(`\n${'─'.repeat(70)}`);
  console.log('\nApplying fixes...\n');

  let changed = 0;

  // Fix 1: empty graphs
  for (const f of fixes.emptyGraph) {
    const graph = f.isUnemployed ? buildDefaultUnemployedGraph() : f.isActor ? buildDefaultStudioGraph() : buildDefaultVendorGraph();
    await query('UPDATE npcs SET behaviour_graph=$1 WHERE id=$2', [JSON.stringify(graph), f.id]);
    const label = f.isUnemployed ? 'unemployed graph' : f.isActor ? 'studio graph' : 'schedule graph';
    console.log(`  ✓ ${f.id} (${f.name}) → assigned ${label}`);
    changed++;
  }

  // Fix 2: empty vendor schedules
  for (const f of fixes.emptySchedule) {
    await query('UPDATE npcs SET vendor_schedule=$1 WHERE id=$2', [JSON.stringify(DEFAULT_VENDOR_SCHEDULE), f.id]);
    console.log(`  ✓ ${f.id} (${f.name}) → assigned default vendor schedule`);
    changed++;
  }

  // Fix 3: old home-life nodes in vendor graphs
  for (const f of fixes.oldHomeNodes) {
    const graph = buildDefaultVendorGraph();
    await query('UPDATE npcs SET behaviour_graph=$1 WHERE id=$2', [JSON.stringify(graph), f.id]);
    console.log(`  ✓ ${f.id} (${f.name}) → rebuilt vendor graph with AT_HOME_LIFE nodes`);
    changed++;
  }

  // Fix 6: employed NPCs stuck on the old AT_WORK-based studio graph
  for (const f of fixes.staleStudioGraph) {
    const graph = buildDefaultVendorGraph();
    await query('UPDATE npcs SET behaviour_graph=$1 WHERE id=$2', [JSON.stringify(graph), f.id]);
    console.log(`  ✓ ${f.id} (${f.name}) → rebuilt with schedule-respecting graph`);
    changed++;
  }

  if (changed === 0) {
    console.log('  Nothing to apply.');
  } else {
    console.log(`\n${changed} NPC(s) updated.`);
    console.log('\nRestart the server (or trigger world reload) to pick up behaviour graph changes.');
  }

  const manualCount = fixes.noWorkZone.length + fixes.mismatchedType.length;
  if (manualCount) {
    console.log(`\n${manualCount} item(s) still require manual dev-panel edits:`);
    for (const f of fixes.noWorkZone)     console.log(`  ⚠  ${f.id} (${f.name}) — set work_zone_id`);
    for (const f of fixes.mismatchedType) console.log(`  ⚠  ${f.id} (${f.name}) — set npc_type=vendor`);
  }

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
