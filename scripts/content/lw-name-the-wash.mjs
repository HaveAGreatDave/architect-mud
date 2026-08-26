/**
 * Saying what the wash is. 2026-08-25.
 *
 * ── The question, and the answer I nearly got wrong ──────────────────────────
 *
 * The author asked what the wash was. My first move was to assume it was fog I
 * had invented and replace it everywhere with Meltwater Row. The dry run is what
 * stopped that, and it would have broken real geography.
 *
 * The wash is REAL and it is the Long Watch's own approach. From The Threshold:
 * "West is the blind, the wash, and the dogleg out." From The Blind: "a mirror
 * angled down the length of the wash". It is the channel somebody has to come
 * down to reach their door, which is why they keep a mirror on it, why the
 * scrub room off it is called The Wash, and why a surveying machine working the
 * ducts underneath it is the most frightening thing in slot 3.
 *
 * So Pike's lines were correct and I was about to rewrite them.
 *
 * ── What IS actually wrong ───────────────────────────────────────────────────
 *
 * 1. Nothing anywhere tells the player what it is. It is used eleven times as
 *    if the reader has been down there.
 * 2. Two lines treat it as a city neighbourhood, which it is not. You cannot
 *    take an underground approach "apart street by street".
 * 3. "the corner of Kessler and the wash" puts a city street corner against an
 *    underground channel on the other side of the district.
 * 4. The name collides with three other places: a laundrette on Ironside Street
 *    (The Wash), an Exodus wash house, and Ferric Wash, a redrock district out
 *    in the Scarletwastes. Nothing can be done about that except never leaving
 *    the reader to guess which one is meant.
 *
 * ── The rule ─────────────────────────────────────────────────────────────────
 *
 * A place name has to be established once, in the mouth of somebody who has a
 * reason to explain it, before it is used as shorthand. Checking whether a name
 * resolves is not the same as checking whether the reader can resolve it.
 *
 * Run: node scripts/content/lw-name-the-wash.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const WRITE = process.argv.includes('--write');
const log = [];

// ── 1. the two lines that treat it as a neighbourhood ───────────────────────
const TEXT_EDITS = [
  ['quests/quest_lw_fav_quiet.json',
    'They will take the wash apart street by street and everybody who lives there will pay for your bad night.',
    'They will take Meltwater Row apart street by street, and everybody who lives there will pay for your bad night.'],
  ['quests/quest_lw_fav_quiet.json',
    'a body is a reason for people to come and look at the wash properly',
    'a body is a reason for people to come and look at Meltwater Row properly'],
  ['quests/quest_lw_meet.json',
    'on the corner of Kessler and the wash',
    'on Kessler Street'],
];
for (const [file, from, to] of TEXT_EDITS) {
  const p = path.join(ROOT, file);
  const src = fs.readFileSync(p, 'utf8');
  if (!src.includes(from)) { log.push('  miss  ' + path.basename(file) + ' :: ' + from.slice(0, 40)); continue; }
  if (WRITE) fs.writeFileSync(p, src.split(from).join(to), 'utf8');
  log.push('  ok    ' + path.basename(file) + ' :: ' + to.slice(0, 56));
}

// ── 2. Pike says what it is, once, to somebody who has just come down it ────
{
  const p = path.join(ROOT, 'npcs/npc_lw_pike.json');
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  const t = d.dialogue_tree;
  if (!t.what_wash) {
    t.what_wash = {
      _vine: { x: 1200, y: 1200 }, actions: [],
      text:
        '"The wash is the channel you just walked down. Storm drain, originally. It runs a '
        + 'quarter mile off the Meltwater outfall and it comes out at our door, and there is no '
        + 'other way in."\n\n'
        + 'He tips the mug at the mirror over the shelf.\n\n'
        + '"That is angled down the length of it. Anybody coming to us is in the open for four '
        + 'minutes before they arrive, and I have four minutes to decide about them. It is the '
        + 'only advantage we have got and it is the whole reason we are here and not somewhere '
        + 'more comfortable."\n\n'
        + '"When it rains hard it runs, so you go the long way. It has drowned two of us."',
      options: [
        { label: 'Why is the scrub room called that too?', next: 'what_wash_room', conditions: [], actions: [], enabled: true },
        { label: 'Understood.', next: 'bye', conditions: [], actions: [], enabled: true },
      ],
    };
    t.what_wash_room = {
      _vine: { x: 1440, y: 1200 }, actions: [],
      text:
        '"Because it is at the bottom of it, and because everybody who comes up the wash gets '
        + 'washed."\n\n'
        + '"Anything with a cell in it goes in a locker. Tablet, chip, anything that can be '
        + 'listened to. Then somebody checks you for metal, and they check with calipers rather '
        + 'than taking your word."\n\n'
        + '"Nobody enjoys it. Nobody skips it either."',
      options: [{ label: 'Understood.', next: 'bye', conditions: [], actions: [], enabled: true }],
    };
    (t.root.options ||= []).splice(1, 0, {
      label: 'What is the wash?', next: 'what_wash',
      conditions: [], actions: [], enabled: true,
    });
    if (WRITE) fs.writeFileSync(p, canonicalJson(d), 'utf8');
    log.push('  ok    npc_lw_pike.json :: two nodes explaining the wash and the scrub room');
  } else log.push('  skip  Pike already explains it');
}

console.log(log.join('\n'));
console.log('\n' + (WRITE ? 'WROTE' : 'dry run'));
