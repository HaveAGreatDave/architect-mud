// Preloaded into every gate by scripts/gates/run.mjs, so the runner can charge each gate for its
// own CPU. Wall time can't be the budget: with gates running side by side it measures the
// neighbours too.
//
// It reports two numbers. `main` is the gate's main thread, which is what the budget charges. `all`
// adds V8's background threads, which is what the machine paid, and it's a poor budget: see the note
// on the budget in scripts/gates/manifest.mjs.
//
// It counts this process only. A gate that spawns (parse-smoke runs `node --check` once per file)
// is charged for its own share, and its children's CPU goes uncounted.
import { writeFileSync } from 'node:fs';

const out = process.env.GATE_CPU_OUT;
delete process.env.GATE_CPU_OUT;   // a child the gate spawns is not the gate
if (out) {
  process.on('exit', () => {
    const secs = (u) => (u.user + u.system) / 1e6;
    const all = process.cpuUsage(), main = process.threadCpuUsage ? process.threadCpuUsage() : all;
    try { writeFileSync(out, JSON.stringify({ main: secs(main), all: secs(all) })); } catch { /* the runner reports it missing */ }
  });
}
