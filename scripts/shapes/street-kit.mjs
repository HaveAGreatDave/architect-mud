// street-kit: does the street kit stand where the brief says it does, and do its people go round?
//
//   node scripts/shapes/street-kit.mjs
//
// Coldwater Streets (docs/proposals/coldwater-streets.md). Runs glass/street-kit.js on a fake sink,
// the way the renderer calls it, for a block of straight tiles and for each kind of junction, near
// and far, at all five conditions, and checks the acceptance numbers: a 4.0 m lane, 5.6 m walkways
// raised 0.18 m, bollards every 2.5 m carried across tiles with the 5 m gap at the crossing, one
// crossing and one footbridge a block, all four bridges clearing a 4.2 m hauler by 2.8 m and landing
// only in buildings tall enough, every price in credits, nothing outside its tile but an upper
// bridge, and nothing but a bridge and the crossing's arm over the lane above a driver's eye. Then
// the ladder: chrome stops at the middle ring, the belts stop at Worn and stay priced, the damage is
// the brief's share, the dirt has no paving, no lane furniture and no words, and the bridges are
// the same at every level. Then glass/street-kit-walk.js on a fake window: somebody crossing a kit
// street goes over the bridge or the zebra and never through the lane, and on the dirt walks across.
//
// It reads the faces, not a picture, so it needs no DOM, no rasteriser and no GPU.
import { drawStreetKit, kitCell, kitPaved, kitPlace, KIT, KIT_M, LEVEL, M } from '../../client/game/js/panels/glass/street-kit.js';
import { KIT_SPANS, SPAN, SPAN_M } from '../../client/game/js/panels/glass/street-kit-spans.js';
import { kitRoute, kitWalk } from '../../client/game/js/panels/glass/street-kit-walk.js';
import { BIRD_M_PER_TILE as TILE_M } from '../../client/shared/birds.js';

const problems = [];
const check = (ok, what) => { if (!ok) problems.push(what); };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const m = (t) => t * TILE_M;

function run(o) {
  const faces = [], lights = [], words = [], lines = [], plumes = [];
  drawStreetKit({
    dx: 0, dy: 0, seed: 7, now: 1000, night: 0.8, alpha: 1, ...o,
    // A lit face comes over with no normal and no material, as the renderer's sink takes it.
    face: (pts, rgb, a, n, mat) => faces.push({ pts, rgb, a, n, mat: n ? mat : 'lit', given: mat }),
    light: (...args) => lights.push(args),
    text: (quad, label, css, lit) => words.push({ quad, label, css, lit }),
    line: o.line === null ? undefined : (a, b) => lines.push([a, b]),
    steam: (x, y, seed, gain) => plumes.push({ x, y, seed, gain }),
  });
  return { faces, lights, words, lines, plumes };
}
const straight = (axis, i, n, extra = {}) => ({ axis, arms: axis, run: { i, n }, cross: i === Math.floor((n - 1) / 2), bridge: n >= 2 && i === n - 1, span: null, level: 0, ...extra });
// A straight tile at a level, as kitPlace answers: no crossing or footbridge on the dirt.
const atLevel = (level, i = 1, n = 3, extra = {}) => { const p = straight('ns', i, n, { level, ...extra }); if (LEVEL[level].dirt) { p.cross = false; p.bridge = false; } return p; };

// ── THE CROSS-SECTION ──
check(near(m(KIT.LANE_HW * 2), KIT_M.LANE), `lane is ${m(KIT.LANE_HW * 2)} m, not ${KIT_M.LANE}`);
check(near(m(KIT.OUT - KIT.LANE_HW), KIT_M.WALK), `walkway is ${m(KIT.OUT - KIT.LANE_HW)} m, not ${KIT_M.WALK}`);
check(near(m(KIT.KERB_H), KIT_M.KERB), `kerb is ${m(KIT.KERB_H)} m, not ${KIT_M.KERB}`);
check(near(KIT_M.WALK / KIT_M.LANE, 1.4), 'each walkway is 1.4 times the lane');
check(KIT.OUT < 0.5, 'the cross-section fits on one tile');
check(m(KIT.DECK_Z0) >= KIT_M.HAULER + KIT_M.CLEAR - 1e-9, `the footbridge's underside is ${m(KIT.DECK_Z0)} m, under ${KIT_M.HAULER + KIT_M.CLEAR}`);
// The brief's table of bridge heights, and every one of them over the hauler by the margin.
check(SPAN_M.SERVICE_Z[0] === 9 && SPAN_M.SERVICE_Z[1] === 16, 'the service bridge is not at 9 and 16 m');
check(SPAN_M.SKY_Z === 12.5, 'the skybridge is not at 12.5 m');
check(SPAN_M.EXEC_Z === 24, 'the executive bridge is not at 24 m');
for (const z of [...SPAN_M.SERVICE_Z, SPAN_M.SKY_Z, SPAN_M.EXEC_Z - SPAN_M.FIN_L]) check(z >= KIT_M.HAULER + KIT_M.CLEAR, `a bridge's lowest part is ${z} m`);

// ── EVERY TILE KIND ──
const KINDS = [
  // ⚠ ONE TILE WITH NOTHING ON IT. A one-tile block has its crossing on that tile, so without this
  // every straight kind carried a crossing or a bridge and the check below ran on none of them.
  ['straight ns, plain', { place: straight('ns', 0, 3), s0: 904 }],
  ['straight ew, plain', { place: straight('ew', 0, 3), s0: 889 }],
  ['straight ns, crossing', { place: straight('ns', 1, 3), s0: 905 }],
  ['straight ns, bridge', { place: straight('ns', 2, 3), s0: 906 }],
  ['straight ew alone', { place: straight('ew', 0, 1), s0: 893 }],
  ['straight ns, service', { place: straight('ns', 0, 3, { span: 'service' }), s0: 904 }],
  ['straight ew, skybridge', { place: straight('ew', 0, 3, { span: 'sky' }), s0: 890 }],
  ['straight ns, executive', { place: straight('ns', 0, 3, { span: 'exec' }), s0: 907 }],
  ['crossroads', { place: { axis: null, arms: 'nesw', level: 0 } }],
  ['tee', { place: { axis: null, arms: 'nes', level: 0 } }],
  ['corner', { place: { axis: null, arms: 'es', level: 0 } }],
  ['end', { place: { axis: null, arms: 'n', level: 0 } }],
];
const eye = M(KIT_M.CAB_EYE);
const TOP = M(SPAN_M.EXEC_Z + SPAN_M.EXEC_H) + 1e-9;
for (const [name0, o0] of KINDS) for (let level = 0; level < LEVEL.length; level++) for (const tier of ['near', 'mid', 'far']) {
  const dirt = !!LEVEL[level].dirt, name = `${name0} L${level}`;
  const o = { ...o0, place: { ...o0.place, level, ...(dirt ? { cross: false, bridge: false } : {}) } };
  const { faces, words } = run({ ...o, near: tier === 'near', far: tier === 'far' });
  check(faces.length > 0, `${name} ${tier}: draws nothing`);
  let topWalk = 0, overLane = 0;
  const ns = o.place.axis !== 'ew', span = !!o.place.span;
  for (const f of faces) {
    for (const [x, y, z] of f.pts) {
      if (![x, y, z].every(Number.isFinite)) { problems.push(`${name}: a non-finite point`); break; }
      // A guide-line dash centred near the tile's end reaches 1.45 m past it, and no further. An
      // upper bridge runs across the street past both flanks, into the buildings, and no further.
      const lat = ns ? x : y, along = ns ? y : x, reach = span ? SPAN.LAND + 0.01 : 0.5 + 0.09;
      if (Math.abs(lat) > reach || Math.abs(along) > 0.5 + 0.09) { problems.push(`${name}: a point at ${x.toFixed(3)},${y.toFixed(3)} is outside its tile`); break; }
      if (z < 0 || z > (span ? TOP : 0.65)) { problems.push(`${name}: a point at z ${z}`); break; }
    }
    if (f.mat === 'metal' && f.rgb[0] > 200 && f.pts.every((p) => near(p[2], KIT.KERB_H))) topWalk++;
    check(f.n ? f.n.length === 3 && ['paint', 'metal', 'glass', 'film'].includes(f.given) : f.given == null, `${name}: a face with the wrong normal for its material`);
    // Over a straight lane, above a cab's eye, only a bridge (from its underside up) and the
    // crossing's arm may stand.
    // A face counts if any of it is over the lane, so a deck running the whole way across counts.
    if (o.place.axis) {
      const lats = f.pts.map((p) => (ns ? p[0] : p[1]));
      const over = Math.min(...lats) < KIT.LANE_HW && Math.max(...lats) > -KIT.LANE_HW && f.pts.some((p) => p[2] > eye);
      if (over) overLane++;
      // Off the crossing, whatever is over the lane is a bridge, and clears the 7.0 m its sign says,
      // bar the footbridge's light line, set 3 cm under the deck.
      if (over && !o.place.cross) {
        const low = Math.min(...f.pts.map((p) => p[2]));
        check(low >= M(KIT_M.HAULER + KIT_M.CLEAR - 0.05), `${name}: a face over the lane at ${m(low).toFixed(2)} m`);
      }
    }
  }
  if (level === 0) check(topWalk > 0, `${name} ${tier}: no chrome walkway at kerb height`);
  if (o.place.axis && !o.place.bridge && !o.place.cross && !span) check(overLane === 0, `${name}: ${overLane} faces over the lane above a driver's eye`);
  if (o.place.bridge || span) check(overLane > 0, `${name}: no bridge over the lane`);
  for (const w of words) {
    check(!/\bCR\b/.test(w.label), `${name}: a price in CR ("${w.label}")`);
    check(w.quad.length === 4, `${name}: a sign that isn't a quad`);
  }
}
check(run({ place: straight('ns', 0, 1, { level: undefined }), near: true }).faces.length === 0, 'a tile with no level draws something');
check(run({ place: straight('ns', 0, 1, { level: 5 }), near: true }).faces.length === 0, 'level 5 draws something');

// ── WHICH TILES ──
const road = (sc, extra = {}) => ({ road: 1, rd: 'ns', sc, ...extra });
for (let sc = 0; sc <= 4; sc++) check(kitCell(road(sc)), `level ${sc} takes no kit`);
check(!kitCell(road(undefined)) && !kitCell(road(null)) && !kitCell(road(5)), 'a road with no condition takes the kit');
check(!kitCell(road(2, { ft: 'dust' })) && kitCell(road(4, { ft: 'dust' })), 'a dust road takes the paved kit, or the dirt refuses it');
check(kitPaved(road(3)) && !kitPaved(road(4)), 'the dirt counts as paved');

// ── THE UPPER BRIDGES LAND IN BUILDINGS ──
// A window with a north-south block of `n` straight tiles on column 2, rows 1 to n, crossroads at each
// end, and `flank(row, side)` the cell either side of each.
const blockAt = (n, flank, sc = 0) => (x, y) => {
  if (x === 2) return y === 0 || y === n + 1 ? { road: 1, rd: 'nesw', sc } : y >= 1 && y <= n ? { road: 1, rd: 'ns', sc } : null;
  if ((x === 1 || x === 3) && y >= 1 && y <= n) return flank(y, x < 2 ? -1 : 1);
  return null;
};
const spansIn = (n, at) => { const out = []; for (let y = 1; y <= n; y++) { const p = kitPlace(memo(at), 2, y, () => false); if (p.span) out.push([y, p.span]); } return out; };
// kitPlace keeps its answer per cell object, so a test window hands back the same object each time.
const memo = (at) => { const c = new Map(); return (x, y) => { const k = x + ',' + y; if (!c.has(k)) c.set(k, at(x, y)); return c.get(k); }; };
const tower = (flr) => ({ bt: 'office', flr });
{
  const all = spansIn(5, blockAt(5, () => tower(12)));
  check(all.length === 3, `a tall block has ${all.length} upper bridges, not 3`);
  check(new Set(all.map(([, k]) => k)).size === all.length, 'a block has the same bridge twice');
  check(new Set(all.map(([y]) => y)).size === all.length, 'two upper bridges on one tile');
  // Along the block from its start: service, then skybridge, then executive.
  const order = all.map(([, k]) => k).join(' ');
  check(order === 'service sky exec', `upper bridges in the order ${order}`);
  check(spansIn(5, blockAt(5, () => tower(6))).every(([, k]) => k !== 'exec'), 'an executive bridge landed in six storeys');
  check(spansIn(5, blockAt(5, () => tower(5))).length === 0, 'a bridge landed in five storeys');
  check(spansIn(5, blockAt(5, (y, s) => (s < 0 ? tower(12) : null))).length === 0, 'a bridge with nothing on one side');
  check(spansIn(5, blockAt(5, (y, s) => (s < 0 ? tower(12) : tower(2)))).length === 0, 'a bridge landing in two storeys');
  check(spansIn(5, blockAt(5, (y, s) => (s < 0 ? tower(12) : { ...tower(12), mark: 'lot' }))).length === 0, 'a bridge landing on a mark');
  check(spansIn(3, blockAt(3, (y) => (y === 2 ? tower(12) : tower(1)))).length === 1, 'one tall pair takes one bridge');
  // Tall isn't enough: a bowl, a gasholder and a water tower have no floors to walk into.
  for (const bt of ['ballpark', 'ballpark_0_3', 'gasholder', 'water_tower', 'chrome_arch', 'boathouse']) check(spansIn(5, blockAt(5, (y, s) => (s < 0 ? tower(12) : { bt, flr: 20 }))).length === 0, `a bridge landing in a ${bt}`);
  // The bridges belong to the buildings, not the street: they stand at every condition.
  for (let sc = 0; sc <= 4; sc++) check(spansIn(5, blockAt(5, () => tower(12), sc)).length === 3, `level ${sc} loses its upper bridges`);
  for (const k of KIT_SPANS) check(k.floors * 3.5 * 0.9 > (k.kind === 'exec' ? SPAN_M.EXEC_Z + SPAN_M.EXEC_H : k.kind === 'sky' ? SPAN_M.SKY_Z + SPAN_M.SKY_T + SPAN_M.SKY_FLOOR + SPAN_M.SKY_R : SPAN_M.SERVICE_Z[1] + SPAN_M.SERVICE_T), `${k.kind} would stand over the roof of the lowest building it can land in`);
}

// ── THE LADDER ──
// Over a good many tiles, so a share is a share. The tiles' seeds differ, as they do in the world.
const panelFaces = (level) => {
  const lv = LEVEL[level], seen = { all: 0, gone: 0 };
  // The near walkway has 4 by 9 panels a side. Count those drawn against those that should be.
  for (let i = 0; i < 80; i++) {
    const { faces } = run({ place: atLevel(level, 1, 4), near: true, part: 'static', seed: 1000 + i * 37, s0: 900 + i });
    let n = 0;
    for (const f of faces) if (f.pts.length === 4 && lv.panels.concat(lv.patches || [], [lv.hatch, [107, 74, 46]]).some((c) => c[0] === f.rgb[0] && c[1] === f.rgb[1] && c[2] === f.rgb[2]) && f.pts.every((p) => Math.abs(p[2] - KIT.KERB_H) < M(0.2) && Math.abs(p[0]) > KIT.LANE_HW)) n++;
    seen.all += 4 * 9 * 2; seen.gone += 4 * 9 * 2 - n;
  }
  return seen.gone / seen.all;
};
const allFaces = (level, o = {}) => run({ place: atLevel(level), near: true, s0: 905, ...o });
const chrome = [[214, 222, 230], [185, 201, 214]];
for (let level = 0; level < LEVEL.length; level++) {
  const lv = LEVEL[level], { faces, words } = allFaces(level, { place: atLevel(level, 0, 3) }), crossed = allFaces(level);
  const isChrome = (f) => chrome.some((c) => c[0] === f.rgb[0] && c[1] === f.rgb[1] && c[2] === f.rgb[2]);
  const onGround = faces.filter((f) => f.pts.every((p) => p[2] < M(0.3)));
  // Chrome only in the core and the middle ring (the Long Watch rule).
  if (level >= 2) check(!onGround.some(isChrome), `level ${level} has chrome on the street`);
  else check(onGround.some(isChrome), `level ${level} has no chrome`);
  if (lv.dirt) {
    // None of it: no paving, no strips, no bollards, no crossing, no words, no light.
    check(faces.every((f) => f.pts.every((p) => p[2] < M(1.6))), 'the dirt has something standing on it taller than junk');
    check(!faces.some((f) => f.mat === 'lit'), 'something on the dirt is lit');
    check(words.length === 0 && crossed.words.length === 0, `words on the dirt: ${words.map((w) => w.label).join(', ')}`);
    continue;
  }
  // Every paved level still charges, including with the belt stopped.
  const labels = new Set([...words, ...crossed.words].map((w) => w.label));
  check(labels.has('₵1 A RIDE'), `level ${level} has no strip price`);
  check(!labels.has('₵2 · CROSS'), `level ${level} posts a crossing fee nothing charges`);
}
const stands = (level) => { const n = LEVEL[level]; return n.bollardGone; };
for (const [level, want, tol] of [[0, 0, 0], [1, 0, 0], [2, 0.08 + 0, 0.03], [3, 0.3, 0.05]]) {
  const got = panelFaces(level);
  check(Math.abs(got - want) <= tol, `level ${level}: ${(got * 100).toFixed(1)}% of panels missing, not about ${want * 100}%`);
}
check(stands(2) === 0.12, 'Worn has lost the wrong share of bollards');
check(LEVEL[0].cyanMat === 'lit' && LEVEL[1].cyanMat === 'lit' && LEVEL[2].cyanMat === 'lit' && LEVEL[3].cyanMat !== 'lit', 'the kerb lights die at the wrong level');

// ── BRIDGES DON'T DECAY ──
// Everything above a lift tower's plinth on a bridge tile, and everything over 8 m on a tile with an
// upper bridge, is the same faces in the same colours at every level it stands at, bar the deck's top
// (chrome to steel, by the Long Watch rule).
const above = (place, z, skipRgb) => run({ place, near: true, s0: 905, part: 'static' }).faces
  .filter((f) => f.pts.every((p) => p[2] >= z) && !(skipRgb && f.pts.every((p) => near(p[2], KIT.DECK_Z1))))
  .map((f) => f.rgb.join() + '|' + f.mat).sort().join(';');
{
  const foot = above(atLevel(0, 2, 3), M(5), true);
  for (const level of [1, 2, 3]) check(above(atLevel(level, 2, 3), M(5), true) === foot, `the footbridge changes at level ${level}`);
  for (const span of ['service', 'sky', 'exec']) {
    const was = above(atLevel(0, 0, 3, { span }), M(8));
    check(was.length > 0, `${span}: nothing above 8 m`);
    for (const level of [1, 2, 3, 4]) check(above(atLevel(level, 0, 3, { span }), M(8)) === was, `${span} changes at level ${level}`);
    const lit = run({ place: atLevel(4, 0, 3, { span }), near: true, s0: 905 }).faces.filter((f) => f.mat === 'lit');
    check(lit.length > 0, `${span} is dark on the dirt`);
  }
  const fin = run({ place: atLevel(0, 0, 3, { span: 'sky' }), near: true, s0: 905, part: 'dynamic' }).faces;
  check(fin.some((f) => f.given === 'film'), 'the skybridge has no glass');
  check(run({ place: atLevel(0, 0, 3, { span: 'sky' }), near: true, s0: 905, part: 'static' }).faces.every((f) => f.given !== 'film'), 'glass in the static pass, under the riders');
}

// ── THE STATIC PASS IS STATIC ──
// markKept replays it, so it has to be the same at any hour: what moves goes in the dynamic pass.
const sig = (r) => r.faces.map((f) => f.rgb.join() + f.pts.flat().map((v) => v.toFixed(5)).join()).join('|');
for (let level = 0; level < LEVEL.length; level++) for (const span of [null, 'sky', 'exec', 'service']) {
  const o = { place: atLevel(level, 1, 3, { span }), near: true, s0: 905, part: 'static' };
  check(sig(run({ ...o, now: 1000 })) === sig(run({ ...o, now: 8765 })), `level ${level} ${span}: the static pass moves with the clock`);
}

// ── WHAT MOVES ──
const chevronsAt = (level, now, o = {}) => run({ place: atLevel(level), near: true, s0: 905, part: 'dynamic', now, ...o }).faces.filter((f) => f.pts.every((p) => Math.abs(Math.abs(p[0]) - KIT.STRIP_V) < M(0.9) && near(p[2], KIT.KERB_H + M(KIT_M.STRIP_H + 0.006))));
const travel = (level, dt) => {
  const a = chevronsAt(level, 1000), b = chevronsAt(level, 1000 + dt);
  // How far the first chevron has come. They repeat every pitch, so it's the distance to the nearest.
  const pitch = M(KIT_M.CHEVRON), d = a.length && b.length ? Math.abs(a[0].pts[0][1] - b[0].pts[0][1]) % pitch : 0;
  return Math.min(d, pitch - d);
};
check(chevronsAt(0, 1000).length > 0 && chevronsAt(1, 1000).length > 0, 'a running belt has no moving chevrons');
check(chevronsAt(2, 1000).length === 0 && chevronsAt(3, 1000).length === 0, 'a stopped belt has moving chevrons');
check(chevronsAt(0, 1000, { still: true }).length === 0, 'the belt runs with moving parts stopped');
check(near(travel(0, 250), M(LEVEL[0].speed * 0.25), 1e-6) && near(travel(1, 250), M(LEVEL[1].speed * 0.25), 1e-6), `the belts run ${m(travel(0, 250)) * 4} and ${m(travel(1, 250)) * 4} m/s`);
check(LEVEL[0].speed > LEVEL[1].speed && LEVEL[1].speed > 0 && LEVEL[2].speed === 0 && LEVEL[3].speed === 0, 'the belts run at the wrong levels');
check(run({ place: atLevel(0), s0: 905, part: 'static' }).faces.length > 0, 'nothing static at the middle distance');
const chevronsStatic = (o) => run({ place: atLevel(0), s0: 905, part: 'static', ...o }).faces.filter((f) => f.pts.every((p) => near(p[2], KIT.KERB_H + M(KIT_M.STRIP_H + 0.006)))).length;
check(chevronsStatic({ near: false }) > 0, 'no chevrons at the middle distance');
check(chevronsStatic({ near: true }) === 0, 'a running belt\'s chevrons are also in the static pass');

// Steam: from the vents, near to only, on the walkway and never in the lane. None on the dirt.
for (let level = 0; level < LEVEL.length; level++) {
  let plumes = [];
  for (let i = 0; i < 12; i++) plumes = plumes.concat(run({ place: atLevel(level), near: true, s0: 905 + i, part: 'dynamic' }).plumes);
  if (LEVEL[level].dirt) { check(plumes.length === 0, 'steam on the dirt'); continue; }
  check(plumes.length > 0, `no steam at level ${level}`);
  check(plumes.every((p) => Math.abs(p.x) > KIT.LANE_HW && Math.abs(p.x) < KIT.OUT), 'steam out of the lane');
  check(run({ place: atLevel(level), s0: 905, part: 'dynamic' }).plumes.length === 0, `steam past arm's length at level ${level}`);
}
check(LEVEL[3].steam > LEVEL[2].steam && LEVEL[2].steam > LEVEL[0].steam, 'the steam does not get worse down the ladder');

// ── THE INK ──
// Every kind of tile gets its hand-ruled lines near to and at the middle distance, and none without
// a sink. A line sits in a tile (or along an upper bridge) and never in the lane above a cab's eye.
for (const [name, o] of KINDS) for (let level = 0; level < 4; level++) {
  const place = { ...o.place, level };
  const a = run({ ...o, place, near: true, part: 'static' }), b = run({ ...o, place, part: 'static' });
  check(a.lines.length > 0 && b.lines.length > 0, `${name} L${level}: no ink lines`);
  check(a.lines.every(([p, q]) => [...p, ...q].every(Number.isFinite)), `${name}: an ink line with no ends`);
  check(run({ ...o, place, near: true, line: null, part: 'static' }).lines.length === 0, `${name}: ink with the ink off`);
}

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
for (const want of ['₵1 A RIDE']) check(labels.has(want), `no "${want}" on the block`);
for (const span of [null, 'sky', 'exec', 'service']) check(run({ place: straight('ns', 2, 3, { bridge: true, span }), near: true, s0: 905 }).words.every((w) => !/CROSSING|EXECUTIVE|CLEARANCE/.test(w.label)), 'a bridge with a sign on it');

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
// The same street at the dirt level: there's no lane, so nobody goes round. They walk straight over,
// on the ground, at any level of thrift.
{
  const dirt = Array.from({ length: N }, (_, ry) => Array.from({ length: N }, (_, rx) => ({ ...grid[ry][rx], ...(grid[ry][rx].road ? { sc: 4 } : {}) })));
  const dwin = { at: (x, y) => dirt[y] && dirt[y][x], wide: () => false, R, wcx: WC, wcy: WC };
  check(kitPlace(dwin.at, R, 7, dwin.wide)?.cross === false && kitPlace(dwin.at, R, 9, dwin.wide)?.bridge === false, 'the dirt has a crossing or a footbridge');
  const h = {}, [ax, ay] = wpt(R, 6, -KIT.WALK_V, 0), [bx, by] = wpt(R, 6, KIT.WALK_V, 0);
  kitWalk(h, ax, ay, 0, 0, dwin, true);
  let topZ = 0, off = 0;
  for (let k = 1; k < 800; k++) {
    const p = kitWalk(h, bx, by, 0, k * 100, dwin, true);
    topZ = Math.max(topZ, p.z);
    off = Math.max(off, Math.abs(p.y - by));
  }
  check(topZ === 0 && off < 1e-6 && !h.kw.path, 'somebody on the dirt went round');
}
// A paved street stops at the dirt: a block doesn't run on through the line between them.
{
  const at = memo((x, y) => (x === 2 && y >= 0 && y <= 5 ? { road: 1, rd: 'ns', sc: y < 3 ? 3 : 4 } : null));
  const pa = kitPlace(at, 2, 1, () => false), pb = kitPlace(at, 2, 4, () => false);
  check(pa.run.n === 3 && pb.run.n === 3 && !pb.cross && !pb.bridge, `a block ran through the dirt line: ${pa.run.n}, ${pb.run.n}`);
}

if (process.argv.includes('--report')) {
  console.log({ bollardGaps: ordinary.length, crossingGap: wide.map((g) => +g.toFixed(2)), crossTiles, bridgeTiles,
    walker: { top: +m(walker.top).toFixed(2), inLane: walker.inLane }, payer: { top: +m(payer.top).toFixed(2), inLane: payer.inLane }, labels: [...labels] });
}

if (problems.length) {
  console.error(`street-kit: ${problems.length} problem(s)`);
  for (const p of problems.slice(0, 40)) console.error('  ' + p);
  process.exit(1);
}
