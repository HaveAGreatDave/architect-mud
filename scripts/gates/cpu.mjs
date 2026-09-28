// Preloaded into every gate by scripts/gates/run.mjs, so the runner can charge each gate for its
// own CPU. Wall time can't be the budget: with gates running side by side it measures the
// neighbours too.
//
// It counts this process only. A gate that spawns (parse-smoke runs `node --check` once per file)
// is charged for its own share, and its children's CPU goes uncounted.
import { writeFileSync } from 'node:fs';

const out = process.env.GATE_CPU_OUT;
delete process.env.GATE_CPU_OUT;   // a child the gate spawns is not the gate
if (out) {
  process.on('exit', () => {
    const u = process.cpuUsage();
    try { writeFileSync(out, String((u.user + u.system) / 1e6)); } catch { /* the runner reports it missing */ }
  });
}
