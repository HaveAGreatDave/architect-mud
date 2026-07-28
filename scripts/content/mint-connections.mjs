// ONE-SHOT: mint content/connections/ from the gap between geometry and exits.
//
//   node scripts/content/mint-connections.mjs [--write]
//
// Reads the authored zones, runs projectEdges() with NO connection files, and
// writes one file for every edge the projection cannot account for:
//
//   a link exits declares and geometry does not  → a connection
//   a link geometry projects and exits does not  → a wall (blocked: true)
//
// Run once, at cutover. It is committed rather than thrown away because the
// numbers in derive.mjs's §7.5 header are its output, and a claim you cannot
// re-derive is a claim nobody can check. Re-running it against a world whose
// connections are already minted produces NOTHING — the mint is idempotent by
// being a no-op the second time, not by rewriting what it wrote.
//
// IDS ARE MINTED, NOT DERIVED. The suffix comes from a hash of the endpoints so
// that this batch is reproducible while it is being tuned; the instant a file
// exists the id belongs to the file and nothing recomputes it. connection_locks
// (§6) is keyed by it, so a re-derived id is a lock's grant evaporating when
// somebody renames a tile — the exact P1 failure the keycard model had.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CONTENT_DIR, canonicalJson } from './lib.mjs';
import { projectEdges, OPPOSITE } from './derive.mjs';

const WRITE = process.argv.includes('--write');
const OUT = path.join(CONTENT_DIR, 'connections');

const readDir = (t) => {
  const d = path.join(CONTENT_DIR, t);
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')));
};

const zones = readDir('zones');
const doors = readDir('doors');
const existing = readDir('connections');

// Authored truth: every directed edge zones.exits declares.
const authored = new Set();
for (const z of zones) {
  for (const [dir, v] of Object.entries(z.exits || {})) {
    for (const t of (Array.isArray(v) ? v : [v])) if (t) authored.add(`${z.id}|${dir}|${t}`);
  }
}

const { edges: grid } = projectEdges(zones, existing);
const projected = new Set(grid.map(e => `${e.from_zone}|${e.direction}|${e.to_zone}`));

const gaps = [...authored].filter(k => !projected.has(k)).sort();
const walls = [...projected].filter(k => !authored.has(k)).sort();

// A doors row on either side of a seam means a fixture is already installed
// there, which is exactly what `lockable` records: a lock MAY live here (§6).
const doorSeam = new Set(doors.map(d => `${d.zone_id}|${d.exit_dir}`));

const slug = (id) => String(id).replace(/^zone_/, '').replace(/[^a-z0-9]+/gi, '_').slice(0, 34);
const suffix = (a, dir, b) => createHash('sha1').update(`${a}|${dir}|${b}`).digest()
  .readUInt32BE(0).toString(36).padStart(4, '0').slice(-4);
const mintId = (a, dir, b) => `conn_${slug(a)}_${dir}_${suffix(a, dir, b)}`;

const files = [];
const seen = new Set();
const emit = (a, dir, b, extra) => {
  const id = mintId(a, dir, b);
  files.push({
    id, a, b, dir,
    one_way: false, blocked: false, lockable: doorSeam.has(`${a}|${dir}`) || doorSeam.has(`${b}|${OPPOSITE[dir]}`),
    ...extra,
  });
};

// Gaps. A pair whose reverse is also a gap becomes ONE two-way file; anything
// else is genuinely one-way and says so. The 65 that come out one_way here are
// the same 65 the spec predicted, which is the first sign the model fits.
for (const k of gaps) {
  if (seen.has(k)) continue;
  const [a, dir, b] = k.split('|');
  const back = OPPOSITE[dir] ? `${b}|${OPPOSITE[dir]}|${a}` : null;
  const twoWay = back && !seen.has(back) && authored.has(back) && !projected.has(back);
  seen.add(k);
  if (twoWay) seen.add(back);
  emit(a, dir, b, { one_way: !twoWay });
}

// Walls. Symmetric in every case measured (0 of 660 block one way only), so one
// file per pair. `lockable` is false: there is nothing here to lock.
for (const k of walls) {
  if (seen.has(k)) continue;
  const [a, dir, b] = k.split('|');
  const back = OPPOSITE[dir] ? `${b}|${OPPOSITE[dir]}|${a}` : null;
  seen.add(k);
  if (back) seen.add(back);
  emit(a, dir, b, { blocked: true, lockable: false });
}

const ids = new Set(files.map(f => f.id));
if (ids.size !== files.length) throw new Error(`id collision: ${files.length} files, ${ids.size} distinct ids`);

const oneWays = files.filter(f => f.one_way && !f.blocked).length;
const blocks = files.filter(f => f.blocked).length;
console.log(`zones ${zones.length}  authored edges ${authored.size}  projected ${projected.size}`);
console.log(`gaps ${gaps.length} directed → ${files.length - blocks} link files (${oneWays} one-way)`);
console.log(`walls ${walls.length} directed → ${blocks} blocked files`);
console.log(`TOTAL ${files.length} connection files`);

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
