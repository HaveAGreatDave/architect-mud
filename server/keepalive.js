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
 * Only runs in production. Does nothing in dev.
 */
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

  // Ping every 10 minutes — well within Render's 15min idle threshold.
  const INTERVAL = 10 * 60 * 1000;

  setInterval(async () => {
    // Keep Render awake. Hits /health, which is memory-only (no DB), so it
    // never wakes the Neon compute.
    if (url) {
      try {
        const res = await fetch(url);
        if (!res.ok) console.warn(`Keepalive (Render) ping failed: ${res.status}`);
      } catch (e) {
        console.warn(`Keepalive (Render) ping error: ${e.message}`);
      }
    }
  }, INTERVAL);

  console.log(`✓ Keepalive started (Render /health, every 10min)`);
}
