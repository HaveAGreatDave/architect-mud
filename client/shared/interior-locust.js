// THE LOCUST'S COCKPIT — a Piper PA-25 Pawnee's office, lofted off the Locust's own fuselage.
//
// ── WHICH AEROPLANE ──────────────────────────────────────────────────────────
//
// The game calls her an Air Tractor analogue and the old fit-out (interior-fit-craft.js) drew a PT6
// turbine column on the panel. The EXTERIOR says otherwise and the exterior wins, because it is the
// thing you can see the wings of: FW_ROWS.locust is a low-wing monoplane (so not the biplane
// Ag-Cat), a taildragger with a round piston nose and a spinner (`prop: 'nose'`, `noseCowl` 0.34,
// no long turbine snout), a small single-seat greenhouse sat on the fuselage crown AFT of a hopper
// hump (`hump` f 0.46-0.94, canopy f 0.52-0.16). That is the PA-25 Pawnee's layout exactly: engine,
// then hopper, then a high-set pilot under a caged canopy, and a wire cutter on the windscreen. An
// AT-502 is a turbine with a much longer nose and its cockpit sits over the wing trailing edge.
//
// Sources actually read (2026-09-24):
//   https://en.wikipedia.org/wiki/Piper_PA-25_Pawnee — 7.49 m long, 11.02 m span; O-540 flat-six;
//     hopper 1,200 lb dry / 150 US gal liquid; the seat set high for the view over the hopper.
//   https://aeropedia.com.au/content/piper-pa-25-pawnee/ — enclosed cockpit with a steel-tube
//     turnover structure built in; wire cutter on the windscreen centre section.
//   https://planeandpilotmag.com/piper-pawnee-brave/ — a rounded sheet-metal crash pad over the
//     instrument panel; exits both sides; the cable from the cockpit top to the rudder.
//   (search summary of the PA-25 owner's manual listings) — throttle, mixture, trim and the spray
//     controls are on the LEFT side of the cockpit.
//
// ── ⚠ ONE SCALE, STATED ONCE ─────────────────────────────────────────────────
//
// M = 7.49 m / the model's length, spinner apex (noseF + 0.14·spinner, PROP_STATIONS' own note) to
// the tail tip (tailF): 7.49 / 2.106 = 3.557 m per model unit. The model's SPAN is not to scale
// (1.14 u = 4.1 m against a real 11 m — the game draws stubby wings), and nothing in here is
// measured off the wing, so that error cannot reach the room. At that scale the tub is 0.64 m wide
// inside against the Pawnee's ~0.7 m, which is the check that the length was the right thing to use.
//
// ── ⚠ THE ROOM IS THE FUSELAGE, AND THE WINDOWS ARE THE CANOPY ───────────────
//
// Everything about the BOAT OF THIS AIRCRAFT — the tub's walls, how wide it gets, where the sill
// runs, where the glass starts and stops, where each canopy frame is — is evaluated off the same
// params the exterior builds from (`buildFixedWing` in aircraft3d.js: radAt / czAt / humpAt / the
// boxy section / the canopy's windowed-sine profile). The formulas are restated below because
// client/shared may not import the client's panel code; the gate (scripts/shapes/cockpit-locust.mjs)
// measures the glass off the EXTERIOR'S OWN FACES and holds this file to it, so the two copies
// cannot drift silently. The canopy frame sits on `art: 'locust'`'s post stations (U 0/0.16/0.46/
// 0.78/1) and its sill rails at V 0.2/0.8, which are the lines the exterior paints its cage on.
//
// Anything that is a fact about a PERSON — the seat, the stick, the dials, a hand's reach — is
// authored in honest metres. ⚠ The model is short in the vertical for a person: belly to canopy
// top is 1.14 m at this scale where the real cockpit gives about 1.3, so the cushion is 0.62 m
// under the eye rather than 0.75. The eye goes where the glass says (0.035 u above the fuselage
// crown, which keeps the windscreen bow above the straight-ahead line) and the seat gives way.
//
// Metres, origin at the eye, +x right (starboard, the exterior's +g), +y forward, +z up.
import { FW_ROWS } from './vehicle-models.js';
import { makeKit, C, clamp, pedal, SHINY, PANE, TEXTURE } from './interior-kit.js';
import { contactShadow, hotspotHalo, SHADE } from './interior-cockpit-kit.js';

const TAU = Math.PI * 2;
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp = (a, b, t) => a + (b - a) * t;

// ── THE COLOURS AN AG-PLANE HAS ──────────────────────────────────────────────
// Yellow-primed steel for the cage (the exterior's own #ffd24a family), zinc-chromate green for
// the bare interior skin, a scuffed black crash pad, and chemical staining on the floor.
export const LOCUST_TRIM = {
  cage: [128, 132, 128], cageDk: [92, 96, 94], skin: [74, 96, 70], skinDk: [52, 68, 50],
  floor: [58, 60, 54], stain: [104, 116, 66], pad: [30, 30, 32], panel: [38, 40, 38],
  seat: [80, 84, 80], strap: [190, 150, 40], cloth: [46, 50, 58], steel: [150, 156, 164],
  chem: [150, 190, 90], dump: [236, 196, 40], valve: [200, 44, 36],
};
const T = LOCUST_TRIM;
SHINY.set(T.cage, { spec: 0.35, pow: 18 });
SHINY.set(T.steel, { spec: 0.8, pow: 22, ramp: [[60, 64, 70], [232, 236, 240]], glint: 0.3, albedo: [236, 238, 242], envK: 0.8 });
SHINY.set(T.dump, { spec: 0.5, pow: 30 });
SHINY.set(T.valve, { spec: 0.5, pow: 30 });
// The hopper sight tube: glass you look through at the fluid behind it.
const SIGHT_GLASS = [150, 200, 170];
PANE.set(SIGHT_GLASS, 0.30);

// ── THE EXTERIOR, EVALUATED ──────────────────────────────────────────────────
// buildFixedWing's detail-1 fuselage and canopy, for any f and any angle round the section (the
// exterior samples 12 of them; the room wants the curve between).
export function locustExterior(p = FW_ROWS.locust) {
  const tube = p.bodyTube || 0, noseK = p.noseBlunt || 2.4, cowl = p.noseCowl || 0;
  const czAt = (f) => {
    if (f < 0) return (p.tailUp ?? 0.05) * (f / p.tailF);
    const u = Math.min(1, f / p.noseF);
    const t = tube ? Math.max(0, (u - tube) / (1 - tube)) : u;
    return (p.noseZ ?? 0.02) * Math.pow(t, p.noseDroopK ?? 1);
  };
  const radAt = (f) => {
    let u = Math.min(1, Math.abs(f >= 0 ? f / p.noseF : f / p.tailF));
    u = u <= tube ? 0 : (u - tube) / (1 - tube);
    if (f >= 0) { const s = Math.pow(Math.max(0, 1 - Math.pow(u, noseK)), 1 / noseK); return cowl + (1 - cowl) * s; }
    return Math.pow(1 - u, 0.8);
  };
  const humpAt = (f) => {
    const H = p.hump;
    if (!H || f <= H.f0 || f >= H.f1) return 0;
    return H.h * 0.5 * (1 - Math.cos(TAU * (f - H.f0) / (H.f1 - H.f0)));
  };
  const e = 1 - (p.boxy || 0) * 0.55;
  // A point on the skin at station f, angle a (0 = starboard, π/2 = crown): [g, h].
  const sec = (f, a) => {
    const ca = Math.cos(a), sa = Math.sin(a), r = radAt(f);
    return [Math.sign(ca) * Math.pow(Math.abs(ca), e) * p.fr * r,
      czAt(f) + Math.sign(sa) * Math.pow(Math.abs(sa), e) * p.fv * r + humpAt(f) * Math.max(0, sa)];
  };
  const cp = p.canopy;
  const cf = cp.front ?? 0.12, ct = cp.tail ?? 0.04;
  const canT = (f) => (f - cp.f0) / (cp.f1 - cp.f0);                 // 0 at the windscreen, 1 at the rear
  const prof = (t) => Math.sin(Math.PI * (cf + (1 - cf - ct) * t));
  const canBase = (f) => czAt(f) + p.fv * radAt(f) - (cp.sink ?? 0.015);
  // A point on the canopy glass at station f (inside [f1, f0]) and arc angle a (0 stbd sill, π port).
  const can = (f, a) => { const s = prof(canT(f)); return [Math.cos(a) * cp.w * s, canBase(f) + Math.sin(a) * cp.h * s]; };
  const canHalfW = (f) => (f > cp.f0 || f < cp.f1 ? 0 : cp.w * prof(canT(f)));
  const crown = (f) => czAt(f) + p.fv * radAt(f) + humpAt(f);
  const len = p.noseF + 0.14 * (p.spinner ?? 0.5) - p.tailF;
  return { p, cp, czAt, radAt, humpAt, sec, can, canHalfW, canBase, crown, prof, canT, len };
}

// The art's cage, in the canopy's own U (windscreen → rear) and V (sill → crown → sill).
const POSTS_U = [0, 0.16, 0.46, 0.78, 1];
const SILLS_V = [0.2, 0.8];

// ── THE PROFILE ──────────────────────────────────────────────────────────────
export const LOCUST_REAL_LENGTH_M = 7.49;
export const LOCUST_EYE = { f: 0.30, overCrown: 0.035 };

let CACHED = null;
export function locustProfile() {
  if (CACHED) return CACHED;
  const E = locustExterior();
  const M = LOCUST_REAL_LENGTH_M / E.len;
  const fE = LOCUST_EYE.f, hE = E.crown(fE) + LOCUST_EYE.overCrown;
  const X = (g) => g * M, Y = (f) => (f - fE) * M, Z = (h) => (h - hE) * M;
  const fOf = (y) => fE + y / M;
  const geo = { E, M, fE, hE, X, Y, Z, fOf };
  const room = buildRoom(geo);

  const glass = buildGlass(geo);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const f of [...room.faces, ...glass.map((p) => ({ p }))]) for (const q of f.p) {
    x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]);
    y1 = Math.max(y1, q[1]); z0 = Math.min(z0, q[2]); z1 = Math.max(z1, q[2]);
  }
  const halfW = Math.max(-x0, x1) + 1e-6;
  CACHED = {
    label: 'crop duster cockpit (PA-25 Pawnee)',
    xCentre: 0, halfW,
    floor: z0 - 1e-6, roof: z1 + 1e-6, front: y1 + 1e-6, back: y0 - 1e-6,
    dashY: room.dashY, dashZ: room.dashZ, headerZ: room.dashZ + 0.1,
    pillarW: 0.02,
    // The side glass, below the sill rail and over the coaming, fore and aft of the eye.
    winY: [-0.15, 0.35], winZ: [-0.16, 0.02],
    seatZ: SEAT.z, seatHalf: SEAT.half, seatY: SEAT.y, backZ: SEAT.backZ,
    seats: 1, centrePost: 0,
    // The whole top is the greenhouse: straight up is glass, between the 0.46 and 0.78 posts.
    roofGlass: [Y(E.cp.f1), Y(E.cp.f0)],
    normalLit: true,
    // The panel lamps: two post lights under the crash pad's lip, and one over the spray side.
    floods: [{ p: [-0.14, room.dashY - 0.05, room.dashZ - 0.03], r: 0.34 }, { p: [0.14, room.dashY - 0.05, room.dashZ - 0.03], r: 0.34 },
      { p: [-0.24, 0.05, -0.32], r: 0.26 }],
    craft: 'locust',
    // The canopy's panes, one per exterior glass facet (see buildGlass). Not part of shellFaces.
    glass,
    locust: { ...geo, ...room },
    room: locustShell,
    hotspots(live) { return locustHotspots(this, live); },
  };
  return CACHED;
}

// ── THE GLASS ────────────────────────────────────────────────────────────────
// buildFixedWing's canopy facet for facet: `segs` rings fore→aft, `arc` panes sill→crown→sill, and
// a fan across each end ring (the windscreen and the rear light). 4 mm inside the outer skin, which
// is outboard of every cage tube (those sit 18 mm in), so the frame reads in front of the glass.
export const LOCUST_GLASS_INSET = 0.004;
function buildGlass(G) {
  const { E, M, X, Y, Z } = G, cp = E.cp, segs = cp.segs || 5, arc = cp.arc || 3, dIn = LOCUST_GLASS_INSET / M;
  const at = (f, a) => { const [g, h] = E.can(f, a), b = E.canBase(f), d = Math.hypot(g, h - b) || 1, k = Math.max(0, 1 - dIn / d); return [X(g * k), Y(f), Z(b + (h - b) * k)]; };
  const ring = (t) => { const f = lerp(cp.f0, cp.f1, t); return Array.from({ length: arc + 1 }, (_, k) => at(f, Math.PI * k / arc)); };
  const panes = [];
  let A = ring(0);
  for (let i = 1; i <= segs; i++) {
    const B = ring(i / segs);
    for (let k = 0; k < arc; k++) panes.push([A[k], A[k + 1], B[k + 1], B[k]]);
    A = B;
  }
  for (const t of [0, 1]) {
    const R = ring(t), c = mul(R.reduce((s, v) => add(s, v), [0, 0, 0]), 1 / R.length);
    for (let k = 0; k < arc; k++) panes.push([c, R[k], R[k + 1]]);
  }
  return panes;
}

// A person, in metres.
const SEAT = { z: -0.62, half: 0.20, y: [-0.42, 0.06], backZ: -0.06 };

// ── CLIPPING ─────────────────────────────────────────────────────────────────
function clip(poly, s) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], sa = s(a), sb = s(b);
    if (sa >= 0) out.push(a);
    if ((sa >= 0) !== (sb >= 0)) { const t = sa / (sa - sb); out.push(add(a, mul(sub(b, a), t))); }
  }
  return out;
}

// ── THE ROOM ─────────────────────────────────────────────────────────────────
// Built once. Returns faces `{p, n, tone, k, rgb, emis}` and the few measured numbers the fit reads.
function buildRoom(G) {
  const { E, M, X, Y, Z, fOf } = G;
  const faces = [];
  const put = (p, n, tone, k, rgb, emis) => { if (p.length >= 3) faces.push({ p, n: norm(n), tone, k, rgb, emis }); };
  const K = makeKit((fs, tone, k, fwd, rgb, emis) => { for (const f of fs) faces.push({ p: f.p, n: f.n, tone, k, rgb, emis }); }, false);
  const wall = 0.03 / M;                                     // the skin and its stringers, 3 cm
  const fB = 0.13, fF = 0.55;                                // the turnover frame behind you, the hopper's aft wall ahead
  const floorZ = Z(E.czAt(G.fE) - E.p.fv * 0.85);
  // The inner skin at (f, a): pulled toward the section's middle by the wall.
  const inner = (f, a) => {
    const [g, h] = E.sec(f, a), cz = E.czAt(f) + E.humpAt(f) * 0.5;
    const d = Math.hypot(g, h - cz) || 1, k = 1 - wall / d;
    return [X(g * k), Y(f), Z(cz + (h - cz) * k)];
  };
  // Keep a skin point only outside the canopy's footprint (the sill cut) and above the floor.
  const sillCut = (side) => (q) => {
    const hw = X(E.canHalfW(fOf(q[1])));
    return hw <= 0 ? 1 : side * q[0] - hw;
  };
  const aboveFloor = (q) => q[2] - floorZ;

  // ── THE TUB WALLS: the inner skin from the floor up to the canopy's sill, each side ──
  // Two tones in bays between the stringers, which is what bare zinc-chromate reads as.
  const NF = 30, NA = 24;
  for (const side of [1, -1]) {
    for (let i = 0; i < NF; i++) {
      const f0 = lerp(fB, fF, i / NF), f1 = lerp(fB, fF, (i + 1) / NF);
      for (let j = 0; j < NA; j++) {
        const a0 = -Math.PI / 2 + (j / NA) * Math.PI, a1 = -Math.PI / 2 + ((j + 1) / NA) * Math.PI;
        const A = side > 0 ? a0 : Math.PI - a0, B = side > 0 ? a1 : Math.PI - a1;
        let poly = [inner(f0, A), inner(f1, A), inner(f1, B), inner(f0, B)];
        poly = clip(clip(poly, aboveFloor), sillCut(side));
        if (poly.length < 3) continue;
        const c = mul(poly.reduce((s, v) => add(s, v), [0, 0, 0]), 1 / poly.length);
        let n = norm(cross(sub(poly[1], poly[0]), sub(poly[poly.length - 1], poly[0])));
        const mid = [0, c[1], Z(E.czAt(fOf(c[1])))];
        if (dot(n, sub(mid, c)) < 0) n = mul(n, -1);
        const band = (i + (j >> 1)) & 1;
        put(poly, n, 'pil', band ? -0.05 : -0.14, band ? T.skin : T.skinDk);
      }
    }
  }
  // ── THE STRINGERS AND FRAMES: the steel-tube truss showing through the skin ──
  for (const side of [1, -1]) {
    for (const a of [-0.25, 0.2]) {
      const A = side > 0 ? a : Math.PI - a;
      let prev = null;
      for (let i = 0; i <= 8; i++) {
        const q = inner(lerp(fB + 0.01, fF - 0.01, i / 8), A);
        const p = [q[0] * 0.985, q[1], q[2]];
        if (prev && q[2] > floorZ + 0.02) K.rod(prev, p, 0.006, 'pil', 0.12, T.cageDk, 0, 6, false);
        prev = p;
      }
    }
  }

  // ── THE FLOOR: between the walls, plate with chemical stains that no wash takes out ──
  const floorHalf = (f) => {
    let lo = -Math.PI / 2, hi = 0;
    if (inner(f, lo)[2] > floorZ) return inner(f, lo)[0];
    for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (inner(f, m)[2] < floorZ) lo = m; else hi = m; }
    return inner(f, lo)[0];
  };
  for (let i = 0; i < NF; i++) {
    const f0 = lerp(fB, fF, i / NF), f1 = lerp(fB, fF, (i + 1) / NF);
    const w0 = floorHalf(f0) + 0.01, w1 = floorHalf(f1) + 0.01;
    put([[-w0, Y(f0), floorZ], [w0, Y(f0), floorZ], [w1, Y(f1), floorZ], [-w1, Y(f1), floorZ]], [0, 0, 1], 'floor', -0.2, T.floor);
  }
  for (const [x, y, rx, ry] of [[0.10, 0.34, 0.09, 0.06], [-0.12, 0.52, 0.06, 0.05], [0.05, -0.25, 0.05, 0.08]]) {
    const pts = []; for (let k = 0; k < 10; k++) { const t = (k / 10) * TAU; pts.push([x + Math.cos(t) * rx * (0.8 + 0.3 * Math.sin(3 * t)), y + Math.sin(t) * ry, floorZ + 0.002]); }
    put(pts, [0, 0, 1], 'floor', -0.1, T.stain);
  }

  // ── THE ENDS ──
  // The hopper's aft wall ahead of your feet, and the turnover frame's bulkhead behind the seat.
  const endCap = (f) => {
    const pts = [];
    for (let k = 0; k < 32; k++) pts.push(inner(f, -Math.PI / 2 + (k / 32) * TAU));
    return clip(pts, aboveFloor);
  };
  put(endCap(fF), [0, -1, 0], 'post', -0.25, T.skinDk);
  put(endCap(fB), [0, 1, 0], 'post', -0.12, T.skin);

  // ── THE TURNOVER STRUCTURE: the steel hoop behind your head, padded where the head meets it ──
  // It reaches up inside the rear of the canopy — which is also what a ray back over the seat meets.
  const yT = Y(fB) + 0.03, fT = fOf(yT);
  const tBase = Z(E.crown(fT)) - 0.02;
  const topT = Z(E.canBase(E.cp.f1) + E.cp.h * E.prof(1) * 0.62);
  const xT = Math.min(0.22, X(E.canHalfW(E.cp.f1)) - 0.03);
  K.rod([-xT, yT, tBase], [-xT, yT, topT], 0.016, 'pil', 0.2, T.cage, 0, 8);
  K.rod([xT, yT, tBase], [xT, yT, topT], 0.016, 'pil', 0.2, T.cage, 0, 8);
  K.rod([-xT, yT, topT], [xT, yT, topT], 0.016, 'pil', 0.2, T.cage, 0, 8);
  K.box(-0.16, yT + 0.02, tBase + 0.10, 0.16, yT + 0.08, topT - 0.03, 'seat', -0.05, T.pad);
  // The headrest, cantilevered forward off the hoop on two tubes to where the back of a head is.
  const hr = { y0: -0.29, y1: -0.24, z0: -0.06, z1: 0.13 };
  for (const s of [-0.07, 0.07]) K.rod([s, yT + 0.01, topT], [s, hr.y0, hr.z0 + 0.04], 0.009, 'pil', 0.2, T.cage, 0, 6);
  K.box(-0.10, hr.y0, hr.z0, 0.10, hr.y1, hr.z1, 'seat', -0.08, T.pad);
  K.box(-0.105, hr.y0 - 0.008, hr.z0 - 0.005, 0.105, hr.y0, hr.z1 + 0.005, 'seat', -0.2, T.seat);

  // ── RIVETS: flush heads down every frame and stringer line of the upper wall ──
  for (const side of [1, -1]) {
    for (let i = 1; i < NF; i++) {
      const f = lerp(fB, fF, i / NF);
      for (let j = 3; j < NA; j += 2) {
        const a0 = -Math.PI / 2 + (j / NA) * Math.PI, A = side > 0 ? a0 : Math.PI - a0;
        const q = inner(f, A);
        if (q[2] < floorZ + 0.05 || side * q[0] < X(E.canHalfW(f)) + 0.01) continue;
        const nn = norm([-q[0], 0, Z(E.czAt(f)) - q[2]]), c = add(q, mul(nn, 0.002));
        const du = [0, 0.006, 0], dv = mul(norm(cross(nn, du)), 0.006);
        put([add(c, du), add(c, dv), sub(c, du), sub(c, dv)], nn, 'pil', 0.15, T.steel);
      }
    }
  }

  // ── THE CANOPY CAGE: on the art's posts and sills, just inside the glass ──
  const cp = E.cp, cIn = 0.018 / M;
  const canIn = (f, a) => { const [g, h] = E.can(f, a); const b = E.canBase(f); const d = Math.hypot(g, h - b) || 1; const k = Math.max(0, 1 - cIn / d); return [X(g * k), Y(f), Z(b + (h - b) * k)]; };
  const canopyRims = [];
  for (const u of POSTS_U) {
    const f = lerp(cp.f0, cp.f1, u), f2 = clamp(f + (u === 0 ? -0.006 : u === 1 ? 0.006 : 0), cp.f1, cp.f0);
    const heavy = u === 0 ? 0.009 : 0.0065;
    let prev = null;
    const rim = [];
    for (let k = 0; k <= 20; k++) {
      const p = canIn(f2, Math.PI * k / 20);
      rim.push(p);
      if (prev) K.rod(prev, p, heavy, 'pil', 0.22, T.cage, 0, 8, false);
      prev = p;
    }
    canopyRims.push({ u, f: f2, rim });
  }
  for (const v of SILLS_V) {
    const a = Math.PI * v;
    let prev = null;
    for (let i = 0; i <= 20; i++) {
      const p = canIn(lerp(cp.f0 - 0.006, cp.f1 + 0.006, i / 20), a);
      if (prev) K.rod(prev, p, 0.006, 'pil', 0.22, T.cage, 0, 8, false);
      prev = p;
    }
  }
  // The sill rails the glass sits on, down each side.
  for (const a of [0, Math.PI]) {
    let prev = null;
    for (let i = 0; i <= 20; i++) {
      const p = canIn(lerp(cp.f0 - 0.006, cp.f1 + 0.006, i / 20), a + (a ? -0.04 : 0.04));
      if (prev) K.rod(prev, p, 0.007, 'pil', 0.18, T.cageDk, 0, 8, false);
      prev = p;
    }
  }
  // The coaming: a flat ledge from the tub's top edge in to the sill rail, each side.
  const coamingZ = Z(E.canBase(G.fE));

  // ── THE CRASH PAD AND THE PANEL ──
  // A rounded sheet-metal roll over the panel, clear of the windscreen base, and the flat panel
  // under it. The pad's crown stays well under the straight-ahead line.
  const fWs = cp.f0, yWs = Y(fWs), zWs = Z(E.canBase(fWs));
  const dashY = yWs - 0.18, dashZ = zWs + 0.03;
  const hwPad = Math.min(X(E.canHalfW(fWs)) + 0.02, floorHalf(fOf(dashY)) - 0.01);
  const NP = 8;
  for (let k = 0; k < NP; k++) {                               // the roll, as a half-cylinder of facets
    const t0 = -Math.PI / 2 + (k / NP) * Math.PI, t1 = -Math.PI / 2 + ((k + 1) / NP) * Math.PI, tm = (t0 + t1) / 2;
    const r = 0.055, cy = dashY + r, cz = dashZ - r;
    const Q = (t, x) => [x, cy - Math.cos(t) * r, cz + Math.sin(t) * r];
    put([Q(t0, -hwPad), Q(t0, hwPad), Q(t1, hwPad), Q(t1, -hwPad)], [0, -Math.cos(tm), Math.sin(tm)], 'dash', 0.05 + Math.sin(tm) * 0.2, T.pad);
  }
  // The deck from the pad forward to the windscreen base.
  put([[-hwPad, dashY + 0.055, dashZ], [hwPad, dashY + 0.055, dashZ], [hwPad, yWs, dashZ], [-hwPad, yWs, dashZ]], [0, 0, 1], 'dash', 0.25, T.pad);
  // Pad end caps.
  for (const s of [-1, 1]) {
    const pts = []; for (let k = 0; k <= NP; k++) { const t = -Math.PI / 2 + (k / NP) * Math.PI; pts.push([s * hwPad, dashY + 0.055 - Math.cos(t) * 0.055, dashZ - 0.055 + Math.sin(t) * 0.055]); }
    put(pts, [s, 0, 0], 'dash', 0.0, T.pad);
  }
  // The panel board: from under the pad down toward the knees, facing the pilot.
  const panelTop = dashZ - 0.11, panelBot = dashZ - 0.36, panelY = dashY + 0.035;
  const hwP = Math.min(hwPad, floorHalf(fOf(panelY)) - 0.005);
  put([[hwP, panelY, panelBot], [-hwP, panelY, panelBot], [-hwP, panelY, panelTop], [hwP, panelY, panelTop]], [0, -1, 0], 'dash', -0.1, T.panel);
  // Under the panel, the sub-panel to the hopper wall.
  put([[-hwP, panelY, panelBot], [hwP, panelY, panelBot], [hwP, Y(fF) - 0.002, panelBot - 0.02], [-hwP, Y(fF) - 0.002, panelBot - 0.02]], [0, 0, -1], 'dash', -0.35, T.panel);

  // ── THE WIRE CUTTER, outside the glass on the windscreen's centre line ──
  // A saw-toothed steel blade from the deck up the bow frame. ⚠ IT STOPS SHORT OF THE EYE LINE:
  // the real one runs up a centre post, and a centre post is the straight-ahead ray.
  const yC = yWs + 0.02, zC0 = zWs - 0.005, zC1 = -0.035;
  K.obox([0, yC, (zC0 + zC1) / 2], [1, 0, 0], [0, 0, 1], [0, 1, 0], 0.004, (zC1 - zC0) / 2, 0.018, 'dash', 0.2, T.steel);
  for (let k = 0; k < 5; k++) {
    const z = lerp(zC0 + 0.01, zC1 - 0.01, k / 4);
    put([[0, yC - 0.018, z], [0, yC - 0.036, z + 0.012], [0, yC - 0.018, z + 0.024]], [1, 0, 0], 'dash', 0.3, T.steel);
  }

  return { faces, dashY, dashZ, panelTop, panelBot, panelY, hwP, floorZ, canopyRims, coamingZ };
}

// ── THE READINGS ─────────────────────────────────────────────────────────────
function readLive(live) {
  const L = live || {};
  return {
    L,
    pitch: num(L.pitch), bank: num(L.bank), hdg: num(L.hdg),
    ias: Math.max(0, num(L.ias)), vne: Math.max(40, num(L.vne, 125)),
    alt: Math.max(0, num(L.alt)), vsi: num(L.vsi),
    rpm: clamp(num(L.rpm), 0, 1.05), thr: clamp(num(L.throttle), 0, 1),
    fuel: clamp(num(L.fuel, 1), 0, 1), hull: clamp(num(L.hull, 1), 0, 1),
    oil: clamp(num(L.oilTemp, 0.5), 0, 1),
    powered: L.powered !== false,
    ail: clamp(num(L.stickX), -1, 1), elev: clamp(num(L.stickY), -1, 1), rud: clamp(num(L.rudder), -1, 1),
    trim: clamp(num(L.trim), -1, 1), flap: clamp(num(L.flapNotch), 0, 3),
    // ⚠ Not yet in windshield.js's liveInstruments: the hopper as a fraction, the spray valve open,
    // and the dump pulled. Each rests at a believable value until the lead wires it.
    hopper: clamp(num(L.hopper, 1), 0, 1), spraying: !!L.spraying, dump: !!L.dumping,
    courseErr: clamp(num(L.courseErr) / 20, -1, 1),
    land: !!L.landingLight, dome: !!L.dome, hour: num(L.hour, 12), stall: !!L.stall,
  };
}

// Where the hands go, one place, read by both the drawing and the hotspots.
const HAND = {
  stick: (R) => [R.ail * 0.07, 0.30 + R.elev * 0.08, -0.34],
  thrPivot: [-0.27, 0.12, -0.44],
  throttle: (R) => { const t = -0.55 + R.thr * 1.1; return [-0.27, 0.12 + Math.sin(t) * 0.13, -0.44 + Math.cos(t) * 0.13]; },
  mixture: (R) => { const t = -0.55 + (R.powered ? 1 : 0) * 1.0; return [-0.245, 0.12 + Math.sin(t) * 0.12, -0.44 + Math.cos(t) * 0.12]; },
  valvePivot: [-0.22, 0.04, -0.60],
  valve: (R) => { const t = R.spraying ? 0.55 : -0.35; return [-0.22, 0.04 + Math.sin(t) * 0.24, -0.60 + Math.cos(t) * 0.24]; },
  flapPivot: [-0.19, -0.05, -0.64],
  flap: (R) => { const t = -0.2 - R.flap * 0.28; return [-0.19, -0.05 + Math.sin(t) * 0.28, -0.64 + Math.cos(t) * 0.28]; },
  trim: [-0.29, -0.12, -0.36],
};

export function locustHotspots(P, live) {
  const R = readLive(live);
  const Pn = panelOf(makeKit(() => {}), P);
  const out = [
    { id: 'yoke', p: add(HAND.stick(R), [0, 0.01, 0.10]), r: 0.07, kind: 'yoke' },
    { id: 'throttle', p: HAND.throttle(R), r: 0.035, kind: 'throttle' },
    { id: 'ck:flaps', p: HAND.flap(R), r: 0.03, kind: 'click' },
  ];
  SWITCHES.forEach((id, i) => out.push({ id: 'ck:' + id, p: Pn.pt(SW_U0 + i * 0.03, SW_V, 0.01), r: 0.013, kind: 'click' }));
  return out;
}

// ⚠ EVERY ONE IS A CIRCUIT THE SIM HAS. NAV and STB were here, and the sim has neither: two switches
// that took the hand cursor and did nothing. NAV is the panel lights now.
const SWITCHES = ['master', 'land', 'panel'];
const SW_U0 = -0.225, SW_V = -0.10;
function panelOf(K, P) {
  const D = P.locust;
  const zc = (D.panelTop + D.panelBot) / 2 + 0, yc = D.panelY - 0.003;
  const Pn = K.panel([0, yc, zc], [1, 0, 0], [0, 0, 1], 'dash', 0.2);
  Pn.zc = zc; Pn.hh = (D.panelTop - D.panelBot) / 2; Pn.hw = D.hwP;
  return Pn;
}

// ── THE SHELL, AS interior-shell.js CALLS IT ─────────────────────────────────
function locustShell(P, live, push, rich) {
  const D = P.locust;
  for (const f of D.faces) push(f.one || (f.one = Object.assign([{ p: f.p, n: f.n }], { stable: true })), f.tone, f.k, false, f.rgb, f.emis || 0);
  if (rich) locustFit(P, live, push);
}

// ── THE FIT-OUT: everything that moves ───────────────────────────────────────
function locustFit(P, live, push) {
  const K = makeKit(push);
  const R = readLive(live);
  const D = P.locust;
  const on = R.powered;
  // The post lights over the panel are the PANEL switch (cockpit.js 'ck:panel'); a view that sends no
  // switch state, a seat shot, lights them after dark.
  const panelOn = on && (R.L.panelLight != null ? !!R.L.panelLight : R.hour < 6.5 || R.hour > 19);
  const glow = panelOn ? 0.25 : 0;

  // ── THE PANEL (Pawnee C, left to right) ──
  // Flight group on the left under the pilot's eye: airspeed, a small gyro horizon, altimeter; a
  // turn-and-slip and the climb under them. Engine to the right: tach, manifold pressure, oil
  // temp/press, fuel. The ag group far right: boom pressure and the hopper's sight gauge.
  const Pn = panelOf(K, P);
  const hh = Pn.hh, r = 0.034;
  Pn.rect(-Pn.hw + 0.01, -hh + 0.01, Pn.hw - 0.01, hh - 0.01, [44, 46, 44], glow * 0.2, 0.001);
  const r1 = hh * 0.42, r2 = -hh * 0.18;
  // Every instrument is held in by four screws at the corners of its cutout.
  for (const [ca, cb, rr] of [[-0.19, r1, r], [-0.105, r1, r * 0.9], [-0.02, r1, r], [-0.19, r2, r * 0.85], [-0.105, r2, r * 0.85],
    [0.07, r1, r], [0.07, r2, r * 0.85], [0.145, r1 + 0.01, r * 0.6], [0.145, r2 + 0.005, r * 0.6], [0.235, r1, r * 0.7]]) {
    for (const [sa, sb] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) Pn.disc(ca + sa * rr * 1.12, cb + sb * rr * 1.12, 0.0028, T.steel, 0, 0.002, 8);
  }
  Pn.dial(-0.19, r1, r, clamp(R.ias / (R.vne * 1.1), 0, 1), { ticks: 14, major: 2, arcs: [[0.22, 0.72, C.green], [0.72, 0.88, C.amber]], red: 0.9, name: 'MPH' });
  Pn.attitude(-0.105, r1, r * 0.9, R.pitch, R.bank);
  Pn.dial(-0.02, r1, r, (R.alt % 1000) / 1000, { a0: Math.PI / 2, sweep: TAU, ticks: 10, major: 1, frac2: (R.alt % 10000) / 10000, name: 'ALT' });
  Pn.dial(-0.19, r2, r * 0.85, clamp(0.5 + R.bank / 60, 0, 1), { a0: Math.PI * 0.9, sweep: Math.PI * 0.8, ticks: 4, major: 2, needle: C.white, name: 'TURN' });
  Pn.dial(-0.105, r2, r * 0.85, clamp(0.5 + R.vsi / 4000, 0, 1), { a0: Math.PI, sweep: Math.PI * 1.8, ticks: 8, major: 2, name: 'VSI' });
  const run = on ? R.rpm : 0;
  Pn.dial(0.07, r1, r, clamp(run / 1.05, 0, 1), { ticks: 14, major: 2, arcs: [[0.35, 0.86, C.green]], red: 0.9, name: 'RPM' });
  Pn.dial(0.07, r2, r * 0.85, on ? clamp(0.3 + R.thr * 0.6, 0, 1) : 0.05, { ticks: 10, major: 2, arcs: [[0.35, 0.9, C.green]], name: 'MAP' });
  Pn.dial(0.145, r1 + 0.01, r * 0.6, on ? R.oil : 0, { ticks: 6, major: 2, arcs: [[0.3, 0.8, C.green]], red: 0.9, name: 'OIL T' });
  Pn.dial(0.145, r2 + 0.005, r * 0.6, on ? 0.55 + R.thr * 0.2 : 0, { ticks: 6, major: 2, arcs: [[0.3, 0.8, C.green]], red: 0.9, name: 'OIL P' });
  Pn.bar(0.19, r2 - 0.03, r1 + 0.03, 0.008, R.fuel, R.fuel < 0.15 ? C.red : C.green, 'FUEL');
  // Boom pressure: up when the valve is open and the pump is turning.
  Pn.dial(0.235, r1, r * 0.7, on && R.spraying ? 0.45 + R.rpm * 0.3 : 0.02, { ticks: 8, major: 2, arcs: [[0.3, 0.7, C.green]], red: 0.85, name: 'BOOM' });
  // THE HOPPER SIGHT GAUGE: a tube with the chemical standing in it, and its gallons under it.
  const hx = 0.235, hb0 = r2 - 0.045, hb1 = r2 + 0.03;
  Pn.rect(hx - 0.012, hb0 - 0.004, hx + 0.012, hb1 + 0.004, C.black, 0, 0.002);
  Pn.rect(hx - 0.008, hb0, hx + 0.008, lerp(hb0, hb1, R.hopper), T.chem, on ? 0.4 : 0.15, 0.004);
  for (let k = 0; k <= 4; k++) Pn.rect(hx + 0.008, lerp(hb0, hb1, k / 4) - 0.0006, hx + 0.013, lerp(hb0, hb1, k / 4) + 0.0006, C.tick, 0.3, 0.005);
  Pn.rect(hx - 0.008, hb0, hx + 0.008, hb1, SIGHT_GLASS, 0, 0.007);
  if (on) Pn.digits(hx - 0.028, hb0 - 0.02, 0.011, String(Math.round(150 * R.hopper)).padStart(3, ' '), C.lcd);
  // Warning lamps along the top: low fuel, stall, the spray valve open.
  Pn.lamp(-0.19, hh - 0.018, 0.008, 0.005, on && R.fuel < 0.15, C.amber);
  Pn.lamp(-0.16, hh - 0.018, 0.008, 0.005, on && R.stall, C.red);
  Pn.lamp(0.235, hh - 0.018, 0.010, 0.005, on && R.spraying, C.green);
  // Their names go over them: under them is the top row of dials.
  for (const [u, s] of [[-0.19, 'FUEL'], [-0.16, 'STALL'], [0.235, 'SPRAY']]) Pn.text(s, u, hh - 0.006, 0.007);
  // The switch row: master red, the rest black, each thrown up when on.
  const SW_NAME = { master: 'BAT', land: 'LDG', panel: 'PNL' };
  const st = { master: on, land: R.land && on, panel: panelOn };
  SWITCHES.forEach((id, i) => {
    const u = SW_U0 + i * 0.03;
    Pn.rect(u - 0.011, SW_V + 0.018, u + 0.011, SW_V + 0.024, T.cage, 0.1, 0.002);
    Pn.rocker(u, SW_V, !!st[id], id === 'master' ? C.fireRed : C.black, SW_NAME[id]);
  });
  // The mag switch: a key at the bottom left.
  Pn.disc(-0.105, SW_V, 0.012, C.chrome, 0.1, 0.003, 10);
  Pn.stud(-0.105, SW_V, 0.003, 0.009, 0.012, C.black);
  Pn.text('MAG', -0.105, SW_V - 0.02, 0.0085);

  // ── THE DUMP: a yellow T-handle under the right of the panel. Pull it and 150 gallons go. ──
  const dz = D.panelBot - 0.02, dy0 = D.panelY - 0.01, dy = dy0 - (R.dump ? 0.10 : 0.015), dx = 0.18;
  K.rod([dx, dy0, dz], [dx, dy, dz], 0.005, 'dash', 0.1, T.steel, 0, 5);
  K.rod([dx - 0.045, dy, dz], [dx + 0.045, dy, dz], 0.011, 'dash', 0.25, T.dump, 0.1, 8);
  K.obox([dx, dy0 - 0.003, dz], [1, 0, 0], [0, 0, 1], [0, -1, 0], 0.02, 0.02, 0.004, 'dash', 0.1, C.black);

  // ── THE LIGHTBAR: swath guidance on the crash pad, the lit segment walking with your line ──
  const ly = P.dashY + 0.07, lz = P.dashZ + 0.004;
  K.box(-0.13, ly - 0.012, lz, 0.13, ly + 0.012, lz + 0.022, 'dash', 0.1, C.black);
  for (let i = 0; i < 15; i++) {
    const x = -0.119 + i * 0.017, lit = on && Math.abs((i - 7) / 7 - R.courseErr) < 0.1;
    const rgb = i === 7 ? C.green : i < 7 ? C.amber : C.red;
    K.box(x - 0.006, ly - 0.0125, lz + 0.006, x + 0.006, ly - 0.0121, lz + 0.016, 'dash', 0.2, lit ? rgb : rgb.map((c) => c * 0.18), lit ? 1 : 0);
  }
  // A wet compass on the pad beside it, card turning under its lubber line.
  const cmp = K.panel([0.18, P.dashY + 0.035, P.dashZ + 0.03], [1, 0, 0], [0, -0.3, 1], 'dash', 0.2);
  K.box(0.145, P.dashY + 0.02, P.dashZ, 0.215, P.dashY + 0.08, P.dashZ + 0.06, 'dash', 0.1, C.black);
  cmp.compass(0, 0, 0.022, R.hdg);

  // ── THE STICK, between the knees, the spray-arm button on its head ──
  const base = [0, 0.30, D.floorZ + 0.05];
  contactShadow(K, [0, 0.30, D.floorZ], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.08, 0.08);
  K.obox([0, 0.30, D.floorZ + 0.03], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.05, 0.05, 0.03, 'dash', 0, C.rubber);
  const tip = HAND.stick(R);
  K.rod(base, tip, 0.012, 'dash', 0.05, T.steel, 0, 6);
  const grip = add(tip, [0, 0.01, 0.11]);
  K.rod(tip, grip, 0.019, 'dash', 0.05, C.grip, 0, 8);
  K.obox(add(grip, [0, 0, 0.005]), [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.007, 0.007, 0.005, 'dash', 0.3, R.spraying ? C.green : [40, 90, 50], R.spraying ? 0.6 : 0);

  // ── THE PEDALS, and a heel board under them ──
  const pz = D.floorZ + 0.36, py = 0.62;
  K.box(-0.17, py - 0.12, D.floorZ, 0.17, py + 0.02, D.floorZ + 0.01, 'floor', -0.1, T.floor);
  pedal(K, [-0.10, py, pz], 0.04, 0.17, Math.max(0, -R.rud), T.steel);
  pedal(K, [0.10, py, pz], 0.04, 0.17, Math.max(0, R.rud), T.steel);
  K.rod([-0.14, py, pz], [0.14, py, pz], 0.008, 'dash', 0, T.steel, 0, 5);

  // ── THE LEFT WALL: throttle and mixture quadrant, trim crank, spray valve, flap bar ──
  const qp = HAND.thrPivot;
  K.box(qp[0] - 0.035, qp[1] - 0.10, qp[2] - 0.03, qp[0] + 0.035, qp[1] + 0.10, qp[2], 'dash', -0.05, [34, 36, 34]);
  K.rod(qp, HAND.throttle(R), 0.005, 'dash', 0, T.steel, 0.1, 5);
  K.obox(HAND.throttle(R), [1, 0, 0], [0, 0, 1], [0, -1, 0], 0.012, 0.012, 0.012, 'dash', 0.1, C.black);
  const mp = [qp[0] + 0.025, qp[1], qp[2]];
  K.rod(mp, HAND.mixture(R), 0.004, 'dash', 0, T.steel, 0.1, 5);
  K.obox(HAND.mixture(R), [1, 0, 0], [0, 0, 1], [0, -1, 0], 0.009, 0.009, 0.009, 'dash', 0.1, C.red);
  // The trim crank: a wheel on the wall, and a pointer on a scale that moves with the trim.
  const tc = HAND.trim;
  K.torus(tc, [0, 1, 0], [0, 0, 1], 0.035, 0.005, 12, 'dash', 0.1, C.black);
  const ta = R.trim * 2.4;
  K.rod(tc, add(tc, [0.02, Math.cos(ta) * 0.035, Math.sin(ta) * 0.035]), 0.004, 'dash', 0.1, T.steel, 0, 4);
  K.box(tc[0] - 0.004, tc[1] + 0.05, tc[2] - 0.05, tc[0] + 0.002, tc[1] + 0.07, tc[2] + 0.05, 'dash', 0.1, C.black);
  K.box(tc[0] + 0.002, tc[1] + 0.052, tc[2] + R.trim * 0.045 - 0.003, tc[0] + 0.006, tc[1] + 0.068, tc[2] + R.trim * 0.045 + 0.003, 'dash', 0.2, C.white, 0.2);
  // The spray valve: a long red-knobbed lever, pushed forward to open the pump to the booms.
  const vp = HAND.valvePivot, vt = HAND.valve(R);
  K.box(vp[0] - 0.02, vp[1] - 0.05, vp[2] - 0.02, vp[0] + 0.02, vp[1] + 0.05, vp[2] + 0.01, 'dash', -0.05, [34, 36, 34]);
  K.rod(vp, vt, 0.007, 'dash', 0.1, T.steel, 0, 6);
  K.rod(vt, add(vt, [0.035, 0, 0]), 0.013, 'dash', 0.2, T.valve, 0, 8);
  // The flap bar on the floor left of the seat: pulled up a notch at a time.
  const fp = HAND.flapPivot, ft = HAND.flap(R);
  K.box(fp[0] - 0.02, fp[1] - 0.06, D.floorZ, fp[0] + 0.02, fp[1] + 0.06, fp[2], 'dash', -0.1, [34, 36, 34]);
  K.rod(fp, ft, 0.008, 'dash', 0.1, T.steel, 0, 6);
  K.rod(ft, add(ft, [0, -0.03, 0.02]), 0.013, 'dash', 0.1, C.black, 0, 8);

  // ── THE SEAT: an aluminium bucket on the floor, a cushion, a padded back, a five-point harness ──
  const sz = SEAT.z, [sy0, sy1] = SEAT.y, sh = SEAT.half;
  contactShadow(K, [0, (sy0 + sy1) / 2, D.floorZ], [1, 0, 0], [0, 1, 0], [0, 0, 1], sh * 1.1, 0.26);
  K.box(-sh, sy0, D.floorZ + 0.01, sh, sy1, sz - 0.06, 'seat', -0.2, T.seat);
  K.box(-sh + 0.015, sy0 + 0.01, sz - 0.06, sh - 0.015, sy1 - 0.01, sz, 'seat', 0.05, T.cloth);
  for (const s of [-1, 1]) K.box(s * sh - (s > 0 ? 0.04 : 0), sy0, sz - 0.06, s * sh + (s > 0 ? 0 : 0.04), sy1, sz + 0.04, 'seat', -0.02, T.seat);
  const bk0 = [0, sy0 - 0.04, sz + 0.02], bk1 = [0, sy0 - 0.13, SEAT.backZ];
  const bU = norm(sub(bk1, bk0)), bN = norm(cross([1, 0, 0], bU));
  const bc = mul(add(bk0, bk1), 0.5), bh = Math.hypot(...sub(bk1, bk0)) / 2;
  K.obox(bc, [1, 0, 0], bU, bN[1] > 0 ? bN : mul(bN, -1), sh - 0.02, bh, 0.03, 'seat', -0.05, T.cloth);
  K.obox(add(bc, mul(bN[1] > 0 ? bN : mul(bN, -1), -0.04)), [1, 0, 0], bU, bN[1] > 0 ? bN : mul(bN, -1), sh, bh + 0.02, 0.01, 'seat', -0.2, T.seat);
  // The harness: two shoulder straps off the turnover frame, a lap belt, a crotch strap, the buckle.
  const buckle = [0, -0.14, sz + 0.14];
  for (const s of [-1, 1]) {
    K.rod([s * 0.09, sy0 - 0.12, SEAT.backZ - 0.02], [s * 0.08, -0.16, sz + 0.34], 0.012, 'seat', 0.1, T.strap, 0, 4);
    K.rod([s * 0.08, -0.16, sz + 0.34], add(buckle, [s * 0.02, 0, 0.02]), 0.012, 'seat', 0.1, T.strap, 0, 4);
    K.rod([s * (sh - 0.02), sy0 + 0.05, sz + 0.02], add(buckle, [s * 0.03, 0, -0.01]), 0.012, 'seat', 0.1, T.strap, 0, 4);
  }
  K.rod([0, sy1 - 0.12, sz + 0.005], add(buckle, [0, 0, -0.02]), 0.01, 'seat', 0.1, T.strap, 0, 4);
  K.obox(buckle, [1, 0, 0], [0, 0, 1], [0, -1, 0], 0.03, 0.03, 0.008, 'seat', 0.3, T.steel);

  // ── THE DOME: a small lamp on the turnover hoop, lit on the switch ──
  const domeOn = R.dome && on;
  K.obox([0, P.back + 0.08, P.roof * 0.55], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.03, 0.015, 0.012, 'pil', 0.1, domeOn ? [255, 236, 190] : [60, 58, 52], domeOn ? 1 : 0);

  hotspotHalo(K, locustHotspots(P, live), live);
}

// ── SURFACE MATERIALS ────────────────────────────────────────────────────────
// The cage and the tube truss are painted steel, the skin is primed sheet, the floor is plate, the
// pad and seat are vinyl-covered foam and cloth, the levers and brackets are bare metal. Lamps, dial
// faces and the sight glass stay unregistered.
TEXTURE.set(T.cage, 'paint'); TEXTURE.set(T.cageDk, 'paint');
TEXTURE.set(T.skin, 'paint'); TEXTURE.set(T.skinDk, 'paint');
TEXTURE.set(T.floor, 'cast'); TEXTURE.set(T.stain, 'cast');
TEXTURE.set(T.pad, 'leather'); TEXTURE.set(T.panel, 'paint');
TEXTURE.set(T.seat, 'cast'); TEXTURE.set(T.cloth, 'fabric'); TEXTURE.set(T.strap, 'fabric');
TEXTURE.set(T.steel, 'brushed'); TEXTURE.set(T.dump, 'paint'); TEXTURE.set(T.valve, 'plastic');
