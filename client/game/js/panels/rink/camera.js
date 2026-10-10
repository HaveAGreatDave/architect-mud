// Rinkside · the broadcast camera, shared by both renderers (render.js on a 2-D canvas,
// gl/arena.js on GLASS 2), so a shot is framed the same whichever one draws it.
//
// THE CAMERA NEVER YAWS OR ROLLS. It pans, climbs, tilts and zooms. On the 2-D path that is
// what makes the ice one drawImage per screen row; on GL it keeps the view matrix a pan and
// a pitch, which `matrices()` writes out by hand so it can be read against `P` line for line.
//
// Modes come from the director (`W.cam.mode`); `view = 'low'` puts the default and Zamboni
// framings on the rail just inside the near glass, where the reflections show best. A cut
// (`W.cam.cut` changing) snaps; otherwise the camera eases toward where its mode wants it.

import { clamp } from './util.js';
import { RL, RW } from './geo.js';

export const NEAR = 0.6, FAR = 600;

export function createRinkCamera(W) {
  const cam = { lx: 100, ly: 40, lz: 0, dist: 72, pitch: 0.48, fm: 1 };
  const api = { view: 'broadcast', cam, flash: 0 };
  let lastCut = -1, lastT = 0;

  function target() {
    const c = W.cam, f = c.focus;
    switch (c.mode) {
      case 'fight': return { lx: f[0], ly: f[1], lz: 3.0, dist: 17.5, pitch: 0.1, fm: 0.95 };
      case 'zoom': return { lx: f[0], ly: f[1] - 2, lz: 1.5, dist: 44, pitch: 0.36, fm: 1 };
      case 'push': return { lx: f[0], ly: f[1], lz: 2.0, dist: 30, pitch: 0.3, fm: 1 };
      case 'zam':
        if (api.view === 'low') return { lx: clamp(f[0], 30, RL - 30), ly: 39, lz: 0.4, dist: 38, pitch: 0.105, fm: 1 };
        return { lx: clamp(f[0], 50, RL - 50), ly: clamp(f[1] * 0.45 + 22, 28, 46), lz: 0, dist: 64, pitch: 0.46, fm: 1 };
      case 'death': return { lx: clamp(f[0], 44, RL - 44), ly: clamp(f[1], 14, RW - 6), lz: 0.8, dist: 28 - Math.min(8, (W.t - (c.since || W.t)) * 0.6), pitch: 0.42, fm: 1 };
      default:
        // the rail camera sits just inside the near glass at head height, looking across
        if (api.view === 'low') return { lx: clamp(f[0], 30, RL - 30), ly: 39, lz: 0.4, dist: 38, pitch: 0.105, fm: 1 };
        return { lx: clamp(f[0], 52, RL - 52), ly: clamp(f[1] * 0.45 + 22, 28, 48), lz: 0, dist: 68, pitch: 0.48, fm: 1 };
    }
  }

  // Ease toward the mode (or snap on a cut) and return this frame's camera for a w×h view:
  // C (eye, pitch, focal length in pixels, principal point) and P, the projection of a world
  // point to { x, y, s: pixels per foot, d: depth }, or null behind the near plane.
  api.update = (w, h) => {
    const tg = target();
    const dt = Math.min(0.05, Math.max(0, W.t - lastT)); lastT = W.t;
    if (lastCut !== W.cam.cut) { lastCut = W.cam.cut; Object.assign(cam, tg); api.flash = W.cam.flash === false ? 0 : 1; }
    else for (const k of Object.keys(tg)) cam[k] += (tg[k] - cam[k]) * (1 - Math.exp(-dt * (k === 'lx' ? 2.8 : 2.2)));
    const C = { x: cam.lx, y: cam.ly - cam.dist * Math.cos(cam.pitch), z: cam.lz + cam.dist * Math.sin(cam.pitch), pitch: cam.pitch, f: w * cam.fm, cx: w / 2, cy: h * 0.56, w, h };
    const cp = Math.cos(C.pitch), sp = Math.sin(C.pitch);
    const P = (X, Y, Z) => { const dx = X - C.x, dy = Y - C.y, dz = Z - C.z, d = dy * cp - dz * sp; if (d < NEAR) return null; const up = dy * sp + dz * cp; return { x: C.cx + C.f * dx / d, y: C.cy - C.f * up / d, s: C.f / d, d }; };
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
  const cp = Math.cos(C.pitch), sp = Math.sin(C.pitch), mz = mirror ? -1 : 1;
  // view: rows are right, up, depth (world → camera), written column-major. A mirror only
  // negates the z column: the eye stays put and the world flips under it.
  const tx = -C.x, ty = -C.y, tz = -C.z;
  const V = [
    1, 0, 0, 0,
    0, sp, cp, 0,
    0, cp * mz, -sp * mz, 0,
    tx, ty * sp + tz * cp, ty * cp - tz * sp, 1,
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
