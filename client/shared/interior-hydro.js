// THE HYDRO'S HELM, FINISHED.
//
// `boatFit` (interior-fit.js) and the cluster in interior-shell.js build what is in the pilothouse;
// this is what it is MADE of. The Drake reads as a finished object because every surface is a
// material — walnut with a grain, gold that faces the light, lettering cut into the panels, a glint
// on every dial glass and a shadow where a part meets the dash — while the boat was the same parts
// in flat grey. This file gives the boat the race-boat version of the same finish: lacquered carbon,
// billet aluminium, red anodising and engraved white legends.
//
// ⚠ THE MATERIALS ARE COLOUR IDENTITIES, like every other fit-out's. SHINY/PANE/TEXTURE are keyed on
// the array object, so a part is carbon because it was handed `HY.carbon`, never an equal array.
//
// ⚠ LETTERING IS LIMITED TO THE DRAKE'S GLYPH SET (interior-drake.js GLYPH): no Y, no X and no
// digits. A missing glyph prints as a gap rather than throwing, so a new legend is worth a look.
// Dial numerals are their own seven-bar figures below (`numeral`), drawn lit bars only.
//
// ⚠ THE GAUGE LIGHTS ARE A SWITCH, `live.dials`, and boat-view sends it only while she is running:
// backlighting is on the boat's own battery circuit, so a dead boat has dark dials whatever the
// switch says. Lit, the dial faces take a warm backlight, the numerals and legends glow and the
// panels carry a soft pool of light over the switchgear.

import { makeKit, C, SHINY, PANE, TEXTURE } from './interior-kit.js';
import { engraveText } from './interior-drake.js';
import { hotspotHalo } from './interior-cockpit-kit.js';

export const HY = {
  carbon: [40, 44, 52],        // gloss carbon twill: the pod, the wheel, the console
  billet: [188, 194, 202],     // machined aluminium: bezels, frames, the throttle arm
  anod: [184, 34, 30],         // red anodising: the throttle knob, the badge
  ink: [232, 236, 240],        // the legends' white fill
  inkLit: [255, 226, 180],     // the same legends backlit
  cut: [6, 7, 9],              // the shadow in a cut
  shade: [0, 0, 1],            // contact shadow, see-through black
  glint: [250, 252, 255],      // the crescent of window light on a gauge glass
  glow: [255, 170, 90],        // the backlight's pool over a lit dial, see-through
  tick: [240, 232, 214],       // a lit dial's numerals
};
SHINY.set(HY.carbon, { spec: 0.6, pow: 46, coat: 0.5 }); TEXTURE.set(HY.carbon, 'fabric');
SHINY.set(HY.billet, { spec: 0.9, pow: 26, ramp: [[64, 68, 76], [238, 242, 248]], glint: 0.35, albedo: [236, 240, 246], envK: 0.8 });
TEXTURE.set(HY.billet, 'brushed');
SHINY.set(HY.anod, { spec: 0.6, pow: 40, coat: 0.4 });
PANE.set(HY.shade, 0.22); PANE.set(HY.glint, 0.2); PANE.set(HY.glow, 0.16);

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// A frame of four billet bars round a rectangle in a panel's plane, standing `l` proud.
function frame(K, Pn, a0, b0, a1, b1, r, l) {
  const c = [Pn.pt(a0, b0, l), Pn.pt(a1, b0, l), Pn.pt(a1, b1, l), Pn.pt(a0, b1, l)];
  for (let i = 0; i < 4; i++) K.rod(c[i], c[(i + 1) % 4], r, 'dash', 0.1, HY.billet, 0.05, 6);
}

// A raised slab with a chamfered billet edge all round — the Drake's gold bead in aluminium. Each of
// the four chamfers faces its own way, so one edge or another catches the light as she turns. The
// slab's face stands `d` proud; draw on it with the panel `bevel` hands back.
function bevel(K, Pn, a0, b0, a1, b1, d, ch, rgb) {
  const base = [[a0, b0], [a1, b0], [a1, b1], [a0, b1]];
  const top = [[a0 + ch, b0 + ch], [a1 - ch, b0 + ch], [a1 - ch, b1 - ch], [a0 + ch, b1 - ch]];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const q = [Pn.pt(...base[i], 0.0015), Pn.pt(...base[j], 0.0015), Pn.pt(...top[j], d), Pn.pt(...top[i], d)];
    let n = norm(cross(sub(q[1], q[0]), sub(q[3], q[0])));
    if (n[0] * q[0][0] + n[1] * q[0][1] + n[2] * q[0][2] > 0) n = n.map((v) => -v);
    K.face(q, n, 'dash', 0.35, HY.billet, 0.05);
  }
  Pn.plate(top, rgb, 0, d);
  return K.panel(Pn.pt(0, 0, d), Pn.r, Pn.u);
}

// A dial numeral: the lit bars of a seven-bar figure only, centred on (a, b), `h` tall.
const BARS = { 0: 0b1111110, 1: 0b0110000, 2: 0b1101101, 3: 0b1111001, 4: 0b0110011, 5: 0b1011011, 6: 0b1011111, 7: 0b1110000, 8: 0b1111111, 9: 0b1111011 };
function numeral(Pn, ch, a, b, h, rgb, glow, lift) {
  const w = h * 0.55, t = h * 0.14, x = a - w / 2, y = b - h / 2, m = y + h / 2;
  const H = (x0, x1, yc) => [[x0, yc - t / 2], [x1, yc - t / 2], [x1, yc + t / 2], [x0, yc + t / 2]];
  const V = (xc, y0, y1) => [[xc - t / 2, y0], [xc + t / 2, y0], [xc + t / 2, y1], [xc - t / 2, y1]];
  const segs = [H(x, x + w, y + h - t / 2), V(x + w - t / 2, m, y + h), V(x + w - t / 2, y, m), H(x, x + w, y + t / 2),
    V(x + t / 2, y, m), V(x + t / 2, m, y + h), H(x, x + w, m)];
  const on = BARS[ch] || 0;
  segs.forEach((s, k) => { if (on & (1 << (6 - k))) Pn.plate(s, rgb, glow, lift); });
}

// ── WHERE THE CONTROLS ARE, ONCE ─────────────────────────────────────────────
// hydroDetail draws from these and hydroHotspots hands the same points to the renderer for clicking
// (windshield.js takes any profile's 'hotspots(live)'), so a switch cannot be drawn in one place
// and clicked in another.
//
// ⚠ EVERY SWITCH HERE DOES SOMETHING. The helm used to carry two rocker banks that were set dressing
// (bilge, blower, anchor light…) with nothing behind them; they are gone. A switch that is drawn is
// a switch boat-view acts on: the dome lamp, the wipers, the horn and the gauge lights.
// The word on each hull's fascia badge. In the legend face's glyph set (see the ⚠ at the top).
const HULL_BADGE = { hydro: 'ROOSTER', spur: 'SPUR', gamecock: 'GAMECOCK' };
export const HYDRO_SWITCHES = [
  { id: 'cabin', label: 'CABIN', lamp: C.amber },
  { id: 'wipe', label: 'WIPE', lamp: C.green },
  { id: 'horn', label: 'HORN', push: true },
  { id: 'dials', label: 'DIALS', lamp: C.amber },
  { id: 'stab', label: 'STAB', lamp: C.green },
];
const SW_U = (i) => -0.565 + i * 0.066, SW_V = 0.075;   // clear of the wheel's port grip from the seat
function fasciaPanels(K, P) {
  const cx = P.instr?.cx != null ? P.instr.cx : P.xCentre;
  const F = K.panel([cx, P.dashY - 0.002, -0.5], [1, 0, 0], [0, 0, 1]);
  const Lp = bevel(K, F, -0.60, -0.03, -0.26, 0.20, 0.012, 0.008, HY.carbon);
  const Rt = bevel(K, F, 0.26, -0.03, 0.60, 0.20, 0.012, 0.008, HY.carbon);
  return { F, Lp, Rt };
}
// ⚠ THE CONSOLE'S SPAN, ONCE, FOR BOTH FILES THAT DRAW IT. `boatConsole` (interior-fit.js) builds the
// carbon box and this file caps it, and the two used to restate x0 = 0.74 separately. In a room
// narrower than the Rooster's the outboard edge comes in to the wall (`wallAt`, interior-shell.js) at
// the console's own top, which is where the tumblehome makes the wall narrowest, and the console
// keeps at least a forearm's width.
export function consoleSpan(P) {
  const y0 = -0.35, y1 = 0.60, zt = -0.47;
  const wall = P.wallAt ? Math.min(...[y0, (y0 + y1) / 2, y1].map((y) => P.wallAt(y, zt).stbd)) : P.xCentre + P.halfW;
  const x1 = Math.min(0.98, wall - 0.02, P.xCentre + P.halfW - 0.02);
  const x0 = Math.min(0.74, x1 - 0.20);
  return { x0, x1, y0, y1, zt };
}
function consolePanels(K, P) {
  const { x0, x1, y0, y1, zt } = consoleSpan(P);
  const T = K.panel([(x0 + x1) / 2, (y0 + y1) / 2, zt + 0.001], [1, 0, 0], [0, 1, 0]);
  const S = K.panel([x0 - 0.001, 0.22, -0.64], [0, 1, 0], [0, 0, 1]);
  return { x0, y0, y1, zt, T, S };
}
const switchOn = (id, L) => (id === 'cabin' ? !!L.cabin : id === 'wipe' ? (L.wipers | 0) > 0 : id === 'horn' ? !!L.horn : id === 'stab' ? !!L.stab : !!L.dialSwitch);

// The clickable controls, in shell space. 'click' acts once on press; 'hold' acts while pressed.
export function hydroHotspots(P) {
  const K = makeKit(() => {});
  const { Lp, Rt } = fasciaPanels(K, P);
  const out = HYDRO_SWITCHES.map((sw, i) => ({ id: sw.id, p: Lp.pt(SW_U(i), SW_V, 0.012), r: 0.022, kind: sw.push ? 'hold' : 'click' }));
  for (const [id, [u, v]] of Object.entries(RT_CTRL)) {
    out.push({ id, p: Rt.pt(u, v, 0.012), r: id === 'ign' ? 0.024 : 0.019, kind: id === 'ign' || id === 'kill' ? 'click' : 'hold' });
  }
  return out;
}
// ⚠ EVERY CONTROL IS ON THE FORWARD FASCIA, reachable from the seat looking ahead. The key, the kill,
// the bottle and the tabs sat on the side console, where you had to turn your head to find the one
// switch a dead boat needs first. Starboard slab: two small gauges, then the controls.
const RT_CTRL = { tabUp: [0.29, 0.030], tabDown: [0.335, 0.030], arm: [0.415, 0.030], ign: [0.505, 0.115], kill: [0.565, 0.115] };

export function hydroDetail(P, live, push) {
  const K = makeKit(push);
  const L = live || {};
  const I = P.instr || {};
  const cx = I.cx != null ? I.cx : P.xCentre;
  const on = !!(L.running || L.lit);
  const lit = !!L.dials;
  const ink = lit ? HY.inkLit : HY.ink, inkGlow = lit ? 0.85 : 0.12;
  const label = (Pn, str, a, b, h, lift = 0.003) => engraveText(Pn, str, a, b, h, ink, HY.cut, lift, inkGlow);

  // ── THE POD ────────────────────────────────────────────────────────────────
  // The same frame the cluster is authored in (interior-shell.js instrumentFaces).
  const yB = I.panelY0 ?? 0.52, zB = I.panelZ0 ?? -0.34;
  const yT = I.panelY1 ?? 0.62, zT = I.panelZ1 ?? -0.05;
  const PH = Math.hypot(yT - yB, zT - zB) || 1;
  const HW = I.panelHW ?? 0.42;
  const Pn = K.panel([cx, yB, zB], [1, 0, 0], [0, (yT - yB) / PH, (zT - zB) / PH]);
  frame(K, Pn, -HW, 0.004, HW, PH - 0.004, 0.006, 0.006);
  // The tacho: a turned billet bezel, numerals at the majors (thousands), its legend and the glass.
  const tr = I.tachoR ?? 0.088, tz = PH * 0.62, tcx = -0.285;
  Pn.torus(tcx, tz, tr * 1.12, tr * 1.34, HY.billet, 0.05, 0.006, 28, 3);
  const A0 = Math.PI * 1.25, SWEEP = Math.PI * 1.5;
  ['0', '3', '6', '9'].forEach((d, i) => {
    const t = A0 - (i / 3) * SWEEP, r = tr * 0.45;
    numeral(Pn, d, tcx + Math.cos(t) * r, tz + Math.sin(t) * r, tr * 0.22, i === 3 ? C.red : HY.tick, lit ? 0.95 : 0.2, 0.0092);
  });
  label(Pn, 'RPM', tcx, tz - tr * 0.62, 0.013, 0.0095);
  if (lit) Pn.disc(tcx, tz, tr * 0.95, HY.glow, 1, 0.0035, 20);
  Pn.annulus(tcx, tz, tr * 0.55, tr * 1.0, HY.glint, 1, 0.016, 8, Math.PI * 0.55, Math.PI * 0.95);
  // The speed window: a billet surround and its unit.
  const dh = I.digitH ?? 0.080, dw = dh * 0.52, dx0 = -0.165, dx1 = dx0 + 2 * (dw + dh * 0.16) + dw;
  frame(K, Pn, dx0 - 0.018, tz - dh * 0.5 - 0.018, dx1 + 0.018, tz + dh * 0.5 + 0.018, 0.004, 0.008);
  label(Pn, 'MPH', (dx0 + dx1) / 2, tz - dh * 0.5 - 0.036, 0.013);
  // The plotter: a billet bezel.
  frame(K, Pn, 0.170 - 0.012, PH * 0.18 - 0.012, HW - 0.008, PH * 0.92 + 0.012, 0.004, 0.008);
  // The three bars, named by their initial: there is no room under a 3 cm column for a word.
  // Named in full: the legend face carries a four-letter word in a 3 cm column at 9 mm.
  [['FUEL', 0.042], ['HULL', 0.086], ['N2O', 0.130]].forEach(([s, u]) => label(Pn, s, u, 0.062, 0.009));
  // Where the pod stands on the dash: a soft shadow on the dash top just aft of it.
  const zd = zB - 0.018;
  for (const [w, d] of [[0.03, 0.06], [0.012, 0.03]]) {
    K.face([[cx - HW - w, yB - d, zd], [cx + HW + w, yB - d, zd], [cx + HW + w, yB + 0.005, zd], [cx - HW - w, yB + 0.005, zd]], [0, 0, 1], 'dash', 0, HY.shade, 1);
  }

  // ── THE FASCIA ─────────────────────────────────────────────────────────────
  const { F, Lp, Rt } = fasciaPanels(K, P);
  // A red pinstripe right across the fascia under the dash lip, broken by the wheel column.
  // It runs to the wall either side, which in a canopy is well short of the Rooster's 0.95 m.
  const fw = P.wallAt ? P.wallAt(P.dashY, -0.28) : { port: cx - 0.95, stbd: cx + 0.95 };
  for (const [a0, a1] of [[-Math.min(0.95, cx - fw.port - 0.03), -0.22], [0.22, Math.min(0.95, fw.stbd - cx - 0.03)]]) F.rect(a0, 0.222, a1, 0.230, HY.anod, 0.1, 0.002);
  // Two raised carbon panels either side of the column, in the band of fascia the eye actually
  // reaches, each a slab with a chamfered billet edge. Port is the helm's one switch panel (the
  // strip that used to sit behind the wheel moved here). Starboard: oil and water, on white faces
  // in billet bezels.
  // The badge is the hull's own name, the way a builder letters the helm of what it built.
  Lp.rect(-0.55, 0.145, -0.31, 0.185, HY.anod, 0.05, 0.002);
  label(Lp, HULL_BADGE[P.hull] || 'OFFSHORE', -0.43, 0.165, (HULL_BADGE[P.hull] || '').length > 7 ? 0.017 : 0.020, 0.004);
  HYDRO_SWITCHES.forEach((sw, i) => {
    const a = SW_U(i), st = switchOn(sw.id, L);
    // The horn is a push button (held, like the truck's cord); the rest are toggles with a lamp over
    // each that lights when it is on and has power.
    if (sw.push) Lp.stud(a, SW_V, 0.011, 0.011, st ? 0.004 : 0.009, HY.anod, st ? 0.4 : 0.05);
    else {
      Lp.toggle(a, SW_V, st);
      Lp.lamp(a, 0.112, 0.004, 0.003, st && on, sw.lamp);
    }
    label(Lp, sw.label, a, 0.026, 0.013, 0.002);
  });
  const oil = on ? 0.62 : 0, temp = on ? 0.48 : 0.1;
  [['OIL', 0.31, oil], ['TEMP', 0.41, temp]].forEach(([s, a, fr]) => {
    Rt.dial(a, 0.135, 0.036, fr, { ticks: 8, major: 2, red: 0.85, face: lit ? [255, 238, 206] : C.white, tick: C.black, needle: C.red, bezel: HY.billet });
    if (lit) Rt.disc(a, 0.135, 0.036, HY.glow, 1, 0.0035, 18);
    Rt.torus(a, 0.135, 0.036, 0.045, HY.billet, 0.05, 0.005, 20, 3);
    Rt.annulus(a, 0.135, 0.019, 0.034, HY.glint, 1, 0.012, 6, Math.PI * 0.55, Math.PI * 0.95);
    label(Rt, s, a, 0.080, 0.011, 0.002);
  });
  // The tabs and the bottle, along the bottom of the slab.
  const [tuU, tuV] = RT_CTRL.tabUp, [tdU] = RT_CTRL.tabDown, [amU, amV] = RT_CTRL.arm;
  Rt.stud(tuU, tuV, 0.010, 0.010, L.tabUp ? 0.004 : 0.008, HY.anod, 0.1);
  Rt.stud(tdU, tuV, 0.010, 0.010, L.tabDown ? 0.004 : 0.008, HY.anod, 0.1);
  label(Rt, 'TABS', (tuU + tdU) / 2, tuV - 0.028, 0.010, 0.002);
  label(Rt, 'UP', tuU, tuV + 0.024, 0.008, 0.002);
  label(Rt, 'DN', tdU, tuV + 0.024, 0.008, 0.002);
  Rt.stud(amU, amV, 0.013, 0.013, L.nitroOn ? 0.004 : 0.009, [150, 40, 36], L.nitroOn ? 0.8 : 0.15);
  label(Rt, 'ARM', amU, amV - 0.028, 0.010, 0.002);
  // The key and the kill, top right — in a ring lit off its own battery so it can be found in a dark
  // cabin before anything is running. Bright while she is dead, dimmed once the engine is live.
  const [igU, igV] = RT_CTRL.ign, [kiU, kiV] = RT_CTRL.kill;
  const ring = on ? 0.35 : 1;
  Rt.annulus(igU, igV, 0.012, 0.017, [120, 190, 255], ring, 0.005, 20);
  Rt.annulus(igU, igV, 0.017, 0.025, [60, 110, 170], on ? 0.1 : 0.55, 0.0045, 20);
  Rt.disc(igU, igV, 0.012, [40, 42, 46], 0, 0.006, 16);
  Rt.stud(igU, igV, 0.004, 0.010, 0.015, HY.billet, on ? 0.05 : 0.3, 0.006);
  label(Rt, 'IGN', igU, igV + 0.042, 0.010, 0.002);
  Rt.disc(igU, igV - 0.045, 0.005, on ? C.green : C.lampOff, on ? 1 : 0, 0.004, 8);
  Rt.stud(kiU, kiV, 0.011, 0.011, 0.012, [190, 40, 36], 0.2);
  label(Rt, 'KILL', kiU, kiV + 0.042, 0.010, 0.002);
  label(Rt, 'RUN', igU + 0.030, igV - 0.045, 0.008, 0.002);
  // The throttle quadrant says which way is which, on the plate the lever runs in (interior-shell
  // throttleFaces), lettered the way the console's inboard face was: a panel just inboard of it.
  const TQ = (P.instr && P.instr.throttle) || null;
  if (TQ) {
    const side = TQ.side ?? 1, tqx = cx + side * (TQ.x ?? 0.44) - side * 0.001;
    const py = TQ.y ?? 0.34, pz = TQ.z ?? -0.44;
    // ⚠ ACROSS IS AFT, NOT FORWARD. The panel faces the driver, who looks at it outboard; facing
    // starboard, forward is to your LEFT, so with `r` pointing forward every letter read right to
    // left and the gate said DAƎHA. Aft is reading order from the seat, so IDLE (aft) is at +u.
    const Q = K.panel([tqx, py, pz], [0, -side, 0], [0, 0, 1]);
    // On the binnacle's inboard face, under its billet cap (interior-shell.js throttleFaces).
    label(Q, 'IDLE', 0.060 * side, -0.030, 0.012, 0.002);
    label(Q, 'AHEAD', -0.065 * side, -0.030, 0.012, 0.002);
  }
  // The panel lights' own pool: a soft warm wash across each slab when the dials are lit.
  if (lit) for (const Pp of [Lp, Rt]) Pp.rect(Pp === Lp ? -0.59 : 0.27, -0.02, Pp === Lp ? -0.27 : 0.59, 0.19, HY.glow, 1, 0.0012);

  // ── THE SIDE CONSOLE ───────────────────────────────────────────────────────
  const { x0, y0, y1, zt, T, S } = consolePanels(K, P);
  // Billet capping along the inboard edge of the carbon top, where your forearm rests.
  K.rod([x0, y0, zt + 0.004], [x0, y1, zt + 0.004], 0.009, 'dash', 0.1, HY.billet, 0.05, 8);
  // (The key, the kill, the bottle and the tabs moved to the starboard fascia slab — see RT_CTRL.)
  // The halo round the control under the pointer (boat-view names it as 'hover' / 'press').
  hotspotHalo(K, hydroHotspots(P), L);
}
