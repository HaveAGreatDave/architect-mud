/**
 * Close the Null, Exodus, Wildblood and Terminus arcs so work can stay on the
 * Long Watch and Ascendant ladders.
 *
 * Each chain's entry options get a world-scoped condition appended. Every node,
 * line and turn-in stays where it is, and re-opening a chain is one
 * setFlag('world', 'arc_open_<order>', '1') with no content edit.
 *
 * The gate goes on the entry option rather than the accept, so the topic leaves
 * the NPC's menu instead of the player reaching an offer they cannot say yes to.
 * Chains 2 and 3 are gated too, although chain 1 being closed already makes them
 * unreachable, so a dev database with a character mid-chain stops at the next
 * rung.
 *
 * Turn-in paths are left open: a character part-way through can still hand in
 * what they are carrying.
 *
 * World flags are cached write-through (server/engine/flags.js), so these
 * conditions cost no round trip.
 *
 *   node scripts/content/gate-side-arcs.mjs [--check]
 */
import fs from 'fs';
import path from 'path';
import { canonicalJson } from './lib.mjs';

const NPCS = path.join(process.cwd(), 'content', 'npcs');
const CHECK = process.argv.includes('--check');

// npc -> { flag, entries: { nodeKey: [option.next, ...] } }
// Each listed option is the door into that chain from a hub node the player can
// always reach. `next` is the match key because these options are identified by
// where they GO, not by their label (labels get rewritten; targets don't).
const GATES = [
  {
    npc: 'npc_dw_threlfall', order: 'The Null', flag: 'arc_open_null',
    entries: { root: ['nl_offer_1', 'nl_offer_2', 'nl_offer_3'] },
  },
  {
    npc: 'npc_glitch_oracle', order: 'The Exodus', flag: 'arc_open_exo',
    entries: { root: ['exo_offer_1', 'exo_offer_2', 'exo_offer_3'] },
  },
  {
    npc: 'npc_thorn_chorus', order: 'The Wildblood', flag: 'arc_open_wild',
    entries: { root: ['wild_offer1', 'wild_offer3'] },
  },
  {
    npc: 'npc_thorn_bracken', order: 'The Wildblood', flag: 'arc_open_wild',
    entries: { root: ['wild_offer2'] },
  },
  {
    npc: 'npc_thorn_quarrel', order: 'The Wildblood', flag: 'arc_open_wild',
    entries: { root: ['toll'] },
  },
  {
    npc: 'npc_terminus_quartermaster', order: 'Terminus', flag: 'arc_open_terminus',
    // `box` is authored on root three times over (a pre-existing duplication);
    // all three copies are the same door and all three get the same gate.
    entries: { root: ['box'] },
  },
  {
    npc: 'npc_terminus_picket', order: 'Terminus', flag: 'arc_open_terminus',
    // Reachable from root AND from the `allowed` node, so both are doors.
    entries: { root: ['work'], allowed: ['work'] },
  },
];

const gateFor = (flag) => ({ flag, op: 'set', scope: 'world' });
const hasGate = (conds, flag) =>
  (conds || []).some((c) => c.flag === flag && c.scope === 'world' && c.op === 'set');

let touched = 0, added = 0, already = 0;

for (const { npc, order, flag, entries } of GATES) {
  const file = path.join(NPCS, `${npc}.json`);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const tree = data.dialogue_tree || {};
  let changed = false;

  for (const [nodeKey, targets] of Object.entries(entries)) {
    const node = tree[nodeKey];
    if (!node) { console.warn(`  ! ${npc}: node "${nodeKey}" not found — skipped`); continue; }
    let hits = 0;
    for (const opt of node.options || []) {
      if (!targets.includes(opt.next)) continue;
      hits++;
      opt.conditions = opt.conditions || [];
      if (hasGate(opt.conditions, flag)) { already++; continue; }
      // Appended, never replacing: evalConditions ANDs the list, so the chain's
      // own progression conditions keep working underneath the gate.
      opt.conditions.push(gateFor(flag));
      added++; changed = true;
      console.log(`  ${npc}  [${nodeKey}] -> ${opt.next}  "${opt.label}"  + ${flag}`);
    }
    for (const t of targets) {
      if (!(node.options || []).some((o) => o.next === t)) {
        console.warn(`  ! ${npc}: no option in "${nodeKey}" points at "${t}"`);
      }
    }
    if (!hits) console.warn(`  ! ${npc}: node "${nodeKey}" matched nothing`);
  }

  if (changed && !CHECK) {
    fs.writeFileSync(file, canonicalJson(data), 'utf8');
    touched++;
  }
  if (changed && CHECK) touched++;
  if (changed) console.log(`  ${order}: ${npc} ${CHECK ? 'would be' : ''} updated\n`);
}

console.log(`${CHECK ? '[check] ' : ''}${added} gate(s) added across ${touched} file(s); ${already} already gated.`);
if (added && !CHECK) {
  console.log('\nRe-open a chain at runtime with a world flag, no redeploy:');
  console.log("  setFlag('world', 'arc_open_null', '1')   // Null");
  console.log("  setFlag('world', 'arc_open_exo', '1')    // Exodus  (also re-opens PSI_AWAKEN)");
  console.log("  setFlag('world', 'arc_open_wild', '1')   // Wildblood (also re-opens the mutagen gate)");
  console.log("  setFlag('world', 'arc_open_terminus', '1')");
}
