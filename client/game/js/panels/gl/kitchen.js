// GLASS 2 · THE KITCHEN STAGE. A counter in front of the stove, drawn by ROOM's renderer
// (gl/room.js, docs/proposals/kitchen-stage.md).
//
// The kitchen has no renderer of its own. It builds its set and its moving pieces with kitchen-mesh.js
// (arena-mesh.js batches, centimetres, z up) and this hands them to 'createRoomRenderer' as the room
// and its props, in the room's frame (metres, y up), lit by the room's lamps and inked by the room's
// house style. So the kitchen looks like the room you walked into, and changes when the room's look does.
//
// Frame: kitchen (x right, y away, z up, cm) to room (-x, z, y) / 100. That's a proper rotation, so the
// kitchen's pickers (pickPlane, toScreen) stay in the kitchen's own frame with its own matrices.
//
// ⚠ GLOSS RIDES IN THE VERTEX ALPHA (kitchen-mesh.js 'foodPiece'): 1 - gloss / 2. It becomes the
// room's GLOSS material here. The flames are drawn as they are (MAT 40, a light itself), the steel as METAL.
//
// 'createKitchenRenderer' returns null when there is no WebGL2, and the panel falls back to the HUD.

import { createRoomRenderer } from './room.js';
import { createBatch, MAT, STRIDE as RS } from './ballpark-mesh.js';
import { STRIDE as KS_STRIDE, COLOURS } from './kitchen-mesh.js';

const KEY = norm([-0.45, -0.55, 0.7]);    // from above, left, and towards the cook

// ── the camera, as pure maths (the panel picks with the same matrices) ───────────────────────────
// `cam` is { eye: [x,y,z], at: [x,y,z], fov (radians, vertical), roll (radians) }.
export function cameraMatrices(cam, aspect) {
  const f = norm(sub(cam.at, cam.eye));
  let up = [0, 0, 1];
  const r0 = norm(cross(f, up));
  const u0 = cross(r0, f);
  const cr = Math.cos(cam.roll || 0), sr = Math.sin(cam.roll || 0);
  const r = add(mul(r0, cr), mul(u0, sr)), u = add(mul(u0, cr), mul(r0, -sr));
  up = u;
  const view = [
    r[0], u[0], -f[0], 0,
    r[1], u[1], -f[1], 0,
    r[2], u[2], -f[2], 0,
    -dot(r, cam.eye), -dot(u, cam.eye), dot(f, cam.eye), 1,
  ];
  const near = 2, far = 600, t = 1 / Math.tan((cam.fov || 0.7) / 2);
  const proj = [
    t / aspect, 0, 0, 0,
    0, t, 0, 0,
    0, 0, (far + near) / (near - far), -1,
    0, 0, (2 * far * near) / (near - far), 0,
  ];
  return { vp: new Float32Array(mat4mul(proj, view)), r, u, f, t, aspect };
}
// Where a screen point (0..1 across, 0..1 down) meets the plane z = h. Null when the ray runs away
// from it.
export function pickPlane(cam, M, sx, sy, h = 0) {
  const nx = (sx * 2 - 1) * M.aspect / M.t, ny = (1 - sy * 2) / M.t;
  const d = norm(add(add(M.f, mul(M.r, nx)), mul(M.u, ny)));
  if (Math.abs(d[2]) < 1e-5) return null;
  const k = (h - cam.eye[2]) / d[2];
  if (k <= 0) return null;
  return add(cam.eye, mul(d, k));
}
// A world point to screen fractions, for labels on the overlay.
export function toScreen(M, p) {
  const v = M.vp, x = v[0] * p[0] + v[4] * p[1] + v[8] * p[2] + v[12], y = v[1] * p[0] + v[5] * p[1] + v[9] * p[2] + v[13];
  const w = v[3] * p[0] + v[7] * p[1] + v[11] * p[2] + v[15];
  if (w <= 0) return null;
  return [(x / w + 1) / 2, (1 - y / w) / 2];
}

// Where the kitchen stands in the room: its origin (the burner, on the worktop), its axes (x along the
// counter to the cook's right, y away from the cook, z up) as room directions, and how many room units
// a centimetre is. A proper rotation, so the kitchen's pickers keep working in the kitchen's own frame.
// FREE is the kitchen on a canvas of its own: metres, y up, the cook looking along +z.
export const FREE = Object.freeze({ o: [0, 0, 0], x: [-1, 0, 0], y: [0, 0, 1], z: [0, 1, 0], s: 0.01 });
const at = (F, p) => [F.o[0] + (F.x[0] * p[0] + F.y[0] * p[1] + F.z[0] * p[2]) * F.s, F.o[1] + (F.x[1] * p[0] + F.y[1] * p[1] + F.z[1] * p[2]) * F.s, F.o[2] + (F.x[2] * p[0] + F.y[2] * p[1] + F.z[2] * p[2]) * F.s];
const dirOf = (F, v) => [F.x[0] * v[0] + F.y[0] * v[1] + F.z[0] * v[2], F.x[1] * v[0] + F.y[1] * v[1] + F.z[1] * v[2], F.x[2] * v[0] + F.y[2] * v[1] + F.z[2] * v[2]];
const decode = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const same = (c, d, o) => Math.abs(c[0] - d[o]) < 0.004 && Math.abs(c[1] - d[o + 1]) < 0.004 && Math.abs(c[2] - d[o + 2]) < 0.004;
const METALS = ['steel', 'steelDark', 'grate', 'copper', 'iron', 'blade', 'bladeEdge'].map((k) => COLOURS[k]);
const FLAMES = [COLOURS.flameIn, COLOURS.flameOut];
// what gives off its own light: a microwave's inside while it runs, and its display
const GLOWS = [COLOURS.ovenLit, COLOURS.ovenLed];

// A kitchen batch (arena-mesh.js: pos, nor, rgba, uv, t) as a room batch (ballpark-mesh.js: pos, nor,
// uv, linear rgb, mat), moved into the room's frame. Appended from `out.n` when `append` is set.
export function toRoomBatch(src, out, F = FREE, append = false) {
  const n = src.n, d = src.data, n0 = append ? out.n : 0;
  if (out.data.length < (n0 + n) * RS) { const g = new Float32Array(Math.max((n0 + n) * RS, out.data.length * 2)); g.set(out.data.subarray(0, n0 * RS)); out.data = g; }
  const o = out.data, X = F.x, Y = F.y, Z = F.z, O = F.o, k = F.s;
  for (let i = 0; i < n; i++) {
    const s = i * KS_STRIDE, t = (n0 + i) * RS, px = d[s], py = d[s + 1], pz = d[s + 2], nx = d[s + 3], ny = d[s + 4], nz = d[s + 5];
    for (let j = 0; j < 3; j++) {
      o[t + j] = O[j] + (X[j] * px + Y[j] * py + Z[j] * pz) * k;
      o[t + 3 + j] = X[j] * nx + Y[j] * ny + Z[j] * nz;
    }
    o[t + 6] = 0; o[t + 7] = 0;
    o[t + 8] = decode(d[s + 6]); o[t + 9] = decode(d[s + 7]); o[t + 10] = decode(d[s + 8]);
    let m = MAT.GROUND;
    if (FLAMES.some((c) => same(c, d, s + 6)) || GLOWS.some((c) => same(c, d, s + 6))) m = 40;
    else if (METALS.some((c) => same(c, d, s + 6))) m = MAT.METAL;
    else if (d[s + 9] < 0.9) m = MAT.GLOSS;
    o[t + 11] = m;
  }
  out.n = n0 + n;
  return out;
}

// The kitchen's camera as the room's: an eye, a yaw and a pitch, and the lens in degrees.
export function roomCamOf(cam, shake = null, F = FREE) {
  const f = norm(dirOf(F, norm(sub(cam.at, cam.eye))));
  return { eye: at(F, cam.eye), yaw: Math.atan2(f[0], f[2]), pitch: Math.asin(Math.max(-1, Math.min(1, f[1]))), fov: (cam.fov || 0.7) * 180 / Math.PI, roll: cam.roll || 0, shake };
}

// The other way: the room's own eye ({ eye, yaw, pitch, fov in degrees }) as a kitchen camera, so the
// kitchen can pick with the picture the room draws while you walk about it (room-stage.js host.view).
// The exact inverse of roomCamOf, roll and shake aside.
export function kitchenCamOf(view, F = FREE) {
  const cp = Math.cos(view.pitch || 0), f = [Math.sin(view.yaw || 0) * cp, Math.sin(view.pitch || 0), Math.cos(view.yaw || 0) * cp];
  const d = sub(view.eye, F.o), eye = [dot(d, F.x) / F.s, dot(d, F.y) / F.s, dot(d, F.z) / F.s];
  const fk = [dot(f, F.x), dot(f, F.y), dot(f, F.z)];
  return { eye, at: add(eye, mul(fk, 100)), fov: ((view.fov || 72) * Math.PI) / 180, roll: 0 };
}

// The light on a canvas of its own: a warm key from above left and towards the cook (where the
// kitchen's always came from), and a cool fill from the right. In a room, the room's own light.
const LIGHT = {
  lamps: [
    { p: at(FREE, mul(KEY, 120)), k: 1.15 },
    { p: at(FREE, [90, -60, 70]), k: 0.45, tint: [0.62, 0.74, 1.15] },
  ],
  wins: [], lampOn: true, lampLevel: 1, day: 0.45, sky: [1, 0.94, 0.84], annex: null,
};

// `host`: cooking in the Room Stage. Nothing is drawn on `canvas` (it's left clear, for the pointer);
// the room draws the kitchen into the apartment through its own renderer, from what `host.show`
// is handed every frame: the camera, and the kitchen's pieces as the room's props. host is
// { frame (as FREE), canvas (the room's), show({ cam, props } | null) }.
export function createKitchenRenderer(canvas, { phone = false, host = null } = {}) {
  if (host) return hosted(canvas, host);
  const R = createRoomRenderer(canvas, { phone });
  if (!R) return null;
  const empty = () => createBatch(4);
  const dyn = createBatch(1 << 14);
  return {
    get lost() { return R.lost; },
    setStatic(batch) {
      R.setRoom({ solid: toRoomBatch(batch, createBatch(Math.max(4, batch.n))), screen: empty(), glass: empty(), view: empty(), textured: new Map() }, () => null);
    },
    // One frame. 'batch' is this frame's moving geometry; 'fx' is { shake: [x, y], flash 0..1 }.
    // Returns the kitchen-frame matrices the panel picks with.
    render(cam, batch, fx = {}) {
      R.setProps(toRoomBatch(batch, dyn));
      if (!R.render(roomCamOf(cam, fx.shake), LIGHT)) return null;
      flashOn(canvas, fx.flash);
      return cameraMatrices(cam, (canvas.width || 1) / (canvas.height || 1));
    },
    dispose() { R.dispose(); },
  };
}

function hosted(canvas, host) {
  const F = host.frame, stat = createBatch(4), props = createBatch(1 << 15);
  let lost = false;
  return {
    get lost() { return lost; },
    setStatic(batch) { toRoomBatch(batch, stat, F); },
    // `fx.free`: you're on your own feet, so the room draws from your own eye (no camera handed over)
    // and `cam` is that eye already, for picking
    render(cam, batch, fx = {}) {
      copyInto(props, stat);
      toRoomBatch(batch, props, F, true);
      if (host.show({ cam: fx.free ? null : roomCamOf(cam, fx.shake, F), props }) === false) { lost = true; return null; }
      flashOn(host.canvas, fx.flash);
      const c = host.canvas;
      return cameraMatrices(cam, (c.clientWidth || 1) / (c.clientHeight || 1));
    },
    dispose() { flashOn(host.canvas, 0); host.show(null); },
  };
}
function copyInto(dst, src) {
  if (dst.data.length < src.n * RS) dst.data = new Float32Array(Math.max(src.n * RS, dst.data.length * 2));
  dst.data.set(src.data.subarray(0, src.n * RS));
  dst.n = src.n;
}
function flashOn(canvas, k) {
  const flash = Math.max(0, Math.min(1, k || 0)), want = flash > 0 ? 'invert(' + flash + ')' : '';
  if (canvas.style.filter !== want) canvas.style.filter = want;
}

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function mul(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
// column-major a * b
function mat4mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}
