/**
 * 64 dialogue options that render as the word "undefined". 2026-08-25.
 *
 * Found by the duplicate-option sweep, which printed `"undefined"` as an option
 * label and made it obvious something was wrong.
 *
 * Five NPCs have options written against an older shape that put the player's
 * line in `text` rather than `label`:
 *
 *   {"next":"rules","text":"\"What're the rules in here?\""}
 *
 * server/engine/dialogue.js:278 renders `esc(o.label)` with no fallback, so a
 * player opening one of these conversations sees a numbered menu of the word
 * undefined. The lines themselves are fine — somebody wrote them, they are in
 * character, and they have been unreachable in practice ever since.
 *
 * The fix is to move the string into `label`, which is what every other NPC in
 * the tree uses. `text` is left in place rather than deleted: nothing reads it
 * on an option, and removing a key is a bigger claim than adding one.
 *
 * ⚠ This is the kind of defect no lint catches, because the data is valid JSON
 * with valid keys. It took a player-facing symptom to surface it, and the only
 * reason it surfaced at all is that a sweep printed the label out loud.
 *
 * Run: node scripts/content/fix-option-labels.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content', 'npcs');
const WRITE = process.argv.includes('--write');

let fixed = 0, orphaned = 0;
const files = [];

for (const f of fs.readdirSync(ROOT)) {
  if (!f.endsWith('.json')) continue;
  const p = path.join(ROOT, f);
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  let n = 0;

  for (const node of Object.values(d.dialogue_tree || {})) {
    for (const o of node?.options || []) {
      if (o.label !== undefined && o.label !== null && o.label !== '') continue;
      if (typeof o.text === 'string' && o.text.trim()) { o.label = o.text; n++; }
      else orphaned++;
    }
  }

  if (!n) continue;
  fixed += n; files.push(f.replace('.json', '') + ' (' + n + ')');
  if (WRITE) fs.writeFileSync(p, canonicalJson(d), 'utf8');
}

console.log('  ' + files.join('\n  '));
console.log('\n  gave a label to ' + fixed + ' option(s)');
if (orphaned) console.log('  ' + orphaned + ' option(s) had no label AND no text — those need writing by hand');
console.log('\n' + (WRITE ? 'WROTE' : 'dry run'));
