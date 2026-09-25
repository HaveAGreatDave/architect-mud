// The birds your own aircraft has hit, so the canopy stops drawing them.
//
// A flock is arithmetic (client/shared/birds.js) and has nowhere to keep a dead bird, so this is the
// one place that remembers. The server's contact test names each flock it took birds out of and when
// that flock next lands; until then the flock is drawn that many short, the way a hawk's kill already
// leaves one (lostTo), and on landing it is whole again. Only the occupants of the aircraft that hit
// them are told: another pilot watching the same flock sees it whole, which is the one disagreement
// this accepts rather than giving every client a record of everybody's strikes.

const _lost = new Map();   // "ax,ay,sp" -> { n, untilMs }
// The puffs in the air where birds were hit, and the splats still owed to our own windscreen.
// Both are the picture of an event that already happened on the server, so they are allowed to
// remember something, like the wet glass after a dunk.
const _puffs = [];        // { x, y, z, t0, sp, seed }
let _splats = [];         // { sp, n }
export const PUFF_S = 1.6;
// Birds by the size of the mess they make, 0..1: a goose fills a good part of a windscreen, a starling
// is a spot.
export const BIRD_SPLAT = { goose: 1, vulture: 0.8, gull: 0.55, hawk: 0.55, peregrine: 0.5, pigeon: 0.4, songbird: 0.22 };

/** From the server's `bird_strike` message: [{ ax, ay, sp, n, untilMs, pts }]. */
export function noteBirdStrikes(list) {
  if (!Array.isArray(list)) return;
  const now = Date.now();
  for (const [k, v] of _lost) if (v.untilMs <= now) _lost.delete(k);
  for (const s of list) {
    if (!s) continue;
    if (Array.isArray(s.pts)) {
      for (const p of s.pts) if (Array.isArray(p) && p.every(Number.isFinite)) {
        _puffs.push({ x: p[0], y: p[1], z: p[2], t0: now, sp: s.sp || 'goose', seed: (_puffs.length * 0.618 + p[0] * 3.1) % 1 });
      }
      if (_puffs.length > 64) _puffs.splice(0, _puffs.length - 64);
    }
    if (s.n > 0) _splats.push({ sp: s.sp || 'goose', n: s.n });
    if (!Number.isFinite(s.ax) || !Number.isFinite(s.ay) || !(s.n > 0)) continue;
    const k = s.ax + ',' + s.ay + ',' + (s.sp || 'goose');
    const was = _lost.get(k);
    _lost.set(k, { n: (was && was.untilMs > now ? was.n : 0) + s.n, untilMs: Math.max(s.untilMs || 0, was?.untilMs || 0) });
  }
}

/** How many birds this flock is short at `now` because we flew through it. */
export function struckFrom(fl, now) {
  if (!_lost.size || !fl) return 0;
  const v = _lost.get(fl.ax + ',' + fl.ay + ',' + (fl.sp || 'goose'));
  if (!v) return 0;
  if (v.untilMs <= now) { _lost.delete(fl.ax + ',' + fl.ay + ',' + (fl.sp || 'goose')); return 0; }
  return v.n;
}

/** The puffs still in the air at `now`, oldest first. Spent ones are dropped. */
export function livePuffs(now) {
  while (_puffs.length && now - _puffs[0].t0 > PUFF_S * 1000) _puffs.shift();
  return _puffs;
}

/** The splats owed to our own windscreen since the last call, then forgotten. */
export function takeSplats() {
  if (!_splats.length) return null;
  const s = _splats; _splats = [];
  return s;
}
