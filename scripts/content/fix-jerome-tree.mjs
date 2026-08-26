/**
 * Father Jerome's dialogue was nested one level too deep. 2026-08-25.
 *
 * His `dialogue_tree` was:
 *
 *   { "_start": "root", "nodes": { root, creed, neil, pantry, … } }
 *
 * The engine expects the nodes AT THE TOP LEVEL and enters at `root`. So the
 * tree it was handed had exactly two keys, neither of them `root`, and every one
 * of his nineteen written nodes was unreachable. He is a priest with a food
 * bank, a plaque, and a long answer about why he stays, and none of it has ever
 * been readable in game.
 *
 * Nothing catches this. It is valid JSON, `content:lint` has no opinion about
 * the shape inside a jsonb column, and regress does not walk dialogue trees. It
 * surfaced only because dialogue-integrity.mjs reports nodes that nothing links
 * to, and `_start` and `nodes` came back as two orphans in a file that should
 * not have had any.
 *
 * The fix is to lift `nodes` up a level. `_start` is dropped: it says "root",
 * which is where the engine starts anyway, and keeping a key nothing reads is
 * how the next person gets misled.
 *
 * Run: node scripts/content/fix-jerome-tree.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const WRITE = process.argv.includes('--write');

// Any NPC with this shape, not just Jerome — if one was authored this way there
// may be others, and the test is exact enough to be safe.
let fixed = 0;
for (const f of fs.readdirSync(path.join(ROOT, 'npcs'))) {
  if (!f.endsWith('.json')) continue;
  const p = path.join(ROOT, 'npcs', f);
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  const t = d.dialogue_tree;
  if (!t) continue;

  const keys = Object.keys(t);
  const wrapped = keys.length <= 2
    && t.nodes && typeof t.nodes === 'object' && !Array.isArray(t.nodes)
    && t.nodes.root && !t.root;
  if (!wrapped) continue;

  const inner = t.nodes;
  const start = t._start;
  if (start && start !== 'root') {
    console.log('  ⚠ ' + f + ' starts at "' + start + '", not root — check by hand');
    continue;
  }

  d.dialogue_tree = inner;
  fixed++;
  console.log('  lifted ' + Object.keys(inner).length + ' node(s) to the top level  ' + f.replace('.json', ''));
  if (WRITE) fs.writeFileSync(p, canonicalJson(d), 'utf8');
}

console.log('\n  ' + fixed + ' NPC(s) had a wrapped tree');
console.log('\n' + (WRITE ? 'WROTE' : 'dry run'));
