/**
 * The plain-writing pass on the highest-reach prose, 2026-08-25.
 *
 * docs/reference/plain-writing.md stopped exempting in-world prose on
 * 2026-08-25. Applying that to 17,259 room descriptions by hand is not a task;
 * counting them first turned it into one. content/zones holds 17,259
 * descriptions and 859 UNIQUE texts, and 214 of those cover 16,614 rooms
 * between them. So the pass went by reach rather than by how interesting the
 * room was to edit:
 *
 *   grey ash   1,900 tiles   48 words -> 30, with a four-word sentence in it
 *   red rock   1,592 tiles   trimmed
 *
 * "There is a great deal of sky" opened BOTH of those, which is 3,492 tiles
 * carrying one construction, so it survives in the red rock only. That kind of
 * repetition is invisible at the file level and obvious at the corpus level; it
 * is the whole reason this was counted before it was written.
 *
 * Three more of the top six were read and deliberately left alone. The cracked
 * hardpan (1,197), the rust plain (914) and the broken mesa (889) are already
 * 15-22 words with a short sentence in them.
 *
 * The rest, by rule:
 *   - The Nave loses "because to him there is no difference", narration telling
 *     the reader what the image it just gave them meant.
 *   - Two soylent pouches stop assigning the player an emotion. Second person
 *     may describe the body and may not report the mind: "a frequency you feel
 *     in your teeth" is the world, "you feel unaccountably happy" is a claim
 *     about somebody who is sitting there feeling something else.
 *   - The birthday pouch stops shipping the word "load-bearing" to players. It
 *     is on the spec's own cut list, in player-facing prose.
 *   - Four NPC lines drop the "That is not X" frame. That move is legitimate
 *     when a character is heading off an objection, and it was being made by
 *     nineteen different NPCs, at which point it stops being a character and
 *     becomes the house accent. The two where somebody really is arguing back
 *     ("That is not a rumour, that is arithmetic", "That is not a slogan. It is
 *     an inventory") are kept on purpose.
 *
 * Raw substring replacement on the file BYTES rather than parse-edit-serialise,
 * so key order and formatting are untouched and the diff is one line per file.
 *
 *   node scripts/content/prose-standard-pass.mjs             dry run
 *   node scripts/content/prose-standard-pass.mjs --write     apply
 *
 * Re-running is a no-op: every edit is an exact match on text that no longer
 * exists once it has been applied.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const WRITE = process.argv.includes('--write');

// How a plain string appears inside a JSON file, minus the surrounding quotes.
const esc = s => JSON.stringify(s).slice(1, -1);

const EDITS = [
  { dir: 'zones', label: 'waste - grey ash',
    from: 'Grey ash to the horizon, level and going nowhere in particular. Nothing grows in it worth the word and nothing has for a long time. There is a great deal of sky, and the quiet out here is not the absence of noise, it is the absence of anything that would make one.',
    to:   'Grey ash to the horizon, level and going nowhere. Nothing grows in it. The quiet is not the absence of noise. It is the absence of anything that would make one.' },

  { dir: 'zones', label: 'waste - red rock',
    from: 'Red rock to the horizon in every direction, pitted all over with pale rings a hair deep where the rain has stood and eaten. The wind never entirely stops. There is a great deal of sky and none of it is reassuring.',
    to:   'Red rock to the horizon, pitted with pale rings a hair deep where the rain has stood and eaten. The wind never stops. There is a great deal of sky and none of it is reassuring.' },

  { dir: 'zones', label: 'The Nave',
    from: 'A celebrant tends the machines the way a priest tends an altar, because to him there is no difference. He is, as far as anyone can tell, the only person in the Basin who loves the Architect.',
    to:   'A celebrant tends the machines the way a priest tends an altar. He loves the Architect. As far as anyone can tell, he is the only one who does.' },

  { dir: 'items', label: 'soylent birthday - use_message',
    from: 'For a few seconds you feel unaccountably happy.',
    to:   'For a few seconds it works.' },

  { dir: 'items', label: 'soylent birthday - description',
    from: 'The exclamation marks are doing a great deal of load-bearing work.',
    to:   'The exclamation marks are working very hard.' },

  { dir: 'items', label: 'soylent marrow - use_message',
    from: "You feel better almost immediately and you would rather you didn't.",
    to:   'Your hands stop shaking before you have finished the pouch.' },

  { dir: 'npcs', label: 'Padgett - Ockley',
    from: 'Ockley will not fit a thread I do not hold. That is not him being obliging, that is the arrangement. He asks me first.',
    to:   "Ockley won't fit a thread I don't hold. He asks me first." },

  { dir: 'npcs', label: 'Exodus elder - the place',
    from: 'That is not me being difficult either. We do not say the place.',
    to:   "I'm not being difficult. We don't say the place." },

  { dir: 'npcs', label: 'Grieve - what they are made of',
    from: 'That is not us being clever. That is just what we happen to be made of.',
    to:   "We're not being clever. It's just what we happen to be made of." },

  { dir: 'npcs', label: 'Threlfall - the arrangement',
    from: 'That is not a boast. It is just the only option we have arranged for ourselves.',
    to:   "It's the only option we've arranged for ourselves." },
];

let grand = 0;
for (const e of EDITS) {
  const needle = esc(e.from);
  const repl = esc(e.to);
  let files = 0;
  for (const f of fs.readdirSync(path.join(ROOT, e.dir))) {
    if (!f.endsWith('.json')) continue;
    const p = path.join(ROOT, e.dir, f);
    const src = fs.readFileSync(p, 'utf8');
    if (!src.includes(needle)) continue;
    files++;
    if (WRITE) fs.writeFileSync(p, src.split(needle).join(repl), 'utf8');
  }
  grand += files;
  console.log(`  ${String(files).padStart(5)}  ${e.label}`);
}
console.log(`\n${WRITE ? 'WROTE' : 'dry run'} - ${grand} file(s) touched`);
