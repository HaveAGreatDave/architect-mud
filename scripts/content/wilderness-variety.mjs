/**
 * Break up wilderness descriptions that were one text on hundreds of tiles.
 *
 * Every zone whose description is a key (or a variant) in
 * scripts/content/wilderness-pools.mjs gets the variant picked from its
 * grid_x/grid_y. Picks are deterministic and adjacent tiles in one pool never
 * match, so a re-run changes nothing. Texts repeated on more than 50 tiles that
 * have no pool are listed at the end so somebody can write one.
 *
 * Raw substring replacement on the file bytes, like prose-standard-pass.mjs, so
 * the diff is one line per file.
 *
 *   node scripts/content/wilderness-variety.mjs            dry run
 *   node scripts/content/wilderness-variety.mjs --write    apply
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { originOf, pickVariant } from './wilderness-pools.mjs';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'content', 'zones');
const WRITE = process.argv.includes('--write');
const esc = s => JSON.stringify(s).slice(1, -1);

const counts = new Map();
let changed = 0, skipped = 0;
const perPool = new Map();

for (const f of fs.readdirSync(DIR)) {
  if (!f.endsWith('.json')) continue;
  const file = path.join(DIR, f);
  const raw = fs.readFileSync(file, 'utf8');
  let z;
  try { z = JSON.parse(raw); } catch { continue; }
  const d = z.description;
  if (typeof d !== 'string') continue;
  counts.set(d, (counts.get(d) || 0) + 1);
  const orig = originOf(d);
  if (!orig || z.grid_x == null || z.grid_y == null) continue;
  const next = pickVariant(d, z.grid_x, z.grid_y);
  if (next === d) continue;
  const from = '"description": "' + esc(d) + '"';
  if (!raw.includes(from)) { skipped++; continue; }
  const out = raw.replace(from, '"description": "' + esc(next) + '"');
  perPool.set(orig, (perPool.get(orig) || 0) + 1);
  changed++;
  if (WRITE) fs.writeFileSync(file, out);
}

for (const [o, n] of perPool) console.log(String(n).padStart(6), ' ', o.slice(0, 70));
console.log(`${WRITE ? 'wrote' : 'would change'} ${changed} zone files${skipped ? `, ${skipped} skipped (formatting mismatch)` : ''}`);
const unpooled = [...counts].filter(([t, n]) => n > 50 && !originOf(t)).sort((a, b) => b[1] - a[1]);
if (unpooled.length) {
  console.log(`\n${unpooled.length} texts on >50 tiles with no pool:`);
  for (const [t, n] of unpooled) console.log(String(n).padStart(6), ' ', t.slice(0, 70));
}
