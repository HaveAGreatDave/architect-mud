/**
 * The hardest part is what it costs us. 2026-08-25.
 *
 * ── The register ─────────────────────────────────────────────────────────────
 *
 * The Ascendants are a satire on the coldness of capitalism and on the
 * aristocratic managerial class administering it, with an order-of-knights
 * quality underneath: ceremony, oaths, immaculate records, and a settled belief
 * that they are the civilised ones.
 *
 * Nothing below is explicit and nothing ever will be. No uniforms, no insignia,
 * no theory of blood, and no character in this game ever names the comparison.
 *
 * ── The one move that carries it ─────────────────────────────────────────────
 *
 * Not cruelty. Cruelty is a person choosing, and it lets the reader off.
 *
 * The register is SELF-PITY FROM THE PEOPLE DOING IT: this work is difficult,
 * we find it distasteful, we do it anyway, and bearing it is what makes us fit
 * to be trusted with it. That is the most chilling thing an administrator can
 * say and it is said constantly by people who mean it sincerely.
 *
 * So Vess is tired. Ives keeps a book she does not have to keep. Neither is
 * boasting and neither is lying.
 *
 * ── And the satire ───────────────────────────────────────────────────────────
 *
 * plain-writing.md already carries Swift's rules, and A Modest Proposal is in
 * content/books: LET THE ARITHMETIC CARRY THE FEELING — his case is made of
 * numbers with no emotive word anywhere near them — and THE REGISTER NEVER
 * FLINCHES, which is Voltaire narrating an atrocity in the sentence rhythm he
 * uses for a good dinner.
 *
 * So the obscene figure is delivered in the same tone as the weather, once, and
 * nobody in the scene reacts to it.
 *
 * Run: node scripts/content/asc-the-burden.mjs [--write]
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

// ── Vess: it is hard on us, and we do it anyway ─────────────────────────────
edit('npcs/npc_asc_vess.json', (d, t) => {
  t.the_difficulty = {
    _vine: { x: 900, y: 1700 }, actions: [],
    text:
      '"Difficult? Constantly."\n\n'
      + 'She says it without any self-consciousness at all.\n\n'
      + '"Somebody has to decide who is covered. It is not pleasant work and we do not pretend it '
      + 'is. Anyone who enjoyed it would be removed."\n\n'
      + '"We do it and we stay decent about it. That is the whole of the qualification."',
    options: [
      opt('Decent.', 'the_difficulty_decent'),
      opt('(say nothing)', 'bye'),
    ],
  };
  t.the_difficulty_decent = {
    _vine: { x: 1160, y: 1700 }, actions: [],
    text:
      '"Nobody here has ever raised their voice at a claimant."\n\n'
      + 'She means it, and she is proud of it.\n\n'
      + '"I have signed things I did not like. I signed them properly, and I went home, and I did '
      + 'not take it out on anybody. You would be surprised how few people manage that."',
    options: [opt('(say nothing)', 'bye')],
  };
  insertOpts(t.root, opt('Is any of this difficult for you?', 'the_difficulty'));
  log.push('Vess     the work is hard on her, and bearing it is the qualification');
});

// ── Ives: the book nobody makes her keep ────────────────────────────────────
edit('npcs/npc_asc_ives.json', (d, t) => {
  t.the_second_book = {
    _vine: { x: 900, y: 1700 }, actions: [],
    text:
      'There is a second ledger under the first. It is thinner and the spine is not broken.\n\n'
      + '"Declinatures. Everyone we would not cover, and why."\n\n'
      + '"Nobody asks for it. I do it because it should be done properly."',
    options: [
      opt('How many?', 'the_second_book_many'),
      opt('(say nothing)', 'bye'),
    ],
  };
  t.the_second_book_many = {
    _vine: { x: 1160, y: 1700 }, actions: [],
    text:
      '"Since March, eleven thousand and forty."\n\n'
      + 'She does not look it up.\n\n'
      + '"Ask me in a year and I will know that number too."',
    options: [opt('(say nothing)', 'bye')],
  };
  insertOpts(t.root, opt('(there is a second ledger under the first)', 'the_second_book'));
  log.push('Ives     a declinature book nobody requires, kept immaculately, 11,040 since March');
});

// ── the ideology row: the order's self-image ────────────────────────────────
edit('orgs/ideology_ascendants.json', (d) => {
  d.description = d.description.replace(
    'They are kind to the people below them and could not name one of them.',
    'They are kind to the people below them and could not name one of them. They consider '
    + 'themselves the last civilised people in the Basin. They refuse nobody. The clinic works, the '
    + 'water is clean, and people who walk through their gate live longer than people who do not.');
  log.push('ideology  the civilised ones, who find it distasteful and do it anyway');
});

console.log(log.map(l => '  ' + l).join('\n'));
console.log('\n' + (WRITE ? 'WROTE' : 'dry run'));
