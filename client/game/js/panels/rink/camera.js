// Rinkside · the broadcast camera, shared by both renderers (render.js on a 2-D canvas,
// gl/arena.js on GLASS 2), so a shot is framed the same whichever one draws it.
//
// THE CAMERA NEVER ROLLS, AND YAWS ONLY A QUARTER TURN. It pans, climbs, tilts and zooms. On
// the 2-D path that is what makes the ice one drawImage per screen row; on GL it keeps the
// view matrix a pan and a pitch, which `matrices()` writes out by hand so it can be read
// against `P` line for line. The one yaw is the vertical view (`C.yaw`, 0 or 1): the camera
// stands at the left end looking down the sheet, so the play runs up and down the screen.
// Only GL draws it; the 2-D renderer shows the broadcast view instead.
//
// THE NHL 99 CAMERA. The default framing is the one the old EA games played on: high on the
// near side, close enough that the players are big, panning with the puck and leading it
// well ahead in the direction it's going. It isn't fixed: whenever the play is in a zone, or the
// director says a shot is coming (`W.cam.net`, the x of the net it's going at), the camera
// widens and slides until that net is in frame as well as the puck, so a shot is never taken
// at a goal the viewer can't see.
//
// SPRINGS, NOT CHASING, AND NEVER A CUT. Each of the camera's numbers follows its target on
// a critically damped spring (`smooth`), which starts and stops without a jolt and never
// overshoots. The old exponential chase lurched every time its target jumped. It runs on
// real time (the renderer passes `now`), so a hit-stop freezes the play but not the camera.
// Every change of framing is a move: down to a fight, across to the far end for a draw, out
// to the Zamboni. Only the replay's own camera (`snap`) jumps to its framing when a replay
// starts (`cam.cut` changing), and that happens behind the wipe that covers the switch.
//
// Modes come from the director (`W.cam.mode`); `view = 'low'` puts the default framing on
// the rail just inside the near glass, where the reflections show best. `view = 'vertical'`
// is the NHL 96 camera: high and steep behind the play, the width of the ice across the
// screen and its length running up it, panning end to end with the puck. The Zamboni's
// time-lapse is the one locked-off shot, the whole sheet from high up, in every view.

import { clamp } from './util.js';
import { RL, RW, GOAL_X, MID_Y, BOARD_H } from './geo.js';

export const NEAR = 0.6, FAR = 600;

// A critically damped spring: x toward `target` with velocity `st.v`, settling in about
// `time` seconds, never faster than `maxV`. Smooth in, smooth out, no overshoot.
function smooth(x, target, st, time, dt, maxV = Infinity) {
  const w = 2 / Math.max(1e-3, time), e = w * dt, k = 1 / (1 + e + 0.48 * e * e + 0.235 * e * e * e);
  let change = x - target;
  const lim = maxV * time;
  change = clamp(change, -lim, lim);
  const t2 = x - change, tmp = (st.v + w * change) * dt;
  st.v = (st.v - w * tmp) * k;
  let out = t2 + (change + tmp) * k;
  if ((target - x > 0) === (out > target)) { out = target; st.v = 0; }
  return out;
}

// The camera's ground axes: forward (where it looks) and right (across the picture).
// Broadcast looks across the sheet (+Y) with the length left to right; vertical looks down
// it (+X) with the width across, the near boards (Y = 0) on the left.
export function camAxes(yaw) { return yaw ? { fx: 1, fy: 0, rx: 0, ry: -1 } : { fx: 0, fy: 1, rx: 1, ry: 0 }; }

const KEYS = ['lx', 'ly', 'lz', 'dist', 'pitch', 'fm'];
// the steepest a vertical framing tilts to keep its eye out of the end stands
const EYE_MAX_PITCH = 1.2;
// how long each number takes to settle, seconds
const TIME = { lx: 0.55, ly: 0.7, lz: 0.6, dist: 0.8, pitch: 0.8, fm: 0.7 };

// `from` is a framing to start from (a renderer taking over from a lost one carries on
// from where the last left off); without it the camera starts on its framing.
export function createRinkCamera(W, { snap = false, from = null } = {}) {
  const cam = { lx: 100, ly: 40, lz: 0, dist: 56, pitch: 0.52, fm: 1, ...(from || {}) };
  const vel = Object.fromEntries(KEYS.map((k) => [k, { v: 0 }]));
  const api = { view: 'broadcast', cam };
  let lastCut = -1, lastNow = null, first = !from, lastYaw = 0;
  // where the action is heading: the focus's velocity, low-passed, for the look-ahead
  let pf = null, fv = [0, 0];

  // The framing for this instant: the puck (or whatever the director is following), led a
  // little in the direction it's going, and the net it's going at when that matters.
  function target(dt, aspect) {
    const tg = framing(dt, aspect);
    // THE VERTICAL EYE STAYS OUT OF THE END STANDS. It sits back down the sheet from what it
    // looks at, so a close framing at the low end (a scrum on that net: 21 ft past the boards
    // and 16 up) put it inside the stands, looking through them. The usual high framing
    // clears them; a low one is tilted steeper, then brought in, until it does.
    if (api.view !== 'vertical') return tg;
    let { pitch, dist } = tg;
    const inStands = () => {
      const x = tg.lx - dist * Math.cos(pitch), z = tg.lz + dist * Math.sin(pitch);
      return x < 0 && z < BOARD_H + 4 + (-x / 45) * (40 - BOARD_H);
    };
    for (let i = 0; i < 40 && inStands(); i++) {
      if (pitch < EYE_MAX_PITCH) pitch = Math.min(EYE_MAX_PITCH, pitch + 0.03); else dist *= 0.95;
    }
    return pitch === tg.pitch && dist === tg.dist ? tg : { ...tg, pitch, dist };
  }
  function framing(dt, aspect) {
    const c = W.cam, f = c.focus;
    if (pf && dt > 0) {
      const k = 1 - Math.exp(-dt * 3);
      fv[0] += (clamp((f[0] - pf[0]) / dt, -80, 80) - fv[0]) * k; fv[1] += (clamp((f[1] - pf[1]) / dt, -60, 60) - fv[1]) * k;
    }
    pf = [f[0], f[1]];
    switch (c.mode) {
      case 'fight': return { lx: f[0], ly: f[1], lz: 3.0, dist: 17.5, pitch: 0.1, fm: 0.95 };
      case 'zoom': return { lx: f[0], ly: f[1] - 2, lz: 1.5, dist: 40, pitch: 0.4, fm: 1 };
      case 'push': return { lx: f[0], ly: f[1], lz: 2.0, dist: 30, pitch: 0.32, fm: 1 };
      // the replay: down at ice level and close, following the puck a beat behind; never
      // backed up behind the near boards
      case 'replay': return { lx: f[0] + clamp(fv[0] * 0.3, -10, 10), ly: clamp(f[1] + 3, 24, RW - 4), lz: 1.4, dist: 24, pitch: 0.2, fm: 1 };
      // the Zamboni is a time-lapse, and a time-lapse is shot locked off: high and wide, the
      // whole sheet in the picture, in either view
      case 'zam': return api.view === 'vertical' ? wholeSheetV(aspect) : wholeSheet(aspect);
      case 'death': return { lx: clamp(f[0], 44, RL - 44), ly: clamp(f[1], 14, RW - 6), lz: 0.8, dist: 28 - Math.min(8, (W.t - (c.since || W.t)) * 0.6), pitch: 0.42, fm: 1 };
      default: return api.view === 'vertical' ? vertical(f, c, aspect) : broadcast(f, c, aspect);
    }
  }
  // NHL 96: high and steep, set back down the length behind the play, the width of the ice
  // across the screen. It leads the puck up or down the sheet and stops short of the end
  // boards, so a net is in the picture whenever the play is near it.
  function vertical(f, c, aspect) {
    const pitch = 0.98, cp = Math.cos(pitch), sp = Math.sin(pitch);
    // the width across: half of it over the depth at the look point fills the frame, pulled
    // back further on a narrow screen
    let dist = clamp((RW / 2 + 2) / (0.5 * Math.min(1, aspect / 1.25)) * 0.92, 70, 130);
    const ax = f[0] + clamp(fv[0] * 0.5, -22, 22), ly = RW / 2 + (f[1] - RW / 2) * 0.25;
    // the net: the one a shot is going at, or the one whose zone the play is in
    let net = c.net != null ? c.net : null;
    if (net == null) for (const gx of GOAL_X) if (Math.abs(f[0] - gx) < 62) net = gx;
    const must = [[f[0], f[1], 0], [ax, f[1], 0]];
    if (net != null) must.push([net + (net < RL / 2 ? -4 : 4), MID_Y, 0], [net, MID_Y, 4]);
    // Then solved as the broadcast framing is: slid along the sheet, and pulled back only
    // when sliding can't fit them, until everything that must be seen is in the picture.
    // (the bottom of the frame is 0.44 of its height below the principal point)
    const vlo = -0.4 / aspect, vhi = 0.5 / aspect;
    let lx = clamp((Math.min(...must.map((q) => q[0])) + Math.max(...must.map((q) => q[0]))) / 2, 10, RL - 10);
    for (let it = 0; it < 30; it++) {
      const cx0 = lx - dist * cp, cz = dist * sp;
      let v0 = 1e9, v1 = -1e9;
      for (const q of must) { const dx = q[0] - cx0, dz = q[2] - cz, d = dx * cp - dz * sp, up = dx * sp + dz * cp; v0 = Math.min(v0, up / d); v1 = Math.max(v1, up / d); }
      if (v1 - v0 > (vhi - vlo) * 0.92) { if (dist >= 170) break; dist = Math.min(170, dist * 1.08); continue; }
      if (v0 < vlo) lx -= 2; else if (v1 > vhi) lx += 2; else break;
    }
    return { lx: clamp(lx, 0, RL), ly, lz: 0, dist, pitch, fm: 1 };
  }
  // the whole sheet down its length: the same solve with the axes turned
  let sheetVFor = null, sheetV = null;
  function wholeSheetV(aspect) {
    if (sheetV && Math.abs(aspect - sheetVFor) < 1e-3) return sheetV;
    const pitch = 1.0, cp = Math.cos(pitch), sp = Math.sin(pitch), vlo = -0.42 / aspect, vhi = 0.42 / aspect;
    const must = [[-1, -1, 3.5], [RL + 1, -1, 3.5], [-1, RW + 1, 3.5], [RL + 1, RW + 1, 3.5]];
    let dist = 200, lx = RL / 2;
    for (let it = 0; it < 80; it++) {
      const cx0 = lx - dist * cp, cz = dist * sp;
      let um = 0, v0 = 1e9, v1 = -1e9;
      for (const q of must) { const dx = q[0] - cx0, dz = q[2] - cz, d = dx * cp - dz * sp, up = dx * sp + dz * cp; um = Math.max(um, Math.abs(q[1] - RW / 2) / d); v0 = Math.min(v0, up / d); v1 = Math.max(v1, up / d); }
      if (um > 0.47 || v1 - v0 > vhi - vlo) { dist *= 1.04; continue; }
      if (v0 < vlo) lx -= 2; else if (v1 > vhi) lx += 2; else break;
    }
    sheetVFor = aspect; sheetV = { lx, ly: RW / 2, lz: 0, dist, pitch, fm: 1 };
    return sheetV;
  }
  function broadcast(f, c, aspect) {
    const low = api.view === 'low';
    // the action, led toward where it's going
    const ax = f[0] + clamp(fv[0] * 0.75, -28, 28), ay = f[1] + clamp(fv[1] * 0.4, -9, 9);
    let x0 = Math.min(f[0], ax) - 7, x1 = Math.max(f[0], ax) + 7;
    // the net: the one a shot is going at, or the one whose zone the play is in
    let net = c.net != null ? c.net : null;
    if (net == null) for (const gx of GOAL_X) if (Math.abs(f[0] - gx) < 62) net = gx;
    // (the net, the goalie in front of it and a little of the ice behind)
    if (net != null) { x0 = Math.min(x0, net - 10); x1 = Math.max(x1, net + 10); }
    const hw = (x1 - x0) / 2, lx = (x0 + x1) / 2;
    // On the rail the camera sits at head height by the near glass, which can't see a puck
    // close in on the near side; when a shot is coming it rises to the broadcast framing for
    // it, and settles back to the rail afterwards.
    if (low && c.net == null) {
      // in a zone it widens its lens to take the net in rather than climbing
      const fm = clamp(38 * 0.5 / Math.max(1, hw), 0.55, 1);
      return { lx: clamp(lx, 24, RL - 24), ly: 39, lz: 0.4, dist: 38, pitch: 0.105, fm };
    }
    // Close, the way the old games framed it (closer still on a breakaway, `W.cam.drama`),
    // then solved: slid across the ice and pulled back only as far as it takes for every
    // point that must be seen (the action, and the net when it matters) to land inside the
    // picture, whatever shape the screen is.
    const must = [[f[0], f[1], 0], [ax, ay, 0]];
    if (net != null) must.push([net, 39.5, 4], [net, 45.5, 0], [net + (net < RL / 2 ? -4 : 4), 42.5, 0]);
    // (with a shot coming, the ice either side of the net too, where one that misses goes)
    if (c.net != null) must.push([c.net, 34, 1], [c.net, 51, 1]);
    let dist = clamp(2 * hw * 1.08, c.drama ? 38 : 44, 140);
    let ly = clamp((Math.min(ay, f[1]) + Math.max(ay, f[1])) / 2 * 0.6 + 16, 12, 52);
    const X = clamp(lx, 20, RL - 20), vlo = -0.36 / aspect, vhi = 0.46 / aspect;
    for (let it = 0; it < 14; it++) {
      const pitch = 0.54 - (dist - 44) * 0.0015, cp = Math.cos(pitch), sp = Math.sin(pitch), cy0 = ly - dist * cp, cz = dist * sp;
      let um = 0, v0 = 1e9, v1 = -1e9;
      for (const q of must) { const dy = q[1] - cy0, dz = q[2] - cz, d = dy * cp - dz * sp, up = dy * sp + dz * cp; um = Math.max(um, Math.abs(q[0] - X) / d); v0 = Math.min(v0, up / d); v1 = Math.max(v1, up / d); }
      if (um > 0.44 || v1 - v0 > (vhi - vlo) * 0.92) { if (dist >= 140) break; dist = Math.min(140, dist * 1.08); continue; }
      if (v0 < vlo) ly -= 2.5; else if (v1 > vhi) ly += 2.5; else break;
      ly = clamp(ly, 6, 60);
    }
    return { lx: X, ly, lz: 0, dist, pitch: 0.54 - (dist - 44) * 0.0015, fm: 1 };
  }
  // Solved like the broadcast framing: pulled back until the four corners of the sheet are
  // all inside the picture. Cached by the screen's shape, since nothing else moves it.
  let sheetFor = null, sheet = null;
  function wholeSheet(aspect) {
    if (sheet && Math.abs(aspect - sheetFor) < 1e-3) return sheet;
    const pitch = 0.66, cp = Math.cos(pitch), sp = Math.sin(pitch), vlo = -0.4 / aspect, vhi = 0.4 / aspect;
    const must = [[-1, -1, 0], [RL + 1, -1, 0], [-1, RW + 1, 3.5], [RL + 1, RW + 1, 3.5]];
    let dist = 150, ly = RW / 2;
    for (let it = 0; it < 60; it++) {
      const cy0 = ly - dist * cp, cz = dist * sp;
      let um = 0, v0 = 1e9, v1 = -1e9;
      for (const q of must) { const dy = q[1] - cy0, dz = q[2] - cz, d = dy * cp - dz * sp, up = dy * sp + dz * cp; um = Math.max(um, Math.abs(q[0] - RL / 2) / d); v0 = Math.min(v0, up / d); v1 = Math.max(v1, up / d); }
      if (um > 0.47 || v1 - v0 > vhi - vlo) { dist *= 1.04; continue; }
      if (v0 < vlo) ly -= 1.5; else if (v1 > vhi) ly += 1.5; else break;
    }
    sheetFor = aspect; sheet = { lx: RL / 2, ly, lz: 0, dist, pitch, fm: 1 };
    return sheet;
  }

  // Ease toward the framing and return this frame's camera for a w×h view:
  // C (eye, pitch, focal length in pixels, principal point) and P, the projection of a world
  // point to { x, y, s: pixels per foot, d: depth }, or null behind the near plane. `now` is
  // the real time in ms; without it the camera runs on the world's clock.
  api.update = (w, h, now) => {
    const clock = now != null ? now / 1000 : W.t;
    const dt = lastNow == null ? 0 : Math.min(0.1, Math.max(0, clock - lastNow)); lastNow = clock;
    const tg = target(dt, w / Math.max(1, h));
    // a camera starts on its framing, and a replay's starts again on each replay
    if (first || (snap && lastCut !== W.cam.cut)) {
      first = false; lastCut = W.cam.cut; Object.assign(cam, tg); for (const k of KEYS) vel[k].v = 0; fv = [0, 0];
    } else {
      // a shot coming tightens the pan, so the net is in frame before the puck is away
      const shot = W.cam.net != null;
      for (const k of KEYS) cam[k] = smooth(cam[k], tg[k], vel[k], k === 'lx' && shot ? 0.38 : TIME[k], dt, k === 'lx' ? 140 : k === 'dist' ? 60 : Infinity);
    }
    const yaw = api.view === 'vertical' ? 1 : 0, { fx, fy, rx, ry } = camAxes(yaw);
    // a change of view is a cut: the eye can't swing a quarter turn on springs
    if (yaw !== lastYaw) { lastYaw = yaw; Object.assign(cam, tg); for (const k of KEYS) vel[k].v = 0; }
    const back = cam.dist * Math.cos(cam.pitch);
    const C = { x: cam.lx - back * fx, y: cam.ly - back * fy, z: cam.lz + cam.dist * Math.sin(cam.pitch), pitch: cam.pitch, yaw, f: w * cam.fm, cx: w / 2, cy: h * 0.56, w, h };
    const cp = Math.cos(C.pitch), sp = Math.sin(C.pitch);
    const P = (X, Y, Z) => { const ex = X - C.x, ey = Y - C.y, dz = Z - C.z, dx = ex * rx + ey * ry, dy = ex * fx + ey * fy, d = dy * cp - dz * sp; if (d < NEAR) return null; const up = dy * sp + dz * cp; return { x: C.cx + C.f * dx / d, y: C.cy - C.f * up / d, s: C.f / d, d }; };
    return { C, P, camPos: [C.x, C.y, C.z] };
  };
  return api;
}

// The same camera as column-major 4×4 matrices for GL. Camera space is (right, up, depth):
//   right = X − Cx,  up = (Y − Cy)·sin p + (Z − Cz)·cos p,  depth = (Y − Cy)·cos p − (Z − Cz)·sin p
// and clip space puts `P`'s pixel equations in NDC, including the principal point sitting
// below the middle of the frame (cy = 0.56 h), which is a shift of y by a multiple of depth.
// `mirror` flips the world about the ice (z → −z) for the reflection pass.
export function matrices(C, mirror = false, near = NEAR, far = FAR) {
  const cp = Math.cos(C.pitch), sp = Math.sin(C.pitch), mz = mirror ? -1 : 1, { fx, fy, rx, ry } = camAxes(C.yaw);
  // view: rows are right, up, depth (world → camera), written column-major. A mirror only
  // negates the z column: the eye stays put and the world flips under it.
  // (along the ground, forward is the axis the camera looks down and right the one across)
  const tr = -(rx * C.x + ry * C.y), tf = -(fx * C.x + fy * C.y), tz = -C.z;
  const V = [
    rx, fx * sp, fx * cp, 0,
    ry, fy * sp, fy * cp, 0,
    0, cp * mz, -sp * mz, 0,
    tr, tf * sp + tz * cp, tf * cp - tz * sp, 1,
  ];
  const ax = 2 * C.f / C.w, ay = 2 * C.f / C.h, oy = 1 - 2 * C.cy / C.h;
  const A = (far + near) / (far - near), B = -2 * far * near / (far - near);
  // clip = (ax·right, ay·up + oy·depth, A·depth + B, depth)
  const Pm = [
    ax, 0, 0, 0,
    0, ay, 0, 0,
    0, oy, A, 1,
    0, 0, B, 0,
  ];
  return { view: V, proj: Pm, viewProj: mul(Pm, V) };
}

export function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}

// A world point through a column-major matrix to pixels, the way GL would draw it. The
// parity check in rink-smoke holds this to `P`.
export function project(m, x, y, z, w, h) {
  const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
  const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
  const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
  if (cw <= 0) return null;
  return { x: (cx / cw * 0.5 + 0.5) * w, y: (1 - (cy / cw * 0.5 + 0.5)) * h, d: cw };
}
