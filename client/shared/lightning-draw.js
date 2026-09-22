// LIGHTNING, ON A CANVAS — the one painter for the tree client/shared/lightning.js grows.
//
// Geometry lives next door and knows about no surface at all; this knows about a 2-D context and
// nothing about where the bolt IS. A caller hands over a `project` that turns a channel node into a
// screen point, and gets the same three-pass channel whether it is projecting through the world
// camera out of a cockpit, mapping flat across a windscreen, or fitting a strike into a hangar
// doorway. Three seats, one bolt.
//
// ⚠ IT IS A SEPARATE FILE FROM THE GEOMETRY BECAUSE THE GEOMETRY HAS A HEADLESS GATE. `growBolt` is
// pure arithmetic and is driven under node with no DOM at all; the moment a `ctx` is imported into
// that file the gate needs a canvas stub to answer a question about branch angles.

import { BOLT_GEN } from './lightning.js';

// ── WHY THREE PASSES ────────────────────────────────────────────────────────────────────────
//
// Lightning is not a white line. It is a white line you cannot look straight at, and what says so
// is COLOUR SEPARATING WITH RADIUS: a broad blue halo, a paler sheath inside it, and a core that is
// very nearly paper white. Drawn as one stroke at one width it is a crack in the glass, at any
// alpha and in any colour — which is what this renderer drew for years.
//
// The halo is the trunk's alone and the sheath reaches one generation out. Past that a branch is a
// hairline and a halo round it is a smudge: the thing that separates the far generations is their
// ALPHA, not their width.
const BLOOM = '74,116,232';
const HALO = '104,152,255';
const SHEATH = '172,204,255';
const CORE = '247,251,255';

// ⚠ THE CORE'S WIDTH IS FLOORED AND ITS ALPHA IS NOT. A fourth-generation tendril is a ninth of the
// trunk's width, which at any sane trunk width is a fraction of a pixel — drawn honestly it
// antialiases away and the outer half of the tree is simply not there. The floor keeps it a
// hairline and the per-generation alpha carries the taper, which is the same bargain the street
// lamp's halo strikes one system over.
const CORE_MIN = 0.9;

// Paint one bolt.
//
//   project — (node) => [sx, sy] or null. NULL MEANS CULLED, and the painter breaks the polyline
//             there rather than skipping the point: a world camera clamps anything behind the eye
//             to a wild lateral position, and one line drawn through it whips across the frame.
//   ch/br   — channel and branch brightness, from boltBright(). They are separate because a LATER
//             return stroke runs up the established channel and barely touches the side branches —
//             see BOLT_BRANCH_RESTRIKE — which is most of what makes a bolt read as flickering
//             rather than as blinking.
//   w       — a width scale in the caller's units (a world reader shrinks it with distance).
//   trunkStyle — (head, foot) => strokeStyle for the trunk's core. The return stroke travels UP
//             from the ground, so the bottom of a channel is the brightest part of it and every
//             photograph of a ground strike shows that; a caller that can build a gradient says so
//             here, and one that cannot passes nothing and gets a flat core.
//
// Returns { head, foot, grounded } — the trunk's first and last DRAWN points, and whether its last
// node actually reached f = 0. The caller owns its own flares, because how big a glow at the cloud
// base should be is a question in the caller's units and not in these.
// ⚠ `dry` MEASURES WITHOUT PAINTING, and it is here rather than in a second function because the
// two would then have to agree about which node the trunk starts and ends on. A caller that lights
// the scene around a strike needs the channel's endpoints BEFORE it can draw anything, and has to
// draw the channel itself last — the bolt is the source and has to be the brightest thing in its
// own picture. One projection, called twice.
export function paintBolt(ctx, bolt, project, { ch = 1, br = ch, w = 1, trunkStyle = null, dry = false } = {}) {
  const out = { head: null, foot: null, grounded: false };
  if (!bolt || !bolt.branches || !bolt.branches.length) return out;

  const runsOf = (pts) => {
    const runs = [];
    let run = null;
    for (const p of pts) {
      const q = project(p);
      if (!q) { run = null; continue; }
      if (!run) { run = []; runs.push(run); }
      run.push(q);
    }
    return runs;
  };

  // The trunk goes first because its endpoints are what a gradient is built from, and because a
  // caller wants them back whether or not it asked for one.
  const trunkPts = bolt.branches[0].pts;
  const trunkRuns = runsOf(trunkPts);
  for (const r of trunkRuns) {
    if (r.length < 2) continue;
    if (!out.head) out.head = r[0];
    out.foot = r[r.length - 1];
  }
  out.grounded = trunkPts[trunkPts.length - 1].f <= 0.001;

  if (dry) return out;

  let grad = null;
  if (trunkStyle && out.head && out.foot
      && (out.head[0] !== out.foot[0] || out.head[1] !== out.foot[1])) {
    grad = trunkStyle(out.head, out.foot);
  }

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // ⚠ PINNED. The world pass sets a per-tile alpha for the far fade and a caller that forgot to
  // restore it would dim the one thing in the frame that is supposed to be the brightest.
  ctx.globalAlpha = 1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const stroke = (run) => {
    ctx.beginPath();
    ctx.moveTo(run[0][0], run[0][1]);
    for (let i = 1; i < run.length; i++) ctx.lineTo(run[i][0], run[i][1]);
    ctx.stroke();
  };

  const branch = (gen, runs) => {
    const G = BOLT_GEN[gen] || BOLT_GEN[BOLT_GEN.length - 1];
    const a = G.a * (gen ? br : ch);
    if (a <= 0.02) return;
    const bw = G.w * w;
    for (const run of runs) {
      if (run.length < 2) continue;
      // ⚠ THE WIDTHS NEED TO SEPARATE, NOT JUST DIFFER. A first cut had the core at 2.2x and the
      // sheath at 4.4x, a ratio of two — which on a jagged path with round joins is one fat soft
      // worm, and the more bloom that went round it the softer it got. What reads as lightning is a
      // HARD THIN LINE with light falling away from it over a long way, so the ladder is roughly
      // 1 : 4 : 12 : 30 and the alphas fall as fast as the widths rise.
      if (gen === 0) {
        ctx.strokeStyle = `rgba(${BLOOM},${0.055 * a})`;
        ctx.lineWidth = Math.max(10, bw * 30);
        stroke(run);
        ctx.strokeStyle = `rgba(${HALO},${0.16 * a})`;
        ctx.lineWidth = Math.max(4, bw * 11);
        stroke(run);
      }
      if (gen <= 2) {
        ctx.strokeStyle = `rgba(${gen ? HALO : SHEATH},${(gen === 0 ? 0.40 : gen === 1 ? 0.30 : 0.18) * a})`;
        ctx.lineWidth = Math.max(1.3, bw * (gen === 2 ? 5.5 : 3.6));
        stroke(run);
      }
      ctx.strokeStyle = gen === 0 && grad ? grad : `rgba(${CORE},${Math.min(1, 0.95 * a)})`;
      ctx.lineWidth = Math.max(CORE_MIN, bw * 1.3);
      stroke(run);
    }
  };

  branch(0, trunkRuns);
  for (let i = 1; i < bolt.branches.length; i++) {
    const b = bolt.branches[i];
    branch(b.gen, runsOf(b.pts));
  }
  ctx.restore();
  return out;
}
