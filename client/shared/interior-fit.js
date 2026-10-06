// WHAT IS IN EACH SEAT — the fit-out of every interior, as geometry.
//
// `interior-shell.js` builds the room and `interior-kit.js` holds the vocabulary; this file is the
// four places that vocabulary is spent: a tractor cab, a light-aircraft flight deck, a helicopter
// bubble and the race boat's pilothouse. One function each, the same primitives in every one, so no
// seat can quietly end up with the better gauge.
//
// ── ⚠ EVERYTHING IS INSIDE THE BOUNDS THE PROFILE STATES ─────────────────────
//
// `shellBounds()` is the one statement that the eye is in a room, and `scripts/shapes/shell.mjs`
// fails any vertex outside it. A part that belongs outside the cab — the truck's west-coast
// mirrors — is covered by the profile's own `outboard`, which widens the stated box on purpose
// rather than the gate being loosened to let it through.
//
// ── ⚠ NOTHING CROSSES THE THREE SIGHT LINES ──────────────────────────────────
//
// Straight ahead, and out of the middle of each side window. The gate casts all three from the eye
// and a fitting in any of them is a fitting you cannot see past for the whole drive. The air
// freshener, the compass and the bubble's struts are all placed off those rays by construction.
//
// ── ⚠ `live` IS OPTIONAL EVERYWHERE ──────────────────────────────────────────
//
// Every reader below has a resting value, so the gate can build any seat with no live object at
// all and a seat whose sim has not sent a field yet shows a parked control rather than NaN.
import { makeKit, C, clamp, roundWheel, pedal, richSeat } from './interior-kit.js';
// The clickable switch row and the grab points, shared with every craft cockpit.
import { craftControls } from './interior-fit-craft.js';
import { memoPart } from './interior-memo.js';
import { hydroDetail, consoleSpan, HY } from './interior-hydro.js';

const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);

// ── THE TRUCK ────────────────────────────────────────────────────────────────
//
// Four cabs on one room. The ROOM is the profile (the same box for every tractor unit, because the
// exterior mesh is one family); what fills it is the truck you bought, keyed on the same `tier` the
// painted dash, the CAB_KIT instrument ladder and the retrim bench all read. So the four fit-outs
// below agree with the instruments you were sold by construction: a Barrow's cluster has no rev
// counter because CAB_KIT says a Barrow has none, and a Continental's has the trailer angle because
// CAB_KIT says it does.
//
//   0  KRELL BARROW       a scrapper rebuilt out of three other scrappers. Raw plate, a wiring loom
//                         you can see, a salvaged speedo and a rad counter, a bench seat, a slate
//                         zip-tied to the dash for a map, and no sleeper — a cargo net and an
//                         extinguisher on bare ribs.
//   1  OSTREK COURIER     an honest working cab: an analogue binnacle, rockers, a CB, a curtain.
//   2  VACHON DRAYMAN     glass cluster, a touchscreen turned to the driver, light lines in the
//                         trim, a coffee machine on the tunnel. The one the photographs are of.
//   3  ORLOV CONTINENTAL  a glass wall from the binnacle to the stack, a head-up display on the
//                         screen, camera mirrors on the A-pillars, captain's chairs, a quilted
//                         bulkhead with a fridge in it. Built by people who expect the road to
//                         outlast them.
//
// ⚠ THE LADDER IS INSTRUMENTS AND MATERIALS, NEVER ASSISTANCE — cab-view.js's CAB_KIT note. Nothing
// here may make the dearer truck easier to drive; a HUD is the speedo moved, not a second fact.
//
// ⚠ `live.glow` IS THE COLOURWAY'S OWN GLOW, so the light lines follow a retrim rather than being a
// colour somebody chose here. Absent (the gate, a cold view) it falls back to amber.
const TRUCK_TIER = (L) => { const t = Math.round(num(L.tier, 1)); return t < 0 ? 0 : t > 3 ? 3 : t; };

export function truckFit(P, live, push) {
  const K = makeKit(push);
  const L = live || {};
  const tier = TRUCK_TIER(L);
  const xL = P.xCentre - P.halfW, xR = P.xCentre + P.halfW;
  const glow = Array.isArray(L.glow) && L.glow.length === 3 && L.glow.every(Number.isFinite) ? L.glow : C.amber;
  const S = {
    K, P, L, tier, xL, xR, glow,
    rpm: clamp(num(L.rpm), 0, 1.05), mph: Math.max(0, num(L.mph)),
    fuel: clamp(num(L.fuel, 1), 0, 1),
    heads: !!L.heads, dome: !!L.dome, braking: !!L.braking,
    on: L.engineOn !== false,
    gear: String(L.gear ?? 'N').replace('½', '').slice(0, 2).padStart(2, ' '),
    toys: L.toys || {},
    ctl: truckSwitchCells(L),
  };

  // Each part is memoised on exactly the values it reads (interior-memo.js), so only the parts
  // carrying a needle, a lamp, a digit, the wheel or a pedal are rebuilt while you drive.
  const part = (fn) => memoPart(push, fn.name, S, (S2) => fn(S2), (rec) => ({ K: makeKit(rec), P }));
  if (tier === 0) part(barrowCluster);
  else if (tier === 1) part(courierCluster);
  else part(glassCluster);

  part(truckWheel);
  if (tier === 0) part(barrowStack);
  else if (tier === 1) part(courierStack);
  else part(modernStack);

  part(truckSwitchBanks);
  part(truckTunnel);
  part(truckPedals);
  part(truckDoors);
  part(truckOverhead);
  part(truckBehind);
  if (tier === 3) part(continentalExtras);
}

// ── THE SWITCH BANKS: WHAT YOU CAN REACH FROM THE FORWARD VIEW ───────────────
//
// Looking straight down the road the modelled cab shows the binnacle, the top of the wheel and a
// strip of fascia either side of it; the stacks, the tunnel and everything under the wheel are
// out of the frame. So the switches a driver works while driving sit on that strip: the key and
// the lamps left of the column, the brakes, air and doors right of it. Every one is clickable
// (the profile's `hotspots`, projected by windshield.js and hit-tested in cab-view.js) and every
// press ends at the shelf button's own click, as the painted console's do.
//
// ⚠ `live.ctl` IS THE CAB'S LIST OF WHAT THIS TRUCK HAS RIGHT NOW (cab-view.js ctlCells). A
// control the truck does not have is not drawn, and with no list at all (the gate, a cold view)
// the banks are empty rather than guessed.
const SW_LEFT = ['key', 'heads', 'dome', 'jake', 'cruise', 'horn'];
const SW_RIGHT = ['park', 'trailer', 'pump', 'exit', 'latch', 'galley', 'auto'];
const SW_PITCH = 0.040, SW_MAX = 6, SW_Z = -0.44;
// Nearer than the fascia by a finger's width, so the plate stands proud of whatever is behind it.
const swY = (P) => P.dashY - 0.022;
function truckSwitchCells(L) {
  const c = L && L.ctl;
  if (!c) return null;
  const all = [...(c.left || []), ...(c.right || [])];
  const pick = (ids) => ids.map((id) => all.find((x) => x.key === id)).filter(Boolean).slice(0, SW_MAX)
    .map((x) => ({ key: x.key, label: String(x.label || x.key).toUpperCase().slice(0, 12), on: !!x.on, enabled: x.enabled !== false }));
  return { left: pick(SW_LEFT), right: pick(SW_RIGHT) };
}
// Where each bank's switches sit, in shell metres: the left bank's last switch and the right
// bank's first sit a hand's width outboard of the rim.
function switchLayout(P, ctl) {
  const out = [];
  if (!ctl) return out;
  const y = swY(P);
  ctl.left.forEach((c, i, a) => out.push({ c, p: [-0.32 - (a.length - 1 - i) * SW_PITCH, y, SW_Z] }));
  ctl.right.forEach((c, i) => out.push({ c, p: [0.32 + i * SW_PITCH, y, SW_Z] }));
  return out;
}
export function truckHotspots(P, live) {
  return switchLayout(P, truckSwitchCells(live || {})).filter((s) => s.c.enabled)
    .map((s) => ({ id: s.c.key, p: [s.p[0], s.p[1], s.p[2] + 0.004], r: 0.02, kind: 'click' }));
}
function truckSwitchBanks(S) {
  const { K, P, ctl, glow, on } = S;
  const lay = switchLayout(P, ctl);
  if (!lay.length) return;
  const y = swY(P);
  const Pn = K.panel([0, y, SW_Z], [1, 0, 0], [0, 0, 1]);
  for (const side of [-1, 1]) {
    const mine = lay.filter((s) => Math.sign(s.p[0]) === side);
    if (!mine.length) continue;
    const a0 = Math.min(...mine.map((s) => s.p[0])) - 0.028, a1 = Math.max(...mine.map((s) => s.p[0])) + 0.028;
    Pn.rect(a0, -0.034, a1, 0.024, [24, 26, 30], 0, 0);
    Pn.rect(a0, 0.022, a1, 0.024, glow, on ? 0.5 : 0.05, 0.001);
  }
  for (const s of lay) {
    const lit = s.c.on && s.c.enabled;
    Pn.rocker(s.p[0], 0.004, lit, s.c.enabled ? C.black : [58, 60, 64]);
    // The name under it, fitted to the pitch rather than the kit's default, or neighbours run together.
    Pn.fitText(s.c.label, s.p[0], -0.0235, SW_PITCH - 0.005, 0.0085, C.tick, 0.35, 0.004);
  }
}

// ── KRELL BARROW: THE SALVAGED CLUSTER ───────────────────────────────────────
//
// No binnacle hood, because there is no binnacle: a steel plate bolted over the hole where one was,
// carrying what was to hand. A speedo with a cream face out of something older, a fuel gauge, a rad
// counter — which on the road south is not optional — and a gear readout off a scrapped forklift.
function barrowCluster(S) {
  const { K, P, L, on, mph, fuel } = S;
  const B = K.panel([0, 0.60, -0.30], [1, 0, 0], [0, 0.30, 0.95]);
  B.rect(-0.26, -0.12, 0.36, 0.12, C.steel, 0, 0);
  // The lift: pods and ride height, off a scrapped lifter controller with its own glass.
  hoverDisplay(B, 0.30, 0.0, 0.10, S);
  // The plate's own bolts, and a scab of tape across a crack in it.
  for (const [a, b] of [[-0.24, -0.10], [0.34, -0.10], [-0.24, 0.10], [0.34, 0.10]]) B.knob(a, b, 0.008, 0.006, C.chrome, 0.05);
  B.rect(0.05, 0.075, 0.20, 0.098, [150, 148, 136], 0, 0.002);
  // Its back, down to the dash: a bent sheet rather than a moulding.
  K.box(-0.27, 0.62, -0.42, 0.37, 0.66, -0.19, 'dash', -0.10, [70, 74, 80]);
  B.dial(-0.10, 0.0, 0.085, clamp(mph / 70, 0, 1), { ticks: 14, major: 2, face: C.paper, tick: C.black, needle: C.red, bezel: C.chrome, name: 'MPH' });
  B.dial(0.10, 0.045, 0.038, fuel, { a0: Math.PI * 0.85, sweep: Math.PI * 0.7, ticks: 4, major: 2, arcs: [[0, 0.15, C.red]], name: 'FUEL' });
  // The rad counter: a needle on a log scale and a lamp that ticks when it moves.
  const rad = clamp(num(L.rad), 0, 1);
  B.dial(0.10, -0.055, 0.034, rad, { a0: Math.PI * 0.85, sweep: Math.PI * 0.7, ticks: 5, major: 1, face: [30, 26, 12], arcs: [[0.6, 1, C.red]], needle: C.amber, name: 'RAD' });
  B.lamp(0.19, -0.055, 0.008, 0.008, on && rad > 0.05, C.amber);
  B.rect(0.16, -0.02, 0.24, 0.035, C.screen, 0, 0.002);
  B.digits(0.168, -0.013, 0.032, S.gear, C.lcd);
  // Three tell-tales, hand-labelled: charge, oil, heads. A centimetre up off the plate's bottom
  // edge, or the names under them hang off it.
  [[!on, C.red, 'CHG'], [on && S.rpm > 0.95, C.red, 'OIL'], [S.heads, C.blue, 'HDS']].forEach(([lit, rgb, nm], i) => B.lamp(-0.23 + i * 0.03, -0.09, 0.009, 0.009, lit, rgb, nm));
  // The loom. Every panel it passes was taken off something else, so the wires were never tidied —
  // they hang in bights under the dash between the plate and the fuse block by your knee.
  const loom = [C.red, C.yellow, C.blue, C.green, C.black, C.white];
  loom.forEach((rgb, i) => {
    const x0 = -0.18 + i * 0.07, x1 = -0.34 + i * 0.03;
    const a = [x0, 0.62, -0.42], m = [(x0 + x1) / 2, 0.52, -0.62 - (i % 3) * 0.04], b = [x1, P.dashY + 0.01, -0.70];
    K.rod(a, m, 0.006, 'dash', 0, rgb, 0.05, 4);
    K.rod(m, b, 0.006, 'dash', 0, rgb, 0.05, 4);
  });
  const F = K.panel([-0.36, P.dashY - 0.004, -0.74], [1, 0, 0], [0, 0, 1]);
  F.rect(-0.08, -0.05, 0.08, 0.05, [30, 30, 28], 0, 0);
  for (let i = 0; i < 8; i++) F.stud(-0.06 + i * 0.017, 0.0, 0.006, 0.02, 0.012, [C.red, C.amber, C.blue, C.green][i % 4], 0.2);
}

// ── OSTREK COURIER: THE WORKING BINNACLE ─────────────────────────────────────
function courierCluster(S) {
  const { K, L, on, rpm, mph, fuel, heads, braking } = S;
  // Raked back so you look DOWN onto it over the top of the wheel, which is where a truck puts it.
  const B = K.panel([0, 0.60, -0.30], [1, 0, 0], [0, 0.30, 0.95]);
  const HW = 0.35, HH = 0.125;
  B.rect(-HW, -HH, HW, HH, [20, 22, 26], 0, 0);
  K.box(-HW - 0.02, 0.60, -0.195, HW + 0.02, 0.84, -0.172, 'dash', 0.30);
  K.box(-HW - 0.02, 0.64, -0.40, HW + 0.02, 0.84, -0.195, 'dash', -0.05);
  for (const s of [-1, 1]) K.box(s * (HW + 0.02) - 0.012, 0.57, -0.42, s * (HW + 0.02) + 0.012, 0.84, -0.172, 'dash', 0.05);
  B.dial(-0.155, 0.0, 0.078, on ? rpm : 0, { red: 0.82, ticks: 12, major: 3, label: C.amber, name: 'RPM' });
  B.dial(0.155, 0.0, 0.078, clamp(mph / 80, 0, 1), { ticks: 16, major: 2, label: C.lampOn, name: 'MPH' });
  B.dial(-0.29, 0.052, 0.034, fuel, { a0: Math.PI * 0.85, sweep: Math.PI * 0.7, ticks: 4, major: 2, arcs: [[0, 0.15, C.red]], name: 'FUEL' });
  B.dial(-0.29, -0.052, 0.034, on ? clamp(0.25 + rpm * 0.35, 0, 1) : 0.05, { a0: Math.PI * 0.85, sweep: Math.PI * 0.7, ticks: 4, major: 2, arcs: [[0.8, 1, C.red]], name: 'TEMP' });
  B.dial(0.29, 0.052, 0.034, on ? 0.78 : 0.2, { ticks: 6, major: 2, frac2: on ? 0.74 : 0.18, arcs: [[0, 0.45, C.red]], name: 'AIR' });
  B.dial(0.29, -0.052, 0.034, on ? clamp(0.35 + rpm * 0.4, 0, 1) : 0, { a0: Math.PI * 0.85, sweep: Math.PI * 0.7, ticks: 4, major: 2, name: 'OIL' });
  const lamps = [[!!L.indL, C.green, 'L'], [heads, C.blue, 'HI'], [braking, C.red, 'BRK'], [!on, C.amber, 'CHG'], [fuel < 0.12, C.amber, 'LOW'], [!!L.indR, C.green, 'R']];
  // Lettered on the lens: at 23 mm pitch a name under each lamp runs into the next one's.
  lamps.forEach(([lit, rgb, nm], i) => annun(B, nm, -0.0575 + i * 0.023, 0.085, 0.009, 0.007, lit, rgb));
  B.digits(-0.03, -0.075, 0.05, S.gear, C.amber);
  B.digits(-0.045, 0.025, 0.018, String(Math.round(mph)).padStart(3, ' '), C.lcd, true);
}

// ── DRAYMAN AND CONTINENTAL: THE GLASS CLUSTER ───────────────────────────────
//
// One black glass slab under a hood, with the two big gauges drawn as LIT RINGS rather than as
// needles on faces — the arc fills to the value in the colourway's own glow, a thin needle rides its
// end, and the number sits in the middle. Between them an info screen: gear, fuel, and the brake
// temperature CAB_KIT gives both of these rungs. The Continental's slab runs wider and adds the
// trailer's angle as a plan view, because that is the one instrument its rung adds.
function ringGauge(B, ca, cb, R, frac, glow, o = {}) {
  const a0 = Math.PI * 1.25, sweep = Math.PI * 1.5, f = clamp(frac, 0, 1);
  B.annulus(ca, cb, R * 1.02, R * 1.08, C.bezel, 0.1, 0.003, 30, a0, a0 - sweep);
  B.annulus(ca, cb, R * 0.84, R, [22, 26, 32], 0.15, 0.002, 30, a0, a0 - sweep);
  if (f > 0.005) {
    const hot = o.red != null && f >= o.red;
    B.annulus(ca, cb, R * 0.84, R, hot ? C.red : glow, 0.85, 0.003, Math.max(2, Math.round(30 * f)), a0, a0 - f * sweep);
  }
  if (o.red != null) B.annulus(ca, cb, R * 1.0, R * 1.02, C.red, 0.6, 0.003, 6, a0 - o.red * sweep, a0 - sweep);
  for (let i = 0; i <= (o.ticks ?? 10); i++) {
    const t = a0 - (i / (o.ticks ?? 10)) * sweep;
    B.spoke(ca, cb, t, R * 0.72, R * 0.80, R * 0.018, C.tick, 0.4, 0.004);
  }
  B.spoke(ca, cb, a0 - f * sweep, R * 0.70, R * 1.04, R * 0.03, C.lampOn, 0.95, 0.006, R * 0.012);
  if (o.text) B.digits(ca - R * 0.42, cb - R * 0.22, R * 0.38, o.text, C.lampOn, false);
  if (o.name) B.fitText(o.name, ca, cb - R * 0.52, R * 0.9, R * 0.18, glow, 0.6, 0.005);
}

function glassCluster(S) {
  const { K, L, on, rpm, mph, fuel, glow, tier } = S;
  const wide = tier === 3;
  const HW = wide ? 0.50 : 0.46, HH = 0.13;
  const B = K.panel([0, 0.60, -0.30], [1, 0, 0], [0, 0.30, 0.95]);
  B.rect(-HW, -HH, HW, HH, [8, 10, 14], 0.05, 0);
  // A light line round the glass, in the trim's glow.
  B.rect(-HW, HH - 0.004, HW, HH, glow, 0.7, 0.002);
  B.rect(-HW, -HH, HW, -HH + 0.003, glow, 0.5, 0.002);
  // The hood, and its sculpted cheeks.
  K.box(-HW - 0.02, 0.60, -0.19, HW + 0.02, 0.86, -0.165, 'dash', 0.32);
  K.box(-HW - 0.02, 0.64, -0.40, HW + 0.02, 0.86, -0.19, 'dash', -0.05);
  for (const s of [-1, 1]) K.obox([s * (HW + 0.03), 0.70, -0.30], [1, 0, 0], [0, 0, 1], [0, 1, 0], 0.014, 0.12, 0.14, 'dash', 0.08);
  if (!on) {
    // Dead glass is black glass; only the park lamp says anything.
    B.lamp(0, 0.09, 0.01, 0.008, true, C.amber, 'PARK');
    return;
  }
  const R = 0.085, gx = wide ? 0.25 : 0.23;
  // The lift, at the left end of the glass, where the eye goes after the speed.
  hoverDisplay(B, -HW + 0.065, 0.0, 0.085, S);
  ringGauge(B, -gx, 0.0, R, rpm, glow, { red: 0.82, ticks: 12, text: String(Math.round(rpm * 25)).padStart(2, ' '), name: 'RPM' });
  ringGauge(B, gx, 0.0, R, clamp(mph / 80, 0, 1), glow, { ticks: 16, text: String(Math.round(mph)).padStart(2, ' ').slice(-2), name: 'MPH' });
  // The info screen between them.
  B.rect(-0.10, -0.10, 0.10, 0.10, [12, 18, 24], 0.25, 0.002);
  B.digits(-0.035, -0.02, 0.06, S.gear, glow);
  // Fuel and brake temperature as two bars, each with its own threshold colour.
  const bt = clamp(num(L.brakeTemp) / 600, 0, 1);
  B.bar(-0.08, -0.085, 0.06, 0.008, fuel, fuel < 0.15 ? C.red : C.green, 'FUEL');
  B.bar(0.08, -0.085, 0.06, 0.008, bt, L.fading || bt > 0.75 ? C.red : bt > 0.5 ? C.amber : C.blue, 'BRK');
  // Tell-tales along the top of the screen.
  const lamps = [[!!L.indL, C.green, 'L'], [S.heads, C.blue, 'HI'], [S.braking, C.red, 'BRK'], [fuel < 0.12, C.amber, 'LOW'], [!!L.fading, C.red, 'HOT'], [!!L.indR, C.green, 'R']];
  lamps.forEach(([lit, rgb, nm], i) => annun(B, nm, -0.0625 + i * 0.025, 0.083, 0.010, 0.006, lit, rgb));
  if (wide) {
    // THE TRAILER, IN PLAN. A cab block and a trailer spoke swung by the articulation angle —
    // `phi` in degrees, 0 when there is nothing on the pin.
    const phi = num(L.trailerPhi) * Math.PI / 180;
    const tx = HW - 0.045;
    B.rect(tx - 0.012, 0.04, tx + 0.012, 0.07, C.lampOn, 0.8, 0.003);
    if (L.trailerPhi != null) B.spoke(tx, 0.04, -Math.PI / 2 + phi, 0, 0.08, 0.009, glow, 0.8, 0.003);
    // And the sat-nav's next turn, repeated at the edge of the glass where the eye already is.
    const turn = num(L.navTurn);
    B.spoke(HW - 0.045, -0.075, Math.PI / 2 - turn * 0.9, 0, 0.05, 0.006, C.lampOn, 0.9, 0.003, 0.002);
  }
}

// ── THE WHEEL AND COLUMN ─────────────────────────────────────────────────────
function truckWheel(S) {
  const { K, L, tier, glow } = S;
  const hub = [0, 0.37, -0.50];
  // A Barrow's wheel is a big thin bus rim with two spokes; the glass cabs get four and a boss with
  // the maker's light in it.
  const spokes = tier === 0 ? [-20, 200] : tier === 1 ? [-90, -20, 200] : [-90, -15, 195, 90];
  const R = tier === 0 ? 0.24 : 0.22;
  const hornRgb = tier === 0 ? [60, 58, 52] : tier === 1 ? [34, 36, 42] : [22, 24, 28];
  roundWheel(K, hub, 0.95, R, num(L.steer), 270, tier === 0 ? C.black : C.grip, spokes, hornRgb, S.toys.wheel || null);
  K.rod(hub, [0, 0.66, -0.74], tier === 0 ? 0.028 : 0.035, 'dash', 0, tier === 0 ? C.steel : C.black, 0, 8);
  K.obox([0, 0.49, -0.60], [1, 0, 0], [0, 0.6, 0.8], [0, -0.8, 0.6], 0.06, 0.09, 0.05, 'dash', -0.05, C.black);
  if (tier >= 2) {
    // A lit ring round the boss.
    const up = [0, Math.sin(0.95), Math.cos(0.95)];
    const W = K.panel([hub[0], hub[1] - 0.02, hub[2] + 0.005], [1, 0, 0], up);
    W.annulus(0, 0, 0.045, 0.05, glow, 0.7, 0.012, 20);
  }
  // Two stalks: indicators and wipers on the left, the retarder on the right.
  K.rod([-0.05, 0.47, -0.56], [-0.21, 0.43, -0.53], 0.008, 'dash', 0, C.black, 0, 5);
  K.rod([-0.21, 0.43, -0.53], [-0.235, 0.425, -0.525], 0.012, 'dash', 0, C.steel, 0.1, 5);
  if (tier > 0) {
    K.rod([0.05, 0.47, -0.56], [0.20, 0.44, -0.58], 0.008, 'dash', 0, C.black, 0, 5);
    K.rod([0.20, 0.44, -0.58], [0.225, 0.435, -0.585], 0.012, 'dash', 0, C.amber, 0.2, 5);
  }
}

// ── THE STACKS ───────────────────────────────────────────────────────────────
function barrowStack(S) {
  const { K, P, L, on, mph } = S;
  // A raw plate where the radio was, a row of aircraft toggles off a wreck, and a handheld on a clip.
  const St = K.panel([0.62, P.dashY - 0.004, -0.60], [1, 0, 0], [0, 0, 1]);
  St.rect(-0.18, -0.16, 0.18, 0.14, [64, 68, 72], 0, 0);
  for (const [a, b] of [[-0.16, -0.14], [0.16, -0.14], [-0.16, 0.12], [0.16, 0.12]]) St.knob(a, b, 0.007, 0.005, C.chrome, 0.05);
  const tn = ['HEAD', 'TAIL', 'DOME', 'BCN', 'SPARE'];
  [S.heads, S.heads, S.dome, !!L.beacon, false].forEach((st, i) => St.toggle(-0.12 + i * 0.06, 0.05, st, tn[i]));
  St.rect(-0.13, -0.10, 0.03, -0.02, C.black, 0, 0.002);                       // the handheld
  St.lamp(-0.11, -0.03, 0.006, 0.004, on, C.red);
  St.knob(0.10, -0.06, 0.02, 0.02, C.black, 0);                                // the heater, one knob
  St.stud(0.12, -0.13, 0.02, 0.02, S.braking ? 0.06 : 0.03, C.yellow, 0.1);     // the park brake
  // THE MAP IS A SLATE ZIP-TIED TO A BRACKET, and it is angled the way somebody bent the bracket.
  const nv = [0.40, 0.70, P.dashZ + 0.10];
  K.rod([nv[0], nv[1], P.dashZ], [nv[0], nv[1] + 0.01, nv[2] - 0.05], 0.008, 'dash', 0, C.steel, 0, 4);
  const Nv = K.panel(nv, [0.97, 0.25, 0], [0, 0.25, 0.97]);
  Nv.rect(-0.085, -0.06, 0.085, 0.06, [40, 38, 34], 0, 0);
  Nv.rect(-0.075, -0.05, 0.075, 0.05, on ? [20, 40, 24] : C.screen, on ? 0.4 : 0, 0.003);
  if (on) {
    const turn = num(L.navTurn);
    Nv.plate([[-0.008, -0.05], [0.008, -0.05], [0.008 + turn * 0.04, 0.05], [-0.008 + turn * 0.04, 0.05]], [120, 230, 120], 0.6, 0.005);
    Nv.digits(0.02, 0.028, 0.012, String(Math.round(mph)).padStart(2, ' ').slice(-2), [120, 230, 120], false);
  }
  for (const b of [-0.04, 0.04]) Nv.rect(-0.09, b - 0.004, 0.09, b + 0.004, C.white, 0, 0.006);   // the zip ties
  // The glovebox is a crate strapped to the dash, and there is a dosimeter badge on top of it.
  K.box(1.02, 0.56, P.dashZ - 0.20, 1.44, 0.74, P.dashZ + 0.06, 'dash', 0.1, [110, 84, 52]);
  for (let i = 0; i < 3; i++) K.box(1.02, 0.555, P.dashZ - 0.18 + i * 0.09, 1.44, 0.56, P.dashZ - 0.15 + i * 0.09, 'dash', 0.2, [84, 62, 38]);
  K.box(1.20, 0.60, P.dashZ + 0.06, 1.26, 0.64, P.dashZ + 0.075, 'dash', 0.2, C.yellow, 0.1);
  // A fire-blackened mug, and a strip of tape holding down the one vent that rattles.
  K.rod([0.92, 0.64, P.dashZ], [0.92, 0.64, P.dashZ + 0.10], 0.036, 'dash', 0.2, [70, 64, 58], 0, 8);
  const G = K.panel([1.25, P.dashY - 0.004, -0.62], [1, 0, 0], [0, 0, 1]);
  G.grille(-0.22, 0.13, -0.06, 0.20, 4);
  G.rect(-0.24, 0.155, -0.04, 0.175, [150, 148, 136], 0, 0.004);
}

function courierStack(S) {
  const { K, P, L, on, mph, heads, dome, braking } = S;
  const St = K.panel([0.62, P.dashY - 0.004, -0.60], [1, 0, 0], [0, 0, 1]);
  St.rect(-0.19, -0.19, 0.19, 0.17, [26, 28, 32], 0, 0);
  St.rect(-0.17, 0.07, 0.17, 0.155, [14, 15, 18], 0, 0.002);
  St.digits(-0.07, 0.093, 0.035, on ? '1071' : '    ', C.lcd);
  St.knob(-0.135, 0.112, 0.016, 0.016, C.chrome, 0.1);
  St.knob(0.135, 0.112, 0.016, 0.016, C.chrome, 0.1);
  [-0.11, 0, 0.11].forEach((a, i) => {
    St.annulus(a, 0.0, 0.032, 0.040, i === 0 ? C.blue : i === 1 ? C.tick : C.red, 0.3, 0.002, 14);
    St.knob(a, 0.0, 0.027, 0.02, C.black, 0);
    St.stud(a, 0.018, 0.003, 0.01, 0.024, C.white, 0.4);
  });
  const rn = ['HEAD', 'TAIL', 'DOME', 'BCN', 'DIFF', 'PTO'];
  [heads, heads, dome, !!L.beacon, false, false].forEach((st, i) => St.rocker(-0.125 + i * 0.05, -0.075, st, C.black, rn[i]));
  St.rect(-0.17, -0.175, 0.05, -0.125, [10, 11, 13], 0, 0.002);
  St.digits(-0.155, -0.165, 0.028, '0842', C.lcd, false);
  St.stud(0.12, -0.15, 0.022, 0.022, braking ? 0.06 : 0.03, C.yellow, 0.1);
  St.stud(0.12, -0.15, 0.010, 0.010, braking ? 0.07 : 0.04, C.black, 0);

  const Lp = K.panel([-0.40, P.dashY - 0.004, -0.60], [1, 0, 0], [0, 0, 1]);
  Lp.rect(-0.10, -0.08, 0.10, 0.08, [26, 28, 32], 0, 0);
  Lp.knob(-0.05, 0.02, 0.022, 0.02, C.black, 0);
  Lp.stud(-0.05, 0.02 + (heads ? 0.012 : 0), 0.004, 0.012, 0.028, C.white, 0.3);
  [false, !!L.wipers, heads].forEach((st, i) => Lp.rocker(0.02 + i * 0.03, -0.035, st, C.black, ['FOG', 'WPR', 'LTS'][i]));
  hoverDisplay(Lp, 0.055, 0.02, 0.07, S);

  truckGlovebox(S, [30, 33, 38]);
  // The sat-nav on a stalk off the dash top.
  const nv = [0.48, 0.66, P.dashZ + 0.11];
  K.rod([nv[0], nv[1] + 0.05, P.dashZ], [nv[0], nv[1] + 0.03, nv[2] - 0.06], 0.010, 'dash', 0, C.black, 0, 5);
  const Nv = K.panel(nv, [1, 0, 0], [0, 0.25, 0.97]);
  Nv.rect(-0.095, -0.062, 0.095, 0.062, C.black, 0, 0);
  Nv.rect(-0.085, -0.052, 0.085, 0.052, on ? [34, 58, 44] : C.screen, on ? 0.45 : 0, 0.003);
  if (on) navRoute(Nv, num(L.navTurn), mph, [150, 150, 140], 0.052);
  // A clipboard with a delivery note on it, and a mug that has seen a lot of motorway.
  K.box(1.12, 0.66, P.dashZ, 1.40, 0.90, P.dashZ + 0.012, 'dash', 0.3, [120, 84, 50]);
  K.box(1.14, 0.68, P.dashZ + 0.012, 1.38, 0.86, P.dashZ + 0.016, 'dash', 0.5, C.paper, 0.1);
  K.box(1.22, 0.855, P.dashZ + 0.012, 1.30, 0.885, P.dashZ + 0.03, 'dash', 0.2, C.chrome, 0.1);
  K.rod([0.92, 0.64, P.dashZ], [0.92, 0.64, P.dashZ + 0.10], 0.038, 'dash', 0.2, C.white, 0, 10);
  K.box(0.955, 0.63, P.dashZ + 0.03, 0.985, 0.65, P.dashZ + 0.08, 'dash', 0.2, C.white);
}

// The route line swinging off the bow by the next turn, and the chevron that is you.
function navRoute(Nv, turn, mph, rgb, hh) {
  Nv.plate([[-0.012, -hh], [0.012, -hh], [0.012 + turn * 0.03, 0.02], [-0.012 + turn * 0.03, 0.02]], rgb, 0.5, 0.005);
  Nv.plate([[-0.012 + turn * 0.03, 0.02], [0.012 + turn * 0.03, 0.02], [0.012 + turn * 0.08, hh], [-0.012 + turn * 0.08, hh]], rgb, 0.5, 0.005);
  Nv.plate([[0, -0.018], [0.010, -0.040], [0, -0.034], [-0.010, -0.040]], [90, 170, 255], 0.95, 0.007);
  Nv.digits(0.028, hh - 0.022, 0.014, String(Math.round(mph)).padStart(2, ' ').slice(-2), C.white, false);
}

function truckGlovebox(S, rgb) {
  const { K, P } = S;
  const G = K.panel([1.25, P.dashY - 0.004, -0.62], [1, 0, 0], [0, 0, 1]);
  G.rect(-0.25, -0.10, 0.25, 0.10, rgb, 0, 0.001);
  G.rect(-0.05, 0.06, 0.05, 0.08, C.chrome, 0.1, 0.003);
  G.grille(-0.22, 0.13, -0.06, 0.20, 5);
  G.grille(0.06, 0.13, 0.22, 0.20, 5);
  const D = K.panel([P.xCentre, screenY(P, P.xCentre) - 0.10, P.dashZ - 0.02], [1, 0, 0], [0, 1, 0]);
  D.grille(-P.halfW + 0.35, -0.025, P.halfW - 0.35, 0.025, 3, [8, 9, 11]);
  return G;
}

// THE DRAYMAN'S AND THE CONTINENTAL'S STACK: a screen in the fascia turned toward the driver, a
// climate strip under it with lit rings, and a light line along the whole dash in the trim's glow.
function modernStack(S) {
  const { K, P, L, on, mph, glow, tier, xL, xR } = S;
  const big = tier === 3;
  // Turned 18° toward the driver, which is what a stack is for.
  const yaw = -0.32, r = [Math.cos(yaw), Math.sin(yaw), 0];
  const St = K.panel([0.64, P.dashY - 0.07, -0.58], r, [0, 0, 1]);
  St.rect(-0.21, -0.22, 0.21, 0.19, [18, 20, 24], 0, 0);
  // The screen.
  const sh = big ? 0.17 : 0.15, sb = big ? -0.02 : 0.0;
  St.rect(-0.18, sb - 0.005, 0.18, sh + 0.005, C.black, 0, 0.002);
  St.rect(-0.17, sb, 0.17, sh, on ? [16, 34, 44] : C.screen, on ? 0.5 : 0, 0.004);
  if (on) {
    // A map: the road, blocks either side of it, and you.
    const turn = num(L.navTurn), cx = 0.02, cy = (sb + sh) / 2;
    for (let i = 0; i < 6; i++) St.rect(-0.16 + i * 0.055, sb + 0.01, -0.12 + i * 0.055, sb + 0.035 + (i % 3) * 0.015, [30, 56, 66], 0.5, 0.005);
    St.plate([[cx - 0.01, sb], [cx + 0.01, sb], [cx + 0.01 + turn * 0.05, cy], [cx - 0.01 + turn * 0.05, cy]], glow, 0.8, 0.006);
    St.plate([[cx - 0.01 + turn * 0.05, cy], [cx + 0.01 + turn * 0.05, cy], [cx + 0.01 + turn * 0.14, sh], [cx - 0.01 + turn * 0.14, sh]], glow, 0.8, 0.006);
    St.plate([[cx, sb + 0.04], [cx + 0.012, sb + 0.012], [cx, sb + 0.02], [cx - 0.012, sb + 0.012]], C.lampOn, 0.95, 0.008);
    // A status strip down the left edge of the screen: fuel, the leg, the time on the road.
    St.rect(-0.17, sb, -0.11, sh, [10, 20, 28], 0.4, 0.005);
    St.bar(-0.14, sb + 0.01, sh - 0.01, 0.008, S.fuel, S.fuel < 0.15 ? C.red : C.green, 'FUEL');
    hoverDisplay(St, 0.13, sb + 0.05, 0.065, S, false);
    St.digits(0.08, sh - 0.03, 0.022, String(Math.round(mph)).padStart(2, ' ').slice(-2), C.white, false);
  }
  // Soft keys beside it.
  for (let i = 0; i < 4; i++) St.stud(0.195, sh - 0.02 - i * 0.04, 0.008, 0.012, 0.006, i === 0 && on ? glow : [40, 44, 50], i === 0 && on ? 0.6 : 0);
  // The climate strip: two lit rings and a row of haptic keys.
  const cz = sb - 0.08;
  for (const a of [-0.13, 0.13]) {
    St.annulus(a, cz, 0.03, 0.036, glow, on ? 0.6 : 0.05, 0.003, 18);
    St.knob(a, cz, 0.026, 0.022, [28, 30, 34], 0);
  }
  [S.heads, S.dome, !!L.beacon, !!L.wipers, false].forEach((st, i) => {
    St.rect(-0.08 + i * 0.035, cz - 0.02, -0.055 + i * 0.035, cz + 0.02, [30, 32, 38], 0, 0.003);
    St.lamp(-0.0675 + i * 0.035, cz + 0.012, 0.007, 0.002, st && on, glow, ['HEAD', 'DOME', 'BCN', 'WIPE', 'A/C'][i]);
  });
  // The park brake: still a yellow knob, because some things are not improved.
  St.stud(0.0, sb - 0.17, 0.022, 0.018, S.braking ? 0.05 : 0.025, C.yellow, 0.1);
  // A small light-switch panel left of the column, all touch.
  const Lp = K.panel([-0.40, P.dashY - 0.004, -0.60], [1, 0, 0], [0, 0, 1]);
  Lp.rect(-0.10, -0.07, 0.10, 0.07, [18, 20, 24], 0, 0);
  Lp.annulus(-0.04, 0, 0.03, 0.036, glow, on ? 0.5 : 0.05, 0.002, 16);
  Lp.knob(-0.04, 0, 0.026, 0.018, [28, 30, 34], 0);
  [S.heads, !!L.wipers].forEach((st, i) => Lp.lamp(0.035 + i * 0.03, 0, 0.01, 0.018, st && on, glow, ['HEAD', 'WPR'][i]));

  truckGlovebox(S, big ? [40, 30, 24] : [28, 31, 36]);
  // THE LIGHT LINE. One continuous strip along the fascia, just under the dash top, broken only by
  // the binnacle — the photographs' yellow piping, in whatever colour the cab was trimmed.
  const lz = P.dashZ - 0.07, ly = P.dashY - 0.003;
  K.box(xL + 0.14, ly - 0.006, lz, -0.44, ly, lz + 0.008, 'dash', 0, glow, on ? 0.75 : 0.1);
  K.box(0.42, ly - 0.006, lz, xR - 0.14, ly, lz + 0.008, 'dash', 0, glow, on ? 0.75 : 0.1);
  // The dash top gets a stitched leather pad over the glovebox.
  K.box(1.00, 0.60, P.dashZ, 1.56, 0.82, P.dashZ + 0.02, 'dash', 0.35);
  K.box(1.00, 0.598, P.dashZ + 0.012, 1.56, 0.600, P.dashZ + 0.015, 'dash', 0.2, glow, 0.3);
}

// ── THE TUNNEL AND THE STICK ─────────────────────────────────────────────────
function truckTunnel(S) {
  const { K, P, tier, glow, on } = S;
  const tz = P.floor + 0.42;
  const gear = S.gear, gnum = parseInt(gear, 10);
  let gx = 0, gy = 0;
  if (Number.isFinite(gnum) && gnum > 0) { gx = ((((gnum - 1) >> 1) % 4) - 1.5) * 0.035; gy = gnum % 2 ? 0.05 : -0.05; }
  else if (gear.trim() === 'R') { gx = -0.09; gy = 0.05; }
  const base = [0.40, 0.25, tz];

  if (tier === 0) {
    // No tunnel moulding: a chequer plate on a box, and a wand of a lever up out of the floor.
    K.box(0.26, -0.30, P.floor, 0.86, P.dashY, tz - 0.10, 'dash', -0.12, [70, 72, 74]);
    for (let i = 0; i < 6; i++) K.box(0.30 + i * 0.09, -0.26, tz - 0.10, 0.34 + i * 0.09, P.dashY - 0.05, tz - 0.094, 'dash', 0.2, C.steel);
    const lb = [base[0], base[1], tz - 0.10];
    const knob = [base[0] + gx, base[1] + gy - 0.06, tz + 0.46];
    K.obox([lb[0], lb[1], lb[2] + 0.03], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.05, 0.05, 0.03, 'dash', 0, C.rubber);
    K.rod([lb[0], lb[1], lb[2] + 0.05], knob, 0.012, 'dash', 0, C.steel, 0.05, 6);
    K.rod(add3(knob, [0, 0, -0.03]), add3(knob, [0, 0, 0.03]), 0.03, 'dash', 0.1, C.black, 0, 8);
    // A toolbox against the tunnel, and a jerry can that was never going back in the rack.
    K.box(0.60, -0.28, tz - 0.10, 0.84, 0.05, tz + 0.05, 'dash', 0.1, C.fireRed);
    K.box(0.66, -0.12, tz + 0.05, 0.78, -0.10, tz + 0.08, 'dash', 0.1, C.black);
    return;
  }
  K.box(0.26, -0.30, P.floor, 0.86, P.dashY, tz, 'dash', -0.12);
  if (tier === 2) {
    // THE COFFEE MACHINE. On the Drayman it lives on the tunnel where the photographs put it: a
    // black column, a jug in a heater ring, and a lamp that says the plate is hot.
    K.box(0.62, -0.02, tz, 0.84, 0.20, tz + 0.02, 'dash', 0.05, [24, 26, 30]);
    K.rod([0.73, 0.14, tz + 0.02], [0.73, 0.14, tz + 0.30], 0.06, 'dash', 0.05, C.black, 0, 10);
    K.rod([0.73, 0.14, tz + 0.30], [0.73, 0.14, tz + 0.34], 0.066, 'dash', 0.15, [40, 42, 46], 0, 10);
    K.rod([0.73, 0.06, tz + 0.02], [0.73, 0.06, tz + 0.16], 0.045, 'dash', 0.3, [60, 44, 30], 0.1, 10);
    K.box(0.715, 0.10, tz + 0.20, 0.745, 0.085, tz + 0.23, 'dash', 0, C.red, on ? 0.9 : 0);
  } else if (tier === 3) {
    // A fridge-cooled armrest bin with a lid, and a charging pad with a phone on it.
    K.box(0.60, -0.28, tz, 0.86, 0.14, tz + 0.12, 'seat', 0.1);
    K.box(0.60, -0.28, tz + 0.12, 0.86, 0.14, tz + 0.14, 'dash', 0.3, [72, 52, 34]);
    K.box(0.62, 0.20, tz, 0.84, 0.44, tz + 0.012, 'dash', 0.1, [18, 20, 24]);
    K.box(0.68, 0.24, tz + 0.012, 0.76, 0.40, tz + 0.02, 'dash', 0.3, [12, 14, 18], on ? 0.2 : 0);
    K.box(0.62, 0.198, tz + 0.004, 0.84, 0.20, tz + 0.01, 'dash', 0, glow, on ? 0.7 : 0.05);
  } else {
    K.box(0.60, -0.10, tz, 0.84, 0.18, tz + 0.03, 'dash', 0.05, [24, 26, 30]);
    for (const cy of [-0.02, 0.10]) K.rod([0.72, cy, tz + 0.03], [0.72, cy, tz + 0.034], 0.035, 'dash', 0, C.black, 0, 10);
  }
  // The H. A glass cab's gate plate is lit, and its knob is shorter and wears the trim.
  K.box(base[0] - 0.09, base[1] - 0.09, tz, base[0] + 0.09, base[1] + 0.09, tz + 0.012, 'dash', 0.1, tier >= 2 ? [20, 22, 26] : C.steel);
  if (tier >= 2) {
    for (let i = 0; i < 4; i++) K.box(base[0] - 0.06 + i * 0.035 - 0.003, base[1] - 0.05, tz + 0.012, base[0] - 0.06 + i * 0.035 + 0.003, base[1] + 0.05, tz + 0.014, 'dash', 0, glow, on ? 0.6 : 0.05);
  }
  K.obox([base[0], base[1], tz + 0.045], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.05, 0.05, 0.035, 'dash', 0, C.rubber);
  const tall = tier === 3 ? 0.30 : 0.40;
  const knob = [base[0] + gx, base[1] + gy - 0.04, tz + tall];
  K.rod([base[0], base[1], tz + 0.07], knob, 0.011, 'dash', 0, C.chrome, 0.1, 6);
  const knobRgb = tier === 3 ? C.wood : C.black;
  K.obox(knob, [1, 0, 0], [0, 0, 1], [0, 1, 0], 0.030, 0.042, 0.030, 'dash', 0.1, knobRgb);
  K.obox(add3(knob, [-0.031, 0, 0.01]), [1, 0, 0], [0, 0, 1], [0, 1, 0], 0.004, 0.010, 0.012, 'dash', 0.2, tier >= 2 ? glow : C.amber, 0.3);
}

// ── THE PEDALS ───────────────────────────────────────────────────────────────
function truckPedals(S) {
  const { K, P, L, tier } = S;
  const pd = L.pedals || {};
  pedal(K, [-0.20, 0.78, -0.72], 0.045, 0.24, num(pd.clutch), C.rubber);
  pedal(K, [0.00, 0.78, -0.72], 0.055, 0.24, num(pd.brake), C.rubber);
  pedal(K, [0.20, 0.80, -0.78], 0.035, 0.26, num(pd.throttle), tier >= 2 ? C.chrome : C.steel);
  if (tier === 0) {
    // Chequer plate, and nothing on it but grit.
    K.box(-0.45, -0.10, P.floor, 0.24, 0.95, P.floor + 0.006, 'floor', 0.1, [78, 80, 84]);
    for (let i = 0; i < 8; i++) K.box(-0.43 + i * 0.085, -0.08, P.floor + 0.006, -0.40 + i * 0.085, 0.93, P.floor + 0.010, 'floor', 0.2, [96, 98, 102]);
  } else {
    K.box(-0.45, -0.10, P.floor, 0.24, 0.95, P.floor + 0.008, 'floor', 0.1, tier === 3 ? [40, 32, 26] : C.rubber);
  }
  K.obox([-0.40, 0.80, P.floor + 0.10], [1, 0, 0], [0, 0.6, 0.8], [0, -0.8, 0.6], 0.06, 0.10, 0.01, 'dash', 0, C.steel);
  // The glass cabs light the footwells, low, so the pedals can be found at night.
  if (tier >= 2) K.box(-0.44, P.dashY - 0.004, P.floor + 0.30, 0.22, P.dashY, P.floor + 0.306, 'dash', 0, S.glow, S.on ? 0.5 : 0.05);
}

// ── THE DOORS ────────────────────────────────────────────────────────────────
function truckDoors(S) {
  const { K, P, tier, xL, xR, glow, on } = S;
  for (const side of [-1, 1]) {
    const x = side < 0 ? xL : xR;
    const Dp = K.panel([x, 0.20, -0.55], [0, 1, 0], [0, 0, 1], 'pil', -0.05);
    if (tier === 0) {
      // A bare skin: the inner panel is gone and the door's own ribs show, with the winder bolted
      // back on and the latch on a length of cable.
      Dp.rect(-0.44, -0.40, 0.44, 0.34, [72, 76, 82], 0, 0.002);
      for (const a of [-0.30, 0, 0.30]) Dp.stud(a, -0.03, 0.02, 0.35, 0.03, [60, 64, 70], 0);
      Dp.knob(-0.12, 0.26, 0.018, 0.012, C.chrome, 0.1);
      Dp.stud(-0.12 + 0.04, 0.26, 0.04, 0.006, 0.016, C.black, 0);
      Dp.stud(0.36, 0.22, 0.05, 0.006, 0.02, C.steel, 0);
    } else {
      Dp.stud(0.05, 0.12, 0.26, 0.022, 0.07, null, 0, 0, 'pil');
      Dp.stud(0.28, 0.20, 0.07, 0.010, 0.012, C.chrome, 0.15);
      Dp.stud(0.40, 0.33, 0.012, 0.012, 0.03, C.black, 0);
      if (tier === 1) {
        Dp.knob(-0.12, 0.26, 0.018, 0.012, C.chrome, 0.1);
        Dp.stud(-0.12 + 0.04, 0.26, 0.04, 0.006, 0.016, C.black, 0);
      } else {
        // Power windows and mirror buttons on the armrest, and a light line under it.
        for (let i = 0; i < 3; i++) Dp.stud(-0.08 + i * 0.05, 0.145, 0.015, 0.008, 0.012, [30, 32, 36], 0, 0.07);
        Dp.rect(-0.21, 0.085, 0.31, 0.092, glow, on ? 0.7 : 0.05, 0.003);
        if (tier === 3) Dp.rect(-0.20, 0.20, 0.30, 0.26, C.wood, 0.05, 0.004);
      }
      Dp.annulus(0.30, -0.28, 0.055, 0.065, tier >= 2 ? C.chrome : C.black, 0.05, 0.002, 16);
      Dp.grille(0.25, -0.33, 0.35, -0.23, 5);
      Dp.stud(-0.05, -0.20, 0.22, 0.05, 0.05, null, 0, 0, 'pil');
      if (side > 0) Dp.stud(-0.10, -0.12, 0.08, 0.05, 0.035, C.paper, 0.1);
    }
    // ⚠ THE WEST-COAST MIRRORS, OUTSIDE THE DOOR — and inside `outboard`, never outside the bounds.
    const mx = x + side * 0.32, my = 0.56;
    K.rod([x, my - 0.05, 0.30], [mx, my, 0.12], 0.012, 'dash', 0, C.chrome, 0.1, 5);
    K.rod([x, my - 0.05, -0.28], [mx, my, -0.26], 0.012, 'dash', 0, C.chrome, 0.1, 5);
    K.box(mx - 0.06, my, -0.34, mx + 0.06, my + 0.07, 0.16, 'dash', 0.1, C.black);
    K.box(mx - 0.052, my - 0.004, -0.33, mx + 0.052, my, 0.15, 'dash', 0.4, C.mirror, 0.35);
    K.box(mx - 0.05, my, -0.44, mx + 0.05, my + 0.06, -0.36, 'dash', 0.1, C.black);
    K.box(mx - 0.043, my - 0.004, -0.435, mx + 0.043, my, -0.365, 'dash', 0.4, C.mirror, 0.3);
  }
  K.rod([xL + 0.07, 0.80, -0.12], [xL + 0.07, 0.80, 0.30], 0.014, 'dash', 0.1, C.black, 0, 6);
  K.rod([xL + 0.07, 0.80, -0.12], [xL + 0.02, 0.81, -0.12], 0.012, 'dash', 0.1, C.black, 0, 5);
  K.rod([xL + 0.07, 0.80, 0.30], [xL + 0.02, 0.81, 0.30], 0.012, 'dash', 0.1, C.black, 0, 5);
}

// ── OVERHEAD ─────────────────────────────────────────────────────────────────
function truckOverhead(S) {
  const { K, P, L, tier, on, rpm, dome, glow } = S;
  const oz = P.roof - 0.11;
  if (tier === 0) {
    // The CB on a bent bracket off the roof, and a bulb in a cage.
    K.rod([0.40, 0.30, P.roof], [0.40, 0.30, oz + 0.02], 0.008, 'dash', 0, C.steel, 0, 4);
    K.rod([0.70, 0.30, P.roof], [0.70, 0.30, oz + 0.02], 0.008, 'dash', 0, C.steel, 0, 4);
    K.box(0.34, 0.20, oz - 0.04, 0.76, 0.40, oz + 0.02, 'dash', 0.1, [30, 30, 28]);
    const O = K.panel([0.55, 0.199, oz - 0.01], [1, 0, 0], [0, 0, 1], 'dash', 0.1);
    O.digits(-0.03, -0.018, 0.03, '19', C.red);
    O.knob(-0.14, 0, 0.012, 0.014, C.chrome, 0.1);
    K.rod([0.40, 0.19, oz - 0.04], [0.37, 0.10, oz - 0.24], 0.004, 'dash', 0, C.black, 0, 4);
    K.obox([0.37, 0.10, oz - 0.27], [1, 0, 0], [0, 0, 1], [0, -1, 0], 0.025, 0.035, 0.018, 'dash', 0, C.black);
    K.rod([0.55, 0.62, P.roof], [0.55, 0.62, P.roof - 0.06], 0.03, 'dash', 0, dome ? [255, 226, 170] : [50, 48, 42], dome ? 1 : 0, 8);
    for (let i = 0; i < 4; i++) K.rod([0.55 + (i % 2 ? 0.035 : -0.035), 0.62 + (i < 2 ? 0.035 : -0.035), P.roof - 0.006], [0.55, 0.62, P.roof - 0.075], 0.003, 'dash', 0, C.steel, 0, 3);
    hangingToy(K, [0.30, 0.66, P.roof - 0.02], S.toys.hang || null);
    bobbleToy(K, [0.86, 0.70, P.dashZ], S.toys.dash || null);
    return;
  }
  K.box(0.26, 0.05, oz, 0.84, 0.66, P.roof, 'hdr', -0.30);
  const O = K.panel([0.55, 0.049, oz + 0.055], [1, 0, 0], [0, 0, 1], 'hdr', -0.2);
  O.rect(-0.14, -0.045, 0.14, 0.045, [16, 17, 20], 0, 0.001);
  O.digits(-0.03, -0.018, 0.034, '19', C.red);
  for (let i = 0; i < 6; i++) O.lamp(0.045 + i * 0.013, 0.02, 0.004, 0.006, on && i < 2 + ((rpm * 7) | 0) % 4, i < 4 ? C.green : C.red);
  O.knob(-0.10, 0, 0.014, 0.015, C.chrome, 0.1);
  K.rod([0.40, 0.04, oz], [0.37, 0.00, oz - 0.18], 0.004, 'dash', 0, C.black, 0, 4);
  K.obox([0.37, 0.0, oz - 0.21], [1, 0, 0], [0, 0, 1], [0, -1, 0], 0.025, 0.035, 0.018, 'dash', 0, C.black);
  // A ceiling ahead of the eye, lettered for reading it facing forward: up on the panel is aft
  // (docs/reference/cockpit-lettering.md rule 7). With up +y, DOME read mirrored.
  const U = K.panel([0.55, 0.60, oz - 0.001], [1, 0, 0], [0, -1, 0], 'hdr', -0.3);
  U.rect(-0.07, -0.05, 0.07, 0.05, dome ? [255, 238, 200] : [58, 58, 54], dome ? 1 : 0, 0.002);
  U.rocker(-0.12, 0, dome, C.black, 'DOME');
  if (tier >= 2) {
    // A pair of map lamps either side of the dome, aft of it.
    for (const x of [0.36, 0.74]) U.disc(x - 0.55, 0.12, 0.018, dome ? [255, 238, 200] : [70, 70, 66], dome ? 0.9 : 0.05, 0.002, 10);
  }
  hangingToy(K, [0.40, 0.66, oz], S.toys.hang || null);
  bobbleToy(K, [0.86, 0.70, P.dashZ], S.toys.dash || null);
  K.box(-0.42, 0.50, P.roof - 0.035, 0.20, 0.68, P.roof - 0.012, 'hdr', -0.15);
  K.box(0.90, 0.50, P.roof - 0.035, 1.52, 0.68, P.roof - 0.012, 'hdr', -0.15);
  K.box(1.05, 0.54, P.roof - 0.040, 1.30, 0.66, P.roof - 0.035, 'dash', 0.1, C.paper, 0.1);
}

// ── BEHIND YOU ───────────────────────────────────────────────────────────────
function truckBehind(S) {
  const { K, P, tier, xL, xR, glow, on } = S;
  if (tier === 0) {
    // No sleeper. The back of the cab is its ribs, a cargo net across them, an extinguisher on a
    // strap and a bench across the whole width that two people share if they have to.
    for (let i = 0; i < 5; i++) {
      const x = xL + 0.20 + i * (xR - xL - 0.40) / 4;
      K.box(x - 0.025, P.back, P.floor + 0.2, x + 0.025, P.back + 0.05, P.roof - 0.05, 'post', 0.05);
    }
    for (let j = 0; j < 4; j++) K.rod([xL + 0.15, P.back + 0.06, -0.05 + j * 0.12], [xR - 0.15, P.back + 0.06, -0.08 + j * 0.12], 0.004, 'dash', 0, C.black, 0, 3);
    for (let i = 0; i < 7; i++) {
      const x = xL + 0.15 + i * (xR - xL - 0.30) / 6;
      K.rod([x, P.back + 0.06, -0.08], [x + 0.02, P.back + 0.06, 0.34], 0.004, 'dash', 0, C.black, 0, 3);
    }
    K.rod([xR - 0.22, P.back + 0.10, P.floor + 0.25], [xR - 0.22, P.back + 0.10, P.floor + 0.70], 0.055, 'dash', 0.2, C.fireRed, 0.05, 10);
    K.box(xR - 0.25, P.back + 0.15, P.floor + 0.70, xR - 0.19, P.back + 0.18, P.floor + 0.76, 'dash', 0.1, C.black);
    // The bench: one cushion, one back, the whole width, and a blanket thrown over the far end.
    // ⚠ PROUD OF THE BASE SEATS ON EVERY FACE, never coplanar with them, or the two z-fight.
    K.box(xL + 0.04, P.seatY[0] - 0.005, P.seatZ - 0.12, xR - 0.04, P.seatY[1] + 0.012, P.seatZ + 0.015, 'seat', 0.05, [70, 58, 44]);
    K.box(xL + 0.04, P.seatY[0] - 0.175, P.seatZ, xR - 0.04, P.seatY[0] + 0.012, P.backZ + 0.012, 'seat', -0.05, [70, 58, 44]);
    K.box(0.95, P.seatY[0] + 0.012, P.seatZ + 0.015, 1.55, P.seatY[1] - 0.10, P.seatZ + 0.045, 'seat', 0.1, [90, 60, 50]);
    return;
  }
  // A curtain, or on the Continental a curtain drawn back into a bunch at one end.
  const n = tier === 3 ? 5 : 14, cz0 = P.floor + 0.30, cz1 = 0.09;
  const cx0 = xL + 0.05, span = (xR - xL - 0.10) * (tier === 3 ? 0.18 : 1);
  const cur = tier === 2 ? [40, 38, 46] : tier === 3 ? [60, 46, 40] : [58, 44, 40];
  for (let i = 0; i < n; i++) {
    const x0 = cx0 + span * (i / n), x1 = cx0 + span * ((i + 1) / n);
    K.box(x0, P.back, cz0, x1, P.back + (i % 2 ? 0.035 : 0.075), cz1, 'seat', i % 2 ? -0.30 : -0.10, cur);
  }
  K.rod([xL + 0.03, P.back + 0.045, cz1 + 0.005], [xR - 0.03, P.back + 0.045, cz1 + 0.005], 0.008, 'dash', 0, C.chrome, 0.1, 5);
  const seatRgb = tier === 3 ? [60, 44, 34] : tier === 2 ? [34, 34, 38] : [44, 46, 52];
  richSeat(K, 0, P, seatRgb);
  richSeat(K, 2 * P.xCentre, P, seatRgb);
  if (tier >= 2) {
    // Contrast stitching down each seat's bolsters, in the trim.
    for (const cx of [0, 2 * P.xCentre]) for (const s of [-1, 1]) {
      const x = cx + s * (P.seatHalf - 0.055);
      K.box(x - 0.002, P.seatY[0], P.seatZ + 0.051, x + 0.002, P.seatY[1], P.seatZ + 0.053, 'seat', 0, glow, 0.25);
    }
  }
}

// ── THE CONTINENTAL'S OWN ────────────────────────────────────────────────────
//
// ⚠ EVERY ONE OF THESE STAYS OFF THE THREE SIGHT LINES. The HUD sits BELOW the straight-ahead ray
// on the glass (it is what you glance down a hair to read, like the real thing), and the camera
// screens are on the pillars' own inner faces where the pillar already blocks the view.
function continentalExtras(S) {
  const { K, P, L, xL, xR, glow, on, mph } = S;
  if (on) {
    // THE HEAD-UP DISPLAY, projected on the screen: speed, the gear and the next turn. It is the
    // speedo moved, never a second fact — the same `mph`, the same `gear`, the same `navTurn`.
    const H = K.panel([0.0, screenY(P, 0) - 0.03, -0.13], [1, 0, 0], [0, 0, 1]);
    H.digits(-0.07, -0.018, 0.036, String(Math.round(mph)).padStart(3, ' '), glow, false);
    H.digits(0.02, -0.018, 0.024, S.gear, C.lampOn, false);
    const turn = num(L.navTurn);
    H.spoke(0.09, -0.018, Math.PI / 2 - turn * 0.9, 0, 0.03, 0.003, C.lampOn, 0.9, 0.001, 0.001);
    // The brake-temperature warning, only when there is one.
    if (L.fading) H.rect(-0.09, 0.024, 0.09, 0.03, C.red, 0.9, 0.001);
    const lift = liftOf(S).pods;
    lift.forEach((p, i) => H.disc(-0.115 + (i % 2) * 0.016, -0.004 - (i >> 1) * 0.016, 0.005, HOVER, 0.3 + 0.6 * p, 0.001, 8));
  }
  // CAMERA MIRRORS on the pillar feet: a screen each, showing the side of the rig as a dark field
  // with the lane line crossing it. The real mirrors stay outside, because a camera can die.
  for (const [x, s] of [[xL + P.pillarW + 0.005, 1], [xR - P.pillarW - 0.005, -1]]) {
    const M = K.panel([x + s * 0.08, 0.70, P.dashZ + 0.10], [0.5 * s, 0.87, 0], [0, 0, 1]);
    M.rect(-0.07, -0.09, 0.07, 0.09, C.black, 0, 0);
    M.rect(-0.062, -0.082, 0.062, 0.082, on ? [30, 38, 48] : C.screen, on ? 0.45 : 0, 0.003);
    if (on) {
      M.plate([[-0.062, -0.082], [-0.062, -0.02], [0.062, 0.03], [0.062, -0.082]], [44, 46, 52], 0.4, 0.004);
      M.plate([[-0.01, -0.082], [0.005, -0.082], [0.03, 0.02], [0.024, 0.02]], [220, 220, 200], 0.6, 0.005);
    }
  }
  // Captain's chairs: an armrest on each inboard side.
  for (const cx of [0, 2 * P.xCentre]) {
    const x = cx + (cx === 0 ? P.seatHalf + 0.01 : -P.seatHalf - 0.07);
    K.box(x, P.seatY[0] + 0.05, P.seatZ + 0.18, x + 0.06, P.seatY[1] - 0.12, P.seatZ + 0.23, 'seat', 0.1);
    K.rod([x + 0.03, P.seatY[0] + 0.10, P.seatZ + 0.05], [x + 0.03, P.seatY[0] + 0.10, P.seatZ + 0.18], 0.012, 'dash', 0, C.chrome, 0.1, 5);
  }
  // A QUILTED BULKHEAD between the seats, with the fridge let into it and a reading lamp over it.
  const fx0 = 0.32, fx1 = 0.78, fz1 = P.floor + 0.62;
  K.box(fx0, P.back, P.floor + 0.02, fx1, P.back + 0.10, fz1, 'dash', 0.05, [34, 30, 28]);
  K.box(fx0 + 0.02, P.back + 0.10, P.floor + 0.06, fx1 - 0.02, P.back + 0.102, fz1 - 0.04, 'dash', 0.2, [40, 36, 34]);
  K.box(fx1 - 0.08, P.back + 0.102, fz1 - 0.20, fx1 - 0.06, P.back + 0.12, fz1 - 0.08, 'dash', 0.2, C.chrome, 0.1);
  K.box(fx0 + 0.04, P.back + 0.102, fz1 - 0.08, fx0 + 0.10, P.back + 0.104, fz1 - 0.06, 'dash', 0, on ? C.blue : C.lampOff, on ? 0.8 : 0);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
    const x = xL + 0.30 + i * 0.52, z = 0.12 + j * 0.16;
    if (x > xR - 0.2) continue;
    K.box(x, P.back, z, x + 0.44, P.back + 0.03, z + 0.14, 'post', 0.08, [66, 50, 40]);
  }
  K.box(fx0, P.back + 0.10, fz1, fx1, P.back + 0.18, fz1 + 0.02, 'dash', 0.3, C.wood);
  K.rod([0.55, P.back + 0.02, 0.50], [0.55, P.back + 0.14, 0.44], 0.008, 'dash', 0, C.brass, 0.1, 5);
  K.rod([0.55, P.back + 0.14, 0.44], [0.55, P.back + 0.16, 0.42], 0.025, 'dash', 0, S.dome ? [255, 228, 180] : C.brass, S.dome ? 0.9 : 0.1, 8);
}

// ── THE LIGHT AIRCRAFT ───────────────────────────────────────────────────────
//
// A side-by-side flight deck: glareshield, a full panel with the six-pack in front of the left
// seat, engine gauges and a radio stack in the middle, annunciators and a GPS on the right, two
// yokes that roll with the aileron and slide with the elevator, a centre pedestal with the three
// levers and the trim wheel, rudder pedals, an overhead switch panel, a breaker panel on the wall,
// a magnetic compass on the coaming, and a headset on its hook.
export function planeFit(P, live, push) {
  const K = makeKit(push);
  const L = live || {};
  const xL = P.xCentre - P.halfW, xR = P.xCentre + P.halfW;
  const cx = P.xCentre;
  const pitch = num(L.pitch), bank = num(L.bank), hdg = num(L.hdg);
  const ias = Math.max(0, num(L.ias)), vne = Math.max(40, num(L.vne, 160));
  const alt = Math.max(0, num(L.alt)), vsi = num(L.vsi);
  const rpm = clamp(num(L.rpm), 0, 1.05), thr = clamp(num(L.throttle), 0, 1);
  const fuel = clamp(num(L.fuel, 1), 0, 1), hull = clamp(num(L.hull, 1), 0, 1);
  const powered = L.powered !== false;
  const ail = clamp(num(L.stickX), -1, 1), elev = clamp(num(L.stickY), -1, 1);
  const rud = clamp(num(L.rudder), -1, 1);

  // ── THE PANEL ──────────────────────────────────────────────────────────────
  const HH = 0.165;
  const pz = P.dashZ - 0.065 - HH, py = P.dashY - 0.006;
  const Pn = K.panel([cx, py, pz], [1, 0, 0], [0, 0, 1]);
  const HW = P.halfW - 0.03;
  Pn.rect(-HW, -HH, HW, HH, [34, 38, 44], 0, 0);
  // The glareshield's lip overhanging the panel, so the top row sits in its shadow.
  K.box(xL + 0.02, P.dashY - 0.035, P.dashZ - 0.062, xR - 0.02, P.dashY + 0.02, P.dashZ + 0.012, 'dash', 0.25);
  const pc = -cx;                                   // the pilot's own centreline, in panel coords
  const R = 0.046, dx = 0.118, r1 = 0.075, r2 = -0.055;
  // Top row: airspeed, attitude, altitude.
  Pn.dial(pc - dx, r1, R, clamp(ias / (vne * 1.1), 0, 1), { ticks: 16, major: 4, arcs: [[0.18, 0.55, C.white], [0.3, 0.82, C.green], [0.82, 0.91, C.amber]], red: 0.91, name: 'IAS' });
  Pn.attitude(pc, r1, R, pitch, bank);
  Pn.dial(pc + dx, r1, R, (alt % 1000) / 1000, { a0: Math.PI / 2, sweep: Math.PI * 2, ticks: 10, major: 1, frac2: (alt % 10000) / 10000, name: 'ALT' });
  // Bottom row: turn coordinator, heading, vertical speed.
  Pn.dial(pc - dx, r2, R, clamp(0.5 + bank / 60, 0, 1), { a0: Math.PI * 0.9, sweep: Math.PI * 0.8, ticks: 4, major: 2, needle: C.white, name: 'TURN' });
  Pn.compass(pc, r2, R, hdg);
  Pn.dial(pc + dx, r2, R, clamp(0.5 + vsi / 4000, 0, 1), { a0: Math.PI, sweep: Math.PI * 2 * 0.9, ticks: 8, major: 2, name: 'VSI' });
  // Outboard of the six-pack: the clock and the suction gauge.
  Pn.dial(pc - dx * 1.9, r1, 0.03, ((Date.UTC(2000, 0, 1) / 60000) % 60) / 60, { a0: Math.PI / 2, sweep: Math.PI * 2, ticks: 12, major: 3, name: 'CLOCK' });
  Pn.dial(pc - dx * 1.9, r2, 0.03, powered ? 0.55 : 0, { ticks: 4, major: 2, arcs: [[0.35, 0.7, C.green]], name: 'VAC' });
  // Engine: the tacho, oil temperature and two fuel columns.
  const ex = pc + dx * 1.95;
  Pn.dial(ex, r1, 0.042, rpm, { ticks: 10, major: 2, arcs: [[0.55, 0.85, C.green]], red: 0.92, name: 'RPM' });
  Pn.dial(ex, r2, 0.030, clamp(num(L.oilTemp), 0, 1), { a0: Math.PI * 0.85, sweep: Math.PI * 0.7, ticks: 4, major: 2, arcs: [[0.3, 0.8, C.green], [0.85, 1, C.red]], name: 'OIL' });
  Pn.bar(ex + 0.055, -0.14, -0.02, 0.009, fuel, fuel < 0.15 ? C.red : C.green, 'L');
  Pn.bar(ex + 0.078, -0.14, -0.02, 0.009, fuel, fuel < 0.15 ? C.red : C.green, 'R');
  // The radio stack: two comm/nav heads and a transponder.
  const rx = ex + 0.17;
  for (const [row, txt, col] of [[0.10, '12280', C.lcd], [0.035, '11340', C.lcd], [-0.03, '1200 ', C.green]]) {
    Pn.rect(rx - 0.075, row - 0.018, rx + 0.075, row + 0.030, [18, 20, 24], 0, 0.002);
    Pn.digits(rx - 0.058, row - 0.008, 0.026, powered ? txt : '     ', col, true);
    Pn.knob(rx + 0.062, row + 0.006, 0.010, 0.012, C.black, 0);
  }
  // The annunciators, the gear and the GPS on the right side of the panel.
  const ax = rx + 0.125;
  [[!!L.stall, C.red, 'STALL'], [fuel < 0.15, C.amber, 'FUEL'], [hull < 0.35, C.red, 'HULL'], [!!L.bingo, C.amber, 'BINGO']]
    .forEach(([lit, rgb, nm], i) => annun(Pn, nm, ax, 0.10 - i * 0.034, 0.022, 0.011, lit && powered, rgb));
  const gpsx = ax + 0.12;
  if (gpsx + 0.07 < HW) {
    Pn.rect(gpsx - 0.075, -0.02, gpsx + 0.075, 0.13, [18, 20, 24], 0, 0.002);
    Pn.rect(gpsx - 0.065, -0.01, gpsx + 0.065, 0.12, powered ? [10, 30, 40] : C.screen, powered ? 0.4 : 0, 0.004);
    if (powered) {
      Pn.annulus(gpsx, 0.055, 0.035, 0.038, [60, 150, 170], 0.6, 0.006, 16);
      Pn.plate([[gpsx, 0.075], [gpsx + 0.01, 0.045], [gpsx, 0.052], [gpsx - 0.01, 0.045]], C.lampOn, 0.9, 0.007);
      Pn.spoke(gpsx, 0.055, Math.PI / 2 - num(L.courseErr) * Math.PI / 180, 0.0, 0.055, 0.0018, [220, 90, 220], 0.9, 0.007);
    }
  }
  if (!L.gearFixed) {
    const gx = gpsx, gy = -0.10, down = L.gearDown !== false;
    Pn.rect(gx - 0.045, gy - 0.05, gx + 0.045, gy + 0.05, [26, 28, 32], 0, 0.002);
    for (let i = 0; i < 3; i++) Pn.lamp(gx + 0.022, gy + 0.030 - i * 0.03, 0.007, 0.007, down && powered, C.green, ['NOSE', 'L', 'R'][i]);
    const tip = Pn.pt(gx - 0.012, gy + (down ? -0.035 : 0.035), 0.05);
    K.rod(Pn.pt(gx - 0.012, gy, 0.002), tip, 0.004, 'dash', 0, C.chrome, 0.1, 5);
    K.rod(tip, [tip[0], tip[1] - 0.006, tip[2]], 0.012, 'dash', 0, C.white, 0.2, 8);
  }
  // A row of toggles along the bottom: master, alternator, landing, taxi, nav, strobe, pitot.
  const tog = [powered, powered, !!L.landingLight, !!L.landingLight, powered, powered, false];
  const togN = ['MSTR', 'ALT', 'LDG', 'TAXI', 'NAV', 'STROBE', 'PITOT'];
  tog.forEach((st, i) => Pn.toggle(pc - 0.25 + i * 0.045, -0.135, st, togN[i]));
  // The key, in the magneto switch.
  Pn.annulus(pc + 0.10, -0.135, 0.016, 0.022, C.chrome, 0.1, 0.002, 12);
  Pn.text('MAG', pc + 0.10, -0.1615, 0.0065);
  Pn.stud(pc + 0.10, -0.135, 0.004, 0.014, 0.018, C.steel, 0.1);

  // ── THE YOKES ──────────────────────────────────────────────────────────────
  for (const yx of [0, 2 * cx]) {
    const end = [yx, 0.34 - elev * 0.05, pz - 0.10];
    K.rod([yx, py, pz - 0.10], end, 0.016, 'dash', 0, C.steel, 0.1, 8);
    const a = ail * 0.6;
    const Rr = [Math.cos(a), 0, -Math.sin(a)], Uu = [Math.sin(a), 0, Math.cos(a)];
    K.obox(end, Rr, Uu, [0, 1, 0], 0.035, 0.03, 0.02, 'dash', 0.05, C.black);
    for (const s of [-1, 1]) {
      const root = add3(end, mul3(Rr, s * 0.10));
      K.rod(add3(end, mul3(Rr, s * 0.02)), root, 0.014, 'dash', 0, C.black, 0, 6);
      K.rod(root, add3(root, mul3(Uu, 0.11)), 0.018, 'dash', 0.05, C.grip, 0, 6);
      K.obox(add3(root, mul3(Uu, 0.115)), Rr, Uu, [0, -1, 0], 0.008, 0.006, 0.008, 'dash', 0.2, s < 0 ? C.red : C.black, s < 0 ? 0.2 : 0);
    }
    // The checklist clipped to the middle of the yoke.
    K.obox(add3(end, [0, -0.025, 0.005]), Rr, Uu, [0, -1, 0], 0.028, 0.02, 0.002, 'dash', 0.4, C.paper, 0.1);
  }

  // ── THE PEDESTAL ───────────────────────────────────────────────────────────
  const qz = pz - HH - 0.02;
  K.box(cx - 0.09, 0.02, P.floor, cx + 0.09, py, qz, 'dash', -0.08);
  const Q = K.panel([cx, 0.20, qz + 0.001], [1, 0, 0], [0, 1, 0]);
  Q.rect(-0.08, -0.16, 0.08, 0.20, [22, 24, 28], 0, 0.001);
  [[-0.05, thr, C.black], [0, 0.95, C.blue], [0.05, 0.98, C.red]].forEach(([dxq, v, rgb]) => {
    Q.rect(dxq - 0.004, -0.12, dxq + 0.004, 0.14, C.black, 0, 0.002);
    const tip = [cx + dxq, 0.26 + v * 0.16, qz + 0.10];
    K.rod([cx + dxq, 0.26 + v * 0.16, qz], tip, 0.004, 'dash', 0, C.chrome, 0.1, 5);
    K.obox(tip, [1, 0, 0], [0, 0, 1], [0, -1, 0], 0.011, 0.013, 0.011, 'dash', 0.1, rgb, rgb === C.black ? 0 : 0.15);
  });
  // Throttle, prop and mixture, lettered at the foot of their slots.
  ['THR', 'PROP', 'MIX'].forEach((nm, i) => Q.fitText(nm, -0.05 + i * 0.05, -0.14, 0.045, 0.0085));
  // The flap lever with its four detents.
  const fl = clamp(num(L.flapNotch), 0, 3);
  for (let i = 0; i <= 3; i++) Q.rect(0.065, 0.12 - i * 0.07 - 0.003, 0.078, 0.12 - i * 0.07 + 0.003, C.tick, 0.2, 0.003);
  const ft = [cx + 0.072, 0.20 + 0.12 - fl * 0.07, qz + 0.09];
  K.rod([cx + 0.072, ft[1], qz], ft, 0.004, 'dash', 0, C.chrome, 0.1, 5);
  K.obox(ft, [1, 0, 0], [0, 0, 1], [0, -1, 0], 0.012, 0.008, 0.02, 'dash', 0.2, C.white, 0.1);
  // The trim wheel on the pilot's side of the pedestal, turned by the trim.
  const T = K.panel([cx - 0.091, 0.18, qz - 0.13], [0, 1, 0], [0, 0, 1]);
  T.rect(-0.06, -0.10, 0.06, 0.10, [20, 22, 26], 0, 0.001);
  T.disc(0, 0, 0.07, C.black, 0, 0.004, 16);
  const tr = num(L.trim) * 3;
  for (let i = 0; i < 8; i++) T.spoke(0, 0, tr + i * Math.PI / 4, 0.055, 0.07, 0.006, C.tick, 0.2, 0.012);
  // The fuel selector on the floor in front of the pedestal.
  K.box(cx - 0.05, py - 0.12, P.floor, cx + 0.05, py - 0.02, P.floor + 0.02, 'dash', 0.1, [28, 30, 34]);
  K.obox([cx, py - 0.07, P.floor + 0.03], [Math.SQRT1_2, Math.SQRT1_2, 0], [0, 0, 1], [Math.SQRT1_2, -Math.SQRT1_2, 0], 0.04, 0.012, 0.008, 'dash', 0.2, C.red, 0.1);

  // ── THE RUDDER PEDALS ──────────────────────────────────────────────────────
  for (const sx of [0, 2 * cx]) {
    pedal(K, [sx - 0.09, 0.66, P.floor + 0.32], 0.045, 0.24, Math.max(0, -rud), C.steel);
    pedal(K, [sx + 0.09, 0.66, P.floor + 0.32], 0.045, 0.24, Math.max(0, rud), C.steel);
  }

  // ── THE COMPASS ON THE COAMING ─────────────────────────────────────────────
  K.box(cx - 0.035, P.front - 0.14, P.dashZ, cx + 0.035, P.front - 0.08, P.dashZ + 0.055, 'dash', 0.1, C.black);
  const Cp = K.panel([cx, P.front - 0.141, P.dashZ + 0.028], [1, 0, 0], [0, 0, 1]);
  Cp.rect(-0.026, -0.020, 0.026, 0.020, [230, 226, 210], 0.3, 0.001);
  for (let i = -2; i <= 2; i++) Cp.rect(i * 0.01 - 0.001, -0.012, i * 0.01 + 0.001, 0.004, C.black, 0, 0.002);
  Cp.rect(-0.0012, -0.02, 0.0012, 0.02, C.red, 0.5, 0.003);

  // ── OVERHEAD ───────────────────────────────────────────────────────────────
  const oz = P.roof - 0.06;
  K.box(cx - 0.20, 0.02, oz, cx + 0.20, 0.40, P.roof, 'hdr', -0.25);
  const O = K.panel([cx, 0.21, oz - 0.001], [1, 0, 0], [0, 1, 0], 'hdr', -0.25);
  for (let i = 0; i < 6; i++) O.toggle(-0.14 + i * 0.056, 0.08, i < 3 ? powered : !!L.landingLight, ['BAT', 'GEN', 'AVN', 'LDG', 'TAXI', 'WING'][i]);
  O.rect(-0.16, -0.14, 0.16, -0.04, [20, 22, 26], 0, 0.002);
  O.annulus(-0.11, -0.09, 0.02, 0.028, C.chrome, 0.1, 0.004, 10);
  O.annulus(0.11, -0.09, 0.02, 0.028, C.chrome, 0.1, 0.004, 10);
  O.rect(-0.05, -0.12, 0.05, -0.06, powered ? [255, 236, 196] : [60, 58, 54], powered ? 0.8 : 0, 0.004);

  // ── THE WALLS ──────────────────────────────────────────────────────────────
  // A breaker panel on the pilot's wall under the window, and a vent eyeball each side.
  const W = K.panel([xL, 0.30, P.winZ[0] - 0.14], [0, 1, 0], [0, 0, 1], 'pil', -0.05);
  W.rect(-0.14, -0.08, 0.14, 0.08, [24, 26, 30], 0, 0.002);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 8; c++) W.stud(-0.12 + c * 0.034, 0.05 - r * 0.05, 0.007, 0.007, 0.012, C.black, 0);
  for (const x of [xL, xR]) {
    const Vp = K.panel([x, 0.50, P.winZ[0] - 0.04], [0, 1, 0], [0, 0, 1], 'pil', -0.05);
    Vp.annulus(0, 0, 0.025, 0.034, C.chrome, 0.1, 0.002, 12);
    Vp.disc(0, 0, 0.025, C.black, 0, 0.012, 12);
    // The armrest along the wall.
    const Ar = K.panel([x, -0.10, P.seatZ + 0.22], [0, 1, 0], [0, 0, 1], 'pil', -0.05);
    Ar.stud(0, 0, 0.22, 0.025, 0.06, null, 0, 0, 'pil');
  }
  // The headset on its hook behind the pilot's window.
  const hx = xL + 0.05, hy = P.winY[0] - 0.05, hz = P.winZ[0] + 0.02;
  K.rod([xL, hy, hz + 0.16], [hx, hy, hz + 0.16], 0.006, 'dash', 0, C.steel, 0, 4);
  K.torus([hx + 0.02, hy, hz + 0.06], [0, 1, 0], [0, 0, 1], 0.09, 0.012, 10, 'dash', 0, C.black, 0, 0, Math.PI);
  for (const s of [-1, 1]) {
    K.rod([hx + 0.02, hy + s * 0.09, hz + 0.06], [hx + 0.06, hy + s * 0.09, hz + 0.06], 0.045, 'dash', 0.05, [40, 60, 90], 0, 10);
  }
  K.rod([hx + 0.04, hy + 0.09, hz + 0.04], [hx + 0.10, hy + 0.16, hz - 0.02], 0.004, 'dash', 0, C.black, 0, 4);
  // The extinguisher, strapped to the floor between the seats.
  K.rod([cx, -0.30, P.floor], [cx, -0.30, P.floor + 0.30], 0.042, 'dash', 0.1, C.fireRed, 0.05, 10);
  K.rod([cx, -0.30, P.floor + 0.30], [cx, -0.30, P.floor + 0.35], 0.014, 'dash', 0.1, C.black, 0, 6);
  K.box(cx - 0.05, -0.305, P.floor + 0.10, cx + 0.05, -0.34, P.floor + 0.13, 'dash', 0, C.steel);
  richSeat(K, 0, P, [58, 54, 48]);
  richSeat(K, 2 * cx, P, [58, 54, 48]);
}

// An annunciator: a lamp with its name on the lens rather than under it, which is where a stack of
// them has room for one. Dark ink on a lit lens, pale on a dark one.
export function annun(Pn, name, ca, cb, ha, hb, lit, rgb) {
  Pn.lamp(ca, cb, ha, hb, lit, rgb);
  Pn.fitText(name, ca, cb, ha * 1.8, Math.min(hb * 1.2, 0.0085), lit ? [24, 20, 16] : [150, 148, 140], lit ? 0 : 0.2, 0.0075);
}

// ── THE HELICOPTER ───────────────────────────────────────────────────────────
//
// The bubble is built by `bubbleRoom` below (it is the ROOM, and a heli has a different room); this
// is what sits in it: a pod on a post carrying the gauges, a cyclic between your knees, a
// collective at your left hand with the twist-grip throttle on it, pedals, and an overhead console.
export function heliFit(P, live, push) {
  const K = makeKit(push);
  const L = live || {};
  const pitch = num(L.pitch), bank = num(L.bank), hdg = num(L.hdg);
  const ias = Math.max(0, num(L.ias)), alt = Math.max(0, num(L.alt)), vsi = num(L.vsi);
  const rpm = clamp(num(L.rpm), 0, 1.05), thr = clamp(num(L.throttle), 0, 1);
  const fuel = clamp(num(L.fuel, 1), 0, 1), powered = L.powered !== false;
  const ail = clamp(num(L.stickX), -1, 1), elev = clamp(num(L.stickY), -1, 1), rud = clamp(num(L.rudder), -1, 1);

  // ── THE POD ────────────────────────────────────────────────────────────────
  const po = [0.0, P.dashY, P.dashZ];
  K.rod([0, P.dashY + 0.06, P.floor], [0, P.dashY + 0.06, P.dashZ - 0.12], 0.035, 'dash', -0.05, C.black, 0, 8);
  const Pn = K.panel(po, [1, 0, 0], [0, 0.35, 0.94]);
  const HW = 0.29, HH = 0.115;
  Pn.rect(-HW, -HH, HW, HH, [28, 30, 34], 0, 0);
  // ⚠ BEHIND THE PANEL'S TOP EDGE: the face leans back ~4 cm over its height, so a body starting
  // any nearer than that slices through the top row of gauges.
  K.box(-HW - 0.01, P.dashY + 0.05, P.dashZ - HH - 0.02, HW + 0.01, P.dashY + 0.16, P.dashZ + HH - 0.01, 'dash', -0.05);
  K.box(-HW - 0.02, P.dashY + 0.035, P.dashZ + HH * 0.94 + 0.004, HW + 0.02, P.dashY + 0.16, P.dashZ + HH * 0.94 + 0.02, 'dash', 0.3);
  const R = 0.042;
  Pn.dial(-0.21, 0.045, R, clamp(ias / 140, 0, 1), { ticks: 14, major: 2, arcs: [[0.1, 0.75, C.green]], red: 0.9, name: 'IAS' });
  Pn.attitude(-0.105, 0.045, R, pitch, bank);
  Pn.dial(0.0, 0.045, R, (alt % 1000) / 1000, { a0: Math.PI / 2, sweep: Math.PI * 2, ticks: 10, major: 1, frac2: (alt % 10000) / 10000, name: 'ALT' });
  // The dual tacho: rotor and engine on one face, which is the helicopter's defining instrument.
  Pn.dial(0.105, 0.045, R, clamp(rpm, 0, 1), { ticks: 10, major: 2, frac2: clamp(rpm * 0.98, 0, 1), needle2: C.lampOn, needle: C.amber, arcs: [[0.85, 0.95, C.green]], red: 0.97, name: 'RPM' });
  Pn.dial(0.21, 0.045, R, clamp(thr * 0.9 + 0.05, 0, 1), { ticks: 10, major: 2, arcs: [[0, 0.75, C.green], [0.75, 0.9, C.amber]], red: 0.9, name: 'MAP' });
  Pn.compass(-0.105, -0.058, 0.034, hdg);
  Pn.dial(0.0, -0.058, 0.034, clamp(0.5 + vsi / 3000, 0, 1), { a0: Math.PI, sweep: Math.PI * 1.8, ticks: 8, major: 2, name: 'VSI' });
  Pn.bar(-0.24, -0.095, -0.02, 0.01, fuel, fuel < 0.15 ? C.red : C.green, 'FUEL');
  [[fuel < 0.15, C.amber, 'FUEL'], [rpm < 0.85 && powered, C.red, 'LOW RPM'], [!!L.stall, C.red, 'STALL'], [!powered, C.amber, 'GEN']]
    .forEach(([lit, rgb, nm], i) => annun(Pn, nm, 0.11 + (i % 2) * 0.07, -0.04 - (i >> 1) * 0.035, 0.028, 0.012, lit, rgb));
  // The compass on top of the pod, where every helicopter puts it.
  K.box(-0.03, P.dashY + 0.04, P.dashZ + HH * 0.94 + 0.012, 0.03, P.dashY + 0.09, P.dashZ + HH * 0.94 + 0.05, 'dash', 0.1, C.black);

  // ── THE CYCLIC ─────────────────────────────────────────────────────────────
  const cb = [0, 0.14, P.floor + 0.02];
  const ct = [ail * 0.06, 0.20 + elev * 0.07, -0.42];
  K.obox([0, 0.14, P.floor + 0.04], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.06, 0.06, 0.03, 'dash', 0, C.rubber);
  K.rod(cb, ct, 0.014, 'dash', 0, C.black, 0, 6);
  const grip = add3(ct, [0.01, -0.03, 0.10]);
  K.rod(ct, grip, 0.020, 'dash', 0.05, C.grip, 0, 6);
  K.obox(add3(grip, [0, -0.012, 0.012]), [1, 0, 0], [0, 0, 1], [0, -1, 0], 0.008, 0.006, 0.006, 'dash', 0.2, C.red, 0.2);
  // ── THE COLLECTIVE ─────────────────────────────────────────────────────────
  const kx = -P.seatHalf - 0.06;
  const cp = [kx, P.seatY[0] - 0.02, P.seatZ - 0.05];
  const ce = [kx, P.seatY[1] + 0.12, P.seatZ + 0.06 + thr * 0.16];
  K.box(kx - 0.04, P.seatY[0] - 0.08, P.floor, kx + 0.04, P.seatY[0] + 0.05, P.seatZ - 0.03, 'dash', -0.1, C.black);
  K.rod(cp, ce, 0.016, 'dash', 0, C.steel, 0.1, 6);
  K.rod(ce, add3(ce, [0, 0.11, 0.03]), 0.024, 'dash', 0.05, C.grip, 0, 8);
  K.obox(add3(ce, [0, 0.06, 0.035]), [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.02, 0.03, 0.012, 'dash', 0.1, C.black);
  // ── THE PEDALS ─────────────────────────────────────────────────────────────
  for (const sx of [0, 2 * P.xCentre]) {
    pedal(K, [sx - 0.10, P.dashY + 0.22, P.floor + 0.26], 0.045, 0.20, Math.max(0, -rud), C.steel);
    pedal(K, [sx + 0.10, P.dashY + 0.22, P.floor + 0.26], 0.045, 0.20, Math.max(0, rud), C.steel);
  }
  // ── OVERHEAD ───────────────────────────────────────────────────────────────
  const cx = P.xCentre;
  const oz = P.roof - 0.07;
  K.box(cx - 0.14, P.back + 0.05, oz, cx + 0.14, P.roofEnd - 0.02, P.roof, 'hdr', -0.25);
  const O = K.panel([cx, (P.back + P.roofEnd) / 2, oz - 0.001], [1, 0, 0], [0, 1, 0], 'hdr', -0.25);
  const ohN = [['BAT', 'GEN', 'AVN', 'NAV', 'BCN'], ['LDG', 'POS', 'STRB', 'PITOT', 'FUEL']];
  for (let r = 0; r < 2; r++) for (let i = 0; i < 5; i++) O.toggle(-0.10 + i * 0.05, 0.05 - r * 0.09, powered && (i + r) % 3 !== 0, ohN[r][i]);
  O.rect(-0.08, -0.16, 0.08, -0.11, [22, 24, 28], 0, 0.002);
  // A fire extinguisher by the passenger's seat, and both seats.
  K.rod([2 * cx + P.seatHalf + 0.07, P.seatY[1], P.floor], [2 * cx + P.seatHalf + 0.07, P.seatY[1], P.floor + 0.28], 0.04, 'dash', 0.1, C.fireRed, 0.05, 10);
  richSeat(K, 0, P, [70, 66, 58]);
  richSeat(K, 2 * cx, P, [70, 66, 58]);
  craftControls(K, Pn, 'heli', P, live);
}

// ── THE BUBBLE ───────────────────────────────────────────────────────────────
//
// ⚠ THE GLASS IS AN ABSENCE, EXACTLY LIKE THE WINDSCREEN. A helicopter's cabin is a bubble glazed
// from over your head to below your feet, so the room is a floor that stops short of the nose (the
// chin window is under your pedals), a roof that stops over your head, a rear bulkhead, two door
// frames — and struts. Everything forward of the doors is frame and air.
export function bubbleRoom(P, push) {
  const K = makeKit(push, false);
  const xL = P.xCentre - P.halfW, xR = P.xCentre + P.halfW;
  const [wy0, wy1] = P.winY, [wz0, wz1] = P.winZ;
  const q = (p, n, tone, k) => push([{ p, n }], tone, k, false);
  // The floor, stopping at the chin window, and a keel strip round the front of it.
  q([[xL, P.back, P.floor], [xR, P.back, P.floor], [xR, P.chinY, P.floor], [xL, P.chinY, P.floor]], [0, 0, 1], 'floor', -0.30);
  K.box(xL, P.chinY, P.floor, xR, P.chinY + 0.05, P.floor + 0.05, 'post', 0.05);
  // The roof over the seats, stopping where the overhead glazing starts.
  q([[xL, P.roofEnd, P.roof], [xR, P.roofEnd, P.roof], [xR, P.back, P.roof], [xL, P.back, P.roof]], [0, 0, -1], 'hdr', -0.45);
  K.box(xL, P.roofEnd - 0.05, P.roof - 0.05, xR, P.roofEnd, P.roof, 'post', 0.05);
  // The rear bulkhead.
  q([[xR, P.back, P.floor], [xL, P.back, P.floor], [xL, P.back, P.roof], [xR, P.back, P.roof]], [0, 1, 0], 'post', -0.16);
  // The door frames: a card below the window, a rail above it, and the posts either side.
  for (const [x, nx] of [[xL, 1], [xR, -1]]) {
    const pane = (a0, a1, b0, b1) => q([[x, a0, b0], [x, a1, b0], [x, a1, b1], [x, a0, b1]], [nx, 0, 0], 'pil', nx > 0 ? -0.10 : -0.22);
    pane(P.back, P.doorY, P.floor, wz0);
    pane(P.back, P.doorY, wz1, P.roof);
    pane(P.back, wy0, wz0, wz1);
    pane(wy1, P.doorY, wz0, wz1);
    K.box(x, P.doorY - 0.04, P.floor, x + nx * 0.05, P.doorY + 0.02, P.roof, 'pil', 0.2);
  }
  // The frame of the bubble: a keel over the centreline and a bow either side, each a polyline of
  // struts from the roof's front edge, round the nose, and down to the chin.
  // ⚠ PULLED IN BY THE STRUT'S OWN RADIUS, so a tube laid along the edge of the room stays inside it.
  const m = 0.024;
  const inb = (q) => [Math.min(xR - m, Math.max(xL + m, q[0])), Math.min(P.front - m, Math.max(P.back + m, q[1])), Math.min(P.roof - m, Math.max(P.floor + m, q[2]))];
  const strut = (pts, tone = 'pil', k = 0.22) => { for (let i = 1; i < pts.length; i++) K.rod(inb(pts[i - 1]), inb(pts[i]), 0.022, tone, k, null, 0, 6); };
  const xc = P.xCentre, zc = (P.roof + P.floor) / 2, rz = (P.roof - P.floor) / 2;
  const keel = [];
  for (let i = 0; i <= 10; i++) {
    const t = (i / 10) * Math.PI;
    keel.push([xc, P.roofEnd + (P.front - P.roofEnd) * Math.sin(t), zc + rz * Math.cos(t)]);
  }
  keel[10][1] = P.chinY;
  strut(keel);
  for (const xs of [xL, xR]) {
    const m = (f) => xs * (1 - f) + xc * f;
    strut([[xs, P.roofEnd, P.roof], [m(0.18), P.front - 0.30, P.roof - 0.20], [m(0.38), P.front - 0.08, zc + 0.20],
      [m(0.34), P.front - 0.10, zc - 0.35], [m(0.14), P.chinY + 0.25, P.floor + 0.08], [xs, P.doorY, P.floor]]);
    strut([[xs, P.doorY, P.floor], [xs, P.doorY, P.roof]]);
  }
}

const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

// ── THE BOAT'S EXTRAS ────────────────────────────────────────────────────────
//
// The boat already had its cluster, wheel and lever as geometry (`instrumentFaces` in
// interior-shell.js). What it lacked against the other three seats was the CLUTTER that says a
// person works here: a compass binnacle on the dash, a rocker bank for the pumps and lights, a grab
// rail for the passenger, and an extinguisher.
//
// ⚠ AND IT NOW CARRIES THE TRUCK'S STANDARD OF FINISH. The lofted room had the right SHAPE and
// every panel of it was one flat fill, which is what separated it from the cab more than any
// missing gauge: `grainRoomPush` subdivides the room's big quads and hands each tone a material, so
// the sole reads as non-slip deck, the lining as cloth and the fascia as moulded hard plastic, and
// the fittings below add a stitched hide brow over the cluster, a chart plotter, a side console with
// the nitro arming switch under a flip cover, the kill cord, an overhead VHF, a passenger seat and
// the lockers behind you.

// Materials by tone for the pilothouse room. `lv` stays near 1 so a colourway reads as itself.
export const BOAT_MAT = {
  floor: { lv: 0.92, spec: 0.06, pow: 4, grain: 0.22, tex: 'rubber' },    // non-slip deck
  hdr:   { lv: 1.10, spec: 0, pow: 1, grain: 0.07, tex: 'fabric' },       // the lining
  pil:   { lv: 1.02, spec: 0.28, pow: 14, grain: 0.10 },                  // wall cards
  post:  { lv: 0.95, spec: 0.30, pow: 16, grain: 0.12 },                  // bulkhead, door
  dash:  { lv: 1.00, spec: 0.50, pow: 30, grain: 0.10, tex: 'fabric' },  // moulded fascia, laid up in carbon twill
  seat:  { lv: 0.90, spec: 0.20, pow: 8, grain: 0.07 },
  hide:  { lv: 0.85, spec: 0.24, pow: 10, grain: 0.05, tex: 'leather' },  // stitched soft trim
  carbon:{ lv: 0.70, spec: 0.55, pow: 34, grain: 0.04, tex: 'fabric' },  // twill, like the pod  // the console tops
};

// A push that grains what it is given: a quad with no material of its own is split into small faces
// (so the stipple has something to vary across) and takes its tone's material. Faces that already
// state a colour (`rgb`) are instruments and pass through untouched.
export function grainRoomPush(push, mats = BOAT_MAT) {
  return (fs, tone, k, fwd, rgb, emis, mat) => {
    const m = mat || (rgb ? null : mats[tone]);
    if (!m) { push(fs, tone, k, fwd, rgb, emis, mat); return; }
    for (const f of fs) {
      if (!m.grain || !f.p || f.p.length !== 4) { push([f], tone, k, fwd, rgb, emis, m); continue; }
      const [a, b, c, d] = f.p;
      const len = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
      const su = clamp(Math.round(Math.max(len(a, b), len(d, c)) / 0.35), 1, 5);
      const sv = clamp(Math.round(Math.max(len(a, d), len(b, c)) / 0.35), 1, 5);
      const subs = [];
      for (let i = 0; i < su; i++) for (let j = 0; j < sv; j++) {
        const u0 = i / su, u1 = (i + 1) / su, v0 = j / sv, v1 = (j + 1) / sv;
        // ⚠ EACH PIECE TAKES ITS OWN NORMAL. The lofted room's quads are not flat, so a piece handed
        // the parent's one normal lies in the wrong plane; the shell gate's ray sweep then slipped
        // between neighbouring pieces and reported rays leaving through the roof.
        // And as two triangles rather than one quad: a piece of a twisted quad is itself twisted,
        // and two twisted pieces side by side leave a hairline between their planes.
        const q4 = [bil(a, b, c, d, u0, v0), bil(a, b, c, d, u1, v0), bil(a, b, c, d, u1, v1), bil(a, b, c, d, u0, v1)];
        for (const [i0, i1, i2] of [[0, 1, 2], [0, 2, 3]]) {
          const A = q4[i0], B = q4[i1], Cc = q4[i2];
          const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], e2 = [Cc[0] - A[0], Cc[1] - A[1], Cc[2] - A[2]];
          const nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
          const nl = Math.hypot(nx, ny, nz);
          if (!(nl > 1e-12)) continue;
          let n = [nx / nl, ny / nl, nz / nl];
          if (f.n && n[0] * f.n[0] + n[1] * f.n[1] + n[2] * f.n[2] < 0) n = [-n[0], -n[1], -n[2]];
          subs.push({ p: [A, B, Cc, Cc], n });
        }
      }
      push(subs, tone, k, fwd, rgb, emis, m);
    }
  };
}

export function boatFit(P, live, push) {
  const K = makeKit(push);
  const L = live || {};
  const I = P.instr || {};
  const cx = I.cx != null ? I.cx : P.xCentre;
  const yT = I.panelY1 ?? 0.62, zT = I.panelZ1 ?? -0.05;
  const on = !!(L.running || L.lit);
  // The compass binnacle on top of the pod.
  const bTop = Math.min(zT + 0.035, -0.03);
  K.box(cx - 0.04, yT + 0.00, bTop - 0.05, cx + 0.04, yT + 0.07, bTop, 'dash', 0.1, C.black);
  const Cp = K.panel([cx, yT - 0.001, bTop - 0.025], [1, 0, 0], [0, 0, 1]);
  Cp.compass(0, 0, 0.022, num(L.hdg));
  // ⚠ NO SWITCHES HERE: every switch on this helm is on the port panel (interior-hydro.js), where
  // each one does something. A rocker bank of bilge, blower and anchor light stood here with
  // nothing behind any of it.
  const yB = I.panelY0 ?? 0.52, zB = I.panelZ0 ?? -0.34;
  // A second, smaller pod inboard of the first, on the dash top: the depth sounder, the VHF channel
  // and the two trim-tab bars — the things a race boat carries that a truck and a plane do not.
  const Sp = K.panel([cx - 0.62, yB + 0.06, zB + 0.07], [1, 0, 0], [0, 0.5, 0.87]);
  Sp.rect(-0.15, -0.06, 0.15, 0.06, [22, 24, 28], 0, 0);
  Sp.digits(-0.13, -0.02, 0.04, '124', C.lcd);
  Sp.digits(0.00, -0.02, 0.04, '16', C.amber);
  const trim = clamp(num(L.trim), -1, 1);
  Sp.bar(0.10, -0.045, 0.045, 0.008, 0.5 + trim * 0.5, C.green);
  Sp.bar(0.125, -0.045, 0.045, 0.008, 0.5 + trim * 0.5, C.green);
  // The race seat, in the round, and a foot brace angled up off the sole.
  richSeat(K, 0, P, [40, 44, 52], false);
  // The foot brace: a raked rest you jam your feet against when she comes off a wave. A grip-taped
  // pad in a billet frame on two rails off the sole. ⚠ NOT POLISHED STEEL: a bright mirror tilted up
  // at the eye picked up the sky as a noisy white patch and was the brightest thing in the footwell.
  {
    const c = [0, 0.62, P.floor + 0.10], U = [0, 0.6, 0.8], Nn = [0, -0.8, 0.6];
    K.obox(c, [1, 0, 0], U, Nn, 0.16, 0.10, 0.010, 'dash', 0.05, [30, 32, 36]);
    const at2 = (a, b, d = 0) => [c[0] + a, c[1] + U[1] * b + Nn[1] * d, c[2] + U[2] * b + Nn[2] * d];
    for (const [a0, b0, a1, b1] of [[-0.16, -0.10, 0.16, -0.10], [-0.16, 0.10, 0.16, 0.10], [-0.16, -0.10, -0.16, 0.10], [0.16, -0.10, 0.16, 0.10]]) {
      K.rod(at2(a0, b0, 0.012), at2(a1, b1, 0.012), 0.007, 'dash', 0.1, HY.billet, 0.05, 6);
    }
    // Two ribs across it, which is where a sole finds purchase.
    for (const b of [-0.035, 0.035]) K.rod(at2(-0.14, b, 0.014), at2(0.14, b, 0.014), 0.004, 'dash', 0.1, HY.billet, 0.05, 5);
    for (const a of [-0.13, 0.13]) K.rod([a, 0.58, P.floor + 0.002], at2(a, -0.06, -0.004), 0.009, 'dash', 0.1, C.black, 0, 6);
  }
  // An extinguisher strapped by the door.
  // Starboard of the doorway and inboard of the wall: on the old `xCentre + 0.35` it stood in the door.
  const exX = Math.min(P.xCentre + (P.door ? P.door.halfW : 0.3) + 0.10, (P.wallAt ? P.wallAt(P.back + 0.25, P.floor + 0.15).stbd : P.xCentre + P.halfW) - 0.08);
  K.rod([exX, P.back + 0.25, P.floor], [exX, P.back + 0.25, P.floor + 0.30], 0.04, 'dash', 0.1, C.fireRed, 0.05, 10);
  // A grab rail across the passenger's side of the dash.
  const px = 2 * P.xCentre - cx;
  if (Math.abs(px - cx) > 0.3) {
    K.rod([px - 0.2, yB + 0.02, zB + 0.02], [px + 0.2, yB + 0.02, zB + 0.02], 0.013, 'dash', 0.1, C.chrome, 0.1, 6);
    for (const s of [-0.2, 0.2]) K.rod([px + s, yB + 0.02, zB + 0.02], [px + s, yB + 0.08, zB - 0.02], 0.011, 'dash', 0.1, C.chrome, 0.1, 5);
  }
  boatCowl(push, cx);
  boatFascia(K, push, P, cx, px, on);
  boatPlotter(K, L, cx, on, P);
  boatConsole(K, push, P, L, on);
  boatOverhead(K, P, on);
  boatCoDriver(K, push, P, px);
  boatLockers(K, P);
  hydroDetail(P, L, push);
}

// THE COWL: a stitched hide hood over the cluster, which is what makes a pod of gauges read as a
// helm rather than as a box of dials on a shelf. ⚠ IT STANDS ABOVE THE LINE FROM THE EYE TO THE TOP
// OF THE POD, so it shades the dials without hiding one, and it stays under the forward ray.
function boatCowl(push, cx) {
  const xs = Array.from({ length: 13 }, (_, i) => cx - 0.46 + (0.92 * i) / 12);
  const row = (y, z) => xs.map((x) => [x, y, z - 0.014 * ((x - cx) / 0.46) ** 2]);
  const lip = row(0.80, -0.050);
  loft(push, [lip, row(0.845, -0.043), row(0.885, -0.053), row(0.895, -0.075)], 'dash', 0.08, true, BOAT_MAT.hide, 2);
  seam(push, lip, () => [0, -0.55, 0.83], { stitch: true, w: 0.005 });
}

// THE FASCIA: the wall under the dash, which from the seat is most of the frame and was one flat
// panel. A stitched knee pad, the footwell, a lit switch strip under the pod, two eyeball vents, a
// speaker each side and the co-driver's glovebox. The fascia is the loft's own plane at `dashY`.
function boatFascia(K, push, P, cx, px, on) {
  const y = P.dashY - 0.002, n = () => [0, -1, 0];
  const F = K.panel([cx, y, -0.5], [1, 0, 0], [0, 0, 1]);
  // The knee pad: a raised hide panel with its cheeks, and stitching round the face.
  const yp = y - 0.03, x0 = cx - 0.30, x1 = cx + 0.30, z0 = -0.64, z1 = -0.42;
  quadSub(push, [x0, yp, z0], [x1, yp, z0], [x1, yp, z1], [x0, yp, z1], 4, 2, 'dash', 0.05, true, BOAT_MAT.hide);
  for (const [a, b] of [[[x0, y, z1], [x1, y, z1]], [[x0, y, z0], [x1, y, z0]]]) {
    const zz = a[2];
    faceEye(push, [[a[0], y, zz], [b[0], y, zz], [b[0], yp, zz], [a[0], yp, zz]], 'dash', zz > -0.5 ? 0.25 : -0.2, true, null, 0, BOAT_MAT.hide);
  }
  for (const xx of [x0, x1]) faceEye(push, [[xx, y, z0], [xx, y, z1], [xx, yp, z1], [xx, yp, z0]], 'dash', 0, true, null, 0, BOAT_MAT.hide);
  seam(push, [[x0 + 0.02, yp, z1 - 0.02], [x1 - 0.02, yp, z1 - 0.02], [x1 - 0.02, yp, z0 + 0.02], [x0 + 0.02, yp, z0 + 0.02], [x0 + 0.02, yp, z1 - 0.02]], n, { stitch: true, w: 0.003 });
  // The footwell under it.
  F.rect(-0.26, P.floor + 0.52, 0.26, -0.70 + 0.5, [8, 9, 11], 0, 0.001);
  // (The switch strip that stood here, behind the wheel where nobody could see it, moved to the
  // port panel in interior-hydro.js.)
  // How far either way the fascia runs at this height before it meets the wall, about the helm.
  const wl = P.wallAt ? P.wallAt(y, -0.40) : { port: cx - 0.9, stbd: cx + 0.9 };
  const reachS = wl.stbd - cx - 0.07, reachP = cx - wl.port - 0.07;
  // Eyeball vents either side of the pod.
  for (const vx of [-Math.min(0.70, reachP), Math.min(0.70, reachS)]) {
    F.annulus(vx, 0.12, 0.035, 0.045, C.chrome, 0.05, 0.003, 16);
    F.disc(vx, 0.12, 0.035, [14, 15, 18], 0, 0.002, 16);
    F.grille(vx - 0.022, 0.10, vx + 0.022, 0.14, 4);
  }
  // A speaker each side, low.
  for (const vx of [-Math.min(0.55, reachP - 0.02), Math.min(0.52, reachS - 0.04)]) { F.annulus(vx, -0.10, 0.05, 0.058, [30, 32, 36], 0, 0.002, 18); F.disc(vx, -0.10, 0.05, [16, 17, 20], 0, 0.001, 18); F.disc(vx, -0.10, 0.014, [40, 42, 48], 0, 0.003, 10); }
  // The co-driver's glovebox, and its latch — narrower where the wall comes in on her side.
  const gw = Math.max(0.12, Math.min(0.24, px - wl.port - 0.06));
  const G = K.panel([px, y, -0.52], [1, 0, 0], [0, 0, 1]);
  G.rect(-gw, -0.10, gw, 0.10, [34, 37, 43], 0, 0.003);
  G.stud(0, 0.07, 0.04, 0.008, 0.01, C.chrome, 0.1);
  seam(push, [[px - gw, y - 0.004, -0.42], [px + gw, y - 0.004, -0.42], [px + gw, y - 0.004, -0.62], [px - gw, y - 0.004, -0.62], [px - gw, y - 0.004, -0.42]], n, { w: 0.004 });
}

// THE PLOTTER: a chart on a stalk to the right of the pod. The chart is the one screen a race boat
// carries that a truck does not, and it is lit only while she is running.
function boatPlotter(K, L, cx, on, P) {
  // On its stalk to the right of the pod, and in from the wall where the screen's corner closes in.
  const y = 0.83, z = -0.15;
  const x = Math.min(cx + 0.66, (P && P.wallAt ? P.wallAt(y, z).stbd : Infinity) - 0.19);
  K.rod([x, y + 0.02, z - 0.08], [x, y + 0.05, -0.30], 0.014, 'dash', 0.1, C.black, 0, 6);
  const tu = [0, Math.sin(0.466), Math.cos(0.466)], tn = [0, Math.cos(0.466), -Math.sin(0.466)];
  K.obox([x, y + 0.012, z], [1, 0, 0], tu, tn, 0.15, 0.10, 0.012, 'dash', 0.1, C.black);
  const M = K.panel([x, y - 0.001, z], [1, 0, 0], [0, 0.45, 0.89]);
  const lit = on ? 0.75 : 0.06;
  M.rect(-0.135, -0.085, 0.135, 0.085, [12, 40, 66], lit, 0.002);
  // The coast the boat is inside of: two land masses and a channel mark, fixed to the chart.
  M.plate([[-0.135, 0.02], [-0.07, 0.05], [-0.03, 0.085], [-0.135, 0.085]], [84, 96, 58], lit * 0.8, 0.003);
  M.plate([[0.05, -0.085], [0.135, -0.085], [0.135, -0.01], [0.09, -0.03]], [84, 96, 58], lit * 0.8, 0.003);
  M.disc(0.06, 0.05, 0.006, C.red, lit, 0.004, 8);
  // Own ship at the middle, heading-up, with the course line ahead of her.
  M.plate([[0, 0.022], [0.012, -0.012], [-0.012, -0.012]], C.amber, on ? 1 : 0.1, 0.005);
  M.rect(-0.0015, 0.022, 0.0015, 0.075, C.amber, on ? 0.8 : 0.05, 0.004);
  M.digits(-0.125, -0.075, 0.022, String(Math.round(num(L.speed))).padStart(3, ' '), C.lcd, false);
  M.digits(0.045, -0.075, 0.022, String(Math.round(((num(L.hdg) % 360) + 360) % 360)).padStart(3, '0'), C.lcd, false);
  for (let i = 0; i < 4; i++) M.stud(-0.10 + i * 0.066, -0.104, 0.012, 0.006, 0.006, [34, 36, 42], 0);
}

// THE SIDE CONSOLE under the throttle: a carbon top with the nitro arming switch under a red flip
// cover, the trim rockers, a cup holder, and on its inboard face the key and the kill cord clipped
// to your leg — the one thing on a race boat that stops the engine when you leave the seat.
function boatConsole(K, push, P, L, on) {
  const { x0, x1, y0, y1, zt } = consoleSpan(P), zf = P.floor;
  quadSub(push, [x0, y0, zt], [x1, y0, zt], [x1, y1, zt], [x0, y1, zt], 2, 4, 'dash', 0.2, true, BOAT_MAT.carbon);
  quadSub(push, [x0, y0, zf], [x0, y1, zf], [x0, y1, zt], [x0, y0, zt], 4, 2, 'dash', -0.05, true, BOAT_MAT.dash);
  faceEye(push, [[x0, y1, zf], [x1, y1, zf], [x1, y1, zt], [x0, y1, zt]], 'dash', 0.05, true, null, 0, BOAT_MAT.dash);
  faceEye(push, [[x0, y0, zf], [x1, y0, zf], [x1, y0, zt], [x0, y0, zt]], 'dash', -0.1, true, null, 0, BOAT_MAT.dash);
  seam(push, [[x0, y0, zt], [x0, y1, zt]], () => [-0.7, 0, 0.7], { w: 0.006 });
  const T = K.panel([(x0 + x1) / 2, (y0 + y1) / 2, zt + 0.001], [1, 0, 0], [0, 1, 0]);
  // The nitro arm: a toggle, and over it a red cover that stands open while the bottle is armed.
  T.toggle(0, -0.18, !!L.nitroOn);
  // Open, the cover stands up off its forward hinge; `T.pt` is the switch's own spot on the top.
  if (L.nitroOn) { const h = T.pt(0, -0.18 + 0.032, 0); K.obox([h[0], h[1] + 0.004, h[2] + 0.03], [1, 0, 0], [0, Math.sin(0.13), Math.cos(0.13)], [0, -Math.cos(0.13), Math.sin(0.13)], 0.022, 0.03, 0.004, 'dash', 0.1, C.fireRed, 0.1); }
  else T.stud(0, -0.18, 0.022, 0.032, 0.022, C.fireRed, 0.1);
  T.lamp(0.07, -0.18, 0.007, 0.005, !!L.nitroOn, C.red);
  const trim = clamp(num(L.trim), -1, 1);
  T.rocker(-0.04, 0.14, trim > 0.05);
  T.rocker(0.01, 0.14, trim < -0.05);
  T.lamp(0.07, 0.14, 0.007, 0.005, on, C.green);
  T.annulus(0, -0.36, 0.036, 0.046, C.black, 0, 0.002, 18);
  T.disc(0, -0.36, 0.036, [8, 9, 11], 0, 0.001, 18);
  const S = K.panel([x0 - 0.001, 0.22, -0.64], [0, 1, 0], [0, 0, 1]);
  S.rect(-0.06, -0.05, 0.06, 0.05, [20, 22, 26], 0, 0.002);
  S.knob(-0.025, 0, 0.014, 0.012, C.chrome, 0.1);
  S.stud(0.025, 0, 0.012, 0.018, 0.02, C.fireRed, 0);
  // The lanyard: a coil from the clip to where your thigh is.
  const a = S.pt(0.025, 0, 0.02), b = [0.28, 0.02, -0.74];
  let prev = a;
  for (let i = 1; i <= 16; i++) {
    const t = i / 16, w = Math.sin(t * Math.PI) * 0.018, ang = t * Math.PI * 14;
    const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t + Math.cos(ang) * w, a[2] + (b[2] - a[2]) * t - 0.05 * Math.sin(t * Math.PI) + Math.sin(ang) * w];
    K.rod(prev, p, 0.0035, 'dash', 0, C.fireRed, 0.05, 4, false);
    prev = p;
  }
}

// OVERHEAD: the VHF in a pod off the lining, its handset on a clip, and a dome lamp.
function boatOverhead(K, P, on) {
  // ⚠ UNDER THE HEADLINING, WHEREVER THAT ENDS. In the Rooster's pilothouse the roof runs well forward
  // of the eye and the pod hangs over the dash; under a Gamecock's raked canopy the headlining stops
  // a hand's breadth forward of your head, and the same numbers hung the radio in mid-air in front
  // of the screen. It slides aft to stay under the roof, and in from the wall where the canopy's
  // tumblehome closes in over your shoulder.
  const z1 = P.roof - 0.035, z0 = P.roof - 0.105;
  const y1 = Math.min(0.62, (P.roofFront ?? 1) - 0.06), y0 = y1 - 0.52;
  if (y0 < P.back + 0.3) return;
  const wallX = P.wallAt ? Math.min(P.wallAt(y0, z0).stbd, P.wallAt(y1, z0).stbd) - 0.04 : 0.48;
  const x1 = Math.min(0.48, wallX), x0 = x1 - 0.42;
  K.box(x0, y0, z0, x1, y1, z1, 'hdr', -0.25);
  // ⚠ THE RADIO'S FACE IS THE SIDE OF THE POD YOU CAN SEE. Ahead of the eye that is its aft end. Slid
  // aft over your head, under a Gamecock's canopy, the aft end is behind you looking at the stern: the
  // face was drawn into the pod and its channel read mirrored. There the face is the pod's underside
  // at its forward end, read looking up and forward (docs/reference/cockpit-lettering.md rule 7).
  const V = y0 > 0
    ? K.panel([(x0 + x1) / 2, y0 - 0.001, (z0 + z1) / 2], [1, 0, 0], [0, 0, 1], 'hdr', -0.2)
    : K.panel([(x0 + x1) / 2, y1 - 0.06, z0 - 0.001], [1, 0, 0], [0, -1, 0], 'hdr', -0.2);
  V.rect(-0.22, -0.028, 0.22, 0.028, [16, 17, 20], 0, 0.001);
  V.digits(-0.05, -0.016, 0.03, '16', on ? C.lcd : C.lampOff);
  V.knob(-0.16, 0, 0.012, 0.014, C.chrome, 0.1);
  V.knob(-0.11, 0, 0.010, 0.012, C.chrome, 0.1);
  for (let i = 0; i < 4; i++) V.stud(0.06 + i * 0.03, 0, 0.009, 0.007, 0.008, [34, 36, 42], 0);
  // The handset, on its clip, and its curly cord back up into the pod.
  const h = [x1 - 0.06, y0 - 0.02, z0 - 0.06];
  K.obox(h, [1, 0, 0], [0, 0, 1], [0, -1, 0], 0.024, 0.045, 0.016, 'dash', 0, C.black);
  let prev = [x1 - 0.06, y0 + 0.01, z0];
  for (let i = 1; i <= 10; i++) {
    const t = i / 10, ang = t * Math.PI * 9;
    const p = [x1 - 0.06 + Math.cos(ang) * 0.01, y0 + 0.01 - 0.03 * t, z0 - 0.015 - 0.02 * t + Math.sin(ang) * 0.01];
    K.rod(prev, p, 0.003, 'dash', 0, C.black, 0, 4, false);
    prev = p;
  }
  const D = K.panel([(x0 + x1) / 2, (y0 + y1) / 2 + 0.1, z0 - 0.001], [1, 0, 0], [0, 1, 0], 'hdr', -0.3);
  D.disc(0, 0, 0.03, on ? [255, 236, 200] : [60, 60, 56], on ? 0.5 : 0, 0.002, 12);
  D.rocker(0.08, 0, false);
}

// THE CO-DRIVER: a bolster seat on a pedestal, LOW-BACKED on purpose — a full backrest and headrest
// here stands in the line from the eye to the port window, which the gate casts and refuses.
function boatCoDriver(K, push, P, px) {
  const x0 = px - P.seatHalf, x1 = px + P.seatHalf, y0 = P.seatY[0], y1 = P.seatY[1], sz = P.seatZ;
  K.rod([px, (y0 + y1) / 2, P.floor], [px, (y0 + y1) / 2, sz - 0.12], 0.05, 'dash', 0.05, C.steel, 0.05, 8);
  K.box(px - 0.18, y0 + 0.05, sz - 0.14, px + 0.18, y1 - 0.05, sz - 0.10, 'dash', 0.05, C.steel);
  quadSub(push, [x0, y0, sz], [x1, y0, sz], [x1, y1, sz], [x0, y1, sz], 3, 3, 'seat', 0.1, true, BOAT_MAT.hide);
  K.box(x0, y0, sz - 0.10, x1, y1, sz - 0.001, 'seat', -0.05);
  K.box(x0, y0, sz, x0 + 0.05, y1, sz + 0.05, 'seat', 0.08);
  K.box(x1 - 0.05, y0, sz, x1, y1, sz + 0.05, 'seat', 0.08);
  K.box(x0, y0 - 0.10, sz, x1, y0 - 0.02, -0.12, 'seat', -0.02);
  seam(push, [[x0 + 0.05, y1, sz + 0.001], [x1 - 0.05, y1, sz + 0.001]], () => [0, 0.3, 1], { stitch: true });
  // A grab handle across the top of the back, for the ride over a sea. ⚠ LOW, for the same reason the
  // back is: standing 7 cm proud it was a chrome bar 5 cm under the eye line, and in a canopy, where
  // the port glass is closer and lower, the gate's rays through that window hit it.
  const gTop = -0.085;
  K.rod([x0 + 0.04, y0 - 0.06, -0.12], [x0 + 0.04, y0 - 0.06, gTop], 0.01, 'dash', 0.1, C.chrome, 0.1, 5);
  K.rod([x1 - 0.04, y0 - 0.06, -0.12], [x1 - 0.04, y0 - 0.06, gTop], 0.01, 'dash', 0.1, C.chrome, 0.1, 5);
  K.rod([x0 + 0.04, y0 - 0.06, gTop], [x1 - 0.04, y0 - 0.06, gTop], 0.012, 'dash', 0.1, C.chrome, 0.1, 6);
}

// BEHIND YOU: the lifejacket locker and the flare canister either side of the door.
// ⚠ BETWEEN THE WALL AND THE DOOR, BOTH ASKED. The locker was authored at -1.50..-0.86 m, which in the
// Rooster runs 0.28 m into her own doorway and in a narrower room stands through the side. Its outboard
// edge is the wall at its own height and its inboard edge is the door jamb; too narrow a gap and there
// is no locker, which is the honest answer for a canopy with no room either side of the hatch.
function boatLockers(K, P) {
  const b = P.back + 0.005;
  const dHalf = P.door ? P.door.halfW : 0.3;
  const wall = P.wallAt ? P.wallAt(b + 0.2, -0.18) : { port: P.xCentre - P.halfW, stbd: P.xCentre + P.halfW };
  const lx0 = Math.max(-1.50, wall.port + 0.05), lx1 = Math.min(-0.86, P.xCentre - dHalf - 0.03);
  // Standing on the sole, wherever that is: a canopy's is 0.23 m higher under the eye than the Rooster's.
  const lz0 = Math.max(-0.95, P.floor + 0.002);
  if (lx1 - lx0 >= 0.26) {
    K.box(lx0, b, lz0, lx1, b + 0.26, -0.18, 'post', -0.1);
    for (let i = 0; i < 3; i++) {
      const z = lz0 + 0.05 + i * (0.72 + (-0.95 - lz0)) / 3;
      if (z + 0.20 > -0.18) break;
      K.box(lx0 + 0.04, b + 0.26, z, lx1 - 0.04, b + 0.34, z + 0.20, 'dash', 0.1, [226, 112, 34], 0.05);
      K.box(lx0 + 0.03, b + 0.34, z + 0.08, lx1 - 0.03, b + 0.345, z + 0.11, 'dash', 0, C.black);
    }
  }
  // The flare canister, starboard of the door and in from the wall.
  const fx = Math.max(P.xCentre + dHalf + 0.10, Math.min(0.88, wall.stbd - 0.09));
  if (fx < wall.stbd - 0.06) {
    K.box(fx - 0.08, b, -0.36, fx + 0.08, b + 0.04, -0.34, 'dash', 0, C.steel);
    K.rod([fx, b + 0.10, -0.62], [fx, b + 0.10, -0.30], 0.05, 'dash', 0.1, [214, 62, 28], 0.05, 8);
  }
}

// ── THE ECHELON'S WHEELHOUSE ─────────────────────────────────────────────────
//
// A yacht's bridge: a raked console across the front carrying the radar and the chartplotter
// either side of the engine and rudder gauges, a stainless wheel on a pedestal, twin throttle
// levers, repeaters hung under the header, mullions between the big screens, a VHF with its
// handset, a chart table to port with a chart and dividers on it, a clock and barometer on the
// after bulkhead, a bench to starboard and a teak sole. You sit in a pedestal chair on the
// centreline, because that is where the helm of a yacht this size is.
//
// ⚠ THE RADAR SWEEP IS `live.t`, NEVER A CLOCK READ HERE — this file is pure, so the time arrives
// as an argument like every other live value.
export function bridgeFit(P, live, push) {
  const K = makeKit(push);
  const L = live || {};
  const xL = P.xCentre - P.halfW, xR = P.xCentre + P.halfW;
  const hdg = num(L.hdg), kn = Math.max(0, num(L.speed)), rud = clamp(num(L.rudder), -1, 1);
  const thr = clamp(num(L.throttle), 0, 1), t = num(L.t);

  // ── THE SOLE ───────────────────────────────────────────────────────────────
  const planks = 16;
  for (let i = 0; i < planks; i++) {
    const x0 = xL + (xR - xL) * (i / planks), x1 = xL + (xR - xL) * ((i + 1) / planks);
    K.box(x0 + 0.004, P.back, P.floor, x1 - 0.004, P.front, P.floor + 0.006, 'floor', 0.1, i % 2 ? [120, 84, 52] : [134, 94, 58]);
  }
  // ── THE CONSOLE ────────────────────────────────────────────────────────────
  const Cn = K.panel([0, P.dashY - 0.09, P.dashZ - 0.10], [1, 0, 0], [0, 0.55, 0.83]);
  const HW = 0.95, HH = 0.17;
  Cn.rect(-HW, -HH, HW, HH, [26, 30, 34], 0, 0);
  // A teak capping rail along the console's leading edge.
  K.rod(Cn.pt(-HW, -HH, 0.02), Cn.pt(HW, -HH, 0.02), 0.022, 'dash', 0.1, C.wood, 0, 6);
  // The body below the lectern, down to the sole.
  K.box(-HW, P.dashY - 0.20, P.floor, HW, P.dashY, Cn.pt(0, -HH, 0)[2], 'dash', -0.1);
  // Radar, to port: a round scope with range rings, a sweep and the returns it has painted.
  const rx = -0.60;
  Cn.rect(rx - 0.20, -0.15, rx + 0.20, 0.15, [16, 18, 20], 0, 0.002);
  Cn.disc(rx, 0, 0.13, [6, 20, 12], 0.35, 0.004, 24);
  for (const k of [0.045, 0.09]) Cn.annulus(rx, 0, k, k + 0.002, [40, 140, 80], 0.6, 0.006, 20);
  const sw = (t * 1.2) % (Math.PI * 2);
  Cn.spoke(rx, 0, Math.PI / 2 - sw, 0, 0.13, 0.002, [120, 255, 160], 0.95, 0.008);
  for (let i = 0; i < 9; i++) {
    const a = (i * 2.399) % (Math.PI * 2), r = 0.03 + ((i * 37) % 10) / 10 * 0.09;
    Cn.disc(rx + Math.cos(a) * r, Math.sin(a) * r, 0.004, [150, 255, 170], 0.9, 0.007, 6);
  }
  // Chartplotter, to starboard: a coastline, a track and the ship.
  const cxp = 0.60;
  Cn.rect(cxp - 0.22, -0.15, cxp + 0.22, 0.15, [16, 18, 20], 0, 0.002);
  Cn.rect(cxp - 0.20, -0.13, cxp + 0.20, 0.13, [22, 52, 88], 0.4, 0.004);
  Cn.plate([[cxp - 0.20, 0.13], [cxp - 0.20, -0.02], [cxp - 0.12, 0.01], [cxp - 0.07, 0.07], [cxp - 0.02, 0.13]], [196, 176, 120], 0.4, 0.006);
  Cn.plate([[cxp + 0.08, -0.13], [cxp + 0.20, -0.13], [cxp + 0.20, 0.02], [cxp + 0.13, -0.05]], [196, 176, 120], 0.4, 0.006);
  Cn.spoke(cxp, 0, Math.PI / 2, 0, 0.09, 0.0015, [255, 90, 200], 0.9, 0.007);
  Cn.plate([[cxp, 0.012], [cxp + 0.008, -0.01], [cxp - 0.008, -0.01]], C.lampOn, 0.95, 0.008);
  // In the middle: the rudder indicator over two engine tachos and a heading readout.
  Cn.dial(0, 0.07, 0.07, 0.5 + rud * 0.5, { a0: Math.PI * 0.75, sweep: Math.PI * 0.5, ticks: 6, major: 3, arcs: [[0, 0.5, C.red], [0.5, 1, C.green]], name: 'RUDDER' });
  Cn.dial(-0.22, -0.05, 0.055, clamp(0.15 + thr * 0.75, 0, 1), { ticks: 8, major: 2, red: 0.88, name: 'PORT' });
  Cn.dial(0.22, -0.05, 0.055, clamp(0.15 + thr * 0.74, 0, 1), { ticks: 8, major: 2, red: 0.88, name: 'STBD' });
  Cn.digits(-0.06, -0.12, 0.04, String(Math.round(((hdg % 360) + 360) % 360)).padStart(3, '0'), C.amber);
  // Switch banks either side of the wheel: navigation lights, horn, wipers, pumps, searchlight.
  const swL = ['NAV', 'ANC', 'DCK', 'HRN', 'WPR', 'WSH'], swR = ['BLG', 'PMP', 'FW', 'SRH', 'SPT', 'FAN'];
  for (let i = 0; i < 6; i++) { Cn.rocker(-0.36 + i * 0.03, -0.14, i % 3 !== 2, C.black, swL[i]); Cn.rocker(0.21 + i * 0.03, -0.14, i % 2 === 0, C.black, swR[i]); }
  // The compass binnacle on the capping, dead ahead of the helm but below the sight line.
  const cb = Cn.pt(0, HH, 0.03);
  K.box(cb[0] - 0.06, cb[1], cb[2] - 0.02, cb[0] + 0.06, cb[1] + 0.10, cb[2] + 0.07, 'dash', 0.1, C.brass, 0.05);
  const Bp = K.panel([cb[0], cb[1] - 0.001, cb[2] + 0.025], [1, 0, 0], [0, 0, 1]);
  Bp.compass(0, 0, 0.038, hdg);

  // ── THE WHEEL ──────────────────────────────────────────────────────────────
  const hub = [0, P.dashY - 0.34, -0.48];
  K.rod([0, P.dashY - 0.20, -0.62], hub, 0.04, 'dash', 0, C.chrome, 0.1, 8);
  roundWheel(K, hub, 1.15, 0.24, rud, 180, C.chrome, [0, 60, 120, 180, 240, 300], C.wood);
  // The six turned handles round the rim — a yacht's wheel, not a car's.
  const up = [0, Math.sin(1.15), Math.cos(1.15)];
  for (let i = 0; i < 6; i++) {
    const a = rud * Math.PI + i * Math.PI / 3;
    const dir = [Math.cos(a), up[1] * Math.sin(a), up[2] * Math.sin(a)];
    K.rod(add3(hub, mul3(dir, 0.25)), add3(hub, mul3(dir, 0.32)), 0.014, 'dash', 0.1, C.wood, 0, 6);
  }
  // ── THE THROTTLES ──────────────────────────────────────────────────────────
  const tb = [0.42, P.dashY - 0.22, -0.52];
  K.box(tb[0] - 0.08, tb[1] - 0.08, tb[2] - 0.05, tb[0] + 0.08, tb[1] + 0.08, tb[2], 'dash', 0.1, [30, 32, 36]);
  for (const s of [-1, 1]) {
    const a = -0.6 + thr * 1.2;
    const top = add3(tb, [s * 0.035, Math.sin(a) * 0.16, Math.cos(a) * 0.16]);
    K.rod(add3(tb, [s * 0.035, 0, 0]), top, 0.007, 'dash', 0, C.chrome, 0.1, 5);
    K.rod(top, add3(top, [s * 0.03, 0, 0]), 0.018, 'dash', 0.1, s < 0 ? C.red : C.green, 0.2, 8);
  }
  // ── THE VHF ────────────────────────────────────────────────────────────────
  const V = K.panel([-0.95, P.dashY - 0.20 - 0.004, -0.75], [1, 0, 0], [0, 0, 1]);
  V.rect(-0.14, -0.05, 0.14, 0.05, [16, 18, 22], 0, 0.002);
  V.digits(-0.05, -0.02, 0.035, '16', C.amber);
  V.knob(0.09, 0, 0.016, 0.016, C.black, 0);

  // ── THE SCREENS' FRAME: mullions, and the repeaters hung under the header ────
  for (const mx of [-1.25, -0.62, 0.62, 1.25]) {
    K.box(mx - 0.035, P.front - 0.08, P.dashZ, mx + 0.035, P.front, P.headerZ, 'pil', 0.2);
  }
  const reps = [String(Math.round(((hdg % 360) + 360) % 360)).padStart(3, '0'), String(Math.round(kn)).padStart(3, ' '), '042', '018'];
  reps.forEach((val, i) => {
    const x = -0.75 + i * 0.5;
    const Rp = K.panel([x, P.front - 0.22, P.headerZ - 0.08], [1, 0, 0], [0, 0.6, 0.8], 'hdr', -0.2);
    K.obox(Rp.pt(0, 0, -0.03), Rp.r, Rp.u, Rp.n, 0.13, 0.07, 0.03, 'dash', -0.1, [20, 22, 26]);
    Rp.digits(-0.07, -0.03, 0.055, val, i === 0 ? C.amber : C.lcd);
    K.rod([x, P.front - 0.18, P.headerZ - 0.02], [x, P.front - 0.14, P.roof - 0.012], 0.01, 'dash', 0, C.chrome, 0.1, 5);
  });

  // ── AFT: THE CHART TABLE, THE BENCH, THE CLOCK AND THE GLASS ───────────────
  const tx0 = xL + 0.05, tx1 = xL + 0.75, ty0 = P.back + 0.3, ty1 = P.back + 1.2, tz = -0.55;
  K.box(tx0, ty0, P.floor, tx1, ty1, tz, 'dash', -0.05, C.wood);
  K.box(tx0 + 0.05, ty0 + 0.05, tz, tx1 - 0.05, ty1 - 0.05, tz + 0.004, 'dash', 0.4, C.paper, 0.1);
  K.box(tx0 + 0.15, ty0 + 0.3, tz + 0.004, tx0 + 0.35, ty0 + 0.5, tz + 0.006, 'dash', 0.4, [120, 170, 200], 0.1);
  K.rod([tx0 + 0.3, ty0 + 0.6, tz + 0.01], [tx0 + 0.45, ty0 + 0.45, tz + 0.01], 0.004, 'dash', 0, C.chrome, 0.1, 4);
  K.rod([tx0 + 0.3, ty0 + 0.6, tz + 0.01], [tx0 + 0.42, ty0 + 0.7, tz + 0.01], 0.004, 'dash', 0, C.chrome, 0.1, 4);
  K.box(xR - 0.55, P.back + 0.05, P.floor, xR - 0.05, P.back + 1.6, -0.95, 'seat', 0.05, [58, 70, 96]);
  K.box(xR - 0.20, P.back + 0.05, -0.95, xR - 0.05, P.back + 1.6, -0.40, 'seat', -0.05, [58, 70, 96]);
  // The aft bulkhead, read turned round: across is −x (docs/reference/cockpit-lettering.md rule 7).
  // With +x the names read mirrored and the clock ran backwards.
  const Ab = K.panel([-0.35, P.back + 0.001, 0.25], [-1, 0, 0], [0, 0, 1], 'post', -0.1);
  Ab.dial(0, 0, 0.09, 0.35, { a0: Math.PI / 2, sweep: Math.PI * 2, ticks: 12, major: 3, bezel: C.brass, face: C.white, tick: C.black, needle: C.black, frac2: 0.8, name: 'CLOCK' });
  Ab.dial(-0.30, 0, 0.09, 0.58, { ticks: 10, major: 5, bezel: C.brass, face: C.white, tick: C.black, needle: C.black, name: 'BARO' });
  // The chair: a pedestal, a footrest ring round it, and armrests.
  const sy = (P.seatY[0] + P.seatY[1]) / 2;
  K.rod([0, sy, P.floor], [0, sy, P.seatZ - 0.16], 0.05, 'dash', 0, C.chrome, 0.1, 8);
  K.torus([0, sy, P.floor + 0.35], [1, 0, 0], [0, 1, 0], 0.22, 0.012, 12, 'dash', 0.1, C.chrome, 0.1);
  for (const s of [-1, 1]) K.box(s * (P.seatHalf + 0.06) - 0.04, P.seatY[0], P.seatZ + 0.12, s * (P.seatHalf + 0.06) + 0.04, P.seatY[1] - 0.05, P.seatZ + 0.17, 'seat', 0.05, C.wood);
  richSeat(K, 0, P, [196, 186, 160], false);
}

// ── THE TRINKETS, IN THE ROUND ───────────────────────────────────────────────
//
// What a player bought for the cab (client/shared/cab-trinkets.js): something off the header,
// something on the dash, and the wheel. The painted dash drew all three; with the cab as geometry
// they have to be objects in it or the purchase simply disappears — which is the one outcome worse
// than drawing them badly.
//
// ⚠ THE SWING IS THE SAME INTEGRATOR, not a second one. windshield.js steps `stepTrinket` once a
// frame (cabToyMotion) and hands the deflection in as `th`; this only turns it into where the
// pendant is. A second physics here would be a pair of dice swinging to a different bend.
const hexRgb = (h, d = [128, 128, 128]) => {
  if (Array.isArray(h)) return h;
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h || ''));
  return m ? [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)] : d;
};

// Hang: a cord from `anchor` and the pendant on the end of it, deflected by th.x (across) and th.y
// (fore and aft). Metres; the cord is about the length the painted one read as.
export function hangingToy(K, anchor, toy) {
  if (!toy) return;
  const P = toy.pal || {};
  const body = hexRgb(P.body), pip = hexRgb(P.pip), cord = hexRgb(P.cord), edge = hexRgb(P.edge);
  const th = toy.th || { x: 0, y: 0 };
  const L = 0.12 + (toy.len || 0.08) * 1.2;
  // The pendant hangs along the cord, so its own frame is the cord's.
  const d0 = [Math.sin(th.x), Math.sin(th.y), -Math.cos(th.x) * Math.cos(th.y)];
  const dl = Math.hypot(d0[0], d0[1], d0[2]) || 1;
  const down = [d0[0] / dl, d0[1] / dl, d0[2] / dl];
  const end = [anchor[0] + down[0] * L, anchor[1] + down[1] * L, anchor[2] + down[2] * L];
  K.rod(anchor, end, 0.0018, 'dash', 0, cord, 0.1, 3, false);
  // ⚠ ORTHONORMAL, because every face states its normal and the gate holds it to unit length.
  const U = [-down[0], -down[1], -down[2]];
  const r0 = [Math.cos(th.x), 0, Math.sin(th.x)], ru = r0[0] * U[0] + r0[1] * U[1] + r0[2] * U[2];
  const r1 = [r0[0] - ru * U[0], r0[1] - ru * U[1], r0[2] - ru * U[2]], rl = Math.hypot(r1[0], r1[1], r1[2]) || 1;
  const R = [r1[0] / rl, r1[1] / rl, r1[2] / rl];
  const N = [R[1] * U[2] - R[2] * U[1], R[2] * U[0] - R[0] * U[2], R[0] * U[1] - R[1] * U[0]];
  const at = (a, b, c = 0) => [end[0] + R[0] * a + U[0] * b + N[0] * c, end[1] + R[1] * a + U[1] * b + N[1] * c, end[2] + R[2] * a + U[2] * b + N[2] * c];
  const cube = (a, b, s, rgb) => K.obox(at(a, b), R, U, N, s, s, s, 'dash', 0.1, rgb, 0.05);
  switch (toy.kind) {
    case 'dice':
      cube(-0.022, -0.02, 0.018, body); cube(0.022, -0.035, 0.018, body);
      for (const [a, b] of [[-0.022, -0.02], [0.022, -0.035]]) {
        for (const [pa, pb] of [[-0.008, 0.008], [0, 0], [0.008, -0.008]]) {
          K.obox(at(a + pa, b + pb, -0.0185), R, U, N, 0.003, 0.003, 0.001, 'dash', 0.3, pip, 0.2);
        }
      }
      K.rod(at(-0.022, 0.0), at(0, 0.02), 0.0015, 'dash', 0, cord, 0.1, 3, false);
      K.rod(at(0.022, -0.015), at(0, 0.02), 0.0015, 'dash', 0, cord, 0.1, 3, false);
      break;
    case 'tree':
      K.face([at(0, 0.01), at(0.035, -0.05), at(0.012, -0.05), at(0.028, -0.085), at(-0.028, -0.085), at(-0.012, -0.05), at(-0.035, -0.05)], N, 'dash', 0.2, body, 0.1);
      K.obox(at(0, -0.092), R, U, N, 0.005, 0.008, 0.002, 'dash', 0.1, edge);
      break;
    case 'beads':
      for (let i = 0; i < 7; i++) K.obox(at(0, 0.02 - i * 0.014), R, U, N, 0.006, 0.006, 0.006, 'dash', 0.1, i % 2 ? body : pip, 0.05);
      for (const s of [-1, 0, 1]) K.rod(at(0, -0.08), at(s * 0.008, -0.11), 0.0015, 'dash', 0, cord, 0, 3, false);
      break;
    case 'bones':
      for (let i = 0; i < 3; i++) K.rod(at((i - 1) * 0.015, -0.01), at((i - 1) * 0.018, -0.06 - (i === 1 ? 0.012 : 0)), 0.005, 'dash', 0.1, body, 0.05, 5);
      break;
    case 'boots':
      for (const s of [-1, 1]) {
        K.obox(at(s * 0.016, -0.03), R, U, N, 0.009, 0.02, 0.009, 'dash', 0.1, body);
        K.obox(at(s * 0.016 - 0.006, -0.052, -0.006), R, U, N, 0.011, 0.006, 0.016, 'dash', 0.1, edge);
      }
      break;
    case 'medal':
    default: {
      const n = 12, pts = [];
      for (let i = 0; i < n; i++) { const t = (i / n) * Math.PI * 2; pts.push(at(Math.cos(t) * 0.02, -0.03 + Math.sin(t) * 0.02, -0.001)); }
      K.face(pts, N, 'dash', 0.3, body, 0.15);
      K.obox(at(0, -0.03, -0.003), R, U, N, 0.004, 0.012, 0.001, 'dash', 0.3, pip, 0.2);
    }
  }
}

// Dash: a figure on a spring, standing on `base` (the dash top), its head leaning by th.
export function bobbleToy(K, base, toy) {
  if (!toy) return;
  const P = toy.pal || {};
  const body = hexRgb(P.body), pip = hexRgb(P.pip), cord = hexRgb(P.cord), edge = hexRgb(P.edge);
  const th = toy.th || { x: 0, y: 0 };
  const h = 0.06 + (toy.h || 0.1) * 0.5;
  const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
  const up = (b, z) => [b[0], b[1], b[2] + z];
  const neck = up(base, h * 0.62);
  const lean = [Math.sin(th.x) * 0.9, Math.sin(th.y) * 0.9, 1];
  const ll = Math.hypot(...lean);
  const head = [neck[0] + lean[0] / ll * h * 0.28, neck[1] + lean[1] / ll * h * 0.28, neck[2] + lean[2] / ll * h * 0.28];
  K.rod(neck, head, 0.0025, 'dash', 0, cord, 0.2, 4, false);   // the spring
  switch (toy.kind) {
    case 'reaper':
      K.obox(up(base, h * 0.30), X, Z, Y, h * 0.16, h * 0.30, h * 0.12, 'dash', 0.05, body);
      K.obox(head, X, Z, Y, h * 0.13, h * 0.14, h * 0.12, 'dash', 0.05, body);
      K.obox([head[0], head[1] - h * 0.11, head[2]], X, Z, Y, h * 0.06, h * 0.07, h * 0.01, 'dash', 0.1, pip, 0.1);
      K.rod(up(base, h * 0.05), [base[0] + h * 0.22, base[1], base[2] + h * 1.1], 0.0025, 'dash', 0.1, [110, 90, 60], 0, 4);
      K.rod([base[0] + h * 0.22, base[1], base[2] + h * 1.1], [base[0] - h * 0.05, base[1] - h * 0.05, base[2] + h * 1.0], 0.003, 'dash', 0.3, cord, 0.2, 4);
      break;
    case 'dog':
      K.obox(up(base, h * 0.28), X, Z, Y, h * 0.18, h * 0.28, h * 0.26, 'dash', 0.1, body);
      K.obox(head, X, Z, Y, h * 0.16, h * 0.14, h * 0.16, 'dash', 0.1, body);
      K.obox([head[0], head[1] - h * 0.15, head[2] - h * 0.03], X, Z, Y, h * 0.07, h * 0.05, h * 0.05, 'dash', 0.1, pip);
      for (const s of [-1, 1]) K.obox([head[0] + s * h * 0.16, head[1], head[2] + h * 0.05], X, Z, Y, h * 0.03, h * 0.1, h * 0.05, 'dash', 0.1, edge);
      break;
    case 'hula':
      K.obox(up(base, h * 0.14), X, Z, Y, h * 0.20, h * 0.14, h * 0.20, 'dash', 0.1, body);
      K.obox(up(base, h * 0.45), X, Z, Y, h * 0.09, h * 0.18, h * 0.08, 'dash', 0.1, pip);
      K.obox(head, X, Z, Y, h * 0.09, h * 0.1, h * 0.09, 'dash', 0.1, pip);
      for (const s of [-1, 1]) K.rod(up(base, h * 0.58), [base[0] + s * h * 0.22, base[1], base[2] + h * 0.95], 0.003, 'dash', 0.1, pip, 0, 4);
      break;
    case 'skullbob':
    default:
      K.obox(up(base, h * 0.08), X, Z, Y, h * 0.14, h * 0.08, h * 0.14, 'dash', 0.1, cord);
      K.rod(up(base, h * 0.16), neck, 0.004, 'dash', 0.3, cord, 0.1, 5);
      K.obox(head, X, Z, Y, h * 0.17, h * 0.18, h * 0.17, 'dash', 0.15, body, 0.05);
      for (const s of [-1, 1]) K.obox([head[0] + s * h * 0.07, head[1] - h * 0.172, head[2] + h * 0.03], X, Z, Y, h * 0.045, h * 0.045, h * 0.004, 'dash', 0, pip);
  }
}

// ── THE LIFT ─────────────────────────────────────────────────────────────────
//
// These are hover rigs: four lifter pods carry the tractor, and every cab tells you so. A plan of
// the rig with a glow at each pod scaled by what it is putting out, and a bar for ride height. It
// reads `live.pods` ([fl, fr, rl, rr], 0..1) and `live.ride` when the sim sends them; until then it
// is derived from what the cab already knows — the pods come up with the engine, lean into a turn
// and nose down under braking — so a seat with nothing to say shows a rig parked on its skids.
export const HOVER = [90, 220, 255];
export function liftOf(S) {
  const L = S.L;
  if (Array.isArray(L.pods) && L.pods.length === 4 && L.pods.every(Number.isFinite)) {
    return { pods: L.pods.map((v) => clamp(v, 0, 1)), ride: clamp(num(L.ride, 0.7), 0, 1) };
  }
  if (!S.on) return { pods: [0.05, 0.05, 0.05, 0.05], ride: 0 };
  const base = 0.55 + 0.3 * S.rpm, st = clamp(num(L.steer), -1, 1) * 0.12, br = S.braking ? 0.10 : 0;
  const pods = [base - st + br, base + st + br, base - st - br, base + st - br].map((v) => clamp(v, 0, 1));
  return { pods, ride: clamp(num(L.ride, 0.72), 0, 1) };
}
// A plan of the rig in a `w`-wide box centred on (ca, cb) of panel `Pn`.
export function hoverDisplay(Pn, ca, cb, w, S, frame = true) {
  const { pods, ride } = liftOf(S);
  const h = w * 1.25;
  if (frame) Pn.rect(ca - w / 2, cb - h / 2, ca + w / 2, cb + h / 2, [8, 14, 20], 0.2, 0.002);
  const bw = w * 0.22, bh = h * 0.34, bx = ca - w * 0.1;
  Pn.rect(bx - bw, cb - bh, bx + bw, cb + bh, [40, 52, 64], 0.3, 0.004);
  Pn.rect(bx - bw * 0.8, cb + bh * 0.55, bx + bw * 0.8, cb + bh * 0.9, [70, 90, 110], 0.4, 0.005);
  const pr = w * 0.085;
  [[-1, 1], [1, 1], [-1, -1], [1, -1]].forEach(([sx, sy], i) => {
    const px = bx + sx * (bw + pr * 0.9), py = cb + sy * bh * 0.72, p = pods[i];
    Pn.annulus(px, py, pr * 0.9, pr * 1.25, HOVER, 0.15 + 0.5 * p, 0.005, 10);
    Pn.disc(px, py, pr * (0.4 + 0.5 * p), p > 0.1 ? HOVER : C.lampOff, 0.3 + 0.7 * p, 0.006, 10);
  });
  // Ride height, and the field line under the rig that is what it rides on.
  Pn.bar(ca + w * 0.36, cb - h * 0.4, cb + h * 0.4, w * 0.05, ride, ride < 0.25 ? C.amber : HOVER);
  Pn.rect(bx - bw * 1.4, cb - h * 0.46, bx + bw * 1.4, cb - h * 0.44, HOVER, 0.25 + 0.5 * ride, 0.004);
}

// ── THE TRUCK'S ROOM ─────────────────────────────────────────────────────────
//
// Fifty years on from the box: the screen wraps round in plan (`screenY`, a parabola that brings
// the corners 14 cm back), the pillars are slim and raked, the header sits high, the side glass
// comes down to your elbow, and the dash is a LOFTED PROFILE — a vertical fascia, a rounded nose,
// a top that falls away to the glass — stitched along the width, so it is one moulding and not a
// slab. The roof meets the doors in a quarter-round cove.
//
// ── ⚠ MATERIALS, AND WHERE THEY MEET ─────────────────────────────────────────
//
// The cabin has no textures, so a material is three numbers riding on each face (`mat`): a value
// that SCALES the colourway key (so a retrim still reaches it), a sheen, and a GRAIN — the room's
// big panels are subdivided and windshield.js nudges each small face's value off a hash of where it
// is, which is what reads as a textured hard plastic rather than a flat fill. Where two parts meet
// there is a SEAM: a dark shut line a few millimetres wide standing just proud of the surface, and
// on the soft parts a row of stitches beside it. Those lines are most of what tells a dash from the
// door it butts against when the two are close in colour.
//
// ⚠ ONLY WHEN THE FIT-OUT IS BUILT. At cockpit3d 0 the painted dash owns the forward view and the
// plain box shell stays under it (see `roomRich` in interior-shell.js).
//
// ⚠ EVERY ROOM FACE STATES A NORMAL TOWARD THE EYE. The room is seen from inside and is close to
// convex about the eye, so "faces the origin" is the right normal for it — the fittings, which are
// not, go through the kit and state their own.
export const screenY = (P, x) => { const u = (x - P.xCentre) / P.halfW; return P.front - (P.screenWrap ?? 0) * u * u; };

// The materials. `lv` scales the colourway key, `spec`/`pow` are the sheen, `grain` the stipple.
export const TRUCK_MAT = {
  hard:   { lv: 1.05, spec: 0.42, pow: 22, grain: 0.13 },   // textured hard plastic: the dash, the fascia
  soft:   { lv: 0.82, spec: 0.20, pow: 8,  grain: 0.07 },   // soft-touch: the dash top, the armrests
  card:   { lv: 1.22, spec: 0.28, pow: 14, grain: 0.11 },   // the door cards' upper panel
  lower:  { lv: 0.80, spec: 0.30, pow: 16, grain: 0.14 },   // kick panels, scuffed
  fabric: { lv: 1.85, spec: 0,    pow: 1,  grain: 0.06 },   // the headliner and the pillar wraps
  floor:  { lv: 0.55, spec: 0.05, pow: 4,  grain: 0.16 },
  metal:  { lv: 1.10, spec: 0.55, pow: 26, grain: 0.05 },   // the Barrow: bare painted steel everywhere
};
const SEAM = [8, 9, 11];

function faceEye(push, pts, tone, k, fwd, rgb, emis, mat) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const L = Math.hypot(nx, ny, nz);
  if (!(L > 1e-12)) return;
  let n = [nx / L, ny / L, nz / L];
  let cx = 0, cy = 0, cz = 0;
  for (const p of pts) { cx += p[0]; cy += p[1]; cz += p[2]; }
  if (n[0] * cx + n[1] * cy + n[2] * cz > 0) n = [-n[0], -n[1], -n[2]];
  push([{ p: pts, n }], tone, k, fwd, rgb, emis, mat);
}

const bil = (a, b, c, d, u, v) => [0, 1, 2].map((i) => (a[i] * (1 - u) + b[i] * u) * (1 - v) + (d[i] * (1 - u) + c[i] * u) * v);
// A quad split `su` × `sv` ways, so a grained material has small faces to stipple.
function quadSub(push, a, b, c, d, su, sv, tone, k, fwd, mat) {
  for (let i = 0; i < su; i++) for (let j = 0; j < sv; j++) {
    const u0 = i / su, u1 = (i + 1) / su, v0 = j / sv, v1 = (j + 1) / sv;
    faceEye(push, [bil(a, b, c, d, u0, v0), bil(a, b, c, d, u1, v0), bil(a, b, c, d, u1, v1), bil(a, b, c, d, u0, v1)], tone, k, fwd, null, 0, mat);
  }
}
// Stitch a list of cross-sections (same length each) into quads, each subdivided `sub` times.
function loft(push, rows, tone, k, fwd, mat, sub = 1) {
  for (let i = 0; i + 1 < rows.length; i++) {
    const A = rows[i], B = rows[i + 1];
    for (let j = 0; j + 1 < A.length; j++) quadSub(push, A[j], B[j], B[j + 1], A[j + 1], sub, sub, tone, k, fwd, mat);
  }
}

// A SEAM along a polyline lying on a surface: a dark strip `w` wide, standing `lift` off the
// surface along its normal `nOf(i)`, so it wins the depth test without floating. With `stitch`, a
// row of short light dashes runs beside it, which is what a sewn edge is.
function seam(push, pts, nOf, o = {}) {
  const w = o.w ?? 0.004, lift = o.lift ?? 0.0025;
  const rgb = o.rgb || SEAM;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1], n0 = nOf(i), nl0 = Math.hypot(n0[0], n0[1], n0[2]) || 1, n = [n0[0] / nl0, n0[1] / nl0, n0[2] / nl0];
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const s = [n[1] * d[2] - n[2] * d[1], n[2] * d[0] - n[0] * d[2], n[0] * d[1] - n[1] * d[0]];
    const sl = Math.hypot(s[0], s[1], s[2]);
    if (!(sl > 1e-9)) continue;
    const off = (p, k, side) => [p[0] + n[0] * lift + s[0] / sl * k * side, p[1] + n[1] * lift + s[1] / sl * k * side, p[2] + n[2] * lift + s[2] / sl * k * side];
    push([{ p: [off(a, w / 2, -1), off(b, w / 2, -1), off(b, w / 2, 1), off(a, w / 2, 1)], n }], 'dash', 0, false, rgb, 0);
    if (o.stitch) {
      const len = Math.hypot(d[0], d[1], d[2]), step = 0.014, n2 = Math.floor(len / step);
      for (let j = 0; j < n2; j++) {
        const t0 = (j + 0.2) / n2, t1 = (j + 0.65) / n2;
        const p0 = [a[0] + d[0] * t0, a[1] + d[1] * t0, a[2] + d[2] * t0], p1 = [a[0] + d[0] * t1, a[1] + d[1] * t1, a[2] + d[2] * t1];
        const e = o.stitchOff ?? 0.009, sw = 0.0014;
        push([{ p: [off(p0, e - sw, 1), off(p1, e - sw, 1), off(p1, e + sw, 1), off(p0, e + sw, 1)].map((q) => [q[0] + n[0] * 0.0008, q[1] + n[1] * 0.0008, q[2] + n[2] * 0.0008]), n }],
          'dash', 0, false, o.thread || [170, 170, 164], o.threadEmis || 0);
      }
    }
  }
}

export function truckRoom(P, live, push, rich) {
  // The room reads only the tier and the glow, so it is built once per cab and colourway.
  memoPart(push, 'truckRoom', { L: live || {} }, (R, rec) => truckRoomBody(P, R.L, rec), null);
  if (rich) truckFit(P, live, push);
}
function truckRoomBody(P, live, push) {
  const L = live || {};
  const tier = Math.max(0, Math.min(3, Math.round(num(L.tier, 1))));
  const glow = Array.isArray(L.glow) && L.glow.length === 3 && L.glow.every(Number.isFinite) ? L.glow : C.amber;
  const bare = tier === 0;                 // the Barrow: one painted steel for every surface
  const M = (m) => (bare ? TRUCK_MAT.metal : TRUCK_MAT[m]);
  const thread = tier >= 2 ? glow : [168, 166, 158], threadEmis = tier >= 2 ? 0.3 : 0;
  const xL = P.xCentre - P.halfW, xR = P.xCentre + P.halfW;
  const [wy0, wy1] = P.winY, [wz0, wz1] = P.winZ;
  const NX = 20, xs = Array.from({ length: NX + 1 }, (_, i) => xL + (xR - xL) * (i / NX));
  const cove = 0.14, rake = P.rake ?? 0.16;
  const K = makeKit(push);

  // THE FLOOR, out to the toe board under the curved screen.
  loft(push, xs.map((x) => [[x, P.back, P.floor], [x, (P.back + screenY(P, x)) / 2, P.floor], [x, screenY(P, x), P.floor]]), 'floor', -0.30, false, M('floor'), 2);

  // THE ROOF: flat over the middle, a quarter-round cove down each side, running forward to the top
  // of the glass so there is no sky showing between the header and the lining.
  const coveZ = (x) => (x < xL + cove ? P.roof - cove + Math.sqrt(Math.max(0, cove * cove - (xL + cove - x) ** 2))
    : x > xR - cove ? P.roof - cove + Math.sqrt(Math.max(0, cove * cove - (x - xR + cove) ** 2)) : P.roof);
  const roofRow = (y) => {
    const r = [];
    for (let i = 0; i <= 3; i++) { const t = (i / 3) * Math.PI / 2; r.push([xL + cove - cove * Math.cos(t), y, P.roof - cove + cove * Math.sin(t)]); }
    for (let i = 3; i >= 0; i--) { const t = (i / 3) * Math.PI / 2; r.push([xR - cove + cove * Math.cos(t), y, P.roof - cove + cove * Math.sin(t)]); }
    return r;
  };
  const roofYs = [P.back, P.back + 0.25, P.back + 0.5, -0.05, 0.2, 0.45, 0.7];
  loft(push, roofYs.map(roofRow), 'hdr', -0.40, false, M('fabric'), 2);
  loft(push, xs.map((x) => [[x, 0.7, coveZ(x)], [x, Math.max(0.7, screenY(P, x) - rake), coveZ(x)]]), 'hdr', -0.35, false, M('fabric'), 1);
  // The lining is three panels: seams where the coves meet the flat, and across it at two bows.
  const down = [0, 0, -1];
  for (const x of [xL + cove, xR - cove]) seam(push, [[x, P.back + 0.01, P.roof], [x, 0.69, P.roof]], () => down);
  for (const y of [-0.05, 0.45]) seam(push, [[xL + cove, y, P.roof], [xR - cove, y, P.roof]], () => down, { w: 0.006 });

  // THE HEADER over the glass: a thin curved band, raked back.
  loft(push, xs.map((x) => {
    const y = screenY(P, x) - rake;
    return [[x, y, P.headerZ], [x, y - 0.04, P.headerZ + 0.04], [x, y - 0.04, P.roof - 0.01]];
  }), 'hdr', 0.18, true, M('hard'), 1);
  seam(push, xs.map((x) => [x, screenY(P, x) - rake - 0.041, P.headerZ + 0.045]), () => [0, -1, 0]);

  // THE PILLARS: slim, raked, wrapped in the lining's fabric.
  for (const [x, s] of [[xL + 0.035, 1], [xR - 0.035, -1]]) {
    const yb = screenY(P, x) - 0.02, yt = screenY(P, x) - rake - 0.02;
    K.rod([x, yb, P.dashZ - 0.02], [x + s * 0.01, yt, P.roof - cove * 0.3], P.pillarW / 2, 'pil', 0.24, null, 0, 10);
  }

  // THE DOORS: a kick panel, a card with the armrest line across it, the glass, and a cove above.
  const wallZ1 = P.roof - cove, armZ = -0.42;
  for (const [x, nx] of [[xL, 1], [xR, -1]]) {
    const yF = screenY(P, x);
    const n = [nx, 0, 0];
    const q = (y0, y1, z0, z1, mat, su, sv) => quadSub(push, [x, y0, z0], [x, y1, z0], [x, y1, z1], [x, y0, z1], su, sv, 'pil', nx > 0 ? -0.10 : -0.22, false, M(mat));
    q(P.back, yF, P.floor, armZ - 0.16, 'lower', 10, 3);   // the kick panel
    q(P.back, yF, armZ - 0.16, wz0, 'card', 10, 3);        // the card
    q(P.back, yF, wz1, wallZ1, 'fabric', 8, 1);             // above the glass
    q(P.back, wy0, wz0, wz1, 'card', 2, 4);                 // behind it
    q(wy1, yF, wz0, wz1, 'card', 1, 4);                     // in front of it
    // Shut lines: kick panel to card, card to glass, the reveal round the glass, the card's edges.
    seam(push, [[x, P.back + 0.02, armZ - 0.16], [x, yF - 0.02, armZ - 0.16]], () => n, { w: 0.006 });
    seam(push, [[x, P.back + 0.02, wz0], [x, yF - 0.02, wz0]], () => n, { w: 0.008 });
    seam(push, [[x, wy0, wz0], [x, wy0, wz1], [x, wy1, wz1], [x, wy1, wz0]], () => n, { w: 0.006 });
    seam(push, [[x, P.back + 0.04, P.floor + 0.05], [x, P.back + 0.04, wz0]], () => n);
    // The belt line, a trim strip along the sill: chrome in the glass cabs, black rubber otherwise.
    K.box(x + nx * 0.004, P.back + 0.04, wz0 - 0.012, x + nx * 0.012, yF - 0.04, wz0, 'dash', 0.3, tier >= 2 ? C.chrome : C.rubber);
    // A soft insert across the card, stitched round.
    if (!bare) {
      const iy0 = P.back + 0.30, iy1 = yF - 0.25, iz0 = armZ - 0.10, iz1 = wz0 - 0.06;
      quadSub(push, [x + nx * 0.006, iy0, iz0], [x + nx * 0.006, iy1, iz0], [x + nx * 0.006, iy1, iz1], [x + nx * 0.006, iy0, iz1], 6, 2, 'seat', 0.05, false, TRUCK_MAT.soft);
      seam(push, [[x + nx * 0.006, iy0, iz0], [x + nx * 0.006, iy1, iz0], [x + nx * 0.006, iy1, iz1], [x + nx * 0.006, iy0, iz1], [x + nx * 0.006, iy0, iz0]],
        () => n, { stitch: true, thread, threadEmis, w: 0.005 });
    }
  }

  // THE REAR BULKHEAD, with a rounded lip to carry the light.
  quadSub(push, [xR, P.back, P.floor], [xL, P.back, P.floor], [xL, P.back, wallZ1], [xR, P.back, wallZ1], 10, 4, 'post', -0.16, false, M('card'));
  loft(push, [0, 1, 2, 3, 4].map((i) => {
    const t = (i / 4) * Math.PI;
    return [[xL, P.back + 0.08 * Math.sin(t), 0.10 + 0.05 * (1 - Math.cos(t))], [xR, P.back + 0.08 * Math.sin(t), 0.10 + 0.05 * (1 - Math.cos(t))]];
  }), 'hdr', 0.10, false, M('hard'), 1);
  seam(push, [[xL + 0.02, P.back, 0.10], [xR - 0.02, P.back, 0.10]], () => [0, 1, 0], { w: 0.008 });

  // THE DASH, lofted: fascia, a quarter-round nose, a soft-touch top falling away to the glass, and
  // a toe board back down to the floor. The fascia and nose are the textured hard plastic; the top
  // is a separate soft skin, and the shut line between them is stitched.
  const nose = 0.09;
  const fascia = (x) => {
    const r = [[x, P.dashY, P.floor], [x, P.dashY, (P.floor + P.dashZ - nose) / 2], [x, P.dashY, P.dashZ - nose]];
    for (let i = 1; i <= 4; i++) { const t = (i / 4) * Math.PI / 2; r.push([x, P.dashY + nose - nose * Math.cos(t), P.dashZ - nose + nose * Math.sin(t)]); }
    return r;
  };
  const top = (x) => {
    const yF = screenY(P, x);
    return [[x, P.dashY + nose, P.dashZ], [x, (P.dashY + nose + yF) / 2, P.dashZ - 0.015], [x, yF - 0.02, P.dashZ - 0.06], [x, yF, P.dashZ - 0.08], [x, yF, P.floor]];
  };
  loft(push, xs.map(fascia), 'dash', 0.30, true, M('hard'), 2);
  loft(push, xs.map(top), 'dash', 0.34, true, M('soft'), 2);
  // The split where the soft top meets the hard nose, stitched in the glass cabs.
  seam(push, xs.map((x) => [x, P.dashY + nose + 0.004, P.dashZ + 0.0005]), () => [0, -0.2, 0.98],
    { w: 0.006, stitch: !bare, thread, threadEmis, stitchOff: 0.012 });
  // A horizontal shut line across the fascia where the upper moulding meets the knee panel.
  seam(push, xs.map((x) => [x, P.dashY - 0.0005, -0.72]), () => [0, -1, 0], { w: 0.006 });
  // The ends of the dash, closed at each door, with a seam where the dash butts the door card.
  for (const [x, s] of [[xL + 0.0005, 1], [xR - 0.0005, -1]]) {
    const yF = screenY(P, x);
    faceEye(push, [[x, P.dashY, P.floor], [x, yF, P.floor], [x, yF, P.dashZ - 0.08], [x, P.dashY + nose, P.dashZ], [x, P.dashY, P.dashZ - nose]], 'dash', -0.1, true, null, 0, M('hard'));
    seam(push, [[x + s * 0.002, P.dashY, P.floor + 0.05], [x + s * 0.002, P.dashY, P.dashZ - nose], [x + s * 0.002, P.dashY + nose, P.dashZ]], () => [s, 0, 0], { w: 0.008 });
  }

  // THE SEATS: a cushion and a back each, their fronts stitched.
  const seat = (cx) => {
    K.box(cx - P.seatHalf, P.seatY[0], P.seatZ - 0.16, cx + P.seatHalf, P.seatY[1], P.seatZ, 'seat', 0.06);
    K.box(cx - P.seatHalf, P.seatY[0] - 0.16, P.seatZ, cx + P.seatHalf, P.seatY[0], P.backZ, 'seat', -0.08);
    if (!bare) {
      seam(push, [[cx - P.seatHalf + 0.06, P.seatY[1], P.seatZ - 0.01], [cx + P.seatHalf - 0.06, P.seatY[1], P.seatZ - 0.01]], () => [0, 1, 0],
        { w: 0.004, stitch: true, thread, threadEmis, lift: 0.002 });
      for (const sx of [-1, 1]) seam(push, [[cx + sx * (P.seatHalf - 0.025), P.seatY[0] + 0.02, P.seatZ], [cx + sx * (P.seatHalf - 0.025), P.seatY[1] - 0.01, P.seatZ]], () => [0, 0, 1],
        { w: 0.004, stitch: true, thread, threadEmis, lift: 0.056 });
    }
  };
  seat(0); seat(2 * P.xCentre);
}
