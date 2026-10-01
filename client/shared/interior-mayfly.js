// THE MAYFLY'S COCKPIT: a Cessna 172, side by side, the pilot in the left seat.
//
// The game calls it a cheap trainer you'll wreck, and that is what a 172 is: the aeroplane half the
// world learned in, a steel-grey panel with six round gauges in front of you, a radio stack in the
// middle, two chrome yokes coming out of the panel, a black throttle and a red mixture you push and
// pull, a flap lever with four stops, a trim wheel on the pedestal between your knees and the fuel
// selector on the floor behind it. None of it is clever and all of it is in reach.
//
// Sources read for the layout (the 172S steam panel, the one most trainers still fly):
//   https://www.pilotmall.com/blogs/news/breaking-down-everything-in-the-cessna-172-cockpit
//   https://www.flightnerdairforce.com/blog/cessna-172-instrument-panel-full-cockpit-layout-guide
//   https://cessna172sim.allanglen.com/docs/throttle-mixture-panel/
//   https://www.dimensions.com/element/cessna-172-skyhawk-aircraft  (cabin 1.00-1.12 m wide, 1.22 m tall)
// From them: the six-pack in front of the pilot in two rows of three (ASI, AI, ALT / TC, HI, VSI),
// the avionics stack in the middle, the engine gauges as dual needles down the left edge, the split
// red master and the light rockers along the bottom left, throttle (black) and mixture (red, ribbed)
// side by side under the stack, the flap lever to their right, trim wheel and fuel selector on the
// pedestal between the seats, the whiskey compass on the windscreen's centre strip.
//
// ── ⚠ THE ROOM IS THE EXTERIOR'S FUSELAGE, NEVER A SECOND DESCRIPTION OF IT ──
//
// The Drake's rule (interior-drake.js), applied to a box rather than a duck's head. The fuselage loft
// in mesh_ultralight.json is a super-ellipse of 12 sides per station, and its glass is listed by BAY
// (a station interval and a side index k). So the wall here is that same polygonal skin, walked bay
// by bay, pushed in by the skin's thickness — and a window is simply a bay the exterior calls glass,
// left out. The windscreen is bays k 1-4 from f 0.46 to 0.40, the side windows bays k 0 and 5 from
// f 0.43 back to -0.28, and the door posts are where the exterior's door outline says (f 0.30, 0.02).
// Edit the fuselage or its regions and the room follows; there is no number in this file that says
// where a window is.
//
// ── ⚠ ONE SCALE, AND WHY IT IS NOT THE LENGTH ────────────────────────────────
//
// A 172 is 8.28 m long and the model runs 1.795 units spinner to rudder, which is 4.61 m a unit. At
// that scale the cabin comes out 0.98 m wide and 1.02 m tall against a real 1.0-1.12 wide and 1.22
// tall: the exterior is a little long and a little squat for its cross-section. A cabin is a thing a
// person sits in, so the scale is taken off the SECTION: 1.22 / 0.222 (height) and 1.12 / 0.212
// (width) average to M_PER_UNIT = 5.4. What that costs is stated rather than hidden: the exterior's
// side glass runs from the cabin's widest line up only to 30 degrees round the section, so its top
// edge sits about at eye height, and the roof panel above it is solid because the exterior says so.
// The windscreen's base at the pilot's lateral station is also high (the model's cowl is tall), so
// the eye has to sit high enough to see over it, which puts the cushion lower to the floor than a
// real 172's. Everything a person touches (seats, yokes, dials, knobs) is authored in honest metres.
//
// Pure, like the rest of the interior: no clock, no camera, no DOM. `live` arrives as an argument,
// and every control's position is a function of it, so the gate can drive each to both stops.
import { makeKit, C, clamp, pedal, richSeat, SHINY, PANE, TEXTURE } from './interior-kit.js';
import { MESH_ROWS } from './vehicle-meshes.js';

const TAU = Math.PI * 2;
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
// A fraction that may have been sent as a percentage.
const frac01 = (v, d = 1) => { const x = num(v, d); return clamp(x > 1.001 ? x / 100 : x, 0, 1); };

// ── THE ONE SCALE AND WHERE THE PILOT'S EYE IS ───────────────────────────────
// See the note at the top. The eye is a PERSON: left of the centreline by a seat's half-width, over
// the front third of the door, and high enough that a level ray clears the windscreen's base.
export const M_PER_UNIT = 5.8;
export const MAYFLY_EYE = [0.24, -0.047, 0.105];   // [f, g, h] in model units: see ONE SCALE and THE EYE
const SKIN_M = 0.028;                              // the cabin skin plus its lining, in metres

// ── THE 172'S OWN COLOURS ────────────────────────────────────────────────────
// Authored here for the Drake's reason: this is the aircraft's trim, not a truck colourway.
export const MAYFLY_TRIM = {
  panel: [66, 70, 76], panelDk: [44, 47, 52], shield: [24, 25, 28], stack: [18, 19, 22],
  lining: [150, 144, 132], liningDk: [126, 120, 110], headliner: [192, 188, 176], carpet: [56, 56, 62],
  firewall: [70, 70, 74], seat: [98, 90, 80], seatDk: [74, 68, 60], seatSide: [60, 56, 52],
  frame: [132, 124, 112], yoke: [26, 26, 30], column: [196, 200, 206], placard: [226, 224, 216],
  throttle: [18, 18, 20], mixture: [190, 34, 32], cutoff: [206, 40, 36], bezel: [58, 60, 66],
  face: [18, 19, 22], lcd: [110, 236, 150], lcdBg: [10, 22, 16], amber: [255, 176, 64],
  gps: [18, 40, 34], magenta: [230, 90, 220], belt: [44, 48, 60], buckle: [168, 172, 178],
  visor: [70, 88, 70], green: [110, 236, 160], post: [255, 210, 150],
};
const T = MAYFLY_TRIM;
SHINY.set(T.column, { spec: 0.8, pow: 24, ramp: [[70, 72, 78], [236, 238, 242]], glint: 0.3, albedo: [236, 238, 242], envK: 0.8 });
SHINY.set(T.yoke, { spec: 0.35, pow: 30 });
SHINY.set(T.throttle, { spec: 0.4, pow: 40 });
SHINY.set(T.mixture, { spec: 0.45, pow: 40 });
SHINY.set(T.buckle, { spec: 0.7, pow: 30 });
SHINY.set(T.shield, { spec: 0.05, pow: 8 });
// What each surface is made of, for the GL pass's per-pixel texture. Lit colours, dial faces, glass
// and screens are left out on purpose: they are light, not material.
for (const [k, tex] of [['panel', 'paint'], ['panelDk', 'paint'], ['shield', 'plastic'], ['stack', 'plastic'],
  ['lining', 'leather'], ['liningDk', 'leather'], ['headliner', 'fabric'], ['carpet', 'carpet'], ['firewall', 'paint'],
  ['seat', 'fabric'], ['seatDk', 'leather'], ['seatSide', 'fabric'], ['frame', 'paint'], ['yoke', 'plastic'],
  ['column', 'brushed'], ['placard', 'paint'], ['throttle', 'plastic'], ['mixture', 'plastic'], ['cutoff', 'plastic'],
  ['bezel', 'cast'], ['belt', 'fabric'], ['buckle', 'brushed'], ['visor', 'plastic']]) TEXTURE.set(T[k], tex);
// Each gauge's glass catches a sliver of window light.
const GLINT = [255, 252, 244];
PANE.set(GLINT, 0.16);
// Soft contact shadows under what stands on a surface.
const SHADE = [0, 0, 2];
PANE.set(SHADE, 0.2);

// ── THE SKIN, AS THE EXTERIOR BUILDS IT ──────────────────────────────────────
//
// `emitLoft`'s own ring (vehicle-mesh.js, the `super` branch with `boxy`), and its own region test,
// so a bay is glass here exactly when it is glass outside.
const findPart = (parts, name) => {
  for (const p of parts || []) {
    if (p.name === name) return p;
    const q = findPart(p.parts, name);
    if (q) return q;
  }
  return null;
};
function skinOf(doc) {
  const fus = findPart(doc && doc.parts, 'fuselage');
  if (!fus || fus.section !== 'super') return null;
  const n = fus.sides;
  const sts = fus.stations.slice().sort((a, b) => b.f - a.f);
  const E = fus.exp || [1, 1, 1];
  const ring = (s) => {
    let eg = E[0], et = E[1], eb = E[2];
    if (s.boxy != null) { const e = 1 - s.boxy * 0.55; eg = e; et = e; eb = e; }
    const bot = s.keel == null ? s.rvB : s.rvB + s.keel;
    const o = [];
    for (let k = 0; k < n; k++) {
      const a = k / n * TAU, cs = Math.cos(a), sn = Math.sin(a);
      const g = Math.sign(cs) * Math.pow(Math.abs(cs), eg) * s.rg;
      const h = sn >= 0 ? Math.pow(sn, et) * s.rvT : -Math.pow(-sn, eb) * bot;
      o.push([s.f, g, s.cz + h]);
    }
    return o;
  };
  const R = sts.map(ring);
  // emitLoft's regionAt: the first region listing this bay's front station and this side.
  const regionAt = (fA, k) => {
    for (const rg of fus.regions || []) {
      if (!rg.at.includes(fA)) continue;
      if (rg.k === 'all' || rg.k == null || rg.k.includes(k)) return rg;
    }
    return null;
  };
  const glass = (i, k) => { const r = regionAt(sts[i].f, ((k % n) + n) % n); return !!(r && r.role === 'glass'); };
  const regionOf = (i, k) => regionAt(sts[i].f, ((k % n) + n) % n);
  // A point on the exterior skin: bay i (station i to i+1), t along it, u round it (0..n).
  const at = (i, t, u) => {
    const k = Math.floor(u) % n, j = (k + 1) % n, s = u - Math.floor(u);
    return lerp3(lerp3(R[i][k], R[i][j], s), lerp3(R[i + 1][k], R[i + 1][j], s), t);
  };
  const czAt = (i, t) => lerp(sts[i].cz, sts[i + 1].cz, t);
  // Which bay holds station f, and how far along it.
  const bayOf = (f) => {
    for (let i = 0; i < sts.length - 1; i++) if (f <= sts[i].f && f >= sts[i + 1].f) return [i, (sts[i].f - f) / (sts[i].f - sts[i + 1].f)];
    return f > sts[0].f ? [0, 0] : [sts.length - 2, 1];
  };
  return { n, sts, R, glass, regionOf, at, czAt, bayOf };
}

// ── 2-D HALF-PLANE CLIP (the floor cut) ──────────────────────────────────────
function clipHalf(poly, s) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], sa = s(a), sb = s(b);
    if (sa >= 0) out.push(a);
    if ((sa >= 0) !== (sb >= 0)) { const t = sa / (sa - sb); out.push(a.map((v, k) => v + (b[k] - v) * t)); }
  }
  return out;
}

// ── THE PROFILE ──────────────────────────────────────────────────────────────
let PROFILE = null;
export function mayflyProfile(doc = MESH_ROWS.ultralight) {
  if (PROFILE && doc === MESH_ROWS.ultralight) return PROFILE;
  const S = skinOf(doc);
  if (!S) return null;
  const m = M_PER_UNIT, [fE, gE, hE] = MAYFLY_EYE;
  const X = (g) => (g - gE) * m, Y = (f) => (f - fE) * m, Z = (h) => (h - hE) * m;
  const toShell = (q) => [X(q[1]), Y(q[0]), Z(q[2])];
  const w = SKIN_M / m;
  // A point on the INSIDE of the skin: pushed in toward the section's middle by the skin's thickness.
  const inner = (i, t, u, ww = w) => {
    const p = S.at(i, t, u), cz = S.czAt(i, t), g = p[1], h = p[2] - cz, L = Math.hypot(g, h) || 1;
    return [p[0], g - (g / L) * ww, cz + h - (h / L) * ww];
  };
  const P3 = (i, t, u, ww) => toShell(inner(i, t, u, ww));
  // The inner half-width (model units, the right side) at station f and height h.
  const halfAt = (f, h) => {
    const [i, t] = S.bayOf(f);
    let best = 0;
    const N = S.n * 4;
    for (let q = 0; q < N; q++) {
      const a = inner(i, t, q / 4), b = inner(i, t, ((q + 1) % N) / 4);
      if ((a[2] - h) * (b[2] - h) > 0 || a[2] === b[2]) continue;
      const g = lerp(a[1], b[1], (h - a[2]) / (b[2] - a[2]));
      if (g > best) best = g;
    }
    return best;
  };

  const fFront = S.sts[0].f === 0.72 ? 0.46 : 0.46;          // the firewall: the station the windscreen starts on
  const fBack = -0.28;                                        // the baggage bulkhead: where the rear glass ends
  const iFront = S.sts.findIndex((s) => s.f === fFront), iBack = S.sts.findIndex((s) => s.f === fBack);
  const floorH = -0.064;                                      // the cabin floor, a little above the belly skin
  const zFloor = Z(floorH);
  const room = buildRoom({ S, P3, inner, toShell, iFront, iBack, zFloor, halfAt, X, Y, Z, floorH, m, w });

  // Measure what was built.
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const f of room.faces) for (const q of f.p) {
    x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]);
    y1 = Math.max(y1, q[1]); z0 = Math.min(z0, q[2]); z1 = Math.max(z1, q[2]);
  }
  const xCentre = X(0);
  const halfW = Math.max(xCentre - x0, x1 - xCentre) + 1e-6;

  // The side-window target: the middle of the left door window (between the door posts, halfway up
  // the glass band), taken to the bounds plane the gate aims at. The right ray reuses it, and lands
  // in the right door window because the glass band is tall enough at that distance.
  const [di, dt] = S.bayOf(room.winF);
  const lo = inner(di, dt, S.n / 2 - S.n / 24), hi = inner(di, dt, S.n / 2 - S.n / 6);   // the side glass runs 15°-60° up the left flank; aim between, whatever the side count
  const gc = toShell([room.winF, lo[1], (lo[2] + hi[2]) / 2]);
  const tL = (xCentre - halfW) / gc[0];
  const wy = gc[1] * tL, wz = gc[2] * tL;

  const dashY = room.dashY, dashZ = room.dashZ;
  const P = {
    label: 'Cessna 172 cabin',
    xCentre, halfW,
    floor: z0 - 1e-6, roof: z1 + 1e-6, front: y1 + 1e-6, back: y0 - 1e-6,
    dashY, dashZ, headerZ: Z(room.headerH), pillarW: 0.03,
    winY: [wy - 0.05, wy + 0.05], winZ: [wz - 0.05, wz + 0.05],
    // ── a person, in metres ──
    seatZ: -0.74, seatHalf: 0.20, seatY: [-0.46, 0.04], backZ: -0.06,
    seats: 2, centrePost: 0.01, craft: 'mayfly', fit: 'mayfly',
    normalLit: true,
    // Panel floods: the post lights under the glareshield lip, over the six-pack, the stack and the
    // right panel. windshield.js colours them from the live state.
    floods: [{ p: [0, dashY - 0.06, dashZ - 0.03], r: 0.36 }, { p: [xCentre, dashY - 0.06, dashZ - 0.03], r: 0.34 },
      { p: [2 * xCentre - 0.05, dashY - 0.06, dashZ - 0.03], r: 0.32 }],
    room: mayflyShell,
    // The glass: one pane per bay the exterior glazes, its own four corners 3 mm in from the skin,
    // so it sits in the aperture outboard of the frames. Drawn by the renderer as film; never in
    // shellFaces, so every sight line still casts through an open hole.
    glass: glassPanes(S, inner, toShell, iFront, iBack),
    mayfly: { S, m, X, Y, Z, inner, P3, halfAt, zFloor, ...room },
  };
  if (doc === MESH_ROWS.ultralight) PROFILE = P;
  return P;
}

function glassPanes(S, inner, toShell, iFront, iBack) {
  const panes = [], d = 0.003 / M_PER_UNIT;
  for (let i = iFront; i < iBack; i++) {
    for (let k = 0; k < S.n; k++) {
      if (!S.glass(i, k)) continue;
      panes.push([inner(i, 0, k, d), inner(i, 0, k + 1, d), inner(i, 1, k + 1, d), inner(i, 1, k, d)].map(toShell));
    }
  }
  return panes;
}

// ── THE ROOM ─────────────────────────────────────────────────────────────────
// Returns the static faces (built once per profile) plus the handful of stations the fit needs.
function buildRoom({ S, P3, inner, toShell, iFront, iBack, zFloor, halfAt, X, Y, Z, floorH, m, w }) {
  const faces = [];
  // `part` names what a face is (lining, reveal, floor, end) so a gate can tell the aperture's own edge from a wall across it.
  let part = 'lining';
  const put = (p, n, tone, k, rgb, emis) => faces.push({ p, n, tone, k, rgb, emis: emis || 0, part });
  const n = S.n, NU = 5;
  const aboveFloor = (poly) => clipHalf(poly, (q) => q[2] - zFloor);
  // The inward normal of a wall cell: its own edges, turned toward the section's middle.
  const inwardOf = (poly, i, t) => {
    let nn = norm(cross(sub(poly[1], poly[0]), sub(poly[poly.length - 1], poly[0])));
    const c = poly.reduce((s, v) => add(s, mul(v, 1 / poly.length)), [0, 0, 0]);
    const f = S.sts[i].f + (S.sts[i + 1].f - S.sts[i].f) * t;
    const axis = toShell([f, 0, S.czAt(i, t)]);
    if (dot(nn, sub(axis, c)) < 0) nn = mul(nn, -1);
    return nn;
  };

  // ── THE WALLS: every bay the exterior does not call glass, lined ──
  // The lining is two tones by band: the door card below the sill line, the upholstered upper wall
  // and the headliner above. `u` runs from the right flank (0) over the crown (n/4) to the left flank
  // (n/2) and round under the floor, so the band is read off u.
  for (let i = iFront; i < iBack; i++) {
    const len = S.sts[i].f - S.sts[i + 1].f, NF = Math.max(1, Math.ceil(len / 0.02));
    for (let k = 0; k < n; k++) {
      if (S.glass(i, k)) continue;
      const crown = k >= 1 && k <= 4, lower = k >= 6 && k <= 11 ? true : false;
      for (let a = 0; a < NF; a++) {
        for (let b = 0; b < NU; b++) {
          const t0 = a / NF, t1 = (a + 1) / NF, u0 = k + b / NU, u1 = k + (b + 1) / NU;
          const tm = (t0 + t1) / 2;
          let poly = [P3(i, t0, u0), P3(i, t1, u0), P3(i, t1, u1), P3(i, t0, u1)];
          poly = aboveFloor(poly);
          if (poly.length < 3) continue;
          const nn = inwardOf(poly, i, tm);
          if (crown) put(poly, nn, 'hdr', -0.2 + ((a + b) & 1) * 0.03, T.headliner);
          else if (lower) put(poly, nn, 'pil', -0.12, (a & 1) ? T.lining : T.liningDk);
          else put(poly, nn, 'pil', -0.06, T.lining);
        }
      }
    }
  }

  // ── THE GLASS'S REVEAL: the skin's thickness round every glazed bay, where it meets solid skin ──
  part = 'reveal';
  // A seam between two glass bays (the windscreen meeting the side glass) is a frame member rather
  // than a reveal, so it is left to the frame rods below.
  const revealK = (i, k, u, t0, t1) => {
    const a = P3(i, t0, u), b = P3(i, t1, u), ao = toShell(S.at(i, t0, u)), bo = toShell(S.at(i, t1, u));
    const nn = norm(sub(P3(i, (t0 + t1) / 2, k + 0.5), a));
    const along = norm(sub(b, a));
    const rn = norm(sub(nn, mul(along, dot(nn, along))));
    put(aboveFloor([a, b, bo, ao]).length >= 3 ? [a, b, bo, ao] : [a, b, bo, ao], rn, 'pil', 0.1, T.frame);
  };
  const revealF = (i, k, t) => {
    const a = P3(i, t, k), b = P3(i, t, k + 1), ao = toShell(S.at(i, t, k)), bo = toShell(S.at(i, t, k + 1));
    const into = t === 0 ? 1 : -1;
    const rn = norm([0, into * (S.sts[i].f > S.sts[i + 1].f ? -1 : 1), 0]);
    put([a, b, bo, ao], rn, 'pil', 0.1, T.frame);
  };
  for (let i = iFront; i < iBack; i++) {
    for (let k = 0; k < n; k++) {
      if (!S.glass(i, k)) continue;
      if (!S.glass(i, k - 1)) revealK(i, k, k, 0, 1);
      if (!S.glass(i, k + 1)) revealK(i, k, k + 1, 0, 1);
      if (i === iFront || !S.glass(i - 1, k)) revealF(i, k, 0);
      if (i + 1 === iBack || !S.glass(i + 1, k)) revealF(i, k, 1);
    }
  }

  // ── THE FLOOR: carpet from the firewall to the baggage bulkhead, the wall's width at the floor ──
  part = 'floor';
  const fF = S.sts[iFront].f, fB = S.sts[iBack].f;
  const NFL = 24;
  const hFloor = floorH;
  let prev = null;
  for (let r = 0; r <= NFL; r++) {
    const f = lerp(fF, fB, r / NFL), g = halfAt(f, hFloor) + 0.002;
    const cur = [[X(-g), Y(f), zFloor], [X(g), Y(f), zFloor]];
    if (prev) put([prev[0], prev[1], cur[1], cur[0]], [0, 0, 1], 'floor', -0.24 + (r & 1) * 0.02, T.carpet);
    prev = cur;
  }

  // ── THE ENDS: the firewall ahead of your feet and the baggage bulkhead behind the rear seat ──
  part = 'end';
  const endCap = (i, t) => {
    const pts = [];
    for (let q = 0; q < n * 4; q++) pts.push(P3(i, t, q / 4));
    return aboveFloor(pts);
  };
  const fire = endCap(iFront, 0);
  if (fire.length >= 3) put(fire, [0, -1, 0], 'post', -0.25, T.shield);
  const bulk = endCap(iBack - 1, 1);
  if (bulk.length >= 3) put(bulk, [0, 1, 0], 'post', -0.1, T.liningDk);

  // ── THE DOOR POSTS: where the exterior's door outline crosses the side glass ──
  // Read off the "door and step" part: the two vertical strokes are the door's front and back edges.
  const doorFs = [];
  const door = findPart(MESH_ROWS.ultralight.parts, 'door and step');
  for (const fc of (door && door.parts && door.parts[0] && door.parts[0].faces) || []) {
    const fs = fc.p.map((q) => q[0]);
    if (Math.max(...fs) - Math.min(...fs) < 1e-6) doorFs.push(fs[0]);
  }
  const posts = doorFs.length ? doorFs : [0.30, 0.02];
  const frames = [];
  for (const fp of posts) {
    const [i, t] = S.bayOf(fp);
    // A door edge that lands on the station where the windscreen meets the side glass is already
    // framed by that seam (below); a second post there draws the corner twice, as a V.
    const seamAt = (a, b) => a >= 0 && S.glass(a, 0) && S.glass(b, 0) && S.regionOf(a, 0) !== S.regionOf(b, 0);
    if ((t < 0.05 && seamAt(i - 1, i)) || (t > 0.95 && seamAt(i, i + 1))) continue;
    for (const side of [0, S.n / 2]) {
      // Up the glass as far as the exterior glazes this bay, so the post meets the roof where the glass stops.
      const dir = side === 0 ? 1 : -1, k0 = side === 0 ? 0 : S.n / 2;
      let k1 = k0 + dir;
      while (S.glass(i, side === 0 ? k1 : k1 - 1) && Math.abs(k1 - k0) < S.n / 6) k1 += dir;   // never past 60°: a post that followed glass over the roof crossed the whole view
      frames.push([inner(i, t, k0, w * 1.4), inner(i, t, k1, w * 1.4)].map(toShell));
    }
  }
  // Frame members: the windscreen's aft edge where it meets the side glass, and nothing down its
  // middle. A 172's screen is one pane (the compass hangs off the roof on its own rod). ⚠ Not every seam between two glass
  // panels: those are facets of one curved pane, and on a 24-sided hull a bar on each one caged the
  // whole view.
  for (let i = iFront; i < iBack; i++) {
    for (let k = 0; k < n; k++) {
      if (!S.glass(i, k)) continue;
      // Every edge where glass meets skin or a different window, so each opening is framed all round:
      // the windscreen's pillars run up into a header along the headliner, and the door window has a
      // sill, a top rail and both posts. That is what makes the glass read as set INTO the cabin.
      const aft = i + 1 < iBack && S.glass(i + 1, k);
      if (!aft || S.regionOf(i, k) !== S.regionOf(i + 1, k)) frames.push([P3(i, 1, k, w * 1.6), P3(i, 1, k + 1, w * 1.6)]);
      if (i > iFront && !S.glass(i - 1, k)) frames.push([P3(i, 0, k, w * 1.6), P3(i, 0, k + 1, w * 1.6)]);
      if (!S.glass(i, k + 1)) frames.push([P3(i, 0, k + 1, w * 1.6), P3(i, 1, k + 1, w * 1.6)]);
      if (!S.glass(i, k - 1)) frames.push([P3(i, 0, k, w * 1.6), P3(i, 1, k, w * 1.6)]);
    }
  }

  // Where the dash goes, off the skin. The panel stands 0.62 m ahead of the eye (a 172 pilot's reach
  // to the six-pack); its top is just under a level eye line, which is the windscreen base here.
  // The glareshield's lip is 9 degrees under a level eye (tan 9° × 0.62 m), a 172's own view over the nose.
  const dashY = 0.62, dashZ = -0.098;
  // The side-view target is the door window abeam the pilot, just aft of its front post.
  const winF = Math.max(...posts) - 0.04;
  const headerH = S.at(iFront + 2, 0, 2)[2] - w;
  return { faces, frames, posts, dashY, dashZ, winF, headerH, fF, fB };
}

// ── THE SHELL, AS interior-shell.js CALLS IT ─────────────────────────────────
function mayflyShell(P, live, push, rich) {
  const D = P.mayfly;
  for (const f of D.faces) push(f.one || (f.one = Object.assign([{ p: f.p, n: f.n }], { stable: true })), f.tone, f.k, false, f.rgb, f.emis || 0);
  if (!D.fixed) D.fixed = recordFixed(P);
  for (const f of D.fixed) push(f.one || (f.one = Object.assign([{ p: f.p, n: f.n }], { stable: true })), f.tone, f.k, f.fwd, f.rgb, f.emis);
  if (rich) mayflyFit(P, live, push);
  else seatsOnly(P, push);
}
// The pilot's cushion, and only it, for a renderer that asked for the bare room.
function seatsOnly(P, push) {
  const K = makeKit(push, false);
  K.box(-P.seatHalf, P.seatY[0], P.seatZ - 0.12, P.seatHalf, P.seatY[1], P.seatZ, 'seat', 0.06, T.seat);
}

// Everything that never moves, built once: the frame, the panel's board, the glareshield, the
// pedestal, the seats, the door furniture, the visors, the overhead. Replayed each frame.
function recordFixed(P) {
  const rec = [];
  const push = (fs, tone, k, fwd, rgb, emis) => { for (const f of fs) rec.push({ p: f.p, n: f.n, tone, k, fwd, rgb, emis }); };
  fixedFit(P, push);
  return rec;
}

// ── WHERE THINGS ARE ─────────────────────────────────────────────────────────
// One table for the fixed half and the live half, so a knob and its bezel cannot drift apart.
function layout(P) {
  const xC = P.xCentre, y = P.dashY, top = P.dashZ - 0.01;
  return {
    xC, y, top,
    six: { dx: 0.092, R: 0.038, z: [top - 0.070, top - 0.170] },
    eng: { x: -0.176, z: [top - 0.040, top - 0.100, top - 0.160, top - 0.220], R: 0.020 },
    cdi: { x: 0.170, z: [top - 0.070, top - 0.170], R: 0.034 },
    tach: { x: 0.098, z: top - 0.265, R: 0.036 },
    clock: { x: -0.092, z: top - 0.262, R: 0.024 },
    stack: { x: xC + 0.02, w: 0.088, z0: top - 0.30, z1: top - 0.012 },
    sw: { z: top - 0.360, x: [-0.180, -0.145, -0.110, -0.080, -0.050, -0.020, 0.010] },  // master BAT|ALT, avionics, beacon, land, taxi, nav, strobe
    mags: [-0.180, top - 0.290],
    throttle: [xC - 0.045, top - 0.335], mixture: [xC + 0.045, top - 0.335],
    flap: [xC + 0.165, top - 0.290],
    yoke: (x, elev) => [x, y - 0.24 + clamp(elev, -1, 1) * 0.07, top - 0.21],
    column: top - 0.225,
    pedestal: { x: xC, hw: 0.055, y0: 0.26, y1: y },
    trim: [xC - 0.058, 0.42, 0],       // z filled in from the floor
    fuel: [xC, 0.27, 0],
  };
}

function fixedFit(P, push) {
  const K = makeKit(push);
  const D = P.mayfly, Y = layout(P);
  const { X, Y: Yf, Z, halfAt, zFloor } = D;
  const fOf = (y) => y / D.m + MAYFLY_EYE[0], hOf = (z) => z / D.m + MAYFLY_EYE[2];
  const wallX = (y, z, s) => X(s * halfAt(fOf(y), hOf(z)));
  void Yf;

  // ── THE FRAME: door posts and the windscreen's seams, painted cabin grey ──
  // Each rod is pulled in by its own radius at both ends, so a cap never pokes through the firewall.
  for (const [a, b] of D.frames) {
    const d = norm(sub(b, a)), r = 0.012;
    K.rod(add(a, mul(d, r)), sub(b, mul(d, r)), r, 'pil', 0.1, T.frame, 0, 6);
  }

  // ── THE PANEL: a steel board the width of the cabin, its sides following the wall ──
  const zTop = P.dashZ, zBot = zFloor + 0.34, py = P.dashY;
  const side = (s) => {
    const pts = [];
    for (let q = 0; q <= 6; q++) { const z = lerp(zBot, zTop, q / 6); pts.push([wallX(py, z, s) - s * 0.004, py, z]); }
    return pts;
  };
  const Lp = side(-1), Rp = side(1);
  push([{ p: orderPanel(Lp, Rp), n: [0, -1, 0] }], 'dash', 0.1, true, T.panel, 0);
  // The glareshield: a black crackle hood from the panel lip forward to the windscreen base, the
  // wall's width at that height all the way. Its front underside is the post-light lip.
  const gy0 = py - 0.045, gy1 = Math.min(P.front - 0.02, py + 0.40);
  const gl = (y) => [wallX(y, zTop, -1) + 0.006, wallX(y, zTop, 1) - 0.006];
  const [a0, b0] = gl(gy0), [a1, b1] = gl(gy1);
  push([{ p: [[a0, gy0, zTop], [b0, gy0, zTop], [b1, gy1, zTop], [a1, gy1, zTop]], n: [0, 0, 1] }], 'dash', 0.05, true, T.shield, 0);
  push([{ p: [[a0, gy0, zTop], [b0, gy0, zTop], [b0, gy0, zTop - 0.022], [a0, gy0, zTop - 0.022]], n: [0, -1, 0] }], 'dash', -0.2, true, T.shield, 0);
  push([{ p: [[a0, gy0, zTop - 0.022], [b0, gy0, zTop - 0.022], [b0, py, zTop - 0.022], [a0, py, zTop - 0.022]], n: [0, 0, -1] }], 'dash', -0.4, true, T.shield, 0);

  const Pn = K.panel([0, py, 0], [1, 0, 0], [0, 0, 1], 'dash', 0.15);
  // A darker lower strip and a seam between the pilot's panel and the stack, as the real one has.
  Pn.rect(Lp[0][0] + 0.01, zBot + 0.002, Rp[0][0] - 0.01, zBot + 0.02, T.panelDk, 0, 0.001);
  // The avionics bay: black, recessed look.
  const st = Y.stack;
  Pn.rect(st.x - st.w, st.z0, st.x + st.w, st.z1, T.stack, 0, 0.002);
  // The copilot's side: a glovebox lid, the hour meter and a row of circuit breakers under the stack.
  const gx = 2 * Y.xC + 0.02;
  Pn.rect(gx - 0.13, zBot + 0.03, gx + 0.13, zBot + 0.13, T.panelDk, 0, 0.002);
  Pn.rect(gx - 0.02, zBot + 0.11, gx + 0.02, zBot + 0.118, C.chrome, 0.05, 0.004);
  for (let i = 0; i < 10; i++) {
    const x = st.x - 0.08 + i * 0.018;
    Pn.disc(x, zBot + 0.045, 0.0055, C.black, 0, 0.003, 8);
    Pn.disc(x, zBot + 0.045, 0.0035, [220, 220, 214], 0.05, 0.007, 6);
  }
  // Placards over the switches and the gauges' post-light hoods (little brows over each bezel).
  for (const x of Y.sw.x) Pn.rect(x - 0.012, Y.sw.z + 0.02, x + 0.012, Y.sw.z + 0.026, T.placard, 0.05, 0.002);
  const brow = (x, z, R) => Pn.stud(x, z + R * 1.22, R * 0.35, 0.003, 0.010, T.panelDk, 0, 0.001);
  const sx = (i) => (i - 1) * Y.six.dx;
  for (const z of Y.six.z) for (let i = 0; i < 3; i++) brow(sx(i), z, Y.six.R);
  for (const z of Y.cdi.z) brow(Y.cdi.x, z, Y.cdi.R);
  // The magneto switch's escutcheon: OFF R L BOTH START marks round it.
  const [mx, mz] = Y.mags;
  Pn.disc(mx, mz, 0.022, C.black, 0, 0.002, 18);
  for (let i = 0; i < 5; i++) Pn.spoke(mx, mz, Math.PI * (0.85 - i * 0.18), 0.018, 0.024, 0.0012, T.placard, 0.1, 0.004);
  // The friction lock between throttle and mixture, and their bezels.
  for (const [x, z] of [Y.throttle, Y.mixture]) Pn.disc(x, z, 0.016, C.black, 0, 0.002, 14);
  Pn.knob((Y.throttle[0] + Y.mixture[0]) / 2, Y.throttle[1] - 0.03, 0.008, 0.012, [60, 60, 66], 0);
  // The flap lever's slot and its 0-10-20-30 detent marks.
  const [fx, fz] = Y.flap;
  Pn.rect(fx - 0.004, fz - 0.085, fx + 0.004, fz + 0.012, C.black, 0, 0.002);
  for (let i = 0; i < 4; i++) Pn.rect(fx + 0.008, fz - i * 0.025 - 0.001, fx + 0.020, fz - i * 0.025 + 0.001, T.placard, 0.1, 0.003);
  Pn.rect(fx + 0.030, fz - 0.085, fx + 0.034, fz + 0.012, C.black, 0, 0.002);   // the position indicator's slot

  // ── THE PEDESTAL: down from the panel between the seats, the trim wheel on its left cheek ──
  const pd = Y.pedestal, zP = zFloor;
  K.box(pd.x - pd.hw, pd.y0 + 0.14, zP, pd.x + pd.hw, pd.y1, zBot + 0.02, 'dash', 0.0, T.panelDk);
  // Its aft face slopes down to the floor, where the fuel selector sits.
  const sl = [[pd.x - pd.hw, pd.y0 + 0.14, zBot - 0.08], [pd.x + pd.hw, pd.y0 + 0.14, zBot - 0.08], [pd.x + pd.hw, pd.y0, zP + 0.10], [pd.x - pd.hw, pd.y0, zP + 0.10]];
  push([{ p: sl, n: norm([0, -0.9, 0.44]) }], 'dash', 0.05, true, T.panelDk, 0);
  K.box(pd.x - pd.hw, pd.y0, zP, pd.x + pd.hw, pd.y0 + 0.14, zP + 0.10, 'dash', 0.0, T.panelDk);
  // The trim wheel's slot in the cheek.
  const tz = zFloor + 0.22;
  K.box(pd.x - pd.hw - 0.002, Y.trim[1] - 0.075, tz - 0.075, pd.x - pd.hw, Y.trim[1] + 0.075, tz + 0.075, 'dash', -0.3, C.black);
  // The fuel selector's placard plate on the floor: LEFT, BOTH, RIGHT.
  const fs = [Y.fuel[0], Y.fuel[1], zP + 0.10];
  const Fp = K.panel(add(fs, [0, 0, 0.001]), [1, 0, 0], [0, 1, 0], 'dash', 0.1);
  Fp.disc(0, 0, 0.045, T.placard, 0.05, 0, 20);
  Fp.disc(0, 0, 0.036, [36, 36, 40], 0, 0.001, 20);
  for (const a of [Math.PI, Math.PI / 2, 0]) Fp.spoke(0, 0, a, 0.036, 0.044, 0.002, C.red, 0.1, 0.002);

  // ── THE SEATS: two fronts on rails and a bench behind ──
  const rgbSeat = T.seat;
  for (const cx of [0, 2 * Y.xC]) {
    K.box(cx - P.seatHalf, P.seatY[0], P.seatZ - 0.11, cx + P.seatHalf, P.seatY[1], P.seatZ, 'seat', 0.06, rgbSeat);
    // The cushion's front roll and the backrest, raked back.
    K.rod([cx - P.seatHalf, P.seatY[1], P.seatZ - 0.035], [cx + P.seatHalf, P.seatY[1], P.seatZ - 0.035], 0.035, 'seat', 0.1, T.seatDk, 0, 8);
    const bb = [cx, P.seatY[0] - 0.06, (P.seatZ + P.backZ) / 2];
    K.obox(bb, [1, 0, 0], norm([0, -0.22, 1]), norm([0, 1, 0.22]), P.seatHalf, (P.backZ - P.seatZ) / 2, 0.05, 'seat', -0.04, rgbSeat);
    richSeat(K, cx, P, T.seatDk, false);
    // Seat rails and the adjustment bar under the front of the cushion.
    for (const s of [-1, 1]) K.box(cx + s * 0.14 - 0.012, -0.55, zFloor, cx + s * 0.14 + 0.012, 0.20, zFloor + 0.018, 'floor', 0.2, C.steel);
    K.rod([cx - 0.08, P.seatY[1] - 0.02, P.seatZ - 0.14], [cx + 0.08, P.seatY[1] - 0.02, P.seatZ - 0.14], 0.005, 'dash', 0.3, C.chrome, 0.05, 5);
    // The seat's steel frame down to the rails.
    for (const s of [-1, 1]) K.box(cx + s * 0.14 - 0.01, P.seatY[0] + 0.05, zFloor, cx + s * 0.14 + 0.01, P.seatY[1] - 0.05, P.seatZ - 0.11, 'dash', -0.1, C.steel);
  }
  // Tuck-and-roll pleats across each front cushion and up each backrest: the stitching that makes a
  // 172 seat read as a seat and not as a box.
  for (const cx of [0, 2 * Y.xC]) {
    for (let i = 1; i < 6; i++) {
      const y = lerp(P.seatY[0] + 0.03, P.seatY[1] - 0.04, i / 6);
      K.rod([cx - P.seatHalf + 0.05, y, P.seatZ + 0.004], [cx + P.seatHalf - 0.05, y, P.seatZ + 0.004], 0.009, 'seat', 0.02, T.seatDk, 0, 6);
    }
    const up = norm([0, -0.22, 1]), bn = norm([0, 1, 0.22]);
    const b0 = [cx, P.seatY[0] - 0.06, P.seatZ + 0.02];
    for (let i = 1; i < 6; i++) {
      const c = add(add(b0, mul(up, (P.backZ - P.seatZ - 0.08) * i / 6)), mul(bn, 0.052));
      K.rod(add(c, [-P.seatHalf + 0.06, 0, 0]), add(c, [P.seatHalf - 0.06, 0, 0]), 0.009, 'seat', 0.0, T.seatDk, 0, 6);
    }
  }
  // Under the right of the panel: CABIN HEAT and CABIN AIR, two push-pull knobs, and the hour meter.
  for (const [dx, rgb] of [[0.08, C.red], [0.13, C.blue]]) {
    const x = 2 * Y.xC + dx, z = zBot + 0.02;
    Pn.disc(x, z, 0.012, C.black, 0, 0.002, 12);
    K.rod([x, py, z], [x, py - 0.02, z], 0.004, 'dash', 0.3, C.chrome, 0.05, 5);
    K.rod([x, py - 0.02, z], [x, py - 0.034, z], 0.011, 'dash', 0.2, [26, 26, 30], 0, 10);
    Pn.rect(x - 0.012, z + 0.016, x + 0.012, z + 0.022, rgb, 0.1, 0.002);
  }
  Pn.digits(gx - 0.10, zBot + 0.155, 0.012, '1482', C.white, true);
  // The instrument-light dimmers and the alternate static, low on the pilot's side.
  for (const x of [-0.19, -0.16]) { Pn.disc(x, zBot + 0.05, 0.010, C.black, 0, 0.002, 10); Pn.knob(x, zBot + 0.05, 0.008, 0.014, [50, 50, 56], 0); }
  Pn.stud(-0.13, zBot + 0.05, 0.010, 0.006, 0.012, C.red, 0.05, 0.002);
  // Screw heads at the panel's corners and along its top.
  for (let i = 0; i < 9; i++) Pn.disc(lerp(Lp[6][0] + 0.02, Rp[6][0] - 0.02, i / 8), zTop - 0.008, 0.0028, C.chrome, 0.05, 0.002, 6);
  // The speaker grille in the headliner over the front seats.
  const Sg = K.panel([Y.xC, -0.42, P.roof - 0.003], [1, 0, 0], [0, 1, 0], 'hdr', -0.1);
  Sg.grille(-0.07, -0.05, 0.07, 0.05, 8, [60, 60, 64]);

  // The rear bench, across the cabin, as wide as the wall lets it be at cushion height.
  const ry0 = -1.78, ry1 = -1.30, rz = zFloor + 0.30;
  const rx0 = wallX(ry1, rz, -1) + 0.02, rx1 = wallX(ry1, rz, 1) - 0.02;
  K.box(rx0, ry0, zFloor, rx1, ry1, rz, 'seat', 0.04, rgbSeat);
  K.obox([(rx0 + rx1) / 2, ry0 - 0.03, (rz + 0.05) / 2 + 0.0], [1, 0, 0], norm([0, -0.2, 1]), norm([0, 1, 0.2]), (rx1 - rx0) / 2, (0.05 - rz) / 2 + 0.0, 0.05, 'seat', -0.05, T.seatDk);
  K.rod([(rx0 + rx1) / 2, ry1 - 0.2, rz + 0.005], [(rx0 + rx1) / 2, ry0 + 0.02, rz + 0.005], 0.004, 'seat', 0.0, T.seatSide, 0, 4);
  // The rear lap belts, two a side, lying across the bench with their buckles.
  for (const x of [lerp(rx0, rx1, 0.25), lerp(rx0, rx1, 0.75)]) {
    K.rod([x - 0.18, ry0 + 0.04, rz + 0.012], [x - 0.02, ry1 - 0.12, rz + 0.012], 0.010, "seat", 0.0, T.belt, 0, 4);
    K.rod([x + 0.18, ry0 + 0.04, rz + 0.012], [x + 0.02, ry1 - 0.12, rz + 0.012], 0.010, "seat", 0.0, T.belt, 0, 4);
    K.obox([x, ry1 - 0.12, rz + 0.016], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.022, 0.014, 0.005, "seat", 0.4, T.buckle, 0.05);
  }
  // The headliner bows: the formers the lining is stretched over, a rib across the roof at each.
  for (const y of [-2.2, -1.5, -0.8, -0.2]) {
    const z = P.roof - 0.008;
    K.rod([wallX(y, z - 0.02, -1) + 0.03, y, z], [wallX(y, z - 0.02, 1) - 0.03, y, z], 0.007, "hdr", -0.05, T.liningDk, 0, 5);
  }

  // ── THE DOORS: armrest, handle, the window latch at the sill ──
  for (const s of [-1, 1]) {
    const yA = -0.52, yB = 0.12, zA = -0.43;
    const xa = wallX(0, zA, s);
    K.box(xa - s * 0.06, yA, zA - 0.03, xa - s * 0.004, yB, zA + 0.005, 'pil', 0.15, T.liningDk);
    K.rod([xa - s * 0.03, yB - 0.02, zA + 0.07], [xa - s * 0.03, yB + 0.10, zA + 0.07], 0.008, 'pil', 0.4, C.chrome, 0.05, 6);
    const zS = -0.36;
    const xs = wallX(-0.40, zS, s);
    K.box(xs - s * 0.03, -0.44, zS - 0.01, xs - s * 0.004, -0.36, zS + 0.008, 'pil', 0.3, C.chrome);
    // The door pocket, a stitched map pocket low on the card.
    const xp = wallX(-0.1, zFloor + 0.22, s);
    K.box(xp - s * 0.025, -0.40, zFloor + 0.14, xp - s * 0.003, 0.02, zFloor + 0.24, 'pil', -0.05, T.lining);
  }

  // ── OVERHEAD: the sun visors at the windscreen top, the dome console, the air vents at the roots ──
  const roofZ = P.roof;
  const vy = Math.min(P.front - 0.06, 0.56);
  for (const s of [-1, 1]) {
    const cx = s < 0 ? 0 : 2 * Y.xC;
    // Folded up flat against the headliner, as they stow on a 172: hung down in tinted plastic they
    // read as two plates floating in the windscreen.
    const vz = roofZ - 0.012;
    K.rod([cx - 0.20, vy, vz], [cx + 0.20, vy, vz], 0.005, 'hdr', 0.3, C.chrome, 0.05, 5);
    K.obox([cx, vy - 0.07, vz - 0.004], [1, 0, 0], [0, 1, 0], [0, 0, -1], 0.19, 0.07, 0.004, 'hdr', 0.0, [196, 192, 180], 0);
    // The ram-air vent at the wing root: a chrome tube you pull down to open.
    const vx = wallX(0.10, roofZ - 0.06, s) - s * 0.06;
    K.rod([vx, 0.12, roofZ - 0.004], [vx, 0.12, roofZ - 0.05], 0.022, 'hdr', 0.3, [196, 196, 200], 0.05, 10);
    K.rod([vx, 0.12, roofZ - 0.05], [vx, 0.12, roofZ - 0.06], 0.014, 'hdr', 0.3, C.black, 0, 8);
    // The shoulder harness's inertia reel, up in the roof aft of the door.
    const rx = wallX(-0.62, roofZ - 0.05, s) - s * 0.05;
    K.box(rx - 0.03, -0.66, roofZ - 0.07, rx + 0.03, -0.58, roofZ - 0.004, 'hdr', 0.0, T.belt);
  }
  // The dome and map-light console on the centreline over the front seats.
  K.box(Y.xC - 0.06, -0.20, roofZ - 0.025, Y.xC + 0.06, 0.02, roofZ - 0.001, 'hdr', 0.1, [206, 202, 190]);
  // The whiskey compass on the centre strip, just under the windscreen's top.
  const wc = [Y.xC, Math.min(P.front - 0.08, 0.66), roofZ - 0.10];
  K.rod([wc[0], wc[1] + 0.04, roofZ - 0.004], [wc[0], wc[1] + 0.02, wc[2] + 0.02], 0.006, 'hdr', 0.2, C.black, 0, 5);
  K.box(wc[0] - 0.032, wc[1] - 0.02, wc[2] - 0.026, wc[0] + 0.032, wc[1] + 0.03, wc[2] + 0.024, 'dash', 0.1, [28, 28, 32]);
  // The rear baggage bulkhead's tie-down rails.
  const by = P.back + 0.02;
  for (const z of [zFloor + 0.3, zFloor + 0.6]) K.rod([wallX(by + 0.02, z, -1) + 0.05, by, z], [wallX(by + 0.02, z, 1) - 0.05, by, z], 0.006, 'post', 0.2, C.steel, 0, 4);
}

// The panel outline: one convex polygon, left edge top to bottom then right edge bottom to top.
function orderPanel(Lp, Rp) {
  return [...Lp.slice().reverse(), ...Rp];
}

// ── THE LIVE HALF: everything with a needle, a travel or a light in it ───────
export function mayflyFit(P, live, push) {
  const K = makeKit(push), L = live || {}, Y = layout(P), D = P.mayfly;
  const powered = L.powered !== false;
  const hour = num(L.hour, 12), night = hour < 6.5 || hour > 19.5;
  const post = powered && night;                         // the post lights come on after dark
  const ias = num(L.ias), alt = num(L.alt), vsi = num(L.vsi), hdg = num(L.hdg);
  const pitch = num(L.pitch), bank = num(L.bank), rpm = clamp(num(L.rpm), 0, 1);
  const fuel = frac01(L.fuel), hull = frac01(L.hull), oilT = clamp(num(L.oilTemp), 0, 1);
  const thr = clamp(num(L.throttle), 0, 1), ail = clamp(num(L.stickX), -1, 1), elev = clamp(num(L.stickY), -1, 1);
  const trim = clamp(num(L.trim), -1, 1), rud = clamp(num(L.rudder), -1, 1), flap = clamp(num(L.flapNotch), 0, 3);
  const running = rpm > 0.02;
  const py = P.dashY, zFloor = D.zFloor;

  const Pn = K.panel([0, py, 0], [1, 0, 0], [0, 0, 1], 'dash', 0.15);
  const dialO = (o) => ({ face: T.face, bezel: T.bezel, tick: post ? [255, 226, 190] : [228, 228, 222], needle: post ? [255, 236, 206] : C.lampOn, ...o });
  const glint = (x, z, R) => Pn.annulus(x, z, R * 0.62, R * 0.86, GLINT, 1, 0.012, 8, Math.PI * 0.55, Math.PI * 0.9);

  // ── THE SIX-PACK ─────────────────────────────────────────────────────────
  const sx = (i) => (i - 1) * Y.six.dx, R = Y.six.R, [z1, z2] = Y.six.z;
  // Airspeed, 0-200 kt: white arc 40-85, green 48-129, yellow 129-163, red line at 163.
  Pn.dial(sx(0), z1, R, clamp(ias / 200, 0, 1), dialO({ ticks: 20, major: 2, red: 163 / 200,
    arcs: [[40 / 200, 85 / 200, C.white], [48 / 200, 129 / 200, C.green], [129 / 200, 163 / 200, C.amber]], name: 'KTS' }));
  Pn.attitude(sx(1), z1, R, pitch, bank);
  // The altimeter: the long hand is hundreds, the short one thousands.
  Pn.dial(sx(2), z1, R, ((alt % 1000) + 1000) % 1000 / 1000, dialO({ a0: Math.PI / 2, sweep: TAU, ticks: 10, major: 1, frac2: ((alt % 10000) + 10000) % 10000 / 10000, name: 'ALT' }));
  // The turn coordinator: a little aeroplane that banks with the turn and a ball that slips with the rudder.
  {
    const x = sx(0), z = z2;
    Pn.annulus(x, z, R, R * 1.16, T.bezel, 0.04, 0.004, 22);
    Pn.disc(x, z, R, T.face, 0, 0.001, 22);
    for (const d of [-20, 20]) Pn.spoke(x, z, Math.PI / 2 * 0 - d * Math.PI / 180 + (d < 0 ? Math.PI : 0), R * 0.72, R * 0.92, R * 0.03, C.white, 0.5, 0.004);
    const tb = clamp(bank / 30, -1, 1) * 20 * Math.PI / 180;
    Pn.spoke(x, z, Math.PI - tb, 0, R * 0.62, R * 0.04, C.white, post ? 0.9 : 0.6, 0.007);
    Pn.spoke(x, z, -tb, 0, R * 0.62, R * 0.04, C.white, post ? 0.9 : 0.6, 0.007);
    Pn.disc(x, z, R * 0.09, C.white, 0.6, 0.008, 8);
    Pn.fitText('TURN', x, z + R * 0.42, R * 0.9, R * 0.2, dialO({}).tick, 0.45, 0.0045);
    Pn.rect(x - R * 0.45, z - R * 0.62, x + R * 0.45, z - R * 0.48, [40, 40, 44], 0, 0.004);
    Pn.disc(x + clamp(-rud * 0.8 + bank / 90, -1, 1) * R * 0.38, z - R * 0.55, R * 0.07, C.black, 0, 0.007, 8);
    glint(x, z, R);
  }
  Pn.compass(sx(1), z2, R, hdg);
  // The VSI: zero at nine o'clock, climb clockwise to 2000 ft/min.
  Pn.dial(sx(2), z2, R, clamp(0.5 + vsi / 4000, 0, 1), dialO({ a0: Math.PI * 1.9, sweep: Math.PI * 1.8, ticks: 8, major: 2, name: 'VSI' }));
  for (let i = 0; i < 3; i++) { glint(sx(i), z1, R); glint(sx(i), z2, R); }

  // ── THE NAV HEADS, THE TACH, THE CLOCK ───────────────────────────────────
  for (const [j, z] of Y.cdi.z.entries()) {
    const cr = Y.cdi.R, x = Y.cdi.x;
    Pn.compass(x, z, cr, hdg + (j ? 30 : 0));
    const dev = clamp(num(L.courseErr) / 10, -1, 1);
    Pn.rect(x + dev * cr * 0.6 - 0.0012, z - cr * 0.7, x + dev * cr * 0.6 + 0.0012, z + cr * 0.7, C.white, powered ? 0.8 : 0.2, 0.009);
    glint(x, z, cr);
  }
  // Tach, 0-3500 rpm, green 2100-2700, red line 2700.
  Pn.dial(Y.tach.x, Y.tach.z, Y.tach.R, rpm * 2700 / 3500, dialO({ ticks: 14, major: 2, arcs: [[2100 / 3500, 2700 / 3500, C.green]], red: 2700 / 3500, name: 'RPM' }));
  glint(Y.tach.x, Y.tach.z, Y.tach.R);
  Pn.dial(Y.clock.x, Y.clock.z, Y.clock.R, (hour % 12) / 12, dialO({ a0: Math.PI / 2, sweep: TAU, ticks: 12, major: 3, frac2: (hour % 1), name: 'CLOCK' }));

  // ── THE ENGINE GAUGES: dual needles down the left edge ───────────────────
  // Fuel L|R, oil temp|press, EGT|vac, then the ammeter. Two half-dials in one bezel each.
  const dual = (z, fa, fb, arcA, arcB, nm) => {
    const x = Y.eng.x, r = Y.eng.R;
    Pn.annulus(x, z, r * 1.25, r * 1.4, T.bezel, 0.04, 0.004, 20);
    Pn.disc(x, z, r * 1.25, T.face, 0, 0.001, 20);
    const half = (sgn, f, arc) => {
      const c = x + sgn * r * 0.45, a0 = sgn < 0 ? Math.PI * 1.25 : -Math.PI * 0.25, sw = sgn < 0 ? -Math.PI * 0.5 : Math.PI * 0.5;
      if (arc) Pn.annulus(c, z, r * 0.72, r * 0.84, C.green, 0.5, 0.003, 6, a0 + sw * arc[0], a0 + sw * arc[1]);
      for (let i = 0; i <= 4; i++) Pn.spoke(c, z, a0 + sw * i / 4, r * 0.72, r * 0.9, r * 0.03, post ? [255, 226, 190] : C.tick, 0.4, 0.004);
      Pn.spoke(c, z, a0 + sw * clamp(f, 0, 1), -r * 0.1, r * 0.82, r * 0.05, post ? [255, 236, 206] : C.lampOn, 0.9, 0.007, r * 0.015);
    };
    half(-1, fa, arcA); half(1, fb, arcB);
    Pn.fitText(nm, x, z - r * 0.8, r * 2.2, r * 0.3, post ? [255, 226, 190] : C.tick, 0.45, 0.0045);
  };
  const [e1, e2, e3, e4] = Y.eng.z;
  dual(e1, powered ? fuel : 0, powered ? fuel : 0, [0.2, 1], [0.2, 1], 'L FUEL R');
  dual(e2, powered ? oilT : 0, powered && running ? 0.35 + rpm * 0.4 : 0, [0.3, 0.8], [0.3, 0.8], 'OILT OILP');
  dual(e3, powered && running ? 0.3 + rpm * 0.5 : 0, running ? 0.55 : 0, null, [0.4, 0.7], 'EGT VAC');
  dual(e4, powered ? (running ? 0.62 : 0.4) : 0, powered ? 0.5 + (running ? 0.1 : -0.15) : 0, null, [0.4, 0.8], 'AMP VOLT');

  // ── THE ANNUNCIATOR STRIP: top left, above the engine gauges ─────────────
  const an = [[!!L.bingo || fuel < 0.12, T.amber], [powered && !running, C.red], [powered && !running, T.amber], [hull < 0.3, C.red]];
  // Each name is on its lens: the engine gauges are directly under the strip.
  const anN = ['FUEL', 'OIL', 'VOLTS', 'HULL'];
  an.forEach(([on, rgb], i) => {
    Pn.lamp(-0.196 + i * 0.020, P.dashZ - 0.022, 0.008, 0.0045, powered && on, rgb);
    Pn.fitText(anN[i], -0.196 + i * 0.020, P.dashZ - 0.022, 0.014, 0.005, powered && on ? [30, 10, 6] : [150, 146, 140], 0, 0.008);
  });

  // ── THE STACK: audio panel, GPS, COM/NAV, transponder ────────────────────
  const st = Y.stack;
  // Lettered here rather than through lamp's name, which allows 70 mm: these are 24 mm apart.
  ['COM1', 'COM2', 'NAV1', 'NAV2', 'MKR', 'SPKR'].forEach((nm, i) => {
    const x = st.x - 0.06 + i * 0.024;
    Pn.lamp(x, st.z1 - 0.018, 0.008, 0.005, powered && (i === 0 || i === 3), T.amber);
    Pn.fitText(nm, x, st.z1 - 0.0295, 0.02, 0.0055, [200, 200, 196], 0.35, 0.004);
  });
  const gz1 = st.z1 - 0.034, gz0 = gz1 - 0.085;
  Pn.rect(st.x - st.w + 0.008, gz0, st.x + st.w - 0.008, gz1, powered ? T.gps : [10, 12, 12], powered ? 0.55 : 0, 0.004);
  if (powered) {
    for (let i = 1; i < 4; i++) Pn.rect(st.x - st.w + 0.012, gz0 + i * 0.021, st.x + st.w - 0.012, gz0 + i * 0.021 + 0.0012, [40, 110, 80], 0.8, 0.005);
    const tk = clamp(num(L.courseErr) / 30, -1, 1) * 0.03;
    Pn.plate([[st.x - 0.0012, gz0 + 0.02], [st.x + 0.0012, gz0 + 0.02], [st.x + tk + 0.0012, gz1 - 0.008], [st.x + tk - 0.0012, gz1 - 0.008]], T.magenta, 0.9, 0.0055);
    Pn.disc(st.x, gz0 + 0.02, 0.005, [255, 255, 255], 1, 0.006, 6);
  }
  const unit = (z, str) => {
    Pn.rect(st.x - st.w + 0.006, z - 0.021, st.x + st.w - 0.006, z + 0.021, [34, 36, 40], 0, 0.003);
    if (powered) Pn.digits(st.x - 0.065, z - 0.009, 0.018, str, T.lcd, true);
    else Pn.rect(st.x - 0.065, z - 0.01, st.x + 0.03, z + 0.01, T.lcdBg, 0, 0.004);
    Pn.knob(st.x + 0.062, z, 0.009, 0.012, [60, 60, 66], 0);
  };
  unit(gz0 - 0.028, '12280');
  unit(gz0 - 0.076, '11340');
  unit(gz0 - 0.124, '1200');
  void st;

  // ── SWITCHES: the split red master, avionics, then the light rockers ─────
  const state = [powered, powered, powered, powered, !!L.landingLight, !!L.landingLight, powered, powered];
  const swN = ['BAT ALT', 'AVION', 'BCN', 'LAND', 'TAXI', 'NAV', 'STROBE'];
  Y.sw.x.forEach((x, i) => {
    const on = i === 0 ? state[0] : state[i + 1], red = i === 0;
    Pn.fitText(swN[i], x, Y.sw.z - 0.026, 0.027, 0.0065, post ? [255, 226, 190] : C.tick, 0.35, 0.004);
    if (i === 0) {
      // The master: two red paddles side by side, BAT and ALT.
      for (const dx of [-0.007, 0.007]) {
        Pn.rect(x + dx - 0.0065, Y.sw.z - 0.017, x + dx + 0.0065, Y.sw.z + 0.017, [16, 16, 18], 0, 0.003);
        Pn.stud(x + dx, Y.sw.z + (on ? 0.005 : -0.005), 0.0055, 0.009, on ? 0.012 : 0.007, T.cutoff, 0, 0.003);
      }
      return;
    }
    Pn.rect(x - 0.011, Y.sw.z - 0.017, x + 0.011, Y.sw.z + 0.017, [16, 16, 18], 0, 0.003);
    Pn.stud(x, Y.sw.z + (on ? 0.005 : -0.005), 0.008, 0.009, on ? 0.012 : 0.007, red ? T.cutoff : [232, 230, 222], 0, 0.003);
  });
  // The magneto key: turned to BOTH while the engine runs, OFF when it does not.
  {
    const [mx, mz] = Y.mags, a = Math.PI / 2 + (running ? -0.55 : 0.72);
    Pn.disc(mx, mz, 0.011, C.chrome, 0.05, 0.004, 12);
    Pn.fitText('MAG', mx, mz - 0.02, 0.024, 0.0065, post ? [255, 226, 190] : C.tick, 0.35, 0.004);
    const d = [Math.cos(a), Math.sin(a)];
    Pn.stud(mx, mz, 0.004, 0.004, 0.014, [60, 60, 64], 0, 0.004);
    Pn.plate([[mx - d[0] * 0.012 - d[1] * 0.003, mz - d[1] * 0.012 + d[0] * 0.003], [mx + d[0] * 0.012 - d[1] * 0.003, mz + d[1] * 0.012 + d[0] * 0.003],
      [mx + d[0] * 0.012 + d[1] * 0.003, mz + d[1] * 0.012 - d[0] * 0.003], [mx - d[0] * 0.012 + d[1] * 0.003, mz - d[1] * 0.012 - d[0] * 0.003]], C.chrome, 0.1, 0.019);
  }

  // ── THROTTLE AND MIXTURE: push-pull knobs, in is forward ─────────────────
  const pull = ([x, z], out, rgb, r, ribbed) => {
    const base = [x, py, z], tip = [x, py - 0.02 - out, z];
    K.rod(base, tip, 0.0045, 'dash', 0.3, C.chrome, 0.05, 6);
    K.rod(tip, [x, tip[1] - 0.022, z], r, 'dash', 0.3, rgb, 0.03, 12);
    if (ribbed) for (let i = 0; i < 4; i++) K.rod([x, tip[1] - 0.004 - i * 0.005, z], [x, tip[1] - 0.006 - i * 0.005, z], r * 1.07, 'dash', 0.3, rgb, 0.03, 12, false);
    // Its shadow on the panel.
    const Sh = K.panel([x, py - 0.0015, z - 0.012], [1, 0, 0], [0, 0, 1]);
    Sh.disc(0, 0, r * 1.3, SHADE, 1, 0, 14);
  };
  pull(Y.throttle, (1 - thr) * 0.075, T.throttle, 0.016, false);
  pull(Y.mixture, running || powered ? 0.004 : 0.07, T.mixture, 0.013, true);

  // ── THE FLAP LEVER, and the indicator beside it ──────────────────────────
  {
    const [fx, fz] = Y.flap, zz = fz - flap * 0.025;
    K.rod([fx, py, zz], [fx, py - 0.035, zz], 0.004, 'dash', 0.2, C.chrome, 0.05, 5);
    // The white airfoil-section handle.
    K.obox([fx, py - 0.043, zz], [1, 0, 0], [0, 0, 1], [0, -1, 0], 0.016, 0.006, 0.010, 'dash', 0.3, [236, 234, 226], 0);
    const iz = fz - (flap / 3) * 0.085;
    Pn.rect(fx + 0.028, iz - 0.002, fx + 0.036, iz + 0.002, C.white, powered ? 0.6 : 0.1, 0.006);
  }

  // ── THE YOKES: chrome shafts out of the panel, black ram's horns on them ──
  // The co-pilot's is linked, so it moves too.
  const yoke = (x) => {
    const h = Y.yoke(x, elev), base = [x, py, Y.column];
    K.rod(base, [x, h[1] + 0.02, h[2] - 0.012], 0.011, 'dash', 0.4, T.column, 0.05, 10);
    const a = ail * 0.8, c = Math.cos(a), s = Math.sin(a);
    const P2 = (dx, dz, dy = 0) => [h[0] + dx * c + dz * s, h[1] + dy, h[2] - dx * s + dz * c];
    // The hub and its placard, then the W: down-and-out arms to the grips, grips standing up.
    K.obox(P2(0, -0.005, 0.005), [c, 0, -s], [s, 0, c], [0, -1, 0], 0.030, 0.022, 0.012, 'dash', 0.2, T.yoke, 0);
    K.obox(P2(0, -0.005, -0.008), [c, 0, -s], [s, 0, c], [0, -1, 0], 0.018, 0.010, 0.002, 'dash', 0.3, T.placard, 0.05);
    for (const sd of [-1, 1]) {
      K.rod(P2(sd * 0.022, -0.012), P2(sd * 0.085, -0.03), 0.010, 'dash', 0.2, T.yoke, 0, 8);
      K.rod(P2(sd * 0.085, -0.03), P2(sd * 0.105, 0.02), 0.013, 'dash', 0.2, T.yoke, 0, 8);
      K.rod(P2(sd * 0.105, 0.02), P2(sd * 0.098, 0.065), 0.013, 'dash', 0.2, T.yoke, 0, 8);
    }
    // The column's soft shadow on the panel round where it comes out, darkest at the hole.
    const Sh = K.panel([x, py - 0.0015, Y.column - 0.01], [1, 0, 0], [0, 0, 1]);
    Sh.disc(0, 0, 0.034, SHADE, 1, 0, 18);
    Sh.disc(0, 0.004, 0.020, SHADE, 1, 0.0005, 14);
    Sh.disc(0, 0.01, 0.016, [10, 10, 12], 0, 0.001, 12);      // the boot the shaft slides through
    // The push-to-talk and the map light switch on the left horn.
    K.rod(P2(-0.100, 0.055, -0.012), P2(-0.100, 0.055, -0.018), 0.004, 'dash', 0.3, C.red, 0.1, 6);
  };
  yoke(0);
  yoke(2 * Y.xC);

  // ── THE TRIM WHEEL: a black wheel in the pedestal's cheek, and the tab beside it ──
  {
    const tz = zFloor + 0.22, [tx, ty] = Y.trim, r = 0.07, a = trim * 2.4;
    const x = tx - 0.004;
    for (let i = 0; i < 24; i++) {
      const a0 = (i / 24) * TAU + a, a1 = ((i + 1) / 24) * TAU + a;
      const p0 = [x, ty + Math.cos(a0) * r, tz + Math.sin(a0) * r], p1 = [x, ty + Math.cos(a1) * r, tz + Math.sin(a1) * r];
      K.rod(p0, p1, 0.009, 'dash', 0.15, i % 6 === 0 ? [70, 70, 76] : [28, 28, 32], 0, 5, false);
    }
    // The white index mark that turns with it, so the trim reads at a glance.
    K.rod([x - 0.004, ty + Math.cos(a) * (r - 0.01), tz + Math.sin(a) * (r - 0.01)], [x - 0.004, ty + Math.cos(a) * (r + 0.006), tz + Math.sin(a) * (r + 0.006)], 0.004, 'dash', 0.4, C.white, 0.2, 4);
    // The TAKEOFF tab in its slot above the wheel.
    const iy = ty + trim * 0.05;
    K.box(x - 0.006, iy - 0.006, tz + r + 0.012, x, iy + 0.006, tz + r + 0.024, 'dash', 0.3, C.white, 0.1);
  }

  // ── THE FUEL SELECTOR AND THE SHUTOFF ────────────────────────────────────
  // No live channel says which tank is selected, so it sits on BOTH, as it does for every flight in a
  // trainer. The red shutoff knob is pushed in (fuel ON) while the engine turns, pulled when it stops.
  {
    const c = [Y.fuel[0], Y.fuel[1], zFloor + 0.10 + 0.004];
    K.obox(add(c, [0, 0, 0.010]), [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.010, 0.042, 0.010, 'dash', 0.2, [30, 30, 34]);
    K.obox(add(c, [0, 0.030, 0.014]), [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.004, 0.012, 0.007, 'dash', 0.3, C.white, 0.1);
    const sk = [Y.fuel[0] + 0.03, Y.fuel[1] + 0.08, zFloor + 0.19];
    const out = running ? 0 : 0.03;
    K.rod(sk, add(sk, [0, -0.012 - out, 0.006]), 0.004, 'dash', 0.3, C.chrome, 0.05, 5);
    K.rod(add(sk, [0, -0.012 - out, 0.006]), add(sk, [0, -0.026 - out, 0.012]), 0.012, 'dash', 0.3, T.cutoff, 0.05, 10);
  }

  // ── THE RUDDER PEDALS, with the toe brakes, both sides ───────────────────
  const pyP = Math.min(P.front - 0.20, 0.78);
  for (const cx of [0, 2 * Y.xC]) {
    for (const [dx, s] of [[-0.085, -1], [0.085, 1]]) {
      const press = clamp(s < 0 ? -rud : rud, 0, 1);
      pedal(K, [cx + dx, pyP, zFloor + 0.36], 0.040, 0.18, press, [34, 34, 38]);
      // The toe brake: a ribbed plate on the pedal's top edge, travelling with it.
      const t = 0.30 + press * 0.45, dir = [0, Math.sin(t), -Math.cos(t)];
      const top = add([cx + dx, pyP, zFloor + 0.36], mul(dir, 0.18 * 0.72));
      for (let r = 0; r < 3; r++) K.rod(add(top, [-0.034, -0.012, 0.012 - r * 0.012]), add(top, [0.034, -0.012, 0.012 - r * 0.012]), 0.003, 'dash', 0.1, [60, 60, 66], 0, 4);
    }
  }

  // ── THE DOME LIGHT ───────────────────────────────────────────────────────
  const dome = !!(L.dome && powered);
  K.box(Y.xC - 0.04, -0.17, P.roof - 0.03, Y.xC + 0.04, -0.03, P.roof - 0.024, 'hdr', 0.3, dome ? [255, 240, 200] : [150, 148, 140], dome ? 1 : 0);
  // The landing light's switch lamp on the map light: a small tell-tale on the console.
  K.box(Y.xC + 0.045, -0.06, P.roof - 0.03, Y.xC + 0.055, -0.04, P.roof - 0.024, 'hdr', 0.3, L.landingLight && powered ? C.green : C.lampOff, L.landingLight && powered ? 1 : 0);

  // ── THE WHISKEY COMPASS'S CARD, turning with the heading ─────────────────
  {
    const wc = [Y.xC, Math.min(P.front - 0.08, 0.66) - 0.021, P.roof - 0.10];
    const Wc = K.panel(wc, [1, 0, 0], [0, 0, 1], 'dash', 0.2);
    Wc.rect(-0.024, -0.013, 0.024, 0.013, [236, 232, 214], post ? 0.8 : 0.35, 0.001);
    for (let i = -3; i <= 3; i++) {
      const xx = ((((hdg / 10) % 1) + 1) % 1) * -0.008 + i * 0.008;
      Wc.rect(xx - 0.0005, -0.008, xx + 0.0005, 0.004, C.black, 0, 0.002);
    }
    Wc.rect(-0.0008, -0.013, 0.0008, 0.013, [230, 60, 40], 0.6, 0.003);
  }

  // ── THE GLARESHIELD'S POST-LIGHT STRIP, after dark ──────────────────────
  if (post) {
    const z = P.dashZ - 0.02;
    K.box(-0.20, py - 0.043, z - 0.002, 0.20, py - 0.040, z, 'dash', 0, T.post, 0.9);
    K.box(Y.xC - 0.1, py - 0.043, z - 0.002, Y.xC + 0.1, py - 0.040, z, 'dash', 0, T.post, 0.9);
  }

  // ── THE HARNESS: lap belt and a shoulder strap each, from the reels in the roof ──
  for (const [cx, s] of [[0, -1], [2 * Y.xC, 1]]) {
    const xOut = cx + s * (P.seatHalf - 0.02), xIn = cx - s * (P.seatHalf - 0.03);
    const reel = [D.X(s * D.halfAt(MAYFLY_EYE[0] - 0.62 / D.m, MAYFLY_EYE[2])) - s * 0.05, -0.62, P.roof - 0.07];
    const buckle = [xIn, P.seatY[1] - 0.28, P.seatZ + 0.07];
    // ⚠ YOURS RUNS BEHIND YOUR SHOULDER, never through the eye: it comes down from the reel aft of
    // the head to the outboard shoulder, then across the chest to the buckle.
    const shoulder = [cx + s * 0.16, P.seatY[0] + 0.02, P.backZ - 0.14];
    K.rod(reel, shoulder, 0.010, 'seat', 0.0, T.belt, 0, 4);
    K.rod(shoulder, buckle, 0.012, 'seat', 0.0, T.belt, 0, 4);
    K.rod([xOut, P.seatY[0] + 0.08, P.seatZ + 0.04], buckle, 0.012, 'seat', 0.0, T.belt, 0, 4);
    K.obox(buckle, [1, 0, 0], [0, 0, 1], [0, -1, 0], 0.022, 0.014, 0.006, 'seat', 0.4, T.buckle, 0.05);
  }
}
