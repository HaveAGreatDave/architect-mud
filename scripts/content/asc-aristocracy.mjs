/**
 * The Ascendants, seen doing it. 2026-08-25.
 *
 * ── The brief ────────────────────────────────────────────────────────────────
 *
 * Aristocratic. They present as benevolent and they are malicious, and the
 * malice has to be OBSERVABLE THROUGH ACTIONS rather than stated in dialogue.
 *
 * That constraint is the useful part. A character who says something cruel has
 * given the player a line to argue with. A character who is charming while their
 * hands do something appalling has given the player nothing to push against, and
 * the player has to carry it instead.
 *
 * ── What aristocracy actually looks like on the page ─────────────────────────
 *
 * Not wealth. Wealth is easy and the Spire already has it. The tells are about
 * WHO IS REQUIRED TO NOTICE WHOM:
 *
 *   They do not hurry, ever, and everybody else does.
 *   They are served by people they do not look at, and never thank, and do not
 *     break sentence for.
 *   They know your name before you give it, and you never learn theirs beyond
 *     a title.
 *   Manners are load-bearing and are used ON you. Nothing they do is rude and
 *     you are somehow always the one apologising.
 *   Something expensive is handed over without any sense that it is expensive.
 *
 * ── The malice, and where it is put ──────────────────────────────────────────
 *
 * Every beat below is a STAGE DIRECTION, not a claim. Nobody says a cruel word.
 *
 *   Vess keeps talking through an attendant who is refilling the pot, and the
 *   attendant is never named, thanked, or acknowledged in any of it.
 *
 *   During the tour, a man is walked out of the Gallery by two people who take
 *   an elbow each. Vess does not break sentence, and moves the group along so
 *   the player is not obliged to watch, which reads as courtesy.
 *
 *   Ives writes something down about the player, unprompted, mid-conversation,
 *   and offers no comment on it. She already has their name.
 *
 *   Maresh gives away something worth more than the player owns and does not
 *   register it as a gift.
 *
 * ⚠ None of these may ever be explained by narration. The rule from
 * plain-writing.md holds: narration that grades the image tells the reader how
 * to feel and takes the discovery away.
 *
 * Run: node scripts/content/asc-aristocracy.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const WRITE = process.argv.includes('--write');
const log = [];
const opt = (label, next) => ({ label, next, conditions: [], actions: [], enabled: true });

// Idempotent by label — a second run must not add the same option again.
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

// ── Vess: served by somebody she does not see ───────────────────────────────
edit('npcs/npc_asc_vess.json', (d, t) => {
  t.the_pot = {
    _vine: { x: 900, y: 1420 }, actions: [],
    text:
      'A woman in Spire grey comes in with a fresh pot, takes the cold one, and puts a cloth '
      + 'under Vess\'s cup without being asked.\n\n'
      + '"— and that is why the eastern figures look worse than they are, of course. Two winters '
      + 'of it and the model has not caught up." Vess does not pause, does not look up, and moves '
      + 'her elbow to let the cloth go under.\n\n'
      + 'The woman goes out. The door is closed quietly from the other side.\n\n'
      + '"Sorry. You wanted to ask me something."',
    options: [
      opt('Who was that?', 'the_pot_who'),
      opt('It can wait.', 'bye'),
    ],
  };
  t.the_pot_who = {
    _vine: { x: 1160, y: 1420 }, actions: [],
    text:
      'Vess looks at the door with real, brief attention, the way you look at a clock.\n\n'
      + '"Do you know, I am not sure. One of the floor staff. They rotate them."\n\n'
      + 'She refills your cup herself, which she does gracefully, and hands it across.\n\n'
      + '"Was she rude to you?"',
    options: [opt('No.', 'bye'), opt('(let it go)', 'bye')],
  };

  // The tour: something happens behind the group and is handled like weather.
  t.gallery_removal = {
    _vine: { x: 900, y: 1560 }, actions: [],
    text:
      'Behind you, at the far end of the Gallery, two people in grey take an elbow each of a '
      + 'third and walk him towards a door that is already open. He is not shouting. One of his '
      + 'shoes comes off and nobody stops for it.\n\n'
      + '"— and the west wall is the original glass, which everybody assumes is a reproduction." '
      + 'Vess has not stopped, and turns, pleasantly, so that the group turns with her and you are '
      + 'facing the other way.\n\n'
      + '"Come and look at this while the light is on it."',
    options: [
      opt('What is happening back there?', 'gallery_removal_ask'),
      opt('(follow her)', 'bye'),
    ],
  };
  t.gallery_removal_ask = {
    _vine: { x: 1160, y: 1560 }, actions: [],
    text:
      '"Somebody\'s account, I should think. It is not our department and it would be rather rude '
      + 'to watch."\n\n'
      + 'She says the last part gently, as advice, and it lands as advice.\n\n'
      + '"The glass, though. Look at the green in it."',
    options: [opt('(look at the glass)', 'bye')],
  };

  insertOpts(t.root,
    opt('(somebody has come in with a pot)', 'the_pot'),
    opt('(there is something happening at the end of the Gallery)', 'gallery_removal'));
  log.push('Vess     an attendant nobody looks at · a man walked out mid-sentence');
});

// ── Ives: she has your name, and she is writing ─────────────────────────────
edit('npcs/npc_asc_ives.json', (d, t) => {
  t.the_note = {
    _vine: { x: 900, y: 1420 }, actions: [],
    text:
      'While you are still talking she writes four or five words on the left-hand page, blots it '
      + 'with the side of her hand, and goes on listening.\n\n'
      + 'She does not offer to show you and does not hide it either.',
    options: [
      opt('What did you just write?', 'the_note_what'),
      opt('(carry on)', 'bye'),
    ],
  };
  t.the_note_what = {
    _vine: { x: 1160, y: 1420 }, actions: [],
    text:
      '"Something about you." She turns the page over, which is not the same as showing you. "It '
      + 'is not unkind. Almost none of it ever is."\n\n'
      + 'She caps the pen.\n\n'
      + '"You have not told me your name and I have used it twice. You did not notice either '
      + 'time, and that is also in there."',
    options: [opt('(say nothing)', 'bye')],
  };
  insertOpts(t.root, opt('(she is writing while you talk)', 'the_note'));
  log.push('Ives     writes about you mid-sentence, and has had your name the whole time');
});

// ── Maresh: gives away a year's wages without noticing ──────────────────────
edit('npcs/npc_asc_recruiter.json', (d, t) => {
  t.the_coat = {
    _vine: { x: 900, y: 1420 }, actions: [],
    text:
      'He notices you are wet before you do.\n\n'
      + '"Oh — take that." He lifts a coat off the back of a chair and puts it into your hands '
      + 'without looking at it. It is heavier than it looks, and lined, and there is no rain in '
      + 'it at all. "There are four of them in the cupboard and I have never counted them."\n\n'
      + '"No, genuinely. It is a coat."',
    options: [
      opt('This is worth more than everything I own.', 'the_coat_worth'),
      opt('Thank you.', 'bye'),
    ],
  };
  t.the_coat_worth = {
    _vine: { x: 1160, y: 1420 }, actions: [],
    text:
      'Maresh looks at it properly for the first time, out of politeness rather than interest.\n\n'
      + '"Is it? I would not know what it cost. It came with the office."\n\n'
      + 'The smile arrives on schedule.\n\n'
      + '"Do keep it. If you turn it down now we will both have to have a conversation about it, '
      + 'and neither of us wants that."',
    options: [opt('(keep the coat)', 'bye')],
  };
  insertOpts(t.root, opt('(he is holding out a coat)', 'the_coat'));
  log.push('Maresh   hands over a year\'s wages and does not register it as a gift');
});

console.log(log.map(l => '  ' + l).join('\n'));
console.log('\n' + (WRITE ? 'WROTE' : 'dry run'));
