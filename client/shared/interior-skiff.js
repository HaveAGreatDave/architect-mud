// THE KEEL MK 1 FROM THE AFT THWART.
//
// An open aluminium skiff, so there is no room: you sit on the aft thwart, port of the centreline,
// facing forward, with the sea and the sky over everything. What you can see is the inside of the
// hull: low riveted gunwales, ribs and rivet lines down the topsides, two more thwarts forward, the
// fish box on the sole between them, the anchor and its cleat on the foredeck, the fuel tank by
// your right foot, and behind you the outboard with its tiller arm reaching forward under your right
// hand. The lamp pole stands on the starboard quarter and a rod holder is clamped to the starboard
// gunwale.
//
// Metres about the eye, +x right (starboard), +y forward, +z up, like every seat. The hull is the
// exterior's own: every surface that belongs to the boat (sheer, sole, well, thwarts, fish box,
// decks, the cleat, the lamp pole) is placed off `boatGeom` through one conversion (`H`), and only
// the things sized for a person (the grip, the knobs, the lettering) are authored in metres. The eye
// is the exterior's helm point (boat-house.js, the aft thwart), so `eyeM` and the sea's metre agree
// with the boat drawn from outside. What's lying about in her (`skiffLayout`) is placed once, in
// model units, and aircraft3d.js's `skiffKit` draws the same things in the same places.
//
// One place differs from the exterior on purpose: the spare rod on the port quarter stands raked aft
// in the chase view and isn't drawn here, because nothing in this seat may stand over eye height.
//
// Every control drawn here is a hotspot (`skiffHotspots`), lettered in the legend face in plain
// stamped or painted words, as a man in a shed would letter them:
//   fast / slow  the twist grip on the tiller (hold): FAST and SLOW either side of the arrow
//   kill         the kill cord's switch on the tiller housing: KILL
//   choke        the choke knob beside it: CHOKE
//   prime        the fuel line's primer bulb, on the tank: PRIME (the tank says FUEL, and its gauge
//                reads `live.fuel`)
//   cleat        the anchor cleat on the foredeck: ANCHOR on the bulkhead under it
//   lamp         the lamp switch on the starboard topside: LAMP
//   box          the fish box lid: FISH
//   rod          the rod holder on the starboard gunwale: ROD
//   ign          the starter cord's handle on the front of the cowl: PULL
//   sonar, sonarRange, sonarGain   the fish finder's three buttons: PWR, RANGE, GAIN
// Nothing is branded; Keel built her. Two plates say what she is: the builder's on the port wall and
// the capacity plate on the starboard.
//
// The live keys it reads: `throttle`, `steer`, `fuel`, `running`, `hover`, `press` (all sent by
// boat-view.js today) and `anchored`, `lamp`, `boxOpen`, `choke`, `prime` (0..1, the bulb squeezed),
// `rod` (rod mode: the holder is empty), `netOut` (the landing net is in use, so it isn't stowed),
// `boxFill` (0..1, how much is on the ice) and `sonar` ({ w, h, cells, depthM }, or null when it's off;
// a cell is a level 0..3), which the seat sends as it wires them.
//
// Keep her low: nothing stands above eye height, and nothing above 5 degrees below the horizon
// ahead or abeam, so the water you cast into and the rod's arc are clear. scripts/shapes/shell.mjs
// holds every one of those.

import { boatGeom } from './boat-house.js';
import { makeKit, C, SHINY, TEXTURE, clamp } from './interior-kit.js';
import { hotspotHalo } from './interior-cockpit-kit.js';

export const SK = {
  // ⚠ DARKER THAN THEY LOOK HERE: the cabin is lit by the open sky on every face, and at noon the
  // first cut of these (mill aluminium at 176) read as white plastic.
  alu: [120, 126, 130],        // mill-finish aluminium: thwarts, gunwale bars, the cleat
  deck: [118, 124, 126],       // the decks, tread plate
  hull: [172, 182, 172],       // the inside of the hull plating, in a worn grey-green primer
  hullDk: [154, 164, 154],     // the same, low down
  sole: [104, 110, 108],       // the sole, tread plate
  rib: [188, 196, 186],        // the frames
  rivet: [214, 218, 212],      // the rivet heads
  press: [134, 140, 142],      // a rib pressed in a thwart, and the frames across the sole
  oxide: [112, 124, 112],        // oxide weeping from a seam
  plate: [196, 198, 192],      // a stamped tag or decal: light, so the ink is dark on it
  ink: [26, 28, 30],           // stamped or painted lettering on a light face
  white: [232, 232, 226],      // painted lettering on a dark or red face
  tank: [170, 44, 32],         // the fuel tank
  tankRib: [132, 32, 24],      // its embossing
  box: [62, 98, 124],          // the fish box, a moulded cooler gone chalky
  boxLid: [84, 122, 146],
  boxRib: [50, 82, 104],
  ice: [104, 122, 126],        // inside the fish box
  fish: [66, 78, 84],          // what's on the ice
  fishDk: [34, 42, 48],
  liner: [170, 182, 184],      // the underside of the lid
  cowl: [44, 48, 56],          // the outboard's cowl and the tiller arm
  cowlDk: [28, 30, 34],
  band: [186, 56, 36],         // the stripe round the cowl
  rubber: [22, 22, 24],        // the grip, the bulb, the hose
  red: [196, 34, 28],          // the kill switch and its cord
  rope: [176, 150, 104],       // the rode
  line: [206, 172, 54],        // the coil of yellow line
  lens: [228, 224, 206],       // the lamp, off
  lensOn: [255, 244, 214],     // the lamp, lit
  anchor: [70, 74, 80],        // galvanised steel
  plank: [120, 90, 58],        // the seat planks
  tackle: [166, 130, 44],      // the tackle box
  pail: [124, 130, 128],       // the bailing pail
  jacket: [224, 102, 24],      // the life jacket
  jacketDk: [176, 74, 16],
  reflect: [206, 210, 206],    // its reflective tape
  oar: [136, 104, 68],         // the oars
  cork: [158, 120, 78],        // the rod's grip
  blank: [36, 40, 46],         // the rod
  steel: [88, 92, 98],         // the reel, the arm
  unit: [58, 62, 68],          // the fish finder's case
  hood: [34, 36, 40],          // its hood
  lcd: [18, 30, 24],           // its screen, off
};
// Mill finish is dull: a broad, weak sheen. At 0.45 the thwarts flared white under a noon sky.
SHINY.set(SK.alu, { spec: 0.12, pow: 10 }); TEXTURE.set(SK.alu, 'brushed');
SHINY.set(SK.rib, { spec: 0.08, pow: 10 }); TEXTURE.set(SK.rib, 'paint');
SHINY.set(SK.rivet, { spec: 0.5, pow: 30 });
SHINY.set(SK.deck, { spec: 0.10, pow: 10 }); TEXTURE.set(SK.deck, 'tread');
TEXTURE.set(SK.hull, 'cast'); TEXTURE.set(SK.hullDk, 'cast'); TEXTURE.set(SK.sole, 'tread');
TEXTURE.set(SK.oxide, 'cast'); SHINY.set(SK.press, { spec: 0.08, pow: 10 }); TEXTURE.set(SK.press, 'brushed');
TEXTURE.set(SK.tank, 'paint'); SHINY.set(SK.tank, { spec: 0.4, pow: 24, coat: 0.3 });
TEXTURE.set(SK.tankRib, 'paint'); SHINY.set(SK.tankRib, { spec: 0.4, pow: 24, coat: 0.3 });
TEXTURE.set(SK.box, 'plastic'); TEXTURE.set(SK.boxLid, 'plastic'); TEXTURE.set(SK.boxRib, 'plastic');
TEXTURE.set(SK.cowl, 'paint'); SHINY.set(SK.cowl, { spec: 0.5, pow: 30, coat: 0.4 });
TEXTURE.set(SK.rubber, 'rubber'); TEXTURE.set(SK.rope, 'fabric'); TEXTURE.set(SK.line, 'fabric');
TEXTURE.set(SK.plank, 'wood'); TEXTURE.set(SK.oar, 'wood'); TEXTURE.set(SK.tackle, 'plastic');
TEXTURE.set(SK.jacket, 'fabric'); TEXTURE.set(SK.jacketDk, 'fabric'); TEXTURE.set(SK.unit, 'plastic'); TEXTURE.set(SK.hood, 'rubber');
SHINY.set(SK.pail, { spec: 0.14, pow: 12 }); TEXTURE.set(SK.pail, 'brushed');

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ── THE HULL, ONCE PER ROW ───────────────────────────────────────────────────
// Everything the room and the hotspots both need. Memoised on the row's identity, like boatGeom.
const FRAMES = new WeakMap();
export function skiffFrame(row) {
  let F = FRAMES.get(row);
  if (F) return F;
  const G = boatGeom(row), E = G.helm, m = E.mPerUnit, S = G.S, LEN = G.LEN;
  // Model units to metres about the eye. The one conversion; see the header.
  const H = (f, g, z) => [(g - E.g) * m, (f - E.f) * m, (z - E.z) * m];
  const TS = G.STATIONS[G.STATIONS.length - 1];
  const Mo = S.motorScale ?? 1;
  const cpF0 = S.cockpitF0 ?? -0.88, cpF1 = S.cockpitF1 ?? 0.2;
  const crown = S.crown ?? 0.012;
  const sole = G.soleZ;
  // The well's wall and topside, as the exterior cuts them (boat-house.js `WELL`): the wall from the
  // sole up to just under the sheer, then a narrow cap out to the sheer. `INB` keeps the sheer edge a
  // hair inboard of the skin.
  const INB = 0.992;
  const wallLo = (f) => G.WELL.lo * G.atF(f).sw, wallHi = (f) => G.WELL.hi * G.atF(f).sw;
  const capZ = (f) => G.atF(f).sz - G.WELL.cap;
  // The wall's half-width at a height, and a point on it at fraction t of the way up.
  const wallAt = (f, z) => wallLo(f) + (wallHi(f) - wallLo(f)) * clamp((z - sole) / ((capZ(f) - sole) || 1), 0, 1);
  const wallPt = (f, s, t) => [f, s * (wallLo(f) + (wallHi(f) - wallLo(f)) * t), sole + (capZ(f) - sole) * t];
  // A point on the topside at fraction t (0 at the top of the wall, 1 at the sheer).
  const topside = (f, s, t) => { const a = G.atF(f); return [f, s * (wallHi(f) + (a.sw * INB - wallHi(f)) * t), capZ(f) + (a.sz - capZ(f)) * t]; };
  // The deck surface fore and aft of the well: the sheer at the side, `crown` higher on the centreline.
  const deckZ = (f, g) => { const a = G.atF(f); return a.sz + crown * Math.max(0, 1 - Math.abs(g) / (a.sw || 1)); };
  // Where a thwart's underside meets the wall: it rests on it rather than stopping in the air.
  const thwartEnd = (f, zb) => wallAt(f, zb) - 0.001;
  // The outboard, on the transom with its cowl above it, as the exterior's.
  const mot = G.outboard;
  // The extent in metres, for the bounds (interior-shell.js shellBounds).
  const maxSw = Math.max(...G.STATIONS.map((s) => s.sw));
  F = {
    G, E, m, S, LEN, H, TS, Mo, cpF0, cpF1, crown, sole, INB, wallLo, wallHi, wallAt, wallPt, capZ, topside, deckZ, thwartEnd, mot,
    xC: -E.g * m,
    halfW: (maxSw + 0.004) * m,
    front: (LEN - E.f) * m + 0.02,
    back: (mot.f0 - E.f) * m - 0.03,
    floor: (sole - E.z) * m - 0.01,
  };
  FRAMES.set(row, F);
  return F;
}

// ── WHAT'S LYING ABOUT IN HER, ONCE ──────────────────────────────────────────
// In model units (f along her, g to starboard, z up), for this seat and for aircraft3d.js's skiffKit.
const LAYOUTS = new WeakMap();
export function skiffLayout(F) {
  let L = LAYOUTS.get(F);
  if (L) return L;
  const { G, E, m, S, LEN, TS, sole, cpF0, wallPt, capZ } = F;
  const at = (x, y, z) => [E.f + y / m, E.g + x / m, E.z + z / m];
  const th = (Array.isArray(S.thwarts) ? S.thwarts : [-0.6, 0, 0.45]).map((u) => u * LEN);
  // The rod on the starboard gunwale: its butt and grip by your right hand, in a holder laid forward,
  // the blank running on up the inside of the rail to a clip by the forward thwart.
  const fh = E.f + 0.80 / m, ah = G.atF(fh), ft = th[2] + 0.012, at2 = G.atF(ft);
  const holderA = [fh, ah.sw * 0.945, ah.sz + 0.004], tip = [ft + 0.024, at2.sw * 0.885, at2.sz - 0.0035];
  const dir = (() => { const d = [tip[0] - holderA[0], tip[1] - holderA[1], tip[2] - holderA[2]], l = Math.hypot(...d); return d.map((v) => v / l); })();
  const along = (k) => holderA.map((v, i) => v + dir[i] * k);
  const port = -1;
  L = {
    tank: { f0: E.f + 0.30 / m, f1: E.f + 0.76 / m, g0: 0.030, g1: 0.070, z1: E.z - 0.86 / m },
    tackle: { f0: 0.045, f1: 0.092, g0: -0.090, g1: -0.056, h: 0.019 },
    bucket: { f: -0.064, g: 0.062, r: 0.0150, h: 0.030 },
    jacket: { f: th[2], g0: 0.016, g1: 0.066, z: G.thwartTop(th[2]) + 0.0011 },
    coil: { f: -0.108, g: -0.052, r: 0.0150 },
    net: { butt: [-0.176, -0.088, sole + 0.030], neck: [-0.082, -0.080, sole + 0.012], hoop: [-0.052, -0.078, sole + 0.010], r: 0.024 },
    oars: [-1, 1].map((s) => {
      const f0 = th[0] - 0.012, f1 = th[2] - 0.05, z0 = G.thwartTop(th[0]) + 0.0028, z1 = G.thwartTop(th[1]) + 0.0028;
      return { s, a: [f0, s * (F.wallAt(f0, z0) - 0.008), z0], b: [f1, s * (F.wallAt(f1, z1) - 0.0075), z1 + 0.0012] };
    }),
    rod: { holderA, holderB: along(0.038), butt: along(-0.030), grip: along(0.040), tip, clip: along(0.21) },
    sonar: { c: at(-0.36, 0.50, -0.46), clamp: [E.f + 0.50 / m, port * G.atF(E.f + 0.50 / m).sw * 0.955, G.atF(E.f + 0.50 / m).sz + 0.002], hw: 0.135 / m, hh: 0.098 / m, hd: 0.030 / m },
    transducer: { f: TS.f - 0.002, g: -0.066, z: TS.k + 0.006 },
    cable: [[TS.f - 0.002, -0.066, TS.k + 0.016], [TS.f - 0.0015, -0.066, TS.sz + 0.002], [TS.f + 0.004, -0.066, TS.sz + 0.0035], [cpF0, -0.086, TS.sz + 0.002],
      wallPt(cpF0 + 0.006, port, 0.86), wallPt(E.f + 0.42 / m, port, 0.92), [E.f + 0.50 / m, port * G.atF(E.f + 0.50 / m).sw * 0.94, G.atF(E.f + 0.50 / m).sz + 0.001]],
  };
  LAYOUTS.set(F, L);
  return L;
}

// ── WHERE THE CONTROLS ARE, ONCE ─────────────────────────────────────────────
// The room draws from these and the hotspots hand the same points to the renderer, so a control
// cannot be drawn in one place and clicked in another.
function tillerAt(F, L) {
  const { H, TS, mot, xC } = F;
  // The swivel at the front of the cowl, and the grip's end beside the aft thwart under your hand.
  const root = H(mot.f1 + 0.002, 0, TS.sz + 0.010);
  const end = [xC, 0.0, -0.645];
  const d0 = sub(end, root), Lt = Math.hypot(...d0), A0 = mul(d0, 1 / Lt);
  // Push the tiller to port and she turns to starboard: a positive `steer` (the heading rising,
  // flight-model.js stepBoat) swings it to port, toward you. Positive `psi` turns +y toward -x.
  const psi = clamp(L.steer || 0, -1, 1) * 0.42, c = Math.cos(psi), s = Math.sin(psi);
  const A = [A0[0] * c - A0[1] * s, A0[0] * s + A0[1] * c, A0[2]];
  const Sd = norm(cross(A, [0, 0, 1])), N = cross(Sd, A);
  const at = (a, sv, n) => add(add(add(root, mul(A, a)), mul(Sd, sv)), mul(N, n));
  const GRIP = 0.19, aH = Lt - GRIP - 0.078;
  return { root, A, S: Sd, N, Lt, at, GRIP, aH };
}
// The housing's top plate: across is aft along the arm, up is to starboard, so it reads true with
// your head turned to the right and down, the way you look at it (cockpit-lettering.md rule 7).
const housingPanel = (K, T) => K.panel(T.at(T.aH, 0, 0.0335), mul(T.A, -1), T.S);
const HOUSING = { kill: [-0.036, -0.002], choke: [0.036, -0.002], slow: [-0.040, 0.031], fast: [0.040, 0.031] };

// The fuel tank, on the sole forward of the aft thwart and to starboard, by your right foot.
function tankOf(F) {
  const T = skiffLayout(F).tank, [x0, y0, zt] = F.H(T.f0, T.g0, T.z1), [x1, y1] = F.H(T.f1, T.g1, T.z1);
  return { x0, x1, y0, y1, zt };
}
const tankPanel = (K, F) => { const T = tankOf(F); return K.panel([(T.x0 + T.x1) / 2, (T.y0 + T.y1) / 2, T.zt + 0.0005], [1, 0, 0], [0, 1, 0]); };
const BULB = { a: -0.085, b0: -0.17, b1: -0.05 };   // on the tank top, in its panel's metres
const GAUGE = [0.075, -0.035];                      // the gauge in the filler cap, likewise
// The cap's top, which the gauge is drawn on: a panel of its own, or the dial is inside the cap.
const capPanel = (K, Tp) => K.panel(Tp.pt(GAUGE[0], GAUGE[1], 0.0105), [1, 0, 0], [0, 1, 0]);

// The lamp switch: a box riveted to the starboard topside just forward of the aft thwart.
function lampPanel(K, F) {
  const { H, wallPt, E, m } = F;
  const f = E.f + 0.40 / m;
  const lo = H(...wallPt(f, 1, 0.56)), hi = H(...wallPt(f, 1, 0.88));
  const u = norm(sub(hi, lo)), r = [0, -1, 0], n = norm(cross(r, u));
  return K.panel(add(lerp3(lo, hi, 0.5), mul(n, 0.022)), r, u);
}
// The rod holder, clamped to the starboard gunwale abreast of you and laid forward along it, and the
// tag on its clamp.
function rodAt(F) {
  const { H } = F, R = skiffLayout(F).rod;
  const base = H(...R.holderA), top = H(...R.holderB);
  const dir = norm(sub(top, base));
  return { base, top, dir, tag: [base[0] - 0.075, base[1], base[2] + 0.030], butt: H(...R.butt), grip: H(...R.grip), tip: H(...R.tip), clip: H(...R.clip) };
}
const rodPanel = (K, R) => K.panel(R.tag, [0, -1, 0], [0, 0, 1]);
// The fish finder: a panel square to your eye, its face a hair in front of the case.
function sonarAt(K, F) {
  const U = skiffLayout(F).sonar, c = F.H(...U.c), n = norm(mul(c, -1));
  const u = norm(sub([0, 0, 1], mul(n, n[2]))), r = cross(u, n), hd = U.hd * F.m;
  return { c, n, u, r, hw: U.hw * F.m, hh: U.hh * F.m, hd, P: K.panel(add(c, mul(n, hd)), r, u) };
}
const SONAR_KEYS = [['sonar', 'PWR', -0.078], ['sonarRange', 'RANGE', 0], ['sonarGain', 'GAIN', 0.078]];
// The fish box lid, hinged at its forward edge, so it stands up beyond the box and you see into it.
function lidAt(F, L) {
  const { G, S, LEN, H } = F;
  const f0 = S.fishBox[0] * LEN, f1 = S.fishBox[1] * LEN;
  const w = G.atF((f0 + f1) / 2).sw * 0.40, zt = G.soleZ + (S.fishBoxH ?? 0.032);
  const th = L.boxOpen ? 1.25 : 0, c = Math.cos(th), s = Math.sin(th);
  const fh = f1 + 0.002, zh = zt - 0.004, Ls = fh - (f0 - 0.002), W = w * 1.05;
  // (g, along from the hinge, up through the lid) in model units, to metres.
  const P = (g, a, t) => H(fh - a * c + t * s, g, zh + a * s + t * c);
  return { f0, f1, w, zt, W, Ls, P, th, u: [0, c, -s] };
}
const lidPanel = (K, D) => K.panel(D.P(0, D.Ls * 0.56, 0.0042), [1, 0, 0], D.u);
// The cleat, and the bulkhead under it that says what it is for.
const cleatAt = (F) => { const fc = F.LEN * 0.84; return F.H(fc, 0, F.deckZ(fc, 0) + 0.0085); };
function bulkheadPanel(K, F) {
  const { H, cpF1, G } = F;
  return K.panel(H(cpF1 - 0.0004, 0, G.atF(cpF1).sz - 0.012), [1, 0, 0], [0, 0, 1]);
}
// The starter cord's handle on the front of the cowl.
const pullAt = (F) => F.H(F.mot.f1 + 0.003, 0, F.TS.sz + 0.034);

// ── THE HOTSPOTS ─────────────────────────────────────────────────────────────
// 'click' acts once on press; 'hold' holds its key while pressed (boat-view.js HOLD_KEY).
export function skiffHotspots(P, live) {
  const L = live || {}, F = P.frame;
  const K = makeKit(() => {});
  const T = tillerAt(F, L), Hp = housingPanel(K, T);
  const out = [
    { id: 'fast', p: Hp.pt(...HOUSING.fast, 0.004), r: 0.024, kind: 'hold' },
    { id: 'slow', p: Hp.pt(...HOUSING.slow, 0.004), r: 0.024, kind: 'hold' },
    { id: 'kill', p: Hp.pt(...HOUSING.kill, 0.022), r: 0.020, kind: 'click' },
    { id: 'choke', p: Hp.pt(...HOUSING.choke, (L.choke ? 0.030 : 0.013) + 0.003), r: 0.018, kind: 'click' },
  ];
  const Tp = tankPanel(K, F);
  out.push({ id: 'prime', p: Tp.pt(BULB.a, (BULB.b0 + BULB.b1) / 2, 0.05), r: 0.040, kind: 'click' });
  const c = cleatAt(F);
  out.push({ id: 'cleat', p: [c[0], c[1], c[2] + 0.01], r: 0.10, kind: 'click' });
  out.push({ id: 'cleat', p: bulkheadPanel(K, F).pt(0, 0, 0.004), r: 0.11, kind: 'click' });
  out.push({ id: 'lamp', p: lampPanel(K, F).pt(0, 0.008, 0.028), r: 0.030, kind: 'click' });
  const D = lidAt(F, L);
  out.push({ id: 'box', p: L.boxOpen ? D.P(0, D.Ls * 0.56, -0.001) : lidPanel(K, D).pt(0, 0, 0.004), r: 0.12, kind: 'click' });
  const R = rodAt(F);
  out.push({ id: 'rod', p: rodPanel(K, R).pt(0, 0, 0.004), r: 0.045, kind: 'click' });
  out.push({ id: 'rod', p: R.top, r: 0.045, kind: 'click' });
  const pu = pullAt(F);
  out.push({ id: 'ign', p: [pu[0], pu[1] + 0.03, pu[2]], r: 0.040, kind: 'click' });
  const U = sonarAt(K, F);
  for (const [id, , a] of SONAR_KEYS) out.push({ id, p: U.P.pt(a, -0.078, 0.008), r: 0.028, kind: 'click' });
  return out;
}

// ── SMALL PARTS ──────────────────────────────────────────────────────────────
// A triangle or quad with its normal turned to face `toward` (a direction, not a point).
function faceToward(K, pts, toward, rgb, k = 0.2, emis = 0) {
  let n = norm(cross(sub(pts[1], pts[0]), sub(pts[2], pts[0])));
  if (dot(n, toward) < 0) n = mul(n, -1);
  K.face(pts, n, 'dash', k, rgb, emis);
}
// A quad split into two triangles, each with its own normal: the hull's panels are lofted between
// stations and a lofted quad is not flat (glass-notes.md, boat pilothouse: flat shading).
function quad2(K, a, b, c, d, toward, rgb, k) {
  faceToward(K, [a, b, c], toward, rgb, k);
  faceToward(K, [a, c, d], toward, rgb, k);
}
// A flat bar lying on a surface from `a` to `b`: `n` is the surface's normal, `w` its width and `d`
// how far it stands proud. Its face and both edges; the back is against the plating.
function flatBar(K, a, b, n, w, d, rgb, k = 0.2) {
  const t = norm(sub(b, a)), side = mul(norm(cross(n, t)), w / 2), up = mul(n, d);
  const a0 = sub(a, side), a1 = add(a, side), b0 = sub(b, side), b1 = add(b, side);
  K.face([add(a0, up), add(a1, up), add(b1, up), add(b0, up)], n, 'dash', k, rgb);
  K.face([a0, b0, add(b0, up), add(a0, up)], mul(norm(side), -1), 'dash', k, rgb);
  K.face([a1, add(a1, up), add(b1, up), b1], norm(side), 'dash', k, rgb);
}
// A box with its top edges chamfered by `c`, in metres, from two corners.
function chamferBox(K, x0, y0, z0, x1, y1, z1, c, rgb, k = 0.2) {
  const zc = z1 - c, q = (pts, n) => K.face(pts, norm(n), 'dash', k, rgb);
  q([[x0, y0, z0], [x1, y0, z0], [x1, y0, zc], [x0, y0, zc]], [0, -1, 0]);
  q([[x0, y1, z0], [x1, y1, z0], [x1, y1, zc], [x0, y1, zc]], [0, 1, 0]);
  q([[x0, y0, z0], [x0, y1, z0], [x0, y1, zc], [x0, y0, zc]], [-1, 0, 0]);
  q([[x1, y0, z0], [x1, y1, z0], [x1, y1, zc], [x1, y0, zc]], [1, 0, 0]);
  q([[x0, y0, zc], [x1, y0, zc], [x1 - c, y0 + c, z1], [x0 + c, y0 + c, z1]], [0, -1, 1]);
  q([[x0, y1, zc], [x1, y1, zc], [x1 - c, y1 - c, z1], [x0 + c, y1 - c, z1]], [0, 1, 1]);
  q([[x0, y0, zc], [x0, y1, zc], [x0 + c, y1 - c, z1], [x0 + c, y0 + c, z1]], [-1, 0, 1]);
  q([[x1, y0, zc], [x1, y1, zc], [x1 - c, y1 - c, z1], [x1 - c, y0 + c, z1]], [1, 0, 1]);
  q([[x0 + c, y0 + c, z1], [x1 - c, y0 + c, z1], [x1 - c, y1 - c, z1], [x0 + c, y1 - c, z1]], [0, 0, 1]);
}
// A rivet head: a hexagon a couple of millimetres proud of the plate.
function rivet(K, p, n, r = 0.0065) {
  const ref = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const e1 = norm(cross(n, ref)), e2 = cross(n, e1), o = add(p, mul(n, 0.0025));
  K.face(Array.from({ length: 6 }, (_, i) => { const t = (i / 6) * Math.PI * 2; return add(o, add(mul(e1, Math.cos(t) * r), mul(e2, Math.sin(t) * r))); }), n, 'dash', 0.3, SK.rivet);
}
// A rope or a hose along a polyline.
function line(K, pts, rad, rgb, sides = 5) {
  for (let i = 0; i < pts.length - 1; i++) K.rod(pts[i], pts[i + 1], rad, 'dash', 0.1, rgb, 0, sides, i === 0 || i === pts.length - 2);
}

// ── THE HULL ─────────────────────────────────────────────────────────────────
// The stations the well is lofted at: even steps plus every hull station inside it.
function wellStations(F) {
  const { cpF0, cpF1, G } = F;
  const fs = [];
  for (let i = 0; i <= 12; i++) fs.push(cpF0 + (cpF1 - cpF0) * (i / 12));
  for (const s of G.STATIONS) if (s.f > cpF0 && s.f < cpF1) fs.push(s.f);
  return [...new Set(fs.map((f) => +f.toFixed(6)))].sort((a, b) => a - b);
}

function hullParts(K, F) {
  const { H, G, sole, wallLo, wallHi, capZ, topside, wallPt, deckZ, cpF0, cpF1, TS, LEN } = F;
  const fs = wellStations(F);
  // The sole, the walls and the narrow cap along their top, both sides.
  for (let i = 0; i < fs.length - 1; i++) {
    const f0 = fs[i], f1 = fs[i + 1];
    K.face([H(f0, -wallLo(f0), sole), H(f0, wallLo(f0), sole), H(f1, wallLo(f1), sole), H(f1, -wallLo(f1), sole)], [0, 0, 1], 'floor', -0.05, SK.sole);
    for (const s of [-1, 1]) {
      const inb = [-s, 0, 0];
      // In two lifts, low and high, with a lap between them.
      const L0 = (f) => H(...wallPt(f, s, 0)), L1 = (f) => H(...wallPt(f, s, 0.46)), L2 = (f) => H(...wallPt(f, s, 1));
      quad2(K, L0(f0), L0(f1), L1(f1), L1(f0), inb, SK.hullDk, 0.05);
      quad2(K, L1(f0), L1(f1), L2(f1), L2(f0), inb, SK.hull, 0.1);
      quad2(K, H(...topside(f0, s, 0)), H(...topside(f1, s, 0)), H(...topside(f1, s, 1)), H(...topside(f0, s, 1)), inb, SK.alu, 0.1);
      // The gunwale: a flat bar along the sheer, riveted down.
      const a0 = G.atF(f0), a1 = G.atF(f1);
      const q = [H(f0, s * a0.sw * 0.95, a0.sz + 0.0012), H(f1, s * a1.sw * 0.95, a1.sz + 0.0012), H(f1, s * a1.sw * 0.999, a1.sz + 0.0012), H(f0, s * a0.sw * 0.999, a0.sz + 0.0012)];
      K.face(q, [0, 0, 1], 'dash', 0.3, SK.alu);
      K.face([H(f0, s * a0.sw * 0.95, a0.sz + 0.0012), H(f1, s * a1.sw * 0.95, a1.sz + 0.0012), H(f1, s * a1.sw * 0.95, a1.sz - 0.0035), H(f0, s * a0.sw * 0.95, a0.sz - 0.0035)], inb, 'dash', 0.1, SK.alu);
    }
  }
  // The ribs: a frame up each wall and across the sole, every 0.3 m or so, with a rivet line up each;
  // and a stringer along each wall, with the lap's rivets under it.
  const NR = 11;
  for (let k = 0; k <= NR; k++) {
    const f = cpF0 + 0.012 + (cpF1 - cpF0 - 0.024) * (k / NR);
    for (const s of [-1, 1]) {
      const b = H(...wallPt(f, s, 0)), t = H(...wallPt(f, s, 0.985));
      const nW = norm(cross(sub(t, b), [0, 1, 0])), nw = nW[0] * s > 0 ? mul(nW, -1) : nW;
      flatBar(K, b, t, nw, 0.036, 0.012, SK.rib, 0.1);
      for (let j = 1; j <= 4; j++) rivet(K, add(lerp3(b, t, j / 5), mul(nw, 0.012)), nw);
    }
    // Across the sole.
    flatBar(K, H(f, -wallLo(f) + 0.004, sole), H(f, wallLo(f) - 0.004, sole), [0, 0, 1], 0.030, 0.014, SK.press, 0.05);
  }
  for (const s of [-1, 1]) {
    for (let i = 0; i < fs.length - 1; i++) {
      const a = H(...wallPt(fs[i], s, 0.46)), b = H(...wallPt(fs[i + 1], s, 0.46));
      const n0 = norm(cross(sub(b, a), [0, 0, 1])), n = n0[0] * s > 0 ? mul(n0, -1) : n0;
      flatBar(K, a, b, n, 0.044, 0.008, SK.rib, 0.15);
    }
    // Oxide weeping down the plate from the stringer, here and there.
    for (let i = 0; i < 11; i++) {
      const u = (i * 37 % 11) / 11, f = cpF0 + 0.03 + (cpF1 - cpF0 - 0.06) * (i / 11);
      const a = H(...wallPt(f, s, 0.44)), b = H(...wallPt(f, s, 0.44 - 0.12 - 0.2 * u));
      const n0 = norm(cross(sub(b, a), [0, 1, 0])), n = n0[0] * s > 0 ? mul(n0, -1) : n0;
      flatBar(K, a, b, n, 0.012, 0.0015, SK.oxide, 0.05);
    }
  }
  for (let i = 0; i < 40; i++) {
    const f = cpF0 + 0.006 + (cpF1 - cpF0 - 0.012) * (i / 39);
    for (const s of [-1, 1]) {
      const g = G.atF(f);
      rivet(K, H(f, s * g.sw * 0.975, g.sz + 0.0012), [0, 0, 1], 0.0055);
    }
  }
  // The decks fore and aft of the well, crowned like the exterior's, and the bulkheads that close the
  // well at each end. The forward one carries ANCHOR (see `skiffRoom`).
  const deck = (fa, fb) => {
    const st = [fa, ...G.STATIONS.map((s) => s.f).filter((f) => f > Math.min(fa, fb) && f < Math.max(fa, fb)), fb].sort((x, y) => x - y);
    for (let i = 0; i < st.length - 1; i++) {
      const p = st[i], q = st[i + 1], ap = G.atF(p), aq = G.atF(q);
      for (const s of [-1, 1]) {
        faceToward(K, [H(p, s * ap.sw * 0.999, ap.sz), H(q, s * aq.sw * 0.999, aq.sz), H(q, 0, deckZ(q, 0))], [0, 0, 1], SK.deck, 0.2);
        faceToward(K, [H(p, s * ap.sw * 0.999, ap.sz), H(q, 0, deckZ(q, 0)), H(p, 0, deckZ(p, 0))], [0, 0, 1], SK.deck, 0.2);
      }
    }
  };
  deck(cpF1, LEN - 0.0005);
  deck(TS.f + 0.0005, cpF0);
  const bulkhead = (f, facing) => {
    const a = G.atF(f);
    const ring = [[-wallLo(f), sole], [wallLo(f), sole], [wallHi(f), capZ(f)], [a.sw * F.INB, a.sz], [0, deckZ(f, 0)], [-a.sw * F.INB, a.sz], [-wallHi(f), capZ(f)]];
    // A fan from the middle of the sole edge. The outline turns in at the top of each wall, so it is
    // not convex, but every corner can be seen from there.
    const c = H(f, 0, sole);
    for (let i = 1; i < ring.length - 1; i++) {
      const p = ring[i], q = ring[i + 1];
      K.face([c, H(f, p[0], p[1]), H(f, q[0], q[1])], [0, facing, 0], 'dash', 0.1, SK.hull);
    }
    // A lip along its top, where the deck plating turns down.
    K.rod(H(f, -a.sw * 0.9, a.sz - 0.0015), H(f, 0, deckZ(f, 0) - 0.0015), 0.006, 'dash', 0.2, SK.alu, 0, 4);
    K.rod(H(f, 0, deckZ(f, 0) - 0.0015), H(f, a.sw * 0.9, a.sz - 0.0015), 0.006, 'dash', 0.2, SK.alu, 0, 4);
  };
  bulkhead(cpF1, -1);
  bulkhead(cpF0, 1);
  // The thwarts: stamped plate resting on the walls, a rolled lip fore and aft, two pressed ribs, knees
  // at the ends and rivets. A plank on the two you sit on, and the aft one boxed in for flotation.
  (Array.isArray(F.S.thwarts) ? F.S.thwarts : []).forEach((u, ti) => {
    const f = u * LEN, top = G.thwartTop(f), zb = top - 0.006, ge = F.thwartEnd(f, zb);
    K.box(...H(f - 0.024, -ge, zb), ...H(f + 0.024, ge, top), 'dash', 0.05, SK.alu);
    for (const d of [-1, 1]) K.box(...H(f + d * 0.0235, -ge, zb - 0.004), ...H(f + d * 0.0225, ge, zb), 'dash', -0.05, SK.alu);
    for (const d of [-0.016, 0.016]) K.box(...H(f + d - 0.0028, -ge * 0.97, top), ...H(f + d + 0.0028, ge * 0.97, top + 0.0011), 'dash', 0.15, SK.press);
    if (ti < 2) K.box(...H(f - 0.0105, -ge * 0.6, top), ...H(f + 0.0105, ge * 0.6, top + 0.0028), 'dash', 0.1, SK.plank);
    for (const s of [-1, 1]) {
      for (const d of [-0.012, 0.012]) rivet(K, H(f + d, s * (ge - 0.006), top), [0, 0, 1], 0.006);
      for (const d of [-0.02, 0.02]) faceToward(K, [H(f + d, s * ge, zb), H(f + d, s * (ge - 0.018), zb), H(f + d, s * F.wallAt(f, zb - 0.020), zb - 0.020)], [0, Math.sign(d), 0], SK.alu, 0);
    }
    if (ti === 0) K.face([H(f + 0.024, -ge, zb), H(f + 0.024, ge, zb), H(f + 0.024, F.wallAt(f + 0.024, sole), sole), H(f + 0.024, -F.wallAt(f + 0.024, sole), sole)], [0, 1, 0], 'dash', 0, SK.hull);
  });
}

// ── THE FITTINGS THAT DO NOT MOVE ────────────────────────────────────────────
function fixedParts(K, F) {
  const { H, G, LEN, TS, mot, xC, deckZ, S, E, m } = F;
  // The outboard: the clamp bracket over the transom, the pan and the cowl, lofted in plan as the
  // exterior's is, and the stripe round it.
  K.box(...H(TS.f - 0.004, -mot.hw * 0.72, TS.sz - 0.004), ...H(TS.f + 0.007, mot.hw * 0.72, TS.sz + 0.004), 'dash', 0.1, SK.cowlDk);
  {
    const fc = (mot.f0 + mot.f1) / 2, a = (mot.f1 - mot.f0) / 2, N = 12;
    const sp = (v) => Math.sign(v) * Math.abs(v) ** 0.62;
    const ring = (z, k) => Array.from({ length: N }, (_, i) => {
      const t = (i / N) * Math.PI * 2, u = sp(Math.cos(t)), v = sp(Math.sin(t));
      return H(fc + a * k * u, mot.hw * k * v * (0.88 + 0.12 * u), z);
    });
    const mid = H(fc, 0, (mot.z0 + mot.z1) / 2);
    const lift = (A, B, rgb, kk) => { for (let i = 0; i < N; i++) { const j = (i + 1) % N; quad2(K, A[i], A[j], B[j], B[i], sub(add(A[i], A[j]), mul(mid, 2)), rgb, kk); } };
    const stack = (rows, rgb, kk) => { for (let i = 0; i < rows.length - 1; i++) lift(ring(...rows[i]), ring(...rows[i + 1]), rgb, kk); };
    stack([[mot.z0, 0.70], [mot.z0 + 0.008, 0.95], [mot.zMid, 1]], SK.cowlDk, 0.1);
    stack([[mot.zMid, 0.965], [mot.zMid + 0.004, 1], [mot.z1 - 0.008, 0.97], [mot.z1 - 0.0025, 0.84], [mot.z1, 0.60]], SK.cowl, 0.2);
    K.face(ring(mot.z1, 0.60), [0, 0, 1], 'dash', 0.2, SK.cowl);
    lift(ring(mot.zMid + 0.008, 1.012), ring(mot.zMid + 0.0125, 1.012), SK.band, 0.2);
  }
  // PULL on the cowl top, near its front, read turned round to face aft.
  const cowlTop = K.panel(H(mot.f1 - 0.024, 0, mot.z1 + 0.0004), [-1, 0, 0], [0, -1, 0]);
  cowlTop.rect(-0.07, -0.03, 0.07, 0.03, SK.plate, 0, 0.001);
  cowlTop.text('PULL', 0, 0, 0.040, SK.ink, 0.05, 0.0034);
  // The lamp pole on the starboard quarter, its foot on the transom deck.
  const fl = TS.f + 0.03, gl = TS.sw * 0.7, zb = deckZ(fl, gl), zt = TS.sz + (S.lampPole ?? 0.07);
  K.rod(H(fl, gl, zb), H(fl, gl, zt), 0.0025 * m, 'dash', 0.2, SK.alu, 0, 6);
  K.box(...H(fl - 0.003, gl - 0.003, zb), ...H(fl + 0.003, gl + 0.003, zb + 0.003), 'dash', 0.1, SK.alu);
  // The lamp's cable, from the switch aft along the topside and over the deck to the pole's foot.
  const lp = lampPanel(K, F);
  const fA = F.cpF0 + 0.004;
  line(K, [lp.pt(0, -0.045, -0.018), H(...F.wallPt(E.f + 0.25 / m, 1, 0.92)), H(...F.wallPt(fA, 1, 0.92)), H(fl, gl, zb + 0.002)], 0.004, SK.rubber, 4);
  // The rod holder: a clamp on the gunwale, the tube laid forward along it, the clip further up, and
  // the tag riveted to the clamp.
  const R = rodAt(F);
  K.box(R.base[0] - 0.06, R.base[1] - 0.045, R.base[2] - 0.03, R.base[0] + 0.03, R.base[1] + 0.045, R.base[2] + 0.012, 'dash', 0.2, SK.alu);
  K.rod(R.base, R.top, 0.024, 'dash', 0.2, SK.alu, 0, 8, false);
  K.rod(sub(R.top, mul(R.dir, 0.02)), R.top, 0.028, 'dash', 0.2, SK.alu, 0, 8, false);
  K.box(R.clip[0] - 0.012, R.clip[1] - 0.014, R.clip[2] - 0.024, R.clip[0] + 0.012, R.clip[1] + 0.014, R.clip[2] - 0.008, 'dash', 0.2, SK.alu);
  K.box(R.tag[0] + 0.0005, R.tag[1] - 0.052, R.tag[2] - 0.030, R.tag[0] + 0.006, R.tag[1] + 0.052, R.tag[2] + 0.030, 'dash', 0.2, SK.alu);
  const Rp = rodPanel(K, R);
  Rp.rect(-0.05, -0.028, 0.05, 0.028, SK.plate, 0, 0.001);
  Rp.text('ROD', 0, 0, 0.036, SK.ink, 0.05, 0.0034);
  for (const a of [-0.042, 0.042]) Rp.disc(a, 0.019, 0.004, SK.rivet, 0, 0.002, 6);
  // ANCHOR, painted on the forward bulkhead under the cleat.
  const Bp = bulkheadPanel(K, F);
  Bp.rect(-0.17, -0.036, 0.17, 0.036, SK.plate, 0, 0.001);
  Bp.text('ANCHOR', 0, 0, 0.050, SK.ink, 0.05, 0.0034);
  // The cleat on the foredeck, lying fore and aft as the exterior's does.
  const fc = LEN * 0.84, dzc = deckZ(fc, 0);
  K.box(...H(fc - 0.008, -0.003, dzc), ...H(fc + 0.008, 0.003, dzc + 0.005), 'dash', 0.2, SK.alu);
  K.box(...H(fc - 0.015, -0.0028, dzc + 0.005), ...H(fc + 0.015, 0.0028, dzc + 0.0085), 'dash', 0.3, SK.alu);
  // The fuel tank, chamfered, its top embossed, with its handle, cap, gauge and lettering.
  const Tz0 = F.floor + 0.012, TANK = tankOf(F);
  chamferBox(K, TANK.x0, TANK.y0, Tz0, TANK.x1, TANK.y1, TANK.zt, 0.030, SK.tank);
  const Tp = tankPanel(K, F);
  for (const a of [-0.125, 0.125]) Tp.stud(a, 0.0, 0.0085, 0.205, 0.0045, SK.tankRib, 0, 0);
  K.box(TANK.x0 + 0.03, TANK.y0 - 0.0015, Tz0 + 0.03, TANK.x1 - 0.03, TANK.y0, TANK.zt - 0.05, 'dash', 0.1, SK.tankRib);
  Tp.text('FUEL', 0, 0.13, 0.052, SK.white, 0.1, 0.0034);
  Tp.text('PRIME', 0.062, -0.11, 0.028, SK.white, 0.1, 0.0034);
  // An arrow from PRIME to the bulb.
  Tp.rect(-0.030, -0.112, -0.006, -0.108, SK.white, 0.1, 0.002);
  Tp.plate([[-0.040, -0.110], [-0.028, -0.100], [-0.028, -0.120]], SK.white, 0.1, 0.002);
  K.rod(Tp.pt(-0.11, 0.21, 0.0), Tp.pt(-0.11, 0.21, 0.05), 0.008, 'dash', 0.1, SK.cowlDk, 0, 4);
  K.rod(Tp.pt(0.11, 0.21, 0.0), Tp.pt(0.11, 0.21, 0.05), 0.008, 'dash', 0.1, SK.cowlDk, 0, 4);
  K.rod(Tp.pt(-0.11, 0.21, 0.05), Tp.pt(0.11, 0.21, 0.05), 0.010, 'dash', 0.1, SK.cowlDk, 0, 6);
  Tp.knob(GAUGE[0], GAUGE[1], 0.044, 0.012, SK.cowlDk, 0);
  // The hose: from the connector at the tank's aft end, over the tank top to the bulb, then off the
  // tank's port side to the sole, aft under the thwart, up the aft bulkhead and over to the motor.
  const hz = TANK.zt + 0.012;
  const bulbA = Tp.pt(BULB.a, BULB.b0, 0.03), bulbF = Tp.pt(BULB.a, BULB.b1, 0.03);
  const fB = F.cpF0;
  line(K, [Tp.pt(BULB.a, -0.215, 0.012), Tp.pt(BULB.a, BULB.b0 - 0.02, 0.025), bulbA], 0.007, SK.rubber);
  line(K, [bulbF, Tp.pt(BULB.a, BULB.b1 + 0.03, 0.02), [TANK.x0 - 0.02, 0.58, hz - 0.04], [TANK.x0 - 0.04, 0.50, F.floor + 0.03],
    [0.44, 0.0, F.floor + 0.03], H(fB + 0.004, 0.012, F.sole + 0.004), H(fB + 0.002, 0.012, G.atF(fB).sz - 0.004),
    H(TS.f + 0.004, 0.012, TS.sz + 0.004), H(mot.f1 + 0.001, 0.012, TS.sz + 0.004)], 0.007, SK.rubber);
  // The fish box's body: a moulded cooler, four walls with ribs pressed in them, and the ice inside,
  // which shows with the lid up.
  const D = { f0: S.fishBox[0] * LEN, f1: S.fishBox[1] * LEN };
  const w = G.atF((D.f0 + D.f1) / 2).sw * 0.40, zt2 = G.soleZ + (S.fishBoxH ?? 0.032) - 0.004, th = 0.003;
  K.box(...H(D.f0, -w, G.soleZ), ...H(D.f0 + th, w, zt2), 'dash', 0.1, SK.box);
  K.box(...H(D.f1 - th, -w, G.soleZ), ...H(D.f1, w, zt2), 'dash', 0.1, SK.box);
  K.box(...H(D.f0, -w, G.soleZ), ...H(D.f1, -w + th, zt2), 'dash', 0.1, SK.box);
  K.box(...H(D.f0, w - th, G.soleZ), ...H(D.f1, w, zt2), 'dash', 0.1, SK.box);
  for (const g of [-w * 0.6, -w * 0.2, w * 0.2, w * 0.6]) K.box(...H(D.f0 - 0.0012, g - 0.003, G.soleZ + 0.002), ...H(D.f0, g + 0.003, zt2 - 0.003), 'dash', 0.05, SK.boxRib);
  K.face([H(D.f0 + th, -w + th, zt2 - 0.010), H(D.f0 + th, w - th, zt2 - 0.010), H(D.f1 - th, w - th, zt2 - 0.010), H(D.f1 - th, -w + th, zt2 - 0.010)], [0, 0, 1], 'dash', 0.1, SK.ice);
  // The two plates, riveted to the walls and turned to read from the thwart.
  const plateOn = (s, y0) => {
    const f = E.f + y0 / m, lo = H(...F.wallPt(f, s, 0.62)), hi = H(...F.wallPt(f, s, 0.92));
    const u = norm(sub(hi, lo)), r = [0, -s, 0], n = norm(cross(r, u));
    return K.panel(add(lerp3(lo, hi, 0.5), mul(n, s > 0 ? 0.016 : -0.016)), r, u);
  };
  {
    const Pc = plateOn(1, 1.02), Pb = plateOn(-1, 1.02);
    for (const P of [Pc, Pb]) {
      P.rect(-0.165, -0.098, 0.165, 0.098, SK.plate, 0, 0.001);
      for (const a of [-0.152, 0.152]) for (const b of [-0.086, 0.086]) P.disc(a, b, 0.006, SK.rivet, 0, 0.002, 6);
    }
    Pc.text('MAX 3 PERSONS', 0, 0.054, 0.024, SK.ink, 0.05, 0.0034);
    Pc.text('MAX 15 HP', 0, 0.002, 0.024, SK.ink, 0.05, 0.0034);
    Pc.text('MAX 360 KG', 0, -0.050, 0.024, SK.ink, 0.05, 0.0034);
    Pb.text('KEEL MK 1', 0, 0.054, 0.030, SK.ink, 0.05, 0.0034);
    Pb.text('HULL CW 4471', 0, 0.002, 0.022, SK.ink, 0.05, 0.0034);
    Pb.text('BUILT COLDWATER', 0, -0.050, 0.020, SK.ink, 0.05, 0.0034);
  }
}

// ── WHAT'S LYING ABOUT IN HER ────────────────────────────────────────────────
function looseParts(K, F) {
  const { H, sole, E, m } = F, L = skiffLayout(F);
  const up = [0, 0, 1];
  // The tackle box: a body, a lid a hair wider, a handle and two latches.
  {
    const T = L.tackle, [x0, y0, z0] = H(T.f0, T.g0, sole + 0.001), [x1, y1, z1] = H(T.f1, T.g1, sole + T.h - 0.005), zt = (sole + T.h - E.z) * m, c = [(x0 + x1) / 2, (y0 + y1) / 2];
    K.box(x0, y0, z0, x1, y1, z1, 'dash', 0.05, SK.tackle);
    chamferBox(K, x0 - 0.008, y0 - 0.008, z1, x1 + 0.008, y1 + 0.008, zt, 0.014, SK.tackle, 0.15);
    line(K, [[c[0] - 0.08, c[1], zt], [c[0] - 0.08, c[1], zt + 0.022], [c[0] + 0.08, c[1], zt + 0.022], [c[0] + 0.08, c[1], zt]], 0.007, SK.rubber, 4);
    for (const d of [-0.06, 0.06]) K.box(c[0] + d - 0.016, y0 - 0.012, z1 - 0.022, c[0] + d + 0.016, y0 - 0.008, z1 + 0.012, 'dash', 0.2, SK.steel);
  }
  // The bailing pail, with a little water left in it.
  {
    const B = L.bucket, p0 = H(B.f, B.g, sole + 0.0005), p1 = H(B.f, B.g, sole + B.h), r = B.r * m;
    K.rod(p0, p1, r, 'dash', 0.1, SK.pail, 0, 12, false);
    K.torus(p1, [1, 0, 0], [0, 1, 0], r, 0.006, 14, 'dash', 0.2, SK.pail);
    K.face(Array.from({ length: 12 }, (_, i) => { const t = (i / 12) * Math.PI * 2; return add(p1, [Math.cos(t) * r * 0.97, Math.sin(t) * r * 0.97, -0.05]); }), up, 'dash', -0.15, SK.hood);
    K.torus(p1, [1, 0, 0], [0, 0.42, 0.9], r * 1.02, 0.0035, 8, 'dash', 0.1, SK.steel, 0, 0, Math.PI);
  }
  // The life jacket on the forward thwart, folded, with its tape.
  {
    const J = L.jacket, a = H(J.f - 0.016, J.g0, J.z), b = H(J.f + 0.016, J.g1, J.z + 0.0055), c = H(J.f - 0.013, J.g0 + 0.003, J.z + 0.0055), d = H(J.f + 0.013, J.g1 - 0.003, J.z + 0.0095);
    chamferBox(K, a[0], a[1], a[2], b[0], b[1], b[2], 0.014, SK.jacket);
    chamferBox(K, c[0], c[1], c[2], d[0], d[1], d[2], 0.014, SK.jacketDk);
    const jc = (J.g0 + J.g1) / 2;
    for (const off of [-0.008, 0.008]) K.box(...H(J.f - 0.0145, jc + off - 0.0014, J.z + 0.0095), ...H(J.f + 0.0145, jc + off + 0.0014, J.z + 0.0100), 'dash', 0.2, SK.reflect);
  }
  // The coil of line on the sole.
  {
    const Co = L.coil, c = H(Co.f, Co.g, sole), r = Co.r * m;
    for (const [dz, k] of [[0.012, 1], [0.012, 0.8], [0.012, 0.6], [0.012, 0.4], [0.030, 0.9], [0.030, 0.68]]) K.torus(add(c, [0, 0, dz]), [1, 0, 0], [0, 1, 0], r * k, 0.0115, 14, 'dash', 0.1, SK.line);
  }
  // The oars, shipped along the thwarts.
  for (const o of L.oars) {
    const a = H(...o.a), b = H(...o.b), d = norm(sub(b, a));
    K.rod(a, b, 0.021, 'dash', 0.1, SK.oar, 0, 6);
    const q = add(b, mul(d, 0.37));
    faceToward(K, [add(b, [0.02, 0, 0]), add(q, [0.04, 0, 0]), add(q, [-0.04, 0, 0]), add(b, [-0.02, 0, 0])], up, SK.oar, 0.15);
  }
  // The transducer's cable, from over the transom up the port wall to the fish finder.
  line(K, L.cable.slice(3).map((p) => H(...p)), 0.0045, SK.rubber, 4);
}
// The landing net, while it's stowed.
function netParts(K, F) {
  const { H } = F, Ne = skiffLayout(F).net;
  const b = H(...Ne.butt), n = H(...Ne.neck), h = H(...Ne.hoop), r = Ne.r * F.m;
  K.rod(b, n, 0.012, 'dash', 0.2, SK.alu, 0, 6);
  const d = norm(sub(h, n)), e = norm(cross(d, [0, 0, 1]));
  K.torus(h, d, e, r, 0.009, 16, 'dash', 0.2, SK.alu);
  K.face(Array.from({ length: 14 }, (_, i) => { const t = (i / 14) * Math.PI * 2; return add(add(h, [0, 0, -0.012]), add(mul(d, Math.cos(t) * r), mul(e, Math.sin(t) * r))); }), [0, 0, 1], 'dash', -0.1, SK.hood);
}
// The rod, while it's in the holder.
function rodParts(K, F) {
  const R = rodAt(F);
  K.rod(R.butt, R.grip, 0.013, 'dash', 0.1, SK.cork, 0, 6);
  K.rod(R.grip, R.tip, 0.0055, 'dash', 0.2, SK.blank, 0, 5, false);
  const reel = add(lerp3(R.butt, R.grip, 0.5), [-0.022, 0, -0.024]);
  K.rod(add(reel, [-0.024, 0, 0]), add(reel, [0.024, 0, 0]), 0.03, 'dash', 0.2, SK.steel, 0, 8);
}
// The fish finder's case, hood, keys and the arm it stands on. Its screen is drawn live, in the room.
function sonarParts(K, F) {
  const { H } = F, U = sonarAt(K, F), L = skiffLayout(F).sonar;
  const hw = U.hw, hh = U.hh, hd = U.hd;
  K.obox(U.c, U.r, U.u, U.n, hw, hh, hd, 'dash', 0.05, SK.unit);
  // The hood over the screen: a top and two cheeks standing proud of the face.
  const P = U.P, sa = 0.105, b0 = -0.040, b1 = 0.086;
  P.stud(0, b1 + 0.004, sa + 0.006, 0.0045, 0.028, SK.hood, 0, 0);
  for (const s of [-1, 1]) P.stud(s * (sa + 0.004), (b0 + b1) / 2, 0.0035, (b1 - b0) / 2, 0.022, SK.hood, 0, 0);
  P.rect(-sa, b0, sa, b1, SK.hood, 0, 0.0008);
  for (const [, name, a] of SONAR_KEYS) {
    P.stud(a, -0.066, 0.026, 0.0115, 0.006, SK.hood, 0, 0.0005);
    P.text(name, a, -0.086, 0.0135, SK.white, 0.3, 0.0034);
  }
  // The arm: a ball at each end of a short tube, down to a clamp on the gunwale.
  const back = sub(U.c, mul(U.n, hd)), cl = H(...L.clamp);
  K.rod(back, cl, 0.016, 'dash', 0.2, SK.steel, 0, 8);
  K.obox(cl, [1, 0, 0], [0, 0, 1], [0, 1, 0], 0.018, 0.024, 0.040, 'dash', 0.2, SK.alu);
}

// ── THE ROOM ─────────────────────────────────────────────────────────────────
const SONAR_LCD = [null, [36, 104, 70], [178, 150, 44], [255, 196, 80]];
export function skiffRoom(P, live, push) {
  const K = makeKit(push);
  const L = live || {}, F = P.frame, { H, G, LEN, xC, deckZ } = F;
  // Built once per seat (interior-memo.js): neither reads anything live. `F` is the profile's own
  // frame, and the memo is kept per profile, so it is closed over rather than compared every frame.
  K.group('skiffHull', (k) => hullParts(k, F));
  K.group('skiffFixed', (k) => fixedParts(k, F));
  K.group('skiffLoose', (k) => looseParts(k, F));
  K.group('skiffSonar', (k) => sonarParts(k, F));
  K.group('skiffNet', (k, on) => { if (on) netParts(k, F); }, !L.netOut);
  K.group('skiffRod', (k, on) => { if (on) rodParts(k, F); }, !L.rod);
  // The lamp lens, lit or not. The room's floods follow the same switch (see the profile).
  const lampOn = !!L.lamp;
  P.lampLit = lampOn;
  {
    const fl = F.TS.f + 0.03, gl = F.TS.sw * 0.7, zt = F.TS.sz + (F.S.lampPole ?? 0.07);
    K.box(...H(fl - 0.004, gl - 0.004, zt), ...H(fl + 0.004, gl + 0.004, zt + 0.007), 'dash', 0.2, lampOn ? SK.lensOn : SK.lens, lampOn ? 1 : 0);
    K.box(...H(fl - 0.0045, gl - 0.0045, zt + 0.007), ...H(fl + 0.0045, gl + 0.0045, zt + 0.0085), 'dash', 0.1, SK.cowlDk);
  }
  // The lamp switch: a riveted box with a toggle, LAMP stamped under it.
  {
    const Lp = lampPanel(K, F);
    K.obox(Lp.pt(0, 0, -0.011), Lp.r, Lp.u, Lp.n, 0.05, 0.04, 0.011, 'dash', 0.2, SK.alu);
    Lp.rect(-0.046, -0.036, 0.046, 0.036, SK.plate, 0, 0.0015);
    Lp.disc(0, 0.012, 0.009, C.chrome, 0.1, 0.003, 8);
    K.rod(Lp.pt(0, 0.012, 0.004), Lp.pt(0, 0.012 + (lampOn ? 0.016 : -0.016), 0.026), 0.0035, 'dash', 0.2, C.chrome, 0.1, 5);
    Lp.text('LAMP', 0, -0.022, 0.022, SK.ink, 0.05, 0.0034);
    for (const a of [-0.040, 0.040]) for (const b of [-0.030, 0.030]) Lp.disc(a, b, 0.0035, SK.rivet, 0, 0.002, 6);
  }
  // The fish finder's screen, drawn from the cells the seat hands it. A run of one level on a row is
  // one rect, so a frame costs a few dozen faces. Dark when it's off.
  {
    const U = sonarAt(K, F), P = U.P, sa = 0.100, b0 = -0.036, b1 = 0.082, D = L.sonar;
    P.rect(-sa, b0, sa, b1, SK.lcd, D ? 0.25 : 0, 0.0016);
    if (D && D.cells && D.w > 0 && D.h > 0) {
      const cw = (2 * sa) / D.w, ch = (b1 - b0) / D.h;
      for (let y = 0; y < D.h; y++) {
        const row = y * D.w, bt = b1 - (y + 1) * ch;
        let x = 0;
        while (x < D.w) {
          const lv = D.cells[row + x];
          let e = x + 1;
          while (e < D.w && D.cells[row + e] === lv) e++;
          if (lv > 0) P.rect(-sa + x * cw, bt, -sa + e * cw, bt + ch, SONAR_LCD[lv > 3 ? 3 : lv], 1, 0.0024);
          x = e;
        }
      }
      if (Number.isFinite(D.depthM)) P.digits(0.046, 0.060, 0.019, String(Math.round(D.depthM)).padStart(3, ' '), SONAR_LCD[3], false);
    }
  }
  // The anchor on the foredeck with its rode coiled beside it, or, at anchor, the rode from the cleat
  // over the bow.
  {
    const fa = LEN * 0.74, fc = LEN * 0.84, dza = deckZ(fa, 0) + 0.002;
    const cl = H(fc, 0, deckZ(fc, 0) + 0.0075);
    if (!L.anchored) {
      K.rod(H(fa - 0.022, 0, dza), H(fa + 0.016, 0, dza), 0.011, 'dash', 0.1, SK.anchor, 0, 5);           // the shank
      K.rod(H(fa + 0.012, -0.020, dza + 0.001), H(fa + 0.012, 0.020, dza + 0.001), 0.008, 'dash', 0.1, SK.anchor, 0, 5);   // the stock
      for (const s of [-1, 1]) {
        faceToward(K, [H(fa + 0.010, s * 0.002, dza), H(fa - 0.016, s * 0.016, dza), H(fa - 0.006, s * 0.003, dza)], [0, 0, 1], SK.anchor, 0.1);
      }
      const cc = H(fa - 0.044, 0.0, dza);
      K.torus(cc, [1, 0, 0], [0, 1, 0], 0.085, 0.014, 14, 'dash', 0.1, SK.rope);
      K.torus(add(cc, [0, 0, 0.018]), [1, 0, 0], [0, 1, 0], 0.070, 0.014, 14, 'dash', 0.1, SK.rope);
      K.torus(add(cc, [0, 0, 0.034]), [1, 0, 0], [0, 1, 0], 0.056, 0.014, 14, 'dash', 0.1, SK.rope);
      line(K, [add(cc, [0.07, 0.03, 0.02]), H(fa - 0.022, 0.002, dza + 0.002)], 0.010, SK.rope);
      line(K, [add(cc, [-0.05, 0.06, 0.02]), H(fc - 0.010, -0.004, deckZ(fc, 0) + 0.004), cl], 0.010, SK.rope);
    } else {
      // It goes over the stem and out of sight, a rope's thickness inside the stem.
      const roller = H(LEN - 0.006, 0, deckZ(LEN - 0.006, 0) + 0.003);
      line(K, [cl, H(fc + 0.02, 0, deckZ(fc + 0.02, 0) + 0.004), roller, H(LEN - 0.003, 0, G.atF(LEN).sz - 0.02)], 0.011, SK.rope);
      // A turn round the cleat's horns.
      K.torus(cl, [0, 1, 0], [1, 0, 0], 0.05, 0.010, 10, 'dash', 0.1, SK.rope);
    }
  }
  // The fish box lid, hinged aft, with FISH on it and a handle at its forward edge.
  {
    const D = lidAt(F, L);
    const c = [[-D.W, 0], [D.W, 0], [D.W, D.Ls], [-D.W, D.Ls]];
    const top = c.map(([g, a]) => D.P(g, a, 0.004)), bot = c.map(([g, a]) => D.P(g, a, 0));
    const nTop = norm(sub(D.P(0, 0, 1), D.P(0, 0, 0)));
    K.face(top, nTop, 'dash', 0.25, SK.boxLid);
    K.face(bot.slice().reverse(), mul(nTop, -1), 'dash', 0.1, SK.liner);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4, mid = mul(add(add(top[i], top[j]), add(bot[i], bot[j])), 0.25), cen = D.P(0, D.Ls / 2, 0.002);
      faceToward(K, [bot[i], bot[j], top[j], top[i]], sub(mid, cen), SK.boxLid, 0.15);
    }
    // Open, you're looking at its underside, so there's nothing to read.
    if (!L.boxOpen) {
      const Dp = lidPanel(K, D);
      Dp.text('FISH', 0, 0, 0.078, SK.white, 0.05, 0.0034);
      for (const a of [-0.21, 0.21]) Dp.rect(a - 0.02, -0.22, a + 0.02, 0.22, SK.boxRib, 0, 0.0016);
    }
    // The handle across the aft edge, and the two hinges forward.
    const h0 = D.P(-0.012, D.Ls - 0.006, 0.004), h1 = D.P(0.012, D.Ls - 0.006, 0.004);
    line(K, [h0, D.P(-0.012, D.Ls - 0.006, 0.009), D.P(0.012, D.Ls - 0.006, 0.009), h1], 0.007, SK.cowlDk, 4);
    for (const g of [-D.W * 0.6, D.W * 0.6]) K.box(...D.P(g - 0.006, -0.0015, 0.0), ...D.P(g + 0.006, 0.004, 0.0045), 'dash', 0.1, SK.alu);
  }
  // What's on the ice, with the lid up: a fish lying each way across the box for every sixth of it.
  if (L.boxOpen && L.boxFill > 0) {
    const { S } = F, f0 = S.fishBox[0] * LEN, f1 = S.fishBox[1] * LEN, zi = G.soleZ + (S.fishBoxH ?? 0.032) - 0.0135;
    const n = Math.min(6, Math.ceil(clamp(L.boxFill, 0, 1) * 6)), w = G.atF((f0 + f1) / 2).sw * 0.30;
    for (let i = 0; i < n; i++) {
      const fm = f0 + (f1 - f0) * (0.2 + 0.6 * ((i >> 1) / 2)), gm = (i % 2 ? 1 : -1) * w * 0.5, d = i % 2 ? 1 : -1, l = 0.030, z = zi + i * 0.0003;
      const P2 = (a, b) => H(fm + b, gm + a * d, z);
      faceToward(K, [P2(-l, 0), P2(-l * 0.5, 0.006), P2(l * 0.3, 0.008), P2(l * 0.8, 0.003), P2(l * 0.8, -0.003), P2(l * 0.3, -0.008), P2(-l * 0.5, -0.006)], [0, 0, 1], SK.fish, 0.2);
      faceToward(K, [P2(l * 0.75, 0), P2(l * 1.15, 0.007), P2(l * 1.15, -0.007)], [0, 0, 1], SK.fishDk, 0.1);
      faceToward(K, [P2(-l * 0.5, 0.0012), P2(l * 0.3, 0.0016), P2(l * 0.3, -0.0016), P2(-l * 0.5, -0.0012)], [0, 0, 1], SK.fishDk, 0.1);
    }
  }
  // The primer bulb, squeezed flat while `prime` is pressed.
  {
    const Tp = tankPanel(K, F), sq = clamp(L.prime || 0, 0, 1);
    const r = 0.024 * (1 - 0.45 * sq);
    K.rod(Tp.pt(BULB.a, BULB.b0, 0.006 + r), Tp.pt(BULB.a, BULB.b1, 0.006 + r), r, 'dash', 0.2, SK.rubber, 0, 8);
    for (const [b0, b1] of [[BULB.b0 - 0.014, BULB.b0], [BULB.b1, BULB.b1 + 0.014]]) K.rod(Tp.pt(BULB.a, b0, 0.006 + r), Tp.pt(BULB.a, b1, 0.006 + r), r * 0.6, 'dash', 0.2, SK.rubber, 0, 6);
    // The tank's gauge, in its cap: the needle reads the fuel left.
    capPanel(K, Tp).dial(0, 0, 0.030, clamp(L.fuel ?? 1, 0, 1), { a0: Math.PI * 0.83, sweep: Math.PI * 0.66, ticks: 4, major: 2, face: C.white, tick: C.black, needle: C.red, bezel: SK.cowlDk });
    Tp.text('E', 0.040, -0.075, 0.016, SK.white, 0.1, 0.0034);
    Tp.text('F', 0.110, -0.075, 0.016, SK.white, 0.1, 0.0034);
  }
  // The tiller: the swivel, the arm, the housing with the kill switch and the choke, the twist grip.
  {
    const T = tillerAt(F, L), { at, Lt, GRIP, aH } = T;
    K.obox(T.root, T.A, T.N, T.S, 0.035, 0.030, 0.045, 'dash', 0.1, SK.cowlDk);
    K.rod(T.root, at(aH - 0.07, 0, 0), 0.017, 'dash', 0.2, SK.cowl, 0, 8);
    K.rod(at(aH + 0.07, 0, 0), at(Lt - GRIP, 0, 0), 0.017, 'dash', 0.2, SK.cowl, 0, 8);
    K.obox(at(aH, 0, 0.0055), T.A, T.N, T.S, 0.072, 0.0275, 0.050, 'dash', 0.2, SK.cowl);
    const Hp = housingPanel(K, T);
    Hp.rect(-0.068, -0.046, 0.068, 0.046, SK.plate, 0, 0.001);
    // The kill switch: a red cap with the cord's clip on it, and the cord down to the thwart.
    const [ku, kv] = HOUSING.kill;
    Hp.stud(ku, kv, 0.015, 0.010, 0.010, SK.red, 0.05, 0.001);
    Hp.stud(ku, kv, 0.008, 0.013, 0.008, [150, 24, 20], 0.05, 0.011);
    {
      const p0 = Hp.pt(ku - 0.006, -0.046, 0.012), p1 = at(aH + 0.05, -0.08, -0.06), fT = F.G.thwartTop(F.S.thwarts[0] * LEN);
      const p2 = [F.xC - 0.20, -0.16, (fT - F.E.z) * F.m + 0.012];
      const pts = [];
      for (let i = 0; i <= 20; i++) {
        const t = i / 20, base = t < 0.4 ? lerp3(p0, p1, t / 0.4) : lerp3(p1, p2, (t - 0.4) / 0.6);
        const ang = t * Math.PI * 12, rr = t < 0.05 ? 0 : 0.012;
        pts.push(add(base, [Math.cos(ang) * rr, Math.sin(ang) * rr * 0.4, Math.sin(ang) * rr]));
      }
      line(K, pts, 0.0035, SK.red, 4);
    }
    Hp.text('KILL', ku, -0.034, 0.012, SK.ink, 0.05, 0.0034);
    // The choke: a black knob, out while it is on.
    const [cu, cv] = HOUSING.choke;
    Hp.disc(cu, cv, 0.013, SK.cowlDk, 0, 0.002, 10);
    Hp.knob(cu, cv, 0.0095, L.choke ? 0.030 : 0.013, SK.rubber, 0);
    Hp.text('CHOKE', cu, -0.034, 0.012, SK.ink, 0.05, 0.0034);
    // SLOW, the arrow, FAST: which way the grip turns.
    Hp.text('SLOW', HOUSING.slow[0], HOUSING.slow[1], 0.012, SK.ink, 0.05, 0.0034);
    Hp.text('FAST', HOUSING.fast[0], HOUSING.fast[1], 0.012, SK.ink, 0.05, 0.0034);
    Hp.rect(-0.013, 0.0295, 0.008, 0.0325, SK.ink, 0.05, 0.002);
    Hp.plate([[0.016, 0.031], [0.006, 0.037], [0.006, 0.025]], SK.ink, 0.05, 0.002);
    // The grip: rubber, a collar where it meets the arm, an end cap, and a white index line that
    // turns with the throttle.
    K.rod(at(Lt - GRIP, 0, 0), at(Lt - GRIP + 0.012, 0, 0), 0.025, 'dash', 0.2, SK.cowlDk, 0, 10);
    K.rod(at(Lt - GRIP + 0.012, 0, 0), at(Lt - 0.008, 0, 0), 0.021, 'dash', 0.1, SK.rubber, 0, 10);
    K.rod(at(Lt - 0.008, 0, 0), at(Lt, 0, 0), 0.019, 'dash', 0.2, SK.cowlDk, 0, 10);
    const phi = -0.9 + 1.6 * clamp(L.throttle || 0, 0, 1), r = 0.0215;
    const ix = (a) => at(a, Math.sin(phi) * r, Math.cos(phi) * r);
    K.rod(ix(Lt - GRIP + 0.02), ix(Lt - 0.02), 0.0025, 'dash', 0.3, SK.white, 0.2, 4);
  }
  // The starter cord's T-handle on the front of the cowl.
  {
    const pu = pullAt(F);
    K.rod(sub(pu, [0.045, 0, 0]), add(pu, [0.045, 0, 0]), 0.011, 'dash', 0.2, SK.rubber, 0, 6);
    K.rod([pu[0], pu[1] - 0.004, pu[2]], [pu[0], pu[1] + 0.012, pu[2]], 0.004, 'dash', 0.1, SK.cowlDk, 0, 4);
  }
  // The halo round the control under the pointer (boat-view.js sends `hover` and `press`).
  hotspotHalo(K, skiffHotspots(P, L), L);
}

// ── THE PROFILE ──────────────────────────────────────────────────────────────
// An open boat's seat. It is not a room: `open` says so, and the shell gate holds her to the
// open-boat rays (scripts/shapes/shell.mjs) instead of the closed-room ones.
export function skiffProfile(row, id) {
  const F = skiffFrame(row);
  const fl = F.TS.f + 0.03, gl = F.TS.sw * 0.7, zt = F.TS.sz + (F.S.lampPole ?? 0.07);
  const lampP = F.H(fl, gl, zt + 0.004);
  return {
    label: 'open skiff',
    hull: id, open: true, frame: F,
    xCentre: F.xC, halfW: F.halfW,
    floor: F.floor, roof: 0.10, front: F.front, back: F.back,
    seatZ: (F.G.thwartTop(F.E.f) - F.E.z) * F.m,
    eyeM: F.E.eyeM,
    normalLit: true,
    // The all-round lamp lights the boat when it is switched on, off the boat's battery.
    lampLit: false,
    get floods() { return this.lampLit ? [{ p: lampP, r: 2.6 }] : null; },
    room: (P, live, push) => skiffRoom(P, live, push),
    hotspots(live) { return skiffHotspots(this, live); },
  };
}
