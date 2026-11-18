// THE DOORWAY OF A BUILDING, READ OFF ITS OWN MODEL.
//
// A Stage building's street door (plugins/roomstage streetDoorsNear: its tile, the edge it's on and its width) is
// drawn and walked where its model actually left an opening. Everything here is in the model's own frame, y out of
// the front and x along it, in tiles.
//
// ⚠ THE MODEL'S OWN DOORWAY FIRST, THEN ITS MASS, THEN THE ROOM'S WIDTH. Most doorways are flat detail (a `windowBay`
// door, `drawEntrance`, a hand-drawn portal) that the mass can't see, so a door fitted to the mass alone came out a
// different size from the one the model drew, off its centre, and the model's still door showed round the moving
// one. Those doorways record themselves (windshield.js markDoorway) and `bay` is that record: where it is, how wide
// and how high, threshold to head, and the plane it's cut in. With no record the jambs and lintel are measured in
// the mass, and they're believed only when they agree with the room's own door width.
//
// ⚠ NO IMPORTS. The street view on foot loads the renderer lazily (windshield-lazy.js), so the obstruction test and
// the record are handed in: windshield.js `groundObstructionAt` and `doorBayAt`, or their lazy wrappers.
//
// `obstruct(gx, gy, cell, px, py, z, step)` > 0 where there's mass. `E` is the facade's outward edge vector, `w` the
// door's width in metres, `metre` a metre in tiles. Returns { E, at, wall, plane, back, half, sill, top, leaves, cx }:
//   wall   the plane the doorway is cut in (the back of its reveal)
//   plane  where the leaves stand: proud of everything the model drew in the doorway
//   back   where whatever fills the opening behind the leaves stands (the lobby through the portal, or the dark)
//   half   half the opening's width, sill its threshold and top the underside of its head
//   cx     the opening's middle along the front
//   leaves false when no wall was found, and the door is drawn nowhere
//   fit    'model' (its own record), 'mass' (jambs and lintel) or 'room' (the room's width and a standard head)

// a threshold or a step up to the door is not its wall: anything lower than this (windshield.js TRUCK_STEP_Z, a kerb)
// is stood on, not measured
const STEP = 0.011;
// A recorded doorway's model draws its own glazing and leaves up to 0.018 off the wall (windowBay, drawEntrance), so
// the moving leaves stand a little past that and what fills the opening a hair behind them, both in front of it.
const BAY_PLANE = 0.022, BAY_BACK = 0.02;
// a measured jamb is believed when the gap is this close to the room's own door width; a lintel when it's a door's
// height (metres), not a canopy's or a parapet's
const JAMB_FIT = [0.6, 1.6], HEAD_M = [1.9, 7], HEAD_DEFAULT_M = 2.4;
// `cx` (tiles, along the front) is where the door stands when it isn't at the tile's middle (flags.room.street_door.cx),
// and with a `bay` which of the model's doorways it is. `headM` is the head in metres for a door with nothing to read.
export function measureDoorway(gx, gy, c, E, w, obstruct, metre, cx = 0, bay = null, headM = 0) {
  // ⚠ ONLY A DOORWAY SOMEBODY WALKS THROUGH. A model's own door can be drawn to the building's scale and not a
  // person's (a low marina office's is under a metre), and that one isn't the street door: the mass is measured.
  if (bay && bay.half > 0.005 && bay.head - bay.sill >= HEAD_M[0] * 0.9 * metre) {
    const bx = bay.lx;
    const at = (lx, ly) => [gx + (lx + bx) * E[1] + ly * E[0], gy - (lx + bx) * E[0] + ly * E[1]];
    const plane = Math.min(0.498, bay.wall + BAY_PLANE);
    return { E, at, wall: bay.wall, plane, back: Math.min(plane - 0.001, bay.wall + BAY_BACK), half: bay.half, sill: Math.max(0, bay.sill), top: bay.head, leaves: true, cx: bx, fit: 'model' };
  }
  const at = (lx, ly) => [gx + (lx + cx) * E[1] + ly * E[0], gy - (lx + cx) * E[0] + ly * E[1]];
  const hit = (lx, ly, z) => { const [px, py] = at(lx, ly); return obstruct(gx, gy, c, px, py, z, STEP) > 0; };
  // the room's own door, half its width
  const wide = Math.max(0.03, (w || 2) * metre / 2);
  const head = (headM > 0 ? headM : HEAD_DEFAULT_M) * metre;
  let wall = null;
  for (let ly = 0.5; ly >= 0.2 && wall == null; ly -= 0.005) if (hit(0, ly, 0.02)) wall = ly;
  if (wall == null) return { E, at, wall: 0.44, plane: 0, back: 0, half: wide, sill: 0, top: 0, leaves: false, cx, fit: 'room' };
  // and to the face itself: the step left it up to 5 mm short, behind what the model drew in the doorway
  for (let lo = wall, hi = Math.min(0.5, wall + 0.005), i = 0; i < 8; i++) { const mid = (lo + hi) / 2; if (hit(0, mid, 0.02)) lo = wall = mid; else hi = mid; }
  let half = null, top = null;
  for (let lx = 0.01; lx <= 0.4 && half == null; lx += 0.004) if (hit(lx, wall + 0.02, 0.02) || hit(-lx, wall + 0.02, 0.02)) half = lx;
  // ⚠ A GAP IS A DOORWAY ONLY IF IT'S ABOUT A DOOR WIDE. The first mass either side might be the end of the shop
  // window or a bollard, three times the door's width; that is the gap measured, not the door.
  const jambs = half != null && half >= wide * JAMB_FIT[0] && half <= wide * JAMB_FIT[1];
  if (!jambs) half = null;
  // (a tower's doorway is drawn to the tower's scale, far over a person's head, so the lintel is looked for high)
  for (let z = 0.03; z <= 3 && top == null; z += 0.01) if (hit(0, wall + 0.02, z)) top = z;
  if (top != null && (top < HEAD_M[0] * metre || top > HEAD_M[1] * metre)) top = null;
  // the leaves stand a hair proud of the jambs' own front, so whatever the arm drew in the doorway is behind them
  let front = wall;
  if (jambs) for (let ly = 0.5; ly > wall; ly -= 0.004) if (hit(half + 0.012, ly, 0.02) || hit(-half - 0.012, ly, 0.02)) { front = ly; break; }
  const plane = Math.min(0.498, front + 0.01);
  return { E, at, wall, plane, back: Math.min(plane - 0.001, wall + 0.004), half: half ?? wide, sill: 0, top: top ?? head, leaves: true, cx, fit: jambs ? 'mass' : 'room' };
}
