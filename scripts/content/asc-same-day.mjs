/**
 * They are very quick with it. 2026-08-25.
 *
 * ── Two notes ────────────────────────────────────────────────────────────────
 *
 * 1. The chair was not landing. "The chair went out afterwards and was not
 *    brought back" says the Ascendants find mutants unclean, which is true and
 *    is already carried by Maresh's hands behind his back. It does not say what
 *    the note actually wants said, which is that these people die.
 *
 * 2. The escalation should be ADDITIVE — the earlier beats all stay, and the
 *    ladder grows longer, over several pushes, and only for whoever the player
 *    is actually digging at. Not every character owns a deep path.
 *
 * ── How the death gets said without being said ───────────────────────────────
 *
 * The player already has the pieces. Ives told them, in her own vocabulary,
 * earlier in her own tree:
 *
 *     "A loss event. File closes, reserve releases, salvage goes where it can
 *      be used."
 *
 * So the only new fact needed is that Nine closes a file the same day. She
 * offers it as an example of a department running well, because to her it is
 * one. Nobody says died. Nobody says killed. The player does the arithmetic with
 * two lines she has already given them, and that is Swift's rule from
 * plain-writing.md — let the arithmetic carry the feeling, and keep every
 * emotive word away from it.
 *
 * Vess loses the chair and gets the same fact from the other side: she remembers
 * the man, warmly, and remembers that it was dealt with promptly, and has never
 * once put the two together.
 *
 * ── The ladder, and who has one ──────────────────────────────────────────────
 *
 * IVES has the deep path, because she is the one holding the book. Objecting now
 * runs: note -> the form cannot change -> who wrote it -> what Nine does ->
 * the warning -> the door. Six rungs, each a real answer, and the player can
 * stop at any of them.
 *
 * MARESH keeps his shorter one. He genuinely does not know what is behind that
 * door, so his ladder tops out at "I have not been through it", which is where
 * an honest man's escalation should end.
 *
 * VESS HAS NO DOOR AT ALL. She will not eject anybody and does not have it in
 * her. Pushing her only ever gets more warmth and less information, which is a
 * different and worse experience, and having one character who never breaks is
 * what makes the other two mean something.
 *
 * Run: node scripts/content/asc-same-day.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const WRITE = process.argv.includes('--write');
const log = [];
const opt = (label, next, actions = []) => ({ label, next, conditions: [], actions, enabled: true });

const edit = (rel, fn) => {
  const p = path.join(ROOT, rel);
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  fn(d, d.dialogue_tree);
  if (WRITE) fs.writeFileSync(p, canonicalJson(d), 'utf8');
};

// ── Vess: the chair goes, the man stays ─────────────────────────────────────
edit('npcs/npc_asc_vess.json', (d, t) => {
  t.the_climb_off.text =
    'For the first time she is not warm.\n\n'
    + '"They are going the other way down it."\n\n'
    + 'She glances at the door of the Gallery, and the glance is a check rather than a look.\n\n'
    + '"We had one in here in \'71. A nice enough man, and it was not his fault, and nobody says '
    + 'it is their fault." <span class="text-dim">A small, controlled pause.</span> "He was seen '
    + 'the same afternoon. They are very quick with it, which I have always been grateful for."\n\n'
    + 'Then it passes, and she is herself again, and she moves you along with a hand that does '
    + 'not quite touch your back.\n\n'
    + '"Come and see the Vats. That is the part everybody remembers."';
  log.push('Vess     the chair is gone — "He was seen the same afternoon."');
});

// ── Ives: what Nine actually does, in her own vocabulary ────────────────────
edit('npcs/npc_asc_ives.json', (d, t) => {
  // Additive rung: sits between "who wrote the rule" and the warning.
  t.the_mutant_written.options = [
    opt('Then the machine is doing its job.', 'stance_approve',
      [{ action: 'SET_FLAG', flag: 'asc_mutant_stance', scope: 'player', value: 'approved' },
       { action: 'RELATION_ADJUST', npc_id: 'npc_asc_ives', familiarity: 1, warmth: 1, reason: 'ives:intake-agreed' },
       { action: 'ADJUST_REPUTATION', delta: 40, ideology_id: 'ideology_ascendants', reason: 'intake' }]),
    opt('What does Nine do with him?', 'ives_nine'),
    opt('(take the slip and let it go)', 'stance_quiet',
      [{ action: 'SET_FLAG', flag: 'asc_mutant_stance', scope: 'player', value: 'quiet' }]),
    opt('He is a man. You have him down as property.', 'stance_object',
      [{ action: 'SET_FLAG', flag: 'asc_mutant_stance', scope: 'player', value: 'objected' }]),
  ];

  t.ives_nine = {
    _vine: { x: 2200, y: 2600 }, actions: [],
    text:
      '"Assessment, and then whatever assessment finds."\n\n'
      + 'She says it without any weight on it at all.\n\n'
      + '"They are a good department. I have never had a page sit with them overnight — it comes '
      + 'back closed the same day, every time, which I have always thought was rather impressive '
      + 'for that volume."',
    options: [
      opt('Closed.', 'ives_nine_closed'),
      opt('(say nothing)', 'bye'),
    ],
  };

  t.ives_nine_closed = {
    _vine: { x: 2460, y: 2600 }, actions: [],
    text:
      '"Closed."\n\n'
      + 'She looks up, because you have repeated a word back at her and people do not usually do '
      + 'that with the ordinary ones.\n\n'
      + '"It is what a file does when there is nothing further to record."\n\n'
      + 'She is already reaching for the next one.\n\n'
      + '"Was there something else?"',
    options: [
      opt('No. Nothing else.', 'bye'),
      opt('You know what that means.', 'ives_press'),
    ],
  };
  log.push('Ives     Nine closes a file the same day, every time, and she finds it impressive');
});

console.log(log.map(l => '  ' + l).join('\n'));
console.log('\n' + (WRITE ? 'WROTE' : 'dry run'));
