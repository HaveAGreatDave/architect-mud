/**
 * DEADBALL — the cameras.
 *
 * The broadcast's shots of the park (docs/proposals/deadball-glass2.md, Cameras), each an eye,
 * a point it looks at and a vertical lens in degrees, in the field's frame (diamond/geo.js:
 * feet, home plate at the origin, +z to centre field, +x toward third, y up). The camera
 * never rolls: every view is built against the world's up.
 *
 * Two ways to the screen, kept apart on purpose:
 *
 *   shotMatrices  the GL matrices gl/ballpark.js draws with (column-major, WebGL's clip space)
 *   project       the same pinhole worked out from the camera's own axes, no matrices
 *
 * ballpark-smoke.mjs holds the two together to a hundredth of a pixel, the arena-smoke
 * pattern, so a mistake in the matrices can't frame a shot differently from what the
 * director thinks it framed. The director (Phase 2) frames with `project`.
 *
 * Pure: no DOM and no GL.
 */

import { DEG } from './geo.js';

// The shots. `near` defaults by lens: a long lens starts its depth range far out. `dof` is how
// strongly the lens blurs what's off its focus, which is what it looks at (0, everything sharp);
// `shadow` is the sphere, a centre and a radius in feet, the towers' shadow maps are fitted to.
export const SHOTS = Object.freeze({
  // every pitch: behind and above the plate, the pitcher and the park beyond. It keeps its
  // whole height on a wide screen (`fit: 'v'`), so the plate stays at the foot of the frame.
  bat: Object.freeze({ eye: [0, 13, -25], at: [0, 2.6, 45], fov: 40, fit: 'v', shadow: [[0, 0, 30], 70] }),
  // the long lens from centre field, offset to left-centre: replays, and every pitch when the
  // batting view is off. The crowd behind the plate goes soft, as a broadcast long lens has it.
  cf: Object.freeze({ eye: [42, 62, 445], at: [0.3, 3.9, 2.5], fov: 3.7, dof: 12000, shadow: [[0, 0, 30], 75] }),
  // high home: balls in play
  high: Object.freeze({ eye: [0, 74, -104], at: [0, 4, 185], fov: 42, shadow: [[0, 0, 140], 300] }),
  // the first-base camera on a right-handed batter, and the third-base one on a left-hander, so
  // the camera has his face; the director cuts to it for his reaction and the umpire's call
  side: Object.freeze({ eye: [-66, 5.4, 26], at: [2.6, 3.7, -0.4], fov: 8.6, dof: 780, shadow: [[0, 0, 0], 40] }),
  sideL: Object.freeze({ eye: [66, 5.4, 26], at: [-2.6, 3.7, -0.4], fov: 8.6, dof: 780, shadow: [[0, 0, 0], 40] }),
  // the bag at second, low from the first-base side with a 16° lens: steals and pickoffs
  bag: Object.freeze({ eye: [-26.5, 3.4, 154.6], at: [-1.4, 1.9, 126.2], fov: 16.5, dof: 520, shadow: [[0, 0, 127], 26] }),
  // the third-base camera on the pitcher
  mound: Object.freeze({ eye: [64, 7, 33], at: [0, 4.4, 58.8], fov: 10.5, dof: 700, shadow: [[0, 0, 60], 35] }),
  // high behind home with the city beyond: back from a break and between innings
  sky: Object.freeze({ eye: [0, 118, -176], at: [-40, 130, 1200], fov: 50, shadow: [[0, 0, 140], 300] }),
});
export const FAR = 40000;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// The shots are framed for a 4:3 screen. A wider one shows more on either side but not all
// of its width: the vertical lens closes by the square root of how much wider it is, so a
// long lens on the TV's letterbox stays on its subject. A shot with `fit: 'v'` keeps its
// height and shows the whole width instead.
export const DESIGN_ASPECT = 4 / 3;
export function fovFor(fov, aspect, fit) {
  if (fit === 'v' || !(aspect > DESIGN_ASPECT)) return fov;
  return 2 * Math.atan(Math.tan(fov * DEG / 2) / Math.sqrt(aspect / DESIGN_ASPECT)) / DEG;
}

// A shot by name or as given, with its depth range filled in and its lens fitted to the screen.
export function shotOf(s, aspect = DESIGN_ASPECT) {
  const shot = typeof s === 'string' ? SHOTS[s] || SHOTS.bat : s || SHOTS.bat;
  return { eye: shot.eye, at: shot.at, fov: fovFor(shot.fov, aspect, shot.fit), near: shot.near ?? (shot.fov < 10 ? 40 : 1), far: shot.far ?? FAR,
    dof: shot.dof || 0, shadow: shot.shadow || null };
}

// The camera's own axes: right, up and forward (toward what it looks at).
export function axes(shot) {
  const f = norm(sub(shot.at, shot.eye)), r = norm(cross(f, [0, 1, 0])), u = cross(r, f);
  return { r, u, f };
}

// The matrices are plain arrays of doubles, column-major. WebGL rounds them to floats on
// upload; kept as doubles here, the gate can hold them to the pinhole exactly.
export function perspective(fov, aspect, near, far) {
  const t = 1 / Math.tan(fov * DEG / 2), nf = 1 / (near - far);
  return [t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
}
export function lookAt(e, c) {
  const { r: x, u: y, f } = axes({ eye: e, at: c }), z = [-f[0], -f[1], -f[2]];
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1];
}
export function mul4(a, b) {
  const o = new Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
    o[i * 4 + j] = s;
  }
  return o;
}
export function inv4(a) {
  const o = new Array(16);
  const b00 = a[0] * a[5] - a[1] * a[4], b01 = a[0] * a[6] - a[2] * a[4], b02 = a[0] * a[7] - a[3] * a[4], b03 = a[1] * a[6] - a[2] * a[5];
  const b04 = a[1] * a[7] - a[3] * a[5], b05 = a[2] * a[7] - a[3] * a[6], b06 = a[8] * a[13] - a[9] * a[12], b07 = a[8] * a[14] - a[10] * a[12];
  const b08 = a[8] * a[15] - a[11] * a[12], b09 = a[9] * a[14] - a[10] * a[13], b10 = a[9] * a[15] - a[11] * a[13], b11 = a[10] * a[15] - a[11] * a[14];
  const det = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
  o[0] = (a[5] * b11 - a[6] * b10 + a[7] * b09) * det; o[1] = (a[2] * b10 - a[1] * b11 - a[3] * b09) * det;
  o[2] = (a[13] * b05 - a[14] * b04 + a[15] * b03) * det; o[3] = (a[10] * b04 - a[9] * b05 - a[11] * b03) * det;
  o[4] = (a[6] * b08 - a[4] * b11 - a[7] * b07) * det; o[5] = (a[0] * b11 - a[2] * b08 + a[3] * b07) * det;
  o[6] = (a[14] * b02 - a[12] * b05 - a[15] * b01) * det; o[7] = (a[8] * b05 - a[10] * b02 + a[11] * b01) * det;
  o[8] = (a[4] * b10 - a[5] * b08 + a[7] * b06) * det; o[9] = (a[1] * b08 - a[0] * b10 - a[3] * b06) * det;
  o[10] = (a[12] * b04 - a[13] * b02 + a[15] * b00) * det; o[11] = (a[9] * b02 - a[8] * b04 - a[11] * b00) * det;
  o[12] = (a[5] * b07 - a[4] * b09 - a[6] * b06) * det; o[13] = (a[0] * b09 - a[1] * b07 + a[2] * b06) * det;
  o[14] = (a[13] * b01 - a[12] * b03 - a[14] * b00) * det; o[15] = (a[8] * b03 - a[9] * b01 + a[10] * b00) * det;
  return o;
}

// The GL matrices for a shot on a screen of this aspect.
export function shotMatrices(s, aspect) {
  const shot = shotOf(s, aspect);
  const view = lookAt(shot.eye, shot.at), proj = perspective(shot.fov, aspect, shot.near, shot.far);
  return { ...shot, view, proj, viewProj: mul4(proj, view) };
}

// Where a point lands on a w×h screen (y down), from the camera's axes alone: { x, y, d }
// with d the depth along the view, or null at or behind the near plane.
export function project(s, w, h, p) {
  const shot = shotOf(s, w / h), { r, u, f } = axes(shot), q = sub(p, shot.eye);
  const d = dot(q, f);
  if (d <= shot.near) return null;
  const k = (h / 2) / Math.tan(shot.fov * DEG / 2);
  return { x: w / 2 + dot(q, r) / d * k, y: h / 2 - dot(q, u) / d * k, d };
}

// The same through a GL view-projection matrix, the way the GPU does it.
export function projectGL(m, w, h, p) {
  const [x, y, z] = p;
  const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
  if (!(cw > 0)) return null;
  const cx = m[0] * x + m[4] * y + m[8] * z + m[12], cy = m[1] * x + m[5] * y + m[9] * z + m[13], cz = m[2] * x + m[6] * y + m[10] * z + m[14];
  return { x: (cx / cw + 1) / 2 * w, y: (1 - cy / cw) / 2 * h, d: cw, z: cz / cw };
}
