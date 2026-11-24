// DEADBALL · THE GLOVE OPENS AND SHUTS. A fielder's glove is built once on his hand bone (gl/ballplayer-mesh.js
// glove), and its fingers, its web and the top of its pocket also lean on the fist bone, which a hand that isn't on
// a bat leaves unused. Here the fist bone's skin row is set to the hand's own row turned about the glove's hinge, the
// line across the stalls' roots, so the GPU bends the glove's top shut or springs it open with no new bone and no
// new attribute. How open it is comes off the clip: wide just before its catch, snapped shut on it, and easing back
// to a relaxed hold after.
//
// Pure: no DOM, no GL. scripts/shapes/glove-flex.mjs holds it.

import { BONE, FRAME_FLOATS } from './rig.js';

// The hinge, in feet up the hand bone from its origin (which sits 0.17 ft past the wrist, rig.js solvePose), times
// the man's scale. The stalls' roots are 0.3 ft from the wrist in glove().
export const GLOVE_HINGE = 0.13;
// How open a glove is held when nothing's coming: 0 is shut, 1 sprung wide.
export const GLOVE_REST = 0.4;
// The turn about the hinge, radians: positive closes the fingers toward the pocket.
const SHUT = 0.62, WIDE = -0.38;
export const gloveAngle = (open) => (open >= GLOVE_REST ? WIDE * (open - GLOVE_REST) / (1 - GLOVE_REST) : SHUT * (GLOVE_REST - open) / GLOVE_REST);

const smooth = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };

// How open the glove is at clip time t: GLOVE_REST unless the clip has a catch, and around one, wide from 0.45 s
// before it, shut 0.06 s after, and back to rest by 0.7 s after. Null for a clip with no catch (rest).
export function gloveOpenAt(clip, t) {
  const e = clip && (clip.events || []).find((x) => x.kind === 'catch');
  if (!e) return null;
  const d = t - e.t;
  if (d < 0) return GLOVE_REST + (1 - GLOVE_REST) * smooth(-0.45, -0.1, d);
  if (d < 0.06) return 1 - d / 0.06;
  return GLOVE_REST * smooth(0.18, 0.7, d);
}

// A glove vertex's weights, from where it sits along the hand (feet past the wrist over the scale): the heel and the
// strap ride the hand, the fingers' tips and the web's top the hinge. `most` caps the hinge's share (a catcher's
// pillow only curls at its rim).
export function gloveWeights(along, most = 1) {
  const w = most * smooth(0.26, 0.62, along);
  return w <= 1e-3 ? null : (S) => [[BONE['hand' + S], 1 - w], [BONE['fist' + S], w]];
}

// Sets the fist bone's skin row for a gloved hand from the hand's row (rig.js skinRows layout: three rows of four a
// bone) so it turns the glove's top about its hinge by gloveAngle(open). `bind` is the bind frames the body was built
// in (rig.js bindFrames), `scale` the man's.
export function flexGloveRows(rows, bind, S, open, scale = 1) {
  const h = BONE['hand' + S] * 12, f = BONE['fist' + S] * 12, b = BONE['hand' + S] * FRAME_FLOATS;
  const X = [bind[b], bind[b + 1], bind[b + 2]], Y = [bind[b + 3], bind[b + 4], bind[b + 5]];
  const pv = [0, 1, 2].map((i) => bind[b + 9 + i] + Y[i] * GLOVE_HINGE * scale);
  // the turn about X through pv, in the bind's world (Rodrigues)
  const a = gloveAngle(open), c = Math.cos(a), s = Math.sin(a), C = 1 - c, [x, y, z] = X;
  const Rc = [
    [c + x * x * C, x * y * C - z * s, x * z * C + y * s],
    [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
    [z * x * C - y * s, z * y * C + x * s, c + z * z * C],
  ];
  const tc = [0, 1, 2].map((i) => pv[i] - (Rc[i][0] * pv[0] + Rc[i][1] * pv[1] + Rc[i][2] * pv[2]));
  for (let i = 0; i < 3; i++) {
    const r = [rows[h + i * 4], rows[h + i * 4 + 1], rows[h + i * 4 + 2]];
    for (let k = 0; k < 3; k++) rows[f + i * 4 + k] = r[0] * Rc[0][k] + r[1] * Rc[1][k] + r[2] * Rc[2][k];
    rows[f + i * 4 + 3] = r[0] * tc[0] + r[1] * tc[1] + r[2] * tc[2] + rows[h + i * 4 + 3];
  }
  return rows;
}
