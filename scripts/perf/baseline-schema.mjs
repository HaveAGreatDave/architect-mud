// perf:baselines: every device baseline in scripts/perf/baselines/ is one the route bench can be
// compared with (docs/proposals/gl-core.md, phase 0).
//
//   node scripts/perf/baseline-schema.mjs
//
// A baseline is the output of `__benchRoutes()` on the Modelshop (tools/modelshop/route.js), one
// file per machine. It measures nothing here: there's no GPU in a gate. It checks that each file
// parses, says what it was measured on, and names only routes that exist in tools/modelshop/routes.js
// with the seat, hour and weather they have now. A route that changed under a baseline makes that
// baseline a measurement of something else, which is the mistake this catches.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROUTES } from '../../tools/modelshop/routes.js';

const DIR = new URL('./baselines/', import.meta.url);
const problems = [];
const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.json')) : [];
const num = (v) => typeof v === 'number' && Number.isFinite(v);

for (const f of files) {
  let b;
  try { b = JSON.parse(readFileSync(new URL(f, DIR), 'utf8')); } catch (e) { problems.push(`${f}: doesn't parse (${e.message})`); continue; }
  if (!b.device || typeof b.device.renderer !== 'string') problems.push(`${f}: no device.renderer, so nobody can tell what it measured`);
  if (!b.at || Number.isNaN(Date.parse(b.at))) problems.push(`${f}: no date (at)`);
  if (!b.routes || typeof b.routes !== 'object' || !Object.keys(b.routes).length) { problems.push(`${f}: no routes`); continue; }
  for (const [name, r] of Object.entries(b.routes)) {
    const R = ROUTES[name];
    if (!R) { problems.push(`${f}: route ${name} isn't in tools/modelshop/routes.js`); continue; }
    if (r.seat !== R.seat || r.hour !== R.hour || (r.weather || 'clear') !== (R.weather || 'clear')) {
      problems.push(`${f}: route ${name} was measured as ${r.seat}/${r.hour}h/${r.weather}, and routes.js now says ${R.seat}/${R.hour}h/${R.weather || 'clear'}; give the changed route a new name`);
    }
    if (!r.cpu || !num(r.cpu.p50) || !num(r.cpu.p95)) problems.push(`${f}: route ${name} has no CPU percentiles`);
    if (!num(r.frames) || r.frames < 1) problems.push(`${f}: route ${name} has no frame count`);
  }
}

if (problems.length) {
  console.error('perf:baselines: ' + problems.length + ' problem(s)');
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
