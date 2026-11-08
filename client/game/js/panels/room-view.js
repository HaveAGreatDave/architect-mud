// WHAT GLASS IS TOLD TO PAINT OUT OF A ROOM'S WINDOW, the one copy. The worker (room-outlook-worker.js) and the
// main-thread fallback (room-outlook.js) both build their frame here, so the two can't drift. No imports
// from the renderer: this runs before it has loaded, on either thread.

import { m2t } from '../../../shared/world-scale.js';

// how far along the front wall's bearing the eye sits from the tile's middle, in tiles
const EYE_OUT = 0.42;
// what's drawn in full and how far: from a flat almost all of the city is far off, and through a pane it's small
const TUNE = { lodNear: 8, lodFar: 14, decoFar: 8, glowFar: 11, shadowFar: 6, signFar: 6, faunaFar: 6 };

// How high the eye is, in the renderer's units: the same fraction of the building's height as the
// flat's storey is of its storeys. A building that doesn't say how many it has is taken to stop two
// above the flat, which is what a tower with a crown on it comes to.
export function eyeZ(top, storey, storeys) {
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
  return { x: Math.sin(rad) * EYE_OUT, y: -Math.cos(rad) * EYE_OUT, z: eyeZ(top, msg.storey || 1, msg.storeys), rad, map: withoutOwnTower(msg.map) };
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
  const [rw, rd] = look?.room || [1, 1], fit = (m) => Math.min(1, 2 * EYE_OUT / m2t(m));
  const v = Math.max(0, Math.min(rd, look?.at?.[1] ?? 0)) * fit(rd), u = Math.max(-rw / 2, Math.min(rw / 2, look?.at?.[0] ?? 0)) * fit(rw);
  const s = Math.sin(base.rad), c = Math.cos(base.rad), sky = msg.sky || {};
  return {
    external: true, hideOwnShip: true, bare: true, noWxBadge: true, still: true, phase: 'cruise', worldBlend: 1, resFloor: 1,
    heading: 0, height: 0, speed: 0, hour: Math.floor(hour * 20) / 20, moon: wx?.moon ?? sky.moon, weather: wx?.weather || sky.weather, wxField: sky.field, wxGround: sky.ground, event: sky.event || null,
    map: base.map, skyline: msg.skyline, mapCenter: { x: msg.gx, y: msg.gy }, mapOffset: { x: 0, y: 0 },
    acX: msg.gx, acY: msg.gy, airport: 'default', tune: TUNE, actors: fed?.actors || [], contacts: fed?.contacts || null, roads: msg.roads, regions: msg.regions,
    // the front wall is at v 0, and the room runs back from it; u is along it, to the right
    freeCam: { x: base.x - s * m2t(v) + c * m2t(u), y: base.y + c * m2t(v) + s * m2t(u), z: base.z, yaw: look?.yaw ?? 0, pitch: look?.pitch ?? 0, roll: 0, fov: k },
  };
}
