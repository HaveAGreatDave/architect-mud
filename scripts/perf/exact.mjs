// exact: does a RENDER_TUNE switch change what the frame draws?
//
//   node scripts/perf/exact.mjs flatSkip            # off = 0, on = 1
//   node scripts/perf/exact.mjs groundCache 0 1
//   node scripts/perf/exact.mjs decoFast 0 1 --quick   # 12 views instead of 60
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
// Not a gate: it takes a switch to test. It exits 1 if anything differs, and prints the first few.
import { openScene, PLACES } from './scene.mjs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const key = args[0];
const parse = (v, d) => (v == null ? d : v === 'true' ? true : v === 'false' ? false : Number.isFinite(+v) ? +v : v);
const offV = parse(args[1], 0), onV = parse(args[2], 1);
if (!key) { console.error('usage: node scripts/perf/exact.mjs <tuneKey> [off=0] [on=1] [--quick]'); process.exit(2); }
const quick = process.argv.includes('--quick');

const near = (a, b) => {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => near(x, b[i]));
  if (a && typeof a === 'object') {
    if (!b || typeof b !== 'object') return false;
    if (a.getContext || b.getContext) return !!(a.getContext && b.getContext);   // a texture canvas: same kind is enough
    // Fields starting with _ are a record's own cache bookkeeping (a frame id, a solved copy), never drawn.
    const ka = Object.keys(a).filter((k) => a[k] !== undefined && k[0] !== '_'), kb = Object.keys(b).filter((k) => b[k] !== undefined && k[0] !== '_');
    return ka.length === kb.length && ka.every((k) => near(a[k], b[k]));
  }
  return false;
};
const snap = (sinks) => Object.fromEntries(Object.entries(sinks || {}).map(([k, v]) => [k, (v || []).map((q) => ({ ...q }))]));

const scene = await openScene();
const places = quick ? ['halcyon', 'oldcoldwater'] : Object.keys(PLACES);
const headings = quick ? [20, 200] : [20, 140, 260];
const hours = quick ? [13] : [13, 22];
let views = 0, bad = 0;
const shown = [];
try {
  for (const place of places) for (const seat of ['cab', 'cockpit']) for (const hour of hours) for (const heading of headings) {
    const v = scene.view(place, seat, { hour, heading });
    const side = (val) => {
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
      const i = A.findIndex((q, j) => !near(q, B[j]));
      if (i >= 0) diffs.push(`${k}[${i}] differs: ${JSON.stringify(A[i]).slice(0, 160)} vs ${JSON.stringify(B[i]).slice(0, 160)}`);
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
