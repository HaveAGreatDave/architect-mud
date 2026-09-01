/**
 * Fourteen dialogue nodes nothing links to. 2026-08-26.
 *
 * `node scripts/docs/dialogue-integrity.mjs` lists nodes with text on them that
 * no option anywhere reaches. They are three different situations and only two
 * of them want fixing.
 *
 * ── Written closing lines that never play (11) ───────────────────────────────
 *
 * Every one of these NPCs has a `bye` node with a real last line on it — Amos
 * looking past you at the door, Boedeker telling you not to make paperwork of
 * yourself — and no option in the tree points at it. The conversation ends by
 * the player closing the panel instead, so the line has never once been read by
 * anybody. Each gets one exit option on `root`, written in that character's own
 * register and deliberately not stepping on the line it leads to: Boedeker's
 * own joke about paperwork is his to make, so the option that reaches it is
 * flat.
 *
 * ⚠ Sloat looked like an exception and was not. He already had "Nothing. Just
 * looking.", so repointing that at `bye` seemed tidier than giving him a second
 * leave — and it moved the orphan instead of fixing it, because that option was
 * the only way to reach a node where he tells you looking is free and has
 * always been free. An exit that swallows a real answer on the way out is worse
 * than two exits. He gets his own, like everybody else.
 *
 * ── Two real orphans ─────────────────────────────────────────────────────────
 *
 * Teague's `earned_fault` is my own doing: lw-mutagen-doctrine.mjs deleted the
 * branches the old framing owned and filtered every option that pointed at
 * them, and this node was reachable only through one of those. It is the
 * distinction the whole doctrine rests on — bad ground east of the wall is not
 * chosen and a bottle is — so it goes back on both nodes that raise the subject.
 *
 * Phil's `hard` is the best line he has and has never been reachable. It
 * belongs on `gotrid`, which is where he says he made it uncomfortable for the
 * man who gave Neil a bed, and it is the obvious thing to say back to that.
 *
 * ── Left alone, on purpose (2) ───────────────────────────────────────────────
 *
 * `npc_barkeep · bm_air_already` is Sully saying a thing is already sorted. It
 * is a state response and wiring it to an unconditional option would have him
 * say it before it is true.
 *
 * `npc_ward_clerk · job_turnin` is a checker blind spot, not a fault. That tree
 * uses options carrying `cmd` and no `next` — they run a command rather than
 * navigating — and the node is entered by the quest turn-in, which the reader
 * cannot see because there is no link to follow.
 *
 * Run: node scripts/content/orphan-dialogue-nodes.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content', 'npcs');
const WRITE = process.argv.includes('--write');
const opt = (label, next) => ({ label, next, conditions: [], actions: [], enabled: true });

// file -> exit option that reaches the closing line
const EXITS = [
  ['npc_1784515608920', "That's me done."],
  ['npc_gate_sergeant', 'Right. Thanks, Sergeant.'],
  ['npc_gate_trooper', "I'll leave you to it."],
  ['npc_john_akerson', "I'll let you get on."],
  ['npc_reach_assayer', "That's what I needed."],
  ['npc_reach_bathkeeper', "That's all, thanks."],
  ['npc_reach_storekeep', "I'll leave you to it."],
  ['npc_reach_undertaker', 'Thanks for your time.'],
  ['npc_smith_vessa', "That's all for now."],
  ['npc_mintcond_sloat', "That's me. Thanks."],
];

const load = f => JSON.parse(fs.readFileSync(path.join(ROOT, f + '.json'), 'utf8'));
const save = (f, d) => { if (WRITE) fs.writeFileSync(path.join(ROOT, f + '.json'), canonicalJson(d), 'utf8'); };

for (const [f, label] of EXITS) {
  const d = load(f); const t = d.dialogue_tree;
  const list = (t.root.options ||= []);
  if (list.some(o => o.next === 'bye')) { console.log('  skip  ' + f + ' already reaches bye'); continue; }
  list.push(opt(label, 'bye'));
  save(f, d);
  console.log('  ok    ' + f.replace(/^npc_/, '').padEnd(22) + label);
}

// Undo the repoint, if this ran before the note above was written.
{
  const d = load('npc_mintcond_sloat'); const t = d.dialogue_tree;
  const o = (t.root.options || []).find(x => x.label === 'Nothing. Just looking.');
  if (o && o.next !== 'looking') { o.next = 'looking'; save('npc_mintcond_sloat', d); console.log('  ok    mintcond_sloat        "Nothing. Just looking." -> looking'); }
}

// Teague: the distinction the doctrine rests on
{
  const d = load('npc_lw_teague'); const t = d.dialogue_tree;
  let n = 0;
  for (const k of ['earned', 'earned_drug']) {
    const list = (t[k].options ||= []);
    if (list.some(o => o.next === 'earned_fault')) continue;
    list.splice(Math.max(0, list.length - 1), 0, opt('Not all of them chose it.', 'earned_fault'));
    n++;
  }
  if (n) { save('npc_lw_teague', d); console.log('  ok    lw_teague             earned_fault reachable from ' + n + ' node(s)'); }
  else console.log('  skip  lw_teague already reaches earned_fault');
}

// Phil: the line about the man who gave somebody a bed
{
  const d = load('npc_phil_mccracken'); const t = d.dialogue_tree;
  const list = (t.gotrid.options ||= []);
  if (!list.some(o => o.next === 'hard')) {
    list.unshift(opt('That is a hard way to treat the man who housed him.', 'hard'));
    save('npc_phil_mccracken', d);
    console.log('  ok    phil_mccracken        hard reachable from gotrid');
  } else console.log('  skip  phil_mccracken already reaches hard');
}

console.log('\n' + (WRITE ? 'WROTE' : 'dry run'));
