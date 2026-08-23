// Promote machine-generated per-tile ambient prose into named global pools.
//
// WHY THIS EXISTS
// The region builders (build-deadwater.mjs, build-scarletwastes.mjs and friends)
// stamped a sub-area's ambient lines onto every tile of that sub-area as a
// per-zone `ambient_events` array. That is the wrong rung. The per-zone rung in
// getRandomAmbient is for prose written for ONE room; the weighted
// `global_ambient_events` pool is for a set of lines a lot of tiles share, and it
// has been sitting there the whole time with only the key missing.
//
// Measured 2026-08-22: 11,905 tiles carried 9.13MB of `ambient_events` between
// them, and only 1,014 of the strings were distinct. The world load out of Neon
// is the largest recurring cost the free tier has, and half of the `zones` table
// was this.
//
// WHAT IT DOES NOT TOUCH — and this is the point of the threshold. The
// distribution is bimodal: 29 blobs cover 11,633 tiles (9.05MB of generated
// fill), while 260 blobs sit on 272 tiles (73KB) and are hand-authored flavour
// for one room. Only the first group is a copy of something; the second group is
// exactly what the per-zone rung is for and is left alone. Anything under
// --min-tiles stays where it is.
//
//   node scripts/content/dedupe-ambient.mjs --dry-run     report, change nothing
//   node scripts/content/dedupe-ambient.mjs               rewrite content/
//
// IDEMPOTENT: pool ids are derived from the region and the sub-area's own name,
// never from a counter or a random uuid, so a second run over an already-migrated
// tree finds nothing to do and writes nothing.
import fs from 'node:fs';
import path from 'node:path';
import { CONTENT_DIR, canonicalJson } from './lib.mjs';

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const minTiles = Number([...args].find(a => a.startsWith('--min-tiles='))?.split('=')[1] ?? 8);

const ZONES = path.join(CONTENT_DIR, 'zones');
const POOLS = path.join(CONTENT_DIR, 'global_ambient_events');

const slug = s => String(s || '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'unnamed';

// ── Read every zone file once ───────────────────────────────────────────────
const files = fs.readdirSync(ZONES).filter(f => f.endsWith('.json'));
const byBlob = new Map();
for (const f of files) {
  let z;
  try { z = JSON.parse(fs.readFileSync(path.join(ZONES, f), 'utf8')); } catch { continue; }
  if (!Array.isArray(z.ambient_events) || !z.ambient_events.length) continue;
  const key = JSON.stringify(z.ambient_events);
  let e = byBlob.get(key);
  if (!e) byBlob.set(key, e = { msgs: z.ambient_events, tiles: [], names: new Map(), regions: new Map() });
  e.tiles.push(f);
  e.names.set(z.name, (e.names.get(z.name) || 0) + 1);
  const r = z.flags?.region_id || 'world';
  e.regions.set(r, (e.regions.get(r) || 0) + 1);
}

// ── Name each qualifying pool ───────────────────────────────────────────────
// A pool is named for the region and the tile name most of its tiles carry —
// `deadwater_the_wide_quiet`, not `pool_07`. 258 of the 289 blobs have tiles
// that ALL share one name, so this reads as the place it describes; a git diff
// on one of these files then says which sub-area changed voice.
//
// Ties broken by name so the winner cannot depend on directory order, and
// collisions suffixed rather than merged: two sub-areas that happen to share a
// name are still two sets of prose.
const dominant = m => [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
const taken = new Set();
const pools = [];
for (const e of [...byBlob.values()].sort((a, b) => b.tiles.length - a.tiles.length)) {
  if (e.tiles.length < minTiles) continue;
  const base = `${slug(dominant(e.regions)).replace(/^region_/, '')}_${slug(dominant(e.names))}`;
  let id = base, n = 2;
  while (taken.has(id)) id = `${base}_${n++}`;
  taken.add(id);
  pools.push({ id, ...e });
}

const movedTiles = pools.reduce((s, p) => s + p.tiles.length, 0);
const poolRows = pools.reduce((s, p) => s + p.msgs.length, 0);
const bytes = pools.reduce((s, p) => s + p.tiles.length * JSON.stringify(p.msgs).length, 0);
console.log(`${byBlob.size} distinct blobs across ${files.length} zone files`);
console.log(`→ ${pools.length} pools (>=${minTiles} tiles), ${movedTiles} tiles, ${poolRows} pool rows, ${(bytes / 1048576).toFixed(2)}MB of duplication removed`);
console.log(`→ ${byBlob.size - pools.length} blobs left as hand-authored per-zone prose\n`);
for (const p of pools) console.log(`  ${p.id.padEnd(38)} x${String(p.tiles.length).padStart(5)}  ${p.msgs.length} lines`);

if (dryRun) { console.log('\n--dry-run: nothing written.'); process.exit(0); }

// ── Write the pool rows ─────────────────────────────────────────────────────
// loudness 1.0 and a uniform weight reproduce the per-zone rung EXACTLY: it
// returned `loudness: 1.0` and picked uniformly at random. The point of this
// change is where the prose is stored, not how it sounds.
let wrote = 0;
for (const p of pools) {
  p.msgs.forEach((message, i) => {
    const id = `amb_${p.id}_${String(i + 1).padStart(2, '0')}`;
    const file = path.join(POOLS, `${id}.json`);
    const body = canonicalJson({ id, theme: p.id, message, loudness: 1.0, weight: 100, enabled: 1 });
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === body) return;
    fs.writeFileSync(file, body, 'utf8');
    wrote++;
  });
}

// ── Repoint the tiles ───────────────────────────────────────────────────────
// `ambient_theme` is deliberately left untouched: it still answers "what kind of
// place is this" for ambient-life's routine gating and for knock's indoors test.
// This only adds the second key and drops the copied prose.
let rewrote = 0;
for (const p of pools) {
  for (const f of p.tiles) {
    const file = path.join(ZONES, f);
    const z = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete z.ambient_events;
    z.flags = { ...(z.flags || {}), ambient_pool: p.id };
    const body = canonicalJson(z);
    if (fs.readFileSync(file, 'utf8') === body) continue;
    fs.writeFileSync(file, body, 'utf8');
    rewrote++;
  }
}
console.log(`\n✓ wrote ${wrote} pool files, rewrote ${rewrote} zone files.`);
console.log('  Next: npm run content:lint && npm run content:import && npm run test:regress');
