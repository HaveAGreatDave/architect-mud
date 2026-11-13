// GLASS 2 · A CHESS SET ON A ROOM'S TABLE. The position the server sends on a `games` table's piece
// (`p.board`, plugins/gametable `room.boards`) laid out in Staunton pieces on an ebony and holly
// board. Pure: batches, no GL. It decides nothing; the board string is the game.
//
// The pieces are turned, as real ones are: each is a profile (radius, height) spun on a lathe, in
// units of the square. The proportions are a tournament set's: the king about 1.7 squares tall
// with a base three quarters of a square across, the pawn a little over half the king. The knight
// isn't turned: its head is a side profile cut out and given thickness, on a turned base.
//
// The board's frame is the piece's: x across, z out of its front, y up. White sits at the front, so
// rank 1 is nearest +z and the a-file is on White's left, which in this frame is +x. A light square is on each player's right.

import { MAT } from './ballpark-mesh.js';

const { GLOSS, SATIN, METAL } = MAT;
const BOX = '#e6cf9f', EBONY = '#1d1713';

// [radius, height] in squares, from the foot up
const BASE = (r) => [[0, 0], [r, 0], [r, 0.05], [r * 0.93, 0.08], [r * 0.95, 0.11], [r * 0.82, 0.15], [r * 0.62, 0.2]];
const PROFILE = {
  p: [...BASE(0.3), [0.15, 0.3], [0.11, 0.5], [0.19, 0.53], [0.19, 0.56], [0.1, 0.59]],
  r: [...BASE(0.34), [0.24, 0.26], [0.2, 0.68], [0.27, 0.72], [0.27, 0.86], [0.21, 0.86], [0.21, 0.8], [0, 0.8]],
  b: [...BASE(0.33), [0.17, 0.3], [0.1, 0.62], [0.2, 0.65], [0.2, 0.69], [0.12, 0.72], [0.17, 0.82], [0.17, 0.92], [0.12, 1.02], [0.05, 1.08], [0, 1.09]],
  q: [...BASE(0.38), [0.2, 0.3], [0.12, 0.9], [0.22, 0.94], [0.22, 0.98], [0.14, 1.02], [0.17, 1.12], [0.25, 1.28], [0.21, 1.3], [0.14, 1.3], [0, 1.27]],
  k: [...BASE(0.38), [0.2, 0.3], [0.13, 0.96], [0.23, 1.0], [0.23, 1.04], [0.15, 1.08], [0.19, 1.2], [0.24, 1.33], [0.1, 1.38], [0, 1.39]],
  n: [...BASE(0.34), [0.26, 0.26], [0.25, 0.3], [0, 0.3]],
};
// the knight's head from the side, facing +s: the underside and the top at each step forward
const KNIGHT = [[-0.24, 0.3, 0.78], [-0.2, 0.3, 0.98], [-0.1, 0.3, 1.1], [-0.04, 0.32, 1.14], [0.04, 0.4, 1.06], [0.14, 0.52, 0.98], [0.24, 0.58, 0.88], [0.31, 0.6, 0.78], [0.33, 0.64, 0.7]];

// Draws the set and the board's squares on a table top at height `top`, the board `side` metres across.
export function drawChessBoard(K, F, top, side, state) {
  const { P, pbox, N } = F, sq = side / 8, b0 = -side / 2;
  const board = String(state?.board || '');
  pbox(b0 - 0.02, -b0 + 0.02, top, top + 0.003, b0 - 0.02, -b0 + 0.02, '#c9a24a', 1.05, null, METAL);
  for (let f = 0; f < 8; f++) for (let R = 0; R < 8; R++) {
    const x0 = -b0 - (f + 1) * sq, z1 = -b0 - R * sq;
    // a1 (f 0, R 0) is dark
    pbox(x0, x0 + sq, top + 0.003, top + 0.005, z1 - sq, z1, (f + R) % 2 ? '#eadfc6' : '#1a1512', 1, null, GLOSS);
  }
  if (board.length !== 64) return;
  const y0 = top + 0.005;
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const c = board[r * 8 + f];
    if (c === '.' || !c) continue;
    const R = 7 - r, x = -b0 - (f + 0.5) * sq, z = -b0 - (R + 0.5) * sq;
    const white = c === c.toUpperCase(), t = c.toLowerCase(), hex = white ? BOX : EBONY;
    const prof = PROFILE[t];
    if (!prof) continue;
    const [u, v] = P(x, 0, z);
    K.lathe(u, v, prof.map(([pr, ph]) => [pr * sq, y0 + ph * sq]), hex, 1, t === 'p' ? 12 : 16, white ? SATIN : GLOSS);
    if (t === 'q') {
      // the coronet's points, and the ball on top
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; const [cu, cv] = P(x + Math.cos(a) * 0.2 * sq, 0, z + Math.sin(a) * 0.2 * sq); K.ball(cu, cv, y0 + 1.31 * sq, 0.035 * sq, hex, 1, 6); }
      K.ball(u, v, y0 + 1.36 * sq, 0.075 * sq, hex, 1, 10);
    } else if (t === 'k') {
      // the cross, square to the board
      const w = 0.045 * sq;
      pbox(x - w, x + w, y0 + 1.38 * sq, y0 + 1.7 * sq, z - w, z + w, hex);
      pbox(x - 0.13 * sq, x + 0.13 * sq, y0 + 1.53 * sq, y0 + 1.6 * sq, z - w, z + w, hex);
    } else if (t === 'b') {
      K.ball(u, v, y0 + 1.12 * sq, 0.045 * sq, hex, 1, 8);
      // the cut in the mitre, on the side away from its own player
      const s = white ? -1 : 1;
      pbox(x - 0.1 * sq, x + 0.1 * sq, y0 + 0.86 * sq, y0 + 0.88 * sq, z + s * 0.12 * sq, z + s * 0.175 * sq, white ? '#3a2c1e' : '#6a5a48');
    } else if (t === 'r') {
      // the battlements: six merlons round the rim
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2, mx = x + Math.cos(a) * 0.235 * sq, mz = z + Math.sin(a) * 0.235 * sq, m = 0.05 * sq;
        pbox(mx - m, mx + m, y0 + 0.86 * sq, y0 + 0.95 * sq, mz - m, mz + m, hex);
      }
    } else if (t === 'n') {
      knightHead(K, F, x, z, y0, sq, white ? -1 : 1, hex);
    }
  }
}

// The head, facing along z by `dir` (White's look up the board, toward -z).
function knightHead(K, F, x, z, y0, sq, dir, hex) {
  const white = hex === BOX;
  const { P, N } = F, col = K.C(hex, 1), solid = K.solid;
  const thick = (s) => (0.15 - Math.max(0, s) * 0.12) * sq;
  const pt = (s, y, side) => P(x + side * thick(s), y0 + y * sq, z + dir * s * sq);
  for (let i = 0; i + 1 < KNIGHT.length; i++) {
    const [s0, lo0, hi0] = KNIGHT[i], [s1, lo1, hi1] = KNIGHT[i + 1];
    for (const side of [-1, 1]) {
      const q = [pt(s0, lo0, side), pt(s1, lo1, side), pt(s1, hi1, side), pt(s0, hi0, side)];
      K.quad(solid, side > 0 ? q : [q[1], q[0], q[3], q[2]], N(side, 0, 0), col, white ? SATIN : GLOSS);
    }
    // the top edge and the underside
    const tn = N(0, s1 - s0, -dir * (hi1 - hi0)), bn = N(0, -(s1 - s0), dir * (lo1 - lo0));
    K.quad(solid, [pt(s0, hi0, -1), pt(s0, hi0, 1), pt(s1, hi1, 1), pt(s1, hi1, -1)], tn, K.C(hex, 1.04), white ? SATIN : GLOSS);
    K.quad(solid, [pt(s0, lo0, 1), pt(s0, lo0, -1), pt(s1, lo1, -1), pt(s1, lo1, 1)], bn, K.C(hex, 0.86), white ? SATIN : GLOSS);
  }
  // the back of the mane and the end of the muzzle
  const [sa, la, ha] = KNIGHT[0], [sb, lb, hb] = KNIGHT[KNIGHT.length - 1];
  K.quad(solid, [pt(sa, la, 1), pt(sa, la, -1), pt(sa, ha, -1), pt(sa, ha, 1)], N(0, 0, -dir), K.C(hex, 0.92), white ? SATIN : GLOSS);
  K.quad(solid, [pt(sb, lb, -1), pt(sb, lb, 1), pt(sb, hb, 1), pt(sb, hb, -1)], N(0, 0, dir), K.C(hex, 0.92), white ? SATIN : GLOSS);
  // ears, and an eye on each side
  const e = 0.035 * sq;
  for (const side of [-1, 1]) {
    const ex = x + side * 0.07 * sq;
    F.pbox(ex - e, ex + e, y0 + 1.1 * sq, y0 + 1.22 * sq, z + dir * -0.06 * sq - e, z + dir * -0.06 * sq + e, hex);
    const [eu, ev] = P(x + side * (thick(0.14) + 0.002), 0, z + dir * 0.14 * sq);
    K.ball(eu, ev, y0 + 0.86 * sq, 0.022 * sq, hex === BOX ? '#3a2c1e' : '#7a6a58', 1, 6);
  }
}
