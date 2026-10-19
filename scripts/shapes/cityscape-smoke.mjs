// Cityscape smoke: the city round Deadball's park, composed and built without a GPU.
//
// The broadcast's park is full size, so the city the cameras see past its walls is a set built
// from the map's buildings (docs/proposals/deadball-glass2.md, On TV the city is a set). This
// builds it the way a client does, from the content tree instead of the server's memory:
//
//   1. THE SKYLINE. The buildings within reach of the venue's site, and the edges round it, from
//      the content tree's zones (client/shared/skyline-manifest.js, with the engine's own rule
//      for a building's door).
//   2. THE SET. client/shared/city-set.js composes it round the full park's outline: every
//      building gets a plot, its place on the water or its place past a wall, none inside the
//      park; bearings from home plate move under 3° at the median and under 25° within 900 ft;
//      the edges are straight and on tile lines; every plot fronts a street or backs onto the
//      set's edge; the park stands in its superblock; nothing tall stands within 48 ft of a
//      street-level camera. It's composed as the broadcast composes it (diamond/streets.js
//      venueSet), so the cameras are the street cameras the renderer uses.
//   3. THE CITY. gl/cityscape.js builds it: every building resolves to a shape at the flight
//      sim's size, every float finite and every material one the park's shader knows, every road
//      tile drawn from its arms, the lamps outside the park, the Curtain on the walls, and the
//      lot inside its triangle budget; and every building lit as its model is
//      (client/shared/building-lights.js), its lamps, neon, searchlights and plumes finite, on
//      the building and outside the park, and a beacon on every tall roof, its own or the city's.
//   4. THE STREETS. diamond/streets.js: the street camera on a pavement corner of the crossing
//      outside the main gate with nothing built between it and the sign; cars parked on the kerbs
//      and going by in their lanes, people walking in to the gates, every one of them finite,
//      outside the park, on a road or the plaza wherever it is on its way, and clear of the lens.
//   5. NO REGION NAMED. The engine files say nothing about Coldwater: the site, the skyline and
//      the venue's art direction say it all.
//
// It proves the set composes and the city builds. It doesn't draw a frame: the sandbox page
// (tools/sandbox/deadball-park-test.html?park=3d) is for looking.
//
// Run:  node scripts/shapes/cityscape-smoke.mjs

import { readdirSync, readFileSync } from 'node:fs';
import { performance as clock } from 'node:perf_hooks';

const ROOT = new URL('../../', import.meta.url);
const P = '../../client/game/js/panels/';
const { skylineFrom } = await import('../../client/shared/skyline-manifest.js');
const { composeSet, insidePoly, SET_STYLES } = await import('../../client/shared/city-set.js');
const { CURTAIN_H } = await import('../../client/shared/skyline-scale.js');
const { buildingEntranceDir } = await import('../../server/engine/world.js');
const { parkOutline, venueField } = await import(P + 'diamond/geo.js');
const M = await import(P + 'gl/ballpark-mesh.js');
const { buildCityscape, cityShape } = await import(P + 'gl/cityscape.js');
const { venueSet, streetShot, streetEyes, streetLife, along, gatesOf, STREETS, STREET_EYE, CAR_STRIDE, WALKER_STRIDE } = await import(P + 'diamond/streets.js');

let failures = 0, passes = 0;
const check = (label, ok, detail) => {
  if (ok) { passes++; return; }
  failures++;
  console.log(`  FAIL ${label}${detail ? ` (${detail})` : ''}`);
};

// ── 1. the skyline ───────────────────────────────────────────────────────────
const t0 = clock.now();
const zones = [];
const zdir = new URL('content/zones/', ROOT);
for (const f of readdirSync(zdir)) {
  if (!f.endsWith('.json')) continue;
  const z = JSON.parse(readFileSync(new URL(f, zdir), 'utf8'));
  if (z.map_id === 'map_world') zones.push(z);
}
const row = JSON.parse(readFileSync(new URL('content/media_broadcasts/bc_1783289744953.json', ROOT), 'utf8'));
const venue = row.sports_pools?.venue;
check('the venue has a site', Number.isFinite(venue?.site?.x) && Number.isFinite(venue?.site?.y) && Number.isFinite(venue?.site?.bearing) && !!venue?.site?.block);
check('the venue has a name for its sign', typeof venue?.name === 'string' && venue.name.trim().length > 0);
const REACH = 40;
const sky = skylineFrom(zones, venue.site, { radius: REACH, entranceOf: buildingEntranceDir });
check('the skyline has its buildings', sky.buildings.length > 150, `${sky.buildings.length}`);
check('the skyline has an edge on every side', ['w', 'e', 'n', 's'].every((s) => sky.edges[s]), JSON.stringify(Object.keys(sky.edges)));
check('every skyline row has a tile and a type', sky.buildings.every((b) => Number.isInteger(b.x) && Number.isInteger(b.y) && typeof b.t === 'string' && b.t));
check('the skyline is nearest first', sky.buildings.every((b, i, a) => i === 0 || Math.hypot(a[i - 1].x + 0.5 - venue.site.x, a[i - 1].y + 0.5 - venue.site.y) <= Math.hypot(b.x + 0.5 - venue.site.x, b.y + 0.5 - venue.site.y) + 1e-9));
check('the skyline is small enough to send', JSON.stringify(sky).length < 40000, `${JSON.stringify(sky).length} bytes`);

// ── 2. the set ───────────────────────────────────────────────────────────────
const outline = parkOutline(venueField(venue));
const blk = venue.site.block;
const inBlock = (b) => b.x >= blk.x0 && b.x <= blk.x1 && b.y >= blk.y0 && b.y <= blk.y1;
// composed as the broadcast composes it: once to find the street cameras on the crossing outside
// the main gate and the road tiles next nearest it, then again keeping tall things clear of them
const t1 = clock.now();
const set = venueSet({ site: venue.site, skyline: sky, outline, art: venue.city });
const composeMs = clock.now() - t1;
const cameras = set.cameras;
const T = set.T;
const want = sky.buildings.filter((b) => !inBlock(b));
check('every building outside the park block is placed', set.unplaced.length === 0 && set.placed.length === want.length, `${set.placed.length} of ${want.length}; unplaced ${set.unplaced.join(', ')}`);
check('no building on the park block', set.placed.every(({ b }) => !inBlock(b)));
{
  let inside = [];
  for (const { b, at } of set.placed) if (insidePoly(outline, at, T * 0.5)) inside.push(b.n || b.t);
  check('no building inside the park', inside.length === 0, inside.slice(0, 5).join(', '));
}
{
  const used = new Set(), twice = [], notPlot = [];
  for (const p of set.placed) {
    if (!p.cell) continue;
    const k = p.cell.join(',');
    if (used.has(k)) twice.push(k);
    used.add(k);
    if (set.cells.get(k) !== 'plot') notPlot.push(k);
  }
  check('a building a plot, and only on a plot', twice.length === 0 && notPlot.length === 0, `twice ${twice.length}, not a plot ${notPlot.length}`);
  check('every building has a plot, the water or its own place', set.placed.every((p) => p.cell || p.loose));
}
{
  const wet = set.placed.filter((p) => p.wet), side = ['n', 's', 'w', 'e'].find((s) => set.walls.kinds[s] === 'shore');
  const off = (p) => { const [u, v] = set.uvOf(p.at); return side === 'n' ? v - set.walls.vN : side === 's' ? set.walls.vS - v : side === 'w' ? set.walls.uW - u : u - set.walls.uE; };
  check('what stands on the water stands past the shore', !side || wet.every((p) => off(p) > 0), wet.filter((p) => off(p) <= 0).map((p) => p.b.n || p.b.t).join(', '));
  check('the water has its piers', !side || wet.length > 0, `${wet.length}`);
}
check('bearings move under 3° at the median', set.bearing.median < 3, `${set.bearing.median.toFixed(2)}°`);
check('bearings move under 25° within 900 ft', !set.bearing.worstNear || set.bearing.worstNear.d < 25, JSON.stringify(set.bearing.worstNear));
{
  const { uW, uE, vN, vS, kinds } = set.walls;
  const onLine = (w) => Math.abs(w / T - Math.round(w / T)) < 1e-9;
  check('the edges are on tile lines', [uW, uE, vN, vS].every(onLine), JSON.stringify(set.walls));
  check('the edges stand round the park', uW < 0 && uE > 0 && vS < 0 && vN > 0);
  check('the edges are the map\'s', ['w', 'e', 'n', 's'].every((s) => kinds[s] === (sky.edges[s]?.wall != null ? 'wall' : sky.edges[s]?.shore ? 'shore' : null)), JSON.stringify(kinds));
  const { iMin, iMax, jMin, jMax } = set.grid;
  check('the set is a rectangle of cells', set.cells.size === (iMax - iMin + 1) * (jMax - jMin + 1), `${set.cells.size} cells`);
  // past every edge the outline's far point stays inside
  let out = 0;
  for (const p of outline) { const [u, v] = set.uvOf(p); if (u <= uW || u >= uE || v <= vS || v >= vN) out++; }
  check('the park is inside the edges', out === 0, `${out} outline points outside`);
}
{
  // every plot fronts a street, or backs onto the set's edge (the towers along a wall), so a
  // block is plots with streets round them
  const K = (i, j) => set.cells.get(i + ',' + j);
  let landlocked = 0, park = 0, parkWrong = 0;
  for (const [k, t] of set.cells) {
    const [i, j] = k.split(',').map(Number);
    if (t === 'plot' && ![[0, -1], [1, 0], [0, 1], [-1, 0]].some(([di, dj]) => { const n = K(i + di, j + dj); return n === 'road' || n === undefined; })) landlocked++;
    if (insidePoly(outline, set.cellPt(i, j))) { park++; if (t !== 'park') parkWrong++; }
  }
  check('every plot fronts a street or the edge', landlocked === 0, `${landlocked} plots`);
  check('the park stands in its superblock', park > 30 && parkWrong === 0, `${parkWrong} of ${park} cells under the park aren't the park's`);
}
{
  // nothing tall within 48 ft of a street-level camera
  const near = (p) => cameras.some((e) => Math.hypot(p[0] - e[0], p[2] - e[2]) <= 48);
  const tall = set.placed.filter((p) => !p.loose && (p.b.f || 0) >= 5 && near(p.at)).map((p) => p.b.n || p.b.t);
  const tallFill = set.fill.filter((f) => f.floors > 4 && near(f.at));
  check('nothing tall beside a street-level camera', cameras.length === 3 && tall.length === 0 && tallFill.length === 0, `${tall.join(', ')}; ${tallFill.length} filler`);
}
check('the filler is in the venue\'s styles', set.fill.length > 40 && set.fill.every((f) => SET_STYLES.includes(f.style) && f.floors >= 1), `${set.fill.length}`);
check('the same set twice', (() => {
  const again = venueSet({ site: venue.site, skyline: sky, outline, art: venue.city });
  return again.placed.length === set.placed.length && again.placed.every((p, i) => p.at.every((v, k) => v === set.placed[i].at[k])) && again.fill.length === set.fill.length;
})());

// ── 3. the city ──────────────────────────────────────────────────────────────
const t2 = clock.now();
const city = buildCityscape(set, { art: venue.city, outline });
const buildMs = clock.now() - t2;
const { stats } = city;
check('every building resolves to a shape', stats.missing.length === 0 && stats.buildings === set.placed.length, stats.missing.slice(0, 5).join(', '));
check('every building has a storey', set.placed.every(({ b }) => { const s = cityShape(b); return s && s.segs.length > 0 && s.storey > 0; }));
const KNOWN = new Set(Object.values(M.MAT));
let tris = 0;
{
  let bad = 0, badMat = 0, badN = 0, empty = 0;
  for (const m of [city.opaque, city.glow]) for (const [, b] of m) {
    if (!(b.n > 0 && b.n % 3 === 0)) empty++;
    tris += b.n / 3;
    const d = b.data;
    for (let v = 0; v < b.n; v++) {
      const o = v * M.STRIDE;
      for (let k = 0; k < M.STRIDE; k++) if (!Number.isFinite(d[o + k])) bad++;
      if (!KNOWN.has(d[o + 11])) badMat++;
      if (Math.abs(Math.hypot(d[o + 3], d[o + 4], d[o + 5]) - 1) > 1e-3) badN++;
    }
  }
  check('every batch has whole triangles', empty === 0, `${empty} batches`);
  check('every float finite', bad === 0, `${bad} not finite`);
  check('every material known to the park\'s shader', badMat === 0, `${badMat} vertices`);
  check('every normal a unit', badN === 0, `${badN} vertices`);
}
check('the facades are the shader\'s', city.opaque.get('city')?.n > 0 && (() => { const b = city.opaque.get('city'); for (let v = 0; v < b.n; v++) if (b.data[v * M.STRIDE + 11] !== M.MAT.FACADE) return false; return true; })());
{
  // every road tile drawn from its arms: its own quad, its arms what the cells beside it are
  const b = city.opaque.get('streets'), drawn = new Map();
  for (let v = 0; v < b.n; v += 6) {
    const o = v * M.STRIDE;
    if (b.data[o + 11] !== M.MAT.STREET || b.data[o + 9] !== 1) continue;
    const cx = (b.data[o] + b.data[o + 2 * M.STRIDE]) / 2, cz = (b.data[o + 2] + b.data[o + 2 * M.STRIDE + 2]) / 2;
    const [u, w] = set.uvOf([cx, 0, cz]);
    drawn.set(Math.floor(u / T) + ',' + Math.floor(-w / T), Math.round(b.data[o + 8] * 16));
  }
  const K = (i, j) => set.cells.get(i + ',' + j) === 'road';
  let missing = 0, wrong = 0, alone = 0, roads = 0;
  for (const [k, t] of set.cells) {
    if (t !== 'road') continue;
    roads++;
    const [i, j] = k.split(',').map(Number);
    const mask = (K(i, j - 1) ? 1 : 0) | (K(i + 1, j) ? 2 : 0) | (K(i, j + 1) ? 4 : 0) | (K(i - 1, j) ? 8 : 0);
    if (!drawn.has(k)) missing++;
    else if (drawn.get(k) !== mask) wrong++;
    if (!mask) alone++;
  }
  check('every road tile drawn from its arms', roads === stats.roads && missing === 0 && wrong === 0, `${missing} missing, ${wrong} with the wrong arms of ${roads}`);
  check('no road tile stands alone', alone === 0, `${alone}`);
}
{
  // the lamps light the streets and the plaza, never the park
  const pools = city.glow.get('pool');
  let inside = 0;
  for (let v = 0; v < pools.n; v += 6) {
    const o = v * M.STRIDE, c = [(pools.data[o] + pools.data[o + 2 * M.STRIDE]) / 2, 0, (pools.data[o + 2] + pools.data[o + 2 * M.STRIDE + 2]) / 2];
    if (insidePoly(outline, c)) inside++;
  }
  check('a lamp and its pool on the streets', stats.lamps > 300 && pools.n / 6 === stats.lamps, `${stats.lamps} lamps, ${pools.n / 6} pools`);
  check('no lamp inside the park', inside === 0, `${inside}`);
  // the city's own on a tall roof, or the model's: a lamp that blinks
  const S = city.lights.pts, blinkers = Array.from({ length: S.length / 12 }, (_, i) => i).filter((i) => (S[i * 12 + 7] & 1) && S[i * 12 + 9] > 0).length;
  check('a beacon on the tall roofs', stats.beacons + blinkers > 10, `${stats.beacons} + ${blinkers} of the models' own`);
}
{
  // the buildings' own lights (client/shared/building-lights.js): lamps, neon, searchlights and
  // plumes, every one finite and on its building, none inside the park
  const { pts, segs, beams, plumes } = city.lights, L = stats.lights;
  check('the buildings light up as their models do', stats.lit > set.placed.length * 0.9 && L.pts > 500 && L.segs > 300 && L.beams > 0 && L.plumes > 0, JSON.stringify(L) + `, ${stats.lit} lit`);
  const all = [pts, segs, beams, plumes];
  check('every light finite', all.every((a) => a.every(Number.isFinite)));
  const strides = { pts: 12, segs: 12, beams: 20, plumes: 8 };
  // where each light is: a point, both ends of a neon segment, a searchlight's lamp, a plume's mouth
  const where = [];
  for (let i = 0; i < pts.length; i += strides.pts) where.push([pts[i], pts[i + 1], pts[i + 2]]);
  for (let i = 0; i < segs.length; i += strides.segs) where.push([segs[i], segs[i + 1], segs[i + 2]], [segs[i + 3], segs[i + 4], segs[i + 5]]);
  for (let i = 0; i < beams.length; i += strides.beams) where.push([beams[i], beams[i + 1], beams[i + 2]]);
  for (let i = 0; i < plumes.length; i += strides.plumes) where.push([plumes[i], plumes[i + 1], plumes[i + 2]]);
  // within a tile and a half of a building, or within its own reach: a quay crane's boom lamps stand
  // two and a half tiles out from its middle, and only a neighbouring crane covered them
  const reachOf = (b) => {
    const s = cityShape(b);
    let r = 0;
    for (const g of s?.segs || []) for (const q of [...(g.pts || []), ...(g.bot || []), ...(g.top || []), ...(g.ribs || []).flatMap((x) => [x[0], x[1]]), ...(g.p ? [g.p] : [])]) r = Math.max(r, Math.hypot(q[0], q[1]));
    return r * T;
  };
  const reach = set.placed.map(({ b }) => Math.max(1.6 * T, reachOf(b) + 0.4 * T));
  const far = where.filter((p) => !set.placed.some(({ at }, i) => Math.hypot(p[0] - at[0], p[2] - at[2]) <= reach[i]) || p[1] < -2);
  check('every light on its building', far.length === 0, `${far.length} of ${where.length} off`);
  check('no light inside the park', where.every((p) => !insidePoly(outline, p)), `${where.filter((p) => insidePoly(outline, p)).length}`);
  let dark = 0;
  for (let i = 0; i < pts.length; i += strides.pts) if (!(pts[i + 3] > 0) || pts[i + 4] < 0 || pts[i + 5] < 0 || pts[i + 6] < 0) dark++;
  for (let i = 0; i < segs.length; i += strides.segs) if (!(segs[i + 6] > 0) || segs[i + 7] < 0) dark++;
  check('every light a size and a colour', dark === 0, `${dark}`);
}
{
  // the Curtain on every wall, straight along it and at the flight sim's height
  const walls = Object.values(set.walls.kinds).filter((k) => k === 'wall').length;
  const along = city.curtain.every(({ a, b }) => { const [ua, va] = set.uvOf(a), [ub, vb] = set.uvOf(b); return Math.abs(ua - ub) < 1e-6 || Math.abs(va - vb) < 1e-6; });
  check('the Curtain stands on every wall', city.curtain.length === walls && walls > 0, `${city.curtain.length} of ${walls}`);
  check('the Curtain runs straight, at its height', along && city.curtain.every((c) => Math.abs(c.h - CURTAIN_H * T) < 1e-9));
}
const TRI_BUDGET = 120000;
check('inside the triangle budget', tris > 20000 && tris <= TRI_BUDGET, `${Math.round(tris)} triangles`);
check('composes and builds in under 1.5 s', composeMs + buildMs < 1500, `${(composeMs + buildMs).toFixed(0)} ms`);

// ── 4. the streets ───────────────────────────────────────────────────────────
let life;
{
  const cellOf = (p) => { const [u, w] = set.uvOf(p); return set.cells.get(Math.floor(u / T) + ',' + Math.floor(-w / T)); };
  const shot = streetShot(set), eyes = streetEyes(set);
  check('the street cameras are the ones the set kept clear', eyes.length === 3 && eyes.every((e, i) => e.every((v, k) => v === cameras[i][k])));
  check('the street camera stands on the crossing outside the main gate, on the pavement, at a street camera\'s height', !!shot && cellOf(shot.eye) === 'road' && shot.eye[1] === STREET_EYE.y
    && shot.eye[2] < 0 && !insidePoly(outline, shot.eye, 12), shot && shot.eye.map((v) => v.toFixed(1)).join(','));
  // the sign over the main gate in view: nothing placed between the lens and it
  const [e, a] = [shot.eye, shot.at], blocked = set.placed.filter(({ at }) => {
    const ex = a[0] - e[0], ez = a[2] - e[2], L2 = ex * ex + ez * ez, t = Math.max(0, Math.min(1, ((at[0] - e[0]) * ex + (at[2] - e[2]) * ez) / L2));
    return Math.hypot(e[0] + ex * t - at[0], e[2] + ez * t - at[2]) < T * 0.5;
  });
  check('the street camera sees the main gate: nothing built in the way', blocked.length === 0, blocked.map((p) => p.b.n || p.b.t).join(', '));
  const t3 = clock.now();
  life = streetLife(set, outline);
  const lifeMs = clock.now() - t3;
  const { cars, walkers, stats: ls } = life;
  check('the streets have their cars and their people', ls.parked > 300 && ls.moving > 50 && ls.walking > STREETS.walkers * 0.4
    && cars.length === (ls.parked + ls.moving) * CAR_STRIDE && walkers.length === ls.walking * WALKER_STRIDE, JSON.stringify(ls));
  check('every car and walker finite', cars.every(Number.isFinite) && walkers.every(Number.isFinite));
  // wherever each one is on its way: outside the park, a car on a road, a walker on a road, the
  // plaza or the park's own ground outside its wall, and none in front of a street camera's lens
  const lens = (p, r) => eyes.some((q) => Math.hypot(p[0] - q[0], p[2] - q[2]) < r);
  let carOff = 0, carIn = 0, carLens = 0, walkOff = 0, walkIn = 0, walkLens = 0, parkedLens = 0, shows = 0;
  const TIMES = [0, 7.3, 19.1, 41.7, 66.2, 103.9];
  for (let o = 0; o < cars.length; o += CAR_STRIDE) for (const t of TIMES) {
    const q = along(cars, o, t), p = [q.x, 0, q.z], moves = cars[o + 4] > 0;
    if (!(q.show >= 0 && q.show <= 1)) shows++;
    if (cellOf(p) !== 'road') carOff++;
    if (insidePoly(outline, p)) carIn++;
    if (moves && q.show > 0 && lens(p, 14)) carLens++;
    if (!moves && lens(p, 46)) parkedLens++;
    if (!moves) break;
  }
  const gates = gatesOf(outline);
  for (let o = 0; o < walkers.length; o += WALKER_STRIDE) for (const t of [...TIMES, 1e6]) {
    // and the end of his way, at the gate
    const q = t < 1e6 ? along(walkers, o, t) : { x: walkers[o] + walkers[o + 2] * walkers[o + 4], z: walkers[o + 1] + walkers[o + 3] * walkers[o + 4], show: 0 };
    const p = [q.x, 0, q.z], c = cellOf(p);
    if (!(q.show >= 0 && q.show <= 1)) shows++;
    if (c !== 'road' && c !== 'plaza' && c !== 'park') walkOff++;
    if (insidePoly(outline, p)) walkIn++;
    if (q.show > 0 && lens(p, 14)) walkLens++;
  }
  check('every car on a road wherever it is, none in the park', carOff === 0 && carIn === 0, `${carOff} off the road, ${carIn} in the park`);
  check('every walker on a road, the plaza or the park\'s ground wherever he is, and outside the wall', walkOff === 0 && walkIn === 0, `${walkOff} off, ${walkIn} inside the wall`);
  check('nothing parked within 46 ft of a street camera, and nothing going by within 14 ft of one', parkedLens === 0 && carLens === 0 && walkLens === 0, `${parkedLens} parked, ${carLens} cars, ${walkLens} walkers`);
  check('every one shows between nothing and all of it', shows === 0, `${shows}`);
  // most of the crowd comes in by the main gate
  const byGate = gates.map(() => 0);
  for (let o = 0; o < walkers.length; o += WALKER_STRIDE) {
    const L = walkers[o + 4], end = [walkers[o] + walkers[o + 2] * L, walkers[o + 1] + walkers[o + 3] * L];
    let best = 0, bd = Infinity;
    gates.forEach((g, i) => { const d = Math.hypot(end[0] - g.at[0], end[1] - g.at[2]); if (d < bd) { bd = d; best = i; } });
    if (bd < 60) byGate[best]++;
  }
  check('the main gate takes the most of the crowd', byGate[0] > Math.max(...byGate.slice(1)) && byGate.slice(1).every((n) => n > 0), byGate.join(' / '));
  const again = streetLife(set, outline);
  check('the same streets twice', again.cars.length === cars.length && again.cars.every((v, i) => v === cars[i]) && again.walkers.every((v, i) => v === walkers[i]));
  check('the streets in under 200 ms', lifeMs < 200, `${lifeMs.toFixed(0)} ms`);
}

// ── 5. no region named ───────────────────────────────────────────────────────
for (const file of ['client/shared/city-set.js', 'client/shared/skyline-manifest.js', 'client/game/js/panels/gl/cityscape.js', 'server/engine/skyline.js', 'client/game/js/panels/gl/streetlife.js', 'client/game/js/panels/gl/parkbirds.js']) {
  const src = readFileSync(new URL(file, ROOT), 'utf8').replace(/deadball-glass2\.md/g, '');
  const hit = src.match(/coldwater|halcyon|scarlet|wildland|basin|deadball|ksab/i);
  check(`${file} names no region`, !hit, hit && hit[0]);
}

console.log(`cityscape-smoke: ${passes}/${passes + failures} passed · ${set.placed.length} buildings, ${set.fill.length} filler, ${stats.lamps} lamps, ` +
  `${life.stats.parked + life.stats.moving} cars, ${life.stats.walking} walking, ` +
  `${Math.round(tris)} triangles; composed in ${composeMs.toFixed(0)} ms, built in ${buildMs.toFixed(0)} ms (${(clock.now() - t0).toFixed(0)} ms in all)`);
process.exit(failures ? 1 : 0);
