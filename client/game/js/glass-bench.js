// ── __glassBench(): A REPEATABLE PAINT NUMBER FROM THE SEAT YOU'RE IN ────────────────────────────
//
// For a phone over Chrome remote DevTools (USB), where the Modelshop's `__glWhere` can't run:
//
//   await __glassBench()                     // 60 paints of the seat on screen
//   await __glassBench({ frames: 120 })      // more paints, steadier percentiles
//   await __glassBench({ passes: false })    // skip the GPU pass timing
//
// Park the vehicle and keep the camera still first. The bench doesn't move the camera: a seat's
// view object lives in the seat's own panel, and windshield.js keeps none of it. So it measures the
// seat's own next `frames` paints, through the same paint tap the feedback summary uses
// (fps-meter.js), and says whether the pose held (`still`). A still seat at the same place and hour
// gives the same number to within a millisecond or two, which is what makes it comparable.
//
// Then, on GLASS 2 with EXT_disjoint_timer_query_webgl2, it times each GPU pass over another
// `passFrames` paints with `glPassTimer` (gl/context.js), loaded only now. That runs after the CPU
// window, so the timer queries don't land in the paint numbers. Results arrive a few frames late,
// and a disjoint reading (the GPU clock jumped) comes back as null.
//
// The result is also kept for the next ⚑ report (`glass.bench` in its telemetry).
import { seatPaints, seatSamples, spread, glassSummary, setLastBench } from './fps-meter.js';
import { isLoaded, lastViewState } from './panels/windshield-lazy.js';

const MAX_FRAMES = 240;   // the seat ring's length

function pose() {
  const lv = isLoaded() ? lastViewState() : null;
  if (!lv) return null;
  const o = lv.mapOffset || {};
  return { id: lv.id, heading: lv.heading, height: lv.height, x: o.x || 0, y: o.y || 0, W: lv.W, H: lv.H, dpr: lv.dpr };
}

const moved = (a, b) => !a || !b || a.id !== b.id || Math.abs((a.heading || 0) - (b.heading || 0)) > 0.5
  || Math.abs(a.height - b.height) > 1e-3 || Math.abs(a.x - b.x) > 1e-3 || Math.abs(a.y - b.y) > 1e-3;

// Resolves once the seat has painted `k` more times, or with false after `ms`.
function paints(k, ms) {
  const { id, total } = seatPaints();
  const t0 = performance.now();
  return new Promise((resolve) => {
    const step = () => {
      const s = seatPaints();
      if (s.id !== id) return resolve(false);   // the seat changed under us
      if (s.total - total >= k) return resolve(true);
      if (performance.now() - t0 > ms) return resolve(false);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

async function gpuPasses(frames) {
  let ctx;
  try { ctx = await import('./panels/gl/context.js'); } catch { return null; }
  ctx.glPassTimer(true);
  let t = null;
  try { await paints(frames, frames * 200 + 2000); }
  finally { t = ctx.glPassTimer(false); }
  const ms = await ctx.glPassTimes(t);
  if (!ms) return null;
  return Object.fromEntries(Object.entries(ms).map(([k, v]) => [k, +(v / frames).toFixed(3)]).sort((a, b) => b[1] - a[1]));
}

export async function glassBench(opts = {}) {
  const frames = Math.max(10, Math.min(MAX_FRAMES, opts.frames | 0 || 60));
  const passFrames = Math.max(10, Math.min(MAX_FRAMES, opts.passFrames | 0 || 30));
  const s = seatPaints();
  if (!s.id || performance.now() - s.lastAt > 1000) {
    console.warn('__glassBench: no seat is painting. Sit in a vehicle (or a free camera) and try again.');
    return null;
  }
  // Warm-up: a seat that has just opened is still compiling and packing its atlas.
  if (opts.warm !== 0) await paints(opts.warm || 10, 5000);
  const p0 = pose(), d0 = glassSummary();
  const ok = await paints(frames, frames * 200 + 2000);
  const p1 = pose();
  if (!ok) { console.warn('__glassBench: the seat stopped painting or changed mid-run.'); return null; }
  const { paint, gap } = seatSamples(frames);
  const pm = spread(paint), fm = spread(gap);
  const mean = gap.length ? gap.reduce((a, b) => a + b, 0) / gap.length : 0;
  const passes = opts.passes !== false && window.__wsTune?.gl ? await gpuPasses(passFrames) : null;
  const d1 = glassSummary();
  const out = {
    at: new Date().toISOString(),
    seat: s.id, frames,
    // The paint's CPU ms: the whole of paintWindshield, the GL submission included. Not the GPU.
    paintMs: pm && { median: pm.p50, p90: pm.p90, max: pm.max },
    // The gap between paints, which is what the player sees; vsync and pacing quantise it.
    frameMs: fm && { median: fm.p50, p90: fm.p90, max: fm.max },
    fps: mean ? Math.round(1000 / mean) : null,
    // GPU ms per paint for each pass; null on GLASS 1, without the extension, or on a disjoint read.
    gpuPassMs: passes,
    gpuMs: passes ? +Object.values(passes).reduce((a, b) => a + b, 0).toFixed(2) : null,
    glass: d1.glass, tier: d1.tier,
    // The dials at the start and the end. A run where either moved measured a changing picture.
    resStep: [d0.resStep, d1.resStep], gov: [d0.gov, d1.gov], pace: d1.pace,
    W: p1 && p1.W, H: p1 && p1.H, dpr: p1 && p1.dpr,
    still: !moved(p0, p1),
  };
  setLastBench(out);
  if (!opts.quiet) {
    console.table([{ seat: out.seat, paint: out.paintMs?.median, paintP90: out.paintMs?.p90, frame: out.frameMs?.median, fps: out.fps, gpu: out.gpuMs, res: out.resStep.join('→'), still: out.still }]);
    if (passes) console.table([passes]);
    if (!out.still) console.warn('__glassBench: the camera moved during the run; park and run it again for a comparable number.');
  }
  return out;
}
