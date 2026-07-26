// plugins/dealer/rotation.js
//
// Passphrase rotation. The dealer's `flags.passphrases` list is treated as a
// POOL: only one entry is accepted at a time, and it advances every N in-game
// days (WINDOW_DAYS). The window is derived purely from the world clock's game-date, so the
// active phrase is deterministic (no stored state, survives restarts) and the
// dealer plugin + gossip plugin agree on which phrase is "live" right now.

import { getEnvironmentState } from '../../server/engine/environment.js';

const WINDOW_DAYS = 7;   // phrase changes every N in-game days

// Whole days since the Unix epoch for an ISO "YYYY-MM-DD" date (UTC — no DST
// drift). getEnvironmentState().date is the in-game game-date advanced by the
// day tick, so rotation tracks in-game time, not wall-clock time.
function dayNumber(dateStr) {
  const [y, m, d] = String(dateStr || '').split('-').map(Number);
  if (!y || !m || !d) return 0;
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

// The current rotation window index (advances by 1 every WINDOW_DAYS days).
export function windowIndex() {
  return Math.floor(dayNumber(getEnvironmentState().date) / WINDOW_DAYS);
}

// The pool entry for a given window, cycling. Returns the sole entry (rotation
// off) for a 0/1-length pool — you need at least two phrases to rotate.
function phraseAt(pool, index) {
  const list = (Array.isArray(pool) ? pool : []).filter(Boolean);
  if (list.length <= 1) return list[0] ?? null;
  return list[((index % list.length) + list.length) % list.length];
}

export function activePassphrase(pool) { return phraseAt(pool, windowIndex()); }
export function nextPassphrase(pool)   { return phraseAt(pool, windowIndex() + 1); }
