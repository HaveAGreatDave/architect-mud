// DOES A BUILDING STILL SAY ITS OWN NAME WHEN YOU MOVE?
//
//   node scripts/shapes/signfloor.mjs            # gate: fails on a model that loses lettering
//   node scripts/shapes/signfloor.mjs --report   # every model, near → far, worst first
//
// Reported from the cab as "the ROOMS · BATHS · BAR sign on the Embassy, and signs like it, blink
// out so you can't see the text at certain angles". Both halves of that sentence turned out to be
// load-bearing and neither means what it sounds like.
//
// ⚠ IT IS NOT AN ANGLE, IT IS A DISTANCE WEARING AN ANGLE'S CLOTHES. `detailLayer`'s screen-size
// floor is measured against `hostF` — the building's FORWARD distance — so a building parked two
// tiles away is at f = 2.0 looked at square on and f = 1.3 with the cab turned fifty degrees. Turn
// the wheel and the sign crosses its own floor without moving an inch. That is why it reads as an
// angle, and why nobody could find it by driving closer.
//
// ⚠ AND IT IS NOT THE SIGN THAT IS GATED, IT IS THE WHOLE PART — board and all. In GLASS 1 that is
// invisible: the board goes with its name and a building simply has no sign there. In GLASS 2 the
// board is in the MESH, captured once at `ADORN_NEAR` with the floor deliberately skipped, so the
// GPU draws it at every distance while the live pass drops the lettering. A blank board is worse
// than no board — this repo has a paragraph about that under `signBoard` — and it arrived by the
// same route as the rich-list bug in `detailLayer`: the mesh has the part, the painter never ran.
//
// ⚠ AND THE FLOOR READS THE ONE DIMENSION A SIGN AUTHOR MINIMISES ON PURPOSE. `dz` comes off `hh`,
// the part's half-HEIGHT, which is a fair size for a vent or a pipe and is the depth of the BAND on
// a name board. A board is wide and shallow because that is what a name board is: the Embassy's
// "ROOMS · BATHS · BAR" is `half` 0.175 against `hh` 0.021, so the gate asks whether a sign a
// third of a tile wide is big enough by measuring the four-hundredths of a tile it is deep.
//
// So the fix is the `FLAT_OFF` term beside the `MESH_SINK` one, and this is the measurement that
// justifies it: 25 of 186 models lost lettering between 1.2 and 2.9 tiles before it and 0 after.
//
// ⚠ WHY THE COMPARISON IS NEAR-AGAINST-FAR AND NOT A COUNT. "This model emits two sign decals" is a
// fact about today's content and would have to be edited every time somebody names a building. What
// cannot be true at any point in the future is that a sign READS at a tile and a bit and is gone at
// under three — both well inside `detailNear`, both close enough to touch, and the mesh drawing the
// board the whole way. A model with no signage at all is silent in both runs and passes, correctly.
import { loadWindshield } from './dom-stub.mjs';

const REPORT = process.argv.includes('--report');
const ws = await loadWindshield();

// The same camera `glresidue` and `glself` use, for the same reason: `emitSurfaceText` hands its
// quad to the decal layer through `cam.unproj`, and the stub camera has none — under the stub every
// painted sign in the city falls to its canvas branch and this file would measure nothing at all.
const cam = ws.makeCam(640, 160, 360, { heading: 0, height: 0, eyeH: 0.24, map: null });

// Both inside `RENDER_TUNE.detailNear` (3), so the tier that runs the kit is the same at both ends
// and the only thing that differs is the per-part floor. Push FAR past 3 and this would be
// measuring the tier instead, which is a real and separate question — see the note at the bottom.
const NEAR = -1.2, FAR = -2.9;

// `canvasResidue` sets up a GLASS 2 frame: `FLAT_OFF` on, no mesh sink, `ADORN_NEAR`. That is
// exactly the frame the bug lives in, and it is the one this has to ask the question of.
function lettering(m, dy) {
  const r = ws.canvasResidue(m, { cam, night: 1, bn: 'THE EXAMPLE', dy, collect: true });
  if (r.threw) return null;
  // `st:` is `signTexKey`'s prefix — one id per baked lettering canvas, so this counts SIGNS and
  // not the boards, frames, soffits and panels that share the layer.
  return (r.sink.decals || []).filter((d) => String(d.key).startsWith('st:')).length;
}

const rows = [];
let models = 0, threw = 0;
for (const { key, m } of ws.shapeModelRegistry()) {
  models++;
  const near = lettering(m, NEAR), far = lettering(m, FAR);
  if (near == null || far == null) { threw++; continue; }   // a throwing arm is `shapes:smoke`'s question
  if (REPORT && near) rows.push({ key, near, far, lost: near - far });
  else if (far < near) rows.push({ key, near, far, lost: near - far });
}
rows.sort((a, b) => b.lost - a.lost || b.near - a.near);

if (REPORT) {
  console.log(`── sign lettering at ${-NEAR} vs ${-FAR} tiles, ${models} models ──`);
  for (const r of rows) {
    console.log('  ' + r.key.padEnd(34) + String(r.near).padStart(3) + ' → ' + String(r.far).padStart(3)
      + (r.lost > 0 ? '   LOST ' + r.lost : ''));
  }
  console.log(`  ${rows.filter((r) => r.lost > 0).length} of ${models} lose lettering` + (threw ? `  (${threw} arm(s) threw)` : ''));
} else {
  const bad = rows.filter((r) => r.lost > 0);
  if (bad.length) {
    console.error(`signfloor: ${bad.length} of ${models} models stop saying their own name between ${-NEAR} and ${-FAR} tiles.`);
    console.error('  In GLASS 2 the board is drawn from the mesh at every distance, so what this leaves on screen is a');
    console.error('  blank sign. See the FLAT_OFF term on the screen-size gate in detailLayer.');
    for (const r of bad.slice(0, 12)) console.error('   ✗ ' + r.key.padEnd(34) + r.near + ' → ' + r.far);
    if (bad.length > 12) console.error(`   … and ${bad.length - 12} more`);
    process.exit(1);
  }
  const signed = rows.length;   // in gate mode `rows` only holds losers, so recount for the summary
  let withSigns = 0;
  for (const { m } of ws.shapeModelRegistry()) if (lettering(m, NEAR)) withSigns++;
  // ⚠ THE CONTROL. Zero losers is also what comes back when nothing in the registry signs itself at
  // all — a stub camera, a broken bake, a renamed key — and that run would look exactly like a pass.
  if (!withSigns) {
    console.error('signfloor: not one model in the registry emitted any lettering, so this proves nothing.');
    process.exit(1);
  }
  console.log(`signfloor: ${withSigns} of ${models} models sign themselves, and none loses its lettering between ${-NEAR} and ${-FAR} tiles.`);
}

// ⚠ WHAT THIS DELIBERATELY DOES NOT COVER, AND THE NUMBER THAT SAYS WHY. Past `detailNear` (3
// tiles) the live kit does not run AT ALL — `drawWorldObjects` only raises `ADORN_TIER` to
// `ADORN_NEAR` inside it — so in GLASS 2 every board in the city beyond three tiles is a blank
// board for the same reason one tile inside it used to be. That is the same bug at a larger radius
// and it is NOT fixed here, because fixing it means running the detail painters over the whole
// window: measured on a dense night block, raising `detailNear` from 3 to 6 took the frame from
// 21.0 to 24.3 ms and to 9 took it to 36.2. A third of the frame is a decision somebody makes on
// purpose, not a side effect of a sign fix.
