/**
 * Long Watch dialogue review, 2026-08-25. Batch 1 of the faction pass.
 *
 * ── What was counted first ───────────────────────────────────────────────────
 *
 * A tic sweep over 7 Long Watch NPCs and 12 quests flagged 32 instances of five
 * constructions that all do the same job: they CLOSE an exchange with a tidy
 * summary that the speaker delivers and nobody contests.
 *
 *   antithesis  9   "That is not X. It is Y."
 *   closer      8   "That is the whole of it", "which is how you know"
 *   simile     14   "the way a priest tends an altar"
 *   triple      1   "Not hurt past mending. Not robbed. Not spoken to."
 *
 * The reason that reads as written rather than spoken: conversation is a JOINT
 * action in which neither party controls the shape, and their goals differ. All
 * five of these are one author writing both halves and then stopping the scene
 * on a verdict. Real exchanges get deflected, argued with, or trail off.
 *
 * ── What is NOT changed, and why ─────────────────────────────────────────────
 *
 * Most of the antitheses stay. plain-writing.md defends the move where a
 * character is heading off an objection the listener was about to make, and it
 * is doing real work in seven of the nine: "That is not a cult out there. That
 * is a debt collector with a chapel" is an argument with an image in it, and
 * Pike's "That is not decoration" is backed immediately by a number.
 *
 * The problem those seven have is not individual, it is DENSITY: five different
 * Watch characters reaching for one construction is the house accent, not five
 * people. Thinning it is a judgement call per line rather than a sweep, so this
 * script only takes the ones that are indefensible on their own terms.
 *
 * ── What is changed here ─────────────────────────────────────────────────────
 *
 * 1. Four narration-grading closers. "She listens without moving, which is how
 *    you know it has landed hard" tells the reader how to read the sentence
 *    before it, which is the exact pattern the spec cuts. The gesture already
 *    said it.
 * 2. One authorless antithesis in a quest brief, where there is no character to
 *    own the correction and it is simply the writer being clever at the player.
 * 3. Five similes of the form "the way a MAN does X". Fourteen across one
 *    faction, and four of them are specifically a MAN doing something, which
 *    also quietly genders the comparison for no reason. The kept ones earn it.
 *
 * Run: node scripts/content/lw-dialogue-review.mjs [--write]
 * Re-running is a no-op; every edit is an exact match.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const WRITE = process.argv.includes('--write');
const esc = s => JSON.stringify(s).slice(1, -1);

const EDITS = [
  // --- narration grading itself -------------------------------------------
  { file: 'npcs/npc_lw_cyrelle.json', label: 'Cyrelle: cut the grading clause',
    from: 'She listens to all of it without moving, which is how you know it has landed hard',
    to:   'She listens to all of it without moving' },

  { file: 'npcs/npc_lw_halloran.json', label: 'Halloran: cut the grading clause',
    from: 'He wipes his hands on the cloth and offers you one, which is the first honest gesture he has made you',
    to:   'He wipes his hands on the cloth and offers you one' },

  { file: 'quests/quest_lw_fav_quiet.json', label: 'Quiet Hands: emote stops grading itself',
    from: '{who} does it fast, which is the kindest available way of doing it',
    to:   '{who} does it fast' },

  // The Quartermaster has just listed three things the gear does without. The
  // list IS the idea; announcing that it is the idea adds nothing.
  { file: 'npcs/npc_lw_quartermaster.json', label: 'Quartermaster: drop the summary beat',
    from: 'without a wire running back to the machine. That is the whole idea.',
    to:   'without a wire running back to the machine.' },

  // --- an antithesis with nobody to own it ---------------------------------
  { file: 'quests/quest_lw_fav_bench.json', label: 'Bench Time: brief stops arguing with the player',
    from: 'There is no trick to it and nobody is watching to see if you fail.\\n\\nThat is not the same as nobody noticing whether you came.',
    to:   'There is no trick to it and nobody is watching to see if you fail.\\n\\nHalloran will notice that you came.' },

  // --- thinning "the way a MAN does X" -------------------------------------
  { file: 'npcs/npc_lw_halloran.json', label: 'Halloran: quietly gendered simile out of his description',
    from: 'He watches you the way a man watches a stranger\'s hands, not their face.',
    to:   'He watches your hands rather than your face.' },

  { file: 'npcs/npc_lw_halloran.json', label: 'Halloran: "the way a man says a thing that mattered"',
    from: 'He says it quietly, the way a man says a thing that mattered.',
    to:   'He says it quietly, and once.' },

  { file: 'npcs/npc_lw_pike.json', label: 'Pike: "the way you would read out a list"',
    from: 'He tells you the rest of it flatly, the way you would read out a list.',
    to:   'He tells you the rest of it flatly, in order.' },

  { file: 'npcs/npc_lw_pike.json', label: 'Pike: "the way you would mention weather"',
    from: 'He says it the way you would mention weather.',
    to:   'He says it like it is Tuesday.' },

  { file: 'quests/quest_lw_1.json', label: 'Proof of Hands: emote stops explaining itself',
    from: '{who} walks back the way an errand walks back.',
    to:   '{who} walks back without hurrying and without stopping.' },
];

let n = 0;
for (const e of EDITS) {
  const p = path.join(ROOT, e.file);
  const src = fs.readFileSync(p, 'utf8');
  const needle = e.from.includes('\\n') ? e.from : esc(e.from);
  const repl = e.to.includes('\\n') ? e.to : esc(e.to);
  if (!src.includes(needle)) { console.log('  MISS   ' + e.label); continue; }
  n++;
  if (WRITE) fs.writeFileSync(p, src.split(needle).join(repl), 'utf8');
  console.log('  ok     ' + e.label);
}
console.log('\n' + (WRITE ? 'WROTE' : 'dry run') + ' - ' + n + '/' + EDITS.length + ' edits matched');
