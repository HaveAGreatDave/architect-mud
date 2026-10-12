// A league's venue on the client: where its park stands and the skyline round it.
//
// Content owns the venue (media_broadcasts.sports_pools.venue); the server adds the skyline
// from the map (server/engine/skyline.js) and sends the lot once a revision, the way
// club-crest.js gets a league's clubs. A 3-D view composes its city from it
// (client/shared/city-set.js). This file knows no park: it keeps what the server last sent.

const _store = new Map();          // sport -> { rev, venue }
const _listeners = new Set();
export function setVenue(sport, rev, venue) {
  if (!sport || !venue || typeof venue !== 'object') return;
  _store.set(sport, { rev: String(rev || ''), venue });
  for (const fn of _listeners) { try { fn(sport); } catch { /* a listener's own problem */ } }
}
export function venueRev(sport) { return _store.get(sport)?.rev || ''; }
export function venueOf(sport = 'baseball') { return _store.get(sport)?.venue || null; }
export function onVenue(fn) { _listeners.add(fn); return () => _listeners.delete(fn); }

// Called with a payload's stamp. True when the caller should ask the server (tv_venue);
// false when it's held, on its way, or was in this browser's storage from an earlier
// visit. Asks at most once every few seconds per sport.
const _asked = new Map();       // sport -> { rev, at }
const LS_KEY = (sport) => `thomas.venue.${sport}`;
export function wantVenue(sport, rev) {
  if (!sport || !rev) return false;
  if (venueRev(sport) === rev) return false;
  try {
    const raw = globalThis.localStorage?.getItem(LS_KEY(sport));
    if (raw) {
      const kept = JSON.parse(raw);
      if (kept && kept.rev === rev && kept.venue) { setVenue(sport, rev, kept.venue); return false; }
    }
  } catch { /* storage blocked or full: just ask */ }
  const last = _asked.get(sport);
  const now = Date.now();
  if (last && last.rev === rev && now - last.at < 8000) return false;
  _asked.set(sport, { rev, at: now });
  return true;
}
// The server's answer. Kept in memory, and in storage so the next visit needn't ask.
export function receiveVenue(msg) {
  if (!msg || !msg.sport || !msg.venue) return;
  setVenue(msg.sport, msg.rev, msg.venue);
  try { globalThis.localStorage?.setItem(LS_KEY(msg.sport), JSON.stringify({ rev: msg.rev, venue: msg.venue })); } catch { /* fine without */ }
}
