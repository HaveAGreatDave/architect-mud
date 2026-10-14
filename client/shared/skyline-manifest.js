// The skyline round a site: the buildings within reach of it, and the edges a city stands
// inside, from the map's own tiles. The broadcast's 3-D park composes its city from it
// (client/shared/city-set.js), and the cold open's flythrough draws the same building rows.
//
// Pure over a list of zone rows, so the server (server/engine/skyline.js, over the in-memory
// world), a gate (over the content tree) and the sandbox (over the flight sim's baked world) all
// build it the one way. It names no region: the site and a radius say which buildings, and the
// map's Curtain tiles and water say where the edges are. The side a building's door is on is the
// caller's to say (`entranceOf`), because the engine has the rule for it.

// One building as the skyline carries it: its tile, type, floors, name, the side its door is
// on, and `w` when it stands on the water (a pier, a pontoon, a landing stage).
export function skylineEntry(z, entranceOf = (q) => q.flags?.entrance || null) {
  const f = z.flags || {};
  return {
    x: z.grid_x, y: z.grid_y, t: f.building_type, f: Number(f.floors) || 0,
    n: f.building_name || undefined, e: entranceOf(z) || undefined,
    ...(f.terrain === 'water' ? { w: 1 } : {}),
  };
}

const onSurface = (z) => z && z.map_id === 'map_world' && z.grid_x != null && z.grid_y != null && (z.grid_z ?? 0) === 0;
const isCurtain = (z) => !!(z.flags?.curtain || z.flags?.perimeter_gate);
// A line of the Curtain needs this many of its tiles within reach to count as a side's edge.
const WALL_MIN = 5;

// The skyline within `radius` tiles of `site` ({ x, y } in tile coordinates, fractions
// allowed: home plate stands inside a tile). Returns { buildings, edges }:
//
//   buildings  skylineEntry rows, nearest first
//   edges      per side of the map's grid ('w', 'e', 'n', 's'), where the city stops:
//                { wall }   the line of the Curtain, at its tiles' centre (891.5 for column 891)
//                { shore }  water instead: [[column or row, the line where land meets it], ...]
//                           (a north shore at 902 is the top edge of row 902, the first land)
//              A side with neither within reach is left out.
export function skylineFrom(zones, site, { radius = 40, entranceOf } = {}) {
  const sx = Number(site?.x), sy = Number(site?.y);
  if (!Number.isFinite(sx) || !Number.isFinite(sy)) return { buildings: [], edges: {} };
  const near = (x, y) => Math.abs(x + 0.5 - sx) <= radius && Math.abs(y + 0.5 - sy) <= radius;
  const water = new Set(), land = new Set(), curtain = [];
  const rows = [];
  for (const z of zones) {
    if (!onSurface(z) || !near(z.grid_x, z.grid_y)) continue;
    const k = z.grid_x + ',' + z.grid_y;
    if (z.flags?.terrain === 'water') water.add(k); else land.add(k);
    if (isCurtain(z)) curtain.push([z.grid_x, z.grid_y]);
    if (z.flags?.building_type && Math.hypot(z.grid_x + 0.5 - sx, z.grid_y + 0.5 - sy) <= radius) rows.push(skylineEntry(z, entranceOf));
  }
  // nearest first, then by tile, so the list is the same whatever order the zones came in
  const d = (b) => Math.hypot(b.x + 0.5 - sx, b.y + 0.5 - sy);
  rows.sort((a, b) => d(a) - d(b) || a.y - b.y || a.x - b.x);

  const edges = {};
  // The Curtain on each side: the column (or row) beyond the site holding most of its tiles.
  // A tie goes to the line nearer the site.
  const wallOf = (axis, beyond) => {
    const s = axis === 'x' ? sx : sy, count = new Map();
    for (const [x, y] of curtain) {
      const v = axis === 'x' ? x : y;
      if (beyond < 0 ? v + 0.5 < s : v + 0.5 > s) count.set(v, (count.get(v) || 0) + 1);
    }
    let best = null, n = 0;
    for (const [v, c] of count) {
      if (c > n || (c === n && Math.abs(v + 0.5 - s) < Math.abs(best + 0.5 - s))) { best = v; n = c; }
    }
    return n >= WALL_MIN ? best + 0.5 : null;
  };
  const walls = { w: wallOf('x', -1), e: wallOf('x', 1), n: wallOf('y', -1), s: wallOf('y', 1) };
  // Inside the walls (or within reach), the shore on a side without one: walking out from the
  // site, the first water each column (or row) meets, where it isn't the Curtain's own ground.
  const lo = (a) => Math.ceil(a), hi = (a) => Math.floor(a);
  const span = {
    x: [walls.w != null ? lo(walls.w) : lo(sx - radius), walls.e != null ? hi(walls.e) - 1 : hi(sx + radius)],
    y: [walls.n != null ? lo(walls.n) : lo(sy - radius), walls.s != null ? hi(walls.s) - 1 : hi(sy + radius)],
  };
  const shoreOf = (side) => {
    const out = [];
    const across = side === 'n' || side === 's' ? span.x : span.y;
    const step = side === 'n' || side === 'w' ? -1 : 1;
    for (let k = across[0]; k <= across[1]; k++) {
      let v = side === 'n' || side === 's' ? Math.floor(sy) : Math.floor(sx);
      for (let i = 0; i < radius; i++, v += step) {
        const key = side === 'n' || side === 's' ? k + ',' + v : v + ',' + k;
        if (water.has(key)) { out.push([k, step < 0 ? v + 1 : v]); break; }
        if (!land.has(key)) break;   // off the map's authored ground before any water
      }
    }
    // a shore is most of the side's length, not a pond
    return out.length >= (across[1] - across[0] + 1) / 2 ? out : null;
  };
  for (const side of ['w', 'e', 'n', 's']) {
    if (walls[side] != null) { edges[side] = { wall: walls[side] }; continue; }
    const shore = shoreOf(side);
    if (shore) edges[side] = { shore };
  }
  return { buildings: rows, edges };
}
