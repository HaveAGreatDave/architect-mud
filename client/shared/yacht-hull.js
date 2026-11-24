// THE ECHELON'S HULL, AS NUMBERS: one table that GLASS draws her from (windshield.js drawYacht), the
// helicopter lands on (cockpit.js), and her rooms are fitted to (scripts/content/echelon-fit.mjs).
// Pure: no DOM, no imports but the ruler, so the server, the client and the gates all load it.
//
// Her local frame: `ox` across the beam (starboard +), `oy` fore and aft (bow -, stern +), `z` up from
// the waterline. A local unit is stretched three ways on the way to world tiles: oy by SCALE, ox by
// SCALE x SB, z by SCALE x H. The three are chosen so a metre is a metre: 55 m long, 11 m in the beam,
// 3 m from deck to deck. `metres()` turns a local point into metres off her origin.
import { TILE_M } from './world-scale.js';

// The whole frame's size. 0.4 made her 15 m long, too small for a helicopter on her pad (2026-11-22).
export const YACHT_SCALE = 1.5;
// Her height against her length. At SCALE 1.5 a tier of 0.046 local is 3.0 m with H 2.43.
export const YACHT_H = 2.43;
// Her beam against her length.
export const YACHT_SB = 1.72;

// Metres per local unit, each axis.
export const M_OY = YACHT_SCALE * TILE_M;
export const M_OX = YACHT_SCALE * YACHT_SB * TILE_M;
export const M_Z = YACHT_SCALE * YACHT_H * TILE_M;
export const metres = (ox, oy, z = 0) => [ox * M_OX, oy * M_OY, z * M_Z];
export const local = (mx, my, mz = 0) => [mx / M_OX, my / M_OY, mz / M_Z];

// The main deck and the helipad floor. Frozen: the pad, the deck-landing capture and every heli that
// ever landed on her key off it, so the ship grows upward from here.
export const YACHT_DECKZ = 0.085;
// The deckhouse in three set-back tiers: fore, aft, base half-width, top half-width (the glass leans
// in), z-bottom, z-top, and the half-width of the deck plate that is its roof.
export const YACHT_TIERS = [
  { fore: -0.44, aft: 0.16, hw: 0.098, hwT: 0.093, z0: YACHT_DECKZ, z1: 0.131, deck: 0.106 },   // main deck: foyer and saloon
  { fore: -0.36, aft: 0.13, hw: 0.088, hwT: 0.083, z0: 0.131, z1: 0.177, deck: 0.098 },         // owner's deck
  { fore: -0.27, aft: 0.08, hw: 0.070, hwT: 0.066, z0: 0.177, z1: 0.222, deck: 0.080 },         // bridge deck; its roof is the sun deck
];
export const YACHT_SUNZ = YACHT_TIERS[YACHT_TIERS.length - 1].z1;
// The windscreen rake: the top front of each tier sits this far aft of its base.
export const YACHT_RAKE = 0.05;
// Hull stations: [t along her length 0 bow..1 stern, half-beam, sheer z].
export const YACHT_ST = [
  [0.00, 0.000, 0.052], [0.05, 0.010, 0.059], [0.12, 0.030, 0.067], [0.22, 0.062, 0.074],
  [0.35, 0.096, 0.078], [0.50, 0.116, 0.081], [0.66, 0.120, 0.085], [0.80, 0.112, 0.089],
  [0.91, 0.098, 0.093], [1.00, 0.078, 0.096],
];
export const YACHT_BOW = -1.24, YACHT_LEN = 2.08;
// The helipad's middle, fore and aft, and its radius in local oy (a 9.6 m circle: a light helicopter's D-value).
// It sits clear of the deckhouse's aft lip at 0.178. Across the beam the radius is YACHT_PAD_RX, because ox is
// stretched by SB on the way to the world and a ring drawn with one radius came out an ellipse.
export const YACHT_PAD_OY = 0.37, YACHT_PAD_R = 4.8 / M_OY, YACHT_PAD_RX = 4.8 / M_OX;

// [half-beam, sheer] at fore-aft `oy`.
export function yachtHullAt(oy) {
  const t = Math.max(0, Math.min(1, (oy - YACHT_BOW) / YACHT_LEN)), ST = YACHT_ST, N = ST.length;
  let i = 0; while (i < N - 2 && ST[i + 1][0] < t) i++;
  const a = ST[i], b = ST[i + 1], u = b[0] > a[0] ? (t - a[0]) / (b[0] - a[0]) : 0;
  return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}
