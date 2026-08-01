// ONE-SHOT: turn the city↔wilds curtain from a code rule into authored walls.
//
//   node scripts/content/mint-curtain-walls.mjs [--write]
//
// THE CURTAIN USED TO BE A LINE OF CODE. `crossesCurtain` in derive.mjs suppressed
// every grid edge whose two ends disagreed about `flags.district === 'wilds'`, and
// that was defensible while `district` was the only handle anybody had on the
// frontier. It stopped being defensible when the Studio grew a district brush:
// `district` is a PRESENTATION field — the neighbourhood name with the room, the
// smells, the colour on the tablet — and it was also, silently, the load-bearing
// input to a wall. Erase a district on a frontier tile and 268 walls lost one of
// their number with no diff to show for it, because the wall was never a file.
//
// A player would have walked out of Coldwater into open killing ground without
// passing The South Gate: no gate warning, no wanted/contraband check on the way
// back, no clone-vat where they died. And nothing on the map would look wrong,
// because a missing wall looks exactly like ground.
//
// So the wall becomes what it always described: a fact about a place, authored.
// 134 files, using the mechanism the pipeline already has for "these two tiles
// touch and you cannot walk between them" (`blocked: true`, 57 of them today).
// What that buys, beyond closing the hole:
//
//   • No engine code contains the word "wilds". derive.mjs was the last live
//     reader of that content value; after this it projects geometry and reads
//     files, and knows nothing about districts at all.
//   • Opening a hole in the curtain becomes a DIFF — a deleted file in a review —
//     instead of a side effect of editing a colour two fields away.
//   • `flags.district` goes back to meaning one thing, so the paint tool cannot
//     move a wall no matter what it paints.
//
// Enforcement moves to `content:lint` (frontier closure), which is authoring-side
// bookkeeping and is allowed to know what "wilds" means. The engine is not.
//
// IDEMPOTENT: re-running against an already-sealed frontier writes nothing. Ids
// are minted from a hash of the endpoints, exactly as mint-connections.mjs does,
// and never recomputed once a file exists.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CONTENT_DIR, canonicalJson } from './lib.mjs';
import { CARDINAL, OPPOSITE } from './derive.mjs';

const WRITE = process.argv.includes('--write');
const OUT = path.join(CONTENT_DIR, 'connections');

// What these walls ARE, in the fiction the gate tile already tells: "a floor-to-
// heaven wall of humming hard light that seals the city's whole southern edge".
// Naming them is not a tool marker smuggled into content — `connections.name` is
// documented as being for prose and audit output, no runtime reader touches it,
// and a wall that says what it is beats 133 anonymous blocks in a review.
const CURTAIN = "the Architect's Curtain";

const readDir = (t) => {
  const d = path.join(CONTENT_DIR, t);
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')));
};

const zones = readDir('zones');
const existing = readDir('connections');

// The two predicates this has to agree with derive.mjs about, because the whole
// point is that the files it writes reproduce the rule it replaces exactly.
const isWilds = (z) => z?.flags?.district === 'wilds';
const facadeBlocks = (z, dir) => !!z?.flags?.facade && z.flags.entrance !== dir;

const byCell = new Map();
for (const z of zones) {
  if (z.map_id == null || z.grid_x == null || z.grid_y == null) continue;
  const k = `${z.map_id}|${z.grid_x},${z.grid_y},${z.grid_z ?? 0}`;
  if (!byCell.has(k)) byCell.set(k, []);
  byCell.get(k).push(z);
}

// Pairs already spoken for by a file — the South Gate above all. A pair with an
// authored opening must NOT get a wall (that is the gate, and it is the point of
// having one); a pair already walled must not get a second file.
const spoken = new Set(existing.map(c => [c.a, c.b].sort().join('~')));

const sorted = [...zones].sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
const pairs = new Map();   // "a~b" → { a, b, dir }
let skippedFacade = 0, skippedSpoken = 0;

for (const z of sorted) {
  for (const [dir, [dx, dy]] of Object.entries(CARDINAL)) {
    const neighbours = byCell.get(`${z.map_id}|${z.grid_x + dx},${z.grid_y + dy},${z.grid_z ?? 0}`) || [];
    for (const n of neighbours) {
      if (isWilds(z) === isWilds(n)) continue;                 // not the frontier
      // A pair the grid never joined anyway needs no wall: a facade is already a
      // wall on three sides, and a block that blocks nothing is a file whose
      // reason has been edited away (derive reports those as unusedBlocks).
      if (facadeBlocks(z, dir) || facadeBlocks(n, OPPOSITE[dir])) { skippedFacade++; continue; }
      const key = [z.id, n.id].sort().join('~');
      if (spoken.has(key)) { skippedSpoken++; continue; }
      if (!pairs.has(key)) pairs.set(key, { a: z.id, b: n.id, dir });
    }
  }
}

const slug = (id) => String(id).replace(/^zone_/, '').replace(/[^a-z0-9]+/gi, '_').slice(0, 34);
const suffix = (a, dir, b) => createHash('sha1').update(`${a}|${dir}|${b}`).digest()
  .readUInt32BE(0).toString(36).padStart(4, '0').slice(-4);

// A wall is symmetric, so one file per pair carries both directions — projectEdges
// blocks `a|dir|b` and `b|opposite|a` off the same row.
const files = [...pairs.values()]
  .map(({ a, b, dir }) => ({
    id: `conn_${slug(a)}_${dir}_${suffix(a, dir, b)}`,
    a, b, blocked: true, dir, lockable: false, name: CURTAIN, one_way: false,
  }))
  .sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));

const ids = new Set(files.map(f => f.id));
if (ids.size !== files.length) throw new Error(`id collision: ${files.length} files, ${ids.size} distinct ids`);

// THE OTHER HALF OF THE AUDIT. This script only ever ADDS, so a frontier that
// moves later — the city expanding into the wilds, tiles reclassified — leaves
// walls standing inland where both sides now agree. Those are not `unusedBlocks`
// (they still block a real adjacency, so derive sees nothing wrong): they are an
// invisible wall in open desert, which is the same bug as a missing one wearing
// the opposite sign. Reported rather than deleted, because deleting a wall is a
// walkability change and those get reviewed, not automated.
//
// Which walls are the curtain's is answered by `name`, the column the schema
// already reserves "for prose and audit output" and nothing reads at runtime.
// The id cannot answer it: mint-connections.mjs stamps the 57 interior walls with
// the same hash convention, and a first pass at this flagged all 57 as stale.
const zoneById = new Map(zones.map(z => [z.id, z]));
const stale = existing.filter((c) => {
  if (!c.blocked || c.name !== CURTAIN) return false;
  const a = zoneById.get(c.a), b = zoneById.get(c.b);
  return a && b && isWilds(a) === isWilds(b);
});

console.log(`zones ${zones.length}  wilds ${zones.filter(isWilds).length}`);
if (stale.length) {
  console.log(`\n⚠ ${stale.length} minted wall(s) are no longer on the frontier — both sides now read the same side of it.`);
  console.log('  They still block a step, so this is an invisible wall in open ground. Review and delete:');
  for (const c of stale.slice(0, 10)) console.log(`    content/connections/${c.id}.json  (${c.a} ↔ ${c.b})`);
  if (stale.length > 10) console.log(`    …and ${stale.length - 10} more`);
  console.log('');
}
console.log(`frontier adjacencies → ${files.length} wall files (${files.length * 2} directed edges suppressed)`);
console.log(`skipped: ${skippedSpoken} directed already spoken for by a file (the South Gate), ${skippedFacade} already walled by a facade`);

if (!WRITE) { console.log('\n(dry run — pass --write to create the files)'); process.exit(0); }

fs.mkdirSync(OUT, { recursive: true });
let written = 0, skipped = 0;
for (const f of files) {
  const p = path.join(OUT, `${f.id}.json`);
  if (fs.existsSync(p)) { skipped++; continue; }   // never overwrite a minted id
  fs.writeFileSync(p, canonicalJson(f), 'utf8');
  written++;
}
console.log(`✓ wrote ${written} files to content/connections/ (${skipped} already existed)`);
