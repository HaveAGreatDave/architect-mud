// HIGHWAYS — what kind of road a stretch of the void network is.
//
// The network is built out of pieces (plugins/trucking/state.js networkRoute): the main road out of
// a region's gate, the road from there to the other region, and the ramps that leave one for the
// other. Each piece is tagged with a TYPE, and the type says how wide the road is, how many lanes it
// carries, whether it is surfaced, and what its shield looks like. The types are content
// (content/map/routes.json `types`), baked into wildlands-field.js with the route numbers.
//
// Shared by the server (corridor width, lanes, surface, boards) and the client (the world map), so
// the road a truck drives and the road the map draws are the same road.
import { WILDLANDS_FIELD as F } from './wildlands-field.js';

// A road built before types existed (a hand-made route in a test, the legacy local frame) is a
// branch, and `branch` reproduces the road that shipped before this exactly: 0.95 half-width, four
// lanes, dirt. That is the migration invariant, the way `calibration: 100` is for chrome.
const LEGACY = { half: 0.95, lanes: 4, dirt: true, label: 'highway', shield: 'plate' };
export const HIGHWAY_TYPES = { branch: LEGACY, ...(F.hwTypes || {}) };
export const typeOf = (name) => HIGHWAY_TYPES[name] || HIGHWAY_TYPES.branch;

// Which segment of a joined route a distance along it falls in. `segments` is written by
// joinRoutes; each carries { s0, L, type, seedKey }.
export function segmentAt(route, s) {
  const segs = route?.segments;
  if (!segs || !segs.length || segs[0].s0 == null) return null;
  for (const g of segs) if (s < g.s0 + g.L) return g;
  return segs[segs.length - 1];
}
// ⚠ A road with no typed segments is LEGACY, never the content `branch` — content may retune a
// branch (it is asphalt now), and a hand-made or unanchored road must keep the dirt it shipped with.
export const typeAt = (route, s) => { const g = segmentAt(route, s); return g ? typeOf(g.type) : LEGACY; };

// The half-width of the road at s, eased across a change of type so a trunk narrowing into a
// branch is a taper rather than a step. The ease is an average of the raw width either side, which
// is exact on a long segment and smooth across a short one.
const EASE = 8;   // tiles either side
export function halfWidthAt(route, s) {
  const raw = (q) => typeAt(route, q).half;
  if (!route?.segments || route.segments.length < 2 || route.segments[0].s0 == null) return raw(s);
  return (raw(s - EASE) + raw(s - EASE / 2) + raw(s) + raw(s + EASE / 2) + raw(s + EASE)) / 5;
}

// The route numbers a highway piece carries, by its seedKey. Pieces with the same seedKey are the
// SAME tarmac (the trunk out of a gate is built once and shared by every road that uses it), so the
// numbers of every road containing one are its concurrent numbers: the main road out of Coldwater
// carries 1, 2 and 3. `numberOf(route)` answers a whole road's own number.
export function concurrency(routes, numberOf) {
  const bySeed = new Map();
  for (const r of routes) {
    const n = numberOf(r); if (!n) continue;
    for (const g of r.segments || []) {
      const set = bySeed.get(g.seedKey) || bySeed.set(g.seedKey, new Set()).get(g.seedKey);
      set.add(String(n));
    }
  }
  const sort = (a, b) => (Number(a) - Number(b)) || (a < b ? -1 : 1);
  return (seedKey) => [...(bySeed.get(seedKey) || [])].sort(sort);
}
