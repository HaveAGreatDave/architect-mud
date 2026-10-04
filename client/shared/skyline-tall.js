// Which buildings stand above the skyline, and how far away each one stays visible.
//
// Shared by the flight plugin (which sends the tall towers that sit outside the map window) and
// the windshield (which keeps them drawn past the ordinary draw limit). Both sides must agree, or a
// tower is sent but faded at 34 tiles, or kept solid in the window and then dropped at its edge.
//
// Height comes from the baked shapes, not the floor count: the Solenne is an 8-storey `apartment`
// whose model rises to about 27 storeys, and the Spire's mast is most of its height.

import { shapeFor, shapeVal } from './building-shapes.js';
import { floorsFor, FLOOR_Z, BUILDING_FOOT } from './skyline-scale.js';

// Storeys of drawn height a building needs to count as part of the skyline.
export const SKYLINE_MIN_STOREYS = 14;
// The ordinary draw limit the windshield fades everything at (VISIBLE_FAR_F), and the furthest any
// tower is kept. A tower's own reach grows with its height between the two.
export const SKYLINE_BASE_FAR = 34;
export const SKYLINE_MAX_FAR = 110;
const REACH_PER_STOREY = 2.5;

const _memo = new Map();
// Drawn height in storeys, from the building's baked shape when it has one.
export function drawnStoreys(bt, bn, flr) {
  const key = bt + '|' + (bn || '') + '|' + (flr || 0);
  let s = _memo.get(key);
  if (s != null) return s;
  const floors = floorsFor(bt, flr), h = floors * FLOOR_Z;
  const shape = shapeFor(bn, bt);
  let top = h;
  if (shape) for (const g of shape) top = Math.max(top, shapeVal(g.z1, BUILDING_FOOT, h));
  s = top / FLOOR_Z;
  _memo.set(key, s);
  return s;
}

// How far (tiles) this building stays drawn, or 0 if it isn't tall enough to be skyline.
export function skylineFar(bt, bn, flr) {
  if (!bt) return 0;
  const s = drawnStoreys(bt, bn, flr);
  if (s < SKYLINE_MIN_STOREYS) return 0;
  return Math.min(SKYLINE_MAX_FAR, SKYLINE_BASE_FAR + REACH_PER_STOREY * s);
}
