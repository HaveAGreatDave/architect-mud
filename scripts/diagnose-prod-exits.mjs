// Read-only diagnostic: classify why adjacent published (prod) district grid tiles
// are or aren't connected. Run: node --env-file=.env.prod scripts/diagnose-prod-exits.mjs
import pg from 'pg';
const url = process.env.DATABASE_URL;
const local = /localhost|127\.0\.0\.1/.test(url);
const c = new pg.Client({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false } });
await c.connect();

const bset = new Set((await c.query(
  `SELECT z.id FROM zones z WHERE z.flags ? 'building_type' OR z.flags ? 'is_building'
      OR EXISTS (SELECT 1 FROM maps mp WHERE mp.parent_zone_id = z.id)`)).rows.map(r => r.id));
const { rows } = await c.query(
  `SELECT id, exits, flags FROM zones WHERE id ~ '^zone_district_[0-9]+_[0-9]+$' AND map_id='map_world'`);
await c.end();

const coord = new Map();
for (const z of rows) { const m = z.id.match(/^zone_district_(\d+)_(\d+)$/); z._x = +m[1]; z._y = +m[2]; z._t = z.flags?.terrain || null; coord.set(`${z._x},${z._y}`, z); }
const OPP = { north: 'south', south: 'north', east: 'west', west: 'east' };
const DIRS = [['north', 0, -1], ['south', 0, 1], ['east', 1, 0], ['west', -1, 0]];
const isB = z => bset.has(z.id);
const targets = (ex, dir) => { const v = ex?.[dir]; if (v == null) return []; if (typeof v === 'string') return [v]; if (Array.isArray(v)) return v.map(e => typeof e === 'string' ? e : e?.target).filter(Boolean); if (typeof v === 'object') return [v.target].filter(Boolean); return []; };

let connected = 0, edge = 0, buildingAdj = 0;
const oneway = [], missing = [];
const pairSeen = new Set();
for (const z of rows) {
  if (isB(z)) continue;
  for (const [dir, dx, dy] of DIRS) {
    const n = coord.get(`${z._x + dx},${z._y + dy}`);
    if (!n) { edge++; continue; }
    if (isB(n)) { buildingAdj++; continue; }
    const key = [z.id, n.id].sort().join('|'); if (pairSeen.has(key)) continue; pairSeen.add(key);
    const f = targets(z.exits, dir).includes(n.id);
    const b = targets(n.exits, OPP[dir]).includes(z.id);
    if (f && b) connected++;
    else if (f !== b) oneway.push(`${z.id} ${dir}->${n.id}  (fwd=${f} back=${b})`);
    else missing.push({ a: z.id, b: n.id, ta: z._t, tb: n._t });
  }
}

// Bucket the fully-missing links by terrain pairing (tells intentional-looking boundaries apart)
const byTerr = new Map();
for (const m of missing) { const k = [m.ta || '∅', m.tb || '∅'].sort().join(' ↔ '); byTerr.set(k, (byTerr.get(k) || 0) + 1); }

console.log(`PROD district grid — adjacency audit (non-building tiles)\n`);
console.log(`connected (both ways):    ${connected}`);
console.log(`edge (no neighbour):      ${edge}`);
console.log(`building-adjacent (skip): ${buildingAdj}`);
console.log(`ONE-WAY (asymmetric bug): ${oneway.length}`);
console.log(`MISSING (both absent):    ${missing.length}`);
console.log(`\nMISSING links by terrain pairing:`);
for (const [k, n] of [...byTerr.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);
console.log(`\nsample ONE-WAY (first 15):`);
console.log(oneway.slice(0, 15).map(s => '  ' + s).join('\n'));
console.log(`\nsample MISSING (first 15):`);
console.log(missing.slice(0, 15).map(m => `  ${m.a} (${m.ta || '∅'}) <-> ${m.b} (${m.tb || '∅'})`).join('\n'));
