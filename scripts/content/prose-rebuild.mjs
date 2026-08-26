/**
 * Replay the order-prose passes in dependency order.
 *
 * The ladders and the dialogue were not written in one go. They are a stack of
 * layers, and the later ones are DELTAS on the earlier ones.
 *
 * ⚠ THE FOOTGUN THIS EXISTS TO REMOVE. The wholesale layers write entire
 * descriptions and entire emote lists. Running one of them on its own silently
 * reverts every edit a later layer made to the same field, and reports success
 * while doing it. There is no error and nothing to notice.
 *
 * ⚠ AND THE FOOTGUN IT GREW ITSELF, on 2026-08-25. This file listed nine layers
 * while twenty more had been written after them. Running it did exactly what the
 * paragraph above warns about: 41 content files rewritten, the whole Long Watch
 * ladder reverted to the version from three hours earlier. The tell was six
 * `no objective "o_kill_drone"` errors, and those were NOT a bug in the older
 * script. A newer layer had renamed that objective, and the older script was
 * reporting, accurately, that it no longer recognised the world it was being
 * replayed onto. AN ERROR FROM A LAYER IS EVIDENCE THAT THE CHAIN IS INCOMPLETE
 * before it is evidence that the layer is broken.
 *
 * SO: EVERY NEW PROSE SCRIPT GOES IN THIS LIST, IN THE ORDER IT WAS WRITTEN, IN
 * THE SAME COMMIT AS ITSELF. A prose script that is not chained here is a script
 * the next replay will silently undo.
 *
 * Every layer is idempotent, so this is safe to run at any time and is the right
 * thing to run after editing any of them.
 *
 *   node scripts/content/prose-rebuild.mjs [--check]
 */
import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';

const CHECK = process.argv.includes('--check');

// ⚠ IN THE ORDER THEY WERE WRITTEN. See the header: a prose script that is not
// in this list is a script the next replay silently undoes.
const LAYERS = [
  // ── generation 1: the three ladders WHOLESALE, then the deltas over them ──
  // ⚠ Order within a generation is wholesale-then-delta, NOT chronological. A
  // delta patches a string; a wholesale layer replaces the whole field. Sorting
  // this tier by file mtime (which is the obvious thing to do, and which I did)
  // put two trim-asides edits and one deepen edit BEFORE the rewrite that
  // replaces the field they patch, and the chain quietly reverted all three.
  ['arc-rewrite-lw.mjs', 'Long Watch ladder'],
  ['arc-rewrite-asc.mjs', 'Ascendant ladder'],
  ['arc-rewrite-minor.mjs', 'Null/Exodus/Wildblood/Terminus'],
  ['prose-trim-asides.mjs', 'explaining-aside cut'],
  ['prose-deepen.mjs', 'second pass'],
  ['pike-rite-fix.mjs', 'Pike rite briefing'],
  ['teague-south.mjs', 'Teague on the Wildblood'],
  ['prose-player-mind.mjs', 'player-mind fixes'],
  ['prose-broken-directions.mjs', 'bolded directions'],
  // ── generation 2: drugs and dreams ────────────────────────────────────────
  ['withdrawal-tail-drugs.mjs', 'withdrawal tail drugs'],
  ['withdrawal-stages.mjs', 'withdrawal stages'],
  // ── dreams: the de Quincey rewrite, then the symptom fx repoint ───────────
  ['dreams-de-quincey.mjs', 'dream rooms, de Quincey pass'],
  ['dream-fx-symptoms.mjs', 'drug fx symptoms'],
  // ── the standard pass, then the Long Watch dialogue tier ──────────────────
  ['prose-standard-pass.mjs', 'plain-writing standard pass'],
  ['lw-dialogue-review.mjs', 'LW dialogue review'],
  ['lw-structural-fixes.mjs', 'LW structural fixes'],
  ['kesh-plain-speech.mjs', 'Kesh plain speech'],
  ['lw-npcs-ask.mjs', 'LW NPCs ask things'],
  ['lw-short-turns.mjs', 'LW short turns'],
  ['qm-fitting-rewrite.mjs', 'Quartermaster fitting'],
  ['qm-fitting-antecedent.mjs', 'Quartermaster antecedents'],
  ['qm-fitting-plain.mjs', 'Quartermaster plain'],
  ['qm-fitting-resistance.mjs', 'Quartermaster resistance'],
  ['lw-canon-arson.mjs', 'LW arson canon'],
  // ⚠ lw-ladder-rewrite RENAMES objectives (o_kill_drone → o_kill), which is why
  // arc-rewrite-lw must run BEFORE it, and why arc-rewrite-lw's own "no
  // objective" errors are expected rather than alarming once this has run.
  ['lw-ladder-rewrite.mjs', 'LW ladder rewrite'],
  ['lw-name-the-wash.mjs', 'name the Wash'],
  ['lw-outfall-rename.mjs', 'Outfall rename'],
  ['lw-lockers-rename.mjs', 'lockers rename'],
  // ── new dream rooms: whole-file writes, so order-independent ──────────────
  ['dreams-sleep-expansion.mjs', 'sleep dream rooms'],
  ['dreams-drug-expansion.mjs', 'drug dream rooms'],
  ['lw-room-renames.mjs', 'LW room renames'],
  ['asc-politics.mjs', 'Ascendant politics'],
];

let failed = 0;
// ⚠ TWO CONVENTIONS LIVE IN THIS DIRECTORY, and getting it wrong is silent.
// The older scripts WRITE by default and take `--check` for a dry run. The newer
// ones are DRY BY DEFAULT and take `--write`. Passing no flag to a newer script
// runs it, prints a cheerful "dry run — nothing written", and applies nothing;
// the chain then reports a green tick for a layer that did not happen. That is
// exactly how the twenty missing layers stayed invisible.
//
// The flag is read off the script's own source rather than recorded in a column
// here, because a column is a second copy of a fact and this is the copy that
// would rot. A script mentioning `--write` opts in to the newer convention.
function flagsFor(file) {
  const src = readFileSync(`scripts/content/${file}`, 'utf8');
  const dryByDefault = src.includes("argv.includes('--write')");
  if (CHECK) return dryByDefault ? [] : ['--check'];
  return dryByDefault ? ['--write'] : [];
}

for (const [file, label] of LAYERS) {
  const r = spawnSync(process.execPath, [`scripts/content/${file}`, ...flagsFor(file)], { encoding: 'utf8' });
  const out = (r.stdout || '').trim().split('\n').filter(Boolean).pop() || '';
  const err = (r.stderr || '').trim();
  if (r.status !== 0) { failed++; console.error(`  ✗ ${label}\n${err}`); }
  else console.log(`  ✓ ${label.padEnd(24)} ${out}`);
}

console.log(failed ? `\n${failed} layer(s) failed.` : '\nProse rebuilt in order.');
process.exit(failed ? 1 : 0);
