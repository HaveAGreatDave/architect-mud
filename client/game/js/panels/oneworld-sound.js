// ONE WORLD · THE OUTSIDE, HEARD FROM INSIDE (docs/proposals/one-world-interiors.md, phase D). Walking a building's
// rooms in GLASS, the rain and wind, the thunder, the birds and the surf come through the room's windows as they do on
// the Room Stage: the same three pieces, fed from the street view instead of the Stage's outlook.
//   room-window.js   the weather eased from the sky the street view was sent, and the thunder after a strike
//   room-outdoors.js the birds and the shore round the building, off the street view's map cut round it
//   room-sound.js    all of it played at the nearest window, by the ear the Stage works out (earOf, its placeOfEar)
// Nothing here reaches the server. A room's own ambience is the zone's, and the server plays that as ever.
// ⚠ room-sound.js CAN'T START AGAIN ONCE STOPPED, so each building you walk into gets a fresh set (the caller makes
// one on the way in and stops it on the way out).
import { createRoomWindow } from './room-window.js';
import { createRoomSound } from './room-sound.js';
import { createRoomOutdoors } from './room-outdoors.js';
import { lightAt } from '../../../shared/sky-keys.js';
import { roomYaw } from '../../../shared/room-layout.js';

const OUT_R = 12;   // tiles round the building the birds and the shore are looked for in
// the map rows round [bx, by], cut from a window centred on [gx, gy], so room-outdoors.js reads it as the Stage's
function mapRound(map, gx, gy, bx, by) {
  if (!Array.isArray(map) || !map.length) return null;
  const R = (map.length - 1) / 2, ox = bx - gx, oy = by - gy, r = Math.min(OUT_R, R - Math.abs(ox), R - Math.abs(oy));
  if (r < 1) return null;
  const rows = [];
  for (let y = -r; y <= r; y++) rows.push((map[R + oy + y] || []).slice(R + ox - r, R + ox + r + 1));
  return rows;
}

// Where the outside comes in, as room-stage.js placeOfEar and earPose have it: `at` and `ahead` are [u, v] in the room's
// frame, `bearing` the way its front looks, `storey` which floor it's on.
export function earOf(L, spec, at, ahead, bearing, storey, now, hour, wx) {
  let near = 99;
  for (const q of spec.windows || []) near = Math.min(near, q.wall === 'front' ? Math.max(0, at[1]) : Math.abs(at[0] - (q.wall === 'left' ? -1 : 1) * spec.w / 2));
  const du = ahead[0] - at[0], dv = ahead[1] - at[1], n = Math.hypot(du, dv) || 1, fwd = [du / n, dv / n];
  const yaw = roomYaw(L, fwd[0], fwd[1]);
  let spot = null, best = Infinity;
  const take = (u, v, out) => { const d = Math.hypot(at[0] - u, at[1] - v); if (d < best) { best = d; spot = { at: [u, v, 1.3], out }; } };
  for (const q of spec.windows || []) {
    const m = (q.a + q.b) / 2, side = q.wall === 'left' ? -1 : 1;
    if (q.wall === 'front') take(Math.max(q.a, Math.min(q.b, at[0])), 0, [0, -1]);
    else take(side * spec.w / 2, Math.max(Math.min(q.a, q.b), Math.min(Math.max(q.a, q.b), at[1] ?? m)), [side, 0]);
  }
  return {
    now, hour, near, open: 0, out: false, annex: false, look: (bearing || 0) * Math.PI / 180 - yaw, storey, storeys: 0, wx: wx || '',
    pose: { pos: [at[0], at[1], 1.6], fwd: [fwd[0], fwd[1], 0], right: [-fwd[1], fwd[0], 0], up: [0, 0, 1] }, spot,
  };
}

export function createOneWorldSound() {
  const outside = createRoomWindow(), hearing = createRoomSound(), outdoors = createRoomOutdoors();
  let placed = null;
  return {
    // the sky the street view was sent (freelookSetSky): the weather the windows let in
    sky(sky) { if (sky) outside.weather(sky); },
    // once a frame, inside. `room` a room-interiors.js entry with `bearing`; `view` { map, gx, gy } the street window.
    tick(room, view, at, ahead, hour) {
      if (!room?.L || !at || !ahead) return;
      const k = room.gx + ',' + room.gy, storey = 1 + Math.max(0, Math.round((room.M?.[14] || 0) / ((room.M?.[6] || 1) * 3.2)));
      if (placed !== k) {
        placed = k;
        outside.setPlace({ gx: room.gx, gy: room.gy, eyeX: 0, eyeY: 0, eyeZ: 1 + storey * 0.3, fields: [] });
        const m = mapRound(view.map, view.gx, view.gy, room.gx, room.gy);
        if (m) outdoors.setPlace({ map: m, gx: room.gx, gy: room.gy, bearing: room.bearing || 0 }); else outdoors.clear();
      }
      const now = performance.now(), h = Number.isFinite(hour) ? hour : 12;
      outside.frame(now, h, lightAt(h), room.L, room.bearing || 0);
      hearing.tick(outside.hear, earOf(room.L, room.L.spec || {}, at, ahead, room.bearing || 0, storey, Date.now(), h, view.wx), outdoors);
    },
    stop() { hearing.stop(); },
  };
}
