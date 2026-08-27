/**
 * dialogue-integrity.mjs — structural faults in dialogue trees that no lint sees.
 *
 *   node scripts/docs/dialogue-integrity.mjs
 *
 * Written 2026-08-25 as a pre-flight, after one session turned up four separate
 * defects that were all valid JSON with valid keys and therefore invisible to
 * content:lint:
 *
 *   64 options rendering as the literal word "undefined", because they carried
 *      the player's line in `text` and dialogue.js only reads `label`
 *   10 duplicated options, from content scripts that appended without checking
 *      a question appended to one NPC FOURTEEN times, same cause
 *      a quest objective pointing at a zone that does not exist
 *
 * Everything here is a hard fault — an option a player cannot read, a branch
 * that goes nowhere, a node nothing reaches. Unlike the prose reporters this one
 * has no judgement calls in it, so it exits non-zero when it finds something.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const NPCS = path.join(ROOT, 'npcs');

// Destinations the engine resolves itself rather than looking up in the tree.
const SPECIAL = new Set(['__shop__', '__end__', '__trade__', '__train__']);

// Nodes something OTHER than an option enters. Each needs a reason, because the
// cost of an entry here is a real orphan hiding behind it forever.
const ENTERED_ELSEWHERE = new Map([
  ['npc_ward_clerk · job_turnin',
    'entered by the quest turn-in. That tree navigates with `cmd` and no `next`, '
    + 'so there is no link for this check to follow.'],
  ['npc_barkeep · bm_air_already',
    'Sully saying a thing is already sorted. A state response — an unconditional '
    + 'option reaching it would have him say it before it is true.'],
]);

// ── WORDLESS OPTIONS ────────────────────────────────────────────────────────
//
// "(say nothing)" is for LEAVING a conversation, never for advancing one. But
// a naive check on that flags 48 options and roughly half of them are good
// writing, so the sort matters more than the rule. Three kinds:
//
//   AN ACT — "(sit down at the bench)", "(hold her)", "(hand over the wrapped
//   core)", "(do not move)". The player's body does something, or refuses to.
//   A real choice, and several are the best choices in their scenes.
//
//   A SCENE PROMPT on `root` — "(somebody has come to the desk)", "(the man on
//   the crate is looking at you)". Not the player being silent: the game
//   surfacing an ambient event as something you can attend to, which is how a
//   scene interrupts a topic menu.
//
//   THE CONTINUE BUTTON — "(nod)" -> root. The fault.
//
// ⚠ ONLY THE LAST ONE IS FAILED, and only in its unambiguous form: a node whose
// ONLY option is wordless and goes somewhere other than `bye`. That is a
// monologue with an acknowledge key and the player has no voice in it at all.
// The softer case — a wordless advance sitting beside real replies — is a back
// button out of a topic, and taking it away forces a line out of a player who
// had nothing to add. It is reported, never failed.
const PAREN = /^\s*\(/;
const ACT = /\b(sit|stand|hold|squeeze|pull|hand|take|follow|walk|go|stay|kiss|touch|drink|pour|find|give|show|put|open|close|carry|look|wipe|keep|listen|move)\b/i;
const isWordless = (label) => PAREN.test(label || '') && !ACT.test(label || '');
const isExit = (next) => !next || next === 'bye' || next === '__end__';

const problems = {
  unlabelled: [], dangling: [], duplicate: [], unreachable: [], emptyNode: [],
  monologue: [], wordlessAdvance: [],
};

for (const f of fs.readdirSync(NPCS)) {
  if (!f.endsWith('.json')) continue;
  const d = JSON.parse(fs.readFileSync(path.join(NPCS, f), 'utf8'));
  const tree = d.dialogue_tree;
  if (!tree || !Object.keys(tree).length) continue;
  const id = f.replace('.json', '');
  const names = new Set(Object.keys(tree));

  const reached = new Set(['root']);
  for (const [key, node] of Object.entries(tree)) {
    const opts = node?.options;
    if (!Array.isArray(opts)) continue;
    const seen = new Set();

    for (const o of opts) {
      if (o.label === undefined || o.label === null || String(o.label).trim() === '') {
        problems.unlabelled.push(id + ' · ' + key);
      }
      if (o.next && !names.has(o.next) && !SPECIAL.has(o.next)) {
        problems.dangling.push(id + ' · ' + key + ' -> ' + o.next);
      }
      if (o.next) reached.add(o.next);

      const k = JSON.stringify([o.label, o.next, o.conditions ?? [], o.actions ?? []]);
      if (seen.has(k)) problems.duplicate.push(id + ' · ' + key + ' · "' + o.label + '"');
      seen.add(k);
    }

    const txt = Array.isArray(node.text) ? node.text.join('') : (node.text || '');
    if (!String(txt).trim() && !(node.actions || []).length) {
      problems.emptyNode.push(id + ' · ' + key);
    }

    // A monologue with an acknowledge key: one option, wordless, and it carries
    // on rather than leaving. Silence as an ANSWER is exempt — a node that
    // reacts to the player saying nothing is the point of that option, not a
    // failure of it.
    const advancing = opts.filter(o => isWordless(o.label) && !isExit(o.next)
      && !/quiet|silen/i.test(String(o.next)));
    if (opts.length === 1 && advancing.length === 1) {
      problems.monologue.push(id + ' · ' + key + '  "' + opts[0].label + '" -> ' + opts[0].next);
    } else {
      for (const o of advancing) {
        problems.wordlessAdvance.push(id + ' · ' + key + '  "' + o.label + '" -> ' + o.next);
      }
    }
  }

  // A node nothing points at is dead content — written, paid for, unreachable.
  for (const key of names) {
    if (reached.has(key) || SPECIAL.has(key)) continue;
    if (ENTERED_ELSEWHERE.has(id + ' · ' + key)) continue;
    problems.unreachable.push(id + ' · ' + key);
  }
}

const SOFT = new Set(['unreachable', 'wordlessAdvance']);
const REPORT = [
  ['unlabelled', 'options with no label — these render as the word "undefined"'],
  ['dangling', 'options pointing at a node that does not exist'],
  ['duplicate', 'the same option listed twice in one node'],
  ['emptyNode', 'nodes with no text and no actions'],
  ['monologue', 'monologues with an acknowledge key — the only option is wordless and carries on'],
  ['unreachable', 'nodes nothing links to — written and unreachable'],
  ['wordlessAdvance', 'wordless options that advance — sort these by hand (act / scene prompt / continue button)'],
];

let hard = 0;
console.log('DIALOGUE INTEGRITY\n');
for (const [key, label] of REPORT) {
  const list = problems[key];
  if (!SOFT.has(key)) hard += list.length;
  console.log('  ' + String(list.length).padStart(4) + '  ' + label);
  for (const l of list.slice(0, 8)) console.log('          ' + l);
  if (list.length > 8) console.log('          …+' + (list.length - 8) + ' more');
}

console.log('\n  ' + hard + ' hard fault(s); the last two are listed for review, not failed.');
process.exit(hard ? 1 : 0);
