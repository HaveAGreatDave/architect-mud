// signswim — IS A SIGN'S SHAPE A PROPERTY OF THE BUILDING, OR OF WHERE YOU ARE STANDING?
//
//   node scripts/shapes/signswim.mjs            # gate
//   node scripts/shapes/signswim.mjs --report   # the worst offenders, with their numbers
//
// Reported as "a lot of signage has a weird way of moving around when moving camera", and it is the
// one class of rendering bug in this file that no existing gate could see: the sign is built, fitted,
// uploaded and drawn every frame, at the right place on the right wall, in the right colours. What
// is wrong is its SHAPE, and only by a few per cent, and only from some angles.
//
// `cam.unproj(p, pull)` implements a stand-off as `f - pull` — the camera's FORWARD coordinate. That
// scales a corner toward the eye by `1 − pull/f`, and the four corners of a sign seen from anywhere
// but dead-on have four DIFFERENT `f`. So a rectangle painted on a flat wall arrives at the GPU as a
// parallelogram, leaning by an amount that is a function of where the camera is; `fitSignPts` then
// forces the aspect back to the texture's, which turns that lean into the whole sign growing and
// shrinking. Measured over the registry before `RENDER_TUNE.signSquare`: 84 of 354 signs out of
// square, worst 7.6°, and 88 of them changing width by more than 1% across a 40° swing, worst 8.2%.
//
// ⚠ TWO QUESTIONS, BECAUSE THE TWO LAYERS TOOK DIFFERENT ANSWERS AND BOTH HAD TO BE CHECKED.
//
//   · SQUARE — lettering (`emitSurfaceText`) is stood off along the quad's OWN normal now, which is
//     a rigid translation, so its quad is exactly the rectangle the building says it is. Anything
//     out of square here is the old per-corner pull coming back.
//   · SEATED — a name is PAINT ON A BOARD, so its quad has to lie in that board's plane. The two
//     take different answers to the pull above and that is exactly how they come apart: the board
//     spends BLADE_PROUD as a homothety (no pixel moves) and the lettering was spending the same
//     0.25 of a tile as a rigid translation along the normal, so the name stood a quarter of a tile
//     out in front of its own placard. From the pavement that is most of a sign's width.
//   · STILL — boards, blades and panels (`emitDecoQuad`/`emitDecoFill`) could NOT take that answer:
//     `BLADE_PROUD` is 0.25 of a tile and exists to win a depth test without moving the artwork a
//     pixel, because a blade is authored inside its own facade. They pull every corner by the same
//     FRACTION of its depth instead — a homothety about the eye, which cannot lean. So for those the
//     question is not "is it square" (some are genuinely not rectangles) but "does its SHAPE hold
//     still when the camera turns".
//
// ⚠ AND THE SUBJECT IS HELD AT A FIXED CAMERA-RELATIVE OFFSET WHILE THE HEADING TURNS. Orbiting a
// model shows it different walls and every difference is legitimate; turning the head past a fixed
// building may change which pixels it lands on and must change nothing about the thing itself.
//
// ⚠ NO HEADLESS GATE CAN SEE THE PICTURE (see the ⚠ on `glresidue`) — this reads the world quads
// that go into `DECAL_SINK`, which is where the defect actually lives.
import { loadWindshield } from './dom-stub.mjs';

const ws = await loadWindshield();
const REPORT = process.argv.includes('--report');

// A place, for the same reason `signfit` sets one: the derived kit is district-aware and a sweep
// with no place never hangs the trade blade at all.
const PLACE = { biome: 'citycore', wx: 909, wy: 910 };
// Close, or `detailLayer` sheds the whole kit before any of it can be measured.
const DIST = 2.4;
const HEADINGS = [0, 12, 26, 40];
// Half a degree out of square is a tenth of what the bug produced and far more than float noise.
const SKEW_TOL = 0.5;
// A shape that holds still holds still exactly; 0.2% is slack against nothing in particular.
const DRIFT_TOL = 0.2;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const nrm = (a) => Math.hypot(a[0], a[1], a[2]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

ws.setTilePlace(PLACE);
const seen = new Map();
const order = [];
let models = 0, threw = 0;
for (const { key, m } of ws.shapeModelRegistry()) {
  models++;
  for (const heading of HEADINGS) {
    const cam = ws.makeCam(640, 160, 360, { heading, height: 0, eyeH: 0.24, map: null });
    const r = ws.canvasResidue(m, { cam, night: 1, bn: 'THE EXAMPLE', collect: true, dx: 0, dy: -DIST });
    if (r.threw) { if (heading === 0) threw++; continue; }
    if (!r.sink) continue;
    // ⚠ INDEXED WITHIN THE KEY, because one model pushes several decals sharing a texture id and a
    // bare key would compare a blade against a band.
    const nth = new Map();
    for (const d of r.sink.decals) {
      const n = nth.get(d.key) || 0;
      nth.set(d.key, n + 1);
      const [TL, TR, , BL] = d.p;
      const u = sub(TR, TL), v = sub(BL, TL);
      const uL = nrm(u), vL = nrm(v);
      if (!(uL > 1e-9) || !(vL > 1e-9)) continue;
      if (heading === HEADINGS[0]) order.push({ model: key, key: String(d.key), p: d.p });
      const id = `${key}|${d.key}#${n}`;
      if (!seen.has(id)) seen.set(id, []);
      seen.get(id).push({
        text: String(d.key).startsWith('st:') || String(d.key).startsWith('gt:'),
        skew: Math.abs(Math.acos(Math.max(-1, Math.min(1, dot(u, v) / (uL * vL)))) * 180 / Math.PI - 90),
        uL, vL,
      });
    }
  }
}

// SEATED — every blade board is followed in the sink by its own lettering (neonBlade pushes the
// three box sides, then the face, then the name), so the pairing is the push order and needs no
// geometry to guess at. FACE_EPS is 0.006; a hairline either way is the whole allowance, and the
// bug this exists for was forty times it.
const FACE_EPS = 0.006, SEAT_TOL = FACE_EPS * 3;
const unseated = [];
for (let i = 0; i < order.length - 1; i++) {
  if (!order[i].key.startsWith('blade|n|')) continue;
  const nx2 = order[i + 1];
  if (!(nx2.key.startsWith('st:') || nx2.key.startsWith('gt:'))) continue;
  const [TL, TR, , BL] = order[i].p;
  const u = sub(TR, TL), v = sub(BL, TL);
  const nX = u[1] * v[2] - u[2] * v[1], nY = u[2] * v[0] - u[0] * v[2], nZ = u[0] * v[1] - u[1] * v[0];
  const nl = Math.hypot(nX, nY, nZ); if (!(nl > 1e-9)) continue;
  let worst = 0;
  for (const q of nx2.p) {
    const d2 = Math.abs(((q[0] - TL[0]) * nX + (q[1] - TL[1]) * nY + (q[2] - TL[2]) * nZ) / nl);
    if (d2 > worst) worst = d2;
  }
  if (worst > SEAT_TOL) unseated.push({ id: order[i].model + '|blade', off: worst });
}
unseated.sort((x, y) => y.off - x.off);

const leaning = [], drifting = [];
for (const [id, list] of seen) {
  if (list.length < 2) continue;
  const text = list[0].text;
  // SQUARE — lettering only. A board may be any shape its author drew.
  if (text) {
    const skew = Math.max(...list.map((r) => r.skew));
    if (skew > SKEW_TOL) leaning.push({ id, skew });
  }
  // STILL — everything. The RATIO of the two edges, which is what a lean or a stretch moves and
  // what a homothety about the eye leaves alone.
  const asp = list.map((r) => r.uL / r.vL);
  const drift = (Math.max(...asp) / Math.min(...asp) - 1) * 100;
  if (drift > DRIFT_TOL) drifting.push({ id, drift });
}

leaning.sort((a, b) => b.skew - a.skew);
drifting.sort((a, b) => b.drift - a.drift);

if (REPORT) {
  console.log(`\n  lettering off its own board (${unseated.length}):`);
  for (const r of unseated.slice(0, 20)) console.log(`    ${r.off.toFixed(4)} tiles  ${r.id}`);
}
if (REPORT) {
  console.log(`\n  ${models} models · ${seen.size} decal quad(s) over ${HEADINGS.length} headings\n`);
  console.log(`  out of square (${leaning.length}):`);
  for (const r of leaning.slice(0, 20)) console.log(`    ${r.skew.toFixed(2)}°  ${r.id}`);
  console.log(`\n  shape drifts with the camera (${drifting.length}):`);
  for (const r of drifting.slice(0, 20)) console.log(`    ${r.drift.toFixed(2)}%  ${r.id}`);
  console.log();
}

let bad = 0;
if (threw) { console.error(`\n  ${threw} model(s) threw during the census`); bad += threw; }
if (leaning.length) {
  bad += leaning.length;
  console.error(`\n  ${leaning.length} lettering quad(s) reach the GPU OUT OF SQUARE — a rectangle on a flat wall is a rectangle:\n`);
  for (const r of leaning.slice(0, 10)) console.error(`    ${r.id} — ${r.skew.toFixed(2)}° of lean`);
  console.error('\n  A stand-off carried in the camera\'s forward coordinate scales each corner by a');
  console.error('  different amount. See standOffQuad, and RENDER_TUNE.signSquare.\n');
}
if (unseated.length) {
  bad += unseated.length;
  console.error(`\n  ${unseated.length} blade(s) carry their name OFF the board it is painted on:\n`);
  for (const r of unseated.slice(0, 10)) console.error(`    ${r.id} — ${r.off.toFixed(4)} tiles clear of the face`);
  console.error('\n  A stand-off is a TIE-BREAKER. Anything larger is a depth pull and belongs in a');
  console.error('  homothety about the eye — see emitSurfaceText, which splits `pull` into the two.\n');
}
if (drifting.length) {
  bad += drifting.length;
  console.error(`\n  ${drifting.length} decal quad(s) CHANGE SHAPE when the camera turns past them:\n`);
  for (const r of drifting.slice(0, 10)) console.error(`    ${r.id} — ${r.drift.toFixed(2)}% across ${HEADINGS.length} headings`);
  console.error('\n  A sign\'s shape is a property of the building. See unprojQuad: every corner has to');
  console.error('  be pulled by the same FRACTION of its own depth, never by the same distance.\n');
}
if (bad) { console.error(`✗ signswim — ${bad} finding(s).`); process.exit(1); }
console.log(`  signswim: ${seen.size} decal quad(s) over ${models} models — every lettering quad square, and not one changing shape as the camera turns.`);
