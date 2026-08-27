/**
 * Eighty NPCs who never asked the player anything. 2026-08-26.
 *
 * The other half of the wordless-option problem. That one was the player having
 * no voice; this is the NPC not wanting one. 80 of 153 speaking NPCs never put a
 * question mark in anybody's mouth, and the list is led by the biggest parts in
 * the game — Soup Molly has 14,886 characters of dialogue and has never once
 * asked the player a thing.
 *
 * A conversation where only one side asks is an interview, and the game is on
 * the wrong end of it: the player interrogates a database and the database
 * answers. One question in the greeting fixes more than its size suggests,
 * because it establishes that the NPC has an interest in who walked in.
 *
 * ── WHERE THE QUESTION GOES ──────────────────────────────────────────────────
 *
 * `text` when it is a thing you would ask every time somebody walks in — a cook
 * asking whether you have eaten does not get stale. `first` when the greeting's
 * `text` is a terse repeat line ("Still shut.", "Board's up.") and a full
 * question bolted to it would read as a stuck record.
 *
 * ⚠ AND IT MUST NOT NEED AN ANSWER BRANCH. Every one of these is a question the
 * existing options can walk away from without the NPC looking ignored, which is
 * how people actually talk — Teague's root has asked "Anybody come down behind
 * you?" since the day it was written and no option answers it.
 *
 * ── ONE DELIBERATE NON-ASKER, LEFT ALONE ─────────────────────────────────────
 *
 * ⚠ Cordelia Verrick refuses on the page: "You're on the list or you're not, and
 * if you're standing here you're on it, so I shan't insult either of us by
 * asking." Giving her a question would delete the best line she has. Not every
 * silence is a gap and the audit cannot tell the difference.
 *
 * Run: node scripts/content/npcs-ask-things.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const WRITE = process.argv.includes('--write');

// [ npc, field, the question it asks ]
const ASKS = [
  // A cook, and the question a cook asks before anything else.
  ['npc_soup_molly', 'text',
    '"Have you eaten today, or are you going to lie to me about it?"'],
  // A chemist who sells to people who cook, and knows it.
  ['npc_chem_boateng', 'text',
    '"You cooking, or buying for somebody who is?"'],
  // He has a whole node about how looking is free. This is where that starts.
  ['npc_mintcond_sloat', 'text',
    '"After something, or looking? Both are fine. They want different answers out of me."'],
  ['npc_vag_tallow', 'text',
    '"You been down this lane before?"'],
  // Her greeting already sorts you into lost or looking, and then does not ask.
  ['npc_dredge', 'text',
    '"Which is it?"'],
  ['npc_asc_lapsed', 'text',
    '"Somebody send you? Nobody comes down this end for the view."'],
  // A buyer. It is the only question he has.
  ['npc_terminus_quartermaster', 'text',
    '"So. What have you got?"'],
  // Vanity, and the second clause is the whole man.
  ['npc_john_akerson', 'text',
    '"Do you watch the show? Be honest. It does not hurt me."'],
  ['npc_junkyard_dray', 'text',
    '"Selling or buying?"'],
  ['npc_citadel_teller', 'text',
    '"Do you hold an account with us?"'],
  ['npc_lw_rennick', 'text',
    '"So. Who are you, and who told you there was anything down here?"'],
  ['npc_terminus_warden', 'first',
    '"What were you expecting to find?"'],
  // A registrar, and the most frightening question in the building.
  ['npc_asc_nine', 'text',
    '"Do you have a reference number?"'],
  ['npc_kessler_dispatcher', 'first',
    'You driven anything big before, or are we starting from the beginning?'],
  ['npc_terminus_picket', 'first',
    '"How long have you been walking?"'],
  // The Thornwarren is domestic on the inside and nothing ever remarks on it.
  ['npc_thorn_moraine', 'first',
    '"Are those boots any good? You will want good boots on that side."'],
  ['npc_vag_kettle', 'text',
    '"You lost, or working?"'],
  ['npc_exo_elder', 'first',
    '"Have you come far?"'],
  // He invites the question and then, being who he is, offers to supply it.
  ['npc_asc_first', 'text',
    '"Or shall I tell you which one it usually is?"'],
];

let hit = 0, skip = 0, miss = 0;
for (const [file, field, question] of ASKS) {
  const p = path.join(ROOT, 'npcs/' + file + '.json');
  if (!fs.existsSync(p)) { console.log('  MISS  ' + file); miss++; continue; }
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  const root = d.dialogue_tree?.root;
  if (!root) { console.log('  MISS  ' + file + ' (no root)'); miss++; continue; }

  // ⚠ A GREETING CAN BE AN ARRAY OF VARIANTS, one of which the engine picks, and
  // the question goes on EXACTLY ONE of them. My first cut put it on all three
  // so the NPC would always ask — and `content:lint` failed it on the spot for
  // saying the same paragraph three times, which is the correct read: variants
  // exist so a greeting does not repeat. It is also the better writing. Nobody
  // asks the same question every time you walk in; asking it on one visit in
  // three is what a person does.
  const cur = root[field];
  if (typeof cur !== 'string' && !Array.isArray(cur)) {
    console.log('  MISS  ' + file + ' · ' + field + ' is neither string nor array'); miss++; continue;
  }
  const has = (s) => String(s).includes(question);

  if (Array.isArray(cur)) {
    // Self-healing: carry it on the first variant, strip it from any other.
    const want = cur.map((s, i) => {
      const bare = String(s).split('\n\n' + question).join('').trimEnd();
      return i === 0 ? bare + '\n\n' + question : bare;
    });
    if (want.every((s, i) => s === cur[i])) { skip++; continue; }
    root[field] = want;
  } else {
    if (has(cur)) { skip++; continue; }
    root[field] = cur.trimEnd() + '\n\n' + question;
  }
  if (WRITE) fs.writeFileSync(p, canonicalJson(d), 'utf8');
  console.log('  ok    ' + (file.replace(/^npc_/, '') + ' · ' + field).padEnd(34) + question.slice(0, 58));
  hit++;
}

console.log('\n  ' + hit + ' asked, ' + skip + ' already, ' + miss + ' missing');
console.log('\n' + (WRITE ? 'WROTE' : 'dry run'));
