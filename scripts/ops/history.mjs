// The run history file.
//
// WHY THIS IS NOT A DATABASE TABLE. The thing being measured is DB egress, and a
// monitor that writes to prod every run is spending from the budget it reports
// on. A flat file costs nothing, and — being in git — makes the trend readable
// with `git log -p` by a human who never runs the script.
//
// WHY GAPS ARE HARMLESS. Every run re-reads the full cumulative total from both
// providers; nothing here is a delta accumulator. The file exists only for the
// acceleration comparison and for alert de-duplication. A week of missed runs
// costs a week of trend resolution and nothing else — which is what makes a
// "runs on Johna's laptop" Phase 1 acceptable rather than fragile.
//
// data/ops/** is outside deploy-content.yml's push path filter, so committing
// this file cannot trigger a production deploy.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const HISTORY_PATH = join(REPO_ROOT, 'data', 'ops', 'usage-history.json');

const MAX_ROWS = 500; // ~16 months of daily runs

export function loadHistory() {
  try {
    const parsed = JSON.parse(readFileSync(HISTORY_PATH, 'utf8'));
    return { runs: parsed.runs ?? [], lastAlert: parsed.lastAlert ?? null };
  } catch (e) {
    // A missing file is the normal first-run state. A CORRUPT file is not, and
    // silently starting over would throw away the trend without saying so.
    if (e.code !== 'ENOENT') {
      console.warn(`⚠ usage-history.json unreadable (${e.message}) — starting a new history; the old trend is lost.`);
    }
    return { runs: [], lastAlert: null };
  }
}

export function saveHistory(history) {
  mkdirSync(dirname(HISTORY_PATH), { recursive: true });
  const trimmed = { ...history, runs: history.runs.slice(-MAX_ROWS) };
  writeFileSync(HISTORY_PATH, `${JSON.stringify(trimmed, null, 2)}\n`, 'utf8');
}

/**
 * The run closest to `daysAgo` days back, for the acceleration comparison.
 * Returns null rather than the nearest-at-any-distance: comparing today against
 * a run from 40 days ago (a different billing cycle) produces a confident
 * garbage number, so we require the match to be within `tolerance` days.
 */
export function runNearDaysAgo(runs, daysAgo, tolerance = 3) {
  const target = Date.now() - daysAgo * 86_400_000;
  let best = null;
  let bestDist = Infinity;
  for (const r of runs) {
    const dist = Math.abs(new Date(r.at).getTime() - target);
    if (dist < bestDist) { bestDist = dist; best = r; }
  }
  return bestDist <= tolerance * 86_400_000 ? best : null;
}
