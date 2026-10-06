// DOES A BUILDING STILL SAY ITS OWN NAME FROM DOWN THE STREET?
//
//   node scripts/shapes/signrange.mjs            # gate: fails on a model whose name stops at the near ring
//   node scripts/shapes/signrange.mjs --report   # every model, near → far, worst first
//
// The sibling of `signfloor.mjs` one ring out, and the bug that file's closing note names and
// deliberately leaves alone: past `RENDER_TUNE.detailNear` — THREE TILES — `detailLayer` returned
// before it ran at all, so the derived kit's boards, gantries and blades emitted no lettering
// anywhere in the city except where you were practically parked against the wall.
//
// ⚠ WHAT MADE IT READ AS "THE SIGNS HAVE NO TEXT" RATHER THAN AS DETAIL BEING SHED IS THAT THE
// BOARD IS ON THE OTHER RENDERER. `captureModelMesh` forces `ADORN_NEAR` and takes the whole kit
// into the per-model mesh, which the GPU then draws at every distance; the LETTERING is a decal
// built fresh each frame from the tile's own name, and the only pass that emits one is the one that
// returned. So the city was full of lit, framed, empty plates — the exact failure this repo already
// has paragraphs about under `signBoard`, `signShed` and the rich-list fix inside `detailLayer`,
// each of which opened a gate one layer deeper than the one that was actually shut.
//
// ⚠ AND A `$name` BOARD WAS NOT BLANK, IT WAS ABSENT. Its slab is a `paint` quad — per TILE, so in
// no per-model mesh by construction — which means past three tiles nothing drew it at all. Measured
// on one shop at a fixed world tile: 17 decals at two tiles and ZERO at three through fourteen.
//
// ⚠ WHY NEAR-AGAINST-FAR AND NOT A COUNT, same reason `signfloor` gives: "this model emits two sign
// decals" is a fact about today's content and would need editing every time somebody names a
// building. What cannot become true is that a building says its name at two tiles and is blank at
// six, with the board on screen the whole way.
import { loadWindshield } from './dom-stub.mjs';

const REPORT = process.argv.includes('--report');
const ws = await loadWindshield();

// The same camera `signfloor`, `glresidue` and `glself` use, and for the same reason: a sign
// reaches the decal layer through `cam.unproj`, which the stub camera has none of — under the stub
// every sign in the city falls to its canvas branch and this file would measure nothing at all.
const cam = ws.makeCam(640, 160, 360, { heading: 0, height: 0, eyeH: 0.24, map: null });

// INSIDE `detailNear` (3) and well outside it. The tier is the thing that differs, because the tier
// is the bug: `drawWorldObjects` raises `ADORN_TIER` to `ADORN_NEAR` only inside that ring and
// leaves it at `ADORN_RICH` from there out to `lodNear`, which is the state most of the city is
// drawn in and the state nothing was lettering in.
const NEAR = { dy: -2.0, tier: ws.ADORN_NEAR };
const FAR = { dy: -6.0, tier: ws.ADORN_RICH };

// And the same building from a detached free camera. A building's position is measured from the
// VEHICLE, and a free camera's eye is wherever it was flown (`fy` here), so this building stands 18
// tiles from the truck and 6 from the eye. It projects exactly as FAR does from the cab, so it has
// to letter exactly as FAR does. The sign range used to be measured from the truck, and a free
// camera parked in front of a building more than 12 tiles from it saw the boards with no names.
const FREE = { dy: -18.0, tier: ws.ADORN_RICH };
const freeCam = ws.makeCam(640, 160, 360, { heading: 0, height: 0, eyeH: 0.24, map: null },
  { back: 0, up: 0, fx: 0, fy: FREE.dy - FAR.dy, ez: 0.24 });

// `canvasResidue` sets up a GLASS 2 frame — `FLAT_OFF` on, a live decal sink, no mesh sink — which
// is the only frame this bug exists in: with no decal sink the pass declines on purpose, because
// on the 2-D painter a sign is eight affine strips and shedding it is the renderer working.
function lettering(m, at, c = cam) {
  const r = ws.canvasResidue(m, { cam: c, night: 1, bn: 'THE EXAMPLE', dy: at.dy, tier: at.tier, collect: true, who: false });
  if (r.threw) return null;
  // `st:` is `signTexKey`'s prefix — one id per baked lettering canvas, so this counts SIGNS and
  // not the boards, frames, soffits and legs that share the layer.
  return (r.sink.decals || []).filter((d) => String(d.key).startsWith('st:')).length;
}

function sweep() {
  const rows = [];
  let models = 0, threw = 0, withSigns = 0, truckShed = 0;
  for (const { key, m } of ws.shapeModelRegistry()) {
    models++;
    const near = lettering(m, NEAR), far = lettering(m, FAR);
    const free = lettering(m, FREE, freeCam), cabFree = lettering(m, FREE);
    if (near == null || far == null || free == null || cabFree == null) { threw++; continue; }   // a throwing arm is `shapes:smoke`'s question
    if (near) withSigns++;
    // The control for the free camera: from the cab, 18 tiles is past `signFar`, so some model has
    // to shed lettering there. If none does, the range isn't gating at 18 and `free` proves nothing.
    if (cabFree < far) truckShed++;
    const lost = Math.max(near - far, far - free);
    if (REPORT ? near : lost > 0) rows.push({ key, near, far, free, lost });
  }
  rows.sort((a, b) => b.lost - a.lost || b.near - a.near);
  return { rows, models, threw, withSigns, truckShed, lost: rows.filter((r) => r.lost > 0) };
}

const live = sweep();

if (REPORT) {
  console.log(`── sign lettering at ${-NEAR.dy} vs ${-FAR.dy} tiles, ${live.models} models, signFar ${ws.RENDER_TUNE.signFar} ──`);
  for (const r of live.rows) {
    console.log('  ' + r.key.padEnd(34) + String(r.near).padStart(3) + ' → ' + String(r.far).padStart(3)
      + ' → ' + String(r.free).padStart(3) + ' free' + (r.lost > 0 ? '   LOST ' + r.lost : ''));
  }
  console.log(`  ${live.lost.length} of ${live.models} lose lettering past the near ring or in front of a free camera`
    + (live.threw ? `  (${live.threw} arm(s) threw)` : ''));
} else {
  if (live.lost.length) {
    console.error(`signrange: ${live.lost.length} of ${live.models} models stop saying their own name between ${-NEAR.dy} and ${-FAR.dy} tiles,`);
    console.error(`  or ${-FAR.dy} tiles in front of a free camera ${-FREE.dy} tiles from the truck.`);
    console.error('  In GLASS 2 the board is drawn from the mesh at every distance, so what this leaves on the');
    console.error('  screen is a blank sign. See RENDER_TUNE.signFar, eyeRange and the signs-only run in detailLayer.');
    for (const r of live.lost.slice(0, 12)) console.error('   ✗ ' + r.key.padEnd(34) + r.near + ' → ' + r.far + ' → ' + r.free + ' free');
    if (live.lost.length > 12) console.error(`   … and ${live.lost.length - 12} more`);
    process.exit(1);
  }
  // ⚠ THE CONTROL. Zero losers is also what comes back when nothing in the registry signs itself at
  // all — a stub camera, a broken bake, a renamed key — and that run looks exactly like a pass.
  if (!live.withSigns) {
    console.error('signrange: not one model in the registry emitted any lettering, so this proves nothing.');
    process.exit(1);
  }
  if (!live.truckShed) {
    console.error(`signrange: from the cab, not one model shed lettering at ${-FREE.dy} tiles, so the free-camera`);
    console.error('  case proves nothing: the range is not gating where that case stands.');
    process.exit(1);
  }
  // ⚠ AND THE MUTATION, WHICH IS THE OTHER HALF OF THE SAME WORRY. The control says signs exist; it
  // does not say this file can SEE one going missing. `signFar: 0` is the renderer as it shipped
  // before the fix, so the sweep must fail with it — if it passes, the gate is measuring a distance
  // the shed never reached and would sit here green through the whole bug coming back.
  const save = ws.RENDER_TUNE.signFar;
  let mutated;
  try { ws.RENDER_TUNE.signFar = 0; mutated = sweep(); } finally { ws.RENDER_TUNE.signFar = save; }
  if (!mutated.lost.length) {
    console.error('signrange: with signFar 0 — the renderer as it shipped — not one model lost its lettering.');
    console.error('  That is the bug this gate exists for, so the gate is not looking where it thinks it is.');
    process.exit(1);
  }
  console.log(`signrange: ${live.withSigns} of ${live.models} models sign themselves, and none loses its lettering`
    + ` between ${-NEAR.dy} and ${-FAR.dy} tiles (signFar ${save}; ${mutated.lost.length} would without it),`
    + ` nor in front of a free camera ${-FREE.dy} tiles from the truck (${live.truckShed} shed there from the cab).`);
}
