/**
 * The Quartermaster's fitting, rewritten against her actual stock. 2026-08-25.
 *
 * ── The mistake ──────────────────────────────────────────────────────────────
 *
 * The first version of this scene asked "Which hand?" and "Close work or far?"
 * -- a tailor fitting somebody for a weapon. Asked what she was checking the
 * hand FOR, there was no answer, which is the whole problem: it was the SHAPE
 * of a fitting with nothing inside it, and a back-and-forth whose answers change
 * nothing is worse than no back-and-forth at all.
 *
 * The answer was on the shelf the entire time. Her shop is Surplus of Sorrows
 * and her inventory is soap, a water bottle, earplugs, a rag bandage, jerky, a
 * rough towel, duct tape, work gloves, a battery, a rad band, a jerry can, a
 * flashlight, propane, a field welder, ear defenders and smoked lenses.
 *
 * Not one weapon. She does not kit you to fight. She kits you to STAND
 * SOMEWHERE UNPLEASANT FOR A LONG TIME, which is what the Long Watch actually
 * do, and every question below is one she needs answered to pick off that
 * shelf. Above ground is glare and fallout, so it is lenses and a rad band.
 * Below is dark and loud, so it is a light and ear defenders. All night means
 * water and a spare battery. Each is a real hazard the engine models.
 *
 * ── The rule this is going in the docs as ────────────────────────────────────
 *
 * Read what the character HAS before writing what they ask. A vendor's
 * inventory, an NPC's flags and their work zone are a specification for what
 * they know and what they would need to find out. Writing the questions first
 * produces a scene that performs expertise instead of having any.
 *
 * Run: node scripts/content/qm-fitting-rewrite.mjs [--write]
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

// Clear the weapon-fitting draft.
for (const k of ['fit_hand', 'fit_either', 'fit_reach', 'fit_dunno', 'fit_close',
                 'fit_far', 'fit_which', 'fit_wet', 'fit_done']) delete t[k];

t.fit_long = {
  _vine: { x: 300, y: 900 }, actions: [],
  text: 'She closes the ledger on one finger.\n\n"How long are you out for?"',
  options: [opt('A few hours.', 'fit_where'), opt('All night.', 'fit_night'), opt('No idea.', 'fit_noidea')],
};

t.fit_noidea = {
  _vine: { x: 300, y: 1050 }, actions: [],
  text: '"All night, then."\n\nShe does not make it a joke.\n\n"Nobody has ever come back early."',
  options: [opt('(go on)', 'fit_night')],
};

t.fit_night = {
  _vine: { x: 520, y: 1000 }, actions: [],
  text: 'Water and a spare battery go on the counter before she asks anything else.\n\n"Right. Above or below?"',
  options: [opt('Above.', 'fit_above'), opt('Below.', 'fit_below')],
};

t.fit_where = {
  _vine: { x: 520, y: 860 }, actions: [],
  text: '"Above or below?"',
  options: [opt('Above.', 'fit_above'), opt('Below.', 'fit_below')],
};

t.fit_above = {
  _vine: { x: 780, y: 820 }, actions: [],
  text: 'Smoked lenses, and a rad band she snaps once to prove it works.\n\n"Watch the band. If it goes, you go. Not after the thing you are watching does something interesting. When it goes."',
  options: [opt('And if it goes early?', 'fit_early'), opt('Understood.', 'fit_boots')],
};

t.fit_early = {
  _vine: { x: 1040, y: 820 }, actions: [],
  text: '"Then it goes early and you have wasted a night."\n\nShe shrugs.\n\n"I have got more bands. I have not got more of you."',
  options: [opt('(take it)', 'fit_boots')],
};

t.fit_below = {
  _vine: { x: 780, y: 1000 }, actions: [],
  text: 'A flashlight, and ear defenders on top of it.\n\n"The pumps come on at four. If you are under the Row when they do and you have not got those on, you will not hear anything else for a day."',
  options: [opt('Every night at four?', 'fit_pumps'), opt('Understood.', 'fit_boots')],
};

t.fit_pumps = {
  _vine: { x: 1040, y: 1000 }, actions: [],
  text: '"Four, or when it rains hard. So: four, and also whenever."',
  options: [opt('(take them)', 'fit_boots')],
};

t.fit_boots = {
  _vine: { x: 1280, y: 910 }, actions: [],
  text: '"Do your boots leak?"',
  options: [opt('No.', 'fit_no_leak'), opt('Yes.', 'fit_leak'), opt('I have not checked.', 'fit_leak')],
};

t.fit_leak = {
  _vine: { x: 1520, y: 980 }, actions: [],
  text: 'The towel goes on the pile.\n\n"Dry your feet before you sit down, not after. Wet and still is what does it, not wet."',
  options: [opt('(take the pile)', 'fit_done')],
};

t.fit_no_leak = {
  _vine: { x: 1520, y: 840 }, actions: [],
  text: '"They will."\n\nThe towel goes on the pile anyway.',
  options: [opt('(take the pile)', 'fit_done')],
};

t.fit_done = {
  _vine: { x: 1760, y: 910 }, actions: [],
  text: 'She writes the lot into the ledger, turns it round so you can see your own name against it, and puts the pencil down.\n\n"That is not a gift. You bring back what you do not use."',
  options: [opt('Show me the shelves.', '__shop__'), opt('Understood.', 'bye')],
};

// Point the root option at the new entry node.
for (const o of t.root.options || []) if (o.next === 'fit_hand') o.next = 'fit_long';

const names = new Set([...Object.keys(t), '__shop__']);
let bad = 0;
for (const [k, v] of Object.entries(t)) for (const o of v.options || [])
  if (o.next && !names.has(o.next)) { console.log('DANGLING ' + k + ' -> ' + o.next); bad++; }

const turns = Object.values(t).filter(v => v._vine?.x >= 300 && typeof v.text === 'string')
  .map(v => (v.text.match(/"[^"]+"/g) || []).join(' ').split(/\s+/).filter(Boolean).length)
  .filter(Boolean);
console.log('fitting nodes: 11  ·  dangling refs: ' + bad);
console.log('her spoken turns, in words: ' + turns.sort((a, b) => a - b).join(', '));

if (WRITE) { fs.writeFileSync(p, canonicalJson(d), 'utf8'); console.log('\nWROTE'); }
else console.log('\ndry run — nothing written');
