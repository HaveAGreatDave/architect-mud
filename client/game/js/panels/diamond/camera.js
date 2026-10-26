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
  // high home: balls in play, following the ball (`shotAt`)
  high: Object.freeze({ eye: [0, 74, -104], at: [0, 4, 185], fov: 42, shadow: [[0, 0, 140], 300] }),
  // the first-base camera on a play at first: from the well on the home side, inside the coach's
  // box so he isn't in the way, the bag, the last strides up the line and the base umpire beyond
  first: Object.freeze({ eye: [-50, 7.5, 18], at: [-66, 3.4, 67], fov: 30, dof: 640, shadow: [[-64, 0, 66], 34] }),
  // a long fly coming down, from behind the man under it: the director places it (`fly` specs)
  fly: Object.freeze({ eye: [0, 26, 400], at: [0, 5, 315], fov: 30, dof: 900, shadow: [[0, 0, 315], 60] }),
  // the first-base camera on a right-handed batter, and the third-base one on a left-hander, so
  // the camera has his face; the director cuts to it for his reaction and the umpire's call
  side: Object.freeze({ eye: [-66, 5.4, 26], at: [2.6, 3.7, -0.4], fov: 8.6, dof: 780, shadow: [[0, 0, 0], 40] }),
  sideL: Object.freeze({ eye: [66, 5.4, 26], at: [-2.6, 3.7, -0.4], fov: 8.6, dof: 780, shadow: [[0, 0, 0], 40] }),
  // the bag at second, low from the first-base side with a 16° lens: steals and pickoffs, and a
  // man sliding in there once the ball's back in
  bag: Object.freeze({ eye: [-26.5, 3.4, 154.6], at: [-1.4, 1.9, 126.2], fov: 16.5, dof: 520, shadow: [[0, 0, 127], 26] }),
  // third base from the camera well on that side, out toward second: a man coming in there
  third: Object.freeze({ eye: [74, 7, 20], at: [48, 2.2, 82], fov: 30, dof: 640, shadow: [[45, 0, 85], 42] }),
  // the plate from the well on the first-base side, the last strides from third coming in: a run
  plate: Object.freeze({ eye: [-46, 8, 14], at: [8, 2.6, 8], fov: 34, dof: 640, shadow: [[10, 0, 10], 36] }),
  // the plate and the backstop behind it from the well on the first-base side, wide: a pitch that
  // gets by, the catcher after it and a man coming home
  backstop: Object.freeze({ eye: [-52, 10, 16], at: [6, 1.5, -24], fov: 44, dof: 640, shadow: [[0, 0, -22], 42] }),
  // the third-base camera on the pitcher
  mound: Object.freeze({ eye: [64, 7, 33], at: [0, 4.4, 58.8], fov: 10.5, dof: 700, shadow: [[0, 0, 60], 35] }),
  // between at-bats (diamond/between.js): the on-deck circle on the third-base side from up the line
  // in front of its dugout, the hitter head to foot with the backstop behind him and nobody from the
  // plate in the way, and the same on the first-base side; a cutaway to the crowd behind the
  // first-base dugout from out on the field
  deck3: Object.freeze({ eye: [36, 5.5, 34], at: [31, 3.3, -9], fov: 13, dof: 420, shadow: [[31, 0, -9], 12] }),
  deck1: Object.freeze({ eye: [-36, 5.5, 34], at: [-31, 3.3, -9], fov: 13, dof: 420, shadow: [[-31, 0, -9], 12] }),
  crowd: Object.freeze({ eye: [-18, 7, 78], at: [-92, 19, 10], fov: 18, dof: 600, shadow: [[-60, 0, 30], 40] }),
  // the third-base camera on the pitcher off the back of the mound, rubbing up the ball
  rub: Object.freeze({ eye: [64, 7, 33], at: [0, 4.2, 70.4], fov: 11, dof: 700, shadow: [[0, 0, 70], 14] }),
  // the grounds crew dragging the infield in the middle of the fifth (diamond/crew.js), from up on
  // a riser in a well across the field, following them: the director places it (`crew` specs)
  crew: Object.freeze({ eye: [-56, 22, 14], at: [50, 3, 110], fov: 7, dof: 700, shadow: [[50, 0, 110], 24] }),
  // high behind home with the city beyond: back from a break and between innings, and the
  // fireworks over the outfield. ⚠ UNDER THE ROOF'S LINE AND IN FRONT OF THE DECK: the Coliseum's
  // shells spring from the decks behind the stands (gl/ballpark-mesh.js), and an eye up at 118 ft sat
  // on the shut roof's skin; any further back and it's inside the first-base deck. The lens is a
  // little wider than it was, because the shells over the outfield are nearer.
  sky: Object.freeze({ eye: [0, 100, -128], at: [-40, 128, 1200], fov: 56, shadow: [[0, 0, 140], 300] }),
  // the main gate from the crossing outside it, the crowd going in: before a game's first pitch. The
  // renderer stands it on its own venue's crossing (diamond/streets.js streetShot); this is where it
  // stands with no city round the park
  street: Object.freeze({ eye: [198, 6, -254], at: [120, 70, -120], fov: 54, shadow: [[150, 0, -170], 140] }),
  // a home run side on, riding beside the ball: the director places it (`homer` specs, shotAt)
  homer: Object.freeze({ eye: [-60, 40, 200], at: [0, 50, 220], fov: 38, dof: 160, shadow: [[0, 0, 240], 120] }),
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

// A shot that moves: `{ shot, track }` follows the ball's way (`track(t)`, a point, plays.js
// trackOf). The high camera turns toward it, less of the way while it's near the plate so a
// grounder keeps the infield in the picture, all the way to one behind the plate, and closes its
// lens on a ball far out; the camera
// behind a long fly (`{ shot: 'fly', eye, at }`) keeps the catch in the frame and tilts up
// toward the ball, `follow` of the way. The home-run camera (`{ shot: 'homer', side, dist,
// stop }`) rides `dist` feet out to `side` of the ball's way, rising with it, until `stop`, short
// of the wall, and from there watches it into the seats with its lens closing. The crew camera
// (`{ shot: 'crew', eye, frame, track }`) stays at `eye` and turns to follow the grounds crew,
// its lens taking in `frame` feet top to bottom where they are. Anything else is a camera by name
// or a shot as given, and comes back as it was. Pure in t, so the renderer and the graphics
// resolve the same picture.
export function shotAt(s, t) {
  if (!s || typeof s !== 'object' || typeof s.track !== 'function') return s;
  const base = SHOTS[s.shot] || SHOTS.high, q = s.track(t);
  if (s.shot === 'homer') {
    // the track is smoothed over a third of a second and runs behind the ball, so it looks a beat
    // ahead of it
    const r = s.track(Math.min(t, s.stop)) || q || base.at, at = s.track(t + 0.12) || q || r, side = s.side || [-1, 0, 0], d = s.dist || 60;
    const eye = [r[0] + side[0] * d, 7 + 0.55 * r[1], r[2] + side[2] * d];
    const far = Math.hypot(at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]);
    return { eye, at, fov: base.fov * Math.min(1, Math.max(0.5, Math.hypot(d, 0.45 * r[1]) / far)), dof: base.dof, shadow: [[r[0], 0, r[2]], 120] };
  }
  if (s.shot === 'crew') {
    const eye = s.eye || base.eye, at = q || base.at, far = Math.hypot(at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]);
    return { eye, at, fov: (2 * Math.atan((s.frame || 16) / 2 / far)) / DEG, dof: base.dof, shadow: [[at[0], 0, at[2]], 24] };
  }
  if (s.shot === 'fly') {
    const at = s.at || base.at, k = s.follow ?? 0.45;
    const to = q ? [at[0] + (q[0] - at[0]) * k * 0.4, at[1] + (Math.min(q[1], 90) - at[1]) * k, at[2] + (q[2] - at[2]) * k * 0.4] : at;
    return { eye: s.eye || base.eye, at: to, fov: s.fov || base.fov, dof: base.dof, shadow: [[at[0], 0, at[2]], 60] };
  }
  if (!q) return base;
  // out past the infield it turns to the ball; a pop-up near the plate it tilts up after, and one
  // coming down behind the plate it looks down after: framed for the field, a foul pop the catcher
  // takes 50 ft back fell out of the foot of the frame as it came down
  const out = Math.hypot(q[0], q[2]), up = Math.min(1, Math.max(0, (q[1] - 25) / 40)), back = Math.min(1, Math.max(0, -q[2] / 15));
  const w = Math.max(Math.min(1, Math.max(0, (out - 50) / 130)), up, back);
  const look = [q[0], q[1] * (0.35 + 0.6 * up), q[2]];
  const at = [base.at[0] + (look[0] - base.at[0]) * w, base.at[1] + (look[1] - base.at[1]) * w, base.at[2] + (look[2] - base.at[2]) * w];
  const far = Math.hypot(at[0] - base.eye[0], at[1] - base.eye[1], at[2] - base.eye[2]), near0 = Math.hypot(base.at[0] - base.eye[0], base.at[1] - base.eye[1], base.at[2] - base.eye[2]);
  return { eye: base.eye, at, fov: base.fov * Math.min(1, Math.max(0.55, near0 / far)), shadow: base.shadow };
}
// The cameras on a long lens in the wells and out in centre field, which an operator holds: drawn,
// they drift a little round their aim, about HANDHELD of the frame's half-height, on slow sines of
// their own. Drawing only (the view applies it, and not with reduced motion); the director, the
// graphics' framing checks and the gates read the shots as they stand.
export const HANDHELD = 0.008;
const HELD = new Set(['cf', 'side', 'sideL', 'first', 'third', 'plate', 'bag', 'mound', 'rub', 'deck1', 'deck3', 'crowd']);
export function handheld(s, t) {
  if (typeof s !== 'string' || !HELD.has(s)) return s;
  const shot = SHOTS[s], { r, u } = axes(shot);
  const d = Math.hypot(shot.at[0] - shot.eye[0], shot.at[1] - shot.eye[1], shot.at[2] - shot.eye[2]);
  const k = d * Math.tan(shot.fov * DEG / 2) * HANDHELD, ph = s.length * 1.37;
  const a = Math.sin(t * 0.83 + ph) * 0.6 + Math.sin(t * 2.11 + ph * 2.3) * 0.3 + Math.sin(t * 3.7 + ph * 0.7) * 0.1;
  const b = Math.sin(t * 0.67 + ph * 1.9) * 0.6 + Math.sin(t * 1.73 + ph * 0.4) * 0.3 + Math.sin(t * 4.3 + ph * 3.1) * 0.1;
  return { ...shot, at: [0, 1, 2].map((i) => shot.at[i] + (r[i] * a + u[i] * b) * k) };
}

// Whether a shot is one the director may cut to: a camera by name, or one that moves on one.
export const isShot = (s) => (typeof s === 'string' ? !!SHOTS[s] : !!(s && SHOTS[s.shot] && typeof s.track === 'function'));

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
