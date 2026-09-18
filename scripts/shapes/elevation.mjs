// DOES A BUILDING HAVE FOUR SIDES, OR ONE FRONT AND THREE BLANK WALLS?
//
//   node scripts/shapes/elevation.mjs            # gate: fails when an elevation has gone bare
//   node scripts/shapes/elevation.mjs --report   # the per-model table, worst first
//
// `models:quality` scores four things and every one of them is answered by the FRONT: a roof face,
// something lit, more than one wall palette, some trim. It is 94% satisfied and it cannot see the
// defect that produced "boring boxy buildings" — because the defect is not that a building has no
// detail, it is that all of the detail is on one of its four walls.
//
// Measured over the registry when this was written:
//
//     front 54%   ·   left flank 21%   ·   right flank 9.5%   ·   BACK 0.5%
//
// of each elevation's wall area carrying any trim at all, with 174 of 227 models under 2% on the
// back. `derivedKit` says why in its own section 1d: everything above that point is placed on ONE
// plane, "so a building in Coldwater has a facade and three blank elevations, and a truck turning a
// corner drives past the back of a set".
//
// ⚠ AND THE BACK IS NOT ONLY SEEN FROM THE AIR, WHICH IS THE ASSUMPTION THAT LET THIS SIT. Of the
// 201 building elevations in Coldwater that face an actual road tile, 57.7% are a front and the
// rest are a flank (18.9%), a back (8.5%) or a tile with no entrance recorded at all (14.9%).
// Getting on for half of what a driver is looking at is a wall the kit had never touched. That
// number is printed below rather than asserted — it is a property of today's content and will move
// every time somebody lays out a street.
//
// ⚠ AREA, NOT A FACE COUNT, and the difference is the whole measurement. A glazing ribbon is twenty
// quads across one band and a plinth is one quad round a whole building; counting faces says the
// ribbon is twenty times the building the plinth is. What the eye reads is how much of the wall has
// something on it.
//
// ⚠ THE NORMAL DECIDES WHICH ELEVATION A QUAD IS ON, AND THAT IS ALSO WHAT THIS CAUGHT FIRST. A
// mesh normal comes off the polygon's own winding (`emitFlat`, Newell) and is never flipped, so a
// part whose winding was authored for a +y wall claims a +y normal wherever it is put — which is
// INTO the building on a back wall. The first run of this reported a rank of piers on the back
// elevation as front trim, because that is what the mesh said they were, and GLASS 2 shades a face
// by its normal. A measurement that reads the same field the renderer reads is the point.
//
// ⚠ A FLOOR, NOT A BAND. The same argument `glmesh`'s signage floor and `models:quality` both make:
// a gate that pinned the number would fail on every retune, and what must not happen is an
// elevation going back to nothing. The floors sit far below where the medians are.
import { loadWindshield } from './dom-stub.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPORT = process.argv.includes('--report');
const ws = await loadWindshield();
const FH = 0.4, H = 1, SEED = 3;

// ⚠ THE FRONT IS +y. `derivedKit` places its facade at `fy = main.cy + main.fd` and calls
// `main.cy - main.fd` the back in its own comment, so this is the model's own convention rather
// than a guess about the capture.
const SIDES = [['front', 0, 1], ['back', 0, -1], ['left', -1, 0], ['right', 1, 0]];

// Twice the area of the polygon, by the cross-product sum — right for a quad in any plane, which
// these are: a sill lies flat, a pier face stands up, a soffit is upside down.
function area(p) {
  let ax = 0, ay = 0, az = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    ax += a[1] * b[2] - b[1] * a[2];
    ay += a[2] * b[0] - b[2] * a[0];
    az += a[0] * b[1] - b[0] * a[1];
  }
  return Math.hypot(ax, ay, az) / 2;
}

function measure(m) {
  let mesh = [];
  try { mesh = ws.captureModelMesh(m, { fh: FH, h: H, seed: SEED }); } catch { mesh = []; }
  const trim = { front: 0, back: 0, left: 0, right: 0 };
  const wall = { front: 0, back: 0, left: 0, right: 0 };
  for (const f of mesh) {
    const n = f.n;
    if (!n) continue;
    // Vertical surfaces only. A roof, a sill and a soffit belong to no elevation, and counting a
    // deck's acres of lid as "trim on the front" would drown everything this is looking for.
    if (Math.abs(n[2] || 0) > 0.5) continue;
    let side = null, best = 0.6;
    for (const [name, nx, ny] of SIDES) {
      const d = n[0] * nx + n[1] * ny;
      if (d > best) { best = d; side = name; }
    }
    if (!side) continue;                       // a corner chamfer faces two ways; it counts for neither
    if (f.kind === 'flat') trim[side] += area(f.p);
    else if (f.kind === 'wall') wall[side] += area(f.p);
  }
  return { trim, wall };
}

const K = ['front', 'back', 'left', 'right'];
const rows = [];
for (const { key, m } of ws.shapeModelRegistry()) {
  const { trim, wall } = measure(m);
  const cov = {};
  for (const k of K) cov[k] = wall[k] > 1e-6 ? trim[k] / wall[k] : null;
  rows.push({ key, trim, wall, cov });
}

const med = (k) => {
  const v = rows.map((r) => r.cov[k]).filter((x) => x != null).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : 0;
};
// "Bare" is two per cent of the wall, which is a downpipe and nothing else.
const BARE = 0.02;
const bare = (k) => rows.filter((r) => r.cov[k] != null && r.cov[k] < BARE).length;

// ── WHAT THE CITY ACTUALLY SHOWS A DRIVER ───────────────────────────────────
// Printed, never asserted: it is a fact about today's content, and the gate below is about the
// MODELS. It is here because it is the reason the back is worth a floor at all.
function roadFacing() {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const w = JSON.parse(readFileSync(join(here, '..', '..', 'client', 'game', 'flightsim-world.json'), 'utf8'));
    const DIR = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
    const OPP = { north: 'south', south: 'north', east: 'west', west: 'east' };
    const t = { front: 0, back: 0, flank: 0, unset: 0 };
    let n = 0;
    for (const [k, c] of Object.entries(w.cells)) {
      if (!c.bt) continue;
      const [x, y] = k.split(',').map(Number);
      for (const [d, [dx, dy]] of Object.entries(DIR)) {
        const nb = w.cells[(x + dx) + ',' + (y + dy)];
        if (!nb || !nb.road || nb.bt) continue;
        n++;
        if (!c.ent) t.unset++;
        else if (c.ent === d) t.front++;
        else if (c.ent === OPP[d]) t.back++;
        else t.flank++;
      }
    }
    return { n, t };
  } catch { return null; }
}

const problems = [];
// ⚠ FAR BELOW WHERE THEY SIT (61 / 26 / 29 / 39 when this was written), so a retune is free and only
// a change that takes an elevation back to bare trips it.
const FLOOR = { front: 0.25, back: 0.10, left: 0.10, right: 0.10 };
for (const k of K) {
  const v = med(k);
  if (v < FLOOR[k]) {
    problems.push(`the ${k} elevation carries a median of ${(v * 100).toFixed(1)}% trim against a floor of ${(FLOOR[k] * 100).toFixed(0)}% `
      + `— ${bare(k)} of ${rows.length} models are bare on it. The derived kit has stopped reaching that wall; `
      + `check derivedKit sections 1d and 1e, and check that the parts placed there are not claiming the wrong normal`);
  }
}

if (REPORT) {
  const worst = rows
    .map((r) => ({ key: r.key, ...Object.fromEntries(K.map((k) => [k, r.cov[k]])) }))
    .sort((a, b) => (a.back ?? 9) - (b.back ?? 9) || (a.left ?? 9) - (b.left ?? 9));
  console.log('  model'.padEnd(34) + K.map((k) => k.padStart(9)).join(''));
  for (const r of worst.slice(0, 40)) {
    console.log('  ' + r.key.padEnd(32) + K.map((k) => (r[k] == null ? '—' : (r[k] * 100).toFixed(1) + '%').padStart(9)).join(''));
  }
  console.log('');
}

console.log('  · trim as a share of wall area, by elevation (median over ' + rows.length + ' models):');
console.log('    ' + K.map((k) => `${k} ${(med(k) * 100).toFixed(1)}%`).join('   ')
  + '   · bare: ' + K.map((k) => `${k} ${bare(k)}`).join(' '));
const rf = roadFacing();
if (rf) {
  const p = (v) => (100 * v / rf.n).toFixed(1) + '%';
  console.log('  · of ' + rf.n + ' building elevations facing a road tile in Coldwater: '
    + `front ${p(rf.t.front)}, flank ${p(rf.t.flank)}, back ${p(rf.t.back)}, no entrance set ${p(rf.t.unset)}`);
}

if (problems.length) {
  console.log('✗ elevation — ' + problems.length + ' problem(s):');
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log('✓ elevation: every side of a building carries something.');
