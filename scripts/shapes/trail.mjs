// THE TRAIL COMMIT RULES, TESTED DIRECTLY.
//
// `client/shared/trail-store.js` holds the five rules that decide where a mark gets laid — the
// provisional head, the early bend, the creep floor, the second point opening on first movement,
// and the spent point leaving. Every one of them was a visible defect in the snow tracks first.
//
// ⚠ AND ONLY ONE OF THE FIVE HAD A GATE. Mutation-testing the extraction through `gl:snow` caught
// the bend and NOT the other two that were tried: freezing the head and deleting the eviction both
// left that suite green. They are not snow's claims to make — `gl:snow` asserts a gauge moves with
// the rig, that a bend costs more points, and that a fall buries a rut, which is the right list for
// snow and blind to the geometry underneath it.
//
// ⚠ THE REASON THIS CAN EXIST AT ALL IS THAT THE MODULE IS PURE. No DOM, no GL, no clock of its
// own: everything time-dependent arrives as an argument. Before the extraction the only way to
// exercise any of this was to render a frame, and no harness in this repo reaches a draw call.
import { layTrailPoint, uploadTrail } from '../../client/shared/trail-store.js';

const ok = [], fail = [];
const CFG = {
  fill: (q, now) => (now - q.t) / 10000,
  stamp: null, step: 0.55, turn: 0.14, creep: 0.06, perSrc: 64, srcMax: 10,
};
const cfg = (now, over = {}) => ({ ...CFG, now, stamp: () => ({ t: now }), ...over });

// Walk a source along a path, one call per sample, the way a frame does.
function walk(pts, { dt = 16, over = {} } = {}) {
  const store = new Map();
  let now = 1e6;
  for (const [x, y] of pts) { layTrailPoint(store, 'a', x, y, cfg(now, over)); now += dt; }
  return { store, src: store.get('a'), now };
}

// ── 1. THE HEAD IS PROVISIONAL AND FOLLOWS THE SOURCE ─────────────────────────────────────────
{
  // Six samples inside one step. The stored polyline must not grow past its opening pair, and the
  // head must sit on the LAST sample — not on the one where it was first committed.
  const path = [];
  for (let i = 0; i <= 6; i++) path.push([i * 0.05, 0]);
  const { src } = walk(path);
  const head = src.pts[src.pts.length - 1];
  if (src.pts.length > 2) fail.push(`a head inside one step committed ${src.pts.length} points — it should be dragged, not pushed`);
  else ok.push(`six samples inside one step keep ${src.pts.length} points`);
  if (Math.abs(head.x - 0.30) > 1e-9) fail.push(`the head is at x=${head.x.toFixed(3)} and the source is at 0.300 — the mark is lagging behind the thing making it`);
  else ok.push('the live head sits on the source, not where it was last committed');
}

// ── 2. A BEND COSTS MORE POINTS THAN A STRAIGHT OF THE SAME LENGTH ────────────────────────────
{
  // ⚠ THE RADIUS HAS TO BE A JUNCTION'S, NOT A MOTORWAY'S. A first cut swept 90 degrees over six
  // tiles, which is 8.25 degrees of turn per committed step against a threshold of 8 — so it sat on
  // the knife edge and reported 13 points against 13, failing a rule that works. What a vehicle
  // actually does at a corner is about a tile and a half of radius, where the turn per step is 21
  // degrees and the rule has something to bite on.
  const R = 1.5, LEN = R * (Math.PI / 2), N = 60, SEG = LEN / N;
  const straight = [];
  for (let i = 0; i <= N; i++) straight.push([i * SEG, 0]);
  const arc = [];
  for (let i = 0; i <= N; i++) { const a = (i / N) * (Math.PI / 2); arc.push([Math.sin(a) * R, R - Math.cos(a) * R]); }
  const s = walk(straight).src.pts.length, b = walk(arc).src.pts.length;
  if (!(b > s)) fail.push(`a right-angle bend committed ${b} points against a straight's ${s} — a corner drawn in straight lines`);
  else ok.push(`a 90deg bend costs ${b} points against ${s} for the same arc length`);
  // And the worst kink has to be small, or "more points" is satisfied by a corner still visibly
  // faceted. This is the number the rule exists to bring down.
  const p = walk(arc).src.pts; let worst = 0;
  for (let i = 2; i < p.length; i++) {
    const ax = p[i - 1].x - p[i - 2].x, ay = p[i - 1].y - p[i - 2].y;
    const bx = p[i].x - p[i - 1].x, by = p[i].y - p[i - 1].y;
    if (Math.hypot(ax, ay) < 1e-9 || Math.hypot(bx, by) < 1e-9) continue;
    worst = Math.max(worst, Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by)) * 180 / Math.PI);
  }
  if (worst > 15) fail.push(`the worst kink round a bend is ${worst.toFixed(1)}deg — visibly faceted`);
  else ok.push(`the worst kink round a 90deg bend is ${worst.toFixed(1)}deg`);
}

// ── 3. THE CREEP FLOOR ────────────────────────────────────────────────────────────────────────
{
  // Shuffling on the spot swings the heading through a large angle over no distance, which without
  // a minimum spacing fills the whole buffer with points inside the source's own width.
  // ⚠ IT HAS TO DRIVE IN FIRST, or the test cannot reach the rule it is about. The turn term is the
  // angle between the segment behind the anchor and the one being dragged, so with fewer than three
  // stored points it is 0 and NOTHING can commit early — a shuffle from a standing start is held by
  // that instead, and deleting the creep floor leaves it green. Four points of straight first, then
  // the shuffle, is the arrangement where the floor is the only thing holding.
  const path = [];
  for (let i = 0; i <= 4; i++) path.push([i * 0.6, 0]);
  const cx0 = 2.4;
  for (let i = 0; i < 400; i++) path.push([cx0 + Math.cos(i * 1.7) * 0.01, Math.sin(i * 1.7) * 0.01]);
  const { src } = walk(path);
  if (src.pts.length > 8) fail.push(`shuffling on the spot committed ${src.pts.length} points — the creep floor is not holding`);
  else ok.push(`400 samples inside one width after a run keep ${src.pts.length} points`);
}

// ── 4. THE SECOND POINT OPENS ON FIRST MOVEMENT ───────────────────────────────────────────────
{
  // With one point there is no segment and nothing is drawn, so waiting for a full step leaves the
  // start of every run unmarked.
  const { src } = walk([[0, 0], [0.02, 0]]);
  if (src.pts.length < 2) fail.push('one movement did not open a second point — the start of every run is unmarked');
  else ok.push('the second point opens on the first movement rather than at a full step');
}

// ── 5. A SPENT POINT LEAVES THE STORE, OLDEST FIRST ───────────────────────────────────────────
{
  const store = new Map();
  let now = 1e6;
  for (let i = 0; i < 12; i++) { layTrailPoint(store, 'a', i * 0.6, 0, cfg(now)); now += 900; }
  const before = store.get('a').pts.length;
  // Far enough forward that the early points are spent (fill >= 1 at 10 s).
  now += 11000;
  layTrailPoint(store, 'a', 99, 0, cfg(now));
  const after = store.get('a').pts.length;
  if (!(after < before)) fail.push(`spent points are not evicted (${before} -> ${after}) — a session accumulates every path it has taken`);
  else ok.push(`spent points leave the store (${before} -> ${after})`);
  // ⚠ OLDEST FIRST, which is what makes a single shift() correct: the list is in the order it was
  // laid and `fill` only ever rises, so the front is always the most spent.
  const pts = store.get('a').pts;
  let mono = true;
  for (let i = 1; i < pts.length; i++) if (pts[i].t < pts[i - 1].t) mono = false;
  if (!mono) fail.push('the store is not in the order it was laid — the front of it is not the most spent');
  else ok.push('the store stays in lay order, so the most spent point is always at the front');
}

// ── 6. RUNS STAY CONTIGUOUS ACROSS SOURCES ────────────────────────────────────────────────────
{
  // A segment is a PAIR, so a budget spent on the nearest POINTS regardless of source interleaves
  // two sources and draws a line from one to the other.
  const store = new Map();
  let now = 1e6;
  for (let i = 0; i < 6; i++) { layTrailPoint(store, 'a', i * 0.6, 0, cfg(now)); layTrailPoint(store, 'b', i * 0.6, 4, cfg(now)); now += 16; }
  const buf = new Float32Array(64 * 4);
  const up = uploadTrail(store, { buf, maxPts: 64, cx: 0, cy: 0, lim: 40, now, fill: CFG.fill, jump: 2.75 });
  if (!up) { fail.push('two sources uploaded nothing'); }
  else {
    // Walk the packed runs: wherever a point joins the next, the two must be from the same source
    // — which here means they must not straddle the 4-tile gap between the lanes.
    let straddle = 0;
    for (let i = 0; i < up.n - 1; i++) {
      if (buf[i * 4 + 3] < 0.5) continue;
      if (Math.abs(buf[i * 4 + 1] - buf[(i + 1) * 4 + 1]) > 2) straddle++;
    }
    if (straddle) fail.push(`${straddle} packed segment(s) join one source to another — a line drawn between two vehicles`);
    else ok.push(`two sources pack as ${up.n} points with no segment joining one to the other`);
  }
}

// ── 7. A JUMP BREAKS THE RUN AND KEEPS THE POINT ──────────────────────────────────────────────
{
  const store = new Map();
  let now = 1e6;
  const path = [[0, 0], [0.6, 0], [1.2, 0], [20, 0], [20.6, 0], [21.2, 0]];
  for (const [x, y] of path) { layTrailPoint(store, 'a', x, y, cfg(now)); now += 16; }
  const buf = new Float32Array(64 * 4);
  const up = uploadTrail(store, { buf, maxPts: 64, cx: 10, cy: 0, lim: 40, now, fill: CFG.fill, jump: 2.75 });
  if (!up) fail.push('a jumped run uploaded nothing');
  else {
    let gouge = 0;
    for (let i = 0; i < up.n - 1; i++) {
      if (buf[i * 4 + 3] < 0.5) continue;
      if (Math.abs(buf[i * 4] - buf[(i + 1) * 4]) > 5) gouge++;
    }
    if (gouge) fail.push(`${gouge} segment(s) span the jump — one straight gouge drawn between two places the source never went`);
    else ok.push('a jump breaks the run rather than being joined up');
    // ⚠ AND THE POINT SURVIVES: skipping it as well loses the FIRST point of every new run, which
    // over a session of something leaving and re-entering range is most of what it ever laid.
    if (up.n < path.length) fail.push(`the jump dropped a point (${up.n} of ${path.length}) — every re-entry starts late`);
    else ok.push(`all ${up.n} points survive the jump`);
  }
}

for (const m of ok) console.log('  ✓ ' + m);
if (fail.length) {
  console.log('\n✗ trail — ' + fail.length + ' problem(s):');
  for (const m of fail) console.log('  ' + m);
  process.exit(1);
}
console.log('\n✓ trail — the head is dragged, a bend commits early, a shuffle is ignored, a spent mark leaves, and a run never joins another.');
