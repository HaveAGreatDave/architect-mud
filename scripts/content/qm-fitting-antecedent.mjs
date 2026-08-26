/**
 * "For what?" — giving the fitting its missing first turn. 2026-08-25.
 *
 * The scene opened on "How long are you out for?", which presupposes that she
 * already knows the player is going somewhere. She does not. They have walked
 * into a shop and said fit me for something. "Out" has no antecedent in the
 * scene, and neither does the duration.
 *
 * That is the same error as the weapon-fitting draft one step earlier, and it is
 * worth naming separately because it is easy to miss when you write a scene
 * top-down: A QUESTION HAS TO BE ANSWERABLE FROM WHAT THE SCENE HAS ALREADY
 * ESTABLISHED. Writing the interesting question first and never supplying its
 * setup produces dialogue that reads as if a page is missing, which is exactly
 * how it feels to read.
 *
 * So she asks the shopkeeper's question first, and the player's answer is what
 * makes every question after it legal. It also gets the scene to the point
 * faster, because "standing a watch" and "going under" already imply most of the
 * kit and she stops asking about the rest.
 *
 * Run: node scripts/content/qm-fitting-antecedent.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const WRITE = process.argv.includes('--write');
const opt = (label, next) => ({ label, next, conditions: [], actions: [], enabled: true });

const p = path.join(ROOT, 'npcs/npc_lw_quartermaster.json');
const d = JSON.parse(fs.readFileSync(p, 'utf8'));
const t = d.dialogue_tree;

// New opening turn. Two words, and it is the only thing she could possibly say.
t.fit_what = {
  _vine: { x: 80, y: 900 }, actions: [],
  text: 'She closes the ledger on one finger.\n\n"For what?"',
  options: [
    opt('Standing a watch.', 'fit_long'),
    opt('Going under.', 'fit_under'),
    opt('I do not know yet.', 'fit_dunno'),
  ],
};

// Answering "under" skips the above-or-below question — she has it already.
t.fit_under = {
  _vine: { x: 80, y: 1060 }, actions: [],
  text: '"Then it is dark and it is loud."\n\nShe is already reaching.\n\n"How long?"',
  options: [opt('A few hours.', 'fit_below'), opt('All night.', 'fit_night_below'), opt('No idea.', 'fit_noidea')],
};

t.fit_night_below = {
  _vine: { x: 300, y: 1180 }, actions: [],
  text: 'Water and a spare battery go on the counter first.\n\n"Right."',
  options: [opt('(go on)', 'fit_below')],
};

// Somebody who does not know what they are doing gets told, not sold to.
t.fit_dunno = {
  _vine: { x: 80, y: 1220 }, actions: [],
  text: '"Then you are not going anywhere yet."\n\nShe opens the ledger again.\n\n"Come back when somebody has told you where. I will not guess and have you carry the wrong thing up eleven flights."',
  options: [opt('Fair.', 'bye'), opt('Show me the shelves.', '__shop__')],
};

// The old opening loses its own duration question; it is asked upstream now.
t.fit_long = {
  _vine: { x: 300, y: 900 }, actions: [],
  text: '"How long?"',
  options: [opt('A few hours.', 'fit_where'), opt('All night.', 'fit_night'), opt('No idea.', 'fit_noidea')],
};

// fit_noidea previously answered "no idea how long"; it now has to answer both.
t.fit_noidea = {
  _vine: { x: 300, y: 1050 }, actions: [],
  text: '"All night, then."\n\nShe does not make it a joke.\n\n"Nobody has ever come back early."',
  options: [opt('(go on)', 'fit_night')],
};

for (const o of t.root.options || []) if (o.next === 'fit_long') o.next = 'fit_what';

const names = new Set([...Object.keys(t), '__shop__']);
let bad = 0;
for (const [k, v] of Object.entries(t)) for (const o of v.options || [])
  if (o.next && !names.has(o.next)) { console.log('DANGLING ' + k + ' -> ' + o.next); bad++; }
console.log('dangling refs: ' + bad);
console.log('entry node from root: ' + (t.root.options.find(o => String(o.next).startsWith('fit_'))?.next));

if (WRITE) { fs.writeFileSync(p, canonicalJson(d), 'utf8'); console.log('WROTE'); }
else console.log('dry run');
