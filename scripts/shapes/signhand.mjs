// IS A SIGN LETTERED IN ITS OWN HAND, OR IN THE LAST BUILDING'S?
//
//   node scripts/shapes/signhand.mjs            # gate
//   node scripts/shapes/signhand.mjs --report   # the hand each label came out in, per arrangement
//
// ⚠ THIS EXISTS BECAUSE THE SIGNAGE CHANGED SIZE AS YOU DROVE. `_signFace` is ambient state — the
// hand a sign letters itself in, published by whichever building is being drawn so that ~30 arm
// call sites can hand `bakeSignText` a label and a colour and nothing else. Its own note said the
// arrangement is safe "because both entry points write it before anything reads it, and if a third
// ever appears it writes it too". Two did appear and neither wrote it: `drawVehicleBay` and
// `drawRoadSign` are MARKS, drawn from the same back-to-front list as the buildings and nowhere
// inside `drawTypeModel`. So each was lettered in whatever hand the building immediately before it
// in this frame's sort order happened to use — which changes with every metre the camera moves.
//
// ⚠ AND ON ONE OF THEM IT IS A SIZE, NOT MERELY A HAND. An untight bake reserves a full cell per
// character and no face's ink overruns that, so the canvas is the same shape whoever lettered it.
// A `tight` bake is cropped to the INK, and the road board sizes the cap height every row shares as
// `nameBoxW / widestA` — straight off the texture's aspect. Measured against real font metrics,
// "COLDWATER" is 4.32 cells wide in mono and 6.92 in script: a 1.6x swing in letter height on a
// board that has not moved, arriving and leaving as the camera passes different frontages.
//
// ⚠ AND THE STUB CANNOT SEE THE SIZE, WHICH IS WHY THIS GATE WATCHES THE HAND. `dom-stub`'s
// `measureText` answers `length * 20` for every font, so every face measures the same ink here and
// a size comparison would be a comparison of a constant. The hand is the cause; the size is one
// consequence of it, and the one that reaches a player. Gate the cause.
import { loadWindshield, stubCanvas } from './dom-stub.mjs';

const ws = await loadWindshield();
const REPORT = process.argv.includes('--report');
const W = 640, H = 360;

// ⚠ FIVE HANDS, AND THEY HAVE TO BE HANDS THIS SCENE REALLY PRODUCES. A neighbour that letters
// itself in the same hand as the mark is a control that cannot fail — so these are taken from the
// registry by their own `signFontOf`, and the run asserts below that the arrangements genuinely
// differed. `none` is the baseline: no building at all, so nothing has written `_signFace` and the
// leak would show up as the module's initial 'mono'.
// ⚠ AND EACH ONE HAS TO ACTUALLY LETTER SOMETHING. Half the registry signs itself and half does
// not — a church, an archive, a police station and a warehouse paint no name at all — so a
// neighbour chosen for its hand alone can be a building that never publishes one, and the
// arrangement is then indistinguishable from `none`. These five were picked by running them: bar
// script, assay western, diner slab, hotel block, shop condensed. The last two deliberately match
// the hands the marks declare, so a leak cannot hide behind a coincidence in the other three.
const NEIGHBOURS = ['none', 'bar', 'assay', 'diner', 'hotel', 'shop'];

const DEPOT = 'BONDED & BOTHERED';
const ROAD_ROWS = [{ n: 'COLDWATER', m: 240, a: 0 }, { n: 'THE REACH', m: 98, a: 1 }];
// A label a mark owns outright, so the census can be filtered without knowing which painter queued
// what. Nothing else in the scene is called any of these.
const MARK_LABELS = new Map([
  [DEPOT, 'the depot name board'],
  ['TRAILER', "the depot's floor legends"],
  ['COLDWATER', 'the highway board'],
  ['THE REACH', 'the highway board'],
]);

const R = 12, N = R * 2 + 1;
function scene(neigh) {
  return Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => {
    // The depot ahead, and the road board on the verge a little short of it. Both are marks, and
    // both are the subject.
    if (x === R && y === R - 3) return { kind: 'land', biome: 'freight', mark: 'bay', bn: DEPOT, bt: 'truck_depot', ent: 'south', flr: 1 };
    if (x === R + 1 && y === R - 2) return { kind: 'land', biome: 'freight', mark: 'sign', flr: 0, sgn: { face: 0, rows: ROAD_ROWS, back: ROAD_ROWS } };
    // ⚠ THE NEIGHBOUR HAS TO BE DRAWN BEFORE THE MARKS, WHICH MEANS FURTHER AWAY. The list is
    // sorted back to front, so a building level with the depot may sort either side of it and the
    // arrangement stops being an arrangement.
    if (neigh !== 'none' && Math.abs(x - R) <= 1 && y >= R - 8 && y <= R - 6) {
      return { kind: 'land', biome: 'citycore', bt: neigh, bn: 'FARAWAY MERCANTILE', ent: 'south', flr: 4 };
    }
    if (x === R) return { kind: 'land', biome: 'freight', road: 1, rd: 'ns', flr: 0, pw: 1, sl: 1 };
    return { kind: 'land', biome: 'scrub', flr: 0 };
  }));
}

// Frozen, for framecost's reasons — a live clock moves the animated art and both adaptive dials,
// and what is being measured here is one variable.
const clock = globalThis.performance;
globalThis.performance = { ...clock, now: () => 1e6 };
globalThis.window.devicePixelRatio = 1;

// ⚠ THE NEIGHBOUR HAS TO GET ITS DETAIL KIT, OR IT NEVER LETTERS ITSELF AND THERE IS NO CONTROL.
// `detailLayer` runs at `ADORN_NEAR`, which the 2-D painter reaches only inside three tiles, and a
// building that close would sort in front of the marks rather than behind them. So the range is
// opened for the run instead of the scene being folded up to meet it. Restored below: `detailNear`
// is a frame-cost ceiling and nothing else in this process should inherit it.
const nearWas = ws.RENDER_TUNE.detailNear;
ws.RENDER_TUNE.detailNear = 14;
const placeWas = ws.setTilePlace({ biome: 'citycore', wx: 909, wy: 910 });

const runs = new Map();
for (const neigh of NEIGHBOURS) {
  const id = '__sh:' + neigh;
  stubCanvas(id, W, H);
  const map = scene(neigh);
  const view = { cls: 'truck', phase: 'ground', height: 0, worldBlend: 1, variant: 'rigid',
    map, heading: 0, hour: 12, weather: 'clear', speed: 0, resFloor: 1, eyeH: 0.12,
    mapCenter: { x: 100, y: 100 } };
  // The first frame settles every lazy cache; the census is the second.
  ws.paintWindshield(id, view);
  globalThis.window.__signHandsStart();
  ws.paintWindshield(id, view);
  const rows = globalThis.window.__signHands();
  runs.set(neigh, Array.isArray(rows) ? rows : null);
}
ws.RENDER_TUNE.detailNear = nearWas;
ws.setTilePlace(placeWas);
globalThis.performance = clock;

const problems = [];
// ── THE CONTROL ─────────────────────────────────────────────────────────────
// ⚠ AN EMPTY CENSUS PASSES EVERY COMPARISON THERE IS, and it is also what comes back from a scene
// that drew no mark at all — a `sgn` shape the painter rejects, a depot past the detail range, a
// `bakeSignText` that returned null under a cheap tier. So the marks have to be REACHED before
// anything they do can be gated.
const hands = new Map();          // label -> Map(hand -> [arrangements])
for (const [neigh, rows] of runs) {
  if (!rows) { problems.push(`${neigh}: the census never started — __signHandsStart is not wired`); continue; }
  for (const r of rows) {
    if (!MARK_LABELS.has(r.label)) continue;
    if (!hands.has(r.label)) hands.set(r.label, new Map());
    const m = hands.get(r.label);
    if (!m.has(r.face)) m.set(r.face, []);
    m.get(r.face).push(neigh);
  }
}
for (const [label, why] of MARK_LABELS) {
  if (!hands.has(label)) problems.push(`the scene never lettered ${why} ("${label}") — the gate is vacuous, fix the scene`);
}
// ⚠ AND THE ARRANGEMENTS HAVE TO DIFFER, or six identical scenes would agree about everything.
// Whatever the neighbour letters — its own name, a fascia motto, a trade word its arm paints — is
// lettered by its own arm in its own hand, so the spread of those hands is the proof that these
// really were different frames and therefore that `_signFace` really did hold different values
// while the marks were drawn.
const neighHands = new Set();
for (const [, rows] of runs) for (const r of (rows || [])) if (!MARK_LABELS.has(r.label)) neighHands.add(r.face);
if (neighHands.size < 3) {
  problems.push(`the neighbours only lettered themselves in ${neighHands.size} hand(s) (${[...neighHands].join(', ') || 'none'})`
    + ' — the arrangements are not different arrangements, so a stable mark proves nothing');
}

// ── THE INVARIANT ───────────────────────────────────────────────────────────
// A mark's hand is a property of the mark. Not of what is standing behind it.
for (const [label, m] of hands) {
  if (m.size > 1) {
    const spread = [...m].map(([f, ns]) => `${f} (behind ${ns.join('/')})`).join(', ');
    problems.push(`${MARK_LABELS.get(label)} was lettered in ${m.size} different hands — ${spread}`);
  }
}
// …and it is the hand the painter declares, not one it happens to inherit. Without this a leak
// that only ever picked up 'block' would pass the comparison above.
const EXPECT = new Map([[DEPOT, ws.signFontForTrade('truck_depot')], ['TRAILER', ws.signFontForTrade('truck_depot')],
  ['COLDWATER', 'condensed'], ['THE REACH', 'condensed']]);
for (const [label, want] of EXPECT) {
  const m = hands.get(label); if (!m) continue;
  for (const got of m.keys()) {
    if (got !== want) problems.push(`${MARK_LABELS.get(label)} came out in '${got}' where its painter declares '${want}'`);
  }
}

if (REPORT) {
  console.log(`\n  CSS frame ${W}x${H}, ${NEIGHBOURS.length} arrangements — only the building BEHIND the marks changes.\n`);
  const other = new Set();
  for (const [, rows] of runs) for (const r of (rows || [])) if (!MARK_LABELS.has(r.label)) other.add(r.label);
  const labels = [...MARK_LABELS.keys(), ...other];
  console.log('  ' + 'label'.padEnd(22) + NEIGHBOURS.map((n) => n.padEnd(11)).join(''));
  for (const label of labels) {
    const row = NEIGHBOURS.map((n) => {
      const hit = (runs.get(n) || []).find((r) => r.label === label);
      return (hit ? hit.face : '—').padEnd(11);
    });
    console.log('  ' + label.slice(0, 21).padEnd(22) + row.join(''));
  }
  console.log('');
}

if (problems.length) {
  console.error(`\n✗ signhand — ${problems.length} problem(s):`);
  for (const p of problems) console.error('  · ' + p);
  console.error('\n  `_signFace` is ambient. A painter that letters a sign and is not inside');
  console.error('  drawTypeModel/drawBuilding/detailLayer must WRITE it — see the ⚠ on _signFace.');
  process.exit(1);
}
const counted = [...hands].reduce((n, [, m]) => n + [...m.values()].reduce((k, a) => k + a.length, 0), 0);
console.log(`✓ signhand: ${hands.size} mark label(s), ${counted} bakes over ${NEIGHBOURS.length} arrangements`
  + ` (neighbours lettering themselves in ${neighHands.size} hands) — every mark kept its own.`);
