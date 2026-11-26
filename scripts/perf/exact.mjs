// exact: does a RENDER_TUNE switch change what the frame draws?
//
//   node scripts/perf/exact.mjs flatSkip            # off = 0, on = 1
//   node scripts/perf/exact.mjs groundCache 0 1
//   node scripts/perf/exact.mjs decoFast 0 1 --quick   # 12 views instead of 60
//   node scripts/perf/exact.mjs campWorld --layers     # only the fields the GL layers read
//
// For a performance change that is meant to draw exactly what it replaces. Paints the same views with
// the switch off and on and compares every sink the frame hands the GPU (sprites, strokes, decals,
// scatter, ground, bay, curtain, ship) and every canvas call with its arguments. Numbers are compared
// to 1e-9, which allows rounding and nothing else. Clocks are frozen (scene.mjs), so a clock-animated
// mark draws the same in both.
//
// ⚠ EACH SIDE PAINTS THREE TIMES AND ONLY THE THIRD IS COMPARED. The first frame after a tune
// change paints twice (every call doubled, clearRect included), and a record-and-replay cache needs
// two recordings before it replays. A comparison of first frames measures neither.
//
// `--layers` leaves out a record's CPU fallbacks that no layer reads once the GPU does the job: a
// decal's pulled `p` and a stroke's pulled `a`/`b` when it carries its pull (`pl`) and raw corners,
// and a sprite's radius `r` when it carries a size spec (`sz`). A kept set (armKeep, campKeep) holds
// them from the frame it was recorded at, so a switch that changes which recording a view replays
// differs there and nowhere the picture can see.
//
// `--without=lock,aa,statue,lot` takes those marks off the map first (see below).
//
// `--cloth` puts flags, socks and tents on the GL cloth path, as the game's GL pass does, and compares
// their records as well (`cloth`). Without it windFlag and the camps never reach FAUNA_SINK.
//
// Not a gate: it takes a switch to test. It exits 1 if anything differs, and prints the first few.
import { openScene, PLACES } from './scene.mjs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const key = args[0];
const parse = (v, d) => (v == null ? d : v === 'true' ? true : v === 'false' ? false : Number.isFinite(+v) ? +v : v);
const offV = parse(args[1], 0), onV = parse(args[2], 1);
if (!key) { console.error('usage: node scripts/perf/exact.mjs <tuneKey> [off=0] [on=1] [--quick]'); process.exit(2); }
const quick = process.argv.includes('--quick');
const layers = process.argv.includes('--layers');
const unordered = process.argv.includes('--unordered');
// `--lifts`: every footbridge lift in each view set going up 2.5 s before the frozen clock, so the cars are mid-ride
// (a still clock otherwise only ever shows them at rest). For kitCarsGPU, whose cars are moved on the GPU.
const lifts = process.argv.includes('--lifts');
const { kitLiftCall } = lifts ? await import('../../client/game/js/panels/glass/street-kit.js') : {};
const unread = (o, k) => layers && ((o.sz && o.sz[0] > 0 && k === 'r') || (o.pl > 0 && ((o.rp && k === 'p') || (o.ra && (k === 'a' || k === 'b')))));

const near = (a, b) => {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => near(x, b[i]));
  if (a && typeof a === 'object') {
    if (!b || typeof b !== 'object') return false;
    if (a.getContext || b.getContext) return !!(a.getContext && b.getContext);   // a texture canvas: same kind is enough
    // Fields starting with _ are a record's own cache bookkeeping (a frame id, a solved copy), never drawn.
    const ka = Object.keys(a).filter((k) => a[k] !== undefined && k[0] !== '_' && !unread(a, k)), kb = Object.keys(b).filter((k) => b[k] !== undefined && k[0] !== '_' && !unread(b, k));
    return ka.length === kb.length && ka.every((k) => near(a[k], b[k]));
  }
  return false;
};
const scene = await openScene({ cloth: process.argv.includes('--cloth') });
// `--without lock,aa,...` takes those marks off the map (the cell keeps its ground; `lot` also takes the
// media lot's walls off the buildings they stand on), so a switch meant to touch only them can be
// shown to touch nothing else: with them gone, its 0 and 1 have to be identical.
const withoutArg = process.argv.find((a) => a.startsWith('--without='));
const without = new Set(withoutArg ? withoutArg.slice(10).split(',').filter(Boolean) : []);
const strip = (c) => { const o = { ...c }; if (without.has(o.mark)) { delete o.mark; delete o.lk; delete o.aa; } if (without.has('lot')) delete o.ml; return o; };
// A replayed road tile reaches the ground sink as one block (groundGPU), whose fade and kerb width
// the vertex shader applies; expandGroundBlocks is the same sums on the CPU, so the ground compares
// record for record either way.
const expand = (k, v) => (k === 'ground' && scene.ws.expandGroundBlocks ? scene.ws.expandGroundBlocks(v) : v);
// ⚠ THE POINTS ARE COPIED TOO. The street kit's moving parts near to come from a pool reset every paint (KIT_POOL), so
// a shallow copy of the first side's records read the second side's points by the time they were compared.
const cp = (x) => (Array.isArray(x) ? x.map(cp) : x);
const snap = (sinks) => Object.fromEntries(Object.entries(sinks || {}).map(([k, v]) => [k, (expand(k, v) || []).map((q) => { const o = { ...q }; for (const f of ['p', 'n', 'a', 'b', 'ra', 'rb', 'rp', 'rc']) if (Array.isArray(o[f])) o[f] = cp(o[f]); return o; })]));
const places = quick ? ['halcyon', 'oldcoldwater'] : Object.keys(PLACES);
const headings = quick ? [20, 200] : [20, 140, 260];
const hours = quick ? [13] : [13, 22];
let views = 0, bad = 0;
const shown = [];
try {
  for (const place of places) for (const seat of ['cab', 'cockpit']) for (const hour of hours) for (const heading of headings) {
    const v = scene.view(place, seat, { hour, heading });
    if (lifts) { const R = (v.map.length - 1) / 2, [X, Y] = PLACES[place]; for (let j = 0; j < v.map.length; j++) for (let i = 0; i < v.map.length; i++) { const wx = X + i - R, wy = Y + j - R, seed = wx * 73 + wy * 149; for (const k of [seed, seed - 73, seed - 149]) kitLiftCall(k, 'call-top', 1e6 - 2500); } }
    if (without.size) v.map = v.map.map((row) => row.map((c) => (c && (without.has(c.mark) || (c.ml && without.has('lot'))) ? strip(c) : c)));
    // ⚠ BOTH SIDES START FROM THE SAME CACHES. Every RENDER_TUNE value is in the key of the kept kit
    // sets, arms and ground tiles (tuneSig), so the side whose switch just changed recorded them in
    // this view while the other replayed what the previous view recorded: any switch, even one
    // nothing reads, showed 13 of 60 views differing. A key nothing reads, bumped before each side,
    // has both record afresh here. `--carry` leaves the bump out. A replay recorded from another
    // heading differs then only in the CPU fallbacks (a stroke's pulled `a`/`b`, a light's `r`),
    // which no layer reads with glSizeGPU on: `--carry --layers` is identical (2026-11-22).
    const side = (val) => {
      if (!process.argv.includes('--carry')) scene.ws.RENDER_TUNE.__exactSide = (scene.ws.RENDER_TUNE.__exactSide || 0) + 1;
      scene.ws.RENDER_TUNE[key] = val;
      scene.paint(v); scene.paint(v); scene.takeLog();
      const sinks = snap(scene.paint(v));
      return { sinks, log: scene.takeLog() };
    };
    const a = side(offV), b = side(onV);
    views++;
    const diffs = [];
    for (const k of new Set([...Object.keys(a.sinks), ...Object.keys(b.sinks)])) {
      const A = a.sinks[k] || [], B = b.sinks[k] || [];
      if (A.length !== B.length) { diffs.push(`${k}: ${A.length} records off, ${B.length} on`); continue; }
      // `--unordered`: the same records in any order, for a switch that only moves records along a sink
      // (kitPartsKeep sends the lift cars after the cameras). Sorted by their JSON with numbers to 1e-9.
      if (unordered) {
        // A pooled kit record carries its defaults (film false, n null, amb false, tex 0) where a kept one leaves them
        // out; the solids layer reads both alike.
        const DEF = { film: false, n: null, amb: false, tex: 0 };
        for (const L of [A, B]) for (let j = 0; j < L.length; j++) {
          const q = L[j]; if (!q || typeof q !== 'object') continue;
          let c = null; for (const d in DEF) if (d in q && q[d] === DEF[d]) { c = c || { ...q }; delete c[d]; }
          if (c) L[j] = c;
        }
        const key = (q) => JSON.stringify(q, (_, x) => (typeof x === 'number' ? Math.round(x * 1e9) / 1e9 : x));
        // Each record's key made once: in the comparator it was made twice a comparison, minutes over 60 views.
        const by = (L) => L.map((q) => [key(q), q]).sort((p, q) => (p[0] < q[0] ? -1 : p[0] > q[0] ? 1 : 0)).map((e) => e[1]);
        const As = by(A), Bs = by(B); A.length = 0; B.length = 0; A.push(...As); B.push(...Bs);
      }
      const i = A.findIndex((q, j) => !near(q, B[j]));
      if (i >= 0) diffs.push(`${k}[${i}] differs: ${JSON.stringify(A[i]).slice(unordered ? -200 : 0, unordered ? undefined : 160)} vs ${JSON.stringify(B[i]).slice(unordered ? -200 : 0, unordered ? undefined : 160)}`);
    }
    if (a.log.length !== b.log.length) diffs.push(`canvas: ${a.log.length} calls off, ${b.log.length} on`);
    else { const i = a.log.findIndex((s, j) => s !== b.log[j]); if (i >= 0) diffs.push(`canvas call ${i}: ${a.log[i]} vs ${b.log[i]}`); }
    if (diffs.length) { bad++; if (shown.length < 6) shown.push(`${place} ${seat} ${hour}h ${heading}°: ${diffs[0]}`); }
  }
} finally {
  scene.close();
}
for (const s of shown) console.error('  ✗ ' + s);
if (bad) { console.error(`exact: ${key} ${offV} → ${onV}: ${bad} of ${views} views differ.`); process.exit(1); }
console.log(`✓ exact: ${key} ${offV} → ${onV}: identical sinks and canvas calls over ${views} views.`);
