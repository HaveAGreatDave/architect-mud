// GLASS LITE · IS THE BAKE CURRENT?
//
// GLASS Lite draws a building from client/game/assets/lite/ instead of running its arm, so an arm
// edited since the last `npm run lite:bake` is drawn as it was before the edit, with nothing to say
// so: the build key (footprint, storeys, seed, facing, district) doesn't know what the arm draws.
// This bakes again in memory and fails if the result isn't the committed files. It writes nothing,
// opens no port and needs no database.
//
// Exact bytes first. Where those differ it decodes both and compares within a few least-significant
// bits, because the bake runs on whatever Node the machine has and V8's Math functions agree only to
// about 1e-12 between versions; a coordinate that lands on a rounding edge would otherwise fail CI
// on a bake that is current.
//
// It doesn't check the map snapshot against content/zones: the bake follows the snapshot, and a tile
// the snapshot is behind on is drawn by its own arm (gl/lite.js `same`), so a lagging snapshot costs
// speed, never a wrong building.
//
// Run:  node scripts/lite/smoke.mjs

import { readFileSync, existsSync } from 'node:fs';
import { bakeLite } from './bake.mjs';
import { decodeChunk } from '../../client/game/js/panels/gl/lite-format.js';

const OUT = new URL('../../client/game/assets/lite/', import.meta.url);
const fail = [];
const { files, index } = await bakeLite();

const near = (a, b, tol) => Math.abs(a - b) <= tol;
// Every number in two records within `tol`, every other value equal.
function sameRec(a, b, tol) {
  if (typeof a === 'number' && typeof b === 'number') return near(a, b, tol);
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => sameRec(v, b[i], tol));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    return ka.length === kb.length && ka.every((k, i) => k === kb[i] && sameRec(a[k], b[k], tol));
  }
  return a === b;
}
const keyNorm = (k) => String(k).replace(/-?\d+\.\d+/g, (m) => (+m).toFixed(6));

function compare(name, fresh, disk) {
  const A = decodeChunk(fresh), B = decodeChunk(disk);
  if (A.tiles.length !== B.tiles.length) return `${A.tiles.length} buildings baked, ${B.tiles.length} on disk`;
  if (!sameRec(A.arts, B.arts, 1e-6)) return 'sign artwork differs';
  for (let i = 0; i < A.tiles.length; i++) {
    const a = A.tiles[i], b = B.tiles[i], at = `${a.x},${a.y} (${a.bn || a.bt})`;
    if (a.x !== b.x || a.y !== b.y || a.bt !== b.bt || (a.bn || null) !== (b.bn || null)) return `building ${i} is ${at} baked, ${b.x},${b.y} on disk`;
    if (keyNorm(a.key) !== keyNorm(b.key)) return `${at} is built differently`;
    if (a.faces.length !== b.faces.length) return `${at}: ${a.faces.length} faces baked, ${b.faces.length} on disk`;
    for (let j = 0; j < a.faces.length; j++) {
      const fa = a.faces[j], fb = b.faces[j];
      if (fa.kind !== fb.kind || fa.texKey !== fb.texKey || fa.mat !== fb.mat || fa.p.length !== fb.p.length
        || String(fa.rgb) !== String(fb.rgb) || String(fa.rgbN) !== String(fb.rgbN) || fa.flat !== fb.flat) return `${at}: face ${j} differs`;
      for (let k = 0; k < fa.p.length; k++) for (let c = 0; c < 3; c++) if (!near(fa.p[k][c], fb.p[k][c], 1e-3)) return `${at}: face ${j} has moved`;
    }
    if (!sameRec(a.recs, b.recs, 2e-3)) return `${at}: its signs, lights or masts differ`;
  }
  return null;
}

for (const [name, f] of files) {
  const p = new URL(name, OUT);
  if (!existsSync(p)) { fail.push(`${name} is missing`); continue; }
  const disk = readFileSync(p);
  if (Buffer.compare(disk, Buffer.from(f.bin)) === 0) continue;
  const why = compare(name, f.bin, disk);
  if (why) fail.push(`${name}: ${why}`);
}
const idxP = new URL('index.json', OUT);
if (!existsSync(idxP)) fail.push('index.json is missing');
else {
  const disk = JSON.parse(readFileSync(idxP, 'utf8'));
  const have = new Set((disk.chunks || []).map((c) => c.file)), want = new Set(index.chunks.map((c) => c.file));
  for (const f of want) if (!have.has(f)) fail.push(`index.json doesn't list ${f}`);
  for (const f of have) if (!want.has(f)) fail.push(`index.json lists ${f}, which the bake no longer writes`);
}

if (fail.length) {
  console.log(`✗ lite:smoke: the GLASS Lite bake is stale (${fail.length}):`);
  for (const m of fail.slice(0, 12)) console.log('  ' + m);
  if (fail.length > 12) console.log(`  …and ${fail.length - 12} more`);
  console.log('  An arm, a palette or the map snapshot changed since the last bake. Run: npm run lite:bake');
  process.exit(1);
}
process.exit(0);
