// IS THE SIGN ON THE WALL, OR IN IT?
//
// `marqueeBand` pushed itself out along the entrance normal by `half * 0.94` — its own HALF-WIDTH —
// so the width of a sign decided how far forward it stood. A band narrower than the facade it is
// bolted to therefore came to rest INSIDE the building, and on a depth buffer the only part of it
// that reaches the screen is whatever crests the parapet: a name sheared in half, or a shopfront
// with no sign on it at all. That is the "signs buried in the building" report.
//
// It is silent in every direction. The band is drawn, the lettering is baked and mapped, nothing
// throws, `glresidue` is happy (the sign IS on the depth buffer — that is the problem), `signfit`
// is happy (nothing is drawn ACROSS it, it is drawn BEHIND something), and `anchored` only reads
// the twenty authored models, not the hundred and seventy-two hand-written arms where every one of
// these calls lives. It has been diagnosed and fixed twice, one arm at a time, by nudging the width
// up until the sign happened to clear — and both of those notes say the coupling itself is the bug.
//
// So: run every model, let `marqueeStand` record what it decided and what the wall under it turned
// out to be, and compare. The numbers are recorded BY the function that resolves them, because by
// the time the band is a quad the two have been collapsed into one offset and a gate that
// re-derived them would be a second opinion about the placement rule.
//
//   node scripts/shapes/signstand.mjs            # gate
//   node scripts/shapes/signstand.mjs --report   # every band, with its numbers
//   node scripts/shapes/signstand.mjs --before   # the same sweep with RENDER_TUNE.signStand = 0
import { loadWindshield } from './dom-stub.mjs';

const ws = await loadWindshield();
const REPORT = process.argv.includes('--report');
const BEFORE = process.argv.includes('--before');
if (BEFORE) ws.RENDER_TUNE.signStand = 0;

// ⚠ A REAL CAMERA, FOR `glresidue`'s REASON. `marqueeBand` reaches the decal layer through
// `cam.unproj` for its lettering, and a stub camera has none — the band's own quad is resolved
// either way, but running the path the game runs is what keeps this measuring the renderer.
const cam = ws.makeCam(640, 160, 360, { heading: 0, height: 0, eyeH: 0.24, map: null });

// ⚠ TWO SCALES, BECAUSE THE BURIAL IS A FUNCTION OF THE RATIO AND NOT OF THE MODEL. A band is
// placed off `fh` and the wall it is bolted to is capped at 0.44 by `segFit`, so how far a sign
// sinks into its own building changes with the footprint — and the tall/thin case is the one the
// two hand-fixes were both reported on.
const SCALES = [{ fh: 0.4, h: 1 }, { fh: 0.44, h: 0.5 }];

// How far behind its own wall a band may sit before it is buried rather than fitted. A sign flush
// with the plane it is on is fine — that is paint — and the depth buffer's own tie-breaker
// (`DECO_PULL`) carries it. Anything further back is behind something.
const TOL = 0.004;

// ── …AND THE OTHER DIRECTION, WHICH THIS GATE COULD NOT SEE AT ALL ────────────────────────────
//
// Everything above measures a band that ended up BEHIND its wall. The mirror failure is a band in
// front of it, and it is the louder of the two on screen: a sign hanging over the grass with a
// gap of daylight between it and the building it names. `sink` cannot find one — it goes negative
// and passes — so this swept 74 bands and reported every one of them "on its wall" while KSAB's
// stood 0.62 of a tile out from a plot line at 0.44.
//
// It needs `fwd`, the caller's own displacement along the entrance normal, because the float is
// the SUM: `marqueeStand` answers in the capture's frame (from the tile centre) and `marqueeBand`
// adds it to whatever origin it was handed. Three of the thirty-six hand it a sub-box's centre.
//
// ⚠ AND IT IS MEASURED AGAINST THE STAND-OFF, NOT AGAINST THE WALL. `marqueeStand` deliberately
// returns `max(own, front + SIGN_PROUD)` — a band wider than the plane it is on keeps its own
// half-width, which is what lets the two arms that compensated by hand stay where they are — so
// "past the wall" flags those and means nothing. What is never legitimate is landing past the
// number the placement rule resolved: that can only be a displacement added on top of it.
const FLOAT_TOL = 0.004;

const buried = new Map();     // model → the worst band on it
const afloat = new Map();     // …and the worst band standing off past its own resolved stand-off
const behind = new Map();     // …and the ones this gate cannot measure at all — see below
let models = 0, bands = 0, threw = 0, moved = 0;

for (const { key, m } of ws.shapeModelRegistry()) {
  models++;
  for (const { fh, h } of SCALES) {
    const census = [];
    ws.signStandCensus(census);
    let r;
    // ⚠ NIGHT AND CLOSE, the same two settings `glresidue` records having had to learn: the signage
    // is night-gated and the detail layer is screen-size gated, so a day census at eight tiles is a
    // census of nothing.
    try { r = ws.canvasResidue(m, { cam, night: 1, bn: 'THE EXAMPLE', dy: -2, fh, h }); }
    finally { ws.signStandCensus(null); }
    if (r && r.threw) { threw++; continue; }
    for (const b of census) {
      bands++;
      if (b.front == null) continue;          // an arm that will not capture gets its own number
      if (b.stand > b.own + 1e-9) moved++;
      // Where the band actually lands in the capture's own frame: the caller's displacement plus
      // the stand-off it was given. The two are added in `marqueeBand`, so they are added here.
      const at = (b.fwd || 0) + b.stand;
      // ⚠ AND A BAND STOOD BACK FROM THE TILE CENTRE CANNOT BE MEASURED HERE AT ALL. `wallFaceAt`
      // answers for the frontmost mass anywhere on the elevation, which is the right wall for a
      // band at the tile centre and the wrong one for a fitting on a sub-box behind it — the
      // harbour yard's hut is a cabin in the SEAWARD CORNER, so the plane it is held against is
      // the yard's own front edge a third of a tile in front of it. Its band is in fact 0.015
      // proud of the hut's wall and this gate would call it a third of a tile buried. Answering
      // for those needs the plane solved over the band's LATERAL span as well as its height, which
      // is a change to all thirty-six callers and wants its own measurement; naming them is
      // honest, and pinning a number that describes the wrong wall would not be.
      if ((b.fwd || 0) < -0.01) { behind.set(key, { at, fh, h, ...b }); continue; }
      const out = b.plane == null ? 0 : at - b.plane;   // how far past the plane the rule resolved
      if (out > FLOAT_TOL) {
        const prev = afloat.get(key);
        if (!prev || out > prev.out) afloat.set(key, { out, at, fh, h, ...b });
      }
      const sink = b.front - at;              // how far behind the wall's front plane it ended up
      if (sink <= TOL) continue;
      const prev = buried.get(key);
      if (!prev || sink > prev.sink) buried.set(key, { sink, fh, h, ...b });
    }
  }
}

if (REPORT) {
  const rows = [...buried.entries()].sort((a, b) => b[1].sink - a[1].sink);
  console.log('\n  model                              sunk    own    wall   stood');
  for (const [k, e] of rows) {
    console.log('  ' + k.padEnd(34) + e.sink.toFixed(3).padStart(6)
      + e.own.toFixed(3).padStart(7) + e.front.toFixed(3).padStart(7) + e.stand.toFixed(3).padStart(8));
  }
  const fl = [...afloat.entries()].sort((a, b) => b[1].out - a[1].out);
  console.log('\n  model                             ahead    fwd  plane   landed');
  for (const [k, e] of fl) {
    console.log('  ' + k.padEnd(34) + e.out.toFixed(3).padStart(6)
      + (e.fwd || 0).toFixed(3).padStart(7) + (e.plane == null ? 0 : e.plane).toFixed(3).padStart(7)
      + e.at.toFixed(3).padStart(9));
  }
  if (behind.size) {
    console.log('\n  stood BACK from the tile centre — not measurable here, see the ⚠ above');
    for (const [k, e] of behind) {
      console.log('  ' + k.padEnd(34) + (e.fwd || 0).toFixed(3).padStart(13)
        + e.stand.toFixed(3).padStart(7) + e.at.toFixed(3).padStart(9));
    }
  }
  console.log(`\n  ${models} models · ${bands} band(s) placed · ${moved} pushed out to the wall`
    + ` · ${buried.size} still behind it · ${afloat.size} past the resolved plane`
    + ` · ${behind.size} not measurable\n`);
}

if (threw) { console.error(`  ${threw} model pass(es) threw during the census`); process.exit(1); }
if (!bands) { console.error('  signstand: no marquee bands were placed at all — the census is not wired'); process.exit(1); }
if (buried.size) {
  console.error(`\n  ${buried.size} model(s) hang a name band BEHIND their own front wall:\n`);
  for (const [k, e] of [...buried.entries()].sort((a, b) => b[1].sink - a[1].sink).slice(0, 20)) {
    console.error(`    ${k} — ${e.sink.toFixed(3)} behind a wall at ${e.front.toFixed(3)} (stood at ${e.stand.toFixed(3)})`);
  }
  console.error('\n  `marqueeStand` takes the stand-off from the building\'s own captured mass, so a band');
  console.error('  can only land behind it if the wall is not in the capture — an arm drawing its frontage');
  console.error('  with something other than a mass primitive, or a band pitched at a height no box spans.\n');
  process.exit(1);
}
if (afloat.size) {
  console.error(`\n  ${afloat.size} model(s) hang a name band PAST the plane the placement rule resolved:\n`);
  for (const [k, e] of [...afloat.entries()].sort((a, b) => b[1].out - a[1].out).slice(0, 20)) {
    console.error(`    ${k} — ${e.out.toFixed(3)} past a plane at ${(e.plane == null ? 0 : e.plane).toFixed(3)}`
      + ` (the caller's own origin is ${(e.fwd || 0).toFixed(3)} out; the band landed at ${e.at.toFixed(3)})`);
  }
  console.error('\n  A band is added to the origin its caller passed, and `marqueeStand` answers from the');
  console.error('  TILE CENTRE — so a caller handing it a sub-box\'s own centre gets the stand-off added');
  console.error('  to a displacement that is already there, and the sign ends up off the front of the');
  console.error('  plot with daylight between it and the building. See the ⚠ on marqueeStand.\n');
  process.exit(1);
}
console.log(`  signstand: ${bands} band(s) over ${models} models, every one of them on its wall`
  + (moved ? ` (${moved} pushed out to it)` : '')
  + (behind.size ? ` · ${behind.size} stood back and not measurable` : ''));
