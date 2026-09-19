// curtainend — does the Curtain END at something, and is that something on the depth buffer?
//
//   node scripts/shapes/curtainend.mjs
//   node scripts/shapes/curtainend.mjs --detail
//
// ⚠ THIS EXISTS BECAUSE A WALL THAT STOPS DEAD LOOKS EXACTLY LIKE A WALL WITH A HOLE IN IT. The
// Curtain has two free ends and both of them used to be a square cut in mid-air with a hot crown
// line across the top of nothing — reported from the game as the perimeter having no wall at its
// eastern end, which it does not. `drawCurtainAnchor` caps a free end with the South Gate's own
// emitter hardware at a third of the size, so the field visibly springs from a machine.
//
// Two claims, and each is silent in the direction it fails.
//
// 1. IT IS ALL ON THE DEPTH BUFFER. A Curtain tile carries no `bt`, so `modelFor` answers nothing
//    and it NEVER reaches the GL mass — which means a `draw3DBoxAt` here would paint on the 2-D
//    canvas after the city is composited, with nothing between it and a tower in front of it. That
//    is the bug the depot shed, the signal mast and the Echelon's fittings each shipped with. The
//    anchor is built out of strokes, flat world quads and sprites only, and `FACE_SINK` staying
//    empty is what says so.
//
// 2. THE YOKE REACHES ALONG THE ARM. The head is cantilevered inboard over the wall it feeds, and
//    the whole read — this is the source, that is the run — is carried by the direction it points.
//    Get the frame wrong and it points across the wall instead: still drawn, still lit, still
//    nothing in any log, and the picture is a machine facing out into open waste.
//
// ⚠ AND THE DISPATCH IS CHECKED TEXTUALLY, because the branch lives inside `drawWorldObjects` —
// eight thousand lines of DOM-heavy world pass there is no way to drive from here. Same shape as
// `curtain.mjs`'s own CFIT check, and comments are blanked first or the paragraph explaining the
// call satisfies the check on its own.
import { readFileSync } from 'node:fs';
import { loadWindshield } from './dom-stub.mjs';
import { blank } from '../lib/blank-scanner.mjs';

const DETAIL = process.argv.includes('--detail');
const ws = await loadWindshield();
const { curtainEndResidue, curtainSegs, makeCam, CURTAIN_H } = ws;

const fails = [];
const check = (name, ok, detail = '') => {
  if (!ok) fails.push(`${name}${detail ? ` — ${detail}` : ''}`);
  else if (DETAIL) console.log(`  ✓ ${name}${detail ? `  (${detail})` : ''}`);
};

// ⚠ A REAL CAMERA, NOT THE STUB. Every flat quad here reaches the decal layer through
// `cam.unproj`, which a stub camera has none of — under the stub the cowl falls back to the canvas
// and the census reports the exact residue this gate exists to forbid.
const cam = makeCam(640, 160, 360, { heading: 0, height: 0, eyeH: 0.24, map: null });

const ENDS = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };

for (const [cur, [ax, ay]] of Object.entries(ENDS)) {
  // ⚠ `noPull`, OR THIS MEASURES THE CAMERA. A decal's recovered corners have been slid toward the
  // eye by `DECO_PULL`, which is a depth-only tie-breaker rather than a position — read as one it
  // folds a fixed 0.05 tiles into every answer along the view axis, and the SAME anchor measured
  // 0.045 tiles of reach facing north against 0.145 facing south. The claim is about the geometry.
  const r = curtainEndResidue(cur, { cam, dx: 0, dy: -6, noPull: true });
  if (r.threw) { check(`end '${cur}' renders`, false, r.threw); continue; }

  // ── 1. NOTHING LEFT ON THE CANVAS, AND SOMETHING ON THE DEPTH BUFFER ──────
  //
  // Both halves, because they fail in opposite directions and only one of them is loud. An anchor
  // whose parts were all deleted also leaves FACE_SINK empty — the Echelon's own lesson — so the
  // counts have to grow as well as the residue staying at nothing.
  check(`end '${cur}' paints nothing on the canvas`, r.faces === 0,
    `${r.faces} face(s) queued — a Curtain tile is never in the GL mass, so these draw over the city`);
  check(`end '${cur}' reaches the stroke layer`, r.strokes > 0, `${r.strokes} strokes`);
  check(`end '${cur}' reaches the decal layer`, r.decals > 0, `${r.decals} decals`);
  check(`end '${cur}' reaches the sprite layer`, r.sprites > 0, `${r.sprites} sprites`);

  // ── 2. THE HEAD POINTS DOWN THE ARM IT FEEDS ──────────────────────────────
  //
  // The arm runs from the tile centre to the edge (see curtainSegs), so the yoke's reach has to be
  // positive along that direction and small across it. Measured on the DECALS, which are the cowl
  // and its two cheeks — the parts that are physically cantilevered.
  const pts = (r.sink.decals || []).flatMap((d) => d.p || []);
  check(`end '${cur}' has a cantilevered head`, pts.length >= 12, `${pts.length} decal corners`);
  if (pts.length) {
    let along = -Infinity, across = 0;
    for (const p of pts) {
      along = Math.max(along, (p[0] - 0) * ax + (p[1] - -6) * ay);
      across = Math.max(across, Math.abs((p[0] - 0) * -ay + (p[1] - -6) * ax));
    }
    check(`end '${cur}' reaches ALONG the arm`, along > 0.05,
      `furthest corner ${along.toFixed(3)} tiles down the arm`);
    check(`end '${cur}' is narrow ACROSS it`, across < along,
      `${across.toFixed(3)} across against ${along.toFixed(3)} along`);
    // It must stay on its own tile: an anchor overhanging the neighbour is a machine standing in
    // somebody else's road, and at a corner tile it would be standing in the wall.
    check(`end '${cur}' stays inside its own tile`, along <= 0.5 && across <= 0.5,
      `along ${along.toFixed(3)} · across ${across.toFixed(3)}`);
  }

  // The arm this end actually draws, from the one list the collision probes also read.
  const segs = curtainSegs(cur);
  check(`end '${cur}' caps a single arm`, segs.length === 1, `${segs.length} arms`);
}

// ── 3. NOTHING IS TALLER THAN THE WALL BY MUCH ───────────────────────────────
// The anchor is meant to cap the Curtain, not to become a tower beside it. Held loosely, because
// the point is that it reads as part of the wall rather than as a landmark next to one.
{
  const r = curtainEndResidue('s', { cam, dx: 0, dy: -6, noPull: true });
  const zs = (r.sink.decals || []).flatMap((d) => (d.p || []).map((p) => p[2]));
  const top = zs.length ? Math.max(...zs) : 0;
  check('the anchor caps the wall rather than towering over it', top > CURTAIN_H * 0.5 && top < CURTAIN_H * 1.5,
    `head at ${top.toFixed(3)} against a wall of ${CURTAIN_H}`);
}

// ── 4. AND THE WORLD PASS ONLY ASKS FOR IT AT A FREE END ─────────────────────
//
// `curtainRun` returns the directions that CARRY ON the wall, so a free end is a run of length 1
// and everything else — a straight span, a corner, the gate tile — is not. Without the test the
// anchor stands in the middle of every perimeter tile in the world.
{
  const src = blank(readFileSync(new URL('../../client/game/js/panels/windshield.js', import.meta.url), 'utf8'));
  const call = src.indexOf('drawCurtainAnchor(ctx, cam, it.dx, it.dy');
  check('the world pass draws an end anchor', call > 0,
    call > 0 ? '' : 'nothing calls drawCurtainAnchor, so the Curtain stops dead at both ends again');
  if (call > 0) {
    const before = src.slice(Math.max(0, call - 400), call);
    const gated = /\.cur\.length\s*===\s*1/.test(before);
    check('and only where the run has ONE arm', gated,
      gated ? '' : 'the length test is gone, so every Curtain tile in the world grows an emitter');
  }
}

if (fails.length) {
  console.error(`\n✗ curtainend — ${fails.length} failure${fails.length === 1 ? '' : 's'}:`);
  for (const f of fails) console.error(`    ${f}`);
  process.exit(1);
}
console.log('  curtainend: the Curtain ends at an emitter, on the depth buffer, pointing down its own arm');
