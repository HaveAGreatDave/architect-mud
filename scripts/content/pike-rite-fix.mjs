/**
 * Pike's rite briefing, rewritten. Two faults, one of them a real contradiction.
 *
 * 1. THE SITTING PARADOX. `rite_offer` opened "Everyone thinks the rite is the
 *    sitting. It is not. Anybody can sit... The rite is that you have been sat
 *    here long enough to know exactly where to put your hands." It ties itself
 *    in a knot, and it is arguing against a rite that DOES NOT EXIST — the
 *    180-second standing-a-watch design in systems-ascension.md §8d, which was
 *    written up in the present tense and never built (corrected 2026-08-25).
 *
 *    ⚠ The fix is NOT to take sitting out of Pike. Sitting is his whole motif
 *    and it is good everywhere else: the column of names scratched into the
 *    brick, "somebody sitting there is the ordinary state of things, and you do
 *    not thank the ordinary state of things", and "Anything?" — the only
 *    question the Watch has ever asked anybody. The failure is local. This one
 *    node was making a SPEECH about sitting instead of saying what the job is.
 *
 * 2. HE STILL TOLD YOU TO KILL IVES. "She is the reason two of the names on that
 *    wall are on that wall. On your way out." The quest objective became a
 *    `talk` earlier the same day and this line was never updated, so the giver
 *    was briefing an assassination the quest no longer contains. His reason for
 *    the restraint is the Watch's actual position rather than a moral: they are
 *    not for removing people, they are for still being here.
 *
 * Also gone: "Pike gets off the stool. He does not explain getting off the
 * stool." Repeating a phrase to make it weigh something is a tic, and getting
 * off a stool will not carry it. The mug going down and not coming back up is a
 * smaller gesture and an actual one.
 *
 *   node scripts/content/pike-rite-fix.mjs [--check]
 */
import fs from 'fs';
import path from 'path';
import { canonicalJson } from './lib.mjs';

const FILE = path.join(process.cwd(), 'content', 'npcs', 'npc_lw_pike.json');
const CHECK = process.argv.includes('--check');
const DASH = /[—–]/;

const RITE_OFFER =
  "Pike puts the mug down, which you have not seen him do.\n\n" +
  "\"There is one job this place does that is not watching. It comes round about once every four years. I have been on this door for eleven.\"\n\n" +
  "He tells you the rest of it flatly, the way you would read out a list.\n\n" +
  "\"The vats. Not the Spire, not the man at the top, not the money. The vats, because that is where they keep the thing they are actually selling, and every single person who has ever said yes to them said yes to that room. Bring the colonnade down.\"\n\n" +
  "\"The woman at the gate will be at the gate. Ives. She has spent six years putting a price on our people and she is very good at it, and she is the reason two of the names on that wall are on that wall.\"\n\n" +
  "He is careful with the next part.\n\n" +
  "\"You walk past her. She will have something to say and you will want to answer it, and neither of those matters. What matters is that you do not stop. Taking people out of the world is not what we are for. Still being here is what we are for.\"\n\n" +
  "He looks at you properly for the first time in all of this.\n\n" +
  "\"Then come home. That is not decoration. Three of us have done this and one came back.\"";

// Same tic, smaller: "Pike nods at the stool as you pass, which he does now,
// and did not before." The changed gesture is the right idea — status shown by
// behaviour rather than stated — but the clause explaining it undoes the work.
const KEPT = 'Pike nods at the stool as you pass. He did not use to.';

const problems = [];
const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const tree = data.dialogue_tree || {};

if (!tree.rite_offer) problems.push('no rite_offer node');
if (DASH.test(RITE_OFFER)) problems.push('em dash in Long Watch prose');
// The motif must survive elsewhere. If these have gone, something is wrong.
const others = JSON.stringify([tree.door, tree.sit_offer, tree.rite_report]);
if (!/ordinary state of things/.test(others)) problems.push('sit_offer motif is missing — do not strip sitting from Pike');
if (!/Anything\?/.test(others)) problems.push('rite_report "Anything?" is missing');

const already = tree.rite_offer && tree.rite_offer.text === RITE_OFFER;
if (tree.rite_offer) tree.rite_offer.text = RITE_OFFER;
if (tree.kept) tree.kept.text = KEPT;
data.dialogue_tree = tree;

for (const p of problems) console.error('  ! ' + p);
if (!problems.length && !CHECK) fs.writeFileSync(FILE, canonicalJson(data), 'utf8');
console.log(`${CHECK ? '[check] ' : ''}Pike: rite_offer ${already ? 'already current' : 'rewritten'}.`);
if (problems.length) { console.error(`${problems.length} problem(s).`); process.exit(1); }
