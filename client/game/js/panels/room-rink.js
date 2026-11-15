// ROOM · THE ICE PAST A ROOM'S OPENING. A room that stands at a rink (`flags.room.rink`) is drawn over the rink
// itself: GLASS 2's arena (gameday-rink.js, the same view a seat in the stands mounts) laid under the room's canvas,
// its eye bolted to the room's camera and drawn in the room's own frame, so the room's openings onto the ice
// (`kind: 'open'` panes, and a press box's glass) are holes onto the live game at the room's frame rate. Nothing
// is painted onto a screen: what's past the boards is the game.
//
// The rink is placed in the room by `spec.rink`: { sport, at: [x, y], look, ice }. `at` is the middle of the front
// wall on the floor in the sheet's feet (gameday's frame: x along the sheet, y across, z up), `look` the way you face
// looking at the front wall as a heading in degrees from +y toward +x, and `ice` how far the floor is above the ice,
// metres. A building's rooms all carry the same placement worked out from its plan (scripts/content/gardens-rooms.mjs),
// so the ice through a doorway into the next room is the same ice. A room with no rink of its own next door to one
// (the concourse behind the stands, a trophy room off them) sees the ice through that room's opening: it's placed
// through its neighbour, whose spec the building sends in this room's frame, and it draws the ice only while that
// doorway is in front of you.
//
// ⚠ THE ROOMS ARE CUT OUT OF THE ARENA (gl/arena.js api.cut). The arena has a bowl of seats right round the sheet,
// and a room stands where some of them would be: they'd be in front of its own opening. The room's box, and every
// room one doorway off it, is handed over as the cut; the room's own walls hide the rest.
// ⚠ IT RENDERS IN THE ROOM'S FRAME (`opts.manual`, `tick`), after the room's camera is set. Its own loop drew the ice a
// frame late, and a turning head swam over the boards.
//
// It decides nothing. Like a seat in the stands it's a receiver: the server tunes you to the game's channel while
// you're in the room (`rink` on `room_view`, plugins/stands), and the ice is the broadcast's game, as loud as it is
// near you. With no channel (the Room Lab) it's the ice between plays, nobody's game on it.
// ⚠ NOTHING HERE NAMES A BUILDING.
import { addTvView } from './tv.js';
import { wantClubs } from './club-crest.js';
import { sendRaw } from '../net.js';
import { FT_PER_M, roomLayout } from '../../../shared/room-layout.js';

const DEG = Math.PI / 180;
// how far round the room's box reaches, metres: its walls, and a little over the floor and under the ceiling
const WALL = 0.2, OVER = 0.3;

/** The placement as functions: a point in the room's own frame (u, v, y) to the sheet's feet, and a direction. */
export function rinkFrame(rink) {
  if (!rink || !Array.isArray(rink.at)) return null;
  const a = (Number(rink.look) || 0) * DEG, F = [Math.sin(a), Math.cos(a)], R = [Math.cos(a), -Math.sin(a)];
  const [X, Y] = rink.at, ice = Number(rink.ice) || 0;
  return {
    point: (u, v, y) => [X + (R[0] * u - F[0] * v) * FT_PER_M, Y + (R[1] * u - F[1] * v) * FT_PER_M, (ice + y) * FT_PER_M],
    dir: (du, dv, dy) => [R[0] * du - F[0] * dv, R[1] * du - F[1] * dv, dy],
  };
}
/** A room's box in the sheet's feet, [x0, y0, z0, x1, y1, z1], from its front wall's inner face back. `Lx` is the
 *  room's layout and `toRink` a point in the Stage's world to the sheet's feet. */
export function rinkBox(Lx, toRink) {
  const S = Lx?.spec;
  if (!S || !toRink) return null;
  const hw = (S.w || 4) / 2 + WALL, D = (S.d || 5) + WALL, H = (S.h || 2.6) + OVER;
  const ps = [[-hw, 0], [hw, 0], [-hw, D], [hw, D]].flatMap(([u, v]) => [toRink(Lx.world(u, v, -OVER)), toRink(Lx.world(u, v, H))]);
  const lo = [0, 1, 2].map((i) => Math.min(...ps.map((p) => p[i]))), hi = [0, 1, 2].map((i) => Math.max(...ps.map((p) => p[i])));
  return [...lo, ...hi].map((x) => Math.round(x * 100) / 100);
}
// The room's placement on the sheet: its own, or a neighbour's carried into it. { L (the layout whose frame the rink is
// given in), T (rinkFrame), sport, toRink (a world point to the sheet's feet), door (the doorway to the neighbour, in
// this room's frame, when it's borrowed) }, or null when neither it nor a room next door stands at a rink.
function placementOf(L, neighbours) {
  const own = L?.spec?.rink, n = own ? null : (neighbours || []).find((x) => x.spec?.rink);
  const ref = own ? L : n ? roomLayout(n.spec, []) : null, rink = own || n?.spec.rink, T = rink && rinkFrame(rink);
  if (!T) return null;
  const toRink = (p) => { const q = ref.local(p); return T.point(q[0], q[1], q[2]); };
  const door = n ? (L.spec.openings || []).find((o) => o.to === n.zone && o.wall !== 'floor' && o.wall !== 'ceiling') || null : null;
  return { L: ref, T, sport: rink.sport || 'hockey', toRink, door };
}
// whether a borrowed placement's doorway is anywhere near the picture: its middle within the lens and a margin
function doorInView(L, door, cam, w, h) {
  if (!door) return true;
  const m = (door.a + door.b) / 2, S = L.spec;
  const [u, v] = door.wall === 'front' ? [m, 0] : door.wall === 'back' ? [m, S.d] : door.wall === 'left' ? [-S.w / 2, m] : [S.w / 2, m];
  const p = L.world(u, v, 1.2), e = cam.eye, y = cam.yaw || 0;
  const dx = p[0] - e[0], dz = p[2] - e[2], ahead = dx * Math.sin(y) + dz * Math.cos(y), side = dx * Math.cos(y) - dz * Math.sin(y);
  const half = Math.atan(Math.tan(((cam.fov || 70) * DEG) / 2) * (w / Math.max(1, h)));
  return ahead > -0.5 && Math.abs(Math.atan2(side, Math.max(1e-3, ahead))) < half + 0.5;
}

/** The ice for one open Stage: `host` is the Stage's .rs-host, which the room's canvas sits in. */
export function createRoomRink(host) {
  let view = null, box = null, unview = null, key = '', cuts = null, seat = null, frame = null, dead = false;

  function stop() {
    unview?.(); unview = null;
    try { view?.clear(); } catch { /* gone */ }
    box?.remove();
    view = null; box = null; key = ''; seat = null;
  }
  // a room's rink, and its channel from the server (null in the Room Lab)
  async function start(sport, channelId) {
    stop();
    const mine = key = `${sport}|${channelId || ''}`;
    box = document.createElement('div');
    box.className = 'rs-rink';
    box.setAttribute('aria-hidden', 'true');
    host.insertBefore(box, host.firstChild);
    seat = { eye: [100, 42.5, 6], mode: 'free', yaw: 0, pitch: 0, fov: 90 };
    let v;
    try { v = (await import('./gameday-rink.js')).createRinkView(box, { seat, fly: false, manual: true }); }
    catch (err) { console.warn('[room] the ice would not load:', err?.message); if (key === mine) stop(); return; }
    if (key !== mine || dead) { v.clear(); return; }
    view = v;
    view.setCut(cuts);
    view.showIdle?.();
    if (!channelId) return;
    unview = addTvView({
      isOpen: () => true,
      activeChannelId: () => channelId,
      applyOverlay(ov) {
        if (!ov) return;
        if (ov.clubsRev && wantClubs(ov.sport || 'hockey', ov.clubsRev)) sendRaw({ type: 'tv_clubs', sport: ov.sport || 'hockey' });
        if (ov.overlayType === 'gameday') view?.apply(ov);
      },
      appendMessage() {}, showOffAir() {}, showOnAir() {}, updateTicker() {}, speak() {}, setProgramName() {}, renderSchedule() {}, renderStandings() {},
    });
    sendRaw({ type: 'tv_catchup' });
  }

  /** A room built or rebuilt: its layout, the rooms next door (`neighbours`, each with its spec in this room's frame)
   *  and the channel. */
  function load(L, neighbours, channel) {
    frame = placementOf(L, neighbours);
    if (!frame) { stop(); return; }
    // the room and every room one doorway off it that stands at the rink
    cuts = [rinkBox(L, frame.toRink), ...(neighbours || []).filter((n) => n.spec?.rink).map((n) => rinkBox(roomLayout(n.spec, []), frame.toRink))].filter(Boolean).slice(0, 4);
    view?.setCut(cuts);
    const want = `${frame.sport}|${channel?.channelId || ''}`;
    if (want !== key) start(frame.sport, channel?.channelId || null);
  }

  /** Each frame, after the room's camera is set: the ice from the same eye. `cam` is the room's ({ eye, yaw, pitch,
   *  fov }, in the Stage's world), `L` the room's layout (its `local`), `w`/`h` the canvas's size on screen. */
  function tick(now, cam, L, w, h) {
    if (!view || !seat || !frame || !L || !cam?.eye) return;
    if (!view.turns) { box.style.visibility = 'hidden'; return; }
    box.style.visibility = '';
    // through a doorway: the ice only while the doorway is in the picture
    if (!doorInView(L, frame.door, cam, w, h)) return;
    const y = cam.yaw || 0, p = cam.pitch || 0, f = [Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p)];
    const R = frame.L, T = frame.T;
    const e = R.local(cam.eye), q = R.local([cam.eye[0] + f[0], cam.eye[1] + f[1], cam.eye[2] + f[2]]);
    const at = T.point(e[0], e[1], e[2]), d = T.dir(q[0] - e[0], q[1] - e[1], q[2] - e[2]);
    seat.eye[0] = at[0]; seat.eye[1] = at[1]; seat.eye[2] = at[2];
    seat.yaw = Math.atan2(d[0], d[1]);
    seat.pitch = Math.atan2(-d[2], Math.hypot(d[0], d[1]));
    // the room's lens is its height; the seat's is its width, the same picture on this screen
    seat.fov = 2 * Math.atan(Math.tan(((cam.fov || 70) * DEG) / 2) * (w / Math.max(1, h))) / DEG;
    view.tick(now);
  }

  return {
    load, tick,
    get on() { return !!frame; },
    dispose() { dead = true; stop(); },
  };
}

