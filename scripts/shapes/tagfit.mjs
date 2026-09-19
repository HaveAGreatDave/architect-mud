// tagfit — IS ANYTHING STANDING IN FRONT OF THE GRAFFITI?
//
//   node scripts/shapes/tagfit.mjs            # gate: fails when the kit paints on glass, or too little
//   node scripts/shapes/tagfit.mjs --report   # the per-model table, worst first
//
// `derivedKit` puts a tag on 38% of frontages and its own comment states the placement rule:
// "nobody sprays a shop window, and on this kit the middle of the ground floor is glazing — so the
// tag takes the service end of the frontage, the same flank the bins are on". Both halves of that
// sentence are the bug.
//
//   · THE GLAZING IS NOT IN THE MIDDLE. A shopfront band spans 0.8 of the base half-width and the
//     two-pane fallback puts a pane centred at 0.46 of it — the tag sits at 0.484, inside both.
//   · THE BINS ARE THE POINT, NOT THE COVER. The tag, the bin stack and the vending machine are
//     all placed off the SAME doorway offset, at 0.62, 0.72 and 0.9 of it, so the one patch of wall
//     the kit paints is the one patch of pavement it puts its rubbish on.
//
// Every one of those is silent: the decal is built, uploaded and drawn, the depth test hides it per
// pixel behind the glass or the bin, and the wall reads clean. Exactly the failure direction
// `walltag.mjs` exists for, one layer up — that gate asks whether a PLAYER's paint lands on the
// wall, this one asks whether the wall it lands on can be seen.
//
// ⚠ AREA COVERED, NOT "DO THEY OVERLAP". A tag clipping the jamb of a window by a hair is a
// photograph of any street; a tag with two thirds of it behind the glass is the feature not
// working. The gate is on the share.
//
// ⚠ THE KERB PROPS ARE NOT `faceClaim`s AND MUST NOT BECOME ONE. `clearsFace` answers "is this
// patch of FACADE free for a fitting" and a vending machine is not a fitting — it is not on the
// wall at all. What it is, is opaque, and standing between the wall and the street. Two different
// questions, so this counts both lists rather than widening that one.
import { loadWindshield } from './dom-stub.mjs';

const REPORT = process.argv.includes('--report');
const ws = await loadWindshield();
const FH = 0.4, H = 1;
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const V = (p) => (Array.isArray(p) ? p[0] * FH + p[1] * H + p[2] : (p ?? 0));

// On the wall, in front of the paint: a fitting bolted to the same plane.
const ON_WALL = new Set(['windowBay', 'louvreBank', 'shutter', 'signBoard', 'bladePanel', 'canopy']);
// On the pavement, in front of the paint: opaque, floor-standing, at the height an arm reaches.
const ON_KERB = new Set(['binStack', 'vendingMachine', 'streetLamp', 'bollard']);

// A part's rectangle on the plane it is on, in the SAME frame the tag is in. `face: 'x'` rotates
// the local frame (see the ⚠ on `face` in detailLayer), so a flank part and a front part are only
// comparable once both are labelled with which wall they are on.
function rect(d) {
  const kind = d.kind;
  const w = d.half != null ? V(d.half) : (d.w != null ? V(d.w) : (d.r != null ? V(d.r) : 0));
  if (!(w > 0)) return null;
  const cx = V(d.cx), cy = V(d.cy);
  const z0 = d.z0 != null ? V(d.z0) : V(d.z) - V(d.hh);
  const z1 = d.z1 != null ? V(d.z1) : V(d.z) + V(d.hh);
  // ⚠ A FLOOR-STANDING PROP CENTRES ON `z` AND A BOLTED ONE DOES NOT — `anchored.mjs` records the
  // same split. A bin stack pushed with `z: A(base.z0)` and `hh` rises from the pavement.
  const stands = ON_KERB.has(kind) && d.z0 == null;
  const lo = stands ? V(d.z) : Math.min(z0, z1);
  const hi = stands ? V(d.z) + 2 * V(d.hh) : Math.max(z0, z1);
  // A bollard is pushed as a RUN of `count` at `step`, so its footprint is the whole run.
  const run = (kind === 'bollard' && d.count > 1) ? V(d.step) * (d.count - 1) * 0.5 : 0;
  return { x: d.face === 'x', plane: cy, x0: cx - w - run, x1: cx + w + run, z0: lo, z1: hi };
}

// How much of `t` is hidden by `o`, as a share of `t`'s own area. Planes within 0.06 are the same
// wall as far as anybody looking at the building is concerned — `clearsFace`'s own tolerance — and
// a kerb prop is further out than that on purpose, so it is matched on the wall it stands against
// rather than on its own distance from it.
function covered(t, o, kerb) {
  if (!!t.x !== !!o.x) return 0;
  if (!kerb && Math.abs(t.plane - o.plane) > 0.06) return 0;
  if (kerb && Math.abs(t.plane - o.plane) > 0.2) return 0;
  const ox = Math.max(0, Math.min(t.x1, o.x1) - Math.max(t.x0, o.x0));
  const oz = Math.max(0, Math.min(t.z1, o.z1) - Math.max(t.z0, o.z0));
  const a = (t.x1 - t.x0) * (t.z1 - t.z0);
  return a > 1e-9 ? (ox * oz) / a : 0;
}

// ⚠ THE KIT'S OWN PLACEMENT IS WHAT IS JUDGED, NEVER THE AUTHOR'S. Twelve models carry a
// hand-placed tag and one of them puts it squarely on a roller shutter, which is the single most
// tagged surface in any real city and a deliberate piece of authoring. A gate that scored those
// would be a gate demanding the art be moved. The split is read off the renderer's own flag:
// `RENDER_TUNE.derivedKit = 0` returns the authored list alone and it is in the cache key, so the
// two answers cannot collide. Everything in BOTH lists still blocks — an authored shutter hides the
// kit's paint exactly as the kit's own does.
const authoredOnly = (m, seed) => {
  const was = ws.RENDER_TUNE.derivedKit;
  ws.RENDER_TUNE.derivedKit = 0;
  try { return (ws.derivedTrim(m, FH, H, seed, true) || []).length; } catch { return 0; }
  finally { ws.RENDER_TUNE.derivedKit = was; }
};

const rows = [];
let authoredTags = 0;
for (const { key, m } of ws.shapeModelRegistry()) {
  let n = 0, hidden = 0, worst = 0, sides = { front: 0, back: 0, flank: 0 };
  for (const seed of SEEDS) {
    let list = [];
    try { list = ws.derivedTrim(m, FH, H, seed, true) || []; } catch { continue; }
    const mine = authoredOnly(m, seed);
    const walls = [], kerbs = [];
    for (const d of list) {
      const r = rect(d);
      if (!r) continue;
      if (ON_WALL.has(d.kind)) walls.push(r);
      else if (ON_KERB.has(d.kind)) kerbs.push(r);
    }
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      if (d.kind !== 'tag') continue;
      if (i < mine) { authoredTags++; continue; }
      const t = rect({ ...d, half: d.w });
      if (!t) continue;
      n++;
      // ⚠ WHICH ELEVATION, BY THE SIGN OF THE PLANE. A flank names itself with `face: 'x'`; the
      // street and the back share the other frame and are only told apart by which side of the
      // model origin they are on. The front is +y — `derivedKit` places its facade at
      // `main.cy + main.fd` and calls `main.cy - main.fd` the back, which is the model's own
      // convention rather than a guess. Same reading `elevation.mjs` takes.
      sides[d.face === 'x' ? 'flank' : (t.plane < 0 ? 'back' : 'front')]++;
      // ⚠ THE MAX, NOT THE SUM. Two overlapping occluders would double-count the wall they share
      // and report more than all of it hidden, which is a number nobody can read.
      let c = 0;
      for (const o of walls) c = Math.max(c, covered(t, o, false));
      for (const o of kerbs) c = Math.max(c, covered(t, o, true));
      if (c > 0.25) hidden++;
      worst = Math.max(worst, c);
    }
  }
  rows.push({ key, n, hidden, worst, sides });
}

const tags = rows.reduce((a, r) => a + r.n, 0);
const hid = rows.reduce((a, r) => a + r.hidden, 0);
const front = rows.reduce((a, r) => a + r.sides.front, 0);
const back = rows.reduce((a, r) => a + r.sides.back, 0);
const flank = rows.reduce((a, r) => a + r.sides.flank, 0);
const models = rows.filter((r) => r.n > 0).length;

if (REPORT) {
  rows.filter((r) => r.hidden).sort((a, b) => b.worst - a.worst || b.hidden - a.hidden)
    .slice(0, 30).forEach((r) => console.log(
      `  ${r.key.padEnd(28)} ${String(r.hidden).padStart(2)}/${String(r.n).padStart(2)} obstructed   worst ${(r.worst * 100).toFixed(0)}%`));
  console.log('');
}
console.log(`tagfit: ${tags} tags over ${models} models × ${SEEDS.length} seeds — ${front} street, ${back} back, ${flank} flank`);
console.log(`        ${authoredTags} hand-placed tags alongside them, judged by their author and not by this`);
console.log(`        ${hid} obstructed (>25% of the piece behind glass, a shutter, a board or a bin) = ${(100 * hid / Math.max(tags, 1)).toFixed(1)}%`);

// ── THE TWO FLOORS ──────────────────────────────────────────────────────────
// ⚠ A SHARE, NOT A COUNT, on the obstruction side: the number of tags is meant to move and the
// share of them painted on glass is not. And a REACH floor under it, because the cheapest way to
// pass an obstruction gate is to stop painting.
const MAX_HIDDEN = 0.10;
const MIN_TAGS = 120;
let bad = 0;
if (hid / Math.max(tags, 1) > MAX_HIDDEN) {
  console.error(`FAIL: ${(100 * hid / tags).toFixed(1)}% of the kit's graffiti is behind something (max ${MAX_HIDDEN * 100}%)`);
  bad++;
}
if (tags < MIN_TAGS) {
  console.error(`FAIL: only ${tags} tags over the registry (floor ${MIN_TAGS}) — the kit has stopped painting`);
  bad++;
}
if (!bad) console.log('tagfit: OK');
process.exit(bad ? 1 : 0);
