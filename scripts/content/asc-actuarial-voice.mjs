/**
 * The insurance vocabulary, said properly. 2026-08-25.
 *
 * ── The note ─────────────────────────────────────────────────────────────────
 *
 * More disdain, less empathy, in how Halcyon talk about the people they cover.
 *
 * ── Why the real words are the brutal ones ───────────────────────────────────
 *
 * The trap here would be writing Ives nastier. A character who is nasty has
 * chosen to be, which makes her a person being cruel and gives the player
 * something to push against.
 *
 * Actual actuarial language is worse than anything invented, because it was
 * built to make a person into a unit and it is used every day by people who mean
 * nothing by it:
 *
 *   an IMPAIRED LIFE      somebody likely to die sooner. A real term.
 *   a SUBSTANDARD RISK    the same person, on a different form.
 *   the RESERVE           money set aside against a death that is expected.
 *   RELEASING a reserve   what happens when they die and you were right.
 *   the BOOK              every life you carry.
 *   LOSS EXPERIENCE       how many of them died last year.
 *   a LOSS EVENT          one of them dying.
 *   SALVAGE               what is recoverable afterwards.
 *   RUN-OFF               a set of lives you have stopped writing and are
 *                         waiting to finish dying.
 *
 * None of it is an insult and all of it erases the person. Ives does not raise
 * her voice anywhere below.
 *
 * ── And the narration stops apologising for her ──────────────────────────────
 *
 * Two lines had the narrator softening her — "A small pause, and she is not
 * being cruel, which is the difficulty with her" and "She says it the way she
 * would say the weather". Both tell the reader how to take what she just said,
 * which is the grading tic, and both were doing the work of making her
 * sympathetic. She does not need the help and should not have it.
 *
 * Run: node scripts/content/asc-actuarial-voice.mjs [--write]
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

// ── Ives ────────────────────────────────────────────────────────────────────
edit('npcs/npc_asc_ives.json', (d, t) => {
  t.the_number.text =
    '"Everybody has one. Yours is not bad."\n\n'
    + 'She turns the ledger a few degrees so you can see the column without being handed it.\n\n'
    + '"That is the reserve we hold against you. It is what we put aside on the assumption that '
    + 'you die on our ground this year, set against what we take off you for standing on it. If '
    + 'you live, we release it in December and it becomes profit."';

  t.the_number_bad.text =
    '"An impaired life on Meltwater Row. Four dependants, a cough that will be emphysema inside '
    + 'two years, and a premium that has never once covered his reserve."\n\n'
    + 'She does not look up.\n\n'
    + '"He is a loss we have already booked. I do not need to meet him. Meeting him would not '
    + 'change the reserve and it would take an afternoon."';

  t.the_number_stop.text =
    '"Then the policy lapses and the district comes off the book."\n\n'
    + 'She turns the page.\n\n'
    + '"People say that as though it were a threat. It is not. It means that after that date, '
    + 'whatever happens to them is not a Halcyon event, and nobody here will ever hear about it."';

  t.the_watch.text =
    '"Sixty-odd declined lives in a storm drain, and I could not tell you one of their names."\n\n'
    + 'She marks the column.\n\n'
    + '"They are also why there is a plate at this gate, why the approach is lit, and why four '
    + 'hundred people are employed watching roads that nothing happens on. They are the most '
    + 'expensive thing in the Basin that produces no premium at all."\n\n'
    + '"Both of those are true and I have never found them difficult to hold at once."';

  t.the_loss_event = {
    _vine: { x: 900, y: 1560 }, actions: [],
    text:
      '"A loss event." She says it the way you would say Tuesday. "The file closes, the reserve '
      + 'is released, and the salvage goes to whichever department can use it."\n\n'
      + '"Chrome comes back to us. It is ours the whole time — you are renting the use of it '
      + 'while you are alive, and that is in the paperwork, and nobody reads that page either."',
    options: [
      opt('And the body?', 'the_loss_body'),
      opt('(say nothing)', 'bye'),
    ],
  };
  t.the_loss_body = {
    _vine: { x: 1160, y: 1560 }, actions: [],
    text:
      '"Depends on the cover. Full assurance and they print you again and the file reopens with '
      + 'the same number on it."\n\n'
      + '"Anything less and it is a disposal, which is a line item, and I have signed several '
      + 'thousand of them and could not tell you a single name off one."',
    options: [opt('(say nothing)', 'bye')],
  };
  insertOpts(t.root, opt('What happens when somebody you cover dies?', 'the_loss_event'));
  log.push('Ives     reserves, impaired lives, loss events, salvage — and no softening narration');
});

// ── Maresh: the vocabulary goes one rung colder ─────────────────────────────
edit('npcs/npc_asc_recruiter.json', (d, t) => {
  if (t.the_words_them) {
    t.the_words_them.text =
      '"Declined lives." He says it with something close to affection.\n\n'
      + '"Not criminals. Nobody at the Spire has ever called them that and I would correct anybody '
      + 'who did. They were offered terms and they declined them. Everything that happens to a '
      + 'person after that is simply the experience of an uncovered life, and we record it, '
      + 'because it is very useful data."';
    log.push('Maresh   "uninsured" becomes "declined lives", and their deaths become useful data');
  }
});

// ── Vess: the Gallery answer, in book terms ─────────────────────────────────
edit('npcs/npc_asc_vess.json', (d, t) => {
  if (t.the_gallery_cost) {
    t.the_gallery_cost.text =
      '"The Gallery? It is held at eleven degrees, year round, at about sixty per cent. The glass '
      + 'is triple and the whole west wall is on its own circuit."\n\n'
      + 'She says the figure without any sense that it is a figure.\n\n'
      + '"It draws rather more than Meltwater Row does. Somebody worked that out once and put it '
      + 'in a paper, and the paper was perfectly correct. The Row is in run-off, you see — we '
      + 'stopped writing new cover there in \'68 and we are simply waiting for the book to '
      + 'finish. You do not re-wire a district you are waiting on."',
    log.push('Vess     the Row is in run-off, which is why it does not get the power');
  }
});

console.log(log.map(l => '  ' + l).join('\n'));
console.log('\n' + (WRITE ? 'WROTE' : 'dry run'));
