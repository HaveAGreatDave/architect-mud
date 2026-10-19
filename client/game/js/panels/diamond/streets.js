// DEADBALL · A GAME NIGHT ON THE STREETS. The life round the park, worked out from the set the city
// is built on (client/shared/city-set.js): cars parked at the kerbs near the park, cars going by with
// their lights on, and people walking to the gates, thick by the main gate and thinning out with
// distance; and the crossing outside the main gate the street camera stands on.
//
// Everything is placed once a venue. What moves goes along a straight way at its own speed and
// comes round again, so where anything is is a function of the world's clock: every TV has the same
// street at the same moment, and a stopped clock draws it still.
//
// Pure: no DOM and no GL. gl/streetlife.js draws it.

import { composeSet, insidePoly, rayTo } from '../../../../shared/city-set.js';

// The street's numbers, in feet and feet a second: how far from home plate cars park, how many of
// the kerb's spaces are taken and how long a space is; where across a road tile the parked cars,
// the traffic and the pavements are (0 one side, 1 the other); how far apart the cars going one way
// are and how fast they go; the shortest street that carries traffic (tiles); how many people walk
// to the gates and how fast, how far out they start, and how many of them walk the streets on the
// way in rather than across the plaza; and how far from each end of a way something comes and goes.
export const STREETS = Object.freeze({
  park: 1500, taken: 0.72, bay: 19, kerb: 0.17, lane: 0.37, pave: 0.07,
  every: 340, speed: Object.freeze([24, 36]), run: 4,
  walkers: 1900, walk: Object.freeze([4.0, 5.2]), reach: 1300, onStreets: 0.3,
  fade: 24,
});
// The gates, their bearings from home plate (degrees, 0 out to centre field) and the share of the
// crowd each takes: the Coliseum's main gate on Sorrel Way, straight across from home plate on the
// third-base side (gl/ballpark-mesh.js), its bleacher gate on Halcyon Boulevard past right-centre,
// and a door on each of the other two sides.
export const GATES = Object.freeze([
  Object.freeze({ name: 'main', bearing: 135, share: 0.55 }), Object.freeze({ name: 'first', bearing: -105, share: 0.15 }),
  Object.freeze({ name: 'third', bearing: 105, share: 0.15 }), Object.freeze({ name: 'bleachers', bearing: -8, share: 0.15 }),
]);
// The street camera: the crossing nearest this point out from the main gate on Sorrel Way, a street
// camera's height up, looking up at the gate and the name plate over it, and its lens.
export const STREET_EYE = Object.freeze({ near: Object.freeze([226, 0, -226]), y: 6, at: Object.freeze([120, 70, -120]), fov: 54 });
// The floats a car and a walker take (gl/streetlife.js reads them):
//   car: where it is or its way starts (x, z), the way it goes (x, z), how long the way is (0 parked),
//     its speed, its phase, its paint (linear r, g, b), whether its lights are on, its seed;
//   walker: where the way starts (x, z), the way (x, z), how long it is, the speed, the phase, the
//     shirt (linear r, g, b), the skin (0 to 1), the size.
export const CAR_STRIDE = 12, WALKER_STRIDE = 12;

function hashStr(s) {
  let h = 2166136261;
  for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 2246822507); h ^= h >>> 13;
  return h >>> 0;
}
const unit = (s) => hashStr(s) / 4294967296;
const lin1 = (c) => { const x = c / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
const hexLin = (h) => [1, 3, 5].map((i) => lin1(parseInt(h.slice(i, i + 2), 16)));
// a city's cars: mostly dark, grey and white, now and then a colour
const PAINT = Object.freeze(['#16181c', '#2a2d33', '#5c6067', '#8b8f95', '#c8c9c6', '#e3e2dc', '#5e1a1c', '#1d3557', '#3a4a2e', '#8a6d3b', '#0f2f2f', '#6b2d5c'].map(hexLin));
const SHIRTS = Object.freeze(['#1d2b4a', '#2f6f73', '#e8e4d8', '#a83e1c', '#2b2b2b', '#6b6f75', '#8c1c2c', '#d9b44a', '#3b5e2b', '#4a3a6b'].map(hexLin));

// The street cameras' eyes for a composed set: on the crossing outside the main gate and the two
// road tiles next nearest it, a street camera's height up, each on the corner of its tile's pavement
// nearest the gate, out of the traffic.
export function streetEyes(set) {
  const roads = [], n = STREET_EYE.near, g = STREET_EYE.at;
  for (const [k, t] of set.cells) {
    if (t !== 'road') continue;
    const [i, j] = k.split(',').map(Number);
    roads.push([i, j, set.cellPt(i, j)]);
  }
  const d = (p, q) => Math.hypot(p[0] - q[0], p[2] - q[2]);
  return roads.sort((a, b) => d(a[2], n) - d(b[2], n)).slice(0, 3).map(([i, j]) => {
    const corners = [[0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]].map(([a, b]) => set.cellPt(i, j, a, b));
    const c = corners.sort((p, q) => d(p, g) - d(q, g))[0];
    return [c[0], STREET_EYE.y, c[2]];
  });
}

// The set as the broadcast composes it: once to find the crossing outside the main gate, then again
// keeping anything tall clear of the street cameras there.
export function venueSet({ site, skyline, outline, art = null }) {
  const probe = composeSet({ site, skyline, outline, art });
  return composeSet({ site, skyline, outline, art, cameras: streetEyes(probe) });
}

// The street camera for a set: { eye, at, fov }, from the crossing outside the main gate.
export function streetShot(set) {
  const eye = streetEyes(set)[0];
  return eye ? { eye, at: STREET_EYE.at.slice(), fov: STREET_EYE.fov } : null;
}

// Where each gate is, on the park's outside wall: [{ name, at: [x, 0, z], out: [x, 0, z] (the way
// out of it), th (its bearing from home plate, radians), r (how far out it is), share }].
export function gatesOf(outline) {
  return GATES.map((g) => {
    const th = (g.bearing * Math.PI) / 180, r = rayTo(outline, th) + 4, out = [Math.sin(th), 0, Math.cos(th)];
    return { name: g.name, at: [out[0] * r, 0, out[2] * r], out, th, r, share: g.share };
  });
}

// The streets' runs for a set: each straight run of road tiles at least STREETS.run long, down a
// column (`ns`) or along a row, as { a: [i, j], n, ns }.
function runsOf(set) {
  const { iMin, iMax, jMin, jMax } = set.grid, road = (i, j) => set.cells.get(i + ',' + j) === 'road', out = [];
  for (let i = iMin; i <= iMax; i++) {
    for (let j = jMin; j <= jMax;) {
      if (!road(i, j)) { j++; continue; }
      let k = j; while (k + 1 <= jMax && road(i, k + 1)) k++;
      if (k - j + 1 >= STREETS.run) out.push({ a: [i, j], n: k - j + 1, ns: true });
      j = k + 1;
    }
  }
  for (let j = jMin; j <= jMax; j++) {
    for (let i = iMin; i <= iMax;) {
      if (!road(i, j)) { i++; continue; }
      let k = i; while (k + 1 <= iMax && road(k + 1, j)) k++;
      if (k - i + 1 >= STREETS.run) out.push({ a: [i, j], n: k - i + 1, ns: false });
      i = k + 1;
    }
  }
  return out;
}

// The cars and the people for a composed set (venueSet's) and the park's outline: { cars, walkers }
// (Float32Arrays, CAR_STRIDE and WALKER_STRIDE a record) and { parked, moving, walking } counts.
export function streetLife(set, outline) {
  const T = set.T, cars = [], walkers = [];
  const road = (i, j) => set.cells.get(i + ',' + j) === 'road';
  const P = (i, j, a, b) => set.cellPt(i, j, a, b);
  const away = (p) => insidePoly(outline, p, 12);
  const cellOf = (p) => { const [u, w] = set.uvOf(p); return set.cells.get(Math.floor(u / T) + ',' + Math.floor(-w / T)); };
  // a way that keeps outside the park's wall all along it
  const outside = (a, b) => { for (let k = 1; k <= 16; k++) { const f = k / 16; if (insidePoly(outline, [a[0] + (b[0] - a[0]) * f, 0, a[2] + (b[2] - a[2]) * f])) return false; } return true; };
  // nothing parked, and nobody walking, right in front of a street camera's lens
  const eyes = set.cameras?.length ? set.cameras : streetEyes(set);
  const nearLens = (p, r) => eyes.some((e) => Math.hypot(p[0] - e[0], p[2] - e[2]) < r);
  const passesLens = (a, b, r) => eyes.some((e) => {
    const ex = b[0] - a[0], ez = b[2] - a[2], L2 = ex * ex + ez * ez || 1, t = Math.max(0, Math.min(1, ((e[0] - a[0]) * ex + (e[2] - a[2]) * ez) / L2));
    return Math.hypot(a[0] + ex * t - e[0], a[2] + ez * t - e[2]) < r;
  });
  let parked = 0, moving = 0;
  // ── parked at the kerbs, along straight road tiles near the park ──
  for (const [k, t] of set.cells) {
    if (t !== 'road') continue;
    const [i, j] = k.split(',').map(Number);
    const ns = (road(i, j - 1) || road(i, j + 1)) && !road(i - 1, j) && !road(i + 1, j);
    const ew = (road(i - 1, j) || road(i + 1, j)) && !road(i, j - 1) && !road(i, j + 1);
    if (!ns && !ew) continue;
    const c = P(i, j), far = Math.hypot(c[0], c[2]);
    if (far > STREETS.park) continue;
    const bays = Math.max(1, Math.floor(T / STREETS.bay));
    for (const side of [STREETS.kerb, 1 - STREETS.kerb]) {
      for (let s = 0; s < bays; s++) {
        const id = `p|${k}|${side}|${s}`;
        if (unit(id) >= STREETS.taken * (1 - 0.4 * far / STREETS.park)) continue;
        const along = (s + 0.5) / bays, at = ns ? P(i, j, side, along) : P(i, j, along, side);
        if (away(at) || nearLens(at, 46)) continue;
        const dir = ns ? sub2(P(i, j, side, 1), P(i, j, side, 0)) : sub2(P(i, j, 1, side), P(i, j, 0, side));
        const flip = unit(id + '|f') < 0.5 ? -1 : 1, paint = PAINT[Math.floor(unit(id + '|c') * PAINT.length)];
        cars.push(at[0], at[2], dir[0] * flip, dir[1] * flip, 0, 0, 0, paint[0], paint[1], paint[2], 0, unit(id + '|s'));
        parked++;
      }
    }
  }
  // ── going by, both ways along every street, their lights on ──
  for (const r of runsOf(set)) {
    const [i, j] = r.a, n = r.n;
    for (const lane of [STREETS.lane, 1 - STREETS.lane]) {
      // each side of the road keeps to its own way: down the lane one way, up the other
      const fwd = lane < 0.5;
      const A = r.ns ? P(i, j, lane, 0) : P(i, j, 0, lane), B = r.ns ? P(i, j + n - 1, lane, 1) : P(i + n - 1, j, 1, lane);
      const from = fwd ? A : B, to = fwd ? B : A, L = Math.hypot(to[0] - from[0], to[2] - from[2]), dir = [(to[0] - from[0]) / L, (to[2] - from[2]) / L];
      const count = Math.max(1, Math.round(L / STREETS.every));
      for (let c = 0; c < count; c++) {
        const id = `m|${i},${j}|${r.ns ? 'n' : 'e'}|${lane}|${c}`, paint = PAINT[Math.floor(unit(id + '|c') * PAINT.length)];
        const v = STREETS.speed[0] + (STREETS.speed[1] - STREETS.speed[0]) * unit(id + '|v');
        cars.push(from[0], from[2], dir[0], dir[1], L, v, (c + 0.6 * unit(id + '|p')) / count, paint[0], paint[1], paint[2], 1, unit(id + '|s'));
        moving++;
      }
    }
  }
  // ── walking to the gates: across the plaza from the ring road, and along the streets further out ──
  const gates = gatesOf(outline), plaza = [], streets = [];
  for (const [k, t] of set.cells) {
    const [i, j] = k.split(',').map(Number), c = P(i, j);
    if (t === 'plaza' && !away(c)) plaza.push([i, j, c]);
    else if (t === 'road') {
      // ⚠ THE RING ROAD IS THE ONE BESIDE THE SUPERBLOCK, plaza or park: the Coliseum's square bowl
      // fills its superblock, so there's no plaza between the wall and the road
      const ring = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([di, dj]) => { const n = set.cells.get((i + di) + ',' + (j + dj)); return n === 'plaza' || n === 'park'; });
      (ring ? plaza : streets).push([i, j, c]);
    }
  }
  const pickGate = (u) => { let acc = 0; for (const g of gates) { acc += g.share; if (u < acc) return g; } return gates[0]; };
  const shirtOf = (id) => SHIRTS[Math.floor(unit(id + '|sh') * SHIRTS.length)];
  const nStreet = Math.round(STREETS.walkers * STREETS.onStreets), nPlaza = STREETS.walkers - nStreet;
  for (let w = 0; w < nPlaza && plaza.length; w++) {
    const id = `w|${w}`, g = pickGate(unit(id + '|g'));
    // from a tile of the plaza or the ring road on the gate's side, nearer ones likelier
    let best = null, bs = -Infinity;
    for (let tries = 0; tries < 6; tries++) {
      const cell = plaza[Math.floor(unit(`${id}|c|${tries}`) * plaza.length)], p = cell[2];
      const d = Math.hypot(p[0] - g.at[0], p[2] - g.at[2]), facing = ((p[0] - g.at[0]) * g.out[0] + (p[2] - g.at[2]) * g.out[2]) / Math.max(d, 1);
      const score = facing - d / 500 + 0.3 * unit(`${id}|s|${tries}`);
      if (facing > 0.2 && score > bs) { bs = score; best = cell; }
    }
    if (!best) continue;
    // to somewhere along the 30 ft of wall round the gate, just outside it
    const [i, j] = best, start = P(i, j, 0.15 + 0.7 * unit(id + '|a'), 0.15 + 0.7 * unit(id + '|b'));
    const th = g.th + ((unit(id + '|e') - 0.5) * 30) / g.r, r = rayTo(outline, th) + 4, end = [Math.sin(th) * r, 0, Math.cos(th) * r];
    const L = Math.hypot(end[0] - start[0], end[2] - start[2]);
    if (L < 20 || passesLens(start, end, 14) || !outside(start, end)) continue;
    const sh = shirtOf(id), v = STREETS.walk[0] + (STREETS.walk[1] - STREETS.walk[0]) * unit(id + '|v');
    walkers.push(start[0], start[2], (end[0] - start[0]) / L, (end[2] - start[2]) / L, L, v, unit(id + '|p'), sh[0], sh[1], sh[2], unit(id + '|k'), 0.92 + 0.16 * unit(id + '|z'));
  }
  for (let w = 0; w < nStreet && streets.length; w++) {
    const id = `ws|${w}`, cell = streets[Math.floor(unit(id + '|c') * streets.length)], [i, j, c] = cell;
    const far = Math.hypot(c[0], c[2]);
    // fewer further out
    if (far > STREETS.reach || unit(id + '|keep') > Math.min(1, 520 / far)) continue;
    const ns = road(i, j - 1) || road(i, j + 1), side = unit(id + '|side') < 0.5 ? STREETS.pave : 1 - STREETS.pave;
    const A = ns ? P(i, j, side, 0) : P(i, j, 0, side), B = ns ? P(i, j, side, 1) : P(i, j, 1, side);
    // along the pavement toward the park, over a few tiles, for as far as the street goes
    const toward = Math.hypot(A[0], A[2]) > Math.hypot(B[0], B[2]) ? [A, B] : [B, A];
    const [from, to] = toward, L0 = Math.hypot(to[0] - from[0], to[2] - from[2]);
    let L = 0;
    for (let d = 5; d <= L0 * 3; d += 5) {
      const q = [from[0] + ((to[0] - from[0]) * d) / L0, 0, from[2] + ((to[2] - from[2]) * d) / L0];
      if (cellOf(q) !== 'road' || insidePoly(outline, q)) break;
      L = d;
    }
    if (L < L0 || passesLens(from, [from[0] + ((to[0] - from[0]) * L) / L0, 0, from[2] + ((to[2] - from[2]) * L) / L0], 14)) continue;
    const sh = shirtOf(id), v = STREETS.walk[0] + (STREETS.walk[1] - STREETS.walk[0]) * unit(id + '|v');
    walkers.push(from[0], from[2], (to[0] - from[0]) / L0, (to[2] - from[2]) / L0, L, v, unit(id + '|p'), sh[0], sh[1], sh[2], unit(id + '|k'), 0.92 + 0.16 * unit(id + '|z'));
  }
  return { cars: new Float32Array(cars), walkers: new Float32Array(walkers), stats: { parked, moving, walking: walkers.length / WALKER_STRIDE } };
}
function sub2(b, a) { const x = b[0] - a[0], z = b[2] - a[2], l = Math.hypot(x, z) || 1; return [x / l, z / l]; }

// Where a car or a walker is at time t (s): [x, z] on the ground and how far along its way it has
// come, and how much of it shows (it comes and goes over STREETS.fade at each end of its way). The
// same sums gl/streetlife.js's vertex shaders do.
export function along(rec, o, t) {
  const L = rec[o + 4], v = rec[o + 5];
  if (!(L > 0) || !(v > 0)) return { x: rec[o], z: rec[o + 1], s: 0, show: 1 };
  const s = (((rec[o + 6] + (t * v) / L) % 1) + 1) % 1 * L;
  const show = Math.min(1, s / STREETS.fade, (L - s) / STREETS.fade);
  return { x: rec[o] + rec[o + 2] * s, z: rec[o + 1] + rec[o + 3] * s, s, show: Math.max(0, show) };
}
