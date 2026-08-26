/**
 * The case for the Ascendants, made properly. 2026-08-25.
 *
 * ── The constraint that makes this necessary ─────────────────────────────────
 *
 * They have to APPEAL. A player must be able to join them, believe they are
 * right, and never be told otherwise by the game. If the only thing on the page
 * is coldness, they are villains, the choice is fake, and the satire has nothing
 * to bite on — satire needs a position the reader can feel the pull of.
 *
 * So the argument for them has to be genuinely good, and every part of it has to
 * be TRUE in the fiction. It is:
 *
 *   THEY REFUSE NOBODY. This is not a slogan, it is their actual advantage over
 *   the Long Watch, whose ideology row says in as many words that they will not
 *   train a body with metal in it or flesh that has gone its own way. "Come back
 *   cleansed, or do not come back." An order with a purity test is arguing from
 *   a weak position against one without.
 *
 *   THE CLINIC WORKS. People who go through their gate live longer. Nothing in
 *   the game contradicts this and nothing should.
 *
 *   THE ALTERNATIVE IS NOT FREEDOM. It is the Wildlands, the Scarletwastes and
 *   a drain. The Watch have sabotaged for a generation and the districts are not
 *   better off for it.
 *
 *   THEY DO NOT LIE. Every term is on the form. Kesh names his prices and talks
 *   you down. Ives shows you your own reserve.
 *
 * ── The rule this follows ────────────────────────────────────────────────────
 *
 * From plain-writing.md, out of Moreau: GIVE THE MONSTER THE GOOD SPEECH AND NO
 * REBUTTAL. Wells never lets the decent position win an argument and the book is
 * still not on Moreau's side. Maresh gets six paragraphs here and nobody answers
 * them, and a player who finds them convincing has not misread anything.
 *
 * ⚠ Nothing here is a trick and none of it is undercut. If a later pass adds a
 * line revealing that the clinic is a fraud or the figures are cooked, this
 * whole thing collapses into a villain reveal and the faction stops being worth
 * joining. The horror is that it is all true and it is still what it is.
 *
 * Run: node scripts/content/asc-the-case-for.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const WRITE = process.argv.includes('--write');
const log = [];
const opt = (label, next) => ({ label, next, conditions: [], actions: [], enabled: true });
const insertOpts = (node, ...opts) => {
  const list = (node.options ||= []);
  const fresh = opts.filter(o => !list.some(e => e.label === o.label));
  if (fresh.length) list.splice(1, 0, ...fresh);
};
const edit = (rel, fn) => {
  const p = path.join(ROOT, rel);
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  fn(d, d.dialogue_tree);
  if (WRITE) fs.writeFileSync(p, canonicalJson(d), 'utf8');
};

// ── Maresh: the pitch, and it is a good one ─────────────────────────────────
edit('npcs/npc_asc_recruiter.json', (d, t) => {
  t.why_us = {
    _vine: { x: 900, y: 1700 }, actions: [],
    text:
      '"We take everybody."\n\n'
      + 'He lets that sit, because he knows what you have been told.\n\n'
      + '"Chromed, mutated, half a face, a lung that does not work. Nobody has ever been turned '
      + 'away from that gate for what they are. Go and ask the Watch what their entry '
      + 'requirement is."',
    options: [
      opt('What do they say?', 'why_us_watch'),
      opt('And the price?', 'why_us_price'),
      opt('(say nothing)', 'bye'),
    ],
  };

  t.why_us_watch = {
    _vine: { x: 1160, y: 1620 }, actions: [],
    text:
      '"Come back cleansed, or do not come back."\n\n'
      + 'He quotes it accurately and without relish.\n\n'
      + '"They are decent people and I mean that. But a man with a steel hand cannot sit at their '
      + 'table, and a woman whose body went its own way after the rain cannot either. We would '
      + 'fit them both and never mention it."',
    options: [opt('(say nothing)', 'bye')],
  };

  t.why_us_price = {
    _vine: { x: 1160, y: 1780 }, actions: [],
    text:
      '"On the form. All of it, in order, before you sign."\n\n'
      + '"Nobody here has ever hidden a term from anybody. You will be told what you owe, what we '
      + 'own, and what happens if you stop paying. Read it. Take it away and read it."\n\n'
      + '"I would rather lose you to an afternoon of reading than have you find out in eleven '
      + 'years."',
    options: [opt('(say nothing)', 'bye')],
  };

  insertOpts(t.root, opt('Why should I choose you over the people underground?', 'why_us'));
  log.push('Maresh   the honest pitch: we take everybody, the terms are on the form');
});

// ── Vess: the thing that is simply true ─────────────────────────────────────
edit('npcs/npc_asc_vess.json', (d, t) => {
  t.the_numbers_that_matter = {
    _vine: { x: 900, y: 1840 }, actions: [],
    text:
      '"Sixty-one years, inside the gate. Forty-four, outside it, in the districts we cover."\n\n'
      + '"In the ones we do not, thirty-eight."\n\n'
      + 'She does not press it. She has said it and it is said.',
    options: [
      opt('That could be the districts, not you.', 'the_numbers_argued'),
      opt('(say nothing)', 'bye'),
    ],
  };
  t.the_numbers_argued = {
    _vine: { x: 1160, y: 1840 }, actions: [],
    text:
      '"It could." She is genuinely pleased you said it. "It is the first thing anybody honest '
      + 'asks."\n\n'
      + '"We ran it that way as well. Same districts, before and after cover. It is nine years."\n\n'
      + '"The paper is in the Gallery. You are welcome to disagree with the method."',
    options: [opt('(say nothing)', 'bye')],
  };
  insertOpts(t.root, opt('Does any of this actually help anybody?', 'the_numbers_that_matter'));
  log.push('Vess     the survival figures, and she invites you to attack the method');
});

console.log(log.map(l => '  ' + l).join('\n'));
console.log('\n' + (WRITE ? 'WROTE' : 'dry run'));
