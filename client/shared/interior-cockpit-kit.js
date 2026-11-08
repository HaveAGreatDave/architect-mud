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
// off the nose in degrees, so heading up needs no turning here, and dist is nautical miles on the
// aircraft's own instruments (world-scale.js tripM). Dark without power.
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

// ══ THE 2076 KIT ═════════════════════════════════════════════════════════════
// What makes a 2076 cockpit read as fifty years on (docs/proposals/fleet-2076.md, "The 2076 bar"):
// sculpted surfaces swept rather than boxed (sweep, lightLine), one curved band of glass across the
// dash (glassBand), a head-up display projected into the windscreen and true to the world outside
// (windscreenHud), holograms with depth (HOLO colours, holoFrame), and screens that boot when the
// power comes on (bootClock, reveal). None of it may invent a reading: decoration moves on wall time,
// readouts move on live values.

// Translucent light: the hologram's fill and its lines, and the HUD's two weights. Keyed by identity.
export const HOLO = [90, 232, 210], HOLO_LINE = [150, 255, 232], HOLO_AMBER = [255, 200, 96], HOLO_RED = [255, 96, 84];
PANE.set(HOLO, 0.16); PANE.set(HOLO_LINE, 0.7); PANE.set(HOLO_AMBER, 0.8); PANE.set(HOLO_RED, 0.85);
export const HUD_LINE = [150, 255, 205], HUD_DIM = [90, 214, 172], HUD_AMBER = [255, 206, 110], HUD_RED = [255, 100, 90];
PANE.set(HUD_LINE, 0.88); PANE.set(HUD_DIM, 0.5); PANE.set(HUD_AMBER, 0.9); PANE.set(HUD_RED, 0.92);
export const GLASS_TINT = [14, 30, 34];
PANE.set(GLASS_TINT, 0.55);

export const wallSec = () => nowMs() / 1000;

// Seconds since the power came on, for a boot sequence: `live.powerAge` from cockpit.js. A view
// that doesn't send it (a gate, the Modelshop) is long booted, so a still frame is never caught
// half lit and a gate driving `powered` back and forth still sees every page.
export function bootAge(live) {
  const L = live || {};
  if (L.powered === false) return 0;
  const a = Number(L.powerAge);
  return Number.isFinite(a) ? a : 1e3;
}
// 0..1: how far a page `delay` seconds into the boot has come up, over `dur` seconds.
export const reveal = (bootT, delay, dur = 0.6) => clamp((bootT - delay) / dur, 0, 1);

// The colour a cockpit's light lines run in: the maker's own (teal if none), amber on a caution, red on a warning, and a red
// that breathes, so the cabin itself says something is wrong before a screen does.
export const ALERT_TEAL = [70, 232, 212], ALERT_AMBER = [255, 186, 72], ALERT_RED = [255, 70, 60];
export function alertLight(caution, warning, line = ALERT_TEAL) {
  if (warning) return { rgb: ALERT_RED, k: 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(wallSec() * 6)) };
  return { rgb: caution ? ALERT_AMBER : line, k: 1 };
}

// ── A swept surface ──────────────────────────────────────────────────────────
// `rings` is a list of cross-sections, each the same number of points: a skin is laid between each
// ring and the next. Each quad's normal is turned away from the line through the rings' centroids,
// so a closed or open section reads from outside without the caller ordering anything.
export function sweep(K, rings, tone, k, rgb, emis = 0, closed = false) {
  const cen = rings.map((r) => mul(r.reduce((a, p) => add(a, p), [0, 0, 0]), 1 / r.length));
  for (let i = 0; i + 1 < rings.length; i++) {
    const A = rings[i], B = rings[i + 1], m = A.length;
    for (let j = 0; j < (closed ? m : m - 1); j++) {
      const j1 = (j + 1) % m, q = [A[j], A[j1], B[j1], B[j]];
      let n = norm(cross([q[2][0] - q[0][0], q[2][1] - q[0][1], q[2][2] - q[0][2]], [q[3][0] - q[1][0], q[3][1] - q[1][1], q[3][2] - q[1][2]]));
      const mid = mul(add(add(q[0], q[1]), add(q[2], q[3])), 0.25), c = mul(add(cen[i], cen[i + 1]), 0.5);
      if ((mid[0] - c[0]) * n[0] + (mid[1] - c[1]) * n[1] + (mid[2] - c[2]) * n[2] < 0) n = mul(n, -1);
      K.face(q, n, tone, k, rgb, emis);
    }
  }
}
// A lit line along a polyline: a thin rod per leg.
export function lightLine(K, pts, rad, rgb, emis, tone = 'dash') {
  for (let i = 0; i + 1 < pts.length; i++) K.rod(pts[i], pts[i + 1], rad, tone, 0.3, rgb, emis, 4, false);
}

// ── The glass band ───────────────────────────────────────────────────────────
// One continuous sheet of glass along `curve` (a function of s in 0..1 giving { p, f } on the dash:
// the point on the glass's lower edge and the outward direction across the dash), rising `h` and
// leaning back by `lean` of its height. Drawn as a dark substrate, a tinted cover a few millimetres
// proud and a lit top edge in the alert colour. `at(s, v)` is a panel on the glass at s, `v` metres up
// it, square to the eye, so a page sits on the band and still reads.
// The band's geometry alone, for the hotspots (which must not draw): P(s, v, lift) and at(K, s, v).
export function bandFrame(curve, lean = 0.45) {
  const up = (c) => norm(add([0, 0, 1], mul(c.f, lean)));
  const P = (s, v, l = 0) => { const c = curve(s), U = up(c); return add(add(c.p, mul(U, v)), mul(c.f, -l)); };
  // Lying on the glass, along the curve: the band is turned to the cabin, so a page on it reads from
  // the seat (its face toward the eye, never mirrored) and stands off it by only `lift`.
  const at = (K, s, v, lift = 0.004) => {
    const c = curve(s), o = P(s, v, lift), U = up(c), e = 1e-3;
    const a = curve(Math.max(0, s - e)).p, b = curve(Math.min(1, s + e)).p;
    let r = norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
    if (r[0] < 0) r = mul(r, -1);
    return K.panel(o, r, U, 'dash', 0.3);
  };
  return { P, at, up };
}
export function glassBand(K, curve, { h = 0.2, lean = 0.45, segs = 28, lit = true, light = ALERT_TEAL, lightK = 1, substrate = [8, 12, 14] } = {}) {
  const F = bandFrame(curve, lean), P = F.P;
  for (let i = 0; i < segs; i++) {
    const s0 = i / segs, s1 = (i + 1) / segs;
    const q = [P(s0, 0), P(s1, 0), P(s1, h), P(s0, h)];
    const n = norm(cross([q[1][0] - q[0][0], q[1][1] - q[0][1], q[1][2] - q[0][2]], [q[3][0] - q[0][0], q[3][1] - q[0][1], q[3][2] - q[0][2]]));
    const toEye = -(q[0][0] * n[0] + q[0][1] * n[1] + q[0][2] * n[2]) > 0 ? n : mul(n, -1);
    K.face(q, toEye, 'dash', 0.5, substrate, lit ? 0.08 : 0);
    if (lit) {
      K.face([P(s0, h - 0.004, 0.003), P(s1, h - 0.004, 0.003), P(s1, h - 0.0015, 0.003), P(s0, h - 0.0015, 0.003)], toEye, 'dash', 0.3, light, lightK);
      K.face([P(s0, 0.0015, 0.003), P(s1, 0.0015, 0.003), P(s1, 0.003, 0.003), P(s0, 0.003, 0.003)], toEye, 'dash', 0.3, light, 0.35 * lightK);
    }
  }
  return { P, at: (s, v, lift) => F.at(K, s, v, lift) };
}

// ── A hologram's frame ───────────────────────────────────────────────────────
// Model space (x right, y forward, z up, metres) turned by the aircraft's own pitch and bank and set
// at `c`, so a miniature of her floating over the dash flies as she does. Returns T(p) and helpers
// that draw in it with the HOLO colours: a line, a ring and a filled plate.
export function holoFrame(K, c, pitchDeg, bankDeg, yawDeg = 0) {
  const p = pitchDeg * Math.PI / 180, b = bankDeg * Math.PI / 180, y = yawDeg * Math.PI / 180;
  const T = (q) => {
    let [x0, y0, z0] = q;
    // bank about forward, then pitch about right, then yaw about up
    let x1 = x0 * Math.cos(b) + z0 * Math.sin(b), z1 = -x0 * Math.sin(b) + z0 * Math.cos(b);
    let y2 = y0 * Math.cos(p) - z1 * Math.sin(p), z2 = y0 * Math.sin(p) + z1 * Math.cos(p);
    const x3 = x1 * Math.cos(y) + y2 * Math.sin(y), y3 = -x1 * Math.sin(y) + y2 * Math.cos(y);
    return add(c, [x3, y3, z2]);
  };
  const line = (a, b2, rad = 0.0012, rgb = HOLO_LINE, e = 1) => K.rod(T(a), T(b2), rad, 'dash', 0.2, rgb, e, 4, false);
  const ring = (cc, R, U, rad, n = 16, rgb = HOLO_LINE, e = 1, t0 = 0, t1 = TAU) => {
    let prev = null;
    for (let i = 0; i <= n; i++) {
      const t = t0 + (t1 - t0) * (i / n), q = add(cc, add(mul(R, Math.cos(t) * rad), mul(U, Math.sin(t) * rad)));
      if (prev) line(prev, q, 0.001, rgb, e);
      prev = q;
    }
  };
  const plate = (pts, rgb = HOLO, e = 0.6) => {
    const W = pts.map(T);
    const n = norm(cross([W[1][0] - W[0][0], W[1][1] - W[0][1], W[1][2] - W[0][2]], [W[2][0] - W[0][0], W[2][1] - W[0][1], W[2][2] - W[0][2]]));
    const f = -(W[0][0] * n[0] + W[0][1] * n[1] + W[0][2] * n[2]) > 0 ? n : mul(n, -1);
    K.face(W, f, 'dash', 0.1, rgb, e);
  };
  return { T, line, ring, plate };
}
// The projector a hologram stands on: a lit lens in the surface and four faint rays up to it, with
// an arc round the lens filled to `frac` (any 0..1 reading the caller names, in `rgb`).
export function holoProjector(K, base, rise, rad, frac, rgb = HOLO_LINE) {
  const Sp = K.panel(base, [1, 0, 0], [0, 1, 0], 'dash', 0.3);
  Sp.disc(0, 0, rad * 0.55, [20, 40, 40], 0.2, 0.001, 18);
  Sp.annulus(0, 0, rad * 0.35, rad * 0.45, HOLO_LINE, 1, 0.002, 18);
  Sp.annulus(0, 0, rad * 0.62, rad * 0.7, [40, 70, 70], 0.2, 0.0015, 24);
  if (frac > 0.005) Sp.annulus(0, 0, rad * 0.62, rad * 0.7, rgb, 1, 0.002, Math.max(2, Math.round(24 * frac)), Math.PI / 2, Math.PI / 2 - frac * TAU);
  for (let i = 0; i < 4; i++) {
    const t = i * TAU / 4 + Math.PI / 4;
    K.rod(Sp.pt(Math.cos(t) * rad * 0.4, Math.sin(t) * rad * 0.4, 0.002), add(base, [Math.cos(t) * rad * 1.3, Math.sin(t) * rad * 1.3, rise]), 0.0008, 'dash', 0.1, HOLO, 1, 3, false);
  }
}

// ── The windscreen HUD ───────────────────────────────────────────────────────
// Symbology projected into the windscreen on a plane `dist` metres ahead, conformal: one degree on it
// is one degree of the world, so the horizon line lies on the real horizon and the flight path marker
// sits where she is actually going. No glass sheet: lines only, and nothing ever on the boresight
// (the gates cast a ray straight down it), which is why every ladder bar has its gap and the marker
// is a ring. `R` carries pitch, bank, hdg, ias, alt, vsi; `o.mirrors` the hands and feet:
// { stick: [x, y], thrs: [0..1, ...], rud }, drawn in the lower corners so the low controls read
// in the forward view. `o.warn` / `o.caution` turn the frame red / amber.
export function windscreenHud(K, R, o = {}) {
  const dist = o.dist || 1, cz = o.z || 0, hw = o.hw || 0.2, hh = o.hh || 0.13;
  const k = dist * Math.tan(Math.PI / 180);                  // metres per degree on the plane
  const Hp = K.panel([0, dist, cz], [1, 0, 0], [0, 0, 1], 'dash', 0);
  const bore = [0, -cz];                                     // where the straight-ahead ray crosses the plane
  const col = o.warn ? HUD_RED : o.caution ? HUD_AMBER : HUD_LINE;
  const inside = (pts) => {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > bore[1]) !== (yj > bore[1]) && bore[0] < (xj - xi) * (bore[1] - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const inBox = (pts) => pts.every(([a, b]) => Math.abs(a) <= hw && Math.abs(b) <= hh);
  const poly = (pts, rgb = col, l = 0.001) => { if (inBox(pts) && !inside(pts)) Hp.plate(pts, rgb, 1, l); };
  // A line, cut to the HUD's box (Liang-Barsky) rather than dropped, so a rolled horizon still shows.
  const seg = (a0, b0, w = 0.0011, rgb = col) => {
    let t0 = 0, t1 = 1;
    const ddx = b0[0] - a0[0], ddy = b0[1] - a0[1], X = hw - w, Y = hh - w;
    for (const [p, q] of [[-ddx, a0[0] + X], [ddx, X - a0[0]], [-ddy, a0[1] + Y], [ddy, Y - a0[1]]]) {
      if (p === 0) { if (q < 0) return; continue; }
      const r = q / p;
      if (p < 0) { if (r > t1) return; if (r > t0) t0 = r; } else { if (r < t0) return; if (r < t1) t1 = r; }
    }
    const a = [a0[0] + ddx * t0, a0[1] + ddy * t0], b = [a0[0] + ddx * t1, a0[1] + ddy * t1];
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, px = -dy / L * w, py = dx / L * w;
    poly([[a[0] - px, a[1] - py], [b[0] - px, b[1] - py], [b[0] + px, b[1] + py], [a[0] + px, a[1] + py]], rgb);
  };
  const life = o.boot == null ? 1 : o.boot;
  if (life <= 0) return Hp;
  // The pitch ladder, rolled with the bank, the horizon long and the rungs every 5° with a gap.
  const bk = -R.bank * Math.PI / 180, cb = Math.cos(bk), sb = Math.sin(bk);
  const rot = ([a, b]) => [a * cb - b * sb, a * sb + b * cb + bore[1]];
  for (let d = -30; d <= 30; d += 5) {
    const off = (d - R.pitch) * k;
    if (Math.abs(off) > hh * 1.4) continue;
    const half = d === 0 ? hw * 0.92 : Math.min(0.055, hw * 0.3), gap = d === 0 ? 0.03 : 0.022;
    for (const s of [-1, 1]) {
      const a = rot([s * gap, off]), b = rot([s * half, off]);
      seg(a, b, d === 0 ? 0.0013 : 0.001, d === 0 ? col : HUD_DIM);
      if (d !== 0) seg(b, rot([s * half, off + (d > 0 ? -0.008 : 0.008)]), 0.001, HUD_DIM);   // the rung's end tick points at the horizon
    }
  }
  // The flight path marker: where she's going, the climb angle off the nose.
  const gam = Math.atan2(R.vsi / 101.33, Math.max(1, R.ias)) * 180 / Math.PI;
  const fv = clamp((gam - R.pitch) * k, -hh * 0.8, hh * 0.8) + bore[1];
  for (let i = 0; i < 16; i++) {
    const t0 = i * TAU / 16, t1 = (i + 1) * TAU / 16;
    seg([Math.cos(t0) * 0.009, fv + Math.sin(t0) * 0.009], [Math.cos(t1) * 0.009, fv + Math.sin(t1) * 0.009], 0.0009);
  }
  seg([-0.026, fv], [-0.0095, fv]); seg([0.0095, fv], [0.026, fv]); seg([0, fv + 0.0095], [0, fv + 0.018]);
  // The bank scale: ticks at 10, 20, 30 and 45 each side on an arc above, the pointer at the bank.
  const ra = hh * 0.82;
  for (const d of [-45, -30, -20, -10, 0, 10, 20, 30, 45]) {
    const t = Math.PI / 2 + d * Math.PI / 180;
    seg([Math.cos(t) * ra, bore[1] + Math.sin(t) * ra], [Math.cos(t) * (ra + (d % 30 === 0 ? 0.012 : 0.007)), bore[1] + Math.sin(t) * (ra + (d % 30 === 0 ? 0.012 : 0.007))], 0.0009, HUD_DIM);
  }
  { const t = Math.PI / 2 - R.bank * Math.PI / 180, c = [Math.cos(t) * (ra - 0.003), bore[1] + Math.sin(t) * (ra - 0.003)], n = [Math.cos(t), Math.sin(t)], p = [-n[1], n[0]];
    poly([c, [c[0] - n[0] * 0.01 + p[0] * 0.005, c[1] - n[1] * 0.01 + p[1] * 0.005], [c[0] - n[0] * 0.01 - p[0] * 0.005, c[1] - n[1] * 0.01 - p[1] * 0.005]]); }
  // The heading tape along the top, a tick every 5°, the reading boxed.
  const hy = hh - 0.012, span = 25;
  for (let d = Math.floor((R.hdg - span) / 5) * 5; d <= R.hdg + span; d += 5) {
    const u = (d - R.hdg) * k * 0.9;
    if (Math.abs(u) > hw * 0.6 || Math.abs(u) < 0.016) continue;
    seg([u, hy - (d % 10 === 0 ? 0.008 : 0.004)], [u, hy], 0.0008, HUD_DIM);
  }
  const H = String(Math.round(((R.hdg % 360) + 360) % 360)).padStart(3, '0');
  Hp.digits(-0.012, hy - 0.01, 0.011, H, col, false);
  // Speed on the left, height on the right, each in a box, with the climb rate under the height.
  const box = (u, v, w, h2) => { seg([u - w, v - h2], [u + w, v - h2], 0.0008); seg([u - w, v + h2], [u + w, v + h2], 0.0008); seg([u - w, v - h2], [u - w, v + h2], 0.0008); seg([u + w, v - h2], [u + w, v + h2], 0.0008); };
  const by = bore[1];
  box(-hw * 0.72, by, 0.03, 0.011);
  Hp.digits(-hw * 0.72 - 0.024, by - 0.0075, 0.013, String(Math.round(R.ias)).padStart(3, ' '), col, false);
  box(hw * 0.72, by, 0.036, 0.011);
  Hp.digits(hw * 0.72 - 0.031, by - 0.0075, 0.013, String(Math.round(R.alt)).padStart(5, ' '), col, false);
  const vsS = (R.vsi >= 0 ? '' : '-') + String(Math.min(9990, Math.round(Math.abs(R.vsi) / 10) * 10));
  Hp.digits(hw * 0.72 - 0.024, by - 0.03, 0.009, vsS.padStart(5, ' '), HUD_DIM, false);
  // The mirrors: hands and feet.
  const M = o.mirrors;
  if (M) {
    const sx = -hw * 0.8, sy = -hh * 0.62, sb2 = 0.017;
    box(sx, sy, sb2, sb2);
    seg([sx, sy - sb2], [sx, sy + sb2], 0.0005, HUD_DIM); seg([sx - sb2, sy], [sx + sb2, sy], 0.0005, HUD_DIM);
    if (M.stick) { const d = [sx + M.stick[0] * (sb2 - 0.003), sy - M.stick[1] * (sb2 - 0.003)]; poly([[d[0] - 0.003, d[1] - 0.003], [d[0] + 0.003, d[1] - 0.003], [d[0] + 0.003, d[1] + 0.003], [d[0] - 0.003, d[1] + 0.003]]); }
    if (M.thrs && M.thrs.length) {
      const tx = -hw * 0.97, t0 = -hh * 0.75, t1 = hh * 0.25;
      seg([tx, t0], [tx, t1], 0.0007, HUD_DIM);
      M.thrs.forEach((t, i) => {
        const y = lerpN(t0, t1, clamp(t, 0, 1)), s = M.thrs.length > 1 ? (i < M.thrs.length / 2 ? -1 : 1) : 1;
        poly(s > 0 ? [[tx + 0.002, y], [tx + 0.01, y - 0.004], [tx + 0.01, y + 0.004]] : [[tx - 0.002, y], [tx - 0.01, y + 0.004], [tx - 0.01, y - 0.004]]);
      });
    }
    if (M.rud != null) {
      const py = -hh * 0.9;
      seg([-0.04, py], [0.04, py], 0.0007, HUD_DIM);
      seg([0, py - 0.004], [0, py + 0.004], 0.0006, HUD_DIM);
      const x = clamp(M.rud, -1, 1) * 0.036;
      poly([[x - 0.0025, py - 0.004], [x + 0.0025, py - 0.004], [x + 0.0025, py + 0.004], [x - 0.0025, py + 0.004]]);
    }
  }
  return Hp;
}
const lerpN = (a, b, t) => a + (b - a) * t;

export { clamp };

// The column a centre stick stands on: a floor flange and a shaft up to the stick's own base, so
// every seat's grab is dead ahead of the pilot.
export function stickColumn(K, base, zF, body, metal) {
  K.rod([base[0], base[1], zF], [base[0], base[1], zF + 0.02], 0.07, 'dash', 0.1, body, 0, 14);
  K.rod([base[0], base[1], zF + 0.02], [base[0], base[1], base[2] - 0.01], 0.03, 'dash', 0.05, body, 0, 12);
}
