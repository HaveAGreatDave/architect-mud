// THE MULE'S FLIGHT DECK: a DHC-6 Twin Otter, side by side, the pilot in the left seat.
//
// The Mule is a freighter that lands on gravel, and its cockpit is a working room: grey lining, a
// black glareshield, olive webbing, worn tan seats, and a wall of round dials. Four things make it
// a Twin Otter and not a big Cessna, and every one of them is modelled:
//   · the power, prop and fuel levers HANG FROM THE ROOF on a console between the pilots, with the
//     flap lever and the elevator trim wheel up there beside them — the Otter runs its engine
//     cables the short way, up to the wing, so the quadrant is overhead;
//   · the engine instruments are a centre column of PAIRS, left engine and right: torque, prop
//     rpm, T5, Ng and fuel flow, with the oil gauges under them;
//   · the control wheels are on columns that come up out of the FLOOR, not out of the panel;
//   · the windscreen is a two-pane V with a centre post, wrapped round the corners into side panes,
//     and behind it each pilot has a crew door with a big window in it.
// Behind you it is a freighter: a bulkhead with an opening cut in it, a cargo net across the
// opening, and crates strapped down in the cabin.
//
// Sources read for this (layout, dimensions, the overhead quadrant):
//   https://en.wikipedia.org/wiki/De_Havilland_Canada_DHC-6_Twin_Otter  (15.77 m long, crew 1-2)
//   https://www.airliners.net/forum/viewtopic.php?t=728043  ("DHC-6 Twin Otter 'Overhead' Throttles?";
//     search summary: power, prop and fuel levers and the flaps are overhead, cables run short to the wing)
//   https://dehavilland.com/wp-content/uploads/2025/03/DHC_Twin_Otter_300-G_WHEELS_Spec_Sheet_v1_DIGITAL.pdf
//     (cabin 1.50 m high, 1.75 m wide, via search summary)
//   https://manuals.aerosoft.com/files/Manual_Aerosoft-Aircraft-Twin-Otter_MSFS_eng.pdf  (fetched; the
//     PDF did not parse to text here, so nothing below leans on it for a number)
//
// ── ⚠ THE ROOM IS THE EXTERIOR'S FUSELAGE, NEVER A SECOND DESCRIPTION OF IT ──
//
// `buildFixedWing` (aircraft3d.js) lofts the Mule's hull as a 12-gon ring per station, super-
// ellipsed toward a box by `boxy`, the roof brought down hard ahead of `bodyTube` by `noseVTaper`,
// and the flight-deck glass is simply the listed upper facets between `glaze.f0` and `glaze.f1`
// (the whole upper half ahead of `wsF`, the side band k0/k5 behind it). This file reads the SAME
// row (`FW_ROWS.prop`) through the same ring formula, walks the exterior's OWN station list, and
// cuts the windows by the exterior's own glazing rule. Edit the row and the room follows. The gate
// (scripts/shapes/cockpit-mule.mjs) builds the real exterior mesh and holds the holes against it.
//
// ⚠ ONE SCALE: metres per model unit = 15.77 m (Series 300 length) / (noseF − tailF). The row is
// 1.92 units long, so 8.21 m a unit. That makes the exterior's cabin 2.1 m wide and 2.2 m tall
// outside, where the real one is 1.75 × 1.50 inside: the stylised hull is fat for its length, and
// the room is honest to the HULL rather than to the brochure. Seats, wheels, dials and levers are
// a PERSON and are authored in honest metres.
//
// ⚠ THE EXTERIOR IS A 12-GON AND THE ROOM IS TOO. The side glass is facet k0/k5, which runs from
// the section's middle up to 30° round the ring, so the window top sits only a hand above the eye.
// That is what the hull says; a taller window here would be a hole in solid skin outside.
//
// Frame: metres, the eye at the origin, +x right, +y forward, +z up. The centreline is `xCentre`
// to the right of the eye; the co-pilot sits at 2·xCentre.
import { makeKit, C, clamp, pedal, SHINY, PANE, TEXTURE } from './interior-kit.js';
import { contactShadow, facingPanel, hotspotHalo } from './interior-cockpit-kit.js';
import { FW_ROWS } from './vehicle-models.js';

const TAU = Math.PI * 2;
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp = (a, b, t) => a + (b - a) * t;

// ── THE ONE SCALE AND THE EYE ────────────────────────────────────────────────
export const MULE_REAL_LENGTH_M = 15.77;
// Where the pilot's eye is, in exterior units: station f (fore), g (right +), h (up). Beside the
// crew-door window (f 0.48–0.62), 0.45 m left of the centreline, high enough that the straight-
// ahead line leaves through the windscreen before the roof comes down over the nose.
export const MULE_EYE = [0.55, -0.055, 0.08];

// ── THE STYLE ────────────────────────────────────────────────────────────────
// A working freighter, and the Otter's own: grey lining, a black crackle glareshield, tan seats.
const T = {
  lining: [96, 98, 96], headliner: [168, 166, 158], noseTop: [206, 208, 210], liningDk: [78, 80, 80], rib: [66, 68, 70], floor: [44, 46, 44], mat: [30, 31, 30],
  panel: [56, 60, 64], panelDk: [38, 41, 44], shield: [20, 21, 23], stack: [22, 23, 26],
  bezel: [116, 120, 126], placard: [214, 212, 204], column: [66, 68, 72], yoke: [28, 28, 31],
  quad: [40, 42, 46], quadDk: [30, 32, 35], webbing: [118, 104, 58], seat: [138, 108, 74], seatDk: [112, 86, 58],
  harness: [58, 66, 48], buckle: [178, 182, 188], cargo: [124, 96, 60], cargoDk: [96, 72, 44], strap: [196, 150, 40],
  cowl: [74, 76, 78], cowlDk: [66, 68, 70], frame: [70, 72, 74], seal: [26, 26, 28], nose: [18, 18, 20], bulk: [84, 86, 86], dark: [20, 20, 22],
  lcd: [110, 236, 150], lcdBg: [10, 22, 16], amber: [255, 176, 64], red: [236, 60, 48], post: [255, 150, 110],
  knobPwr: [22, 22, 24], knobProp: [40, 80, 170], knobFuel: [190, 40, 34], knobFlap: [220, 218, 210],
};
SHINY.set(T.buckle, { spec: 0.8, pow: 24 });
// Surface texture, by colour identity. Lamps, dial faces, screens and glass are left out on purpose.
for (const [k, tex] of Object.entries({
  lining: 'fabric', liningDk: 'fabric', headliner: 'plastic', noseTop: 'paint', rib: 'paint', floor: 'cast', mat: 'rubber', panel: 'paint', panelDk: 'paint',
  shield: 'fabric', stack: 'plastic', column: 'paint', yoke: 'plastic', quad: 'paint', quadDk: 'paint',
  webbing: 'fabric', seat: 'fabric', seatDk: 'fabric', harness: 'fabric', buckle: 'brushed', cargo: 'wood',
  cargoDk: 'wood', strap: 'fabric', cowl: 'paint', cowlDk: 'paint', frame: 'paint', seal: 'rubber',
  nose: 'paint', bulk: 'paint', placard: 'paint', bezel: 'cast',
})) TEXTURE.set(T[k], tex);
TEXTURE.set(C.chrome, 'brushed'); TEXTURE.set(C.steel, 'brushed'); TEXTURE.set(C.grip, 'rubber');
SHINY.set(T.shield, { spec: 0.12, pow: 8 });
SHINY.set(C.chrome, { spec: 0.8, pow: 22, ramp: [[60, 64, 70], [232, 236, 240]], glint: 0.3, albedo: [236, 238, 242], envK: 0.85 });
// The glass over a dial catches a crescent of window light.
const DIAL_GLINT = [255, 252, 245];
PANE.set(DIAL_GLINT, 0.18);

// ── THE EXTERIOR'S RING, AS buildFixedWing LOFTS IT ─────────────────────────
//
// ⚠ THE SAME FORMULA, OFF THE SAME ROW, at detail 1 with `sides` 12. The gate builds the actual
// exterior mesh and compares, so a change to the builder that this misses is a red gate, not a
// room quietly out of step with its hull.
function hullOf(p) {
  const sides = p.sides || 12, tube = p.bodyTube || 0, noseK = p.noseBlunt || 2.4, cowl = p.noseCowl || 0;
  const se = 1 - (p.boxy || 0) * 0.55;
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
  const vFloor = p.noseVFloor || 0;
  const radVAt = (f) => {
    const rH = radAt(f);
    if (!(p.noseVTaper && f > 0)) return rH;
    const u = Math.min(1, f / p.noseF), t = u <= tube ? 0 : (u - tube) / (1 - tube);
    return rH * (vFloor + (1 - vFloor) * Math.pow(1 - t, p.noseVTaper));
  };
  // [g, h] round the ring, k 0 at the starboard mid-side, counter-clockwise over the crown.
  const ring = (f) => {
    const rW = radAt(f), rH = radVAt(f), cz = czAt(f), out = [];
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * TAU, ca = Math.cos(a), sa = Math.sin(a);
      out.push([Math.sign(ca) * Math.pow(Math.abs(ca), se) * p.fr * rW, cz + Math.sign(sa) * Math.pow(Math.abs(sa), se) * p.fv * rH]);
    }
    return out;
  };
  // The exterior's own station list (detail 1), which is where its glass starts and stops.
  let st = [p.noseF, p.noseF * 0.66, p.noseF * 0.33, 0, p.tailF * 0.35, p.tailF * 0.7, p.tailF];
  if (p.extraF) {
    const keep = st.filter((f) => f === p.noseF || f === p.tailF || !p.extraF.some((e) => Math.abs(e - f) < 0.03));
    st = [...keep, ...p.extraF].sort((a, b) => b - a);
  }
  const GZ = p.glaze;
  // Is facet k glazed in the exterior bay that contains station fm?
  const glazed = (fm, k) => {
    if (!GZ) return false;
    for (let i = 0; i < st.length - 1; i++) {
      const fA = st[i], fB = st[i + 1];
      if (fm > fA || fm < fB) continue;
      if (!(fB > GZ.f1 - 1e-6 && fA < GZ.f0 + 1e-6)) return false;
      const ks = GZ.wsKs && fA >= GZ.wsF - 1e-6 ? GZ.wsKs : GZ.ks;
      return ks.includes(k);
    }
    return false;
  };
  return { sides, ring, czAt, stations: st, glazed, GZ };
}

// The ring pulled in by `w` units: each vertex along its two edges' mean outward normal.
function insetRing(R, w) {
  const n = R.length, out = [];
  const en = (i) => { const a = R[i], b = R[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [dy / l, -dx / l]; };
  for (let i = 0; i < n; i++) {
    const n1 = en((i - 1 + n) % n), n2 = en(i), d = 1 + n1[0] * n2[0] + n1[1] * n2[1];
    out.push([R[i][0] - w * (n1[0] + n2[0]) / d, R[i][1] - w * (n1[1] + n2[1]) / d]);
  }
  return out;
}

// Keep the part of a convex polygon where s(q) ≥ 0.
function clipHalf(poly, s) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], sa = s(a), sb = s(b);
    if (sa >= 0) out.push(a);
    if ((sa >= 0) !== (sb >= 0)) { const t = sa / (sa - sb); out.push(add(a, mul(sub(b, a), t))); }
  }
  return out;
}

// ── THE PROFILE ──────────────────────────────────────────────────────────────
let PROFILE = null;
export function muleProfile(row = FW_ROWS.prop) {
  if (row === FW_ROWS.prop && PROFILE) return PROFILE;
  const p = row, Hl = hullOf(p);
  const m = MULE_REAL_LENGTH_M / (p.noseF - p.tailF);
  const [fE, gE, hE] = MULE_EYE;
  const X = (g) => (g - gE) * m, Y = (f) => (f - fE) * m, Z = (h) => (h - hE) * m;
  const toS = (f, gh) => [X(gh[0]), Y(f), Z(gh[1])];
  const WALL = 0.06 / m;
  const zF = -1.15;                                             // the cockpit floor, a person below the eye
  const room = buildRoom({ Hl, m, X, Y, Z, toS, WALL, zF, p });

  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const f of room.faces) for (const q of f.p) {
    x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]);
    y1 = Math.max(y1, q[1]); z0 = Math.min(z0, q[2]); z1 = Math.max(z1, q[2]);
  }
  const xCentre = X(0), halfW = Math.max(xCentre - x0, x1 - xCentre) + 1e-6;
  // The crew-door window, off the exterior: the bay 0.48–0.62 and the k0/k5 band (h 0 → vertex 1).
  const r55 = Hl.ring(0.55);
  const winY = [Y(0.48) + 0.02, Y(0.62) - 0.02], winZ = [Z(r55[0][1]), Z(r55[1][1])];

  // THE GLASS: one pane per exterior glass facet, on the facet itself, 3 mm in from the skin. Drawn
  // by the renderer as film, never part of shellFaces, so every sight line stays an open hole.
  const glass = room.holes.map((h) => {
    const q = h.outer;
    let n = norm(cross(sub(q[1], q[0]), sub(q[3], q[0])));
    if (dot(n, h.centre) > 0) n = mul(n, -1);            // toward the inside
    return q.map((v) => add(v, mul(n, 0.003)));
  });

  const P = {
    label: 'Twin Otter flight deck',
    glass,
    xCentre, halfW,
    floor: z0 - 1e-6, roof: z1 + 1e-6, front: y1 + 1e-6, back: y0 - 1e-6,
    winY, winZ,
    // ── measured off the hull ──
    headerZ: Z(Hl.ring(p.glaze.wsF)[3][1]) - 0.06,
    // ── a person, in metres ──
    dashY: 0.66, dashZ: -0.13, pillarW: 0.05, centrePost: 0.025,
    seatZ: -0.76, seatHalf: 0.24, seatY: [-0.40, 0.08], backZ: 0.14, seats: 2,
    fit: 'mule', craft: 'mule', normalLit: true,
    // Panel floods under the glareshield lip and one over the quadrant.
    floods: [{ p: [0.0, 0.60, -0.30], r: 0.42 }, { p: [xCentre, 0.60, -0.30], r: 0.40 },
      { p: [2 * xCentre, 0.60, -0.30], r: 0.42 }, { p: [xCentre, 0.25, 0.22], r: 0.30 }],
    room: muleShell,
    mule: { m, X, Y, Z, toS, Hl, zF, WALL, eye: MULE_EYE, faces: room.faces, glassHoles: room.holes, statics: null },
    hotspots(live) { return muleHotspots(this, live); },
  };
  if (row === FW_ROWS.prop) PROFILE = P;
  return P;
}

// ── THE ROOM ─────────────────────────────────────────────────────────────────
// Built once: the lining lofted on the exterior's stations, the glass as holes with a reveal out to
// the skin, the frame posts, the floor, the bulkhead and the cabin behind it.
function buildRoom({ Hl, m, X, Y, Z, toS, WALL, zF, p }) {
  const faces = [], holes = [];
  const put = (pp, n, tone, k, rgb, emis) => faces.push({ p: pp, n, tone, k, rgb, emis: emis || 0 });
  const GZ = Hl.GZ, NS = Hl.sides;
  // Stations: the exterior's own through the cockpit, plus the bulkhead and a slice of cabin aft.
  const F_BACK = 0.12, F_BULK = 0.30, F_FRONT = 0.84;
  const ST = [...new Set([F_BACK, 0.24, F_BULK, ...Hl.stations.filter((f) => f > F_BULK && f <= F_FRONT)])].sort((a, b) => a - b);
  const outer = new Map(), inner = new Map();
  for (const f of ST) { const R = Hl.ring(f); outer.set(f, R); inner.set(f, insetRing(R, WALL)); }
  const O = (f, k) => toS(f, outer.get(f)[((k % NS) + NS) % NS]);
  const I = (f, k) => toS(f, inner.get(f)[((k % NS) + NS) % NS]);
  const above = (poly) => clipHalf(poly, (q) => q[2] - zF);
  const centreOf = (f) => toS(f, [0, Hl.czAt(f)]);
  const glz = (fa, fb, k) => fa >= F_BULK - 1e-9 && Hl.glazed((fa + fb) / 2, ((k % NS) + NS) % NS);
  const wsBay = (fb) => fb >= GZ.wsF - 1e-6;
  const posts = [], postKeys = new Set();

  for (let i = 0; i < ST.length - 1; i++) {
    const fa = ST[i], fb = ST[i + 1], c = centreOf((fa + fb) / 2);
    for (let k = 0; k < NS; k++) {
      if (glz(fa, fb, k)) {
        // ── A PANE: a hole, a reveal out to the skin on every edge that meets solid ──
        const oc = mul(add(add(O(fa, k), O(fa, k + 1)), add(O(fb, k), O(fb, k + 1))), 0.25);
        holes.push({ f: [fa, fb], k, outer: [O(fa, k), O(fa, k + 1), O(fb, k + 1), O(fb, k)], centre: oc });
        const edges = [
          [[fa, k], [fa, k + 1], glz(ST[i - 1] ?? -9, fa, k), fa < GZ.wsF && glz(ST[i - 1] ?? -9, fa, k)],
          [[fb, k], [fb, k + 1], ST[i + 2] != null && glz(fb, ST[i + 2], k), fb < GZ.wsF && ST[i + 2] != null && glz(fb, ST[i + 2], k)],
          [[fa, k], [fb, k], glz(fa, fb, k - 1), wsBay(fb) && [1, 3, 5].includes(((k % NS) + NS) % NS)],
          [[fa, k + 1], [fb, k + 1], glz(fa, fb, k + 1), wsBay(fb) && [1, 3, 5].includes((k + 1) % NS)],
        ];
        for (const [[f0, k0], [f1, k1], nbGlass, post] of edges) {
          const i0 = I(f0, k0), i1 = I(f1, k1), o0 = O(f0, k0), o1 = O(f1, k1);
          if (!nbGlass) {
            const mid = mul(add(i0, i1), 0.5);
            let rn = norm(cross(sub(i1, i0), sub(o0, i0)));
            if (dot(rn, sub(oc, mid)) < 0) rn = mul(rn, -1);
            put([i0, i1, o1, o0], rn, 'pil', 0.15, T.frame);
            continue;
          }
          // Between two panes: a frame post, once, at mid-thickness of the skin.
          const key = [f0, ((k0 % NS) + NS) % NS, f1, ((k1 % NS) + NS) % NS].join(':');
          if (post && !postKeys.has(key)) { postKeys.add(key); posts.push([mul(add(i0, o0), 0.5), mul(add(i1, o1), 0.5)]); }
        }
        continue;
      }
      // ── A PANEL OF LINING ──
      const q = [I(fa, k), I(fa, k + 1), I(fb, k + 1), I(fb, k)];
      let n = norm(cross(sub(q[1], q[0]), sub(q[3], q[0])));
      const qc = mul(add(add(q[0], q[1]), add(q[2], q[3])), 0.25);
      if (dot(n, sub(c, qc)) < 0) n = mul(n, -1);
      const poly = above(q);
      if (poly.length < 3) continue;
      // The nose ahead of the windscreen is painted anti-glare black, seen over the glareshield.
      const nose = fa >= 0.70 - 1e-9;
      const low = (k >= 6 && k <= 11);
      const kk = ((k % NS) + NS) % NS, stripe = kk === 3 || kk === 2;
      put(poly, n, 'pil', nose ? 0.1 : (low ? -0.12 : 0.05), nose ? (stripe ? T.nose : T.noseTop) : (low ? ((i + k) & 1 ? T.lining : T.liningDk) : T.headliner));
    }
  }
  // The posts, turned into faces by the kit.
  const K = makeKit((fs, tone, k, fwd, rgb, emis) => { for (const f of fs) faces.push({ p: f.p, n: f.n, tone, k, rgb, emis: emis || 0 }); }, false);
  for (const [a, b] of posts) K.rod(a, b, 0.024, 'pil', 0.2, T.frame, 0, 6);

  // ── RIBS: the fuselage frames, exposed aft of the cockpit, over the lining ──
  const ribAt = (f) => {
    const R = insetRing(outer.get(f) || Hl.ring(f), WALL + 0.02 / m);
    for (let k = 0; k < NS; k++) {
      const a = toS(f, R[k]), b = toS(f, R[(k + 1) % NS]);
      if (a[2] < zF + 0.02 && b[2] < zF + 0.02) continue;
      const seg = clipHalf([a, b, b], (q) => q[2] - (zF + 0.02));
      if (seg.length >= 2) K.rod(seg[0], seg[1], 0.022, 'pil', 0.05, T.rib, 0, 4, false);
    }
  };
  ribAt(0.24);

  // ── THE FLOOR: ribbed rubber over plate, run under the walls ──
  const floorX = (f) => {
    const R = insetRing(outer.get(f), WALL), h = zF / m + MULE_EYE[2];
    const xs = [];
    for (let k = 0; k < NS; k++) {
      const a = R[k], b = R[(k + 1) % NS];
      if ((a[1] - h) * (b[1] - h) <= 0 && a[1] !== b[1]) xs.push(a[0] + (b[0] - a[0]) * (h - a[1]) / (b[1] - a[1]));
    }
    if (xs.length < 2) return null;
    return [X(Math.min(...xs)), X(Math.max(...xs))];
  };
  for (let i = 0; i < ST.length - 1; i++) {
    const fa = ST[i], fb = ST[i + 1], A = floorX(fa), B = floorX(fb);
    if (!A && !B) continue;
    const xc = X(0), a = A || [xc, xc], b = B || [xc, xc];
    put([[a[0], Y(fa), zF], [a[1], Y(fa), zF], [b[1], Y(fb), zF], [b[0], Y(fb), zF]], [0, 0, 1], 'floor', -0.2, T.floor);
  }
  // The rubber mats in the two footwells, ribbed across.
  for (const cx of [0, 2 * X(0)]) {
    for (let r = 0; r < 9; r++) {
      const y = 0.12 + r * 0.10;
      K.box(cx - 0.24, y, zF, cx + 0.24, y + 0.06, zF + 0.012, 'floor', -0.1, T.mat);
    }
  }

  // ── THE BULKHEAD at the cockpit's back, with the opening into the cabin cut in it ──
  const capAt = (f) => above(inner.get(f).map((gh) => toS(f, gh)));
  const xc = X(0), dx0 = xc - 0.32, dx1 = xc + 0.32, dTop = 0.18, yb = Y(F_BULK);
  const cap = capAt(F_BULK);
  const piece = (poly, rgb, k) => { if (poly.length >= 3) put(poly, [0, 1, 0], 'post', k, rgb); };
  piece(clipHalf(cap, (q) => dx0 - q[0]), T.bulk, -0.1);
  piece(clipHalf(cap, (q) => q[0] - dx1), T.bulk, -0.1);
  piece(clipHalf(clipHalf(clipHalf(cap, (q) => q[0] - dx0), (q) => dx1 - q[0]), (q) => q[2] - dTop), T.bulk, -0.1);
  // The door frame, as solids, so the opening has depth.
  K.box(dx0 - 0.03, yb - 0.02, zF, dx0, yb + 0.04, dTop, 'post', 0.1, T.frame);
  K.box(dx1, yb - 0.02, zF, dx1 + 0.03, yb + 0.04, dTop, 'post', 0.1, T.frame);
  K.box(dx0 - 0.03, yb - 0.02, dTop - 0.03, dx1 + 0.03, yb + 0.04, dTop, 'post', 0.1, T.frame);
  // The cargo net across it, olive webbing on a grid, hooked at the corners.
  const ny = yb + 0.05;
  for (let i = 0; i <= 6; i++) { const x = lerp(dx0 + 0.02, dx1 - 0.02, i / 6); K.rod([x, ny, zF + 0.03], [x, ny, dTop - 0.04], 0.007, 'post', 0.05, T.webbing, 0, 4); }
  for (let j = 0; j <= 7; j++) { const z = lerp(zF + 0.05, dTop - 0.05, j / 7); K.rod([dx0 + 0.02, ny, z], [dx1 - 0.02, ny, z], 0.007, 'post', 0.05, T.webbing, 0, 4); }
  // The cabin's far end, dim.
  const back = capAt(F_BACK);
  if (back.length >= 3) put(back, [0, 1, 0], 'post', -0.4, T.dark);
  // The front: the nose's inside end, under the glareshield.
  const front = capAt(F_FRONT);
  if (front.length >= 3) put(front, [0, -1, 0], 'post', -0.3, T.nose);

  // ── THE CABIN: freight strapped to the floor aft of the net ──
  const yc0 = Y(F_BACK) + 0.15;
  const crate = (x0c, y0c, w, d, h, rgb) => {
    K.box(x0c, y0c, zF, x0c + w, y0c + d, zF + h, 'post', -0.05, rgb);
    K.box(x0c - 0.005, y0c + d * 0.3, zF, x0c + w + 0.005, y0c + d * 0.3 + 0.05, zF + h + 0.005, 'post', 0.1, T.strap);
  };
  crate(xc - 0.75, yc0, 0.55, 0.55, 0.60, T.cargo);
  crate(xc - 0.70, yc0 + 0.60, 0.45, 0.40, 0.42, T.cargoDk);
  crate(xc + 0.05, yc0 + 0.05, 0.60, 0.70, 0.75, T.cargoDk);
  crate(xc + 0.10, yc0 + 0.05, 0.40, 0.40, 1.05, T.cargo);
  // The seat tracks down the cabin floor, and tie-down rings along them.
  for (const dx of [-0.55, 0.55]) {
    K.box(xc + dx - 0.02, Y(F_BACK) + 0.05, zF, xc + dx + 0.02, Y(F_BULK) - 0.02, zF + 0.015, 'floor', 0.2, C.steel);
    for (let j = 0; j < 4; j++) {
      const y = lerp(Y(F_BACK) + 0.2, Y(F_BULK) - 0.2, j / 3);
      K.torus([xc + dx, y, zF + 0.04], [0, 1, 0], [0, 0, 1], 0.03, 0.005, 12, 'floor', 0.3, C.chrome, 0.05, Math.PI * 0.05, Math.PI * 0.95);
    }
  }
  // The load straps over the crates, ratchet to ring.
  K.rod([xc - 0.78, yc0 + 0.35, zF + 0.04], [xc - 0.75, yc0 + 0.35, zF + 0.60], 0.012, 'post', 0.1, T.strap, 0, 4);
  K.rod([xc - 0.75, yc0 + 0.35, zF + 0.60], [xc - 0.20, yc0 + 0.35, zF + 0.60], 0.012, 'post', 0.1, T.strap, 0, 4);
  K.rod([xc + 0.68, yc0 + 0.45, zF + 0.04], [xc + 0.65, yc0 + 0.45, zF + 0.75], 0.012, 'post', 0.1, T.strap, 0, 4);

  // ── THE STRINGERS down the cabin walls, over the lining ──
  const wallAt = (f, kf, inward) => {
    const R = insetRing(Hl.ring(f), WALL + inward / m), k0 = Math.floor(kf), t = kf - k0;
    const a = R[((k0 % NS) + NS) % NS], b = R[((k0 + 1) % NS + NS) % NS];
    return toS(f, [lerp(a[0], b[0], t), lerp(a[1], b[1], t)]);
  };
  for (const kf of [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 10.5, 11.5]) {
    const a = wallAt(F_BACK + 0.005, kf, 0.018), b = wallAt(F_BULK - 0.005, kf, 0.018);
    if (a[2] > zF + 0.03) K.rod(a, b, 0.014, 'pil', 0.05, T.rib, 0, 4, false);
  }
  // ── THE COCKPIT SIDEWALL PADS, below each door window: quilted vinyl in rolls ──
  for (const side of [6.3, 12 - 0.3 - 2.4]) for (let r = 0; r < 5; r++) {
    const kf = side + r * 0.48;
    for (let s = 0; s < 4; s++) {
      const f0 = lerp(0.35, 0.47, s / 4), f1 = lerp(0.35, 0.47, (s + 1) / 4) - 0.004;
      const pts = [wallAt(f0, kf, 0.012), wallAt(f1, kf, 0.012), wallAt(f1, kf + 0.44, 0.012), wallAt(f0, kf + 0.44, 0.012)];
      if (pts.some((q) => q[2] < zF + 0.02)) continue;
      let n = norm(cross(sub(pts[1], pts[0]), sub(pts[3], pts[0])));
      const cc = centreOf((f0 + f1) / 2), pc = mul(add(add(pts[0], pts[1]), add(pts[2], pts[3])), 0.25);
      if (dot(n, sub(cc, pc)) < 0) n = mul(n, -1);
      put(pts, n, 'pil', (r + s) & 1 ? 0.02 : -0.08, (r + s) & 1 ? T.liningDk : T.lining);
    }
  }

  // ── THE CREW DOORS: each pilot's door is the bay the door window is in ──
  const wallPt = (f, kf, inward = 0.012) => {
    const R = insetRing(Hl.ring(f), WALL + inward / m), k0 = Math.floor(kf), t = kf - k0;
    const a = R[((k0 % NS) + NS) % NS], b = R[((k0 + 1) % NS + NS) % NS];
    return toS(f, [lerp(a[0], b[0], t), lerp(a[1], b[1], t)]);
  };
  for (const [kTop, kBot, sgn] of [[6, 8.6, -1], [0, -2.6, 1]]) {
    // The seal round the door below the window: the two edges and the bottom.
    const ks = [], NK = 5;
    for (let j = 0; j <= NK; j++) ks.push(lerp(kTop, kBot, j / NK));
    const kk = (x) => (sgn < 0 ? x : x + NS);
    for (const f of [0.483, 0.617]) for (let j = 0; j < NK; j++) {
      const a = wallPt(f, kk(ks[j])), b = wallPt(f, kk(ks[j + 1]));
      if (a[2] > zF + 0.02 && b[2] > zF + 0.02) K.rod(a, b, 0.010, 'pil', 0.0, T.seal, 0, 4, false);
    }
    const bot = [wallPt(0.483, kk(kBot)), wallPt(0.617, kk(kBot))];
    if (bot[0][2] > zF + 0.02) K.rod(bot[0], bot[1], 0.010, 'pil', 0.0, T.seal, 0, 4, false);
    // The handle: a lever on a boss, forward on the door card, and an arm-rest pad.
    const hb = wallPt(0.60, kk(kTop + (kBot - kTop) * 0.22), 0.02), ht = add(hb, [0, -0.13, 0.01]);
    K.rod(hb, add(hb, [-sgn * 0.02, 0, 0]), 0.018, 'pil', 0.2, C.chrome, 0.05, 8);
    K.rod(add(hb, [-sgn * 0.03, 0, 0]), add(ht, [-sgn * 0.03, 0, 0]), 0.009, 'pil', 0.3, C.chrome, 0.05, 6);
    const ar = wallPt(0.53, kk(kTop + (kBot - kTop) * 0.3), 0.03);
    K.box(ar[0] - 0.03, ar[1] - 0.18, ar[2] - 0.03, ar[0] + 0.03, ar[1] + 0.12, ar[2], 'pil', 0.1, T.seatDk);
  }
  return { faces, holes };
}

// ── THE SHELL, AS interior-shell.js CALLS IT ─────────────────────────────────
function muleShell(P, live, push, rich) {
  const D = P.mule;
  for (const f of D.faces) push([{ p: f.p, n: f.n }], f.tone, f.k, false, f.rgb, f.emis || 0);
  if (!D.statics) {
    const S = [];
    muleStatic(P, (fs, tone, k, fwd, rgb, emis) => { for (const f of fs) S.push({ p: f.p, n: f.n, tone, k, fwd, rgb, emis }); });
    D.statics = S;
  }
  for (const f of D.statics) push([{ p: f.p, n: f.n }], f.tone, f.k, f.fwd, f.rgb, f.emis || 0);
  if (rich) muleFit(P, live, push);
}

// ── WHERE THINGS ARE ─────────────────────────────────────────────────────────
// One table, read by the geometry and the hotspots, so a click lands on the thing it names.
function layout(P) {
  const xC = P.xCentre, y = P.dashY, top = P.dashZ - 0.02;
  const roofIn = P.mule.Z(P.mule.Hl.ring(0.55)[3][1] - P.mule.WALL);
  return {
    xC, y, top, roofIn,
    six: { z: [top - 0.075, top - 0.175], dx: 0.098, R: 0.037 },
    eng: { x: [xC - 0.040, xC + 0.040], z: [top - 0.055, top - 0.117, top - 0.179, top - 0.241, top - 0.303], R: 0.026 },
    fuelG: { x: [xC - 0.21, xC - 0.14], z: top - 0.075, R: 0.027 },
    sw: { z: top - 0.36, x: [-0.29, -0.25, -0.21, -0.17, -0.13, -0.09, -0.05] },   // bat, gen L, gen R, beacon, land, taxi, nav
    radio: { x: xC, w: 0.15, z0: top - 0.50, z1: top - 0.36 },
    col: (x) => ({ pivot: [x, 0.62, P.mule.zF + 0.05] }),
    con: { x0: xC - 0.13, x1: xC + 0.13, y0: -0.36, y1: 0.55, zb: roofIn - 0.12, zt: roofIn - 0.012 },
    quad: { y: 0.34, xs: [-0.090, -0.064, -0.024, 0.002, 0.042, 0.068] },
    flap: { x: xC + 0.106, y0: 0.02, y1: 0.20 },
    trim: { c: [xC - 0.138, 0.06, roofIn - 0.10], r: 0.072 },
    rtrim: [xC + 0.05, -0.02, roofIn - 0.125],
    dome: [xC, -0.46, roofIn - 0.01],
  };
}
const SW_IDS = ['battery', 'genL', 'genR', 'beacon', 'land', 'taxi', 'nav'];

export function muleHotspots(P, live) {
  const Y = layout(P), L = live || {}, Kd = makeKit(() => {});
  const Pn = Kd.panel([0, Y.y, 0], [1, 0, 0], [0, 0, 1]);
  const at = (x, z) => Pn.pt(x, z, 0.01);
  const out = SW_IDS.map((id, i) => ({ id: 'ck:' + id, p: at(Y.sw.x[i], Y.sw.z), r: 0.016, kind: 'click' }));
  const thr = clamp(num(L.throttle), 0, 1);
  out.push({ id: 'throttle', p: leverKnob(Y, Y.quad.xs[0] + 0.013, thr), r: 0.05, kind: 'throttle' });
  out.push({ id: 'ck:flaps', p: [Y.flap.x, lerp(Y.flap.y0, Y.flap.y1, clamp(num(L.flapNotch), 0, 3) / 3), Y.con.zb - 0.06], r: 0.025, kind: 'click' });
  out.push({ id: 'trim', p: add(Y.trim.c, [0, 0, -Y.trim.r]), r: 0.05, kind: 'trim' });
  out.push({ id: 'ck:dome', p: Y.dome, r: 0.035, kind: 'click' });
  const yk = yokeFrame(Y, 0, clamp(num(L.stickY), -1, 1));
  out.push({ id: 'yoke', p: yk.hub, r: 0.12, kind: 'yoke' });
  return out;
}

// A lever on the overhead quadrant: pivoting in its slot on the console's underside, forward is
// more. The knob hangs 0.13 m below the slot and swings ±28°.
function leverKnob(Y, x, v) {
  const th = (clamp(v, 0, 1) - 0.5) * 0.98;
  return [Y.xC + x, Y.quad.y + Math.sin(th) * 0.13, Y.con.zb - Math.cos(th) * 0.13];
}
// The control column: pivoted at the floor ahead of the seat, leaning back to the wheel. Pulling
// (stickY +) brings the wheel toward you.
function yokeFrame(Y, x, elev) {
  const piv = Y.col(x).pivot, th = 0.30 + clamp(elev, -1, 1) * 0.16, len = 0.80;
  const hub = add(piv, [0, -Math.sin(th) * len, Math.cos(th) * len]);
  return { piv, hub, axis: norm(sub(hub, piv)) };
}

// ── WHAT DOES NOT MOVE ───────────────────────────────────────────────────────
// Built once and kept: the panel slab and glareshield, the console, the stack bezels, the seats.
function muleStatic(P, push) {
  const K = makeKit(push), Y = layout(P), D = P.mule, xC = Y.xC;
  const Hl = D.Hl;
  // The inner ring at a station, in shell metres.
  const secAt = (f) => insetRing(Hl.ring(f), D.WALL + 0.004 / D.m).map((gh) => D.toS(f, gh));
  const fPanel = MULE_EYE[0] + P.dashY / D.m;
  // ── THE PANEL: the fuselage section at the panel station, from the knee to the glareshield ──
  const sec = secAt(fPanel).map((q) => [q[0], P.dashY, q[2]]);
  const slab = clipHalf(clipHalf(sec, (q) => P.dashZ - q[2]), (q) => q[2] - (P.dashZ - 0.56));
  if (slab.length >= 3) push([{ p: slab, n: [0, -1, 0] }], 'dash', 0.1, true, T.panel, 0);
  // Its lower edge, a rolled lip.
  const xs = slab.map((q) => q[0]), sxL = Math.min(...xs) + 0.02, sxR = Math.max(...xs) - 0.02;
  K.box(sxL, P.dashY - 0.03, P.dashZ - 0.58, sxR, P.dashY, P.dashZ - 0.55, 'dash', -0.1, T.panelDk);
  // ── THE GLARESHIELD: a hood over the panel, forward to the screen, crackle black ──
  // ⚠ SHALLOW, AND THE DECK AHEAD OF IT FALLS AWAY. The first cut ran the hood flat at dash height
  // all the way to the screen, 0.6 m of black that filled the middle of the forward view and hid
  // the panel. Now the hood is a 10 cm lip whose edge is 11° below the eye (atan 0.13/0.66), and
  // ahead of it a painted coaming slopes down to the screen's foot, the way the Otter's does.
  const hoodAt = (f, z = P.dashZ) => {
    const R = secAt(f), pts = [];
    for (let k = 0; k < R.length; k++) {
      const a = R[k], b = R[(k + 1) % R.length];
      if ((a[2] - z) * (b[2] - z) <= 0 && a[2] !== b[2]) pts.push(a[0] + (b[0] - a[0]) * (z - a[2]) / (b[2] - a[2]));
    }
    return pts.length >= 2 ? [Math.min(...pts), Math.max(...pts)] : null;
  };
  const w0 = hoodAt(fPanel);
  const yLip = P.dashY + 0.10, fLip = MULE_EYE[0] + yLip / D.m, wl = hoodAt(fLip);
  push([{ p: [[w0[0] + 0.01, P.dashY, P.dashZ], [w0[1] - 0.01, P.dashY, P.dashZ], [wl[1] - 0.01, yLip, P.dashZ], [wl[0] + 0.01, yLip, P.dashZ]], n: [0, 0, 1] }],
    'dash', 0.3, true, T.shield, 0);
  K.box(w0[0] + 0.02, P.dashY - 0.035, P.dashZ - 0.02, w0[1] - 0.02, P.dashY, P.dashZ, 'dash', 0.2, T.shield);
  // The coaming: from the lip down to the foot of the screen, split in rows so it reads as panels.
  const zFoot = -0.17, fFoot = 0.70, NR = 4;
  for (let i = 0; i < NR; i++) {
    const t0 = i / NR, t1 = (i + 1) / NR;
    const fa = lerp(fLip, fFoot, t0), fb = lerp(fLip, fFoot, t1), za = lerp(P.dashZ, zFoot, t0), zb = lerp(P.dashZ, zFoot, t1);
    const a = hoodAt(fa, za), b = hoodAt(fb, zb);
    if (!a || !b) continue;
    const pa = [[a[0] + 0.01, D.Y(fa), za], [a[1] - 0.01, D.Y(fa), za], [b[1] - 0.01, D.Y(fb), zb], [b[0] + 0.01, D.Y(fb), zb]];
    let n = norm(cross(sub(pa[1], pa[0]), sub(pa[3], pa[0]))); if (n[2] < 0) n = mul(n, -1);
    push([{ p: pa, n }], 'dash', 0.2, true, i & 1 ? T.cowl : T.cowlDk, 0);
  }
  // ── THE ANNUNCIATOR BOX under the lip, over the engine column ──
  K.box(xC - 0.13, P.dashY - 0.10, P.dashZ - 0.06, xC + 0.13, P.dashY - 0.06, P.dashZ - 0.035, 'dash', 0.1, T.stack);
  // ── THE RADIO STACK bezel, the breaker panel, the placards ──
  const Pn = K.panel([0, P.dashY, 0], [1, 0, 0], [0, 0, 1], 'dash', 0.2);
  const r = Y.radio;
  Pn.rect(r.x - r.w, r.z0, r.x + r.w, r.z1, T.stack, 0, 0.002);
  for (let row = 0; row < 3; row++) for (let i = 0; i < 12; i++) {
    Pn.disc(1.12 + i * 0.022, Y.top - 0.08 - row * 0.05, 0.006, [24, 24, 26], 0, 0.003, 6);
    Pn.disc(1.12 + i * 0.022, Y.top - 0.08 - row * 0.05, 0.0035, i % 5 === 3 ? T.amber : C.white, 0.05, 0.006, 6);
  }
  Pn.rect(1.10, Y.top - 0.24, 1.38, Y.top - 0.215, T.placard, 0.1, 0.002);
  for (const cx of [0, 2 * xC]) Pn.rect(cx - 0.05, Y.six.z[1] - 0.070, cx + 0.05, Y.six.z[1] - 0.055, T.placard, 0.1, 0.002);
  // A whiskey compass on the centre post, where the Otter's is.
  const wc = [xC, P.dashY + 0.28, P.headerZ - 0.02];
  K.box(wc[0] - 0.035, wc[1] - 0.03, wc[2] - 0.035, wc[0] + 0.035, wc[1] + 0.03, wc[2] + 0.02, 'dash', 0.1, [30, 30, 34]);
  K.rod([wc[0], wc[1] + 0.03, wc[2]], [wc[0], wc[1] + 0.12, wc[2] + 0.06], 0.008, 'dash', 0.1, [30, 30, 34], 0, 5);

  // ── THE OVERHEAD CONSOLE ─────────────────────────────────────────────────
  const c = Y.con;
  K.box(c.x0, c.y0, c.zb, c.x1, c.y1, c.zt, 'hdr', -0.15, T.quad);
  // The quadrant's face plate on the underside, with the six slots.
  const Qp = K.panel([xC, Y.quad.y, c.zb - 0.002], [1, 0, 0], [0, 1, 0], 'hdr', -0.1);
  Qp.rect(-0.115, -0.17, 0.115, 0.17, T.quadDk, 0, 0.001);
  for (const x of Y.quad.xs) Qp.rect(x + 0.013 - 0.004, -0.14, x + 0.013 + 0.004, 0.14, [8, 8, 9], 0, 0.002);
  // POWER · PROP · FUEL legends, one plate over each pair.
  for (const [x, rgb] of [[-0.077, T.placard], [-0.011, T.knobProp], [0.055, T.knobFuel]]) Qp.rect(x - 0.02, 0.145, x + 0.02 + 0.026, 0.16, rgb, 0.12, 0.002);
  // The flap slot and its detents, aft right.
  const Fp = K.panel([Y.flap.x, (Y.flap.y0 + Y.flap.y1) / 2, c.zb - 0.002], [1, 0, 0], [0, 1, 0], 'hdr', -0.1);
  Fp.rect(-0.006, -0.10, 0.006, 0.10, [8, 8, 9], 0, 0.002);
  for (let i = 0; i <= 3; i++) Fp.rect(0.009, -0.09 + i * 0.06 - 0.003, 0.02, -0.09 + i * 0.06 + 0.003, T.placard, 0.15, 0.002);
  // The elevator trim wheel's housing, on the console's left flank.
  const tc = Y.trim.c;
  K.box(tc[0] - 0.012, tc[1] - Y.trim.r - 0.02, c.zb - 0.01, tc[0] + 0.012, tc[1] + Y.trim.r + 0.02, c.zb + 0.02, 'hdr', 0, T.quadDk);
  // The dome lamp housing aft of the console.
  K.box(Y.dome[0] - 0.06, Y.dome[1] - 0.06, Y.dome[2] - 0.02, Y.dome[0] + 0.06, Y.dome[1] + 0.06, Y.dome[2], 'hdr', 0.1, [182, 178, 168]);

  // ── THE SUN VISORS, folded up under the header, one each side of the centre post ──
  for (const cx of [0, 2 * xC]) {
    const vy = D.Y(0.60), vz = P.headerZ + 0.02;
    K.rod([cx - 0.16, vy, vz + 0.02], [cx + 0.16, vy, vz + 0.02], 0.007, 'hdr', 0.2, C.chrome, 0.05, 5);
    K.obox([cx, vy - 0.07, vz + 0.02], [1, 0, 0], norm([0, -1, 0.15]), norm([0, 0.15, 1]), 0.15, 0.065, 0.006, 'hdr', -0.1, [52, 70, 60], 0);
  }
  // ── THE HEADSETS, hung on hooks on the bulkhead either side of the opening ──
  const yb = D.Y(0.30) + 0.02;
  for (const hx of [xC - 0.55, xC + 0.55]) {
    const hc = [hx, yb + 0.06, 0.02];
    K.rod([hx, yb, 0.12], [hx, yb + 0.05, 0.12], 0.006, 'post', 0.3, C.chrome, 0.05, 5);
    K.torus(hc, [1, 0, 0], [0, 0, 1], 0.085, 0.009, 14, 'post', 0.1, [30, 30, 32], 0, 0.1, Math.PI - 0.1);
    for (const s of [-1, 1]) {
      const cup = add(hc, [s * 0.085, 0, -0.02]);
      K.rod(add(cup, [-s * 0.01, 0, 0]), add(cup, [s * 0.03, 0, 0]), 0.045, 'post', 0.1, [34, 34, 36], 0, 12);
      K.rod(add(cup, [-s * 0.015, 0, 0]), add(cup, [-s * 0.01, 0, 0]), 0.038, 'post', 0.1, [16, 16, 18], 0, 12, false);
    }
    K.rod(add(hc, [-0.085, 0, -0.02]), [hx - 0.13, yb + 0.07, -0.08], 0.008, 'post', 0.2, [20, 20, 22], 0, 4);   // the boom mic
    K.rod([hx - 0.05, yb + 0.05, -0.06], [hx - 0.04, yb + 0.05, -0.55], 0.004, 'post', 0.1, [20, 20, 22], 0, 4);   // the cord
  }
  // ── THE FIRE EXTINGUISHER, strapped to the bulkhead low on the left ──
  const ex = [xC - 0.72, yb + 0.07, D.zF + 0.12];
  K.rod(ex, add(ex, [0, 0, 0.36]), 0.055, 'post', 0.35, [196, 34, 30], 0, 12);
  K.rod(add(ex, [0, 0, 0.36]), add(ex, [0, 0, 0.42]), 0.02, 'post', 0.3, C.chrome, 0.05, 8);
  K.rod(add(ex, [0, 0, 0.42]), add(ex, [0, 0.09, 0.40]), 0.008, 'post', 0.3, [20, 20, 22], 0, 5);
  for (const dz of [0.08, 0.28]) K.torus(add(ex, [0, 0, dz]), [1, 0, 0], [0, 1, 0], 0.058, 0.006, 12, 'post', 0.2, T.strap, 0);
  // ── A CHECKLIST on a clip, tucked in the left map pocket, and the pocket ──
  const mp = [-0.53, -0.05, -0.62];
  K.box(mp[0], mp[1] - 0.14, mp[2] - 0.12, mp[0] + 0.03, mp[1] + 0.14, mp[2] + 0.02, 'pil', 0.0, [36, 38, 36]);
  const Cl = K.panel([mp[0] + 0.045, mp[1], mp[2] + 0.02], [0, 1, 0], norm([0.2, 0, 1]), 'pil', 0.1);
  Cl.rect(-0.08, -0.11, 0.08, 0.11, C.wood, 0.02, 0.001);
  Cl.rect(-0.07, -0.10, 0.07, 0.08, C.paper, 0.08, 0.002);
  for (let i = 0; i < 8; i++) Cl.rect(-0.06, 0.06 - i * 0.019, 0.05 - (i % 3) * 0.02, 0.064 - i * 0.019, [70, 72, 80], 0, 0.003);
  Cl.rect(-0.02, 0.085, 0.02, 0.105, C.chrome, 0.1, 0.004);

  // ── THE SEATS: tan cloth on a frame, on rails, with a five-point harness ──
  for (const [cx, seed] of [[0, 0], [2 * xC, 1]]) muleSeat(K, cx, P, seed);
  // The seats' shadows on the floor, and the console's on the roof.
  contactShadow(K, [0, (P.seatY[0] + P.seatY[1]) / 2 - 0.05, D.zF], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.30, 0.34);
  contactShadow(K, [2 * xC, (P.seatY[0] + P.seatY[1]) / 2 - 0.05, D.zF], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.30, 0.34);
  contactShadow(K, [xC, P.dashY - 0.002, P.dashZ - 0.07], [1, 0, 0], [0, 0, 1], [0, -1, 0], 0.16, 0.025);
}

function muleSeat(K, cx, P, seed) {
  const x0 = cx - P.seatHalf, x1 = cx + P.seatHalf, y0 = P.seatY[0], y1 = P.seatY[1], sz = P.seatZ, fl = P.mule.zF;
  const tone = seed ? T.seatDk : T.seat;
  // The rails and the pedestal.
  for (const dx of [-0.16, 0.16]) K.box(cx + dx - 0.015, y0 - 0.08, fl, cx + dx + 0.015, y1 + 0.02, fl + 0.03, 'floor', 0.2, C.steel);
  K.box(cx - 0.18, y0 + 0.02, fl + 0.03, cx + 0.18, y1 - 0.06, sz - 0.14, 'seat', -0.2, T.frame);
  // The cushion, stitched in three rolls, and its front bolster.
  K.box(x0, y0, sz - 0.14, x1, y1, sz - 0.02, 'seat', 0.04, tone);
  for (let i = 0; i < 3; i++) {
    const ya = lerp(y0 + 0.02, y1 - 0.02, i / 3), yb2 = lerp(y0 + 0.02, y1 - 0.02, (i + 1) / 3) - 0.01;
    K.box(x0 + 0.05, ya, sz - 0.02, x1 - 0.05, yb2, sz, 'seat', 0.10, i & 1 ? tone : T.seatDk);
  }
  K.box(x0, y1 - 0.02, sz - 0.14, x1, y1 + 0.04, sz + 0.02, 'seat', 0.0, T.seatDk);
  // The backrest, leaning back, in three rolls, and its bolsters.
  const bb = [cx, y0 - 0.06, sz + 0.02], bt = [cx, y0 - 0.16, P.backZ];
  const up = norm(sub(bt, bb)), R = [1, 0, 0], N = norm(cross(up, R));
  const bc = mul(add(bb, bt), 0.5), bl = Math.hypot(...sub(bt, bb)) / 2;
  K.obox(bc, R, up, N, P.seatHalf, bl, 0.05, 'seat', -0.06, tone);
  for (let i = 0; i < 3; i++) {
    const t = -0.7 + i * 0.6;
    K.obox(add(add(bc, mul(up, t * bl)), mul(N, 0.055)), R, up, N, P.seatHalf - 0.05, bl * 0.26, 0.012, 'seat', 0.02, i & 1 ? tone : T.seatDk);
  }
  for (const s of [-1, 1]) K.obox(add(bc, add(mul(R, s * (P.seatHalf - 0.03)), mul(N, 0.03))), R, up, N, 0.03, bl * 0.9, 0.05, 'seat', 0.0, T.seatDk);
  // The headrest, behind the eye, and never at it.
  const hc = add(bt, [0, -0.02, 0.12]);
  if (hc[2] + 0.1 < P.roof - 0.03) {
    for (const s of [-0.07, 0.07]) K.rod(add(bt, [s, 0, -0.02]), add(hc, [s, 0, -0.06]), 0.006, 'seat', 0.2, C.chrome, 0.05, 4);
    K.obox(hc, R, up, N, 0.13, 0.08, 0.045, 'seat', -0.02, tone);
  }
  // THE HARNESS: two shoulder straps over the top of the back, a lap belt, the buckle.
  const face = (p0) => add(p0, mul(N, 0.06));
  const shoulderTop = (s) => face(add(bt, [s * 0.07, 0, -0.03]));
  const lap = (s) => [cx + s * (P.seatHalf - 0.02), y0 + 0.08, sz + 0.03];
  const buckle = [cx, y0 + 0.16, sz + 0.05];
  for (const s of [-1, 1]) {
    const a = shoulderTop(s), mid = face(add(bc, [s * 0.06, 0, 0]));
    K.rod(a, mid, 0.022, 'seat', 0.02, T.harness, 0, 4);
    K.rod(mid, add(buckle, [s * 0.02, 0, 0.02]), 0.022, 'seat', 0.02, T.harness, 0, 4);
    K.rod(lap(s), add(buckle, [s * 0.03, 0, 0]), 0.022, 'seat', 0.02, T.harness, 0, 4);
  }
  K.rod(add(buckle, [0, 0, -0.02]), [cx, y1 - 0.04, sz + 0.02], 0.02, 'seat', 0.02, T.harness, 0, 4);   // the crotch strap
  K.obox(buckle, [1, 0, 0], [0, 0, 1], [0, -1, 0], 0.04, 0.035, 0.012, 'seat', 0.3, T.buckle);
}

// ── WHAT MOVES ───────────────────────────────────────────────────────────────
function muleFit(P, live, push) {
  const K = makeKit(push), L = live || {}, Y = layout(P), xC = Y.xC;
  const powered = L.powered !== false;
  const ias = Math.max(0, num(L.ias)), alt = Math.max(0, num(L.alt)), vsi = num(L.vsi), hdg = num(L.hdg);
  const rpm = clamp(num(L.rpm), 0, 1.05), vne = Math.max(40, num(L.vne, 160));
  const pitch = num(L.pitch), bank = num(L.bank);
  const fuel = clamp(num(L.fuel, 1) > 1 ? num(L.fuel) / 100 : num(L.fuel, 1), 0, 1);
  const hull = clamp(num(L.hull, 1) > 1 ? num(L.hull) / 100 : num(L.hull, 1), 0, 1);
  const thr = clamp(num(L.throttle), 0, 1), ail = clamp(num(L.stickX), -1, 1), elev = clamp(num(L.stickY), -1, 1);
  const trim = clamp(num(L.trim), -1, 1), rud = clamp(num(L.rudder), -1, 1), flap = clamp(num(L.flapNotch), 0, 3);
  const hour = num(L.hour, 12), night = powered && (hour < 6.5 || hour > 19.5);
  const oilT = L.oilTemp != null ? clamp(num(L.oilTemp) / 120, 0, 1) : (powered ? 0.35 + rpm * 0.3 : 0);
  const glow = night ? 0.55 : 0;        // the panel's post lights, up at night
  const dialO = (o) => ({ face: [20, 22, 26], bezel: T.bezel, tick: [232, 232, 226], ...o });
  const Pn = K.panel([0, P.dashY - 0.004, 0], [1, 0, 0], [0, 0, 1], 'dash', 0.2);
  const glint = (x, z, R) => Pn.annulus(x, z, R * 0.82, R * 0.95, DIAL_GLINT, 1, 0.012, 6, 0.35 * Math.PI, 0.75 * Math.PI);
  const postLight = (x, z, R) => { if (glow) Pn.disc(x - R * 0.9, z + R * 0.9, 0.004, T.post, 1, 0.012, 6); };

  // ── BOTH SIX-PACKS ───────────────────────────────────────────────────────
  const six = (cx) => {
    const sx = (i) => cx + (i - 1) * Y.six.dx, R = Y.six.R, [z1, z2] = Y.six.z;
    Pn.dial(sx(0), z1, R, clamp(ias / (vne * 1.1), 0, 1), dialO({ ticks: 16, major: 4, arcs: [[0.25, 0.8, C.green], [0.8, 0.9, C.amber]], red: 0.9, name: 'KTS' }));
    Pn.attitude(sx(1), z1, R, powered ? pitch : 8, powered ? bank : 22);
    Pn.dial(sx(2), z1, R, (alt % 1000) / 1000, dialO({ a0: Math.PI / 2, sweep: TAU, ticks: 10, major: 1, frac2: (alt % 10000) / 10000, name: 'ALT' }));
    Pn.dial(sx(0), z2, R, clamp(0.5 + (powered ? bank : 0) / 90, 0, 1), dialO({ a0: Math.PI * 0.9, sweep: Math.PI * 0.8, ticks: 6, major: 3, name: 'TURN' }));
    Pn.compass(sx(1), z2, R, hdg);
    Pn.dial(sx(2), z2, R, clamp(0.5 + vsi / 4000, 0, 1), dialO({ a0: Math.PI, sweep: Math.PI * 1.8, ticks: 8, major: 2, name: 'VSI' }));
    for (let i = 0; i < 3; i++) for (const z of [z1, z2]) { glint(sx(i), z, R); postLight(sx(i), z, R); }
  };
  six(0);
  six(2 * xC);
  // The clock, left of the pilot's six, with its hour and minute hands.
  Pn.dial(-0.19, Y.six.z[0], 0.026, (hour % 12) / 12, dialO({ a0: Math.PI / 2, sweep: TAU, ticks: 12, major: 3, frac2: hour % 1, name: 'CLOCK' }));
  Pn.dial(-0.19, Y.six.z[1], 0.024, clamp(powered ? 0.55 : 0, 0, 1), dialO({ ticks: 6, major: 3, arcs: [[0.4, 0.7, C.green]], name: 'VAC' }));   // suction

  // ── THE ENGINE COLUMN: left and right, side by side ──────────────────────
  const run = powered ? rpm : 0;
  const rows = [
    { v: (e) => clamp(thr * 0.88 * run + e * 0.01, 0, 1), o: { arcs: [[0.1, 0.84, C.green]], red: 0.9 }, name: 'TORQ' },            // torque
    { v: (e) => clamp(run * (0.62 + 0.34 * thr) - e * 0.006, 0, 1), o: { arcs: [[0.72, 0.94, C.green]], red: 0.96 }, name: 'PROP' }, // prop rpm
    { v: (e) => clamp(run ? 0.30 + thr * 0.46 + e * 0.012 : 0, 0, 1), o: { arcs: [[0.25, 0.80, C.green]], red: 0.86 }, name: 'T5' },   // T5
    { v: (e) => clamp(run ? 0.52 + thr * 0.40 : 0, 0, 1) - e * 0.004, o: { arcs: [[0.5, 0.95, C.green]], red: 0.97 }, name: 'NG' },   // Ng
    { v: (e) => clamp(run ? 0.12 + thr * 0.7 : 0, 0, 1) + e * 0.006, o: { arcs: [[0.1, 0.9, C.green]] }, name: 'FF' },            // fuel flow
  ];
  rows.forEach((g, row) => Y.eng.x.forEach((x, e) => {
    Pn.dial(x, Y.eng.z[row], Y.eng.R, g.v(e), dialO({ ticks: 8, major: 2, ...g.o, name: g.name }));
    postLight(x, Y.eng.z[row], Y.eng.R);
  }));
  // Oil pressure and temperature under the column, a pair of strips per engine.
  for (let e = 0; e < 2; e++) {
    const x = Y.eng.x[e], zb = Y.eng.z[4] - 0.075;
    Pn.bar(x - 0.012, zb, zb + 0.04, 0.006, powered ? 0.35 + run * 0.5 : 0, C.green, 'P');
    Pn.bar(x + 0.012, zb, zb + 0.04, 0.006, oilT, oilT > 0.85 ? C.red : C.amber, 'T');
    Pn.text('OIL', x, zb - 0.018, 0.007, C.tick, 0.35, 0.004);
  }
  // FWD and AFT tank gauges, and the load meter.
  for (let i = 0; i < 2; i++) {
    const x = Y.fuelG.x[i];
    Pn.dial(x, Y.fuelG.z, Y.fuelG.R, powered ? clamp(fuel * (i ? 0.96 : 1.04), 0, 1) : 0, dialO({ ticks: 4, major: 1, red: 0.1, a0: Math.PI * 1.1, sweep: Math.PI * 0.8, name: i ? 'AFT' : 'FWD' }));
    postLight(x, Y.fuelG.z, Y.fuelG.R);
  }
  Pn.dial(xC - 0.175, Y.six.z[1], 0.026, powered ? 0.3 + thr * 0.25 : 0, dialO({ ticks: 6, major: 3, name: 'LOAD' }));   // the load meter

  // ── THE ANNUNCIATORS under the glareshield lip ───────────────────────────
  const An = K.panel([xC, P.dashY - 0.101, P.dashZ - 0.0475], [1, 0, 0], [0, 0, 1], 'dash', 0.1);
  const warn = [
    [fuel < 0.12, T.red], [!powered, T.red], [!!L.stall, T.red], [hull < 0.35, T.red],
    [!!L.bingo, T.amber], [powered && rpm < 0.25, T.amber], [flap > 0 && ias > vne * 0.6, T.amber], [oilT > 0.85, T.amber],
  ];
  // Each name is on its lens, since the strip has no room under it.
  const warnN = ['FUEL', 'BUS', 'STALL', 'HULL', 'BINGO', 'ENG', 'FLAPS', 'OIL T'];
  warn.forEach(([w, rgb], i) => {
    An.lamp(-0.105 + i * 0.030, 0, 0.011, 0.007, !!w, rgb);
    An.fitText(warnN[i], -0.105 + i * 0.030, 0, 0.019, 0.006, w ? [30, 10, 6] : [150, 146, 140], 0, 0.008);
  });
  // The fire T-handles either side.
  for (const sd of [-1, 1]) {
    An.rect(sd * 0.142 - 0.016, -0.009, sd * 0.142 + 0.016, 0.009, T.red, powered ? 0.3 : 0.05, 0.004);
    An.fitText(sd < 0 ? 'FIRE 1' : 'FIRE 2', sd * 0.142, 0, 0.028, 0.008, [240, 236, 226], 0.2, 0.006);
  }

  // ── THE RADIO STACK: COM, NAV, transponder, the altitude readout ──────────
  const r = Y.radio, unitZ = [r.z1 - 0.025, r.z1 - 0.07, r.z1 - 0.115];
  const strs = ['12190', '11770', String(1200 + (Math.round(hdg) % 7)).padStart(4, '0')];
  unitZ.forEach((z, i) => {
    Pn.rect(r.x - r.w + 0.006, z - 0.019, r.x + r.w - 0.006, z + 0.019, [34, 36, 40], 0, 0.003);
    if (powered) Pn.digits(r.x - 0.10, z - 0.008, 0.016, strs[i], T.lcd, true);
    else Pn.rect(r.x - 0.10, z - 0.009, r.x - 0.01, z + 0.009, T.lcdBg, 0, 0.004);
    Pn.knob(r.x + 0.11, z, 0.009, 0.012, [60, 60, 66], 0);
    Pn.knob(r.x + 0.08, z, 0.006, 0.010, [60, 60, 66], 0);
  });
  if (powered) Pn.digits(r.x + 0.00, unitZ[2] - 0.008, 0.016, String(Math.round(alt / 100) % 1000).padStart(3, '0'), T.amber, false);

  // ── THE SWITCHES, left of the pilot's six ────────────────────────────────
  const state = { battery: powered, genL: powered && rpm > 0.2, genR: powered && rpm > 0.2, beacon: powered, land: !!L.landingLight, taxi: !!L.landingLight, nav: powered && (night || !!L.landingLight) };
  Pn.rect(Y.sw.x[0] - 0.025, Y.sw.z - 0.03, Y.sw.x[6] + 0.025, Y.sw.z + 0.03, T.panelDk, 0, 0.0015);
  const SW_NAMES = ['BAT', 'GEN L', 'GEN R', 'BCN', 'LAND', 'TAXI', 'NAV'];
  Y.sw.x.forEach((x, i) => {
    const on = state[SW_IDS[i]];
    Pn.rect(x - 0.012, Y.sw.z + 0.019, x + 0.012, Y.sw.z + 0.025, T.placard, 0.1, 0.002);
    Pn.fitText(SW_NAMES[i], x, Y.sw.z + 0.022, 0.022, 0.0045, [24, 24, 26], 0, 0.003);
    Pn.toggle(x, Y.sw.z, on);
  });

  // ── THE CONTROL WHEELS: columns out of the floor ─────────────────────────
  const wheel = (x, left) => {
    const f = yokeFrame(Y, x, elev), a = f.axis;
    K.rod(f.piv, f.hub, 0.022, 'dash', 0.2, T.column, 0.02, 8);
    K.obox(f.piv, [1, 0, 0], a, norm(cross([1, 0, 0], a)), 0.05, 0.05, 0.04, 'dash', 0, [24, 24, 26]);   // the boot
    // The wheel's plane: square to the column, turned by the ailerons.
    const ang = ail * 1.1, R0 = [1, 0, 0], U0 = norm(cross(a, R0)).map((v) => -v);
    const U1 = norm(sub(U0, mul(a, dot(U0, a))));
    const Rr = add(mul(R0, Math.cos(ang)), mul(U1, Math.sin(ang))), Ur = add(mul(R0, -Math.sin(ang)), mul(U1, Math.cos(ang)));
    const W = (dx, dz) => add(add(f.hub, mul(Rr, dx)), mul(Ur, dz));
    // The Otter's wheel is a ram's horn: a bar across, two horns up, grips on the horns.
    const pts = [[-0.14, 0.07], [-0.15, 0.01], [-0.11, -0.03], [0, -0.035], [0.11, -0.03], [0.15, 0.01], [0.14, 0.07]];
    for (let i = 0; i < pts.length - 1; i++) K.rod(W(...pts[i]), W(...pts[i + 1]), 0.012, 'dash', 0.2, T.yoke, 0, 8);
    for (const sd of [-1, 1]) {
      K.rod(W(sd * 0.145, 0.04), W(sd * 0.14, 0.11), 0.017, 'dash', 0.1, C.grip, 0, 8);
      K.obox(W(sd * 0.14, 0.115), Rr, Ur, a, 0.006, 0.006, 0.006, 'dash', 0.3, sd < 0 ? T.red : C.black, 0.1);   // PTT, trim
    }
    K.obox(W(0, -0.01), Rr, Ur, a, 0.045, 0.03, 0.02, 'dash', 0.2, [150, 140, 108], 0.02);   // the hub plate
    if (left) K.obox(add(W(0, -0.01), mul(a, 0.021)), Rr, Ur, a, 0.03, 0.014, 0.002, 'dash', 0.1, T.placard, 0.05);
  };
  wheel(0, true);
  wheel(2 * xC, false);

  // ── THE PEDALS: hung from the floor ahead, with toe brakes ───────────────
  for (const [cx] of [[0], [2 * xC]]) for (const s of [-1, 1]) {
    const press = clamp(s < 0 ? -rud : rud, 0, 1);
    pedal(K, [cx + s * 0.11, 1.02, P.mule.zF + 0.34], 0.045, 0.22, press, [34, 34, 38]);
  }

  // ── THE OVERHEAD QUADRANT: power, prop, fuel, two of each ────────────────
  const q = Y.quad, c = Y.con;
  const levers = [
    [q.xs[0], thr, T.knobPwr], [q.xs[1], thr, T.knobPwr],
    [q.xs[2], powered ? 1 : 0.15, T.knobProp], [q.xs[3], powered ? 1 : 0.15, T.knobProp],
    [q.xs[4], powered ? 1 : 0, T.knobFuel], [q.xs[5], powered ? 1 : 0, T.knobFuel],
  ];
  levers.forEach(([x, v, rgb], i) => {
    const tip = leverKnob(Y, x + 0.013, v), piv = [xC + x + 0.013, q.y, c.zb];
    K.rod(piv, tip, 0.0055, 'hdr', 0.1, C.chrome, 0.05, 5);
    // Power levers wear a flat paddle, props a ridged knob, fuel a square cap.
    if (i < 2) K.obox(tip, [1, 0, 0], [0, 0, 1], [0, 1, 0], 0.016, 0.014, 0.009, 'hdr', 0.1, rgb, 0);
    else K.obox(tip, [1, 0, 0], [0, 0, 1], [0, 1, 0], 0.010, 0.013, 0.010, 'hdr', 0.1, rgb, 0.1);
  });
  // The friction lock under the power levers.
  K.rod([xC + q.xs[0] - 0.01, q.y - 0.18, c.zb - 0.01], [xC + q.xs[1] + 0.03, q.y - 0.18, c.zb - 0.01], 0.006, 'hdr', 0.2, C.chrome, 0.05, 5);

  // ── THE FLAP LEVER and its indicator, aft right on the console ───────────
  const fy = lerp(Y.flap.y0 - 0.0, Y.flap.y1, flap / 3);
  const fp = [Y.flap.x, fy, c.zb];
  K.rod(fp, add(fp, [0, 0, -0.06]), 0.006, 'hdr', 0.2, C.chrome, 0.05, 5);
  K.obox(add(fp, [0, 0, -0.07]), [1, 0, 0], [0, 1, 0], [0, 0, -1], 0.016, 0.012, 0.012, 'hdr', 0.2, T.knobFlap, 0.05);
  const Fi = K.panel([Y.flap.x + 0.004, -0.14, c.zb - 0.003], [1, 0, 0], [0, 1, 0], 'hdr', -0.1);
  Fi.rect(-0.018, -0.045, 0.018, 0.045, T.placard, 0.1, 0.001);
  Fi.rect(-0.004, -0.04, 0.004, 0.04, [20, 20, 22], 0, 0.002);
  Fi.rect(-0.012, 0.035 - flap / 3 * 0.07 - 0.003, 0.012, 0.035 - flap / 3 * 0.07 + 0.003, T.red, 0.3 + glow * 0.5, 0.004);

  // ── THE ELEVATOR TRIM WHEEL and its indicator, on the console's flank ────
  const tw = Y.trim, trA = trim * 3.2;
  for (let i = 0; i < 20; i++) {
    const a0 = (i / 20) * TAU + trA, a1 = ((i + 1) / 20) * TAU + trA;
    K.rod(add(tw.c, [0, Math.cos(a0) * tw.r, Math.sin(a0) * tw.r]), add(tw.c, [0, Math.cos(a1) * tw.r, Math.sin(a1) * tw.r]), 0.009, 'hdr', 0.2, i % 4 ? [30, 30, 34] : [214, 214, 218], 0, 5, false);
  }
  for (let i = 0; i < 3; i++) {
    const a = trA + i * TAU / 3;
    K.rod(tw.c, add(tw.c, [0, Math.cos(a) * tw.r * 0.95, Math.sin(a) * tw.r * 0.95]), 0.005, 'hdr', 0.2, [40, 40, 44], 0, 4);
  }
  const Ti = K.panel([c.x0 + 0.004, 0.06, c.zb + 0.055], [0, 1, 0], [0, 0, 1], 'hdr', -0.05);
  Ti.rect(-0.05, -0.014, 0.05, 0.014, T.placard, 0.1, 0.001);
  Ti.rect(-0.002 + trim * 0.042, -0.012, 0.002 + trim * 0.042, 0.012, [20, 20, 22], 0.2, 0.003);
  // The rudder trim crank, aft. ⚠ There is no rudder-trim channel in `live`, so it turns only if
  // one is ever sent (`rudderTrim`, -1..1); until then it sits centred.
  const rtA = clamp(num(L.rudderTrim), -1, 1) * 2;
  K.rod(Y.rtrim, add(Y.rtrim, [0, 0, -0.02]), 0.02, 'hdr', 0.2, [26, 26, 28], 0, 8);
  K.rod(add(Y.rtrim, [0, 0, -0.02]), add(Y.rtrim, [Math.cos(rtA) * 0.03, Math.sin(rtA) * 0.03, -0.025]), 0.004, 'hdr', 0.2, C.chrome, 0.05, 4);

  // ── THE OVERHEAD SWITCH PANEL aft: starters, ignition, lights ────────────
  const Ov = K.panel([xC, -0.18, c.zb - 0.002], [1, 0, 0], [0, 1, 0], 'hdr', -0.1);
  Ov.rect(-0.12, -0.16, 0.12, 0.10, T.quadDk, 0, 0.001);
  const ovN = [['STRT1', 'STRT2', 'IGN 1', 'IGN 2', 'BST 1', 'BST 2'],
               ['PITOT', 'DEICE', 'WSHLD', 'PROP', 'INST', 'FAN'],
               ['PANEL', 'FLOOD', 'CABIN', 'LOGO', 'WING', 'STROB']];
  for (let row = 0; row < 3; row++) for (let i = 0; i < 6; i++) Ov.toggle(-0.10 + i * 0.04, 0.06 - row * 0.07, powered && (row + i) % 3 !== 1, ovN[row][i]);
  Ov.lamp(-0.09, -0.14, 0.008, 0.005, powered && rpm < 0.1, T.amber, 'START 1');
  Ov.lamp(0.09, -0.14, 0.008, 0.005, powered && rpm < 0.1, T.amber, 'START 2');
  // The dome lamp's lens.
  const dome = !!(L.dome && powered);
  K.box(Y.dome[0] - 0.045, Y.dome[1] - 0.045, Y.dome[2] - 0.026, Y.dome[0] + 0.045, Y.dome[1] + 0.045, Y.dome[2] - 0.02, 'hdr', 0.3, dome ? [255, 238, 200] : [110, 108, 100], dome ? 1 : 0);
  // A red map light on each side of the console, lit at night.
  for (const s of [-1, 1]) K.box(xC + s * 0.135 - 0.01, 0.46, c.zb + 0.01, xC + s * 0.135 + 0.01, 0.50, c.zb + 0.03, 'hdr', 0.3, night ? [255, 70, 50] : [70, 30, 26], night ? 1 : 0);

  // Contact shadows for the moving parts that stand on something.
  contactShadow(K, [0, 0.62 - 0.02, P.mule.zF], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.07, 0.09);
  contactShadow(K, [2 * xC, 0.62 - 0.02, P.mule.zF], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.07, 0.09);

  hotspotHalo(K, muleHotspots(P, L), L);
}
