/**
 * Saying nothing is the wrong answer. 2026-08-25.
 *
 * ── Two notes ────────────────────────────────────────────────────────────────
 *
 * 1. Deflecting should be MORE abrasive than objecting, not less, and should
 *    make them suspicious of you.
 *
 * 2. If the player pushes far enough, there should be a way to talk themselves
 *    back out of it.
 *
 * ── Why the first one is right about these people ────────────────────────────
 *
 * This is an organisation that exists to classify. Everybody has a class, the
 * class decides what they may draw, and the whole apparatus rests on a person
 * being READABLE. An objection is readable — Ives writes down that you said it
 * and can file you accordingly. Silence is not. A man who will not say what he
 * thinks cannot be sorted, and to them that is the genuinely alarming case.
 *
 * So the ranking, from their side, is the opposite of the intuitive one:
 *
 *   APPROVE   readable, agreeable, promoted
 *   OBJECT    readable, wrong, noted, and unfailingly tolerated
 *   DEFLECT   unreadable — and it is the only one that makes anybody watch you
 *
 * Nobody threatens the player over it. Ives stops writing. Maresh stops
 * predicting your future. Vess's warmth goes to exactly the temperature she uses
 * for claimants. `asc_watched` is set, quietly, and nothing announces it.
 *
 * ── And the way back out ─────────────────────────────────────────────────────
 *
 * Deflect twice and they ask you directly, because an unsorted person is a
 * problem they are obliged to solve. That is the escalation, and it opens a door
 * the player can walk through: give them the answer they want and the file goes
 * back to normal — warmth restored, rep restored, `asc_watched` cleared.
 *
 * ⚠ The recovery must never be free of self-knowledge. The player is not fooling
 * anybody; they are performing agreement to a person who is relieved to hear it,
 * and the scene says so from the player's side rather than the NPC's. Ives
 * accepts it completely, which is what makes it land.
 *
 * Refuse a second time and nothing bad happens either. You simply stay watched,
 * permanently, by people who remain perfectly pleasant. There is no punishment
 * anywhere in this file.
 *
 * Run: node scripts/content/asc-deflect-suspicion.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const WRITE = process.argv.includes('--write');
const log = [];

const opt = (label, next, actions = [], conditions = []) =>
  ({ label, next, conditions, actions, enabled: true });
const flag = (f, v) => ({ action: 'SET_FLAG', flag: f, scope: 'player', value: v });
const warmth = (n, w, why) => ({ action: 'RELATION_ADJUST', npc_id: n, familiarity: 1, warmth: w, reason: why });
const rep = (n) => ({ action: 'ADJUST_REPUTATION', delta: n, ideology_id: 'ideology_ascendants', reason: 'intake' });

const edit = (rel, fn) => {
  const p = path.join(ROOT, rel);
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  fn(d, d.dialogue_tree);
  if (WRITE) fs.writeFileSync(p, canonicalJson(d), 'utf8');
};

// ── Ives: deflecting stops the pen ──────────────────────────────────────────
edit('npcs/npc_asc_ives.json', (d, t) => {
  t.stance_quiet.text =
    'You take the slip. It is warm from the printer and it weighs nothing.\n\n'
    + 'Ives does not go back to the ledger.\n\n'
    + '"You did not say."\n\n'
    + 'It is not an accusation. It is the tone she would use to point out that a form was not '
    + 'signed.\n\n'
    + '"Everyone says something. The ones who agree say so, and the ones who do not say that '
    + 'instead, and either way I know where to put them."';
  t.stance_quiet.options = [
    opt('Put it in the tray and go.', 'stance_quiet_go',
      [flag('asc_watched', '1'), warmth('npc_asc_ives', -1, 'ives:unreadable')]),
    opt('I have not decided.', 'stance_quiet_undecided'),
    opt('(say nothing, and go)', 'bye'),
  ];

  t.stance_quiet_go = {
    _vine: { x: 2200, y: 2320 }, actions: [],
    text:
      '"Of course."\n\n'
      + 'She writes nothing at all, which she has done after every other thing you have said '
      + 'today.\n\n'
      + '"Mind the step on the way down."',
    options: [opt('(go)', 'bye')],
  };

  t.stance_quiet_undecided = {
    _vine: { x: 2200, y: 2460 }, actions: [],
    text:
      '"That is a class of its own and I do not have a column for it."\n\n'
      + 'She sets the pen down, which is worse than her picking it up.\n\n'
      + '"I am going to ask you plainly, because it saves us both a fortnight. The man who was '
      + 'here. Should he have a policy?"',
    options: [
      opt('No. The system is right.', 'stance_recover',
        [flag('asc_mutant_stance', 'approved'), flag('asc_watched', ''),
         warmth('npc_asc_ives', 2, 'ives:answered'), rep(40)]),
      opt('Yes.', 'stance_object'),
      opt('I am still not going to answer that.', 'stance_refused',
        [flag('asc_watched', '1'), warmth('npc_asc_ives', -1, 'ives:refused')]),
      // ⚠ Every rung of this chain keeps a free exit. See asc-always-an-exit.mjs:
      // a scene about being pressed to declare yourself must not itself corner
      // the player, or the game is doing the coercion the fiction denies.
      opt('(let the question sit, and leave)', 'bye'),
    ],
  };

  t.stance_recover = {
    _vine: { x: 2460, y: 2400 }, actions: [],
    text:
      'You hear yourself say it, and it comes out easily, and it sounds exactly like something '
      + 'you believe.\n\n'
      + 'Ives picks the pen back up.\n\n'
      + '"Good. That is all it was."\n\n'
      + 'She writes one word this time, and turns the page, and she is warm again in the way she '
      + 'was before you took the slip.\n\n'
      + '"Come back on Thursday. There is a thing I would like you to carry and I would rather it '
      + 'was somebody I have talked to."',
    options: [opt('(say nothing)', 'bye')],
  };

  t.stance_refused = {
    _vine: { x: 2460, y: 2540 }, actions: [],
    text:
      '"No. I did not think you were."\n\n'
      + 'She is entirely pleasant about it and she does not try again.\n\n'
      + '"Then you go in as unclassified, which is not a punishment. It only means that when '
      + 'somebody upstairs runs the list, you come up on it, and they will send somebody who is '
      + 'better at this than I am."\n\n'
      + '"He will be very nice to you as well."',
    options: [opt('(say nothing)', 'bye')],
  };
  log.push('Ives     deflect stops the pen · she asks plainly · answer well and Thursday exists');
});

// ── Maresh: he stops predicting your future ─────────────────────────────────
edit('npcs/npc_asc_recruiter.json', (d, t) => {
  t.the_second_window.options = [
    opt('Have you ever been through that door?', 'the_second_window_long'),
    opt('(change the subject)', 'hand_deflect',
      [flag('asc_watched', '1'), warmth('npc_asc_recruiter', -1, 'maresh:unreadable')]),
    opt('(say nothing)', 'bye'),
  ];

  t.hand_deflect = {
    _vine: { x: 1680, y: 1820 }, actions: [],
    text:
      '"Certainly."\n\n'
      + 'He lets you change it, and he is as courteous as he was a minute ago, and something has '
      + 'gone out of his face that you would not be able to name if you had not been watching for '
      + 'it.\n\n'
      + 'He does not tell you that you will do well here.\n\n'
      + '"Where were we. The terms, I think."',
    options: [
      opt('You have decided something about me.', 'hand_deflect_ask'),
      opt('(let him move on)', 'bye'),
    ],
  };

  t.hand_deflect_ask = {
    _vine: { x: 1940, y: 1820 }, actions: [],
    text:
      '"I have decided nothing. I am not qualified to."\n\n'
      + 'The smile is back exactly where it was.\n\n'
      + '"You asked a great many questions about a man you will never meet and answered none about '
      + 'yourself. That is unusual, and I write down unusual, because I am asked to."\n\n'
      + '"You could simply tell me and it would go away."',
    options: [
      opt('I think the system is right.', 'hand_recover',
        [flag('asc_mutant_stance', 'approved'), flag('asc_watched', ''),
         warmth('npc_asc_recruiter', 2, 'maresh:answered'), rep(40)]),
      opt('I would rather it did not.', 'hand_stay_watched',
        [flag('asc_watched', '1')]),
      opt('(say nothing, and let him work)', 'bye'),
    ],
  };

  t.hand_recover = {
    _vine: { x: 2200, y: 1760 }, actions: [],
    text:
      'It costs you nothing to say and that is the part you will think about later.\n\n'
      + '"There." He is genuinely relieved, which is somehow the worst thing in the room. "That '
      + 'is all anybody wants. Not agreement — a position. An unsorted person makes everybody '
      + 'nervous and it is nobody\'s fault."\n\n'
      + 'He writes one line and closes the folder.\n\n'
      + '"You will do well here."',
    options: [opt('(say nothing)', 'bye')],
  };

  t.hand_stay_watched = {
    _vine: { x: 2200, y: 1900 }, actions: [],
    text:
      '"As you like."\n\n'
      + 'He does not press it and he does not cool towards you at all, which makes it harder '
      + 'rather than easier.\n\n'
      + '"It is only a line in a folder. Nobody will ever mention it to you and you will never be '
      + 'refused anything because of it."\n\n'
      + '"You will simply notice, in about a year, that you are asked to do the ordinary things '
      + 'and never the interesting ones."',
    options: [opt('(say nothing)', 'bye')],
  };
  log.push('Maresh   deflect and he stops predicting · "You could simply tell me and it would go away."');
});

// ── Vess: warmth drops to claimant temperature ──────────────────────────────
edit('npcs/npc_asc_vess.json', (d, t) => {
  for (const o of t.the_climb_off.options || []) {
    if (o.label === '(follow her to the Vats)') {
      o.next = 'climb_deflect';
      o.actions = [flag('asc_mutant_stance', 'quiet'), flag('asc_watched', '1'),
                   warmth('npc_asc_vess', -1, 'vess:unreadable')];
    }
  }

  t.climb_deflect = {
    _vine: { x: 1420, y: 2200 }, actions: [],
    text:
      'She walks, and she talks, and everything she says is exactly as pleasant as it was.\n\n'
      + 'It takes you most of the corridor to work out what has changed: she is saying the things '
      + 'she says to people who are here to make a claim.\n\n'
      + '"The Vats are through here. Mind the threshold, it catches everybody."',
    options: [
      opt('You have gone cold on me.', 'climb_deflect_ask'),
      opt('(keep walking)', 'bye'),
    ],
  };

  t.climb_deflect_ask = {
    _vine: { x: 1680, y: 2200 }, actions: [],
    text:
      'She stops, and she looks at you, and she is not offended in the least.\n\n'
      + '"I have not. I am being professional with you, and you have noticed the difference, which '
      + 'most people cannot."\n\n'
      + 'A small, honest pause.\n\n'
      + '"I would rather be the other thing. It is only that I do not know what you are yet."',
    options: [
      opt('I think you are right about them.', 'climb_recover',
        [flag('asc_mutant_stance', 'approved'), flag('asc_watched', ''),
         warmth('npc_asc_vess', 2, 'vess:answered'), rep(40)]),
      opt('You do not need to know.', 'bye', [flag('asc_watched', '1')]),
      opt('(say nothing, and keep walking)', 'bye'),
    ],
  };

  t.climb_recover = {
    _vine: { x: 1940, y: 2200 }, actions: [],
    text:
      'You watch yourself decide to say it, and you say it anyway.\n\n'
      + 'The warmth comes back all at once, and it is like a light being switched on.\n\n'
      + '"Oh, good." She takes your arm. "Then let me show you them properly."',
    options: [opt('(go with her)', 'bye')],
  };
  log.push('Vess     deflect drops her to claimant temperature, and she says so when asked');
});

console.log(log.map(l => '  ' + l).join('\n'));
console.log('\n' + (WRITE ? 'WROTE' : 'dry run'));
