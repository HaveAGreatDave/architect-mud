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
    // `tile` ties a room to its building's street door (gl/interiors.js drawPortals); `still` is the picture its
    // walls are painted with seen through that door (lobby-still.js), once there is one
    return { key: room.key + (lod ? '#box' : '#mesh'), M, lod, lamp: room.lamp || null, parts: () => room.parts(lod),
      tile: room.gx + ',' + room.gy, still: room.still ? room.still() : null,
      // its panes about the window's centre, for windshield.js panePortals
      panes: room.panes && room.panes.length ? room.panes.map((q) => ({ quad: q.quad.map((p) => [p[0] + room.gx - ox, p[1] + room.gy - oy, p[2]]),
        c: [q.c[0] + room.gx - ox, q.c[1] + room.gy - oy, q.c[2]], n: q.n })) : null };
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
  const list = Array.isArray(spec.windows) && spec.windows.length ? spec.windows
    : Array.isArray(spec.window) ? [{ wall: 'front', a: spec.window[0], b: spec.window[1], y0: spec.window[2], y1: spec.window[3] }] : [];
  const hu = L.w / 2, D = L.d, out = [];
  const at = (u, v, y) => {
    const p = L.world(u, v, y);
    return [M[0] * p[0] + M[4] * p[1] + M[8] * p[2] + M[12], M[1] * p[0] + M[5] * p[1] + M[9] * p[2] + M[13], M[2] * p[0] + M[6] * p[1] + M[10] * p[2] + M[14]];
  };
  for (const q of list) {
    const a = Math.min(+q.a, +q.b), b = Math.max(+q.a, +q.b);
    if (!(b - a > 0.05)) continue;
    const y0 = Number.isFinite(+q.y0) ? +q.y0 : 0.9, y1 = Number.isFinite(+q.y1) ? Math.min(+q.y1, L.h) : Math.min(2.1, L.h);
    if (!(y1 - y0 > 0.05)) continue;
    // each wall as (u, v) along it from `a` to `b`, and the step into the room
    const wall = q.wall || 'front';
    const uv = wall === 'back' ? (s) => [s, D] : wall === 'left' ? (s) => [-hu, s] : wall === 'right' ? (s) => [hu, s] : (s) => [s, 0];
    const inn = wall === 'back' ? [0, -1] : wall === 'left' ? [1, 0] : wall === 'right' ? [-1, 0] : [0, 1];
    const [ua, va] = uv(a), [ub, vb] = uv(b);
    const quad = [at(ua, va, y1), at(ub, vb, y1), at(ub, vb, y0), at(ua, va, y0)];
    const c = at((ua + ub) / 2, (va + vb) / 2, (y0 + y1) / 2), i = at((ua + ub) / 2 + inn[0], (va + vb) / 2 + inn[1], (y0 + y1) / 2);
    const nx = i[0] - c[0], ny = i[1] - c[1], l = Math.hypot(nx, ny) || 1;
    out.push({ quad, c, n: [nx / l, ny / l] });
  }
  return out;
}
