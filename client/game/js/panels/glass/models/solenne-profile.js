// THE SOLENNE'S OUTLINE, floor by floor: a slim stem on one tile, tapering and turning gently one way all the way
// up, then a crown that flares
// smoothly out of it, still turning, under a roof terrace with the helipad on it. The `solenne` arm (downtown.js) draws it.
//
// ⚠ THE ROOMS DON'T FIT THIS ANY MORE, ON PURPOSE. The tower went back to one tile on 2026-11-16 and the rooms
// stayed where scripts/content/solenne-rooms.mjs and solenne-upper.mjs put them on the 2 by 2 tower (the lift tops
// out at 40 and the penthouse is on 39 since 2026-11-24, when the arm's shaft came down a third to about 41 storeys).
// ⚠ This profile is no longer what the arm draws; the arm's own `topZ` is. David exempted the Solenne from "rooms fit the model". Don't re-run those
// scripts against this file: they would squeeze every flat into the slim stem.
//
// Sizes are tiles (TILE_M metres): a part is [z0, z1, S, th], a square of half `S` turned by `th` radians on the
// tile's centre. The arm draws each square as four quarters of half S/2, so a part may be wider than
// draw3DBoxAt's 0.44 clamp and the crown can stand out over the neighbouring tiles. A storey is the lift's 3.6 m
// (building-graph.js LIFT_STOREY), and floor n stands at (n - 1) storeys.
import { TILE_M } from '../../../../../shared/world-scale.js';

const M = 1 / TILE_M, ST = 3.6 * M;
export const SOLENNE_ST = ST;
const TOP = 28;   // the stem's last floor; the crown is the two storeys of flare and the bowl's two above it
// the usable half-width inside the glass, metres, at each knot floor; straight lines between them
const KNOTS = [[3, 7.4], [15, 6.9], [TOP, 6.3]];
export const WAIST = 19, TWIST = 0.70;   // the classic twist: 40 degrees, base to crown   // WAIST is the Aerie's floor, kept for its rooms
export function usableAt(f) {
  if (f <= KNOTS[0][0]) return KNOTS[0][1];
  for (let i = 1; i < KNOTS.length; i++) {
    const [f0, u0] = KNOTS[i - 1], [f1, u1] = KNOTS[i];
    if (f <= f1) return u0 + (u1 - u0) * (f - f0) / (f1 - f0);
  }
  return KNOTS[KNOTS.length - 1][1];
}
// the turn: none at the podium, easing in and out (smoothstep) to TWIST at the stem's top, always the same way
export const twistAt = (f) => { const t = Math.max(0, Math.min(1, (f - 3) / (TOP - 3))); return TWIST * t * t * (3 - 2 * t); };

export const POD = 0.44, zPod = 2 * ST, zStem0 = zPod + 0.025, zStem1 = TOP * ST;
// one segment a storey, floors 3 to TOP
export const STEM = Array.from({ length: TOP - 3 }, (_, i) => {
  const f = 3 + i, th = twistAt(f);
  return { f, z0: i ? (2 + i) * ST : zStem0, z1: (3 + i) * ST, S: usableAt(f) * M, th };
});
// the crown: six third-storey rings flaring smoothly (smoothstep) from the stem's top out to the bowl, still
// turning the same way, so the crown carries on the stem's twist; the bowl and the terrace stand at CROWN_TH.
// It's flush with the stem (the first ring starts at the stem's own width), and the rim stands only 0.03 tiles
// past the bowl, so the terrace is about 19 m across.
export const CROWN_TH = TWIST + 0.12;
export const BOWL = 0.50, RIM = 0.53;
const S0 = STEM[STEM.length - 1].S;
export const RINGS = Array.from({ length: 6 }, (_, j) => {
  const t = (j + 1) / 6, e = t * t * (3 - 2 * t);
  return { z0: zStem1 + j * ST / 3, z1: zStem1 + (j + 1) * ST / 3, S: S0 + (BOWL - S0) * e, th: TWIST + (CROWN_TH - TWIST) * t };
});
export const zBowl0 = zStem1 + 2 * ST, zBowl1 = zBowl0 + 2 * ST, zRim = zBowl1 + 0.04;

// every mass as [z0, z1, S, th], for a fit check
export const SOLENNE_PARTS = [[0, zPod, POD, 0], ...STEM.map((s) => [s.z0, s.z1, s.S, s.th]), ...RINGS.map((r) => [r.z0, r.z1, r.S, r.th]), [zBowl0, zBowl1, BOWL, CROWN_TH], [zBowl1, zRim, RIM, CROWN_TH]];
// the usable half-width, metres, of the plate between heights z0 and z1 (metres)
export function usableHalf(z0, z1) {
  const ps = SOLENNE_PARTS.filter((p) => p[1] * TILE_M > z0 + 1e-3 && p[0] * TILE_M < z1 - 1e-3);
  return ps.length ? Math.min(...ps.map(([, , S, th]) => S * TILE_M / (Math.cos(th) + Math.sin(th)))) : Infinity;
}
