// One command, two processes: the game server and the Studio.
//
//   npm run dev                  → server on :3000 (+ /dev) and Studio on :5180
//   npm run dev -- --no-studio   → server only
//   npm run dev -- --studio-port 5200
//
// They stay SEPARATE processes on purpose, and this wrapper is the whole of the
// integration — it spawns, it reports, it takes the other one down. It does not
// proxy, share state, or let either side see the other.
//
// Why not fold the Studio into the game server: the Studio has no database in it
// (see tools/studio/README.md), and its save path runs lintContentTree() over
// ~10k content files synchronously. Inside the server that would (a) stall the
// single-threaded tick loop on every save and (b) turn "cannot write a DB row"
// from a property of the process into a promise made by code review. Two
// processes, one command.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const withStudio = !argv.includes('--no-studio');
const portIdx = argv.indexOf('--studio-port');
const studioPort = portIdx !== -1 ? argv[portIdx + 1] : null;

const children = [];
let shuttingDown = false;

function start(label, args) {
  const child = spawn(process.execPath, args, { stdio: 'inherit', cwd: ROOT });
  const entry = { label, child, alive: true };
  children.push(entry);

  child.on('exit', (code, signal) => {
    entry.alive = false;
    if (shuttingDown) return;
    // One half died on its own — the pair is the unit, so take the rest down
    // rather than leaving a half-dev running that looks fine until it isn't.
    shuttingDown = true;
    const how = signal ? `signal ${signal}` : `code ${code}`;
    console.log(`\n[dev] ${label} exited (${how}) — stopping the rest.`);
    stopAll();
    process.exitCode = code ?? 1;
  });

  child.on('error', (err) => {
    console.error(`[dev] could not start ${label}:`, err.message);
  });

  return entry;
}

function stopAll() {
  for (const e of children) if (e.alive) { try { e.child.kill(); } catch { /* already gone */ } }
}

// Ctrl+C is delivered by the console to the whole process group, so both children
// get it directly and run their OWN shutdown paths (the server closes its pool
// that way). We must not kill them here or we'd cut that short — just stop
// treating their exits as failures, and wait. The timer is the backstop for a
// child that won't go.
process.on('SIGINT', () => {
  if (shuttingDown) return;
  shuttingDown = true;
  const t = setTimeout(() => { stopAll(); process.exit(130); }, 5000);
  t.unref();
});
process.on('SIGTERM', () => { shuttingDown = true; stopAll(); });

start('server', ['--watch', join('server', 'index.js')]);
if (withStudio) {
  const args = [join('tools', 'studio', 'serve.mjs')];
  if (studioPort) args.push(studioPort);
  start('studio', args);
}
