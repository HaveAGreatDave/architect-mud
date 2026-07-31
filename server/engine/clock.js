/**
 * The world clock, as a readable thing.
 *
 * `environment.js` owns time; this owns how time is READ and WRITTEN by anyone
 * who needs to talk about it — the tablet's alarm app, the sleep tick, and
 * anything later that wants to say "at half past six".
 *
 * It lives in the engine rather than in the tablet plugin because the SLEEP path
 * needs it, and the engine must never import from a plugin: plugins are optional
 * and load after the engine. A first draft had apartments.js importing the alarm
 * app, which would have made core sleep depend on a tablet screen.
 */
import { getEnvironmentState } from './environment.js';

/** Current world time as minutes-of-day, 0–1439. */
export function gameMinutes() {
  try { return Number(getEnvironmentState().minutes) % 1440; } catch { return 0; }
}

/** minutes-of-day → "HH:MM", 24-hour. */
export const hhmm = (mins) => {
  const m = ((Math.round(mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/**
 * "07:30", "7:30", "730", "0730" — every way somebody actually types a time.
 * Returns minutes-of-day, or null if it isn't one.
 */
export function parseTime(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  let h, m;
  const colon = s.match(/^(\d{1,2}):(\d{2})$/);
  const bare = s.match(/^(\d{3,4})$/);
  if (colon) { h = +colon[1]; m = +colon[2]; }
  else if (bare) { const n = bare[1].padStart(4, '0'); h = +n.slice(0, 2); m = +n.slice(2); }
  else return null;
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/**
 * Game minutes from `now` until `target` comes round. Always forward — a time
 * that has already passed today means tomorrow, which is what every alarm clock
 * ever built does. Never returns 0, so "set it for right now" means a full day.
 */
export function minutesUntil(now, target) {
  const d = (target - now + 1440) % 1440;
  return d === 0 ? 1440 : d;
}

/**
 * Game minutes → real seconds, via the world's time scale. Players spend REAL
 * time, so anything asking them to wait should be able to say what it costs.
 */
export function realSecondsFor(gameMins) {
  let scale = 3;
  try { scale = Number(getEnvironmentState().timeScale) || 3; } catch {}
  return Math.round((gameMins * 60) / scale);
}
