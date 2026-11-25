// The bench routes: fixed drives and flights through the real city, the same every run, so a frame
// number from one machine can sit beside a number from another (docs/proposals/gl-core.md, phase 0).
//
// Plain data and arithmetic, no DOM, so scripts/perf/baseline-schema.mjs can read the names in node.
// route.js drives them in the browser (`__benchRoute`).
//
// A cab route follows the road: from its start tile it goes on in its heading while the road
// allows, turning right and then left where it doesn't, for `tiles` tiles. An air route is a
// straight line at the seat's height. Headings are degrees, 0 north (y falling), 90 east.
//
// ⚠ ADDING A ROUTE IS FINE; CHANGING ONE BREAKS EVERY BASELINE THAT NAMES IT. A baseline is only
// comparable to a run of the same route, so a changed route gets a new name.

export const ROUTES = {
  'halcyon-cab': { seat: 'cab', from: [899, 916], heading: 90, tiles: 10, hour: 13, why: 'the dearest district from the street, at noon' },
  'halcyon-cab-night': { seat: 'cab', from: [899, 916], heading: 90, tiles: 10, hour: 23, why: 'the same drive with every lamp, sign and window lit' },
  'marrow-cab': { seat: 'cab', from: [917, 909], heading: 270, tiles: 10, hour: 13, why: 'an ordinary street, for the ratio' },
  'glasshouse-cab-rain': { seat: 'cab', from: [894, 909], heading: 0, tiles: 8, hour: 21, weather: 'rain', why: 'wet roads, the mirror and the light grid' },
  'halcyon-air': { seat: 'air', from: [888, 916], heading: 90, tiles: 24, hour: 13, why: 'the cockpit over the towers: the window is four times the cab' },
  // On foot: the street view's eye, its rings (FOOT_TUNE) and near plane, and a crowd. The rooms drawn in the
  // street (gl/interiors.js) aren't in it yet: they're built at runtime from the server's room data.
  'marrow-foot': { seat: 'foot', from: [917, 909], heading: 270, tiles: 6, hour: 13, people: 110, why: 'walking the cab route with the crowd the game sends' },
};

// Per seat: how far the camera moves a frame, in tiles. A real cab at 30 mph covers about a
// hundredth of a tile a frame; the bench goes faster so a run crosses enough tiles to pay for the
// map window moving under it, which is a cost a parked camera never sees.
// On foot it's far faster than walking (about 0.0013 a frame) for the same reason, and slower than the cab.
export const SPEED = { cab: 0.05, air: 0.15, foot: 0.02 };

const DIRS = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
const ORDER = ['n', 'e', 's', 'w'];
const dirOf = (heading) => ORDER[((Math.round(heading / 90) % 4) + 4) % 4];
const right = (d) => ORDER[(ORDER.indexOf(d) + 1) % 4];
const left = (d) => ORDER[(ORDER.indexOf(d) + 3) % 4];

// The tiles a route passes through, as [x, y] tile centres. `cells` is the baked world's
// { 'x,y': cell } (client/game/flightsim-world.json).
export function routeTiles(route, cells) {
  const [x0, y0] = route.from;
  if (route.seat !== 'cab' && route.seat !== 'foot') {
    const [dx, dy] = DIRS[dirOf(route.heading)];
    return Array.from({ length: route.tiles + 1 }, (_, i) => [x0 + dx * i, y0 + dy * i]);
  }
  const road = (x, y) => { const c = cells[x + ',' + y]; return c && c.road ? c : null; };
  const opens = (c, d) => !c.rd || c.rd.includes(d);
  const out = [[x0, y0]];
  const seen = new Set([x0 + ',' + y0]);
  let x = x0, y = y0, d = dirOf(route.heading);
  while (out.length <= route.tiles) {
    const here = road(x, y);
    if (!here) break;
    let moved = false;
    for (const t of [d, right(d), left(d)]) {
      const nx = x + DIRS[t][0], ny = y + DIRS[t][1], next = road(nx, ny);
      if (!next || !opens(here, t) || seen.has(nx + ',' + ny)) continue;
      x = nx; y = ny; d = t; moved = true;
      seen.add(x + ',' + y); out.push([x, y]);
      break;
    }
    if (!moved) break;
  }
  return out;
}

// A route's crowd: `route.people` pedestrians as the server sends them (`{ t, x, y }`, absolute tiles, half of
// them women: server/engine/street-actors.js), stood on open ground within 8 tiles of the route's tiles. Seeded
// from the route, so every run draws the same people. No `g`: each takes the look its token gives (streetLook).
export function routePeople(route, tiles, cells) {
  const n = route.people || 0;
  if (!n) return [];
  const open = [];
  const seen = new Set();
  for (const [tx, ty] of tiles) {
    for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) {
      const x = tx + dx, y = ty + dy, k = x + ',' + y;
      if (seen.has(k)) continue;
      seen.add(k);
      const c = cells[k];
      if (c && c.kind === 'land' && !c.bt) open.push([x, y]);
    }
  }
  if (!open.length) return [];
  let s = (route.from[0] * 73856093) ^ (route.from[1] * 19349663) ^ n;
  const rnd = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return Array.from({ length: n }, (_, i) => {
    const [x, y] = open[Math.floor(rnd() * open.length)];
    const a = { t: 'bench' + i.toString(36), x, y };
    if (rnd() < 0.5) a.s = 1;
    return a;
  });
}

// The camera along the tiles at the seat's speed: one { x, y, heading } a frame, x and y in tiles.
// Heading follows the leg it's on and turns over the last half tile before a corner, so a turn
// sweeps the frustum the way a real one does.
export function routeFrames(route, tiles) {
  const step = SPEED[route.seat] || SPEED.cab;
  const legs = [];
  for (let i = 1; i < tiles.length; i++) {
    const [ax, ay] = tiles[i - 1], [bx, by] = tiles[i];
    legs.push({ ax, ay, bx, by, h: (Math.atan2(bx - ax, ay - by) * 180 / Math.PI + 360) % 360 });
  }
  if (!legs.length) return [{ x: tiles[0][0], y: tiles[0][1], heading: route.heading }];
  const frames = [];
  const total = legs.length;
  for (let s = 0; s <= total; s += step) {
    const i = Math.min(legs.length - 1, Math.floor(s)), f = s - i, L = legs[i];
    let h = L.h;
    const next = legs[i + 1];
    if (next && f > 0.5) {
      let dh = ((next.h - L.h + 540) % 360) - 180;
      h = (L.h + dh * (f - 0.5) * 2 + 360) % 360;
    }
    frames.push({ x: L.ax + (L.bx - L.ax) * f, y: L.ay + (L.by - L.ay) * f, heading: h });
  }
  return frames;
}
