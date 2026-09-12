// WHAT IS STILL PAINTED ON THE CANVAS, OVER THE COMPOSITED CITY?
//
// GLASS 2 blits the GL canvas and then `flushFaces` paints whatever is left in the 2-D queue on
// top of it. Nothing in that queue is depth-tested. `decoHidden` is the only thing between it and
// a sign showing through a tower, and it answers per SURFACE — hidden only when the WHOLE of the
// surface is covered — so anything standing proud of the thing in front of it draws whole.
//
// That failure is silent in every direction. The picture is drawn, nothing throws, no counter
// moves, and the only witness is somebody standing in the one place where a building is between
// them and the sign. It is also unreadable from the finished frame: at flush time the closure's
// origin is gone, so "what is still drawing through walls" is a question the frame cannot answer,
// and every guess at it before this was wrong — the mast and the dish were each blamed, patched
// and found innocent while `latticeTower` sat there queueing thirty-nine of them.
//
// So the arm is run the way a GL frame runs it — every sink open, MASS_OFF and FLAT_OFF set — and
// what lands in FACE_SINK is tallied BY THE FUNCTION THAT QUEUED IT. A model with none is on the
// depth buffer end to end. A model with some names exactly which helper to port next.
//
// ⚠ IT IS A GATE AS WELL AS A REPORT, AND THE GATE IS AN ALLOW-LIST. A budget ("no more than N
// faces") passes a new leak the moment somebody deletes an old one, and a per-model count churns on
// every content change. What is listed is a REASON, declared at the call site through
// `keptOnCanvas`, so allowing one surface can never widen into allowing the whole function it
// happens to live in.
//
//   node scripts/shapes/glresidue.mjs            # gate: fails on an unlisted painter
//   node scripts/shapes/glresidue.mjs --report   # the whole tally, by painter and by model
import { loadWindshield } from './dom-stub.mjs';

const ws = await loadWindshield();
const REPORT = process.argv.includes('--report');

// ⚠ A REAL CAMERA, NOT THE STUB. `emitSurfaceText` and every screen-space billboard reach the decal
// layer through `cam.unproj`, and a stub camera has none — so under the stub every painted sign in
// the city reports as residue the game already puts on the depth buffer, and the census becomes a
// list of things that are already fixed.
const cam = ws.makeCam(640, 160, 360, { heading: 0, height: 0, eyeH: 0.24, map: null });

const byPainter = new Map();
const byModel = new Map();
let models = 0, threw = 0;
const sinks = { mesh: 0, decals: 0, sprites: 0, strokes: 0, scatter: 0 };

for (const { key, m } of ws.shapeModelRegistry()) {
  models++;
  // Night, because that is when this renderer draws the most: the neon, the runners, the glows and
  // the lit signage are all night-gated, and a day-only census would miss most of the surface.
  // ⚠ CLOSE, BECAUSE THE DETAIL KIT IS SCREEN-SIZE GATED AND THE DEFAULT 8 TILES IS OUTSIDE IT.
  // `detailLayer` drops a part whose own height projects below its `DETAIL_PX` floor, so at the
  // default distance the whole derived kit — every board, canopy, pipe, lamp and neon run, which is
  // most of what a building wears now — was skipped before it could be counted, and the census
  // reported a clean city while saying nothing about any of it. Measured: 0 decals at 8, 4, 3 and
  // 2.5 tiles, 8 decals at 2. Two tiles is roughly where a cab actually sits beside a frontage,
  // which is also the seat this whole question is asked from.
  const r = ws.canvasResidue(m, { cam, night: 1, bn: 'THE EXAMPLE', dy: -2 });
  if (r.threw) { threw++; byModel.set(key, { err: r.threw }); continue; }
  for (const k of Object.keys(sinks)) sinks[k] += r[k] || 0;
  const total = Object.values(r.canvas).reduce((a, b) => a + b, 0);
  if (!total) continue;
  byModel.set(key, { faces: r.faces, canvas: r.canvas });
  for (const [tag, n] of Object.entries(r.canvas)) {
    const painter = tag.split(' < ')[0];
    const e = byPainter.get(painter) || { faces: 0, models: new Set() };
    e.faces += n; e.models.add(key);
    byPainter.set(painter, e);
  }
}

// ── THE ALLOW-LIST ──────────────────────────────────────────────────────────
// Every entry is a `keptOnCanvas` reason, with why it cannot go on the depth buffer. Nothing may be
// added without one, and a plain function name may never be added at all.
const KNOWN = new Map([
  ['kept:departure-lounge',
    'the regional hangar\'s lit interior is read THROUGH the pavilion\'s own glass, and the mass ' +
    'pass writes depth whatever its alpha — handed over as a quad it would be hidden by the very ' +
    'glass it is meant to be seen through. It keeps the canvas and gets markHidden, which spans ' +
    'the pavilion rather than probing one point at its middle.'],
]);

const rows = [...byPainter.entries()].sort((a, b) => b[1].faces - a[1].faces);
if (REPORT) {
  console.log('\n  painter                          faces   models');
  for (const [p, e] of rows) console.log('  ' + p.padEnd(32) + String(e.faces).padStart(6) + '   ' + e.models.size);
  console.log('\n  on the depth buffer: ' + Object.entries(sinks).map(([k, v]) => v + ' ' + k).join(' · '));
  console.log(`  ${models} models · ${rows.length} painter(s) still on the canvas · ${byModel.size} model(s) with residue\n`);
}

if (threw) { console.error(`  ${threw} model(s) threw during the census`); process.exit(1); }
const unlisted = rows.filter(([p]) => !KNOWN.has(p));
if (unlisted.length) {
  console.error('\n  These paint on the 2-D canvas over the composited city, so nothing occludes them per pixel:\n');
  for (const [p, e] of unlisted) console.error(`    ${p} — ${e.faces} faces across ${e.models.size} model(s), e.g. ${[...e.models].slice(0, 3).join(', ')}`);
  console.error('\n  Put it on the depth buffer — the mesh (emitFlat), a decal (emitDecoFill / emitDecoQuad),');
  console.error('  a sprite (pushLight), a wire (emitWire) or a baked quad (markBillboard) — or wrap it in');
  console.error('  keptOnCanvas(<reason>, …) and add that reason to KNOWN with why it cannot move.\n');
  process.exit(1);
}
console.log(`  glresidue: ${models} models, nothing unaccounted for painting over the composited city`);
