/**
 * You can always stop. 2026-08-25.
 *
 * ── The fault ────────────────────────────────────────────────────────────────
 *
 * Four nodes in the deflection chain had no way out that was not itself an
 * answer:
 *
 *   ives      stance_quiet            take the slip (flags you) or half-answer
 *   ives      stance_quiet_undecided  agree, object, or refuse — no fourth door
 *   recruiter hand_deflect_ask        agree or refuse
 *   vess      climb_deflect_ask       agree or refuse
 *
 * Every option either committed a stance or set `asc_watched`. A player who
 * simply wanted to be somewhere else could not get there.
 *
 * ── Why that is worse here than in an ordinary scene ─────────────────────────
 *
 * This is the branch about being pressed to declare yourself to an organisation
 * that insists it never pressures anybody. Ives says it plainly — nobody is
 * refused, nobody is held, the Gate opens both ways. If the dialogue then corners
 * the player into answering, the game is doing the coercion the fiction is busy
 * denying, and the player feels the hand rather than the argument.
 *
 * So: an exit at every rung, costing nothing and setting nothing. Whatever state
 * the player already carried, they keep. Walking out of Ives's question without
 * answering leaves you exactly as unclassified as you were, which is the honest
 * outcome and is already covered by her own line about people who come up on a
 * list.
 *
 * ── The rule, for the docs ───────────────────────────────────────────────────
 *
 * ANY SCENE THAT PRESSURES THE PLAYER MUST HAVE A DOOR IN EVERY ROOM. A menu
 * with no neutral option is the writer insisting, and the player can feel the
 * difference between a character who will not let something go and an author who
 * will not.
 *
 * Run: node scripts/content/asc-always-an-exit.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const WRITE = process.argv.includes('--write');
const log = [];

// A clean exit: goes to bye, carries no actions, changes nothing.
const exitOpt = (label) => ({ label, next: 'bye', conditions: [], actions: [], enabled: true });

const EXITS = [
  ['npcs/npc_asc_ives.json', 'stance_quiet', '(say nothing, and go)'],
  ['npcs/npc_asc_ives.json', 'stance_quiet_undecided', '(let the question sit, and leave)'],
  ['npcs/npc_asc_recruiter.json', 'the_second_window', '(say nothing)'],
  ['npcs/npc_asc_recruiter.json', 'hand_deflect_ask', '(say nothing, and let him work)'],
  ['npcs/npc_asc_vess.json', 'climb_deflect_ask', '(say nothing, and keep walking)'],
];

for (const [file, node, label] of EXITS) {
  const p = path.join(ROOT, file);
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  const n = d.dialogue_tree?.[node];
  if (!n) { log.push('  MISS  ' + node); continue; }
  const list = (n.options ||= []);
  // Idempotent, and does not double up if a clean exit already exists.
  const hasClean = list.some(o => o.next === 'bye' && !(o.actions || []).length);
  if (hasClean) { log.push('  skip  ' + node + ' already has one'); continue; }
  list.push(exitOpt(label));
  if (WRITE) fs.writeFileSync(p, canonicalJson(d), 'utf8');
  log.push('  ok    ' + node.padEnd(24) + label);
}

console.log(log.join('\n'));

// Prove it: every node in the chain must offer a way out that costs nothing.
const CHAIN = {
  'npcs/npc_asc_ives.json': ['stance_quiet', 'stance_quiet_go', 'stance_quiet_undecided',
    'stance_refused', 'stance_recover'],
  'npcs/npc_asc_recruiter.json': ['the_second_window', 'the_second_window_long',
    'the_second_window_reassure', 'hand_deflect', 'hand_deflect_ask', 'hand_stay_watched',
    'hand_recover'],
  'npcs/npc_asc_vess.json': ['climb_deflect', 'climb_deflect_ask', 'climb_recover'],
};
let trapped = 0;
for (const [file, keys] of Object.entries(CHAIN)) {
  const t = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8')).dialogue_tree;
  for (const k of keys) {
    const o = t[k]?.options || [];
    if (!o.some(x => x.next === 'bye' && !(x.actions || []).length)) {
      console.log('  TRAPPED ' + file + ' · ' + k);
      trapped++;
    }
  }
}
console.log('\n  nodes with no free exit: ' + trapped);
console.log('\n' + (WRITE ? 'WROTE' : 'dry run'));
