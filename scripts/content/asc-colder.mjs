/**
 * Shorter is colder. 2026-08-25.
 *
 * The actuarial pass put the right words in, and then made them warm by
 * explaining them. Ives was giving reasons. A person who gives you reasons cares
 * whether you agree, and this one does not.
 *
 * So: cut. Every justification, every second half of a sentence that softened
 * the first, every "which is" and "because". What is left is a woman answering
 * questions accurately and having nothing further to say.
 *
 * The measurement backs this up. Spoken turns in the nine public-domain books
 * run a median of six words against our eleven, and the entire gap is at the
 * short end. Ives's longest turn here drops from 47 words to 14.
 *
 * ⚠ The rule from plain-writing.md still holds — short turns are a SYMPTOM, not
 * a target, and the Quartermaster explaining kit to a newcomer is rightly long.
 * The difference is that she wants to be understood. Ives does not care.
 *
 * Nobody threatens anyone. There is no cruelty anywhere in it. The malice is
 * entirely in what she does not bother to say.
 *
 * Run: node scripts/content/asc-colder.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const WRITE = process.argv.includes('--write');
const log = [];
const edit = (rel, fn) => {
  const p = path.join(ROOT, rel);
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  fn(d, d.dialogue_tree);
  if (WRITE) fs.writeFileSync(p, canonicalJson(d), 'utf8');
};

// ── Ives ────────────────────────────────────────────────────────────────────
edit('npcs/npc_asc_ives.json', (d, t) => {
  t.the_number.text =
    '"Everybody has one. Yours is not bad."\n\n'
    + 'She turns the ledger a few degrees.\n\n'
    + '"Your reserve. What we hold in case you die on our ground this year."\n\n'
    + '"If you do not, it becomes profit in December."';

  t.the_number_bad.text =
    '"Impaired life on Meltwater Row. Four dependants, emphysema inside two years. His premium '
    + 'has never covered his reserve."\n\n'
    + 'She does not look up.\n\n'
    + '"I have not met him."';

  t.the_number_stop.text =
    '"Then the district comes off the book."\n\n'
    + 'She turns the page.\n\n'
    + '"After that it is not a Halcyon event."';

  t.the_watch.text =
    '"Sixty declined lives in a storm drain. I could not name one of them."\n\n'
    + 'She marks the column.\n\n'
    + '"They are also the plate on this gate, the lights on the approach, and four hundred people '
    + 'watching empty roads."\n\n'
    + '"Both true. Neither difficult."';

  t.the_loss_event.text =
    '"A loss event. File closes, reserve releases, salvage goes where it can be used."\n\n'
    + '"The chrome is ours. You were renting it."';

  t.the_loss_body.text =
    '"Full assurance, we print you again."\n\n'
    + '"Anything less is a disposal. It is a line item. I have signed thousands."';

  t.the_note_what.text =
    '"Something about you."\n\n'
    + 'She turns the page over, which is not the same as showing you.\n\n'
    + '"You have not told me your name and I have used it twice. You did not notice. That is in '
    + 'there too."';

  log.push('Ives     longest turn 47 words -> 14; every justification cut');
});

// ── Maresh ──────────────────────────────────────────────────────────────────
edit('npcs/npc_asc_recruiter.json', (d, t) => {
  t.the_words_them.text =
    '"Declined lives." He says it with something close to affection.\n\n'
    + '"Not criminals. They were offered terms and they declined."\n\n'
    + '"What happens to them afterwards is data. We keep it."';

  if (t.the_words) {
    t.the_words.text =
      '"We do not say sacked." Maresh corrects it the way you would straighten somebody\'s '
      + 'collar. "The account was closed. Nothing was done to him."\n\n'
      + '"And it is not surveillance. It is service coverage. A district that loses it is '
      + 'uncovered."';
  }
  log.push('Maresh   the vocabulary lesson, half the length');
});

// ── Vess ────────────────────────────────────────────────────────────────────
edit('npcs/npc_asc_vess.json', (d, t) => {
  t.the_gallery_cost.text =
    '"Eleven degrees, year round, sixty per cent. Triple glass. The west wall is on its own '
    + 'circuit."\n\n'
    + 'She says the figures without any sense that they are figures.\n\n'
    + '"It draws more than Meltwater Row does. The Row is in run-off — we stopped writing there '
    + 'in \'68."\n\n'
    + '"You do not re-wire a district you are waiting on."';

  t.the_pot_who.text =
    'Vess looks at the door with real, brief attention, the way you look at a clock.\n\n'
    + '"I am not sure. One of the floor staff."\n\n'
    + 'She refills your cup herself, gracefully, and hands it across.\n\n'
    + '"Was she rude to you?"';

  t.gallery_removal_ask.text =
    '"Somebody\'s account. Not our department."\n\n'
    + 'She says the next part gently, as advice, and it lands as advice.\n\n'
    + '"It would be rude to watch."\n\n'
    + '"The glass, though. Look at the green in it."';

  log.push('Vess     run-off in two sentences; the removal answered in six words');
});

console.log(log.map(l => '  ' + l).join('\n'));
console.log('\n' + (WRITE ? 'WROTE' : 'dry run'));
