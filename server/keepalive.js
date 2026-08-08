/**
 * Keepalive — pings our own /health endpoint every 10 minutes to keep
 * Render's free-tier dyno from spinning down (which would kill every open
 * WebSocket) during active sessions.
 *
 * It deliberately does NOT ping the database. On Neon, an idle compute
 * scales to zero after ~5 min and stops billing compute-hours — the whole
 * point of the free tier. A periodic DB ping would keep the compute awake
 * 24/7 and burn the monthly compute-hour budget for an empty server. The
 * game loop already leaves the DB alone when no players are online, so the
 * compute is free to suspend; the first player to arrive wakes it (see the
 * connect-time warm-up in index.js). This ping is Render-only.
 *
 * It is also IDLE-GATED, for the same reason and by the same predicate the
 * scheduler uses (hasActivePlayers). The thing this ping buys is that a
 * spin-down never kills a live WebSocket — and on an empty world there is no
 * live WebSocket to kill, so the ping is pure cost. Render bills wall-clock
 * instance hours, so pinging 24/7 spent ~730 of the workspace's 750/month
 * holding up a process that (no schedule() callback opts out of the idle gate,
 * so nothing whatsoever ticks on an empty world) was doing nothing at all.
 * Gated, that's roughly coverage + a 15min tail instead.
 *
 * What it costs: the FIRST player arriving at an empty world waits for a cold
 * start (~1 min). Nobody mid-session is affected — one connected player is
 * enough to resume the ping and hold the service up. The client already
 * handles this path (silent reconnect + "the server may still be waking up"),
 * and that player is partly waiting on Neon's own resume regardless.
 *
 * Only runs in production. Does nothing in dev.
 */
import { hasActivePlayers } from './engine/world.js';

export function startKeepalive() {
  if (process.env.NODE_ENV !== 'production') return;

  // RENDER_EXTERNAL_URL is already a full URL (e.g. "https://myapp.onrender.com"),
  // not a bare hostname — don't prepend another scheme or this silently 404s/
  // fails on every single ping (caught below, logged as a warning, server
  // never actually gets pinged) and Render spins the free-tier dyno down
  // after 15min idle, killing every open WebSocket when it does.
  const url = process.env.RENDER_EXTERNAL_URL
    ? `${process.env.RENDER_EXTERNAL_URL}/health`
    : null;

  // A MISSING url is the same silent nothing as a broken one, so say so ONCE at
  // boot rather than never. Before the idle gate a dead keepalive at least
  // looked wrong in the logs (a warning every 10 min forever); gated, silence
  // is also what CORRECT looks like on an empty world, so the two became
  // indistinguishable. Hence this line and the transition line below.
  if (!url) console.warn('⚠ Keepalive: RENDER_EXTERNAL_URL unset — Render will spin down mid-session.');

  // Ping every 10 minutes — well within Render's 15min idle threshold.
  const INTERVAL = 10 * 60 * 1000;

  // Log only on CHANGE, never per tick: the whole point is a quiet log, and a
  // heartbeat line every 10 minutes is how a log stops being read.
  let wasActive = null;

  setInterval(async () => {
    // Keep Render awake. Hits /health, which is memory-only (no DB), so it
    // never wakes the Neon compute.
    //
    // hasActivePlayers() gate: no live socket to protect => let it spin down.
    // Deliberately checked at fire time, not latched at boot.
    const active = hasActivePlayers();
    if (active !== wasActive) {
      console.log(active
        ? '✓ Keepalive: players online — holding Render awake.'
        : 'ℹ Keepalive: world empty — letting Render spin down.');
      wasActive = active;
    }
    if (url && active) {
      try {
        const res = await fetch(url);
        if (!res.ok) console.warn(`Keepalive (Render) ping failed: ${res.status}`);
      } catch (e) {
        console.warn(`Keepalive (Render) ping error: ${e.message}`);
      }
    }
  }, INTERVAL);

  console.log(`✓ Keepalive started (Render /health, every 10min, idle-gated)`);
}
