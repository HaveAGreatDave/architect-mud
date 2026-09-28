// THE COCKPIT KIT: the parts that made the Drake's cockpit read as a real one, for every other seat.
//
// interior-kit.js is the primitive layer (boxes, rods, panels, dials, digits). This is the layer
// above it: the things a cockpit needs to feel HANDLED rather than modelled —
//   · panels turned square to the pilot's eye, so a gauge reads without leaning (facingPanel)
//   · switches that move instead of snapping, and press pulses (eased, pressPulse)
//   · push-buttons that bulge out of a gap in their bezel and dip when pressed (domeButton)
//   · soft contact shadows under whatever stands on a surface (contactShadow)
//   · a halo round the control under the pointer, and a flash when it is pressed (hotspotHalo)
//
// ⚠ A COCKPIT'S CLICKABLE CONTROLS ARE A LIST OF { id, p, r, kind }: `p` in shell metres, `r` the
// hit radius, `kind` 'click' | 'yoke' | 'throttle' | 'trim' | 'rudder'. A profile that exposes
// `hotspots(live)` gets clicking, dragging, the hand cursor and the halo for free (windshield.js
// projects the list, cockpit.js hit-tests it). The Drake's interior-drake.js is the first user of
// the pattern and still carries its own copies of these; new cockpits come here.
import { PANE, clamp } from './interior-kit.js';

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const TAU = Math.PI * 2;

// ── Translucent colours (by identity: PANE is keyed on the array object) ─────
export const SHADE = [0, 0, 1];            // a soft contact shadow, stacked where it is deepest
PANE.set(SHADE, 0.16);
export const HALO = [255, 214, 121], HALO_PRESS = [255, 244, 201], HALO_RIM = [255, 250, 226];
PANE.set(HALO, 0.6); PANE.set(HALO_PRESS, 0.9); PANE.set(HALO_RIM, 0.95);

// A panel at `o` (shell metres, the eye at the origin) whose face is turned square to the eye.
export function facingPanel(K, o, tone = 'dash', k = 0.25) {
  const n = norm(mul(o, -1));
  const r = norm([-n[1], n[0], 0]);
  const u = cross(n, r);
  return K.panel(o, r, u[2] < 0 ? mul(u, -1) : u, tone, k);
}

// ── Motion ───────────────────────────────────────────────────────────────────
// One eased value per control id, stepped by wall time. The fit-outs are pure functions of the live
// state, so the motion lives here. Ids are namespaced by the caller ('mayfly:master').
const ANIM = new Map();
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
export function eased(id, target, rate = 16) {
  const t = nowMs();
  let a = ANIM.get(id);
  if (!a) { a = { v: target, t }; ANIM.set(id, a); return target; }
  const dt = Math.min(0.1, Math.max(0, (t - a.t) / 1000));
  a.t = t;
  a.v += (target - a.v) * (1 - Math.exp(-rate * dt));
  return a.v;
}
// 0 at rest, rising to 1 and back over 240 ms after the watched state changes.
const PULSE = new Map();
export function pressPulse(id, state) {
  const t = nowMs(), p = PULSE.get(id);
  if (!p) { PULSE.set(id, { s: state, t: -1e9 }); return 0; }
  if (p.s !== state) { p.s = state; p.t = t; }
  const x = (t - p.t) / 240;
  return x >= 1 || x < 0 ? 0 : Math.sin(x * Math.PI);
}

// ── A domed push-button ──────────────────────────────────────────────────────
// A short skirt out of a dark gap in its bezel, then a cap whose facets each carry their own normal,
// so the light rolls over it; a soft shadow below-right, and a glint up on the crown. `top` is the
// apex's height off the panel; `pressed` sinks it 4 mm.
export function domeButton(K, Sp, u, v, top, r, rgb, emis = 0, pressed = false) {
  const t = top - (pressed ? 0.004 : 0), cap = r * 0.55, seg = 16, rings = 4;
  Sp.disc(u, v, r * 1.18, [18, 12, 8], 0, 0.0040, seg);
  const sOff = Math.max(0.001, t - 0.004) * 0.35;
  Sp.disc(u + sOff, v - sOff * 1.2, r * 1.12, SHADE, 1, 0.0042, seg);
  Sp.disc(u + sOff * 0.5, v - sOff * 0.6, r * 1.02, SHADE, 1, 0.0043, seg);
  K.rod(Sp.pt(u, v, 0.0045), Sp.pt(u, v, t - cap), r, 'dash', 0.25, rgb.map((c) => c * 0.8), emis * 0.7, seg, false);
  const P = (rad, a, z) => Sp.pt(u + Math.cos(a) * rad, v + Math.sin(a) * rad, z);
  for (let i = 0; i < rings; i++) {
    const f0 = (i / rings) * Math.PI / 2, f1 = ((i + 1) / rings) * Math.PI / 2, fm = (f0 + f1) / 2;
    const r0 = r * Math.cos(f0), r1 = r * Math.cos(f1), z0 = t - cap + cap * Math.sin(f0), z1 = t - cap + cap * Math.sin(f1);
    const col = rgb.map((c) => Math.min(255, c * (0.82 + 0.28 * Math.sin(fm))));
    for (let j = 0; j < seg; j++) {
      const a0 = (j / seg) * TAU, a1 = ((j + 1) / seg) * TAU, am = (a0 + a1) / 2;
      const n = norm(add(mul(Sp.n, Math.sin(fm)), add(mul(Sp.r, Math.cos(fm) * Math.cos(am)), mul(Sp.u, Math.cos(fm) * Math.sin(am)))));
      const pts = i === rings - 1 ? [P(r0, a0, z0), P(r0, a1, z0), P(0, 0, z1)] : [P(r0, a0, z0), P(r0, a1, z0), P(r1, a1, z1), P(r1, a0, z1)];
      K.face(pts, n, 'dash', 0.35, col, emis);
    }
  }
  Sp.disc(u - r * 0.32, v + r * 0.32, r * 0.22, rgb.map((c) => Math.round(c + (255 - c) * 0.75)), Math.max(emis, 0.4), t - cap * 0.25, 8);
}

// ── A contact shadow ─────────────────────────────────────────────────────────
// An ellipse lying on a surface through `c`, spanned by `u` (half-width a) and `v` (half-depth b),
// facing `n`: two stacked layers of SHADE, the inner one smaller, so it is darkest under the object.
export function contactShadow(K, c, u, v, n, a, b) {
  for (const k of [1, 0.62]) {
    const pts = [];
    for (let i = 0; i < 18; i++) {
      const t = (i / 18) * TAU;
      pts.push(add(add(add(c, mul(n, 0.0015 + (1 - k) * 0.0006)), mul(u, Math.cos(t) * a * k)), mul(v, Math.sin(t) * b * k)));
    }
    K.face(pts, n, 'dash', 0, SHADE, 1);
  }
}

// ── The halo round the control under the pointer ────────────────────────────
// Only for click controls: a drag control's hit radius is its whole grab area, and a hoop round
// that covers the thing you are holding. `live.hover` / `live.press` name the control (cockpit.js).
export function hotspotHalo(K, hotspots, live) {
  const hot = live && (live.press || live.hover);
  if (!hot) return;
  const h = hotspots.find((x) => x.id === hot);
  if (!h || h.kind !== 'click') return;
  const Hp = facingPanel(K, h.p, 'dash', 0);
  Hp.annulus(0, 0, h.r * 1.0, h.r * 1.18, live.press ? HALO_PRESS : HALO, 1, 0.012, 24);
  Hp.annulus(0, 0, h.r * 1.18, h.r * 1.24, HALO_RIM, 1, 0.013, 24);
}

export { clamp };
