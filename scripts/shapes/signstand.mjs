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

const buried = new Map();     // model → the worst band on it
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
      const sink = b.front - b.stand;         // how far behind the wall's front plane it ended up
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
  console.log(`\n  ${models} models · ${bands} band(s) placed · ${moved} pushed out to the wall · ${buried.size} still behind it\n`);
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
console.log(`  signstand: ${bands} band(s) over ${models} models, every one of them on its wall`
  + (moved ? ` (${moved} pushed out to it)` : ''));
