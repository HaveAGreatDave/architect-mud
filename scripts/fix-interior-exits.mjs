// One-shot: an interior room's OUT-exit (the cardinal that leaves the building
// map) must point the DOOR direction — flags.entrance on the facade. Interiors
// shipped with `out`, or with a cardinal mirrored off the facade->interior link
// (the wrong intuition that kept getting reverted). Re-key the interior's
// out-exit to the door direction. Pass --write.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const CARDINAL = new Set(['north','south','east','west']);

const zdir = join(ROOT, 'content', 'zones');
const files = readdirSync(zdir).filter(f => f.endsWith('.json'));
const byFile = new Map(files.map(f => [f, JSON.parse(readFileSync(join(zdir, f), 'utf8'))]));
const zones = new Map([...byFile.values()].map(z => [z.id, z]));
const fileOf = new Map([...byFile].map(([f, z]) => [z.id, f]));
const maps = readdirSync(join(ROOT, 'content', 'maps')).filter(f => f.endsWith('.json'))
  .map(f => JSON.parse(readFileSync(join(ROOT, 'content', 'maps', f), 'utf8')));
const entryOf = new Map();   // facadeId -> interior entry zone id
for (const m of maps) if (m.parent_zone_id) entryOf.set(m.parent_zone_id, m.entry_zone_id);

const changes = [];
for (const f of zones.values()) {
  if (!f.flags?.facade || !f.flags?.entrance) continue;
  const door = f.flags.entrance;
  const entry = zones.get(entryOf.get(f.id));
  if (!entry) continue;
  // Find the exit(s) on the entry room that lead back to the facade.
  const outDirs = Object.entries(entry.exits || {}).filter(([, t]) => t === f.id).map(([d]) => d);
  if (outDirs.length === 1 && outDirs[0] === door) continue;          // already correct
  // Drop every facade-pointing exit, re-add a single one keyed to the door.
  for (const d of outDirs) delete entry.exits[d];
  entry.exits[door] = f.id;
  changes.push(`  ${entry.id}: ${JSON.stringify(outDirs)} -> ${door}`);
}
console.log(changes.join('\n'));
console.log(`\n${changes.length} interior out-exits re-keyed to the door direction.`);
if (WRITE) { for (const c of changes) { const id = c.trim().split(':')[0]; writeFileSync(join(zdir, fileOf.get(id)), JSON.stringify(zones.get(id), null, 2) + '\n'); } console.log('WROTE.'); }
else console.log('(dry run — pass --write)');
