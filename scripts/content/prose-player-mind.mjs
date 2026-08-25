/**
 * Stop the narration deciding things for the player.
 *
 * The rule added to plain-writing.md from Palahniuk's thought-verb essay, in
 * the form it takes for us: never tell the player what they know, want, think
 * or decide. In a novel that is a style preference. Here the person it
 * describes is sitting at the keyboard and can disagree with it.
 *
 * `scripts/docs/prose-audit.mjs` found three across 19,494 entries, which is
 * the whole point of measuring before writing a rule down.
 *
 * ⚠ TWO KINDS OF HIT ARE DELIBERATE AND STAY:
 *
 *   - `zone_the_lattice`: "You have never seen a holosign. You know, without
 *     being told, exactly how to read it. That should frighten you more than it
 *     does." That is the vat-born player's actual condition and the line is
 *     about the wrongness of knowing it.
 *   - EVERY DREAM. Nine of the twelve hits were dream_templates — "You remember
 *     every one being applied", "You understand it perfectly and will not be
 *     permitted to keep it". A dream is the one surface where the narration has
 *     authority over the player's mind, because it IS the player's mind, and
 *     unearned knowledge is the mechanic rather than a mistake. The audit now
 *     excludes that surface.
 *
 * Also left: `zone_citadel_hall`, "A hall built to make you feel small and
 * largely succeeding." It is a claim about what the architecture was FOR, and
 * "largely" declines to finish the claim about you. Judged, not missed.
 *
 *   node scripts/content/prose-player-mind.mjs [--check]
 */
import fs from 'fs';
import path from 'path';
import { canonicalJson } from './lib.mjs';

const CHECK = process.argv.includes('--check');
const ZONES = path.join(process.cwd(), 'content', 'zones');

const EDITS = [
  // On the Thornwarren trophy road, across 5 tiles. The joke was that you know
  // what it is painted with and would rather not say; making the narrator
  // decline for you is weaker than simply not naming it.
  ['Somebody has painted the rock. You decide not to work out what with.',
   'Somebody has painted the rock. Not with paint.'],

  // The joke is that the price is unspeakable. Moving it off the player and
  // onto the clientele keeps the joke and characterises the shop.
  ['A price tag flips over on its thread. You decide not to look.',
   'A price tag flips over on its thread. Nobody in here looks at those.'],

  // "You get the sense" is a filter and a mind-read in four words. The sentence
  // is stronger asserting it outright, which is what it wanted to do anyway.
  ['You get the sense it has been waiting a very long time to be filled, and has made its peace with not being.',
   'It has been waiting a very long time to be filled, and has made its peace with not being.'],
];

let applied = 0, already = 0, files = 0;
const problems = [];
const touched = new Set();

for (const [from, to] of EDITS) {
  const needle = JSON.stringify(from).slice(1, -1);
  const repl = JSON.stringify(to).slice(1, -1);
  let found = 0, seen = 0;

  for (const f of fs.readdirSync(ZONES)) {
    const file = path.join(ZONES, f);
    const raw = fs.readFileSync(file, 'utf8');
    if (raw.includes(repl)) { seen++; continue; }
    if (!raw.includes(needle)) continue;
    found++;
    if (!CHECK) fs.writeFileSync(file, canonicalJson(JSON.parse(raw.split(needle).join(repl))), 'utf8');
    touched.add(file);
  }

  if (found) { applied++; }
  else if (seen) { already++; }
  else problems.push(`no match: "${from.slice(0, 60)}…"`);
}
files = touched.size;

for (const p of problems) console.error('  ! ' + p);
console.log(`${CHECK ? '[check] ' : ''}Player-mind: ${applied} edit(s) applied across ${files} file(s), ${already} already done, of ${EDITS.length}.`);
if (problems.length) { console.error(`${problems.length} problem(s).`); process.exit(1); }
