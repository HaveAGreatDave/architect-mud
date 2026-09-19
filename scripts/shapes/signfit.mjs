// IS THE LETTERING THE RIGHT SHAPE, AND IS ANYTHING DRAWN ACROSS IT?
//
// Two defects that are invisible to every other gate in this repo, because both of them draw a
// complete picture with nothing thrown, nothing logged and no counter moved. The only witness is
// somebody standing in front of that particular building.
//
//   1. STRETCHED LETTERING. Every sign in the game bakes a canvas and maps it onto a quad somebody
//      sized somewhere else, and until this was measured the two were simply assumed to agree. They
//      cannot: a board's size is a property of the MODEL — `signBoard` and `signGantry` size theirs
//      off the wall they are bolted to, and the list is cached per model — while `$name` is a
//      property of the TILE. So the same plate carries a four-letter name and a fourteen-letter one.
//      Measured before `fitSignPts`: 252 of 254 sign quads disagreed with their own texture by more
//      than 18%, the commonest case an 11.3:1 bake squashed onto a 4.75:1 board, which is letters at
//      42% of their own width. That is the "stretched, illegible" report.
//
//   2. WIRES OVER THE SIGNAGE. A mast, a catenary, a neon tube or a bracket drawn IN FRONT of a
//      sign, from the camera. With the city's mass on a depth buffer these simply intersect —
//      nothing sorts them apart any more — and the kit places a roof hoarding and a name board with
//      no idea what the arm already put on that roof or across that frontage. Measured before the
//      clearances: 80 (sign, heading) pairs over 21 models.
//
// ⚠ THE ASPECT IS MEASURED IN WORLD SPACE, NOT ON SCREEN, AND THAT IS THE WHOLE CARE OF IT. This
// camera is anamorphic — `proj` scales lateral offsets by `FL` and heights by `depth`, set
// independently off the canvas — so one world unit across and one world unit up are 142.6px and
// 102.7px at the flight sim's 1200x560, and 76.1 and 66.0 in a small cab. A screen-space
// measurement would therefore report a different answer in every seat, and a first cut of this file
// did exactly that: it read 1.58x on every sign in the registry and the number was the camera.
//
//   node scripts/shapes/signfit.mjs            # gate
//   node scripts/shapes/signfit.mjs --report   # every offender, with its numbers
import { loadWindshield } from './dom-stub.mjs';

const ws = await loadWindshield();
const REPORT = process.argv.includes('--report');

// ⚠ FOUR HEADINGS, BECAUSE A CROSSING IS A QUESTION ABOUT A VIEWPOINT. A mast that clears a board
// square-on runs straight through it from twenty degrees off, which is where a truck actually sits.
const HEADINGS = [0, 22, -22, 45];
// ⚠ AND CLOSE, BECAUSE THE DETAIL KIT IS SCREEN-SIZE GATED. `detailLayer` drops a part whose own
// height projects below its floor, so at the default eight tiles the whole kit — every board,
// canopy, blade and tube — is skipped before it can be counted, and the census reports a clean city
// while saying nothing about any of it. The same note glresidue carries, for the same reason.
const DIST = 2.2;
// ⚠ A PLACE IS SET, OR HALF THE SIGNAGE IS NOT IN THE CENSUS AT ALL. The derived kit is district-
// aware (see `_place` in windshield.js) and the Chinese trade blade only goes up in the biomes that
// have one — so a gate that passes no place sweeps a city with no trade blades in it and reports a
// clean bill for a feature it never drew. `citycore` in the middle of Coldwater is the ordinary
// case: signage at its baseline density, with the blade eligible.
const PLACE = { biome: 'citycore', wx: 909, wy: 910 };
// A quad within this factor of its own texture's aspect is drawn at true proportions. Generous: the
// fit is exact, so anything that trips this is a path that is not going through it at all.
const TOL = 1.18;

// ── THE ONE ARM STILL CROSSING ITS OWN SIGN ─────────────────────────────────────────────────────
// ⚠ AN ALLOW-LIST OF MODELS WITH REASONS, NOT A BUDGET. A budget ("no more than N crossings") passes
// a new one silently the moment somebody removes an old one, which is the failure this gate exists
// to stop being silent.
const KNOWN = new Map([
  ['type:dept_store',
    "the arm raises an aerial mast from the middle of the roof and the kit hangs a gable-end ad " +
    "panel on the flank below it; the two cross only from off-square. The kit's roof hoarding takes " +
    "the offset that clears a spar (see `clears` in derivedKit) and the flank panel has no such " +
    "choice — it goes where the blank wall is. Fixing it means moving hand-written arm geometry."],
  ['type:asc_spire',
    "the same shape on the Ascendant spire: arm-drawn structure crossing the kit's own name board " +
    "at one heading out of four."],
  // ⚠ THESE TWO ARE A DEPTH SEPARATION, NOT A PLACEMENT MISTAKE, and chasing them is what proved it.
  // Both have a base box standing well forward of the wall the blades hang on — 0.3 of a tile on the
  // scale house, 0.6 on The Lucky Bastard — so the kit's plinth tube and a pictogram blade above and
  // behind it are on two different walls. Three successive attempts to clear it laterally (a shorter
  // run, a run sized against the narrower box, no returns) each moved the crossing onto different
  // models rather than removing it, because lateral clearance on one wall says nothing about the
  // other. What is drawn is a lit tube on a projecting podium passing in front of a small blade set
  // back above it, from one heading in four, which is a city rather than a defect.
  ['named:thumbonthescale',
    "the scale house's base box stands 0.3 of a tile forward of the wall its blades hang on, so the " +
    "plinth tube crosses a pictogram blade from one heading out of four. Two walls at two depths; no " +
    "lateral rule on either one can clear the other."],
  ['named:theluckybastard',
    "the same, with a 0.6-tile podium offset."],
  // ⚠ THE THIRD OF THE SAME SHAPE, AND THE FIRST WHERE BOTH PARTS ARE THE KIT'S OWN. Two walls at
  // two depths again, which no lateral rule on either one can clear.
  ['type:asc_clinic',
    "the lit pilaster rank is on the FRONT face at x ±0.117 and the gable ad panel is on the −x " +
    "FLANK (`face: 'x'`, half 0.273, spanning most of that wall), so they are on two different " +
    "walls and coincide only in screen space, from ONE heading out of four. Narrowing the rank " +
    "cannot reach it — the fins are already 0.32 of a tile inside the corner, because the two " +
    "front blades reserve it — and the panel is what the blank flank of a building is FOR. A lit " +
    "vertical on a frontage passing a foreshortened advertisement on the side wall beside it is a " +
    "city rather than a defect, which is the same call the two entries above record."],
  ['named:thecoyotesrest',
    "a saloon with a full-width porch, whose rail the arm draws as STROKES standing 0.6 of a tile " +
    "proud of the wall. The kit's Chinese trade blade is hung on that frontage and is therefore " +
    "behind the rail — which is correct occlusion rather than a wire painted over a sign, and is " +
    "not something the kit can avoid: it places parts off the captured MASS, and a stroke is not " +
    "mass, so the porch is invisible to it. Raising the blade a floor and projecting it past the " +
    "kit's own canopy (0.075) both helped and neither can reach past 0.6."],
  // ⚠ THE SAME 0.6 AS THE ENTRY ABOVE, FROM THE OTHER SIDE, AND THIS ONE NAMES THE MECHANISM.
  // `emitWire` pulls a stroke `DECO_LIFT` — 0.6 of a tile — toward the eye, because on the canvas
  // that lift was a QUEUE POSITION and a mast standing at its tile's centre has to clear its own
  // front wall to be drawn at all. `emitSurfaceText` gets the 0.05 tie-breaker instead, for the
  // opposite reason: paint is coplanar with its wall and a tie is a loss. So a stroke and a sign on
  // one building are pulled by twelve times different amounts, and wherever they overlap in screen
  // space the stroke wins whatever the world says. Here the world says the mast is BEHIND the board:
  // it rises from cy −0.1 on a roof the penthouse fronts at +0.22, and the penthouse should hide its
  // lower half. Nothing the model can do reaches it — the mast has to stand on the hw-0.22 penthouse
  // roof, the board is centred on that same box at half 0.205, and the only position that clears all
  // four headings (cy 0.18) puts the mast on the front parapet edge with 0.04 to spare.
  //
  // The fix for the class is to cap the stroke pull the way the quad pulls were capped. That is not
  // a change to make on one building's evidence: the 0.6 is what stops The Dynamo's external fire
  // stair disappearing into the wall it is bolted to, which is a worse bug than this one.
  ['named:mintcondition',
    "the model's own mast rises from cy −0.1 behind an hw-0.22 penthouse whose front face carries " +
    "the name board. emitWire pulls a stroke 0.6 of a tile toward the eye and emitSurfaceText is " +
    "capped at the 0.05 tie-breaker, so the mast wins the depth test against a board it physically " +
    "stands behind, at three headings out of four. No position on that roof clears it with any " +
    "margin; the pull is the thing to fix, and not from one building."],
  // ⚠ THE SAME MECHANISM AS THE ENTRY ABOVE, FOUND FROM THE OTHER END. The gable-end ad panel took
  // the building's name, which fills a panel a mark only covered a third of, and ten models then
  // drew something across it. Nine were a window bay, a louvre bank or a service riser on that
  // flank — real claims on the wall, and `paintFree` now declines the panel on all nine. This one
  // is not a claim: it is a cable run along the BACK wall at z 0.28, physically behind the flank
  // plane the sign is painted on, which reaches the front of it only because `emitWire` pulls a
  // stroke 0.6 of a tile toward the eye while the lettering is capped at 0.05. Nothing about the
  // panel's placement can answer that — the cable is not on its wall — and the fix is still the
  // pull, still not from one building.
  // ⚠ THE SAME TWO-WALLS-AT-TWO-DEPTHS SHAPE AS THE TWO ENTRIES ABOVE, found when the lettering
  // stopped leaning. `signSquare` puts a sign's quad where the building says it is instead of where
  // the camera's forward axis had dragged it, and this crossing had been hidden by that lean.
  ['type:studio',
    "a conduit rises up the front plane at y −1.601 and the trade blade hangs at the corner on a " +
    "face set back to −1.791, so they are 0.19 of a tile apart in depth and coincide in screen " +
    "space from ONE heading out of four. Neither is on the other's wall, so no lateral rule on " +
    "either can clear it — the same call recorded for thumbonthescale and theluckybastard."],
  // ⚠ THE FIFTH OF THE emitWire SHAPE, found when the lettering stopped leaning. `signSquare` puts
  // a sign's quad where the building says it is instead of where the camera's forward axis had
  // dragged it, and this crossing had been hidden by that drift.
  ['type:clinic',
    "a lit neon vertical runs up the frontage on the same plane as the trade sign set back behind " +
    "it, and reaches the front of it only through emitWire's 0.6-tile pull against " +
    "emitSurfaceText's tie-breaker — measured 0.6 of a tile apart in depth, which is DECO_LIFT " +
    "exactly. One heading out of four. Same mechanism as named:mintcondition and " +
    "named:unit4marrowstreet below, and the same answer: the pull is the thing to fix, and not " +
    "from one building."],
  ['named:unit4marrowstreet',
    "a cable run along the back wall at z 0.28 crosses the gable-end ad panel on the flank, at two " +
    "headings out of four. The cable is behind the plane the sign is painted on; it only reaches " +
    "the front of it through emitWire's 0.6-tile pull against emitSurfaceText's 0.05 cap. Same " +
    "mechanism as named:mintcondition above, and the same answer: the pull is the thing to fix."],
]);

// Two surfaces closer than this are the same surface — see the ⚠ at the depth test. Three times
// `FACE_EPS`, the stand-off a sign is given over its own wall, so a fitting sharing that wall can
// never be reported as standing in front of it.
const COPLANAR = 0.02;
const len = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
const inPoly = (pt, poly) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (((poly[i].sy > pt.sy) !== (poly[j].sy > pt.sy)) &&
        (pt.sx < (poly[j].sx - poly[i].sx) * (pt.sy - poly[i].sy) / (poly[j].sy - poly[i].sy) + poly[i].sx)) c = !c;
  }
  return c;
};
const segCross = (a, b, poly) => {
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const p = poly[j], q = poly[i];
    const d1 = (q.sx - p.sx) * (a.sy - p.sy) - (q.sy - p.sy) * (a.sx - p.sx);
    const d2 = (q.sx - p.sx) * (b.sy - p.sy) - (q.sy - p.sy) * (b.sx - p.sx);
    const d3 = (b.sx - a.sx) * (p.sy - a.sy) - (b.sy - a.sy) * (p.sx - a.sx);
    const d4 = (b.sx - a.sx) * (q.sy - a.sy) - (b.sy - a.sy) * (q.sx - a.sx);
    if (((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))) return true;
  }
  return false;
};

const stretched = [], crossed = new Map();
let models = 0, signs = 0, threw = 0;

ws.setTilePlace(PLACE);
for (const { key, m } of ws.shapeModelRegistry()) {
  models++;
  for (const heading of HEADINGS) {
    const cam = ws.makeCam(640, 160, 360, { heading, height: 0, eyeH: 0.24, map: null });
    const hd = heading * Math.PI / 180;
    const r = ws.canvasResidue(m, {
      cam, night: 1, bn: 'THE EXAMPLE', collect: true,
      dx: DIST * Math.sin(hd), dy: -DIST * Math.cos(hd),
    });
    if (r.threw) { if (heading === 0) { threw++; console.error(`  ✗ ${key} threw: ${r.threw}`); } continue; }
    if (!r.sink) continue;
    // `st:` is `signTexKey`'s own prefix — a decal whose artwork is a baked glyph canvas.
    const texts = r.sink.decals.filter((d) => String(d.key).startsWith('st:') && d.img && d.img.width);
    for (const d of texts) {
      if (heading === 0) signs++;
      const across = len(d.p[0], d.p[1]), down = len(d.p[0], d.p[3]);
      if (heading === 0 && across > 1e-6 && down > 1e-6) {
        const ratio = (across / down) / (d.img.width / d.img.height);
        if (ratio > TOL || ratio < 1 / TOL) {
          stretched.push({ key, ratio, tex: `${d.img.width}x${d.img.height}`, quad: `${across.toFixed(3)}x${down.toFixed(3)}` });
        }
      }
      const poly = d.p.map((w) => cam.proj(w[0], w[1], w[2]));
      if (poly.some((p) => !(p.f > 0.1))) continue;
      const fSign = poly.reduce((a, p) => a + p.f, 0) / 4;
      for (const s of r.sink.strokes) {
        // ⚠ A SIGN'S OWN FRAME IS NOT A WIRE ACROSS IT, AND NO GEOMETRY CAN TELL THOSE APART. A
        // neon box is a dark panel with a tube run round the inside of it — `marqueeBand`'s own
        // note — so the tube is ON the board by construction, at every heading, on every model
        // that has one. Measured when the hoarding and the corner blade took theirs: 93 models
        // reported, all of them the frame the sign is meant to have. What settles it is OWNERSHIP,
        // which is a thing the painter knows and this census cannot infer, so `emitWire` records
        // it (`pushStroke`'s `tag`) exactly as `glresidue` records who queued a face.
        // ⚠ AND IT IS A NAMED TAG, NEVER A BUDGET. A count would swallow the next real cable.
        if (s.tag === 'signtube') continue;
        const A = cam.proj(s.a[0], s.a[1], s.a[2]), B = cam.proj(s.b[0], s.b[1], s.b[2]);
        if (!(A.f > 0.1) || !(B.f > 0.1)) continue;
        // Behind the sign: the depth buffer hides it, correctly.
        // ⚠ AND THE TOLERANCE IS NOT SLACK — IT IS WHAT "IN FRONT OF" MEANS ON A SURFACE. A fitting
        // bolted flush to the fascia a sign is painted on is COPLANAR with it, and which of the two
        // rounds nearer is decided by the stand-off rather than by anything a model author chose.
        // Measured on `named:thedrygoods` and `type:mercantile`: a 0.024-tile dark stub at a
        // shopfront corner, 0.005 of a tile — less than `FACE_EPS` — in front of the band it grazes,
        // reported as a wire drawn across a sign. The five real crossings below are 0.2 of a tile and
        // more, so this cannot hide one; it was checked by re-running with the tolerance and without.
        if (Math.min(A.f, B.f) >= fSign - COPLANAR) continue;
        if (inPoly(A, poly) || inPoly(B, poly) || segCross(A, B, poly)) {
          crossed.set(key, (crossed.get(key) | 0) + 1);
          break;
        }
      }
    }
  }
}

if (REPORT) {
  console.log(`\n  ${models} models · ${signs} sign quads at heading 0\n`);
  console.log(`  stretched (${stretched.length}):`);
  for (const s of stretched.slice(0, 30)) console.log(`    ${s.key.padEnd(32)} ${s.ratio.toFixed(2)}x   tex ${s.tex.padEnd(11)} quad ${s.quad}`);
  console.log(`\n  crossed (${crossed.size} models):`);
  for (const [k, n] of [...crossed].sort((a, b) => b[1] - a[1])) console.log(`    ${k.padEnd(34)} ${n}${KNOWN.has(k) ? '  (known)' : ''}`);
  console.log();
}

let bad = 0;
if (threw) { console.error(`\n  ${threw} model(s) threw during the census`); bad += threw; }
if (stretched.length) {
  bad += stretched.length;
  console.error(`\n  ${stretched.length} sign quad(s) do not match their own texture's aspect, so the lettering is stretched:\n`);
  for (const s of stretched.slice(0, 12)) console.error(`    ${s.key} — ${s.ratio.toFixed(2)}x (texture ${s.tex}, quad ${s.quad})`);
  console.error('\n  Every sign goes through emitSurfaceText, which fits the texture into the caller\'s quad');
  console.error('  with fitSignPts. A quad that reaches here unfitted took a path that skips it.\n');
}
const unlisted = [...crossed.keys()].filter((k) => !KNOWN.has(k));
if (unlisted.length) {
  bad += unlisted.length;
  console.error(`\n  ${unlisted.length} model(s) draw a wire, mast or tube ACROSS their own signage:\n`);
  for (const k of unlisted) console.error(`    ${k} — ${crossed.get(k)} (sign, heading) pair(s)`);
  console.error('\n  The kit can move its own parts out of the way — see `clears` on the roof hoarding,');
  console.error('  `signTop` on the neon run, and UNSIGNED_TRADE. If the crossing is between two pieces');
  console.error('  of hand-written arm geometry, add the model to KNOWN with the reason it cannot move.\n');
}
if (bad) { console.error(`✗ signfit — ${bad} finding(s).`); process.exit(1); }
console.log(`  signfit: ${signs} signs over ${models} models — every one drawn at its texture's own proportions, and ${crossed.size} model(s) with a known wire across one.`);
