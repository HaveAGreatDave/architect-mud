/**
 * The line, and where it is drawn. 2026-08-25.
 *
 * ── The note ─────────────────────────────────────────────────────────────────
 *
 * A player should be able to push until they are asked to leave — and it must be
 * OBVIOUS when they are one step away, so that backing off is a real choice
 * rather than something they discover afterwards.
 *
 * ── How these people signal it ───────────────────────────────────────────────
 *
 * Not volume. Nobody in this faction will ever raise their voice, and a shouted
 * warning would break everything built so far. They signal by a change of FORM,
 * and each one is a thing the player has watched them do all conversation:
 *
 *   IVES has been writing in the ledger since you walked up. She closes it.
 *   MARESH has been sitting the entire time. He stands.
 *   VESS has been walking you somewhere. She stops walking.
 *
 * Each is then followed by a plain sentence that states the consequence, because
 * a signal the player has to interpret is not a warning. Ives says she will have
 * to ask you to leave and that you would need signing back in. Nobody threatens
 * and nobody bluffs.
 *
 * ── Backing off works, completely ────────────────────────────────────────────
 *
 * Take the offered step back and it is over. No grudge, no note, no cooling. The
 * warning was sincere and so is the reprieve — these are people who would far
 * rather this went smoothly, and letting a player recover cleanly is what makes
 * the warning trustworthy the next time they see it.
 *
 * ── And the door is bureaucratic, not violent ────────────────────────────────
 *
 * Being asked to leave is being asked to leave. Somebody walks you out, politely.
 * `asc_asked_to_leave` is set so later content can know, and the stated cost is
 * paperwork: you are signed out, and coming back means being signed in again.
 * There is no combat, no wanted level, and nobody is ever rude to you.
 *
 * ⚠ This is the closest the faction comes to a punishment and it still is not
 * one. If a later pass makes this a lockout, a rep cliff or a fight, the whole
 * deniability collapses — see asc-the-case-for.mjs.
 *
 * Run: node scripts/content/asc-escalation.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const WRITE = process.argv.includes('--write');
const log = [];

const opt = (label, next, actions = []) => ({ label, next, conditions: [], actions, enabled: true });
const flag = (f, v) => ({ action: 'SET_FLAG', flag: f, scope: 'player', value: v });
const end = { action: 'END_CONVERSATION' };

const edit = (rel, fn) => {
  const p = path.join(ROOT, rel);
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  fn(d, d.dialogue_tree);
  if (WRITE) fs.writeFileSync(p, canonicalJson(d), 'utf8');
};

// ── Ives ────────────────────────────────────────────────────────────────────
edit('npcs/npc_asc_ives.json', (d, t) => {
  // the rung before the warning: pressing after she has noted your objection
  t.stance_object_note.options = [
    opt('Then change the form.', 'ives_press'),
    opt('(say nothing)', 'bye'),
  ];

  t.ives_press = {
    _vine: { x: 2460, y: 2680 }, actions: [],
    text:
      '"I cannot. I do not write the forms."\n\n'
      + 'She is still perfectly civil, and she has said this before to other people.\n\n'
      + '"The committee sat in \'39. You may write to them. Two are alive."',
    options: [
      opt('You could refuse to use it.', 'ives_warning'),
      opt('(leave it)', 'bye'),
    ],
  };

  // THE WARNING. She closes the ledger — the one thing she has not done all scene.
  t.ives_warning = {
    _vine: { x: 2720, y: 2680 }, actions: [],
    text:
      'Ives closes the ledger.\n\n'
      + 'She has written in it, turned it, blotted it and marked her place in it since you walked '
      + 'up, and now it is shut and her hands are flat on the cover.\n\n'
      + '"I am going to ask you to leave in a moment, and I would rather not, because you would be '
      + 'signed out and you would have to be signed back in, and that is a fortnight."\n\n'
      + '"So. Either we talk about something else, or we do not talk."',
    options: [
      opt('Something else, then.', 'ives_backdown'),
      opt('You are a clerk who files people as animals.', 'ives_ejected',
        [flag('asc_asked_to_leave', '1')]),
    ],
  };

  t.ives_backdown = {
    _vine: { x: 2980, y: 2600 }, actions: [],
    text:
      'The ledger opens again.\n\n'
      + '"Thank you." She means it, and there is no edge on it at all. "It is a long day and I '
      + 'would rather not have spent it on that."\n\n'
      + 'She finds her place, which takes her no time.\n\n'
      + '"Now. You wanted to know about the walk with the wallet in it."',
    options: [opt('(carry on)', 'bye')],
  };

  // ⚠ asc-the-grey.mjs owns the richer version of this node (the choice to stay,
  // and being carried out). Create it only if that script has not run, so replay
  // order cannot revert it.
  t.ives_ejected ||= {
    _vine: { x: 2980, y: 2760 }, actions: [end],
    text:
      '"Yes."\n\n'
      + 'She does not stand up and she does not call anybody. She simply looks past your shoulder '
      + 'and a man in Spire grey is already there, because he was always already there.\n\n'
      + '"Thank you for coming in. Sign out at the plate."\n\n'
      + 'He walks you to the road. He is pleasant the whole way and does not touch you once, and '
      + 'at the bottom he says the road is a bit slick tonight and to mind how you go.',
    options: [],
  };
  log.push('Ives     closes the ledger, states the cost, and the door is a polite walk to the road');
});

// ── Maresh ──────────────────────────────────────────────────────────────────
edit('npcs/npc_asc_recruiter.json', (d, t) => {
  t.hand_object_hard.options = [
    opt('You know exactly what happens to them.', 'maresh_press'),
    opt('(say nothing)', 'bye'),
  ];

  t.maresh_press = {
    _vine: { x: 1940, y: 2200 }, actions: [],
    text:
      '"I do not."\n\n'
      + 'It is the first thing he has said today that arrives flat.\n\n'
      + '"I have told you I have never been through that door. You may believe that or not, and '
      + 'you will notice I have not asked you to."',
    options: [
      opt('Then find out.', 'maresh_warning'),
      opt('(let it go)', 'bye'),
    ],
  };

  // THE WARNING. He stands, having sat through the entire conversation.
  t.maresh_warning = {
    _vine: { x: 2200, y: 2200 }, actions: [],
    text:
      'Maresh stands up.\n\n'
      + 'He has been sitting since you came in, through all of it, and now he is on his feet and '
      + 'his hands are in front of him and he is still smiling.\n\n'
      + '"I am going to be very clear, because I do not think you are being unreasonable and I '
      + 'would like you to have the choice. One more of those and I will have you shown out. It '
      + 'is not a punishment and there is no note. It only means today is over."\n\n'
      + '"Sit down and ask me something else."',
    options: [
      opt('(sit down)', 'maresh_backdown'),
      opt('Find out, and then tell me.', 'maresh_ejected',
        [flag('asc_asked_to_leave', '1')]),
    ],
  };

  t.maresh_backdown = {
    _vine: { x: 2460, y: 2120 }, actions: [],
    text:
      'He sits, and the whole thing goes out of the room as though it had never been in it.\n\n'
      + '"Good. That is the sensible one and almost nobody takes it."\n\n'
      + 'He turns the folder back around.\n\n'
      + '"The terms, then. All of it, in order, before you sign."',
    options: [opt('(listen)', 'bye')],
  };

  // ⚠ Same: asc-the-grey.mjs owns the fuller version.
  t.maresh_ejected ||= {
    _vine: { x: 2460, y: 2280 }, actions: [end],
    text:
      '"No."\n\n'
      + 'He nods to somebody you have not looked at, and a woman in Spire grey opens the door and '
      + 'holds it, and she is smiling too.\n\n'
      + '"Come back on Monday if you would like to. Nothing is closed and nothing is written '
      + 'down."\n\n'
      + 'She walks you as far as the Gate. You stand on the plate on the way out, the same as you '
      + 'did coming in, and somewhere a line is added to a file with the time on it. She says '
      + 'goodnight, and means it.',
    options: [],
  };
  log.push('Maresh   stands, says exactly what happens next, and offers the chair back');
});

console.log(log.map(l => '  ' + l).join('\n'));
console.log('\n' + (WRITE ? 'WROTE' : 'dry run'));
