// IS A BUILDING'S ADORNMENT DRAWING THROUGH THE BUILDING NEXT DOOR?
//
// ⚠ IT IS A REPORT, NOT A GATE, for `models:quality`'s reason: a gate that is red on the day it
// lands is a gate somebody turns off. It is in no npm chain on purpose, it exits 1 so a person
// reading it can tell red from green, and `--fail-over N` is not here yet because the remaining
// list is a design project rather than a list of mistakes — see the ⚠ four paragraphs down. What
// it is NOT is a gate that passes: this line exists because the file did not carry it, and a
// reader who ran the push chain had no way to know this question was never being asked.
//
// `glself` asks whether a part is dragged out of its OWN mass. That question is answered and its
// budgets are committed. This is the other half of the same sentence, and nothing was watching it:
// a part pulled clear of its own facade is pulled toward the eye, and the eye is not always square
// on. Past a certain rake the building NEXT DOOR is what the pull crosses.
//
// ⚠ AND THE NUMBERS THAT AUTHORISE THE PULLS WERE ALL CHOSEN SQUARE ON. `BLADE_PROUD` is 0.25
// because that "clears the deepest facade (0.44) and stays under the near face of a building one
// tile in front (0.56)". Both halves of that are distances along the LINE OF SIGHT, and 0.56 is
// only the gap between two tiles when you are looking straight down the line joining them. Rake
// the view and the same two tiles close up: at 60° off the axis the neighbour's near face is
// 0.28 tiles ahead rather than 0.56, at 70° it is 0.19, and at 75° it is 0.14 — under the pull.
// The sign then draws in front of a wall it is physically behind, and because the crossing happens
// at a rake, it happens at a screen distance of nearly a whole tile rather than a hair.
//
// That is the "signage pops out at certain angles" report, and it is a report neither existing
// harness could have made. `glself`'s occluder is the subject itself. `__glLeak`'s wall is square
// on and eight tiles out, which is outside `detailNear` — so not one board, blade, canopy or neon
// run is ever emitted into a frame it measures, and its own note says so.
//
// ⚠ THE MEASUREMENT IS THE SAME DIFFERENCE `glself` MAKES, against a different occluder. Each arm
// runs twice, once with the pulls and once with `PULL_OFF`; the first says where the renderer will
// draw a point and the second says where it physically is. A leak is a point behind the NEIGHBOUR
// in the second and in front of it in the first. Nothing here rasterises, so a red names a model,
// a painter and an angle rather than a percentage of a picture.
//
// ⚠ AND THE NEIGHBOUR IS A PLAIN BOX ON THE NEXT TILE, deliberately. A terrace is what Coldwater is
// made of and the occluder's own shape is not the variable under test — using a second real model
// would make every row depend on which model happened to be picked.
//
// ⚠ AND IT IS NOT IN THE PUSH CHAIN YET, WHICH IS A STATEMENT ABOUT THE BUG RATHER THAN ABOUT THE
// GATE. It is RED at HEAD — `stroke` crosses the neighbour by up to 0.416 tiles over 246 points,
// because `emitWire` still spends the full `DECO_LIFT` (0.6) as a pull. That is a real defect and
// fixing it is a design question, not a patch: a mast authored at its own tile CENTRE genuinely
// needs more than half a tile of view-ray clearance to escape its own facade at a rake, and any
// pull large enough to give it that is large enough to reach the tile next door. The honest fix is
// to author those parts where they physically are and leave the pull as a tie-breaker, which is
// 172 arms' worth of work. Wiring a red gate into `pretest:regress` stops every push in the repo
// until that is done, so it ships as a report and this note is what stops it being forgotten.
// `decal:gantry` is 74 points at a worst of 0.020 tiles — a hair, and correct for a tie-breaker.
//
// ⚠ AND "172 ARMS' WORTH OF WORK" IS WRONG — IT IS FIVE MODELS, MEASURED. The paragraph above
// was written before anything attributed a leak to the function that queued it, so it had to
// assume the worst. `pushStroke` stamps its caller whenever a harness is asking (emitWho in
// windshield.js), and with that the 246 stroke points are nine call sites, not a population:
//
//     22 pts  worst 0.416   drawTypeModelArm < drawTypeModel   3 models
//     21 pts  worst 0.333   mast < drawTypeModelArm            2 models
//     22 pts  worst 0.052   emitLightRunner < helixRunner      4 models
//     78 pts  worst 0.050   drawRing < drawTypeModelArm       13 models
//     …and four more, every one of them under 0.055
//
// Read the `pull` column with it and the split is clean. Every caller under 0.055 ALREADY asks
// for a tie-breaker (0.03–0.05) and crosses by almost exactly the pull it asked for — which is
// the silhouette case this file's own HAIRLINE note describes, just larger than the 0.005 that
// note picked. A tie-breaker cannot put a part meaningfully inside anything: the most it can
// spend is 0.05 of a tile, about one wall thickness. All of the real crossing is the two callers
// still spending the full DECO_LIFT as a depth.
//
// ⚠ AND A PULL CAP WOULD DELETE THOSE TWO, WHICH IS WHY THIS IS AUTHORING AND NOT A PATCH. The
// obvious fix is to clamp `emitWire` the way `emitDecoQuad` and `emitDecoFill` were clamped, and
// it was tested before being proposed: for each leaking stroke, is its UNPULLED position inside
// its own model's captured mass? `drawTypeModelArm` 22 of 22, `mast` 15 of 21. They are buried
// in their own buildings, exactly as the ⚠ on DECO_LIFT in windshield.js says, and a part that is
// buried is not drawn at all without the pull — The Dynamo's external fire stair is the recorded
// case. So the work is to move those parts OUT in the model, and it is these five:
//
//   named:stackoverflow · named:thecoyotesrest · type:fabrication      (drawTypeModelArm)
//   named:coldwaterclonefacility · named:thedeadpigeon                 (mast)
//
// Five models is a sitting worth of Modelshop, not a rewrite of the city. What it needs is
// somebody who can see the picture, which is the one thing this gate cannot supply.
//
// ⚠ AND FOR A WHILE IT REPORTED 11.872 TILES, WHICH WAS THIS GATE READING A BUG IN THE HARNESS
// UNDER IT RATHER THAN A BUG IN THE CITY. `captureRawPass` saved and nulled `FACE_SINK` and left
// `STROKE_SINK`, `DECAL_SINK`, `SPRITE_SINK` and `MESH_SINK` installed, so the shape capture — which
// runs the arm AGAIN, against `SHAPE_STUB_CAM` — pushed the arm's strokes into the live sink at the
// stub's own standoff. This gate renders the pulled pass FIRST and the unpulled one second, so the
// first was contaminated, the second was not, and `couples()` pairs by INDEX: past the divergence
// every row compared two unrelated strokes. `type:asc_shrine` came back 36 strokes against 6 and
// `named:thecoyotesrest` 72 against 42, which is where a "leak" of nearly twelve tiles came from.
// Two lessons worth more than the number. A pull may move a point and may NEVER change how many
// points there are, so a count mismatch between the two passes is a defect in the harness and this
// gate now says so out loud instead of quietly pairing across it. And a first render of a model is
// not the same as a second: anything that compares two passes must warm the model first, or it is
// measuring the shape cache filling up.
//
//   npm run gl:neighbour                           # the census, with reasons (exits 1 while red)
//   node scripts/shapes/glneighbour.mjs            # gate (red today — see above)
//   node scripts/shapes/glneighbour.mjs --report   # every leaking model, by painter and by angle
import { loadWindshield } from './dom-stub.mjs';
import { eyePos } from '../../client/game/js/panels/gl/camera.js';

const ws = await loadWindshield();
const REPORT = process.argv.includes('--report');

const FH = 0.4, H = 1, SEED = 3;
// How far the eye stands off the subject. Two tiles is where `glself` sits because that is a cab at
// a frontage; here it has to be far enough back that a neighbour can get between the two, and close
// enough that the detail kit is still emitted (`RENDER_TUNE.detailNear`, 3 tiles — the reason
// `__glLeak` at eight sees none of this).
const R = 2.6;
// ⚠ SQUARE ON IS THE CASE THAT CANNOT FAIL, and it is here as the control rather than as coverage.
// A neighbour beside the subject occludes nothing at 0°, so a row at 0° that leaks is a `glself`
// bug reaching this gate, not a neighbour bug.
const ANGLES = [0, 30, 45, 55, 62, 68, 72, 76];
// The next tile along the terrace, on the side the eye is on. Buildings here face south, so a
// terrace runs east–west and the neighbour is one tile in x.
// ⚠ THREE PLACES A NEIGHBOUR CAN STAND, AND ONE OF THEM IS NOT BESIDE. A first cut used only the
// next tile along the terrace, which is the arrangement a rake closes up — and it is not the only
// one: the building ACROSS THE STREET is square on and a tile nearer, which is what a blade hanging
// out over the pavement crosses. Three heights as well, because a part only crosses a neighbour it
// is level with and a single height silently exempts everything above or below it.
const NEIGHBOURS = [[-1, 0], [1, 0], [0, 1]];
const HEIGHTS = [0.9, 1.6, 2.6];
const HALF = 0.44;         // `draw3DBoxAt`'s own clamp — the deepest a facade in this city ever is
// ⚠ A CROSSING AT THE SILHOUETTE IS NOT A FINDING, and without this the gate cannot say so. Two
// buildings' surfaces MEET in depth exactly at the near one's silhouette edge, so a point there is
// crossed by any pull at all, however small — which makes a bare count report a hairline at a
// corner and a sign standing a third of a tile out in clear air as one point each. A tenth of the
// tie-breaker (`DECO_PULL` is 0.05) is under a pixel at any range a sign is drawn at.
const HAIRLINE = 0.005;

// ⚠ SAMPLED ALONG THE SEGMENT, AND THE COUNT IS A FLOOR NOT A PREFERENCE — `glself`'s own note. A
// wall is about 0.05 tiles thick at its thinnest, so a coarse march steps clean over one and
// reports every sign behind it as unoccluded, which is a gate that passes everything.
const STEPS = 220;

// A plain box on the next tile, in the frame the sinks are in.
function neighbourSolid(nx, ny, nh) {
  return (x, y, z) => z >= 0 && z <= nh && Math.abs(x - nx) <= HALF && Math.abs(y - ny) <= HALF;
}

// Does the open segment from `p` to the eye pass through the neighbour?
function hidden(solid, p, eye) {
  for (let i = 1; i < STEPS; i++) {
    const t = i / STEPS;
    if (solid(p[0] + (eye[0] - p[0]) * t, p[1] + (eye[1] - p[1]) * t, p[2] + (eye[2] - p[2]) * t)) return true;
  }
  return false;
}

// ⚠ AND HOW FAR OUT, BECAUSE A COUNT ON ITS OWN CANNOT TELL THE TWO CASES APART. At the exact
// SILHOUETTE of the neighbour the depth gap between the two buildings is zero, so ANY pull crosses
// it there and a gate counting crossings reports a hairline at a building's edge and a sign hanging
// a third of a tile out in clear air as one point each. The first is a pixel nobody will ever see;
// the second is the bug. The pull moves the point along a straight segment from B (where it is) to
// A (where it is drawn), so bisecting that segment for the moment it leaves the neighbour gives the
// part of the pull that was spent in somebody else's building — which is the number that matters.
function overshoot(solid, A, B, eye) {
  let lo = 0, hi = 1;                       // t=0 is B (hidden), t=1 is A (not)
  for (let i = 0; i < 24; i++) {
    const t = (lo + hi) / 2;
    const p = [B[0] + (A[0] - B[0]) * t, B[1] + (A[1] - B[1]) * t, B[2] + (A[2] - B[2]) * t];
    if (hidden(solid, p, eye)) lo = t; else hi = t;
  }
  const d = Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
  return d * (1 - hi);
}

// Every adornment in a sink pair, as (drawn, true) point couples with a tag. Same shape as
// `glself.mjs` — see the ⚠ there on why sprites are deliberately absent (a light takes no unproj
// pull at all; its nudge is a tie-breaker in clip z and cannot move it through a wall).
function* couples(a, b, whoKey, whoDeg) {
  const n = Math.min(a.strokes.length, b.strokes.length);
  // ⚠ SEE THE HEADER: a pull moves points and never invents them, so a length mismatch here means
  // something upstream leaked into a sink and the two lists are no longer the same parts in the
  // same order. Pairing across that reports nonsense with total confidence, which is what it did.
  if (a.strokes.length !== b.strokes.length || a.decals.length !== b.decals.length) {
    MISPAIRS.push(`${whoKey} @${whoDeg}°: strokes ${a.strokes.length} vs ${b.strokes.length}, decals ${a.decals.length} vs ${b.decals.length}`);
    return;
  }
  for (let i = 0; i < n; i++) {
    // ⚠ THE CALLER RIDES ALONG, because "stroke" is not a finding anybody can act on. An arm draws
    // dozens of wires and only some cross; `pushStroke` stamps who queued it whenever a harness is
    // asking (see emitWho in windshield.js), and `canvasResidue` is such a harness.
    const who = a.strokes[i]._who || '?';
    yield ['stroke', a.strokes[i].a, b.strokes[i].a, who];
    yield ['stroke', a.strokes[i].b, b.strokes[i].b, who];
  }
  const m = Math.min(a.decals.length, b.decals.length);
  for (let i = 0; i < m; i++) {
    const key = String(a.decals[i].key || 'decal').split('|')[0];
    for (let c = 0; c < a.decals[i].p.length && c < b.decals[i].p.length; c++) {
      yield ['decal:' + key, a.decals[i].p[c], b.decals[i].p[c], 'decal'];
    }
  }
}

const MISPAIRS = [];            // passes whose sinks disagreed in LENGTH — a harness bug, never a leak
const leaks = new Map();        // model → { n, tags: Map, angles: Map }
const byTag = new Map();
const byTagWorst = new Map();
const byAngle = new Map();
const byWho = new Map();        // stroke caller → { n, worst } — the actionable half of a finding
let models = 0, checked = 0, movedPts = 0, hairs = 0;

for (const { key, m } of ws.shapeModelRegistry()) {
  models++;
  for (const deg of ANGLES) {
    const th = deg * Math.PI / 180;
    // The subject stands `R` away on the bearing `deg`; the camera turns to face it, so the pair
    // stays in frame and only the RAKE changes. The neighbour is the next tile along the terrace on
    // the eye's side, which is what puts it between the two.
    const dx = R * Math.sin(th), dy = -R * Math.cos(th);
    const cam = ws.makeCam(640, 160, 360, { heading: deg, height: 0, eyeH: 0.24, map: null });
    const eye = eyePos(cam);

    // ⚠ THE ARM RUNS ONCE PER ANGLE, NOT ONCE PER NEIGHBOUR. Where a part is drawn does not depend
    // on what is standing next to it, so re-running it for each arrangement would be nine times the
    // work for the same two sinks.
    const opts = { cam, night: 1, bn: 'THE EXAMPLE', dx, dy, fh: FH, h: H, seed: SEED, collect: true };
    // ⚠ WARMED FIRST, AND THE HEADER SAYS WHY AT LENGTH. The FIRST render of a model is not the
    // picture every later one is: the derived kit asks shapeForModel, that capture is memoised on
    // the model's identity, and until it has run the kit has no shape to hang a part on — measured
    // on type:noodle_bar, whose light runner is 0 strokes on the first pass and 4 on every one
    // after it. Two passes with a cold cache between them compare the cache filling up, not a pull.
    ws.canvasResidue(m, opts);
    const drawn = ws.canvasResidue(m, opts);
    const truth = ws.canvasResidue(m, { ...opts, noPull: true });
    if (drawn.threw || truth.threw) continue;
    if (!drawn.sink || !truth.sink) continue;
    const pairs = [...couples(drawn.sink, truth.sink, key, deg)];

    for (const [ox, oy] of NEIGHBOURS) {
      for (const nh of HEIGHTS) {
        const nSolid = neighbourSolid(dx + ox, dy + oy, nh);
        for (const [tag, A, B, who] of pairs) {
          if (!A || !B) continue;
          checked++;
          const d = Math.abs(A[0] - B[0]) + Math.abs(A[1] - B[1]) + Math.abs(A[2] - B[2]);
          if (d < 1e-9) continue;                  // untouched by the pull — nothing to test
          movedPts++;
          if (!hidden(nSolid, B, eye)) continue;   // it was never behind the neighbour
          if (hidden(nSolid, A, eye)) continue;    // still behind it after the pull — the depth buffer has it
          const out = overshoot(nSolid, A, B, eye);
          if (out < HAIRLINE) { hairs++; continue; }
          const e = leaks.get(key) || { n: 0, worst: 0, tags: new Map(), angles: new Map(), where: new Set() };
          e.n++; if (out > e.worst) e.worst = out;
          e.tags.set(tag, (e.tags.get(tag) || 0) + 1);
          e.angles.set(deg, (e.angles.get(deg) || 0) + 1);
          e.where.add(oy ? 'across' : 'beside');
          leaks.set(key, e);
          byTag.set(tag, (byTag.get(tag) || 0) + 1);
          byTagWorst.set(tag, Math.max(byTagWorst.get(tag) || 0, out));
          byAngle.set(deg, (byAngle.get(deg) || 0) + 1);
          if (tag === 'stroke') {
            const w = byWho.get(who) || { n: 0, worst: 0, models: new Set() };
            w.n++; if (out > w.worst) w.worst = out; w.models.add(key);
            byWho.set(who, w);
          }
        }
      }
    }
  }
}

// ── THE ALLOW-LIST ──────────────────────────────────────────────────────────
//
// ⚠ REASONS, NEVER COUNTS, the argument `glresidue` and `glself` both make at length: a budget
// passes a new leak the moment somebody deletes an old one. An entry here says why a painter may
// cross the building next door, which is a much harder thing to justify than crossing its own host
// — a part authored inside its OWN mass has to come out or it is not drawn, and there is no
// equivalent excuse for a part standing in somebody else's wall.
const KNOWN = new Map([
]);

const rows = [...leaks.entries()].sort((a, b) => b[1].n - a[1].n);
if (REPORT) {
  console.log(`\n  neighbour census — ${models} models × ${ANGLES.length} angles, ${checked} adornment points, ${movedPts} moved by a pull\n`);
  for (const [tag, n] of [...byTag.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(6)}  ${tag}   worst ${byTagWorst.get(tag).toFixed(3)} tiles out${KNOWN.has(tag) ? '   (allowed)' : ''}`);
  }
  console.log('');
  for (const deg of ANGLES) console.log(`  ${String(byAngle.get(deg) || 0).padStart(6)}  at ${deg}° off the axis`);
  console.log('');
  for (const [key, e] of rows.slice(0, 20)) {
    console.log(`  ${String(e.n).padStart(5)}  ${key}   ${[...e.tags.entries()].map(([t, n]) => t + ' ' + n).join(', ')}`
      + `   worst ${e.worst.toFixed(3)}   ${[...e.where].join('+')}   [${[...e.angles.keys()].sort((a, b) => a - b).join('°, ')}°]`);
  }
  console.log('');
}

const problems = [];
// ⚠ A MISPAIR OUTRANKS EVERY LEAK BELOW IT, because it means the two lists were not the same
// parts and no row measured from them means anything. See the header.
if (MISPAIRS.length) {
  problems.push(`the two passes emitted different numbers of adornments in ${MISPAIRS.length} case(s)`
    + ` — a sink leaked into the pulled pass, so nothing below is measured from matching parts.`
    + ` First: ${MISPAIRS[0]}`);
}
for (const [tag, n] of byTag) {
  const k = KNOWN.get(tag);
  if (!k) {
    const worst = rows.filter((r) => r[1].tags.has(tag)).slice(0, 3).map((r) => r[0]).join(', ');
    problems.push(`${tag} is not declared — ${n} points drawing through the building NEXT DOOR`
      + ` by up to ${byTagWorst.get(tag).toFixed(3)} tiles, worst: ${worst}`);
    if (tag === 'stroke' && byWho.size) {
      const top = [...byWho.entries()].sort((a, b) => b[1].worst - a[1].worst).slice(0, 4)
        .map(([w, e]) => `${w} ${e.n}pt/${e.worst.toFixed(3)}`).join(', ');
      problems[problems.length - 1] += `\n      by caller: ${top}`;
    }
  } else if (n > k.budget) {
    problems.push(`${tag} leaks ${n} points against a committed ${k.budget}`);
  } else if (REPORT && n < k.budget) {
    console.log(`  · ${tag} is down to ${n} from a committed ${k.budget} — re-bless it in glneighbour.mjs`);
  }
}

if (REPORT) {
  if (byWho.size) {
    console.log('\n  stroke leaks by CALLER — a tie-breaker caller crossing by its own pull is the');
    console.log('  silhouette case; a caller still spending the full DECO_LIFT is the real one:');
    for (const [w, e] of [...byWho.entries()].sort((a, b) => b[1].worst - a[1].worst))
      console.log(`    ${String(e.n).padStart(5)} pts  worst ${e.worst.toFixed(3)}  ${w}  (${e.models.size} model(s))`);
    console.log('');
  }
  console.log(`  · ${movedPts} of ${checked} adornment points are moved by a pull`);
  console.log(`  · ${hairs} more cross the neighbour by under ${HAIRLINE} tiles — silhouette hairlines, not findings`);
  console.log(`  · ${[...byTag.values()].reduce((a, b) => a + b, 0)} of those cross the neighbour, over ${leaks.size} models`);
}

if (problems.length) {
  console.log(`\n✗ glneighbour — ${problems.length} problem(s):`);
  for (const p of problems) console.log('  ' + p);
  console.log(`
  A pull is a TIE-BREAKER against the surface a part lies on. If a part needs more
  than that to clear its own host, the part is authored in the wrong place — move it
  out in the model rather than buying the clearance back at the eye, because the
  distance it buys is spent against every other building as well.
`);
  process.exit(1);
}
console.log(`✓ glneighbour: no adornment is pulled through the building next door (${models} models × ${ANGLES.length} angles, ${movedPts} moved points).`);
