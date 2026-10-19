// The Palais Bowl: the open-air theatre on the three tiles of Fisherman's Green behind the Coldwater
// Palais (908 to 910, 910). One bowl over three building types, `palais_bowl_w`, `palais_bowl` and
// `palais_bowl_e`, the way the Palais itself is one building over three.
//
// Every arm takes drawTypeModelArm's arguments and its prologue locals, in this order:
//   (ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis)
// The content is written by scripts/content/palais-bowl.mjs, and the place is in
// docs/proposals/coldwater-palais.md §7.
//
// Stone tiers in a shallow half-ellipse, stepping up away from a low stage set against the Palais's
// back wall, under a stone canopy on two piers. Two aisles cut the tiers. A paved floor in front of
// the stage. After dark a row of bulbs along the canopy's lip and a wash of light on the stage.
//
// ⚠ THE TILES ARE WALKABLE. They keep their exits and carry no `is_building`, so a player stands in
//    the bowl; the type only gives GLASS something to draw. Everything is under knee height except
//    the canopy, so `modelTopAt` lets a truck over the tiers and a plane hits only the canopy.
// ⚠ THE WHOLE BOWL IS IN CONSTANTS (`BOWL`), NEVER `fh` OR `h`, for the Palais's reason: both are
//    rolled per tile, and three tiles sized off their own rolls are three bowls that don't meet.
// ⚠ `X` IS THE BOWL'S OWN AXIS, the same as the Palais's: 0 is the middle of the centre tile and +X
//    is local +x, which on these north-facing tiles is west. A tile's centre is at X = off (1 west,
//    0 centre, −1 east). Local +y is north, toward the Palais, so the stage is at the tile's +y edge.
// ⚠ A CHORD IS DRAWN BY THE TILE THAT HOLDS ITS MIDDLE, so the tiers meet across the joints without
//    being drawn twice. The chords are short, so the overhang onto the next tile is a few hundredths.
import { clamp, draw3DBoxAt, emitWire, glowPool, nearOrMesh, rgb } from '../../windshield.js';
import { flatOut } from './downtown.js';

const BOWL = {
  fy: 0.40,                       // the focus, on the centre line just in front of the stage
  A: 1.42, B: 0.88,               // the outer tier's semi-axes, across and deep: it just clears the plot
  tiers: [0.40, 0.52, 0.64, 0.76, 0.88, 1.0],   // each tier's scale of the outer ellipse
  rise: 0.013,                    // each tier steps up this much
  tread: 0.045,                   // a tier's half-depth
  chord: 0.085,                   // the longest a tier's chord box gets
  aisles: [Math.PI / 3, 2 * Math.PI / 3],   // two aisles, at a third and two thirds of the way round
  aisleW: 0.09,                   // an aisle's half-width, in radians
  // the stage, its canopy and the two piers that carry it
  sHW: 0.27, sY0: 0.29, sY1: 0.49, sTop: 0.04,
  cHW: 0.31, cY0: 0.27, cY1: 0.49, cZ0: 0.19, cZ1: 0.215,
  pierX: 0.285, pierHW: 0.018,
};
const STONE = 'ty_palais_stone', TRIM = 'ty_archive_col';
const BULB = '255,224,176';

// Is a point at angle `a` round the bowl in an aisle?
const inAisle = (a) => BOWL.aisles.some((c) => Math.abs(a - c) < BOWL.aisleW);

function palaisBowl(ctx, cam, F, W3, E, seed, night, alpha, off) {
  const dn = night ? clamp(+night, 0, 1) : 0;
  const lo = off - 0.5, hi = off + 0.5;   // this tile's span on X
  const B = (X, y, hw, fd, z0, z1, p, s, yaw) => {
    const [bx, by] = F(X - off, y);
    draw3DBoxAt(ctx, cam, bx, by, hw, z0, z1, p, seed + s, night, alpha, true, yaw, fd);
  };
  // The world bearing of a direction in the bowl's own frame, for a box laid along it.
  const O = W3(0, 0, 0);
  const bearing = (ux, uy) => { const D = W3(ux, uy, 0); return Math.atan2(D[1] - O[1], D[0] - O[0]); };

  // 1) THE TIERS: chord boxes round each half-ellipse, stepping up with every tier, with the aisles
  //    left open. Each tier is drawn from angle 0 (west) to π (east) round the south side.
  BOWL.tiers.forEach((t, i) => {
    const a = BOWL.A * t, b = BOWL.B * t, z1 = BOWL.rise * (i + 1);
    const len = Math.PI * Math.sqrt((a * a + b * b) / 2);
    const n = Math.ceil(len / BOWL.chord);
    for (let j = 0; j < n; j++) {
      const a0 = j / n * Math.PI, a1 = (j + 1) / n * Math.PI, am = (a0 + a1) / 2;
      if (inAisle(am)) continue;
      const p0 = [a * Math.cos(a0), BOWL.fy - b * Math.sin(a0)], p1 = [a * Math.cos(a1), BOWL.fy - b * Math.sin(a1)];
      const X = (p0[0] + p1[0]) / 2, y = (p0[1] + p1[1]) / 2;
      if (X < lo || X >= hi) continue;
      const hw = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / 2 + 0.004;
      B(X, y, hw, BOWL.tread, 0, z1, STONE, 10 + i * 97 + j, bearing(p1[0] - p0[0], p1[1] - p0[1]));
    }
  });

  if (off !== 0) return;

  // 2) THE FLOOR in front of the stage: a paved half-ellipse inside the first tier. It's always
  //    emitted, and only its colour follows the hour, so the night mesh pairs with the day's.
  {
    const a = BOWL.A * BOWL.tiers[0] - BOWL.tread, b = BOWL.B * BOWL.tiers[0] - BOWL.tread, N = 12, pts = [[0, BOWL.fy, 0.002]];
    for (let k = 0; k <= N; k++) {
      const ang = k / N * Math.PI;
      pts.push([Math.max(-0.49, Math.min(0.49, a * Math.cos(ang))), Math.min(BOWL.sY0, BOWL.fy - b * Math.sin(ang)), 0.002]);
    }
    const c = [150, 142, 126].map((v) => v * (1 - 0.55 * dn));
    flatOut(ctx, cam, W3, pts, [0, 0, 1], rgb(c), alpha);
  }

  // 3) THE STAGE: a low stone platform against the Palais's back wall, with a lip of darker stone.
  {
    const cy = (BOWL.sY0 + BOWL.sY1) / 2, fd = (BOWL.sY1 - BOWL.sY0) / 2;
    B(0, cy, BOWL.sHW, fd, 0, BOWL.sTop, STONE, 1, bearing(1, 0));
    B(0, BOWL.sY0 + 0.01, BOWL.sHW + 0.006, 0.012, 0, BOWL.sTop + 0.004, TRIM, 2, bearing(1, 0));
  }

  // 4) THE CANOPY on two piers, and the piers. It shades the stage and carries the lights.
  for (const s of [-1, 1]) B(s * BOWL.pierX, BOWL.sY0 + 0.02, BOWL.pierHW, BOWL.pierHW, 0, BOWL.cZ0, TRIM, 3 + s);
  {
    const cy = (BOWL.cY0 + BOWL.cY1) / 2, fd = (BOWL.cY1 - BOWL.cY0) / 2;
    B(0, cy, BOWL.cHW, fd, BOWL.cZ0, BOWL.cZ1, STONE, 6, bearing(1, 0));
  }

  // 5) AFTER DARK: a row of bulbs along the canopy's lip, and light on the stage.
  if (dn > 0.3 && nearOrMesh()) {
    const z = BOWL.cZ0 - 0.004, y = BOWL.cY0 - 0.004, N = 9;
    for (let k = 0; k < N; k++) {
      const x0 = -BOWL.cHW + (k / N) * BOWL.cHW * 2, x1 = -BOWL.cHW + ((k + 1) / N) * BOWL.cHW * 2;
      emitWire(ctx, cam, W3(x0, y, z), W3(x1, y, z), 2.2, `rgba(${BULB},0.95)`, alpha, { pull: 0.01 });
    }
  }
  if (dn > 0.3) {
    const [sx, sy] = F(0, (BOWL.sY0 + BOWL.sY1) / 2);
    glowPool(ctx, cam, sx, sy, BOWL.cZ0 - 0.02, BULB, 14, alpha * 0.45 * dn);
  }
}

export const PALAIS_BOWL_ARMS = {
  palais_bowl_w(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE PALAIS BOWL, the west third of the tiers
    palaisBowl(ctx, cam, F, W3, E, seed, night, alpha, 1);
  },
  palais_bowl(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE PALAIS BOWL, the middle: the stage, its canopy and the floor
    palaisBowl(ctx, cam, F, W3, E, seed, night, alpha, 0);
  },
  palais_bowl_e(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE PALAIS BOWL, the east third of the tiers
    palaisBowl(ctx, cam, F, W3, E, seed, night, alpha, -1);
  },
};
