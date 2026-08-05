// One-shot (converging, safe to re-run): spread end-of-shift bank deposits.
//
// buildDefaultVendorGraph() now routes endShift through a jittered `cash_up`
// wait, but ~100 NPCs carry a PERSISTED copy of the old graph in
// npcs.behaviour_graph, so the builder change alone reaches none of them.
// This rewrites the content files (git is the source of truth; the CODEX
// import replaces the whole column, so no prod script is needed).
//
// Only patches graphs still in the stock shape — a hand-edited graph whose
// endShift no longer points at collect_safe is left alone.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const DIR = 'content/npcs';
let patched = 0, skipped = 0;

for (const file of readdirSync(DIR).filter(f => f.endsWith('.json'))) {
  const path = `${DIR}/${file}`;
  const raw = readFileSync(path, 'utf8');
  if (!raw.includes('go_to_atm')) continue;

  const npc = JSON.parse(raw);
  const nodes = npc.behaviour_graph?.nodes;
  if (!nodes) continue;

  if (nodes.check_work?.endShift !== 'collect_safe' || nodes.cash_up) { skipped++; continue; }

  nodes.check_work.endShift = 'cash_up';
  nodes.cash_up = { type: 'wait', seconds: 20, jitter: 900, next: 'collect_safe' };
  if (nodes.atm_wait?.type === 'wait') nodes.atm_wait.jitter = 20;

  writeFileSync(path, JSON.stringify(npc, null, 2) + '\n');
  patched++;
}

console.log(`stagger-vendor-deposits: patched ${patched}, left alone ${skipped}`);
