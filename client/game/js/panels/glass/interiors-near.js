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
    if (dist > tune.mid) continue;
    out.push({ room, dist, lod: dist <= tune.near ? 0 : 1 });
  }
  out.sort((a, b) => a.dist - b.dist);
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
// box until it is, so coming near a building never builds a room on the frame.
export function interiorsFrame(picks, ox, oy) {
  return picks.map(({ room, lod: want }) => {
    const lod = want === 0 && room.meshReady && !room.meshReady() ? 1 : want;
    const M = room.M.slice(); M[12] += room.gx - ox; M[13] += room.gy - oy;
    return { key: room.key + (lod ? '#box' : '#mesh'), M, lod, lamp: room.lamp || null, parts: () => room.parts(lod) };
  });
}
