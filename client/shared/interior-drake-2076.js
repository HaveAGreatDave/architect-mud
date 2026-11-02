// THE DRAKE 2076'S COCKPIT: the stock Drake's room, refitted.
//
// The Drake 2076 is the drake class's concept body (mesh_drake_2076.json), a printed air yacht after
// the Sikorsky Raider X with the duck kept as a vanity hull. Its cockpit is the same joke from the
// inside, fifty years on: you still fly it sitting in the duck's head, behind the same centre screen
// and between the same two eyes, and the luxury is all still there (the pantry and the locker in the
// fascia, the champagne in its bucket, the mode lever in its gate, the racing yoke, the captain's
// chair). What is new is the 2076 bar (docs/proposals/fleet-2076.md): one curved band of glass
// across a swept dash, door to door, with every page, key and lamp on it; symbology projected into
// the centre screen with the hands and feet mirrored in its corners; a hologram of the Drake herself
// over the dash that flies, converts, floats and dives as she does; light lines in the alert colour;
// pages that boot in turn; keys that light as the hand comes over them.
//
// Halcyon's Warm Hands Rider voids the hull cover on any flight logged without a living pilot at
// the controls, so the controls are real and the panel says, politely, that the autonomy is advisory.
//
// ── ⚠ A REFIT, NOT A SECOND ROOM ────────────────────────────────────────────
//
// drake2076Profile is drakeProfile's own room (the head, the eyes, the screen, all lofted off the
// mesh's `cabin` block, which the 2076 body keeps unchanged) with the 2076 palette and `refit` set.
// drakeFit draws everything the refit keeps and leaves out what the band replaces (the walnut pod,
// the switch strips, the GPS and clock stands, the trim cheek, the CONV knob), then calls `refit.fit`
// here. No existing trim's cockpit changes: `refit` is only on this profile.
//
// ── ⚠ EVERY DRAKE CONTROL IS STILL HERE, AND EVERY ONE IS IN THE FORWARD VIEW ─
//
// Each stock control id keeps its action in cockpit.js DK_ACT. The ones the band replaced are keys on
// it now; the physical ones low on the console and the fascia (the mode lever, the ramp, the bucket,
// the pantry and the locker) keep their own hotspots AND get a key on the band, so a forward look
// reaches every one. The yoke, the throttle and the pedals sit low, so they are mirrored in the HUD.
//
// Pure: no camera, no DOM. `live` arrives as an argument; decoration may move on wall time, every
// readout moves only on a live value.
import { makeKit, C, clamp, lerp, PANE } from './interior-kit.js';
import { facingPanel, eased, pressPulse, HALO, bootAge, reveal, alertLight, sweep, lightLine, bandFrame, glassBand,
  holoFrame, holoProjector, windscreenHud, lensLamp, HOLO, HOLO_LINE, HOLO_AMBER, HOLO_RED } from './interior-cockpit-kit.js';
import { drakeProfile, drakeHotspots } from './interior-drake.js';
import { MESH_ROWS } from './vehicle-meshes.js';

const TAU = Math.PI * 2, DEG = Math.PI / 180;
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const smooth01 = (t) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };

// ── THE DISPLAY LANGUAGE ─────────────────────────────────────────────────────
// Dark glass, a lit top edge, teal normal, amber caution, red warning, the current value brightest.
const GLOW = [120, 236, 214], GLOW_DIM = [40, 92, 84], SCREEN = [6, 12, 14], INK = [200, 236, 226], LABEL = [150, 196, 186];
const AMBER = [255, 176, 64], RED = [240, 64, 52], GREEN = [110, 255, 160], BLUE = [120, 176, 255], MAGENTA = [230, 90, 220];
const KEY_BODY = [16, 22, 24], KEY_OFF = [40, 50, 52];
// The four modes' own colours, as the stock mode gate's lamps.
const MODE_NAMES = ['HELI', 'PLANE', 'BOAT', 'SUB'];
const MODE_RGB = [[110, 255, 170], [120, 176, 255], [90, 220, 200], [255, 176, 60]];
// The water the hologram floats on: see-through teal.
const HOLO_SEA = [60, 170, 200];
PANE.set(HOLO_SEA, 0.22);

// ── THE PROFILE ──────────────────────────────────────────────────────────────
export function drake2076Profile(doc = MESH_ROWS.drake_2076 || MESH_ROWS.drake) {
  const P0 = drakeProfile(doc, '2076');
  if (!P0) return null;
  return {
    ...P0,
    label: 'Drake 2076 cockpit (the head, refitted)',
    // The band and the HUD carry the cabin's light now: a cooler, brighter flood over the glass.
    floods: [...P0.floods, { p: [0, 0.48, -0.12], r: 0.55 }],
    refit: { fit: d76Fit },
    hotspots(live) { return d76Hotspots(this, live); },
  };
}

// ── THE READINGS ─────────────────────────────────────────────────────────────
const readings = (live) => {
  const L = live || {};
  const fold = clamp(num(L.rotorFold), 0, 1);
  return {
    L,
    pitch: num(L.pitch), bank: num(L.bank), hdg: num(L.hdg),
    ias: Math.max(0, num(L.ias)), alt: Math.max(0, num(L.alt)), vsi: num(L.vsi),
    rpm: clamp(num(L.rpm, 1), 0, 1.1), thr: clamp(num(L.throttle), 0, 1), fold,
    wings: clamp(num(L.wings), 0, 1), boat: clamp(num(L.boat), 0, 1), gear: clamp(num(L.gear, 1), 0, 1),
    convert: clamp(num(L.convert, Math.max(num(L.wings), fold)), 0, 1),
    pusher: clamp(num(L.pusher, num(L.wings) > 0.5 ? num(L.throttle) : 0.1), 0, 1),
    fuel: clamp(num(L.fuel, 1), 0, 1), hull: clamp(num(L.hull, 1), 0, 1),
    powered: L.powered !== false,
    ail: clamp(num(L.stickX), -1, 1), elev: clamp(num(L.stickY), -1, 1), rud: clamp(num(L.rudder), -1, 1),
    trim: clamp(num(L.trim), -0.6, 0.6),
    land: !!L.landingLight, dome: !!L.dome, hour: num(L.hour, 12), phase: num(L.phase), stall: !!L.stall,
    mode: clamp(Math.round(num(L.mode)), 0, 3), nv: !!L.nv, armed: !!L.gunsArmed,
    ammo: Math.max(0, Math.round(num(L.ammo, 1174))), ramp: clamp(num(L.ramp), 0, 1),
    conv: num(L.conv, 1.2),
  };
};
const night = (R) => R.hour < 6.5 || R.hour > 19.5;
const panelOn = (R) => R.powered && (R.L.panelLight != null ? !!R.L.panelLight : night(R));

// ── THE BAND ─────────────────────────────────────────────────────────────────
// Its lower edge runs door to door in a curve that is flat ahead of the pilot and curls back round
// each eye, rising where it passes over the throttle quadrant and the yoke's column so neither
// stands in it. `curve(s)` gives that edge and the outward direction across the dash.
const BAND = { xL: -0.84, xR: 0.84, y0: 0.425, sag: 0.26, z0: -0.335, rise: 0.075, h: 0.26, lean: 0.42 };
const bandZ0 = (x) => BAND.z0 + BAND.rise * smooth01((Math.abs(x) - 0.25) / 0.3);
function curve(s) {
  const x = lerp(BAND.xL, BAND.xR, s), q = x / BAND.xR;
  const y = BAND.y0 - BAND.sag * q ** 4, dy = -4 * BAND.sag * q ** 3 / BAND.xR;
  return { p: [x, y, bandZ0(x)], f: norm([-dy, 1, 0]) };
}
const sOf = (x) => (x - BAND.xL) / (BAND.xR - BAND.xL);
const FRAME = bandFrame(curve, BAND.lean);
const bandPanel = (K, x, v, lift = 0.005) => FRAME.at(K, sOf(x), v, lift);

// The pages: a lit page each, booting in turn. Pages wider than 0.2 m stand off the curved glass.
const PAGE_V = 0.18, PAGE_H = 0.06;
const PAGES = [
  { id: 'status', x: -0.57, w: 0.1, boot: 0.6 },
  { id: 'nav', x: -0.27, w: 0.115, boot: 0.3 },
  { id: 'pfd', x: 0.0, w: 0.13, boot: 0 },
  { id: 'mode', x: 0.27, w: 0.115, boot: 0.15 },
  { id: 'cabin', x: 0.57, w: 0.1, boot: 0.45 },
];
const pagePanel = (K, pg) => bandPanel(K, pg.x, PAGE_V, 0.014);

// ── THE KEYS: glass keys on the band, two rows each side of the yoke ──
// Each is a stock Drake control id, so DK_ACT and DK_TIP in cockpit.js already act on it and name it.
const KEY_X = { L: [-0.355, -0.305, -0.255, -0.205], R: [0.205, 0.255, 0.305, 0.355] };
const ROW = { B: 0.092, A: 0.045 };
const KEYS = [
  { id: 'power', name: 'PWR', x: KEY_X.L[0], v: ROW.B },
  { id: 'lights', name: 'LTS', x: KEY_X.L[1], v: ROW.B },
  { id: 'cabin', name: 'CAB', x: KEY_X.L[2], v: ROW.B },
  { id: 'gear', name: 'GEAR', x: KEY_X.L[3], v: ROW.B },
  { id: 'ramp', name: 'RAMP', x: KEY_X.L[0], v: ROW.A },
  { id: 'pantry', name: 'PANTRY', x: KEY_X.L[1], v: ROW.A },
  { id: 'locker', name: 'LOCKER', x: KEY_X.L[2], v: ROW.A },
  { id: 'bucket', name: 'BUBBLY', x: KEY_X.L[3], v: ROW.A },
  { id: 'quack', name: 'QUACK', x: KEY_X.R[0], v: ROW.B },
  { id: 'guns', name: 'GUNS', x: KEY_X.R[1], v: ROW.B },
  { id: 'nv', name: 'NV', x: KEY_X.R[2], v: ROW.B },
  { id: 'conv', name: 'CONV', x: KEY_X.R[3], v: ROW.B },
  { id: 'rudderL', name: 'YAW L', x: KEY_X.R[0], v: ROW.A, kind: 'rudder' },
  { id: 'rudderR', name: 'YAW R', x: KEY_X.R[1], v: ROW.A, kind: 'rudder' },
  { id: 'modelever', name: 'MODE', x: KEY_X.R[2], v: ROW.A },
];
const KEY_HW = 0.021, KEY_HH = 0.0185;
// The trim: a glass rocker in the last slot, dragged up or down like the stock wheel.
const TRIM_KEY = { x: KEY_X.R[3], v: ROW.A };
// The nav page's four mode tabs (gps0..gps3) along its foot, and the mode page's four gates.
const TAB_V = -0.047, TAB_W = 0.05;
const tabU = (i) => -0.0825 + i * 0.055;
const GATE_V = -0.045, GATE_W = 0.05;
const gateU = (i) => -0.0825 + i * 0.055;

function keyState(id, R) {
  const L = R.L;
  if (id === 'power') return R.powered;
  if (id === 'lights') return R.land;
  if (id === 'cabin') return R.dome && R.powered;
  if (id === 'gear') return R.gear > 0.98;
  if (id === 'quack') return !!L.quack;
  if (id === 'guns') return R.armed;
  if (id === 'nv') return R.nv;
  if (id === 'conv') return R.armed;
  if (id === 'ramp') return R.ramp > 0.5;
  if (id === 'pantry') return num(L.pantry) > 0.5;
  if (id === 'locker') return num(L.locker) > 0.5;
  if (id === 'bucket') return L.champagne !== 0;
  if (id === 'rudderL') return R.rud < -0.05;
  if (id === 'rudderR') return R.rud > 0.05;
  if (id === 'modelever') return R.convert > 0.01 && R.convert < 0.99;
  return false;
}
function keyColour(id, R) {
  if (id === 'power') return GREEN;
  if (id === 'guns') return RED;
  if (id === 'nv') return [90, 255, 120];
  if (id === 'quack' || id === 'bucket') return [255, 160, 70];
  if (id === 'ramp' || id === 'modelever') return AMBER;
  if (id === 'gear') return R.gear > 0.02 && R.gear < 0.98 ? AMBER : GREEN;
  return GLOW;
}

// ── THE HOTSPOTS ─────────────────────────────────────────────────────────────
// The band's keys and pages first (a halo finds the first of an id), then the physical controls the
// refit keeps, at the places drakeFit draws them.
const KEEP = new Set(['throttle', 'mode0', 'mode1', 'mode2', 'mode3', 'modelever', 'pantry', 'locker', 'bucket', 'ramp', 'yoke', 'rudderL', 'rudderR']);
export function d76Hotspots(P, live) {
  const K = makeKit(() => {}), out = [];
  for (const k of KEYS) out.push({ id: k.id, p: bandPanel(K, k.x, k.v, 0.004).pt(0, 0, 0.012), r: 0.022, kind: k.kind || 'click' });
  out.push({ id: 'trim', p: bandPanel(K, TRIM_KEY.x, TRIM_KEY.v, 0.004).pt(0, 0, 0.012), r: 0.022, kind: 'trim' });
  const nav = pagePanel(K, PAGES[1]), mode = pagePanel(K, PAGES[3]);
  for (let i = 0; i < 4; i++) out.push({ id: 'gps' + i, p: nav.pt(tabU(i), TAB_V, 0.006), r: 0.022, kind: 'click' });
  out.push({ id: 'ck:gps', p: nav.pt(0, 0.012, 0.006), r: 0.05, kind: 'click' });
  for (let i = 0; i < 4; i++) out.push({ id: 'mode' + i, p: mode.pt(gateU(i), GATE_V, 0.006), r: 0.022, kind: 'click' });
  for (const h of drakeHotspots(live)) if (KEEP.has(h.id)) out.push(h);
  return out;
}

// ── THE FIT-OUT, AS drakeFit CALLS IT ────────────────────────────────────────
// `ctx` is the stock file's own: the palette `T` and the nameplate.
function d76Fit(K, P, live, ctx) {
  const R = readings(live), L = R.L, T = ctx.T;
  const lit = R.powered, panel = panelOn(R);
  const boot = bootAge(live);
  // The cabin's light lines carry the alert: teal, amber on low hydrogen, red and breathing on a hull
  // or stall warning. They are the first thing in the cabin to change colour.
  const warn = lit && (R.hull < 0.3 || R.stall), caution = lit && R.fuel < 0.15;
  const al = alertLight(caution, warn), lineK = (k) => (lit ? k * al.k : 0.05);
  const hot = live && (live.press || live.hover);

  // ── THE DASH: a wing swept along the band's curve ──
  // Up the glass, forward over a crown, down the front onto the stock dash top; thinner under the
  // lip, and lower toward the doors as the head closes in over it.
  const gt = [BAND.h * BAND.lean / Math.hypot(1, BAND.lean), BAND.h / Math.hypot(1, BAND.lean)];
  const N = 40, rings = [];
  for (let i = 0; i <= N; i++) {
    const s = i / N, c = curve(s), e = Math.abs(2 * s - 1) ** 3, drop = -0.40 - c.p[2];
    // The face under the glass stands 4 mm behind it, so the two never fight for the same plane.
    const SEC = [[0.004, 0], [gt[0] + 0.004, gt[1]], [0.13, gt[1] + 0.012], [0.2, gt[1] + 0.014 - 0.05 * e], [0.26, gt[1] - 0.005 - 0.08 * e], [0.3, gt[1] * 0.75 - 0.1 * e],
      [0.32, drop * (1 - 0.5 * e)], [0.24, drop * (1 - 0.5 * e)], [0.12, -0.012], [-0.012, -0.01], [-0.016, -0.004], [0.004, 0]];
    rings.push(SEC.map(([f, z]) => [c.p[0] + c.f[0] * f, c.p[1] + c.f[1] * f, c.p[2] + z]));
  }
  sweep(K, rings, 'dash', 0.1, T.walnut);
  for (const r of [rings[0], rings[N]]) {
    const n = norm(cross(sub(r[3], r[1]), sub(r[7], r[1])));
    K.face(r.slice(0, -1), n, 'dash', 0.05, T.walnutDk);
    K.face(r.slice(0, -1).reverse(), mul(n, -1), 'dash', 0.05, T.walnutDk);
  }
  // A titanium bead along the crown, and light lines along the lip under the glass and the crown's edge.
  for (let i = 0; i < N; i++) K.rod(add(rings[i][2], [0, 0, 0.002]), add(rings[i + 1][2], [0, 0, 0.002]), 0.004, 'dash', 0.35, T.gold, 0.08, 5, false);
  lightLine(K, rings.map((r) => add(r[10], [0, -0.002, -0.001])), 0.003, al.rgb, lineK(0.85));
  lightLine(K, rings.slice(3, -3).map((r) => add(r[5], [0, -0.002, 0.002])), 0.0022, al.rgb, lineK(0.4));

  // ── THE BAND: one sheet of glass, door to door ──
  glassBand(K, curve, { h: BAND.h, lean: BAND.lean, segs: 44, lit, light: al.rgb, lightK: lineK(1), substrate: SCREEN });

  // ── THE PAGES, booting in turn ──
  for (const pg of PAGES) {
    const Pn = pagePanel(K, pg), up = reveal(boot, pg.boot);
    Pn.rect(-pg.w, -PAGE_H, pg.w, PAGE_H, [10, 16, 18], 0, 0.0006);
    if (!lit || up <= 0) continue;
    if (up < 1) {
      const y = lerp(-PAGE_H, PAGE_H, up);
      Pn.rect(-pg.w, -PAGE_H, pg.w, y, SCREEN, 0.3 * up, 0.001);
      Pn.rect(-pg.w, y - 0.002, pg.w, y + 0.002, GLOW, 1, 0.0025);
      continue;
    }
    Pn.rect(-pg.w + 0.004, PAGE_H - 0.0035, pg.w - 0.004, PAGE_H - 0.0015, warn ? RED : caution ? AMBER : GLOW, 0.85, 0.0018);
    if (pg.id === 'pfd') pfd(Pn, R);
    else if (pg.id === 'nav') navPage(Pn, R, live, pg.w);
    else if (pg.id === 'mode') modePage(Pn, R, pg.w);
    else if (pg.id === 'status') statusPage(Pn, R, pg.w, warn);
    else if (pg.id === 'cabin') cabinPage(Pn, R, pg.w);
  }

  // ── THE KEYS ──
  // A key sinks while pressed and comes back, its light eases with its circuit, it brightens as the
  // hand comes over it, and a ring flashes round it when its state changes.
  for (const k of KEYS) {
    const Kp = bandPanel(K, k.x, k.v, 0.004), on = keyState(k.id, R) && (lit || k.id === 'power');
    const pressed = !!live && live.press === k.id, near = !!live && live.hover === k.id;
    const rgb = keyColour(k.id, R);
    const glow = eased('d76:glow:' + k.id, on ? 1 : 0, 10), depth = eased('d76:dip:' + k.id, pressed ? 0.002 : 0.007, 30);
    const hand = eased('d76:near:' + k.id, near ? 1 : 0, 14);
    Kp.rect(-KEY_HW - 0.004, -KEY_HH - 0.004, KEY_HW + 0.004, KEY_HH + 0.004, KEY_BODY, 0, 0.0005);
    Kp.rect(-KEY_HW - 0.0035, -KEY_HH - 0.0035, KEY_HW + 0.0035, -KEY_HH - 0.002, GLOW, (lit ? 0.2 : 0) + hand * 0.8, 0.001);
    Kp.stud(0, 0, KEY_HW, KEY_HH, depth, rgb.map((c, i) => lerp(KEY_OFF[i], c, glow * 0.8)), glow * 0.85 + hand * 0.15, 0.0015);
    Kp.fitText(k.name, 0, -0.0045, KEY_HW * 1.8, 0.0095, glow > 0.5 ? [10, 22, 20] : [214, 224, 220], glow > 0.5 ? 0 : (panel ? 0.6 : 0.25), depth + 0.0025);
    // CONV carries the convergence along its foot: where the two guns meet, 0.5 to 2.2.
    if (k.id === 'conv') {
      const f = clamp((R.conv - 0.5) / 1.7, 0, 1);
      Kp.rect(-KEY_HW + 0.003, -KEY_HH + 0.0025, KEY_HW - 0.003, -KEY_HH + 0.0045, [20, 30, 32], 0, depth + 0.0026);
      Kp.rect(-KEY_HW + 0.003, -KEY_HH + 0.0025, -KEY_HW + 0.003 + (2 * KEY_HW - 0.006) * f, -KEY_HH + 0.0045, R.armed ? RED : GLOW, lit ? 0.9 : 0.1, depth + 0.0028);
    }
    const flash = pressPulse('d76:key:' + k.id, on);
    if (flash > 0.02) Kp.rect(-KEY_HW - 0.007, -KEY_HH - 0.007, KEY_HW + 0.007, KEY_HH + 0.007, HALO, flash, 0.004);
  }
  // The trim rocker: a slot with the setting lit from its centre toward the end she is trimmed to,
  // green nose up and red nose down, and an index that rides with it.
  {
    const Tp = bandPanel(K, TRIM_KEY.x, TRIM_KEY.v, 0.004), f = R.trim / 0.6, near = eased('d76:near:trim', live && (live.hover === 'trim' || live.press === 'trim') ? 1 : 0, 14);
    Tp.rect(-KEY_HW - 0.004, -KEY_HH - 0.004, KEY_HW + 0.004, KEY_HH + 0.004, KEY_BODY, 0, 0.0005);
    const su = 0.0125;
    Tp.rect(su - 0.004, -KEY_HH, su + 0.004, KEY_HH, [6, 10, 10], 0, 0.002);
    const iv = -f * KEY_HH * 0.85;
    if (Math.abs(f) > 0.03) Tp.rect(su - 0.0035, Math.min(0, iv), su + 0.0035, Math.max(0, iv), f > 0 ? GREEN : RED, lit ? 0.9 : 0.1, 0.0024);
    Tp.stud(su, iv, 0.0065, 0.004, 0.006, [200, 206, 204], 0.15 + near * 0.6, 0.002);
    Tp.fitText('TRIM', -0.0065, -0.0045, 0.025, 0.0095, [214, 224, 220], panel ? 0.6 : 0.25, 0.003);
    Tp.rect(-KEY_HW - 0.0035, -KEY_HH - 0.0035, KEY_HW + 0.0035, -KEY_HH - 0.002, GLOW, (lit ? 0.2 : 0) + near * 0.8, 0.001);
  }

  // ── THE NAMEPLATE on the crown over the pilot's page ──
  {
    const c = curve(0.5), o = add(add(c.p, mul(c.f, gt[0] + 0.03)), [0, 0, gt[1] + 0.022]);
    const Np = facingPanel(K, o, 'dash', 0.3);
    ctx.nameplate(Np, 0, 0, 0.013, (live && live.plate) || 'DRAKE', 0.2);
  }

  // ── THE WINDSCREEN HUD: projected into the centre screen, the hands and feet in its corners ──
  if (lit) windscreenHud(K, R, { dist: 0.95, z: 0.0, hw: 0.26, hh: 0.13, warn, caution, boot: reveal(boot, 0.2),
    mirrors: { stick: [R.ail, R.elev], thrs: [R.thr], rud: R.rud } });

  // ── THE HOLOGRAM, over the crown left of centre: the Drake herself ──
  {
    const c = curve(sOf(-0.24)), base = add(add(c.p, mul(c.f, gt[0] + 0.05)), [0, 0, gt[1] + 0.016]);
    const fr = R.fuel < 0.15 ? HOLO_RED : R.fuel < 0.3 ? HOLO_AMBER : HOLO_LINE;
    holoProjector(K, base, 0.05, 0.045, lit ? R.fuel : 0, fr);
    if (lit && reveal(boot, 0.7) > 0) holoDrake(K, add(base, [0, 0, 0.075]), R);
  }

  // ── THE CONSOLE'S LIGHT LINES, and a ring round the yoke boss and the throttle as the hand nears ──
  {
    const cX = P.xCentre + 0.45, cw = 0.15, y0 = -0.36, y1 = P.dashY, z = -0.615;
    for (const s of [-1, 1]) lightLine(K, [[cX + s * (cw + 0.006), y0, z], [cX + s * (cw + 0.006), y1, z]], 0.0028, al.rgb, lineK(0.7));
    const yk = eased('d76:near:yoke', live && (live.hover === 'yoke' || live.press === 'yoke') ? 1 : 0, 12);
    const hub = [0, 0.30 - R.elev * 0.02, -0.29], up = norm([0, 0.67, 0.74]);
    K.torus(add(hub, mul(norm([0, -0.74, 0.67]), -0.05)), [1, 0, 0], up, 0.03, 0.003, 18, 'dash', 0.2, al.rgb, lit ? 0.3 + 0.7 * yk : 0);
    const tk = eased('d76:near:throttle', live && (live.hover === 'throttle' || live.press === 'throttle') ? 1 : 0, 12);
    const a = (-40 + R.thr * 80) * DEG, knob = [0.43, 0.39 + Math.sin(a) * 0.105, -0.40 + Math.cos(a) * 0.105 + 0.002];
    K.torus(add(knob, [0, 0, -0.004]), [1, 0, 0], [0, 1, 0], 0.017, 0.0025, 16, 'dash', 0.2, al.rgb, lit ? 0.3 + 0.7 * tk : 0);
  }

  // ── WHAT YOUR HAND IS ON: a halo round the click control under the pointer ──
  if (hot) {
    const h = d76Hotspots(P, live).find((x) => x.id === hot);
    if (h && h.kind === 'click') {
      const Hp = facingPanel(K, h.p, 'dash', 0);
      Hp.annulus(0, 0, h.r * 1.0, h.r * 1.18, HALO, 1, 0.012, 24);
    }
  }
}

// ── THE HOLOGRAM: the Drake in miniature, twenty centimetres from bill to fan ──
// Her hull as section rings and a keel line, the head and the bill, the wings swept on `wings`, the
// rotor folding down on `rotorFold` with its four blades a side turning on the rotor phase and ringed
// at its speed, the boom swinging down on `boat`, the feet on `gear`, and the sea when she floats or
// dives. The frame is her pitch and bank.
function holoDrake(K, c, R) {
  const H = holoFrame(K, c, R.pitch, R.bank), sc = 0.085;
  const M = (f, g, h) => [g * sc, f * sc, (h - 0.12) * sc];
  const on = R.powered && R.rpm > 0.02, frac = clamp(R.rpm / 1.05, 0, 1);
  // The hull: rings at the loft's own stations, and the keel and back lines.
  const ST = [[0.6, 0.15, 0.12, 0.19, 0.105], [0.44, 0.24, 0.2, 0.29, 0.09], [0.18, 0.31, 0.23, 0.33, 0.054], [-0.11, 0.3, 0.26, 0.27, 0.07], [-0.32, 0.25, 0.22, 0.21, 0.095], [-0.48, 0.12, 0.13, 0.11, 0.125]];
  const ring = (f, rg, rvT, rvB, cz, n = 14) => {
    const pts = [];
    for (let i = 0; i <= n; i++) { const t = i * TAU / n, s = Math.sin(t); pts.push(M(f, Math.cos(t) * rg, cz + (s >= 0 ? s * rvT : s * rvB))); }
    for (let i = 0; i < n; i++) H.line(pts[i], pts[i + 1], 0.0006);
  };
  for (const s of ST) ring(...s);
  for (const [k, sgn] of [[2, 1], [3, -1]]) for (let i = 0; i + 1 < ST.length; i++) {
    const A = ST[i], B = ST[i + 1];
    H.line(M(A[0], 0, A[4] + sgn * A[k]), M(B[0], 0, B[4] + sgn * B[k]), 0.0008);
  }
  for (const s of [-1, 1]) for (let i = 0; i + 1 < ST.length; i++) H.line(M(ST[i][0], s * ST[i][1], ST[i][4]), M(ST[i + 1][0], s * ST[i + 1][1], ST[i + 1][4]), 0.0006);
  // The head on its neck, and the bill.
  ring(0.64, 0.15, 0.17, 0.13, 0.34, 12); ring(0.5, 0.15, 0.17, 0.14, 0.33, 12); ring(0.74, 0.11, 0.12, 0.1, 0.335, 10);
  H.plate([M(0.8, -0.055, 0.29), M(0.98, -0.045, 0.27), M(0.98, 0.045, 0.27), M(0.8, 0.055, 0.29)], HOLO_AMBER, 0.5);
  // The wings: folded back along the flanks, spread into a plane.
  const w = R.wings;
  for (const s of [-1, 1]) {
    const tipF = lerp(-0.34, 0.17, w), tipG = lerp(0.31, 0.84, w), tipH = lerp(0.2, 0.15, w);
    const rootA = M(0.25, s * 0.2, 0.12), rootB = M(0.01, s * 0.2, 0.12), tip = M(tipF, s * tipG, tipH), tipB = M(tipF - lerp(0.12, 0.16, w), s * tipG, tipH);
    H.plate([rootA, tip, tipB, rootB], HOLO, 0.55);
    H.line(rootA, tip, 0.0009); H.line(tip, tipB, 0.0007); H.line(tipB, rootB, 0.0007);
  }
  // The rotor: the head goes down into the pylon and the blades fold aft as she converts.
  const fold = R.fold, hz = 0.69 - 0.38 * fold, rr = 0.95;
  H.line(M(0.1, 0, 0.2), M(0.1, 0, hz + 0.05), 0.0012);
  if (fold < 0.5) {
    const k = 1 - fold * 2;
    H.ring(M(0.1, 0, hz), [sc, 0, 0], [0, sc, 0], rr * k, 22, frac > 0.85 ? HOLO_LINE : HOLO_AMBER, on ? 1 : 0.3);
    for (const [dz, dir, ph] of [[0.045, 1, 0], [-0.045, -1, 0.4]]) for (let b = 0; b < 4; b++) {
      const t = (on ? R.phase * 2.2 * dir : 0) + ph + b * TAU / 4, d = [Math.cos(t) * rr * k, Math.sin(t) * rr * k];
      H.line(M(0.1, 0, hz + dz), M(0.1 + d[1], d[0], hz + dz), 0.0009, HOLO_LINE, 1);
    }
  } else {
    for (let b = 0; b < 4; b++) H.line(M(0.1, (b - 1.5) * 0.02, hz + 0.05), M(-0.8, (b - 1.5) * 0.02, 0.22), 0.0007);
  }
  // The tail: the boom swings down about its root on the water, the duct with it, its fan turning.
  const tb = -30 * R.boat * DEG, piv = [-0.46, 0.2];
  const rot = (f, h) => { const df = f - piv[0], dh = h - piv[1]; return [piv[0] + df * Math.cos(tb) - dh * Math.sin(tb), piv[1] + df * Math.sin(tb) + dh * Math.cos(tb)]; };
  const [bf, bh] = rot(-1.12, 0.236), [rf, rh] = rot(-0.46, 0.2);
  H.line(M(rf, 0, rh), M(bf, 0, bh), 0.0011);
  { const pts = []; for (let i = 0; i <= 16; i++) { const t = i * TAU / 16; pts.push(M(bf, Math.cos(t) * 0.16, bh + Math.sin(t) * 0.16)); } for (let i = 0; i < 16; i++) H.line(pts[i], pts[i + 1], 0.0008); }
  for (let b = 0; b < 3; b++) { const t = (on ? R.phase * 6 : 0) + b * TAU / 3; H.line(M(bf, 0, bh), M(bf, Math.cos(t) * 0.14, bh + Math.sin(t) * 0.14), 0.0007, HOLO_LINE, 1); }
  const [ff, fh] = rot(-1.0, 0.56);
  H.plate([M(rot(-0.88, 0.25)[0], 0, rot(-0.88, 0.25)[1]), M(ff, 0, fh), M(bf + 0.03, 0, bh + 0.1)], HOLO, 0.5);
  // The feet: down and splayed with the gear down, gone up into the bay with it up.
  if (R.gear > 0.05 && !R.L.feetGone) for (const s of [-1, 1]) {
    const g = R.gear;
    H.line(M(0.2, s * 0.11, -0.2), M(0.16, s * (0.11 + 0.14 * g), -0.2 - 0.12 * g), 0.0009);
    H.line(M(0.16, s * (0.11 + 0.14 * g), -0.2 - 0.12 * g), M(0.3, s * (0.11 + 0.08 * g), -0.2 - 0.13 * g), 0.0009, HOLO_AMBER, 1);
  }
  // The sea: under her on the hull, over her when she has dived.
  const dive = R.L.dive || {};
  if (R.boat > 0.5 || dive.boat || dive.under) {
    const z = dive.under ? 0.62 : -0.17;
    H.plate([M(0.9, -0.5, z), M(0.9, 0.5, z), M(-1.2, 0.5, z), M(-1.2, -0.5, z)], HOLO_SEA, 0.4);
  }
}

// ── THE PILOT'S PAGE: attitude, speed and height tapes, the heading, the climb ──
function pfd(Pn, R) {
  Pn.attitude(0, 0.002, 0.05, R.pitch, R.bank);
  tape(Pn, -0.098, R.ias, 5, 10, 'KT');
  tape(Pn, 0.098, R.alt, 50, 100, 'FT');
  const span = 30, w = 0.06;
  Pn.rect(-w, 0.042, w, 0.056, [10, 18, 20], 0.3, 0.002);
  for (let d = Math.floor((R.hdg - span) / 5) * 5; d <= R.hdg + span; d += 5) {
    const u = ((d - R.hdg) / span) * w;
    if (Math.abs(u) > w - 0.002) continue;
    const big = ((d % 30) + 30) % 30 === 0;
    Pn.rect(u - 0.0007, big ? 0.043 : 0.048, u + 0.0007, 0.055, INK, 0.7, 0.003);
  }
  Pn.rect(-0.016, 0.041, 0.016, 0.057, SCREEN, 0.2, 0.0035);
  Pn.digits(-0.0135, 0.044, 0.01, String(Math.round(((R.hdg % 360) + 360) % 360)).padStart(3, '0'), GLOW, false);
  // The climb: a bar from the middle of the right edge, up or down.
  const vs = clamp(R.vsi / 1500, -1, 1);
  Pn.rect(0.124, -0.045, 0.128, 0.045, [20, 30, 32], 0.2, 0.002);
  if (Math.abs(vs) > 0.01) Pn.rect(0.1235, Math.min(0, vs * 0.045), 0.1285, Math.max(0, vs * 0.045), vs > 0 ? GREEN : AMBER, 0.9, 0.003);
  // The rotor and the pusher: the two things this aircraft flies on, as bars under the ball.
  const rot = clamp(R.rpm * (1 - R.fold), 0, 1.05);
  for (const [u, v, name, col] of [[-0.05, rot, 'ROT', rot > 0.85 || R.fold > 0.5 ? GLOW : AMBER], [0.012, R.pusher, 'PUSH', GLOW]]) {
    Pn.text(name, u, -0.054, 0.0095, LABEL, 0.5, 0.003);
    Pn.rect(u + 0.016, -0.057, u + 0.05, -0.05, [20, 30, 32], 0.2, 0.002);
    if (v > 0.01) Pn.rect(u + 0.016, -0.057, u + 0.016 + 0.034 * clamp(v, 0, 1), -0.05, col, 0.9, 0.003);
  }
  if (R.stall) Pn.rect(-0.12, -0.06, 0.12, -0.0585, RED, 1, 0.0035);
}
function tape(Pn, u, v, step, major, unit) {
  const hh = 0.04, w = 0.022, span = step * 6;
  Pn.rect(u - w, -hh, u + w, hh, [10, 18, 20], 0.3, 0.002);
  for (let t = Math.floor((v - span) / step) * step; t <= v + span; t += step) {
    if (t < 0) continue;
    const b = ((t - v) / span) * hh;
    if (Math.abs(b) > hh - 0.003) continue;
    const side = u < 0 ? 1 : -1, big = t % major === 0;
    Pn.rect(u + side * w - side * (big ? 0.01 : 0.005), b - 0.0006, u + side * w, b + 0.0006, INK, 0.7, 0.003);
  }
  Pn.rect(u - w - 0.003, -0.01, u + w + 0.003, 0.01, SCREEN, 0.2, 0.0035);
  const s = String(Math.round(v));
  Pn.digits(u - w + 0.002, -0.0065, 0.012, s.length > 5 ? s.slice(-5) : s, GLOW, false);
  Pn.text(unit, u, hh + 0.007, 0.009, LABEL, 0.5, 0.003);
}

// ── THE NAV PAGE: the stock GPS's four modes, its tabs along the foot ──
// Everything is relative to the aircraft in tiles (cockpit.js drakeGps), heading up.
function navPage(Pn, R, live, w) {
  const G = (live && live.gps) || { mode: 0, contacts: [], fields: [], hull: 100, ammo: 0, ammoCap: 1, msl: 0 };
  const mode = clamp(Math.round(num(G.mode)), 0, 3);
  const cu = 0, cv = 0.008, RR = 0.034, h = (R.hdg) * DEG;
  // North is -dy (cockpit.js bearingDeg); the page is heading up.
  const toPage = (dx, dy, range) => {
    const d = Math.hypot(dx, dy), rel = Math.atan2(dx, -dy) - h, k = RR / range;
    return [cu + Math.sin(rel) * d * k, cv + Math.cos(rel) * d * k];
  };
  Pn.text(['MAP', 'RADAR', 'DAMAGE', 'AMMO'][mode], -w + 0.012, 0.047, 0.0095, LABEL, 0.5, 0.003);
  const g = live && live.gpsTo;
  if (g && Number.isFinite(g.dist)) Pn.digits(w - 0.04, 0.041, 0.011, String(Math.min(999, Math.round(g.dist))).padStart(3, ' '), GLOW, false);
  if (mode === 0 || mode === 1) {
    const range = mode === 0 ? 40 : 15;
    Pn.annulus(cu, cv, RR - 0.0008, RR + 0.0008, GLOW_DIM, 0.8, 0.004, 28);
    Pn.annulus(cu, cv, RR * 0.5 - 0.0007, RR * 0.5 + 0.0007, GLOW_DIM, 0.6, 0.004, 20);
    const s = 0.007;
    Pn.plate([[cu, cv + s], [cu + s * 0.7, cv - s * 0.7], [cu, cv - s * 0.3], [cu - s * 0.7, cv - s * 0.7]], INK, 0.95, 0.006);
    const list = mode === 0 ? (G.fields || []) : (G.contacts || []);
    for (const c of list.slice(0, mode === 0 ? 12 : 24)) {
      const [u, v] = toPage(c.dx, c.dy, range);
      if (Math.hypot(u - cu, v - cv) > RR) continue;
      if (mode === 0) Pn.rect(u - 0.003, v - 0.003, u + 0.003, v + 0.003, GLOW, 0.9, 0.005);
      else Pn.disc(u, v, 0.0034, c.ground ? BLUE : AMBER, 0.95, 0.005, 8);
    }
    if (mode === 0 && g && Number.isFinite(g.rel)) {
      const t = Math.PI / 2 - g.rel * DEG;
      Pn.spoke(cu, cv, t, 0.006, RR, 0.0011, MAGENTA, 0.95, 0.0055);
    }
    Pn.text(mode === 0 ? '40' : '15', cu + RR + 0.012, cv + RR - 0.004, 0.009, LABEL, 0.4, 0.003);
  } else if (mode === 2) {
    // The hull plan, coloured by what is left of her, and the number.
    const hp = clamp(num(G.hull, 100) / 100, 0, 1), col = hp < 0.3 ? RED : hp < 0.6 ? AMBER : GLOW;
    const P2 = (f, g2) => [cu - 0.03 + g2 * 0.03, cv + f * 0.03];
    Pn.plate([P2(1, 0), P2(0.6, 0.35), P2(-0.6, 0.35), P2(-1.1, 0.12), P2(-1.1, -0.12), P2(-0.6, -0.35), P2(0.6, -0.35)], col, 0.5, 0.004);
    for (const s of [-1, 1]) Pn.plate([P2(0.2, s * 0.35), P2(-0.1, s * 1.1), P2(-0.35, s * 1.1), P2(-0.3, s * 0.35)], col, 0.4, 0.004);
    Pn.digits(0.03, -0.006, 0.016, String(Math.round(hp * 100)).padStart(3, ' '), col, false);
    Pn.text('HULL', 0.055, 0.025, 0.009, LABEL, 0.5, 0.003);
  } else {
    const cap = Math.max(1, num(G.ammoCap, 1)), am = Math.max(0, Math.round(num(G.ammo, R.ammo))), f = clamp(am / cap, 0, 1);
    Pn.digits(-0.07, 0.006, 0.018, String(am).padStart(5, ' '), f < 0.2 ? RED : GLOW, false);
    Pn.rect(-0.08, -0.016, 0.08, -0.008, [20, 30, 32], 0.2, 0.002);
    if (f > 0.005) Pn.rect(-0.08, -0.016, -0.08 + 0.16 * f, -0.008, f < 0.2 ? RED : AMBER, 0.9, 0.003);
    Pn.text('RDS', 0.06, 0.03, 0.009, LABEL, 0.5, 0.003);
    Pn.text('MSL ' + Math.max(0, Math.round(num(G.msl))), 0.06, 0.01, 0.009, INK, 0.6, 0.003);
  }
  // The four tabs: the one in use lit.
  for (let i = 0; i < 4; i++) {
    const u = tabU(i), sel = i === mode;
    Pn.rect(u - TAB_W / 2, TAB_V - 0.0085, u + TAB_W / 2, TAB_V + 0.0085, sel ? GLOW : [16, 26, 28], sel ? 0.8 : 0.1, 0.003);
    Pn.fitText(['MAP', 'RADAR', 'DMG', 'AMMO'][i], u, TAB_V - 0.0045, TAB_W - 0.008, 0.009, sel ? [8, 20, 18] : INK, sel ? 0 : 0.5, 0.0045);
  }
}

// ── THE MODE PAGE: the Drake in plan doing what she is doing, and the four gates ──
function modePage(Pn, R, w) {
  const m = R.mode, moving = R.convert > 0.01 && R.convert < 0.99;
  Pn.text('MODE', -w + 0.014, 0.047, 0.0095, LABEL, 0.5, 0.003);
  Pn.text(MODE_NAMES[m], w - 0.03, 0.045, 0.012, MODE_RGB[m], 0.9, 0.003);
  // The plan: hull, head, wings at their sweep, the rotor disc shrinking as it folds.
  const cu = -0.045, cv = 0.006, k = 0.03, P2 = (f, g) => [cu + g * k, cv + f * k];
  Pn.plate([P2(0.75, 0), P2(0.45, 0.3), P2(-0.3, 0.28), P2(-1.0, 0.06), P2(-1.0, -0.06), P2(-0.3, -0.28), P2(0.45, -0.3)], [70, 110, 104], 0.6, 0.003);
  Pn.disc(...P2(0.6, 0), 0.006, [90, 140, 132], 0.6, 0.0035, 10);
  for (const s of [-1, 1]) {
    const tipF = lerp(-0.34, 0.17, R.wings), tipG = lerp(0.31, 0.84, R.wings);
    Pn.plate([P2(0.25, s * 0.2), P2(tipF, s * tipG), P2(tipF - 0.14, s * tipG), P2(0.01, s * 0.2)], moving ? AMBER : R.wings > 0.5 ? BLUE : GLOW_DIM, 0.8, 0.004);
  }
  if (R.fold < 0.95) Pn.annulus(...P2(0.1, 0), 0.95 * k * (1 - R.fold) - 0.0008, 0.95 * k * (1 - R.fold) + 0.0008, R.rpm > 0.85 ? GLOW : AMBER, 0.9, 0.0045, 22);
  // The conversion: ROTOR at the bottom of the bar, WING at the top, amber while she travels.
  const bx = 0.035;
  Pn.rect(bx - 0.003, -0.03, bx + 0.003, 0.034, [20, 30, 32], 0.2, 0.002);
  if (R.convert > 0.005) Pn.rect(bx - 0.003, -0.03, bx + 0.003, -0.03 + 0.064 * R.convert, moving ? AMBER : R.convert > 0.99 ? BLUE : GLOW, 0.9, 0.003);
  Pn.text('WING', bx + 0.03, 0.028, 0.009, R.convert > 0.99 ? BLUE : LABEL, 0.5, 0.003);
  Pn.text('ROTOR', bx + 0.034, -0.024, 0.009, R.convert < 0.01 ? GLOW : LABEL, 0.5, 0.003);
  Pn.digits(bx + 0.012, -0.007, 0.01, String(Math.round(R.convert * 100)).padStart(3, ' '), moving ? AMBER : INK, false);
  // The four gates: the one she is in lit in its colour; the others green or red by whether they can
  // be taken now (cockpit.js drakeModeReady), dim when nobody says.
  const ready = Array.isArray(R.L.ready) ? R.L.ready : [];
  for (let i = 0; i < 4; i++) {
    const u = gateU(i), sel = i === m, rd = ready[i];
    const col = sel ? MODE_RGB[i] : rd === true ? [40, 120, 70] : rd === false ? [120, 34, 28] : [16, 26, 28];
    Pn.rect(u - GATE_W / 2, GATE_V - 0.0085, u + GATE_W / 2, GATE_V + 0.0085, col, sel ? 0.85 : 0.35, 0.003);
    Pn.fitText(MODE_NAMES[i], u, GATE_V - 0.0045, GATE_W - 0.008, 0.009, sel ? [8, 20, 18] : INK, sel ? 0 : 0.5, 0.0045);
  }
}

// ── THE STATUS PAGE, round the left: what the aircraft thinks of you ──
function statusPage(Pn, R, w, warn) {
  const handsOn = Math.abs(R.ail) > 0.03 || Math.abs(R.elev) > 0.03 || Math.abs(R.rud) > 0.03;
  // ⚠ PILOT PRESENT IS THE RIDER'S LAMP: lit whenever the seat is powered and occupied, which is
  // whenever this cockpit is drawn. It is the one thing on the panel the insurer reads.
  const lamps = [['PILOT PRESENT', true, GREEN], ['HANDS ON', handsOn, GLOW], ['AUTONOMY ADVISORY', true, AMBER],
    ['LOW H2', R.fuel < 0.15, RED], ['HULL', R.hull < 0.3, RED], ['STALL', R.stall, RED]];
  lamps.forEach(([name, on, rgb], i) => lensLamp(Pn, (i % 2 ? 0.05 : -0.05), 0.033 - Math.floor(i / 2) * 0.026, 0.092, 0.02, on, rgb, name));
  // The hydrogen: the tank as a bar, the number beside it.
  Pn.text('H2', -w + 0.014, -0.05, 0.0095, LABEL, 0.5, 0.003);
  Pn.rect(-0.07, -0.054, 0.04, -0.046, [20, 30, 32], 0.2, 0.002);
  if (R.fuel > 0.005) Pn.rect(-0.07, -0.054, -0.07 + 0.11 * R.fuel, -0.046, R.fuel < 0.15 ? RED : R.fuel < 0.3 ? AMBER : GLOW, 0.9, 0.003);
  Pn.digits(0.05, -0.056, 0.01, String(Math.round(R.fuel * 100)).padStart(3, ' '), warn ? RED : GLOW, false);
}

// ── THE CABIN PAGE, round the right: the hour, and the yacht's own state ──
function cabinPage(Pn, R, w) {
  const L = R.L, hh = Math.floor(((R.hour % 24) + 24) % 24), mm = Math.floor((((R.hour % 1) + 1) % 1) * 60);
  Pn.digits(-0.09, 0.022, 0.018, String(hh).padStart(2, '0'), INK, false);
  for (const dv of [0.006, 0.013]) Pn.disc(-0.0505, 0.022 + dv, 0.0013, INK, 0.9, 0.004, 6);
  Pn.digits(-0.044, 0.022, 0.018, String(mm).padStart(2, '0'), INK, false);
  const dive = L.dive || {};
  const glasses = L.champagne == null ? null : Math.max(0, Math.round(num(L.champagne)));
  const lamps = [['RAMP', R.ramp > 0.02, AMBER], ['PANTRY', num(L.pantry) > 0.5, GLOW], ['LOCKER', num(L.locker) > 0.5, GLOW],
    ['NV', R.nv, [90, 255, 120]], [dive.under ? 'SUBMERGED' : 'AFLOAT', !!(dive.boat || dive.under), BLUE], ['GUNS', R.armed, RED]];
  lamps.forEach(([name, on, rgb], i) => lensLamp(Pn, (i % 3 - 1) * 0.064, -0.01 - Math.floor(i / 3) * 0.024, 0.058, 0.019, on, rgb, name));
  Pn.text(glasses == null ? 'BUBBLY' : 'BUBBLY ' + glasses, 0.05, 0.036, 0.0095, glasses === 0 ? AMBER : LABEL, 0.5, 0.003);
  // The rounds left in the two guns, under it.
  Pn.text('RDS', 0.03, 0.018, 0.009, LABEL, 0.5, 0.003);
  Pn.digits(0.045, 0.013, 0.01, String(Math.min(9999, R.ammo)).padStart(4, ' '), R.ammo < 200 ? RED : INK, false);
  void w;
}
