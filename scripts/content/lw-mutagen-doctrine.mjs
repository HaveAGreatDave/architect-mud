/**
 * Teague ranks her enemies. 2026-08-26.
 *
 * ── The change ───────────────────────────────────────────────────────────────
 *
 * The doctrine was earned-against-given, with radiation exposure ("nine years on
 * a hot floor") as the example and chrome condemned in the same breath —
 * "the same thing with a receipt". That is dropped.
 *
 * What replaces it is a hierarchy, and it is the one real factions actually
 * have: RESPECT FOR THE PEER ENEMY, CONTEMPT FOR THE OUT-GROUP.
 *
 *   A CHROMED MAN IS A MAN. Halcyon are the enemy, they are competent, they
 *   have shot at her and she has shot back, and both sides knew what they were
 *   doing. She will not seat one and she will not pretend he is not a person.
 *   There is something close to professional regard in it.
 *
 *   A MUTAGEN USER IS NOT. To her that is not an enemy, not a rival and not a
 *   person. It is what happens when somebody drinks something.
 *
 * So the ladder inverts. The people she is fighting a war against rank ABOVE the
 * people she is not fighting at all, and she would not be able to explain that
 * to you if you asked, because she has never noticed it needs explaining.
 *
 * ── The mutagen is written as a drug ─────────────────────────────────────────
 *
 * Not a rite, not a gift, not a mystery. A substance somebody sells, somebody
 * drinks, and which takes about a fortnight to finish. She describes what stands
 * up at the end in plain physical terms and does not reach for a single
 * metaphor, because the flat description is worse than any image would be.
 *
 * Radiation drops out of her argument almost entirely. It was never the thing
 * she cared about, and keeping it in made her position sound like a policy on
 * industrial injury.
 *
 * ── The line that must not move ──────────────────────────────────────────────
 *
 * ⚠ She never proposes killing the ones who are still people. The four hundred
 * she has shot were things that came at her in a tunnel. Everything else is
 * refusal, exclusion and moving people east, and it is worse for being that.
 *
 * ⚠ And nobody in the game ever compares any of it to Halcyon.
 *
 * Run: node scripts/content/lw-mutagen-doctrine.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const WRITE = process.argv.includes('--write');
const opt = (label, next, actions = []) => ({ label, next, conditions: [], actions, enabled: true });

const p = path.join(ROOT, 'npcs/npc_lw_teague.json');
const d = JSON.parse(fs.readFileSync(p, 'utf8'));
const t = d.dialogue_tree;

// ── the doctrine now opens on the drug ──────────────────────────────────────
t.earned = {
  _vine: { x: 900, y: 900 }, actions: [],
  text:
    '"There is a drink you can buy out south. You pay for it, you swallow it, and about a '
    + 'fortnight later it has finished with you."\n\n'
    + 'She says it the way she would describe any other thing sold to people who should know '
    + 'better.\n\n'
    + '"I have seen what gets up at the end of that fortnight. It is not the person who lay down '
    + 'and it is not a person at all."',
  options: [
    opt('What does it do to them?', 'earned_what'),
    opt('And a chromed man?', 'earned_bought'),
    opt('You are describing a drug.', 'earned_drug'),
    opt('(let her walk on)', 'bye'),
  ],
};

t.earned_what = {
  _vine: { x: 1160, y: 780 }, actions: [],
  text:
    '"Whatever it likes. That is the thing nobody tells you about it."\n\n'
    + 'She is plain about this and it is worse for being plain.\n\n'
    + '"The jaw goes first, usually. Then the hands, and they do not come out as hands. I have '
    + 'seen one with a second set of ribs on the outside and I have seen one that could not close '
    + 'its eyes any more."\n\n'
    + '"Two of them could still talk. That was the worst of the four hundred, and I am not going '
    + 'to be drawn on it."',
  options: [
    opt('They are still people.', 'earned_still'),
    opt('(let her walk on)', 'bye'),
  ],
};

t.earned_drug = {
  _vine: { x: 1160, y: 940 }, actions: [],
  text:
    '"It is a drug. There is nothing else to call it."\n\n'
    + '"Somebody makes it, somebody sells it, and people queue up in the cold for the privilege. '
    + 'They will tell you it is a rite. It is a rite the way a bottle of anything is a rite."\n\n'
    + '"And it is the only drug I know of where the man who took it is not there in the morning '
    + 'to regret it."',
  options: [
    opt('They are still people.', 'earned_still'),
    opt('And a chromed man?', 'earned_bought'),
    opt('(let her walk on)', 'bye'),
  ],
};

t.earned_still = {
  _vine: { x: 1420, y: 780 }, actions: [],
  text:
    '"No."\n\n'
    + 'No heat in it. She has been asked this before and it has never once landed.\n\n'
    + '"A person is a thing you can talk to and come to an arrangement with. I have tried, twice, '
    + 'early on. I do not think either of them knew what a word was by then."\n\n'
    + '"You will tell me the drink did that and not them. It did. They bought it."',
  options: [opt('(say nothing)', 'bye')],
};

// ── and the enemy she respects ──────────────────────────────────────────────
t.earned_bought = {
  _vine: { x: 1160, y: 1100 }, actions: [],
  text:
    '"A chromed man is a man."\n\n'
    + 'It comes out with no particular feeling, which is itself the point.\n\n'
    + '"He made a choice I would not make and he is still somebody I can talk to, threaten, buy, '
    + 'lie to or shoot. He has got a name and a job and an opinion about his supervisor."\n\n'
    + '"I have been shot at by Halcyon people and I have shot back, and both of us knew exactly '
    + 'what we were doing. That is a war. I can respect the other side of a war."',
  options: [
    opt('So you would sit with one.', 'earned_seat'),
    opt('You rank them above the ones out south.', 'earned_rank'),
    opt('(let her walk on)', 'bye'),
  ],
};

t.earned_seat = {
  _vine: { x: 1420, y: 1020 }, actions: [],
  text:
    '"I did not say that."\n\n'
    + '"He does not come in, he does not get taught, and he does not get a seat, because the whole '
    + 'of what we are is that we did not take the shortcut."\n\n'
    + '"But I would give him a straight answer at a door, and I would not be pleased if somebody '
    + 'did him over for nothing. That is not respect for Halcyon. That is what you owe a person."',
  options: [opt('(say nothing)', 'bye')],
};

t.earned_rank = {
  _vine: { x: 1420, y: 1180 }, actions: [],
  text:
    'She thinks about that for slightly too long, and then answers it honestly, which she was '
    + 'always going to.\n\n'
    + '"Yes."\n\n'
    + '"The chromed are the people trying to take this city off us. They are the actual enemy and '
    + 'they are good at it. The ones out south are not fighting me. They are not doing anything to '
    + 'me at all."\n\n'
    + '"And I would still have the chromed man in this tunnel before I had one of them."',
  options: [
    opt('That should bother you.', 'earned_bother'),
    opt('(say nothing)', 'bye'),
  ],
};

t.earned_bother = {
  _vine: { x: 1680, y: 1180 }, actions: [],
  text:
    '"Should it."\n\n'
    + 'Not a question. She checks the tunnel behind you.\n\n'
    + '"I have got a rifle, a stretch, and eleven years of walking it, and in all of that I have '
    + 'never once had cause to change my mind about either of them."\n\n'
    + '"Bring it up with Rennick. He will agree with you and he will be very good about it, and '
    + 'then he will come down here on a Thursday and walk behind me."',
  options: [opt('(say nothing)', 'bye')],
};

// ── the old radiation branch narrows to what it should have been ────────────
t.earned_fault = {
  _vine: { x: 1160, y: 1260 }, actions: [],
  text:
    '"Some of them, no."\n\n'
    + 'She allows it without it costing her anything.\n\n'
    + '"There is bad ground east of the wall and people have lived on it and their children came '
    + 'out wrong, and none of that was chosen by anybody. Those I will move on and I will not enjoy '
    + 'it."\n\n'
    + '"The ones who paid for a bottle are a different matter entirely, and they are most of what '
    + 'is out south."',
  options: [
    opt('Then they should not be treated the same.', 'earned_fault_same'),
    opt('(let her walk on)', 'bye'),
  ],
};

t.earned_fault_same = {
  _vine: { x: 1420, y: 1340 }, actions: [],
  text:
    '"They are not. One I am sorry about."\n\n'
    + 'She starts walking.\n\n'
    + '"Neither of them comes down this tunnel, mind. Sorry is a thing I can be about somebody '
    + 'who is not standing in front of me."',
  options: [opt('(say nothing)', 'bye')],
};

// remove the branches the old framing owned
for (const k of ['earned_same', 'earned_chosen', 'earned_chosen_business', 'earned_chosen_hard']) delete t[k];

// re-point anything that referenced them
for (const [k, v] of Object.entries(t)) {
  if (!Array.isArray(v.options)) continue;
  v.options = v.options.filter(o =>
    !['earned_same', 'earned_chosen', 'earned_chosen_business', 'earned_chosen_hard'].includes(o.next));
}
// keep the route into the tunnel-dwellers branch
if (!(t.earned_rank.options || []).some(o => o.next === 'the_quiet_ones')) {
  t.earned_rank.options.splice(1, 0, opt('Then who is actually down here?', 'the_quiet_ones'));
}

if (WRITE) fs.writeFileSync(p, canonicalJson(d), 'utf8');

const names = new Set([...Object.keys(t), 'bye']);
let bad = 0;
for (const [k, v] of Object.entries(t)) for (const o of v.options || [])
  if (o.next && !names.has(o.next)) { console.log('DANGLING ' + k + ' -> ' + o.next); bad++; }
console.log('  Teague   the mutagen is a drug, described plainly, and it does not leave a person');
console.log('  Teague   a chromed man is a man — the enemy she respects');
console.log('  Teague   and she ranks her enemy above the people who are not fighting her');
console.log('  nodes ' + Object.keys(t).length + ' · dangling ' + bad);
console.log('\n' + (WRITE ? 'WROTE' : 'dry run'));
