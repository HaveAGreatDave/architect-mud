// Backfill stored behaviour_graph for NPCs and enemies to match what the engine
// already assigns them at runtime.
//
// WHY: every tick, ensureBehaviourGraph() (server/engine/ai-behaviour.js, called
// from gameLoop.js) hands any graphless entity a type-appropriate default graph
// IN MEMORY — so aggressive enemies and autonomous NPCs behave via VINE, but their
// DB behaviour_graph column stays empty. The dev-panel VINE editor, exports, and
// the DB therefore all show "no graph" for entities that are in fact running one.
// This one-shot persists that same in-memory assignment to the DB so the stored
// state matches the running state. Faithful mirror only — ZERO behaviour change.
//
// SINGLE SOURCE OF TRUTH: it calls the engine's own ensureBehaviourGraph(). There
// is deliberately NO copy of the graph builders here (the older
// server/models/temp/backfill-npc-fields.js duplicated them, which drifts). What
// the engine leaves graphless at runtime — static 'npc' set-pieces, patrol/passive
// enemies, phantoms — this leaves graphless too. It never touches a row that
// already carries a graph.
//
// This rewrites EXISTING rows, so it is not covered by the additive prod deploy
// (INSERT … ON CONFLICT DO NOTHING) — it is exactly the reserved data-transformation
// one-shot. Dry-run by default.
//
//   node scripts/backfill-behaviour-graphs.mjs            # local, dry run (default)
//   node scripts/backfill-behaviour-graphs.mjs --apply    # local, write
//   node --env-file=.env.prod scripts/backfill-behaviour-graphs.mjs --apply   # prod
//
import 'dotenv/config';
import { query } from '../server/models/db.js';
import { ensureBehaviourGraph } from '../server/engine/ai-behaviour.js';

const APPLY = process.argv.includes('--apply');

function hasGraph(g) {
  if (!g) return false;
  if (typeof g === 'string') { try { g = JSON.parse(g); } catch { return false; } }
  return !!(g._start || (g.nodes && Object.keys(g.nodes).length));
}

async function backfill(kind, table) {
  const { rows } = await query(`SELECT * FROM ${table} ORDER BY name`);
  const assigned = [];   // rows we gave a default graph
  const skipped = [];    // rows the engine intentionally leaves graphless
  const already = [];    // rows that already carry a graph

  for (const row of rows) {
    if (hasGraph(row.behaviour_graph)) { already.push(row); continue; }
    // Clear any junk shell (e.g. {"nodes":{},"_start":""}) first: those stray keys
    // make ensureBehaviourGraph think a graph is already present and refuse to heal
    // it — which also blocks the runtime self-heal, leaving the entity on the dumb
    // fallback. Nulling it lets the engine assign the proper default.
    row.behaviour_graph = null;
    // ensureBehaviourGraph mutates row.behaviour_graph and returns true when it
    // assigns one. Pass kind explicitly — DB template rows have no instanceId.
    const did = ensureBehaviourGraph(row, kind);
    if (did) assigned.push(row);
    else skipped.push(row);
  }

  console.log(`\n=== ${kind.toUpperCase()}S (${rows.length} total) ===`);
  console.log(`  already have a graph : ${already.length}`);
  console.log(`  to assign            : ${assigned.length}`);
  console.log(`  left graphless (engine default) : ${skipped.length}`);

  if (assigned.length) {
    console.log(`\n  Will assign:`);
    for (const r of assigned) {
      const startNode = r.behaviour_graph._start;
      const n = Object.keys(r.behaviour_graph.nodes || {}).length;
      const tag = kind === 'enemy'
        ? r.behavior
        : (r.studio_zone_id ? 'studio' : r.npc_type === 'unemployed' ? 'unemployed' : 'vendor/employed');
      console.log(`    ✓ ${String(r.id).padEnd(34)} ${String(r.name).padEnd(28)} [${tag}] → ${n}-node graph (_start=${startNode})`);
    }
  }
  if (skipped.length) {
    console.log(`\n  Left graphless (this IS their current behaviour):`);
    for (const r of skipped) {
      const tag = kind === 'enemy' ? r.behavior : (r.npc_type || 'npc');
      console.log(`    · ${String(r.id).padEnd(34)} ${String(r.name).padEnd(28)} [${tag}]`);
    }
  }

  if (APPLY && assigned.length) {
    for (const r of assigned) {
      await query(`UPDATE ${table} SET behaviour_graph=$1 WHERE id=$2`,
        [JSON.stringify(r.behaviour_graph), r.id]);
    }
    console.log(`\n  APPLIED: ${assigned.length} ${kind}(s) updated.`);
  }

  return assigned.length;
}

async function main() {
  console.log(`=== backfill-behaviour-graphs (${APPLY ? 'APPLY' : 'DRY RUN'}) ===`);
  const nNpc = await backfill('npc', 'npcs');
  const nEnemy = await backfill('enemy', 'enemies');

  console.log(`\n${'─'.repeat(72)}`);
  const total = nNpc + nEnemy;
  if (!APPLY) {
    if (total === 0) console.log(`✓ Nothing to backfill — stored graphs already match runtime.`);
    else console.log(`${total} entit(y/ies) would get a stored default graph. Re-run with --apply to write:\n  node scripts/backfill-behaviour-graphs.mjs --apply`);
  } else {
    console.log(`✓ Done — ${total} entit(y/ies) updated. Restart the server (or /world reload) to reload from DB.`);
  }
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
