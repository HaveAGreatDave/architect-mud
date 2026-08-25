/**
 * Four new sleep dreams, in the one register the existing sixty-three do not
 * have.
 *
 * The pool is good and this is not a rescue. Every template in it is a strange
 * ROOM with strange THINGS in it, which is one excellent idea done sixty-three
 * ways. What is absent is scale — and scale is most of what Confessions of an
 * English Opium-Eater is actually about. His four facts about the altered mind
 * are mechanics rather than adjectives, and none of them is the word "strange":
 *
 *   1. Whatever he pictured on the darkness while awake arrived in his sleep,
 *      so he became afraid to imagine anything.
 *   2. Buildings and landscapes came "in proportions so vast as the bodily eye
 *      is not fitted to receive".
 *   3. He lived "70 or 100 years in one night", and the expansion of time
 *      disturbed him far more than the expansion of space.
 *   4. Forgotten things returned so complete that he could not be said to
 *      remember them — he RECOGNISED them — from which he concludes "there is
 *      no such thing as forgetting possible to the mind".
 *
 * Fact 4 is already built and is the best thing in this system: dream_tethers
 * hands the sleeper their own dead, their own rooms, their own carried items.
 * Nothing here duplicates it. These four take facts 1, 2 and 3, plus the
 * Piranesi staircase Coleridge described to him — flights of stairs ending at
 * an abyss, with another flight above, and Piranesi on that one too, all the
 * way up into the gloom.
 *
 * House style held to: plain definite-article names, three `looks` per object,
 * the wrongness stated flatly and never explained. ⚠ `cause: 'dream'` requires
 * `drug_id: null` — plugins/bodily/regress.js asserts no sleep dream carries one.
 *
 *   node scripts/content/dreams-de-quincey.mjs [--check]
 */
import fs from 'fs';
import path from 'path';
import { canonicalJson } from './lib.mjs';

const DIR = path.join(process.cwd(), 'content', 'dream_templates');
const CHECK = process.argv.includes('--check');

const DREAMS = [

  // ═══ THE PIRANESI STAIRCASE ══════════════════════════════════════════════
  {
    id: 'dream_the_stairs',
    name: 'The Stairs',
    cause: 'dream',
    drug_id: null,
    fx: 'fog',
    fx_intensity: 0.5,
    description:
      'A flight of stairs up the inside of a hall too big to have a far side, and at the top of it the stairs stop, with no rail and nothing after them. ' +
      'Above that there is another flight, and somebody is already climbing it. Above that there is another. ' +
      'You have been going up for a while. You are also, quite clearly, on all of the others.',
    weather: 'Still, and warmer the higher it goes, which is the wrong way round for a building this size.',
    ambient: [
      'The flight above yours reaches its edge, and whoever is on it starts up the next one.',
      'Somewhere far below, a step you took a long time ago is taken again.',
      'The gloom at the top resolves into more of it.',
    ],
    objects: [
      {
        name: 'the stairs',
        looks: [
          'They go up. At the top they simply stop being stairs, and there is a great deal of hall underneath.',
          'Worn in the middle, the way stairs go when a lot of people have used them, or one person has used them a lot.',
          'You count them on the way up and get a different number each time, and both numbers are right.',
        ],
      },
      {
        name: 'the climber above',
        looks: [
          'Working steadily, some way up, not hurrying and not looking down.',
          'Dressed as you are dressed. Carrying what you are carrying.',
          'They reach the edge of their flight, and do not fall, and start the next one.',
        ],
      },
    ],
  },

  // ═══ TIME ════════════════════════════════════════════════════════════════
  // "I sometimes seemed to have lived for 70 or 100 years in one night."
  {
    id: 'dream_the_hundred_years',
    name: 'The Hundred Years',
    cause: 'dream',
    drug_id: null,
    fx: 'none',   // ⚠ NOT '' — plugins/bodily/regress.js pins fx to rain|snow|ash|fog|wind|none, and weather-fx.js renders nothing for an unknown name, so a bad value is silent rather than loud.
    fx_intensity: 0,
    description:
      'You have been here a very long time. Not waiting: living. There was a period early on that you think of as the good years, and a stretch after it you would rather not go into, and lately things have been steadier. ' +
      'None of it has happened to anybody. The room has not changed and neither have you, and the whole of it fits comfortably inside the gap between two breaths.',
    weather: 'A long afternoon that has been going on for most of your life and shows no sign of getting to evening.',
    ambient: [
      'Another decade goes by. Nothing in the room moves.',
      'You remember something from early on, and it is genuinely a long time ago now.',
      'You catch yourself thinking of a person you have known here for forty years and have never met.',
    ],
    objects: [
      {
        name: 'the years',
        looks: [
          'There have been a great many and you can account for all of them.',
          'They are stacked behind you the way years are, thickest at the far end.',
          'You try to work out when you arrived, and the arithmetic keeps coming out at longer.',
        ],
      },
      {
        name: 'the room',
        looks: [
          'Unchanged. You have looked at it for a century and could not describe it.',
          'It has not aged, and neither has anything in it, and neither have you.',
          'It is smaller than the time you have spent in it, which does not seem to be a problem for either of them.',
        ],
      },
    ],
  },

  // ═══ SPACE ═══════════════════════════════════════════════════════════════
  // "proportions so vast as the bodily eye is not fitted to receive"
  {
    id: 'dream_the_far_wall',
    name: 'The Far Wall',
    cause: 'dream',
    drug_id: null,
    fx: 'fog',
    fx_intensity: 0.35,
    description:
      'An interior. You can tell it is an interior because there is a floor and a ceiling and, a long way off, a wall. ' +
      'The wall is too far away to be a wall. Your eye keeps trying to put a size on it and arriving at nothing, then trying again, and something behind your eye has started to ache from the attempt. ' +
      'The whole thing is ordinary in every respect except one, and the one is not negotiable.',
    weather: 'The still, dustless air of somewhere sealed, at a scale where weather would have to be indoors.',
    ambient: [
      'You get a fix on the far wall. It resolves, and is further.',
      'Something crosses the floor at a great distance and takes a long time to finish doing it.',
      'The ceiling is up there. Your eye declines to say by how much.',
    ],
    objects: [
      {
        name: 'the far wall',
        looks: [
          'A wall. At a distance that is not available to walls.',
          'You look for a door in it, on the reasoning that a door would give you the scale, and there is a door, and it does not help.',
          'It has details on it. You can see them. That is the part that is wrong.',
        ],
      },
      {
        name: 'the floor',
        looks: [
          'Flat, level, and swept, and it goes on doing that for longer than a floor should have to.',
          'Boards. You count nine hundred and stop counting, and you have not gone anywhere.',
          'It is entirely ordinary. Everything here is entirely ordinary at the wrong size.',
        ],
      },
    ],
  },

  // ═══ WHAT YOU PICTURED WHILE AWAKE ═══════════════════════════════════════
  // Fact 1, which is the one that frightened him most: he had to stop imagining
  // things, because whatever he traced on the darkness turned up here, "drawn
  // out by the fierce chemistry of my dreams into insufferable splendour".
  {
    id: 'dream_the_thing_you_pictured',
    name: 'The Thing You Pictured',
    cause: 'dream',
    drug_id: null,
    fx: 'ash',
    fx_intensity: 0.3,
    description:
      'It is the thing you were thinking about before you went under. Not a version of it. It, worked up: finished, lit, and much larger, with all the parts you never got round to imagining supplied by somebody thorough. ' +
      'You did not ask for any of this. You only pictured it for a second, on the way down, the way anybody does.',
    weather: 'Bright, from no particular direction, in the way of a thing being displayed rather than lit.',
    ambient: [
      'A detail you definitely did not invent turns out to have been there the whole time.',
      'It gets slightly more finished while you are not looking at it.',
      'You try to think about something else, and there is a pause, and then that arrives too.',
    ],
    objects: [
      {
        name: 'the thing',
        looks: [
          'Exactly what you had in mind, and a great deal more of it than you had in mind.',
          'Beautifully made. Nobody made it. You had it for about a second in a dark room.',
          'It is waiting to see whether you are going to picture anything else.',
        ],
      },
      {
        name: 'the rest of it',
        looks: [
          'The parts you never bothered with. Somebody has bothered.',
          'Filled in, all the way to the edges, in a hand that is not yours.',
          'You look for a mistake in it, on the grounds that you would have made one, and there is not one.',
        ],
      },
    ],
  },
];

// ─── apply ───────────────────────────────────────────────────────────────────
// Match the field set the existing templates use exactly, so an export/import
// round trip is a no-op.
const KEYS = ['ambient', 'cause', 'description', 'drug_id', 'fx', 'fx_intensity', 'id', 'name', 'objects', 'weather'];

// ⚠ The only values weather-fx.js renders, pinned by plugins/bodily/regress.js.
// `''` is NOT one of them: an unknown name renders nothing, which is exactly
// what "no effect" looks like, so the mistake is invisible in play and only the
// suite catches it. `dream_the_hundred_years` shipped with `fx: ''` and turned
// the suite red one run later.
const VALID_FX = ['rain', 'snow', 'ash', 'fog', 'wind', 'none'];

let written = 0;
const problems = [];

// The shape to conform to, taken from a file that already ships.
const reference = JSON.parse(fs.readFileSync(path.join(DIR, 'dream_the_queue.json'), 'utf8'));
const refKeys = Object.keys(reference).sort().join(',');
if (refKeys !== [...KEYS].sort().join(',')) {
  problems.push(`reference template field set has moved: ${refKeys}`);
}

for (const d of DREAMS) {
  const file = path.join(DIR, `${d.id}.json`);
  if (fs.existsSync(file)) { problems.push(`${d.id}: already exists, refusing to overwrite`); continue; }
  const keys = Object.keys(d).sort().join(',');
  if (keys !== [...KEYS].sort().join(',')) { problems.push(`${d.id}: field set ${keys}`); continue; }
  // regress asserts no sleep dream carries a drug_id.
  if (d.cause === 'dream' && d.drug_id !== null) { problems.push(`${d.id}: sleep dream with a drug_id`); continue; }
  if (!VALID_FX.includes(d.fx)) { problems.push(`${d.id}: fx "${d.fx}" is not one of ${VALID_FX.join('|')}`); continue; }
  if (!Array.isArray(d.ambient) || d.ambient.length < 3) problems.push(`${d.id}: wants at least 3 ambient lines`);
  for (const o of d.objects || []) {
    if (!Array.isArray(o.looks) || o.looks.length < 3) problems.push(`${d.id}/${o.name}: wants at least 3 looks`);
  }
  if (!CHECK) fs.writeFileSync(file, canonicalJson(d), 'utf8');
  written++;
}

for (const p of problems) console.error('  ! ' + p);
console.log(`${CHECK ? '[check] ' : ''}Dreams: ${written} new sleep template(s).`);
if (problems.length) { console.error(`${problems.length} problem(s).`); process.exit(1); }
