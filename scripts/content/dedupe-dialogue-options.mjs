/**
 * Remove duplicated dialogue options. 2026-08-25.
 *
 * ── What happened ────────────────────────────────────────────────────────────
 *
 * asc-politics.mjs added new root options with `options.splice(1, 0, ...)`, which
 * is not idempotent: every run inserts the same options again. The script was run
 * more than once and Ives, Vess and Maresh each ended up with their new questions
 * listed eight times.
 *
 * Nothing complains about this. The dialogue still loads, content:lint passes,
 * and the only symptom is a player opening a conversation and seeing the same
 * sentence eight times in the menu. That is exactly the class of bug worth a
 * sweep rather than a spot fix, because any content script that adds an option
 * can cause it and none of them would tell you.
 *
 * ── The rule ─────────────────────────────────────────────────────────────────
 *
 * A content script that ADDS anything must check first. asc-politics.mjs now has
 * an `insertOpts` helper that matches on label, which is the right test: a label
 * is what the player clicks, and two options sharing one are indistinguishable.
 *
 * ── This sweep ───────────────────────────────────────────────────────────────
 *
 * Every NPC, every node. Two options in the same node with the same label AND
 * the same destination are a duplicate and all but the first go. Options that
 * share a label but lead somewhere different are LEFT ALONE and reported, because
 * that can be deliberate — the same words under different conditions.
 *
 * Run: node scripts/content/dedupe-dialogue-options.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content', 'npcs');
const WRITE = process.argv.includes('--write');

let filesTouched = 0, removed = 0;
const sameLabelDifferentTarget = [];

for (const f of fs.readdirSync(ROOT)) {
  if (!f.endsWith('.json')) continue;
  const p = path.join(ROOT, f);
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  const tree = d.dialogue_tree;
  if (!tree) continue;
  let dropped = 0;

  for (const [nodeKey, node] of Object.entries(tree)) {
    if (!Array.isArray(node?.options)) continue;
    const seen = new Set();
    const keep = [];
    for (const o of node.options) {
      // Conditions are part of the identity: the same label under a different
      // gate is a different offer and both must survive.
      const key = JSON.stringify([o.label, o.next, o.conditions ?? [], o.actions ?? []]);
      if (seen.has(key)) { dropped++; continue; }
      seen.add(key);
      keep.push(o);
    }
    const labels = keep.map(o => o.label);
    for (const l of new Set(labels)) {
      if (labels.filter(x => x === l).length > 1) {
        sameLabelDifferentTarget.push(f.replace('.json', '') + ' · ' + nodeKey + ' · "' + l + '"');
      }
    }
    if (dropped) node.options = keep;
  }

  if (!dropped) continue;
  filesTouched++; removed += dropped;
  console.log('  ' + String(dropped).padStart(3) + '  ' + f.replace('.json', ''));
  if (WRITE) fs.writeFileSync(p, canonicalJson(d), 'utf8');
}

console.log('\n  removed ' + removed + ' duplicate option(s) from ' + filesTouched + ' NPC(s)');
if (sameLabelDifferentTarget.length) {
  console.log('\n  same label, different destination — left alone, check these are deliberate:');
  for (const s of sameLabelDifferentTarget.slice(0, 12)) console.log('    ' + s);
  if (sameLabelDifferentTarget.length > 12) console.log('    …+' + (sameLabelDifferentTarget.length - 12));
}
console.log('\n' + (WRITE ? 'WROTE' : 'dry run'));
