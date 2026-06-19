/**
 * Keepalive — pings our own /health endpoint every 10 minutes
 * to prevent Render free tier from spinning down during active sessions.
 * Only runs in production. Does nothing in dev.
 */
export function startKeepalive() {
  if (process.env.NODE_ENV !== 'production') return;

  const url = process.env.RENDER_EXTERNAL_URL
    ? `https://${process.env.RENDER_EXTERNAL_URL}/health`
    : null;

  if (!url) {
    console.log('⚠ Keepalive: no RENDER_EXTERNAL_URL set, skipping');
    return;
  }

  // Ping every 10 minutes — well within the 15min idle threshold
  const INTERVAL = 10 * 60 * 1000;

  setInterval(async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) console.warn(`Keepalive ping failed: ${res.status}`);
    } catch (e) {
      console.warn(`Keepalive ping error: ${e.message}`);
    }
  }, INTERVAL);

  console.log(`✓ Keepalive started → ${url} (every 10min)`);
}
