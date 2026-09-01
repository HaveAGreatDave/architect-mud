/**
 * Cut the explaining-asides from the order prose, per the "Trust the reader to
 * supply it" rule added to docs/reference/plain-writing.md on 2026-08-25.
 *
 * The tic: a clause after an image telling the reader what the image meant.
 * Forster never writes "Orion"; Swift never says he is joking. Every edit here
 * deletes a clause and adds nothing.
 *
 * ⚠ Contrast frames that do work are NOT touched. "That is not nostalgia. That
 * is engineering." rejects an objection the listener was about to raise. Cutting
 * the first half leaves a line arguing with nobody. Only asides that restate the
 * sentence before them are removed.
 *
 * Exact-match replacement: every `from` must appear once in the file or the run
 * fails, so a silent miss cannot happen.
 *
 *   node scripts/content/trim-order-prose-asides.mjs [--check]
 */
import fs from 'fs';
import path from 'path';
import { canonicalJson } from './lib.mjs';

const CHECK = process.argv.includes('--check');

const EDITS = [
  // ── quests ────────────────────────────────────────────────────────────────
  ['quests', 'quest_lw_1',
    '{who} walks back the way an errand walks back, which is the entire skill.',
    '{who} walks back the way an errand walks back.'],
  ['quests', 'quest_lw_fav_eye',
    '{who} stands in a doorway doing nothing at all, which takes practice.',
    '{who} stands in a doorway doing nothing at all.'],
  ['quests', 'quest_asc_1',
    '{who} walks it out through a door that opens for them, which is somehow the worst part.',
    '{who} walks it out through a door that opens for them before they reach it.'],
  ['quests', 'quest_asc_2',
    'It commits you to nothing, he says, and he is telling the truth, which is what makes it work.',
    'It commits you to nothing, he says, and he is telling the truth.'],
  ['quests', 'quest_asc_fav_adjuster',
    'she is quite firm about that, and she is firm about it early, which is how you know it is the part that matters',
    'she is quite firm about that, and she is firm about it early'],
  ['quests', 'quest_asc_fav_adjuster',
    '{who} finds a doorway with a good angle on the corridor and becomes furniture.',
    '{who} finds a doorway with a good angle on the corridor and stops being a person in a corridor.'],
  ['quests', 'quest_asc_3',
    '{who} notices the vitrines get warmer in colour as they go, and that this is not an accident.',
    '{who} notices the vitrines get warmer in colour the further in they go.'],
  ['quests', 'quest_lw_loyalty',
    '{who} is told there is no obligation, in a voice with no obligation in it at all.',
    '{who} is told there is no obligation, twice, by two different people.'],

  // ── dialogue ──────────────────────────────────────────────────────────────
  ['npcs', 'npc_lw_halloran',
    'He puts it in his pocket rather than on the bench, which is not where things go.',
    'He puts it in his pocket rather than on the bench.'],
  ['npcs', 'npc_lw_quartermaster',
    'Then she looks at the line for a second longer than the line needs.',
    'Then she looks at the line for a second longer.'],
  ['npcs', 'npc_asc_first',
    '"Ours," it says, which is the whole greeting and is not a small one.',
    '"Ours," it says, and says nothing else.'],
  ['npcs', 'npc_asc_ives',
    'She is almost apologetic, which on her is a whole performance.',
    'She is almost apologetic.'],
  ['npcs', 'npc_lw_pike',
    'He nods once and moves along the bench to make room, and that is the whole of it, and it is a great deal more than it looks.',
    'He nods once and moves along the bench to make room.'],
  ['npcs', 'npc_lw_teague',
    'She unslings the carbine and leans it against the wall, muzzle down, which is not a small thing.',
    'She unslings the carbine and leans it against the wall, muzzle down.'],
];

const byFile = new Map();
for (const [dir, id, from, to] of EDITS) {
  const key = `content/${dir}/${id}.json`;
  if (!byFile.has(key)) byFile.set(key, []);
  byFile.get(key).push([from, to]);
}

let files = 0, edits = 0;
const problems = [];

for (const [file, list] of byFile) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  let json = JSON.stringify(data);
  for (const [from, to] of list) {
    const needle = JSON.stringify(from).slice(1, -1);
    const repl = JSON.stringify(to).slice(1, -1);
    const n = json.split(needle).length - 1;
    if (n !== 1) { problems.push(`${path.basename(file)}: expected 1 match, found ${n} for "${from.slice(0, 55)}..."`); continue; }
    json = json.replace(needle, repl);
    edits++;
  }
  if (!CHECK) fs.writeFileSync(file, canonicalJson(JSON.parse(json)), 'utf8');
  files++;
}

for (const p of problems) console.error('  ! ' + p);
console.log(`${CHECK ? '[check] ' : ''}Trimmed ${edits} aside(s) across ${files} file(s).`);
if (problems.length) process.exit(1);
