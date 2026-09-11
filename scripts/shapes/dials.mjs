// dials — the two adaptive-quality dials, and the dither neither of them was allowed to have.
//
//   node scripts/shapes/dials.mjs
//   node scripts/shapes/dials.mjs --detail     # the per-frame trace for each case
//
// `paintWindshield` quantises two moving averages every frame: the canvas resolution to 0.1 steps,
// and the Mode-7 ground raster's downscale to whole ones. Rounding a moving average is bistable at
// every boundary — a frame time that parks near a step puts the value either side of it and the
// quantised answer changes about twice a second for as long as the load holds — and each change
// re-renders the whole scene at a different sample density. On lane markings and kerbs that reads
// as the road blinking between light levels, which is exactly how it was reported.
//
// ⚠ THE REASON THIS DID NOT EXIST IS THE REASON IT HAD TO. Every timing harness in this repo pins
// both dials by hand (`resFloor: 1`, `perfDS: 0`) for the good reason that a loose dial sheds
// resolution where the frame is expensive and gets read as the renderer. So a bug driven BY a dial
// is invisible to all of them at once: four separate headless reproductions of the blinking road
// came back perfectly flat because the harness had the dial disabled. This one exists to run them
// LOOSE, and it is the only thing in the repo that does.
//
// ⚠ AND A DEADBAND TEST PASSES FOR THE WRONG REASON IF THE TRACE DOES NOT DITHER. "The step
// changed once" is also what you get from a trace that never went near a boundary. So every case
// computes the NAIVE answer — the expression that shipped — over the same recorded dial values and
// reports both: the naive count is what makes the damped count mean anything.
import { loadWindshield, stubCanvas } from './dom-stub.mjs';

const DETAIL = process.argv.includes('--detail');
const W = 640, H = 360;

const ws = await loadWindshield();

const R = 12, N = R * 2 + 1;
const map = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => (
  x === R ? { kind: 'land', biome: 'citycore', road: 1, rd: 'ns', flr: 0, pw: 1 }
  : { kind: 'land', biome: 'citycore', flr: 0 }
)));
const VIEW = {
  cls: 'truck', phase: 'cruise', worldBlend: 1, height: 0, eyeH: 0.12, hour: 13,
  weather: 'clear', speed: 0.4, map, heading: 0,
  mapCenter: { x: 100, y: 100 }, mapOffset: { x: 0, y: 0 },
};

// The quantisers, restated because the smoke has to compute the naive answer the deadband
// replaced. Everything else about the dials is read back out of `lastViewState()`.
const TENTHS = (x) => Math.round(x * 10) / 10;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const NAIVE_DS = (frameMs) => Math.round(clamp((frameMs - 24) / 8, 0, 4));

// ── DRIVING THE CLOCK ───────────────────────────────────────────────────────
//
// Both dials are EMAs over `performance.now()` deltas, so a trace is a list of frame times fed one
// at a time. `ms(i)` is the frame time the renderer should SEE on frame i — the harness advances a
// fake clock by exactly that much before each paint.
function trace(id, frames, ms) {
  stubCanvas(id, W, H);
  const real = globalThis.performance;
  let t = 1e6;
  globalThis.performance = { ...real, now: () => t };
  const rows = [];
  try {
    for (let i = 0; i < frames; i++) {
      t += ms(i);
      ws.paintWindshield(id, VIEW);
      const s = ws.lastViewState();
      rows.push({ frameMs: s.frameMs, resScale: s.resScale, resStep: s.resStep, perfDS: s.perfDS });
    }
  } finally { globalThis.performance = real; }
  return rows;
}

// Changes after a warm-up, because the first frames are the EMAs climbing from their seed and any
// dial is entitled to move then. The dither is what happens AFTER a load has settled.
const WARM = 90;
function changes(rows, pick) {
  let n = 0, prev = pick(rows[WARM]);
  for (let i = WARM + 1; i < rows.length; i++) {
    const v = pick(rows[i]);
    if (v !== prev) { n++; prev = v; }
  }
  return n;
}

const problems = [];
const report = [];

// ── 1. THE HELPER'S OWN PROPERTIES ──────────────────────────────────────────
//
// Three things that are cheap to assert and expensive to discover.
const { deadbandStep } = ws;
if (typeof deadbandStep !== 'function') problems.push('deadbandStep is not exported — nothing below can run');
else {
  // It adopts on the first frame rather than sitting at some default.
  if (deadbandStep(null, 0.83, TENTHS, 0.075) !== 0.8) problems.push('deadbandStep did not adopt on the first frame');
  // It holds inside the band and moves outside it. A band that never released would freeze the
  // dial at whatever step the first frame happened to land on, which is a worse bug than the
  // dither and looks like nothing at all until the machine is under real load.
  if (deadbandStep(0.9, 0.86, TENTHS, 0.075) !== 0.9) problems.push('deadbandStep left its step inside the band');
  if (deadbandStep(0.9, 0.80, TENTHS, 0.075) !== 0.8) problems.push('deadbandStep held its step past the band — the dial is frozen, not damped');
  // ⚠ THE QUANTISER GOES IN AS A FUNCTION AND THIS IS WHY. `Math.round(x * 10) / 10` and
  // `Math.round(x / 0.1) * 0.1` disagree at 0.95, because 0.95 / 0.1 is 9.499999999999998 — one
  // gives native resolution and the other gives 0.9, at the boundary just under native, which is
  // where this dial spends most of its life. Taking a step size would have been the obvious
  // tidy-up and would have cost the top of the range.
  if (TENTHS(0.95) !== 1) problems.push('the tenths quantiser no longer rounds 0.95 up — the dial has changed shape');
  if (Math.round(0.95 / 0.1) * 0.1 === 1) problems.push('the float trap this guards is gone; the note in deadbandStep is now wrong');
}

// ── 2. THE RESOLUTION DIAL, PARKED ON A BOUNDARY ────────────────────────────
//
// resTarget = 1 - (frameMs - 20) / 44, so 26.6 ms sits the dial exactly on 0.85 — the worst place
// for it to be. The jitter is a couple of milliseconds either way, which is an ordinary hitchy
// frame and not a contrived one.
{
  const rows = trace('__dial_res', 320, (i) => 26.6 + Math.sin(i * 0.7) * 2.2 + Math.sin(i * 0.13) * 1.1);
  const damped = changes(rows, (r) => r.resStep);
  const naive = changes(rows, (r) => TENTHS(r.resScale));
  report.push(`resolution @26.6ms: naive ${naive} changes, damped ${damped}`);
  if (naive < 4) problems.push(`the resolution trace did not dither (naive changed ${naive} times) — this case proves nothing`);
  else if (damped > 1) problems.push(`the resolution step still dithers: ${damped} changes over ${rows.length - WARM} settled frames (naive ${naive})`);
  if (DETAIL) console.log(rows.slice(WARM, WARM + 24).map((r) => `${r.frameMs} → ${r.resScale.toFixed(4)} → ${r.resStep}`).join('\n'));
}

// ── 3. THE MODE-7 DOWNSCALE, PARKED ON A BOUNDARY ───────────────────────────
//
// PERF_DS is (frameMs - 24) / 8 rounded, so 28 ms sits it exactly on 0.5. This is the dial that
// had no deadband at all, and it has been INERT since the floor moved to the GPU — drawMode7Floor
// returns before the raster whenever `glFloor` is on — which means it is armed on exactly the
// machines that fall back to the software floor and nowhere a bench would ever look.
{
  const rows = trace('__dial_ds', 320, (i) => 28 + Math.sin(i * 0.61) * 2.6 + Math.sin(i * 0.11) * 1.3);
  const damped = changes(rows, (r) => r.perfDS);
  const naive = changes(rows, (r) => NAIVE_DS(r.frameMs));
  report.push(`mode-7 downscale @28ms: naive ${naive} changes, damped ${damped}`);
  if (naive < 4) problems.push(`the downscale trace did not dither (naive changed ${naive} times) — this case proves nothing`);
  else if (damped > 1) problems.push(`the mode-7 downscale still dithers: ${damped} changes over ${rows.length - WARM} settled frames (naive ${naive})`);
  if (DETAIL) console.log(rows.slice(WARM, WARM + 24).map((r) => `${r.frameMs} → ds ${r.perfDS}`).join('\n'));
}

// ── 4. AND BOTH DIALS STILL WORK ────────────────────────────────────────────
//
// A deadband that never releases sheds no load at all, and the frame it was defending is gone. So
// a genuine ramp — a machine going from comfortable to badly overloaded and back — has to move
// both dials over their whole range and return them.
{
  const rows = trace('__dial_ramp', 460, (i) => {
    const k = i / 230;                                   // 0..2 over the run
    const up = k <= 1 ? k : 2 - k;                       // out to the far end and back
    return 14 + up * 34;                                 // 14 ms → 48 ms → 14 ms
  });
  const res = new Set(rows.slice(WARM).map((r) => r.resStep));
  const ds = new Set(rows.slice(WARM).map((r) => r.perfDS));
  report.push(`ramp 14→48→14ms: resolution visited ${[...res].sort().join('/')}, downscale visited ${[...ds].sort().join('/')}`);
  if (res.size < 3) problems.push(`the resolution dial barely moved over a 14→48 ms ramp (${[...res].join('/')}) — the band is holding it, not damping it`);
  if (ds.size < 3) problems.push(`the mode-7 downscale barely moved over a 14→48 ms ramp (${[...ds].join('/')}) — the band is holding it, not damping it`);
  // It has to come back down too. A dial that only ever sheds quality is a machine that never
  // recovers from one bad second.
  const last = rows[rows.length - 1];
  if (!(last.resStep >= 0.9)) problems.push(`the resolution dial did not recover: ended at ${last.resStep} after the load came off`);
  if (last.perfDS !== 0) problems.push(`the mode-7 downscale did not recover: ended at +${last.perfDS} after the load came off`);
}

if (problems.length) {
  console.error('\n✗ dials — ' + problems.length + ' problem(s):');
  for (const p of problems) console.error('  ' + p);
  for (const r of report) console.error('  · ' + r);
  process.exit(1);
}
console.log('✓ dials: ' + report.join('; ') + '.');
