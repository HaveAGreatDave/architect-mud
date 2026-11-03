// ROOM WALK: on your feet in a room you can walk round in first person (docs/proposals/room-stage.md).
//
// Lifted out of the Platinum Box suite (stands.js walkSuite) with nothing about baseball left in it,
// so the suite and a flat walk the same way: WASD walks where you're looking, sliding along what you
// meet; Shift runs; Ctrl or C crouches; E sits in the nearest seat, uses the nearest station or gets
// you up; a click on a seat or a station does the same. The layout is client/shared/room-layout.js's,
// in whatever unit the room is in (`L.ft` is a foot in it), so the paces below are in feet.
//
// It moves an eye. The host owns the picture: `seat` is the object its view reads every frame
// ({ eye, yaw, pitch, mode }), `project` puts a room point on the screen, and the host's own callbacks
// say what a station does and what happens round a sit. Nothing here sends a command itself.
//
// The keyboard is claimed through seat-keys.js, like every other seat, so the room shows which of
// it and the command bar has the keys and a click on the picture gives them back.

import { roomStep, roomSeatNear, roomFree } from '../../../shared/room-layout.js';
import { getDrugFx } from './flight-drugfx.js';
import { claimSeatKeyboard, endSeatKeyboard } from './seat-keys.js';

const WALK = 5.5;          // feet a second
const STAND = 5.4;         // eye height on your feet
const SPRINT = 1.9;        // Shift: how much faster
const CROUCH = 3.3;        // Ctrl or C: eye height crouched
const CROUCH_PACE = 0.5;   // and how much slower

// opts:
//   L          the layout (roomLayout / boothLayout)
//   seat       the eye the view reads: { eye, yaw, pitch, mode }
//   pane       the element the keyboard is claimed for, and `label` the readout's word for it
//   project    (point, w, h) => { x, y } | null, a point in the host's frame on the picture
//   setMode    (mode) => void: 'free' on your feet, the seat's own mode when sat
//   redraw     () => void
//   onStation  (station) => void: what E or a click on a station does
//   onSit      (seat) => void, after you sit; onStand () => void, after you get up
//   seatMode   (seat) => mode a seat puts the view in ('free' by default)
//   canSit     (seat) => true unless somebody else is in it
//   onSettle   ([u, v], yaw) => void, when you stop walking (where you stand now)
//   start      a seat to start in, or { at: [u, v], yaw } to start on your feet
export function createRoomWalk(opts) {
  const { L, seat } = opts;
  const ft = L.ft || 1;
  const redraw = () => opts.redraw?.();
  const setMode = (m) => opts.setMode?.(m);
  let at = null, sat = null, raf = 0, last = 0, walked = false;
  const held = new Set();
  // Shift sprints while it's held. Ctrl (or C) is a toggle, not a hold: Ctrl+W closes the browser
  // tab and no page can stop it, so crouch-walking forward with Ctrl held would shut the game.
  let sprint = false, crouched = false, eyeH = STAND * ft;
  const place = () => { seat.eye = L.world(at[0], at[1], L.groundAt(at[0], at[1]) + eyeH); redraw(); };
  const sit = (s) => {
    if (opts.canSit && !opts.canSit(s)) return false;
    sat = s; at = [s.u, s.v]; crouched = false; eyeH = STAND * ft;
    seat.eye = s.eye.slice(); seat.yaw = s.yaw; seat.pitch = s.pitch;
    setMode(opts.seatMode ? opts.seatMode(s) : 'free');
    opts.onSit?.(s);
    return true;
  };
  const standUp = () => {
    if (!sat) return;
    // a step out from the seat the way it faces, wherever there's room
    const y = seat.yaw || 0, wx = Math.sin(y), wz = Math.cos(y);
    const fu = wx * L.r[0] + wz * L.r[2], fv = -(wx * L.f[0] + wz * L.f[2]);
    // the nearest free spot round the seat, the way it faces first
    at = [sat.u, sat.v];
    const a0 = Math.atan2(fv, fu);
    find: for (let k = 1; k <= 5; k += 0.5) for (let i = 0; i < 16; i++) {
      const a = a0 + (i & 1 ? -1 : 1) * Math.ceil(i / 2) * Math.PI / 8, u = sat.u + Math.cos(a) * k * ft, v = sat.v + Math.sin(a) * k * ft;
      if (roomFree(L, u, v)) { at = [u, v]; break find; }
    }
    sat = null;
    if (seat.mode !== 'free') setMode('free');
    place();
    opts.onStand?.();
    opts.onSettle?.(at, seat.yaw || 0);
  };
  const stationNear = () => (L.stations || []).find((st) => Math.hypot(st.u - at[0], st.v - at[1]) < st.reach);
  const toggleSit = () => {
    if (sat) { standUp(); return; }
    const s = roomSeatNear(L, at[0], at[1]), st = stationNear();
    if (st && (!s || Math.hypot(st.u - at[0], st.v - at[1]) < Math.hypot(s.u - at[0], s.v - at[1]) + 2 * ft)) { opts.onStation?.(st); return; }
    if (s) sit(s);
  };
  const MOVES = { w: [0, 1], s: [0, -1], a: [-1, 0], d: [1, 0] };
  const tick = (now) => {
    raf = 0;
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
    last = now;
    // the eye going down into a crouch or back up, eased, whether or not you're walking
    const wantH = (crouched ? CROUCH : STAND) * ft, settling = !sat && Math.abs(eyeH - wantH) > 0.01 * ft;
    if (settling) { eyeH += (wantH - eyeH) * (1 - Math.exp(-dt * 12)); if (Math.abs(eyeH - wantH) <= 0.01 * ft) eyeH = wantH; }
    if (!held.size) {
      if (walked) { walked = false; opts.onSettle?.(at, seat.yaw || 0); }
      if (settling) place();
      if (!settling) { last = 0; return; }
      raf = requestAnimationFrame(tick); return;
    }
    if (sat) standUp();
    if (seat.mode !== 'free') setMode('free');
    let side = 0, ahead = 0;
    for (const k of held) { side += MOVES[k][0]; ahead += MOVES[k][1]; }
    const l = Math.hypot(side, ahead);
    if (l || settling) {
      // ahead is where you're looking, flat; right is a quarter turn clockwise from it, seen from above
      const pace = WALK * ft * (crouched ? CROUCH_PACE : sprint ? SPRINT : 1) * dt;
      const y = seat.yaw || 0, fx = Math.sin(y), fz = Math.cos(y), rx = -fz, rz = fx;
      if (l) {
        // drunk on your feet you drift off line, and the room turns a little with you
        const dfx = getDrugFx(), drunk = dfx?.profile === 'drunk' ? dfx.intensity : 0;
        if (drunk > 0.3) seat.yaw = y + Math.sin(now * 0.0011) * Math.sin(now * 0.00037 + 1) * (drunk - 0.3) * 1.4 * dt;
        const wx = (fx * ahead + rx * side) / l * pace, wz = (fz * ahead + rz * side) / l * pace;
        at = roomStep(L, at, wx * L.r[0] + wz * L.r[2], -(wx * L.f[0] + wz * L.f[2]));
        walked = true;
      }
      place();
    }
    raf = requestAnimationFrame(tick);
  };

  // where you start: in a seat, or on your feet
  const start = opts.start;
  if (start && start.eye) sit(start);
  else {
    at = start?.at ? start.at.slice() : [(L.bounds[0] + L.bounds[1]) / 2, (L.bounds[2] + L.bounds[3]) / 2];
    if (Number.isFinite(start?.yaw)) seat.yaw = start.yaw;
    seat.pitch = seat.pitch ?? 0;
    setMode('free');
    place();
  }
  if (opts.pane) claimSeatKeyboard(opts.pane, { label: opts.label || 'ROOM' });

  return {
    key(e, down) {
      const k = String(e.key || '').toLowerCase();
      sprint = !!e.shiftKey && !(down === false && k === 'shift');
      if (k === 'shift') return true;
      if (k === 'control' || (k === 'c' && !e.ctrlKey && !e.metaKey)) {
        if (down && !e.repeat) {
          if (sat) standUp();
          crouched = !crouched;
          if (!raf) { last = 0; raf = requestAnimationFrame(tick); }
        }
        return true;
      }
      if (MOVES[k]) {
        if (down) { held.add(k); if (!raf) raf = requestAnimationFrame(tick); } else held.delete(k);
        return true;
      }
      if (!down) return false;
      if (k === 'e') { toggleSit(); return true; }
      return false;
    },
    // what's under a point on the picture: a station within a generous hand of it (they win over a
    // seat, which is what you'd mostly not mean), else the nearest seat
    hit(x, y, w, h) {
      const pd = Math.max(150, w * 0.14), bd = Math.max(80, w * 0.07);
      let pick = null, pBest = pd, best = null, sBest = bd;
      for (const st of L.stations || []) {
        const q = opts.project?.(L.world(st.u, st.v, st.y), w, h);
        const dd = q ? Math.hypot(q.x - x, q.y - y) : Infinity;
        if (dd < pBest) { pBest = dd; pick = st; }
      }
      if (pick) return { station: pick, far: !!pick.behind && Math.hypot(pick.u - at[0], pick.v - at[1]) > pick.reach };
      for (const s of L.seats) {
        if (s === sat) continue;
        const q = opts.project?.(L.world(s.u, s.v, (s.lie ? s.y * 0.6 : 2.2 * ft)), w, h);
        const dd = q ? Math.hypot(q.x - x, q.y - y) : Infinity;
        if (dd < sBest) { sBest = dd; best = s; }
      }
      return best ? { seat: best } : null;
    },
    // a click: what's under it, or false. A station somebody has to walk round to is the host's
    // to explain (hit.far), so the host is told rather than this guessing at a line.
    click(x, y, w, h, onFar) {
      const hit = this.hit(x, y, w, h);
      if (!hit) return false;
      if (hit.station && hit.far) { onFar?.(hit.station); return true; }
      if (hit.station) { opts.onStation?.(hit.station); return true; }
      sit(hit.seat); return true;
    },
    sit, standUp, toggleSit,
    // a Sit button: up if you're down, else into the nearest free seat within `reach` feet, never a
    // station (that's E's and a click's)
    sitOrStand(reach = 12) {
      if (sat) { standUp(); return true; }
      const free = L.seats.filter((s) => !opts.canSit || opts.canSit(s));
      let best = null, bd = reach * ft;
      for (const s of free) { const dd = Math.hypot(s.u - at[0], s.v - at[1]); if (dd < bd) { bd = dd; best = s; } }
      return best ? sit(best) : false;
    },
    get sat() { return sat; },
    get at() { return at; },
    walking: () => !sat && held.size > 0,
    stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0; held.clear();
      if (opts.pane) endSeatKeyboard(opts.pane);
    },
  };
}
