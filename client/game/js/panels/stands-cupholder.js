// Stands cupholder: the cupholder on your seat's armrest, in 3-D, at the end of the armrest on your
// right. It belongs to the seat, not the camera: it sits where it is in the park or the rink and you
// turn your head to it, down and to the right. Clicking it opens the concessions (plugins/stands
// `stands order`): food, drinks, cigarettes and cigars, paid for, and a runner brings what you buy.
//
// It's drawn with the hands' little renderer (stands-hands-gl.js) on its own canvas under theirs, so
// the rink and the park know nothing about it. Each frame it reads the seat (stands.js `seat`: the
// eye, the heading and the lens the view itself turns) and puts the holder through the same camera
// the view draws with, so it holds still against the seats round it:
//   hockey  the sheet's feet, z up; yaw from +Y toward +X, pitch down positive, `fov` across the
//           picture (rink/camera.js seatFrame)
//   park    the field's feet, y up; yaw from +z toward +x, pitch up positive, `fov` up the picture,
//           narrowed on a wide screen (diamond/camera.js shotOf/fovFor). The park moves the eye onto
//           a fan's seat, and writes the eye it used back as `seat.eyeAt` (gameday-grandstand.js).
// A clear button is laid over wherever it's drawn, for the click, the hover and the keyboard; it's
// hidden while the holder is off the picture. With no WebGL the button is a plain one in the corner.

import { createGl, lathe, rprism, tube, M, T, apply } from './stands-hands-gl.js';
import { fovFor } from './diamond/camera.js';

// the seat's vinyl and the holder's plastic, by sport: the Coliseum's red seats, the Gardens' blue
const LOOK = {
  baseball: { pad: '#6a1c24', arm: '#2a2a2e', holder: '#17181b', lip: '#c9c4b8' },
  hockey: { pad: '#1d3a63', arm: '#2a2c31', holder: '#141518', lip: '#c7ccd4' },
};
// where the holder is from your eye, in feet along the seat: to your right, forward of you, and down
// at the armrest's height
const OFF = { right: 0.85, fwd: 1.2, down: 1.2 };
const CM = 30.48, RIM = 5.2;

// the way a seat faces: at the middle of the ice, or the middle of the infield
const FACE = { hockey: [100, 42.5], baseball: [0, 120] };

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// The seat's camera as world axes (r, u, f), its eye, and the tangent of half its vertical angle.
function cameraOf(sport, seat, w, h) {
  const a = seat.yaw || 0, p = seat.pitch || 0, cp = Math.cos(p), sp = Math.sin(p);
  if (sport === 'hockey') {
    const fx = Math.sin(a), fy = Math.cos(a);
    const hf = Math.max(15, Math.min(100, seat.fov || 64)) * Math.PI / 180;
    return { eye: seat.eye, r: [fy, -fx, 0], u: [fx * sp, fy * sp, cp], f: [fx * cp, fy * cp, -sp], tanV: Math.tan(hf / 2) * h / w };
  }
  const f = [Math.sin(a) * cp, sp, Math.cos(a) * cp], r = norm(cross(f, [0, 1, 0])), u = cross(r, f);
  const fov = fovFor(Math.max(12, Math.min(90, seat.fov || 50)), w / h);
  return { eye: seat.eyeAt || seat.eye, r, u, f, tanV: Math.tan(fov * Math.PI / 360) };
}

// The seat's own frame in the world: right, up and forward along the ground, toward the play.
function bodyOf(sport, eye) {
  const [cx, cz] = FACE[sport] || FACE.baseball;
  if (sport === 'hockey') {
    const F = norm([cx - eye[0], cz - eye[1], 0]);
    return { R: [F[1], -F[0], 0], U: [0, 0, 1], F };
  }
  const F = norm([cx - eye[0], 0, cz - eye[2]]);
  return { R: norm(cross(F, [0, 1, 0])), U: [0, 1, 0], F };
}

export function createCupholder(root, host, { sport = 'baseball', seat, onOpen } = {}) {
  const look = LOOK[sport] || LOOK.baseball;
  const cg = document.createElement('canvas');
  cg.className = 'st-cupholder';
  cg.setAttribute('aria-hidden', 'true');
  let g3 = null;
  try { g3 = createGl(cg); } catch (err) { console.warn('[stands] no 3-D for the cupholder:', err); }
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'st-cupholder-btn';
  btn.setAttribute('aria-label', 'Cupholder: order food, drinks and smokes');
  btn.title = 'Cupholder: food, drinks, cigarettes and cigars';
  if (!g3 || !seat) { btn.classList.add('st-cupholder-flat'); btn.textContent = 'Concessions'; }
  btn.addEventListener('pointerdown', (e) => e.stopPropagation());
  btn.addEventListener('click', () => onOpen?.());
  root.append(cg, btn);

  // ── the model, in the holder's own frame and in cm: x to your right, y up, z back toward you, the
  // rim's top at y 0 ─────────────────────────────────────────────────────────────────────────────
  // The holder: a deep plastic cup with a rolled lip, its well open to the light.
  const shell = () => lathe([[0, -7.2], [3.7, -7.2], [4.3, -6.8], [4.9, -0.6], [RIM, 0], [4.75, 0.25], [4.35, -0.2], [3.55, -6.2], [0, -6.2]], 40);
  const lip = () => tube(Array.from({ length: 41 }, (_, k) => { const t = (k / 40) * Math.PI * 2; return [Math.cos(t) * (RIM - 0.15), 0.05, Math.sin(t) * (RIM - 0.15), 0.32]; }), 8);
  // the bracket that bolts it to the armrest, and the bolts
  const bracket = () => rprism(4.2, 5, -2.6, -0.6, 0.8);
  const bolt = () => lathe([[0, 0], [0.55, 0], [0.55, 0.25], [0.35, 0.45], [0, 0.48]], 12);
  // the armrest: a padded vinyl top on a steel arm, running back from the holder past your hip
  const pad = () => rprism(7.5, 58, -2.4, 0, 2.6);
  const arm = () => rprism(4.5, 54, -9, -2.4, 0.9);
  const drain = () => lathe([[0, -6.15], [0.9, -6.15], [0.9, -6.1], [0, -6.1]], 16, { smooth: false });

  let W = 0, H = 0, hot = false, raf = 0, stopped = false, lastKey = '';
  const fit = () => {
    const w = host.offsetWidth, h = host.offsetHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
    cg.style.top = `${host.offsetTop}px`; cg.style.width = `${w}px`; cg.style.height = `${h}px`;
    if (w !== W || h !== H || cg.width !== Math.round(w * dpr)) { W = w; H = h; cg.width = Math.round(w * dpr); cg.height = Math.round(h * dpr); lastKey = ''; }
  };

  function frame() {
    raf = stopped ? 0 : requestAnimationFrame(frame);
    draw();
  }
  function draw() {
    if (!g3 || !seat?.eye) return;
    fit();
    if (!W || !H) return;
    const cam = cameraOf(sport, seat, W, H);
    // only drawn again when the head, the lens, the picture or the hover changed
    const key = `${cam.eye}|${seat.yaw?.toFixed(4)}|${seat.pitch?.toFixed(4)}|${cam.tanV.toFixed(4)}|${W}x${H}|${hot}`;
    if (key === lastKey) return;
    lastKey = key;
    const B = bodyOf(sport, cam.eye);
    const at = [0, 1, 2].map((i) => cam.eye[i] + B.R[i] * OFF.right + B.F[i] * OFF.fwd - B.U[i] * OFF.down);
    // a world direction or offset, in feet, as the GL camera's cm (it looks down -Z)
    const toCam = (v) => [dot(v, cam.r) * CM, dot(v, cam.u) * CM, -dot(v, cam.f) * CM];
    const X = toCam(B.R), Y = toCam(B.U), Z = toCam(B.F.map((v) => -v)), O = toCam(sub(at, cam.eye));
    const base = new Float32Array([X[0] / CM, X[1] / CM, X[2] / CM, 0, Y[0] / CM, Y[1] / CM, Y[2] / CM, 0, Z[0] / CM, Z[1] / CM, Z[2] / CM, 0, O[0], O[1], O[2], 1]);
    g3.begin(W, H, cam.tanV);
    const glow = hot ? [0.22, 0.17, 0.06] : [0, 0, 0];
    g3.draw(g3.mesh('cup-pad', pad), M(base, T(7.2, -1.6, 22)), { color: look.pad, spec: 30, noise: 0.05 });
    g3.draw(g3.mesh('cup-arm', arm), M(base, T(7.2, -1.6, 23)), { color: look.arm, metal: 0.6, spec: 40, brush: 0.15 });
    g3.draw(g3.mesh('cup-bracket', bracket), M(base, T(4.6, 0, 0)), { color: look.holder, spec: 20 });
    for (const z of [-1.4, 1.4]) g3.draw(g3.mesh('cup-bolt', bolt), M(base, T(5.4, -0.6, z)), { color: '#9a9ea6', metal: 0.85, spec: 60 });
    g3.draw(g3.mesh('cup-shell', shell), base, { color: look.holder, spec: 26, noise: 0.06, emit: glow.map((v) => v * 0.4) });
    g3.draw(g3.mesh('cup-drain', drain), base, { color: '#050505', spec: 4 });
    g3.draw(g3.mesh('cup-lip', lip), base, { color: look.lip, metal: 0.7, spec: 70, emit: glow });
    g3.end();
    // the button over where the holder is drawn, or hidden while it's off the picture
    const c = apply(base, [0, -2, 0]);
    const on = -c[2] > 2;
    const p = on ? g3.project(c) : null;
    const r = p ? Math.max(22, p[2] * (RIM + 1.6)) : 0;
    const shown = !!p && p[0] > -r && p[0] < W + r && p[1] > -r && p[1] < H + r;
    btn.hidden = !shown;
    if (shown) {
      btn.style.left = `${p[0] - r}px`; btn.style.top = `${host.offsetTop + p[1] - r}px`;
      btn.style.width = `${r * 2}px`; btn.style.height = `${r * 2}px`;
    }
  }
  btn.addEventListener('pointerenter', () => { hot = true; });
  btn.addEventListener('pointerleave', () => { hot = false; });
  btn.addEventListener('focus', () => { hot = true; });
  btn.addEventListener('blur', () => { hot = false; });
  if (g3 && seat) raf = requestAnimationFrame(frame);

  return {
    // one frame now, whatever the loop is doing (a page in the background has its frames held)
    draw() { lastKey = ''; draw(); },
    stop() { stopped = true; if (raf) cancelAnimationFrame(raf); cg.remove(); btn.remove(); },
  };
}
