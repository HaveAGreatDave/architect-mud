// Kill stale architect node processes left over from a crashed/detached run —
// chiefly an orphaned `server/index.js` still holding Supabase pool connections
// (the cause of regress dying with EMAXCONNSESSION). Wired as `predev` and
// `pretest:regress` so it sweeps automatically before we boot the world again.
//
// Scoped by command-line signature to THIS project's long-lived entrypoints; it
// never touches the sweep's own process, its npm parent, or node from other apps
// (their command lines don't match). Dev-only: production runs `npm start`, which
// has no pre-hook, so live servers are untouched. No-op off Windows.
import { spawnSync } from 'child_process';

if (process.platform !== 'win32') process.exit(0);

// Match architect's own entrypoints; [\\/] handles either slash style, and the
// relative paths these procs report (e.g. `node server/index.js`) still match.
const ps = `
$me = ${process.pid}
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.ProcessId -ne $me -and $_.CommandLine -match 'server[\\\\/]index\\.js|tests[\\\\/]regress\\.js|scripts[\\\\/]sync-commits\\.js' } |
  ForEach-Object {
    try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop; "  killed orphan $($_.ProcessId): $($_.CommandLine)" }
    catch { "  could not kill $($_.ProcessId): $($_.Exception.Message)" }
  }
`;

const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
const out = (r.stdout || '').trim();
if (out) console.log('kill-orphans:\n' + out);
