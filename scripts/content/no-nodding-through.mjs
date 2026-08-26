/**
 * Twenty places where the only thing to do was nod. 2026-08-26.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────
 *
 * "(say nothing)" is for LEAVING a conversation, never for advancing one. A
 * wordless option that goes to `bye` is an exit and is fine. A wordless option
 * that goes anywhere else is the player being mute in a conversation.
 *
 * ── THREE THINGS THE AUDIT CONFLATES, AND ONLY ONE IS A FAULT ────────────────
 *
 * 48 parenthetical options across 13 NPCs advance rather than exit. Sorting them:
 *
 *   AN ACT — "(sit down at the bench)", "(hold her)", "(hand over the wrapped
 *   core)", "(do not move)", "(change the subject)". The player's body does
 *   something, or refuses to. That is a real choice and several of them are the
 *   best choices in their scenes. Untouched.
 *
 *   A SCENE PROMPT ON `root` — "(somebody has come to the desk)", "(there is
 *   something happening at the end of the Gallery)", "(the man on the crate is
 *   looking at you)". Not the player being silent: the game surfacing an ambient
 *   event as something you can attend to, which is how a scene interrupts a
 *   topic menu. A good device. Untouched.
 *
 *   THE CONTINUE BUTTON — "(nod)" -> root, and it is the fault. Worse where it
 *   is the ONLY option, because then the node is a monologue with an
 *   acknowledge key and the player has no voice in it at all.
 *
 * ⚠ WHERE A WORDLESS OPTION SITS BESIDE REAL ONES IT IS A BACK BUTTON, and this
 * leaves those alone. Jerome's `pantry` offers "Even knowing who takes from it?"
 * and "(nod)" — the player who has nothing to add needs a way out of the topic,
 * and taking it away would force a line out of somebody who did not want one.
 * The 20 below are the nodes where nodding was the only thing available.
 *
 * ── WHAT THE REPLACEMENTS ARE ────────────────────────────────────────────────
 *
 * Short, in the player's own voice, and statements rather than questions —
 * every one of these returns to `root`, so a question would go unanswered.
 * Several are the line the wordless label was already describing: "(that is not
 * nothing)" becomes "That is not nothing", said out loud, which is the whole
 * difference between witnessing a scene and being in it.
 *
 * Run: node scripts/content/no-nodding-through.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const WRITE = process.argv.includes('--write');

// [ npc, node, the line the player now says ]
const LINES = [
  // ── Father Jerome. Fourteen wordless options; these ten were the whole node.
  ['npc_father_jerome', 'cameras', 'And the plaque comes down on the Monday.'],
  ['npc_father_jerome', 'comehere', 'That may be enough on its own.'],
  ['npc_father_jerome', 'creed', 'I will read the long version.'],
  ['npc_father_jerome', 'whystay', 'Then I hope you are right about him.'],
  ['npc_father_jerome', 'throwout', 'Nowhere. That is the answer.'],
  ['npc_father_jerome', 'aboutneil', 'You are not going to name them.'],
  ['npc_father_jerome', 'notnothing', 'Somebody should have said it years ago.'],
  ['npc_father_jerome', 'check', 'Fourteen years is a long time to say them to nobody.'],
  ['npc_father_jerome', 'refused', 'That is not nothing.'],
  ['npc_father_jerome', 'evenknowing', 'That is about Neil.'],

  // ── Phil McCracken.
  ['npc_phil_mccracken', 'change', 'I will ask you again after a good one.'],
  ['npc_phil_mccracken', 'else', 'That lands.'],
  ['npc_phil_mccracken', 'hard', 'You have had a lot of time to think about how you say it.'],
  ['npc_phil_mccracken', 'nevertook', 'And you are still here.'],
  ['npc_phil_mccracken', 'satinit', 'He was home.'],

  // ── Claude Merrin.
  ['npc_claude_merrin', 'arch_defend', 'I was not here for what it held back.'],
  ['npc_claude_merrin', 'arch_fond', 'You remember when it asked.'],
  ['npc_claude_merrin', 'codex_habit', 'A habit is not nothing either.'],
  ['npc_claude_merrin', 'folded', 'You were one of the ones it kept.'],

  // ── Brace, and Kesh.
  ['npc_fence_brace', 'lore', 'And you were not six inches out.'],
  ['npc_fence_brace', 'trust', 'Then I will come back with my parts attached.'],
  ['npc_asc_kesh', 'codex_drift', 'Fractionally right, though.'],
];

const PAREN = /^\(/;
let hit = 0, miss = 0, guarded = 0;
const byFile = new Map();
for (const [file, node, line] of LINES) {
  if (!byFile.has(file)) byFile.set(file, []);
  byFile.get(file).push([node, line]);
}

for (const [file, rows] of byFile) {
  const p = path.join(ROOT, 'npcs/' + file + '.json');
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  const t = d.dialogue_tree;
  for (const [node, line] of rows) {
    const v = t[node];
    if (!v) { console.log('  MISS  ' + file + ' · ' + node + ' (no node)'); miss++; continue; }
    const o = v.options || [];
    // ⚠ Only ever rewrite a node whose ONLY option is wordless. If somebody has
    // since added a real reply, the wordless one has become a back button and
    // this must not touch it.
    if (o.length !== 1) {
      if (o.some(x => x.label === line)) { guarded++; continue; }
      console.log('  skip  ' + file + ' · ' + node + ' now has ' + o.length + ' options');
      guarded++; continue;
    }
    if (!PAREN.test(o[0].label || '')) { guarded++; continue; }   // already done
    console.log('  ok    ' + (file.replace(/^npc_/, '') + ' · ' + node).padEnd(34)
      + JSON.stringify(o[0].label) + ' -> ' + JSON.stringify(line));
    o[0].label = line;
    hit++;
  }
  if (WRITE) fs.writeFileSync(p, canonicalJson(d), 'utf8');
}

console.log('\n  ' + hit + ' rewritten, ' + guarded + ' already done or guarded, ' + miss + ' missing');
console.log('\n' + (WRITE ? 'WROTE' : 'dry run'));
