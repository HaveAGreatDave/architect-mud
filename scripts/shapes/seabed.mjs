// THE SEABED, CHECKED — a floor nobody has seen yet, held to the claims that are silent when wrong.
//
//   node scripts/shapes/seabed.mjs        (npm run gl:seabed)
//
// client/shared/seabed.js is read by the renderer, the server and the dive plugin, and every one
// of them trusts it to be the same floor. Six claims:
//
//   1. DETERMINISTIC. The same point gives the same depth, material and wreck on every call. A
//      Math.random or a clock anywhere in it is two players disagreeing about where a trench is.
//   2. ZERO AT THE SHORE, AND CONTINUOUS ACROSS IT. Depth is exactly 0 on land and on the boundary
//      of the first land tile, and it approaches 0 smoothly — no step at the coastline.
//   3. NEVER NEGATIVE. Relief may never lift the floor above the water.
//   4. THE SHELF IS MONOTONE. The base profile only ever deepens away from shore; relief is the
//      only thing allowed to make it uneven.
//   5. THE RELIEF IS REAL. A floor with relief on must differ from the bare shelf, or the noise
//      was wired to nothing — the classic feature that is correctly written and draws nothing.
//   6. WRECKS GET RICHER WITH DEPTH. Deep cells must hold deeper kinds than shallow ones; a
//      frontier whose best finds are in the harbour has no reason to dive.
//
// Arithmetic only: no GPU, no DOM, no network.
import {
  shoreDistance, shoreField, shelfDepth, seabedDepth, seabedMaterial, seabedSlope,
  wreckInCell, wrecksNear, seabedZoneId, WRECK_KINDS, SHELF_EDGE, DROP_W,
  scatterAt, SCATTER_KINDS, SCATTER_SLOTS,
} from '../../client/shared/seabed.js';

const fail = [], ok = [];
const check = (cond, msg) => (cond ? ok : fail).push(msg);

// A test world: land for y < 0 (a straight coast along y = 0), plus an island.
const coast = (ix, iy) => iy < 0 || (Math.hypot(ix - 40.5, iy - 30.5) < 4);
// Open water past a single headland, for the deep checks.
const ocean = (ix, iy) => iy < 0 && ix < 5;

// 1. Determinism
{
  let same = true;
  for (let i = 0; i < 400; i++) {
    const x = (i * 7.31) % 90, y = 0.3 + (i * 3.17) % 70;
    if (seabedDepth(x, y, coast) !== seabedDepth(x, y, coast)) same = false;
    if (seabedMaterial(x, y, coast) !== seabedMaterial(x, y, coast)) same = false;
  }
  const a = JSON.stringify(wreckInCell(3, 2, coast)), b = JSON.stringify(wreckInCell(3, 2, coast));
  check(same && a === b, 'deterministic: depth, material and wrecks repeat exactly');
  check(seabedZoneId(900, 905) === 'seabed_900_905', 'zone ids are stable strings of the tile');
}

// 2. Zero at the shore, continuous across it
{
  check(seabedDepth(10.5, -2.5, coast) === 0, 'depth is 0 on land');
  check(seabedDepth(10.5, 0, coast) === 0, 'depth is 0 on the first water tile\'s shore edge');
  check(seabedDepth(20.5, 0.001, coast) < 0.05,
    `depth approaches 0 at the shoreline (${seabedDepth(20.5, 0.001, coast).toFixed(4)} m at 0.001 tile)`);
  // ⚠ A STEP DOES NOT SHRINK WHEN YOU LOOK CLOSER; A SLOPE DOES. A fixed threshold on the change
  // over a small distance fails on the drop-off, which is steep and continuous. So compare the
  // change over 0.01 tile with the change over 0.001: ~10:1 for a continuous floor, ~1:1 at a jump.
  let jumps = 0;
  for (let i = 0; i < 3000; i++) {
    const x = 1 + (i * 0.731) % 80, y = 0.02 + (i * 0.377) % 60;
    const z = seabedDepth(x, y, coast);
    const a = Math.abs(seabedDepth(x + 0.01, y, coast) - z);
    const b = Math.abs(seabedDepth(x + 0.001, y, coast) - z);
    if (a > 1e-6 && b > 0.5 * a) jumps++;
  }
  check(jumps === 0, `continuous everywhere, no jumps (${jumps} of 3000 samples)`);
}

// 3. Never negative
{
  let neg = 0;
  for (let i = 0; i < 5000; i++) {
    const x = (i * 1.913) % 120, y = (i * 0.617) % 100;
    if (seabedDepth(x, y, ocean) < 0 || seabedDepth(x, y, coast) < 0) neg++;
  }
  check(neg === 0, `never negative (${neg} of 10000 samples)`);
}

// 4. Shelf monotone, and the drop-off actually drops
{
  let mono = true, prev = -1;
  for (let d = 0; d < 80; d += 0.05) { const z = shelfDepth(d); if (z < prev - 1e-9) mono = false; prev = z; }
  check(mono, 'shelf profile is monotone in shore distance');
  check(shelfDepth(SHELF_EDGE + DROP_W + 2) > 5 * shelfDepth(SHELF_EDGE - 2),
    `the drop-off drops (${shelfDepth(SHELF_EDGE - 2).toFixed(0)} m → ${shelfDepth(SHELF_EDGE + DROP_W + 2).toFixed(0)} m)`);
}

// 5. Relief is real
{
  let moved = 0, n = 0;
  for (let i = 0; i < 600; i++) {
    const x = 2 + (i * 1.37) % 80, y = 3 + (i * 0.91) % 20;
    const d = shoreDistance(x, y, coast);
    if (d <= 0) continue;
    n++;
    if (Math.abs(seabedDepth(x, y, coast, d) - shelfDepth(d)) > 0.25) moved++;
  }
  check(moved / n > 0.5, `relief moves the floor off the bare shelf (${(100 * moved / n).toFixed(0)}% of samples)`);
  const s = seabedSlope(20.3, 12.7, coast);
  check(Number.isFinite(s.dx) && Number.isFinite(s.dy), 'slope is finite');
}

// 6. Wrecks get richer with depth
{
  const rank = Object.fromEntries(WRECK_KINDS.map((k, i) => [k.kind, i]));
  const shallow = [], deep = [];
  // A straight coast, so both the shelf and the Deep are in range.
  const bay = (ix, iy) => iy < 0;
  for (let cx = -30; cx < 30; cx++) for (let cy = 0; cy < 8; cy++) {
    const w = wreckInCell(cx, cy, bay);
    if (!w) continue;
    (w.depth < 60 ? shallow : deep).push(rank[w.kind]);
    if (w.depth < WRECK_KINDS[rank[w.kind]].min) fail.push(`wreck ${w.id} (${w.kind}) sits above its minimum depth`);
  }
  const mean = a => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
  check(shallow.length > 0 && deep.length > 0, `wrecks exist in both bands (${shallow.length} shallow, ${deep.length} deep)`);
  check(mean(deep) > mean(shallow), `deep wrecks are richer (mean rank ${mean(shallow).toFixed(2)} → ${mean(deep).toFixed(2)})`);
  check(wrecksNear(100, 100, 30, ocean).every(w => Math.hypot(w.x - 100, w.y - 100) <= 30), 'wrecksNear respects its radius');
}

// 7. The fast field agrees with the exact search, and keeps the coast at zero
{
  const f = shoreField(-60, -60, 180, 180, coast);
  let worst = 0, n = 0;
  for (let i = 0; i < 3000; i++) {
    const x = (i * 1.731) % 100, y = 0.02 + (i * 0.917) % 60;
    const e = shoreDistance(x, y, coast), a = f.at(x, y);
    worst = Math.max(worst, Math.abs(e - a)); n++;
  }
  check(worst < 0.75, `shoreField matches the exact distance (worst ${worst.toFixed(3)} tile over ${n} samples)`);
  let edge = 0;
  for (let x = 1; x < 80; x += 0.53) edge = Math.max(edge, f.at(x, 0));
  check(edge < 1e-6, `shoreField is 0 on the shoreline (worst ${edge.toExponential(1)})`);
  check(f.at(10.5, -5.5) === 0, 'shoreField is 0 on land');
  const g = shoreField(-60, -60, 180, 180, coast);
  check(g.data.every((v, k) => v === f.data[k]), 'shoreField is deterministic');
}

// 8. Scatter: deterministic, inside its kind's depth band, several kinds in each band, and never
//    on land. A kind whose band no depth reaches is an object nobody will ever see.
{
  const all = [], kinds = new Set(), bands = { shallow: new Set(), deep: new Set() };
  let same = true, outBand = 0, onLand = 0;
  for (let ty = 0; ty < 40; ty++) for (let tx = 0; tx < 90; tx++) for (let k = 0; k < SCATTER_SLOTS; k++) {
    const o = scatterAt(tx, ty, k, coast);
    if (JSON.stringify(o) !== JSON.stringify(scatterAt(tx, ty, k, coast))) same = false;
    if (!o) continue;
    all.push(o); kinds.add(o.kind);
    const def = SCATTER_KINDS.find(q => q.kind === o.kind);
    if (o.depth < def.min || o.depth > def.max) outBand++;
    if (coast(Math.floor(o.x), Math.floor(o.y))) onLand++;
    if (o.depth < 30) bands.shallow.add(o.kind);
  }
  for (let ty = 60; ty < 110; ty++) for (let tx = 60; tx < 110; tx++) for (let k = 0; k < SCATTER_SLOTS; k++) {
    const o = scatterAt(tx, ty, k, ocean);
    if (o && o.depth > 250) bands.deep.add(o.kind);
  }
  check(same, 'scatter is deterministic');
  check(all.length > 50 && outBand === 0 && onLand === 0, `scatter sits in its depth band and off the land (${all.length} objects, ${outBand} out of band, ${onLand} on land)`);
  check(bands.shallow.size >= 6 && bands.deep.size >= 8, `scatter varies by depth (${bands.shallow.size} shallow kinds, ${bands.deep.size} deep kinds)`);
}

for (const m of ok) console.log('  ✓ ' + m);
if (fail.length) {
  for (const m of fail) console.log('  ✗ ' + m);
  console.log('seabed FAILED');
  process.exit(1);
}
console.log(`seabed ok (${ok.length} claims)`);
