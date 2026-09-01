/**
 * Working the prose audit down. 2026-08-26.
 *
 * `node scripts/docs/prose-audit.mjs` reported 54 hits across 6 rules. Most of
 * them are legitimate and stay. This takes the ones that are not.
 *
 * ── The line that sorts the explaining-asides ────────────────────────────────
 *
 * 27 hits were the "which is the whole/only/entire X" construction, and the
 * audit cannot tell the two uses apart. This is the test:
 *
 *   NARRATION grading its own image      -> cut
 *   A CHARACTER'S judgement, in speech   -> keep
 *
 * Soup Molly is the clearest case: she had five, which reads as an authorial
 * tic. Three of them are hers — the docker who puts his fork down, the ration
 * invoices, the whole art of the thing — and those stay, because a repeated
 * construction in one person's mouth is a verbal habit and is characterising.
 * The other two are the narrator telling the reader what her burns mean and how
 * to take her tone, and the image had already done both.
 *
 * Six cuts out of twenty-seven. Kept, deliberately: the jokes (a soup smell as
 * "the entire advertising budget", a sweeper that "does not recognise you as
 * pavement"), anything that adds a fact (the baseload draw, the only surviving
 * copy of Nine's file), and every clause a character says out loud.
 *
 * ── Telling the player what they think ───────────────────────────────────────
 *
 * Two, and both are in room descriptions, which is the worst place for it: a
 * zone is read cold, out of order, and often by somebody who has walked in for
 * the third time in a minute. "That should frighten you more than it does" and
 * "You notice this and immediately wish you hadn't" both assign a reaction to a
 * person who is sitting right there and may be having a different one.
 *
 * ⚠ Kept on purpose: the feral dog's "You feel bad about it for approximately
 * three seconds." It breaks the same rule and it is the funniest line in the
 * combat text, and the rule exists to stop the prose being presumptuous rather
 * than to stop it being funny.
 *
 * ── Speech tags ──────────────────────────────────────────────────────────────
 *
 * Two real ones. Two of the five the audit found are false positives — "since
 * you asked plainly" is inside a character's own line, and "answered honestly"
 * describes a question rather than tagging speech. "she says eventually" keeps
 * its meaning but becomes an action, because the pause is the point and a beat
 * shows it better than an adverb does.
 *
 * Run: node scripts/content/prose-audit-pass.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const CLIENT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'client');
const WRITE = process.argv.includes('--write');

// Raw substring edits on the file bytes: formatting and key order untouched.
const EDITS = [
  // ── narration grading its own image ──────────────────────────────────────
  ['npcs/npc_soup_molly.json',
    'forearms carry the same shiny old oven-rail burns in the same place, which is the only part of her that says what she does for a living.',
    'forearms carry the same shiny old oven-rail burns in the same place.'],
  ['npcs/npc_soup_molly.json',
    'She says it like a confession, which is the only shy this woman gets.',
    'She says it like a confession.'],
  ['items/item_lw_wireless.json',
    'Heavy enough that you walk differently carrying it, which is the whole problem with it.',
    'Heavy enough that you walk differently carrying it.'],
  ['npcs/npc_lw_teague.json',
    'She does not argue and she does not get angry, and that is the whole difficulty with her.',
    'She does not argue and she does not get angry.'],
  ['npcs/npc_vag_nowlan.json',
    'Ivy says, pleasantly and instantly, and that is the whole of it. She is smiling.',
    'Ivy says, pleasantly and instantly. She is smiling.'],
  ['npcs/npc_asc_recruiter.json',
    'He is genuinely relieved, which is somehow the worst thing in the room.',
    'He is genuinely relieved.'],

  // ── telling the player their own reaction ────────────────────────────────
  ['zones/zone_the_lattice.json',
    'You know, without being told, exactly how to read it. That should frighten you more than it does.',
    'You know, without being told, exactly how to read it.'],
  ['zones/zone_citadel_gallery.json',
    'One of the boxes on the bottom tier is warm. You notice this and immediately wish you hadn\'t.',
    'One of the boxes on the bottom tier is warm.'],

  ['zones/zone_citadel_hall.json',
    'A hall built to make you feel small and largely succeeding.',
    'A hall built to make people feel small, and it works.'],

  // ── speech tags ──────────────────────────────────────────────────────────
  ['npcs/npc_phil_mccracken.json',
    'Phil says flatly.',
    'Phil says.'],
  ['npcs/npc_vag_gantry.json',
    'Prue says pleasantly.',
    'says Prue.'],
  ['npcs/npc_thorn_quarrel.json',
    '"Right," she says eventually.',
    'She takes her time about it. "Right."'],
];

let hit = 0, miss = 0;
for (const [rel, from, to] of EDITS) {
  const p = rel.startsWith('client/') ? path.join(CLIENT, rel.slice(7)) : path.join(ROOT, rel);
  const src = fs.readFileSync(p, 'utf8');
  // JSON files hold the text escaped; guides hold it raw.
  const needle = rel.endsWith('.json') ? JSON.stringify(from).slice(1, -1) : from;
  const repl = rel.endsWith('.json') ? JSON.stringify(to).slice(1, -1) : to;
  if (!src.includes(needle)) { console.log('  MISS  ' + rel + ' :: ' + from.slice(0, 46)); miss++; continue; }
  if (WRITE) fs.writeFileSync(p, src.split(needle).join(repl), 'utf8');
  console.log('  ok    ' + rel.replace(/^.*\//, '').padEnd(28) + to.slice(0, 44));
  hit++;
}

console.log('\n  ' + hit + ' applied, ' + miss + ' missed');
console.log('\n' + (WRITE ? 'WROTE' : 'dry run'));
