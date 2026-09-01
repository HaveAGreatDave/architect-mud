/**
 * Say mutant. 2026-08-25.
 *
 * ── The mistake ──────────────────────────────────────────────────────────────
 *
 * The purity pass wrote around the word. "A body changed by the rain." "People
 * the rain changed." "Unlicensed variation." A player who has never met the
 * mutation system has no idea any of that means MUTANTS, and the whole exchange
 * reads as weather policy.
 *
 * That is the same fault as a surgeon selling "the unit" and a quartermaster
 * asking how long you are "out" for. Euphemism hiding its own referent, dressed
 * as atmosphere.
 *
 * ── And the structure was backwards ──────────────────────────────────────────
 *
 * The euphemism is the best thing about these characters, and it only works if
 * the plain word gets there first. A reader who has never heard the ordinary
 * term cannot recognise a refusal to use it.
 *
 * So the PLAYER says mutant, plainly, in the option label. Halcyon corrects
 * them. That correction is instantly legible — everybody has watched somebody
 * do it — and it characterises the whole order in one move, which is what the
 * euphemism was supposed to do and could not while it was the only word on the
 * page.
 *
 * The rule, for the docs: A EUPHEMISM NEEDS ITS PLAIN WORD IN THE SCENE. On its
 * own it is not a euphemism, it is just an unclear noun.
 *
 * Run: node scripts/content/asc-say-mutant.mjs [--write]
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

// ── the ideology row says the word ──────────────────────────────────────────
edit('orgs/ideology_ascendants.json', (d) => {
  d.description = d.description.replace(
    'The climb has stages and they know which stage everybody is on. A body improved on purpose '
    + 'is chrome: designed, tested, licensed, recorded, and removable. A body changed by the rain '
    + 'is not an improvement at all, and the Ascendants will not have it near them. They are not '
    + 'cruel about it. They are sorry about it, they have a form for it, and the form has been in '
    + 'use for thirty years.',
    'The climb has stages and they know which stage everybody is on. Chrome is an improvement '
    + 'made on purpose: designed, tested, licensed, recorded, and removable. Mutation is none of '
    + 'those things, and they will not have a mutant inside the Gate. They do not call them '
    + 'mutants. They say unlicensed variation, and they say it sadly, and they have a form for it '
    + 'that has been in use for thirty years.');
  log.push('ideology  says mutation and mutant, then shows the word they use instead');
});

// ── Maresh: the player says it, he corrects them ────────────────────────────
edit('npcs/npc_asc_recruiter.json', (d, t) => {
  t.why_us.options = [
    opt('What about mutants?', 'why_us_variation'),
    opt('And the price?', 'why_us_price'),
    opt('(say nothing)', 'bye'),
  ];

  t.why_us_variation.text =
    '"We do not use that word."\n\n'
    + 'He says it the way you would correct a child\'s grammar, kindly, without stopping.\n\n'
    + '"Unlicensed variation. A body that changed without anybody choosing it or recording it. We '
    + 'cannot price that — nobody knows what it does at fifty, because nobody designed it."\n\n'
    + '"So it is declined at intake. There is a form. The form is older than I am."';

  t.why_us_variation.options = [
    opt('So a mutant cannot come through the Gate.', 'why_us_plain'),
    opt('That is a purity test.', 'why_us_purity'),
    opt('(say nothing)', 'bye'),
  ];

  t.why_us_plain = {
    _vine: { x: 1420, y: 1480 }, actions: [],
    text:
      '"No."\n\n'
      + 'He does not soften it and he does not enjoy it.\n\n'
      + '"Not for work, not for the clinic, not for cover. I have turned away people I liked. I '
      + 'did it correctly and I went home."',
    options: [
      opt('That is a purity test.', 'why_us_purity'),
      opt('(say nothing)', 'bye'),
    ],
  };

  t.why_us_purity.text =
    '"It is an engineering standard."\n\n'
    + 'The smile arrives on schedule.\n\n'
    + '"The Watch will not seat a man with a steel hand, and that hand is the best thing that '
    + 'ever happened to him. We would fit it, warranty it and service it for forty years. We ask '
    + 'only that the change was chosen."\n\n'
    + '"Their rule is about what a person is. Ours is about what can be documented."';
  log.push('Maresh   "What about mutants?" -> "We do not use that word." -> "No."');
});

// ── Vess: same, plainly ─────────────────────────────────────────────────────
edit('npcs/npc_asc_vess.json', (d, t) => {
  t.the_climb.options = [
    opt('Where do mutants come in?', 'the_climb_off'),
    opt('(say nothing)', 'bye'),
  ];
  t.the_climb_off.text =
    'For the first time she is not warm.\n\n'
    + '"They are not on it."\n\n'
    + 'Then it passes, and she is herself again, and she moves you along with a hand that does '
    + 'not quite touch your back.\n\n'
    + '"Come and see the Vats. That is the part everybody remembers."';
  log.push('Vess     the player asks about mutants in the plain word; her answer is four');
});

// ── Ives prices it, because that is her whole register ──────────────────────
edit('npcs/npc_asc_ives.json', (d, t) => {
  t.the_mutant_number = {
    _vine: { x: 900, y: 2120 }, actions: [],
    text:
      '"There is no number."\n\n'
      + 'She turns the ledger back and does not offer it this time.\n\n'
      + '"To price a life I need thirty years of people like you dying on schedule. Nobody has '
      + 'that for a mutant, because no two of them are alike and none of them were designed."\n\n'
      + '"An unpriceable life is declined. It is not a moral position. It is the same rule that '
      + 'declines an unmapped building."',
    options: [
      opt('They still die. You could count that.', 'the_mutant_count'),
      opt('(say nothing)', 'bye'),
    ],
  };
  t.the_mutant_count = {
    _vine: { x: 1160, y: 2120 }, actions: [],
    text:
      'She looks up properly, which she does about once a conversation.\n\n'
      + '"We do count it. It is in the second book."\n\n'
      + '"Nobody has ever asked me to price it."',
    options: [opt('(say nothing)', 'bye')],
  };
  insertOpts(t.root, opt('What is a mutant worth to Halcyon?', 'the_mutant_number'));
  log.push('Ives     an unpriceable life is declined — and yes, she counts them anyway');
});

console.log(log.map(l => '  ' + l).join('\n'));
console.log('\n' + (WRITE ? 'WROTE' : 'dry run'));
