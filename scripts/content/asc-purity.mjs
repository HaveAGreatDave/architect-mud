/**
 * Engineered, not accidental. 2026-08-25.
 *
 * ── The correction ───────────────────────────────────────────────────────────
 *
 * A previous pass had Maresh pitching "we take everybody" as the Ascendants'
 * moral advantage over the Long Watch's purity rule. That is wrong. The
 * Ascendants are MORE concerned with purity than the Watch are, not less, and
 * they have an ubermensch complex about it.
 *
 * The distinction is the whole faction, and it is sharper than the one I wrote:
 *
 *   The Long Watch's purity is CONSERVATIVE. Stay as you are. No chrome, no
 *   mutation, remain human. It is a refusal to change at all.
 *
 *   The Ascendants' purity is DIRECTIONAL. Humanity climbs, and the climb must
 *   be engineered — designed, tested, licensed, recorded, reversible. Chrome is
 *   all of those things. Mutation is none of them. A mutant has not ascended,
 *   they have been altered by weather, and to an Ascendant that is not a
 *   different kind of progress, it is the opposite of progress happening to
 *   somebody.
 *
 * So the word for a mutant is never a slur. It is UNLICENSED VARIATION, or a
 * line that cannot be priced, or declined at intake. They are not angry about
 * it. They are sorry about it, they have a form for it, and the form has been
 * in use for thirty years.
 *
 * ── Why this is still appealing, which it has to be ──────────────────────────
 *
 * A player can sincerely agree with the engineering argument. Chrome IS chosen,
 * tested, licensed, warrantied and removable. Mutation IS random, untested,
 * frequently disfiguring and sometimes fatal. Every fact in the pitch is true.
 * The doctrine that grows out of those facts is the horror, and the player has
 * to get there on their own.
 *
 * ── Also fixed here ──────────────────────────────────────────────────────────
 *
 * The ideology row had a paragraph in it TWICE, because asc-the-burden.mjs used
 * a string replace whose anchor survived its own insertion, and the script was
 * run twice. The row is now written whole rather than patched, which cannot
 * duplicate however often this runs.
 *
 * Run: node scripts/content/asc-purity.mjs [--write]
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

// ── the ideology row, written whole ─────────────────────────────────────────
edit('orgs/ideology_ascendants.json', (d) => {
  d.description =
    'Humanity\'s next evolution will be engineered, and the word doing the work is engineered. '
    + 'The Ascendants hold the Architect to be humanity\'s greatest achievement, not a jailer to '
    + 'be broken but a mind to be joined. Civilization is not to be abandoned but perfected: '
    + 'through cybernetics, artificial intelligence, cloning and relentless scientific progress '
    + 'the species climbs past its own limits.\n\n'
    + 'They run the Basin and they are the reason it works. The trains are on time, the water is '
    + 'clean, the power holds, and the price is that every one of those things knows who used it. '
    + 'They find that a fair exchange and are puzzled by anyone who does not. Ask an Ascendant '
    + 'about freedom and they will tell you, courteously, that people who are free to choose '
    + 'mostly choose badly, and that somebody has to carry the ones who do.\n\n'
    + 'The climb has stages and they know which stage everybody is on. A body improved on purpose '
    + 'is chrome: designed, tested, licensed, recorded, and removable. A body changed by radiation '
    + 'is not an improvement at all, and the Ascendants will not have it near them. They are not '
    + 'cruel about it. They are sorry about it, they have a form for it, and the form has been in '
    + 'use for thirty years.\n\n'
    + 'Everybody is priced. A person arrives at the Gate as an account, and the Spire holds an '
    + 'opinion about that account which the person is never shown. The furthest along the climb '
    + 'are barely flesh at all: chrome-laced, death itself backed up and defied, their thoughts '
    + 'already bleeding into the machine they intend to become. They are kind to the people below '
    + 'them and could not name one of them.';
  log.push('ideology  written whole — engineered vs accidental, and the duplicate paragraph gone');
});

// ── Maresh: the real pitch ──────────────────────────────────────────────────
edit('npcs/npc_asc_recruiter.json', (d, t) => {
  t.why_us.text =
    '"Because what we do to you is chosen."\n\n'
    + '"Every piece is designed, tested, licensed and written down. If it fails we know whose '
    + 'bench it came off. If you want it out, it comes out."\n\n'
    + '"Nothing that happens to a person out in the weather is any of those things."';
  t.why_us.options = [
    opt('And the people it happened to?', 'why_us_variation'),
    opt('And the price?', 'why_us_price'),
    opt('(say nothing)', 'bye'),
  ];

  t.why_us_variation = {
    _vine: { x: 1160, y: 1620 }, actions: [],
    text:
      '"Unlicensed variation." He does not enjoy saying it, which is somehow worse than if he '
      + 'did.\n\n'
      + '"We cannot price it. Nobody knows what it does at fifty, because nobody designed it and '
      + 'nobody has records. So it is declined at intake, and there is a form, and the form is '
      + 'older than I am."\n\n'
      + '"I have turned away people I liked. I did it correctly and I went home."',
    options: [
      opt('That is a purity test.', 'why_us_purity'),
      opt('(say nothing)', 'bye'),
    ],
  };

  t.why_us_purity = {
    _vine: { x: 1420, y: 1620 }, actions: [],
    text:
      '"It is an engineering standard."\n\n'
      + 'The smile arrives on schedule.\n\n'
      + '"The Watch will not have a man with a steel hand at their table. We will fit that hand, '
      + 'warranty it, and service it for forty years. We ask only that the change was chosen."\n\n'
      + '"One of those positions is about what a person IS. The other is about what can be '
      + 'documented. I know which one I would rather be judged by."',
    options: [opt('(say nothing)', 'bye')],
  };

  // The old, wrong branch: the Watch quote stays, the claim that we would take
  // a mutant does not.
  t.why_us_watch = {
    _vine: { x: 1160, y: 1780 }, actions: [],
    text:
      '"Come back cleansed, or do not come back."\n\n'
      + 'He quotes it accurately and without relish.\n\n'
      + '"They are decent people and I mean that. But a man with a steel hand cannot sit at their '
      + 'table, and the hand is the best thing that ever happened to him."',
    options: [opt('(say nothing)', 'bye')],
  };
  insertOpts(t.root, opt('What do the Watch say about you?', 'why_us_watch'));
  log.push('Maresh   chosen vs weathered · "unlicensed variation" · declined at intake');
});

// ── Vess: the climb has stages, and she knows yours ─────────────────────────
edit('npcs/npc_asc_vess.json', (d, t) => {
  t.the_climb = {
    _vine: { x: 900, y: 1980 }, actions: [],
    text:
      '"There are stages. It is not a secret and it is not a judgement."\n\n'
      + 'She counts them on her fingers without any ceremony.\n\n'
      + '"Unmodified. Fitted. Extensively fitted. Backed up. And then the ones upstairs, who are '
      + 'mostly pattern by now."\n\n'
      + '"You are on the first. Almost everybody is."',
    options: [
      opt('Where do mutants come in?', 'the_climb_off'),
      opt('(say nothing)', 'bye'),
    ],
  };
  t.the_climb_off = {
    _vine: { x: 1160, y: 1980 }, actions: [],
    text:
      'For the first time she is not warm.\n\n'
      + '"They are not on it."\n\n'
      + 'Then it passes, and she is herself again, and she moves you along with a hand that does '
      + 'not quite touch your back.\n\n'
      + '"Come and see the Vats. That is the part everybody remembers."',
    options: [opt('(follow her)', 'bye')],
  };
  insertOpts(t.root, opt('You keep talking about a climb.', 'the_climb'));
  log.push('Vess     five stages, said as fact — and the one moment she is not warm');
});

console.log(log.map(l => '  ' + l).join('\n'));
console.log('\n' + (WRITE ? 'WROTE' : 'dry run'));
