// THE PODRACER'S POD, FROM THE SEAT.
//
// An open tub: you sit low in it with the coaming at your chest, the nose cowl in front of you and
// the two turbines out past it on their cables. The turbines and the cables are not drawn here; they
// are the craft's own mesh, posed by the sim and drawn from the seat (windshield.js `seatOnly`), so
// what you see out front is the thing that is pulling you.
//
// Metres about the eye, +x right, +y forward, +z up, like every seat. Sized off the exterior pod in
// content/vehicle_models/mesh_podracer.json at the ground seats' metre (SEAT_EYE_TILES / EYE_M in
// windshield.js, about 7.2 m to a model unit): the pod is about 3.2 m long and 1.3 m across, its rim
// 0.9 m off the ground, and the eye 1.2 m.
//
// THE LOOK is a salvage racer built by somebody who cared: a gunmetal tub stiffened with billet ribs
// and riveted along every seam, copper coolant lines and a braided loom clamped down both walls, an
// oxblood leather bolster under the coaming with a blue light strip tucked beneath it, diamond-quilted
// pads between the ribs, a low console down each wall, and a candy cowl crowned across its width with
// a pearl stripe, panel lines, quarter-turn fasteners, two intake scoops and a chevron on the nose.
// You sit in a racing bucket with thigh and shoulder wings, held by a red four-point harness on a
// cam-lock buckle, your heels on drilled footrests. The dash is a carbon slab on a billet bevel: a
// heading tape across its brow with a digital readout, a glass touchscreen in the middle (the speed,
// both turbines' heat, the craft from above with its cables in their load colours and the binder
// arcing between the turbines in the binder's own colour, the binder, pod, fuel, whip and boost, and
// five soft-keys along its foot), two turned turbine dials with a heat needle each, LED ladders for
// the cables, a row of tell-tales, a G-meter, the nameplate along its foot and a light line along
// the top. The levers are T-grips that twist as you steer.
//
// THE KIT SHOWS. What the yard has fitted (`live.kit`, podracer lot.js) is in the pod where it would
// be: injector bottles racked by the right wall (one more per tier), a coolant reservoir and extra
// hoses down the left, a tuner box on the left console, a lightened tub with drilled ribs and bare
// walls, or an armoured one with bolted plates. A build sheet riveted to the right wall lists it.
//
// Every material is a colour identity (SHINY / PANE / TEXTURE are keyed on the array object), so a
// part is billet because it was handed `POD.billet`, never an equal array.
//
// Every control drawn here does something, through podracer-view.js: the two levers drag, START
// starts or stops the turbines, BRAKE holds the air brakes, BOOST (under its flip cover) lights the
// boost, and the screen's soft-keys change the camera (CAM), open the controls (HELP), call the
// yard's flatbed (TOW) and climb out (EXIT). Small labels are the legend face; the nameplate is display lettering
// (docs/reference/cockpit-lettering.md).
//
// The tub, the cowl and the quadrant read nothing live and are built once (`K.group`); the dash and
// the levers are rebuilt as their readings move.

import { makeKit, C, SHINY, PANE, TEXTURE, clamp } from './interior-kit.js';
import { hotspotHalo, domeButton, contactShadow } from './interior-cockpit-kit.js';
import { engraveText } from './interior-drake.js';
import { legendWidth } from './legend-font.js';

export const POD = {
  candy: [170, 26, 20],        // the cowl and the outside: deep candy red under a thick clear
  pearl: [238, 200, 76],       // the stripe and the trim: pearl yellow
  oxblood: [96, 28, 24],       // the leather bolsters
  oxbloodDk: [58, 18, 16],     // the welts and stitch lines in them
  leather: [52, 42, 38],       // the seat
  leatherDk: [30, 24, 22],     // the backing behind the seat
  rubber: [22, 22, 24],        // the floor mat
  gun: [56, 60, 68],           // the tub's inner skin: gunmetal paint over cast alloy
  rib: [118, 124, 134],        // the frames that stiffen it
  rivet: [168, 174, 184],      // domed rivet heads
  copper: [190, 108, 60],      // the coolant lines
  loom: [34, 34, 40],          // a braided wiring loom
  carbon: [30, 32, 38],        // the dash and the quadrant: carbon weave under lacquer
  billet: [190, 196, 204],     // machined aluminium: bezels, frames, levers, treads
  anod: [178, 30, 26],         // red anodising: the thumb buttons, the boost cover
  black: [20, 18, 18],         // black anodising: the nameplate the gold is cut into
  gold: [236, 196, 112],       // the nameplate's engraving
  grip: [26, 26, 28],          // the lever grips
  hazard: [236, 182, 30],      // the chevrons
  screen: [150, 190, 210],     // the windscreen tint, see-through
  glint: [250, 252, 255],      // a crescent of window light on a dial glass, see-through
  glow: [255, 170, 90],        // the backlight's pool, see-through
  cut: [6, 7, 9],              // the shadow in an engraving
  ink: [228, 232, 238],
  inkLit: [255, 224, 180],
  crt: [6, 22, 15],            // the screen's glass
  key: [14, 46, 38],           // a soft-key, at rest
  keyHot: [30, 104, 86],       // a soft-key under the pointer
  phos: [120, 255, 170],       // its phosphor, lit
  phosDim: [34, 110, 70],      // the graticule
  arc: [170, 230, 255],        // the binder on the scope
  el: [70, 190, 255],          // the light strip under the coaming
  elHot: [255, 120, 40],       // the same strip with the boost lit
  harness: [46, 48, 56],       // the harness webbing, charcoal so it reads against any leather
  seam: [92, 14, 10],          // a panel line in the candy
  armour: [66, 70, 60],        // bolted armour plate, olive steel
  armourDk: [40, 42, 38],      // its backing plate
  tread: [104, 108, 96],       // the raised lozenges of its tread pattern
  injector: [36, 96, 196],     // the injector bottles: blue anodising
  hose: [44, 104, 176],        // the coolant hoses
  coolant: [70, 230, 190],     // the coolant in the reservoir's sight glass, see-through
  led: [90, 255, 140],         // the tuner's status light
  hole: [8, 8, 10],            // a lightening hole in a drilled rib
};
SHINY.set(POD.candy, { spec: 1, pow: 110, coat: 0.9 }); TEXTURE.set(POD.candy, 'paint');
SHINY.set(POD.pearl, { spec: 0.9, pow: 90, coat: 0.8 }); TEXTURE.set(POD.pearl, 'paint');
SHINY.set(POD.oxblood, { spec: 0.4, pow: 20, coat: 0.22 }); TEXTURE.set(POD.oxblood, 'leather');
TEXTURE.set(POD.oxbloodDk, 'leather');
SHINY.set(POD.leather, { spec: 0.28, pow: 14, coat: 0.12 }); TEXTURE.set(POD.leather, 'leather');
TEXTURE.set(POD.leatherDk, 'leather');
SHINY.set(POD.rubber, { spec: 0.12, pow: 8 }); TEXTURE.set(POD.rubber, 'rubber');
SHINY.set(POD.gun, { spec: 0.35, pow: 22, coat: 0.15 }); TEXTURE.set(POD.gun, 'cast');
SHINY.set(POD.rib, { spec: 0.8, pow: 24, ramp: [[50, 54, 62], [214, 220, 228]], glint: 0.25, albedo: [210, 216, 224], envK: 0.6 }); TEXTURE.set(POD.rib, 'brushed');
SHINY.set(POD.rivet, { spec: 1, pow: 30, ramp: [[70, 74, 82], [246, 248, 252]], glint: 0.5, albedo: [236, 240, 246], envK: 0.7 });
SHINY.set(POD.copper, { spec: 1, pow: 28, ramp: [[96, 44, 20], [255, 190, 140]], glint: 0.45, albedo: [240, 150, 96], envK: 0.7 }); TEXTURE.set(POD.copper, 'brushed');
SHINY.set(POD.loom, { spec: 0.2, pow: 10 }); TEXTURE.set(POD.loom, 'fabric');
SHINY.set(POD.carbon, { spec: 0.6, pow: 46, coat: 0.5 }); TEXTURE.set(POD.carbon, 'fabric');
SHINY.set(POD.billet, { spec: 0.9, pow: 26, ramp: [[64, 68, 76], [240, 244, 250]], glint: 0.35, albedo: [236, 240, 246], envK: 0.8 });
TEXTURE.set(POD.billet, 'brushed');
SHINY.set(POD.anod, { spec: 0.6, pow: 40, coat: 0.4 }); SHINY.set(POD.black, { spec: 0.55, pow: 40, coat: 0.4 });
SHINY.set(POD.gold, { spec: 1, pow: 24, ramp: [[120, 78, 22], [255, 230, 150]], glint: 0.5, albedo: [255, 210, 130], envK: 0.65 });
SHINY.set(POD.grip, { spec: 0.15, pow: 10 }); TEXTURE.set(POD.grip, 'rubber');
SHINY.set(POD.hazard, { spec: 0.8, pow: 60, coat: 0.6 }); TEXTURE.set(POD.hazard, 'paint');
SHINY.set(POD.crt, { spec: 0.9, pow: 80, coat: 0.85 });
SHINY.set(POD.harness, { spec: 0.15, pow: 10 }); TEXTURE.set(POD.harness, 'fabric');
SHINY.set(POD.seam, { spec: 0.5, pow: 60, coat: 0.5 }); TEXTURE.set(POD.seam, 'paint');
SHINY.set(POD.armour, { spec: 0.15, pow: 12 }); TEXTURE.set(POD.armour, 'cast');
SHINY.set(POD.armourDk, { spec: 0.1, pow: 10 }); TEXTURE.set(POD.armourDk, 'cast');
SHINY.set(POD.tread, { spec: 0.55, pow: 30, ramp: [[40, 42, 38], [170, 174, 160]], glint: 0.3, albedo: [150, 154, 140], envK: 0.4 }); TEXTURE.set(POD.tread, 'brushed');
SHINY.set(POD.injector, { spec: 0.9, pow: 70, coat: 0.8 }); TEXTURE.set(POD.injector, 'paint');
SHINY.set(POD.hose, { spec: 0.2, pow: 12 }); TEXTURE.set(POD.hose, 'rubber');
PANE.set(POD.screen, 0.16); PANE.set(POD.glint, 0.2); PANE.set(POD.glow, 0.16); PANE.set(POD.coolant, 0.55);

// ── The kit, as the pod shows it ──────────────────────────────────────────────
// The fitted parts the yard sells (podracer-model.js PODRACER_KIT), read defensively: a tier is 0..3
// and anything missing is stock. The labels are this file's own, for the build sheet, so the shared
// interior needs nothing from the client's panels.
const KIT_TIERS = ['STOCK', 'STREET', 'RACE', 'PRO'];
// Each with the short name the build sheet uses once it runs to two columns.
const KIT_PERF = [['engine', 'TURBINE', 'TURBINE'], ['boost', 'INJECTORS', 'INJECT'], ['cooling', 'COOLING', 'COOLING'], ['vanes', 'VANES', 'VANES'],
  ['binder', 'BINDER', 'BINDER'], ['cables', 'CABLES', 'CABLES'], ['brakes', 'AIR BRAKE', 'BRAKES'], ['tank', 'FUEL CELL', 'FUEL'], ['reel', 'SLING REEL', 'REEL']];
const KIT_CHOICE = { shell: { light: 'LIGHT TUB', armour: 'ARMOUR TUB' }, tether: { short: 'SHORT TETHER', long: 'LONG TETHER' } };
const tierOf = (k, id) => Math.max(0, Math.min(3, Math.round(Number(k?.[id]) || 0)));
const kitOf = (L) => {
  const k = L?.kit && typeof L.kit === 'object' ? L.kit : {};
  const out = {};
  for (const [id] of KIT_PERF) out[id] = tierOf(k, id);
  out.shell = KIT_CHOICE.shell[k.shell] ? k.shell : 'stock';
  out.tether = KIT_CHOICE.tether[k.tether] ? k.tether : 'standard';
  return out;
};
// The build sheet's lines: each fitted part and its tier, then the tub and the tether if they differ.
const sheetLines = (kit) => [
  ...KIT_PERF.filter(([id]) => kit[id] > 0).map(([id, label, short]) => [label, KIT_TIERS[kit[id]], short]),
  ...(kit.shell !== 'stock' ? [[KIT_CHOICE.shell[kit.shell], '', KIT_CHOICE.shell[kit.shell]]] : []),
  ...(kit.tether !== 'standard' ? [[KIT_CHOICE.tether[kit.tether], '', KIT_CHOICE.tether[kit.tether]]] : []),
];

// ── The inside, made to order (podracer paint leather= strip= dash=) ──────────
// Each choice is its own colour identity with its own material, so a tan bolster is leather because
// it was handed INSIDE.leather.tan, never an equal array. The ids are the verb's words
// (plugins/podracer/lot.js INSIDE_OPTIONS); an unknown or missing one is the factory's.
export const INSIDE = {
  leather: { oxblood: POD.oxblood, tan: [150, 96, 52], black: [28, 26, 26], cream: [214, 200, 170], green: [32, 72, 48], blue: [36, 52, 104] },
  strip: { blue: POD.el, red: [255, 64, 52], green: [80, 255, 140], amber: [255, 176, 40], violet: [176, 96, 255], white: [236, 242, 255] },
  dash: { carbon: POD.carbon, gunmetal: [52, 56, 64], cream: [206, 198, 178], billet: [170, 176, 186] },
};
for (const [k, c] of Object.entries(INSIDE.leather)) if (k !== 'oxblood') { SHINY.set(c, { spec: 0.4, pow: 20, coat: 0.22 }); TEXTURE.set(c, 'leather'); }
SHINY.set(INSIDE.dash.gunmetal, { spec: 0.5, pow: 36, coat: 0.4 }); TEXTURE.set(INSIDE.dash.gunmetal, 'cast');
SHINY.set(INSIDE.dash.cream, { spec: 0.6, pow: 50, coat: 0.6 }); TEXTURE.set(INSIDE.dash.cream, 'paint');
SHINY.set(INSIDE.dash.billet, { spec: 0.9, pow: 26, ramp: [[64, 68, 76], [240, 244, 250]], glint: 0.3, albedo: [230, 234, 240], envK: 0.7 }); TEXTURE.set(INSIDE.dash.billet, 'brushed');
const DEFAULT_INSIDE = { leather: 'oxblood', strip: 'blue', dash: 'carbon' };
const insideOf = (L) => {
  const i = L?.inside || {};
  return { leather: INSIDE.leather[i.leather] ? i.leather : DEFAULT_INSIDE.leather, strip: INSIDE.strip[i.strip] ? i.strip : DEFAULT_INSIDE.strip,
    dash: INSIDE.dash[i.dash] ? i.dash : DEFAULT_INSIDE.dash };
};
// A darker shade of a leather for its welts: one per leather, made once, so it is an identity too.
const WELT = new Map();
const weltOf = (c) => { if (!WELT.has(c)) { const d = c.map((v) => Math.round(v * 0.6)); TEXTURE.set(d, 'leather'); WELT.set(c, d); } return WELT.get(c); };

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const plus = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

// ── The room's numbers ────────────────────────────────────────────────────────
const RIM = -0.31, FLOOR = -0.98, WALL = 0.60, AFT = -1.25, FWD = 0.76;
// The throttle quadrant between your knees, low enough that a full lever stays under the dash's
// readouts from the seat. A lever is a billet arm in a slot ending in a T-grip.
const Q = { y: 0.33, z: -0.74, slot: 0.07, len: 0.19, idle: -28, full: 28 };
const leverTip = (side, v) => {
  const t = (Q.idle + (Q.full - Q.idle) * clamp(v || 0, 0, 1)) * Math.PI / 180;
  const x = side * Q.slot;
  return { base: [x, Q.y, Q.z], tip: [x, Q.y + Math.sin(t) * Q.len, Q.z + Math.cos(t) * Q.len] };
};
// The nose cowl you look over: candy, in two strakes forward and down to the nose.
const COWL = [[WALL + 0.07, FWD, RIM], [0.42, 1.25, -0.44], [0.12, 1.62, -0.60]];
const COWL_N = unit([0, -0.3, 0.95]);
// The cowl is crowned across its width, so it reads as a pressed panel and not a flat board. The
// crown fades in over the first third of the aft strake, where the windscreen stands on it.
const CROWN = 0.026;
const crownAt = (i, x, t) => CROWN * (1 - x * x) * (i === 0 ? Math.min(1, t * 3) : 1);
// A point on the cowl: `x` across (-1..1 of each strake's half-width), `t` along strake `i`.
const cowlAt = (i, x, t, lift = 0) => {
  const a = COWL[i], b = COWL[i + 1], hw = a[0] + (b[0] - a[0]) * t;
  return [x * hw, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t + crownAt(i, x, t) + lift];
};
// The same, `xa` metres across rather than a share of the width: the stripe keeps its width.
const cowlAbs = (i, xa, t, lift = 0) => {
  const a = COWL[i], b = COWL[i + 1], hw = a[0] + (b[0] - a[0]) * t;
  return cowlAt(i, xa / hw, t, lift);
};
// The cowl's own normal at a point, from two small steps across and along it.
const cowlN = (i, x, t) => {
  const p = cowlAt(i, x, t), px = cowlAt(i, x + 0.02, t), pt = cowlAt(i, x, Math.min(1, t + 0.02));
  const n = unit(cross(sub(px, p), sub(pt, p)));
  return n[2] < 0 ? scale(n, -1) : n;
};
// A face's normal from its first three corners, turned to face up or toward the eye.
const faceN = (q, toward) => {
  const n = unit(cross(sub(q[1], q[0]), sub(q[2], q[0])));
  return dot(n, toward) < 0 ? scale(n, -1) : n;
};
// A flat band between two points, `w` wide, laid across `side`: a harness strap, a hose clip.
function strap(K, a, b, w, rgb, side, th = 0.003, tone = 'seat') {
  const d = sub(b, a), L = Math.hypot(d[0], d[1], d[2]);
  if (!(L > 1e-6)) return;
  const U = scale(d, 1 / L);
  const R = unit(sub(side, scale(U, dot(side, U))));
  K.obox(lerp3(a, b, 0.5), R, U, unit(cross(R, U)), w / 2, L / 2, th, tone, 0.2, rgb, 0);
}

// The dash: a panel under the cowl's aft edge, its top leaning away so it faces up at the eye.
function dashPanel(K) { return K.panel([0, 0.70, -0.52], [1, 0, 0], [0, 0.3, 0.95]); }
// The quadrant's top plate, read looking down.
function quadPanel(K) { return K.panel([0, Q.y, Q.z + 0.001], [1, 0, 0], [0, 1, 0]); }
const BTN = { ign: [0.42, -0.165], brake: [0.32, -0.165], boost: [0.20, -0.165] };
// The dash's raised slab, chamfered (see `bevel`): its face, in the dash's own coordinates.
const SLAB = [-0.50, -0.215, 0.50, 0.205], SLAB_D = 0.012, SLAB_CH = 0.01;
const slabPanel = (K, D) => K.panel(D.pt(0, 0, SLAB_D), D.r, D.u);
// The screen, the dials and the ladders, on the slab.
const SCREEN = { a0: -0.165, a1: 0.165, b0: -0.112, b1: 0.142 };
// The screen's soft-keys, along its foot: centre across, and what each is.
const KEYS = [{ id: 'gui:cam', a: -0.13, label: 'CAM' }, { id: 'gui:help', a: -0.065, label: 'HELP' },
  { id: 'gui:dock', a: 0, label: 'LAUNCH' }, { id: 'gui:tow', a: 0.065, label: 'TOW' }, { id: 'gui:exit', a: 0.13, label: 'EXIT' }];
const KEY_B = -0.088, KEY_HA = 0.029, KEY_HB = 0.02;
const DIAL = { a: 0.30, b: 0.07, R: 0.075 };
const LADDER = { a: 0.45, b0: -0.02, b1: 0.16, n: 8 };
// The heading tape across the slab's brow, its digital readout to the right and the builder's tag to
// the left; the G-meter bottom left; the nameplate along the foot.
const TAPE = { a0: -0.148, a1: 0.148, b0: 0.163, b1: 0.199, degW: 0.0046 };
const HDG = { a0: 0.168, a1: 0.238, b0: 0.164, b1: 0.200 };
const GM = { a: -0.25, b: -0.15, R: 0.034 };
const PLATE = { a0: -0.145, a1: 0.145, b0: -0.209, b1: -0.168 };
// The low consoles down each wall, and the injector bottles' places aft of the right one.
const CON = { y0: 0.12, y1: 0.60, xi: 0.43, top: -0.80 };
const BOTTLE = { x: 0.49, r: 0.034, y0: -0.215, dy: 0.088, z0: FLOOR + 0.01, z1: -0.70 };
// The ribs' stations along the wall, and the bays between them that take pads or plates. The right
// wall's bay at 0.25..0.57 carries the build sheet.
const RIBS = []; for (let y = AFT + 0.22; y < FWD - 0.05; y += 0.32) RIBS.push(y);
const PAD = { z0: RIM - 0.29, z1: RIM - 0.12 };
// Its top a little under the pads' (the light strip crosses in front of the wall up there), its
// foot just clear of the copper lines.
const SHEET = { y0: 0.275, y1: 0.545, z0: PAD.z0 - 0.005, z1: PAD.z1 - 0.015, x: WALL - 0.022 };

export function podracerHotspots(live) {
  const K = makeKit(() => {});
  const S = slabPanel(K, dashPanel(K));
  const L = live || {};
  const lev = L.lever || [0, 0];
  return [
    { id: 'ign', p: S.pt(...BTN.ign, 0.02), r: 0.03, kind: 'click' },
    { id: 'brake', p: S.pt(...BTN.brake, 0.02), r: 0.03, kind: 'hold' },
    { id: 'boost', p: S.pt(...BTN.boost, 0.02), r: 0.03, kind: 'hold' },
    ...KEYS.map((k) => ({ id: k.id, p: S.pt(k.a, KEY_B, 0.01), r: 0.03, kind: 'click' })),
    { id: 'levL', p: leverTip(-1, lev[0]).tip, r: 0.05, kind: 'drag' },
    { id: 'levR', p: leverTip(1, lev[1]).tip, r: 0.05, kind: 'drag' },
  ];
}

// A raised slab with a chamfered billet edge all round. Each chamfer faces its own way, so one edge
// or another catches the light as you turn your head. The hydro's `bevel`, in this seat's billet.
function bevel(K, Pn, a0, b0, a1, b1, d, ch, rgb) {
  const base = [[a0, b0], [a1, b0], [a1, b1], [a0, b1]];
  const top = [[a0 + ch, b0 + ch], [a1 - ch, b0 + ch], [a1 - ch, b1 - ch], [a0 + ch, b1 - ch]];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const q = [Pn.pt(...base[i], 0.0015), Pn.pt(...base[j], 0.0015), Pn.pt(...top[j], d), Pn.pt(...top[i], d)];
    let n = unit(cross(sub(q[1], q[0]), sub(q[3], q[0])));
    if (n[0] * q[0][0] + n[1] * q[0][1] + n[2] * q[0][2] > 0) n = n.map((v) => -v);
    K.face(q, n, 'dash', 0.35, POD.billet, 0.05);
  }
  Pn.plate(top, rgb, 0, d);
}

// A turned billet bezel round a dial, with the crescent of window light on its glass.
function bezel(Pn, a, b, R, lit) {
  Pn.torus(a, b, R * 1.04, R * 1.24, POD.billet, 0.05, 0.006, 28, 3);
  if (lit) Pn.disc(a, b, R * 0.96, POD.glow, 1, 0.0035, 20);
  Pn.annulus(a, b, R * 0.55, R * 1.0, POD.glint, 1, 0.016, 8, Math.PI * 0.55, Math.PI * 0.95);
}

// A stroke on a panel from (a0, b0) to (a1, b1), `w` wide: a line on the scope.
function stroke(Pn, a0, b0, a1, b1, w, rgb, emis, l) {
  const da = a1 - a0, db = b1 - b0, L = Math.hypot(da, db) || 1, na = -db / L * w / 2, nb = da / L * w / 2;
  Pn.plate([[a0 + na, b0 + nb], [a1 + na, b1 + nb], [a1 - na, b1 - nb], [a0 - na, b0 - nb]], rgb, emis, l);
}

// A domed rivet head.
const rivet = (K, p, n) => K.rod(p, [p[0] + n[0] * 0.006, p[1] + n[1] * 0.006, p[2] + n[2] * 0.006], 0.0075, 'pil', 0.2, POD.rivet, 0.05, 6);

// ── The tub, built once per leather and tub ────────────────────────────────
// `shell` is the kit's: 'stock' has quilted leather pads between the ribs, 'light' bare walls with
// lightening holes and drilled ribs, 'armour' bolted plates.
function tub(K, leatherId = 'oxblood', shell = 'stock') {
  const LEA = INSIDE.leather[leatherId] || POD.oxblood, WEL = weltOf(LEA);
  // The floor, billet treads across the footwell where your heels go, and the footrests.
  K.box(-WALL + 0.03, AFT, FLOOR - 0.02, WALL - 0.03, FWD + 0.2, FLOOR, 'floor', 0.2, POD.rubber, 0);
  for (const x of [-0.30, -0.15, 0.15, 0.30]) K.box(x - 0.012, -0.10, FLOOR, x + 0.012, FWD, FLOOR + 0.006, 'floor', 0.2, POD.billet, 0.03);
  footrests(K);

  for (const s of [-1, 1]) {
    const xi = s * WALL, n = [-s, 0, 0];
    // The inner skin in gunmetal, the candy skin outside it.
    K.box(xi, AFT, FLOOR, s * (WALL + 0.05), FWD, RIM, 'pil', 0.2, POD.gun, 0);
    K.box(s * (WALL + 0.05), AFT - 0.2, FLOOR + 0.05, s * (WALL + 0.07), FWD + 0.4, RIM - 0.01, 'pil', 0.2, POD.candy, 0);
    // The frames: billet ribs up the wall, each riveted top and bottom. A lightened tub has them drilled.
    for (const y of RIBS) {
      K.box(xi - s * 0.018, y - 0.016, FLOOR + 0.02, xi, y + 0.016, RIM - 0.10, 'pil', 0.2, POD.rib, 0.03);
      for (const z of [FLOOR + 0.07, RIM - 0.15]) rivet(K, [xi - s * 0.018, y, z], n);
      if (shell === 'light') {
        const R = K.panel([xi - s * 0.0185, y, -0.6], [0, -s, 0], [0, 0, 1], 'pil', 0.2);
        for (const z of [-0.85, -0.575, -0.505]) R.disc(0, z + 0.6, 0.0095, POD.hole, 0, 0.0004, 10);
      }
    }
    // A riveted seam along the wall, low and high.
    for (let y = AFT + 0.08; y < FWD - 0.02; y += 0.08) for (const z of [FLOOR + 0.04, RIM - 0.115]) rivet(K, [xi, y, z], n);
    // Copper coolant lines and a braided loom, clamped to the ribs.
    const lines = [[FLOOR + 0.30, 0.013, POD.copper], [FLOOR + 0.355, 0.013, POD.copper], [FLOOR + 0.22, 0.018, POD.loom]];
    for (const [z, r, rgb] of lines) K.rod([xi - s * 0.045, AFT + 0.1, z], [xi - s * 0.045, FWD - 0.03, z], r, 'pil', 0.2, rgb, 0, 10);
    for (const y of RIBS) {
      K.box(xi - s * 0.06, y - 0.012, FLOOR + 0.20, xi - s * 0.018, y + 0.012, FLOOR + 0.375, 'pil', 0.2, POD.billet, 0.03);
    }
    // The bolster: one fat leather roll under the coaming, stitched in panels, and the coaming over it.
    K.rod([xi - s * 0.02, AFT + 0.05, RIM - 0.06], [xi - s * 0.02, FWD - 0.02, RIM - 0.06], 0.045, 'pil', 0.25, LEA, 0, 16);
    for (let y = AFT + 0.2; y < FWD - 0.05; y += 0.2) {
      K.rod([xi - s * 0.02, y - 0.004, RIM - 0.06], [xi - s * 0.02, y + 0.004, RIM - 0.06], 0.0465, 'pil', 0.25, WEL, 0, 16);
    }
    K.rod([s * (WALL + 0.035), AFT, RIM], [s * (WALL + 0.035), FWD, RIM], 0.036, 'dash', 0.3, LEA, 0, 14);
    // Between the ribs, under the bolster: a quilted pad, a bare skin with its lightening holes, or a
    // bolted plate. The right wall's forward bay is the build sheet's (buildSheet).
    for (let i = 0; i < RIBS.length - 1; i++) {
      const y0 = RIBS[i] + 0.018, y1 = RIBS[i + 1] - 0.018;
      if (s > 0 && y0 <= SHEET.y0 && y1 >= SHEET.y1) continue;
      if (shell === 'armour') armourPlate(K, s, y0, y1);
      else if (shell === 'light') {
        const R = K.panel([xi - s * 0.0005, (y0 + y1) / 2, (PAD.z0 + PAD.z1) / 2], [0, -s, 0], [0, 0, 1], 'pil', 0.2);
        for (const a of [-0.085, 0, 0.085]) {
          R.disc(a, 0, 0.032, POD.rib, 0.03, 0.0006, 16);
          R.disc(a, 0, 0.024, POD.hole, 0, 0.0012, 16);
        }
      } else quiltPad(K, s, y0, y1, LEA, WEL);
    }
    sideConsole(K, s);
  }
  K.rod([-(WALL + 0.035), AFT, RIM], [WALL + 0.035, AFT, RIM], 0.036, 'dash', 0.3, LEA, 0, 14);
  K.box(-WALL, AFT - 0.06, FLOOR, WALL, AFT, RIM, 'pil', 0.2, POD.gun, 0);
  seat(K, LEA, WEL);
}

// A diamond-quilted leather pad between two ribs: the diamonds tile it in two offset lattices, the
// welt shows between them as the stitching, and a button sits where four meet.
function quiltPad(K, s, y0, y1, LEA, WEL) {
  K.box(s * (WALL - 0.016), y0, PAD.z0, s * WALL, y1, PAD.z1, 'pil', 0.25, WEL, 0);
  const W = y1 - y0, H = PAD.z1 - PAD.z0;
  const P = K.panel([s * (WALL - 0.0165), (y0 + y1) / 2, (PAD.z0 + PAD.z1) / 2], [0, -s, 0], [0, 0, 1], 'pil', 0.25);
  const nx = Math.max(2, Math.round(W / 0.075)), ny = 3, dw = W / nx, dh = H / ny;
  const diamond = (a, b) => P.plate([[a - dw * 0.47, b], [a, b - dh * 0.47], [a + dw * 0.47, b], [a, b + dh * 0.47]], LEA, 0, 0.002);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) diamond(-W / 2 + (i + 0.5) * dw, -H / 2 + (j + 0.5) * dh);
  for (let j = 1; j < ny; j++) for (let i = 1; i < nx; i++) diamond(-W / 2 + i * dw, -H / 2 + j * dh);
  for (let j = 0; j < ny; j++) for (let i = 1; i < nx; i++) P.disc(-W / 2 + i * dw, -H / 2 + (j + 0.5) * dh, 0.0042, WEL, 0, 0.0028, 8);
}

// A bolted armour plate over a bay: a tread plate on a thinner backing, a bolt in each corner. The
// tread is raised lozenges, alternately turned, so it reads as steel and not as a smoked pane.
function armourPlate(K, s, y0, y1) {
  K.box(s * (WALL - 0.012), y0, PAD.z0 - 0.01, s * WALL, y1, PAD.z1, 'pil', 0.2, POD.armourDk, 0);
  K.box(s * (WALL - 0.024), y0 + 0.012, PAD.z0, s * (WALL - 0.012), y1 - 0.012, PAD.z1 - 0.012, 'pil', 0.2, POD.armour, 0.02);
  const P = K.panel([s * (WALL - 0.0245), (y0 + y1) / 2, (PAD.z0 + PAD.z1 - 0.012) / 2], [0, -s, 0], [0, 0, 1], 'pil', 0.2);
  const W = y1 - y0 - 0.07, H = PAD.z1 - PAD.z0 - 0.05, nx = Math.max(3, Math.round(W / 0.036)), ny = 4;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = -W / 2 + (i + 0.5) * W / nx, b = -H / 2 + (j + 0.5) * H / ny, t = ((i + j) % 2 ? 1 : -1) * 0.7;
    const ca = Math.cos(t) * 0.011, sa = Math.sin(t) * 0.011, cb = -Math.sin(t) * 0.0028, sb = Math.cos(t) * 0.0028;
    P.plate([[a - ca, b - sa], [a + cb, b + sb], [a + ca, b + sa], [a - cb, b - sb]], POD.tread, 0, 0.0015);
  }
  for (const y of [y0 + 0.026, y1 - 0.026]) for (const z of [PAD.z0 + 0.016, PAD.z1 - 0.024]) {
    K.rod([s * (WALL - 0.024), y, z], [s * (WALL - 0.031), y, z], 0.009, 'pil', 0.2, POD.rivet, 0.05, 6);
  }
}

// The low console down each wall, forward of the seat: gunmetal with a billet edge and a vent in its
// face. What the kit puts on it is kitParts'.
function sideConsole(K, s) {
  const xo = s * (WALL - 0.002), xi = s * CON.xi;
  K.box(xi, CON.y0, FLOOR, xo, CON.y1, CON.top, 'pil', 0.2, POD.gun, 0);
  K.rod([xi, CON.y0, CON.top], [xi, CON.y1, CON.top], 0.007, 'pil', 0.2, POD.billet, 0.05, 8);
  K.rod([xi, CON.y0, CON.top], [xo, CON.y0, CON.top], 0.007, 'pil', 0.2, POD.billet, 0.05, 8);
  for (const y of [CON.y0 + 0.03, (CON.y0 + CON.y1) / 2, CON.y1 - 0.03]) rivet(K, [xi, y, CON.top - 0.03], [-s, 0, 0]);
}
// The console's inboard face, which the eye looks down at: lettered, or a vent.
const consoleFace = (K, s) => K.panel([s * CON.xi - s * 0.0005, (CON.y0 + CON.y1) / 2, (FLOOR + CON.top) / 2], [0, -s, 0], [0, 0, 1], 'pil', 0.2);

// The footrests either side of the quadrant: drilled billet plates sloped up to the toes, a heel cup
// behind each and a hazard band along its top.
function footrests(K) {
  const R = [1, 0, 0], U = unit([0, 0.6, 0.8]), N = cross(R, U);
  for (const s of [-1, 1]) {
    const c = [s * 0.27, 0.55, FLOOR + 0.07];
    K.obox(c, R, U, N, 0.06, 0.08, 0.005, 'floor', 0.2, POD.billet, 0.03);
    const P = K.panel(plus(c, scale(N, 0.0055)), R, U, 'floor', 0.2);
    for (const a of [-0.03, 0, 0.03]) for (const b of [-0.045, -0.015, 0.015]) P.disc(a, b, 0.0085, POD.hole, 0, 0.0005, 8);
    P.rect(-0.06, 0.062, 0.06, 0.078, POD.hazard, 0, 0.0008);
    for (let k = -2; k <= 2; k++) P.plate([[k * 0.024 - 0.006, 0.062], [k * 0.024 + 0.002, 0.062], [k * 0.024 + 0.010, 0.078], [k * 0.024 + 0.002, 0.078]], POD.black, 0, 0.0012);
    K.box(s * 0.21, 0.455, FLOOR, s * 0.33, 0.475, FLOOR + 0.05, 'floor', 0.2, POD.billet, 0.03);
  }
}

// The racing bucket: a gunmetal shell, a quilted back, round thigh and shoulder wings in the leather,
// head wings either side of the headrest, the candy fairing behind your head, and a four-point
// harness to a cam-lock buckle at your lap.
function seat(K, LEA, WEL) {
  // The cushion, stitched in three channels, and the thigh wings either side of it.
  K.box(-0.20, -0.45, -0.90, 0.20, 0.03, -0.81, 'seat', 0.2, LEA, 0);
  for (const x of [-0.10, 0, 0.10]) K.rod([x, -0.44, -0.808], [x, 0.02, -0.808], 0.005, 'seat', 0.2, WEL, 0, 6);
  for (const s of [-1, 1]) {
    K.rod([s * 0.235, -0.44, -0.80], [s * 0.235, 0.0, -0.80], 0.05, 'seat', 0.25, LEA, 0, 12);
    K.box(s * 0.28, -0.46, -0.92, s * 0.30, 0.04, -0.76, 'seat', 0.2, POD.gun, 0);
  }
  // The shell and the quilted back, the shoulder wings and the shell's sides round them.
  K.box(-0.30, -0.60, -0.92, 0.30, -0.47, 0.06, 'seat', 0.2, POD.gun, 0);
  for (let x = -0.18; x <= 0.181; x += 0.06) K.rod([x, -0.462, -0.76], [x, -0.462, -0.03], 0.024, 'seat', 0.2, LEA, 0, 8);
  for (const s of [-1, 1]) {
    K.rod([s * 0.24, -0.45, -0.76], [s * 0.24, -0.45, -0.07], 0.045, 'seat', 0.25, LEA, 0, 12);
    K.box(s * 0.285, -0.60, -0.90, s * 0.30, -0.36, -0.04, 'seat', 0.2, POD.gun, 0);
    // The harness slots through the back, either side of your neck.
    K.box(s * 0.10 - 0.032, -0.4705, -0.035, s * 0.10 + 0.032, -0.468, -0.015, 'seat', 0.2, POD.black, 0);
  }
  // The headrest, its head wings, and the headrest fairing behind your head in candy.
  K.box(-0.16, -0.66, 0.05, 0.16, -0.50, 0.24, 'seat', 0.2, LEA, 0);
  for (const s of [-1, 1]) K.box(s * 0.16, -0.62, -0.06, s * 0.20, -0.40, 0.22, 'seat', 0.2, LEA, 0);
  K.box(-0.17, -0.70, -0.31, 0.17, -0.66, 0.22, 'pil', 0.2, POD.candy, 0);
  contactShadow(K, [0, -0.2, -0.80], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.28, 0.28);
  harness(K);
}

// The four-point harness: two shoulder straps out of the back down to the buckle, two lap belts in
// from the hips, a crotch strap, billet adjusters, and the cam-lock buckle they all meet in.
function harness(K) {
  const BUCKLE = [0, 0.025, -0.625];
  for (const s of [-1, 1]) {
    const a = [s * 0.10, -0.468, -0.03], m = [s * 0.105, -0.31, -0.20], b = [s * 0.035, 0.02, -0.60];
    strap(K, a, m, 0.05, POD.harness, [s, 0, 0]);
    strap(K, m, b, 0.05, POD.harness, [s, 0, 0]);
    // The adjuster a third of the way down, and the tongue into the buckle.
    strap(K, lerp3(m, b, 0.30), lerp3(m, b, 0.36), 0.056, POD.billet, [s, 0, 0], 0.005);
    strap(K, lerp3(m, b, 0.92), b, 0.034, POD.billet, [s, 0, 0], 0.004);
    const h = [s * 0.255, -0.36, -0.79], c = [s * 0.04, 0.03, -0.635];
    // A lap belt lies flat across the thigh: its width is across it, in the ground plane.
    const flat = [c[1] - h[1], h[0] - c[0], 0];
    strap(K, h, c, 0.05, POD.harness, flat);
    strap(K, lerp3(h, c, 0.40), lerp3(h, c, 0.47), 0.056, POD.billet, flat, 0.005);
  }
  strap(K, [0, -0.10, -0.80], [0, 0.0, -0.66], 0.045, POD.harness, [1, 0, 0]);
  const n0 = unit(scale(BUCKLE, -1)), r = [1, 0, 0], u = unit(cross(n0, r));
  K.rod(sub(BUCKLE, scale(n0, 0.014)), BUCKLE, 0.042, 'seat', 0.3, POD.billet, 0.05, 20);
  const B = K.panel(BUCKLE, r, u, 'seat', 0.3);
  B.torus(0, 0, 0.026, 0.04, POD.billet, 0.05, 0.0005, 24, 3);
  B.disc(0, 0, 0.027, POD.anod, 0.1, 0.002, 20);
  B.stud(0, 0, 0.007, 0.024, 0.008, POD.billet, 0.05, 0.002);
}

// ── The cowl and the windscreen, built once ─────────────────────────────────
// A thin line laid on the cowl from (x0, t0) to (x1, t1) of strake `i`: a panel seam.
function seamLine(K, i, x0, t0, x1, t1, w = 0.0045, n = 6) {
  for (let k = 0; k < n; k++) {
    const u0 = k / n, u1 = (k + 1) / n;
    const pa = cowlAt(i, x0 + (x1 - x0) * u0, t0 + (t1 - t0) * u0, 0.0015), pb = cowlAt(i, x0 + (x1 - x0) * u1, t0 + (t1 - t0) * u1, 0.0015);
    const nn = cowlN(i, (x0 + x1) / 2, (t0 + t1) / 2), side = scale(unit(cross(nn, sub(pb, pa))), w / 2);
    const q = [sub(pa, side), plus(pa, side), plus(pb, side), sub(pb, side)];
    K.face(q, faceN(q, nn), 'dash', 0.3, POD.seam, 0);
  }
}
// A quarter-turn fastener: a billet button with its slot.
function dzus(K, i, x, t) {
  const p = cowlAt(i, x, t, 0.0025), nn = cowlN(i, x, t), along = unit(sub(cowlAt(i, x, Math.min(1, t + 0.05)), cowlAt(i, x, t)));
  const P = K.panel(p, unit(cross(along, nn)), along, 'dash', 0.3);
  P.disc(0, 0, 0.011, POD.billet, 0.05, 0, 12);
  P.rect(-0.0075, -0.0013, 0.0075, 0.0013, POD.cut, 0, 0.0008);
}
function cowl(K) {
  // Each strake in six facets across and three along, so the crown catches the light as it turns.
  const NX = 6, NT = 3;
  for (let i = 0; i < COWL.length - 1; i++) {
    for (let j = 0; j < NT; j++) for (let k = 0; k < NX; k++) {
      const x0 = -1 + 2 * k / NX, x1 = -1 + 2 * (k + 1) / NX, t0 = j / NT, t1 = (j + 1) / NT;
      const q = [cowlAt(i, x0, t0), cowlAt(i, x1, t0), cowlAt(i, x1, t1), cowlAt(i, x0, t1)];
      K.face(q, faceN(q, [0, 0, 1]), 'dash', 0.3, POD.candy, 0);
    }
    // The pearl stripe down the crown, a billet pinstripe either side.
    for (let j = 0; j < NT; j++) {
      const t0 = j / NT, t1 = (j + 1) / NT;
      const q = [cowlAbs(i, -0.035, t0, 0.002), cowlAbs(i, 0.035, t0, 0.002), cowlAbs(i, 0.035, t1, 0.002), cowlAbs(i, -0.035, t1, 0.002)];
      K.face(q, faceN(q, [0, 0, 1]), 'dash', 0.3, POD.pearl, 0);
      for (const x of [-0.042, 0.042]) K.rod(cowlAbs(i, x, t0, 0.003), cowlAbs(i, x, t1, 0.003), 0.004, 'dash', 0.2, POD.billet, 0.05, 6);
    }
    // Rivet lines down both edges of each strake, and across its seam.
    for (let t = 0.06; t < 1; t += 0.11) for (const x of [-0.93, 0.93]) rivet(K, cowlAt(i, x, t, 0.002), cowlN(i, x, t));
    for (let x = -0.85; x <= 0.86; x += 0.17) if (Math.abs(x) > 0.1) rivet(K, cowlAt(i, x, 0.02, 0.002), cowlN(i, x, 0.02));
    // The panel lines: a hatch outboard of each scoop down the strake, and across it.
    for (const x of [-0.72, 0.72]) seamLine(K, i, x, 0.06, x, 0.96);
  }
  for (const [x0, x1] of [[-0.72, -0.1], [0.1, 0.72]]) seamLine(K, 0, x0, 0.86, x1, 0.86);
  // The hatch's fasteners, at its corners and along its edges.
  for (const s of [-1, 1]) for (const t of [0.12, 0.48, 0.86]) dzus(K, 0, s * 0.80, t);
  for (const s of [-1, 1]) for (const t of [0.2, 0.7]) dzus(K, 1, s * 0.80, t);
  // Two intake scoops, one either side of the stripe: a billet lip round a dark grille.
  for (const s of [-1, 1]) {
    const c = cowlAt(0, s * 0.5, 0.55, 0.004), w = 0.09, h = 0.07;
    const P = K.panel(c, [1, 0, 0], unit([0, 0.95, 0.3]));
    P.rect(-w, -h, w, h, POD.billet, 0.05, 0.002);
    P.grille(-w + 0.012, -h + 0.012, w - 0.012, h - 0.012, 6, POD.black);
  }
  // The chevrons on the nose, black on hazard yellow.
  {
    const P = K.panel(cowlAt(1, 0, 0.82, 0.004), [1, 0, 0], unit([0, 0.95, 0.3]));
    P.rect(-0.11, -0.05, 0.11, 0.05, POD.hazard, 0, 0.001);
    for (let k = -2; k <= 2; k++) {
      const a = k * 0.045;
      P.plate([[a - 0.012, -0.05], [a + 0.006, -0.05], [a + 0.024, 0.05], [a + 0.006, 0.05]], POD.black, 0, 0.002);
    }
  }
  // The cowl's aft edge, a billet lip over the dash.
  K.rod([-(WALL + 0.02), FWD, RIM + 0.01], [WALL + 0.02, FWD, RIM + 0.01], 0.012, 'dash', 0.2, POD.billet, 0.05, 12);
  // The windscreen: a wrap of three tinted panes on a billet frame, standing on the cowl in three
  // clamps, with a streak of light across the middle one.
  const sc = [[-0.32, 0.80, RIM], [0.32, 0.80, RIM], [0.26, 0.66, -0.08], [-0.26, 0.66, -0.08]];
  const nS = unit([0, -0.85, 0.53]);
  K.face(sc, nS, 'dash', 0, POD.screen, 0.2);
  K.face([[-0.20, 0.733, -0.20], [-0.12, 0.733, -0.20], [-0.06, 0.693, -0.135], [-0.14, 0.693, -0.135]], nS, 'dash', 0, POD.glint, 0.3);
  for (const s of [-1, 1]) {
    const w = [[s * 0.32, 0.80, RIM], [s * 0.46, 0.72, RIM], [s * 0.36, 0.60, -0.14], [s * 0.26, 0.66, -0.08]];
    K.face(w, unit([s * -0.7, -0.6, 0.4]), 'dash', 0, POD.screen, 0.2);
    for (let i = 0; i < 3; i++) K.rod(w[i], w[i + 1], 0.009, 'dash', 0.2, POD.billet, 0.05, 10);
  }
  for (let i = 1; i < 4; i++) K.rod(sc[i], sc[(i + 1) % 4], 0.009, 'dash', 0.2, POD.billet, 0.05, 10);
  for (const x of [-0.24, 0, 0.24]) {
    K.box(x - 0.022, 0.79, RIM - 0.006, x + 0.022, 0.815, RIM + 0.024, 'dash', 0.2, POD.billet, 0.05);
    for (const dx of [-0.011, 0.011]) rivet(K, [x + dx, 0.79, RIM + 0.012], [0, -1, 0]);
  }
}

// ── The dash's carcass and the quadrant box, built once ─────────────────────
function dashBody(K, dashId = 'carbon') {
  const DSH = INSIDE.dash[dashId] || POD.carbon;
  const D = dashPanel(K);
  D.rect(-0.53, -0.235, 0.53, 0.225, DSH, 0);
  bevel(K, D, ...SLAB, SLAB_D, SLAB_CH, DSH);
  const S = slabPanel(K, D);
  for (const [a, b] of [[-0.47, -0.185], [0.47, -0.185], [-0.47, 0.175], [0.47, 0.175]]) S.stud(a, b, 0.006, 0.006, 0.004, POD.billet, 0.05);
  // The heading tape's window across the brow, the readout's frame to its right and the builder's
  // tag to its left.
  S.rect(TAPE.a0 - 0.007, TAPE.b0 - 0.005, TAPE.a1 + 0.007, TAPE.b1 + 0.005, POD.billet, 0.05, 0.0015);
  S.rect(TAPE.a0, TAPE.b0, TAPE.a1, TAPE.b1, POD.crt, 0.05, 0.002);
  S.rect(HDG.a0, HDG.b0, HDG.a1, HDG.b1, POD.billet, 0.05, 0.0015);
  S.rect(HDG.a0 + 0.003, HDG.b0 + 0.003, HDG.a1 - 0.003, HDG.b1 - 0.003, POD.black, 0.02, 0.002);
  S.rect(-HDG.a1, HDG.b0, -HDG.a0, HDG.b1, POD.billet, 0.05, 0.0015);
  S.rect(-HDG.a1 + 0.003, HDG.b0 + 0.003, -HDG.a0 - 0.003, HDG.b1 - 0.003, POD.black, 0.02, 0.002);
  S.fitText('DEADLEG', -(HDG.a0 + HDG.a1) / 2, 0.189, 0.06, 0.009, POD.gold, 0.3, 0.003);
  S.fitText('SALVAGE', -(HDG.a0 + HDG.a1) / 2, 0.174, 0.06, 0.009, POD.gold, 0.3, 0.003);
  // The nameplate along the foot: black anodised in a billet frame.
  S.rect(PLATE.a0, PLATE.b0, PLATE.a1, PLATE.b1, POD.billet, 0.05, 0.0015);
  S.rect(PLATE.a0 + 0.006, PLATE.b0 + 0.004, PLATE.a1 - 0.006, PLATE.b1 - 0.004, POD.black, 0.02, 0.002);
  // The screen's billet frame and black surround, the dials' and the G-meter's bezels.
  bevel(K, S, SCREEN.a0 - 0.012, SCREEN.b0 - 0.012, SCREEN.a1 + 0.012, SCREEN.b1 + 0.008, 0.004, 0.004, C.black);
  for (const s of [-1, 1]) S.torus(s * DIAL.a, DIAL.b, DIAL.R * 1.04, DIAL.R * 1.24, POD.billet, 0.05, 0.006, 32, 3);
  S.torus(GM.a, GM.b, GM.R * 1.04, GM.R * 1.24, POD.billet, 0.05, 0.005, 28, 3);
  // The ladders' frames.
  for (const s of [-1, 1]) S.rect(s * LADDER.a - 0.02, LADDER.b0 - 0.008, s * LADDER.a + 0.02, LADDER.b1 + 0.008, POD.billet, 0.05, 0.002);
  // The buttons' rings and the boost's cover hinge.
  for (const p of [BTN.ign, BTN.brake, BTN.boost]) S.torus(p[0], p[1], 0.024, 0.031, POD.billet, 0.05, 0.004, 24, 3);

  // The throttle quadrant: a carbon box with billet edges; two slots; FULL forward, IDLE aft.
  const qx = 0.17, qy0 = Q.y - 0.10, qy1 = Q.y + 0.10, qz0 = Q.z - 0.14;
  K.box(-qx, qy0, qz0, qx, qy1, Q.z, 'dash', 0.3, DSH, 0);
  for (const [a, b] of [[[-qx, qy0, Q.z], [qx, qy0, Q.z]], [[-qx, qy1, Q.z], [qx, qy1, Q.z]], [[-qx, qy0, Q.z], [-qx, qy1, Q.z]], [[qx, qy0, Q.z], [qx, qy1, Q.z]]]) {
    K.rod(a, b, 0.006, 'dash', 0.2, POD.billet, 0.05, 8);
  }
  const T = quadPanel(K);
  for (const s of [-1, 1]) T.rect(s * Q.slot - 0.008, -0.085, s * Q.slot + 0.008, 0.085, C.black, 0, 0.002);
  contactShadow(K, [0, Q.y, qz0], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.22, 0.14);
}

// ── What the kit puts in the pod, built once per fit ────────────────────────
// A label on a flat top, read from the seat: its `right` across the line of sight, its `up` away.
function flatLabel(K, o) {
  const d = unit([o[0], o[1], 0]);
  return K.panel(o, [d[1], -d[0], 0], d, 'pil', 0.2);
}
// A label on the side of an upright cylinder at (x, y), turned to the eye.
function bottleLabel(K, x, y, r, z) {
  const hv = unit([-x, -y, 0]);
  return K.panel([x + hv[0] * (r + 0.0015), y + hv[1] * (r + 0.0015), z], [-hv[1], hv[0], 0], [0, 0, 1], 'pil', 0.2);
}
function kitParts(K, engine, boost, cooling) {
  // ── The injector bottles: upright in a billet rack aft of the right console, one more per tier,
  // braided lines up to a manifold on the console and on forward under the dash.
  const nb = boost > 0 ? boost + 1 : 0;
  if (nb) {
    const { x, r, z0, z1 } = BOTTLE, ys = Array.from({ length: nb }, (_, i) => BOTTLE.y0 + i * BOTTLE.dy);
    const yA = ys[0] - 0.045, yB = ys[nb - 1] + 0.045;
    K.box(x - 0.045, yA, FLOOR, x + 0.045, yB, FLOOR + 0.012, 'pil', 0.2, POD.billet, 0.03);
    for (const z of [z0 + 0.06, z1 - 0.08]) K.box(x + 0.036, yA, z - 0.008, x + 0.044, yB, z + 0.008, 'pil', 0.2, POD.billet, 0.03);
    const man = [x - 0.005, CON.y0 + 0.07, CON.top + 0.018];
    K.box(x - 0.045, CON.y0 + 0.03, CON.top, x + 0.035, CON.y0 + 0.11, CON.top + 0.036, 'pil', 0.2, POD.billet, 0.05);
    for (const y of ys) {
      K.rod([x, y, z0], [x, y, z1 - 0.035], r, 'pil', 0.2, POD.injector, 0, 16);
      K.rod([x, y, z1 - 0.035], [x, y, z1 - 0.012], r * 0.62, 'pil', 0.2, POD.injector, 0, 12);
      K.rod([x, y, z1 - 0.012], [x, y, z1 + 0.018], 0.011, 'pil', 0.2, POD.billet, 0.05, 10);
      K.rod([x - 0.016, y, z1 + 0.018], [x + 0.016, y, z1 + 0.018], 0.006, 'pil', 0.2, POD.anod, 0.1, 8);
      for (const z of [z0 + 0.06, z1 - 0.08]) K.torus([x, y, z], [1, 0, 0], [0, 1, 0], r + 0.003, 0.004, 16, 'pil', 0.2, POD.billet, 0.05);
      K.rod([x, y, z1 + 0.018], [x, y, z1 + 0.055], 0.006, 'pil', 0.2, POD.loom, 0, 6);
      K.rod([x, y, z1 + 0.055], [man[0], CON.y0 + 0.03, man[2]], 0.006, 'pil', 0.2, POD.loom, 0, 6);
      // The bottle's band: what is in it, and the tier.
      const B = bottleLabel(K, x, y, r, (z0 + z1) / 2);
      B.rect(-0.017, -0.03, 0.017, 0.03, C.paper, 0.05, 0);
      B.text('INJ', 0, 0.012, 0.012, POD.black, 0.1, 0.0008);
      B.text(String(boost), 0, -0.012, 0.016, POD.anod, 0.2, 0.0008);
    }
    K.rod([man[0], CON.y0 + 0.11, man[2]], [man[0], 0.60, man[2]], 0.007, 'pil', 0.2, POD.loom, 0, 6);
    K.rod([man[0], 0.60, man[2]], [0.40, 0.64, -0.76], 0.007, 'pil', 0.2, POD.loom, 0, 6);
    const F = consoleFace(K, 1);
    F.fitText('INJECTORS', 0, 0.018, 0.30, 0.026, POD.ink, 0.15, 0.0008);
    F.fitText(KIT_TIERS[boost], 0, -0.022, 0.30, 0.022, C.amber, 0.4, 0.0008);
  } else {
    const F = consoleFace(K, 1);
    F.grille(-0.18, -0.06, 0.18, 0.06, 7, POD.black);
  }
  // ── The coolant reservoir: an upright billet can on the left console with a sight glass, teed
  // into the wall's copper, and a blue hose more down the wall for each tier.
  if (cooling > 0) {
    const x = -0.495, y = 0.33, r = 0.04, zb = CON.top, zt = CON.top + 0.16;
    K.rod([x, y, zb], [x, y, zt], r, 'pil', 0.2, POD.billet, 0.05, 16);
    for (const z of [zb + 0.012, zt - 0.012]) K.rod([x, y, z - 0.008], [x, y, z + 0.008], r + 0.004, 'pil', 0.2, POD.anod, 0.1, 16);
    K.rod([x, y, zt], [x, y, zt + 0.02], 0.016, 'pil', 0.2, POD.anod, 0.1, 10);
    K.rod([x, y, zt - 0.03], [-(WALL - 0.045), y, -0.625], 0.008, 'pil', 0.2, POD.hose, 0, 8);
    const G = bottleLabel(K, x, y, r, (zb + zt) / 2);
    G.rect(-0.009, -0.06, 0.009, 0.06, POD.crt, 0.1, 0);
    G.rect(-0.006, -0.057, 0.006, 0.02 + 0.012 * cooling, POD.coolant, 0.5, 0.0006);
    for (let k = 0; k < 5; k++) G.rect(0.009, -0.05 + k * 0.025, 0.015, -0.048 + k * 0.025, POD.ink, 0.1, 0.0006);
    for (let k = 0; k < cooling; k++) {
      const z = FLOOR + 0.12 + k * 0.03;
      K.rod([-(WALL - 0.045), AFT + 0.1, z], [-(WALL - 0.045), CON.y0, z], 0.011, 'pil', 0.2, POD.hose, 0, 8);
    }
    const F = consoleFace(K, -1);
    F.fitText('COOLING', 0, 0.018, 0.30, 0.026, POD.ink, 0.15, 0.0008);
    F.fitText(KIT_TIERS[cooling], 0, -0.022, 0.30, 0.022, POD.coolant, 0.4, 0.0008);
  } else {
    const F = consoleFace(K, -1);
    F.grille(-0.18, -0.06, 0.18, 0.06, 7, POD.black);
  }
  // ── The tuner: a black box on the left console, its stage on its lid, a green light and a loom
  // forward under the dash.
  if (engine > 0) {
    K.box(-0.56, 0.42, CON.top, -0.46, 0.54, CON.top + 0.035, 'pil', 0.2, POD.black, 0.02);
    K.rod([-0.47, 0.54, CON.top + 0.018], [-0.40, 0.64, -0.76], 0.006, 'pil', 0.2, POD.loom, 0, 6);
    const T = flatLabel(K, [-0.51, 0.48, CON.top + 0.0355]);
    T.fitText('STAGE ' + engine, 0, 0.012, 0.085, 0.015, POD.gold, 0.3, 0.0005);
    T.fitText('TURBINE TUNE', 0, -0.012, 0.085, 0.0095, POD.ink, 0.15, 0.0005);
    T.disc(0.038, 0.012, 0.005, POD.led, 0.9, 0.0008, 8);
  }
}

// ── The build sheet, riveted to the right wall: what the yard fitted ────────
function buildSheet(K, lines) {
  const { y0, y1, z0, z1, x } = SHEET, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2, W = y1 - y0, H = z1 - z0;
  K.box(x, y0, z0, WALL, y1, z1, 'pil', 0.2, POD.billet, 0.03);
  const P = K.panel([x - 0.0005, cy, cz], [0, -1, 0], [0, 0, 1], 'pil', 0.2);
  P.rect(-W / 2 + 0.006, -H / 2 + 0.006, W / 2 - 0.006, H / 2 - 0.006, POD.black, 0.02, 0.0006);
  for (const a of [-W / 2 + 0.012, W / 2 - 0.012]) for (const b of [-H / 2 + 0.012, H / 2 - 0.012]) P.disc(a, b, 0.004, POD.rivet, 0.05, 0.0012, 8);
  // The head sits well down the plate: from the seat the bolster and the light strip under it hide
  // the top of it.
  P.fitText('BUILD SHEET', 0, H / 2 - 0.046, W - 0.05, 0.015, POD.gold, 0.35, 0.0012);
  P.rect(-W / 2 + 0.02, H / 2 - 0.059, W / 2 - 0.02, H / 2 - 0.057, POD.gold, 0.2, 0.0012);
  if (!lines.length) {
    P.fitText('FACTORY SPEC', 0, -0.018, W - 0.05, 0.016, POD.ink, 0.25, 0.0012);
    P.fitText('NOTHING FITTED', 0, -0.042, W - 0.05, 0.011, POD.phosDim, 0.2, 0.0012);
    return;
  }
  // One column for a short list, two for a long one, each with a gutter. The part and its tier are
  // each set flush left in their own share of the column, each shrunk only as far as it must be to fit, and
  // every other row has a faint band behind it so a row reads across from the seat's slant.
  const cols = lines.length > 5 ? 2 : 1, rows = Math.ceil(Math.min(lines.length, 12) / cols);
  const gut = 0.016, colW = (W - 0.024 - gut * (cols - 1)) / cols;
  const top = H / 2 - 0.066, bot = -H / 2 + 0.009, rowH = Math.min(cols > 1 ? 0.0165 : 0.021, (top - bot) / rows);
  const th = Math.min(cols > 1 ? 0.0105 : 0.013, rowH * 0.66);
  const flush = (str, a, maxW, b, rgb, emis) => {
    const w = Math.min(legendWidth(str, th), maxW);
    P.fitText(str, a + w / 2, b, maxW, th, rgb, emis, 0.0014);
  };
  lines.slice(0, 12).forEach(([label, tier, short], i) => {
    const col = Math.floor(i / rows), row = i % rows;
    const a0 = -W / 2 + 0.012 + col * (colW + gut), a1 = a0 + colW, b = top - (row + 0.5) * rowH;
    if (row % 2 === 0) P.rect(a0 - 0.003, b - rowH / 2, a1 + 0.003, b + rowH / 2, [36, 38, 46], 0.08, 0.001);
    const name = cols > 1 ? short : label;
    if (!tier) { flush(name, a0, colW, b, POD.gold, 0.3); return; }
    flush(name, a0, colW * 0.58, b, POD.ink, 0.2);
    flush(tier, a0 + colW * 0.62, colW * 0.38, b, tier === 'PRO' ? C.red : tier === 'RACE' ? C.amber : POD.phos, 0.4);
  });
}

// ── The screen: a touchscreen, live ─────────────────────────────────────────
// Dark teal glass in a billet frame. Cold, it says what to do. Lit: the speed and both turbines' heat
// across the top, the craft from above in the middle (turbines coloured by their health, the cables
// in their load colours, the binder crawling between the turbines, a red cross once it has gone),
// the state of things down either side, and the soft-keys along the foot.
function gui(S, L, on) {
  const { a0, a1, b0, b1 } = SCREEN, l = 0.0045;
  const t = (L.t || 0) / 1000, blink = Math.sin(t * 18) > 0;
  S.rect(a0, b0, a1, b1, POD.crt, on ? 0.5 : 0.04, l);
  // A sliver of window light on the glass's top corner, clear of every readout.
  S.plate([[a1 - 0.05, b1 - 0.003], [a1 - 0.012, b1 - 0.003], [a1 - 0.03, b1 - 0.012], [a1 - 0.062, b1 - 0.012]], POD.glint, 1, l + 0.004);
  if (!on) {
    if (L.binder === false) {
      // It cannot start, so it does not say to: it says why, and which key gets you home.
      S.text('BINDER TORN OUT', 0, 0.04, 0.013, (Math.sin(t * 6) > 0) ? C.red : [150, 40, 30], 1, l + 0.001);
      S.text('TURBINES WILL NOT LIGHT', 0, 0.014, 0.0085, POD.phosDim, 0.7, l + 0.001);
      S.text('TOW CALLS THE FLATBED', 0, -0.006, 0.0085, POD.phos, 0.9, l + 0.001);
    } else S.text('PRESS START', 0, 0.02, 0.012, POD.phosDim, 0.5, l + 0.001);
    keys(S, L, false);
    return;
  }
  const P = POD.phos, D = POD.phosDim, L1 = l + 0.0008, L2 = l + 0.0016;
  // ── The top: speed, and heat ──
  const mph = Math.max(0, Math.min(999, Math.round(L.speed || 0)));
  S.digits(a0 + 0.012, 0.1, 0.032, String(mph).padStart(3, ' '), P, false);
  S.text('MPH', -0.072, 0.106, 0.009, D, 0.8, L1);
  const heat = L.heat || [0, 0];
  [0, 1].forEach((i) => {
    const b = 0.128 - i * 0.018, h = clamp(heat[i] || 0, 0, 1);
    const col = h > 0.85 ? (blink ? C.red : C.amber) : h > 0.6 ? C.amber : P;
    S.text(i ? 'R' : 'L', 0.012, b, 0.008, D, 0.8, L1);
    S.rect(0.022, b - 0.004, 0.155, b + 0.004, [10, 34, 28], 0.4, L1);
    if (h > 0.01) S.rect(0.022, b - 0.004, 0.022 + 0.133 * h, b + 0.004, col, 1, L2);
  });
  S.text('HEAT', 0.05, 0.137, 0.007, D, 0.8, L1);
  stroke(S, a0 + 0.006, 0.093, a1 - 0.006, 0.093, 0.0012, D, 0.9, L1);
  stroke(S, a0 + 0.006, -0.062, a1 - 0.006, -0.062, 0.0012, D, 0.9, L1);
  // ── The middle: the craft from above, on a faint grid ──
  for (const x of [-0.04, 0, 0.04]) stroke(S, x, -0.058, x, 0.088, 0.0008, [18, 62, 48], 0.8, L1);
  for (const y of [-0.03, 0.01, 0.05]) stroke(S, -0.055, y, 0.055, y, 0.0008, [18, 62, 48], 0.8, L1);
  craft(S, L, 0, 0.012, L2, t, blink);
  // ── The sides: the state of things ──
  const strained = (L.binderStrain || 0) > 0.08;
  const binderTxt = L.binder === false ? 'TORN' : L.mode === 'docked' ? 'DOCKED' : L.mode === 'docking' ? 'DOCKING'
    : strained ? 'STRAIN' : (L.binderPower ?? 1) < 0.3 ? 'IDLE' : 'OK';
  const binderCol = L.binder === false ? (blink ? C.red : [120, 30, 24]) : strained ? C.amber : P;
  S.text('BINDER', -0.11, 0.072, 0.0085, D, 0.8, L1);
  S.text(binderTxt, -0.11, 0.058, 0.011, binderCol, 1, L2);
  S.text('POD', -0.13, 0.03, 0.0085, D, 0.8, L1);
  S.text(String(Math.round((L.hull ?? 1) * 100)), -0.088, 0.03, 0.0095, (L.hull ?? 1) < 0.3 ? C.red : P, 1, L2);
  S.text('FUEL', -0.13, 0.008, 0.0085, D, 0.8, L1);
  S.text(String(Math.round((L.fuel ?? 1) * 100)), -0.088, 0.008, 0.0095, (L.fuel ?? 1) < 0.2 ? C.red : P, 1, L2);
  S.text('WHIP', 0.11, 0.072, 0.0085, D, 0.8, L1);
  const w = clamp(L.whipping ? 1 : (L.whip || 0), 0, 1);
  S.rect(0.068, 0.054, 0.152, 0.062, [10, 34, 28], 0.4, L1);
  if (w > 0.01) S.rect(0.068, 0.054, 0.068 + 0.084 * w, 0.062, L.whipping ? C.lampOn : w >= 0.6 ? C.green : C.amber, 1, L2);
  S.text('BOOST', 0.11, 0.03, 0.0095, L.boosting ? C.red : [40, 70, 60], L.boosting ? 1 : 0.5, L2);
  // In reverse the slide's line says so: the slide does nothing going astern.
  if (L.reversing) S.text('REVERSE', 0.11, 0.008, 0.0095, C.blue, 1, L2);
  else S.text('SLIDE', 0.11, 0.008, 0.0095, L.sliding ? C.amber : [40, 70, 60], L.sliding ? 1 : 0.5, L2);
  keys(S, L, true);
}

// The craft from above, centred on (a, b) of the screen.
function craft(S, L, a, b, l, t, blink) {
  const eng = L.eng || [1, 1], heat = L.heat || [0, 0];
  const tb = [[-0.03, 0.034], [0.03, 0.034]];
  tb.forEach(([ta, tbb], i) => {
    const hot = (heat[i] || 0) > 0.85;
    const col = eng[i] <= 0 ? C.red : hot ? (blink ? C.red : C.amber) : eng[i] < 0.5 ? C.amber : POD.phos;
    S.rect(a + ta - 0.009, b + tbb - 0.024, a + ta + 0.009, b + tbb + 0.024, col, 1, l);
    S.rect(a + ta - 0.005, b + tbb + 0.017, a + ta + 0.005, b + tbb + 0.022, POD.crt, 0.3, l + 0.0005);
  });
  S.rect(a - 0.011, b - 0.068, a + 0.011, b - 0.036, POD.phos, 1, l);
  const ten = L.tension || [0, 0], cab = L.cable || [true, true];
  tb.forEach(([ta, tbb], i) => {
    const x0 = a + ta * 0.6, y0 = b + tbb - 0.024, x1 = a, y1 = b - 0.036;
    if (!cab[i]) { stroke(S, x0, y0, x0 + (x1 - x0) * 0.3, y0 + (y1 - y0) * 0.3, 0.002, C.red, 1, l); return; }
    const f = clamp((ten[i] || 0) / 400, 0, 1);
    stroke(S, x0, y0, x1, y1, 0.0022, f > 0.75 ? C.red : f > 0.35 ? C.amber : POD.phos, 1, l);
  });
  const x0 = a - 0.021, x1 = a + 0.021, yb = b + 0.042;
  if (L.binder === false) {
    stroke(S, a - 0.008, yb - 0.008, a + 0.008, yb + 0.008, 0.0025, C.red, 1, l + 0.0005);
    stroke(S, a - 0.008, yb + 0.008, a + 0.008, yb - 0.008, 0.0025, C.red, 1, l + 0.0005);
    return;
  }
  const strain = clamp((L.binderStrain || 0) * 6, 0, 1), amp = 0.004 + 0.008 * strain;
  let seed = Math.floor(t * 20) * 2654435761 >>> 0;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 - 0.5; };
  // The arc in the binder's own colour (the yard's `arc` choice), so the scope matches what is out front.
  const arc = Array.isArray(L.arcRgb) && L.arcRgb.length === 3 && L.arcRgb.every(Number.isFinite) ? L.arcRgb : POD.arc;
  const N = 6, col = strain > 0.5 ? C.amber : arc;
  let pa = x0, pb = yb;
  for (let i = 1; i <= N; i++) {
    const na = x0 + (x1 - x0) * i / N, nb = yb + (i < N ? rnd() * 2 * amp : 0);
    stroke(S, pa, pb, na, nb, 0.0018, col, 1, l + 0.0005);
    pa = na; pb = nb;
  }
}

// The soft-keys: a lit tile each with a pictogram and its name, brighter under the pointer and
// pressed in under a click. TOW is dimmed until the racer has stopped, because the flatbed will not
// chase you.
function keys(S, L, on) {
  const l = 0.0055;
  for (const k of KEYS) {
    const a = k.a, b = KEY_B;
    const live = on || k.id === 'gui:help' || k.id === 'gui:exit' || k.id === 'gui:tow';
    const able = live && (k.id !== 'gui:tow' || (L.speed || 0) < 5) && (k.id !== 'gui:dock' || L.binder !== false);
    const label = k.id === 'gui:dock' ? (L.mode === 'launched' ? 'DOCK' : 'LAUNCH') : k.label;
    const hot = L.hover === k.id, pressed = L.press === k.id;
    const bg = pressed ? POD.phos : hot ? POD.keyHot : POD.key;
    S.rect(a - KEY_HA, b - KEY_HB, a + KEY_HA, b + KEY_HB, bg, able ? (pressed ? 1 : 0.6) : 0.15, l);
    const ink = pressed ? POD.crt : able ? POD.phos : POD.phosDim, e = able ? 1 : 0.4, L1 = l + 0.0008;
    for (const [p, q] of [[[a - KEY_HA, b - KEY_HB], [a + KEY_HA, b - KEY_HB]], [[a + KEY_HA, b - KEY_HB], [a + KEY_HA, b + KEY_HB]],
      [[a + KEY_HA, b + KEY_HB], [a - KEY_HA, b + KEY_HB]], [[a - KEY_HA, b + KEY_HB], [a - KEY_HA, b - KEY_HB]]]) {
      stroke(S, p[0], p[1], q[0], q[1], 0.0012, able ? POD.phosDim : [24, 60, 48], 0.9, L1);
    }
    const ib = b + 0.007;
    if (k.id === 'gui:cam') {
      S.rect(a - 0.011, ib - 0.006, a + 0.011, ib + 0.007, ink, e, L1);
      S.rect(a - 0.004, ib + 0.007, a + 0.004, ib + 0.01, ink, e, L1);
      S.disc(a, ib, 0.0045, bg, 0.5, L1 + 0.0006, 12);
    } else if (k.id === 'gui:dock') {
      // Two chevrons: up to launch, down to dock.
      const d = L.mode === 'launched' ? -1 : 1;
      for (const o of [-0.0035, 0.0045]) {
        stroke(S, a - 0.008, ib + o * 1 - d * 0.003, a, ib + o + d * 0.004, 0.0022, ink, e, L1);
        stroke(S, a + 0.008, ib + o * 1 - d * 0.003, a, ib + o + d * 0.004, 0.0022, ink, e, L1);
      }
    } else if (k.id === 'gui:help') {
      S.annulus(a, ib, 0.007, 0.0095, ink, e, L1, 16);
      S.text('I', a, ib, 0.0085, ink, e, L1 + 0.0004);
    } else if (k.id === 'gui:tow') {
      S.rect(a - 0.015, ib - 0.004, a + 0.004, ib + 0.001, ink, e, L1);
      S.rect(a + 0.005, ib - 0.004, a + 0.014, ib + 0.008, ink, e, L1);
      S.disc(a - 0.009, ib - 0.006, 0.003, ink, e, L1 + 0.0004, 10);
      S.disc(a + 0.009, ib - 0.006, 0.003, ink, e, L1 + 0.0004, 10);
      stroke(S, a - 0.015, ib + 0.001, a - 0.004, ib + 0.009, 0.0016, ink, e, L1);
    } else {
      stroke(S, a, ib - 0.006, a, ib + 0.004, 0.0028, ink, e, L1);
      S.plate([[a - 0.007, ib + 0.003], [a + 0.007, ib + 0.003], [a, ib + 0.011]], ink, e, L1);
    }
    S.text(label, a, b - 0.012, 0.0072, ink, e, L1);
  }
}

// ── The heading tape, live ──────────────────────────────────────────────────
// The pod's heading on a tape that slides under a fixed lubber line: a tick every five degrees, a
// number every ten (the tens, as on any tape) and the cardinal letters in amber; the three-digit
// heading in its own window to the right. Lit off the same bus as the screen.
const pad3 = (n) => String(n).padStart(3, '0');
function headingTape(S, L, on) {
  const { a0, a1, b0, b1, degW } = TAPE, l = 0.0045;
  const hdg = ((Number(L.heading) || 0) % 360 + 360) % 360;
  const ink = on ? POD.phos : POD.phosDim, e = on ? 1 : 0.3;
  const span = (a1 - a0) / 2 - 0.004;
  for (let d = Math.ceil((hdg - span / degW) / 5) * 5; (d - hdg) * degW <= span; d += 5) {
    const a = (d - hdg) * degW, w = ((d % 360) + 360) % 360, big = w % 10 === 0;
    stroke(S, a, b0 + 0.002, a, b0 + (big ? 0.012 : 0.007), big ? 0.0016 : 0.0011, ink, e, l);
    if (big && Math.abs(a) < span - 0.01) {
      const card = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[w];
      S.text(card || String(w / 10), a, b0 + 0.0225, card ? 0.012 : 0.0095, card ? (on ? C.amber : POD.phosDim) : ink, e, l);
    }
  }
  S.plate([[-0.0055, b0 - 0.0005], [0.0055, b0 - 0.0005], [0, b0 + 0.008]], C.amber, on ? 1 : 0.3, l + 0.0012);
  stroke(S, 0, b1 - 0.0045, 0, b1 + 0.0005, 0.0018, C.amber, on ? 1 : 0.3, l + 0.0012);
  // The readout: the heading in three digits, HDG over it.
  S.text('HDG', (HDG.a0 + HDG.a1) / 2, HDG.b1 - 0.0075, 0.0075, on ? POD.inkLit : POD.ink, on ? 0.6 : 0.2, 0.003);
  S.digits(HDG.a0 + 0.0125, HDG.b0 + 0.0055, 0.019, on ? pad3(Math.round(hdg) % 360) : '---', on ? POD.phos : POD.phosDim, true);
}

// ── The G-meter, live ───────────────────────────────────────────────────────
// A friction circle: rings at one and two g, a dot at the pod's lateral (right positive) and
// longitudinal (forward positive) acceleration, amber past one and a half. Its name under it reads
// the total while the turbines are lit.
function gMeter(S, L, on, ink, glow) {
  const { a, b, R } = GM, l = 0.0045;
  S.disc(a, b, R, POD.crt, on ? 0.45 : 0.04, l, 22);
  const D = on ? POD.phosDim : [20, 50, 40];
  S.annulus(a, b, R * 0.47, R * 0.52, D, 0.8, l + 0.0006, 20);
  S.annulus(a, b, R * 0.93, R * 0.98, D, 0.8, l + 0.0006, 22);
  stroke(S, a - R * 0.95, b, a + R * 0.95, b, 0.0009, D, 0.8, l + 0.0006);
  stroke(S, a, b - R * 0.95, a, b + R * 0.95, 0.0009, D, 0.8, l + 0.0006);
  let gx = clamp(Number(L.gLat) || 0, -2.5, 2.5) / 2, gy = clamp(Number(L.gLong) || 0, -2.5, 2.5) / 2;
  const m = Math.hypot(gx, gy);
  if (m > 1) { gx /= m; gy /= m; }
  if (on) S.disc(a + gx * R * 0.95, b + gy * R * 0.95, R * 0.13, m > 0.75 ? C.amber : POD.phos, 1, l + 0.0014, 10);
  const by = b - R * 1.24 - 0.008, h = 0.0085;
  if (!on) { S.fitText('G METER', a, by, 0.07, h, ink, glow, 0.004); return; }
  // The total, to a tenth. The legend face has no full stop, so the point is a dot of its own.
  const [whole, tenth] = Math.min(9.9, Math.hypot(Number(L.gLat) || 0, Number(L.gLong) || 0)).toFixed(1).split('.');
  const w1 = legendWidth(whole, h), w2 = legendWidth(tenth + ' G', h), gap = h * 0.45, a0 = a - (w1 + gap + w2) / 2;
  S.text(whole, a0 + w1 / 2, by, h, ink, glow, 0.004);
  S.disc(a0 + w1 + gap / 2, by - h * 0.42, h * 0.11, ink, glow, 0.004, 6);
  S.text(tenth + ' G', a0 + w1 + gap + w2 / 2, by, h, ink, glow, 0.004);
}

// ── The dash, live ──────────────────────────────────────────────────────────
function dashLive(K, L, on) {
  const D = dashPanel(K), S = slabPanel(K, D);
  // A blue light line along the top of the dash, the colour of the strips under the bolsters.
  K.rod(D.pt(-0.53, 0.229, 0.004), D.pt(0.53, 0.229, 0.004), 0.0028, 'dash', 0.2, INSIDE.strip[insideOf(L).strip], on ? 0.9 : 0.12, 6);
  const ink = on ? POD.inkLit : POD.ink, glow = on ? 0.8 : 0.15;
  engraveText(S, String(L.typeName || 'Rasp Twinspool').toUpperCase(), 0, (PLATE.b0 + PLATE.b1) / 2, 0.016, POD.gold, POD.cut, 0.004, on ? 0.5 : 0.2);
  gui(S, L, on);
  headingTape(S, L, on);
  gMeter(S, L, on, ink, glow);

  // The turbines: revs on the long needle, heat on the short amber one, the red past nine tenths.
  const rpm = L.rpm || [0, 0], eng = L.eng || [1, 1], heat = L.heat || [0, 0];
  [[-1, 'L TURB', 0], [1, 'R TURB', 1]].forEach(([s, name, i]) => {
    const a = s * DIAL.a, b = DIAL.b, R = DIAL.R;
    S.dial(a, b, R, clamp(rpm[i] || 0, 0, 1), {
      ticks: 10, major: 2, red: 0.9, name, bezel: POD.billet, face: on ? [30, 24, 20] : C.face, tick: ink, label: ink,
      arcs: [[0.7, 0.9, [130, 90, 40]]],
      frac2: clamp(heat[i] || 0, 0, 1), needle2: (heat[i] || 0) > 0.85 ? C.red : C.amber,
      needle: eng[i] > 0 ? C.lampOn : C.red,
    });
    if (on) S.disc(a, b, R * 0.96, POD.glow, 1, 0.0035, 20);
    S.annulus(a, b, R * 0.55, R * 1.0, POD.glint, 1, 0.016, 8, Math.PI * 0.55, Math.PI * 0.95);
  });

  // The cables' ladders: eight segments each, green to amber to red.
  const ten = L.tension || [0, 0], cab = L.cable || [true, true];
  const SEG = [C.green, C.green, C.green, C.amber, C.amber, C.amber, C.red, C.red];
  [[-1, 'CBL L', 0], [1, 'CBL R', 1]].forEach(([s, name, i]) => {
    const a = s * LADDER.a, f = cab[i] ? clamp((ten[i] || 0) / 400, 0, 1) : 0;
    const lit = Math.round(f * LADDER.n), h = (LADDER.b1 - LADDER.b0) / LADDER.n;
    S.rect(a - 0.016, LADDER.b0 - 0.004, a + 0.016, LADDER.b1 + 0.004, C.black, 0, 0.003);
    for (let k = 0; k < LADDER.n; k++) {
      const on1 = k < lit, rgb = !cab[i] ? (k === 0 ? C.red : C.lampOff) : SEG[k];
      S.rect(a - 0.012, LADDER.b0 + k * h + h * 0.15, a + 0.012, LADDER.b0 + (k + 1) * h - h * 0.15, on1 || (!cab[i] && k === 0) ? rgb : rgb.map((c) => c * 0.14), on1 ? 1 : 0, 0.006);
    }
    S.fitText(name, a, LADDER.b0 - 0.02, 0.05, 0.0085, ink, 0.35, 0.004);
  });


  // The tell-tales: a cut cable, a hot turbine, the binder, the boost and the slide.
  const t = (L.t || 0) / 1000, blink = Math.sin(t * 18) > 0;
  S.lamp(-0.34, -0.06, 0.016, 0.009, !cab[0], C.red, 'L CUT');
  S.lamp(-0.24, -0.06, 0.016, 0.009, (heat[0] || 0) > 0.85 && blink, C.red, 'L HOT');
  S.lamp(0.24, -0.06, 0.016, 0.009, (heat[1] || 0) > 0.85 && blink, C.red, 'R HOT');
  S.lamp(0.34, -0.06, 0.016, 0.009, !cab[1], C.red, 'R CUT');
  const strained = (L.binderStrain || 0) > 0.08;
  S.lamp(0, -0.13, 0.03, 0.009, true, L.binder === false ? C.red : strained ? C.amber : on ? C.blue : [50, 70, 100], L.binder === false ? 'BINDER GONE' : 'BINDER');
  // SLIDE is amber while you slide and goes green once the whip is charged enough to be worth letting go.
  S.lamp(-0.10, -0.13, 0.02, 0.009, !!L.sliding || !!L.whipping, L.whipping || (L.whip || 0) >= 0.6 ? C.green : C.amber, 'SLIDE');
  S.lamp(0.10, -0.13, 0.02, 0.009, !!L.boosting, C.red, 'BOOST');

  // Fuel and the pod's own condition, bottom left.
  S.bar(-0.45, -0.20, -0.08, 0.01, clamp(L.fuel ?? 1, 0, 1), (L.fuel ?? 1) < 0.2 ? C.red : C.amber, 'FUEL');
  S.bar(-0.39, -0.20, -0.08, 0.01, clamp(L.hull ?? 1, 0, 1), (L.hull ?? 1) < 0.3 ? C.red : C.green, 'POD');

  // START, BRAKE and BOOST, bottom right: domed buttons in billet rings. START is lit off the
  // battery so a cold pod shows it. BOOST sits under a red flip cover, held open.
  const press = L.press;
  domeButton(K, S, ...BTN.ign, 0.018, 0.022, on ? [60, 170, 90] : [200, 70, 50], on ? 0.4 : 0.8, press === 'ign');
  S.text(on ? 'STOP' : 'START', BTN.ign[0], BTN.ign[1] - 0.045, 0.012, ink, 0.6, 0.004);
  domeButton(K, S, ...BTN.brake, 0.018, 0.022, L.brake ? [255, 190, 80] : [170, 120, 40], L.brake ? 0.9 : 0.2, !!L.brake || press === 'brake');
  S.text('BRAKE', BTN.brake[0], BTN.brake[1] - 0.045, 0.012, ink, glow, 0.004);
  domeButton(K, S, ...BTN.boost, 0.018, 0.022, L.boosting ? [255, 90, 60] : [150, 40, 30], L.boosting ? 1 : 0.25, !!L.boosting || press === 'boost');
  S.text('BOOST', BTN.boost[0], BTN.boost[1] - 0.045, 0.012, ink, glow, 0.004);
  {
    // The cover, hinged along the top of the ring and swung up off the face.
    const [a, b] = BTN.boost, hb = b + 0.032;
    const h0 = S.pt(a - 0.03, hb, 0.006), h1 = S.pt(a + 0.03, hb, 0.006);
    const up = S.u, n = S.n, lift = 0.05;
    const e0 = [h0[0] + n[0] * lift + up[0] * 0.012, h0[1] + n[1] * lift + up[1] * 0.012, h0[2] + n[2] * lift + up[2] * 0.012];
    const e1 = [h1[0] + n[0] * lift + up[0] * 0.012, h1[1] + n[1] * lift + up[1] * 0.012, h1[2] + n[2] * lift + up[2] * 0.012];
    K.face([h0, h1, e1, e0], unit(cross(sub(h1, h0), sub(e0, h0))), 'dash', 0.3, POD.anod, 0.05);
    K.rod(h0, h1, 0.004, 'dash', 0.2, POD.billet, 0.05, 6);
    for (const [p, q] of [[h0, e0], [h1, e1]]) K.rod(p, q, 0.0025, 'dash', 0.2, POD.anod, 0.05, 4);
  }
}

// ── The levers: T-grips that twist as you steer ─────────────────────────────
function levers(K, L, on) {
  const ink = on ? POD.inkLit : POD.ink, glow = on ? 0.8 : 0.15;
  const T = quadPanel(K);
  T.text('FULL', 0, 0.07, 0.014, ink, glow, 0.003);
  T.text('IDLE', 0, -0.075, 0.014, ink, glow, 0.003);
  T.text('L', -0.135, 0, 0.018, ink, glow, 0.003);
  T.text('R', 0.135, 0, 0.018, ink, glow, 0.003);
  const lev = L.lever || [0, 0], steer = clamp(L.steer || 0, -1, 1);
  [[-1, 0], [1, 1]].forEach(([s, i]) => {
    const { base, tip } = leverTip(s, lev[i]);
    K.rod(base, tip, 0.011, 'dash', 0.2, POD.billet, 0.05, 10);
    // A billet collar where the grip meets the arm.
    K.rod([tip[0], tip[1], tip[2] - 0.008], [tip[0], tip[1], tip[2] + 0.012], 0.019, 'dash', 0.2, POD.billet, 0.05, 14);
    // The grip runs outboard and twists with the steer: a right turn pushes the left grip forward
    // and pulls the right one back, as the split vanes go over.
    const tw = -s * steer * 0.045;
    const g0 = [tip[0] + s * 0.012, tip[1], tip[2] + 0.004];
    const g1 = [tip[0] + s * 0.11, tip[1] + tw, tip[2] + 0.018];
    K.rod(g0, g1, 0.019, 'dash', 0.2, POD.grip, 0, 14);
    for (const u of [0.25, 0.5, 0.75]) {
      const c = lerp3(g0, g1, u), d = unit(sub(g1, g0));
      K.rod([c[0] - d[0] * 0.003, c[1] - d[1] * 0.003, c[2] - d[2] * 0.003], [c[0] + d[0] * 0.003, c[1] + d[1] * 0.003, c[2] + d[2] * 0.003], 0.0205, 'dash', 0.2, POD.billet, 0.05, 12);
    }
    K.rod(g1, lerp3(g0, g1, 1.12), 0.021, 'dash', 0.3, POD.anod, 0.1, 12);
    // A red thumb button on top of the grip, by the collar.
    const tb = lerp3(g0, g1, 0.18);
    K.rod([tb[0], tb[1], tb[2] + 0.016], [tb[0], tb[1], tb[2] + 0.026], 0.008, 'dash', 0.3, POD.anod, L.boosting ? 0.9 : 0.1, 8);
  });
}

// ── The light strip under the coaming ───────────────────────────────────────
function lightStrip(K, L, on) {
  const hot = !!L.boosting || (L.heat || [0, 0]).some((h) => h > 0.85);
  const rgb = hot ? POD.elHot : INSIDE.strip[insideOf(L).strip], emis = on ? (hot ? 1 : 0.85) : 0.12;
  for (const s of [-1, 1]) {
    // Tucked under the bolster, so you see its light on the wall more than the strip itself.
    const x = s * (WALL - 0.05);
    K.rod([x, AFT + 0.06, RIM - 0.108], [x, FWD - 0.03, RIM - 0.108], 0.005, 'pil', 0.2, rgb, emis, 6);
  }
}

function podracerRoom(P, live, push) {
  const K = makeKit(push);
  const L = live || {};
  const on = !!L.running;
  // The tub and the dash carcass take the owner's leather and dash: an argument, so the memo builds
  // each choice once and again only when it changes.
  const ins = insideOf(L), kit = kitOf(L);
  K.group('podTub', tub, ins.leather, kit.shell);
  K.group('podCowl', cowl);
  K.group('podDash', dashBody, ins.dash);
  K.group('podKit', kitParts, kit.engine, kit.boost, kit.cooling);
  K.group('podSheet', buildSheet, sheetLines(kit));
  lightStrip(K, L, on);
  dashLive(K, L, on);
  levers(K, L, on);
  hotspotHalo(K, podracerHotspots(L), L);
}

export function podracerProfile() {
  return {
    label: 'podracer pod',
    xCentre: 0, halfW: WALL + 0.12,
    floor: FLOOR - 0.03, roof: 0.26, front: 1.65, back: AFT - 0.25,
    // Open: no lining overhead. The shell gate's glazed-roof rule is the same rule for open sky.
    roofGlass: [AFT, FWD],
    dashY: 0.70, dashZ: RIM, headerZ: 0.2, pillarW: 0,
    winY: [AFT, FWD], winZ: [RIM, 0.2],
    seatZ: -0.80, seatHalf: 0.26, seatY: [-0.45, 0.05], backZ: 0.05,
    seats: 1, centrePost: 0,
    eyeM: 1.2,
    normalLit: true,
    floods: [{ p: [0, 0.62, -0.40], r: 0.4 }, { p: [0, 0.35, -0.62], r: 0.3 }],
    room: (P, live, push) => podracerRoom(P, live, push),
    hotspots(live) { return podracerHotspots(live); },
  };
}
