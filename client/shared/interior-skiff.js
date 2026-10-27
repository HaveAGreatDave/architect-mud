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
// the things sized for a person (the grip, the knobs, the tank, the lettering) are authored in
// metres. The eye is the exterior's helm point (boat-house.js, the aft thwart), so `eyeM` and the
// sea's metre agree with the boat drawn from outside.
//
// Two places differ from the exterior on purpose, and aircraft3d.js should follow them:
//   · the outboard stands on the transom with its cowl above it. The exterior's cowl top is below
//     the transom's top edge, so from the thwart there was no motor behind you at all;
//   · the tiller reaches forward to beside the aft thwart. The exterior's ends behind it, where no
//     hand on the thwart can reach.
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
// Nothing is branded; Keel built her.
//
// The live keys it reads: `throttle`, `steer`, `fuel`, `running`, `hover`, `press` (all sent by
// boat-view.js today) and `anchored`, `lamp`, `boxOpen`, `choke`, `prime` (0..1, the bulb squeezed)
// and `rod` (rod mode: the holder is empty), which the seat sends as it wires them.
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
  alu: [122, 128, 132],        // mill-finish aluminium: thwarts, gunwale bars, the cleat
  hull: [88, 95, 100],         // the inside of the hull plating, weathered
  hullDk: [70, 76, 81],        // the topsides low down, in their own shadow
  sole: [62, 67, 70],          // the sole, scuffed
  rib: [104, 110, 115],        // the frames
  rivet: [150, 155, 158],      // the rivet heads
  plate: [196, 198, 192],      // a stamped tag or decal: light, so the ink is dark on it
  ink: [26, 28, 30],           // stamped or painted lettering on a light face
  white: [232, 232, 226],      // painted lettering on a dark or red face
  tank: [176, 40, 30],         // the fuel tank
  box: [196, 198, 190],        // the fish box, insulated plastic
  boxLid: [182, 186, 178],
  ice: [130, 148, 152],        // inside the fish box
  cowl: [44, 48, 56],          // the outboard's cowl and the tiller arm
  cowlDk: [28, 30, 34],
  rubber: [22, 22, 24],        // the grip, the bulb, the hose
  red: [196, 34, 28],          // the kill switch and its cord
  rope: [176, 150, 104],       // the rode
  lens: [228, 224, 206],       // the lamp, off
  lensOn: [255, 244, 214],     // the lamp, lit
  anchor: [70, 74, 80],        // galvanised steel
};
// Mill finish is dull: a broad, weak sheen. At 0.45 the thwarts flared white under a noon sky.
SHINY.set(SK.alu, { spec: 0.12, pow: 10 }); TEXTURE.set(SK.alu, 'brushed');
SHINY.set(SK.rib, { spec: 0.10, pow: 10 }); TEXTURE.set(SK.rib, 'brushed');
SHINY.set(SK.rivet, { spec: 0.6, pow: 30 });
TEXTURE.set(SK.hull, 'brushed'); TEXTURE.set(SK.hullDk, 'brushed'); TEXTURE.set(SK.sole, 'cast');
TEXTURE.set(SK.tank, 'paint'); SHINY.set(SK.tank, { spec: 0.4, pow: 24, coat: 0.3 });
TEXTURE.set(SK.box, 'plastic'); TEXTURE.set(SK.boxLid, 'plastic');
TEXTURE.set(SK.cowl, 'paint'); SHINY.set(SK.cowl, { spec: 0.5, pow: 30, coat: 0.4 });
TEXTURE.set(SK.rubber, 'rubber'); TEXTURE.set(SK.rope, 'fabric');

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
  // The well's wall and topside, as the exterior cuts them (aircraft3d.js, the gunwale cap and the
  // well walls): the wall from 0.78 of the half-beam at the sole up to 0.80 at 0.030 under the
  // sheer, then the topside out to the sheer. `INB` keeps the sheer edge a hair inboard of the skin.
  const INB = 0.992;
  const wallLo = (f) => 0.78 * G.atF(f).sw, wallHi = (f) => 0.80 * G.atF(f).sw;
  const capZ = (f) => G.atF(f).sz - 0.030;
  // A point on the topside at fraction t (0 at the top of the wall, 1 at the sheer).
  const topside = (f, s, t) => { const a = G.atF(f); return [f, s * (wallHi(f) + (a.sw * INB - wallHi(f)) * t), capZ(f) + (a.sz - capZ(f)) * t]; };
  // The deck surface fore and aft of the well: the sheer at the side, `crown` higher on the centreline.
  const deckZ = (f, g) => { const a = G.atF(f); return a.sz + crown * Math.max(0, 1 - Math.abs(g) / (a.sw || 1)); };
  // Where a thwart's underside meets the topside: it rests on it rather than stopping in the air.
  const thwartEnd = (f, zb) => {
    const a = G.atF(f), t = clamp((zb - capZ(f)) / ((a.sz - capZ(f)) || 1), 0, 1);
    return wallHi(f) + (a.sw * INB - wallHi(f)) * t - 0.001;
  };
  // The outboard, on the transom with its cowl above it (see the header).
  const mot = {
    f0: TS.f - 0.088 * Mo, f1: TS.f + 0.006 * Mo,
    hw: 0.021 * Mo, z0: TS.sz - 0.012, zMid: TS.sz + 0.020, z1: TS.sz + 0.045,
  };
  // The extent in metres, for the bounds (interior-shell.js shellBounds).
  const maxSw = Math.max(...G.STATIONS.map((s) => s.sw));
  F = {
    G, E, m, S, LEN, H, TS, Mo, cpF0, cpF1, crown, sole, INB, wallLo, wallHi, capZ, topside, deckZ, thwartEnd, mot,
    xC: -E.g * m,
    halfW: (maxSw + 0.004) * m,
    front: (LEN - E.f) * m + 0.02,
    back: (mot.f0 - E.f) * m - 0.03,
    floor: (sole - E.z) * m - 0.01,
  };
  FRAMES.set(row, F);
  return F;
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
const TANK = { x0: 0.50, x1: 0.80, y0: 0.30, y1: 0.76, zt: -0.86 };
const tankPanel = (K, F) => K.panel([(TANK.x0 + TANK.x1) / 2, (TANK.y0 + TANK.y1) / 2, TANK.zt + 0.0005], [1, 0, 0], [0, 1, 0]);
const BULB = { a: -0.085, b0: -0.17, b1: -0.05 };   // on the tank top, in its panel's metres
const GAUGE = [0.075, -0.035];                      // the gauge in the filler cap, likewise
// The cap's top, which the gauge is drawn on: a panel of its own, or the dial is inside the cap.
const capPanel = (K, Tp) => K.panel(Tp.pt(GAUGE[0], GAUGE[1], 0.0105), [1, 0, 0], [0, 1, 0]);

// The lamp switch: a box riveted to the starboard topside just forward of the aft thwart.
function lampPanel(K, F) {
  const { H, topside, E, m } = F;
  const f = E.f + 0.40 / m;
  const lo = H(...topside(f, 1, 0.30)), hi = H(...topside(f, 1, 0.70));
  const u = norm(sub(hi, lo)), r = [0, -1, 0], n = norm(cross(r, u));
  return K.panel(add(lerp3(lo, hi, 0.5), mul(n, 0.022)), r, u);
}
// The rod holder, clamped to the starboard gunwale abreast of you, and the tag on its clamp.
function rodAt(F) {
  const { H, G, E, m } = F;
  const f = E.f + 0.80 / m, a = G.atF(f);
  const base = H(f, a.sw * 0.955, a.sz + 0.001);
  const dir = norm([0.10, -0.42, 0.90]);
  return { base, top: add(base, mul(dir, 0.28)), dir, tag: [base[0] - 0.065, base[1], base[2] + 0.045] };
}
const rodPanel = (K, R) => K.panel(R.tag, [0, -1, 0], [0, 0, 1]);
// The fish box lid, hinged at its aft edge so it opens up toward you.
function lidAt(F, L) {
  const { G, S, LEN, H } = F;
  const f0 = S.fishBox[0] * LEN, f1 = S.fishBox[1] * LEN;
  const w = G.atF((f0 + f1) / 2).sw * 0.40, zt = G.soleZ + (S.fishBoxH ?? 0.032);
  const th = L.boxOpen ? 1.25 : 0, c = Math.cos(th), s = Math.sin(th);
  const fh = f0 - 0.002, zh = zt - 0.004, Ls = (f1 + 0.002) - fh, W = w * 1.05;
  // (g, along from the hinge, up through the lid) in model units, to metres.
  const P = (g, a, t) => H(fh + a * c - t * s, g, zh + a * s + t * c);
  return { f0, f1, w, zt, W, Ls, P, th, u: [0, c, s] };
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
  out.push({ id: 'box', p: lidPanel(K, D).pt(0, 0, 0.004), r: 0.12, kind: 'click' });
  const R = rodAt(F);
  out.push({ id: 'rod', p: rodPanel(K, R).pt(0, 0, 0.004), r: 0.045, kind: 'click' });
  out.push({ id: 'rod', p: R.top, r: 0.045, kind: 'click' });
  const pu = pullAt(F);
  out.push({ id: 'ign', p: [pu[0], pu[1] + 0.03, pu[2]], r: 0.040, kind: 'click' });
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
  const { H, G, sole, wallLo, wallHi, capZ, topside, deckZ, cpF0, cpF1, TS, LEN } = F;
  const fs = wellStations(F);
  // The sole, the walls and the topsides, both sides.
  for (let i = 0; i < fs.length - 1; i++) {
    const f0 = fs[i], f1 = fs[i + 1];
    K.face([H(f0, -wallLo(f0), sole), H(f0, wallLo(f0), sole), H(f1, wallLo(f1), sole), H(f1, -wallLo(f1), sole)], [0, 0, 1], 'floor', -0.1, SK.sole);
    for (const s of [-1, 1]) {
      const inb = [-s, 0, 0];
      quad2(K, H(f0, s * wallLo(f0), sole), H(f1, s * wallLo(f1), sole), H(f1, s * wallHi(f1), capZ(f1)), H(f0, s * wallHi(f0), capZ(f0)), inb, SK.hullDk, 0);
      quad2(K, H(...topside(f0, s, 0)), H(...topside(f1, s, 0)), H(...topside(f1, s, 1)), H(...topside(f0, s, 1)), inb, SK.hull, 0.1);
      // The gunwale: a flat bar along the sheer, riveted down.
      const a0 = G.atF(f0), a1 = G.atF(f1);
      const q = [H(f0, s * a0.sw * 0.95, a0.sz + 0.0012), H(f1, s * a1.sw * 0.95, a1.sz + 0.0012), H(f1, s * a1.sw * 0.999, a1.sz + 0.0012), H(f0, s * a0.sw * 0.999, a0.sz + 0.0012)];
      K.face(q, [0, 0, 1], 'dash', 0.3, SK.alu);
      K.face([H(f0, s * a0.sw * 0.95, a0.sz + 0.0012), H(f1, s * a1.sw * 0.95, a1.sz + 0.0012), H(f1, s * a1.sw * 0.95, a1.sz - 0.0035), H(f0, s * a0.sw * 0.95, a0.sz - 0.0035)], inb, 'dash', 0.1, SK.alu);
    }
  }
  // The ribs: a frame up each wall and topside and across the sole, every 0.42 m or so, with a rivet
  // line down each; and a seam of rivets along each topside and along each gunwale bar.
  const NR = 11;
  for (let k = 0; k <= NR; k++) {
    const f = cpF0 + 0.012 + (cpF1 - cpF0 - 0.024) * (k / NR);
    for (const s of [-1, 1]) {
      const b = H(f, s * wallLo(f), sole), w = H(f, s * wallHi(f), capZ(f)), t = H(...topside(f, s, 0.97));
      const nW = norm(cross(sub(w, b), [0, 1, 0])), nT = norm(cross(sub(t, w), [0, 1, 0]));
      const nw = nW[0] * s > 0 ? mul(nW, -1) : nW, nt = nT[0] * s > 0 ? mul(nT, -1) : nT;
      flatBar(K, b, w, nw, 0.034, 0.010, SK.rib);
      flatBar(K, w, t, nt, 0.034, 0.010, SK.rib);
      for (let j = 1; j <= 2; j++) rivet(K, add(lerp3(b, w, j / 3), mul(nw, 0.010)), nw);
      for (let j = 1; j <= 3; j++) rivet(K, add(lerp3(w, t, j / 4), mul(nt, 0.010)), nt);
    }
    // Across the sole.
    flatBar(K, H(f, -wallLo(f) + 0.004, sole), H(f, wallLo(f) - 0.004, sole), [0, 0, 1], 0.030, 0.014, SK.rib, 0.1);
  }
  for (let i = 0; i < 40; i++) {
    const f = cpF0 + 0.006 + (cpF1 - cpF0 - 0.012) * (i / 39);
    for (const s of [-1, 1]) {
      const a = H(...topside(f, s, 0.45)), b = H(...topside(f + 0.002, s, 0.45)), c = H(...topside(f, s, 0.55));
      let n = norm(cross(sub(b, a), sub(c, a)));
      if (n[0] * s > 0) n = mul(n, -1);
      rivet(K, a, n, 0.0055);
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
        faceToward(K, [H(p, s * ap.sw * 0.999, ap.sz), H(q, s * aq.sw * 0.999, aq.sz), H(q, 0, deckZ(q, 0))], [0, 0, 1], SK.alu, 0.2);
        faceToward(K, [H(p, s * ap.sw * 0.999, ap.sz), H(q, 0, deckZ(q, 0)), H(p, 0, deckZ(p, 0))], [0, 0, 1], SK.alu, 0.2);
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
  // The thwarts, each resting on the topsides, with a rolled lip fore and aft and rivets at the ends.
  for (const u of (Array.isArray(F.S.thwarts) ? F.S.thwarts : [])) {
    const f = u * LEN, top = G.thwartTop(f), zb = top - 0.006, ge = F.thwartEnd(f, zb);
    K.box(...H(f - 0.024, -ge, zb), ...H(f + 0.024, ge, top), 'dash', 0, SK.alu);
    for (const d of [-1, 1]) K.box(...H(f + d * 0.0235, -ge, zb - 0.004), ...H(f + d * 0.0225, ge, zb), 'dash', -0.1, SK.alu);
    for (const s of [-1, 1]) for (const d of [-0.012, 0.012]) rivet(K, H(f + d, s * (ge - 0.006), top), [0, 0, 1], 0.006);
  }
}

// ── THE FITTINGS THAT DO NOT MOVE ────────────────────────────────────────────
function fixedParts(K, F) {
  const { H, G, LEN, TS, mot, xC, deckZ, S, E, m } = F;
  // The outboard: the clamp bracket over the transom, the lower cowl and the upper cowl.
  K.box(...H(TS.f - 0.004, -mot.hw * 0.8, TS.sz - 0.004), ...H(TS.f + 0.004, mot.hw * 0.8, TS.sz + 0.004), 'dash', 0.1, SK.cowlDk);
  K.box(...H(mot.f0, -mot.hw, mot.z0), ...H(mot.f1, mot.hw, mot.zMid), 'dash', 0.1, SK.cowlDk);
  K.box(...H(mot.f0 + 0.004 * F.Mo, -mot.hw * 0.92, mot.zMid), ...H(mot.f1 - 0.003 * F.Mo, mot.hw * 0.92, mot.z1), 'dash', 0.2, SK.cowl);
  // PULL on the cowl top, near its front, read turned round to face aft.
  const cowlTop = K.panel(H(mot.f1 - 0.012, 0, mot.z1 + 0.0004), [-1, 0, 0], [0, -1, 0]);
  cowlTop.rect(-0.07, -0.03, 0.07, 0.03, SK.plate, 0, 0.001);
  cowlTop.text('PULL', 0, 0, 0.034, SK.ink, 0.05, 0.002);
  // The lamp pole on the starboard quarter, its foot on the transom deck.
  const fl = TS.f + 0.03, gl = TS.sw * 0.7, zb = deckZ(fl, gl), zt = TS.sz + (S.lampPole ?? 0.07);
  K.rod(H(fl, gl, zb), H(fl, gl, zt), 0.0025 * m, 'dash', 0.2, SK.alu, 0, 6);
  K.box(...H(fl - 0.003, gl - 0.003, zb), ...H(fl + 0.003, gl + 0.003, zb + 0.003), 'dash', 0.1, SK.alu);
  // The lamp's cable, from the switch aft along the topside and over the deck to the pole's foot.
  const lp = lampPanel(K, F);
  const fA = F.cpF0 + 0.004;
  line(K, [lp.pt(0, -0.045, -0.018), H(...F.topside(E.f + 0.25 / m, 1, 0.75)), H(...F.topside(fA, 1, 0.75)), H(fl, gl, zb + 0.002)], 0.004, SK.rubber, 4);
  // The rod holder: a clamp on the gunwale, the tube, and the tag riveted to the clamp.
  const R = rodAt(F);
  K.box(R.base[0] - 0.06, R.base[1] - 0.045, R.base[2] - 0.03, R.base[0] + 0.03, R.base[1] + 0.045, R.base[2] + 0.02, 'dash', 0.2, SK.alu);
  K.rod(add(R.base, mul(R.dir, 0.01)), R.top, 0.022, 'dash', 0.2, SK.alu, 0, 8, false);
  K.rod(sub(R.top, mul(R.dir, 0.02)), R.top, 0.026, 'dash', 0.2, SK.alu, 0, 8, false);
  K.rod(R.top, add(R.top, mul(R.dir, -0.004)), 0.016, 'dash', 0, SK.cowlDk, 0, 8);
  K.box(R.tag[0] + 0.0005, R.tag[1] - 0.052, R.base[2] + 0.012, R.tag[0] + 0.006, R.tag[1] + 0.052, R.tag[2] + 0.030, 'dash', 0.2, SK.alu);
  const Rp = rodPanel(K, R);
  Rp.rect(-0.05, -0.028, 0.05, 0.028, SK.plate, 0, 0.001);
  Rp.text('ROD', 0, 0, 0.030, SK.ink, 0.05, 0.002);
  for (const a of [-0.042, 0.042]) Rp.disc(a, 0.019, 0.004, SK.rivet, 0, 0.002, 6);
  // ANCHOR, painted on the forward bulkhead under the cleat.
  const Bp = bulkheadPanel(K, F);
  Bp.text('ANCHOR', 0, 0, 0.046, SK.ink, 0.05, 0.002);
  // The cleat on the foredeck, lying fore and aft as the exterior's does.
  const fc = LEN * 0.84, dzc = deckZ(fc, 0);
  K.box(...H(fc - 0.008, -0.003, dzc), ...H(fc + 0.008, 0.003, dzc + 0.005), 'dash', 0.2, SK.alu);
  K.box(...H(fc - 0.015, -0.0028, dzc + 0.005), ...H(fc + 0.015, 0.0028, dzc + 0.0085), 'dash', 0.3, SK.alu);
  // The fuel tank, its handle, cap, gauge, and the lettering.
  const Tz0 = F.floor + 0.012;
  K.box(TANK.x0, TANK.y0, Tz0, TANK.x1, TANK.y1, TANK.zt, 'dash', 0.2, SK.tank);
  const Tp = tankPanel(K, F);
  Tp.text('FUEL', 0, 0.13, 0.052, SK.white, 0.1, 0.002);
  Tp.text('PRIME', 0.062, -0.11, 0.028, SK.white, 0.1, 0.002);
  // An arrow from PRIME to the bulb.
  Tp.rect(-0.030, -0.112, -0.006, -0.108, SK.white, 0.1, 0.002);
  Tp.plate([[-0.040, -0.110], [-0.028, -0.100], [-0.028, -0.120]], SK.white, 0.1, 0.002);
  K.rod(Tp.pt(-0.11, 0.21, 0.0), Tp.pt(-0.11, 0.21, 0.05), 0.008, 'dash', 0.1, SK.cowlDk, 0, 4);
  K.rod(Tp.pt(0.11, 0.21, 0.0), Tp.pt(0.11, 0.21, 0.05), 0.008, 'dash', 0.1, SK.cowlDk, 0, 4);
  K.rod(Tp.pt(-0.11, 0.21, 0.05), Tp.pt(0.11, 0.21, 0.05), 0.010, 'dash', 0.1, SK.cowlDk, 0, 6);
  Tp.knob(GAUGE[0], GAUGE[1], 0.040, 0.010, SK.cowlDk, 0);
  // The hose: from the connector at the tank's aft end, over the tank top to the bulb, then off the
  // tank's port side to the sole, aft under the thwart, up the aft bulkhead and over to the motor.
  const hz = TANK.zt + 0.012;
  const bulbA = Tp.pt(BULB.a, BULB.b0, 0.03), bulbF = Tp.pt(BULB.a, BULB.b1, 0.03);
  const fB = F.cpF0;
  line(K, [Tp.pt(BULB.a, -0.215, 0.012), Tp.pt(BULB.a, BULB.b0 - 0.02, 0.025), bulbA], 0.007, SK.rubber);
  line(K, [bulbF, Tp.pt(BULB.a, BULB.b1 + 0.03, 0.02), [TANK.x0 - 0.02, 0.58, hz - 0.04], [TANK.x0 - 0.04, 0.50, F.floor + 0.03],
    [0.44, 0.0, F.floor + 0.03], H(fB + 0.004, 0.012, F.sole + 0.004), H(fB + 0.002, 0.012, G.atF(fB).sz - 0.004),
    H(TS.f + 0.004, 0.012, TS.sz + 0.004), H(mot.f1 + 0.001, 0.012, TS.sz + 0.004)], 0.007, SK.rubber);
  // The fish box's body: four insulated walls and the ice inside, which shows with the lid up.
  const D = { f0: S.fishBox[0] * LEN, f1: S.fishBox[1] * LEN };
  const w = G.atF((D.f0 + D.f1) / 2).sw * 0.40, zt2 = G.soleZ + (S.fishBoxH ?? 0.032) - 0.004, th = 0.003;
  K.box(...H(D.f0, -w, G.soleZ), ...H(D.f0 + th, w, zt2), 'dash', 0.2, SK.box);
  K.box(...H(D.f1 - th, -w, G.soleZ), ...H(D.f1, w, zt2), 'dash', 0.2, SK.box);
  K.box(...H(D.f0, -w, G.soleZ), ...H(D.f1, -w + th, zt2), 'dash', 0.2, SK.box);
  K.box(...H(D.f0, w - th, G.soleZ), ...H(D.f1, w, zt2), 'dash', 0.2, SK.box);
  K.face([H(D.f0 + th, -w + th, zt2 - 0.010), H(D.f0 + th, w - th, zt2 - 0.010), H(D.f1 - th, w - th, zt2 - 0.010), H(D.f1 - th, -w + th, zt2 - 0.010)], [0, 0, 1], 'dash', 0.1, SK.ice);
}

// ── THE ROOM ─────────────────────────────────────────────────────────────────
export function skiffRoom(P, live, push) {
  const K = makeKit(push);
  const L = live || {}, F = P.frame, { H, G, LEN, xC, deckZ } = F;
  // Built once per seat (interior-memo.js): neither reads anything live. `F` is the profile's own
  // frame, and the memo is kept per profile, so it is closed over rather than compared every frame.
  K.group('skiffHull', (k) => hullParts(k, F));
  K.group('skiffFixed', (k) => fixedParts(k, F));
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
    Lp.text('LAMP', 0, -0.022, 0.018, SK.ink, 0.05, 0.002);
    for (const a of [-0.040, 0.040]) for (const b of [-0.030, 0.030]) Lp.disc(a, b, 0.0035, SK.rivet, 0, 0.002, 6);
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
    K.face(bot.slice().reverse(), mul(nTop, -1), 'dash', 0.1, SK.boxLid);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4, mid = mul(add(add(top[i], top[j]), add(bot[i], bot[j])), 0.25), cen = D.P(0, D.Ls / 2, 0.002);
      faceToward(K, [bot[i], bot[j], top[j], top[i]], sub(mid, cen), SK.boxLid, 0.15);
    }
    const Dp = lidPanel(K, D);
    Dp.text('FISH', 0, 0, 0.078, SK.ink, 0.05, 0.002);
    // The handle across the forward edge, and the two hinges aft.
    const h0 = D.P(-0.012, D.Ls - 0.006, 0.004), h1 = D.P(0.012, D.Ls - 0.006, 0.004);
    line(K, [h0, D.P(-0.012, D.Ls - 0.006, 0.009), D.P(0.012, D.Ls - 0.006, 0.009), h1], 0.007, SK.cowlDk, 4);
    for (const g of [-D.W * 0.6, D.W * 0.6]) K.box(...D.P(g - 0.006, -0.0015, 0.0), ...D.P(g + 0.006, 0.004, 0.0045), 'dash', 0.1, SK.alu);
  }
  // The primer bulb, squeezed flat while `prime` is pressed.
  {
    const Tp = tankPanel(K, F), sq = clamp(L.prime || 0, 0, 1);
    const r = 0.024 * (1 - 0.45 * sq);
    K.rod(Tp.pt(BULB.a, BULB.b0, 0.006 + r), Tp.pt(BULB.a, BULB.b1, 0.006 + r), r, 'dash', 0.2, SK.rubber, 0, 8);
    for (const [b0, b1] of [[BULB.b0 - 0.014, BULB.b0], [BULB.b1, BULB.b1 + 0.014]]) K.rod(Tp.pt(BULB.a, b0, 0.006 + r), Tp.pt(BULB.a, b1, 0.006 + r), r * 0.6, 'dash', 0.2, SK.rubber, 0, 6);
    // The tank's gauge, in its cap: the needle reads the fuel left.
    capPanel(K, Tp).dial(0, 0, 0.030, clamp(L.fuel ?? 1, 0, 1), { a0: Math.PI * 0.83, sweep: Math.PI * 0.66, ticks: 4, major: 2, face: C.white, tick: C.black, needle: C.red, bezel: SK.cowlDk });
    Tp.text('E', 0.040, -0.075, 0.016, SK.white, 0.1, 0.002);
    Tp.text('F', 0.110, -0.075, 0.016, SK.white, 0.1, 0.002);
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
    Hp.text('KILL', ku, -0.034, 0.012, SK.ink, 0.05, 0.002);
    // The choke: a black knob, out while it is on.
    const [cu, cv] = HOUSING.choke;
    Hp.disc(cu, cv, 0.013, SK.cowlDk, 0, 0.002, 10);
    Hp.knob(cu, cv, 0.0095, L.choke ? 0.030 : 0.013, SK.rubber, 0);
    Hp.text('CHOKE', cu, -0.034, 0.012, SK.ink, 0.05, 0.002);
    // SLOW, the arrow, FAST: which way the grip turns.
    Hp.text('SLOW', HOUSING.slow[0], HOUSING.slow[1], 0.012, SK.ink, 0.05, 0.002);
    Hp.text('FAST', HOUSING.fast[0], HOUSING.fast[1], 0.012, SK.ink, 0.05, 0.002);
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
