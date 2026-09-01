/**
 * If you do not leave. 2026-08-25.
 *
 * ── The rung this adds ───────────────────────────────────────────────────────
 *
 * Being asked to leave was the end of the ladder, and a player could simply not
 * go. Now there is one more step: stay where you are and the Spire grey put
 * hands on you.
 *
 * That is the only physical thing that happens anywhere in this faction, and it
 * is deliberately the LAST rung, four pushes past a warning that named the
 * consequence out loud. Nobody is surprised by it.
 *
 * ── Why chrome does the throwing ─────────────────────────────────────────────
 *
 * It is the doctrine made literal, and nobody in the scene remarks on it. The
 * order believes the climb is real and that people further up it are better.
 * The men who carry you out are further up it. Their advantage was bought, fitted
 * and warrantied, and it is the reason you cannot argue with them physically any
 * more than you could argue with the actuarial tables.
 *
 * The chrome is described, not implied: bare plate at the shoulder, cabling laid
 * in behind the elbow, scuffing along the forearms the way a much-used tool
 * scuffs, hands built a size larger than the ones they were born with, and a
 * servo you can hear when the fingers close. A player who has spent an hour
 * being told chrome is an improvement finds out what that sentence meant.
 *
 * ── Bouncers, not escorts ────────────────────────────────────────────────────
 *
 * TWO of them, and they work as a pair without agreeing on anything first,
 * because they do this weekly. The register is a doorman moving somebody out of a
 * club: efficient, practised, and entirely indifferent to your dignity.
 *
 *   Neither of them speaks to you at any point.
 *   They talk to each other over your head about a late delivery.
 *   Your shoulder takes a door frame and neither of them notices or adjusts.
 *   They let go simultaneously so you have to catch your own balance.
 *   The plating is WARM, which is the detail the player keeps.
 *
 * ── What it must not become ──────────────────────────────────────────────────
 *
 * ⚠ Not a fight. No combat, no wanted star, no damage, no rep cliff, no lockout.
 * They are moving an object out of a room, not punishing an enemy. The moment it
 * becomes a brawl the player has an enemy they can beat, and the faction stops
 * being unbearable and starts being a boss.
 *
 * ⚠ Undignified is not injured. Nothing here does damage. `asc_carried_out` is
 * set for later content and nothing else changes.
 *
 * Run: node scripts/content/asc-the-grey.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const WRITE = process.argv.includes('--write');
const log = [];
const opt = (label, next, actions = []) => ({ label, next, conditions: [], actions, enabled: true });
const end = { action: 'END_CONVERSATION' };
const flag = (f, v) => ({ action: 'SET_FLAG', flag: f, scope: 'player', value: v });

const edit = (rel, fn) => {
  const p = path.join(ROOT, rel);
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  fn(d, d.dialogue_tree);
  if (WRITE) fs.writeFileSync(p, canonicalJson(d), 'utf8');
};

// ── Ives ────────────────────────────────────────────────────────────────────
edit('npcs/npc_asc_ives.json', (d, t) => {
  // The polite escort now offers a choice rather than ending the scene outright.
  t.ives_ejected = {
    _vine: { x: 2980, y: 2760 }, actions: [],
    text:
      '"Yes."\n\n'
      + 'She does not stand up and she does not call anybody. She simply looks past your shoulder '
      + 'and a man in Spire grey is already there, because he was always already there.\n\n'
      + 'His sleeves are turned back and both forearms are chrome to the elbow, matched to his '
      + 'skin and not remotely disguised.\n\n'
      + '"Thank you for coming in. Sign out at the plate."',
    options: [
      opt('(go)', 'ives_walked_out'),
      opt('(stay where you are)', 'ives_carried_out',
        [flag('asc_asked_to_leave', '1'), flag('asc_carried_out', '1')]),
    ],
  };

  t.ives_walked_out = {
    _vine: { x: 3240, y: 2680 }, actions: [end],
    text:
      'He walks you to the road. He is pleasant the whole way and does not touch you once, and at '
      + 'the bottom he says the road is a bit slick tonight and to mind how you go.',
    options: [],
  };

  t.ives_carried_out = {
    _vine: { x: 3240, y: 2840 }, actions: [end],
    text:
      'There are two of them. The second one comes through the side door without being called, '
      + 'which means somebody upstairs has been watching this conversation.\n\n'
      + 'Chrome arms on both, shoulder to fingertip, the plating dulled and scuffed along the '
      + 'forearms the way a much-used tool gets scuffed. One of them has a hand you can hear — a '
      + 'small servo whine as the fingers close.\n\n'
      + 'They give you about four seconds. Then one takes your upper arm and the other takes a '
      + 'fistful of the back of your coat, and your feet stop being load-bearing.\n\n'
      + 'Neither of them says a word to you. They talk over your head about a delivery that is '
      + 'late. At the first door they turn you sideways without slowing down and your shoulder '
      + 'goes into the frame, and neither of them notices, and neither of them adjusts.\n\n'
      + 'Ives has gone back to the ledger before you are through it.\n\n'
      + 'On the road they set you on your feet and let go at the same moment, so you have to '
      + 'catch your own balance. One of them flexes his hand twice, the way you would after '
      + 'carrying shopping.\n\n'
      + '"Mind the step. It is slick tonight."',
    options: [],
  };
  log.push('Ives     two chromed men, wordless, and your shoulder takes the door frame');
});

// ── Maresh ──────────────────────────────────────────────────────────────────
edit('npcs/npc_asc_recruiter.json', (d, t) => {
  t.maresh_ejected = {
    _vine: { x: 2460, y: 2280 }, actions: [],
    text:
      '"No."\n\n'
      + 'He nods at the door. Two men in Spire grey come in and stand either side of it without '
      + 'looking at you. Both are chromed from the collarbone down and neither has bothered to '
      + 'have it skinned — bare plate at the shoulder, cabling laid in behind the elbow, hands '
      + 'built a size larger than the ones they were born with.\n\n'
      + '"Come back on Monday if you would like to. Nothing is closed and nothing is written '
      + 'down."',
    options: [
      opt('(go)', 'maresh_walked_out'),
      opt('(do not move)', 'maresh_carried_out',
        [flag('asc_asked_to_leave', '1'), flag('asc_carried_out', '1')]),
    ],
  };

  t.maresh_walked_out = {
    _vine: { x: 2720, y: 2200 }, actions: [end],
    text:
      'One of them walks you as far as the Gate, a pace behind and slightly to the left, and does '
      + 'not touch you at any point.\n\n'
      + 'You stand on the plate on the way out, the same as you did coming in, and somewhere a '
      + 'line is added to a file with the time on it.\n\n'
      + 'He says goodnight. He is not being sarcastic.',
    options: [],
  };

  t.maresh_carried_out = {
    _vine: { x: 2720, y: 2360 }, actions: [end],
    text:
      'They come off the wall together, and they have done this so many times they do not need '
      + 'to agree on anything first.\n\n'
      + 'One hooks a hand under your arm and lifts, and you go up far enough that your toes drag. '
      + 'The other takes your wrist and folds it in against your own back, not hard, just to a '
      + 'place where you will not do anything with it. The plating on his forearm is warm. That '
      + 'is the thing you will remember afterwards, that it was warm.\n\n'
      + 'Neither of them speaks to you at any point. One of them asks the other whether the '
      + 'Tuesday shipment came, and the other says most of it.\n\n'
      + 'Maresh has sat back down and is reading something.\n\n'
      + 'They take you over the plate at the Gate, and it reads you the same as it would if you '
      + 'were walking, and the time goes in the file. On the far side they let go together and '
      + 'you go down onto one knee on the road, and by the time you are up they have already '
      + 'turned round.',
    options: [],
  };
  log.push('Maresh   the woman in grey talks about Monday\'s list while she carries you');
});

console.log(log.map(l => '  ' + l).join('\n'));
console.log('\n' + (WRITE ? 'WROTE' : 'dry run'));
