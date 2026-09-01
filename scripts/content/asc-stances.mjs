/**
 * Letting the player have an opinion. 2026-08-25.
 *
 * ── The problem ──────────────────────────────────────────────────────────────
 *
 * Every branch in the mutant scenes ended in "(say nothing)". The player could
 * ask what was happening and could not respond to the answer, which turns the
 * most morally loaded scene in the faction into a lecture with a listener.
 *
 * ── The rule this follows ────────────────────────────────────────────────────
 *
 * From the branching-dialogue research already in the docs: A GOOD CHOICE ASKS
 * THE PLAYER WHO THEY ARE, NOT WHAT HAPPENS NEXT. The label should be an act —
 * agree, deflect, object — rather than a preview of the line that follows. And
 * a menu where every option is a question puts the player in a passive seat.
 *
 * So each of these scenes now offers three real stances:
 *
 *   APPROVE      say it out loud. You think the system is right.
 *   DEFLECT      the quiet one. Change the subject, take the slip, move on.
 *   OBJECT       say the thing. Not a speech, one sentence.
 *
 * ── And the results are not symmetrical, on purpose ──────────────────────────
 *
 * APPROVING BUYS ACCESS. Ives shows you your own class, which she does not do
 * for people who flinch, and Halcyon standing goes up. That is a real reward for
 * a real choice, and it should feel good, because if agreeing with them never
 * paid there would be nothing to resist.
 *
 * OBJECTING COSTS ALMOST NOTHING, AND THAT IS THE POINT. Nobody is angry. Nobody
 * argues. Ives is courteous, Maresh is courteous, and the only consequence is
 * that it is written down — which is the callback to her writing about you
 * mid-conversation, and the one thing this organisation does to everybody.
 *
 * DEFLECTING IS ALSO A CHOICE and is recorded as one. `asc_mutant_stance` takes
 * approved / quiet / objected, so later content can know what the player did in
 * the room without anybody ever having confronted them about it.
 *
 * ⚠ Nobody is punished for objecting. No rep loss, no hostility, no gate closed.
 * The moment the Ascendants retaliate they become a villain a player can fight,
 * and the whole deniability collapses. They simply note it and remain pleasant.
 *
 * Run: node scripts/content/asc-stances.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const WRITE = process.argv.includes('--write');
const log = [];

const opt = (label, next, actions = []) => ({ label, next, conditions: [], actions, enabled: true });
const stance = (v) => ({ action: 'SET_FLAG', flag: 'asc_mutant_stance', scope: 'player', value: v });
const warmth = (n, why) => ({ action: 'RELATION_ADJUST', npc_id: n, familiarity: 1, warmth: 1, reason: why });
const rep = (n) => ({ action: 'ADJUST_REPUTATION', delta: n, ideology_id: 'ideology_ascendants', reason: 'intake' });

const edit = (rel, fn) => {
  const p = path.join(ROOT, rel);
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  fn(d, d.dialogue_tree);
  if (WRITE) fs.writeFileSync(p, canonicalJson(d), 'utf8');
};

// ── Ives ────────────────────────────────────────────────────────────────────
edit('npcs/npc_asc_ives.json', (d, t) => {
  t.the_mutant_written.options = [
    opt('Then the machine is doing its job.', 'stance_approve',
      [stance('approved'), warmth('npc_asc_ives', 'ives:intake-agreed'), rep(40)]),
    opt('(take the slip and let it go)', 'stance_quiet', [stance('quiet')]),
    opt('He is a man. You have him down as property.', 'stance_object', [stance('objected')]),
  ];

  t.stance_approve = {
    _vine: { x: 1940, y: 2180 }, actions: [],
    text:
      'She looks at you for slightly longer than the answer needed.\n\n'
      + '"It is. Most people cannot say that out loud, and then they use the clinic anyway."\n\n'
      + 'She turns the ledger round properly this time, and puts a finger on a line partway down.\n\n'
      + '"That is yours. Class four. You are two above the man who was just here and four below '
      + 'the woman who signs my wages."\n\n'
      + '"Nobody is shown that. Do not make me regret it."',
    options: [opt('(look at the line)', 'bye')],
  };

  t.stance_quiet = {
    _vine: { x: 1940, y: 2320 }, actions: [],
    text:
      'You take the slip. It is warm from the printer and it weighs nothing.\n\n'
      + 'Ives is already on the next page.\n\n'
      + '"Put it in the tray by the door on your way out."',
    options: [opt('(put it in the tray)', 'bye')],
  };

  t.stance_object = {
    _vine: { x: 1940, y: 2460 }, actions: [],
    text:
      '"He is, yes."\n\n'
      + 'She does not argue and she does not look away.\n\n'
      + '"And there is no column on that form for it, so it does not go anywhere, and the page '
      + 'still goes to Nine."\n\n'
      + 'She writes four or five words on the left-hand page and blots it with the side of her '
      + 'hand.\n\n'
      + '"That is not a mark against you. Almost nothing is."',
    options: [
      opt('What did you just write?', 'stance_object_note'),
      opt('(leave it)', 'bye'),
    ],
  };

  t.stance_object_note = {
    _vine: { x: 2200, y: 2460 }, actions: [],
    text:
      '"That you said it."\n\n'
      + 'She caps the pen.\n\n'
      + '"People who say it at the desk mostly stop saying it by the second winter. The ones who '
      + 'do not are worth knowing about, and I do not mean that unkindly."',
    options: [opt('(say nothing)', 'bye')],
  };
  log.push('Ives     approve buys your own class · object gets written down · quiet is recorded too');
});

// ── Maresh ──────────────────────────────────────────────────────────────────
edit('npcs/npc_asc_recruiter.json', (d, t) => {
  t.the_handshake_ask.options = [
    opt('I would not have shaken it either.', 'hand_approve',
      [stance('approved'), warmth('npc_asc_recruiter', 'maresh:hand-agreed'), rep(40)]),
    opt('What is at the second window?', 'the_second_window', [stance('quiet')]),
    opt('You would not touch him.', 'hand_object', [stance('objected')]),
  ];

  t.hand_approve = {
    _vine: { x: 1420, y: 1900 }, actions: [],
    text:
      '"No." The smile is different for a moment — smaller, and actually his. "No, most people '
      + 'would not, and most people will not say so."\n\n'
      + 'He sits back down.\n\n'
      + '"You will do well here. That is not flattery, it is a prediction, and I make about four '
      + 'a year."',
    options: [opt('(say nothing)', 'bye')],
  };

  t.hand_object = {
    _vine: { x: 1420, y: 2060 }, actions: [],
    text:
      '"I would not."\n\n'
      + 'He says it without any defence at all, which is worse than a defence.\n\n'
      + '"And he will be seen today. In the Yards they would not have let him in off the '
      + 'step."\n\n'
      + 'A small pause, and it is the only unpolished second in the conversation.\n\n'
      + '"You want one of those to make the other one all right. It will not, and I am not going '
      + 'to pretend it does."',
    options: [
      opt('I am not going to get comfortable with it.', 'hand_object_hard'),
      opt('(let it go)', 'bye'),
    ],
  };

  t.hand_object_hard = {
    _vine: { x: 1680, y: 2060 }, actions: [],
    text:
      '"Good."\n\n'
      + 'He means it, and that is the difficulty with him.\n\n'
      + '"Come back and tell me in a year. I keep a list of people who said that and I have never '
      + 'once had to cross a name off it in under two."',
    options: [opt('(say nothing)', 'bye')],
  };
  log.push('Maresh   agree and he predicts your future · object and he agrees with you');
});

// ── Vess ────────────────────────────────────────────────────────────────────
edit('npcs/npc_asc_vess.json', (d, t) => {
  t.the_climb_off.options = [
    opt('Then they do not belong here.', 'climb_approve',
      [stance('approved'), warmth('npc_asc_vess', 'vess:climb-agreed'), rep(40)]),
    opt('(follow her to the Vats)', 'bye', [stance('quiet')]),
    opt('He never came back out, did he.', 'climb_object', [stance('objected')]),
  ];

  t.climb_approve = {
    _vine: { x: 1420, y: 1900 }, actions: [],
    text:
      'The warmth comes back all at once, and it is like a light being switched on.\n\n'
      + '"Thank you. Honestly — thank you. One spends so much of one\'s day being careful."\n\n'
      + 'She takes your arm, which she has not done before.\n\n'
      + '"Come on. I am going to show you the Vats properly, not the version they get."',
    options: [opt('(go with her)', 'bye')],
  };

  t.climb_object = {
    _vine: { x: 1420, y: 2060 }, actions: [],
    text:
      '"No."\n\n'
      + 'She does not flinch and she does not pretend she has to think about it.\n\n'
      + '"There would have been nowhere to send him. He could not work and he could not be '
      + 'covered, and no district would have housed him — you know that as well as I do, and it '
      + 'is the part nobody ever says out loud."\n\n'
      + 'She smooths the front of her coat.\n\n'
      + '"It was handled kindly. I did ask."\n\n'
      + 'She starts walking, and her voice is exactly as warm as it was ten minutes ago.\n\n'
      + '"The Vats are this way. You will like them. Everybody does."',
    options: [opt('(follow her)', 'bye')],
  };
  log.push('Vess     agree and she takes your arm · object and she is sorry, and would do it again');
});

console.log(log.map(l => '  ' + l).join('\n'));
console.log('\n' + (WRITE ? 'WROTE' : 'dry run'));
