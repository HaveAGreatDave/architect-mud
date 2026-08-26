/**
 * Reversion. 2026-08-25.
 *
 * ── The note ─────────────────────────────────────────────────────────────────
 *
 * Mutants are less than human to them. Bionics are evolution. Mutants are
 * disgusting.
 *
 * ── The word, and it is already ours ─────────────────────────────────────────
 *
 * REVERSION. Wells uses it in The Island of Doctor Moreau for the Beast Folk
 * sliding back, and plain-writing.md already quotes that passage. The Ascendants
 * believe humanity climbs. So mutation is not a different way up, it is the same
 * ladder travelled downward, and a mutant is a person in the act of going back
 * to being an animal.
 *
 * That single word does the whole job. It sounds technical, it is deniable in
 * committee, and it says the person is less than human without one insult in it.
 *
 * ── The disgust is physical, never stated ────────────────────────────────────
 *
 * Nobody says disgusting. Per the standing rule, malice is observable through
 * action: a hand not taken, a step back that is passed off as making room, a
 * chair sent to be cleaned after somebody has sat in it. A player watches a
 * gracious person be unable to touch somebody and does not need it explained.
 *
 * ── The Swift line ───────────────────────────────────────────────────────────
 *
 * One flat administrative detail, delivered with no emphasis and no reaction
 * from anybody in the scene: the intake form for a mutant is not the human one.
 * plain-writing.md calls this letting the arithmetic carry the feeling, and it
 * is the most Modest Proposal thing in the faction.
 *
 * ⚠ Deniability still holds. Every character believes this is classification
 * rather than contempt, and would be genuinely wounded to hear otherwise. Nobody
 * is ever refuted. A player who agrees with them has not misread the scene.
 *
 * Run: node scripts/content/asc-reversion.mjs [--write]
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

// ── the ideology row ────────────────────────────────────────────────────────
edit('orgs/ideology_ascendants.json', (d) => {
  d.description = d.description.replace(
    /The climb has stages[\s\S]*?in use for thirty years\./,
    'The climb has stages and they know which stage everybody is on. Chrome is an improvement '
    + 'made on purpose: designed, tested, licensed, recorded, and removable. Mutation is the same '
    + 'ladder travelled downward, and they have a word for it — reversion — which they use in '
    + 'meetings without anybody blinking. A mutant is not a person who changed. A mutant is a '
    + 'person going back. They will not seat one, treat one, insure one or touch one, and they '
    + 'are unfailingly polite about all four.');
  log.push('ideology  reversion: the same ladder travelled downward');
});

// ── Maresh ──────────────────────────────────────────────────────────────────
edit('npcs/npc_asc_recruiter.json', (d, t) => {
  t.why_us_plain.text =
    '"No."\n\n'
    + 'He does not soften it and he does not enjoy it.\n\n'
    + '"Not for work, not for the clinic, not for cover. Chrome is a step up the ladder. What has '
    + 'happened to them is the same ladder in the other direction, and we have a word for it. '
    + 'Reversion."\n\n'
    + '"I have turned away people I liked. I did it correctly and I went home."';

  t.the_handshake = {
    _vine: { x: 900, y: 1980 }, actions: [],
    text:
      'A man comes to the desk while you are standing there. His jaw is wrong and one hand has '
      + 'too many joints in it, and he is holding a docket, and he is polite.\n\n'
      + 'Maresh stands, smiles, and puts both his own hands behind his back.\n\n'
      + '"Of course. Second window, and they will see you today." He does not sit down again '
      + 'until the man has gone through the door and it has closed.\n\n'
      + '"Now. Where were we."',
    options: [
      opt('You did not shake his hand.', 'the_handshake_ask'),
      opt('(let it go)', 'bye'),
    ],
  };
  t.the_handshake_ask = {
    _vine: { x: 1160, y: 1980 }, actions: [],
    text:
      '"I did not, no."\n\n'
      + 'He is not embarrassed and he does not pretend not to understand.\n\n'
      + '"I was courteous to him, and he will be seen today, which is more than he would get '
      + 'anywhere else in this city."\n\n'
      + 'He straightens something on the desk that was already straight.\n\n'
      + '"Being courteous cost me nothing. What you are asking about would have."',
    options: [
      opt('What is at the second window?', 'the_second_window'),
      opt('(say nothing)', 'bye'),
    ],
  };
  insertOpts(t.root, opt('(somebody has come to the desk)', 'the_handshake'));
  log.push('Maresh   hands behind his back · "You are asking me to touch it as well."');
});

// ── Ives: the form ──────────────────────────────────────────────────────────
edit('npcs/npc_asc_ives.json', (d, t) => {
  t.the_mutant_number.text =
    '"There is no number."\n\n'
    + 'She turns the ledger back and does not offer it this time.\n\n'
    + 'She enters his details anyway, to show you. Under the counter a terminal wakes up and '
    + 'begins printing, unhurried, the way a machine prints a thing it prints all day.\n\n'
    + '"To price a life I need thirty years of people dying on schedule. Nobody has that for a '
    + 'mutant. No two of them are alike and none of them were designed."\n\n'
    + 'She tears the slip off and turns it round so you can read the top of it.\n\n'
    + '<span class="term-print">FORM 9 — UNVALUED LIVING PROPERTY</span>\n\n'
    + '"I did not pick that. I typed what he is and the system printed what applies."';
  t.the_mutant_number.options = [
    opt('Living property.', 'the_mutant_form'),
    opt('They still die. You could count that.', 'the_mutant_count'),
    opt('(say nothing)', 'bye'),
  ];
  t.the_mutant_form = {
    _vine: { x: 1160, y: 2260 }, actions: [],
    text:
      '"Everybody gets a class. You have one. I have one."\n\n'
      + 'She taps the terminal with one knuckle, and there is something like affection in it.\n\n'
      + '"It reads what a person is and sorts them, and the class decides what they may draw. The '
      + 'clinic, the water, the schools, which floor they may stand on. Nine is the bottom of it '
      + 'and it is not a punishment, it is where the arithmetic puts them."\n\n'
      + '"Before this, a clerk decided. Clerks have bad mornings."',
    options: [
      opt('So the machine decides who counts as a person.', 'the_mutant_class'),
      opt('(say nothing)', 'bye'),
    ],
  };

  t.the_mutant_class = {
    _vine: { x: 1420, y: 2260 }, actions: [],
    text:
      '"The machine decides nothing. It applies what it is given."\n\n'
      + 'She squares the slip against the edge of the counter.\n\n'
      + '"And it is fairer than I am. It put him in Nine. It puts everybody like him in Nine, '
      + 'every time, whoever is standing at this desk and whatever kind of morning she is '
      + 'having."\n\n'
      + '"That is what fair means."',
    options: [
      opt('Somebody wrote that rule.', 'the_mutant_written'),
      opt('(say nothing)', 'bye'),
    ],
  };

  t.the_mutant_written = {
    _vine: { x: 1680, y: 2260 }, actions: [],
    text:
      '"Of course somebody did. It did not fall out of the sky."\n\n'
      + 'She says it the way you would explain that a bridge has engineers.\n\n'
      + '"A committee, in \'39. Eleven of them, and they took four years over it, and the minutes '
      + 'are in the Gallery if you would like to read them. They were careful people."\n\n'
      + 'She turns back to the ledger.\n\n'
      + '"The page goes to Nine — not the ninth floor, the department. There is no name on the '
      + 'slip, only the number. Nineteen years, and I have never had cause to send anything else '
      + 'there."',
    options: [opt('(say nothing)', 'bye')],
  };
  log.push('Ives     the F-forty, which is also the livestock form, and she cannot see the problem');
});

// ── Vess ────────────────────────────────────────────────────────────────────
edit('npcs/npc_asc_vess.json', (d, t) => {
  t.the_climb_off.text =
    'For the first time she is not warm.\n\n'
    + '"They are going the other way down it."\n\n'
    + 'She glances at the door of the Gallery, and the glance is a check rather than a look.\n\n'
    + '"We had one in here in \'71. A nice enough man, and it was not his fault, and nobody says '
    + 'it is their fault." A small, controlled pause. "He was seen the same afternoon. They are '
    + 'very quick with it, which I have always been grateful for."\n\n'
    + 'Then it passes, and she is herself again, and she moves you along with a hand that does '
    + 'not quite touch your back.\n\n'
    + '"Come and see the Vats. That is the part everybody remembers."';
  log.push('Vess     "the chair went out afterwards and was not brought back"');
});

console.log(log.map(l => '  ' + l).join('\n'));
console.log('\n' + (WRITE ? 'WROTE' : 'dry run'));
