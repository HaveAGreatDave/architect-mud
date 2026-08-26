/**
 * The Ascendants, written as what they are. 2026-08-25.
 *
 * ── The brief ────────────────────────────────────────────────────────────────
 *
 * They are the status quo and the Long Watch's opposite: authoritarian, contemptuous
 * of freedom, corrupt, excessive, and certain of their own superiority. None of
 * that may ever be said out loud, by them or by the narration. No character in
 * this game calls anybody a fascist and none ever will.
 *
 * ── The method, which is already in our own docs ─────────────────────────────
 *
 * plain-writing.md has the three rules for this, taken from the library:
 *
 *   GIVE THE ENEMY A SINCERE ETHIC AND NEVER LET THEM DOUBT IT. London is
 *   explicit that the Iron Heel's strength was not its prisons but "its
 *   satisfied conception of its own righteousness".
 *
 *   A VOICE CONVICTS ITSELF. Zamyatin's narrator praises a "sterile, faultless
 *   sky" and calls dancing beautiful BECAUSE it is unfree. Zamyatin never steps
 *   in.
 *
 *   GIVE THE MONSTER THE GOOD SPEECH AND NO REBUTTAL.
 *
 * So nobody here argues for authority. They assume it and move on to something
 * else, and the assumption is the thing the player is left holding.
 *
 * ── Which of Eco's fourteen features are used, and how ───────────────────────
 *
 *   CONTEMPT FOR THE WEAK        Ives prices a human life and is not uneasy
 *                                about the number. The actuarial conceit was
 *                                already there; it just never bit anybody.
 *   DISAGREEMENT IS TREASON      Never said as treason. Said as concern —
 *                                "you seem unsettled, shall I book you in?"
 *                                which is worse and is deniable.
 *   THE ENEMY PARADOX            The Watch are simultaneously sixty people in a
 *                                drain and the reason for the entire security
 *                                apparatus, in one breath, unnoticed.
 *   NEWSPEAK                     They already do this and it was never pointed
 *                                at: Assurance, Proof of Loss, The Account,
 *                                Adjuster, Restoring Service. Maresh now
 *                                corrects the player's vocabulary, kindly.
 *   SELECTIVE POPULISM           "Individuals as individuals have no rights."
 *                                Here: a person is an account, and an account
 *                                is a thing the Spire holds an opinion about.
 *
 * Excess is never described as luxury. It is described as maintenance, by
 * somebody who has stopped seeing it.
 *
 * Run: node scripts/content/asc-politics.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const WRITE = process.argv.includes('--write');
const log = [];
const opt = (label, next) => ({ label, next, conditions: [], actions: [], enabled: true });

// ⚠ Insert, never append blind. A bare `options.splice(1, 0, opt(...))` adds the
// same option again on every run, so replaying the chain twice gave Vess two
// copies of every question and three copies after a third. Nothing complains:
// the dialogue still loads, the player just sees the same line listed twice.
// Matching on `label` is enough, because a label is what the player clicks and
// two options with one label are indistinguishable in the client anyway.
const insertOpts = (node, ...opts) => {
  const list = (node.options ||= []);
  const fresh = opts.filter((o) => !list.some((e) => e.label === o.label));
  if (fresh.length) list.splice(1, 0, ...fresh);
  return fresh.length;
};

const edit = (rel, fn) => {
  const p = path.join(ROOT, rel);
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  fn(d, d.dialogue_tree);
  if (WRITE) fs.writeFileSync(p, canonicalJson(d), 'utf8');
};

// ── the ideology row: the politics, with no political words in it ───────────
edit('orgs/ideology_ascendants.json', (d) => {
  d.description =
    'Humanity\'s next evolution will be engineered. The Ascendants hold the Architect to be '
    + 'humanity\'s greatest achievement, not a jailer to be broken but a mind to be joined. '
    + 'Civilization is not to be abandoned but perfected: through cybernetics, artificial '
    + 'intelligence, cloning and relentless scientific progress the species climbs past its own '
    + 'limits.\n\n'
    + 'They run the Basin, and they are the reason it works. The trains are on time, the water is '
    + 'clean, the power holds, and the price is that every one of those things knows who used it. '
    + 'They find that a fair exchange and are puzzled by anyone who does not. Ask an Ascendant '
    + 'about freedom and they will tell you, courteously, that people who are free to choose '
    + 'mostly choose badly, and that somebody has to carry the ones who do.\n\n'
    + 'Nobody is refused. Everybody is priced. A person arrives at the Gate as an account, and the '
    + 'Spire holds an opinion about that account which the person is never shown. The furthest '
    + 'along the climb are barely flesh at all: chrome-laced, death itself backed up and defied, '
    + 'their thoughts already bleeding into the machine they intend to become. They are kind to '
    + 'the people below them and could not name one of them.';
  log.push('ideology_ascendants  the politics, without a political word in it');
});

// ── Ives: contempt for the weak, in a number ────────────────────────────────
edit('npcs/npc_asc_ives.json', (d, t) => {
  t.the_number = {
    _vine: { x: 1100, y: 1150 }, actions: [],
    text:
      '"Everybody has one. Yours is not bad."\n\n'
      + 'She turns the ledger a few degrees so you can see the column without being handed it.\n\n'
      + '"That is what it costs us if you die on our ground this year, against what we take off '
      + 'you for standing on it. Both halves are estimates. The left one is quite a good estimate."',
    options: [
      opt('What is a bad one?', 'the_number_bad'),
      opt('And if the numbers stop working?', 'the_number_stop'),
      opt('(say nothing)', 'bye'),
    ],
  };
  t.the_number_bad = {
    _vine: { x: 1340, y: 1080 }, actions: [],
    text:
      '"A man on Meltwater Row with four children and a cough. He costs a great deal and pays '
      + 'almost nothing."\n\n'
      + 'She says it the way she would say the weather.\n\n'
      + '"I have never met him. I do not need to. That is what the work is."',
    options: [opt('(say nothing)', 'bye')],
  };
  t.the_number_stop = {
    _vine: { x: 1340, y: 1220 }, actions: [],
    text:
      '"Then the policy lapses and the district gets what it can afford, which is a queue."\n\n'
      + 'A small pause, and she is not being cruel, which is the difficulty with her.\n\n'
      + '"People say that as though it were a threat I am making. It is a sum somebody did in 1912 '
      + 'and it has never once been wrong."',
    options: [opt('(say nothing)', 'bye')],
  };
  // The enemy, both trivial and total, in one breath.
  t.the_watch = {
    _vine: { x: 1100, y: 1300 }, actions: [],
    text:
      '"Sixty-odd people living in a storm drain, and I could not tell you one of their names."\n\n'
      + 'She marks the column.\n\n'
      + '"They are also why there is a plate at this gate, why the approach is lit, and why four '
      + 'hundred people are employed watching roads that nothing happens on. They cost us more '
      + 'than the weather does."\n\n'
      + '"Both of those are true and I have never found them difficult to hold at once."',
    options: [opt('(say nothing)', 'bye')],
  };
  insertOpts(t.root,
    opt('You have a number for me, then.', 'the_number'),
    opt('What do you make of the people underground?', 'the_watch'));
  log.push('Ives                 a price on a man with a cough; the enemy trivial and total at once');
});

// ── Vess: unfreedom as a kindness, and excess as maintenance ────────────────
edit('npcs/npc_asc_vess.json', (d, t) => {
  t.choosing = {
    _vine: { x: 1100, y: 1150 }, actions: [],
    text:
      '"Oh, nobody here decides anything difficult." Vess says it as the good news it is meant to '
      + 'be. "Where you live, what you do, when you stop working, who looks after you when you '
      + 'cannot. All of it settled on the day your account opens."\n\n'
      + '"People come up that road worn out, and not from working. From deciding. Rent this month '
      + 'or the doctor. Which of two bad jobs. Whether the water is worth boiling tonight or '
      + 'whether you are too tired and will risk it. Forty of those a week, for twenty years."\n\n'
      + '"And then they put it down. They sleep properly for the first time since they were '
      + 'children."',
    options: [
      opt('And if somebody wants to choose?', 'choosing_want'),
      opt('That sounds like a cage.', 'choosing_cage'),
    ],
  };
  t.choosing_want = {
    _vine: { x: 1360, y: 1080 }, actions: [],
    text:
      '"Then they choose." She is quite untroubled. "Nobody is held here. The Gate opens both '
      + 'ways and it always has."\n\n'
      + '"They simply do it without the clinic, the account, the water and the power, and after a '
      + 'winter of that most of them come back up the road and we are pleased to see them."',
    options: [opt('(say nothing)', 'bye')],
  };
  t.choosing_cage = {
    _vine: { x: 1360, y: 1220 }, actions: [],
    text:
      'She looks at you with real warmth.\n\n'
      + '"You are unsettled. That is very normal in the first fortnight and there is no need to '
      + 'carry it about with you." She is already writing. "I will put you down for a session with '
      + 'somebody kind. It is not a mark against you. It goes on the wellbeing side of the file, '
      + 'which nobody but me reads."\n\n'
      + '"Do come. It is much easier than not coming."',
    options: [opt('(say nothing)', 'bye')],
  };
  t.the_gallery_cost = {
    _vine: { x: 1100, y: 1300 }, actions: [],
    text:
      '"The Gallery? It is held at eleven degrees, year round, at about sixty per cent. The glass '
      + 'is triple and the whole west wall is on its own circuit."\n\n'
      + 'She says the figure without any sense that it is a figure.\n\n'
      + '"It draws rather more than Meltwater Row does. Somebody worked that out once and put it '
      + 'in a paper, and the paper was perfectly correct, and then everybody read it and went back '
      + 'to work. What would you have us do — let it rot to make a point?"',
    options: [opt('(say nothing)', 'bye')],
  };
  insertOpts(t.root,
    opt('Who decides things here?', 'choosing'),
    opt('What does a room like the Gallery cost to keep?', 'the_gallery_cost'));
  // Narration grading itself: the fact stays, the instruction goes.
  if (typeof t.actuarial_report?.text === 'string') {
    t.actuarial_report.text = t.actuarial_report.text
      .replace(' She means it kindly, which is somehow worse.', ' She means it kindly.');
  }
  log.push('Vess                 choice as a burden she relieves you of; the Gallery\'s power bill');
});

// ── Maresh: the vocabulary ──────────────────────────────────────────────────
edit('npcs/npc_asc_recruiter.json', (d, t) => {
  t.the_words = {
    _vine: { x: 1100, y: 1150 }, actions: [],
    text:
      '"Ah — we do not say sacked." Maresh corrects it the way you would straighten somebody\'s '
      + 'collar. "The account was closed. It is not a nicety, it is accurate: nothing was done to '
      + 'him, a relationship simply ended."\n\n'
      + '"We do not say the surveillance either. That is service coverage, and a district that '
      + 'loses it is uncovered, which is a thing that happens TO people rather than a thing we do '
      + 'to them."',
    options: [
      opt('And what do you call the people underground?', 'the_words_them'),
      opt('(say nothing)', 'bye'),
    ],
  };
  t.the_words_them = {
    _vine: { x: 1360, y: 1150 }, actions: [],
    text:
      '"Uninsured." He says it with something close to affection.\n\n'
      + '"Not criminals. Nobody at the Spire has ever called them that and I would correct anybody '
      + 'who did. They have declined cover. Everything that then happens to them is simply what '
      + 'happens to a person who has declined cover."',
    options: [opt('(say nothing)', 'bye')],
  };
  insertOpts(t.root, opt('You have a particular way of putting things.', 'the_words'));
  log.push('Maresh               corrects your vocabulary, kindly: closed, uncovered, uninsured');
});

console.log(log.map(l => '  ' + l).join('\n'));
console.log('\n' + (WRITE ? 'WROTE' : 'dry run'));
