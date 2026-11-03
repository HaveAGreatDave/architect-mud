// street-kit: does the street kit stand where the brief says it does, and do its people go round?
//
//   node scripts/shapes/street-kit.mjs
//
// Coldwater Streets (docs/proposals/coldwater-streets.md). Runs glass/street-kit.js on a fake sink,
// the way the renderer calls it, for a block of straight tiles and for each kind of junction, near
// and far, and checks the acceptance numbers: a 4.0 m lane, 5.6 m walkways raised 0.18 m, bollards
// every 2.5 m carried across tiles with the 5 m gap at the crossing, one crossing and one footbridge
// a block, the footbridge clearing a 4.2 m hauler by 2.8 m, every price in credits, nothing outside
// its tile, nothing below the core level, and nothing but the bridge and the crossing's arm over
// the lane above a driver's eye. Then glass/street-kit-walk.js on a fake window: somebody crossing a
// kit street goes over the bridge or the zebra and never through the lane.
//
// It reads the faces, not a picture, so it needs no DOM, no rasteriser and no GPU.
import { drawStreetKit, kitPlace, KIT, KIT_M, M } from '../../client/game/js/panels/glass/street-kit.js';
import { kitRoute, kitWalk } from '../../client/game/js/panels/glass/street-kit-walk.js';
import { BIRD_M_PER_TILE as TILE_M } from '../../client/shared/birds.js';

const problems = [];
const check = (ok, what) => { if (!ok) problems.push(what); };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const m = (t) => t * TILE_M;

function run(o) {
  const faces = [], lights = [], words = [];
  drawStreetKit({
    dx: 0, dy: 0, seed: 7, now: 1000, night: 0.8, alpha: 1, ...o,
    // A lit face comes over with no normal and no material, as the renderer's sink takes it.
    face: (pts, rgb, a, n, mat) => faces.push({ pts, rgb, a, n, mat: n ? mat : 'lit', given: mat }),
    light: (...args) => lights.push(args),
    text: (quad, label) => words.push({ quad, label }),
  });
  return { faces, lights, words };
}
const straight = (axis, i, n, extra = {}) => ({ axis, arms: axis, run: { i, n }, cross: i === Math.floor((n - 1) / 2), bridge: n >= 2 && i === n - 1, level: 0, ...extra });

// ── THE CROSS-SECTION ──
check(near(m(KIT.LANE_HW * 2), KIT_M.LANE), `lane is ${m(KIT.LANE_HW * 2)} m, not ${KIT_M.LANE}`);
check(near(m(KIT.OUT - KIT.LANE_HW), KIT_M.WALK), `walkway is ${m(KIT.OUT - KIT.LANE_HW)} m, not ${KIT_M.WALK}`);
check(near(m(KIT.KERB_H), KIT_M.KERB), `kerb is ${m(KIT.KERB_H)} m, not ${KIT_M.KERB}`);
check(near(KIT_M.WALK / KIT_M.LANE, 1.4), 'each walkway is 1.4 times the lane');
check(KIT.OUT < 0.5, 'the cross-section fits on one tile');
check(m(KIT.DECK_Z0) >= KIT_M.HAULER + KIT_M.CLEAR - 1e-9, `the footbridge's underside is ${m(KIT.DECK_Z0)} m, under ${KIT_M.HAULER + KIT_M.CLEAR}`);

// ── EVERY TILE KIND ──
const KINDS = [
  ['straight ns, crossing', { place: straight('ns', 1, 3), s0: 905 }],
  ['straight ns, bridge', { place: straight('ns', 2, 3), s0: 906 }],
  ['straight ew alone', { place: straight('ew', 0, 1), s0: 893 }],
  ['crossroads', { place: { axis: null, arms: 'nesw', level: 0 } }],
  ['tee', { place: { axis: null, arms: 'nes', level: 0 } }],
  ['corner', { place: { axis: null, arms: 'es', level: 0 } }],
  ['end', { place: { axis: null, arms: 'n', level: 0 } }],
];
const eye = M(KIT_M.CAB_EYE);
for (const [name, o] of KINDS) for (const tier of ['near', 'mid', 'far']) {
  const { faces, words } = run({ ...o, near: tier === 'near', far: tier === 'far' });
  check(faces.length > 0, `${name} ${tier}: draws nothing`);
  let topWalk = 0, overLane = 0;
  const ns = o.place.axis !== 'ew';
  for (const f of faces) {
    for (const [x, y, z] of f.pts) {
      if (![x, y, z].every(Number.isFinite)) { problems.push(`${name}: a non-finite point`); break; }
      // A guide-line dash centred near the tile's end reaches 1.45 m past it, and no further.
      if (Math.abs(x) > 0.5 + 0.09 || Math.abs(y) > 0.5 + 0.09) { problems.push(`${name}: a point at ${x.toFixed(3)},${y.toFixed(3)} is outside its tile`); break; }
      if (z < 0 || z > 0.65) { problems.push(`${name}: a point at z ${z}`); break; }
    }
    if (f.mat === 'metal' && f.rgb[0] > 200 && f.pts.every((p) => near(p[2], KIT.KERB_H))) topWalk++;
    check(f.n ? f.n.length === 3 && ['paint', 'metal', 'glass'].includes(f.given) : f.given == null, `${name}: a face with the wrong normal for its material`);
    // Over a straight lane, above a cab's eye, only the bridge (from its underside up) and the
    // crossing's arm may stand.
    if (o.place.axis) {
      const inLane = f.pts.every((p) => Math.abs(ns ? p[0] : p[1]) < KIT.LANE_HW);
      if (inLane && f.pts.some((p) => p[2] > eye)) overLane++;
    }
  }
  check(topWalk > 0, `${name} ${tier}: no chrome walkway at kerb height`);
  if (o.place.axis && !o.place.bridge && !o.place.cross) check(overLane === 0, `${name}: ${overLane} faces over the lane above a driver's eye`);
  if (o.place.bridge) check(overLane > 0, `${name}: no footbridge over the lane`);
  for (const w of words) {
    check(!/\bCR\b/.test(w.label), `${name}: a price in CR ("${w.label}")`);
    check(w.quad.length === 4, `${name}: a sign that isn't a quad`);
  }
}

// ── NOTHING BELOW THE CORE LEVEL YET ──
for (const level of [1, 2, 3, 4, undefined]) check(run({ place: straight('ns', 0, 1, { level }), near: true }).faces.length === 0, `level ${level} draws something`);

// ── A BLOCK: BOLLARDS CARRIED ACROSS TILES, ONE CROSSING, ONE BRIDGE, PRICES IN CREDITS ──
// Five straight tiles running south from 900. A bollard's light ring is the 8-sided band at 0.8 of
// its height; its world position along the street is s0 plus its y.
const ringZ = KIT.KERB_H + M(KIT_M.BOLLARD_H) * 0.86;
const rings = [], crossings = [], bridges = [];
const labels = new Set();
for (let i = 0; i < 5; i++) {
  const s0 = 900 + i;
  const { faces, words } = run({ place: straight('ns', i, 5), s0, near: true });
  for (const f of faces) {
    if (f.mat === 'lit' && f.pts.length === 4 && f.pts.filter((p) => near(p[2], ringZ, 1e-9)).length === 2 && f.pts.every((p) => p[0] > 0 && p[0] < KIT.LANE_HW + M(1))) {
      rings.push(m(s0 + f.pts.reduce((a, p) => a + p[1], 0) / 4));
    }
    if (f.mat === 'lit' && f.rgb[0] === 255 && f.rgb[1] === 178 && f.pts.every((p) => p[2] < KIT.KERB_H && Math.abs(p[0]) < KIT.LANE_HW)) crossings.push(i);
    if (f.pts.some((p) => p[2] >= KIT.DECK_Z0 - 1e-9 && Math.abs(p[0]) < KIT.LANE_HW)) bridges.push(i);
  }
  for (const w of words) labels.add(w.label);
}
// Eight faces a ring, one ring a bollard: their centres, deduplicated to the millimetre.
const caps = [...new Set(rings.map((c) => Math.round(c * 1000)))].map((c) => c / 1000).sort((a, b) => a - b);
const merged = caps.filter((c, k) => k === 0 || c - caps[k - 1] > 0.3);
const gaps = merged.slice(1).map((c, k) => c - merged[k]);
const ordinary = gaps.filter((g) => g < 4);
check(ordinary.length > 20, `only ${ordinary.length} bollard gaps in a five-tile block`);
check(ordinary.every((g) => near(g, KIT_M.BOLLARD_EVERY, 0.02)), `bollards not every ${KIT_M.BOLLARD_EVERY} m: ${[...new Set(ordinary.map((g) => g.toFixed(3)))].join(', ')}`);
const wide = gaps.filter((g) => g >= 4);
check(wide.length === 1 && wide[0] >= 5, `the crossing's bollard gap: ${wide.map((g) => g.toFixed(2)).join(', ') || 'none'}`);
const crossTiles = [...new Set(crossings)];
check(crossTiles.length === 1 && crossTiles[0] === 2, `crossing on tiles ${crossTiles.join(', ') || 'none'}, not the middle one`);
const bridgeTiles = [...new Set(bridges)];
check(bridgeTiles.length === 1 && bridgeTiles[0] === 4, `footbridge on tiles ${bridgeTiles.join(', ') || 'none'}, not the last one`);
for (const want of ['₵1 A RIDE', '₵2 · CROSS', '₵40', 'RESPAWN', 'LICENSED', 'FREE CROSSING · CLEARANCE 7.0 M']) check(labels.has(want), `no "${want}" on the block`);

// ── THE PEOPLE ──
// A window with a north-south kit street down column 10, crossroads on rows 4 and 10, so rows 5-9
// are one block: crossing on row 7, footbridge on row 9.
const R = 10, N = 21, WC = 100;
const grid = Array.from({ length: N }, (_, ry) => Array.from({ length: N }, (_, rx) => {
  const main = rx === R, cross = ry === 4 || ry === 10;
  if (main && cross) return { road: 1, rd: 'nesw', sc: 0 };
  if (main) return { road: 1, rd: 'ns', sc: 0 };
  if (cross) return { road: 1, rd: 'ew', sc: 0 };
  return { bt: 'office' };
}));
const win = { at: (x, y) => grid[y] && grid[y][x], wide: () => false, R, wcx: WC, wcy: WC };
const wpt = (rx, ry, lx, ly) => [rx - R + WC + lx, ry - R + WC + ly];
check(kitPlace(win.at, R, 7, win.wide)?.cross === true, 'the block\'s middle tile has no crossing');
check(kitPlace(win.at, R, 9, win.wide)?.bridge === true, 'the block\'s last tile has no footbridge');
// Somebody on the west walkway of row 6 who needs the east walkway of row 6, walked frame by frame.
const walkAcross = (frugal) => {
  const h = {}, [ax, ay] = wpt(R, 6, -KIT.WALK_V, 0), [bx, by] = wpt(R, 6, KIT.WALK_V, 0);
  let t = 0, top = 0, inLane = 0, done = false;
  kitWalk(h, ax, ay, 0, t, win, frugal);
  for (let k = 0; k < 4000 && !done; k++) {
    t += 100;
    const p = kitWalk(h, bx, by, 0, t, win, frugal);
    top = Math.max(top, p.z);
    const lat = p.x - (WC + 0);
    if (Math.abs(lat) < KIT.LANE_HW && p.z < KIT.DECK_Z0 && !(Math.abs(p.y - (WC - 3)) < M(KIT_M.ZEBRA_L))) inLane++;
    done = Math.hypot(p.x - bx, p.y - by) < 1e-6;
  }
  return { top, inLane, done };
};
const walker = walkAcross(true), payer = walkAcross(false);
check(walker.done && payer.done, 'somebody crossing the street never got there');
check(walker.top >= KIT.DECK_Z1 - 1e-9, `a frugal walker never went up onto the bridge (top ${walker.top.toFixed(3)})`);
check(payer.top < KIT.DECK_Z0, 'somebody who pays went over the bridge instead of the zebra');
check(walker.inLane === 0 && payer.inLane === 0, `people walked in the lane: ${walker.inLane} and ${payer.inLane} frames`);
// And somebody walking along one side never leaves it.
{
  const h = {}, [ax, ay] = wpt(R, 5, KIT.WALK_V, 0), [bx, by] = wpt(R, 9, KIT.WALK_V, 0);
  kitWalk(h, ax, ay, 0, 0, win, true);
  let maxZ = 0;
  for (let k = 1; k < 2000; k++) maxZ = Math.max(maxZ, kitWalk(h, bx, by, 0, k * 100, win, true).z);
  check(maxZ < KIT.DECK_Z0, 'somebody walking along one side went over the bridge');
}
check(kitRoute(win, null, null, true) === null, 'a route with no ends');

if (process.argv.includes('--report')) {
  console.log({ bollardGaps: ordinary.length, crossingGap: wide.map((g) => +g.toFixed(2)), crossTiles, bridgeTiles,
    walker: { top: +m(walker.top).toFixed(2), inLane: walker.inLane }, payer: { top: +m(payer.top).toFixed(2), inLane: payer.inLane }, labels: [...labels] });
}

if (problems.length) {
  console.error(`street-kit: ${problems.length} problem(s)`);
  for (const p of problems.slice(0, 40)) console.error('  ' + p);
  process.exit(1);
}
