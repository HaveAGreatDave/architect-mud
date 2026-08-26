/**
 * The Long Watch start asking. 2026-08-25.
 *
 * ── The measurement ──────────────────────────────────────────────────────────
 *
 * 59 of the 140 NPCs with a real speaking part never ask the player a single
 * question, and the list is led by the biggest parts in the game. Cyrelle has
 * 6,087 characters of dialogue and not one question mark. So do the First, the
 * Quartermaster, Teague and Nine.
 *
 * That is the thing behind two separate complaints about lines reading as
 * "written, not spoken" -- "Back up the road. People do." and a surgeon selling
 * "the unit" without naming it. Neither line invites a reply. A character who
 * only makes statements is lecturing, and no amount of concrete vocabulary
 * fixes a monologue.
 *
 * It is not a vocabulary problem, which is worth saying because that is where I
 * looked first and it came back clean: abstraction runs at 1 term per 2,760
 * characters of speech, and 131 of 140 speaking NPCs quote a real number at
 * least once. The dialogue is concrete. It just does not TRANSACT.
 *
 * ── Why questions are the plain-speech fix ───────────────────────────────────
 *
 * Straight talk is not a vocabulary, it is a relationship. Speakers go direct --
 * no hedging, no softening -- when there is urgency, familiarity, or little face
 * at risk, and questions are the most direct move there is. A foreman asks "how
 * long has it been like that", because they need the answer to do the job.
 * Somebody performing asks nothing, because they already know how the speech
 * ends.
 *
 * So each question below is one a person would need the answer to in order to
 * do their actual work. None is rhetorical, and none is the NPC being curious
 * about the player as a character.
 *
 * ── The Quartermaster is the clearest case ───────────────────────────────────
 *
 * Her own description has said, since she was written: she fits gear to people
 * "the way a good tailor fits a suit: a long look, A SHORT QUESTION, and she
 * knows what you should carry." She had the long look. She had never asked the
 * question. It is now the first thing she says to you.
 *
 * Run: node scripts/content/lw-npcs-ask.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const WRITE = process.argv.includes('--write');
const log = [];

// Appends to a node's text, keeping array-vs-string form intact.
//
// ⚠ THE MARKER IS THE WHOLE POINT, AND THE DEFAULT IS NOT SAFE ON ITS OWN. The
// guard used to be "does the text already contain the first 24 characters of
// what I am about to add". That is correct exactly until a LATER layer edits the
// line, and lw-short-turns.mjs does precisely that: it rewrites the
// Quartermaster's question down to "What are you carrying?". The shortened line
// no longer contains the long line's first 24 characters, so this script stopped
// recognising its own work and appended the question again on every replay. The
// Quartermaster's greeting reached FOURTEEN copies of it before anybody looked,
// and nothing failed anywhere: a repeated line is valid content.
//
// So a caller whose line is rewritten downstream must pass the part that
// SURVIVES the rewrite. Callers that are nobody's input can leave it.
function addTo(tree, node, extra, marker = extra.trim().slice(0, 24)) {
  const n = tree[node];
  if (!n) return false;
  if (Array.isArray(n.text)) {
    if (n.text.some(s => s.includes(marker))) return false;
    n.text = [...n.text, extra.trim()];
  } else {
    if ((n.text || '').includes(marker)) return false;
    n.text = (n.text || '') + extra;
  }
  return true;
}

function edit(file, fn) {
  const p = path.join(ROOT, file);
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  fn(d.dialogue_tree, d);
  if (WRITE) fs.writeFileSync(p, canonicalJson(d), 'utf8');
}

// ── the Quartermaster: the short question she was described as asking ────────
edit('npcs/npc_lw_quartermaster.json', (t) => {
  // ⚠ lw-short-turns.mjs rewrites this to '"What are you carrying?"', so the
  // marker has to stop before the part that gets cut.
  if (addTo(t, 'root',
    '\n\n"What are you carrying that you would not want to put down?"',
    '"What are you carrying'))
    log.push('Quartermaster  root — the short question her description always promised');

  if (addTo(t, 'teach',
    '\n\nShe does look up for this one.\n\n"Which hand do you lead with?"'))
    log.push('Quartermaster  teach — asks before she fits, which is the whole job');
});

// ── Cyrelle: operations. She needs to know what came back with you ───────────
edit('npcs/npc_lw_cyrelle.json', (t) => {
  if (addTo(t, 'asc_report',
    '\n\n"Did anybody take your name?"'))
    log.push('Cyrelle        asc_report — the operational question, and the frightening one');

  if (addTo(t, 'ret_accept',
    '\n\n"Can you carry somebody who has stopped walking? Answer that honestly, because I am going to plan around it."'))
    log.push('Cyrelle        ret_accept — plans around the answer instead of assuming');
});

// ── Teague: the tunnels. She stands in the dark and needs one thing ──────────
edit('npcs/npc_lw_teague.json', (t) => {
  if (addTo(t, 'root',
    '\n\n"Anybody come down behind you?"'))
    log.push('Teague         root — the only question that matters where she stands');
});

// ── Pike: the door. Same shape, and he already sits it ten thousand times ────
edit('npcs/npc_lw_pike.json', (t) => {
  if (addTo(t, 'door',
    '\n\n"You eaten?"'))
    log.push('Pike           door — two words, and it is the whole of the Watch\'s hospitality');
});

console.log(log.map(l => '  ' + l).join('\n') || '  (nothing to do)');
console.log('\n' + (WRITE ? 'WROTE' : 'dry run — nothing written'));
