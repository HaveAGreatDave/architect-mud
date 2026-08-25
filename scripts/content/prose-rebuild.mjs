/**
 * Replay the order-prose passes in dependency order.
 *
 * The two ladders were not written in one go. They are four layers, and the
 * later ones are DELTAS on the earlier ones:
 *
 *   1. arc-rewrite-lw.mjs     the Long Watch ladder, wholesale
 *   2. arc-rewrite-asc.mjs    the Ascendant ladder, wholesale
 *   3. prose-trim-asides.mjs  the explaining-aside cut, across the whole game
 *   4. prose-deepen.mjs       the second pass on the two ladders
 *
 * ⚠ THE FOOTGUN THIS EXISTS TO REMOVE. Layers 1 and 2 write whole descriptions
 * and whole emote lists. Running either of them on its own silently reverts
 * every edit layers 3 and 4 made to the same fields, and reports success while
 * doing it. There is no error and nothing to notice. Run this instead of any
 * individual script, or run them in the order above.
 *
 * All four are idempotent, so this is safe to run at any time and is the right
 * thing to run after editing any of them.
 *
 *   node scripts/content/prose-rebuild.mjs [--check]
 */
import { spawnSync } from 'child_process';

const CHECK = process.argv.includes('--check');

const LAYERS = [
  ['arc-rewrite-lw.mjs', 'Long Watch ladder'],
  ['arc-rewrite-asc.mjs', 'Ascendant ladder'],
  ['arc-rewrite-minor.mjs', 'Null/Exodus/Wildblood/Terminus'],
  ['prose-trim-asides.mjs', 'explaining-aside cut'],
  ['prose-deepen.mjs', 'second pass'],
  ['teague-south.mjs', 'Teague on the Wildblood'],
  ['pike-rite-fix.mjs', 'Pike rite briefing'],
  ['prose-player-mind.mjs', 'player-mind fixes'],
  ['prose-broken-directions.mjs', 'bolded directions'],
];

let failed = 0;
for (const [file, label] of LAYERS) {
  const r = spawnSync(process.execPath, [`scripts/content/${file}`, ...(CHECK ? ['--check'] : [])], { encoding: 'utf8' });
  const out = (r.stdout || '').trim().split('\n').filter(Boolean).pop() || '';
  const err = (r.stderr || '').trim();
  if (r.status !== 0) { failed++; console.error(`  ✗ ${label}\n${err}`); }
  else console.log(`  ✓ ${label.padEnd(24)} ${out}`);
}

console.log(failed ? `\n${failed} layer(s) failed.` : '\nProse rebuilt in order.');
process.exit(failed ? 1 : 0);
