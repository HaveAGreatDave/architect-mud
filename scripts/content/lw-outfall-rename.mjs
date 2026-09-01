/**
 * The wash becomes the Outfall. 2026-08-25.
 *
 * ── Why rename ───────────────────────────────────────────────────────────────
 *
 * The Long Watch's approach channel was called the wash, and so are three other
 * places: a laundrette on Ironside Street (The Wash), an Exodus wash house (The
 * Wash House), and Ferric Wash, a redrock district out in the Scarletwastes.
 * Nothing in the game told a player which was meant. The new place-names check
 * ranks "the wash" second worst in the world for this, across 23 files.
 *
 * ── Why the Outfall ──────────────────────────────────────────────────────────
 *
 * It is what the thing is: the prose already said the channel "runs a quarter
 * mile off the Meltwater outfall". No zone anywhere uses the word, so it collides
 * with nothing.
 *
 * And it says something the old name did not. An outfall is where a city
 * discharges what it has decided it does not want. The Long Watch are what
 * Coldwater flushed out, living at the bottom of the pipe, waiting. Nobody in
 * the fiction ever points that out and nobody should.
 *
 * The scrub room at the bottom of it keeps the name The Wash, because that is a
 * room where people wash and it is now the only Watch room called that.
 *
 * Run: node scripts/content/lw-outfall-rename.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const WRITE = process.argv.includes('--write');

// Every phrasing in use, longest first so no edit eats another's text.
const SWAPS = [
  ['a mirror angled down the length of the wash', 'a mirror angled down the length of the Outfall'],
  ['looks back down the wash', 'looks back down the Outfall'],
  ['If something comes down the wash', 'If something comes down the Outfall'],
  ['comes down Meltwater Row tonight', 'comes down the Outfall tonight'],
  ['Mirror looks down Meltwater Row', 'Mirror looks down the Outfall'],
  ['down the length of Meltwater Row', 'down the length of the Outfall'],
  ['West is the blind, the wash, and the dogleg out', 'West is the blind, the Outfall, and the dogleg out'],
  ['The wash is the channel you just walked down', 'The Outfall is the channel you just walked down'],
  ['everybody who comes up the wash gets washed', 'everybody who comes up the Outfall gets washed'],
  ['gets to the wash and finds Pike', 'gets to the Outfall and finds Pike'],
  ['the ducts under Meltwater Row', 'the ducts under the Outfall'],
  ['the approach to Meltwater Row', 'the approach to the Outfall'],
  ['the wash', 'the Outfall'],
  ['the Wash', 'the Outfall'],
];

// Files that legitimately keep the word: the laundrette, the Exodus wash house,
// the Watch's own scrub room, and every Ferric Wash tile.
const KEEP = /zone_the_wash|zone_exo_wash|zone_lw_wash|zone_util_zone_exo_wash/;

let files = 0, edits = 0;
for (const dir of ['quests', 'npcs', 'zones', 'items']) {
  const d = path.join(ROOT, dir);
  for (const f of fs.readdirSync(d)) {
    if (!f.endsWith('.json')) continue;
    if (KEEP.test(f)) continue;
    const p = path.join(d, f);
    let src = fs.readFileSync(p, 'utf8');
    const before = src;
    // Only touch Long Watch content and the rooms that describe their approach.
    if (!/^(quest_lw_|npc_lw_)/.test(f) && !/zone_lw_/.test(f)) continue;
    let n = 0;
    for (const [from, to] of SWAPS) {
      if (!src.includes(from)) continue;
      n += src.split(from).length - 1;
      src = src.split(from).join(to);
    }
    if (src === before) continue;
    files++; edits += n;
    console.log('  ' + String(n).padStart(2) + '  ' + f);
    if (WRITE) fs.writeFileSync(p, src, 'utf8');
  }
}

console.log('\n  ' + edits + ' replacement(s) across ' + files + ' file(s)');

// What still says wash, so the report is honest about what was left alone.
const left = [];
for (const dir of ['quests', 'npcs', 'zones']) {
  for (const f of fs.readdirSync(path.join(ROOT, dir))) {
    if (!/^(quest_lw_|npc_lw_|zone_lw_)/.test(f)) continue;
    const s = fs.readFileSync(path.join(ROOT, dir, f), 'utf8');
    const n = (s.match(/\bwash\b/gi) || []).length;
    if (n) left.push(f.replace('.json', '') + ' (' + n + ')');
  }
}
console.log('  Watch files still using "wash": ' + (left.join(', ') || 'none'));
console.log('\n' + (WRITE ? 'WROTE' : 'dry run'));
