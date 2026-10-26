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

// ── The panel GPS ────────────────────────────────────────────────────────────
// A small moving-map head for a cockpit that had none: a bezel, a screen, a range ring, the
// aircraft at the centre pointing up the screen, and a magenta course line out to the place the
// target guide is on. `live.gpsTo` is { rel, dist } from cockpit.js: rel is the target's bearing
// off the nose in degrees, so heading up needs no turning here. Dark without power.
// Drawn on panel `Pn` at (u, v) in that panel's coords, hw × hh the half sizes. `gpsHotspot` takes
// the same panel and centre, so the screen you see and the place you click are one spec; a click
// opens the destination picker (cockpit.js 'ck:gps').
const GPS_SCREEN = [10, 30, 24], GPS_DARK = [12, 14, 14], GPS_LINE = [44, 120, 88], GPS_SHIP = [235, 255, 240], GPS_MAG = [230, 90, 220];
export function panelGps(Pn, u, v, hw, hh, live, o = {}) {
  const L = live || {}, on = L.powered !== false;
  const e = Math.min(hw, hh) * 0.16, sw = hw - e, sh = hh - e;
  Pn.rect(u - hw, v - hh, u + hw, v + hh, o.bezel || [22, 24, 28], 0, 0.002);
  Pn.rect(u - sw, v - sh, u + sw, v + sh, on ? GPS_SCREEN : GPS_DARK, on ? 0.6 : 0, 0.004);
  if (o.label !== false) Pn.text('GPS', u, v - hh - 0.0095, Math.min(0.0085, hh * 0.25));
  if (!on) return;
  const R = Math.min(sw, sh) * 0.78;
  Pn.annulus(u, v, R - 0.0012, R + 0.0012, GPS_LINE, 0.8, 0.005, 20);
  Pn.annulus(u, v, R * 0.5 - 0.001, R * 0.5 + 0.001, GPS_LINE, 0.6, 0.005, 16);
  const s = R * 0.22;
  Pn.plate([[u, v + s], [u + s * 0.7, v - s * 0.7], [u, v - s * 0.3], [u - s * 0.7, v - s * 0.7]], GPS_SHIP, 0.95, 0.007);
  const g = L.gpsTo;
  if (g && Number.isFinite(g.rel)) {
    const t = Math.PI / 2 - g.rel * Math.PI / 180, cu = u + Math.cos(t) * R, cv = v + Math.sin(t) * R, d = s * 0.55;
    Pn.spoke(u, v, t, s * 0.4, R, Math.max(0.0012, R * 0.035), GPS_MAG, 0.95, 0.006);
    Pn.plate([[cu, cv + d], [cu + d, cv], [cu, cv - d], [cu - d, cv]], GPS_MAG, 1, 0.0075);
  }
}
// An annunciator: a lens `w` by `h` in a black bezel with its name lettered ON it, dark on a lit lens
// and light on a dark one, as large as the lens allows. The kit's lamp letters its name underneath
// at 8.5 mm, which fails the legibility check on anything past the pilot's own board.
export function lensLamp(Pn, u, v, w, h, on, rgb, name) {
  Pn.rect(u - w / 2 - 0.004, v - h / 2 - 0.004, u + w / 2 + 0.004, v + h / 2 + 0.004, [14, 14, 16], 0, 0.003);
  Pn.rect(u - w / 2, v - h / 2, u + w / 2, v + h / 2, on ? rgb : rgb.map((c) => c * 0.18), on ? 1 : 0, 0.006);
  Pn.fitText(name, u, v, w - 0.008, h * 0.55, on ? [24, 16, 10] : [200, 200, 190], on ? 0 : 0.3, 0.008);
}

export const gpsHotspot = (Pn, u, v, r) => ({ id: 'ck:gps', p: Pn.pt(u, v, 0.01), r, kind: 'click' });

export { clamp };
