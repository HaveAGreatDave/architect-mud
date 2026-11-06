/**
 * Keepalive: pings our own /health every 10 minutes so Render's free instance
 * never spins down, whether or not anyone is online.
 *
 * It never touches the database. /health is memory-only, and nothing ticks on an
 * empty world (no schedule() callback opts out of the idle gate), so Neon still
 * suspends and bills nothing for a server that's up with nobody on it.
 *
 * Why it isn't gated on players any more. From August 2026 it was, to save Render
 * instance hours: an empty world was left to spin down. But a spin-down isn't free.
 * Whatever wakes the instance next, a player or a bot, costs a cold start, and a
 * cold start re-reads the world from Neon. On 2026-11-03 something outside began
 * waking it about 25 times a day and egress went from ~50 MB to ~600 MB a day, on
 * course for double the 5 GB cap with nobody playing. docs/ops-usage-watch.md has
 * the numbers.
 *
 * What it costs: ~720 of the workspace's 750 instance hours in a 30-day month and
 * 744 in a 31-day one. That only fits while this is the one free service on the
 * workspace. Ungate this only once a cold start stops costing a world load.
 *
 * Only runs in production. Does nothing in dev.
 */
export function startKeepalive() {
  if (process.env.NODE_ENV !== 'production') return;

  // RENDER_EXTERNAL_URL is already a full URL (e.g. "https://myapp.onrender.com"),
  // not a bare hostname. Prepending a scheme makes every ping fail, and Render
  // spins the instance down after 15 minutes idle.
  const url = process.env.RENDER_EXTERNAL_URL
    ? `${process.env.RENDER_EXTERNAL_URL}/health`
    : null;

  // A missing url means no ping at all, so say so once at boot.
  if (!url) {
    console.warn('⚠ Keepalive: RENDER_EXTERNAL_URL unset, so Render will spin down when idle.');
    return;
  }

  // Every 10 minutes, well inside Render's 15-minute idle threshold.
  const INTERVAL = 10 * 60 * 1000;

  setInterval(async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) console.warn(`Keepalive (Render) ping failed: ${res.status}`);
    } catch (e) {
      console.warn(`Keepalive (Render) ping error: ${e.message}`);
    }
  }, INTERVAL);

  console.log('✓ Keepalive started (Render /health, every 10min, always on)');
}
