// WHAT MOVES OUTSIDE A WINDOW, AS DATA: the flights GLASS draws past a room (panels/room-window.js hands them
// over as contacts) and when lightning lights the room. Nothing here knows about a canvas or a GL context, so
// a gate can run all of it in Node.
//
// ⚠ TRAFFIC AND LIGHTNING ARE A PURE FUNCTION OF THE CLOCK, as a flock of birds is (docs/systems-fauna.md):
// no server state, no tick, and two people at one window see the same aeroplane and the same strike.
// Only the fields come from the world. A real pilot is a `contact`, drawn beside all this.

// a repeatable number in 0..1 from a few integers
export function hash01(...v) {
  let h = 2166136261;
  for (const x of v) { h = Math.imul(h ^ (x | 0), 16777619); h = Math.imul(h ^ (h >>> 13), 0x5bd1e995); }
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}
const idOf = (s) => { let h = 7; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 31); return h; };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// ── air traffic ─────────────────────────────────────────────────────────────────────────────────
// All in tiles and seconds. A flight leaves `from` on its route's timetable, climbs, cruises and comes
// down at `to`; a helicopter flies lower and slower, and goes between pads. Overflights cross the region
// high up on lanes that belong to the region, so a place with no airfield still sees something.
export const TRAFFIC = Object.freeze({
  range: 60,            // how far from the window a flight is worth drawing
  routeRange: 170,      // how far off a field can be and still have flights over here
  // attitude, in degrees: `alpha` is the nose above the flight path, `path` how much of that path the nose
  // follows, and `flare` the nose on short final. A helicopter climbs nose down and flares hard.
  plane: { speed: 1.5, cruise: [9, 15], climb: 0.32, every: [230, 420], len: 1.5, alpha: 5, path: 1, flare: 5 },
  heli: { speed: 0.8, cruise: [5, 8], climb: 0.5, every: [900, 1700], len: 0.75, alpha: -5, path: 0, flare: 9 },
  jet: { speed: 3.4, cruise: [24, 34], every: [130, 260], len: 2.6, lanes: 3, span: 170, block: 64, alpha: 2.5 },
  max: 6,               // how many the renderer takes
});

function routeOf(a, b) {
  const kind = a.pad || b.pad ? 'heli' : 'plane', T = TRAFFIC[kind], ia = idOf(a.id), ib = idOf(b.id);
  const d = Math.hypot(b.gx - a.gx, b.gy - a.gy);
  return { kind, T, a, b, d, ia, ib, cruise: T.cruise[0] + (T.cruise[1] - T.cruise[0]) * hash01(ia, ib, 1), every: T.every[0] + (T.every[1] - T.every[0]) * hash01(ia, ib, 2), off: hash01(ia, ib, 3) };
}

const ease = (x) => { const k = clamp(x, 0, 1); return k * k * (3 - 2 * k); };
// The height, in tiles, a flight rotates through, levels off over and flares in.
const ROTATE = 0.8, LEVEL = 1.5, FLARE = 1.2;
// The nose in degrees above the horizon, with `up` and `down` the route's height from each end. It's
// eased at each change of path, since the height itself turns a corner there.
function attitude(r, up, down, rising) {
  const T = r.T, top = Math.min(r.cruise, r.d * T.climb / 2), slope = Math.atan(T.climb) * 180 / Math.PI * T.path;
  if (rising > 0) return T.alpha + slope * ease(up / ROTATE) * ease((top - up) / LEVEL);
  if (rising === 0) return T.alpha;
  const f = ease(1 - down / FLARE);
  return (T.alpha - slope * ease((top - down) / LEVEL)) * (1 - f) + T.flare * f;
}

// Where a flight on `r` is `age` seconds after it left.
function onRoute(r, age, slot) {
  const s = age * r.T.speed, ux = (r.b.gx - r.a.gx) / r.d, uy = (r.b.gy - r.a.gy) / r.d;
  const up = s * r.T.climb, down = (r.d - s) * r.T.climb, z = Math.min(r.cruise, up, down);
  const rising = up < r.cruise && up < down ? 1 : down < r.cruise && down < up ? -1 : 0;
  return { id: `${r.ia}_${r.ib}_${slot}`, kind: r.kind, x: r.a.gx + ux * s, y: r.a.gy + uy * s, z: Math.max(0.2, z), vx: ux * r.T.speed, vy: uy * r.T.speed, vz: rising * r.T.speed * r.T.climb, pitch: attitude(r, up, down, rising), len: r.T.len };
}

// The flights a region's lanes have up at time `t`.
function overflights(gx, gy, t, out) {
  const J = TRAFFIC.jet, bx = Math.round(gx / J.block), by = Math.round(gy / J.block);
  for (let lane = 0; lane < J.lanes; lane++) {
    const ang = hash01(bx, by, lane, 11) * Math.PI * 2, every = J.every[0] + (J.every[1] - J.every[0]) * hash01(bx, by, lane, 12);
    const ox = (hash01(bx, by, lane, 13) - 0.5) * 70, oy = (hash01(bx, by, lane, 14) - 0.5) * 70;
    const ux = Math.cos(ang), uy = Math.sin(ang), z = J.cruise[0] + (J.cruise[1] - J.cruise[0]) * hash01(bx, by, lane, 15), long = J.span / J.speed;
    const shift = hash01(bx, by, lane, 16) * every, k = Math.floor((t - shift) / every);
    for (const slot of [k, k - 1]) {
      const age = t - (slot * every + shift);
      if (age < 0 || age > long) continue;
      const s = age * J.speed - J.span / 2;
      out.push({ id: `lane_${bx}_${by}_${lane}_${slot}`, kind: 'jet', x: bx * J.block + ox + ux * s, y: by * J.block + oy + uy * s, z, vx: ux * J.speed, vy: uy * J.speed, vz: 0, pitch: J.alpha, len: J.len });
    }
  }
}

// Everything in the air near (gx, gy) at `t` seconds of the wall clock, nearest first. `fields` is
// [{ id, gx, gy, pad }]: `pad` is a field only a helicopter can use.
export function airTraffic(fields, gx, gy, t, { range = TRAFFIC.range } = {}) {
  const out = [], list = (fields || []).filter((f) => Number.isFinite(f.gx) && Number.isFinite(f.gy) && Math.hypot(f.gx - gx, f.gy - gy) < TRAFFIC.routeRange);
  for (const a of list) for (const b of list) {
    if (a === b || Math.hypot(b.gx - a.gx, b.gy - a.gy) < 6) continue;
    const r = routeOf(a, b), long = r.d / r.T.speed, shift = r.off * r.every, k = Math.floor((t - shift) / r.every);
    for (let slot = k; slot >= k - Math.ceil(long / r.every); slot--) {
      const age = t - (slot * r.every + shift);
      if (age >= 0 && age <= long) out.push(onRoute(r, age, slot));
    }
  }
  overflights(gx, gy, t, out);
  return out.map((f) => ({ ...f, dist: Math.hypot(f.x - gx, f.y - gy) })).filter((f) => f.dist < range).sort((p, q) => p.dist - q.dist);
}

// ── lightning ───────────────────────────────────────────────────────────────────────────────────
// How long the thunder takes to get here, in seconds: a tile is a few metres on the map, but a storm
// isn't, so this is what a bolt at that distance should feel like and not the speed of sound.
export const thunderDelay = (dist) => 0.25 + dist * 0.11;
