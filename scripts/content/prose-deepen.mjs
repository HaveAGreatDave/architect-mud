/**
 * Second prose pass on the two ladders: more natural, more of the world in it.
 *
 * The first pass got the structure and the two registers right. Reading it back
 * whole turned up two things a single-quest-at-a-time edit cannot see.
 *
 * 1. A MANNERISM OF MINE, THREE TIMES. "A claim file wants collecting", "A case
 *    wants moving", "A calibration set wants fitting". Once is a voice; three
 *    times across nineteen briefs is a writer with a favourite construction, and
 *    it reads as arch rather than plain. All three are rewritten differently on
 *    purpose, and no replacement reuses another's shape.
 *
 * 2. ONE QUEST WITH NO WORLD IN IT. `quest_asc_fav_tolerance` was a mechanical
 *    puzzle — a part inside tolerance, a mount outside it, a surgeon watching
 *    your hands. Perfectly good as a test and about nothing at all. It now says
 *    what the unit is FOR: it prices mortality for the eastern districts, reads
 *    a body and returns the figure a person is charged to stay alive. Kesh never
 *    mentions that, because to Kesh it is a mount. Same trick as Wells's Labour
 *    Department — the machinery that decides lives, described by a competent man
 *    in the vocabulary of maintenance.
 *
 * The other additions all push on one theme the setting had lying around and was
 * not using: INFRASTRUCTURE IS OWNERSHIP. The Watch move things by hand because
 * the wires belong to people who can afford wires. That is why slot 4 is a
 * courier job at all, and it makes the Ascendant surveillance quests at slots 6
 * and 9 land on something already established rather than arriving new.
 *
 * ⚠ Watch prose takes no em dashes; Ascendant prose does. Checked per edit.
 *
 *   node scripts/content/prose-deepen.mjs [--check]
 */
import fs from 'fs';
import path from 'path';
import { canonicalJson } from './lib.mjs';

const CHECK = process.argv.includes('--check');
const DASH = /[—–]/;

// [id, side, from, to]
const EDITS = [

  // ── the repeated construction, broken three different ways ────────────────
  ['quest_asc_file', 'asc',
    'A claim file wants collecting from a broker two districts over and bringing to the underwriting floor. It is a walk with a wallet in it.',
    'There is a settled claim file sitting with a broker two districts over, and it needs to be on the underwriting floor before the desk closes. It is a walk with a wallet in it.'],

  ['quest_lw_fav_carry', 'lw',
    'A case wants moving from a lock-up off the Yards to the Blind, and the Quartermaster would rather it went across town in a hand than on any wire in this city.',
    'There is a case in a lock-up off the Yards. The Quartermaster wants it at the Blind by morning, and she wants it carried there in a hand rather than sent on any wire in this city.'],

  ['quest_asc_fav_tolerance', 'asc',
    'A calibration set wants fitting to a unit on the underwriting floor, and Kesh would like you to do it rather than one of his technicians.\n\n' +
    'He gives you the tolerance and the torque and the order of operations, and mentions — once, in passing, on his way to something else — that the part is within tolerance and the mount is not.',
    'There is a calibration set to go into a unit on the underwriting floor, and Kesh would rather you did it than one of his technicians.\n\n' +
    'The unit is one of nine that price mortality for the eastern districts. It reads a body and returns a figure, and the figure is what a person is charged to be kept alive. Kesh explains none of that, because to Kesh it is a mount with a set going into it.\n\n' +
    'He gives you the tolerance, the torque, and the order of operations — and mentions, once, in passing, on his way to something else, that the part is within tolerance and the mount is not.'],

  // ── infrastructure is ownership, established at slot 4 ────────────────────
  ['quest_lw_meet', 'lw',
    'Halloran says a runner is coming in from the east tonight with something he wants in a hand rather than on a wire, and that you are to sit in the Den and take it off her.\n\n' +
    'He does not say what it is. He does not say who she is.',
    'Halloran says a runner is coming in from the east tonight with something he wants in a hand rather than on a wire, and that you are to sit in the Den and take it off her.\n\n' +
    'The Watch move nearly everything this way. It costs a day. The wires belong to people who can afford wires, and in eleven years nobody down here has found a way round that.\n\n' +
    'He does not say what it is. He does not say who she is.'],

  // ── and paid off at slot 9, where the same fact is a selling point ────────
  ['quest_asc_loyalty', 'asc',
    'Vess mentions that the district has had four assaults on that stretch this year and no pictures of any of them. She is not making an argument. She is telling you what the cameras are for, which is what they are for.',
    'Vess mentions that the district has had four assaults on that stretch this year and no pictures of any of them. She is not making an argument, and she does not need to. Halcyon owns the cable, the housings, the software and the afternoon it takes to fix them, and the only people who ever wanted that stretch dark were the ones standing in it.'],

  // ── the vats, said once in the vocabulary of storage ──────────────────────
  ['quest_asc_3', 'asc',
    'The Gallery first, because it is beautiful. Then the Vats, because that is the promise — the room where a body is kept against the day you need another one, warm, indexed, and paid up. Then the Sanctum, which is small, and quiet, and where the actual signing happens.',
    'The Gallery first, because it is beautiful. Then the Vats, because that is the promise — the room where a body is kept against the day you need another one, warm, indexed, and paid up. Vess talks about it the way a good manager talks about a well-run store room, and every word of it is accurate. Then the Sanctum, which is small, and quiet, and where the actual signing happens.'],

  // ── Pike's rite: what the Watch is actually protecting ────────────────────
  ['quest_lw_rite', 'lw',
    'The vats are the promise. Not the Spire, not the man at the top, not the money. The vats. It is the room where they keep the thing they actually sell, and every person who has ever said yes to them said yes to that room.',
    'The vats are the promise. Not the Spire, not the man at the top, not the money. The vats. It is the room where they keep the thing they actually sell, and every person who has ever said yes to them said yes to that room.\n\n' +
    'Pike has never seen it. Nobody in this room has. They have been arguing with a room they know about the way you know about a country.'],
];

// ─── apply ───────────────────────────────────────────────────────────────────
let applied = 0, already = 0;
const problems = [];

for (const [id, side, from, to] of EDITS) {
  if (side === 'lw' && DASH.test(to)) { problems.push(`${id}: em dash in Long Watch prose`); continue; }
  const file = path.join(process.cwd(), 'content', 'quests', `${id}.json`);
  if (!fs.existsSync(file)) { problems.push(`${id}: missing`); continue; }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (typeof data.description !== 'string') { problems.push(`${id}: no description`); continue; }

  // ⚠ TEST `to` FIRST. Several of these edits ADD a paragraph and keep the
  // original text, which makes `from` a substring of `to` — so a `from`-first
  // check matches again on the next run and appends the new paragraph a second
  // time. That is exactly what happened to quest_lw_rite: two identical copies
  // of "Pike has never seen it." Checking for the finished state first makes an
  // already-applied edit a no-op no matter how the two strings overlap.
  if (data.description.includes(to)) {
    already++;
  } else if (data.description.includes(from)) {
    data.description = data.description.replace(from, to);
    if (!CHECK) fs.writeFileSync(file, canonicalJson(data), 'utf8');
    applied++;
  } else {
    problems.push(`${id}: no match for "${from.slice(0, 60)}…"`);
  }
}

for (const p of problems) console.error('  ! ' + p);
console.log(`${CHECK ? '[check] ' : ''}Deepen: ${applied} applied, ${already} already in place, of ${EDITS.length}.`);
if (problems.length) { console.error(`${problems.length} problem(s).`); process.exit(1); }
