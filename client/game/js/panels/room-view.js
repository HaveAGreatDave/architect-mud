// WHAT GLASS IS TOLD TO PAINT OUT OF A ROOM'S WINDOW, the one copy. The worker (room-outlook-worker.js) and the
// main-thread fallback (room-outlook.js) both build their frame here, so the two can't drift. No imports
// from the renderer: this runs before it has loaded, on either thread.

import { m2t } from '../../../shared/world-scale.js';

// how far along the front wall's bearing the eye sits from the tile's middle, in tiles
const EYE_OUT = 0.42;
// what's drawn in full and how far: from a flat almost all of the city is far off, and through a pane it's small
const TUNE = { lodNear: 8, lodFar: 14, decoFar: 8, glowFar: 11, shadowFar: 6, signFar: 6 };

// How high the eye is, in the renderer's units: the same fraction of the building's height as the
// flat's storey is of its storeys. A building that doesn't say how many it has is taken to stop two
// above the flat, which is what a tower with a crown on it comes to.
// ⚠ THE GROUND FLOOR IS STREET LEVEL, a standing eye (1.6 m) off the pavement, whatever the building's height: as a
// fraction of a tall tower it put a lobby's window a storey up.
export function eyeZ(top, storey, storeys) {
  if (!(storey > 1)) return Math.max(0.03, Math.min(top > 0 ? top * 0.97 : Infinity, m2t(1.6)));
  const n = Math.max(Number(storeys) || 0, storey + 2);
  return Math.max(0.06, top * Math.min(0.97, (storey - 0.5) / n));
}

// The map with the flat's own building taken off its tile, ground only. `self` isn't enough: a cell with a
// `bt` is drawn on its own tile so an aircraft can land on the roof, so left alone the tower stands round
// the eye and shows through the panes as a ghost that slides as you walk.
function withoutOwnTower(map) {
  const R = (map.length - 1) / 2, c = map[R]?.[R];
  if (!c) return map;
  return map.map((row, y) => (y === R ? row.map((cell, x) => (x === R ? { kind: 'land', biome: c.biome, flr: c.flr, self: 1 } : cell)) : row));
}

// Where the eye starts, from `room_outlook` and the renderer's modelTopZAt, and the map GLASS is given.
// The eye's height is read off the building first, since the map it's painted from no longer has one.
export function eyeBase(msg, modelTopZAt) {
  const R = (msg.map.length - 1) / 2, cell = msg.map[R]?.[R] || null, rad = (msg.bearing || 0) * Math.PI / 180;
  const top = cell ? modelTopZAt(msg.gx, msg.gy, cell, msg.gx, msg.gy) || 0 : 0;
  const placed = msg.frame ? inBuilding(msg.frame, rad, top) : null;
  if (placed) return { ...placed, rad, map: withoutOwnTower(msg.map) };
  return { x: Math.sin(rad) * EYE_OUT, y: -Math.cos(rad) * EYE_OUT, z: eyeZ(top, msg.storey || 1, msg.storeys), rad, map: withoutOwnTower(msg.map) };
}

// ⚠ A ROOM ON A BUILDING'S WALK STANDS WHERE THE BUILDING PUTS IT (docs/proposals/building-stage.md). The plan has
// every room in one frame, so the street front of the entry room is put on the tile's street edge and each room
// sits where the plan says from there, at its true height. The walk then moves the eye by true metres, so the
// city moves past the glass as you cross a room, and two rooms' windows look out from where they really are.
// `frame` is the roomstage plugin's: `entry`, the entry room's front wall middle as [x, z] in this room's frame
// (the Stage's host frame, this room at the origin facing 0), `front` that room's facing on the compass, `side` the
// tile edge its door is on, and `floor` this room's floor in metres above the street.
const EDGE = 0.47;   // how far from the tile's middle the street front stands, in tiles (inside, or it's the pavement)
function inBuilding(fr, rad, top) {
  if (!Array.isArray(fr.entry) || !Number.isFinite(fr.side)) return null;
  // the entry room's front middle in this room's own metres: the host frame has x = -u, z = -v
  const u0 = -fr.entry[0], v0 = -fr.entry[1], s = Math.sin(rad), c = Math.cos(rad);
  // this room's origin (its front wall middle) from the anchor, in tiles: GLASS has +x east and +y south
  const ox = -(c * m2t(u0) - s * m2t(v0)), oy = -(s * m2t(u0) + c * m2t(v0));
  const side = fr.side * Math.PI / 180;
  const z = Math.min(top > 0 ? top * 0.97 : Infinity, m2t((Number(fr.floor) || 0) + 1.6));
  return { x: Math.sin(side) * EDGE + ox, y: -Math.cos(side) * EDGE + oy, z: Math.max(0.03, z), placed: true, floor: Number(fr.floor) || 0, top };
}

// The multiplier on GLASS's lens that gives the seat's vertical field of view, and the room's lens to match.
// `fxK` is GLASS's lateral focal over half the width, `vfK` its vertical focal over the width.
export function lensOf(fxK, vfK, W, H, fov) {
  const fy = vfK * W / (H / 2), k = 1 / (Math.tan((fov ?? 72) * Math.PI / 360) * fy);
  return { k, lens: [fxK * k, fy * k] };
}

// ⚠ THE HOUR GOES IN STEPS, AS EVERY OTHER SEAT GETS IT FROM THE SERVER. The floor's LUT and other caches key on
// what the hour lights, and a clock that moves every frame rebuilt them every paint (33 ms for the LUT alone).
// ⚠ THE EYE NEVER LEAVES ITS OWN TILE. Only that tile's building is hidden (`self`), and a tile is 17.9 m, so an
// eye moved by the true metres walks out of the back of a big flat and into the building next door. The walk
// is scaled to fit the tile, which keeps a pane's view shifting as you pass and nothing else.
export function viewOf(msg, base, { hour, wx, look, fed, k }) {
  const [rw, rd] = look?.room || [1, 1], fit = (m) => (base.placed ? 1 : Math.min(1, 2 * EYE_OUT / m2t(m)));
  // ⚠ THE EYE STANDS WHERE YOU STAND. Pinned to the middle of the room, a ground floor kept the street a room's
  // depth off however close you walked to the glass, a gap where the pavement should be. So `look.at` moves it, in
  // true metres where the building places the room, and the paint follows each step (room-outlook.js repaints a still
  // head every time the worker's free). With no `at` it's the room's middle, as before.
  const at = look?.at, v = (Number.isFinite(at?.[1]) ? Math.max(0, Math.min(rd, at[1])) : rd / 2) * fit(rd);
  const u = (Number.isFinite(at?.[0]) ? Math.max(-rw / 2, Math.min(rw / 2, at[0])) : 0) * fit(rw);
  const s = Math.sin(base.rad), c = Math.cos(base.rad), sky = msg.sky || {};
  // placed in its building: true metres, the eye's own height, and never off its own tile (only that one's
  // building is taken away, so an eye past its edge would stand inside the next one)
  const keep = (t) => Math.max(-EDGE - 0.02, Math.min(EDGE + 0.02, t));
  const cam = base.placed
    ? { x: keep(base.x - s * m2t(v) + c * m2t(u)), y: keep(base.y + c * m2t(v) + s * m2t(u)), z: Math.min(base.top > 0 ? base.top * 0.97 : Infinity, Math.max(0.03, m2t(base.floor + 1.6))) }
    : { x: base.x - s * m2t(v) + c * m2t(u), y: base.y + c * m2t(v) + s * m2t(u), z: base.z };
  return {
    external: true, hideOwnShip: true, bare: true, noWxBadge: true, still: true, phase: 'cruise', worldBlend: 1, resFloor: 1,
    heading: 0, height: 0, speed: 0, hour: Math.floor(hour * 20) / 20, moon: wx?.moon ?? sky.moon, weather: wx?.weather || sky.weather, wxField: sky.field, wxGround: sky.ground, event: sky.event || null,
    map: base.map, skyline: msg.skyline, mapCenter: { x: msg.gx, y: msg.gy }, mapOffset: { x: 0, y: 0 },
    acX: msg.gx, acY: msg.gy, airport: 'default', tune: TUNE, actors: fed?.actors || [], contacts: fed?.contacts || null, roads: msg.roads, regions: msg.regions,
    // the front wall is at v 0, and the room runs back from it; u is along it, to the right
    freeCam: { x: cam.x, y: cam.y, z: cam.z, yaw: look?.yaw ?? 0, pitch: look?.pitch ?? 0, roll: 0, fov: k },
  };
}

// ⚠ A ROOM IN GLASS'S WORLD (gl/interiors.js, docs/proposals/one-world-interiors.md). The column-major 4x4 that takes a
// point in the room renderer's frame (L from roomLayout: metres, y up, the front wall's middle at L.at) to GLASS's
// tiles about the building's tile centre (+x east, +y south, z up). `origin` is where the room's front wall middle
// stands on the tile, in tiles ([x, y], inBuilding's `ox`/`oy` plus the street edge), `bearing` the way the room
// faces in degrees on the compass, `floorM` its floor in metres above the street. Same sums as viewOf's eye:
// x = ox + c·u − s·v, y = oy + s·u + c·v, so the eye and the walls can't disagree.
export function roomToGlass(L, origin, bearing, floorM = 0) {
  const k = m2t(1), rad = (bearing || 0) * Math.PI / 180, s = Math.sin(rad), c = Math.cos(rad);
  const r = L.r, f = L.f, a = L.at;
  // u = (P − a)·r, v = −(P − a)·f, over P's x and z
  const ux = r[0], uz = r[2], vx = -f[0], vz = -f[2];
  const X = [k * (c * ux - s * vx), 0, k * (c * uz - s * vz)];
  const Y = [k * (s * ux + c * vx), 0, k * (s * uz + c * vz)];
  const ax = a[0], az = a[2];
  const tx = origin[0] - (X[0] * ax + X[2] * az), ty = origin[1] - (Y[0] * ax + Y[2] * az), tz = k * (floorM - L.floor);
  return [X[0], Y[0], 0, 0, X[1], Y[1], k, 0, X[2], Y[2], 0, 0, tx, ty, tz, 1];
}

// Where a room's front wall middle stands on its building's tile, in tiles, from the roomstage plugin's `frame`
// (as inBuilding reads it). Null when the frame doesn't place it.
export function roomOrigin(fr, bearing) {
  if (!fr || !Array.isArray(fr.entry) || !Number.isFinite(fr.side)) return null;
  const rad = (bearing || 0) * Math.PI / 180, s = Math.sin(rad), c = Math.cos(rad);
  const u0 = -fr.entry[0], v0 = -fr.entry[1], side = fr.side * Math.PI / 180;
  return [Math.sin(side) * EDGE - (c * m2t(u0) - s * m2t(v0)), -Math.cos(side) * EDGE - (s * m2t(u0) + c * m2t(v0))];
}
