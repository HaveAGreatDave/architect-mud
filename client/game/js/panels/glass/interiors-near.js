// WHICH ROOMS ARE IN THE WORLD THIS FRAME, AND HOW MUCH OF EACH (docs/proposals/one-world-interiors.md).
//
// gl/interiors.js draws rooms in GLASS's own scene. This picks them: a room near the eye gets its whole mesh (lod 0),
// one a few tiles off a lit box (lod 1), and anything further nothing, since the building's own model stands for it.
// Nothing loads for a room you're nowhere near, and a room that drops out is let go by the layer a few seconds on.
//
// ⚠ PURE. No GL, no DOM: a list in, a list out, so the gate (scripts/client/interiors-smoke.mjs) can run it in node.
// ⚠ DISTANCE IS TO THE ROOM'S BOX, NOT ITS ORIGIN. A deep hall's far end is a long way from its front wall, and
// standing at that end you're in it.

export const INTERIOR_TUNE = {
  near: 0.9,     // tiles: inside this, the room's whole mesh
  mid: 3.5,      // tiles: inside this, its lit box
  max: 24,       // the most rooms drawn at all, nearest first
  maxNear: 8,    // the most whole rooms
  budget: 1,     // whole rooms built and uploaded a frame
};

// WHY ONE-WORLD WON'T TAKE A ROOM YET, or null when it will (freelook-view.js oneWorldRoom, with ONE_WORLD.entry).
// Each reason is something only the Room Stage draws or works today; the conversion (one-world-interiors.md, "The
// conversion") moves them over one at a time and takes the reason out here. `inBuilding(zone)` says whether a zone is
// one of this building's drawn rooms: a front opening into another of them isn't the street door.
// scripts/client/oneworld-coverage.mjs counts every room in content/ by these reasons.
// A room at a rink is walked in GLASS only with this on (freelook-view.js owRinkTick draws the ice through its openings);
// off, it's the Stage's. On since 2026-11-23, when the Stands and Rinkside at Golden Goose Gardens were walked in GLASS
// and the ice, the boards, the crowd and the players showed through their openings.
export const RINK_IN_GLASS = { on: true };
export function oneWorldBlocker(L, inBuilding = () => false) {
  const sp = L?.spec || {}, ops = sp.openings || [];
  // the lift car itself: its doors, its panel and the ride are the Stage's (room-lift.js). A landing with lift doors
  // is walked in GLASS, and stepping into the doors sends the move that puts you in the car (phase E).
  // (a lift car isn't a reason either since phase E: it comes once for each landing, open onto it, and GLASS takes the
  // copy where the car is, its floor buttons on the card; freelook-view.js liftCopy)
  if (sp.rink && !RINK_IN_GLASS.on) return 'rink';
  // A balcony and a roof deck aren't reasons (phase E): the room's mesh draws the deck and its rail (gl/room-mesh.js
  // drawBalcony; a roof deck has no ceiling), the walk takes the deck as floor (room-layout.js rects), and what's past
  // the rail is GLASS's own city and sky, which the Stage could only paint.
  const placed = L?.placed || [];
  // A cooker or a lab isn't a reason (phase F): the kitchen opens over the street view of a room walked in GLASS as it
  // does over the Stage (kitchen-stage.js glassHost), and the bench's HUD is a floating panel.
  // A shop counter or a vending machine isn't a reason: a counter's Shop sends `shop <counter>` and commerce's panel
  // opens over GLASS as over the Stage, and a machine's flavours and plug are typed verbs on GLASS's card
  // (room-acts.js vendorActs). Its front isn't drawn pressing and sliding in GLASS yet (room-vendor.js).
  if (!ops.some((o) => o.dir && o.kind === 'front' && !inBuilding(o.to))) return 'not-entry';
  return null;
}

// Whether two rooms (room-interiors.js entries) are on one storey. ⚠ NOT `L.floor`: that's the room's own floor offset
// in its frame and is 0 for nearly every room, so comparing it took the whole building as one storey and let a step in
// the lobby land in a flat overhead. The storey is the height the matrix stands the room at (frame.floor, roomToGlass).
const STOREY_EPS = 0.01;   // tiles, about 18 cm: storeys are metres apart
const BELOW_FLOOR = 0.003;   // tiles, about 5 cm: a room whose top is no higher than this over your floor is below you (interiorsFrame)
export const sameStorey = (a, b) => !!a?.M && !!b?.M && Math.abs(a.M[14] - b.M[14]) < STOREY_EPS;

// Whether one-world takes a room when its `room_view` comes (freelook-view.js oneWorldRoom, ONE_WORLD.entry, the
// desktop default). `inside` is where you're walking in GLASS ({ gx, gy, room }) or null. An entry room with nothing
// only the Stage does is taken from the street; any other room of the building is taken only from inside it in
// GLASS, on any storey (phase E), since then there's somewhere in GLASS to stand you (freelook-view.js owArrive).
// A phone always opens the Stage. `fromLift` is the lift car the Stage has just ridden you in: a landing whose doors
// lead to it is taken too, and you're stood outside them.
export function oneWorldTakes(room, inside, inBuilding, phone = false, { fromLift = null } = {}) {
  if (!room || phone) return false;
  const why = oneWorldBlocker(room.L, inBuilding);
  if (why === 'not-entry' && fromLift && (room.L.spec?.openings || []).some((o) => o.lift && o.to === fromLift)) return true;
  // A roof deck open to the sky (spec.open, the Solenne's Sky Pad) is taken however you got there: on the Stage its
  // sky was the six painted faces, a picture of the world, and in GLASS it's the world, as a balcony's is (2026-11-22).
  if (why === 'not-entry' && room.L.spec?.open) return true;
  // A vessel's room (the Echelon's, room-interiors.js placeOnVessel) is taken however you got there too: she has no
  // street to walk in from, so you're in her by the gangway, a helicopter or the room button, and every room of her is
  // drawn on her hull (docs/proposals/echelon-decks.md)
  if (why === 'not-entry' && room.vessel) return true;
  // any other room of the building you're walking in GLASS, on any storey: a doorway or a flight took you there, or a
  // typed `up` or `down` where the plan has no stair (the Meridian's, the Echelon's), and the view stands you in it
  if (why === 'not-entry') return !!inside && inside.gx === room.gx && inside.gy === room.gy;
  return !why;
}

// THE TUNE FOR THIS FRAME. `q` is windshield.js's frame governor (1 = the PC keeps up, down to 0 as it falls
// behind); `phone` is GL_TIER's. A weak machine spends what it has on the room you're in and its people, the point
// of being inside, not on lit boxes of the neighbours: the reach and the counts shrink with `q`, and inside a
// building (`home`, its "gx,gy") nothing else is drawn whole at all.
const INTERIOR_LOW = { mid: 1.5, max: 6, maxNear: 2 };
const HOME_NEAR = 8;   // whole rooms of the building you're inside, at the least (interiorTuneFor)
export function interiorTuneFor(q = 1, phone = false, home = null) {
  const t = phone ? 0 : Math.max(0, Math.min(1, q));
  const at = (k) => INTERIOR_LOW[k] + (INTERIOR_TUNE[k] - INTERIOR_LOW[k]) * t;
  if (t >= 1 && !home) return INTERIOR_TUNE;
  // inside, your own building's rooms stay whole however the frame is doing (HOME_NEAR): they're the doorways and the
  // stairwell you look through, and a box in their place is a lid over the stairs (interiorsFrame). Other buildings'
  // rooms are what a weak frame gives up (homeOnly).
  return { ...INTERIOR_TUNE, mid: at('mid'), max: Math.round(at('max')), maxNear: home ? Math.max(HOME_NEAR, Math.round(at('maxNear'))) : Math.round(at('maxNear')), home,
    // inside, a weak machine draws only your building's rooms
    homeOnly: !!home && t < 1 };
}

// `rooms`: [{ key, gx, gy, M, box: [x0, y0, x1, y1, z0, z1] (its bounds in absolute tiles), parts(lod) }].
// `eye`: [x, y, z] in absolute tiles. Returns [{ room, lod, dist }], nearest first.
export function pickInteriors(rooms, eye, tune = INTERIOR_TUNE) {
  const out = [];
  for (const room of rooms || []) {
    const b = room.box;
    if (!b) continue;
    const dx = Math.max(b[0] - eye[0], 0, eye[0] - b[2]), dy = Math.max(b[1] - eye[1], 0, eye[1] - b[3]);
    const dz = Math.max(b[4] - eye[2], 0, eye[2] - b[5]);
    const dist = Math.hypot(dx, dy, dz);
    const mine = !tune.home || room.gx + ',' + room.gy === tune.home;
    if (!mine && tune.homeOnly) continue;
    // your own building's rooms are always in reach (you can see down its hall); another's, only near
    if (dist > tune.mid && !(tune.home && mine)) continue;
    out.push({ room, dist, lod: dist <= tune.near && mine ? 0 : 1, mine });
  }
  // yours first, then nearest, so the caps fall on the neighbours
  out.sort((a, b) => (b.mine - a.mine) || a.dist - b.dist);
  let whole = 0;
  for (const p of out) if (p.lod === 0 && ++whole > tune.maxNear) p.lod = 1;
  return out.slice(0, tune.max);
}

// The box a room takes up in absolute tiles, from its matrix (room-view.js roomToGlass) and layout, for pickInteriors.
export function roomBounds(L, M, gx, gy) {
  const xs = [], ys = [], zs = [];
  for (const u of [-L.w / 2, L.w / 2]) for (const v of [0, L.d]) for (const y of [0, L.h]) {
    const p = L.world(u, v, y), x = M[0] * p[0] + M[4] * p[1] + M[8] * p[2] + M[12];
    const yy = M[1] * p[0] + M[5] * p[1] + M[9] * p[2] + M[13], z = M[2] * p[0] + M[6] * p[1] + M[10] * p[2] + M[14];
    xs.push(x + gx); ys.push(yy + gy); zs.push(z);
  }
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), Math.min(...zs), Math.max(...zs)];
}

// What the layer is handed: each pick as { key (per lod, so the box and the mesh are held apart), M about the map
// window's centre (ox, oy absolute), parts, lamp }.
// A room near enough to be whole whose mesh isn't built yet (room-interiors.js `meshReady`, which asks for it) is its
// box until it is, so coming near a building never builds a room on the frame. ⚠ Not from inside its own building
// (`inside`): there the box is a flat grey slab standing across the room you're in or the doorway you look through,
// so the room is left out until its mesh is back, a frame or two later. The same for a room of it past the cap on whole
// rooms (pickInteriors `maxNear`, as low as 2 when the frame governor is down): its box was a lid at floor height over
// the room below, flickering against the floor and shut over the stairwell from a few metres off (Golden Goose
// Gardens' Stands over Rinkside, 2026-11-23).
// `floorZ` (GLASS tiles, the floor of the room you're in): a room wholly below it has its ceiling cut off too (`top` under it), since
// it's only ever seen from above, through a stairwell. Its ceiling sits a hair under the floor over it, and from a few
// metres off the depth buffer can't tell them apart: Rinkside's came up through the Stands' floor in patches.
export function interiorsFrame(picks, ox, oy, { inside = false, floorZ = null } = {}) {
  return picks.filter(({ room, lod: want, mine }) => !(inside && mine && (want !== 0 || (room.meshReady && !room.meshReady())))).map(({ room, lod: want }) => {
    const lod = want === 0 && room.meshReady && !room.meshReady() ? 1 : want;
    const M = room.M.slice(); M[12] += room.gx - ox; M[13] += room.gy - oy;
    // `tile` ties a room to its building's street door (gl/interiors.js drawPortals); `still` is the picture its
    // walls are painted with seen through that door (lobby-still.js), once there is one
    return { key: room.key + (!lod && room.meshTag ? room.meshTag() : '') + (lod ? '#box' : '#mesh'), M, lod, lamp: room.lamp || null, dayK: room.dayK ?? 1, parts: () => room.parts(lod),
      tile: room.gx + ',' + room.gy, still: room.still ? room.still() : null,
      // its bounds about the window's centre, so the layer can skip a room wholly out of view (gl/interiors.js boxOut)
      box: room.box ? [room.box[0] - ox, room.box[1] - oy, room.box[2] - ox, room.box[3] - oy, room.box[4], room.box[5]] : null,
      // its ceiling in its own frame (metres, 5 cm over), where gl/interiors.js cuts its mesh off (uTop): a rink
      // room's arena seating is built past it and came up through the floor of the room above
      top: !lod && Number.isFinite(room.L?.h) ? (room.L.floor || 0) + room.L.h + (inside && Number.isFinite(floorZ) && room.box && room.box[5] <= floorZ + BELOW_FLOOR ? -0.1 : 0.05) : null,
      // the picture on its set while one's on (freelook-view.js owTvTick: { canvas, ver }), whole rooms only
      screen: !lod && room.screen ? room.screen : null,
      // its lamps, where they hang, for the layer's per-lamp light (whole rooms only; a box keeps the all-round tint)
      lamps: !lod && room.lampsNow ? room.lampsNow() : null,
      // and the paint on its walls (freelook-view.js owDecals: posters, tags), whole rooms only
      decals: !lod && room.decals && room.decals.length ? room.decals : null,
      // and a live part of it, a depot's vehicle on its stand (freelook-view.js owHoistTick), whole rooms only
      // (and a locked doorway's leaves, freelook-view.js owLockTick, and a vending machine, owVendTick)
      extra: !lod && (room.extra || room.lockExtra || room.vendExtra || room.cookExtra || room.beastExtra || room.morphExtra || room.arrangeExtra || room.underExtra || room.machineExtra || room.heldExtra) ? [room.extra, room.lockExtra, room.vendExtra, room.cookExtra, room.beastExtra, room.morphExtra, room.morphGlass, room.arrangeExtra, room.underExtra, room.machineExtra, room.heldExtra].filter(Boolean) : null,
      // and a vat hall's vats, live (freelook-view.js owVatTick, gl/interiors.js vatPrep), whole rooms only
      // a room with no shell, whole: the field and the floor gl/room-void.js draws for it
      voidNow: !lod && room.voidNow ? room.voidNow : null,
      vatLive: !lod && room.vatLive ? room.vatLive : null, figLive: !lod && room.figLive ? room.figLive : null, catLive: !lod && room.catLive ? room.catLive : null, glowLive: !lod && room.glowLive ? room.glowLive : null, haloLive: !lod && room.haloLive ? room.haloLive : null, vatsNow: room.vatsNow || null, gantriesNow: room.gantriesNow || null,
      // its panes about the window's centre, for windshield.js panePortals
      // a room drawn as its box (lod 1, or its mesh not built yet) shows its panes fogged, not the box (panePortals)
      fog: !!lod,
      panes: room.panes && room.panes.length ? room.panes.map((q) => ({ quad: q.quad.map((p) => [p[0] + room.gx - ox, p[1] + room.gy - oy, p[2]]),
        c: [q.c[0] + room.gx - ox, q.c[1] + room.gy - oy, q.c[2]], n: q.n, curtain: q.curtain })) : null };
  });
}

// ── THE WINDOWS IN THE SHELL (step 2) ──────────────────────────────────────────────────────────────────────────────
// A room's own panes (its spec's `windows`, or the old single `window` on the front wall) as quads about its building's
// tile centre, in tiles, each with the way into the room. From the street the model is solid, so gl/interiors.js
// drawPortals fills each pane from the room drawn behind it, as it does a street door. Rooms fit their model
// (docs/reference/building-styles.md), so a room's panes are where the model's windows are.
// Returns [{ quad: [4 points, top left first], c: [x, y, z], n: [x, y] }], `n` the unit step into the room.
export function roomPanes(spec, L, M) {
  if (!spec || spec.windowless) return [];
  const list = (Array.isArray(spec.windows) && spec.windows.length ? spec.windows
    : Array.isArray(spec.window) ? [{ wall: 'front', a: spec.window[0], b: spec.window[1], y0: spec.window[2], y1: spec.window[3] }] : []).slice();
  const hu = L.w / 2, D = L.d, out = [];
  // a floor-to-ceiling glass wall (spec.glass, the Solenne's curtain wall) is one pane the length of the wall: without
  // it a tower's glass was the model's own, solid, whatever room stood behind it
  for (const wall of Array.isArray(spec.glass) ? spec.glass : []) {
    if (!['front', 'left', 'right', 'back'].includes(wall) || list.some((q) => (q.wall || 'front') === wall)) continue;
    list.push(wall === 'front' || wall === 'back' ? { wall, a: -hu, b: hu, y0: 0, y1: L.h, curtain: true } : { wall, a: 0, b: D, y0: 0, y1: L.h, curtain: true });
  }
  const at = (u, v, y) => {
    const p = L.world(u, v, y);
    return [M[0] * p[0] + M[4] * p[1] + M[8] * p[2] + M[12], M[1] * p[0] + M[5] * p[1] + M[9] * p[2] + M[13], M[2] * p[0] + M[6] * p[1] + M[10] * p[2] + M[14]];
  };
  for (const q of list) {
    const a = Math.min(+q.a, +q.b), b = Math.max(+q.a, +q.b);
    if (!(b - a > 0.05)) continue;
    const y0 = Number.isFinite(+q.y0) ? Math.max(0, +q.y0) : 0.9, y1 = Number.isFinite(+q.y1) ? Math.min(+q.y1, L.h) : Math.min(2.1, L.h);
    if (!(y1 - y0 > 0.05)) continue;
    // each wall as (u, v) along it from `a` to `b`, and the step into the room
    const wall = q.wall || 'front';
    const uv = wall === 'back' ? (s) => [s, D] : wall === 'left' ? (s) => [-hu, s] : wall === 'right' ? (s) => [hu, s] : (s) => [s, 0];
    const inn = wall === 'back' ? [0, -1] : wall === 'left' ? [1, 0] : wall === 'right' ? [-1, 0] : [0, 1];
    const [ua, va] = uv(a), [ub, vb] = uv(b);
    const quad = [at(ua, va, y1), at(ub, vb, y1), at(ub, vb, y0), at(ua, va, y0)];
    const c = at((ua + ub) / 2, (va + vb) / 2, (y0 + y1) / 2), i = at((ua + ub) / 2 + inn[0], (va + vb) / 2 + inn[1], (y0 + y1) / 2);
    const nx = i[0] - c[0], ny = i[1] - c[1], l = Math.hypot(nx, ny) || 1;
    out.push({ quad, c, n: [nx / l, ny / l], curtain: !!q.curtain });
  }
  return out;
}
