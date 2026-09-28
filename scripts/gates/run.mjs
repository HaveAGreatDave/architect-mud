// gates: the checks `npm run test:regress` runs before the suite, run side by side.
//
//   node scripts/gates/run.mjs               every gate; this is `pretest:regress`
//   node scripts/gates/run.mjs shapes docs   only those groups; `shapes:smoke` is `run.mjs shapes`
//   node scripts/gates/run.mjs --jobs 2      at most two at once (default: one per core, up to 8)
//   node scripts/gates/run.mjs --verbose     print every gate's output, not only a failure's
//   node scripts/gates/run.mjs --list        print the groups and their gates, run nothing
//
// The list is scripts/gates/manifest.mjs. A passing gate prints nothing. A failing one prints its
// whole output as soon as it finishes, and the run ends with one summary line and the five gates
// that cost the most CPU, so a gate getting slow is visible before it's a problem.
//
// Every gate is charged for its own CPU (scripts/gates/cpu.mjs) and fails over its budget. The
// chain this replaced ran 131 steps one after another and took about 30 minutes, 11 of them in
// one gate that nobody knew was slow.
import { spawn } from 'node:child_process';
import { availableParallelism, tmpdir } from 'node:os';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GROUPS, DEFAULT_BUDGET_S } from './manifest.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PRELOAD = pathToFileURL(join(ROOT, 'scripts', 'gates', 'cpu.mjs')).href;
// Last run's times, so the slowest gates start first and the run doesn't end waiting on one
// that started last. Only an ordering hint: a missing or stale file changes nothing else.
const TIMES = join(ROOT, 'node_modules', '.cache', 'gates-times.json');

const argv = process.argv.slice(2);
const VERBOSE = argv.includes('--verbose');
const jobsAt = argv.indexOf('--jobs');
const JOBS = jobsAt >= 0 ? Math.max(1, Number(argv[jobsAt + 1]) || 1) : Math.min(8, availableParallelism());
const wanted = argv.filter((a, i) => !a.startsWith('--') && !(jobsAt >= 0 && i === jobsAt + 1));

// ── The manifest, checked before anything runs ─────────────────────────────
const problems = [];
const seen = new Set();
const entries = [];
for (const g of GROUPS) {
  for (const x of g.gates) {
    const e = typeof x === 'string' ? { run: x } : x;
    const [path, ...args] = e.run.split(' ');
    if (seen.has(e.run)) problems.push(`${e.run} is listed twice`);
    seen.add(e.run);
    if (e.budget != null && !e.why) problems.push(`${e.run} raises its budget without a why`);
    if (!existsSync(join(ROOT, path))) problems.push(`${e.run}: no such file`);
    entries.push({ group: g.name, serial: g.serial || null, run: e.run, path, args, budget: e.budget ?? DEFAULT_BUDGET_S });
  }
}
const names = GROUPS.map((g) => g.name);
for (const w of wanted) if (!names.includes(w)) problems.push(`no group called '${w}' (the groups are ${names.join(', ')})`);
if (problems.length) {
  for (const p of problems) console.error(`✗ gates: ${p}`);
  process.exit(2);
}

if (argv.includes('--list')) {
  for (const g of GROUPS) {
    console.log(`${g.name}${g.serial ? ` (alone, ${g.serial})` : ''}`);
    for (const e of entries.filter((x) => x.group === g.name)) console.log(`  ${e.run}${e.budget !== DEFAULT_BUDGET_S ? `  [budget ${e.budget} s]` : ''}`);
  }
  process.exit(0);
}

const picked = entries.filter((e) => !wanted.length || wanted.includes(e.group));
let last = {};
try { last = JSON.parse(readFileSync(TIMES, 'utf8')); } catch { /* first run, or no cache */ }

// ── Running one gate ────────────────────────────────────────────────────────
const TMP = mkdtempSync(join(tmpdir(), 'gates-'));
let seq = 0;
function runGate(e, live) {
  const cpuFile = join(TMP, `${seq++}.cpu`);
  const t0 = performance.now();
  return new Promise((resolve) => {
    let timedOut = false, settled = false;
    const chunks = [];
    const child = spawn(process.execPath, ['--import', PRELOAD, e.path, ...e.args], {
      cwd: ROOT,
      env: { ...process.env, GATE_CPU_OUT: cpuFile },
      stdio: ['ignore', live ? 'inherit' : 'pipe', live ? 'inherit' : 'pipe'],
    });
    if (!live) {
      child.stdout.on('data', (c) => chunks.push(c));
      child.stderr.on('data', (c) => chunks.push(c));
    }
    // A hung gate would hang the push. Four times its budget in wall time is far past slow.
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, Math.max(120, e.budget * 4) * 1000);
    const finish = (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      let cpu = null;
      try { cpu = Number(readFileSync(cpuFile, 'utf8')); } catch { /* killed, or never started */ }
      resolve({ e, rc: code ?? 1, signal, timedOut, cpu, wall: (performance.now() - t0) / 1000, out: Buffer.concat(chunks).toString('utf8') });
    };
    child.on('error', (err) => { chunks.push(Buffer.from(`${err.message}\n`)); finish(1, null); });
    child.on('close', finish);
  });
}

const verdict = (r) => (r.timedOut ? `timed out after ${Math.round(r.wall)} s`
  : r.rc !== 0 ? `exit ${r.rc}${r.signal ? ` (${r.signal})` : ''}`
  : r.cpu != null && r.cpu > r.e.budget ? `over budget: ${r.cpu.toFixed(1)} s of CPU, and the budget is ${r.e.budget} s`
  : null);
const secs = (s) => (s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${s.toFixed(1)} s`);
const cost = (r) => `${r.cpu != null ? `${r.cpu.toFixed(1)} s CPU, ` : ''}${r.wall.toFixed(1)} s wall`;
const indent = (s) => s.trimEnd().split('\n').map((l) => `    ${l}`).join('\n');

let lastSaid = Date.now();
const say = (s) => { process.stdout.write(`${s}\n`); lastSaid = Date.now(); };

const results = [];
function report(r) {
  results.push(r);
  const bad = verdict(r);
  if (bad) say(`✗ ${r.e.run}: ${bad} (${cost(r)})${r.out.trim() ? `\n${indent(r.out)}` : ''}`);
  else if (VERBOSE) say(`✓ ${r.e.run} (${cost(r)})${r.out.trim() ? `\n${indent(r.out)}` : ''}`);
}

// ── The run ─────────────────────────────────────────────────────────────────
const t0 = performance.now();
const first = picked.filter((e) => e.serial === 'first');
const pool = picked.filter((e) => !e.serial)
  .sort((a, b) => (last[b.run]?.wall ?? Infinity) - (last[a.run]?.wall ?? Infinity));
const final = picked.filter((e) => e.serial === 'last');

for (const e of first) report(await runGate(e, true));

say(`gates: ${pool.length} running, ${Math.min(JOBS, pool.length)} at a time`);
const running = new Set();
const beat = setInterval(() => {
  if (Date.now() - lastSaid < 20000) return;
  say(`  · ${results.length - first.length}/${pool.length} done; still running ${[...running].map((e) => e.path.replace(/^scripts\//, '')).join(', ')}`);
}, 5000);
const queue = pool.slice();
await Promise.all(Array.from({ length: Math.min(JOBS, queue.length) }, async () => {
  while (queue.length) {
    const e = queue.shift();
    running.add(e);
    const r = await runGate(e, false);
    running.delete(e);
    report(r);
  }
}));
clearInterval(beat);

// The serial tail prepares for the suite (check-stale imports content), and npm won't run the
// suite after a failed pretest anyway, so it's skipped once anything has failed.
const skipped = [];
for (const e of final) {
  if (results.some(verdict)) { skipped.push(e.run); continue; }
  report(await runGate(e, true));
}

rmSync(TMP, { recursive: true, force: true });
try {
  for (const r of results) last[r.e.run] = { wall: +r.wall.toFixed(2), cpu: r.cpu };
  mkdirSync(dirname(TIMES), { recursive: true });
  writeFileSync(TIMES, JSON.stringify(last, null, 1));
} catch { /* read-only checkout: the order hint just isn't kept */ }

const failed = results.filter(verdict);
const cpuTotal = results.reduce((n, r) => n + (r.cpu || 0), 0);
say(`${failed.length ? '✗' : '✓'} gates: ${results.length - failed.length}/${results.length} passed in ${secs((performance.now() - t0) / 1000)}`
  + ` (${Math.min(JOBS, pool.length)} at a time, ${secs(cpuTotal)} of CPU)`);
const slow = results.filter((r) => r.cpu != null).sort((a, b) => b.cpu - a.cpu).slice(0, 5);
say(`  slowest: ${slow.map((r) => `${r.e.path.replace(/^scripts\//, '')} ${r.cpu.toFixed(1)} s`).join(', ')}`);
if (skipped.length) say(`  skipped after the failure: ${skipped.join(', ')}`);
if (failed.length) say(`  failed: ${failed.map((r) => r.e.run).join(', ')}`);
process.exit(failed.length ? 1 : 0);
