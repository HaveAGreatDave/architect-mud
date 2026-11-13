// THE DOORWAY OF A BUILDING, READ OFF ITS OWN MASS.
//
// A Stage building's street door (plugins/roomstage streetDoorsNear: its tile, the edge it's on and its width) is
// drawn and walked where its model actually left an opening: the front wall, the gap between the jambs and the
// lintel. Everything here is in the model's own frame, y out of the front and x along it, in tiles.
//
// ⚠ NO IMPORTS. The street view on foot loads the renderer lazily (windshield-lazy.js), so the obstruction test is
// handed in: windshield.js `groundObstructionAt`, or the lazy wrapper of it.
//
// `obstruct(gx, gy, cell, px, py, z, step)` > 0 where there's mass. `E` is the facade's outward edge vector, `w` the
// door's width in metres, `metre` a metre in tiles. Returns { E, at, wall, plane, half, top, leaves }:
//   wall   the plane the doorway is cut in (the back of its reveal)
//   plane  just proud of the jambs' front, where the leaves stand
//   half   half the opening's width, top the underside of its lintel
//   leaves false when no wall was found, and the door is drawn nowhere
// a threshold or a step up to the door is not its wall: anything lower than this (windshield.js TRUCK_STEP_Z, a kerb)
// is stood on, not measured
const STEP = 0.011;
export function measureDoorway(gx, gy, c, E, w, obstruct, metre) {
  const at = (lx, ly) => [gx + lx * E[1] + ly * E[0], gy - lx * E[0] + ly * E[1]];
  const hit = (lx, ly, z) => { const [px, py] = at(lx, ly); return obstruct(gx, gy, c, px, py, z, STEP) > 0; };
  const wide = Math.max(0.05, (w || 2) * metre / 2);
  let wall = null;
  for (let ly = 0.5; ly >= 0.2 && wall == null; ly -= 0.005) if (hit(0, ly, 0.02)) wall = ly;
  if (wall == null) return { E, at, wall: 0.44, plane: 0, half: wide, top: 0, leaves: false };
  // and to the face itself: the step left it up to 5 mm short, behind what the model drew in the doorway
  for (let lo = wall, hi = Math.min(0.5, wall + 0.005), i = 0; i < 8; i++) { const mid = (lo + hi) / 2; if (hit(0, mid, 0.02)) lo = wall = mid; else hi = mid; }
  let half = null, top = null;
  for (let lx = 0.01; lx <= 0.4 && half == null; lx += 0.004) if (hit(lx, wall + 0.02, 0.02) || hit(-lx, wall + 0.02, 0.02)) half = lx;
  // (a tower's doorway is drawn to the tower's scale, far over a person's head, so the lintel is looked for high)
  for (let z = 0.03; z <= 3 && top == null; z += 0.01) if (hit(0, wall + 0.02, z)) top = z;
  // the leaves stand a hair proud of the jambs' own front, so whatever the arm drew in the doorway is behind them
  let front = wall;
  if (half != null) for (let ly = 0.5; ly > wall; ly -= 0.004) if (hit(half + 0.012, ly, 0.02) || hit(-half - 0.012, ly, 0.02)) { front = ly; break; }
  return { E, at, wall, plane: Math.min(0.498, front + 0.01), half: half ?? Math.min(0.2, wide * 2), top: top ?? 0.13, leaves: true };
}
