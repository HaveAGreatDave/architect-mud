// alloc: how much does one frame of the world allocate, and has that gone up?
//
//   node scripts/perf/alloc.mjs            # measure, compare against the committed baseline (the gate)
//   node scripts/perf/alloc.mjs --write    # accept the current numbers as the new baseline
//   node scripts/perf/alloc.mjs --detail   # and the functions that allocate the most, per case
//   node scripts/perf/alloc.mjs --tune groundCache=0   # what one RENDER_TUNE switch is worth
//
// Garbage is the long tail of a GLASS 2 frame (docs/proposals/glass-headroom.md, "Measured
// 2026-10-01"): 12 MB a frame in the cab and 23 MB in the cockpit over Halcyon, and a collection every
// few frames that lands in whichever item happens to be running. Frame time on a shared machine swings
// 3x between runs; bytes allocated over a fixed headless scene don't, so this is the number held.
//
// V8's sampling heap profiler, with collected objects kept (without them it reports only what is
// still alive at the end, which leaves out the per-frame garbage this is about). Frozen clocks, a
// fixed heading sweep, warm frames first so caches that fill once aren't charged to every frame.
import inspector from 'node:inspector/promises';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { openScene } from './scene.mjs';

const BASELINE = new URL('./alloc.json', import.meta.url);
const TOL = 0.10;   // a case may rise 10% before the gate fails; sampling noise was under 2% run to run
const CASES = [
  { key: 'halcyon cab', place: 'halcyon', seat: 'cab', warm: 20, frames: 60 },
  { key: 'halcyon cockpit', place: 'halcyon', seat: 'cockpit', warm: 12, frames: 30 },
  { key: 'residential cockpit', place: 'residential', seat: 'cockpit', warm: 12, frames: 30 },
];

async function measure(detail, tune = {}) {
  const session = new inspector.Session();
  session.connect();
  await session.post('HeapProfiler.enable');
  const scene = await openScene({ record: false });
  Object.assign(scene.ws.RENDER_TUNE, tune);
  const cases = {};
  try {
    for (const c of CASES) {
      const base = scene.view(c.place, c.seat);
      for (let i = 0; i < c.warm; i++) scene.paint({ ...base, heading: i * 0.5 });
      await session.post('HeapProfiler.startSampling', { samplingInterval: 4096, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
      for (let i = 0; i < c.frames; i++) scene.paint({ ...base, heading: (c.warm + i) * 0.5 });
      const { profile } = await session.post('HeapProfiler.stopSampling');
      scene.takeLog();
      const self = new Map();
      let total = 0;
      const walk = (n) => {
        const s = n.selfSize || 0;
        total += s;
        if (s && detail) {
          const cf = n.callFrame;
          const name = (cf.functionName || '(anon)') + ' ' + (cf.url.split('/').pop() || '') + ':' + (cf.lineNumber + 1);
          self.set(name, (self.get(name) || 0) + s);
        }
        for (const ch of n.children || []) walk(ch);
      };
      walk(profile.head);
      const mb = total / c.frames / 1048576;
      cases[c.key] = { mbPerFrame: +mb.toFixed(2) };
      if (detail) cases[c.key].top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => [k, +(v / c.frames / 1048576).toFixed(3)]);
    }
  } finally {
    scene.close();
    await session.post('HeapProfiler.disable');
    session.disconnect();
  }
  return { cases };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const write = process.argv.includes('--write');
  const detail = process.argv.includes('--detail');
  // --tune key=value (repeatable): set a RENDER_TUNE value for the run, to measure what one switch
  // is worth. Never with --write: the baseline is the shipped tune.
  const tune = {};
  process.argv.forEach((a, i) => {
    if (a !== '--tune') return;
    const [k, v] = String(process.argv[i + 1] || '').split('=');
    if (k) tune[k] = v === 'true' ? true : v === 'false' ? false : Number.isFinite(+v) ? +v : v;
  });
  if (write && Object.keys(tune).length) { console.error('alloc: --write with --tune would bake a non-shipped tune into the baseline'); process.exit(2); }
  const now = await measure(detail, tune);
  if (detail) {
    for (const [k, c] of Object.entries(now.cases)) {
      console.log(`${k}: ${c.mbPerFrame} MB a frame`);
      for (const [fn, mb] of c.top) console.log(`  ${mb.toFixed(3).padStart(7)}  ${fn}`);
    }
  }
  const plain = { cases: Object.fromEntries(Object.entries(now.cases).map(([k, c]) => [k, { mbPerFrame: c.mbPerFrame }])) };
  if (write || !existsSync(BASELINE)) {
    writeFileSync(BASELINE, JSON.stringify(plain, null, 1) + '\n');
    console.log('alloc: baseline written: ' + Object.entries(plain.cases).map(([k, c]) => `${k} ${c.mbPerFrame} MB`).join(', ') + ' a frame.');
  } else {
    const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
    const problems = [];
    for (const [k, c] of Object.entries(plain.cases)) {
      const b = base.cases[k];
      if (!b) { problems.push(`${k} has no baseline (run with --write)`); continue; }
      const d = (c.mbPerFrame - b.mbPerFrame) / b.mbPerFrame;
      if (d > TOL) problems.push(`${k}: ${b.mbPerFrame} → ${c.mbPerFrame} MB a frame (+${(d * 100).toFixed(1)}%, tolerance ${TOL * 100}%). `
        + 'Find the new allocator with --detail; run with --write only if the rise is intended.');
    }
    for (const p of problems) console.error(`  ✗ ${p}`);
    if (problems.length) process.exit(1);
    console.log('✓ alloc: ' + Object.entries(plain.cases).map(([k, c]) => `${k} ${c.mbPerFrame}`).join(', ') + ' MB a frame.');
  }
}
