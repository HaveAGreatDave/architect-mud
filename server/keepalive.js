/**
 * Keepalive — pings our own /health endpoint AND the database every
 * 10 minutes to prevent both Render and Supabase free tiers from
 * spinning down / pausing during active sessions.
 * Only runs in production. Does nothing in dev.
 */
import { query } from './models/db.js';

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
  // Supabase free tier pauses after 7 DAYS of no DB activity, so the
  // same interval covers both with enormous margin.
  const INTERVAL = 10 * 60 * 1000;

  setInterval(async () => {
    // Keep Render awake
    if (url) {
      try {
        const res = await fetch(url);
        if (!res.ok) console.warn(`Keepalive (Render) ping failed: ${res.status}`);
      } catch (e) {
        console.warn(`Keepalive (Render) ping error: ${e.message}`);
      }
    }

    // Keep Supabase awake — any real query counts as activity
    try {
      await query('SELECT 1');
    } catch (e) {
      console.warn(`Keepalive (Supabase) ping error: ${e.message}`);
    }
  }, INTERVAL);

  console.log(`✓ Keepalive started (Render + Supabase, every 10min)`);
}
