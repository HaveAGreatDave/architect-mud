// Restore the sealed city↔wilds boundary the exit-wiring pass opened, while keeping
// intra-district connectivity complete. Two rules over adjacent non-building grid
// tiles (map_world zone_district_<x>_<y>):
//   • cross-boundary (one side flags.district==='wilds', the other not): REMOVE the
//     crossing exit both ways — EXCEPT the crossings that exist on published/prod
//     (PRESERVE), the deliberate curtain gate(s).
//   • same side (both wilds, or both city): FILL any empty orthogonal slot both ways
//     (fixes the asymmetric one-ways left by painting through the old painter).
// Run: node scripts/seal-wilds-boundary.mjs          (dry run)
//      node scripts/seal-wilds-boundary.mjs --apply
import { readFileSync } from 'node:fs';
import pg from 'pg';

// The only city↔wilds crossing present on prod — the single existing gate. Keep it.
const PRESERVE = new Set(['zone_district_918_919|zone_district_918_920']);

const APPLY = process.argv.includes('--apply');
const url = (() => { const m = readFileSync('.env', 'utf8').match(/^DATABASE_URL=(.+)$/m); return m[1].trim().replace(/^["']|["']$/g, ''); })();
const c = new pg.Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
await c.connect();
const bset = new Set((await c.query(`SELECT z.id FROM zones z WHERE z.flags ? 'building_type' OR z.flags ? 'is_building' OR EXISTS (SELECT 1 FROM maps mp WHERE mp.parent_zone_id = z.id)`)).rows.map(r => r.id));
const { rows } = await c.query(`SELECT id, exits, flags FROM zones WHERE id ~ '^zone_district_[0-9]+_[0-9]+$' AND map_id='map_world'`);
await c.end();

const OPP = { north: 'south', south: 'north', east: 'west', west: 'east' };
const DIRS = [['north', 0, -1], ['south', 0, 1], ['east', 1, 0], ['west', -1, 0]];
const coord = new Map();
for (const z of rows) { const m = z.id.match(/^zone_district_(\d+)_(\d+)$/); z._x = +m[1]; z._y = +m[2]; z._wilds = z.flags?.district === 'wilds'; coord.set(`${z._x},${z._y}`, z); }
const isB = z => bset.has(z.id);
const pending = new Map();                         // id -> mutated exits
const ex = id => pending.get(id) ?? rows.find(r => r.id === id)?.exits ?? {};
const setEx = (id, e) => pending.set(id, e);
const targets = (e, dir) => { const v = e?.[dir]; if (v == null) return []; if (typeof v === 'string') return [v]; if (Array.isArray(v)) return v.map(x => typeof x === 'string' ? x : x?.target).filter(Boolean); if (typeof v === 'object') return [v.target].filter(Boolean); return []; };

let sealed = 0, wired = 0, kept = 0, complex = [];
const seen = new Set();
for (const z of rows) {
  if (isB(z)) continue;
  for (const [dir, dx, dy] of DIRS) {
    const n = coord.get(`${z._x + dx},${z._y + dy}`);
    if (!n || isB(n)) continue;
    const key = [z.id, n.id].sort().join('|');
    if (seen.has(key)) continue; seen.add(key);
    const cross = z._wilds !== n._wilds;
    const ze = { ...ex(z.id) }, ne = { ...ex(n.id) };
    if (cross) {
      if (PRESERVE.has(key)) { kept++; continue; }
      // Remove the crossing both ways (plain-string grid exits only; flag anything odd).
      let changed = false;
      if (targets(ze, dir).includes(n.id)) { if (typeof ze[dir] === 'string') { delete ze[dir]; changed = true; } else complex.push(`${z.id}.${dir}`); }
      if (targets(ne, OPP[dir]).includes(z.id)) { if (typeof ne[OPP[dir]] === 'string') { delete ne[OPP[dir]]; changed = true; } else complex.push(`${n.id}.${OPP[dir]}`); }
      if (changed) { setEx(z.id, ze); setEx(n.id, ne); sealed++; }
    } else {
      // same side — fill empty slots both ways
      let changed = false;
      if (ze[dir] == null) { ze[dir] = n.id; changed = true; }
      if (ne[OPP[dir]] == null) { ne[OPP[dir]] = z.id; changed = true; }
      if (changed) { setEx(z.id, ze); setEx(n.id, ne); wired++; }
    }
  }
}

console.log(`cross-boundary pairs SEALED (crossing removed): ${sealed}`);
console.log(`gate(s) PRESERVED (existed on prod): ${kept}`);
console.log(`same-side pairs WIRED (empty slot filled): ${wired}`);
console.log(`tiles to update: ${pending.size}`);
if (complex.length) console.log(`⚠ non-string exits left untouched (review): ${complex.join(', ')}`);
if (!APPLY) { console.log('\nDRY RUN — re-run with --apply.'); process.exit(0); }

const c2 = new pg.Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
await c2.connect();
await c2.query('BEGIN');
for (const [id, e] of pending) await c2.query('UPDATE zones SET exits=$1 WHERE id=$2', [JSON.stringify(e), id]);
await c2.query('COMMIT');
await c2.end();
console.log(`\n✓ updated ${pending.size} tiles.`);
